"""OpenSearch core pre-connect checks: reason Validation, before anything is sent.

Each check follows On error (OS-11); REQ-3.4.1.15, REQ-3.3.2.3, REQ-3.3.2.6, REQ-3.3.3.2.
"""

from collections.abc import Generator
from typing import Any

import pytest

from tests.connectivity.opensearch.fakes import enqueue_json, field_caps_answer
from tests.plugins.http.conftest import RecordingHTTPServer, _start_server
from tests.plugins.opensearch.conftest import (
    FixedClock,
    LogRecorder,
    exact,
    failed_line,
    os_context,
    os_params,
    outputs,
    recorded,
    served,
)
from wavecore.core.execution.plugin_executor import derive_parameter_metadata, resolve_parameters
from wavecore.core.expressions.errors import ExpressionTypeError
from wavecore.plugins import _opensearch_core
from wavecore.plugins.opensearch import OpenSearchPlugin

ON_ERROR = pytest.mark.parametrize("on_error", ["fail", "record"])

NOT_HTTP = "Cluster URL must start with http:// or https://"
NO_HOST = "Cluster URL needs a host, such as https://opensearch.internal:9200"
CREDENTIALS_IN_URL = (
    "Cluster URL must not hold a username or password: put them in Username and Password"
)
QUERY_OR_FRAGMENT = "Cluster URL must not hold a query (?...) or fragment (#...)"
PORT_OUT_OF_RANGE = "Cluster URL port must be between 1 and 65535"
MORE_THAN_ONE_SET = (
    "Set only one of Username and Password, API Key or Bearer Token: all three go in the one "
    "Authorization header"
)
PASSWORD_WITHOUT_USERNAME = "Password needs a Username"
NOT_A_JSON_OBJECT = 'Query DSL must be a JSON object, such as {"term": {"log.level": "ERROR"}}'
NO_STATS_ENTRY = "Stats needs at least one entry"
CUSTOM_ONE = '{"avg": {"field": "latency_ms"}}'


@pytest.fixture(scope="module")
def listener() -> Generator[RecordingHTTPServer, None, None]:
    """One scripted server per module, so its shutdown poll is paid once."""
    server = _start_server(RecordingHTTPServer(("127.0.0.1", 0)), "http")
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def cluster(listener: RecordingHTTPServer) -> RecordingHTTPServer:
    """The module's scripted server with no request recorded yet."""
    listener.requests.clear()
    return listener


def epoch_seconds(row: str, value: Any) -> str:
    """The epoch seconds refusal for From or To."""
    return (
        f"{row} {value} reads as epoch seconds; the row takes epoch milliseconds: "
        "for seconds, multiply by 1000"
    )


def not_a_time(row: str, shown: str) -> str:
    """The not-a-time refusal for From or To, with the value as shown."""
    return (
        f"{row} is not a time: '{shown}'. Use a timestamp such as 2026-09-25T10:42:05Z, "
        "epoch milliseconds, or relative time such as now-15m"
    )


def dql_error(line: int, column: int, text: str) -> str:
    return f"Query is not valid DQL at line {line}, column {column}: {text}"


def json_error(line: int, column: int, text: str) -> str:
    return f"Query is not valid JSON at line {line}, column {column}: {text}"


def dql_gave(kind: str) -> str:
    return f"Query is DQL, so the expression must give text; it gave {kind}"


def stat(**entry: Any) -> dict[str, Any]:
    """One Stats row in its literal form."""
    return {"value": entry}


