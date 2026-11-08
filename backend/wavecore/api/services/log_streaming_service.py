"""Log streaming for the Execution Detail console and the Workbench viewer.

Two kinds of log sinks live here:

- **Tracked sinks**: a workbench session mapped to a
  ``(execution_id, run_id)`` pair. Every log line is appended to
  ``logs/<run_id>.yaml`` via the executions storage layer (one small file
  per test, O(1) append), and the entry is broadcast on two WebSocket
  topics:

    - ``log:<child_session_id>`` - the per-test viewer.
    - ``log:<execution_id>``    - the merged stream the Execution Detail
      page subscribes to. This is pub/sub only; nothing writes a merged
      log file on disk.

- **Ephemeral sinks**: a workbench session with no tracked-execution
  mapping (single tests opened from the Workbench without starting a
  tracked run). Logs live only in memory and only ever go out via the
  session's own topic.

Historical log retrieval for tracked executions is served from disk via
``_tail_logs`` in the storage layer (reverse-walk of ``runs.yaml``).
Ephemeral sessions are served from their in-memory buffer.
"""

import asyncio
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.executions._storage import (
    _append_chronology,
    _append_log,
    _load_test_logs,
    _tail_logs,
)
from wavecore.core.logging.formatter import cap_message
from wavecore.core.secrets import masking_settings
from wavecore.core.secrets.masking import mask_text
from wavecore.core.secrets.registry import SecretRegistry

if TYPE_CHECKING:
    from wavecore.api.websocket.manager import WebSocketManager


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


LOG_LEVEL_HIERARCHY: dict[str, int] = {
    "DEBUG": 0,
    "INFO": 1,
    "WARN": 2,
    "ERROR": 3,
    "FATAL": 4,
}

VALID_LOG_LEVELS = set(LOG_LEVEL_HIERARCHY.keys())

_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------


# Ephemeral-only session buffers. Tracked sessions skip the buffer entirely.
_session_logs: dict[str, list[dict[str, Any]]] = {}
_sequence_counters: dict[str, int] = {}

# Tracked mapping: child workbench session_id -> (execution_id, run_id).
# Written to by ``register_log_sink``; cleared by ``unregister_log_sink``.
_session_sink: dict[str, tuple[str, str]] = {}
_session_meta: dict[str, dict[str, Any]] = {}

# WebSocket broadcast managers.
_broadcast_manager: "WebSocketManager | None" = None
_session_managers: dict[str, "WebSocketManager"] = {}

# One ordered queue + single drainer task per session so every subscriber
# receives console lines in log order.
_session_queues: dict[str, "asyncio.Queue[tuple[WebSocketManager, dict[str, Any]]]"] = {}
_session_drainers: dict[str, "asyncio.Task[None]"] = {}

# Per-run secret registries for value-scrubbing log text (REQ-3.1.3.5).
_session_registries: dict[str, SecretRegistry] = {}


# ---------------------------------------------------------------------------
# Manager wiring
# ---------------------------------------------------------------------------


def set_broadcast_manager(manager: "WebSocketManager") -> None:
    global _broadcast_manager
    _broadcast_manager = manager


def clear_broadcast_manager() -> None:
    global _broadcast_manager
    _broadcast_manager = None


def register_session_manager(session_id: str, manager: "WebSocketManager") -> None:
    _session_managers[session_id] = manager


def unregister_session_manager(session_id: str) -> None:
    _session_managers.pop(session_id, None)


# ---------------------------------------------------------------------------
# Tracked-session mapping
# ---------------------------------------------------------------------------


def register_log_sink(
    session_id: str,
    execution_id: str,
    run_id: str,
    test_id: str | None = None,
) -> None:
    """Route logs for ``session_id`` to ``logs/<run_id>.yaml`` under
    ``execution_id`` and publish them on ``log:<execution_id>`` too.
    """
    _session_sink[session_id] = (execution_id, run_id)
    meta: dict[str, Any] = {}
    if test_id is not None:
        meta["test_id"] = test_id
    if meta:
        _session_meta[session_id] = meta


def unregister_log_sink(session_id: str) -> None:
    _session_sink.pop(session_id, None)
    _session_meta.pop(session_id, None)


def register_secret_registry(session_id: str, registry: SecretRegistry) -> None:
    """Attach the run's SecretRegistry so every log line scrubs its values."""
    _session_registries[session_id] = registry


def get_secret_registry(session_id: str) -> SecretRegistry | None:
    """The registry attached to ``session_id``, or None (used by terminal twins)."""
    return _session_registries.get(session_id)


