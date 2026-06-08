# orca_llm.py - Complete pipeline
import json
import random
import subprocess
from pathlib import Path
from collections import defaultdict
import threading
from core.LLM.registry_loader import build_registry_context, resolve_ticker_alias, load_ticker_registry
from core.parsing.validateParsedDSL import validate_conditions
# ============================================================
# PART 1: TRAINING
# ============================================================

# Global model cache - loads once, stays in memory
_model = None
_tokenizer = None
_model_lock = threading.Lock()

def get_model(adapter_path="adapters"):
    global _model, _tokenizer
    
    if _model is not None:
        return _model, _tokenizer
    
    with _model_lock:
        # Double check after acquiring lock
        if _model is not None:
            return _model, _tokenizer
        
        print("Loading model into memory...")
        from mlx_lm import load
        _model, _tokenizer = load(
            "mlx-community/Qwen2.5-7B-Instruct-4bit",
            adapter_path=adapter_path
        )
        print("Model loaded.")
    
    return _model, _tokenizer


def prepare_and_train(
    input_file="training_data.jsonl",
    data_dir="data",
    adapter_dir="adapters",
    iters=600,
    learning_rate="2e-5"
):
    """Full prepare + train pipeline"""

    Path(data_dir).mkdir(exist_ok=True)

    # ---- Load + split by pattern ----
    data_by_pattern = defaultdict(list)

    with open(input_file) as f:
        for line in f:
            ex = json.loads(line)
            out = ex["output"]
            strategy = json.loads(out) if isinstance(out, str) else out
            direction = "LONG" if "LONG" in strategy else "SHORT"
            cond = strategy[direction]["OPEN"]["CONDITIONS"]

            if "AND" in cond:
                pattern = "AND"
            elif "OR" in cond:
                pattern = "OR"
            elif "op" in str(cond):
                pattern = "arithmetic"
            else:
                left = cond.get("left", {})
                pattern = left.get("func", "simple")

            data_by_pattern[pattern].append(ex)

    print("Patterns found:")
    for p, items in data_by_pattern.items():
        print(f"  {p}: {len(items)}")

    train, val, test = [], [], []
    for items in data_by_pattern.values():
        random.shuffle(items)
        n = len(items)
        t1, t2 = int(n * 0.8), int(n * 0.9)
        train += items[:t1]
        val   += items[t1:t2]
        test  += items[t2:]

    random.shuffle(train)
    random.shuffle(val)
    random.shuffle(test)

    print(f"\nSplit: {len(train)} train / {len(val)} val / {len(test)} test")

    # ---- Format + write ----
    def fmt(ex):
        # Normalise output to string
        out = ex["output"]
        if not isinstance(out, str):
            out = json.dumps(out)

        return {"text": (
            f"<|im_start|>system\n"
            f"You are a trading strategy parser. "
            f"Convert the user input into this exact JSON schema. "
            f"Output ONLY raw JSON, no explanation, no markdown.\n"
            f"<|im_end|>\n"
            f"<|im_start|>user\n{ex['input']}<|im_end|>\n"
            f"<|im_start|>assistant\n{out}<|im_end|>"
        )}

    for split_name, split_data in [("train", train), ("valid", val), ("test", test)]:
        with open(f"{data_dir}/{split_name}.jsonl", "w") as f:
            for item in split_data:
                f.write(json.dumps(fmt(item)) + "\n")

    print(f"✓ Written to {data_dir}/")

    # ---- Train ----
    print(f"\n🚀 Training on 7B model...")
    print("Estimated time: 60-90 mins on M3\n")

    cmd = [
        "mlx_lm.lora",
        "--model",         "mlx-community/Qwen2.5-7B-Instruct-4bit",
        "--train",
        "--data",          data_dir,
        "--iters",         str(iters),
        "--steps-per-eval","50",
        "--adapter-path",  adapter_dir,
        "--batch-size",    "2",
        "--learning-rate", learning_rate,
        "--num-layers",    "16",
        "--save-every",    "100",
    ]

    print(" ".join(cmd) + "\n")
    subprocess.run(cmd, check=True)
    print("\n✓ Training complete!")


