"""
State representation for V2B (Vehicle-to-Building) DDPG charging control.

Implements the abstracted state space described in:
  "Reinforcement Learning-based Approach for Vehicle-to-Building Charging
   with Heterogeneous Agents and Long Term Rewards" (arXiv:2502.18526)

The builder maps ``data/processed_ev_data.csv`` into fixed-length vectors in [0, 1]
suitable for continuous-action DDPG actors/critics.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Default dataset produced by data/preprocess.py
DEFAULT_DATASET = Path(__file__).resolve().parents[1] / "data" / "processed_ev_data.csv"

# Paper uses discrete time slots T_j; default = hourly bins over the day
DEFAULT_TIME_SLOTS_PER_DAY = 24

# Typical passenger EV pack capacity (kWh) for SoC ↔ energy conversion
DEFAULT_BATTERY_CAPACITY_KWH = 60.0

# Rolling windows (in time slots) for electricity price smoothing
ROLLING_PRICE_SLOTS = 6

# Peak-demand history window (days), per paper Section 4 state description
PEAK_HISTORY_DAYS = 7

# Maximum charger power (kW) for normalization (heterogeneous infrastructure)
MAX_CHARGER_POWER_KW = 50.0

# Ordered feature names — fixed layout for DDPG (dim = len(STATE_FEATURE_NAMES))
STATE_FEATURE_NAMES: tuple[str, ...] = (
    # 1) Temporal (4)
    "time_slot_norm",
    "hour_of_day_norm",
    "weekday_norm",
    "time_index_norm",
    # 2) Building / demand charge context (4)
    "building_load_norm",
    "monthly_peak_demand_norm",
    "peak_demand_mean_7d_norm",
    "peak_demand_var_7d_norm",
    # 3) Electricity / TOU (2)
    "tou_price_norm",
    "rolling_avg_price_norm",
    # 4) EV session (6)
    "ev_arrival_count_norm",
    "soc_current_norm",
    "soc_target_norm",
    "remaining_charging_time_norm",
    "energy_required_norm",
    "charger_occupancy_norm",
    # 5) Charger heterogeneity (3)
    "charger_type_norm",
    "max_charging_power_norm",
    "bidirectional_capable_norm",
    # 6) Renewables (2)
    "solar_availability_norm",
    "renewable_utilization_norm",
    # 7) Battery health proxies (2)
    "battery_degradation_norm",
    "charging_cycle_estimate_norm",
)

STATE_DIM = len(STATE_FEATURE_NAMES)


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------


def _safe_minmax(series: pd.Series, fill: float = 0.0) -> pd.Series:
    """Min-max scale to [0, 1]; constant columns map to ``fill``."""
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)
    s = s.fillna(s.median() if s.notna().any() else fill)
    lo, hi = s.min(), s.max()
    if hi <= lo:
        return pd.Series(fill, index=s.index, dtype=float)
    return ((s - lo) / (hi - lo)).clip(0.0, 1.0)


def _clip_unit(values: np.ndarray | float) -> np.ndarray:
    """Clip numeric values into [0, 1] for DDPG stability."""
    return np.clip(np.asarray(values, dtype=np.float64), 0.0, 1.0)


def _station_hash_fraction(key: str, salt: str) -> float:
    """Deterministic pseudo-random fraction in [0, 1) from a string key."""
    digest = hashlib.md5(f"{salt}:{key}".encode(), usedforsecurity=False).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Feature engineering helpers (modular, paper-aligned)
# ---------------------------------------------------------------------------


def _parse_timestamps(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in ("arrival_time", "departure_time", "done_charging_time", "requested_departure"):
        if col in out.columns:
            out[col] = pd.to_datetime(out[col], utc=True, errors="coerce")
    return out


def _compute_temporal_features(
    df: pd.DataFrame,
    *,
    time_slots_per_day: int,
) -> pd.DataFrame:
    """
    Temporal context at decision time T_j (paper items 1 and 6).

    - time_slot_norm: discretized slot index within the day
    - hour_of_day_norm: clock hour
    - weekday_norm: day-of-week
    - time_index_norm: progress through the dataset billing horizon
    """
    out = df.copy()
    arrival = out["arrival_time"]
    hour = arrival.dt.hour + arrival.dt.minute / 60.0

    # Map hour to slot index [0, time_slots_per_day - 1]
    slot_idx = np.floor(hour / 24.0 * time_slots_per_day).astype(int)
    slot_idx = np.clip(slot_idx, 0, time_slots_per_day - 1)
    out["_slot_idx"] = slot_idx
    out["time_slot_norm"] = slot_idx / max(time_slots_per_day - 1, 1)
    out["hour_of_day_norm"] = hour / 24.0
    out["weekday_norm"] = arrival.dt.dayofweek / 6.0

    t0 = arrival.min()
    t1 = arrival.max()
    span = (t1 - t0).total_seconds() if pd.notna(t0) and pd.notna(t1) else 0.0
    if span > 0:
        out["time_index_norm"] = (
            (arrival - t0).dt.total_seconds() / span
        ).clip(0.0, 1.0)
    else:
        out["time_index_norm"] = 0.0

    return out


def _compute_building_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Building power and long-term peak estimation (paper items 2–5).

    Uses processed grid/building load proxies:
    - building_load_norm ≈ B(T_j): current site load
    - monthly_peak_demand_norm ≈ P̂^max(T_j): running monthly peak estimate
    - peak_demand_mean_7d_norm ≈ μ(B^H): mean of daily peaks over prior 7 days
    - peak_demand_var_7d_norm ≈ σ²(B^H): variance of those daily peaks
    """
    out = df.copy()

    # Current building load from preprocessing (grid + session overlap)
    if "grid_load_norm" in out.columns:
        out["building_load_norm"] = out["grid_load_norm"].fillna(0.0)
    elif "grid_load_ratio" in out.columns:
        out["building_load_norm"] = _safe_minmax(out["grid_load_ratio"])
    else:
        out["building_load_norm"] = 0.0

    out["_date"] = out["arrival_time"].dt.floor("D")
    daily_peak = out.groupby("_date")["building_load_norm"].transform("max")
    out["_daily_peak"] = daily_peak

    # Estimated monthly peak P̂^max — expanding max within calendar month
    out["_month"] = out["arrival_time"].dt.strftime("%Y-%m")
    out["monthly_peak_demand_norm"] = out.groupby("_month")["_daily_peak"].cummax()

    # 7-day historical peak statistics (shifted to avoid lookahead)
    daily = (
        out.groupby("_date")["_daily_peak"]
        .max()
        .reset_index()
        .rename(columns={"_daily_peak": "peak"})
    )
    daily = daily.sort_values("_date")
    daily["peak_mean_7d"] = (
        daily["peak"].rolling(PEAK_HISTORY_DAYS, min_periods=1).mean().shift(1)
    )
    daily["peak_var_7d"] = (
        daily["peak"].rolling(PEAK_HISTORY_DAYS, min_periods=1).var().shift(1)
    )
    out = out.merge(daily[["_date", "peak_mean_7d", "peak_var_7d"]], on="_date", how="left")
    out["peak_demand_mean_7d_norm"] = out["peak_mean_7d"].fillna(out["_daily_peak"])
    out["peak_demand_var_7d_norm"] = out["peak_var_7d"].fillna(0.0)

    out["monthly_peak_demand_norm"] = _safe_minmax(out["monthly_peak_demand_norm"])
    out["peak_demand_mean_7d_norm"] = _safe_minmax(out["peak_demand_mean_7d_norm"])
    out["peak_demand_var_7d_norm"] = _safe_minmax(out["peak_demand_var_7d_norm"])

    return out