def scrub_message(
    session_id: str,
    message: str,
    source: str,
    unmask: bool | None = None,
    block_id: str | None = None,
    *,
    force_mask: bool = False,
) -> str:
    """Value-scrub ``message`` with the session's registry.

    A block-attributed line carries its resolved per-block reveal in ``unmask``
    (``True`` reveal, ``False`` mask); that choice is authoritative and an
    explicit ``mask`` stays masked even under a system-wide run-output reveal.
    A SYSTEM line or a line with no per-block choice (``unmask is None``)
    follows the system ``run_output`` default. ``block_id`` exempts that block's
    own per-field-revealed values from the scrub. ``force_mask`` is the at-rest
    form for persisted records (disk logs, reports): the temporary system
    run-output reveal never persists, but a block's own per-field reveal (a
    persistent config, registered exempt) still shows in that block's own lines.
    """
    registry = _session_registries.get(session_id)
    if registry is None:
        return cap_message(message)
    if force_mask:
        return cap_message(mask_text(message, registry.scan_values(exclude_for_block=block_id)))
    if unmask is not None and source != "SYSTEM":
        if unmask:
            return cap_message(message)
        return cap_message(mask_text(message, registry.scan_values(exclude_for_block=block_id)))
    if masking_settings.is_run_output_revealed():
        return cap_message(message)
    return cap_message(mask_text(message, registry.scan_values(exclude_for_block=block_id)))


# ---------------------------------------------------------------------------
# Log entry creation
# ---------------------------------------------------------------------------


def _build_entry(
    level: str,
    message: str,
    source: str,
    block_id: str | None = None,
    variant: str | None = None,
) -> dict[str, Any]:
    if level not in VALID_LOG_LEVELS:
        raise ValidationException(
            f"Invalid log level '{level}'. Must be one of: {', '.join(VALID_LOG_LEVELS)}"
        )
    import uuid

    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "level": level,
        "message": cap_message(message),
        "source": source,
        "blockId": block_id,
    }
    if variant:
        entry["variant"] = variant
    return entry


def create_log_entry(
    level: str,
    message: str,
    source: str,
    block_id: str | None = None,
    session_id: str | None = None,
    variant: str | None = None,
) -> dict[str, Any]:
    """Create a log entry carrying a session-scoped ``sequence`` for
    in-memory callers (ephemeral sessions, the workbench viewer)."""
    entry = _build_entry(level, message, source, block_id=block_id, variant=variant)
    sequence = 0
    if session_id:
        sequence = _get_next_sequence(session_id)
    entry["sequence"] = sequence
    return entry


def _get_next_sequence(session_id: str) -> int:
    """Monotonic per-session counter for ephemeral in-memory buffers."""
    if session_id not in _sequence_counters:
        logs = _session_logs.get(session_id, [])
        if logs:
            _sequence_counters[session_id] = max(log.get("sequence", -1) for log in logs) + 1
        else:
            _sequence_counters[session_id] = 0
    seq = _sequence_counters[session_id]
    _sequence_counters[session_id] = seq + 1
    return seq


# ---------------------------------------------------------------------------
# Log ingestion
# ---------------------------------------------------------------------------


def emit_scope_log(
    execution_id: str,
    scope_kind: str,
    message: str,
    *,
    level: str = "INFO",
    source: str = "SYSTEM",
    variant: str | None = None,
    suite_id: str | None = None,
) -> dict[str, Any]:
    """Append a regression- or suite-level log entry to ``logs.yaml`` and
    broadcast it on the parent execution's log topic.

    ``scope_kind`` is ``"regression"`` or ``"suite"``. Suite-level logs
    must supply ``suite_id``. These are the persisted companions to the
    per-test log files: boundary banners, scope-plugin output, etc.
    """
    entry = _build_entry(level, message, source, variant=variant)
    chronology_entry: dict[str, Any] = {"type": scope_kind, **entry}
    if scope_kind == "suite" and suite_id is not None:
        chronology_entry["suite_id"] = suite_id
    _append_chronology(execution_id, chronology_entry)
    broadcast_entry = {**entry, "scope_kind": scope_kind}
    if scope_kind == "suite" and suite_id is not None:
        broadcast_entry["suite_id"] = suite_id
    _publish(execution_id, broadcast_entry)
    return broadcast_entry


