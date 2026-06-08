import pandas as pd

# ---------------- Indicator functions ----------------

def get_price(data, field='close', offset=0, context=None):
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
    return series.rolling(window=int(period)).mean()

def compute_ema(series, period=14, timeframe=None):
    return series.ewm(span=int(period), adjust=False).mean()

def compute_rsi(series, period=14, timeframe=None):
    """Wilder's smoothing RSI - matches TradingView standard"""
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=int(period) - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=int(period) - 1, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def compute_macd(series, fast=12, slow=26, signal=9, timeframe=None):
    """Standard MACD - returns histogram (macd - signal)"""
    ema_fast = series.ewm(span=int(fast), adjust=False).mean()
    ema_slow = series.ewm(span=int(slow), adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=int(signal), adjust=False).mean()
    return macd_line - signal_line

def compute_bbands(series, period=20, stddev=2, timeframe=None):
    """Bollinger Bands - returns upper band for comparisons"""
    sma = series.rolling(window=int(period)).mean()
    std = series.rolling(window=int(period)).std(ddof=0)  # population std matches TradingView
    upper = sma + float(stddev) * std
    lower = sma - float(stddev) * std
    # Return upper band as default for condition comparisons
    # e.g. price > BBANDS means price > upper band
    return upper

def compute_atr(data, period=14, timeframe=None):
    """Wilder's ATR - matches TradingView standard"""
    high_low = data['High'] - data['Low']
    high_close = (data['High'] - data['Close'].shift()).abs()
    low_close = (data['Low'] - data['Close'].shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    # Wilder's smoothing not simple rolling mean
    atr = tr.ewm(com=int(period) - 1, adjust=False).mean()
    return atr

def compute_stochastic(data, k_period=14, d_period=3, slowing=3, timeframe=None):
    """Stochastic - returns %K (slowed) for condition comparisons"""
    low_min = data['Low'].rolling(window=int(k_period)).min()
    high_max = data['High'].rolling(window=int(k_period)).max()
    k_raw = ((data['Close'] - low_min) / (high_max - low_min)) * 100
    k_slow = k_raw.rolling(window=int(slowing)).mean()
    # Return %K as default for condition comparisons
    return k_slow

def compute_cci(data, period=20, timeframe=None):
    """CCI - standard calculation matches TradingView"""
    tp = (data['High'] + data['Low'] + data['Close']) / 3
    ma = tp.rolling(window=int(period)).mean()
    md = tp.rolling(window=int(period)).apply(
        lambda x: (x - x.mean()).abs().mean(), raw=True
    )
    cci = (tp - ma) / (0.015 * md)
    return cci

def compute_obv(data, timeframe=None):
    """OBV - vectorised version, much faster than loop"""
    direction = data['Close'].diff().apply(
        lambda x: 1 if x > 0 else (-1 if x < 0 else 0)
    )
    obv = (direction * data['Volume']).cumsum()
    obv.iloc[0] = 0
    return obv
