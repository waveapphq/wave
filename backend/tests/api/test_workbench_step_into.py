"""Unit tests for POST /workbench/{session_id}/step-into.

Endpoint contract:
    - 200 when session is paused: transitions to running; engine pauses BEFORE
      the next node encountered (the first body node for loops, the first node
      of the selected branch for If-Else, the immediate sibling for a leaf).
    - 404 body: ``^Workbench session '[^']+' not found$``.
    - 409 body: ``^Cannot step-into: session is '[^']+', not paused$``.
    - 400 on invalid UUID.

Engine contract:
    - Step-into sets ``session["pause_at_next_node"] = True`` (the renamed
      shared one-shot flag) which the next ``_maybe_pause_before_node`` call
      consumes to re-pause with ``reason="step"``.

UX:
    - Step-into on a leaf is identical to step-over.
    - Step-into on a loop with an empty runtime body (For count=0, ForEach
      over empty, While-false-on-first-check) collapses to step-over
      semantics: pauses on the ``then``-egress successor.
"""

import asyncio
import re
import uuid
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

_NOT_FOUND_RE = re.compile(r"^Workbench session '[^']+' not found$")
_CONFLICT_RE = re.compile(r"^Cannot step-into: session is '[^']+', not paused$")


def _make_session(session_id: str, *, breakpoints: set[str] | None = None) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Step-into Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(breakpoints or set()),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
    }


def _log_node(node_id: str, label: str, message: str = "'ok'") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _for_node(node_id: str, label: str, count: int) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "for",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {"mode": "count", "count": count},
                "profileBindings": [],
                "outputBindings": {"index": "i"},
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


class TestStepIntoEndpoint:
    """HTTP surface for POST /workbench/{session_id}/step-into."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    def test_200_transitions_status_to_running(self, client: TestClient, session_id: str) -> None:
        """Step-into releases pause and returns the running-state envelope."""
        with patch("wavecore.api.routes.workbench.workbench_service.step_into") as mock_step_into:
            mock_step_into.return_value = {
                "session_id": session_id,
                "status": "running",
            }

            response = client.post(f"/workbench/{session_id}/step-into")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["session_id"] == session_id
            assert data["data"]["status"] == "running"
            mock_step_into.assert_called_once_with(session_id=session_id)

    def test_200_accepts_empty_body(self, client: TestClient, session_id: str) -> None:
        """Step-into accepts a bodyless POST."""
        with patch("wavecore.api.routes.workbench.workbench_service.step_into") as mock_step_into:
            mock_step_into.return_value = {
                "session_id": session_id,
                "status": "running",
            }

            response = client.post(f"/workbench/{session_id}/step-into")

            assert response.status_code == 200

    def test_404_when_session_not_found_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """404 body matches ``^Workbench session '[^']+' not found$``."""
        with patch("wavecore.api.routes.workbench.workbench_service.step_into") as mock_step_into:
            mock_step_into.side_effect = LookupError(f"Workbench session '{session_id}' not found")

            response = client.post(f"/workbench/{session_id}/step-into")

            assert response.status_code == 404
            body = response.json()
            assert body["error"]["code"] == "NOT_FOUND"
            assert _NOT_FOUND_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_running_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Step-into on a running session returns 409 with the anchored message."""
        with patch("wavecore.api.routes.workbench.workbench_service.step_into") as mock_step_into:
            mock_step_into.side_effect = ConflictException(
                "Cannot step-into: session is 'running', not paused"
            )

            response = client.post(f"/workbench/{session_id}/step-into")

            assert response.status_code == 409
            body = response.json()
            assert _CONFLICT_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_terminal_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Terminal sessions (passed/failed/stopped) produce the 409 pattern."""
        with patch("wavecore.api.routes.workbench.workbench_service.step_into") as mock_step_into:
            mock_step_into.side_effect = ConflictException(
                "Cannot step-into: session is 'failed', not paused"
            )

            response = client.post(f"/workbench/{session_id}/step-into")

            assert response.status_code == 409
            assert _CONFLICT_RE.match(response.json()["error"]["message"]) is not None

    def test_400_for_invalid_session_id_uuid_format(self, client: TestClient) -> None:
        """Non-UUID path segment fails UUID validation."""
        response = client.post("/workbench/not-a-uuid/step-into")

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for session_id" in body["error"]["message"]


