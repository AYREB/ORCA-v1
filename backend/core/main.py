import json
import os
import pandas as pd
import numpy as np
from datetime import timedelta
from .data_pulling import datapull
from .parsing import parser, validateParsedDSL
from .fetcher_calculators import indicatorEvaluator
from .parsing.extractingTickers import extract_tickers, extract_signal_tickers, extract_execution_timeframe, extract_dateframe, collect_timeframes_from_dsl
from .parsing.inputSanity import check_strategy, clamp_dateframe_for_timeframe, max_history_days
from .backtesting.backtesterCore import backtester
from .console_ui.PrintTradeSummary import print_trade_summary

# Resolve registries relative to this file (backend/core/ -> backend/core/registries/) so
# paths work regardless of process cwd and on case-sensitive filesystems (Linux/Railway).
_REGISTRIES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "registries")
_INDICATOR_REGISTRY_PATH = os.path.join(_REGISTRIES_DIR, "indicatorRegistry.json")
_ARGUMENTS_REGISTRY_PATH = os.path.join(_REGISTRIES_DIR, "argumentsRegistry.json")

# ---------------- DSL ----------------
dsl_text_example = """
:TICKER(AAPL,TSLA,MSFT)
:EXECUTION_TIMEFRAME(1h,4h)
:DATA_TIMEFRAMES(1h)
:DATEFRAME(2024-01-01, 2025-11-01)
:LONG(
   OPEN{
       CONDITIONS{
           RSI() < 30 AND SMA() < 20 AND PRICE() > 30
       }
       |ARGUMENTS{
           initialOpenPositionInvestType = percentCashBalance
           |initialOpenPositionInvestAmount = 0.1
           |recurring=true
           |stopLossPercent =6
           |takeProfitPercent = 10
       }
   }
   |CLOSE{
        CONDITIONS{
            RSI(offset=1) > 75
        }
   }
)
"""


def merge_indicator_defaults(parsed_dsl, registry_path=_INDICATOR_REGISTRY_PATH, extra_indicators=None):
    """
    Ensures all indicator calls have dict args with defaults applied.

    `extra_indicators`, when provided, is a per-request dict of additional indicator
    definitions (e.g. the authenticated user's compiled custom indicators), keyed by
    their *exact* (case-sensitive) DSL name — unlike native indicators, which are looked
    up uppercase per the registry's all-caps convention.
    """
    with open(registry_path, "r") as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]

    def _resolve_args(node):
        if isinstance(node, dict):
            if "func" in node and "arg" in node:
                raw_name = node["func"]
                provided = node["arg"]
                info = INDICATORS_DEF.get(raw_name.upper()) or (extra_indicators or {}).get(raw_name)

                if info is not None:
                    default_args = info.get("defaults", {})
                    arg_names = info.get("args", [])

                    final_args = {}
                    # `ticker` is a cross-cutting arg every indicator accepts (it
                    # retargets the operand at another loaded symbol) but is not
                    # declared in any registry entry — carry it through explicitly
                    # or this rebuild would silently strip it.
                    if "ticker" in provided:
                        final_args["ticker"] = provided["ticker"]
                    for name in arg_names:
                        if name in provided:
                            final_args[name] = provided[name]
                        elif str(arg_names.index(name)) in provided:
                            final_args[name] = provided[str(arg_names.index(name))]
                        else:
                            final_args[name] = default_args.get(name, None)
                    node["arg"] = final_args
                # else: unknown to both registries — leave `provided` untouched so
                # validation reports "Unknown indicator" with the user's actual args
                # intact, instead of silently wiping them to {} first.

            for v in node.values():
                _resolve_args(v)
        elif isinstance(node, list):
            for x in node:
                _resolve_args(x)

    _resolve_args(parsed_dsl)
    return parsed_dsl


def apply_default_arguments(parsed_dsl, registry_path=_ARGUMENTS_REGISTRY_PATH):
    with open(registry_path, "r") as f:
        arg_defaults = json.load(f)["ARGUMENTS"]
    for side in ["LONG", "SHORT"]:
        if side in parsed_dsl:
            for action in ["OPEN", "CLOSE"]:
                if action in parsed_dsl[side]:
                    args = parsed_dsl[side][action].get("ARGUMENTS", {})
                    defaults = arg_defaults.get(side, {}).get(action, {})
                    for k, v in defaults.items():
                        if k not in args:
                            args[k] = v["default"]
                    parsed_dsl[side][action]["ARGUMENTS"] = args
    return parsed_dsl


