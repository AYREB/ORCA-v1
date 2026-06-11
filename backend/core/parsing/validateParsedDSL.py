import json
import os

# Resolve registries relative to this file (backend/core/parsing/ -> backend/core/registries/).
# These load at import time, so a cwd-relative or wrong-case path (e.g. "Core/Registries")
# would crash the whole app on import on a case-sensitive filesystem (Linux/Railway).
_REGISTRIES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "registries")

with open(os.path.join(_REGISTRIES_DIR, "commandRegistry.json")) as f:
    COMMANDS_DEF = json.load(f)["COMMANDS"]

with open(os.path.join(_REGISTRIES_DIR, "indicatorRegistry.json")) as f:
    INDICATORS_DEF = json.load(f)["INDICATORS"]

with open(os.path.join(_REGISTRIES_DIR, "argumentsRegistry.json")) as f:
    ARGUMENTS_DEF = json.load(f)["ARGUMENTS"]

VALID_COMMANDS = set(COMMANDS_DEF.keys())
VALID_BLOCKS = {b for c in COMMANDS_DEF.values() for b in c["CONTROLS"]}
VALID_INDICATORS = set(INDICATORS_DEF.keys())

# ---------------- DSL parsing and validation ----------------
# (import all parser functions you wrote: extract_commands, split_top_level,
# parse_arguments, parse_operand, parse_condition, parse_logical, parse_dsl)

def validate_parsed_dsl(parsed, extra_indicators=None):
    for cmd, blocks in parsed.items():
        if cmd == "TICKER":
            continue  # ignore top-level tickers

        if cmd not in VALID_COMMANDS:
            raise ValueError(f"Invalid command: {cmd}")

        for block_name, block_content in blocks.items():
            if block_name == "context":
                continue

            # Check block is valid
            if block_name not in VALID_BLOCKS:
                raise ValueError(f"Invalid block in {cmd}: {block_name}")

            # Validate CONDITIONS
            if "CONDITIONS" in block_content:
                validate_conditions(block_content["CONDITIONS"], extra_indicators=extra_indicators)

            # Validate ARGUMENTS
            if "ARGUMENTS" in block_content:
                validate_arguments(cmd, block_name, block_content["ARGUMENTS"])


def validate_conditions(cond, extra_indicators=None):
    """
    Recursively validate conditions.
    Leaf conditions can be comparison dicts with 'left', 'operator', 'right'
    or single operands (like RSI, PRICE)
    """
    if isinstance(cond, dict):
        # Handle AND/OR
        for key, value in cond.items():
            if key in ["AND", "OR"]:
                if not isinstance(value, list):
                    raise ValueError(f"{key} block must be a list")
                for sub in value:
                    validate_conditions(sub, extra_indicators=extra_indicators)
                return

        # Leaf operand
        if "left" in cond and "operator" in cond and "right" in cond:
            validate_operand_with_timeframe(cond["left"], extra_indicators=extra_indicators)
            validate_operand_with_timeframe(cond["right"], extra_indicators=extra_indicators)
        else:
            # It's a single operand like RSI / PRICE
            validate_operand_with_timeframe(cond, extra_indicators=extra_indicators)


def validate_operand_with_timeframe(op, extra_indicators=None):
    """
    Validate operands, allowing optional timeframe for indicators.
    Handles PRICE (no timeframe) and indicators (optional timeframe as last argument).

    `extra_indicators`, when provided, is a per-request dict of additional indicator
    definitions (e.g. the authenticated user's compiled custom indicators) shaped like
    INDICATORS_DEF entries (`{"args": [...], "defaults": {...}, "supports_timeframe": bool}`).
    It's threaded through as a parameter rather than merged into the module-level
    INDICATORS_DEF/VALID_INDICATORS globals to avoid cross-request contamination.
    """
    if isinstance(op, dict):
        if "func" in op:
            func_name = op["func"]
            args = op.get("arg", {})
            if not isinstance(args, dict):
                raise ValueError(f"Arguments for {func_name} must be a dict, got {type(args).__name__}")

            # PRICE does not support timeframe
            if func_name.upper() == "PRICE":
                return

            # Ensure func_name exists in the native registry or the per-request extras
            info = INDICATORS_DEF.get(func_name)
            if info is None and extra_indicators:
                info = extra_indicators.get(func_name)
            if info is None:
                raise ValueError(f"Unknown indicator: {func_name}")

            expected_args = info.get("args", [])
            supports_timeframe = info.get("supports_timeframe", False)

            # Validate required args
            missing_keys = [k for k in expected_args if k not in args]
            if missing_keys:
                raise ValueError(f"Missing keys for {func_name}: {missing_keys}")

            # Optional: check if last arg is a valid timeframe if supports_timeframe
            if supports_timeframe and "timeframe" in args:
                if not isinstance(args["timeframe"], str):
                    raise ValueError(f"Expected 'timeframe' to be a string for {func_name}, got {args['timeframe']}")

        elif "op" in op:
            # Recursively validate left/right
            validate_operand_with_timeframe(op["left"], extra_indicators=extra_indicators)
            validate_operand_with_timeframe(op["right"], extra_indicators=extra_indicators)

        elif "value" in op:
            # Literal value node - always valid
            return


def validate_operand(op):
    if not isinstance(op, dict):
        raise ValueError(f"Operand must be dict: {op}")
    if "func" in op and op["func"] not in VALID_INDICATORS:
        raise ValueError(f"Invalid indicator: {op['func']}")


def validate_arguments(cmd, block_name, args):
    """
    Validate ARGUMENTS block against the registry.
    Warns on unknown keys rather than raising - LLM may add extra fields.
    """
    if cmd not in ARGUMENTS_DEF:
        raise ValueError(f"No argument definitions for command: {cmd}")

    cmd_registry = ARGUMENTS_DEF[cmd]

    if block_name not in cmd_registry:
        if args:
            print(
                f"[WARN] Arguments present in {cmd} -> {block_name} "
                f"which has no registry definition: {list(args.keys())}"
            )
        return

    block_registry = cmd_registry[block_name]

    for key, val in args.items():
        if key not in block_registry:
            # Warn but don't crash - LLM may output extra fields
            print(f"[WARN] Unknown argument for {cmd} -> {block_name}: {key}, skipping")
            continue

        reg = block_registry[key]

        if "options" in reg:
            if val not in reg["options"]:
                raise ValueError(
                    f"Invalid value for {key} in {cmd} -> {block_name}: {val}. "
                    f"Allowed: {reg['options']}"
                )
        elif "type" in reg:
            expected_type = reg["type"]
            if expected_type == "float" and not isinstance(val, (float, int)):
                raise ValueError(
                    f"{key} must be a float in {cmd} -> {block_name}, "
                    f"got {type(val).__name__}"
                )
            elif expected_type == "int" and not isinstance(val, int):
                raise ValueError(
                    f"{key} must be an int in {cmd} -> {block_name}, "
                    f"got {type(val).__name__}"
                )
            elif expected_type == "bool" and not isinstance(val, bool):
                raise ValueError(
                    f"{key} must be a bool in {cmd} -> {block_name}, "
                    f"got {type(val).__name__}"
                )
