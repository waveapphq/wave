"""Sequential-execution service layer for suite/regression runs.

Wraps the orchestrator's async driver with the service-level concerns the
driver does not know about:

- Tracking which workbench child sessions belong to which tracked parent
  execution, so the global workbench terminal callback can resolve the
  asyncio.Event.
- Providing the concrete ``run_test`` coroutine the driver calls, which
  starts a workbench session and awaits its terminal.
- Appending runs.yaml / status.yaml entries and writing per-test
  snapshots as each child reaches terminal.

No on-disk log forwarding: child logs are written by
``log_streaming_service`` directly into ``logs/<run_id>.yaml``. Parent
console streaming happens as a WebSocket pub/sub (the service also
publishes each log onto ``log:<exec_id>``).
"""

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from wavecore.api.services import log_streaming_service
from wavecore.api.services.executions import orchestrator
from wavecore.api.services.executions._storage import (
    _execution_storage,
    _get_runtime_state,
    _record_run_dispatched,
    _record_run_transition,
    _save_execution,
    _save_snapshot,
)

RunTestCallable = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]

# child_session_id -> {parent_id, run_id, event, result}
_child_sessions: dict[str, dict[str, Any]] = {}

# stopped child_session_id -> (parent_id, run_id) until the child's run unwinds
_unwinding_children: dict[str, tuple[str, str]] = {}

# parent_execution_id -> stop-requested flag container
_stop_flags: dict[str, dict[str, bool]] = {}


def dispatch_child_terminal(session_id: str, status: str, halt_scope: str | None) -> bool:
    """Dispatch a workbench terminal event to the sequential driver.

    Returns True if the session was a sequential child (and the waiting
    driver was signaled, or a stopped child's unwind was stored); False if
    the session was not ours and the caller should fall through to its
    default handler.
    """
    record = _child_sessions.get(session_id)
    if record is None:
        return _store_unwound_stop(session_id, status)
    _persist_child_snapshot(record["parent_id"], record["run_id"], session_id, status)
    record["result"] = {"status": status, "halt_scope": halt_scope}
    event: asyncio.Event = record["event"]
    event.set()
    return True


def _store_unwound_stop(session_id: str, status: str) -> bool:
    """A stopped child notifies again once its run unwinds; store what it bound since."""
    from wavecore.api.services.workbench._common import _get_session

    held = _unwinding_children.pop(session_id, None)
    if held is None:
        return False
    parent_execution_id, run_id = held
    if (
        status == "stopped"
        and _holds_stopped_run(parent_execution_id, run_id)
        and _get_session(session_id) is not None
    ):
        _persist_child_snapshot(parent_execution_id, run_id, session_id, status)
    return True


def _holds_stopped_run(parent_execution_id: str, run_id: str) -> bool:
    """The parent execution was not deleted and still records the run as stopped."""
    if _execution_storage.get(parent_execution_id) is None:
        return False
    runs = (_get_runtime_state(parent_execution_id) or {}).get("runs") or {}
    return (runs.get(run_id) or {}).get("status") == "stopped"


def _hold_until_unwound(child_session_id: str, parent_execution_id: str, run_id: str) -> None:
    """Keep a stopped child's run ids while its canceled task unwinds."""
    from wavecore.api.services.workbench._common import _active_tasks

    task = _active_tasks.get(child_session_id)
    if task is None or task.done():
        return
    _unwinding_children[child_session_id] = (parent_execution_id, run_id)
    task.add_done_callback(lambda _task: _unwinding_children.pop(child_session_id, None))


