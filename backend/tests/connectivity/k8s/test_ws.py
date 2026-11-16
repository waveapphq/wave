"""K8s exec-channel WebSocket client tests (REQ-5.1.1, REQ-3.4.1.5).

The exec-channel core opens an RFC 6455 WebSocket over the same socket and TLS
plumbing the REST core uses, offers the v5 and v4 Kubernetes channel
subprotocols, demultiplexes stdout (channel 1), stderr (channel 2) and the
error/status stream (channel 3), writes a script body on the stdin channel
(channel 0) and ends it with the two-byte v5 close sentinel, and reads the exit
code out of the terminal Status frame keying on `reason` and `causes[].reason`
only, never on the message text. It stays vendorable: stdlib plus the bundled
TLS engine and nothing else.

Two constraints this file pins on the module it drives. The connect seam is the
module-level `_connect(context, timeout)`, so a scripted transport can replace
it without opening a socket. And the block-shaped timeout wording ("Command
execution timed out after N seconds" and its Script and Cp siblings) belongs to
the plugins, not here: this module raises `ExecTimeout` with its own transport
wording and each block renders its own.

With a proxy route in force the channel opens over a CONNECT tunnel the proxy
opens to the server, asked about as an https or http address, and a proxy
failure reads as an unreachable server (REQ-4.7.14).
"""

import base64
import hashlib
import importlib
import io
import json
import re
import socket
import socketserver
import ssl
import struct
import tarfile
import threading
import urllib.parse
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, suppress
from dataclasses import dataclass, field
from inspect import Parameter, signature
from typing import Any

import pytest

from tests.connectivity._proxy_servers import Proxy, closed_port
from tests.plugins.http.conftest import TLSMaterial
from wavecore.connectivity.k8s import ws
from wavecore.connectivity.k8s.ws import (
    ExecOutputTooLarge,
    ExecRejected,
    ExecTimeout,
    ExecTransportError,
    ExecVersionUnsupported,
    exec_in_pod,
)
from wavecore.connectivity.run_log import RUN_LOG, RunLog

_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
_V5 = "v5.channel.k8s.io"
_V4 = "v4.channel.k8s.io"
_V1 = "channel.k8s.io"
_FAKE_SERVER = "https://k8s.example:6443"
_NAMESPACE = "apps"
_POD = "web-1"
_CONTAINER = "app"
_COMMAND = ["sh", "-c", "echo hi there"]
_LIVE_TIMEOUT = 5.0

_STDIN = 0
_STDOUT = 1
_STDERR = 2
_ERROR = 3
_RESIZE = 4
_CLOSE_SENTINEL = 255

# Captured from the patched kwok fixture; the two carry different message text
# for the same non-zero exit, which is why the parser keys on reason only.
_V5_EXIT_7 = (
    '{"metadata":{},"status":"Failure",'
    '"message":"command terminated with non-zero exit code: '
    'command terminated with exit code 7",'
    '"reason":"NonZeroExitCode",'
    '"details":{"causes":[{"reason":"ExitCode","message":"7"}]}}'
)
_V4_EXIT_7 = (
    '{"metadata":{},"status":"Failure",'
    '"message":"command terminated with non-zero exit code: '
    'cmd wait: sh -c exit 7: exit status 7",'
    '"reason":"NonZeroExitCode",'
    '"details":{"causes":[{"reason":"ExitCode","message":"7"}]}}'
)
_SUCCESS = '{"metadata":{},"status":"Success"}'

_NOT_FOUND_MESSAGE = 'pods "web-1" not found'
_NOT_FOUND_STATUS = {
    "kind": "Status",
    "apiVersion": "v1",
    "metadata": {},
    "status": "Failure",
    "message": _NOT_FOUND_MESSAGE,
    "reason": "NotFound",
    "details": {"name": _POD, "kind": "pods"},
    "code": 404,
}

_BAD_ACCEPT_MESSAGE = (
    "Kubernetes exec channel handshake failed: Sec-WebSocket-Accept does not match"
)
_NO_SUBPROTOCOL_MESSAGE = (
    "Kubernetes exec channel handshake failed: the server negotiated no usable subprotocol"
)
_UNREADABLE_STATUS_MESSAGE = "Kubernetes exec channel sent an unreadable status frame"
_CLOSED_EARLY_MESSAGE = "Kubernetes exec channel closed before the command finished"
_NEEDS_V5_MESSAGE = "Kubernetes exec channel needs the v5 subprotocol to send standard input"

_CEILING = 10
_MIB = 1 << 20
_CEILING_MESSAGE = "Kubernetes exec channel produced more than 10 bytes of output"
_CEILING_MIB_MESSAGE = "Kubernetes exec channel produced more than 1 MiB of output"

_TAR_COMMAND = ["tar", "cf", "-", "/data"]
_STREAM_TIMEOUT = 30
_STREAM_TIMED_OUT = "Kubernetes exec channel timed out after 30 seconds"
_STDERR_KEPT = 65_536
_INTERNAL_ERROR_MESSAGE = "Internal error occurred: no exec found for container"
_INTERNAL_ERROR = json.dumps(
    {
        "metadata": {},
        "status": "Failure",
        "message": _INTERNAL_ERROR_MESSAGE,
        "reason": "InternalError",
    }
)


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


@dataclass(frozen=True)
class _Ctx:
    """Local mirror of the K8sContext attributes the exec channel consumes."""

    server: str
    ca_cert: str | None = None
    verify: bool = True
    server_name: str | None = None
    tls_min_version: str = "1.2"
    tls_max_version: str = "1.3"
    cipher_suites: list[str] | None = None
    token: str | None = None
    client_cert: str | None = None
    client_key: str | None = None
    namespace: str = "default"


def _accept_for(key: str) -> str:
    """The Sec-WebSocket-Accept value RFC 6455 section 4.2.2 derives from a key."""
    return base64.b64encode(hashlib.sha1((key + _GUID).encode()).digest()).decode()


def _frame(payload: bytes, *, opcode: int = 0x2, fin: bool = True) -> bytes:
    """One unmasked server-to-client frame."""
    head = bytes([(0x80 if fin else 0x00) | opcode])
    length = len(payload)
    if length < 126:
        return head + bytes([length]) + payload
    if length < 65536:
        return head + bytes([126]) + struct.pack("!H", length) + payload
    return head + bytes([127]) + struct.pack("!Q", length) + payload


def _channel(number: int, payload: bytes) -> bytes:
    """One complete channel message as a single binary frame."""
    return _frame(bytes([number]) + payload)


def _status(text: str) -> bytes:
    """The terminal Status frame on the error channel."""
    return _channel(_ERROR, text.encode())


def _split(data: bytes, cuts: list[int]) -> list[bytes]:
    bounds = [0, *cuts, len(data)]
    pieces = [data[start:end] for start, end in zip(bounds, bounds[1:], strict=False)]
    return [piece for piece in pieces if piece]


def _upgrade(
    protocol: str | None = _V5,
    *,
    status: int = 101,
    reason: str = "Switching Protocols",
    accept: str | None = None,
    body: bytes = b"",
) -> Callable[[str], Any]:
    """Builds the server's response head once the client's key is known."""

    def respond(key: str) -> bytes:
        lines = [f"HTTP/1.1 {status} {reason}"]
        if status == 101:
            lines += [
                "Upgrade: websocket",
                "Connection: Upgrade",
                f"Sec-WebSocket-Accept: {_accept_for(key) if accept is None else accept}",
            ]
            if protocol is not None:
                lines.append(f"Sec-WebSocket-Protocol: {protocol}")
        else:
            lines += ["Content-Type: application/json", f"Content-Length: {len(body)}"]
        return ("\r\n".join(lines) + "\r\n\r\n").encode() + body

    return respond


class _Timeout:
    """Placed in a read script where the socket deadline expires."""


class _FakeSocket:
    """Stands in for the connected socket; the client only ever closes it."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _ScriptedWire:
    """Fake transport: records every byte written, replays scripted socket reads."""

    def __init__(self, reads: list[Any], respond: Callable[[str], Any]) -> None:
        self.sock = _FakeSocket()
        self.writes: list[bytes] = []
        self._reads: list[Any] = list(reads)
        self._respond: Callable[[str], Any] | None = respond

    def write(self, data: bytes) -> None:
        self.writes.append(data)

    def read(self, size: int) -> bytes:
        if self._respond is not None:
            self._reads.insert(0, self._respond(_sent_key(self)))
            self._respond = None
        if not self._reads:
            return b""
        piece = self._reads.pop(0)
        if isinstance(piece, _Timeout):
            raise TimeoutError("timed out")
        if len(piece) > size:
            self._reads.insert(0, piece[size:])
            return piece[:size]
        return piece

    @property
    def unread(self) -> list[Any]:
        """Scripted reads the client never asked for."""
        return list(self._reads)


def _wire(
    monkeypatch: pytest.MonkeyPatch,
    reads: list[Any] | None = None,
    respond: Callable[[str], Any] | None = None,
) -> _ScriptedWire:
    """A scripted transport in place of the connect seam - no socket is opened."""
    scripted = _ScriptedWire(reads or [], _upgrade() if respond is None else respond)
    monkeypatch.setattr(ws, "_connect", lambda *_args, **_kwargs: scripted)
    return scripted


def _run(**overrides: Any) -> tuple[str, str, int]:
    """Call the pinned signature positionally, so its argument order is exercised."""
    fields: dict[str, Any] = {
        "context": _Ctx(server=_FAKE_SERVER, token="sa-tok"),
        "namespace": _NAMESPACE,
        "pod": _POD,
        "container": _CONTAINER,
        "command": list(_COMMAND),
        "stdin": None,
        "timeout": _LIVE_TIMEOUT,
        "impersonate_user": None,
        "impersonate_groups": None,
        "max_output_bytes": None,
    }
    fields.update(overrides)
    return exec_in_pod(
        fields["context"],
        fields["namespace"],
        fields["pod"],
        fields["container"],
        fields["command"],
        fields["stdin"],
        fields["timeout"],
        impersonate_user=fields["impersonate_user"],
        impersonate_groups=fields["impersonate_groups"],
        max_output_bytes=fields["max_output_bytes"],
    )


class _BodyFailure(Exception):
    """Raised inside a stream block to prove the socket still closes."""


def _open(**overrides: Any) -> AbstractContextManager[Any]:
    """Call exec_stdout positionally, so its argument order is exercised."""
    fields: dict[str, Any] = {
        "context": _Ctx(server=_FAKE_SERVER, token="sa-tok"),
        "namespace": _NAMESPACE,
        "pod": _POD,
        "container": _CONTAINER,
        "command": list(_TAR_COMMAND),
        "timeout": _STREAM_TIMEOUT,
        "impersonate_user": None,
        "impersonate_groups": None,
    }
    fields.update(overrides)
    manager: AbstractContextManager[Any] = ws.exec_stdout(
        fields["context"],
        fields["namespace"],
        fields["pod"],
        fields["container"],
        fields["command"],
        fields["timeout"],
        impersonate_user=fields["impersonate_user"],
        impersonate_groups=fields["impersonate_groups"],
    )
    return manager


def _drain(**overrides: Any) -> tuple[bytes, str, int]:
    """Opens a stream, reads all of stdout, then finishes it."""
    with _open(**overrides) as stream:
        stdout = stream.read()
        stderr, code = stream.finish()
    return stdout, stderr, code


def _tar(members: dict[str, bytes]) -> bytes:
    """An uncompressed tar archive holding each member as a regular file."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def _head(wire: _ScriptedWire) -> str:
    return b"".join(wire.writes).partition(b"\r\n\r\n")[0].decode()


def _request_line(wire: _ScriptedWire) -> str:
    return _head(wire).split("\r\n")[0]


def _headers(wire: _ScriptedWire) -> dict[str, list[str]]:
    """Every request header, lower-cased, as a list per name so repeats survive."""
    found: dict[str, list[str]] = {}
    for line in _head(wire).split("\r\n")[1:]:
        name, _, value = line.partition(":")
        found.setdefault(name.strip().lower(), []).append(value.strip())
    return found


def _sent_key(wire: _ScriptedWire) -> str:
    return _headers(wire)["sec-websocket-key"][0]


def _path(wire: _ScriptedWire) -> str:
    return urllib.parse.urlsplit(_request_line(wire).split(" ")[1]).path


def _query(wire: _ScriptedWire) -> list[tuple[str, str]]:
    target = urllib.parse.urlsplit(_request_line(wire).split(" ")[1])
    return urllib.parse.parse_qsl(target.query, keep_blank_values=True)


