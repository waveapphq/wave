"""Every run checks the index pattern and every named field against the field list (OS-9).

No index match, an unknown field or partial shard results end amber; a Time field that is not a date
fails with reason Validation; the Max results, Top values and window WARNs stay green.
REQ-3.4.1.15, REQ-3.3.2.5, REQ-3.3.2.6, REQ-3.3.3.1, REQ-3.3.3.2.
"""

import functools
import json
from collections.abc import Generator
from typing import Any

import pytest

from tests.connectivity.opensearch.fakes import (
    enqueue_json,
    field_caps_answer,
    hit,
    search_answer,
    sent_json,
    serve,
    stop,
)
from tests.plugins.http.conftest import RecordingHTTPServer
from tests.plugins.opensearch.conftest import (
    FIELD_TYPES,
    FakeTimer,
    FixedClock,
    LogRecorder,
    columns,
    exact,
    failed_line,
    os_context,
    outputs,
    recorded,
    rows,
    served,
    timed,
)
from wavecore.plugins import _opensearch_core
from wavecore.plugins.opensearch import OpenSearchPlugin

FIELD_CAPS = "/filebeat-%2A/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true"
SEARCH = "/filebeat-%2A/_search"
INDICES = ["filebeat-2026.09.25"]
NOW_MS = 1790332925123
FROM_MS = 1790332025123
WINDOW = "from 2026-09-25T10:27:05.123Z to 2026-09-25T10:42:05.123Z"
AGG_WINDOW = {"from": "2026-09-25T10:00:00.000Z", "to": "2026-09-25T10:02:59.999Z"}
AGG_WINDOW_TEXT = "from 2026-09-25T10:00:00.000Z to 2026-09-25T10:02:59.999Z"
FIELDS: dict[str, str | list[str]] = {**FIELD_TYPES, "bytes": "long", "user.id": "keyword"}
NO_INDEX = "Index pattern filebeat-* matches no index"
TIME_FIELD_NOT_DATE = "Time field log.level is not a date field in filebeat-*: it is keyword"
SHARD_FAILURE = {
    "shard": 0,
    "index": "filebeat-2026.09.25",
    "node": "node-1",
    "reason": {
        "type": "query_shard_exception",
        "reason": 'failed to create query: For input string: "abc"',
    },
}
SHARDS_FAILED = (
    "Partial results: 1 of 2 shards failed. First failure: query_shard_exception: "
    'failed to create query: For input string: "abc"'
)
TIMED_OUT = "Partial results: the search timed out on the cluster"
PAGE = 10000
ONE_LINE = [hit("a1", {"@timestamp": "2026-09-25T10:40:01.120Z"}, sort=[1790332801120, "a1"])]


@pytest.fixture(scope="module")
def listener() -> Generator[RecordingHTTPServer, None, None]:
    """One scripted cluster per module, so its shutdown is paid once."""
    server = serve()
    yield server
    stop(server)


@pytest.fixture
def cluster(listener: RecordingHTTPServer) -> RecordingHTTPServer:
    """The module's scripted cluster with no request recorded and no answer queued."""
    listener.requests.clear()
    listener._responses.clear()
    return listener


@pytest.fixture(autouse=True)
def fixed_now(clock: FixedClock, deadline: type[FakeTimer]) -> FixedClock:
    """Every run reads FIXED_NOW and arms a fake deadline timer."""
    return clock


def unknown(name: str) -> str:
    return f"Field {name} is not in the field list of filebeat-*"


def entries(*names: str) -> list[dict[str, str]]:
    return [{"value": name} for name in names]


def stat(**entry: Any) -> dict[str, Any]:
    return {"value": entry}