def _persist_child_snapshot(
    parent_execution_id: str, run_id: str, child_session_id: str, status: str
) -> None:
    """Write ``snapshots/<run_id>.yaml`` using the child workbench session's
    end-of-run state."""
    from wavecore.api.services.tests import service as test_service
    from wavecore.api.services.workbench._common import _get_session, get_session_snapshot

    snapshot_source = get_session_snapshot(child_session_id) or {}
    registry = (_get_session(child_session_id) or {}).get("secret_registry")
    test_id = snapshot_source.get("test_id")
    block_states = snapshot_source.get("block_states") or {}
    variables = _filter_plain_variables(snapshot_source.get("variables") or {})
    workflow = test_service.get_test_workflow(test_id) if test_id else None

    snapshot: dict[str, Any] = {
        "run_id": run_id,
        "test_id": test_id,
        "status": status,
        "block_states": dict(block_states),
        "variables": variables,
    }
    if workflow is not None:
        snapshot["workflow"] = workflow
    _save_snapshot(parent_execution_id, run_id, snapshot, registry=registry)


def _filter_plain_variables(variables: dict[str, Any]) -> dict[str, Any]:
    """Strip namespace wrapper objects (``system`` / ``suite`` / ``regression``)
    so the snapshot round-trips cleanly through YAML."""
    from wavecore.core.namespace_base import NamespaceObjectBase

    return {k: v for k, v in variables.items() if not isinstance(v, NamespaceObjectBase)}


def request_stop(execution_id: str) -> None:
    """Flag a running sequential execution as stop-requested. The driver
    cascades 'skipped' across the remaining pending entries."""
    flag = _stop_flags.get(execution_id)
    if flag is not None:
        flag["stopped"] = True


def stop_active_child(execution_id: str) -> None:
    """Cancel any currently running workbench child session of a parent
    sequential execution."""
    from wavecore.api.services.workbench import service as workbench_service

    child_ids = [
        cid for cid, rec in _child_sessions.items() if rec.get("parent_id") == execution_id
    ]
    for child_id in child_ids:
        try:
            workbench_service.stop_workbench_run(child_id)
        except LookupError:
            pass


def _mark_skipped(execution_id: str) -> Callable[[str], None]:
    """Return a closure the driver uses to cascade 'skipped' across a run_id."""
    now_iso = datetime.now(UTC).isoformat

    def mark(run_id: str) -> None:
        _record_run_transition(
            execution_id,
            run_id,
            status="skipped",
            ended_at=now_iso(),
            duration=0.0,
        )

    return mark


def _build_run_test(
    execution_id: str,
    environment_id: str,
    parent_entity_type: str,
    parent_entity_id: str,
    default_suite_id: str | None,
    overrides: dict[str, Any] | None = None,
) -> RunTestCallable:
    """Build the async run_test coroutine the orchestrator awaits.

    Each invocation spawns one workbench session, registers it as a child,
    appends runs.yaml + status.yaml transitions around it, and returns
    ``{status, duration, halt_scope}``.
    """
    from wavecore.api.services.workbench import service as workbench_service

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        run_id = str(entry["run_id"])
        test_id = str(entry["test_id"])
        suite_id = entry.get("suite_id") or default_suite_id
        regression_id = parent_entity_id if parent_entity_type == "regression" else None

        _record_run_dispatched(execution_id, run_id, test_id, suite_id)
        # Pin the test's slot in logs.yaml BEFORE any log could arrive, so
        # the merged-console reassembly always finds the reference even
        # if the backend crashes mid-test.
        log_streaming_service.emit_test_reference(execution_id, run_id)
        started_iso = datetime.now(UTC).isoformat()
        _record_run_transition(execution_id, run_id, status="running", started_at=started_iso)

        child_id = str(uuid.uuid4())
        event = asyncio.Event()
        _child_sessions[child_id] = {
            "parent_id": execution_id,
            "run_id": run_id,
            "event": event,
            "result": {"status": "failed", "halt_scope": None},
        }
        log_streaming_service.register_log_sink(
            child_id,
            execution_id,
            run_id=run_id,
            test_id=test_id,
        )

        started_monotonic = time.monotonic()
        try:
            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                session_id=child_id,
                lineage=workbench_service.RunLineage(
                    parent_execution_id=execution_id,
                    suite_id=suite_id,
                    regression_id=regression_id,
                ),
                overrides=overrides,
            )
        except Exception:
            _child_sessions.pop(child_id, None)
            log_streaming_service.unregister_log_sink(child_id)
            ended_iso = datetime.now(UTC).isoformat()
            _record_run_transition(
                execution_id,
                run_id,
                status="failed",
                ended_at=ended_iso,
                duration=0.0,
            )
            return {"status": "failed", "duration": 0.0, "halt_scope": None}

        try:
            await event.wait()
        finally:
            record = _child_sessions.pop(child_id, None)
            log_streaming_service.unregister_log_sink(child_id)

        duration = round(time.monotonic() - started_monotonic, 3)
        ended_iso = datetime.now(UTC).isoformat()
        result = record["result"] if record else {"status": "failed", "halt_scope": None}
        if result["status"] == "stopped":
            _hold_until_unwound(child_id, execution_id, run_id)
        _record_run_transition(
            execution_id,
            run_id,
            status=result["status"],
            ended_at=ended_iso,
            duration=duration,
        )
        return {
            "status": result["status"],
            "duration": duration,
            "halt_scope": result.get("halt_scope"),
        }

    return run_test


