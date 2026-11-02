"""The OpenSearch block's failures: transport texts and error answer shapes, each under On error.

Every row of the failure table surfaces through the block: raised under Fail; under Record and
continue, the empty Results and Total results beside the failed core and one WARN line. No
failure is retried. REQ-5.1.2, REQ-3.4.1.15, OS-11.
"""

import json
import re
import socket
from typing import Any

import pytest

from tests.connectivity.opensearch.fakes import (
    closing_server,
    enqueue_json,
    enqueue_text,
    error_answer,
    field_caps_answer,
    port_of,
    sent_json,
    unknown_query_answer,
)
from tests.plugins.http.conftest import RecordingHTTPServer
from tests.plugins.opensearch.conftest import (
    FakeTimer,
    FixedClock,
    LogRecorder,
    failed_line,
    os_params,
    outputs,
    recorded,
    served,
)
from wavecore.plugins import _opensearch_core

ON_ERROR = pytest.mark.parametrize("on_error", ["fail", "record"])
MODES = pytest.mark.parametrize("mode", ["search", "aggregate"])
FIELD_LIST, QUERY = "field list", "query"

DASHBOARDS = (
    "This is the OpenSearch Dashboards address. The block needs the cluster address, "
    "usually port 9200"
)
SECURITY_REASON = (
    "no permissions for [indices:data/read/search] and User [name=wave-limited, "
    "backend_roles=[], requestedTenant=null]"
)
WRONG_METHOD = (
    "Incorrect HTTP method for uri [/filebeat-%2A/_search] and method [POST], allowed: [DELETE]"
)
PARSING_REASON = "unknown query [matchall] did you mean any of [match_all, match]?"
ROOT_CAUSE = {
    "type": "query_shard_exception",
    "reason": 'failed to create query: For input string: "abc"',
    "index": "logs-1",
}
FIELD_CAPS_OK = field_caps_answer(
    {"@timestamp": "date", "log.level": "keyword", "latency_ms": "long", "message": "text"},
    ["logs-1"],
)
DASHBOARDS_BODY = {"statusCode": 404, "error": "Not Found", "message": "Not Found"}


@pytest.fixture(autouse=True)
def _fixed_time(clock: FixedClock, deadline: type[FakeTimer]) -> None:
    """A fixed now and a deadline timer that never fires on its own."""


def json_body(
    status: int, payload: Any, headers: list[tuple[str, str]] | None = None
) -> dict[str, Any]:
    return {"text": json.dumps(payload), "status": status, "headers": headers}


def text_body(
    status: int, text: str, headers: list[tuple[str, str]] | None = None
) -> dict[str, Any]:
    return {
        "text": text,
        "status": status,
        "content_type": "text/plain; charset=UTF-8",
        "headers": headers,
    }


def no_body(status: int, headers: list[tuple[str, str]] | None = None) -> dict[str, Any]:
    return {"text": "", "status": status, "content_type": None, "headers": headers}


