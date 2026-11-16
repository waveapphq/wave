"""Test helpers for suite service tests.

This module provides helper functions for test setup and teardown
that manipulate storage directly. These helpers are only for tests
and must NOT be placed in production code.
"""

import shutil
import uuid
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.services.storage_paths import get_suites_storage_path


def clear_suite_storage() -> None:
    """Clear all suite storage for test isolation."""
    storage_dir = get_suites_storage_path()
    if storage_dir.exists():
        shutil.rmtree(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)


def get_suite_dir(suite_id: str) -> Path:
    """Get the directory path for a suite."""
    return get_suites_storage_path() / suite_id


def load_suite_file(suite_id: str) -> dict[str, Any] | None:
    """Load raw suite data from file storage without masking."""
    suite_file = get_suite_dir(suite_id) / "suite.yaml"
    if not suite_file.exists():
        return None
    with open(suite_file, encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_suite_file(suite: dict[str, Any]) -> None:
    """Save suite data directly to file storage."""
    suite_dir = get_suite_dir(suite["id"])
    suite_dir.mkdir(parents=True, exist_ok=True)
    suite_file = suite_dir / "suite.yaml"
    with open(suite_file, "w", encoding="utf-8") as f:
        yaml.dump(suite, f, default_flow_style=False, sort_keys=False)


def update_suite_metadata(suite_id: str, metadata_updates: dict[str, Any]) -> None:
    """Update suite metadata directly for test setup."""
    suite = load_suite_file(suite_id)
    if suite:
        suite["metadata"] = {**suite.get("metadata", {}), **metadata_updates}
        save_suite_file(suite)


def load_versions_file(suite_id: str) -> list[dict[str, Any]]:
    """Load version history from file storage."""
    versions_file = get_suite_dir(suite_id) / "versions.yaml"
    if not versions_file.exists():
        return []
    with open(versions_file, encoding="utf-8") as f:
        return yaml.safe_load(f) or []


def save_versions_file(suite_id: str, versions: list[dict[str, Any]]) -> None:
    """Save version history to file storage."""
    suite_dir = get_suite_dir(suite_id)
    suite_dir.mkdir(parents=True, exist_ok=True)
    versions_file = suite_dir / "versions.yaml"
    with open(versions_file, "w", encoding="utf-8") as f:
        yaml.dump(versions, f, default_flow_style=False, sort_keys=False)


def set_version_attribute(suite_id: str, version: str, attr: str, value: Any) -> None:
    """Set an attribute on a version entry for test setup."""
    versions = load_versions_file(suite_id)
    for v in versions:
        if v["version"] == version:
            v[attr] = value
            break
    save_versions_file(suite_id, versions)


def make_test_ids(count: int) -> list[str]:
    """IDs of new real Tests, since a Suite refuses a Test that does not exist."""
    from wavecore.api.services.tests import service as test_service

    return [
        test_service.create_test({"name": f"Member {uuid.uuid4().hex}"})["id"] for _ in range(count)
    ]


def store_suite_variables(suite_id: str, variables: dict[str, Any]) -> None:
    """Write a Suite's variables straight to storage, past the checks a save runs."""
    suite = load_suite_file(suite_id)
    assert suite is not None
    suite["variables"] = variables
    save_suite_file(suite)
