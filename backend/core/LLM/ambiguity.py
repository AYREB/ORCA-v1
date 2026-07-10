import json
import re
from pathlib import Path

# ---------------- FIELD DETECTORS ----------------

_REGISTRY_DIR = Path(__file__).resolve().parent.parent / "registries"

# Colloquial forms users type that may not be registry aliases.
_EXTRA_TICKER_WORDS = [
    "apple", "tesla", "microsoft", "google", "alphabet", "amazon", "nvidia",
    "meta", "facebook", "bitcoin", "btc", "nasdaq", "s&p", "sp500", "spy",
]


def _build_ticker_patterns():
    """Ticker detection built from the registry so it stays in sync with what
    the platform actually supports (a hardcoded list previously recognised
    'ethereum', which isn't a supported ticker — the parse then failed)."""
    words = set(_EXTRA_TICKER_WORDS)
    try:
        with open(_REGISTRY_DIR / "tickerRegistry.json") as f:
            registry = json.load(f).get("TICKERS", {})
        for ticker, data in registry.items():
            words.add(ticker)
            for alias in data.get("aliases", []):
                words.add(alias)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    # Longest first so multi-word aliases win over substrings.
    escaped = sorted((re.escape(w) for w in words if w), key=len, reverse=True)
    return [r'\b(' + '|'.join(escaped) + r')\b'] if escaped else []


TICKER_PATTERNS = _build_ticker_patterns()

TIMEFRAME_PATTERNS = [
    r'\b(1m|5m|15m|1h|4h|1D|1d)\b',
    r'\b(one minute|five minute|fifteen minute|one hour|four hour|daily|hourly)\b',
]

DIRECTION_PATTERNS = [
    r'\b(buy|long|purchase|enter long|go long|enter a long|get long)\b',
    r'\b(sell|short|go short|enter short|fade|sell short|dump)\b',
]

# Common keyboard typos of direction words (curated: none are real English
# words that could appear innocently). The model handles these fine — the
# gate just needs to stop asking "long or short?" before it gets the chance.
_DIRECTION_TYPOS = {
    "byu", "buuy", "buyy", "bu", "buh", "bhy",           # buy
    "slel", "sel", "seell", "selll", "sll",              # sell
    "lnog", "logn", "lomg", "loong", "lonng",            # long
    "shrot", "shrt", "shortt", "sohrt", "shor", "shoort",  # short
    "purchse", "purchace", "purchas",                    # purchase
}

# "but" is a real word, so it only counts as a "buy" typo when it's directly
# followed by an asset ("but apple when...") — a conjunction almost never is.
_BUT_ASSET_RE = re.compile(r"\bbut\s+(\S+)", re.IGNORECASE)

INDICATOR_PATTERNS = [
    r'\b(RSI|MACD|SMA|EMA|bollinger|stochastic|stoch|CCI|OBV|ATR|volume|moving average|MA)\b',
]

VAGUE_THRESHOLD_PHRASES = [
    r'rsi is (low|high|oversold|overbought)',
    r'rsi (looks|seems) (low|high)',
    r'when (the )?(rsi|macd|price|volume) is (low|high|weak|strong|good|bad)',
    r'moving average (is )?(crossed|above|below)$',
    r'when (it|price|stock) (drops|rises|moves|goes)$',
]

VAGUE_TPSL_PHRASES = [
    r'\btight stop\b',
    r'\bsmall stop\b',
    r'\bwide stop\b',
    r'\breasonable (tp|take profit)\b',
    r'\bgood (tp|take profit)\b',
]

NUMBER_PATTERN = r'\b\d+\.?\d*\s*%?\b'

# Uppercase tokens that are trading vocabulary, not ticker symbols.
_NOT_TICKERS = {
    "RSI", "MACD", "SMA", "EMA", "BBANDS", "ATR", "STOCH", "CCI", "OBV",
    "PRICE", "VOLUME", "TP", "SL", "DCA", "AND", "OR", "NOT", "MA", "BB",
    "USD", "ETF", "AI", "OK", "III", "II", "IV",
}

_SYMBOL_TOKEN_RE = re.compile(r"\b\^?[A-Z]{2,6}(?:[.\-][A-Z0-9]{1,4})?(?:=X)?\b")
_FX_PAIR_RE = re.compile(r"\b[a-z]{3}/[a-z]{3}\b")


def _has_symbol_like_token(original_text):
    """Detect symbol-shaped tokens (PLTR, BRK-B, EURUSD=X) in the ORIGINAL
    (non-lowercased) text — uppercase is the signal, so this must not run on
    lowered input."""
    for tok in _SYMBOL_TOKEN_RE.findall(original_text):
        if tok not in _NOT_TICKERS:
            return True
    return False


def has_ticker(text, original_text=None):
    for p in TICKER_PATTERNS:
        if re.search(p, text, re.IGNORECASE):
            return True
    if _FX_PAIR_RE.search(text.lower()):
        return True
    if original_text and _has_symbol_like_token(original_text):
        return True
    return False

def has_timeframe(text):
    for p in TIMEFRAME_PATTERNS:
        if re.search(p, text, re.IGNORECASE):
            return True
    return False

