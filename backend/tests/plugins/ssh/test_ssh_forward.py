"""The SSH tunnel forwarder and target check (REQ-5.1.5, SSHTUN-6, SSHTUN-7, SSHTUN-8)."""

import asyncio
import errno
import re
import socket
import struct
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AsyncExitStack, asynccontextmanager, suppress
from functools import partial
from typing import Any
from unittest.mock import MagicMock, call

import asyncssh
import httpx
import pytest

from tests.plugins.netcat.conftest import WriterProbe, free_port
from tests.plugins.ssh.conftest import (
    SESSION_ID,
    ForwardingSSH,
    RunLog,
    channel_connection,
    tunnel_session,
)
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins._ssh_forward import cause_phrase, start_forwarder, validate_target

DB, DB_PORT = "db", 5432
TUNNEL_ID = "tunnel_0123456789ab"
GREETING = b"hello"
CLOSED = "the SSH connection to bastion is closed"
REFUSED = "bastion could not connect (Connection refused)"
# More than an asyncio stream buffers before it stops reading, so some stays in the kernel.
SENT_BEFORE_REFUSAL = b"x" * (512 * 1024)

Stream = tuple[asyncio.StreamReader, asyncio.StreamWriter]
Serve = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[bytes]]

REFUSALS = pytest.mark.parametrize(
    ("refuse", "cause"),
    [
        ((1, "open failed"), "bastion refused to forward (administratively prohibited)"),
        ((2, "Connection refused"), REFUSED),
        ((4, "resource shortage"), "bastion refused the connection (resource shortage)"),
    ],
    ids=["code 1", "code 2", "code 4"],
)


@pytest.fixture(autouse=True)
async def handlers_finish() -> AsyncIterator[None]:
    """Let the connection handlers a test started end before its event loop closes (1 s bound)."""
    yield
    running = asyncio.all_tasks() - {asyncio.current_task()}
    if running:
        await asyncio.wait(running, timeout=1)


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def warn_line(port: int, cause: str, destination: str = "db:5432") -> str:
    return f"Connection through SSH tunnel 127.0.0.1:{port} to {destination} failed: {cause}"


def check_failed(cause: str) -> str:
    return f"SSH tunnel to db:5432 failed: {cause}"


def warnings_in(log: RunLog) -> list[str]:
    return [message for level, message in log if level == "WARN"]


def registered(
    connection: Any, connect_timeout: float = 30, **identity: Any
) -> tuple[SSHSessionRegistry, dict[str, Any]]:
    """A registry with one session on host 'node-1' that names itself 'bastion', and its record."""
    registry = tunnel_session(connection, connect_timeout=connect_timeout, **identity)
    record = registry.get(SESSION_ID)
    assert record is not None
    return registry, record


def session_record(connection: Any, connect_timeout: float = 30, **identity: Any) -> dict[str, Any]:
    return registered(connection, connect_timeout, **identity)[1]


def refusal(code: int, reason: str) -> ConnectionRefusedError:
    """What open_tunnel_stream raises for a refused channel: the server's refusal as its cause."""
    refused = ConnectionRefusedError(reason)
    refused.__cause__ = asyncssh.ChannelOpenError(code, reason)
    return refused


def reset(writer: asyncio.StreamWriter) -> None:
    """Close with SO_LINGER 0, so the peer meets a reset instead of an orderly end."""
    linger = struct.pack("ii", 1, 0)
    writer.get_extra_info("socket").setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, linger)
    writer.close()


async def read_to_end(reader: Any) -> bytes:
    """Everything the peer sends until its EOF (1 s bound)."""
    data = b""
    async with asyncio.timeout(1):
        while chunk := await reader.read(65536):
            data += chunk
    return data


async def read_until_ended(reader: asyncio.StreamReader) -> bytes:
    """Everything read until EOF or a reset, whichever ends the connection (1 s bound)."""
    data = b""
    async with asyncio.timeout(1):
        with suppress(ConnectionResetError):
            while chunk := await reader.read(65536):
                data += chunk
    return data


async def read_exactly(reader: Any, size: int) -> bytes:
    data = b""
    async with asyncio.timeout(1):
        while len(data) < size and (chunk := await reader.read(size - len(data))):
            data += chunk
    return data


async def exchange(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, data: bytes
) -> bytes:
    """Send `data` and read back as many bytes."""
    writer.write(data)
    await writer.drain()
    return await read_exactly(reader, len(data))


