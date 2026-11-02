"""Console lines reach every subscriber in log order.

The log broadcast schedules one asyncio task per line, so a subscriber that is
slow on one send lets later lines overtake it and the console renders out of
order. Watched runs multiply the concurrent sends and parity checks
compare row order across surfaces, so the fan-out becomes a per-session ordered
queue drained by a single consumer task. Level filtering, secret scrubbing, and
the topic split are unchanged.
"""

import asyncio
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.services import log_streaming_service
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.core.secrets.registry import SecretRegistry

SECRET_VALUE = "s3cr3t-t0ken-99"


class _RecordingWebSocket:
    """Records what it received, optionally stalling on its first send."""

    def __init__(self, first_send_delay: float = 0.0) -> None:
        self.sent: list[dict[str, Any]] = []
        self._first_send_delay = first_send_delay
        self._sends = 0

    async def send_json(self, payload: dict[str, Any]) -> None:
        self._sends += 1
        if self._sends == 1 and self._first_send_delay:
            await asyncio.sleep(self._first_send_delay)
        self.sent.append(payload)

    @property
    def messages(self) -> list[str]:
        return [entry["payload"]["message"] for entry in self.sent]


class _FakeMetadata:
    def __init__(self, subscriptions: set[str]) -> None:
        self.subscriptions = subscriptions


class _FakeManager:
    def __init__(self) -> None:
        self._metadata: dict[str, _FakeMetadata] = {}
        self.active_connections: dict[str, _RecordingWebSocket] = {}
        self._levels: dict[tuple[str, str], str] = {}

    def get_log_subscription_level(self, conn_id: str, session_id: str) -> str | None:
        return self._levels.get((conn_id, session_id))

    def attach(
        self, conn_id: str, session_id: str, websocket: _RecordingWebSocket, level: str = "DEBUG"
    ) -> None:
        self.active_connections[conn_id] = websocket
        self._metadata.setdefault(conn_id, _FakeMetadata(set())).subscriptions.add(
            f"log:{session_id}"
        )
        self._levels[(conn_id, session_id)] = level


