"""Unit tests for the sequential-execution service layer.

Covers the thin service around orchestrator.drive_sequential_execution:
- child session bookkeeping (``_child_sessions``) and terminal dispatch
- stop-request flag + active-child cancellation
- per-run disk transitions + child snapshot persistence
- boundary banner emission (suite/regression)
- the full _drive_and_persist lifecycle (running -> terminal + finalize)
- start_sequential_execution task scheduling without a running loop
"""

import asyncio
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import call, patch

import pytest

from wavecore.api.services import log_streaming_service, storage_paths
from wavecore.api.services.executions import _sequential, orchestrator
from wavecore.api.services.executions import _storage as _exec_storage


@pytest.fixture
def tmp_storage(tmp_path: Any) -> Any:
    storage_paths.set_base_path(Path(tmp_path))
    _exec_storage._clear_storage()
    log_streaming_service._clear_cache()
    _sequential._child_sessions.clear()
    _sequential._stop_flags.clear()
    yield tmp_path
    _sequential._child_sessions.clear()
    _sequential._stop_flags.clear()
    log_streaming_service._clear_cache()
    _exec_storage._clear_storage()


def _seed_suite_execution(
    tmp_storage: Any,
    run_ids: tuple[str, ...] = ("r1", "r2"),
    entity_type: str = "suite",
) -> tuple[str, dict[str, Any]]:
    exec_id = str(uuid.uuid4())
    entity_id = str(uuid.uuid4())
    execution = {
        "id": exec_id,
        "name": "seq-run",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "environment_id": "env",
        "status": "running",
        "started_at": "2026-04-22T00:00:00+00:00",
    }
    _exec_storage._save_execution(execution)
    _exec_storage._execution_storage[exec_id] = execution
    composition = {
        "suites": [
            {
                "id": entity_id if entity_type == "suite" else "sA",
                "name": "Suite A",
                "tests": [{"id": f"t-{rid}", "name": f"T-{rid}", "run_id": rid} for rid in run_ids],
            }
        ]
    }
    _exec_storage._save_composition(exec_id, composition)
    _exec_storage._init_runtime_state(exec_id, execution["started_at"], composition, None)
    return exec_id, composition


# ---------------------------------------------------------------------------
# dispatch_child_terminal / request_stop / stop_active_child
# ---------------------------------------------------------------------------


def test_dispatch_child_terminal_returns_false_for_unknown_session() -> None:
    assert _sequential.dispatch_child_terminal("no-such-session", "passed", None) is False


def test_dispatch_child_terminal_signals_waiting_event_and_persists_snapshot(
    tmp_storage: Any,
) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    child_id = str(uuid.uuid4())
    run_id = "r1"
    event = asyncio.Event()
    _sequential._child_sessions[child_id] = {
        "parent_id": exec_id,
        "run_id": run_id,
        "event": event,
        "result": {"status": "failed", "halt_scope": None},
    }

    with (
        patch(
            "wavecore.api.services.workbench._common.get_session_snapshot",
            return_value={
                "test_id": f"t-{run_id}",
                "block_states": {"b1": "passed"},
                "variables": {"x": 1},
            },
        ),
        patch(
            "wavecore.api.services.tests.service.get_test_workflow",
            return_value={"nodes": [], "edges": []},
        ),
    ):
        dispatched = _sequential.dispatch_child_terminal(child_id, "passed", None)

    assert dispatched is True
    assert event.is_set()
    assert _sequential._child_sessions[child_id]["result"]["status"] == "passed"
    snap = _exec_storage._load_snapshot(exec_id, run_id)
    assert snap is not None
    assert snap["status"] == "passed"
    assert snap["workflow"] == {"nodes": [], "edges": []}


def test_filter_plain_variables_drops_namespace_objects() -> None:
    from wavecore.core.namespace_base import NamespaceObjectBase

    class _NS(NamespaceObjectBase):
        pass

    filtered = _sequential._filter_plain_variables({"x": 1, "suite": _NS(), "y": "z"})
    assert filtered == {"x": 1, "y": "z"}