# ============================================================
# PART 2: CONSTRAINED INFERENCE
# ============================================================

# Ticker aliases - handles natural language names
TICKER_MAP = {
    "tesla":     "TSLA",
    "apple":     "AAPL",
    "microsoft": "MSFT",
    "google":    "GOOGL",
    "amazon":    "AMZN",
    "nvidia":    "NVDA",
    "meta":      "META",
    "bitcoin":   "BTC-USD",
    "ethereum":  "ETH-USD",
    "btc":       "BTC-USD",
    "eth":       "ETH-USD",
    "spy":       "SPY",
    "qqq":       "QQQ",
}

VALID_TIMEFRAMES  = {"1m", "5m", "15m", "1h", "4h", "1D"}
VALID_INDICATORS  = {"PRICE", "VOLUME", "SMA", "EMA", "RSI",
                     "MACD", "BBANDS", "ATR", "STOCH", "CCI", "OBV"}
VALID_OPERATORS   = {">", "<", ">=", "<=", "==", "!="}

def normalise_tickers(text: str) -> str:
    """Replace natural language names with ticker symbols"""
    lower = text.lower()
    for name, ticker in TICKER_MAP.items():
        if name in lower:
            # Replace whole word only
            import re
            lower = re.sub(rf'\b{name}\b', ticker, lower)
    return lower

def validate_and_repair(raw: str, registry_context: dict = None) -> tuple:
    errors = []

    if registry_context:
        valid_tickers = set(registry_context["tickers"].keys())
        valid_timeframes = set(registry_context["timeframes"])
        valid_indicators = set(registry_context["indicators"])
    else:
        valid_tickers = None
        valid_timeframes = VALID_TIMEFRAMES
        valid_indicators = VALID_INDICATORS

    # Strip markdown fences
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(
            l for l in lines if not l.strip().startswith("```")
        ).strip()

    # Parse JSON
    try:
        strategy = json.loads(cleaned)
    except json.JSONDecodeError as e:
        errors.append(f"Invalid JSON: {e}")
        return None, errors

    # Must have LONG or SHORT
    direction = None
    if "LONG" in strategy:
        direction = "LONG"
    elif "SHORT" in strategy:
        direction = "SHORT"
    else:
        errors.append("Missing LONG or SHORT key")
        return None, errors

    body = strategy[direction]

    # context
    if "context" not in body:
        errors.append("Missing context")
        return None, errors

    ctx = body["context"]

    if "tickers" not in ctx or not ctx["tickers"]:
        errors.append("Missing tickers")
        return None, errors

    if valid_tickers:
        invalid_tickers = [t for t in ctx["tickers"] if t not in valid_tickers]
        if invalid_tickers:
            errors.append(f"Invalid tickers: {invalid_tickers}")
            ctx["tickers"] = [t for t in ctx["tickers"] if t in valid_tickers]
            if not ctx["tickers"]:
                return None, errors

    if "execution_timeframe" not in ctx:
        errors.append("Missing execution_timeframe")
        return None, errors

    if ctx["execution_timeframe"] not in valid_timeframes:
        errors.append(f"Invalid timeframe: {ctx['execution_timeframe']}")
        ctx["execution_timeframe"] = "1h"

    if "dateframe" not in ctx:
        ctx["dateframe"] = {"start": "2025-01-01", "end": "2026-01-01"}

    # OPEN block
    if "OPEN" not in body:
        errors.append("Missing OPEN block")
        return None, errors

    open_block = body["OPEN"]

    if "CONDITIONS" not in open_block:
        errors.append("Missing OPEN.CONDITIONS")
        return None, errors

    if "ARGUMENTS" not in open_block:
        open_block["ARGUMENTS"] = {
            "initialOpenPositionInvestType": "percentCashBalance",
            "initialOpenPositionInvestAmount": 0.2,
            "stopLossPercent": 10,
            "takeProfitPercent": 30
        }
        errors.append("Missing ARGUMENTS - filled with defaults")

    # Fix percentage fields - convert decimals to whole numbers
    open_block = fix_percentage_fields(open_block)

    # Also fix CLOSE if present
    if "CLOSE" in body:
        body["CLOSE"] = fix_percentage_fields(body["CLOSE"])

    # Validate conditions
    validate_conditions(open_block["CONDITIONS"])       

    return strategy, errors


