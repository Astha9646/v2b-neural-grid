"""
WebSocket connection manager and async broadcast loop for V2B Neural Grid.

Channels:
  - telemetry — full/historical rows + live tick
  - forecast  — rolling forecast bundle
  - ai        — inference, fleet, alerts, activities, realtime events
"""

from __future__ import annotations

import asyncio
import json
import logging
from enum import Enum
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from backend.config import settings
from backend.stream_payloads import (
    build_ai_payload,
    build_forecast_payload,
    build_telemetry_payload,
)
from backend.telemetry_loader import load_telemetry_rows

logger = logging.getLogger(__name__)


class StreamChannel(str, Enum):
    TELEMETRY = "telemetry"
    FORECAST = "forecast"
    AI = "ai"


class ConnectionPool:
    """Thread-safe pool of WebSocket clients per channel."""

    def __init__(self) -> None:
        self._clients: dict[StreamChannel, set[WebSocket]] = {
            StreamChannel.TELEMETRY: set(),
            StreamChannel.FORECAST: set(),
            StreamChannel.AI: set(),
        }
        self._lock = asyncio.Lock()

    async def add(self, channel: StreamChannel, ws: WebSocket) -> None:
        async with self._lock:
            self._clients[channel].add(ws)

    async def remove(self, channel: StreamChannel, ws: WebSocket) -> None:
        async with self._lock:
            self._clients[channel].discard(ws)

    async def count(self, channel: StreamChannel) -> int:
        async with self._lock:
            return len(self._clients[channel])

    async def total_connections(self) -> int:
        async with self._lock:
            return sum(len(s) for s in self._clients.values())

    async def close_all(self, code: int = 1001, reason: str = "server_shutdown") -> None:
        """Gracefully close every registered client."""
        async with self._lock:
            clients: list[tuple[StreamChannel, WebSocket]] = [
                (ch, ws) for ch, bucket in self._clients.items() for ws in list(bucket)
            ]
            for bucket in self._clients.values():
                bucket.clear()

        for _ch, ws in clients:
            try:
                await ws.close(code=code, reason=reason)
            except Exception:
                pass
        if clients:
            logger.info("Closed %d WebSocket client(s) on shutdown", len(clients))

    async def broadcast(self, channel: StreamChannel, message: dict[str, Any]) -> None:
        text = json.dumps(message, default=str)
        async with self._lock:
            clients = list(self._clients[channel])

        dead: list[WebSocket] = []
        for ws in clients:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients[channel].discard(ws)


