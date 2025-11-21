import json
import re

# ---------------- Parenthesis-aware extraction ----------------
def extract_commands(dsl_text):
    commands = []
    i = 0
    while i < len(dsl_text):
        if dsl_text[i] == ":":
            j = i + 1
            while j < len(dsl_text) and dsl_text[j] != "(":
                j += 1
            cmd_name = dsl_text[i+1:j].strip()

            k = j + 1
            depth = 1
            while k < len(dsl_text) and depth > 0:
                if dsl_text[k] == "(":
                    depth += 1
                elif dsl_text[k] == ")":
                    depth -= 1
                k += 1
            body = dsl_text[j+1:k-1].strip()
            commands.append((cmd_name, body))
            i = k
        else:
            i += 1
    return commands


# ---------------- Split top-level blocks (OPEN{}, CLOSE{}, etc.) ----------------
def split_top_level_recursive(body):
    parts, buf, depth = [], "", 0
    block_name = None
    i = 0
    while i < len(body):
        c = body[i]
        if c == '{':
            depth += 1
            if depth == 1:
                block_name = buf.strip()
                buf = ""
            else:
                buf += c
        elif c == '}':
            depth -= 1
            if depth == 0:
                parts.append((block_name, buf.strip()))
                buf = ""
                block_name = None
            else:
                buf += c
        elif c == '|' and depth == 0:
            buf = ""
        else:
            buf += c
        i += 1
    return parts


# ---------------- Parse ARGUMENTS ----------------
def parse_key_value_block(content):
    args = {}
    for kv in content.split("|"):
        kv = kv.strip()
        if "=" not in kv:
            continue
        k, v = kv.split("=", 1)
        k, v = k.strip(), v.strip()

        if v.upper() == "TRUE":
            v = True
        elif v.upper() == "FALSE":
            v = False
        else:
            try:
                v = float(v) if '.' in v else int(v)
            except ValueError:
                v = v.strip("'\"")
        args[k] = v
    return args


# ---------- Replacement: parse_operand + helper ----------
def _split_top_level_comma(s: str):
    parts, buf, depth, in_quote = [], [], 0, False
    quote_char = None
    for ch in s:
        if ch in "\"'":
            if not in_quote:
                in_quote = True
                quote_char = ch
                buf.append(ch)
            elif ch == quote_char:
                in_quote = False
                quote_char = None
                buf.append(ch)
            else:
                buf.append(ch)
        elif in_quote:
            buf.append(ch)
        elif ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf).strip())
    return parts

def _parse_simple_token(tok: str):
    tok = tok.strip()
    # quoted string
    if (tok.startswith("'") and tok.endswith("'")) or (tok.startswith('"') and tok.endswith('"')):
        return {"value": tok[1:-1]}
    # numeric
    if re.fullmatch(r"[-+]?\d+(\.\d+)?", tok):
        return {"value": float(tok) if '.' in tok else int(tok)}
    # function call with args
    if "(" in tok and tok.endswith(")"):
        func_name = tok[:tok.index("(")].strip()
        inner = tok[tok.index("(")+1:-1].strip()
        if inner:
            # Split arguments respecting commas
            parts = _split_top_level_comma(inner)
            args = {}
            for p in parts:
                p = p.strip()
                if "=" in p:
                    k, v = p.split("=", 1)
                    k = k.strip()
                    v = v.strip()
                    # convert types
                    if v.upper() == "TRUE":
                        v = True
                    elif v.upper() == "FALSE":
                        v = False
                    elif re.fullmatch(r"[-+]?\d+\.\d+", v):
                        v = float(v)
                    elif re.fullmatch(r"[-+]?\d+", v):
                        v = int(v)
                    elif (v.startswith("'") and v.endswith("'")) or (v.startswith('"') and v.endswith('"')):
                        v = v[1:-1]
                    args[k] = v
                else:
                    args[len(args)] = _parse_simple_token(p)
            return {"func": func_name, "arg": args}
        else:
            return {"func": func_name, "arg": {}}

    # fallback to arithmetic
    return parse_arithmetic(tok)