def dataframe_to_response_records(df):
    if df is None or df.empty:
        return []

    records_df = df.reset_index()
    datetime_column = next(
        (column for column in ("Datetime", "Date", "index") if column in records_df.columns),
        None,
    )

    if datetime_column:
        records_df = records_df.rename(columns={datetime_column: "Datetime"})
    else:
        records_df.insert(0, "Datetime", records_df.index)

    records_df["Datetime"] = records_df["Datetime"].astype(str)
    return records_df.to_dict(orient="records")


def is_date_only_bound(value):
    return (
        isinstance(value, str)
        and len(value) == 10
        and value[4] == "-"
        and value[7] == "-"
    )


def parse_datetime_bound(value):
    if not value:
        return None

    parsed = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(parsed):
        return None

    return parsed.tz_convert(None)


def get_fetch_date_bound(value, *, is_end=False, warmup_days=0):
    parsed = parse_datetime_bound(value)
    if parsed is None:
        return value

    if is_end and not is_date_only_bound(value):
        parsed = parsed + timedelta(days=1)

    if not is_end and warmup_days > 0:
        parsed = parsed - timedelta(days=warmup_days)

    return parsed.date().isoformat()

def get_max_indicator_period(parsed_dsl) -> int:
    """
    Walk the DSL conditions and find the longest indicator period.
    Multiply by 2 to account for weekends/holidays in trading days.
    """
    max_period = 50  # safe minimum default

    def walk_conditions(cond):
        nonlocal max_period
        if not isinstance(cond, dict):
            return

        if "AND" in cond:
            for c in cond["AND"]:
                walk_conditions(c)
            return
        if "OR" in cond:
            for c in cond["OR"]:
                walk_conditions(c)
            return

        for side in ["left", "right"]:
            node = cond.get(side, {})
            if "func" in node and "arg" in node:
                arg = node["arg"]
                # Check all possible period fields
                for field in ["period", "slow", "k_period"]:
                    if field in arg:
                        max_period = max(max_period, int(arg[field]))

    direction = "LONG" if "LONG" in parsed_dsl else "SHORT"
    open_cond = parsed_dsl[direction].get("OPEN", {}).get("CONDITIONS", {})
    close_cond = parsed_dsl[direction].get("CLOSE", {}).get("CONDITIONS", {})

    walk_conditions(open_cond)
    walk_conditions(close_cond)

    # Multiply by 2 to cover weekends and holidays
    return max_period * 2

def collect_condition_tickers(parsed_dsl) -> set:
    """
    Walk the DSL conditions and collect every explicit `ticker` argument used
    in an indicator call (e.g. PRICE(ticker=UKX)). Used to verify each
    referenced symbol is actually loaded (traded or watch-only).
    """
    referenced = set()

    def walk(node):
        if isinstance(node, dict):
            arg = node.get("arg")
            if "func" in node and isinstance(arg, dict) and arg.get("ticker"):
                referenced.add(str(arg["ticker"]))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    direction = "LONG" if "LONG" in parsed_dsl else "SHORT"
    for block in ("OPEN", "CLOSE"):
        walk(parsed_dsl.get(direction, {}).get(block, {}).get("CONDITIONS", {}))

    return referenced


def normalize_datetime_index(df):
    if df is None or df.empty:
        return df

    normalized = df.copy()
    try:
        normalized.index = pd.to_datetime(normalized.index, utc=True, errors="coerce").tz_convert(None)
    except (TypeError, ValueError):
        return df

    return normalized


def clip_dataframe_to_dateframe(df, start_value, end_value, *, clip_start=True):
    if df is None or df.empty:
        return df

    clipped = normalize_datetime_index(df)
    start_dt = parse_datetime_bound(start_value)
    end_dt = parse_datetime_bound(end_value)

    if clip_start and start_dt is not None:
        clipped = clipped[clipped.index >= start_dt]

    if end_dt is not None:
        if is_date_only_bound(end_value):
            clipped = clipped[clipped.index < end_dt]
        else:
            clipped = clipped[clipped.index <= end_dt]

    return clipped


def dslTextToJsonBacktest(dsl_text, initial_balance=10000, custom_indicators=None):
    print("dsl_GO")
    print(dsl_text)
    parsed_dsl = parser.parse_dsl(dsl_text)
    print(parsed_dsl)
    trade_data = main(parsed_dsl, initial_balance=initial_balance, custom_indicators=custom_indicators)
    return trade_data


class BacktestError(Exception):
    """Known backtest failure with a user-friendly message"""
    def __init__(self, message: str, code: str = "backtest_error"):
        super().__init__(message)
        self.message = message
        self.code = code


def dslJSONBacktest(dsl_json, initial_balance=10000, custom_indicators=None):
    # Remove file writes - not safe for production
    trade_data = main(dsl_json, initial_balance=initial_balance, custom_indicators=custom_indicators)
    return trade_data


