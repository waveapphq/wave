"""Unit tests for POST /workbench/{session_id}/repeat-step.

Endpoint contract:
    - 200 when session is paused AND ``paused_node_id`` is non-None: the
      engine re-runs the paused block in place and re-pauses on the same
      node. Response envelope carries ``session_id``, ``status="paused"``,
      and ``repeated_node_id``.
    - 404 body: ``^Workbench session '[^']+' not found$`` when the session
      id is unknown.
    - 404 body: ``^Cannot repeat: no currently paused block$`` when the
      session is paused but ``paused_node_id`` is None.
    - 409 body: ``^Cannot repeat: session is '[^']+', not paused$`` when
      the session is running, terminal, or otherwise not paused.
    - 400 on invalid UUID.

Engine contract:
    - ``repeat_step_requested: bool`` is consumed inside ``_pause_for_debug``'s
      wait-loop, which re-runs the paused block its running flow points Repeat
      Step at and re-enters ``pause_event.wait()`` WITHOUT clearing ``paused_node_id``.
    - A new ``debug_breakpoint_hit`` event is emitted with ``reason="step_complete"``
      on a successful repeat; failure-outcome repeats reuse ``reason="error"``.
    - Variable writes produced during Repeat commit immediately (no sandbox).
      The latest re-run is the block's result: Continue and Step Over route
      from it without running the block again (REQ-3.2.1.4).

UX:
    - Repeat Step preserves the paused state on the same block across any
      number of clicks.
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
_NO_PAUSED_BLOCK_RE = re.compile(r"^Cannot repeat: no currently paused block$")
_CONFLICT_RE = re.compile(r"^Cannot repeat: session is '[^']+', not paused$")


def _make_session(session_id: str, *, breakpoints: set[str] | None = None) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Repeat-step Test",
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


class TestRepeatStepEndpoint:
    """HTTP surface for POST /workbench/{session_id}/repeat-step."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    def test_200_returns_paused_status_and_repeated_node_id(
        self, client: TestClient, session_id: str
    ) -> None:
        """Repeat returns a paused-state envelope with ``repeated_node_id``."""
        repeated_node_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.workbench.workbench_service.repeat_step") as mock_repeat:
            mock_repeat.return_value = {
                "session_id": session_id,
                "status": "paused",
                "repeated_node_id": repeated_node_id,
            }

            response = client.post(f"/workbench/{session_id}/repeat-step")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["session_id"] == session_id
            assert data["data"]["status"] == "paused"
            assert data["data"]["repeated_node_id"] == repeated_node_id
            mock_repeat.assert_called_once_with(session_id=session_id)

    def test_200_accepts_empty_body(self, client: TestClient, session_id: str) -> None:
        """Repeat-step accepts a bodyless POST."""
        with patch("wavecore.api.routes.workbench.workbench_service.repeat_step") as mock_repeat:
            mock_repeat.return_value = {
                "session_id": session_id,
                "status": "paused",
                "repeated_node_id": "node-x",
            }

            response = client.post(f"/workbench/{session_id}/repeat-step")

            assert response.status_code == 200

    def test_404_when_session_not_found_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """404 body matches ``^Workbench session '[^']+' not found$``."""
        with patch("wavecore.api.routes.workbench.workbench_service.repeat_step") as mock_repeat:
            mock_repeat.side_effect = LookupError(f"Workbench session '{session_id}' not found")

            response = client.post(f"/workbench/{session_id}/repeat-step")

            assert response.status_code == 404
            body = response.json()
            assert body["error"]["code"] == "NOT_FOUND"
            assert _NOT_FOUND_RE.match(body["error"]["message"]) is not None

    def test_404_when_no_currently_paused_block_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Paused with no ``paused_node_id`` returns 404 with the exact message."""
        with patch("wavecore.api.routes.workbench.workbench_service.repeat_step") as mock_repeat:
            mock_repeat.side_effect = LookupError("Cannot repeat: no currently paused block")

            response = client.post(f"/workbench/{session_id}/repeat-step")

            assert response.status_code == 404
            body = response.json()
            assert body["error"]["code"] == "NOT_FOUND"
            assert _NO_PAUSED_BLOCK_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_running_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Repeat on a running session returns 409 with the anchored message."""
        with patch("wavecore.api.routes.workbench.workbench_service.repeat_step") as mock_repeat:
            mock_repeat.side_effect = ConflictException(
                "Cannot repeat: session is 'running', not paused"
            )

            response = client.post(f"/workbench/{session_id}/repeat-step")

            assert response.status_code == 409
            body = response.json()
            assert _CONFLICT_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_terminal_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Terminal sessions (passed/failed/stopped) produce the 409 pattern."""
        with patch("wavecore.api.routes.workbench.workbench_service.repeat_step") as mock_repeat:
            mock_repeat.side_effect = ConflictException(
                "Cannot repeat: session is 'passed', not paused"
            )

            response = client.post(f"/workbench/{session_id}/repeat-step")

            assert response.status_code == 409
            assert _CONFLICT_RE.match(response.json()["error"]["message"]) is not None

    def test_400_for_invalid_session_id_uuid_format(self, client: TestClient) -> None:
        """Non-UUID path segment fails UUID validation."""
        response = client.post("/workbench/not-a-uuid/repeat-step")

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for session_id" in body["error"]["message"]


class TestRepeatStepService:
    """Service-layer validation of ``workbench_service.repeat_step``."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    def test_raises_lookup_error_when_session_missing(self) -> None:
        """Unknown session id raises LookupError with exact message."""
        missing = "missing-session-id"
        with pytest.raises(LookupError) as exc_info:
            workbench_service.repeat_step(session_id=missing)
        assert f"Workbench session '{missing}' not found" in str(exc_info.value)

    def test_raises_conflict_when_session_running(self) -> None:
        """Non-paused session raises ConflictException with exact 409 text."""
        session_id = "repeat-running"
        session = _make_session(session_id)
        session["status"] = "running"
        _wb_common._workbench_sessions[session_id] = session

        with pytest.raises(ConflictException) as exc_info:
            workbench_service.repeat_step(session_id=session_id)
        assert "Cannot repeat: session is 'running', not paused" in str(exc_info.value)

    def test_raises_conflict_when_session_terminal(self) -> None:
        """Terminal session yields the anchored 409 text."""
        session_id = "repeat-passed"
        session = _make_session(session_id)
        session["status"] = "passed"
        _wb_common._workbench_sessions[session_id] = session

        with pytest.raises(ConflictException) as exc_info:
            workbench_service.repeat_step(session_id=session_id)
        assert "Cannot repeat: session is 'passed', not paused" in str(exc_info.value)

    def test_raises_lookup_error_when_no_paused_node(self) -> None:
        """Paused session with no ``paused_node_id`` raises LookupError."""
        session_id = "repeat-no-paused-node"
        session = _make_session(session_id)
        session["status"] = "paused"
        session["paused_node_id"] = None
        _wb_common._workbench_sessions[session_id] = session

        with pytest.raises(LookupError) as exc_info:
            workbench_service.repeat_step(session_id=session_id)
        assert "Cannot repeat: no currently paused block" in str(exc_info.value)

    def test_paused_session_sets_repeat_flag_and_releases_pause(self) -> None:
        """Repeat arms ``repeat_step_requested`` and releases the pause event."""
        session_id = "repeat-happy"
        session = _make_session(session_id)
        session["status"] = "paused"
        session["paused_node_id"] = "node-b"
        _wb_common._workbench_sessions[session_id] = session

        result = workbench_service.repeat_step(session_id=session_id)

        assert result["session_id"] == session_id
        assert result["status"] == "paused"
        assert result["repeated_node_id"] == "node-b"
        assert session.get("repeat_step_requested") is True
        assert session["pause_event"].is_set() is True


