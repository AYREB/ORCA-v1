"""
Orca parser — Modal serverless GPU inference endpoint.

Loads the fine-tuned Qwen2.5 GGUF (stored on a Modal Volume) with
llama-cpp-python on an A10G GPU and exposes ONE authenticated POST endpoint:

    POST  { "prompt": "...", "max_tokens": 1024 }
      ->  { "output": "..." }

Django calls this from core/LLM/orca_llm.py when ORCA_LLM_PROVIDER=modal.

Deploy:
    pip install modal
    modal token new
    modal volume create orca-models
    # upload your GGUF into the volume:
    modal volume put orca-models ./models/orca-qwen2.5.gguf orca-qwen2.5.gguf
    # set the shared secret used to authenticate Django -> Modal:
    modal secret create orca-inference ORCA_MODAL_API_KEY=<same-key-you-set-in-railway>
    modal deploy modal_inference/app.py
    # -> copy the printed URL into Railway's ORCA_MODAL_INFERENCE_URL
"""

import os

import modal

import fastapi

# ---- Config ---------------------------------------------------------------
GGUF_FILENAME = os.environ.get("ORCA_GGUF_FILENAME", "orca-qwen2.5.gguf")
MODEL_DIR = "/models"
GPU = "A10G"
# Keep a container warm for a short window after a request so a burst of parses
# doesn't each pay a cold start. Raise for steadier traffic; min_containers=1
# (always warm) is ~instant but burns the A10G ~24/7 — only once traffic justifies it.
SCALEDOWN_WINDOW = 300  # seconds

app = modal.App("orca-parser")

# A Volume holds the multi-GB GGUF instead of baking it into the image.
model_volume = modal.Volume.from_name("orca-models", create_if_missing=True)

# CUDA runtime image + PREBUILT llama-cpp-python CUDA wheel. Compiling from
# source (CMAKE_ARGS=-DGGML_CUDA=on) is slow and failed in Modal's builder;
# the official prebuilt cu124 wheels sidestep the compiler entirely.
image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("libgomp1")  # OpenMP runtime — required by the prebuilt llama.cpp lib
    .pip_install(
        # Must be a version with a prebuilt cp311 linux wheel on the cu124
        # index — otherwise pip silently falls back to a source build.
        "llama-cpp-python==0.3.19",
        extra_index_url="https://abetlen.github.io/llama-cpp-python/whl/cu124",
    )
    .pip_install("fastapi[standard]")
)


@app.cls(
    image=image,
    gpu=GPU,
    volumes={MODEL_DIR: model_volume},
    scaledown_window=SCALEDOWN_WINDOW,
    secrets=[modal.Secret.from_name("orca-inference")],
)
class Parser:
    @modal.enter()
    def load(self):
        """Load the GGUF once per container (cold start)."""
        from llama_cpp import Llama

        model_path = os.path.join(MODEL_DIR, GGUF_FILENAME)
        if not os.path.exists(model_path):
            raise RuntimeError(
                f"GGUF not found at {model_path}. Upload it to the 'orca-models' volume."
            )
        self.llm = Llama(
            model_path=model_path,
            n_ctx=4096,
            n_gpu_layers=-1,  # offload all layers to GPU
            verbose=False,
        )

    @modal.fastapi_endpoint(method="POST")
    def infer(self, item: dict, authorization: str = fastapi.Header(default="")):
        # --- Auth: require Authorization: Bearer <ORCA_MODAL_API_KEY> ---
        expected = os.environ.get("ORCA_MODAL_API_KEY", "")
        if not expected or authorization != f"Bearer {expected}":
            raise fastapi.HTTPException(status_code=401, detail="unauthorized")

        prompt = (item or {}).get("prompt", "")
        max_tokens = int((item or {}).get("max_tokens", 1024))
        if not prompt:
            raise fastapi.HTTPException(status_code=400, detail="missing 'prompt'")

        out = self.llm(
            prompt,
            max_tokens=max_tokens,
            temperature=0.0,
            stop=["<|im_end|>"],
        )
        return {"output": out["choices"][0]["text"]}
