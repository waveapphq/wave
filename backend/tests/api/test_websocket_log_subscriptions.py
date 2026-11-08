"""Unit tests for the WebSocket manager's log-subscription and
history-pagination paths.

Covers the V-CANVAS-01d feature surface on ``WebSocketManager``:
- ``_parse_composite_cursor`` / ``_format_composite_cursor`` helpers
- ``subscribe_logs`` (tracked + ephemeral + validation + send-failure)
- ``change_log_level`` (ack + historical fill on level-loosening)
- ``get_log_subscription_level``
- ``unsubscribe`` log topic cleanup
- ``_handle_request_history`` + tracked/ephemeral pagination helpers
"""

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocket

from wavecore.api.exceptions import ValidationException
from wavecore.api.services import log_streaming_service, storage_paths
from wavecore.api.services.executions import _storage as _exec_storage
from wavecore.api.websocket import WebSocketManager
from wavecore.api.websocket.manager import (
    _format_composite_cursor,
    _parse_composite_cursor,
)


def _fresh_ws() -> AsyncMock:
    """Create a WebSocket-shaped mock that also evaluates to truthy.

    ``AsyncMock(spec=WebSocket)`` picks up WebSocket.__len__ which defaults
    to 0 under MagicMock, making ``if websocket:`` resolve to ``False``.
    Forcing ``__len__`` to non-zero keeps the production ``if websocket:``
    guard meaningful in tests.
    """
    ws = AsyncMock(spec=WebSocket)
    ws.accept = AsyncMock()
    ws.__len__ = MagicMock(return_value=1)
    return ws


@pytest.fixture
def tmp_storage(tmp_path: Any) -> Any:
    storage_paths.set_base_path(Path(tmp_path))
    _exec_storage._clear_storage()
    log_streaming_service._clear_cache()
    yield tmp_path
    log_streaming_service._clear_cache()
    _exec_storage._clear_storage()


# ---------------------------------------------------------------------------
# Composite cursor helpers
# ---------------------------------------------------------------------------


def test_parse_composite_cursor_rejects_non_strings_and_malformed() -> None:
    assert _parse_composite_cursor(None) is None
    assert _parse_composite_cursor(123) is None
    assert _parse_composite_cursor("no-colon") is None
    assert _parse_composite_cursor("not-an-int:x") is None
    assert _parse_composite_cursor("1:notanint") is None


def test_parse_composite_cursor_handles_x_sentinel_and_int_child() -> None:
    assert _parse_composite_cursor("3:x") == (3, None)
    assert _parse_composite_cursor("3:7") == (3, 7)


def test_format_composite_cursor_round_trips_x_sentinel() -> None:
    assert _format_composite_cursor(None) is None
    assert _format_composite_cursor((4, None)) == "4:x"
    assert _format_composite_cursor((4, 9)) == "4:9"


# ---------------------------------------------------------------------------
# get_log_subscription_level
# ---------------------------------------------------------------------------


def test_get_log_subscription_level_returns_none_for_unknown_connection() -> None:
    manager = WebSocketManager()
    assert manager.get_log_subscription_level("ghost", "session") is None


