# V2B Neural Grid — Backend Deployment Guide

Production deployment reference for the **V2B Neural Grid** FastAPI backend: a DDPG-powered smart-grid API with real-time WebSocket telemetry, RL inference, forecasting, and observability.

**Stack:** FastAPI · Uvicorn · PyTorch (CPU) · WebSockets · SQLite · Railway / Docker

> **Railway quick start:** see [`RAILWAY-PRODUCTION.md`](RAILWAY-PRODUCTION.md) for the final step-by-step checklist, exact env vars, healthcheck, and verification commands.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Railway Deployment Steps](#railway-deployment-steps)
3. [Environment Variables](#environment-variables)
4. [WebSocket Deployment Notes](#websocket-deployment-notes)
5. [RL Checkpoint Handling](#rl-checkpoint-handling)
6. [Telemetry CSV Mounting](#telemetry-csv-mounting)
7. [Healthcheck Verification](#healthcheck-verification)
8. [Debugging Guide](#debugging-guide)
9. [Common Deployment Failures](#common-deployment-failures)
10. [Production Startup Commands](#production-startup-commands)
11. [Scaling Recommendations](#scaling-recommendations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Client (React dashboard / API consumers)                       │
└────────────┬───────────────────────────────┬────────────────────┘
             │ HTTPS REST                     │ WSS
             ▼                                ▼
┌──────────────────────────── Railway / Docker ─────────────────────┐
│  Uvicorn (0.0.0.0:$PORT)  —  backend.railway entrypoint         │
│  ├── FastAPI REST (/predict, /ai/*, /dataset, /system/*)       │
│  ├── WebSocket streams (/ws/telemetry, /ws/forecast, /ws/ai)   │
│  ├── Startup validation (checkpoints, CSV, forecasting, WS)    │
│  └── Graceful fallbacks (heuristic inference, empty telemetry)   │
└────────────┬───────────────────────────────┬────────────────────┘
             │                                │
             ▼                                ▼
   checkpoints/actor.pt              data/grid_telemetry.csv
   checkpoints/ddpg_actor.pth         data/processed_ev_data.csv
```

The backend is designed to **start successfully even when optional assets are missing**. Missing checkpoints or telemetry activate documented fallback modes rather than crashing the process.

---

## Railway Deployment Steps

### Prerequisites

| Requirement | Detail |
|-------------|--------|
| Python | 3.11+ (matches `backend/Dockerfile`) |
| Repository | Root must contain `railway.json`, `Procfile`, `requirements-production.txt` |
| RL assets | `checkpoints/quick_test/best/actor.pt` (inference) |
| Telemetry | `data/grid_telemetry.csv` (dashboard streams) |
| Secrets | Strong `JWT_SECRET_KEY` for production auth |

### Step 1 — Connect the repository

1. Log in to [Railway](https://railway.app).
2. **New Project → Deploy from GitHub repo** and select the V2B Neural Grid repository.
3. Set the **root directory** to the repository root (where `railway.json` lives).

### Step 2 — Configure the service

Railway reads `railway.json` automatically:

| Setting | Value |
|---------|-------|
| Builder | Nixpacks |
| Build command | Installs PyTorch CPU wheel + `requirements-production.txt` |
| Start command | `python -m backend.railway` |
| Healthcheck path | `/healthz` |
| Healthcheck timeout | 300 seconds (allows RL model load) |

Equivalent `Procfile`:

```
web: python -m backend.railway
```

### Step 3 — Set environment variables

In **Railway → Service → Variables**, configure the [required production variables](#required-in-production). Railway injects `PORT` and `RAILWAY_PUBLIC_DOMAIN` automatically — do not override `PORT` unless debugging.

### Step 4 — Include runtime assets

Railway’s filesystem is **ephemeral**. Choose one strategy:

| Strategy | Best for |
|----------|----------|
| **Commit assets to the repo** | Small checkpoints + CSV (< repo size limits) |
| **Railway Volume** mounted at `/app/checkpoints` and `/app/data` | Larger models, mutable data |
| **Build-time COPY** (Docker) | Reproducible container images |

See [RL Checkpoint Handling](#rl-checkpoint-handling) and [Telemetry CSV Mounting](#telemetry-csv-mounting) for paths and fallbacks.

### Step 5 — Deploy and verify

1. Trigger a deploy (push to connected branch or **Deploy** in dashboard).
2. Watch **Build Logs** for PyTorch + pip install success.
3. Watch **Deploy Logs** for startup diagnostics:
   ```
   Deployment diagnostics: { platform: railway, ws_base_url: wss://..., ... }
   Startup bootstrap complete status=ok
   ```
4. Confirm health:
   ```bash
   curl -fsS https://<your-service>.up.railway.app/healthz
   curl -fsS https://<your-service>.up.railway.app/health | jq .
   ```

### Step 6 — Connect the frontend

Set the frontend environment to point at the Railway backend:

```env
VITE_API_BASE_URL=https://<your-backend>.up.railway.app
VITE_WS_BASE_URL=wss://<your-backend>.up.railway.app
VITE_ENVIRONMENT=production
```

Set backend CORS:

```env
FRONTEND_URL=https://<your-frontend>.up.railway.app
```

---

## Environment Variables

Configuration is loaded by `backend/config.py` from **process environment** and optionally `backend/.env` (local dev only — never commit secrets).

### Injected by Railway (do not set manually)

| Variable | Purpose |
|----------|---------|
| `PORT` | Dynamic listen port → mapped to `api_port` |
| `RAILWAY_PUBLIC_DOMAIN` | Public hostname → auto `wss://` WebSocket base |
| `RAILWAY_ENVIRONMENT` | Platform detection → production defaults |

### Required in production

| Variable | Example | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `production` | Enables production logging and safe defaults |
| `JWT_SECRET_KEY` | `<64-char random>` | Signs auth tokens — **required** for stable sessions |
| `FRONTEND_URL` | `https://app.example.com` | CORS origin for the dashboard |

### Recommended in production

| Variable | Example | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | `DEBUG` for troubleshooting only |
| `WS_BASE_URL` | `wss://api.example.com` | Auto-set from `RAILWAY_PUBLIC_DOMAIN` if omitted |
| `CHECKPOINT_DIR` | `checkpoints/quick_test/best` | DDPG Actor directory (relative to project root) |
| `TELEMETRY_PATH` | `data/grid_telemetry.csv` | Primary telemetry CSV |
| `REQUIRE_AUTH` | `true` | Enforce JWT on protected routes |

### API / server

| Variable | Default | Description |
|----------|---------|-------------|
| `API_HOST` | `0.0.0.0` | Bind address (always `0.0.0.0` on PaaS) |
| `API_PORT` | `8001` | Overridden by Railway `PORT` when unset |
| `CORS_ORIGINS` | — | Comma-separated list; overrides `FRONTEND_URL` when set |

### RL inference

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECKPOINT_DIR` | `checkpoints/quick_test/best` | Directory containing `actor.pt` + `meta.pt` |
| `DEVICE` | `auto` | `cpu`, `cuda`, or `auto` (alias: `INFERENCE_DEVICE`) |
| `NUM_CHARGERS` | `8` | Action dimension (heterogeneous chargers) |
| `EPISODE_SLOTS` | `24` | Episode horizon for env bootstrap |
| `DATASET_PATH` | `data/processed_ev_data.csv` | Legacy dataset fallback |

### Telemetry & WebSocket

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEMETRY_PATH` | `data/grid_telemetry.csv` | Hourly smart-grid CSV |
| `TELEMETRY_ROW_LIMIT` | `1000` | Max rows served per request |
| `WS_TELEMETRY_PATH` | `/ws/telemetry` | Live telemetry stream |
| `WS_FORECAST_PATH` | `/ws/forecast` | Forecast stream |
| `WS_AI_PATH` | `/ws/ai` | AI ops / fleet / alerts stream |
| `WS_STREAM_INTERVAL_SEC` | `2.5` | Broadcast tick interval |
| `WS_ROWS_CACHE_TTL_SEC` | `30.0` | Telemetry row cache TTL |
| `WS_PING_TIMEOUT_SEC` | `45.0` | Client ping timeout |

### Auth & database

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_ALGORITHM` | `HS256` | Token signing algorithm |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Token lifetime |
| `DATABASE_URL` | `sqlite:///data/v2b_api.db` | SQLite path (relative to project root) |

### Local development template

Copy and edit for local runs:

```bash
cp backend/.env.example backend/.env
```

---

## WebSocket Deployment Notes

### Endpoints

| Channel | Path | Payload |
|---------|------|---------|
| Telemetry | `/ws/telemetry` | Historical rows + live ticks |
| Forecast | `/ws/forecast` | Rolling load / renewable / SOC forecasts |
| AI ops | `/ws/ai` | Inference, fleet, alerts, DDPG decisions |

Full production URLs (Railway auto-config):

```
wss://<RAILWAY_PUBLIC_DOMAIN>/ws/telemetry
wss://<RAILWAY_PUBLIC_DOMAIN>/ws/forecast
wss://<RAILWAY_PUBLIC_DOMAIN>/ws/ai
```

### Railway-specific configuration

The `backend/railway.py` entrypoint enables settings required behind Railway’s reverse proxy:

| Uvicorn setting | Value | Why |
|-----------------|-------|-----|
| `proxy_headers` | `True` | Trust `X-Forwarded-*` from edge |
| `forwarded_allow_ips` | `*` | Required for proxied WebSocket upgrades |
| `ws` | `websockets` | Native WebSocket protocol |
| `ws_ping_interval` | `20s` | Keep connections alive through idle proxies |
| `ws_ping_timeout` | `45s` | Matches `WS_PING_TIMEOUT_SEC` |
| `timeout_keep_alive` | `75s` | Long-lived dashboard connections |

### Client reconnect protocol

On connect, the server sends a `server_status` hello message:

```json
{
  "type": "server_status",
  "enabled": true,
  "running": true,
  "reconnect_safe": true,
  "ws_base_url": "wss://your-service.up.railway.app",
  "channel": "telemetry"
}
```

Clients should:

1. Connect directly to `wss://` (not `ws://`) in production.
2. Respond to server `ping` messages with `pong`.
3. Send `{ "type": "resync" }` after reconnect to receive a full telemetry snapshot.

### Custom domains

When using a custom domain, set explicitly:

```env
WS_BASE_URL=wss://api.yourdomain.com
FRONTEND_URL=https://app.yourdomain.com
```

---

## RL Checkpoint Handling

The backend validates two checkpoint locations at startup:

| Asset | Path | Used by |
|-------|------|---------|
| Inference Actor | `{CHECKPOINT_DIR}/actor.pt` | `POST /predict`, DDPG inference engine |
| Telemetry policy | `checkpoints/ddpg_actor.pth` | Grid intelligence, `/ws/ai` DDPG actions |

Supporting files in `CHECKPOINT_DIR`:

```
checkpoints/quick_test/best/
├── actor.pt      # Required — Actor weights
├── meta.pt       # Optional — architecture metadata
└── critic.pt     # Not required for inference
```

### Deployment options

**Option A — Bundle in repository (simplest)**

Ensure checkpoints are tracked (or Git LFS) and present at build time:

```
checkpoints/quick_test/best/actor.pt
checkpoints/ddpg_actor.pth
```

**Option B — Railway Volume**

1. Create a Volume in Railway and mount at `/app/checkpoints`.
2. Upload weights via one-off command or CI artifact step.
3. Set `CHECKPOINT_DIR=checkpoints/quick_test/best` (relative to `/app`).

**Option C — Docker bind mount (local / VPS)**

```bash
docker run -v ./checkpoints:/app/checkpoints -v ./data:/app/data v2b-backend
```

### Fallback behavior (missing checkpoint)

| Component | Fallback |
|-----------|----------|
| `POST /predict` | Heuristic neutral/shaving-biased actions (`policy_source: heuristic_fallback`) |
| `/ws/ai` | Rule-engine policy (`policy_source: rule_engine`) |
| `/health` | `status: degraded`, `inference_fallback: true` |

The API **remains online** — suitable for demos and staged rollouts while weights are being provisioned.

### Verify checkpoint load

```bash
curl -s https://<host>/health | jq '.model_loaded, .inference_fallback, .startup.components.rl_checkpoint'
```

Expected (healthy):

```json
true
false
{ "state": "ok", "message": "Inference and telemetry actor checkpoints found" }
```

---

## Telemetry CSV Mounting

### Primary file

| Variable | Default path | Generated by |
|----------|--------------|--------------|
| `TELEMETRY_PATH` | `data/grid_telemetry.csv` | `python data/preprocess.py --mode telemetry` |

Legacy fallback: `data/processed_ev_data.csv` (via `DATASET_PATH`).

### Deployment options

**Option A — Commit to repository**

Include `data/grid_telemetry.csv` in the repo for immutable, reproducible deploys.

**Option B — Railway Volume**

Mount a volume at `/app/data` and place `grid_telemetry.csv` inside it.

**Option C — Docker / Compose**

```yaml
volumes:
  - ./data:/app/data
```

### APIs affected by missing telemetry

| Endpoint | Behavior without CSV |
|----------|------------------------|
| `GET /dataset` | HTTP 503 |
| `GET /ai/forecast` | Zero-baseline fallback (`fallback: true`) |
| `GET /ai/inference` | Rule-engine fallback response |
| WebSocket streams | Empty payloads (`event: empty`) |
| `POST /predict` | Unaffected (state vector in request body) |

### Verify telemetry

```bash
curl -s https://<host>/health | jq '.startup.components.telemetry_csv'
curl -s https://<host>/dataset | jq 'length'
```

---

## Healthcheck Verification

### Endpoints

| Path | Purpose | Railway uses |
|------|---------|--------------|
| `GET /healthz` | **Liveness** — returns `{"status":"alive"}` | Yes (`healthcheckPath`) |
| `GET /health` | **Full diagnostics** — model, startup components, fallbacks | Manual / monitoring |
| `GET /system/health` | **Observability KPIs** — CPU, RAM, WS clients, latency | Dashboards |

### Liveness probe

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" https://<host>/healthz
# Expected: 200
```

Always returns **HTTP 200** once Uvicorn is accepting traffic, even when RL or telemetry are degraded.

### Readiness / diagnostics

```bash
curl -s https://<host>/health | jq '{
  status,
  model_loaded,
  inference_fallback,
  startup_status: .startup.status,
  components: .startup.components | keys
}'
```

Startup component keys:

- `rl_checkpoint`
- `telemetry_csv`
- `inference`
- `forecasting`
- `websocket_manager`

### Docker healthcheck

The `backend/Dockerfile` uses:

```dockerfile
HEALTHCHECK CMD curl -fsS http://127.0.0.1:8001/health || exit 1
```

For dynamic `$PORT` deployments, prefer `/healthz` on `$PORT` or rely on Railway’s platform healthcheck.

---

## Debugging Guide

### 1. Inspect Railway deploy logs

Look for these log lines in order:

```
Settings loaded environment=production ...
Deployment diagnostics: { platform: railway, ... }
Starting V2B backend bootstrap ...
Startup check OK: telemetry_csv ...
Startup check OK: rl_checkpoint ...
V2B inference model ready          # or fallback warning
Startup bootstrap complete status=...
Railway uvicorn start host=0.0.0.0 port=...
```

### 2. Query health API

```bash
export API=https://your-service.up.railway.app

curl -s $API/health | jq .
curl -s $API/system/metrics | jq .
```

### 3. Test REST inference

```bash
# Obtain token first (if REQUIRE_AUTH=true)
curl -s -X POST $API/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}' | jq -r .access_token

# Predict (23-dim normalized state vector)
curl -s -X POST $API/predict \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": [0.5, 0.5, ...]}' | jq '.fallback, .policy_source'
```

### 4. Test WebSocket (websocat / wscat)

```bash
npx wscat -c wss://your-service.up.railway.app/ws/telemetry
# Expect: server_status hello + telemetry snapshot JSON
```

### 5. Enable debug logging temporarily

In Railway Variables:

```env
LOG_LEVEL=DEBUG
```

Redeploy, reproduce the issue, then revert to `INFO`.

### 6. Local reproduction with production settings

```bash
export ENVIRONMENT=production
export PORT=8001
export JWT_SECRET_KEY=local-test-secret
export RAILWAY_PUBLIC_DOMAIN=localhost  # simulates Railway WS URL

pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-production.txt
python -m backend.railway
```

---

## Common Deployment Failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Build fails on `torch` | PyTorch not installed from CPU index | Use build command from `railway.json` |
| Healthcheck timeout (300s) | Slow pip install or model load | Increase timeout; verify checkpoint path; check build cache |
| `502 Bad Gateway` after deploy | App crashed on startup | Check deploy logs for import errors / missing `agents/` or `rl_env/` |
| WebSocket connects then drops | Client using `ws://` instead of `wss://` | Set `WS_BASE_URL=wss://...` |
| CORS errors in browser | `FRONTEND_URL` mismatch | Set exact frontend origin (no trailing slash) |
| `503` on `/predict` with auth error | Missing/invalid JWT | Login first; set `JWT_SECRET_KEY` consistently across redeploys |
| `model_loaded: false` | `actor.pt` missing at `CHECKPOINT_DIR` | Mount volume or commit checkpoint; check path in `/health` |
| Empty dashboard charts | `grid_telemetry.csv` missing | Mount `/app/data` or run preprocess script |
| Auth breaks after redeploy | Ephemeral `JWT_SECRET_KEY` | Set a persistent secret in Railway Variables |
| SQLite data lost on redeploy | Ephemeral filesystem | Use Railway Volume for `/app/data` or external DB |
| High memory / OOM | PyTorch + pandas + broadcast loop | Scale to larger Railway plan; reduce `TELEMETRY_ROW_LIMIT` |
| `Inference fallback active` in logs | Checkpoint missing or corrupt | Re-upload `actor.pt`; verify with `/health` component details |

---

## Production Startup Commands

### Railway (recommended)

Configured automatically via `railway.json`:

```bash
python -m backend.railway
```

### Procfile (Heroku-compatible)

```
web: python -m backend.railway
```

### Manual uvicorn (VPS / bare metal)

```bash
pip install --upgrade pip
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-production.txt

export ENVIRONMENT=production
export API_HOST=0.0.0.0
export PORT=8001
export JWT_SECRET_KEY=<secret>
export FRONTEND_URL=https://app.example.com

python -m backend.railway
```

### Docker

```bash
docker build -f backend/Dockerfile -t v2b-backend .
docker run -p 8001:8001 \
  -e ENVIRONMENT=production \
  -e JWT_SECRET_KEY=<secret> \
  -e FRONTEND_URL=https://app.example.com \
  -v $(pwd)/checkpoints:/app/checkpoints \
  -v $(pwd)/data:/app/data \
  v2b-backend
```

### Local development (hot reload)

```bash
cp backend/.env.example backend/.env
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
```

---

## Scaling Recommendations

### Single-instance (default)

The backend runs **one Uvicorn worker** (`workers=1` in `backend/railway.py`) because:

- In-memory WebSocket connection pools are not shared across workers
- SQLite does not support concurrent multi-writer access
- RL model weights are loaded once per process (~100–500 MB RAM)

**Recommended for:** demos, MVPs, moderate dashboard traffic, Railway Hobby/Pro single replica.

### Vertical scaling

| Workload | Recommendation |
|----------|----------------|
| RL inference latency | Upgrade CPU/RAM; set `INFERENCE_DEVICE=cpu` explicitly |
| WebSocket fan-out | Increase `WS_STREAM_INTERVAL_SEC` (e.g. `3.0–5.0`) to reduce broadcast load |
| Large telemetry CSV | Lower `TELEMETRY_ROW_LIMIT`; use volume for `data/` |
| Memory pressure | Pin `torch==2.5.1` CPU wheel (smaller than full CUDA builds) |

### Horizontal scaling (advanced)

Requires architectural changes not included in the default deployment:

| Concern | Solution |
|---------|----------|
| WebSocket state | Sticky sessions at load balancer **or** Redis pub/sub broadcast |
| SQLite | Migrate to PostgreSQL (`DATABASE_URL=postgresql://...`) |
| Checkpoints | Shared object storage (S3/R2) or read-only volume replicated at boot |
| Session affinity | Route all WS clients for a tenant to the same instance |

### Observability at scale

Use built-in endpoints for monitoring integration:

| Endpoint | Metrics |
|----------|---------|
| `GET /system/health` | CPU, RAM, uptime, WS client count |
| `GET /system/metrics` | Disk, GPU (if present), stream throughput |
| `GET /system/performance` | API p50/p95/p99 latency, inference latency |

Point uptime monitors at `/healthz` (liveness) and alert on `/health` `status: error` (diagnostics).

### Production checklist

- [ ] `ENVIRONMENT=production`
- [ ] Strong `JWT_SECRET_KEY` set in platform secrets
- [ ] `FRONTEND_URL` matches deployed dashboard origin
- [ ] Checkpoints present or fallback behavior understood
- [ ] Telemetry CSV present or fallback behavior understood
- [ ] `/healthz` returns 200 after deploy
- [ ] `/health` shows expected component states
- [ ] WebSocket test on all three channels (`/ws/telemetry`, `/ws/forecast`, `/ws/ai`)
- [ ] `POST /predict` returns `policy_source: ddpg` (not fallback)
- [ ] Persistent volume for `data/` if auth users must survive redeploys

---

## Quick Reference

| Item | Location |
|------|----------|
| Config module | `backend/config.py` |
| Railway entrypoint | `backend/railway.py` |
| Startup validation | `backend/startup.py` |
| Production deps | `requirements-production.txt` |
| Env template | `backend/.env.example` |
| Docker image | `backend/Dockerfile` |
| Platform config | `railway.json`, `Procfile` |

---

*V2B Neural Grid — Backend Deployment Guide · FastAPI + DDPG RL + Real-time WebSockets*
