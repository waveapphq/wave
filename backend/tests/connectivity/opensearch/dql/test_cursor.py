"""What fits at a DQL cursor: a field, a value, an operator or nothing (REQ-3.3.2.6, OS-12)."""

import pytest

from wavecore.connectivity.opensearch.dql import cursor_context


def at_end(text: str) -> tuple[str, str, int, int]:
    context = cursor_context(text, len(text))
    return (context.kind, context.prefix, context.start, context.end)


def kind_at(text: str, offset: int) -> str:
    return cursor_context(text, offset).kind


class TestFieldPositions:
    """A field goes at the start, after `(`, `and`, `or`, `not`, and inside a nested `{ }`."""

    def test_an_empty_line(self) -> None:
        assert at_end("") == ("field", "", 0, 0)

    def test_the_first_word(self) -> None:
        assert at_end("log.le") == ("field", "log.le", 0, 6)

    def test_the_first_word_after_leading_whitespace(self) -> None:
        assert at_end("  log.le") == ("field", "log.le", 2, 8)

    def test_after_an_opening_parenthesis(self) -> None:
        assert at_end("(serv") == ("field", "serv", 1, 5)

    def test_after_and(self) -> None:
        assert at_end("log.level: ERROR and serv") == ("field", "serv", 21, 25)

    def test_after_or_with_nothing_typed(self) -> None:
        assert at_end("log.level: ERROR or ") == ("field", "", 20, 20)

    def test_after_not(self) -> None:
        assert at_end("not serv") == ("field", "serv", 4, 8)

    @pytest.mark.parametrize("word", ["AND", "Or", "NOT"])
    def test_operator_words_in_any_case(self, word: str) -> None:
        text = f"log.level: ERROR {word} serv"
        assert at_end(text) == ("field", "serv", len(text) - 4, len(text))

    def test_inside_a_nested_query(self) -> None:
        assert at_end("items: { na") == ("field", "na", 9, 11)

    def test_inside_a_nested_query_with_nothing_typed(self) -> None:
        assert at_end("items: { ") == ("field", "", 9, 9)

    def test_a_word_followed_by_more_text(self) -> None:
        context = cursor_context("log.le and trace.id: *", 6)
        assert (context.kind, context.prefix, context.start, context.end) == (
            "field",
            "log.le",
            0,
            6,
        )


class TestOperatorPositions:
    """After a complete expression and a space, `and`, `or` or `not` fits."""

    @pytest.mark.parametrize(
        "text",
        [
            "log.level: ERROR ",
            "(log.level: ERROR) ",
            'message: "Batch complete" ',
            "items: { name: widget } ",
            "latency_ms >= 500 ",
            "log.level: (ERROR or WARN) ",
        ],
    )
    def test_after_a_complete_expression_and_a_space(self, text: str) -> None:
        assert at_end(text) == ("operator", "", len(text), len(text))


class TestValuePositions:
    """After `:` or a range operator, inside quotes and inside a value list, a value goes."""

    @pytest.mark.parametrize(
        "text",
        [
            "log.level:",
            "log.level: ",
            "log.level: ER",
            'message: "Batch com',
            '"Batch com',
            "latency_ms >= 5",
            "latency_ms < ",
            "log.level: (ERROR or W",
            "log.level: (ERROR or ",
        ],
    )
    def test_a_value_fits(self, text: str) -> None:
        assert kind_at(text, len(text)) == "value"


class TestNothingFits:
    """Inside `{{ }}` and straight after a closing parenthesis, nothing is suggested."""

    def test_inside_an_open_template_marker(self) -> None:
        assert kind_at("user.name: {{ us", 16) == "none"

    def test_inside_a_closed_template_marker(self) -> None:
        assert kind_at("user.name: {{ user }} and trace.id: *", 15) == "none"

    def test_inside_a_template_marker_where_a_field_goes(self) -> None:
        assert kind_at("{{ fi", 5) == "none"

    def test_straight_after_a_closing_parenthesis(self) -> None:
        assert kind_at("(log.level: ERROR)", 18) == "none"
