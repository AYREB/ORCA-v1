import json
import os

_BASE = os.path.dirname(os.path.abspath(__file__))
_REGISTRY_DIR = os.path.join(_BASE, "..", "Registries")

with open(os.path.join(_REGISTRY_DIR, "commandRegistry.json")) as f:
    COMMANDS_DEF = json.load(f)["COMMANDS"]

with open(os.path.join(_REGISTRY_DIR, "indicatorRegistry.json")) as f:
    INDICATORS_DEF = json.load(f)["INDICATORS"]

with open(os.path.join(_REGISTRY_DIR, "argumentsRegistry.json")) as f:
    ARGUMENTS_DEF = json.load(f)["ARGUMENTS"]

VALID_COMMANDS = set(COMMANDS_DEF.keys())
VALID_BLOCKS = {b for c in COMMANDS_DEF.values() for b in c["CONTROLS"]}
VALID_INDICATORS = set(INDICATORS_DEF.keys())


def validate_parsed_dsl(parsed):
    for cmd, blocks in parsed.items():
        if cmd == "TICKER":
            continue

        if cmd not in VALID_COMMANDS:
            raise ValueError(f"Invalid command: {cmd}")

        for block_name, block_content in blocks.items():
            if block_name == "context":
                continue

            if block_name not in VALID_BLOCKS:
                raise ValueError(f"Invalid block in {cmd}: {block_name}")

            if "CONDITIONS" in block_content:
                validate_conditions(block_content["CONDITIONS"])

            if "ARGUMENTS" in block_content:
                validate_arguments(cmd, block_name, block_content["ARGUMENTS"])


def validate_conditions(cond):
    """
    Recursively validate conditions.
    Leaf conditions can be comparison dicts with 'left', 'operator', 'right'
    or single operands (like RSI, PRICE)
    """
    if isinstance(cond, dict):
        for key, value in cond.items():
            if key in ["AND", "OR"]:
                if not isinstance(value, list):
                    raise ValueError(f"{key} block must be a list")
                for sub in value:
                    validate_conditions(sub)
                return

        if "left" in cond and "operator" in cond and "right" in cond:
            validate_operand_with_timeframe(cond["left"])
            validate_operand_with_timeframe(cond["right"])
        else:
            validate_operand_with_timeframe(cond)


def validate_operand_with_timeframe(op):
    """
    Validate operands, allowing optional timeframe for indicators.
    """
    if isinstance(op, dict):
        if "func" in op:
            func_name = op["func"]
            args = op.get("arg", {})

            if not isinstance(args, dict):
                raise ValueError(
                    f"Arguments for {func_name} must be a dict, got {type(args).__name__}"
                )

            if func_name.upper() == "PRICE":
                return

            if func_name not in INDICATORS_DEF:
                raise ValueError(f"Unknown indicator: {func_name}")

            info = INDICATORS_DEF[func_name]
            expected_args = info.get("args", [])
            supports_timeframe = info.get("supports_timeframe", False)

            missing_keys = [k for k in expected_args if k not in args]
            if missing_keys:
                raise ValueError(f"Missing keys for {func_name}: {missing_keys}")

            if supports_timeframe and "timeframe" in args:
                if not isinstance(args["timeframe"], str):
                    raise ValueError(
                        f"Expected 'timeframe' to be a string for {func_name}, "
                        f"got {args['timeframe']}"
                    )

        elif "op" in op:
            validate_operand_with_timeframe(op["left"])
            validate_operand_with_timeframe(op["right"])

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