"""Shared Netcat test furniture: loopback listeners, a log recorder and context builders."""

import asyncio
import gc
import socket
import warnings
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import suppress
from dataclasses import dataclass, field
from functools import partial
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.core.ssh.session_registry import SSHSessionRegistry

WAIT = 1.0  # a Timeout the verdict always beats
FAST = 0.05  # a Timeout the test waits out: silence, open or filtered, timed out
BANNER = b"SSH-2.0-WAVE-test\r\n"
ANSWER_PREFIX = b"got:"
SSH_HOST = "bastion.internal"
TUNNEL_SESSION = "ssh_session_tunnel"
Replies = Callable[[bytes], list[bytes]]
_UDP_REPLIES: dict[str, Replies] = {"udp-echo": lambda data: [data], "udp-silent": lambda _: []}


@pytest.fixture(scope="module", autouse=True)
def _earlier_garbage_collected() -> None:
    """Collect what earlier test files left behind, so a leak reported here is this file's."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ResourceWarning)
        gc.collect()


@pytest.fixture(autouse=True)
def no_unclosed_resource(
    _earlier_garbage_collected: None, recwarn: pytest.WarningsRecorder
) -> Iterator[None]:
    """Fail a test that leaves a socket, transport or stream writer unclosed (NETCAT-6)."""
    yield
    assert [str(w.message) for w in recwarn if issubclass(w.category, ResourceWarning)] == []


class WriterProbe:
    """A stream writer that forwards to the real one and sets `closed` when closed."""

    def __init__(self, writer: Any) -> None:
        self.writer, self.closed = writer, asyncio.Event()

    def close(self) -> None:
        self.closed.set()
        self.writer.close()

    def __getattr__(self, name: str) -> Any:
        return getattr(self.writer, name)


@dataclass
class Listener:
    """A loopback listener's port and what it received: per TCP connection, or per datagram."""

    port: int = 0
    received: list[bytes] = field(default_factory=list)

    async def settled(self, count: int) -> list[bytes]:
        """What was received once `count` connections ended or datagrams arrived (1 s bound)."""
        async with asyncio.timeout(1):
            while len(self.received) < count:
                await asyncio.sleep(0.001)
        return self.received


async def _serve(kind: str, listener: Listener, reader: Any, writer: Any) -> None:
    data = b""
    with suppress(ConnectionError):
        writer.write(BANNER if kind == "tcp-banner" else b"")
        while chunk := await reader.read(65536):
            data += chunk
            writer.write(chunk if kind == "tcp-echo" else b"")
        writer.write(ANSWER_PREFIX + data if kind == "tcp-answer" else b"")
        await writer.drain()
    listener.received.append(data)
    writer.close()


@pytest.fixture
async def listen() -> AsyncIterator[Callable[..., Awaitable[Listener]]]:
    """Start by kind: tcp-echo|banner|answer|silent, udp-echo|silent, or "udp" with replies."""
    loop, closers = asyncio.get_running_loop(), list[Callable[[], object]]()

    async def start(kind: str, replies: Replies | None = None) -> Listener:
        listener = Listener()
        if not kind.startswith("udp"):
            server = await asyncio.start_server(partial(_serve, kind, listener), "127.0.0.1", 0)
            closers.append(server.close)
            listener.port = server.sockets[0].getsockname()[1]
            return listener
        sock = socket.socket(type=socket.SOCK_DGRAM)
        sock.bind(("127.0.0.1", 0))

        def on_datagram(answer: Replies = replies or _UDP_REPLIES[kind]) -> None:
            data, peer = sock.recvfrom(65536)
            listener.received.append(data)
            for reply in answer(data):
                sock.sendto(reply, peer)

        loop.add_reader(sock, on_datagram)
        closers.extend([partial(loop.remove_reader, sock), sock.close])
        listener.port = sock.getsockname()[1]
        return listener

    yield start
    for close in closers:
        close()


def free_port() -> int:
    """A loopback port nothing listens on over TCP or UDP: bound on both, then released."""
    with socket.socket() as tcp, socket.socket(type=socket.SOCK_DGRAM) as udp:
        tcp.bind(("127.0.0.1", 0))
        with suppress(OSError):
            udp.bind(tcp.getsockname())
            return int(tcp.getsockname()[1])
    return free_port()


class LogRecorder(list[tuple[str, str]]):
    """The core's log(level, message), and a logger whose debug/info/warn record the same way."""

    def __call__(self, level: str, message: str) -> None:
        self.append((level, message))

    def __getattr__(self, name: str) -> Callable[[str], None]:
        if name not in ("debug", "info", "warn", "error"):
            raise AttributeError(name)
        return partial(self, name.upper())


@pytest.fixture
def log() -> LogRecorder:
    return LogRecorder()


def netcat_params(port: int = 0, **overrides: Any) -> dict[str, Any]:
    """A Single TCP Check of 127.0.0.1 with a WAIT Timeout that `overrides` reshape."""
    base = {"host": "127.0.0.1", "ports": "single", "port": port, "protocol": "tcp"}
    return {**base, "mode": "check", "timeout": WAIT, **overrides}


def netcat_context(params: dict[str, Any], logger: Any = None, **optional: Any) -> dict[str, Any]:
    """execute()'s context plus only the optional keys given (ssh_session_registry, ...)."""
    logger = MagicMock() if logger is None else logger
    return {"parameters": params, "variables": {}, "logger": logger, **optional}


def tunnel_registry(tunnels: dict[int, str], connection: Any) -> SSHSessionRegistry:
    """One open session on SSH_HOST holding a tunnel per local port -> remote_destination."""
    registry = SSHSessionRegistry()
    registry.register(TUNNEL_SESSION, connection, None, SSH_HOST, None, None, connect_timeout=30)
    for local_port, destination in tunnels.items():
        registry.add_tunnel(TUNNEL_SESSION, f"t{local_port}", MagicMock(), local_port, destination)
    return registry


def resolve_to(monkeypatch: pytest.MonkeyPatch, *addresses: str, **fault: Any) -> list[str]:
    """The running loop's getaddrinfo answers `addresses` in order (fault: error=, hang=True)."""
    asked: list[str] = []

    async def getaddrinfo(host: str, port: Any, **options: Any) -> list[Any]:
        asked.append(host)
        if fault.get("hang"):
            await asyncio.Event().wait()
        if "error" in fault:
            raise fault["error"]
        kind, numeric = options.get("type", 0), socket.AI_NUMERICHOST
        return [socket.getaddrinfo(a, 0, type=kind, flags=numeric)[0] for a in addresses]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", getaddrinfo)
    return asked