def _offered(wire: _ScriptedWire) -> list[str]:
    return [part.strip() for part in _headers(wire)["sec-websocket-protocol"][0].split(",")]


@dataclass
class _Traffic:
    """The client's complete messages after the handshake, unmasked."""

    data: list[bytes]
    control: list[tuple[int, bytes]]


def _traffic(wire: _ScriptedWire) -> _Traffic:
    rest = b"".join(wire.writes).partition(b"\r\n\r\n")[2]
    data: list[bytes] = []
    control: list[tuple[int, bytes]] = []
    buffer = b""
    opcode = 0x0
    while rest:
        fin = bool(rest[0] & 0x80)
        code = rest[0] & 0x0F
        masked = bool(rest[1] & 0x80)
        length = rest[1] & 0x7F
        offset = 2
        if length == 126:
            length = struct.unpack("!H", rest[2:4])[0]
            offset = 4
        elif length == 127:
            length = struct.unpack("!Q", rest[2:10])[0]
            offset = 10
        assert masked, "RFC 6455 section 5.3 requires every client frame to be masked"
        mask = rest[offset : offset + 4]
        offset += 4
        raw = rest[offset : offset + length]
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(raw))
        rest = rest[offset + length :]
        if code in (0x8, 0x9, 0xA):
            control.append((code, payload))
            continue
        if code != 0x0:
            opcode = code
        buffer += payload
        if fin:
            if opcode in (0x1, 0x2):
                data.append(buffer)
            buffer = b""
    return _Traffic(data, control)


class _ExecRequestHandler(socketserver.BaseRequestHandler):
    """Answers one exec upgrade by hand, then writes the scripted frames."""

    def handle(self) -> None:
        server: Any = self.server
        self.request.settimeout(_LIVE_TIMEOUT)
        head = b""
        while b"\r\n\r\n" not in head:
            piece = self.request.recv(4096)
            if not piece:
                return
            head += piece
        lines = head.decode(errors="replace").split("\r\n")
        server.request_lines.append(lines[0])
        key = ""
        for line in lines[1:]:
            name, _, value = line.partition(":")
            if name.strip().lower() == "sec-websocket-key":
                key = value.strip()
        response = _upgrade(server.protocol, accept=server.accept)(key)
        self.request.sendall(response)
        for frame in server.script:
            self.request.sendall(frame)
        with suppress(OSError):
            self.request.shutdown(socket.SHUT_WR)
        with suppress(OSError):
            while self.request.recv(4096):
                pass


class _ExecServer(socketserver.ThreadingTCPServer):
    """Raw in-process TCP server speaking the exec upgrade and channel frames."""

    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self, script: list[bytes], *, protocol: str | None = _V5, accept: str | None = None
    ) -> None:
        super().__init__(("127.0.0.1", 0), _ExecRequestHandler)
        self.script = script
        self.protocol = protocol
        self.accept = accept
        self.request_lines: list[str] = []
        self.base_url = ""
        self.thread: threading.Thread | None = None

    def handle_error(self, request: Any, client_address: Any) -> None:
        """Silence disconnect noise from negative-path tests."""


def _start(server: _ExecServer, scheme: str) -> _ExecServer:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    server.thread = thread
    server.base_url = f"{scheme}://127.0.0.1:{server.server_address[1]}"
    return server


@pytest.fixture
def exec_server() -> Generator[Callable[..., _ExecServer], None, None]:
    """Starts raw exec servers and tears every one of them down deterministically."""
    started: list[_ExecServer] = []

    def start(script: list[bytes], **overrides: Any) -> _ExecServer:
        material: TLSMaterial | None = overrides.pop("material", None)
        server = _ExecServer(script, **overrides)
        started.append(server)
        if material is None:
            return _start(server, "http")
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(material.server_cert_path, material.server_key_path)
        # HTTPServer.socket is typed as a plain socket; wrap_socket returns ssl.SSLSocket.
        server.socket = context.wrap_socket(server.socket, server_side=True)  # type: ignore[assignment]
        return _start(server, "https")

    yield start
    for server in started:
        server.shutdown()
        server.server_close()
        if server.thread is not None:
            server.thread.join(timeout=_LIVE_TIMEOUT)


@pytest.fixture(scope="module")
def tls_material(tmp_path_factory: pytest.TempPathFactory) -> TLSMaterial:
    return TLSMaterial(tmp_path_factory.mktemp("k8s-ws-tls-material"))


@dataclass
class _WaveTrust:
    """WAVE's active trust set as the test sets it, plus every anchors lookup made."""

    spec: Any
    pem: str
    calls: list[Any] = field(default_factory=list)


@pytest.fixture
def wave_trust(monkeypatch: pytest.MonkeyPatch, tls_material: TLSMaterial) -> _WaveTrust:
    """WAVE's trust set holds the lab CA; each anchors_pem call is recorded (REQ-4.5.16)."""
    trust_store = importlib.import_module("wavecore.connectivity.trust_store")
    trust = _WaveTrust(
        spec=trust_store.TrustSpec(
            source="builtin",
            additional_pem=tls_material.ca_cert_pem,
            additional_count=1,
            builtin_label="June 2026",
        ),
        pem=tls_material.ca_cert_pem,
    )

    def anchors(spec: Any, *_args: Any, **_kwargs: Any) -> str:
        trust.calls.append(spec)
        return trust.pem

    monkeypatch.setattr(trust_store, "active_spec", lambda: trust.spec)
    monkeypatch.setattr(trust_store, "anchors_pem", anchors)
    return trust


def _untrusted(base_url: str) -> str:
    return (
        f"Could not verify the TLS certificate of {base_url}: "
        "Certificate verification failed: no trusted issuer found "
        'for certificate "CN=wave-test-server"'
    )


class TestModuleContract:
    """The public surface the module implements and the plugins bind to."""

    def test_exec_in_pod_takes_the_pinned_positional_arguments_in_order(self) -> None:
        names = [
            name
            for name, parameter in signature(exec_in_pod).parameters.items()
            if parameter.kind is Parameter.POSITIONAL_OR_KEYWORD
        ]

        assert names == [
            "context",
            "namespace",
            "pod",
            "container",
            "command",
            "stdin",
            "timeout",
        ]

    def test_impersonation_is_keyword_only_and_defaults_to_absent(self) -> None:
        parameters = signature(exec_in_pod).parameters

        assert parameters["impersonate_user"].kind is Parameter.KEYWORD_ONLY
        assert parameters["impersonate_groups"].kind is Parameter.KEYWORD_ONLY
        assert parameters["impersonate_user"].default is None
        assert parameters["impersonate_groups"].default is None

    def test_the_output_ceiling_is_keyword_only_and_defaults_to_unbounded(self) -> None:
        parameter = signature(exec_in_pod).parameters["max_output_bytes"]

        assert parameter.kind is Parameter.KEYWORD_ONLY
        assert parameter.default is None

    def test_the_connect_seam_is_a_module_level_function(self) -> None:
        assert list(signature(ws._connect).parameters) == ["context", "timeout"]

    @pytest.mark.parametrize(
        "raised",
        [
            ExecTimeout,
            ExecTransportError,
            ExecRejected,
            ExecVersionUnsupported,
            ExecOutputTooLarge,
        ],
    )
    def test_every_raised_class_is_an_exception(self, raised: type) -> None:
        assert issubclass(raised, Exception)

    @pytest.mark.parametrize(
        ("first", "second"),
        [
            (ExecTimeout, ExecTransportError),
            (ExecTimeout, ExecRejected),
            (ExecTimeout, ExecVersionUnsupported),
            (ExecTimeout, ExecOutputTooLarge),
            (ExecTransportError, ExecRejected),
            (ExecTransportError, ExecVersionUnsupported),
            (ExecTransportError, ExecOutputTooLarge),
            (ExecRejected, ExecVersionUnsupported),
            (ExecRejected, ExecOutputTooLarge),
            (ExecVersionUnsupported, ExecOutputTooLarge),
        ],
    )
    def test_the_raised_classes_are_disjoint(self, first: type, second: type) -> None:
        assert not issubclass(first, second)
        assert not issubclass(second, first)

    def test_a_rejection_carries_the_cluster_message_and_reason(self) -> None:
        rejected = ExecRejected("pods not found", "NotFound")

        assert rejected.message == "pods not found"
        assert rejected.reason == "NotFound"
        assert str(rejected) == "pods not found"


class TestHandshakeRequest:
    """The bytes the client puts on the wire to open the channel."""

    def test_the_request_line_targets_the_pods_exec_subresource(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert _path(wire) == f"/api/v1/namespaces/{_NAMESPACE}/pods/{_POD}/exec"

    def test_the_request_is_a_get_over_http_eleven(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert _request_line(wire).startswith("GET /")
        assert _request_line(wire).endswith(" HTTP/1.1")

    def test_a_gateway_path_prefix_is_preserved(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(context=_Ctx(server="https://gw.example/k8s"))

        assert _path(wire) == f"/k8s/api/v1/namespaces/{_NAMESPACE}/pods/{_POD}/exec"

    def test_the_host_header_carries_the_server_authority(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert _headers(wire)["host"] == ["k8s.example:6443"]

    def test_each_argv_element_is_one_repeated_command_parameter(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert [value for name, value in _query(wire) if name == "command"] == list(_COMMAND)

    def test_a_single_argument_command_sends_one_command_parameter(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(command=["uptime"])

        assert [value for name, value in _query(wire) if name == "command"] == ["uptime"]

    def test_the_container_rides_its_own_query_parameter(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert [value for name, value in _query(wire) if name == "container"] == [_CONTAINER]

    @pytest.mark.parametrize("container", [None, ""])
    def test_no_container_sends_no_container_parameter(
        self, monkeypatch: pytest.MonkeyPatch, container: str | None
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(container=container)

        assert "container" not in dict(_query(wire))

    def test_both_output_streams_are_requested(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert dict(_query(wire))["stdout"] == "true"
        assert dict(_query(wire))["stderr"] == "true"

    def test_no_stdin_parameter_is_sent_when_no_body_is_supplied(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert "stdin" not in dict(_query(wire))

    def test_stdin_is_requested_when_a_body_is_supplied(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin="echo hi\n")

        assert dict(_query(wire))["stdin"] == "true"

    def test_no_tty_is_ever_requested(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert "tty" not in dict(_query(wire))

    def test_an_argument_containing_spaces_survives_the_query_encoding(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(command=["sh", "-c", "echo one  two&three=four"])

        assert [value for name, value in _query(wire) if name == "command"] == [
            "sh",
            "-c",
            "echo one  two&three=four",
        ]

    def test_the_upgrade_headers_are_present(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert _headers(wire)["upgrade"] == ["websocket"]
        assert _headers(wire)["connection"] == ["Upgrade"]

    def test_the_websocket_version_is_thirteen(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert _headers(wire)["sec-websocket-version"] == ["13"]

    def test_the_websocket_key_is_sixteen_random_base64_encoded_bytes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert len(base64.b64decode(_sent_key(wire), validate=True)) == 16

    def test_each_handshake_uses_a_fresh_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        first = _wire(monkeypatch, [_status(_SUCCESS)])
        _run()
        second = _wire(monkeypatch, [_status(_SUCCESS)])
        _run()

        assert _sent_key(first) != _sent_key(second)

    def test_the_bearer_token_rides_the_authorization_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert _headers(wire)["authorization"] == ["Bearer sa-tok"]

    def test_an_anonymous_context_sends_no_authorization_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(context=_Ctx(server=_FAKE_SERVER))

        assert "authorization" not in _headers(wire)


class TestImpersonation:
    """The two keyword-only arguments render the headers the REST client renders."""

    def test_the_user_rides_the_impersonate_user_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(impersonate_user="qa-bot")

        assert _headers(wire)["impersonate-user"] == ["qa-bot"]

    def test_each_group_rides_its_own_impersonate_group_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(impersonate_user="qa-bot", impersonate_groups=["readers", "writers"])

        assert _headers(wire)["impersonate-group"] == ["readers", "writers"]

    def test_no_impersonation_headers_are_sent_by_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert "impersonate-user" not in _headers(wire)
        assert "impersonate-group" not in _headers(wire)

    def test_groups_without_a_user_send_no_user_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(impersonate_groups=["readers"])

        assert "impersonate-user" not in _headers(wire)
        assert _headers(wire)["impersonate-group"] == ["readers"]


class TestSubprotocolNegotiation:
    """v5 and v4 are offered; what the server picked comes out of the 101."""

    def test_exactly_v5_then_v4_are_offered(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert _offered(wire) == [_V5, _V4]

    def test_a_v5_server_runs_the_command(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"ok\n"), _status(_SUCCESS)], _upgrade(_V5))

        assert _run() == ("ok\n", "", 0)

    def test_a_v4_only_server_runs_the_command(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"ok\n"), _status(_SUCCESS)], _upgrade(_V4))

        assert _run() == ("ok\n", "", 0)

    def test_stdin_on_a_v4_only_server_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)], _upgrade(_V4))

        with pytest.raises(ExecVersionUnsupported, match=_exact(_NEEDS_V5_MESSAGE)):
            _run(stdin="echo hi\n")

    def test_the_v4_refusal_writes_nothing_on_the_channel(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)], _upgrade(_V4))

        with pytest.raises(ExecVersionUnsupported):
            _run(stdin="echo hi\n")

        assert _traffic(wire).data == []

    def test_the_v4_refusal_closes_the_socket(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)], _upgrade(_V4))

        with pytest.raises(ExecVersionUnsupported):
            _run(stdin="echo hi\n")

        assert wire.sock.closed is True

    def test_stdin_on_a_v5_server_is_accepted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"hi\n"), _status(_SUCCESS)], _upgrade(_V5))

        assert _run(stdin="echo hi\n") == ("hi\n", "", 0)

    @pytest.mark.parametrize("negotiated", [_V1, "base64.channel.k8s.io", None])
    def test_a_subprotocol_below_v4_is_a_handshake_failure(
        self, monkeypatch: pytest.MonkeyPatch, negotiated: str | None
    ) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)], _upgrade(negotiated))

        with pytest.raises(ExecTransportError, match=_exact(_NO_SUBPROTOCOL_MESSAGE)):
            _run()

    def test_the_negotiated_name_is_read_case_insensitively(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)], _upgrade(_V5.upper()))

        assert _run() == ("", "", 0)


