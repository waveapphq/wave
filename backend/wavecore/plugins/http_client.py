"""
HTTP Client Plugin

Implements:
- REQ-3.4.1.4: HTTP/HTTPS client operations
- REQ-5.1.6: HTTP/HTTPS for service APIs
- REQ-3.4.3.9: HTTP proxy choice
- REQ-3.4.3.10: HTTP Auto content type

Provides HTTP/HTTPS request capabilities with retry logic
and comprehensive response handling without automatic parsing.
"""

import asyncio
import base64
import datetime
import os
import socket
import time
import urllib.parse
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field, replace
from email.message import Message
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

import aiofiles
import httpcore
import httpx

from wavecore.connectivity import proxy, run_log, tls_capabilities, trust_store
from wavecore.connectivity.web_address import (
    HOST,
    PORT,
    SCHEME,
    WebAddressError,
    basic_authorization,
    bracketed,
    parse_web_address,
    typed_reason,
)
from wavecore.core.artifacts import store
from wavecore.core.execution.plugin_executor import check_entry_nulls
from wavecore.core.number_rule import is_number_value
from wavecore.core.secrets.masking import structural_mask
from wavecore.plugins import http_tls
from wavecore.plugins._content_types import content_type_for
from wavecore.plugins._executor_base import validate_enum_from_schema
from wavecore.plugins._file_paths import plain_path, resolve_plugin_path
from wavecore.plugins._tls_material import is_pem, read_pem
from wavecore.plugins._verb_bridge import log_via
from wavecore.plugins.base import PluginBase

# Binary content types that should be base64-encoded in responses
_BINARY_CONTENT_MARKERS = ("image", "octet-stream", "application/pdf")

# HTTP methods the client accepts; others are rejected defensively.
_ALLOWED_METHODS = frozenset({"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"})


_BLOCKED_FRAMING_KEYS = ("content-length",)

_BLOCKED_KEY_SENTENCE = (
    'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides'
)
_DUPLICATE_KEY_SENTENCE = 'Duplicate header "{key}" (header names are case-insensitive)'

_URL_REFUSALS = {
    SCHEME: "URL must start with http:// or https://",
    HOST: "URL needs a host",
    PORT: "URL port must be between 1 and 65535",
}

_FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"
_OCTET_STREAM_CONTENT_TYPE = "application/octet-stream"
_FILE_CONTENT_TYPES = [
    "auto",
    "application/json",
    "application/xml",
    "text/plain",
    "text/html",
    "application/yaml",
    _OCTET_STREAM_CONTENT_TYPE,
]

_DEFAULT_BODY_CAP = 1048576
_STREAM_CHUNK = 65536
_FALLBACK_DOWNLOAD_NAME = "response"

_AUTH_SECRET_FIELDS = {"basic": "auth_password", "bearer": "auth_token", "api_key": "auth_key"}

_TLS_VERSION_CHOICES = ["1.0", "1.1", "1.2", "1.3"]
_TLS_DEFAULT_MIN = "1.2"
_TLS_DEFAULT_MAX = "1.3"
_TLS_MIN_MAX_SENTENCE = "Min TLS Version cannot exceed Max TLS Version"

_EMPTY_CERT: dict[str, Any] = {
    "peer_subject": "",
    "peer_issuer": "",
    "not_before": "",
    "not_after": "",
    "days_to_expiry": 0,
}

# Bound at import so a test patching httpx.AsyncClient cannot break the isinstance
# guard that distinguishes a real client (swap the TLS backend) from a mock (skip).
_ASYNC_CLIENT_TYPE = httpx.AsyncClient


def _ignore_line(_level: str, _message: str) -> None:
    """The run log's writer for a run without a logger."""


def _name_proxy(endpoint: proxy.ProxyEndpoint) -> None:
    """Write the block run's one line for the proxy that carries a request."""
    run_log.log_once("DEBUG", f"Using the proxy {endpoint.display}")


async def _pem_text(material: str) -> str:
    """Certificate material as PEM text; a relative path starts from the WAVE user's home."""
    source = material if is_pem(material) else str(plain_path(material))
    return await asyncio.to_thread(read_pem, source)


class _NegotiatedTLS:
    """The negotiated-handshake facts the trace collector reads (ssl_object shim)."""

    def __init__(self, result: http_tls.HandshakeResult) -> None:
        self._result = result

    def version(self) -> str:
        return self._result.version

    def cipher(self) -> tuple[str, str, None]:
        return (self._result.cipher, self._result.version, None)

    def selected_alpn_protocol(self) -> None:
        return None

    def peer_der(self) -> bytes:
        return self._result.peer_chain_der[0] if self._result.peer_chain_der else b""


class _TlsStream(httpcore.AsyncNetworkStream):
    """Post-handshake network stream riding the tlslite record layer."""

    def __init__(self, sock: socket.socket, result: http_tls.HandshakeResult) -> None:
        self._sock = sock
        self._conn = result.connection
        self._ssl_object = _NegotiatedTLS(result)

    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return await asyncio.to_thread(self._read, max_bytes, timeout)

    def _read(self, max_bytes: int, timeout: float | None) -> bytes:
        self._sock.settimeout(timeout)
        try:
            # The engine sets ignoreAbruptClose, so a missing close_notify is a
            # clean b"" EOF rather than a raise.
            return bytes(self._conn.read(max=max_bytes))
        except TimeoutError as exc:
            raise httpcore.ReadTimeout(str(exc)) from exc
        except Exception as exc:
            raise httpcore.ReadError(str(exc)) from exc

    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        await asyncio.to_thread(self._write, buffer, timeout)

    def _write(self, buffer: bytes, timeout: float | None) -> None:
        self._sock.settimeout(timeout)
        try:
            self._conn.write(bytes(buffer))
        except TimeoutError as exc:
            raise httpcore.WriteTimeout(str(exc)) from exc
        except Exception as exc:
            raise httpcore.WriteError(str(exc)) from exc

    async def aclose(self) -> None:
        await asyncio.to_thread(self._close)

    def _close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass
        self._sock.close()

    def get_extra_info(self, info: str) -> Any:
        if info == "ssl_object":
            return self._ssl_object
        return None


class _PlainStream(httpcore.AsyncNetworkStream):
    """A raw TCP stream whose start_tls upgrades via the pure-Python engine."""

    def __init__(
        self,
        sock: socket.socket,
        config: http_tls.TLSClientConfig,
        endpoint: proxy.ProxyEndpoint | None = None,
    ) -> None:
        self._sock = sock
        self._config = config
        self._endpoint = endpoint

    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return await asyncio.to_thread(self._read, max_bytes, timeout)

    def _read(self, max_bytes: int, timeout: float | None) -> bytes:
        self._sock.settimeout(timeout)
        try:
            return self._sock.recv(max_bytes)
        except TimeoutError as exc:
            raise httpcore.ReadTimeout(str(exc)) from exc
        except OSError as exc:
            raise httpcore.ReadError(str(exc)) from exc

    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        await asyncio.to_thread(self._write, buffer, timeout)

    def _write(self, buffer: bytes, timeout: float | None) -> None:
        self._sock.settimeout(timeout)
        try:
            self._sock.sendall(buffer)
        except OSError as exc:
            raise httpcore.WriteError(str(exc)) from exc

    async def aclose(self) -> None:
        await asyncio.to_thread(self._sock.close)

    async def start_tls(
        self,
        ssl_context: Any,
        server_hostname: str | None = None,
        timeout: float | None = None,
    ) -> httpcore.AsyncNetworkStream:
        if self._endpoint is not None:
            # A stream dialed to the proxy is upgraded only once its tunnel is up.
            _name_proxy(self._endpoint)
        config = self._config
        try:
            if config.verify and config.anchors_pem is None:
                # Read on the loop thread at each connection, so the trust line reaches the console.
                anchors = trust_store.anchors_pem(trust_store.active_spec())
                config = replace(config, anchors_pem=anchors)
            result = await asyncio.to_thread(self._handshake, config, server_hostname, timeout)
        except BaseException:
            # httpcore drops a stream whose upgrade failed without closing it.
            self._sock.close()
            raise
        return _TlsStream(self._sock, result)

    def _handshake(
        self, config: http_tls.TLSClientConfig, server_hostname: str | None, timeout: float | None
    ) -> Any:
        self._sock.settimeout(timeout)
        try:
            return http_tls.tls_handshake(
                self._sock,
                config,
                server_hostname or "",
                datetime.datetime.now(datetime.UTC),
            )
        except (http_tls.TLSHandshakeError, http_tls.TLSVerificationFailure) as exc:
            raise httpcore.ConnectError(str(exc)) from exc

    def get_extra_info(self, info: str) -> Any:
        return None


