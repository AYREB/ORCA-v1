# finetune.py
"""
Orca LLM Fine-tuning Pipeline
Base model: Qwen2.5-Coder-7B-Instruct
Framework: Unsloth + LoRA + SFTTrainer
"""

import json
import os
import sys
from pathlib import Path

# ---------------- PATHS ----------------

BASE_DIR = Path(__file__).resolve().parent
REGISTRY_DIR = BASE_DIR.parent / "registries"
TRAINING_DATA = BASE_DIR.parent.parent / "training_data.jsonl"
ADAPTER_OUTPUT = BASE_DIR / "adapters"
GGUF_OUTPUT = BASE_DIR / "gguf"

# Add backend/ to sys.path so core.* imports resolve from any working directory
_BACKEND_DIR = str(BASE_DIR.parent.parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

# ---------------- CONFIG ----------------

MODEL_NAME = "unsloth/Qwen2.5-Coder-7B-Instruct"

LORA_CONFIG = {
    "r": 16,
    "lora_alpha": 32,
    "lora_dropout": 0.05,
    "target_modules": [
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ],
    "bias": "none",
}

TRAINING_CONFIG = {
    "max_seq_length": 2048,
    # T4 (14.5GB usable) can only fit ONE 2048-token sequence through a 7B
    # QLoRA forward pass. Effective batch stays 8 via gradient accumulation.
    "per_device_train_batch_size": 1,
    "per_device_eval_batch_size": 1,
    "gradient_accumulation_steps": 8,
    "warmup_steps": 30,
    # 600 steps x effective batch 8 = ~1.8 epochs over 2,700 examples. On a
    # free T4 with gradient offloading (~37s/step) that's ~6.5h — fits inside
    # Kaggle's ~9h session cap. 1500 steps would be killed at ~60%.
    "max_steps": 600,
    "learning_rate": 2e-4,
    "logging_steps": 25,
    "eval_steps": 200,
    "save_steps": 200,
    "optim": "adamw_8bit",
    "weight_decay": 0.01,
    "lr_scheduler_type": "cosine",
    "seed": 42,
    "fp16": not bool(os.environ.get("USE_BF16", "")),  # fp16 by default (T4/P100 safe); set USE_BF16=1 on A100/A10G
    "bf16": bool(os.environ.get("USE_BF16", "")),
}

# ---------------- SYSTEM PROMPT BUILDER ----------------

def build_training_system_prompt() -> str:
    from core.LLM.registry_loader import build_full_system_prompt
    return build_full_system_prompt()


# ---------------- DATA PREPARATION ----------------

def load_and_format_dataset(data_path: Path, system_prompt: str):
    """
    Load JSONL training data and format into chat template.
    Each example becomes a full conversation turn.
    """
    from datasets import Dataset

    examples = []

    with open(data_path) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                example = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"[WARN] Skipping line {line_num}: {e}")
                continue

            user_input = example.get("input", "")
            output = example.get("output", "")

            if not user_input or not output:
                continue

            # Ensure output is a string
            if isinstance(output, dict):
                output = json.dumps(output)

            # Format as chat template matching Qwen2.5 instruct format
            text = (
                f"<|im_start|>system\n{system_prompt}<|im_end|>\n"
                f"<|im_start|>user\n{user_input}<|im_end|>\n"
                f"<|im_start|>assistant\n{output}<|im_end|>"
            )

            examples.append({"text": text})

    print(f"✓ Loaded {len(examples)} training examples")

    # Split 90/10 train/val
    split_idx = int(len(examples) * 0.9)
    train_examples = examples[:split_idx]
    val_examples = examples[split_idx:]

    train_dataset = Dataset.from_list(train_examples)
    val_dataset = Dataset.from_list(val_examples)

    print(f"✓ Train: {len(train_dataset)} | Val: {len(val_dataset)}")

    return train_dataset, val_dataset


# ---------------- TRAINING ----------------

