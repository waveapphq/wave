"""Declaration rules for Test variables and Function inputs, outputs and locals.

REQ-3.1.2.4, REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.1.3.1, REQ-3.1.3.14, REQ-3.1.3.19.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.functions.declarations import (
    DeclarationKind,
    declaration_numbers,
    declaration_problems,
    input_problems,
    is_enum_input,
    name_collisions,
    value_problems,
)
from wavecore.core.variables.value_checks import stored_number, text_as_number

_ENUM_INPUT_TYPE = (
    "ENUM_INPUT_TYPE",
    "Enum input 'level' must be of type string, integer or float",
)
_ENUM_INPUT_NOT_REQUIRED = ("ENUM_INPUT_NOT_REQUIRED", "Enum input 'level' must be required")
_ENUM_INPUT_EMPTY = ("ENUM_INPUT_EMPTY", "Enum input 'level' has no allowed values")
_ENUM_INPUT_NO_DEFAULT = (
    "ENUM_INPUT_NO_DEFAULT",
    "Enum input 'level' needs a default from its allowed values",
)
_SECRET_ENUM_INPUT = ("SECRET_ENUM_INPUT", "Input 'level' cannot be both secret and an enum")
_BOOLEAN_INPUT_NO_DEFAULT = (
    "BOOLEAN_INPUT_NO_DEFAULT",
    "Boolean input 'flag' needs a default",
)


def _stored_declaration(entry: Mapping[str, Any], *, kind: DeclarationKind) -> dict[str, Any]:
    return declaration_numbers(entry, kind=kind, form=stored_number)


def _enum(**fields: Any) -> dict[str, Any]:
    """A well-formed String enum input ``level`` with ``fields`` laid over it."""
    return {
        "name": "level",
        "type": "string",
        "required": True,
        "enumValues": ["low", "high"],
        "default": "low",
        **fields,
    }


def _without(item: Mapping[str, Any], *keys: str) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key not in keys}


# Sorted: the rules fix what is reported, not the order.
def _problems(item: Mapping[str, Any]) -> list[tuple[str, str]]:
    return sorted(input_problems(item))


def _collisions(
    inputs: Iterable[str], outputs: Iterable[str], local_names: Iterable[str]
) -> list[tuple[str, str]]:
    return sorted(
        name_collisions(
            [{"name": name, "type": "string"} for name in inputs],
            [{"name": name, "type": "string"} for name in outputs],
            local_names,
        )
    )


class TestIsEnumInput:
    """A present ``enumValues`` list marks an enum input, and nothing else does (REQ-3.1.2.11)."""

    def test_an_input_with_allowed_values_is_an_enum(self) -> None:
        assert is_enum_input(_enum()) is True

    @pytest.mark.parametrize("allowed", [[], None, "low"], ids=["empty", "null", "not-a-list"])
    def test_a_present_enum_values_key_marks_an_enum_whatever_it_holds(self, allowed: Any) -> None:
        assert is_enum_input(_enum(enumValues=allowed)) is True

    def test_a_plain_input_is_not_an_enum(self) -> None:
        assert is_enum_input({"name": "host", "type": "string", "required": True}) is False

    def test_an_enum_value_type_key_alone_does_not_mark_an_enum(self) -> None:
        old_marker = {"name": "level", "type": "array", "required": True, "enumValueType": "string"}

        assert is_enum_input(old_marker) is False


class TestWellFormedInputs:
    """A declaration that keeps every rule has no problem."""

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default"),
        [
            pytest.param("string", ["low", "high"], "high", id="string"),
            pytest.param("integer", [1, 2], 2, id="integer"),
            pytest.param("float", [1.5, 2.5], 2.5, id="float"),
        ],
    )
    def test_an_enum_of_each_value_type_is_clean(
        self, value_type: str, allowed: list[Any], default: Any
    ) -> None:
        item = _enum(type=value_type, enumValues=allowed, default=default)

        assert _problems(item) == []

    def test_an_integer_allowed_value_fits_a_float_enum(self) -> None:
        assert _problems(_enum(type="float", enumValues=[1, 2.5], default=1)) == []

    def test_the_default_is_compared_as_the_input_type(self) -> None:
        # 1.0 and 1 are the same float once both are realized as the input type.
        assert _problems(_enum(type="float", enumValues=[1, 2.5], default=1.0)) == []

    def test_an_enum_input_carries_an_optional_description(self) -> None:
        assert _problems(_enum(description="How loud the log is")) == []

    @pytest.mark.parametrize(
        "item",
        [
            pytest.param({"name": "host", "type": "string", "required": True}, id="required"),
            pytest.param(
                {"name": "count", "type": "integer", "required": True, "default": 3},
                id="required-with-default",
            ),
            pytest.param(
                {"name": "greeting", "type": "string", "required": False, "default": None},
                id="optional-null-default",
            ),
            pytest.param({"name": "greeting", "type": "string"}, id="optional-no-default"),
            pytest.param(
                {"name": "tags", "type": "array", "required": False, "default": ["a"]},
                id="optional-array-default",
            ),
        ],
    )
    def test_a_plain_input_has_no_problem(self, item: dict[str, Any]) -> None:
        assert _problems(item) == []

    def test_a_secret_plain_input_with_a_default_has_no_problem(self) -> None:
        # The save drops a secret input's default; the recipe validator reports it on its own.
        item = {"name": "tok", "type": "string", "secret": True, "default": "s3cr3t"}

        assert _problems(item) == []


class TestEnumInputType:
    """An enum input is of type string, integer or float (REQ-3.1.2.11)."""

    def test_the_old_array_enum_shape_is_refused(self) -> None:
        old_enum = {
            "name": "level",
            "type": "array",
            "required": True,
            "enumValueType": "string",
            "enumValues": ["low", "high"],
        }

        assert _problems(old_enum) == sorted([_ENUM_INPUT_TYPE, _ENUM_INPUT_NO_DEFAULT])

    @pytest.mark.parametrize("value_type", ["boolean", "array", "map", "table", "text"])
    def test_any_other_type_is_refused(self, value_type: str) -> None:
        assert _problems(_enum(type=value_type)) == [_ENUM_INPUT_TYPE]

    def test_an_enum_with_no_type_is_refused(self) -> None:
        assert _problems(_without(_enum(), "type")) == [_ENUM_INPUT_TYPE]

    @pytest.mark.parametrize("value_type", ["boolean", "array"])
    def test_a_wrong_type_skips_the_allowed_value_and_default_checks(self, value_type: str) -> None:
        item = _enum(type=value_type, enumValues=["low", 5, 1.5], default="mid")

        assert _problems(item) == [_ENUM_INPUT_TYPE]


class TestEnumInputRequired:
    """An enum input is always Required (REQ-3.1.2.11)."""

    def test_a_not_required_enum_is_refused(self) -> None:
        assert _problems(_enum(required=False)) == [_ENUM_INPUT_NOT_REQUIRED]

    def test_an_enum_without_a_required_key_is_refused(self) -> None:
        assert _problems(_without(_enum(), "required")) == [_ENUM_INPUT_NOT_REQUIRED]


class TestEnumAllowedValues:
    """The allowed values are a non-empty list, each of the input's type (REQ-3.1.2.11)."""

    @pytest.mark.parametrize(
        "allowed",
        [
            pytest.param([], id="empty"),
            pytest.param(None, id="null"),
            pytest.param("low,high", id="text"),
            pytest.param({"low": 1}, id="map"),
        ],
    )
    def test_no_allowed_values_is_refused(self, allowed: Any) -> None:
        item = _without(_enum(enumValues=allowed), "default")

        assert _problems(item) == sorted([_ENUM_INPUT_EMPTY, _ENUM_INPUT_NO_DEFAULT])

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default", "message"),
        [
            pytest.param(
                "integer",
                ["abc", 2],
                2,
                "Allowed value 'abc' of enum input 'level' is not a valid integer",
                id="text-in-integer",
            ),
            pytest.param(
                "integer",
                [1, 1.5],
                1,
                "Allowed value '1.5' of enum input 'level' is not a valid integer",
                id="fraction-in-integer",
            ),
            pytest.param(
                "integer",
                [1, True],
                1,
                "Allowed value 'True' of enum input 'level' is not a valid integer",
                id="boolean-in-integer",
            ),
            pytest.param(
                "float",
                ["abc", 2.5],
                2.5,
                "Allowed value 'abc' of enum input 'level' is not a valid float",
                id="text-in-float",
            ),
            pytest.param(
                "float",
                [False, 2.5],
                2.5,
                "Allowed value 'False' of enum input 'level' is not a valid float",
                id="boolean-in-float",
            ),
            pytest.param(
                "float",
                [[1], 2.5],
                2.5,
                "Allowed value '[1]' of enum input 'level' is not a valid float",
                id="list-in-float",
            ),
            pytest.param(
                "string",
                ["low", 5],
                "low",
                "Allowed value '5' of enum input 'level' is not a valid string",
                id="number-in-string",
            ),
        ],
    )
    def test_an_allowed_value_that_does_not_fit_the_type_is_refused(
        self, value_type: str, allowed: list[Any], default: Any, message: str
    ) -> None:
        item = _enum(type=value_type, enumValues=allowed, default=default)

        assert _problems(item) == [("ENUM_VALUE_TYPE", message)]

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default"),
        [
            pytest.param("integer", ["3", 4], 4, id="integer-text"),
            pytest.param("float", [3, "3.5"], 3, id="float-integer-and-text"),
        ],
    )
    def test_text_that_reads_as_the_type_fits(
        self, value_type: str, allowed: list[Any], default: Any
    ) -> None:
        # The rule a run uses to realize the input (REQ-3.1.3.14).
        item = _enum(type=value_type, enumValues=allowed, default=default)

        assert _problems(item) == []

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default"),
        [
            pytest.param("string", [None, "low"], "low", id="string"),
            pytest.param("integer", [1, None], 1, id="integer"),
            pytest.param("float", [None, 2.5], 2.5, id="float"),
        ],
    )
    def test_a_null_allowed_value_never_fits(
        self, value_type: str, allowed: list[Any], default: Any
    ) -> None:
        item = _enum(type=value_type, enumValues=allowed, default=default)

        assert _problems(item) == [
            (
                "ENUM_VALUE_TYPE",
                f"Allowed value 'null' of enum input 'level' is not a valid {value_type}",
            )
        ]

    def test_an_empty_text_allowed_value_is_refused(self) -> None:
        item = _enum(enumValues=["", "low"], default="low")

        assert _problems(item) == [
            ("ENUM_VALUE_EMPTY", "Enum input 'level' has an empty allowed value")
        ]

    def test_an_empty_text_in_a_number_enum_is_a_type_problem(self) -> None:
        item = _enum(type="integer", enumValues=["", 1], default=1)

        assert _problems(item) == [
            ("ENUM_VALUE_TYPE", "Allowed value '' of enum input 'level' is not a valid integer")
        ]

    def test_a_repeated_allowed_value_is_reported_once(self) -> None:
        item = _enum(enumValues=["low", "high", "low", "low"])

        assert _problems(item) == [
            (
                "ENUM_VALUE_REPEATED",
                "Allowed value 'low' of enum input 'level' is listed more than once",
            )
        ]

    def test_values_equal_as_the_input_type_repeat(self) -> None:
        item = _enum(type="float", enumValues=[1, "1.0", 2], default=2)

        assert _problems(item) == [
            (
                "ENUM_VALUE_REPEATED",
                "Allowed value '1.0' of enum input 'level' is listed more than once",
            )
        ]

    @pytest.mark.parametrize("text", ["NaN", "sNaN", "Infinity", "-Infinity"])
    def test_a_value_that_is_not_finite_is_not_a_valid_float(self, text: str) -> None:
        item = _enum(type="float", enumValues=["1.5", text, text], default=text)

        assert _problems(item) == [
            (
                "ENUM_DEFAULT_NOT_ALLOWED",
                f"Default '{text}' of enum input 'level' is not one of its allowed values",
            ),
            (
                "ENUM_VALUE_TYPE",
                f"Allowed value '{text}' of enum input 'level' is not a valid float",
            ),
            (
                "ENUM_VALUE_TYPE",
                f"Allowed value '{text}' of enum input 'level' is not a valid float",
            ),
        ]

    @pytest.mark.parametrize(
        ("value_type", "allowed", "message"),
        [
            pytest.param(
                "integer",
                ["12345678901234567890", 1],
                "Allowed value '12345678901234567890' of enum input 'level' allows at most "
                "19 digits, got 20",
                id="integer",
            ),
            pytest.param(
                "float",
                ["1.2345678901234567890123456789", 1],
                "Allowed value '1.2345678901234567890123456789' of enum input 'level' allows "
                "at most 28 significant digits, got 29",
                id="float",
            ),
        ],
    )
    def test_an_allowed_value_past_the_digit_cap_is_refused(
        self, value_type: str, allowed: list[Any], message: str
    ) -> None:
        item = _enum(type=value_type, enumValues=allowed, default=1)

        assert _problems(item) == [("ENUM_VALUE_TYPE", message)]

    @pytest.mark.parametrize(
        ("value_type", "text"),
        [
            ("integer", " 7"),
            ("integer", "+7"),
            ("integer", "1_0"),
            ("float", "1e2"),
            ("float", ".5"),
        ],
        ids=["space", "plus", "underscore", "exponent", "no-whole-part"],
    )
    def test_text_that_breaks_the_number_rule_does_not_fit(
        self, value_type: str, text: str
    ) -> None:
        item = _enum(type=value_type, enumValues=[text, 1], default=1)

        assert _problems(item) == [
            (
                "ENUM_VALUE_TYPE",
                f"Allowed value '{text}' of enum input 'level' is not a valid {value_type}",
            )
        ]

    def test_each_allowed_value_that_does_not_fit_is_reported(self) -> None:
        item = _enum(type="integer", enumValues=["a", 3, "b"], default=3)

        assert _problems(item) == sorted(
            [
                (
                    "ENUM_VALUE_TYPE",
                    "Allowed value 'a' of enum input 'level' is not a valid integer",
                ),
                (
                    "ENUM_VALUE_TYPE",
                    "Allowed value 'b' of enum input 'level' is not a valid integer",
                ),
            ]
        )


