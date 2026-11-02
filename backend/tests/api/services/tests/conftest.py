"""Shared fixtures and seed helpers for the per-test Test Data service tests."""

import os
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from wavecore.api.services.storage_paths import (
    get_test_testdata_path,
    get_testdata_storage_path,
)
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_service, testdata_uploads

TEST_NAME = "Fixture Carrier"


@pytest.fixture(autouse=True)
def restore_zone_write_permission() -> Generator[None, None, None]:
    """Relax the locked tree after each test so the temp storage can be removed."""
    testdata_uploads.clear()
    yield
    testdata_uploads.clear()
    zone = get_testdata_storage_path()
    if not zone.exists():
        return
    for path in [zone, *zone.rglob("*")]:
        os.chmod(path, 0o755 if path.is_dir() else 0o644)


@pytest.fixture
def test_id() -> str:
    """A saved test document whose test data folder does not exist yet."""
    return str(test_service.create_test({"name": TEST_NAME})["id"])


@pytest.fixture
def other_test_id() -> str:
    """A second saved test document, for cross-test isolation checks."""
    return str(test_service.create_test({"name": "Second Carrier"})["id"])


def testdata_root(test_id: str) -> Path:
    """The test's own test data folder."""
    return get_test_testdata_path(test_id)


def seed_file(test_id: str, rel: str, content: bytes = b"payload") -> Path:
    """Write one file into the test's folder without going through the service."""
    path = testdata_root(test_id) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def seed_folder(test_id: str, rel: str) -> Path:
    """Create one folder inside the test's folder without going through the service."""
    path = testdata_root(test_id) / rel
    path.mkdir(parents=True, exist_ok=True)
    return path


def store(
    test_id: str, rel: str, content: bytes = b"payload", *, replace: bool = False
) -> dict[str, Any]:
    """Store one file through the service, addressed by its path relative to the test root."""
    folder, _, name = rel.rpartition("/")
    return testdata_service.store_bytes(test_id, folder, name, content, replace=replace)


def mode_of(path: Path) -> str:
    """The path's permission bits as an octal string."""
    return oct(path.stat().st_mode & 0o777)


def modes_under(root: Path) -> dict[str, str]:
    """Relative posix path -> octal permission bits for every entry under root."""
    return {entry.relative_to(root).as_posix(): mode_of(entry) for entry in sorted(root.rglob("*"))}