class TestHandshakeResponse:
    """The 101 is verified before a single frame is read."""

    def test_a_correct_accept_value_is_taken(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)])

        assert _run() == ("", "", 0)

    def test_a_wrong_accept_value_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)], _upgrade(accept="c29tZXRoaW5nIGVsc2U="))

        with pytest.raises(ExecTransportError, match=_exact(_BAD_ACCEPT_MESSAGE)):
            _run()

    def test_a_missing_accept_header_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def respond(key: str) -> bytes:
            head = "\r\n".join(
                [
                    "HTTP/1.1 101 Switching Protocols",
                    "Upgrade: websocket",
                    "Connection: Upgrade",
                    f"Sec-WebSocket-Protocol: {_V5}",
                ]
            )
            return (head + "\r\n\r\n").encode()

        _wire(monkeypatch, [_status(_SUCCESS)], respond)

        with pytest.raises(ExecTransportError, match=_exact(_BAD_ACCEPT_MESSAGE)):
            _run()

    def test_the_accept_check_is_the_sha1_of_the_key_and_the_rfc_guid(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured: list[str] = []

        def respond(key: str) -> bytes:
            captured.append(key)
            return _upgrade()(key)

        _wire(monkeypatch, [_status(_SUCCESS)], respond)

        _run()

        digest = hashlib.sha1((captured[0] + _GUID).encode()).digest()
        assert _accept_for(captured[0]) == base64.b64encode(digest).decode()

    def test_a_non_101_status_without_a_status_body_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [],
            _upgrade(status=502, reason="Bad Gateway", body=b"<html>gateway</html>"),
        )

        with pytest.raises(
            ExecTransportError,
            match=_exact("Kubernetes refused the exec channel upgrade (HTTP 502)"),
        ):
            _run()

    def test_a_non_101_status_with_a_status_body_is_a_cluster_rejection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        body = json.dumps(_NOT_FOUND_STATUS).encode()
        _wire(monkeypatch, [], _upgrade(status=404, reason="Not Found", body=body))

        with pytest.raises(ExecRejected, match=_exact(_NOT_FOUND_MESSAGE)):
            _run()

    def test_the_handshake_rejection_carries_the_cluster_reason(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        body = json.dumps(_NOT_FOUND_STATUS).encode()
        _wire(monkeypatch, [], _upgrade(status=404, reason="Not Found", body=body))

        with pytest.raises(ExecRejected) as caught:
            _run()

        assert caught.value.reason == "NotFound"

    def test_a_forbidden_upgrade_carries_the_cluster_reason(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        body = json.dumps(
            {"kind": "Status", "status": "Failure", "message": "denied", "reason": "Forbidden"}
        ).encode()
        _wire(monkeypatch, [], _upgrade(status=403, reason="Forbidden", body=body))

        with pytest.raises(ExecRejected, match=_exact("denied")) as caught:
            _run()

        assert caught.value.reason == "Forbidden"

    def test_a_handshake_that_ends_before_the_head_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [], lambda _key: b"HTTP/1.1 101 Switching")

        with pytest.raises(ExecTransportError, match=_exact(_CLOSED_EARLY_MESSAGE)):
            _run()

    def test_the_socket_is_closed_after_a_refused_upgrade(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [], _upgrade(status=502, reason="Bad Gateway"))

        with pytest.raises(ExecTransportError):
            _run()

        assert wire.sock.closed is True


class TestChannelDemux:
    """Channel 1 is stdout, channel 2 is stderr, and nothing else leaks into them."""

    def test_stdout_and_stderr_stay_separate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDERR, b"to-err\n"),
                _channel(_STDOUT, b"to-out\n"),
                _status(_SUCCESS),
            ],
        )

        assert _run() == ("to-out\n", "to-err\n", 0)

    def test_consecutive_stdout_messages_concatenate_in_order(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"one "),
                _channel(_STDOUT, b"two "),
                _channel(_STDOUT, b"three"),
                _status(_SUCCESS),
            ],
        )

        assert _run()[0] == "one two three"

    def test_a_message_split_into_continuation_frames_reassembles(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _frame(bytes([_STDOUT]) + b"par", fin=False),
                _frame(b"tial", opcode=0x0),
                _status(_SUCCESS),
            ],
        )

        assert _run()[0] == "partial"

    def test_a_three_frame_fragment_sequence_reassembles(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _frame(bytes([_STDERR]) + b"a", fin=False),
                _frame(b"b", opcode=0x0, fin=False),
                _frame(b"c", opcode=0x0),
                _status(_SUCCESS),
            ],
        )

        assert _run()[1] == "abc"

    def test_a_frame_arriving_in_socket_sized_pieces_reassembles(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = _channel(_STDOUT, b"chopped up on the wire")
        _wire(monkeypatch, [*_split(payload, [1, 2, 5, 9]), _status(_SUCCESS)])

        assert _run()[0] == "chopped up on the wire"

    def test_a_medium_payload_uses_the_two_byte_length_form(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = b"x" * 1000
        _wire(monkeypatch, [_channel(_STDOUT, payload), _status(_SUCCESS)])

        assert _run()[0] == payload.decode()

    def test_a_large_payload_uses_the_eight_byte_length_form(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = b"y" * 70000
        _wire(monkeypatch, [_channel(_STDOUT, payload), _status(_SUCCESS)])

        assert _run()[0] == payload.decode()

    @pytest.mark.parametrize("number", [_STDIN, _RESIZE, 9])
    def test_frames_on_other_channels_are_discarded(
        self, monkeypatch: pytest.MonkeyPatch, number: int
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"kept"),
                _channel(number, b"ignored"),
                _status(_SUCCESS),
            ],
        )

        assert _run() == ("kept", "", 0)

    def test_an_empty_frame_carrying_no_channel_byte_is_discarded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_frame(b""), _channel(_STDOUT, b"kept"), _status(_SUCCESS)])

        assert _run()[0] == "kept"

    def test_a_channel_message_with_an_empty_payload_adds_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [_channel(_STDOUT, b""), _channel(_STDOUT, b"kept"), _status(_SUCCESS)],
        )

        assert _run()[0] == "kept"

    def test_a_ping_between_data_frames_does_not_corrupt_the_streams(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"before "),
                _frame(b"beat", opcode=0x9),
                _channel(_STDOUT, b"after"),
                _status(_SUCCESS),
            ],
        )

        assert _run()[0] == "before after"

    def test_a_pong_between_data_frames_does_not_corrupt_the_streams(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"before "),
                _frame(b"beat", opcode=0xA),
                _channel(_STDOUT, b"after"),
                _status(_SUCCESS),
            ],
        )

        assert _run()[0] == "before after"

    def test_a_close_frame_after_the_status_ends_the_read_cleanly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"done\n"),
                _status(_SUCCESS),
                _frame(b"\x03\xe8", opcode=0x8),
            ],
        )

        assert _run() == ("done\n", "", 0)

    def test_a_text_frame_is_demultiplexed_like_a_binary_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [_frame(bytes([_STDOUT]) + b"text", opcode=0x1), _status(_SUCCESS)],
        )

        assert _run()[0] == "text"

    def test_the_socket_is_closed_after_a_successful_exec(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert wire.sock.closed is True


class TestStreamDecoding:
    """Bytes are accumulated first and decoded once, so nothing is cut mid-character."""

    def test_a_multibyte_character_split_across_frames_decodes_whole(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        encoded = "héllo".encode()
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, encoded[:2]),
                _channel(_STDOUT, encoded[2:]),
                _status(_SUCCESS),
            ],
        )

        assert _run()[0] == "héllo"

    def test_bytes_that_are_not_utf8_round_trip_through_surrogate_escapes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = bytes(range(256))
        _wire(monkeypatch, [_channel(_STDOUT, payload), _status(_SUCCESS)])

        stdout = _run()[0]

        assert stdout.encode("utf-8", "surrogateescape") == payload

    def test_a_tar_shaped_payload_round_trips_byte_for_byte(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = b"data.txt" + b"\x00" * 92 + b"\xff\xfe\x00hello"
        _wire(monkeypatch, [_channel(_STDOUT, payload), _status(_SUCCESS)])

        assert _run()[0].encode("utf-8", "surrogateescape") == payload

    def test_stderr_decodes_the_same_way(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = b"\xc3"
        _wire(monkeypatch, [_channel(_STDERR, payload), _status(_SUCCESS)])

        assert _run()[1].encode("utf-8", "surrogateescape") == payload


class TestOutputCeiling:
    """max_output_bytes bounds what one call accumulates, so a runaway pod cannot exhaust memory."""

    def test_output_exactly_at_the_ceiling_is_returned(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"x" * _CEILING), _status(_SUCCESS)])

        assert _run(max_output_bytes=_CEILING)[0] == "x" * _CEILING

    def test_one_byte_over_the_ceiling_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"x" * (_CEILING + 1)), _status(_SUCCESS)])

        with pytest.raises(ExecOutputTooLarge, match=_exact(_CEILING_MESSAGE)):
            _run(max_output_bytes=_CEILING)

    def test_the_refusal_lands_before_the_rest_of_the_output_is_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"x" * (_CEILING + 1)),
                _channel(_STDOUT, b"y" * 100_000),
                _status(_SUCCESS),
            ],
        )

        with pytest.raises(ExecOutputTooLarge):
            _run(max_output_bytes=_CEILING)

        assert len(wire.unread) == 2

    def test_standard_error_counts_toward_the_ceiling(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"x" * 6),
                _channel(_STDERR, b"y" * 5),
                _status(_SUCCESS),
            ],
        )

        with pytest.raises(ExecOutputTooLarge, match=_exact(_CEILING_MESSAGE)):
            _run(max_output_bytes=_CEILING)

    def test_frames_on_other_channels_do_not_count_toward_the_ceiling(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_RESIZE, b"z" * 50),
                _channel(_STDOUT, b"x" * _CEILING),
                _status(_SUCCESS),
            ],
        )

        assert _run(max_output_bytes=_CEILING)[0] == "x" * _CEILING

    def test_no_ceiling_accumulates_without_limit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = b"z" * 200_000
        _wire(monkeypatch, [_channel(_STDOUT, payload), _status(_SUCCESS)])

        assert _run(max_output_bytes=None)[0] == payload.decode()

    def test_a_whole_mebibyte_ceiling_is_named_in_mebibytes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"x" * (_MIB + 1)), _status(_SUCCESS)])

        with pytest.raises(ExecOutputTooLarge, match=_exact(_CEILING_MIB_MESSAGE)):
            _run(max_output_bytes=_MIB)

    def test_the_socket_is_closed_when_the_ceiling_refuses(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_channel(_STDOUT, b"x" * (_CEILING + 1)), _status(_SUCCESS)])

        with pytest.raises(ExecOutputTooLarge):
            _run(max_output_bytes=_CEILING)

        assert wire.sock.closed is True