class TestEnumDefault:
    """An enum input's default is required and is one of its allowed values (REQ-3.1.2.11)."""

    def test_an_enum_with_no_default_is_refused(self) -> None:
        assert _problems(_without(_enum(), "default")) == [_ENUM_INPUT_NO_DEFAULT]

    def test_an_enum_with_a_null_default_is_refused(self) -> None:
        assert _problems(_enum(default=None)) == [_ENUM_INPUT_NO_DEFAULT]

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default", "message"),
        [
            pytest.param(
                "string",
                ["low", "high"],
                "x",
                "Default 'x' of enum input 'level' is not one of its allowed values",
                id="string",
            ),
            pytest.param(
                "integer",
                [1, 2],
                3,
                "Default '3' of enum input 'level' is not one of its allowed values",
                id="integer",
            ),
            pytest.param(
                "float",
                [1.5, 2.5],
                3.5,
                "Default '3.5' of enum input 'level' is not one of its allowed values",
                id="float",
            ),
            pytest.param(
                "integer",
                ["1", "2"],
                "3",
                "Default '3' of enum input 'level' is not one of its allowed values",
                id="integer-text",
            ),
            pytest.param(
                "integer",
                [1, 2],
                "abc",
                "Default 'abc' of enum input 'level' is not one of its allowed values",
                id="integer-unreadable-text",
            ),
            pytest.param(
                "integer",
                [1, 2],
                True,
                "Default 'True' of enum input 'level' is not one of its allowed values",
                id="integer-boolean",
            ),
        ],
    )
    def test_a_default_outside_the_allowed_values_is_refused(
        self, value_type: str, allowed: list[Any], default: Any, message: str
    ) -> None:
        item = _enum(type=value_type, enumValues=allowed, default=default)

        assert _problems(item) == [("ENUM_DEFAULT_NOT_ALLOWED", message)]

    @pytest.mark.parametrize(
        ("value_type", "allowed", "default"),
        [
            pytest.param("integer", [1, 3], "3", id="integer-text-default"),
            pytest.param("integer", ["1", "3"], 3, id="integer-text-allowed"),
            pytest.param("float", [1.5, "2.5"], "2.5", id="float-text"),
        ],
    )
    def test_the_default_is_compared_after_realizing_both_as_the_type(
        self, value_type: str, allowed: list[Any], default: Any
    ) -> None:
        item = _enum(type=value_type, enumValues=allowed, default=default)

        assert _problems(item) == []


