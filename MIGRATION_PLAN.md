# Orca Deployment Migration Plan

## Overview

Migrating from a local development setup to a fully hosted QA + Production environment.
No platform-specific lock-in — every component can be swapped out independently.

---

## Target Architecture

```
GitHub (source of truth)
├── develop branch ──► Railway QA   ──► orca-qa.up.railway.app
│                 └──► Vercel preview ──► develop.orca.vercel.app
│
└── main branch ────► Railway Prod  ──► orca-prod.up.railway.app (or custom domain)
                  └──► Vercel prod  ──► orca.yourdomain.com

Modal (shared GPU inference endpoint, called by both QA + Prod Django)
```

### Services

| Component        | Platform        | Notes                                      |
|------------------|-----------------|--------------------------------------------|
| Django backend   | Railway         | Two environments: QA + Prod                |
| PostgreSQL DB    | Railway         | One DB per environment                     |
| React frontend   | Vercel          | Auto-preview per branch, prod on main      |
| Model inference  | Modal           | Serverless GPU, called via HTTP from Django |
| Fine-tuning      | Local / Colab   | Unsloth (cross-platform), exports GGUF     |

---

## Current State vs Target State

| Area                  | Now                          | After migration                        |
|-----------------------|------------------------------|----------------------------------------|
| Backend server        | `manage.py runserver`        | Gunicorn on Railway                    |
| Database              | SQLite                       | PostgreSQL (Railway addon)             |
| Model inference       | `mlx_lm` (Mac only)          | `llama-cpp-python` (any OS + GPU)      |
| Model fine-tuning     | `mlx_lm.lora` (Mac only)     | Unsloth + PyTorch (any OS with GPU)    |
| Model serving         | Local process                | Modal serverless GPU endpoint          |
| Frontend serving      | `vite dev`                   | Static build on Vercel                 |
| Static files          | Django dev server            | Whitenoise (served from Django)        |
| Env config            | Hardcoded / local .env       | Platform env vars per environment      |
| Dependencies          | No requirements.txt          | requirements.txt + pinned versions     |
| QA environment        | None                         | Railway QA + Vercel preview            |

---

## Phase 1 — Model Migration (MLX → Cross-Platform)

**Goal:** Remove Apple Silicon dependency. Make inference work on any OS with any GPU.

### 1.1 Rewrite `orca_llm.py`
- Remove all `mlx_lm` imports
- Replace `mlx_lm.generate()` with `llama-cpp-python` inference
- Add `ORCA_LLM_PROVIDER` env var: `local` (dev) or `modal` (production)
- Local path: loads GGUF file directly via `llama-cpp-python`, auto-detects GPU
- Modal path: calls Modal HTTP endpoint, returns same JSON output

**New env vars (backend):**
```
ORCA_LLM_PROVIDER=local           # 'local' or 'modal'
ORCA_LLM_MODEL_PATH=models/orca-qwen2.5.gguf   # path to GGUF file (local only)
ORCA_MODAL_INFERENCE_URL=https://...            # Modal endpoint URL (modal only)
ORCA_MODAL_API_KEY=...                          # Modal endpoint auth key
```

### 1.2 Write cross-platform fine-tuning script
- New file: `backend/core/LLM/finetune.py`
- Uses Unsloth + PyTorch (works on Mac MPS, Windows CUDA, Linux CUDA)
- Reads same `new_training_data.jsonl` training data
- Exports to GGUF format on completion
- Run once to get your GGUF model file, then deploy

**How to fine-tune (any machine with GPU):**
```bash
pip install unsloth
python backend/core/LLM/finetune.py
# outputs: models/orca-qwen2.5.gguf
```

**Can also run free on Google Colab:**
- Upload `new_training_data.jsonl` to Colab
- Run the finetune script
- Download the resulting GGUF file

### 1.3 Write Modal inference endpoint
- New file: `modal_inference/app.py`
- Loads GGUF model on GPU using `llama-cpp-python`
- Exposes a single POST endpoint: `{ "prompt": "..." }` → `{ "output": "..." }`
- Django calls this endpoint from `orca_llm.py` when `ORCA_LLM_PROVIDER=modal`

**Modal hardware:** A10G GPU (fast, within Modal free tier for low traffic)

**Deploying Modal endpoint:**
```bash
pip install modal
modal deploy modal_inference/app.py
# outputs: endpoint URL to set as ORCA_MODAL_INFERENCE_URL
```

---

## Phase 2 — Backend Production Prep

**Goal:** Make Django deployable to any Linux server.

### 2.1 Generate requirements.txt
Run inside your backend virtual environment:
```bash
cd backend
pip freeze > requirements.txt
```
Then manually add if not present:
```
gunicorn>=21.0
whitenoise>=6.0
psycopg2-binary>=2.9
```

