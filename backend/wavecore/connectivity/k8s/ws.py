"""Pure-Python Kubernetes exec-channel client (REQ-5.1.1, REQ-3.4.1.5).

Opens the pods/exec subresource as an RFC 6455 WebSocket over the same socket
and TLS plumbing the REST core uses, offers the v5 and v4 Kubernetes channel
subprotocols, demultiplexes stdout (channel 1), stderr (channel 2) and the
error/status stream (channel 3), writes a body on the stdin channel (channel 0)
and ends it with the v5 close sentinel, and reads the exit code out of the
terminal Status frame keying on reason and causes[].reason only, never on the
message text. A stream mode hands stdout out as it arrives, for callers that
must not hold it whole. The channel is dialed through the proxy core, which
tunnels it when a proxy route is in force (REQ-4.7.14). Sync by design - local
plugins call it via a thread offload. Imports stdlib, the bundled TLS engine
and the proxy core only, so the module stays vendorable.
"""

import base64
import datetime
import hashlib
import json
import os
import socket
import struct
import urllib.parse
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from typing import Any

from wavecore.connectivity import proxy
from wavecore.connectivity.k8s.rest import (
    K8sContextLike,
    host_header,
    seconds,
    server_address,
    tls_config,
)

_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
_V5 = "v5.channel.k8s.io"
_V4 = "v4.channel.k8s.io"
_READ_CHUNK = 65536
# Kept under 65536 so a client frame length never needs the 64-bit form.
_STDIN_CHUNK = 32768
_HEAD_END = b"\r\n\r\n"

_STDIN = 0
_STDOUT = 1
_STDERR = 2
_ERROR = 3
_CLOSE_SENTINEL = 255

_BINARY_FIN = 0x82
_FIN = 0x80
_MASKED = 0x80
_CLOSE = 0x8
_PING = 0x9
_PONG = 0xA

_BAD_ACCEPT = "Kubernetes exec channel handshake failed: Sec-WebSocket-Accept does not match"
_NO_SUBPROTOCOL = (
    "Kubernetes exec channel handshake failed: the server negotiated no usable subprotocol"
)
_UNREADABLE_STATUS = "Kubernetes exec channel sent an unreadable status frame"
_CLOSED_EARLY = "Kubernetes exec channel closed before the command finished"
_NEEDS_V5 = "Kubernetes exec channel needs the v5 subprotocol to send standard input"
_TOO_LARGE = "Kubernetes exec channel produced more than {limit} of output"
_TIMED_OUT = "Kubernetes exec channel timed out after {within}"
_MIB = 1 << 20
_STDERR_KEPT = 65_536


class ExecTimeout(Exception):
    """The exec channel deadline expired."""


class ExecTransportError(Exception):
    """The exec channel could not be opened, read or understood."""


class ExecVersionUnsupported(Exception):
    """Standard input was requested and the server offered no v5 subprotocol."""


class ExecOutputTooLarge(Exception):
    """The exec channel produced more output than the caller's ceiling allows."""


class ExecRejected(Exception):
    """The cluster answered with a Status failure that is not a plain non-zero exit."""

    def __init__(self, message: str, reason: str | None) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason


@dataclass
class _Wire:
    """One connected exchange: raw socket plus its write/read callables."""

    sock: socket.socket
    write: Callable[[bytes], object]
    read: Callable[[int], bytes]


@dataclass(frozen=True)
class _Call:
    """The facts one exec invocation puts into its upgrade request."""

    namespace: str
    pod: str
    container: str | None
    command: list[str]
    stdin: str | bytes | None
    impersonate_user: str | None
    impersonate_groups: list[str] | None


