# orca_llm.py - Inference pipeline
import json
import re
import threading
from datetime import datetime, timedelta
from pathlib import Path

from core.LLM.registry_loader import build_registry_context, load_ticker_registry
from core.parsing.validateParsedDSL import validate_conditions

# Global model cache
_model = None
_tokenizer = None
_model_lock = threading.Lock()

VALID_TIMEFRAMES = {"1m", "5m", "15m", "1h", "4h", "1D"}
VALID_INDICATORS = {"PRICE", "VOLUME", "SMA", "EMA", "RSI",
                    "MACD", "BBANDS", "ATR", "STOCH", "CCI", "OBV"}

ADAPTER_PATH = Path(__file__).resolve().parent / "adapters"


def get_model(adapter_path=None):
    global _model, _tokenizer

    if _model is not None:
        return _model, _tokenizer

    with _model_lock:
        if _model is not None:
            return _model, _tokenizer

        path = str(adapter_path or ADAPTER_PATH)
        from mlx_lm import load
        _model, _tokenizer = load(
            "mlx-community/Qwen2.5-7B-Instruct-4bit",
            adapter_path=path if Path(path).exists() else None,
        )

    return _model, _tokenizer


def build_system_prompt(registry_context: dict) -> str:
    tickers_str = ", ".join(registry_context["tickers"].keys())
    timeframes_str = ", ".join(registry_context["timeframes"])
    indicators_str = ", ".join(registry_context["indicators"])

    alias_lines = []
    for ticker, aliases in registry_context["tickers"].items():
        natural = [a for a in aliases if a != ticker][:3]
        if natural:
            alias_lines.append(f"  {ticker}: also known as {', '.join(natural)}")
    aliases_str = "\n".join(alias_lines)

    return f"""You are a trading strategy parser. Convert natural language trading strategies into JSON format.

AVAILABLE TICKERS: {tickers_str}
Ticker aliases:
{aliases_str}

AVAILABLE TIMEFRAMES: {timeframes_str}

AVAILABLE INDICATORS: {indicators_str}

RULES:
- Only use tickers from the available list above
- Only use timeframes from the available list above
- Only use indicators from the available list above
- Output ONLY raw JSON, no explanation, no markdown
- Percentages as decimals (5% = 0.05)
- Default timeframe: 1h if not specified
- Default date range: last 1 year if not specified"""


def fix_percentage_fields(block: dict) -> dict:
    args = block.get("ARGUMENTS", {})
    for field in ["stopLossPercent", "takeProfitPercent",
                  "initialOpenPositionInvestAmount", "recurringInvestAmount"]:
        if field in args:
            val = args[field]
            if isinstance(val, (int, float)) and 0 < val < 1:
                args[field] = round(val * 100, 4)
    return block


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
        invalid_tickers = [t for t in ctx["tickers"] if t not in valid_tickers]
        if invalid_tickers:
            errors.append(f"Invalid tickers: {invalid_tickers}")
            ctx["tickers"] = [t for t in ctx["tickers"] if t in valid_tickers]
            if not ctx["tickers"]:
                return None, errors

    if "execution_timeframe" not in ctx:
        errors.append("Missing execution_timeframe")
        return None, errors

    if ctx["execution_timeframe"] not in valid_timeframes:
        errors.append(f"Invalid timeframe: {ctx['execution_timeframe']}")
        ctx["execution_timeframe"] = "1h"

    if "dateframe" not in ctx:
        ctx["dateframe"] = {"start": "2025-01-01", "end": "2026-01-01"}

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

    open_block = fix_percentage_fields(open_block)

    if "CLOSE" in body:
        body["CLOSE"] = fix_percentage_fields(body["CLOSE"])

    validate_conditions(open_block["CONDITIONS"])

    return strategy, errors


TODAY = datetime.now()

DATE_PATTERNS = [
    (r"last (\d+) years?",  lambda m: (TODAY - timedelta(days=365 * int(m.group(1))), TODAY)),
    (r"past (\d+) years?",  lambda m: (TODAY - timedelta(days=365 * int(m.group(1))), TODAY)),
    (r"last (\d+) months?", lambda m: (TODAY - timedelta(days=30 * int(m.group(1))), TODAY)),
    (r"past (\d+) months?", lambda m: (TODAY - timedelta(days=30 * int(m.group(1))), TODAY)),
    (r"last (\d+) days?",   lambda m: (TODAY - timedelta(days=int(m.group(1))), TODAY)),
    (r"last year",          lambda m: (TODAY - timedelta(days=365), TODAY)),
    (r"past year",          lambda m: (TODAY - timedelta(days=365), TODAY)),
    (r"last month",         lambda m: (TODAY - timedelta(days=30), TODAY)),
    (r"last two years?",    lambda m: (TODAY - timedelta(days=730), TODAY)),
    (r"past two years?",    lambda m: (TODAY - timedelta(days=730), TODAY)),
    (r"last quarter",       lambda m: (TODAY - timedelta(days=90), TODAY)),
    (r"since (\d{4})",      lambda m: (datetime(int(m.group(1)), 1, 1), TODAY)),
    (r"from (\d{4})",       lambda m: (datetime(int(m.group(1)), 1, 1), TODAY)),
    (r"throughout (\d{4})", lambda m: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
    (r"during (\d{4})",     lambda m: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
    (r"all of (\d{4})",     lambda m: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
]


def extract_date_range(user_input: str):
    lower = user_input.lower()
    for pattern, extractor in DATE_PATTERNS:
        match = re.search(pattern, lower)
        if match:
            try:
                start, end = extractor(match)
                end = min(end, TODAY)
                if (end - start).days > 730:
                    start = end - timedelta(days=730)
                return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
            except Exception:
                continue
    return None


def apply_date_override(strategy: dict, user_input: str) -> dict:
    date_range = extract_date_range(user_input)
    if date_range:
        start, end = date_range
        direction = "LONG" if "LONG" in strategy else "SHORT"
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
    from mlx_lm import generate

    registry_context = build_registry_context(allowed_tickers, allowed_timeframes)
    normalised_input = normalise_tickers_from_registry(user_input, registry_context)

    model, tokenizer = get_model(adapter_path)
    system_prompt = build_system_prompt(registry_context)

    prompt = (
        f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n"
        f"<|im_start|>user\n{normalised_input}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )

    raw_output = generate(model, tokenizer, prompt=prompt, max_tokens=1024)
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
    from mlx_lm import generate

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

    model, tokenizer = get_model(adapter_path)
    system_prompt = build_system_prompt(registry_context)

    prompt = (
        f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n"
        f"<|im_start|>user\n{combined_input}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )

    raw_output = generate(model, tokenizer, prompt=prompt, max_tokens=1024)
    strategy, errors = validate_and_repair(raw_output, registry_context)

    if strategy is None:
        return None, errors, raw_output

    last_user_msg = user_messages[-1] if user_messages else ""
    strategy = apply_date_override(strategy, last_user_msg)

    return strategy, errors, raw_output
