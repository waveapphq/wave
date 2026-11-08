"""`{{ }}` values escaped for where they land (REQ-3.3.2.6, OS-5)."""

import re
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.expressions.errors import InvalidExpressionError
from wavecore.core.expressions.template_escape import mask_markers, render_escaped
from wavecore.core.table import Table

MARKER = re.compile(r"\{\{(.+?)\}\}")


def _evaluator(values: dict[str, Any]) -> Callable[[str], Any]:
    """Looks each marker's expression up by name."""
    return lambda expression: values[expression.strip()]


def _filled(template: str, rule: str, **values: Any) -> str:
    return render_escaped(template, rule, _evaluator(values), MARKER, setting="query")[0]


def _pairs(template: str, rule: str, **values: Any) -> list[tuple[str, str]]:
    return render_escaped(template, rule, _evaluator(values), MARKER, setting="query")[1]


def _refuse(expression: str) -> Any:
    raise AssertionError(f"evaluated {expression!r}")


def _render(
    template: str, rule: str, setting: str = "query", **values: Any
) -> tuple[str, list[tuple[str, str]]]:
    """render_escaped told which setting it fills."""
    return render_escaped(template, rule, _evaluator(values), MARKER, setting=setting)


def _null_piece(expression: str, setting: str) -> str:
    """The exact refusal for a null ``{{ }}`` piece (REQ-3.1.3.22)."""
    return f"'{{{{ {expression} }}}}' in '{setting}' is null"


class TestEscapeTable:
    """The escape table, one case per row."""

    @pytest.mark.parametrize(
        ("template", "rule", "name", "value", "expected"),
        [
            ('trace.id: "{{ trace }}"', "dql", "trace", 'a1"b', r'trace.id: "a1\"b"'),
            ("user.name: {{ user }}", "dql", "user", "ann or bob", r"user.name: ann \or bob"),
            ("host.name: {{ prefix }}*", "dql", "prefix", "web(1)", r"host.name: web\(1\)*"),
            ("user.name: {{ user }}", "dql", "user", "*", r"user.name: \*"),
            ("user.name: {{ user }}", "dql", "user", "", 'user.name: ""'),
            (
                '{"term": {"trace.id": "{{ trace }}"}}',
                "json",
                "trace",
                'a1"b',
                r'{"term": {"trace.id": "a1\"b"}}',
            ),
            (
                '{"range": {"latency_ms": {"gte": {{ limit }}}}}',
                "json",
                "limit",
                500,
                '{"range": {"latency_ms": {"gte": 500}}}',
            ),
            (
                '{"terms": {"user.id": {{ ids }}}}',
                "json",
                "ids",
                ["u1", "u2"],
                '{"terms": {"user.id": ["u1","u2"]}}',
            ),
            ('{"term": {"env": {{ env }}}}', "json", "env", "prod", '{"term": {"env": "prod"}}'),
            (
                '{"term": {"price": {{ price }}}}',
                "json",
                "price",
                Decimal("12.50"),
                '{"term": {"price": 12.50}}',
            ),
        ],
        ids=[
            "dql-quote-in-a-phrase",
            "dql-operator-word",
            "dql-parentheses-before-a-wildcard",
            "dql-lone-wildcard",
            "dql-empty-value",
            "json-quote-in-a-string",
            "json-integer",
            "json-list",
            "json-standing-alone-text",
            "json-decimal",
        ],
    )
    def test_row(self, template: str, rule: str, name: str, value: Any, expected: str) -> None:
        assert _filled(template, rule, **{name: value}) == expected