class _Reader:
    """Buffers the wire so header blocks and frames can be read at exact sizes."""

    def __init__(self, read: Callable[[int], bytes]) -> None:
        self._read = read
        self._buffer = b""

    def _fill(self) -> None:
        piece = self._read(_READ_CHUNK)
        if not piece:
            raise ExecTransportError(_CLOSED_EARLY)
        self._buffer += piece

    def exact(self, size: int) -> bytes:
        """Exactly size bytes, waiting on the wire for as many as it takes."""
        while len(self._buffer) < size:
            self._fill()
        taken, self._buffer = self._buffer[:size], self._buffer[size:]
        return taken

    def head(self) -> bytes:
        """Everything up to the blank line that ends an HTTP head."""
        while _HEAD_END not in self._buffer:
            self._fill()
        head, _, self._buffer = self._buffer.partition(_HEAD_END)
        return head


def _accept(key: str) -> str:
    """The Sec-WebSocket-Accept value RFC 6455 section 4.2.2 derives from a key."""
    return base64.b64encode(hashlib.sha1((key + _GUID).encode()).digest()).decode()


def _connect(context: K8sContextLike, timeout: float) -> _Wire:
    """The connected transport, TLS included; the seam the tests replace."""
    # Imported on use: a top-level plugins import cycles back here via K8s Connect.
    from wavecore.plugins import http_tls

    server = context.server
    address = server_address(context)
    # Read before the socket opens, so a refused trust source leaves nothing to close.
    config = tls_config(context) if address.scheme == "https" else None
    try:
        sock = proxy.connect(address.host, address.effective_port, timeout, address.scheme)
    except OSError as exc:
        raise ExecTransportError(
            f"Could not connect to the Kubernetes API at {server}: {exc}"
        ) from exc
    if config is None:
        return _Wire(sock, sock.sendall, sock.recv)
    try:
        result = http_tls.tls_handshake(
            sock,
            config,
            context.server_name or address.host,
            # datetime.UTC is 3.11+; the remote bundle runs on 3.10 hosts (keep timezone.utc).
            datetime.datetime.now(datetime.timezone.utc),
        )
    except (http_tls.TLSVerificationFailure, http_tls.TLSHandshakeError) as exc:
        sock.close()
        trouble = (
            "verify the TLS certificate of"
            if isinstance(exc, http_tls.TLSVerificationFailure)
            else "connect to the Kubernetes API at"
        )
        raise ExecTransportError(f"Could not {trouble} {server}: {exc}") from exc
    connection = result.connection
    return _Wire(sock, connection.write, lambda size: bytes(connection.read(max=size)))


def _request(context: K8sContextLike, call: _Call, key: str) -> bytes:
    """The upgrade request head, with argv rendered as repeated command parameters."""
    address = server_address(context)
    quote = urllib.parse.quote
    root = f"{address.path.rstrip('/')}/api/v1/namespaces/{quote(call.namespace)}"
    path = f"{root}/pods/{quote(call.pod)}/exec"
    query: list[tuple[str, str]] = [("command", argument) for argument in call.command]
    if call.container:
        query.append(("container", call.container))
    query += [("stdout", "true"), ("stderr", "true")]
    if call.stdin is not None:
        query.append(("stdin", "true"))
    lines = [
        f"GET {path}?{urllib.parse.urlencode(query)} HTTP/1.1",
        f"Host: {host_header(address)}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
        f"Sec-WebSocket-Protocol: {_V5}, {_V4}",
    ]
    if context.token:
        lines.append(f"Authorization: Bearer {context.token}")
    if call.impersonate_user:
        lines.append(f"Impersonate-User: {call.impersonate_user}")
    lines += [f"Impersonate-Group: {group}" for group in call.impersonate_groups or []]
    return ("\r\n".join(lines) + "\r\n\r\n").encode()


def _refusal(status: int, body: bytes) -> ExecRejected | ExecTransportError:
    """What a non-101 upgrade response deserves: the cluster's own Status, or transport."""
    parsed: Any = None
    with suppress(ValueError):
        parsed = json.loads(body)
    if isinstance(parsed, dict) and parsed.get("status") == "Failure":
        return ExecRejected(str(parsed.get("message", "")), parsed.get("reason"))
    return ExecTransportError(f"Kubernetes refused the exec channel upgrade (HTTP {status})")


