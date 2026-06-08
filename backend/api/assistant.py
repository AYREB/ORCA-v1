import json
import logging
import math
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd
from django.conf import settings

logger = logging.getLogger(__name__)


STRATEGY_ASSISTANT_INSTRUCTIONS = """
You are Orca's proprietary trading strategy assistant for a backtesting product.

Your role:
- Help users understand markets, indicators, trade setup quality, and backtest design.
- Review the read-only strategy context provided by Orca.
- Explain the likely trade thesis, what would need to be true for it to work, and what could break it.
- Identify missing assumptions, weak exits, risk/reward problems, sizing issues, cost sensitivity, and overfitting risks.
- Suggest testable builder-level changes in plain language only. Never claim you changed the strategy.

Financial analysis checklist:
- Classify the setup before advising: long/short, trend-following vs mean-reversion vs breakout, timeframe, ticker set, and holding-period implications.
- Evaluate entry logic, exit logic, position sizing, take-profit/stop-loss balance, spread/slippage sensitivity, and whether the signal needs regime, volatility, volume, or trend confirmation.
- When Orca provides cached market-data statistics for the selected ticker/timeframe, use those numbers to suggest reasonable backtest parameter ranges. Explain them as volatility-derived starting points, not guarantees.
- Use practical concepts when relevant: expectancy, break-even win rate, reward/risk, drawdown, risk of ruin, liquidity, gap risk, correlation, market regime, benchmark comparison, walk-forward testing, out-of-sample testing, Monte Carlo, and parameter sensitivity.
- Prefer specific next tests over generic advice: timeframe variants, date-range regimes, ticker baskets, spread stress tests, parameter sweeps, baseline comparisons, and trade-count checks.
- Treat Orca's derived strategy brief as the primary summary, then use raw JSON only for extra detail. If they conflict, raw JSON is the source of truth.

Strict boundaries:
- You cannot edit, save, run, or place trades.
- You do not give personalized investment advice or instructions to buy/sell a real security.
- You do not promise profitability.
- You treat the strategy context as draft backtest data, not live market data, news, filings, or current quotes.
- If the user asks for a direct trade recommendation, redirect to educational backtesting considerations.

Response style:
- Answer the user's actual question first. Do not force a fixed template onto every reply.
- Use the strategy brief and market statistics as background evidence, but do not dump every available metric.
- If the user asks a narrow question, answer narrowly in plain language and include only the numbers that matter.
- If the user asks for values to try, give concrete starting ranges and say why they are reasonable for the selected ticker/timeframe.
- Use markdown naturally when it improves readability: short paragraphs, bullets, and bold labels are fine.
- Do not use canned section headings such as Snapshot, Risk, Suggestions, or Next tests unless the user explicitly asks for a full structured review.
- Be conversational, concise, specific, and practical. Avoid robotic sectioning unless it improves the answer.
- Mention which part of the current strategy you are referencing when that helps.
- Ask at most one clarifying question only if the context is missing a critical detail; otherwise make a reasonable assumption from the Orca context.
""".strip()


INDICATOR_ASSISTANT_INSTRUCTIONS_HEADER = """
You are Orca's Custom Indicator assistant.

Your role:
- Help users translate a trading idea into a custom indicator that fits Orca's rigid contract: `def calculate(data, context, **params): ... return result`.
- **`result` is always a plain number — `int`/`float`, or `float("nan")` when undefined — never a string, bool, or label.** This is the single most common way drafted indicators fail the gate, especially for "signal"-shaped ideas (Bollinger Band breakout, crossover, regime flag, ...): the instinct is to write `result = "buy"` / `"sell"` / `True`, but that's a *strategy condition's* shape, not an *indicator's*. An indicator must always collapse to one number. Translate signal ideas into a number that preserves the same information instead — e.g. `result = 1.0` when the bullish condition holds and `-1.0` when the bearish one does (then a strategy can write `MyBandSignal(...) > 0`), or — usually better — a continuous reading such as `(close - lower_band) / (upper_band - lower_band)` that *is* the thing the signal is based on, so the strategy can threshold it however it likes. If you ever catch yourself about to write a quoted word or `True`/`False` into `result`, stop and pick a numeric encoding instead.
- Read the user's current draft (name, description, declared parameters, code body, and the most recent compiler/tester result if present) and explain it, suggest improvements, or help debug a failing run.
- Treat the reference guide below as the source of truth for the data/context/params shapes, what's allowed in the sandbox, and how the compiler/tester works — point users to the specific part of it that answers their question.

Strict boundaries:
- You cannot write to, edit, compile, run, test, or save the user's indicator — including its declared parameters. The draft (name, description, parameters, code, last test result) is read-only context.
- You may draft example code in your reply as plain text to illustrate an idea, but make clear the user has to paste/adapt it into the editor and run the tester themselves — never claim you applied or tested anything.
- You can discuss and suggest changes to the declared parameters too — e.g. propose renaming one, adding a new one the logic needs, or dropping one that's unused — but you cannot apply them yourself; tell the user to edit the Parameters panel directly, or switch to **Agent** mode, which writes the code and updates the parameter list together.
- If the user reports a compiler/tester error, address that exact error and explain the most likely fix.

Response style:
- Be concise, concrete, and practical. Short code snippets are welcome when they clarify a point.
- Use markdown naturally: short paragraphs, bullets, and inline code are fine. Avoid forcing a fixed template onto every reply.
- Mention which part of the draft (name, a parameter, a specific line of logic) you're referencing when that helps.
""".strip()