class TestStdinChannel:
    """The body goes out on channel 0 and the channel is closed with [255, 0]."""

    def test_the_body_is_written_on_channel_zero(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin="echo hi\n")

        body = [message for message in _traffic(wire).data if message[0] == _STDIN]
        assert b"".join(message[1:] for message in body) == b"echo hi\n"

    def test_a_string_body_is_encoded_as_utf8(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin="echo héllo\n")

        body = [message for message in _traffic(wire).data if message[0] == _STDIN]
        assert b"".join(message[1:] for message in body) == "echo héllo\n".encode()

    def test_a_bytes_body_is_written_verbatim(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin=b"\x00\xff\xfe raw")

        body = [message for message in _traffic(wire).data if message[0] == _STDIN]
        assert b"".join(message[1:] for message in body) == b"\x00\xff\xfe raw"

    def test_the_channel_is_closed_with_exactly_two_bytes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin="echo hi\n")

        assert _traffic(wire).data[-1] == bytes([_CLOSE_SENTINEL, _STDIN])
        assert len(_traffic(wire).data[-1]) == 2

    def test_the_close_sentinel_is_sent_exactly_once(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin="echo hi\n")

        sentinels = [message for message in _traffic(wire).data if message[0] == _CLOSE_SENTINEL]
        assert len(sentinels) == 1

    def test_the_whole_body_precedes_the_close(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin="line one\nline two\n")

        messages = _traffic(wire).data
        last_body = max(index for index, msg in enumerate(messages) if msg[0] == _STDIN)
        assert last_body < messages.index(bytes([_CLOSE_SENTINEL, _STDIN]))

    def test_nothing_is_ever_written_on_the_output_channels(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin="echo hi\n")

        written = {message[0] for message in _traffic(wire).data}
        assert written == {_STDIN, _CLOSE_SENTINEL}

    def test_a_large_body_reaches_the_server_whole(self, monkeypatch: pytest.MonkeyPatch) -> None:
        script = "print('x')\n" * 8000
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin=script)

        body = [message for message in _traffic(wire).data if message[0] == _STDIN]
        assert b"".join(message[1:] for message in body) == script.encode()

    def test_an_empty_body_still_closes_the_channel(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(stdin="")

        assert _traffic(wire).data[-1] == bytes([_CLOSE_SENTINEL, _STDIN])

    def test_no_body_writes_nothing_at_all(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_channel(_STDOUT, b"out"), _status(_SUCCESS)])

        _run()

        assert _traffic(wire).data == []

    def test_no_close_sentinel_is_sent_without_a_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run()

        assert bytes([_CLOSE_SENTINEL, _STDIN]) not in _traffic(wire).data


class TestStatusFrame:
    """The exit code is read off reason and causes[].reason, never off the text."""

    def test_the_v5_frame_for_a_non_zero_exit_yields_that_code(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status(_V5_EXIT_7)], _upgrade(_V5))

        assert _run()[2] == 7

    def test_the_v4_frame_for_the_same_exit_yields_the_same_code(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status(_V4_EXIT_7)], _upgrade(_V4))

        assert _run()[2] == 7

    def test_the_two_frames_differ_in_message_text_and_agree_on_the_code(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        assert json.loads(_V5_EXIT_7)["message"] != json.loads(_V4_EXIT_7)["message"]

        _wire(monkeypatch, [_status(_V5_EXIT_7)], _upgrade(_V5))
        v5_code = _run()[2]
        _wire(monkeypatch, [_status(_V4_EXIT_7)], _upgrade(_V4))
        v4_code = _run()[2]

        assert v5_code == v4_code == 7

    def test_a_clean_success_frame_yields_zero(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)])

        assert _run()[2] == 0

    def test_output_survives_a_non_zero_exit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"out\n"),
                _channel(_STDERR, b"err\n"),
                _status(_V5_EXIT_7),
            ],
        )

        assert _run() == ("out\n", "err\n", 7)

    @pytest.mark.parametrize("code", ["0", "1", "126", "127", "137", "255"])
    def test_any_exit_code_in_the_cause_is_returned_as_data(
        self, monkeypatch: pytest.MonkeyPatch, code: str
    ) -> None:
        frame = json.dumps(
            {
                "metadata": {},
                "status": "Failure",
                "message": "irrelevant text",
                "reason": "NonZeroExitCode",
                "details": {"causes": [{"reason": "ExitCode", "message": code}]},
            }
        )
        _wire(monkeypatch, [_status(frame)])

        assert _run()[2] == int(code)

    def test_the_exit_code_cause_is_found_among_other_causes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        frame = json.dumps(
            {
                "metadata": {},
                "status": "Failure",
                "message": "irrelevant text",
                "reason": "NonZeroExitCode",
                "details": {
                    "causes": [
                        {"reason": "FieldValueInvalid", "message": "3"},
                        {"reason": "ExitCode", "message": "9"},
                    ]
                },
            }
        )
        _wire(monkeypatch, [_status(frame)])

        assert _run()[2] == 9

    def test_a_message_that_names_an_exit_code_never_drives_the_result(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        frame = json.dumps(
            {
                "metadata": {},
                "status": "Success",
                "message": "command terminated with exit code 42",
            }
        )
        _wire(monkeypatch, [_status(frame)])

        assert _run()[2] == 0

    def test_a_non_exit_code_failure_is_a_cluster_rejection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        frame = json.dumps(
            {
                "metadata": {},
                "status": "Failure",
                "message": "Internal error occurred: no exec found for container",
                "reason": "InternalError",
            }
        )
        _wire(monkeypatch, [_status(frame)])

        with pytest.raises(
            ExecRejected,
            match=_exact("Internal error occurred: no exec found for container"),
        ) as caught:
            _run()

        assert caught.value.reason == "InternalError"

    def test_a_failure_with_no_reason_carries_no_reason(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        frame = json.dumps({"metadata": {}, "status": "Failure", "message": "no reason given"})
        _wire(monkeypatch, [_status(frame)])

        with pytest.raises(ExecRejected, match=_exact("no reason given")) as caught:
            _run()

        assert caught.value.reason is None

    def test_a_non_zero_exit_reason_without_an_exit_code_cause_is_a_rejection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        frame = json.dumps(
            {
                "metadata": {},
                "status": "Failure",
                "message": "command terminated",
                "reason": "NonZeroExitCode",
                "details": {"causes": []},
            }
        )
        _wire(monkeypatch, [_status(frame)])

        with pytest.raises(ExecRejected, match=_exact("command terminated")) as caught:
            _run()

        assert caught.value.reason == "NonZeroExitCode"

    def test_an_exit_code_cause_that_is_not_a_number_is_a_rejection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        frame = json.dumps(
            {
                "metadata": {},
                "status": "Failure",
                "message": "command terminated",
                "reason": "NonZeroExitCode",
                "details": {"causes": [{"reason": "ExitCode", "message": "not-a-number"}]},
            }
        )
        _wire(monkeypatch, [_status(frame)])

        with pytest.raises(ExecRejected, match=_exact("command terminated")):
            _run()

    def test_a_status_frame_that_is_not_json_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status("command terminated with exit code 7")])

        with pytest.raises(ExecTransportError, match=_exact(_UNREADABLE_STATUS_MESSAGE)):
            _run()

    def test_a_status_frame_that_is_not_an_object_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status("[1, 2, 3]")])

        with pytest.raises(ExecTransportError, match=_exact(_UNREADABLE_STATUS_MESSAGE)):
            _run()

    def test_a_status_frame_split_across_frames_reassembles_before_parsing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = _V5_EXIT_7.encode()
        _wire(
            monkeypatch,
            [
                _frame(bytes([_ERROR]) + payload[:20], fin=False),
                _frame(payload[20:], opcode=0x0),
            ],
        )

        assert _run()[2] == 7

    def test_a_channel_closed_before_any_status_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"partial output")])

        with pytest.raises(ExecTransportError, match=_exact(_CLOSED_EARLY_MESSAGE)):
            _run()

    def test_a_close_frame_before_any_status_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"partial"), _frame(b"", opcode=0x8)])

        with pytest.raises(ExecTransportError, match=_exact(_CLOSED_EARLY_MESSAGE)):
            _run()

    def test_the_socket_is_closed_after_a_cluster_rejection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        frame = json.dumps({"metadata": {}, "status": "Failure", "message": "denied"})
        wire = _wire(monkeypatch, [_status(frame)])

        with pytest.raises(ExecRejected):
            _run()

        assert wire.sock.closed is True


class TestTimeout:
    """A deadline that expires raises ExecTimeout, with this module's own wording."""

    def test_a_deadline_that_expires_raises_exec_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"slow"), _Timeout()])

        with pytest.raises(
            ExecTimeout, match=_exact("Kubernetes exec channel timed out after 30 seconds")
        ):
            _run(timeout=30)

    def test_a_deadline_during_the_handshake_raises_exec_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [], lambda _key: _Timeout())

        with pytest.raises(ExecTimeout):
            _run(timeout=30)

    def test_the_timeout_value_is_rendered_as_given(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_Timeout()])

        with pytest.raises(
            ExecTimeout, match=_exact("Kubernetes exec channel timed out after 60 seconds")
        ):
            _run(timeout=60)

    def test_a_one_second_deadline_is_named_in_the_singular(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_Timeout()])

        with pytest.raises(
            ExecTimeout, match=_exact("Kubernetes exec channel timed out after 1 second")
        ):
            _run(timeout=1)

    def test_a_timeout_is_not_a_transport_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_Timeout()])

        with pytest.raises(ExecTimeout) as caught:
            _run(timeout=30)

        assert not isinstance(caught.value, ExecTransportError)

    def test_the_block_shaped_timeout_wording_is_not_rendered_here(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_Timeout()])

        with pytest.raises(ExecTimeout) as caught:
            _run(timeout=60)

        block_wording = r"^Command execution timed out after \d+ seconds$"
        assert re.match(block_wording, str(caught.value)) is None

    def test_the_socket_is_closed_after_a_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_Timeout()])

        with pytest.raises(ExecTimeout):
            _run(timeout=30)

        assert wire.sock.closed is True


class TestTransportFailures:
    """Refused sockets, failed TLS and unreadable frames all raise ExecTransportError."""

    def test_a_refused_connection_renders_the_shared_transport_message(self) -> None:
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        server = f"https://127.0.0.1:{port}"

        with pytest.raises(
            ExecTransportError,
            match=rf"^Could not connect to the Kubernetes API at {re.escape(server)}: .+$",
        ):
            _run(context=_Ctx(server=server), timeout=_LIVE_TIMEOUT)

    def test_an_untrusted_server_certificate_renders_the_tls_message(
        self, exec_server: Callable[..., _ExecServer], tls_material: TLSMaterial
    ) -> None:
        server = exec_server([_status(_SUCCESS)], material=tls_material)
        message = (
            f"Could not verify the TLS certificate of {server.base_url}: "
            "Certificate verification failed: no trusted issuer found "
            'for certificate "CN=wave-test-server"'
        )

        with pytest.raises(ExecTransportError, match=_exact(message)):
            _run(context=_Ctx(server=server.base_url), timeout=_LIVE_TIMEOUT)

    def test_a_hostname_mismatch_renders_the_tls_message(
        self, exec_server: Callable[..., _ExecServer], tls_material: TLSMaterial
    ) -> None:
        server = exec_server([_status(_SUCCESS)], material=tls_material)
        context = _Ctx(
            server=server.base_url,
            ca_cert=tls_material.ca_cert_pem,
            server_name="wave-internal",
        )
        message = (
            f"Could not verify the TLS certificate of {server.base_url}: "
            'Certificate verification failed: hostname "wave-internal" does not match '
            "the server certificate"
        )

        with pytest.raises(ExecTransportError, match=_exact(message)):
            _run(context=context, timeout=_LIVE_TIMEOUT)


