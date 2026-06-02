"""
Time-series forecasting for V2B Neural Grid operations.

Uses rolling windows and lightweight trend extrapolation on telemetry history.
Designed for modular extension (ARIMA, Prophet, neural forecasters).
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


def _series(rows: list[dict[str, Any]], key: str, alt: str | None = None) -> np.ndarray:
    keys = [key] + ([alt] if alt else [])
    out = []
    for row in rows:
        v = None
        for k in keys:
            if k in row and row[k] is not None:
                try:
                    v = float(row[k])
                    break
                except (TypeError, ValueError):
                    pass
        out.append(v if v is not None and np.isfinite(v) else 0.0)
    return np.asarray(out, dtype=np.float64)


def _rolling_mean(arr: np.ndarray, window: int) -> float:
    if len(arr) == 0:
        return 0.0
    w = min(window, len(arr))
    return float(np.mean(arr[-w:]))


def _linear_forecast(arr: np.ndarray, horizon: int, window: int = 12) -> list[float]:
    """Simple least-squares slope extrapolation."""
    if len(arr) < 2:
        return [float(arr[-1]) if len(arr) else 0.0] * horizon

    y = arr[-window:] if len(arr) >= window else arr
    x = np.arange(len(y), dtype=np.float64)
    if len(y) < 2:
        return [float(y[-1])] * horizon

    slope, intercept = np.polyfit(x, y, 1)
    start = len(y)
    return [float(intercept + slope * (start + i)) for i in range(horizon)]


@dataclass
class ForecastBundle:
    load_kw: list[float]
    peak_demand_kw: list[float]
    renewable_kw: list[float]
    soc_percent: list[float]
    charging_demand_kw: list[float]
    grid_stress_index: list[float]
    horizon: int
    window: int
    timestamps: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ForecastingEngine:
  DEFAULT_WINDOW = 24
  DEFAULT_HORIZON = 6

  def __init__(self) -> None:
      self._ready = False
      self._using_fallback = False

  def forecast(
      self,
      rows: list[dict[str, Any]],
      horizon: int | None = None,
      window: int | None = None,
  ) -> ForecastBundle:
      horizon = horizon or self.DEFAULT_HORIZON
      window = window or self.DEFAULT_WINDOW
      rows = rows[-max(window * 3, 48) :] if rows else []

      load = _series(rows, "grid_load_kw", "load")
      peak = _series(rows, "peak_demand_kw")
      solar = _series(rows, "solar_generation_kw", "solar_kw")
      soc = _series(rows, "soc_percent", "soc")
      charging = _series(rows, "charging_power_kw")

      load_fc = [max(0, v) for v in _linear_forecast(load, horizon, window)]
      peak_fc = [max(v, load_fc[i] * 0.95) for i, v in enumerate(_linear_forecast(peak, horizon, window))]
      solar_fc = [max(0, v) for v in _linear_forecast(solar, horizon, window)]
      soc_fc = [float(np.clip(v, 0, 100)) for v in _linear_forecast(soc, horizon, window)]
      charge_fc = [max(0, v) for v in _linear_forecast(charging, horizon, window)]
      stress_fc = [
          float(np.clip(load_fc[i] / max(peak_fc[i], 1.0), 0.0, 1.0))
          for i in range(horizon)
      ]

      ts_list = [str(r.get("timestamp", "")) for r in rows[-horizon:]]
      while len(ts_list) < horizon:
          ts_list.append("")

      return ForecastBundle(
          load_kw=load_fc,
          peak_demand_kw=peak_fc,
          renewable_kw=solar_fc,
          soc_percent=soc_fc,
          charging_demand_kw=charge_fc,
          grid_stress_index=stress_fc,
          horizon=horizon,
          window=window,
          timestamps=ts_list,
      )

  def summary_metrics(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
      load = _series(rows, "grid_load_kw", "load")
      return {
          "load_trend_1h": round(float(load[-1] - load[-2]), 2) if len(load) >= 2 else 0,
          "load_ma_24": round(_rolling_mean(load, 24), 2),
          "load_forecast_next": round(_linear_forecast(load, 1)[0], 2) if len(load) else 0,
      }

  def fallback_bundle(self, horizon: int | None = None, window: int | None = None) -> ForecastBundle:
      """Deterministic zero baseline when telemetry history is unavailable."""
      horizon = horizon or self.DEFAULT_HORIZON
      window = window or self.DEFAULT_WINDOW
      zeros = [0.0] * horizon
      return ForecastBundle(
          load_kw=zeros,
          peak_demand_kw=zeros,
          renewable_kw=zeros,
          soc_percent=[50.0] * horizon,
          charging_demand_kw=zeros,
          grid_stress_index=zeros,
          horizon=horizon,
          window=window,
          timestamps=[""] * horizon,
      )

  def startup_validate(self, rows: list[dict[str, Any]] | None = None) -> bool:
      """
      Warm-up forecast path at startup.

      Returns True when real telemetry rows were used; False when fallback path ran.
      """
      try:
          from backend.telemetry_loader import load_telemetry_rows

          sample = rows if rows is not None else load_telemetry_rows(limit=48)
          if sample:
              self.forecast(sample)
              self._ready = True
              self._using_fallback = False
              return True
          self.fallback_bundle()
          self._ready = True
          self._using_fallback = True
          return False
      except Exception:
          self.fallback_bundle()
          self._ready = True
          self._using_fallback = True
          raise

  @property
  def is_ready(self) -> bool:
      return getattr(self, "_ready", False)

  @property
  def using_fallback(self) -> bool:
      return getattr(self, "_using_fallback", False)

  def forecast_safe(
      self,
      rows: list[dict[str, Any]],
      horizon: int | None = None,
      window: int | None = None,
  ) -> ForecastBundle:
      """Forecast with graceful empty-data fallback."""
      try:
          if not rows:
              return self.fallback_bundle(horizon=horizon, window=window)
          return self.forecast(rows, horizon=horizon, window=window)
      except Exception as exc:
          logger.warning("Forecast failed — returning fallback bundle: %s", exc)
          return self.fallback_bundle(horizon=horizon, window=window)


forecasting_engine = ForecastingEngine()
