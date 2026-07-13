# registry_loader.py
import json
from pathlib import Path
from typing import Optional

REGISTRY_DIR = Path(__file__).resolve().parent.parent / "registries"

def load_indicator_registry() -> dict:
    with open(REGISTRY_DIR / "indicatorRegistry.json") as f:
        return json.load(f).get("INDICATORS", {})

def load_ticker_registry() -> dict:
    with open(REGISTRY_DIR / "tickerRegistry.json") as f:
        return json.load(f).get("TICKERS", {})

def load_timeframe_registry() -> dict:
    with open(REGISTRY_DIR / "timeframeRegistry.json") as f:
        return json.load(f).get("TIMEFRAMES", {})

def get_available_tickers(allowed: Optional[list] = None) -> dict:
    """
    Get available tickers.
    If allowed list provided, filter to only those tickers.
    This is how you limit tickers per user/plan.
    """
    all_tickers = load_ticker_registry()
    if allowed:
        return {k: v for k, v in all_tickers.items() if k in allowed}
    return all_tickers

def get_available_timeframes(ticker: Optional[str] = None) -> dict:
    """
    Get available timeframes.
    If ticker provided, return only timeframes available for that ticker.
    """
    all_timeframes = load_timeframe_registry()
    
    if ticker:
        tickers = load_ticker_registry()
        ticker_data = tickers.get(ticker, {})
        available = set(ticker_data.get("available_timeframes", list(all_timeframes.keys())))
        return {k: v for k, v in all_timeframes.items() if k in available}
    
    return all_timeframes

def build_registry_context(
    allowed_tickers: Optional[list] = None,
    allowed_timeframes: Optional[list] = None
) -> dict:
    tickers = get_available_tickers(allowed_tickers)
    all_timeframes = load_timeframe_registry()
    indicators = load_indicator_registry()

    # Union of timeframes across all allowed tickers
    available_tf_set = set()
    for ticker_data in tickers.values():
        ticker_tfs = ticker_data.get("available_timeframes", list(all_timeframes.keys()))
        available_tf_set.update(ticker_tfs)

    valid_timeframes = {k: v for k, v in all_timeframes.items() if k in available_tf_set}

    if allowed_timeframes:
        valid_timeframes = {k: v for k, v in valid_timeframes.items() if k in allowed_timeframes}

    return {
        "tickers": {k: v["aliases"] for k, v in tickers.items()},
        "timeframes": list(valid_timeframes.keys()),
        "indicators": list(indicators.keys()),
        "ticker_timeframes": {
            k: v.get("available_timeframes", list(valid_timeframes.keys()))
            for k, v in tickers.items()
        }
    }

def build_full_system_prompt(registry_context: dict = None) -> str:
    """
    Authoritative system prompt used for BOTH training and inference.
    Both finetune.py and orca_llm.py must use this so the model sees the same
    prompt format it was trained on.
    """
    if registry_context is None:
        registry_context = build_registry_context()

    indicators = load_indicator_registry()

    indicator_lines = []
    for name, info in indicators.items():
        args = info.get("args", [])
        defaults = info.get("defaults", {})
        defaults_str = ", ".join(f"{k}={v}" for k, v in defaults.items())
        indicator_lines.append(f"  - {name}: args={args}, defaults={{{defaults_str}}}")

    alias_lines = []
    for ticker, aliases in registry_context["tickers"].items():
        natural = [a for a in aliases if a != ticker][:3]
        if natural:
            alias_lines.append(f"  {ticker}: also known as {', '.join(natural)}")

    indicators_str   = "\n".join(indicator_lines)
    indicator_names  = ", ".join(indicators.keys())
    timeframes_str   = ", ".join(registry_context["timeframes"])
    aliases_section  = "\n".join(alias_lines) if alias_lines else "  (no aliases defined)"

    return f"""You are a trading strategy parser. Convert natural language trading strategies into JSON format.

AVAILABLE INDICATORS: {indicator_names}

INDICATOR DETAILS:
{indicators_str}

AVAILABLE TIMEFRAMES: {timeframes_str}

AVAILABLE TICKERS:
{aliases_section}
  Other exchange symbols are also allowed: if the user names a ticker not
  listed above, copy it into tickers VERBATIM in uppercase (e.g. PLTR, AMD,
  COIN, HOOD) — never substitute a different asset for an unfamiliar symbol.
  FX pairs use Yahoo format: EURUSD=X, GBPUSD=X.

JSON SCHEMA RULES:
- Top level key must be LONG or SHORT
- LONG = buying, SHORT = selling short
- context contains: tickers (list of canonical tickers), execution_timeframe, dateframe (start/end)
- context may also contain signal_tickers: watch-only symbols whose market data
  is loaded so conditions can reference them, but which are NEVER traded
- Any indicator may take a "ticker" argument to evaluate against a watch symbol:
  {{"func": "RSI", "arg": {{"period": 14, "timeframe": "1h", "offset": 0, "ticker": "SPY"}}}}
- "buy B when A does X" => tickers=[B], signal_tickers=[A], and every indicator
  in the condition that refers to A carries "ticker": "A"
- OPEN contains: CONDITIONS and ARGUMENTS
- CLOSE is optional - only include if explicitly mentioned
- CONDITIONS use: left, operator, right structure
- operators: >, <, >=, <=, ==, !=
- right side can be a value or another indicator
- AND/OR logic: {{"AND": [condition1, condition2]}}
- Arithmetic: {{"op": "*", "left": {{...}}, "right": {{...}}}}
- Default timeframe: 1h if not specified
- Default date range: last 1 year if not specified

OPEN ARGUMENTS (include only what is specified or can be inferred):
- stopLossPercent: whole number (5 = 5% stop loss, backtester divides by 100 internally)
- takeProfitPercent: whole number (15 = 15% take profit)
- initialOpenPositionInvestType: "percentCashBalance" | "fixedValue" | "numberShares" | "riskFixedAmount" | "riskPercentBalance"
- initialOpenPositionInvestAmount: fraction for percent/risk-percent types (0.2 = 20%), dollar amount for fixedValue/riskFixedAmount, share count for numberShares
  riskFixedAmount: risk $X if SL hit (e.g. 100 = risk $100 per trade, requires stopLossPercent)
  riskPercentBalance: risk X% of balance if SL hit (e.g. 0.01 = 1% risk per trade, requires stopLossPercent)
- recurring: true if DCA / pyramid entries are requested
- recurringPeriod: bars between recurring entries
- recurringInvestType: same options as initialOpenPositionInvestType
- recurringInvestAmount: same scale as initialOpenPositionInvestAmount
- maxRecurringCount: max additional entries, 0 = unlimited

CLOSE ARGUMENTS (optional, only if hold time or cooldown is specified):
- minHoldBars: ignore close condition for first N bars (0 = off)
- maxHoldBars: force-close after N bars (0 = off)
- reentryCooldownBars: cooldown bars before next entry allowed (0 = off)

Output ONLY raw JSON, no explanation, no markdown, no code fences."""


def resolve_ticker_alias(text: str, allowed_tickers: Optional[list] = None) -> Optional[str]:
    """
    Resolve any alias to canonical ticker.
    Returns None if not found or not in allowed list.
    """
    tickers = get_available_tickers(allowed_tickers)
    text_lower = text.lower().strip()
    
    for ticker, data in tickers.items():
        aliases = [a.lower() for a in data.get("aliases", [])]
        if text_lower in aliases or text_lower == ticker.lower():
            return ticker
    
    return None