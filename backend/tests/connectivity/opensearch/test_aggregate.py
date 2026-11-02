"""Stats: entry checks, column names and the aggregation body (REQ-3.3.3.2, OS-7).

Each Stats entry makes one named column; the entry checks refuse entries that cannot make
one; the body groups by time and / or by field and names each stat `s<n>` by its position.
"""

import json
from decimal import Decimal
from typing import Any

import pytest

from wavecore.connectivity.opensearch._aggregate import aggregation_body, check_stats, column_name
from wavecore.connectivity.opensearch._errors import OpenSearchFailure
from wavecore.connectivity.opensearch._time import Window

FROM_MS = 1790330400000
TO_MS = 1790330579999
WINDOW = Window(from_ms=FROM_MS, to_ms=TO_MS)
MINUTE = 60_000
DAY = 86_400_000
CUSTOM_ONE = '{"avg": {"field": "latency_ms"}}'
COUNT = {"stat": "count"}
NOT_ONE_AGGREGATION = (
    'Stat 2 (Custom (JSON)) must be one aggregation, such as {"avg": {"field": "latency_ms"}}'
)
LABELS = [
    ("sum", "Sum"),
    ("average", "Average"),
    ("min", "Min"),
    ("max", "Max"),
    ("percentile", "Percentile"),
    ("unique_count", "Unique count"),
    ("increase", "Increase"),
]


def names(*entries: Any, time_field: str = "@timestamp", group_field: str = "") -> list[str]:
    return [column_name(stat) for stat in check_stats(list(entries), time_field, group_field)]


def refused(
    entries: list[Any], message: str, time_field: str = "@timestamp", group_field: str = ""
) -> None:
    with pytest.raises(OpenSearchFailure) as caught:
        check_stats(entries, time_field, group_field)
    assert caught.value.message == message
    assert caught.value.reason == "Validation"


def aggs(body: dict[str, Any]) -> dict[str, Any]:
    """The `aggs` object, whether the body wraps it or is it."""
    if "size" in body:
        assert body["size"] == 0
        assert body["track_total_hits"] is True
        return dict(body["aggs"])
    return body


def plain(value: Any) -> Any:
    """Numbers compared by value, whatever number type carries them."""
    return json.loads(json.dumps(value, default=float))


def raw_body(
    entries: list[Any],
    group_by_time: str = "none",
    group_field: str = "",
    top_values: int = 10,
    window: Window = WINDOW,
    time_field: str = "@timestamp",
) -> dict[str, Any]:
    checked = check_stats(entries, time_field, group_field)
    return aggs(
        aggregation_body(checked, time_field, group_by_time, group_field, top_values, window)
    )


def body(entries: list[Any], **options: Any) -> Any:
    return plain(raw_body(entries, **options))


def histogram(
    interval: str,
    field: str = "@timestamp",
    *,
    formatted: bool = True,
    window: Window = WINDOW,
) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "field": field,
        "fixed_interval": interval,
        "min_doc_count": 0,
        "extended_bounds": {"min": window.from_ms, "max": window.to_ms},
        "time_zone": "UTC",
    }
    if formatted:
        spec["format"] = "strict_date_optional_time"
    return {"date_histogram": spec}


def terms(field: str, size: int) -> dict[str, Any]:
    return {"terms": {"field": field, "size": size, "order": {"_count": "desc"}}}


def increase_slots(number: int, field: str, interval: str, window: Window = WINDOW) -> Any:
    return {
        **histogram(interval, formatted=False, window=window),
        "aggs": {
            f"s{number}_max": {"max": {"field": field}},
            f"s{number}_min": {"min": {"field": field}},
        },
    }


