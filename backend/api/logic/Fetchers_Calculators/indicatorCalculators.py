import pandas as pd

# ---------------- Indicator functions ----------------
def get_price(data, field='close', offset=0, context=None):
    """
    Returns a price value (scalar) for the current candle (context) or a Series if no context.
    data: pd.DataFrame with columns Open, High, Low, Close
    field: 'open', 'high', 'low', 'close'
    offset: 0=current candle, 1=previous, etc.
    context: dict with 'i' = current row index (required for scalar)
    """
    mapping = {'open': 'Open', 'high': 'High', 'low': 'Low', 'close': 'Close'}
    if field.lower() not in mapping:
        raise ValueError(f"Invalid price field: {field}")
    
    series = data[mapping[field.lower()]]

    if context and 'i' in context:
        i = int(context['i']) - int(offset)
        if i < 0 or i >= len(series):
            return float('nan')
        return series.iloc[i]

    return series.shift(offset) if offset else series

def get_volume(data, offset=0, context=None):
    """
    Returns the volume value (scalar) for the current candle (context) or a Series if no context.
    data: pd.DataFrame with a 'Volume' column
    offset: 0=current candle, 1=previous, etc.
    context: dict with 'i' = current row index (required for scalar)
    """
    if "Volume" not in data.columns:
        raise KeyError("DataFrame missing 'Volume' column")

    series = data["Volume"]

    if context and 'i' in context:
        i = int(context['i']) - int(offset)
        if i < 0 or i >= len(series):
            return float('nan')
        return series.iloc[i]

    return series.shift(offset) if offset else series


def compute_sma(series, period=14, timeframe=None):
    """Simple Moving Average with optional timeframe param."""
    return series.rolling(window=int(period)).mean()

def compute_ema(series, period=14, timeframe=None):
    """Exponential Moving Average with optional timeframe param."""
    return series.ewm(span=int(period), adjust=False).mean()

def compute_rsi(series, period=14, timeframe=None):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def compute_macd(series, fast=12, slow=26, signal=9, timeframe=None):
    ema_fast = series.ewm(span=int(fast), adjust=False).mean()
    ema_slow = series.ewm(span=int(slow), adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=int(signal), adjust=False).mean()
    return macd_line - signal_line
