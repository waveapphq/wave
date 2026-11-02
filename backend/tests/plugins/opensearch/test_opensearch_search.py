"""OpenSearch Search runs end to end against the scripted cluster (REQ-3.4.1.15, OS-8, OS-10).

Documents of an index pattern (REQ-3.3.2.5) inside a time window (REQ-3.3.2.3) that match a query
(REQ-3.3.2.2, REQ-3.3.2.6) come back as Results (REQ-3.3.3.1), by ID too (REQ-3.3.3.6).
"""

import functools
import json
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from tests.connectivity.opensearch.fakes import (
    enqueue_json,
    enqueue_text,
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
    no_table_printed,
    os_context,
    outputs,
    rows,
    served,
    timed,
)
from wavecore.core.table import Table
from wavecore.plugins import _opensearch_core
from wavecore.plugins.opensearch import OpenSearchPlugin

FIELD_CAPS = "/filebeat-%2A/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true"
SEARCH = "/filebeat-%2A/_search"
INDICES = ["filebeat-2026.09.25"]
NOW_MS = 1790332925123
FROM_MS = 1790332025123
WINDOW = "from 2026-09-25T10:27:05.123Z to 2026-09-25T10:42:05.123Z"
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
NEWEST_FIRST = [{"@timestamp": {"order": "desc"}}, {"_id": {"order": "asc"}}]
OLDEST_FIRST = [{"@timestamp": {"order": "asc"}}, {"_id": {"order": "asc"}}]
ERROR_ONLY = {"bool": {"should": [{"match": {"log.level": "ERROR"}}], "minimum_should_match": 1}}
ERROR_TERM = {"term": {"log.level": "ERROR"}}
STAMP = "2026-09-25T10:40:00.000Z"
PAGE = 10000
LAST_SORT = [NOW_MS - (PAGE - 1), f"d{PAGE - 1}"]
USER_FIELDS = {
    **FIELD_TYPES,
    "user": "object",
    "user.id": "long",
    "user.name": "keyword",
    "user.roles": "keyword",
}

LOG_FIELDS = ("@timestamp", "log.level", "message")
LOG_HITS = [
    hit(
        "a1",
        {
            "@timestamp": "2026-09-25T10:40:01.120Z",
            "log": {"level": "ERROR"},
            "message": "Payment failed",
        },
        sort=[1790332801120, "a1"],
    ),
    hit(
        "a2",
        {
            "@timestamp": "2026-09-25T10:39:58.004Z",
            "log.level": "INFO",
            "message": "Batch complete",
        },
        sort=[1790332798004, "a2"],
    ),
]
LOG_COLUMNS = [("@timestamp", "string"), ("log.level", "string"), ("message", "string")]
LOG_ROWS = [
    ["2026-09-25T10:40:01.120Z", "ERROR", "Payment failed"],
    ["2026-09-25T10:39:58.004Z", "INFO", "Batch complete"],
]
USER_HITS = [
    hit(
        "b1",
        {
            "@timestamp": "2026-09-25T10:40:01.120Z",
            "user": {"roles": ["a", "b"], "name": "ann", "id": 7},
        },
        sort=[1790332801120, "b1"],
    ),
    hit(
        "b2",
        {"@timestamp": "2026-09-25T10:40:02.000Z", "user": {"id": 8}},
        sort=[1790332802000, "b2"],
    ),
]


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


def ms(stamp: str) -> int:
    return (datetime.fromisoformat(stamp) - EPOCH) // timedelta(milliseconds=1)


def entries(*names: str) -> list[dict[str, str]]:
    """A Fields list in its literal form."""
    return [{"value": name} for name in names]


def time_range(gte: int = FROM_MS, lte: int = NOW_MS, field: str = "@timestamp") -> dict[str, Any]:
    return {"range": {field: {"gte": gte, "lte": lte, "format": "epoch_millis"}}}


def filtered(*author: dict[str, Any], window: dict[str, Any] | None = None) -> dict[str, Any]:
    """The final query: the window, then the author query when there is one."""
    return {"bool": {"filter": [window or time_range(), *author]}}


