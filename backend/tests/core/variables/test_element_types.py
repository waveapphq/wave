"""Declared element types of array and map values (REQ-3.1.3.19, REQ-3.1.3.14).

One realizer turns a stored value plus its declared type - and, for an array or a
map, the declared type of each element - into the run-time value. Numbers are
stored as exact text; an element's declared type, never its look, decides what
it becomes. An element with no declared type keeps the stored-shape rule.
"""

from decimal import Decimal

import pytest

from wavecore.core.table import Table
from wavecore.core.variables.decimal_value import WaveDecimal
from wavecore.core.variables.element_types import (
    ELEMENT_TYPES,
    element_types_problem,
    realize_declared_value,
    realize_typed_settings,
    runtime_element_types,
    to_platform_numbers,
)


class TestScalars:
    """The scalar rule every element mirrors."""

    def test_large_integer_string_stays_exact(self) -> None:
        result = realize_declared_value("1111111111111199999", "integer")
        assert result == 1111111111111199999
        assert isinstance(result, int)

    def test_negative_integer_string(self) -> None:
        assert realize_declared_value("-7", "integer") == -7

    def test_invalid_integer_string_left_untouched(self) -> None:
        assert realize_declared_value("abc", "integer") == "abc"

    def test_non_coerced_type_left_untouched(self) -> None:
        assert realize_declared_value("3.14", "string") == "3.14"

    def test_already_int_left_untouched(self) -> None:
        assert realize_declared_value(42, "integer") == 42

    def test_float_text_becomes_an_exact_decimal(self) -> None:
        result = realize_declared_value("-2123.123213123123699999", "float")
        assert isinstance(result, WaveDecimal)
        assert result == Decimal("-2123.123213123123699999")

    def test_declared_table_realizes_from_a_list_of_dicts(self) -> None:
        result = realize_declared_value([{"sensor": "alpha", "temp_c": 31.5}], "table")
        assert isinstance(result, Table)
        assert result.col_names() == ["sensor", "temp_c"]

    def test_declared_table_realizes_from_the_stored_dict(self) -> None:
        stored = {"columns": [{"name": "sensor", "type": "string"}], "rows": [["alpha"]]}
        result = realize_declared_value(stored, "table")
        assert isinstance(result, Table)
        assert result.col_names() == ["sensor"]

    def test_a_declared_table_already_realized_passes_through(self) -> None:
        table = Table.from_list([{"sensor": "alpha"}])
        assert realize_declared_value(table, "table") is table

    def test_a_declared_table_that_is_not_a_table_is_left_alone(self) -> None:
        assert realize_declared_value("not a table", "table") == "not a table"

    def test_a_declared_array_of_maps_stays_a_list(self) -> None:
        result = realize_declared_value([{"sensor": "alpha"}], "array")
        assert isinstance(result, list)

    def test_a_declared_array_that_is_not_a_list_is_left_alone(self) -> None:
        assert realize_declared_value("not a list", "array") == "not a list"


class TestCoerceDeclaredValueFloat:
    """Float realization coerces to an exact Decimal (REQ-3.1.3.14).

    The web UI carries floats as exact digit-strings (JS Number rounds past
    ~15-17 significant digits); coercion at realization keeps them exact.
    """

    def test_float_string_stays_exact(self) -> None:
        result = realize_declared_value("-2123.123213123123699999", "float")
        assert result == Decimal("-2123.123213123123699999")
        assert isinstance(result, Decimal)

    def test_dotless_float_string(self) -> None:
        result = realize_declared_value("123", "float")
        assert result == Decimal("123")
        assert isinstance(result, Decimal)

    def test_native_float_recovers_literal_intent(self) -> None:
        result = realize_declared_value(1.08, "float")
        assert result == Decimal("1.08")
        assert isinstance(result, Decimal)

    def test_a_whole_number_becomes_an_exact_float(self) -> None:
        from wavecore.core.variables.decimal_value import decimal_to_str

        result = realize_declared_value(5, "float")
        assert isinstance(result, Decimal)
        assert decimal_to_str(result) == "5"

    def test_a_boolean_is_not_made_a_float(self) -> None:
        assert realize_declared_value(True, "float") is True

    def test_non_numeric_float_string_left_untouched(self) -> None:
        # Validated client-side; if it slips through, leave as-is rather than raise.
        assert realize_declared_value("abc", "float") == "abc"


