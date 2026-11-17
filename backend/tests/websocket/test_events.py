"""Fire-and-forget topic broadcasts (wavecore.api.websocket.events)."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock

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

    @pytest.mark.parametrize(
        ("topic", "logged_topic"),
        [
            (TOPIC, TOPIC),
            ("testdata:abc\nWARN forged", "base64:dGVzdGRhdGE6YWJjCldBUk4gZm9yZ2Vk"),
        ],
    )
    async def test_a_failed_send_logs_the_topic_on_one_line(
        self, caplog: pytest.LogCaptureFixture, topic: str, logged_topic: str
    ) -> None:
        """REQ-6.4.1: a plain topic is logged as it is; one with a line break as Base64."""
        from wavecore.api.app import app

        manager = AsyncMock()
        manager.broadcast_to_topic.side_effect = RuntimeError("socket gone")
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            with caplog.at_level(logging.WARNING, logger=events.__name__):
                await events.broadcast(topic, EVENT)
        finally:
            app.state.ws_manager = original

        assert [
            record.getMessage() for record in caplog.records if record.name == events.__name__
        ] == [f"Failed to broadcast {logged_topic} event: socket gone"]


class TestSettle:
    """A caller waits until what it scheduled has gone out before it sends more."""

    async def test_waits_until_every_scheduled_broadcast_has_gone_out(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sent: list[str] = []

        async def send(topic: str, event: dict[str, str]) -> None:
            await asyncio.sleep(0)
            sent.append(event["event"])

        monkeypatch.setattr(events, "broadcast", send)
        events.emit(TOPIC, {"event": "first"})
        events.emit(TOPIC, {"event": "second"})

        await events.settle()

        assert sent == ["first", "second"]
        assert events._emit_tasks == set()

    async def test_leaves_a_broadcast_scheduled_on_another_loop_alone(self) -> None:
        foreign = MagicMock()
        foreign.get_loop.return_value = object()
        events._emit_tasks.add(foreign)

        await events.settle()

        assert events._emit_tasks == {foreign}
