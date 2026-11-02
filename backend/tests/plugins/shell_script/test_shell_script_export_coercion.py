"""Reading the capture file and converting an export to its variable's type (REQ-3.4.1.1).

SHRUN-6: each export is read as the type of the WAVE variable it is bound to. A
structured value is JSON only, a message never echoes the value, and a name the
script never set is not a failure.
"""

import inspect
import re
from decimal import Decimal

import pytest

from wavecore.core.table import Table
from wavecore.plugins import _shell_capture
from wavecore.plugins._shell_capture import Captured, CaptureError, coerce, parse_capture

NUL = b"\x00"

ARRAY_MESSAGE = (
    "Script variable 'X' is not a valid array: the value must use valid JSON array syntax"
)
MAP_MESSAGE = "Script variable 'X' is not a valid map: the value must use valid JSON object syntax"
TABLE_MESSAGE = (
    "Script variable 'X' is not a valid table: "
    "the value must use valid JSON array-of-objects syntax"
)


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def scalar_message(name: str, type_name: str) -> str:
    return f"Script variable '{name}' is not a valid {type_name}"


def record(*fields: str) -> bytes:
    return NUL.join(field.encode("utf-8") for field in fields) + NUL


def scalar_record(name: str, value: str) -> bytes:
    return record(name, "s", value)


def list_record(name: str, *items: str) -> bytes:
    return record(name, "a", str(len(items)), *items)


def map_record(name: str, pairs: dict[str, str]) -> bytes:
    fields = [name, "A", str(len(pairs))]
    for key, value in pairs.items():
        fields.extend([key, value])
    return record(*fields)


def unset_record(name: str) -> bytes:
    return record(name, "u")


def scalar(value: str) -> Captured:
    return Captured(kind="s", scalar=value, items=None, pairs=None)


def items(*values: str) -> Captured:
    return Captured(kind="a", scalar=None, items=list(values), pairs=None)


def pairs(mapping: dict[str, str]) -> Captured:
    return Captured(kind="A", scalar=None, items=None, pairs=mapping)


def unset() -> Captured:
    return Captured(kind="u", scalar=None, items=None, pairs=None)


class TestCaptureReader:
    """The delimited capture file, read back a record at a time."""

    def test_every_kind_is_read(self) -> None:
        data = (
            scalar_record("COUNT", "3")
            + list_record("ARR", "x", "y z", "")
            + map_record("M", {"k1": "v1", "k2": "v 2"})
            + unset_record("MISSING")
        )

        parsed = parse_capture(data)

        assert parsed["COUNT"].kind == "s"
        assert parsed["COUNT"].scalar == "3"
        assert parsed["ARR"].kind == "a"
        assert parsed["ARR"].items == ["x", "y z", ""]
        assert parsed["M"].kind == "A"
        assert parsed["M"].pairs == {"k1": "v1", "k2": "v 2"}
        assert parsed["MISSING"].kind == "u"

    def test_a_value_holding_newlines_arrives_intact(self) -> None:
        parsed = parse_capture(scalar_record("STATUS", "two words\nnewline\n"))

        assert parsed["STATUS"].scalar == "two words\nnewline\n"

    def test_a_truncated_scalar_leaves_the_name_out(self) -> None:
        assert parse_capture(b"COUNT" + NUL + b"s" + NUL + b"3") == {}

    def test_a_list_with_fewer_elements_than_its_count_leaves_the_name_out(self) -> None:
        assert parse_capture(record("ARR", "a", "3", "x")) == {}

    def test_an_unknown_kind_marker_leaves_the_name_out(self) -> None:
        assert parse_capture(record("COUNT", "Z", "3")) == {}

    def test_empty_data_reads_as_no_names(self) -> None:
        assert parse_capture(b"") == {}


