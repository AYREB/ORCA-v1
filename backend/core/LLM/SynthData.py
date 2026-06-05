# SynthData.py - Final Version with typos, dates, close conditions
import json
import random
from datetime import datetime, timedelta

# ---------------- CONFIG ----------------
REFERENCE_DATE = datetime(2025, 6, 1)

# ---------------- TICKER ALIASES ----------------
TICKERS = {
    "AAPL":    ["AAPL", "Apple", "apple", "apple stock", "AAPL stock", "appl", "appel", "aple"],
    "TSLA":    ["TSLA", "Tesla", "tesla", "tesla stock", "telsa", "tesala", "testa"],
    "MSFT":    ["MSFT", "Microsoft", "microsoft", "microsot", "microsfot", "mircosoft"],
    "GOOGL":   ["GOOGL", "Google", "google", "Alphabet", "gogle", "googel"],
    "AMZN":    ["AMZN", "Amazon", "amazon", "amazn", "amazone"],
    "NVDA":    ["NVDA", "Nvidia", "nvidia", "nvida", "nvdia", "nividia"],
    "META":    ["META", "Meta", "meta", "Facebook", "facebook"],
    "SPY":     ["SPY", "S&P 500", "the S&P", "spy etf"],
    "QQQ":     ["QQQ", "Nasdaq", "nasdaq", "tech ETF", "qqq"],
    "BTC-USD": ["BTC-USD", "Bitcoin", "bitcoin", "BTC", "btc", "bitcon", "bitcone"],
}

ALL_TICKER_ALIASES = [alias for aliases in TICKERS.values() for alias in aliases]

def canonical_ticker(alias):
    for ticker, aliases in TICKERS.items():
        if alias in aliases:
            return ticker
    return alias

# ---------------- TIMEFRAME ALIASES ----------------
TIMEFRAME_ALIASES = {
    "1m":  ["1m", "1 minute", "1min", "one minute", "1-minute"],
    "5m":  ["5m", "5 minute", "5min", "five minute", "5-minute"],
    "15m": ["15m", "15 minute", "15min", "fifteen minute", "15-minute"],
    "1h":  ["1h", "1 hour", "hourly", "1hr", "60 minute", "one hour", "1-hour"],
    "4h":  ["4h", "4 hour", "4hr", "four hour", "4-hour"],
    "1D":  ["1D", "daily", "day", "1 day", "D", "one day"],
}

ALL_TF_ALIASES = {alias: tf for tf, aliases in TIMEFRAME_ALIASES.items() for alias in aliases}
ALL_TF_ALIAS_LIST = list(ALL_TF_ALIASES.keys())

def canonical_tf(alias):
    return ALL_TF_ALIASES.get(alias, alias)

# ---------------- DATE EXPRESSIONS ----------------
DATE_EXPRESSIONS = [
    # No date - 60% weight (6 entries)
    {"text": None, "start": "2025-01-01", "end": "2026-01-01"},
    {"text": None, "start": "2025-01-01", "end": "2026-01-01"},
    {"text": None, "start": "2024-01-01", "end": "2025-01-01"},
    {"text": None, "start": "2024-03-01", "end": "2025-03-01"},
    {"text": None, "start": "2025-01-01", "end": "2026-01-01"},
    {"text": None, "start": "2025-01-01", "end": "2026-01-01"},
    # Relative
    {"text": "over the last year",         "start": "2024-06-01", "end": "2025-06-01"},
    {"text": "for the past year",          "start": "2024-06-01", "end": "2025-06-01"},
    {"text": "over the last 2 years",      "start": "2023-06-01", "end": "2025-06-01"},
    {"text": "past two years",             "start": "2023-06-01", "end": "2025-06-01"},
    {"text": "last 2 years",               "start": "2023-06-01", "end": "2025-06-01"},
    {"text": "over the last 6 months",     "start": "2024-12-01", "end": "2025-06-01"},
    {"text": "past 6 months",              "start": "2024-12-01", "end": "2025-06-01"},
    {"text": "over the last 3 months",     "start": "2025-03-01", "end": "2025-06-01"},
    {"text": "last quarter",               "start": "2025-03-01", "end": "2025-06-01"},
    {"text": "past 90 days",               "start": "2025-03-01", "end": "2025-06-01"},
    {"text": "over the last month",        "start": "2025-05-01", "end": "2025-06-01"},
    # Specific years
    {"text": "from 2023",                  "start": "2023-01-01", "end": "2025-06-01"},
    {"text": "since 2023",                 "start": "2023-01-01", "end": "2025-06-01"},
    {"text": "starting from January 2023", "start": "2023-01-01", "end": "2025-06-01"},
    {"text": "from 2024",                  "start": "2024-01-01", "end": "2025-06-01"},
    {"text": "since 2024",                 "start": "2024-01-01", "end": "2025-06-01"},
    {"text": "throughout 2024",            "start": "2024-01-01", "end": "2024-12-31"},
    {"text": "during 2024",                "start": "2024-01-01", "end": "2024-12-31"},
    {"text": "all of 2024",                "start": "2024-01-01", "end": "2024-12-31"},
    {"text": "throughout 2023",            "start": "2023-01-01", "end": "2023-12-31"},
    # Specific ranges
    {"text": "from January 2023 to June 2024",     "start": "2023-01-01", "end": "2024-06-01"},
    {"text": "between January 2023 and June 2024", "start": "2023-01-01", "end": "2024-06-01"},
    {"text": "from March 2024 to March 2025",      "start": "2024-03-01", "end": "2025-03-01"},
    {"text": "from June 2023 to June 2025",        "start": "2023-06-01", "end": "2025-06-01"},
]

