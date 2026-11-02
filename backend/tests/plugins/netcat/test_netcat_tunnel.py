"""Netcat and the run's SSH tunnels (REQ-3.4.1.9, REQ-3.3.4.3, NETCAT-9, NETCAT-18)."""

import asyncio
import re
from collections.abc import Awaitable, Callable
from typing import Any
from unittest.mock import AsyncMock, MagicMock, call

import asyncssh
import pytest

from tests.plugins.netcat.conftest import (
    FAST,
    SSH_HOST,
    TUNNEL_SESSION,
    Listener,
    LogRecorder,
    free_port,
    netcat_context,
    netcat_params,
    resolve_to,
    tunnel_registry,
)
from tests.plugins.ssh.conftest import channel_connection
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins._ssh_session import open_tunnel_stream
from wavecore.plugins.netcat import NetcatPlugin

Listen = Callable[..., Awaitable[Listener]]
FAR = "db.internal:5432"
UNTUNNELED, FIRST_TUNNEL, SECOND_TUNNEL = 40401, 40402, 40403


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


async def opening(task: asyncio.Task[Any], connection: MagicMock) -> None:
    """Wait (1 s bound) until the block opens its channel; a block that ended re-raises."""
    async with asyncio.timeout(1):
        while not connection.open_connection.call_count:
            if task.done():
                task.result()
                pytest.fail("the block ended without opening the channel")
            await asyncio.sleep(0.001)


async def run_block(params: dict[str, Any], log: LogRecorder, **optional: Any) -> dict[str, Any]:
    return await NetcatPlugin().execute(netcat_context(params, log, **optional))


def rows(result: dict[str, Any]) -> list[list[Any]]:
    """Results rows without the measured time_ms cell."""
    table = result["results"]
    keep = [index for index, name in enumerate(table.col_names()) if name != "time_ms"]
    return [[row[index] for index in keep] for row in table]


def tunnel_line(port: int, far: str) -> tuple[str, str]:
    return ("INFO", f"SSH tunnel detected on local port {port}: testing {far} from {SSH_HOST}")


def udp_refusal(port: int) -> str:
    return (
        f"SSH tunnel detected on local port {port}: "
        "SSH tunnels carry TCP only, so UDP cannot go through one"
    )


def plain_route(case: str, port: int, connection: MagicMock) -> dict[str, Any]:
    """The context keys of a run whose port `port` must not go through a tunnel."""
    if case == "no registry":
        return {}
    if case == "registry None":
        return {"ssh_session_registry": None}
    registry = tunnel_registry(
        {free_port() if case == "port not tunneled" else port: FAR}, connection
    )
    if case == "tunnel closed":
        assert registry.close_tunnel(f"t{port}") is True
    return {"ssh_session_registry": registry}