class TestEscapedPairs:
    """render_escaped answers one (raw text, escaped text) pair per filled marker, in order."""

    def test_a_quoted_dql_value_pairs_its_raw_and_escaped_text(self) -> None:
        assert _pairs('trace.id: "{{ trace }}"', "dql", trace='a1"b') == [('a1"b', r"a1\"b")]

    def test_a_standing_alone_text_pairs_with_its_json_string(self) -> None:
        assert _pairs('{"term": {"env": {{ env }}}}', "json", env="prod") == [("prod", '"prod"')]

    def test_an_integer_pairs_its_digits(self) -> None:
        assert _pairs('{"gte": {{ limit }}}', "json", limit=500) == [("500", "500")]

    def test_a_decimal_pairs_its_exact_digits(self) -> None:
        assert _pairs('{"price": {{ price }}}', "json", price=Decimal("12.50")) == [
            ("12.50", "12.50")
        ]

    def test_a_list_pairs_its_compact_json(self) -> None:
        assert _pairs('{"ids": {{ ids }}}', "json", ids=["u1", "u2"]) == [
            ('["u1","u2"]', '["u1","u2"]')
        ]

    def test_markers_pair_in_template_order(self) -> None:
        template = 'a: "{{ trace }}" and b: {{ user }}'

        assert _pairs(template, "dql", trace='a1"b', user="ann or bob") == [
            ('a1"b', r"a1\"b"),
            ("ann or bob", r"ann \or bob"),
        ]

    def test_a_template_without_markers_is_returned_as_is(self) -> None:
        assert render_escaped("user.name: ann", "dql", _refuse, MARKER, setting="query") == (
            "user.name: ann",
            [],
        )

    def test_an_empty_marker_is_left_as_written(self) -> None:
        assert render_escaped("user.name: {{ }}", "dql", _refuse, MARKER, setting="query") == (
            "user.name: {{ }}",
            [],
        )


def _part_pairs(
    template: str, rule: str, parts: tuple[str, ...], **values: Any
) -> list[tuple[str, str]]:
    """The pairs render_escaped answers when told which parts to look for."""
    evaluate = _evaluator(values)
    return render_escaped(template, rule, evaluate, MARKER, setting="query", parts=parts)[1]


class TestEscapedParts:
    """A part found inside a larger value pairs with the escaped text it takes there."""

    def test_a_part_inside_a_quoted_dql_value(self) -> None:
        pairs = _part_pairs('msg: "{{ v }}"', "dql", ('p"w',), v='id p"w end')

        assert pairs == [('id p"w end', r"id p\"w end"), ('p"w', r"p\"w")]

    def test_a_part_inside_a_bare_dql_value(self) -> None:
        pairs = _part_pairs("msg: {{ v }}", "dql", ("pass(w)",), v="id pass(w) end")

        assert pairs == [("id pass(w) end", r"id pass\(w\) end"), ("pass(w)", r"pass\(w\)")]

    def test_a_bare_dql_part_keeps_the_operator_marks_of_the_whole_value(self) -> None:
        pairs = _part_pairs("msg: {{ v }}", "dql", ("or b:c", "p:w or"), v="a or b:c p:w orb")

        assert pairs == [
            ("a or b:c p:w orb", r"a \or b\:c p\:w orb"),
            ("or b:c", r"\or b\:c"),
            ("p:w or", r"p\:w or"),
        ]

    def test_a_part_inside_a_json_string(self) -> None:
        pairs = _part_pairs('{"q": "{{ v }}"}', "json", ("a\\b",), v="id a\\b end")

        assert pairs == [("id a\\b end", r"id a\\b end"), ("a\\b", r"a\\b")]

    def test_a_part_inside_a_standing_alone_json_text(self) -> None:
        pairs = _part_pairs('{"q": {{ v }}}', "json", ("p\bw",), v="id p\bw")

        assert pairs == [("id p\bw", r'"id p\bw"'), ("p\bw", r"p\bw")]

    def test_a_part_inside_a_standing_alone_json_list_keeps_its_text(self) -> None:
        pairs = _part_pairs('{"q": {{ v }}}', "json", ("secret1",), v=["secret1", "x"])

        assert pairs == [('["secret1","x"]', '["secret1","x"]'), ("secret1", "secret1")]

    def test_a_part_found_twice_with_one_escaped_text_pairs_once(self) -> None:
        pairs = _part_pairs('msg: "{{ v }}"', "dql", ('p"w',), v='p"w and p"w')

        assert pairs == [('p"w and p"w', r"p\"w and p\"w"), ('p"w', r"p\"w")]

    def test_a_part_found_twice_with_two_escaped_texts_pairs_each(self) -> None:
        pairs = _part_pairs("msg: {{ v }}", "dql", ("x or",), v="x or x orb")

        assert pairs == [("x or x orb", r"x \or x orb"), ("x or", r"x \or"), ("x or", "x or")]

    def test_a_part_that_is_the_whole_value_adds_no_pair(self) -> None:
        pairs = _part_pairs('msg: "{{ v }}"', "dql", ('p"w',), v='p"w')

        assert pairs == [('p"w', r"p\"w")]

    def test_a_part_the_value_does_not_hold_adds_no_pair(self) -> None:
        pairs = _part_pairs('msg: "{{ v }}"', "dql", ("hunter2",), v='id p"w')

        assert pairs == [('id p"w', r"id p\"w")]

    def test_parts_are_looked_for_in_every_marker(self) -> None:
        template = 'a: "{{ trace }}" and b: {{ user }}'

        pairs = _part_pairs(template, "dql", ("k(1)",), trace="id k(1)", user="k(1) x")

        assert pairs == [
            ("id k(1)", "id k(1)"),
            ("k(1)", "k(1)"),
            ("k(1) x", r"k\(1\) x"),
            ("k(1)", r"k\(1\)"),
        ]


