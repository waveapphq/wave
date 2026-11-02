"""Shared Ping test furniture: the fake echo socket, its canned answers and a log recorder.

Every backend test drives `_ping_core.run` through the injectable socket seam; nothing here
opens an ICMP socket, because the backend CI container refuses one.
"""

import asyncio
import re
import socket
import struct
from collections import deque
from collections.abc import Callable, Iterator
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.plugins._ping_core import Received

TARGET = "203.0.113.5"
ROUTER = "198.51.100.1"
LOOPBACK = "127.0.0.1"
EARLY_TIMER_S = 0.002
TTL_EXCEEDED = "Time to live exceeded"
DEFAULT_MTU = 1500

# One scripted answer: the seconds the fake clock moves on, then what came back.
Answer = tuple[float, Received | None]


def echo_message(seq: int, *, icmp_type: int = 0, payload: int = 56) -> bytes:
    """One ICMP echo message: type, code, checksum, id, sequence, then the payload."""
    return struct.pack("!BBHHH", icmp_type, 0, 0, 4242, seq) + bytes(payload)


def reply(
    seq: int, *, after: float = 0.01, source: str = TARGET, ttl: int = 57, payload: int = 56
) -> Answer:
    """An echo reply for `seq`, `after` seconds after the request went out."""
    return after, Received(echo_message(seq, payload=payload), ttl, source, "")


def icmp_error(
    seq: int,
    *,
    after: float = 0.01,
    text: str = TTL_EXCEEDED,
    source: str = ROUTER,
    payload: int = 56,
) -> Answer:
    """An ICMP error for `seq`; the error queue hands back the request that caused it."""
    return after, Received(echo_message(seq, icmp_type=8, payload=payload), 0, source, text)


def silence() -> Answer:
    """Nothing came back before the wait ran out."""
    return 0.0, None


class FakeClock:
    """The monotonic clock the core reads; the fake socket is what moves it on."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class FakeSocket:
    """The EchoSocket stand-in: scripted answers, and a record of what the core asked for."""

    def __init__(
        self,
        script: list[Answer] | None = None,
        *,
        clock: FakeClock | None = None,
        mtu: int = DEFAULT_MTU,
        send_error: OSError | None = None,
        bind_error: OSError | None = None,
        real_time: bool = False,
    ) -> None:
        self.script = deque(script or [])
        self.clock = clock or FakeClock()
        self.mtu, self.send_error, self.bind_error = mtu, send_error, bind_error
        self.real_time = real_time
        self.family: int | None = None
        self.sent: list[tuple[float, bytes]] = []
        self.waits: list[float] = []
        self.bound: str | None = None
        self.connected: str | None = None
        self.ttl: int | None = None
        self.dont_fragment = False
        self.closed = False

    def bind(self, address: str) -> None:
        if self.bind_error is not None:
            raise self.bind_error
        self.bound = address

    def connect(self, address: str) -> None:
        self.connected = address

    def set_ttl(self, ttl: int) -> None:
        self.ttl = ttl

    def set_dont_fragment(self) -> None:
        self.dont_fragment = True

    def path_mtu(self) -> int:
        return self.mtu

    async def send(self, packet: bytes) -> None:
        if self.send_error is not None:
            raise self.send_error
        self.sent.append((self.clock(), packet))

    async def receive(self, until: float) -> Received | None:
        """The next scripted answer, or None once the deadline has run out."""
        timeout = until - self.clock.now
        self.waits.append(timeout)
        after, value = self.script.popleft() if self.script else (0.0, None)
        moved = timeout if value is None else after
        if self.real_time:
            await asyncio.sleep(moved)
        else:
            await asyncio.sleep(0)
        self.clock.now += moved
        return value

    def close(self) -> None:
        self.closed = True


def opener_for(sock: FakeSocket) -> Callable[[int], FakeSocket]:
    """An opener that hands the core this one socket and records the family it asked for."""

    def opener(family: int) -> FakeSocket:
        sock.family = family
        return sock

    return opener


def refusing_opener(error: OSError | None = None) -> Callable[[int], FakeSocket]:
    """An opener that refuses, the way a machine outside ping_group_range does."""
    refusal = error or PermissionError(1, "Operation not permitted")

    def opener(family: int) -> FakeSocket:
        raise refusal

    return opener


class LogRecorder(list[tuple[str, str]]):
    """The core's log(level, message), and a logger whose debug/info/warn record the same way."""

    def __call__(self, level: str, message: str) -> None:
        self.append((level, message))

    def __getattr__(self, name: str) -> Callable[[str], None]:
        if name not in ("debug", "info", "warn", "error"):
            raise AttributeError(name)
        return lambda message: self(name.upper(), message)

    def at(self, level: str) -> list[str]:
        return [message for recorded, message in self if recorded == level]