class _TlsliteBackend(httpcore.AsyncNetworkBackend):
    """httpcore backend whose sockets do TLS via the pure-Python engine."""

    def __init__(
        self, config: http_tls.TLSClientConfig, endpoint: proxy.ProxyEndpoint | None = None
    ) -> None:
        self._config = config
        # Set under a proxied pool, whose every dial is the proxy itself.
        self._endpoint = endpoint

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Any = None,
    ) -> httpcore.AsyncNetworkStream:
        source = (local_address, 0) if local_address else None
        try:
            sock = await asyncio.to_thread(socket.create_connection, (host, port), timeout, source)
        except TimeoutError as exc:
            raise httpcore.ConnectTimeout(self._dial_failure(exc)) from exc
        except OSError as exc:
            raise httpcore.ConnectError(self._dial_failure(exc)) from exc
        return _PlainStream(sock, self._config, self._endpoint)

    def _dial_failure(self, error: OSError) -> str:
        """The system's own words for a failed dial, naming the proxy when it was the proxy."""
        if self._endpoint is None:
            return str(error)
        return f"Proxy {self._endpoint.display} cannot be reached: {error}"


def _http_transport(through: httpx.Proxy | None = None) -> httpx.AsyncHTTPTransport:
    """An HTTP/1.1 transport that never reads the environment; the backend does the TLS."""
    return httpx.AsyncHTTPTransport(
        verify=False, trust_env=False, http1=True, http2=False, proxy=through
    )


def _proxied_transport(endpoint: proxy.ProxyEndpoint) -> httpx.AsyncHTTPTransport:
    """A transport that reaches every target through one proxy, itself dialed in the clear."""
    headers = {}
    if endpoint.username:
        headers["Proxy-Authorization"] = basic_authorization(endpoint.username, endpoint.password)
    return _http_transport(httpx.Proxy(f"http://{endpoint.display}", headers=headers))


class _ProxyRoutingTransport(httpx.AsyncBaseTransport):
    """Sends each request, and so each redirect hop, where the proxy in force routes it."""

    def __init__(self, spec: proxy.ProxySpec) -> None:
        self._spec = spec
        self._direct = _http_transport()
        endpoints = {endpoint for endpoint in (spec.https, spec.http) if endpoint is not None}
        self._proxied = {endpoint: _proxied_transport(endpoint) for endpoint in endpoints}

    def install_backend(self, config: http_tls.TLSClientConfig) -> None:
        """Put the pure-Python TLS backend under the direct pool and every proxied pool."""
        self._direct._pool._network_backend = _TlsliteBackend(config)
        for endpoint, transport in self._proxied.items():
            transport._pool._network_backend = _TlsliteBackend(config, endpoint)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        port = url.port or (443 if url.scheme == "https" else 80)
        endpoint = proxy.route_for(url.scheme, url.host, port, self._spec)
        if endpoint is None:
            return await self._direct.handle_async_request(request)
        target = f"{bracketed(url.raw_host.decode('ascii'))}:{port}"
        refused = f"Proxy {endpoint.display} refused the connection to {target}"
        try:
            response = await self._proxied[endpoint].handle_async_request(request)
        except httpx.ProxyError as exc:
            raise httpx.ProxyError(f"{refused}: {exc}") from exc
        if url.scheme == "https":
            # Only the target answers through a tunnel, a 407 too; its stream has named the proxy.
            return response
        if response.status_code == httpx.codes.PROXY_AUTHENTICATION_REQUIRED:
            await response.aclose()
            raise httpx.ProxyError(f"{refused}: {response.status_code} {response.reason_phrase}")
        _name_proxy(endpoint)
        return response

    async def aclose(self) -> None:
        for transport in (self._direct, *self._proxied.values()):
            await transport.aclose()


@dataclass
class HTTPRequestConfig:
    """Configuration for an HTTP request, grouping related parameters."""

    method: str
    url: str
    body: str | None
    headers: dict[str, str]
    query_params: dict[str, str]
    timeout_seconds: int | float
    verify_ssl: bool
    ca_cert: str | None
    allow_redirects: bool
    max_redirects: int
    retry_count: int
    retry_delay: int | float
    retry_backoff_factor: int | float
    retryable_status_codes: list[str] = field(default_factory=list)
    variables: dict[str, Any] = field(default_factory=dict)
    logger: Any = None
    body_mode: str = "text"
    body_auto_headers: bool = True
    file_content_type: str = "auto"
    form_fields: dict[str, str] = field(default_factory=dict)
    parts: list[dict[str, Any]] = field(default_factory=list)
    file_source: str | None = None
    response_mode: str = "body"
    file_path: str | None = None
    max_size: int | None = None
    client_cert: str | None = None
    client_key: str | None = None
    tls_min_version: str = _TLS_DEFAULT_MIN
    tls_max_version: str = _TLS_DEFAULT_MAX
    # None = every catalog suite of the range; [] = explicit zero ciphers; [...] = explicit list.
    cipher_suites: list[str] | None = None
    proxy_mode: str = "wave-setting"
    auth_enabled: bool = False
    auth_mode: str = "basic"
    auth_username: str | None = None
    auth_password: str | None = None
    auth_token: str | None = None
    auth_header_name: str | None = None
    auth_key: str | None = None
    artifacts_dir: str | None = None
    testdata_dirs: list[str] | None = None
    parameter_sources: dict[str, str] = field(default_factory=dict)
    register_secret: Any = None
    reveal_fields: set[str] = field(default_factory=set)
    headers_output_secret: bool = False
    trace_output_secret: bool = False


def _validate_positive_number(params: dict[str, Any], name: str, label: str) -> None:
    """Validate that a parameter, if present, is a positive number."""
    if name not in params:
        return
    value = params[name]
    if not is_number_value(value):
        raise TypeError(f"{label} must be a number")
    if value <= 0:
        raise ValueError(f"{label} must be positive")


def _coerce_str(value: Any) -> str:
    """Coerce a resolved map/part value to the string HTTP requires; nothing given is ""."""
    return "" if value is None else str(value)


def _is_binary_content(content_type: str) -> bool:
    """Check if a content type indicates binary content."""
    return any(marker in content_type for marker in _BINARY_CONTENT_MARKERS)


def _humanize_size(num: int) -> str:
    """Render a byte count like '1.0 MB' / '1.0 KB' / '512 B'."""
    if num >= 1048576:
        return f"{num / 1048576:.1f} MB"
    if num >= 1024:
        return f"{num / 1024:.1f} KB"
    return f"{num} B"