class TestColumnNames:
    """Each stat names its column in words (OS-7); Custom takes its name or `custom <n>`."""

    @pytest.mark.parametrize(
        ("entry", "name"),
        [
            pytest.param(COUNT, "count", id="count"),
            pytest.param({"stat": "sum", "field": "bytes"}, "sum of bytes", id="sum"),
            pytest.param(
                {"stat": "average", "field": "latency_ms"}, "average of latency_ms", id="average"
            ),
            pytest.param({"stat": "min", "field": "latency_ms"}, "min of latency_ms", id="min"),
            pytest.param({"stat": "max", "field": "latency_ms"}, "max of latency_ms", id="max"),
            pytest.param(
                {"stat": "percentile", "field": "latency_ms", "percent": 95},
                "percentile 95 of latency_ms",
                id="percentile",
            ),
            pytest.param(
                {"stat": "unique_count", "field": "user.id"},
                "unique count of user.id",
                id="unique-count",
            ),
            pytest.param(
                {"stat": "increase", "field": "requests_total"},
                "increase of requests_total",
                id="increase",
            ),
            pytest.param(
                {"stat": "custom", "json": CUSTOM_ONE, "name": "mean latency"},
                "mean latency",
                id="custom-named",
            ),
        ],
    )
    def test_the_column_a_stat_makes(self, entry: dict[str, Any], name: str) -> None:
        assert names(entry) == [name]

    def test_a_blank_custom_name_is_custom_and_its_position(self) -> None:
        assert names(
            COUNT,
            {"stat": "custom", "json": CUSTOM_ONE},
            {"stat": "custom", "json": CUSTOM_ONE, "name": ""},
            {"stat": "custom", "json": CUSTOM_ONE, "name": "   "},
        ) == ["count", "custom 2", "custom 3", "custom 4"]

    def test_a_field_on_count_is_ignored(self) -> None:
        assert names({"stat": "count", "field": "bytes"}) == ["count"]

    def test_columns_follow_the_list_order(self) -> None:
        assert names(
            {"stat": "max", "field": "latency_ms"}, COUNT, {"stat": "sum", "field": "bytes"}
        ) == ["max of latency_ms", "count", "sum of bytes"]

    @pytest.mark.parametrize(
        ("percent", "written"),
        [
            pytest.param(95, "95", id="integer"),
            pytest.param(95.0, "95", id="integral-float"),
            pytest.param("95", "95", id="integer-text"),
            pytest.param("95.0", "95", id="integral-text"),
            pytest.param(Decimal("95.00"), "95", id="integral-decimal"),
            pytest.param(99.9, "99.9", id="float"),
            pytest.param("99.9", "99.9", id="decimal-text"),
            pytest.param("99.90", "99.9", id="trailing-zero-dropped"),
            pytest.param(Decimal("99.9"), "99.9", id="decimal"),
            pytest.param(0.5, "0.5", id="below-one"),
            pytest.param(0, "0", id="zero"),
            pytest.param(100, "100", id="one-hundred"),
        ],
    )
    def test_the_percent_in_its_shortest_form(self, percent: Any, written: str) -> None:
        entry = {"stat": "percentile", "field": "latency_ms", "percent": percent}

        assert names(entry) == [f"percentile {written} of latency_ms"]


