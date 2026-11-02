# Cases from OpenSearch Dashboards 3.8.0 src/plugins/data/common/opensearch_query/kuery/
# kuery_syntax_error.test.ts (UPSTREAM_ERRORS) and ast/ast.test.ts (TestLiterals), Apache-2.0,
# Copyright OpenSearch Contributors and Elasticsearch B.V. Changed: ported to pytest. See NOTICE.
"""DQL grammar, field names and syntax errors, as Dashboards 3.8.0 `kuery.peg` (REQ-3.3.2.6)."""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.connectivity.opensearch._fields import FieldInfo, FieldList
from wavecore.connectivity.opensearch.dql import DqlSyntaxError, field_names, parse, to_query

KEYWORD = FieldInfo(types=["keyword"], aggregatable=True)
FIELDS = FieldList(
    indices=["app-logs-2026.09.25"],
    fields={
        "log.level": KEYWORD,
        "service.name": KEYWORD,
        "user.name": KEYWORD,
        "status": KEYWORD,
        "message": KEYWORD,
        "items": FieldInfo(types=["nested"], aggregatable=False),
        "items.name": KEYWORD,
        "a:b": KEYWORD,
    },
)

# (DQL, message, failure offset) from upstream kuery_syntax_error.test.ts, line 1 throughout.
UPSTREAM_ERRORS = [
    ("response:", 'Expected "(", "{", value, whitespace but end of input found.', 9),
    ("response:200 or ", 'Expected "(", NOT, field name, value but end of input found.', 16),
    ("response:(200 or )", 'Expected "(", NOT, value but ")" found.', 17),
    ("response:200 and not ", 'Expected "(", field name, value but end of input found.', 21),
    ("response:(200 and not )", 'Expected "(", value but ")" found.', 22),
    ('foo:"bo ', 'Expected "(", "{", value, whitespace but """ found.', 4),
    ('foo:"bo "r"', 'Expected AND, OR, end of input, whitespace but "r" found.', 9),
    ("foo:bo:r", 'Expected AND, OR, end of input, whitespace but ":" found.', 6),
    ("foo > ", "Expected literal, whitespace but end of input found.", 6),
    ("< 1000", 'Expected "(", NOT, end of input, field name, value, whitespace but "<" found.', 0),
]

# Further inputs, texts produced by running the upstream generated parser.
MORE_ERRORS = [
    ("log.level: not ERROR", 'Expected "(", "{", value, whitespace but "n" found.', 11),
    ("items: { name: widget", 'Expected "}", AND, OR, whitespace but end of input found.', 21),
    (")", 'Expected "(", NOT, end of input, field name, value, whitespace but ")" found.', 0),
    ("foo:bo\\", 'Expected AND, OR, end of input, whitespace but "\\" found.', 6),
    ('a: "x" "y"', 'Expected end of input, whitespace but """ found.', 7),
    ("items: {", 'Expected "(", NOT, field name, value, whitespace but end of input found.', 8),
    ("not not a: 1", 'Expected "(", field name, value but "n" found.', 4),
    ("a:: b", 'Expected "(", "{", value, whitespace but ":" found.', 2),
    ("a: ()", 'Expected "(", NOT, value, whitespace but ")" found.', 4),
    ("(a:1))", 'Expected AND, OR, end of input, whitespace but ")" found.', 5),
    ("items: { name: widget } and", 'Expected end of input, whitespace but "a" found.', 24),
    ("user.name: cannot stop", 'Expected AND, OR, end of input, whitespace but "n" found.', 14),
]


def syntax_error(text: str) -> DqlSyntaxError:
    with pytest.raises(DqlSyntaxError) as caught:
        parse(text)
    return caught.value


def dsl(text: str) -> dict[str, Any]:
    return to_query(parse(text), FIELDS)


def should(*queries: dict[str, Any]) -> dict[str, Any]:
    return {"bool": {"should": list(queries), "minimum_should_match": 1}}


def all_of(*queries: dict[str, Any]) -> dict[str, Any]:
    return {"bool": {"filter": list(queries)}}


def negated(query: dict[str, Any]) -> dict[str, Any]:
    return {"bool": {"must_not": query}}


def match(field: str, value: Any) -> dict[str, Any]:
    return should({"match": {field: value}})


def phrase(field: str, value: Any) -> dict[str, Any]:
    return should({"match_phrase": {field: value}})