INDICATOR_AGENT_INSTRUCTIONS_HEADER = """
You are Orca's Custom Indicator agent.

Your role:
- Write or rewrite the BODY of the user's custom indicator on request, so it can be applied directly into the editor and fits Orca's rigid contract: `def calculate(data, context, **params): ... return result`.
- **`result` must always end up a plain number — `int`/`float`, or `float("nan")` when undefined — NEVER a string, bool, or label.** This is the #1 reason applied code fails the gate. The trap: when a user describes a "signal" idea (a Bollinger Band breakout, a crossover, a regime flag, a buy/sell rule, ...), it's tempting to write `result = "buy"` / `"sell"` / `True` / `False` — DON'T. That is a *strategy condition's* shape (what the user compares the indicator's output *against*), not the indicator's own output. Always translate the idea into a number that carries the same meaning instead: either a discrete encoding (`result = 1.0` for the bullish case, `-1.0` for the bearish one, `0.0`/`float("nan")` for neither — so a strategy can later write `MyBandSignal(...) > 0`), or — generally the better, more useful indicator — a continuous reading that *is* the underlying measurement, e.g. `result = (close - lower_band) / (upper_band - lower_band)` for "where is price within the bands, as a fraction." Before you finish, scan your own draft for `result = "`, `result = True`, `result = False` — if you see any, rewrite that branch numerically.
- Read the user's current draft (name, description, declared parameters, code body, and the most recent compiler/tester result if present) before writing, and build on it rather than ignoring it.
- When the body you write needs a declared parameter that doesn't exist yet, or stops needing one that does (you renamed `period` to `lookback`, dropped `multiplier`, added `smoothing`, ...), update the declared parameter list to match — see "Managing declared parameters" below. Keep the body and the declared list in sync: never leave the body reading a parameter you didn't declare, or a declared parameter the body never reads.

Output contract — follow this exactly, every time you write or change code:
- Give a short explanation (1-3 sentences) of what the code does or what you changed, then exactly one fenced ```python code block — and, only when the declared parameters need to change, exactly one fenced ```json code block immediately after it (see "Managing declared parameters").
- The python code block must contain ONLY the function body — never the `def calculate(data, context, **params):` line and never a `return` line. Orca adds those automatically and applies your block as a straight replacement of the body.
- The body must finish by assigning the indicator's final value to a variable named `result`, and it must be numeric — a plain `int`/`float`, or `float("nan")` when undefined (e.g. not enough lookback yet). **Never** a string (`"buy"`, `"sell"`, `"bullish"`, ...), a `bool` (`True`/`False`), or anything else — see the numeric-result rule under "Your role" above; re-read your own draft for a quoted or boolean `result` assignment before you output it. Do not write `return` yourself.
- You may use `data` (an OHLCV pandas DataFrame with Open/High/Low/Close/Volume columns), `context` (`{"i": <integer index of the current candle>}`), `params` (the declared parameters dict — read with `params.get("name", default)`), plus `pd`, `np`, `math`, and ordinary safe builtins. No imports, no file/network/system access, no eval/exec/dunder access — the sandbox rejects all of that.
- Never read `data` beyond `context["i"]` — that is lookahead bias and the whole point of `context["i"]` is to prevent it.
- Output exactly one python code block per reply, and at most one json block. Orca takes the last block of each kind in your message and applies it straight into the editor — don't show multiple alternatives, pick the best one.

Managing declared parameters:
- The optional ```json block must be a JSON array holding the *complete*, intended parameter list — e.g. `[{"name": "lookback", "default": 20}, {"name": "smoothing", "default": 2}]`. Orca replaces the whole declared list with it (a straight replacement, not a diff/patch): include every parameter the rewritten body needs — the ones you kept and any new ones — and simply leave out any you renamed away from or removed.
- Each entry needs a `name` that is a valid, unique Python identifier and is NOT one of the reserved words `data, context, params, self, result, calculate, ticker, timeframe, offset` (these collide with the function contract or the DSL operand mechanism and are rejected at save time), and a `default` that is a plain number or short string.
- Only emit the json block when the parameter list actually needs to change. If your rewritten body uses exactly the same declared parameter names as before, omit it — Orca leaves the declared list untouched in that case.

Strict boundaries:
- You cannot run the compiler/tester or save the indicator yourself. After your code (and parameters, if you changed them) are applied, remind the user (briefly) to run the tester.
- If the request is ambiguous, make the most reasonable assumption, write working code for it, and note the assumption in one short clause — don't block on a clarifying question.

Response style:
- Be concise: lead with what you wrote or changed and why, then the code block(s). Skip filler.
""".strip()


INDICATOR_KNOWLEDGE: dict[str, dict[str, str]] = {
    "PRICE": {
        "family": "Price action",
        "typical_use": "Compare raw OHLC price levels or offsets.",
        "watchout": "Raw price rules often need context such as trend, volatility, or support/resistance.",
    },
    "VOLUME": {
        "family": "Volume",
        "typical_use": "Confirm participation behind a move.",
        "watchout": "Volume behaves differently across assets and sessions; compare against a moving baseline.",
    },
    "SMA": {
        "family": "Trend",
        "typical_use": "Smooth price to identify trend direction or moving-average crossovers.",
        "watchout": "Lagging signal; whipsaws in sideways markets.",
    },
    "EMA": {
        "family": "Trend",
        "typical_use": "Trend and momentum filter that reacts faster than SMA.",
        "watchout": "More reactive, so it can overtrade in noisy timeframes.",
    },
    "RSI": {
        "family": "Momentum",
        "typical_use": "Spot overbought/oversold momentum or mean-reversion zones.",
        "watchout": "Can stay extreme in strong trends; works better with a trend/regime filter.",
    },
    "MACD": {
        "family": "Momentum",
        "typical_use": "Measure trend momentum and changes in moving-average convergence.",
        "watchout": "Lagging and parameter-sensitive; confirm on multiple regimes.",
    },
    "BBANDS": {
        "family": "Volatility",
        "typical_use": "Measure relative price stretch and volatility envelopes.",
        "watchout": "Band touches alone do not distinguish breakout from mean reversion.",
    },
    "ATR": {
        "family": "Volatility",
        "typical_use": "Estimate current volatility for stops, targets, or filters.",
        "watchout": "ATR is not direction-aware; pair it with entry logic.",
    },
    "STOCH": {
        "family": "Momentum",
        "typical_use": "Identify short-term momentum extremes within a recent range.",
        "watchout": "Noisy on low timeframes without trend or volume confirmation.",
    },
    "CCI": {
        "family": "Momentum",
        "typical_use": "Measure deviation from a typical price average.",
        "watchout": "Sensitive to lookback choice and volatility regime.",
    },
    "OBV": {
        "family": "Volume",
        "typical_use": "Check whether volume flow confirms price direction.",
        "watchout": "Can diverge for long periods; avoid using it as the only trigger.",
    },
}


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _round(value: float | None, digits: int = 2) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def _safe_text(value: Any, fallback: str = "unknown") -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _parse_iso_date(value: Any) -> date | None:
    if not isinstance(value, str) or len(value) < 10:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _date_range_days(start: Any, end: Any) -> int | None:
    start_date = _parse_iso_date(start)
    end_date = _parse_iso_date(end)
    if start_date is None or end_date is None:
        return None
    return max((end_date - start_date).days, 0)


