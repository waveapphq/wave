"""Shared fixtures for the /tests/{test_id}/testdata routes (REQ-5.2.4.12).

Mirrors ``tests/api/artifacts/conftest.py``: an isolated storage base per test,
a ``TestClient`` over the real app, and seeding helpers that write straight into
the test's test data folder.
"""

import os
import re
import uuid
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.storage_paths import get_base_path
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_uploads
from wavecore.api.services.workbench import _common as wb_common

TEST_NAME = "Checkout-Flow"


def testdata_root(test_id: str) -> Path:
    """The test's own test data folder."""
    from wavecore.api.services.storage_paths import get_test_testdata_path

    return get_test_testdata_path(test_id)


def _unlock_zone() -> None:
    """Restore write bits so the temp storage tree stays removable."""
    root = get_base_path() / "testdata"
    if not root.exists():
        return
    os.chmod(root, 0o755)
    for current, dirnames, filenames in os.walk(root):
        for name in dirnames:
            os.chmod(Path(current) / name, 0o755)
        for name in filenames:
            os.chmod(Path(current) / name, 0o644)


@pytest.fixture(autouse=True)
def isolate_testdata_state(temp_storage_path: Path) -> Generator[None, None, None]:
    """Isolate tests, execution records and workbench sessions per test."""
    test_service._clear_storage()
    exec_storage._clear_storage()
    wb_common._clear_sessions_sync()
    testdata_uploads.clear()
    yield
    wb_common._clear_sessions_sync()
    testdata_uploads.clear()
    _unlock_zone()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.fixture
def test_id() -> str:
    """A saved test document that has no test data folder yet."""
    return create_test_document()["id"]


def create_test_document(name: str = TEST_NAME) -> dict[str, Any]:
    """Create one saved test document."""
    return test_service.create_test(
        {"name": name, "workflow": {"nodes": [], "edges": []}, "variables": {}}
    )


def seed_file(test_id: str, relative_path: str, content: bytes = b"id,name\n1,ada\n") -> Path:
    """Write one file into the test's test data folder."""
    path = testdata_root(test_id) / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def seed_folder(test_id: str, relative_path: str) -> Path:
    """Create one folder inside the test's test data folder."""
    path = testdata_root(test_id) / relative_path
    path.mkdir(parents=True, exist_ok=True)
    return path


def seed_running_execution(test_id: str, status: str = "running") -> str:
    """Seed an active tracked execution whose own entity is the test."""
    execution_id = str(uuid.uuid4())
    exec_storage._execution_storage[execution_id] = {
        "id": execution_id,
        "name": f"exec-{execution_id}",
        "entity_type": "test",
        "entity_id": test_id,
        "environment_id": "env-1",
        "status": status,
        "started_at": "2026-09-06T08:00:00+00:00",
    }
    return execution_id


def seed_running_session(test_id: str, status: str = "running") -> str:
    """Seed a workbench session holding the test."""
    session_id = str(uuid.uuid4())
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "test_id": test_id,
        "test_name": TEST_NAME,
        "status": status,
        "user_id": wb_common.DEFAULT_USER_ID,
        "variables": {},
        "block_states": {},
    }
    return session_id


def running_message(name: str = TEST_NAME) -> str:
    """The exact 409 message every mutating test data endpoint answers with."""
    return f"Test '{name}' is running; test data cannot be changed until it finishes"


def assert_error(response: Any, *, status_code: int, code: str, message: str) -> None:
    """Assert the WAVE error envelope with an anchored, escaped message match."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["error"]["code"] == code
    assert re.match(rf"^{re.escape(message)}$", body["error"]["message"]) is not None


def assert_running_conflict(response: Any, holder_ids: list[str], name: str = TEST_NAME) -> None:
    """Assert the 409 running answer: CONFLICT code plus details.execution_ids."""
    assert_error(response, status_code=409, code="CONFLICT", message=running_message(name))
    assert response.json()["error"]["details"]["execution_ids"] == holder_ids