def train(data_path: Path = TRAINING_DATA):
    """
    Fine-tune Qwen2.5-Coder-7B-Instruct with LoRA.
    Saves adapter to ADAPTER_OUTPUT.
    """
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    from unsloth import FastLanguageModel
    from trl import SFTTrainer
    try:
        # Modern TRL wants its own SFTConfig; plain TrainingArguments can be
        # silently overridden (observed batch_size=4 on Kaggle despite passing 2).
        from trl import SFTConfig as TrainingArguments
        _USING_SFT_CONFIG = True
    except ImportError:
        from transformers import TrainingArguments
        _USING_SFT_CONFIG = False

    print("\n🚀 Starting Orca LLM fine-tuning")
    print(f"   Model:     {MODEL_NAME}")
    print(f"   Data:      {data_path}")
    print(f"   Output:    {ADAPTER_OUTPUT}")
    print(f"   Max steps: {TRAINING_CONFIG['max_steps']}\n")

    ADAPTER_OUTPUT.mkdir(parents=True, exist_ok=True)

    # ---- Load base model ----
    print("Loading base model...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME,
        max_seq_length=TRAINING_CONFIG["max_seq_length"],
        dtype=None,       # auto-detect
        load_in_4bit=True # QLoRA - fits on single GPU
    )

    # ---- Apply LoRA ----
    print("Applying LoRA adapters...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_CONFIG["r"],
        lora_alpha=LORA_CONFIG["lora_alpha"],
        lora_dropout=LORA_CONFIG["lora_dropout"],
        target_modules=LORA_CONFIG["target_modules"],
        bias=LORA_CONFIG["bias"],
        use_gradient_checkpointing="unsloth",
        random_state=TRAINING_CONFIG["seed"],
    )

    # ---- Build system prompt from registries ----
    print("Building system prompt from registries...")
    system_prompt = build_training_system_prompt()
    print(f"   Indicators: {system_prompt.count('- ') - 1} loaded")

    # ---- Load and format data ----
    print("Loading training data...")
    train_dataset, val_dataset = load_and_format_dataset(data_path, system_prompt)

    # ---- Training args ----
    _sft_extra = (
        {"dataset_text_field": "text", "max_seq_length": TRAINING_CONFIG["max_seq_length"], "packing": False}
        if _USING_SFT_CONFIG else {}
    )
    training_args = TrainingArguments(
        output_dir=str(ADAPTER_OUTPUT),
        per_device_train_batch_size=TRAINING_CONFIG["per_device_train_batch_size"],
        per_device_eval_batch_size=TRAINING_CONFIG["per_device_eval_batch_size"],
        gradient_accumulation_steps=TRAINING_CONFIG["gradient_accumulation_steps"],
        warmup_steps=TRAINING_CONFIG["warmup_steps"],
        max_steps=TRAINING_CONFIG["max_steps"],
        learning_rate=TRAINING_CONFIG["learning_rate"],
        logging_steps=TRAINING_CONFIG["logging_steps"],
        eval_steps=TRAINING_CONFIG["eval_steps"],
        save_steps=TRAINING_CONFIG["save_steps"],
        eval_strategy="steps",
        save_strategy="steps",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        optim=TRAINING_CONFIG["optim"],
        weight_decay=TRAINING_CONFIG["weight_decay"],
        lr_scheduler_type=TRAINING_CONFIG["lr_scheduler_type"],
        seed=TRAINING_CONFIG["seed"],
        fp16=TRAINING_CONFIG["fp16"],
        bf16=TRAINING_CONFIG["bf16"],
        report_to="none",  # disable wandb
        **_sft_extra,
    )

    # ---- Trainer ----
    _trainer_extra = (
        {} if _USING_SFT_CONFIG
        else {"dataset_text_field": "text", "max_seq_length": TRAINING_CONFIG["max_seq_length"], "packing": False}
    )
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        args=training_args,
        **_trainer_extra,
    )

    print(f"   Effective batch: {training_args.per_device_train_batch_size} x "
          f"{training_args.gradient_accumulation_steps} = "
          f"{training_args.per_device_train_batch_size * training_args.gradient_accumulation_steps}")

    # ---- Train ----
    print("\n📊 Training started - watch for loss decreasing...\n")
    trainer_stats = trainer.train()

    # ---- Save adapter ----
    print("\n💾 Saving adapter...")
    model.save_pretrained(str(ADAPTER_OUTPUT))
    tokenizer.save_pretrained(str(ADAPTER_OUTPUT))

    print(f"\n✅ Training complete!")
    print(f"   Final train loss: {trainer_stats.training_loss:.4f}")
    print(f"   Adapter saved to: {ADAPTER_OUTPUT}")

    return model, tokenizer


