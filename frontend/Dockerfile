# =============================================================================
# V2B Neural Grid — React/Vite frontend (multi-stage → nginx)
# Build:  docker build -f frontend/Dockerfile -t v2b-frontend .
# =============================================================================

# --- Stage 1: Vite production build ------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts

COPY frontend/ ./

# Same-origin API + WebSocket via nginx reverse proxy
ARG VITE_APP_ENV=production
ARG VITE_API_URL=/api
ARG VITE_WS_BASE_URL=
ENV VITE_APP_ENV=${VITE_APP_ENV} \
    VITE_API_URL=${VITE_API_URL} \
    VITE_WS_BASE_URL=${VITE_WS_BASE_URL}

RUN npm run build

# --- Stage 2: nginx static server ------------------------------------------
FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf

COPY frontend/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
