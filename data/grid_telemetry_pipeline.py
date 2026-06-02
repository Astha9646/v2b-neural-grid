"""
V2B Neural Grid — Enterprise smart-grid telemetry feature engineering.

Transforms session-level EV charging records into hourly telemetry streams
for dashboard visualization, infrastructure monitoring, and DDPG RL training.

Pipeline stages:
  load → clean → session features → hourly expansion → aggregation
  → physics-inspired simulation → RL features → quality control → export
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).resolve().parent
DEFAULT_SESSIONS_INPUT = DATA_DIR / "processed_ev_data.csv"
DEFAULT_TELEMETRY_OUTPUT = DATA_DIR / "grid_telemetry.csv"

RNG_SEED = 42
TIMEZONE = "America/Los_Angeles"

BASE_BUILDING_LOAD_KW = 95.0
SOLAR_NAMEPLATE_KW = 120.0
FAST_CHARGE_KW_THRESHOLD = 18.0
DEFAULT_STATION_COUNT = 20
GRID_CO2_KG_PER_KWH = 0.42

# Canonical export schema (dashboard + RL)
CORE_TELEMETRY_COLUMNS = [
    "timestamp",
    "time",
    "grid_load_kw",
    "charging_power_kw",
    "soc_percent",
    "charger_utilization",
    "peak_demand_kw",
    "solar_generation_kw",
    "renewable_ratio",
    "battery_health_percent",
    "degradation_score",
    "thermal_index",
    "charging_stress_score",
    "grid_stress_index",
    "anomaly_score",
    "carbon_savings_kg",
    "rl_reward_signal",
    "normalized_load",
    "normalized_soc",
    "normalized_stress",
    "renewable_state",
    "peak_penalty",
    "station_efficiency_score",
    "renewable_utilization_score",
    "predicted_peak_risk",
    "charging_queue_index",
    "battery_risk_level",
    "chargerA",
    "chargerB",
    "chargerC",
    "chargerD",
    "load",
    "grid_load",
    "soc",
    "solar_kw",
    "grid_load_kw_ma3",
    "grid_load_kw_ma6",
    "charging_power_kw_ma3",
    "load_lag1",
    "load_lag3",
    "soc_lag1",
]


# ---------------------------------------------------------------------------
# Task 1 — Dataset inspection
# ---------------------------------------------------------------------------


def load_processed_sessions(path: Path | str = DEFAULT_SESSIONS_INPUT) -> pd.DataFrame:
    """Load session-level dataset with parsed UTC timestamps."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Session dataset not found: {path}")

    df = pd.read_csv(path)
    for col in ("arrival_time", "departure_time", "done_charging_time", "requested_departure"):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")

    logger.info("Loaded %d sessions (%d columns) from %s", len(df), len(df.columns), path)
    return df


def analyze_sessions(df: pd.DataFrame) -> dict[str, Any]:
    """
    Full exploratory diagnostics (Task 1).

    Returns summary dict; prints human-readable report.
    """
    print("\n" + "=" * 72)
    print("V2B NEURAL GRID — SESSION DATASET ANALYSIS")
    print("=" * 72)

    print("\n=== HEAD (5 rows) ===")
    print(df.head())

    print("\n=== INFO ===")
    df.info()

    print("\n=== DESCRIBE (numeric) ===")
    numeric = df.select_dtypes(include=[np.number])
    if not numeric.empty:
        print(numeric.describe().T)

    nulls = df.isnull().sum()
    nulls_nz = nulls[nulls > 0]
    print("\n=== NULL ANALYSIS ===")
    if nulls_nz.empty:
        print("No null values in any column.")
    else:
        print(nulls_nz.sort_values(ascending=False))

    energy_cols = [c for c in df.columns if any(k in c.lower() for k in ("kwh", "energy", "power", "load"))]
    charging_cols = [c for c in df.columns if any(k in c.lower() for k in ("charg", "plug", "duration", "station"))]
    print("\n=== ENERGY FIELDS ===", energy_cols)
    print("=== CHARGING FIELDS ===", charging_cols)

    if "arrival_time" in df.columns:
        valid = df["arrival_time"].dropna()
        print("\n=== TIMESTAMP RANGE ===")
        print(f"  {valid.min()} → {valid.max()}")

    for cat in ("station_id", "cluster_id", "site_id"):
        if cat in df.columns:
            print(f"\n=== {cat.upper()} (top 5) ===")
            print(df[cat].value_counts().head())

    summary = {
        "rows": len(df),
        "columns": list(df.columns),
        "null_columns": nulls_nz.to_dict(),
        "energy_columns": energy_cols,
        "charging_columns": charging_cols,
    }
    print("\n" + "=" * 72)
    return summary


