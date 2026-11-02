"""The JSON reader and writer: comments, duplicate keys, exact decimals, positions (REQ-3.3.2.6)."""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.connectivity.opensearch._json_text import JsonTextError, dumps, loads, parse


def _error(text: str) -> JsonTextError:
    with pytest.raises(JsonTextError) as caught:
        loads(text)
    return caught.value


def _assert_error(text: str, message: str, line: int, col: int) -> None:
    error = _error(text)

    assert (error.message, error.line, error.col) == (message, line, col)


class TestValues:
    """Integers stay int, floats become Decimal, true / false / null map to Python."""

    def test_every_value_kind(self) -> None:
        text = (
            '{"i": 1, "f": 1.5, "t": true, "fa": false, "n": null, '
            '"s": "x", "l": [1, "a"], "o": {}}'
        )

        assert loads(text) == {
            "i": 1,
            "f": Decimal("1.5"),
            "t": True,
            "fa": False,
            "n": None,
            "s": "x",
            "l": [1, "a"],
            "o": {},
        }

    def test_a_float_keeps_its_exact_digits(self) -> None:
        value = loads("12.50")

        assert isinstance(value, Decimal)
        assert str(value) == "12.50"

    @pytest.mark.parametrize(
        ("text", "expected"), [("-0.5", "-0.5"), ("1e3", "1000"), ("2E-2", "0.02")]
    )
    def test_fractions_and_exponents_are_decimal(self, text: str, expected: str) -> None:
        value = loads(text)

        assert isinstance(value, Decimal)
        assert value == Decimal(expected)

    @pytest.mark.parametrize("text", ["-7", "0", "12345678901234567890"])
    def test_integers_are_int(self, text: str) -> None:
        value = loads(text)

        assert type(value) is int
        assert value == int(text)

    def test_string_escapes(self) -> None:
        assert loads(r'"é\n\t\"\\\/\b\f\r"') == 'é\n\t"\\/\b\f\r'

    def test_a_surrogate_pair_escape(self) -> None:
        assert loads(r'"😀"') == "\U0001f600"

    @pytest.mark.parametrize(
        ("text", "expected"), [('"x"', "x"), ("42", 42), ("true", True), ("null", None), ("[]", [])]
    )
    def test_a_top_level_scalar_or_empty_container(self, text: str, expected: Any) -> None:
        assert loads(text) == expected

    def test_surrounding_whitespace(self) -> None:
        assert loads('  \n {"a": 1}\n  ') == {"a": 1}

    def test_key_order_is_kept(self) -> None:
        assert list(loads('{"z": 1, "a": 2, "m": 3}')) == ["z", "a", "m"]

    def test_the_same_key_in_two_objects_is_allowed(self) -> None:
        assert loads('{"a": {"term": 1}, "b": {"term": 2}}') == {"a": {"term": 1}, "b": {"term": 2}}


class TestComments:
    """`//` and `/* */` outside strings, as OpenSearch's own parser allows."""

    def test_line_comments(self) -> None:
        assert loads('// head\n{"a": 1} // tail') == {"a": 1}

    def test_block_comments_between_tokens(self) -> None:
        assert loads('/* c */{"a": /* in */ 1}/* tail */') == {"a": 1}

    def test_comments_inside_an_array(self) -> None:
        assert loads('{"a": [1, /* two */ 2 // three\n, 3]}') == {"a": [1, 2, 3]}

    def test_a_multi_line_block_comment(self) -> None:
        assert loads('/*\n  a\n  b\n*/\n{"a": 1}') == {"a": 1}

    def test_stars_and_slashes_inside_a_block_comment(self) -> None:
        assert loads("/** a * b / c **/ 1") == 1

    def test_comment_markers_inside_strings_are_text(self) -> None:
        assert loads('{"u": "http://x//y", "c": "/* not */"}') == {
            "u": "http://x//y",
            "c": "/* not */",
        }