def fix_percentage_fields(block: dict) -> dict:
    """
    Model outputs percentages as decimals (0.1 = 10%).
    Backtester expects whole numbers (10).
    Convert any value < 1 to percentage.
    """
    args = block.get("ARGUMENTS", {})

    for field in ["stopLossPercent", "takeProfitPercent",
                  "initialOpenPositionInvestAmount",
                  "recurringInvestAmount"]:
        if field in args:
            val = args[field]
            if isinstance(val, (int, float)) and 0 < val < 1:
                args[field] = round(val * 100, 4)

    return block

def build_system_prompt(registry_context: dict) -> str:
    """
    Build dynamic system prompt from current registry state.
    Model only knows what's in the registry right now.
    """
    tickers_str = ", ".join(registry_context["tickers"].keys())
    timeframes_str = ", ".join(registry_context["timeframes"])
    indicators_str = ", ".join(registry_context["indicators"])

    # Build ticker aliases section
    alias_lines = []
    for ticker, aliases in registry_context["tickers"].items():
        natural = [a for a in aliases if a != ticker][:3]
        if natural:
            alias_lines.append(f"  {ticker}: also known as {', '.join(natural)}")
    aliases_str = "\n".join(alias_lines)

    return f"""You are a trading strategy parser. Convert natural language trading strategies into JSON format.

AVAILABLE TICKERS: {tickers_str}
Ticker aliases:
{aliases_str}

AVAILABLE TIMEFRAMES: {timeframes_str}

AVAILABLE INDICATORS: {indicators_str}

RULES:
- Only use tickers from the available list above
- Only use timeframes from the available list above  
- Only use indicators from the available list above
- Output ONLY raw JSON, no explanation, no markdown
- Percentages as decimals (5% = 0.05)
- Default timeframe: 1h if not specified
- Default date range: last 1 year if not specified"""


