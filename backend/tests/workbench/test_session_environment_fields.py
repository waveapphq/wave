"""Environment fields on the workbench session payload.

``get_session_for_user`` (and therefore ``GET /workbench/session``) returns
``environment_id`` and ``environment_name``, so a watcher can reflect the run's environment.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import service as workbench_service

USER_ID = wb_common.DEFAULT_USER_ID


def _seed_session(**overrides: Any) -> str:
    session_id = "sess-env-1"
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": "running",
        "test_id": "test-1",
        "test_name": "Nightly Smoke",
        "environment_id": "env-1",
        "environment_name": "Staging",
        "websocket_topic": f"workbench:{session_id}",
        "current_block": None,
        "progress": {"current": 0, "total": 1, "percentage": 0.0},
        "block_states": {},
        "execution_id": None,
        "parent_execution_id": None,
        "error": None,
    }
    session.update(overrides)
    wb_common._workbench_sessions[session_id] = session
    wb_common._user_active_session[USER_ID] = session_id
    return session_id


class TestSessionServiceProjection:
    def test_projection_carries_the_environment_id(self) -> None:
        _seed_session()

        assert workbench_service.get_session_for_user()["environment_id"] == "env-1"

    def test_projection_carries_the_environment_name(self) -> None:
        _seed_session()

        assert workbench_service.get_session_for_user()["environment_name"] == "Staging"

    def test_projection_is_null_safe_when_the_environment_name_is_absent(self) -> None:
        session_id = _seed_session()
        del wb_common._workbench_sessions[session_id]["environment_name"]

        assert workbench_service.get_session_for_user()["environment_name"] is None

    def test_projection_is_null_safe_when_the_environment_id_is_absent(self) -> None:
        session_id = _seed_session()
        del wb_common._workbench_sessions[session_id]["environment_id"]

        assert workbench_service.get_session_for_user()["environment_id"] is None

    def test_no_session_still_returns_none(self) -> None:
        assert workbench_service.get_session_for_user() is None


class TestSessionRoute:
    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_route_exposes_the_environment_fields(self, client: TestClient) -> None:
        _seed_session()

        response = client.get("/workbench/session")

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["environment_id"] == "env-1"
        assert data["environment_name"] == "Staging"

    def test_route_keeps_returning_null_without_a_session(self, client: TestClient) -> None:
        response = client.get("/workbench/session")

        assert response.status_code == 200
        assert response.json()["data"] is None