def value_of(value_text: str) -> Any:
    """The literal `status: <value_text>` sends, read from its single `match` clause."""
    return dsl(f"status: {value_text}")["bool"]["should"][0]["match"]["status"]


class TestPinnedSyntaxErrors:
    """The two syntax-error texts, confirmed against the upstream parser."""

    @pytest.mark.parametrize(
        ("text", "message", "offset", "line", "col"),
        [
            (
                "log.level:",
                'Expected "(", "{", value, whitespace but end of input found.',
                10,
                1,
                11,
            ),
            (
                "log.level: (ERROR",
                'Expected ")", AND, OR, whitespace but end of input found.',
                17,
                1,
                18,
            ),
        ],
        ids=["missing-value", "unclosed-value-list"],
    )
    def test_the_message_and_position_match_dashboards(
        self, text: str, message: str, offset: int, line: int, col: int
    ) -> None:
        error = syntax_error(text)
        assert (error.message, error.offset, error.line, error.col) == (message, offset, line, col)

    def test_the_error_is_an_exception(self) -> None:
        assert isinstance(syntax_error("log.level:"), Exception)


class TestUpstreamErrorTexts:
    """Every case of the upstream syntax-error suite gives the same short message and offset."""

    @pytest.mark.parametrize(("text", "message", "offset"), UPSTREAM_ERRORS)
    def test_the_upstream_case_reads_the_same(self, text: str, message: str, offset: int) -> None:
        error = syntax_error(text)
        assert (error.message, error.offset, error.line, error.col) == (
            message,
            offset,
            1,
            offset + 1,
        )


class TestExpectationReporting:
    """Expectations at the furthest failure: translated, unique, sorted by code units."""

    @pytest.mark.parametrize(("text", "message", "offset"), MORE_ERRORS)
    def test_the_furthest_failure_names_what_fits_there(
        self, text: str, message: str, offset: int
    ) -> None:
        error = syntax_error(text)
        assert (error.message, error.offset, error.line, error.col) == (
            message,
            offset,
            1,
            offset + 1,
        )

    def test_quoted_literals_sort_before_rule_names_and_upper_case_before_lower_case(self) -> None:
        assert syntax_error(")").message == (
            'Expected "(", NOT, end of input, field name, value, whitespace but ")" found.'
        )

    def test_an_expectation_reached_twice_is_listed_once(self) -> None:
        assert syntax_error("log.level: (ERROR").message.count("AND") == 1

    def test_the_found_character_is_written_raw_inside_double_quotes(self) -> None:
        assert syntax_error('foo:"bo ').message.endswith(' but """ found.')


class TestErrorPositions:
    """Line and column are 1-based; a line ends at LF, CRLF or a lone CR."""

    def test_a_line_feed_starts_a_new_line(self) -> None:
        error = syntax_error("log.level: ERROR or\nmessage:")
        assert (error.offset, error.line, error.col) == (28, 2, 9)

    def test_crlf_counts_as_one_line_break(self) -> None:
        error = syntax_error("log.level: ERROR or\r\nmessage:")
        assert (error.offset, error.line, error.col) == (29, 2, 9)

    def test_a_lone_carriage_return_starts_a_new_line(self) -> None:
        error = syntax_error("a: 1\rb:")
        assert error.message == 'Expected AND, OR, end of input, whitespace but ":" found.'
        assert (error.offset, error.line, error.col) == (6, 2, 2)

    def test_offsets_count_code_points(self) -> None:
        error = syntax_error("\U0001f642:")
        assert (error.offset, error.line, error.col) == (2, 1, 3)

    def test_a_found_character_outside_the_bmp_is_written_whole(self) -> None:
        error = syntax_error("(a: 1)\U0001f642")
        assert error.message == 'Expected AND, OR, end of input, whitespace but "\U0001f642" found.'
        assert error.offset == 6


class TestFieldValueExpressions:
    """`field: value` with optional whitespace; an unquoted value keeps its inner spaces."""

    @pytest.mark.parametrize(
        "text",
        ["log.level: ERROR", "log.level:ERROR", "  log.level :  ERROR  ", '"log.level": ERROR'],
    )
    def test_the_field_and_value_are_read(self, text: str) -> None:
        assert dsl(text) == match("log.level", "ERROR")

    def test_an_unquoted_value_is_not_split_on_whitespace(self) -> None:
        assert dsl("message: Load test finished") == match("message", "Load test finished")

    def test_a_keyword_without_whitespace_after_it_stays_in_the_value(self) -> None:
        assert dsl("log.level: ERROR and") == match("log.level", "ERROR and")

    def test_a_quoted_value_is_a_phrase(self) -> None:
        assert dsl('log.level: "ERROR"') == phrase("log.level", "ERROR")

    def test_a_quoted_value_keeps_keywords_as_text(self) -> None:
        assert dsl('message: "ERROR and WARN"') == phrase("message", "ERROR and WARN")