def test_request_stop_flips_existing_flag(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    _sequential._stop_flags[exec_id] = {"stopped": False}
    _sequential.request_stop(exec_id)
    assert _sequential._stop_flags[exec_id]["stopped"] is True


def test_request_stop_is_noop_for_unknown_execution() -> None:
    # No flag registered - call must not raise.
    _sequential.request_stop("unknown-exec")


def test_stop_active_child_invokes_workbench_stop_per_child(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    _sequential._child_sessions["c1"] = {"parent_id": exec_id, "run_id": "r1"}
    _sequential._child_sessions["c2"] = {"parent_id": exec_id, "run_id": "r2"}
    _sequential._child_sessions["orphan"] = {"parent_id": "other", "run_id": "rx"}

    from wavecore.api.services.workbench import service as workbench_service

    with patch.object(workbench_service, "stop_workbench_run") as stop_mock:
        _sequential.stop_active_child(exec_id)

    called_ids = sorted(call.args[0] for call in stop_mock.call_args_list)
    assert called_ids == ["c1", "c2"]


def test_stop_active_child_ignores_missing_sessions(tmp_storage: Any) -> None:
    """A child session vanishing between enumeration and the workbench
    call must not abort the cancellation sweep."""
    exec_id, _ = _seed_suite_execution(tmp_storage)
    _sequential._child_sessions["c1"] = {"parent_id": exec_id, "run_id": "r1"}
    _sequential._child_sessions["c2"] = {"parent_id": exec_id, "run_id": "r2"}

    from wavecore.api.services.workbench import service as workbench_service

    def _raiser(sid: str) -> None:
        raise LookupError(sid)

    with patch.object(workbench_service, "stop_workbench_run", side_effect=_raiser):
        _sequential.stop_active_child(exec_id)  # must not raise


# ---------------------------------------------------------------------------
# A stopped child's unwind notice
# ---------------------------------------------------------------------------


def _held_stopped_child(exec_id: str) -> str:
    """A stopped child whose first snapshot is stored and whose run still unwinds."""
    from wavecore.api.services.workbench import _common as _wb_common

    child_id = str(uuid.uuid4())
    _exec_storage._record_run_transition(exec_id, "r1", status="stopped")
    _exec_storage._save_snapshot(
        exec_id,
        "r1",
        {"run_id": "r1", "test_id": None, "status": "stopped", "variables": {"x": 1}},
    )
    _sequential._unwinding_children[child_id] = (exec_id, "r1")
    _wb_common._workbench_sessions[child_id] = {
        "session_id": child_id,
        "test_id": None,
        "block_states": {"b1": "stopped"},
        "variables": {"x": 1, "out": "tail"},
    }
    return child_id


def test_a_stopped_child_unwind_notice_stores_what_it_bound_since(tmp_storage: Any) -> None:
    from wavecore.api.services.workbench import _common as _wb_common

    exec_id, _ = _seed_suite_execution(tmp_storage)
    child_id = _held_stopped_child(exec_id)
    try:
        dispatched = _sequential.dispatch_child_terminal(child_id, "stopped", None)
    finally:
        _wb_common._workbench_sessions.pop(child_id, None)

    assert dispatched is True
    assert child_id not in _sequential._unwinding_children
    assert _exec_storage._load_snapshot(exec_id, "r1") == {
        "run_id": "r1",
        "test_id": None,
        "status": "stopped",
        "block_states": {"b1": "stopped"},
        "variables": {"x": 1, "out": "tail"},
    }


def test_an_unwind_notice_of_another_status_leaves_the_stored_snapshot(
    tmp_storage: Any,
) -> None:
    from wavecore.api.services.workbench import _common as _wb_common

    exec_id, _ = _seed_suite_execution(tmp_storage)
    child_id = _held_stopped_child(exec_id)
    try:
        dispatched = _sequential.dispatch_child_terminal(child_id, "failed", None)
    finally:
        _wb_common._workbench_sessions.pop(child_id, None)

    assert dispatched is True
    assert child_id not in _sequential._unwinding_children
    snapshot = _exec_storage._load_snapshot(exec_id, "r1") or {}
    assert (snapshot["status"], snapshot["variables"]) == ("stopped", {"x": 1})


def test_an_unwind_notice_after_the_session_closed_leaves_the_stored_snapshot(
    tmp_storage: Any,
) -> None:
    from wavecore.api.services.workbench import _common as _wb_common

    exec_id, _ = _seed_suite_execution(tmp_storage)
    child_id = _held_stopped_child(exec_id)
    _wb_common._workbench_sessions.pop(child_id, None)

    dispatched = _sequential.dispatch_child_terminal(child_id, "stopped", None)

    assert dispatched is True
    assert child_id not in _sequential._unwinding_children
    snapshot = _exec_storage._load_snapshot(exec_id, "r1") or {}
    assert (snapshot["status"], snapshot["variables"]) == ("stopped", {"x": 1})


def test_an_unwind_notice_after_the_execution_was_deleted_writes_no_snapshot(
    tmp_storage: Any,
) -> None:
    from wavecore.api.services.executions import service as execution_service
    from wavecore.api.services.workbench import _common as _wb_common

    exec_id, _ = _seed_suite_execution(tmp_storage)
    child_id = _held_stopped_child(exec_id)
    _sequential._finalize_execution(exec_id, "stopped")
    assert execution_service.delete_execution(exec_id) is True
    try:
        dispatched = _sequential.dispatch_child_terminal(child_id, "stopped", None)
    finally:
        _wb_common._workbench_sessions.pop(child_id, None)

    assert dispatched is True
    assert child_id not in _sequential._unwinding_children
    assert _exec_storage._snapshot_file(exec_id, "r1").exists() is False


def test_an_unwind_notice_of_a_run_not_held_as_stopped_leaves_the_stored_snapshot(
    tmp_storage: Any,
) -> None:
    from wavecore.api.services.workbench import _common as _wb_common

    exec_id, _ = _seed_suite_execution(tmp_storage)
    child_id = _held_stopped_child(exec_id)
    _exec_storage._record_run_transition(exec_id, "r1", status="failed")
    try:
        dispatched = _sequential.dispatch_child_terminal(child_id, "stopped", None)
    finally:
        _wb_common._workbench_sessions.pop(child_id, None)

    assert dispatched is True
    assert child_id not in _sequential._unwinding_children
    snapshot = _exec_storage._load_snapshot(exec_id, "r1") or {}
    assert (snapshot["status"], snapshot["variables"]) == ("stopped", {"x": 1})


@pytest.mark.asyncio
async def test_a_stopped_child_is_held_until_its_task_ends(tmp_storage: Any) -> None:
    from wavecore.api.services.workbench import _common as _wb_common

    exec_id, _ = _seed_suite_execution(tmp_storage)
    child_id = str(uuid.uuid4())
    release = asyncio.Event()

    async def _unwind() -> None:
        await release.wait()

    task = asyncio.create_task(_unwind())
    _wb_common._active_tasks[child_id] = task
    try:
        _sequential._hold_until_unwound(child_id, exec_id, "r1")
        held = _sequential._unwinding_children.get(child_id)
        release.set()
        await task
        await asyncio.sleep(0)
    finally:
        _wb_common._active_tasks.pop(child_id, None)

    assert held == (exec_id, "r1")
    assert child_id not in _sequential._unwinding_children


@pytest.mark.asyncio
async def test_a_stopped_child_whose_task_ended_is_not_held(tmp_storage: Any) -> None:
    from wavecore.api.services.workbench import _common as _wb_common

    exec_id, _ = _seed_suite_execution(tmp_storage)
    child_id = str(uuid.uuid4())
    task = asyncio.create_task(asyncio.sleep(0))
    await task
    _wb_common._active_tasks[child_id] = task
    try:
        _sequential._hold_until_unwound(child_id, exec_id, "r1")
    finally:
        _wb_common._active_tasks.pop(child_id, None)

    assert child_id not in _sequential._unwinding_children


@pytest.mark.asyncio
async def test_a_stopped_child_without_a_task_is_not_held(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    from wavecore.api.services.workbench import service as workbench_service

    started: list[str] = []

    def _fake_start(**kwargs: Any) -> dict[str, Any]:
        sid = kwargs["session_id"]
        started.append(sid)
        _sequential.dispatch_child_terminal(sid, "stopped", None)
        return {"session_id": sid, "status": "running"}

    with (
        patch.object(workbench_service, "start_workbench_run", side_effect=_fake_start),
        patch(
            "wavecore.api.services.workbench._common.get_session_snapshot",
            return_value={"test_id": "t-r1", "block_states": {}, "variables": {}},
        ),
        patch(
            "wavecore.api.services.tests.service.get_test_workflow",
            return_value=None,
        ),
    ):
        run_test = _sequential._build_run_test(
            exec_id,
            "env",
            parent_entity_type="suite",
            parent_entity_id="sA",
            default_suite_id="sA",
        )
        result = await run_test({"run_id": "r1", "test_id": "t-r1", "suite_id": "sA"})

    assert result["status"] == "stopped"
    assert started[0] not in _sequential._unwinding_children


# ---------------------------------------------------------------------------
# _mark_skipped closure
# ---------------------------------------------------------------------------


def test_mark_skipped_records_transition(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    mark = _sequential._mark_skipped(exec_id)
    mark("r1")
    status = _exec_storage._load_status(exec_id)
    assert status[-1]["run_id"] == "r1"
    assert status[-1]["status"] == "skipped"


# ---------------------------------------------------------------------------
# _build_run_test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_run_test_records_dispatch_and_completion(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    from wavecore.api.services.workbench import service as workbench_service

    def _fake_start(**kwargs: Any) -> dict[str, Any]:
        # Simulate terminal arriving immediately from the workbench.
        sid = kwargs["session_id"]
        _sequential.dispatch_child_terminal(sid, "passed", None)
        return {"session_id": sid, "status": "running"}

    with (
        patch.object(workbench_service, "start_workbench_run", side_effect=_fake_start),
        patch(
            "wavecore.api.services.workbench._common.get_session_snapshot",
            return_value={"test_id": "t-r1", "block_states": {}, "variables": {}},
        ),
        patch(
            "wavecore.api.services.tests.service.get_test_workflow",
            return_value=None,
        ),
    ):
        run_test = _sequential._build_run_test(
            exec_id,
            "env",
            parent_entity_type="suite",
            parent_entity_id="sA",
            default_suite_id="sA",
        )
        result = await run_test({"run_id": "r1", "test_id": "t-r1", "suite_id": "sA"})

    assert result["status"] == "passed"
    assert result["halt_scope"] is None
    runs = _exec_storage._load_runs(exec_id)
    assert runs[0]["run_id"] == "r1"


@pytest.mark.asyncio
async def test_build_run_test_handles_workbench_start_failure(
    tmp_storage: Any,
) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    from wavecore.api.services.workbench import service as workbench_service

    def _fail(**_kwargs: Any) -> None:
        raise RuntimeError("cannot start")

    with patch.object(workbench_service, "start_workbench_run", side_effect=_fail):
        run_test = _sequential._build_run_test(
            exec_id,
            "env",
            parent_entity_type="regression",
            parent_entity_id="reg-1",
            default_suite_id=None,
        )
        result = await run_test({"run_id": "r1", "test_id": "t-r1", "suite_id": "sA"})

    assert result == {"status": "failed", "duration": 0.0, "halt_scope": None}
    # The child session bookkeeping is cleaned up on failure.
    assert not _sequential._child_sessions


@pytest.mark.asyncio
async def test_build_run_test_registers_and_drops_child_log_sink(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    from wavecore.api.services.workbench import service as workbench_service

    started: list[str] = []

    def _fake_start(**kwargs: Any) -> dict[str, Any]:
        sid = kwargs["session_id"]
        started.append(sid)
        _sequential.dispatch_child_terminal(sid, "passed", None)
        return {"session_id": sid, "status": "running"}

    with (
        patch.object(workbench_service, "start_workbench_run", side_effect=_fake_start),
        patch(
            "wavecore.api.services.workbench._common.get_session_snapshot",
            return_value={"test_id": "t-r1", "block_states": {}, "variables": {}},
        ),
        patch(
            "wavecore.api.services.tests.service.get_test_workflow",
            return_value=None,
        ),
        patch.object(
            log_streaming_service,
            "register_log_sink",
            wraps=log_streaming_service.register_log_sink,
        ) as register_mock,
        patch.object(
            log_streaming_service,
            "unregister_log_sink",
            wraps=log_streaming_service.unregister_log_sink,
        ) as unregister_mock,
    ):
        run_test = _sequential._build_run_test(
            exec_id,
            "env",
            parent_entity_type="suite",
            parent_entity_id="sA",
            default_suite_id="sA",
        )
        result = await run_test({"run_id": "r1", "test_id": "t-r1", "suite_id": "sA"})

    assert result["status"] == "passed"
    assert len(started) == 1
    child_id = started[0]
    assert register_mock.call_args_list == [call(child_id, exec_id, run_id="r1", test_id="t-r1")]
    assert unregister_mock.call_args_list == [call(child_id)]


@pytest.mark.asyncio
async def test_build_run_test_drops_child_log_sink_when_start_fails(
    tmp_storage: Any,
) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    from wavecore.api.services.workbench import service as workbench_service

    started: list[str] = []

    def _fail(**kwargs: Any) -> None:
        started.append(kwargs["session_id"])
        raise RuntimeError("cannot start")

    with (
        patch.object(workbench_service, "start_workbench_run", side_effect=_fail),
        patch.object(
            log_streaming_service,
            "register_log_sink",
            wraps=log_streaming_service.register_log_sink,
        ) as register_mock,
        patch.object(
            log_streaming_service,
            "unregister_log_sink",
            wraps=log_streaming_service.unregister_log_sink,
        ) as unregister_mock,
    ):
        run_test = _sequential._build_run_test(
            exec_id,
            "env",
            parent_entity_type="suite",
            parent_entity_id="sA",
            default_suite_id="sA",
        )
        result = await run_test({"run_id": "r1", "test_id": "t-r1", "suite_id": "sA"})

    assert result == {"status": "failed", "duration": 0.0, "halt_scope": None}
    assert len(started) == 1
    child_id = started[0]
    assert register_mock.call_args_list == [call(child_id, exec_id, run_id="r1", test_id="t-r1")]
    assert unregister_mock.call_args_list == [call(child_id)]


# ---------------------------------------------------------------------------
# _BoundaryBanners
# ---------------------------------------------------------------------------


def test_boundary_banners_suite_start_and_finish(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    banners = _sequential._BoundaryBanners(exec_id, "suite", "MySuite")
    banners.start()
    banners.finish("passed")
    chronology = _exec_storage._load_chronology(exec_id)
    kinds = [c["type"] for c in chronology]
    assert kinds.count("suite") == 2  # start + finish banners


def test_boundary_banners_regression_transitions_between_suites(
    tmp_storage: Any,
) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    banners = _sequential._BoundaryBanners(exec_id, "regression", "MyReg")
    banners.start()
    banners.on_run_dispatch({"run_id": "r1", "suite_id": "sA", "suite_name": "A"})
    banners.on_run_dispatch({"run_id": "r2", "suite_id": "sA", "suite_name": "A"})
    banners.on_run_dispatch({"run_id": "r3", "suite_id": "sB", "suite_name": "B"})
    banners.finish("passed")

    chronology = _exec_storage._load_chronology(exec_id)
    kinds = [c["type"] for c in chronology]
    # regression start + 2 suite boundaries (A-start, A-complete, B-start) +
    # A-complete emitted at finish... Actually: regression-start,
    # suiteA-start, suiteA-complete, suiteB-start, suiteB-complete (finish),
    # regression-finish.
    assert kinds.count("regression") == 2
    assert kinds.count("suite") >= 4


def test_boundary_banners_regression_canceled_by_shutdown(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    banners = _sequential._BoundaryBanners(exec_id, "regression", "MyReg")
    banners.start()
    banners.on_run_dispatch({"run_id": "r1", "suite_id": "sA", "suite_name": "A"})
    banners.finish("stopped", user_stopped=False)
    chronology = _exec_storage._load_chronology(exec_id)
    fatal_entries = [c for c in chronology if c.get("level") == "FATAL"]
    assert fatal_entries  # at least the regression shutdown log
    messages = "\n".join(c.get("message", "") for c in fatal_entries)
    assert "canceled by backend shutdown" in messages


def test_boundary_banners_noop_for_non_regression_on_dispatch(
    tmp_storage: Any,
) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    banners = _sequential._BoundaryBanners(exec_id, "suite", "MySuite")
    banners.on_run_dispatch({"run_id": "r1", "suite_id": "sA", "suite_name": "A"})
    # Suite-type runs never emit per-dispatch banners.
    chronology = _exec_storage._load_chronology(exec_id)
    assert chronology == []


def test_boundary_banners_suite_canceled_by_shutdown(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    banners = _sequential._BoundaryBanners(exec_id, "suite", "Solo")
    banners.start()
    banners.finish("stopped", user_stopped=False)
    chronology = _exec_storage._load_chronology(exec_id)
    fatal = [c for c in chronology if c.get("level") == "FATAL"]
    assert fatal and "canceled by backend shutdown" in fatal[-1]["message"]


def test_boundary_banners_regression_without_active_suite_at_finish(
    tmp_storage: Any,
) -> None:
    """Regression terminal before any suite was dispatched still emits a
    regression-finish banner without crashing."""
    exec_id, _ = _seed_suite_execution(tmp_storage)
    banners = _sequential._BoundaryBanners(exec_id, "regression", "MyReg")
    banners.start()
    banners.finish("passed")
    chronology = _exec_storage._load_chronology(exec_id)
    assert any(c["type"] == "regression" for c in chronology)


# ---------------------------------------------------------------------------
# _drive_and_persist lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drive_and_persist_runs_each_entry_to_terminal(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage, run_ids=("r1", "r2"))
    from wavecore.api.services.workbench import service as workbench_service

    def _fake_start(**kwargs: Any) -> dict[str, Any]:
        sid = kwargs["session_id"]
        _sequential.dispatch_child_terminal(sid, "passed", None)
        return {"session_id": sid, "status": "running"}

    with (
        patch.object(workbench_service, "start_workbench_run", side_effect=_fake_start),
        patch(
            "wavecore.api.services.workbench._common.get_session_snapshot",
            return_value={"test_id": "t-r", "block_states": {}, "variables": {}},
        ),
        patch(
            "wavecore.api.services.tests.service.get_test_workflow",
            return_value=None,
        ),
    ):
        await _sequential._drive_and_persist(exec_id, "env")

    final = _exec_storage._execution_storage[exec_id]
    assert final["status"] == "passed"
    assert final["ended_at"]


@pytest.mark.asyncio
async def test_drive_and_persist_noop_when_state_missing(tmp_storage: Any) -> None:
    exec_id = str(uuid.uuid4())
    # No execution record -> no runtime state.
    await _sequential._drive_and_persist(exec_id, "env")
    # Nothing to assert beyond "did not raise"; storage must stay clean.
    assert exec_id not in _exec_storage._execution_storage


@pytest.mark.asyncio
async def test_drive_and_persist_finalizes_on_cancel(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage, run_ids=("r1",))

    async def _raise_canceled(*_args: Any, **_kwargs: Any) -> str:
        raise asyncio.CancelledError()

    with patch.object(orchestrator, "drive_sequential_execution", side_effect=_raise_canceled):
        with pytest.raises(asyncio.CancelledError):
            await _sequential._drive_and_persist(exec_id, "env")

    final = _exec_storage._execution_storage[exec_id]
    assert final["status"] == "stopped"
    assert final["ended_at"]


@pytest.mark.asyncio
async def test_drive_and_persist_finalizes_on_unexpected_exception(
    tmp_storage: Any,
) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage, run_ids=("r1",))

    async def _boom(*_args: Any, **_kwargs: Any) -> str:
        raise RuntimeError("boom")

    with patch.object(orchestrator, "drive_sequential_execution", side_effect=_boom):
        await _sequential._drive_and_persist(exec_id, "env")

    final = _exec_storage._execution_storage[exec_id]
    assert final["status"] == "failed"


# ---------------------------------------------------------------------------
# _finalize_execution and helpers
# ---------------------------------------------------------------------------


def test_finalize_execution_noop_for_missing_record(tmp_storage: Any) -> None:
    # No execution in storage - _finalize must return silently.
    _sequential._finalize_execution("unknown-exec", "passed")


def test_finalize_execution_computes_duration(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage)
    _sequential._finalize_execution(exec_id, "passed")
    final = _exec_storage._execution_storage[exec_id]
    assert final["status"] == "passed"
    assert isinstance(final.get("duration"), int)


def test_release_active_workbench_session_clears_default_user_pointer() -> None:
    from wavecore.api.services.workbench import _common as _wb_common

    _wb_common._user_active_session[_wb_common.DEFAULT_USER_ID] = "some-session"
    _sequential._release_active_workbench_session()
    assert _wb_common.DEFAULT_USER_ID not in _wb_common._user_active_session


# ---------------------------------------------------------------------------
# start_sequential_execution scheduling
# ---------------------------------------------------------------------------


def test_start_sequential_execution_returns_none_without_running_loop() -> None:
    # No event loop is running here, so the call short-circuits to None.
    assert _sequential.start_sequential_execution("x", "env") is None


@pytest.mark.asyncio
async def test_start_sequential_execution_schedules_task(tmp_storage: Any) -> None:
    exec_id, _ = _seed_suite_execution(tmp_storage, run_ids=())
    task = _sequential.start_sequential_execution(exec_id, "env")
    assert task is not None
    await task
    assert _exec_storage._execution_storage[exec_id]["status"] in (
        "passed",
        "failed",
    )