class TestScalarConversion:
    """Scalar text read as the bound variable's type."""

    def test_string_is_verbatim(self) -> None:
        assert coerce("S", scalar("  spaced\nline  "), "string") == "  spaced\nline  "

    def test_integer_is_trimmed(self) -> None:
        assert coerce("COUNT", scalar(" 7 "), "integer") == 7

    def test_integer_keeps_arbitrary_precision(self) -> None:
        digits = "123456789012345678901234567890"

        assert coerce("COUNT", scalar(digits), "integer") == int(digits)

    @pytest.mark.parametrize(("text", "expected"), [("+7", 7), ("-7", -7), ("007", 7)])
    def test_integer_signs_and_leading_zeros(self, text: str, expected: int) -> None:
        assert coerce("COUNT", scalar(text), "integer") == expected

    @pytest.mark.parametrize("text", ["7.0", "abc", "", "   ", "1e3"])
    def test_integer_rejects_anything_else(self, text: str) -> None:
        with pytest.raises(CaptureError, match=exact(scalar_message("COUNT", "integer"))):
            coerce("COUNT", scalar(text), "integer")

    def test_float_is_an_exact_decimal(self) -> None:
        value = coerce("RATE", scalar("1.50"), "float")

        assert isinstance(value, Decimal)
        assert value == Decimal("1.50")

    def test_float_is_trimmed(self) -> None:
        assert coerce("RATE", scalar(" 2.5 "), "float") == Decimal("2.5")

    @pytest.mark.parametrize("text", ["abc", "", "Infinity", "-Infinity", "NaN"])
    def test_float_rejects_anything_that_is_not_a_finite_number(self, text: str) -> None:
        with pytest.raises(CaptureError, match=exact(scalar_message("RATE", "float"))):
            coerce("RATE", scalar(text), "float")

    @pytest.mark.parametrize("text", ["true", "TRUE", "True", "1", "yes", "Yes", " true "])
    def test_boolean_true_words(self, text: str) -> None:
        assert coerce("OK", scalar(text), "boolean") is True

    @pytest.mark.parametrize("text", ["false", "FALSE", "False", "0", "no", "NO", " false "])
    def test_boolean_false_words(self, text: str) -> None:
        assert coerce("OK", scalar(text), "boolean") is False

    @pytest.mark.parametrize("text", ["maybe", "", "2", "y"])
    def test_boolean_rejects_anything_else(self, text: str) -> None:
        with pytest.raises(CaptureError, match=exact(scalar_message("OK", "boolean"))):
            coerce("OK", scalar(text), "boolean")


class TestStructuredFromScalarText:
    """A structured value arrives as JSON text and nothing else."""

    def test_array_from_json_text(self) -> None:
        assert coerce("X", scalar('["a", "b"]'), "array") == ["a", "b"]

    def test_an_empty_json_array(self) -> None:
        assert coerce("X", scalar("[]"), "array") == []

    def test_array_numbers_keep_their_exact_decimals(self) -> None:
        value = coerce("X", scalar("[0.5]"), "array")

        assert value == [Decimal("0.5")]
        assert isinstance(value[0], Decimal)

    def test_map_from_json_text(self) -> None:
        assert coerce("X", scalar('{"k": "v"}'), "map") == {"k": "v"}

    def test_an_empty_json_object(self) -> None:
        assert coerce("X", scalar("{}"), "map") == {}

    def test_table_from_json_text(self) -> None:
        value = coerce("X", scalar('[{"n": 1, "s": "a"}, {"n": 2, "s": "b"}]'), "table")

        assert isinstance(value, Table)
        assert value.col_names() == ["n", "s"]
        assert value.col_types() == ["integer", "string"]
        assert value.to_dict()["rows"] == [[1, "a"], [2, "b"]]

    @pytest.mark.parametrize("text", ['{"a": 1}', "not json", "['a']", "[True]", ""])
    def test_array_rejects_anything_that_is_not_a_json_array(self, text: str) -> None:
        with pytest.raises(CaptureError, match=exact(ARRAY_MESSAGE)):
            coerce("X", scalar(text), "array")

    @pytest.mark.parametrize("text", ['["a"]', "not json", "{'k': 'v'}", '{"k": None}', ""])
    def test_map_rejects_anything_that_is_not_a_json_object(self, text: str) -> None:
        with pytest.raises(CaptureError, match=exact(MAP_MESSAGE)):
            coerce("X", scalar(text), "map")

    @pytest.mark.parametrize("text", ['{"n": 1}', '["a"]', "not json", "[{'n': 1}]", ""])
    def test_table_rejects_anything_that_is_not_a_json_array_of_objects(self, text: str) -> None:
        with pytest.raises(CaptureError, match=exact(TABLE_MESSAGE)):
            coerce("X", scalar(text), "table")

    def test_a_later_table_row_must_match_the_first_row_types(self) -> None:
        with pytest.raises(CaptureError, match=exact(TABLE_MESSAGE)):
            coerce("X", scalar('[{"n": 1}, {"n": "text"}]'), "table")

    def test_a_later_table_row_must_match_the_first_row_columns(self) -> None:
        with pytest.raises(CaptureError, match=exact(TABLE_MESSAGE)):
            coerce("X", scalar('[{"n": 1}, {"m": 2}]'), "table")