class TestTunneledTcpPort:
    """NETCAT-9: loopback plus a tunnel's Local Port tests the far port through the channel."""

    @pytest.mark.parametrize(
        ("host", "destination", "far_call"),
        [
            ("127.0.0.1", FAR, call("db.internal", 5432)),
            ("localhost", FAR, call("db.internal", 5432)),
            ("  localhost  ", FAR, call("db.internal", 5432)),
            ("127.0.0.1", "fd00::5:5432", call("fd00::5", 5432)),
        ],
        ids=["loopback address", "localhost", "trimmed localhost", "IPv6 far host"],
    )
    async def test_the_far_port_state_is_reported(
        self,
        host: str,
        destination: str,
        far_call: Any,
        listen: Listen,
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Open is the far state; the free local port is unused; the Host still resolves once."""
        far = await listen("tcp-echo")
        asked = resolve_to(monkeypatch, "127.0.0.1")
        local = free_port()
        connection = channel_connection(far.port)
        registry = tunnel_registry({local: destination}, connection)

        result = await run_block(
            netcat_params(local, host=host), log, ssh_session_registry=registry
        )

        assert rows(result) == [[local, "tcp", "open", ""]]
        assert result["success"] is True
        assert connection.open_connection.await_args_list == [far_call]
        assert connection.channels.closed() == [True]
        assert asked == [host.strip()]
        assert log == [
            ("INFO", f"Checking {host.strip()} port {local} over TCP"),
            tunnel_line(local, destination),
            ("INFO", f"Port {local}/tcp open"),
        ]

    async def test_validate_target_hands_its_held_channel_to_netcat(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        """SSHTUN-7: Netcat tests the channel the check proved; no second channel opens."""
        far = await listen("tcp-echo")
        local = free_port()
        connection = channel_connection(far.port)
        registry = SSHSessionRegistry()
        registry.register(
            TUNNEL_SESSION, connection, None, SSH_HOST, None, None, connect_timeout=30
        )
        record = registry.get(TUNNEL_SESSION)
        held = await open_tunnel_stream(record, "db.internal", 5432)
        try:
            registry.add_tunnel(TUNNEL_SESSION, f"t{local}", MagicMock(), local, FAR, held=held)
            tunnel = record["tunnels"][f"t{local}"]

            result = await run_block(netcat_params(local), log, ssh_session_registry=registry)

            assert rows(result) == [[local, "tcp", "open", ""]]
            assert connection.open_connection.call_count == 1
            assert tunnel["held"] is None
            assert connection.channels.closed() == [True]
            assert log == [
                ("INFO", f"Checking 127.0.0.1 port {local} over TCP"),
                tunnel_line(local, FAR),
                ("INFO", f"Port {local}/tcp open"),
            ]
        finally:
            held[1].close()
            registry.close_all()

    async def test_a_refused_channel_is_closed_with_the_ssh_server_words(
        self, log: LogRecorder
    ) -> None:
        """Record keeps the SSH server's reason; the message is the Closed one (NETCAT-17)."""
        local = free_port()
        connection = channel_connection(refuse="open failed: connect refused")
        registry = tunnel_registry({local: FAR}, connection)
        message = f"Port {local} on 127.0.0.1 is closed: open failed: connect refused"

        result = await run_block(
            netcat_params(local, on_error="record"), log, ssh_session_registry=registry
        )

        assert rows(result) == [[local, "tcp", "closed", "open failed: connect refused"]]
        assert (result["success"], result["error"], result["reason"]) == (False, message, "Closed")
        assert log == [
            ("INFO", f"Checking 127.0.0.1 port {local} over TCP"),
            tunnel_line(local, FAR),
            ("INFO", f"Port {local}/tcp closed: open failed: connect refused"),
            ("WARN", f"Netcat failed (Closed): {message}"),
        ]

    async def test_a_refused_channel_fails_the_block(self, log: LogRecorder) -> None:
        """Under fail the Closed message carries the SSH server's reason and no WARN is written."""
        local = free_port()
        connection = channel_connection(refuse="open failed: connect refused")
        registry = tunnel_registry({local: FAR}, connection)
        message = f"Port {local} on 127.0.0.1 is closed: open failed: connect refused"

        with pytest.raises(ValueError, match=exact(message)):
            await run_block(netcat_params(local), log, ssh_session_registry=registry)

        assert log == [
            ("INFO", f"Checking 127.0.0.1 port {local} over TCP"),
            tunnel_line(local, FAR),
            ("INFO", f"Port {local}/tcp closed: open failed: connect refused"),
        ]

    async def test_one_channel_per_port_whatever_the_host_resolves_to(
        self, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A tunneled port is dialed once, never once per resolved address."""
        resolve_to(monkeypatch, "127.0.0.1", "127.0.0.2")
        local = free_port()
        connection = channel_connection(refuse="open failed: connect refused")
        registry = tunnel_registry({local: FAR}, connection)

        result = await run_block(
            netcat_params(local, host="localhost", on_error="record"),
            log,
            ssh_session_registry=registry,
        )

        assert rows(result) == [[local, "tcp", "closed", "open failed: connect refused"]]
        assert connection.open_connection.await_args_list == [call("db.internal", 5432)]

    async def test_a_channel_not_opened_within_timeout_is_timed_out(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The Timeout bounds the channel open, and the late channel is closed (NETCAT-6)."""
        far = await listen("tcp-echo")
        resolve_to(monkeypatch, "127.0.0.1")
        local = free_port()
        connection = channel_connection(far.port, hang=True)
        registry = tunnel_registry({local: FAR}, connection)

        result = await run_block(
            netcat_params(local, timeout=FAST, on_error="record"),
            log,
            ssh_session_registry=registry,
        )

        assert rows(result) == [[local, "tcp", "timed out", "No answer within 0.05 seconds"]]
        assert result["reason"] == "Timeout"
        await connection.channels.released()
        assert connection.channels.closed() == [True]

    async def test_stop_while_opening_the_channel_ends_the_block_at_once(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        """Stop never waits on a channel still opening, and that channel is closed (NETCAT-6)."""
        far = await listen("tcp-echo")
        local = free_port()
        connection = channel_connection(far.port, hang=True)
        registry = tunnel_registry({local: FAR}, connection)
        params = netcat_params(local, timeout=10)
        task = asyncio.create_task(run_block(params, log, ssh_session_registry=registry))
        await opening(task, connection)

        task.cancel()
        done, _ = await asyncio.wait({task}, timeout=1)

        assert done == {task}
        with pytest.raises(asyncio.CancelledError):
            task.result()
        await connection.channels.released()
        assert connection.channels.closed() == [True]

    async def test_talk_data_flows_through_the_channel(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        """The payload reaches the far port and its reply comes back."""
        far = await listen("tcp-echo")
        local = free_port()
        connection = channel_connection(far.port)
        registry = tunnel_registry({local: FAR}, connection)
        params = netcat_params(local, mode="talk", text="ping", close_after_send=True)

        result = await run_block(params, log, ssh_session_registry=registry)

        assert result["reply"] == "ping"
        assert rows(result) == [[local, "tcp", "open", "", "ping"]]
        assert connection.channels.closed() == [True]
        assert await far.settled(1) == [b"ping"]

    async def test_a_range_tunnels_only_its_tunnel_ports(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        """One INFO line for the tunneled port; rows keep the written order (NETCAT-2)."""
        plain, far = await listen("tcp-echo"), await listen("tcp-echo")
        local = free_port()
        connection = channel_connection(far.port)
        registry = tunnel_registry({local: FAR}, connection)
        params = netcat_params(ports="range", port_range=f"{local}, {plain.port}")

        result = await run_block(params, log, ssh_session_registry=registry)

        assert rows(result) == [[local, "tcp", "open", ""], [plain.port, "tcp", "open", ""]]
        assert connection.open_connection.await_args_list == [call("db.internal", 5432)]
        assert connection.channels.closed() == [True]
        assert log == [
            ("INFO", "Checking 2 ports on 127.0.0.1 over TCP"),
            tunnel_line(local, FAR),
            ("DEBUG", f"Port {local}/tcp open"),
            ("DEBUG", f"Port {plain.port}/tcp open"),
            ("INFO", "2 open of 2"),
        ]


class LosesTheConnection:
    """A channel reader that hands over `first`, then reports the SSH connection lost."""

    def __init__(self, first: bytes) -> None:
        self.pending = [first]

    async def read(self, size: int) -> bytes:
        if self.pending:
            return self.pending.pop()
        raise asyncssh.ConnectionLost("Connection lost")


class TestALostSSHConnection:
    """NETCAT-9, NETCAT-7: the SSH connection lost mid-exchange ends the reply, not the block."""

    @pytest.mark.parametrize(
        ("overrides", "drain", "sent"),
        [
            ({"send": "nothing"}, AsyncMock(), 0),
            ({"text": "ping"}, AsyncMock(side_effect=asyncssh.ConnectionLost("gone")), 0),
        ],
        ids=["while reading", "while sending"],
    )
    async def test_the_reply_so_far_is_recorded(
        self, overrides: dict[str, Any], drain: AsyncMock, sent: int, log: LogRecorder
    ) -> None:
        local = free_port()
        writer = MagicMock(drain=drain)
        reader = LosesTheConnection(b"hello ")
        connection = MagicMock(open_connection=AsyncMock(return_value=(reader, writer)))
        registry = tunnel_registry({local: FAR}, connection)
        params = netcat_params(local, mode="talk", on_error="record", **overrides)

        result = await run_block(params, log, ssh_session_registry=registry)

        assert (result["success"], result["reply"]) == (True, "hello ")
        assert rows(result) == [[local, "tcp", "open", "", "hello "]]
        assert writer.close.call_count == 1
        assert log == [
            ("INFO", f"Talking to 127.0.0.1 port {local} over TCP"),
            tunnel_line(local, FAR),
            ("INFO", f"Port {local}/tcp open"),
            ("INFO", f"Sent {sent} bytes, received 6 bytes"),
        ]

    async def test_a_session_already_gone_closes_the_port_with_the_library_words(
        self, log: LogRecorder
    ) -> None:
        local = free_port()
        lost = AsyncMock(side_effect=asyncssh.ConnectionLost("Connection lost"))
        registry = tunnel_registry({local: FAR}, MagicMock(open_connection=lost))
        message = f"Port {local} on 127.0.0.1 is closed: Connection lost"

        result = await run_block(
            netcat_params(local, on_error="record"), log, ssh_session_registry=registry
        )

        assert rows(result) == [[local, "tcp", "closed", "Connection lost"]]
        assert (result["success"], result["error"], result["reason"]) == (False, message, "Closed")


class TestPlainDial:
    """NETCAT-9: every other host, port or run dials the port itself."""

    @pytest.mark.parametrize(
        ("case", "host"),
        [
            ("other host", "db.example"),
            ("other host", "127.0.0.2"),
            ("port not tunneled", "127.0.0.1"),
            ("tunnel closed", "127.0.0.1"),
            ("no registry", "127.0.0.1"),
            ("registry None", "127.0.0.1"),
        ],
    )
    async def test_the_port_is_dialed_without_a_channel(
        self,
        case: str,
        host: str,
        listen: Listen,
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """No lookup match means no channel and no tunnel line."""
        echo = await listen("tcp-echo")
        resolve_to(monkeypatch, "127.0.0.1")
        connection = channel_connection()
        optional = plain_route(case, echo.port, connection)

        result = await run_block(netcat_params(echo.port, host=host), log, **optional)

        assert rows(result) == [[echo.port, "tcp", "open", ""]]
        assert connection.open_connection.call_count == 0
        assert log == [
            ("INFO", f"Checking {host} port {echo.port} over TCP"),
            ("INFO", f"Port {echo.port}/tcp open"),
        ]

    async def test_udp_to_another_host_is_dialed_whatever_the_tunnels(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The Tunnel refusal is for a loopback Host only; any other Host dials over UDP."""
        echo = await listen("udp-echo")
        resolve_to(monkeypatch, "127.0.0.1")
        connection = channel_connection()
        registry = tunnel_registry({echo.port: FAR}, connection)
        params = netcat_params(echo.port, host="db.example", protocol="udp")

        result = await run_block(params, log, ssh_session_registry=registry)

        assert rows(result) == [[echo.port, "udp", "open", ""]]
        assert result["success"] is True
        assert connection.open_connection.call_count == 0
        assert log == [
            ("INFO", f"Checking db.example port {echo.port} over UDP"),
            ("INFO", f"Port {echo.port}/udp open"),
        ]


class TestUdpToATunnelPort:
    """NETCAT-18: UDP to a tunnel's Local Port fails with reason Tunnel before any dial."""

    @pytest.mark.parametrize(
        ("overrides", "start"),
        [
            ({"mode": "check"}, "Checking 127.0.0.1 port {port} over UDP"),
            ({"mode": "talk", "text": "ping"}, "Talking to 127.0.0.1 port {port} over UDP"),
        ],
        ids=["check", "talk"],
    )
    async def test_record_leaves_results_empty_after_the_start_line(
        self, overrides: dict[str, Any], start: str, listen: Listen, log: LogRecorder
    ) -> None:
        """Nothing is dialed, no channel opens, and the local listener hears nothing."""
        silent = await listen("udp-silent")
        connection = channel_connection()
        registry = tunnel_registry({silent.port: FAR}, connection)
        params = netcat_params(
            silent.port, protocol="udp", timeout=FAST, on_error="record", **overrides
        )
        message = udp_refusal(silent.port)

        result = await run_block(params, log, ssh_session_registry=registry)

        assert (result["success"], result["error"], result["reason"]) == (False, message, "Tunnel")
        assert rows(result) == []
        assert log == [
            ("INFO", start.format(port=silent.port)),
            ("WARN", f"Netcat failed (Tunnel): {message}"),
        ]
        assert connection.open_connection.call_count == 0
        assert silent.received == []

    async def test_fail_raises_the_tunnel_message(self, listen: Listen, log: LogRecorder) -> None:
        """Under fail the block error is the Tunnel message."""
        silent = await listen("udp-silent")
        connection = channel_connection()
        registry = tunnel_registry({silent.port: FAR}, connection)
        params = netcat_params(silent.port, protocol="udp", timeout=FAST)

        with pytest.raises(ValueError, match=exact(udp_refusal(silent.port))):
            await run_block(params, log, ssh_session_registry=registry)

        assert connection.open_connection.call_count == 0
        assert silent.received == []

    @pytest.mark.parametrize(
        "port_range",
        [f"{SECOND_TUNNEL}, {FIRST_TUNNEL}", f"{UNTUNNELED}, {SECOND_TUNNEL}, {FIRST_TUNNEL}"],
        ids=["tunnel ports only", "untunneled port first"],
    )
    async def test_the_message_names_the_first_tunnel_port_in_range_order(
        self, port_range: str, log: LogRecorder
    ) -> None:
        """NETCAT-2 order decides, not the order the tunnels were opened in."""
        tunnels = {FIRST_TUNNEL: FAR, SECOND_TUNNEL: "cache.internal:6379"}
        registry = tunnel_registry(tunnels, channel_connection())
        params = netcat_params(ports="range", port_range=port_range, protocol="udp", timeout=FAST)

        with pytest.raises(ValueError, match=exact(udp_refusal(SECOND_TUNNEL))):
            await run_block(params, log, ssh_session_registry=registry)

    async def test_a_range_is_refused_before_its_first_port_is_dialed(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        """An untunneled port written first is never dialed ahead of the Tunnel refusal."""
        silent = await listen("udp-silent")
        connection = channel_connection()
        registry = tunnel_registry({FIRST_TUNNEL: FAR, SECOND_TUNNEL: FAR}, connection)
        params = netcat_params(
            ports="range",
            port_range=f"{silent.port}, {SECOND_TUNNEL}, {FIRST_TUNNEL}",
            protocol="udp",
            timeout=FAST,
            on_error="record",
        )
        message = udp_refusal(SECOND_TUNNEL)

        result = await run_block(params, log, ssh_session_registry=registry)

        assert (result["success"], result["error"], result["reason"]) == (False, message, "Tunnel")
        assert rows(result) == []
        assert log == [
            ("INFO", "Checking 3 ports on 127.0.0.1 over UDP"),
            ("WARN", f"Netcat failed (Tunnel): {message}"),
        ]
        assert connection.open_connection.call_count == 0
        assert silent.received == []


class TunnelLookupSpy:
    """Wraps the shared tunnel lookup and records (host, port, registry) per call."""

    def __init__(self) -> None:
        from wavecore.plugins import _ssh_session

        self.lookup = _ssh_session.resolve_tunnel
        self.calls: list[tuple[str, int, Any]] = []

    def __call__(self, host: str, port: int, registry: Any) -> Any:
        self.calls.append((host, port, registry))
        return self.lookup(host, port, registry)


@pytest.fixture
def lookup_spy(monkeypatch: pytest.MonkeyPatch) -> TunnelLookupSpy:
    from wavecore.plugins import netcat

    spy = TunnelLookupSpy()
    monkeypatch.setattr(netcat, "resolve_tunnel", spy)
    return spy


class TestTheSharedTunnelLookup:
    """NETCAT-9, SQL-15: Netcat finds its tunnels through the lookup the SQL block shares."""

    def test_netcat_binds_the_shared_lookup_by_name(self) -> None:
        from wavecore.plugins import _ssh_session, netcat

        assert netcat.resolve_tunnel is _ssh_session.resolve_tunnel

    async def test_every_port_of_a_range_is_looked_up_once(
        self, listen: Listen, log: LogRecorder, lookup_spy: TunnelLookupSpy
    ) -> None:
        plain, far = await listen("tcp-echo"), await listen("tcp-echo")
        local = free_port()
        connection = channel_connection(far.port)
        registry = tunnel_registry({local: FAR}, connection)
        params = netcat_params(ports="range", port_range=f"{local}, {plain.port}")

        result = await run_block(params, log, ssh_session_registry=registry)

        assert sorted(lookup_spy.calls, key=lambda looked_up: looked_up[1]) == sorted(
            [("127.0.0.1", local, registry), ("127.0.0.1", plain.port, registry)],
            key=lambda looked_up: looked_up[1],
        )
        assert rows(result) == [[local, "tcp", "open", ""], [plain.port, "tcp", "open", ""]]
        assert connection.open_connection.await_args_list == [call("db.internal", 5432)]
        assert tunnel_line(local, FAR) in log

    async def test_a_udp_port_on_a_tunnel_is_looked_up_before_the_refusal(
        self, log: LogRecorder, lookup_spy: TunnelLookupSpy
    ) -> None:
        local = free_port()
        connection = channel_connection()
        registry = tunnel_registry({local: FAR}, connection)
        params = netcat_params(local, protocol="udp", timeout=FAST)

        with pytest.raises(ValueError, match=exact(udp_refusal(local))):
            await run_block(params, log, ssh_session_registry=registry)

        assert lookup_spy.calls == [("127.0.0.1", local, registry)]
        assert connection.open_connection.call_count == 0
