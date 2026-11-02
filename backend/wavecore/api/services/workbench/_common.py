"""Shared state and helpers for workbench service modules."""

import asyncio
import contextlib
import logging
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable, Collection, Iterator, Mapping, Sequence
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from wavecore.api.services.workbench.block_source import node_source
from wavecore.core.secrets import masking_settings
from wavecore.core.table import Table

logger = logging.getLogger(__name__)

TerminalCallback = Callable[..., None]

STOP_REASON_USER = "Stopped by user"
STOP_REASON_SHUTDOWN = "Stopped by backend shutdown"

_terminal_callbacks: list[TerminalCallback] = []


def register_terminal_callback(callback: TerminalCallback) -> None:
    """Register a callback invoked when any workbench session reaches terminal state.

    Callback signature: (session_id, status, halt_scope=None) where status
    is one of "passed", "failed", "stopped", "skipped" and halt_scope is
    None, "test", "suite", or "regression". Exceptions raised by the
    callback are logged but do not propagate.
    """
    if callback not in _terminal_callbacks:
        _terminal_callbacks.append(callback)


def unregister_terminal_callback(callback: TerminalCallback) -> None:
    """Remove a previously registered terminal callback (no-op if not present)."""
    try:
        _terminal_callbacks.remove(callback)
    except ValueError:
        pass


def _notify_terminal(session_id: str, status: str, halt_scope: str | None = None) -> None:
    """Notify all registered terminal callbacks for a session."""
    # Immediate Stop and ad-hoc pokes (Run Current / from-here) keep SSH sessions
    # open so a single remote block can be re-run against a live session; a full
    # run's clean end (passed/failed) still tears them down. Test Close closes
    # them explicitly (clear_session_for_user).
    session = _workbench_sessions.get(session_id) or {}
    if status != WorkbenchStatus.STOPPED.value and not session.get("_is_adhoc"):
        _drain_ssh_sessions(session_id)
    _clear_announced_run(session_id)
    # Iterate over a snapshot so a callback that unregisters itself does not
    # break the loop.
    for callback in _terminal_callbacks[:]:
        try:
            callback(session_id, status, halt_scope)
        except Exception as e:  # noqa: BLE001 - never let a handler break workflow
            logger.warning(
                "Terminal callback failed for session %s (status=%s): %s",
                session_id,
                status,
                e,
            )


def _clear_announced_run(session_id: str) -> None:
    """End the mirrored-run announce when the announced session terminates."""
    from wavecore.api.services.workbench import ownership

    run = ownership.get_run_state()
    if run is not None and run.get("session_id") == session_id:
        ownership.set_run_state(None)


def _drain_ssh_sessions(session_id: str) -> None:
    """Close every SSH session the run left open (child before parent)."""
    registry = (_workbench_sessions.get(session_id) or {}).get("ssh_session_registry")
    if registry is not None:
        registry.close_all()


# Default user for single-user mode (ready for future multi-user)
DEFAULT_USER_ID = "dev"


class WorkbenchStatus(str, Enum):
    """Workbench execution status."""

    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    PASSED = "passed"
    FAILED = "failed"
    STOPPED = "stopped"
    SKIPPED = "skipped"


# Session storage: session_id -> session data
_workbench_sessions: dict[str, dict[str, Any]] = {}

# Active execution tasks: session_id -> asyncio.Task
_active_tasks: dict[str, asyncio.Task[None]] = {}

# User to active session mapping: user_id -> session_id
_user_active_session: dict[str, str] = {}


def _get_session(session_id: str) -> dict[str, Any] | None:
    """Get workbench session from in-memory storage."""
    return _workbench_sessions.get(session_id)


_instance_path: ContextVar[tuple[str, ...]] = ContextVar("wave_function_instance_path", default=())


@contextlib.contextmanager
def function_instance(path: tuple[str, ...]) -> Iterator[None]:
    """Run inside the Function instance at ``path`` (instance ids from the Test canvas inward)."""
    token = _instance_path.set(path)
    try:
        yield
    finally:
        _instance_path.reset(token)


def current_instance_path() -> tuple[str, ...]:
    """The path of the Function instance the caller runs in; empty on the Test canvas."""
    return _instance_path.get()


