"""
Centralized DDPG configuration for telemetry-based V2B grid optimization.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

STATE_FEATURE_NAMES: tuple[str, ...] = (
    "grid_load_kw",
    "charging_power_kw",
    "soc_percent",
    "renewable_ratio",
    "charger_utilization",
    "thermal_index",
    "grid_stress_index",
    "degradation_score",
    "anomaly_score",
)

ACTION_NAMES: tuple[str, ...] = (
    "charging_rate_adjustment",
    "renewable_allocation",
    "load_shift_factor",
    "battery_protection_strength",
    "peak_shaving_factor",
)


@dataclass
class RLConfig:
    """Hyperparameters and paths for telemetry DDPG training."""

    # Data
    telemetry_path: Path = field(
        default_factory=lambda: PROJECT_ROOT / "data" / "grid_telemetry.csv"
    )
    checkpoint_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "checkpoints")
    metrics_csv_path: Path = field(
        default_factory=lambda: PROJECT_ROOT / "training_metrics.csv"
    )

    # Dimensions
    state_dim: int = len(STATE_FEATURE_NAMES)
    action_dim: int = len(ACTION_NAMES)

    # Environment
    max_episode_steps: int = 128
    train_split: float = 0.9
    random_seed: int = 42

    # DDPG optimization
    gamma: float = 0.99
    tau: float = 0.005
    lr_actor: float = 1e-4
    lr_critic: float = 1e-3
    batch_size: int = 128
    replay_capacity: int = 50_000
    warmup_steps: int = 512
    learn_every: int = 1
    gradient_clip: float = 1.0

    # Exploration (Ornstein–Uhlenbeck-style Gaussian for simplicity)
    noise_sigma: float = 0.2
    noise_decay: float = 0.9995
    min_noise_sigma: float = 0.02

    # Network
    hidden_dims: tuple[int, ...] = (256, 256)

    # Training schedule
    num_episodes: int = 200
    eval_every: int = 20
    save_every: int = 50
    device: str = "auto"  # auto | cpu | cuda

    # Normalization caps (physical units → [0,1])
    norm_caps: dict[str, float] = field(
        default_factory=lambda: {
            "grid_load_kw": 450.0,
            "charging_power_kw": 250.0,
            "soc_percent": 100.0,
            "renewable_ratio": 1.0,
            "charger_utilization": 1.0,
            "thermal_index": 50.0,
            "grid_stress_index": 1.2,
            "degradation_score": 20.0,
            "anomaly_score": 5.0,
        }
    )

    @property
    def actor_checkpoint(self) -> Path:
        return self.checkpoint_dir / "ddpg_actor.pth"

    @property
    def critic_checkpoint(self) -> Path:
        return self.checkpoint_dir / "ddpg_critic.pth"

    @property
    def meta_checkpoint(self) -> Path:
        return self.checkpoint_dir / "ddpg_meta.pth"


def default_config() -> RLConfig:
    return RLConfig()


def resolve_device(device: str) -> str:
    if device != "auto":
        return device
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"