def main(parsed_dsl, initial_balance=10000, custom_indicators=None):
    # ---------------- Custom indicators (per authenticated user) ----------------
    # `custom_indicators` is a plain dict the API layer builds from the user's compiled
    # CustomIndicator rows: {name: {"calculate": fn, "args": [...], "defaults": {...}}}.
    # core/ stays decoupled from Django/api — it never imports the sandbox/compiler,
    # it just executes the callables it's handed.
    custom_indicators = custom_indicators or {}
    CUSTOM_INDICATOR_DEFS = {
        name: {"args": v["args"], "defaults": v["defaults"], "supports_timeframe": False}
        for name, v in custom_indicators.items()
    }
    CUSTOM_INDICATOR_FUNCTIONS = {name: v["calculate"] for name, v in custom_indicators.items()}

    # ---------------- Parse and validate DSL ----------------
    parsed_dsl = apply_default_arguments(parsed_dsl)
    parsed_dsl = merge_indicator_defaults(parsed_dsl, extra_indicators=CUSTOM_INDICATOR_DEFS)

    # Load indicator definitions from JSON registry
    with open(_INDICATOR_REGISTRY_PATH) as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]

    # Build functions dynamically — no hardcoding needed
    INDICATOR_FUNCTIONS = indicatorEvaluator.build_indicator_functions(INDICATORS_DEF)

    # Validate DSL
    validateParsedDSL.validate_parsed_dsl(parsed_dsl, extra_indicators=CUSTOM_INDICATOR_DEFS)

    # ---------------- Semantic sanity ----------------
    # Impossible conditions (e.g. SMA < -12) would silently produce zero
    # trades — block them with an explanation instead of wasting a run.
    sanity_blockers, sanity_warnings = check_strategy(parsed_dsl)
    if sanity_blockers:
        raise BacktestError(
            "This strategy can never trigger: " + " | ".join(sanity_blockers),
            code="impossible_condition",
        )

    # Clamp the date range into what the data provider actually stores for
    # the chosen timeframe (e.g. 15m only goes back ~55 days).
    _direction = "LONG" if "LONG" in parsed_dsl else "SHORT"
    _ctx = parsed_dsl.get(_direction, {}).get("context", {})
    _df = _ctx.get("dateframe") or {}
    _tf = _ctx.get("execution_timeframe", "1D")
    if _df.get("start") and _df.get("end"):
        _s, _e, _note = clamp_dateframe_for_timeframe(_df["start"], _df["end"], _tf)
        if _note:
            _ctx["dateframe"] = {"start": _s, "end": _e}
            sanity_warnings.append(f"Date range adjusted: {_note}.")

    # ---------------- Pull data ----------------
    TICKERS = extract_tickers(parsed_dsl)
    # Signal tickers are watch-only: data loads so conditions can reference
    # them, but the backtester never opens positions on them.
    SIGNAL_TICKERS = [t for t in extract_signal_tickers(parsed_dsl) if t not in TICKERS]
    ALL_TICKERS = TICKERS + SIGNAL_TICKERS

    # Every ticker referenced inside a condition must be loaded, otherwise the
    # condition silently evaluates to False on every bar — fail loudly instead.
    unknown_refs = collect_condition_tickers(parsed_dsl) - set(ALL_TICKERS)
    if unknown_refs:
        raise BacktestError(
            f"Condition references ticker(s) not in this strategy: "
            f"{', '.join(sorted(unknown_refs))}. Add them as traded or "
            f"watch-only (signal) tickers.",
            code="unknown_condition_ticker"
        )

    EXECUTION_TF = extract_execution_timeframe(parsed_dsl)
    # The text parser stores execution_timeframe as a LIST (e.g.
    # ":EXECUTION_TIMEFRAME(1h,4h)"). Downstream code (timeframe collection,
    # chart_dict keying, final valuation) expects a single string, so take the
    # first entry — same rule the backtester applies — and write it back so
    # every consumer of the DSL sees the same normalized value.
    if isinstance(EXECUTION_TF, list):
        EXECUTION_TF = EXECUTION_TF[0] if EXECUTION_TF else "1h"
        for _side in ("LONG", "SHORT"):
            if _side in parsed_dsl and isinstance(parsed_dsl[_side].get("context"), dict):
                parsed_dsl[_side]["context"]["execution_timeframe"] = EXECUTION_TF

    DATA_TFS = collect_timeframes_from_dsl(
        parsed_dsl,
        EXECUTION_TF
    )
    DATEFRAME = extract_dateframe(parsed_dsl)
    print(DATA_TFS)

    if DATEFRAME:
        start_date = DATEFRAME["start"]
        end_date = DATEFRAME["end"]
    else:
        start_date = "2024-01-01"
        end_date = "2025-01-01"

    warmup_days = get_max_indicator_period(parsed_dsl)
    fetch_start_date = get_fetch_date_bound(start_date, warmup_days=warmup_days)
    fetch_end_date = get_fetch_date_bound(end_date, is_end=True)

    # The warmup extension must never push a fetch outside the provider's
    # history window (e.g. 15m only exists for ~60 days) — Yahoo rejects the
    # ENTIRE request if the start is out of range, killing an otherwise valid
    # backtest. Floor is per timeframe: a 15m strategy watching a 1D SMA(200)
    # still gets full daily history.
    from datetime import datetime as _dt

    def _fetch_start_for(tf: str) -> str:
        floor = (_dt.now() - timedelta(days=max_history_days(tf))).date().isoformat()
        return max(fetch_start_date, floor)

    # data_dict: full data including warmup bars (for indicator computation)
    # chart_dict: clipped to user's requested range (for chart response)
    data_dict = {}
    chart_dict = {}

    for t in ALL_TICKERS:
        data_dict[t] = {}
        chart_dict[t] = {}

        for tf in DATA_TFS:
            try:
                df = datapull.get_data_with_indicator(
                    ticker=t,
                    start=_fetch_start_for(tf),
                    end=fetch_end_date,
                    interval=tf
                )
            except Exception as e:
                raise BacktestError(
                    f"Failed to fetch market data for {t} ({tf}). "
                    f"Please check the ticker symbol and try again.",
                    code="data_fetch_error"
                )

            if df is None or df.empty:
                raise BacktestError(
                    f"No market data found for '{t}' on the {tf} timeframe "
                    f"between {start_date} and {end_date}. Check the ticker "
                    f"symbol exists, or try a different date range/timeframe.",
                    code="no_data"
                )

            # Keep warmup bars so indicators warm up before the user's start date.
            # The backtester's trade_start_at gate prevents trades on warmup bars.
            df_with_warmup = clip_dataframe_to_dateframe(df, start_date, end_date, clip_start=False)

            if df_with_warmup.empty:
                raise BacktestError(
                    f"No data available for {t} after clipping to "
                    f"{start_date} → {end_date}.",
                    code="no_data_after_clip"
                )

            data_dict[t][tf] = df_with_warmup
            chart_dict[t][tf] = clip_dataframe_to_dateframe(df, start_date, end_date, clip_start=True)

    # Run backtester
    try:
        trade_log, cash, positions, pct_change = backtester(
            parsed_dsl,
            data_dict,
            INDICATOR_FUNCTIONS,
            initial_balance=initial_balance,
            custom_indicator_functions=CUSTOM_INDICATOR_FUNCTIONS
        )
    except Exception as e:
        raise BacktestError(
            f"Backtest failed during execution: {str(e)}",
            code="execution_error"
        )

    # No trades is not an error but worth flagging
    warnings = list(sanity_warnings)
    if not trade_log:
        if sanity_warnings:
            warnings.append(
                "No trades were triggered — see the notes above for the likely reason."
            )
        else:
            warnings.append(
                "No trades were triggered. Your conditions may be too strict "
                "for this date range - try adjusting your indicator thresholds "
                "or widening the dates."
            )

    invested = sum(
        positions[ticker] * chart_dict[ticker][EXECUTION_TF].iloc[-1]["Close"]
        for ticker in positions
        if not chart_dict[ticker][EXECUTION_TF].empty
    )
    total_portfolio = cash + invested
    pct_change = (total_portfolio - initial_balance) / initial_balance * 100

    # Print summary
    print("\n💰 Final Cash: ${:.2f}".format(cash))
    print("💼 Invested in Positions: ${:.2f}".format(invested))
    print("💵 Total Portfolio Value: ${:.2f}".format(total_portfolio))
    print(f"💹 Total Portfolio Change: {pct_change:.2f}%\n")

    print("📊 Final Positions:")
    for ticker, shares in positions.items():
        print(f" - {ticker}: {shares} shares")

    print_trade_summary(trade_log)

    return {
        "cash": cash,
        "invested": invested,
        "total_portfolio": total_portfolio,
        "pct_change": pct_change,
        "json_dsl": parsed_dsl,
        "trades": trade_log,
        "warnings": warnings,
        "data": {
            ticker: {
                tf: dataframe_to_response_records(df)
                for tf, df in chart_dict[ticker].items()
            }
            for ticker in chart_dict
        }
    }

# if __name__ == "__main__":
#     main()
