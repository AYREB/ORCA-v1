import json
import os
import pandas as pd
import numpy as np
from datetime import timedelta
from .data_pulling import datapull
from .parsing import parser, validateParsedDSL
from .fetcher_calculators import indicatorEvaluator
from .parsing.extractingTickers import extract_tickers, extract_execution_timeframe, extract_dateframe, collect_timeframes_from_dsl
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

    # ---------------- Pull data ----------------
    TICKERS = extract_tickers(parsed_dsl)
    EXECUTION_TF = extract_execution_timeframe(parsed_dsl)

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

    data_dict = {}

    for t in TICKERS:
        data_dict[t] = {}

        for tf in DATA_TFS:
            try:
                df = datapull.get_data_with_indicator(
                    ticker=t,
                    start=fetch_start_date,
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
                    f"No data available for {t} on the {tf} timeframe "
                    f"between {start_date} and {end_date}. "
                    f"Try a different date range or timeframe.",
                    code="no_data"
                )

            df = clip_dataframe_to_dateframe(df, start_date, end_date, clip_start=True)

            if df.empty:
                raise BacktestError(
                    f"No data available for {t} after clipping to "
                    f"{start_date} → {end_date}.",
                    code="no_data_after_clip"
                )

            data_dict[t][tf] = df

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
    warnings = []
    if not trade_log:
        warnings.append(
            "No trades were triggered. Your conditions may be too strict "
            "for this date range - try adjusting your indicator thresholds."
        )

    invested = sum(
        positions[ticker] * data_dict[ticker][EXECUTION_TF].iloc[-1]["Close"]
        for ticker in positions
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
                for tf, df in data_dict[ticker].items()
            }
            for ticker in data_dict
        }
    }

# if __name__ == "__main__":
#     main()
