"""DQL to Query DSL with the OpenSearch Dashboards 3.8.0 rules (REQ-3.3.2.6, REQ-3.3.3.6, OS-5)."""

from typing import Any

import pytest

from wavecore.connectivity.opensearch._fields import FieldInfo, FieldList
from wavecore.connectivity.opensearch.dql import parse, to_query


def keyword() -> FieldInfo:
    return FieldInfo(types=["keyword"], aggregatable=True)


FIELDS = FieldList(
    indices=["filebeat-2026.09.25"],
    fields={
        "log.level": keyword(),
        "message": FieldInfo(types=["text"], aggregatable=False),
        "latency_ms": FieldInfo(types=["long"], aggregatable=True),
        "@timestamp": FieldInfo(types=["date"], aggregatable=True),
        "host.name": keyword(),
        "service.name": keyword(),
        "service.version": keyword(),
        "trace.id": keyword(),
        "items": FieldInfo(types=["nested"], aggregatable=False),
        "items.name": keyword(),
    },
)


def translated(text: str) -> dict[str, Any]:
    return to_query(parse(text), FIELDS)


def should(*queries: dict[str, Any]) -> dict[str, Any]:
    return {"bool": {"should": list(queries), "minimum_should_match": 1}}


def is_match(field: str, value: Any) -> dict[str, Any]:
    return should({"match": {field: value}})


def is_phrase(field: str, value: Any) -> dict[str, Any]:
    return should({"match_phrase": {field: value}})


def nested(path: str, query: dict[str, Any]) -> dict[str, Any]:
    return {"nested": {"path": path, "query": query, "score_mode": "none"}}


LEVEL_IS_ERROR = {
    "bool": {"should": [{"match": {"log.level": "ERROR"}}], "minimum_should_match": 1}
}

TRANSLATION_TABLE = [
    ("log.level: ERROR", LEVEL_IS_ERROR),
    (
        'message: "Load test finished"',
        {
            "bool": {
                "should": [{"match_phrase": {"message": "Load test finished"}}],
                "minimum_should_match": 1,
            }
        },
    ),
    (
        "log.level: ERROR and service.name: checkout",
        {"bool": {"filter": [LEVEL_IS_ERROR, is_match("service.name", "checkout")]}},
    ),
    (
        'log.level: ERROR or message: "Batch complete"',
        {
            "bool": {
                "should": [LEVEL_IS_ERROR, is_phrase("message", "Batch complete")],
                "minimum_should_match": 1,
            }
        },
    ),
    ("not log.level: INFO", {"bool": {"must_not": is_match("log.level", "INFO")}}),
    (
        "latency_ms >= 500",
        {"bool": {"should": [{"range": {"latency_ms": {"gte": 500}}}], "minimum_should_match": 1}},
    ),
    (
        '@timestamp < "2026-09-25T10:00:00Z"',
        {
            "bool": {
                "should": [
                    {"range": {"@timestamp": {"lt": "2026-09-25T10:00:00Z", "time_zone": "UTC"}}}
                ],
                "minimum_should_match": 1,
            }
        },
    ),
    (
        '@timestamp: "2026-09-25"',
        {
            "bool": {
                "should": [
                    {
                        "range": {
                            "@timestamp": {
                                "gte": "2026-09-25",
                                "lte": "2026-09-25",
                                "time_zone": "UTC",
                            }
                        }
                    }
                ],
                "minimum_should_match": 1,
            }
        },
    ),
    (
        "trace.id: *",
        {"bool": {"should": [{"exists": {"field": "trace.id"}}], "minimum_should_match": 1}},
    ),
    (
        "host.name: web-*",
        {
            "bool": {
                "should": [{"query_string": {"fields": ["host.name"], "query": "web\\-*"}}],
                "minimum_should_match": 1,
            }
        },
    ),
    ("ERROR", {"multi_match": {"type": "best_fields", "query": "ERROR", "lenient": True}}),
    (
        '"Batch complete"',
        {"multi_match": {"type": "phrase", "query": "Batch complete", "lenient": True}},
    ),
    (
        "items: { name: widget }",
        {
            "nested": {
                "path": "items",
                "query": {
                    "bool": {
                        "should": [{"match": {"items.name": "widget"}}],
                        "minimum_should_match": 1,
                    }
                },
                "score_mode": "none",
            }
        },
    ),
    (
        "service.*: checkout",
        {
            "bool": {
                "should": [
                    {"match": {"service.name": "checkout"}},
                    {"match": {"service.version": "checkout"}},
                ],
                "minimum_should_match": 1,
            }
        },
    ),
]