def has_direction(text, original_text=None):
    for p in DIRECTION_PATTERNS:
        if re.search(p, text, re.IGNORECASE):
            return True
    # Typo'd direction words
    tokens = re.findall(r"[a-z]+", text.lower())
    if any(t in _DIRECTION_TYPOS for t in tokens):
        return True
    # "but <asset>" = typo of "buy <asset>"
    for m in _BUT_ASSET_RE.finditer(original_text or text):
        following = (original_text or text)[m.start(1):m.start(1) + 30]
        if has_ticker(following.lower(), original_text=following):
            return True
    return False

def has_indicator(text):
    for p in INDICATOR_PATTERNS:
        if re.search(p, text, re.IGNORECASE):
            return True
    return False

def has_specific_threshold(text):
    return bool(re.search(NUMBER_PATTERN, text))

def is_vague_threshold(text):
    for p in VAGUE_THRESHOLD_PHRASES:
        if re.search(p, text, re.IGNORECASE):
            return True
    return False

def is_vague_tpsl(text):
    for p in VAGUE_TPSL_PHRASES:
        if re.search(p, text, re.IGNORECASE):
            return True
    return False

# ---------------- CLARIFICATION QUESTIONS ----------------

CLARIFICATION_QUESTIONS = {
    "ticker": {
        "question": "Which asset would you like to trade?",
        "examples": ["AAPL", "TSLA", "BTC-USD", "NVDA", "SPY"]
    },
    "direction": {
        "question": "Would you like to go long (buy) or short (sell)?",
        "examples": ["Long", "Short"]
    },
    "timeframe": {
        "question": "Which timeframe would you like to use?",
        "examples": ["1m", "5m", "15m", "1h", "4h", "1D"]
    },
    "indicator_threshold": {
        "question": "What specific value should trigger the trade?",
        "examples": ["RSI below 30", "RSI above 70", "price above 50-SMA", "MACD > 0"]
    },
    "tp_sl": {
        "question": "What take profit and stop loss percentages would you like?",
        "examples": ["TP 15%, SL 5%", "TP 20%, SL 10%", "TP 10%, SL 3%"]
    },
}

# ---------------- MAIN FUNCTION ----------------

def detect_missing_fields(text, conversation_history=None):
    """
    Only ask for things that are genuinely impossible to infer.
    Let the LLM handle everything else.
    """
    prior_text = " ".join(
        t["content"] for t in (conversation_history or [])
        if t["role"] == "user"
    )
    original_context = f"{prior_text} {text}"
    full_context = original_context.lower()

    missing = []

    # Only ask if NO ticker anywhere in full conversation (original-case text
    # is needed to spot symbol-shaped tokens like PLTR).
    if not has_ticker(full_context, original_text=original_context):
        missing.append("ticker")

    # Only ask if NO direction anywhere in full conversation
    if not has_direction(full_context, original_text=original_context):
        missing.append("direction")

    # Only ask if user said something explicitly vague like
    # "buy when RSI is low" with NO number anywhere
    if has_indicator(full_context) and is_vague_threshold(full_context):
        if not has_specific_threshold(full_context):
            missing.append("indicator_threshold")

    # Removed: timeframe check - LLM handles this
    # Removed: tp/sl check - defaults exist, LLM handles this

    return missing

def get_next_question(missing_fields):
    """
    Return the single most important question to ask next.
    """
    if not missing_fields:
        return None

    field = missing_fields[0]
    return {
        "field": field,
        **CLARIFICATION_QUESTIONS.get(field, {
            "question": "Could you clarify that a bit more?",
            "examples": []
        })
    }

# ---------------- NON-STRATEGY DETECTION ----------------

NON_STRATEGY_PATTERNS = [
    r'^(hi|hello|hey|sup|what\'s up|howdy)[\s!?.]*$',
    r'^what (is|are|does)',
    r'^how (does|do|can)',
    r'^explain',
    r'^tell me about',
    r'^help$',
    r'^(thanks|thank you|cheers|ok|okay|cool|great|nice)[\s!?.]*$',
]

def is_non_strategy_input(text: str) -> bool:
    """Detect if input is clearly not a trading strategy"""
    cleaned = text.strip().lower()

    # Never flag if we're in a multi-turn conversation
    # (short replies like "1h", "30", "long" are valid answers)
    for pattern in NON_STRATEGY_PATTERNS:
        if re.match(pattern, cleaned, re.IGNORECASE):
            return True

    # Only flag short inputs if they contain no trading-relevant content
    if len(cleaned.split()) < 3:
        # Allow short inputs that are valid answers to clarification questions
        VALID_SHORT_REPLIES = {
            # Timeframes
            "1m", "5m", "15m", "1h", "4h", "1d", "daily", "hourly",
            # Directions
            "long", "short", "buy", "sell",
            # Common threshold answers
            "30", "70", "50", "20", "80",
        }
        
        # Check if it's a valid short reply
        if cleaned in VALID_SHORT_REPLIES:
            return False
            
        # Check if it contains a number (answering threshold question)
        if re.search(r'\d', cleaned):
            return False
            
        return True

    return False

def get_timeframe_question(available_timeframes: list = None) -> dict:
    """Get timeframe clarification question with correct available options"""
    tfs = available_timeframes or ["1m", "5m", "15m", "1h", "4h", "1D"]
    return {
        "field": "timeframe",
        "question": f"Which timeframe would you like to use?",
        "examples": tfs
    }