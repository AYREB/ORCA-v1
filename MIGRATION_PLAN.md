# Orca Deployment Migration Plan

## Overview

Migrating from a local development setup to a fully hosted QA + Production environment.
No platform-specific lock-in — every component can be swapped out independently.

We **are** self-hosting the strategy-parser inference model (fine-tuned GGUF on Modal).
The conversational *assistant* stays on a hosted API (OpenAI). These are two separate
LLM paths and that is intentional.

---

## Target Architecture

```
GitHub (source of truth)
├── develop branch ──► Railway QA   ──► orca-qa.up.railway.app
│                 └──► Vercel preview ──► develop.orca.vercel.app
│
└── main branch ────► Railway Prod  ──► orca-prod.up.railway.app (or custom domain)
                  └──► Vercel prod  ──► orca.yourdomain.com

Railway add-ons (per environment): PostgreSQL + Redis
Modal (shared GPU inference endpoint for the parser, called by both QA + Prod Django)
```

### Services

| Component        | Platform        | Notes                                       |
|------------------|-----------------|---------------------------------------------|
| Django backend   | Railway         | Two environments: QA + Prod                 |
| PostgreSQL DB    | Railway         | One DB per environment                      |
| Redis            | Railway         | Shared cache: job store + rate limiting     |
| React frontend   | Vercel          | Auto-preview per branch, prod on main       |
| Parser inference | Modal           | Serverless GPU GGUF endpoint, HTTP from Django |
| Assistant LLM    | OpenAI API      | `ORCA_ASSISTANT_PROVIDER=openai`            |
| Fine-tuning      | Local / Colab   | Unsloth (cross-platform), exports GGUF      |

---

## Current State vs Target State

| Area                  | Now                          | After migration                        |
|-----------------------|------------------------------|----------------------------------------|
| Backend server        | `manage.py runserver`        | Gunicorn on Railway                    |
| Database              | SQLite                       | PostgreSQL (Railway addon)             |
| Cache / job store     | File cache in `/tmp`         | Redis (Railway addon)                  |
| Parser inference      | `mlx_lm` (Mac only)          | `llama-cpp-python` GGUF (any OS + GPU) |
| Model fine-tuning     | `mlx_lm.lora` (Mac only)     | Unsloth + PyTorch (any OS with GPU)    |
| Parser serving        | Local process                | Modal serverless GPU endpoint          |
| Market data (CSVs)    | Local, gitignored            | Baked into image / Railway volume      |
| Frontend serving      | `vite dev`                   | Static build on Vercel                 |
| Static files          | Django dev server            | Whitenoise (served from Django)        |
| Env config            | Local .env                   | Platform env vars per environment      |
| Dependencies          | No requirements.txt          | requirements.txt + pinned versions     |
| QA environment        | None                         | Railway QA + Vercel preview            |

### Already done in code (earlier session)
- `DEBUG` now defaults to **False** in `settings.py` (fails safe; local `.env` still sets `DEBUG=true`).
- Async optimizer job store is now **cache-backed** (`CacheJobStore`), so it works across
  gunicorn workers and survives restarts. With Redis set it also works across replicas.
- `CACHES` auto-switches to Redis when `REDIS_URL` is present; file-cache location is
  configurable via `FILE_CACHE_LOCATION`.
- `frontend/.env.example` created (documents `VITE_DJANGO_API_URL` and `VITE_GOOGLE_CLIENT_ID`).
- Dead `backend/api/logic/` duplicate tree removed (`core/` is canonical).

### Done in code (this session)
- **`orca_llm.py` rewritten with a provider abstraction** (`generate_raw()` dispatcher).
  `ORCA_LLM_PROVIDER` selects `mlx` (default — preserves current Mac dev), `local`
  (llama-cpp-python GGUF, any OS/GPU), or `modal` (hosted HTTP). MLX is now lazy-imported
  only on the `mlx` path, so Railway never needs it.  *(Still TODO: produce the GGUF and
  flip prod to `modal`.)*
- **`modal_inference/app.py` created** — A10G GPU, GGUF on a Modal Volume, single
  Bearer-authenticated POST endpoint. *(Still TODO: upload a GGUF and `modal deploy`.)*
- **`backend/requirements.txt`** — hand-curated, pinned, no mlx; prod deps included;
  `llama-cpp-python` left commented (not needed under `modal`).
