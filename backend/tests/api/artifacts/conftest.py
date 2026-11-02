"""Shared fixtures for the scan-based /artifacts API tests (REQ-3.7.1.x)."""

import os
import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.storage_paths import get_artifacts_storage_path


@pytest.fixture(autouse=True)
def clear_execution_storage(temp_storage_path: Path) -> Generator[None, None, None]:
    """Isolate the executions cache/disk state per test."""
    exec_storage._clear_storage()
    yield


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def make_execution_dir(
    execution_id: str | None = None,
    stamp: str = "20260609-120000",
) -> tuple[str, str, Path]:
    """Create an execution artifact dir; returns (dir_name, execution_id, path)."""
    execution_id = execution_id or str(uuid.uuid4())
    dir_name = f"{stamp}-{execution_id}"
    directory = get_artifacts_storage_path() / dir_name
    directory.mkdir(parents=True, exist_ok=True)
    return dir_name, execution_id, directory


def write_artifact_file(
    directory: Path,
    relative_path: str,
    content: bytes = b"content",
    mtime: float | None = None,
) -> Path:
    """Write a file inside an execution artifact dir, optionally pinning mtime."""
    path = directory / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def seed_execution_record(
    execution_id: str,
    status: str,
    artifact_dir: str,
    name: str = "artifact-test-execution",
) -> dict:
    """Seed an execution record on disk and in the service cache."""
    record = {
        "id": execution_id,
        "name": name,
        "entity_type": "test",
        "entity_id": str(uuid.uuid4()),
        "environment_id": str(uuid.uuid4()),
        "status": status,
        "started_at": "2026-06-09T12:00:00+00:00",
        "artifact_dir": artifact_dir,
    }
    exec_storage._save_execution(record)
    exec_storage._execution_storage[execution_id] = record
    return record
