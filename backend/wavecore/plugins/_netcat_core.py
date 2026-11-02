"""The standard-library Netcat core the local block and the remote bundle share (REQ-3.4.1.9)."""

import asyncio
import base64
import os
import re
import socket
import time
from collections.abc import Awaitable, Callable, Mapping
from contextlib import suppress
from functools import partial
from pathlib import Path
from typing import Any, NamedTuple

from wavecore.connectivity.k8s.verbs._outputs import block_failure, block_success, summary_table
from wavecore.plugins._ports import check_port

Log = Callable[[str, str], None]
Stream = tuple[Any, Any]
Opener = Callable[[str, int], Awaitable[Stream]]
Dial = Callable[[], Awaitable[Stream]]
PreDial = Callable[[list[int], Log], Mapping[int, Dial]]

MAX_IN_FLIGHT = 64
UDP_MAX_PAYLOAD = 65507
UDP_PROBE = b"X"

_READ_SIZE = 65536
_SEND_SIZE = 65536
_LISTED_FAILURES = 10
# re.ASCII holds \d to [0-9]: the port range grammar is ASCII digits only (NETCAT-2).
_PORT_ENTRY = re.compile(r"\d+(-\d+)?", re.ASCII)
_LINE_ENDING = re.compile(rb"\r?\n")
_CHECK_COLUMNS = [
    ("port", "integer"),
    ("protocol", "string"),
    ("state", "string"),
    ("reason", "string"),
    ("time_ms", "integer"),
]
_TALK_COLUMNS = [*_CHECK_COLUMNS, ("reply", "string")]
_OPEN_OR_FILTERED = "open or filtered"
_STATES = ("open", "closed", "timed out", _OPEN_OR_FILTERED)
_PASSING = ("open", _OPEN_OR_FILTERED)


class NetcatFailure(Exception):
    """A run-time failure of the block, carrying its Reason."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


class PortResult(NamedTuple):
    """One port's Results row plus the Talk traffic behind its console lines."""

    port: int
    protocol: str
    state: str
    reason: str
    time_ms: int
    reply: str = ""
    sent: int = 0
    received: int = 0
    capped: bool = False


class _Settings(NamedTuple):
    host: str
    ports: list[int]
    ranged: bool
    pass_all: bool
    protocol: str
    talking: bool
    timeout: float
    send: str
    crlf: bool
    close_after_send: bool
    max_reply_bytes: int


def parse_ports(port_range: str) -> list[int]:
    """Port range ports in written order, ranges ascending, a repeat kept first (NETCAT-2)."""
    ports: dict[int, None] = {}
    for written in port_range.split(","):
        entry = written.strip()
        if not _PORT_ENTRY.fullmatch(entry):
            raise ValueError(f"Parameter 'port_range' has an invalid entry: '{entry}'")
        start, _, end = entry.partition("-")
        first, last = int(start), int(end or start)
        check_port("port_range", first, 1)
        check_port("port_range", last, 1)
        if first > last:
            raise ValueError(f"Parameter 'port_range' has a range that runs backward: '{entry}'")
        ports.update(dict.fromkeys(range(first, last + 1)))
    return list(ports)


def unreadable_payload(exc: OSError) -> NetcatFailure:
    """The failure for a payload file the operating system will not hand over (NETCAT-19)."""
    return NetcatFailure(f"Could not read the payload file: {exc.strerror or exc}", "StartFailed")


def read_payload_file(path: str, written: str) -> bytes:
    """The payload file's bytes; a failure names the value as written (NETCAT-19)."""
    source = Path(path)
    try:
        data = source.read_bytes() if source.is_file() else None
    except FileNotFoundError:
        data = None
    except OSError as exc:
        raise unreadable_payload(exc) from exc
    if data is None:
        raise NetcatFailure(f"Payload file not found: {written}", "StartFailed")
    return data


async def check(
    settings: _Settings,
    addresses: list[str],
    port: int,
    *,
    opener: Opener = asyncio.open_connection,
    dial: Dial | None = None,
) -> PortResult:
    """Check one port: TCP connects and sends nothing, UDP sends X and waits (NETCAT-13)."""
    started = time.monotonic()
    if settings.protocol == "udp":
        state, reason, _ = await _datagrams(settings, addresses[0], port, UDP_PROBE, 0)
    else:
        stream, state, reason = await _connect(settings, addresses, port, opener, dial)
        if stream is not None:
            stream[1].close()
    return PortResult(port, settings.protocol, state, reason, _elapsed(started))