@asynccontextmanager
async def client(port: int, host: str = "127.0.0.1") -> AsyncIterator[Stream]:
    reader, writer = await asyncio.open_connection(host, port)
    try:
        yield reader, writer
    finally:
        writer.close()
        with suppress(OSError):
            await writer.wait_closed()


@asynccontextmanager
async def forwarding(
    record: dict[str, Any],
    log: RunLog,
    remote_host: str = DB,
    remote_port: int = DB_PORT,
    local_port: int = 0,
) -> AsyncIterator[Any]:
    forwarder = await start_forwarder(record, TUNNEL_ID, local_port, remote_host, remote_port, log)
    try:
        yield forwarder
    finally:
        forwarder.close()


class Target:
    """A loopback destination's port and what each finished connection sent it."""

    def __init__(self) -> None:
        self.port = 0
        self.received: list[bytes] = []

    async def settled(self, count: int = 1) -> list[bytes]:
        """What was received once `count` connections ended (1 s bound)."""
        async with asyncio.timeout(1):
            while len(self.received) < count:
                await asyncio.sleep(0.001)
        return self.received


@asynccontextmanager
async def target(serve: Serve, port: int = 0) -> AsyncIterator[Target]:
    found = Target()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            with suppress(ConnectionError):
                found.received.append(await serve(reader, writer))
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", port)
    found.port = server.sockets[0].getsockname()[1]
    try:
        yield found
    finally:
        server.close()


async def _read_all(reader: asyncio.StreamReader) -> bytes:
    data = b""
    with suppress(ConnectionError):
        while chunk := await reader.read(65536):
            data += chunk
    return data