class TestTextFollowsTheOneNumberRule:
    """Text is a number only when it is plain digits within the caps (REQ-3.1.3.14)."""

    @pytest.mark.parametrize(
        "text",
        [" 30", "+30", "1_000", "\u0663\u0660", "30\n", "12345678901234567890", "3.0"],
        ids=["space", "plus", "underscore", "arabic-indic", "newline", "20-digits", "dot"],
    )
    def test_integer_text_that_breaks_the_rule_stays_text(self, text: str) -> None:
        assert realize_declared_value(text, "integer") == text

    @pytest.mark.parametrize(
        "text",
        ["1e5", "NaN", "Infinity", ".5", "5.", " 2.5", "1.2345678901234567890123456789"],
        ids=["exponent", "nan", "infinity", "no-whole-part", "no-fraction", "space", "29-digits"],
    )
    def test_float_text_that_breaks_the_rule_stays_text(self, text: str) -> None:
        assert realize_declared_value(text, "float") == text

    def test_a_number_keeps_its_conversion(self) -> None:
        assert realize_declared_value(12345678901234567890, "integer") == 12345678901234567890
        assert realize_declared_value(2.5, "float") == WaveDecimal("2.5")


class TestUndeclaredElementsKeepTheShapeRule:
    """An element with no declared type is typed by what is stored."""

    def test_array_nested_text_realized_with_exact_floats(self) -> None:
        result = realize_declared_value([1, "a", True, None, '{"x": 1.5}'], "array")
        assert result == [1, "a", True, None, {"x": Decimal("1.5")}]
        assert isinstance(result[4]["x"], WaveDecimal)

    def test_map_nested_text_realized(self) -> None:
        result = realize_declared_value({"a": 1, "b": None, "c": "[1, 2]"}, "map")
        assert result == {"a": 1, "b": None, "c": [1, 2]}

    def test_nested_float_precision_preserved(self) -> None:
        result = realize_declared_value(['{"hi":123.00000000000000000000002}'], "array")
        assert result == [{"hi": Decimal("123.00000000000000000000002")}]

    def test_a_non_json_bracketed_string_stays_text(self) -> None:
        assert realize_declared_value(["hello", "[not json"], "array") == ["hello", "[not json"]

    def test_numeric_text_without_a_declared_type_stays_text(self) -> None:
        assert realize_declared_value({"n": "16"}, "map") == {"n": "16"}

    def test_an_unknown_declared_type_reads_by_shape(self) -> None:
        assert realize_declared_value({"c": "[1]"}, "map", {"c": "decimal"}) == {"c": [1]}


class TestDeclaredMapElements:
    """Each map value becomes the type its key declares."""

    def test_every_declared_type(self) -> None:
        stored = {
            "n": "16",
            "big": "1234567890123456789",
            "f": "1.0",
            "hp": "0.1000000000000000000000000001",
            "b": False,
            "zip": "02134",
            "txt": "[1, 2]",
            "nested": '{"k": 5, "s": "07"}',
            "lst": "[1.5, 2]",
        }
        types = {
            "n": "integer",
            "big": "integer",
            "f": "float",
            "hp": "float",
            "b": "boolean",
            "zip": "string",
            "txt": "string",
            "nested": "map",
            "lst": "array",
        }
        result = realize_declared_value(stored, "map", types)
        assert result == {
            "n": 16,
            "big": 1234567890123456789,
            "f": Decimal("1.0"),
            "hp": Decimal("0.1000000000000000000000000001"),
            "b": False,
            "zip": "02134",
            "txt": "[1, 2]",
            "nested": {"k": 5, "s": "07"},
            "lst": [Decimal("1.5"), 2],
        }
        assert str(result["f"]) == "1.0"
        assert isinstance(result["f"], WaveDecimal)
        assert isinstance(result["lst"][0], WaveDecimal)
        assert result["f"] * 2 == Decimal("2.0")

    def test_a_declared_string_is_never_parsed(self) -> None:
        assert realize_declared_value({"t": '{"a": 1}'}, "map", {"t": "string"}) == {
            "t": '{"a": 1}'
        }

    def test_text_that_does_not_fit_its_declared_number_stays_text(self) -> None:
        result = realize_declared_value(
            {"n": "1.5", "f": "abc"}, "map", {"n": "integer", "f": "float"}
        )
        assert result == {"n": "1.5", "f": "abc"}

    def test_invalid_json_declared_as_a_structure_stays_text(self) -> None:
        assert realize_declared_value({"s": "[1,"}, "map", {"s": "array"}) == {"s": "[1,"}

    def test_an_already_structured_element_passes(self) -> None:
        result = realize_declared_value(
            {"s": [1, 2], "n": 3}, "map", {"s": "array", "n": "integer"}
        )
        assert result == {"s": [1, 2], "n": 3}

    def test_a_null_declared_element_stays_null(self) -> None:
        assert realize_declared_value({"n": None}, "map", {"n": "integer"}) == {"n": None}

    def test_element_types_of_the_wrong_kind_are_ignored(self) -> None:
        assert realize_declared_value({"n": "16"}, "map", ["integer"]) == {"n": "16"}

    def test_a_key_without_a_declared_type_reads_by_shape(self) -> None:
        assert realize_declared_value({"n": "16", "m": "7"}, "map", {"n": "integer"}) == {
            "n": 16,
            "m": "7",
        }