def parse_func_call_with_kwargs(func_text: str):
    """
    Parse a function call with optional key=value arguments.
    E.g. RSI(period=20, timeframe='4h') -> {"func":"RSI","arg":{"period":20,"timeframe":"4h"}}
    """
    func_text = func_text.strip()
    if "(" not in func_text or not func_text.endswith(")"):
        return {"func": func_text, "arg": {}}

    func_name = func_text[:func_text.index("(")].strip()
    arg_str = func_text[func_text.index("(")+1:-1].strip()

    args = {}
    if arg_str:
        parts = _split_top_level_comma(arg_str)
        for p in parts:
            if "=" in p:
                k, v = p.split("=", 1)
                k = k.strip()
                v = v.strip()
                # convert types
                if v.upper() == "TRUE":
                    v = True
                elif v.upper() == "FALSE":
                    v = False
                elif re.fullmatch(r"[-+]?\d+\.\d+", v):
                    v = float(v)
                elif re.fullmatch(r"[-+]?\d+", v):
                    v = int(v)
                elif (v.startswith("'") and v.endswith("'")) or (v.startswith('"') and v.endswith('"')):
                    v = v[1:-1]
                args[k] = v
            else:
                # positional argument fallback
                args[p] = p
    return {"func": func_name, "arg": args}


def parse_operand(side):
    side = side.strip()

    # Strip redundant outer parentheses
    while side.startswith("(") and side.endswith(")"):
        depth = 0
        valid = True
        for i, c in enumerate(side):
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0 and i < len(side) - 1:
                    valid = False
                    break
        if valid:
            side = side[1:-1].strip()
        else:
            break

    # literal number branch
    if re.fullmatch(r"[-+]?\d+(\.\d+)?", side):
        return {"value": float(side) if '.' in side else int(side)}

    # function call with arguments
    if "(" in side and side.endswith(")"):
        name = side[:side.index("(")].strip()
        arg_str = side[side.index("(")+1:-1].strip()
        # parse args...
        # (same as your existing logic)
        return {"func": name, "arg": parse_indicator_args(arg_str, name)}

    # fallback to arithmetic
    return parse_arithmetic(side)





# ---------------- Parse a single condition ----------------
def parse_condition(expr):
    for op in ["==", "!=", ">=", "<=", ">", "<"]:
        if op in expr:
            left_raw, right_raw = expr.split(op, 1)
            left = parse_operand(left_raw)
            right = parse_operand(right_raw)
            return {"left": left, "operator": op, "right": right}
    return parse_operand(expr)

def parse_arithmetic(expr):
    expr = expr.strip()
    depth = 0
    for i, c in enumerate(expr):
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif depth == 0 and c in "+-*/":
            left = parse_arithmetic(expr[:i])
            right = parse_arithmetic(expr[i+1:])
            return {"op": c, "left": left, "right": right}
    return parse_operand(expr) 


def parse_indicator_args(arg_str, indicator_name=None, registry_path="Core/Registries/indicatorRegistry.json"):
    """
    Parse a string like 'close, 0' or 'period=14, timeframe="1h"' into a dict.
    Applies indicator defaults from registry if args missing.
    """
    import json, re

    with open(registry_path, "r") as f:
        INDICATORS_DEF = json.load(f)["INDICATORS"]

    default_args = {}
    arg_order = []
    if indicator_name:
        indicator_info = INDICATORS_DEF.get(indicator_name.upper(), {})
        default_args = indicator_info.get("defaults", {})
        arg_order = indicator_info.get("args", [])

    args = {}
    parts = [p.strip() for p in _split_top_level_comma(arg_str)] if arg_str else []

    for i, val in enumerate(parts):
        # Detect key=value
        if "=" in val:
            k, v = val.split("=", 1)
            k = k.strip()
            v = v.strip()
            # Convert types
            if v.upper() == "TRUE":
                v = True
            elif v.upper() == "FALSE":
                v = False
            elif re.fullmatch(r"[-+]?\d+(\.\d+)?", v):
                v = float(v) if '.' in v else int(v)
            elif (v.startswith("'") and v.endswith("'")) or (v.startswith('"') and v.endswith('"')):
                v = v[1:-1]
            args[k] = v
        else:
            # Positional argument fallback
            if i < len(arg_order):
                key = arg_order[i]
            else:
                key = str(i)
            # Convert numeric or string literals
            if re.fullmatch(r"[-+]?\d+(\.\d+)?", val):
                val = float(val) if '.' in val else int(val)
            elif (val.startswith("'") and val.endswith("'")) or (val.startswith('"') and val.endswith('"')):
                val = val[1:-1]
            args[key] = val

    # Fill missing defaults only for args that actually exist in DSL
    for k, v in default_args.items():
        if k not in args and k != "timeframe":
            args[k] = v

    return args



