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

# Bar duration per timeframe — used to exclude a higher-timeframe bar that is
# still forming at decision time (its Close isn't knowable yet).
_TF_DURATIONS = {
    "1m": pd.Timedelta(minutes=1),
    "5m": pd.Timedelta(minutes=5),
    "15m": pd.Timedelta(minutes=15),
    "1h": pd.Timedelta(hours=1),
    "4h": pd.Timedelta(hours=4),
    "1d": pd.Timedelta(days=1),
}

# Indicators computed from full OHLCV data (High/Low/Volume), not just Close.
_OHLCV_INDICATORS = {"ATR", "STOCH", "CCI", "OBV"}


def _tf_duration(tf):
    return _TF_DURATIONS.get(str(tf).lower())


def _default_tf(allowed_timeframes):
    return allowed_timeframes[0] if allowed_timeframes else "1h"


def _cross_ticker_index(df, row, context_index, is_cross_ticker):
    """
    Positional index into `df` for the decision bar.

    Same ticker: `context_index` already points at the row the main loop is on.
    Cross ticker (condition references another symbol via `ticker=`): the two
    dataframes can have different rows (holidays, listing dates, missing bars),
    so positional reuse would read an unrelated date — align by timestamp
    instead: the referenced symbol's latest bar at or before this row's time.
    Returns None if no such bar exists.
    """
    if not is_cross_ticker:
        return context_index
    try:
        idx = df.index.asof(row.name)
    except (TypeError, ValueError):
        return None
    if pd.isna(idx):
        return None
    loc = df.index.get_loc(idx)
    if isinstance(loc, slice):
        loc = loc.stop - 1
    return int(loc)


def _eval_price(merged_args, offset, current_ticker, context_index, data_dict, execution_tf,
                row=None, is_cross_ticker=False):
    if current_ticker not in data_dict or execution_tf not in data_dict[current_ticker]:
        return None, None
    df = data_dict[current_ticker][execution_tf]
    i = _cross_ticker_index(df, row, context_index, is_cross_ticker)
    if i is None:
        return None, None
    try:
        val = indicatorCalculators.get_price(
            df,
            field=merged_args.get("OHLC", "close"),
            offset=offset,
            context={"i": i}
        )
        return val, None
    except Exception:
        return None, None


def _eval_volume(offset, current_ticker, context_index, data_dict, execution_tf,
                 row=None, is_cross_ticker=False):
    # Always evaluated against execution_tf: context_index is a positional
    # index into the execution-timeframe dataframe, so indexing any other
    # timeframe's dataframe with it would read an unrelated bar.
    if current_ticker not in data_dict or execution_tf not in data_dict[current_ticker]:
        return None, None
    df = data_dict[current_ticker][execution_tf]
    i = _cross_ticker_index(df, row, context_index, is_cross_ticker)
    if i is None:
        return None, None
    try:
        val = indicatorCalculators.get_volume(
            df,
            offset=offset,
            context={"i": i}
        )
        return val, None
    except Exception:
        return None, None


def _eval_custom_indicator(calculate_fn, merged_args, offset, current_ticker, context_index,
                           data_dict, execution_tf, row=None, is_cross_ticker=False):
    """
    Evaluate a user-authored custom indicator. Mirrors `_eval_price` — always runs
    against `execution_tf` (never `timeframe`) so `context["i"]` aligns positionally
    with the row the main loop is on, and uses the exact `(data, context, **params)`
    contract `api.indicator_sandbox.compile_indicator` produces.
    """
    if current_ticker not in data_dict or execution_tf not in data_dict[current_ticker]:
        return None, None
    df = data_dict[current_ticker][execution_tf]
    base_index = _cross_ticker_index(df, row, context_index, is_cross_ticker)
    if base_index is None:
        return None, None
    try:
        i = base_index - int(offset or 0)
    except (TypeError, ValueError):
        return None, None
    if i < 0:
        return None, None
    try:
        value = calculate_fn(df, {"i": i}, **merged_args)
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

        # Copy before popping: `func_args` IS the DSL node's arg dict, and the
        # main loop re-evaluates the same node on every bar — popping in place
        # would strip `ticker` after the first evaluation and silently retarget
        # the condition at the traded symbol for the rest of the backtest.
        func_args = dict(func_args)
        current_ticker = func_args.pop("ticker", ticker) or ticker
        # Condition targets a different symbol than the one being traded
        # (e.g. PRICE(ticker=UKX) while trading SPX) — positional row indices
        # can't be reused across dataframes, so lookups align by timestamp.
        is_cross_ticker = ticker is not None and current_ticker != ticker

        merged_args = {**_INDICATOR_REGISTRY.get(func_name, {}).get("defaults", {}), **func_args}
        timeframe    = merged_args.pop("timeframe", global_timeframe)

        # Offsets look backward only. A negative offset would index FUTURE
        # bars — a crystal ball no backtest may have.
        try:
            offset = max(0, int(merged_args.pop("offset", 0) or 0))
        except (TypeError, ValueError):
            offset = 0

        upper = func_name.upper()

        if upper == "PRICE":
            return _eval_price(merged_args, offset, current_ticker, context_index, data_dict,
                               execution_tf, row=row, is_cross_ticker=is_cross_ticker)

        if upper == "VOLUME":
            return _eval_volume(offset, current_ticker, context_index, data_dict,
                                execution_tf, row=row, is_cross_ticker=is_cross_ticker)

        # Custom (user-authored) indicators — dispatched by exact-case name, always
        # against execution_tf, using the (data, context, **params) contract. Must
        # come before the native allowed_timeframes/indicator_functions lookup below,
        # since custom indicators never go through data_dict[ticker][timeframe] or the
        # vectorized-series contract.
        if custom_indicator_functions and func_name in custom_indicator_functions:
            return _eval_custom_indicator(
                custom_indicator_functions[func_name], merged_args, offset,
                current_ticker, context_index, data_dict, execution_tf,
                row=row, is_cross_ticker=is_cross_ticker
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

        df_slice = indicator_df.loc[:last_idx]

        # Higher-timeframe bars that haven't completed yet are excluded: at
        # 10:00 the current daily bar's Close is tonight's price — using it
        # would leak the future into the signal. A bar counts as complete once
        # its end (start + duration) is at or before the decision time (the
        # close of the current execution bar).
        if timeframe != execution_tf and len(df_slice) > 0:
            tf_dur = _tf_duration(timeframe)
            exec_dur = _tf_duration(execution_tf) or pd.Timedelta(0)
            if tf_dur is not None:
                decision_time = row.name + exec_dur
                if df_slice.index[-1] + tf_dur > decision_time:
                    df_slice = df_slice.iloc[:-1]
        if df_slice.empty:
            return None, timeframe

        # ATR/STOCH/CCI/OBV need High/Low/Volume — passing only the Close
        # series (as before) made them raise internally and evaluate as None,
        # silently disabling every condition that used them.
        payload = df_slice if upper in _OHLCV_INDICATORS else df_slice["Close"]

        try:
            value = func(payload, **merged_args)
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