class TestDeclaredArrayElements:
    """Each array item becomes the type its position declares."""

    def test_items_follow_their_declared_types(self) -> None:
        result = realize_declared_value(
            ["16", "1.0", "02134", True, '[3, "4"]'],
            "array",
            ["integer", "float", "string", "boolean", "array"],
        )
        assert result == [16, Decimal("1.0"), "02134", True, [3, "4"]]

    def test_items_past_the_declared_list_read_by_shape(self) -> None:
        assert realize_declared_value(["16", "17"], "array", ["integer"]) == [16, "17"]

    def test_element_types_of_the_wrong_kind_are_ignored(self) -> None:
        assert realize_declared_value(["16"], "array", {"0": "integer"}) == ["16"]


class TestNullElements:
    """A null item or map value stays null and fits any declared element type; a whole null
    value stays null whatever its type (REQ-3.1.3.19, REQ-3.1.3.20)."""

    @pytest.mark.parametrize("element_type", ELEMENT_TYPES)
    def test_a_null_map_value_stays_null_under_any_element_type(self, element_type: str) -> None:
        result = realize_declared_value(
            {"v": None, "n": "16"}, "map", {"v": element_type, "n": "integer"}
        )
        assert result == {"v": None, "n": 16}

    @pytest.mark.parametrize("element_type", ELEMENT_TYPES)
    def test_a_null_array_item_stays_null_under_any_element_type(self, element_type: str) -> None:
        result = realize_declared_value([None, "16"], "array", [element_type, "integer"])
        assert result == [None, 16]

    @pytest.mark.parametrize("declared_type", [*ELEMENT_TYPES, "table"])
    def test_a_whole_null_value_stays_null(self, declared_type: str) -> None:
        assert realize_declared_value(None, declared_type) is None


class TestElementTypesProblem:
    """A stored sidecar must describe the value it sits beside."""

    def test_no_sidecar_is_fine(self) -> None:
        assert element_types_problem("string", None) is None

    def test_a_valid_map_sidecar(self) -> None:
        assert element_types_problem("map", {"a": "integer", "b": "map"}) is None

    def test_a_valid_array_sidecar(self) -> None:
        assert element_types_problem("array", ["float", "string"]) is None

    def test_a_scalar_takes_no_element_types(self) -> None:
        assert element_types_problem("string", {"a": "integer"}) == (
            "element types apply only to an array or a map"
        )

    def test_a_map_sidecar_must_be_a_mapping(self) -> None:
        assert element_types_problem("map", ["integer"]) == (
            "the element types of a map must map each key to a type"
        )

    def test_an_array_sidecar_must_be_a_list(self) -> None:
        assert element_types_problem("array", {"0": "integer"}) == (
            "the element types of an array must list one type per item"
        )

    def test_an_unknown_map_element_type(self) -> None:
        assert element_types_problem("map", {"a": "decimal"}) == (
            "unknown element type 'decimal' for key 'a' "
            "(must be one of: array, boolean, float, integer, map, string)"
        )

    def test_an_unknown_array_element_type(self) -> None:
        assert element_types_problem("array", ["string", 5]) == (
            "unknown element type '5' for item 1 "
            "(must be one of: array, boolean, float, integer, map, string)"
        )

    def test_the_vocabulary_is_the_six_picker_types(self) -> None:
        assert ELEMENT_TYPES == ("string", "integer", "float", "boolean", "array", "map")


class TestRuntimeElementTypes:
    """A run-time value reports its elements' real types."""

    def test_map_elements(self) -> None:
        value = {
            "n": 16,
            "f": WaveDecimal("1.0"),
            "p": 2.5,
            "b": True,
            "s": "02134",
            "l": [1],
            "m": {"a": 1},
            "z": None,
        }
        assert runtime_element_types(value) == {
            "n": "integer",
            "f": "float",
            "p": "float",
            "b": "boolean",
            "s": "string",
            "l": "array",
            "m": "map",
            "z": "string",
        }

    def test_array_elements(self) -> None:
        assert runtime_element_types([1, "[1]", False]) == ["integer", "string", "boolean"]

    def test_a_scalar_has_none(self) -> None:
        assert runtime_element_types("16") is None