class TestErrorMessages:
    """`JsonTextError(message, line, col)`; 1-based positions of the offending character."""

    @pytest.mark.parametrize(
        ("text", "col"),
        [('{"a": }', 7), ("[1, ]", 5), ('{"a": nul}', 7), ("", 1)],
        ids=["object-value", "array-trailing-comma", "broken-literal", "empty-text"],
    )
    def test_expected_a_value(self, text: str, col: int) -> None:
        _assert_error(text, "Expected a value", 1, col)

    @pytest.mark.parametrize(
        ("text", "line", "col"),
        [('{"a": 1 "b": 2}', 1, 9), ('{"a": 1\n    "b": 2}', 2, 5), ('{"a": 1', 1, 8)],
        ids=["same-line", "next-line", "end-of-text"],
    )
    def test_expected_comma_or_closing_brace(self, text: str, line: int, col: int) -> None:
        _assert_error(text, "Expected , or }", line, col)

    @pytest.mark.parametrize(
        ("text", "col"), [("[1 2]", 4), ("[1", 3)], ids=["missing-comma", "end-of-text"]
    )
    def test_expected_comma_or_closing_bracket(self, text: str, col: int) -> None:
        _assert_error(text, "Expected , or ]", 1, col)

    @pytest.mark.parametrize(
        ("text", "col"),
        [("{1: 2}", 2), ('{"a": 1, }', 10), ("{'a': 1}", 2)],
        ids=["number-key", "trailing-comma", "single-quoted"],
    )
    def test_expected_a_string_key(self, text: str, col: int) -> None:
        _assert_error(text, "Expected a string key", 1, col)

    def test_expected_a_colon(self) -> None:
        _assert_error('{"a" 1}', "Expected :", 1, 6)

    def test_unterminated_string_message(self) -> None:
        assert _error('{"a": "abc').message == "Unterminated string"

    def test_unterminated_comment_message(self) -> None:
        assert _error('{"a": 1 /* never closed').message == "Unterminated comment"

    @pytest.mark.parametrize(
        ("text", "col"),
        [('{"a": 1} x', 10), ("{} {}", 4), ("1 2", 3)],
        ids=["word", "object", "number"],
    )
    def test_extra_text_after_the_value(self, text: str, col: int) -> None:
        _assert_error(text, "Extra text after the JSON value", 1, col)

    def test_a_trailing_comment_is_not_extra_text(self) -> None:
        assert loads("{} // done") == {}

    def test_a_duplicate_key_at_its_second_occurrence(self) -> None:
        _assert_error('{"term": 1, "term": 2}', 'Duplicate key "term"', 1, 13)

    def test_a_duplicate_key_in_a_nested_object(self) -> None:
        _assert_error('{"q": {"term": 1, "term": 2}}', 'Duplicate key "term"', 1, 19)

    def test_invalid_escape_message(self) -> None:
        assert _error(r'{"a": "x\q"}').message == r"Invalid escape \q"


class TestErrorPositions:
    """Lines and columns count characters; an unclosed token points at where it opened."""

    def test_columns_count_characters_not_bytes(self) -> None:
        _assert_error('{"é": 1 "b": 2}', "Expected , or }", 1, 9)

    def test_a_line_comment_moves_the_error_to_the_next_line(self) -> None:
        _assert_error('// head\n{"a": }', "Expected a value", 2, 7)

    def test_an_unterminated_string_points_at_its_opening_quote(self) -> None:
        _assert_error('{"a": "abc', "Unterminated string", 1, 7)

    def test_an_unterminated_string_on_a_later_line(self) -> None:
        _assert_error('{\n  "a": "abc', "Unterminated string", 2, 8)

    def test_an_unterminated_comment_points_at_its_opening(self) -> None:
        _assert_error('{"a": 1 /* never closed', "Unterminated comment", 1, 9)

    def test_an_invalid_escape_points_at_its_backslash(self) -> None:
        _assert_error(r'{"a": "x\q"}', r"Invalid escape \q", 1, 9)


