"""
Preprocess ACN-Data EV charging sessions for reinforcement-learning pipelines.

Input:  JSON export from ACN-Data API (``_items`` list of session records).
Output: ``processed_ev_data.csv`` with cleaned sessions and simulated RL features.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Paths relative to this module (data/)
DATA_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = DATA_DIR / "acndata_sessions.json"
DEFAULT_OUTPUT = DATA_DIR / "processed_ev_data.csv"

# Reproducible simulations for price, solar, and grid load features
RNG_SEED = 42

# Time-of-use electricity price tiers (USD/kWh) — illustrative California-style TOU
PRICE_OFF_PEAK = 0.12
PRICE_MID = 0.22
PRICE_PEAK = 0.38

# Solar availability peaks at local solar noon (fraction of nameplate capacity)
SOLAR_PEAK_FRACTION = 1.0
SOLAR_STD_NOISE = 0.08


# ---------------------------------------------------------------------------
# Loading and extraction
# ---------------------------------------------------------------------------


def load_acn_json(path: Path | str) -> dict[str, Any]:
    """Load and validate the ACN-Data JSON wrapper."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"ACN JSON not found: {path}")

    raw = path.read_text(encoding="utf-8")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Invalid JSON in {path}. The file may be truncated — "
            "re-download sessions from https://ev.caltech.edu/dataset"
        ) from exc

    if not isinstance(payload, dict):
        raise ValueError("Expected top-level JSON object with '_items'.")

    return payload