class GridStreamManager:
    """
    Singleton stream manager: connection pools + background broadcast loop.
    """

    def __init__(self) -> None:
        self.pool = ConnectionPool()
        self._broadcast_task: asyncio.Task | None = None
        self._tick = 0
        self._rows_cache: list[dict[str, Any]] = []
        self._rows_cache_at: float = 0.0
        self._running = False
        self._enabled = True
        self._startup_error: str | None = None
        self._consecutive_errors = 0

    @property
    def is_running(self) -> bool:
        return self._running and self._broadcast_task is not None and not self._broadcast_task.done()

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    @property
    def startup_error(self) -> str | None:
        return self._startup_error

    @property
    def _stream_interval(self) -> float:
        return settings.ws_stream_interval_sec

    @property
    def _rows_cache_ttl(self) -> float:
        return settings.ws_rows_cache_ttl_sec

    @property
    def _ping_timeout(self) -> float:
        return settings.ws_ping_timeout_sec

    def _server_status_payload(self) -> dict[str, Any]:
        return {
            "type": "server_status",
            "enabled": self._enabled,
            "running": self.is_running,
            "stream_interval_sec": self._stream_interval,
            "ws_base_url": settings.resolved_ws_base_url,
            "startup_error": self._startup_error,
            "reconnect_safe": True,
        }

    def start(self) -> None:
        """Sync start — prefer ``start_safe`` from async lifespan."""
        if self._running:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning("GridStreamManager.start() called without running event loop")
            return
        loop.create_task(self.start_safe())

    async def start_safe(self) -> bool:
        """Start broadcast loop; returns False instead of raising on failure."""
        if self._running and self.is_running:
            return True
        if not self._enabled:
            logger.warning("WebSocket manager disabled — skipping start")
            return False

        self._running = True
        self._startup_error = None
        try:
            self._broadcast_task = asyncio.create_task(
                self._broadcast_loop(),
                name="grid-ws-broadcast",
            )
            logger.info(
                "Grid WebSocket broadcast loop started interval=%.1fs base=%s",
                self._stream_interval,
                settings.resolved_ws_base_url,
            )
            return True
        except Exception as exc:
            self._running = False
            self._enabled = False
            self._startup_error = str(exc)
            logger.exception("Failed to start WebSocket broadcast loop: %s", exc)
            return False

    async def stop(self) -> None:
        """Cancel broadcast task and close all client connections."""
        self._running = False
        await self.pool.close_all()

        if self._broadcast_task:
            self._broadcast_task.cancel()
            try:
                await self._broadcast_task
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                logger.warning("Broadcast task stop error: %s", exc)
            self._broadcast_task = None

        logger.info("Grid WebSocket broadcast loop stopped")

    async def _get_rows(self) -> list[dict[str, Any]]:
        loop = asyncio.get_event_loop()
        now = loop.time()
        if self._rows_cache and (now - self._rows_cache_at) < self._rows_cache_ttl:
            return self._rows_cache
        try:
            rows = await asyncio.to_thread(load_telemetry_rows)
            self._rows_cache = rows
            self._rows_cache_at = now
            self._consecutive_errors = 0
        except Exception as exc:
            self._consecutive_errors += 1
            logger.warning(
                "Telemetry load for WS broadcast failed (attempt %d): %s",
                self._consecutive_errors,
                exc,
            )
            if not self._rows_cache:
                self._rows_cache = []
        return self._rows_cache

    async def _broadcast_loop(self) -> None:
        while self._running:
            try:
                total = await self.pool.total_connections()
                if total > 0:
                    rows = await self._get_rows()
                    tick = self._tick
                    self._tick += 1
                    broadcast_count = 0

                    if await self.pool.count(StreamChannel.TELEMETRY) > 0:
                        msg = build_telemetry_payload(rows, tick, include_full_rows=False)
                        await self.pool.broadcast(StreamChannel.TELEMETRY, msg)
                        broadcast_count += 1

                    if await self.pool.count(StreamChannel.FORECAST) > 0:
                        msg = build_forecast_payload(rows, tick)
                        await self.pool.broadcast(StreamChannel.FORECAST, msg)
                        broadcast_count += 1

                    if await self.pool.count(StreamChannel.AI) > 0:
                        msg = build_ai_payload(rows, tick)
                        await self.pool.broadcast(StreamChannel.AI, msg)
                        broadcast_count += 1

                    if broadcast_count:
                        from backend.system_monitor import system_monitor

                        system_monitor.record_stream_broadcast(broadcast_count)

                await asyncio.sleep(self._stream_interval)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._consecutive_errors += 1
                logger.exception("Broadcast loop error (attempt %d): %s", self._consecutive_errors, exc)
                if self._consecutive_errors >= 10:
                    logger.error("WebSocket broadcast loop disabled after repeated failures")
                    self._enabled = False
                    self._startup_error = str(exc)
                    break
                await asyncio.sleep(self._stream_interval)

    async def _send_json(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        await websocket.send_text(json.dumps(payload, default=str))

    async def handle_connection(self, websocket: WebSocket, channel: StreamChannel) -> None:
        """Accept client, send snapshot + server status, listen for pings/resync."""
        await websocket.accept()
        ch = channel

        if not self._enabled:
            await self._send_json(
                websocket,
                {
                    **self._server_status_payload(),
                    "type": "error",
                    "event": "disabled",
                    "message": self._startup_error or "WebSocket stream manager unavailable",
                },
            )
            await websocket.close(code=1013, reason="stream_manager_disabled")
            return

        await self.pool.add(ch, websocket)
        logger.info("WS %s connected (clients=%d)", ch.value, await self.pool.count(ch))

        try:
            await self._send_json(
                websocket,
                {**self._server_status_payload(), "event": "hello", "channel": ch.value},
            )

            rows = await self._get_rows()
            tick = self._tick

            if ch == StreamChannel.TELEMETRY:
                snapshot = build_telemetry_payload(rows, tick, include_full_rows=True)
                snapshot["event"] = "connected"
                await self._send_json(websocket, snapshot)
            elif ch == StreamChannel.FORECAST:
                snap = build_forecast_payload(rows, tick)
                snap["event"] = "connected"
                await self._send_json(websocket, snap)
            elif ch == StreamChannel.AI:
                snap = build_ai_payload(rows, tick)
                snap["event"] = "connected"
                await self._send_json(websocket, snap)

            while True:
                try:
                    raw = await asyncio.wait_for(
                        websocket.receive_text(),
                        timeout=self._ping_timeout,
                    )
                except asyncio.TimeoutError:
                    await self._send_json(websocket, {"type": "ping", "server": True})
                    continue

                if not raw:
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    if raw.strip().lower() == "ping":
                        await self._send_json(websocket, {"type": "pong"})
                    continue

                if msg.get("type") == "ping" or msg.get("action") == "ping":
                    await self._send_json(
                        websocket,
                        {"type": "pong", "timestamp": msg.get("timestamp")},
                    )
                elif msg.get("type") == "pong":
                    pass
                elif msg.get("type") == "resync":
                    rows = await self._get_rows()
                    if ch == StreamChannel.TELEMETRY:
                        full = build_telemetry_payload(rows, self._tick, include_full_rows=True)
                        full["event"] = "resync"
                        await self._send_json(websocket, full)
                    elif ch == StreamChannel.FORECAST:
                        snap = build_forecast_payload(rows, self._tick)
                        snap["event"] = "resync"
                        await self._send_json(websocket, snap)
                    elif ch == StreamChannel.AI:
                        snap = build_ai_payload(rows, self._tick)
                        snap["event"] = "resync"
                        await self._send_json(websocket, snap)

        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.warning("WS %s client error: %s", ch.value, exc)
        finally:
            await self.pool.remove(ch, websocket)
            logger.info("WS %s disconnected (clients=%d)", ch.value, await self.pool.count(ch))


grid_stream_manager = GridStreamManager()