@pytest.mark.asyncio
async def test_get_log_subscription_level_returns_level_after_subscribe(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    await manager.subscribe_logs(conn_id, "session-x", level="WARN")

    assert manager.get_log_subscription_level(conn_id, "session-x") == "WARN"


# ---------------------------------------------------------------------------
# subscribe_logs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subscribe_logs_raises_for_unknown_connection() -> None:
    from wavecore.api.websocket import ConnectionNotFound

    manager = WebSocketManager()
    with pytest.raises(ConnectionNotFound):
        await manager.subscribe_logs("ghost", "s1", level="INFO")


@pytest.mark.asyncio
async def test_subscribe_logs_rejects_invalid_level(tmp_storage: Any) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    with pytest.raises(ValidationException):
        await manager.subscribe_logs(conn_id, "s1", level="NOT_A_LEVEL")


@pytest.mark.asyncio
async def test_subscribe_logs_ephemeral_session_pushes_history(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    session_id = "ephemeral-session"
    log_streaming_service.add_log(session_id, "INFO", "alpha", "Plugin")
    log_streaming_service.add_log(session_id, "INFO", "beta", "Plugin")

    await manager.subscribe_logs(conn_id, session_id, level="DEBUG")

    # ws.send_json was invoked with the history event.
    calls = ws.send_json.call_args_list
    history_calls = [c for c in calls if c.args and c.args[0].get("topic") == f"log:{session_id}"]
    assert history_calls
    payload = history_calls[-1].args[0]["payload"]
    assert [e["message"] for e in payload["entries"]] == ["alpha", "beta"]


@pytest.mark.asyncio
async def test_subscribe_logs_tracked_execution_pushes_history(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    # Seed a tracked execution with a test reference + per-run log file.
    exec_id = "exec-tracked"
    _exec_storage._execution_storage[exec_id] = {
        "id": exec_id,
        "entity_type": "suite",
        "status": "running",
    }
    _exec_storage._save_execution(_exec_storage._execution_storage[exec_id])
    _exec_storage._append_chronology(exec_id, {"type": "test", "run_id": "rA"})
    _exec_storage._append_log(
        exec_id, "rA", {"level": "INFO", "message": "child-1", "source": "Plugin"}
    )

    await manager.subscribe_logs(conn_id, exec_id, level="DEBUG")

    history_calls = [
        c
        for c in ws.send_json.call_args_list
        if c.args and c.args[0].get("topic") == f"log:{exec_id}"
    ]
    assert history_calls
    payload = history_calls[-1].args[0]["payload"]
    assert payload["entries"]
    assert payload["entries"][-1]["message"] == "child-1"


@pytest.mark.asyncio
async def test_subscribe_logs_handles_send_failure_on_history(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    ws.send_json = AsyncMock(side_effect=RuntimeError("boom"))
    conn_id = await manager.connect(ws)

    session_id = "send-fail-session"
    log_streaming_service.add_log(session_id, "INFO", "a", "Plugin")

    # Should absorb the send failure rather than propagate; subscription
    # state is still recorded (level, session manager).
    await manager.subscribe_logs(conn_id, session_id, level="DEBUG")
    assert manager.get_log_subscription_level(conn_id, session_id) == "DEBUG"


@pytest.mark.asyncio
async def test_subscribe_logs_noop_when_websocket_missing(
    tmp_storage: Any,
) -> None:
    """If the connection was torn down after register_session_manager but
    before the history push, subscribe_logs records the state and
    returns silently without attempting a send."""
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    # Drop the active websocket mapping to simulate a teardown race.
    manager.active_connections.pop(conn_id, None)

    await manager.subscribe_logs(conn_id, "unknown", level="INFO")
    assert manager.get_log_subscription_level(conn_id, "unknown") == "INFO"


# ---------------------------------------------------------------------------
# change_log_level
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_log_level_rejects_invalid_level(tmp_storage: Any) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    await manager.subscribe_logs(conn_id, "s", level="INFO")
    with pytest.raises(ValidationException):
        await manager.change_log_level(conn_id, "s", "NOPE")


@pytest.mark.asyncio
async def test_change_log_level_rejects_unsubscribed_topic(tmp_storage: Any) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    with pytest.raises(ValidationException):
        await manager.change_log_level(conn_id, "never-subscribed", "INFO")


@pytest.mark.asyncio
async def test_change_log_level_rejects_when_level_tracking_missing(
    tmp_storage: Any,
) -> None:
    """Defensive guard: subscription set contains the topic but the
    per-session level map was torn down out of band."""
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    await manager.subscribe_logs(conn_id, "s1", level="INFO")
    # Remove level tracking while keeping the subscription entry.
    manager._log_subscription_levels[conn_id].pop("s1", None)
    with pytest.raises(ValidationException):
        await manager.change_log_level(conn_id, "s1", "ERROR")


@pytest.mark.asyncio
async def test_change_log_level_sends_ack_and_historical_when_loosening(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    session_id = "ephemeral-change"
    log_streaming_service.add_log(session_id, "DEBUG", "d1", "Plugin")
    log_streaming_service.add_log(session_id, "INFO", "i1", "Plugin")
    log_streaming_service.add_log(session_id, "ERROR", "e1", "Plugin")

    await manager.subscribe_logs(conn_id, session_id, level="INFO")

    ws.send_json.reset_mock()
    result = await manager.change_log_level(conn_id, session_id, "DEBUG")
    assert result == {"status": "acknowledged", "new_level": "DEBUG"}

    kinds = [c.args[0].get("type") for c in ws.send_json.call_args_list]
    assert "level_change_ack" in kinds
    assert "historical_logs" in kinds
    # Historical payload contains the DEBUG-only entries that were previously hidden.
    history_payload = next(
        c.args[0] for c in ws.send_json.call_args_list if c.args[0].get("type") == "historical_logs"
    )
    messages = [log["message"] for log in history_payload["payload"]["logs"]]
    assert messages == ["d1"]


@pytest.mark.asyncio
async def test_change_log_level_tightening_does_not_send_historical(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    session_id = "tighten-session"
    log_streaming_service.add_log(session_id, "DEBUG", "d1", "Plugin")
    await manager.subscribe_logs(conn_id, session_id, level="DEBUG")

    ws.send_json.reset_mock()
    await manager.change_log_level(conn_id, session_id, "ERROR")
    # Only the ack should be sent; no historical_logs follow-up.
    kinds = [c.args[0].get("type") for c in ws.send_json.call_args_list]
    assert "level_change_ack" in kinds
    assert "historical_logs" not in kinds


# ---------------------------------------------------------------------------
# unsubscribe log-topic cleanup
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unsubscribe_log_topic_drops_level_tracking_and_manager(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    await manager.subscribe_logs(conn_id, "s-unsub", level="INFO")
    assert manager.get_log_subscription_level(conn_id, "s-unsub") == "INFO"
    assert log_streaming_service._session_managers.get("s-unsub") is manager

    assert manager.unsubscribe(conn_id, "log:s-unsub") is True
    assert manager.get_log_subscription_level(conn_id, "s-unsub") is None
    # No other subscribers remain, so the session manager is unregistered.
    assert "s-unsub" not in log_streaming_service._session_managers


@pytest.mark.asyncio
async def test_unsubscribe_log_topic_retains_session_manager_when_other_subs_present(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws_a = _fresh_ws()
    conn_a = await manager.connect(ws_a)
    ws_b = _fresh_ws()
    conn_b = await manager.connect(ws_b)

    await manager.subscribe_logs(conn_a, "s-shared", level="INFO")
    await manager.subscribe_logs(conn_b, "s-shared", level="INFO")

    assert manager.unsubscribe(conn_a, "log:s-shared") is True
    # One subscriber still holds the topic, so the manager stays registered.
    assert log_streaming_service._session_managers.get("s-shared") is manager


# ---------------------------------------------------------------------------
# _handle_request_history
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_request_history_via_handle_message_tracked(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    exec_id = "exec-hist"
    _exec_storage._execution_storage[exec_id] = {
        "id": exec_id,
        "entity_type": "suite",
        "status": "running",
    }
    _exec_storage._save_execution(_exec_storage._execution_storage[exec_id])
    _exec_storage._append_chronology(exec_id, {"type": "test", "run_id": "rA"})
    for i in range(3):
        _exec_storage._append_log(
            exec_id, "rA", {"level": "INFO", "message": f"m-{i}", "source": "Plugin"}
        )

    await manager.subscribe_logs(conn_id, exec_id, level="DEBUG")
    ws.send_json.reset_mock()

    await manager.handle_message(
        conn_id,
        json.dumps({"type": "request_history", "topic": f"log:{exec_id}", "pageSize": 10}),
    )
    history_events = [
        c.args[0]
        for c in ws.send_json.call_args_list
        if c.args and c.args[0].get("type") == "event"
    ]
    assert history_events
    payload = history_events[-1]["payload"]
    assert [e["message"] for e in payload["entries"]] == ["m-0", "m-1", "m-2"]


@pytest.mark.asyncio
async def test_handle_request_history_for_ephemeral_session_returns_page(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    session_id = "ephemeral-hist"
    for i in range(5):
        log_streaming_service.add_log(session_id, "INFO", f"m-{i}", "Plugin")

    await manager.subscribe_logs(conn_id, session_id, level="DEBUG")
    ws.send_json.reset_mock()

    await manager.handle_message(
        conn_id,
        json.dumps(
            {
                "type": "request_history",
                "topic": f"log:{session_id}",
                "pageSize": 3,
            }
        ),
    )
    history_payload = next(
        c.args[0] for c in ws.send_json.call_args_list if c.args[0].get("type") == "event"
    )["payload"]
    assert len(history_payload["entries"]) == 3
    assert history_payload["hasMore"] is True
    assert history_payload["cursor"] is not None


@pytest.mark.asyncio
async def test_handle_request_history_respects_integer_cursor_on_ephemeral(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    session_id = "cursor-session"
    for i in range(4):
        log_streaming_service.add_log(session_id, "INFO", f"m-{i}", "Plugin")

    await manager.subscribe_logs(conn_id, session_id, level="DEBUG")
    ws.send_json.reset_mock()

    await manager.handle_message(
        conn_id,
        json.dumps(
            {
                "type": "request_history",
                "topic": f"log:{session_id}",
                "cursor": 2,  # Request entries older than sequence=2.
                "pageSize": 10,
            }
        ),
    )
    payload = next(
        c.args[0] for c in ws.send_json.call_args_list if c.args[0].get("type") == "event"
    )["payload"]
    assert [e["message"] for e in payload["entries"]] == ["m-0", "m-1"]
    assert payload["hasMore"] is False


@pytest.mark.asyncio
async def test_handle_request_history_ignores_non_log_topics(tmp_storage: Any) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    ws.send_json.reset_mock()
    # Non log topic -> early return, no event emitted.
    await manager.handle_message(
        conn_id,
        json.dumps({"type": "request_history", "topic": "execution:x"}),
    )
    # No event frame emitted.
    events = [c.args[0] for c in ws.send_json.call_args_list if c.args[0].get("type") == "event"]
    assert events == []


@pytest.mark.asyncio
async def test_handle_request_history_ignores_unsubscribed_session(
    tmp_storage: Any,
) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    ws.send_json.reset_mock()
    # Not subscribed to this topic yet -> no level -> early return.
    await manager.handle_message(
        conn_id,
        json.dumps({"type": "request_history", "topic": "log:nobody"}),
    )
    events = [c.args[0] for c in ws.send_json.call_args_list if c.args[0].get("type") == "event"]
    assert events == []


@pytest.mark.asyncio
async def test_handle_request_history_swallows_send_errors(tmp_storage: Any) -> None:
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    session_id = "send-fail-hist"
    log_streaming_service.add_log(session_id, "INFO", "a", "Plugin")
    await manager.subscribe_logs(conn_id, session_id, level="DEBUG")

    ws.send_json = AsyncMock(side_effect=RuntimeError("boom"))
    # Must not raise even though send_json errors.
    await manager.handle_message(
        conn_id,
        json.dumps({"type": "request_history", "topic": f"log:{session_id}"}),
    )


@pytest.mark.asyncio
async def test_subscribe_logs_tracked_execution_swallows_send_errors(
    tmp_storage: Any,
) -> None:
    """Tracked-execution history push absorbs websocket send failures so
    the subscription still succeeds (covers lines 865-866)."""
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    ws.send_json = AsyncMock(side_effect=RuntimeError("boom"))

    exec_id = "exec-track-send-fail"
    _exec_storage._execution_storage[exec_id] = {
        "id": exec_id,
        "entity_type": "suite",
        "status": "running",
    }
    _exec_storage._save_execution(_exec_storage._execution_storage[exec_id])
    _exec_storage._append_chronology(exec_id, {"type": "test", "run_id": "rA"})
    _exec_storage._append_log(
        exec_id, "rA", {"level": "INFO", "message": "hello", "source": "Plugin"}
    )

    # Send failures on the tracked-execution history push are swallowed;
    # the subscription itself still registers.
    await manager.subscribe_logs(conn_id, exec_id, level="DEBUG")
    assert manager.get_log_subscription_level(conn_id, exec_id) == "DEBUG"


@pytest.mark.asyncio
async def test_handle_subscribe_routes_log_topics_to_subscribe_logs(
    tmp_storage: Any,
) -> None:
    """A ``subscribe`` message with a ``log:`` topic routes through
    subscribe_logs (covers the log-topic branch in _handle_subscribe,
    lines 1260-1262) and sends the subscription confirmation."""
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    ws.send_json.reset_mock()

    await manager.handle_message(
        conn_id,
        json.dumps({"type": "subscribe", "topic": "log:session-123", "level": "WARN"}),
    )

    # Subscription was recorded and a "subscribed" confirmation was sent.
    assert manager.get_log_subscription_level(conn_id, "session-123") == "WARN"
    topics_sent = [
        c.args[0].get("topic")
        for c in ws.send_json.call_args_list
        if c.args and c.args[0].get("type") == "subscribed"
    ]
    assert "log:session-123" in topics_sent


@pytest.mark.asyncio
async def test_handle_subscribe_routes_log_topic_without_explicit_level(
    tmp_storage: Any,
) -> None:
    """subscribe without a ``level`` field defaults to DEBUG so the
    server-side default branch is exercised."""
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)
    await manager.handle_message(
        conn_id,
        json.dumps({"type": "subscribe", "topic": "log:session-nolevel"}),
    )
    assert manager.get_log_subscription_level(conn_id, "session-nolevel") == "DEBUG"


@pytest.mark.asyncio
async def test_subscribe_logs_tracked_execution_skips_send_when_all_filtered_out(
    tmp_storage: Any,
) -> None:
    """A tracked execution whose only logs are below the requested level
    yields an empty filtered page - the helper must early-return before
    emitting any history event."""
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    exec_id = "exec-filtered-empty"
    _exec_storage._execution_storage[exec_id] = {
        "id": exec_id,
        "entity_type": "suite",
        "status": "running",
    }
    _exec_storage._save_execution(_exec_storage._execution_storage[exec_id])
    _exec_storage._append_chronology(exec_id, {"type": "test", "run_id": "rA"})
    _exec_storage._append_log(
        exec_id, "rA", {"level": "INFO", "message": "low", "source": "Plugin"}
    )

    ws.send_json.reset_mock()
    await manager.subscribe_logs(conn_id, exec_id, level="ERROR")

    # No history event emitted because every persisted log is below ERROR.
    events = [
        c.args[0]
        for c in ws.send_json.call_args_list
        if c.args and c.args[0].get("type") == "event"
    ]
    assert events == []


@pytest.mark.asyncio
async def test_subscribe_logs_ephemeral_skips_send_when_all_filtered_out(
    tmp_storage: Any,
) -> None:
    """Same filtering short-circuit applies to ephemeral sessions: every
    log below the requested level -> no history event is pushed."""
    manager = WebSocketManager()
    ws = _fresh_ws()
    conn_id = await manager.connect(ws)

    session_id = "ephemeral-filtered-empty"
    log_streaming_service.add_log(session_id, "DEBUG", "d", "Plugin")
    log_streaming_service.add_log(session_id, "INFO", "i", "Plugin")

    ws.send_json.reset_mock()
    await manager.subscribe_logs(conn_id, session_id, level="ERROR")

    events = [
        c.args[0]
        for c in ws.send_json.call_args_list
        if c.args and c.args[0].get("type") == "event"
    ]
    assert events == []