class TestParseTree:
    """`parse` gives kind, value, start and end offsets, and key spans for the editor."""

    def test_the_root_spans_the_value(self) -> None:
        root = parse('{"a": [1, 2]}')

        assert (root.kind, root.start, root.end) == ("object", 0, 13)

    def test_a_member_value_node_and_its_span(self) -> None:
        member = parse('{"a": [1, 2]}').value["a"]

        assert (member.kind, member.start, member.end) == ("array", 6, 12)

    def test_array_elements_are_nodes(self) -> None:
        second = parse('{"a": [1, 2]}').value["a"].value[1]

        assert (second.kind, second.value, second.start, second.end) == ("number", 2, 10, 11)

    def test_key_spans_cover_the_quoted_key(self) -> None:
        root = parse('{"a": 1, "bc": 2}')

        assert tuple(root.keys["a"]) == (1, 4)
        assert tuple(root.keys["bc"]) == (9, 13)

    def test_scalar_kinds_and_values(self) -> None:
        items = parse('[true, null, "hi", 1.50]').value

        assert [(item.kind, item.value) for item in items] == [
            ("boolean", True),
            ("null", None),
            ("string", "hi"),
            ("number", Decimal("1.50")),
        ]

    def test_a_string_node_spans_its_quotes(self) -> None:
        node = parse('"hi"')

        assert (node.kind, node.value, node.start, node.end) == ("string", "hi", 0, 4)

    def test_offsets_count_characters(self) -> None:
        root = parse('{"é": "ü"}')

        assert (root.value["é"].start, root.value["é"].end) == (6, 9)
        assert tuple(root.keys["é"]) == (1, 4)

    def test_a_leading_comment_is_skipped(self) -> None:
        root = parse('/* c */ {"a": 1}')

        assert (root.start, root.end) == (8, 16)

    def test_parse_refuses_what_loads_refuses(self) -> None:
        with pytest.raises(JsonTextError) as caught:
            parse('{"term": 1, "term": 2}')

        assert (caught.value.message, caught.value.line, caught.value.col) == (
            'Duplicate key "term"',
            1,
            13,
        )


class TestDumps:
    """The one writer: compact, non-ASCII kept, Decimal as its exact digits."""

    def test_compact_separators(self) -> None:
        assert dumps({"a": [1, 2], "b": {"c": None}}) == '{"a":[1,2],"b":{"c":null}}'

    def test_non_ascii_text_is_kept(self) -> None:
        assert dumps({"msg": "héllo ✓"}) == '{"msg":"héllo ✓"}'

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            (Decimal("12.50"), "12.50"),
            (Decimal("0.10"), "0.10"),
            (Decimal("-0.001"), "-0.001"),
            (Decimal("1E+3"), "1000"),
        ],
    )
    def test_a_decimal_is_written_as_its_exact_digits(self, value: Decimal, text: str) -> None:
        assert dumps(value) == text

    @pytest.mark.parametrize(("value", "text"), [(1.5, "1.5"), (0.1, "0.1"), (7, "7"), (-3, "-3")])
    def test_floats_as_repr_and_integers_as_digits(self, value: float, text: str) -> None:
        assert dumps(value) == text

    @pytest.mark.parametrize(("value", "text"), [(True, "true"), (False, "false"), (None, "null")])
    def test_literals(self, value: Any, text: str) -> None:
        assert dumps(value) == text

    def test_strings_are_escaped_as_json(self) -> None:
        assert dumps('a"b\n') == '"a\\"b\\n"'

    def test_decimals_nested_in_lists_and_objects(self) -> None:
        value = {"range": {"price": {"gte": Decimal("12.50"), "in": [Decimal("1.0"), 2]}}}

        assert dumps(value) == '{"range":{"price":{"gte":12.50,"in":[1.0,2]}}}'

    def test_key_order_is_kept(self) -> None:
        assert dumps({"z": 1, "a": 2}) == '{"z":1,"a":2}'

    def test_a_read_value_writes_back_with_the_same_digits(self) -> None:
        assert dumps(loads('{"p": 12.50, "q": [1.0]}')) == '{"p":12.50,"q":[1.0]}'
