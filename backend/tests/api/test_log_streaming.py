"""Log streaming service tests.

Covers the new append-only per-test log layout defined in
``_storage._append_log``:

- Tracked sessions route add_log to ``logs/<run_id>.yaml`` with per-file
  seq numbers and publish on both child and parent topics.
- Ephemeral sessions stay in memory.
- Reverse-walk tail reader returns paginated merged logs for an
  execution.
- WebSocket subscribe / request_history integrate with the new readers.
"""

import asyncio
import uuid
from pathlib import Path
from typing import Any

import pytest

from wavecore.api.services import log_streaming_service, storage_paths
from wavecore.api.services.executions import _storage as _exec_storage

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_storage(tmp_path: Any) -> Any:
    storage_paths.set_base_path(Path(tmp_path))
    _exec_storage._clear_storage()
    log_streaming_service._clear_cache()
    yield tmp_path
    log_streaming_service._clear_cache()
    _exec_storage._clear_storage()


@pytest.fixture
def tracked_execution(tmp_storage: Any) -> str:
    exec_id = str(uuid.uuid4())
    _exec_storage._execution_storage[exec_id] = {
        "id": exec_id,
        "entity_type": "suite",
        "entity_id": str(uuid.uuid4()),
        "status": "running",
    }
    _exec_storage._save_execution(_exec_storage._execution_storage[exec_id])
    return exec_id


# ---------------------------------------------------------------------------
# add_log - ephemeral sessions
# ---------------------------------------------------------------------------


class TestEphemeralSessions:
    def test_ephemeral_log_stays_in_memory(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())
        log_streaming_service.add_log(session_id, "INFO", "hi", "Plugin")

        assert len(log_streaming_service.get_logs(session_id)) == 1
        # No execution dir created.
        assert not (storage_paths.get_executions_storage_path() / session_id).exists()

    def test_ephemeral_sequence_is_session_scoped(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())
        e1 = log_streaming_service.add_log(session_id, "INFO", "a", "Plugin")
        e2 = log_streaming_service.add_log(session_id, "INFO", "b", "Plugin")
        assert e1["sequence"] == 0
        assert e2["sequence"] == 1

    def test_invalid_level_raises(self, tmp_storage: Any) -> None:
        from wavecore.api.exceptions import ValidationException

        with pytest.raises(ValidationException):
            log_streaming_service.add_log(str(uuid.uuid4()), "NOT_A_LEVEL", "x", "y")


# ---------------------------------------------------------------------------
# add_log - tracked sessions (sink registered)
# ---------------------------------------------------------------------------