class TestSecretEnumInput:
    """An enum input is never secret (REQ-3.1.2.11, VMGR-104)."""

    def test_a_secret_enum_is_refused(self) -> None:
        assert _problems(_enum(secret=True)) == [_SECRET_ENUM_INPUT]

    def test_a_not_secret_enum_is_clean(self) -> None:
        assert _problems(_enum(secret=False)) == []


class TestEveryFailingRuleIsReported:
    """Every failing rule of one input is reported in one pass (REQ-3.1.2.4)."""

    def test_four_broken_rules_are_reported_together(self) -> None:
        item = {
            "name": "level",
            "type": "integer",
            "required": False,
            "secret": True,
            "enumValues": ["abc", 2],
            "default": 5,
        }

        assert _problems(item) == sorted(
            [
                _ENUM_INPUT_NOT_REQUIRED,
                (
                    "ENUM_VALUE_TYPE",
                    "Allowed value 'abc' of enum input 'level' is not a valid integer",
                ),
                (
                    "ENUM_DEFAULT_NOT_ALLOWED",
                    "Default '5' of enum input 'level' is not one of its allowed values",
                ),
                _SECRET_ENUM_INPUT,
            ]
        )

    def test_a_wrong_type_still_reports_the_other_rules(self) -> None:
        item = {
            "name": "level",
            "type": "array",
            "required": False,
            "secret": True,
            "enumValues": [],
        }

        assert _problems(item) == sorted(
            [
                _ENUM_INPUT_TYPE,
                _ENUM_INPUT_NOT_REQUIRED,
                _ENUM_INPUT_EMPTY,
                _ENUM_INPUT_NO_DEFAULT,
                _SECRET_ENUM_INPUT,
            ]
        )


