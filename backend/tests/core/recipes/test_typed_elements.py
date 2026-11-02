"""Recipe form of declared element types (REQ-3.1.3.19).

A recipe writes a map or list natively and declares element types beside it; the
stored form is the web UI's - numbers and nested structures as exact text with a
complete sidecar - and a readback writes a complete `element_types` back.
"""

import datetime
from decimal import Decimal

import pytest

from wavecore.core.recipes.typed_elements import (
    element_problems,
    native_element_type,
    readback_element_types,
    stored_element_type,
    stored_elements,
)


class TestNativeTypes:
    @pytest.mark.parametrize(
        ("item", "expected"),
        [
            (True, "boolean"),
            (3, "integer"),
            (1.5, "float"),
            (Decimal("1.5"), "float"),
            ([1], "array"),
            ({"a": 1}, "map"),
            ("16", "string"),
            (None, "string"),
        ],
    )
    def test_the_yaml_type_is_the_element_type(self, item: object, expected: str) -> None:
        assert native_element_type(item) == expected

    @pytest.mark.parametrize(
        ("item", "expected"),
        [
            ("[1, 2]", "array"),
            (' {"a": 1}', "map"),
            ("[x", "string"),
            ("[1] x", "string"),
            ("16", "string"),
        ],
    )
    def test_a_stored_element_reads_by_its_shape(self, item: str, expected: str) -> None:
        assert stored_element_type(item) == expected

    def test_a_json_scalar_in_brackets_is_text(self) -> None:
        assert stored_element_type('["a"]') == "array"
        assert stored_element_type("[") == "string"


class TestAcceptance:
    @pytest.mark.parametrize(
        ("declared", "item"),
        [
            ("integer", 16),
            ("integer", "16"),
            ("integer", "-1234567890123456789"),
            ("integer", 1234567890123456789),
            ("float", 1.5),
            ("float", Decimal("1.50")),
            ("float", "1234567890.123456789012345678"),
            ("float", 2),
            ("float", "1.0"),
            ("float", "-3"),
            ("boolean", False),
            ("string", "02134"),
            ("string", None),
            ("integer", None),
            ("float", None),
            ("boolean", None),
            ("array", None),
            ("map", None),
            ("array", [1]),
            ("array", '[1.5, "a"]'),
            ("map", {"a": 1}),
            ("map", '{"a": 1}'),
        ],
    )
    def test_accepted(self, declared: str, item: object) -> None:
        assert element_problems({"x": item}, {"x": declared}) == []

    @pytest.mark.parametrize(
        ("declared", "item"),
        [
            ("integer", True),
            ("integer", "1.5"),
            ("integer", 1.5),
            ("integer", Decimal("2")),
            ("integer", "+16"),
            ("integer", " 16"),
            ("integer", "16\n"),
            ("integer", "1_000"),
            ("integer", "0x10"),
            ("integer", "\u0663"),
            ("float", "1e5"),
            ("float", ".5"),
            ("float", "5."),
            ("float", "NaN"),
            ("float", Decimal("NaN")),
            ("float", True),
            ("float", float("nan")),
            ("float", float("inf")),
            ("float", float("-inf")),
            ("boolean", "true"),
            ("boolean", 1),
            ("string", 2134),
            ("string", True),
            ("array", "[x"),
            ("array", '{"a": 1}'),
            ("map", "[1]"),
            ("map", [1]),
        ],
    )
    def test_rejected(self, declared: str, item: object) -> None:
        problems = element_problems({"x": item}, {"x": declared})

        assert len(problems) == 1
        assert problems[0].startswith(f"key 'x' expects {declared}, got ")

    @pytest.mark.parametrize(
        ("declared", "item", "problem"),
        [
            ("integer", "12345678901234567890", "allows at most 19 digits, got 20"),
            ("integer", -12345678901234567890, "allows at most 19 digits, got 20"),
            (
                "float",
                "1.2345678901234567890123456789",
                "allows at most 28 significant digits, got 29",
            ),
            (
                "float",
                Decimal("12345678901234567890123456789"),
                "allows at most 28 significant digits, got 29",
            ),
        ],
    )
    def test_a_number_past_its_digit_cap_is_refused_by_the_cap(
        self, declared: str, item: object, problem: str
    ) -> None:
        assert element_problems([item], [declared]) == [f"item 0 {problem}"]


class TestProblems:
    def test_a_clean_map(self) -> None:
        assert element_problems({"n": "16", "s": "x"}, {"n": "integer", "s": "string"}) == []

    def test_a_malformed_sidecar_is_the_only_problem(self) -> None:
        assert element_problems({"n": "16"}, ["integer"]) == [
            "the element types of a map must map each key to a type"
        ]

    def test_a_map_names_a_key_the_value_lacks_and_a_mismatch(self) -> None:
        assert element_problems(
            {"n": "x", "z": None}, {"n": "integer", "m": "string", "z": "float"}
        ) == [
            "element_types names 'm', which the value does not have",
            "key 'n' expects integer, got string",
        ]

    def test_an_array_of_the_wrong_length(self) -> None:
        assert element_problems([1, 2], ["integer"]) == ["element_types lists 1 types for 2 items"]

    def test_an_array_item_mismatch(self) -> None:
        assert element_problems([1, "x"], ["integer", "float"]) == [
            "item 1 expects float, got string"
        ]

    def test_a_clean_array(self) -> None:
        assert element_problems([1, "x"], ["integer", "string"]) == []

    def test_a_null_element_fits_any_declared_type(self) -> None:
        declared = ["string", "integer", "float", "boolean", "array", "map"]
        assert element_problems([None] * len(declared), declared) == []
        assert (
            element_problems({name: None for name in declared}, {name: name for name in declared})
            == []
        )

    def test_a_declared_non_finite_float_is_named(self) -> None:
        assert element_problems({"x": float("nan")}, {"x": "float"}) == [
            "key 'x' expects float, got a non-finite number"
        ]

    def test_an_undeclared_non_finite_float_is_named(self) -> None:
        assert element_problems({"n": 1, "x": float("nan")}, None) == [
            "key 'x' expects float, got a non-finite number"
        ]
        assert element_problems([1.5, float("-inf")], None) == [
            "item 1 expects float, got a non-finite number"
        ]

    def test_a_non_finite_decimal_is_named(self) -> None:
        assert element_problems([Decimal("NaN")], ["float"]) == [
            "item 0 expects float, got a non-finite number"
        ]

    def test_undeclared_elements_of_every_other_kind_pass(self) -> None:
        value = {"n": 1, "f": 1.5, "b": True, "s": "x", "z": None, "l": [1], "m": {"a": 1}}
        assert element_problems(value, None) == []
        assert element_problems(list(value.values()), None) == []