def parse_strategy(
    user_input: str,
    adapter_path="adapters",
    allowed_tickers: list = None,
    allowed_timeframes: list = None
) -> dict:
    from mlx_lm import generate

    # Build registry context
    registry_context = build_registry_context(allowed_tickers, allowed_timeframes)

    # Normalise tickers using registry
    normalised_input = normalise_tickers_from_registry(user_input, registry_context)

    model, tokenizer = get_model(adapter_path)

    system_prompt = build_system_prompt(registry_context)

    prompt = (
        f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n"
        f"<|im_start|>user\n{normalised_input}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )

    raw_output = generate(model, tokenizer, prompt=prompt, max_tokens=1024)

    strategy, errors = validate_and_repair(raw_output, registry_context)

    if errors:
        print(f"⚠️  Validation issues:")
        for e in errors:
            print(f"   - {e}")

    if strategy is None:
        return {
            "error": "Failed to parse strategy",
            "issues": errors,
            "raw_output": raw_output
        }

    strategy = apply_date_override(strategy, user_input)
    return strategy


# ============================================================
# PART 3: EVALUATION
# ============================================================

def evaluate(adapter_path="adapters", test_file="data/test.jsonl"):
    """Run full evaluation on held-out test set"""
    from mlx_lm import load, generate

    print("\n🧪 Running evaluation...\n")

    model, tokenizer = load(
        "mlx-community/Qwen2.5-7B-Instruct-4bit",
        adapter_path=adapter_path
    )

    test_data = []
    with open(test_file) as f:
        for line in f:
            ex = json.loads(line)
            text = ex["text"]
            user  = text.split("<|im_start|>user\n")[1].split("<|im_end|>")[0]
            expected = text.split("<|im_start|>assistant\n")[1].split("<|im_end|>")[0]
            test_data.append({"input": user, "expected": expected})

    total = len(test_data)
    valid_json   = 0
    schema_valid = 0
    exact_match  = 0
    results      = []

    for i, ex in enumerate(test_data):
        print(f"  {i+1}/{total}", end="\r")

        prompt = (
            f"<|im_start|>system\n"
            f"You are a trading strategy parser. "
            f"Convert the user input into the trading strategy JSON schema. "
            f"Output ONLY raw JSON, no explanation, no markdown.\n"
            f"<|im_end|>\n"
            f"<|im_start|>user\n{ex['input']}<|im_end|>\n"
            f"<|im_start|>assistant\n"
        )

        raw = generate(model, tokenizer, prompt=prompt,
                       max_tokens=1024)

        strategy, errors = validate_and_repair(raw)

        is_valid_json   = strategy is not None
        is_schema_valid = is_valid_json and len([e for e in errors if "default" not in e]) == 0

        if is_valid_json:
            valid_json += 1
        if is_schema_valid:
            schema_valid += 1

        # Exact match check
        try:
            pred_norm = json.dumps(json.loads(raw), sort_keys=True)
            exp_norm  = json.dumps(json.loads(ex["expected"]), sort_keys=True)
            if pred_norm == exp_norm:
                exact_match += 1
        except:
            pass

        results.append({
            "input":          ex["input"],
            "expected":       ex["expected"],
            "prediction":     raw,
            "is_valid_json":  is_valid_json,
            "is_schema_valid":is_schema_valid,
            "errors":         errors
        })

    # ---- Print results ----
    print("\n" + "="*50)
    print("EVALUATION RESULTS")
    print("="*50)
    print(f"Total:        {total}")
    print(f"Valid JSON:   {valid_json}/{total}  ({valid_json/total*100:.1f}%)")
    print(f"Schema valid: {schema_valid}/{total}  ({schema_valid/total*100:.1f}%)")
    print(f"Exact match:  {exact_match}/{total}  ({exact_match/total*100:.1f}%)")
    print("="*50)

    # Sample failures
    failures = [r for r in results if not r["is_schema_valid"]]
    if failures:
        print(f"\n--- Sample Failures ({len(failures)} total) ---")
        for f in failures[:3]:
            print(f"\nInput: {f['input']}")
            print(f"Errors: {f['errors']}")
            print(f"Output: {f['prediction'][:200]}")

    with open("eval_results.json", "w") as f:
        json.dump(results, f, indent=2)

    print("\n✓ Full results → eval_results.json")

import re
from datetime import datetime, timedelta

TODAY = datetime.now()

DATE_PATTERNS = [
    (r"last (\d+) years?",      lambda m: (TODAY - timedelta(days=365*int(m.group(1))), TODAY)),
    (r"past (\d+) years?",      lambda m: (TODAY - timedelta(days=365*int(m.group(1))), TODAY)),
    (r"last (\d+) months?",     lambda m: (TODAY - timedelta(days=30*int(m.group(1))),  TODAY)),
    (r"past (\d+) months?",     lambda m: (TODAY - timedelta(days=30*int(m.group(1))),  TODAY)),
    (r"last (\d+) days?",       lambda m: (TODAY - timedelta(days=int(m.group(1))),     TODAY)),
    (r"last year",              lambda m: (TODAY - timedelta(days=365), TODAY)),
    (r"past year",              lambda m: (TODAY - timedelta(days=365), TODAY)),
    (r"last month",             lambda m: (TODAY - timedelta(days=30),  TODAY)),
    (r"last two years?",        lambda m: (TODAY - timedelta(days=730), TODAY)),
    (r"past two years?",        lambda m: (TODAY - timedelta(days=730), TODAY)),
    (r"last quarter",           lambda m: (TODAY - timedelta(days=90),  TODAY)),
    (r"since (\d{4})",          lambda m: (datetime(int(m.group(1)), 1, 1), TODAY)),
    (r"from (\d{4})",           lambda m: (datetime(int(m.group(1)), 1, 1), TODAY)),
    (r"throughout (\d{4})",     lambda m: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
    (r"during (\d{4})",         lambda m: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
    (r"all of (\d{4})",         lambda m: (datetime(int(m.group(1)), 1, 1), datetime(int(m.group(1)), 12, 31))),
]

def extract_date_range(user_input: str):
    lower = user_input.lower()
    for pattern, extractor in DATE_PATTERNS:
        match = re.search(pattern, lower)
        if match:
            try:
                start, end = extractor(match)
                end = min(end, TODAY)
                if (end - start).days > 730:
                    start = end - timedelta(days=730)
                return (
                    start.strftime("%Y-%m-%d"),
                    end.strftime("%Y-%m-%d")
                )
            except Exception:
                continue
    return None

def apply_date_override(strategy: dict, user_input: str) -> dict:
    date_range = extract_date_range(user_input)
    if date_range:
        start, end = date_range
        direction = "LONG" if "LONG" in strategy else "SHORT"
        strategy[direction]["context"]["dateframe"] = {
            "start": start,
            "end": end
        }
    return strategy

def parse_strategy_with_context(
    messages: list,
    adapter_path="adapters",
    allowed_tickers: list = None,
    allowed_timeframes: list = None
) -> tuple:
    from mlx_lm import generate

    # Only use user messages - skip assistant questions
    user_messages = [m["content"] for m in messages if m["role"] == "user"]
    combined_input = " ".join(user_messages)

    # Build registry context with all tickers first
    registry_context = build_registry_context(allowed_tickers, allowed_timeframes)

    # Normalise tickers BEFORE building constraints
    combined_input = normalise_tickers_from_registry(combined_input, registry_context)

    # Now detect which tickers are mentioned and constrain timeframes accordingly
    mentioned_tickers = [
        t for t in registry_context["tickers"].keys()
        if t in combined_input.upper()
    ]

    if mentioned_tickers and not allowed_timeframes:
        # Rebuild context constrained to mentioned tickers' available timeframes
        available_tfs = set()
        ticker_reg = load_ticker_registry()
        all_tfs = list(registry_context["timeframes"])
        for t in mentioned_tickers:
            tfs = ticker_reg.get(t, {}).get("available_timeframes", all_tfs)
            available_tfs.update(tfs)
        allowed_timeframes_for_context = list(available_tfs)
        registry_context = build_registry_context(allowed_tickers, allowed_timeframes_for_context)

    print(f"DEBUG mentioned tickers: {mentioned_tickers}")
    print(f"DEBUG final timeframes: {registry_context['timeframes']}")

    model, tokenizer = get_model(adapter_path)
    system_prompt = build_system_prompt(registry_context)

    prompt = (
        f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n"
        f"<|im_start|>user\n{combined_input}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )

    raw_output = generate(model, tokenizer, prompt=prompt, max_tokens=1024)

    strategy, errors = validate_and_repair(raw_output, registry_context)

    if strategy is None:
        return None, errors, raw_output

    last_user_msg = user_messages[-1] if user_messages else ""
    strategy = apply_date_override(strategy, last_user_msg)

    return strategy, errors, raw_output


def normalise_tickers_from_registry(text: str, registry_context: dict) -> str:
    """Replace aliases with canonical tickers using live registry"""
    result = text
    for ticker, aliases in registry_context["tickers"].items():
        for alias in aliases:
            if alias.lower() != ticker.lower():
                import re
                result = re.sub(
                    rf'\b{re.escape(alias)}\b',
                    ticker,
                    result,
                    flags=re.IGNORECASE
                )
    return result

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    import sys

    commands = {
        "prepare-train": "Prepare data and train",
        "test":          "Test with a query",
        "evaluate":      "Run full evaluation",
    }

    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        print("Usage:")
        for cmd, desc in commands.items():
            print(f"  python3 orca_llm.py {cmd:<20} # {desc}")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "prepare-train":
        prepare_and_train()

    elif cmd == "test":
        query = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else \
                "Buy AAPL when RSI drops below 30 on 1h, TP 15%, SL 5%"
        result = parse_strategy(query)
        print(json.dumps(result, indent=2))

    elif cmd == "evaluate":
        evaluate()