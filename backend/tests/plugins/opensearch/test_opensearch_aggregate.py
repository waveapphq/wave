"""OpenSearch Aggregate runs end to end against the scripted cluster (REQ-3.4.1.15, OS-7, OS-8).

One size-0 search with exact totals turns the matching documents into numbers per time slot
and / or field value (REQ-3.3.3.2), inside the window (REQ-3.3.2.3) and query (REQ-3.3.2.6).
"""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from tests.connectivity.opensearch.fakes import (
    enqueue_json,
    enqueue_text,
    field_caps_answer,
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
TEN = datetime(2026, 9, 25, 10, 0, tzinfo=UTC)
TEN_MS = 1790330400000
FIELDS = {
    **FIELD_TYPES,
    "user.id": "keyword",
    "bytes": "long",
    "requests_total": "long",
    "http.status": "long",
    "ok": "boolean",
}
COUNT = {"value": {"stat": "count"}}
AVERAGE = {"value": {"stat": "average", "field": "latency_ms"}}
INCREASE = {"value": {"stat": "increase", "field": "requests_total"}}
INCREASE_SLOTS = {
    "s1_max": {"max": {"field": "requests_total"}},
    "s1_min": {"min": {"field": "requests_total"}},
}

PERCENTILE_PER_MINUTE_ANSWER = (
    '{"hits": {"total": {"value": 6, "relation": "eq"}},'
    ' "aggregations": {"time": {"buckets": ['
    '{"key_as_string": "2026-09-25T10:00:00.000Z", "key": 1790330400000, "doc_count": 2,'
    ' "s2": {"values": [{"key": 95.0, "value": 812.5}]}},'
    '{"key_as_string": "2026-09-25T10:01:00.000Z", "key": 1790330460000, "doc_count": 0,'
    ' "s2": {"values": [{"key": 95.0, "value": null}]}},'
    '{"key_as_string": "2026-09-25T10:02:00.000Z", "key": 1790330520000, "doc_count": 4,'
    ' "s2": {"values": [{"key": 95.0, "value": 430.0}]}}]}}}'
)
TOP_VALUES_ANSWER = (
    '{"hits": {"total": {"value": 57, "relation": "eq"}},'
    ' "aggregations": {"group": {"doc_count_error_upper_bound": 0, "sum_other_doc_count": 5,'
    ' "buckets": ['
    '{"key": "checkout", "doc_count": 40, "s2": {"value": 212.25}, "s3": {"value": 31}},'
    '{"key": "search", "doc_count": 12, "s2": {"value": 98.5}, "s3": {"value": 9}}]}}}'
)
INCREASE_ANSWER = (
    '{"hits": {"total": {"value": 10, "relation": "eq"}},'
    ' "aggregations": {"time": {"buckets": ['
    '{"key_as_string": "2026-09-25T10:00:00.000Z", "key": 1790330400000, "doc_count": 3,'
    ' "s1_max": {"value": 160.0}, "s1_min": {"value": 100.0}},'
    '{"key_as_string": "2026-09-25T10:01:00.000Z", "key": 1790330460000, "doc_count": 3,'
    ' "s1_max": {"value": 230.0}, "s1_min": {"value": 170.0}},'
    '{"key_as_string": "2026-09-25T10:02:00.000Z", "key": 1790330520000, "doc_count": 2,'
    ' "s1_max": {"value": 40.0}, "s1_min": {"value": 5.0}},'
    '{"key_as_string": "2026-09-25T10:03:00.000Z", "key": 1790330580000, "doc_count": 0,'
    ' "s1_max": {"value": null}, "s1_min": {"value": null}},'
    '{"key_as_string": "2026-09-25T10:04:00.000Z", "key": 1790330640000, "doc_count": 2,'
    ' "s1_max": {"value": 90.0}, "s1_min": {"value": 50.0}}]}}}'
)
WHOLE_RANGE_ANSWER = '{"hits": {"total": {"value": 3}}, "aggregations": {"s2": {"value": 115.49}}}'


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


def minutes(count: int) -> dict[str, str]:
    """From / To rows for `count` whole minutes from 10:00."""
    end = TEN + timedelta(minutes=count) - timedelta(milliseconds=1)
    return {"from": "2026-09-25T10:00:00.000Z", "to": f"{end:%Y-%m-%dT%H:%M:%S}.999Z"}


def upper(count: int) -> int:
    """The last millisecond of `count` whole minutes from 10:00."""
    return TEN_MS + count * 60000 - 1


def stat(**entry: Any) -> dict[str, Any]:
    return {"value": entry}


def aggregate(*stats: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    return {"mode": "aggregate", "stats": list(stats), **overrides}


def histogram(interval: str, lower: int, upper_ms: int, formatted: bool = True) -> dict[str, Any]:
    """The date_histogram of a time grouping; the internal Increase slots carry no format."""
    spec: dict[str, Any] = {
        "field": "@timestamp",
        "fixed_interval": interval,
        "min_doc_count": 0,
        "extended_bounds": {"min": lower, "max": upper_ms},
        "time_zone": "UTC",
    }
    if formatted:
        spec["format"] = "strict_date_optional_time"
    return spec


def terms(field: str = "service.name", size: int = 10) -> dict[str, Any]:
    return {"terms": {"field": field, "size": size, "order": {"_count": "desc"}}}


def body(aggs: dict[str, Any], lower: int = FROM_MS, upper_ms: int = NOW_MS) -> dict[str, Any]:
    window = {"range": {"@timestamp": {"gte": lower, "lte": upper_ms, "format": "epoch_millis"}}}
    return {
        "size": 0,
        "track_total_hits": True,
        "query": {"bool": {"filter": [window]}},
        "aggs": aggs,
    }


def answered(server: RecordingHTTPServer, answer: dict[str, Any] | str) -> None:
    """Queue the field list (one matching index), then the aggregation answer."""
    enqueue_json(server, field_caps_answer(FIELDS, INDICES))
    if isinstance(answer, str):
        enqueue_text(server, answer)
    else:
        enqueue_json(server, answer)


def slots(counts: list[int], seconds: int = 10) -> dict[str, Any]:
    """An answer grouped by time: one slot per count, `seconds` apart from 10:00."""
    buckets = [
        {
            "key_as_string": stamp(n, seconds),
            "key": TEN_MS + n * seconds * 1000,
            "doc_count": count,
        }
        for n, count in enumerate(counts)
    ]
    return search_answer([], sum(counts), aggregations={"time": {"buckets": buckets}})


def stamp(n: int, seconds: int = 10) -> str:
    return (TEN + timedelta(seconds=n * seconds)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def run(server: RecordingHTTPServer, log: LogRecorder, **overrides: Any) -> dict[str, Any]:
    return outputs(_opensearch_core.run(served(server, **overrides), log))


def values(table: dict[str, Any]) -> list[list[Any]]:
    """Rows as a bound Table holds them: float cells as exact Decimals."""
    bound = Table.from_dict(table)
    return [[bound.cell(row, col) for col in range(bound.col_count())] for row in range(len(bound))]


def console(log: LogRecorder) -> list[tuple[str, str]]:
    """Every line but the DEBUG request lines, each measured duration as N."""
    return [(level, timed([line])[0]) for level, line in log if level != "DEBUG"]


def run_line(total: str, table_rows: str, window: str = WINDOW) -> str:
    return f"Aggregate filebeat-* {window}: {total}, {table_rows}, N s"


def minutes_text(count: int) -> str:
    window = minutes(count)
    return f"from {window['from']} to {window['to']}"


def passed(out: dict[str, Any], total: int) -> None:
    """A passed, green run: the output core and Total results."""
    assert (out["total_results"], out["success"], out["error"], out["reason"]) == (
        total,
        True,
        "",
        "",
    )
    assert "__block_warning" not in out


class TestRequests:
    """Aggregate reads the field list, then sends one POST <index>/_search of size 0."""

    def test_the_field_list_then_one_search(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, WHOLE_RANGE_ANSWER)

        run(cluster, log, **aggregate(COUNT, group_by_time="none"))

        assert [(record["method"], record["path"]) for record in cluster.requests] == [
            ("GET", FIELD_CAPS),
            ("POST", SEARCH),
        ]
        body_text = cluster.requests[1]["body"].decode()
        assert log.at("DEBUG") == [f"GET {FIELD_CAPS}", f"POST {SEARCH} {body_text}"]
        assert body_text.startswith('{"size":0,"track_total_hits":true,')

    def test_time_slots_hold_the_stat_aggregations(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, PERCENTILE_PER_MINUTE_ANSWER)
        percentile = stat(stat="percentile", field="latency_ms", percent=95)

        run(cluster, log, **aggregate(COUNT, percentile, group_by_time="1m", **minutes(3)))

        percentiles = {"percentiles": {"field": "latency_ms", "percents": [95], "keyed": False}}
        assert sent_json(cluster, 1) == body(
            {
                "time": {
                    "date_histogram": histogram("1m", TEN_MS, upper(3)),
                    "aggs": {"s2": percentiles},
                }
            },
            TEN_MS,
            upper(3),
        )

    def test_one_global_top_n_of_the_field(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, TOP_VALUES_ANSWER)
        unique = stat(stat="unique_count", field="user.id")

        run(
            cluster,
            log,
            **aggregate(
                COUNT,
                AVERAGE,
                unique,
                group_by_time="none",
                group_by_field="service.name",
                top_values=2,
            ),
        )

        assert sent_json(cluster, 1) == body(
            {
                "group": {
                    **terms(size=2),
                    "aggs": {
                        "s2": {"avg": {"field": "latency_ms"}},
                        "s3": {"cardinality": {"field": "user.id"}},
                    },
                }
            }
        )

    def test_ungrouped_stats_sit_at_the_top(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, WHOLE_RANGE_ANSWER)

        run(
            cluster,
            log,
            **aggregate(COUNT, stat(stat="sum", field="bytes"), group_by_time="none"),
        )

        assert sent_json(cluster, 1) == body({"s2": {"sum": {"field": "bytes"}}})

    def test_terms_outside_time_when_grouped_by_both(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0, aggregations={"group": {"buckets": []}}))

        run(
            cluster,
            log,
            **aggregate(COUNT, AVERAGE, group_by_field="service.name", **minutes(2)),
        )

        assert sent_json(cluster, 1) == body(
            {
                "group": {
                    **terms(),
                    "aggs": {
                        "time": {
                            "date_histogram": histogram("1m", TEN_MS, upper(2)),
                            "aggs": {"s2": {"avg": {"field": "latency_ms"}}},
                        }
                    },
                }
            },
            TEN_MS,
            upper(2),
        )

    @pytest.mark.parametrize(
        ("stat_entry", "aggregation", "answer", "column"),
        [
            pytest.param(
                stat(stat="min", field="latency_ms"),
                {"min": {"field": "latency_ms"}},
                {"value": 12.0},
                "min of latency_ms",
                id="min",
            ),
            pytest.param(
                stat(stat="max", field="latency_ms"),
                {"max": {"field": "latency_ms"}},
                {"value": 812.0},
                "max of latency_ms",
                id="max",
            ),
            pytest.param(
                stat(stat="percentile", field="latency_ms", percent="99.9"),
                {"percentiles": {"field": "latency_ms", "percents": [99.9], "keyed": False}},
                {"values": [{"key": 99.9, "value": 950.0}]},
                "percentile 99.9 of latency_ms",
                id="percentile-from-text",
            ),
            pytest.param(
                stat(stat="custom", json='{"avg": {"field": "latency_ms"}}'),
                {"avg": {"field": "latency_ms"}},
                {"value": 212.0},
                "custom 1",
                id="custom",
            ),
            pytest.param(
                stat(
                    stat="custom",
                    json='{"terms": {"field": "service.name"}, '
                    '"aggs": {"top": {"max": {"field": "latency_ms"}}}}',
                ),
                {
                    "terms": {"field": "service.name"},
                    "aggs": {"top": {"max": {"field": "latency_ms"}}},
                },
                {"doc_count_error_upper_bound": 0, "sum_other_doc_count": 0, "buckets": []},
                "custom 1",
                id="custom-with-sub-aggregations",
            ),
        ],
    )
    def test_each_stat_aggregation(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        stat_entry: dict[str, Any],
        aggregation: dict[str, Any],
        answer: dict[str, Any],
        column: str,
    ) -> None:
        answered(cluster, search_answer([], 4, aggregations={"s1": answer}))

        out = run(cluster, log, **aggregate(stat_entry, group_by_time="none"))

        assert sent_json(cluster, 1)["aggs"] == {"s1": aggregation}
        assert [name for name, _kind in columns(out["results"])] == [column]

    @pytest.mark.parametrize(
        "stats",
        [
            pytest.param([{"stat": "count"}, {"stat": "sum", "field": "bytes"}], id="stat-maps"),
            pytest.param(
                [{"value": {"stat": "count"}}, {"value": {"stat": "sum", "field": "bytes"}}],
                id="value-rows",
            ),
        ],
    )
    def test_stats_from_the_row_expression(
        self, cluster: RecordingHTTPServer, log: LogRecorder, stats: list[Any]
    ) -> None:
        answered(cluster, WHOLE_RANGE_ANSWER)

        out = run(cluster, log, mode="aggregate", stats=stats, group_by_time="none")

        assert sent_json(cluster, 1) == body({"s2": {"sum": {"field": "bytes"}}})
        assert [name for name, _kind in columns(out["results"])] == ["count", "sum of bytes"]

    def test_increase_asks_max_and_min_per_time_slot(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, INCREASE_ANSWER)

        run(cluster, log, **aggregate(INCREASE, **minutes(5)))

        assert sent_json(cluster, 1)["aggs"] == {
            "time": {"date_histogram": histogram("1m", TEN_MS, upper(5)), "aggs": INCREASE_SLOTS}
        }

    @pytest.mark.parametrize(
        ("start", "end", "interval"),
        [
            pytest.param(
                "2026-09-25T10:00:00Z", "2026-09-25T10:00:29.999Z", "10s", id="30-seconds"
            ),
            pytest.param("2026-09-23T00:00:00Z", "2026-09-25T00:00:00Z", "30s", id="2-days"),
            pytest.param("2026-09-20T00:00:00Z", "2026-09-25T00:00:00Z", "1m", id="5-days"),
            pytest.param("2026-09-15T00:00:00Z", "2026-09-25T00:00:00Z", "5m", id="10-days"),
            pytest.param("2026-08-06T00:00:00Z", "2026-09-25T00:00:00Z", "15m", id="50-days"),
            pytest.param("2026-03-09T00:00:00Z", "2026-09-25T00:00:00Z", "1h", id="200-days"),
            pytest.param(
                "2025-05-13T00:00:00Z", "2026-09-25T00:00:00Z", "1h", id="500-days-none-fits"
            ),
        ],
    )
    def test_ungrouped_increase_uses_the_finest_slots_under_10000(
        self, cluster: RecordingHTTPServer, log: LogRecorder, start: str, end: str, interval: str
    ) -> None:
        answered(cluster, search_answer([], 0, aggregations={"s1_slots": {"buckets": []}}))

        run(cluster, log, **aggregate(INCREASE, group_by_time="none", **{"from": start, "to": end}))

        lower, upper_ms = ms(start), ms(end)
        assert sent_json(cluster, 1) == body(
            {
                "s1_slots": {
                    "date_histogram": histogram(interval, lower, upper_ms, formatted=False),
                    "aggs": INCREASE_SLOTS,
                }
            },
            lower,
            upper_ms,
        )

    def test_increase_by_field_keeps_its_slots_under_each_value(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 0, aggregations={"group": {"buckets": []}}))

        run(
            cluster,
            log,
            **aggregate(
                INCREASE,
                group_by_time="none",
                group_by_field="service.name",
                **{"from": "2026-09-25T10:00:00Z", "to": "2026-09-25T10:00:29.999Z"},
            ),
        )

        assert sent_json(cluster, 1)["aggs"] == {
            "group": {
                **terms(),
                "aggs": {
                    "s1_slots": {
                        "date_histogram": histogram("10s", TEN_MS, TEN_MS + 29999, formatted=False),
                        "aggs": INCREASE_SLOTS,
                    }
                },
            }
        }


class TestTables:
    """Results: time column, value column, one column per stat; quiet slots as 0 (OS-8)."""

    def test_percentile_per_minute(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, PERCENTILE_PER_MINUTE_ANSWER)
        percentile = stat(stat="percentile", field="latency_ms", percent=95)

        out = run(cluster, log, **aggregate(COUNT, percentile, **minutes(3)))

        assert columns(out["results"]) == [
            ("@timestamp", "string"),
            ("count", "integer"),
            ("percentile 95 of latency_ms", "float"),
        ]
        assert values(out["results"]) == [
            ["2026-09-25T10:00:00.000Z", 2, Decimal("812.5")],
            ["2026-09-25T10:01:00.000Z", 0, 0],
            ["2026-09-25T10:02:00.000Z", 4, Decimal("430.0")],
        ]
        passed(out, 6)
        assert console(log) == [("INFO", run_line("6 results", "3 rows", minutes_text(3)))]
        no_table_printed(log, out["results"])

    def test_top_values_by_field(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        answered(cluster, TOP_VALUES_ANSWER)
        unique = stat(stat="unique_count", field="user.id")

        out = run(
            cluster,
            log,
            **aggregate(
                COUNT,
                AVERAGE,
                unique,
                group_by_time="none",
                group_by_field="service.name",
                top_values=2,
            ),
        )

        assert columns(out["results"]) == [
            ("service.name", "string"),
            ("count", "integer"),
            ("average of latency_ms", "float"),
            ("unique count of user.id", "integer"),
        ]
        assert values(out["results"]) == [
            ["checkout", 40, Decimal("212.25"), 31],
            ["search", 12, Decimal("98.5"), 9],
        ]
        passed(out, 57)
        assert console(log) == [
            (
                "WARN",
                "Top values kept 2 values of service.name; 5 matching documents have other "
                "values and are left out",
            ),
            ("INFO", run_line("57 results", "2 rows")),
        ]
        no_table_printed(log, out["results"])

    def test_increase_counts_restarts_and_quiet_slots(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, INCREASE_ANSWER)

        out = run(cluster, log, **aggregate(INCREASE, **minutes(5)))

        assert columns(out["results"]) == [
            ("@timestamp", "string"),
            ("increase of requests_total", "float"),
        ]
        assert [row[1] for row in values(out["results"])] == [
            Decimal("60.0"),
            Decimal("70.0"),
            Decimal("35.0"),
            0,
            Decimal("50.0"),
        ]
        passed(out, 10)
        assert console(log) == [("INFO", run_line("10 results", "5 rows", minutes_text(5)))]
        no_table_printed(log, out["results"])

    def test_one_row_for_the_whole_range(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, WHOLE_RANGE_ANSWER)

        out = run(
            cluster,
            log,
            **aggregate(COUNT, stat(stat="sum", field="bytes"), group_by_time="none"),
        )

        assert columns(out["results"]) == [("count", "integer"), ("sum of bytes", "float")]
        assert values(out["results"]) == [[3, Decimal("115.49")]]
        passed(out, 3)
        assert console(log) == [("INFO", run_line("3 results", "1 row"))]
        no_table_printed(log, out["results"])

    def test_grouped_by_both_rows_run_by_time_then_terms_order(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(
            cluster,
            '{"hits": {"total": {"value": 52, "relation": "eq"}},'
            ' "aggregations": {"group": {"doc_count_error_upper_bound": 0,'
            ' "sum_other_doc_count": 0, "buckets": ['
            '{"key": "checkout", "doc_count": 40, "time": {"buckets": ['
            '{"key_as_string": "2026-09-25T10:00:00.000Z", "key": 1790330400000,'
            ' "doc_count": 25, "s2": {"value": 200.0}},'
            '{"key_as_string": "2026-09-25T10:01:00.000Z", "key": 1790330460000,'
            ' "doc_count": 15, "s2": {"value": 230.5}}]}},'
            '{"key": "search", "doc_count": 12, "time": {"buckets": ['
            '{"key_as_string": "2026-09-25T10:00:00.000Z", "key": 1790330400000,'
            ' "doc_count": 5, "s2": {"value": 90.0}},'
            '{"key_as_string": "2026-09-25T10:01:00.000Z", "key": 1790330460000,'
            ' "doc_count": 7, "s2": {"value": 105.25}}]}}]}}}',
        )

        out = run(
            cluster,
            log,
            **aggregate(COUNT, AVERAGE, group_by_field="service.name", **minutes(2)),
        )

        assert [name for name, _kind in columns(out["results"])] == [
            "@timestamp",
            "service.name",
            "count",
            "average of latency_ms",
        ]
        assert values(out["results"]) == [
            ["2026-09-25T10:00:00.000Z", "checkout", 25, Decimal("200.0")],
            ["2026-09-25T10:00:00.000Z", "search", 5, Decimal("90.0")],
            ["2026-09-25T10:01:00.000Z", "checkout", 15, Decimal("230.5")],
            ["2026-09-25T10:01:00.000Z", "search", 7, Decimal("105.25")],
        ]
        passed(out, 52)
        assert console(log) == [("INFO", run_line("52 results", "4 rows", minutes_text(2)))]
        no_table_printed(log, out["results"])

    @pytest.mark.parametrize(
        ("field", "buckets", "cells", "kind"),
        [
            pytest.param(
                "http.status",
                [{"key": 200, "doc_count": 9}, {"key": 500, "doc_count": 2}],
                [200, 500],
                "integer",
                id="key",
            ),
            pytest.param(
                "ok",
                [{"key": 1, "key_as_string": "true", "doc_count": 9}],
                ["true"],
                "string",
                id="key-as-string",
            ),
        ],
    )
    def test_the_value_cell(
        self,
        cluster: RecordingHTTPServer,
        log: LogRecorder,
        field: str,
        buckets: list[dict[str, Any]],
        cells: list[Any],
        kind: str,
    ) -> None:
        group = {"doc_count_error_upper_bound": 0, "sum_other_doc_count": 0, "buckets": buckets}
        answered(cluster, search_answer([], 11, aggregations={"group": group}))

        out = run(cluster, log, **aggregate(COUNT, group_by_time="none", group_by_field=field))

        assert columns(out["results"])[0] == (field, kind)
        assert [row[0] for row in rows(out["results"])] == cells

    def test_a_null_in_a_slot_with_documents_stays_empty(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(
            cluster,
            '{"hits": {"total": {"value": 5, "relation": "eq"}},'
            ' "aggregations": {"time": {"buckets": ['
            '{"key_as_string": "2026-09-25T10:00:00.000Z", "key": 1790330400000,'
            ' "doc_count": 2, "s2": {"value": 812.5}},'
            '{"key_as_string": "2026-09-25T10:01:00.000Z", "key": 1790330460000,'
            ' "doc_count": 3, "s2": {"value": null}}]}}}',
        )

        out = run(
            cluster,
            log,
            **aggregate(COUNT, stat(stat="max", field="latency_ms"), **minutes(2)),
        )

        assert values(out["results"]) == [
            ["2026-09-25T10:00:00.000Z", 2, Decimal("812.5")],
            ["2026-09-25T10:01:00.000Z", 3, None],
        ]
        assert console(log) == [("INFO", run_line("5 results", "2 rows", minutes_text(2)))]
        no_table_printed(log, out["results"])

    @pytest.mark.parametrize(
        ("total", "cells"),
        [
            pytest.param(0, [[0, 0]], id="no-documents-null-is-0"),
            pytest.param(3, [[3, None]], id="documents-null-stays-empty"),
        ],
    )
    def test_ungrouped_nulls(
        self, cluster: RecordingHTTPServer, log: LogRecorder, total: int, cells: list[list[Any]]
    ) -> None:
        answered(cluster, search_answer([], total, aggregations={"s2": {"value": None}}))

        out = run(cluster, log, **aggregate(COUNT, AVERAGE, group_by_time="none"))

        assert values(out["results"]) == cells
        passed(out, total)

    def test_custom_cells_take_the_value_or_the_answer_as_json(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(
            cluster,
            '{"hits": {"total": {"value": 2, "relation": "eq"}}, "aggregations": {'
            '"s2": {"value": 2.0},'
            ' "s3": {"meta": {"unit": "ms"}, "count": 2, "min": 1.0, "max": 3.0, "avg": 2.0,'
            ' "sum": 4.0}}}',
        )
        named = stat(stat="custom", json='{"avg": {"field": "latency_ms"}}', name="mean latency")
        unnamed = stat(
            stat="custom", json='{"stats": {"field": "latency_ms"}, "meta": {"unit": "ms"}}'
        )

        out = run(cluster, log, **aggregate(COUNT, named, unnamed, group_by_time="none"))

        assert sent_json(cluster, 1)["aggs"] == {
            "s2": {"avg": {"field": "latency_ms"}},
            "s3": {"stats": {"field": "latency_ms"}, "meta": {"unit": "ms"}},
        }
        stats_text = '{"count":2,"min":1.0,"max":3.0,"avg":2.0,"sum":4.0}'
        assert columns(out["results"]) == [
            ("count", "integer"),
            ("mean latency", "float"),
            ("custom 3", "string"),
        ]
        assert values(out["results"]) == [[2, Decimal("2.0"), stats_text]]
        assert console(log) == [("INFO", run_line("2 results", "1 row"))]
        no_table_printed(log, out["results"])
        assert [line for _level, line in log if stats_text in line] == []

    def test_ungrouped_increase_sums_its_internal_slots(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(
            cluster,
            '{"hits": {"total": {"value": 8, "relation": "eq"}},'
            ' "aggregations": {"s1_slots": {"buckets": ['
            '{"key_as_string": "2026-09-25T10:00:00.000Z", "key": 1790330400000, "doc_count": 3,'
            ' "s1_max": {"value": 160.0}, "s1_min": {"value": 100.0}},'
            '{"key_as_string": "2026-09-25T10:00:10.000Z", "key": 1790330410000, "doc_count": 3,'
            ' "s1_max": {"value": 230.0}, "s1_min": {"value": 170.0}},'
            '{"key_as_string": "2026-09-25T10:00:20.000Z", "key": 1790330420000, "doc_count": 2,'
            ' "s1_max": {"value": 40.0}, "s1_min": {"value": 5.0}}]}}}',
        )

        out = run(
            cluster,
            log,
            **aggregate(
                INCREASE,
                group_by_time="none",
                **{"from": "2026-09-25T10:00:00Z", "to": "2026-09-25T10:00:29.999Z"},
            ),
        )

        assert columns(out["results"]) == [("increase of requests_total", "float")]
        assert values(out["results"]) == [[Decimal("165.0")]]
        passed(out, 8)

    def test_increase_by_field_is_one_series_per_value(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(
            cluster,
            '{"hits": {"total": {"value": 10, "relation": "eq"}},'
            ' "aggregations": {"group": {"doc_count_error_upper_bound": 0,'
            ' "sum_other_doc_count": 0, "buckets": ['
            '{"key": "checkout", "doc_count": 8, "s1_slots": {"buckets": ['
            '{"key": 1790330400000, "doc_count": 3,'
            ' "s1_max": {"value": 160.0}, "s1_min": {"value": 100.0}},'
            '{"key": 1790330410000, "doc_count": 3,'
            ' "s1_max": {"value": 230.0}, "s1_min": {"value": 170.0}},'
            '{"key": 1790330420000, "doc_count": 2,'
            ' "s1_max": {"value": 40.0}, "s1_min": {"value": 5.0}}]}},'
            '{"key": "search", "doc_count": 2, "s1_slots": {"buckets": ['
            '{"key": 1790330400000, "doc_count": 1,'
            ' "s1_max": {"value": 20.0}, "s1_min": {"value": 10.0}},'
            '{"key": 1790330410000, "doc_count": 0,'
            ' "s1_max": {"value": null}, "s1_min": {"value": null}},'
            '{"key": 1790330420000, "doc_count": 1,'
            ' "s1_max": {"value": 30.0}, "s1_min": {"value": 25.0}}]}}]}}}',
        )

        out = run(
            cluster,
            log,
            **aggregate(
                INCREASE,
                group_by_time="none",
                group_by_field="service.name",
                **{"from": "2026-09-25T10:00:00Z", "to": "2026-09-25T10:00:29.999Z"},
            ),
        )

        assert values(out["results"]) == [
            ["checkout", Decimal("165.0")],
            ["search", Decimal("20.0")],
        ]
        passed(out, 10)


class TestRunLog:
    """The WARNs, then the run line, and never the Results data, which stays in Results (OS-10)."""

    def test_many_rows_print_nothing(self, cluster: RecordingHTTPServer, log: LogRecorder) -> None:
        counts = [n % 3 for n in range(130)]
        answered(cluster, slots(counts))
        window = {"from": "2026-09-25T10:00:00.000Z", "to": "2026-09-25T10:21:39.999Z"}

        out = run(cluster, log, **aggregate(COUNT, group_by_time="10s", **window))

        assert values(out["results"])[-1] == [stamp(129), 0]
        assert len(out["results"]["rows"]) == 130
        window_text = "from 2026-09-25T10:00:00.000Z to 2026-09-25T10:21:39.999Z"
        assert console(log) == [
            ("INFO", run_line(f"{sum(counts)} results", "130 rows", window_text))
        ]
        no_table_printed(log, out["results"])

    def test_empty_results_print_only_the_run_line(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        group = {"doc_count_error_upper_bound": 0, "sum_other_doc_count": 0, "buckets": []}
        answered(cluster, search_answer([], 0, aggregations={"group": group}))

        out = run(
            cluster,
            log,
            **aggregate(COUNT, group_by_time="none", group_by_field="service.name"),
        )

        assert rows(out["results"]) == []
        passed(out, 0)
        assert console(log) == [("INFO", run_line("0 results", "0 rows"))]

    def test_one_result_and_one_row_read_in_the_singular(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, search_answer([], 1, aggregations={}))

        out = run(cluster, log, **aggregate(COUNT, group_by_time="none"))

        assert console(log) == [("INFO", run_line("1 result", "1 row"))]
        no_table_printed(log, out["results"])

    def test_no_top_values_warning_when_nothing_is_left_out(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        group = {
            "doc_count_error_upper_bound": 0,
            "sum_other_doc_count": 0,
            "buckets": [{"key": "checkout", "doc_count": 40}],
        }
        answered(cluster, search_answer([], 40, aggregations={"group": group}))

        run(
            cluster,
            log,
            **aggregate(COUNT, group_by_time="none", group_by_field="service.name"),
        )

        assert log.at("WARN") == []


class TestThroughExecute:
    """The plugin path hands back a typed Table with exact decimals."""

    async def test_results_arrive_as_a_table(
        self, cluster: RecordingHTTPServer, log: LogRecorder
    ) -> None:
        answered(cluster, WHOLE_RANGE_ANSWER)
        params = served(
            cluster, **aggregate(COUNT, stat(stat="sum", field="bytes"), group_by_time="none")
        )

        out = await OpenSearchPlugin().execute(os_context(params, log))

        table = out["results"]
        assert isinstance(table, Table)
        assert table.col_types() == ["integer", "float"]
        assert (table.col("count"), table.col("sum of bytes")) == ([3], [Decimal("115.49")])
        passed(out, 3)
        assert log.at("INFO")[0].startswith("Aggregate filebeat-* ")
