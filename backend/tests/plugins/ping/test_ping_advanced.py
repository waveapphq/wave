"""Ping's Advanced rows: IP version, TTL, Don't fragment, Source address (REQ-3.4.1.9, PING-7)."""

import errno
import os
import socket
from typing import Any

import pytest

from tests.plugins.ping.conftest import (
    DEFAULT_MTU,
    ROUTER,
    TARGET,
    TTL_EXCEEDED,
    FakeClock,
    FakeSocket,
    LogRecorder,
    exact,
    icmp_error,
    opener_for,
    outputs,
    ping_params,
    reply,
    resolve_to,
    row_map,
)
from wavecore.plugins import ping as ping_module
from wavecore.plugins._ping_core import icmp_error_text, run
from wavecore.plugins.ping import PingPlugin

HOST = "target.internal"
TARGET_V6 = "2001:db8::1"
SOURCE = "192.0.2.10"
TOO_LARGE_STATUS = f"too large, the path is {DEFAULT_MTU} bytes"
NOT_AN_IP = "Parameter 'source_address' must be an IP address"


async def run_with(
    params: dict[str, Any], sock: FakeSocket, log: LogRecorder, clock: FakeClock
) -> dict[str, Any]:
    """One run over the fake socket, answered as the block's outputs."""
    return outputs(await run(params, log, opener=opener_for(sock), clock=clock))


def oversize(clock: FakeClock) -> FakeSocket:
    """A socket that refuses every send the way Don't fragment makes the kernel refuse it."""
    return FakeSocket(clock=clock, send_error=OSError(errno.EMSGSIZE, "Message too long"))


def too_large_message(wire: int) -> str:
    return f"A {wire}-byte packet does not fit the path to {HOST}: the path is {DEFAULT_MTU} bytes"


async def never_run(*args: Any, **options: Any) -> dict[str, Any]:
    raise AssertionError("validate() must not reach the core")


class OrderedSocket(FakeSocket):
    """A fake socket that also records the order the core set the connection up in."""

    def __init__(self, *args: Any, **options: Any) -> None:
        super().__init__(*args, **options)
        self.calls: list[str] = []

    def bind(self, address: str) -> None:
        self.calls.append("bind")
        super().bind(address)

    def connect(self, address: str) -> None:
        self.calls.append("connect")
        super().connect(address)

    def set_ttl(self, ttl: int) -> None:
        self.calls.append("set_ttl")
        super().set_ttl(ttl)

    def set_dont_fragment(self) -> None:
        self.calls.append("set_dont_fragment")
        super().set_dont_fragment()


FAMILY_CASES = [
    pytest.param({}, [TARGET, TARGET_V6], TARGET, socket.AF_INET, id="absent-takes-the-first"),
    pytest.param(
        {"ip_version": "auto"}, [TARGET_V6, TARGET], TARGET_V6, socket.AF_INET6, id="auto-ipv6"
    ),
    pytest.param(
        {"ip_version": "auto"}, [TARGET, TARGET_V6], TARGET, socket.AF_INET, id="auto-ipv4"
    ),
    pytest.param(
        {"ip_version": "v4"}, [TARGET_V6, TARGET], TARGET, socket.AF_INET, id="v4-skips-ipv6"
    ),
    pytest.param(
        {"ip_version": "v6"}, [TARGET, TARGET_V6], TARGET_V6, socket.AF_INET6, id="v6-skips-ipv4"
    ),
]

NO_ADDRESS_CASES = [
    pytest.param("v4", [TARGET_V6], f"Host '{HOST}' has no IPv4 address", id="v4"),
    pytest.param("v6", [TARGET], f"Host '{HOST}' has no IPv6 address", id="v6"),
]