class TestTranslationTable:
    """Each pinned translation row, against its field list."""

    @pytest.mark.parametrize(
        ("text", "query"),
        TRANSLATION_TABLE,
        ids=[text for text, _query in TRANSLATION_TABLE],
    )
    def test_the_row_translates_as_pinned(self, text: str, query: dict[str, Any]) -> None:
        assert translated(text) == query


class TestValueLists:
    """A value list repeats the field for each value."""

    def test_an_or_list(self) -> None:
        assert translated("log.level: (ERROR or WARN)") == should(
            is_match("log.level", "ERROR"), is_match("log.level", "WARN")
        )

    def test_an_and_list(self) -> None:
        assert translated("log.level: (ERROR and WARN)") == {
            "bool": {"filter": [is_match("log.level", "ERROR"), is_match("log.level", "WARN")]}
        }

    def test_a_not_inside_a_list(self) -> None:
        assert translated("log.level: (not DEBUG)") == {
            "bool": {"must_not": is_match("log.level", "DEBUG")}
        }


class TestLiteralValues:
    """Unquoted numbers become JSON numbers and `true` / `false` / `null` JSON literals."""

    def test_an_unquoted_number_is_a_json_number(self) -> None:
        query = translated("status: 404")
        assert query == is_match("status", 404)
        assert type(query["bool"]["should"][0]["match"]["status"]) is int

    def test_a_quoted_number_stays_text(self) -> None:
        assert translated('status: "404"') == is_phrase("status", "404")

    @pytest.mark.parametrize(
        ("word", "literal"), [("true", True), ("false", False), ("null", None)]
    )
    def test_the_json_words(self, word: str, literal: bool | None) -> None:
        value = translated(f"enabled: {word}")["bool"]["should"][0]["match"]["enabled"]
        assert value is literal

    def test_a_number_on_a_long_field(self) -> None:
        assert translated("latency_ms: 500") == is_match("latency_ms", 500)

    def test_a_number_as_free_text(self) -> None:
        assert translated("404") == {
            "multi_match": {"type": "best_fields", "query": 404, "lenient": True}
        }


class TestUnknownFields:
    """A field the field list does not know is sent as written, with no field-type rule."""

    def test_a_match_on_an_unknown_field(self) -> None:
        assert translated("log.invalid: ERROR") == is_match("log.invalid", "ERROR")

    def test_a_phrase_on_an_unknown_field(self) -> None:
        assert translated('log.invalid: "ERROR"') == is_phrase("log.invalid", "ERROR")

    def test_a_date_like_value_on_an_unknown_field_is_no_date_range(self) -> None:
        assert translated('when: "2026-09-25"') == is_phrase("when", "2026-09-25")

    def test_a_range_on_an_unknown_field_has_no_time_zone(self) -> None:
        assert translated("when > 5") == should({"range": {"when": {"gt": 5}}})

    def test_exists_on_an_unknown_field(self) -> None:
        assert translated("span.id: *") == should({"exists": {"field": "span.id"}})

    def test_a_wildcard_value_on_an_unknown_field(self) -> None:
        assert translated("span.id: ab*") == should(
            {"query_string": {"fields": ["span.id"], "query": "ab*"}}
        )

    def test_a_field_wildcard_that_matches_nothing_is_sent_as_written(self) -> None:
        assert translated("nomatch.*: x") == is_match("nomatch.*", "x")

    def test_a_document_id_is_sent_as_written(self) -> None:
        assert translated('_id: "abc123"') == is_phrase("_id", "abc123")


