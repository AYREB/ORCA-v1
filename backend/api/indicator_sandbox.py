# backend/api/indicator_sandbox.py
"""Compile/test gate for user-authored custom indicators.

Every custom indicator is the *body* of a fixed template:

    def calculate(data, context, **params):
        <body>
        return result

The header and the ``return`` line are never stored or supplied by the
client — this module always rebuilds the source from the template, so the
rigid input/output contract can't be bypassed. ``validate_indicator_source``
performs an AST-level safety pass (no imports, no dunder access, no
exec/eval/open/...). ``compile_indicator`` then executes the wrapped source in
a restricted namespace (``pandas``, ``numpy``, ``math`` and a small builtin
allowlist only) and returns the resulting ``calculate`` callable.
``run_indicator_test`` exercises that callable against a window of cached
OHLCV candles, in a worker thread bounded by a wall-clock timeout, and
produces the pass/fail + preview payload the API and the editor's "Run Test"
button rely on.
"""

from __future__ import annotations

import ast
import builtins
import keyword
import math
import re
import textwrap
import threading
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from django.conf import settings

INDICATOR_FUNCTION_HEADER = "def calculate(data, context, **params):"
INDICATOR_FUNCTION_RETURN = "return result"

RESERVED_PARAM_NAMES = {
    "data", "context", "params", "self", "result", "calculate",
    # Generic operand-level args every DSL indicator call accepts (eval_operand pops
    # these out of merged_args before splatting **params) — a declared parameter with
    # one of these names would silently collide with that mechanism.
    "ticker", "timeframe", "offset",
}
MAX_PARAMETERS = 12

INDICATOR_TEST_TIMEOUT_SECONDS = 5.0
INDICATOR_TEST_WINDOW = 60
INDICATOR_TEST_MIN_CANDLES = 5
DEFAULT_SAMPLE_FILENAME = "AAPL_1h.csv"

_FORBIDDEN_NAMES = {
    "exec", "eval", "compile", "open", "input", "globals", "locals", "vars",
    "getattr", "setattr", "delattr", "hasattr", "__import__", "breakpoint",
    "memoryview", "exit", "quit", "help",
}

_SAFE_BUILTIN_NAMES = (
    "abs", "all", "any", "bool", "dict", "enumerate", "filter", "float",
    "int", "isinstance", "len", "list", "map", "max", "min", "range",
    "round", "set", "sorted", "str", "sum", "tuple", "zip",
)

_SAFE_BUILTINS: dict[str, Any] = {
    name: getattr(builtins, name) for name in _SAFE_BUILTIN_NAMES if hasattr(builtins, name)
}

SAFE_GLOBALS: dict[str, Any] = {
    "__builtins__": _SAFE_BUILTINS,
    "pd": pd,
    "np": np,
    "math": math,
}


class IndicatorValidationError(ValueError):
    """Raised when user-authored indicator code fails the safety/compile/test gate."""


def _is_dunder(name: str) -> bool:
    return name.startswith("__") and name.endswith("__")


_REDUNDANT_HEADER_PATTERN = re.compile(
    r"^def\s+calculate\s*\(\s*data\s*,\s*context\s*,\s*\*\*params\s*\)\s*:\s*$"
)
_REDUNDANT_RETURN_PATTERN = re.compile(r"^return\s+result\s*$")


def _strip_redundant_wrapper(body: str) -> str:
    """Unwrap a body that redundantly re-includes the locked template around
    its own logic — e.g. a user pastes (or an LLM writes) the whole
    ``def calculate(data, context, **params): ... return result`` instead of
    just the body. The header and ``return`` are *always* supplied by
    ``build_indicator_source`` regardless of what's submitted, so a redundant
    copy isn't merely ignored — left in place, it would re-wrap into a
    *nested* ``calculate`` whose ``result`` is invisible to the outer
    ``return result``: code that compiles fine and only blows up with
    ``NameError: name 'result' is not defined`` the moment it actually runs.
    Stripping it here, before validation/compilation, makes the contract
    self-correcting rather than a footgun for whoever (or whatever) wrote it.
    """
    lines = (body or "").splitlines()

    start = 0
    while start < len(lines) and not lines[start].strip():
        start += 1
    if start >= len(lines) or not _REDUNDANT_HEADER_PATTERN.match(lines[start].strip()):
        return body

    end = len(lines)
    while end > start and not lines[end - 1].strip():
        end -= 1
    if end > start and _REDUNDANT_RETURN_PATTERN.match(lines[end - 1].strip()):
        end -= 1

    return "\n".join(lines[start + 1 : end])