def _compute_electricity_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    TOU price signals (paper: time-varying θ_E).

    - tou_price_norm: current slot price
    - rolling_avg_price_norm: short-horizon average for trend context
    """
    out = df.copy()
    if "electricity_price_norm" in out.columns:
        out["tou_price_norm"] = out["electricity_price_norm"].fillna(0.5)
    elif "electricity_price_usd_per_kwh" in out.columns:
        out["tou_price_norm"] = _safe_minmax(out["electricity_price_usd_per_kwh"])
    else:
        out["tou_price_norm"] = 0.5

    out = out.sort_values("arrival_time").reset_index(drop=True)
    out["rolling_avg_price_norm"] = (
        out["tou_price_norm"]
        .rolling(ROLLING_PRICE_SLOTS, min_periods=1)
        .mean()
        .clip(0.0, 1.0)
    )
    return out


def _estimate_initial_soc(row: pd.Series, capacity_kwh: float) -> float:
    """
    Infer SOC^I at plug-in when not observed (common in session-only logs).

    Uses deterministic spread by session id for reproducibility.
    """
    key = str(row.get("session_id", row.name))
    return 0.2 + 0.35 * _station_hash_fraction(key, "initial_soc")


def _compute_ev_features(df: pd.DataFrame, *, capacity_kwh: float) -> pd.DataFrame:
    """
    EV session features (paper items 7–9, per connected vehicle abstraction).

    - ev_arrival_count_norm: |{V : A(V) ≤ T_j}|
    - soc_current_norm: SOC(V, T_j)
    - soc_target_norm: SOC^R(V)
    - remaining_charging_time_norm: τ^R
    - energy_required_norm: KWH^R = (SOC^R - SOC) × CAP
    - charger_occupancy_norm: fraction of active chargers
    """
    out = df.copy().sort_values("arrival_time").reset_index(drop=True)

    out["ev_arrival_count_norm"] = (np.arange(len(out)) + 1) / max(len(out), 1)

    cap = capacity_kwh
    delivered = pd.to_numeric(out.get("kwh_delivered", 0.0), errors="coerce").fillna(0.0)
    requested = pd.to_numeric(out.get("kwh_requested", delivered), errors="coerce").fillna(
        delivered
    )

    initial_soc = out.apply(lambda row: _estimate_initial_soc(row, cap), axis=1)
    out["soc_current_norm"] = (initial_soc + delivered / cap).clip(0.0, 1.0)
    out["soc_target_norm"] = (requested / cap).clip(0.0, 1.0)

    if "time_to_requested_departure_hours" in out.columns:
        rem = pd.to_numeric(out["time_to_requested_departure_hours"], errors="coerce")
        rem = rem.fillna(out.get("plug_duration_hours", rem))
    else:
        rem = out.get("plug_duration_hours", pd.Series(1.0, index=out.index))
    rem = pd.to_numeric(rem, errors="coerce").fillna(1.0)
    out["remaining_charging_time_norm"] = _safe_minmax(rem)

    energy_gap = (requested - delivered).clip(lower=0.0)
    out["energy_required_norm"] = _safe_minmax(energy_gap)

    if "grid_load_ratio" in out.columns:
        out["charger_occupancy_norm"] = out["grid_load_ratio"].clip(0.0, 1.5) / 1.5
    else:
        out["charger_occupancy_norm"] = out.get("building_load_norm", 0.0)

    return out


def _infer_charger_specs(station_id: str) -> tuple[float, float, float]:
    """
    Heterogeneous charger parameters (paper: C_i^min, C_i^max, V2B capability).

    Returns (type_norm, max_power_norm, bidirectional_norm).
    """
    sid = str(station_id)
    h = _station_hash_fraction(sid, "charger")

    # ~70% Level-2 AC, ~30% DC fast in mixed workplace garages
    if h < 0.70:
        charger_type = 0.0  # Level-2
        max_kw = 7.2
        bidirectional = 0.0
    else:
        charger_type = 1.0  # DC fast
        max_kw = 50.0
        bidirectional = 1.0 if h > 0.85 else 0.0

    return (
        charger_type,
        max_kw / MAX_CHARGER_POWER_KW,
        bidirectional,
    )


def _compute_charger_features(df: pd.DataFrame) -> pd.DataFrame:
    """Map station IDs to heterogeneous charger attributes."""
    out = df.copy()
    if "station_id" not in out.columns:
        out["charger_type_norm"] = 0.0
        out["max_charging_power_norm"] = 7.2 / MAX_CHARGER_POWER_KW
        out["bidirectional_capable_norm"] = 0.0
        return out

    specs = out["station_id"].map(lambda s: _infer_charger_specs(s))
    out["charger_type_norm"] = [t[0] for t in specs]
    out["max_charging_power_norm"] = [t[1] for t in specs]
    out["bidirectional_capable_norm"] = [t[2] for t in specs]
    return out


def _compute_renewable_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Solar availability and utilization (V2B-PV coupling).

    - solar_availability_norm: available PV generation fraction
    - renewable_utilization_norm: share of charging met by renewables
    """
    out = df.copy()
    if "solar_availability" in out.columns:
        out["solar_availability_norm"] = out["solar_availability"].fillna(0.0).clip(0.0, 1.0)
    else:
        out["solar_availability_norm"] = 0.0

    delivered = pd.to_numeric(out.get("kwh_delivered", 0.0), errors="coerce").fillna(0.0)
    solar_cap = out["solar_availability_norm"] * 10.0  # ~10 kWh per slot proxy
    util = delivered / solar_cap.replace(0, np.nan)
    out["renewable_utilization_norm"] = util.fillna(0.0).clip(0.0, 1.0)
    return out