class TestBooleanInputDefault:
    """Every non-secret true/false input has a default (REQ-3.1.2.10, VMGR-113)."""

    def test_a_required_boolean_with_no_default_is_refused(self) -> None:
        item = {"name": "flag", "type": "boolean", "required": True}

        assert _problems(item) == [_BOOLEAN_INPUT_NO_DEFAULT]

    def test_a_required_boolean_with_a_null_default_is_refused(self) -> None:
        item = {"name": "flag", "type": "boolean", "required": True, "default": None}

        assert _problems(item) == [_BOOLEAN_INPUT_NO_DEFAULT]

    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    @pytest.mark.parametrize("default", [True, False])
    def test_a_boolean_with_a_default_is_clean(self, required: bool, default: bool) -> None:
        item = {"name": "flag", "type": "boolean", "required": required, "default": default}

        assert _problems(item) == []

    @pytest.mark.parametrize("required", [False, None], ids=["not-required", "no-required-key"])
    def test_an_optional_boolean_with_no_default_is_refused(self, required: bool | None) -> None:
        item: dict[str, Any] = {"name": "flag", "type": "boolean"}
        if required is not None:
            item["required"] = required

        assert _problems(item) == [_BOOLEAN_INPUT_NO_DEFAULT]

    def test_an_optional_boolean_with_a_null_default_is_refused(self) -> None:
        item = {"name": "flag", "type": "boolean", "required": False, "default": None}

        assert _problems(item) == [_BOOLEAN_INPUT_NO_DEFAULT]

    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    def test_the_message_names_the_input(self, required: bool) -> None:
        item = {"name": "verbose", "type": "boolean", "required": required}

        assert _problems(item) == [
            ("BOOLEAN_INPUT_NO_DEFAULT", "Boolean input 'verbose' needs a default")
        ]

    @pytest.mark.parametrize("value_type", ["string", "integer", "float", "array", "map", "table"])
    def test_another_required_type_may_have_no_default(self, value_type: str) -> None:
        assert _problems({"name": "flag", "type": value_type, "required": True}) == []

    @pytest.mark.parametrize(
        "default",
        [
            pytest.param({}, id="no-default"),
            pytest.param({"default": None}, id="null-default"),
            pytest.param({"default": True}, id="with-default"),
        ],
    )
    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    def test_a_secret_boolean_is_left_to_the_secret_rule(
        self, required: bool, default: dict[str, Any]
    ) -> None:
        # A secret input has no default; the save drops one and the recipe reports it.
        item = {"name": "flag", "type": "boolean", "required": required, "secret": True, **default}

        assert _problems(item) == []