def _timeframe_note(timeframe: Any) -> str | None:
    text = _safe_text(timeframe, "").lower()
    if not text:
        return None
    if text.endswith("m"):
        return "Intraday minute strategy: noise, spread, slippage, session effects, and trade count matter more."
    if text.endswith("h"):
        return "Intraday/hourly strategy: watch overnight gaps, regime shifts, and whether exits match holding period."
    if text in {"1d", "d", "day", "daily"}:
        return "Daily strategy: use multi-year regimes, benchmark comparison, and drawdown checks."
    if text.endswith("wk") or text.endswith("w"):
        return "Weekly strategy: sample size may be low, so parameter robustness matters."
    return None


def _market_data_dir() -> Path:
    default_dir = Path(getattr(settings, "BASE_DIR", Path.cwd())) / "core" / "data_csvs"
    return Path(getattr(settings, "ORCA_ASSISTANT_MARKET_DATA_DIR", default_dir))


def _is_safe_filename_part(value: str) -> bool:
    return bool(value) and "/" not in value and "\\" not in value and ".." not in value


def _available_cached_timeframes(ticker: str) -> list[str]:
    if not _is_safe_filename_part(ticker):
        return []

    data_dir = _market_data_dir()
    if not data_dir.exists():
        return []

    ticker_forms = {ticker, ticker.upper()}
    timeframes: set[str] = set()
    for path in data_dir.iterdir():
        if not path.is_file() or path.suffix.lower() != ".csv":
            continue
        for ticker_form in ticker_forms:
            prefix = f"{ticker_form}_"
            if path.stem.startswith(prefix):
                timeframe = path.stem[len(prefix) :]
                if timeframe:
                    timeframes.add(timeframe)
    return sorted(timeframes)


def _market_csv_path(ticker: str, timeframe: str) -> Path | None:
    if not _is_safe_filename_part(ticker) or not _is_safe_filename_part(timeframe):
        return None

    data_dir = _market_data_dir()
    candidate_names = [
        f"{ticker}_{timeframe}.csv",
        f"{ticker.upper()}_{timeframe}.csv",
        f"{ticker}.csv",
        f"{ticker.upper()}.csv",
    ]
    for name in dict.fromkeys(candidate_names):
        candidate = data_dir / name
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _parse_market_datetime(value: Any) -> pd.Timestamp | None:
    if not value:
        return None

    parsed = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.tz_convert(None)


def _load_market_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    if df.empty:
        return df

    df = df.rename(columns={column: str(column).strip() for column in df.columns})
    datetime_column = next((column for column in ("Datetime", "Date", "index") if column in df.columns), None)
    if datetime_column:
        parsed_dates = pd.to_datetime(df[datetime_column], utc=True, errors="coerce")
        valid_dates = parsed_dates.notna()
        df = df.loc[valid_dates].copy()
        if df.empty:
            return df
        df.index = parsed_dates.loc[valid_dates].dt.tz_convert(None)

    for column in ("Open", "High", "Low", "Close", "Adj Close", "Volume"):
        if column in df.columns:
            df[column] = pd.to_numeric(df[column], errors="coerce")

    if "Close" in df.columns:
        df = df.dropna(subset=["Close"])

    return df.sort_index()


def _clip_market_data(df: pd.DataFrame, start_value: Any, end_value: Any) -> pd.DataFrame:
    if df.empty or not isinstance(df.index, pd.DatetimeIndex):
        return df

    clipped = df
    start_at = _parse_market_datetime(start_value)
    end_at = _parse_market_datetime(end_value)

    if start_at is not None:
        clipped = clipped[clipped.index >= start_at]
    if end_at is not None:
        if isinstance(end_value, str) and len(end_value) == 10:
            clipped = clipped[clipped.index < end_at]
        else:
            clipped = clipped[clipped.index <= end_at]

    return clipped


def _numeric_series(df: pd.DataFrame, column: str) -> pd.Series:
    if column not in df.columns:
        return pd.Series(dtype="float64")
    return pd.to_numeric(df[column], errors="coerce").dropna()


def _latest(series: pd.Series) -> float | None:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return None
    return float(clean.iloc[-1])


def _percentile_rank(series: pd.Series, value: float | None) -> float | None:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty or value is None:
        return None
    return float((clean <= value).mean() * 100)


def _series_stats(series: pd.Series, digits: int = 2) -> dict[str, float | None]:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return {"latest": None, "mean": None, "median": None, "min": None, "max": None}

    return {
        "latest": _round(float(clean.iloc[-1]), digits),
        "mean": _round(float(clean.mean()), digits),
        "median": _round(float(clean.median()), digits),
        "min": _round(float(clean.min()), digits),
        "max": _round(float(clean.max()), digits),
    }


def _compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).rolling(period, min_periods=period).mean()
    rs = gain / loss.where(loss != 0)
    return 100 - (100 / (1 + rs))


