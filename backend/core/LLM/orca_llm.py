# orca_llm.py - Inference pipeline
import json
import os
import re
import threading
from datetime import datetime, timedelta
from pathlib import Path

from core.LLM.registry_loader import build_registry_context, load_ticker_registry, build_full_system_prompt
from core.parsing.validateParsedDSL import validate_conditions

# Global model caches
_model = None
_tokenizer = None
_llama = None  # llama-cpp-python model (local GGUF provider)
_model_lock = threading.Lock()

VALID_TIMEFRAMES = {"1m", "5m", "15m", "1h", "4h", "1D"}
VALID_INDICATORS = {"PRICE", "VOLUME", "SMA", "EMA", "RSI",
                    "MACD", "BBANDS", "ATR", "STOCH", "CCI", "OBV"}


# Currency codes for FX pair detection ("EURUSD" -> "EURUSD=X").
_FX_CODES = {"USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"}

_SYMBOL_RE = re.compile(r"^\^?[A-Z0-9]{1,6}(?:[.\-][A-Z0-9]{1,4})?(?:=X)?$")


def looks_like_symbol(ticker: str) -> bool:
    """Plausible exchange symbol: AAPL, BRK-B, BTC-USD, EURUSD=X, ^GSPC."""
    return bool(_SYMBOL_RE.match(ticker))


def normalise_unknown_ticker(ticker: str) -> str:
    """Uppercase, and convert bare 6-letter FX pairs to Yahoo's PAIR=X form."""
    t = str(ticker).strip().upper()
    if len(t) == 6 and t.isalpha() and t[:3] in _FX_CODES and t[3:] in _FX_CODES:
        return f"{t}=X"
    return t


class LLMUnavailableError(RuntimeError):
    """The parser model is not deployed/configured on this host.

    Views catch this to return a friendly 503 instead of a generic 500 —
    it signals a deployment gap, not a bug or a bad user request.
    """

ADAPTER_PATH = Path(__file__).resolve().parent / "adapters"
# Repo root (…/ORCA-v1) so a relative ORCA_LLM_MODEL_PATH resolves predictably.
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _provider() -> str:
    """Which inference backend to use: 'local' (llama-cpp-python GGUF, default),
    'mlx' (Apple Silicon dev only), or 'modal' (hosted HTTP)."""
    return os.getenv("ORCA_LLM_PROVIDER", "local").strip().lower()


def get_model(adapter_path=None):
    """Load the MLX model + tokenizer (Apple Silicon dev only)."""
    global _model, _tokenizer

    if _model is not None:
        return _model, _tokenizer

    with _model_lock:
        if _model is not None:
            return _model, _tokenizer

        path = str(adapter_path or ADAPTER_PATH)
        try:
            from mlx_lm import load
        except ImportError as e:
            raise LLMUnavailableError(
                "mlx-lm is not installed (ORCA_LLM_PROVIDER=mlx is Apple Silicon only)."
            ) from e
        _model, _tokenizer = load(
            "mlx-community/Qwen2.5-7B-Instruct-4bit",
            adapter_path=path if Path(path).exists() else None,
        )

    return _model, _tokenizer


def _resolve_model_path() -> str:
    raw = os.getenv("ORCA_LLM_MODEL_PATH", "models/orca-qwen2.5.gguf")
    p = Path(raw)
    if not p.is_absolute():
        p = PROJECT_ROOT / p
    return str(p)


def _get_llama():
    """Load (and cache) the local GGUF model via llama-cpp-python."""
    global _llama

    if _llama is not None:
        return _llama

    with _model_lock:
        if _llama is not None:
            return _llama

        try:
            from llama_cpp import Llama
        except ImportError as e:
            raise LLMUnavailableError(
                "llama-cpp-python is not installed (ORCA_LLM_PROVIDER=local)."
            ) from e

        model_path = _resolve_model_path()
        if not Path(model_path).exists():
            raise LLMUnavailableError(
                f"GGUF model not found at {model_path}. Set ORCA_LLM_MODEL_PATH "
                "or place the file there."
            )
        _llama = Llama(
            model_path=model_path,
            n_ctx=int(os.getenv("ORCA_LLM_N_CTX", "4096")),
            n_gpu_layers=int(os.getenv("ORCA_LLM_N_GPU_LAYERS", "-1")),  # -1 = all on GPU
            verbose=False,
        )

    return _llama