class TestNameCollisions:
    """Inputs, outputs and locals share one name per Function (REQ-3.1.2.4, REQ-3.1.3.1)."""

    def test_distinct_names_do_not_collide(self) -> None:
        assert _collisions(["a"], ["b"], ["c"]) == []

    def test_nothing_declared_does_not_collide(self) -> None:
        assert _collisions([], [], []) == []

    def test_an_input_and_an_output_collide(self) -> None:
        assert _collisions(["id"], ["id"], []) == [
            ("DUPLICATE_PARAMETER_NAME", "Function declares 'id' as both an input and an output")
        ]

    def test_an_input_and_a_local_collide(self) -> None:
        assert _collisions(["id"], [], ["id"]) == [
            (
                "DUPLICATE_PARAMETER_NAME",
                "Function declares 'id' as both an input and a local variable",
            )
        ]

    def test_an_output_and_a_local_collide(self) -> None:
        assert _collisions([], ["id"], ["id"]) == [
            (
                "DUPLICATE_PARAMETER_NAME",
                "Function declares 'id' as both an output and a local variable",
            )
        ]

    def test_a_name_in_all_three_lists_is_one_issue_per_pair(self) -> None:
        assert _collisions(["id"], ["id"], ["id"]) == sorted(
            [
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'id' as both an input and an output",
                ),
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'id' as both an input and a local variable",
                ),
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'id' as both an output and a local variable",
                ),
            ]
        )

    def test_each_colliding_name_is_reported(self) -> None:
        assert _collisions(["a", "b"], ["a", "c"], ["b"]) == sorted(
            [
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'a' as both an input and an output",
                ),
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'b' as both an input and a local variable",
                ),
            ]
        )

    def test_a_local_declared_twice_is_refused(self) -> None:
        assert _collisions([], [], ["n", "n"]) == [
            ("DUPLICATE_VARIABLE_NAME", "Function declares local variable 'n' more than once")
        ]

    def test_two_inputs_or_two_outputs_of_one_name_are_left_to_their_own_checks(self) -> None:
        # DUPLICATE_INPUT_NAME / DUPLICATE_OUTPUT_NAME already report these.
        assert _collisions(["x", "x"], ["r", "r"], []) == []

    def test_names_differing_only_in_case_do_not_collide(self) -> None:
        assert _collisions(["ID"], ["id"], ["Id"]) == []

    def test_local_names_given_as_a_one_pass_iterable_are_all_checked(self) -> None:
        local_names = (name for name in ["id", "n", "n"])

        assert _collisions(["id"], [], local_names) == sorted(
            [
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'id' as both an input and a local variable",
                ),
                ("DUPLICATE_VARIABLE_NAME", "Function declares local variable 'n' more than once"),
            ]
        )


