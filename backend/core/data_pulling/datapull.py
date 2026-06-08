import yfinance as yf
import pandas as pd
import pandas_ta as ta
import os
import hashlib
from django.core.cache import cache

def get_cache_key(ticker, start, end, interval):
    """Generate a unique cache key for this data request"""
    raw = f"{ticker}_{start}_{end}_{interval}"
    return f"market_data_{hashlib.md5(raw.encode()).hexdigest()}"

def get_data_with_indicator(
    ticker: str,
    start: str,
    end: str,
    interval: str = "1h",
    dropna: bool = True,
    save_path: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data_csvs")
) -> pd.DataFrame:
    
    # Check cache first
    cache_key = get_cache_key(ticker, start, end, interval)
    
    try:
        cached = cache.get(cache_key)
        if cached is not None:
            print(f"✅ Cache hit: {ticker} {interval} {start}→{end}")
            return pd.read_json(cached, orient="split")
    except Exception:
        pass  # cache miss or error, just fetch fresh
    
    # Cache miss - fetch from yfinance
    data = yf.download(ticker, start=start, end=end, interval=interval, group_by="column")

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0] if isinstance(col, tuple) else col for col in data.columns]

    if dropna:
        data = data.dropna()

    if save_path:
        actualSavePath = f"{save_path}/{ticker}_{interval}.csv"
        data.to_csv(actualSavePath, index=True)

    # Store in cache
    try:
        # Cache timeout based on interval
        # Intraday data changes, daily data is stable
        if interval in ("1d", "1D"):
            timeout = 60 * 60 * 24  # 24 hours for daily
        elif interval in ("4h", "1h"):
            timeout = 60 * 60 * 4   # 4 hours for intraday
        else:
            timeout = 60 * 60       # 1 hour for short intervals
        
        cache.set(cache_key, data.to_json(orient="split"), timeout=timeout)
        print(f"📦 Cached: {ticker} {interval} {start}→{end}")
    except Exception as e:
        print(f"[WARN] Failed to cache data: {e}")

    return data