class TestIpVersion:
    """The address the block pings and the family the socket is opened with (PING-7)."""

    @pytest.mark.parametrize(("overrides", "resolved", "address", "family"), FAMILY_CASES)
    async def test_the_chosen_address_decides_the_socket_family(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        overrides: dict[str, Any],
        resolved: list[str],
        address: str,
        family: int,
    ) -> None:
        resolve_to(monkeypatch, *resolved)
        sock = FakeSocket([reply(1, source=address)], clock=clock)

        out = await run_with(ping_params(count=1, **overrides), sock, log, clock)

        assert (sock.family, sock.connected) == (family, address)
        assert out["success"] is True

    @pytest.mark.parametrize(("version", "resolved", "message"), NO_ADDRESS_CASES)
    async def test_a_forced_family_without_an_address_fails_before_the_socket_opens(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        version: str,
        resolved: list[str],
        message: str,
    ) -> None:
        resolve_to(monkeypatch, *resolved)
        sock = FakeSocket([reply(1)], clock=clock)
        params = ping_params(count=1, ip_version=version, on_error="record")

        out = await run_with(params, sock, log, clock)

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Unresolved")
        assert out["__block_warning"] is True
        assert (sock.family, sock.connected, sock.sent) == (None, None, [])

    @pytest.mark.parametrize(("version", "resolved", "message"), NO_ADDRESS_CASES)
    async def test_a_forced_family_without_an_address_raises_under_fail(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        version: str,
        resolved: list[str],
        message: str,
    ) -> None:
        resolve_to(monkeypatch, *resolved)
        sock = FakeSocket([reply(1)], clock=clock)

        with pytest.raises(ValueError, match=exact(message)):
            await run_with(ping_params(count=1, ip_version=version), sock, log, clock)

        assert sock.family is None


