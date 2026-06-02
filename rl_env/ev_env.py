"""
Gymnasium environment for V2B DDPG charging (arXiv:2502.18526).

Integrates:
  - ``state_builder`` — fixed-length normalized observations
  - ``action_mask``   — Algorithm 1 feasible continuous actions
  - ``reward``        — long-term λ-weighted reward

Each step (time slot T_j):
  1. Receive DDPG action → 2. Mask → 3. Update SOC → 4. Building load
  → 5. Peak demand → 6. Departures → 7. Arrivals → 8. Reward → 9. Next state
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
import pandas as pd
from gymnasium import spaces

from rl_env.action_mask import (
    DEFAULT_C_MAX_DC_KW,
    DEFAULT_C_MAX_L2_KW,
    DEFAULT_C_MIN_DISCHARGE_KW,
    DEFAULT_DELTA_HOURS,
    DEFAULT_SOC_MIN,
    ActionMask,
    V2BMaskContext,
    scale_tanh_to_power,
    tanh_action_space,
)
from rl_env.reward import (
    DEFAULT_THETA_ENERGY,
    RewardFunction,
    RewardWeights,
    V2BRewardContext,
)
from rl_env.state_builder import (
    DEFAULT_BATTERY_CAPACITY_KWH,
    DEFAULT_TIME_SLOTS_PER_DAY,
    STATE_DIM,
    STATE_FEATURE_NAMES,
    StateBuilder,
)

logger = logging.getLogger(__name__)

DEFAULT_DATASET = Path(__file__).resolve().parents[1] / "data" / "processed_ev_data.csv"

# TOU price tiers (USD/kWh) — aligned with preprocess.py
PRICE_OFF_PEAK = 0.12
PRICE_MID = 0.22
PRICE_PEAK = 0.38

# Site capacity defaults (Caltech-scale garage)
DEFAULT_NUM_CHARGERS = 8
DEFAULT_EPISODE_SLOTS = 24
DEFAULT_BUILDING_BASE_LOAD_KW = 80.0
DEFAULT_PEAK_REFERENCE_KW = 150.0


# ---------------------------------------------------------------------------
# Internal simulation types
# ---------------------------------------------------------------------------


@dataclass
class ChargerSpec:
    """Heterogeneous EVSE at the building."""

    index: int
    c_max_kw: float
    c_min_kw: float
    bidirectional: bool
    charger_type_norm: float  # 0 = L2, 1 = DC
    cycle_count: int = 0
    session_id: str | None = None  # dataset session_id when occupied


@dataclass
class ActiveEV:
    """EV session occupying a charger (φ(C_i, T_j) = V)."""

    charger_index: int
    dataset_index: int
    session_id: str
    soc: float
    soc_target: float
    cap_kwh: float
    kwh_requested: float
    arrival_slot: int
    departure_slot: int
    degradation: float = 0.0


@dataclass
class ScheduledArrival:
    """EV waiting to be assigned to a free charger."""

    dataset_index: int
    session_id: str
    soc_initial: float
    soc_target: float
    cap_kwh: float
    kwh_requested: float
    departure_slot: int


@dataclass
class V2BEnvConfig:
    """Configurable parameters for vectorized / multi-seed training."""

    num_chargers: int = DEFAULT_NUM_CHARGERS
    episode_slots: int = DEFAULT_EPISODE_SLOTS
    delta_hours: float = DEFAULT_DELTA_HOURS
    time_slots_per_day: int = DEFAULT_TIME_SLOTS_PER_DAY
    battery_capacity_kwh: float = DEFAULT_BATTERY_CAPACITY_KWH
    building_base_load_kw: float = DEFAULT_BUILDING_BASE_LOAD_KW
    peak_reference_kw: float = DEFAULT_PEAK_REFERENCE_KW
    dataset_path: Path | str = DEFAULT_DATASET
    use_tanh_actions: bool = True
    dc_charger_fraction: float = 0.3
    max_arrivals_per_slot: int = 4
    randomize_episode_start: bool = True
    seed: int | None = None


# ---------------------------------------------------------------------------
# V2B Gymnasium environment
# ---------------------------------------------------------------------------


class V2BChargingEnv(gym.Env):
    """
    Continuous-action V2B charging environment for DDPG.

    Observation: normalized vector from ``StateBuilder`` layout (dim=23).
    Action: per-charger power in [-1, 1] (tanh) or [C^min, C^max] kW.
    """

    metadata = {"render_modes": ["human"], "render_fps": 4}

    def __init__(self, config: V2BEnvConfig | None = None) -> None:
        super().__init__()
        self.cfg = config or V2BEnvConfig()
        self._rng = np.random.default_rng(self.cfg.seed)

        self.state_builder = StateBuilder(
            self.cfg.dataset_path,
            time_slots_per_day=self.cfg.time_slots_per_day,
            battery_capacity_kwh=self.cfg.battery_capacity_kwh,
            auto_load=True,
        )
        self.action_mask = ActionMask(delta_hours=self.cfg.delta_hours)
        self.reward_fn = RewardFunction()

        self._chargers = self._init_chargers()
        self._setup_spaces()

        # Episode dynamics
        self._slot: int = 0
        self._episode_start: pd.Timestamp | None = None
        self._active: dict[int, ActiveEV] = {}
        self._arrival_queue: dict[int, list[ScheduledArrival]] = {}
        self._departed_count: int = 0
        self._arrival_count: int = 0
        self._building_load_kw: float = self.cfg.building_base_load_kw
        self._estimated_peak_kw: float = self.cfg.building_base_load_kw
        self._peak_history_7d: list[float] = []
        self._price_history: list[float] = []
        self._cumulative_energy_cost: float = 0.0
        self._renewable_energy_kwh: float = 0.0
        self._total_charge_kwh: float = 0.0
        self._schedule_built: bool = False
        self._episode_hour_offset: float = 0.0
        self._net_power_kw: float = 0.0
        self._last_ev_power: np.ndarray | None = None

    def _init_chargers(self) -> list[ChargerSpec]:
        chargers: list[ChargerSpec] = []
        for i in range(self.cfg.num_chargers):
            is_dc = self._rng.random() < self.cfg.dc_charger_fraction
            if is_dc:
                chargers.append(
                    ChargerSpec(
                        index=i,
                        c_max_kw=DEFAULT_C_MAX_DC_KW,
                        c_min_kw=DEFAULT_C_MIN_DISCHARGE_KW,
                        bidirectional=True,
                        charger_type_norm=1.0,
                    )
                )
            else:
                chargers.append(
                    ChargerSpec(
                        index=i,
                        c_max_kw=DEFAULT_C_MAX_L2_KW,
                        c_min_kw=0.0,
                        bidirectional=False,
                        charger_type_norm=0.0,
                    )
                )
        return chargers

    def _setup_spaces(self) -> None:
        n = self.cfg.num_chargers
        if self.cfg.use_tanh_actions:
            self.action_space = tanh_action_space(n)
        else:
            c_min = np.array([c.c_min_kw for c in self._chargers], dtype=np.float32)
            c_max = np.array([c.c_max_kw for c in self._chargers], dtype=np.float32)
            self.action_space = spaces.Box(low=c_min, high=c_max, dtype=np.float32)

        self.observation_space = spaces.Box(
            low=0.0,
            high=1.0,
            shape=(STATE_DIM,),
            dtype=np.float32,
        )

    # ------------------------------------------------------------------
    # Gym API
    # ------------------------------------------------------------------

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        if seed is not None:
            self._rng = np.random.default_rng(seed)

        opts = options or {}
        self._slot = 0
        self._active.clear()
        self._arrival_queue.clear()
        self._departed_count = 0
        self._arrival_count = 0
        self._building_load_kw = self.cfg.building_base_load_kw
        self._estimated_peak_kw = max(
            float(opts.get("initial_peak_kw", self.cfg.building_base_load_kw)),
            self.cfg.building_base_load_kw,
        )
        self._peak_history_7d = [self._building_load_kw]
        self._price_history = []
        self._cumulative_energy_cost = 0.0
        self._renewable_energy_kwh = 0.0
        self._total_charge_kwh = 0.0

        for ch in self._chargers:
            ch.session_id = None
            ch.cycle_count = 0

        self._build_arrival_schedule(opts)
        self._process_arrivals()

        obs = self._build_observation()
        info = self._build_info(reward_breakdown=None)
        return obs, info

    def step(
        self,
        action: np.ndarray,
    ) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        """
        One MDP transition T_j → T_{j+1}.

        Returns (observation, reward, terminated, truncated, info).
        """
        # 1) DDPG action → physical power
        raw_action = np.asarray(action, dtype=np.float32).reshape(self.cfg.num_chargers)
        mask_ctx = self._build_mask_context()
        if self.cfg.use_tanh_actions:
            masked_kw = self.action_mask.apply_masks_tanh(raw_action, mask_ctx)
        else:
            masked_kw = self.action_mask.apply_masks(raw_action.astype(np.float64), mask_ctx)

        # 2–3) SOC update (Eq. 1): SOC += P·δ / CAP
        self._update_soc(masked_kw)

        # 4–5) Building load & monthly peak estimate (paper state transition)
        ev_power = float(np.sum(masked_kw))
        self._update_building_load(ev_power)
        self._update_peak_demand(ev_power)

        # 6–7) Departures then arrivals (charger assignment η)
        self._process_departures()
        self._process_arrivals()

        # 8) Reward on masked actions
        reward_ctx = self._build_reward_context(masked_kw, terminal=False)
        reward, breakdown = self.reward_fn.compute_reward(reward_ctx)

        # Track electricity cost for info
        price = self._tou_price_usd()
        energy_kwh = ev_power * self.cfg.delta_hours
        self._cumulative_energy_cost += max(energy_kwh, 0.0) * price
        solar = self._solar_availability()
        self._total_charge_kwh += float(np.sum(np.maximum(masked_kw, 0.0)) * self.cfg.delta_hours)
        self._renewable_energy_kwh += solar * self._total_charge_kwh * 0.01  # running approx

        self._slot += 1
        terminated = self._slot >= self.cfg.episode_slots
        truncated = False

        if terminated:
            self._process_departures(force_all=True)
            terminal_ctx = self._build_reward_context(masked_kw, terminal=True)
            terminal_reward, terminal_bd = self.reward_fn.compute_reward(terminal_ctx)
            reward += terminal_reward * 0.5
            breakdown = terminal_bd

        obs = self._build_observation()
        info = self._build_info(
            reward_breakdown=breakdown,
            raw_action=raw_action,
            masked_action=masked_kw,
        )
        return obs, float(reward), terminated, truncated, info

    def render(self) -> None:
        if self._episode_start is None:
            return
        occ = sum(1 for c in self._chargers if c.session_id is not None)
        print(
            f"[V2B] slot={self._slot}/{self.cfg.episode_slots} "
            f"active_EVs={len(self._active)} occupancy={occ}/{self.cfg.num_chargers} "
            f"B={self._building_load_kw:.1f}kW P_hat={self._estimated_peak_kw:.1f}kW "
            f"peak_net={self._net_power_kw:.1f}"
        )

    def close(self) -> None:
        pass

    # ------------------------------------------------------------------
    # Dynamics helpers (paper state transition)
    # ------------------------------------------------------------------

    def _update_soc(self, power_kw: np.ndarray) -> None:
        """
        Update connected EV state of charge (paper Eq. 1).

            SOC(V, T_{j+1}) = SOC(V, T_j) + P(η(V), T_j) · δ / CAP(V)
        """
        delta = self.cfg.delta_hours
        for idx, ev in list(self._active.items()):
            p = float(power_kw[idx])
            ev.soc += p * delta / ev.cap_kwh
            ev.soc = float(np.clip(ev.soc, DEFAULT_SOC_MIN, 1.05))

            # Degradation proxy: deep cycles and high C-rate
            c_rate = abs(p) / self._chargers[idx].c_max_kw
            ev.degradation = float(np.clip(ev.degradation + 0.001 * c_rate, 0.0, 1.0))
            if p < 0 and ev.soc < DEFAULT_SOC_MIN + 0.05:
                ev.degradation += 0.002

        self._last_ev_power = power_kw

    def _update_building_load(self, ev_power_kw: float) -> None:
        """
        Update exogenous building load B(T_j) and total meter power.

        Base load follows a weekday + hour profile; EV actions add on top for peak tracking.
        """
        hour = (self._slot % self.cfg.time_slots_per_day) + self._episode_hour_offset
        # Office building profile: higher mid-day
        profile = 0.7 + 0.3 * np.sin(np.pi * (hour - 6) / 12) ** 2
        noise = float(self._rng.normal(0.0, 2.0))
        self._building_load_kw = max(
            20.0,
            self.cfg.building_base_load_kw * profile + noise,
        )
        self._net_power_kw = self._building_load_kw + ev_power_kw

    def _update_peak_demand(self, ev_power_kw: float) -> None:
        """
        Update P̂^max(T_j) = max(P̂^max(T_{j-1}), B + Σ P) (paper Section 4.1).
        """
        net = self._building_load_kw + ev_power_kw
        self._estimated_peak_kw = max(self._estimated_peak_kw, net)

        # Daily peak history for 7-day mean/var features in observation
        if self._slot > 0 and self._slot % self.cfg.time_slots_per_day == 0:
            self._peak_history_7d.append(self._estimated_peak_kw)
            self._peak_history_7d = self._peak_history_7d[-7:]

    def _process_departures(self, *, force_all: bool = False) -> None:
        """Release chargers whose EVs depart at or before current slot T_j."""
        to_remove: list[int] = []
        for idx, ev in self._active.items():
            if force_all or self._slot >= ev.departure_slot:
                self._chargers[idx].session_id = None
                self._departed_count += 1
                to_remove.append(idx)

        for idx in to_remove:
            del self._active[idx]

    def _process_arrivals(self) -> None:
        """
        Assign arriving EVs to idle chargers (greedy η assignment, paper Section 3).

        Processes the queue for the current time slot up to ``max_arrivals_per_slot``.
        """
        queue = self._arrival_queue.get(self._slot, [])
        assigned = 0
        for arrival in queue:
            if assigned >= self.cfg.max_arrivals_per_slot:
                break
            free = [c.index for c in self._chargers if c.session_id is None]
            if not free:
                break
            ch_idx = int(free[0])
            self._assign_ev_to_charger(ch_idx, arrival)
            assigned += 1
            self._arrival_count += 1

    def _assign_ev_to_charger(self, ch_idx: int, arrival: ScheduledArrival) -> None:
        self._chargers[ch_idx].session_id = arrival.session_id
        self._chargers[ch_idx].cycle_count += 1
        dep_slot = max(arrival.departure_slot, self._slot + 1)
        self._active[ch_idx] = ActiveEV(
            charger_index=ch_idx,
            dataset_index=arrival.dataset_index,
            session_id=arrival.session_id,
            soc=arrival.soc_initial,
            soc_target=arrival.soc_target,
            cap_kwh=arrival.cap_kwh,
            kwh_requested=arrival.kwh_requested,
            arrival_slot=self._slot,
            departure_slot=dep_slot,
        )

    # ------------------------------------------------------------------
    # Schedule from processed dataset
    # ------------------------------------------------------------------

    def _build_arrival_schedule(self, options: dict[str, Any]) -> None:
        """Map ACN sessions in the episode window to discrete arrival slots."""
        df = self.state_builder.feature_df.copy()
        df["arrival_time"] = pd.to_datetime(df["arrival_time"], utc=True)

        if options.get("episode_start") is not None:
            self._episode_start = pd.Timestamp(options["episode_start"], tz="UTC")
        elif self.cfg.randomize_episode_start and len(df) > 0:
            row = df.iloc[int(self._rng.integers(0, len(df)))]
            self._episode_start = row["arrival_time"]
        else:
            self._episode_start = df["arrival_time"].min()

        horizon_h = self.cfg.episode_slots * self.cfg.delta_hours
        episode_end = self._episode_start + pd.Timedelta(hours=horizon_h)

        mask = (df["arrival_time"] >= self._episode_start) & (df["arrival_time"] < episode_end)
        episode_df = df.loc[mask].sort_values("arrival_time")

        self._arrival_queue = {}
        for dataset_index, row in episode_df.iterrows():
            arr_ts = row["arrival_time"]
            dep_ts = pd.to_datetime(row["departure_time"], utc=True)
            offset_h = (arr_ts - self._episode_start).total_seconds() / 3600.0
            arr_slot = int(offset_h / self.cfg.delta_hours)
            arr_slot = int(np.clip(arr_slot, 0, self.cfg.episode_slots - 1))
            dep_offset_h = (dep_ts - self._episode_start).total_seconds() / 3600.0
            dep_slot = int(np.ceil(dep_offset_h / self.cfg.delta_hours))
            dep_slot = int(np.clip(dep_slot, arr_slot + 1, self.cfg.episode_slots))

            cap = float(row.get("kwh_requested", self.cfg.battery_capacity_kwh * 0.8) or 40.0)
            cap = max(cap, 10.0)
            soc_tgt = min(float(row.get("kwh_requested", cap)) / self.cfg.battery_capacity_kwh, 1.0)
            soc_init = float(0.2 + 0.3 * self._rng.random())

            arrival = ScheduledArrival(
                dataset_index=int(dataset_index),
                session_id=str(row.get("session_id", f"sess_{dataset_index}")),
                soc_initial=soc_init,
                soc_target=float(np.clip(soc_tgt, 0.5, 1.0)),
                cap_kwh=self.cfg.battery_capacity_kwh,
                kwh_requested=float(row.get("kwh_requested", cap * soc_tgt)),
                departure_slot=dep_slot,
            )
            self._arrival_queue.setdefault(arr_slot, []).append(arrival)

        self._episode_hour_offset = float(
            (self._episode_start.hour if self._episode_start else 0) % 24
        )
        self._schedule_built = True

    # ------------------------------------------------------------------
    # TOU / solar
    # ------------------------------------------------------------------

    def _tou_price_usd(self) -> float:
        """Time-of-use θ_E(T_j) from local hour."""
        hour = (self._slot + int(self._episode_hour_offset)) % 24
        if 16 <= hour < 21:
            price = PRICE_PEAK
        elif hour >= 23 or hour < 6:
            price = PRICE_OFF_PEAK
        else:
            price = PRICE_MID
        self._price_history.append(price)
        self._price_history = self._price_history[-24:]
        return price

    def _solar_availability(self) -> float:
        hour = (self._slot + int(self._episode_hour_offset)) % 24
        if 6 <= hour <= 20:
            phase = (hour - 6) / 14.0 * np.pi
            return float(np.clip(np.sin(phase), 0.0, 1.0))
        return 0.0

    # ------------------------------------------------------------------
    # Context builders for mask / reward
    # ------------------------------------------------------------------

    def _kwh_required_vec(self) -> np.ndarray:
        n = self.cfg.num_chargers
        out = np.zeros(n, dtype=np.float64)
        for idx, ev in self._active.items():
            gap = (ev.soc_target - ev.soc) * ev.cap_kwh
            out[idx] = max(gap, 0.0)
        return out

    def _tau_remaining_vec(self) -> np.ndarray:
        n = self.cfg.num_chargers
        out = np.zeros(n, dtype=np.float64)
        for idx, ev in self._active.items():
            out[idx] = max(ev.departure_slot - self._slot, 0)
        return out

    def _soc_vecs(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        n = self.cfg.num_chargers
        soc = np.full(n, 0.5, dtype=np.float64)
        tgt = np.full(n, 0.9, dtype=np.float64)
        cap = np.full(n, self.cfg.battery_capacity_kwh, dtype=np.float64)
        for idx, ev in self._active.items():
            soc[idx] = ev.soc
            tgt[idx] = ev.soc_target
            cap[idx] = ev.cap_kwh
        return soc, tgt, cap

    def _build_mask_context(self) -> V2BMaskContext:
        n = self.cfg.num_chargers
        uni = [c.index for c in self._chargers if not c.bidirectional]
        bi = [c.index for c in self._chargers if c.bidirectional]
        soc, tgt, cap = self._soc_vecs()
        connected = np.array([c.session_id is not None for c in self._chargers])

        return V2BMaskContext(
            kwh_required=self._kwh_required_vec(),
            tau_remaining=self._tau_remaining_vec(),
            c_max=np.array([c.c_max_kw for c in self._chargers]),
            c_min=np.array([c.c_min_kw for c in self._chargers]),
            connected=connected,
            uni_idx=np.asarray(uni, dtype=int),
            bi_idx=np.asarray(bi, dtype=int),
            building_power=self._building_load_kw,
            estimated_peak_power=self._estimated_peak_kw,
            soc_current=soc,
            soc_target=tgt,
            soc_min=np.full(n, DEFAULT_SOC_MIN),
            battery_capacity_kwh=cap,
            delta_hours=self.cfg.delta_hours,
        )

    def _build_reward_context(
        self,
        masked_kw: np.ndarray,
        *,
        terminal: bool,
    ) -> V2BRewardContext:
        soc, tgt, cap = self._soc_vecs()
        solar = self._solar_availability()
        charge_kwh = float(np.sum(np.maximum(masked_kw, 0.0)) * self.cfg.delta_hours)
        renew_util = (
            (solar * charge_kwh) / max(charge_kwh, 1e-6) if charge_kwh > 0 else 0.0
        )
        deg = float(np.mean([ev.degradation for ev in self._active.values()]) if self._active else 0.0)

        return V2BRewardContext(
            action_kw=masked_kw,
            kwh_required=self._kwh_required_vec(),
            connected=np.array([c.session_id is not None for c in self._chargers]),
            building_power_kw=self._building_load_kw,
            estimated_peak_power_kw=self._estimated_peak_kw,
            electricity_price=self._tou_price_usd(),
            delta_hours=self.cfg.delta_hours,
            soc_current=soc,
            soc_target=tgt,
            battery_capacity_kwh=cap,
            c_max=np.array([c.c_max_kw for c in self._chargers]),
            tau_remaining_slots=self._tau_remaining_vec(),
            solar_availability=solar,
            renewable_utilization=float(np.clip(renew_util, 0.0, 1.0)),
            battery_degradation=deg,
            is_terminal_step=terminal,
        )

    # ------------------------------------------------------------------
    # Observation (StateBuilder-compatible 23-dim vector)
    # ------------------------------------------------------------------

    def _build_observation(self) -> np.ndarray:
        """
        Site-level normalized state s(T_j) aligned with ``STATE_FEATURE_NAMES``.

        Aggregates active sessions for multi-charger DDPG.
        """
        n = self.cfg.num_chargers
        peak_ref = max(self.cfg.peak_reference_kw, 1.0)
        slot = self._slot % self.cfg.time_slots_per_day
        hour = (slot + int(self._episode_hour_offset)) % 24

        occ = sum(1 for c in self._chargers if c.session_id is not None)
        occ_norm = occ / n

        if self._active:
            soc_mean = float(np.mean([ev.soc for ev in self._active.values()]))
            tgt_mean = float(np.mean([ev.soc_target for ev in self._active.values()]))
            rem_mean = float(np.mean([max(ev.departure_slot - self._slot, 0) for ev in self._active.values()]))
            rem_norm = rem_mean / max(self.cfg.episode_slots, 1)
            e_req = float(np.mean([max((ev.soc_target - ev.soc) * ev.cap_kwh, 0.0) for ev in self._active.values()]))
            e_req_norm = e_req / self.cfg.battery_capacity_kwh
            deg_mean = float(np.mean([ev.degradation for ev in self._active.values()]))
        else:
            soc_mean, tgt_mean, rem_norm, e_req_norm, deg_mean = 0.5, 0.9, 1.0, 0.0, 0.0

        hist = self._peak_history_7d
        peak_mean_7d = float(np.mean(hist)) if hist else self._building_load_kw
        peak_var_7d = float(np.var(hist)) if len(hist) > 1 else 0.0

        price = self._tou_price_usd()
        price_norm = (price - PRICE_OFF_PEAK) / (PRICE_PEAK - PRICE_OFF_PEAK)
        roll_price = float(np.mean(self._price_history[-6:])) if self._price_history else price
        roll_norm = (roll_price - PRICE_OFF_PEAK) / (PRICE_PEAK - PRICE_OFF_PEAK)

        solar = self._solar_availability()
        renew_util = (
            self._renewable_energy_kwh / max(self._total_charge_kwh, 1e-6)
            if self._total_charge_kwh > 0
            else 0.0
        )

        charger_type_mean = float(np.mean([c.charger_type_norm for c in self._chargers]))
        max_pwr_norm = float(np.mean([c.c_max_kw for c in self._chargers]) / DEFAULT_C_MAX_DC_KW)
        bi_frac = sum(1 for c in self._chargers if c.bidirectional) / n
        cycle_norm = float(np.mean([c.cycle_count for c in self._chargers]) / max(self._arrival_count + 1, 1))

        vec = {
            "time_slot_norm": slot / max(self.cfg.time_slots_per_day - 1, 1),
            "hour_of_day_norm": hour / 24.0,
            "weekday_norm": (self._episode_start.dayofweek / 6.0) if self._episode_start is not None else 0.0,
            "time_index_norm": self._slot / max(self.cfg.episode_slots - 1, 1),
            "building_load_norm": np.clip(self._building_load_kw / peak_ref, 0.0, 1.5) / 1.5,
            "monthly_peak_demand_norm": np.clip(self._estimated_peak_kw / peak_ref, 0.0, 1.5) / 1.5,
            "peak_demand_mean_7d_norm": np.clip(peak_mean_7d / peak_ref, 0.0, 1.0),
            "peak_demand_var_7d_norm": np.clip(peak_var_7d / (peak_ref ** 2), 0.0, 1.0),
            "tou_price_norm": np.clip(price_norm, 0.0, 1.0),
            "rolling_avg_price_norm": np.clip(roll_norm, 0.0, 1.0),
            "ev_arrival_count_norm": np.clip(self._arrival_count / max(len(self.state_builder.feature_df), 1), 0.0, 1.0),
            "soc_current_norm": np.clip(soc_mean, 0.0, 1.0),
            "soc_target_norm": np.clip(tgt_mean, 0.0, 1.0),
            "remaining_charging_time_norm": np.clip(rem_norm, 0.0, 1.0),
            "energy_required_norm": np.clip(e_req_norm, 0.0, 1.0),
            "charger_occupancy_norm": occ_norm,
            "charger_type_norm": charger_type_mean,
            "max_charging_power_norm": max_pwr_norm,
            "bidirectional_capable_norm": bi_frac,
            "solar_availability_norm": solar,
            "renewable_utilization_norm": np.clip(renew_util, 0.0, 1.0),
            "battery_degradation_norm": np.clip(deg_mean, 0.0, 1.0),
            "charging_cycle_estimate_norm": np.clip(cycle_norm, 0.0, 1.0),
        }

        return np.array([vec[name] for name in STATE_FEATURE_NAMES], dtype=np.float32)

    def _build_info(
        self,
        *,
        reward_breakdown: dict[str, Any] | None,
        raw_action: np.ndarray | None = None,
        masked_action: np.ndarray | None = None,
    ) -> dict[str, Any]:
        """Gymnasium info dict for logging and downstream mask/reward modules."""
        soc, tgt, _ = self._soc_vecs()
        connected = [c.session_id is not None for c in self._chargers]
        uni = [c.index for c in self._chargers if not c.bidirectional]
        bi = [c.index for c in self._chargers if c.bidirectional]

        info: dict[str, Any] = {
            "slot": self._slot,
            "num_chargers": self.cfg.num_chargers,
            "electricity_cost_cumulative_usd": self._cumulative_energy_cost,
            "electricity_price_usd_per_kwh": self._tou_price_usd(),
            "building_load_kw": self._building_load_kw,
            "estimated_peak_power_kw": self._estimated_peak_kw,
            "net_power_kw": getattr(self, "_net_power_kw", self._building_load_kw),
            "peak_demand": self._estimated_peak_kw,
            "soc_statistics": {
                "mean": float(np.mean(soc[connected])) if any(connected) else None,
                "min": float(np.min(soc[connected])) if any(connected) else None,
                "max": float(np.max(soc[connected])) if any(connected) else None,
                "targets": tgt.tolist(),
            },
            "renewable_utilization": (
                self._renewable_energy_kwh / max(self._total_charge_kwh, 1e-6)
            ),
            "solar_availability": self._solar_availability(),
            "battery_degradation": float(
                np.mean([ev.degradation for ev in self._active.values()]) if self._active else 0.0
            ),
            "active_sessions": len(self._active),
            "arrival_count": self._arrival_count,
            "departed_count": self._departed_count,
            # Keys for action_mask / reward V2B contexts
            "kwh_required": self._kwh_required_vec().tolist(),
            "tau_remaining_slots": self._tau_remaining_vec().tolist(),
            "c_max": [c.c_max_kw for c in self._chargers],
            "c_min": [c.c_min_kw for c in self._chargers],
            "connected": connected,
            "uni_idx": uni,
            "bi_idx": bi,
            "soc_current": soc.tolist(),
            "soc_target": tgt.tolist(),
            "battery_capacity_kwh": [self.cfg.battery_capacity_kwh] * self.cfg.num_chargers,
            "building_power_kw": self._building_load_kw,
            "delta_hours": self.cfg.delta_hours,
        }

        if reward_breakdown is not None:
            info["reward_breakdown"] = reward_breakdown
            info["reward"] = reward_breakdown.get("total", 0.0)

        if raw_action is not None:
            info["raw_action"] = raw_action.tolist()
        if masked_action is not None:
            info["masked_action"] = masked_action.tolist()

        return info


# ---------------------------------------------------------------------------
# Vectorized / factory helpers for DDPG training
# ---------------------------------------------------------------------------


def make_v2b_env(
    config: V2BEnvConfig | None = None,
    **kwargs: Any,
) -> V2BChargingEnv:
    """Factory for Gymnasium registration or SB3-style ``make_env``."""
    if config is None:
        config = V2BEnvConfig(**{k: v for k, v in kwargs.items() if hasattr(V2BEnvConfig, k)})
    else:
        for key, val in kwargs.items():
            if hasattr(config, key):
                setattr(config, key, val)
    return V2BChargingEnv(config)


def make_vectorized_configs(
    n_envs: int,
    *,
    base_seed: int = 0,
    **kwargs: Any,
) -> list[V2BEnvConfig]:
    """Build distinct seeds for async / subprocess vector envs."""
    return [
        V2BEnvConfig(seed=base_seed + i, **kwargs)
        for i in range(n_envs)
    ]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    env = make_v2b_env(num_chargers=4, episode_slots=12, seed=42)
    obs, info = env.reset()
    print("obs shape:", obs.shape, "state dim:", STATE_DIM)
    total_r = 0.0
    for _ in range(5):
        action = env.action_space.sample()
        obs, reward, term, trunc, info = env.step(action)
        total_r += reward
        if term or trunc:
            break
    print("steps:", info["slot"], "total_reward:", round(total_r, 4))
    print("peak_demand:", info["estimated_peak_power_kw"])
    env.render()
    env.close()


if __name__ == "__main__":
    main()