class TestLiveSocket:
    """One real round trip per transport, proving the handshake over a live socket."""

    def test_a_plain_socket_exec_returns_the_streams_and_the_exit_code(
        self, exec_server: Callable[..., _ExecServer]
    ) -> None:
        server = exec_server(
            [
                _channel(_STDERR, b"err\n"),
                _channel(_STDOUT, b"out\n"),
                _status(_V5_EXIT_7),
            ]
        )

        result = _run(context=_Ctx(server=server.base_url), timeout=_LIVE_TIMEOUT)

        assert result == ("out\n", "err\n", 7)

    def test_a_plain_socket_exec_sends_the_exec_request_line(
        self, exec_server: Callable[..., _ExecServer]
    ) -> None:
        server = exec_server([_status(_SUCCESS)])

        _run(context=_Ctx(server=server.base_url), timeout=_LIVE_TIMEOUT)

        assert f"/api/v1/namespaces/{_NAMESPACE}/pods/{_POD}/exec" in server.request_lines[0]

    def test_a_live_server_returning_a_wrong_accept_is_refused(
        self, exec_server: Callable[..., _ExecServer]
    ) -> None:
        server = exec_server([_status(_SUCCESS)], accept="bm90LXRoZS1yaWdodC1vbmU=")

        with pytest.raises(ExecTransportError, match=_exact(_BAD_ACCEPT_MESSAGE)):
            _run(context=_Ctx(server=server.base_url), timeout=_LIVE_TIMEOUT)

    def test_a_tls_socket_exec_returns_the_streams_and_the_exit_code(
        self, exec_server: Callable[..., _ExecServer], tls_material: TLSMaterial
    ) -> None:
        server = exec_server(
            [_channel(_STDOUT, b"secure\n"), _status(_SUCCESS)], material=tls_material
        )
        context = _Ctx(server=server.base_url, ca_cert=tls_material.ca_cert_pem)

        result = _run(context=context, timeout=_LIVE_TIMEOUT)

        assert result == ("secure\n", "", 0)

    def test_a_tls_socket_carries_the_stdin_body_and_the_close_sentinel(
        self, exec_server: Callable[..., _ExecServer], tls_material: TLSMaterial
    ) -> None:
        server = exec_server(
            [_channel(_STDOUT, b"scripted\n"), _status(_SUCCESS)], material=tls_material
        )
        context = _Ctx(server=server.base_url, ca_cert=tls_material.ca_cert_pem)

        result = _run(context=context, stdin="echo scripted\n", timeout=_LIVE_TIMEOUT)

        assert result == ("scripted\n", "", 0)

    def test_verification_can_be_turned_off(
        self, exec_server: Callable[..., _ExecServer], tls_material: TLSMaterial
    ) -> None:
        server = exec_server(
            [_channel(_STDOUT, b"unverified\n"), _status(_SUCCESS)], material=tls_material
        )
        context = _Ctx(server=server.base_url, verify=False)

        result = _run(context=context, timeout=_LIVE_TIMEOUT)

        assert result == ("unverified\n", "", 0)


class TestWaveTrust:
    """REQ-4.5.16: a blank CA trusts WAVE's trust set; a session CA is the only one trusted."""

    def test_a_blank_ca_verifies_against_waves_anchors(
        self,
        exec_server: Callable[..., _ExecServer],
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        server = exec_server(
            [_channel(_STDOUT, b"trusted\n"), _status(_SUCCESS)], material=tls_material
        )

        result = _run(context=_Ctx(server=server.base_url), timeout=_LIVE_TIMEOUT)

        assert result == ("trusted\n", "", 0)

    def test_a_blank_ca_reads_the_anchors_of_the_active_spec(
        self,
        exec_server: Callable[..., _ExecServer],
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        server = exec_server([_status(_SUCCESS)], material=tls_material)

        _run(context=_Ctx(server=server.base_url), timeout=_LIVE_TIMEOUT)

        assert wave_trust.calls == [wave_trust.spec]

    def test_a_blank_ca_refuses_a_server_waves_anchors_do_not_cover(
        self,
        exec_server: Callable[..., _ExecServer],
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        server = exec_server([_status(_SUCCESS)], material=tls_material)
        wave_trust.pem = tls_material.client_cert_pem

        with pytest.raises(ExecTransportError, match=_exact(_untrusted(server.base_url))):
            _run(context=_Ctx(server=server.base_url), timeout=_LIVE_TIMEOUT)

    def test_a_session_ca_is_the_only_certificate_trusted(
        self,
        exec_server: Callable[..., _ExecServer],
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        server = exec_server([_status(_SUCCESS)], material=tls_material)
        context = _Ctx(server=server.base_url, ca_cert=tls_material.client_cert_pem)

        with pytest.raises(ExecTransportError, match=_exact(_untrusted(server.base_url))):
            _run(context=context, timeout=_LIVE_TIMEOUT)

    def test_a_session_ca_never_reads_waves_anchors(
        self,
        exec_server: Callable[..., _ExecServer],
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        server = exec_server(
            [_channel(_STDOUT, b"pinned\n"), _status(_SUCCESS)], material=tls_material
        )
        context = _Ctx(server=server.base_url, ca_cert=tls_material.ca_cert_pem)

        result = _run(context=context, timeout=_LIVE_TIMEOUT)

        assert result == ("pinned\n", "", 0)
        assert wave_trust.calls == []

    def test_verify_off_never_reads_waves_anchors(
        self,
        exec_server: Callable[..., _ExecServer],
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        server = exec_server(
            [_channel(_STDOUT, b"unverified\n"), _status(_SUCCESS)], material=tls_material
        )
        wave_trust.pem = ""
        context = _Ctx(server=server.base_url, verify=False)

        result = _run(context=context, timeout=_LIVE_TIMEOUT)

        assert result == ("unverified\n", "", 0)
        assert wave_trust.calls == []

    def test_a_plain_socket_never_reads_waves_anchors(
        self, exec_server: Callable[..., _ExecServer], wave_trust: _WaveTrust
    ) -> None:
        server = exec_server([_status(_SUCCESS)])

        _run(context=_Ctx(server=server.base_url), timeout=_LIVE_TIMEOUT)

        assert wave_trust.calls == []


class TestStdoutStreamContract:
    """The streaming stdout reader's public surface, which the From Pod copy binds to."""

    def test_exec_stdout_takes_the_pinned_positional_arguments_in_order(self) -> None:
        names = [
            name
            for name, parameter in signature(ws.exec_stdout).parameters.items()
            if parameter.kind is Parameter.POSITIONAL_OR_KEYWORD
        ]

        assert names == ["context", "namespace", "pod", "container", "command", "timeout"]

    def test_only_impersonation_is_keyword_only_and_it_defaults_to_absent(self) -> None:
        keyword_only = {
            name: parameter.default
            for name, parameter in signature(ws.exec_stdout).parameters.items()
            if parameter.kind is Parameter.KEYWORD_ONLY
        }

        assert keyword_only == {"impersonate_user": None, "impersonate_groups": None}

    def test_exec_stdout_is_a_context_manager(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)])

        assert isinstance(_open(), AbstractContextManager)

    def test_nothing_connects_until_the_block_is_entered(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        connects: list[tuple[Any, ...]] = []
        monkeypatch.setattr(ws, "_connect", lambda *args, **_kwargs: connects.append(args))

        _open()

        assert connects == []

    def test_a_stream_is_built_from_a_reader_and_a_timeout(self) -> None:
        assert list(signature(ws.ExecStdout).parameters) == ["reader", "timeout"]

    def test_standard_error_is_kept_to_sixty_four_kibibytes(self) -> None:
        assert ws._STDERR_KEPT == _STDERR_KEPT

    def test_a_stream_reads_straight_off_the_reader_it_is_given(self) -> None:
        frames = iter([_channel(_STDOUT, b"direct"), _status(_SUCCESS)])
        stream = ws.ExecStdout(ws._Reader(lambda _size: next(frames, b"")), _STREAM_TIMEOUT)

        assert stream.read() == b"direct"
        assert stream.finish() == ("", 0)

    def test_a_stream_names_the_timeout_it_was_given(self) -> None:
        def expire(_size: int) -> bytes:
            raise TimeoutError("timed out")

        stream = ws.ExecStdout(ws._Reader(expire), 45)

        with pytest.raises(
            ExecTimeout, match=_exact("Kubernetes exec channel timed out after 45 seconds")
        ):
            stream.read(1)

    def test_a_one_second_stream_deadline_is_named_in_the_singular(self) -> None:
        def expire(_size: int) -> bytes:
            raise TimeoutError("timed out")

        stream = ws.ExecStdout(ws._Reader(expire), 1)

        with pytest.raises(
            ExecTimeout, match=_exact("Kubernetes exec channel timed out after 1 second")
        ):
            stream.read(1)


class TestStdoutStreamRequest:
    """The upgrade a stream sends: the exec request with standard input never opened."""

    def test_the_request_line_targets_the_pods_exec_subresource(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert _path(wire) == f"/api/v1/namespaces/{_NAMESPACE}/pods/{_POD}/exec"

    def test_each_argv_element_is_one_repeated_command_parameter(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert [value for name, value in _query(wire) if name == "command"] == _TAR_COMMAND

    def test_the_container_rides_its_own_query_parameter(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert [value for name, value in _query(wire) if name == "container"] == [_CONTAINER]

    @pytest.mark.parametrize("container", [None, ""])
    def test_no_container_sends_no_container_parameter(
        self, monkeypatch: pytest.MonkeyPatch, container: str | None
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain(container=container)

        assert "container" not in dict(_query(wire))

    def test_both_output_streams_are_requested(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert dict(_query(wire))["stdout"] == "true"
        assert dict(_query(wire))["stderr"] == "true"

    def test_standard_input_is_never_requested(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert "stdin" not in dict(_query(wire))

    def test_nothing_is_written_after_the_upgrade(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_channel(_STDOUT, b"out"), _status(_SUCCESS)])

        _drain()

        assert _traffic(wire) == _Traffic([], [])

    def test_exactly_v5_then_v4_are_offered(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert _offered(wire) == [_V5, _V4]

    def test_a_v4_only_server_streams_standard_output(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"ok"), _status(_SUCCESS)], _upgrade(_V4))

        assert _drain() == (b"ok", "", 0)

    def test_the_bearer_token_rides_the_authorization_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert _headers(wire)["authorization"] == ["Bearer sa-tok"]

    def test_the_connect_seam_receives_the_context_and_the_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        scripted = _ScriptedWire([_status(_SUCCESS)], _upgrade())
        seen: list[tuple[Any, Any]] = []

        def connect(context: Any, timeout: Any) -> _ScriptedWire:
            seen.append((context, timeout))
            return scripted

        monkeypatch.setattr(ws, "_connect", connect)
        context = _Ctx(server=_FAKE_SERVER, token="sa-tok")

        _drain(context=context, timeout=12)

        assert seen == [(context, 12)]

    def test_the_upgrade_is_sent_before_the_block_runs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        with _open():
            request_line = _request_line(wire)

        assert request_line.startswith("GET /")


class TestStdoutStreamImpersonation:
    """The two keyword-only arguments render the headers exec_in_pod renders."""

    def test_the_user_rides_the_impersonate_user_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain(impersonate_user="qa-bot")

        assert _headers(wire)["impersonate-user"] == ["qa-bot"]

    def test_each_group_rides_its_own_impersonate_group_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain(impersonate_user="qa-bot", impersonate_groups=["readers", "writers"])

        assert _headers(wire)["impersonate-group"] == ["readers", "writers"]

    def test_no_impersonation_headers_are_sent_by_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert "impersonate-user" not in _headers(wire)
        assert "impersonate-group" not in _headers(wire)


class TestStdoutStreamHandshake:
    """The 101 is verified when the block is entered, before the body runs."""

    def test_a_wrong_accept_value_is_refused_before_the_body_runs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)], _upgrade(accept="c29tZXRoaW5nIGVsc2U="))
        entered: list[bool] = []

        with pytest.raises(ExecTransportError, match=_exact(_BAD_ACCEPT_MESSAGE)), _open():
            entered.append(True)

        assert entered == []

    @pytest.mark.parametrize("negotiated", [_V1, None])
    def test_a_subprotocol_below_v4_is_a_handshake_failure(
        self, monkeypatch: pytest.MonkeyPatch, negotiated: str | None
    ) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)], _upgrade(negotiated))

        with pytest.raises(ExecTransportError, match=_exact(_NO_SUBPROTOCOL_MESSAGE)):
            _drain()

    def test_a_non_101_status_with_a_status_body_is_a_cluster_rejection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        body = json.dumps(_NOT_FOUND_STATUS).encode()
        _wire(monkeypatch, [], _upgrade(status=404, reason="Not Found", body=body))

        with pytest.raises(ExecRejected, match=_exact(_NOT_FOUND_MESSAGE)) as caught:
            _drain()

        assert caught.value.reason == "NotFound"

    def test_a_non_101_status_without_a_status_body_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [],
            _upgrade(status=502, reason="Bad Gateway", body=b"<html>gateway</html>"),
        )

        with pytest.raises(
            ExecTransportError,
            match=_exact("Kubernetes refused the exec channel upgrade (HTTP 502)"),
        ):
            _drain()

    def test_a_deadline_during_the_handshake_raises_exec_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [], lambda _key: _Timeout())

        with pytest.raises(ExecTimeout, match=_exact(_STREAM_TIMED_OUT)):
            _drain()

    def test_a_one_second_handshake_deadline_is_named_in_the_singular(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [], lambda _key: _Timeout())

        with pytest.raises(
            ExecTimeout, match=_exact("Kubernetes exec channel timed out after 1 second")
        ):
            _drain(timeout=1)

    def test_the_socket_is_closed_after_a_refused_upgrade(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [], _upgrade(status=502, reason="Bad Gateway"))

        with pytest.raises(ExecTransportError):
            _drain()

        assert wire.sock.closed is True

    def test_the_socket_is_closed_after_a_handshake_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [], lambda _key: _Timeout())

        with pytest.raises(ExecTimeout):
            _drain()

        assert wire.sock.closed is True


