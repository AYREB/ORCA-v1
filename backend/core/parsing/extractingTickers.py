# ---------------- INTERNAL HELPER ---------------- #

def _get_strategy(parsed_dsl):
    """
    Normalises DSL input to always return the inner strategy block.
    Supports:
    - { "LONG": {...} }
    - { "SHORT": {...} }
    - { ... } (already inner)
    """
    if not isinstance(parsed_dsl, dict):
        return {}

    if "LONG" in parsed_dsl:
        return parsed_dsl["LONG"]
    if "SHORT" in parsed_dsl:
        return parsed_dsl["SHORT"]

    return parsed_dsl  # already inner


# ---------------- EXTRACTORS ---------------- #

def extract_tickers(parsed_dsl):
    """
    Returns list of tickers from strategy context.
    """
    strategy = _get_strategy(parsed_dsl)
    context = strategy.get("context", {})
    return list(set(context.get("tickers", [])))


def extract_execution_timeframe(parsed_dsl):
    """
    Returns execution timeframe (string).
    Defaults to '1h' if missing.
    """
    strategy = _get_strategy(parsed_dsl)
    context = strategy.get("context", {})

    return context.get("execution_timeframe", "1h")


def extract_data_timeframes(parsed_dsl):
    """
    Returns list of data timeframes used in strategy context.
    """
    strategy = _get_strategy(parsed_dsl)
    context = strategy.get("context", {})

    return list(set(context.get("data_timeframes", [])))


def extract_dateframe(parsed_dsl):
    """
    Returns dateframe dict:
    { "start": ..., "end": ... }
    or None if missing.
    """
    strategy = _get_strategy(parsed_dsl)
    context = strategy.get("context", {})

    return context.get("dateframe", None)


def collect_timeframes_from_dsl(parsed_dsl, execution_tf: str) -> set:
    """
    Walks the DSL tree and extracts all timeframes used in indicator args.
    Includes execution timeframe by default.
    """
    strategy = _get_strategy(parsed_dsl)

    timeframes = set()
    if execution_tf:
        timeframes.add(execution_tf)

    def walk(node):
        if isinstance(node, dict):
            # Check for indicator args
            if "arg" in node and isinstance(node["arg"], dict):
                tf = node["arg"].get("timeframe")
                if tf:
                    timeframes.add(tf)

            for v in node.values():
                walk(v)

        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(strategy)
    return timeframes



    # def search_conditions(cond):
    #     if isinstance(cond, dict):
    #         # Look for any function with a string as first argument
    #         for side in ["left", "right"]:
    #             op = cond.get(side)
    #             if isinstance(op, dict) and "func" in op:
    #                 arg = op.get("arg")
    #                 # if arg is a list (like SMA('AAPL', 20)), take first
    #                 if isinstance(arg, list) and arg:
    #                     tickers.add(arg[0])
    #                 elif isinstance(arg, str):
    #                     tickers.add(arg)
    #         # Recurse into AND/OR groups
    #         if "AND" in cond:
    #             for sub in cond["AND"]:
    #                 search_conditions(sub)
    #         if "OR" in cond:
    #             for sub in cond["OR"]:
    #                 search_conditions(sub)

    # for cmd_blocks in parsed_dsl.values():
    #     for block in cmd_blocks.values():
    #         if isinstance(block, dict) and "CONDITIONS" in block:
    #             search_conditions(block["CONDITIONS"])

    # return list(tickers)