def random_date():
    expr = random.choice(DATE_EXPRESSIONS)
    return expr["text"], expr["start"], expr["end"]

def inject_date(base_text, date_phrase):
    if not date_phrase:
        return base_text
    options = [
        f"{base_text}, {date_phrase}",
        f"{base_text}. Backtest {date_phrase}.",
        f"Backtest {date_phrase}: {base_text}",
        f"{base_text} — test {date_phrase}",
        f"{base_text}, tested {date_phrase}",
    ]
    return random.choice(options)

# ---------------- TYPO INJECTION ----------------

def add_typos(text: str, rate: float = 0.2) -> str:
    """
    Inject realistic typos into ~20% of training examples.
    Skips tickers, numbers, percentages, and very short words.
    """
    if random.random() > rate:
        return text

    words = text.split()
    corrupted = []

    for word in words:
        clean = word.strip(".,!?;:")

        # Skip: short words, all-caps (likely tickers), numbers, percentages
        if len(clean) <= 2 or clean.isupper() or clean[0].isdigit() or '%' in clean:
            corrupted.append(word)
            continue

        roll = random.random()

        if roll < 0.25 and len(clean) > 3:
            # Swap two adjacent characters: "when" -> "wehn"
            i = random.randint(0, len(clean) - 2)
            w = list(clean)
            w[i], w[i+1] = w[i+1], w[i]
            punct = word[len(clean):]
            corrupted.append("".join(w) + punct)

        elif roll < 0.45 and len(clean) > 4:
            # Drop a character: "drops" -> "drps"
            i = random.randint(1, len(clean) - 2)
            punct = word[len(clean):]
            corrupted.append(clean[:i] + clean[i+1:] + punct)

        elif roll < 0.6 and len(clean) > 3:
            # Duplicate a character: "below" -> "beloww"
            i = random.randint(1, len(clean) - 1)
            punct = word[len(clean):]
            corrupted.append(clean[:i] + clean[i] + clean[i:] + punct)

        elif roll < 0.75:
            # Wrong case
            corrupted.append(clean.lower() if random.random() < 0.5 else clean.upper())

        else:
            corrupted.append(word)

    return " ".join(corrupted)

# ---------------- INDICATOR BUILDERS ----------------

def rsi_ind(tf, period=None, offset=0):
    return {"func": "RSI", "arg": {"period": period or random.choice([7, 10, 14, 21]), "timeframe": tf, "offset": offset}}

def sma_ind(tf, period=None, offset=0):
    return {"func": "SMA", "arg": {"period": period or random.choice([20, 50, 100, 200]), "timeframe": tf, "offset": offset}}

def ema_ind(tf, period=None, offset=0):
    return {"func": "EMA", "arg": {"period": period or random.choice([9, 12, 20, 50]), "timeframe": tf, "offset": offset}}

def macd_ind(tf, offset=0):
    return {"func": "MACD", "arg": {"fast": random.choice([8, 12]), "slow": random.choice([21, 26]), "signal": random.choice([7, 9]), "timeframe": tf, "offset": offset}}

def price_ind(ohlc="close", offset=0):
    return {"func": "PRICE", "arg": {"OHLC": ohlc, "offset": offset}}

def stoch_ind(tf, offset=0):
    return {"func": "STOCH", "arg": {"k_period": 14, "d_period": 3, "slowing": 3, "timeframe": tf, "offset": offset}}

def bbands_ind(tf, offset=0):
    return {"func": "BBANDS", "arg": {"period": 20, "stddev": 2, "timeframe": tf, "offset": offset}}

def volume_ind(offset=0):
    return {"func": "VOLUME", "arg": {"offset": offset}}

def cci_ind(tf, period=None, offset=0):
    return {"func": "CCI", "arg": {"period": period or random.choice([14, 20]), "timeframe": tf, "offset": offset}}

def obv_ind(tf, offset=0):
    return {"func": "OBV", "arg": {"timeframe": tf, "offset": offset}}

def atr_ind(tf, period=14, offset=0):
    return {"func": "ATR", "arg": {"period": period, "timeframe": tf, "offset": offset}}

def val(v):
    return {"value": v}

def arith(left, op, right):
    return {"op": op, "left": left, "right": right}

def cond(left, op, right):
    return {"left": left, "operator": op, "right": right}

def and_cond(conditions):
    return {"AND": conditions}

def or_cond(conditions):
    return {"OR": conditions}