def _compute_battery_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Battery degradation and cycle proxies for long-horizon V2B costs.

    - battery_degradation_norm: increases with deep cycles / frequent use
    - charging_cycle_estimate_norm: cumulative usage by station or user
    """
    out = df.copy()
    out = out.sort_values("arrival_time").reset_index(drop=True)

    group_key = "station_id" if "station_id" in out.columns else "session_id"
    cycles = out.groupby(group_key).cumcount() + 1
    out["charging_cycle_estimate_norm"] = _safe_minmax(cycles.astype(float))

    depth = (1.0 - out.get("soc_current_norm", 0.5)).clip(0.0, 1.0)
    freq = out["charging_cycle_estimate_norm"]
    out["battery_degradation_norm"] = _clip_unit(0.4 * depth + 0.6 * freq)

    return out


def enrich_dataset(
    df: pd.DataFrame,
    *,
    time_slots_per_day: int = DEFAULT_TIME_SLOTS_PER_DAY,
    battery_capacity_kwh: float = DEFAULT_BATTERY_CAPACITY_KWH,
) -> pd.DataFrame:
    """Run all feature helpers and attach normalized state columns."""
    out = _parse_timestamps(df)
    out = _compute_temporal_features(out, time_slots_per_day=time_slots_per_day)
    out = _compute_building_features(out)
    out = _compute_electricity_features(out)
    out = _compute_ev_features(out, capacity_kwh=battery_capacity_kwh)
    out = _compute_charger_features(out)
    out = _compute_renewable_features(out)
    out = _compute_battery_features(out)
    return out


# ---------------------------------------------------------------------------
# StateBuilder
# ---------------------------------------------------------------------------


class StateBuilder:
    """
    Build fixed-length normalized state vectors for DDPG-based V2B control.

    Each vector corresponds to one decision context (typically one EV session
    at time slot T_j). Use ``build_state`` for a single observation and
    ``build_state_batch`` for vectorized training data.
    """

    def __init__(
        self,
        dataset_path: Path | str = DEFAULT_DATASET,
        *,
        time_slots_per_day: int = DEFAULT_TIME_SLOTS_PER_DAY,
        battery_capacity_kwh: float = DEFAULT_BATTERY_CAPACITY_KWH,
        auto_load: bool = True,
    ) -> None:
        self.dataset_path = Path(dataset_path)
        self.time_slots_per_day = time_slots_per_day
        self.battery_capacity_kwh = battery_capacity_kwh

        self._raw_df: pd.DataFrame | None = None
        self._feature_df: pd.DataFrame | None = None
        self._norm_bounds: dict[str, tuple[float, float]] = {}

        if auto_load:
            self.load_data()

    def load_data(self) -> pd.DataFrame:
        """Load processed CSV and compute paper-aligned state features."""
        if not self.dataset_path.is_file():
            raise FileNotFoundError(
                f"Processed dataset not found: {self.dataset_path}. "
                "Run: python data/preprocess.py"
            )

        self._raw_df = pd.read_csv(self.dataset_path)
        self._feature_df = enrich_dataset(
            self._raw_df,
            time_slots_per_day=self.time_slots_per_day,
            battery_capacity_kwh=self.battery_capacity_kwh,
        )
        self._feature_df = self.normalize_features(self._feature_df, refit=True)
        logger.info(
            "Loaded %d sessions from %s (state dim=%d)",
            len(self._feature_df),
            self.dataset_path,
            self.get_state_dimension(),
        )
        return self._feature_df

    def normalize_features(
        self,
        df: pd.DataFrame,
        *,
        refit: bool = False,
    ) -> pd.DataFrame:
        """
        Ensure every state feature is in [0, 1] with safe missing-value handling.

        Parameters
        ----------
        df:
            DataFrame containing state feature columns (raw or partially scaled).
        refit:
            If True, recompute min/max bounds from ``df`` and store in ``_norm_bounds``.
        """
        out = df.copy()
        for name in STATE_FEATURE_NAMES:
            if name not in out.columns:
                out[name] = 0.5
                logger.warning("Missing feature column %s; filled with 0.5", name)

            series = pd.to_numeric(out[name], errors="coerce")
            series = series.replace([np.inf, -np.inf], np.nan)
            median = float(series.median()) if series.notna().any() else 0.5
            series = series.fillna(median)

            if refit:
                lo = float(series.min())
                hi = float(series.max())
                self._norm_bounds[name] = (lo, hi)
            else:
                lo, hi = self._norm_bounds.get(name, (float(series.min()), float(series.max())))

            if hi > lo:
                out[name] = ((series - lo) / (hi - lo)).clip(0.0, 1.0)
            else:
                out[name] = 0.5

        return out

    @property
    def feature_df(self) -> pd.DataFrame:
        if self._feature_df is None:
            raise RuntimeError("Data not loaded. Call load_data() first.")
        return self._feature_df

    def get_state_dimension(self) -> int:
        """Fixed state size for DDPG actor/critic input layers."""
        return STATE_DIM

    def get_feature_names(self) -> tuple[str, ...]:
        """Ordered feature names matching the state vector layout."""
        return STATE_FEATURE_NAMES

    def build_state(
        self,
        session_index: int,
        *,
        elapsed_hours: float = 0.0,
    ) -> np.ndarray:
        """
        Construct one normalized state vector s(T_j) for DDPG.

        Parameters
        ----------
        session_index:
            Row index in the loaded feature dataframe.
        elapsed_hours:
            Hours since plug-in; updates SOC and remaining time when > 0.

        Returns
        -------
        np.ndarray
            float32 vector of shape ``(STATE_DIM,)`` with values in [0, 1].
        """
        df = self.feature_df
        if session_index < 0 or session_index >= len(df):
            raise IndexError(f"session_index {session_index} out of range [0, {len(df)})")

        row = df.iloc[session_index].copy()
        state = {name: float(row[name]) for name in STATE_FEATURE_NAMES}

        if elapsed_hours > 0.0:
            state = self._apply_elapsed_time(state, row, elapsed_hours)

        vec = np.array([state[name] for name in STATE_FEATURE_NAMES], dtype=np.float32)
        return _clip_unit(vec).astype(np.float32)

    def build_state_batch(self, session_indices: np.ndarray | list[int]) -> np.ndarray:
        """Vectorized state construction for replay buffers or batch critics."""
        return np.stack([self.build_state(int(i)) for i in session_indices], axis=0)

    def build_state_for_session_id(self, session_id: str) -> np.ndarray:
        """Lookup state by ACN session_id instead of row index."""
        df = self.feature_df
        if "session_id" not in df.columns:
            raise KeyError("session_id column not present in dataset")
        matches = df.index[df["session_id"] == session_id].tolist()
        if not matches:
            raise KeyError(f"session_id not found: {session_id}")
        return self.build_state(matches[0])

    def _apply_elapsed_time(
        self,
        state: dict[str, float],
        row: pd.Series,
        elapsed_hours: float,
    ) -> dict[str, float]:
        """
        Adjust SOC and remaining time along Eq. (1) after elapsed charging.

        SOC(T_j+1) = SOC(T_j) + P·δ/CAP — here we approximate with mean power.
        """
        cap = self.battery_capacity_kwh
        max_kw = float(row.get("max_charging_power_norm", 0.2)) * MAX_CHARGER_POWER_KW
        delta_kwh = max_kw * elapsed_hours * 0.8  # 80% average utilization

        state["soc_current_norm"] = float(
            _clip_unit(state["soc_current_norm"] + delta_kwh / cap)
        )
        rem_hours = float(row.get("remaining_charging_time_norm", 0.5)) * float(
            row.get("plug_duration_hours", 4.0) if "plug_duration_hours" in row else 4.0
        )
        new_rem = max(rem_hours - elapsed_hours, 0.0)
        max_plug = float(self.feature_df["plug_duration_hours"].max()) if "plug_duration_hours" in self.feature_df.columns else 10.0
        state["remaining_charging_time_norm"] = float(_clip_unit(new_rem / max(max_plug, 1e-6)))

        gap = (1.0 - state["soc_current_norm"]) * cap
        state["energy_required_norm"] = float(_clip_unit(gap / cap))
        return state

    def summary(self) -> dict[str, Any]:
        """Diagnostics for logging and environment registration."""
        return {
            "dataset_path": str(self.dataset_path),
            "num_sessions": len(self.feature_df),
            "state_dim": self.get_state_dimension(),
            "feature_names": list(STATE_FEATURE_NAMES),
            "time_slots_per_day": self.time_slots_per_day,
            "battery_capacity_kwh": self.battery_capacity_kwh,
        }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    builder = StateBuilder()
    print(builder.summary())
    sample = builder.build_state(0)
    print("sample state shape:", sample.shape)
    print("sample state:", np.round(sample, 4))


if __name__ == "__main__":
    main()