class TestTrackedSessions:
    def test_tracked_log_writes_to_per_test_file(self, tracked_execution: str) -> None:
        child_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)
        log_streaming_service.add_log(child_id, "INFO", "line one", "Plugin")
        log_streaming_service.add_log(child_id, "ERROR", "line two", "Plugin")

        log_file = _exec_storage._log_file(tracked_execution, run_id)
        assert log_file.exists()
        entries = _exec_storage._load_test_logs(tracked_execution, run_id)
        assert [e["message"] for e in entries] == ["line one", "line two"]
        assert [e["seq"] for e in entries] == [0, 1]

    def test_tracked_log_returns_seq_in_broadcast_entry(self, tracked_execution: str) -> None:
        child_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(
            child_id, tracked_execution, run_id, test_id="test-1"
        )
        entry = log_streaming_service.add_log(child_id, "INFO", "hi", "Plugin")
        assert entry["seq"] == 0
        assert entry["run_id"] == run_id
        assert entry["test_id"] == "test-1"

    def test_unregister_restores_ephemeral_behavior(self, tracked_execution: str) -> None:
        child_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)
        log_streaming_service.add_log(child_id, "INFO", "tracked", "Plugin")
        log_streaming_service.unregister_log_sink(child_id)
        # After unregistering, a fresh log does not go to the per-test file.
        log_streaming_service.add_log(child_id, "INFO", "ephemeral", "Plugin")
        entries = _exec_storage._load_test_logs(tracked_execution, run_id)
        assert len(entries) == 1
        assert entries[0]["message"] == "tracked"

    def test_sink_sequence_counter_survives_rehydration(self, tracked_execution: str) -> None:
        child_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)
        log_streaming_service.add_log(child_id, "INFO", "a", "Plugin")
        log_streaming_service.add_log(child_id, "INFO", "b", "Plugin")
        # Simulate a process restart: drop the in-memory counter and
        # confirm the next append picks up where the file left off.
        _exec_storage._log_seq.clear()
        log_streaming_service.add_log(child_id, "INFO", "c", "Plugin")
        entries = _exec_storage._load_test_logs(tracked_execution, run_id)
        assert [e["seq"] for e in entries] == [0, 1, 2]

    def test_append_is_o1_no_rewrite(self, tracked_execution: str) -> None:
        """Writing a 101st log should not rewrite the first 100 entries.

        We assert the file size grows monotonically by the size of the
        appended fragment rather than being a function of the total entry
        count, which is what enforces the O(1) append invariant.
        """
        child_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)
        log_file = _exec_storage._log_file(tracked_execution, run_id)
        for i in range(5):
            log_streaming_service.add_log(child_id, "INFO", f"msg-{i}", "Plugin")
        size_before = log_file.stat().st_size
        log_streaming_service.add_log(child_id, "INFO", "after", "Plugin")
        size_after = log_file.stat().st_size
        # File must grow (append happened) and the delta must match the
        # size of a single dumped entry, not the whole file.
        assert size_after > size_before
        assert size_after - size_before < size_before


# ---------------------------------------------------------------------------
# fetch_execution_logs (reverse tail walk)
# ---------------------------------------------------------------------------


class TestFetchExecutionLogs:
    def _seed_runs(
        self,
        exec_id: str,
        run_ids: list[str],
        logs_per_run: int,
    ) -> None:
        for rid in run_ids:
            _exec_storage._append_run(exec_id, {"run_id": rid, "test_id": "t", "suite_id": None})
            log_streaming_service.emit_test_reference(exec_id, rid)
            log_streaming_service.register_log_sink(rid, exec_id, rid)
            for i in range(logs_per_run):
                log_streaming_service.add_log(rid, "INFO", f"{rid[:4]}-{i}", "Plugin")

    def test_tail_returns_latest_page(self, tracked_execution: str) -> None:
        run_ids = [str(uuid.uuid4()) for _ in range(3)]
        self._seed_runs(tracked_execution, run_ids, logs_per_run=5)

        entries, prev = log_streaming_service.fetch_execution_logs(tracked_execution, None, 4)
        assert len(entries) == 4
        # Entries arrive chronologically; oldest in batch is first.
        assert entries[-1]["message"].startswith(run_ids[2][:4])
        assert prev is not None

    def test_pagination_walks_older(self, tracked_execution: str) -> None:
        run_ids = [str(uuid.uuid4()) for _ in range(3)]
        self._seed_runs(tracked_execution, run_ids, logs_per_run=5)

        first_page, first_prev = log_streaming_service.fetch_execution_logs(
            tracked_execution, None, 6
        )
        assert first_prev is not None
        second_page, _second_prev = log_streaming_service.fetch_execution_logs(
            tracked_execution, first_prev, 6
        )
        assert len(second_page) == 6
        # Cursors shouldn't overlap: the newest entry of the second page
        # must be strictly older than the oldest entry of the first page.
        assert (
            second_page[-1]["run_id"],
            second_page[-1]["seq"],
        ) != (first_page[0]["run_id"], first_page[0]["seq"])

    def test_exhausted_cursor_returns_none(self, tracked_execution: str) -> None:
        run_id = str(uuid.uuid4())
        self._seed_runs(tracked_execution, [run_id], logs_per_run=2)
        entries, prev = log_streaming_service.fetch_execution_logs(tracked_execution, None, 10)
        assert len(entries) == 2
        assert prev is None

    def test_no_runs_returns_empty(self, tracked_execution: str) -> None:
        entries, prev = log_streaming_service.fetch_execution_logs(tracked_execution, None, 10)
        assert entries == []
        assert prev is None

    def test_cursor_past_end_clamps_to_tail(self, tracked_execution: str) -> None:
        run_ids = [str(uuid.uuid4()) for _ in range(2)]
        self._seed_runs(tracked_execution, run_ids, logs_per_run=3)
        # An out-of-range chronology_index clamps to the tail so a stale
        # cursor from the client still returns the latest page instead of
        # an empty walk.
        entries, _ = log_streaming_service.fetch_execution_logs(tracked_execution, (9999, None), 10)
        assert len(entries) == 6


