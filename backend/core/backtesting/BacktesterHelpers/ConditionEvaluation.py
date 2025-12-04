import operator
import json
import pandas as pd
import numpy as np
from core.fetcher_calculators import indicatorCalculators
import os

# Operator mapping (kept as callables)
OPS = {
    ">": operator.gt,
    "<": operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}

current_dir = os.path.dirname(__file__)  # directory of this file
registry_path = os.path.join(current_dir, "../../registries/indicatorRegistry.json")

# load registry once (optional)
with open(registry_path) as f:
    _INDICATOR_REGISTRY = json.load(f).get("INDICATORS", {})


def eval_operand(op, row, indicator_functions, data_dict, ticker=None,
                 context_index=None, global_timeframe="1h", allowed_timeframes=None,
                 execution_tf=None):
    """
    Evaluate an operand and return (value, timeframe).
    - Literals/idents/arithmetic -> returns (scalar, None)
    - Function/indicator -> returns (scalar, timeframe_used)
    If operand cannot be evaluated -> returns (None, None).
    """
    # Literal value
    if "value" in op:
        return op["value"], None

    # Column reference
    if "ident" in op:
        try:
            val = row[op["ident"]]
            return val, None
        except Exception:
            return None, None

    # Arithmetic operation
    if "op" in op:
        left_val, _ = eval_operand(op["left"], row, indicator_functions, data_dict, ticker,
                                   context_index, global_timeframe, allowed_timeframes, execution_tf)
        right_val, _ = eval_operand(op["right"], row, indicator_functions, data_dict, ticker,
                                    context_index, global_timeframe, allowed_timeframes, execution_tf)
        if left_val is None or right_val is None:
            return None, None
        try:
            result = {
                "*": left_val * right_val,
                "/": left_val / right_val,
                "+": left_val + right_val,
                "-": left_val - right_val
            }[op["op"]]
        except Exception:
            return None, None
        return result, None

    # Function / indicator
    if "func" in op:
        func_name = op["func"]

        # Arguments expected as dict
        func_args = op.get("arg", {})
        if not isinstance(func_args, dict):
            # defensive: if list with single dict, convert; otherwise error
            if isinstance(func_args, list) and func_args and isinstance(func_args[0], dict):
                func_args = func_args[0]
            else:
                raise TypeError(f"Indicator arguments for {func_name} must be dict, got {type(func_args)}")

        current_ticker = ticker
        # optional ticker override inside args
        if "ticker" in func_args:
            current_ticker = func_args.pop("ticker")

        # merge with registry defaults
        registry_info = _INDICATOR_REGISTRY.get(func_name, {})
        merged_args = {**registry_info.get("defaults", {}), **func_args}

        # pop timeframe once only
        timeframe = merged_args.pop("timeframe", global_timeframe)

        # pop offset
        offset = merged_args.pop("offset", 0)

        # PRICE special case
        if func_name.upper() == "PRICE":
            field = merged_args.get("OHLC", "close")
            offset = merged_args.get("offset", 0)
            # Make sure we select the correct timeframe
            if current_ticker not in data_dict or execution_tf not in data_dict[current_ticker]:
                return None, None
            df = data_dict[current_ticker][execution_tf]
            try:
                val = indicatorCalculators.get_price(
                    df,
                    field=field,
                    offset=offset,
                    context={"i": context_index}
                )
            except Exception:
                return None, None
            return val, None
        
        # VOLUME special case (needs full DataFrame / Volume column)
        if func_name.upper() == "VOLUME":
            offset = merged_args.get("offset", 0)
            if current_ticker not in data_dict or timeframe not in data_dict[current_ticker]:
                return None, None
            try:
                val = indicatorCalculators.get_volume(
                    data_dict[current_ticker][timeframe],
                    offset=offset,
                    context={"i": context_index}
                )
            except Exception:
                return None, None
            return val, None

        # timeframe choice: prefer arg.timeframe, else global_timeframe
        timeframe = merged_args.pop("timeframe", global_timeframe)
        if allowed_timeframes and timeframe not in allowed_timeframes:
            # invalid timeframe requested
            raise ValueError(f"Invalid timeframe '{timeframe}'. Must be one of {allowed_timeframes}")

        # ensure ticker/timeframe exist
        if current_ticker not in data_dict or timeframe not in data_dict[current_ticker]:
            return None, None

        func = indicator_functions.get(func_name)
        if func is None:
            raise ValueError(f"Unknown function: {func_name}")

        indicator_df = data_dict[current_ticker][timeframe]
        exec_time = row.name

        # Find the last timestamp in indicator_df that is <= exec_time
        last_idx = indicator_df.index.asof(exec_time)
        if pd.isna(last_idx):
            return None, None

        series_to_use = indicator_df.loc[:last_idx]["Close"]

        # compute indicator (pass merged_args)
        try:
            current_value = func(series_to_use, **merged_args)
        except Exception:
            return None, None

        # handle offset for indicators returning Series
        if isinstance(current_value, pd.Series):
            if offset == 0:
                current_value = current_value.iloc[-1]
            else:
                if len(current_value) > offset:
                    current_value = current_value.iloc[-1 - offset]
                else:
                    return None, timeframe

        # ensure scalar numeric or None
        if current_value is None or (isinstance(current_value, float) and np.isnan(current_value)):
            return None, timeframe

        return current_value, timeframe

    # unknown operand type
    return None, None