def aggregate(*stats: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """Aggregate overrides with the given Stats rows."""
    return {"mode": "aggregate", "stats": list(stats), **overrides}


def refused(
    server: RecordingHTTPServer,
    log: LogRecorder,
    overrides: dict[str, Any],
    message: str,
    on_error: str,
) -> None:
    """The core refuses before sending anything: raised under Fail, recorded under Record."""
    params = served(server, **overrides, on_error=on_error)
    mode = params.get("mode", "search")
    if on_error == "fail":
        with pytest.raises(ValueError, match=exact(message)):
            _opensearch_core.run(params, log)
        assert list(log) == []
    else:
        out = outputs(_opensearch_core.run(params, log))
        assert out == recorded(message, "Validation")
        assert list(log) == [("WARN", failed_line(mode, message, "Validation"))]
    assert server.requests == []


def let_through(server: RecordingHTTPServer, log: LogRecorder, overrides: dict[str, Any]) -> None:
    """No pre-connect check fires: the field-list read goes out (it finds no index here)."""
    enqueue_json(server, field_caps_answer({}, []))
    out = outputs(_opensearch_core.run(served(server, **overrides), log))
    assert (out["success"], out["error"], out["reason"]) == (True, "", "")
    assert len(server.requests) == 1


URL_CASES = [
    pytest.param({"url": "ftp://{host}"}, NOT_HTTP, id="ftp"),
    pytest.param({"url": "ws://{host}"}, NOT_HTTP, id="ws"),
    pytest.param({"url": "{host}"}, NOT_HTTP, id="no-scheme"),
    pytest.param({"url": "opensearch.internal:9200"}, NOT_HTTP, id="host-and-port-only"),
    pytest.param({"url": "http://"}, NO_HOST, id="scheme-only"),
    pytest.param({"url": "https://:9200"}, NO_HOST, id="port-without-host"),
    pytest.param({"url": "http:///filebeat"}, NO_HOST, id="path-without-host"),
    pytest.param({"url": "http://wave:s3cr3t@{host}"}, CREDENTIALS_IN_URL, id="user-and-password"),
    pytest.param({"url": "http://wave@{host}"}, CREDENTIALS_IN_URL, id="user"),
    pytest.param({"url": "http://:s3cr3t@{host}"}, CREDENTIALS_IN_URL, id="password"),
    pytest.param({"url": "http://{host}/?pretty"}, QUERY_OR_FRAGMENT, id="query"),
    pytest.param({"url": "http://{host}#top"}, QUERY_OR_FRAGMENT, id="fragment"),
    pytest.param({"url": "http://{host}/os?x=1"}, QUERY_OR_FRAGMENT, id="query-after-a-prefix"),
    pytest.param({"url": "http://127.0.0.1:0"}, PORT_OUT_OF_RANGE, id="zero"),
    pytest.param({"url": "http://127.0.0.1:65536"}, PORT_OUT_OF_RANGE, id="past-65535"),
    pytest.param({"url": "https://opensearch.internal:99999"}, PORT_OUT_OF_RANGE, id="five-nines"),
    pytest.param({"url": "https://opensearch.internal:abc"}, PORT_OUT_OF_RANGE, id="not-a-number"),
]

AUTH_CASES = [
    pytest.param(
        {"username": "wave", "api_key": "os_key"}, MORE_THAN_ONE_SET, id="username-and-api-key"
    ),
    pytest.param(
        {"username": "wave", "password": "s3cr3t", "bearer_token": "eyJ.x.y"},
        MORE_THAN_ONE_SET,
        id="basic-and-bearer",
    ),
    pytest.param(
        {"api_key": "os_key", "bearer_token": "eyJ.x.y"}, MORE_THAN_ONE_SET, id="api-key-and-bearer"
    ),
    pytest.param(
        {"password": "s3cr3t", "api_key": "os_key"}, MORE_THAN_ONE_SET, id="password-and-api-key"
    ),
    pytest.param(
        {"username": "wave", "password": "s3cr3t", "api_key": "k", "bearer_token": "t"},
        MORE_THAN_ONE_SET,
        id="all-three",
    ),
    pytest.param({"password": "s3cr3t"}, PASSWORD_WITHOUT_USERNAME, id="password-alone"),
    pytest.param(
        {"password": "s3cr3t", "username": ""}, PASSWORD_WITHOUT_USERNAME, id="empty-username"
    ),
    pytest.param(
        {"password": "s3cr3t", "username": None}, PASSWORD_WITHOUT_USERNAME, id="none-username"
    ),
]

TIME_CASES = [
    pytest.param({"from": 1790332925}, epoch_seconds("From", 1790332925), id="from-10-digits"),
    pytest.param({"from": "1790332925"}, epoch_seconds("From", 1790332925), id="from-digit-text"),
    pytest.param({"from": 17903329250}, epoch_seconds("From", 17903329250), id="from-11-digits"),
    pytest.param({"to": 1790332925}, epoch_seconds("To", 1790332925), id="to-10-digits"),
    pytest.param({"to": "17903329250"}, epoch_seconds("To", 17903329250), id="to-11-digit-text"),
    pytest.param({"from": "yesterday"}, not_a_time("From", "yesterday"), id="from-a-word"),
    pytest.param({"to": "tomorrow"}, not_a_time("To", "tomorrow"), id="to-a-word"),
    pytest.param({"from": "now-15"}, not_a_time("From", "now-15"), id="math-without-unit"),
    pytest.param({"from": "now-15q"}, not_a_time("From", "now-15q"), id="unknown-unit"),
    pytest.param({"from": "2026-13-45"}, not_a_time("From", "2026-13-45"), id="no-such-date"),
    pytest.param(
        {"from": "x" * 60}, not_a_time("From", "x" * 50 + "..."), id="cut-at-50-characters"
    ),
    pytest.param({"to": "y" * 50}, not_a_time("To", "y" * 50), id="50-characters-uncut"),
]

QUERY_CASES = [
    pytest.param(
        {"query": "log.level:"},
        dql_error(1, 11, 'Expected "(", "{", value, whitespace but end of input found.'),
        id="dql-value-missing",
    ),
    pytest.param(
        {"query": "log.level: (ERROR"},
        dql_error(1, 18, 'Expected ")", AND, OR, whitespace but end of input found.'),
        id="dql-group-not-closed",
    ),
    pytest.param(
        {
            "query_language": "query_dsl",
            "query": '{"term": {"log.level": "ERROR"}\n    "boost": 1}',
        },
        json_error(2, 5, "Expected , or }"),
        id="json-member-without-comma",
    ),
    pytest.param(
        {"query_language": "query_dsl", "query": '{"term": }'},
        json_error(1, 10, "Expected a value"),
        id="json-value-missing",
    ),
    pytest.param(
        {"query_language": "query_dsl", "query": '["log.level"]'},
        NOT_A_JSON_OBJECT,
        id="json-array",
    ),
    pytest.param(
        {"query_language": "query_dsl", "query": "42"}, NOT_A_JSON_OBJECT, id="json-number"
    ),
    pytest.param(
        {"query_language": "query_dsl", "query": '"ERROR"'}, NOT_A_JSON_OBJECT, id="json-string"
    ),
    pytest.param(
        {"query": {"term": {"log.level": "ERROR"}}}, dql_gave("a map"), id="dql-given-a-map"
    ),
]

FIELDS_CASES = [
    pytest.param(
        {"fields": [{"value": "@timestamp"}, {"value": ""}]},
        "Fields entry 2 is empty: give a field name or remove the entry",
        id="empty",
    ),
    pytest.param(
        {"fields": [{"value": "@timestamp"}, {"value": "   "}]},
        "Fields entry 2 is empty: give a field name or remove the entry",
        id="spaces",
    ),
    pytest.param(
        {"fields": [{"value": "@timestamp"}, {"value": None}]},
        "Fields entry 2 is empty: give a field name or remove the entry",
        id="none-from-an-entry-expression",
    ),
    pytest.param(
        {"fields": [{"value": ""}, {"value": "message"}]},
        "Fields entry 1 is empty: give a field name or remove the entry",
        id="first-entry",
    ),
    pytest.param(
        {"fields": ["@timestamp", ""]},
        "Fields entry 2 is empty: give a field name or remove the entry",
        id="names-from-the-row-expression",
    ),
    pytest.param(
        {"fields": ["@timestamp", None]},
        "Fields entry 2 is empty: give a field name or remove the entry",
        id="null-from-the-row-expression",
    ),
    pytest.param(
        {"fields": [{"value": "@timestamp"}, {"value": {"name": "message"}}]},
        "Fields entry 2 must be a field name; it is a map",
        id="map",
    ),
]

STATS_CASES = [
    pytest.param(aggregate(), NO_STATS_ENTRY, id="no-entry"),
    pytest.param(
        aggregate(stat(stat="count"), {"value": "count"}),
        'Stat 2 must be a map with a stat, such as {"stat": "count"}; it is a string',
        id="text-row",
    ),
    pytest.param(
        {"mode": "aggregate", "stats": [{"stat": "count"}, "count"]},
        'Stat 2 must be a map with a stat, such as {"stat": "count"}; it is a string',
        id="text-from-the-row-expression",
    ),
    pytest.param(
        aggregate(stat(stat="count"), {"value": None}),
        'Stat 2 must be a map with a stat, such as {"stat": "count"}; it is null',
        id="null-row",
    ),
    pytest.param(
        {"mode": "aggregate", "stats": [{"stat": "count"}, None]},
        'Stat 2 must be a map with a stat, such as {"stat": "count"}; it is null',
        id="null-from-the-row-expression",
    ),
    pytest.param(
        aggregate(stat(stat="count"), stat(stat="median", field="latency_ms")),
        "Stat 2: 'median' is not a stat. Use count, sum, average, min, max, percentile, "
        "unique_count, increase or custom",
        id="median",
    ),
    pytest.param(
        aggregate(stat(stat="avg", field="latency_ms")),
        "Stat 1: 'avg' is not a stat. Use count, sum, average, min, max, percentile, "
        "unique_count, increase or custom",
        id="an-opensearch-name-is-not-a-stat",
    ),
    pytest.param(
        aggregate(stat(stat="count"), stat(stat="sum")),
        "Stat 2 (Sum) needs a Field",
        id="sum-without-a-field",
    ),
    pytest.param(
        {"mode": "aggregate", "stats": [{"stat": "count"}, {"stat": "sum", "field": ""}]},
        "Stat 2 (Sum) needs a Field",
        id="empty-field-from-the-row-expression",
    ),
    pytest.param(
        aggregate(stat(stat="count"), stat(stat="percentile", field="latency_ms")),
        "Stat 2 (Percentile) needs a Percent from 0 to 100",
        id="no-percent",
    ),
    pytest.param(
        aggregate(stat(stat="custom", json="")),
        "Stat 1 (Custom (JSON)) needs its aggregation JSON",
        id="empty-json",
    ),
    pytest.param(
        aggregate(stat(stat="count"), stat(stat="custom", json='{"avg": }')),
        "Stat 2 (Custom (JSON)) is not valid JSON at line 1, column 9: Expected a value",
        id="json-that-does-not-parse",
    ),
    pytest.param(
        aggregate(stat(stat="count"), stat(stat="custom", json='["avg"]')),
        'Stat 2 (Custom (JSON)) must be one aggregation, such as {"avg": {"field": "latency_ms"}}',
        id="not-an-object",
    ),
    pytest.param(
        aggregate(stat(stat="count"), stat(stat="sum", field="bytes"), stat(stat="count")),
        "Stats 1 and 3 both make the column 'count'; each stat needs its own column",
        id="two-stats-make-one-column",
    ),
    pytest.param(
        aggregate(stat(stat="count"), stat(stat="custom", json=CUSTOM_ONE, name="@timestamp")),
        "Stat 2 makes the column '@timestamp', which the grouping already uses",
        id="a-column-the-grouping-uses",
    ),
]


class TestUrlChecks:
    """A Cluster URL that cannot make a request is refused before any connection."""

    @ON_ERROR
    @pytest.mark.parametrize(("overrides", "message"), URL_CASES)
    def test_refused(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)

    @ON_ERROR
    def test_aggregate_names_its_own_action(
        self, cluster: RecordingHTTPServer, log: LogRecorder, on_error: str
    ) -> None:
        overrides = aggregate(stat(stat="count"), url="ftp://{host}")

        refused(cluster, log, overrides, NOT_HTTP, on_error)

    @pytest.mark.parametrize(
        "url",
        ["http://{host}", "http://{host}/", "http://{host}/os/", "http://{host}/os"],
        ids=["bare", "trailing-slash", "prefix-with-slash", "prefix"],
    )
    def test_accepted(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        clock: FixedClock,
        deadline: Any,
        url: str,
    ) -> None:
        let_through(cluster, log, {"url": url})


class TestAuthenticationChecks:
    """One credential set at most, and a Password needs a Username."""

    @ON_ERROR
    @pytest.mark.parametrize(("overrides", "message"), AUTH_CASES)
    def test_refused(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)

    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({}, id="none"),
            pytest.param({"username": "wave"}, id="username-alone"),
            pytest.param({"username": "wave", "password": ""}, id="username-empty-password"),
            pytest.param({"username": "wave", "password": "s3cr3t"}, id="username-and-password"),
            pytest.param({"api_key": "os_key"}, id="api-key"),
            pytest.param({"bearer_token": "eyJ.x.y"}, id="bearer-token"),
            pytest.param(
                {"api_key": "os_key", "username": "", "password": "", "bearer_token": None},
                id="blank-rows-are-not-set",
            ),
        ],
    )
    def test_accepted(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        clock: FixedClock,
        deadline: Any,
        overrides: dict[str, Any],
    ) -> None:
        let_through(cluster, log, overrides)