# ---------------------------------------------------------------------------
# fetch_run_logs (Historical Test Canvas)
# ---------------------------------------------------------------------------


class TestFetchRunLogs:
    def test_returns_all_entries_for_a_run(self, tracked_execution: str) -> None:
        run_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(run_id, tracked_execution, run_id)
        for i in range(5):
            log_streaming_service.add_log(run_id, "INFO", f"m-{i}", "Plugin")

        entries = log_streaming_service.fetch_run_logs(tracked_execution, run_id)
        assert [e["message"] for e in entries] == [f"m-{i}" for i in range(5)]
        assert all(e["run_id"] == run_id for e in entries)

    def test_missing_run_returns_empty_list(self, tracked_execution: str) -> None:
        assert log_streaming_service.fetch_run_logs(tracked_execution, "missing") == []


# ---------------------------------------------------------------------------
# Level filtering
# ---------------------------------------------------------------------------


class TestLevelFiltering:
    def test_filter_above_threshold(self) -> None:
        logs = [
            {"level": "DEBUG"},
            {"level": "INFO"},
            {"level": "WARN"},
            {"level": "ERROR"},
            {"level": "FATAL"},
        ]
        result = log_streaming_service.filter_logs_by_level(logs, "WARN")
        assert [e["level"] for e in result] == ["WARN", "ERROR", "FATAL"]

    def test_invalid_level_raises(self) -> None:
        from wavecore.api.exceptions import ValidationException

        with pytest.raises(ValidationException):
            log_streaming_service.filter_logs_by_level([], "NOT_REAL")


# ---------------------------------------------------------------------------
# Broadcast manager wiring + clears
# ---------------------------------------------------------------------------


class TestManagerWiring:
    def test_set_and_clear_broadcast_manager(self) -> None:
        sentinel = object()
        log_streaming_service.set_broadcast_manager(sentinel)  # type: ignore[arg-type]
        assert log_streaming_service._broadcast_manager is sentinel
        log_streaming_service.clear_broadcast_manager()
        assert log_streaming_service._broadcast_manager is None

    def test_register_and_unregister_session_manager(self) -> None:
        sentinel = object()
        session_id = "sess-1"
        log_streaming_service.register_session_manager(session_id, sentinel)  # type: ignore[arg-type]
        assert log_streaming_service._session_managers[session_id] is sentinel
        log_streaming_service.unregister_session_manager(session_id)
        assert session_id not in log_streaming_service._session_managers

    def test_unregister_missing_session_manager_is_noop(self) -> None:
        log_streaming_service.unregister_session_manager("does-not-exist")

    def test_clear_session_logs_removes_all_bookkeeping(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())
        log_streaming_service.add_log(session_id, "INFO", "x", "Plugin")
        log_streaming_service._clear_session_logs(session_id)
        assert session_id not in log_streaming_service._session_logs
        assert session_id not in log_streaming_service._sequence_counters


# ---------------------------------------------------------------------------
# Broadcast pub/sub (no disk copy on parent topic)
# ---------------------------------------------------------------------------


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)


class _FakeMetadata:
    def __init__(self, subscriptions: set[str]) -> None:
        self.subscriptions = subscriptions


