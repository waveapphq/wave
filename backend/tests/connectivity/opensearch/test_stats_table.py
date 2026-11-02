"""The aggregation answer to the Aggregate Results table (REQ-3.3.3.2, OS-8, OS-9).

One row per time slot, field value or pair, or one row for the whole range; quiet slots show 0;
Increase is worked out from per-slot max and min with restarts counted from the slot;
Top values leaving documents out is said at WARN.
"""

import json
from decimal import Decimal
from typing import Any

import pytest

from wavecore.connectivity.opensearch._aggregate import check_stats
from wavecore.connectivity.opensearch._stats_table import Slot, increases, stats_table

T0 = "2026-09-25T10:00:00.000Z"
T1 = "2026-09-25T10:01:00.000Z"
T2 = "2026-09-25T10:02:00.000Z"
T3 = "2026-09-25T10:03:00.000Z"
T4 = "2026-09-25T10:04:00.000Z"
KEY_T0 = 1790330400000
COUNT = {"stat": "count"}
INCREASE = {"stat": "increase", "field": "requests_total"}
TOP_VALUES_LINE = (
    "Top values kept 2 values of service.name; 5 matching documents have other values and are "
    "left out"
)
INCREASE_SLOTS = [
    (T0, 100.0, 160.0, 3),
    (T1, 170.0, 230.0, 3),
    (T2, 5.0, 40.0, 2),
    (T3, None, None, 0),
    (T4, 50.0, 90.0, 2),
]


def parsed(answer: dict[str, Any]) -> dict[str, Any]:
    """The answer as the REST core reads it: floats as Decimal."""
    result: dict[str, Any] = json.loads(json.dumps(answer), parse_float=Decimal)
    return result


def run(
    entries: list[Any],
    answer: dict[str, Any],
    group_by_time: str = "1m",
    group_field: str = "",
    top_values: int = 10,
    time_field: str = "@timestamp",
) -> tuple[dict[str, Any], list[str]]:
    stats = check_stats(entries, time_field, group_field)
    return stats_table(stats, parsed(answer), time_field, group_by_time, group_field, top_values)


def columns(table: dict[str, Any]) -> list[tuple[str, str]]:
    return [(column["name"], column["type"]) for column in table["columns"]]


def shown(table: dict[str, Any]) -> list[list[str | None]]:
    """Each cell as the text the table shows; an empty cell stays None."""
    return [[None if cell is None else str(cell) for cell in row] for row in table["rows"]]


def total(value: int) -> dict[str, Any]:
    return {"total": {"value": value, "relation": "eq"}}


def increase_buckets(
    slots: list[tuple[str, float | None, float | None, int]], number: int
) -> list[dict[str, Any]]:
    return [
        {
            "key_as_string": stamp,
            "key": KEY_T0 + position * 60_000,
            "doc_count": count,
            f"s{number}_max": {"value": high},
            f"s{number}_min": {"value": low},
        }
        for position, (stamp, low, high, count) in enumerate(slots)
    ]


def slot(low: str | None, high: str | None, count: int) -> Slot:
    return Slot(
        min=None if low is None else Decimal(low),
        max=None if high is None else Decimal(high),
        doc_count=count,
    )


def a3_slots() -> list[Slot]:
    return [
        slot(str(low), str(high), count) if count else slot(None, None, 0)
        for _stamp, low, high, count in INCREASE_SLOTS
    ]


PERCENTILE_PER_MINUTE_ANSWER = {
    "hits": total(6),
    "aggregations": {
        "time": {
            "buckets": [
                {
                    "key_as_string": T0,
                    "key": KEY_T0,
                    "doc_count": 2,
                    "s2": {"values": [{"key": 95.0, "value": 812.5}]},
                },
                {
                    "key_as_string": T1,
                    "key": KEY_T0 + 60_000,
                    "doc_count": 0,
                    "s2": {"values": [{"key": 95.0, "value": None}]},
                },
                {
                    "key_as_string": T2,
                    "key": KEY_T0 + 120_000,
                    "doc_count": 4,
                    "s2": {"values": [{"key": 95.0, "value": 430.0}]},
                },
            ]
        }
    },
}
TOP_VALUES_ANSWER = {
    "hits": total(57),
    "aggregations": {
        "group": {
            "doc_count_error_upper_bound": 0,
            "sum_other_doc_count": 5,
            "buckets": [
                {"key": "checkout", "doc_count": 40, "s2": {"value": 212.25}, "s3": {"value": 31}},
                {"key": "search", "doc_count": 12, "s2": {"value": 98.5}, "s3": {"value": 9}},
            ],
        }
    },
}
TOP_VALUES_STATS = [
    COUNT,
    {"stat": "average", "field": "latency_ms"},
    {"stat": "unique_count", "field": "user.id"},
]