def get_session_snapshot(session_id: str) -> dict[str, Any] | None:
    """Return the end-of-run snapshot the Historical Test Canvas needs.

    Captures the session's live ``block_states`` and ``variables`` maps
    (kept up-to-date by the engine), plus its ``test_id``. Returns
    ``None`` when the session is unknown so callers can fall back to
    their default behavior. Used at terminal time by the executions
    service and the sequential driver to persist a replayable snapshot
    of a workbench run.
    """
    session = _workbench_sessions.get(session_id)
    if session is None:
        return None
    block_states = session.get("block_states") or {}
    variables = session.get("variables") or {}
    return {
        "test_id": session.get("test_id"),
        "block_states": dict(block_states),
        "variables": dict(variables),
    }


def _settle_running_blocks(
    session: dict[str, Any],
    session_id: str,
    reason: str,
    node_map: dict[str, dict[str, Any]],
    except_node_id: str | None,
) -> list[tuple[str, str]]:
    """Give every Block still reading running a terminal ``stopped`` state.

    Returns the settled ``(block_id, block_name)`` pairs so async callers can
    paint one ``block_status_changed`` per Block.
    """
    settled: list[tuple[str, str]] = []
    block_states: dict[str, str] = session.setdefault("block_states", {})
    for node_id, state in block_states.items():
        if state != "running" or node_id == except_node_id:
            continue
        block_states[node_id] = "stopped"
        node = node_map.get(node_id, {})
        block_name = str(node.get("data", {}).get("label", node_id))
        # A block the node map does not hold keeps its id as the Source.
        source = node_source(node) or block_name
        _add_execution_log(session_id, "WARN", reason, source, block_id=node_id)
        settled.append((node_id, block_name))
    return settled


def _settle_interrupted_blocks(
    session: dict[str, Any] | None, session_id: str, reason: str
) -> list[tuple[str, str]]:
    """Settle every Block a terminated run was standing on. Idempotent."""
    if session is None:
        return []
    block_states: dict[str, str] = session.setdefault("block_states", {})
    # Prefer the parked node: when stopping from paused, ``current_block`` is
    # still the last block that ran and already carries its own result.
    in_flight: str | None = session.get("paused_node_id")
    if in_flight is None:
        current_block = session.get("current_block")
        in_flight = current_block.get("block_id") if current_block else None
    if in_flight is not None and block_states.get(in_flight) is None:
        block_states[in_flight] = "running"
    # The canvas answers first; a Function body answers for the ids the canvas lacks.
    node_map: dict[str, dict[str, Any]] = {
        **(session.get("_body_nodes") or {}),
        **(session.get("_node_map") or {}),
    }
    return _settle_running_blocks(session, session_id, reason, node_map, None)


def _terminate_session(session_id: str) -> dict[str, Any]:
    """Terminate a workbench session."""
    session = _workbench_sessions.get(session_id)
    if session:
        session["status"] = WorkbenchStatus.STOPPED.value

    # Cancel the running task if exists
    task = _active_tasks.get(session_id)
    if task and not task.done():
        task.cancel()

    # Ahead of _notify_terminal: the executions service snapshots the session
    # from inside that call, before the canceled task unwinds.
    _settle_interrupted_blocks(session, session_id, STOP_REASON_USER)

    _notify_terminal(session_id, WorkbenchStatus.STOPPED.value)

    return {"session_id": session_id, "status": WorkbenchStatus.STOPPED.value}


def _get_test_profiles(_test_id: str) -> list[dict[str, Any]]:
    """Get profiles associated with a test."""
    return []


async def _broadcast_event(session_id: str, event: dict[str, Any]) -> None:
    """Broadcast a WebSocket event for a workbench session."""
    try:
        from wavecore.api.app import app

        ws_manager = getattr(app.state, "ws_manager", None)
        if ws_manager:
            topic = f"workbench:{session_id}"
            envelope = {
                "type": "event",
                "topic": topic,
                "payload": event,
                "timestamp": int(datetime.now(UTC).timestamp() * 1000),
            }
            await ws_manager.broadcast_to_topic(topic, envelope)
    except Exception as e:
        logger.warning("Failed to broadcast WebSocket event: %s", e)


