"""The echo socket wrapper and the ancillary data it reads (REQ-3.4.1.9, PING-4, PING-15).

The wrapper is blind to the protocol underneath it, so a loopback UDP socket drives every
method here; no test opens an ICMP socket, because the backend CI container refuses one.
"""

import asyncio
import errno
import socket
import struct
import sys
import time
from collections.abc import Callable, Iterator
from typing import Any, NamedTuple

import pytest

from tests.plugins.ping.conftest import LOOPBACK, fire_timers_early
from wavecore.plugins._ping_core import (
    EchoSocket,
    Received,
    _extended_error,
    _hop_limit,
    _offender,
    _peer,
    _wake,
)

UNASSIGNED = "203.0.113.5"
ROUTER = "198.51.100.1"
ROUTER_V6 = "2001:db8::1"
# Nothing can bind port 1 without privilege, so the kernel always refuses a datagram to it.
CLOSED_PORT = 1
PORT_UNREACHABLE = "Destination Port Unreachable"
# Linux IP-level options the socket module does not expose.
IP_RECVERR = 11
IPV6_RECVERR = 25
IP_RECVTTL = 12
IP_MTU_DISCOVER = 10
PMTUDISC_DO = 2
SO_EE_ORIGIN_ICMP = 2
SO_EE_ORIGIN_ICMP6 = 3


class Wire(NamedTuple):
    """One UDP socket and the wrapper under test around it."""

    raw: socket.socket
    echo: EchoSocket


def error_cmsg(
    icmp_type: int, code: int, offender: str, *, v6: bool = False
) -> tuple[int, int, bytes]:
    """One error-queue control message: the extended error, then the sockaddr behind it."""
    origin = SO_EE_ORIGIN_ICMP6 if v6 else SO_EE_ORIGIN_ICMP
    header = struct.pack("=IBBBBII", errno.EHOSTUNREACH, origin, icmp_type, code, 0, 0, 0)
    if v6:
        sockaddr = struct.pack("=HHI", socket.AF_INET6, 0, 0)
        packed = socket.inet_pton(socket.AF_INET6, offender)
        return socket.IPPROTO_IPV6, IPV6_RECVERR, header + sockaddr + packed
    sockaddr = struct.pack("=HH", socket.AF_INET, 0)
    return (
        socket.IPPROTO_IP,
        IP_RECVERR,
        header + sockaddr + socket.inet_pton(socket.AF_INET, offender),
    )


def hop_cmsg(value: int, *, v6: bool = False) -> tuple[int, int, bytes]:
    """The control message a reply carries its TTL or hop limit in."""
    if v6:
        return socket.IPPROTO_IPV6, socket.IPV6_HOPLIMIT, value.to_bytes(4, sys.byteorder)
    return socket.IPPROTO_IP, socket.IP_TTL, value.to_bytes(4, sys.byteorder)


def deadline(seconds: float) -> float:
    """The monotonic instant `seconds` from now, which is what receive() bounds against."""
    return time.monotonic() + seconds


@pytest.fixture
def wire() -> Iterator[Callable[..., Wire]]:
    """Builds loopback UDP sockets under the wrapper, and closes every one afterward."""
    made: list[socket.socket] = []

    def build(peer: tuple[str, int] | None = None) -> Wire:
        raw = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        made.append(raw)
        if peer is not None:
            raw.connect(peer)
        return Wire(raw, EchoSocket(raw))

    yield build
    for raw in made:
        raw.close()


class TestTheSocketItWraps:
    """What the wrapper turns on before a single request goes out."""

    def test_the_socket_is_left_non_blocking(self, wire: Callable[..., Wire]) -> None:
        assert wire().raw.getblocking() is False

    def test_the_error_queue_and_the_hop_limit_are_turned_on(
        self, wire: Callable[..., Wire]
    ) -> None:
        raw = wire().raw
        assert raw.getsockopt(socket.IPPROTO_IP, IP_RECVERR) == 1
        assert raw.getsockopt(socket.IPPROTO_IP, IP_RECVTTL) == 1

    def test_closing_releases_the_descriptor(self, wire: Callable[..., Wire]) -> None:
        raw, echo = wire()
        echo.close()
        assert raw.fileno() == -1


class TestAddressing:
    """Binding the source address and connecting to the target (PING-8)."""

    def test_bind_takes_the_address_and_leaves_the_port_to_the_kernel(
        self, wire: Callable[..., Wire]
    ) -> None:
        raw, echo = wire()
        echo.bind(LOOPBACK)
        address, port = raw.getsockname()
        assert (address, port > 0) == (LOOPBACK, True)

    def test_an_address_the_machine_does_not_have_is_refused(
        self, wire: Callable[..., Wire]
    ) -> None:
        echo = wire().echo
        with pytest.raises(OSError) as refusal:
            echo.bind(UNASSIGNED)
        assert refusal.value.errno == errno.EADDRNOTAVAIL

    def test_connect_settles_the_address_the_requests_leave_from(
        self, wire: Callable[..., Wire]
    ) -> None:
        raw, echo = wire()
        assert raw.getsockname()[0] == "0.0.0.0"
        echo.connect(LOOPBACK)
        assert raw.getsockname()[0] == LOOPBACK