### 2.2 Add Gunicorn start command
Create `backend/Procfile`:
```
web: gunicorn backend.wsgi --workers 2 --bind 0.0.0.0:$PORT --timeout 120
```
Note: `--timeout 120` is important — strategy parsing can take time.

### 2.3 Add Whitenoise for static files
In `backend/backend/settings.py`, add to MIDDLEWARE (second position):
```python
"whitenoise.middleware.WhiteNoiseMiddleware",
```
Add storage setting:
```python
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"
```

### 2.4 Switch database to PostgreSQL
Update `settings.py` to read `DATABASE_URL` env var (Railway sets this automatically):
```python
import dj_database_url  # add to requirements.txt

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}
```
Add to requirements.txt: `dj-database-url>=2.0`

### 2.5 Create Railway config
Create `backend/railway.toml`:
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "gunicorn backend.wsgi --workers 2 --bind 0.0.0.0:$PORT --timeout 120"
restartPolicyType = "on-failure"

[[deploy.releaseCommand]]
command = "python manage.py migrate --noinput && python manage.py collectstatic --noinput"
```

---

## Phase 3 — Frontend Production Prep

**Goal:** Make the React frontend point to the correct backend per environment.

### 3.1 Add API base URL env var
All backend API calls must use an env var instead of hardcoded localhost.

In `frontend/.env.example` (create this file):
```
VITE_API_URL=http://localhost:8000
```

In `frontend/.env.qa`:
```
VITE_API_URL=https://orca-qa.up.railway.app
```

In `frontend/.env.production`:
```
VITE_API_URL=https://orca-prod.up.railway.app
```

Find all hardcoded API calls in frontend source and replace base URL with:
```ts
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
```

### 3.2 Vercel configuration
Create `frontend/vercel.json`:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```
This makes React Router work correctly on Vercel (SPA fallback).

---

## Phase 4 — QA Deployment

### 4.1 Railway QA setup
1. Create Railway account at railway.app
2. New project → "Deploy from GitHub repo"
3. Select your repo, set root directory to `backend`
4. Add PostgreSQL addon to the project
5. Set environment to `QA` / create a QA environment
6. Set env vars (see Environment Variables section below)
7. Link to `develop` branch → auto-deploys on push

### 4.2 Vercel QA setup
1. Create Vercel account at vercel.com
2. Import GitHub repo
3. Set root directory to `frontend`
4. Build command: `npm run build`
5. Output directory: `dist`
6. Set `VITE_API_URL` to Railway QA URL
7. Every push to any branch gets a preview URL automatically

### 4.3 Modal deployment
1. Create Modal account at modal.com
2. Install Modal CLI: `pip install modal`
3. Authenticate: `modal token new`
4. Upload your GGUF model file to a Modal volume
5. Deploy: `modal deploy modal_inference/app.py`
6. Copy the endpoint URL → set as `ORCA_MODAL_INFERENCE_URL` in Railway

---

## Phase 5 — Production Deployment

### 5.1 Railway Prod setup
Same as QA but:
- Linked to `main` branch
- Separate PostgreSQL instance
- Production env vars (separate secret key, separate API keys)
- Set custom domain if you have one

### 5.2 Vercel Prod setup
- Production deployment auto-triggers on push to `main`
- Set `VITE_API_URL` to Railway Prod URL
- Add custom domain in Vercel dashboard

---

## Environment Variables Reference

### Railway (Backend) — set per environment

| Variable                      | QA value                        | Prod value                       |
|-------------------------------|---------------------------------|----------------------------------|
| `DEBUG`                       | `False`                         | `False`                          |
| `DJANGO_SECRET_KEY`           | generate (64 char random)       | generate (different key)         |
| `ALLOWED_HOSTS`               | `orca-qa.up.railway.app`        | `orca-prod.up.railway.app`       |
| `CORS_ALLOWED_ORIGINS`        | `https://develop.orca.vercel.app` | `https://orca.yourdomain.com`  |
| `CSRF_TRUSTED_ORIGINS`        | same as CORS                    | same as CORS                     |
| `DATABASE_URL`                | auto-set by Railway PostgreSQL  | auto-set by Railway PostgreSQL   |
| `ORCA_ASSISTANT_PROVIDER`     | `openai`                        | `openai`                         |
| `OPENAI_API_KEY`              | your key                        | your key                         |
| `ORCA_LLM_PROVIDER`           | `modal`                         | `modal`                          |
| `ORCA_MODAL_INFERENCE_URL`    | Modal endpoint URL              | Modal endpoint URL               |
| `ORCA_MODAL_API_KEY`          | Modal auth key                  | Modal auth key                   |
| `GOOGLE_CLIENT_ID`            | your Google OAuth client ID     | your Google OAuth client ID      |
| `SECURE_SSL_REDIRECT`         | `True`                          | `True`                           |
| `TRUSTED_PROXY_COUNT`         | `1`                             | `1`                              |

