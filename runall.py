#!/usr/bin/env python3
"""Run frontend and backend dev servers together."""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8000
MAX_BACKEND_PORT_ATTEMPTS = 20


def resolve_backend_python() -> str:
    venv_python = ROOT / ".venv" / "bin" / "python"
    if venv_python.exists():
        return str(venv_python)
    return sys.executable


def resolve_npm() -> str:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    npm_path = shutil.which(npm)
    if npm_path is None:
        raise FileNotFoundError(
            "Could not find npm on PATH. Install Node/npm and try again."
        )
    return npm_path


def start_process(
    name: str,
    cmd: list[str],
    cwd: Path,
    env_overrides: dict[str, str] | None = None,
) -> subprocess.Popen[bytes]:
    print(f"Starting {name}: {' '.join(cmd)} (cwd={cwd})", flush=True)
    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")
    if env_overrides:
        env.update(env_overrides)
    return subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        start_new_session=True,
    )


def stop_process(proc: subprocess.Popen[bytes], grace_period: float = 5.0) -> None:
    if proc.poll() is not None:
        return

    try:
        if os.name != "nt":
            os.killpg(proc.pid, signal.SIGTERM)
        else:
            proc.terminate()
    except ProcessLookupError:
        return

    deadline = time.time() + grace_period
    while time.time() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.1)

    try:
        if os.name != "nt":
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except ProcessLookupError:
        pass


def is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex((host, port)) == 0


def find_available_port(host: str, preferred_port: int, attempts: int) -> int | None:
    for port in range(preferred_port, preferred_port + attempts):
        if not is_port_open(host, port):
            return port
    return None


def resolve_preferred_backend_port() -> int:
    value = os.environ.get("BACKEND_PORT")
    if value is None:
        return BACKEND_PORT
    try:
        port = int(value)
    except ValueError:
        print(f"Ignoring invalid BACKEND_PORT={value!r}; using {BACKEND_PORT}.", flush=True)
        return BACKEND_PORT
    return port if 0 < port <= 65535 else BACKEND_PORT


def wait_for_backend(
    proc: subprocess.Popen[bytes], host: str, port: int, timeout_s: float = 15.0
) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        if is_port_open(host, port):
            return True
        time.sleep(0.2)
    return False


def main() -> int:
    if not BACKEND_DIR.exists():
        print(f"Missing backend directory: {BACKEND_DIR}")
        return 1
    if not FRONTEND_DIR.exists():
        print(f"Missing frontend directory: {FRONTEND_DIR}")
        return 1

    backend_python = resolve_backend_python()
    npm = resolve_npm()
    preferred_backend_port = resolve_preferred_backend_port()
    backend_port = find_available_port(
        BACKEND_HOST,
        preferred_backend_port,
        MAX_BACKEND_PORT_ATTEMPTS,
    )
    if backend_port is None:
        print(
            f"No available backend port found from {preferred_backend_port} "
            f"to {preferred_backend_port + MAX_BACKEND_PORT_ATTEMPTS - 1}.",
            flush=True,
        )
        return 1
    if backend_port != preferred_backend_port:
        print(
            f"Port {preferred_backend_port} is already in use. Using backend port {backend_port}.",
            flush=True,
        )

    backend = start_process(
        "backend (Django)",
        [backend_python, "manage.py", "runserver", f"{BACKEND_HOST}:{backend_port}"],
        BACKEND_DIR,
    )
    backend_ready = wait_for_backend(backend, BACKEND_HOST, backend_port)
    if not backend_ready:
        rc = backend.poll()
        if rc is not None:
            print(f"Backend exited early with code {rc}.", flush=True)
            return rc
        print(
            f"Backend did not confirm on http://{BACKEND_HOST}:{backend_port} "
            "within 15s. Starting frontend anyway...",
            flush=True,
        )
    else:
        print(
            f"Backend is listening on http://{BACKEND_HOST}:{backend_port}",
            flush=True,
        )

    backend_api_url = f"http://{BACKEND_HOST}:{backend_port}/api"
    frontend = start_process(
        "frontend",
        [npm, "run", "dev"],
        FRONTEND_DIR,
        env_overrides={"VITE_DJANGO_API_URL": backend_api_url},
    )
    processes = [("backend", backend), ("frontend", frontend)]

    print("\nBoth services started. Press Ctrl+C to stop all.\n", flush=True)

    try:
        while True:
            for name, proc in processes:
                rc = proc.poll()
                if rc is not None:
                    print(
                        f"{name} exited with code {rc}. Stopping remaining services...",
                        flush=True,
                    )
                    for _, other_proc in processes:
                        if other_proc is not proc:
                            stop_process(other_proc)
                    return rc
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping services...", flush=True)
        return 0
    finally:
        for _, proc in processes:
            stop_process(proc)


if __name__ == "__main__":
    raise SystemExit(main())