class TestWorkedExamples:
    """The worked examples of the Aggregate Results rules."""

    def test_time_slots_with_a_quiet_minute(self) -> None:
        table, warnings = run(
            [COUNT, {"stat": "percentile", "field": "latency_ms", "percent": 95}],
            PERCENTILE_PER_MINUTE_ANSWER,
        )

        assert columns(table) == [
            ("@timestamp", "string"),
            ("count", "integer"),
            ("percentile 95 of latency_ms", "float"),
        ]
        assert shown(table) == [[T0, "2", "812.5"], [T1, "0", "0"], [T2, "4", "430.0"]]
        assert table["__wave_type"] == "table"
        assert warnings == []

    def test_field_values_and_the_top_values_line(self) -> None:
        table, warnings = run(
            TOP_VALUES_STATS,
            TOP_VALUES_ANSWER,
            group_by_time="none",
            group_field="service.name",
            top_values=2,
        )

        assert columns(table) == [
            ("service.name", "string"),
            ("count", "integer"),
            ("average of latency_ms", "float"),
            ("unique count of user.id", "integer"),
        ]
        assert shown(table) == [["checkout", "40", "212.25", "31"], ["search", "12", "98.5", "9"]]
        assert warnings == [TOP_VALUES_LINE]

    def test_increase_per_slot(self) -> None:
        answer = {
            "hits": total(10),
            "aggregations": {"time": {"buckets": increase_buckets(INCREASE_SLOTS, 1)}},
        }

        table, warnings = run([INCREASE], answer)

        assert columns(table) == [("@timestamp", "string"), ("increase of requests_total", "float")]
        assert shown(table) == [[T0, "60.0"], [T1, "70.0"], [T2, "35.0"], [T3, "0"], [T4, "50.0"]]
        assert warnings == []

    def test_one_row_for_the_whole_range(self) -> None:
        answer = {"hits": {"total": {"value": 3}}, "aggregations": {"s2": {"value": 115.49}}}

        table, warnings = run(
            [COUNT, {"stat": "sum", "field": "bytes"}], answer, group_by_time="none"
        )

        assert columns(table) == [("count", "integer"), ("sum of bytes", "float")]
        assert shown(table) == [["3", "115.49"]]
        assert warnings == []


class TestQuietSlots:
    """A slot with no documents shows 0; a slot with documents keeps a missing value empty."""

    def test_a_null_in_a_slot_with_documents_stays_empty(self) -> None:
        answer = {
            "hits": total(3),
            "aggregations": {
                "time": {
                    "buckets": [
                        {"key_as_string": T0, "doc_count": 3, "s2": {"value": None}},
                        {"key_as_string": T1, "doc_count": 0, "s2": {"value": None}},
                        {"key_as_string": T2, "doc_count": 1, "s2": {"value": 4.5}},
                    ]
                }
            },
        }

        table, _warnings = run([COUNT, {"stat": "average", "field": "latency_ms"}], answer)

        assert shown(table) == [[T0, "3", None], [T1, "0", "0"], [T2, "1", "4.5"]]

    def test_the_whole_range_with_no_documents_shows_0(self) -> None:
        answer = {
            "hits": total(0),
            "aggregations": {
                "s2": {"value": None},
                "s3": {"values": [{"key": 95.0, "value": None}]},
            },
        }
        entries = [
            COUNT,
            {"stat": "max", "field": "latency_ms"},
            {"stat": "percentile", "field": "latency_ms", "percent": 95},
        ]

        table, _warnings = run(entries, answer, group_by_time="none")

        assert shown(table) == [["0", "0", "0"]]

    def test_the_whole_range_with_documents_keeps_a_null_empty(self) -> None:
        answer = {"hits": total(4), "aggregations": {"s2": {"value": None}}}

        table, _warnings = run(
            [COUNT, {"stat": "max", "field": "latency_ms"}], answer, group_by_time="none"
        )

        assert shown(table) == [["4", None]]

    def test_count_alone_needs_no_aggregations(self) -> None:
        table, warnings = run([COUNT], {"hits": total(3)}, group_by_time="none")

        assert columns(table) == [("count", "integer")]
        assert shown(table) == [["3"]]
        assert warnings == []


