"""One-off: pull the trained GGUF from Kaggle notebook output straight onto
the Modal volume — datacenter to datacenter (~minutes), bypassing slow home
uplinks entirely.

Usage:
    modal run modal_inference/fetch_from_kaggle.py --kernel "username/notebook-slug"

Requires a Modal secret named 'kaggle-api' with KAGGLE_USERNAME and KAGGLE_KEY
(values from kaggle.json).
"""

import modal

app = modal.App("orca-fetch-model")
volume = modal.Volume.from_name("orca-models")

image = modal.Image.debian_slim(python_version="3.11").pip_install("kaggle")


@app.function(
    image=image,
    volumes={"/models": volume},
    secrets=[modal.Secret.from_name("kaggle-api")],
    timeout=3600,
)
def fetch(kernel: str) -> int:
    import glob
    import os
    import shutil
    import subprocess

    out_dir = "/tmp/kaggle_out"
    os.makedirs(out_dir, exist_ok=True)

    print(f"downloading output of kernel: {kernel}")
    subprocess.run(
        ["kaggle", "kernels", "output", kernel, "-p", out_dir],
        check=True,
    )

    ggufs = glob.glob(os.path.join(out_dir, "**", "*.gguf"), recursive=True)
    if not ggufs:
        raise RuntimeError(f"No .gguf found in kernel output. Contents: {os.listdir(out_dir)}")
    src = max(ggufs, key=os.path.getsize)
    size = os.path.getsize(src)
    print(f"found {src} ({size:,} bytes) — moving to volume")

    shutil.move(src, "/models/orca-qwen2.5.gguf")

    # Clean up any partial chunked-upload leftovers from earlier attempts.
    if os.path.isdir("/models/parts"):
        shutil.rmtree("/models/parts")

    volume.commit()
    print(f"DONE: /models/orca-qwen2.5.gguf = {size:,} bytes")
    return size


@app.local_entrypoint()
def main(kernel: str):
    size = fetch.remote(kernel)
    print(f"MODEL ON VOLUME: {size:,} bytes")