def variable_changed_event(
    session_id: str, name: str, value: Any, function_path: Sequence[str]
) -> dict[str, Any]:
    """The ``variable_changed`` event, its path relative to the session's root canvas."""
    path = tuple(function_path)
    root = tuple((_workbench_sessions.get(session_id) or {}).get("root_path") or ())
    shown = path[len(root) :] if path[: len(root)] == root else path
    return {
        "type": "variable_changed",
        "path": name,
        "value": value,
        "var_type": _infer_variable_type(value),
        "scope": "function" if path else "test",
        "function_path": list(shown),
        "watch_id": session_id,
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


async def _push_variable_changes(
    session_id: str,
    old_vars: dict[str, Any],
    new_vars: dict[str, Any],
    written: Collection[str] | None = None,
) -> None:
    """Push variable changes to subscribers; written names push even unchanged (REQ-3.1.3.12)."""
    try:
        from wavecore.api.app import app

        push_service = getattr(app.state, "variable_push_service", None)
        if not push_service:
            return

        names_written = written or ()
        path = current_instance_path()
        for var_name, new_value in new_vars.items():
            old_value = old_vars.get(var_name)

            if var_name not in old_vars or old_value != new_value or var_name in names_written:
                event = variable_changed_event(session_id, var_name, new_value, path)
                await push_service.push_variable_change(event)

    except Exception as e:
        logger.warning("Failed to push variable changes: %s", e)


async def _push_single_variable_change(
    session_id: str,
    name: str,
    value: Any,
    function_path: Sequence[str] | None = None,
) -> None:
    """Push one variable change; no ``function_path`` means the instance the caller runs in."""
    try:
        from wavecore.api.app import app

        push_service = getattr(app.state, "variable_push_service", None)
        if not push_service:
            return

        path = current_instance_path() if function_path is None else function_path
        await push_service.push_variable_change(
            variable_changed_event(session_id, name, value, path)
        )

    except Exception as e:
        logger.warning("Failed to push variable change for '%s': %s", name, e)


def _infer_variable_type(value: Any) -> str:
    """Infer WAVE type from Python value."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float | Decimal):
        return "float"
    if isinstance(value, str):
        return "string"
    # Table before list, matching ExecutionContext: a list of row maps is a
    # valid array AND a valid table, so only the declaration can tell them apart.
    if isinstance(value, Table):
        return "table"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "map"
    return "string"


def _add_execution_log(
    session_id: str,
    level: str,
    message: str,
    source: str,
    block_id: str | None = None,
    variant: str | None = None,
    unmask: bool | None = None,
) -> None:
    """Add a log entry during workbench execution.

    Logs to BOTH:
    1. WebSocket stream (console panel) - for that specific execution
    2. Backend terminal - for complete system visibility

    ``unmask`` carries a block-attributed per-block reveal choice; ``None``
    follows the system run-output default.
    """
    import logging

    from wavecore.api.services import log_streaming_service
    from wavecore.core.logging.formatter import format_source

    log_streaming_service.add_log(
        session_id=session_id,
        level=level,
        message=message,
        source=source,
        block_id=block_id,
        variant=variant,
        unmask=unmask,
    )

    terminal_msg = log_streaming_service.scrub_message(
        session_id, message, source, unmask=unmask, block_id=block_id
    )
    terminal_logger = logging.getLogger("wavecore.execution")
    formatted_source = format_source(source)
    terminal_message = f"{formatted_source} {terminal_msg}"

    level_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARN": logging.WARNING,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "FATAL": logging.CRITICAL,
        "CRITICAL": logging.CRITICAL,
    }
    log_level = level_map.get(level.upper(), logging.INFO)
    terminal_logger.log(log_level, terminal_message)


def _compute_subtree_boundary(
    node_id: str,
    adjacency: dict[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Any],
) -> set[str]:
    """Return the set of node ids that constitute the structural sub-tree rooted at ``node_id``.

    Algorithm:

        - From the root, only follow outgoing edges whose ``sourceHandle``
          is non-None and not equal to ``"then"``. This excludes both the
          ``then`` after-egress AND plain sequential next-node edges from
          atomic nodes (whose handles are typically ``None``).
        - From any descendant, follow every outgoing edge regardless of
          handle - the inner control's ``then`` is part of the outer body.
        - Descendant ids that the workflow does not actually contain
          (i.e., not in ``node_map``) are never enqueued. The root itself
          is always included regardless of ``node_map`` so callers can
          ask about an orphan id without first verifying its presence.

    The result always includes ``node_id`` itself. Atomic nodes return
    ``{node_id}``; composite single-egress nodes return their root plus
    every body descendant; branching nodes return the union of every
    branch's descendants.
    """
    boundary: set[str] = {node_id}
    visited: set[str] = {node_id}
    queue: list[str] = [
        child_id
        for child_id, handle in adjacency.get(node_id, [])
        if handle is not None and handle != "then" and child_id in node_map
    ]

    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        boundary.add(current)
        for child_id, _handle in adjacency.get(current, []):
            if child_id not in visited and child_id in node_map:
                queue.append(child_id)

    return boundary


def entry_adjacency(
    single_node_id: str | None,
    adjacency: dict[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Any],
) -> dict[str, list[tuple[str, str | None]]]:
    """The graph a run walks: the sub-tree of ``single_node_id`` (Run Current), else all of it."""
    if single_node_id is None:
        return adjacency
    boundary = _compute_subtree_boundary(single_node_id, adjacency, node_map)
    return {
        nid: [(target, handle) for target, handle in adjacency.get(nid, []) if target in boundary]
        for nid in boundary
    }


def _clear_sessions_sync() -> None:
    """Clear all workbench sessions synchronously."""
    from wavecore.api.services import artifact_service

    for task in _active_tasks.values():
        if task is not None and not task.done():
            task.cancel()

    for session_id in _workbench_sessions:
        artifact_service.wipe_session_artifacts(session_id)

    _workbench_sessions.clear()
    _active_tasks.clear()
    _user_active_session.clear()


async def _clear_sessions() -> None:
    """Clear all workbench sessions and cancel running tasks."""
    for _session_id, task in _active_tasks.items():
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    _workbench_sessions.clear()
    _active_tasks.clear()
    _user_active_session.clear()


# ---------------------------------------------------------------------------
# Debug pause machinery (shared by main loop, try-catch, for/while/foreach loops)
# ---------------------------------------------------------------------------


_PARK_POLL_SECONDS = 0.005


def _hold_section(session: dict[str, Any]) -> None:
    """Park every other concurrent walker while this one owns the debug pause."""
    session["_debug_hold"] = asyncio.current_task()


def _release_section(session: dict[str, Any]) -> None:
    """Release the parked walkers, unless the pause was released by a Step."""
    if session.get("pause_at_next_node") or session.get("step_over_from_node") is not None:
        return
    session.pop("_debug_hold", None)


async def park_while_held(session: dict[str, Any]) -> None:
    """Hold a concurrent branch at a block boundary while a sibling is paused."""
    if _repeating.get():
        return
    while True:
        holder = session.get("_debug_hold")
        if holder is None or holder is asyncio.current_task():
            return
        # A holder that ended still armed (stepped off the last block of its
        # branch, or was canceled) must not park its siblings forever.
        if holder.done():
            session.pop("_debug_hold", None)
            return
        if session.get("status") == WorkbenchStatus.STOPPED.value:
            return
        await asyncio.sleep(_PARK_POLL_SECONDS)


def _determine_pause_reason(session: dict[str, Any], node_id: str) -> str | None:
    """Return ``"breakpoint"`` / ``"first_block"`` / None for a node about to run."""
    breakpoints = session.get("breakpoints") or set()
    if node_id in breakpoints:
        return "breakpoint"

    debug_options = session.get("debug_options") or {}
    if debug_options.get("pause_on_first_block") and not session.get("_first_block_paused"):
        return "first_block"

    return None


async def _emit_breakpoint_hit(
    session_id: str,
    node_id: str,
    node_name: str,
    reason: str,
    exception: BaseException | None,
) -> None:
    """Emit a ``debug_breakpoint_hit`` WebSocket event."""
    exception_message: str | None = None
    if exception is not None:
        exception_message = str(exception)
        registry = (_workbench_sessions.get(session_id) or {}).get("secret_registry")
        if registry is not None and not masking_settings.is_run_output_revealed():
            from wavecore.core.secrets.masking import mask_text

            exception_message = mask_text(exception_message, registry.scan_values())
    await _broadcast_event(
        session_id,
        {
            "type": "debug_breakpoint_hit",
            "node_id": node_id,
            "node_name": node_name,
            "reason": reason,
            "exception_class": (type(exception).__name__ if exception is not None else None),
            "exception_message": exception_message,
        },
    )


# Task-local so concurrent Parallel lanes each keep their own Repeat Step target.
_repeat_target: ContextVar["DebugBlock | None"] = ContextVar("wave_repeat_target", default=None)
# True while Repeat Step runs a block: nothing inside the repeat pauses.
_repeating: ContextVar[bool] = ContextVar("wave_repeating", default=False)
# The block run in progress; a failure the user paused on marks it and every run around it.
_failure_watch: ContextVar["_FailureWatch | None"] = ContextVar("wave_failure_watch", default=None)


@contextlib.contextmanager
def _repeat_scope(block: "DebugBlock") -> Iterator[None]:
    """Point Repeat Step at one block while it may pause, then hand it back to the enclosing one."""
    token = _repeat_target.set(block)
    try:
        yield
    finally:
        _repeat_target.reset(token)


def _complete_step_over(session: dict[str, Any], node_id: str) -> None:
    """Once the stepped-over block finishes, arm the pause before the block after it."""
    if session.get("step_over_from_node") == node_id:
        session["step_over_from_node"] = None
        session["pause_at_next_node"] = True


@contextlib.contextmanager
def _substituted_parameters(session: dict[str, Any], node_id: str) -> Iterator[None]:
    """Hold Repeat Step's one-shot parameter substitution, then give the node its values back."""
    override = session.pop("repeat_step_override", None)
    node = (session.get("_node_map") or {}).get(node_id) or {}
    values = node.get("data", {}).get("config", {}).get("values")
    if not override or values is None:
        yield
        return
    saved = dict(values)
    values.update(override)
    try:
        yield
    finally:
        values.clear()
        values.update(saved)


async def _run_repeat_iteration(
    session: dict[str, Any],
    session_id: str,
    node_id: str,
    node_name: str,
) -> None:
    """Run the paused block again, keep the attempt as its result and broadcast the outcome.

    Returns silently when no block is paused in the running flow (defensive fallthrough).
    Successful repeats emit ``reason="step_complete"``; failures emit ``reason="error"``
    carrying the new exception.
    """
    block = _repeat_target.get()
    if block is None:
        return

    token = _repeating.set(True)
    try:
        with _substituted_parameters(session, node_id):
            attempt = await block.attempt()
    finally:
        _repeating.reset(token)
    attempt.shown = True
    block.latest = attempt

    failed = attempt.error is not None
    repeat_status = "failed" if failed else attempt.status
    session["block_states"][node_id] = repeat_status
    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": node_id,
            "block_name": node_name,
            "status": repeat_status,
        },
    )
    reason = "error" if failed else "step_complete"
    await _emit_breakpoint_hit(session_id, node_id, node_name, reason, attempt.error)
    log_level = {"failed": "ERROR", "skipped": "WARN"}.get(repeat_status, "INFO")
    _add_execution_log(
        session_id,
        log_level,
        f"⟳ Repeated '{node_name}' - {repeat_status}",
        "DEBUG",
        block_id=node_id,
        variant=repeat_status,
    )