class TestDateFields:
    """A date field takes ranges with `"time_zone": "UTC"`, including an exact value."""

    def test_an_unquoted_exact_date_is_a_closed_range(self) -> None:
        assert translated("@timestamp: 2026-09-25") == should(
            {
                "range": {
                    "@timestamp": {"gte": "2026-09-25", "lte": "2026-09-25", "time_zone": "UTC"}
                }
            }
        )

    @pytest.mark.parametrize(
        ("operator", "key"), [("<", "lt"), ("<=", "lte"), (">", "gt"), (">=", "gte")]
    )
    def test_every_range_operator_carries_the_time_zone(self, operator: str, key: str) -> None:
        assert translated(f'@timestamp {operator} "2026-09-25"') == should(
            {"range": {"@timestamp": {key: "2026-09-25", "time_zone": "UTC"}}}
        )

    def test_date_math_passes_through(self) -> None:
        assert translated("@timestamp >= now-15m") == should(
            {"range": {"@timestamp": {"gte": "now-15m", "time_zone": "UTC"}}}
        )

    def test_a_lone_star_on_a_date_field_is_exists(self) -> None:
        assert translated("@timestamp: *") == should({"exists": {"field": "@timestamp"}})

    def test_a_wildcard_on_a_date_field_is_a_query_string(self) -> None:
        assert translated("@timestamp: 2026*") == should(
            {"query_string": {"fields": ["@timestamp"], "query": "\\2\\0\\2\\6*"}}
        )


class TestRanges:
    """A range names one bound per operator; fields other than dates carry no time zone."""

    @pytest.mark.parametrize(
        ("operator", "key"), [("<", "lt"), ("<=", "lte"), (">", "gt"), (">=", "gte")]
    )
    def test_each_operator_on_a_number_field(self, operator: str, key: str) -> None:
        assert translated(f"latency_ms {operator} 500") == should(
            {"range": {"latency_ms": {key: 500}}}
        )

    def test_a_range_on_a_keyword_field(self) -> None:
        assert translated("log.level > ERROR") == should({"range": {"log.level": {"gt": "ERROR"}}})

    def test_an_integer_bound_past_two_to_the_53_stays_exact(self) -> None:
        assert translated("latency_ms > 9007199254740993") == should(
            {"range": {"latency_ms": {"gt": 9007199254740993}}}
        )

    def test_a_range_on_a_field_wildcard_repeats_for_each_field(self) -> None:
        assert translated("service.* > m") == should(
            {"range": {"service.name": {"gt": "m"}}}, {"range": {"service.version": {"gt": "m"}}}
        )


class TestWildcardValues:
    """Each part between wildcards is escaped with Dashboards' `escapeQueryString` class."""

    @pytest.mark.parametrize(
        ("value_text", "query"),
        [
            ("web-*", "web\\-*"),
            (r"web\(1\)*", "web\\(\\1\\)*"),
            ("app.v2*", "app\\.v\\2*"),
            ("a/b,c;d*", "a\\/b\\,c\\;d*"),
            ("a[b]^~?&|!*", "a\\[b\\]\\^\\~\\?\\&\\|\\!*"),
            ("x_y#z@*", "x_y#z@*"),
            ("*err*", "*err*"),
            ("*ERR", "*ERR"),
            ("Ab*Cd", "Ab*Cd"),
            (r"e\\f*", "e\\\\f*"),
        ],
    )
    def test_the_query_string_escapes_each_part(self, value_text: str, query: str) -> None:
        assert translated(f"host.name: {value_text}") == should(
            {"query_string": {"fields": ["host.name"], "query": query}}
        )

    def test_whitespace_inside_a_wildcard_value_is_not_escaped(self) -> None:
        assert translated("message: load te*") == should(
            {"query_string": {"fields": ["message"], "query": "load te*"}}
        )

    def test_a_quoted_star_is_a_phrase(self) -> None:
        assert translated('host.name: "web-*"') == is_phrase("host.name", "web-*")

    def test_an_escaped_star_is_a_match(self) -> None:
        assert translated(r"host.name: web\*") == is_match("host.name", "web*")

    def test_a_free_text_wildcard_is_a_query_string_without_fields(self) -> None:
        assert translated("web-*") == {"query_string": {"query": "web\\-*"}}

    def test_a_lone_star_query_is_a_query_string(self) -> None:
        assert translated("*") == {"query_string": {"query": "*"}}