class TestTimeChecks:
    """From and To are a timestamp, epoch milliseconds or now date math (REQ-3.3.2.3)."""

    @ON_ERROR
    @pytest.mark.parametrize(("overrides", "message"), TIME_CASES)
    def test_refused(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)

    @ON_ERROR
    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            pytest.param({"from": 1.5}, not_a_time("From", "1.5"), id="from-a-float"),
            pytest.param({"from": True}, not_a_time("From", "True"), id="from-a-boolean"),
            pytest.param({"to": False}, not_a_time("To", "False"), id="to-a-boolean"),
        ],
    )
    def test_a_value_neither_text_nor_integer_at_core_level(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)

    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"from": 1790332925000}, id="epoch-milliseconds"),
            pytest.param({"from": "1790332925000"}, id="epoch-millisecond-digits"),
            pytest.param({"from": 179033292500}, id="12-digits"),
            pytest.param({"from": 179033292}, id="9-digits"),
            pytest.param({"from": "2026-09-25T10:00:00Z"}, id="iso-utc"),
            pytest.param({"from": "2026-09-25T10:00:00.123+02:00"}, id="iso-with-offset"),
            pytest.param({"from": "2026-09-25 10:00:00"}, id="iso-with-a-space"),
            pytest.param({"from": "2026-09-25"}, id="iso-date"),
            pytest.param({"from": "now-1d/d", "to": "now/d"}, id="date-math-rounded"),
            pytest.param({"from": "now-15m/m", "to": "now+2d"}, id="date-math-steps"),
            pytest.param({"from": "", "to": ""}, id="blank-is-the-default-window"),
            pytest.param({"from": None, "to": None}, id="none-is-the-default-window"),
        ],
    )
    def test_accepted(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        clock: FixedClock,
        deadline: Any,
        overrides: dict[str, Any],
    ) -> None:
        let_through(cluster, log, overrides)