class TestEntryChecks:
    """Each entry names a stat and what that stat needs (REQ-3.3.3.2)."""

    def test_no_entry(self) -> None:
        refused([], "Stats needs at least one entry")

    @pytest.mark.parametrize(
        ("entry", "kind"),
        [
            pytest.param("count", "a string", id="string"),
            pytest.param(["count"], "an array", id="array"),
            pytest.param(5, "an integer", id="integer"),
            pytest.param(1.5, "a float", id="float"),
            pytest.param(True, "a boolean", id="boolean"),
        ],
    )
    def test_an_entry_that_is_not_a_map(self, entry: Any, kind: str) -> None:
        refused(
            [COUNT, entry],
            f'Stat 2 must be a map with a stat, such as {{"stat": "count"}}; it is {kind}',
        )

    @pytest.mark.parametrize("word", ["median", "avg", "Count"])
    def test_a_word_that_is_not_a_stat(self, word: str) -> None:
        refused(
            [COUNT, {"stat": word, "field": "latency_ms"}],
            f"Stat 2: '{word}' is not a stat. Use count, sum, average, min, max, percentile, "
            "unique_count, increase or custom",
        )

    @pytest.mark.parametrize(("stat", "label"), LABELS)
    @pytest.mark.parametrize("field", [None, "", "   "], ids=["absent", "empty", "spaces"])
    def test_a_stat_without_its_field(self, stat: str, label: str, field: str | None) -> None:
        entry: dict[str, Any] = {"stat": stat}
        if stat == "percentile":
            entry["percent"] = 95
        if field is not None:
            entry["field"] = field

        refused([COUNT, entry], f"Stat 2 ({label}) needs a Field")

    @pytest.mark.parametrize(
        "percent",
        [None, "", "abc", -1, -0.5, 100.5, 101, "101"],
        ids=[
            "absent",
            "empty",
            "text",
            "below-zero",
            "just-below-zero",
            "past-100",
            "101",
            "101-text",
        ],
    )
    def test_a_percentile_without_a_percent_from_0_to_100(self, percent: Any) -> None:
        entry: dict[str, Any] = {"stat": "percentile", "field": "latency_ms"}
        if percent is not None:
            entry["percent"] = percent

        refused([COUNT, entry], "Stat 2 (Percentile) needs a Percent from 0 to 100")

    @pytest.mark.parametrize("percent", [0, 100, "50", 99.9, "99.9"])
    def test_the_percent_bounds_are_inclusive(self, percent: Any) -> None:
        entry = {"stat": "percentile", "field": "latency_ms", "percent": percent}

        assert len(check_stats([entry], "@timestamp", "")) == 1

    @pytest.mark.parametrize("json_text", [None, "", "   "], ids=["absent", "empty", "spaces"])
    def test_a_custom_stat_without_its_json(self, json_text: str | None) -> None:
        entry: dict[str, Any] = {"stat": "custom", "name": "p50"}
        if json_text is not None:
            entry["json"] = json_text

        refused([COUNT, entry], "Stat 2 (Custom (JSON)) needs its aggregation JSON")

    @pytest.mark.parametrize(
        ("json_text", "position", "text"),
        [
            pytest.param('{"avg": }', "line 1, column 9", "Expected a value", id="pinned"),
            pytest.param(
                '{"avg": {"field": "a"}\n  "max": {"field": "b"}}',
                "line 2, column 3",
                "Expected , or }",
                id="member-without-comma",
            ),
            pytest.param(
                '{"avg": {"field": "a", "field": "b"}}',
                "line 1, column 24",
                'Duplicate key "field"',
                id="duplicate-key",
            ),
        ],
    )
    def test_custom_json_that_does_not_parse(
        self, json_text: str, position: str, text: str
    ) -> None:
        refused(
            [COUNT, {"stat": "custom", "json": json_text}],
            f"Stat 2 (Custom (JSON)) is not valid JSON at {position}: {text}",
        )

    @pytest.mark.parametrize(
        "json_text",
        [
            '["avg"]',
            '"avg"',
            "42",
            "{}",
            '{"meta": {"unit": "ms"}}',
            '{"aggs": {"m": {"max": {"field": "y"}}}}',
            '{"avg": {"field": "a"}, "max": {"field": "b"}}',
        ],
        ids=[
            "array",
            "string",
            "number",
            "empty-object",
            "meta-only",
            "sub-aggregations-only",
            "two-aggregations",
        ],
    )
    def test_custom_json_that_is_not_one_aggregation(self, json_text: str) -> None:
        refused([COUNT, {"stat": "custom", "json": json_text}], NOT_ONE_AGGREGATION)

    @pytest.mark.parametrize(
        "json_text",
        [
            '{"avg": {"field": "latency_ms"}, "meta": {"unit": "ms"}}',
            '{"terms": {"field": "x"}, "aggs": {"m": {"max": {"field": "y"}}}}',
            '{"terms": {"field": "x"}, "aggregations": {"m": {"min": {"field": "y"}}}}',
            '// the mean\n{"avg": /* ms */ {"field": "latency_ms"}}',
        ],
        ids=["meta", "aggs", "aggregations", "comments"],
    )
    def test_one_aggregation_with_its_companions(self, json_text: str) -> None:
        assert names({"stat": "custom", "json": json_text}) == ["custom 1"]


