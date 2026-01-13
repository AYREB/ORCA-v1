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
    delta = series.diff()
    gain = delta.where(delta > 0, 0).rolling(window=int(period)).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=int(period)).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def compute_macd(series, fast=12, slow=26, signal=9, timeframe=None):
    ema_fast = series.ewm(span=int(fast), adjust=False).mean()
    ema_slow = series.ewm(span=int(slow), adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=int(signal), adjust=False).mean()
    return macd_line - signal_line

# ---------------- New indicators ----------------
def compute_bbands(series, period=20, stddev=2, timeframe=None):
    sma = series.rolling(window=int(period)).mean()
    std = series.rolling(window=int(period)).std()
    upper = sma + stddev * std
    lower = sma - stddev * std
    return pd.DataFrame({'upper': upper, 'middle': sma, 'lower': lower})

def compute_atr(data, period=14, timeframe=None):
    high_low = data['High'] - data['Low']
    high_close = (data['High'] - data['Close'].shift()).abs()
    low_close = (data['Low'] - data['Close'].shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    atr = tr.rolling(window=int(period)).mean()
    return atr

def compute_stochastic(data, k_period=14, d_period=3, slowing=3, timeframe=None):
    low_min = data['Low'].rolling(window=int(k_period)).min()
    high_max = data['High'].rolling(window=int(k_period)).max()
    k = ((data['Close'] - low_min) / (high_max - low_min)) * 100
    k_slow = k.rolling(window=int(slowing)).mean()
    d = k_slow.rolling(window=int(d_period)).mean()
    return pd.DataFrame({'%K': k_slow, '%D': d})

def compute_cci(data, period=20, timeframe=None):
    tp = (data['High'] + data['Low'] + data['Close']) / 3
    ma = tp.rolling(window=int(period)).mean()
    md = tp.rolling(window=int(period)).apply(lambda x: (x - x.mean()).abs().mean())
    cci = (tp - ma) / (0.015 * md)
    return cci

def compute_obv(data, timeframe=None):
    obv = pd.Series(index=data.index, dtype=float)
    obv.iloc[0] = 0
    for i in range(1, len(data)):
        if data['Close'].iloc[i] > data['Close'].iloc[i - 1]:
            obv.iloc[i] = obv.iloc[i - 1] + data['Volume'].iloc[i]
        elif data['Close'].iloc[i] < data['Close'].iloc[i - 1]:
            obv.iloc[i] = obv.iloc[i - 1] - data['Volume'].iloc[i]
        else:
            obv.iloc[i] = obv.iloc[i - 1]
    return obv