class TestLandingScanner:
    """A quote not preceded by an odd run of backslashes toggles the landing."""

    def test_an_escaped_quote_does_not_open_a_dql_phrase(self) -> None:
        assert _filled(r"msg: \"{{ v }}", "dql", v="x or y") == r"msg: \"x \or y"

    def test_a_quote_after_an_even_backslash_run_opens_a_dql_phrase(self) -> None:
        assert _filled(r'msg: \\"{{ v }}"', "dql", v="x or y") == r'msg: \\"x or y"'

    def test_an_escaped_quote_inside_a_dql_phrase_keeps_it_open(self) -> None:
        assert _filled(r'msg: "say \"hi\" {{ v }}"', "dql", v='a"b') == r'msg: "say \"hi\" a\"b"'

    def test_the_landing_follows_the_template_not_the_filled_text(self) -> None:
        template = 'a: "{{ trace }}" and b: {{ user }}'

        assert _filled(template, "dql", trace='a1"b', user="ann or bob") == (
            r'a: "a1\"b" and b: ann \or bob'
        )

    def test_a_phrase_stays_open_across_lines(self) -> None:
        assert _filled('a: "line one\n{{ v }}"', "dql", v="x or y") == 'a: "line one\nx or y"'

    def test_a_quote_after_an_even_backslash_run_closes_a_json_string(self) -> None:
        assert _filled(r'{"a": "\\", "b": {{ v }}}', "json", v="x") == r'{"a": "\\", "b": "x"}'

    def test_an_escaped_quote_inside_a_json_string_keeps_it_open(self) -> None:
        assert _filled(r'{"a": "say \"{{ v }}"}', "json", v='q"t') == r'{"a": "say \"q\"t"}'

    def test_a_key_string_closes_before_its_value(self) -> None:
        assert _filled('{"{{ k }}": {{ v }}}', "json", k='a"b', v=1) == r'{"a\"b": 1}'

    def test_quotes_inside_a_marker_do_not_toggle_the_landing(self) -> None:
        values = {"pick('\"')": "p", "user": "ann or bob"}
        template = "a: {{ pick('\"') }} b: {{ user }}"

        filled, _ = render_escaped(template, "dql", _evaluator(values), MARKER, setting="query")

        assert filled == r"a: p b: ann \or bob"

    def test_the_marker_pattern_is_the_one_passed_in(self) -> None:
        pattern = re.compile(r"<<(.+?)>>")

        filled, pairs = render_escaped(
            "user.name: << user >> and {{ user }}",
            "dql",
            _evaluator({"user": "ann or bob"}),
            pattern,
            setting="query",
        )

        assert filled == r"user.name: ann \or bob and {{ user }}"
        assert pairs == [("ann or bob", r"ann \or bob")]


