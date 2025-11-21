# Backtesting/dsl_helpers.py
def get_long_short_conditions(parsed_dsl, position_type="LONG"):
    """
    Extract open and close conditions from DSL
    """
    section = parsed_dsl.get(position_type, {})
    open_cond = section.get("OPEN", {}).get("CONDITIONS")
    close_cond = section.get("CLOSE", {}).get("CONDITIONS")
    return open_cond, close_cond

def get_open_args(parsed_dsl, position_type="LONG"):
    section = parsed_dsl.get(position_type, {})
    return section.get("OPEN", {}).get("ARGUMENTS", {})

def get_close_args(parsed_dsl, position_type="LONG"):
    section = parsed_dsl.get(position_type, {})
    return section.get("CLOSE", {}).get("ARGUMENTS", {})
