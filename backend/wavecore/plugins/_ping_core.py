"""The standard-library ICMP core the Ping block and the remote bundle share (REQ-3.4.1.9)."""

import asyncio
import errno as errno_module
import math
import os
import socket
import struct
import sys
import time
from collections.abc import Callable
from contextlib import suppress
from typing import Any, NamedTuple

from wavecore.connectivity.k8s.verbs._outputs import block_failure, block_success, summary_table

Log = Callable[[str, str], None]

# Set by the remote bundle worker, so the privilege message names the execution host.
REMOTE_HOST: str | None = None
# Seconds kept reading after the last request, so a silent host is not only ever a Timeout.
REPLY_GRACE_S = 1.0

ANSWERED = "answered"
TIMED_OUT = "timed out"

_PLACES = 3
_HEADER_BYTES = 8
_SEQ_OFFSET = 6
_IDENTIFIER = 0
_ECHO_TYPE = {False: 8, True: 128}
# The IP and ICMP headers each family adds to the payload on the wire.
_OVERHEAD = {False: 28, True: 48}

# Linux IP-level options the socket module does not expose.
_MTU_DISCOVER = {False: 10, True: 23}
_RECVERR = {False: 11, True: 25}
_MTU = {False: 14, True: 24}
_RECV_HOPS = {False: 12, True: socket.IPV6_RECVHOPLIMIT}
_HOP_CMSG = {
    False: (socket.IPPROTO_IP, socket.IP_TTL),
    True: (socket.IPPROTO_IPV6, socket.IPV6_HOPLIMIT),
}
_HOP_OPTION = {False: socket.IP_TTL, True: socket.IPV6_UNICAST_HOPS}
_LEVEL = {False: socket.IPPROTO_IP, True: socket.IPPROTO_IPV6}
_PROTO = {False: socket.IPPROTO_ICMP, True: socket.IPPROTO_ICMPV6}
# The offending address inside a sock_extended_err: its family, offset and length.
_OFFENDER = {False: (socket.AF_INET, 20, 4), True: (socket.AF_INET6, 24, 16)}
_PMTUDISC_DO = 2
_EXTENDED_ERROR = struct.Struct("=IBBBBII")
_REPLY_SIZE = 65535
_CONTROL_SIZE = 1024

_FAMILIES = {"auto": 0, "v4": socket.AF_INET, "v6": socket.AF_INET6}
_FAMILY_NAMES = {"v4": "IPv4", "v6": "IPv6"}

_SUMMARY_COLUMNS = [
    ("sent", "integer"),
    ("received", "integer"),
    ("loss_percent", "float"),
    ("rtt_min_ms", "float"),
    ("rtt_avg_ms", "float"),
    ("rtt_max_ms", "float"),
    ("rtt_mdev_ms", "float"),
]
_REPLY_COLUMNS = [
    ("seq", "integer"),
    ("source", "string"),
    ("bytes", "integer"),
    ("ttl", "integer"),
    ("time_ms", "float"),
    ("status", "string"),
]

_ICMP_ERRORS = {
    (3, 0): "Destination Net Unreachable",
    (3, 1): "Destination Host Unreachable",
    (3, 2): "Destination Protocol Unreachable",
    (3, 3): "Destination Port Unreachable",
    (3, 4): "Frag needed and DF set",
    (3, 13): "Communication prohibited by filter",
    (11, 0): "Time to live exceeded",
    (11, 1): "Fragment reassembly time exceeded",
}


