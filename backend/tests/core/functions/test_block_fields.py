"""Declared Function inputs and outputs as the Function Block's fields (VMGR-112, VMGR-113).

REQ-3.1.2.1, REQ-3.1.2.9, REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.1.3.18, REQ-3.1.3.19, REQ-3.1.3.21.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any

import pytest

from wavecore.core.functions.block_fields import function_block_fields, function_block_outputs


def _definition(
    *inputs: dict[str, Any], outputs: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    return {
        "inputs": list(inputs),
        "outputs": outputs or [],
        "variables": [],
        "workflow": {"nodes": [], "edges": []},
    }


def _only_field(declared: dict[str, Any]) -> dict[str, Any]:
    fields = function_block_fields(_definition(declared))
    assert len(fields) == 1
    return fields[0]


def _by_name(fields: list[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    return {str(field["name"]): field for field in fields}


class TestRequiredInputs:
    def test_required_input_carries_no_default_even_when_declared(self) -> None:
        field = _only_field({"name": "who", "type": "string", "required": True, "default": "world"})

        assert field["required"] is True
        assert "default" not in field

    def test_required_true_false_input_carries_no_default(self) -> None:
        field = _only_field({"name": "flag", "type": "boolean", "required": True, "default": True})

        assert field["required"] is True
        assert "default" not in field

    def test_required_list_input_carries_no_default_and_no_item_types(self) -> None:
        field = _only_field(
            {
                "name": "ids",
                "type": "array",
                "required": True,
                "default": [1, 2],
                "elementTypes": ["integer", "integer"],
            }
        )

        assert "default" not in field
        assert field.get("default_element_types") is None


class TestOptionalInputDefaults:
    @pytest.mark.parametrize(
        ("value_type", "default"),
        [
            ("string", "hi"),
            ("string", ""),
            ("integer", 3),
            ("integer", 12345678901234567890),
            ("float", 2.5),
        ],
    )
    def test_optional_input_carries_its_default(self, value_type: str, default: Any) -> None:
        field = _only_field(
            {"name": "value", "type": value_type, "required": False, "default": default}
        )

        assert field["required"] is False
        assert field["default"] == default

    def test_optional_false_default_is_kept(self) -> None:
        field = _only_field(
            {"name": "flag", "type": "boolean", "required": False, "default": False}
        )

        assert field["default"] is False

    def test_optional_text_default_is_kept_as_written(self) -> None:
        field = _only_field(
            {"name": "pad", "type": "string", "required": False, "default": "  padded  "}
        )

        assert field["default"] == "  padded  "
        assert field.get("trim", False) is False

    def test_optional_list_default_carries_its_item_types(self) -> None:
        field = _only_field(
            {
                "name": "tags",
                "type": "array",
                "required": False,
                "default": [1, "a"],
                "elementTypes": ["integer", "string"],
            }
        )

        assert field["default"] == [1, "a"]
        assert field["default_element_types"] == ["integer", "string"]

    def test_optional_map_default_carries_its_item_types(self) -> None:
        field = _only_field(
            {
                "name": "labels",
                "type": "map",
                "required": False,
                "default": {"k": 1, "n": "x"},
                "elementTypes": {"k": "integer", "n": "string"},
            }
        )

        assert field["default"] == {"k": 1, "n": "x"}
        assert field["default_element_types"] == {"k": "integer", "n": "string"}


class TestEnumInputs:
    @pytest.mark.parametrize(
        ("value_type", "allowed", "typed"),
        [
            ("integer", [1, 2, 3], [1, 2, 3]),
            ("integer", ["1", "2"], [1, 2]),
            ("float", [2.5, 3.5], [2.5, 3.5]),
            ("float", ["2.5", "3.5"], [2.5, 3.5]),
            ("string", ["low", "high"], ["low", "high"]),
        ],
    )
    def test_enum_input_keeps_its_type_and_carries_typed_allowed_values(
        self, value_type: str, allowed: list[Any], typed: list[Any]
    ) -> None:
        field = _only_field(
            {
                "name": "level",
                "type": value_type,
                "required": True,
                "enumValues": allowed,
                "default": allowed[0],
            }
        )

        assert field["type"] == value_type
        assert field["enum_values"] == typed
        if value_type != "string":
            assert not any(isinstance(value, str) for value in field["enum_values"])

    def test_enum_input_is_required_and_carries_no_default(self) -> None:
        field = _only_field(
            {
                "name": "level",
                "type": "string",
                "required": True,
                "enumValues": ["low", "high"],
                "default": "low",
            }
        )

        assert field["required"] is True
        assert "default" not in field
        assert field["accepts_null"] is False

    def test_plain_input_carries_no_allowed_values(self) -> None:
        field = _only_field({"name": "who", "type": "string", "required": False, "default": "x"})

        assert field.get("enum_values") is None


class TestSecretInputs:
    def test_secret_input_is_secret_and_carries_no_default(self) -> None:
        field = _only_field(
            {
                "name": "token",
                "type": "string",
                "required": False,
                "secret": True,
                "default": "s3cr3t",
            }
        )

        assert field["secret"] is True
        assert "default" not in field

    def test_required_secret_input_is_secret_and_carries_no_default(self) -> None:
        field = _only_field({"name": "token", "type": "string", "required": True, "secret": True})

        assert field["secret"] is True
        assert "default" not in field

    def test_optional_secret_input_with_no_default_refuses_null(self) -> None:
        field = _only_field({"name": "token", "type": "string", "required": False, "secret": True})

        assert field["accepts_null"] is False

    def test_plain_input_is_not_secret(self) -> None:
        field = _only_field({"name": "who", "type": "string", "required": False})

        assert field["secret"] is False


class TestTypedValues:
    @pytest.mark.parametrize("value_type", ["array", "map"])
    def test_list_and_map_inputs_carry_typed_values(self, value_type: str) -> None:
        field = _only_field({"name": "items", "type": value_type, "required": False})

        assert field["typed_values"] is True

    @pytest.mark.parametrize("value_type", ["string", "integer", "float", "boolean", "table"])
    def test_other_inputs_carry_no_typed_values(self, value_type: str) -> None:
        field = _only_field({"name": "value", "type": value_type, "required": False})

        assert field.get("typed_values", False) is False


class TestNullPolicy:
    def test_optional_input_with_no_default_accepts_null(self) -> None:
        field = _only_field({"name": "note", "type": "string", "required": False})

        assert field["accepts_null"] is True
        assert field.get("default") is None

    @pytest.mark.parametrize(
        "declared",
        [
            {"name": "note", "type": "string", "required": False, "default": "x"},
            {"name": "note", "type": "string", "required": False, "default": ""},
            {"name": "flag", "type": "boolean", "required": False, "default": False},
            {"name": "note", "type": "string", "required": True},
            {"name": "note", "type": "string", "required": True, "default": "x"},
        ],
        ids=["optional-default", "optional-empty-default", "optional-false", "required", "both"],
    )
    def test_input_with_a_default_or_required_refuses_null(self, declared: dict[str, Any]) -> None:
        assert _only_field(declared)["accepts_null"] is False


class TestFieldShape:
    def test_name_type_and_description_pass_through(self) -> None:
        field = _only_field(
            {
                "name": "retries",
                "type": "integer",
                "required": False,
                "default": 3,
                "description": "How many times to try",
            }
        )

        assert field["name"] == "retries"
        assert field["type"] == "integer"
        assert field["description"] == "How many times to try"

    def test_fields_follow_the_declared_order(self) -> None:
        definition = _definition(
            {"name": "zeta", "type": "string", "required": True},
            {"name": "alpha", "type": "integer", "required": False, "default": 1},
            {"name": "mid", "type": "boolean", "required": False, "default": True},
        )

        names = [field["name"] for field in function_block_fields(definition)]

        assert names == ["zeta", "alpha", "mid"]

    def test_definition_with_no_declarations_has_no_fields_or_outputs(self) -> None:
        assert function_block_fields({}) == []
        assert function_block_outputs({}) == []

    def test_the_definition_is_not_changed(self) -> None:
        definition = _definition(
            {"name": "who", "type": "string", "required": True, "default": "world"},
            {
                "name": "tags",
                "type": "array",
                "required": False,
                "default": [1, "a"],
                "elementTypes": ["integer", "string"],
            },
            {
                "name": "level",
                "type": "integer",
                "required": True,
                "enumValues": ["1", "2"],
                "default": "1",
            },
            {"name": "token", "type": "string", "required": False, "secret": True},
            outputs=[
                {"name": "out", "type": "string", "isExpression": True, "default": "who + '!'"}
            ],
        )
        before = copy.deepcopy(definition)

        function_block_fields(definition)
        function_block_outputs(definition)

        assert definition == before


class TestOutputs:
    def test_outputs_carry_name_type_description_and_secret_in_order(self) -> None:
        definition = _definition(
            outputs=[
                {"name": "token", "type": "string", "description": "The token", "secret": True},
                {"name": "count", "type": "integer", "description": "Rows read", "secret": False},
            ]
        )

        assert function_block_outputs(definition) == [
            {"name": "token", "type": "string", "description": "The token", "secret": True},
            {"name": "count", "type": "integer", "description": "Rows read", "secret": False},
        ]

    def test_a_computed_output_carries_only_what_the_block_shows(self) -> None:
        definition = _definition(
            outputs=[
                {
                    "name": "greeting",
                    "type": "string",
                    "description": "Hello text",
                    "secret": False,
                    "isExpression": True,
                    "default": "'hi ' + who",
                }
            ]
        )

        assert function_block_outputs(definition) == [
            {"name": "greeting", "type": "string", "description": "Hello text", "secret": False}
        ]

    def test_inputs_and_outputs_stay_apart(self) -> None:
        definition = _definition(
            {"name": "who", "type": "string", "required": True},
            outputs=[{"name": "greeting", "type": "string", "description": "", "secret": False}],
        )

        assert list(_by_name(function_block_fields(definition))) == ["who"]
        assert [out["name"] for out in function_block_outputs(definition)] == ["greeting"]