class TestStdoutStreamSocketLifetime:
    """The socket stays open while the block runs and is closed however the block ends."""

    def test_the_socket_stays_open_while_the_block_runs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_channel(_STDOUT, b"x"), _status(_SUCCESS)])

        with _open() as stream:
            stream.read(1)
            open_inside = not wire.sock.closed

        assert open_inside is True

    def test_the_socket_is_closed_when_the_block_ends(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _drain()

        assert wire.sock.closed is True

    def test_the_socket_is_closed_when_the_block_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_channel(_STDOUT, b"x"), _status(_SUCCESS)])

        with pytest.raises(_BodyFailure, match=_exact("body failed")), _open():
            raise _BodyFailure("body failed")

        assert wire.sock.closed is True

    def test_the_socket_is_closed_when_the_block_leaves_before_the_status(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_channel(_STDOUT, b"abc"), _status(_SUCCESS)])

        with _open() as stream:
            stream.read(1)

        assert wire.sock.closed is True

    def test_the_socket_is_closed_when_a_read_times_out(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_Timeout()])

        with pytest.raises(ExecTimeout), _open() as stream:
            stream.read(1)

        assert wire.sock.closed is True


class TestStdoutStreamRead:
    """read(size) hands out stdout as it arrives and never more than it was asked for."""

    def test_a_sized_read_hands_out_at_most_that_many_bytes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"abcdef"), _status(_SUCCESS)])

        with _open() as stream:
            assert stream.read(4) == b"abcd"

    def test_the_rest_of_a_message_is_kept_for_the_next_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"abcdef"), _status(_SUCCESS)])

        with _open() as stream:
            handed = [stream.read(4), stream.read(4)]

        assert handed == [b"abcd", b"ef"]

    def test_a_buffered_remainder_is_handed_out_without_reading_the_wire(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(
            monkeypatch,
            [_channel(_STDOUT, b"abcdef"), _channel(_STDOUT, b"ghi"), _status(_SUCCESS)],
        )

        with _open() as stream:
            stream.read(4)
            unread_before = wire.unread
            remainder = stream.read(4)
            unread_after = wire.unread

        assert remainder == b"ef"
        assert unread_after == unread_before

    def test_a_short_buffer_is_handed_out_rather_than_waiting_for_more(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(
            monkeypatch,
            [_channel(_STDOUT, b"abcdef"), _channel(_STDOUT, b"ghi"), _status(_SUCCESS)],
        )

        with _open() as stream:
            stream.read(4)
            remainder = stream.read(100)
            unread = wire.unread

        assert remainder == b"ef"
        assert unread == [_channel(_STDOUT, b"ghi"), _status(_SUCCESS)]

    def test_the_next_message_is_read_once_the_buffer_is_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(
            monkeypatch,
            [_channel(_STDOUT, b"abcdef"), _channel(_STDOUT, b"ghi"), _status(_SUCCESS)],
        )

        with _open() as stream:
            handed = [stream.read(4), stream.read(100), stream.read(100)]
            unread = wire.unread

        assert handed == [b"abcd", b"ef", b"ghi"]
        assert unread == [_status(_SUCCESS)]

    def test_the_first_read_waits_past_stderr_for_stdout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [_channel(_STDERR, b"warn"), _channel(_STDOUT, b"data"), _status(_SUCCESS)],
        )

        with _open() as stream:
            assert stream.read(100) == b"data"

    @pytest.mark.parametrize("args", [(), (-1,), (-7,)], ids=["default", "minus-one", "negative"])
    def test_a_read_without_a_size_returns_all_remaining_stdout(
        self, monkeypatch: pytest.MonkeyPatch, args: tuple[int, ...]
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"one "),
                _channel(_STDERR, b"e"),
                _channel(_STDOUT, b"two "),
                _channel(_STDOUT, b"three"),
                _status(_SUCCESS),
            ],
        )

        with _open() as stream:
            assert stream.read(*args) == b"one two three"

    def test_reading_all_after_a_sized_read_returns_the_rest(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [_channel(_STDOUT, b"abcdef"), _channel(_STDOUT, b"gh"), _status(_SUCCESS)],
        )

        with _open() as stream:
            handed = [stream.read(2), stream.read()]

        assert handed == [b"ab", b"cdefgh"]

    def test_stdout_bytes_are_handed_out_verbatim(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = bytes(range(256))
        _wire(monkeypatch, [_channel(_STDOUT, payload), _status(_SUCCESS)])

        assert _drain()[0] == payload

    def test_a_message_split_into_continuation_frames_reads_as_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _frame(bytes([_STDOUT]) + b"par", fin=False),
                _frame(b"tial", opcode=0x0),
                _status(_SUCCESS),
            ],
        )

        with _open() as stream:
            assert stream.read(100) == b"partial"

    def test_a_frame_arriving_in_socket_sized_pieces_reads_whole(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = _channel(_STDOUT, b"chopped up on the wire")
        _wire(monkeypatch, [*_split(payload, [1, 2, 5, 9]), _status(_SUCCESS)])

        assert _drain()[0] == b"chopped up on the wire"

    def test_a_large_message_reads_whole(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = b"z" * 200_000
        _wire(monkeypatch, [_channel(_STDOUT, payload), _status(_SUCCESS)])

        assert _drain()[0] == payload

    @pytest.mark.parametrize("number", [_STDIN, _RESIZE, 9])
    def test_frames_on_other_channels_are_discarded(
        self, monkeypatch: pytest.MonkeyPatch, number: int
    ) -> None:
        _wire(
            monkeypatch,
            [_channel(number, b"ignored"), _channel(_STDOUT, b"kept"), _status(_SUCCESS)],
        )

        assert _drain() == (b"kept", "", 0)

    def test_an_empty_stdout_message_does_not_end_the_stream(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [_channel(_STDOUT, b""), _channel(_STDOUT, b"kept"), _status(_SUCCESS)],
        )

        with _open() as stream:
            assert stream.read(100) == b"kept"

    def test_a_frame_carrying_no_channel_byte_is_skipped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_frame(b""), _channel(_STDOUT, b"kept"), _status(_SUCCESS)])

        with _open() as stream:
            assert stream.read(100) == b"kept"

    def test_pings_and_pongs_are_skipped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(
            monkeypatch,
            [
                _frame(b"beat", opcode=0x9),
                _channel(_STDOUT, b"before "),
                _frame(b"beat", opcode=0xA),
                _channel(_STDOUT, b"after"),
                _status(_SUCCESS),
            ],
        )

        assert _drain()[0] == b"before after"

    def test_a_text_frame_is_demultiplexed_like_a_binary_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [_frame(bytes([_STDOUT]) + b"text", opcode=0x1), _status(_SUCCESS)],
        )

        assert _drain()[0] == b"text"

    def test_a_tar_archive_streamed_over_several_messages_reads_member_by_member(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        members = {"a.txt": b"alpha\n", "dir/b.bin": bytes(range(256)) * 80}
        archive_bytes = _tar(members)
        pieces = [
            _channel(_STDOUT, archive_bytes[start : start + 7000])
            for start in range(0, len(archive_bytes), 7000)
        ]
        _wire(
            monkeypatch,
            [pieces[0], _channel(_STDERR, b"tar: note\n"), *pieces[1:], _status(_SUCCESS)],
        )
        found: dict[str, bytes] = {}

        with _open() as stream:
            with tarfile.open(fileobj=stream, mode="r|") as archive:
                for member in archive:
                    extracted = archive.extractfile(member)
                    assert extracted is not None
                    found[member.name] = extracted.read()
            outcome = stream.finish()

        assert found == members
        assert outcome == ("tar: note\n", 0)


class TestStdoutStreamStderr:
    """Channel 2 is kept, up to its first 65,536 bytes, and handed back by finish."""

    def test_stderr_interleaved_with_stdout_is_kept_in_order(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDERR, b"one "),
                _channel(_STDOUT, b"out"),
                _channel(_STDERR, b"two"),
                _status(_SUCCESS),
            ],
        )

        assert _drain() == (b"out", "one two", 0)

    def test_stderr_up_to_the_cap_is_kept_whole(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_channel(_STDERR, b"e" * _STDERR_KEPT), _status(_SUCCESS)])

        assert _drain()[1] == "e" * _STDERR_KEPT

    def test_stderr_past_the_cap_keeps_only_the_first_bytes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = b"a" * _STDERR_KEPT + b"b" * 4464
        _wire(monkeypatch, [_channel(_STDERR, payload), _status(_SUCCESS)])

        assert _drain()[1] == "a" * _STDERR_KEPT

    def test_the_cap_applies_across_messages(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDERR, b"a" * 60_000),
                _channel(_STDERR, b"b" * 10_000),
                _channel(_STDERR, b"c" * 10),
                _status(_SUCCESS),
            ],
        )

        assert _drain()[1] == "a" * 60_000 + "b" * 5_536

    def test_stderr_past_the_cap_does_not_stop_the_stream(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [_channel(_STDERR, b"e" * 70_000), _channel(_STDOUT, b"after"), _status(_V5_EXIT_7)],
        )

        stdout, stderr, code = _drain()

        assert (stdout, len(stderr), code) == (b"after", _STDERR_KEPT, 7)

    def test_a_multibyte_character_split_across_messages_decodes_whole(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        encoded = "héllo".encode()
        _wire(
            monkeypatch,
            [
                _channel(_STDERR, encoded[:2]),
                _channel(_STDERR, encoded[2:]),
                _status(_SUCCESS),
            ],
        )

        assert _drain()[1] == "héllo"

    def test_bytes_that_are_not_utf8_round_trip_through_surrogate_escapes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = bytes(range(256))
        _wire(monkeypatch, [_channel(_STDERR, payload), _status(_SUCCESS)])

        assert _drain()[1].encode("utf-8", "surrogateescape") == payload


class TestStdoutStreamStatus:
    """The channel 3 Status frame ends the stream and carries the exit code."""

    def test_the_status_frame_ends_the_stream(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"done"), _status(_SUCCESS)])

        with _open() as stream:
            handed = [stream.read(100), stream.read(100)]

        assert handed == [b"done", b""]

    def test_an_ended_stream_keeps_returning_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"done"), _status(_SUCCESS)])

        with _open() as stream:
            stream.read()
            after = [stream.read(100), stream.read(), stream.read(-1), stream.read(1)]

        assert after == [b"", b"", b"", b""]

    def test_nothing_is_read_from_the_wire_after_the_status(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        late = _channel(_STDOUT, b"late")
        wire = _wire(monkeypatch, [_channel(_STDOUT, b"done"), _status(_SUCCESS), late])

        with _open() as stream:
            handed = [stream.read(), stream.read(100)]
            unread = wire.unread

        assert handed == [b"done", b""]
        assert unread == [late]

    def test_a_success_status_is_exit_code_zero(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)])

        assert _drain() == (b"", "", 0)

    def test_a_v5_non_zero_exit_status_yields_its_code(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status(_V5_EXIT_7)], _upgrade(_V5))

        assert _drain()[2] == 7

    def test_a_v4_non_zero_exit_status_yields_its_code(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status(_V4_EXIT_7)], _upgrade(_V4))

        assert _drain()[2] == 7

    def test_output_survives_a_non_zero_exit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(
            monkeypatch,
            [_channel(_STDOUT, b"out\n"), _channel(_STDERR, b"err\n"), _status(_V5_EXIT_7)],
        )

        assert _drain() == (b"out\n", "err\n", 7)

    def test_a_non_exit_failure_is_a_cluster_rejection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status(_INTERNAL_ERROR)])

        with pytest.raises(ExecRejected, match=_exact(_INTERNAL_ERROR_MESSAGE)) as caught:
            _drain()

        assert caught.value.reason == "InternalError"

    def test_a_rejection_is_raised_once_the_buffered_stdout_is_handed_out(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"partial"), _status(_INTERNAL_ERROR)])

        with _open() as stream:
            first = stream.read(100)
            with pytest.raises(ExecRejected, match=_exact(_INTERNAL_ERROR_MESSAGE)):
                stream.read(100)

        assert first == b"partial"

    def test_a_non_zero_exit_reason_without_an_exit_code_cause_is_a_rejection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        frame = json.dumps(
            {
                "metadata": {},
                "status": "Failure",
                "message": "command terminated",
                "reason": "NonZeroExitCode",
                "details": {"causes": []},
            }
        )
        _wire(monkeypatch, [_status(frame)])

        with pytest.raises(ExecRejected, match=_exact("command terminated")) as caught:
            _drain()

        assert caught.value.reason == "NonZeroExitCode"

    def test_a_status_frame_that_is_not_json_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_status("command terminated with exit code 7")])

        with pytest.raises(ExecTransportError, match=_exact(_UNREADABLE_STATUS_MESSAGE)):
            _drain()


