import time
import hashlib

import yfinance as yf
import pandas as pd
import pandas_ta as ta
from django.core.cache import cache

def get_cache_key(ticker, start, end, interval):
    raw = f"{ticker}_{start}_{end}_{interval}"
    return f"market_data_{hashlib.md5(raw.encode()).hexdigest()}"


def _fetch(ticker, start, end, interval, dropna):
    data = yf.download(ticker, start=start, end=end, interval=interval, group_by="column")
    if data is None:
        return None
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0] if isinstance(col, tuple) else col for col in data.columns]
    if dropna:
        data = data.dropna()
    return data


def get_data_with_indicator(
    ticker: str,
    start: str,
    end: str,
    interval: str = "1h",
    dropna: bool = True,
) -> pd.DataFrame:

    # Check cache first
    cache_key = get_cache_key(ticker, start, end, interval)

    try:
        cached = cache.get(cache_key)
        if cached is not None:
            df = pd.read_json(cached, orient="split")
            # An empty cached frame is a poisoned entry from a throttled fetch
            # (older code cached those) — treat it as a miss and refetch.
            if not df.empty:
                print(f"✅ Cache hit: {ticker} {interval} {start}→{end}")
                return df
    except Exception:
        pass  # cache miss or error, just fetch fresh

    # Cache miss - fetch from yfinance. Yahoo throttles shared cloud IPs in
    # bursts and yfinance surfaces that as an EMPTY frame rather than an
    # error, so one empty result gets a single retry after a short pause.
    data = _fetch(ticker, start, end, interval, dropna)
    if data is None or data.empty:
        time.sleep(1.5)
        data = _fetch(ticker, start, end, interval, dropna)

    # Never cache an empty frame: with the old 24h daily timeout, a single
    # throttled fetch served "no data found" to every user for a full day.
    if data is None or data.empty:
        return data

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
