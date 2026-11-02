"""Local test-server fixtures for HTTP plugin wire-level tests.

The recording server captures every request (method, path, headers, body -
including chunked uploads from streaming bodies) and replays a FIFO of
scripted responses, so tests assert the exact bytes the plugin puts on the
wire. The TLS fixtures generate a throwaway CA + server + client identity via
`cryptography` for real handshake coverage (server TLS trace, mutual TLS).
"""

import datetime
import ipaddress
import ssl
import threading
import time
from collections import deque
from collections.abc import Generator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID


def _read_request_body(handler: BaseHTTPRequestHandler) -> bytes:
    """Read a request body, supporting both Content-Length and chunked framing."""
    if (handler.headers.get("Transfer-Encoding") or "").lower() == "chunked":
        chunks: list[bytes] = []
        while True:
            size = int(handler.rfile.readline().strip() or b"0", 16)
            if size == 0:
                handler.rfile.readline()
                return b"".join(chunks)
            chunks.append(handler.rfile.read(size))
            handler.rfile.readline()
    length = int(handler.headers.get("Content-Length") or 0)
    return handler.rfile.read(length) if length else b""


class _RecordingHandler(BaseHTTPRequestHandler):
    """Records the request and replays the next scripted response."""

    protocol_version = "HTTP/1.1"

    def _handle(self) -> None:
        body = _read_request_body(self)
        server: Any = self.server
        server.requests.append(
            {
                "method": self.command,
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "raw_headers": list(self.headers.items()),
                "body": body,
            }
        )
        status, headers, payload, delay, auto_length = server.next_response()
        if delay:
            time.sleep(delay)
        self.send_response(status)
        has_length = False
        for name, value in headers:
            self.send_header(name, value)
            if name.lower() == "content-length":
                has_length = True
        if auto_length and not has_length:
            self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD" and payload:
            self.wfile.write(payload)

    do_GET = _handle  # noqa: N815 - http.server contract
    do_POST = _handle  # noqa: N815
    do_PUT = _handle  # noqa: N815
    do_DELETE = _handle  # noqa: N815
    do_PATCH = _handle  # noqa: N815
    do_HEAD = _handle  # noqa: N815
    do_OPTIONS = _handle  # noqa: N815

    def log_message(self, *args: Any) -> None:
        """Silence the test server."""


class RecordingHTTPServer(ThreadingHTTPServer):
    """Threading server with a request log and a FIFO of scripted responses."""

    daemon_threads = True

    def __init__(self, address: tuple[str, int]) -> None:
        super().__init__(address, _RecordingHandler)
        self.requests: list[dict[str, Any]] = []
        self._responses: deque[tuple[int, list[tuple[str, str]], bytes, float, bool]] = deque()
        self.base_url = ""

    def enqueue(
        self,
        status: int = 200,
        headers: list[tuple[str, str]] | None = None,
        body: bytes = b"OK",
        content_type: str | None = "text/plain",
        delay: float = 0.0,
        auto_length: bool = True,
    ) -> None:
        hdrs = list(headers or [])
        if content_type is not None and not any(n.lower() == "content-type" for n, _ in hdrs):
            hdrs.append(("Content-Type", content_type))
        self._responses.append((status, hdrs, body, delay, auto_length))

    def next_response(self) -> tuple[int, list[tuple[str, str]], bytes, float, bool]:
        if self._responses:
            return self._responses.popleft()
        return (200, [("Content-Type", "text/plain")], b"OK", 0.0, True)

    def handle_error(self, request: Any, client_address: Any) -> None:
        """Silence handshake/disconnect noise from negative-path tests."""


def _start_server(server: RecordingHTTPServer, scheme: str) -> RecordingHTTPServer:
    # shutdown() waits out one poll, so a short poll keeps every teardown short.
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
    )
    thread.start()
    server.base_url = f"{scheme}://127.0.0.1:{server.server_address[1]}"
    return server


@pytest.fixture
def http_server() -> Generator[RecordingHTTPServer, None, None]:
    """Plain-HTTP recording server on an ephemeral 127.0.0.1 port."""
    server = _start_server(RecordingHTTPServer(("127.0.0.1", 0)), "http")
    yield server
    server.shutdown()
    server.server_close()