class TestQueryChecks:
    """The Query parses in its language (REQ-3.3.2.6)."""

    @ON_ERROR
    @pytest.mark.parametrize(("overrides", "message"), QUERY_CASES)
    def test_refused(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)

    @ON_ERROR
    @pytest.mark.parametrize(
        ("value", "kind"),
        [
            pytest.param(["ERROR"], "an array", id="array"),
            pytest.param(5, "an integer", id="integer"),
            pytest.param(1.5, "a float", id="float"),
            pytest.param(True, "a boolean", id="boolean"),
        ],
    )
    def test_dql_given_another_type_at_core_level(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        value: Any,
        kind: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, {"query": value}, dql_gave(kind), on_error)

    @ON_ERROR
    def test_aggregate_query_is_checked_too(
        self, cluster: RecordingHTTPServer, log: LogRecorder, on_error: str
    ) -> None:
        overrides = aggregate(stat(stat="count"), query="log.level:")
        message = dql_error(1, 11, 'Expected "(", "{", value, whitespace but end of input found.')

        refused(cluster, log, overrides, message, on_error)

    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"query": "log.level: ERROR"}, id="dql"),
            pytest.param({"query": ""}, id="dql-empty"),
            pytest.param({"query": "   "}, id="dql-spaces"),
            pytest.param({"query": None}, id="dql-none"),
            pytest.param({"query": {}}, id="dql-empty-map-is-no-filter"),
            pytest.param(
                {"query_language": "query_dsl", "query": '{"term": {"log.level": "ERROR"}}'},
                id="query-dsl-text",
            ),
            pytest.param(
                {"query_language": "query_dsl", "query": {"term": {"log.level": "ERROR"}}},
                id="query-dsl-map",
            ),
            pytest.param({"query_language": "query_dsl", "query": ""}, id="query-dsl-empty"),
            pytest.param({"query_language": "query_dsl", "query": "  "}, id="query-dsl-spaces"),
            pytest.param({"query_language": "query_dsl", "query": {}}, id="query-dsl-empty-map"),
            pytest.param(
                {"query_language": "query_dsl", "query": '// errors only\n{"match_all": {}}'},
                id="query-dsl-with-a-comment",
            ),
        ],
    )
    def test_accepted(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        clock: FixedClock,
        deadline: Any,
        overrides: dict[str, Any],
    ) -> None:
        let_through(cluster, log, overrides)


