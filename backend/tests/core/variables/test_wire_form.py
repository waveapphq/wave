"""Unit tests for the form a run value takes on its way to the browser (REQ-3.1.3.14).

Requirements tested:
- REQ-3.1.3.14: a number reaches the browser as a JSON number only when that number keeps every
  digit in plain notation; otherwise as its exact text
"""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.table import Table
from wavecore.core.variables.wire_form import wire_scalar, wire_values


class TestWireScalar:
    @pytest.mark.parametrize(
        ("value", "sent"),
        [
            (42, 42),
            (2**53 - 1, 2**53 - 1),
            (2**53, "9007199254740992"),
            (-(2**53), "-9007199254740992"),
            (2.5, 2.5),
            (1e-7, "0.0000001"),
            (1e21, "1000000000000000000000"),
            (30.0, "30.0"),
            (float("nan"), "NaN"),
            (Decimal("2.50"), "2.50"),
            (Decimal("1E+3"), "1000"),
            (True, True),
            ("text", "text"),
            (None, None),
        ],
        ids=[
            "small-int",
            "largest-exact-int",
            "past-exact-int",
            "negative-past-exact-int",
            "plain-float",
            "small-float",
            "large-float",
            "whole-float",
            "nan",
            "decimal",
            "decimal-exponent",
            "boolean",
            "text",
            "null",
        ],
    )
    def test_a_value_travels_in_its_wire_form(self, value: Any, sent: Any) -> None:
        assert wire_scalar(value) == sent
        assert type(wire_scalar(value)) is type(sent)


class TestWireValues:
    def test_numbers_at_any_depth_travel_in_their_wire_form(self) -> None:
        value = {"ids": [1, 2**60], "nested": {"ratio": Decimal("0.10")}, "pair": (1e21, "x")}

        assert wire_values(value) == {
            "ids": [1, "1152921504606846976"],
            "nested": {"ratio": "0.10"},
            "pair": ["1000000000000000000000", "x"],
        }

    def test_a_value_that_is_neither_list_map_nor_number_passes(self) -> None:
        table = Table(columns=[("id", "integer")])

        assert wire_values(table) is table