class TestDqlInsideQuotes:
    def test_a_backslash_is_doubled(self) -> None:
        assert _filled('a: "{{ v }}"', "dql", v="c:\\temp") == r'a: "c:\\temp"'

    def test_tab_carriage_return_and_line_feed_become_escapes(self) -> None:
        assert _filled('a: "{{ v }}"', "dql", v="a\tb\rc\nd") == r'a: "a\tb\rc\nd"'

    def test_specials_and_operator_words_are_left_alone(self) -> None:
        value = "web(1)* or not x:<y> {z}"

        assert _filled('a: "{{ v }}"', "dql", v=value) == f'a: "{value}"'

    def test_an_empty_value_leaves_an_empty_phrase(self) -> None:
        assert _filled('a: "{{ v }}"', "dql", v="") == 'a: ""'


class TestDqlOutsideQuotes:
    @pytest.mark.parametrize("special", ["\\", "(", ")", ":", "<", ">", '"', "*", "{", "}"])
    def test_each_special_character_gets_a_backslash(self, special: str) -> None:
        assert _filled("a: {{ v }}", "dql", v=f"x{special}y") == f"a: x\\{special}y"

    def test_every_special_in_one_value(self) -> None:
        assert _filled("a: {{ v }}", "dql", v='\\():<>"*{}') == r"a: \\\(\)\:\<\>\"\*\{\}"

    @pytest.mark.parametrize("word", ["or", "OR", "Or", "and", "AND", "aNd", "NOT", "Not"])
    def test_an_operator_word_in_any_case_gets_a_backslash(self, word: str) -> None:
        assert _filled("a: {{ v }}", "dql", v=f"x {word} y") == f"a: x \\{word} y"

    def test_operator_words_at_the_ends_of_the_value(self) -> None:
        assert _filled("a: {{ v }}", "dql", v="Not ann or") == r"a: \Not ann \or"

    def test_a_lone_operator_word(self) -> None:
        assert _filled("a: {{ v }}", "dql", v="and") == r"a: \and"

    def test_adjacent_operator_words(self) -> None:
        assert _filled("a: {{ v }}", "dql", v="or and not") == r"a: \or \and not"

    def test_words_that_contain_an_operator_word_are_left_alone(self) -> None:
        value = "order android nothing nor"

        assert _filled("a: {{ v }}", "dql", v=value) == f"a: {value}"

    def test_an_operator_word_not_bounded_by_whitespace_is_left_alone(self) -> None:
        assert _filled("a: {{ v }}", "dql", v="a(or)b x:and") == r"a: a\(or\)b x\:and"

    def test_tab_carriage_return_and_line_feed_become_escapes(self) -> None:
        assert _filled("a: {{ v }}", "dql", v="a\tb\rc\nd") == r"a: a\tb\rc\nd"

    def test_an_operator_word_bounded_by_line_breaks_and_tabs(self) -> None:
        assert _filled("a: {{ v }}", "dql", v="ann\nor\tbob") == r"a: ann\n\or\tbob"

    def test_other_characters_are_left_alone(self) -> None:
        value = "web-01.example.com a_b/c[d]!e@f#g ann bob"

        assert _filled("a: {{ v }}", "dql", v=value) == f"a: {value}"


def _not_refusal(marker: str) -> str:
    return (
        f'{marker} puts a lowercase "not" before a space outside quotes. DQL reads that as '
        'the NOT operator, even inside a word such as "cannot stop", and there is no way to '
        f"escape it. Put quotes around {marker}."
    )