def emit_test_reference(execution_id: str, run_id: str) -> None:
    """Record a ``{type: "test", run_id}`` reference in ``logs.yaml``.

    Called by the sequential driver at test-dispatch time - BEFORE the
    first log arrives - so reassembly can always expand per-test log
    files, including during a live run or after a crash.
    """
    _append_chronology(execution_id, {"type": "test", "run_id": run_id})


def add_log(
    session_id: str,
    level: str,
    message: str,
    source: str,
    block_id: str | None = None,
    variant: str | None = None,
    unmask: bool | None = None,
) -> dict[str, Any]:
    """Ingest a log line from a workbench session and route it to the
    right sinks (disk + WebSocket pub/sub).

    Tracked sessions (``register_log_sink`` was called for ``session_id``)
    append to ``logs/<run_id>.yaml`` with a per-file ``seq`` and publish on
    both the child topic and the parent execution topic. Ephemeral sessions
    keep the entry in memory and broadcast on the child topic only.
    Message text is value-scrubbed at this chokepoint (REQ-3.1.3.5); a
    block-attributed ``unmask`` (``True``/``False``) is authoritative, while
    ``None`` (generic / SYSTEM lines) follows the system run-output default.
    The live broadcast (and the in-memory buffer that replays it to the live
    console) carries this reveal-aware form; the persisted disk log is always
    masked, so a reveal window never bakes plaintext into the stored record.
    """
    live_message = scrub_message(session_id, message, source, unmask=unmask, block_id=block_id)
    sink = _session_sink.get(session_id)
    if sink is None:
        entry = create_log_entry(
            level=level,
            message=live_message,
            source=source,
            block_id=block_id,
            session_id=session_id,
            variant=variant,
        )
        _session_logs.setdefault(session_id, []).append(entry)
        _publish(session_id, entry)
        return entry

    stored_message = scrub_message(session_id, message, source, block_id=block_id, force_mask=True)
    execution_id, run_id = sink
    disk_entry = _build_entry(level, stored_message, source, block_id=block_id, variant=variant)
    seq = _append_log(execution_id, run_id, disk_entry)
    meta = _session_meta.get(session_id, {})
    broadcast_entry: dict[str, Any] = {
        **disk_entry,
        "message": live_message,
        "seq": seq,
        "run_id": run_id,
    }
    if "test_id" in meta:
        broadcast_entry["test_id"] = meta["test_id"]
    _publish(session_id, broadcast_entry)
    _publish(execution_id, broadcast_entry)
    return broadcast_entry


# ---------------------------------------------------------------------------
# WebSocket publication
# ---------------------------------------------------------------------------


def _publish(session_id: str, entry: dict[str, Any]) -> None:
    manager = _session_managers.get(session_id) or _broadcast_manager
    if manager is None:
        return
    _schedule_broadcast(manager, session_id, entry)