async def talk(
    settings: _Settings,
    addresses: list[str],
    port: int,
    payload: bytes,
    *,
    opener: Opener = asyncio.open_connection,
    dial: Dial | None = None,
) -> PortResult:
    """Talk to one port: send the payload and capture the reply (NETCAT-16)."""
    started = time.monotonic()
    limit = settings.max_reply_bytes
    if settings.protocol == "udp":
        state, reason, reply = await _datagrams(settings, addresses[0], port, payload, limit)
        sent, stopped = len(payload), time.monotonic()
    else:
        stream, state, reason = await _connect(settings, addresses, port, opener, dial)
        reply, sent, stopped = b"", 0, time.monotonic()
        if stream is not None:
            exchange = _Exchange(stream, settings.timeout, limit)
            stopped = await exchange.run(payload, settings.close_after_send)
            reply, sent = bytes(exchange.reply), exchange.sent
    kept = reply[:limit]
    return PortResult(
        port,
        settings.protocol,
        state,
        reason,
        _elapsed(started, stopped),
        reply=kept.decode("utf-8", errors="replace"),
        sent=sent,
        received=len(kept),
        capped=len(reply) >= limit,
    )


async def run(
    params: dict[str, Any],
    log: Log,
    *,
    payload: bytes | None = None,
    opener: Opener = asyncio.open_connection,
    pre_dial: PreDial | None = None,
) -> dict[str, Any]:
    """Worker entry: the whole block for one request, answered as the result envelope."""
    settings = _read_settings(params)
    log("INFO", _start_line(settings))
    results: list[PortResult] = []
    try:
        routes: Mapping[int, Dial] = {} if pre_dial is None else pre_dial(settings.ports, log)
        data = _payload(params, settings, payload) if settings.talking else b""
        addresses = await _resolve(settings)
        results = await _dial_all(settings, addresses, data, opener, routes)
        _log_results(settings, results, log)
        _apply_pass_rule(settings, results)
    except NetcatFailure as failure:
        measured = _outputs(settings, results)
        outputs = block_failure(
            params, measured, str(failure), failure.reason, log, action="Netcat"
        )
    else:
        outputs = block_success(_outputs(settings, results))
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def _setting(params: dict[str, Any], name: str, default: Any) -> Any:
    """A setting as given, or its default when absent or None."""
    value = params.get(name)
    return default if value is None else value


def _read_settings(params: dict[str, Any]) -> _Settings:
    """The block's settings; a row the Ports switch hides is never read (NETCAT-14)."""
    ranged = _setting(params, "ports", "single") == "range"
    return _Settings(
        host=str(params["host"]).strip(),
        ports=parse_ports(str(params["port_range"])) if ranged else [params["port"]],
        ranged=ranged,
        pass_all=ranged and _setting(params, "pass_when", "one") == "all",
        protocol=str(_setting(params, "protocol", "tcp")),
        talking=_setting(params, "mode", "check") == "talk",
        timeout=_setting(params, "timeout", 10),
        send=str(_setting(params, "send", "text")),
        crlf=bool(_setting(params, "crlf", False)),
        close_after_send=bool(_setting(params, "close_after_send", False)),
        max_reply_bytes=_setting(params, "max_reply_bytes", 16777216),
    )


def _start_line(settings: _Settings) -> str:
    verb = "Talking to" if settings.talking else "Checking"
    over = settings.protocol.upper()
    if settings.ranged:
        return f"{verb} {len(settings.ports)} ports on {settings.host} over {over}"
    return f"{verb} {settings.host} port {settings.ports[0]} over {over}"


def _payload(params: dict[str, Any], settings: _Settings, payload: bytes | None) -> bytes:
    """Talk's bytes as they travel: CRLF applied, and one datagram at most over UDP."""
    data = _source_bytes(params, settings.send, payload)
    if settings.crlf:
        data = _LINE_ENDING.sub(b"\r\n", data)
    if settings.protocol == "udp" and len(data) > UDP_MAX_PAYLOAD:
        message = (
            f"Payload is too large for one UDP datagram: {len(data)} bytes "
            f"(at most {UDP_MAX_PAYLOAD})"
        )
        raise NetcatFailure(message, "StartFailed")
    return data


def _source_bytes(params: dict[str, Any], send: str, payload: bytes | None) -> bytes:
    if send == "nothing":
        return b""
    if send == "text":
        return str(_setting(params, "text", "")).encode("utf-8")
    return _file_bytes(params, payload)


def _file_bytes(params: dict[str, Any], payload: bytes | None) -> bytes:
    """A WAVE-side read failure, bytes WAVE read or shipped, else a plain path read here."""
    if params.get("payload_error"):
        raise NetcatFailure(str(params["payload_error"]), "StartFailed")
    if payload is not None:
        return payload
    if params.get("payload_base64") is not None:
        return base64.b64decode(params["payload_base64"])
    file = str(params["file"]).strip()
    return read_payload_file(os.path.join(os.path.expanduser("~"), file), file)