class TestSocketOptions:
    """The two Advanced rows that reach the socket, and the path size it reports (PING-7)."""

    def test_the_hop_limit_is_set_on_the_socket(self, wire: Callable[..., Wire]) -> None:
        raw, echo = wire()
        echo.set_ttl(7)
        assert raw.getsockopt(socket.IPPROTO_IP, socket.IP_TTL) == 7

    def test_dont_fragment_asks_the_kernel_to_discover_the_path(
        self, wire: Callable[..., Wire]
    ) -> None:
        raw, echo = wire()
        echo.set_dont_fragment()
        assert raw.getsockopt(socket.IPPROTO_IP, IP_MTU_DISCOVER) == PMTUDISC_DO

    def test_the_path_mtu_is_the_size_the_kernel_found(
        self, wire: Callable[..., Wire], peer: socket.socket
    ) -> None:
        echo = wire(peer.getsockname()).echo
        assert echo.path_mtu() > 0


class TestSendingAndReading:
    """One packet out to the peer, and what comes back for it (PING-10)."""

    async def test_a_sent_packet_reaches_the_peer_whole(
        self, wire: Callable[..., Wire], peer: socket.socket
    ) -> None:
        raw, echo = wire(peer.getsockname())

        await echo.send(b"echo-request")

        assert peer.recvfrom(1024) == (b"echo-request", raw.getsockname())

    async def test_a_reply_carries_its_message_hop_limit_and_source(
        self, wire: Callable[..., Wire], peer: socket.socket
    ) -> None:
        raw, echo = wire(peer.getsockname())
        peer.setsockopt(socket.IPPROTO_IP, socket.IP_TTL, 33)
        peer.sendto(b"echo-reply", raw.getsockname())

        assert await echo.receive(deadline(5)) == Received(b"echo-reply", 33, LOOPBACK, "")

    async def test_nothing_to_read_answers_none_once_the_wait_runs_out(
        self, wire: Callable[..., Wire], peer: socket.socket
    ) -> None:
        echo = wire(peer.getsockname()).echo

        assert await echo.receive(deadline(0.05)) is None

    async def test_a_loop_timer_that_fires_early_never_ends_the_wait_before_the_deadline(
        self, wire: Callable[..., Wire], peer: socket.socket, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fire_timers_early(monkeypatch)
        echo = wire(peer.getsockname()).echo
        until = deadline(0.05)

        assert await echo.receive(until) is None
        assert time.monotonic() >= until

    async def test_a_wait_that_ran_out_leaves_the_socket_readable_again(
        self, wire: Callable[..., Wire], peer: socket.socket
    ) -> None:
        raw, echo = wire(peer.getsockname())
        assert await echo.receive(deadline(0.05)) is None
        peer.sendto(b"late", raw.getsockname())

        received = await echo.receive(deadline(5))

        assert received is not None and received.message == b"late"


class TestTheErrorQueue:
    """A packet the kernel refuses comes back as the ICMP error it earned (PING-15)."""

    async def test_a_refused_datagram_reads_as_its_icmp_error(
        self, wire: Callable[..., Wire]
    ) -> None:
        echo = wire((LOOPBACK, CLOSED_PORT)).echo

        await echo.send(b"unreachable")

        assert await echo.receive(deadline(5)) == Received(
            b"unreachable", 0, LOOPBACK, PORT_UNREACHABLE
        )


class TestHopLimit:
    """The TTL or hop limit read out of a reply's control messages (PING-10)."""

    @pytest.mark.parametrize("v6", [False, True], ids=["v4", "v6"])
    def test_the_value_the_platform_sent(self, v6: bool) -> None:
        assert _hop_limit([hop_cmsg(57, v6=v6)], v6) == 57

    @pytest.mark.parametrize(
        "ancillary",
        [
            pytest.param([], id="none-sent"),
            pytest.param([error_cmsg(3, 1, ROUTER)], id="another-message"),
            pytest.param([hop_cmsg(57, v6=True)], id="the-other-family"),
        ],
    )
    def test_a_reply_without_one_reads_zero(self, ancillary: list[Any]) -> None:
        assert _hop_limit(ancillary, False) == 0


class TestExtendedError:
    """The ICMP type, code and offending address of an error-queue message (PING-15)."""

    @pytest.mark.parametrize(
        ("offender", "v6"),
        [pytest.param(ROUTER, False, id="v4"), pytest.param(ROUTER_V6, True, id="v6")],
    )
    def test_the_type_code_and_sender_are_read_back(self, offender: str, v6: bool) -> None:
        ancillary = [hop_cmsg(57, v6=v6), error_cmsg(11, 0, offender, v6=v6)]

        assert _extended_error(ancillary, v6) == (11, 0, offender)

    @pytest.mark.parametrize(
        "ancillary",
        [
            pytest.param([], id="none-sent"),
            pytest.param([hop_cmsg(57)], id="another-message"),
            pytest.param([error_cmsg(3, 1, ROUTER_V6, v6=True)], id="the-other-family"),
        ],
    )
    def test_a_message_without_one_reads_empty(self, ancillary: list[Any]) -> None:
        assert _extended_error(ancillary, False) == (0, 0, "")

    def test_a_truncated_sender_leaves_the_address_empty(self) -> None:
        _level, _cmsg_type, data = error_cmsg(3, 1, ROUTER)

        assert _offender(data[:-1], False) == ""


class TestPeerAddress:
    """The address a packet came from, as the socket reported it."""

    def test_the_address_the_socket_handed_back(self) -> None:
        assert _peer((ROUTER, 0)) == ROUTER

    def test_a_packet_without_a_sender_reads_empty(self) -> None:
        assert _peer(()) == ""


class TestWake:
    """The reader callback that ends the wait for a readable socket."""

    async def test_it_ends_the_wait(self) -> None:
        readable: asyncio.Future[None] = asyncio.get_running_loop().create_future()

        _wake(readable)

        assert readable.result() is None

    async def test_a_wait_that_already_ended_is_left_alone(self) -> None:
        readable: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        readable.set_result(None)

        _wake(readable)

        assert readable.result() is None