class TestPauseForDebugRepeatLoopUnit:
    """Cover the ``_pause_for_debug`` loop branches that don't fire from the
    end-to-end engine path (defensive fallthrough + repeat-time exception).
    """

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_repeat_without_callback_loops_back_to_wait(self) -> None:
        """``repeat_step_requested`` without a callback loops without re-running."""
        session_id = "rs-no-callback"
        event = asyncio.Event()
        session: dict[str, Any] = {
            "session_id": session_id,
            "status": "running",
            "block_states": {},
            "breakpoints": set(),
            "debug_options": None,
            "pause_event": event,
            "paused_node_id": None,
            # Note: deliberately no repeat scope set
        }
        _wb_common._workbench_sessions[session_id] = session

        async def driver() -> None:
            # First wakeup: arms repeat_step but no callback - loop continues.
            await asyncio.sleep(0.01)
            session["repeat_step_requested"] = True
            event.set()
            await asyncio.sleep(0.02)
            # Second wakeup: plain Continue - loop exits.
            event.set()

        driver_task = asyncio.create_task(driver())
        await _wb_common._pause_for_debug(session, session_id, "node-x", "Block X", "breakpoint")
        await driver_task

        assert session["status"] == "running"
        assert session["paused_node_id"] is None

    @pytest.mark.asyncio
    async def test_repeat_callback_exception_emits_error_reason(self) -> None:
        """A rerun that raises surfaces ``reason="error"`` and stays paused."""
        session_id = "rs-callback-error"
        event = asyncio.Event()

        async def failing_run(_attempt: _wb_common.BlockAttempt) -> str:
            raise RuntimeError("boom")

        async def no_skip() -> bool:
            return False

        session: dict[str, Any] = {
            "session_id": session_id,
            "status": "running",
            "block_states": {},
            "breakpoints": set(),
            "debug_options": None,
            "pause_event": event,
            "paused_node_id": None,
        }
        _wb_common._workbench_sessions[session_id] = session

        captured: list[dict[str, Any]] = []
        original = _wb_common._broadcast_event

        async def capture(_sid: str, evt: dict[str, Any]) -> None:
            captured.append(evt)
            await original(_sid, evt)

        async def driver() -> None:
            await asyncio.sleep(0.01)
            session["repeat_step_requested"] = True
            event.set()
            await asyncio.sleep(0.05)
            # Continue out
            event.set()

        with patch.object(_wb_common, "_broadcast_event", side_effect=capture):
            driver_task = asyncio.create_task(driver())
            block = _wb_common.DebugBlock(
                session, session_id, "node-x", "Block X", failing_run, no_skip
            )
            with _wb_common._repeat_scope(block):
                await _wb_common._pause_for_debug(
                    session, session_id, "node-x", "Block X", "breakpoint"
                )
            await driver_task

        hits = [e for e in captured if e.get("type") == "debug_breakpoint_hit"]
        assert len(hits) >= 2
        repeat_hit = hits[1]
        assert repeat_hit["reason"] == "error"
        assert repeat_hit["exception_class"] == "RuntimeError"
        assert repeat_hit["exception_message"] == "boom"
        assert session["block_states"]["node-x"] == "failed"
        assert block.latest is not None and str(block.latest.error) == "boom"


