import importlib
# ---------------- Evaluate indicators ----------------
# This module dynamically maps indicator names from JSON to their functions
# and provides a helper to evaluate them.

# indicatorEvaluator.py
def build_indicator_functions(INDICATORS_DEF, module_path="core.fetcher_calculators.indicatorCalculators"):
    """
    Build a dictionary mapping indicator names to functions defined in a module, dynamically.
    
    Args:
        INDICATORS_DEF (dict): Indicator definitions from JSON
        module_path (str): Python module path where indicator functions are defined
    
    Returns:
        dict: Mapping of indicator names to functions
    """
    # dynamically import the module
    module = importlib.import_module(module_path)
    
    mapping = {}
    for name, info in INDICATORS_DEF.items():
        func_name = info["function"]
        if not hasattr(module, func_name):
            raise ValueError(f"Function '{func_name}' for indicator '{name}' not found in {module_path}")
        mapping[name] = getattr(module, func_name)
    return mapping


def evaluate_indicator(ind_name, series, INDICATOR_FUNCTIONS, **kwargs):
    """
    Evaluate an indicator function dynamically.

    Args:
        ind_name (str): Name of the indicator (e.g., "RSI").
        series (pd.Series): Price series to evaluate on.
        INDICATOR_FUNCTIONS (dict): Mapping of indicator names to functions.
        **kwargs: Additional arguments for the indicator function.

    Returns:
        pd.Series: Result of the indicator computation.
    """
    func = INDICATOR_FUNCTIONS.get(ind_name)
    if not func:
        raise ValueError(f"Unknown indicator: {ind_name}")
    return func(series, **kwargs)