class TLSMaterial:
    """Throwaway PKI: one CA, a server identity for 127.0.0.1, a client identity."""

    def __init__(self, base_dir: Path) -> None:
        ca_key = ec.generate_private_key(ec.SECP256R1())
        ca_cert = _make_cert("wave-test-ca", ca_key, None, None, is_ca=True)
        server_key = ec.generate_private_key(ec.SECP256R1())
        server_cert = _make_cert("wave-test-server", server_key, ca_cert, ca_key, san=True)
        client_key = ec.generate_private_key(ec.SECP256R1())
        client_cert = _make_cert("wave-test-client", client_key, ca_cert, ca_key)

        self.ca_cert_path = str(base_dir / "ca.pem")
        self.server_cert_path = str(base_dir / "server-cert.pem")
        self.server_key_path = str(base_dir / "server-key.pem")
        self.client_cert_path = str(base_dir / "client-cert.pem")
        self.client_key_path = str(base_dir / "client-key.pem")

        _write_cert(self.ca_cert_path, ca_cert)
        _write_cert(self.server_cert_path, server_cert)
        _write_key(self.server_key_path, server_key)
        _write_cert(self.client_cert_path, client_cert)
        _write_key(self.client_key_path, client_key)

        self.ca_cert_pem = Path(self.ca_cert_path).read_text(encoding="utf-8")
        self.client_cert_pem = Path(self.client_cert_path).read_text(encoding="utf-8")
        self.client_key_pem = Path(self.client_key_path).read_text(encoding="utf-8")


def _make_cert(
    common_name: str,
    key: ec.EllipticCurvePrivateKey,
    issuer_cert: x509.Certificate | None,
    issuer_key: ec.EllipticCurvePrivateKey | None,
    *,
    is_ca: bool = False,
    san: bool = False,
) -> x509.Certificate:
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
    issuer = issuer_cert.subject if issuer_cert is not None else subject
    signing_key = issuer_key if issuer_key is not None else key
    now = datetime.datetime.now(datetime.UTC)
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=100))
        .add_extension(x509.BasicConstraints(ca=is_ca, path_length=None), critical=True)
    )
    if san:
        builder = builder.add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
                    x509.DNSName("localhost"),
                ]
            ),
            critical=False,
        )
    return builder.sign(signing_key, hashes.SHA256())


def _write_cert(path: str, cert: x509.Certificate) -> None:
    Path(path).write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def _write_key(path: str, key: ec.EllipticCurvePrivateKey) -> None:
    Path(path).write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )


@pytest.fixture(scope="session")
def tls_material(tmp_path_factory: pytest.TempPathFactory) -> TLSMaterial:
    return TLSMaterial(tmp_path_factory.mktemp("tls-material"))


def _tls_server(
    material: TLSMaterial, require_client_cert: bool, *, legacy: bool = False
) -> RecordingHTTPServer:
    server = RecordingHTTPServer(("127.0.0.1", 0))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(material.server_cert_path, material.server_key_path)
    if require_client_cert:
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(material.ca_cert_path)
    if legacy:
        context.minimum_version = ssl.TLSVersion.TLSv1
        context.set_ciphers("ALL:@SECLEVEL=0")
    server.socket = context.wrap_socket(server.socket, server_side=True)  # type: ignore[assignment]
    return _start_server(server, "https")


@pytest.fixture
def tls_server(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    """HTTPS recording server; clients verify it against tls_material.ca_cert_path."""
    server = _tls_server(tls_material, require_client_cert=False)
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def mtls_server(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    """HTTPS recording server that REQUIRES a client certificate signed by the CA."""
    server = _tls_server(tls_material, require_client_cert=True)
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def legacy_tls_server(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    """HTTPS recording server accepting TLS 1.0+ (SECLEVEL=0) for legacy-pin handshakes."""
    server = _tls_server(tls_material, require_client_cert=False, legacy=True)
    yield server
    server.shutdown()
    server.server_close()
