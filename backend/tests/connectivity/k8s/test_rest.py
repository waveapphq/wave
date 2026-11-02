"""K8s REST core wire-level tests (REQ-5.1.1, REQ-3.4.1.5).

The pure-Python REST core signs requests (bearer and/or mTLS), verifies the
server against a pinned or bundled CA honoring tls_server_name, applies the
TLS version and cipher pins, joins every API path under the api_url base
(path prefix preserved), parses /version, and drives the TokenRequest
API. Driven here against local in-process recording servers; error messages
follow the shared K8s message table exactly.

With a proxy route in force a request rides a CONNECT tunnel the proxy opens to
the server, TLS stays end to end, and a proxy failure reads as an unreachable
server (REQ-4.7.14).
"""

import importlib
import inspect
import json
import re
import socket
import ssl
import threading
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any

import pytest

from tests.connectivity._proxy_servers import Proxy, closed_port
from tests.plugins.http.conftest import (
    RecordingHTTPServer,
    TLSMaterial,
    _RecordingHandler,
    _start_server,
)
from wavecore.connectivity.k8s.rest import K8sApiError, K8sClient
from wavecore.connectivity.run_log import RUN_LOG, RunLog


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


@dataclass(frozen=True)
class _Ctx:
    """Local mirror of the K8sContext attributes the client consumes."""

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


class _TLSFactsHandler(_RecordingHandler):
    """Adds the negotiated TLS protocol and cipher to each request record."""

    def _handle(self) -> None:
        super()._handle()
        server: Any = self.server
        connection: Any = self.connection
        server.requests[-1]["tls_version"] = connection.version()
        server.requests[-1]["tls_cipher"] = connection.cipher()[0]

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle
    do_PATCH = _handle
    do_HEAD = _handle
    do_OPTIONS = _handle


def _tls_facts_server(
    material: TLSMaterial,
    *,
    require_client_cert: bool = False,
    max_tls12: bool = False,
) -> RecordingHTTPServer:
    server = RecordingHTTPServer(("127.0.0.1", 0))
    server.RequestHandlerClass = _TLSFactsHandler
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(material.server_cert_path, material.server_key_path)
    if require_client_cert:
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(material.ca_cert_path)
    if max_tls12:
        context.maximum_version = ssl.TLSVersion.TLSv1_2
    server.socket = context.wrap_socket(server.socket, server_side=True)  # type: ignore[assignment]
    return _start_server(server, "https")


@pytest.fixture(scope="module")
def tls_material(tmp_path_factory: pytest.TempPathFactory) -> TLSMaterial:
    return TLSMaterial(tmp_path_factory.mktemp("k8s-tls-material"))