_TYPES = "array, boolean, float, integer, map, string, table"
_ELEMENT_TYPES = "array, boolean, float, integer, map, string"


class TestDeclarationNames:
    """One name rule for every declaration: the identifier pattern, the length, keywords
    and the namespace names; an input or output also starts with a letter."""

    @pytest.mark.parametrize("kind", ["variable", "input", "output", "local"])
    def test_a_well_formed_declaration_has_no_problem(self, kind: str) -> None:
        assert declaration_problems("count_2", "integer", None, kind=kind) == []

    @pytest.mark.parametrize(
        ("kind", "noun"),
        [("variable", "variable"), ("local", "local variable")],
    )
    def test_a_variable_name_must_be_an_ascii_identifier(self, kind: str, noun: str) -> None:
        assert declaration_problems("n\u00e4me", "string", None, kind=kind) == [
            (
                "INVALID_VARIABLE",
                f"Invalid {noun} name: 'n\u00e4me' (must match [a-zA-Z_][a-zA-Z0-9_]*)",
            )
        ]

    @pytest.mark.parametrize("kind", ["input", "output"])
    def test_an_input_or_output_name_starts_with_a_letter(self, kind: str) -> None:
        assert declaration_problems("_hidden", "string", None, kind=kind) == [
            (
                "INVALID_VARIABLE",
                f"Invalid {kind} name: '_hidden' (must match [a-zA-Z][a-zA-Z0-9_]*)",
            )
        ]

    def test_a_local_name_may_start_with_an_underscore(self) -> None:
        assert declaration_problems("_hidden", "string", None, kind="local") == []

    def test_a_name_longer_than_64_characters_is_refused(self) -> None:
        name = "a" * 65
        assert declaration_problems(name, "string", None, kind="variable") == [
            (
                "INVALID_VARIABLE",
                f"Invalid variable name: '{name}' (must be 64 characters or fewer)",
            )
        ]

    def test_a_name_of_64_characters_is_accepted(self) -> None:
        assert declaration_problems("a" * 64, "string", None, kind="output") == []

    @pytest.mark.parametrize("name", ["class", "None", "lambda"])
    def test_a_python_keyword_is_refused(self, name: str) -> None:
        assert declaration_problems(name, "string", None, kind="local") == [
            ("INVALID_VARIABLE", f"Invalid local variable name: '{name}' (a Python keyword)")
        ]

    @pytest.mark.parametrize("name", ["system", "suite", "regression"])
    @pytest.mark.parametrize(
        ("kind", "noun"),
        [
            ("variable", "variable"),
            ("input", "input"),
            ("output", "output"),
            ("local", "local variable"),
        ],
    )
    def test_a_namespace_name_is_reserved(self, name: str, kind: str, noun: str) -> None:
        assert declaration_problems(name, "string", None, kind=kind) == [
            (
                "RESERVED_VARIABLE_NAME",
                f"Invalid {noun} name: '{name}' (reserved for namespace access; "
                f"use {name}.field_name)",
            )
        ]