def _handshake(reader: _Reader, key: str) -> str:
    """Verifies the 101 and returns the negotiated subprotocol, lower-cased."""
    lines = reader.head().decode(errors="replace").split("\r\n")
    status = int(lines[0].split(" ")[1])
    headers: dict[str, list[str]] = {}
    for line in lines[1:]:
        name, _, value = line.partition(":")
        headers.setdefault(name.strip().lower(), []).append(value.strip())
    if status != 101:
        raise _refusal(status, reader.exact(int(headers.get("content-length", ["0"])[0])))
    if headers.get("sec-websocket-accept", [""])[0] != _accept(key):
        raise ExecTransportError(_BAD_ACCEPT)
    protocol = headers.get("sec-websocket-protocol", [""])[0].lower()
    if protocol not in (_V5, _V4):
        raise ExecTransportError(_NO_SUBPROTOCOL)
    return protocol


def _send(wire: _Wire, payload: bytes) -> None:
    """One masked binary frame; callers keep payloads under the 64-bit length form."""
    length = len(payload)
    if length < 126:
        head = bytes([_BINARY_FIN, _MASKED | length])
    else:
        head = bytes([_BINARY_FIN, _MASKED | 126]) + struct.pack("!H", length)
    mask = os.urandom(4)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    wire.write(head + mask + masked)


def _write_stdin(wire: _Wire, body: str | bytes, protocol: str) -> None:
    """The body on channel 0, then the two-byte close signal the v5 protocol defines."""
    if protocol != _V5:
        raise ExecVersionUnsupported(_NEEDS_V5)
    data = body.encode() if isinstance(body, str) else body
    for start in range(0, len(data), _STDIN_CHUNK):
        _send(wire, bytes([_STDIN]) + data[start : start + _STDIN_CHUNK])
    _send(wire, bytes([_CLOSE_SENTINEL, _STDIN]))