def all_shards_failed(
    root_cause: list[dict[str, Any]], failed_shards: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    envelope = error_answer(
        "search_phase_execution_exception", "all shards failed", 400, root_cause=root_cause
    )
    envelope["error"]["phase"] = "query"
    envelope["error"]["grouped"] = True
    if failed_shards is not None:
        envelope["error"]["failed_shards"] = failed_shards
    return envelope


def answered(server: RecordingHTTPServer, stage: str, answer: dict[str, Any]) -> int:
    """Script the failing answer on the field-list read or on the query; the requests it takes."""
    if stage == QUERY:
        enqueue_json(server, FIELD_CAPS_OK)
    enqueue_text(server, **answer)
    return 2 if stage == QUERY else 1


def failing(params: dict[str, Any], log: LogRecorder, reason: str) -> str:
    """Run the core to its failure, check the On error shape, and hand back the message."""
    mode = params.get("mode", "search")
    if params.get("on_error", "fail") == "record":
        out = outputs(_opensearch_core.run(params, log))
        message = str(out["error"])
        assert out == recorded(message, reason)
        assert log.at("WARN") == [failed_line(mode, message, reason)]
        assert log[-1] == ("WARN", failed_line(mode, message, reason))
    else:
        with pytest.raises(ValueError) as caught:
            _opensearch_core.run(params, log)
        message = str(caught.value)
        assert log.at("WARN") == []
    assert log.at("INFO") == []
    return message


def query_as_sent(server: RecordingHTTPServer, index: int) -> str:
    """The query of request `index` as compact JSON, as the all-shards-failed message quotes it."""
    return json.dumps(sent_json(server, index)["query"], separators=(",", ":"), ensure_ascii=False)


def free_port() -> int:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = int(probe.getsockname()[1])
    probe.close()
    return port


def dial_fails(monkeypatch: pytest.MonkeyPatch, error: BaseException) -> list[tuple[Any, Any]]:
    """Every connect raises `error`; returns the address and connect timeout each dial asked."""
    asked: list[tuple[Any, Any]] = []

    def dial(address: Any, timeout: Any = None, *_args: Any, **_kwargs: Any) -> socket.socket:
        asked.append((address, timeout))
        raise error

    monkeypatch.setattr(socket, "create_connection", dial)
    return asked


class TestUnreachable:
    """Connect, TLS and early-close failures: reason Unreachable, naming host and port (OS-11)."""

    @ON_ERROR
    @MODES
    def test_a_refused_connect(self, log: LogRecorder, on_error: str, mode: str) -> None:
        port = free_port()
        params = os_params(url=f"http://127.0.0.1:{port}", mode=mode, on_error=on_error)

        message = failing(params, log, "Unreachable")

        assert message == (
            f"Could not connect to OpenSearch at 127.0.0.1:{port}: [Errno 111] Connection refused"
        )

    @ON_ERROR
    def test_a_name_that_does_not_resolve(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, on_error: str
    ) -> None:
        asked = dial_fails(monkeypatch, socket.gaierror(-2, "Name or service not known"))

        message = failing(os_params(on_error=on_error), log, "Unreachable")

        assert message == (
            "Could not connect to OpenSearch at opensearch.internal:9200: "
            "[Errno -2] Name or service not known"
        )
        assert len(asked) == 1

    @ON_ERROR
    def test_a_server_certificate_that_fails_verification(
        self, os_https: RecordingHTTPServer, log: LogRecorder, on_error: str
    ) -> None:
        message = failing(served(os_https, on_error=on_error), log, "Unreachable")

        prefix = f"Could not connect to OpenSearch at 127.0.0.1:{port_of(os_https)}: "
        assert re.match(rf"^{re.escape(prefix)}.*CERTIFICATE_VERIFY_FAILED.*$", message)
        assert os_https.requests == []

    @ON_ERROR
    @pytest.mark.parametrize(
        ("overrides", "seconds"),
        [({}, 30), ({"connect_timeout": 12}, 12)],
        ids=["default", "set"],
    )
    def test_a_connect_timeout_names_the_connect_timeout_row(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        on_error: str,
        overrides: dict[str, Any],
        seconds: int,
    ) -> None:
        asked = dial_fails(monkeypatch, TimeoutError("timed out"))
        params = os_params(url="http://192.0.2.1:9200", on_error=on_error, **overrides)

        message = failing(params, log, "Unreachable")

        assert message == (
            f"Could not connect to OpenSearch at 192.0.2.1:9200: "
            f"no answer within {seconds} seconds (Connect timeout)"
        )
        assert asked == [(("192.0.2.1", 9200), seconds)]

    @ON_ERROR
    @pytest.mark.parametrize(
        ("reset", "text"),
        [
            (False, "Remote end closed connection without response"),
            (True, "[Errno 104] Connection reset by peer"),
        ],
        ids=["closed", "reset"],
    )
    def test_a_connection_ended_before_the_status_line(
        self, log: LogRecorder, on_error: str, reset: bool, text: str
    ) -> None:
        with closing_server(reset=reset) as server:
            params = os_params(url=f"http://127.0.0.1:{server.port}", on_error=on_error)

            message = failing(params, log, "Unreachable")

        assert message == (
            f"OpenSearch at 127.0.0.1:{server.port} closed the connection without an answer: {text}"
        )
        assert server.connections == 1


class TestDashboardsAddress:
    """The Dashboards address fails with reason Validation, whatever else it answers."""

    @ON_ERROR
    @pytest.mark.parametrize(
        "answer",
        [
            pytest.param(
                json_body(404, DASHBOARDS_BODY, headers=[("osd-name", "dashboards-1")]),
                id="osd-name-header",
            ),
            pytest.param(
                text_body(401, "Unauthorized", headers=[("osd-name", "dashboards-1")]),
                id="osd-name-header-on-a-401",
            ),
            pytest.param(
                no_body(302, headers=[("Location", "/app/login?nextUrl=%2Ffilebeat-%252A")]),
                id="redirect-into-app",
            ),
            pytest.param(json_body(404, DASHBOARDS_BODY), id="dashboards-json-shape"),
        ],
    )
    def test_the_dashboards_answer(
        self,
        os_http: RecordingHTTPServer,
        log: LogRecorder,
        on_error: str,
        answer: dict[str, Any],
    ) -> None:
        sent = answered(os_http, FIELD_LIST, answer)

        message = failing(served(os_http, on_error=on_error), log, "Validation")

        assert message == DASHBOARDS
        assert len(os_http.requests) == sent


class TestAllShardsFailed:
    """The first root cause and the query as sent, so a refused query shows what it became."""

    @ON_ERROR
    @MODES
    def test_the_first_root_cause_and_the_query_as_sent(
        self, os_http: RecordingHTTPServer, log: LogRecorder, on_error: str, mode: str
    ) -> None:
        second = {"type": "illegal_argument_exception", "reason": "second"}
        sent = answered(os_http, QUERY, json_body(400, all_shards_failed([ROOT_CAUSE, second])))
        params = served(os_http, mode=mode, query="latency_ms: abc", on_error=on_error)

        message = failing(params, log, "RequestFailed")

        assert message == (
            "search_phase_execution_exception: all shards failed. First root cause: "
            'query_shard_exception: failed to create query: For input string: "abc". '
            f"Query as sent: {query_as_sent(os_http, 1)}"
        )
        assert len(os_http.requests) == sent

    @ON_ERROR
    def test_the_first_failed_shard_when_there_is_no_root_cause(
        self, os_http: RecordingHTTPServer, log: LogRecorder, on_error: str
    ) -> None:
        shards = [
            {"shard": 0, "index": "logs-1", "reason": {"type": "parse_exception", "reason": "p"}}
        ]
        answered(os_http, QUERY, json_body(400, all_shards_failed([], shards)))

        message = failing(served(os_http, on_error=on_error), log, "RequestFailed")

        assert message == (
            "search_phase_execution_exception: all shards failed. First root cause: "
            f"parse_exception: p. Query as sent: {query_as_sent(os_http, 1)}"
        )

    @ON_ERROR
    def test_neither_root_cause_nor_failed_shards(
        self, os_http: RecordingHTTPServer, log: LogRecorder, on_error: str
    ) -> None:
        answered(os_http, QUERY, json_body(400, all_shards_failed([])))

        message = failing(served(os_http, on_error=on_error), log, "RequestFailed")

        assert message == (
            "search_phase_execution_exception: all shards failed. "
            f"Query as sent: {query_as_sent(os_http, 1)}"
        )


ENVELOPE_CASES = [
    pytest.param(
        QUERY,
        json_body(400, unknown_query_answer()),
        f"parsing_exception: {PARSING_REASON}",
        "RequestFailed",
        id="400-parsing-exception",
    ),
    pytest.param(
        FIELD_LIST,
        json_body(
            401,
            error_answer("security_exception", "missing authentication credentials", 401),
            headers=[("WWW-Authenticate", 'Basic realm="OpenSearch Security"')],
        ),
        "security_exception: missing authentication credentials",
        "AuthFailed",
        id="401-envelope",
    ),
    pytest.param(
        QUERY,
        json_body(403, error_answer("security_exception", SECURITY_REASON, 403)),
        f"security_exception: {SECURITY_REASON}",
        "AuthFailed",
        id="403-security-exception",
    ),
    pytest.param(
        FIELD_LIST,
        json_body(
            403,
            error_answer(
                "cluster_block_exception",
                "index [logs-1] blocked by: [FORBIDDEN/8/index write (api)];",
                403,
            ),
        ),
        "cluster_block_exception: index [logs-1] blocked by: [FORBIDDEN/8/index write (api)];",
        "RequestFailed",
        id="403-cluster-block",
    ),
    pytest.param(
        QUERY,
        json_body(429, error_answer("circuit_breaking_exception", "[parent] Data too large", 429)),
        "circuit_breaking_exception: [parent] Data too large",
        "RequestFailed",
        id="429-circuit-breaker",
    ),
]

TEXT_ERROR_CASES = [
    pytest.param(
        QUERY,
        json_body(405, {"error": WRONG_METHOD, "status": 405}),
        WRONG_METHOD,
        "RequestFailed",
        id="405-probed",
    ),
    pytest.param(
        FIELD_LIST,
        json_body(400, {"error": "invalid uri has been requested"}),
        "invalid uri has been requested",
        "RequestFailed",
        id="400-text",
    ),
    pytest.param(
        FIELD_LIST,
        json_body(401, {"error": "token expired"}),
        "token expired",
        "AuthFailed",
        id="401-text",
    ),
]

NOT_JSON_CASES = [
    pytest.param(
        FIELD_LIST,
        text_body(401, "Unauthorized", headers=[("WWW-Authenticate", 'Basic realm="x"')]),
        "HTTP 401: Unauthorized",
        "AuthFailed",
        id="401-plain-unauthorized",
    ),
    pytest.param(
        FIELD_LIST,
        text_body(503, "OpenSearch Security not initialized."),
        "HTTP 503: OpenSearch Security not initialized.",
        "RequestFailed",
        id="503-security-not-initialized",
    ),
    pytest.param(
        QUERY,
        text_body(502, "<html><head><title>502 Bad Gateway</title></head>\n<body>nginx</body>"),
        "HTTP 502: <html><head><title>502 Bad Gateway</title></head>",
        "RequestFailed",
        id="502-first-line-only",
    ),
    pytest.param(
        FIELD_LIST,
        text_body(200, "<html><body>proxy login</body></html>\nmore"),
        "HTTP 200: the answer is not JSON: <html><body>proxy login</body></html>",
        "RequestFailed",
        id="200-field-list-not-json",
    ),
    pytest.param(
        QUERY,
        text_body(200, "<html><body>proxy login</body></html>"),
        "HTTP 200: the answer is not JSON: <html><body>proxy login</body></html>",
        "RequestFailed",
        id="200-query-not-json",
    ),
]

EMPTY_BODY_CASES = [
    pytest.param(
        FIELD_LIST, no_body(502), "HTTP 502 Bad Gateway (no body)", "RequestFailed", id="502"
    ),
    pytest.param(
        QUERY, no_body(503), "HTTP 503 Service Unavailable (no body)", "RequestFailed", id="503"
    ),
    pytest.param(
        FIELD_LIST, no_body(401), "HTTP 401 Unauthorized (no body)", "AuthFailed", id="401"
    ),
]

OTHER_JSON_CASES = [
    pytest.param(
        FIELD_LIST, json_body(500, [1, 2, 3]), "HTTP 500: [1,2,3]", "RequestFailed", id="array"
    ),
    pytest.param(
        QUERY,
        json_body(502, {"message": "upstream down", "code": 7}),
        'HTTP 502: {"message":"upstream down","code":7}',
        "RequestFailed",
        id="object-of-another-shape",
    ),
    pytest.param(
        FIELD_LIST, json_body(401, ["denied"]), 'HTTP 401: ["denied"]', "AuthFailed", id="401"
    ),
]


def shaped(
    server: RecordingHTTPServer,
    log: LogRecorder,
    case: tuple[str, dict[str, Any], str, str],
    on_error: str,
) -> None:
    """The scripted answer fails the block with its message and reason, and nothing is retried."""
    stage, answer, expected, reason = case
    sent = answered(server, stage, answer)

    message = failing(served(server, on_error=on_error), log, reason)

    assert message == expected
    assert len(server.requests) == sent


class TestErrorEnvelope:
    """`<type>: <reason>`; AuthFailed for 401 and for a 403 security exception."""

    @ON_ERROR
    @pytest.mark.parametrize(("stage", "answer", "message", "reason"), ENVELOPE_CASES)
    def test_the_envelope(
        self,
        os_http: RecordingHTTPServer,
        log: LogRecorder,
        on_error: str,
        stage: str,
        answer: dict[str, Any],
        message: str,
        reason: str,
    ) -> None:
        shaped(os_http, log, (stage, answer, message, reason), on_error)


class TestTextError:
    """`{"error": "<text>"}` gives the text as is; AuthFailed for 401."""

    @ON_ERROR
    @pytest.mark.parametrize(("stage", "answer", "message", "reason"), TEXT_ERROR_CASES)
    def test_the_text(
        self,
        os_http: RecordingHTTPServer,
        log: LogRecorder,
        on_error: str,
        stage: str,
        answer: dict[str, Any],
        message: str,
        reason: str,
    ) -> None:
        shaped(os_http, log, (stage, answer, message, reason), on_error)


class TestBodyThatIsNotJson:
    """`HTTP <status>: <first line>`; a 2xx says the answer is not JSON."""

    @ON_ERROR
    @pytest.mark.parametrize(("stage", "answer", "message", "reason"), NOT_JSON_CASES)
    def test_the_first_line(
        self,
        os_http: RecordingHTTPServer,
        log: LogRecorder,
        on_error: str,
        stage: str,
        answer: dict[str, Any],
        message: str,
        reason: str,
    ) -> None:
        shaped(os_http, log, (stage, answer, message, reason), on_error)


class TestEmptyBody:
    """`HTTP <status> <reason phrase> (no body)`."""

    @ON_ERROR
    @pytest.mark.parametrize(("stage", "answer", "message", "reason"), EMPTY_BODY_CASES)
    def test_the_status_line(
        self,
        os_http: RecordingHTTPServer,
        log: LogRecorder,
        on_error: str,
        stage: str,
        answer: dict[str, Any],
        message: str,
        reason: str,
    ) -> None:
        shaped(os_http, log, (stage, answer, message, reason), on_error)


class TestOtherJson:
    """`HTTP <status>: <compact JSON>` for JSON of another shape."""

    @ON_ERROR
    @pytest.mark.parametrize(("stage", "answer", "message", "reason"), OTHER_JSON_CASES)
    def test_the_compact_json(
        self,
        os_http: RecordingHTTPServer,
        log: LogRecorder,
        on_error: str,
        stage: str,
        answer: dict[str, Any],
        message: str,
        reason: str,
    ) -> None:
        shaped(os_http, log, (stage, answer, message, reason), on_error)


class TestAFailureEndsTheRun:
    """A failed field-list read sends no query, and a failed query is sent once: no retries."""

    def test_a_failed_field_list_read_sends_no_query(
        self, os_http: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        enqueue_text(os_http, **text_body(503, "OpenSearch Security not initialized."))
        enqueue_json(os_http, FIELD_CAPS_OK)

        failing(served(os_http, on_error="record"), log, "RequestFailed")

        assert [request["method"] for request in os_http.requests] == ["GET"]

    def test_a_failed_query_is_not_sent_again(
        self, os_http: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(os_http, QUERY, no_body(503))
        enqueue_json(os_http, FIELD_CAPS_OK)

        failing(served(os_http, on_error="record"), log, "RequestFailed")

        assert [request["method"] for request in os_http.requests] == ["GET", "POST"]