@pytest.fixture
def log() -> LogRecorder:
    return LogRecorder()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def peer() -> Iterator[socket.socket]:
    """A loopback UDP socket that never answers, standing in for the host being pinged."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((LOOPBACK, 0))
    yield sock
    sock.close()


def fire_timers_early(monkeypatch: pytest.MonkeyPatch) -> None:
    """The running loop's timers fire EARLY_TIMER_S before they are due."""
    loop = asyncio.get_running_loop()
    on_time = loop.call_at

    def early(when: float, *args: Any, **kwargs: Any) -> asyncio.TimerHandle:
        return on_time(when - EARLY_TIMER_S, *args, **kwargs)

    # uvloop keeps millisecond timers, so a timed wait can wake before its deadline.
    monkeypatch.setattr(loop, "call_at", early)


def ping_params(**overrides: Any) -> dict[str, Any]:
    """Four requests to one host at a tenth of a second, which `overrides` reshape."""
    base: dict[str, Any] = {"host": "target.internal", "count": 4, "interval": 0.1, "timeout": 30}
    return {**base, **overrides}


def ping_context(params: dict[str, Any], logger: Any = None, **optional: Any) -> dict[str, Any]:
    """execute()'s context plus only the optional keys given."""
    return {
        "parameters": params,
        "variables": {},
        "logger": MagicMock() if logger is None else logger,
        **optional,
    }


def resolve_to(monkeypatch: pytest.MonkeyPatch, *addresses: str, **fault: Any) -> list[str]:
    """The running loop's getaddrinfo answers `addresses` in order (fault: error=, hang=True)."""
    asked: list[str] = []

    async def getaddrinfo(host: str, port: Any, **options: Any) -> list[Any]:
        asked.append(host)
        if fault.get("hang"):
            await asyncio.Event().wait()
        if "error" in fault:
            raise fault["error"]
        numeric = socket.AI_NUMERICHOST
        return [
            socket.getaddrinfo(a, 0, type=socket.SOCK_DGRAM, flags=numeric)[0] for a in addresses
        ]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", getaddrinfo)
    return asked


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def outputs(envelope: dict[str, Any]) -> dict[str, Any]:
    """The outputs of a result envelope, checked for the envelope's own shape."""
    assert envelope["__wave_type"] == "result" and envelope["secrets"] == []
    result: dict[str, Any] = envelope["outputs"]
    return result


def columns(table: dict[str, Any]) -> list[tuple[str, str]]:
    assert table["__wave_type"] == "table"
    return [(column["name"], column["type"]) for column in table["columns"]]


def rows(table: dict[str, Any]) -> list[list[Any]]:
    assert table["__wave_type"] == "table"
    return [list(row) for row in table["rows"]]


def row_map(table: dict[str, Any], index: int = 0) -> dict[str, Any]:
    """One table row as a name to value mapping."""
    names = [name for name, _ in columns(table)]
    return dict(zip(names, rows(table)[index], strict=True))