class PingFailure(Exception):
    """A run-time failure of the block, carrying its Reason."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


class Received(NamedTuple):
    """One packet the socket handed back: a reply, or an ICMP error about a request."""

    message: bytes = b""
    ttl: int = 0
    source: str = ""
    error: str = ""


class _Reply:
    """One request that went out, and what came back for it."""

    __slots__ = ("seq", "sent_at", "source", "size", "ttl", "time_ms", "status")

    def __init__(self, seq: int, sent_at: float) -> None:
        self.seq = seq
        self.sent_at = sent_at
        self.source = ""
        self.size = 0
        self.ttl = 0
        self.time_ms = 0.0
        self.status = TIMED_OUT

    def cells(self) -> list[Any]:
        return [self.seq, self.source, self.size, self.ttl, self.time_ms, self.status]


class _Settings(NamedTuple):
    host: str
    requests: int
    interval: float
    packet_size: int
    timeout: float
    pass_when: str
    min_replies: int
    min_rate: float
    stream_output: bool
    ip_version: str
    ttl: int | None
    dont_fragment: bool
    source_address: str


class EchoSocket:
    """The datagram socket echo requests travel on; the tests inject a stand-in for it."""

    def __init__(self, sock: socket.socket) -> None:
        self._sock = sock
        self._v6 = sock.family == socket.AF_INET6
        self._level = _LEVEL[self._v6]
        sock.setblocking(False)
        # ICMP errors reach the error queue, and each reply carries its hop limit.
        sock.setsockopt(self._level, _RECVERR[self._v6], 1)
        sock.setsockopt(self._level, _RECV_HOPS[self._v6], 1)

    def bind(self, address: str) -> None:
        self._sock.bind((address, 0))

    def connect(self, address: str) -> None:
        self._sock.connect((address, 0))

    def set_ttl(self, ttl: int) -> None:
        self._sock.setsockopt(self._level, _HOP_OPTION[self._v6], ttl)

    def set_dont_fragment(self) -> None:
        self._sock.setsockopt(self._level, _MTU_DISCOVER[self._v6], _PMTUDISC_DO)

    def path_mtu(self) -> int:
        return int(self._sock.getsockopt(self._level, _MTU[self._v6]))

    async def send(self, packet: bytes) -> None:
        await asyncio.get_running_loop().sock_sendall(self._sock, packet)

    async def receive(self, until: float) -> Received | None:
        """The next packet, or None once the monotonic deadline `until` passes unread."""
        loop = asyncio.get_running_loop()
        readable: asyncio.Future[None] = loop.create_future()
        descriptor = self._sock.fileno()
        loop.add_reader(descriptor, _wake, readable)
        try:
            # A loop timer may fire early (uvloop rounds to milliseconds), so the clock decides.
            while not readable.done():
                remaining = until - time.monotonic()
                if remaining <= 0:
                    return None
                await asyncio.wait({readable}, timeout=remaining)
        finally:
            loop.remove_reader(descriptor)
        return self._read()

    def close(self) -> None:
        self._sock.close()

    def _read(self) -> Received:
        """A reply with its hop limit, or the ICMP error the error queue holds instead."""
        try:
            message, ancillary, _flags, address = self._sock.recvmsg(_REPLY_SIZE, _CONTROL_SIZE)
        except OSError:
            return self._read_error()
        return Received(message, _hop_limit(ancillary, self._v6), _peer(address), "")

    def _read_error(self) -> Received:
        message, ancillary, _flags, _address = self._sock.recvmsg(
            _REPLY_SIZE, _CONTROL_SIZE, socket.MSG_ERRQUEUE
        )
        icmp_type, code, source = _extended_error(ancillary, self._v6)
        return Received(message, 0, source, icmp_error_text(icmp_type, code))


Opener = Callable[[int], EchoSocket]


def _wake(readable: asyncio.Future[None]) -> None:
    if not readable.done():
        readable.set_result(None)


def _peer(address: Any) -> str:
    return str(address[0]) if address else ""


def _hop_limit(ancillary: list[Any], v6: bool) -> int:
    """The reply's TTL or hop limit; 0 when the platform did not send one."""
    wanted = _HOP_CMSG[v6]
    for level, cmsg_type, data in ancillary:
        if (level, cmsg_type) == wanted:
            return int.from_bytes(data[:4], sys.byteorder)
    return 0


def _extended_error(ancillary: list[Any], v6: bool) -> tuple[int, int, str]:
    """The ICMP type, code and offending address of an error-queue message."""
    wanted = (_LEVEL[v6], _RECVERR[v6])
    for level, cmsg_type, data in ancillary:
        if (level, cmsg_type) == wanted:
            _number, _origin, icmp_type, code, _pad, _info, _data = _EXTENDED_ERROR.unpack_from(
                data
            )
            return int(icmp_type), int(code), _offender(data, v6)
    return 0, 0, ""


def _offender(data: bytes, v6: bool) -> str:
    """The address that sent the ICMP error, from the sockaddr behind the error header."""
    family, offset, length = _OFFENDER[v6]
    packed = data[offset : offset + length]
    if len(packed) < length:
        return ""
    return socket.inet_ntop(family, packed)


