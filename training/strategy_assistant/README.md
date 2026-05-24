# Orca Strategy Assistant Training

This directory is for curated supervised fine-tuning examples for the Orca strategy assistant.

Use this for proprietary behavior training:
- ORCA-specific strategy review style.
- Correct interpretation of the 5-stage builder.
- Read-only response boundaries.
- Risk, overfitting, and backtest-design critique.
- Refusals for direct buy/sell advice.

Do not add real user strategies unless the user has explicitly opted in.

## Example Shape

Each JSONL row should contain a training conversation. Keep strategy context structured so the model learns to reason from Orca builder state.

```json
{"messages":[{"role":"system","content":"You are Orca's proprietary strategy assistant..."},{"role":"user","content":"Strategy context: {...}\n\nReview my strategy."},{"role":"assistant","content":"Read: ..."}]}
```

The app uses local Ollama by default during development:

```bash
ORCA_ASSISTANT_PROVIDER=ollama
ORCA_ASSISTANT_OLLAMA_MODEL=gemma3:4b
ORCA_ASSISTANT_OLLAMA_BASE_URL=http://127.0.0.1:11434
```

When a fine-tuned hosted model is ready, set:

```bash
ORCA_ASSISTANT_PROVIDER=openai
ORCA_ASSISTANT_MODEL=ft:<your-fine-tuned-model-id>
```
