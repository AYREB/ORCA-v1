import sys
import os
# Add project root so 'core' can be imported
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)
    
import copy
import json
import itertools
import random
import pandas as pd
from core.data_pulling.datapull import get_data_with_indicator
from core.backtesting.backtesterCore import backtester
from core.fetcher_calculators.indicatorEvaluator import build_indicator_functions


def _set_value_by_path(dsl, path, value):
    """
    Safely walk a nested dict/list structure using a dotted path with optional
    list indices like KEY[0]. Raises a ValueError with context when the path
    is invalid.
    """
    node = dsl
    segments = path.split(".")

    def _get_child(container, segment):
        # Handle list-style segments such as "conditions[0]"
        if "[" in segment and segment.endswith("]"):
            name, idx_str = segment[:-1].split("[", 1)
            idx = int(idx_str)

            try:
                target_list = container[name] if name else container
            except Exception:
                raise ValueError(f"Optimizer path '{path}' missing key '{segment}'")

            if not isinstance(target_list, list):
                raise ValueError(f"Optimizer path '{path}' expects list at '{segment}'")
            try:
                return target_list[idx]
            except IndexError:
                raise ValueError(f"Optimizer path '{path}' index out of range at '{segment}'")

        if not isinstance(container, dict) or segment not in container:
            raise ValueError(f"Optimizer path '{path}' missing key '{segment}'")
        return container[segment]

    for segment in segments[:-1]:
        node = _get_child(node, segment)

    last = segments[-1]
    if "[" in last and last.endswith("]"):
        name, idx_str = last[:-1].split("[", 1)
        idx = int(idx_str)
        try:
            target_list = node[name] if name else node
        except Exception:
            raise ValueError(f"Optimizer path '{path}' missing key '{last}'")
        if not isinstance(target_list, list):
            raise ValueError(f"Optimizer path '{path}' expects list at '{last}'")
        try:
            target_list[idx] = value
        except IndexError:
            raise ValueError(f"Optimizer path '{path}' index out of range at '{last}'")
    else:
        if not isinstance(node, dict):
            raise ValueError(f"Optimizer path '{path}' cannot set value on non-dict segment '{last}'")
        if last not in node:
            raise ValueError(f"Optimizer path '{path}' missing key '{last}'")
        node[last] = value
# ---------------- DSL Parameter Utilities ----------------

def extract_optimizable_parameters(parsed_dsl):
    """
    Automatically finds numeric parameters inside the DSL (ints/floats, excluding
    booleans) and returns a dict of {dot_path: value}.
    """
    params = {}

    def walk(node, path=""):
        if isinstance(node, dict):
            for k, v in node.items():
                new_path = f"{path}.{k}" if path else k

                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    params[new_path] = v

                walk(v, new_path)

        elif isinstance(node, list):
            for i, item in enumerate(node):
                item_path = f"{path}[{i}]" if path else f"[{i}]"
                if isinstance(item, (int, float)) and not isinstance(item, bool):
                    params[item_path] = item
                walk(item, item_path)

    walk(parsed_dsl)
    return params


def apply_overrides(dsl, overrides):
    """Override values in a nested DSL dict using dot-path keys, handling list indices."""
    dsl = copy.deepcopy(dsl)
    for path, value in overrides.items():
        _set_value_by_path(dsl, path, value)
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


def build_param_grid(parsed_dsl, param_choices=None):
    """
    Return a param_grid dict and the base_params used to build it.
    """
    base_params = extract_optimizable_parameters(parsed_dsl)

    if param_choices is None:
        return auto_generate_param_grid(base_params), base_params

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
        elif mode == "nochange":
            continue
        else:
            raise ValueError(f"Invalid mode {mode} for {param}")
    return param_grid, base_params


