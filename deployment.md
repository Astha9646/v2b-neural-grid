# V2B Neural Grid — Deployment Guide

Production deployment instructions for the full stack: **FastAPI backend** (Railway or Docker) and **React frontend** (Vercel). This guide consolidates runbooks into a single operator-facing document.

---

## Table of contents

1. [Deployment topology](#1-deployment-topology)
2. [Prerequisites](#2-prerequisites)
3. [Local development](#3-local-development)
4. [Docker Compose](#4-docker-compose)
5. [Backend — Railway production](#5-backend--railway-production)
6. [Frontend — Vercel production](#6-frontend--vercel-production)
7. [Environment variables reference](#7-environment-variables-reference)
8. [Checkpoints and data artifacts](#8-checkpoints-and-data-artifacts)
9. [Health checks and smoke tests](#9-health-checks-and-smoke-tests)
10. [WebSockets in production](#10-websockets-in-production)
11. [Observability in production](#11-observability-in-production)
12. [Enterprise exports](#12-enterprise-exports)
13. [Production checklist](#13-production-checklist)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Deployment topology

```
                    ┌─────────────────────────────────────┐
                    │  Operators (Browser)                 │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │ HTTPS              │ WSS                 │
              ▼                    ▼                     │
     ┌─────────────────┐   ┌─────────────────────────────┴──┐
     │ Vercel CDN       │   │ Railway (or Docker) Container   │
     │ React SPA        │   │ FastAPI + Uvicorn + WebSockets  │
     │ dist/            │   │ PORT (injected)                 │
     └─────────────────┘   └───────────┬─────────────────────┘
                                         │
                         ┌───────────────┼───────────────┐
                         ▼               ▼               ▼
                    SQLite auth    telemetry CSV    DDPG checkpoints
```

| Service | Platform | Artifact |
|---------|----------|----------|
| Frontend | **Vercel** | `frontend/dist` |
| Backend | **Railway** (recommended) or **Docker** | `backend.railway` / Dockerfile |
| ML weights | Volume / repo mount | `checkpoints/quick_test/best/` |
| Telemetry | Volume / repo mount | `data/grid_telemetry.csv` |

---

## 2. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.11+ | Railway uses `nixpacks.toml` pin |
| Node.js | 20.x | See `frontend/.nvmrc` |
| Git | — | Monorepo deploy |
| Railway account | — | Backend + optional volume |
| Vercel account | — | Frontend |

**Generate production secret:**

```bash
openssl rand -hex 32
```

---

## 3. Local development

### 3.1 Backend

```bash
# From repository root
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate

pip install --upgrade pip
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt

copy backend\.env.example backend\.env   # Windows
# cp backend/.env.example backend/.env   # Unix

uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
```

Verify:

- OpenAPI: http://localhost:8001/docs
- Health: http://localhost:8001/health

### 3.2 Frontend

```bash
cd frontend
npm ci

# Create .env.local
# VITE_API_BASE_URL=http://localhost:8001
# VITE_WS_BASE_URL=ws://localhost:8001
# VITE_ENVIRONMENT=development

npm run dev
```

Open http://localhost:5173 — Vite proxies `/api` and `/ws` only in **dev** (see `vite.config.js`).

### 3.3 Full stack with training data

```bash
python data/preprocess.py --mode telemetry
python evaluate.py                    # optional: populates evaluation/
```

Ensure `data/grid_telemetry.csv` exists before expecting live charts.

---

## 4. Docker Compose

For on-prem or local production-like stacks:

```bash
cp .env.example .env
# Set JWT_SECRET_KEY, CORS_ORIGINS, CHECKPOINT_DIR

docker compose up --build -d
```

| Service | Port | Notes |
|---------|------|-------|
| Backend | 8001 (internal) | Health: `curl http://127.0.0.1:8001/health` |
| Frontend nginx | 80 | Serves built SPA, proxies API |

**Volumes (required for RL):**

```yaml
./checkpoints:/app/checkpoints
./data:/app/data
```

See `docker-compose.yml` and `backend/Dockerfile` for build context.

---

## 5. Backend — Railway production

> Extended reference: [RAILWAY-PRODUCTION.md](./RAILWAY-PRODUCTION.md)

### 5.1 One-time setup

1. **Railway** → New Project → Deploy from GitHub.
2. **Root directory:** repository root (must contain `railway.json`).
3. Do **not** override `PORT` — Railway injects it.

### 5.2 Build & start (from `railway.json`)

**Build:**

```bash
pip install --upgrade pip && \
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu && \
pip install -r requirements-production.txt
```

**Start:**

```bash
python -m backend.railway
```

### 5.3 Required environment variables

```env
ENVIRONMENT=production
JWT_SECRET_KEY=<openssl rand -hex 32>
FRONTEND_URL=https://your-app.vercel.app
```

### 5.4 Recommended variables

```env
LOG_LEVEL=INFO
REQUIRE_AUTH=true
INFERENCE_DEVICE=cpu
CHECKPOINT_DIR=/app/checkpoints/quick_test/best
TELEMETRY_PATH=/app/data/grid_telemetry.csv
CORS_ORIGINS=https://your-app.vercel.app
```

Railway auto-sets:

- `PORT` — bind address
- `RAILWAY_PUBLIC_DOMAIN` — used to derive public `wss://` hints in logs

### 5.5 Health check

| Path | Purpose |
|------|---------|
| `GET /healthz` | **Railway liveness** — returns 200 when process is up |
| `GET /health` | Diagnostics (model, fallbacks, startup report) |

Configured in `railway.json`:

```json
"healthcheckPath": "/healthz"
```

### 5.6 Provisioning checkpoints on Railway

Checkpoints are **not** always in git (size). Options:

1. **Railway volume** mounted at `/app/checkpoints`
2. **Release phase** download from object storage
3. Run degraded/demo mode (heuristic fallback) without weights

Expected files:

```
checkpoints/quick_test/best/actor.pt
# optional: critic.pt, training metadata
```

### 5.7 Public URL

After deploy, note:

```
https://<service>.up.railway.app
```

Use this for:

- `VITE_API_BASE_URL`
- `VITE_WS_BASE_URL` → `wss://<service>.up.railway.app`

---

## 6. Frontend — Vercel production

> Extended reference: [frontend/VERCEL-PRODUCTION.md](./frontend/VERCEL-PRODUCTION.md)

### 6.1 Import project

1. Vercel → Add New Project → Import Git repository.
2. **Root Directory:** `frontend` (monorepo).
3. Framework: **Vite** (auto-detected).

### 6.2 Build settings

| Setting | Value |
|---------|-------|
| Install Command | `npm ci` |
| Build Command | `npm run build` or `npm run build:vercel` |
| Output Directory | `dist` |
| Node.js | 20.x |

### 6.3 Required environment variables (Production)

```env
VITE_API_BASE_URL=https://<your-backend>.up.railway.app
VITE_WS_BASE_URL=wss://<your-backend>.up.railway.app
VITE_ENVIRONMENT=production
```

### 6.4 Critical constraint

**Vercel cannot proxy WebSockets.** The Vite dev proxy (`/ws` → backend) works only during `npm run dev`. Production **must** set `VITE_WS_BASE_URL` to the backend `wss://` origin.

### 6.5 SPA routing

`frontend/vercel.json` rewrites non-asset paths to `/index.html` for React Router (`/dashboard`, `/reports`, etc.).

### 6.6 Deploy

```bash
cd frontend
npm run build:vercel
# Or push to main with Vercel Git integration
```

Post-deploy: log in, open Dashboard, confirm charts move (WS connected).

---

## 7. Environment variables reference

### 7.1 Backend (`backend/.env`)

| Variable | Required (prod) | Description |
|----------|-----------------|-------------|
| `ENVIRONMENT` | Yes | `production` |
| `JWT_SECRET_KEY` | Yes | Signing secret; no default in prod |
| `FRONTEND_URL` | Yes | Primary origin for CORS |
| `API_HOST` | No | Default `0.0.0.0` |
| `API_PORT` / `PORT` | Auto on Railway | Listen port |
| `CHECKPOINT_DIR` | Recommended | Actor weights path |
| `TELEMETRY_PATH` | Recommended | CSV history |
| `INFERENCE_DEVICE` | No | `cpu`, `cuda`, `auto` |
| `REQUIRE_AUTH` | No | Default `true` |
| `CORS_ORIGINS` | Recommended | Comma-separated origins |
| `WS_STREAM_INTERVAL_SEC` | No | Broadcast period (default 2.5) |
| `DATABASE_URL` | No | Default SQLite path |

### 7.2 Frontend (`frontend/.env.*`)

| Variable | Required (prod) | Description |
|----------|-----------------|-------------|
| `VITE_API_BASE_URL` | Yes | REST base URL |
| `VITE_WS_BASE_URL` | Yes | WebSocket origin (`wss://`) |
| `VITE_ENVIRONMENT` | Yes | `production` |
| `VITE_LOG_LEVEL` | No | `warn` recommended |

Optional path overrides: `VITE_WS_TELEMETRY_PATH`, `VITE_WS_FORECAST_PATH`, `VITE_WS_AI_PATH`.

---

## 8. Checkpoints and data artifacts

| Artifact | Path | Purpose |
|----------|------|---------|
| Actor checkpoint | `checkpoints/quick_test/best/actor.pt` | `/predict` DDPG inference |
| Telemetry CSV | `data/grid_telemetry.csv` | Streams, forecasts, intelligence |
| Evaluation report | `evaluation/quick_test_run/evaluation_report.json` | `/metrics`, PDF exports |
| Episode metrics | `evaluation/quick_test_run/episode_metrics.csv` | RL summary tables |
| Auth database | `data/v2b_api.db` | Users/sessions (SQLite) |

**Preprocess if missing:**

```bash
python data/preprocess.py --mode telemetry
```

---

## 9. Health checks and smoke tests

### 9.1 Backend curls

```bash
# Liveness
curl -fsS https://<backend>/healthz

# Diagnostics
curl -fsS https://<backend>/health | jq .

# Auth-gated (replace TOKEN)
curl -fsS -H "Authorization: Bearer $TOKEN" https://<backend>/ai/inference
```

### 9.2 WebSocket smoke (wscat)

```bash
npx wscat -c wss://<backend>/ws/telemetry
```

Expect JSON messages every ~2.5s when stream manager is running.

### 9.3 Frontend smoke

1. Sign up / log in
2. Dashboard loads metrics without console WS errors
3. `/analytics` charts populate
4. `/reports` preview loads; CSV download works
5. Logout disconnects streams (no ghost updates)

---

## 10. WebSockets in production

| Channel | URL |
|---------|-----|
| Telemetry | `wss://<backend>/ws/telemetry` |
| Forecast | `wss://<backend>/ws/forecast` |
| AI ops | `wss://<backend>/ws/ai` |

**Uvicorn settings** (`backend/railway.py`):

- `proxy_headers=True`
- `forwarded_allow_ips="*"`
- `ws="websockets"`
- `ws_ping_interval=20`
- `ws_ping_timeout` from `WS_PING_TIMEOUT_SEC` (default 45)

**Single worker** is intentional for in-memory connection pools. Scaling WebSockets requires architectural changes (see [architecture.md](./architecture.md#15-scalability-design)).

---

## 11. Observability in production

### Endpoints

| Path | Use |
|------|-----|
| `GET /system/health` | Dashboard health panel |
| `GET /system/metrics` | CPU, memory, WS counts |
| `GET /system/performance` | API / inference / forecast latency percentiles |

### What to alert on

| Signal | Threshold idea |
|--------|----------------|
| `/healthz` non-200 | Page platform |
| `/health` status `error` | Investigate startup report |
| `model_loaded: false` sustained | Checkpoint mount failure |
| p95 inference latency | > 500ms on CPU at scale |
| `websocket_clients: 0` during business hours | Stream manager / connectivity |

---

## 12. Enterprise exports

Requires `fpdf2` (included in `requirements-production.txt`).

| Export | Endpoint |
|--------|----------|
| Telemetry CSV/PDF | `GET /reports/export/telemetry?format=csv` |
| AI decisions | `GET /reports/export/decisions?format=pdf` |
| Forecast | `GET /reports/export/forecast?format=csv` |
| Full enterprise | `GET /reports/export/enterprise?format=pdf` |

All require `Authorization: Bearer <JWT>`.

UI: **Reports** page (`/reports`) or `ExportPanel` component.

---

## 13. Production checklist

### Security

- [ ] `JWT_SECRET_KEY` is unique and ≥ 32 bytes entropy
- [ ] `ENVIRONMENT=production`
- [ ] `FRONTEND_URL` and `CORS_ORIGINS` match Vercel domain(s)
- [ ] `REQUIRE_AUTH=true`
- [ ] No default dev secrets in Railway/Vercel

### Backend

- [ ] `railway.json` healthcheck `/healthz` passing
- [ ] Torch CPU wheel installs in build logs
- [ ] Checkpoints mounted or fallback acceptable for demo
- [ ] `grid_telemetry.csv` present
- [ ] `GET /health` shows expected `degraded` vs `ok`

### Frontend

- [ ] `VITE_API_BASE_URL` → Railway HTTPS URL
- [ ] `VITE_WS_BASE_URL` → Railway **wss://** URL (not `ws://`, not Vercel domain)
- [ ] SPA rewrites work (deep link `/dashboard` refreshes correctly)
- [ ] Node 20.x on Vercel

### End-to-end

- [ ] Login → dashboard streams live data
- [ ] AI decisions show explainability text
- [ ] `/system/health` reachable from ops panel
- [ ] PDF export downloads from Report Center

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Charts frozen | `VITE_WS_BASE_URL` wrong or missing | Set `wss://<backend>` on Vercel, redeploy |
| CORS errors | `FRONTEND_URL` mismatch | Update backend env to exact Vercel URL |
| `503` on PDF export | `fpdf2` not installed | Rebuild with `requirements-production.txt` |
| Health `degraded` | No checkpoint | Mount `checkpoints/` or accept heuristic mode |
| Empty telemetry | Missing CSV | Add `data/grid_telemetry.csv` or preprocess |
| WS disconnect loop | Auth token expired | Re-login; check JWT expiry settings |
| Railway OOM on build | Torch install | Use CPU index URL from `railway.json` |
| 401 on all API calls | Clock skew / expired JWT | Sync time; increase `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` if needed |

---

## Related documents

| File | Focus |
|------|-------|
| [README.md](./README.md) | Project overview & quick start |
| [architecture.md](./architecture.md) | System design deep dive |
| [RAILWAY-PRODUCTION.md](./RAILWAY-PRODUCTION.md) | Railway-only details |
| [frontend/VERCEL-PRODUCTION.md](./frontend/VERCEL-PRODUCTION.md) | Vercel-only details |
| [backend-deployment.md](./backend-deployment.md) | Additional backend notes |

---

<p align="center"><sub>Deploy once · Monitor continuously · Explain every decision</sub></p>