class TestFieldsChecks:
    """Every Fields entry names a field in Search."""

    @ON_ERROR
    @pytest.mark.parametrize(("overrides", "message"), FIELDS_CASES)
    def test_refused(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)

    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"fields": []}, id="empty-is-the-whole-document"),
            pytest.param({"fields": None}, id="none-is-the-default"),
            pytest.param({"fields": [{"value": "@timestamp"}, {"value": "message"}]}, id="rows"),
            pytest.param({"fields": ["@timestamp", "message"]}, id="names"),
            pytest.param(
                {"mode": "aggregate", "fields": [{"value": ""}, {"value": {"a": 1}}]},
                id="hidden-in-aggregate",
            ),
        ],
    )
    def test_accepted(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        clock: FixedClock,
        deadline: Any,
        overrides: dict[str, Any],
    ) -> None:
        let_through(cluster, log, overrides)


class TestStatsChecks:
    """Every Stats entry makes one named column in Aggregate (REQ-3.3.3.2)."""

    @ON_ERROR
    @pytest.mark.parametrize(("overrides", "message"), STATS_CASES)
    def test_refused(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)

    @ON_ERROR
    @pytest.mark.parametrize(
        ("name", "label"),
        [
            ("sum", "Sum"),
            ("average", "Average"),
            ("min", "Min"),
            ("max", "Max"),
            ("percentile", "Percentile"),
            ("unique_count", "Unique count"),
            ("increase", "Increase"),
        ],
    )
    @pytest.mark.parametrize("field", [None, "", "   "], ids=["absent", "empty", "spaces"])
    def test_a_stat_without_its_field(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        name: str,
        label: str,
        field: str | None,
        on_error: str,
    ) -> None:
        entry: dict[str, Any] = {"stat": name}
        if name == "percentile":
            entry["percent"] = 95
        if field is not None:
            entry["field"] = field
        overrides = aggregate(stat(stat="count"), {"value": entry})

        refused(cluster, log, overrides, f"Stat 2 ({label}) needs a Field", on_error)

    @ON_ERROR
    @pytest.mark.parametrize(
        "percent",
        [None, "", "abc", -1, 100.5, 101, "101"],
        ids=["absent", "empty", "text", "below-zero", "past-100", "101", "101-text"],
    )
    def test_a_percentile_without_a_percent_from_0_to_100(
        self, cluster: RecordingHTTPServer, log: LogRecorder, percent: Any, on_error: str
    ) -> None:
        entry: dict[str, Any] = {"stat": "percentile", "field": "latency_ms"}
        if percent is not None:
            entry["percent"] = percent
        overrides = aggregate(stat(stat="count"), {"value": entry})

        refused(
            cluster, log, overrides, "Stat 2 (Percentile) needs a Percent from 0 to 100", on_error
        )

    @ON_ERROR
    @pytest.mark.parametrize("json_text", [None, "", "   "], ids=["absent", "empty", "spaces"])
    def test_a_custom_stat_without_its_json(
        self, cluster: RecordingHTTPServer, log: LogRecorder, json_text: str | None, on_error: str
    ) -> None:
        entry: dict[str, Any] = {"stat": "custom", "name": "p50"}
        if json_text is not None:
            entry["json"] = json_text
        overrides = aggregate(stat(stat="count"), {"value": entry})

        refused(
            cluster, log, overrides, "Stat 2 (Custom (JSON)) needs its aggregation JSON", on_error
        )

    @ON_ERROR
    @pytest.mark.parametrize(
        "json_text",
        [
            '"avg"',
            "42",
            "{}",
            '{"meta": {"unit": "ms"}}',
            '{"avg": {"field": "a"}, "max": {"field": "b"}}',
        ],
        ids=["string", "number", "empty-object", "meta-only", "two-aggregations"],
    )
    def test_a_custom_stat_that_is_not_one_aggregation(
        self, cluster: RecordingHTTPServer, log: LogRecorder, json_text: str, on_error: str
    ) -> None:
        overrides = aggregate(stat(stat="count"), stat(stat="custom", json=json_text))
        message = (
            'Stat 2 (Custom (JSON)) must be one aggregation, such as {"avg": {"field": '
            '"latency_ms"}}'
        )

        refused(cluster, log, overrides, message, on_error)

    @ON_ERROR
    @pytest.mark.parametrize(
        ("stats", "message"),
        [
            pytest.param(
                [stat(stat="count"), stat(stat="count"), stat(stat="count")],
                "Stats 1 and 2 both make the column 'count'; each stat needs its own column",
                id="the-first-pair-is-named",
            ),
            pytest.param(
                [
                    stat(stat="percentile", field="latency_ms", percent=95),
                    stat(stat="percentile", field="latency_ms", percent="95"),
                ],
                "Stats 1 and 2 both make the column 'percentile 95 of latency_ms'; "
                "each stat needs its own column",
                id="percent-as-text",
            ),
            pytest.param(
                [
                    stat(stat="percentile", field="latency_ms", percent=95),
                    stat(stat="percentile", field="latency_ms", percent=95.0),
                ],
                "Stats 1 and 2 both make the column 'percentile 95 of latency_ms'; "
                "each stat needs its own column",
                id="an-integral-percent-is-written-as-an-integer",
            ),
            pytest.param(
                [
                    stat(stat="sum", field="bytes"),
                    stat(stat="custom", json=CUSTOM_ONE, name="sum of bytes"),
                ],
                "Stats 1 and 2 both make the column 'sum of bytes'; each stat needs its own column",
                id="a-custom-name-meets-a-stat",
            ),
            pytest.param(
                [
                    stat(stat="custom", json=CUSTOM_ONE),
                    stat(stat="custom", json=CUSTOM_ONE, name="custom 1"),
                ],
                "Stats 1 and 2 both make the column 'custom 1'; each stat needs its own column",
                id="a-blank-custom-name-is-custom-and-its-position",
            ),
        ],
    )
    def test_two_stats_make_the_same_column(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        stats: list[dict[str, Any]],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, aggregate(*stats), message, on_error)

    @ON_ERROR
    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            pytest.param(
                aggregate(
                    stat(stat="count"),
                    stat(stat="custom", json=CUSTOM_ONE, name="event.created"),
                    time_field="event.created",
                    group_by_time="5m",
                ),
                "Stat 2 makes the column 'event.created', which the grouping already uses",
                id="the-time-field",
            ),
            pytest.param(
                aggregate(
                    stat(stat="count"),
                    stat(stat="custom", json=CUSTOM_ONE, name="@timestamp"),
                    time_field="",
                ),
                "Stat 2 makes the column '@timestamp', which the grouping already uses",
                id="a-blank-time-field-is-timestamp",
            ),
            pytest.param(
                aggregate(
                    stat(stat="custom", json=CUSTOM_ONE, name="service.name"),
                    group_by_time="none",
                    group_by_field="service.name",
                ),
                "Stat 1 makes the column 'service.name', which the grouping already uses",
                id="the-group-by-field",
            ),
            pytest.param(
                aggregate(stat(stat="count"), group_by_field="count"),
                "Stat 1 makes the column 'count', which the grouping already uses",
                id="a-field-named-count",
            ),
        ],
    )
    def test_a_stat_column_the_grouping_uses(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)

    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"mode": "aggregate"}, id="the-default-count"),
            pytest.param({"mode": "aggregate", "stats": None}, id="none-is-the-default-count"),
            pytest.param(
                aggregate(
                    stat(stat="count"),
                    stat(stat="sum", field="bytes"),
                    stat(stat="average", field="bytes"),
                    stat(stat="min", field="latency_ms"),
                    stat(stat="max", field="latency_ms"),
                    stat(stat="percentile", field="latency_ms", percent=95),
                    stat(stat="percentile", field="latency_ms", percent="99.9"),
                    stat(stat="unique_count", field="user.id"),
                    stat(stat="increase", field="requests_total"),
                    stat(stat="custom", json=CUSTOM_ONE),
                    stat(stat="custom", json=CUSTOM_ONE),
                ),
                id="every-stat-in-its-own-column",
            ),
            pytest.param(
                aggregate(
                    stat(stat="percentile", field="latency_ms", percent=0),
                    stat(stat="percentile", field="bytes", percent=100),
                ),
                id="percent-bounds",
            ),
            pytest.param(
                aggregate(
                    stat(
                        stat="custom",
                        json='{"avg": {"field": "latency_ms"}, "meta": {"unit": "ms"}}',
                    ),
                    stat(
                        stat="custom",
                        json='{"terms": {"field": "x"}, "aggs": {"m": {"max": {"field": "y"}}}}',
                    ),
                    stat(
                        stat="custom",
                        json='{"terms": {"field": "x"}, "aggregations": {"m": {"min": {}}}}',
                    ),
                ),
                id="custom-with-meta-aggs-or-aggregations",
            ),
            pytest.param(
                aggregate(
                    stat(stat="custom", json=CUSTOM_ONE, name="@timestamp"),
                    group_by_time="none",
                ),
                id="the-time-field-name-when-not-grouped-by-time",
            ),
            pytest.param(
                {"mode": "aggregate", "stats": [{"stat": "count"}, {"stat": "max", "field": "x"}]},
                id="stat-maps-from-the-row-expression",
            ),
            pytest.param({"stats": []}, id="hidden-in-search"),
        ],
    )
    def test_accepted(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        clock: FixedClock,
        deadline: Any,
        overrides: dict[str, Any],
    ) -> None:
        let_through(cluster, log, overrides)