async def _resolve(settings: _Settings) -> list[str]:
    """The Host's addresses in resolver order, looked up once within Timeout (NETCAT-17)."""
    kind = socket.SOCK_DGRAM if settings.protocol == "udp" else socket.SOCK_STREAM
    lookup = asyncio.get_running_loop().getaddrinfo(settings.host, None, type=kind)
    found: list[Any] = []
    with suppress(OSError, ValueError, asyncio.TimeoutError):
        found = await asyncio.wait_for(lookup, settings.timeout)
    addresses = list(dict.fromkeys(str(info[4][0]) for info in found))
    if not addresses:
        raise NetcatFailure(f"Could not resolve host: {settings.host}", "Unresolved")
    return addresses


async def _dial_all(
    settings: _Settings,
    addresses: list[str],
    payload: bytes,
    opener: Opener,
    routes: Mapping[int, Dial],
) -> list[PortResult]:
    """Every port, at most 64 at a time, in the written order whatever finishes first."""
    gate = asyncio.Semaphore(MAX_IN_FLIGHT)

    async def measure(port: int) -> PortResult:
        async with gate:
            if settings.talking:
                return await talk(
                    settings, addresses, port, payload, opener=opener, dial=routes.get(port)
                )
            return await check(settings, addresses, port, opener=opener, dial=routes.get(port))

    tasks = [asyncio.ensure_future(measure(port)) for port in settings.ports]
    try:
        return list(await asyncio.gather(*tasks))
    except Exception:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


async def _connect(
    settings: _Settings, addresses: list[str], port: int, opener: Opener, dial: Dial | None
) -> tuple[Stream | None, str, str]:
    """TCP: each address in turn until one connects, else the last attempt's verdict."""
    attempts: list[Dial] = (
        [partial(opener, address, port) for address in addresses] if dial is None else [dial]
    )
    state, reason = "closed", ""
    for attempt in attempts:
        try:
            return await asyncio.wait_for(attempt(), settings.timeout), "open", ""
        except asyncio.TimeoutError:  # on the 3.10 floor this differs from the builtin one
            state, reason = "timed out", f"No answer within {settings.timeout} seconds"
        except OSError as exc:
            state, reason = "closed", _os_text(exc)
    return None, state, reason


class _Exchange:
    """One TCP Talk: the payload goes out while the reply comes in, as nc does (NETCAT-16)."""

    def __init__(self, stream: Stream, timeout: float, limit: int) -> None:
        self.reader, self.writer = stream
        self.timeout, self.limit = timeout, limit
        self.reply = bytearray()
        self.sent = 0

    async def run(self, payload: bytes, close_after_send: bool) -> float:
        """Send and read together; returns the moment reading stopped."""
        sending = asyncio.ensure_future(self._send(payload, close_after_send))
        try:
            with suppress(OSError):
                await self._receive(sending)
            stopped = time.monotonic()
            if len(self.reply) >= self.limit:
                sending.cancel()
            await asyncio.wait({sending})
            if not sending.cancelled():
                sending.result()
            return stopped
        finally:
            sending.cancel()
            _close_now(self.writer)

    async def _send(self, payload: bytes, close_after_send: bool) -> None:
        """Chunk by chunk, each given Timeout to be taken; a stall or an error ends the send."""
        with suppress(OSError):
            for start in range(0, len(payload), _SEND_SIZE):
                chunk = payload[start : start + _SEND_SIZE]
                self.writer.write(chunk)
                if not await self._taken():
                    return
                self.sent += len(chunk)
            if close_after_send:
                self.writer.write_eof()

    async def _taken(self) -> bool:
        """Whether the server took the data written so far within Timeout."""
        # asyncio.wait, since wait_for on the 3.10 floor can drop a cancel that meets a drain.
        draining = asyncio.ensure_future(self.writer.drain())
        try:
            done, _ = await asyncio.wait({draining}, timeout=self.timeout)
        finally:
            draining.cancel()
        if done:
            draining.result()
        return bool(done)

    async def _receive(self, sending: asyncio.Future[None]) -> None:
        """Read until the server closes, the reply fills the limit or silence outlasts Timeout."""
        while len(self.reply) < self.limit:
            chunk = await self._next_chunk(sending)
            if not chunk:
                return
            self.reply += chunk

    async def _next_chunk(self, sending: asyncio.Future[None]) -> bytes:
        """The next piece of the reply; silence counts only once the send is over."""
        size = min(_READ_SIZE, self.limit - len(self.reply))
        reading = asyncio.ensure_future(self.reader.read(size))
        try:
            if not sending.done():
                await asyncio.wait({reading, sending}, return_when=asyncio.FIRST_COMPLETED)
            if not reading.done():
                await asyncio.wait({reading}, timeout=self.timeout)
            return bytes(reading.result()) if reading.done() else b""
        finally:
            reading.cancel()