### Vercel (Frontend) — set per environment

| Variable        | QA value                              | Prod value                          |
|-----------------|---------------------------------------|-------------------------------------|
| `VITE_API_URL`  | `https://orca-qa.up.railway.app`      | `https://orca-prod.up.railway.app`  |

### Local Development (.env in backend/ or project root)

```
DEBUG=True
DJANGO_SECRET_KEY=django-insecure-development-only-change-me
ORCA_ASSISTANT_PROVIDER=ollama
ORCA_ASSISTANT_OLLAMA_MODEL=gemma3:4b
ORCA_LLM_PROVIDER=local
ORCA_LLM_MODEL_PATH=models/orca-qwen2.5.gguf
```

---

## Generating a Secret Key

Run this once per environment, store the output as `DJANGO_SECRET_KEY`:
```bash
python -c "import secrets; print(secrets.token_hex(48))"
```

---

## Migration Order (Do This Sequence)

```
[ ] Phase 1: Model migration
    [ ] 1.1  Rewrite orca_llm.py (llama-cpp-python, local + modal paths)
    [ ] 1.2  Write finetune.py (Unsloth, cross-platform)
    [ ] 1.3  Write modal_inference/app.py
    [ ] 1.4  Run fine-tuning, produce GGUF file
    [ ] 1.5  Test inference locally (llama-cpp-python)

[ ] Phase 2: Backend prep
    [ ] 2.1  Generate requirements.txt from venv
    [ ] 2.2  Add Gunicorn, Whitenoise, psycopg2-binary, dj-database-url to requirements
    [ ] 2.3  Update settings.py (Whitenoise middleware, dj-database-url)
    [ ] 2.4  Write Procfile
    [ ] 2.5  Write railway.toml
    [ ] 2.6  Test: DEBUG=False, gunicorn locally

[ ] Phase 3: Frontend prep
    [ ] 3.1  Audit all hardcoded API URLs in frontend src
    [ ] 3.2  Replace with VITE_API_URL env var
    [ ] 3.3  Create vercel.json
    [ ] 3.4  Test: npm run build succeeds

[ ] Phase 4: QA deployment
    [ ] 4.1  Create Railway project, add PostgreSQL, set QA env vars
    [ ] 4.2  Push develop branch, verify Railway deploys and migrations run
    [ ] 4.3  Deploy Modal endpoint, set ORCA_MODAL_INFERENCE_URL in Railway
    [ ] 4.4  Connect Vercel to repo, set VITE_API_URL, verify preview deploy
    [ ] 4.5  End-to-end QA test: register, login, backtest, strategy chat, parser

[ ] Phase 5: Production deployment
    [ ] 5.1  Merge develop → main
    [ ] 5.2  Create Railway Prod environment, separate PostgreSQL, prod env vars
    [ ] 5.3  Verify Railway Prod deploys and migrations run
    [ ] 5.4  Set Vercel production VITE_API_URL to prod Railway URL
    [ ] 5.5  End-to-end prod test
    [ ] 5.6  Point custom domain (if applicable)

[ ] Phase 6: Ongoing
    [ ] 6.1  Any new feature: push to develop → test on QA → merge to main → prod
    [ ] 6.2  Re-fine-tuning: run finetune.py, export new GGUF, redeploy Modal
    [ ] 6.3  Moving platforms: update env vars, point DNS — no code changes needed
```

---

## Platform Accounts Needed

| Platform  | URL                  | Purpose                        | Cost                          |
|-----------|----------------------|--------------------------------|-------------------------------|
| Railway   | railway.app          | Django backend + PostgreSQL    | ~$5-15/month                  |
| Vercel    | vercel.com           | React frontend                 | Free                          |
| Modal     | modal.com            | GPU model inference            | Free tier ($30/month credit)  |
| GitHub    | github.com           | Source control + auto-deploys  | Free                          |

---

## Can Everything Be Changed Later?

Yes. Nothing is platform-specific:
- **Django** runs on any Linux server — Railway → Fly.io → VPS → AWS in an afternoon
- **Frontend** is plain static files — Vercel → Netlify → S3 → Cloudflare Pages, no code changes
- **Modal** inference code is pure Python — copy to RunPod, Fly.io GPU, or any server with a GPU
- **PostgreSQL** — `pg_dump` exports everything, `pg_restore` imports it anywhere
- **All platforms** are connected only via env vars and DNS — swap one without touching the others