class TestDeclarationTypes:
    """One type list and one element-type rule for every declaration."""

    @pytest.mark.parametrize(
        ("kind", "noun"),
        [
            ("variable", "variable"),
            ("input", "input"),
            ("output", "output"),
            ("local", "local variable"),
        ],
    )
    def test_an_unknown_type_is_refused(self, kind: str, noun: str) -> None:
        assert declaration_problems("x", "bogus", None, kind=kind) == [
            ("INVALID_VARIABLE_TYPE", f"Invalid {noun} type: 'bogus' (must be one of: {_TYPES})")
        ]

    def test_a_missing_type_is_left_to_the_check_that_requires_one(self) -> None:
        assert declaration_problems("x", None, None, kind="input") == []

    @pytest.mark.parametrize(
        ("kind", "noun"),
        [
            ("variable", "variable"),
            ("input", "input"),
            ("output", "output"),
            ("local", "local variable"),
        ],
    )
    def test_an_unknown_element_type_is_refused(self, kind: str, noun: str) -> None:
        assert declaration_problems("xs", "array", ["integer", "thing"], kind=kind) == [
            (
                "INVALID_ELEMENT_TYPES",
                f"Invalid element types for {noun} 'xs': unknown element type 'thing' "
                f"for item 1 (must be one of: {_ELEMENT_TYPES})",
            )
        ]

    def test_element_types_of_a_scalar_are_refused(self) -> None:
        assert declaration_problems("n", "integer", ["integer"], kind="output") == [
            (
                "INVALID_ELEMENT_TYPES",
                "Invalid element types for output 'n': "
                "element types apply only to an array or a map",
            )
        ]

    def test_every_broken_rule_is_reported(self) -> None:
        assert declaration_problems("class", "bogus", ["x"], kind="local") == [
            ("INVALID_VARIABLE", "Invalid local variable name: 'class' (a Python keyword)"),
            (
                "INVALID_VARIABLE_TYPE",
                f"Invalid local variable type: 'bogus' (must be one of: {_TYPES})",
            ),
            (
                "INVALID_ELEMENT_TYPES",
                "Invalid element types for local variable 'class': "
                "element types apply only to an array or a map",
            ),
        ]


class TestDeclaredValues:
    """A declaration's literal follows the one number rule, its elements and cells too
    (REQ-3.1.3.14, REQ-3.1.3.19)."""

    @pytest.mark.parametrize(
        "entry",
        [
            {"type": "integer", "value": "30"},
            {"type": "integer", "value": 30},
            {"type": "float", "value": "2.50"},
            {"type": "integer", "value": None},
            {"type": "integer"},
            {"type": "string", "value": "abc"},
            {"type": "integer", "value": "count + 1", "isExpression": True},
            {"type": "integer", "value": "{{ n }}", "isTemplate": True},
            {"type": "integer", "computed": True, "expression": "1 + 1"},
            {"type": "array", "value": ["1", "x"], "elementTypes": ["integer", "string"]},
        ],
        ids=[
            "digit-text",
            "integer",
            "float-text",
            "null",
            "no-value",
            "text",
            "expression",
            "template",
            "computed",
            "typed-items",
        ],
    )
    def test_a_value_that_follows_the_rule_has_no_problem(self, entry: dict[str, Any]) -> None:
        assert value_problems(entry, "x", kind="variable") == []

    @pytest.mark.parametrize(
        ("entry", "message"),
        [
            (
                {"type": "integer", "value": "3.5"},
                "Value for variable 'x' is not a valid integer",
            ),
            (
                {"type": "integer", "value": "12345678901234567890"},
                "Value for variable 'x' allows at most 19 digits, got 20",
            ),
            (
                {"type": "float", "value": "1.2345678901234567890123456789"},
                "Value for variable 'x' allows at most 28 significant digits, got 29",
            ),
            (
                {"type": "array", "value": ["1", "two"], "elementTypes": ["integer", "integer"]},
                "Value for variable 'x' at item 2 is not a valid integer",
            ),
            (
                {"type": "map", "value": {"ratio": "1e3"}, "elementTypes": {"ratio": "float"}},
                "Value for variable 'x' at key 'ratio' is not a valid float",
            ),
            (
                {
                    "type": "table",
                    "value": {
                        "columns": [{"name": "id", "type": "integer"}],
                        "rows": [["1"], ["x"]],
                    },
                },
                "Value for variable 'x' at row 2, column 'id' is not a valid integer",
            ),
        ],
        ids=["fraction", "20-digits", "29-digits", "item", "key", "cell"],
    )
    def test_a_value_that_breaks_the_rule_is_refused(
        self, entry: dict[str, Any], message: str
    ) -> None:
        assert value_problems(entry, "x", kind="variable") == [("INVALID_VARIABLE_VALUE", message)]

    @pytest.mark.parametrize(
        ("kind", "entry", "message"),
        [
            (
                "input",
                {"type": "integer", "default": "abc"},
                "Default for input 'x' is not a valid integer",
            ),
            (
                "output",
                {"type": "float", "default": "NaN"},
                "Default for output 'x' is not a valid float",
            ),
            (
                "local",
                {"type": "integer", "value": "1e3"},
                "Value for local variable 'x' is not a valid integer",
            ),
        ],
        ids=["input-default", "output-default", "local-value"],
    )
    def test_a_function_declaration_names_where_its_value_sits(
        self, kind: DeclarationKind, entry: dict[str, Any], message: str
    ) -> None:
        assert value_problems(entry, "x", kind=kind) == [("INVALID_VARIABLE_VALUE", message)]

    def test_an_enum_input_default_is_left_to_the_enum_rules(self) -> None:
        item = _enum(type="integer", enumValues=[1, 2], default="abc")

        assert value_problems(item, "level", kind="input") == []


