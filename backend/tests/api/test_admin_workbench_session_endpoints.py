"""Tests for the admin Workbench session inspection and teardown endpoints.

Exposes `GET /admin/workbench/session` and `DELETE /admin/workbench/session`
so automated test teardown (Playwright, CI) can force-clear a lingering
workbench session without impersonating the owning client. The endpoints are
gated by `WAVE_ADMIN_ALLOWED` - no runtime admin-enable required, mirroring
the rest of the admin session inspection surface.
"""

from __future__ import annotations

import os
from collections.abc import Generator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def _reset_workbench_state() -> None:
    from wavecore.api.services.workbench import service as workbench_service

    workbench_service._workbench_sessions.clear()
    workbench_service._active_tasks.clear()
    workbench_service._user_active_session.clear()


@pytest.fixture
def client_admin_allowed() -> Generator[TestClient, None, None]:
    _reset_workbench_state()
    with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
        from wavecore.api.app import app

        yield TestClient(app)
    _reset_workbench_state()


@pytest.fixture
def client_admin_disallowed() -> Generator[TestClient, None, None]:
    _reset_workbench_state()
    with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
        from wavecore.api.app import app

        yield TestClient(app)
    _reset_workbench_state()


def _seed_workbench_session(
    *,
    session_id: str,
    user_id: str = "dev",
    test_id: str = "test-123",
    test_name: str = "Sample Test",
    status: str = "running",
    execution_id: str | None = None,
) -> None:
    from wavecore.api.services.workbench import service as workbench_service

    session: dict[str, object] = {
        "session_id": session_id,
        "status": status,
        "test_id": test_id,
        "test_name": test_name,
        "websocket_topic": f"log:{session_id}",
        "current_block": None,
        "progress": 0,
        "block_states": {},
        "execution_id": execution_id,
        "parent_execution_id": None,
        "error": None,
    }
    workbench_service._workbench_sessions[session_id] = session
    workbench_service._user_active_session[user_id] = session_id


# ---------------------------------------------------------------------------
# Gate behavior (matches other admin endpoints: 404 when not allowed)
# ---------------------------------------------------------------------------


class TestWorkbenchSessionGateDisallowed:
    def test_get_returns_404_when_admin_not_allowed(
        self, client_admin_disallowed: TestClient
    ) -> None:
        response = client_admin_disallowed.get("/admin/workbench/session")
        assert response.status_code == 404
        assert response.json()["detail"] == "Not Found"

    def test_delete_returns_404_when_admin_not_allowed(
        self, client_admin_disallowed: TestClient
    ) -> None:
        response = client_admin_disallowed.delete("/admin/workbench/session")
        assert response.status_code == 404
        assert response.json()["detail"] == "Not Found"


# ---------------------------------------------------------------------------
# GET /admin/workbench/session
# ---------------------------------------------------------------------------


class TestGetWorkbenchSession:
    def test_returns_active_session_when_present(self, client_admin_allowed: TestClient) -> None:
        _seed_workbench_session(
            session_id="sess-1",
            test_id="test-abc",
            test_name="Running Test",
            status="running",
            execution_id="exec-42",
        )

        response = client_admin_allowed.get("/admin/workbench/session")

        assert response.status_code == 200
        body = response.json()
        assert body["session_id"] == "sess-1"
        assert body["test_id"] == "test-abc"
        assert body["test_name"] == "Running Test"
        assert body["status"] == "running"
        assert body["execution_id"] == "exec-42"

    def test_returns_empty_envelope_when_no_session(self, client_admin_allowed: TestClient) -> None:
        response = client_admin_allowed.get("/admin/workbench/session")

        assert response.status_code == 200
        body = response.json()
        # Documented empty shape: all fields null so consumers can uniformly
        # parse without null-vs-missing ambiguity.
        assert body["session_id"] is None
        assert body["test_id"] is None
        assert body["status"] is None


# ---------------------------------------------------------------------------
# DELETE /admin/workbench/session
# ---------------------------------------------------------------------------


class TestDeleteWorkbenchSession:
    def test_delete_terminates_active_session(self, client_admin_allowed: TestClient) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        _seed_workbench_session(session_id="sess-kill")
        assert "sess-kill" in workbench_service._workbench_sessions

        response = client_admin_allowed.delete("/admin/workbench/session")

        assert response.status_code == 200
        body = response.json()
        assert body["cleared"] is True
        assert "sess-kill" not in workbench_service._workbench_sessions
        assert "dev" not in workbench_service._user_active_session

    def test_delete_is_idempotent_when_no_session(self, client_admin_allowed: TestClient) -> None:
        response = client_admin_allowed.delete("/admin/workbench/session")

        assert response.status_code == 200
        assert response.json()["cleared"] is False

    def test_delete_followed_by_get_returns_empty(self, client_admin_allowed: TestClient) -> None:
        _seed_workbench_session(session_id="sess-cycle")

        client_admin_allowed.delete("/admin/workbench/session")
        response = client_admin_allowed.get("/admin/workbench/session")

        assert response.status_code == 200
        assert response.json()["session_id"] is None
