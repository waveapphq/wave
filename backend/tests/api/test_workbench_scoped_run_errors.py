"""Error-path coverage for ``_start_scoped_function_run`` + ``_run_scoped_function``.

The happy-path scoped run is covered by ``test_workbench_function_runs.py``;
this file targets the four rejection / failure branches per REQ-3.2.1.1.
"""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench.functions import FunctionCanvas
from wavecore.core.functions.executor import ScopedStart


@pytest.fixture(autouse=True)
def _clean_state() -> Generator[None, None, None]:
    _wb_common._clear_sessions_sync()
    workbench_service._user_active_session.clear()
    yield
    _wb_common._clear_sessions_sync()
    workbench_service._user_active_session.clear()


_FN_SCOPE = workbench_service.ScopedRunOptions(mode="function", function_node_id="fn-1")


def _function_run(function_node: dict[str, Any]) -> Any:
    """A Run Scope of ``function_node`` sitting on the Test canvas."""
    return workbench_service._FunctionRun(
        [FunctionCanvas([function_node], [])], function_node, ("fn-1",), "fn-1"
    )


def _make_running_session_for_user(user_id: str = _wb_common.DEFAULT_USER_ID) -> str:
    """Drop a session into the registry that ``get_active_session_for_user`` will pick up."""
    session_id = "active-session"
    _wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "test_id": "test-x",
        "status": _wb_common.WorkbenchStatus.RUNNING.value,
        "user_id": user_id,
    }
    workbench_service._user_active_session[user_id] = session_id
    return session_id


class TestStartScopedFunctionRunErrors:
    def test_conflicting_active_session_raises(self) -> None:
        _make_running_session_for_user()
        with pytest.raises(ConflictException, match=r"active workbench session"):
            workbench_service._start_scoped_function_run(
                test_id="test-1",
                environment_id="env-1",
                user_id=_wb_common.DEFAULT_USER_ID,
                scope=_FN_SCOPE,
                session_id=None,
            )

    def test_conflicting_tracked_execution_session_raises(self) -> None:
        # When the active session carries an ``execution_id`` it is a tracked
        # execution (suite / regression child), not a free workbench run; the
        # exception message reflects that distinction.
        sid = "tracked-session"
        _wb_common._workbench_sessions[sid] = {
            "session_id": sid,
            "test_id": "test-x",
            "status": _wb_common.WorkbenchStatus.RUNNING.value,
            "user_id": _wb_common.DEFAULT_USER_ID,
            "execution_id": "exec-1",
        }
        workbench_service._user_active_session[_wb_common.DEFAULT_USER_ID] = sid
        with pytest.raises(ConflictException, match=r"active tracked execution session"):
            workbench_service._start_scoped_function_run(
                test_id="test-1",
                environment_id="env-1",
                user_id=_wb_common.DEFAULT_USER_ID,
                scope=_FN_SCOPE,
                session_id=None,
            )

    def test_unknown_test_id_raises_lookup_error(self) -> None:
        with patch.object(workbench_service.test_service, "get_test", return_value=None):
            with pytest.raises(LookupError, match=r"Test with ID 'test-missing' not found"):
                workbench_service._start_scoped_function_run(
                    test_id="test-missing",
                    environment_id="env-1",
                    user_id=_wb_common.DEFAULT_USER_ID,
                    scope=_FN_SCOPE,
                    session_id=None,
                )

    def test_unknown_environment_id_raises_lookup_error(self) -> None:
        test_payload: dict[str, Any] = {
            "id": "test-1",
            "name": "T",
            "workflow": {"nodes": [], "edges": []},
        }
        with (
            patch.object(workbench_service.test_service, "get_test", return_value=test_payload),
            patch.object(
                workbench_service.environment_service, "get_environment", return_value=None
            ),
        ):
            with pytest.raises(LookupError, match=r"Environment with ID 'env-missing' not found"):
                workbench_service._start_scoped_function_run(
                    test_id="test-1",
                    environment_id="env-missing",
                    user_id=_wb_common.DEFAULT_USER_ID,
                    scope=_FN_SCOPE,
                    session_id=None,
                )


class TestRunScopedFunctionBackgroundTask:
    """The background task body itself has two early-exit / failure paths."""

    @pytest.mark.asyncio
    async def test_returns_silently_when_session_missing(self) -> None:
        # No session in the registry; the task body just returns.
        await workbench_service._run_scoped_function(
            session_id="ghost",
            run=_function_run({"id": "fn-1", "data": {}}),
            start=ScopedStart(),
        )
        assert "ghost" not in _wb_common._workbench_sessions

    @pytest.mark.asyncio
    async def test_failing_load_function_definition_marks_session_failed(self) -> None:
        sid = "scoped-fail"
        _wb_common._workbench_sessions[sid] = {
            "session_id": sid,
            "status": _wb_common.WorkbenchStatus.RUNNING.value,
            "block_states": {},
        }
        # ``functionLifecycle: 'local'`` without ``localDefinition`` triggers
        # the RuntimeError path inside _load_function_definition.
        function_node = {
            "id": "fn-1",
            "data": {"functionLifecycle": "local"},
        }

        # _notify_terminal calls the registered terminal callbacks - patch it.
        def _stub_notify_terminal(*_args: Any, **_kwargs: Any) -> None:
            return

        # _notify_terminal is imported lazily inside the function; patch the
        # module attribute on the _common module so the lazy import gets it.
        with patch.object(_wb_common, "_notify_terminal", _stub_notify_terminal):
            await workbench_service._run_scoped_function(
                session_id=sid,
                run=_function_run(function_node),
                start=ScopedStart(),
            )
        session = _wb_common._workbench_sessions[sid]
        assert session["status"] == _wb_common.WorkbenchStatus.FAILED.value
        assert "missing localDefinition" in session.get("error", "")


@pytest.mark.asyncio
async def _drain_pending_tasks() -> None:
    """Yield once so any scheduled tasks have a chance to run."""
    await asyncio.sleep(0)
