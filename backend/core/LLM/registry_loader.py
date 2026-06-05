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