class TestRepeatStepEngineIntegration:
    """End-to-end: repeat-step keeps the session paused on the same node after re-run."""

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
    async def test_repeat_passing_block_stays_paused_with_step_complete_reason(self) -> None:
        """Repeat on a passing block re-runs and re-pauses with ``reason="step_complete"``."""
        session_id = "rs-engine-pass"
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

        captured: list[dict[str, Any]] = []
        original_broadcast = _wb_common._broadcast_event

        async def capture(_sid: str, event: dict[str, Any]) -> None:
            captured.append(event)
            await original_broadcast(_sid, event)

        with patch.object(_wb_common, "_broadcast_event", side_effect=capture):
            task = asyncio.create_task(
                workbench_service._execute_workflow(session_id, nodes, edges, {})
            )

            for _ in range(200):
                await asyncio.sleep(0.01)
                if session.get("paused_node_id") == "node-b":
                    break
            assert session["paused_node_id"] == "node-b"

            hits_before = len([e for e in captured if e.get("type") == "debug_breakpoint_hit"])

            result = workbench_service.repeat_step(session_id=session_id)
            assert result["status"] == "paused"
            assert result["repeated_node_id"] == "node-b"

            for _ in range(200):
                await asyncio.sleep(0.01)
                hits_now = [e for e in captured if e.get("type") == "debug_breakpoint_hit"]
                if len(hits_now) > hits_before:
                    break

            hits_after = [e for e in captured if e.get("type") == "debug_breakpoint_hit"]
            assert (
                len(hits_after) > hits_before
            ), "engine must emit a post-repeat debug_breakpoint_hit"

            latest = hits_after[-1]
            assert latest["node_id"] == "node-b"
            assert latest["reason"] == "step_complete"

            assert session["status"] == "paused"
            assert session["paused_node_id"] == "node-b"
            assert session["block_states"].get("node-b") == "passed"

            session["pause_event"].set()
            await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_repeat_twice_keeps_node_paused(self) -> None:
        """Two consecutive repeats both keep the engine paused on the same block."""
        session_id = "rs-engine-twice"
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
        assert session["paused_node_id"] == "node-b"

        workbench_service.repeat_step(session_id=session_id)
        for _ in range(200):
            await asyncio.sleep(0.01)
            if (
                session.get("paused_node_id") == "node-b"
                and session["pause_event"].is_set() is False
            ):
                break
        assert session["paused_node_id"] == "node-b"

        workbench_service.repeat_step(session_id=session_id)
        for _ in range(200):
            await asyncio.sleep(0.01)
            if (
                session.get("paused_node_id") == "node-b"
                and session["pause_event"].is_set() is False
            ):
                break
        assert session["paused_node_id"] == "node-b"
        assert session["status"] == "paused"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_continue_after_repeats_uses_final_attempt_routing(self) -> None:
        """Continue after a repeat advances past the block from the repeat's result."""
        session_id = "rs-engine-final"
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
        assert session["paused_node_id"] == "node-b"

        workbench_service.repeat_step(session_id=session_id)
        for _ in range(200):
            await asyncio.sleep(0.01)
            if (
                session.get("paused_node_id") == "node-b"
                and session["pause_event"].is_set() is False
            ):
                break
        assert session["paused_node_id"] == "node-b"

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=5.0)

        assert session["status"] == "passed"
        assert session["block_states"]["node-b"] == "passed"
        assert session["block_states"]["node-c"] == "passed"
