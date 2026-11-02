"""What a variable declaration holds when a run starts (REQ-3.1.3.13, REQ-3.1.3.15, REQ-3.1.3.20).

One rule for a Test variable and for a Function's local, output and staged value: a plain
value realized as its declared type, an Expression or Template source evaluated at its first
read, and null when the declaration holds no value.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.variables.declared_values import DeclaredStart, declared_start


class TestALiteral:
    def test_a_value_is_realized_as_its_declared_type(self) -> None:
        start = declared_start({"type": "float", "value": 5})

        assert start.kind == "literal"
        assert start.value == Decimal(5)
        assert isinstance(start.value, Decimal)

    def test_list_items_take_their_declared_element_types(self) -> None:
        start = declared_start(
            {"type": "array", "value": ["7", "x"], "elementTypes": ["integer", "string"]}
        )

        assert start == DeclaredStart("literal", [7, "x"], "array")

    def test_an_output_reads_its_default(self) -> None:
        start = declared_start({"type": "integer", "default": "12"}, "default")

        assert start == DeclaredStart("literal", 12, "integer")


class TestAComputedSource:
    def test_an_expression_keeps_its_source_and_type(self) -> None:
        start = declared_start({"type": "integer", "value": "count * 2", "isExpression": True})

        assert start == DeclaredStart("expression", "count * 2", "integer")

    def test_an_expression_with_no_type_reads_string(self) -> None:
        start = declared_start({"value": "a + b", "isExpression": True})

        assert start == DeclaredStart("expression", "a + b", "string")

    def test_a_template_keeps_its_source_as_text(self) -> None:
        start = declared_start({"type": "string", "value": 42, "isTemplate": True})

        assert start == DeclaredStart("template", "42", "string")


class TestNoValue:
    @pytest.mark.parametrize(
        "entry",
        [
            pytest.param({"type": "string"}, id="plain"),
            pytest.param({"type": "integer", "isExpression": True}, id="expression"),
            pytest.param({"type": "string", "isTemplate": True}, id="template"),
            pytest.param(
                {"type": "integer", "value": None, "isExpression": True}, id="null-source"
            ),
        ],
    )
    def test_a_declaration_with_no_value_holds_null(self, entry: dict[str, Any]) -> None:
        assert declared_start(entry) == DeclaredStart("literal", None, entry["type"])


def test_expression_and_template_together_are_refused() -> None:
    with pytest.raises(ValueError, match=r"^is_expression and is_template are mutually exclusive$"):
        declared_start({"type": "string", "value": "x", "isExpression": True, "isTemplate": True})
