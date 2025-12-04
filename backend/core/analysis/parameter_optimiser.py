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
# ---------------- DSL Parameter Utilities ----------------

def extract_optimizable_parameters(parsed_dsl):
    """
    Automatically finds numeric parameters inside the DSL and returns
    a dict of {dot_path: value}.
    
    Now includes keys with 'period', 'percent', 'threshold', or 'amount'.
    """
    params = {}

    def walk(node, path=""):
        if isinstance(node, dict):
            for k, v in node.items():
                new_path = f"{path}.{k}" if path else k

                if isinstance(v, (int, float)):
                    if any(keyword in k.lower() for keyword in ["period", "percent", "threshold", "amount"]):
                        params[new_path] = v

                # Recurse into nested dict/list
                walk(v, new_path)

        elif isinstance(node, list):
            for i, item in enumerate(node):
                walk(item, f"{path}[{i}]")

    walk(parsed_dsl)
    return params


def apply_overrides(dsl, overrides):
    """Override values in a nested DSL dict using dot-path keys, handling list indices."""
    dsl = copy.deepcopy(dsl)
    for path, value in overrides.items():
        node = dsl
        keys = path.split(".")
        for k in keys[:-1]:
            # Handle list indices like AND[0]
            if "[" in k and "]" in k:
                name, idx = k[:-1].split("[")
                node = node[name][int(idx)]
            else:
                node = node[k]

        # Handle last key
        last = keys[-1]
        if "[" in last and "]" in last:
            name, idx = last[:-1].split("[")
            node[name][int(idx)] = value
        else:
            node[last] = value
    return dsl


def generate_neighbor_params(current_value, step=1):
    """Return a small neighborhood of numeric parameter values."""
    if not isinstance(current_value, (int, float)):
        raise ValueError("Only numeric parameters can generate neighbors")
    return [current_value - step, current_value, current_value + step]

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

# ---------------- Backtesting Utilities ----------------

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

    final_value = cash + sum(
        positions[t] * trade_log[-1]["price"] for t in positions if positions[t] > 0
    )
    return {
        "pct_change": float(pct_change),
        "final_balance": float(final_value),
        "num_trades": int(len(trade_log))
    }

