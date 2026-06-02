"""
V2B Neural Grid — DDPG training stack on ``grid_telemetry.csv``.

Modules:
  env            — Gymnasium telemetry environment
  reward         — Multi-objective reward engineering
  replay_buffer  — Off-policy experience replay
  rl_config      — Centralized hyperparameters
  networks       — Actor / critic PyTorch modules
  ddpg_agent     — DDPG learner with target soft-updates
  policy         — Checkpoint loader for inference
  train_ddpg     — Training CLI entry point
"""

from backend.rl.rl_config import RLConfig, default_config

__all__ = ["RLConfig", "default_config"]
