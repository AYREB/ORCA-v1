import json
import pandas as pd
import numpy as np
import os
import subprocess
import sys
from .data_pulling import datapull
from .parsing import parser, validateParsedDSL
from .fetcher_calculators import indicatorEvaluator
from .parsing.extractingTickers import extract_tickers, extract_data_timeframes, extract_execution_timeframe, extract_dateframe
from .backtesting.backtesterCore import backtester
from .console_ui.PrintTradeSummary import print_trade_summary

internetConnection = True   # or False
DATA_CSV_FOLDER = "Data_CSVs"

# ---------------- DSL ----------------
dsl_text_example = """
:TICKER(AAPL)
:EXECUTION_TIMEFRAME(1h)
:DATA_TIMEFRAMES(1h,8h)
:DATEFRAME(2024-01-01, 2025-11-01)
:LONG(
   OPEN{
       CONDITIONS{
           RSI() < 30
       }
       |ARGUMENTS{
           initialOpenPositionInvestType = percentCashBalance
           |initialOpenPositionInvestAmount = 0.1
           |recurring=false
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


def main(dsl_command: str) -> str:
    # ---------------- Parse and validate DSL ----------------
    parsed_dsl = parser.parse_dsl(dsl_command)

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
    DATA_TFS = extract_data_timeframes(parsed_dsl)
    DATEFRAME = extract_dateframe(parsed_dsl)

    if DATEFRAME:
        start_date = DATEFRAME["start"]
        end_date = DATEFRAME["end"]
    else:
        start_date = "2024-01-01"
        end_date = "2025-01-01"

    print(DATA_TFS)

    data_dict = {}

    for t in TICKERS:
        data_dict[t] = {}

        for tf in DATA_TFS:
            print(f"Fetching data for {t} @ {tf} between {start_date} → {end_date}")

            if internetConnection:
                # online mode
                df = datapull.get_data_with_indicator(
                    ticker=t,
                    start=start_date,
                    end=end_date,
                    interval=tf
                )
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
                df = df.loc[start_date:end_date]
                x=1

                # ⭐ Make offline identical to online: add indicators
                for ind_name, ind_fn in INDICATOR_FUNCTIONS.items():
                    try:
                        df[ind_name] = ind_fn(df)
                    except Exception as e:
                        print(f"[WARN] Failed to calculate indicator {ind_name}: {e}")

            data_dict[t][tf] = df


    # debug print
    for t in data_dict:
        for tf in data_dict[t]:
            print(f"{t} @ {tf}: type={type(data_dict[t][tf])}, columns={data_dict[t][tf].columns.tolist()}")

    # run backtester
    trade_log, cash, positions, pct_change = backtester(
        parsed_dsl,
        data_dict,
        INDICATOR_FUNCTIONS
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
        "trades": trade_log,
        "data": {
            ticker: {
                tf: df.reset_index()
                    .assign(Datetime=lambda x: x["Datetime"].astype(str))
                    .to_dict(orient="records")
                for tf, df in data_dict[ticker].items()
            }
            for ticker in data_dict
        }
    }
    with open("return_data_output.json", "w") as f:
        json.dump(data_return, f, indent=4)

    print_trade_summary(trade_log)

    return data_return
      

if __name__ == "__main__":
    main()