def _charset_from_content_type(content_type: str) -> str:
    """Extract the charset parameter of a Content-Type value, defaulting to utf-8."""
    message = Message()
    message["content-type"] = content_type
    return message.get_content_charset() or "utf-8"


async def _stream_file(path: Path) -> AsyncIterator[bytes]:
    """Stream a file's bytes in chunks (request-body streaming)."""
    async with aiofiles.open(path, "rb") as fh:
        while True:
            chunk = await fh.read(_STREAM_CHUNK)
            if not chunk:
                break
            yield chunk


def _iter_chunks(data: bytes) -> Iterator[bytes]:
    """Chunk an in-memory payload for the streaming artifact writer."""
    for offset in range(0, len(data), _STREAM_CHUNK):
        yield data[offset : offset + _STREAM_CHUNK]
    if not data:
        yield b""


class _TraceCollector:
    """Collects httpcore trace events (connect/TLS phases) for one request."""

    def __init__(self) -> None:
        self.events: list[tuple[str, float]] = []
        self.tls: dict[str, Any] = {}
        self.connect_host: str | None = None
        self.connect_port: int | None = None
        self._opening_tunnel = False

    async def on_event(self, name: str, info: dict[str, Any]) -> None:
        request = info.get("request")
        if request is not None:
            self._opening_tunnel = request.method == b"CONNECT"
        # The exchange that opens a proxy tunnel is not the block's request, so it is not timed.
        if self._opening_tunnel and name.startswith("http11."):
            return
        self.events.append((name, time.perf_counter()))
        if name.endswith("connect_tcp.started"):
            self.connect_host = str(info.get("host", ""))
            self.connect_port = info.get("port")
        elif name.endswith("start_tls.complete"):
            self._capture_tls(info.get("return_value"))

    def _capture_tls(self, network_stream: Any) -> None:
        ssl_object = (
            network_stream.get_extra_info("ssl_object") if network_stream is not None else None
        )
        if ssl_object is None:
            return
        der = ssl_object.peer_der()
        cert = (
            http_tls.certificate_summary(der, datetime.datetime.now(datetime.UTC))
            if der
            else dict(_EMPTY_CERT)
        )
        cipher = ssl_object.cipher() or ("",)
        self.tls = {
            "protocol": ssl_object.version() or "",
            "cipher": cipher[0],
            **cert,
        }

    def _first(self, suffix: str) -> float | None:
        for name, moment in self.events:
            if name.endswith(suffix):
                return moment
        return None

    def _last(self, suffix: str) -> float | None:
        result = None
        for name, moment in self.events:
            if name.endswith(suffix):
                result = moment
        return result

    def _span_ms(self, marker: str) -> float:
        started = self._first(f"{marker}.started")
        completed = self._first(f"{marker}.complete")
        if started is None or completed is None:
            return 0.0
        return max(completed - started, 0.0) * 1000

    def timing(self) -> dict[str, float]:
        request_started = self._first("send_request_headers.started")
        first_byte = self._first("receive_response_headers.complete")
        first_byte_ms = 0.0
        if request_started is not None and first_byte is not None:
            first_byte_ms = max(first_byte - request_started, 0.0) * 1000
        download_started = self._first("receive_response_body.started")
        download_done = self._last("receive_response_body.complete")
        download_ms = 0.0
        if download_started is not None and download_done is not None:
            download_ms = max(download_done - download_started, 0.0) * 1000
        # total_ms is the pure wire window: first wire event to last, all attempts.
        total_ms = (self.events[-1][1] - self.events[0][1]) * 1000 if self.events else 0.0
        return {
            "dns_ms": 0.0,
            "connect_ms": self._span_ms("connect_tcp"),
            "tls_ms": self._span_ms("start_tls"),
            "first_byte_ms": first_byte_ms,
            "download_ms": download_ms,
            "total_ms": max(total_ms, 0.0),
        }


@dataclass
class _RequestRun:
    """Per-execution trace state: collector, hop attempts, sizes."""

    collector: _TraceCollector = field(default_factory=_TraceCollector)
    attempts: list[list[dict[str, Any]]] = field(default_factory=list)
    request_body_size: int = 0
    response_size: int = 0


