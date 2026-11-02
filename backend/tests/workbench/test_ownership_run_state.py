"""Run-state announce lifecycle on the ownership slot.

Covers ``set_run_state`` / ``get_run_state`` and the ``run_state_changed``
broadcast, the ``run`` projection on ``get_ownership`` and the REST ownership
endpoint, the replay to a fresh ``workbench:draft`` subscriber, and the
announce/clear hooks in the workbench run lifecycle (suite children excluded).
"""

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from fastapi import WebSocket
from fastapi.testclient import TestClient

from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import ownership

RUN_STATE: dict[str, Any] = {
    "session_id": "sess-1",
    "test_id": "test-1",
    "test_name": "Nightly Smoke",
    "environment_id": "env-1",
    "environment_name": "Staging",
    "status": "running",
}

OTHER_RUN_STATE: dict[str, Any] = {**RUN_STATE, "session_id": "sess-2", "test_name": "Other Test"}


def _fresh_ws() -> AsyncMock:
    """WebSocket-shaped mock that also evaluates truthy (``__len__`` != 0)."""
    ws = AsyncMock(spec=WebSocket)
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.__len__ = MagicMock(return_value=1)
    return ws


def _draft_events(ws: AsyncMock, event_name: str) -> list[dict[str, Any]]:
    return [
        call.args[0]["payload"]
        for call in ws.send_json.call_args_list
        if call.args
        and call.args[0].get("type") == "event"
        and call.args[0].get("topic") == "workbench:draft"
        and isinstance(call.args[0].get("payload"), dict)
        and call.args[0]["payload"].get("event") == event_name
    ]