async def _pause_for_debug(
    session: dict[str, Any],
    session_id: str,
    node_id: str,
    node_name: str,
    reason: str,
    exception: BaseException | None = None,
) -> None:
    """Pause the engine, emit ``debug_breakpoint_hit``, and await Continue/Skip/Repeat.

    Callers set ``reason`` to one of ``"breakpoint"``, ``"first_block"``,
    ``"error"``, ``"step"``. When ``exception`` is provided, its class name
    and message are included in the event payload; otherwise those fields
    are null.

    The wait loop consumes ``session["repeat_step_requested"]`` once per
    Continue/Step/Skip release: when the flag is set, the engine re-runs
    the paused block its running flow set with ``_repeat_scope`` and
    re-awaits ``pause_event`` without clearing ``paused_node_id``.
    Successful repeats emit a new ``debug_breakpoint_hit`` with
    ``reason="step_complete"``; failed repeats reuse ``reason="error"``
    and surface the new exception.
    """
    pause_event = session.get("pause_event")
    if pause_event is None:
        return

    session["status"] = WorkbenchStatus.PAUSED.value
    session["paused_node_id"] = node_id
    _hold_section(session)

    await _emit_breakpoint_hit(session_id, node_id, node_name, reason, exception)

    if reason == "error" and exception is not None:
        exc_class = type(exception).__name__
        log_message = f"⏸ Paused on error at {node_name}: {exc_class}: {exception}"
    else:
        log_message = f"⏸ Paused at {node_name} ({reason})"
    _add_execution_log(
        session_id,
        "WARN",
        log_message,
        "DEBUG",
        block_id=node_id,
        variant="paused",
    )

    while True:
        await pause_event.wait()
        pause_event.clear()

        if session.get("status") == WorkbenchStatus.STOPPED.value:
            break

        if not session.pop("repeat_step_requested", False):
            break

        await _run_repeat_iteration(session, session_id, node_id, node_name)

    if session.get("status") == WorkbenchStatus.PAUSED.value:
        session["status"] = WorkbenchStatus.RUNNING.value
    session["paused_node_id"] = None
    _release_section(session)