class TestColumnChecks:
    """Every column name is its own and not one the grouping uses."""

    @pytest.mark.parametrize(
        ("entries", "message"),
        [
            pytest.param(
                [COUNT, {"stat": "sum", "field": "bytes"}, COUNT],
                "Stats 1 and 3 both make the column 'count'; each stat needs its own column",
                id="pinned",
            ),
            pytest.param(
                [COUNT, COUNT, COUNT],
                "Stats 1 and 2 both make the column 'count'; each stat needs its own column",
                id="the-first-pair-is-named",
            ),
            pytest.param(
                [
                    {"stat": "percentile", "field": "latency_ms", "percent": 95},
                    {"stat": "percentile", "field": "latency_ms", "percent": "95.0"},
                ],
                "Stats 1 and 2 both make the column 'percentile 95 of latency_ms'; "
                "each stat needs its own column",
                id="the-same-percent-written-twice",
            ),
            pytest.param(
                [
                    {"stat": "sum", "field": "bytes"},
                    {"stat": "custom", "json": CUSTOM_ONE, "name": "sum of bytes"},
                ],
                "Stats 1 and 2 both make the column 'sum of bytes'; each stat needs its own column",
                id="a-custom-name-meets-a-stat",
            ),
            pytest.param(
                [
                    COUNT,
                    {"stat": "custom", "json": CUSTOM_ONE},
                    {"stat": "custom", "json": CUSTOM_ONE, "name": "custom 2"},
                ],
                "Stats 2 and 3 both make the column 'custom 2'; each stat needs its own column",
                id="a-blank-custom-name-meets-a-named-one",
            ),
        ],
    )
    def test_two_entries_make_the_same_column(self, entries: list[Any], message: str) -> None:
        refused(entries, message)

    def test_the_time_column(self) -> None:
        refused(
            [COUNT, {"stat": "custom", "json": CUSTOM_ONE, "name": "@timestamp"}],
            "Stat 2 makes the column '@timestamp', which the grouping already uses",
        )

    def test_another_time_field(self) -> None:
        refused(
            [COUNT, {"stat": "custom", "json": CUSTOM_ONE, "name": "event.created"}],
            "Stat 2 makes the column 'event.created', which the grouping already uses",
            time_field="event.created",
        )

    def test_the_group_by_field(self) -> None:
        refused(
            [{"stat": "custom", "json": CUSTOM_ONE, "name": "service.name"}],
            "Stat 1 makes the column 'service.name', which the grouping already uses",
            group_field="service.name",
        )

    def test_a_field_named_like_a_stat(self) -> None:
        refused(
            [COUNT],
            "Stat 1 makes the column 'count', which the grouping already uses",
            group_field="count",
        )

    def test_a_shared_column_is_found_before_a_grouping_column(self) -> None:
        stamped = {"stat": "custom", "json": CUSTOM_ONE, "name": "@timestamp"}

        refused(
            [stamped, stamped],
            "Stats 1 and 2 both make the column '@timestamp'; each stat needs its own column",
        )


