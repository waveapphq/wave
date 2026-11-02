"""A refused execution start leaves no execution behind (REQ-5.2.4.6)."""

from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services import log_streaming_service
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.workbench import _common as wb_common

TEST_ENV_ID = "env-test-00000000-0000-0000-0000-000000000001"

LOG_WORKFLOW: dict[str, Any] = {
    "nodes": [
        {
            "id": "node-log-1",
            "type": "workflowNode",
            "position": {"x": 100, "y": 100},
            "data": {
                "label": "Say Hello",
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {"values": {"message": "hello"}},
            },
        }
    ],
    "edges": [{"id": "edge-start-node-log-1", "source": "start-node", "target": "node-log-1"}],
}


@pytest.fixture(autouse=True)
def _log_plugin_and_controls() -> Generator[None, None, None]:
    """The run gate validates the Log block, so its plugin and the controls are registered."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    clear_registry()
    _registry.clear()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _create_log_test() -> str:
    test = test_service.create_test(
        {
            "name": "Refused Start",
            "variables": {"tier": {"type": "integer", "value": 1}},
            "workflow": LOG_WORKFLOW,
        }
    )
    return str(test["id"])


def _start(client: TestClient, test_id: str, variables: dict[str, Any] | None = None) -> Any:
    body: dict[str, Any] = {"type": "test", "id": test_id, "environment_id": TEST_ENV_ID}
    if variables is not None:
        body["variables"] = variables
    return client.post("/executions", json=body)


def _hold_a_live_session() -> None:
    wb_common._workbench_sessions["live-session-1"] = {
        "session_id": "live-session-1",
        "status": "running",
        "execution_id": None,
    }
    wb_common._user_active_session[wb_common.DEFAULT_USER_ID] = "live-session-1"


def _artifact_dirs() -> list[str]:
    root = get_artifacts_storage_path()
    return sorted(p.name for p in root.iterdir()) if root.exists() else []


class TestRefusedRestStart:
    """POST /executions refused by the run checks writes no execution of the test."""

    def test_undeclared_override_keeps_its_refusal_message(self, client: TestClient) -> None:
        test_id = _create_log_test()

        response = _start(client, test_id, {"nope": 1})

        assert response.status_code == 400
        assert response.json()["error"]["message"] == (
            "Variable 'nope' is not declared by this test"
        )

    def test_undeclared_override_leaves_no_execution(self, client: TestClient) -> None:
        test_id = _create_log_test()

        _start(client, test_id, {"nope": 1})

        assert client.get("/executions", params={"entity_id": test_id}).json()["data"] == []
        assert exec_storage._execution_storage == {}
        assert exec_storage._load_all_executions() == []

    def test_undeclared_override_leaves_the_test_deletable(self, client: TestClient) -> None:
        test_id = _create_log_test()

        _start(client, test_id, {"nope": 1})

        assert client.delete(f"/tests/{test_id}").status_code == 204

    def test_undeclared_override_leaves_no_artifact_dir_or_log_route(
        self, client: TestClient
    ) -> None:
        test_id = _create_log_test()
        sinks_before = dict(log_streaming_service._session_sink)

        _start(client, test_id, {"nope": 1})

        assert _artifact_dirs() == []
        assert log_streaming_service._session_sink == sinks_before

    def test_live_session_conflict_leaves_no_execution(self, client: TestClient) -> None:
        test_id = _create_log_test()
        _hold_a_live_session()

        response = _start(client, test_id)

        assert response.status_code == 409
        assert response.json()["error"]["message"] == (
            "User already has an active workbench session: live-session-1. "
            "Stop the current workbench or tracked execution before starting a new one."
        )
        assert exec_storage._load_all_executions() == []
        assert _artifact_dirs() == []
        assert client.delete(f"/tests/{test_id}").status_code == 204
