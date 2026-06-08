import operator
import json
import os

import numpy as np
import pandas as pd

from core.fetcher_calculators import indicatorCalculators

# ---------------- OPERATORS ---------------- #

OPS = {
    ">":  operator.gt,
    "<":  operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}

# ---------------- INDICATOR REGISTRY ---------------- #

_registry_path = os.path.join(os.path.dirname(__file__), "../../registries/indicatorRegistry.json")
with open(_registry_path) as _f:
    _INDICATOR_REGISTRY = json.load(_f).get("INDICATORS", {})

# ---------------- INTERNAL HELPERS ---------------- #

def _default_tf(allowed_timeframes):
    return allowed_timeframes[0] if allowed_timeframes else "1h"


def _eval_price(func_args, merged_args, current_ticker, context_index, data_dict, execution_tf):
    if current_ticker not in data_dict or execution_tf not in data_dict[current_ticker]:
        return None, None
    try:
        val = indicatorCalculators.get_price(
            data_dict[current_ticker][execution_tf],
            field=merged_args.get("OHLC", "close"),
            offset=merged_args.get("offset", 0),
            context={"i": context_index}
        )
        return val, None
    except Exception:
        return None, None


def _eval_volume(merged_args, current_ticker, timeframe, context_index, data_dict):
    if current_ticker not in data_dict or timeframe not in data_dict[current_ticker]:
        return None, None
    try:
        val = indicatorCalculators.get_volume(
            data_dict[current_ticker][timeframe],
            offset=merged_args.get("offset", 0),
            context={"i": context_index}
        )
        return val, None
    except Exception:
        return None, None


def _eval_custom_indicator(calculate_fn, merged_args, offset, current_ticker, context_index,
                           data_dict, execution_tf):
    """
    Evaluate a user-authored custom indicator. Mirrors `_eval_price` — always runs
    against `execution_tf` (never `timeframe`) so `context["i"]` aligns positionally
    with the row the main loop is on, and uses the exact `(data, context, **params)`
    contract `api.indicator_sandbox.compile_indicator` produces.
    """
    if current_ticker not in data_dict or execution_tf not in data_dict[current_ticker]:
        return None, None
    try:
        i = context_index - int(offset or 0)
    except (TypeError, ValueError):
        return None, None
    if i < 0:
        return None, None
    try:
        value = calculate_fn(data_dict[current_ticker][execution_tf], {"i": i}, **merged_args)
    except Exception:
        return None, None

    if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)):
        return None, None
    value = float(value)
    if np.isnan(value):
        return None, None
    return value, None


# ---------------- OPERAND EVALUATOR ---------------- #

def eval_operand(op, row, indicator_functions, data_dict, ticker=None,
                 context_index=None, global_timeframe="1h", allowed_timeframes=None,
                 execution_tf=None, custom_indicator_functions=None):
    """
    Evaluate a DSL operand node and return (value, timeframe).
    Returns (None, None) if the operand cannot be evaluated.
    """
    # Literal
    if "value" in op:
        return op["value"], None

    # Column reference
    if "ident" in op:
        try:
            return row[op["ident"]], None
        except Exception:
            return None, None

    # Arithmetic
    if "op" in op:
        lv, _ = eval_operand(op["left"],  row, indicator_functions, data_dict, ticker,
                              context_index, global_timeframe, allowed_timeframes, execution_tf,
                              custom_indicator_functions)
        rv, _ = eval_operand(op["right"], row, indicator_functions, data_dict, ticker,
                              context_index, global_timeframe, allowed_timeframes, execution_tf,
                              custom_indicator_functions)
        if lv is None or rv is None:
            return None, None
        try:
            return {"*": lv * rv, "/": lv / rv, "+": lv + rv, "-": lv - rv}[op["op"]], None
        except Exception:
            return None, None

    # Indicator / function
    if "func" in op:
        func_name = op["func"]
        func_args = op.get("arg", {})

        # Normalise args to dict
        if not isinstance(func_args, dict):
            if isinstance(func_args, list) and func_args and isinstance(func_args[0], dict):
                func_args = func_args[0]
            else:
                raise TypeError(f"Indicator args for '{func_name}' must be a dict, got {type(func_args)}")

        current_ticker = func_args.pop("ticker", ticker)

        merged_args = {**_INDICATOR_REGISTRY.get(func_name, {}).get("defaults", {}), **func_args}
        timeframe    = merged_args.pop("timeframe", global_timeframe)
        offset       = merged_args.pop("offset", 0)

        upper = func_name.upper()

        if upper == "PRICE":
            return _eval_price(func_args, merged_args, current_ticker, context_index, data_dict, execution_tf)

        if upper == "VOLUME":
            return _eval_volume(merged_args, current_ticker, timeframe, context_index, data_dict)

        # Custom (user-authored) indicators — dispatched by exact-case name, always
        # against execution_tf, using the (data, context, **params) contract. Must
        # come before the native allowed_timeframes/indicator_functions lookup below,
        # since custom indicators never go through data_dict[ticker][timeframe] or the
        # vectorized-series contract.
        if custom_indicator_functions and func_name in custom_indicator_functions:
            return _eval_custom_indicator(
                custom_indicator_functions[func_name], merged_args, offset,
                current_ticker, context_index, data_dict, execution_tf
            )

        # Remove duplicate timeframe pop that existed in original
        if allowed_timeframes and timeframe not in allowed_timeframes:
            raise ValueError(f"Invalid timeframe '{timeframe}'. Must be one of {allowed_timeframes}")

        if current_ticker not in data_dict or timeframe not in data_dict[current_ticker]:
            return None, None

        func = indicator_functions.get(func_name)
        if func is None:
            raise ValueError(f"Unknown indicator function: '{func_name}'")

        indicator_df = data_dict[current_ticker][timeframe]
        last_idx = indicator_df.index.asof(row.name)
        if pd.isna(last_idx):
            return None, None

        series = indicator_df.loc[:last_idx]["Close"]

        try:
            value = func(series, **merged_args)
        except Exception:
            return None, None

        if isinstance(value, pd.Series):
            if len(value) <= offset:
                return None, timeframe
            value = value.iloc[-1] if offset == 0 else value.iloc[-1 - offset]

        if value is None or (isinstance(value, float) and np.isnan(value)):
            return None, timeframe

        return value, timeframe

    return None, None