def validate_indicator_source(body: str) -> None:
    """AST-level safety pass over the *body* the user wrote.

    Rejects imports, global/nonlocal rebinding, dunder name/attribute access
    (the classic sandbox-escape vector via ``__class__``/``__subclasses__``/
    ``__builtins__``/...), and direct references to dangerous builtins
    (``exec``, ``eval``, ``open``, ``getattr``, ...). Normal control flow
    (``for``/``while``/``if``/``try``/``with``/nested ``def``/``lambda``) is
    allowed — the danger surface is closed by the name blacklist plus the
    restricted globals ``compile_indicator`` executes against, not by banning
    constructs that legitimate indicator code needs.
    """
    try:
        tree = ast.parse(textwrap.dedent(body or ""), mode="exec")
    except SyntaxError as exc:
        raise IndicatorValidationError(f"Syntax error on line {exc.lineno}: {exc.msg}") from exc

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise IndicatorValidationError("Imports are not allowed in indicator code — use the provided pd/np/math.")
        if isinstance(node, (ast.Global, ast.Nonlocal)):
            raise IndicatorValidationError("global/nonlocal statements are not allowed.")
        if isinstance(node, ast.Name):
            if _is_dunder(node.id):
                raise IndicatorValidationError(f"Access to '{node.id}' is not allowed.")
            if node.id in _FORBIDDEN_NAMES:
                raise IndicatorValidationError(f"Use of '{node.id}' is not allowed in indicator code.")
        elif isinstance(node, ast.Attribute):
            if _is_dunder(node.attr):
                raise IndicatorValidationError(f"Access to '.{node.attr}' is not allowed.")
        elif isinstance(node, ast.keyword):
            if node.arg and _is_dunder(node.arg):
                raise IndicatorValidationError(f"Keyword argument '{node.arg}' is not allowed.")


def build_indicator_source(body: str) -> str:
    """Wrap the user's body in the rigid, never-editable template."""
    dedented = textwrap.dedent(body or "").strip("\n")
    inner = textwrap.indent(dedented, "    ") if dedented else "    pass"
    return (
        f"{INDICATOR_FUNCTION_HEADER}\n"
        f"{inner}\n"
        f"    {INDICATOR_FUNCTION_RETURN}\n"
    )


def compile_indicator(body: str) -> Callable[..., Any]:
    """Validate, then compile the wrapped source into a ``calculate`` callable.

    Executes in ``SAFE_GLOBALS`` only (empty ``__builtins__`` plus a curated
    allowlist, ``pd``/``np``/``math``) — no filesystem, network, process, or
    introspection access is reachable from that namespace.
    """
    body = _strip_redundant_wrapper(body or "")
    validate_indicator_source(body)
    source = build_indicator_source(body)

    try:
        code_obj = compile(source, "<custom_indicator>", "exec")
    except SyntaxError as exc:
        raise IndicatorValidationError(f"Syntax error on line {exc.lineno}: {exc.msg}") from exc

    namespace: dict[str, Any] = {}
    try:
        exec(code_obj, dict(SAFE_GLOBALS), namespace)  # noqa: S102 - sandboxed globals, see SAFE_GLOBALS
    except Exception as exc:  # pragma: no cover - defensive, compile() already caught SyntaxError
        raise IndicatorValidationError(f"Failed to define the indicator: {exc}") from exc

    func = namespace.get("calculate")
    if not callable(func):
        raise IndicatorValidationError("Indicator code must define the 'calculate' function.")
    return func


def validate_parameters(parameters: Any) -> list[dict[str, Any]]:
    """Validate and normalize the user's declared `{name, default}` parameters."""
    if parameters is None:
        return []
    if not isinstance(parameters, list):
        raise IndicatorValidationError("parameters must be a list of {name, default} objects.")
    if len(parameters) > MAX_PARAMETERS:
        raise IndicatorValidationError(f"A maximum of {MAX_PARAMETERS} parameters is supported.")

    seen: set[str] = set()
    cleaned: list[dict[str, Any]] = []
    for entry in parameters:
        if not isinstance(entry, dict):
            raise IndicatorValidationError("Each parameter must be an object with 'name' and 'default'.")

        name = str(entry.get("name", "")).strip()
        if not name.isidentifier():
            raise IndicatorValidationError(f"Parameter name '{name}' must be a valid Python identifier.")
        if _is_dunder(name) or name in RESERVED_PARAM_NAMES or keyword.iskeyword(name):
            raise IndicatorValidationError(f"Parameter name '{name}' is reserved and cannot be used.")
        if name in seen:
            raise IndicatorValidationError(f"Duplicate parameter name '{name}'.")
        seen.add(name)

        default = entry.get("default", 0)
        if isinstance(default, bool) or not isinstance(default, (int, float, str)):
            raise IndicatorValidationError(f"Default value for '{name}' must be a number or text.")

        cleaned.append({"name": name, "default": default})

    return cleaned


def _resolve_param_defaults(parameters: list[dict[str, Any]]) -> dict[str, Any]:
    return {entry["name"]: entry["default"] for entry in parameters}