def extract_sessions(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Return charging session dicts from the ``_items`` array."""
    items = payload.get("_items")
    if items is None:
        raise KeyError("JSON payload missing '_items' session list.")
    if not isinstance(items, list):
        raise TypeError("'_items' must be a list of session objects.")
    if len(items) == 0:
        raise ValueError("No sessions found in '_items'.")
    return items


def sessions_to_dataframe(sessions: list[dict[str, Any]]) -> pd.DataFrame:
    """Flatten session records into a pandas DataFrame."""
    df = pd.json_normalize(sessions, sep="_")
    logger.info("Loaded %d raw sessions, %d columns", len(df), len(df.columns))
    return df


# ---------------------------------------------------------------------------
# Cleaning and timestamps
# ---------------------------------------------------------------------------


def _latest_user_input(session_row: pd.Series) -> dict[str, Any]:
    """ACN allows multiple userInputs; use the most recent entry when present."""
    inputs = session_row.get("userInputs")
    if not isinstance(inputs, list) or len(inputs) == 0:
        return {}
    last = inputs[-1]
    return last if isinstance(last, dict) else {}


def _parse_acn_datetime(series: pd.Series) -> pd.Series:
    """Parse ACN timestamps (ISO-8601 or HTTP-style GMT strings)."""
    return pd.to_datetime(series, utc=True, errors="coerce")


def clean_sessions(df: pd.DataFrame) -> pd.DataFrame:
    """
    Drop unusable rows and normalize core numeric / ID fields.

    - Requires connection and disconnect times.
    - Drops duplicate session IDs.
    - Clips negative energy to zero.
    """
    out = df.copy()

    # Expand nested userInputs into scalar columns (last user entry wins)
    user_cols = []
    for idx, row in out.iterrows():
        ui = _latest_user_input(row)
        user_cols.append(
            {
                "kwh_requested": ui.get("kWhRequested"),
                "minutes_available": ui.get("minutesAvailable"),
                "requested_departure": ui.get("requestedDeparture"),
                "wh_per_mile": ui.get("WhPerMile"),
            }
        )
    user_df = pd.DataFrame(user_cols, index=out.index)
    out = pd.concat([out, user_df], axis=1)

    # Standardize column names used downstream
    rename_map = {
        "connectionTime": "arrival_time",
        "disconnectTime": "departure_time",
        "doneChargingTime": "done_charging_time",
        "kWhDelivered": "kwh_delivered",
        "sessionID": "session_id",
        "stationID": "station_id",
        "siteID": "site_id",
        "clusterID": "cluster_id",
        "spaceID": "space_id",
        "userID": "user_id",
    }
    out = out.rename(columns={k: v for k, v in rename_map.items() if k in out.columns})

    out["arrival_time"] = _parse_acn_datetime(out.get("arrival_time", pd.Series(dtype=object)))
    out["departure_time"] = _parse_acn_datetime(out.get("departure_time", pd.Series(dtype=object)))
    if "done_charging_time" in out.columns:
        out["done_charging_time"] = _parse_acn_datetime(out["done_charging_time"])
    if "requested_departure" in out.columns:
        out["requested_departure"] = _parse_acn_datetime(out["requested_departure"])

    before = len(out)
    out = out.dropna(subset=["arrival_time", "departure_time"])
    out = out[out["departure_time"] > out["arrival_time"]]

    if "session_id" in out.columns:
        out = out.drop_duplicates(subset=["session_id"], keep="first")

    if "kwh_delivered" in out.columns:
        out["kwh_delivered"] = pd.to_numeric(out["kwh_delivered"], errors="coerce").fillna(0.0)
        out["kwh_delivered"] = out["kwh_delivered"].clip(lower=0.0)
    else:
        out["kwh_delivered"] = 0.0

    for col in ("kwh_requested", "minutes_available", "wh_per_mile"):
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")

    logger.info("Cleaned sessions: %d -> %d rows", before, len(out))
    return out.reset_index(drop=True)


def add_duration_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute plug-in dwell time and active charging duration (hours)."""
    out = df.copy()
    plug_delta = out["departure_time"] - out["arrival_time"]
    out["plug_duration_hours"] = plug_delta.dt.total_seconds() / 3600.0

    if "done_charging_time" in out.columns:
        charge_end = out["done_charging_time"].fillna(out["departure_time"])
        charge_delta = charge_end - out["arrival_time"]
        out["charging_duration_hours"] = charge_delta.dt.total_seconds().clip(lower=0) / 3600.0
    else:
        out["charging_duration_hours"] = out["plug_duration_hours"]

    # Cap charging duration at plug duration (data quirks)
    out["charging_duration_hours"] = out["charging_duration_hours"].clip(
        upper=out["plug_duration_hours"]
    )

    if "requested_departure" in out.columns:
        out["time_to_requested_departure_hours"] = (
            (out["requested_departure"] - out["arrival_time"]).dt.total_seconds() / 3600.0
        )
    else:
        out["time_to_requested_departure_hours"] = np.nan

    return out


# ---------------------------------------------------------------------------
# Simulated environment signals (price, solar, grid)
# ---------------------------------------------------------------------------


def _to_local_time(ts: pd.Series, timezone: str = "America/Los_Angeles") -> pd.Series:
    """
    Convert timestamps to local wall time.

    Element-wise conversion avoids pandas batch DST ambiguities around fall-back.
    """
    utc = ts.dt.tz_localize("UTC") if ts.dt.tz is None else ts.dt.tz_convert("UTC")
    tz = ZoneInfo(timezone)

    def _convert_one(stamp: pd.Timestamp) -> pd.Timestamp:
        if pd.isna(stamp):
            return pd.NaT
        return stamp.tz_convert(tz)

    return utc.map(_convert_one)


def _hour_of_day_local(ts: pd.Series, timezone: str = "America/Los_Angeles") -> pd.Series:
    """Local hour [0, 24) for TOU and solar models."""
    localized = _to_local_time(ts, timezone)
    return localized.dt.hour + localized.dt.minute / 60.0


def simulate_electricity_prices(
    df: pd.DataFrame,
    *,
    timezone: str = "America/Los_Angeles",
    rng: np.random.Generator | None = None,
) -> pd.DataFrame:
    """
    Time-of-use retail price at arrival (USD/kWh) plus normalized price index.

    Peak:   16:00–21:00 local
    Off-peak: 23:00–06:00 local
    Otherwise mid-peak.
    """
    out = df.copy()
    rng = rng or np.random.default_rng(RNG_SEED)

    hour = _hour_of_day_local(out["arrival_time"], timezone)
    base = np.where(
        (hour >= 16) & (hour < 21),
        PRICE_PEAK,
        np.where((hour >= 23) | (hour < 6), PRICE_OFF_PEAK, PRICE_MID),
    )
    # Small session-level noise (market / feeder variation)
    noise = rng.normal(0.0, 0.015, size=len(out))
    out["electricity_price_usd_per_kwh"] = np.clip(base + noise, 0.05, 0.55)
    out["electricity_price_norm"] = (
        (out["electricity_price_usd_per_kwh"] - PRICE_OFF_PEAK)
        / (PRICE_PEAK - PRICE_OFF_PEAK)
    ).clip(0.0, 1.0)
    return out


def simulate_solar_availability(
    df: pd.DataFrame,
    *,
    timezone: str = "America/Los_Angeles",
    rng: np.random.Generator | None = None,
) -> pd.DataFrame:
    """
    Synthetic solar generation availability at arrival (0–1).

    Smooth bell curve centered at 12:00 local; zero at night.
    """
    out = df.copy()
    rng = rng or np.random.default_rng(RNG_SEED + 1)

    hour = _hour_of_day_local(out["arrival_time"], timezone)
    # Cosine bell: positive only between ~6:00 and ~20:00
    phase = (hour - 6.0) / 14.0 * np.pi
    raw = np.sin(np.clip(phase, 0.0, np.pi))
    raw = np.where((hour >= 6) & (hour <= 20), raw, 0.0)
    noise = rng.normal(0.0, SOLAR_STD_NOISE, size=len(out))
    out["solar_availability"] = np.clip(raw * SOLAR_PEAK_FRACTION + noise, 0.0, 1.0)
    return out


def simulate_grid_load(
    df: pd.DataFrame,
    *,
    timezone: str = "America/Los_Angeles",
    max_stations: int | None = None,
) -> pd.DataFrame:
    """
    Estimate site grid load at session arrival from overlapping sessions.

    ``grid_load_ratio``: active sessions / capacity in the same hour bin.
    ``grid_load_norm``: min-max normalized load across the dataset.
    """
    out = df.copy()
    if len(out) == 0:
        out["grid_load_ratio"] = 0.0
        out["grid_load_norm"] = 0.0
        return out

    n_stations = max_stations
    if n_stations is None and "station_id" in out.columns:
        n_stations = max(int(out["station_id"].nunique()), 1)
    else:
        n_stations = n_stations or 55  # Caltech ACN approximate scale

    # Session overlap uses UTC (stable ordering); hourly intensity uses local hour bins
    utc_arrival = out["arrival_time"].dt.tz_convert("UTC")
    utc_departure = out["departure_time"].dt.tz_convert("UTC")
    local_arrival = _to_local_time(out["arrival_time"], timezone)
    hour_bins = local_arrival.map(
        lambda t: pd.NaT
        if pd.isna(t)
        else t.replace(minute=0, second=0, microsecond=0)
    )

    load_at_arrival = []
    for i in range(len(out)):
        start = utc_arrival.iloc[i]
        overlap = (utc_arrival <= start) & (utc_departure > start)
        load_at_arrival.append(int(overlap.sum()))

    out["grid_active_sessions"] = load_at_arrival
    out["grid_load_ratio"] = (out["grid_active_sessions"] / n_stations).clip(0.0, 1.5)
    out["grid_load_norm"] = (
        out["grid_load_ratio"] / out["grid_load_ratio"].max()
        if out["grid_load_ratio"].max() > 0
        else 0.0
    )

    # Hour-of-day aggregate load profile (for RL context)
    hourly_counts = hour_bins.value_counts()
    out["hourly_site_intensity"] = hour_bins.map(hourly_counts).astype(float)
    out["hourly_site_intensity_norm"] = (
        out["hourly_site_intensity"] / out["hourly_site_intensity"].max()
        if out["hourly_site_intensity"].max() > 0
        else 0.0
    )
    return out


# ---------------------------------------------------------------------------
# RL-ready features
# ---------------------------------------------------------------------------


def build_rl_state_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Construct normalized state vector columns for RL training.

    Features are bounded to roughly [0, 1] where possible for stable learning.
    """
    out = df.copy()

    # Temporal context
    hour = _hour_of_day_local(out["arrival_time"])
    out["rl_hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    out["rl_hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    out["rl_weekday_norm"] = out["arrival_time"].dt.dayofweek / 6.0

    # Session demand signals
    max_kwh = out["kwh_delivered"].max() or 1.0
    out["rl_energy_delivered_norm"] = (out["kwh_delivered"] / max_kwh).clip(0.0, 1.0)

    if "kwh_requested" in out.columns and out["kwh_requested"].notna().any():
        req = out["kwh_requested"].fillna(out["kwh_delivered"])
        max_req = req.max() or 1.0
        out["rl_energy_requested_norm"] = (req / max_req).clip(0.0, 1.0)
        out["rl_fulfillment_ratio"] = (
            out["kwh_delivered"] / req.replace(0, np.nan)
        ).fillna(1.0).clip(0.0, 1.5)
    else:
        out["rl_energy_requested_norm"] = out["rl_energy_delivered_norm"]
        out["rl_fulfillment_ratio"] = 1.0

    max_plug = out["plug_duration_hours"].max() or 1.0
    out["rl_plug_duration_norm"] = (out["plug_duration_hours"] / max_plug).clip(0.0, 1.0)

    max_charge = out["charging_duration_hours"].max() or 1.0
    out["rl_charging_duration_norm"] = (out["charging_duration_hours"] / max_charge).clip(
        0.0, 1.0
    )

    if out["time_to_requested_departure_hours"].notna().any():
        ttd = out["time_to_requested_departure_hours"].fillna(out["plug_duration_hours"])
        max_ttd = ttd.max() or 1.0
        out["rl_time_to_departure_norm"] = (ttd / max_ttd).clip(0.0, 1.0)
    else:
        out["rl_time_to_departure_norm"] = out["rl_plug_duration_norm"]

    # Environment signals (already simulated)
    out["rl_price_norm"] = out["electricity_price_norm"]
    out["rl_solar_norm"] = out["solar_availability"]
    out["rl_grid_load_norm"] = out["grid_load_norm"]

    # Compact state vector label for logging / vector env setup
    rl_cols = [
        "rl_hour_sin",
        "rl_hour_cos",
        "rl_weekday_norm",
        "rl_energy_requested_norm",
        "rl_energy_delivered_norm",
        "rl_plug_duration_norm",
        "rl_charging_duration_norm",
        "rl_time_to_departure_norm",
        "rl_price_norm",
        "rl_solar_norm",
        "rl_grid_load_norm",
        "rl_fulfillment_ratio",
    ]
    out["rl_state_dim"] = len(rl_cols)
    return out


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def preprocess_acn_sessions(
    input_path: Path | str = DEFAULT_INPUT,
    output_path: Path | str = DEFAULT_OUTPUT,
    *,
    timezone: str = "America/Los_Angeles",
) -> pd.DataFrame:
    """Full preprocessing pipeline: load JSON → clean → simulate → RL features → CSV."""
    payload = load_acn_json(input_path)
    sessions = extract_sessions(payload)
    rng = np.random.default_rng(RNG_SEED)

    df = sessions_to_dataframe(sessions)
    df = clean_sessions(df)
    df = add_duration_features(df)
    df = simulate_electricity_prices(df, timezone=timezone, rng=rng)
    df = simulate_solar_availability(df, timezone=timezone, rng=np.random.default_rng(RNG_SEED + 1))
    df = simulate_grid_load(df, timezone=timezone)
    df = build_rl_state_features(df)

    # Drop nested / duplicate raw fields not needed in the RL dataset
    drop_cols = [c for c in ("userInputs",) if c in df.columns]
    df = df.drop(columns=drop_cols)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    logger.info("Wrote %d rows to %s", len(df), output_path)
    return df


# ---------------------------------------------------------------------------
# Smart-grid telemetry (enterprise feature engineering)
# ---------------------------------------------------------------------------
# Implementation: ``grid_telemetry_pipeline.py`` (hourly telemetry for dashboard + RL)

TELEMETRY_OUTPUT = DATA_DIR / "grid_telemetry.csv"


def build_grid_telemetry_from_sessions(
    input_path: Path | str = DEFAULT_OUTPUT,
    output_path: Path | str = TELEMETRY_OUTPUT,
    *,
    analyze: bool = True,
) -> pd.DataFrame:
    """
    Build ``grid_telemetry.csv`` from processed charging sessions.

    Features: grid load, SOC, solar, battery health, RL state, anomalies, etc.
    See ``grid_telemetry_pipeline.py`` for engineering details.
    """
    from grid_telemetry_pipeline import build_grid_telemetry  # noqa: PLC0415

    return build_grid_telemetry(
        input_path=input_path,
        output_path=output_path,
        analyze=analyze,
    )


def main() -> None:
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(
        description="V2B Neural Grid — ACN session prep + smart-grid telemetry engineering",
    )
    parser.add_argument(
        "--mode",
        choices=("telemetry", "acn", "all"),
        default="telemetry",
        help="telemetry: grid_telemetry.csv | acn: JSON→processed_ev_data.csv | all",
    )
    parser.add_argument(
        "--no-analyze",
        action="store_true",
        help="Skip Task 1 dataset diagnostics",
    )
    args = parser.parse_args()

    if args.mode in ("acn", "all"):
        df = preprocess_acn_sessions()
        print(f"Processed {len(df)} sessions -> {DEFAULT_OUTPUT}")

    if args.mode in ("telemetry", "all"):
        telemetry = build_grid_telemetry_from_sessions(
            analyze=not args.no_analyze,
        )
        print(
            f"Telemetry pipeline complete: {len(telemetry)} hourly rows -> {TELEMETRY_OUTPUT}"
        )


if __name__ == "__main__":
    main()
