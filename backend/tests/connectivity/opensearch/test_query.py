"""The author query in both languages and the final query with the time range (REQ-3.3.2.6, OS-9).

DQL is parsed before connecting and translated with the field list after it; Query DSL is read
by the one JSON text reader; a pasted whole request keeps only its query; the final query is the
time range as epoch milliseconds plus the author query as filters.
"""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.connectivity.opensearch._errors import OpenSearchFailure
from wavecore.connectivity.opensearch._fields import FieldInfo, FieldList
from wavecore.connectivity.opensearch._query import (
    FIELD_KEYED_QUERIES,
    author_query,
    final_query,
    named_fields,
)
from wavecore.connectivity.opensearch._time import Window
from wavecore.connectivity.opensearch.dql import parse, to_query

FROM_MS = 1790332025123
TO_MS = 1790332925123
WINDOW = Window(from_ms=FROM_MS, to_ms=TO_MS)
KEYWORD = FieldInfo(types=["keyword"], aggregatable=True)
FIELDS = FieldList(
    indices=["filebeat-2026.09.25"],
    fields={
        "@timestamp": FieldInfo(types=["date"], aggregatable=True),
        "event.created": FieldInfo(types=["date"], aggregatable=True),
        "log.level": KEYWORD,
        "message": FieldInfo(types=["text"], aggregatable=False),
        "latency_ms": FieldInfo(types=["long"], aggregatable=True),
        "service.name": KEYWORD,
        "items": FieldInfo(types=["nested"], aggregatable=False),
        "items.name": KEYWORD,
    },
)
RANGE = {"range": {"@timestamp": {"gte": FROM_MS, "lte": TO_MS, "format": "epoch_millis"}}}
LEVEL_IS_ERROR = {
    "bool": {"should": [{"match": {"log.level": "ERROR"}}], "minimum_should_match": 1}
}
TERM = {"term": {"log.level": "ERROR"}}
REQUEST_KEYS = [
    "size",
    "from",
    "sort",
    "aggs",
    "aggregations",
    "_source",
    "fields",
    "docvalue_fields",
    "stored_fields",
    "track_total_hits",
    "track_scores",
    "timeout",
    "terminate_after",
    "post_filter",
    "highlight",
    "search_after",
    "pit",
    "min_score",
    "script_fields",
    "runtime_mappings",
    "collapse",
    "rescore",
    "explain",
    "version",
    "seq_no_primary_term",
    "indices_boost",
    "suggest",
    "profile",
    "stats",
    "ext",
]
NOT_A_JSON_OBJECT = 'Query DSL must be a JSON object, such as {"term": {"log.level": "ERROR"}}'


def final(language: str, value: Any, time_field: str = "@timestamp") -> dict[str, Any]:
    return final_query(author_query(language, value), FIELDS, time_field, WINDOW)


def filtered(*queries: dict[str, Any]) -> dict[str, Any]:
    return {"bool": {"filter": [RANGE, *queries]}}


def refused(language: str, value: Any) -> OpenSearchFailure:
    with pytest.raises(OpenSearchFailure) as caught:
        author_query(language, value)
    return caught.value


def assert_refused(language: str, value: Any, message: str) -> None:
    failure = refused(language, value)
    assert failure.message == message
    assert failure.reason == "Validation"


def dropped(*keys: str) -> str:
    listed = ", ".join(f'"{key}"' for key in keys)
    return f'Query: kept only "query" from the pasted request; dropped {listed}'


class TestDql:
    """DQL text parses before connecting and translates with the field list (REQ-3.3.2.6)."""

    def test_the_query_follows_the_time_range(self) -> None:
        assert final("dql", "log.level: ERROR") == filtered(LEVEL_IS_ERROR)

    def test_dql_leaves_no_note(self) -> None:
        assert author_query("dql", "log.level: ERROR").notes == []

    def test_the_translation_reads_the_field_list(self) -> None:
        text = "items: { name: widget } and latency_ms >= 500"

        assert final("dql", text) == filtered(to_query(parse(text), FIELDS))

    def test_a_query_over_several_lines(self) -> None:
        text = "log.level: ERROR\nand service.name: checkout"

        assert final("dql", text) == filtered(to_query(parse(text), FIELDS))

    def test_surrounding_spaces_are_not_a_blank_query(self) -> None:
        assert final("dql", "  log.level: ERROR  ") == filtered(LEVEL_IS_ERROR)