def page_one(
    size: int = PAGE,
    query: dict[str, Any] | None = None,
    sort: list[dict[str, Any]] | None = None,
    includes: tuple[str, ...] = ("@timestamp",),
) -> dict[str, Any]:
    return {
        "size": size,
        "track_total_hits": True,
        "query": query or filtered(),
        "sort": sort or NEWEST_FIRST,
        "_source": {"includes": list(includes)},
    }


def later_page(hits: list[dict[str, Any]]) -> dict[str, Any]:
    """A page asked with track_total_hits false: OpenSearch leaves hits.total out."""
    answer = search_answer(hits, 0)
    del answer["hits"]["total"]
    return answer


@functools.cache
def full_page(total: int) -> bytes:
    """A first page holding all 10,000 hits it asked for."""
    hits = [hit(f"d{n}", {"@timestamp": STAMP}, sort=[NOW_MS - n, f"d{n}"]) for n in range(PAGE)]
    return json.dumps(search_answer(hits, total)).encode()


def lines(count: int, first: int = 0) -> list[dict[str, Any]]:
    """`count` hits with a timestamp and a message each."""
    return [
        hit(
            f"e{n}",
            {"@timestamp": f"2026-09-25T10:41:{n % 60:02d}.000Z", "message": f"line {n}"},
            sort=[NOW_MS - 1000 * n, f"e{n}"],
        )
        for n in range(first, first + count)
    ]


def answered(
    server: RecordingHTTPServer, *answers: dict[str, Any], fields: dict[str, Any] | None = None
) -> None:
    """Queue the field list (one matching index), then each search answer."""
    enqueue_json(server, field_caps_answer(fields or FIELD_TYPES, INDICES))
    for answer in answers:
        enqueue_json(server, answer)


def search(server: RecordingHTTPServer, log: LogRecorder, **overrides: Any) -> dict[str, Any]:
    return outputs(_opensearch_core.run(served(server, **overrides), log))


def requested(server: RecordingHTTPServer) -> list[tuple[str, str]]:
    return [(record["method"], record["path"]) for record in server.requests]


def wire(server: RecordingHTTPServer, index: int) -> str:
    body: bytes = server.requests[index]["body"]
    return body.decode()


def console(log: LogRecorder) -> list[tuple[str, str]]:
    """Every line but the DEBUG request lines, each measured duration as N."""
    return [(level, timed([line])[0]) for level, line in log if level != "DEBUG"]


def run_line(total: str, kept: str, window: str = WINDOW, index: str = "filebeat-*") -> str:
    return f"Search {index} {window}: {total}, {kept}, N s"


def succeeded(out: dict[str, Any], total: int) -> None:
    """A passed, green run: the output core and Total results."""
    assert (out["total_results"], out["success"], out["error"], out["reason"]) == (
        total,
        True,
        "",
        "",
    )
    assert "__block_warning" not in out


