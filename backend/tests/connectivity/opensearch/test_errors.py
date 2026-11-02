"""Failure messages and reasons: transport texts and the error answer shapes (REQ-5.1.2, OS-11)."""

import json
import socket
import ssl
from decimal import Decimal
from http.client import RemoteDisconnected
from typing import Any

import pytest

from tests.connectivity.opensearch.fakes import error_answer, unknown_query_answer
from wavecore.connectivity.opensearch._errors import (
    OpenSearchFailure,
    connect_timeout,
    failure_for,
    no_answer,
    timeout_message,
    unreachable,
)
from wavecore.connectivity.opensearch._rest import Answer

DASHBOARDS = (
    "This is the OpenSearch Dashboards address. The block needs the cluster address, "
    "usually port 9200"
)
QUERY = {"bool": {"filter": [{"term": {"log.level": "ERROR"}}, {"range": {"bytes": {"gte": 1}}}]}}
QUERY_TEXT = '{"bool":{"filter":[{"term":{"log.level":"ERROR"}},{"range":{"bytes":{"gte":1}}}]}}'
ROOT_CAUSE = {
    "type": "query_shard_exception",
    "reason": 'failed to create query: For input string: "abc"',
    "index": "logs-1",
}
SECURITY_REASON = (
    "no permissions for [indices:data/read/search] and User [name=wave-limited, "
    "backend_roles=[], requestedTenant=null]"
)


def _answer(
    status: int,
    body: bytes | str | dict[str, Any] | list[Any] = b"",
    reason: str = "",
    headers: dict[str, str] | None = None,
) -> Any:
    if isinstance(body, dict | list):
        body = json.dumps(body)
    if isinstance(body, str):
        body = body.encode()
    return Answer(status=status, reason=reason, headers=headers or {}, body=body)