class TestUngroupedBody:
    """Group by time No and no Group by field: the stat aggregations at the top."""

    def test_count_alone_asks_for_no_aggregation(self) -> None:
        assert body([COUNT]) == {}

    def test_the_whole_range_body(self) -> None:
        assert body([COUNT, {"stat": "sum", "field": "bytes"}]) == {
            "s2": {"sum": {"field": "bytes"}}
        }

    @pytest.mark.parametrize(
        ("entry", "aggregation"),
        [
            pytest.param({"stat": "sum", "field": "bytes"}, {"sum": {"field": "bytes"}}, id="sum"),
            pytest.param({"stat": "average", "field": "ms"}, {"avg": {"field": "ms"}}, id="avg"),
            pytest.param({"stat": "min", "field": "ms"}, {"min": {"field": "ms"}}, id="min"),
            pytest.param({"stat": "max", "field": "ms"}, {"max": {"field": "ms"}}, id="max"),
            pytest.param(
                {"stat": "percentile", "field": "ms", "percent": 95},
                {"percentiles": {"field": "ms", "percents": [95], "keyed": False}},
                id="percentile",
            ),
            pytest.param(
                {"stat": "percentile", "field": "ms", "percent": "99.9"},
                {"percentiles": {"field": "ms", "percents": [99.9], "keyed": False}},
                id="percentile-from-text",
            ),
            pytest.param(
                {"stat": "unique_count", "field": "user.id"},
                {"cardinality": {"field": "user.id"}},
                id="unique-count",
            ),
        ],
    )
    def test_each_stat_aggregation(self, entry: dict[str, Any], aggregation: Any) -> None:
        assert body([COUNT, entry]) == {"s2": aggregation}

    def test_increase_adds_internal_time_slots(self) -> None:
        window = Window(from_ms=FROM_MS, to_ms=FROM_MS + 15 * MINUTE - 1)

        assert body([COUNT, {"stat": "increase", "field": "requests_total"}], window=window) == {
            "s2_slots": increase_slots(2, "requests_total", "10s", window)
        }

    def test_a_custom_stat_is_its_aggregation(self) -> None:
        entry = {"stat": "custom", "json": '{"value_count": {"field": "trace.id"}}'}

        assert body([entry]) == {"s1": {"value_count": {"field": "trace.id"}}}


class TestGroupedByTimeBody:
    """Group by time set, no field: one date histogram over the window with the stats inside."""

    def test_the_percentile_per_minute_body(self) -> None:
        entries = [COUNT, {"stat": "percentile", "field": "latency_ms", "percent": 95}]

        assert body(entries, group_by_time="1m") == {
            "time": {
                **histogram("1m"),
                "aggs": {
                    "s2": {"percentiles": {"field": "latency_ms", "percents": [95], "keyed": False}}
                },
            }
        }

    @pytest.mark.parametrize("interval", ["10s", "30s", "1m", "5m", "15m", "1h"])
    def test_each_interval(self, interval: str) -> None:
        result = body([COUNT, {"stat": "max", "field": "ms"}], group_by_time=interval)

        assert result == {"time": {**histogram(interval), "aggs": {"s2": {"max": {"field": "ms"}}}}}

    def test_count_alone_has_no_inner_aggregation(self) -> None:
        result = body([COUNT], group_by_time="5m")

        assert result["time"]["date_histogram"] == histogram("5m")["date_histogram"]
        assert result["time"].get("aggs", {}) == {}

    def test_the_histogram_reads_the_time_field(self) -> None:
        result = body([COUNT], group_by_time="1h", time_field="event.created")

        assert (
            result["time"]["date_histogram"] == histogram("1h", "event.created")["date_histogram"]
        )

    def test_increase_sits_in_the_time_slots(self) -> None:
        result = body([{"stat": "increase", "field": "requests_total"}, COUNT], group_by_time="1m")

        assert result == {
            "time": {
                **histogram("1m"),
                "aggs": {
                    "s1_max": {"max": {"field": "requests_total"}},
                    "s1_min": {"min": {"field": "requests_total"}},
                },
            }
        }


