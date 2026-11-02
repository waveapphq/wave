"""Unit tests for the table-conversion behavior the CSV and Excel converters share.

Requirements tested:
- REQ-3.1.3.14: a column picked by index reads its index by the one integer rule
"""

from typing import Any

import pytest

from wavecore.plugins._table_parser_base import _column_ref


class TestColumnReference:
    """A sort or filter column is a name, or a 0-based index written as an integer."""

    def test_a_name_is_text(self) -> None:
        assert _column_ref({"mode": "name", "value": 7}) == "7"

    @pytest.mark.parametrize(
        ("value", "index"), [("1", 1), (2, 2), ("-1", -1)], ids=["text", "integer", "negative"]
    )
    def test_an_index_is_its_integer(self, value: Any, index: int) -> None:
        assert _column_ref({"mode": "index", "value": value}) == index

    @pytest.mark.parametrize(
        ("value", "said"),
        [
            ("one", "Column index 'one' is not a valid integer"),
            (" 1", "Column index ' 1' is not a valid integer"),
            ("1.0", "Column index '1.0' is not a valid integer"),
            (1.5, "Column index '1.5' is not a valid integer"),
            (
                "12345678901234567890",
                "Column index '12345678901234567890' allows at most 19 " "digits, got 20",
            ),
        ],
        ids=["word", "space", "dot", "float", "20-digits"],
    )
    def test_an_index_that_is_not_an_integer_stops_the_block(self, value: Any, said: str) -> None:
        with pytest.raises(ValueError, match=f"^{said}$"):
            _column_ref({"mode": "index", "value": value})