# ---------------- Parse logical AND/OR recursively ----------------
def strip_outer_parens(expr):
    expr = expr.strip()
    while expr.startswith("(") and expr.endswith(")"):
        depth = 0
        valid = True
        for i, c in enumerate(expr):
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0 and i < len(expr) - 1:
                    valid = False
                    break
        if valid:
            expr = expr[1:-1].strip()
        else:
            break
    return expr


def parse_logical(expr):
    expr = strip_outer_parens(expr)
    depth = 0
    buf = ""
    parts = []
    op_found = None
    i = 0

    while i < len(expr):
        if expr[i] == "(":
            depth += 1
        elif expr[i] == ")":
            depth -= 1
        elif depth == 0:
            for op in ["AND", "OR"]:
                if expr[i:i+len(op)] == op and (
                    i == 0 or expr[i-1].isspace()
                ) and (
                    i+len(op) == len(expr) or expr[i+len(op)].isspace()
                ):
                    parts.append(buf.strip())
                    buf = ""
                    i += len(op)
                    op_found = op if not op_found else op_found
                    break
            else:
                buf += expr[i]
                i += 1
                continue
            continue
        buf += expr[i]
        i += 1

    if buf.strip():
        parts.append(buf.strip())

    if op_found and len(parts) > 1:
        return {op_found: [parse_logical(p) for p in parts]}
    else:
        return parse_condition(expr)


# ---------------- Main parser ----------------

import re
import json