class TestCells:
    """Time and value cells, metric cells and Custom cells."""

    def test_the_value_cell_prefers_key_as_string(self) -> None:
        answer = {
            "hits": total(5),
            "aggregations": {
                "group": {
                    "sum_other_doc_count": 0,
                    "buckets": [
                        {"key": 1, "key_as_string": "true", "doc_count": 3},
                        {"key": 0, "key_as_string": "false", "doc_count": 2},
                    ],
                }
            },
        }

        table, _warnings = run([COUNT], answer, group_by_time="none", group_field="ok")

        assert columns(table) == [("ok", "string"), ("count", "integer")]
        assert shown(table) == [["true", "3"], ["false", "2"]]

    def test_a_numeric_key_makes_an_integer_column(self) -> None:
        answer = {
            "hits": total(7),
            "aggregations": {
                "group": {
                    "sum_other_doc_count": 0,
                    "buckets": [{"key": 500, "doc_count": 4}, {"key": 503, "doc_count": 3}],
                }
            },
        }

        table, _warnings = run([COUNT], answer, group_by_time="none", group_field="status")

        assert table["columns"][0] == {"name": "status", "type": "integer"}
        assert table["rows"] == [[500, 4], [503, 3]]

    def test_the_time_column_follows_the_time_field(self) -> None:
        answer = {
            "hits": total(1),
            "aggregations": {"time": {"buckets": [{"key_as_string": T0, "doc_count": 1}]}},
        }

        table, _warnings = run([COUNT], answer, time_field="event.created")

        assert columns(table) == [("event.created", "string"), ("count", "integer")]
        assert table["rows"] == [[T0, 1]]

    def test_a_custom_answer_with_a_value(self) -> None:
        entry = {"stat": "custom", "json": '{"value_count": {"field": "trace.id"}}'}
        answer = {"hits": total(3), "aggregations": {"s1": {"value": 3}}}

        table, _warnings = run([entry], answer, group_by_time="none")

        assert columns(table) == [("custom 1", "integer")]
        assert table["rows"] == [[3]]

    def test_a_custom_answer_without_a_value_is_json_text_without_meta(self) -> None:
        entry = {
            "stat": "custom",
            "json": '{"terms": {"field": "host.name"}, "meta": {"unit": "hosts"}}',
            "name": "hosts",
        }
        answer = {
            "hits": total(3),
            "aggregations": {
                "s2": {
                    "meta": {"unit": "hosts"},
                    "doc_count_error_upper_bound": 0,
                    "sum_other_doc_count": 0,
                    "buckets": [{"key": "høst-1", "doc_count": 3}],
                }
            },
        }

        table, _warnings = run([COUNT, entry], answer, group_by_time="none")

        assert columns(table) == [("count", "integer"), ("hosts", "string")]
        assert table["rows"] == [
            [
                3,
                '{"doc_count_error_upper_bound":0,"sum_other_doc_count":0,'
                '"buckets":[{"key":"høst-1","doc_count":3}]}',
            ]
        ]

    def test_custom_json_text_keeps_exact_numbers(self) -> None:
        entry = {
            "stat": "custom",
            "json": '{"percentiles": {"field": "latency_ms", "percents": [99.9]}}',
        }
        answer = {
            "hits": total(2),
            "aggregations": {"s1": {"values": [{"key": 99.9, "value": 812.5}]}},
        }

        table, _warnings = run([entry], answer, group_by_time="none")

        assert table["rows"] == [['{"values":[{"key":99.9,"value":812.5}]}']]