class TestGroupedByFieldBody:
    """Group by field, no time: a terms aggregation of the Top values with the stats inside."""

    def test_the_top_values_by_field_body(self) -> None:
        entries = [
            COUNT,
            {"stat": "average", "field": "latency_ms"},
            {"stat": "unique_count", "field": "user.id"},
        ]

        assert body(entries, group_field="service.name", top_values=2) == {
            "group": {
                **terms("service.name", 2),
                "aggs": {
                    "s2": {"avg": {"field": "latency_ms"}},
                    "s3": {"cardinality": {"field": "user.id"}},
                },
            }
        }

    def test_increase_adds_internal_slots_per_value(self) -> None:
        window = Window(from_ms=FROM_MS, to_ms=FROM_MS + 2 * DAY - 1)
        entries = [{"stat": "increase", "field": "requests_total"}]

        assert body(entries, group_field="service.name", window=window) == {
            "group": {
                **terms("service.name", 10),
                "aggs": {"s1_slots": increase_slots(1, "requests_total", "30s", window)},
            }
        }


class TestGroupedByBothBody:
    """Both groupings: terms outside, so Top values is one global top N, then the time slots."""

    def test_terms_hold_the_histogram(self) -> None:
        entries = [COUNT, {"stat": "sum", "field": "bytes"}]

        assert body(entries, group_by_time="5m", group_field="host.name", top_values=3) == {
            "group": {
                **terms("host.name", 3),
                "aggs": {"time": {**histogram("5m"), "aggs": {"s2": {"sum": {"field": "bytes"}}}}},
            }
        }

    def test_increase_sits_in_the_inner_time_slots(self) -> None:
        entries = [{"stat": "increase", "field": "requests_total"}]

        assert body(entries, group_by_time="1m", group_field="host.name") == {
            "group": {
                **terms("host.name", 10),
                "aggs": {
                    "time": {
                        **histogram("1m"),
                        "aggs": {
                            "s1_max": {"max": {"field": "requests_total"}},
                            "s1_min": {"min": {"field": "requests_total"}},
                        },
                    }
                },
            }
        }


class TestIncreaseSlotInterval:
    """Ungrouped by time, Increase uses the smallest interval giving at most 10,000 slots."""

    @pytest.mark.parametrize(
        ("span_ms", "interval"),
        [
            pytest.param(15 * MINUTE, "10s", id="15-minutes"),
            pytest.param(2 * DAY, "30s", id="2-days"),
            pytest.param(5 * DAY, "1m", id="5-days"),
            pytest.param(30 * DAY, "5m", id="30-days"),
            pytest.param(90 * DAY, "15m", id="90-days"),
            pytest.param(300 * DAY, "1h", id="300-days"),
            pytest.param(500 * DAY, "1h", id="past-10000-hours-is-the-largest"),
        ],
    )
    def test_the_interval_for_the_window(self, span_ms: int, interval: str) -> None:
        window = Window(from_ms=FROM_MS, to_ms=FROM_MS + span_ms - 1)

        result = body([{"stat": "increase", "field": "requests_total"}], window=window)

        assert result == {"s1_slots": increase_slots(1, "requests_total", interval, window)}


class TestCustomBody:
    """Custom (JSON) is taken literally: exact numbers, `{{ }}` never filled."""

    def test_numbers_keep_their_exact_digits(self) -> None:
        entry = {
            "stat": "custom",
            "json": '{"percentiles": {"field": "latency_ms", "percents": [99.90]}}',
        }

        custom = raw_body([entry])["s1"]

        assert custom == {"percentiles": {"field": "latency_ms", "percents": [Decimal("99.90")]}}
        assert str(custom["percentiles"]["percents"][0]) == "99.90"

    def test_template_markers_stay_as_written(self) -> None:
        entry = {"stat": "custom", "json": '{"terms": {"field": "{{ group }}"}}'}

        assert body([entry]) == {"s1": {"terms": {"field": "{{ group }}"}}}

    def test_sub_aggregations_and_meta_are_kept(self) -> None:
        entry = {
            "stat": "custom",
            "json": '{"terms": {"field": "x"}, "aggs": {"m": {"max": {"field": "y"}}}, '
            '"meta": {"unit": "ms"}}',
        }

        assert body([COUNT, entry], group_by_time="1m")["time"]["aggs"] == {
            "s2": {
                "terms": {"field": "x"},
                "aggs": {"m": {"max": {"field": "y"}}},
                "meta": {"unit": "ms"},
            }
        }