class TestDqlNotBeforeASpace:
    """DQL reads `not` + space as NOT, even inside a word; only a capital `N` can be escaped."""

    @pytest.mark.parametrize(
        ("value", "filled"),
        [("KNOT tied", r"K\NOT tied"), ("canNot stop", r"can\Not stop"), ("x NoT y", r"x \NoT y")],
    )
    def test_a_capital_n_not_before_a_space_gets_a_backslash_even_inside_a_word(
        self, value: str, filled: str
    ) -> None:
        assert _filled("a: {{ v }}", "dql", v=value) == f"a: {filled}"

    def test_a_capital_n_not_ending_the_value_before_a_template_space_gets_a_backslash(
        self,
    ) -> None:
        assert _filled("a: {{ v }} or b: 1", "dql", v="canNot") == r"a: can\Not or b: 1"

    @pytest.mark.parametrize("value", ["cannot", "nothing", "notes", "knot"])
    def test_a_not_with_no_space_after_it_is_left_alone(self, value: str) -> None:
        assert _filled("a: {{ v }}", "dql", v=value) == f"a: {value}"

    @pytest.mark.parametrize(
        ("value", "filled"), [("not\tx", r"not\tx"), ("cannot\nstop", r"cannot\nstop")]
    )
    def test_a_not_before_an_escaped_tab_or_line_break_is_left_alone(
        self, value: str, filled: str
    ) -> None:
        assert _filled("a: {{ v }}", "dql", v=value) == f"a: {filled}"

    def test_a_lowercase_not_inside_quotes_is_left_alone(self) -> None:
        assert _filled('a: "{{ v }}"', "dql", v="cannot stop") == 'a: "cannot stop"'

    @pytest.mark.parametrize("value", ["x not y", "not ann", "cannot stop", "knot tied", "noT x"])
    def test_a_lowercase_not_before_a_space_is_refused(self, value: str) -> None:
        with pytest.raises(InvalidExpressionError, match=f"^{re.escape(_not_refusal('{{ v }}'))}$"):
            render_escaped("a: {{ v }}", "dql", _evaluator({"v": value}), MARKER, setting="query")

    def test_a_lowercase_not_ending_the_value_before_a_template_space_is_refused(self) -> None:
        with pytest.raises(InvalidExpressionError, match=f"^{re.escape(_not_refusal('{{ v }}'))}$"):
            render_escaped(
                "a: {{ v }} or b: 1", "dql", _evaluator({"v": "cannot"}), MARKER, setting="query"
            )

    def test_the_refusal_names_the_marker_as_written_and_its_expression(self) -> None:
        with pytest.raises(InvalidExpressionError) as caught:
            render_escaped(
                "a: {{user}}", "dql", _evaluator({"user": "do not retry"}), MARKER, setting="query"
            )

        assert str(caught.value) == _not_refusal("{{user}}")
        assert caught.value.expression == "user"

    def test_the_json_rule_never_refuses_a_lowercase_not(self) -> None:
        assert _filled('{"a": "{{ v }}"}', "json", v="cannot stop") == '{"a": "cannot stop"}'


class TestJsonInsideString:
    def test_a_backslash_is_doubled(self) -> None:
        assert _filled('{"a": "{{ v }}"}', "json", v="c:\\temp") == r'{"a": "c:\\temp"}'

    def test_line_feed_and_tab_become_escapes(self) -> None:
        assert _filled('{"a": "{{ v }}"}', "json", v="a\nb\tc") == r'{"a": "a\nb\tc"}'

    def test_a_control_character_becomes_a_unicode_escape(self) -> None:
        assert _filled('{"a": "{{ v }}"}', "json", v="a\x01b") == r'{"a": "a\u0001b"}'

    def test_non_ascii_text_is_kept(self) -> None:
        assert _filled('{"a": "{{ v }}"}', "json", v="café ☃") == '{"a": "café ☃"}'

    def test_an_empty_value_leaves_an_empty_string(self) -> None:
        assert _filled('{"a": "{{ v }}"}', "json", v="") == '{"a": ""}'

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (True, "true"),
            (Decimal("1E+3"), "1000"),
            (["u1", "u2"], r"[\"u1\",\"u2\"]"),
        ],
        ids=["boolean", "decimal", "list"],
    )
    def test_a_non_text_value_is_escaped_in_its_text_form(self, value: Any, expected: str) -> None:
        assert _filled('{"a": "{{ v }}"}', "json", v=value) == f'{{"a": "{expected}"}}'

    def test_a_null_value_fails_and_names_the_piece(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=f"^{re.escape(_null_piece('v', 'query'))}$"):
            _render('{"a": "{{ v }}"}', "json", v=None)