# ---------------------------------------------------------------------------
# Task 2 — Cleaning & session-level engineering
# ---------------------------------------------------------------------------


def clean_sessions(df: pd.DataFrame) -> pd.DataFrame:
    """Validate types, clip energy, remove invalid dwell times."""
    out = df.copy()
    out["kwh_delivered"] = pd.to_numeric(out.get("kwh_delivered"), errors="coerce").fillna(0.0).clip(0.0, 200.0)
    out["charging_duration_hours"] = pd.to_numeric(
        out.get("charging_duration_hours"), errors="coerce"
    ).fillna(0.25).clip(0.1, 48.0)
    out = out.dropna(subset=["arrival_time", "departure_time"])
    out = out[out["departure_time"] > out["arrival_time"]]
    return out.reset_index(drop=True)


def add_session_power_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Session-level kW, fast-charge flags, and SOC endpoints for hourly allocation.
    """
    out = clean_sessions(df)

    out["charging_power_kw"] = (
        out["kwh_delivered"] / out["charging_duration_hours"]
    ).clip(0.0, 50.0)

    out["is_fast_charge"] = (out["charging_power_kw"] >= FAST_CHARGE_KW_THRESHOLD).astype(int)

    fulfillment = pd.to_numeric(out.get("rl_fulfillment_ratio"), errors="coerce").fillna(0.85)
    energy_norm = pd.to_numeric(out.get("rl_energy_delivered_norm"), errors="coerce").fillna(0.5)

    # Estimated SOC at plug-in / unplug
    out["soc_start"] = (32.0 + 18.0 * energy_norm).clip(20.0, 55.0)
    out["soc_end"] = (out["soc_start"] + out["kwh_delivered"] * 1.8 + 10.0 * fulfillment).clip(25.0, 98.0)

    return out


# ---------------------------------------------------------------------------
# Task 4 — Time-series expansion & aggregation
# ---------------------------------------------------------------------------


def _local_hour(ts: pd.Timestamp) -> float:
    if pd.isna(ts):
        return 12.0
    tz = ZoneInfo(TIMEZONE)
    t = ts.tz_convert(tz) if ts.tzinfo else ts.tz_localize("UTC").tz_convert(tz)
    return t.hour + t.minute / 60.0


def expand_sessions_to_hourly(df: pd.DataFrame) -> pd.DataFrame:
    """
    Expand sessions into hourly bins with linear SOC interpolation (Task 3 — SOC curves).
    """
    rows: list[dict] = []

    for _, sess in df.iterrows():
        start = pd.Timestamp(sess["arrival_time"]).floor("h")
        end = pd.Timestamp(sess["departure_time"]).ceil("h")
        if pd.isna(start) or pd.isna(end) or end <= start:
            continue

        hours = pd.date_range(start, end, freq="h", inclusive="left")
        if len(hours) == 0:
            hours = pd.DatetimeIndex([start])

        n_bins = max(len(hours), 1)
        kwh_per_hour = float(sess["kwh_delivered"]) / n_bins
        soc_start = float(sess["soc_start"])
        soc_end = float(sess["soc_end"])

        for i, hour_ts in enumerate(hours):
            frac = (i + 0.5) / n_bins
            soc_interp = soc_start + (soc_end - soc_start) * frac

            rows.append(
                {
                    "timestamp": hour_ts,
                    "session_id": sess.get("session_id"),
                    "station_id": str(sess.get("station_id", "unknown")),
                    "cluster_id": str(sess.get("cluster_id", "unknown")),
                    "charging_power_kw": kwh_per_hour,
                    "energy_kwh": kwh_per_hour,
                    "soc_segment": soc_interp,
                    "is_fast_charge": int(sess.get("is_fast_charge", 0)),
                    "grid_load_ratio": float(sess.get("grid_load_ratio", 0.0)),
                }
            )

    events = pd.DataFrame(rows)
    if events.empty:
        raise ValueError("Hourly expansion produced zero rows — check timestamps.")

    logger.info("Hourly expansion: %d segment-rows from %d sessions", len(events), len(df))
    return events


def aggregate_hourly_site(events: pd.DataFrame, n_stations: int) -> pd.DataFrame:
    """Site-wide hourly aggregation (primary telemetry stream)."""
    agg = (
        events.groupby("timestamp", as_index=False)
        .agg(
            charging_power_kw=("charging_power_kw", "sum"),
            energy_kwh=("energy_kwh", "sum"),
            active_sessions=("session_id", "nunique"),
            fast_charge_sessions=("is_fast_charge", "sum"),
            soc_percent=("soc_segment", "mean"),
            mean_grid_ratio=("grid_load_ratio", "mean"),
        )
        .sort_values("timestamp")
        .reset_index(drop=True)
    )

    n_stations = max(int(n_stations), 1)
    agg["charger_utilization"] = (agg["active_sessions"] / n_stations).clip(0.0, 1.0)

    overlap = 1.0 + 0.12 * (agg["active_sessions"] - 1).clip(lower=0)
    agg["grid_load_kw"] = (BASE_BUILDING_LOAD_KW + agg["charging_power_kw"] * overlap).round(2)
    agg["soc_percent"] = agg["soc_percent"].clip(15.0, 98.0).round(1)

    return agg


def aggregate_hourly_by_station(events: pd.DataFrame) -> pd.DataFrame:
    return (
        events.groupby(["timestamp", "station_id"], as_index=False)
        .agg(charging_power_kw=("charging_power_kw", "sum"), sessions=("session_id", "nunique"))
        .sort_values(["timestamp", "station_id"])
    )


def aggregate_hourly_by_cluster(events: pd.DataFrame) -> pd.DataFrame:
    return (
        events.groupby(["timestamp", "cluster_id"], as_index=False)
        .agg(charging_power_kw=("charging_power_kw", "sum"), sessions=("session_id", "nunique"))
        .sort_values(["timestamp", "cluster_id"])
    )


def pivot_top_chargers(
    site: pd.DataFrame, events: pd.DataFrame, top_n: int = 4
) -> pd.DataFrame:
    """Add chargerA–D columns from busiest stations (ChargingChart compatibility)."""
    by_st = aggregate_hourly_by_station(events)
    top_ids = (
        by_st.groupby("station_id")["charging_power_kw"]
        .sum()
        .nlargest(top_n)
        .index.tolist()
    )
    labels = ["chargerA", "chargerB", "chargerC", "chargerD"]
    out = site.copy()

    for label, sid in zip(labels, top_ids):
        sub = by_st.loc[by_st["station_id"] == sid, ["timestamp", "charging_power_kw"]]
        sub = sub.rename(columns={"charging_power_kw": label})
        out = out.merge(sub, on="timestamp", how="left")

    for label in labels:
        if label not in out.columns:
            out[label] = 0.0
        out[label] = out[label].fillna(0.0).round(2)

    return out


# ---------------------------------------------------------------------------
# Task 3 — Smart-grid feature engineering
# ---------------------------------------------------------------------------


def simulate_solar_generation(timestamps: pd.Series, rng: np.random.Generator) -> pd.Series:
    """Smooth bell-curve solar [kW]; near-zero at night."""
    values = []
    for ts in timestamps:
        h = _local_hour(pd.Timestamp(ts))
        if h < 6.0 or h > 20.0:
            kw = 0.0
        else:
            phase = (h - 6.0) / 14.0 * np.pi
            shape = float(np.sin(phase) ** 1.12)
            kw = max(0.0, SOLAR_NAMEPLATE_KW * shape + rng.normal(0.0, 2.5))
        values.append(kw)
    return pd.Series(values, index=timestamps.index).round(2)


def engineer_battery_features(site: pd.DataFrame, events: pd.DataFrame) -> pd.DataFrame:
    """Degradation, thermal stress, health % (Tasks 3.8–3.11)."""
    out = site.copy()
    fast = events.groupby("timestamp")["is_fast_charge"].sum().reindex(out.index).fillna(0).values

    power_norm = out["charging_power_kw"] / max(out["charging_power_kw"].max(), 1.0)
    fast_norm = fast / max(fast.max(), 1.0)

    stress = 0.30 * out["charger_utilization"] + 0.35 * power_norm + 0.35 * fast_norm
    out["charging_stress_score"] = (stress * 100).clip(0.0, 100.0).round(1)

    out["thermal_index"] = (
        26.0 + 16.0 * stress + 4.0 * out["charger_utilization"]
    ).clip(24.0, 48.0).round(1)

    cycle_proxy = np.arange(len(out)) / max(len(out), 1) * 8.0
    fast_cum = pd.Series(fast).expanding().mean().fillna(0).values
    out["degradation_score"] = (1.5 + cycle_proxy + fast_cum * 2.0 + stress * 4.0).clip(0.5, 15.0).round(2)
    out["battery_health_percent"] = (99.0 - out["degradation_score"] * 2.8).clip(70.0, 99.0).round(1)

    return out


def engineer_grid_and_renewable_features(site: pd.DataFrame) -> pd.DataFrame:
    """Renewable ratio, peak demand, carbon, efficiency (Tasks 3.5–3.7, 3.13–3.14)."""
    out = site.copy()

    out["renewable_ratio"] = (
        out["solar_generation_kw"] / (out["grid_load_kw"] + 1e-6)
    ).clip(0.0, 1.2).round(4)

    out["renewable_utilization_score"] = (
        out["solar_generation_kw"] / (out["grid_load_kw"] + out["solar_generation_kw"] + 1e-6)
    ).clip(0.0, 1.0).round(4)

    out["peak_demand_kw"] = out["grid_load_kw"].cummax().round(2)

    roll_mean = out["grid_load_kw"].rolling(6, min_periods=1).mean()
    roll_std = out["grid_load_kw"].rolling(6, min_periods=1).std().replace(0, 1.0)
    z = ((out["grid_load_kw"] - roll_mean) / roll_std).abs()
    out["anomaly_score"] = z.clip(0.0, 5.0).round(3)

    out["carbon_savings_kg"] = (out["solar_generation_kw"] * GRID_CO2_KG_PER_KWH).round(2)

    out["station_efficiency_score"] = (
        (out["charging_power_kw"] * out["charger_utilization"])
        / (out["charging_power_kw"] + 8.0)
    ).clip(0.25, 1.0).round(3)

    p85 = out["grid_load_kw"].quantile(0.85)
    out["predicted_peak_risk"] = (
        (out["grid_load_kw"] - p85 * 0.9) / (out["grid_load_kw"].max() - p85 * 0.9 + 1e-6)
    ).clip(0.0, 1.0).round(4)

    out["charging_queue_index"] = (
        out["active_sessions"] / max(out["active_sessions"].max(), 1)
    ).round(4) if "active_sessions" in out.columns else out["charger_utilization"]

    risk = (
        0.4 * (out["charging_stress_score"] / 100.0)
        + 0.35 * (out["degradation_score"] / 15.0)
        + 0.25 * out["predicted_peak_risk"]
    )
    out["battery_risk_level"] = pd.cut(
        risk, bins=[-0.01, 0.25, 0.5, 0.75, 1.01], labels=[0, 1, 2, 3]
    ).astype(float)

    return out


def engineer_rl_features(site: pd.DataFrame) -> pd.DataFrame:
    """
    Normalized RL state + reward signal (Tasks 3.15, 5).

    ``rl_reward_signal`` proxies V2B objectives:
      + renewable utilization
      − peak penalty
      − grid stress
      − degradation proxy
    """
    out = site.copy()
    load_max = out["grid_load_kw"].max() or 1.0

    out["normalized_load"] = (out["grid_load_kw"] / load_max).clip(0.0, 1.0).round(4)
    out["normalized_soc"] = (out["soc_percent"] / 100.0).clip(0.0, 1.0).round(4)
    out["normalized_stress"] = (out["charging_stress_score"] / 100.0).clip(0.0, 1.0).round(4)
    out["renewable_state"] = out["renewable_utilization_score"]

    p85 = out["grid_load_kw"].quantile(0.85)
    out["peak_penalty"] = (
        (out["grid_load_kw"] - p85) / (load_max - p85 + 1e-6)
    ).clip(0.0, 1.0).round(4)

    out["grid_stress_index"] = (
        0.45 * out["normalized_load"]
        + 0.30 * out["charger_utilization"]
        + 0.25 * out["peak_penalty"]
    ).clip(0.0, 1.0).round(4)

    out["rl_reward_signal"] = (
        1.2 * out["renewable_state"]
        - 0.8 * out["peak_penalty"]
        - 0.6 * out["grid_stress_index"]
        - 0.3 * out["normalized_stress"]
        + 0.2 * out["normalized_soc"]
    ).round(4)

    return out


def add_rolling_and_lag_features(site: pd.DataFrame) -> pd.DataFrame:
    """Rolling means, smoothing, lag features (Task 4)."""
    out = site.copy()
    out["grid_load_kw_ma3"] = out["grid_load_kw"].rolling(3, min_periods=1).mean().round(2)
    out["grid_load_kw_ma6"] = out["grid_load_kw"].rolling(6, min_periods=1).mean().round(2)
    out["charging_power_kw_ma3"] = out["charging_power_kw"].rolling(3, min_periods=1).mean().round(2)

    out["load_lag1"] = out["grid_load_kw"].shift(1).bfill().round(2)
    out["load_lag3"] = out["grid_load_kw"].shift(3).bfill().round(2)
    out["soc_lag1"] = out["soc_percent"].shift(1).bfill().round(1)

    # Light exponential smoothing for chart stability
    out["grid_load_kw"] = out["grid_load_kw"].ewm(span=2, adjust=False).mean().round(2)
    out["soc_percent"] = out["soc_percent"].ewm(span=3, adjust=False).mean().round(1)

    return out


def normalize_and_validate(site: pd.DataFrame) -> pd.DataFrame:
    """Task 7 — data quality: no NaNs, stable ranges, datetime ISO."""
    out = site.copy()
    out["timestamp"] = pd.to_datetime(out["timestamp"], utc=True)
    tz = ZoneInfo(TIMEZONE)
    out["time"] = out["timestamp"].dt.tz_convert(tz).dt.strftime("%H:%M")

    out["load"] = out["grid_load_kw"]
    out["grid_load"] = out["grid_load_kw"]
    out["soc"] = out["soc_percent"]
    out["solar_kw"] = out["solar_generation_kw"]

    out = out.replace([np.inf, -np.inf], np.nan).fillna(0.0)

    for col in CORE_TELEMETRY_COLUMNS:
        if col not in out.columns:
            out[col] = 0.0

    return out[CORE_TELEMETRY_COLUMNS]


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def build_grid_telemetry(
    input_path: Path | str = DEFAULT_SESSIONS_INPUT,
    output_path: Path | str = DEFAULT_TELEMETRY_OUTPUT,
    *,
    analyze: bool = True,
) -> pd.DataFrame:
    """
    End-to-end telemetry pipeline (Tasks 2–7).

    Parameters
    ----------
    input_path : path to ``processed_ev_data.csv``
    output_path : path for ``grid_telemetry.csv``
    analyze : print Task 1 diagnostics

    Returns
    -------
    pd.DataFrame
        Final telemetry, also written to CSV.
    """
    rng = np.random.default_rng(RNG_SEED)

    sessions = load_processed_sessions(input_path)
    if analyze:
        analyze_sessions(sessions)

    sessions = add_session_power_features(sessions)
    n_stations = int(sessions["station_id"].nunique()) if "station_id" in sessions.columns else DEFAULT_STATION_COUNT

    events = expand_sessions_to_hourly(sessions)
    site = aggregate_hourly_site(events, n_stations)

    by_station = aggregate_hourly_by_station(events)
    by_cluster = aggregate_hourly_by_cluster(events)
    logger.info("Rollups — site: %d h | station: %d | cluster: %d", len(site), len(by_station), len(by_cluster))

    site["solar_generation_kw"] = simulate_solar_generation(site["timestamp"], rng)
    site = engineer_battery_features(site, events)
    site = engineer_grid_and_renewable_features(site)
    site = pivot_top_chargers(site, events, top_n=4)
    site = engineer_rl_features(site)
    site = add_rolling_and_lag_features(site)

    telemetry = normalize_and_validate(site)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    telemetry.to_csv(output_path, index=False)
    logger.info("Exported %d rows × %d cols → %s", len(telemetry), len(telemetry.columns), output_path)

    return telemetry


def run_grid_telemetry_pipeline() -> pd.DataFrame:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    return build_grid_telemetry()


if __name__ == "__main__":
    run_grid_telemetry_pipeline()