# ---------------- ARGUMENT BUILDERS ----------------

def open_args(tp=None, sl=None, invest_pct=None, fixed_amount=None,
              recurring=False, rec_period=None, rec_amount=None, max_rec=None):
    args = {}
    if invest_pct:
        args["initialOpenPositionInvestType"] = "percentCashBalance"
        args["initialOpenPositionInvestAmount"] = invest_pct / 100
    if fixed_amount:
        args["initialOpenPositionInvestType"] = "fixedValue"
        args["initialOpenPositionInvestAmount"] = fixed_amount
    if tp:
        args["takeProfitPercent"] = tp / 100
    if sl:
        args["stopLossPercent"] = sl / 100
    if recurring:
        args["recurring"] = True
        args["recurringPeriod"] = rec_period or random.choice([5, 10, 20])
        args["recurringInvestType"] = "percentCashBalance"
        args["recurringInvestAmount"] = (rec_amount or random.choice([5, 10])) / 100
        args["maxRecurringCount"] = max_rec or random.choice([0, 3, 5])
    return args

def close_args():
    return {"test": 0.5}

# ---------------- LANGUAGE HELPERS ----------------

LONG_OPENERS = [
    "Buy {t}", "Go long {t}", "Long {t}", "Enter long on {t}",
    "Enter a long position on {t}", "Open a long on {t}",
    "I want to buy {t}", "Take a long on {t}", "Get long {t}",
    "Purchase {t}", "Go long on {t}", "I'd like to go long on {t}",
    "Set up a long trade on {t}", "Enter {t} long",
]

SHORT_OPENERS = [
    "Short {t}", "Go short {t}", "Short sell {t}", "Enter short on {t}",
    "Enter a short position on {t}", "Open a short on {t}",
    "I want to short {t}", "Take a short on {t}", "Sell short {t}",
    "Fade {t}", "Go short on {t}", "I'd like to short {t}",
    "Set up a short trade on {t}", "Enter {t} short",
]

WHEN_PHRASES = [
    "when {c}", "if {c}", "whenever {c}", "once {c}",
    "as soon as {c}", "at the point {c}", "should {c}",
    "in the event that {c}", "any time {c}",
]

TP_PHRASES = [
    "take profit at {v}%", "TP at {v}%", "TP {v}%",
    "target {v}% profit", "profit target {v}%",
    "exit at {v}% gain", "{v}% take profit", "take {v}% profit",
    "aim for {v}% gain", "set TP to {v}%",
]

SL_PHRASES = [
    "stop loss at {v}%", "SL at {v}%", "SL {v}%",
    "stop at {v}%", "risk {v}%", "max loss {v}%",
    "{v}% stop", "tight stop at {v}%", "hard stop {v}%",
    "set SL to {v}%", "no more than {v}% loss",
]

TF_PHRASES = [
    "on the {tf} timeframe", "on {tf}", "on {tf} chart",
    "on {tf} candles", "using {tf} bars", "{tf} timeframe",
    "on the {tf} chart", "using {tf} candles",
]

def opener(direction, ticker):
    t = LONG_OPENERS if direction == "LONG" else SHORT_OPENERS
    return random.choice(t).format(t=ticker)

def when(c):
    return random.choice(WHEN_PHRASES).format(c=c)

def tp_str(v):
    return random.choice(TP_PHRASES).format(v=v)

def sl_str(v):
    return random.choice(SL_PHRASES).format(v=v)

def tf_str(tf):
    return random.choice(TF_PHRASES).format(tf=tf)

def tpsl(tp, sl):
    t, s = tp_str(tp), sl_str(sl)
    j = random.choice([", ", " and ", " with "])
    return (t + j + s) if random.random() < 0.5 else (s + j + t)

def only_sl(sl):
    return sl_str(sl)

def only_tp(tp):
    return tp_str(tp)

# ---------------- CLOSE CONDITION HELPERS ----------------

def maybe_add_close(strategy, direction, tf_canonical, open_indicator_type, tp, sl):
    """30% chance of adding explicit CLOSE condition"""
    if random.random() > 0.3:
        return strategy

    close_cond_map = {
        "RSI": {
            "LONG":  (cond(rsi_ind(tf_canonical, 14), ">", val(random.choice([65, 70, 75]))),
                      f"RSI rises above {random.choice([65, 70, 75])}"),
            "SHORT": (cond(rsi_ind(tf_canonical, 14), "<", val(random.choice([25, 30, 35]))),
                      f"RSI drops below {random.choice([25, 30, 35])}"),
        },
        "MACD": {
            "LONG":  (cond(macd_ind(tf_canonical), "<", val(0)), "MACD turns negative"),
            "SHORT": (cond(macd_ind(tf_canonical), ">", val(0)), "MACD turns positive"),
        },
        "SMA": {
            "LONG":  (cond(price_ind("close", 0), "<", sma_ind(tf_canonical, 50)), "price falls below 50-SMA"),
            "SHORT": (cond(price_ind("close", 0), ">", sma_ind(tf_canonical, 50)), "price rises above 50-SMA"),
        },
    }

    indicator_map = close_cond_map.get(open_indicator_type, close_cond_map["RSI"])
    close_condition, close_text = indicator_map[direction]

    strategy[direction]["CLOSE"] = {
        "CONDITIONS": close_condition,
        "ARGUMENTS": close_args()
    }

    return strategy, close_text