def evaluate_condition(cond, row, indicator_functions, data_dict=None, ticker=None,
                       context_index=None, allowed_timeframes=None, execution_tf=None,
                       debug=False):
    """
    Evaluate cond and return a boolean.
    """
    # AND / OR recursion
    if "AND" in cond:
        for c in cond["AND"]:
            if not evaluate_condition(c, row, indicator_functions, data_dict, ticker,
                                      context_index, allowed_timeframes, execution_tf, debug=debug):
                return False
        return True

    if "OR" in cond:
        for c in cond["OR"]:
            if evaluate_condition(c, row, indicator_functions, data_dict, ticker,
                                  context_index, allowed_timeframes, execution_tf, debug=debug):
                return True
        return False

    # Leaf comparison
    default_tf = allowed_timeframes[0] if allowed_timeframes else "1h"

    left_val, left_tf = eval_operand(
        cond["left"], row, indicator_functions, data_dict, ticker,
        context_index=context_index, global_timeframe=default_tf,
        allowed_timeframes=allowed_timeframes, execution_tf=execution_tf
    )

    right_val, right_tf = eval_operand(
        cond["right"], row, indicator_functions, data_dict, ticker,
        context_index=context_index, global_timeframe=default_tf,
        allowed_timeframes=allowed_timeframes, execution_tf=execution_tf
    )

    # If either side couldn't be evaluated -> false (safe default)
    if left_val is None or right_val is None:
        if debug:
            print(f"[DEBUG CONDITION] unable to evaluate values L={left_val} R={right_val}")
        return False

    op_str = cond["operator"]
    if op_str not in OPS:
        raise ValueError(f"Unsupported operator {op_str}")

    result = OPS[op_str](left_val, right_val)

    if debug:
        print(f"[DEBUG CONDITION CHECK] LEFT={left_val} OP='{op_str}' RIGHT={right_val} "
              f"TYPE_L={type(left_val)} TYPE_R={type(right_val)} TF_L={left_tf} TF_R={right_tf}")
        print(f"[DEBUG CONDITION RESULT] {left_val} {op_str} {right_val} -> {result}")

    return bool(result)


def evaluate_condition_capture(cond, row, indicator_functions, data_dict, ticker,
                               context_index, allowed_timeframes, execution_tf):
    """
    Recursively evaluate AND/OR conditions and return (bool_result, left_val, right_val, timeframe)
    """
    if "AND" in cond:
        results = [evaluate_condition_capture(c, row, indicator_functions, data_dict, ticker,
                                              context_index, allowed_timeframes, execution_tf)
                   for c in cond["AND"]]
        # AND: all must be True
        res = all(r[0] for r in results)
        # return first sub-condition values for debug
        left_val = results[0][1] if results else None
        right_val = results[0][2] if results else None
        tf = results[0][3] if results else None
        return res, left_val, right_val, tf

    if "OR" in cond:
        results = [evaluate_condition_capture(c, row, indicator_functions, data_dict, ticker,
                                              context_index, allowed_timeframes, execution_tf)
                   for c in cond["OR"]]
        # OR: any must be True
        res = any(r[0] for r in results)
        left_val = results[0][1] if results else None
        right_val = results[0][2] if results else None
        tf = results[0][3] if results else None
        return res, left_val, right_val, tf

    # Leaf node
    left_val, left_tf = eval_operand(
        cond["left"], row, indicator_functions, data_dict, ticker,
        context_index=context_index,
        global_timeframe=allowed_timeframes[0] if allowed_timeframes else "1h",
        allowed_timeframes=allowed_timeframes,
        execution_tf=execution_tf
    )
    right_val, right_tf = eval_operand(
        cond["right"], row, indicator_functions, data_dict, ticker,
        context_index=context_index,
        global_timeframe=allowed_timeframes[0] if allowed_timeframes else "1h",
        allowed_timeframes=allowed_timeframes,
        execution_tf=execution_tf
    )

    if left_val is None or right_val is None:
        return False, left_val, right_val, left_tf

    result = OPS[cond["operator"]](left_val, right_val)
    return bool(result), left_val, right_val, left_tf
