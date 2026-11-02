"""Test helpers for regression service tests.

This module provides helper functions for test setup and teardown
that manipulate storage directly. These helpers are only for tests
and must NOT be placed in production code.
"""

import shutil
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.services.storage_paths import get_regressions_storage_path


def clear_regression_storage() -> None:
    """Clear all regression storage for test isolation."""
    storage_dir = get_regressions_storage_path()
    if storage_dir.exists():
        shutil.rmtree(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)


def get_regression_dir(regression_id: str) -> Path:
    """Get the directory path for a regression."""
    return get_regressions_storage_path() / regression_id


def load_regression_file(regression_id: str) -> dict[str, Any] | None:
    """Load raw regression data from file storage without masking."""
    regression_file = get_regression_dir(regression_id) / "regression.yaml"
    if not regression_file.exists():
        return None
    with open(regression_file, encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_regression_file(regression: dict[str, Any]) -> None:
    """Save regression data directly to file storage."""
    regression_dir = get_regression_dir(regression["id"])
    regression_dir.mkdir(parents=True, exist_ok=True)
    regression_file = regression_dir / "regression.yaml"
    with open(regression_file, "w", encoding="utf-8") as f:
        yaml.dump(regression, f, default_flow_style=False, sort_keys=False)


def load_versions_file(regression_id: str) -> list[dict[str, Any]]:
    """Load version history from file storage."""
    versions_file = get_regression_dir(regression_id) / "versions.yaml"
    if not versions_file.exists():
        return []
    with open(versions_file, encoding="utf-8") as f:
        return yaml.safe_load(f) or []


def save_versions_file(regression_id: str, versions: list[dict[str, Any]]) -> None:
    """Save version history to file storage."""
    regression_dir = get_regression_dir(regression_id)
    regression_dir.mkdir(parents=True, exist_ok=True)
    versions_file = regression_dir / "versions.yaml"
    with open(versions_file, "w", encoding="utf-8") as f:
        yaml.dump(versions, f, default_flow_style=False, sort_keys=False)


def set_version_attribute(regression_id: str, version: str, attr: str, value: Any) -> None:
    """Set an attribute on a version entry for test setup."""
    versions = load_versions_file(regression_id)
    for v in versions:
        if v["version"] == version:
            v[attr] = value
            break
    save_versions_file(regression_id, versions)
