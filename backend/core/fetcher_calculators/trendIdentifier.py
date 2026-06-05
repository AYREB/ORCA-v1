import pandas as pd
def identify_trend(data, context=None, lookback=10, per_candle_thresh=0.01):
    """
    Identifies trend based on last `lookback` candles.
    Returns 'Bullish', 'Bearish', or 'Consolidation'
    """
    if context is None or 'i' not in context:
        raise ValueError("Context with current index 'i' is required")
    
    i = context['i']
    if i < lookback:
        return "Not enough data"

    green = 0
    red = 0

    for offset in range(lookback, 0, -1):
        prev = get_price(data, 'close', offset=offset, context=context)
        curr = get_price(data, 'close', offset=offset-1, context=context)
        change_pct = (curr - prev) / prev * 100

        if change_pct >= per_candle_thresh:
            green += 1
        elif change_pct <= -per_candle_thresh:
            red += 1

    if green >= 6:
        return "Bullish"
    elif red >= 6:
        return "Bearish"
    else:
        return "Consolidation"



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


data=pd.read_csv("Data_CSVs/TSLA.csv")

context = {'i': len(data)-17}
trend = identify_trend(data, context)
print(trend)