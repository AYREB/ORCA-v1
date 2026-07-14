"""Semantic sanity checks for user-built strategies.

Everything here guards against inputs that are syntactically valid but can
never work: conditions that are mathematically impossible (SMA < -12),
comparisons that are true on every bar (RSI > -5), and date ranges outside
what the data provider actually stores for a timeframe.

Mirrored on the frontend in frontend/src/lib/inputSanity.ts — keep in sync.
"""

from datetime import datetime, timedelta

# ---------------- INDICATOR OUTPUT RANGES ---------------- #
# (min, max) of what each indicator can mathematically produce.
# None = unbounded on that side. Indicators absent here are unconstrained.
INDICATOR_RANGES = {
    "RSI":    (0.0, 100.0),
    "STOCH":  (0.0, 100.0),
    "PRICE":  (0.0, None),   # price scale — never negative
    "SMA":    (0.0, None),
    "EMA":    (0.0, None),
    "BBANDS": (0.0, None),
    "ATR":    (0.0, None),
    "VOLUME": (0.0, None),
    # MACD / CCI / OBV are unbounded (legitimately negative) — not listed.
}

# Indicators on the 0-100 oscillator scale (for scale-mismatch warnings).
_OSCILLATORS = {"RSI", "STOCH"}
# Indicators on the price scale.
_PRICE_SCALE = {"PRICE", "SMA", "EMA", "BBANDS"}

# ---------------- TIMEFRAME HISTORY LIMITS ---------------- #
# How far back the data provider (Yahoo) actually has data, per interval.
# Conservative values so a request at the boundary still succeeds.
TIMEFRAME_MAX_HISTORY_DAYS = {
    "1m": 7,
    "5m": 55,
    "15m": 55,
    "1h": 700,
    "4h": 700,   # resampled from 1h
    "1D": 3650,
}


def max_history_days(timeframe: str) -> int:
    return TIMEFRAME_MAX_HISTORY_DAYS.get(str(timeframe), 3650)