def icmp_error_text(icmp_type: int, code: int) -> str:
    """The wording ping itself prints for an ICMP error."""
    return _ICMP_ERRORS.get((icmp_type, code), f"ICMP type {icmp_type} code {code}")


def open_socket(family: int) -> EchoSocket:
    """The unprivileged ICMP datagram socket; a raw socket is never requested (PING-4)."""
    v6 = family == socket.AF_INET6
    return EchoSocket(socket.socket(family, socket.SOCK_DGRAM, _PROTO[v6]))


async def run(
    params: dict[str, Any],
    log: Log,
    *,
    opener: Opener = open_socket,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Worker entry: the whole block for one host, answered as the result envelope."""
    settings = _read_settings(params)
    started = clock()
    replies: list[_Reply] = []
    try:
        address, family = await _resolve(settings)
        sock = _open(opener, family)
        try:
            _prepare(sock, settings, address)
            log("INFO", _start_line(settings, address, family))
            await _exchange(sock, settings, family, replies, log, clock, started)
            _apply_pass_rule(settings, replies)
        finally:
            sock.close()
    except PingFailure as failure:
        outputs = block_failure(
            params, _outputs(replies), str(failure), failure.reason, log, action="Ping"
        )
    else:
        outputs = block_success(_outputs(replies))
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def _setting(params: dict[str, Any], name: str, default: Any) -> Any:
    """A setting as given, or its default when absent or None."""
    value = params.get(name)
    return default if value is None else value


def _read_settings(params: dict[str, Any]) -> _Settings:
    """The block's settings; a row the Pass when rule does not use is never read."""
    return _Settings(
        host=str(params["host"]).strip(),
        requests=int(_setting(params, "count", 4)),
        interval=float(_setting(params, "interval", 1)),
        packet_size=int(_setting(params, "packet_size", 56)),
        timeout=_setting(params, "timeout", 30),
        pass_when=str(_setting(params, "pass_when", "any")),
        min_replies=_setting(params, "min_replies", 1),
        min_rate=_setting(params, "min_rate", 100),
        stream_output=bool(_setting(params, "stream_output", False)),
        ip_version=str(_setting(params, "ip_version", "auto")),
        ttl=_setting(params, "ttl", None),
        dont_fragment=bool(_setting(params, "dont_fragment", False)),
        source_address=str(_setting(params, "source_address", "")).strip(),
    )


async def _resolve(settings: _Settings) -> tuple[str, int]:
    """The address to ping and the family to open, looked up once within Timeout."""
    wanted = _FAMILIES[settings.ip_version]
    lookup = asyncio.get_running_loop().getaddrinfo(settings.host, None, type=socket.SOCK_DGRAM)
    found: list[Any] = []
    with suppress(OSError, ValueError, asyncio.TimeoutError):
        found = await asyncio.wait_for(lookup, settings.timeout)
    if not found:
        raise PingFailure(f"Cannot resolve host '{settings.host}'", "Unresolved")
    for info in found:
        if wanted in (0, info[0]):
            return str(info[4][0]), int(info[0])
    named = _FAMILY_NAMES[settings.ip_version]
    raise PingFailure(f"Host '{settings.host}' has no {named} address", "Unresolved")


def _open(opener: Opener, family: int) -> EchoSocket:
    """The socket, or the privilege failure the refusing machine earns (PING-5)."""
    try:
        return opener(family)
    except OSError as exc:
        machine = (
            "The WAVE server" if REMOTE_HOST is None else f"The execution host '{REMOTE_HOST}'"
        )
        raise PingFailure(
            f"{machine} may not send ICMP echo requests: the operating system refused an "
            "unprivileged ICMP socket. Add this machine's group to net.ipv4.ping_group_range.",
            "Unprivileged",
        ) from exc


def _prepare(sock: EchoSocket, settings: _Settings, address: str) -> None:
    """Bind the source address, connect, then apply the two Advanced socket options."""
    if settings.source_address:
        _bind(sock, settings.source_address)
    sock.connect(address)
    if settings.ttl is not None:
        sock.set_ttl(int(settings.ttl))
    if settings.dont_fragment:
        sock.set_dont_fragment()


def _bind(sock: EchoSocket, address: str) -> None:
    try:
        sock.bind(address)
    except OSError as exc:
        raise PingFailure(
            f"Cannot send from source address '{address}': {_os_text(exc)}", "Source"
        ) from exc


def _os_text(exc: OSError) -> str:
    """The operating system's text for the error number, never a library's wrapper."""
    return os.strerror(exc.errno) if exc.errno else str(exc)


def _wire_size(settings: _Settings, family: int) -> int:
    return settings.packet_size + _OVERHEAD[family == socket.AF_INET6]


def _start_line(settings: _Settings, address: str, family: int) -> str:
    wire = _wire_size(settings, family)
    return f"PING {settings.host} ({address}) {settings.packet_size}({wire}) bytes of data."


def _checksum(message: bytes) -> int:
    """The Internet checksum of an ICMP message whose own checksum field reads zero."""
    padded = message + b"\x00" * (len(message) % 2)
    total = sum(int.from_bytes(padded[at : at + 2], "big") for at in range(0, len(padded), 2))
    while total > 0xFFFF:
        total = (total >> 16) + (total & 0xFFFF)
    return ~total & 0xFFFF


def _echo_packet(seq: int, payload_size: int, family: int) -> bytes:
    """One ICMP echo request: the header, its checksum, then the payload bytes."""
    icmp_type = _ECHO_TYPE[family == socket.AF_INET6]
    body = struct.pack("!BBHHH", icmp_type, 0, 0, _IDENTIFIER, seq) + bytes(payload_size)
    return body[:2] + _checksum(body).to_bytes(2, "big") + body[4:]


def _sequence_of(message: bytes) -> int:
    """The sequence number an ICMP echo message carries; requests number from 1."""
    return int.from_bytes(message[_SEQ_OFFSET:_HEADER_BYTES], "big")


async def _exchange(
    sock: EchoSocket,
    settings: _Settings,
    family: int,
    replies: list[_Reply],
    log: Log,
    clock: Callable[[], float],
    started: float,
) -> None:
    """Send Count requests one Interval apart, reading replies in between (PING-1)."""
    deadline = started + settings.timeout
    try:
        for seq in range(1, settings.requests + 1):
            if clock() >= deadline:
                break
            await _send_one(sock, settings, family, replies, seq, clock)
            last = seq == settings.requests
            if last:
                window = min(deadline, clock() + max(settings.interval, REPLY_GRACE_S))
            else:
                window = min(deadline, started + seq * settings.interval)
            await _read_until(sock, settings, replies, log, clock, window, settled_ends_it=last)
    finally:
        # The statistics reach the console however the run ended, as ping prints them.
        _log_summary(settings, replies, log, clock, started)
    _check_timeout(settings, replies, clock, deadline)


async def _send_one(
    sock: EchoSocket,
    settings: _Settings,
    family: int,
    replies: list[_Reply],
    seq: int,
    clock: Callable[[], float],
) -> None:
    """One echo request; a packet the path refuses ends the block with the size it found."""
    reply = _Reply(seq, clock())
    replies.append(reply)
    try:
        await sock.send(_echo_packet(seq, settings.packet_size, family))
    except OSError as exc:
        if exc.errno != errno_module.EMSGSIZE:
            raise
        mtu = sock.path_mtu()
        reply.status = f"too large, the path is {mtu} bytes"
        wire = _wire_size(settings, family)
        raise PingFailure(
            f"A {wire}-byte packet does not fit the path to {settings.host}: "
            f"the path is {mtu} bytes",
            "TooLarge",
        ) from exc


async def _read_until(
    sock: EchoSocket,
    settings: _Settings,
    replies: list[_Reply],
    log: Log,
    clock: Callable[[], float],
    window: float,
    *,
    settled_ends_it: bool,
) -> None:
    """Read replies until the window closes, or until nothing is still outstanding."""
    while True:
        if window - clock() <= 0:
            return
        if settled_ends_it and all(reply.status != TIMED_OUT for reply in replies):
            return
        received = await sock.receive(window)
        if received is None:
            return
        _record(settings, replies, received, log, clock)


def _record(
    settings: _Settings,
    replies: list[_Reply],
    received: Received,
    log: Log,
    clock: Callable[[], float],
) -> None:
    """Match a packet to the request it answers; a stray or a repeat is left alone."""
    seq = _sequence_of(received.message)
    reply = next((entry for entry in replies if entry.seq == seq), None)
    if reply is None or reply.status != TIMED_OUT:
        return
    reply.source = received.source
    if received.error:
        reply.status = (
            f"{received.error} from {received.source}" if received.source else received.error
        )
        if settings.stream_output:
            log("WARN", f"From {received.source} icmp_seq={seq} {received.error}")
        return
    reply.size = len(received.message)
    reply.ttl = received.ttl
    reply.time_ms = round((clock() - reply.sent_at) * 1000, _PLACES)
    reply.status = ANSWERED
    if settings.stream_output:
        hop = f" ttl={reply.ttl}" if reply.ttl else ""
        log(
            "INFO",
            f"{reply.size} bytes from {reply.source}: icmp_seq={seq}{hop} "
            f"time={reply.time_ms} ms",
        )


def _check_timeout(
    settings: _Settings, replies: list[_Reply], clock: Callable[[], float], deadline: float
) -> None:
    """Timeout is the hard bound: a request still unsent or unanswered at it ends the block."""
    unfinished = len(replies) < settings.requests or any(
        reply.status == TIMED_OUT for reply in replies
    )
    if unfinished and clock() >= deadline:
        raise PingFailure(f"Ping did not finish within {settings.timeout} seconds", "Timeout")


def _percent(part: int, whole: int) -> float:
    return round(part / whole * 100, _PLACES) if whole else 0.0


def _answered(replies: list[_Reply]) -> list[float]:
    return [reply.time_ms for reply in replies if reply.status == ANSWERED]


def _figures(replies: list[_Reply]) -> list[Any]:
    """The one Summary row: what went out, what came back and the round-trip spread."""
    times = _answered(replies)
    sent, received = len(replies), len(times)
    if not times:
        return [sent, received, _percent(sent - received, sent), 0.0, 0.0, 0.0, 0.0]
    mean = sum(times) / received
    variance = sum(value * value for value in times) / received - mean * mean
    return [
        sent,
        received,
        _percent(sent - received, sent),
        round(min(times), _PLACES),
        round(mean, _PLACES),
        round(max(times), _PLACES),
        round(math.sqrt(max(variance, 0.0)), _PLACES),
    ]


def _outputs(replies: list[_Reply]) -> dict[str, Any]:
    return {
        "summary": summary_table(_SUMMARY_COLUMNS, [_figures(replies)]),
        "replies": summary_table(_REPLY_COLUMNS, [reply.cells() for reply in replies]),
    }


def _log_summary(
    settings: _Settings,
    replies: list[_Reply],
    log: Log,
    clock: Callable[[], float],
    started: float,
) -> None:
    """The lines ping prints when it is done, whether the run passed or not (PING-16)."""
    if settings.stream_output:
        for reply in replies:
            if reply.status == TIMED_OUT:
                log("WARN", f"No reply to icmp_seq={reply.seq} from {settings.host}")
    sent, received, loss, minimum, average, maximum, deviation = _figures(replies)
    elapsed = int((clock() - started) * 1000)
    log("INFO", f"--- {settings.host} ping statistics ---")
    log(
        "INFO",
        f"{sent} packets transmitted, {received} received, {loss}% packet loss, "
        f"time {elapsed}ms",
    )
    if received:
        log("INFO", f"rtt min/avg/max/mdev = {minimum}/{average}/{maximum}/{deviation} ms")


def _apply_pass_rule(settings: _Settings, replies: list[_Reply]) -> None:
    """Raise the block's failure when the Pass when rule was not met (PING-3)."""
    sent, received = len(replies), len(_answered(replies))
    rule = settings.pass_when
    if rule == "any" and received == 0:
        raise PingFailure(f"No reply from {settings.host}", "NoReply")
    if rule == "all" and received < sent:
        raise PingFailure(f"{received} of {sent} requests answered", "NotAllReplied")
    if rule == "min_replies" and received < settings.min_replies:
        raise PingFailure(
            f"{received} of {sent} requests answered, "
            f"fewer than the {settings.min_replies} required",
            "TooFewReplies",
        )
    rate = _percent(received, sent)
    if rule == "min_rate" and rate < settings.min_rate:
        raise PingFailure(
            f"{rate}% of requests answered, below the {settings.min_rate}% required", "RateTooLow"
        )