class TestStdoutStreamFailures:
    """An early close raises ExecTransportError and an expired deadline raises ExecTimeout."""

    def test_a_channel_closed_before_the_status_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"partial output")])

        with (
            pytest.raises(ExecTransportError, match=_exact(_CLOSED_EARLY_MESSAGE)),
            _open() as stream,
        ):
            stream.read()

    def test_buffered_stdout_is_handed_out_before_an_early_close_is_raised(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"partial")])

        with _open() as stream:
            first = stream.read(100)
            with pytest.raises(ExecTransportError, match=_exact(_CLOSED_EARLY_MESSAGE)):
                stream.read(100)

        assert first == b"partial"

    def test_a_close_frame_before_the_status_is_a_transport_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"partial"), _frame(b"", opcode=0x8)])

        with (
            pytest.raises(ExecTransportError, match=_exact(_CLOSED_EARLY_MESSAGE)),
            _open() as stream,
        ):
            stream.read()

    def test_a_deadline_that_expires_during_a_read_raises_exec_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"slow"), _Timeout()])

        with _open() as stream:
            first = stream.read(4)
            with pytest.raises(ExecTimeout, match=_exact(_STREAM_TIMED_OUT)):
                stream.read(4)

        assert first == b"slow"

    def test_the_timeout_value_is_rendered_as_given(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_Timeout()])

        with (
            pytest.raises(
                ExecTimeout, match=_exact("Kubernetes exec channel timed out after 2.5 seconds")
            ),
            _open(timeout=2.5) as stream,
        ):
            stream.read(1)

    def test_a_timeout_is_not_a_transport_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_Timeout()])

        with pytest.raises(ExecTimeout) as caught, _open() as stream:
            stream.read(1)

        assert not isinstance(caught.value, ExecTransportError)


class TestStdoutStreamFinish:
    """finish reads on to the Status frame, discarding stdout nobody asked for."""

    def test_finish_without_a_read_discards_stdout_and_returns_stderr_and_code(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [
                _channel(_STDOUT, b"tar padding"),
                _channel(_STDERR, b"warn"),
                _channel(_STDOUT, b"more"),
                _status(_V5_EXIT_7),
            ],
        )

        with _open() as stream:
            assert stream.finish() == ("warn", 7)

    def test_finish_after_a_partial_read_discards_the_rest(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(
            monkeypatch,
            [_channel(_STDOUT, b"abcdef"), _channel(_STDOUT, b"ghi"), _status(_SUCCESS)],
        )

        with _open() as stream:
            first = stream.read(2)
            outcome = stream.finish()
            after = stream.read()

        assert (first, outcome, after) == (b"ab", ("", 0), b"")

    def test_finish_reads_the_wire_to_the_status_and_no_further(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        late = _channel(_STDOUT, b"late")
        wire = _wire(monkeypatch, [_channel(_STDOUT, b"x"), _status(_SUCCESS), late])

        with _open() as stream:
            stream.finish()
            unread = wire.unread

        assert unread == [late]

    def test_finish_after_the_stream_ended_returns_what_it_gathered(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        late = _channel(_STDERR, b"late")
        wire = _wire(
            monkeypatch,
            [_channel(_STDOUT, b"x"), _channel(_STDERR, b"e"), _status(_V5_EXIT_7), late],
        )

        with _open() as stream:
            stream.read()
            outcome = stream.finish()
            unread = wire.unread

        assert outcome == ("e", 7)
        assert unread == [late]

    def test_a_stream_with_no_output_finishes_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_status(_SUCCESS)])

        with _open() as stream:
            assert stream.finish() == ("", 0)

    def test_finish_raises_a_cluster_rejection(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"x"), _status(_INTERNAL_ERROR)])

        with (
            pytest.raises(ExecRejected, match=_exact(_INTERNAL_ERROR_MESSAGE)) as caught,
            _open() as stream,
        ):
            stream.finish()

        assert caught.value.reason == "InternalError"

    def test_finish_raises_a_transport_failure_when_the_channel_closes_early(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"partial")])

        with (
            pytest.raises(ExecTransportError, match=_exact(_CLOSED_EARLY_MESSAGE)),
            _open() as stream,
        ):
            stream.finish()

    def test_finish_raises_a_transport_failure_on_a_close_frame(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"partial"), _frame(b"", opcode=0x8)])

        with (
            pytest.raises(ExecTransportError, match=_exact(_CLOSED_EARLY_MESSAGE)),
            _open() as stream,
        ):
            stream.finish()

    def test_finish_raises_exec_timeout_when_the_deadline_expires(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, [_channel(_STDOUT, b"x"), _Timeout()])

        with pytest.raises(ExecTimeout, match=_exact(_STREAM_TIMED_OUT)), _open() as stream:
            stream.finish()


