"""Direct-call unit tests for Workbench debug service functions.

Covers the lines in ``wavecore.api.services.workbench.service`` and
``_common`` that the existing endpoint tests skip because they mock the
service layer.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _seed_session(
    session_id: str,
    *,
    status: str,
    paused_node_id: str | None = None,
    breakpoints: set[str] | None = None,
    pause_event: asyncio.Event | None = None,
) -> dict[str, Any]:
    """Insert a session dict directly into the in-memory session store."""
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": status,
        "breakpoints": set(breakpoints or set()),
        "debug_options": None,
        "pause_event": pause_event,
        "paused_node_id": paused_node_id,
        "skipped_node_ids": [],
        "block_states": {},
    }
    _wb_common._workbench_sessions[session_id] = session
    return session


class TestUpdateBreakpointsDirect:
    """Direct calls against ``workbench_service.update_breakpoints``."""

    def setup_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def teardown_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def test_raises_lookup_error_when_session_missing(self) -> None:
        with pytest.raises(LookupError, match="Workbench session 'missing' not found"):
            workbench_service.update_breakpoints("missing", ["bp"])

    def test_raises_conflict_when_session_is_idle(self) -> None:
        from wavecore.api.exceptions import ConflictException

        _seed_session("sess-idle", status="idle")
        with pytest.raises(ConflictException):
            workbench_service.update_breakpoints("sess-idle", ["bp"])

    def test_replaces_breakpoints_when_running(self) -> None:
        _seed_session("sess-run", status="running", breakpoints={"old"})
        result = workbench_service.update_breakpoints("sess-run", ["a", "b"])
        assert result == {"session_id": "sess-run", "breakpoints": ["a", "b"]}
        assert _wb_common._workbench_sessions["sess-run"]["breakpoints"] == {"a", "b"}

    def test_replaces_breakpoints_when_paused(self) -> None:
        _seed_session("sess-paused", status="paused", breakpoints={"old"})
        result = workbench_service.update_breakpoints("sess-paused", [])
        assert result == {"session_id": "sess-paused", "breakpoints": []}
        assert _wb_common._workbench_sessions["sess-paused"]["breakpoints"] == set()


class TestContinueSessionDirect:
    def setup_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def teardown_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def test_raises_lookup_error_when_session_missing(self) -> None:
        with pytest.raises(LookupError, match="Workbench session 'missing' not found"):
            workbench_service.continue_session("missing")

    def test_raises_conflict_when_session_not_paused(self) -> None:
        from wavecore.api.exceptions import ConflictException

        _seed_session("sess-run", status="running")
        with pytest.raises(ConflictException):
            workbench_service.continue_session("sess-run")

    def test_sets_pause_event_and_returns_running(self) -> None:
        event = asyncio.Event()
        _seed_session("sess-paused", status="paused", paused_node_id="n", pause_event=event)
        result = workbench_service.continue_session("sess-paused")
        assert result == {"session_id": "sess-paused", "status": "running"}
        assert event.is_set()
        assert _wb_common._workbench_sessions["sess-paused"]["paused_node_id"] is None

    def test_handles_missing_pause_event_gracefully(self) -> None:
        _seed_session("sess-paused", status="paused", paused_node_id="n", pause_event=None)
        result = workbench_service.continue_session("sess-paused")
        assert result == {"session_id": "sess-paused", "status": "running"}


class TestSkipCurrentBlockDirect:
    def setup_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def teardown_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def test_raises_lookup_error_when_session_missing(self) -> None:
        with pytest.raises(LookupError, match="Workbench session 'missing' not found"):
            workbench_service.skip_current_block("missing")

    def test_raises_conflict_when_session_not_paused(self) -> None:
        from wavecore.api.exceptions import ConflictException

        _seed_session("sess-run", status="running")
        with pytest.raises(ConflictException):
            workbench_service.skip_current_block("sess-run")

    def test_raises_conflict_when_paused_node_id_missing(self) -> None:
        from wavecore.api.exceptions import ConflictException

        # status=paused but paused_node_id is None (shouldn't happen in
        # practice, but the service guards against it explicitly).
        _seed_session("sess-paused", status="paused", paused_node_id=None)
        with pytest.raises(ConflictException):
            workbench_service.skip_current_block("sess-paused")

    def test_marks_node_skipped_and_sets_resume_flag(self) -> None:
        event = asyncio.Event()
        _seed_session(
            "sess-paused",
            status="paused",
            paused_node_id="node-x",
            pause_event=event,
        )
        result = workbench_service.skip_current_block("sess-paused")
        assert result == {
            "session_id": "sess-paused",
            "status": "paused",
            "skipped_node_id": "node-x",
        }
        session = _wb_common._workbench_sessions["sess-paused"]
        assert "node-x" in session["skipped_node_ids"]
        assert session["block_states"]["node-x"] == "skipped"
        assert session["pause_at_next_node"] is True
        assert event.is_set()

    def test_skip_is_idempotent_on_already_skipped_node(self) -> None:
        event = asyncio.Event()
        session = _seed_session(
            "sess-paused",
            status="paused",
            paused_node_id="node-y",
            pause_event=event,
        )
        session["skipped_node_ids"] = ["node-y"]
        workbench_service.skip_current_block("sess-paused")
        # The duplicate-guard branch: already in skipped_node_ids → no append.
        assert session["skipped_node_ids"].count("node-y") == 1


class TestPauseForDebugDirect:
    """Covers the ``pause_event is None`` defensive branch in _pause_for_debug."""

    def setup_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def teardown_method(self) -> None:
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_pause_for_debug_noop_when_pause_event_missing(self) -> None:
        session: dict[str, Any] = {
            "session_id": "sess-nopause",
            "status": "running",
            "breakpoints": set(),
            "debug_options": None,
            "pause_event": None,
            "paused_node_id": None,
        }
        # Should return silently without mutating status.
        await _wb_common._pause_for_debug(session, "sess-nopause", "n", "Name", "breakpoint")
        assert session["status"] == "running"
        assert session["paused_node_id"] is None


class TestMaybePauseBeforeNodeStopCases:
    """Covers stop-after-pause branches in ``_maybe_pause_before_node``.

    These tests schedule a concurrent task that flips status to STOPPED while
    the engine is waiting inside ``_pause_for_debug``, simulating the real
    flow where the /workbench/{id}/stop endpoint cancels the running task
    mid-pause. The task-based approach is needed because ``_pause_for_debug``
    unconditionally overwrites session["status"] to PAUSED and, on normal
    resume, back to RUNNING.
    """

    def setup_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def teardown_method(self) -> None:
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_returns_true_when_step_pause_then_stop(self) -> None:
        event = asyncio.Event()
        session: dict[str, Any] = {
            "session_id": "sess-step",
            "status": "running",
            "breakpoints": set(),
            "debug_options": None,
            "pause_event": event,
            "paused_node_id": None,
            "pause_at_next_node": True,
        }

        async def stop_then_resume() -> None:
            # Wait a tick so _pause_for_debug has transitioned status to
            # PAUSED and begun awaiting pause_event, then simulate a user
            # Stop by flipping status to STOPPED and releasing pause_event.
            await asyncio.sleep(0.01)
            session["status"] = _wb_common.WorkbenchStatus.STOPPED.value
            event.set()

        stopper = asyncio.create_task(stop_then_resume())
        result = await _wb_common._maybe_pause_before_node(
            session, "sess-step", "node-next", "Next"
        )
        await stopper
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_true_when_breakpoint_pause_then_stop(self) -> None:
        event = asyncio.Event()
        session: dict[str, Any] = {
            "session_id": "sess-bp",
            "status": "running",
            "breakpoints": {"node-bp"},
            "debug_options": None,
            "pause_event": event,
            "paused_node_id": None,
        }

        async def stop_then_resume() -> None:
            await asyncio.sleep(0.01)
            session["status"] = _wb_common.WorkbenchStatus.STOPPED.value
            event.set()

        stopper = asyncio.create_task(stop_then_resume())
        result = await _wb_common._maybe_pause_before_node(session, "sess-bp", "node-bp", "Name")
        await stopper
        assert result is True
