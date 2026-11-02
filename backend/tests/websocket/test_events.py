"""Fire-and-forget topic broadcasts (wavecore.api.websocket.events)."""

from unittest.mock import AsyncMock

import pytest

from wavecore.api.websocket import events

TOPIC = "testdata:abc"
EVENT = {"event": "uploads_changed", "uploads": []}


@pytest.fixture(autouse=True)
def _drop_leftover_tasks() -> None:
    events._emit_tasks.clear()


async def _drain() -> None:
    for task in list(events._emit_tasks):
        await task


class TestEmit:
    """The envelope a scheduled broadcast puts on the wire."""

    async def test_the_envelope_carries_the_topic_and_the_event(self) -> None:
        from wavecore.api.app import app

        manager = AsyncMock()
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            events.emit(TOPIC, EVENT)
            await _drain()
        finally:
            app.state.ws_manager = original

        manager.broadcast_to_topic.assert_awaited_once()
        topic, envelope = manager.broadcast_to_topic.await_args.args
        assert topic == TOPIC
        assert envelope["type"] == "event"
        assert envelope["topic"] == TOPIC
        assert envelope["payload"] == EVENT
        assert isinstance(envelope["timestamp"], int)

    def test_a_caller_with_no_running_loop_emits_nothing(self) -> None:
        events.emit(TOPIC, EVENT)

        assert events._emit_tasks == set()

    async def test_the_task_is_dropped_once_it_has_run(self) -> None:
        from wavecore.api.app import app

        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = None
        try:
            events.emit(TOPIC, EVENT)
            await _drain()
        finally:
            app.state.ws_manager = original

        assert events._emit_tasks == set()


class TestBroadcast:
    """A send that cannot happen leaves the caller alone."""

    async def test_no_manager_sends_nothing(self) -> None:
        from wavecore.api.app import app

        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = None
        try:
            await events.broadcast(TOPIC, EVENT)
        finally:
            app.state.ws_manager = original

    async def test_a_failed_send_is_swallowed(self) -> None:
        from wavecore.api.app import app

        manager = AsyncMock()
        manager.broadcast_to_topic.side_effect = RuntimeError("socket gone")
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            await events.broadcast(TOPIC, EVENT)
        finally:
            app.state.ws_manager = original

        manager.broadcast_to_topic.assert_awaited_once()