class TestStoredForm:
    def test_a_map_takes_declared_and_native_types(self) -> None:
        value, types = stored_elements(
            {
                "n": 16,
                "f": 1.5,
                "tiny": 1e-07,
                "whole": 2,
                "b": True,
                "s": "07",
                "l": [1.5, "a"],
                "t": "1.0",
                "z": None,
            },
            {"whole": "float", "t": "float"},
        )
        assert value == {
            "n": "16",
            "f": "1.5",
            "tiny": "0.0000001",
            "whole": "2",
            "b": True,
            "s": "07",
            "l": '[1.5, "a"]',
            "t": "1.0",
            "z": None,
        }
        assert types == {
            "n": "integer",
            "f": "float",
            "tiny": "float",
            "whole": "float",
            "b": "boolean",
            "s": "string",
            "l": "array",
            "t": "float",
            "z": "string",
        }

    def test_nested_json_text_stays_verbatim(self) -> None:
        value, types = stored_elements({"m": '{"k": 5}'}, {"m": "map"})
        assert value == {"m": '{"k": 5}'}
        assert types == {"m": "map"}

    def test_an_exact_float_is_stored_as_its_exact_text(self) -> None:
        exact = Decimal("1234567890.123456789012345678")

        assert stored_elements({"f": exact, "g": Decimal("2.50")}, None) == (
            {"f": "1234567890.123456789012345678", "g": "2.50"},
            {"f": "float", "g": "float"},
        )

    def test_a_number_inside_a_nested_structure_is_a_json_number(self) -> None:
        value, types = stored_elements([{"rate": Decimal("2.5"), "n": 3}], ["map"])

        assert value == ['{"rate": 2.5, "n": 3}']
        assert types == ["map"]

    def test_a_number_inside_a_nested_structure_keeps_every_digit(self) -> None:
        # REQ-3.1.3.14: no step may round a number a recipe wrote.
        nested = {"rate": Decimal("2.50"), "big": Decimal("0.1234567890123456789012345678")}

        value, _types = stored_elements({"m": nested, "l": [Decimal("1E-7"), True, None]}, None)

        assert value == {
            "m": '{"rate": 2.50, "big": 0.1234567890123456789012345678}',
            "l": "[0.0000001, true, null]",
        }

    def test_a_date_inside_a_nested_structure_is_its_text(self) -> None:
        value, _types = stored_elements({"m": {"when": datetime.date(2026, 10, 24)}}, None)

        assert value == {"m": '{"when": "2026-10-24"}'}

    def test_a_key_json_cannot_write_is_its_text(self) -> None:
        nested = {Decimal("1.50"): "a", datetime.date(2026, 10, 24): "b", 2: "c", None: "d"}

        value, _types = stored_elements([nested], None)

        assert value == ['{"1.50": "a", "2026-10-24": "b", "2": "c", "null": "d"}']

    def test_a_list_takes_declared_then_native_types(self) -> None:
        value, types = stored_elements([8080, "8443", {"a": "é"}], ["integer", "string"])
        assert value == ["8080", "8443", '{"a": "é"}']
        assert types == ["integer", "string", "map"]

    def test_declarations_of_the_wrong_kind_are_ignored(self) -> None:
        assert stored_elements({"n": 1}, ["integer"]) == ({"n": "1"}, {"n": "integer"})
        assert stored_elements([1], {"0": "string"}) == (["1"], ["integer"])

    def test_a_null_element_is_stored_as_null_and_keeps_its_declared_type(self) -> None:
        assert stored_elements({"z": None, "n": 1}, {"z": "float"}) == (
            {"z": None, "n": "1"},
            {"z": "float", "n": "integer"},
        )
        assert stored_elements([None, 2], ["map", "integer"]) == ([None, "2"], ["map", "integer"])


class TestReadback:
    def test_a_map_readback_is_complete(self) -> None:
        assert readback_element_types(
            {"n": "16", "s": "x", "j": "[1]", "b": True}, {"n": "integer", "s": "bogus"}
        ) == {"n": "integer", "s": "string", "j": "array", "b": "boolean"}

    def test_a_list_readback_is_complete(self) -> None:
        assert readback_element_types(["16", 2, "{}"], ["integer"]) == ["integer", "integer", "map"]

    def test_no_sidecar_reads_the_stored_shape(self) -> None:
        assert readback_element_types({"n": "16"}, None) == {"n": "string"}
        assert readback_element_types(["16"], None) == ["string"]
