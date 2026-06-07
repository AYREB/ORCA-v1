import json
import pandas as pd
import numpy as np
import os
import subprocess
import sys
from datetime import timedelta
from .data_pulling import datapull
from .parsing import parser, validateParsedDSL
from .fetcher_calculators import indicatorEvaluator
from .parsing.extractingTickers import extract_tickers, extract_execution_timeframe, extract_dateframe, collect_timeframes_from_dsl
from .backtesting.backtesterCore import backtester
from .console_ui.PrintTradeSummary import print_trade_summary

internetConnection = True   # or False
DATA_CSV_FOLDER = "Data_CSVs"

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


def merge_indicator_defaults(parsed_dsl, registry_path="Core/Registries/indicatorRegistry.json"):
    """
    Ensures all indicator calls have dict args with defaults applied.
    """
    with open(registry_path, "r") as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]

    def _resolve_args(node):
        if isinstance(node, dict):
            if "func" in node and "arg" in node:
                func_name = node["func"].upper()
                provided = node["arg"]
                default_args = INDICATORS_DEF.get(func_name, {}).get("defaults", {})
                arg_names = INDICATORS_DEF.get(func_name, {}).get("args", [])

                final_args = {}
                for name in arg_names:
                    if name in provided:
                        final_args[name] = provided[name]
                    elif str(arg_names.index(name)) in provided:
                        final_args[name] = provided[str(arg_names.index(name))]
                    else:
                        final_args[name] = default_args.get(name, None)
                node["arg"] = final_args

            for v in node.values():
                _resolve_args(v)
        elif isinstance(node, list):
            for x in node:
                _resolve_args(x)

    _resolve_args(parsed_dsl)
    return parsed_dsl


def apply_default_arguments(parsed_dsl, registry_path="Core/Registries/argumentsRegistry.json"):
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


def dslTextToJsonBacktest(dsl_text, initial_balance=10000):
    print("dsl_GO")
    print(dsl_text)
    parsed_dsl = parser.parse_dsl(dsl_text)
    print(parsed_dsl)
    trade_data = main(parsed_dsl, initial_balance=initial_balance)
    return trade_data

def dslJSONBacktest(dsl_json, initial_balance=10000):
    print("dsl_GO")
    print(dsl_json)

    with open("mainDEMOJSON.json", "w") as f:
        json.dump(dsl_json,f,indent=4)
    
    trade_data = main(dsl_json, initial_balance=initial_balance)
    return trade_data


def main(parsed_dsl, initial_balance=10000):
    # ---------------- Parse and validate DSL ----------------
    parsed_dsl = apply_default_arguments(parsed_dsl)
    parsed_dsl = merge_indicator_defaults(parsed_dsl) 


    with open("Core/Parsing/dsl_output.json", "w") as f:
        json.dump(parsed_dsl, f, indent=4)

    # Load indicator definitions from JSON registry
    with open("Core/Registries/indicatorRegistry.json") as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]


    # Build functions dynamically — no hardcoding needed
    INDICATOR_FUNCTIONS = indicatorEvaluator.build_indicator_functions(INDICATORS_DEF)


    # Validate DSL
    validateParsedDSL.validate_parsed_dsl(parsed_dsl)

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

    fetch_start_date = get_fetch_date_bound(start_date)
    fetch_end_date = get_fetch_date_bound(end_date, is_end=True)

    warmup_days = get_max_indicator_period(parsed_dsl)

    fetch_start_date = get_fetch_date_bound(start_date, warmup_days=warmup_days)
    fetch_end_date = get_fetch_date_bound(end_date, is_end=True)

    data_dict = {}

    for t in TICKERS:
        data_dict[t] = {}

        for tf in DATA_TFS:

            if internetConnection:
                df = datapull.get_data_with_indicator(
                    ticker=t,
                    start=fetch_start_date,  
                    end=fetch_end_date,
                    interval=tf
                )

                df = clip_dataframe_to_dateframe(df, start_date, end_date, clip_start=True)
                x=1
            else:
                # offline mode
                csv_path = os.path.join(DATA_CSV_FOLDER, f"{t}.csv")
                if not os.path.exists(csv_path):
                    raise FileNotFoundError(
                        f"Offline mode enabled but missing file: {csv_path}"
                    )

                df = pd.read_csv(csv_path)
                df["Datetime"] = pd.to_datetime(df["Datetime"], utc=True).dt.tz_localize(None)
                df = df.set_index("Datetime")
                df = df.sort_index()
                df = clip_dataframe_to_dateframe(df, start_date, end_date, clip_start=False)
                x=1

                # ⭐ Make offline identical to online: add indicators
                for ind_name, ind_fn in INDICATOR_FUNCTIONS.items():
                    try:
                        df[ind_name] = ind_fn(df)
                    except Exception as e:
                        print(f"[WARN] Failed to calculate indicator {ind_name}: {e}")

            data_dict[t][tf] = df



    # run backtester
    trade_log, cash, positions, pct_change = backtester(
        parsed_dsl,
        data_dict,
        INDICATOR_FUNCTIONS,
        initial_balance=initial_balance
    )

   # Decide the timeframe per ticker; default '1h'
   # or fetch from DSL if available
    invested = sum(positions[ticker] * data_dict[ticker][EXECUTION_TF].iloc[-1]["Close"] for ticker in positions)    
    total_portfolio = cash + invested

    # Print summary
    print("\n💰 Final Cash: ${:.2f}".format(cash))
    print("💼 Invested in Positions: ${:.2f}".format(invested))
    print("💵 Total Portfolio Value: ${:.2f}".format(total_portfolio))
    print(f"💹 Total Portfolio Change: {pct_change:.2f}%\n")

    print("📊 Final Positions:")
    for ticker, shares in positions.items():
        print(f" - {ticker}: {shares} shares")

    print_trade_summary(trade_log)



    # Optionally, save trades to JSON
    with open("trades_output.json", "w") as f:
        json.dump(trade_log, f, indent=4)

    
    data_return = {
        "cash": cash,
        "invested": invested,
        "total_portfolio": total_portfolio,
        "pct_change": pct_change,
        "json_dsl": parsed_dsl,
        "trades": trade_log,
        "data": {
            ticker: {
                tf: dataframe_to_response_records(df)
                for tf, df in data_dict[ticker].items()
            }
            for ticker in data_dict
        }
    }
    with open("return_data_output.json", "w") as f:
        json.dump(data_return, f, indent=4)

    #print_trade_summary(trade_log)

    return data_return

# if __name__ == "__main__":
#     main()
