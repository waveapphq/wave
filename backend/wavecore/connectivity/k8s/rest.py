"""Pure-Python Kubernetes REST core (REQ-5.1.1, REQ-3.4.1.5, REQ-4.5.16).

Signs requests with a bearer token and/or a TLS client certificate, verifies
the server against the pinned CA (else WAVE's trust set) honoring
tls_server_name, applies the TLS version and cipher pins via the bundled TLS
engine, joins every API path under the api_url base preserving a gateway path
prefix, parses /version, and drives the TokenRequest API. Every connection
is dialed through the proxy core, which tunnels it when a proxy route is in
force (REQ-4.7.14). Sync by design - local plugins call it via a thread
offload. Imports stdlib, the bundled TLS engine, WAVE's trust store, the
proxy core and the web address parser only, so the module stays vendorable.
"""

import datetime
import io
import json
import re
import socket
import urllib.parse
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Protocol

from wavecore.connectivity import proxy, trust_store
from wavecore.connectivity.web_address import (
    HOST,
    PORT,
    SCHEME,
    WebAddress,
    WebAddressError,
    parse_web_address,
)

_READ_CHUNK = 65536
_DEFAULT_ACCEPT = "application/json"
_DEFAULT_CONTENT_TYPE = "application/json"
_WARNING_VALUE = re.compile(r'\d{3} \S+ "((?:[^"\\]|\\.)*)"')
_DISCOVERY_MATCH_FIELDS = ("kind", "singularName", "name")
_TRUNCATED_BODY = "Kubernetes API response ended before the body was complete"
UNREADABLE_BODY_MESSAGE = (
    "Kubernetes API response body is not JSON - check whether a proxy or gateway "
    "answered instead of the cluster"
)
_ADDRESS_REFUSALS = {
    SCHEME: "Kubernetes API address must start with http:// or https://",
    HOST: "Kubernetes API address needs a host",
    PORT: "Kubernetes API address port must be between 1 and 65535",
}


class K8sApiError(Exception):
    """A Kubernetes API request failed or could not be carried out."""


class K8sDiscoveryDenied(Exception):
    """The cluster refused a discovery document with a 401 or 403 Status."""

    def __init__(self, status: int, body: dict[str, Any]) -> None:
        super().__init__(f"Kubernetes API discovery denied ({status})")
        self.status = status
        self.body = body


class K8sContextLike(Protocol):
    """The connection facts the client consumes (duck-typed to K8sContext)."""

    @property
    def server(self) -> str: ...

    @property
    def ca_cert(self) -> str | None: ...

    @property
    def verify(self) -> bool: ...

    @property
    def server_name(self) -> str | None: ...

    @property
    def tls_min_version(self) -> str: ...

    @property
    def tls_max_version(self) -> str: ...

    @property
    def cipher_suites(self) -> list[str] | None: ...

    @property
    def token(self) -> str | None: ...

    @property
    def client_cert(self) -> str | None: ...

    @property
    def client_key(self) -> str | None: ...


@dataclass
class _Wire:
    """One connected exchange: raw socket plus its write/read callables."""

    sock: socket.socket
    write: Callable[[bytes], object]
    read: Callable[[int], bytes]


def wave_anchors() -> str:
    """The PEM a blank CA trusts: WAVE's trust set, read at each connection (REQ-4.5.16)."""
    return trust_store.anchors_pem(trust_store.active_spec())


def tls_config(context: K8sContextLike) -> Any:
    """The TLS engine settings for a context; a blank CA verifies against WAVE's trust set."""
    # Imported on use: a top-level plugins import cycles back here via K8s Connect.
    from wavecore.plugins import http_tls

    anchors = context.ca_cert
    if not anchors and context.verify:
        anchors = wave_anchors()
    return http_tls.TLSClientConfig(
        min_version=context.tls_min_version,
        max_version=context.tls_max_version,
        cipher_names=context.cipher_suites,
        verify=context.verify,
        anchors_pem=anchors,
        client_cert_pem=context.client_cert,
        client_key_pem=context.client_key,
    )


def server_address(context: K8sContextLike) -> WebAddress:
    """The parts of a context's server address; a refusal never repeats it (it may hold a login)."""
    try:
        return parse_web_address(context.server)
    except WebAddressError as error:
        raise ValueError(_ADDRESS_REFUSALS[error.reason]) from None


def host_header(address: WebAddress) -> str:
    """The Host header of a server address: its host and written port, never its login."""
    if address.port is None:
        return address.bracketed_host
    return f"{address.bracketed_host}:{address.port}"


@dataclass(frozen=True)
class K8sResource:
    """One resource the cluster serves, as discovery reports it."""

    kind: str
    name: str
    namespaced: bool
    group_version: str
    path_root: str