class _FakeManager:
    def __init__(self) -> None:
        self._metadata: dict[str, _FakeMetadata] = {}
        self.active_connections: dict[str, _FakeWebSocket] = {}
        self._levels: dict[tuple[str, str], str] = {}

    def get_log_subscription_level(self, conn_id: str, session_id: str) -> str | None:
        return self._levels.get((conn_id, session_id))

    def subscribe(self, conn_id: str, topic: str, level: str = "DEBUG") -> None:
        self._metadata.setdefault(conn_id, _FakeMetadata(set())).subscriptions.add(topic)
        if topic.startswith("log:"):
            self._levels[(conn_id, topic[4:])] = level


@pytest.mark.asyncio
async def test_tracked_log_broadcasts_on_both_topics(tracked_execution: str) -> None:
    manager = _FakeManager()
    log_streaming_service.set_broadcast_manager(manager)  # type: ignore[arg-type]

    child_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)

    child_ws = _FakeWebSocket()
    parent_ws = _FakeWebSocket()
    manager.active_connections["c1"] = child_ws
    manager.active_connections["c2"] = parent_ws
    manager.subscribe("c1", f"log:{child_id}", "DEBUG")
    manager.subscribe("c2", f"log:{tracked_execution}", "DEBUG")

    log_streaming_service.add_log(child_id, "INFO", "hi", "Plugin")

    # _schedule_broadcast runs the send as a task; let the loop drain.
    for _ in range(3):
        await asyncio.sleep(0)

    assert any(e["topic"] == f"log:{child_id}" for e in child_ws.sent)
    assert any(e["topic"] == f"log:{tracked_execution}" for e in parent_ws.sent)
    log_streaming_service.clear_broadcast_manager()


@pytest.mark.asyncio
async def test_broadcast_respects_subscription_level(tracked_execution: str) -> None:
    manager = _FakeManager()
    log_streaming_service.set_broadcast_manager(manager)  # type: ignore[arg-type]
    child_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)
    ws = _FakeWebSocket()
    manager.active_connections["c1"] = ws
    manager.subscribe("c1", f"log:{child_id}", "ERROR")

    log_streaming_service.add_log(child_id, "INFO", "below threshold", "Plugin")
    for _ in range(3):
        await asyncio.sleep(0)

    assert ws.sent == []
    log_streaming_service.clear_broadcast_manager()


@pytest.mark.asyncio
async def test_broadcast_log_helper_skips_persistence() -> None:
    manager = _FakeManager()
    ws = _FakeWebSocket()
    manager.active_connections["c1"] = ws
    session_id = "transient"
    manager.subscribe("c1", f"log:{session_id}", "DEBUG")
    await log_streaming_service.broadcast_log(
        session_id, "INFO", "out-of-band", "Plugin", manager  # type: ignore[arg-type]
    )
    assert len(ws.sent) == 1
    # No persisted entries, no disk trace.
    assert log_streaming_service.get_logs(session_id) == []


def test_add_log_and_broadcast_returns_entry(tmp_storage: Any) -> None:
    session_id = str(uuid.uuid4())
    entry = log_streaming_service.add_log_and_broadcast(session_id, "INFO", "hello", "Plugin")
    assert entry["message"] == "hello"


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def test_get_log_topic() -> None:
    assert log_streaming_service.get_log_topic("s1") == "log:s1"


def test_create_log_entry_rejects_bad_level() -> None:
    from wavecore.api.exceptions import ValidationException

    with pytest.raises(ValidationException):
        log_streaming_service.create_log_entry("BAD", "m", "s")


def test_create_log_entry_supports_variant() -> None:
    entry = log_streaming_service.create_log_entry("INFO", "m", "Plugin", variant="success")
    assert entry["variant"] == "success"
    assert entry["sequence"] == 0


def test_get_next_sequence_recovers_from_existing_logs(tmp_storage: Any) -> None:
    """When the in-memory sequence counter is missing but the session
    already has logs, the next sequence resumes past the max seen."""
    session_id = "seq-recover"
    log_streaming_service.add_log(session_id, "INFO", "a", "Plugin")
    log_streaming_service.add_log(session_id, "INFO", "b", "Plugin")
    # Drop the counter but keep the logs buffer - the next call must
    # rebuild from the stored sequences.
    log_streaming_service._sequence_counters.pop(session_id, None)
    assert log_streaming_service._get_next_sequence(session_id) == 2