class TestBooleanOperators:
    """`and` binds tighter than `or`, `not` binds to one sub-query, both nest to the right."""

    def test_and(self) -> None:
        assert dsl("log.level: ERROR and service.name: checkout") == all_of(
            match("log.level", "ERROR"), match("service.name", "checkout")
        )

    def test_or(self) -> None:
        assert dsl("log.level: ERROR or service.name: checkout") == should(
            match("log.level", "ERROR"), match("service.name", "checkout")
        )

    def test_not(self) -> None:
        assert dsl("not log.level: INFO") == negated(match("log.level", "INFO"))

    def test_and_binds_tighter_than_or(self) -> None:
        assert dsl("log.level: ERROR or service.name: a and user.name: b") == should(
            match("log.level", "ERROR"), all_of(match("service.name", "a"), match("user.name", "b"))
        )

    def test_a_chain_nests_to_the_right(self) -> None:
        assert dsl("log.level: ERROR and service.name: a and user.name: b") == all_of(
            match("log.level", "ERROR"), all_of(match("service.name", "a"), match("user.name", "b"))
        )

    def test_not_takes_only_the_next_sub_query(self) -> None:
        assert dsl("not log.level: INFO and service.name: a") == all_of(
            negated(match("log.level", "INFO")), match("service.name", "a")
        )

    def test_parentheses_override_precedence(self) -> None:
        assert dsl("(log.level: ERROR or service.name: a) and user.name: b") == all_of(
            should(match("log.level", "ERROR"), match("service.name", "a")), match("user.name", "b")
        )

    def test_not_of_a_group(self) -> None:
        assert dsl("not (log.level: ERROR or service.name: a)") == negated(
            should(match("log.level", "ERROR"), match("service.name", "a"))
        )

    def test_a_group_alone_is_its_query(self) -> None:
        assert dsl("( log.level: ERROR )") == match("log.level", "ERROR")

    @pytest.mark.parametrize("word", ["and", "AND", "And", "aNd"])
    def test_and_is_case_insensitive(self, word: str) -> None:
        assert dsl(f"status: 1 {word} status: 2") == all_of(match("status", 1), match("status", 2))

    @pytest.mark.parametrize("word", ["or", "OR", "Or"])
    def test_or_is_case_insensitive(self, word: str) -> None:
        assert dsl(f"status: 1 {word} status: 2") == should(match("status", 1), match("status", 2))

    @pytest.mark.parametrize("word", ["not", "NOT", "Not"])
    def test_not_is_case_insensitive(self, word: str) -> None:
        assert dsl(f"{word} status: 1") == negated(match("status", 1))

    def test_tabs_and_newlines_separate_operators(self) -> None:
        assert dsl("log.level: ERROR\nand\tservice.name: checkout") == all_of(
            match("log.level", "ERROR"), match("service.name", "checkout")
        )

    def test_not_alone_is_a_free_text_value(self) -> None:
        assert dsl("not") == {
            "multi_match": {"type": "best_fields", "query": "not", "lenient": True}
        }


class TestValueLists:
    """`field: (a or b)` applies each value to the one field."""

    def test_or_list(self) -> None:
        assert dsl("log.level: (ERROR or WARN)") == should(
            match("log.level", "ERROR"), match("log.level", "WARN")
        )

    def test_and_list(self) -> None:
        assert dsl("log.level: (ERROR and WARN)") == all_of(
            match("log.level", "ERROR"), match("log.level", "WARN")
        )

    def test_grouping_and_not_inside_a_list(self) -> None:
        assert dsl("log.level: ((ERROR or WARN) and not DEBUG)") == all_of(
            should(match("log.level", "ERROR"), match("log.level", "WARN")),
            negated(match("log.level", "DEBUG")),
        )

    def test_a_list_mixes_quoted_and_unquoted_values(self) -> None:
        assert dsl('log.level: ( ERROR or "WARN" )') == should(
            match("log.level", "ERROR"), phrase("log.level", "WARN")
        )