class TestRunStateStore:
    """The slot stores the announced run and broadcasts every transition."""

    async def test_fresh_state_has_no_run(self) -> None:
        assert ownership.get_run_state() is None

    async def test_fresh_ownership_projection_carries_a_null_run(self) -> None:
        assert ownership.get_ownership()["run"] is None

    async def test_set_run_state_stores_the_run(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.set_run_state(RUN_STATE)

        assert ownership.get_run_state() == RUN_STATE

    async def test_set_run_state_broadcasts_the_event(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.set_run_state(RUN_STATE)

        mock_emit.assert_called_once_with({"event": "run_state_changed", "run": RUN_STATE})

    async def test_ownership_projection_carries_the_run(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.set_run_state(RUN_STATE)

        assert ownership.get_ownership()["run"] == RUN_STATE

    async def test_repeating_the_same_run_state_broadcasts_once(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.set_run_state(RUN_STATE)
            ownership.set_run_state(dict(RUN_STATE))

        assert mock_emit.call_count == 1

    async def test_a_different_run_state_broadcasts_again(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.set_run_state(RUN_STATE)
            ownership.set_run_state(OTHER_RUN_STATE)

        assert mock_emit.call_count == 2
        assert ownership.get_run_state() == OTHER_RUN_STATE

    async def test_clearing_the_run_broadcasts_a_null_run(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.set_run_state(RUN_STATE)
            mock_emit.reset_mock()

            ownership.set_run_state(None)

        assert ownership.get_run_state() is None
        mock_emit.assert_called_once_with({"event": "run_state_changed", "run": None})

    async def test_clearing_an_already_clear_run_broadcasts_nothing(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.set_run_state(None)

        assert mock_emit.call_count == 0

    async def test_clear_resets_the_run_state(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.set_run_state(RUN_STATE)

        ownership.clear()

        assert ownership.get_run_state() is None

    async def test_run_state_is_tied_to_the_run_not_the_holder(self) -> None:
        """The announce follows the run lifecycle; a holder change does not end it."""
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            ownership.set_run_state(RUN_STATE)
            ownership.release("h1")

        assert ownership.get_run_state() == RUN_STATE


class TestOwnershipRouteRunProjection:
    """``GET /workbench/ownership`` exposes the announced run to any viewer."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_route_returns_null_run_when_idle(self, client: TestClient) -> None:
        response = client.get("/workbench/ownership", params={"holder_id": "anyone"})

        assert response.status_code == 200
        assert response.json()["data"]["run"] is None

    def test_route_returns_the_announced_run(self, client: TestClient) -> None:
        with patch.object(ownership, "_emit"):
            ownership.set_run_state(RUN_STATE)

        response = client.get("/workbench/ownership", params={"holder_id": "anyone"})

        assert response.json()["data"]["run"] == RUN_STATE


class TestRunStateReplay:
    """A tab subscribing to the draft topic mid-run is told about the run."""

    async def test_fresh_subscriber_receives_the_current_run(self) -> None:
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws = _fresh_ws()
        conn_id = await manager.connect(ws)
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            ownership.set_run_state(RUN_STATE)

        ws.send_json.reset_mock()
        await manager.handle_message(
            conn_id, json.dumps({"type": "subscribe", "topic": "workbench:draft"})
        )

        assert _draft_events(ws, "run_state_changed") == [
            {"event": "run_state_changed", "run": RUN_STATE}
        ]

    async def test_fresh_subscriber_receives_the_run_without_a_holder(self) -> None:
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws = _fresh_ws()
        conn_id = await manager.connect(ws)
        with patch.object(ownership, "_emit"):
            ownership.set_run_state(RUN_STATE)

        ws.send_json.reset_mock()
        await manager.handle_message(
            conn_id, json.dumps({"type": "subscribe", "topic": "workbench:draft"})
        )

        assert _draft_events(ws, "run_state_changed") == [
            {"event": "run_state_changed", "run": RUN_STATE}
        ]

    async def test_no_run_replays_nothing(self) -> None:
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws = _fresh_ws()
        conn_id = await manager.connect(ws)
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

        ws.send_json.reset_mock()
        await manager.handle_message(
            conn_id, json.dumps({"type": "subscribe", "topic": "workbench:draft"})
        )

        assert _draft_events(ws, "run_state_changed") == []

    async def test_other_topics_do_not_replay_the_run(self) -> None:
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws = _fresh_ws()
        conn_id = await manager.connect(ws)
        with patch.object(ownership, "_emit"):
            ownership.set_run_state(RUN_STATE)

        ws.send_json.reset_mock()
        await manager.handle_message(
            conn_id, json.dumps({"type": "subscribe", "topic": "workbench:sess-1"})
        )

        assert _draft_events(ws, "run_state_changed") == []


class TestRunLifecycleAnnounce:
    """``start_workbench_run`` announces; the terminal callback clears."""

    TEST_ID = "11111111-1111-1111-1111-111111111111"
    ENVIRONMENT_ID = "22222222-2222-2222-2222-222222222222"

    @pytest.fixture(autouse=True)
    def _inert_engine(self) -> Any:
        wb_common._clear_sessions_sync()
        with patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task:
            mock_task.return_value = Mock()
            yield mock_task
        wb_common._clear_sessions_sync()

    def _test_entity(self) -> dict[str, Any]:
        return {
            "id": self.TEST_ID,
            "name": "Nightly Smoke",
            "workflow": {
                "nodes": [
                    {
                        "id": "node-1",
                        "type": "workflowNode",
                        "data": {
                            "label": "Wait",
                            "elementType": "delay",
                            "nodeType": "control",
                            "version": "1.0.0",
                            "config": {"values": {"duration": 10}},
                        },
                    }
                ],
                "edges": [],
            },
            "variables": {},
        }

    def _environment(self) -> dict[str, Any]:
        return {"id": self.ENVIRONMENT_ID, "name": "Staging"}

    def _run(self, session_id: str, lineage: Any = None) -> dict[str, Any]:
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test",
                return_value=self._test_entity(),
            ),
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test_variables_raw",
                return_value={},
            ),
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test",
                return_value=None,
            ),
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment",
                return_value=self._environment(),
            ),
            patch.object(ownership, "_emit"),
        ):
            return workbench_service.start_workbench_run(
                test_id=self.TEST_ID,
                environment_id=self.ENVIRONMENT_ID,
                session_id=session_id,
                lineage=lineage,
            )

    def test_ephemeral_run_announces_with_environment_names(self) -> None:
        session_id = str(uuid.uuid4())

        self._run(session_id)

        assert ownership.get_run_state() == {
            "session_id": session_id,
            "test_id": self.TEST_ID,
            "test_name": "Nightly Smoke",
            "environment_id": self.ENVIRONMENT_ID,
            "environment_name": "Staging",
            "status": "running",
        }

    def test_tracked_test_run_announces(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        session_id = str(uuid.uuid4())

        self._run(
            session_id,
            lineage=workbench_service.RunLineage(execution_id=session_id),
        )

        assert ownership.get_run_state() is not None
        assert ownership.get_run_state()["session_id"] == session_id

    def test_suite_child_run_never_announces(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        session_id = str(uuid.uuid4())

        self._run(
            session_id,
            lineage=workbench_service.RunLineage(
                parent_execution_id=str(uuid.uuid4()), suite_id=str(uuid.uuid4())
            ),
        )

        assert ownership.get_run_state() is None

    def test_child_session_of_another_execution_never_announces(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        session_id = str(uuid.uuid4())

        self._run(
            session_id,
            lineage=workbench_service.RunLineage(execution_id=str(uuid.uuid4())),
        )

        assert ownership.get_run_state() is None

    def test_terminal_clears_the_announced_run(self) -> None:
        session_id = str(uuid.uuid4())
        self._run(session_id)

        with patch.object(ownership, "_emit"):
            wb_common._notify_terminal(session_id, "passed")

        assert ownership.get_run_state() is None

    def test_terminal_of_another_session_keeps_the_announced_run(self) -> None:
        session_id = str(uuid.uuid4())
        self._run(session_id)

        with patch.object(ownership, "_emit"):
            wb_common._notify_terminal(str(uuid.uuid4()), "passed")

        assert ownership.get_run_state() is not None

    def test_terminal_without_an_announced_run_is_a_no_op(self) -> None:
        with patch.object(ownership, "_emit"):
            wb_common._notify_terminal(str(uuid.uuid4()), "failed")

        assert ownership.get_run_state() is None