class TestGroupedByBoth:
    """Both groupings: one row per (slot, value), time ascending, then the terms order."""

    def test_rows_run_by_time_then_by_value(self) -> None:
        answer = {
            "hits": total(9),
            "aggregations": {
                "group": {
                    "sum_other_doc_count": 0,
                    "buckets": [
                        {
                            "key": "checkout",
                            "doc_count": 6,
                            "time": {
                                "buckets": [
                                    {"key_as_string": T0, "doc_count": 4, "s2": {"value": 10.0}},
                                    {"key_as_string": T1, "doc_count": 2, "s2": {"value": 5.0}},
                                ]
                            },
                        },
                        {
                            "key": "search",
                            "doc_count": 3,
                            "time": {
                                "buckets": [
                                    {"key_as_string": T0, "doc_count": 0, "s2": {"value": None}},
                                    {"key_as_string": T1, "doc_count": 3, "s2": {"value": 7.5}},
                                ]
                            },
                        },
                    ],
                }
            },
        }

        table, warnings = run(
            [COUNT, {"stat": "sum", "field": "bytes"}], answer, group_field="service.name"
        )

        assert columns(table) == [
            ("@timestamp", "string"),
            ("service.name", "string"),
            ("count", "integer"),
            ("sum of bytes", "float"),
        ]
        assert shown(table) == [
            [T0, "checkout", "4", "10.0"],
            [T0, "search", "0", "0"],
            [T1, "checkout", "2", "5.0"],
            [T1, "search", "3", "7.5"],
        ]
        assert warnings == []

    def test_the_top_values_line_with_time_slots(self) -> None:
        answer = {
            "hits": total(8),
            "aggregations": {
                "group": {
                    "sum_other_doc_count": 5,
                    "buckets": [
                        {"key": "a", "doc_count": 2, "time": {"buckets": []}},
                        {"key": "b", "doc_count": 1, "time": {"buckets": []}},
                    ],
                }
            },
        }

        _table, warnings = run([COUNT], answer, group_field="service.name", top_values=2)

        assert warnings == [TOP_VALUES_LINE]


class TestTopValues:
    """`sum_other_doc_count` above 0 is said at WARN; 0 says nothing."""

    def test_the_pinned_line_with_ten_values(self) -> None:
        buckets = [{"key": f"svc-{number}", "doc_count": 20 - number} for number in range(10)]
        answer = {
            "hits": total(160),
            "aggregations": {"group": {"sum_other_doc_count": 5, "buckets": buckets}},
        }

        table, warnings = run([COUNT], answer, group_by_time="none", group_field="service.name")

        assert len(table["rows"]) == 10
        assert warnings == [
            "Top values kept 10 values of service.name; 5 matching documents have other values "
            "and are left out"
        ]

    def test_nothing_left_out_says_nothing(self) -> None:
        answer = {
            "hits": total(3),
            "aggregations": {
                "group": {"sum_other_doc_count": 0, "buckets": [{"key": "a", "doc_count": 3}]}
            },
        }

        _table, warnings = run([COUNT], answer, group_by_time="none", group_field="service.name")

        assert warnings == []

    def test_no_value_at_all_is_an_empty_table(self) -> None:
        answer = {
            "hits": total(0),
            "aggregations": {"group": {"sum_other_doc_count": 0, "buckets": []}},
        }

        table, warnings = run([COUNT], answer, group_by_time="none", group_field="service.name")

        assert columns(table) == [("service.name", "string"), ("count", "string")]
        assert table["rows"] == []
        assert warnings == []


class TestTopValuesInTheSingular:
    """A count of 1 on either side of the Top values WARN reads in the singular."""

    @pytest.mark.parametrize(
        ("top_values", "others", "line"),
        [
            pytest.param(
                1,
                5,
                "Top values kept 1 value of service.name; 5 matching documents have other "
                "values and are left out",
                id="one-value-kept",
            ),
            pytest.param(
                10,
                1,
                "Top values kept 10 values of service.name; 1 matching document has another "
                "value and is left out",
                id="one-document-left-out",
            ),
            pytest.param(
                1,
                1,
                "Top values kept 1 value of service.name; 1 matching document has another "
                "value and is left out",
                id="both-one",
            ),
        ],
    )
    def test_the_singular_forms(self, top_values: int, others: int, line: str) -> None:
        answer = {
            "hits": total(4),
            "aggregations": {
                "group": {
                    "sum_other_doc_count": others,
                    "buckets": [{"key": "checkout", "doc_count": 3}],
                }
            },
        }

        _table, warnings = run(
            [COUNT],
            answer,
            group_by_time="none",
            group_field="service.name",
            top_values=top_values,
        )

        assert warnings == [line]