class TestRangeExpressions:
    """`<`, `<=`, `>`, `>=` between a field and one literal."""

    @pytest.mark.parametrize(
        ("operator", "key"), [("<", "lt"), ("<=", "lte"), (">", "gt"), (">=", "gte")]
    )
    def test_each_operator(self, operator: str, key: str) -> None:
        assert dsl(f"status {operator} 500") == should({"range": {"status": {key: 500}}})

    def test_whitespace_around_the_operator_is_optional(self) -> None:
        assert dsl("status>=500") == should({"range": {"status": {"gte": 500}}})

    def test_a_quoted_bound_stays_text(self) -> None:
        assert dsl('status < "500"') == should({"range": {"status": {"lt": "500"}}})


class TestNestedQueries:
    """`path: { query }` scopes the inner field names under the path."""

    @pytest.mark.parametrize("text", ["items: { name: widget }", "items:{name:widget}"])
    def test_the_inner_field_is_scoped(self, text: str) -> None:
        assert dsl(text) == {
            "nested": {
                "path": "items",
                "query": match("items.name", "widget"),
                "score_mode": "none",
            }
        }

    def test_the_inner_query_takes_operators(self) -> None:
        assert dsl("items: { name: widget and name: gadget }") == {
            "nested": {
                "path": "items",
                "query": all_of(match("items.name", "widget"), match("items.name", "gadget")),
                "score_mode": "none",
            }
        }

    def test_a_nested_query_combines_with_others(self) -> None:
        nested = {
            "nested": {
                "path": "items",
                "query": match("items.name", "widget"),
                "score_mode": "none",
            }
        }
        assert dsl("items: { name: widget } or log.level: ERROR") == should(
            nested, match("log.level", "ERROR")
        )

    def test_a_nested_query_inside_a_nested_query_joins_the_paths(self) -> None:
        assert dsl("items: { parts: { sku: x1 } }") == {
            "nested": {
                "path": "items",
                "query": {
                    "nested": {
                        "path": "items.parts",
                        "query": match("items.parts.sku", "x1"),
                        "score_mode": "none",
                    }
                },
                "score_mode": "none",
            }
        }


class TestLiterals:
    """Unquoted literals become numbers, `true`, `false` or `null` by Dashboards' number pattern."""

    @pytest.mark.parametrize(
        ("text", "number"),
        [
            ("404", 404),
            ("-4", -4),
            ("0", 0),
            ("96565646732345", 96565646732345),
            ("9007199254740993", 9007199254740993),
        ],
    )
    def test_an_integer_is_an_exact_integer(self, text: str, number: int) -> None:
        value = value_of(text)
        assert type(value) is int
        assert value == number

    @pytest.mark.parametrize(
        "text", ["1.50", ".3", ".00001", "0.0", "2.0", "0.8", "790.9", "-1.25"]
    )
    def test_a_decimal_is_a_number(self, text: str) -> None:
        value = value_of(text)
        assert not isinstance(value, str | bool)
        assert Decimal(str(value)) == Decimal(text)

    @pytest.mark.parametrize(
        "text",
        [
            "007",
            "0.50",
            "-0",
            "1e5",
            "3.",
            "..4",
            ".3text",
            "00.2",
            "0.0.1",
            "--4",
            "-.4",
            "00949",
            ".",
            "-",
        ],
    )
    def test_anything_else_stays_text(self, text: str) -> None:
        assert value_of(text) == text

    def test_true(self) -> None:
        assert value_of("true") is True

    def test_false(self) -> None:
        assert value_of("false") is False

    def test_null(self) -> None:
        assert value_of("null") is None

    @pytest.mark.parametrize("text", ["TRUE", "False", "Null"])
    def test_the_words_are_lower_case_only(self, text: str) -> None:
        assert value_of(text) == text

    @pytest.mark.parametrize("text", ["true", "404", "null"])
    def test_a_quoted_literal_stays_text(self, text: str) -> None:
        assert dsl(f'status: "{text}"') == phrase("status", text)