def parse_dsl(dsl_text):
    """
    Handles nested ARGUMENTS/CONDITIONS inside OPEN/CLOSE/other blocks.
    Supports top-level TICKER, TIMEFRAME, and DATEFRAME blocks.
    """

    # --- SAFE GLOBAL DEFAULTS ---
    global_tickers = []
    global_execution_tf = []
    global_data_tfs = []
    global_dateframe = {"start": None, "end": None}

    commands = {}
    matches = extract_commands(dsl_text)

    # --- PRE-SCAN GLOBAL VALUES ---
    for cmd, body in matches:
        if cmd == "TICKER":
            ticker_text = body.strip()
            if ticker_text.startswith("{") and ticker_text.endswith("}"):
                ticker_text = ticker_text[1:-1].strip()

            global_tickers = [
                t.strip() for t in re.split(r"[,\n]+", ticker_text) if t.strip()
            ]

        elif cmd == "EXECUTION_TIMEFRAME":
            tf_text = body.strip().strip("{}()")
            global_execution_tf = [
                t.strip("'\"") for t in re.split(r"[,\n]+", tf_text) if t.strip()
            ]

        elif cmd == "DATA_TIMEFRAMES":
            tf_text = body.strip().strip("{}()")
            global_data_tfs = [
                t.strip("'\"") for t in re.split(r"[,\n]+", tf_text) if t.strip()
            ]

        elif cmd == "DATEFRAME":
            date_text = body.strip().strip("{}()")
            date_parts = [x.strip() for x in date_text.split(",") if x.strip()]
            if len(date_parts) == 2:
                global_dateframe = {"start": date_parts[0], "end": date_parts[1]}
            else:
                raise ValueError(f"Invalid DATEFRAME format: {body}")

    # --- PARSE MAIN COMMANDS (LONG/SHORT/etc.) ---
    for cmd, body in matches:
        # Skip top-level context declarations
        if cmd in ("TICKER", "EXECUTION_TIMEFRAME", "DATA_TIMEFRAMES", "DATEFRAME"):
            continue

        subdict = {}
        command_context = {
            "tickers": [],
            "execution_timeframe": [],
            "data_timeframes": [],
            "dateframe": dict(global_dateframe),
        }

        top_blocks = split_top_level_recursive(body)

        # --- FIRST PASS: LOCAL CONTEXT DETECTION ---
        for block_name, content in top_blocks:
            name = block_name.strip()
            text = content.strip()

            if name == "TICKER":
                tickers = [x.strip() for x in text.split(",") if x.strip()]
                command_context["tickers"].extend(tickers)

            elif name == "EXECUTION_TIMEFRAME":
                timeframes = [
                    t.strip("'\"") for t in re.split(r"[,\n]+", text) if t.strip()
                ]
                command_context["execution_timeframe"].extend(timeframes)

            elif name == "DATA_TIMEFRAMES":
                timeframes = [
                    t.strip("'\"") for t in re.split(r"[,\n]+", text) if t.strip()
                ]
                command_context["data_timeframes"].extend(timeframes)

            elif name == "DATEFRAME":
                date_text = text.strip("{}()")
                date_parts = [x.strip() for x in date_text.split(",") if x.strip()]
                if len(date_parts) == 2:
                    command_context["dateframe"] = {
                        "start": date_parts[0],
                        "end": date_parts[1],
                    }

        # --- SECOND PASS: NESTED BLOCK PARSING (OPEN, CLOSE, etc.) ---
        for block_name, content in top_blocks:
            name = block_name.strip()
            text = content.strip()

            if name in ("TICKER", "EXECUTION_TIMEFRAME", "DATA_TIMEFRAMES", "DATEFRAME"):
                continue

            nested_blocks = split_top_level_recursive(text)

            if nested_blocks:
                inner_dict = {}
                for nkey, ncontent in nested_blocks:
                    nbody = ncontent.strip()
                    if nkey == "ARGUMENTS":
                        inner_dict[nkey] = parse_key_value_block(nbody)
                    else:
                        inner_dict[nkey] = parse_logical(nbody)
                subdict[name] = inner_dict

            else:
                if name == "ARGUMENTS":
                    subdict[name] = parse_key_value_block(text)
                else:
                    subdict[name] = parse_logical(text)

        # --- MERGE GLOBAL CONTEXT IF LOCAL WAS EMPTY ---
        if not command_context["tickers"] and global_tickers:
            command_context["tickers"] = list(global_tickers)

        if not command_context["execution_timeframe"] and global_execution_tf:
            command_context["execution_timeframe"] = list(global_execution_tf)

        if not command_context["data_timeframes"] and global_data_tfs:
            command_context["data_timeframes"] = list(global_data_tfs)

        # If dateframe start is None, fill from global
        if (
            (not command_context["dateframe"] or not command_context["dateframe"]["start"])
            and global_dateframe["start"]
        ):
            command_context["dateframe"] = dict(global_dateframe)

        final_context = {
            "tickers": command_context["tickers"],
            "execution_timeframe": (
                command_context["execution_timeframe"][0]
                if command_context["execution_timeframe"]
                else None
            ),
            "data_timeframes": command_context["data_timeframes"],
            "dateframe": command_context["dateframe"],
        }

        commands[cmd] = {
            **subdict,
            "context": final_context,
        }

    # --- OPTIONAL JSON OUTPUT ---
    with open("Core/Parsing/dsl_output.json", "w") as f:
        json.dump(commands, f, indent=4)

    return commands




# ---------------- Run parser ----------------
# parsed = parse_dsl(dsl)

# with open("Rewrite/Parsing/dsl_output.json", "w") as f:
#     json.dump(parsed, f, indent=4)

# print(json.dumps(parsed, indent=4))
# print("Saved to dsl_output.json")
