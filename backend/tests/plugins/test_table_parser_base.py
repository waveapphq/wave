"""Unit tests for the table-conversion behavior the CSV and Excel converters share.

Requirements tested:
- REQ-3.1.3.14: a column picked by index reads its index by the one integer rule
- REQ-3.4.1.12, REQ-3.4.1.13: a filter's Template compare-to value is filled for each cell
"""

from typing import Any

import pytest

from wavecore.core.table import Table
from wavecore.plugins._table_parser_base import TableParserBase, _column_ref
from wavecore.plugins.csv_parser import CSVParserPlugin
from wavecore.plugins.excel_parser import ExcelParserPlugin


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


class TestTemplateFilterValue:
    """A filter's text compare-to value held as a Template is filled for each cell, the same
    way in the CSV and the Excel parser (REQ-3.4.1.12, REQ-3.4.1.13)."""

    @pytest.mark.parametrize("plugin", [CSVParserPlugin, ExcelParserPlugin], ids=["csv", "excel"])
    def test_a_filter_template_compare_to_is_filled(self, plugin: type[TableParserBase]) -> None:
        table = Table(columns=[("host", "string")])
        for host in ("web-1", "db-1", "web-2"):
            table.add_row([host])
        condition = {
            "id": "filter-cond-1",
            "type": "literal",
            "variable": "_cell",
            "value_type": "string",
            "operator": "equals",
            "reference_value": "{{ prefix }}-1",
            "reference_is_template": True,
        }
        filters = [
            {
                "id": "filter-1",
                "column": {"mode": "name", "value": "host"},
                "asType": "string",
                "conditions": [condition],
            }
        ]

        kept = plugin().apply_transforms(table, [], filters, {"prefix": "web"})

        assert kept.col("host") == ["web-1"]


class TestFilterConditionJoins:
    """A filter whose conditions have no and / or between them stops the Block with the save's
    text (REQ-3.4.1.12, REQ-3.4.1.13)."""

    @pytest.mark.parametrize("plugin", [CSVParserPlugin, ExcelParserPlugin], ids=["csv", "excel"])
    def test_filter_conditions_side_by_side_stop_the_block(
        self, plugin: type[TableParserBase]
    ) -> None:
        table = Table(columns=[("host", "string")])
        table.add_row(["web-1"])
        starts = {
            "type": "literal",
            "variable": "_cell",
            "value_type": "string",
            "operator": "starts_with",
            "reference_value": "web",
        }
        ends = {**starts, "operator": "ends_with", "reference_value": "-2"}
        filters = [
            {
                "id": "filter-1",
                "column": {"mode": "name", "value": "host"},
                "asType": "string",
                "conditions": [starts, ends],
            }
        ]

        parser = plugin()
        with pytest.raises(
            ValueError,
            match=r"^Condition items in 'filters\.0\.conditions' must be joined by 'and' or 'or'$",
        ):
            parser.apply_transforms(table, [], filters, {})