# ---------------- CONDITION EVALUATORS ---------------- #

def evaluate_condition(cond, row, indicator_functions, data_dict=None, ticker=None,
                       context_index=None, allowed_timeframes=None, execution_tf=None,
                       debug=False, custom_indicator_functions=None):
    """
    Evaluate a DSL condition node and return a boolean.
    Supports AND / OR recursion and leaf comparisons.
    """
    if "AND" in cond:
        return all(
            evaluate_condition(c, row, indicator_functions, data_dict, ticker,
                               context_index, allowed_timeframes, execution_tf, debug=debug,
                               custom_indicator_functions=custom_indicator_functions)
            for c in cond["AND"]
        )

    if "OR" in cond:
        return any(
            evaluate_condition(c, row, indicator_functions, data_dict, ticker,
                               context_index, allowed_timeframes, execution_tf, debug=debug,
                               custom_indicator_functions=custom_indicator_functions)
            for c in cond["OR"]
        )

    # Leaf
    tf = _default_tf(allowed_timeframes)
    shared = dict(indicator_functions=indicator_functions, data_dict=data_dict, ticker=ticker,
                  context_index=context_index, global_timeframe=tf,
                  allowed_timeframes=allowed_timeframes, execution_tf=execution_tf,
                  custom_indicator_functions=custom_indicator_functions)

    lv, ltf = eval_operand(cond["left"],  row, **shared)
    rv, _   = eval_operand(cond["right"], row, **shared)

    if lv is None or rv is None:
        if debug:
            print(f"[CONDITION] Could not evaluate — L={lv} R={rv}")
        return False

    op_str = cond["operator"]
    if op_str not in OPS:
        raise ValueError(f"Unsupported operator: '{op_str}'")

    result = OPS[op_str](lv, rv)

    if debug:
        print(f"[CONDITION] {lv} {op_str} {rv} -> {result}  (tf={ltf})")

    return bool(result)


def evaluate_condition_capture(cond, row, indicator_functions, data_dict, ticker,
                               context_index, allowed_timeframes, execution_tf,
                               custom_indicator_functions=None):
    """
    Evaluate a DSL condition and return (result, left_val, right_val, timeframe).
    Useful for trade logging and debugging.
    """
    if "AND" in cond:
        results = [
            evaluate_condition_capture(c, row, indicator_functions, data_dict, ticker,
                                       context_index, allowed_timeframes, execution_tf,
                                       custom_indicator_functions=custom_indicator_functions)
            for c in cond["AND"]
        ]
        first = results[0] if results else (None, None, None, None)
        return all(r[0] for r in results), first[1], first[2], first[3]

    if "OR" in cond:
        results = [
            evaluate_condition_capture(c, row, indicator_functions, data_dict, ticker,
                                       context_index, allowed_timeframes, execution_tf,
                                       custom_indicator_functions=custom_indicator_functions)
            for c in cond["OR"]
        ]
        first = results[0] if results else (None, None, None, None)
        return any(r[0] for r in results), first[1], first[2], first[3]

    # Leaf
    tf = _default_tf(allowed_timeframes)
    shared = dict(indicator_functions=indicator_functions, data_dict=data_dict, ticker=ticker,
                  context_index=context_index, global_timeframe=tf,
                  allowed_timeframes=allowed_timeframes, execution_tf=execution_tf,
                  custom_indicator_functions=custom_indicator_functions)

    lv, ltf = eval_operand(cond["left"],  row, **shared)
    rv, _   = eval_operand(cond["right"], row, **shared)

    if lv is None or rv is None:
        return False, lv, rv, ltf

    return bool(OPS[cond["operator"]](lv, rv)), lv, rv, ltf