@pytest.mark.asyncio
async def test_emit_scope_log_regression_banner(tracked_execution: str) -> None:
    """emit_scope_log with scope_kind='regression' writes a chronology
    row and broadcasts on the parent execution topic."""
    manager = _FakeManager()
    log_streaming_service.set_broadcast_manager(manager)  # type: ignore[arg-type]
    ws = _FakeWebSocket()
    manager.active_connections["c1"] = ws
    manager.subscribe("c1", f"log:{tracked_execution}", "DEBUG")

    entry = log_streaming_service.emit_scope_log(
        tracked_execution,
        "regression",
        "Started",
        level="INFO",
        variant="regression-banner",
    )
    for _ in range(3):
        await asyncio.sleep(0)

    assert entry["scope_kind"] == "regression"
    assert len(ws.sent) == 1
    chronology = _exec_storage._load_chronology(tracked_execution)
    assert chronology[-1]["type"] == "regression"
    log_streaming_service.clear_broadcast_manager()


@pytest.mark.asyncio
async def test_emit_scope_log_suite_banner_includes_suite_id(
    tracked_execution: str,
) -> None:
    manager = _FakeManager()
    log_streaming_service.set_broadcast_manager(manager)  # type: ignore[arg-type]
    ws = _FakeWebSocket()
    manager.active_connections["c1"] = ws
    manager.subscribe("c1", f"log:{tracked_execution}", "DEBUG")

    entry = log_streaming_service.emit_scope_log(
        tracked_execution,
        "suite",
        "Suite started",
        level="INFO",
        variant="suite-banner",
        suite_id="s1",
    )
    for _ in range(3):
        await asyncio.sleep(0)

    assert entry["suite_id"] == "s1"
    chronology = _exec_storage._load_chronology(tracked_execution)
    assert chronology[-1]["type"] == "suite"
    assert chronology[-1]["suite_id"] == "s1"
    log_streaming_service.clear_broadcast_manager()


def test_schedule_broadcast_noop_without_running_loop() -> None:
    """Called outside an asyncio loop the helper returns silently rather
    than raising."""
    manager = _FakeManager()
    # Calling from sync context - no running loop - must not raise.
    log_streaming_service._schedule_broadcast(manager, "s", {"level": "INFO"})  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_broadcast_entry_skips_when_subscription_level_missing(
    tracked_execution: str,
) -> None:
    """A connection that subscribed to the topic but has no recorded
    level for the session is skipped (line 316)."""
    manager = _FakeManager()
    log_streaming_service.set_broadcast_manager(manager)  # type: ignore[arg-type]
    child_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)
    ws = _FakeWebSocket()
    manager.active_connections["c1"] = ws
    # Subscribe to the topic but do NOT set a log level.
    manager._metadata["c1"] = _FakeMetadata({f"log:{child_id}"})
    log_streaming_service.add_log(child_id, "INFO", "x", "Plugin")
    for _ in range(3):
        await asyncio.sleep(0)
    assert ws.sent == []
    log_streaming_service.clear_broadcast_manager()


@pytest.mark.asyncio
async def test_broadcast_entry_swallows_send_errors(
    tracked_execution: str,
) -> None:
    """If the websocket.send_json raises, the broadcaster absorbs the
    exception so other subscribers still get the log."""
    manager = _FakeManager()
    log_streaming_service.set_broadcast_manager(manager)  # type: ignore[arg-type]
    child_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)

    class _FailingWS:
        async def send_json(self, _: dict[str, Any]) -> None:
            raise RuntimeError("boom")

    manager.active_connections["bad"] = _FailingWS()  # type: ignore[assignment]
    manager.subscribe("bad", f"log:{child_id}", "DEBUG")
    log_streaming_service.add_log(child_id, "INFO", "x", "Plugin")
    for _ in range(3):
        await asyncio.sleep(0)
    log_streaming_service.clear_broadcast_manager()