async def _maybe_pause_before_node(
    session: dict[str, Any],
    session_id: str,
    node_id: str,
    node_name: str,
) -> bool:
    """Check pause triggers and pause if needed. Returns True if the engine
    was stopped (caller should abort). Also sets ``_first_block_paused``
    after the first visited workflow node regardless of pause reason.

    Three triggers, in priority order:
      1. ``pause_at_next_node`` one-shot flag (set by ``skip_current_block``,
         ``step_into``, or post-Step-Over completion) - re-pauses with
         ``reason="step"``. Consumed on fire.
      2. Node id in ``session["breakpoints"]`` - pauses with ``reason="breakpoint"``.
      3. ``pause_on_first_block`` option - pauses with ``reason="first_block"``
         before the first visited workflow node.

    While ``step_over_from_node`` is non-None and points at a different node,
    all pauses are suppressed: the engine is currently inside the sub-graph
    of the stepped-over parent and re-pauses only after that parent completes
    (the main loop in ``execution._execute_workflow`` clears the flag and
    sets ``pause_at_next_node`` so step (1) above fires on the next node).
    """
    step_over_from = session.get("step_over_from_node")
    if _repeating.get() or (step_over_from is not None and step_over_from != node_id):
        return False

    # Nodes already marked as skipped (cascade from a single-egress parent
    # skip, or a runtime skip-block on the parent itself) must not consume
    # pause triggers - the trigger is meant for the first non-skipped node.
    if node_id in (session.get("skipped_node_ids") or []):
        return False

    if session.pop("pause_at_next_node", False):
        await _pause_for_debug(session, session_id, node_id, node_name, "step")
        if session.get("status") == WorkbenchStatus.STOPPED.value:
            return True
        session["_first_block_paused"] = True
        return False

    pause_reason = _determine_pause_reason(session, node_id)
    if pause_reason is not None:
        await _pause_for_debug(session, session_id, node_id, node_name, pause_reason)
        if session.get("status") == WorkbenchStatus.STOPPED.value:
            return True
    session["_first_block_paused"] = True
    return False