class TestConversionFromShellArray:
    """A shell array is a list of element texts."""

    def test_array_takes_the_elements_as_text(self) -> None:
        assert coerce("X", items("x", "y z", ""), "array") == ["x", "y z", ""]

    def test_an_empty_shell_array(self) -> None:
        assert coerce("X", items(), "array") == []

    @pytest.mark.parametrize("declared_type", ["string", "integer", "float", "boolean"])
    def test_a_scalar_type_refuses_a_shell_array(self, declared_type: str) -> None:
        with pytest.raises(CaptureError, match=exact(scalar_message("X", declared_type))):
            coerce("X", items("x"), declared_type)

    def test_map_refuses_a_shell_array(self) -> None:
        with pytest.raises(CaptureError, match=exact(MAP_MESSAGE)):
            coerce("X", items("x"), "map")

    def test_table_refuses_a_shell_array(self) -> None:
        with pytest.raises(CaptureError, match=exact(TABLE_MESSAGE)):
            coerce("X", items("x"), "table")


class TestConversionFromAssociativeArray:
    """A shell associative array is a map of texts."""

    def test_map_takes_the_pairs_as_text(self) -> None:
        assert coerce("X", pairs({"k1": "v1", "k2": "v 2"}), "map") == {"k1": "v1", "k2": "v 2"}

    def test_an_empty_associative_array(self) -> None:
        assert coerce("X", pairs({}), "map") == {}

    @pytest.mark.parametrize("declared_type", ["string", "integer", "float", "boolean"])
    def test_a_scalar_type_refuses_an_associative_array(self, declared_type: str) -> None:
        with pytest.raises(CaptureError, match=exact(scalar_message("X", declared_type))):
            coerce("X", pairs({"k": "v"}), declared_type)

    def test_array_refuses_an_associative_array(self) -> None:
        with pytest.raises(CaptureError, match=exact(ARRAY_MESSAGE)):
            coerce("X", pairs({"k": "v"}), "array")

    def test_table_refuses_an_associative_array(self) -> None:
        with pytest.raises(CaptureError, match=exact(TABLE_MESSAGE)):
            coerce("X", pairs({"k": "v"}), "table")


class TestUnknownOrMissingType:
    """With no declared type the value arrives as text."""

    @pytest.mark.parametrize("declared_type", [None, "widget"])
    def test_a_scalar_falls_back_to_raw_text(self, declared_type: str | None) -> None:
        assert coerce("X", scalar("007"), declared_type) == "007"

    @pytest.mark.parametrize("declared_type", [None, "widget"])
    def test_a_shell_array_falls_back_to_a_list_of_text(self, declared_type: str | None) -> None:
        assert coerce("X", items("1", "two"), declared_type) == ["1", "two"]

    @pytest.mark.parametrize("declared_type", [None, "widget"])
    def test_an_associative_array_falls_back_to_a_dict_of_text(
        self, declared_type: str | None
    ) -> None:
        assert coerce("X", pairs({"k": "1"}), declared_type) == {"k": "1"}


class TestNeverSetExport:
    """A name the script never set is not a failure (SHRUN-6)."""

    @pytest.mark.parametrize(
        "declared_type",
        ["string", "integer", "float", "boolean", "array", "map", "table", "widget", None],
    )
    def test_an_unset_capture_is_not_a_failure(self, declared_type: str | None) -> None:
        coerce("X", unset(), declared_type)

    def test_a_missing_name_is_simply_absent_from_the_parsed_map(self) -> None:
        parsed = parse_capture(scalar_record("COUNT", "3"))

        assert "MISSING" not in parsed

    def test_the_old_not_set_failure_text_is_gone(self) -> None:
        assert "was not set by the script" not in inspect.getsource(_shell_capture)


class TestMessagesNeverEchoTheValue:
    """A conversion failure names the type, never the value it read."""

    def test_the_scalar_message(self) -> None:
        with pytest.raises(CaptureError) as caught:
            coerce("COUNT", scalar("s3cr3t"), "integer")

        assert str(caught.value) == scalar_message("COUNT", "integer")

    def test_the_array_message(self) -> None:
        with pytest.raises(CaptureError) as caught:
            coerce("X", scalar("['s3cr3t']"), "array")

        assert str(caught.value) == ARRAY_MESSAGE

    def test_the_map_message(self) -> None:
        with pytest.raises(CaptureError) as caught:
            coerce("X", scalar("{'k': 's3cr3t'}"), "map")

        assert str(caught.value) == MAP_MESSAGE

    def test_the_table_message(self) -> None:
        with pytest.raises(CaptureError) as caught:
            coerce("X", scalar("[{'k': 's3cr3t'}]"), "table")

        assert str(caught.value) == TABLE_MESSAGE

    def test_a_capture_error_is_a_value_error(self) -> None:
        with pytest.raises(ValueError, match=exact(scalar_message("COUNT", "integer"))):
            coerce("COUNT", scalar("abc"), "integer")
