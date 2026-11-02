"""WAVE's print form: how WAVE writes a value in its own printing (REQ-3.1.3.23).

Null prints as ``null``, a boolean as ``true`` / ``false``, a list, map or table as
compact JSON text with ``null`` inside, a decimal exactly and a string as it is.
``encode_typed_json`` is the JSON encoder the print form and the script text step share.
"""

import json
from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.table import Table
from wavecore.core.variables.decimal_value import WaveDecimal
from wavecore.core.variables.print_form import encode_typed_json, value_text
from wavecore.plugins import _local_process_common


def _hosts_table() -> Table:
    table = Table(columns=[("host", "string"), ("port", "integer")])
    table.add_row(["web-1", 1])
    return table


_HOSTS_JSON = (
    '{"columns":[{"name":"host","type":"string"},'
    '{"name":"port","type":"integer"}],"rows":[["web-1",1]]}'
)


class TestNullAndBooleans:
    """Null and booleans print in WAVE's form, never Python's."""

    def test_null_prints_null(self) -> None:
        assert value_text(None) == "null"

    @pytest.mark.parametrize(("value", "text"), [(True, "true"), (False, "false")])
    def test_a_boolean_prints_lower_case(self, value: bool, text: str) -> None:
        assert value_text(value) == text


class TestScalars:
    """Numbers print their digits; a decimal keeps its exact text; a string is as it is."""

    @pytest.mark.parametrize(("value", "text"), [(7, "7"), (0, "0"), (-7, "-7")])
    def test_an_integer_prints_its_digits(self, value: int, text: str) -> None:
        assert value_text(value) == text

    def test_a_float_prints_its_own_text(self) -> None:
        assert value_text(0.5) == "0.5"

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            (1e-07, "0.0000001"),
            (2.5e-06, "0.0000025"),
            (1e22, "10000000000000000000000"),
            (0.30000000000000004, "0.30000000000000004"),
        ],
        ids=["tiny", "tiny-digits", "huge", "every-digit"],
    )
    def test_a_float_prints_in_plain_digits_never_in_e_notation(
        self, value: float, text: str
    ) -> None:
        assert value_text(value) == text
        assert value_text([value]) == f"[{text}]"
        assert value_text({"v": value}) == f'{{"v":{text}}}'

    @pytest.mark.parametrize(
        ("value", "alone", "inside"),
        [(float("nan"), "nan", "NaN"), (float("inf"), "inf", "Infinity")],
        ids=["nan", "infinity"],
    )
    def test_a_float_that_is_not_a_number_keeps_its_print(
        self, value: float, alone: str, inside: str
    ) -> None:
        assert (value_text(value), value_text([value])) == (alone, f"[{inside}]")

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            (Decimal("1.50"), "1.50"),
            (Decimal("0.10"), "0.10"),
            (Decimal("1E+2"), "100"),
            (WaveDecimal("3.140"), "3.140"),
        ],
    )
    def test_a_decimal_prints_exactly_and_never_in_e_notation(
        self, value: Decimal, text: str
    ) -> None:
        assert value_text(value) == text

    @pytest.mark.parametrize("value", ["hello", "", "  spaced  ", "null", "None", "true"])
    def test_a_string_prints_as_it_is_without_quotes(self, value: str) -> None:
        assert value_text(value) == value


