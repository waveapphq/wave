"""The ``{{ }}`` marker and the expressions a template holds (REQ-3.1.3.13)."""

import time

from wavecore.core.expressions.template import template_expressions

# A quadratic marker scan takes seconds on one unclosed line of this many braces.
BRACE_RUN = "{" * 50_000
LINEAR_BOUND_SECONDS = 1.0


class TestTemplateExpressions:
    def test_a_single_brace_inside_a_marker_belongs_to_the_expression(self) -> None:
        assert template_expressions("a {{ x }} b {{ {'k': 1}['k'] }}") == ["x", "{'k': 1}['k']"]

    def test_a_marker_does_not_span_lines(self) -> None:
        assert template_expressions("{{ x\n}}") == []

    def test_a_second_opening_starts_the_marker_over(self) -> None:
        assert template_expressions("{{ a {{ b }}") == ["b"]

    def test_a_long_unclosed_run_of_braces_is_scanned_in_linear_time(self) -> None:
        start = time.perf_counter()
        expressions = template_expressions(BRACE_RUN)
        elapsed = time.perf_counter() - start

        assert expressions == []
        assert elapsed < LINEAR_BOUND_SECONDS