class _BoundaryBanners:
    """Persist and broadcast suite / regression boundary banners.

    Banners land in ``logs.yaml`` as regular scope logs (``type: suite``
    or ``type: regression``) so they survive refresh and show up in
    post-hoc review. They also broadcast live over the parent
    execution's WS topic for the viewer's running-session display.
    """

    def __init__(self, execution_id: str, entity_type: str, entity_name: str) -> None:
        self._execution_id = execution_id
        self._entity_type = entity_type
        self._entity_name = entity_name
        self._current_suite_id: str | None = None
        self._current_suite_name: str = ""

    def on_run_dispatch(self, entry: dict[str, Any]) -> None:
        """Called once per test dispatch. Emits a suite-transition banner
        when the suite changes (regression runs only)."""
        if self._entity_type != "regression":
            return
        suite_id = entry.get("suite_id")
        if suite_id == self._current_suite_id:
            return
        if self._current_suite_id is not None:
            self._emit_suite_log(
                f"Suite '{self._current_suite_name}' completed",
                self._current_suite_id,
            )
        self._current_suite_id = suite_id
        self._current_suite_name = entry.get("suite_name", suite_id or "")
        self._emit_suite_log(
            f"Suite '{self._current_suite_name}' execution started",
            self._current_suite_id,
        )

    def start(self) -> None:
        label = self._entity_type.capitalize() if self._entity_type else "Execution"
        if self._entity_type == "regression":
            self._emit_regression_log(f"{label} '{self._entity_name}' execution started")
        else:
            # For suite-type executions the parent IS the suite, so the
            # start banner is itself a suite-level log.
            self._emit_suite_log(
                f"{label} '{self._entity_name}' execution started",
                None,
            )

    def finish(self, terminal: str, user_stopped: bool = False) -> None:
        # A "stopped" terminal with no user-stop flag means the driver's
        # asyncio task was canceled by the runtime (backend shutdown).
        # Distinguish it from a user Stop so the console badges it
        # correctly at both suite and regression scope.
        canceled_by_shutdown = terminal == "stopped" and not user_stopped

        if self._entity_type == "regression" and self._current_suite_id is not None:
            if canceled_by_shutdown:
                self._emit_suite_log(
                    f"Suite '{self._current_suite_name}' canceled by backend shutdown",
                    self._current_suite_id,
                    level="FATAL",
                )
            else:
                self._emit_suite_log(
                    f"Suite '{self._current_suite_name}' completed",
                    self._current_suite_id,
                )

        label = self._entity_type.capitalize() if self._entity_type else "Execution"
        if canceled_by_shutdown:
            message = f"{label} '{self._entity_name}' canceled by backend shutdown"
            level = "FATAL"
        else:
            message = f"{label} '{self._entity_name}' finished with status: {terminal}"
            level = "INFO"
        if self._entity_type == "regression":
            self._emit_regression_log(message, level=level)
        else:
            self._emit_suite_log(message, None, level=level)

    def _emit_regression_log(self, message: str, *, level: str = "INFO") -> None:
        log_streaming_service.emit_scope_log(
            self._execution_id,
            "regression",
            message,
            level=level,
            variant="regression-banner",
        )

    def _emit_suite_log(self, message: str, suite_id: str | None, *, level: str = "INFO") -> None:
        log_streaming_service.emit_scope_log(
            self._execution_id,
            "suite",
            message,
            level=level,
            variant="suite-banner",
            suite_id=suite_id,
        )


