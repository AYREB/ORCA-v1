import copy
import sys
import os
import json
import itertools
import pandas as pd
from backtesting.backtesterCore import backtester

def run_optimizer(param_grid, parsed_dsl, data_dict, INDICATOR_FUNCTIONS):
    # Run all combinations
    results = run_param_grid_backtest(
        parsed_dsl=parsed_dsl,
        param_grid=param_grid,
        data_dict=data_dict,
        INDICATOR_FUNCTIONS=INDICATOR_FUNCTIONS
    )
    print("\n===== TOP RESULTS =====")
    sorted_results = results.sort_values("pct_change", ascending=False)
    print(sorted_results.head(10))

    best = sorted_results.iloc[0]

    print("\n===== BEST PARAMETERS FOUND =====")
    print(best)

    return results, best


def apply_overrides(dsl, overrides):
    """Override values in a nested DSL dict using dot-path keys."""
    dsl = copy.deepcopy(dsl)
    for path, value in overrides.items():
        keys = path.split(".")
        node = dsl
        for k in keys[:-1]:
            node = node[k]
        node[keys[-1]] = value
    return dsl

def generate_neighbor_params(current_value, step=1):
    """Return a small neighborhood of numeric parameter values."""
    if not isinstance(current_value, (int, float)):
        raise ValueError("Only numeric parameters can generate neighbors")
    return [current_value - step, current_value, current_value + step]

# ---------------- Backtester wrapper ----------------

def backtester_wrapper(parsed_dsl, data_dict, INDICATOR_FUNCTIONS, initial_balance=10000):
    """
    Runs the backtester and returns a metrics dictionary for optimization.
    """
    trade_log, cash, positions, pct_change = backtester(
        parsed_dsl=parsed_dsl,
        data_dict=data_dict,
        indicator_functions=INDICATOR_FUNCTIONS,
        initial_balance=initial_balance
    )

    final_value = cash + sum(positions[t]*trade_log[-1]["price"] for t in positions if positions[t] > 0)
    metrics = {
        "pct_change": float(pct_change),
        "final_balance": float(final_value),
        "num_trades": int(len(trade_log))
    }

    return metrics

# ---------------- Grid/backtest function ----------------

def run_param_grid_backtest(parsed_dsl, param_grid, data_dict, INDICATOR_FUNCTIONS, initial_balance=10000):
    """
    Run backtests for all combinations in param_grid.
    
    Args:
        parsed_dsl: dict of parsed DSL
        param_grid: dict, keys=DSL dot-paths, values=list of values to try
        data_dict: dict of dataframes for each ticker/timeframe
        INDICATOR_FUNCTIONS: dict of indicator functions
        initial_balance: starting cash
    
    Returns:
        pd.DataFrame with all results
    """
    keys = list(param_grid.keys())
    value_lists = [param_grid[k] for k in keys]
    all_combinations = list(itertools.product(*value_lists))

    results = []

    for combo in all_combinations:
        dsl_copy = copy.deepcopy(parsed_dsl)
        for k, v in zip(keys, combo):
            path = k.split(".")
            sub = dsl_copy
            for p in path[:-1]:
                sub = sub[p]
            sub[path[-1]] = v

        metrics = backtester_wrapper(dsl_copy, data_dict, INDICATOR_FUNCTIONS, initial_balance)
        result_entry = {k: val for k, val in zip(keys, combo)}
        result_entry.update(metrics)
        results.append(result_entry)

        # Print live feedback
        print(f"Params: {result_entry}")

    return pd.DataFrame(results)

import os
import pandas as pd
from data_pulling import datapull

def load_data_dict(TICKERS, DATA_TFS, start_date, end_date, INDICATOR_FUNCTIONS, internetConnection, DATA_CSV_FOLDER):
    data_dict = {}

    for t in TICKERS:
        data_dict[t] = {}

        for tf in DATA_TFS:
            print(f"Fetching data for {t} @ {tf} between {start_date} → {end_date}")

            if internetConnection:
                df = datapull.get_data_with_indicator(
                    ticker=t,
                    start=start_date,
                    end=end_date,
                    interval=tf
                )
            else:
                csv_path = os.path.join(DATA_CSV_FOLDER, f"{t}.csv")
                if not os.path.exists(csv_path):
                    raise FileNotFoundError(f"Offline mode missing {csv_path}")

                df = pd.read_csv(csv_path)
                df["Datetime"] = pd.to_datetime(df["Datetime"], utc=True).dt.tz_localize(None)
                df = df.set_index("Datetime")
                df = df.sort_index()
                df = df.loc[start_date:end_date]

                # Add indicators offline
                for ind_name, ind_fn in INDICATOR_FUNCTIONS.items():
                    try:
                        df[ind_name] = ind_fn(df)
                    except Exception as e:
                        print(f"[WARN] Failed indicator {ind_name}: {e}")

            data_dict[t][tf] = df

    return data_dict


# ---------------- Example usage ----------------
if __name__ == "__main__":
    # Load parsed DSL from file
    with open("Core/Parsing/dsl_output.json", "r") as f:
        parsed_dsl = json.load(f)

    # Load indicator functions from registry
    with open("Core/Registries/indicatorRegistry.json") as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]

    from fetcher_calculators import indicatorEvaluator
    INDICATOR_FUNCTIONS = indicatorEvaluator.build_indicator_functions(INDICATORS_DEF)

    # Load data_dict somewhere in your workflow
    # data_dict = { "AAPL": {"1h": df }, ... }

    # Define parameter grid
    param_grid = {
        "LONG.OPEN.CONDITIONS.left.arg.period": [13, 14, 15],
        "LONG.OPEN.ARGUMENTS.stopLossPercent": [4, 6, 8]
    }
    TICKERS = parsed_dsl["LONG"]["context"]["tickers"]
    DATA_TFS = parsed_dsl["LONG"]["context"]["data_timeframes"]
    start_date = parsed_dsl["LONG"]["context"]["dateframe"]["start"]
    end_date = parsed_dsl["LONG"]["context"]["dateframe"]["end"]

    internetConnection = True   
    DATA_CSV_FOLDER = "Data_CSVs"

    data_dict = load_data_dict(
        TICKERS=TICKERS,
        DATA_TFS=DATA_TFS,
        start_date=start_date,
        end_date=end_date,
        INDICATOR_FUNCTIONS=INDICATOR_FUNCTIONS,
        internetConnection=internetConnection,
        DATA_CSV_FOLDER=DATA_CSV_FOLDER
    )


    results_df, best = run_optimizer(
    param_grid=param_grid,
    parsed_dsl=parsed_dsl,
    data_dict=data_dict,
    INDICATOR_FUNCTIONS=INDICATOR_FUNCTIONS
)