async def _wait_for(websocket: _RecordingWebSocket, count: int, timeout: float = 2.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while len(websocket.sent) < count and loop.time() < deadline:
        await asyncio.sleep(0.005)


async def _settle(seconds: float = 0.05) -> None:
    await asyncio.sleep(seconds)


@pytest.fixture(autouse=True)
def _clean_log_state() -> Generator[None, None, None]:
    log_streaming_service._session_logs.clear()
    log_streaming_service._clear_cache()
    log_streaming_service.clear_broadcast_manager()
    yield
    log_streaming_service._session_logs.clear()
    log_streaming_service._clear_cache()
    log_streaming_service.clear_broadcast_manager()


@pytest.fixture
def manager() -> Generator[_FakeManager, None, None]:
    fake = _FakeManager()
    log_streaming_service.set_broadcast_manager(fake)  # type: ignore[arg-type]
    yield fake
    log_streaming_service.clear_broadcast_manager()


def _tracked_execution() -> str:
    execution_id = str(uuid.uuid4())
    exec_storage._execution_storage[execution_id] = {
        "id": execution_id,
        "entity_type": "test",
        "entity_id": str(uuid.uuid4()),
        "status": "running",
    }
    exec_storage._save_execution(exec_storage._execution_storage[execution_id])
    return execution_id


class TestOrderedFanOut:
    """Every subscriber sees the lines in the order the run produced them."""

    async def test_a_slow_first_send_does_not_let_later_lines_overtake(
        self, manager: _FakeManager
    ) -> None:
        session_id = str(uuid.uuid4())
        websocket = _RecordingWebSocket(first_send_delay=0.05)
        manager.attach("c1", session_id, websocket)

        for index in range(10):
            log_streaming_service.add_log(session_id, "INFO", f"line-{index}", "Plugin")
        await _wait_for(websocket, 10)

        assert websocket.messages == [f"line-{index}" for index in range(10)]

    async def test_every_subscriber_sees_the_same_order(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        slow = _RecordingWebSocket(first_send_delay=0.05)
        fast = _RecordingWebSocket()
        manager.attach("c1", session_id, slow)
        manager.attach("c2", session_id, fast)

        for index in range(6):
            log_streaming_service.add_log(session_id, "INFO", f"line-{index}", "Plugin")
        await _wait_for(slow, 6)
        await _wait_for(fast, 6)

        expected = [f"line-{index}" for index in range(6)]
        assert slow.messages == expected
        assert fast.messages == expected

    async def test_sequence_numbers_arrive_monotonically(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        websocket = _RecordingWebSocket(first_send_delay=0.05)
        manager.attach("c1", session_id, websocket)

        for index in range(8):
            log_streaming_service.add_log(session_id, "INFO", f"line-{index}", "Plugin")
        await _wait_for(websocket, 8)

        sequences = [entry["payload"]["sequence"] for entry in websocket.sent]
        assert sequences == sorted(sequences)

    async def test_the_tracked_parent_topic_is_ordered_too(self, manager: _FakeManager) -> None:
        execution_id = _tracked_execution()
        child_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(child_id, execution_id, execution_id)
        parent = _RecordingWebSocket(first_send_delay=0.05)
        manager.attach("c1", execution_id, parent)

        for index in range(6):
            log_streaming_service.add_log(child_id, "INFO", f"line-{index}", "Plugin")
        await _wait_for(parent, 6)

        assert parent.messages == [f"line-{index}" for index in range(6)]

    async def test_a_slow_session_does_not_stall_another_session(
        self, manager: _FakeManager
    ) -> None:
        slow_session = str(uuid.uuid4())
        fast_session = str(uuid.uuid4())
        slow = _RecordingWebSocket(first_send_delay=0.5)
        fast = _RecordingWebSocket()
        manager.attach("c1", slow_session, slow)
        manager.attach("c2", fast_session, fast)

        log_streaming_service.add_log(slow_session, "INFO", "slow-line", "Plugin")
        log_streaming_service.add_log(fast_session, "INFO", "fast-line", "Plugin")
        await _wait_for(fast, 1)

        assert fast.messages == ["fast-line"]
        assert slow.sent == []


class TestFilteringIsUnchanged:
    """The per-connection level gate and topic split still hold."""

    async def test_entries_below_the_subscription_level_are_dropped(
        self, manager: _FakeManager
    ) -> None:
        session_id = str(uuid.uuid4())
        websocket = _RecordingWebSocket()
        manager.attach("c1", session_id, websocket, level="ERROR")

        log_streaming_service.add_log(session_id, "INFO", "quiet", "Plugin")
        log_streaming_service.add_log(session_id, "ERROR", "loud", "Plugin")
        await _wait_for(websocket, 1)
        await _settle()

        assert websocket.messages == ["loud"]

    async def test_each_connection_applies_its_own_level(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        verbose = _RecordingWebSocket()
        terse = _RecordingWebSocket()
        manager.attach("c1", session_id, verbose, level="DEBUG")
        manager.attach("c2", session_id, terse, level="ERROR")

        log_streaming_service.add_log(session_id, "INFO", "quiet", "Plugin")
        log_streaming_service.add_log(session_id, "ERROR", "loud", "Plugin")
        await _wait_for(verbose, 2)
        await _wait_for(terse, 1)
        await _settle()

        assert verbose.messages == ["quiet", "loud"]
        assert terse.messages == ["loud"]

    async def test_a_connection_without_a_subscription_level_receives_nothing(
        self, manager: _FakeManager
    ) -> None:
        session_id = str(uuid.uuid4())
        websocket = _RecordingWebSocket()
        manager.active_connections["c1"] = websocket
        manager._metadata["c1"] = _FakeMetadata({f"log:{session_id}"})

        log_streaming_service.add_log(session_id, "ERROR", "loud", "Plugin")
        await _settle()

        assert websocket.sent == []

    async def test_other_sessions_topics_are_not_crossed(self, manager: _FakeManager) -> None:
        session_a = str(uuid.uuid4())
        session_b = str(uuid.uuid4())
        websocket_a = _RecordingWebSocket()
        websocket_b = _RecordingWebSocket()
        manager.attach("c1", session_a, websocket_a)
        manager.attach("c2", session_b, websocket_b)

        log_streaming_service.add_log(session_a, "INFO", "for-a", "Plugin")
        await _wait_for(websocket_a, 1)
        await _settle()

        assert websocket_a.messages == ["for-a"]
        assert websocket_b.sent == []


class TestScrubbingIsUnchanged:
    """The broadcast still carries the live form; disk still carries the masked one."""

    @staticmethod
    def _registry() -> SecretRegistry:
        registry = SecretRegistry()
        registry.register("token", SECRET_VALUE, "declared")
        return registry

    async def test_the_broadcast_message_is_scrubbed(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, self._registry())
        websocket = _RecordingWebSocket()
        manager.attach("c1", session_id, websocket)

        log_streaming_service.add_log(session_id, "INFO", f"token={SECRET_VALUE}", "Plugin")
        await _wait_for(websocket, 1)

        assert websocket.messages == ["token=********"]

    async def test_an_unmasked_entry_broadcasts_raw(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        log_streaming_service.register_secret_registry(session_id, self._registry())
        websocket = _RecordingWebSocket()
        manager.attach("c1", session_id, websocket)

        log_streaming_service.add_log(
            session_id, "INFO", f"token={SECRET_VALUE}", "Log", unmask=True
        )
        await _wait_for(websocket, 1)

        assert websocket.messages == [f"token={SECRET_VALUE}"]

    async def test_the_live_reveal_never_reaches_the_stored_record(
        self, manager: _FakeManager
    ) -> None:
        from wavecore.core.secrets import masking_settings

        execution_id = _tracked_execution()
        child_id = str(uuid.uuid4())
        log_streaming_service.register_log_sink(child_id, execution_id, execution_id)
        log_streaming_service.register_secret_registry(child_id, self._registry())
        websocket = _RecordingWebSocket()
        manager.attach("c1", child_id, websocket)

        masking_settings.set_reveal_settings(run_output=True)
        try:
            log_streaming_service.add_log(child_id, "INFO", f"token={SECRET_VALUE}", "Plugin")
            await _wait_for(websocket, 1)
        finally:
            masking_settings.set_reveal_settings(run_output=False)

        assert websocket.messages == [f"token={SECRET_VALUE}"]
        stored = exec_storage._load_test_logs(execution_id, execution_id)
        assert stored[0]["message"] == "token=********"


class TestDrainerLifecycle:
    """One consumer task per session, created on demand and torn down with it."""

    async def test_no_drainer_before_the_first_line(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        manager.attach("c1", session_id, _RecordingWebSocket())

        assert session_id not in log_streaming_service._session_drainers

    async def test_the_first_line_creates_the_drainer(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        websocket = _RecordingWebSocket()
        manager.attach("c1", session_id, websocket)

        log_streaming_service.add_log(session_id, "INFO", "first", "Plugin")
        await _wait_for(websocket, 1)

        assert session_id in log_streaming_service._session_drainers

    async def test_later_lines_reuse_the_same_drainer(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        websocket = _RecordingWebSocket()
        manager.attach("c1", session_id, websocket)

        log_streaming_service.add_log(session_id, "INFO", "first", "Plugin")
        await _wait_for(websocket, 1)
        drainer = log_streaming_service._session_drainers[session_id]
        log_streaming_service.add_log(session_id, "INFO", "second", "Plugin")
        await _wait_for(websocket, 2)

        assert log_streaming_service._session_drainers[session_id] is drainer

    async def test_no_drainer_without_a_manager(self) -> None:
        session_id = str(uuid.uuid4())

        log_streaming_service.add_log(session_id, "INFO", "orphan", "Plugin")
        await _settle()

        assert session_id not in log_streaming_service._session_drainers

    async def test_clearing_the_session_tears_the_drainer_down(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        websocket = _RecordingWebSocket()
        manager.attach("c1", session_id, websocket)
        log_streaming_service.add_log(session_id, "INFO", "first", "Plugin")
        await _wait_for(websocket, 1)
        drainer = log_streaming_service._session_drainers[session_id]

        log_streaming_service._clear_session_logs(session_id)
        await _settle()

        assert session_id not in log_streaming_service._session_drainers
        assert drainer.done()

    async def test_clearing_one_session_leaves_the_other_running(
        self, manager: _FakeManager
    ) -> None:
        session_a = str(uuid.uuid4())
        session_b = str(uuid.uuid4())
        websocket_a = _RecordingWebSocket()
        websocket_b = _RecordingWebSocket()
        manager.attach("c1", session_a, websocket_a)
        manager.attach("c2", session_b, websocket_b)
        log_streaming_service.add_log(session_a, "INFO", "a", "Plugin")
        log_streaming_service.add_log(session_b, "INFO", "b", "Plugin")
        await _wait_for(websocket_a, 1)
        await _wait_for(websocket_b, 1)

        log_streaming_service._clear_session_logs(session_a)
        await _settle()

        assert session_a not in log_streaming_service._session_drainers
        assert session_b in log_streaming_service._session_drainers

    async def test_clear_cache_tears_every_drainer_down(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        websocket = _RecordingWebSocket()
        manager.attach("c1", session_id, websocket)
        log_streaming_service.add_log(session_id, "INFO", "first", "Plugin")
        await _wait_for(websocket, 1)

        log_streaming_service._clear_cache()
        await _settle()

        assert log_streaming_service._session_drainers == {}


class TestFanOutSurvivesConnectionChurn:
    """A tab connecting or closing mid-broadcast must not kill the stream.

    The fan-out walks the manager's live connection map and awaits inside the
    loop, so a socket registering during that await mutated the dict under the
    iterator. The resulting error killed the session's drainer task for good:
    every later line was queued with no consumer, and live output stopped for
    every subscriber, not just the new one.
    """

    async def test_a_tab_connecting_mid_send_does_not_stop_the_stream(
        self, manager: _FakeManager
    ) -> None:
        session_id = str(uuid.uuid4())
        watcher = _RecordingWebSocket(first_send_delay=0.05)
        manager.attach("c1", session_id, watcher)

        log_streaming_service.add_log(session_id, "INFO", "line-0", "Plugin")
        # A second tab attaches while the first send is still in flight.
        await asyncio.sleep(0.01)
        joiner = _RecordingWebSocket()
        manager.attach("c2", session_id, joiner)

        for index in range(1, 4):
            log_streaming_service.add_log(session_id, "INFO", f"line-{index}", "Plugin")
        await _wait_for(watcher, 4)

        assert watcher.messages == [f"line-{index}" for index in range(4)]
        assert joiner.messages[-1] == "line-3"

    async def test_the_drainer_survives_the_churn(self, manager: _FakeManager) -> None:
        session_id = str(uuid.uuid4())
        watcher = _RecordingWebSocket(first_send_delay=0.05)
        manager.attach("c1", session_id, watcher)

        log_streaming_service.add_log(session_id, "INFO", "line-0", "Plugin")
        await asyncio.sleep(0.01)
        manager.attach("c2", session_id, _RecordingWebSocket())
        await _wait_for(watcher, 1)
        await _settle()

        drainer = log_streaming_service._session_drainers.get(session_id)
        assert drainer is not None
        assert drainer.done() is False

    async def test_a_closing_tab_mid_send_does_not_stop_the_stream(
        self, manager: _FakeManager
    ) -> None:
        session_id = str(uuid.uuid4())
        watcher = _RecordingWebSocket(first_send_delay=0.05)
        manager.attach("c1", session_id, watcher)
        manager.attach("c2", session_id, _RecordingWebSocket())

        log_streaming_service.add_log(session_id, "INFO", "line-0", "Plugin")
        await asyncio.sleep(0.01)
        manager._metadata.pop("c2", None)
        manager.active_connections.pop("c2", None)

        for index in range(1, 4):
            log_streaming_service.add_log(session_id, "INFO", f"line-{index}", "Plugin")
        await _wait_for(watcher, 4)

        assert watcher.messages == [f"line-{index}" for index in range(4)]

    async def test_a_failing_fan_out_never_kills_the_drainer(self, manager: _FakeManager) -> None:
        """A fan-out that raises costs one line, not the rest of the run."""
        session_id = str(uuid.uuid4())
        healthy = _RecordingWebSocket()
        manager.attach("c1", session_id, healthy)

        calls = {"count": 0}
        original = manager.get_log_subscription_level

        def explode_once(conn_id: str, sid: str) -> str | None:
            calls["count"] += 1
            if calls["count"] == 1:
                raise RuntimeError("fan-out blew up")
            return original(conn_id, sid)

        manager.get_log_subscription_level = explode_once  # type: ignore[method-assign]

        for index in range(3):
            log_streaming_service.add_log(session_id, "INFO", f"line-{index}", "Plugin")
        await _wait_for(healthy, 2)

        assert healthy.messages == ["line-1", "line-2"]
        drainer = log_streaming_service._session_drainers.get(session_id)
        assert drainer is not None and drainer.done() is False