def build_param_values(parsed_dsl, param_choices=None):
    """
    Return a dict of {param_path: [candidate_values]} for genetic search.
    """
    base_params = extract_optimizable_parameters(parsed_dsl)
    values = {}

    if param_choices is None:
        grid = auto_generate_param_grid(base_params)
        return grid, base_params

    for param, choice in param_choices.items():
        mode = choice["mode"]
        if mode == "auto":
            values[param] = auto_generate_param_grid({param: base_params[param]})[param]
        elif mode == "manual":
            vals = choice.get("values", [])
            if not vals:
                raise ValueError(f"Manual values missing for {param}")
            values[param] = vals
        elif mode == "range":
            start, end, steps = choice["start"], choice["end"], choice["steps"]
            if steps < 2:
                raise ValueError(f"Range for {param} needs at least 2 steps")
            values[param] = [start + (end - start) * i / (steps - 1) for i in range(steps)]
        elif mode == "nochange":
            continue
        else:
            raise ValueError(f"Invalid mode {mode} for {param}")
    return values, base_params

# ---------------- Backtesting Utilities ----------------

def backtester_wrapper(parsed_dsl, data_dict, INDICATOR_FUNCTIONS, initial_balance=10000):
    """
    Runs the backtester and returns a metrics dictionary for optimization.
    """
    try:
        trade_log, cash, positions, pct_change = backtester(
            parsed_dsl=parsed_dsl,
            data_dict=data_dict,
            indicator_functions=INDICATOR_FUNCTIONS,
            initial_balance=initial_balance
        )
    except IndexError as e:
        raise ValueError(f"Backtester failed (likely due to insufficient data or offset/window too large): {e}")

    final_value = cash + sum(
        positions[t] * trade_log[-1]["price"] for t in positions if positions[t] > 0
    )
    return {
        "pct_change": float(pct_change),
        "final_balance": float(final_value),
        "num_trades": int(len(trade_log))
    }

def run_param_grid_backtest(parsed_dsl, param_grid, data_dict, INDICATOR_FUNCTIONS, initial_balance=10000, progress_hook=None):
    """
    Run backtests for all combinations in param_grid.
    """
    keys = list(param_grid.keys())
    value_lists = [param_grid[k] for k in keys]
    all_combinations = list(itertools.product(*value_lists))

    results = []
    errors = []
    total = len(all_combinations)
    if progress_hook:
        progress_hook(0, total)

    completed = 0
    for combo in all_combinations:
        dsl_copy = copy.deepcopy(parsed_dsl)
        for k, v in zip(keys, combo):
            _set_value_by_path(dsl_copy, k, v)

        try:
            metrics = backtester_wrapper(dsl_copy, data_dict, INDICATOR_FUNCTIONS, initial_balance)
            result_entry = {k: val for k, val in zip(keys, combo)}
            result_entry.update(metrics)
            results.append(result_entry)
        except Exception as e:
            errors.append({
                "params": {k: val for k, val in zip(keys, combo)},
                "error": str(e)
            })
            continue
        finally:
            completed += 1
            if progress_hook:
                progress_hook(completed, total)


    if not results:
        sample_err = errors[0]["error"] if errors else "Unknown error"
        raise ValueError(f"All optimizer runs failed. Sample error: {sample_err}")

    return pd.DataFrame(results), errors, total

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

            if df.empty:
                raise ValueError(f"No data found for ticker '{t}' on timeframe '{tf}' between {start_date} and {end_date}")

    return data_dict

# ---------------- Optimizer (Non-Interactive) ----------------

def optimizer(
    parsed_dsl,
    param_choices=None,  # dict: {param_path: {'mode': 'auto'/'manual'/'range', 'values': list OR range info}}
    initial_balance=10000,
    progress_hook=None,
    param_grid_override=None
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

    param_grid, base_params = (param_grid_override, extract_optimizable_parameters(parsed_dsl)) if param_grid_override else build_param_grid(parsed_dsl, param_choices)

    # Run the backtests
    results_df, errors, total_runs = run_param_grid_backtest(
        parsed_dsl,
        param_grid,
        data_dict,
        INDICATOR_FUNCTIONS,
        initial_balance,
        progress_hook=progress_hook
    )
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
        },
        "errors": errors,
        "total_runs": total_runs
    }

    return output


