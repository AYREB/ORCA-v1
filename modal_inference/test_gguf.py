"""One-off: run test prompts against a GGUF on the orca-models volume.

Used to grill a freshly trained model BEFORE promoting it to the live
filename. Prompts are built locally (so the checked-out branch's system
prompt is used) and generation happens on a Modal GPU.

Usage:
    modal run modal_inference/test_gguf.py --gguf orca-qwen2.5-v2.gguf
"""

import json

import modal

app = modal.App("orca-test-gguf")
volume = modal.Volume.from_name("orca-models")

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("libgomp1")
    .pip_install(
        "llama-cpp-python==0.3.19",
        extra_index_url="https://abetlen.github.io/llama-cpp-python/whl/cu124",
    )
)


@app.function(image=image, gpu="A10G", volumes={"/models": volume}, timeout=1200)
def generate_batch(gguf: str, prompts: list[str]) -> list[str]:
    from llama_cpp import Llama

    llm = Llama(model_path=f"/models/{gguf}", n_ctx=4096, n_gpu_layers=-1, verbose=False)
    outputs = []
    for prompt in prompts:
        out = llm(prompt, max_tokens=1024, temperature=0.0, stop=["<|im_end|>"])
        outputs.append(out["choices"][0]["text"])
    return outputs


@app.local_entrypoint()
def main(gguf: str = "orca-qwen2.5-v2.gguf"):
    import os
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
    from core.LLM.registry_loader import build_full_system_prompt

    system_prompt = build_full_system_prompt()

    queries = [
        # cross-ticker (the v2 headline)
        "buy AAPL when SPY's RSI drops below 30 on the hourly, tp 15% sl 5%",
        "short TSLA when the S&P tanks 2% in a day, tp 20% sl 10%",
        "load up on bitcoin when QQQ crosses above its 200 day moving average, tp 25% sl 10%",
        "buy NVDA when SPY gets oversold under 30 rsi, sell when SPY recovers above 55, tp 20% sl 8%",
        # retail-speak
        "ape into tesla when rsi dips under 25 on the 4h, secure the bag at 30%, bail if it tanks 10%",
        "yolo into PLTR when macd flips green on the daily, im out at +25%, cut it if it drops 8%",
        # FX realism
        "long eurusd when rsi drops below 30 on 1h, tp 2%, sl 1%",
        "short the pound when its rsi tops 75 on the hourly, tp 1.5% sl 0.7%",
        # unknown symbols verbatim
        "buy HOOD when rsi drops below 30 on 1h, tp 15% sl 5%",
        "short COIN when macd goes negative on the daily, tp 20% sl 10%",
        # v1 regression
        "buy apple when rsi drops below 30 on the hourly, take profit 15%, stop loss 5%",
        "Long NVDA whenever 9 EMA crosses above 21 EMA on 15 minute chart, tight stop 4%, target 12%",
    ]

    prompts = [
        f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n"
        f"<|im_start|>user\n{q}<|im_end|>\n"
        f"<|im_start|>assistant\n"
        for q in queries
    ]

    outputs = generate_batch.remote(gguf, prompts)

    from core.LLM.orca_llm import validate_and_repair
    from core.LLM.registry_loader import build_registry_context

    ctx = build_registry_context()
    passed = 0
    for q, raw in zip(queries, outputs):
        strategy, errors = validate_and_repair(raw, ctx)
        if strategy is None:
            print(f"FAIL  {q[:70]}\n      issues: {errors}\n      raw: {raw[:160]}")
            continue
        d = "LONG" if "LONG" in strategy else "SHORT"
        c = strategy[d]["context"]
        sig = c.get("signal_tickers", [])
        args = strategy[d]["OPEN"]["ARGUMENTS"]
        has_close = "CLOSE" in strategy[d]
        print(f"OK    {q[:70]}")
        print(f"      -> {d} {c['tickers']}"
              + (f" watch={sig}" if sig else "")
              + f" @{c['execution_timeframe']} TP={args.get('takeProfitPercent')} SL={args.get('stopLossPercent')}"
              + (" +CLOSE" if has_close else ""))
        passed += 1

    print(f"\n{passed}/{len(queries)} passed")