class TestContainers:
    """A list, map or table prints as compact JSON text with null inside."""

    def test_a_null_list_item_prints_null(self) -> None:
        assert value_text([1, None]) == "[1,null]"

    def test_a_null_map_value_prints_null(self) -> None:
        assert value_text({"a": None}) == '{"a":null}'

    def test_strings_inside_a_list_are_json_quoted(self) -> None:
        assert value_text(["msg1", "msg2"]) == '["msg1","msg2"]'

    def test_booleans_inside_a_map_print_lower_case(self) -> None:
        assert value_text({"ok": True, "failed": False}) == '{"ok":true,"failed":false}'

    def test_a_decimal_nested_in_a_container_keeps_its_exact_text(self) -> None:
        assert value_text([{"k": Decimal("2.0")}, None]) == '[{"k":2.0},null]'

    def test_text_outside_ascii_is_written_as_it_is(self) -> None:
        assert value_text(["café"]) == '["café"]'

    @pytest.mark.parametrize(("value", "text"), [([], "[]"), ({}, "{}")])
    def test_an_empty_container_prints_its_brackets(self, value: Any, text: str) -> None:
        assert value_text(value) == text

    def test_a_table_prints_its_typed_json_form(self) -> None:
        assert value_text(_hosts_table()) == _HOSTS_JSON

    def test_a_null_table_cell_prints_null(self) -> None:
        table = Table(columns=[("host", "string"), ("port", "integer")])
        table.add_row(["web-1", None])

        assert value_text(table) == (
            '{"columns":[{"name":"host","type":"string"},'
            '{"name":"port","type":"integer"}],"rows":[["web-1",null]]}'
        )

    def test_an_empty_table_still_carries_both_keys(self) -> None:
        assert value_text(Table()) == '{"columns":[],"rows":[]}'

    def test_a_number_cell_prints_as_its_number(self) -> None:
        table = Table.from_dict(
            {
                "columns": [{"name": "x", "type": "float"}, {"name": "n", "type": "integer"}],
                "rows": [["0.0000001", "1234567890123456789"]],
            }
        )

        assert value_text(table) == (
            '{"columns":[{"name":"x","type":"float"},{"name":"n","type":"integer"}],'
            '"rows":[[0.0000001,1234567890123456789]]}'
        )

    def test_a_table_inside_a_list_prints_its_number_cells_as_numbers(self) -> None:
        table = Table.from_dict({"columns": [{"name": "x", "type": "float"}], "rows": [["2.50"]]})

        assert value_text([table]) == '[{"columns":[{"name":"x","type":"float"}],"rows":[[2.50]]}]'


class TestValuesJsonCannotWrite:
    """Printing never fails: a nested value JSON cannot write prints as its own text, quoted;
    the script text step still refuses it."""

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            pytest.param({"a": b"x"}, '{"a":"b\'x\'"}', id="bytes-in-a-map"),
            pytest.param([{1}], '["{1}"]', id="set-in-a-list"),
        ],
    )
    def test_it_prints_as_its_own_text_inside_a_container(self, value: Any, text: str) -> None:
        assert value_text(value) == text

    def test_the_script_text_encoder_still_refuses_it(self) -> None:
        with pytest.raises(TypeError, match="^Object of type bytes is not JSON serializable$"):
            encode_typed_json({"a": b"x"})


class TestEncodeTypedJson:
    """The typed JSON encoder writes the same text the script text step writes."""

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            (["a", "b"], '["a","b"]'),
            ({"a": 1, "b": "x"}, '{"a":1,"b":"x"}'),
            ([0.5], "[0.5]"),
            ([Decimal("1.50")], "[1.50]"),
            ({"d": Decimal("0.10")}, '{"d":0.10}'),
            ([{"k": Decimal("2.0")}], '[{"k":2.0}]'),
            ([1, None, 2], "[1,null,2]"),
            ({"a": None}, '{"a":null}'),
            (None, "null"),
            (True, "true"),
            ("a", '"a"'),
            (Table(), '{"columns":[],"rows":[]}'),
        ],
    )
    def test_the_encoder_writes_compact_typed_json(self, value: Any, text: str) -> None:
        assert encode_typed_json(value) == text

    def test_a_table_is_the_json_of_its_columns_and_rows(self) -> None:
        assert encode_typed_json(_hosts_table()) == _HOSTS_JSON

    def test_a_table_round_trips_through_json(self) -> None:
        table = _hosts_table()

        assert json.loads(encode_typed_json(table)) == table.to_dict()

    def test_a_float_cell_keeps_its_stored_text_for_a_script(self) -> None:
        table = Table.from_dict(
            {"columns": [{"name": "x", "type": "float"}], "rows": [["0.0000001"]]}
        )

        assert (
            encode_typed_json(table)
            == '{"columns":[{"name":"x","type":"float"}],"rows":[["0.0000001"]]}'
        )

    def test_the_script_text_step_uses_the_same_encoder(self) -> None:
        assert _local_process_common.encode_typed_json is encode_typed_json