class TestDqlRefusals:
    """The DQL row refuses text that does not parse and values that are not text."""

    def test_names_the_line_and_column(self) -> None:
        assert_refused(
            "dql",
            "log.level:",
            "Query is not valid DQL at line 1, column 11: "
            'Expected "(", "{", value, whitespace but end of input found.',
        )

    def test_a_parse_error_on_a_later_line(self) -> None:
        assert_refused(
            "dql",
            "log.level: ERROR or\n",
            "Query is not valid DQL at line 2, column 1: "
            'Expected "(", NOT, field name, value but end of input found.',
        )

    @pytest.mark.parametrize(
        ("value", "kind"),
        [
            pytest.param({"term": {"log.level": "ERROR"}}, "a map", id="map"),
            pytest.param(["ERROR"], "an array", id="array"),
            pytest.param(5, "an integer", id="integer"),
            pytest.param(1.5, "a float", id="float"),
            pytest.param(True, "a boolean", id="boolean"),
        ],
    )
    def test_an_expression_that_gives_no_text(self, value: Any, kind: str) -> None:
        assert_refused(
            "dql", value, f"Query is DQL, so the expression must give text; it gave {kind}"
        )


class TestQueryDsl:
    """Query DSL text is read by the JSON text reader; a map from an expression is used as is."""

    def test_the_object_follows_the_time_range(self) -> None:
        assert final("query_dsl", '{"term": {"log.level": "ERROR"}}') == filtered(TERM)

    def test_query_dsl_text_leaves_no_note(self) -> None:
        assert author_query("query_dsl", '{"term": {"log.level": "ERROR"}}').notes == []

    def test_numbers_keep_their_exact_digits(self) -> None:
        query = final("query_dsl", '{"range": {"latency_ms": {"gte": 1.50, "lt": 12}}}')

        author = query["bool"]["filter"][1]
        assert author == {"range": {"latency_ms": {"gte": Decimal("1.50"), "lt": 12}}}
        assert str(author["range"]["latency_ms"]["gte"]) == "1.50"

    def test_comments_are_allowed(self) -> None:
        text = '// errors only\n{"term": /* level */ {"log.level": "ERROR"}}'

        assert final("query_dsl", text) == filtered(TERM)

    def test_a_map_from_an_expression_is_used_as_is(self) -> None:
        value = {"bool": {"must_not": [{"exists": {"field": "trace.id"}}]}}

        assert final("query_dsl", value) == filtered(value)

    def test_json_text_from_an_expression_reads_like_the_literal(self) -> None:
        text = '{"match_phrase": {"message": "Load test finished"}}'

        assert final("query_dsl", text) == filtered(
            {"match_phrase": {"message": "Load test finished"}}
        )


class TestQueryDslRefusals:
    """Query DSL refuses text that does not parse, and a value that is not one JSON object."""

    def test_names_the_line_and_column(self) -> None:
        assert_refused(
            "query_dsl",
            '{"term": {"log.level": "ERROR"}\n    "boost": 1}',
            "Query is not valid JSON at line 2, column 5: Expected , or }",
        )

    def test_a_duplicate_key(self) -> None:
        assert_refused(
            "query_dsl",
            '{"term": {"a": 1}, "term": {"b": 2}}',
            'Query is not valid JSON at line 1, column 20: Duplicate key "term"',
        )

    @pytest.mark.parametrize(
        "text",
        ['["log.level"]', "42", '"ERROR"', "true"],
        ids=["array", "number", "string", "boolean"],
    )
    def test_text_that_is_not_an_object(self, text: str) -> None:
        assert_refused("query_dsl", text, NOT_A_JSON_OBJECT)

    def test_an_expression_that_gives_a_list(self) -> None:
        assert_refused("query_dsl", [TERM], NOT_A_JSON_OBJECT)