class TestRequests:
    """The field list is read first, then the search goes out as POST <index>/_search."""

    def test_the_field_list_then_one_search(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log)

        assert requested(cluster) == [("GET", FIELD_CAPS), ("POST", SEARCH)]
        assert cluster.requests[0]["body"] == b""
        assert sent_json(cluster, 1) == page_one()

    def test_the_pinned_page_one_body(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer(LOG_HITS, 2))

        search(cluster, log, query="log.level: ERROR", fields=entries(*LOG_FIELDS))

        assert sent_json(cluster, 1) == page_one(query=filtered(ERROR_ONLY), includes=LOG_FIELDS)

    def test_one_debug_line_per_request_as_sent(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(LOG_HITS, 2))

        search(cluster, log, query="log.level: ERROR", fields=entries(*LOG_FIELDS))

        assert log.at("DEBUG") == [f"GET {FIELD_CAPS}", f"POST {SEARCH} {wire(cluster, 1)}"]
        assert wire(cluster, 1).startswith('{"size":10000,"track_total_hits":true,')

    def test_a_url_password_in_the_query_is_masked_in_the_debug_line(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))
        query = {"term": {"message": "https://wave:q-s3cr3t@proxy.internal/x"}}

        search(cluster, log, query_language="query_dsl", query=query)

        assert sent_json(cluster, 1)["query"] == filtered(query)
        shown = wire(cluster, 1).replace("q-s3cr3t", "********")
        assert log.at("DEBUG") == [f"GET {FIELD_CAPS}", f"POST {SEARCH} {shown}"]

    def test_a_gateway_prefix_leads_every_path(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, url="http://{host}/os")

        assert requested(cluster) == [("GET", f"/os{FIELD_CAPS}"), ("POST", f"/os{SEARCH}")]
        assert log.at("DEBUG") == [f"GET /os{FIELD_CAPS}", f"POST /os{SEARCH} {wire(cluster, 1)}"]

    def test_the_index_pattern_is_sent_whole_and_the_cluster_resolves_it(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        pattern = "<logs-{now/d}>,-logs-debug*"
        encoded = "/%3Clogs-%7Bnow%2Fd%7D%3E%2C-logs-debug%2A"
        answered(cluster, search_answer([], 0))

        search(cluster, log, index=pattern)

        assert requested(cluster) == [
            (
                "GET",
                f"{encoded}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true",
            ),
            ("POST", f"{encoded}/_search"),
        ]
        assert console(log) == [("INFO", run_line("0 results", "0 kept", index=pattern))]


class TestSearchBody:
    """Page one's size, sort, _source and window follow the rows."""

    @pytest.mark.parametrize(
        ("max_results", "size"),
        [
            pytest.param(3, 3, id="small"),
            pytest.param(10000, 10000, id="default"),
            pytest.param(25000, 10000, id="past-one-page"),
            pytest.param(0, 10000, id="zero-means-all"),
        ],
    )
    def test_size_follows_max_results(
        self, cluster: RecordingHTTPServer, log: LogRecorder, max_results: int, size: int
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, max_results=max_results)

        assert sent_json(cluster, 1)["size"] == size

    def test_sort_by_and_order_with_the_id_tiebreaker(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, sort_by="latency_ms", order="asc")

        assert sent_json(cluster, 1)["sort"] == [
            {"latency_ms": {"order": "asc"}},
            {"_id": {"order": "asc"}},
        ]

    def test_the_time_field_bounds_the_window_and_is_the_default_sort(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0), fields={**FIELD_TYPES, "event.created": "date"})

        search(cluster, log, time_field="event.created")

        assert sent_json(cluster, 1) == page_one(
            query=filtered(window=time_range(field="event.created")),
            sort=[{"event.created": {"order": "desc"}}, {"_id": {"order": "asc"}}],
        )

    def test_empty_fields_ask_for_the_whole_document(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, fields=[])

        assert sent_json(cluster, 1)["_source"] is True

    @pytest.mark.parametrize(
        "fields",
        [
            pytest.param(["@timestamp", "message"], id="names-from-the-row-expression"),
            pytest.param(entries("@timestamp", "message"), id="entries"),
        ],
    )
    def test_fields_in_either_form(
        self, cluster: RecordingHTTPServer, log: LogRecorder, fields: list[Any]
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, fields=fields)

        assert sent_json(cluster, 1)["_source"] == {"includes": ["@timestamp", "message"]}

    def test_absent_or_none_rows_take_their_defaults(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))
        rows_as_none = {
            name: None
            for name in (
                "from",
                "to",
                "query_language",
                "query",
                "mode",
                "fields",
                "max_results",
                "timeout",
                "sort_by",
                "order",
                "time_field",
                "connect_timeout",
                "on_error",
            )
        }

        out = search(cluster, log, **rows_as_none)

        assert sent_json(cluster, 1) == page_one()
        succeeded(out, 0)

    def test_blank_rows_take_their_defaults(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, **{"from": "", "to": "", "time_field": "", "sort_by": ""})

        assert sent_json(cluster, 1) == page_one()

    def test_date_math_resolves_once_to_epoch_milliseconds(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, **{"from": "now-1d/d", "to": "now/d"})

        window = time_range(ms("2026-09-24T00:00:00+00:00"), ms("2026-09-25T23:59:59.999+00:00"))
        assert sent_json(cluster, 1)["query"] == filtered(window=window)
        assert console(log) == [
            (
                "INFO",
                run_line(
                    "0 results",
                    "0 kept",
                    window="from 2026-09-24T00:00:00.000Z to 2026-09-25T23:59:59.999Z",
                ),
            )
        ]

    def test_timestamps_and_epoch_milliseconds_print_in_utc(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, **{"from": "2026-09-25T12:30:00+02:00", "to": 1790332798004})

        window = time_range(ms("2026-09-25T10:30:00+00:00"), 1790332798004)
        assert sent_json(cluster, 1)["query"] == filtered(window=window)
        assert console(log) == [
            (
                "INFO",
                run_line(
                    "0 results",
                    "0 kept",
                    window="from 2026-09-25T10:30:00.000Z to 2026-09-25T10:39:58.004Z",
                ),
            )
        ]