def _generate_mlx(prompt: str, adapter_path=None, max_tokens: int = 1024) -> str:
    from mlx_lm import generate
    model, tokenizer = get_model(adapter_path)
    return generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens)


def _generate_local(prompt: str, max_tokens: int = 1024) -> str:
    llama = _get_llama()
    out = llama(
        prompt,
        max_tokens=max_tokens,
        temperature=0.0,
        stop=["<|im_end|>"],
    )
    return out["choices"][0]["text"]


def _generate_modal(prompt: str, max_tokens: int = 1024) -> str:
    import requests

    url = os.getenv("ORCA_MODAL_INFERENCE_URL", "").strip().rstrip("/")
    if not url:
        raise LLMUnavailableError("ORCA_MODAL_INFERENCE_URL is not set (ORCA_LLM_PROVIDER=modal).")

    headers = {"Content-Type": "application/json"}
    api_key = os.getenv("ORCA_MODAL_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    resp = requests.post(
        url,
        json={"prompt": prompt, "max_tokens": max_tokens},
        headers=headers,
        timeout=env_float_modal_timeout(),
    )
    resp.raise_for_status()
    return resp.json()["output"]


def env_float_modal_timeout() -> float:
    try:
        return float(os.getenv("ORCA_MODAL_TIMEOUT_SECONDS", "120"))
    except ValueError:
        return 120.0


def generate_raw(prompt: str, adapter_path=None, max_tokens: int = 1024) -> str:
    """Run raw text generation through the configured provider."""
    provider = _provider()
    if provider == "modal":
        return _generate_modal(prompt, max_tokens)
    if provider == "local":
        return _generate_local(prompt, max_tokens)
    # Default: MLX (legacy Apple Silicon local dev).
    return _generate_mlx(prompt, adapter_path, max_tokens)


def prewarm():
    """Load the model into memory ahead of the first request, when that helps.
    No-op for the 'modal' provider (warming happens on Modal's side)."""
    provider = _provider()
    if provider == "local":
        _get_llama()
    elif provider == "modal":
        pass  # nothing to load locally; Modal handles its own cold start
    else:
        get_model()


def build_system_prompt(registry_context: dict) -> str:
    return build_full_system_prompt(registry_context)


# REMOVED: fix_percentage_fields. It assumed any TP/SL below 1.0 was a
# decimal-fraction mistake and multiplied by 100 — but sub-1% stops are
# legitimate for FX ("sl 0.7%" was silently becoming a 70% stop), and it
# also corrupted invest amounts, whose CORRECT format is a fraction
# (0.2 = 20% of cash). The model is trained on the right conventions —
# trust its output.