class TestJsonStandingAlone:
    """The JSON value writer."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("prod", '"prod"'),
            ('a"b', r'"a\"b"'),
            ("", '""'),
            (500, "500"),
            (-1, "-1"),
            (Decimal("12.50"), "12.50"),
            (Decimal("1E+3"), "1000"),
            (Decimal("-0.000001"), "-0.000001"),
            (0.25, "0.25"),
            (True, "true"),
            (False, "false"),
            (None, "null"),
            (["u1", "u2"], '["u1","u2"]'),
            ({"a": 1, "b": "x"}, '{"a":1,"b":"x"}'),
            ([True, None, 2], "[true,null,2]"),
        ],
        ids=[
            "text",
            "text-with-quote",
            "empty-text",
            "integer",
            "negative-integer",
            "decimal",
            "decimal-exponent",
            "decimal-small",
            "float",
            "true",
            "false",
            "none",
            "list",
            "map",
            "nested-literals",
        ],
    )
    def test_value(self, value: Any, expected: str) -> None:
        assert _filled('{"a": {{ v }}}', "json", v=value) == f'{{"a": {expected}}}'

    def test_a_table_writes_its_rows_as_compact_json(self) -> None:
        table = Table.from_list([{"name": "ann", "age": 3}])

        assert _filled('{"a": {{ v }}}', "json", v=table) == '{"a": [{"name":"ann","age":3}]}'

    def test_a_decimal_inside_a_list_keeps_its_exact_digits(self) -> None:
        assert _filled('{"a": {{ v }}}', "json", v=[Decimal("1.50"), 2]) == '{"a": [1.50,2]}'


class TestTextForm:
    """A value becomes text before a DQL escape applies."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (True, "true"),
            (False, "false"),
            (42, "42"),
            (Decimal("12.50"), "12.50"),
            (Decimal("1E+3"), "1000"),
            (0.25, "0.25"),
            (["u1", "u2"], r"[\"u1\",\"u2\"]"),
            ({"a": 1}, r"\{\"a\"\:1\}"),
        ],
        ids=[
            "true",
            "false",
            "integer",
            "decimal",
            "decimal-exponent",
            "float",
            "list",
            "map",
        ],
    )
    def test_outside_quotes(self, value: Any, expected: str) -> None:
        assert _filled("a: {{ v }}", "dql", v=value) == f"a: {expected}"

    def test_a_null_outside_quotes_fails_and_names_the_piece(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=f"^{re.escape(_null_piece('v', 'query'))}$"):
            _render("a: {{ v }}", "dql", v=None)

    def test_a_table_inside_quotes(self) -> None:
        table = Table.from_list([{"name": "ann", "age": 3}])

        assert _filled('a: "{{ v }}"', "dql", v=table) == r'a: "[{\"name\":\"ann\",\"age\":3}]"'