class TestBlankQuery:
    """A blank value means no filter: only the time range is sent."""

    @pytest.mark.parametrize("language", ["dql", "query_dsl"])
    @pytest.mark.parametrize(
        "value", ["", "   ", None, {}], ids=["empty", "spaces", "none", "empty-map"]
    )
    def test_no_filter(self, language: str, value: Any) -> None:
        author = author_query(language, value)

        assert final_query(author, FIELDS, "@timestamp", WINDOW) == filtered()
        assert named_fields(author) == []
        assert author.notes == []

    @pytest.mark.parametrize("text", ["{}", "  {\n}  "], ids=["compact", "spread"])
    def test_an_empty_object_as_query_dsl_text(self, text: str) -> None:
        assert final("query_dsl", text) == filtered()


class TestWholeRequest:
    """A pasted whole search request keeps its query and names what it dropped at INFO."""

    def test_the_query_is_kept_and_the_rest_dropped_in_order(self) -> None:
        text = (
            '{"size": 5, "query": {"term": {"log.level": "ERROR"}}, '
            '"sort": [{"@timestamp": "desc"}]}'
        )
        author = author_query("query_dsl", text)

        assert final_query(author, FIELDS, "@timestamp", WINDOW) == filtered(TERM)
        assert author.notes == [dropped("size", "sort")]

    def test_the_pinned_note(self) -> None:
        author = author_query(
            "query_dsl", '{"query": {"term": {"log.level": "ERROR"}}, "size": 5, "sort": []}'
        )

        assert author.notes == [
            'Query: kept only "query" from the pasted request; dropped "size", "sort"'
        ]

    def test_a_request_without_a_query_has_no_filter(self) -> None:
        author = author_query(
            "query_dsl", '{"size": 0, "aggs": {"levels": {"terms": {"field": "log.level"}}}}'
        )

        assert final_query(author, FIELDS, "@timestamp", WINDOW) == filtered()
        assert author.notes == [dropped("size", "aggs")]

    @pytest.mark.parametrize("key", REQUEST_KEYS)
    def test_each_request_key_marks_a_whole_request(self, key: str) -> None:
        text = f'{{"query": {{"term": {{"log.level": "ERROR"}}}}, "{key}": 1}}'
        author = author_query("query_dsl", text)

        assert final_query(author, FIELDS, "@timestamp", WINDOW) == filtered(TERM)
        assert author.notes == [dropped(key)]

    def test_a_query_alone_is_unwrapped_with_nothing_to_note(self) -> None:
        author = author_query("query_dsl", '{"query": {"term": {"log.level": "ERROR"}}}')

        assert final_query(author, FIELDS, "@timestamp", WINDOW) == filtered(TERM)
        assert author.notes == []

    def test_an_empty_query_inside_a_request_is_no_filter(self) -> None:
        author = author_query("query_dsl", '{"query": {}, "size": 1}')

        assert final_query(author, FIELDS, "@timestamp", WINDOW) == filtered()
        assert author.notes == [dropped("size")]

    def test_a_plain_query_is_not_trimmed(self) -> None:
        author = author_query("query_dsl", '{"bool": {"filter": [{"term": {"a": "b"}}]}}')

        assert final_query(author, FIELDS, "@timestamp", WINDOW) == filtered(
            {"bool": {"filter": [{"term": {"a": "b"}}]}}
        )
        assert author.notes == []

    def test_named_fields_read_only_the_kept_query(self) -> None:
        text = (
            '{"query": {"term": {"log.level": "ERROR"}}, "sort": [{"latency_ms": "desc"}], '
            '"aggs": {"s": {"terms": {"field": "service.name"}}}, "_source": ["message"]}'
        )

        assert named_fields(author_query("query_dsl", text)) == ["log.level"]