def genetic_optimizer(
    parsed_dsl,
    param_choices=None,
    initial_balance=10000,
    ga_settings=None,
    progress_hook=None
):
    """
    Genetic Algorithm optimizer.
    ga_settings: {
        "population": int,
        "generations": int,
        "mutation_rate": float (0-1),
        "crossover_rate": float (0-1),
        "elite_size": int
    }
    """
    ga = ga_settings or {}
    population_size = int(ga.get("population", 20))
    generations = int(ga.get("generations", 10))
    mutation_rate = float(ga.get("mutation_rate", 0.1))
    crossover_rate = float(ga.get("crossover_rate", 0.7))
    elite_size = int(ga.get("elite_size", 2))

    current_dir = os.path.dirname(__file__)  # directory of this file
    registry_path = os.path.join(current_dir, "../registries/indicatorRegistry.json")

    with open(registry_path) as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]

    INDICATOR_FUNCTIONS = build_indicator_functions(INDICATORS_DEF)

    TICKERS = parsed_dsl["LONG"]["context"]["tickers"]
    DATA_TFS = parsed_dsl["LONG"]["context"]["data_timeframes"]
    start_date = parsed_dsl["LONG"]["context"]["dateframe"]["start"]
    end_date = parsed_dsl["LONG"]["context"]["dateframe"]["end"]

    DATA_CSV_FOLDER = "Data_CSVs"
    internetConnection = True

    data_dict = load_data_dict(
        TICKERS, DATA_TFS, start_date, end_date, INDICATOR_FUNCTIONS,
        internetConnection, DATA_CSV_FOLDER
    )

    param_values, base_params = build_param_values(parsed_dsl, param_choices)
    param_keys = list(param_values.keys())

    if not param_keys:
        raise ValueError("No parameters selected for genetic optimization")

    total_runs = population_size * generations
    completed = 0
    all_results = []
    errors = []
    best_overall = None

    def random_individual():
        return {k: random.choice(param_values[k]) for k in param_keys}

    def crossover(p1, p2):
        child = {}
        for k in param_keys:
            child[k] = p1[k] if random.random() < 0.5 else p2[k]
        return child

    def mutate(ind):
        for k in param_keys:
            if random.random() < mutation_rate:
                ind[k] = random.choice(param_values[k])
        return ind

    def evaluate(individual):
        nonlocal completed, best_overall
        try:
            dsl_copy = apply_overrides(parsed_dsl, individual)
            metrics = backtester_wrapper(dsl_copy, data_dict, INDICATOR_FUNCTIONS, initial_balance)
            result_entry = {"params": individual, "results": metrics}
            all_results.append(result_entry)

            if best_overall is None or metrics["pct_change"] > best_overall["results"]["pct_change"]:
                best_overall = {"params": individual, "results": metrics, "dsl": dsl_copy}

            return metrics["pct_change"]
        except Exception as e:
            errors.append({"params": individual, "error": str(e)})
            # return very low fitness so it is discarded
            return float("-inf")
        finally:
            completed += 1
            if progress_hook:
                progress_hook(completed, total_runs)

    # Initialize population
    population = [random_individual() for _ in range(population_size)]
    fitness_scores = [evaluate(ind) for ind in population]

    for _ in range(1, generations):
        # Selection (tournament of size 2)
        selected = []
        for _ in range(population_size):
            i, j = random.sample(range(population_size), 2)
            winner = population[i] if fitness_scores[i] > fitness_scores[j] else population[j]
            selected.append(winner)

        # Elitism
        ranked = sorted(zip(population, fitness_scores), key=lambda x: x[1], reverse=True)
        elites = [copy.deepcopy(ind) for ind, _ in ranked[:elite_size]]

        # Crossover and mutation
        new_population = elites[:]
        while len(new_population) < population_size:
            p1, p2 = random.sample(selected, 2)
            child = crossover(p1, p2) if random.random() < crossover_rate else copy.deepcopy(random.choice([p1, p2]))
            child = mutate(child)
            new_population.append(child)

        population = new_population
        fitness_scores = [evaluate(ind) for ind in population]

    if best_overall is None:
        sample_err = errors[0]["error"] if errors else "Unknown error"
        raise ValueError(f"Genetic optimizer produced no successful runs. Sample error: {sample_err}")

    all_backtests = []
    for entry in all_results:
        params = entry["params"]
        metrics = entry["results"]
        dsl_copy = apply_overrides(parsed_dsl, params)
        all_backtests.append({
            "dsl": dsl_copy,
            "params": params,
            "results": metrics
        })

    output = {
        "all_backtests": all_backtests,
        "best_result": best_overall,
        "errors": errors,
        "total_runs": total_runs
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