class TestQuery:
    """The Query row filters inside the window, in DQL or Query DSL (REQ-3.3.2.6)."""

    @pytest.mark.parametrize(
        ("language", "query"),
        [
            pytest.param("dql", "", id="dql-empty"),
            pytest.param("dql", "   ", id="dql-spaces"),
            pytest.param("dql", None, id="dql-none"),
            pytest.param("query_dsl", "", id="dsl-empty"),
            pytest.param("query_dsl", "  ", id="dsl-spaces"),
            pytest.param("query_dsl", None, id="dsl-none"),
            pytest.param("query_dsl", {}, id="dsl-empty-map"),
            pytest.param("query_dsl", "{}", id="dsl-empty-object-text"),
        ],
    )
    def test_a_blank_query_filters_on_the_window_only(
        self, cluster: RecordingHTTPServer, log: LogRecorder, language: str, query: Any
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, query_language=language, query=query)

        assert sent_json(cluster, 1)["query"] == filtered()

    def test_dql_text_with_no_markers_is_translated(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, query="log.level: ERROR")

        assert sent_json(cluster, 1)["query"] == filtered(ERROR_ONLY)

    @pytest.mark.parametrize(
        "query",
        [
            pytest.param('{"term": {"log.level": "ERROR"}}', id="json-text"),
            pytest.param(
                '// errors only\n{"term": {"log.level": "ERROR"}}', id="json-with-comment"
            ),
            pytest.param({"term": {"log.level": "ERROR"}}, id="map-from-an-expression"),
        ],
    )
    def test_query_dsl_is_sent_as_given(
        self, cluster: RecordingHTTPServer, log: LogRecorder, query: Any
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, query_language="query_dsl", query=query)

        assert sent_json(cluster, 1)["query"] == filtered(ERROR_TERM)

    def test_query_dsl_decimals_keep_their_digits_on_the_wire(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(
            cluster,
            log,
            query_language="query_dsl",
            query='{"range": {"latency_ms": {"gte": 12.50}}}',
        )

        assert '{"range":{"latency_ms":{"gte":12.50}}}' in wire(cluster, 1)

    def test_a_pasted_request_keeps_only_its_query(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))
        pasted = (
            '{"query": {"term": {"log.level": "ERROR"}}, "size": 5, '
            '"sort": [{"@timestamp": "asc"}]}'
        )

        search(cluster, log, query_language="query_dsl", query=pasted)

        assert sent_json(cluster, 1) == page_one(query=filtered(ERROR_TERM))
        assert 'Query: kept only "query" from the pasted request; dropped "size", "sort"' in log.at(
            "INFO"
        )