class TestNullPieces:
    """OS-5: a null piece standing alone as a JSON value is JSON null; anywhere else it fails."""

    def test_a_null_standing_alone_in_json_is_json_null(self) -> None:
        filled, _ = _render('{"term": {"user.id": {{ v }}}}', "json", v=None)

        assert filled == '{"term": {"user.id": null}}'

    @pytest.mark.parametrize(
        ("template", "rule"),
        [
            ('{"term": {"user.id": "{{ v }}"}}', "json"),
            ('{"{{ v }}": 1}', "json"),
            ("user.id: {{ v }}", "dql"),
            ('user.id: "{{ v }}"', "dql"),
        ],
        ids=["json-inside-a-string", "json-key", "dql-outside-quotes", "dql-inside-quotes"],
    )
    def test_a_null_anywhere_else_fails_and_names_the_piece(self, template: str, rule: str) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=f"^{re.escape(_null_piece('v', 'query'))}$"):
            _render(template, rule, v=None)

    @pytest.mark.parametrize("setting", ["query", "note"])
    def test_the_refusal_names_the_setting_it_was_given(self, setting: str) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=f"^{re.escape(_null_piece('v', setting))}$"):
            _render("user.id: {{ v }}", "dql", setting=setting, v=None)

    def test_the_piece_is_named_with_its_text_stripped(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=f"^{re.escape(_null_piece('uid', 'query'))}$"):
            _render('{"a": "{{uid}}"}', "json", uid=None)

    def test_the_null_piece_is_named_among_filled_pieces(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=f"^{re.escape(_null_piece('b', 'query'))}$"):
            _render("a: {{ a }} and b: {{ b }}", "dql", a="x", b=None)

    def test_the_null_error_is_an_expression_evaluation_error(self) -> None:
        from wavecore.core.expressions.errors import ExpressionEvaluationError, NullValueError

        with pytest.raises(NullValueError) as caught:
            _render("a: {{ v }}", "dql", v=None)

        assert isinstance(caught.value, ExpressionEvaluationError)

    @pytest.mark.parametrize(
        ("template", "rule", "expected"),
        [
            ('{"a": "{{ v }}"}', "json", r'{"a": "[\"u1\",null]"}'),
            ('{"a": {{ v }}}', "json", '{"a": ["u1",null]}'),
            ("a: {{ v }}", "dql", r"a: [\"u1\",null]"),
        ],
        ids=["json-inside-a-string", "json-standing-alone", "dql-outside-quotes"],
    )
    def test_a_list_holding_null_is_not_a_null_piece(
        self, template: str, rule: str, expected: str
    ) -> None:
        filled, _ = _render(template, rule, v=["u1", None])

        assert filled == expected


class TestEvaluatorErrors:
    def test_an_evaluator_failure_propagates_unchanged(self) -> None:
        failure = ValueError("Variable 'missing' is not defined")

        def evaluate(_expression: str) -> Any:
            raise failure

        with pytest.raises(ValueError, match=r"^Variable 'missing' is not defined$") as caught:
            render_escaped("a: {{ missing }}", "dql", evaluate, MARKER, setting="query")

        assert caught.value is failure


class TestMaskMarkers:
    """Same-length placeholders for the while-typing check."""

    @pytest.mark.parametrize(
        ("template", "rule", "expected"),
        [
            ('trace.id: "{{ trace }}"', "dql", 'trace.id: "' + "x" * 11 + '"'),
            ("user.name: {{ user }}", "dql", "user.name: " + "x" * 10),
            (
                '{"term": {"trace.id": "{{ trace }}"}}',
                "json",
                '{"term": {"trace.id": "' + "x" * 11 + '"}}',
            ),
            ('{"gte": {{ limit }}}', "json", '{"gte": 0' + " " * 10 + "}"),
            ('{"{{ k }}": {{ v }}}', "json", '{"' + "x" * 7 + '": 0' + " " * 6 + "}"),
            (r'{"a": "x\"{{ v }}"}', "json", r'{"a": "x\"' + "x" * 7 + '"}'),
            ('a: "{{ q }}" and b: {{ u }}', "dql", 'a: "' + "x" * 7 + '" and b: ' + "x" * 7),
        ],
        ids=[
            "dql-inside-quotes",
            "dql-outside-quotes",
            "json-inside-string",
            "json-standing-alone",
            "json-key-and-value",
            "json-escaped-quote",
            "dql-mixed",
        ],
    )
    def test_mask(self, template: str, rule: str, expected: str) -> None:
        masked = mask_markers(template, rule, MARKER)

        assert masked == expected
        assert len(masked) == len(template)

    def test_a_template_without_markers_is_unchanged(self) -> None:
        assert mask_markers('user.name: "ann"', "dql", MARKER) == 'user.name: "ann"'

    def test_the_marker_pattern_is_the_one_passed_in(self) -> None:
        masked = mask_markers('{"a": << v >>, "b": {{ v }}}', "json", re.compile(r"<<(.+?)>>"))

        assert masked == '{"a": 0' + " " * 6 + ', "b": {{ v }}}'