class TestStoredDeclaration:
    """A save stores each valid number a declaration holds in its wire form (REQ-3.1.3.14)."""

    @pytest.mark.parametrize(
        ("kind", "entry", "stored"),
        [
            (
                "variable",
                {"type": "float", "value": 1e-07},
                {"type": "float", "value": "0.0000001"},
            ),
            (
                "input",
                {"type": "integer", "default": 1234567890123456789},
                {"type": "integer", "default": "1234567890123456789"},
            ),
            ("output", {"type": "float", "default": 30.0}, {"type": "float", "default": "30.0"}),
            ("local", {"type": "float", "value": 2.5}, {"type": "float", "value": 2.5}),
            (
                "variable",
                {"type": "map", "value": {"r": 1e-07}, "elementTypes": {"r": "float"}},
                {"type": "map", "value": {"r": "0.0000001"}, "elementTypes": {"r": "float"}},
            ),
        ],
        ids=["variable-value", "input-default", "output-default", "local-value", "typed-key"],
    )
    def test_a_literal_takes_its_wire_form(
        self, kind: DeclarationKind, entry: dict[str, Any], stored: dict[str, Any]
    ) -> None:
        assert _stored_declaration(entry, kind=kind) == stored

    @pytest.mark.parametrize(
        "entry",
        [
            {"type": "float", "value": "1e-07 * 2", "isExpression": True},
            {"type": "float", "value": "{{ n }}", "isTemplate": True},
            {"type": "float", "value": 1e-07, "computed": True},
            {"type": "float"},
            {"type": "string", "value": 1e-07},
        ],
        ids=["expression", "template", "computed", "no-value", "text-type"],
    )
    def test_a_declaration_with_no_typed_literal_stays_as_given(
        self, entry: dict[str, Any]
    ) -> None:
        assert _stored_declaration(entry, kind="variable") == entry

    def test_the_value_key_follows_the_kind(self) -> None:
        entry = {"type": "float", "value": 1e-07, "default": 1e-07}

        assert _stored_declaration(entry, kind="input") == {
            "type": "float",
            "value": 1e-07,
            "default": "0.0000001",
        }

    def test_an_enum_input_stores_its_allowed_values_and_default(self) -> None:
        item = _enum(type="float", enumValues=[1e-07, 30.0, "2.50", 2.5], default=30.0)

        assert _stored_declaration(item, kind="input") == _enum(
            type="float", enumValues=["0.0000001", "30.0", "2.50", 2.5], default="30.0"
        )

    def test_an_enum_input_without_a_list_or_default_keeps_its_shape(self) -> None:
        item = _without(_enum(type="integer", enumValues="1, 2"), "default")

        assert _stored_declaration(item, kind="input") == item

    def test_the_given_declaration_is_not_changed(self) -> None:
        entry = {"type": "float", "value": 30.0}

        _stored_declaration(entry, kind="variable")

        assert entry == {"type": "float", "value": 30.0}


class TestReadBackDeclaration:
    """Digit text in a declaration's number place reads back as that number."""

    def test_a_value_default_and_allowed_values_read_back_as_numbers(self) -> None:
        item = _enum(type="float", enumValues=["30.0", "2.50"], default="30.0")

        assert [
            declaration_numbers(
                {"type": "float", "default": "0.0000001"}, kind="input", form=text_as_number
            ),
            declaration_numbers(item, kind="input", form=text_as_number)["enumValues"],
            declaration_numbers(
                {"type": "integer", "value": "7"}, kind="local", form=text_as_number
            ),
        ] == [
            {"type": "float", "default": Decimal("0.0000001")},
            [Decimal("30.0"), Decimal("2.50")],
            {"type": "integer", "value": 7},
        ]