class TestIncreaseInTheTable:
    """Increase per series over the slots; ungrouped by time it sums the internal slots."""

    def test_ungrouped_sums_the_internal_slots(self) -> None:
        answer = {
            "hits": total(10),
            "aggregations": {"s2_slots": {"buckets": increase_buckets(INCREASE_SLOTS, 2)}},
        }

        table, _warnings = run([COUNT, INCREASE], answer, group_by_time="none")

        assert columns(table) == [("count", "integer"), ("increase of requests_total", "float")]
        assert shown(table) == [["10", "215.0"]]

    def test_per_value_over_its_own_internal_slots(self) -> None:
        answer = {
            "hits": total(12),
            "aggregations": {
                "group": {
                    "sum_other_doc_count": 0,
                    "buckets": [
                        {
                            "key": "checkout",
                            "doc_count": 10,
                            "s1_slots": {"buckets": increase_buckets(INCREASE_SLOTS, 1)},
                        },
                        {
                            "key": "search",
                            "doc_count": 2,
                            "s1_slots": {
                                "buckets": increase_buckets(
                                    [(T0, None, None, 0), (T1, 10.0, 30.0, 2)], 1
                                )
                            },
                        },
                    ],
                }
            },
        }

        table, _warnings = run([INCREASE], answer, group_by_time="none", group_field="service.name")

        assert shown(table) == [["checkout", "215.0"], ["search", "20.0"]]

    def test_per_series_when_grouped_by_both(self) -> None:
        answer = {
            "hits": total(8),
            "aggregations": {
                "group": {
                    "sum_other_doc_count": 0,
                    "buckets": [
                        {
                            "key": "checkout",
                            "doc_count": 6,
                            "time": {
                                "buckets": increase_buckets(
                                    [(T0, 100.0, 160.0, 3), (T1, 170.0, 230.0, 3)], 1
                                )
                            },
                        },
                        {
                            "key": "search",
                            "doc_count": 2,
                            "time": {
                                "buckets": increase_buckets(
                                    [(T0, None, None, 0), (T1, 10.0, 30.0, 2)], 1
                                )
                            },
                        },
                    ],
                }
            },
        }

        table, _warnings = run([INCREASE], answer, group_field="service.name")

        assert shown(table) == [
            [T0, "checkout", "60.0"],
            [T0, "search", "0"],
            [T1, "checkout", "70.0"],
            [T1, "search", "20.0"],
        ]


class TestIncreases:
    """An empty slot gives 0; the first non-empty slot max - min; later ones the rise."""

    def test_a3(self) -> None:
        result = increases(a3_slots())

        assert result == [60, 70, 35, 0, 50]
        assert all(isinstance(value, Decimal) for value in result)

    def test_the_whole_window_is_the_sum(self) -> None:
        assert sum(increases(a3_slots())) == 215

    def test_the_first_slot_counts_its_own_rise(self) -> None:
        assert increases([slot("5", "9", 2)]) == [4]

    def test_one_document_rises_by_nothing(self) -> None:
        assert increases([slot("7", "7", 1)]) == [0]

    def test_empty_slots_before_the_first_value(self) -> None:
        assert increases([slot(None, None, 0), slot(None, None, 0), slot("10", "30", 2)]) == [
            0,
            0,
            20,
        ]

    def test_a_flat_counter_rises_by_nothing(self) -> None:
        assert increases([slot("100", "160", 3), slot("160", "160", 1)]) == [60, 0]

    def test_a_restart_counts_the_slot_from_its_own_min(self) -> None:
        assert increases([slot("100", "160", 3), slot("1", "4", 2)]) == [60, 3]

    def test_the_rise_is_from_the_previous_non_empty_slot(self) -> None:
        assert increases([slot("100", "160", 3), slot(None, None, 0), slot("150", "170", 2)]) == [
            60,
            0,
            10,
        ]

    def test_a_restart_across_a_quiet_slot(self) -> None:
        assert increases([slot("100", "160", 3), slot(None, None, 0), slot("2", "9", 2)]) == [
            60,
            0,
            7,
        ]

    def test_exact_decimals(self) -> None:
        result = increases([slot("0.10", "0.30", 2), slot("0.30", "0.45", 2)])

        assert result == [Decimal("0.20"), Decimal("0.15")]
        assert [str(value) for value in result] == ["0.20", "0.15"]

    def test_no_slot(self) -> None:
        assert increases([]) == []

    @pytest.mark.parametrize("count", [1, 3])
    def test_only_empty_slots(self, count: int) -> None:
        assert increases([slot(None, None, 0)] * count) == [0] * count