class HTTPClientPlugin(PluginBase):
    """
    HTTP Client Plugin.

    Executes HTTP/HTTPS requests with support for all standard methods,
    request body modes (text, form, multipart, file), response body or
    file-download capture, retry logic, mutual TLS, proxy modes, and a
    wire-level evidence trace. TLS is provided by a bundled pure-Python
    client, so protocol-version and cipher choices are OS-independent.
    """

    def __init__(self) -> None:
        """Initialize plugin."""
        super().__init__()

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "http-client",
            "name": "HTTP Client",
            "version": "1.0.0",
            "category": "network",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Executes HTTP/HTTPS requests with support for all standard methods, "
                "body modes, response capture or file download, retry logic, "
                "mutual TLS, and proxy modes. TLS is a bundled pure-Python client, so "
                "protocol-version and cipher choices are OS-independent and reproducible. "
                "Responses are returned as raw strings without automatic parsing."
            ),
            "parameters": [
                {
                    "name": "method",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "default": "GET",
                    "enum_values": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
                    "description": "HTTP method to use for the request",
                },
                {
                    "name": "url",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "Request URL",
                },
                {
                    "name": "headers",
                    "type": "map",
                    "required": False,
                    "description": (
                        "Request headers - including auth (Authorization, API keys). "
                        "Standard headers are sent automatically; add a row to override. "
                        "A null value sends the header as empty text."
                    ),
                    "key_policy": {
                        "case_insensitive_duplicates": True,
                        "duplicate_message": _DUPLICATE_KEY_SENTENCE,
                        "blocked_keys": ["Content-Length"],
                        "blocked_message": _BLOCKED_KEY_SENTENCE,
                        "generated_keys": [
                            {
                                "when": {"auth_enabled": [True], "auth_mode": ["basic", "bearer"]},
                                "key": "Authorization",
                            },
                            {
                                "when": {"auth_enabled": [True], "auth_mode": ["api_key"]},
                                "key_param": "auth_header_name",
                            },
                            {
                                "when": {
                                    "body_auto_headers": [True],
                                    "body_mode": ["form", "file"],
                                },
                                "key": "Content-Type",
                            },
                            {"when": {"body_mode": ["multipart"]}, "key": "Content-Type"},
                        ],
                    },
                },
                {
                    "name": "auth_enabled",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": "Add Auth headers: compose an auth header at send time",
                },
                {
                    "name": "auth_mode",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "basic",
                    "enum_values": ["basic", "bearer", "api_key"],
                    "description": "Auth scheme: Basic, Bearer token, or API key",
                },
                {
                    "name": "auth_username",
                    "type": "string",
                    "required": False,
                    "description": "Username for Basic auth",
                },
                {
                    "name": "auth_password",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": "Password for Basic auth",
                },
                {
                    "name": "auth_token",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": "Token for Bearer token auth",
                },
                {
                    "name": "auth_header_name",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "X-API-Key",
                    "description": "Header name carrying the API key",
                },
                {
                    "name": "auth_key",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": "API key sent under the configured header name",
                },
                {
                    "name": "body_mode",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "text",
                    "enum_values": ["text", "form", "multipart", "file"],
                    "description": "Request body mode",
                },
                {
                    "name": "body",
                    "type": "string",
                    "required": False,
                    "description": "Request body as raw string (no automatic serialization)",
                },
                {
                    "name": "form_fields",
                    "type": "map",
                    "required": False,
                    "description": (
                        "URL-encoded form fields (form body mode); a null value sends "
                        "the field as empty text."
                    ),
                },
                {
                    "name": "parts",
                    "type": "array",
                    "required": False,
                    "description": (
                        "Multipart form-data parts (multipart body mode); a text part "
                        "whose value is null sends an empty field."
                    ),
                },
                {
                    "name": "file_source",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": (
                        "File sent as the request body (file body mode): "
                        "artifact://, testdata://, or an absolute or relative path"
                    ),
                },
                {
                    "name": "file_content_type",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "auto",
                    "enum_values": _FILE_CONTENT_TYPES,
                    "description": (
                        "Content-Type sent with the file (file body mode); "
                        "auto detects it from the file extension"
                    ),
                },
                {
                    "name": "body_auto_headers",
                    "type": "boolean",
                    "required": False,
                    "default": True,
                    "description": (
                        "Add body headers automatically: the Content-Type implied "
                        "by the body mode (forced on for multipart)"
                    ),
                },
                {
                    "name": "query_params",
                    "type": "map",
                    "required": False,
                    "description": (
                        "Query parameters as key-value pairs; a null value sends the "
                        "parameter as empty text."
                    ),
                },
                {
                    "name": "response_mode",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "default": "body",
                    "enum_values": ["body", "file"],
                    "description": "Response handling: capture the body or download to a file",
                },
                {
                    "name": "file_path",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": (
                        "Where to save the download (file response mode): artifact:// or an "
                        "absolute or relative path where the block runs, replacing an "
                        "existing file; "
                        "empty names it after the response inside the run's artifacts"
                    ),
                },
                {
                    "name": "max_size",
                    "type": "integer",
                    "required": False,
                    "description": (
                        "Response size cap in bytes; empty = 1 MB in body mode, "
                        "unlimited in file mode"
                    ),
                },
                {
                    "name": "timeout",
                    "type": "integer",
                    "required": False,
                    "default": 30,
                    "description": "Request timeout in seconds",
                },
                {
                    "name": "verify_ssl",
                    "type": "boolean",
                    "required": False,
                    "default": True,
                    "description": (
                        "Verify the server certificate: against CA Certificate when it is set, "
                        "otherwise against the certificates WAVE trusts "
                        "(Settings > Network > Certificates)"
                    ),
                },
                {
                    "name": "ca_cert",
                    "type": "string",
                    "required": False,
                    "description": (
                        "CA certificate (file path, variable reference, or PEM string); when set, "
                        "it is the only certificate this block trusts"
                    ),
                },
                {
                    "name": "client_cert",
                    "type": "string",
                    "required": False,
                    "description": "Client certificate for mutual TLS (path, variable, or PEM)",
                },
                {
                    "name": "client_key",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": "Client private key for mutual TLS (path, variable, or PEM)",
                },
                {
                    "name": "tls_min_version",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": _TLS_DEFAULT_MIN,
                    "enum_values": _TLS_VERSION_CHOICES,
                    "description": "Lowest TLS protocol version offered to the server",
                },
                {
                    "name": "tls_max_version",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": _TLS_DEFAULT_MAX,
                    "enum_values": _TLS_VERSION_CHOICES,
                    "description": "Highest TLS protocol version offered to the server",
                },
                {
                    "name": "cipher_suites",
                    "type": "array",
                    "required": False,
                    "description": (
                        "Cipher suites offered to the server, in client preference "
                        "order per protocol family (OpenSSL or IANA names). Unset offers "
                        "every suite WAVE supports for the selected TLS version range; an "
                        "empty list offers no ciphers; a null entry fails the run."
                    ),
                },
                {
                    "name": "allow_redirects",
                    "type": "boolean",
                    "required": False,
                    "default": True,
                    "description": "Follow HTTP redirects",
                },
                {
                    "name": "max_redirects",
                    "type": "integer",
                    "required": False,
                    "default": 10,
                    "description": "Maximum number of redirects to follow",
                },
                {
                    "name": "proxy_mode",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "wave-setting",
                    "enum_values": ["wave-setting", "off"],
                    "description": (
                        "Proxy: WAVE setting follows Settings > Network > Proxy; Off connects "
                        "directly. On a remote host the block uses that host's own proxy settings."
                    ),
                },
                {
                    "name": "retry_count",
                    "type": "integer",
                    "required": False,
                    "default": 0,
                    "description": "Number of retry attempts on failure",
                },
                {
                    "name": "retry_delay",
                    "type": "float",
                    "required": False,
                    "default": 1,
                    "description": "Initial delay between retries in seconds",
                },
                {
                    "name": "retry_backoff_factor",
                    "type": "float",
                    "required": False,
                    "default": 2,
                    "description": "Exponential backoff multiplier for retry delay",
                },
                {
                    "name": "retryable_status_codes",
                    "type": "array",
                    "required": False,
                    "default": ["502", "503", "504"],
                    "description": "HTTP status codes that trigger retry; a null entry is skipped.",
                },
            ],
            "return_type": "map",
            "output_schema": [
                {"name": "status_code", "type": "integer"},
                {"name": "body", "type": "string"},
                {"name": "headers", "type": "map"},
                {"name": "content_type", "type": "string"},
                {"name": "response_time", "type": "float"},
                {"name": "final_url", "type": "string"},
                {"name": "size", "type": "integer"},
                {"name": "sha256", "type": "string"},
                {"name": "trace", "type": "map"},
            ],
            "secret_mask_fields": [
                "authorization",
                "proxy-authorization",
                "cookie",
                "set-cookie",
                "x-api-key",
                "x-auth-token",
                "x-csrf-token",
                "x-xsrf-token",
            ],
            "author": "WAVE Framework",
            "tags": ["http", "https", "network", "api", "rest"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """
        Validate plugin parameters.

        Args:
            params: Parameter values to validate

        Raises:
            ValueError: On validation failure
            TypeError: On type mismatch
        """
        self._validate_method(params)
        self._validate_url(params)
        self._validate_body_and_headers(params)
        self._validate_modes(params)
        self._validate_numeric_params(params)
        self._validate_boolean_params(params)
        self._validate_retry_params(params)

    def _validate_method(self, params: dict[str, Any]) -> None:
        """Validate required 'method' parameter."""
        if "method" not in params:
            raise ValueError("Missing required parameter: method")

        method = params["method"]
        if not isinstance(method, str):
            raise TypeError("Parameter 'method' must be a string")

        validate_enum_from_schema("method", method, self.metadata["parameters"])

    def _validate_url(self, params: dict[str, Any]) -> None:
        """Validate required 'url' parameter."""
        if "url" not in params:
            raise ValueError("Missing required parameter: url")

        url = params["url"]
        if not isinstance(url, str):
            raise TypeError("Parameter 'url' must be a string")

        text = url.strip()
        if not text:
            raise ValueError("Parameter 'url' cannot be empty")

        try:
            parse_web_address(text)
        except WebAddressError as exc:
            refusal = _URL_REFUSALS[typed_reason(text, exc)]
            raise ValueError(f"{refusal} (got '{text[:50]}')") from exc

    def _validate_body_and_headers(self, params: dict[str, Any]) -> None:
        """Validate optional body, headers, and query_params parameters."""
        if "body" in params and not isinstance(params["body"], str):
            raise TypeError("Parameter 'body' must be a string")

        if "headers" in params:
            self._validate_string_dict(params["headers"], "headers", "header")

        if "query_params" in params:
            self._validate_string_dict(params["query_params"], "query_params", "query parameter")

    def _validate_modes(self, params: dict[str, Any]) -> None:
        """Validate mode/TLS-version enums and their conditional requirements."""
        for name in (
            "body_mode",
            "response_mode",
            "proxy_mode",
            "auth_mode",
            "file_content_type",
            "tls_min_version",
            "tls_max_version",
        ):
            if name in params:
                validate_enum_from_schema(name, params[name], self.metadata["parameters"])

        if "cipher_suites" in params and not isinstance(params["cipher_suites"], list):
            raise TypeError("Parameter 'cipher_suites' must be an array")
        check_entry_nulls("cipher_suites", params.get("cipher_suites"))

        if params.get("body_mode") == "file" and not params.get("file_source"):
            raise ValueError("Missing required parameter: file_source")

    @staticmethod
    def _validate_string_dict(value: Any, param_name: str, item_label: str) -> None:
        """Validate a dict with string keys; values are not type-checked here - a
        resolved expression value is coerced to str at send (_coerce_string_maps)."""
        if not isinstance(value, dict):
            raise TypeError(f"Parameter '{param_name}' must be a dict")

        for key in value:
            if not isinstance(key, str):
                raise TypeError(f"All {item_label} keys must be strings")

    def _validate_numeric_params(self, params: dict[str, Any]) -> None:
        """Validate optional timeout, max_redirects, and max_size parameters."""
        _validate_positive_number(params, "timeout", "Parameter 'timeout'")
        _validate_positive_number(params, "max_redirects", "Parameter 'max_redirects'")
        _validate_positive_number(params, "max_size", "Parameter 'max_size'")

    def _validate_boolean_params(self, params: dict[str, Any]) -> None:
        """Validate optional boolean parameters."""
        for name in ("verify_ssl", "allow_redirects", "auth_enabled", "body_auto_headers"):
            if name in params and not isinstance(params[name], bool):
                raise TypeError(f"Parameter '{name}' must be a boolean")

        if "ca_cert" in params and not isinstance(params["ca_cert"], str):
            raise TypeError("Parameter 'ca_cert' must be a string")

    def _validate_retry_params(self, params: dict[str, Any]) -> None:
        """Validate retry-related parameters."""
        if "retry_count" in params:
            retry_count = params["retry_count"]
            if not is_number_value(retry_count):
                raise TypeError("Parameter 'retry_count' must be a number")
            if retry_count < 0:
                raise ValueError("Parameter 'retry_count' must be non-negative")

        _validate_positive_number(params, "retry_delay", "Parameter 'retry_delay'")
        _validate_positive_number(
            params, "retry_backoff_factor", "Parameter 'retry_backoff_factor'"
        )

        if "retryable_status_codes" in params:
            if not isinstance(params["retryable_status_codes"], list):
                raise TypeError("Parameter 'retryable_status_codes' must be an array")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Execute HTTP request.

        Args:
            context: Execution context with parameters, logger, variables, etc.

        Returns:
            dict: Response data with status_code, headers, body, content_type,
                response_time, final_url, size, sha256, trace

        Raises:
            Exception: On execution failure
        """
        params = context["parameters"]
        variables = context.get("variables", {})
        reveal = {f.lower() for f in context.get("unmasked_secret_fields", [])}
        output_secret = {f.lower() for f in context.get("output_secret_fields", [])}

        req = HTTPRequestConfig(
            method=params.get("method", "GET"),
            url=params["url"],
            body=params.get("body"),
            headers=params.get("headers", {}).copy(),
            query_params=params.get("query_params", {}),
            timeout_seconds=params.get("timeout", 30),
            verify_ssl=params.get("verify_ssl", True),
            ca_cert=params.get("ca_cert"),
            allow_redirects=params.get("allow_redirects", True),
            max_redirects=params.get("max_redirects", 10),
            retry_count=params.get("retry_count", 0),
            retry_delay=params.get("retry_delay", 1),
            retry_backoff_factor=params.get("retry_backoff_factor", 2),
            retryable_status_codes=params.get("retryable_status_codes", ["502", "503", "504"]),
            variables=variables,
            logger=context.get("logger"),
            body_mode=params.get("body_mode", "text"),
            body_auto_headers=params.get("body_auto_headers", True),
            file_content_type=params.get("file_content_type", "auto"),
            form_fields=params.get("form_fields", {}),
            parts=params.get("parts", []),
            file_source=params.get("file_source"),
            response_mode=params.get("response_mode", "body"),
            file_path=params.get("file_path"),
            max_size=params.get("max_size"),
            client_cert=params.get("client_cert"),
            client_key=params.get("client_key"),
            tls_min_version=params.get("tls_min_version", _TLS_DEFAULT_MIN),
            tls_max_version=params.get("tls_max_version", _TLS_DEFAULT_MAX),
            cipher_suites=(
                list(params["cipher_suites"])
                if isinstance(params.get("cipher_suites"), list)
                else None
            ),
            proxy_mode=params.get("proxy_mode", "wave-setting"),
            auth_enabled=params.get("auth_enabled", False),
            auth_mode=params.get("auth_mode", "basic"),
            auth_username=params.get("auth_username"),
            auth_password=params.get("auth_password"),
            auth_token=params.get("auth_token"),
            auth_header_name=params.get("auth_header_name"),
            auth_key=params.get("auth_key"),
            artifacts_dir=context.get("artifacts_dir"),
            testdata_dirs=context.get("testdata_dirs"),
            parameter_sources=context.get("parameter_sources") or {},
            register_secret=context.get("register_secret"),
            reveal_fields=reveal,
            headers_output_secret="headers" in output_secret,
            trace_output_secret="trace" in output_secret,
        )

        self._coerce_string_maps(req)
        self._enforce_header_policy(req)
        self._enforce_tls_policy(req)
        self._compose_auth_header(req)
        self._apply_generated_content_type(req)
        self._log_request(req)
        self._register_request_credentials(req.headers, req.register_secret, reveal)
        write = log_via(req.logger) if req.logger else _ignore_line
        token = run_log.RUN_LOG.set(run_log.RunLog(write))
        try:
            result = await self._execute_request(req)
        finally:
            run_log.RUN_LOG.reset(token)
        self._register_response_credentials(result["headers"], req.register_secret, reveal)
        return result

    @staticmethod
    def _coerce_string_maps(req: HTTPRequestConfig) -> None:
        """Coerce resolved header/query/form map VALUES to the HTTP string contract.

        Whole-value ``{{ expression }}`` entries can resolve to a non-string
        (e.g. an int) or None (empty ``{{}}``); HTTP requires strings.
        """
        req.headers = {key: _coerce_str(value) for key, value in req.headers.items()}
        req.query_params = {key: _coerce_str(value) for key, value in req.query_params.items()}
        req.form_fields = {key: _coerce_str(value) for key, value in req.form_fields.items()}

    @staticmethod
    def _enforce_tls_policy(req: HTTPRequestConfig) -> None:
        """Version-order and cipher-name guards; stores canonical OpenSSL names."""
        versions = _TLS_VERSION_CHOICES
        if versions.index(req.tls_min_version) > versions.index(req.tls_max_version):
            raise ValueError(_TLS_MIN_MAX_SENTENCE)
        if req.cipher_suites is not None:
            canonical: list[str] = []
            for name in req.cipher_suites:
                resolved = tls_capabilities.normalize(name)
                if resolved is None:
                    raise ValueError(f'Unknown cipher suite "{name}"')
                canonical.append(resolved)
            req.cipher_suites = canonical

    @staticmethod
    def _auth_header_value(req: HTTPRequestConfig) -> tuple[str, str]:
        """(name, value) for the configured auth mode; missing fields fail fast."""
        if req.auth_mode == "bearer":
            if not req.auth_token:
                raise ValueError('Auth mode "Bearer token" requires a Token')
            return "Authorization", f"Bearer {req.auth_token}"
        if req.auth_mode == "api_key":
            if not req.auth_header_name or not req.auth_key:
                raise ValueError('Auth mode "API key" requires Header Name and Key')
            return req.auth_header_name, req.auth_key
        if not req.auth_username or not req.auth_password:
            raise ValueError('Auth mode "Basic" requires Username and Password')
        # A resolved expression may hand either one over as a number.
        login = basic_authorization(str(req.auth_username), str(req.auth_password))
        return "Authorization", login

    @classmethod
    def _compose_auth_header(cls, req: HTTPRequestConfig) -> None:
        """Compose the Auth section's header; it overwrites same-named rows.

        The composed value registers as a run secret; a revealed mode field
        also marks the composed header name revealed so no later catalog/hop
        registration clobbers the block exemption (protection wins otherwise).
        """
        if not req.auth_enabled:
            return
        name, value = cls._auth_header_value(req)
        for key in [k for k in req.headers if k.lower() == name.lower()]:
            del req.headers[key]
        req.headers[name] = value
        revealed = _AUTH_SECRET_FIELDS.get(req.auth_mode, "auth_password") in req.reveal_fields
        if revealed:
            req.reveal_fields.add(name.lower())
        if callable(req.register_secret):
            req.register_secret(value, revealed)

    def _enforce_header_policy(self, req: HTTPRequestConfig) -> None:
        """Reject blocked framing keys before sending."""
        source = req.parameter_sources.get("headers", "headers")
        for key in req.headers:
            if key.lower() in _BLOCKED_FRAMING_KEYS:
                raise ValueError(f'Headers from {source} contain "{key}": {_BLOCKED_KEY_SENTENCE}')

    @classmethod
    def _apply_generated_content_type(cls, req: HTTPRequestConfig) -> None:
        """The generated Content-Type overwrites same-named map rows (auth-header rule).

        Multipart is forced generated whatever the stored checkbox: rows are
        removed so the transport writes its own boundary Content-Type.
        """
        if req.body_mode == "multipart":
            cls._delete_content_type_rows(req)
        elif req.body_auto_headers and req.body_mode == "form":
            cls._delete_content_type_rows(req)
            req.headers["Content-Type"] = _FORM_CONTENT_TYPE
        elif req.body_auto_headers and req.body_mode == "file":
            cls._delete_content_type_rows(req)
            req.headers["Content-Type"] = cls._file_body_content_type(req)

    @staticmethod
    def _delete_content_type_rows(req: HTTPRequestConfig) -> None:
        for key in [k for k in req.headers if k.lower() == "content-type"]:
            del req.headers[key]

    @staticmethod
    def _file_body_content_type(req: HTTPRequestConfig) -> str:
        """The explicit file_content_type, or extension detection on 'auto'."""
        if req.file_content_type != "auto":
            return req.file_content_type
        return content_type_for(PurePosixPath(req.file_source or "").name)

    def _register_request_credentials(
        self, headers: dict[str, str], register_secret: Any, reveal: set[str] | None = None
    ) -> None:
        """Register credential request-header VALUES at send time (catalog-keyed)."""
        if not callable(register_secret):
            return
        reveal = reveal or set()
        catalog = set(self.metadata["secret_mask_fields"])
        for key, value in headers.items():
            if key.lower() in catalog:
                register_secret(value, key.lower() in reveal)

    def _register_response_credentials(
        self, headers: dict[str, str], register_secret: Any, reveal: set[str] | None = None
    ) -> None:
        """Register credential-header VALUES with the run registry.

        The response output stays viewable; only the credential bytes mask
        wherever they appear downstream. A revealed header still registers -
        the reveal only exempts this block's own display lines.
        """
        if not callable(register_secret):
            return
        reveal = reveal or set()
        catalog = set(self.metadata["secret_mask_fields"])
        for key, value in headers.items():
            if key.lower() in catalog:
                register_secret(value, key.lower() in reveal)

    def _register_hop_credentials(
        self, exchanges: list[dict[str, Any]], req: HTTPRequestConfig
    ) -> None:
        """Register every hop's catalog-keyed header values BEFORE any log line renders them.

        A user-marked-secret ``headers`` or ``trace`` output extends this to
        every hop header value (the same byte-forms the post-execute output
        registration covers, moved ahead of the emission-time scrub).
        """
        if not callable(req.register_secret):
            return
        catalog = set(self.metadata["secret_mask_fields"])
        register_all = req.headers_output_secret or req.trace_output_secret
        for exchange in exchanges:
            for name, value in exchange["request"]["headers"]:
                if name.lower() in catalog or register_all:
                    req.register_secret(value, name.lower() in req.reveal_fields)
            for name, value in exchange["response"]["headers"]:
                if name.lower() in catalog or register_all:
                    req.register_secret(value, name.lower() in req.reveal_fields)

    def _mask_hop_credentials(
        self, exchanges: list[dict[str, Any]], req: HTTPRequestConfig
    ) -> None:
        """Mask catalog-keyed header values by NAME in the hop structure itself.

        Runs AFTER registration (which needs the raw values); the reveal
        contract keeps this block's revealed names raw.
        """
        catalog = set(self.metadata["secret_mask_fields"])
        for exchange in exchanges:
            for headers in (exchange["request"]["headers"], exchange["response"]["headers"]):
                for header in headers:
                    lowered = header[0].lower()
                    if lowered in catalog and lowered not in req.reveal_fields:
                        header[1] = structural_mask(header[1])

    def _log_request(self, req: HTTPRequestConfig) -> None:
        """Log request details at INFO and DEBUG levels."""
        if not req.logger:
            return

        url_display = req.url
        if req.query_params:
            qs = "&".join(f"{k}={v}" for k, v in req.query_params.items())
            url_display = f"{req.url}?{qs}"
        req.logger.info(f"HTTP {req.method} {url_display} (timeout: {req.timeout_seconds}s)")

        if not hasattr(req.logger, "debug"):
            return

        self._log_tls_details(req.logger, req.verify_ssl, req.ca_cert)
        if req.retry_count > 0:
            req.logger.debug(
                f"Retry: {req.retry_count}x, delay {req.retry_delay}s, "
                f"backoff {req.retry_backoff_factor}x, codes {req.retryable_status_codes}"
            )
        if not req.allow_redirects:
            req.logger.debug("Redirects: disabled")
        elif req.max_redirects != 10:
            req.logger.debug(f"Max redirects: {req.max_redirects}")

    @staticmethod
    def _log_tls_details(logger: Any, verify_ssl: bool, ca_cert: str | None) -> None:
        """Log TLS verification configuration."""
        if not verify_ssl:
            logger.debug("TLS verification: disabled")
        elif ca_cert:
            logger.debug(f"TLS verification: custom CA ({ca_cert})")

    async def _execute_request(self, req: HTTPRequestConfig) -> dict[str, Any]:
        """Execute HTTP request with retry logic.

        Args:
            req: HTTP request configuration

        Returns:
            Response dictionary

        Raises:
            Exception: On request failure after all retries
        """
        method = req.method.upper()
        if method not in _ALLOWED_METHODS:
            raise ValueError(f"Unsupported HTTP method: {method}")

        tls_config = await self._build_tls_config(req)
        run = _RequestRun()
        body_kwargs, opened_files = self._build_body(req, run)
        request_kwargs = self._build_request_kwargs(req, body_kwargs, run)

        try:
            async with httpx.AsyncClient(**self._build_client_kwargs(req)) as client:
                self._install_tls_backend(client, tls_config)
                response, response_time = await self._retry_loop(
                    client, method, request_kwargs, req, run
                )
        finally:
            for handle in opened_files:
                handle.close()

        result = self._finalize_response(req, response, response_time, run)
        self._emit_trace_entries(req, run, result["trace"])
        return result

    async def _build_tls_config(self, req: HTTPRequestConfig) -> http_tls.TLSClientConfig:
        """The engine's TLS config: block CA, identity, pins; a blank CA is read per connection."""
        anchors: str | None = None
        if req.verify_ssl and req.ca_cert:
            anchors = await _pem_text(req.ca_cert)
        return http_tls.TLSClientConfig(
            min_version=req.tls_min_version,
            max_version=req.tls_max_version,
            cipher_names=req.cipher_suites,
            verify=req.verify_ssl,
            anchors_pem=anchors,
            client_cert_pem=await _pem_text(req.client_cert) if req.client_cert else None,
            client_key_pem=await _pem_text(req.client_key) if req.client_key else None,
        )

    @staticmethod
    def _install_tls_backend(client: Any, tls_config: http_tls.TLSClientConfig) -> None:
        """Swap the pure-Python TLS backend under httpx's pools (direct and proxied)."""
        if not isinstance(client, _ASYNC_CLIENT_TYPE):
            return
        transport: Any = client._transport
        if isinstance(transport, _ProxyRoutingTransport):
            transport.install_backend(tls_config)
        else:
            transport._pool._network_backend = _TlsliteBackend(tls_config)

    def _resolve_file_source(self, source: str, req: HTTPRequestConfig) -> Path:
        """Resolve an artifact:// / testdata:// / plain file source to a real file."""
        try:
            resolved = resolve_plugin_path(
                source, req.artifacts_dir, req.testdata_dirs, read_only_ok=True
            )
        except (FileNotFoundError, ValueError):
            # A missing scheme root or an absent testdata candidate reads as "not found" here.
            raise FileNotFoundError(f"File not found: {source}") from None
        if not resolved.is_file():
            raise FileNotFoundError(f"File not found: {source}")
        return resolved

    def _build_body(
        self, req: HTTPRequestConfig, run: _RequestRun
    ) -> tuple[dict[str, Any], list[Any]]:
        """Build the body-mode request kwargs: (kwargs, opened file handles)."""
        if req.body_mode == "form":
            fields = dict(req.form_fields or {})
            run.request_body_size = len(urllib.parse.urlencode(fields).encode())
            return {"content": None, "data": fields or None}, []

        if req.body_mode == "multipart":
            return self._build_multipart(req, run)

        if req.body_mode == "file":
            path = self._resolve_file_source(req.file_source or "", req)
            run.request_body_size = path.stat().st_size
            return {"content": _stream_file(path)}, []

        body = req.body or None
        run.request_body_size = len(req.body.encode()) if req.body else 0
        return {"content": body}, []

    def _build_multipart(
        self, req: HTTPRequestConfig, run: _RequestRun
    ) -> tuple[dict[str, Any], list[Any]]:
        """Build multipart form-data kwargs: every part rides files= (text parts
        as filename-less fields) so the encoding is multipart even without files."""
        files: list[tuple[str, tuple[str | None, Any] | tuple[str, Any, str]]] = []
        opened: list[Any] = []
        size = 0
        for part in req.parts or []:
            name = str(part.get("name", ""))
            if part.get("kind") == "file":
                path = self._resolve_file_source(str(part.get("source", "")), req)
                handle = open(path, "rb")
                opened.append(handle)
                files.append((name, (path.name, handle, content_type_for(path.name))))
                size += path.stat().st_size
            else:
                value = _coerce_str(part.get("value"))
                files.append((name, (None, value)))
                size += len(value.encode())
        run.request_body_size = size
        return {"content": None, "files": files or None}, opened

    @staticmethod
    def _build_request_kwargs(
        req: HTTPRequestConfig,
        body_kwargs: dict[str, Any],
        run: _RequestRun,
    ) -> dict[str, Any]:
        """Build per-request kwargs (the client owns timeout / redirects / verify)."""
        return {
            "url": req.url,
            "params": req.query_params or None,
            "headers": dict(req.headers) or None,
            "extensions": {"trace": run.collector.on_event},
            **body_kwargs,
        }

    @staticmethod
    def _build_client_kwargs(req: HTTPRequestConfig) -> dict[str, Any]:
        """Build httpx.AsyncClient kwargs: redirects, timeout, proxy route (HTTP/1.1 only).

        verify is off at the httpx layer - the pure-Python backend performs
        certificate verification itself against the configured trust anchors.
        """
        kwargs: dict[str, Any] = {
            "verify": False,
            "trust_env": False,
            "follow_redirects": req.allow_redirects,
            "max_redirects": req.max_redirects,
            "timeout": req.timeout_seconds,
            "http1": True,
            "http2": False,
        }
        spec = None if req.proxy_mode == "off" else proxy.active_proxy()
        if spec is not None:
            kwargs["transport"] = _ProxyRoutingTransport(spec)
        return kwargs

    @staticmethod
    async def _wait_before_retry(
        attempt: int,
        retry_delay: int | float,
        retry_backoff_factor: int | float,
    ) -> None:
        """Calculate and sleep for retry backoff delay."""
        delay = retry_delay * (retry_backoff_factor**attempt)
        await asyncio.sleep(delay)

    def _should_retry_status(
        self,
        response: Any,
        retryable_status_codes: list[str],
        attempt: int,
        retry_count: int,
        logger: Any,
    ) -> bool:
        """Check if response status code warrants a retry."""
        if str(response.status_code) not in retryable_status_codes:
            return False
        if attempt >= retry_count:
            return False
        if logger:
            logger.warning(
                f"Retryable status code {response.status_code}, "
                f"retrying ({attempt + 1}/{retry_count})"
            )
        return True

    async def _retry_loop(
        self,
        client: Any,
        method: str,
        request_kwargs: dict[str, Any],
        req: HTTPRequestConfig,
        run: _RequestRun,
    ) -> tuple[Any, float]:
        """Execute request with retry logic, collecting per-attempt trace hops."""
        attempt = 0
        while attempt <= req.retry_count:
            try:
                start_time = time.time()
                response = await client.request(method=method, **request_kwargs)
                response_time = time.time() - start_time

                exchanges = self._exchanges_from(response)
                if exchanges:
                    run.attempts.append(exchanges)
                    self._register_hop_credentials(exchanges, req)
                    self._mask_hop_credentials(exchanges, req)
                self._log_response(
                    req.logger, response, response_time, len(response.content), req.url
                )

                if self._should_retry_status(
                    response, req.retryable_status_codes, attempt, req.retry_count, req.logger
                ):
                    attempt += 1
                    await self._wait_before_retry(
                        attempt - 1, req.retry_delay, req.retry_backoff_factor
                    )
                    continue

                return response, response_time

            except (TimeoutError, httpx.HTTPError, ConnectionError) as e:
                if attempt >= req.retry_count:
                    raise
                if req.logger:
                    req.logger.warning(
                        f"Request failed: {e}, retrying ({attempt + 1}/{req.retry_count})"
                    )
                attempt += 1
                await self._wait_before_retry(
                    attempt - 1, req.retry_delay, req.retry_backoff_factor
                )

        raise RuntimeError("Request failed after all retry attempts")

    @staticmethod
    def _exchanges_from(response: Any) -> list[dict[str, Any]] | None:
        """Extract the redirect-chain exchanges of one attempt (real responses only)."""
        if not isinstance(response, httpx.Response):
            return None
        exchanges: list[dict[str, Any]] = []
        for hop in [*response.history, response]:
            try:
                duration_ms = hop.elapsed.total_seconds() * 1000
            except RuntimeError:
                duration_ms = 0.0
            exchanges.append(
                {
                    "request": {
                        "method": hop.request.method,
                        "url": str(hop.request.url),
                        "headers": [
                            [n.decode("latin-1"), v.decode("latin-1")]
                            for n, v in hop.request.headers.raw
                        ],
                    },
                    "response": {
                        "status": hop.status_code,
                        "reason": hop.reason_phrase,
                        "headers": [
                            [n.decode("latin-1"), v.decode("latin-1")] for n, v in hop.headers.raw
                        ],
                    },
                    "duration_ms": duration_ms,
                }
            )
        return exchanges

    def _finalize_response(
        self, req: HTTPRequestConfig, response: Any, response_time: float, run: _RequestRun
    ) -> dict[str, Any]:
        """Build the result dictionary, applying the size cap and response mode."""
        content: bytes = response.content
        run.response_size = len(content)
        cap = req.max_size or (_DEFAULT_BODY_CAP if req.response_mode != "file" else None)
        if cap is not None and len(content) > cap:
            content = content[:cap]
            if req.logger:
                req.logger.warning(f"Response size exceeded {_humanize_size(cap)} - truncated")

        content_type = response.headers.get("Content-Type", "")
        result: dict[str, Any] = {
            "status_code": response.status_code,
            "headers": dict(response.headers),
            "content_type": content_type,
            "response_time": response_time,
            "final_url": str(response.url),
            "trace": self._build_trace(run),
        }

        if req.response_mode == "file":
            result.update(self._write_download(req, response, content))
        else:
            if _is_binary_content(content_type):
                body = base64.b64encode(content).decode("ascii")
            else:
                body = content.decode(_charset_from_content_type(content_type), errors="replace")
            result.update({"body": body, "size": len(content), "sha256": ""})
        return result

    def _write_download(
        self, req: HTTPRequestConfig, response: Any, content: bytes
    ) -> dict[str, Any]:
        """Stream the (capped) download to disk and return its output fields."""
        if req.file_path:
            # The full target as given: written in place, an existing file replaced.
            target = resolve_plugin_path(
                req.file_path, req.artifacts_dir, req.testdata_dirs, read_only_ok=False
            )
            directory, name = target.parent, target.name
        else:
            directory = Path(req.artifacts_dir) if req.artifacts_dir else Path.cwd()
            name = self._uniquify_name(directory, self._resolve_download_name(response))
        path, size, digest = store.write_stream(directory, name, _iter_chunks(content))
        body = self._download_reference(path, req.artifacts_dir)
        return {"body": body, "size": size, "sha256": digest}

    @staticmethod
    def _download_reference(path: Path, artifacts_dir: str | None) -> str:
        """An artifact reference for a file inside the run's artifacts, the path otherwise."""
        if artifacts_dir:
            root = Path(artifacts_dir).resolve()
            real = path.resolve()
            if real.is_relative_to(root):
                return f"artifact://{real.relative_to(root).as_posix()}"
        return str(path)

    @staticmethod
    def _resolve_download_name(response: Any) -> str:
        """Naming precedence for an empty File Path: Content-Disposition > URL basename."""
        disposition = response.headers.get("Content-Disposition", "")
        if disposition:
            message = Message()
            message["content-disposition"] = disposition
            filename = message.get_filename()
            if filename:
                return PurePosixPath(filename).name
        basename = PurePosixPath(urlparse(str(response.url)).path).name
        return basename or _FALLBACK_DOWNLOAD_NAME

    @staticmethod
    def _uniquify_name(directory: Path, name: str) -> str:
        """Uniquify a colliding name with a numeric suffix before the extension."""
        if not (directory / name).exists():
            return name
        stem, ext = os.path.splitext(name)
        counter = 2
        while (directory / f"{stem}-{counter}{ext}").exists():
            counter += 1
        return f"{stem}-{counter}{ext}"

    def _build_trace(self, run: _RequestRun) -> dict[str, Any]:
        """Assemble the structured trace output: tls, timing, hops, sizes."""
        hops: list[dict[str, Any]] = []
        for attempt_index, exchanges in enumerate(run.attempts):
            for exchange_index, exchange in enumerate(exchanges):
                if exchange_index < len(exchanges) - 1:
                    kind = "redirect"
                elif attempt_index < len(run.attempts) - 1:
                    kind = "retry"
                else:
                    kind = "final"
                hops.append({"kind": kind, **exchange})
        return {
            "tls": run.collector.tls,
            "timing": run.collector.timing(),
            "hops": hops,
            "sizes": {"request_body": run.request_body_size, "response": run.response_size},
        }

    def _emit_trace_entries(
        self, req: HTTPRequestConfig, run: _RequestRun, trace: dict[str, Any]
    ) -> None:
        """Render the combined multiline DEBUG entries: connect+TLS / exchanges / timing."""
        logger = req.logger
        if not logger or not hasattr(logger, "debug") or not run.attempts:
            return
        connect_entry = self._render_connect_entry(run.collector)
        if connect_entry:
            logger.debug(connect_entry)
        for hop in trace["hops"]:
            logger.debug(self._render_exchange_entry(hop))
        logger.debug(self._render_timing_entry(trace["timing"]))

    @staticmethod
    def _render_connect_entry(collector: _TraceCollector) -> str | None:
        """The connection-establishment entry, with negotiated TLS facts when present."""
        if collector.connect_host is None:
            return None
        lines = [f"Connected to {collector.connect_host}:{collector.connect_port}"]
        tls = collector.tls
        if tls:
            lines.append(f"TLS {tls['protocol']}, cipher {tls['cipher']}")
            lines.append(f"Peer {tls['peer_subject']} (issuer {tls['peer_issuer']})")
            lines.append(
                f"Valid {tls['not_before']} - {tls['not_after']} "
                f"({tls['days_to_expiry']} days to expiry)"
            )
        return "\n".join(lines)

    @staticmethod
    def _render_exchange_entry(hop: dict[str, Any]) -> str:
        """One exchange entry: request line + headers sent, response line + headers."""
        request = hop["request"]
        response = hop["response"]
        lines = [
            f"{request['method']} {request['url']} -> {response['status']} "
            f"{response['reason']} ({hop['duration_ms']:.1f}ms)"
        ]
        lines.extend(f"> {name}: {value}" for name, value in request["headers"])
        lines.extend(f"< {name}: {value}" for name, value in response["headers"])
        return "\n".join(lines)

    @staticmethod
    def _render_timing_entry(timing: dict[str, float]) -> str:
        """The timing-breakdown entry."""
        return (
            f"Timing: dns {timing['dns_ms']:.1f}ms, connect {timing['connect_ms']:.1f}ms, "
            f"tls {timing['tls_ms']:.1f}ms, first byte {timing['first_byte_ms']:.1f}ms, "
            f"download {timing['download_ms']:.1f}ms, total {timing['total_ms']:.1f}ms"
        )

    def _log_response(
        self,
        logger: Any,
        response: Any,
        response_time: float,
        response_body: str | int,
        original_url: str,
    ) -> None:
        """Log the response summary at INFO level."""
        if not logger:
            return

        response_ms = int(response_time * 1000)
        body_size = len(response_body) if isinstance(response_body, str) else response_body
        size_display = f"{body_size / 1024:.1f} KB" if body_size >= 1024 else f"{body_size} B"
        content_type = response.headers.get("Content-Type", "")
        ct = content_type or "no content-type"

        logger.info(
            f"HTTP {response.status_code} {response.reason_phrase} "
            f"({response_ms}ms, {size_display}, {ct})"
        )
        if str(response.url) != original_url:
            logger.info(f"Redirected to: {response.url}")
