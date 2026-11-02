"""The OpenSearch REST transport on loopback scripted answers (REQ-5.1.2, OS-11).

One `http.client` connection per request, closed afterwards; no retries; TLS through the
promoted context under the far host's name; each live socket handed to the held cancel,
which shuts it down so a blocked read wakes at once. With a proxy route in force each
connection is a CONNECT tunnel the proxy opens to the cluster, and a proxy failure reads as
an unreachable cluster (REQ-4.7.14).
"""

import importlib
import json
import re
import socket
import ssl
import threading
import time
from collections.abc import Generator
from decimal import Decimal
from typing import Any

import pytest

from tests.connectivity._proxy_servers import Proxy, closed_port
from tests.connectivity.opensearch.fakes import (
    closing_server,
    enqueue_json,
    enqueue_text,
    error_answer,
    port_of,
    record_sni,
    search_answer,
    sent,
    serve,
    silent_listener,
    stop,
)
from tests.plugins.http.conftest import RecordingHTTPServer, TLSMaterial
from wavecore.connectivity.opensearch import _rest
from wavecore.connectivity.opensearch._errors import (
    OpenSearchFailure,
    connect_timeout,
    timeout_message,
)
from wavecore.connectivity.opensearch._rest import Answer, Client
from wavecore.connectivity.opensearch._url import index_path, parse_cluster_url
from wavecore.connectivity.run_log import RUN_LOG, RunLog
from wavecore.plugins._held_run import Live, Stopped

DEADLINE_SECONDS = 5
FIELD_CAPS_QUERY = {"fields": "*", "ignore_unavailable": "true", "allow_no_indices": "true"}


@pytest.fixture(scope="module")
def tls_material(tmp_path_factory: pytest.TempPathFactory) -> TLSMaterial:
    return TLSMaterial(tmp_path_factory.mktemp("opensearch-tls-material"))


@pytest.fixture
def os_http() -> Generator[RecordingHTTPServer, None, None]:
    server = serve()
    yield server
    stop(server)