class TestTtl:
    """The TTL row, and the hop-limit error a router answers with (PING-7, PING-15)."""

    async def test_the_ttl_is_set_when_the_row_holds_one(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = FakeSocket([reply(1)], clock=clock)

        await run_with(ping_params(count=1, ttl=5), sock, log, clock)

        assert sock.ttl == 5

    @pytest.mark.parametrize(
        "overrides",
        [pytest.param({}, id="absent"), pytest.param({"ttl": None}, id="none")],
    )
    async def test_no_ttl_is_set_when_the_row_is_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        overrides: dict[str, Any],
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = FakeSocket([reply(1)], clock=clock)

        await run_with(ping_params(count=1, **overrides), sock, log, clock)

        assert sock.ttl is None

    async def test_a_hop_limit_error_carries_the_router_in_the_status(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = FakeSocket([icmp_error(1, text=TTL_EXCEEDED, source=ROUTER)], clock=clock)
        params = ping_params(count=1, ttl=1, on_error="record")

        out = await run_with(params, sock, log, clock)

        assert row_map(out["replies"]) == {
            "seq": 1,
            "source": ROUTER,
            "bytes": 0,
            "ttl": 0,
            "time_ms": 0.0,
            "status": f"{TTL_EXCEEDED} from {ROUTER}",
        }
        assert row_map(out["summary"])["received"] == 0

    async def test_an_error_from_an_unknown_sender_reads_without_a_source(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = FakeSocket([icmp_error(1, text=TTL_EXCEEDED, source="")], clock=clock)
        params = ping_params(count=1, ttl=1, on_error="record")

        out = await run_with(params, sock, log, clock)

        row = row_map(out["replies"])
        assert (row["status"], row["source"]) == (TTL_EXCEEDED, "")


class TestIcmpErrorText:
    """Every ICMP error reads the way ping's own output reads (PING-15)."""

    @pytest.mark.parametrize(
        ("icmp_type", "code", "text"),
        [
            pytest.param(3, 0, "Destination Net Unreachable", id="net"),
            pytest.param(3, 1, "Destination Host Unreachable", id="host"),
            pytest.param(3, 2, "Destination Protocol Unreachable", id="protocol"),
            pytest.param(3, 3, "Destination Port Unreachable", id="port"),
            pytest.param(3, 4, "Frag needed and DF set", id="frag-needed"),
            pytest.param(3, 13, "Communication prohibited by filter", id="prohibited"),
            pytest.param(11, 0, "Time to live exceeded", id="ttl-exceeded"),
            pytest.param(11, 1, "Fragment reassembly time exceeded", id="reassembly"),
            pytest.param(5, 7, "ICMP type 5 code 7", id="unknown"),
        ],
    )
    def test_the_wording_of_each_type_and_code(self, icmp_type: int, code: int, text: str) -> None:
        assert icmp_error_text(icmp_type, code) == text


class TestDontFragment:
    """The Don't fragment row, and the packet the path refuses (PING-7, PING-15)."""

    @pytest.mark.parametrize(
        ("overrides", "expected"),
        [
            pytest.param({"dont_fragment": True}, True, id="on"),
            pytest.param({"dont_fragment": False}, False, id="off"),
            pytest.param({}, False, id="absent"),
        ],
    )
    async def test_the_option_is_set_only_when_the_row_is_on(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        overrides: dict[str, Any],
        expected: bool,
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = FakeSocket([reply(1)], clock=clock)

        await run_with(ping_params(count=1, **overrides), sock, log, clock)

        assert sock.dont_fragment is expected

    @pytest.mark.parametrize(
        ("overrides", "resolved", "wire"),
        [
            pytest.param({}, TARGET, 84, id="default-over-ipv4"),
            pytest.param({"packet_size": 100}, TARGET, 128, id="sized-over-ipv4"),
            pytest.param({}, TARGET_V6, 104, id="default-over-ipv6"),
        ],
    )
    async def test_a_refused_packet_fails_with_the_wire_size_and_the_path(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        overrides: dict[str, Any],
        resolved: str,
        wire: int,
    ) -> None:
        resolve_to(monkeypatch, resolved)
        sock = oversize(clock)
        params = ping_params(count=1, dont_fragment=True, **overrides)

        with pytest.raises(ValueError, match=exact(too_large_message(wire))):
            await run_with(params, sock, log, clock)

        assert sock.closed is True

    async def test_a_recorded_refusal_keeps_the_summary_and_the_replies_row(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = oversize(clock)
        params = ping_params(count=1, dont_fragment=True, on_error="record")

        out = await run_with(params, sock, log, clock)

        assert (out["success"], out["error"]) == (False, too_large_message(84))
        assert (out["reason"], out["__block_warning"]) == ("TooLarge", True)
        assert row_map(out["replies"]) == {
            "seq": 1,
            "source": "",
            "bytes": 0,
            "ttl": 0,
            "time_ms": 0.0,
            "status": TOO_LARGE_STATUS,
        }
        assert row_map(out["summary"]) == {
            "sent": 1,
            "received": 0,
            "loss_percent": 100.0,
            "rtt_min_ms": 0.0,
            "rtt_avg_ms": 0.0,
            "rtt_max_ms": 0.0,
            "rtt_mdev_ms": 0.0,
        }


class TestSourceAddress:
    """The Source address row binds by address and never by interface name (PING-8)."""

    @pytest.mark.parametrize(
        "written",
        [pytest.param(SOURCE, id="as-written"), pytest.param(f"  {SOURCE} ", id="with-spaces")],
    )
    async def test_the_address_is_bound_before_the_socket_is_connected(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        written: str,
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = OrderedSocket([reply(1)], clock=clock)
        params = ping_params(count=1, source_address=written, ttl=9, dont_fragment=True)

        await run_with(params, sock, log, clock)

        assert sock.bound == SOURCE
        assert sock.calls == ["bind", "connect", "set_ttl", "set_dont_fragment"]

    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({}, id="absent"),
            pytest.param({"source_address": None}, id="none"),
            pytest.param({"source_address": ""}, id="blank"),
        ],
    )
    async def test_nothing_is_bound_when_the_row_is_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        overrides: dict[str, Any],
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = OrderedSocket([reply(1)], clock=clock)

        await run_with(ping_params(count=1, **overrides), sock, log, clock)

        assert sock.bound is None
        assert sock.calls == ["connect"]

    async def test_a_refused_bind_fails_with_the_operating_system_text(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        refusal = OSError(errno.EADDRNOTAVAIL, "Cannot assign requested address")
        sock = FakeSocket([reply(1)], clock=clock, bind_error=refusal)
        message = f"Cannot send from source address '{SOURCE}': {os.strerror(errno.EADDRNOTAVAIL)}"
        params = ping_params(count=1, source_address=SOURCE, on_error="record")

        out = await run_with(params, sock, log, clock)

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Source")
        assert (sock.sent, sock.closed) == ([], True)

    async def test_a_refused_bind_raises_under_fail(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        refusal = OSError(errno.EADDRNOTAVAIL, "Cannot assign requested address")
        sock = FakeSocket([reply(1)], clock=clock, bind_error=refusal)
        message = f"Cannot send from source address '{SOURCE}': {os.strerror(errno.EADDRNOTAVAIL)}"

        with pytest.raises(ValueError, match=exact(message)):
            await run_with(ping_params(count=1, source_address=SOURCE), sock, log, clock)

        assert sock.sent == []

    async def test_an_address_that_is_not_an_ip_is_refused_before_the_block_runs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(ping_module._ping_core, "run", never_run)

        with pytest.raises(ValueError, match=exact(NOT_AN_IP)):
            await PingPlugin().validate(ping_params(source_address="eth0"))
