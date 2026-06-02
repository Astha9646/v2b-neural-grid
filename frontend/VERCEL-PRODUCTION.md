# V2B Neural Grid — FINAL Vercel Production Deployment

Vite + React SPA on [Vercel](https://vercel.com), backed by a hosted FastAPI API (e.g. Railway) with **direct `wss://` WebSocket** connections.

---

## 1. Verified deployment artifacts

| File | Status | Purpose |
|------|--------|---------|
| [`vercel.json`](vercel.json) | OK | SPA rewrites, asset caching, default `VITE_ENVIRONMENT` / `VITE_LOG_LEVEL` |
| [`vite.config.js`](vite.config.js) | OK | Production chunks (`vendor`, `charts`, `http`), dev-only `/api` + `/ws` proxy |
| [`src/config/env.js`](src/config/env.js) | OK | `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`, validation, WS path builders |
| [`.env.production.example`](.env.production.example) | OK | Production env template for Vercel dashboard |
| [`package.json`](package.json) | OK | `build`, `build:vercel` scripts |

### Critical Vercel constraint

**Vercel static hosting cannot proxy WebSockets.** The Vite dev proxy (`/ws` → backend) works only in `npm run dev`. In production you **must** set:

```env
VITE_WS_BASE_URL=wss://<your-backend-host>
```

### Resolved URLs at runtime

| Concern | Source | Example |
|---------|--------|---------|
| REST API | `VITE_API_BASE_URL` | `https://v2b-api.up.railway.app` |
| WebSocket base | `VITE_WS_BASE_URL` | `wss://v2b-api.up.railway.app` |
| Telemetry WS | `{wsBase}/ws/telemetry` | `wss://…/ws/telemetry` |
| Forecast WS | `{wsBase}/ws/forecast` | `wss://…/ws/forecast` |
| AI ops WS | `{wsBase}/ws/ai` | `wss://…/ws/ai` |

Paths default from `env.js` (`WS_PATHS`); override with `VITE_WS_*_PATH` only if the backend paths change.

### SPA routing

`vercel.json` rewrites all non-file routes to `/index.html` — required for React Router (`/dashboard`, `/fleet`, `/ai-decisions`, etc.).

---

## 2. Exact Vercel deployment steps

### Step 1 — Import project

1. [Vercel Dashboard](https://vercel.com/dashboard) → **Add New… → Project**.
2. Import your Git repository.
3. If the repo is a **monorepo**, set **Root Directory** to `frontend` (folder containing `vercel.json` and `package.json`).

### Step 2 — Framework & build settings

| Setting | Value |
|---------|-------|
| **Framework Preset** | Vite |
| **Root Directory** | `frontend` (monorepo) or `.` (frontend-only repo) |
| **Install Command** | `npm ci` |
| **Build Command** | `npm run build` or `npm run build:vercel` |
| **Output Directory** | `dist` |
| **Node.js Version** | 20.x (see `.nvmrc`) |

`vercel.json` already sets `installCommand`, `buildCommand`, and `outputDirectory` when detected from `frontend/`.

### Step 3 — Environment variables

**Project → Settings → Environment Variables → Production** (and Preview if desired):

#### Required

```env
VITE_API_BASE_URL=https://<your-backend>.up.railway.app
VITE_WS_BASE_URL=wss://<your-backend>.up.railway.app
VITE_ENVIRONMENT=production
```

#### Recommended

```env
VITE_VERCEL=1
VITE_LOG_LEVEL=warn
```

#### Optional (defaults match backend)

```env
VITE_WS_TELEMETRY_PATH=/ws/telemetry
VITE_WS_FORECAST_PATH=/ws/forecast
VITE_WS_AI_PATH=/ws/ai
```

**Rules:**

- No trailing slash on base URLs.
- Use `https://` for API and `wss://` for WebSocket (same host as backend).
- `VITE_*` variables are **inlined at build time** — redeploy after changing them.

### Step 4 — Backend CORS (Railway / API host)

On the FastAPI backend, set:

```env
FRONTEND_URL=https://<your-vercel-app>.vercel.app
```

Or comma-separated origins:

```env
CORS_ORIGINS=https://<your-vercel-app>.vercel.app,https://<custom-domain>
```

Must match the browser origin **exactly** (scheme + host, no trailing slash).

### Step 5 — Deploy

1. **Deploy** (push to production branch or manual deploy).
2. Open **Build Logs** — confirm `vite build` completes and chunks emit (`vendor`, `charts`, etc.).
3. Open the deployment URL.

### Step 6 — Post-deploy verification

```text
# Browser DevTools → Console (should NOT show Env configuration issues)
# Network tab:
#   - REST: https://<backend>/health, /dataset, /ai/forecast
#   - WS:   wss://<backend>/ws/telemetry (101 Switching Protocols)
```

| Feature | What to verify |
|---------|----------------|
| **SPA routing** | Refresh `/dashboard`, `/fleet`, `/settings` — no 404 |
| **Telemetry** | Dashboard charts populate; WS `telemetry` channel connected |
| **Forecasting** | Forecast chart + `/ai/forecast` REST |
| **AI dashboard** | Decision / optimization panels; WS `ai` channel |
| **Digital twin** | Twin canvas animates when WS live |
| **Auth** | Login works (`POST <API>/login`); protected routes load |

---

## 3. Exact project settings (Vercel UI)

| Section | Setting | Value |
|---------|---------|-------|
| General | Root Directory | `frontend` |
| Build & Development | Framework | Vite |
| Build & Development | Build Command | `npm run build` |
| Build & Development | Output Directory | `dist` |
| Build & Development | Install Command | `npm ci` |
| Build & Development | Node.js Version | 20.x |
| Environment Variables | Production | See § Step 3 |
| Domains | Production domain | Optional custom domain |
| Git | Production Branch | `main` (or your default) |

---

## 4. Feature ↔ configuration matrix

| Feature | REST | WebSocket | Env dependency |
|---------|------|-----------|----------------|
| Telemetry charts | `GET /dataset` | `/ws/telemetry` | `VITE_API_BASE_URL`, `VITE_WS_BASE_URL` |
| Forecast panels | `GET /ai/forecast` | `/ws/forecast` | Same |
| AI / decisions | `GET /ai/inference`, `/ai/fleet` | `/ws/ai` | Same + JWT if `REQUIRE_AUTH` |
| Digital twin | Telemetry + AI streams | `/ws/telemetry`, `/ws/ai` | Same |
| Auth | `POST /login`, `/signup` | — | API base + backend CORS |
| System metrics | `GET /system/*` | — | API base |

---

## 5. Production caching (Vercel)

Configured in [`vercel.json`](vercel.json):

| Asset | Cache-Control | Rationale |
|-------|---------------|-----------|
| `/assets/*` (hashed JS/CSS) | `max-age=31536000, immutable` | Long cache — filenames change each build |
| Static images/fonts | `max-age=604800, stale-while-revalidate=86400` | Week cache + soft revalidate |
| `/index.html` | `max-age=0, must-revalidate` | Always fetch fresh shell after deploy |

**Recommendations:**

- Do not cache `index.html` aggressively — users must get new chunk hashes after deploy.
- Purge CDN cache on rollback: Vercel → Deployments → … → Redeploy.
- Enable **Vercel Analytics** (optional) for Web Vitals; keep `VITE_LOG_LEVEL=warn` in production.

---

## 6. Frontend performance recommendations

Already implemented in the codebase:

- Route-level **lazy loading** (`React.lazy` + `Suspense`)
- **Code splitting** — `vendor`, `charts`, `http` chunks in `vite.config.js`
- **Telemetry context split** — reduces WS-driven rerenders
- **Recharts** — animation disabled in production (`RECHARTS_PERF`)
- **WS batching** — 750ms coalesce in production (`streamConstants.js`)

**Vercel / ops:**

| Tactic | Action |
|--------|--------|
| Edge delivery | Use Vercel default CDN; no extra config required |
| Bundle size | Monitor build log chunk sizes; `charts` ~370KB gzip — expected |
| Preview envs | Use separate `VITE_*` vars for Preview vs Production |
| Source maps | Disabled in `vite.config.js` (`sourcemap: false`) — enable only for debug builds |

---

## 7. WebSocket deployment recommendations

| Rule | Detail |
|------|--------|
| **Always `wss://`** | Mixed content blocked on `https://` Vercel pages |
| **Same backend host** | API and WS should share the Railway (or API) hostname |
| **No Vercel proxy** | Do not point WS at `wss://your-app.vercel.app` — it will fail |
| **Backend proxy headers** | Railway entrypoint uses `proxy_headers=True` for upgrades |
| **Reconnect** | Client sends `{ "type": "resync" }` after reconnect (built into `socketService.js`) |
| **Heartbeat** | Client ping every 25s; backend ping timeout 45s |

**Test from browser console:**

```javascript
const ws = new WebSocket('wss://<backend>/ws/telemetry');
ws.onopen = () => console.log('open');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## 8. Final frontend deployment checklist

### Vercel project

- [ ] Root Directory = `frontend` (monorepo)
- [ ] Framework = Vite, Output = `dist`
- [ ] Node 20.x
- [ ] Build succeeds with no env validation warnings in logs

### Environment variables (Production)

- [ ] `VITE_API_BASE_URL=https://<backend>` (no trailing slash)
- [ ] `VITE_WS_BASE_URL=wss://<backend>` (no trailing slash)
- [ ] `VITE_ENVIRONMENT=production`
- [ ] `VITE_LOG_LEVEL=warn`
- [ ] `VITE_VERCEL=1` (recommended)

### Backend pairing

- [ ] `FRONTEND_URL` or `CORS_ORIGINS` includes Vercel URL
- [ ] Backend `/healthz` and `/health` OK
- [ ] Backend checkpoints + telemetry CSV provisioned (or fallbacks understood)

### Functional smoke test

- [ ] `/login` → `/dashboard` navigation works
- [ ] Hard refresh on `/dashboard`, `/fleet`, `/ai-decisions` (no 404)
- [ ] Browser Network: `wss://…/ws/telemetry` status 101
- [ ] `wss://…/ws/forecast` and `wss://…/ws/ai` connect
- [ ] Charts show live data (or documented empty/fallback state)
- [ ] Forecast + AI panels load
- [ ] Digital twin canvas runs when stream active
- [ ] No console `[Env] Configuration issues` warnings

### Post-launch

- [ ] Custom domain added (optional) + DNS configured
- [ ] Update `FRONTEND_URL` on backend if domain changes
- [ ] Redeploy frontend after any `VITE_*` change

---

## Quick reference

| Item | Location |
|------|----------|
| Vercel config | `frontend/vercel.json` |
| Vite build | `frontend/vite.config.js` |
| Env contract | `frontend/src/config/env.js` |
| WS client | `frontend/src/services/socketService.js` |
| REST client | `frontend/src/services/api.js` |
| Env template | `frontend/.env.production.example` |
| Backend deploy | `RAILWAY-PRODUCTION.md` (repo root) |
