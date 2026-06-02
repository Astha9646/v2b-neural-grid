# =============================================================================
# V2B Neural Grid — FastAPI backend (Python 3.11, CPU inference)
# Build:  docker build -f backend/Dockerfile -t v2b-backend .
# =============================================================================
FROM python:3.11-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app

WORKDIR /app

# curl → healthcheck; libgomp → torch CPU ops
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Layer cache: dependencies before application code
COPY requirements-production.txt requirements-observability.txt ./
RUN pip install --upgrade pip \
    && pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r requirements-production.txt \
    && pip install -r requirements-observability.txt

# Application packages (inference + RL stack)
COPY backend/ ./backend/
COPY agents/ ./agents/
COPY rl_env/ ./rl_env/
COPY evaluate.py train.py ./

# Runtime dirs (bind-mount checkpoints/ + data/ in compose)
RUN mkdir -p /app/checkpoints /app/data /app/evaluation /app/logs

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8001}/healthz" || exit 1'

CMD ["python", "-m", "backend.railway"]