async def _drive_and_persist(
    execution_id: str,
    environment_id: str,
    overrides: dict[str, Any] | None = None,
) -> None:
    """Drive the sequential iteration and finalize the execution record."""
    execution = _execution_storage.get(execution_id) or {}
    entity_type = execution.get("entity_type", "")
    entity_id = execution.get("entity_id", "")
    entity_name = execution.get("name", "") or entity_id
    default_suite_id = entity_id if entity_type == "suite" else None

    state = _get_runtime_state(execution_id)
    if state is None:
        return
    flat_runs = orchestrator.iter_composition_runs(_load_composition_safe(execution_id))

    flag: dict[str, bool] = {"stopped": False}
    _stop_flags[execution_id] = flag

    banners = _BoundaryBanners(execution_id, entity_type, entity_name)
    banners.start()

    run_test_core = _build_run_test(
        execution_id,
        environment_id,
        parent_entity_type=entity_type,
        parent_entity_id=entity_id,
        default_suite_id=default_suite_id,
        overrides=overrides,
    )

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        banners.on_run_dispatch(entry)
        return await run_test_core(entry)

    terminal = "failed"
    try:
        terminal = await orchestrator.drive_sequential_execution(
            flat_runs,
            state["runs"],
            run_test,
            _mark_skipped(execution_id),
            stop_requested=lambda: flag["stopped"],
            single_suite=entity_type == "suite",
        )
    except asyncio.CancelledError:
        terminal = "stopped"
        raise
    except Exception:
        terminal = "failed"
    finally:
        banners.finish(terminal, user_stopped=flag["stopped"])
        _stop_flags.pop(execution_id, None)
        _release_active_workbench_session()
        _finalize_execution(execution_id, terminal)


def _load_composition_safe(execution_id: str) -> dict[str, Any]:
    from wavecore.api.services.executions._storage import _load_composition

    return _load_composition(execution_id)


def _finalize_execution(execution_id: str, terminal: str) -> None:
    execution = _execution_storage.get(execution_id)
    if execution is None:
        return
    ended_iso = datetime.now(UTC).isoformat()
    started_at = execution.get("started_at")
    duration = None
    if started_at:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(ended_iso.replace("Z", "+00:00"))
        duration = int((end - start).total_seconds())
    execution["status"] = terminal
    execution["ended_at"] = ended_iso
    if duration is not None:
        execution["duration"] = duration
    state = _get_runtime_state(execution_id)
    if state is not None:
        state["status"] = terminal
        state["ended_at"] = ended_iso
        state["duration"] = duration
    _save_execution(execution)
    from wavecore.core.artifacts import log_writer

    log_writer.write_execution_logs(execution)


def _release_active_workbench_session() -> None:
    """Clear the default user's workbench active-session pointer.

    Leaves the terminated child sessions in place so historical lookups
    still work; only the ``user -> active session`` map is cleared.
    """
    from wavecore.api.services.workbench._common import (
        DEFAULT_USER_ID,
        _user_active_session,
    )

    _user_active_session.pop(DEFAULT_USER_ID, None)


def start_sequential_execution(
    execution_id: str,
    environment_id: str,
    overrides: dict[str, Any] | None = None,
) -> asyncio.Task[None] | None:
    """Schedule the sequential driver as an asyncio task."""
    coro = _drive_and_persist(execution_id, environment_id, overrides)
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        coro.close()
        return None
    return asyncio.create_task(coro)
