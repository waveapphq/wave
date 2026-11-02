"""Test helpers for test service tests.

This module provides helper functions for test setup and teardown
that manipulate storage directly. These helpers are only for tests
and must NOT be placed in production code.
"""

from pathlib import Path
from typing import Any

import yaml

from wavecore.api.services.storage_paths import get_tests_storage_path


def get_test_dir(test_id: str) -> Path:
    """Get the directory path for a test."""
    return get_tests_storage_path() / test_id


def save_test_file(test: dict[str, Any]) -> None:
    """Save test data directly to file storage."""
    test_dir = get_test_dir(test["id"])
    test_dir.mkdir(parents=True, exist_ok=True)
    test_file = test_dir / "test.yaml"
    with open(test_file, "w", encoding="utf-8") as f:
        yaml.dump(test, f, default_flow_style=False, sort_keys=False)


def load_test_file(test_id: str) -> dict[str, Any] | None:
    """Load raw test data from file storage without masking."""
    test_file = get_test_dir(test_id) / "test.yaml"
    if not test_file.exists():
        return None
    with open(test_file, encoding="utf-8") as f:
        return yaml.safe_load(f)