def _all_shards_failed(
    root_cause: list[dict[str, Any]] | None, failed_shards: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    envelope = error_answer(
        "search_phase_execution_exception", "all shards failed", 400, root_cause=root_cause
    )
    envelope["error"]["phase"] = "query"
    envelope["error"]["grouped"] = True
    if root_cause is None:
        del envelope["error"]["root_cause"]
    if failed_shards is not None:
        envelope["error"]["failed_shards"] = failed_shards
    return envelope


def _assert_failure(failure: OpenSearchFailure, message: str, reason: str) -> None:
    assert isinstance(failure, OpenSearchFailure)
    assert failure.message == message
    assert failure.reason == reason


class TestTheFailureType:
    """The per-core failure type: a message and a reason."""

    def test_it_carries_its_message_and_reason(self) -> None:
        failure = OpenSearchFailure("Password needs a Username", "Validation")

        assert failure.message == "Password needs a Username"
        assert failure.reason == "Validation"

    def test_it_is_an_exception_whose_text_is_the_message(self) -> None:
        with pytest.raises(OpenSearchFailure, match=r"^Password needs a Username$"):
            raise OpenSearchFailure("Password needs a Username", "Validation")


class TestTransportMessages:
    """The platform's own text follows the WAVE words unchanged."""

    def test_a_refused_connect_is_unreachable(self) -> None:
        failure = unreachable("127.0.0.1:9479", ConnectionRefusedError(111, "Connection refused"))

        _assert_failure(
            failure,
            "Could not connect to OpenSearch at 127.0.0.1:9479: [Errno 111] Connection refused",
            "Unreachable",
        )

    def test_a_dns_failure_is_unreachable(self) -> None:
        error = socket.gaierror(-2, "Name or service not known")

        failure = unreachable("opensearch.internal:9200", error)

        _assert_failure(
            failure,
            "Could not connect to OpenSearch at opensearch.internal:9200: "
            "[Errno -2] Name or service not known",
            "Unreachable",
        )

    def test_a_tls_verification_failure_is_unreachable(self) -> None:
        error = ssl.SSLCertVerificationError(
            1, "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"
        )

        failure = unreachable("opensearch.internal:9200", error)

        _assert_failure(
            failure,
            f"Could not connect to OpenSearch at opensearch.internal:9200: {error}",
            "Unreachable",
        )

    def test_a_connect_timeout_names_the_seconds(self) -> None:
        failure = connect_timeout("192.0.2.1:9200", 30)

        _assert_failure(
            failure,
            "Could not connect to OpenSearch at 192.0.2.1:9200: "
            "no answer within 30 seconds (Connect timeout)",
            "Unreachable",
        )

    def test_a_close_before_the_status_line(self) -> None:
        error = RemoteDisconnected("Remote end closed connection without response")

        failure = no_answer("opensearch.internal:9200", error)

        _assert_failure(
            failure,
            "OpenSearch at opensearch.internal:9200 closed the connection without an answer: "
            "Remote end closed connection without response",
            "Unreachable",
        )

    def test_a_reset_before_the_status_line(self) -> None:
        error = ConnectionResetError(104, "Connection reset by peer")

        failure = no_answer("opensearch.internal:9200", error)

        _assert_failure(
            failure,
            "OpenSearch at opensearch.internal:9200 closed the connection without an answer: "
            "[Errno 104] Connection reset by peer",
            "Unreachable",
        )

    @pytest.mark.parametrize("seconds", [300, 5])
    def test_the_whole_block_deadline_message(self, seconds: int) -> None:
        assert timeout_message(seconds) == (
            f"Timed out after {seconds} seconds; the connection was shut down, "
            "so OpenSearch ends the search"
        )


class TestDashboardsAddress:
    """The Dashboards address is refused with reason Validation, whatever else the answer holds."""

    def test_the_osd_name_header(self) -> None:
        answer = _answer(404, "Not Found", headers={"osd-name": "dashboards-1"})

        _assert_failure(failure_for(answer), DASHBOARDS, "Validation")

    def test_the_osd_name_header_wins_over_a_401(self) -> None:
        answer = _answer(401, "Unauthorized", headers={"osd-name": "dashboards-1"})

        _assert_failure(failure_for(answer), DASHBOARDS, "Validation")

    @pytest.mark.parametrize(
        "location",
        ["/app/login?nextUrl=%2F", "/app/home", "http://127.0.0.1:5601/app/login?nextUrl=%2F"],
        ids=["login", "home", "absolute"],
    )
    def test_a_redirect_into_app(self, location: str) -> None:
        answer = _answer(302, reason="Found", headers={"location": location})

        _assert_failure(failure_for(answer), DASHBOARDS, "Validation")

    def test_a_permanent_redirect_into_app(self) -> None:
        answer = _answer(301, reason="Moved Permanently", headers={"location": "/app/"})

        _assert_failure(failure_for(answer), DASHBOARDS, "Validation")

    @pytest.mark.parametrize("location", ["/login", "/application", "http://other:5601/"])
    def test_a_redirect_elsewhere_is_not_dashboards(self, location: str) -> None:
        answer = _answer(302, reason="Found", headers={"location": location})

        _assert_failure(failure_for(answer), "HTTP 302 Found (no body)", "RequestFailed")

    def test_the_dashboards_json_shape(self) -> None:
        answer = _answer(404, {"statusCode": 404, "error": "Not Found", "message": "Not Found"})

        _assert_failure(failure_for(answer), DASHBOARDS, "Validation")

    def test_the_dashboards_json_shape_in_any_key_order(self) -> None:
        answer = _answer(400, {"message": "bad", "statusCode": 400, "error": "Bad Request"})

        _assert_failure(failure_for(answer), DASHBOARDS, "Validation")

    def test_an_extra_key_is_not_the_dashboards_shape(self) -> None:
        body = {"statusCode": 404, "error": "Not Found", "message": "gone", "attributes": {}}

        _assert_failure(failure_for(_answer(404, body)), "Not Found", "RequestFailed")

    def test_a_missing_key_is_not_the_dashboards_shape(self) -> None:
        body = {"statusCode": 404, "error": "Not Found"}

        _assert_failure(failure_for(_answer(404, body)), "Not Found", "RequestFailed")


class TestAllShardsFailed:
    """The first root cause and the query as sent, so a refused DQL line shows what it became."""

    def test_the_first_root_cause_and_the_query(self) -> None:
        second = {"type": "illegal_argument_exception", "reason": "second"}
        answer = _answer(400, _all_shards_failed([ROOT_CAUSE, second]))

        _assert_failure(
            failure_for(answer, QUERY),
            "search_phase_execution_exception: all shards failed. First root cause: "
            'query_shard_exception: failed to create query: For input string: "abc". '
            f"Query as sent: {QUERY_TEXT}",
            "RequestFailed",
        )

    def test_the_failed_shards_reason_when_root_cause_is_empty(self) -> None:
        shards = [
            {
                "shard": 0,
                "index": "logs-1",
                "reason": {"type": "number_format_exception", "reason": "x1"},
            },
            {"shard": 1, "index": "logs-2", "reason": {"type": "other_exception", "reason": "x2"}},
        ]
        answer = _answer(400, _all_shards_failed([], shards))

        _assert_failure(
            failure_for(answer, QUERY),
            "search_phase_execution_exception: all shards failed. First root cause: "
            f"number_format_exception: x1. Query as sent: {QUERY_TEXT}",
            "RequestFailed",
        )

    def test_the_failed_shards_reason_when_root_cause_is_absent(self) -> None:
        shards = [
            {"shard": 0, "index": "logs-1", "reason": {"type": "parse_exception", "reason": "p"}}
        ]
        answer = _answer(500, _all_shards_failed(None, shards))

        _assert_failure(
            failure_for(answer, QUERY),
            "search_phase_execution_exception: all shards failed. First root cause: "
            f"parse_exception: p. Query as sent: {QUERY_TEXT}",
            "RequestFailed",
        )

    def test_neither_root_cause_nor_failed_shards(self) -> None:
        answer = _answer(400, _all_shards_failed([]))

        _assert_failure(
            failure_for(answer, QUERY),
            f"search_phase_execution_exception: all shards failed. Query as sent: {QUERY_TEXT}",
            "RequestFailed",
        )

    def test_the_query_keeps_exact_decimals_and_non_ascii_text(self) -> None:
        query = {"range": {"price": {"gte": Decimal("12.50")}}, "m": "héllo"}
        answer = _answer(400, _all_shards_failed([]))

        _assert_failure(
            failure_for(answer, query),
            "search_phase_execution_exception: all shards failed. Query as sent: "
            '{"range":{"price":{"gte":12.50}},"m":"héllo"}',
            "RequestFailed",
        )

    def test_a_query_longer_than_4000_characters_is_cut(self) -> None:
        query = {"match": {"message": "x" * 5000}}
        text = json.dumps(query, separators=(",", ":"))
        answer = _answer(400, _all_shards_failed([]))

        failure = failure_for(answer, query)

        assert failure.message == (
            "search_phase_execution_exception: all shards failed. Query as sent: "
            f"{text[:4000]}..."
        )

    def test_a_query_of_exactly_4000_characters_is_whole(self) -> None:
        query = {"match": {"m": "x" * 3982}}
        text = json.dumps(query, separators=(",", ":"))
        assert len(text) == 4000
        answer = _answer(400, _all_shards_failed([]))

        failure = failure_for(answer, query)

        assert failure.message == (
            f"search_phase_execution_exception: all shards failed. Query as sent: {text}"
        )

    def test_another_reason_of_the_same_type_is_the_standard_envelope(self) -> None:
        body = error_answer("search_phase_execution_exception", "Partial shards failure", 500)

        _assert_failure(
            failure_for(_answer(500, body), QUERY),
            "search_phase_execution_exception: Partial shards failure",
            "RequestFailed",
        )

    def test_all_shards_failed_under_another_type_is_the_standard_envelope(self) -> None:
        body = error_answer("illegal_state_exception", "all shards failed", 500)

        _assert_failure(
            failure_for(_answer(500, body), QUERY),
            "illegal_state_exception: all shards failed",
            "RequestFailed",
        )


class TestStandardEnvelope:
    """`<type>: <reason>` in OpenSearch's own words, the first root cause's when it names one."""

    def test_a_query_it_cannot_parse_names_the_root_cause_not_the_wrapper(self) -> None:
        _assert_failure(
            failure_for(_answer(400, unknown_query_answer())),
            "parsing_exception: unknown query [matchall] did you mean any of [match_all, match]?",
            "RequestFailed",
        )

    @pytest.mark.parametrize(
        "root_cause",
        [
            pytest.param([], id="empty"),
            pytest.param([{"type": "parsing_exception"}], id="no-reason"),
            pytest.param([{"reason": "unknown query [matchall]"}], id="no-type"),
            pytest.param([{"type": "", "reason": "r"}], id="empty-type"),
            pytest.param(["parsing_exception"], id="not-an-object"),
        ],
    )
    def test_a_root_cause_without_a_type_and_a_reason_gives_the_top_level(
        self, root_cause: list[Any]
    ) -> None:
        body = error_answer("x_content_parse_exception", "[1:9] failed", 400, root_cause)

        _assert_failure(
            failure_for(_answer(400, body)),
            "x_content_parse_exception: [1:9] failed",
            "RequestFailed",
        )

    def test_an_envelope_without_root_cause_gives_the_top_level(self) -> None:
        body = error_answer("illegal_argument_exception", "bad", 400)
        del body["error"]["root_cause"]

        _assert_failure(
            failure_for(_answer(400, body)), "illegal_argument_exception: bad", "RequestFailed"
        )

    def test_the_reason_follows_the_top_level_type(self) -> None:
        cause = {"type": "illegal_state_exception", "reason": "no role"}
        body = error_answer("security_exception", SECURITY_REASON, 403, [cause])

        _assert_failure(
            failure_for(_answer(403, body)), "illegal_state_exception: no role", "AuthFailed"
        )

    def test_a_401_envelope_is_auth_failed(self) -> None:
        body = error_answer("security_exception", "missing authentication credentials", 401)

        _assert_failure(
            failure_for(_answer(401, body)),
            "security_exception: missing authentication credentials",
            "AuthFailed",
        )

    def test_a_403_security_exception_is_auth_failed(self) -> None:
        body = error_answer("security_exception", SECURITY_REASON, 403)

        _assert_failure(
            failure_for(_answer(403, body)), f"security_exception: {SECURITY_REASON}", "AuthFailed"
        )

    def test_a_403_cluster_block_is_request_failed(self) -> None:
        reason = "index [logs-1] blocked by: [FORBIDDEN/8/index write (api)];"
        body = error_answer("cluster_block_exception", reason, 403)

        _assert_failure(
            failure_for(_answer(403, body)), f"cluster_block_exception: {reason}", "RequestFailed"
        )

    def test_a_missing_index(self) -> None:
        body = error_answer("index_not_found_exception", "no such index [nope]", 404)

        _assert_failure(
            failure_for(_answer(404, body)),
            "index_not_found_exception: no such index [nope]",
            "RequestFailed",
        )

    def test_a_server_error(self) -> None:
        body = error_answer("circuit_breaking_exception", "[parent] Data too large", 429)

        _assert_failure(
            failure_for(_answer(429, body)),
            "circuit_breaking_exception: [parent] Data too large",
            "RequestFailed",
        )


class TestTextError:
    """`{"error": "<text>"}` gives the text as is."""

    def test_the_text_as_is(self) -> None:
        body = {"error": "invalid uri has been requested"}

        _assert_failure(
            failure_for(_answer(400, body)), "invalid uri has been requested", "RequestFailed"
        )

    def test_the_probed_405(self) -> None:
        text = "Incorrect HTTP method for uri [/logs/_search] and method [POST], allowed: [DELETE]"

        _assert_failure(
            failure_for(_answer(405, {"error": text, "status": 405})), text, "RequestFailed"
        )

    def test_a_401_is_auth_failed(self) -> None:
        _assert_failure(
            failure_for(_answer(401, {"error": "token expired"})), "token expired", "AuthFailed"
        )

    def test_a_403_text_error_is_request_failed(self) -> None:
        _assert_failure(failure_for(_answer(403, {"error": "denied"})), "denied", "RequestFailed")


class TestBodyThatIsNotJson:
    """`HTTP <status>: <first line, cut at 200 characters>`."""

    def test_the_security_layers_plain_401(self) -> None:
        _assert_failure(
            failure_for(_answer(401, "Unauthorized")), "HTTP 401: Unauthorized", "AuthFailed"
        )

    def test_security_not_initialized(self) -> None:
        answer = _answer(503, "OpenSearch Security not initialized.")

        _assert_failure(
            failure_for(answer), "HTTP 503: OpenSearch Security not initialized.", "RequestFailed"
        )

    def test_only_the_first_line(self) -> None:
        answer = _answer(
            502, "<html><head><title>502 Bad Gateway</title></head>\n<body>nginx</body>"
        )

        _assert_failure(
            failure_for(answer),
            "HTTP 502: <html><head><title>502 Bad Gateway</title></head>",
            "RequestFailed",
        )

    def test_a_crlf_line_end_is_not_part_of_the_first_line(self) -> None:
        _assert_failure(
            failure_for(_answer(502, "Bad Gateway\r\nnginx\r\n")),
            "HTTP 502: Bad Gateway",
            "RequestFailed",
        )

    def test_a_truncated_json_body_is_not_json(self) -> None:
        answer = _answer(502, '{"took": 3, "hits": {"tot')

        _assert_failure(failure_for(answer), 'HTTP 502: {"took": 3, "hits": {"tot', "RequestFailed")

    def test_the_first_line_is_cut_at_200_characters(self) -> None:
        line = "y" * 300

        failure = failure_for(_answer(500, line))

        assert failure.message == f"HTTP 500: {'y' * 200}"

    def test_a_first_line_of_exactly_200_characters_is_whole(self) -> None:
        line = "z" * 200

        assert failure_for(_answer(500, line)).message == f"HTTP 500: {line}"

    def test_a_2xx_answer_that_is_not_json(self) -> None:
        answer = _answer(200, "<html><body>proxy login</body></html>\nmore")

        _assert_failure(
            failure_for(answer),
            "HTTP 200: the answer is not JSON: <html><body>proxy login</body></html>",
            "RequestFailed",
        )

    def test_a_2xx_first_line_is_cut_at_200_characters(self) -> None:
        failure = failure_for(_answer(200, "w" * 250))

        assert failure.message == f"HTTP 200: the answer is not JSON: {'w' * 200}"


class TestEmptyBody:
    """`HTTP <status> <reason phrase> (no body)`."""

    def test_the_status_lines_reason_phrase(self) -> None:
        answer = _answer(413, reason="Request Entity Too Large")

        _assert_failure(
            failure_for(answer), "HTTP 413 Request Entity Too Large (no body)", "RequestFailed"
        )

    def test_a_reason_phrase_of_the_servers_own(self) -> None:
        answer = _answer(502, reason="Proxy Error")

        _assert_failure(failure_for(answer), "HTTP 502 Proxy Error (no body)", "RequestFailed")

    @pytest.mark.parametrize(
        ("status", "phrase"), [(404, "Not Found"), (503, "Service Unavailable")]
    )
    def test_the_standard_phrase_when_the_line_has_none(self, status: int, phrase: str) -> None:
        _assert_failure(
            failure_for(_answer(status)), f"HTTP {status} {phrase} (no body)", "RequestFailed"
        )

    def test_an_empty_401_is_auth_failed(self) -> None:
        _assert_failure(failure_for(_answer(401)), "HTTP 401 Unauthorized (no body)", "AuthFailed")


class TestOtherJson:
    """`HTTP <status>: <compact JSON, cut at 200 characters>`."""

    def test_an_array(self) -> None:
        _assert_failure(failure_for(_answer(500, [1, 2, 3])), "HTTP 500: [1,2,3]", "RequestFailed")

    def test_an_object_of_another_shape(self) -> None:
        answer = _answer(502, {"message": "upstream down", "code": 7})

        _assert_failure(
            failure_for(answer), 'HTTP 502: {"message":"upstream down","code":7}', "RequestFailed"
        )

    def test_a_json_string(self) -> None:
        _assert_failure(
            failure_for(_answer(504, '"gateway timeout"')),
            'HTTP 504: "gateway timeout"',
            "RequestFailed",
        )

    def test_a_401_is_auth_failed(self) -> None:
        _assert_failure(failure_for(_answer(401, ["denied"])), 'HTTP 401: ["denied"]', "AuthFailed")

    def test_the_compact_json_is_cut_at_200_characters(self) -> None:
        body = {"detail": "v" * 400}
        text = json.dumps(body, separators=(",", ":"))

        assert failure_for(_answer(500, body)).message == f"HTTP 500: {text[:200]}"


class TestForbidden:
    """A 403 security_exception marks the failure forbidden: these credentials may not do this."""

    def test_a_403_security_exception_is_forbidden(self) -> None:
        body = error_answer("security_exception", SECURITY_REASON, 403)

        assert failure_for(_answer(403, body)).forbidden is True

    @pytest.mark.parametrize(
        ("status", "body"),
        [
            (401, error_answer("security_exception", "missing authentication credentials", 401)),
            (403, error_answer("cluster_block_exception", "blocked by: [FORBIDDEN/8]", 403)),
            (403, {"error": "no permissions"}),
            (403, b""),
            (400, error_answer("parsing_exception", "unknown query [matchall]", 400)),
        ],
    )
    def test_every_other_failure_is_not_forbidden(self, status: int, body: Any) -> None:
        assert failure_for(_answer(status, body)).forbidden is False

    def test_a_failure_the_core_raises_itself_is_not_forbidden(self) -> None:
        assert OpenSearchFailure("Password needs a Username", "Validation").forbidden is False