def _compute_atr_percent(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = _numeric_series(df, "High")
    low = _numeric_series(df, "Low")
    close = _numeric_series(df, "Close")
    if high.empty or low.empty or close.empty:
        return pd.Series(dtype="float64")

    aligned = pd.concat({"high": high, "low": low, "close": close}, axis=1).dropna()
    previous_close = aligned["close"].shift(1)
    true_range = pd.concat(
        [
            aligned["high"] - aligned["low"],
            (aligned["high"] - previous_close).abs(),
            (aligned["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = true_range.rolling(period, min_periods=min(period, max(len(true_range), 1))).mean()
    return atr / aligned["close"] * 100


def _trend_state(latest_close: float | None, sma20: float | None, sma50: float | None, sma200: float | None) -> str:
    if latest_close is None:
        return "unknown"
    if sma50 is not None and sma200 is not None:
        if latest_close > sma50 > sma200:
            return "uptrend"
        if latest_close < sma50 < sma200:
            return "downtrend"
    if sma20 is not None and sma50 is not None:
        if latest_close > sma20 > sma50:
            return "short-term uptrend"
        if latest_close < sma20 < sma50:
            return "short-term downtrend"
    return "mixed or range-bound"


def _market_parameter_suggestions(
    *,
    atr_percent: float | None,
    mean_abs_return_percent: float | None,
    rsi: pd.Series,
    row_count: int,
) -> dict[str, Any]:
    base_move = atr_percent or mean_abs_return_percent
    stop_loss_candidates = []
    take_profit_candidates = []
    if base_move is not None and base_move > 0:
        stop_loss_candidates = [_round(base_move * multiplier, 2) for multiplier in (1.0, 1.5, 2.0)]
        take_profit_candidates = [_round(base_move * multiplier, 2) for multiplier in (1.5, 2.0, 3.0)]

    rsi_clean = pd.to_numeric(rsi, errors="coerce").dropna()
    rsi_thresholds: dict[str, float | None] = {
        "long_mean_reversion_entry": None,
        "long_momentum_exit": None,
        "short_mean_reversion_entry": None,
        "short_momentum_exit": None,
    }
    if not rsi_clean.empty:
        rsi_thresholds = {
            "long_mean_reversion_entry": _round(float(min(45, max(10, rsi_clean.quantile(0.20))))),
            "long_momentum_exit": _round(float(max(55, min(90, rsi_clean.quantile(0.80))))),
            "short_mean_reversion_entry": _round(float(max(55, min(90, rsi_clean.quantile(0.80))))),
            "short_momentum_exit": _round(float(min(45, max(10, rsi_clean.quantile(0.20))))),
        }

    candidate_periods = [period for period in (5, 10, 20, 50, 100, 200) if row_count >= period + 5]
    return {
        "volatility_based_stop_loss_percent_tests": stop_loss_candidates,
        "volatility_based_take_profit_percent_tests": take_profit_candidates,
        "rsi_threshold_tests": rsi_thresholds,
        "moving_average_period_tests": candidate_periods,
    }


def _strategy_bias_from_market_stats(trend_state: str, atr_percent: float | None) -> list[str]:
    ideas: list[str] = []
    if "uptrend" in trend_state:
        ideas.append("Trend-following or pullback-long tests may fit the current cached trend state.")
    elif "downtrend" in trend_state:
        ideas.append("Short-side or defensive trend-filter tests may fit the current cached trend state.")
    else:
        ideas.append("Mean-reversion and range-filter tests may be more relevant while trend state is mixed.")

    if atr_percent is not None:
        if atr_percent >= 3:
            ideas.append("ATR is elevated; test wider stops/targets and check gap or slippage sensitivity.")
        elif atr_percent <= 0.75:
            ideas.append("ATR is tight; small targets may be plausible, but execution costs can dominate.")
    return ideas


def _summarize_market_csv(ticker: str, timeframe: str, markets: dict[str, Any]) -> dict[str, Any]:
    available_timeframes = _available_cached_timeframes(ticker)
    path = _market_csv_path(ticker, timeframe)
    base_summary = {
        "ticker": ticker,
        "timeframe": timeframe,
        "available_cached_timeframes": available_timeframes,
    }
    if path is None:
        return {
            **base_summary,
            "status": "unavailable",
            "reason": "No cached CSV found for the selected ticker and timeframe.",
        }

    try:
        raw_df = _load_market_csv(path)
    except (OSError, ValueError, pd.errors.ParserError) as exc:
        return {**base_summary, "status": "unavailable", "reason": f"Unable to read cached CSV: {exc}"}

    if raw_df.empty or "Close" not in raw_df.columns:
        return {**base_summary, "status": "unavailable", "reason": "Cached CSV has no usable Close price rows."}

    df = _clip_market_data(raw_df, markets.get("dateStart"), markets.get("dateEnd"))
    if df.empty:
        return {
            **base_summary,
            "status": "unavailable",
            "reason": "Cached CSV has no rows inside the selected date range.",
            "cached_rows": int(len(raw_df)),
            "cached_start": str(raw_df.index.min()) if isinstance(raw_df.index, pd.DatetimeIndex) else None,
            "cached_end": str(raw_df.index.max()) if isinstance(raw_df.index, pd.DatetimeIndex) else None,
        }

    close = _numeric_series(df, "Close")
    open_prices = _numeric_series(df, "Open")
    high = _numeric_series(df, "High")
    low = _numeric_series(df, "Low")
    volume = _numeric_series(df, "Volume")
    returns = close.pct_change().dropna() * 100
    rsi = _compute_rsi(close)
    atr_percent = _compute_atr_percent(df)
    latest_close = _latest(close)
    latest_atr_percent = _latest(atr_percent)
    sma20 = _latest(close.rolling(20).mean()) if len(close) >= 20 else None
    sma50 = _latest(close.rolling(50).mean()) if len(close) >= 50 else None
    sma200 = _latest(close.rolling(200).mean()) if len(close) >= 200 else None
    trend_state = _trend_state(latest_close, sma20, sma50, sma200)

    first_close = float(close.iloc[0]) if not close.empty else None
    total_return = ((latest_close - first_close) / first_close * 100) if latest_close is not None and first_close else None
    high_low_range = ((high - low) / close * 100).dropna() if not high.empty and not low.empty else pd.Series(dtype="float64")
    open_close_move = ((close - open_prices) / open_prices * 100).dropna() if not open_prices.empty else pd.Series(dtype="float64")
    latest_volume = _latest(volume)

    return {
        **base_summary,
        "status": "available",
        "source_file": path.name,
        "rows_used": int(len(df)),
        "date_range_used": {
            "start": str(df.index.min()) if isinstance(df.index, pd.DatetimeIndex) else None,
            "end": str(df.index.max()) if isinstance(df.index, pd.DatetimeIndex) else None,
        },
        "price_action": {
            "first_close": _round(first_close),
            "latest_close": _round(latest_close),
            "period_return_percent": _round(total_return),
            "highest_high": _round(float(high.max()) if not high.empty else None),
            "lowest_low": _round(float(low.min()) if not low.empty else None),
        },
        "column_summary": {
            "Open": _series_stats(open_prices),
            "High": _series_stats(high),
            "Low": _series_stats(low),
            "Close": _series_stats(close),
            "Volume": _series_stats(volume, digits=0),
        },
        "volatility": {
            "atr_14_percent_latest": _round(latest_atr_percent),
            "bar_return_mean_percent": _round(float(returns.mean()) if not returns.empty else None),
            "bar_return_std_percent": _round(float(returns.std()) if len(returns) > 1 else None),
            "mean_absolute_bar_return_percent": _round(float(returns.abs().mean()) if not returns.empty else None),
            "median_high_low_range_percent": _round(float(high_low_range.median()) if not high_low_range.empty else None),
            "median_open_close_move_percent": _round(float(open_close_move.abs().median()) if not open_close_move.empty else None),
        },
        "indicators": {
            "rsi_14_latest": _round(_latest(rsi)),
            "rsi_14_20th_percentile": _round(float(rsi.dropna().quantile(0.20)) if not rsi.dropna().empty else None),
            "rsi_14_80th_percentile": _round(float(rsi.dropna().quantile(0.80)) if not rsi.dropna().empty else None),
            "sma_20_latest": _round(sma20),
            "sma_50_latest": _round(sma50),
            "sma_200_latest": _round(sma200),
            "latest_close_vs_sma_20_percent": _round((latest_close - sma20) / sma20 * 100 if latest_close and sma20 else None),
            "latest_close_vs_sma_50_percent": _round((latest_close - sma50) / sma50 * 100 if latest_close and sma50 else None),
            "latest_close_vs_sma_200_percent": _round((latest_close - sma200) / sma200 * 100 if latest_close and sma200 else None),
            "trend_state": trend_state,
        },
        "volume": {
            "latest_volume": _round(latest_volume, 0),
            "average_volume": _round(float(volume.mean()) if not volume.empty else None, 0),
            "latest_volume_percentile": _round(_percentile_rank(volume, latest_volume)),
        },
        "parameter_suggestions": _market_parameter_suggestions(
            atr_percent=latest_atr_percent,
            mean_abs_return_percent=float(returns.abs().mean()) if not returns.empty else None,
            rsi=rsi,
            row_count=len(df),
        ),
        "strategy_ideas": _strategy_bias_from_market_stats(trend_state, latest_atr_percent),
    }


def build_market_data_summary(markets: dict[str, Any]) -> list[dict[str, Any]]:
    tickers = [str(ticker).strip() for ticker in _as_list(markets.get("tickers")) if str(ticker).strip()]
    timeframe = _safe_text(markets.get("executionTimeframe"), "1h")
    max_tickers = int(getattr(settings, "ORCA_ASSISTANT_MARKET_DATA_MAX_TICKERS", 3))
    return [_summarize_market_csv(ticker, timeframe, markets) for ticker in tickers[:max_tickers]]


def _cached_market_data_is_usable(ticker: str, timeframe: str, markets: dict[str, Any]) -> bool:
    path = _market_csv_path(ticker, timeframe)
    if path is None:
        return False

    try:
        raw_df = _load_market_csv(path)
    except (OSError, ValueError, pd.errors.ParserError):
        return False

    if raw_df.empty or "Close" not in raw_df.columns:
        return False

    return not _clip_market_data(raw_df, markets.get("dateStart"), markets.get("dateEnd")).empty


def _fetch_market_data_to_cache(ticker: str, timeframe: str, markets: dict[str, Any]) -> dict[str, Any]:
    start = _safe_text(markets.get("dateStart"), "")
    end = _safe_text(markets.get("dateEnd"), "")
    if not start or not end:
        return {
            "ticker": ticker,
            "timeframe": timeframe,
            "status": "unavailable",
            "reason": "A start and end date are required before Orca can prepare market-data cache.",
        }

    data_dir = _market_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    try:
        from core.data_pulling import datapull

        df = datapull.get_data_with_indicator(
            ticker=ticker,
            start=start,
            end=end,
            interval=timeframe,
            save_path=str(data_dir),
        )
    except Exception as exc:  # pragma: no cover - exact yfinance failures vary by environment
        logger.info("Unable to prepare assistant market data for %s %s: %s", ticker, timeframe, exc)
        return {
            "ticker": ticker,
            "timeframe": timeframe,
            "status": "unavailable",
            "reason": f"Unable to prepare cached market data: {exc}",
        }

    path = _market_csv_path(ticker, timeframe)
    if (df is None or df.empty) and path is None:
        return {
            "ticker": ticker,
            "timeframe": timeframe,
            "status": "unavailable",
            "reason": "Market-data provider returned no rows for the selected range.",
        }

    if not _cached_market_data_is_usable(ticker, timeframe, markets):
        return {
            "ticker": ticker,
            "timeframe": timeframe,
            "status": "unavailable",
            "source_file": path.name if path else None,
            "reason": "Market-data provider returned no usable rows for the selected range.",
        }

    return {
        "ticker": ticker,
        "timeframe": timeframe,
        "status": "cache_warmed",
        "source_file": path.name if path else f"{ticker}_{timeframe}.csv",
        "rows": int(len(df)) if df is not None else None,
    }


def prepare_strategy_market_data(markets: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(markets, dict):
        raise AssistantError("markets must be a JSON object.")

    tickers = [str(ticker).strip() for ticker in _as_list(markets.get("tickers")) if str(ticker).strip()]
    timeframe = _safe_text(markets.get("executionTimeframe"), "1h")
    max_tickers = int(getattr(settings, "ORCA_ASSISTANT_MARKET_DATA_MAX_TICKERS", 3))

    results: list[dict[str, Any]] = []
    for ticker in tickers[:max_tickers]:
        base = {"ticker": ticker, "timeframe": timeframe}
        if not _is_safe_filename_part(ticker) or not _is_safe_filename_part(timeframe):
            results.append({**base, "status": "unavailable", "reason": "Ticker or timeframe is not safe for cache filenames."})
            continue

        if _cached_market_data_is_usable(ticker, timeframe, markets):
            path = _market_csv_path(ticker, timeframe)
            results.append({**base, "status": "already_cached", "source_file": path.name if path else None})
            continue

        results.append(_fetch_market_data_to_cache(ticker, timeframe, markets))

    return results


def _compact_json(value: Any, max_chars: int = 160) -> str:
    try:
        text = json.dumps(value, sort_keys=True)
    except TypeError:
        text = str(value)
    return text if len(text) <= max_chars else f"{text[: max_chars - 3]}..."


def _describe_side(node: Any) -> str:
    if not isinstance(node, dict):
        return _compact_json(node)

    node_type = node.get("type")
    if node_type == "value" or "value" in node and "func" not in node:
        return str(node.get("value"))

    func = node.get("func")
    if isinstance(func, str) and func.strip():
        args = _as_dict(node.get("args") if "args" in node else node.get("arg"))
        if args:
            arg_text = ", ".join(f"{key}={value}" for key, value in sorted(args.items()))
            base = f"{func.upper()}({arg_text})"
        else:
            base = func.upper()
    else:
        base = _compact_json(node)

    operation = _as_dict(node.get("operation"))
    if operation:
        operator = operation.get("operator")
        operand = operation.get("operand")
        if operator and operand is not None:
            return f"{base} {operator} {operand}"

    if node.get("op") and node.get("left") is not None and node.get("right") is not None:
        return f"{_describe_side(node.get('left'))} {node.get('op')} {_describe_side(node.get('right'))}"

    return base


def _describe_condition(condition: Any) -> str:
    if not isinstance(condition, dict):
        return _compact_json(condition)
    if "AND" in condition:
        return " AND ".join(_describe_condition(item) for item in _as_list(condition.get("AND")))
    if "OR" in condition:
        return " OR ".join(_describe_condition(item) for item in _as_list(condition.get("OR")))

    left = _describe_side(condition.get("left"))
    operator = condition.get("operator", "?")
    right = _describe_side(condition.get("right"))
    return f"{left} {operator} {right}"


def _condition_summaries(conditions: Any, max_items: int = 5) -> list[str]:
    condition_list = _as_list(conditions)
    summaries = [_describe_condition(condition) for condition in condition_list[:max_items]]
    if len(condition_list) > max_items:
        summaries.append(f"...plus {len(condition_list) - max_items} more")
    return summaries


def _collect_indicator_names(node: Any) -> set[str]:
    names: set[str] = set()
    if isinstance(node, dict):
        func = node.get("func")
        if isinstance(func, str) and func.strip():
            names.add(func.strip().upper())
        for value in node.values():
            names.update(_collect_indicator_names(value))
    elif isinstance(node, list):
        for item in node:
            names.update(_collect_indicator_names(item))
    return names


def _indicator_brief(strategy_context: dict[str, Any]) -> list[dict[str, str]]:
    names = sorted(_collect_indicator_names(strategy_context))
    brief: list[dict[str, str]] = []
    for name in names:
        meta = INDICATOR_KNOWLEDGE.get(name)
        if meta:
            brief.append({"name": name, **meta})
        else:
            brief.append(
                {
                    "name": name,
                    "family": "Custom/unknown",
                    "typical_use": "Review the raw condition to infer intent.",
                    "watchout": "Unknown indicators need extra validation and parameter sensitivity checks.",
                }
            )
    return brief


def _risk_math(risk_management: dict[str, Any]) -> dict[str, Any]:
    take_profit = _as_float(risk_management.get("takeProfitPercent"))
    stop_loss = _as_float(risk_management.get("stopLossPercent"))
    spread = _as_float(risk_management.get("spread")) or 0.0

    reward_to_risk = None
    break_even = None
    break_even_after_spread = None
    net_reward_after_spread = None
    risk_after_spread = None

    if take_profit is not None and stop_loss is not None and stop_loss > 0:
        reward_to_risk = take_profit / stop_loss
        if take_profit + stop_loss > 0:
            break_even = stop_loss / (take_profit + stop_loss) * 100

        net_reward_after_spread = take_profit - spread
        risk_after_spread = stop_loss + spread
        if net_reward_after_spread > 0 and risk_after_spread > 0:
            break_even_after_spread = risk_after_spread / (risk_after_spread + net_reward_after_spread) * 100

    return {
        "take_profit_percent": _round(take_profit),
        "stop_loss_percent": _round(stop_loss),
        "spread_percent": _round(spread),
        "reward_to_risk": _round(reward_to_risk),
        "break_even_win_rate_before_spread_percent": _round(break_even),
        "approx_round_trip_spread_cost_percent": _round(spread),
        "net_reward_after_spread_estimate_percent": _round(net_reward_after_spread),
        "risk_after_spread_estimate_percent": _round(risk_after_spread),
        "break_even_win_rate_after_spread_estimate_percent": _round(break_even_after_spread),
    }


def _diagnostic_flags(
    *,
    side: str,
    open_conditions: list[Any],
    close_conditions: list[Any],
    risk_management: dict[str, Any],
    markets: dict[str, Any],
    open_arguments: dict[str, Any],
    indicators: list[dict[str, str]],
    approx_days: int | None,
) -> list[str]:
    flags: list[str] = []
    tickers = _as_list(markets.get("tickers"))
    timeframe = markets.get("executionTimeframe")
    take_profit = _as_float(risk_management.get("takeProfitPercent"))
    stop_loss = _as_float(risk_management.get("stopLossPercent"))
    spread = _as_float(risk_management.get("spread")) or 0.0
    has_take_profit = take_profit is not None and take_profit > 0
    has_stop_loss = stop_loss is not None and stop_loss > 0
    families = {indicator["family"] for indicator in indicators}

    if not tickers:
        flags.append("No ticker is selected, so market behavior cannot be evaluated.")
    if not open_conditions:
        flags.append("No open condition is present; the strategy does not yet define an entry signal.")
    if not close_conditions:
        flags.append("No close condition is present; exits rely on take-profit/stop-loss behavior if configured.")
    if not has_take_profit and not has_stop_loss and not close_conditions:
        flags.append("No take-profit, stop-loss, or close condition is configured, so exits are undefined.")
    elif not has_stop_loss:
        flags.append("No active stop-loss is configured; inspect drawdown and gap risk.")
    elif not has_take_profit and not close_conditions:
        flags.append("No active take-profit or close condition is configured; winning exits may be undefined.")
    if has_take_profit and has_stop_loss:
        reward_to_risk = take_profit / stop_loss
        if reward_to_risk < 1:
            flags.append("Reward is smaller than risk; the strategy needs a higher win rate to break even.")
        elif reward_to_risk > 3:
            flags.append("Reward target is much wider than the stop; verify the target is reachable in the selected timeframe.")
    if has_take_profit and spread > 0 and take_profit <= spread:
        flags.append("The take-profit is at or below the approximate round-trip spread cost.")
    if spread > 0 and timeframe and str(timeframe).lower().endswith("m"):
        flags.append("Minute-level execution is especially sensitive to spread and slippage assumptions.")
    if approx_days is not None:
        if approx_days < 30:
            flags.append("Backtest date range is very short; results may describe one market episode.")
        elif approx_days < 180:
            flags.append("Backtest date range is limited; include multiple regimes before trusting the signal.")
    if len(tickers) > 1:
        flags.append("Multiple tickers may have different volatility, liquidity, and correlation profiles.")
    if indicators and len(families) == 1:
        family = next(iter(families))
        flags.append(f"All detected indicators come from one family ({family}); consider independent confirmation.")
    if _as_dict(open_arguments).get("recurring"):
        flags.append("Recurring entries average into positions; inspect drawdown and max exposure, not just final return.")
    if side.upper() == "SHORT":
        flags.append("Short strategies should be stress-tested for gap risk, borrow/friction assumptions, and trend persistence.")

    return flags


def _suggestion_angles(
    *,
    side: str,
    open_conditions: list[Any],
    close_conditions: list[Any],
    markets: dict[str, Any],
    indicators: list[dict[str, str]],
) -> list[str]:
    angles = [
        "Compare against a simple baseline for the same ticker and date range.",
        "Run parameter sensitivity around the main indicator periods and thresholds.",
        "Stress-test spread/slippage to see whether the edge survives realistic execution costs.",
        "Inspect trade count, max drawdown, losing streaks, and whether returns depend on a few outlier trades.",
    ]
    if open_conditions and not close_conditions:
        angles.insert(0, "Add at least one explicit close rule and compare it against TP/SL-only exits.")
    if markets.get("executionTimeframe"):
        angles.append("Retest on nearby timeframes to check whether the idea is robust or timeframe-fitted.")
    if indicators:
        families = {indicator["family"] for indicator in indicators}
        if "Momentum" in families and "Trend" not in families:
            angles.append("Add a trend/regime filter to test whether momentum signals behave differently in strong trends.")
        if "Trend" in families and "Volatility" not in families:
            angles.append("Add a volatility filter or ATR-based stop variant to test whipsaw sensitivity.")
    if side.upper() == "SHORT":
        angles.append("Compare short-side results separately from long-side assumptions and include gap-risk scenarios.")
    return angles[:8]


def build_strategy_brief(strategy_context: dict[str, Any]) -> dict[str, Any]:
    markets = _as_dict(strategy_context.get("markets"))
    risk_management = _as_dict(strategy_context.get("riskManagement"))
    account = _as_dict(strategy_context.get("account"))
    open_arguments = _as_dict(strategy_context.get("openArguments"))
    close_arguments = _as_dict(strategy_context.get("closeArguments"))
    open_conditions = _as_list(strategy_context.get("openConditions"))
    close_conditions = _as_list(strategy_context.get("closeConditions"))
    side = _safe_text(strategy_context.get("side"), "unknown").upper()
    indicators = _indicator_brief(strategy_context)
    start = markets.get("dateStart")
    end = markets.get("dateEnd")
    approx_days = _date_range_days(start, end)
    timeframe = markets.get("executionTimeframe")

    return {
        "snapshot": {
            "strategy_name": _safe_text(strategy_context.get("strategyName"), "Unnamed Strategy"),
            "builder_stage": _safe_text(strategy_context.get("currentStage"), "Strategy"),
            "direction": side,
            "tickers": _as_list(markets.get("tickers")),
            "execution_timeframe": timeframe,
            "timeframe_note": _timeframe_note(timeframe),
            "date_range": {
                "start": start,
                "end": end,
                "approx_days": approx_days,
            },
            "initial_balance": _as_float(account.get("initialBalance")),
            "read_only": strategy_context.get("readOnly") is True,
        },
        "rules": {
            "open_condition_count": len(open_conditions),
            "close_condition_count": len(close_conditions),
            "open_rule_summaries": _condition_summaries(open_conditions),
            "close_rule_summaries": _condition_summaries(close_conditions),
            "open_arguments": open_arguments,
            "close_arguments": close_arguments,
            "indicators_detected": indicators,
        },
        "risk_math": _risk_math(risk_management),
        "market_data": build_market_data_summary(markets),
        "diagnostic_flags": _diagnostic_flags(
            side=side,
            open_conditions=open_conditions,
            close_conditions=close_conditions,
            risk_management=risk_management,
            markets=markets,
            open_arguments=open_arguments,
            indicators=indicators,
            approx_days=approx_days,
        ),
        "suggestion_angles": _suggestion_angles(
            side=side,
            open_conditions=open_conditions,
            close_conditions=close_conditions,
            markets=markets,
            indicators=indicators,
        ),
    }


class AssistantError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AssistantProviderError(AssistantError):
    pass


def _message_item(role: str, text: str) -> dict[str, Any]:
    return {
        "role": role,
        "content": [{"type": "input_text", "text": text}],
    }


def _clean_message(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None

    role = raw.get("role")
    if role not in {"user", "assistant"}:
        return None

    content = raw.get("content")
    if not isinstance(content, str):
        return None

    max_len = int(getattr(settings, "ORCA_ASSISTANT_MAX_MESSAGE_CHARS", 4000))
    cleaned = content.strip()[:max_len]
    if not cleaned:
        return None

    return {"role": role, "content": cleaned}


def normalize_assistant_messages(raw_messages: Any) -> list[dict[str, str]]:
    if not isinstance(raw_messages, list):
        raise AssistantError("messages must be an array.")

    max_messages = int(getattr(settings, "ORCA_ASSISTANT_MAX_HISTORY_MESSAGES", 16))
    messages = [_clean_message(message) for message in raw_messages[-max_messages:]]
    cleaned = [message for message in messages if message is not None]

    if not cleaned or cleaned[-1]["role"] != "user":
        raise AssistantError("The latest assistant message must be from the user.")

    return cleaned


def normalize_strategy_context(raw_context: Any) -> dict[str, Any]:
    if not isinstance(raw_context, dict):
        raise AssistantError("strategy_context must be a JSON object.")
    return raw_context


def normalize_indicator_context(raw_context: Any) -> dict[str, Any]:
    if not isinstance(raw_context, dict):
        raise AssistantError("indicator_context must be a JSON object.")
    return raw_context


def _extract_response_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    parts: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                parts.append(content["text"])
            elif content.get("type") == "refusal" and isinstance(content.get("refusal"), str):
                parts.append(content["refusal"])

    return "\n".join(part.strip() for part in parts if part.strip()).strip()


def _indicator_guide_text() -> str:
    path = Path(__file__).resolve().parent / "docs" / "custom_indicator_guide.md"
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        logger.warning("Custom indicator guide is missing at %s", path)
        return ""


def _indicator_assistant_instructions(mode: str = "ask") -> str:
    header = INDICATOR_AGENT_INSTRUCTIONS_HEADER if mode == "agent" else INDICATOR_ASSISTANT_INSTRUCTIONS_HEADER
    guide = _indicator_guide_text()
    if not guide:
        return header
    return (
        f"{header}\n\n"
        "Reference guide for building custom indicators (the same one shown to users on the Docs page):\n"
        f"{guide}"
    )


def _indicator_context_text(indicator_context: dict[str, Any]) -> str:
    max_chars = int(getattr(settings, "ORCA_ASSISTANT_MAX_CONTEXT_CHARS", 20000))
    payload = {
        "name": _safe_text(indicator_context.get("name"), ""),
        "description": _safe_text(indicator_context.get("description"), ""),
        "parameters": _as_list(indicator_context.get("parameters")),
        "code": indicator_context.get("code") if isinstance(indicator_context.get("code"), str) else "",
        "last_test_result": indicator_context.get("last_test_result"),
    }
    raw = json.dumps(payload, indent=2, sort_keys=True)
    header = "User's current custom-indicator draft (read-only; the locked def/return lines are added automatically and not shown here):\n"
    budget = max_chars - len(header)
    if budget <= 0:
        return header[:max_chars]
    return f"{header}{raw[:budget]}"


def _context_text(strategy_context: dict[str, Any]) -> str:
    max_chars = int(getattr(settings, "ORCA_ASSISTANT_MAX_CONTEXT_CHARS", 20000))
    brief = json.dumps(build_strategy_brief(strategy_context), indent=2, sort_keys=True)
    raw_context = json.dumps(strategy_context, indent=2, sort_keys=True)

    derived_section = (
        "Orca-derived strategy brief. This is generated from the builder state before the model answers:\n"
        f"{brief}"
    )
    raw_header = "\n\nRaw read-only strategy context:\n"
    raw_budget = max_chars - len(derived_section) - len(raw_header)

    if raw_budget <= 0:
        return derived_section[:max_chars]

    return f"{derived_section}{raw_header}{raw_context[:raw_budget]}"


def _ask_openai(messages: list[dict[str, str]], system_prompt: str, context_text: str) -> dict[str, Any]:
    api_key = getattr(settings, "OPENAI_API_KEY", "")
    if not api_key:
        raise AssistantProviderError(
            "Strategy assistant is not configured. Set OPENAI_API_KEY on the backend.",
            status_code=503,
        )

    model = getattr(settings, "ORCA_ASSISTANT_MODEL", "gpt-5.1")
    input_items = [
        _message_item(
            "developer",
            "Current read-only Orca context follows. Use it to answer the user's next message.\n\n"
            f"{context_text}",
        )
    ]
    input_items.extend(_message_item(message["role"], message["content"]) for message in messages)

    request_payload = {
        "model": model,
        "instructions": system_prompt,
        "input": input_items,
        "max_output_tokens": int(getattr(settings, "ORCA_ASSISTANT_MAX_OUTPUT_TOKENS", 900)),
        "store": bool(getattr(settings, "ORCA_ASSISTANT_STORE_RESPONSES", False)),
        "tool_choice": "none",
    }

    api_base = getattr(settings, "OPENAI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    request = urllib.request.Request(
        f"{api_base}/responses",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=float(getattr(settings, "ORCA_ASSISTANT_TIMEOUT_SECONDS", 30.0)),
        ) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        logger.warning("OpenAI assistant request failed with status %s: %s", exc.code, body)
        message = "Assistant provider rejected the request."
        try:
            error_payload = json.loads(body)
            message = error_payload.get("error", {}).get("message") or message
        except json.JSONDecodeError:
            pass
        raise AssistantProviderError(message, status_code=502)
    except urllib.error.URLError as exc:
        logger.warning("OpenAI assistant request failed: %s", exc)
        raise AssistantProviderError("Assistant provider is unreachable.", status_code=502)
    except TimeoutError:
        raise AssistantProviderError("Assistant request timed out.", status_code=504)

    answer = _extract_response_text(response_payload)
    if not answer:
        raise AssistantProviderError("Assistant returned an empty response.", status_code=502)

    return {
        "answer": answer,
        "model": response_payload.get("model", model),
        "provider": "openai",
    }


def _ask_ollama(messages: list[dict[str, str]], system_prompt: str, context_text: str) -> dict[str, Any]:
    model = getattr(settings, "ORCA_ASSISTANT_OLLAMA_MODEL", "llama3.1:8b")
    ollama_base = getattr(settings, "ORCA_ASSISTANT_OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    ollama_messages = [
        {
            "role": "system",
            "content": (
                f"{system_prompt}\n\n"
                "Current read-only Orca context follows. Use it to answer the user's next message.\n\n"
                f"{context_text}"
            ),
        },
        *messages,
    ]
    request_payload: dict[str, Any] = {
        "model": model,
        "messages": ollama_messages,
        "stream": False,
        # Tell Ollama to keep the model resident between requests — without this
        # it unloads after ~5 minutes idle (its own default), and the next
        # request pays a slow "cold load" on top of generation, which is the
        # usual cause of "service isn't responding"/timeout reports locally.
        "keep_alive": getattr(settings, "ORCA_ASSISTANT_OLLAMA_KEEP_ALIVE", "30m"),
        "options": {
            "temperature": float(getattr(settings, "ORCA_ASSISTANT_TEMPERATURE", 0.2)),
            "num_predict": int(getattr(settings, "ORCA_ASSISTANT_MAX_OUTPUT_TOKENS", 900)),
        },
    }

    request = urllib.request.Request(
        f"{ollama_base}/api/chat",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=float(getattr(settings, "ORCA_ASSISTANT_OLLAMA_TIMEOUT_SECONDS", 120.0)),
        ) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        logger.warning("Ollama assistant request failed with status %s: %s", exc.code, body)
        raise AssistantProviderError(
            f"Ollama rejected the request. Check that model {model!r} is available locally.",
            status_code=502,
        )
    except urllib.error.URLError as exc:
        logger.warning("Ollama assistant request failed: %s", exc)
        raise AssistantProviderError(
            "Local Ollama is unreachable. Start Ollama and make sure it is listening on 127.0.0.1:11434.",
            status_code=502,
        )
    except TimeoutError:
        raise AssistantProviderError("Local Ollama request timed out.", status_code=504)

    answer = response_payload.get("message", {}).get("content")
    if not isinstance(answer, str) or not answer.strip():
        raise AssistantProviderError("Ollama returned an empty response.", status_code=502)

    return {
        "answer": answer.strip(),
        "model": response_payload.get("model", model),
        "provider": "ollama",
    }


def _dispatch_assistant(messages: list[dict[str, str]], system_prompt: str, context_text: str) -> dict[str, Any]:
    provider = str(getattr(settings, "ORCA_ASSISTANT_PROVIDER", "ollama")).strip().lower()
    if provider == "openai":
        return _ask_openai(messages, system_prompt, context_text)
    if provider == "ollama":
        return _ask_ollama(messages, system_prompt, context_text)
    raise AssistantProviderError(
        "Invalid ORCA_ASSISTANT_PROVIDER. Use 'ollama' or 'openai'.",
        status_code=500,
    )


def ask_strategy_assistant(messages: list[dict[str, str]], strategy_context: dict[str, Any]) -> dict[str, Any]:
    markets = _as_dict(strategy_context.get("markets"))
    if markets:
        prepare_strategy_market_data(markets)

    return _dispatch_assistant(messages, STRATEGY_ASSISTANT_INSTRUCTIONS, _context_text(strategy_context))


def ask_indicator_assistant(
    messages: list[dict[str, str]], indicator_context: dict[str, Any], mode: str = "ask"
) -> dict[str, Any]:
    normalized_mode = "agent" if mode == "agent" else "ask"
    response = _dispatch_assistant(
        messages, _indicator_assistant_instructions(normalized_mode), _indicator_context_text(indicator_context)
    )
    response["mode"] = normalized_mode
    return response