class TestEscapes:
    """Outside quotes a backslash escapes specials and keywords; inside, `"` and `\\`."""

    @pytest.mark.parametrize(
        ("value_text", "literal"),
        [
            (r"\(\)\:\<\>\"\*", '():<>"*'),
            (r"\{\}", "{}"),
            (r"\\", "\\"),
            (r"ann \or bob", "ann or bob"),
            (r"\AND", "AND"),
            (r"\Not me", "Not me"),
            (r"x \and y", "x and y"),
            (r"x\ty", "x\ty"),
            (r"x\ry", "x\ry"),
            (r"x\ny", "x\ny"),
        ],
    )
    def test_an_escape_outside_quotes(self, value_text: str, literal: str) -> None:
        assert dsl(f"user.name: {value_text}") == match("user.name", literal)

    @pytest.mark.parametrize(
        ("quoted", "literal"),
        [
            (r'"x\"y\\z"', 'x"y\\z'),
            (r'"a\b"', "a\\b"),
            (r'"t\tn"', "t\tn"),
            ('"():<>*{}"', "():<>*{}"),
        ],
    )
    def test_an_escape_inside_quotes(self, quoted: str, literal: str) -> None:
        assert dsl(f"user.name: {quoted}") == phrase("user.name", literal)

    def test_an_escaped_colon_belongs_to_the_field_name(self) -> None:
        assert dsl(r"a\:b: c") == match("a:b", "c")

    def test_a_backslash_before_lower_case_not_is_an_escaped_newline(self) -> None:
        assert dsl(r"user.name: x \not y") == match("user.name", "x \not y")


class TestWildcards:
    """An unescaped `*` outside quotes makes the value a wildcard."""

    def test_a_star_in_a_value_is_a_wildcard(self) -> None:
        assert dsl("user.name: ann*") == should(
            {"query_string": {"fields": ["user.name"], "query": "ann*"}}
        )

    def test_a_quoted_star_is_text(self) -> None:
        assert dsl('user.name: "ann*"') == phrase("user.name", "ann*")

    def test_an_escaped_star_is_text(self) -> None:
        assert dsl(r"user.name: ann\*") == match("user.name", "ann*")

    def test_a_lone_star_value_asks_whether_the_field_exists(self) -> None:
        assert dsl("user.name: *") == should({"exists": {"field": "user.name"}})

    def test_a_lone_star_query_is_a_query_string(self) -> None:
        assert dsl("*") == {"query_string": {"query": "*"}}


class TestEmptyQuery:
    """An empty or blank query matches everything, as Dashboards' start rule builds `*: *`."""

    @pytest.mark.parametrize("text", ["", "   ", "\n\t"])
    def test_a_blank_query_matches_all(self, text: str) -> None:
        assert dsl(text) == {"match_all": {}}


class TestFieldNames:
    """`field_names` lists the fields a query names, once each, in order of first mention."""

    def test_one_field(self) -> None:
        assert field_names(parse("log.level: ERROR")) == ["log.level"]

    def test_order_of_first_mention(self) -> None:
        assert field_names(parse("service.name: a and log.level: b or latency_ms > 5")) == [
            "service.name",
            "log.level",
            "latency_ms",
        ]

    def test_a_repeated_field_is_listed_once(self) -> None:
        assert field_names(parse("log.level: ERROR or log.level: WARN")) == ["log.level"]

    def test_a_value_list_names_its_field_once(self) -> None:
        assert field_names(parse("log.level: (ERROR or WARN)")) == ["log.level"]

    @pytest.mark.parametrize("text", ["ERROR", '"Batch complete"', "ERROR and checkout", "*"])
    def test_free_text_names_no_field(self, text: str) -> None:
        assert field_names(parse(text)) == []

    def test_free_text_beside_a_field(self) -> None:
        assert field_names(parse("ERROR and service.name: checkout")) == ["service.name"]

    def test_a_nested_query_names_the_path_and_the_full_inner_name(self) -> None:
        assert field_names(parse("items: { name: widget }")) == ["items", "items.name"]

    def test_a_wildcard_field_is_listed_as_written(self) -> None:
        assert field_names(parse("service.*: checkout")) == ["service.*"]

    def test_a_quoted_field_name_is_unquoted(self) -> None:
        assert field_names(parse('"log.level": ERROR')) == ["log.level"]

    def test_an_escaped_field_name_is_unescaped(self) -> None:
        assert field_names(parse(r"a\:b: c")) == ["a:b"]

    def test_negated_and_exists_queries_name_their_field(self) -> None:
        assert field_names(parse("not trace.id: *")) == ["trace.id"]