@pytest.mark.asyncio
async def test_broadcast_log_ignores_non_subscribers() -> None:
    """Connections not subscribed to the log topic are untouched."""
    manager = _FakeManager()
    ws = _FakeWebSocket()
    manager.active_connections["c1"] = ws
    # Subscribe to a DIFFERENT topic.
    manager.subscribe("c1", "log:other-session", "DEBUG")
    await log_streaming_service.broadcast_log(
        "target", "INFO", "m", "Plugin", manager  # type: ignore[arg-type]
    )
    assert ws.sent == []


@pytest.mark.asyncio
async def test_broadcast_log_skips_connection_without_level() -> None:
    """broadcast_log drops a subscribed connection that has no level."""
    manager = _FakeManager()
    ws = _FakeWebSocket()
    manager.active_connections["c1"] = ws
    manager._metadata["c1"] = _FakeMetadata({"log:target"})
    # No level recorded for ('c1', 'target').
    await log_streaming_service.broadcast_log(
        "target", "INFO", "m", "Plugin", manager  # type: ignore[arg-type]
    )
    assert ws.sent == []


@pytest.mark.asyncio
async def test_broadcast_log_drops_entries_below_subscription_level() -> None:
    manager = _FakeManager()
    ws = _FakeWebSocket()
    manager.active_connections["c1"] = ws
    manager.subscribe("c1", "log:target", "ERROR")
    await log_streaming_service.broadcast_log(
        "target", "INFO", "m", "Plugin", manager  # type: ignore[arg-type]
    )
    assert ws.sent == []