async def echoes(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> bytes:
    data = b""
    while chunk := await reader.read(65536):
        data += chunk
        writer.write(chunk)
        await writer.drain()
    return data


async def listens(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> bytes:
    return await _read_all(reader)


async def answers_at_eof(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> bytes:
    data = await _read_all(reader)
    writer.write(b"got:" + data)
    await writer.drain()
    return data


async def greets(
    greeted: asyncio.Event, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
) -> bytes:
    writer.write(GREETING)
    await writer.drain()
    greeted.set()
    return await _read_all(reader)


async def sent(event: asyncio.Event) -> None:
    async with asyncio.timeout(1):
        await event.wait()


async def greets_then_stops_sending(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter
) -> bytes:
    writer.write(GREETING)
    writer.write_eof()
    return await _read_all(reader)


async def greets_and_hangs_up(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> bytes:
    writer.write(GREETING)
    await writer.drain()
    return b""


async def holds_open_after_eof(
    release: asyncio.Event, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
) -> bytes:
    data = await _read_all(reader)
    await release.wait()
    return data


async def resets_after_the_first_bytes(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter
) -> bytes:
    data = await reader.read(65536)
    reset(writer)
    return data


async def channels_opened(connection: MagicMock, count: int = 1) -> list[WriterProbe]:
    """The stand-in's channels once `count` of them opened (1 s bound)."""
    async with asyncio.timeout(1):
        while len(connection.channels.writers) < count:
            await asyncio.sleep(0.001)
    writers: list[WriterProbe] = connection.channels.writers
    return writers


async def waiting_at_the_gate(connection: MagicMock) -> None:
    async with asyncio.timeout(1):
        while not connection.channels.opening:
            await asyncio.sleep(0.001)


async def closed(probe: WriterProbe) -> None:
    async with asyncio.timeout(1):
        await probe.closed.wait()


def records_channel_writes(connection: MagicMock) -> list[str]:
    """Wrap every channel writer the stand-in opens so its write / drain calls are recorded."""
    calls: list[str] = []
    opens = connection.open_connection.side_effect

    async def open_and_record(host: str, port: int) -> tuple[Any, Any]:
        reader, probe = await opens(host, port)
        write, drain = probe.write, probe.drain

        def recorded_write(data: bytes) -> None:
            calls.append("write")
            write(data)

        async def recorded_drain() -> None:
            calls.append("drain")
            await drain()

        probe.write, probe.drain = recorded_write, recorded_drain
        return reader, probe

    connection.open_connection.side_effect = open_and_record
    return calls


class TestTheListener:
    """The Local Port: loopback only, bound as given, a fresh channel per connection (SSHTUN-6)."""

    async def test_it_accepts_on_127_0_0_1_only(self) -> None:
        async with target(echoes) as far:
            async with forwarding(session_record(channel_connection(far.port)), RunLog()) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    assert await exchange(reader, writer, b"ping") == b"ping"
                with pytest.raises(ConnectionRefusedError):
                    await asyncio.open_connection("127.0.0.2", fwd.get_port())

    async def test_a_given_local_port_is_the_one_bound(self) -> None:
        wanted = free_port()
        async with target(echoes) as far:
            connection = channel_connection(far.port)
            async with forwarding(session_record(connection), RunLog(), local_port=wanted) as fwd:
                assert fwd.get_port() == wanted
                async with client(wanted) as (reader, writer):
                    assert await exchange(reader, writer, b"ping") == b"ping"

    async def test_a_local_port_in_use_raises_the_bind_error_as_is(self) -> None:
        with socket.socket() as taken:
            taken.bind(("127.0.0.1", 0))
            taken.listen()
            record = session_record(channel_connection())
            with pytest.raises(OSError) as failed:
                await start_forwarder(
                    record, TUNNEL_ID, taken.getsockname()[1], DB, DB_PORT, RunLog()
                )

        assert type(failed.value) is OSError
        assert failed.value.errno == errno.EADDRINUSE

    async def test_starting_it_opens_no_channel(self) -> None:
        connection, log = channel_connection(), RunLog()

        async with forwarding(session_record(connection), log):
            pass

        assert connection.open_connection.call_count == 0
        assert warnings_in(log) == []

    async def test_each_accepted_connection_opens_its_own_channel(self) -> None:
        async with target(echoes) as far, AsyncExitStack() as clients:
            connection = channel_connection(far.port)
            fwd = await clients.enter_async_context(
                forwarding(session_record(connection), RunLog())
            )
            streams = [await clients.enter_async_context(client(fwd.get_port())) for _ in range(3)]
            for index, (reader, writer) in enumerate(streams):
                assert await exchange(reader, writer, b"client %d" % index) == b"client %d" % index

            assert connection.open_connection.call_args_list == [call(DB, DB_PORT)] * 3
            assert len({id(probe) for probe in await channels_opened(connection, 3)}) == 3

    async def test_close_stops_accepting_while_a_relay_in_progress_keeps_running(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        async with target(echoes) as far, forwarding_ssh() as conn:
            fwd = await start_forwarder(
                session_record(conn), TUNNEL_ID, 0, "127.0.0.1", far.port, RunLog()
            )
            port = fwd.get_port()
            try:
                async with client(port) as (reader, writer):
                    assert await exchange(reader, writer, b"before") == b"before"
                    fwd.close()
                    with pytest.raises(ConnectionRefusedError):
                        await asyncio.open_connection("127.0.0.1", port)
                    assert await exchange(reader, writer, b"after") == b"after"
            finally:
                fwd.close()


class TestAFailedConnection:
    """A connection the SSH host cannot complete fails only itself (SSHTUN-6)."""

    async def test_it_fails_only_itself_and_a_destination_that_comes_up_later_is_reached(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        far_port, log = free_port(), RunLog()
        async with forwarding_ssh() as conn:
            async with forwarding(session_record(conn), log, "127.0.0.1", far_port) as fwd:
                async with client(fwd.get_port()) as (reader, _):
                    assert await read_to_end(reader) == b""
                # The code 2 reason is the operating system's connect error text.
                prefix = warn_line(
                    fwd.get_port(), "bastion could not connect (", f"127.0.0.1:{far_port}"
                )
                assert [message[: len(prefix)] for message in warnings_in(log)] == [prefix]

                async with target(echoes, far_port):
                    async with client(fwd.get_port()) as (reader, writer):
                        assert await exchange(reader, writer, b"up now") == b"up now"

        assert len(warnings_in(log)) == 1

    async def test_a_relay_in_progress_outlives_a_later_failed_connection(self) -> None:
        log = RunLog()
        async with target(echoes) as far:
            connection = channel_connection(far.port)
            async with forwarding(session_record(connection), log) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    assert await exchange(reader, writer, b"first") == b"first"
                    connection.open_connection.side_effect = asyncssh.ChannelOpenError(
                        2, "Connection refused"
                    )
                    async with client(fwd.get_port()) as (refused, _):
                        assert await read_to_end(refused) == b""
                    assert await exchange(reader, writer, b"still") == b"still"

        assert warnings_in(log) == [warn_line(fwd.get_port(), REFUSED)]

    async def test_the_client_is_closed_cleanly_after_what_it_sent_is_read(self) -> None:
        connection, log = channel_connection(refuse="Connection refused", hang=True), RunLog()
        async with forwarding(session_record(connection), log) as fwd:
            async with client(fwd.get_port()) as (reader, writer):
                writer.write(SENT_BEFORE_REFUSAL)
                await writer.drain()
                await waiting_at_the_gate(connection)
                connection.channels.gate.set()

                assert await read_to_end(reader) == b""

        assert warnings_in(log) == [warn_line(fwd.get_port(), REFUSED)]

    async def test_an_http_client_is_told_the_server_disconnected_without_a_response(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        async with forwarding_ssh(refuse=(2, "Connection refused")) as conn:
            async with (
                forwarding(session_record(conn), RunLog()) as fwd,
                httpx.AsyncClient(timeout=1, trust_env=False) as http,
            ):
                with pytest.raises(
                    httpx.RemoteProtocolError,
                    match=exact("Server disconnected without sending a response."),
                ):
                    await http.get(f"http://127.0.0.1:{fwd.get_port()}/")


class TestTheTunnelWarning:
    """One WARN per failed connection, through the Tunnel Open logger (SSHTUN-6, SSHTUN-8)."""

    @REFUSALS
    async def test_a_refused_connection_writes_one_warn_before_its_client_is_closed(
        self, forwarding_ssh: ForwardingSSH, refuse: tuple[int, str], cause: str
    ) -> None:
        log = RunLog()
        async with forwarding_ssh(refuse=refuse) as conn:
            async with forwarding(session_record(conn), log) as fwd:
                async with client(fwd.get_port()) as (reader, _):
                    assert await read_to_end(reader) == b""
                    assert warnings_in(log) == [warn_line(fwd.get_port(), cause)]

    async def test_an_unknown_channel_type_names_the_host_reason(self) -> None:
        log = RunLog()
        connection = channel_connection(refuse="Unknown channel type", code=3)
        async with forwarding(session_record(connection), log) as fwd:
            async with client(fwd.get_port()) as (reader, _):
                assert await read_to_end(reader) == b""
                assert warnings_in(log) == [
                    warn_line(
                        fwd.get_port(), "bastion refused the connection (Unknown channel type)"
                    )
                ]

    async def test_a_closed_session_connection_writes_the_closed_cause(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        log = RunLog()
        async with forwarding_ssh() as conn:
            async with forwarding(session_record(conn), log) as fwd:
                conn.close()
                await conn.wait_closed()
                async with client(fwd.get_port()) as (reader, _):
                    assert await read_to_end(reader) == b""
                    assert warnings_in(log) == [warn_line(fwd.get_port(), CLOSED)]

    async def test_a_connection_asyncssh_reports_closed_writes_the_closed_cause(self) -> None:
        log = RunLog()
        async with forwarding(session_record(channel_connection(closed=True)), log) as fwd:
            async with client(fwd.get_port()) as (reader, _):
                assert await read_to_end(reader) == b""
                assert warnings_in(log) == [warn_line(fwd.get_port(), CLOSED)]

    async def test_every_failed_connection_writes_its_own_warn(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        log = RunLog()
        async with forwarding_ssh(refuse=(2, "Connection refused")) as conn:
            async with forwarding(session_record(conn), log) as fwd:
                line = warn_line(fwd.get_port(), REFUSED)
                for count in (1, 2):
                    async with client(fwd.get_port()) as (reader, _):
                        assert await read_to_end(reader) == b""
                        assert warnings_in(log) == [line] * count

    async def test_a_connection_that_ends_after_its_channel_opened_writes_no_warn(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        log = RunLog()
        async with target(echoes) as far, forwarding_ssh() as conn:
            async with forwarding(session_record(conn), log, "127.0.0.1", far.port) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    assert await exchange(reader, writer, b"ping") == b"ping"
                assert await far.settled(1) == [b"ping"]

        assert warnings_in(log) == []

    async def test_a_connection_the_target_ends_after_its_channel_opened_writes_no_warn(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        log = RunLog()
        async with target(greets_and_hangs_up) as far, forwarding_ssh() as conn:
            async with forwarding(session_record(conn), log, "127.0.0.1", far.port) as fwd:
                async with client(fwd.get_port()) as (reader, _):
                    assert await read_to_end(reader) == GREETING

        assert warnings_in(log) == []


class TestTheCausePhrase:
    """The cause shared by the WARN and the check error; closed connection first (SSHTUN-8)."""

    @pytest.mark.parametrize(
        ("code", "reason", "phrase"),
        [
            (1, "open failed", "bastion refused to forward (administratively prohibited)"),
            (2, "No route to host", "bastion could not connect (No route to host)"),
            (3, "Unknown channel type", "bastion refused the connection (Unknown channel type)"),
            (4, "resource shortage", "bastion refused the connection (resource shortage)"),
        ],
        ids=["code 1", "code 2", "code 3", "code 4"],
    )
    def test_the_refusal_code_picks_the_phrase(self, code: int, reason: str, phrase: str) -> None:
        assert cause_phrase(refusal(code, reason), session_record(channel_connection())) == phrase

    @pytest.mark.parametrize(
        ("code", "reason"),
        [(2, "SSH connection closed"), (1, "open failed"), (4, "resource shortage")],
        ids=["code 2 SSH connection closed", "code 1", "code 4"],
    )
    def test_a_closed_connection_is_checked_before_the_code(self, code: int, reason: str) -> None:
        record = session_record(channel_connection(closed=True))

        assert cause_phrase(refusal(code, reason), record) == CLOSED

    @pytest.mark.parametrize(
        "lost",
        [
            ConnectionResetError("Connection lost"),
            asyncssh.ConnectionLost("Connection lost"),
        ],
        ids=["ConnectionResetError", "asyncssh.Error"],
    )
    def test_a_lost_connection_reads_as_closed_while_the_session_still_looks_open(
        self, lost: Exception
    ) -> None:
        record = session_record(channel_connection())

        assert record["connection"].is_closed() is False
        assert cause_phrase(lost, record) == CLOSED

    def test_a_reset_carrying_an_ssh_error_reads_as_closed(self) -> None:
        lost = ConnectionResetError("Connection lost")
        lost.__cause__ = asyncssh.ConnectionLost("Connection lost")

        assert cause_phrase(lost, session_record(channel_connection())) == CLOSED

    def test_the_ssh_host_is_the_session_host_identity(self) -> None:
        record = session_record(channel_connection(), host_identity="db-gateway")

        assert cause_phrase(refusal(2, "Connection refused"), record) == (
            "db-gateway could not connect (Connection refused)"
        )

    def test_without_a_host_identity_the_ssh_host_is_the_session_host(self) -> None:
        record = session_record(channel_connection(), host_identity=None)

        assert cause_phrase(refusal(1, "open failed"), record) == (
            "node-1 refused to forward (administratively prohibited)"
        )


class TestTheRelay:
    """Bytes flow both ways; half-close, close and reset carry over like ssh -L."""

    async def test_bytes_flow_both_ways_whole_and_in_order(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        payload = bytes(range(256)) * 1024
        async with target(echoes) as far, forwarding_ssh() as conn:
            async with forwarding(session_record(conn), RunLog(), "127.0.0.1", far.port) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    writer.write(payload)
                    _, echoed = await asyncio.gather(
                        writer.drain(), read_exactly(reader, len(payload))
                    )
                    assert echoed == payload

    async def test_client_eof_reaches_the_target_and_its_answer_still_reaches_the_client(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        async with target(answers_at_eof) as far, forwarding_ssh() as conn:
            async with forwarding(session_record(conn), RunLog(), "127.0.0.1", far.port) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    writer.write(b"question")
                    writer.write_eof()

                    assert await read_to_end(reader) == b"got:question"
            assert await far.settled(1) == [b"question"]

    async def test_target_eof_reaches_the_client_after_its_bytes_while_the_client_still_sends(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        async with target(greets_then_stops_sending) as far, forwarding_ssh() as conn:
            async with forwarding(session_record(conn), RunLog(), "127.0.0.1", far.port) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    assert await read_to_end(reader) == GREETING

                    writer.write(b"late")
                    writer.write_eof()
                    assert await far.settled(1) == [b"late"]

    async def test_a_finished_exchange_closes_the_channel(self) -> None:
        async with target(answers_at_eof) as far:
            connection = channel_connection(far.port)
            async with forwarding(session_record(connection), RunLog()) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    writer.write(b"question")
                    writer.write_eof()

                    assert await read_to_end(reader) == b"got:question"
                    await closed((await channels_opened(connection))[0])

    async def test_a_client_reset_closes_the_channel_while_the_target_stays_open(self) -> None:
        release = asyncio.Event()
        async with target(partial(holds_open_after_eof, release)) as far:
            connection = channel_connection(far.port)
            try:
                async with forwarding(session_record(connection), RunLog()) as fwd:
                    async with client(fwd.get_port()) as (_, writer):
                        writer.write(b"x")
                        await writer.drain()
                        [probe] = await channels_opened(connection)
                        reset(writer)

                        await closed(probe)
            finally:
                release.set()
            assert len(await far.settled(1)) == 1

    async def test_a_target_reset_closes_the_client_and_the_channel(self) -> None:
        async with target(resets_after_the_first_bytes) as far:
            connection = channel_connection(far.port)
            async with forwarding(session_record(connection), RunLog()) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    writer.write(b"x")
                    await writer.drain()

                    assert await read_until_ended(reader) == b""
                    await closed((await channels_opened(connection))[0])

    async def test_a_channel_the_session_server_closes_ends_the_client(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        async with target(resets_after_the_first_bytes) as far, forwarding_ssh() as conn:
            async with forwarding(session_record(conn), RunLog(), "127.0.0.1", far.port) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    writer.write(b"x")
                    await writer.drain()

                    assert await read_until_ended(reader) == b""
            assert await far.settled(1) == [b"x"]

    async def test_every_write_to_the_channel_awaits_its_drain(self) -> None:
        async with target(echoes) as far:
            connection = channel_connection(far.port)
            calls = records_channel_writes(connection)
            async with forwarding(session_record(connection), RunLog()) as fwd:
                async with client(fwd.get_port()) as (reader, writer):
                    for data in (b"one", b"two", b"three"):
                        assert await exchange(reader, writer, data) == data

        after_each_write = [
            (calls + ["none"])[at + 1] for at, name in enumerate(calls) if name == "write"
        ]
        assert after_each_write == ["drain"] * 3


class TestValidateTarget:
    """The check at open: one channel, bounded by the session's Connection Timeout (SSHTUN-7)."""

    async def test_success_returns_the_open_pair_with_what_the_target_already_sent(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        greeted = asyncio.Event()
        async with target(partial(greets, greeted)) as far, forwarding_ssh() as conn:
            reader, writer = await validate_target(session_record(conn), "127.0.0.1", far.port)
            try:
                await sent(greeted)
                assert await read_exactly(reader, len(GREETING)) == GREETING
                writer.write(b"ping")
                writer.write_eof()
                assert await far.settled(1) == [b"ping"]
            finally:
                writer.close()

    async def test_success_opens_one_channel_to_the_destination(self) -> None:
        async with target(listens) as far:
            connection = channel_connection(far.port)
            _, writer = await validate_target(session_record(connection), DB, DB_PORT)
            writer.close()

            assert connection.open_connection.call_args_list == [call(DB, DB_PORT)]
            assert connection.channels.closed() == [True]

    @REFUSALS
    async def test_a_refusal_fails_the_check_with_its_cause(
        self, forwarding_ssh: ForwardingSSH, refuse: tuple[int, str], cause: str
    ) -> None:
        async with forwarding_ssh(refuse=refuse) as conn:
            with pytest.raises(ConnectionError, match=exact(check_failed(cause))):
                await validate_target(session_record(conn), DB, DB_PORT)

    async def test_an_unknown_channel_type_fails_the_check_with_the_host_reason(self) -> None:
        connection = channel_connection(refuse="Unknown channel type", code=3)
        cause = "bastion refused the connection (Unknown channel type)"

        with pytest.raises(ConnectionError, match=exact(check_failed(cause))):
            await validate_target(session_record(connection), DB, DB_PORT)

    async def test_a_closed_session_connection_fails_the_check_as_closed(
        self, forwarding_ssh: ForwardingSSH
    ) -> None:
        async with forwarding_ssh() as conn:
            conn.close()
            await conn.wait_closed()

            with pytest.raises(ConnectionError, match=exact(check_failed(CLOSED))):
                await validate_target(session_record(conn), DB, DB_PORT)

    async def test_a_connection_asyncssh_reports_closed_fails_the_check_as_closed(self) -> None:
        with pytest.raises(ConnectionError, match=exact(check_failed(CLOSED))):
            await validate_target(session_record(channel_connection(closed=True)), DB, DB_PORT)

    @pytest.mark.parametrize(
        ("connect_timeout", "within"),
        [(30, "30 seconds"), (1, "1 second")],
        ids=["30 seconds", "1 second"],
    )
    async def test_the_open_is_bounded_by_the_session_connection_timeout(
        self, monkeypatch: pytest.MonkeyPatch, connect_timeout: int, within: str
    ) -> None:
        bounds: list[float | None] = []

        async def expires_at_once(awaitable: Any, timeout: float | None) -> Any:
            bounds.append(timeout)
            awaitable.close()
            raise TimeoutError

        monkeypatch.setattr(asyncio, "wait_for", expires_at_once)
        record = session_record(channel_connection(hang=True), connect_timeout=connect_timeout)

        with pytest.raises(
            ConnectionError, match=exact(check_failed(f"bastion did not connect within {within}"))
        ):
            await validate_target(record, DB, DB_PORT)
        assert bounds == [connect_timeout]

    async def test_a_hung_open_times_out_and_its_late_channel_is_closed(self) -> None:
        """The abandoned channel is closed once it finally opens (NETCAT-6)."""
        async with target(listens) as far:
            connection = channel_connection(far.port, hang=True)
            record = session_record(connection, connect_timeout=0.05)

            with pytest.raises(
                ConnectionError,
                match=exact(check_failed("bastion did not connect within 0.05 seconds")),
            ):
                await validate_target(record, DB, DB_PORT)
            await connection.channels.released()

            assert connection.channels.closed() == [True]


class TestTheHeldChannel:
    """The channel Validate Target proved serves the first client only (SSHTUN-7)."""

    async def test_the_first_client_takes_it_and_a_later_refused_connection_still_warns(
        self,
    ) -> None:
        log, greeted = RunLog(), asyncio.Event()
        async with target(partial(greets, greeted)) as far:
            connection = channel_connection(far.port)
            registry, record = registered(connection)
            held = await validate_target(record, DB, DB_PORT)
            await sent(greeted)
            fwd = await start_forwarder(record, TUNNEL_ID, 0, DB, DB_PORT, log)
            port = fwd.get_port()
            registry.add_tunnel(SESSION_ID, TUNNEL_ID, fwd, port, "db:5432", held=held)
            connection.open_connection.side_effect = asyncssh.ChannelOpenError(
                2, "Connection refused"
            )
            try:
                async with client(port) as (reader, writer):
                    assert await read_exactly(reader, len(GREETING)) == GREETING
                    writer.write(b"ping")
                    writer.write_eof()
                    assert await far.settled(1) == [b"ping"]
                assert record["tunnels"][TUNNEL_ID]["held"] is None
                assert warnings_in(log) == []

                async with client(port) as (reader, _):
                    assert await read_to_end(reader) == b""
                    assert warnings_in(log) == [warn_line(port, REFUSED)]
                assert connection.open_connection.call_count == 2
            finally:
                registry.close_tunnel(TUNNEL_ID)
                fwd.close()

    @pytest.mark.parametrize("closing", ["tunnel", "session", "run"])
    async def test_closing_stops_the_listener_and_closes_an_unused_held_channel(
        self, closing: str
    ) -> None:
        async with target(listens) as far:
            connection = channel_connection(far.port)
            registry, record = registered(connection)
            held = await validate_target(record, DB, DB_PORT)
            fwd = await start_forwarder(record, TUNNEL_ID, 0, DB, DB_PORT, RunLog())
            port = fwd.get_port()
            registry.add_tunnel(SESSION_ID, TUNNEL_ID, fwd, port, "db:5432", held=held)
            closers: dict[str, Callable[[], Any]] = {
                "tunnel": partial(registry.close_tunnel, TUNNEL_ID),
                "session": partial(registry.close, SESSION_ID),
                "run": registry.close_all,
            }
            try:
                closers[closing]()

                assert connection.channels.closed() == [True]
                with pytest.raises(ConnectionRefusedError):
                    await asyncio.open_connection("127.0.0.1", port)
            finally:
                fwd.close()