class _ResponseStream(io.RawIOBase):
    """Adapts a wire read callable to a raw stream a BufferedReader can wrap."""

    def __init__(self, read: Callable[[int], bytes]) -> None:
        super().__init__()
        self._receive = read

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Any) -> int:
        data = self._receive(len(buffer))
        buffer[: len(data)] = data
        return len(data)


class K8sClient:
    """One-per-block-execution synchronous client for a cluster's REST API."""

    def __init__(
        self,
        context: K8sContextLike,
        timeout: float,
        *,
        impersonate_user: str | None = None,
        impersonate_groups: list[str] | None = None,
    ) -> None:
        self._context = context
        self._timeout = timeout
        self._impersonation = [f"Impersonate-User: {impersonate_user}"] if impersonate_user else []
        self._impersonation += [f"Impersonate-Group: {group}" for group in impersonate_groups or []]
        self._discovery: dict[str, dict[str, Any]] = {}
        self.last_warnings: list[str] = []
        address = server_address(context)
        self._scheme = address.scheme
        self._host = address.host
        self._port = address.effective_port
        self._host_header = host_header(address)
        self._prefix = address.path.rstrip("/")

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        *,
        accept: str | None = None,
        raw: bool = False,
        content_type: str | None = None,
    ) -> tuple[int, Any]:
        """Signed request; returns (status, parsed or raw body), API errors included."""
        self.last_warnings = []
        wire = self._connect()
        try:
            self._send(wire, method, path, body, accept, content_type)
            status, payload, warnings = self._read_response(wire, raw)
            self.last_warnings = warnings
            return status, payload
        except TimeoutError as exc:
            raise K8sApiError(
                f"Kubernetes API request {method} {path} "
                f"timed out after {self._timeout} seconds"
            ) from exc
        finally:
            wire.sock.close()

    def server_version(self) -> str:
        """Raw gitVersion reported by /version (e.g. 'v1.33.0')."""
        status, parsed = self.request("GET", "/version", None)
        self._require_success("GET", "/version", status, parsed)
        return str(parsed["gitVersion"])

    def token_request(self, sa: str, namespace: str, duration: int) -> tuple[str, str]:
        """Mint a service-account token; returns (token, granted expiration timestamp)."""
        path = f"/api/v1/namespaces/{namespace}/serviceaccounts/{sa}/token"
        body = {
            "apiVersion": "authentication.k8s.io/v1",
            "kind": "TokenRequest",
            "spec": {"expirationSeconds": duration},
        }
        status, parsed = self.request("POST", path, body)
        self._require_success("POST", path, status, parsed)
        granted = parsed["status"]
        return str(granted["token"]), str(granted["expirationTimestamp"])

    def discover(self, kind: str, api_version: str | None = None) -> K8sResource | None:
        """Resolve a kind, plural, singular or short name to the resource the cluster serves."""
        if api_version is not None:
            return self._match(self._discovery_root(api_version), kind)
        found = self._match("/api/v1", kind)
        if found is not None:
            return found
        for group in self._discovery_document("/apis").get("groups", []):
            found = self._match(
                self._discovery_root(group["preferredVersion"]["groupVersion"]), kind
            )
            if found is not None:
                return found
        return None

    @staticmethod
    def _discovery_root(group_version: str) -> str:
        if group_version == "v1":
            return "/api/v1"
        return f"/apis/{urllib.parse.quote(group_version, safe='/')}"

    def _discovery_document(self, path: str) -> dict[str, Any]:
        document = self._discovery.get(path)
        if document is None:
            status, document = self.request("GET", path, None)
            if status in (401, 403):
                raise K8sDiscoveryDenied(status, document)
            # Like kubectl, a group whose document fails is skipped, not fatal.
            if status >= 400:
                document = {}
            self._discovery[path] = document
        return document

    def _match(self, root: str, kind: str) -> K8sResource | None:
        document = self._discovery_document(root)
        wanted = kind.lower()
        entries = [
            entry for entry in document.get("resources", []) if "/" not in entry.get("name", "")
        ]
        for field in _DISCOVERY_MATCH_FIELDS:
            for entry in entries:
                if str(entry.get(field, "")).lower() == wanted:
                    return self._resource(document, entry, root)
        for entry in entries:
            if wanted in [str(short).lower() for short in entry.get("shortNames", [])]:
                return self._resource(document, entry, root)
        return None

    @staticmethod
    def _resource(document: dict[str, Any], entry: dict[str, Any], root: str) -> K8sResource:
        return K8sResource(
            kind=str(entry["kind"]),
            name=str(entry["name"]),
            namespaced=bool(entry["namespaced"]),
            group_version=str(document["groupVersion"]),
            path_root=root,
        )

    def _connect(self) -> _Wire:
        # Imported on use: a top-level plugins import cycles back here via K8s Connect.
        from wavecore.plugins import http_tls

        context = self._context
        server = context.server
        # Read before the socket opens, so a refused trust source leaves nothing to close.
        config = tls_config(context) if self._scheme == "https" else None
        try:
            sock = proxy.connect(self._host, self._port, self._timeout, self._scheme)
        except OSError as exc:
            raise K8sApiError(
                f"Could not connect to the Kubernetes API at {server}: {exc}"
            ) from exc
        if config is None:
            return _Wire(sock, sock.sendall, sock.recv)
        try:
            result = http_tls.tls_handshake(
                sock,
                config,
                context.server_name or self._host,
                # datetime.UTC is 3.11+; the remote bundle runs on 3.10 hosts (keep timezone.utc).
                datetime.datetime.now(datetime.timezone.utc),
            )
        except http_tls.TLSVerificationFailure as exc:
            sock.close()
            raise K8sApiError(f"Could not verify the TLS certificate of {server}: {exc}") from exc
        except http_tls.TLSHandshakeError as exc:
            sock.close()
            raise K8sApiError(
                f"Could not connect to the Kubernetes API at {server}: {exc}"
            ) from exc
        connection = result.connection
        return _Wire(sock, connection.write, lambda size: bytes(connection.read(max=size)))

    def _send(
        self,
        wire: _Wire,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        accept: str | None,
        content_type: str | None,
    ) -> None:
        lines = [
            f"{method} {self._prefix}{path} HTTP/1.1",
            f"Host: {self._host_header}",
            f"Accept: {_DEFAULT_ACCEPT if accept is None else accept}",
        ]
        token = self._context.token
        if token:
            lines.append(f"Authorization: Bearer {token}")
        lines.extend(self._impersonation)
        payload = b""
        if body is not None:
            payload = json.dumps(body).encode()
            lines.append(
                f"Content-Type: {_DEFAULT_CONTENT_TYPE if content_type is None else content_type}"
            )
            lines.append(f"Content-Length: {len(payload)}")
        head = "\r\n".join(lines) + "\r\n\r\n"
        wire.write(head.encode() + payload)

    @classmethod
    def _read_response(cls, wire: _Wire, raw: bool) -> tuple[int, Any, list[str]]:
        stream = io.BufferedReader(_ResponseStream(wire.read), _READ_CHUNK)
        status = int(stream.readline().split()[1])
        length: int | None = None
        chunked = False
        warnings: list[str] = []
        while True:
            line = stream.readline().strip()
            if not line:
                break
            name, _, value = line.partition(b":")
            name = name.strip().lower()
            if name == b"content-length":
                length = int(value)
            elif name == b"transfer-encoding":
                chunked = b"chunked" in value.lower()
            elif name == b"warning":
                warnings.append(_warning_text(value.strip().decode()))
        if chunked:
            payload = cls._read_chunked(stream)
        elif length is None:
            payload = stream.read()
        else:
            payload = cls._read_exact(stream, length)
        if raw:
            return status, payload, warnings
        return status, cls._parse_body(status, payload), warnings

    @staticmethod
    def _parse_body(status: int, payload: bytes) -> dict[str, Any]:
        """The body as the JSON object it should be; an unreadable error body is empty."""
        if not payload:
            return {}
        decoded: Any = None
        with suppress(ValueError):
            decoded = json.loads(payload)
        if isinstance(decoded, dict):
            return decoded
        if status >= 400:
            return {}
        raise K8sApiError(UNREADABLE_BODY_MESSAGE)

    @classmethod
    def _read_chunked(cls, stream: io.BufferedIOBase) -> bytes:
        parts: list[bytes] = []
        while True:
            line = stream.readline()
            if not line:
                raise K8sApiError(_TRUNCATED_BODY)
            size = int(line.split(b";", 1)[0], 16)
            if size == 0:
                return b"".join(parts)
            parts.append(cls._read_exact(stream, size))
            stream.readline()

    @staticmethod
    def _read_exact(stream: io.BufferedIOBase, size: int) -> bytes:
        data = stream.read(size)
        if len(data) != size:
            raise K8sApiError(_TRUNCATED_BODY)
        return data

    @staticmethod
    def _require_success(method: str, path: str, status: int, body: dict[str, Any]) -> None:
        if status >= 400:
            message = body.get("message", "")
            detail = f": {message}" if message else ""
            raise K8sApiError(f"Kubernetes API request {method} {path} failed ({status}){detail}")


def _warning_text(value: str) -> str:
    """The quoted text of an RFC 7234 Warning value; anything else stays verbatim."""
    match = _WARNING_VALUE.fullmatch(value)
    if match is None:
        return value
    return re.sub(r"\\(.)", r"\1", match.group(1))