@dataclass
class _FailureWatch:
    """Whether a failure inside one block run already paused the debugger."""

    parent: "_FailureWatch | None"
    surfaced: bool = False


def _mark_failure_surfaced() -> None:
    """The runs around the current block fail from a failure the user already paused on."""
    watch = _failure_watch.get()
    while watch is not None and not watch.surfaced:
        watch.surfaced = True
        watch = watch.parent


@dataclass
class BlockAttempt:
    """One run of a block into a copy of its walker's state; only the run the flow keeps commits."""

    executed: set[str]
    queue: list[str]
    status: str = "passed"
    outcome: Any = None
    error: Exception | None = None
    surfaced: bool = False
    shown: bool = False


@dataclass
class DebugBlock:
    """A block a walker runs under the debugger (REQ-3.2.1.3, REQ-3.2.1.4, REQ-3.2.2.2).

    ``run`` runs it once into an attempt and raises on failure; ``skip`` handles a disabled
    or skipped block and returns True when it did.
    """

    session: dict[str, Any]
    session_id: str
    node_id: str
    node_name: str
    run: Callable[[BlockAttempt], Awaitable[str]]
    skip: Callable[[], Awaitable[bool]]
    executed: set[str] | None = None
    queue: list[str] | None = None
    container: bool = False
    latest: BlockAttempt | None = None

    async def attempt(self) -> BlockAttempt:
        """Run the block once; the walker's state changes only when the attempt commits."""
        attempt = BlockAttempt(set(self.executed or ()), list(self.queue or ()))
        watch = _FailureWatch(_failure_watch.get())
        token = _failure_watch.set(watch)
        try:
            attempt.status = await self.run(attempt)
        except Exception as exc:
            attempt.error = exc
        finally:
            _failure_watch.reset(token)
        attempt.surfaced = watch.surfaced
        return attempt

    def result(self) -> BlockAttempt | None:
        """The result the block advances with; Step Into on a container runs it again instead."""
        if self.container and self.session.get("pause_at_next_node"):
            return None
        return self.latest

    def pauses_on(self, attempt: BlockAttempt) -> bool:
        """A failure pauses once: not in a repeat, not once shown, not after a pause inside it."""
        if attempt.error is None or attempt.shown or attempt.surfaced or _repeating.get():
            return False
        options = self.session.get("debug_options") or {}
        return bool(options.get("pause_on_errors")) and self.session.get("pause_event") is not None

    def commit(self, attempt: BlockAttempt) -> None:
        """Keep the attempt's state; a failure ends a Step Over and is not paused on again."""
        if self.executed is not None:
            self.executed.update(attempt.executed)
        if self.queue is not None:
            self.queue[:] = attempt.queue
        if attempt.error is None:
            return
        _complete_step_over(self.session, self.node_id)
        if attempt.shown:
            _mark_failure_surfaced()