class TestPlatformNumbers:
    """A float reaching a plugin is a platform float, at any depth."""

    def test_decimals_become_floats_at_any_depth(self) -> None:
        result = to_platform_numbers(
            {"a": WaveDecimal("2.5"), "b": [Decimal("1.5"), {"c": Decimal("0.5")}]}
        )
        assert result == {"a": 2.5, "b": [1.5, {"c": 0.5}]}
        assert isinstance(result["a"], float)

    def test_other_values_pass(self) -> None:
        assert to_platform_numbers([1, "x", True, None]) == [1, "x", True, None]


class TestTypedSettings:
    """A block setting's typed entries realize exactly as their declared types; the plugin
    call reduces floats to platform numbers (plugin_executor)."""

    def test_typed_map_entries_realize_exactly(self) -> None:
        values = {
            "driver_options": {"timeout": "2.5", "cached": "16", "app": "2024", "raw": "7"},
            "sql": "SELECT 1",
        }
        element_types = {
            "driver_options": {"timeout": "float", "cached": "integer", "app": "string"}
        }
        result = realize_typed_settings(values, element_types, set())
        assert result == {
            "driver_options": {"timeout": Decimal("2.5"), "cached": 16, "app": "2024", "raw": "7"},
            "sql": "SELECT 1",
        }
        assert isinstance(result["driver_options"]["timeout"], WaveDecimal)
        assert values["driver_options"]["cached"] == "16"

    def test_a_nested_map_entry_realizes_with_exact_floats(self) -> None:
        values = {"driver_options": {"startup_params": '{"x": 1.5, "y": "07"}'}}
        result = realize_typed_settings(
            values, {"driver_options": {"startup_params": "map"}}, set()
        )
        assert result == {"driver_options": {"startup_params": {"x": Decimal("1.5"), "y": "07"}}}
        assert isinstance(result["driver_options"]["startup_params"]["x"], WaveDecimal)

    def test_an_expression_entry_keeps_its_source(self) -> None:
        values = {"driver_options": {"timeout": "10 + 6", "app": "typed"}}
        result = realize_typed_settings(
            values,
            {"driver_options": {"timeout": "integer", "app": "string"}},
            {"driver_options.timeout"},
        )
        assert result == {"driver_options": {"timeout": "10 + 6", "app": "typed"}}

    def test_a_whole_setting_expression_is_left_alone(self) -> None:
        values = {"driver_options": "dbp.driver_options"}
        result = realize_typed_settings(
            values, {"driver_options": {"a": "integer"}}, {"driver_options"}
        )
        assert result == values

    def test_a_typed_list_setting(self) -> None:
        result = realize_typed_settings(
            {"codes": ["502", "x"]}, {"codes": ["integer", "string"]}, set()
        )
        assert result == {"codes": [502, "x"]}

    def test_an_expression_item_of_a_typed_list_keeps_its_source(self) -> None:
        result = realize_typed_settings(
            {"codes": ["502", "16"]}, {"codes": ["integer", "integer"]}, {"codes.1"}
        )
        assert result == {"codes": [502, "16"]}

    @pytest.mark.parametrize("old_type", ["array", "map"])
    def test_an_expression_item_that_was_a_list_or_map_is_never_parsed(self, old_type: str) -> None:
        result = realize_typed_settings(
            {"params": ['"abc"', "[1.5]"]}, {"params": [old_type, "array"]}, {"params.0"}
        )
        assert result == {"params": ['"abc"', [Decimal("1.5")]]}

    @pytest.mark.parametrize("element_type", ELEMENT_TYPES)
    def test_a_null_typed_entry_stays_null(self, element_type: str) -> None:
        result = realize_typed_settings(
            {"parameters": {"v": None}, "codes": [None]},
            {"parameters": {"v": element_type}, "codes": [element_type]},
            set(),
        )
        assert result == {"parameters": {"v": None}, "codes": [None]}

    @pytest.mark.parametrize("element_types", [None, {}])
    def test_no_element_types_leaves_the_values(
        self, element_types: dict[str, object] | None
    ) -> None:
        values = {"driver_options": {"timeout": "7"}}
        assert realize_typed_settings(values, element_types, set()) is values

    def test_a_sidecar_for_a_missing_or_mismatched_setting_is_ignored(self) -> None:
        values = {"driver_options": {"timeout": "7"}, "codes": "text"}
        result = realize_typed_settings(
            values,
            {"missing": {"a": "integer"}, "codes": ["integer"], "driver_options": ["integer"]},
            set(),
        )
        assert result == values
