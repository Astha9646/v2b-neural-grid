"""
Digital twin simulation foundation for V2B Neural Grid.

Configurable scenario loop over fleet, chargers, renewables, building load,
and RL optimization effects. Prepared for DDPG policy hook-in via ``rl_interfaces``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np

from backend.grid_intelligence import GridIntelligenceEngine, _num
from backend.rl_interfaces import RLStateVector, build_state_vector, compute_reward_components


@dataclass
class TwinScenario:
    name: str = "baseline"
    fleet_size: int = 8
    solar_capacity_kw: float = 120.0
    building_base_load_kw: float = 95.0
    peak_cap_kw: float = 380.0
    renewable_target: float = 0.35


@dataclass
class TwinState:
    tick: int = 0
    grid_load_kw: float = 0.0
    charging_power_kw: float = 0.0
    soc_percent: float = 50.0
    solar_generation_kw: float = 0.0
    renewable_ratio: float = 0.0
    grid_stress_index: float = 0.0
    rl_reward_signal: float = 0.0
    scenario: str = "baseline"
    nodes: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class DigitalTwinSimulator:
    """Steppable smart-grid twin for API-driven simulation."""

    def __init__(self, scenario: TwinScenario | None = None) -> None:
        self.scenario = scenario or TwinScenario()
        self._tick = 0
        self._intel = GridIntelligenceEngine()
        self._hour = 12.0

    def reset(self, scenario: TwinScenario | None = None) -> TwinState:
        if scenario:
            self.scenario = scenario
        self._tick = 0
        self._hour = 8.0
        return self.step(actions=None)

    def step(self, actions: np.ndarray | None = None) -> TwinState:
        """Advance one simulation tick (1 hour). Optional RL actions shape (8,)."""
        self._tick += 1
        self._hour = (self._hour + 1) % 24

        # Solar curve by hour
        solar_factor = max(0, np.sin((self._hour - 6) / 12 * np.pi))
        solar_kw = self.scenario.solar_capacity_kw * solar_factor * (0.85 + 0.15 * np.random.random())

        base = self.scenario.building_base_load_kw
        fleet_active = max(1, int(self.scenario.fleet_size * (0.4 + 0.4 * solar_factor)))
        if actions is not None and len(actions) > 0:
            charging_kw = float(np.sum(np.clip(actions, -1, 1) * 25))
        else:
            charging_kw = fleet_active * (8 + 6 * np.random.random())

        building_kw = base + charging_kw * 0.35
        grid_load = building_kw + charging_kw * 0.65
        peak_cap = self.scenario.peak_cap_kw
        stress = float(np.clip(grid_load / peak_cap, 0, 1.2))

        renewable_ratio = float(np.clip(solar_kw / max(grid_load, 1), 0, 1))
        soc = float(np.clip(50 + charging_kw * 0.15 - self._tick * 0.2, 15, 98))

        peak_penalty = max(0.0, stress - 0.7)
        reward_row = {
            "grid_stress_index": stress,
            "renewable_ratio": renewable_ratio,
            "peak_penalty": peak_penalty,
        }
        row = {
            "timestamp": f"twin-tick-{self._tick}",
            "grid_load_kw": grid_load,
            "charging_power_kw": charging_kw,
            "soc_percent": soc,
            "solar_generation_kw": solar_kw,
            "renewable_ratio": renewable_ratio,
            "grid_stress_index": stress,
            "peak_demand_kw": peak_cap * 0.9,
            "peak_penalty": peak_penalty,
            "charger_utilization": fleet_active / self.scenario.fleet_size,
            "thermal_index": 28 + charging_kw * 0.08,
            "charging_stress_score": stress * 60,
            "degradation_score": 2.0,
            "anomaly_score": max(0, stress - 0.8) * 5,
            "rl_reward_signal": compute_reward_components(reward_row)["total"],
        }

        inference = self._intel.analyze_row(row)
        state_vec = build_state_vector(row)

        nodes = {
            "solar": {"kw": round(solar_kw, 2)},
            "building": {"kw": round(building_kw, 2)},
            "grid": {"kw": round(max(0, grid_load - solar_kw * 0.5), 2)},
            "chargers": {"kw": round(charging_kw, 2), "active": fleet_active},
            "battery": {"soc": round(soc, 1)},
        }

        return TwinState(
            tick=self._tick,
            grid_load_kw=round(grid_load, 2),
            charging_power_kw=round(charging_kw, 2),
            soc_percent=round(soc, 1),
            solar_generation_kw=round(solar_kw, 2),
            renewable_ratio=round(renewable_ratio, 3),
            grid_stress_index=round(stress, 4),
            rl_reward_signal=round(_num(row, "rl_reward_signal"), 4),
            scenario=self.scenario.name,
            nodes={
                **nodes,
                "inference": inference.to_dict(),
                "state_dim": state_vec.dim,
            },
        )


# Default singleton for stateless API steps
digital_twin = DigitalTwinSimulator()
