# V2B Neural Grid — FINAL Railway Production Deployment

FastAPI backend on [Railway](https://railway.app) with CPU PyTorch inference, WebSockets, telemetry, forecasting, and AI ops streams.

---

## 1. Verified deployment artifacts

| File | Status | Purpose |
|------|--------|---------|
| [`railway.json`](railway.json) | OK | Nixpacks build, start command, `/healthz` probe (300s timeout) |
| [`Procfile`](Procfile) | OK | `web: python -m backend.railway` |
| [`requirements-production.txt`](requirements-production.txt) | OK | Pinned FastAPI, uvicorn, websockets, torch stack deps |
| [`nixpacks.toml`](nixpacks.toml) | OK | Python 3.11 runtime pin |
| [`backend/railway.py`](backend/railway.py) | OK | Uvicorn: `proxy_headers`, `wss` WebSocket, single worker |
| [`backend/railway_config.py`](backend/railway_config.py) | OK | `PORT`, `RAILWAY_PUBLIC_DOMAIN` → `wss://` |
| [`backend/startup.py`](backend/startup.py) | OK | RL / CSV / forecast / WS bootstrap with fallbacks |

### Health endpoints

| Path | Role | Railway |
|------|------|---------|
| `GET /healthz` | **Liveness** — always HTTP 200 when process is up | **Platform healthcheck** (`healthcheckPath`) |
| `GET /health` | **Diagnostics** — model load, startup components, fallbacks | Manual / monitoring |
| `GET /system/health` | Observability KPIs (CPU, RAM, WS clients) | Dashboards |

### WebSocket paths (production: `wss://`)

| Channel | Path |
|---------|------|
| Telemetry | `/ws/telemetry` |
| Forecast | `/ws/forecast` |
| AI ops | `/ws/ai` |

Uvicorn settings in `backend/railway.py`: `proxy_headers=True`, `forwarded_allow_ips="*"`, `ws="websockets"`, `ws_ping_interval=20`, `ws_ping_timeout` from `WS_PING_TIMEOUT_SEC` (45s).

---

## 2. Exact Railway deployment steps

### Step 1 — Create the service

1. Railway → **New Project** → **Deploy from GitHub repo**.
2. Select the V2B repository.
3. **Root directory**: repository root (must contain `railway.json`).

### Step 2 — Build & start (automatic from `railway.json`)

**Build command:**

```bash
pip install --upgrade pip && pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu && pip install -r requirements-production.txt
```

**Start command:**

```bash
python -m backend.railway
```

Do **not** override `PORT` — Railway injects it. The app binds `0.0.0.0:$PORT`.

### Step 3 — Environment variables

Set in **Railway → Service → Variables**:

#### Required (you set)

```env
ENVIRONMENT=production
JWT_SECRET_KEY=<openssl rand -hex 32>
FRONTEND_URL=https://<your-vercel-or-frontend-domain>
```

Generate secret (local shell):

```bash
openssl rand -hex 32
```

#### Recommended

```env
LOG_LEVEL=INFO
DEVICE=cpu
REQUIRE_AUTH=true
CHECKPOINT_DIR=checkpoints/quick_test/best
TELEMETRY_PATH=data/grid_telemetry.csv
TELEMETRY_ROW_LIMIT=500
WS_STREAM_INTERVAL_SEC=3.0
```

#### Optional overrides

```env
CORS_ORIGINS=https://app.example.com,https://www.app.example.com
WS_BASE_URL=wss://<custom-api-domain>
DATABASE_URL=sqlite:///data/v2b_api.db
```

#### Injected by Railway (do not set)

| Variable | Use |
|----------|-----|
| `PORT` | Listen port → `api_port` |
| `RAILWAY_PUBLIC_DOMAIN` | Public hostname → `https://` API + auto `wss://` |
| `RAILWAY_ENVIRONMENT` | Platform detection |

If `WS_BASE_URL` is omitted, the backend sets `wss://{RAILWAY_PUBLIC_DOMAIN}` automatically.

### Step 4 — Ship runtime assets

Railway disk is **ephemeral**. Provision before first production traffic:

| Asset | Path | Required for |
|-------|------|----------------|
| Inference actor | `checkpoints/quick_test/best/actor.pt` | `POST /predict`, DDPG inference |
| Telemetry policy | `checkpoints/ddpg_actor.pth` | `/ws/ai` DDPG actions |
| Telemetry CSV | `data/grid_telemetry.csv` | `/dataset`, WS telemetry, forecasts |

**Options:**

1. **Commit** small files to the repo (simplest for demos).
2. **Railway Volume** mounted at `/app/checkpoints` and `/app/data` (recommended for production).
3. **One-off upload** after deploy via Railway shell / CI artifact.

Without checkpoints the API **still starts** (heuristic inference + rule-engine WS). Without CSV, streams return empty/fallback payloads.

Also ensure these packages are in the deploy tree (repo root):

- `backend/`, `agents/`, `rl_env/`, `data/`

### Step 5 — Healthcheck configuration (Railway UI)

| Setting | Value |
|---------|-------|
| Healthcheck path | `/healthz` |
| Healthcheck timeout | `300` seconds |
| Restart policy | On failure (max 10 retries) |

Matches [`railway.json`](railway.json):

```json
"healthcheckPath": "/healthz",
"healthcheckTimeout": 300,
"startCommand": "python -m backend.railway"
```

### Step 6 — Generate public domain

1. Service → **Settings** → **Networking** → **Generate Domain**.
2. Note URL: `https://<service>.up.railway.app`.

### Step 7 — Connect frontend (Vercel)

```env
VITE_API_BASE_URL=https://<service>.up.railway.app
VITE_WS_BASE_URL=wss://<service>.up.railway.app
VITE_ENVIRONMENT=production
```

Vercel cannot proxy WebSockets — `VITE_WS_BASE_URL` must be the Railway `wss://` URL.

### Step 8 — Post-deploy verification

```bash
export API=https://<service>.up.railway.app

# Liveness (Railway probe)
curl -fsS "$API/healthz"

# Full diagnostics
curl -sS "$API/health" | jq '{status, model_loaded, inference_fallback, startup: .startup.status, components: .startup.components}'

# Telemetry REST
curl -sS "$API/dataset" | jq 'length'

# Forecast REST
curl -sS "$API/ai/forecast" | jq '.fallback, .chartSeries | length'

# WebSocket (requires wscat)
npx wscat -c "wss://<service>.up.railway.app/ws/telemetry"
```

**Auth-gated routes** (`POST /predict`): obtain JWT via `POST /auth/login` first when `REQUIRE_AUTH=true`.

---

## 3. Feature readiness on Railway

| Feature | Endpoint / stream | Production check |
|---------|-------------------|------------------|
| RL checkpoints | `startup.components.rl_checkpoint`, `inference` | `/health` → `model_loaded: true`, `inference_fallback: false` |
| WebSockets | `wss://…/ws/{telemetry,forecast,ai}` | `startup.components.websocket_manager.state` = `ok`; wscat receives `server_status` |
| Forecasting | `GET /ai/forecast`, `/ws/forecast` | `startup.components.forecasting.state` = `ok` |
| Telemetry | `GET /dataset`, `/ws/telemetry` | `startup.components.telemetry_csv.state` = `ok` |
| AI inference | `GET /ai/inference`, `/ws/ai` | `policy_source` not only `heuristic_fallback` when checkpoint present |

---

## 4. Production logging

| Setting | Value | Notes |
|---------|-------|-------|
| `LOG_LEVEL` | `INFO` | Use `DEBUG` only while troubleshooting |
| `ENVIRONMENT` | `production` | Disables uvicorn access log spam |
| Platform | Railway **Deploy Logs** | Filter: `Deployment diagnostics`, `Startup bootstrap complete` |

**Expected log sequence:**

```
Settings loaded environment=production ...
Deployment diagnostics: { platform: railway, ws_base_url: wss://..., healthcheck: /healthz, ... }
Starting V2B backend bootstrap ...
Startup check OK: telemetry_csv ...
Startup check OK: rl_checkpoint ...
V2B inference model ready
Startup bootstrap complete status=ok
Railway uvicorn start host=0.0.0.0 port=...
Railway WebSocket endpoints: { telemetry: wss://.../ws/telemetry, ... }
```

**Recommendations:**

- Ship logs to Railway log drains or external APM (Datadog, Better Stack).
- Alert on `/health` `status: error`, not on `/healthz` (liveness stays 200 when degraded).
- Never log `JWT_SECRET_KEY` or request bodies containing tokens.

---

## 5. Memory optimization

| Tactic | Action |
|--------|--------|
| CPU-only PyTorch | Build installs `torch==2.5.1` CPU wheel (see `railway.json`) |
| Single worker | `workers=1` in `backend/railway.py` — do not increase without Redis WS + Postgres |
| Inference device | `DEVICE=cpu` |
| Telemetry cap | `TELEMETRY_ROW_LIMIT=500` (or lower) |
| WS broadcast load | `WS_STREAM_INTERVAL_SEC=3.0`–`5.0` |
| Row cache | `WS_ROWS_CACHE_TTL_SEC=30` (default) |

**Railway plan guidance:** allocate **≥ 1 GB RAM** (2 GB safer with pandas + torch + concurrent WS clients). OOM → upgrade plan or reduce limits above.

---

## 6. Railway scaling recommendations

| Mode | When | Config |
|------|------|--------|
| **Single replica** (default) | MVP, dashboard demos, &lt; ~50 concurrent WS | 1 instance, vertical RAM/CPU |
| **Vertical scale** | High inference latency or OOM | Larger Railway plan, `DEVICE=cpu` |
| **Horizontal** (advanced) | High availability | Requires sticky WS sessions **or** Redis pub/sub; migrate SQLite → PostgreSQL |

**Do not** run multiple replicas with the default stack:

- In-memory WebSocket pools are not shared.
- SQLite is single-writer.

**Monitoring endpoints:**

- Liveness: `GET /healthz`
- Diagnostics: `GET /health`
- Runtime: `GET /system/metrics`, `GET /system/performance`

---

## 7. Final deployment checklist

### Repository & build

- [ ] `railway.json`, `Procfile`, `requirements-production.txt` at repo root
- [ ] `backend/`, `agents/`, `rl_env/` included in deploy
- [ ] Build logs show torch CPU + pip install success

### Secrets & CORS

- [ ] `ENVIRONMENT=production`
- [ ] `JWT_SECRET_KEY` set (persistent across redeploys)
- [ ] `FRONTEND_URL` matches exact frontend origin (no trailing slash)

### Runtime assets

- [ ] `checkpoints/quick_test/best/actor.pt` present (or fallback accepted)
- [ ] `checkpoints/ddpg_actor.pth` present (or partial degraded mode accepted)
- [ ] `data/grid_telemetry.csv` present (or empty-stream fallback accepted)
- [ ] Volume mounted for `data/` if SQLite users must survive redeploys

### Platform

- [ ] Public domain generated
- [ ] Healthcheck: `/healthz`, timeout **300s**
- [ ] Start command: `python -m backend.railway`

### Verification

- [ ] `curl -fsS https://<host>/healthz` → 200
- [ ] `curl -s https://<host>/health` → `model_loaded` / components as expected
- [ ] `wss://<host>/ws/telemetry` connects and receives JSON
- [ ] `wss://<host>/ws/forecast` connects
- [ ] `wss://<host>/ws/ai` connects
- [ ] `GET /dataset` returns rows
- [ ] `GET /ai/forecast` returns chart series
- [ ] `POST /predict` (with JWT) returns `policy_source: ddpg` when checkpoint loaded

### Frontend

- [ ] `VITE_API_BASE_URL=https://<railway-host>`
- [ ] `VITE_WS_BASE_URL=wss://<railway-host>`

---

## Quick reference

| Item | Location |
|------|----------|
| Platform config | `railway.json`, `Procfile`, `nixpacks.toml` |
| Entrypoint | `backend/railway.py` |
| Env / settings | `backend/config.py`, `backend/.env.example` |
| Startup validation | `backend/startup.py` |
| Extended guide | `backend-deployment.md` |
| Docker (optional) | `backend/Dockerfile` |