class TestResultsTable:
    """Results is a typed table of the Fields entries; Total results the exact match count."""

    def test_nested_and_dotted_sources_fill_the_same_column(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(LOG_HITS, 2))

        out = search(cluster, log, fields=entries(*LOG_FIELDS))

        assert (columns(out["results"]), rows(out["results"])) == (LOG_COLUMNS, LOG_ROWS)
        succeeded(out, 2)

    def test_objects_expand_to_dotted_leaf_columns(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(USER_HITS, 2), fields=USER_FIELDS)

        out = search(cluster, log, fields=entries("@timestamp", "user"))

        assert columns(out["results"]) == [
            ("@timestamp", "string"),
            ("user.id", "integer"),
            ("user.name", "string"),
            ("user.roles", "string"),
        ]
        assert rows(out["results"]) == [
            ["2026-09-25T10:40:01.120Z", 7, "ann", '["a","b"]'],
            ["2026-09-25T10:40:02.000Z", 8, None, None],
        ]
        succeeded(out, 2)

    def test_empty_fields_give_the_whole_document_with_exact_decimals(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        enqueue_json(cluster, field_caps_answer({**FIELD_TYPES, "a": "long"}, INDICES))
        enqueue_text(
            cluster,
            '{"took": 2, "timed_out": false, '
            '"_shards": {"total": 1, "successful": 1, "skipped": 0, "failed": 0}, '
            '"hits": {"total": {"value": 1, "relation": "eq"}, "max_score": null, "hits": ['
            '{"_index": "filebeat-2026.09.25", "_id": "c1", "_score": null, '
            '"_source": {"a": 1, "b": {"c": 2.50}}, "sort": [1790332801120, "c1"]}]}}',
        )

        out = search(cluster, log, fields=[])

        assert columns(out["results"]) == [("_source", "string")]
        assert rows(out["results"]) == [['{"a":1,"b":{"c":2.50}}']]
        succeeded(out, 1)

    def test_no_hits_keep_the_fields_as_string_columns(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        out = search(cluster, log, fields=entries(*LOG_FIELDS))

        assert (columns(out["results"]), rows(out["results"])) == (LOG_COLUMNS, [])
        succeeded(out, 0)

    def test_id_and_index_read_the_hit_metadata(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(
            cluster,
            search_answer(
                [hit("a1", {"message": "Payment failed"}, sort=[1, "a1"], index=INDICES[0])], 1
            ),
        )

        out = search(cluster, log, fields=entries("_id", "_index", "message"))

        assert sent_json(cluster, 1)["_source"] == {"includes": ["_id", "_index", "message"]}
        assert rows(out["results"]) == [["a1", "filebeat-2026.09.25", "Payment failed"]]
        succeeded(out, 1)


class TestPaging:
    """Past 10,000 the block pages by search_after with the _id tiebreaker."""

    def test_the_next_page_continues_after_the_last_sort(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)
        cluster.enqueue(body=full_page(10005), content_type="application/json")
        enqueue_json(cluster, later_page(lines(2)))

        out = search(cluster, log, max_results=10002)

        assert requested(cluster) == [("GET", FIELD_CAPS), ("POST", SEARCH), ("POST", SEARCH)]
        assert sent_json(cluster, 1) == page_one()
        assert sent_json(cluster, 2) == {
            **page_one(size=2),
            "track_total_hits": False,
            "search_after": LAST_SORT,
        }
        assert (out["total_results"], len(out["results"]["rows"])) == (10005, 10002)
        assert console(log) == [
            ("WARN", "Kept 10002 of 10005 results (Max results)"),
            ("INFO", run_line("10005 results", "10002 kept")),
        ]
        no_table_printed(log, out["results"])

    def test_all_results_stop_at_a_short_page(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)
        cluster.enqueue(body=full_page(10003), content_type="application/json")
        enqueue_json(cluster, later_page(lines(3)))

        out = search(cluster, log, max_results=0)

        assert len(cluster.requests) == 3
        assert sent_json(cluster, 2) == {
            **page_one(),
            "track_total_hits": False,
            "search_after": LAST_SORT,
        }
        assert (out["total_results"], len(out["results"]["rows"])) == (10003, 10003)
        assert rows(out["results"])[-3:] == [[line["_source"]["@timestamp"]] for line in lines(3)]
        assert console(log)[0] == ("INFO", run_line("10003 results", "10003 kept"))

    def test_all_results_stop_at_an_empty_page(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)
        cluster.enqueue(body=full_page(10000), content_type="application/json")
        enqueue_json(cluster, later_page([]))

        out = search(cluster, log, max_results=0)

        assert len(cluster.requests) == 3
        assert (out["total_results"], len(out["results"]["rows"])) == (10000, 10000)
        assert "WARN" not in [level for level, _line in log]

    def test_a_full_page_that_reaches_max_results_ends_the_search(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster)
        cluster.enqueue(body=full_page(10005), content_type="application/json")

        out = search(cluster, log)

        assert len(cluster.requests) == 2
        assert (out["total_results"], len(out["results"]["rows"])) == (10005, 10000)
        assert console(log)[0] == ("WARN", "Kept 10000 of 10005 results (Max results)")

    def test_a_short_first_page_is_the_only_page(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(lines(5), 5))

        out = search(cluster, log, max_results=0, fields=entries("@timestamp", "message"))

        assert len(cluster.requests) == 2
        assert rows(out["results"])[0] == ["2026-09-25T10:41:00.000Z", "line 0"]
        succeeded(out, 5)


class TestMaxResultsCut:
    """Max results cutting the matches logs WARN `Kept N of M results (Max results)` (OS-9)."""

    def test_the_cut_is_logged_and_total_results_stays_exact(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(lines(1), 57))

        out = search(cluster, log, max_results=1)

        assert sent_json(cluster, 1)["size"] == 1
        assert len(out["results"]["rows"]) == 1
        succeeded(out, 57)
        assert console(log) == [
            ("WARN", "Kept 1 of 57 results (Max results)"),
            ("INFO", run_line("57 results", "1 kept")),
        ]
        no_table_printed(log, out["results"])

    def test_no_warning_when_every_match_is_kept(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(lines(2), 2))

        search(cluster, log, max_results=2)

        assert [level for level, _line in console(log)] == ["INFO"]

    def test_one_result_reads_in_the_singular(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(lines(1), 1))

        search(cluster, log)

        assert console(log)[0] == ("INFO", run_line("1 result", "1 kept"))


class TestRunLog:
    """One INFO line per run and never the Results data, which stays in Results (OS-10)."""

    def test_the_run_line_is_the_last_console_line(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(LOG_HITS, 2))

        out = search(cluster, log, fields=entries(*LOG_FIELDS))

        assert console(log) == [("INFO", run_line("2 results", "2 kept"))]
        no_table_printed(log, out["results"])

    def test_many_kept_rows_print_nothing(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(lines(57), 57))

        out = search(cluster, log, fields=entries("@timestamp", "message"))

        assert len(out["results"]["rows"]) == 57
        assert console(log) == [("INFO", run_line("57 results", "57 kept"))]
        no_table_printed(log, out["results"])

    def test_objects_with_empty_cells_print_nothing(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(USER_HITS, 2), fields=USER_FIELDS)

        out = search(cluster, log, fields=entries("@timestamp", "user"))

        assert console(log) == [("INFO", run_line("2 results", "2 kept"))]
        no_table_printed(log, out["results"])

    def test_a_long_cell_stays_whole_in_results_and_is_not_printed(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        long_text, edge_text = "x" * 250, "y" * 200
        answered(
            cluster,
            search_answer(
                [
                    hit("f1", {"message": long_text}, sort=[2, "f1"]),
                    hit("f2", {"message": edge_text}, sort=[1, "f2"]),
                ],
                2,
            ),
        )

        out = search(cluster, log, fields=entries("message"))

        assert rows(out["results"]) == [[long_text], [edge_text]]
        assert console(log) == [("INFO", run_line("2 results", "2 kept"))]
        no_table_printed(log, out["results"])
        assert [line for _level, line in log if "x" * 200 in line or edge_text in line] == []

    def test_empty_results_print_only_the_run_line(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        search(cluster, log, fields=entries(*LOG_FIELDS))

        assert console(log) == [("INFO", run_line("0 results", "0 kept"))]

    def test_warnings_come_before_the_run_line_in_their_order(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        early = hit("g1", {"@timestamp": "2026-09-25T09:30:00.000Z"}, sort=[1, "g1"])
        answered(cluster, search_answer([early], 5, timed_out=True))

        out = search(
            cluster,
            log,
            query="log.invalid: ERROR",
            max_results=1,
            **{"from": "2026-09-25T10:00:00Z", "to": "2026-09-25T09:00:00Z"},
        )

        window = "from 2026-09-25T10:00:00.000Z to 2026-09-25T09:00:00.000Z"
        assert console(log) == [
            (
                "WARN",
                "From 2026-09-25T10:00:00.000Z is later than To 2026-09-25T09:00:00.000Z: "
                "the search can find nothing",
            ),
            ("WARN", "Field log.invalid is not in the field list of filebeat-*"),
            ("WARN", "Partial results: the search timed out on the cluster"),
            ("WARN", "Kept 1 of 5 results (Max results)"),
            ("INFO", run_line("5 results", "1 kept", window=window)),
        ]
        no_table_printed(log, out["results"])
        assert out["__block_warning"] is True


class TestWaitThenCollect:
    """A small waiting Search finds the final line, then one Search collects the window."""

    FINAL = 'log.level: ERROR or message: "Batch complete"'
    FINAL_QUERY = {
        "bool": {
            "should": [
                ERROR_ONLY,
                {
                    "bool": {
                        "should": [{"match_phrase": {"message": "Batch complete"}}],
                        "minimum_should_match": 1,
                    }
                },
            ],
            "minimum_should_match": 1,
        }
    }

    def test_the_waiting_search_asks_for_the_oldest_final_line_only(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([LOG_HITS[1]], 3))

        out = search(
            cluster,
            log,
            query=self.FINAL,
            fields=entries("@timestamp", "log.level"),
            order="asc",
            max_results=1,
        )

        assert sent_json(cluster, 1) == page_one(
            size=1,
            query=filtered(self.FINAL_QUERY),
            sort=OLDEST_FIRST,
            includes=("@timestamp", "log.level"),
        )
        assert rows(out["results"]) == [["2026-09-25T10:39:58.004Z", "INFO"]]
        succeeded(out, 3)

    def test_the_collecting_search_reads_the_whole_window_oldest_first(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(list(reversed(LOG_HITS)), 2))

        out = search(
            cluster,
            log,
            fields=entries(*LOG_FIELDS),
            order="asc",
            max_results=0,
            **{"from": "2026-09-25T10:30:00Z", "to": "2026-09-25T10:39:58.004Z"},
        )

        window = time_range(ms("2026-09-25T10:30:00+00:00"), 1790332798004)
        assert sent_json(cluster, 1) == page_one(
            query=filtered(window=window), sort=OLDEST_FIRST, includes=LOG_FIELDS
        )
        assert rows(out["results"]) == list(reversed(LOG_ROWS))
        succeeded(out, 2)


class TestIdLookup:
    """An ID is one more field condition: one row and Total results 1, or empty (REQ-3.3.3.6)."""

    def test_the_query_dsl_ids_query(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, search_answer(LOG_HITS[:1], 1))

        out = search(
            cluster,
            log,
            query_language="query_dsl",
            query='{"ids": {"values": ["a1"]}}',
            fields=entries("_id", "message"),
        )

        assert sent_json(cluster, 1)["query"] == filtered({"ids": {"values": ["a1"]}})
        assert rows(out["results"]) == [["a1", "Payment failed"]]
        succeeded(out, 1)
        assert "WARN" not in [level for level, _line in log]

    def test_id_named_in_dql_is_a_known_field(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(LOG_HITS[:1], 1))

        out = search(cluster, log, query="_id: a1", fields=entries("_id", "message"))

        assert sent_json(cluster, 1)["query"] == filtered(
            {"bool": {"should": [{"match": {"_id": "a1"}}], "minimum_should_match": 1}}
        )
        assert rows(out["results"]) == [["a1", "Payment failed"]]
        succeeded(out, 1)
        assert "WARN" not in [level for level, _line in log]

    def test_an_id_that_is_not_there_passes_with_an_empty_table(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0))

        out = search(cluster, log, query="_id: nope", fields=entries("_id", "message"))

        assert (columns(out["results"]), rows(out["results"])) == (
            [("_id", "string"), ("message", "string")],
            [],
        )
        succeeded(out, 0)


class TestThroughExecute:
    """The plugin path hands back a typed Table and logs through the context logger."""

    async def test_results_arrive_as_a_table(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer(USER_HITS, 2), fields=USER_FIELDS)
        params = served(cluster, fields=entries("@timestamp", "user"))

        out = await OpenSearchPlugin().execute(os_context(params, log))

        table = out["results"]
        assert isinstance(table, Table)
        assert table.col_names() == ["@timestamp", "user.id", "user.name", "user.roles"]
        assert table.col_types() == ["string", "integer", "string", "string"]
        assert table.col("user.id") == [7, 8]
        succeeded(out, 2)
        assert console(log)[0] == ("INFO", run_line("2 results", "2 kept"))
        assert log.at("DEBUG")[0] == f"GET {FIELD_CAPS}"