class TestCheckOrder:
    """With two faults the earlier check names the message."""

    @ON_ERROR
    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            pytest.param(
                {"url": "ftp://{host}", "username": "u", "api_key": "k"},
                NOT_HTTP,
                id="scheme-before-one-set",
            ),
            pytest.param({"url": "https://:0"}, NO_HOST, id="host-before-port"),
            pytest.param(
                {"url": "http://wave@{host}/?pretty"},
                CREDENTIALS_IN_URL,
                id="url-credentials-before-query",
            ),
            pytest.param(
                {"url": "http://wave:s3cr3t@127.0.0.1:99999"},
                CREDENTIALS_IN_URL,
                id="url-credentials-before-port",
            ),
            pytest.param(
                {"url": "http://127.0.0.1:0/?pretty"},
                QUERY_OR_FRAGMENT,
                id="query-string-before-port",
            ),
            pytest.param(
                {"url": "http://127.0.0.1:0", "password": "s3cr3t"},
                PORT_OUT_OF_RANGE,
                id="port-before-password-alone",
            ),
            pytest.param(
                {"password": "s3cr3t", "from": 1790332925},
                PASSWORD_WITHOUT_USERNAME,
                id="password-alone-before-epoch-seconds",
            ),
            pytest.param(
                {"from": 1790332925, "to": 1790332926},
                epoch_seconds("From", 1790332925),
                id="epoch-seconds-from-before-to",
            ),
            pytest.param(
                {"from": "yesterday", "to": "tomorrow"},
                not_a_time("From", "yesterday"),
                id="not-a-time-from-before-to",
            ),
            pytest.param(
                {"from": 1790332925, "query": "log.level:"},
                epoch_seconds("From", 1790332925),
                id="epoch-seconds-before-dql",
            ),
            pytest.param(
                {"to": "tomorrow", "query": "log.level:"},
                not_a_time("To", "tomorrow"),
                id="not-a-time-before-dql",
            ),
            pytest.param(
                {"query": "log.level:", "fields": [{"value": ""}]},
                dql_error(1, 11, 'Expected "(", "{", value, whitespace but end of input found.'),
                id="dql-before-fields",
            ),
            pytest.param(
                aggregate(query_language="query_dsl", query="[]"),
                NOT_A_JSON_OBJECT,
                id="query-dsl-before-stats",
            ),
            pytest.param(
                aggregate(
                    stat(stat="custom", json=CUSTOM_ONE, name="@timestamp"),
                    stat(stat="custom", json=CUSTOM_ONE, name="@timestamp"),
                ),
                "Stats 1 and 2 both make the column '@timestamp'; each stat needs its own column",
                id="shared-column-before-grouping-column",
            ),
        ],
    )
    def test_the_earlier_check_wins(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
        on_error: str,
    ) -> None:
        refused(cluster, log, overrides, message, on_error)