def _schedule_broadcast(
    manager: "WebSocketManager", session_id: str, entry: dict[str, Any]
) -> None:
    """Enqueue onto the session's ordered queue; the drainer sends in log order."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    queue = _session_queues.get(session_id)
    if queue is None:
        queue = asyncio.Queue()
        _session_queues[session_id] = queue
    queue.put_nowait((manager, entry))
    if session_id not in _session_drainers:
        _session_drainers[session_id] = loop.create_task(
            _drain_session_broadcasts(session_id, queue)
        )


async def _drain_session_broadcasts(
    session_id: str, queue: "asyncio.Queue[tuple[WebSocketManager, dict[str, Any]]]"
) -> None:
    """Single consumer per session: delivers queued entries strictly FIFO."""
    while True:
        manager, entry = await queue.get()
        try:
            await _broadcast_entry(manager, session_id, entry)
        except Exception:
            # One bad entry must never end the session's stream; CancelledError
            # is a BaseException, so teardown still stops this task.
            _logger.exception("Log broadcast failed for session %s", session_id)
        queue.task_done()


async def _broadcast_entry(
    manager: "WebSocketManager", session_id: str, entry: dict[str, Any]
) -> None:
    topic = get_log_topic(session_id)
    log_level_severity = LOG_LEVEL_HIERARCHY[entry["level"]]

    # Snapshot: a tab connecting or closing mid-send mutates the live map.
    for conn_id, metadata in manager._metadata.copy().items():
        if topic not in metadata.subscriptions:
            continue
        sub_level = manager.get_log_subscription_level(conn_id, session_id)
        if sub_level is None:
            continue
        min_severity = LOG_LEVEL_HIERARCHY.get(sub_level, 0)
        if log_level_severity < min_severity:
            continue
        event = {
            "type": "event",
            "topic": topic,
            "payload": entry,
            "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        websocket = manager.active_connections.get(conn_id)
        if websocket:
            try:
                await websocket.send_json(event)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------


def get_logs(session_id: str) -> list[dict[str, Any]]:
    """Return the in-memory log buffer for an ephemeral session.

    Tracked executions do not use the in-memory buffer; call
    ``fetch_execution_logs`` or ``fetch_run_logs`` instead.
    """
    return _session_logs.get(session_id, [])


def fetch_execution_logs(
    execution_id: str,
    before: tuple[int, int | None] | None,
    limit: int,
) -> tuple[list[dict[str, Any]], tuple[int, int | None] | None]:
    """Paginated merged log stream for a tracked execution.

    Returns ``(entries, prev_cursor)``. ``prev_cursor`` is ``None`` when
    the start of history has been reached. Entries come back in
    chronological order (oldest first) and carry their ``run_id`` +
    per-file ``seq`` so the FE can dedupe against live WS pushes.
    """
    return _tail_logs(execution_id, before, limit)


def fetch_run_logs(execution_id: str, run_id: str) -> list[dict[str, Any]]:
    """Full log history for a single test run (Historical Test Canvas)."""
    entries = _load_test_logs(execution_id, run_id)
    return [{**e, "run_id": run_id} for e in entries]


def filter_logs_by_level(logs: list[dict[str, Any]], level: str) -> list[dict[str, Any]]:
    if level not in VALID_LOG_LEVELS:
        raise ValidationException(
            f"Invalid log level '{level}'. Must be one of: {', '.join(VALID_LOG_LEVELS)}"
        )
    min_severity = LOG_LEVEL_HIERARCHY[level]
    return [log for log in logs if LOG_LEVEL_HIERARCHY.get(log["level"], 0) >= min_severity]


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------


def get_log_topic(session_id: str) -> str:
    return f"log:{session_id}"


async def broadcast_log(
    session_id: str,
    level: str,
    message: str,
    source: str,
    manager: "WebSocketManager",
    block_id: str | None = None,
) -> None:
    """Broadcast a log entry to subscribers without persisting. Kept for
    out-of-band signals that shouldn't land on disk (e.g. transient
    control messages)."""
    entry = create_log_entry(
        level=level,
        message=message,
        source=source,
        block_id=block_id,
        session_id=session_id,
    )
    topic = get_log_topic(session_id)
    log_level_severity = LOG_LEVEL_HIERARCHY[level]
    for conn_id, metadata in manager._metadata.items():
        if topic not in metadata.subscriptions:
            continue
        sub_level = manager.get_log_subscription_level(conn_id, session_id)
        if sub_level is None:
            continue
        min_severity = LOG_LEVEL_HIERARCHY.get(sub_level, 0)
        if log_level_severity < min_severity:
            continue
        envelope = {
            "type": "event",
            "topic": topic,
            "payload": entry,
        }
        websocket = manager.active_connections.get(conn_id)
        if websocket:
            try:
                await websocket.send_json(envelope)
            except Exception:
                pass


def add_log_and_broadcast(
    session_id: str,
    level: str,
    message: str,
    source: str,
    block_id: str | None = None,
) -> dict[str, Any]:
    """Persist + broadcast atomically. Used by call sites that want the
    returned entry.

    Broadcasting is handled transparently by ``add_log`` via the
    registered session/broadcast managers, so this wrapper is a
    synchronous thin helper that simply returns the persisted entry.
    """
    return add_log(
        session_id=session_id,
        level=level,
        message=message,
        source=source,
        block_id=block_id,
    )


def _teardown_session_drainer(session_id: str) -> None:
    task = _session_drainers.pop(session_id, None)
    if task is not None and not task.get_loop().is_closed():
        task.cancel()
    _session_queues.pop(session_id, None)


def _clear_session_logs(session_id: str) -> None:
    _session_logs.pop(session_id, None)
    _sequence_counters.pop(session_id, None)
    _session_managers.pop(session_id, None)
    _session_sink.pop(session_id, None)
    _session_meta.pop(session_id, None)
    _session_registries.pop(session_id, None)
    _teardown_session_drainer(session_id)


def _clear_cache() -> None:
    _sequence_counters.clear()
    _session_managers.clear()
    _session_sink.clear()
    _session_meta.clear()
    _session_registries.clear()
    # Teardown mutates the registry, so snapshot the ids first.
    drainer_ids = [*_session_drainers]
    for session_id in drainer_ids:
        _teardown_session_drainer(session_id)
    _session_queues.clear()