class TestStepIntoService:
    """Service-layer validation of ``workbench_service.step_into``."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    def test_raises_lookup_error_when_session_missing(self) -> None:
        """Unknown session id raises LookupError with exact message."""
        missing = "missing-session-id"
        with pytest.raises(LookupError) as exc_info:
            workbench_service.step_into(session_id=missing)
        assert f"Workbench session '{missing}' not found" in str(exc_info.value)

    def test_raises_conflict_when_session_running(self) -> None:
        """Non-paused session raises ConflictException with exact 409 text."""
        session_id = "step-into-running"
        session = _make_session(session_id)
        session["status"] = "running"
        _wb_common._workbench_sessions[session_id] = session

        with pytest.raises(ConflictException) as exc_info:
            workbench_service.step_into(session_id=session_id)
        assert "Cannot step-into: session is 'running', not paused" in str(exc_info.value)

    def test_raises_conflict_when_session_terminal(self) -> None:
        """Terminal session status yields the anchored 409 text."""
        session_id = "step-into-failed"
        session = _make_session(session_id)
        session["status"] = "failed"
        _wb_common._workbench_sessions[session_id] = session

        with pytest.raises(ConflictException) as exc_info:
            workbench_service.step_into(session_id=session_id)
        assert "Cannot step-into: session is 'failed', not paused" in str(exc_info.value)

    def test_paused_session_sets_pause_at_next_node_and_releases_pause(self) -> None:
        """Step-into arms the shared one-shot flag and releases pause."""
        session_id = "step-into-happy"
        session = _make_session(session_id)
        session["status"] = "paused"
        session["paused_node_id"] = "for-1"
        _wb_common._workbench_sessions[session_id] = session

        result = workbench_service.step_into(session_id=session_id)

        assert result["session_id"] == session_id
        assert result["status"] == "running"
        assert session.get("pause_at_next_node") is True
        assert session["pause_event"].is_set() is True


class TestStepIntoEngineIntegration:
    """End-to-end: step-into re-pauses on the next node encountered."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_step_into_leaf_pauses_on_immediate_successor(self) -> None:
        """Step-into on a leaf plugin behaves exactly like step-over."""
        session_id = "si-engine-leaf"
        session = _make_session(session_id, breakpoints={"node-b"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'"),
            _log_node("node-c", "C", "'c'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
            {"source": "node-b", "target": "node-c"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-b":
                break
        assert session["status"] == "paused"
        assert session["paused_node_id"] == "node-b"

        workbench_service.step_into(session_id=session_id)

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-c":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "node-c"
        assert session["block_states"].get("node-b") == "passed"
        assert session["block_states"].get("node-c") != "passed"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_step_into_for_loop_pauses_on_first_body_node(self) -> None:
        """Step-into on a For-loop pauses BEFORE the first body node executes."""
        session_id = "si-engine-for"
        session = _make_session(session_id, breakpoints={"for-1"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _for_node("for-1", "Loop", count=3),
            _log_node("body-log", "Body", "'iter'"),
            _log_node("after-log", "After", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "for-1":
                break
        assert session["paused_node_id"] == "for-1"

        workbench_service.step_into(session_id=session_id)

        for _ in range(400):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "body-log":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "body-log"
        assert (
            session["block_states"].get("body-log") != "passed"
        ), "first body node must not have executed yet"

        # Drive the run to completion so the task doesn't leak.
        while not task.done():
            session["pause_event"].set()
            await asyncio.sleep(0.05)
        await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_step_into_for_count_zero_collapses_to_step_over(self) -> None:
        """Step-into on For(count=0) pauses on the 'then' successor (empty body)."""
        session_id = "si-engine-for0"
        session = _make_session(session_id, breakpoints={"for-1"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _for_node("for-1", "Loop", count=0),
            _log_node("body-log", "Body", "'iter'"),
            _log_node("after-log", "After", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "for-1":
                break
        assert session["paused_node_id"] == "for-1"

        workbench_service.step_into(session_id=session_id)

        for _ in range(400):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "after-log":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after-log"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