# ---------------- GENERATORS ----------------

def gen_rsi_simple(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    period = random.choice([7, 10, 14, 21])
    tp = random.choice([5, 10, 15, 20, 25, 30])
    sl = random.choice([3, 5, 7, 10, 15])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        threshold = random.choice([20, 25, 30, 35, 40])
        op = random.choice(["<", "<="])
        cond_texts = [
            f"RSI({period}) drops below {threshold}",
            f"RSI is below {threshold}",
            f"RSI falls below {threshold}",
            f"RSI is oversold below {threshold}",
            f"{period}-period RSI < {threshold}",
            f"RSI goes under {threshold}",
            f"RSI dips below {threshold}",
        ]
    else:
        threshold = random.choice([60, 65, 70, 75, 80])
        op = random.choice([">", ">="])
        cond_texts = [
            f"RSI({period}) rises above {threshold}",
            f"RSI is above {threshold}",
            f"RSI is overbought above {threshold}",
            f"{period}-period RSI > {threshold}",
            f"RSI goes over {threshold}",
            f"RSI climbs above {threshold}",
        ]

    cond_text = random.choice(cond_texts)
    structures = [
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        f"{opener(direction, ticker_alias)} {tf_str(tf_alias)} {when(cond_text)}, {tpsl(tp, sl)}",
        f"{opener(direction, ticker_alias)} {when(cond_text)}, {tpsl(tp, sl)}, {tf_str(tf_alias)}",
        f"{opener(direction, ticker_alias)}: {cond_text} {tf_str(tf_alias)}. {tpsl(tp, sl)}.",
    ]
    text = inject_date(random.choice(structures), date_phrase)

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(rsi_ind(tf, period), op, val(threshold)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }

    result = maybe_add_close(strategy, direction, tf, "RSI", tp, sl)
    if isinstance(result, tuple):
        strategy, close_text = result
        text = text.rstrip(".") + f", close {when(close_text)}"

    return text, strategy


def gen_sma_price_cross(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    period = random.choice([20, 50, 100, 200])
    tp = random.choice([10, 15, 20, 30])
    sl = random.choice([5, 7, 10, 15])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        op = ">"
        cond_texts = [
            f"price crosses above the {period}-period SMA",
            f"price breaks above SMA({period})",
            f"price is above the {period} SMA",
            f"close crosses above {period}-SMA",
            f"price moves above its {period}-day moving average",
            f"price goes above the {period}-day MA",
        ]
    else:
        op = "<"
        cond_texts = [
            f"price falls below the {period}-period SMA",
            f"price breaks below SMA({period})",
            f"price drops below {period}-SMA",
            f"close below {period}-day moving average",
            f"price goes under the {period}-day MA",
        ]

    cond_text = random.choice(cond_texts)
    structures = [
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        f"{opener(direction, ticker_alias)} {tf_str(tf_alias)} {when(cond_text)}, {tpsl(tp, sl)}",
        f"{opener(direction, ticker_alias)} {when(cond_text)}, {tpsl(tp, sl)}",
    ]
    text = inject_date(random.choice(structures), date_phrase)

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(price_ind("close", 0), op, sma_ind(tf, period)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }

    result = maybe_add_close(strategy, direction, tf, "SMA", tp, sl)
    if isinstance(result, tuple):
        strategy, close_text = result
        text = text.rstrip(".") + f", close {when(close_text)}"

    return text, strategy


def gen_golden_cross(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    fast = random.choice([20, 50])
    slow = 200 if fast == 50 else random.choice([100, 200])
    tp = random.choice([20, 30, 40, 50])
    sl = random.choice([10, 15, 20])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        op = ">"
        cond_texts = [
            f"{fast} SMA crosses above {slow} SMA",
            f"golden cross — {fast}-day SMA above {slow}-day SMA",
            f"SMA({fast}) > SMA({slow})",
            f"{fast}-day moving average crosses above {slow}-day",
        ]
    else:
        op = "<"
        cond_texts = [
            f"{fast} SMA crosses below {slow} SMA",
            f"death cross — {fast}-day SMA below {slow}-day SMA",
            f"SMA({fast}) < SMA({slow})",
            f"{fast}-day moving average crosses below {slow}-day",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(sma_ind(tf, fast), op, sma_ind(tf, slow)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_ema_cross(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    fast = random.choice([9, 12, 20])
    slow = random.choice([26, 50, 100])
    tp = random.choice([10, 15, 20, 30])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        op = ">"
        cond_texts = [
            f"{fast} EMA crosses above {slow} EMA",
            f"EMA({fast}) crosses above EMA({slow})",
            f"fast EMA({fast}) above slow EMA({slow})",
            f"{fast}-period EMA goes above {slow}-period EMA",
        ]
    else:
        op = "<"
        cond_texts = [
            f"{fast} EMA crosses below {slow} EMA",
            f"EMA({fast}) crosses below EMA({slow})",
            f"fast EMA({fast}) below slow EMA({slow})",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(ema_ind(tf, fast), op, ema_ind(tf, slow)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_gap(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    pct = random.choice([3, 5, 7, 10])
    tp = random.choice([5, 7, 10, 15, 20])
    sl = random.choice([2, 3, 5, 7])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        multiplier = round(1 + pct / 100, 4)
        open_op = "<"
        cond_texts = [
            f"it gaps up from yesterday's close by {pct}% or more",
            f"overnight gap up is at least {pct}%",
            f"today's open is {pct}% above yesterday's close",
            f"there's a {pct}%+ gap up overnight",
            f"price gaps up {pct}% from previous close",
        ]
        left = price_ind("close", 1)
        right = arith(price_ind("open", 0), "*", val(multiplier))
    else:
        multiplier = round(1 - pct / 100, 4)
        open_op = ">"
        cond_texts = [
            f"it gaps down from yesterday's close by {pct}% or more",
            f"overnight gap down is at least {pct}%",
            f"today's open is {pct}% below yesterday's close",
            f"there's a {pct}%+ gap down overnight",
            f"price gaps down {pct}% from previous close",
        ]
        left = price_ind("open", 0)
        right = arith(price_ind("close", 1), "*", val(multiplier))

    cond_text = random.choice(cond_texts)
    structures = [
        f"{opener(direction, ticker_alias)} {when(cond_text)}, {tpsl(tp, sl)}, {tf_str(tf_alias)}",
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        f"{opener(direction, ticker_alias)}: {cond_text}. {tpsl(tp, sl)}. {tf_str(tf_alias)}.",
    ]
    text = inject_date(random.choice(structures), date_phrase)

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(left, open_op, right),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_macd(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    tp = random.choice([10, 15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        op = ">"
        cond_texts = [
            "MACD crosses above zero",
            "MACD turns positive",
            "MACD is above the zero line",
            "MACD > 0",
            "MACD goes positive",
        ]
    else:
        op = "<"
        cond_texts = [
            "MACD crosses below zero",
            "MACD turns negative",
            "MACD < 0",
            "MACD goes negative",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(macd_ind(tf), op, val(0)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }

    result = maybe_add_close(strategy, direction, tf, "MACD", tp, sl)
    if isinstance(result, tuple):
        strategy, close_text = result
        text = text.rstrip(".") + f", close {when(close_text)}"

    return text, strategy


def gen_volume_spike(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    multiplier = random.choice([1.5, 2.0, 2.5, 3.0])
    tp = random.choice([10, 15, 20])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    cond_texts = [
        f"volume exceeds {multiplier}x the average",
        f"volume spikes above {multiplier}x normal",
        f"volume is {multiplier}x above average",
        f"there's a volume spike of {multiplier}x",
        f"volume surges to {multiplier}x its average",
    ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(volume_ind(), ">", arith(sma_ind(tf, 20), "*", val(multiplier))),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_rsi_and_macd(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    rsi_period = random.choice([7, 14, 21])
    tp = random.choice([15, 20, 25, 30])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        rsi_threshold = random.choice([35, 40, 45, 50])
        rsi_op, macd_op = ">", ">"
        cond_texts = [
            f"RSI({rsi_period}) > {rsi_threshold} AND MACD is positive",
            f"RSI above {rsi_threshold} and MACD crosses zero",
            f"both RSI > {rsi_threshold} and MACD > 0",
            f"RSI is over {rsi_threshold} and MACD is bullish",
        ]
    else:
        rsi_threshold = random.choice([50, 55, 60, 65])
        rsi_op, macd_op = "<", "<"
        cond_texts = [
            f"RSI({rsi_period}) < {rsi_threshold} AND MACD is negative",
            f"RSI below {rsi_threshold} and MACD under zero",
            f"both RSI < {rsi_threshold} and MACD < 0",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": and_cond([
                    cond(rsi_ind(tf, rsi_period), rsi_op, val(rsi_threshold)),
                    cond(macd_ind(tf), macd_op, val(0))
                ]),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }

    result = maybe_add_close(strategy, direction, tf, "RSI", tp, sl)
    if isinstance(result, tuple):
        strategy, close_text = result
        text = text.rstrip(".") + f", close {when(close_text)}"

    return text, strategy


def gen_price_above_sma_and_rsi(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    sma_period = random.choice([20, 50, 100, 200])
    rsi_period = random.choice([7, 14, 21])
    rsi_val = random.choice([40, 45, 50, 55])
    tp = random.choice([15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        price_op, rsi_op = ">", ">"
        cond_texts = [
            f"price is above {sma_period}-SMA AND RSI({rsi_period}) > {rsi_val}",
            f"close > SMA({sma_period}) and RSI above {rsi_val}",
            f"price above {sma_period} moving average with RSI > {rsi_val}",
        ]
    else:
        price_op, rsi_op = "<", "<"
        cond_texts = [
            f"price is below {sma_period}-SMA AND RSI({rsi_period}) < {rsi_val}",
            f"close < SMA({sma_period}) and RSI below {rsi_val}",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": and_cond([
                    cond(price_ind("close", 0), price_op, sma_ind(tf, sma_period)),
                    cond(rsi_ind(tf, rsi_period), rsi_op, val(rsi_val))
                ]),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_bollinger(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    tp = random.choice([10, 15, 20])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        op = ">"
        cond_texts = [
            "price breaks above the upper Bollinger Band",
            "price crosses above upper BB",
            "close > upper Bollinger Band",
            "price goes above the upper Bollinger Band",
        ]
    else:
        op = "<"
        cond_texts = [
            "price breaks below the lower Bollinger Band",
            "close < lower Bollinger Band",
            "price goes below the lower Bollinger Band",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(price_ind("close", 0), op, bbands_ind(tf)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_mean_reversion(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    pct = random.choice([3, 5, 7, 10])
    period = random.choice([20, 50, 100])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        op, close_op = "<", ">="
        multiplier = round(1 - pct / 100, 4)
        cond_texts = [
            f"price is {pct}% below the {period}-period EMA",
            f"price drops {pct}% under EMA({period})",
            f"close is {pct}% beneath {period}-EMA",
        ]
    else:
        op, close_op = ">", "<="
        multiplier = round(1 + pct / 100, 4)
        cond_texts = [
            f"price is {pct}% above the {period}-period EMA",
            f"price rises {pct}% over EMA({period})",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, "
        f"close when price returns to EMA, {only_sl(sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(price_ind("close", 0), op, arith(ema_ind(tf, period), "*", val(multiplier))),
                "ARGUMENTS": open_args(sl=sl)
            },
            "CLOSE": {
                "CONDITIONS": cond(price_ind("close", 0), close_op, ema_ind(tf, period)),
                "ARGUMENTS": close_args()
            }
        }
    }
    return text, strategy


def gen_stochastic(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    tp = random.choice([10, 15, 20])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        threshold, op = random.choice([20, 25, 30]), "<"
        cond_texts = [
            f"Stochastic drops below {threshold}",
            f"Stoch is oversold below {threshold}",
            f"stochastic oscillator < {threshold}",
        ]
    else:
        threshold, op = random.choice([70, 75, 80]), ">"
        cond_texts = [
            f"Stochastic rises above {threshold}",
            f"Stoch is overbought above {threshold}",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(stoch_ind(tf), op, val(threshold)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_cci(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    period = random.choice([14, 20])
    tp = random.choice([15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        threshold, op = random.choice([-200, -150, -100]), "<"
        cond_texts = [f"CCI({period}) drops below {threshold}", f"CCI is below {threshold}"]
    else:
        threshold, op = random.choice([100, 150, 200]), ">"
        cond_texts = [f"CCI({period}) rises above {threshold}", f"CCI is above {threshold}"]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(cci_ind(tf, period), op, val(threshold)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_obv_divergence(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    tp = random.choice([15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        obv_op, price_op = ">", "<"
        cond_texts = ["OBV is rising while price is falling", "bullish OBV divergence"]
    else:
        obv_op, price_op = "<", ">"
        cond_texts = ["OBV is falling while price is rising", "bearish OBV divergence"]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": and_cond([
                    cond(obv_ind(tf, 0), obv_op, obv_ind(tf, 1)),
                    cond(price_ind("close", 0), price_op, price_ind("close", 1))
                ]),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_rsi_with_close(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    tp = random.choice([15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        open_rsi, close_rsi = random.choice([25, 30, 35]), random.choice([65, 70, 75])
        open_op, close_op = "<", ">"
        open_texts = [f"RSI drops below {open_rsi}", f"RSI is oversold below {open_rsi}", f"RSI goes under {open_rsi}"]
        close_texts = [f"RSI rises above {close_rsi}", f"RSI becomes overbought above {close_rsi}", f"RSI goes over {close_rsi}"]
    else:
        open_rsi, close_rsi = random.choice([65, 70, 75]), random.choice([25, 30, 35])
        open_op, close_op = ">", "<"
        open_texts = [f"RSI rises above {open_rsi}", f"RSI is overbought above {open_rsi}"]
        close_texts = [f"RSI drops below {close_rsi}", f"RSI becomes oversold below {close_rsi}"]

    open_text = random.choice(open_texts)
    close_text = random.choice(close_texts)

    structures = [
        f"{opener(direction, ticker_alias)} {when(open_text)} {tf_str(tf_alias)}, close {when(close_text)}, {tpsl(tp, sl)}",
        f"{opener(direction, ticker_alias)} {when(open_text)} and close {when(close_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
    ]
    text = inject_date(random.choice(structures), date_phrase)

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(rsi_ind(tf, 14), open_op, val(open_rsi)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            },
            "CLOSE": {
                "CONDITIONS": cond(rsi_ind(tf, 14), close_op, val(close_rsi)),
                "ARGUMENTS": close_args()
            }
        }
    }
    return text, strategy


def gen_macd_with_close(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    period = random.choice([20, 50])
    tp = random.choice([15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        macd_op, price_op = ">", "<"
        open_texts = ["MACD turns positive", "MACD crosses above zero", "MACD goes positive"]
        close_texts = [f"price falls below {period}-SMA", f"price drops under SMA({period})"]
    else:
        macd_op, price_op = "<", ">"
        open_texts = ["MACD turns negative", "MACD crosses below zero"]
        close_texts = [f"price rises above {period}-SMA", f"price breaks above SMA({period})"]

    open_text = random.choice(open_texts)
    close_text = random.choice(close_texts)

    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(open_text)} {tf_str(tf_alias)}, "
        f"close {when(close_text)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(macd_ind(tf), macd_op, val(0)),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            },
            "CLOSE": {
                "CONDITIONS": cond(price_ind("close", 0), price_op, sma_ind(tf, period)),
                "ARGUMENTS": close_args()
            }
        }
    }
    return text, strategy


def gen_recurring_dca(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    threshold = random.choice([25, 30, 35, 40])
    initial = random.choice([10, 15, 20])
    rec = random.choice([5, 10])
    period = random.choice([5, 10, 20])
    max_count = random.choice([3, 5, 10])
    tp = random.choice([20, 30, 40])
    sl = random.choice([10, 15, 20])
    date_phrase, start, end = random_date()

    cond_texts = [f"RSI drops below {threshold}", f"RSI < {threshold}", f"RSI is oversold below {threshold}"]
    cond_text = random.choice(cond_texts)

    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, "
        f"invest {initial}% initially then {rec}% every {period} candles up to {max_count} times, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(rsi_ind(tf, 14), "<", val(threshold)),
                "ARGUMENTS": open_args(
                    tp=tp, sl=sl, invest_pct=initial,
                    recurring=True, rec_period=period, rec_amount=rec, max_rec=max_count
                )
            }
        }
    }
    return text, strategy


def gen_triple_condition(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    sma_period = random.choice([20, 50, 100])
    rsi_low = random.choice([40, 45, 50])
    rsi_high = rsi_low + random.choice([15, 20, 25])
    tp = random.choice([20, 25, 30])
    sl = random.choice([5, 10])
    date_phrase, start, end = random_date()

    price_op = ">" if direction == "LONG" else "<"
    macd_op = ">" if direction == "LONG" else "<"
    direction_word = "above" if direction == "LONG" else "below"

    cond_texts = [
        f"price {direction_word} {sma_period}-SMA AND RSI between {rsi_low} and {rsi_high} AND MACD {'>' if direction == 'LONG' else '<'} 0",
    ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": and_cond([
                    cond(price_ind("close", 0), price_op, sma_ind(tf, sma_period)),
                    cond(rsi_ind(tf, 14), ">", val(rsi_low)),
                    cond(rsi_ind(tf, 14), "<", val(rsi_high)),
                    cond(macd_ind(tf), macd_op, val(0))
                ]),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_multi_timeframe(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    daily_rsi = random.choice([25, 30, 35])
    hourly_rsi = random.choice([40, 45, 50])
    tp = random.choice([15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        daily_op, hourly_op = "<", ">"
        cond_texts = [
            f"daily RSI is oversold below {daily_rsi} AND hourly RSI crosses above {hourly_rsi}",
            f"RSI on 1D < {daily_rsi} and RSI on 1h > {hourly_rsi}",
        ]
    else:
        daily_op, hourly_op = ">", "<"
        cond_texts = [
            f"daily RSI is overbought above {daily_rsi} AND hourly RSI drops below {hourly_rsi}",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": and_cond([
                    cond(rsi_ind("1D", 14), daily_op, val(daily_rsi)),
                    cond(rsi_ind("1h", 14), hourly_op, val(hourly_rsi))
                ]),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_price_percent_from_sma(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    pct = random.choice([3, 5, 7, 10])
    period = random.choice([20, 50, 100, 200])
    tp = random.choice([10, 15, 20])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        op = "<"
        multiplier = round(1 - pct / 100, 4)
        cond_texts = [
            f"price is {pct}% below the {period}-day SMA",
            f"close is {pct}% beneath SMA({period})",
        ]
    else:
        op = ">"
        multiplier = round(1 + pct / 100, 4)
        cond_texts = [
            f"price is {pct}% above the {period}-day SMA",
            f"close is {pct}% above SMA({period})",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": cond(
                    price_ind("close", 0), op,
                    arith(sma_ind(tf, period), "*", val(multiplier))
                ),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_rsi_or_stoch(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    tp = random.choice([15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    if direction == "LONG":
        rsi_threshold, stoch_threshold = random.choice([25, 30, 35]), random.choice([20, 25, 30])
        rsi_op, stoch_op = "<", "<"
        cond_texts = [
            f"RSI drops below {rsi_threshold} OR Stochastic is below {stoch_threshold}",
            f"RSI < {rsi_threshold} or Stoch < {stoch_threshold}",
        ]
    else:
        rsi_threshold, stoch_threshold = random.choice([65, 70, 75]), random.choice([70, 75, 80])
        rsi_op, stoch_op = ">", ">"
        cond_texts = [
            f"RSI rises above {rsi_threshold} OR Stochastic is above {stoch_threshold}",
        ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": or_cond([
                    cond(rsi_ind(tf, 14), rsi_op, val(rsi_threshold)),
                    cond(stoch_ind(tf), stoch_op, val(stoch_threshold))
                ]),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


def gen_breakout_volume_confirmed(direction):
    ticker_alias = random.choice(ALL_TICKER_ALIASES)
    tf_alias = random.choice(ALL_TF_ALIAS_LIST)
    tf = canonical_tf(tf_alias)
    ticker = canonical_ticker(ticker_alias)
    period = random.choice([20, 50, 100])
    vol_mult = random.choice([1.5, 2.0, 2.5])
    tp = random.choice([15, 20, 25])
    sl = random.choice([5, 7, 10])
    date_phrase, start, end = random_date()

    price_op = ">" if direction == "LONG" else "<"
    direction_word = "above" if direction == "LONG" else "below"
    cond_texts = [
        f"price {direction_word} {period}-SMA AND volume > {vol_mult}x average",
        f"breakout {direction_word} SMA({period}) confirmed by {vol_mult}x volume",
        f"price breaks {direction_word} {period}-day MA with volume spike of {vol_mult}x",
    ]

    cond_text = random.choice(cond_texts)
    text = inject_date(
        f"{opener(direction, ticker_alias)} {when(cond_text)} {tf_str(tf_alias)}, {tpsl(tp, sl)}",
        date_phrase
    )

    strategy = {
        direction: {
            "context": {"tickers": [ticker], "execution_timeframe": tf, "dateframe": {"start": start, "end": end}},
            "OPEN": {
                "CONDITIONS": and_cond([
                    cond(price_ind("close", 0), price_op, sma_ind(tf, period)),
                    cond(volume_ind(), ">", arith(sma_ind(tf, 20), "*", val(vol_mult)))
                ]),
                "ARGUMENTS": open_args(tp=tp, sl=sl)
            }
        }
    }
    return text, strategy


# ---------------- GENERATOR REGISTRY ----------------

GENERATORS = [
    # RSI - most common, highest weight
    gen_rsi_simple, gen_rsi_simple, gen_rsi_simple, gen_rsi_simple,
    # RSI with explicit close
    gen_rsi_with_close, gen_rsi_with_close, gen_rsi_with_close,
    # SMA cross
    gen_sma_price_cross, gen_sma_price_cross,
    # EMA cross
    gen_ema_cross, gen_ema_cross,
    # Golden/death cross
    gen_golden_cross,
    # Gap
    gen_gap, gen_gap,
    # MACD
    gen_macd, gen_macd,
    # MACD with close
    gen_macd_with_close,
    # Volume
    gen_volume_spike,
    # AND conditions
    gen_rsi_and_macd, gen_rsi_and_macd,
    gen_price_above_sma_and_rsi,
    gen_breakout_volume_confirmed,
    # OR conditions
    gen_rsi_or_stoch,
    # Bollinger
    gen_bollinger,
    # Mean reversion - always has close
    gen_mean_reversion,
    # Stochastic
    gen_stochastic,
    # CCI
    gen_cci,
    # OBV
    gen_obv_divergence,
    # DCA
    gen_recurring_dca,
    # Complex
    gen_triple_condition,
    gen_multi_timeframe,
    gen_price_percent_from_sma,
]

# ---------------- MAIN ----------------

def generate_dataset(num_examples=2000, output_file="training_data.jsonl"):
    examples = []
    errors = 0

    for i in range(num_examples):
        try:
            generator = random.choice(GENERATORS)
            direction = random.choice(["LONG", "SHORT"])
            text, strategy = generator(direction)

            # Apply typos to 20% of examples
            text = add_typos(text, rate=0.2)

            examples.append({
                "instruction": "Convert this trading strategy to JSON",
                "input": text,
                "output": json.dumps(strategy)
            })

        except Exception as e:
            errors += 1
            if errors < 10:
                print(f"Error on example {i}: {e}")

        if (i + 1) % 200 == 0:
            print(f"Generated {i + 1}/{num_examples}...")

    with open(output_file, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")

    print(f"\n✓ Generated {len(examples)} examples ({errors} errors)")
    print(f"✓ Saved to {output_file}")

    # Show samples
    print("\n--- 5 Random Samples ---")
    for ex in random.sample(examples, 5):
        print(f"\nInput:  {ex['input']}")
        out = json.loads(ex['output'])
        direction = "LONG" if "LONG" in out else "SHORT"
        has_close = "CLOSE" in out[direction]
        print(f"Has CLOSE: {has_close}")
        print(f"Output: {ex['output'][:150]}...")


if __name__ == "__main__":
    generate_dataset(2000)