def run_param_grid_backtest(parsed_dsl, param_grid, data_dict, INDICATOR_FUNCTIONS, initial_balance=10000):
    """
    Run backtests for all combinations in param_grid.
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
                # handle list indices
                if "[" in p and "]" in p:
                    name, idx = p[:-1].split("[")
                    sub = sub[name][int(idx)]
                else:
                    sub = sub[p]

            # handle last key
            last = path[-1]
            if "[" in last and "]" in last:
                name, idx = last[:-1].split("[")
                sub[name][int(idx)] = v
            else:
                sub[last] = v

        metrics = backtester_wrapper(dsl_copy, data_dict, INDICATOR_FUNCTIONS, initial_balance)
        result_entry = {k: val for k, val in zip(keys, combo)}
        result_entry.update(metrics)
        results.append(result_entry)


    return pd.DataFrame(results)

# ---------------- Data Loading ----------------

def load_data_dict(TICKERS, DATA_TFS, start_date, end_date, INDICATOR_FUNCTIONS, internetConnection, DATA_CSV_FOLDER):
    data_dict = {}

    for t in TICKERS:
        data_dict[t] = {}
        for tf in DATA_TFS:
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

# ---------------- Optimizer (Non-Interactive) ----------------

def optimizer(
    parsed_dsl,
    param_choices=None,  # dict: {param_path: {'mode': 'auto'/'manual'/'range', 'values': list OR range info}}
    initial_balance=10000
):
    """
    Run a fully programmatic optimizer and return structured results.

    param_choices format:
    {
        "LONG.strategy.period": {"mode": "manual", "values": [10,20,30]},
        "LONG.strategy.threshold": {"mode": "range", "start": 0.01, "end": 0.05, "steps": 5},
        ...
    }

    Returns:
        dict with keys:
        - all_backtests: list of dicts {dsl, params, results}
        - best_result: dict {dsl, params, results}
    """
    # ---------------- Load indicator definitions ----------------
    current_dir = os.path.dirname(__file__)  # directory of this file
    registry_path = os.path.join(current_dir, "../registries/indicatorRegistry.json")

    with open(registry_path) as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]

    INDICATOR_FUNCTIONS = build_indicator_functions(INDICATORS_DEF)

    # ---------------- Define tickers, timeframes, dates ----------------
    TICKERS = parsed_dsl["LONG"]["context"]["tickers"]
    DATA_TFS = parsed_dsl["LONG"]["context"]["data_timeframes"]
    start_date = parsed_dsl["LONG"]["context"]["dateframe"]["start"]
    end_date = parsed_dsl["LONG"]["context"]["dateframe"]["end"]

    # ---------------- Load data ----------------
    DATA_CSV_FOLDER = "Data_CSVs"
    internetConnection = True  # Set False if offline

    data_dict = load_data_dict(
        TICKERS, DATA_TFS, start_date, end_date, INDICATOR_FUNCTIONS,
        internetConnection, DATA_CSV_FOLDER
    )

    base_params = extract_optimizable_parameters(parsed_dsl)

    # Build the param grid programmatically
    if param_choices is None:
        param_grid = auto_generate_param_grid(base_params)
    else:
        param_grid = {}
        for param, choice in param_choices.items():
            mode = choice["mode"]
            if mode == "auto":
                param_grid[param] = auto_generate_param_grid({param: base_params[param]})[param]
            elif mode == "manual":
                param_grid[param] = choice["values"]
            elif mode == "range":
                start, end, steps = choice["start"], choice["end"], choice["steps"]
                param_grid[param] = [start + (end - start) * i / (steps - 1) for i in range(steps)]
            else:
                raise ValueError(f"Invalid mode {mode} for {param}")

    # Run the backtests
    results_df = run_param_grid_backtest(parsed_dsl, param_grid, data_dict, INDICATOR_FUNCTIONS, initial_balance)
    sorted_results = results_df.sort_values("pct_change", ascending=False)
    best = sorted_results.iloc[0]

    # ---------------- Build all_backtests ----------------
    all_backtests = []
    for _, row in sorted_results.iterrows():
        combo_params = {k: row[k] for k in param_grid.keys()}
        dsl_copy = apply_overrides(parsed_dsl, combo_params)
        result_dict = row.to_dict()
        
        all_backtests.append({
            "dsl": dsl_copy,
            "params": combo_params,
            "results": result_dict
        })

    # Best result with all parameter values
    best_params = {k: best[k] for k in param_grid.keys()}
    best_dsl = apply_overrides(parsed_dsl, best_params)
    best_result_dict = best.to_dict()

    # Final structured output
    output = {
        "all_backtests": all_backtests,
        "best_result": {
            "dsl": best_dsl,
            "params": best_params,
            "results": best_result_dict
        }
    }

    return output


# # ---------------- Load DSL ----------------
# with open("backend/core/Parsing/dsl_output.json", "r") as f:
#     parsed_dsl = json.load(f)


# # ---------------- Define parameter choices ----------------
# param_choices = {
#     "LONG.OPEN.ARGUMENTS.recurringPeriod": {"mode": "manual", "values": [3,5]},
#     "LONG.OPEN.ARGUMENTS.recurringInvestAmount": {"mode": "range", "start": 0.05, "end": 0.2, "steps": 4},
#     "LONG.OPEN.CONDITIONS.right.arg.period": {"mode": "auto"}
# }


# # ---------------- Run optimizer ----------------
# output = optimizer(
#     parsed_dsl=parsed_dsl,
#     param_choices=param_choices,
#     initial_balance=10000
# )

# print(output)