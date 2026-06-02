"""
Telemetry CSV loading helpers — paths driven by backend.config settings.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from backend.config import Settings, settings


def load_telemetry_rows(cfg: Settings | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    """Load telemetry rows from configured CSV paths with legacy fallback."""
    cfg = cfg or settings
    row_limit = limit if limit is not None else cfg.telemetry_row_limit
    telemetry_path = cfg.telemetry_file
    legacy_path = cfg.legacy_dataset_file

    path = telemetry_path if telemetry_path.is_file() else legacy_path
    if not path.is_file():
        return []

    df = pd.read_csv(path).fillna(0)
    cap = min(len(df), row_limit) if path == telemetry_path else min(len(df), 100)
    return df.head(cap).to_dict(orient="records")


def resolve_dataset_path(cfg: Settings | None = None):
    """Return the active telemetry CSV path (primary or legacy fallback)."""
    cfg = cfg or settings
    telemetry_path = cfg.telemetry_file
    legacy_path = cfg.legacy_dataset_file
    path = telemetry_path if telemetry_path.is_file() else legacy_path
    return path, telemetry_path, legacy_path