class TestThroughExecute:
    """The plugin path: prepare() passes a URL it cannot parse through for the core to refuse."""

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            pytest.param({"url": "ftp://{host}"}, NOT_HTTP, id="ftp"),
            pytest.param(
                {"url": "https://opensearch.internal:abc"}, PORT_OUT_OF_RANGE, id="not-a-number"
            ),
            pytest.param({"url": "http://127.0.0.1:99999"}, PORT_OUT_OF_RANGE, id="past-65535"),
            pytest.param(
                {"username": "wave", "api_key": "os_key"},
                MORE_THAN_ONE_SET,
                id="username-and-api-key",
            ),
        ],
    )
    async def test_fail_raises(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
    ) -> None:
        params = served(cluster, **overrides)

        with pytest.raises(ValueError, match=exact(message)):
            await OpenSearchPlugin().execute(os_context(params, log))

        assert list(log) == []
        assert cluster.requests == []

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            pytest.param(
                {"url": "https://opensearch.internal:abc"}, PORT_OUT_OF_RANGE, id="not-a-number"
            ),
            pytest.param({"password": "s3cr3t"}, PASSWORD_WITHOUT_USERNAME, id="password-alone"),
            pytest.param(aggregate(), NO_STATS_ENTRY, id="no-stats-entry"),
        ],
    )
    async def test_record_returns_the_failed_outputs(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        message: str,
    ) -> None:
        params = served(cluster, **overrides, on_error="record")
        mode = params.get("mode", "search")

        out = await OpenSearchPlugin().execute(os_context(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        assert out["total_results"] == 0
        assert (len(out["results"]), out["results"].col_count()) == (0, 0)
        assert list(log) == [("WARN", failed_line(mode, message, "Validation"))]
        assert cluster.requests == []


class TestResolverRefusesFirst:
    """An expression of a type the row does not declare fails before the core, with no Reason."""

    @pytest.mark.parametrize(
        ("name", "value", "message"),
        [
            pytest.param(
                "query",
                ["ERROR"],
                "Parameter 'query' expects string/map, got list",
                id="query-list",
            ),
            pytest.param(
                "query", 5, "Parameter 'query' expects string/map, got int", id="query-int"
            ),
            pytest.param(
                "query", 1.5, "Parameter 'query' expects string/map, got float", id="query-float"
            ),
            pytest.param(
                "query", True, "Parameter 'query' expects string/map, got bool", id="query-bool"
            ),
            pytest.param(
                "from", 1.5, "Parameter 'from' expects string/integer, got float", id="from-float"
            ),
            pytest.param(
                "from", True, "Parameter 'from' expects string/integer, got bool", id="from-bool"
            ),
            pytest.param(
                "from",
                {"a": 1},
                "Parameter 'from' expects string/integer, got dict",
                id="from-dict",
            ),
            pytest.param(
                "from", ["now"], "Parameter 'from' expects string/integer, got list", id="from-list"
            ),
            pytest.param(
                "to", 1.5, "Parameter 'to' expects string/integer, got float", id="to-float"
            ),
        ],
    )
    def test_refused_whatever_on_error_says(self, name: str, value: Any, message: str) -> None:
        types, trim, _references, _wire = derive_parameter_metadata(
            OpenSearchPlugin().metadata["parameters"]
        )
        params = {**os_params(on_error="record"), name: "picked"}

        with pytest.raises(ExpressionTypeError, match=exact(message)):
            resolve_parameters(params, {name}, {"picked": value}, types, trim_fields=trim)

    @pytest.mark.parametrize(
        ("name", "value"),
        [
            pytest.param("query", "log.level: ERROR", id="query-text"),
            pytest.param("query", {"term": {"log.level": "ERROR"}}, id="query-map"),
            pytest.param("from", "now-1h", id="from-text"),
            pytest.param("from", 1790332925000, id="from-epoch-milliseconds"),
        ],
    )
    def test_the_declared_types_pass(self, name: str, value: Any) -> None:
        types, trim, _references, _wire = derive_parameter_metadata(
            OpenSearchPlugin().metadata["parameters"]
        )
        params = {**os_params(on_error="record"), name: "picked"}

        resolved = resolve_parameters(params, {name}, {"picked": value}, types, trim_fields=trim)

        assert resolved[name] == value