def clamp_dateframe_for_timeframe(start: str, end: str, timeframe: str):
    """Clamp a [start, end] date range into the provider's history window.

    Returns (start, end, note). note is None when nothing changed, else a
    human-readable explanation of the adjustment.
    """
    today = datetime.now()
    limit_days = max_history_days(timeframe)
    earliest = today - timedelta(days=limit_days)

    try:
        start_dt = datetime.strptime(str(start)[:10], "%Y-%m-%d")
        end_dt = datetime.strptime(str(end)[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return start, end, None  # malformed dates are caught elsewhere

    note = None
    if end_dt > today:
        end_dt = today
        note = "end date moved to today (can't backtest the future)"
    if start_dt < earliest:
        start_dt = earliest
        note = (f"{timeframe} data only goes back ~{limit_days} days — "
                f"start date moved to {start_dt.strftime('%Y-%m-%d')}")
    if start_dt >= end_dt:
        # Degenerate after clamping (or user-provided) — give a sane window.
        start_dt = max(earliest, end_dt - timedelta(days=min(30, limit_days)))
        note = note or "start date must be before end date — adjusted"

    return start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d"), note


# ---------------- CONDITION SANITY ---------------- #

def _indicator_range(node):
    """Possible (min, max) for an operand node, or None if unknown/unbounded."""
    if not isinstance(node, dict):
        return None
    if "value" in node:
        v = node["value"]
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return (float(v), float(v))
        return None
    if "func" in node:
        return INDICATOR_RANGES.get(str(node["func"]).upper())
    if "op" in node:
        # Arithmetic on indicators — too many cases; treat as unknown.
        return None
    return None


def _scale_of(node):
    if not isinstance(node, dict) or "func" not in node:
        return None
    func = str(node["func"]).upper()
    if func in _OSCILLATORS:
        return "oscillator"
    if func in _PRICE_SCALE:
        return "price"
    return None


def _describe(node):
    if not isinstance(node, dict):
        return str(node)
    if "value" in node:
        return str(node["value"])
    if "func" in node:
        return str(node["func"]).upper()
    return "expression"


def check_condition_leaf(cond):
    """Check one {left, operator, right} leaf.

    Returns (verdict, message) where verdict is one of:
      "impossible"  — can never be true (block it)
      "always"      — true on every bar (warn)
      "mismatch"    — comparing incompatible scales (warn)
      None          — fine
    """
    left, right = cond.get("left"), cond.get("right")
    op = cond.get("operator")
    if op not in (">", "<", ">=", "<="):
        return None, None

    lr, rr = _indicator_range(left), _indicator_range(right)
    lname, rname = _describe(left), _describe(right)

    if lr is not None and rr is not None:
        lmin, lmax = lr
        rmin, rmax = rr

        # can the comparison EVER be true?
        if op in (">", ">="):
            # need some left value above some right value
            possible = (lmax is None) or (rmin is None) or (lmax > rmin) or (op == ">=" and lmax == rmin)
            # is it ALWAYS true?
            always = (lmin is not None and rmax is not None
                      and (lmin > rmax or (op == ">=" and lmin >= rmax)))
        else:  # "<", "<="
            possible = (lmin is None) or (rmax is None) or (lmin < rmax) or (op == "<=" and lmin == rmax)
            always = (lmax is not None and rmin is not None
                      and (lmax < rmin or (op == "<=" and lmax <= rmin)))

        if not possible:
            return "impossible", (
                f"'{lname} {op} {rname}' can never be true — "
                f"{lname} stays within {_range_text(lr)}."
            )
        if always:
            return "always", (
                f"'{lname} {op} {rname}' is true on every bar — "
                f"the strategy would trigger immediately, on every candle."
            )

    # Scale mismatch: oscillator vs price-scale indicator
    ls, rs = _scale_of(left), _scale_of(right)
    if ls and rs and ls != rs:
        return "mismatch", (
            f"'{lname}' ({ls} scale) is being compared to '{rname}' ({rs} scale) — "
            f"these use very different number ranges, so this is usually a mistake."
        )

    return None, None


def _range_text(r):
    lo, hi = r
    if lo is not None and hi is not None:
        if lo == hi:
            return f"exactly {lo:g}"
        return f"{lo:g}–{hi:g}"
    if lo is not None:
        return f"{lo:g} or above"
    return f"{hi:g} or below"


def check_conditions(cond):
    """Walk a CONDITIONS tree. Returns (impossible: list[str], warnings: list[str])."""
    impossible, warnings = [], []

    def walk(node):
        if not isinstance(node, dict):
            return
        if "AND" in node:
            for c in node["AND"]:
                walk(c)
            return
        if "OR" in node:
            for c in node["OR"]:
                walk(c)
            return
        verdict, msg = check_condition_leaf(node)
        if verdict == "impossible":
            impossible.append(msg)
        elif verdict in ("always", "mismatch"):
            warnings.append(msg)

    walk(cond or {})
    return impossible, warnings


def check_strategy(parsed_dsl):
    """Full-strategy sanity check.

    Returns (blockers, warnings) — blockers should stop the backtest with a
    clear message; warnings should be surfaced but not block.
    """
    blockers, warnings = [], []
    direction = "LONG" if "LONG" in parsed_dsl else "SHORT"
    body = parsed_dsl.get(direction, {}) or {}

    for block_name in ("OPEN", "CLOSE"):
        conds = (body.get(block_name) or {}).get("CONDITIONS")
        if not conds:
            continue
        imp, warn = check_conditions(conds)
        blockers += [f"{block_name}: {m}" for m in imp]
        warnings += [f"{block_name}: {m}" for m in warn]

    # DCA configured but sized to do nothing
    args = (body.get("OPEN") or {}).get("ARGUMENTS") or {}
    if args.get("recurring"):
        try:
            if float(args.get("recurringInvestAmount") or 0) <= 0:
                warnings.append("Recurring buys are enabled but the recurring amount is 0 — no recurring entries will happen.")
        except (TypeError, ValueError):
            pass

    # Duplicate tickers
    ctx = body.get("context") or {}
    tickers = ctx.get("tickers") or []
    if len(tickers) != len(set(tickers)):
        warnings.append("Duplicate tickers in the list — each ticker is only tested once.")

    return blockers, warnings