- **`backend/Procfile`** and **`backend/railway.toml`** (build collectstatic, preDeploy migrate).
- **`settings.py`**: WhiteNoise middleware + `STORAGES` (both guarded so local dev still boots);
  Postgres via `dj-database-url` when `DATABASE_URL` is set (else SQLite locally).
- **`frontend/vercel.json`** — SPA rewrite fallback. `npm run build` passes.

---

## Phase 1 — Model Migration (MLX → Cross-Platform)

**Goal:** Remove Apple Silicon dependency. Make parser inference work on any OS with any GPU.

### 1.1 Rewrite `core/LLM/orca_llm.py`
- Remove all `mlx_lm` imports (currently hard-coded: `mlx-community/Qwen2.5-7B-Instruct-4bit`).
- Replace `get_model()` + `mlx_lm.generate()` with `llama-cpp-python` inference.
- Add `ORCA_LLM_PROVIDER` env var: `local` (dev) or `modal` (production).
- Local path: loads GGUF file directly via `llama-cpp-python`, auto-detects GPU/Metal/CPU.
- Modal path: POSTs to the Modal HTTP endpoint, returns the same JSON output.
- Keep the existing `validate_conditions` / registry-context post-processing unchanged —
  only the raw text-generation call swaps out.

**New env vars (backend):**
```
ORCA_LLM_PROVIDER=local                           # 'local' or 'modal'
ORCA_LLM_MODEL_PATH=models/orca-qwen2.5.gguf      # path to GGUF file (local only)
ORCA_MODAL_INFERENCE_URL=https://...              # Modal endpoint URL (modal only)
ORCA_MODAL_API_KEY=...                            # Modal endpoint auth key
```