# ---------------- TEST ----------------

def test(queries: list[str] = None):
    """
    Load trained adapter and run test queries.
    Shows raw output and validation result.
    """
    from unsloth import FastLanguageModel

    if not ADAPTER_OUTPUT.exists():
        print("❌ No adapter found. Run: python finetune.py train")
        return

    print("\n🧪 Loading model for testing...")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(ADAPTER_OUTPUT),
        max_seq_length=TRAINING_CONFIG["max_seq_length"],
        dtype=None,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)

    system_prompt = build_training_system_prompt()

    default_queries = [
        "Buy AAPL when RSI drops below 30 on 1h, TP 15%, SL 5%",
        "Short Tesla when price falls below 50-SMA on 4h, TP 20%, SL 10%",
        "Go long Bitcoin when MACD crosses above zero on daily, TP 30%, SL 10%, last 2 years",
        "buy apple when rsi goes below 30 and macd is positive on the hourly chart",
        "Long NVDA whenever 9 EMA crosses above 21 EMA on 15 minute chart, tight stop 4%, target 12%",
    ]

    test_queries = queries or default_queries

    for i, query in enumerate(test_queries, 1):
        print(f"\n{'='*60}")
        print(f"Test {i}: {query}")
        print(f"{'='*60}")

        prompt = (
            f"<|im_start|>system\n{system_prompt}<|im_end|>\n"
            f"<|im_start|>user\n{query}<|im_end|>\n"
            f"<|im_start|>assistant\n"
        )

        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

        from transformers import TextStreamer
        streamer = TextStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

        _ = model.generate(
            **inputs,
            max_new_tokens=1024,
            streamer=streamer,
            temperature=0.1,
            do_sample=True,
        )


# ---------------- EXPORT GGUF ----------------

def export_gguf(quantisation: str = "q4_k_m"):
    """
    Merge adapter into base model and export as GGUF.
    Used when ready to deploy to Modal.
    Quantisation options: q4_k_m (recommended), q8_0, f16
    """
    from unsloth import FastLanguageModel

    if not ADAPTER_OUTPUT.exists():
        print("❌ No adapter found. Run: python finetune.py train")
        return

    GGUF_OUTPUT.mkdir(parents=True, exist_ok=True)

    print(f"\n📦 Exporting GGUF ({quantisation})...")
    print("This may take 10-15 minutes...\n")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(ADAPTER_OUTPUT),
        max_seq_length=TRAINING_CONFIG["max_seq_length"],
        dtype=None,
        load_in_4bit=True,
    )

    gguf_name   = f"orca-qwen2.5-coder-7b.{quantisation}"
    output_path = str(GGUF_OUTPUT / f"{gguf_name}.gguf")

    model.save_pretrained_gguf(
        str(GGUF_OUTPUT / gguf_name),
        tokenizer,
        quantization_method=quantisation,
    )

    print(f"\n✅ GGUF exported to: {output_path}")
    print("Ready to upload to Modal Volume.")


# ---------------- EVALUATE ----------------

