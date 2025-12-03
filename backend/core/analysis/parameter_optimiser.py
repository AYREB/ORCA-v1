import sys
import os

# Add project root so 'core' can be imported
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import copy
import json
import itertools
import pandas as pd
from core.data_pulling.datapull import get_data_with_indicator
from core.backtesting.backtesterCore import backtester
from core.fetcher_calculators.indicatorEvaluator import build_indicator_functions


def cli_build_param_grid(parsed_dsl):
    """
    Simple CLI that lets you choose which DSL parameters to optimize.
    Returns a param_grid dict.
    """
    # Step 1: find numeric optimizable params
    all_params = extract_optimizable_parameters(parsed_dsl)

    print("\n=== AVAILABLE OPTIMIZABLE PARAMETERS ===")
    for i, (k, v) in enumerate(all_params.items()):
        print(f"{i}: {k}  (current={v})")

    print("\nEnter the numbers of the parameters you want to optimize (comma-separated).")
    print("Example: 0,3,5")
    selected = input("Choose: ").strip()

    indices = [int(x) for x in selected.split(",")]

    chosen = {}

    for idx in indices:
        key = list(all_params.keys())[idx]
        current_value = all_params[key]
        print(f"\n--- Parameter: {key} (current={current_value}) ---")

        # Ask for how to generate values
        mode = input(
            "Choose mode: (a) auto ±5 (int) / ±20% (float), "
            "(m) manual list, (r) range: "
        ).strip().lower()

        if mode == "a":
            # Use the existing auto grid generator
            auto_grid = auto_generate_param_grid({key: current_value})
            chosen[key] = auto_grid[key]

        elif mode == "m":
            raw = input("Enter comma-separated values: ").strip()
            chosen[key] = [float(x) for x in raw.split(",")]

        elif mode == "r":
            start = float(input("Start: "))
            end = float(input("End: "))
            steps = int(input("Number of steps: "))
            chosen[key] = list(
                start + (end - start) * i / (steps - 1)
                for i in range(steps)
            )
        else:
            print("Invalid, skipping.")

    print("\n=== FINAL PARAM GRID ===")
    print(json.dumps(chosen, indent=4))

    return chosen


def run_optimizer(param_grid, parsed_dsl, data_dict, INDICATOR_FUNCTIONS):

    base_params = extract_optimizable_parameters(parsed_dsl)
    print("\nDetected DSL parameters:", base_params)

    if param_grid is None:
        print("\nAuto-generating grid...")
        param_grid = auto_generate_param_grid(base_params)
    else:
        print("\nUsing manual grid:", param_grid)

    results = run_param_grid_backtest(
        parsed_dsl=parsed_dsl,
        param_grid=param_grid,
        data_dict=data_dict,
        INDICATOR_FUNCTIONS=INDICATOR_FUNCTIONS
    )

    sorted_results = results.sort_values("pct_change", ascending=False)

    print("\n===== TOP RESULTS =====")
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

def auto_generate_param_grid(base_params):
    param_grid = {}
    for path, value in base_params.items():
        if isinstance(value, int):
            param_grid[path] = [value - 5, value, value + 5]
        elif isinstance(value, float):
            param_grid[path] = [
                round(value * 0.8, 3),
                value,
                round(value * 1.2, 3)
            ]
    return param_grid



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

def extract_optimizable_parameters(parsed_dsl):
    """
    Automatically finds numeric parameters inside the DSL and returns
    a dict of {dot_path: value}.
    """
    params = {}

    def walk(node, path=""):
        if isinstance(node, dict):
            for k, v in node.items():
                new_path = f"{path}.{k}" if path else k
                if isinstance(v, (int, float)):
                    # Only include parameters that look optimizable
                    if "period" in k.lower() or "percent" in k.lower() or "threshold" in k.lower():
                        params[new_path] = v
                walk(v, new_path)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                walk(item, f"{path}[{i}]")

    walk(parsed_dsl)
    return params


def load_data_dict(TICKERS, DATA_TFS, start_date, end_date, INDICATOR_FUNCTIONS, internetConnection, DATA_CSV_FOLDER):
    data_dict = {}

    for t in TICKERS:
        data_dict[t] = {}

        for tf in DATA_TFS:
            print(f"Fetching data for {t} @ {tf} between {start_date} → {end_date}")

            if internetConnection:
                df = get_data_with_indicator(
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


def initialize_and_run_parameter_optimizer():
    with open("backend/core/parsing/dsl_output.json", "r") as f:
        parsed_dsl = json.load(f)

    with open("backend/core/registries/indicatorRegistry.json") as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]

    INDICATOR_FUNCTIONS = build_indicator_functions(INDICATORS_DEF)

    TICKERS = parsed_dsl["LONG"]["context"]["tickers"]
    DATA_TFS = parsed_dsl["LONG"]["context"]["data_timeframes"]
    start_date = parsed_dsl["LONG"]["context"]["dateframe"]["start"]
    end_date = parsed_dsl["LONG"]["context"]["dateframe"]["end"]

    internetConnection = True   
    DATA_CSV_FOLDER = "Data_CSVs"

    data_dict = load_data_dict(
        TICKERS, DATA_TFS, start_date, end_date,
        INDICATOR_FUNCTIONS, internetConnection, DATA_CSV_FOLDER
    )

    #param_grid = None                          # auto-generate grid
    param_grid = cli_build_param_grid(parsed_dsl)  # <<< ENABLE CLI

    results_df, best = run_optimizer(
        param_grid=param_grid,
        parsed_dsl=parsed_dsl,
        data_dict=data_dict,
        INDICATOR_FUNCTIONS=INDICATOR_FUNCTIONS
    )


initialize_and_run_parameter_optimizer()