def is_container(
    node_type: str, node_id: str, adj: Mapping[str, list[tuple[str, str | None]]] | None
) -> bool:
    """A container or a Function instance, which Step Into enters."""
    outgoing = (adj or {}).get(node_id, [])
    return node_type == "function" or any(handle not in (None, "then") for _id, handle in outgoing)


_PRE_BLOCK_REVEAL_WARNING = (
    "Secret masking bypassed for this block - "
    "secret values appear in cleartext in its logs and reports."
)


def _pre_block_reveal_warning(secret_masking: str) -> str | None:
    """The pre-block WARN for an effective-revealing block, or None."""
    if masking_settings.is_run_output_revealed():
        return None
    if masking_settings.resolve_block_reveal(secret_masking):
        return _PRE_BLOCK_REVEAL_WARNING
    return None


@dataclass
class NodeStep(ABC):
    """One workflow node and the run state a walker runs it against under the debugger."""

    node_id: str
    node: dict[str, Any]
    nf: dict[str, Any]
    node_map: dict[str, Any]
    variables: dict[str, Any]
    session: dict[str, Any]
    session_id: str
    executed: set[str] | None
    environment_id: str | None
    adj: dict[str, list[tuple[str, str | None]]] | None

    @abstractmethod
    async def run(self, attempt: BlockAttempt) -> str:
        """Run the node once into ``attempt`` and return its status; raise when it fails."""

    async def _warned_run(self, attempt: BlockAttempt) -> str:
        """Run the node, after the WARN every Block whose run output reveals secrets gets."""
        warning = _pre_block_reveal_warning(self.nf["secret_masking"])
        if warning is not None:
            _add_execution_log(
                self.session_id, "WARN", warning, "SYSTEM", block_id=self.node_id, variant="warning"
            )
        return await self.run(attempt)

    async def skip(self) -> bool:
        """Store and paint a disabled or runtime-skipped node skipped; True when it was."""
        from wavecore.api.services.workbench.signals import skip_disabled_block

        is_disabled = self.nf["node_data"].get("disabled", False)
        if not is_disabled and self.node_id not in (self.session.get("skipped_node_ids") or []):
            return False
        if self.executed is not None:
            self.executed.add(self.node_id)
        await skip_disabled_block(
            self.node, self.node_id, self.adj, self.node_map, self.session, self.session_id
        )
        return True

    def debug_block(self, queue: list[str] | None = None) -> DebugBlock:
        return DebugBlock(
            self.session,
            self.session_id,
            self.node_id,
            self.nf["block_name"],
            self._warned_run,
            self.skip,
            executed=self.executed,
            queue=queue,
            container=is_container(self.nf["node_type"], self.node_id, self.adj),
        )


async def _advance(block: DebugBlock) -> BlockAttempt | None:
    """Leave a pause: stop, skip, keep the block's result or run the block."""
    if block.session.get("status") == WorkbenchStatus.STOPPED.value or await block.skip():
        return None
    return block.result() or await block.attempt()


async def run_debug_block(block: DebugBlock) -> BlockAttempt | None:
    """Run one block under the debugger; None when the run stopped or the block was skipped."""
    session, session_id = block.session, block.session_id
    with _repeat_scope(block):
        if await _maybe_pause_before_node(session, session_id, block.node_id, block.node_name):
            return None
        attempt = await _advance(block)
        while attempt is not None and block.pauses_on(attempt):
            attempt.shown = True
            block.latest = attempt
            await _pause_for_debug(
                session, session_id, block.node_id, block.node_name, "error", attempt.error
            )
            attempt = await _advance(block)
    if attempt is not None:
        block.commit(attempt)
    return attempt
