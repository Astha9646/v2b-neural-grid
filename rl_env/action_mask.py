"""
Action masking for V2B DDPG charging (Algorithm 1, arXiv:2502.18526).

Refines continuous charger power actions ``A(T_j) = [P(C_i, T_j)]`` into feasible
``A'`` using six domain-knowledge masks:

  1. No-EV mask
  2. Overcharge prevention (unidirectional chargers)
  3. Urgent charging (minimum power before departure)
  4. V2B discharge (bidirectional only, SOC floor)
  5. Peak-demand optimization (headroom below estimated monthly peak)
  6. Building protection (discharge cannot exceed building load — Constraint 5)

Positive power = charging; negative power = V2B discharge to the building.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

try:
    import gymnasium as gym
except ImportError:  # pragma: no cover
    gym = None  # type: ignore

logger = logging.getLogger(__name__)

# Numerical stability (Algorithm 1, line 1)
DEFAULT_EPSILON = 1e-5

# Default slot duration δ (hours); paper uses hourly bins (24 slots/day)
DEFAULT_DELTA_HOURS = 1.0

# Minimum SoC fraction — Constraint (3), SOC >= SOC^min
DEFAULT_SOC_MIN = 0.10

# Level-2 / DC fast power bounds (kW) when not specified per charger
DEFAULT_C_MAX_L2_KW = 7.2
DEFAULT_C_MAX_DC_KW = 50.0
DEFAULT_C_MIN_DISCHARGE_KW = -50.0  # max V2B export (negative)


# ---------------------------------------------------------------------------
# Context container (per time slot T_j, all chargers)
# ---------------------------------------------------------------------------


@dataclass
class V2BMaskContext:
    """
    Physical quantities for Mask(S(T_j), A(T_j)) at one decision step.

    Arrays are length ``num_chargers`` (one entry per heterogeneous charger C_i).
    """

    kwh_required: np.ndarray  # KWH^R(C_i, T_j): energy to reach SOC^R [kWh]
    tau_remaining: np.ndarray  # τ^R: remaining time until departure [slots]
    c_max: np.ndarray  # C^max_i: max charging power [kW]
    c_min: np.ndarray  # C^min_i: max discharge power [kW], negative
    connected: np.ndarray  # True if EV plugged in (τ^R > 0)
    uni_idx: np.ndarray  # indices of unidirectional chargers
    bi_idx: np.ndarray  # indices of bidirectional (V2B) chargers
    building_power: float  # B(T_j): non-EV building load [kW]
    estimated_peak_power: float  # P̂^max(T_j): running peak estimate [kW]
    soc_current: np.ndarray  # SOC(V, T_j) in [0, 1]
    soc_target: np.ndarray  # SOC^R(V) in [0, 1]
    soc_min: np.ndarray  # SOC^min(V) in [0, 1]
    battery_capacity_kwh: np.ndarray  # CAP(V) [kWh]
    delta_hours: float = DEFAULT_DELTA_HOURS

    @property
    def num_chargers(self) -> int:
        return int(self.kwh_required.shape[0])

    @classmethod
    def from_gym(
        cls,
        info: dict[str, Any],
        *,
        num_chargers: int | None = None,
        delta_hours: float = DEFAULT_DELTA_HOURS,
        default_soc_min: float = DEFAULT_SOC_MIN,
    ) -> V2BMaskContext:
        """
        Build context from a Gymnasium ``info`` dict (set by ``ev_env``).

        Expected keys (arrays length ``num_chargers`` unless noted):
        ``kwh_required``, ``tau_remaining_slots``, ``c_max``, ``c_min``,
        ``connected``, ``uni_idx``, ``bi_idx``, ``soc_current``, ``soc_target``,
        ``battery_capacity_kwh``, plus scalars ``building_power_kw``,
        ``estimated_peak_power_kw``.
        """
        n = num_chargers or int(info.get("num_chargers", 1))

        def _vec(key: str, default: float) -> np.ndarray:
            if key in info:
                return np.asarray(info[key], dtype=np.float64).reshape(-1)
            return np.full(n, default, dtype=np.float64)

        connected = info.get("connected")
        if connected is None:
            tau = _vec("tau_remaining_slots", 0.0)
            connected = tau > 0
        else:
            connected = np.asarray(connected, dtype=bool).reshape(-1)

        uni = info.get("uni_idx", np.array([0], dtype=int))
        bi = info.get("bi_idx", np.array([], dtype=int))

        return cls(
            kwh_required=_vec("kwh_required", 0.0),
            tau_remaining=_vec("tau_remaining_slots", 0.0),
            c_max=_vec("c_max", DEFAULT_C_MAX_L2_KW),
            c_min=_vec("c_min", DEFAULT_C_MIN_DISCHARGE_KW),
            connected=np.asarray(connected, dtype=bool).reshape(-1),
            uni_idx=np.asarray(uni, dtype=int).reshape(-1),
            bi_idx=np.asarray(bi, dtype=int).reshape(-1),
            building_power=float(info.get("building_power_kw", 0.0)),
            estimated_peak_power=float(info.get("estimated_peak_power_kw", 1.0)),
            soc_current=_vec("soc_current", 0.5),
            soc_target=_vec("soc_target", 0.9),
            soc_min=_vec("soc_min", default_soc_min),
            battery_capacity_kwh=_vec("battery_capacity_kwh", 60.0),
            delta_hours=delta_hours,
        )

    @classmethod
    def single_charger_from_state(
        cls,
        state: np.ndarray,
        *,
        battery_capacity_kwh: float = 60.0,
        delta_hours: float = DEFAULT_DELTA_HOURS,
        bidirectional: bool = False,
        c_max_kw: float | None = None,
        peak_power_kw: float = 150.0,
        building_power_kw: float | None = None,
    ) -> V2BMaskContext:
        """
        Map a 23-dim ``StateBuilder`` vector to a single-charger mask context.

        Used when the Gym environment exposes one agent per active session.
        """
        s = np.asarray(state, dtype=np.float64).reshape(-1)
        if s.size < 23:
            raise ValueError(f"Expected state dim >= 23, got {s.size}")

        cap = battery_capacity_kwh
        soc = float(s[11])  # soc_current_norm
        soc_tgt = float(s[12])  # soc_target_norm
        energy_req_norm = float(s[14])  # energy_required_norm
        kwh_req = energy_req_norm * cap
        rem_norm = float(s[13])
        max_plug_h = 10.0
        tau_slots = max(rem_norm * max_plug_h / delta_hours, 0.0)

        b_norm = float(s[4])
        peak_norm = float(s[5])
        b_kw = building_power_kw if building_power_kw is not None else b_norm * peak_power_kw
        p_hat = peak_norm * peak_power_kw if peak_norm > 0 else peak_power_kw

        max_kw = (c_max_kw or (DEFAULT_C_MAX_DC_KW if bidirectional else DEFAULT_C_MAX_L2_KW))

        uni = np.array([], dtype=int)
        bi = np.array([0], dtype=int) if bidirectional else np.array([], dtype=int)
        if not bidirectional:
            uni = np.array([0], dtype=int)

        return cls(
            kwh_required=np.array([kwh_req]),
            tau_remaining=np.array([tau_slots]),
            c_max=np.array([max_kw]),
            c_min=np.array([DEFAULT_C_MIN_DISCHARGE_KW if bidirectional else 0.0]),
            connected=np.array([tau_slots > 0]),
            uni_idx=uni,
            bi_idx=bi,
            building_power=b_kw,
            estimated_peak_power=p_hat,
            soc_current=np.array([soc]),
            soc_target=np.array([soc_tgt]),
            soc_min=np.array([DEFAULT_SOC_MIN]),
            battery_capacity_kwh=np.array([cap]),
            delta_hours=delta_hours,
        )


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------


def _relu(x: np.ndarray) -> np.ndarray:
    """Differentiable ReLU (paper uses ReLU throughout Algorithm 1)."""
    return np.maximum(x, 0.0)


def _as_action(action: np.ndarray, n: int) -> np.ndarray:
    a = np.asarray(action, dtype=np.float64).reshape(-1)
    if a.size != n:
        raise ValueError(f"Action length {a.size} != num_chargers {n}")
    return a.copy()


def scale_tanh_to_power(
    action_tanh: np.ndarray,
    c_min: np.ndarray,
    c_max: np.ndarray,
) -> np.ndarray:
    """
    Map actor output in [-1, 1] to physical power [C^min, C^max] (Section 4.2.4).

    ``P = 0.5 * (tanh + 1) * (C^max - C^min) + C^min`` for each charger.
    """
    t = np.clip(np.asarray(action_tanh, dtype=np.float64), -1.0, 1.0)
    c_min = np.asarray(c_min, dtype=np.float64)
    c_max = np.asarray(c_max, dtype=np.float64)
    return 0.5 * (t + 1.0) * (c_max - c_min) + c_min


def clip_action(
    action: np.ndarray,
    c_min: np.ndarray,
    c_max: np.ndarray,
) -> np.ndarray:
    """Element-wise clip to heterogeneous charger power limits (Constraint 2)."""
    return np.clip(
        np.asarray(action, dtype=np.float64),
        np.asarray(c_min, dtype=np.float64),
        np.asarray(c_max, dtype=np.float64),
    )


# ---------------------------------------------------------------------------
# Mask 1–6 (Algorithm 1)
# ---------------------------------------------------------------------------


def mask_no_ev(
    action: np.ndarray,
    ctx: V2BMaskContext,
    *,
    epsilon: float = DEFAULT_EPSILON,
) -> np.ndarray:
    """
    Mask 1 — No-EV mask (Algorithm 1, line 2).

    Zero power when no vehicle is connected: scale by τ^R / (τ^R + ε).
    When τ^R → 0, action → 0.
    """
    tau = np.asarray(ctx.tau_remaining, dtype=np.float64)
    scale = tau / (tau + epsilon)
    if ctx.connected is not None:
        scale = np.where(ctx.connected, scale, 0.0)
    return action * scale


def mask_overcharge_prevention(
    action: np.ndarray,
    ctx: V2BMaskContext,
) -> np.ndarray:
    """
    Mask 2 — Overcharge prevention for unidirectional chargers (line 3).

    Cap charging power at KWH^R / δ so SOC cannot exceed SOC^R on uni-directional
    EVSEs that cannot discharge excess energy.
    """
    out = action.copy()
    delta = ctx.delta_hours
    cap_rate = np.maximum(ctx.kwh_required / delta, 0.0)

    if ctx.uni_idx.size == 0:
        return out

    idx = ctx.uni_idx
    # Only limit positive (charging) power on uni chargers
    charging = np.maximum(out[idx], 0.0)
    out[idx] = np.minimum(charging, cap_rate[idx])
    return out


def mask_urgent_charging(
    action: np.ndarray,
    ctx: V2BMaskContext,
) -> np.ndarray:
    """
    Mask 3 — Urgent / critical charging floor (line 4).

    Minimum power to meet SOC^R before departure assuming max charge in future slots:

        KW̄ = (KWH^R - (τ^R - 1) * C^max * δ) / δ,  clipped to C^max

    Enforces A' = max(A', KW̄) so the agent cannot under-charge near departure.
    """
    delta = ctx.delta_hours
    tau = ctx.tau_remaining
    kw_bar = (ctx.kwh_required - (tau - 1.0) * ctx.c_max * delta) / delta
    kw_bar = np.minimum(kw_bar, ctx.c_max)
    # No urgent floor when no EV or already satisfied
    kw_bar = np.where(ctx.connected & (ctx.kwh_required > 0), kw_bar, 0.0)
    return np.maximum(action, kw_bar)


def mask_v2b_discharge(
    action: np.ndarray,
    ctx: V2BMaskContext,
) -> np.ndarray:
    """
    Mask 4 — V2B discharge for bidirectional chargers (lines 5–6).

    Symmetric to Mask 3 for discharging excess energy before departure:

        KW* = (KWH^R - (τ^R - 1) * C^min * δ) / δ,  clipped to C^min

    For bi chargers: A'[bi] = min(A', KW*).

    Extensions for deployment safety:
    - Uni-directional chargers: discharge power forced to 0.
    - SOC floor: discharge limited so SOC stays above SOC^min.
    """
    out = action.copy()
    delta = ctx.delta_hours
    tau = ctx.tau_remaining

    # Block all discharge on unidirectional indices
    if ctx.uni_idx.size > 0:
        out[ctx.uni_idx] = np.maximum(out[ctx.uni_idx], 0.0)

    if ctx.bi_idx.size == 0:
        return out

    idx = ctx.bi_idx
    # Paper Eq. line 168–170: critical discharge rate (KW* is negative or zero)
    kw_star = (ctx.kwh_required[idx] - (tau[idx] - 1.0) * ctx.c_min[idx] * delta) / delta
    kw_star = np.maximum(kw_star, ctx.c_min[idx])

    out[idx] = np.minimum(out[idx], kw_star)

    # Prevent discharge below minimum SOC (Constraint 3)
    cap = ctx.battery_capacity_kwh[idx]
    soc = ctx.soc_current[idx]
    soc_min = ctx.soc_min[idx]
    headroom_kwh = np.maximum((soc - soc_min) * cap, 0.0)
    max_discharge_kw = -headroom_kwh / delta  # negative or zero
    discharging = out[idx] < 0
    out[idx] = np.where(discharging, np.maximum(out[idx], max_discharge_kw), out[idx])

    return out


def mask_peak_demand_optimization(
    action: np.ndarray,
    ctx: V2BMaskContext,
    *,
    epsilon: float = DEFAULT_EPSILON,
    use_headroom_formula: bool = True,
) -> np.ndarray:
    """
    Mask 5 — Peak-demand / power-improvement strategy (lines 7–9).

    Boosts charging within headroom below the estimated monthly peak P̂^max
    without exceeding per-charger energy needs — encourages early charging
    and peak shaving (avoids last-minute demand spikes).

    Algorithm 1:
        powerGap = B(T_j) - P̂^max
        canIncrease = ReLU(min(KWH^R/δ, C^max) - A')
        toImprove = min(ReLU(powerGap - sum(A')), sum(canIncrease))
        A' += toImprove * canIncrease / (sum(canIncrease) + ε)

    When ``use_headroom_formula`` is True (recommended for peak shaving), use
    headroom = P̂^max - B - sum(A') per paper Section 4.2.2 text.
    """
    out = action.copy()
    delta = ctx.delta_hours
    max_charge_rate = np.minimum(np.maximum(ctx.kwh_required / delta, 0.0), ctx.c_max)
    can_increase = _relu(max_charge_rate - out)

    total_action = float(np.sum(out))
    if use_headroom_formula:
        # P̂^max - B - Σ P : available capacity before hitting peak estimate
        power_gap = ctx.estimated_peak_power - ctx.building_power - total_action
    else:
        # Literal Algorithm 1 line 7
        power_gap = ctx.building_power - ctx.estimated_peak_power - total_action

    to_improve = min(float(_relu(np.array([power_gap]))[0]), float(np.sum(can_increase)))

    denom = float(np.sum(can_increase)) + epsilon
    if denom > 0 and to_improve > 0:
        out = out + (to_improve * can_increase) / denom

    # High building load: attenuate positive charging (peak shaving extension)
    if ctx.estimated_peak_power > 0:
        load_ratio = ctx.building_power / ctx.estimated_peak_power
        if load_ratio > 0.85:
            scale = max(0.0, 1.0 - (load_ratio - 0.85) / 0.15)
            out = np.where(out > 0, out * scale, out)

    return out


def mask_building_protection(
    action: np.ndarray,
    ctx: V2BMaskContext,
    *,
    epsilon: float = DEFAULT_EPSILON,
) -> np.ndarray:
    """
    Mask 6 — Building protection / Constraint (5) (lines 10–11).

    Net discharge cannot exceed building load: cumulative V2B export is capped so
    total power does not drop below zero at the building meter.

        toImprove = max(-B - sum(A'), 0)
        negAction = ReLU(-A') * -1   (discharging components)
        A' += toImprove * negAction / (sum(negAction) + ε)
    """
    out = action.copy()
    total = float(np.sum(out))
    violation = max(-ctx.building_power - total, 0.0)

    neg_action = _relu(-out) * -1.0  # negative-only mask
    neg_sum = float(np.sum(-neg_action)) + epsilon
    if neg_sum > epsilon and violation > 0:
        out = out + (violation * neg_action) / neg_sum

    return out


# ---------------------------------------------------------------------------
# ActionMask orchestrator
# ---------------------------------------------------------------------------


@dataclass
class MaskDiagnostics:
    """Optional trace of per-mask deltas for debugging."""

    mask_names: list[str] = field(default_factory=list)
    actions_before: list[np.ndarray] = field(default_factory=list)
    actions_after: list[np.ndarray] = field(default_factory=list)


class ActionMask:
    """
    Applies all six V2B masks in paper order for DDPG continuous control.

    Typical Gymnasium usage in ``EvEnv.step``::

        masked = self.action_mask.apply_masks(raw_power, self._mask_context)
    """

    MASK_ORDER: tuple[str, ...] = (
        "no_ev",
        "overcharge_prevention",
        "urgent_charging",
        "v2b_discharge",
        "peak_demand_optimization",
        "building_protection",
    )

    def __init__(
        self,
        *,
        epsilon: float = DEFAULT_EPSILON,
        delta_hours: float = DEFAULT_DELTA_HOURS,
        use_headroom_peak_formula: bool = True,
        record_diagnostics: bool = False,
    ) -> None:
        self.epsilon = epsilon
        self.delta_hours = delta_hours
        self.use_headroom_peak_formula = use_headroom_peak_formula
        self.record_diagnostics = record_diagnostics
        self._last_diagnostics: MaskDiagnostics | None = None

        self._mask_fns = {
            "no_ev": lambda a, c: mask_no_ev(a, c, epsilon=self.epsilon),
            "overcharge_prevention": mask_overcharge_prevention,
            "urgent_charging": mask_urgent_charging,
            "v2b_discharge": mask_v2b_discharge,
            "peak_demand_optimization": lambda a, c: mask_peak_demand_optimization(
                a, c, epsilon=self.epsilon, use_headroom_formula=self.use_headroom_peak_formula
            ),
            "building_protection": lambda a, c: mask_building_protection(
                a, c, epsilon=self.epsilon
            ),
        }

    def apply_masks(
        self,
        action: np.ndarray,
        ctx: V2BMaskContext,
        *,
        clip: bool = True,
    ) -> np.ndarray:
        """
        Run Mask(S, A) → A' through all six masks sequentially.

        Parameters
        ----------
        action:
            Raw power vector [kW] per charger (after tanh scaling).
        ctx:
            Physical context at time slot T_j.
        clip:
            Final clip to [C^min, C^max] per charger.

        Returns
        -------
        np.ndarray
            Feasible masked actions, same shape as ``action``.
        """
        n = ctx.num_chargers
        out = _as_action(action, n)

        diag = MaskDiagnostics() if self.record_diagnostics else None

        for name in self.MASK_ORDER:
            if diag is not None:
                diag.mask_names.append(name)
                diag.actions_before.append(out.copy())
            fn = self._mask_fns[name]
            out = fn(out, ctx)
            if diag is not None:
                diag.actions_after.append(out.copy())

        if clip:
            out = clip_action(out, ctx.c_min, ctx.c_max)

        self._last_diagnostics = diag
        return out.astype(np.float32)

    def apply_masks_tanh(
        self,
        action_tanh: np.ndarray,
        ctx: V2BMaskContext,
    ) -> np.ndarray:
        """Scale [-1, 1] actor output to power, mask, and return safe kW."""
        power = scale_tanh_to_power(action_tanh, ctx.c_min, ctx.c_max)
        return self.apply_masks(power, ctx)

    def apply_masks_for_gym(
        self,
        action: np.ndarray,
        info: dict[str, Any],
        *,
        from_tanh: bool = False,
    ) -> np.ndarray:
        """Convenience wrapper using ``info`` from a Gymnasium environment."""
        ctx = V2BMaskContext.from_gym(info, delta_hours=self.delta_hours)
        if from_tanh:
            return self.apply_masks_tanh(action, ctx)
        return self.apply_masks(action, ctx)

    def validate_action(
        self,
        action: np.ndarray,
        ctx: V2BMaskContext,
        *,
        atol: float = 1e-3,
    ) -> tuple[bool, list[str]]:
        """
        Check whether ``action`` satisfies masked feasibility constraints.

        Returns (is_valid, list of violation messages).
        """
        a = _as_action(action, ctx.num_chargers)
        violations: list[str] = []
        delta = ctx.delta_hours

        for i in range(ctx.num_chargers):
            if not ctx.connected[i] and abs(a[i]) > atol:
                violations.append(f"charger {i}: power {a[i]:.3f} with no EV connected")

            if a[i] > ctx.c_max[i] + atol or a[i] < ctx.c_min[i] - atol:
                violations.append(
                    f"charger {i}: power {a[i]:.3f} outside [{ctx.c_min[i]}, {ctx.c_max[i]}]"
                )

            if i in ctx.uni_idx and a[i] < -atol:
                violations.append(f"charger {i}: discharge on unidirectional EVSE")

            if ctx.connected[i] and i in ctx.uni_idx and a[i] > 0:
                max_p = ctx.kwh_required[i] / delta
                if a[i] > max_p + atol:
                    violations.append(f"charger {i}: overcharge {a[i]:.3f} > {max_p:.3f} kW")

            if ctx.connected[i] and a[i] < 0:
                cap = ctx.battery_capacity_kwh[i]
                min_soc_energy = (ctx.soc_current[i] - ctx.soc_min[i]) * cap
                if -a[i] * delta > min_soc_energy + atol:
                    violations.append(f"charger {i}: discharge below SOC^min")

        total = float(np.sum(a))
        if total < -ctx.building_power - atol:
            violations.append(
                f"building protection: sum(actions)={total:.3f} < -B={-ctx.building_power:.3f}"
            )

        return len(violations) == 0, violations

    @property
    def last_diagnostics(self) -> MaskDiagnostics | None:
        return self._last_diagnostics


# ---------------------------------------------------------------------------
# Gymnasium space helpers
# ---------------------------------------------------------------------------


def masked_action_space(
    num_chargers: int,
    c_min: float | np.ndarray = DEFAULT_C_MIN_DISCHARGE_KW,
    c_max: float | np.ndarray = DEFAULT_C_MAX_L2_KW,
) -> Any:
    """
    Build a Gymnasium Box for raw power actions [C^min, C^max]^N.

    Returns None if gymnasium is not installed.
    """
    if gym is None:
        return None
    c_min_v = np.full(num_chargers, c_min, dtype=np.float32)
    c_max_v = np.full(num_chargers, c_max, dtype=np.float32)
    return gym.spaces.Box(low=c_min_v, high=c_max_v, dtype=np.float32)


def tanh_action_space(num_chargers: int) -> Any:
    """Box [-1, 1]^N matching DDPG actor output before power scaling."""
    if gym is None:
        return None
    return gym.spaces.Box(
        low=-1.0,
        high=1.0,
        shape=(num_chargers,),
        dtype=np.float32,
    )


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    masker = ActionMask(record_diagnostics=True)
    ctx = V2BMaskContext(
        kwh_required=np.array([15.0]),
        tau_remaining=np.array([2.0]),
        c_max=np.array([7.2]),
        c_min=np.array([-7.2]),
        connected=np.array([True]),
        uni_idx=np.array([], dtype=int),
        bi_idx=np.array([0], dtype=int),
        building_power=80.0,
        estimated_peak_power=150.0,
        soc_current=np.array([0.4]),
        soc_target=np.array([0.9]),
        soc_min=np.array([0.1]),
        battery_capacity_kwh=np.array([60.0]),
    )

    raw = np.array([10.0])
    masked = masker.apply_masks(raw, ctx)
    valid, msgs = masker.validate_action(masked, ctx)

    print("raw action (kW):", raw)
    print("masked action (kW):", masked)
    print("valid:", valid, msgs or "ok")
    print("mask pipeline:", masker.MASK_ORDER)


if __name__ == "__main__":
    main()
