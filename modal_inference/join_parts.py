"""One-off: reassemble chunked GGUF upload on the Modal volume.

Large single-file uploads from slow home uplinks kept timing out, so the
model goes up as ~500MB parts (parts/part_aa .. part_ai) and this function
concatenates them server-side into the final orca-qwen2.5.gguf.

Usage:
    modal run modal_inference/join_parts.py
"""

import modal

app = modal.App("orca-join-parts")
volume = modal.Volume.from_name("orca-models")


@app.function(volumes={"/models": volume}, timeout=1800)
def join() -> int:
    import os
    import shutil

    parts_dir = "/models/parts"
    parts = sorted(os.listdir(parts_dir))
    if not parts:
        raise RuntimeError("No parts found in /models/parts")

    out_path = "/models/orca-qwen2.5.gguf"
    total = 0
    with open(out_path, "wb") as out:
        for name in parts:
            path = os.path.join(parts_dir, name)
            size = os.path.getsize(path)
            total += size
            print(f"appending {name} ({size:,} bytes)")
            with open(path, "rb") as f:
                shutil.copyfileobj(f, out, length=64 * 1024 * 1024)

    final = os.path.getsize(out_path)
    assert final == total, f"size mismatch: wrote {final}, expected {total}"
    shutil.rmtree(parts_dir)
    volume.commit()
    print(f"final: {out_path} = {final:,} bytes; parts dir removed")
    return final


@app.local_entrypoint()
def main():
    size = join.remote()
    print(f"JOIN COMPLETE: {size:,} bytes")