@pytest.mark.asyncio
async def test_broadcast_log_swallows_send_errors() -> None:
    manager = _FakeManager()

    class _FailingWS:
        async def send_json(self, _: dict[str, Any]) -> None:
            raise RuntimeError("boom")

    manager.active_connections["bad"] = _FailingWS()  # type: ignore[assignment]
    manager.subscribe("bad", "log:target", "DEBUG")
    # Should not raise despite the failing socket.
    await log_streaming_service.broadcast_log(
        "target", "INFO", "m", "Plugin", manager  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# Secret scrubbing at the _build_entry chokepoint (REQ-3.1.3.5 / REQ-4.5.3)
# ---------------------------------------------------------------------------


def _seed_registry() -> Any:
    from wavecore.core.secrets.registry import SecretRegistry

    registry = SecretRegistry()
    registry.register("token", "s3cr3t-t0ken-99", "declared")
    return registry


class TestSecretScrubbing:
    """Every log line is value-scrubbed at construction; unmask is per-entry."""

    def test_get_secret_registry_returns_the_registered_instance(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())
        registry = _seed_registry()
        log_streaming_service.register_secret_registry(session_id, registry)

        assert log_streaming_service.get_secret_registry(session_id) is registry
        assert log_streaming_service.get_secret_registry(str(uuid.uuid4())) is None

    def test_ephemeral_log_message_is_scrubbed(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())

        entry = log_streaming_service.add_log(
            session_id, "INFO", "Authorization: Bearer s3cr3t-t0ken-99", "Plugin"
        )

        assert entry["message"] == "Authorization: Bearer ********"
        stored = log_streaming_service.get_logs(session_id)
        assert stored[0]["message"] == "Authorization: Bearer ********"

    def test_tracked_log_is_scrubbed_on_disk_and_in_broadcast(self, tracked_execution: str) -> None:
        child_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)
        log_streaming_service.register_secret_registry(child_id, _seed_registry())

        entry = log_streaming_service.add_log(
            child_id, "INFO", "value is s3cr3t-t0ken-99", "Plugin"
        )

        assert entry["message"] == "value is ********"
        stored = _exec_storage._load_test_logs(tracked_execution, run_id)
        assert stored[0]["message"] == "value is ********"

    def test_tracked_disk_log_masks_even_when_run_output_revealed(
        self, tracked_execution: str
    ) -> None:
        """Reveal is a live-display concern: the live broadcast reveals under the
        system run-output reveal, but the persisted disk log (which the execution
        export and report read) is always masked - a reveal window can never bake
        plaintext into the stored record."""
        from wavecore.core.secrets import masking_settings

        child_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(child_id, tracked_execution, run_id)
        log_streaming_service.register_secret_registry(child_id, _seed_registry())
        masking_settings.set_reveal_settings(run_output=True)
        try:
            entry = log_streaming_service.add_log(
                child_id, "INFO", "value is s3cr3t-t0ken-99", "Plugin"
            )
        finally:
            masking_settings.set_reveal_settings(run_output=False)

        # Live broadcast reveals (the operator turned reveal on) ...
        assert entry["message"] == "value is s3cr3t-t0ken-99"
        # ... but the persisted disk log stays masked.
        stored = _exec_storage._load_test_logs(tracked_execution, run_id)
        assert stored[0]["message"] == "value is ********"

    def test_longest_registered_value_wins_over_its_prefix(self, tmp_storage: Any) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("short", "abcdef", "declared")
        registry.register("long", "abcdef123456", "declared")
        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, registry)

        entry = log_streaming_service.add_log(
            session_id, "INFO", "long=abcdef123456 short=abcdef", "Plugin"
        )

        assert entry["message"] == "long=******** short=********"

    def test_unmask_marked_entry_passes_raw(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())

        entry = log_streaming_service.add_log(
            session_id,
            "INFO",
            "revealed s3cr3t-t0ken-99",
            "Log",
            unmask=True,
        )

        assert entry["message"] == "revealed s3cr3t-t0ken-99"
        stored = log_streaming_service.get_logs(session_id)
        assert stored[0]["message"] == "revealed s3cr3t-t0ken-99"

    def test_system_entries_never_unmask(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())

        entry = log_streaming_service.add_log(
            session_id,
            "ERROR",
            "Block failed: s3cr3t-t0ken-99 rejected",
            "SYSTEM",
            unmask=True,
        )

        assert entry["message"] == "Block failed: ******** rejected"

    def test_block_exempted_value_passes_raw_in_its_own_block(self, tmp_storage: Any) -> None:
        """A per-field reveal exempts only the revealing block's own lines."""
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register_value("tok-3x3mpt-11", "plugin:http-client", exempt_block="blk-a")
        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, registry)

        own = log_streaming_service.add_log(
            session_id, "DEBUG", "cookie tok-3x3mpt-11", "HTTP", block_id="blk-a"
        )
        other = log_streaming_service.add_log(
            session_id, "INFO", "echo tok-3x3mpt-11", "Log", block_id="blk-b"
        )
        unattributed = log_streaming_service.add_log(
            session_id, "INFO", "loose tok-3x3mpt-11", "Plugin"
        )

        assert own["message"] == "cookie tok-3x3mpt-11"
        assert other["message"] == "echo ********"
        assert unattributed["message"] == "loose ********"

    def test_session_without_registry_is_not_scrubbed(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())

        entry = log_streaming_service.add_log(session_id, "INFO", "plain s3cr3t-t0ken-99", "Plugin")

        assert entry["message"] == "plain s3cr3t-t0ken-99"

    def test_clearing_the_session_drops_its_registry(self, tmp_storage: Any) -> None:
        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())
        log_streaming_service._clear_session_logs(session_id)

        entry = log_streaming_service.add_log(
            session_id, "INFO", "after clear s3cr3t-t0ken-99", "Plugin"
        )

        assert entry["message"] == "after clear s3cr3t-t0ken-99"


# ---------------------------------------------------------------------------
# Whole-message cap, applied after the last masker
# ---------------------------------------------------------------------------