def _message(reader: _Reader) -> bytes | None:
    """One complete data message, defragmented; None once the peer closes."""
    payload = b""
    while True:
        first = reader.exact(1)[0]
        length = reader.exact(1)[0] & 0x7F
        if length == 126:
            length = struct.unpack("!H", reader.exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", reader.exact(8))[0]
        data = reader.exact(length)
        opcode = first & 0x0F
        if opcode == _CLOSE:
            return None
        if opcode in (_PING, _PONG):
            continue
        payload += data
        if first & _FIN:
            return payload


def _cause_exit_code(parsed: dict[str, Any]) -> int | None:
    """The numeric value of the ExitCode cause, or None when there is not a usable one."""
    for cause in parsed.get("details", {}).get("causes", []):
        if cause.get("reason") == "ExitCode":
            with suppress(ValueError):
                return int(cause.get("message", ""))
    return None


def _exit_code(payload: bytes) -> int:
    """The exit code the terminal Status frame reports, read off reason alone."""
    parsed: Any = None
    with suppress(ValueError):
        parsed = json.loads(payload)
    if not isinstance(parsed, dict):
        raise ExecTransportError(_UNREADABLE_STATUS)
    if parsed.get("status") == "Success":
        return 0
    if parsed.get("reason") == "NonZeroExitCode":
        code = _cause_exit_code(parsed)
        if code is not None:
            return code
    raise ExecRejected(str(parsed.get("message", "")), parsed.get("reason"))


def _readable(size: int) -> str:
    """A byte count in whole mebibytes when it divides evenly, plain bytes otherwise."""
    if size % _MIB == 0:
        return f"{size // _MIB} MiB"
    return f"{size} bytes"


def _text(data: bytearray) -> str:
    """Decoded once, over the whole stream, so no character and no byte is lost."""
    return data.decode("utf-8", "surrogateescape")


def _streams(reader: _Reader, limit: int | None) -> tuple[str, str, int]:
    """Demultiplexes the channels until the terminal status frame arrives."""
    out = bytearray()
    err = bytearray()
    while True:
        payload = _message(reader)
        if payload is None:
            raise ExecTransportError(_CLOSED_EARLY)
        if not payload:
            continue
        channel, data = payload[0], payload[1:]
        if channel == _STDOUT:
            out += data
        elif channel == _STDERR:
            err += data
        elif channel == _ERROR:
            return _text(out), _text(err), _exit_code(data)
        # Checked per append, not at the end: by the end the memory is already spent.
        if limit is not None and len(out) + len(err) > limit:
            raise ExecOutputTooLarge(_TOO_LARGE.format(limit=_readable(limit)))


def exec_in_pod(
    context: K8sContextLike,
    namespace: str,
    pod: str,
    container: str | None,
    command: list[str],
    stdin: str | bytes | None,
    timeout: float,
    *,
    impersonate_user: str | None = None,
    impersonate_groups: list[str] | None = None,
    max_output_bytes: int | None = None,
) -> tuple[str, str, int]:
    """Runs argv in a pod over the exec channel; returns (stdout, stderr, exit_code)."""
    call = _Call(namespace, pod, container, command, stdin, impersonate_user, impersonate_groups)
    key = base64.b64encode(os.urandom(16)).decode()
    wire = _connect(context, timeout)
    try:
        wire.write(_request(context, call, key))
        reader = _Reader(wire.read)
        protocol = _handshake(reader, key)
        if stdin is not None:
            _write_stdin(wire, stdin, protocol)
        return _streams(reader, max_output_bytes)
    except TimeoutError as exc:
        raise ExecTimeout(_TIMED_OUT.format(within=seconds(timeout))) from exc
    finally:
        wire.sock.close()


class ExecStdout:
    """A running exec's stdout read as a stream, one data message at a time (K8SEXEC-10)."""

    def __init__(self, reader: _Reader, timeout: float) -> None:
        self._reader = reader
        self._timeout = timeout
        self._stdout = bytearray()
        self._stderr = bytearray()
        self._ended = False
        self._code = 0

    def _more(self) -> bool:
        """Buffers the next stdout message; False once the status frame has ended the stream."""
        while not self._ended:
            try:
                payload = _message(self._reader)
            except TimeoutError as exc:
                raise ExecTimeout(_TIMED_OUT.format(within=seconds(self._timeout))) from exc
            if payload is None:
                raise ExecTransportError(_CLOSED_EARLY)
            if not payload:
                continue
            channel, data = payload[0], payload[1:]
            if channel == _STDOUT and data:
                self._stdout += data
                return True
            if channel == _STDERR:
                self._stderr += data[: _STDERR_KEPT - len(self._stderr)]
            elif channel == _ERROR:
                self._code = _exit_code(data)
                self._ended = True
        return False

    def read(self, size: int = -1) -> bytes:
        """Up to size bytes of stdout (all of it when negative); waits only on an empty buffer."""
        if size < 0:
            more = True
            while more:
                more = self._more()
            size = len(self._stdout)
        elif not self._stdout:
            self._more()
        taken = bytes(self._stdout[:size])
        del self._stdout[:size]
        return taken

    def finish(self) -> tuple[str, int]:
        """Reads on to the status frame, discarding unread stdout; returns (stderr, exit_code)."""
        self._stdout.clear()
        while self._more():
            self._stdout.clear()
        return _text(self._stderr), self._code


@contextmanager
def exec_stdout(
    context: K8sContextLike,
    namespace: str,
    pod: str,
    container: str | None,
    command: list[str],
    timeout: float,
    *,
    impersonate_user: str | None = None,
    impersonate_groups: list[str] | None = None,
) -> Iterator[ExecStdout]:
    """Runs argv in a pod and yields its stdout as a stream; standard input is never opened."""
    call = _Call(namespace, pod, container, command, None, impersonate_user, impersonate_groups)
    key = base64.b64encode(os.urandom(16)).decode()
    wire = _connect(context, timeout)
    try:
        reader = _Reader(wire.read)
        try:
            wire.write(_request(context, call, key))
            _handshake(reader, key)
        except TimeoutError as exc:
            raise ExecTimeout(_TIMED_OUT.format(within=seconds(timeout))) from exc
        yield ExecStdout(reader, timeout)
    finally:
        wire.sock.close()