@pytest.fixture
def http_server() -> Generator[RecordingHTTPServer, None, None]:
    server = _start_server(RecordingHTTPServer(("127.0.0.1", 0)), "http")
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def tls_server(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    server = _tls_facts_server(tls_material)
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def mtls_server(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    server = _tls_facts_server(tls_material, require_client_cert=True)
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def tls12_server(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    server = _tls_facts_server(tls_material, max_tls12=True)
    yield server
    server.shutdown()
    server.server_close()


def _client(
    base_url: str,
    material: TLSMaterial | None = None,
    timeout: float = 5,
    **overrides: Any,
) -> K8sClient:
    fields: dict[str, Any] = {"server": base_url}
    if material is not None:
        fields["ca_cert"] = material.ca_cert_pem
    fields.update(overrides)
    return K8sClient(_Ctx(**fields), timeout)


def _enqueue_json(server: RecordingHTTPServer, payload: Any, status: int = 200) -> None:
    server.enqueue(
        status=status,
        body=json.dumps(payload).encode(),
        content_type="application/json",
    )


def _untrusted(base_url: str) -> str:
    return (
        f"Could not verify the TLS certificate of {base_url}: "
        "Certificate verification failed: no trusted issuer found "
        'for certificate "CN=wave-test-server"'
    )


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


_UNREADABLE_MESSAGE = (
    "Kubernetes API response body is not JSON - check whether a proxy or gateway "
    "answered instead of the cluster"
)
_HTML_ERROR_PAGE = (
    b"<html><head><title>502 Bad Gateway</title></head>"
    b"<body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>"
)
_PARTIAL_JSON = b'{"kind": "Status", "message": "the server is currently un'
_UNREADABLE_ERROR_BODIES = [
    _HTML_ERROR_PAGE,
    _PARTIAL_JSON,
    b"[1, 2, 3]",
    b'"gateway timeout"',
    b"\x1f\x8b\x08\x00\x00\x00\x00\x00",
]
_UNREADABLE_IDS = ["html-page", "truncated-json", "json-array", "json-string", "gzip-bytes"]


class TestRequestBasics:
    """Verbs, paths, bodies, and the path join under a prefixed api_url."""

    def test_get_returns_status_and_parsed_body(self, http_server: RecordingHTTPServer) -> None:
        _enqueue_json(http_server, {"kind": "PodList", "items": []})

        status, body = _client(http_server.base_url).request("GET", "/api/v1/pods", None)

        assert status == 200
        assert body == {"kind": "PodList", "items": []}
        assert http_server.requests[0]["method"] == "GET"
        assert http_server.requests[0]["path"] == "/api/v1/pods"
        assert http_server.requests[0]["body"] == b""

    @pytest.mark.parametrize("method", ["GET", "POST", "PUT", "DELETE", "PATCH"])
    def test_verbs_reach_the_wire(self, http_server: RecordingHTTPServer, method: str) -> None:
        _enqueue_json(http_server, {})

        _client(http_server.base_url).request(method, "/api/v1/namespaces", None)

        assert http_server.requests[0]["method"] == method

    def test_json_body_and_content_type(self, http_server: RecordingHTTPServer) -> None:
        _enqueue_json(http_server, {"kind": "Scale"})
        payload = {"spec": {"replicas": 3}}

        _client(http_server.base_url).request(
            "PUT", "/apis/apps/v1/namespaces/apps/deployments/web/scale", payload
        )

        assert json.loads(http_server.requests[0]["body"]) == payload
        assert http_server.requests[0]["headers"]["content-type"] == "application/json"

    @pytest.mark.parametrize("status", [401, 403, 404, 409, 500])
    def test_error_statuses_are_returned_not_raised(
        self, http_server: RecordingHTTPServer, status: int
    ) -> None:
        _enqueue_json(http_server, {"kind": "Status", "code": status}, status=status)

        got_status, body = _client(http_server.base_url).request("GET", "/api/v1/pods", None)

        assert got_status == status
        assert body == {"kind": "Status", "code": status}

    def test_path_joins_under_a_prefixed_api_url(self, http_server: RecordingHTTPServer) -> None:
        _enqueue_json(http_server, {"kind": "PodList"})
        api_url = f"{http_server.base_url}/k8s/clusters/c-1"

        _client(api_url).request("GET", "/api/v1/pods", None)

        assert http_server.requests[0]["path"] == "/k8s/clusters/c-1/api/v1/pods"

    def test_trailing_slash_prefix_joins_cleanly(self, http_server: RecordingHTTPServer) -> None:
        _enqueue_json(http_server, {"kind": "PodList"})
        api_url = f"{http_server.base_url}/k8s/clusters/c-1/"

        _client(api_url).request("GET", "/api/v1/pods", None)

        assert http_server.requests[0]["path"] == "/k8s/clusters/c-1/api/v1/pods"

    def test_anonymous_request_sends_no_authorization_header(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(http_server, {})

        _client(http_server.base_url).request("GET", "/version", None)

        assert "authorization" not in http_server.requests[0]["headers"]


class TestAuth:
    """Bearer, mTLS, both at once, and anonymous credential handling."""

    def test_bearer_token_rides_the_authorization_header(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(http_server, {})

        _client(http_server.base_url, token="tok-11223344").request("GET", "/api/v1/pods", None)

        assert http_server.requests[0]["headers"]["authorization"] == "Bearer tok-11223344"

    def test_client_cert_satisfies_an_mtls_server(
        self, mtls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(mtls_server, {"ok": True})
        client = _client(
            mtls_server.base_url,
            tls_material,
            client_cert=tls_material.client_cert_pem,
            client_key=tls_material.client_key_pem,
        )

        status, body = client.request("GET", "/api/v1/pods", None)

        assert status == 200
        assert body == {"ok": True}

    def test_client_cert_alone_sends_no_authorization_header(
        self, mtls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(mtls_server, {})
        client = _client(
            mtls_server.base_url,
            tls_material,
            client_cert=tls_material.client_cert_pem,
            client_key=tls_material.client_key_pem,
        )

        client.request("GET", "/api/v1/pods", None)

        assert "authorization" not in mtls_server.requests[0]["headers"]

    def test_token_and_client_cert_together(
        self, mtls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(mtls_server, {"ok": True})
        client = _client(
            mtls_server.base_url,
            tls_material,
            token="tok-both",
            client_cert=tls_material.client_cert_pem,
            client_key=tls_material.client_key_pem,
        )

        status, _ = client.request("GET", "/api/v1/pods", None)

        assert status == 200
        assert mtls_server.requests[0]["headers"]["authorization"] == "Bearer tok-both"

    def test_missing_client_identity_is_rejected_by_an_mtls_server(
        self, mtls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        client = _client(mtls_server.base_url, tls_material)

        with pytest.raises(Exception, match=r".+"):
            client.request("GET", "/api/v1/pods", None)


class TestTLSVerification:
    """CA pinning, verify off, and the tls_server_name override."""

    def test_pinned_ca_verifies_the_server(
        self, tls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_server, {"ok": True})

        status, _ = _client(tls_server.base_url, tls_material).request("GET", "/version", None)

        assert status == 200

    def test_untrusted_ca_yields_the_tls_failure_message(
        self, tls_server: RecordingHTTPServer
    ) -> None:
        client = _client(tls_server.base_url)
        message = (
            f"Could not verify the TLS certificate of {tls_server.base_url}: "
            "Certificate verification failed: no trusted issuer found "
            'for certificate "CN=wave-test-server"'
        )

        with pytest.raises(Exception, match=_exact(message)):
            client.request("GET", "/version", None)

    def test_verify_off_skips_verification(self, tls_server: RecordingHTTPServer) -> None:
        _enqueue_json(tls_server, {"ok": True})

        status, _ = _client(tls_server.base_url, verify=False).request("GET", "/version", None)

        assert status == 200

    def test_tls_server_name_override_verifies_a_san_hostname(
        self, tls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_server, {"ok": True})
        client = _client(tls_server.base_url, tls_material, server_name="localhost")

        status, _ = client.request("GET", "/version", None)

        assert status == 200

    def test_tls_server_name_mismatch_yields_the_tls_failure_message(
        self, tls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        client = _client(tls_server.base_url, tls_material, server_name="wave-internal")
        message = (
            f"Could not verify the TLS certificate of {tls_server.base_url}: "
            'Certificate verification failed: hostname "wave-internal" does not match '
            "the server certificate"
        )

        with pytest.raises(Exception, match=_exact(message)):
            client.request("GET", "/version", None)


class TestWaveTrust:
    """REQ-4.5.16: a blank CA trusts WAVE's trust set; a session CA is the only one trusted."""

    def test_a_blank_ca_verifies_against_waves_anchors(
        self, tls_server: RecordingHTTPServer, wave_trust: _WaveTrust
    ) -> None:
        _enqueue_json(tls_server, {"ok": True})

        status, _ = _client(tls_server.base_url).request("GET", "/version", None)

        assert status == 200

    def test_a_blank_ca_reads_the_anchors_of_the_active_spec(
        self, tls_server: RecordingHTTPServer, wave_trust: _WaveTrust
    ) -> None:
        _enqueue_json(tls_server, {"ok": True})

        _client(tls_server.base_url).request("GET", "/version", None)

        assert wave_trust.calls == [wave_trust.spec]

    def test_a_blank_ca_refuses_a_server_waves_anchors_do_not_cover(
        self,
        tls_server: RecordingHTTPServer,
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        wave_trust.pem = tls_material.client_cert_pem
        with pytest.raises(K8sApiError, match=_exact(_untrusted(tls_server.base_url))):
            _client(tls_server.base_url).request("GET", "/version", None)

    def test_a_session_ca_is_the_only_certificate_trusted(
        self,
        tls_server: RecordingHTTPServer,
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        client = _client(tls_server.base_url, ca_cert=tls_material.client_cert_pem)
        with pytest.raises(K8sApiError, match=_exact(_untrusted(tls_server.base_url))):
            client.request("GET", "/version", None)

    def test_a_session_ca_never_reads_waves_anchors(
        self,
        tls_server: RecordingHTTPServer,
        tls_material: TLSMaterial,
        wave_trust: _WaveTrust,
    ) -> None:
        _enqueue_json(tls_server, {"ok": True})

        status, _ = _client(tls_server.base_url, tls_material).request("GET", "/version", None)

        assert status == 200
        assert wave_trust.calls == []

    def test_verify_off_never_reads_waves_anchors(
        self, tls_server: RecordingHTTPServer, wave_trust: _WaveTrust
    ) -> None:
        wave_trust.pem = ""
        _enqueue_json(tls_server, {"ok": True})

        status, _ = _client(tls_server.base_url, verify=False).request("GET", "/version", None)

        assert status == 200
        assert wave_trust.calls == []

    def test_a_plain_http_server_never_reads_waves_anchors(
        self, http_server: RecordingHTTPServer, wave_trust: _WaveTrust
    ) -> None:
        _enqueue_json(http_server, {"ok": True})

        status, _ = _client(http_server.base_url).request("GET", "/version", None)

        assert status == 200
        assert wave_trust.calls == []

    def test_each_connection_reads_the_active_spec_afresh(
        self, tls_server: RecordingHTTPServer, wave_trust: _WaveTrust
    ) -> None:
        _enqueue_json(tls_server, {"ok": True})
        _enqueue_json(tls_server, {"ok": True})
        client = _client(tls_server.base_url)

        client.request("GET", "/version", None)
        wave_trust.pem = ""
        with pytest.raises(K8sApiError, match=_exact(_untrusted(tls_server.base_url))):
            client.request("GET", "/version", None)


class TestTLSConstraints:
    """The context's TLS version and cipher pins reach the negotiation."""

    def test_default_configuration_negotiates_tls13(
        self, tls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_server, {})

        _client(tls_server.base_url, tls_material).request("GET", "/version", None)

        assert tls_server.requests[0]["tls_version"] == "TLSv1.3"

    def test_max_version_pin_is_applied(
        self, tls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_server, {})

        _client(tls_server.base_url, tls_material, tls_max_version="1.2").request(
            "GET", "/version", None
        )

        assert tls_server.requests[0]["tls_version"] == "TLSv1.2"

    def test_min_version_pin_rejects_an_older_server(
        self, tls12_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        client = _client(tls12_server.base_url, tls_material, tls_min_version="1.3")

        with pytest.raises(
            Exception,
            match=rf"^Could not connect to the Kubernetes API at "
            rf"{re.escape(tls12_server.base_url)}: .+$",
        ):
            client.request("GET", "/version", None)

    def test_cipher_pin_openssl_name_is_negotiated(
        self, tls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_server, {})
        client = _client(
            tls_server.base_url,
            tls_material,
            tls_max_version="1.2",
            cipher_suites=["ECDHE-ECDSA-AES128-GCM-SHA256"],
        )

        client.request("GET", "/version", None)

        assert tls_server.requests[0]["tls_version"] == "TLSv1.2"
        assert tls_server.requests[0]["tls_cipher"] == "ECDHE-ECDSA-AES128-GCM-SHA256"

    def test_cipher_pin_iana_name_is_normalized(
        self, tls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_server, {})
        client = _client(
            tls_server.base_url,
            tls_material,
            tls_max_version="1.2",
            cipher_suites=["TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256"],
        )

        client.request("GET", "/version", None)

        assert tls_server.requests[0]["tls_cipher"] == "ECDHE-ECDSA-AES128-GCM-SHA256"

    def test_tls13_cipher_pin_is_negotiated(
        self, tls_server: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_server, {})
        client = _client(
            tls_server.base_url,
            tls_material,
            cipher_suites=["TLS_AES_128_GCM_SHA256"],
        )

        client.request("GET", "/version", None)

        assert tls_server.requests[0]["tls_version"] == "TLSv1.3"
        assert tls_server.requests[0]["tls_cipher"] == "TLS_AES_128_GCM_SHA256"


class TestTransportFailures:
    """Refused connections and request timeouts render the shared messages."""

    def test_connection_refused_maps_to_the_transport_message(self) -> None:
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        api_url = f"http://127.0.0.1:{port}"

        with pytest.raises(
            Exception,
            match=rf"^Could not connect to the Kubernetes API at {re.escape(api_url)}: .+$",
        ):
            _client(api_url).request("GET", "/version", None)

    def test_request_timeout_maps_to_the_timeout_message(
        self, http_server: RecordingHTTPServer
    ) -> None:
        http_server.enqueue(body=b"{}", content_type="application/json", delay=0.3)
        client = _client(http_server.base_url, timeout=0.05)

        with pytest.raises(
            Exception,
            match=_exact("Kubernetes API request GET /api/v1/pods timed out after 0.05 seconds"),
        ):
            client.request("GET", "/api/v1/pods", None)


class TestServerVersion:
    """/version fetch and parse (REQ-4.6.3 floor data source)."""

    def test_server_version_returns_the_raw_git_version(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(http_server, {"major": "1", "minor": "33", "gitVersion": "v1.33.0"})

        version = _client(http_server.base_url).server_version()

        assert version == "v1.33.0"
        assert http_server.requests[0]["method"] == "GET"
        assert http_server.requests[0]["path"] == "/version"

    def test_server_version_joins_under_the_path_prefix(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(http_server, {"major": "1", "minor": "33", "gitVersion": "v1.33.0"})
        api_url = f"{http_server.base_url}/k8s/clusters/c-1"

        version = _client(api_url).server_version()

        assert version == "v1.33.0"
        assert http_server.requests[0]["path"] == "/k8s/clusters/c-1/version"

    def test_server_version_error_raises_the_generic_request_message(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(http_server, {"kind": "Status", "message": "apiserver not ready"}, status=503)

        with pytest.raises(
            Exception,
            match=_exact("Kubernetes API request GET /version failed (503): apiserver not ready"),
        ):
            _client(http_server.base_url).server_version()

    def test_server_version_error_without_a_message_names_only_the_status(
        self, http_server: RecordingHTTPServer
    ) -> None:
        http_server.enqueue(status=502, body=_HTML_ERROR_PAGE, content_type="text/html")

        with pytest.raises(
            Exception,
            match=_exact("Kubernetes API request GET /version failed (502)"),
        ):
            _client(http_server.base_url).server_version()

    def test_server_version_on_a_body_that_is_not_json_raises_the_unreadable_message(
        self, http_server: RecordingHTTPServer
    ) -> None:
        http_server.enqueue(status=200, body=b"ok", content_type="text/plain")

        with pytest.raises(K8sApiError, match=_exact(_UNREADABLE_MESSAGE)):
            _client(http_server.base_url).server_version()


class TestTokenRequest:
    """The TokenRequest call: wire shape, granted values, failure mapping."""

    _RESPONSE = {
        "kind": "TokenRequest",
        "status": {"token": "minted-token", "expirationTimestamp": "2026-08-19T15:00:00Z"},
    }

    def test_token_request_posts_the_token_request_body(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(http_server, self._RESPONSE)

        _client(http_server.base_url).token_request("wave-tests", "ops", 3600)

        request = http_server.requests[0]
        assert request["method"] == "POST"
        assert request["path"] == "/api/v1/namespaces/ops/serviceaccounts/wave-tests/token"
        assert json.loads(request["body"]) == {
            "apiVersion": "authentication.k8s.io/v1",
            "kind": "TokenRequest",
            "spec": {"expirationSeconds": 3600},
        }
        assert request["headers"]["content-type"] == "application/json"

    def test_token_request_returns_the_granted_token_and_expiry(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(http_server, self._RESPONSE)

        token, expiry = _client(http_server.base_url).token_request("wave-tests", "default", 600)

        assert token == "minted-token"
        assert expiry == "2026-08-19T15:00:00Z"

    def test_token_request_rides_the_configured_credentials(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(http_server, self._RESPONSE)

        _client(http_server.base_url, token="org-token").token_request("wave-tests", "default", 600)

        assert http_server.requests[0]["headers"]["authorization"] == "Bearer org-token"

    def test_token_request_error_raises_the_generic_request_message(
        self, http_server: RecordingHTTPServer
    ) -> None:
        _enqueue_json(
            http_server,
            {"kind": "Status", "message": "tokenrequests.authentication.k8s.io is forbidden"},
            status=403,
        )
        message = (
            "Kubernetes API request POST /api/v1/namespaces/default/serviceaccounts/"
            "wave-tests/token failed (403): tokenrequests.authentication.k8s.io is forbidden"
        )

        with pytest.raises(Exception, match=_exact(message)):
            _client(http_server.base_url).token_request("wave-tests", "default", 600)


_FAKE_SERVER = "https://k8s.example:6443"

_TABLE_ACCEPT = "application/json;as=Table;g=meta.k8s.io;v=v1,application/json"

_DEFAULT_CONTENT_TYPE = "application/json"
_APPLY_PATCH_MEDIA = "application/apply-patch+yaml"
_STRATEGIC_MERGE_MEDIA = "application/strategic-merge-patch+json"
_MERGE_PATCH_MEDIA = "application/merge-patch+json"

_WRITE_MEDIA_TYPES = [
    _APPLY_PATCH_MEDIA,
    _STRATEGIC_MERGE_MEDIA,
    _MERGE_PATCH_MEDIA,
    _DEFAULT_CONTENT_TYPE,
]

_LOG_TEXT = b"2026-08-22T09:14:02Z starting worker\n2026-08-22T09:14:03Z {not json\n"

_CORE_V1: dict[str, Any] = {
    "kind": "APIResourceList",
    "groupVersion": "v1",
    "resources": [
        {"name": "pods/log", "singularName": "", "namespaced": True, "kind": "Pod"},
        {
            "name": "pods",
            "singularName": "pod",
            "namespaced": True,
            "kind": "Pod",
            "shortNames": ["po"],
        },
        {
            "name": "nodes",
            "singularName": "node",
            "namespaced": False,
            "kind": "Node",
            "shortNames": ["no"],
        },
    ],
}

_API_GROUPS: dict[str, Any] = {
    "kind": "APIGroupList",
    "groups": [
        {
            "name": "batch",
            "versions": [{"groupVersion": "batch/v1", "version": "v1"}],
            "preferredVersion": {"groupVersion": "batch/v1", "version": "v1"},
        },
        {
            "name": "apps",
            "versions": [{"groupVersion": "apps/v1", "version": "v1"}],
            "preferredVersion": {"groupVersion": "apps/v1", "version": "v1"},
        },
    ],
}

_BATCH_V1: dict[str, Any] = {
    "kind": "APIResourceList",
    "groupVersion": "batch/v1",
    "resources": [
        {"name": "jobs", "singularName": "job", "namespaced": True, "kind": "Job"},
    ],
}

_APPS_V1: dict[str, Any] = {
    "kind": "APIResourceList",
    "groupVersion": "apps/v1",
    "resources": [
        {
            "name": "deployments/status",
            "singularName": "",
            "namespaced": True,
            "kind": "Deployment",
        },
        {
            "name": "deployments",
            "singularName": "deployment",
            "namespaced": True,
            "kind": "Deployment",
            "shortNames": ["deploy"],
        },
    ],
}

_COLLIDING_V1: dict[str, Any] = {
    "kind": "APIResourceList",
    "groupVersion": "v1",
    "resources": [
        {
            "name": "aliases",
            "singularName": "alias",
            "namespaced": True,
            "kind": "Alias",
            "shortNames": ["pod"],
        },
        {
            "name": "pods",
            "singularName": "pod",
            "namespaced": True,
            "kind": "Pod",
            "shortNames": ["po"],
        },
    ],
}

_BIG_POD_LIST: dict[str, Any] = {
    "kind": "PodList",
    "apiVersion": "v1",
    "metadata": {"resourceVersion": "914233"},
    "items": [
        {
            "metadata": {"name": f"web-{index:03d}", "namespace": "apps"},
            "status": {"phase": "Running", "podIP": f"10.42.0.{index}"},
        }
        for index in range(60)
    ],
}


class _FakeSocket:
    """Stands in for the connected socket; the client only ever closes it."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _ScriptedWire:
    """Fake transport: records every byte written, replays scripted socket reads."""

    def __init__(self, reads: list[bytes]) -> None:
        self.sock = _FakeSocket()
        self.writes: list[bytes] = []
        self._reads = list(reads)

    def write(self, data: bytes) -> None:
        self.writes.append(data)

    def read(self, size: int) -> bytes:
        if not self._reads:
            return b""
        piece = self._reads.pop(0)
        if len(piece) > size:
            self._reads.insert(0, piece[size:])
            return piece[:size]
        return piece


def _wire_client(
    monkeypatch: pytest.MonkeyPatch,
    reads: list[bytes],
    **overrides: Any,
) -> tuple[K8sClient, _ScriptedWire]:
    """A real client over a scripted fake transport - no socket is ever opened."""
    wire = _ScriptedWire(reads)
    monkeypatch.setattr(K8sClient, "_connect", lambda _self: wire)
    return _client(_FAKE_SERVER, **overrides), wire


def _sent(wire: _ScriptedWire, index: int = 0) -> tuple[str, dict[str, str], bytes]:
    head, _, payload = wire.writes[index].partition(b"\r\n\r\n")
    lines = head.decode().split("\r\n")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        name, _, value = line.partition(":")
        headers[name.strip().lower()] = value.strip()
    return lines[0], headers, payload


def _request_lines(wire: _ScriptedWire) -> list[str]:
    return [_sent(wire, index)[0] for index in range(len(wire.writes))]


def _response(payload: bytes, headers: list[str], status: int = 200) -> bytes:
    head = "\r\n".join([f"HTTP/1.1 {status} OK", *headers])
    return head.encode() + b"\r\n\r\n" + payload


def _sized(payload: bytes, status: int = 200) -> bytes:
    return _response(
        payload,
        ["Content-Type: application/json", f"Content-Length: {len(payload)}"],
        status,
    )


def _doc(payload: dict[str, Any]) -> bytes:
    return _sized(json.dumps(payload).encode())


def _chunks(payload: bytes, size: int, extension: str = "") -> bytes:
    framed = b""
    for start in range(0, len(payload), size):
        piece = payload[start : start + size]
        framed += f"{len(piece):x}{extension}\r\n".encode() + piece + b"\r\n"
    return framed + b"0\r\n\r\n"


def _chunked(payload: bytes, size: int = 512, extension: str = "", status: int = 200) -> bytes:
    return _response(
        _chunks(payload, size, extension),
        ["Content-Type: application/json", "Transfer-Encoding: chunked"],
        status,
    )


def _split(data: bytes, cuts: list[int]) -> list[bytes]:
    bounds = [0, *cuts, len(data)]
    pieces = [data[start:end] for start, end in zip(bounds, bounds[1:], strict=False)]
    return [piece for piece in pieces if piece]


class TestDiscovery:
    """Kind resolution against the cluster's discovery documents."""

    def test_core_kind_resolves_to_its_resource_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        found = client.discover("Pod")

        assert found is not None
        assert found.kind == "Pod"
        assert found.name == "pods"
        assert found.namespaced is True
        assert found.group_version == "v1"
        assert found.path_root == "/api/v1"
        assert _request_lines(wire) == ["GET /api/v1 HTTP/1.1"]

    def test_discover_returns_a_k8s_resource(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from wavecore.connectivity.k8s.rest import K8sResource

        client, _wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        found = client.discover("Pod")

        assert isinstance(found, K8sResource)

    def test_cluster_scoped_kind_reports_namespaced_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        found = client.discover("Node")

        assert found is not None
        assert found.name == "nodes"
        assert found.namespaced is False
        assert found.path_root == "/api/v1"

    def test_subresource_entries_are_skipped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, _wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        found = client.discover("Pod")

        assert found is not None
        assert found.name == "pods"

    @pytest.mark.parametrize("kind", ["Pod", "pod", "POD", "pods", "Pods", "po"])
    def test_kind_matches_case_insensitively(
        self, monkeypatch: pytest.MonkeyPatch, kind: str
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        found = client.discover(kind)

        assert found is not None
        assert found.name == "pods"

    def test_kind_match_wins_over_a_short_name_collision(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_doc(_COLLIDING_V1)])

        found = client.discover("Pod")

        assert found is not None
        assert found.name == "pods"

    def test_named_group_kind_walks_the_group_list_in_order(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        reads = [_doc(_CORE_V1), _doc(_API_GROUPS), _doc(_BATCH_V1), _doc(_APPS_V1)]
        client, wire = _wire_client(monkeypatch, reads)

        found = client.discover("Deployment")

        assert found is not None
        assert found.name == "deployments"
        assert found.namespaced is True
        assert found.group_version == "apps/v1"
        assert found.path_root == "/apis/apps/v1"
        assert _request_lines(wire) == [
            "GET /api/v1 HTTP/1.1",
            "GET /apis HTTP/1.1",
            "GET /apis/batch/v1 HTTP/1.1",
            "GET /apis/apps/v1 HTTP/1.1",
        ]

    def test_a_named_group_kind_stops_at_the_first_matching_group(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        reads = [_doc(_CORE_V1), _doc(_API_GROUPS), _doc(_BATCH_V1)]
        client, wire = _wire_client(monkeypatch, reads)

        found = client.discover("Job")

        assert found is not None
        assert found.path_root == "/apis/batch/v1"
        assert _request_lines(wire) == [
            "GET /api/v1 HTTP/1.1",
            "GET /apis HTTP/1.1",
            "GET /apis/batch/v1 HTTP/1.1",
        ]

    def test_unknown_kind_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        reads = [_doc(_CORE_V1), _doc(_API_GROUPS), _doc(_BATCH_V1), _doc(_APPS_V1)]
        client, wire = _wire_client(monkeypatch, reads)

        found = client.discover("Widget")

        assert found is None
        assert len(wire.writes) == 4

    def test_explicit_named_api_version_fetches_only_that_document(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_APPS_V1)])

        found = client.discover("Deployment", "apps/v1")

        assert found is not None
        assert found.path_root == "/apis/apps/v1"
        assert _request_lines(wire) == ["GET /apis/apps/v1 HTTP/1.1"]

    def test_explicit_core_api_version_fetches_only_the_core_document(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        found = client.discover("Pod", "v1")

        assert found is not None
        assert found.path_root == "/api/v1"
        assert _request_lines(wire) == ["GET /api/v1 HTTP/1.1"]

    def test_explicit_api_version_miss_does_not_fall_back(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_APPS_V1)])

        found = client.discover("Pod", "apps/v1")

        assert found is None
        assert _request_lines(wire) == ["GET /apis/apps/v1 HTTP/1.1"]

    def test_discovery_requests_send_the_plain_accept_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        client.discover("Pod")

        assert _sent(wire)[1]["accept"] == "application/json"


class TestDiscoveryCache:
    """Every discovery document is fetched once per client and never shared."""

    def test_a_second_lookup_of_the_same_kind_issues_no_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        first = client.discover("Pod")
        second = client.discover("Pod")

        assert first is not None
        assert second == first
        assert len(wire.writes) == 1

    def test_a_second_kind_in_a_cached_document_issues_no_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        client.discover("Pod")
        found = client.discover("Node")

        assert found is not None
        assert found.name == "nodes"
        assert len(wire.writes) == 1

    def test_the_group_documents_are_cached_too(self, monkeypatch: pytest.MonkeyPatch) -> None:
        reads = [_doc(_CORE_V1), _doc(_API_GROUPS), _doc(_BATCH_V1), _doc(_APPS_V1)]
        client, wire = _wire_client(monkeypatch, reads)

        client.discover("Deployment")
        found = client.discover("Job")

        assert found is not None
        assert found.path_root == "/apis/batch/v1"
        assert len(wire.writes) == 4

    def test_the_cache_does_not_leak_across_clients(self, monkeypatch: pytest.MonkeyPatch) -> None:
        first_client, wire = _wire_client(monkeypatch, [_doc(_CORE_V1), _doc(_CORE_V1)])
        second_client = _client(_FAKE_SERVER)

        assert first_client.discover("Pod") is not None
        assert second_client.discover("Pod") is not None

        assert _request_lines(wire) == ["GET /api/v1 HTTP/1.1", "GET /api/v1 HTTP/1.1"]


class TestAcceptOverride:
    """The per-request Accept override, and the default every other call keeps."""

    def test_the_table_accept_string_is_sent_verbatim(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b'{"kind": "Table"}')])

        client.request("GET", "/api/v1/namespaces/apps/pods", None, accept=_TABLE_ACCEPT)

        assert b"\r\nAccept: " + _TABLE_ACCEPT.encode() + b"\r\n" in wire.writes[0]
        assert _sent(wire)[1]["accept"] == _TABLE_ACCEPT

    def test_no_override_keeps_the_plain_accept_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert b"\r\nAccept: application/json\r\n" in wire.writes[0]

    def test_an_explicit_none_override_keeps_the_plain_accept_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("GET", "/api/v1/namespaces/apps/pods", None, accept=None)

        assert b"\r\nAccept: application/json\r\n" in wire.writes[0]

    def test_exactly_one_accept_header_is_sent_with_the_override(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("GET", "/api/v1/pods", None, accept=_TABLE_ACCEPT)

        assert wire.writes[0].count(b"\r\nAccept: ") == 1

    def test_the_override_leaves_every_other_header_alone(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")], token="tok-accept")

        client.request(
            "POST", "/api/v1/namespaces/apps/pods", {"kind": "Pod"}, accept=_TABLE_ACCEPT
        )

        line, headers, payload = _sent(wire)
        assert line == "POST /api/v1/namespaces/apps/pods HTTP/1.1"
        assert headers["host"] == "k8s.example:6443"
        assert headers["authorization"] == "Bearer tok-accept"
        assert headers["content-type"] == "application/json"
        assert headers["content-length"] == str(len(payload))
        assert json.loads(payload) == {"kind": "Pod"}
        assert set(headers) == {
            "host",
            "accept",
            "authorization",
            "content-type",
            "content-length",
        }

    def test_server_version_still_sends_the_plain_accept_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc({"gitVersion": "v1.33.0"})])

        assert client.server_version() == "v1.33.0"

        assert b"\r\nAccept: application/json\r\n" in wire.writes[0]

    def test_token_request_still_sends_the_plain_accept_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        granted = {"status": {"token": "minted", "expirationTimestamp": "2026-08-22T10:00:00Z"}}
        client, wire = _wire_client(monkeypatch, [_doc(granted)])

        assert client.token_request("wave-tests", "apps", 600) == (
            "minted",
            "2026-08-22T10:00:00Z",
        )

        assert b"\r\nAccept: application/json\r\n" in wire.writes[0]


class TestContentTypeOverride:
    """The per-request Content-Type override the write verbs need, and today's default."""

    _MANIFEST: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {"name": "app-config", "namespace": "apps"},
        "data": {"tier": "gold"},
    }
    _PATH = "/api/v1/namespaces/apps/configmaps/app-config"

    def test_content_type_mirrors_the_accept_keyword_shape(self) -> None:
        parameters = inspect.signature(K8sClient.request).parameters

        assert parameters["content_type"].kind is inspect.Parameter.KEYWORD_ONLY
        assert parameters["content_type"].default is None
        assert parameters["content_type"].kind is parameters["accept"].kind
        assert parameters["content_type"].default == parameters["accept"].default

    @pytest.mark.parametrize("media_type", _WRITE_MEDIA_TYPES)
    def test_the_write_media_types_reach_the_wire_verbatim(
        self, monkeypatch: pytest.MonkeyPatch, media_type: str
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("PATCH", self._PATH, self._MANIFEST, content_type=media_type)

        assert b"\r\nContent-Type: " + media_type.encode() + b"\r\n" in wire.writes[0]
        assert _sent(wire)[1]["content-type"] == media_type

    def test_no_override_sends_the_default_json_content_type(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("POST", self._PATH, self._MANIFEST)

        assert b"\r\nContent-Type: application/json\r\n" in wire.writes[0]

    def test_an_explicit_none_override_sends_the_default_json_content_type(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("POST", self._PATH, self._MANIFEST, content_type=None)

        assert b"\r\nContent-Type: application/json\r\n" in wire.writes[0]

    def test_a_body_request_without_an_override_is_byte_identical_to_today(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")], token="tok-default")
        payload = json.dumps(self._MANIFEST).encode()
        expected = (
            f"POST {self._PATH} HTTP/1.1\r\n"
            "Host: k8s.example:6443\r\n"
            "Accept: application/json\r\n"
            "Authorization: Bearer tok-default\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(payload)}\r\n\r\n"
        ).encode() + payload

        client.request("POST", self._PATH, self._MANIFEST)

        assert wire.writes[0] == expected

    def test_exactly_one_content_type_header_is_sent_with_the_override(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("PATCH", self._PATH, self._MANIFEST, content_type=_APPLY_PATCH_MEDIA)

        assert wire.writes[0].count(b"\r\nContent-Type: ") == 1

    @pytest.mark.parametrize("media_type", [None, *_WRITE_MEDIA_TYPES])
    def test_a_request_with_no_body_sends_no_content_type_header(
        self, monkeypatch: pytest.MonkeyPatch, media_type: str | None
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("DELETE", self._PATH, None, content_type=media_type)

        _line, headers, payload = _sent(wire)
        assert "content-type" not in headers
        assert "content-length" not in headers
        assert b"Content-Type" not in wire.writes[0]
        assert payload == b""

    @pytest.mark.parametrize("media_type", _WRITE_MEDIA_TYPES)
    def test_the_body_is_json_serialized_under_every_media_type(
        self, monkeypatch: pytest.MonkeyPatch, media_type: str
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request("PATCH", self._PATH, self._MANIFEST, content_type=media_type)

        _line, headers, payload = _sent(wire)
        assert payload == json.dumps(self._MANIFEST).encode()
        assert json.loads(payload) == self._MANIFEST
        assert headers["content-length"] == str(len(payload))

    def test_the_override_leaves_every_other_header_alone(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")], token="tok-content")

        client.request("PATCH", self._PATH, self._MANIFEST, content_type=_APPLY_PATCH_MEDIA)

        line, headers, payload = _sent(wire)
        assert line == f"PATCH {self._PATH} HTTP/1.1"
        assert headers["host"] == "k8s.example:6443"
        assert headers["accept"] == "application/json"
        assert headers["authorization"] == "Bearer tok-content"
        assert headers["content-length"] == str(len(payload))
        assert set(headers) == {
            "host",
            "accept",
            "authorization",
            "content-type",
            "content-length",
        }

    def test_content_type_composes_with_the_accept_override(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")])

        client.request(
            "PATCH",
            self._PATH,
            self._MANIFEST,
            accept=_TABLE_ACCEPT,
            content_type=_STRATEGIC_MERGE_MEDIA,
        )

        _line, headers, _payload = _sent(wire)
        assert headers["accept"] == _TABLE_ACCEPT
        assert headers["content-type"] == _STRATEGIC_MERGE_MEDIA

    def test_content_type_composes_with_a_raw_read(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b'{"kind": "ConfigMap"}')])

        status, body = client.request(
            "PATCH", self._PATH, self._MANIFEST, raw=True, content_type=_MERGE_PATCH_MEDIA
        )

        assert (status, body) == (200, b'{"kind": "ConfigMap"}')
        assert _sent(wire)[1]["content-type"] == _MERGE_PATCH_MEDIA

    def test_the_override_does_not_leak_into_the_next_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(b"{}"), _sized(b"{}")])

        client.request("PATCH", self._PATH, self._MANIFEST, content_type=_APPLY_PATCH_MEDIA)
        client.request("POST", self._PATH, self._MANIFEST)

        assert _sent(wire, 0)[1]["content-type"] == _APPLY_PATCH_MEDIA
        assert _sent(wire, 1)[1]["content-type"] == "application/json"

    def test_token_request_still_sends_the_default_json_content_type(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        granted = {"status": {"token": "minted", "expirationTimestamp": "2026-08-27T10:00:00Z"}}
        client, wire = _wire_client(monkeypatch, [_doc(granted)])

        assert client.token_request("wave-tests", "apps", 600) == (
            "minted",
            "2026-08-27T10:00:00Z",
        )

        _line, headers, payload = _sent(wire)
        assert headers["content-type"] == "application/json"
        assert json.loads(payload) == {
            "apiVersion": "authentication.k8s.io/v1",
            "kind": "TokenRequest",
            "spec": {"expirationSeconds": 600},
        }

    def test_server_version_sends_no_content_type_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc({"gitVersion": "v1.33.0"})])

        assert client.server_version() == "v1.33.0"

        assert "content-type" not in _sent(wire)[1]

    def test_discovery_sends_no_content_type_header(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_CORE_V1)])

        client.discover("Pod")

        assert "content-type" not in _sent(wire)[1]


class TestRawBody:
    """raw=True hands back the response bytes; the default still parses JSON."""

    def test_raw_returns_the_body_bytes_without_parsing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        headers = ["Content-Type: text/plain", f"Content-Length: {len(_LOG_TEXT)}"]
        client, _wire = _wire_client(monkeypatch, [_response(_LOG_TEXT, headers)])

        status, body = client.request(
            "GET", "/api/v1/namespaces/apps/pods/web-1/log", None, raw=True
        )

        assert status == 200
        assert isinstance(body, bytes)
        assert body == _LOG_TEXT

    def test_raw_returns_the_error_body_bytes_at_a_failing_status(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps({"kind": "Status", "message": "a container name is required"}).encode()
        client, _wire = _wire_client(monkeypatch, [_sized(payload, 400)])

        status, body = client.request(
            "GET", "/api/v1/namespaces/apps/pods/web-1/log", None, raw=True
        )

        assert status == 400
        assert body == payload

    def test_the_default_path_still_parses_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, _wire = _wire_client(monkeypatch, [_doc({"kind": "PodList", "items": []})])

        status, body = client.request("GET", "/api/v1/pods", None)

        assert (status, body) == (200, {"kind": "PodList", "items": []})

    def test_explicit_raw_false_parses_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, _wire = _wire_client(monkeypatch, [_doc({"kind": "PodList", "items": []})])

        _status, body = client.request("GET", "/api/v1/pods", None, raw=False)

        assert body == {"kind": "PodList", "items": []}

    def test_a_raw_chunked_body_returns_the_exact_bytes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        client, _wire = _wire_client(monkeypatch, [_chunked(payload, 512)])

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None, raw=True)

        assert body == payload

    def test_an_empty_body_is_an_empty_mapping_when_parsed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_sized(b"", 204)])

        status, body = client.request("DELETE", "/api/v1/namespaces/apps/pods/web-1", None)

        assert status == 204
        assert body == {}

    def test_an_empty_body_is_empty_bytes_when_raw(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, _wire = _wire_client(monkeypatch, [_sized(b"", 204)])

        _status, body = client.request(
            "DELETE", "/api/v1/namespaces/apps/pods/web-1", None, raw=True
        )

        assert body == b""


class TestChunkedResponses:
    """Transfer-Encoding: chunked - the framing every real list response arrives in."""

    def test_a_chunked_response_without_content_length_decodes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps({"kind": "PodList", "items": []}).encode()
        framed = _chunked(payload, 4096)
        assert b"Content-Length" not in framed
        client, _wire = _wire_client(monkeypatch, [framed])

        status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert (status, body) == (200, {"kind": "PodList", "items": []})

    def test_a_large_multi_chunk_body_decodes_to_the_exact_payload(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        assert len(payload) > 2048
        client, _wire = _wire_client(monkeypatch, [_chunked(payload, 512)])

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == _BIG_POD_LIST

    def test_chunk_sizes_are_read_as_hex(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = b"".join(f"line-{index:04d}\n".encode() for index in range(80))
        framed = _chunked(payload, 512)
        assert b"\r\n200\r\n" in framed
        assert b"\r\n120\r\n" in framed
        client, _wire = _wire_client(monkeypatch, [framed])

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None, raw=True)

        assert body == payload

    def test_a_chunk_extension_is_ignored(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        client, _wire = _wire_client(monkeypatch, [_chunked(payload, 512, ";wave=1")])

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == _BIG_POD_LIST

    def test_bytes_after_the_terminating_chunk_are_not_part_of_the_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps({"kind": "PodList", "items": []}).encode()
        trailing = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}"
        client, _wire = _wire_client(monkeypatch, [_chunked(payload, 4096) + trailing])

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == {"kind": "PodList", "items": []}

    def test_a_chunked_body_split_across_socket_reads_decodes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        framed = _chunked(json.dumps(_BIG_POD_LIST).encode(), 512)
        reads = _split(framed, [1, 9, 71, 517, 1303, 2600])
        assert len(reads) > 5
        client, _wire = _wire_client(monkeypatch, reads)

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == _BIG_POD_LIST

    def test_an_empty_chunked_body_parses_to_an_empty_mapping(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_chunked(b"", 512, status=204)])

        status, body = client.request("DELETE", "/api/v1/namespaces/apps/pods/web-1", None)

        assert status == 204
        assert body == {}

    def test_a_lowercase_transfer_encoding_header_name_is_honored(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        framed = _response(
            _chunks(payload, 512),
            ["content-type: application/json", "transfer-encoding: chunked"],
        )
        client, _wire = _wire_client(monkeypatch, [framed])

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == _BIG_POD_LIST

    def test_content_length_responses_are_unchanged(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        client, _wire = _wire_client(monkeypatch, [_sized(payload)])

        status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None, raw=True)

        assert status == 200
        assert body == payload

    def test_a_content_length_body_split_across_socket_reads_is_read_to_completion(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        reads = _split(_sized(payload), [1, 9, 71, 517, 1303, 2600])
        assert len(reads) > 5
        client, _wire = _wire_client(monkeypatch, reads)

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == _BIG_POD_LIST

    def test_an_uppercase_content_length_header_name_is_honored(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps({"kind": "PodList", "items": []}).encode()
        framed = _response(
            payload,
            ["CONTENT-TYPE: application/json", f"CONTENT-LENGTH: {len(payload)}"],
        )
        client, _wire = _wire_client(monkeypatch, [framed])

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == {"kind": "PodList", "items": []}

    def test_a_body_with_neither_framing_header_is_read_to_eof(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        client, _wire = _wire_client(
            monkeypatch, [_response(payload, ["Content-Type: application/json"])]
        )

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == _BIG_POD_LIST


_WARNING_DEPRECATED = '299 - "apps/v1beta1 Deployment is deprecated"'
_WARNING_UNKNOWN_FIELD = r'299 - "unknown field \"spec.foo\""'
_WARNING_NAMED_AGENT = '299 kube-apiserver "would violate PodSecurity restricted:latest"'
_WARNING_MALFORMED = "the cluster has something to say"


def _warned(payload: bytes, warnings: list[str], status: int = 200) -> bytes:
    """A framed response carrying the given Warning header values, in order."""
    headers = [f"Warning: {value}" for value in warnings]
    headers += ["Content-Type: application/json", f"Content-Length: {len(payload)}"]
    return _response(payload, headers, status)


class TestClusterWarnings:
    """Warning headers the cluster sends back, surfaced on the client."""

    def test_a_fresh_client_reports_no_warnings(self) -> None:
        assert _client(_FAKE_SERVER).last_warnings == []

    def test_a_response_without_a_warning_header_leaves_the_list_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_doc({"kind": "ConfigMap"})])

        client.request("POST", "/api/v1/namespaces/apps/configmaps", {"kind": "ConfigMap"})

        assert client.last_warnings == []

    def test_a_warning_header_keeps_only_the_quoted_text(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_warned(b"{}", [_WARNING_DEPRECATED])])

        client.request("PATCH", "/apis/apps/v1/namespaces/apps/deployments/web", {"kind": "D"})

        assert client.last_warnings == ["apps/v1beta1 Deployment is deprecated"]

    def test_escaped_quotes_inside_the_warning_text_are_unescaped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_warned(b"{}", [_WARNING_UNKNOWN_FIELD])])

        client.request("PATCH", "/apis/apps/v1/namespaces/apps/deployments/web", {"kind": "D"})

        assert client.last_warnings == ['unknown field "spec.foo"']

    def test_a_named_warn_agent_is_stripped_with_the_warn_code(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_warned(b"{}", [_WARNING_NAMED_AGENT])])

        client.request("POST", "/api/v1/namespaces/apps/pods", {"kind": "Pod"})

        assert client.last_warnings == ["would violate PodSecurity restricted:latest"]

    def test_several_warning_headers_are_kept_in_the_order_received(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        warnings = [_WARNING_DEPRECATED, _WARNING_UNKNOWN_FIELD, _WARNING_NAMED_AGENT]
        client, _wire = _wire_client(monkeypatch, [_warned(b"{}", warnings)])

        client.request("PATCH", "/apis/apps/v1/namespaces/apps/deployments/web", {"kind": "D"})

        assert client.last_warnings == [
            "apps/v1beta1 Deployment is deprecated",
            'unknown field "spec.foo"',
            "would violate PodSecurity restricted:latest",
        ]

    def test_a_warning_header_outside_the_standard_form_is_stored_verbatim(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_warned(b"{}", [_WARNING_MALFORMED])])

        client.request("POST", "/api/v1/namespaces/apps/configmaps", {"kind": "ConfigMap"})

        assert client.last_warnings == [_WARNING_MALFORMED]

    def test_the_warning_list_is_reset_at_the_start_of_every_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        reads = [_warned(b"{}", [_WARNING_DEPRECATED]), _doc({"kind": "ConfigMap"})]
        client, _wire = _wire_client(monkeypatch, reads)

        client.request("PATCH", "/apis/apps/v1/namespaces/apps/deployments/web", {"kind": "D"})
        assert client.last_warnings == ["apps/v1beta1 Deployment is deprecated"]

        client.request("GET", "/api/v1/namespaces/apps/configmaps/app-config", None)

        assert client.last_warnings == []

    def test_a_second_warned_request_reports_only_its_own_warnings(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        reads = [
            _warned(b"{}", [_WARNING_DEPRECATED]),
            _warned(b"{}", [_WARNING_NAMED_AGENT]),
        ]
        client, _wire = _wire_client(monkeypatch, reads)

        client.request("PATCH", "/apis/apps/v1/namespaces/apps/deployments/web", {"kind": "D"})
        client.request("POST", "/api/v1/namespaces/apps/pods", {"kind": "Pod"})

        assert client.last_warnings == ["would violate PodSecurity restricted:latest"]

    def test_a_warning_header_name_is_matched_case_insensitively(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        framed = _response(
            b"{}",
            [
                f"WARNING: {_WARNING_DEPRECATED}",
                "Content-Type: application/json",
                "Content-Length: 2",
            ],
        )
        client, _wire = _wire_client(monkeypatch, [framed])

        client.request("POST", "/api/v1/namespaces/apps/configmaps", {"kind": "ConfigMap"})

        assert client.last_warnings == ["apps/v1beta1 Deployment is deprecated"]

    def test_a_warning_on_an_error_status_is_still_recorded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps({"kind": "Status", "message": "denied"}).encode()
        client, _wire = _wire_client(monkeypatch, [_warned(payload, [_WARNING_DEPRECATED], 403)])

        status, body = client.request("POST", "/api/v1/namespaces/apps/pods", {"kind": "Pod"})

        assert status == 403
        assert body == {"kind": "Status", "message": "denied"}
        assert client.last_warnings == ["apps/v1beta1 Deployment is deprecated"]

    def test_every_other_response_header_is_still_ignored(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps({"kind": "ConfigMap"}).encode()
        framed = _response(
            payload,
            [
                "Date: Wed, 27 Aug 2026 09:14:02 GMT",
                "Location: /api/v1/namespaces/apps/configmaps/app-config",
                "ETag: W/'914233'",
                "Audit-Id: 6d0f",
                "Content-Type: application/json",
                f"Content-Length: {len(payload)}",
            ],
        )
        client, _wire = _wire_client(monkeypatch, [framed])

        result = client.request("POST", "/api/v1/namespaces/apps/configmaps", {"kind": "ConfigMap"})

        assert result == (200, {"kind": "ConfigMap"})
        assert client.last_warnings == []

    def test_content_length_framing_is_unchanged_by_a_warning_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        client, _wire = _wire_client(monkeypatch, [_warned(payload, [_WARNING_DEPRECATED])])

        status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert status == 200
        assert body == _BIG_POD_LIST
        assert client.last_warnings == ["apps/v1beta1 Deployment is deprecated"]

    def test_a_chunked_response_with_a_warning_header_still_decodes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = json.dumps(_BIG_POD_LIST).encode()
        framed = _response(
            _chunks(payload, 512),
            [
                f"Warning: {_WARNING_DEPRECATED}",
                "Content-Type: application/json",
                "Transfer-Encoding: chunked",
            ],
        )
        client, _wire = _wire_client(monkeypatch, [framed])

        _status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert body == _BIG_POD_LIST
        assert client.last_warnings == ["apps/v1beta1 Deployment is deprecated"]

    def test_a_raw_read_still_records_the_warning(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, _wire = _wire_client(monkeypatch, [_warned(_LOG_TEXT, [_WARNING_DEPRECATED])])

        _status, body = client.request(
            "GET", "/api/v1/namespaces/apps/pods/web-1/log", None, raw=True
        )

        assert body == _LOG_TEXT
        assert client.last_warnings == ["apps/v1beta1 Deployment is deprecated"]


_DENIED_BODIES: dict[int, dict[str, Any]] = {
    401: {"kind": "Status", "reason": "Unauthorized", "message": "Unauthorized", "code": 401},
    403: {
        "kind": "Status",
        "reason": "Forbidden",
        "message": 'forbidden: User "wave" cannot get path "/api/v1"',
        "code": 403,
    },
}

_UNSERVED_STATUS: dict[str, Any] = {
    "kind": "Status",
    "reason": "ServiceUnavailable",
    "message": "the server is currently unable to handle the request",
}


def _status_doc(status: int, body: dict[str, Any]) -> bytes:
    return _sized(json.dumps(body).encode(), status)


class TestDiscoveryDenied:
    """A 401 or 403 discovery document is the credential's fault, never a kind miss."""

    @pytest.mark.parametrize("status", [401, 403])
    def test_a_denied_document_raises_with_its_status_and_body(
        self, monkeypatch: pytest.MonkeyPatch, status: int
    ) -> None:
        from wavecore.connectivity.k8s.rest import K8sDiscoveryDenied

        client, _wire = _wire_client(monkeypatch, [_status_doc(status, _DENIED_BODIES[status])])

        with pytest.raises(K8sDiscoveryDenied) as raised:
            client.discover("Pod")

        assert raised.value.status == status
        assert raised.value.body == _DENIED_BODIES[status]

    @pytest.mark.parametrize("status", [401, 403])
    def test_a_denied_document_is_not_cached(
        self, monkeypatch: pytest.MonkeyPatch, status: int
    ) -> None:
        from wavecore.connectivity.k8s.rest import K8sDiscoveryDenied

        reads = [_status_doc(status, _DENIED_BODIES[status]), _doc(_CORE_V1)]
        client, wire = _wire_client(monkeypatch, reads)

        with pytest.raises(K8sDiscoveryDenied):
            client.discover("Pod")
        found = client.discover("Pod")

        assert found is not None
        assert found.name == "pods"
        assert _request_lines(wire) == ["GET /api/v1 HTTP/1.1", "GET /api/v1 HTTP/1.1"]

    def test_a_denied_group_document_stops_the_walk(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from wavecore.connectivity.k8s.rest import K8sDiscoveryDenied

        reads = [_doc(_CORE_V1), _doc(_API_GROUPS), _status_doc(403, _DENIED_BODIES[403])]
        client, wire = _wire_client(monkeypatch, reads)

        with pytest.raises(K8sDiscoveryDenied) as raised:
            client.discover("Deployment")

        assert raised.value.status == 403
        assert _request_lines(wire) == [
            "GET /api/v1 HTTP/1.1",
            "GET /apis HTTP/1.1",
            "GET /apis/batch/v1 HTTP/1.1",
        ]

    def test_a_denied_document_is_not_a_k8s_api_error(self) -> None:
        from wavecore.connectivity.k8s.rest import K8sApiError, K8sDiscoveryDenied

        denied = K8sDiscoveryDenied(401, _DENIED_BODIES[401])

        assert not isinstance(denied, K8sApiError)
        assert str(denied) == "Kubernetes API discovery denied (401)"


class TestDiscoveryUnservedDocuments:
    """A 404 or 5xx document counts as empty: the walk continues and a miss is still a miss."""

    @pytest.mark.parametrize("status", [404, 503])
    def test_a_failed_group_document_is_skipped_and_the_walk_continues(
        self, monkeypatch: pytest.MonkeyPatch, status: int
    ) -> None:
        reads = [
            _doc(_CORE_V1),
            _doc(_API_GROUPS),
            _status_doc(status, _UNSERVED_STATUS),
            _doc(_APPS_V1),
        ]
        client, wire = _wire_client(monkeypatch, reads)

        found = client.discover("Deployment")

        assert found is not None
        assert found.path_root == "/apis/apps/v1"
        assert _request_lines(wire) == [
            "GET /api/v1 HTTP/1.1",
            "GET /apis HTTP/1.1",
            "GET /apis/batch/v1 HTTP/1.1",
            "GET /apis/apps/v1 HTTP/1.1",
        ]

    @pytest.mark.parametrize("status", [404, 503])
    def test_a_genuine_miss_after_a_failed_group_document_returns_none(
        self, monkeypatch: pytest.MonkeyPatch, status: int
    ) -> None:
        reads = [
            _doc(_CORE_V1),
            _doc(_API_GROUPS),
            _status_doc(status, _UNSERVED_STATUS),
            _doc(_APPS_V1),
        ]
        client, wire = _wire_client(monkeypatch, reads)

        found = client.discover("Widget")

        assert found is None
        assert len(wire.writes) == 4

    @pytest.mark.parametrize("status", [404, 503])
    def test_a_failed_document_is_fetched_once_per_client(
        self, monkeypatch: pytest.MonkeyPatch, status: int
    ) -> None:
        reads = [
            _doc(_CORE_V1),
            _doc(_API_GROUPS),
            _status_doc(status, _UNSERVED_STATUS),
            _doc(_APPS_V1),
        ]
        client, wire = _wire_client(monkeypatch, reads)

        client.discover("Deployment")
        found = client.discover("Job")

        assert found is None
        assert len(wire.writes) == 4

    @pytest.mark.parametrize("status", [404, 503])
    def test_an_explicit_api_version_whose_document_fails_is_a_miss(
        self, monkeypatch: pytest.MonkeyPatch, status: int
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_status_doc(status, _UNSERVED_STATUS)])

        found = client.discover("Widget", "example.com/v1")

        assert found is None
        assert _request_lines(wire) == ["GET /apis/example.com/v1 HTTP/1.1"]


class TestDiscoveryPathEncoding:
    """An explicit API version is percent-encoded into the discovery path, slashes kept."""

    def test_an_api_version_with_a_space_and_a_question_mark_is_percent_encoded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_APPS_V1)])

        found = client.discover("Deployment", "my group?.example.com/v1")

        assert found is not None
        assert _request_lines(wire) == ["GET /apis/my%20group%3F.example.com/v1 HTTP/1.1"]

    def test_a_404_on_the_encoded_path_is_still_a_miss(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_status_doc(404, _UNSERVED_STATUS)])

        found = client.discover("Widget", "my group?.example.com/v1")

        assert found is None
        assert _request_lines(wire) == ["GET /apis/my%20group%3F.example.com/v1 HTTP/1.1"]

    def test_a_plain_group_version_is_unchanged(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, wire = _wire_client(monkeypatch, [_doc(_APPS_V1)])

        client.discover("Deployment", "apps/v1")

        assert _request_lines(wire) == ["GET /apis/apps/v1 HTTP/1.1"]


_TRUNCATED_MESSAGE = "Kubernetes API response ended before the body was complete"


class TestTruncatedResponses:
    """A connection that drops mid-body is a K8s API error, never a framing crash."""

    def test_a_chunked_stream_that_ends_before_the_terminating_chunk_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.connectivity.k8s.rest import K8sApiError

        framed = _chunked(json.dumps(_BIG_POD_LIST).encode(), 512)
        assert framed.endswith(b"\r\n0\r\n\r\n")
        client, _wire = _wire_client(monkeypatch, [framed[: -len(b"0\r\n\r\n")]])

        with pytest.raises(K8sApiError, match=_exact(_TRUNCATED_MESSAGE)):
            client.request("GET", "/api/v1/namespaces/apps/pods", None)

    def test_a_chunk_cut_short_by_the_connection_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.connectivity.k8s.rest import K8sApiError

        body = _chunks(json.dumps(_BIG_POD_LIST).encode(), 512)
        assert body.startswith(b"200\r\n")
        framed = _response(
            body[:300],
            ["Content-Type: application/json", "Transfer-Encoding: chunked"],
        )
        client, _wire = _wire_client(monkeypatch, [framed])

        with pytest.raises(K8sApiError, match=_exact(_TRUNCATED_MESSAGE)):
            client.request("GET", "/api/v1/namespaces/apps/pods", None)

    def test_a_content_length_body_cut_short_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from wavecore.connectivity.k8s.rest import K8sApiError

        framed = _sized(json.dumps(_BIG_POD_LIST).encode())
        client, _wire = _wire_client(monkeypatch, [framed[:-10]])

        with pytest.raises(K8sApiError, match=_exact(_TRUNCATED_MESSAGE)):
            client.request("GET", "/api/v1/namespaces/apps/pods", None)

    def test_a_truncated_raw_read_raises_the_same_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.connectivity.k8s.rest import K8sApiError

        framed = _sized(_LOG_TEXT)
        client, _wire = _wire_client(monkeypatch, [framed[:-5]])

        with pytest.raises(K8sApiError, match=_exact(_TRUNCATED_MESSAGE)):
            client.request("GET", "/api/v1/namespaces/apps/pods/web-1/log", None, raw=True)

    def test_the_socket_is_closed_after_a_truncated_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.connectivity.k8s.rest import K8sApiError

        framed = _sized(json.dumps(_BIG_POD_LIST).encode())
        client, wire = _wire_client(monkeypatch, [framed[:-10]])

        with pytest.raises(K8sApiError):
            client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert wire.sock.closed is True


class TestUnreadableBodies:
    """A body that is not a JSON object: an empty Status on an error, a clear failure otherwise."""

    @pytest.mark.parametrize(
        "payload", [*_UNREADABLE_ERROR_BODIES, b""], ids=[*_UNREADABLE_IDS, "empty"]
    )
    def test_an_unreadable_error_body_becomes_an_empty_status(
        self, monkeypatch: pytest.MonkeyPatch, payload: bytes
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_sized(payload, 502)])

        status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert (status, body) == (502, {})

    def test_a_proxy_error_page_sent_as_html_becomes_an_empty_status(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        headers = ["Content-Type: text/html", f"Content-Length: {len(_HTML_ERROR_PAGE)}"]
        client, _wire = _wire_client(monkeypatch, [_response(_HTML_ERROR_PAGE, headers, 504)])

        status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert (status, body) == (504, {})

    def test_a_chunked_unreadable_error_body_becomes_an_empty_status(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_chunked(_HTML_ERROR_PAGE, 32, status=503)])

        status, body = client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert (status, body) == (503, {})

    @pytest.mark.parametrize(
        "payload", [*_UNREADABLE_ERROR_BODIES, b"null"], ids=[*_UNREADABLE_IDS, "json-null"]
    )
    def test_an_unreadable_success_body_raises_the_unreadable_message(
        self, monkeypatch: pytest.MonkeyPatch, payload: bytes
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_sized(payload, 200)])

        with pytest.raises(K8sApiError, match=_exact(_UNREADABLE_MESSAGE)):
            client.request("GET", "/api/v1/namespaces/apps/pods", None)

    def test_an_unreadable_success_body_still_closes_the_socket(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(monkeypatch, [_sized(_HTML_ERROR_PAGE)])

        with pytest.raises(K8sApiError):
            client.request("GET", "/api/v1/namespaces/apps/pods", None)

        assert wire.sock.closed is True

    @pytest.mark.parametrize("status", [200, 502])
    def test_a_raw_read_hands_back_an_unreadable_body_unparsed(
        self, monkeypatch: pytest.MonkeyPatch, status: int
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_sized(_HTML_ERROR_PAGE, status)])

        got_status, body = client.request(
            "GET", "/api/v1/namespaces/apps/pods/web-1/log", None, raw=True
        )

        assert (got_status, body) == (status, _HTML_ERROR_PAGE)

    def test_an_unreadable_discovery_document_fails_the_lookup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _wire = _wire_client(monkeypatch, [_sized(_HTML_ERROR_PAGE)])

        with pytest.raises(K8sApiError, match=_exact(_UNREADABLE_MESSAGE)):
            client.discover("Pod")

    def test_an_unreadable_group_document_at_an_error_status_is_skipped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        reads = [
            _doc(_CORE_V1),
            _doc(_API_GROUPS),
            _sized(_HTML_ERROR_PAGE, 502),
            _doc(_APPS_V1),
        ]
        client, wire = _wire_client(monkeypatch, reads)

        found = client.discover("Deployment")

        assert found is not None
        assert found.path_root == "/apis/apps/v1"
        assert len(wire.writes) == 4


class TestHostHeaderLogin:
    """A login written in the server address stays out of the Host header."""

    def test_the_host_header_carries_the_host_and_port_only(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, wire = _wire_client(
            monkeypatch, [_sized(b"{}")], server="https://wave:pw@k8s.example:6443"
        )

        client.request("GET", "/version", None)

        assert _sent(wire)[1]["host"] == "k8s.example:6443"


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
        client, wire = _wire_client(monkeypatch, [_sized(b"{}")], server=server)

        client.request("GET", "/version", None)

        assert _sent(wire)[1]["host"] == host


_PORT_ZERO = "https://k8s.example:0"
_PORT_ABOVE_THE_RANGE = "https://k8s.example:99999"


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
    """A server address with a bad port, no host or no http or https scheme builds no client."""

    @pytest.mark.parametrize(
        "server",
        [_PORT_ZERO, "http://k8s.example:0", _PORT_ABOVE_THE_RANGE],
        ids=["zero", "zero-plain-http", "far-above"],
    )
    def test_a_port_outside_1_to_65535_is_refused(self, server: str, dials: list[Any]) -> None:
        with pytest.raises(ValueError):
            _client(server)

        assert dials == []

    def test_port_zero_fails_the_way_a_port_above_the_range_does(self) -> None:
        with pytest.raises(ValueError) as zero:
            _client(_PORT_ZERO)
        with pytest.raises(ValueError) as above:
            _client(_PORT_ABOVE_THE_RANGE)

        assert type(zero.value) is type(above.value)

    @pytest.mark.parametrize(
        "server",
        ["https://:6443", "https://wave@", "https://"],
        ids=["port-without-host", "login-without-host", "scheme-only"],
    )
    def test_an_address_with_no_host_is_refused(self, server: str, dials: list[Any]) -> None:
        with pytest.raises(ValueError):
            _client(server)

        assert dials == []

    @pytest.mark.parametrize(
        "server", ["ftp://k8s.example", "k8s.example:6443"], ids=["another-scheme", "no-scheme"]
    )
    def test_an_address_that_is_not_http_or_https_is_refused(
        self, server: str, dials: list[Any]
    ) -> None:
        with pytest.raises(ValueError):
            _client(server)

        assert dials == []

    @pytest.mark.parametrize(
        "server", ["ftp://k8s.example", "k8s.example:6443", ""], ids=["another", "none", "blank"]
    )
    def test_a_wrong_or_missing_scheme_says_how_the_address_must_start(
        self, server: str, dials: list[Any]
    ) -> None:
        with pytest.raises(
            ValueError, match=r"^Kubernetes API address must start with http:// or https://$"
        ) as refused:
            _client(server)

        assert type(refused.value) is ValueError
        assert dials == []

    @pytest.mark.parametrize(
        "server",
        ["https://:6443", "https://wave:s3cret@", "https://", "https://[::1"],
        ids=["port-without-host", "login-without-host", "scheme-only", "open-bracket"],
    )
    def test_an_address_with_no_host_says_it_needs_one(self, server: str, dials: list[Any]) -> None:
        with pytest.raises(ValueError, match=r"^Kubernetes API address needs a host$") as refused:
            _client(server)

        assert type(refused.value) is ValueError
        assert dials == []

    @pytest.mark.parametrize(
        "server",
        [
            _PORT_ZERO,
            _PORT_ABOVE_THE_RANGE,
            "https://k8s.example:abc",
            "https://wave:s3cret@k8s.example:65536",
        ],
        ids=["zero", "far-above", "not-a-number", "with-a-login"],
    )
    def test_a_bad_port_names_the_range_and_never_the_address(
        self, server: str, dials: list[Any]
    ) -> None:
        with pytest.raises(
            ValueError, match=r"^Kubernetes API address port must be between 1 and 65535$"
        ) as refused:
            _client(server)

        assert type(refused.value) is ValueError
        assert dials == []


_PROXY_LOGIN = ("wave", "s3cret")
_PROXY_LOGIN_HEADER = "Basic d2F2ZTpzM2NyZXQ="
_PROXY_VARIABLES = ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")
_UNUSABLE_HOST_VALUE = (
    "This WAVE host's proxy address socks5://proxy.example:1080 is not an http:// address: "
    "choose Custom or turn the proxy off"
)

Asked = list[tuple[str, str, int]]
Lines = list[tuple[str, str]]


def _quick_server(material: TLSMaterial | None = None) -> RecordingHTTPServer:
    """A started recording server, https with the material's leaf; its shutdown returns at once."""
    server = RecordingHTTPServer(("127.0.0.1", 0))
    scheme = "http"
    if material is not None:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(material.server_cert_path, material.server_key_path)
        listening: Any = context.wrap_socket(server.socket, server_side=True)
        server.socket = listening
        scheme = "https"
    serving = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
    )
    serving.start()
    server.base_url = f"{scheme}://127.0.0.1:{server.server_address[1]}"
    return server


@pytest.fixture
def plain_cluster() -> Generator[RecordingHTTPServer, None, None]:
    server = _quick_server()
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def tls_cluster(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    server = _quick_server(tls_material)
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def run_lines() -> Generator[Lines, None, None]:
    """One block run: its log sink is active for the test and removed after."""
    lines: Lines = []
    token = RUN_LOG.set(RunLog(lambda level, message: lines.append((level, message))))
    yield lines
    RUN_LOG.reset(token)


def _port(server: RecordingHTTPServer) -> int:
    return int(server.server_address[1])


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
    """With a route the request rides a CONNECT tunnel the proxy opens to the server."""

    def test_an_https_request_goes_through_a_tunnel_to_the_server(
        self, tls_cluster: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_cluster, {"gitVersion": "v1.33.0"})
        with Proxy() as for_https, Proxy() as for_http:
            _proxy_in_force(https=for_https.port, http=for_http.port)

            answer = _client(tls_cluster.base_url, tls_material).request("GET", "/version", None)

            assert answer == (200, {"gitVersion": "v1.33.0"})
            assert _tunnels(for_https) == [("CONNECT", f"127.0.0.1:{_port(tls_cluster)}")]
            assert for_http.untouched
        assert tls_cluster.requests[0]["path"] == "/version"

    def test_a_plain_http_request_is_tunneled_through_the_http_endpoint(
        self, plain_cluster: RecordingHTTPServer
    ) -> None:
        _enqueue_json(plain_cluster, {"gitVersion": "v1.33.0"})
        with Proxy() as for_https, Proxy() as for_http:
            _proxy_in_force(https=for_https.port, http=for_http.port)

            answer = _client(plain_cluster.base_url).request("GET", "/version", None)

            assert answer == (200, {"gitVersion": "v1.33.0"})
            assert _tunnels(for_http) == [("CONNECT", f"127.0.0.1:{_port(plain_cluster)}")]
            assert for_https.untouched
        assert plain_cluster.requests[0]["path"] == "/version"

    def test_an_address_without_a_port_is_tunneled_to_the_default_port(
        self, tls_cluster: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_cluster, {"ok": True})
        with Proxy(upstream=("127.0.0.1", _port(tls_cluster))) as server:
            asked = _proxy_in_force(https=server.port)

            status, _ = _client("https://localhost", tls_material).request("GET", "/version", None)

            assert status == 200
            assert _tunnels(server) == [("CONNECT", "localhost:443")]
            assert set(asked) == {("https", "localhost", 443)}

    @pytest.mark.parametrize(
        ("fixture", "scheme"), [("tls_cluster", "https"), ("plain_cluster", "http")]
    )
    def test_the_route_decision_is_asked_about_the_servers_address(
        self,
        fixture: str,
        scheme: str,
        request: pytest.FixtureRequest,
        tls_material: TLSMaterial,
    ) -> None:
        cluster: RecordingHTTPServer = request.getfixturevalue(fixture)
        _enqueue_json(cluster, {"ok": True})
        with Proxy() as server:
            asked = _proxy_in_force(https=server.port, http=server.port)

            _client(cluster.base_url, tls_material).request("GET", "/version", None)

        assert set(asked) == {(scheme, "127.0.0.1", _port(cluster))}

    def test_a_proxy_login_rides_the_connect_request(
        self, tls_cluster: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_cluster, {"ok": True})
        with Proxy(login=_PROXY_LOGIN) as server:
            _proxy_in_force(https=server.port, login=_PROXY_LOGIN)

            status, _ = _client(tls_cluster.base_url, tls_material).request("GET", "/version", None)

            assert status == 200
            assert server.requests[0].headers["proxy-authorization"] == _PROXY_LOGIN_HEADER
        assert "proxy-authorization" not in tls_cluster.requests[0]["headers"]

    def test_a_proxy_without_a_username_gets_no_login(
        self, tls_cluster: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _enqueue_json(tls_cluster, {"ok": True})
        with Proxy() as server:
            _proxy_in_force(https=server.port)

            _client(tls_cluster.base_url, tls_material).request("GET", "/version", None)

            assert "proxy-authorization" not in server.requests[0].headers

    def test_the_servers_name_is_still_verified_through_the_tunnel(
        self, tls_cluster: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        message = (
            "Could not verify the TLS certificate of https://k8s.example:6443: "
            'Certificate verification failed: hostname "k8s.example" does not match '
            "the server certificate"
        )
        with Proxy(upstream=("127.0.0.1", _port(tls_cluster))) as server:
            _proxy_in_force(https=server.port)
            client = _client("https://k8s.example:6443", tls_material)

            with pytest.raises(K8sApiError, match=_exact(message)):
                client.request("GET", "/version", None)

            assert _tunnels(server) == [("CONNECT", "k8s.example:6443")]
        assert tls_cluster.requests == []


class TestDirectRoute:
    """A direct decision, or no proxy in force, never touches the proxy."""

    @pytest.mark.parametrize("fixture", ["tls_cluster", "plain_cluster"])
    def test_a_direct_decision_connects_to_the_server_itself(
        self, fixture: str, request: pytest.FixtureRequest, tls_material: TLSMaterial
    ) -> None:
        cluster: RecordingHTTPServer = request.getfixturevalue(fixture)
        _enqueue_json(cluster, {"ok": True})
        with Proxy() as server:
            _proxy_in_force(https=server.port, http=server.port, through=False)

            status, _ = _client(cluster.base_url, tls_material).request("GET", "/version", None)

            assert status == 200
            assert server.untouched

    @pytest.mark.parametrize("fixture", ["tls_cluster", "plain_cluster"])
    def test_without_a_proxy_in_force_the_wave_hosts_proxy_variables_are_not_used(
        self,
        fixture: str,
        request: pytest.FixtureRequest,
        tls_material: TLSMaterial,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        cluster: RecordingHTTPServer = request.getfixturevalue(fixture)
        _enqueue_json(cluster, {"ok": True})
        with Proxy() as server:
            for name in _PROXY_VARIABLES:
                monkeypatch.setenv(name, server.url)

            status, _ = _client(cluster.base_url, tls_material).request("GET", "/version", None)

            assert status == 200
            assert server.untouched


class TestProxyLogLine:
    """A block run names the proxy it used once, however many requests it made."""

    def test_two_requests_of_one_run_write_the_line_once(
        self, tls_cluster: RecordingHTTPServer, tls_material: TLSMaterial, run_lines: Lines
    ) -> None:
        _enqueue_json(tls_cluster, {"ok": True})
        _enqueue_json(tls_cluster, {"ok": True})
        with Proxy() as server:
            _proxy_in_force(https=server.port)
            client = _client(tls_cluster.base_url, tls_material)

            client.request("GET", "/version", None)
            client.request("GET", "/api", None)

            assert [asked.method for asked in server.requests] == ["CONNECT", "CONNECT"]
        assert run_lines == [("DEBUG", f"Using the proxy 127.0.0.1:{server.port}")]

    def test_a_direct_connection_writes_no_line(
        self, tls_cluster: RecordingHTTPServer, tls_material: TLSMaterial, run_lines: Lines
    ) -> None:
        _enqueue_json(tls_cluster, {"ok": True})
        with Proxy() as server:
            _proxy_in_force(https=server.port, through=False)

            _client(tls_cluster.base_url, tls_material).request("GET", "/version", None)

        assert run_lines == []


class TestProxyFailures:
    """A proxy failure reads as an unreachable server, carrying the proxy's own text."""

    def test_a_refused_tunnel_names_the_proxy_answer(self, tls_material: TLSMaterial) -> None:
        target = closed_port()
        api_url = f"https://127.0.0.1:{target}"
        with Proxy(refuse=(403, "Forbidden")) as server:
            _proxy_in_force(https=server.port)
            message = (
                f"Could not connect to the Kubernetes API at {api_url}: "
                f"Proxy 127.0.0.1:{server.port} refused the connection to "
                f"127.0.0.1:{target}: 403 Forbidden"
            )

            with pytest.raises(K8sApiError, match=_exact(message)):
                _client(api_url, tls_material).request("GET", "/version", None)

    def test_a_proxy_that_cannot_be_reached_is_named(self, tls_material: TLSMaterial) -> None:
        api_url = f"https://127.0.0.1:{closed_port()}"
        dead = closed_port()
        _proxy_in_force(https=dead)
        prefix = re.escape(f"Could not connect to the Kubernetes API at {api_url}: ")

        with pytest.raises(
            K8sApiError, match=rf"^{prefix}Proxy 127\.0\.0\.1:{dead} cannot be reached: .+$"
        ):
            _client(api_url, tls_material).request("GET", "/version", None)

    def test_a_wave_host_value_wave_cannot_use_keeps_its_own_text(
        self, tls_cluster: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _proxy_in_force(decision_error=_UNUSABLE_HOST_VALUE)
        message = (
            f"Could not connect to the Kubernetes API at {tls_cluster.base_url}: "
            f"{_UNUSABLE_HOST_VALUE}"
        )

        with pytest.raises(K8sApiError, match=_exact(message)):
            _client(tls_cluster.base_url, tls_material).request("GET", "/version", None)

        assert tls_cluster.requests == []