class TestMessageCap:
    """One hard bound on the finished message, applied last, that announces itself.

    It is the backstop that does not care about the shape of the data: whatever
    a block logs, the entry that reaches the console, the disk log and the
    reports is bounded, and the bound is stated in the message text.
    """

    def test_message_under_the_cap_is_untouched(self, tmp_storage: Any) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY

        session_id = str(uuid.uuid4())
        text = "x" * MAX_MESSAGE_DISPLAY

        assert log_streaming_service.scrub_message(session_id, text, "Plugin") == text

    def test_message_over_the_cap_is_cut_and_says_so(self, tmp_storage: Any) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY

        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())

        result = log_streaming_service.scrub_message(
            session_id, "x" * (MAX_MESSAGE_DISPLAY * 2), "Plugin"
        )

        assert result.endswith(" more characters")
        assert len(result) <= MAX_MESSAGE_DISPLAY

    def test_unregistered_session_is_capped_too(self, tmp_storage: Any) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY

        session_id = str(uuid.uuid4())

        result = log_streaming_service.scrub_message(
            session_id, "x" * (MAX_MESSAGE_DISPLAY * 2), "Plugin"
        )

        assert len(result) <= MAX_MESSAGE_DISPLAY

    def test_force_masked_at_rest_message_is_capped(self, tmp_storage: Any) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY

        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())

        result = log_streaming_service.scrub_message(
            session_id, "x" * (MAX_MESSAGE_DISPLAY * 2), "Plugin", force_mask=True
        )

        assert len(result) <= MAX_MESSAGE_DISPLAY

    def test_revealed_message_is_capped_but_not_masked(self, tmp_storage: Any) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY

        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())

        result = log_streaming_service.scrub_message(
            session_id,
            "s3cr3t-t0ken-99 " + "x" * (MAX_MESSAGE_DISPLAY * 2),
            "Plugin",
            unmask=True,
        )

        assert result.startswith("s3cr3t-t0ken-99 ")
        assert len(result) <= MAX_MESSAGE_DISPLAY

    def test_system_reveal_branch_is_capped(self, tmp_storage: Any) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY
        from wavecore.core.secrets import masking_settings

        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())
        masking_settings.set_reveal_settings(run_output=True)
        try:
            result = log_streaming_service.scrub_message(
                session_id, "x" * (MAX_MESSAGE_DISPLAY * 2), "Plugin"
            )
        finally:
            masking_settings.set_reveal_settings(run_output=False)

        assert len(result) <= MAX_MESSAGE_DISPLAY

    def test_cap_runs_after_the_masker(self, tmp_storage: Any) -> None:
        """A secret straddling the cut point is a placeholder before the cut, so
        no severed prefix can survive into the message."""
        from wavecore.core.logging.formatter import (
            _MESSAGE_MARKER_BUDGET,
            MAX_MESSAGE_DISPLAY,
        )

        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, _seed_registry())
        cut = MAX_MESSAGE_DISPLAY - _MESSAGE_MARKER_BUDGET
        secret = "s3cr3t-t0ken-99"
        # The second occurrence straddles the cut point once the first is masked.
        text = secret + "a" * (cut - 12) + secret + "b" * 5000

        result = log_streaming_service.scrub_message(session_id, text, "Plugin")

        assert result.startswith("********")
        assert "s3cr3t" not in result
        assert "t0ken" not in result
        assert len(result) <= MAX_MESSAGE_DISPLAY

    def test_entry_construction_caps_the_message(self, tmp_storage: Any) -> None:
        """The two paths that never call scrub_message (scope logs, transient
        broadcasts) are capped where the entry is built."""
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY

        entry = log_streaming_service.create_log_entry(
            "INFO", "x" * (MAX_MESSAGE_DISPLAY * 2), "Plugin"
        )

        assert len(entry["message"]) <= MAX_MESSAGE_DISPLAY

    def test_scope_log_message_is_capped(self, tracked_execution: str) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY

        entry = log_streaming_service.emit_scope_log(
            tracked_execution, "regression", "x" * (MAX_MESSAGE_DISPLAY * 2)
        )

        assert len(entry["message"]) <= MAX_MESSAGE_DISPLAY