def _close_now(writer: Any) -> None:
    """Close at once: asyncio's own close waits for data a stalled server may never take."""
    writer.close()
    transport = getattr(writer, "transport", None)
    if transport is not None:
        transport.abort()


async def _datagrams(
    settings: _Settings, address: str, port: int, payload: bytes, limit: int
) -> tuple[str, str, bytes]:
    """UDP: one datagram out; the first back means open, more are joined up to limit."""
    # A connected socket, since asyncio's datagram transport drops an empty datagram.
    loop = asyncio.get_running_loop()
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    timeout = settings.timeout
    state, reason, reply = _OPEN_OR_FILTERED, f"No reply within {timeout} seconds", bytearray()
    try:
        with socket.socket(family, socket.SOCK_DGRAM) as sock, suppress(asyncio.TimeoutError):
            sock.setblocking(False)
            sock.connect((address, port))
            await loop.sock_sendall(sock, payload)
            reply += await asyncio.wait_for(loop.sock_recv(sock, _READ_SIZE), timeout)
            state, reason = "open", ""
            while len(reply) < limit:
                reply += await asyncio.wait_for(loop.sock_recv(sock, _READ_SIZE), timeout)
    except OSError as exc:
        state, reason = "closed", _os_text(exc)
    return state, reason, bytes(reply)


def _os_text(exc: OSError) -> str:
    """The operating system's text for the error number, never a library's wrapper."""
    return os.strerror(exc.errno) if exc.errno else str(exc)


def _elapsed(started: float, ended: float | None = None) -> int:
    return int(((time.monotonic() if ended is None else ended) - started) * 1000)


def _log_results(settings: _Settings, results: list[PortResult], log: Log) -> None:
    """Each port's lines in the written order, then a Range's summary (NETCAT-2)."""
    level = "DEBUG" if settings.ranged else "INFO"
    for result in results:
        detail = f": {result.reason}" if result.reason else ""
        log(level, f"Port {result.port}/{result.protocol} {result.state}{detail}")
        if settings.talking and result.state in _PASSING:
            log(level, f"Sent {result.sent} bytes, received {result.received} bytes")
        if result.capped:
            log("WARN", f"Reply from port {result.port} stopped at {result.received} bytes")
    if settings.ranged:
        log("INFO", _summary(results))


def _summary(results: list[PortResult]) -> str:
    counts = [(sum(result.state == state for result in results), state) for state in _STATES]
    parts = [f"{count} {state}" for count, state in counts if count]
    return f"{', '.join(parts)} of {len(results)}"


def _apply_pass_rule(settings: _Settings, results: list[PortResult]) -> None:
    """Raise the block's failure when the pass rule is not met (NETCAT-3)."""
    failed = [result for result in results if result.state not in _PASSING]
    if not failed:
        return
    host, count = settings.host, len(results)
    if not settings.ranged:
        port = failed[0].port
        if failed[0].state == "closed":
            raise NetcatFailure(f"Port {port} on {host} is closed: {failed[0].reason}", "Closed")
        raise NetcatFailure(
            f"Port {port} on {host} timed out after {settings.timeout} seconds", "Timeout"
        )
    if settings.pass_all:
        listed = ", ".join(f"{result.port} {result.state}" for result in failed[:_LISTED_FAILURES])
        more = len(failed) - _LISTED_FAILURES
        suffix = f" (+{more} more)" if more > 0 else ""
        message = f"{len(failed)} of {count} ports on {host} did not succeed: {listed}{suffix}"
        raise NetcatFailure(message, "NotAllSucceeded")
    if len(failed) == count:
        raise NetcatFailure(f"No port on {host} succeeded ({count} checked)", "NoneSucceeded")


def _outputs(settings: _Settings, results: list[PortResult]) -> dict[str, Any]:
    """Results in the written order, plus Reply for a Single Talk (NETCAT-7)."""
    columns = _TALK_COLUMNS if settings.talking else _CHECK_COLUMNS
    rows = [list(result[: len(columns)]) for result in results]
    outputs: dict[str, Any] = {"results": summary_table(columns, rows)}
    if settings.talking and not settings.ranged:
        outputs["reply"] = results[0].reply if results else ""
    return outputs