def _coerce_numeric(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        return float(value)
    return None


def _sample_data_dir() -> Path:
    default_dir = Path(getattr(settings, "BASE_DIR", Path.cwd())) / "core" / "data_csvs"
    return Path(getattr(settings, "ORCA_ASSISTANT_MARKET_DATA_DIR", default_dir))


def load_sample_market_data(filename: str = DEFAULT_SAMPLE_FILENAME) -> pd.DataFrame:
    """Load a small cached OHLCV sample the compiler/tester runs indicators against."""
    path = _sample_data_dir() / filename
    if not path.exists():
        return pd.DataFrame()

    df = pd.read_csv(path)
    if df.empty:
        return df

    df = df.rename(columns={column: str(column).strip() for column in df.columns})
    datetime_column = next((column for column in ("Datetime", "Date", "index") if column in df.columns), None)
    if datetime_column:
        parsed = pd.to_datetime(df[datetime_column], utc=True, errors="coerce")
        valid = parsed.notna()
        df = df.loc[valid].copy()
        if df.empty:
            return df
        df.index = parsed.loc[valid].dt.tz_convert(None)
        df = df.drop(columns=[datetime_column])

    for column in ("Open", "High", "Low", "Close", "Volume"):
        if column in df.columns:
            df[column] = pd.to_numeric(df[column], errors="coerce")

    if "Close" in df.columns:
        df = df.dropna(subset=["Close"])

    return df.sort_index().tail(max(INDICATOR_TEST_WINDOW * 4, 200))


def _candle_timestamps(df: pd.DataFrame, indices: list[int]) -> list[str]:
    timestamps: list[str] = []
    for i in indices:
        try:
            if isinstance(df.index, pd.DatetimeIndex):
                timestamps.append(df.index[i].isoformat())
            else:
                timestamps.append(str(df.index[i]))
        except Exception:
            timestamps.append(str(i))
    return timestamps


def run_indicator_test(
    body: str,
    parameters: Any,
    sample_df: pd.DataFrame | None = None,
    *,
    timeout: float = INDICATOR_TEST_TIMEOUT_SECONDS,
    window: int = INDICATOR_TEST_WINDOW,
) -> dict[str, Any]:
    """Run the compiler/tester gate. Never persists anything — pure dry run.

    Returns ``{"passed": bool, "errors": [...], "preview": {"timestamps": [...], "values": [...]} | None}``.
    """
    try:
        cleaned_params = validate_parameters(parameters)
    except IndicatorValidationError as exc:
        return {"passed": False, "errors": [str(exc)], "preview": None}

    try:
        func = compile_indicator(body)
    except IndicatorValidationError as exc:
        return {"passed": False, "errors": [str(exc)], "preview": None}

    if sample_df is None:
        sample_df = load_sample_market_data()
    if sample_df is None or sample_df.empty:
        return {"passed": False, "errors": ["No sample market data is available to test against."], "preview": None}

    total_rows = len(sample_df)
    if total_rows < INDICATOR_TEST_MIN_CANDLES:
        return {"passed": False, "errors": ["Sample dataset is too small to run a test."], "preview": None}

    start = max(0, total_rows - window)
    indices = list(range(start, total_rows))
    defaults = _resolve_param_defaults(cleaned_params)
    outcome: dict[str, Any] = {}

    def _run() -> None:
        try:
            values = []
            for i in indices:
                values.append(func(sample_df, {"i": i}, **defaults))
            outcome["values"] = values
        except BaseException as exc:  # noqa: BLE001 - capture across the thread boundary
            outcome["error"] = exc

    # Plain daemon thread on purpose, NOT concurrent.futures.ThreadPoolExecutor:
    # a runaway loop in user code can't be force-killed from pure Python, and
    # ThreadPoolExecutor registers an atexit hook that joins every worker thread
    # on interpreter shutdown — which would hang the whole server process
    # waiting on that thread. A daemon thread is simply abandoned if it
    # outlives the timeout; its result is discarded.
    worker = threading.Thread(target=_run, daemon=True)
    worker.start()
    worker.join(timeout=timeout)

    if worker.is_alive():
        return {
            "passed": False,
            "errors": [
                f"Indicator timed out after {timeout:.0f}s. Avoid heavy loops or large lookbacks "
                "(the runaway code keeps running in the background as an abandoned daemon thread; "
                "its result is discarded)."
            ],
            "preview": None,
        }

    if "error" in outcome:
        exc = outcome["error"]
        if isinstance(exc, IndicatorValidationError):
            return {"passed": False, "errors": [str(exc)], "preview": None}
        return {"passed": False, "errors": [f"Indicator raised an error while running: {exc}"], "preview": None}

    raw_values = outcome.get("values", [])

    numeric_values: list[float] = []
    for idx, value in zip(indices, raw_values):
        numeric = _coerce_numeric(value)
        if numeric is None:
            return {
                "passed": False,
                "errors": [
                    "Indicator must return a single number (or NaN) for the current candle — "
                    f"got {type(value).__name__!r} at candle index {idx}. "
                    "Make sure 'result' is a float/int, e.g. result = float(data['Close'].iloc[context['i']])."
                ],
                "preview": None,
            }
        numeric_values.append(numeric)

    preview = {"timestamps": _candle_timestamps(sample_df, indices), "values": numeric_values}
    return {"passed": True, "errors": [], "preview": preview}