class TestExistsAndMatchAll:
    """`field: *` asks whether the field exists; `*: *` and a blank query match all."""

    def test_exists_on_a_field_wildcard_repeats_for_each_field(self) -> None:
        assert translated("service.*: *") == should(
            {"exists": {"field": "service.name"}}, {"exists": {"field": "service.version"}}
        )

    def test_star_colon_star_matches_all(self) -> None:
        assert translated("*: *") == {"match_all": {}}

    @pytest.mark.parametrize("text", ["", "  "])
    def test_a_blank_query_matches_all(self, text: str) -> None:
        assert translated(text) == {"match_all": {}}


class TestFieldWildcards:
    """A field wildcard is expanded against the field list, in list order."""

    def test_a_phrase_on_a_field_wildcard(self) -> None:
        assert translated('service.*: "check out"') == should(
            {"match_phrase": {"service.name": "check out"}},
            {"match_phrase": {"service.version": "check out"}},
        )

    def test_a_wildcard_value_on_a_field_wildcard(self) -> None:
        assert translated("service.*: check*") == should(
            {"query_string": {"fields": ["service.name"], "query": "check*"}},
            {"query_string": {"fields": ["service.version"], "query": "check*"}},
        )

    def test_a_field_wildcard_matching_a_date_field_uses_the_date_rule(self) -> None:
        assert translated('@time*: "2026-09-25"') == should(
            {
                "range": {
                    "@timestamp": {"gte": "2026-09-25", "lte": "2026-09-25", "time_zone": "UTC"}
                }
            }
        )


class TestNestedQueries:
    """Inside `path: { }` every field name is prefixed with the path."""

    def test_a_wildcard_value_inside_a_nested_query(self) -> None:
        assert translated("items: { name: wid* }") == nested(
            "items", should({"query_string": {"fields": ["items.name"], "query": "wid*"}})
        )

    def test_exists_inside_a_nested_query(self) -> None:
        assert translated("items: { name: * }") == nested(
            "items", should({"exists": {"field": "items.name"}})
        )

    def test_a_range_inside_a_nested_query(self) -> None:
        assert translated("items: { name > m }") == nested(
            "items", should({"range": {"items.name": {"gt": "m"}}})
        )

    def test_operators_inside_a_nested_query(self) -> None:
        assert translated("items: { name: widget or not name: gadget }") == nested(
            "items",
            should(
                is_match("items.name", "widget"),
                {"bool": {"must_not": is_match("items.name", "gadget")}},
            ),
        )

    def test_a_nested_query_inside_a_nested_query(self) -> None:
        assert translated("items: { parts: { sku: x1 } }") == nested(
            "items", nested("items.parts", is_match("items.parts.sku", "x1"))
        )


class TestBooleanComposition:
    """`and` is a filter list, `or` a should list with one required, `not` a must_not."""

    def test_an_and_chain_nests_to_the_right(self) -> None:
        assert translated("log.level: ERROR and service.name: a and host.name: b") == {
            "bool": {
                "filter": [
                    LEVEL_IS_ERROR,
                    {
                        "bool": {
                            "filter": [is_match("service.name", "a"), is_match("host.name", "b")]
                        }
                    },
                ]
            }
        }

    def test_free_text_and_a_field(self) -> None:
        assert translated("ERROR and service.name: checkout") == {
            "bool": {
                "filter": [
                    {"multi_match": {"type": "best_fields", "query": "ERROR", "lenient": True}},
                    is_match("service.name", "checkout"),
                ]
            }
        }

    def test_not_of_a_group(self) -> None:
        assert translated("not (log.level: ERROR or trace.id: *)") == {
            "bool": {"must_not": should(LEVEL_IS_ERROR, should({"exists": {"field": "trace.id"}}))}
        }
