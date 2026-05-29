import copy
import itertools
import json
import os
import random
import sys
 
import pandas as pd
 
# Ensure project root is on path
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)
 
from core.backtesting.backtesterCore import backtester
from core.data_pulling.datapull import get_data_with_indicator
from core.fetcher_calculators.indicatorEvaluator import build_indicator_functions
from core.main import apply_default_arguments, merge_indicator_defaults
from core.parsing.extractingTickers import collect_timeframes_from_dsl, extract_execution_timeframe
from core.parsing.validateParsedDSL import validate_parsed_dsl
 
# ---------------- REGISTRY ---------------- #
 
_REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "../registries/indicatorRegistry.json")
BLOCKED_OPTIMIZER_PARAM_NAMES = {"spread"}


def is_optimizable_parameter_path(path):
    """Return False for numeric DSL fields that optimizers must never tune."""
    normalized = path.replace("]", "")
    last_segment = normalized.split(".")[-1].split("[")[-1].lower()
    return last_segment not in BLOCKED_OPTIMIZER_PARAM_NAMES


def filter_optimizable_parameter_map(param_map):
    return {path: value for path, value in param_map.items() if is_optimizable_parameter_path(path)}
 
def _load_indicator_functions():
    with open(_REGISTRY_PATH) as f:
        return build_indicator_functions(json.load(f)["INDICATORS"])
 
# ---------------- DSL HELPERS ---------------- #
 
def _set_value_by_path(dsl, path, value):
    """Set a value in a nested dict/list using a dotted path with optional list indices (e.g. key[0])."""
    def _get_child(container, segment):
        if "[" in segment and segment.endswith("]"):
            name, idx = segment[:-1].split("[", 1)
            target = container[name] if name else container
            if not isinstance(target, list):
                raise ValueError(f"Path '{path}': expected list at '{segment}'")
            return target[int(idx)]
        if not isinstance(container, dict) or segment not in container:
            raise ValueError(f"Path '{path}': missing key '{segment}'")
        return container[segment]
 
    segments = path.split(".")
    node = dsl
    for segment in segments[:-1]:
        node = _get_child(node, segment)
 
    last = segments[-1]
    if "[" in last and last.endswith("]"):
        name, idx = last[:-1].split("[", 1)
        target = node[name] if name else node
        if not isinstance(target, list):
            raise ValueError(f"Path '{path}': expected list at '{last}'")
        target[int(idx)] = value
    else:
        if not isinstance(node, dict) or last not in node:
            raise ValueError(f"Path '{path}': missing key '{last}'")
        node[last] = value
 
 
def apply_overrides(dsl, overrides):
    """Return a deep copy of dsl with dot-path overrides applied."""
    dsl = copy.deepcopy(dsl)
    for path, value in overrides.items():
        _set_value_by_path(dsl, path, value)
    return dsl
 
 
def extract_optimizable_parameters(parsed_dsl):
    """Walk the DSL and return {dot_path: value} for all numeric (non-bool) leaves."""
    params = {}
 
    def walk(node, path=""):
        if isinstance(node, dict):
            for k, v in node.items():
                new_path = f"{path}.{k}" if path else k
                if isinstance(v, (int, float)) and not isinstance(v, bool) and is_optimizable_parameter_path(new_path):
                    params[new_path] = v
                walk(v, new_path)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                item_path = f"{path}[{i}]"
                if isinstance(item, (int, float)) and not isinstance(item, bool) and is_optimizable_parameter_path(item_path):
                    params[item_path] = item
                walk(item, item_path)
 
    walk(parsed_dsl)
    return params
 
# ---------------- PARAM GRID BUILDERS ---------------- #
 
def _auto_values(path, value):
    if isinstance(value, int):
        return [value - 5, value, value + 5]
    return [round(value * 0.8, 3), value, round(value * 1.2, 3)]
 
 
def _range_values(choice):
    start, end, steps = choice["start"], choice["end"], choice["steps"]
    if steps < 2:
        raise ValueError(f"Range needs at least 2 steps")
    return [start + (end - start) * i / (steps - 1) for i in range(steps)]
 
 
def _resolve_choice(path, value, choice):
    mode = choice["mode"]
    if mode == "auto":    return _auto_values(path, value)
    if mode == "manual":  return choice["values"]
    if mode == "range":   return _range_values(choice)
    if mode == "nochange": return None
    raise ValueError(f"Invalid mode '{mode}' for '{path}'")
 
 
def build_param_grid(parsed_dsl, param_choices=None):
    """Return (param_grid, base_params) for grid-search optimization."""
    base_params = extract_optimizable_parameters(parsed_dsl)
    if param_choices is None:
        return {p: _auto_values(p, v) for p, v in base_params.items()}, base_params
 
    grid = {}
    for path, choice in param_choices.items():
        if not is_optimizable_parameter_path(path):
            continue
        values = _resolve_choice(path, base_params.get(path), choice)
        if values is not None:
            grid[path] = values
    return grid, base_params
 
 