def aggregate(*stats: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """Aggregate overrides on the three-minute window, with the given Stats rows."""
    return {
        "mode": "aggregate",
        "stats": list(stats) or [stat(stat="count")],
        **AGG_WINDOW,
        **overrides,
    }


def answered(
    server: RecordingHTTPServer, *answers: dict[str, Any], fields: dict[str, Any] | None = None
) -> None:
    """Queue the field list (one matching index), then each answer."""
    enqueue_json(server, field_caps_answer(fields or FIELDS, INDICES))
    for answer in answers:
        enqueue_json(server, answer)


def no_index(server: RecordingHTTPServer) -> None:
    """The field list of a pattern that matches no index."""
    enqueue_json(server, field_caps_answer({}, [], metadata=False))


def aggregated(total: int = 0, **answer: Any) -> dict[str, Any]:
    """An aggregation answer grouped by time with no slots."""
    return search_answer([], total, aggregations={"time": {"buckets": []}}, **answer)


def run(server: RecordingHTTPServer, log: LogRecorder, **overrides: Any) -> dict[str, Any]:
    return outputs(_opensearch_core.run(served(server, **overrides), log))


def requested(server: RecordingHTTPServer) -> list[tuple[str, str]]:
    return [(record["method"], record["path"]) for record in server.requests]


def console(log: LogRecorder) -> list[tuple[str, str]]:
    """Every line but the DEBUG request lines, each measured duration as N."""
    return [(level, timed([line])[0]) for level, line in log if level != "DEBUG"]


def warnings(log: LogRecorder) -> list[str]:
    return log.at("WARN")


def amber(out: dict[str, Any]) -> bool:
    """Whether the outputs ask for the amber block status."""
    flag = out.get("__block_warning", False)
    assert flag in (True, False)
    return bool(flag)


def passed(out: dict[str, Any], total: int) -> None:
    assert (out["total_results"], out["success"], out["error"], out["reason"]) == (
        total,
        True,
        "",
        "",
    )


@functools.cache
def full_partial_page() -> bytes:
    """A first page of 10,000 hits with one failed shard."""
    hits = [hit(f"d{n}", {"@timestamp": "x"}, sort=[NOW_MS - n, f"d{n}"]) for n in range(PAGE)]
    answer = search_answer(hits, 10003, failed=1, shard_failures=[SHARD_FAILURE])
    return json.dumps(answer).encode()


class TestNoIndexMatch:
    """No index behind the pattern: WARN, no search sent, empty Results, amber."""

    def test_search_ends_amber_with_the_fields_as_columns(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        no_index(cluster)

        out = run(cluster, log, fields=entries("@timestamp", "log.level", "message"))

        assert requested(cluster) == [("GET", FIELD_CAPS)]
        assert columns(out["results"]) == [
            ("@timestamp", "string"),
            ("log.level", "string"),
            ("message", "string"),
        ]
        assert rows(out["results"]) == []
        passed(out, 0)
        assert amber(out) is True
        assert console(log) == [
            ("WARN", NO_INDEX),
            ("INFO", f"Search filebeat-* {WINDOW}: 0 results, 0 kept, N s"),
        ]
        assert log.at("DEBUG") == [f"GET {FIELD_CAPS}"]

    def test_no_field_is_checked_against_an_empty_list(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        no_index(cluster)

        run(
            cluster,
            log,
            query="log.invalid: ERROR",
            fields=entries("invalid_field"),
            sort_by="latency",
        )

        assert warnings(log) == [NO_INDEX]

    def test_aggregate_ends_amber_with_its_grouping_and_stat_columns(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        no_index(cluster)

        out = run(
            cluster,
            log,
            **aggregate(
                stat(stat="count"),
                stat(stat="average", field="latency_ms"),
                group_by_field="service.name",
            ),
        )

        assert requested(cluster) == [("GET", FIELD_CAPS)]
        assert [name for name, _kind in columns(out["results"])] == [
            "@timestamp",
            "service.name",
            "count",
            "average of latency_ms",
        ]
        assert rows(out["results"]) == []
        passed(out, 0)
        assert amber(out) is True
        assert console(log) == [
            ("WARN", NO_INDEX),
            ("INFO", f"Aggregate filebeat-* {AGG_WINDOW_TEXT}: 0 results, 0 rows, N s"),
        ]

    async def test_through_execute_the_amber_flag_reaches_the_engine(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        no_index(cluster)

        out = await OpenSearchPlugin().execute(os_context(served(cluster), log))

        assert (out["success"], out["total_results"], out["__block_warning"]) == (True, 0, True)
        assert (len(out["results"]), out["results"].col_names()) == (0, ["@timestamp"])
        assert log.at("WARN") == [NO_INDEX]


class TestTimeFieldNotADate:
    """A Time field the field list holds with no date type fails with reason Validation."""

    def test_fail_raises_and_no_search_is_sent(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)

        with pytest.raises(ValueError, match=exact(TIME_FIELD_NOT_DATE)):
            _opensearch_core.run(served(cluster, time_field="log.level"), log)

        assert requested(cluster) == [("GET", FIELD_CAPS)]
        assert console(log) == []

    def test_record_returns_the_failed_outputs(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)

        out = run(cluster, log, time_field="log.level", on_error="record")

        assert out == recorded(TIME_FIELD_NOT_DATE, "Validation")
        assert console(log) == [("WARN", failed_line("search", TIME_FIELD_NOT_DATE, "Validation"))]
        assert len(cluster.requests) == 1

    def test_aggregate_names_its_own_action(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)

        out = run(cluster, log, **aggregate(time_field="log.level", on_error="record"))

        assert out == recorded(TIME_FIELD_NOT_DATE, "Validation")
        assert console(log) == [
            ("WARN", failed_line("aggregate", TIME_FIELD_NOT_DATE, "Validation"))
        ]

    @pytest.mark.parametrize(
        ("field", "kinds", "said"),
        [
            pytest.param("message", "text", "text", id="text"),
            pytest.param("latency_ms", "long", "long", id="number"),
            pytest.param("log.level", ["keyword", "text"], "keyword and text", id="two-types"),
        ],
    )
    def test_every_type_is_named(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        field: str,
        kinds: str | list[str],
        said: str,
    ) -> None:
        enqueue_json(
            cluster,
            field_caps_answer({**FIELD_TYPES, field: kinds}, ["filebeat-a", "filebeat-b"]),
        )
        message = f"Time field {field} is not a date field in filebeat-*: it is {said}"

        with pytest.raises(ValueError, match=exact(message)):
            _opensearch_core.run(served(cluster, time_field=field), log)

    def test_it_is_checked_before_the_unknown_fields(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)

        run(
            cluster, log, time_field="log.level", fields=entries("invalid_field"), on_error="record"
        )

        assert warnings(log) == [failed_line("search", TIME_FIELD_NOT_DATE, "Validation")]

    def test_a_time_field_the_list_lacks_is_an_unknown_field(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        out = run(cluster, log, time_field="event.created")

        assert warnings(log) == [unknown("event.created")]
        assert sent_json(cluster, 1)["query"] == {
            "bool": {
                "filter": [
                    {
                        "range": {
                            "event.created": {
                                "gte": FROM_MS,
                                "lte": NOW_MS,
                                "format": "epoch_millis",
                            }
                        }
                    }
                ]
            }
        }
        passed(out, 0)
        assert amber(out) is True


class TestUnknownFields:
    """Each name the field list rejects logs one WARN, the run goes on, and it ends amber."""

    def test_a_dql_field_is_warned_and_sent_as_written(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(ONE_LINE, 1))

        out = run(cluster, log, query="log.invalid: ERROR")

        assert warnings(log) == [unknown("log.invalid")]
        assert sent_json(cluster, 1)["query"]["bool"]["filter"][1] == {
            "bool": {"should": [{"match": {"log.invalid": "ERROR"}}], "minimum_should_match": 1}
        }
        passed(out, 1)
        assert (amber(out), len(out["results"]["rows"])) == (True, 1)

    @pytest.mark.parametrize(
        ("query", "name"),
        [
            pytest.param('{"term": {"log.invalid": "ERROR"}}', "log.invalid", id="field-keyed"),
            pytest.param('{"exists": {"field": "trace.idd"}}', "trace.idd", id="field-key"),
            pytest.param(
                '{"multi_match": {"query": "failed", "fields": ["invalid_field^2", "message"]}}',
                "invalid_field",
                id="fields-array-with-boost",
            ),
        ],
    )
    def test_a_query_dsl_field(
        self, cluster: RecordingHTTPServer, log: LogRecorder, query: str, name: str
    ) -> None:
        answered(cluster, search_answer([], 0))

        out = run(cluster, log, query_language="query_dsl", query=query)

        assert warnings(log) == [unknown(name)]
        assert amber(out) is True

    def test_the_field_of_a_geo_query(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer([], 0))
        query = '{"geo_distance": {"distance": "12km", "pin.locaton": {"lat": 40, "lon": -70}}}'

        out = run(cluster, log, query_language="query_dsl", query=query)

        assert warnings(log) == [unknown("pin.locaton")]
        assert amber(out) is True

    def test_a_fields_entry(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer([], 0))

        out = run(cluster, log, fields=entries("@timestamp", "invalid_field"))

        assert warnings(log) == [unknown("invalid_field")]
        assert (columns(out["results"]), amber(out)) == (
            [("@timestamp", "string"), ("invalid_field", "string")],
            True,
        )

    def test_a_wildcard_entry_that_matches_nothing(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        out = run(cluster, log, fields=entries("service.*", "nope.*"))

        assert warnings(log) == [unknown("nope.*")]
        assert amber(out) is True

    def test_sort_by(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer([], 0))

        out = run(cluster, log, sort_by="latency")

        assert warnings(log) == [unknown("latency")]
        assert amber(out) is True

    @pytest.mark.parametrize(
        ("overrides", "name"),
        [
            pytest.param({"group_by_field": "service"}, "service", id="group-by-field"),
            pytest.param(
                {"stats": [stat(stat="count"), stat(stat="sum", field="byte")]},
                "byte",
                id="stat-field",
            ),
            pytest.param(
                {"stats": [stat(stat="custom", json='{"avg": {"field": "latencyms"}}')]},
                "latencyms",
                id="custom-json-field",
            ),
        ],
    )
    def test_an_aggregate_field(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        overrides: dict[str, Any],
        name: str,
    ) -> None:
        slots: dict[str, Any] = {"time": {"buckets": []}}
        if "group_by_field" in overrides:
            slots = {"group": {"buckets": [], "sum_other_doc_count": 0}}
        answered(cluster, search_answer([], 0, aggregations=slots))

        out = run(cluster, log, **aggregate(**overrides))

        assert warnings(log) == [unknown(name)]
        passed(out, 0)
        assert amber(out) is True

    def test_known_names_stay_green(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer([], 0))

        out = run(
            cluster,
            log,
            query="service.*: checkout and log.level: ERROR",
            fields=entries("_id", "_index", "@timestamp", "service.*", "message"),
            sort_by="latency_ms",
        )

        assert warnings(log) == []
        assert amber(out) is False

    def test_search_names_in_order_each_once(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        run(
            cluster,
            log,
            query="log.invalid: ERROR",
            fields=entries("@timestamp", "invalid_field", "log.invalid"),
            sort_by="latency",
            time_field="event.created",
        )

        assert warnings(log) == [
            unknown("log.invalid"),
            unknown("invalid_field"),
            unknown("latency"),
            unknown("event.created"),
        ]

    def test_aggregate_names_in_order_each_once(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        group = {"group": {"buckets": [], "sum_other_doc_count": 0}}
        answered(cluster, search_answer([], 0, aggregations=group))

        run(
            cluster,
            log,
            **aggregate(
                stat(stat="sum", field="byte"),
                stat(stat="max", field="byte"),
                stat(stat="custom", json='{"avg": {"field": "latencyms"}}'),
                query="log.invalid: ERROR",
                time_field="event.created",
                group_by_field="service",
            ),
        )

        assert warnings(log) == [
            unknown("log.invalid"),
            unknown("event.created"),
            unknown("service"),
            unknown("byte"),
            unknown("latencyms"),
        ]


class TestPartialResults:
    """Failed shards or a cluster-side timeout: WARN once per case, and amber."""

    def test_failed_shards_name_the_first_failure(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(ONE_LINE, 1, failed=1, shard_failures=[SHARD_FAILURE]))

        out = run(cluster, log)

        assert warnings(log) == [SHARDS_FAILED]
        passed(out, 1)
        assert (amber(out), len(out["results"]["rows"])) == (True, 1)

    def test_a_search_timed_out_on_the_cluster(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(ONE_LINE, 1, timed_out=True))

        out = run(cluster, log)

        assert warnings(log) == [TIMED_OUT]
        assert amber(out) is True

    def test_both_cases_on_one_page(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(
            cluster,
            search_answer(ONE_LINE, 1, failed=1, shard_failures=[SHARD_FAILURE], timed_out=True),
        )

        run(cluster, log)

        assert warnings(log) == [SHARDS_FAILED, TIMED_OUT]

    def test_each_case_is_logged_once_per_run(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)
        cluster.enqueue(body=full_partial_page(), content_type="application/json")
        later = search_answer(ONE_LINE * 3, 0, failed=1, shard_failures=[SHARD_FAILURE])
        del later["hits"]["total"]
        enqueue_json(cluster, later)

        out = run(cluster, log, max_results=0)

        assert len(cluster.requests) == 3
        assert warnings(log) == [SHARDS_FAILED]
        assert (out["total_results"], amber(out)) == (10003, True)

    def test_an_aggregate_with_failed_shards(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, aggregated(6, failed=1, shard_failures=[SHARD_FAILURE]))

        out = run(cluster, log, **aggregate())

        assert warnings(log) == [SHARDS_FAILED]
        passed(out, 6)
        assert amber(out) is True


class TestWarningsThatStayGreen:
    """Max results, Top values and window WARNs are logged but never make the block amber."""

    def test_max_results_cut(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer(ONE_LINE, 57))

        out = run(cluster, log, max_results=1)

        assert warnings(log) == ["Kept 1 of 57 results (Max results)"]
        passed(out, 57)
        assert amber(out) is False

    def test_top_values_leaving_documents_out(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        group = {
            "doc_count_error_upper_bound": 0,
            "sum_other_doc_count": 5,
            "buckets": [{"key": "checkout", "doc_count": 40}, {"key": "search", "doc_count": 12}],
        }
        answered(cluster, search_answer([], 57, aggregations={"group": group}))

        out = run(
            cluster,
            log,
            **aggregate(group_by_time="none", group_by_field="service.name", top_values=2),
        )

        assert warnings(log) == [
            "Top values kept 2 values of service.name; 5 matching documents have other values "
            "and are left out"
        ]
        passed(out, 57)
        assert amber(out) is False

    def test_from_later_than_to(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer([], 0))

        out = run(cluster, log, **{"from": "2026-09-25T10:00:00Z", "to": "2026-09-25T09:00:00Z"})

        assert warnings(log) == [
            "From 2026-09-25T10:00:00.000Z is later than To 2026-09-25T09:00:00.000Z: "
            "the search can find nothing"
        ]
        assert len(cluster.requests) == 2
        passed(out, 0)
        assert amber(out) is False

    def test_from_later_than_now(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer([], 0))

        out = run(cluster, log, **{"from": "2026-09-26T00:00:00Z", "to": "2026-09-27T00:00:00Z"})

        assert warnings(log) == [
            "From 2026-09-26T00:00:00.000Z is later than now (2026-09-25T10:42:05.123Z): "
            "the search can find nothing"
        ]
        passed(out, 0)
        assert amber(out) is False

    def test_a_clean_run_is_green(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer(ONE_LINE, 1))

        out = run(cluster, log)

        assert (warnings(log), amber(out)) == ([], False)
        assert requested(cluster) == [("GET", FIELD_CAPS), ("POST", SEARCH)]