def validate_and_repair(raw: str, registry_context: dict = None) -> tuple:
    errors = []

    if registry_context:
        valid_tickers = set(registry_context["tickers"].keys())
        valid_timeframes = set(registry_context["timeframes"])
    else:
        valid_tickers = None
        valid_timeframes = VALID_TIMEFRAMES

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(
            l for l in lines if not l.strip().startswith("```")
        ).strip()

    try:
        strategy = json.loads(cleaned)
    except json.JSONDecodeError as e:
        errors.append(f"Invalid JSON: {e}")
        return None, errors

    if "LONG" in strategy:
        direction = "LONG"
    elif "SHORT" in strategy:
        direction = "SHORT"
    else:
        errors.append("Missing LONG or SHORT key")
        return None, errors

    body = strategy[direction]

    if "context" not in body:
        errors.append("Missing context")
        return None, errors

    ctx = body["context"]

    if "tickers" not in ctx or not ctx["tickers"]:
        errors.append("Missing tickers")
        return None, errors

    if valid_tickers:
        kept, dropped = [], []
        for t in ctx["tickers"]:
            if t in valid_tickers:
                kept.append(t)
                continue
            candidate = normalise_unknown_ticker(t)
            if candidate in valid_tickers:
                kept.append(candidate)
            elif looks_like_symbol(candidate):
                # Not in the registry, but symbol-shaped — let it through so
                # AI mode supports the same open ticker universe as manual
                # mode. The review card flags it for the user to confirm.
                kept.append(candidate)
                errors.append(f"Unrecognised ticker '{candidate}' — verify it before running")
            else:
                dropped.append(t)
        if dropped:
            errors.append(f"Invalid tickers: {dropped}")
        ctx["tickers"] = kept
        if not ctx["tickers"]:
            return None, errors

    if "execution_timeframe" not in ctx:
        errors.append("Missing execution_timeframe")
        return None, errors

    if ctx["execution_timeframe"] not in valid_timeframes:
        errors.append(f"Invalid timeframe: {ctx['execution_timeframe']}")
        ctx["execution_timeframe"] = "1h"

    if "dateframe" not in ctx:
        _today = datetime.now()
        ctx["dateframe"] = {
            "start": (_today - timedelta(days=365)).strftime("%Y-%m-%d"),
            "end": _today.strftime("%Y-%m-%d"),
        }

    if "OPEN" not in body:
        errors.append("Missing OPEN block")
        return None, errors

    open_block = body["OPEN"]

    if "CONDITIONS" not in open_block:
        errors.append("Missing OPEN.CONDITIONS")
        return None, errors

    if "ARGUMENTS" not in open_block:
        open_block["ARGUMENTS"] = {
            "initialOpenPositionInvestType": "percentCashBalance",
            "initialOpenPositionInvestAmount": 0.2,
            "stopLossPercent": 10,
            "takeProfitPercent": 30,
        }
        errors.append("Missing ARGUMENTS - filled with defaults")

    validate_conditions(open_block["CONDITIONS"])

    return strategy, errors


# NOTE: "today" is computed per request, never at import time — a Django
# process can run for weeks, and a module-level constant would silently make
# every relative date range ("last 2 years") drift stale as the process ages.

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}
_MONTH_ALT = "|".join(_MONTHS)


def _month_start(m, today):
    """'since march' → the most recent March 1st; 'since march 2024' → 2024-03-01."""
    month = _MONTHS[m.group(1)]
    year = int(m.group(2)) if m.group(2) else (today.year if month <= today.month else today.year - 1)
    return datetime(year, month, 1)