### 1.2 Write cross-platform fine-tuning script
- New file: `backend/core/LLM/finetune.py`
- Uses Unsloth + PyTorch (works on Mac MPS, Windows CUDA, Linux CUDA).
- Reads the same `new_training_data.jsonl` training data.
- Exports to GGUF format on completion.
- Run once to get your GGUF model file, then deploy.

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
- Stores the GGUF on a **Modal Volume** (don't bake a multi-GB model into the image).
- Loads the GGUF on GPU using `llama-cpp-python`.
- Exposes a single authenticated POST endpoint: `{ "prompt": "..." }` → `{ "output": "..." }`.
- **Require auth:** check an `Authorization: Bearer <ORCA_MODAL_API_KEY>` header (or a Modal
  proxy auth token). Django sends this header; reject requests without it so the GPU endpoint
  isn't open to the world.
- Django calls this endpoint from `orca_llm.py` when `ORCA_LLM_PROVIDER=modal`.

**Modal hardware:** A10G GPU.

**Cold-start tradeoff (important):**
- **Scale-to-zero (recommended for low traffic):** cheapest, but the first request after idle
  pays a GPU cold start + GGUF load (~10–30s for a 7B Q4). Set a short idle keep-alive
  (`scaledown_window`/`container_idle_timeout`, e.g. 120–300s) so a burst of requests stays warm.
- **Keep-warm (`min_containers=1`):** ~instant, but an always-on A10G (~$1/hr) will burn the
  Modal free credit (~$30/mo) in roughly a day. Only do this once traffic justifies it.
- Because of cold starts, **`gunicorn --timeout 120` must comfortably exceed cold-start +
  inference time.** Keep the frontend fetch timeout generous for the first parse, too.

**Deploying the Modal endpoint:**
```bash
pip install modal
modal token new
modal volume create orca-models           # then upload the GGUF to it
modal deploy modal_inference/app.py
# outputs: endpoint URL → set as ORCA_MODAL_INFERENCE_URL
```

---

## Phase 2 — Backend Production Prep

**Goal:** Make Django deployable to any Linux server.

### 2.1 Generate requirements.txt
> ⚠️ **Do not blindly `pip freeze` on your Mac.** A raw freeze captures macOS-only wheels
> (e.g. `mlx`, `mlx_lm`, Apple-specific pins) that fail to install on Railway's Linux. Hand-curate.

Start from the real imports and pin versions you have locally:
```
Django==5.2.8
djangorestframework==3.16.1
django-cors-headers==4.9.0
numpy==2.2.6
pandas==2.3.3
pandas-ta==0.4.71b0
requests==2.32.5
yfinance==0.2.66
certifi
```
Then add the production/runtime deps:
```
gunicorn>=21.0
whitenoise>=6.0
psycopg2-binary>=2.9
dj-database-url>=2.0
redis>=5.0
llama-cpp-python>=0.2          # only if ORCA_LLM_PROVIDER=local runs on this host
```
> Note: `llama-cpp-python` is **not** needed on Railway when `ORCA_LLM_PROVIDER=modal`
> (inference happens on Modal). Keep it out of the Railway requirements to avoid a heavy
> build; install it only where you run local inference.

### 2.2 Add Gunicorn start command
Create `backend/Procfile`:
```
web: gunicorn backend.wsgi --workers 2 --bind 0.0.0.0:$PORT --timeout 120
```
`--timeout 120` matters — strategy parsing (incl. a Modal cold start) can take time.

> The optimizer endpoints run heavy work in a background thread inside the web worker. With
> `--workers 2` on one container that's fine, and the cache-backed job store keeps status polls
> consistent. If you later scale to multiple replicas, **Redis is required** (see 2.6) so polls
> on any instance can see the job.

### 2.3 Add Whitenoise for static files
In `backend/backend/settings.py`, add to `MIDDLEWARE` (right after `SecurityMiddleware`):
```python
"whitenoise.middleware.WhiteNoiseMiddleware",
```
Use the Django 5.2 `STORAGES` setting (the old `STATICFILES_STORAGE` is deprecated):
```python
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
```

### 2.4 Switch database to PostgreSQL
Update `settings.py` to read `DATABASE_URL` (Railway sets this automatically):
```python
import dj_database_url

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}
```

### 2.5 Create Railway config
Create `backend/railway.toml`:
```toml
[build]
builder = "nixpacks"
# collectstatic at BUILD time so the manifest + files are baked into the image.
# (A pre-deploy one-off container's filesystem is NOT shared with serving replicas.)
buildCommand = "python manage.py collectstatic --noinput"

[deploy]
startCommand = "gunicorn backend.wsgi --workers 2 --bind 0.0.0.0:$PORT --timeout 120"
# migrate once per deploy, before the new version starts serving.
preDeployCommand = "python manage.py migrate --noinput"
restartPolicyType = "on_failure"
```
> Why split them: `migrate` must run exactly once against the DB → `preDeployCommand`.
> `collectstatic` output must live in the serving image → build phase. Don't put collectstatic
> in `preDeployCommand` — those files won't reach the running containers.

### 2.6 Add Redis (cache, job store, rate limiting)
1. Add a **Redis** addon to each Railway environment.
2. Railway exposes `REDIS_URL` automatically — the app already switches `CACHES` to Redis when
   it's set. No code change needed.
3. This makes rate limiting and the optimizer job store correct even across multiple replicas.

### 2.7 Market data (CSVs)
The backtester reads pre-pulled OHLC from `backend/core/data_csvs/`, which is **gitignored**
(0 files tracked). Without these, production falls back to `yfinance`, which is frequently
rate-limited/blocked from datacenter IPs. Pick one:

- **Simplest — commit the CSVs:** remove `backend/core/data_csvs/` from `.gitignore`, commit the
  (non-empty) CSVs so nixpacks bakes them into the image. Prune the empty/1-line CSVs first.
- **Better for larger/refreshable data — Railway volume:** mount a volume at the data dir and
  populate it via a one-off `manage.py` command or a scheduled refresh job that pulls OHLC.

Set `ORCA_ASSISTANT_MARKET_DATA_DIR` if the data lives somewhere other than the default
`core/data_csvs`.

### 2.8 Test locally in production mode
```bash
cd backend
DEBUG=False DJANGO_SECRET_KEY=$(python -c "import secrets;print(secrets.token_hex(48))") \
  ALLOWED_HOSTS=localhost gunicorn backend.wsgi --bind 127.0.0.1:8000
```

---

## Phase 3 — Frontend Production Prep

**Goal:** Make the React frontend point to the correct backend per environment.

### 3.1 API base URL env var
The frontend already reads `VITE_DJANGO_API_URL` (see `frontend/src/lib/api.ts`) and falls back
to `http://127.0.0.1:8000/api`. **The URL must include the trailing `/api`.** No source changes
needed — just set the env var per environment. `frontend/.env.example` already documents this.

```
# frontend/.env (local)            -> VITE_DJANGO_API_URL=http://127.0.0.1:8000/api
# Vercel QA                        -> VITE_DJANGO_API_URL=https://orca-qa.up.railway.app/api
# Vercel Prod                      -> VITE_DJANGO_API_URL=https://orca-prod.up.railway.app/api
```

Also set **`VITE_GOOGLE_CLIENT_ID`** (used by `AuthModal.tsx`) per environment, or the Google
sign-in button is hidden. Remember: Vite **inlines these at build time**, so a change requires a
rebuild/redeploy, not just an env edit.

### 3.2 Vercel configuration
Create `frontend/vercel.json` for React Router SPA fallback:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```

---

## Phase 4 — QA Deployment

### 4.1 Railway QA setup
1. Create Railway account at railway.app.
2. New project → "Deploy from GitHub repo"; set root directory to `backend`.
3. Add the **PostgreSQL** addon and the **Redis** addon.
4. Create/select a `QA` environment.
5. Set env vars (see Environment Variables section).
6. Link to `develop` branch → auto-deploys on push.

### 4.2 Vercel QA setup
1. Create Vercel account at vercel.com; import the repo.
2. Root directory `frontend`; build command `npm run build`; output dir `dist`.
3. Set `VITE_DJANGO_API_URL` (with `/api`) to the Railway QA URL and `VITE_GOOGLE_CLIENT_ID`.
4. Every push to any branch gets a preview URL automatically.

### 4.3 Modal deployment
1. Create Modal account; `pip install modal`; `modal token new`.
2. Create a volume and upload your GGUF model file to it.
3. `modal deploy modal_inference/app.py`.
4. Copy the endpoint URL → set `ORCA_MODAL_INFERENCE_URL` and `ORCA_MODAL_API_KEY` in Railway.

---

## Phase 5 — Production Deployment

### 5.1 Railway Prod setup
Same as QA but:
- Linked to `main` branch.
- Separate PostgreSQL **and** Redis instances.
- Production env vars (separate secret key, separate API keys).
- Custom domain if you have one.

### 5.2 Vercel Prod setup
- Production deployment auto-triggers on push to `main`.
- Set `VITE_DJANGO_API_URL` (with `/api`) to the Railway Prod URL; set `VITE_GOOGLE_CLIENT_ID`.
- Add custom domain in the Vercel dashboard.

---

## Environment Variables Reference

### Railway (Backend) — set per environment

| Variable                      | QA value                          | Prod value                       |
|-------------------------------|-----------------------------------|----------------------------------|
| `DEBUG`                       | `False`                           | `False`                          |
| `DJANGO_SECRET_KEY`           | generate (64 char random)         | generate (different key)         |
| `ALLOWED_HOSTS`               | `orca-qa.up.railway.app`          | `orca-prod.up.railway.app` (+ custom domain) |
| `CORS_ALLOWED_ORIGINS`        | `https://develop.orca.vercel.app` | `https://orca.yourdomain.com`    |
| `CSRF_TRUSTED_ORIGINS`        | same as CORS                      | same as CORS                     |
| `DATABASE_URL`                | auto-set by Railway PostgreSQL    | auto-set by Railway PostgreSQL   |
| `REDIS_URL`                   | auto-set by Railway Redis         | auto-set by Railway Redis        |
| `ORCA_ASSISTANT_PROVIDER`     | `openai`                          | `openai`                         |
| `OPENAI_API_KEY`              | your key                          | your key                         |
| `ORCA_LLM_PROVIDER`           | `modal`                           | `modal`                          |
| `ORCA_MODAL_INFERENCE_URL`    | Modal endpoint URL                | Modal endpoint URL               |
| `ORCA_MODAL_API_KEY`          | Modal auth key                    | Modal auth key                   |
| `GOOGLE_CLIENT_ID`            | your Google OAuth client ID       | your Google OAuth client ID      |
| `SECURE_SSL_REDIRECT`         | `True`                            | `True`                           |
| `TRUSTED_PROXY_COUNT`         | `1`                               | `1`                              |

> Security defaults (HSTS, secure cookies) auto-enable when `DEBUG=False`, so you don't need to
> set each one. `EMAIL_*` vars are only needed if you wire up real password-reset email
> (otherwise it logs to console).

### Vercel (Frontend) — set per environment

| Variable                | QA value                                  | Prod value                              |
|-------------------------|-------------------------------------------|-----------------------------------------|
| `VITE_DJANGO_API_URL`   | `https://orca-qa.up.railway.app/api`      | `https://orca-prod.up.railway.app/api`  |
| `VITE_GOOGLE_CLIENT_ID` | your Google OAuth client ID               | your Google OAuth client ID             |

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
    [ ] 1.3  Write modal_inference/app.py (Modal Volume + auth header)
    [ ] 1.4  Run fine-tuning, produce GGUF file
    [ ] 1.5  Test inference locally (llama-cpp-python)

[ ] Phase 2: Backend prep
    [ ] 2.1  Hand-write requirements.txt (NO raw pip freeze; no mlx)
    [ ] 2.2  Add gunicorn, whitenoise, psycopg2-binary, dj-database-url, redis
    [ ] 2.3  Update settings.py (Whitenoise middleware + STORAGES)
    [ ] 2.4  Update settings.py (dj-database-url)
    [ ] 2.5  Write Procfile + railway.toml (build collectstatic, preDeploy migrate)
    [ ] 2.6  Add Redis addon; confirm REDIS_URL switches the cache
    [ ] 2.7  Solve market-data CSVs (commit pruned set OR Railway volume)
    [ ] 2.8  Test: DEBUG=False, gunicorn locally

[ ] Phase 3: Frontend prep
    [ ] 3.1  Set VITE_DJANGO_API_URL (with /api) + VITE_GOOGLE_CLIENT_ID per env
    [ ] 3.2  Create vercel.json
    [ ] 3.3  Test: npm run build succeeds

[ ] Phase 4: QA deployment
    [ ] 4.1  Create Railway project, add PostgreSQL + Redis, set QA env vars
    [ ] 4.2  Push develop branch, verify deploy + migrations run
    [ ] 4.3  Deploy Modal endpoint, set ORCA_MODAL_INFERENCE_URL + key in Railway
    [ ] 4.4  Connect Vercel, set frontend env vars, verify preview deploy
    [ ] 4.5  End-to-end QA test: register, login, backtest, strategy chat, parser, optimizer

[ ] Phase 5: Production deployment
    [ ] 5.1  Merge develop → main
    [ ] 5.2  Create Railway Prod env, separate PostgreSQL + Redis, prod env vars
    [ ] 5.3  Verify Prod deploys and migrations run
    [ ] 5.4  Set Vercel production frontend env vars to prod Railway URL
    [ ] 5.5  End-to-end prod test
    [ ] 5.6  Point custom domain (if applicable)

[ ] Phase 6: Ongoing
    [ ] 6.1  Any new feature: push to develop → test on QA → merge to main → prod
    [ ] 6.2  Re-fine-tuning: run finetune.py, export new GGUF, re-upload volume, redeploy Modal
    [ ] 6.3  Moving platforms: update env vars, point DNS — no code changes needed
```

---

## Platform Accounts Needed

| Platform  | URL                  | Purpose                          | Cost                          |
|-----------|----------------------|----------------------------------|-------------------------------|
| Railway   | railway.app          | Django + PostgreSQL + Redis      | ~$5–20/month                  |
| Vercel    | vercel.com           | React frontend                   | Free                          |
| Modal     | modal.com            | GPU parser inference             | Free tier ($30/month credit)  |
| OpenAI    | platform.openai.com  | Assistant LLM                    | Usage-based                   |
| GitHub    | github.com           | Source control + auto-deploys    | Free                          |

> Modal cost note: scale-to-zero means you mostly pay for actual inference seconds + cold
> loads, which the free credit usually covers at low traffic. Keep-warm changes that — see 1.3.

---

## Can Everything Be Changed Later?

Yes. Nothing is platform-specific:
- **Django** runs on any Linux server — Railway → Fly.io → VPS → AWS in an afternoon.
- **Frontend** is plain static files — Vercel → Netlify → S3 → Cloudflare Pages, no code changes.
- **Modal** inference code is pure Python — copy to RunPod, Fly.io GPU, or any server with a GPU.
- **PostgreSQL** — `pg_dump` exports everything, `pg_restore` imports it anywhere.
- **Redis** — any managed Redis works; just point `REDIS_URL` at it.
- **All platforms** are connected only via env vars and DNS — swap one without touching the others.
```
