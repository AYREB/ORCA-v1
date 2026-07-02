# RunPod Training Guide — Orca LLM

## GPU recommendation
- **A100 80GB** (recommended — fastest, bf16, fits full batch)
- **A10G 24GB** — also works with current config
- **RTX 4090** — works, bf16 supported on Ada Lovelace

## Step 1 — Rent pod and open terminal

Select a PyTorch 2.x + CUDA 12.x template. Open the pod terminal.

## Step 2 — Clone repo

```bash
cd /workspace
git clone <your-repo-url> ORCA-v1
cd ORCA-v1/backend
```

## Step 3 — Install dependencies

```bash
pip install unsloth
pip install trl transformers datasets accelerate bitsandbytes
```

## Step 4 — Generate training data (3000 examples)

```bash
cd /workspace/ORCA-v1/backend
python3 core/LLM/finetune.py generate 3000
```

This writes `training_data.jsonl` to `backend/training_data.jsonl`.
Should take < 1 minute. Check the 3 sample outputs printed at the end — 
TP and SL should be whole numbers (e.g. `"takeProfitPercent": 15`).

## Step 5 — Train

```bash
python3 core/LLM/finetune.py train
```

Expected time:
- A100: ~40–60 min for 1500 steps
- A10G: ~90–120 min
- RTX 4090: ~80–100 min

Watch for training loss decreasing below 0.3. If it plateaus above 0.5 after 600 steps, something is wrong.

## Step 6 — Evaluate

```bash
python3 core/LLM/finetune.py evaluate
```

Target: Valid JSON ≥ 90%, Schema valid ≥ 85%.

## Step 7 — Test with sample queries

```bash
python3 core/LLM/finetune.py test
```

## Step 8 — Export GGUF

```bash
python3 core/LLM/finetune.py export q4_k_m
```

This writes `core/LLM/gguf/orca-qwen2.5-coder-7b.q4_k_m.gguf`.
Upload this file — it's what gets deployed.

## Step 9 — Upload GGUF

```bash
# Option A: upload to Hugging Face
huggingface-cli upload <your-hf-repo> core/LLM/gguf/orca-qwen2.5-coder-7b.q4_k_m.gguf

# Option B: compress and download via RunPod file browser
tar -czf orca-gguf.tar.gz core/LLM/gguf/
```

## Deployment (Django backend)

Set these env vars on your server:
```
ORCA_LLM_PROVIDER=local
ORCA_LLM_MODEL_PATH=/path/to/orca-qwen2.5-coder-7b.q4_k_m.gguf
```

The `local` provider uses `llama-cpp-python` for CPU/GPU inference.
For Modal hosted inference, set `ORCA_LLM_PROVIDER=modal` and `ORCA_MODAL_INFERENCE_URL`.