@pytest.fixture
def os_https(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    server = serve(tls_material)
    yield server
    stop(server)


@pytest.fixture
def os_mtls(tls_material: TLSMaterial) -> Generator[RecordingHTTPServer, None, None]:
    server = serve(tls_material, require_client_cert=True)
    yield server
    stop(server)


def _timeout_failure() -> OpenSearchFailure:
    return OpenSearchFailure(timeout_message(DEADLINE_SECONDS), "Timeout")


class _SpyLive(Live):
    """The real held cancel, remembering every resource handed to it."""

    def __init__(self, cancel: Any = None) -> None:
        super().__init__(DEADLINE_SECONDS, cancel or _rest._shutdown_socket, _timeout_failure)
        self.attached: list[Any] = []

    def attach(self, resource: Any) -> None:
        self.attached.append(resource)
        super().attach(resource)


def _client(
    base_url: str,
    *,
    tls_rows: dict[str, Any] | None = None,
    connect: float = 2.0,
    live: Live | None = None,
    authorization: str | None = None,
    server_name: str | None = None,
    host_header: str | None = None,
) -> Client:
    return Client(
        parse_cluster_url(base_url),
        tls_rows or {},
        connect,
        live or _SpyLive(),
        authorization=authorization,
        server_name=server_name,
        host_header=host_header,
    )


def _trusted(material: TLSMaterial) -> dict[str, Any]:
    return {"verify_ssl": True, "ca_cert": material.ca_cert_pem}


def _free_port() -> int:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = int(probe.getsockname()[1])
    probe.close()
    return port


def _dial_instead(monkeypatch: pytest.MonkeyPatch, port: int) -> None:
    """Every connect reaches the loopback server, whatever host and port the URL names."""
    real = socket.create_connection

    def dial(_address: Any, *args: Any, **kwargs: Any) -> socket.socket:
        return real(("127.0.0.1", port), *args, **kwargs)

    monkeypatch.setattr(socket, "create_connection", dial)


def _refuse_with(monkeypatch: pytest.MonkeyPatch, error: BaseException, before: Any = None) -> None:
    def dial(*_args: Any, **_kwargs: Any) -> socket.socket:
        if before is not None:
            before()
        raise error

    monkeypatch.setattr(socket, "create_connection", dial)


def _failure(client: Client, method: str = "GET", path: str = "/_search") -> OpenSearchFailure:
    with pytest.raises(OpenSearchFailure) as caught:
        client.request(method, path)
    return caught.value


def _header_names(server: RecordingHTTPServer, index: int = 0) -> list[str]:
    return sorted(name.lower() for name, _value in server.requests[index]["raw_headers"])


class TestRequestAndAnswer:
    """POST and GET JSON; the answer is the status line, lower-cased headers and the whole body."""

    def test_a_post_sends_the_body_and_returns_the_answer(
        self, os_http: RecordingHTTPServer
    ) -> None:
        enqueue_text(os_http, '{"took":1}', headers=[("X-Opaque-Id", "abc")])

        answer = _client(os_http.base_url).request(
            "POST", "/filebeat-%2A/_search", body={"size": 10, "query": {"match_all": {}}}
        )

        assert (answer.status, answer.reason, answer.body) == (200, "OK", b'{"took":1}')
        assert answer.headers["x-opaque-id"] == "abc"
        assert answer.headers["content-type"] == "application/json"
        assert sent(os_http, 0)["method"] == "POST"
        assert sent(os_http, 0)["raw_path"] == "/filebeat-%2A/_search"
        assert os_http.requests[0]["body"] == b'{"size":10,"query":{"match_all":{}}}'

    def test_the_body_is_compact_utf8_with_exact_decimals(
        self, os_http: RecordingHTTPServer
    ) -> None:
        enqueue_json(os_http, {})
        expected = '{"query":{"match":{"msg":"héllo"}},"min_score":0.50}'.encode()

        _client(os_http.base_url).request(
            "POST",
            "/logs/_search",
            body={"query": {"match": {"msg": "héllo"}}, "min_score": Decimal("0.50")},
        )

        assert os_http.requests[0]["body"] == expected
        assert sent(os_http, 0)["headers"]["content-length"] == str(len(expected))

    def test_a_get_sends_the_query_string_and_no_body(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, {"indices": [], "fields": {}})

        _client(os_http.base_url).request(
            "GET", "/filebeat-%2A/_field_caps", query=dict(FIELD_CAPS_QUERY)
        )

        request = sent(os_http, 0)
        assert request["method"] == "GET"
        assert request["raw_path"] == (
            "/filebeat-%2A/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true"
        )
        assert request["body"] == b""
        assert "content-type" not in request["headers"]

    def test_no_query_adds_no_question_mark(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, {"indices": []})

        _client(os_http.base_url).request("GET", "/_resolve/index/logs-%2A")

        assert sent(os_http, 0)["raw_path"] == "/_resolve/index/logs-%2A"

    def test_the_gateway_prefix_leads_the_path(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, {})
        url = parse_cluster_url(f"{os_http.base_url}/os/")

        _client(f"{os_http.base_url}/os/").request(
            "POST", index_path(url.prefix, "filebeat-*", "_search"), body={"size": 0}
        )

        assert sent(os_http, 0)["raw_path"] == "/os/filebeat-%2A/_search"

    @pytest.mark.parametrize(
        ("status", "reason"), [(404, "Not Found"), (503, "Service Unavailable")]
    )
    def test_an_error_status_is_an_answer_not_an_exception(
        self, os_http: RecordingHTTPServer, status: int, reason: str
    ) -> None:
        enqueue_json(os_http, {"error": "x"}, status=status)

        answer = _client(os_http.base_url).request("GET", "/_search")

        assert (answer.status, answer.reason, answer.body) == (status, reason, b'{"error": "x"}')

    def test_the_whole_body_is_read(self, os_http: RecordingHTTPServer) -> None:
        payload = "a" * 1_000_000
        enqueue_text(os_http, payload)

        answer = _client(os_http.base_url).request("GET", "/_search")

        assert answer.body == payload.encode()

    def test_a_chunked_answer_is_read_whole(self, os_http: RecordingHTTPServer) -> None:
        os_http.enqueue(
            headers=[("Transfer-Encoding", "chunked")],
            body=b"5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n",
            content_type="application/json",
            auto_length=False,
        )

        answer = _client(os_http.base_url).request("GET", "/_search")

        assert answer.body == b"hello world"


class TestHeaders:
    """Host, Accept, User-Agent, Authorization, and Content-Type and Content-Length with a body."""

    def test_a_post_carries_exactly_the_listed_headers(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, {})

        _client(os_http.base_url, authorization="Basic d2F2ZTpvcy1zZWNyZXQ=").request(
            "POST", "/logs/_search", body={"size": 0}
        )

        headers = sent(os_http, 0)["headers"]
        assert _header_names(os_http) == sorted(
            ["host", "content-type", "accept", "user-agent", "authorization", "content-length"]
        )
        assert headers["content-type"] == "application/json"
        assert headers["accept"] == "application/json"
        assert headers["user-agent"] == "WAVE"
        assert headers["authorization"] == "Basic d2F2ZTpvcy1zZWNyZXQ="
        assert headers["content-length"] == "10"

    def test_a_get_carries_one_host_and_no_encoding_or_content_type(
        self, os_http: RecordingHTTPServer
    ) -> None:
        enqueue_json(os_http, {})

        _client(os_http.base_url).request("GET", "/logs/_field_caps")

        names = _header_names(os_http)
        assert names.count("host") == 1
        assert {"accept", "user-agent"} <= set(names)
        assert "accept-encoding" not in names
        assert "content-type" not in names

    def test_no_authorization_header_without_credentials(
        self, os_http: RecordingHTTPServer
    ) -> None:
        enqueue_json(os_http, {})

        _client(os_http.base_url).request("POST", "/logs/_search", body={"size": 0})

        assert "authorization" not in sent(os_http, 0)["headers"]

    def test_host_names_a_port_that_is_not_the_scheme_default(
        self, os_http: RecordingHTTPServer
    ) -> None:
        enqueue_json(os_http, {})

        _client(os_http.base_url).request("GET", "/_search")

        assert sent(os_http, 0)["headers"]["host"] == f"127.0.0.1:{port_of(os_http)}"

    def test_host_leaves_out_the_default_http_port(
        self, os_http: RecordingHTTPServer, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        enqueue_json(os_http, {})
        _dial_instead(monkeypatch, port_of(os_http))

        _client("http://127.0.0.1").request("GET", "/_search")

        assert sent(os_http, 0)["headers"]["host"] == "127.0.0.1"

    def test_host_leaves_out_the_default_https_port(
        self,
        os_https: RecordingHTTPServer,
        tls_material: TLSMaterial,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        enqueue_json(os_https, {})
        _dial_instead(monkeypatch, port_of(os_https))

        _client("https://localhost", tls_rows=_trusted(tls_material)).request("GET", "/_search")

        assert sent(os_https, 0)["headers"]["host"] == "localhost"

    def test_an_ipv6_host_is_bracketed(
        self, os_http: RecordingHTTPServer, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        enqueue_json(os_http, {})
        _dial_instead(monkeypatch, port_of(os_http))

        _client("http://[::1]:9200").request("GET", "/_search")

        assert sent(os_http, 0)["headers"]["host"] == "[::1]:9200"

    def test_a_tunnel_names_the_far_host_in_host(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, {})

        _client(os_http.base_url, host_header="opensearch.internal:9200").request("GET", "/_search")

        assert sent(os_http, 0)["headers"]["host"] == "opensearch.internal:9200"
        assert _header_names(os_http).count("host") == 1


class TestOneConnectionPerRequest:
    """Every request opens its own connection and closes it; nothing is retried (OS-11)."""

    def test_two_requests_use_two_connections(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, {})
        enqueue_json(os_http, {})
        live = _SpyLive()
        client = _client(os_http.base_url, live=live)

        client.request("GET", "/_search")
        client.request("GET", "/_search")

        assert os_http.requests[0]["client_port"] != os_http.requests[1]["client_port"]
        assert len(live.attached) == 2
        assert live.attached[0] is not live.attached[1]

    def test_the_socket_is_closed_after_the_answer(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, {})
        live = _SpyLive()

        _client(os_http.base_url, live=live).request("GET", "/_search")

        assert live.attached[0].fileno() == -1

    def test_the_socket_is_closed_after_a_failure(self) -> None:
        live = _SpyLive()
        with closing_server() as server:
            _failure(_client(f"http://127.0.0.1:{server.port}", live=live))

        assert live.attached[0].fileno() == -1

    def test_a_failed_answer_is_not_retried(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, error_answer("x", "y", 503), status=503)
        enqueue_json(os_http, {})

        answer = _client(os_http.base_url).request("POST", "/logs/_search", body={"size": 0})

        assert answer.status == 503
        assert len(os_http.requests) == 1

    def test_a_connection_closed_without_an_answer_is_not_retried(self) -> None:
        with closing_server() as server:
            _failure(_client(f"http://127.0.0.1:{server.port}"))

            assert server.connections == 1


class TestTls:
    """The URL scheme decides; the promoted context checks and sends the far host's name."""

    def test_the_server_is_verified_against_the_ca(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        enqueue_json(os_https, {"ok": True})

        answer = _client(os_https.base_url, tls_rows=_trusted(tls_material)).request("GET", "/")

        assert answer.status == 200

    def test_verify_off_skips_the_checks(self, os_https: RecordingHTTPServer) -> None:
        enqueue_json(os_https, {})

        answer = _client(os_https.base_url, tls_rows={"verify_ssl": False}).request("GET", "/")

        assert answer.status == 200

    def test_an_untrusted_server_is_unreachable(self, os_https: RecordingHTTPServer) -> None:
        failure = _failure(_client(os_https.base_url, tls_rows={"verify_ssl": True}))

        prefix = f"Could not connect to OpenSearch at 127.0.0.1:{port_of(os_https)}: "
        assert re.match(rf"^{re.escape(prefix)}.*CERTIFICATE_VERIFY_FAILED.*$", failure.message)
        assert failure.reason == "Unreachable"

    def test_a_client_certificate_rides_the_handshake_beside_a_header(
        self, os_mtls: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        enqueue_json(os_mtls, {})
        rows = {
            **_trusted(tls_material),
            "client_cert": tls_material.client_cert_pem,
            "client_key": tls_material.client_key_pem,
        }

        answer = _client(os_mtls.base_url, tls_rows=rows, authorization="ApiKey os_k").request(
            "GET", "/"
        )

        assert answer.status == 200
        assert sent(os_mtls, 0)["headers"]["authorization"] == "ApiKey os_k"

    def test_the_trust_rows_are_unused_on_an_http_url(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, {})
        rows = {"verify_ssl": True, "ca_cert": "no-such-ca.pem", "client_cert": "no-such.pem"}

        answer = _client(os_http.base_url, tls_rows=rows).request("GET", "/")

        assert answer.status == 200

    def test_an_ip_host_sends_no_server_name(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        enqueue_json(os_https, {})
        names = record_sni(os_https)

        _client(os_https.base_url, tls_rows=_trusted(tls_material)).request("GET", "/")

        assert names == [None]

    def test_the_far_host_is_the_server_name_and_the_checked_name(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        enqueue_json(os_https, {})
        names = record_sni(os_https)

        answer = _client(
            os_https.base_url, tls_rows=_trusted(tls_material), server_name="localhost"
        ).request("GET", "/")

        assert answer.status == 200
        assert names == ["localhost"]

    def test_a_far_host_the_certificate_does_not_name_is_unreachable(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        client = _client(
            os_https.base_url, tls_rows=_trusted(tls_material), server_name="opensearch.internal"
        )

        failure = _failure(client)

        prefix = f"Could not connect to OpenSearch at 127.0.0.1:{port_of(os_https)}: "
        assert re.match(rf"^{re.escape(prefix)}.*CERTIFICATE_VERIFY_FAILED.*$", failure.message)
        assert failure.reason == "Unreachable"

    def test_verify_off_still_sends_the_far_host_name(self, os_https: RecordingHTTPServer) -> None:
        enqueue_json(os_https, {})
        names = record_sni(os_https)

        _client(
            os_https.base_url, tls_rows={"verify_ssl": False}, server_name="opensearch.internal"
        ).request("GET", "/")

        assert names == ["opensearch.internal"]


class TestTransportFailures:
    """Connect, handshake and early-close failures map to their pinned failure texts."""

    def test_a_refused_connect_is_unreachable(self) -> None:
        port = _free_port()

        failure = _failure(_client(f"http://127.0.0.1:{port}"))

        assert failure.message == (
            f"Could not connect to OpenSearch at 127.0.0.1:{port}: [Errno 111] Connection refused"
        )
        assert failure.reason == "Unreachable"

    def test_a_dns_failure_is_unreachable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _refuse_with(monkeypatch, socket.gaierror(-2, "Name or service not known"))

        failure = _failure(_client("https://opensearch.internal:9200"))

        assert failure.message == (
            "Could not connect to OpenSearch at opensearch.internal:9200: "
            "[Errno -2] Name or service not known"
        )
        assert failure.reason == "Unreachable"

    def test_a_connect_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _refuse_with(monkeypatch, TimeoutError("timed out"))

        failure = _failure(_client("http://192.0.2.1:9200", connect=30))

        assert failure.message == (
            "Could not connect to OpenSearch at 192.0.2.1:9200: "
            "no answer within 30 seconds (Connect timeout)"
        )
        assert failure.reason == "Unreachable"

    def test_a_handshake_that_never_answers_is_a_connect_timeout(self) -> None:
        with silent_listener() as port:
            started = time.monotonic()
            failure = _failure(_client(f"https://127.0.0.1:{port}", connect=0.05))

        expected = connect_timeout(f"127.0.0.1:{port}", 0.05)
        assert (failure.message, failure.reason) == (expected.message, expected.reason)
        assert time.monotonic() - started < 1

    def test_a_close_before_the_status_line_is_no_answer(self) -> None:
        with closing_server() as server:
            failure = _failure(_client(f"http://127.0.0.1:{server.port}"))

        assert failure.message == (
            f"OpenSearch at 127.0.0.1:{server.port} closed the connection without an answer: "
            "Remote end closed connection without response"
        )
        assert failure.reason == "Unreachable"

    def test_a_reset_before_the_status_line_is_no_answer(self) -> None:
        with closing_server(reset=True) as server:
            failure = _failure(_client(f"http://127.0.0.1:{server.port}"))

        assert failure.message == (
            f"OpenSearch at 127.0.0.1:{server.port} closed the connection without an answer: "
            "[Errno 104] Connection reset by peer"
        )
        assert failure.reason == "Unreachable"


class _FakeSocket:
    def __init__(self, error: OSError | None = None) -> None:
        self.error = error
        self.calls: list[tuple[str, Any]] = []

    def shutdown(self, how: int) -> None:
        self.calls.append(("shutdown", how))
        if self.error is not None:
            raise self.error

    def close(self) -> None:
        self.calls.append(("close", None))


class TestHeldCancel:
    """Stop and Timeout shut the live socket down; a blocked read wakes at once."""

    def test_the_cancel_shuts_both_directions_and_never_closes(self) -> None:
        sock = _FakeSocket()

        _rest._shutdown_socket(sock)

        assert sock.calls == [("shutdown", socket.SHUT_RDWR)]

    def test_the_cancel_suppresses_an_os_error(self) -> None:
        sock = _FakeSocket(OSError(107, "Transport endpoint is not connected"))

        _rest._shutdown_socket(sock)

        assert sock.calls == [("shutdown", socket.SHUT_RDWR)]

    @pytest.mark.parametrize("fixture", ["os_http", "os_https"])
    def test_stop_during_a_hung_read_shuts_the_socket_down_and_raises_stopped(
        self, fixture: str, request: pytest.FixtureRequest
    ) -> None:
        server: RecordingHTTPServer = request.getfixturevalue(fixture)
        enqueue_json(server, {}, delay=2)
        peers: list[tuple[Any, int]] = []

        def cancel(resource: Any) -> None:
            peers.append((resource, resource.getpeername()[1]))
            _rest._shutdown_socket(resource)

        live = _SpyLive(cancel)
        client = _client(server.base_url, tls_rows={"verify_ssl": False}, live=live)
        threading.Timer(0.03, live.stop).start()
        started = time.monotonic()

        with pytest.raises(Stopped):
            client.request("POST", "/logs/_search", body={"size": 0})

        assert time.monotonic() - started < 1
        assert peers[0][1] == port_of(server)
        assert peers[0][0] is live.attached[0]
        if fixture == "os_https":
            assert isinstance(peers[0][0], ssl.SSLSocket)

    def test_the_deadline_during_a_hung_read_raises_the_timeout_failure(
        self, os_http: RecordingHTTPServer
    ) -> None:
        enqueue_json(os_http, {}, delay=2)
        live = _SpyLive()
        threading.Timer(0.03, live.expire).start()

        failure = _failure(_client(os_http.base_url, live=live))

        assert failure.message == timeout_message(DEADLINE_SECONDS)
        assert failure.reason == "Timeout"

    def test_a_stopped_live_ends_the_request_before_it_is_sent(
        self, os_http: RecordingHTTPServer
    ) -> None:
        live = _SpyLive()
        live.stop()

        with pytest.raises(Stopped):
            _client(os_http.base_url, live=live).request("GET", "/_search")

        assert os_http.requests == []

    def test_an_expired_live_ends_the_request_before_it_is_sent(
        self, os_http: RecordingHTTPServer
    ) -> None:
        live = _SpyLive()
        live.expire()

        failure = _failure(_client(os_http.base_url, live=live))

        assert (failure.message, failure.reason) == (timeout_message(DEADLINE_SECONDS), "Timeout")
        assert os_http.requests == []

    def test_a_connect_failure_after_the_deadline_reports_the_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        live = _SpyLive()
        _refuse_with(monkeypatch, ConnectionRefusedError(111, "Connection refused"), live.expire)

        failure = _failure(_client("http://127.0.0.1:9", live=live))

        assert (failure.message, failure.reason) == (timeout_message(DEADLINE_SECONDS), "Timeout")

    def test_a_connect_failure_after_a_stop_raises_stopped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        live = _SpyLive()
        _refuse_with(monkeypatch, ConnectionRefusedError(111, "Connection refused"), live.stop)

        with pytest.raises(Stopped):
            _client("http://127.0.0.1:9", live=live).request("GET", "/_search")

    def test_the_read_is_not_bounded_by_the_connect_timeout(
        self, os_http: RecordingHTTPServer
    ) -> None:
        enqueue_json(os_http, {"took": 1}, delay=0.06)

        answer = _client(os_http.base_url, connect=0.02).request("GET", "/_search")

        assert answer.status == 200


class TestJson:
    """A 2xx JSON object is parsed with exact decimals; anything else raises its failure."""

    def _json(self, status: int, body: bytes, query: Any = None) -> Any:
        answer = Answer(status=status, reason="", headers={}, body=body)
        return _client("http://127.0.0.1:9").json(answer, query)

    def test_a_2xx_object_is_parsed_with_exact_decimals(self) -> None:
        parsed = self._json(
            200, b'{"took": 5, "max_score": 12.50, "hits": {"total": {"value": 3}}}'
        )

        assert parsed == {"took": 5, "max_score": Decimal("12.50"), "hits": {"total": {"value": 3}}}
        assert str(parsed["max_score"]) == "12.50"

    def test_a_201_object_is_parsed(self) -> None:
        assert self._json(201, b'{"acknowledged": true}') == {"acknowledged": True}

    def test_an_error_answer_raises_its_failure(self) -> None:
        body = error_answer("index_not_found_exception", "no such index [nope]", 404)

        with pytest.raises(OpenSearchFailure) as caught:
            self._json(404, json.dumps(body).encode())

        assert caught.value.message == "index_not_found_exception: no such index [nope]"
        assert caught.value.reason == "RequestFailed"

    def test_the_query_as_sent_reaches_the_failure(self) -> None:
        body = error_answer(
            "search_phase_execution_exception",
            "all shards failed",
            400,
            root_cause=[{"type": "query_shard_exception", "reason": "bad"}],
        )

        with pytest.raises(OpenSearchFailure) as caught:
            self._json(400, json.dumps(body).encode(), {"match_all": {}})

        assert caught.value.message == (
            "search_phase_execution_exception: all shards failed. First root cause: "
            'query_shard_exception: bad. Query as sent: {"match_all":{}}'
        )

    def test_a_2xx_answer_that_is_not_json_raises(self) -> None:
        with pytest.raises(OpenSearchFailure) as caught:
            self._json(200, b"<html>login</html>")

        assert caught.value.message == "HTTP 200: the answer is not JSON: <html>login</html>"
        assert caught.value.reason == "RequestFailed"

    def test_an_answer_from_the_wire(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, search_answer([], 0))
        client = _client(os_http.base_url)

        parsed = client.json(client.request("POST", "/logs/_search", body={"size": 0}))

        assert parsed["hits"]["total"] == {"value": 0, "relation": "eq"}


PROXY_LOGIN = ("wave", "s3cret")
PROXY_LOGIN_HEADER = "Basic d2F2ZTpzM2NyZXQ="
PROXY_VARIABLES = ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")
UNUSABLE_HOST_VALUE = (
    "This WAVE host's proxy address socks5://proxy.example:1080 is not an http:// address: "
    "choose Custom or turn the proxy off"
)

UNVERIFIED = {"verify_ssl": False}

Asked = list[tuple[str, str, int]]
Lines = list[tuple[str, str]]


@pytest.fixture
def run_lines() -> Generator[Lines, None, None]:
    """One block run: its log sink is active for the test and removed after."""
    lines: Lines = []
    token = RUN_LOG.set(RunLog(lambda level, message: lines.append((level, message))))
    yield lines
    RUN_LOG.reset(token)


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
    """With a route each connection is a CONNECT tunnel the proxy opens to the cluster."""

    def test_an_https_request_goes_through_a_tunnel_to_the_cluster(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        enqueue_json(os_https, {"took": 1})
        with Proxy() as for_https, Proxy() as for_http:
            _proxy_in_force(https=for_https.port, http=for_http.port)

            answer = _client(os_https.base_url, tls_rows=_trusted(tls_material)).request(
                "POST", "/logs/_search", body={"size": 0}
            )

            assert (answer.status, answer.body) == (200, b'{"took": 1}')
            assert _tunnels(for_https) == [("CONNECT", f"127.0.0.1:{port_of(os_https)}")]
            assert for_http.untouched
        assert sent(os_https, 0)["raw_path"] == "/logs/_search"
        assert os_https.requests[0]["body"] == b'{"size":0}'

    def test_a_plain_http_request_is_tunneled_through_the_http_endpoint(
        self, os_http: RecordingHTTPServer
    ) -> None:
        enqueue_json(os_http, {"took": 1})
        with Proxy() as for_https, Proxy() as for_http:
            _proxy_in_force(https=for_https.port, http=for_http.port)

            answer = _client(os_http.base_url).request("GET", "/_search")

            assert (answer.status, answer.body) == (200, b'{"took": 1}')
            assert _tunnels(for_http) == [("CONNECT", f"127.0.0.1:{port_of(os_http)}")]
            assert for_https.untouched
        assert sent(os_http, 0)["raw_path"] == "/_search"

    def test_an_address_without_a_port_is_tunneled_to_the_default_port(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        enqueue_json(os_https, {})
        with Proxy(upstream=("127.0.0.1", port_of(os_https))) as server:
            asked = _proxy_in_force(https=server.port)

            answer = _client("https://localhost", tls_rows=_trusted(tls_material)).request(
                "GET", "/_search"
            )

            assert answer.status == 200
            assert _tunnels(server) == [("CONNECT", "localhost:443")]
            assert set(asked) == {("https", "localhost", 443)}

    @pytest.mark.parametrize(("fixture", "scheme"), [("os_https", "https"), ("os_http", "http")])
    def test_the_route_decision_is_asked_about_the_clusters_address(
        self,
        fixture: str,
        scheme: str,
        request: pytest.FixtureRequest,
        tls_material: TLSMaterial,
    ) -> None:
        cluster: RecordingHTTPServer = request.getfixturevalue(fixture)
        enqueue_json(cluster, {})
        with Proxy() as server:
            asked = _proxy_in_force(https=server.port, http=server.port)

            _client(cluster.base_url, tls_rows=_trusted(tls_material)).request("GET", "/_search")

        assert set(asked) == {(scheme, "127.0.0.1", port_of(cluster))}

    def test_a_proxy_login_rides_the_connect_request(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        enqueue_json(os_https, {})
        with Proxy(login=PROXY_LOGIN) as server:
            _proxy_in_force(https=server.port, login=PROXY_LOGIN)

            answer = _client(
                os_https.base_url, tls_rows=_trusted(tls_material), authorization="ApiKey os_k"
            ).request("GET", "/_search")

            assert answer.status == 200
            assert server.requests[0].headers["proxy-authorization"] == PROXY_LOGIN_HEADER
        assert "proxy-authorization" not in sent(os_https, 0)["headers"]
        assert sent(os_https, 0)["headers"]["authorization"] == "ApiKey os_k"

    def test_a_proxy_without_a_username_gets_no_login(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        enqueue_json(os_https, {})
        with Proxy() as server:
            _proxy_in_force(https=server.port)

            _client(os_https.base_url, tls_rows=_trusted(tls_material)).request("GET", "/_search")

            assert "proxy-authorization" not in server.requests[0].headers

    def test_the_clusters_name_is_still_verified_through_the_tunnel(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        with Proxy(upstream=("127.0.0.1", port_of(os_https))) as server:
            _proxy_in_force(https=server.port)
            client = _client("https://opensearch.internal:9200", tls_rows=_trusted(tls_material))

            failure = _failure(client)

            assert _tunnels(server) == [("CONNECT", "opensearch.internal:9200")]
        prefix = "Could not connect to OpenSearch at opensearch.internal:9200: "
        assert re.match(rf"^{re.escape(prefix)}.*CERTIFICATE_VERIFY_FAILED.*$", failure.message)
        assert failure.reason == "Unreachable"
        assert os_https.requests == []


class TestDirectRoute:
    """A direct decision, or no proxy in force, never touches the proxy."""

    @pytest.mark.parametrize("fixture", ["os_https", "os_http"])
    def test_a_direct_decision_connects_to_the_cluster_itself(
        self, fixture: str, request: pytest.FixtureRequest, tls_material: TLSMaterial
    ) -> None:
        cluster: RecordingHTTPServer = request.getfixturevalue(fixture)
        enqueue_json(cluster, {})
        with Proxy() as server:
            _proxy_in_force(https=server.port, http=server.port, through=False)

            answer = _client(cluster.base_url, tls_rows=_trusted(tls_material)).request(
                "GET", "/_search"
            )

            assert answer.status == 200
            assert server.untouched

    @pytest.mark.parametrize("fixture", ["os_https", "os_http"])
    def test_without_a_proxy_in_force_the_wave_hosts_proxy_variables_are_not_used(
        self,
        fixture: str,
        request: pytest.FixtureRequest,
        tls_material: TLSMaterial,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        cluster: RecordingHTTPServer = request.getfixturevalue(fixture)
        enqueue_json(cluster, {})
        with Proxy() as server:
            for name in PROXY_VARIABLES:
                monkeypatch.setenv(name, server.url)

            answer = _client(cluster.base_url, tls_rows=_trusted(tls_material)).request(
                "GET", "/_search"
            )

            assert answer.status == 200
            assert server.untouched


class TestProxyLogLine:
    """A block run names the proxy it used once, however many requests it made."""

    def test_two_requests_of_one_run_write_the_line_once(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial, run_lines: Lines
    ) -> None:
        enqueue_json(os_https, {})
        enqueue_json(os_https, {})
        with Proxy() as server:
            _proxy_in_force(https=server.port)
            client = _client(os_https.base_url, tls_rows=_trusted(tls_material))

            client.request("GET", "/_resolve/index/logs-%2A")
            client.request("POST", "/logs-%2A/_search", body={"size": 0})

            assert [asked.method for asked in server.requests] == ["CONNECT", "CONNECT"]
        assert run_lines == [("DEBUG", f"Using the proxy 127.0.0.1:{server.port}")]

    def test_a_direct_connection_writes_no_line(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial, run_lines: Lines
    ) -> None:
        enqueue_json(os_https, {})
        with Proxy() as server:
            _proxy_in_force(https=server.port, through=False)

            _client(os_https.base_url, tls_rows=_trusted(tls_material)).request("GET", "/_search")

        assert run_lines == []


class TestProxyFailures:
    """A proxy failure reads as an unreachable cluster, carrying the proxy's own text."""

    def test_a_refused_tunnel_names_the_proxy_answer(self) -> None:
        target = _free_port()
        with Proxy(refuse=(403, "Forbidden")) as server:
            _proxy_in_force(https=server.port)

            failure = _failure(_client(f"https://127.0.0.1:{target}", tls_rows=UNVERIFIED))

            assert failure.message == (
                f"Could not connect to OpenSearch at 127.0.0.1:{target}: "
                f"Proxy 127.0.0.1:{server.port} refused the connection to "
                f"127.0.0.1:{target}: 403 Forbidden"
            )
        assert failure.reason == "Unreachable"

    def test_a_proxy_that_cannot_be_reached_is_named(self) -> None:
        target = _free_port()
        dead = closed_port()
        _proxy_in_force(https=dead)

        failure = _failure(_client(f"https://127.0.0.1:{target}", tls_rows=UNVERIFIED))

        prefix = re.escape(f"Could not connect to OpenSearch at 127.0.0.1:{target}: ")
        assert re.match(
            rf"^{prefix}Proxy 127\.0\.0\.1:{dead} cannot be reached: .+$", failure.message
        )
        assert failure.reason == "Unreachable"

    def test_a_wave_host_value_wave_cannot_use_keeps_its_own_text(
        self, os_https: RecordingHTTPServer, tls_material: TLSMaterial
    ) -> None:
        _proxy_in_force(decision_error=UNUSABLE_HOST_VALUE)

        failure = _failure(_client(os_https.base_url, tls_rows=_trusted(tls_material)))

        assert failure.message == (
            f"Could not connect to OpenSearch at 127.0.0.1:{port_of(os_https)}: "
            f"{UNUSABLE_HOST_VALUE}"
        )
        assert failure.reason == "Unreachable"
        assert os_https.requests == []