class TestFinalQuery:
    """The time range is epoch milliseconds on the Time field, first in the filter list."""

    def test_the_time_range_uses_the_time_field(self) -> None:
        query = final("dql", "log.level: ERROR", time_field="event.created")

        assert query == {
            "bool": {
                "filter": [
                    {
                        "range": {
                            "event.created": {
                                "gte": FROM_MS,
                                "lte": TO_MS,
                                "format": "epoch_millis",
                            }
                        }
                    },
                    LEVEL_IS_ERROR,
                ]
            }
        }

    def test_the_bounds_are_the_window_as_integers(self) -> None:
        bounds = final("dql", "")["bool"]["filter"][0]["range"]["@timestamp"]

        assert (bounds["gte"], bounds["lte"]) == (FROM_MS, TO_MS)
        assert isinstance(bounds["gte"], int)
        assert isinstance(bounds["lte"], int)

    def test_another_window(self) -> None:
        query = final_query(
            author_query("query_dsl", '{"term": {"log.level": "ERROR"}}'),
            FIELDS,
            "@timestamp",
            Window(from_ms=0, to_ms=86399999),
        )

        assert query == {
            "bool": {
                "filter": [
                    {
                        "range": {
                            "@timestamp": {"gte": 0, "lte": 86399999, "format": "epoch_millis"}
                        }
                    },
                    TERM,
                ]
            }
        }


class TestNamedFieldsDql:
    """DQL: the fields the query names, once each, in order of first mention (OS-9)."""

    def test_order_of_first_mention_once_each(self) -> None:
        author = author_query(
            "dql", "service.name: a and log.level: b or latency_ms > 5 or log.level: c"
        )

        assert named_fields(author) == ["service.name", "log.level", "latency_ms"]

    def test_a_wildcard_field_is_named_as_written(self) -> None:
        assert named_fields(author_query("dql", "service.*: checkout")) == ["service.*"]

    def test_free_text_names_no_field(self) -> None:
        assert named_fields(author_query("dql", '"Batch complete" and ERROR')) == []

    def test_a_nested_query_names_the_path_and_the_inner_field(self) -> None:
        assert named_fields(author_query("dql", "items: { name: widget }")) == [
            "items",
            "items.name",
        ]


class TestNamedFieldsQueryDsl:
    """Query DSL: field-keyed query types, every `field` value, every `fields` entry (OS-9)."""

    def test_the_common_field_keyed_types_are_known(self) -> None:
        assert {"term", "match", "match_phrase", "range", "prefix", "wildcard"} <= set(
            FIELD_KEYED_QUERIES
        )

    @pytest.mark.parametrize(
        "query",
        [
            {"term": {"log.level": "ERROR"}},
            {"match": {"log.level": {"query": "ERROR"}}},
            {"match_phrase": {"log.level": "ERROR"}},
            {"range": {"log.level": {"gte": "A"}}},
            {"prefix": {"log.level": "ERR"}},
            {"wildcard": {"log.level": "ERR*"}},
        ],
        ids=["term", "match", "match_phrase", "range", "prefix", "wildcard"],
    )
    def test_the_key_under_a_field_keyed_type(self, query: dict[str, Any]) -> None:
        assert named_fields(author_query("query_dsl", query)) == ["log.level"]

    def test_the_value_of_a_field_key(self) -> None:
        assert named_fields(author_query("query_dsl", {"exists": {"field": "trace.id"}})) == [
            "trace.id"
        ]

    def test_fields_entries_lose_their_boost(self) -> None:
        query = {"multi_match": {"query": "failed", "fields": ["message^2", "error.message"]}}

        assert named_fields(author_query("query_dsl", query)) == ["message", "error.message"]

    def test_order_of_first_mention_once_each(self) -> None:
        query = {
            "bool": {
                "filter": [
                    {"term": {"log.level": "ERROR"}},
                    {"range": {"latency_ms": {"gte": 500}}},
                ],
                "must_not": [{"exists": {"field": "trace.id"}}],
                "should": [
                    {"query_string": {"query": "x", "fields": ["message^3", "log.level"]}},
                    {"match": {"latency_ms": 7}},
                ],
            }
        }

        assert named_fields(author_query("query_dsl", query)) == [
            "log.level",
            "latency_ms",
            "trace.id",
            "message",
        ]

    def test_query_dsl_text_names_the_same_fields(self) -> None:
        text = '{"bool": {"filter": [{"term": {"service.name": "a"}}, {"exists": {"field": "b"}}]}}'

        assert named_fields(author_query("query_dsl", text)) == ["service.name", "b"]

    def test_a_query_that_names_no_field(self) -> None:
        assert named_fields(author_query("query_dsl", {"match_all": {}})) == []