DATE_PATTERNS = [
    (r"last (\d+) years?",  lambda m, t: (t - timedelta(days=365 * int(m.group(1))), t)),
    (r"past (\d+) years?",  lambda m, t: (t - timedelta(days=365 * int(m.group(1))), t)),
    (r"last (\d+) months?", lambda m, t: (t - timedelta(days=30 * int(m.group(1))), t)),
    (r"past (\d+) months?", lambda m, t: (t - timedelta(days=30 * int(m.group(1))), t)),
    (r"last (\d+) days?",   lambda m, t: (t - timedelta(days=int(m.group(1))), t)),
    (r"last year",          lambda m, t: (t - timedelta(days=365), t)),
    (r"past year",          lambda m, t: (t - timedelta(days=365), t)),
    (r"last month",         lambda m, t: (t - timedelta(days=30), t)),
    (r"last two years?",    lambda m, t: (t - timedelta(days=730), t)),
    (r"past two years?",    lambda m, t: (t - timedelta(days=730), t)),
    (r"last quarter",       lambda m, t: (t - timedelta(days=90), t)),
    (r"since (\d{4})",      lambda m, t: (datetime(int(m.group(1)), 1, 1), t)),
    (r"from (\d{4})",       lambda m, t: (datetime(int(m.group(1)), 1, 1), t)),
    (r"throughout (\d{4})", lambda m, t: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
    (r"during (\d{4})",     lambda m, t: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
    (r"all of (\d{4})",     lambda m, t: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
    (rf"(?:since|from) ({_MONTH_ALT})(?: (\d{{4}}))?", lambda m, t: (_month_start(m, t), t)),
]


def extract_date_range(user_input: str):
    today = datetime.now()
    lower = user_input.lower()
    for pattern, extractor in DATE_PATTERNS:
        match = re.search(pattern, lower)
        if match:
            try:
                start, end = extractor(match, today)
                end = min(end, today)
                if (end - start).days > 730:
                    start = end - timedelta(days=730)
                return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
            except Exception:
                continue
    return None


def apply_date_override(strategy: dict, user_input: str) -> dict:
    """Normalise the backtest window. Dates are a "now" concept the model
    cannot know: its training data froze "recent" at training time, so its
    default dateframes go stale. User date language always wins; otherwise
    the window is the last 12 months ending today — capped to what the data
    provider stores for the strategy's timeframe (15m only has ~55 days, so
    a 12-month default there would return no data at all).
    """
    from core.parsing.inputSanity import clamp_dateframe_for_timeframe

    date_range = extract_date_range(user_input)
    if date_range:
        start, end = date_range
    else:
        today = datetime.now()
        start = (today - timedelta(days=365)).strftime("%Y-%m-%d")
        end = today.strftime("%Y-%m-%d")
    direction = "LONG" if "LONG" in strategy else "SHORT"
    tf = strategy[direction]["context"].get("execution_timeframe", "1D")
    start, end, _note = clamp_dateframe_for_timeframe(start, end, tf)
    strategy[direction]["context"]["dateframe"] = {"start": start, "end": end}
    return strategy


def normalise_tickers_from_registry(text: str, registry_context: dict) -> str:
    result = text
    for ticker, aliases in registry_context["tickers"].items():
        for alias in aliases:
            if alias.lower() != ticker.lower():
                result = re.sub(
                    rf'\b{re.escape(alias)}\b',
                    ticker,
                    result,
                    flags=re.IGNORECASE,
                )
    return result


def parse_strategy(
    user_input: str,
    adapter_path=None,
    allowed_tickers: list = None,
    allowed_timeframes: list = None,
) -> dict:
    registry_context = build_registry_context(allowed_tickers, allowed_timeframes)
    normalised_input = normalise_tickers_from_registry(user_input, registry_context)

    system_prompt = build_system_prompt(registry_context)

    prompt = (
        f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n"
        f"<|im_start|>user\n{normalised_input}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )

    raw_output = generate_raw(prompt, adapter_path=adapter_path, max_tokens=1024)
    strategy, errors = validate_and_repair(raw_output, registry_context)

    if strategy is None:
        return {"error": "Failed to parse strategy", "issues": errors, "raw_output": raw_output}

    strategy = apply_date_override(strategy, user_input)
    return strategy


def parse_strategy_with_context(
    messages: list,
    adapter_path=None,
    allowed_tickers: list = None,
    allowed_timeframes: list = None,
) -> tuple:
    user_messages = [m["content"] for m in messages if m["role"] == "user"]
    combined_input = " ".join(user_messages)

    registry_context = build_registry_context(allowed_tickers, allowed_timeframes)
    combined_input = normalise_tickers_from_registry(combined_input, registry_context)

    mentioned_tickers = [
        t for t in registry_context["tickers"].keys()
        if t in combined_input.upper()
    ]

    if mentioned_tickers and not allowed_timeframes:
        available_tfs = set()
        ticker_reg = load_ticker_registry()
        all_tfs = list(registry_context["timeframes"])
        for t in mentioned_tickers:
            tfs = ticker_reg.get(t, {}).get("available_timeframes", all_tfs)
            available_tfs.update(tfs)
        registry_context = build_registry_context(allowed_tickers, list(available_tfs))

    system_prompt = build_system_prompt(registry_context)

    prompt = (
        f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n"
        f"<|im_start|>user\n{combined_input}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )

    raw_output = generate_raw(prompt, adapter_path=adapter_path, max_tokens=1024)
    strategy, errors = validate_and_repair(raw_output, registry_context)

    if strategy is None:
        return None, errors, raw_output

    # Date language can appear in any turn ("last 2 years" in msg 1,
    # clarification answers after) — scan the whole user side of the chat.
    all_user_text = " ".join(user_messages)
    strategy = apply_date_override(strategy, all_user_text)

    # Semantic sanity (impossible/always-true conditions, scale mismatches)
    # rides the errors list so it surfaces on the review card.
    from core.parsing.inputSanity import check_strategy as _sanity
    _blockers, _warns = _sanity(strategy)
    errors.extend(_blockers + _warns)

    return strategy, errors, raw_output