def build_param_values(parsed_dsl, param_choices=None):
    """Return (param_values, base_params) for genetic optimization."""
    return build_param_grid(parsed_dsl, param_choices)  # identical structure
 
# ---------------- DATA LOADING ---------------- #
 
def load_data_dict(tickers, timeframes, start_date, end_date,
                   indicator_functions, internet=True, csv_folder="Data_CSVs"):
    data_dict = {}
    for ticker in tickers:
        data_dict[ticker] = {}
        for tf in timeframes:
            if internet:
                df = get_data_with_indicator(ticker=ticker, start=start_date, end=end_date, interval=tf)
            else:
                csv_path = os.path.join(csv_folder, f"{ticker}.csv")
                if not os.path.exists(csv_path):
                    raise FileNotFoundError(f"Offline mode: missing {csv_path}")
                df = pd.read_csv(csv_path)
                df["Datetime"] = pd.to_datetime(df["Datetime"], utc=True).dt.tz_localize(None)
                df = df.set_index("Datetime").sort_index().loc[start_date:end_date]
                for name, fn in indicator_functions.items():
                    try:
                        df[name] = fn(df)
                    except Exception as e:
                        print(f"[WARN] Indicator '{name}' failed for {ticker}/{tf}: {e}")
 
            if df.empty:
                raise ValueError(f"No data for '{ticker}' on '{tf}' between {start_date} and {end_date}")
            data_dict[ticker][tf] = df
    return data_dict
 
 
def _context(parsed_dsl):
    """Extract strategy context regardless of LONG/SHORT key."""
    key = "LONG" if "LONG" in parsed_dsl else "SHORT"
    return parsed_dsl[key]["context"]
 
 
def _prepare(parsed_dsl, internet=True, csv_folder="Data_CSVs"):
    """Validate DSL, load indicators and data. Returns (parsed_dsl, data_dict, indicator_functions)."""
    parsed_dsl = apply_default_arguments(parsed_dsl)
    parsed_dsl = merge_indicator_defaults(parsed_dsl)
    validate_parsed_dsl(parsed_dsl)
 
    indicator_functions = _load_indicator_functions()
    ctx = _context(parsed_dsl)
    execution_tf = extract_execution_timeframe(parsed_dsl)
    timeframes = collect_timeframes_from_dsl(parsed_dsl, execution_tf)
 
    data_dict = load_data_dict(
        ctx["tickers"], timeframes,
        ctx["dateframe"]["start"], ctx["dateframe"]["end"],
        indicator_functions, internet, csv_folder
    )
    return parsed_dsl, data_dict, indicator_functions
 
# ---------------- BACKTESTER WRAPPER ---------------- #
 
def _run_backtest(dsl, data_dict, indicator_functions, initial_balance):
    """Run a single backtest and return a metrics dict."""
    try:
        trade_log, _, _, pct_change = backtester(
            parsed_dsl=dsl,
            data_dict=data_dict,
            indicator_functions=indicator_functions,
            initial_balance=initial_balance
        )
    except IndexError as e:
        raise ValueError(f"Backtester failed (insufficient data or window too large): {e}")
 
    return {
        "pct_change":     float(pct_change),
        "final_balance":  float(initial_balance * (1 + pct_change / 100)),
        "num_trades":     int(len(trade_log)),
    }
 
# ---------------- GRID SEARCH ---------------- #
 
def run_param_grid_backtest(parsed_dsl, param_grid, data_dict, indicator_functions,
                            initial_balance=10000, progress_hook=None):
    """Run backtests for every combination in param_grid. Returns (results_df, errors, total)."""
    param_grid = filter_optimizable_parameter_map(param_grid)
    if not param_grid:
        raise ValueError("No parameters selected for optimization")

    keys = list(param_grid.keys())
    combos = list(itertools.product(*[param_grid[k] for k in keys]))
    total = len(combos)
    results, errors = [], []
 
    for idx, combo in enumerate(combos, 1):
        overrides = dict(zip(keys, combo))
        dsl_copy = apply_overrides(parsed_dsl, overrides)
        try:
            metrics = _run_backtest(dsl_copy, data_dict, indicator_functions, initial_balance)
            results.append({**overrides, **metrics})
        except Exception as e:
            errors.append({"params": overrides, "error": str(e)})
        if progress_hook:
            progress_hook(idx, total)
 
    if not results:
        sample = errors[0]["error"] if errors else "Unknown error"
        raise ValueError(f"All optimizer runs failed. Sample error: {sample}")
 
    return pd.DataFrame(results), errors, total
 
 