def evaluate(data_path: Path = None):
    """
    Run evaluation on held-out test examples.
    Reports valid JSON rate, schema valid rate.
    """
    from unsloth import FastLanguageModel

    if not ADAPTER_OUTPUT.exists():
        print("❌ No adapter found. Run: python finetune.py train")
        return

    # Use val split of training data if no separate test file
    eval_path = data_path or TRAINING_DATA

    print("\n📊 Running evaluation...")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(ADAPTER_OUTPUT),
        max_seq_length=TRAINING_CONFIG["max_seq_length"],
        dtype=None,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)

    system_prompt = build_training_system_prompt()

    # Load last 10% as eval set
    all_examples = []
    with open(eval_path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    all_examples.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    eval_examples = all_examples[int(len(all_examples) * 0.9):]
    print(f"Evaluating on {len(eval_examples)} examples...\n")

    valid_json = 0
    schema_valid = 0
    total = len(eval_examples)

    for i, example in enumerate(eval_examples):
        if i % 10 == 0:
            print(f"  {i}/{total}", end="\r")

        prompt = (
            f"<|im_start|>system\n{system_prompt}<|im_end|>\n"
            f"<|im_start|>user\n{example['input']}<|im_end|>\n"
            f"<|im_start|>assistant\n"
        )

        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

        outputs = model.generate(
            **inputs,
            max_new_tokens=1024,
            temperature=0.1,
            do_sample=True,
        )

        generated = tokenizer.decode(
            outputs[0][inputs["input_ids"].shape[1]:],
            skip_special_tokens=True
        ).strip()

        # Validate
        try:
            parsed = json.loads(generated)
            valid_json += 1

            if "LONG" in parsed or "SHORT" in parsed:
                direction = "LONG" if "LONG" in parsed else "SHORT"
                body = parsed[direction]
                if all(k in body for k in ["context", "OPEN"]):
                    if "CONDITIONS" in body["OPEN"]:
                        schema_valid += 1
        except json.JSONDecodeError:
            pass

    print(f"\n{'='*50}")
    print(f"EVALUATION RESULTS")
    print(f"{'='*50}")
    print(f"Total:        {total}")
    print(f"Valid JSON:   {valid_json}/{total} ({valid_json/total*100:.1f}%)")
    print(f"Schema valid: {schema_valid}/{total} ({schema_valid/total*100:.1f}%)")
    print(f"{'='*50}")


# ---------------- MAIN ----------------

if __name__ == "__main__":
    commands = {
        "generate": "Generate synthetic training data from registries",
        "train":    "Fine-tune model on training data",
        "test":     "Test trained model with sample queries",
        "export":   "Export trained model as GGUF for Modal deployment",
        "evaluate": "Run evaluation metrics on held-out data",
    }

    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        print("Usage:")
        for cmd, desc in commands.items():
            print(f"  python finetune.py {cmd:<12} # {desc}")
        print("\nExamples:")
        print("  python finetune.py generate 3000 training_data.jsonl")
        print("  python finetune.py train training_data.jsonl")
        print("  python finetune.py export q4_k_m")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "generate":
        from core.LLM.SynthData import generate_dataset
        n   = int(sys.argv[2])   if len(sys.argv) > 2 else 2000
        out = sys.argv[3]        if len(sys.argv) > 3 else str(TRAINING_DATA)
        print(f"Generating {n} examples → {out}")
        generate_dataset(n, out)

    elif cmd == "train":
        data = Path(sys.argv[2]) if len(sys.argv) > 2 else TRAINING_DATA
        if not data.exists():
            print(f"❌ Training data not found: {data}")
            print("  Run: python finetune.py generate")
            sys.exit(1)
        train(data)

    elif cmd == "test":
        queries = sys.argv[2:] if len(sys.argv) > 2 else None
        test(queries)

    elif cmd == "export":
        quant = sys.argv[2] if len(sys.argv) > 2 else "q4_k_m"
        export_gguf(quant)

    elif cmd == "evaluate":
        data = Path(sys.argv[2]) if len(sys.argv) > 2 else None
        evaluate(data)