class TestHostHeaderLogin:
    """A login written in the server address stays out of the Host header."""

    def test_the_host_header_carries_the_host_and_port_only(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(context=_Ctx(server="https://wave:pw@k8s.example:6443"))

        assert _headers(wire)["host"] == ["k8s.example:6443"]


class TestHostHeaderForm:
    """The Host header names the host, in brackets when IPv6, and the port only when written."""

    @pytest.mark.parametrize(
        ("server", "host"),
        [
            ("https://k8s.example", "k8s.example"),
            ("https://[::1]:6443", "[::1]:6443"),
            ("https://wave:pw@[2001:db8::1]", "[2001:db8::1]"),
        ],
        ids=["no-port", "ipv6", "ipv6-login-no-port"],
    )
    def test_the_host_header_is_the_host_and_the_port_as_written(
        self, monkeypatch: pytest.MonkeyPatch, server: str, host: str
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        _run(context=_Ctx(server=server))

        assert _headers(wire)["host"] == [host]


_PORT_ZERO = "https://k8s.example:0"
_PORT_ABOVE_THE_RANGE = "https://k8s.example:99999"
_PORTS_OUT_OF_RANGE = [_PORT_ZERO, "http://k8s.example:0", _PORT_ABOVE_THE_RANGE]
_PORT_IDS = ["zero", "zero-plain-http", "far-above"]
_NO_HOST = ["https://:6443", "https://wave@", "https://"]
_NO_HOST_IDS = ["port-without-host", "login-without-host", "scheme-only"]
_NOT_HTTP = ["ftp://k8s.example", "k8s.example:6443"]
_NOT_HTTP_IDS = ["another-scheme", "no-scheme"]


def _unverified(server: str) -> _Ctx:
    """The server's context with verification off, so no trust set is read."""
    return _Ctx(server=server, verify=False)


@pytest.fixture
def dials(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every address a connection is opened to; none is really dialed."""
    seen: list[Any] = []

    def dial(address: Any, *_args: Any, **_kwargs: Any) -> socket.socket:
        seen.append(address)
        raise ConnectionRefusedError(111, "Connection refused")

    monkeypatch.setattr(socket, "create_connection", dial)
    return seen


class TestRefusedServerAddress:
    """A server address with a bad port, no host or no http or https scheme opens no channel."""

    @pytest.mark.parametrize("server", _PORTS_OUT_OF_RANGE, ids=_PORT_IDS)
    def test_a_port_outside_1_to_65535_is_refused(self, server: str, dials: list[Any]) -> None:
        with pytest.raises(ValueError):
            _run(context=_unverified(server))

        assert dials == []

    def test_port_zero_fails_the_way_a_port_above_the_range_does(self, dials: list[Any]) -> None:
        with pytest.raises(ValueError) as zero:
            _run(context=_unverified(_PORT_ZERO))
        with pytest.raises(ValueError) as above:
            _run(context=_unverified(_PORT_ABOVE_THE_RANGE))

        assert type(zero.value) is type(above.value)
        assert dials == []

    @pytest.mark.parametrize("server", _NO_HOST, ids=_NO_HOST_IDS)
    def test_an_address_with_no_host_is_refused(self, server: str, dials: list[Any]) -> None:
        with pytest.raises(ValueError):
            _run(context=_unverified(server))

        assert dials == []

    @pytest.mark.parametrize("server", _NOT_HTTP, ids=_NOT_HTTP_IDS)
    def test_an_address_that_is_not_http_or_https_is_refused(
        self, server: str, dials: list[Any]
    ) -> None:
        with pytest.raises(ValueError):
            _run(context=_unverified(server))

        assert dials == []

    @pytest.mark.parametrize(
        "server",
        [*_PORTS_OUT_OF_RANGE, *_NO_HOST, *_NOT_HTTP],
        ids=[*_PORT_IDS, *_NO_HOST_IDS, *_NOT_HTTP_IDS],
    )
    def test_a_stdout_stream_refuses_the_same_addresses(
        self, server: str, dials: list[Any]
    ) -> None:
        with pytest.raises(ValueError), _open(context=_unverified(server)):
            pass

        assert dials == []

    @pytest.mark.parametrize(
        ("server", "message"),
        [
            ("ftp://k8s.example", r"^Kubernetes API address must start with http:// or https://$"),
            ("k8s.example:6443", r"^Kubernetes API address must start with http:// or https://$"),
            ("", r"^Kubernetes API address must start with http:// or https://$"),
            ("https://:6443", r"^Kubernetes API address needs a host$"),
            ("https://wave:s3cret@", r"^Kubernetes API address needs a host$"),
            ("https://[::1", r"^Kubernetes API address needs a host$"),
            (_PORT_ZERO, r"^Kubernetes API address port must be between 1 and 65535$"),
            (
                _PORT_ABOVE_THE_RANGE,
                r"^Kubernetes API address port must be between 1 and 65535$",
            ),
            (
                "https://k8s.example:abc",
                r"^Kubernetes API address port must be between 1 and 65535$",
            ),
            (
                "https://wave:s3cret@k8s.example:65536",
                r"^Kubernetes API address port must be between 1 and 65535$",
            ),
        ],
        ids=[
            "another-scheme",
            "no-scheme",
            "blank",
            "port-without-host",
            "login-without-host",
            "open-bracket",
            "port-zero",
            "port-far-above",
            "port-not-a-number",
            "port-with-a-login",
        ],
    )
    def test_the_refusal_is_a_sentence_that_never_repeats_the_address(
        self, server: str, message: str, dials: list[Any]
    ) -> None:
        with pytest.raises(ValueError, match=message) as ran:
            _run(context=_unverified(server))
        with pytest.raises(ValueError, match=message) as opened, _open(context=_unverified(server)):
            pass

        assert type(ran.value) is ValueError
        assert type(opened.value) is ValueError
        assert dials == []

    @pytest.mark.parametrize(
        ("server", "message"),
        [
            ("k8s.example:6443", r"^Kubernetes API address must start with http:// or https://$"),
            ("https://:6443", r"^Kubernetes API address needs a host$"),
            (_PORT_ZERO, r"^Kubernetes API address port must be between 1 and 65535$"),
        ],
        ids=["scheme", "host", "port"],
    )
    def test_the_upgrade_request_refuses_the_address_in_the_same_sentence(
        self, monkeypatch: pytest.MonkeyPatch, server: str, message: str
    ) -> None:
        wire = _wire(monkeypatch, [_status(_SUCCESS)])

        with pytest.raises(ValueError, match=message):
            _run(context=_unverified(server))

        assert wire.writes == []


_PROXY_LOGIN = ("wave", "s3cret")
_PROXY_LOGIN_HEADER = "Basic d2F2ZTpzM2NyZXQ="
_PROXY_VARIABLES = ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")
_UNUSABLE_HOST_VALUE = (
    "This WAVE host's proxy address socks5://proxy.example:1080 is not an http:// address: "
    "choose Custom or turn the proxy off"
)

Asked = list[tuple[str, str, int]]
Lines = list[tuple[str, str]]
ExecStarter = Callable[..., _ExecServer]


@pytest.fixture
def quick_exec_server() -> Generator[ExecStarter, None, None]:
    """Starts raw exec servers, https with a material's leaf, whose shutdown returns at once."""
    started: list[_ExecServer] = []

    def start(script: list[bytes], material: TLSMaterial | None = None) -> _ExecServer:
        server = _ExecServer(script)
        started.append(server)
        scheme = "http"
        if material is not None:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(material.server_cert_path, material.server_key_path)
            listening: Any = context.wrap_socket(server.socket, server_side=True)
            server.socket = listening
            scheme = "https"
        server.thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        server.thread.start()
        server.base_url = f"{scheme}://127.0.0.1:{server.server_address[1]}"
        return server

    yield start
    for server in started:
        server.shutdown()
        server.server_close()
        if server.thread is not None:
            server.thread.join(timeout=_LIVE_TIMEOUT)


@pytest.fixture
def run_lines() -> Generator[Lines, None, None]:
    """One block run: its log sink is active for the test and removed after."""
    lines: Lines = []
    token = RUN_LOG.set(RunLog(lambda level, message: lines.append((level, message))))
    yield lines
    RUN_LOG.reset(token)


def _exec_port(server: _ExecServer) -> int:
    return int(server.server_address[1])


def _pinned(server: _ExecServer, material: TLSMaterial) -> _Ctx:
    """The server's context with the lab CA pinned, so no trust line joins the run log."""
    return _Ctx(server=server.base_url, ca_cert=material.ca_cert_pem)


def _tunnels(server: Proxy) -> list[tuple[str, str]]:
    """Each request the proxy received, as its method and the address it named."""
    return [(asked.method, asked.target) for asked in server.requests]


def _proxy_in_force(
    https: int | None = None,
    http: int | None = None,
    *,
    login: tuple[str | None, str | None] = (None, None),
    through: bool = True,
    decision_error: str | None = None,
) -> Asked:
    """Put a hand-built proxy on 127.0.0.1 in force; returns what the decision was asked."""
    proxy = importlib.import_module("wavecore.connectivity.proxy")
    asked: Asked = []

    def through_proxy(scheme: str, host: str, port: int) -> bool:
        asked.append((scheme, host, port))
        if decision_error is not None:
            raise proxy.ProxyError(decision_error)
        return through

    def endpoint(port: int | None) -> Any:
        return None if port is None else proxy.ProxyEndpoint("127.0.0.1", port, *login)

    spec = proxy.ProxySpec(endpoint(https), endpoint(http), through_proxy)
    proxy.set_resolver(lambda: spec)
    return asked


class TestProxyRoute:
    """With a route the channel opens over a CONNECT tunnel the proxy opens to the server."""

    def test_an_https_exec_goes_through_a_tunnel_to_the_server(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server(
            [_channel(_STDERR, b"err\n"), _channel(_STDOUT, b"out\n"), _status(_V5_EXIT_7)],
            tls_material,
        )
        with Proxy() as for_https, Proxy() as for_http:
            _proxy_in_force(https=for_https.port, http=for_http.port)

            result = _run(context=_pinned(cluster, tls_material))

            assert result == ("out\n", "err\n", 7)
            assert _tunnels(for_https) == [("CONNECT", f"127.0.0.1:{_exec_port(cluster)}")]
            assert for_http.untouched
        assert f"/api/v1/namespaces/{_NAMESPACE}/pods/{_POD}/exec" in cluster.request_lines[0]

    def test_a_plain_http_exec_is_tunneled_through_the_http_endpoint(
        self, quick_exec_server: ExecStarter
    ) -> None:
        cluster = quick_exec_server([_channel(_STDOUT, b"out\n"), _status(_SUCCESS)])
        with Proxy() as for_https, Proxy() as for_http:
            _proxy_in_force(https=for_https.port, http=for_http.port)

            result = _run(context=_Ctx(server=cluster.base_url))

            assert result == ("out\n", "", 0)
            assert _tunnels(for_http) == [("CONNECT", f"127.0.0.1:{_exec_port(cluster)}")]
            assert for_https.untouched

    def test_a_stdout_stream_goes_through_a_tunnel_to_the_server(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server(
            [_channel(_STDOUT, b"archive-bytes"), _status(_SUCCESS)], tls_material
        )
        with Proxy() as server:
            _proxy_in_force(https=server.port)

            drained = _drain(context=_pinned(cluster, tls_material), timeout=_LIVE_TIMEOUT)

            assert drained == (b"archive-bytes", "", 0)
            assert _tunnels(server) == [("CONNECT", f"127.0.0.1:{_exec_port(cluster)}")]

    def test_an_address_without_a_port_is_tunneled_to_the_default_port(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)], tls_material)
        context = _Ctx(server="https://localhost", ca_cert=tls_material.ca_cert_pem)
        with Proxy(upstream=("127.0.0.1", _exec_port(cluster))) as server:
            asked = _proxy_in_force(https=server.port)

            result = _run(context=context)

            assert result == ("", "", 0)
            assert _tunnels(server) == [("CONNECT", "localhost:443")]
            assert set(asked) == {("https", "localhost", 443)}

    def test_the_route_decision_is_asked_about_an_https_address(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)], tls_material)
        with Proxy() as server:
            asked = _proxy_in_force(https=server.port, http=server.port)

            _run(context=_pinned(cluster, tls_material))

        assert set(asked) == {("https", "127.0.0.1", _exec_port(cluster))}

    def test_the_route_decision_is_asked_about_an_http_address(
        self, quick_exec_server: ExecStarter
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)])
        with Proxy() as server:
            asked = _proxy_in_force(https=server.port, http=server.port)

            _run(context=_Ctx(server=cluster.base_url))

        assert set(asked) == {("http", "127.0.0.1", _exec_port(cluster))}

    def test_a_proxy_login_rides_the_connect_request(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)], tls_material)
        with Proxy(login=_PROXY_LOGIN) as server:
            _proxy_in_force(https=server.port, login=_PROXY_LOGIN)

            result = _run(context=_pinned(cluster, tls_material))

            assert result == ("", "", 0)
            assert server.requests[0].headers["proxy-authorization"] == _PROXY_LOGIN_HEADER

    def test_a_proxy_without_a_username_gets_no_login(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)], tls_material)
        with Proxy() as server:
            _proxy_in_force(https=server.port)

            _run(context=_pinned(cluster, tls_material))

            assert "proxy-authorization" not in server.requests[0].headers

    def test_the_servers_name_is_still_verified_through_the_tunnel(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)], tls_material)
        context = _Ctx(server=_FAKE_SERVER, ca_cert=tls_material.ca_cert_pem)
        message = (
            f"Could not verify the TLS certificate of {_FAKE_SERVER}: "
            'Certificate verification failed: hostname "k8s.example" does not match '
            "the server certificate"
        )
        with Proxy(upstream=("127.0.0.1", _exec_port(cluster))) as server:
            _proxy_in_force(https=server.port)

            with pytest.raises(ExecTransportError, match=_exact(message)):
                _run(context=context)

            assert _tunnels(server) == [("CONNECT", "k8s.example:6443")]
        assert cluster.request_lines == []


class TestDirectRoute:
    """A direct decision, or no proxy in force, never touches the proxy."""

    def test_a_direct_decision_connects_to_the_server_itself(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server([_channel(_STDOUT, b"out\n"), _status(_SUCCESS)], tls_material)
        with Proxy() as server:
            _proxy_in_force(https=server.port, http=server.port, through=False)

            result = _run(context=_pinned(cluster, tls_material))

            assert result == ("out\n", "", 0)
            assert server.untouched

    def test_without_a_proxy_in_force_the_wave_hosts_proxy_variables_are_not_used(
        self,
        quick_exec_server: ExecStarter,
        tls_material: TLSMaterial,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        cluster = quick_exec_server([_channel(_STDOUT, b"out\n"), _status(_SUCCESS)], tls_material)
        with Proxy() as server:
            for name in _PROXY_VARIABLES:
                monkeypatch.setenv(name, server.url)

            result = _run(context=_pinned(cluster, tls_material))

            assert result == ("out\n", "", 0)
            assert server.untouched


class TestProxyLogLine:
    """A block run names the proxy it used once, however many channels it opened."""

    def test_two_channels_of_one_run_write_the_line_once(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial, run_lines: Lines
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)], tls_material)
        with Proxy() as server:
            _proxy_in_force(https=server.port)

            _run(context=_pinned(cluster, tls_material))
            _run(context=_pinned(cluster, tls_material))

            assert [asked.method for asked in server.requests] == ["CONNECT", "CONNECT"]
        assert run_lines == [("DEBUG", f"Using the proxy 127.0.0.1:{server.port}")]

    def test_a_direct_connection_writes_no_line(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial, run_lines: Lines
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)], tls_material)
        with Proxy() as server:
            _proxy_in_force(https=server.port, through=False)

            _run(context=_pinned(cluster, tls_material))

        assert run_lines == []


class TestProxyFailures:
    """A proxy failure reads as an unreachable server, carrying the proxy's own text."""

    def test_a_refused_tunnel_names_the_proxy_answer(self) -> None:
        target = closed_port()
        api_url = f"https://127.0.0.1:{target}"
        with Proxy(refuse=(403, "Forbidden")) as server:
            _proxy_in_force(https=server.port)
            message = (
                f"Could not connect to the Kubernetes API at {api_url}: "
                f"Proxy 127.0.0.1:{server.port} refused the connection to "
                f"127.0.0.1:{target}: 403 Forbidden"
            )

            with pytest.raises(ExecTransportError, match=_exact(message)):
                _run(context=_Ctx(server=api_url, verify=False))

    def test_a_proxy_that_cannot_be_reached_is_named(self) -> None:
        api_url = f"https://127.0.0.1:{closed_port()}"
        dead = closed_port()
        _proxy_in_force(https=dead)
        prefix = re.escape(f"Could not connect to the Kubernetes API at {api_url}: ")

        with pytest.raises(
            ExecTransportError,
            match=rf"^{prefix}Proxy 127\.0\.0\.1:{dead} cannot be reached: .+$",
        ):
            _run(context=_Ctx(server=api_url, verify=False))

    def test_a_wave_host_value_wave_cannot_use_keeps_its_own_text(
        self, quick_exec_server: ExecStarter, tls_material: TLSMaterial
    ) -> None:
        cluster = quick_exec_server([_status(_SUCCESS)], tls_material)
        _proxy_in_force(decision_error=_UNUSABLE_HOST_VALUE)
        message = (
            f"Could not connect to the Kubernetes API at {cluster.base_url}: "
            f"{_UNUSABLE_HOST_VALUE}"
        )

        with pytest.raises(ExecTransportError, match=_exact(message)):
            _run(context=_pinned(cluster, tls_material))

        assert cluster.request_lines == []

    def test_a_stdout_stream_reports_a_proxy_failure_the_same_way(self) -> None:
        target = closed_port()
        api_url = f"https://127.0.0.1:{target}"
        with Proxy(refuse=(403, "Forbidden")) as server:
            _proxy_in_force(https=server.port)
            message = (
                f"Could not connect to the Kubernetes API at {api_url}: "
                f"Proxy 127.0.0.1:{server.port} refused the connection to "
                f"127.0.0.1:{target}: 403 Forbidden"
            )

            with (
                pytest.raises(ExecTransportError, match=_exact(message)),
                _open(context=_Ctx(server=api_url, verify=False), timeout=_LIVE_TIMEOUT),
            ):
                pass