def optimizer(parsed_dsl, param_choices=None, initial_balance=10000,
              progress_hook=None, param_grid_override=None):
    """
    Grid-search optimizer. Returns structured results dict.
 
    param_choices format:
        { "LONG.OPEN.CONDITIONS.right.arg.period": {"mode": "auto"} }
        { "LONG.OPEN.ARGUMENTS.recurringPeriod":   {"mode": "manual", "values": [3,5,10]} }
        { "LONG.OPEN.ARGUMENTS.threshold":         {"mode": "range", "start": 0.01, "end": 0.05, "steps": 5} }
    """
    parsed_dsl, data_dict, indicator_functions = _prepare(parsed_dsl)
 
    if param_grid_override:
        param_grid = param_grid_override
        base_params = extract_optimizable_parameters(parsed_dsl)
    else:
        param_grid, base_params = build_param_grid(parsed_dsl, param_choices)

    if not param_grid:
        raise ValueError("No parameters selected for optimization")
 
    results_df, errors, total_runs = run_param_grid_backtest(
        parsed_dsl, param_grid, data_dict, indicator_functions, initial_balance, progress_hook
    )
 
    sorted_df = results_df.sort_values("pct_change", ascending=False)
    keys = list(param_grid.keys())
 
    all_backtests = [
        {
            "dsl":     apply_overrides(parsed_dsl, {k: row[k] for k in keys}),
            "params":  {k: row[k] for k in keys},
            "results": row.to_dict(),
        }
        for _, row in sorted_df.iterrows()
    ]
 
    best_row = sorted_df.iloc[0]
    best_params = {k: best_row[k] for k in keys}
 
    return {
        "all_backtests": all_backtests,
        "best_result": {
            "dsl":     apply_overrides(parsed_dsl, best_params),
            "params":  best_params,
            "results": best_row.to_dict(),
        },
        "errors":     errors,
        "total_runs": total_runs,
    }
 
# ---------------- GENETIC OPTIMIZER ---------------- #
 
def genetic_optimizer(parsed_dsl, param_choices=None, initial_balance=10000,
                      ga_settings=None, progress_hook=None):
    """
    Genetic Algorithm optimizer.
 
    ga_settings keys: population, generations, mutation_rate, crossover_rate, elite_size
    """
    parsed_dsl, data_dict, indicator_functions = _prepare(parsed_dsl)
 
    ga = ga_settings or {}
    population_size = int(ga.get("population",     20))
    generations     = int(ga.get("generations",    10))
    mutation_rate   = float(ga.get("mutation_rate",  0.1))
    crossover_rate  = float(ga.get("crossover_rate", 0.7))
    elite_size      = int(ga.get("elite_size",      2))
 
    param_values, _ = build_param_values(parsed_dsl, param_choices)
    param_keys = list(param_values.keys())
    if not param_keys:
        raise ValueError("No parameters selected for genetic optimization")
 
    total_runs  = population_size * generations
    completed   = 0
    all_results = []
    errors      = []
    best        = None
 
    # ---- GA primitives ---- #
    def random_individual():
        return {k: random.choice(param_values[k]) for k in param_keys}
 
    def crossover(p1, p2):
        return {k: (p1[k] if random.random() < 0.5 else p2[k]) for k in param_keys}
 
    def mutate(ind):
        return {k: (random.choice(param_values[k]) if random.random() < mutation_rate else v)
                for k, v in ind.items()}
 
    def evaluate(individual):
        nonlocal completed, best
        try:
            dsl_copy = apply_overrides(parsed_dsl, individual)
            metrics  = _run_backtest(dsl_copy, data_dict, indicator_functions, initial_balance)
            entry    = {"params": individual, "results": metrics}
            all_results.append(entry)
            if best is None or metrics["pct_change"] > best["results"]["pct_change"]:
                best = {**entry, "dsl": dsl_copy}
            return metrics["pct_change"]
        except Exception as e:
            errors.append({"params": individual, "error": str(e)})
            return float("-inf")
        finally:
            completed += 1
            if progress_hook:
                progress_hook(completed, total_runs)
 
    # ---- Evolution ---- #
    population     = [random_individual() for _ in range(population_size)]
    fitness_scores = [evaluate(ind) for ind in population]
 
    for _ in range(1, generations):
        ranked  = sorted(zip(population, fitness_scores), key=lambda x: x[1], reverse=True)
        elites  = [copy.deepcopy(ind) for ind, _ in ranked[:elite_size]]
        selected = [
            population[i] if fitness_scores[i] > fitness_scores[j] else population[j]
            for i, j in (random.sample(range(population_size), 2) for _ in range(population_size))
        ]
 
        new_population = elites[:]
        while len(new_population) < population_size:
            p1, p2 = random.sample(selected, 2)
            child  = crossover(p1, p2) if random.random() < crossover_rate else copy.deepcopy(random.choice([p1, p2]))
            new_population.append(mutate(child))
 
        population     = new_population
        fitness_scores = [evaluate(ind) for ind in population]
 
    if best is None:
        sample = errors[0]["error"] if errors else "Unknown error"
        raise ValueError(f"Genetic optimizer produced no successful runs. Sample error: {sample}")
 
    return {
        "all_backtests": [
            {"dsl": apply_overrides(parsed_dsl, e["params"]), **e}
            for e in all_results
        ],
        "best_result": best,
        "errors":      errors,
        "total_runs":  total_runs,
    }
