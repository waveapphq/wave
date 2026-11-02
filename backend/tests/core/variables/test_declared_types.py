"""Declared variable types during a run (REQ-3.1.3.6, SHRUN-6).

A block that converts a captured value reads the declared type of the WAVE
variable its output is bound to, never the value standing there: a variable
declared with no value holds the null start, so a value cannot carry a type. The run
publishes the declared types in a scope the whole walk reads, and a Function
body is a flat scope of its own.
"""

import asyncio
import contextlib

import pytest

from wavecore.core.variables.declared_types import (
    declared_type,
    declared_type_scope,
    types_of_declarations,
    types_of_function,
)


class TestTheScopeIsSetAndReset:
    """A scope carries the run's declared types and leaves nothing behind."""

    def test_nothing_is_declared_outside_a_scope(self) -> None:
        assert declared_type("c") is None

    def test_a_name_the_scope_carries_reads_its_type(self) -> None:
        with declared_type_scope({"c": "integer", "s": "string"}):
            assert declared_type("c") == "integer"
            assert declared_type("s") == "string"

    def test_a_name_the_scope_does_not_carry_reads_none(self) -> None:
        with declared_type_scope({"c": "integer"}):
            assert declared_type("undeclared") is None

    def test_the_scope_is_reset_on_exit(self) -> None:
        with declared_type_scope({"c": "integer"}):
            pass

        assert declared_type("c") is None

    def test_the_scope_is_reset_after_a_failure(self) -> None:
        with contextlib.suppress(RuntimeError), declared_type_scope({"c": "integer"}):
            raise RuntimeError("body failed")

        assert declared_type("c") is None

    def test_an_empty_scope_declares_nothing(self) -> None:
        with declared_type_scope({}):
            assert declared_type("c") is None


class TestAFunctionScopeReplacesTheOuterOne:
    """A Function body is its own flat scope, not a child of the test's."""

    def test_the_inner_types_apply_inside(self) -> None:
        with declared_type_scope({"c": "integer"}), declared_type_scope({"n": "float"}):
            assert declared_type("n") == "float"

    def test_an_outer_name_is_invisible_inside(self) -> None:
        with declared_type_scope({"c": "integer"}), declared_type_scope({"n": "float"}):
            assert declared_type("c") is None

    def test_the_outer_scope_returns_when_the_inner_one_ends(self) -> None:
        with declared_type_scope({"c": "integer"}):
            with declared_type_scope({"n": "float"}):
                pass

            assert declared_type("c") == "integer"
            assert declared_type("n") is None


class TestConcurrentLanes:
    """A forked task copies the scope, and a lane's own scope stays in it."""

    async def test_a_task_inherits_the_scope_it_was_created_in(self) -> None:
        seen: list[str | None] = []

        async def lane() -> None:
            await asyncio.sleep(0)
            seen.append(declared_type("c"))

        with declared_type_scope({"c": "integer"}):
            await asyncio.create_task(lane())

        assert seen == ["integer"]

    async def test_a_lane_function_scope_does_not_reach_a_sibling_lane(self) -> None:
        seen: dict[str, tuple[str | None, str | None]] = {}

        async def lane(name: str, types: dict[str, str]) -> None:
            with declared_type_scope(types):
                await asyncio.sleep(0.01)
                seen[name] = (declared_type("a"), declared_type("b"))

        with declared_type_scope({"c": "integer"}):
            await asyncio.gather(
                asyncio.create_task(lane("left", {"a": "integer"})),
                asyncio.create_task(lane("right", {"b": "table"})),
            )

        assert seen["left"] == ("integer", None)
        assert seen["right"] == (None, "table")

    async def test_a_lane_scope_does_not_reach_the_run_that_forked_it(self) -> None:
        async def lane() -> None:
            with declared_type_scope({"n": "float"}):
                await asyncio.sleep(0.01)

        with declared_type_scope({"c": "integer"}):
            await asyncio.gather(asyncio.create_task(lane()))

            assert declared_type("c") == "integer"
            assert declared_type("n") is None


class TestTypesOfDeclarations:
    """The test's variable map, in the shape the run start reads it."""

    def test_the_declared_types_of_a_mixed_map(self) -> None:
        raw = {"a": {"type": "integer"}, "b": {"value": "x"}, "c": 5}

        assert types_of_declarations(raw) == {"a": "integer", "b": "string"}

    def test_every_declared_type_is_carried(self) -> None:
        raw = {
            "c": {"type": "integer"},
            "s": {"type": "string", "value": "x"},
            "u": {"type": "float"},
            "t": {"type": "table"},
            "m": {"type": "map"},
            "flag": {"type": "boolean", "value": False},
        }

        assert types_of_declarations(raw) == {
            "c": "integer",
            "s": "string",
            "u": "float",
            "t": "table",
            "m": "map",
            "flag": "boolean",
        }

    def test_a_declaration_without_a_type_reads_string(self) -> None:
        assert types_of_declarations({"b": {"value": "x"}}) == {"b": "string"}

    def test_a_bare_value_declares_nothing(self) -> None:
        assert types_of_declarations({"c": 5, "s": "text", "n": None}) == {}

    def test_a_secret_declaration_keeps_its_type(self) -> None:
        raw = {"tok": {"type": "string", "secret": True}}

        assert types_of_declarations(raw) == {"tok": "string"}

    def test_an_empty_map_declares_nothing(self) -> None:
        assert types_of_declarations({}) == {}


class TestTypesOfFunction:
    """A Function's own variables and its declared outputs, in the list form."""

    def test_the_body_variables_carry_their_types(self) -> None:
        function_def = {
            "variables": [
                {"name": "run_time", "type": "float", "value": 0},
                {"name": "label", "type": "string", "value": "x"},
            ],
            "outputs": [],
        }

        assert types_of_function(function_def) == {"run_time": "float", "label": "string"}

    def test_the_declared_outputs_carry_their_types(self) -> None:
        function_def = {"variables": [], "outputs": [{"name": "c", "type": "integer"}]}

        assert types_of_function(function_def) == {"c": "integer"}

    def test_variables_and_outputs_are_both_in_the_scope(self) -> None:
        function_def = {
            "variables": [{"name": "seen", "type": "boolean", "value": False}],
            "outputs": [{"name": "c", "type": "integer"}],
        }

        assert types_of_function(function_def) == {"seen": "boolean", "c": "integer"}

    def test_a_declared_output_wins_a_name_a_body_variable_shares(self) -> None:
        function_def = {
            "variables": [{"name": "c", "type": "string", "value": "x"}],
            "outputs": [{"name": "c", "type": "integer"}],
        }

        assert types_of_function(function_def) == {"c": "integer"}

    def test_an_entry_without_a_type_reads_string(self) -> None:
        function_def = {"variables": [{"name": "v", "value": "x"}], "outputs": []}

        assert types_of_function(function_def) == {"v": "string"}

    def test_an_entry_without_a_name_declares_nothing(self) -> None:
        function_def = {"variables": [{"type": "integer"}], "outputs": []}

        assert types_of_function(function_def) == {}

    def test_a_definition_carrying_neither_list_declares_nothing(self) -> None:
        assert types_of_function({}) == {}


class TestTypesOfFunctionParameters:
    """An enum input is typed by its own type; a computed output keeps its declared type
    (REQ-3.1.2.11, REQ-3.1.2.8)."""

    @pytest.mark.parametrize(
        ("value_type", "allowed"),
        [
            pytest.param("string", ["low", "high"], id="string"),
            pytest.param("integer", [1, 2], id="integer"),
            pytest.param("float", [0.5, 1.5], id="float"),
        ],
    )
    def test_an_enum_input_is_declared_as_its_own_type(
        self, value_type: str, allowed: list[object]
    ) -> None:
        function_def = {
            "inputs": [
                {
                    "name": "level",
                    "type": value_type,
                    "required": True,
                    "enumValues": allowed,
                    "default": allowed[0],
                }
            ],
            "outputs": [],
            "variables": [],
        }

        assert types_of_function(function_def).get("level") == value_type

    @pytest.mark.parametrize(
        ("output", "declared"),
        [
            pytest.param(
                {"name": "total", "type": "integer", "default": "count * 2", "isExpression": True},
                "integer",
                id="expression",
            ),
            pytest.param(
                {
                    "name": "total",
                    "type": "string",
                    "default": "id-{{ count }}",
                    "isTemplate": True,
                },
                "string",
                id="template",
            ),
        ],
    )
    def test_a_computed_output_keeps_its_declared_type(
        self, output: dict[str, object], declared: str
    ) -> None:
        function_def = {"inputs": [], "outputs": [output], "variables": []}

        assert types_of_function(function_def).get("total") == declared


class TestTypesOfFunctionEveryInput:
    """With ``every_input`` the map also types the plain inputs, the scope a Current edit
    checks against (REQ-3.2.1.6); without it a plain input is never written, so untyped."""

    _DEFINITION: dict[str, object] = {
        "inputs": [
            {"name": "who", "type": "string"},
            {"name": "level", "type": "integer", "required": True, "enumValues": [1, 2]},
            {"name": "bare"},
        ],
        "variables": [{"name": "note", "type": "string", "value": "n"}],
        "outputs": [{"name": "total", "type": "float"}],
    }

    def test_every_input_types_the_plain_inputs_too(self) -> None:
        assert types_of_function(self._DEFINITION, every_input=True) == {
            "who": "string",
            "level": "integer",
            "bare": "string",
            "note": "string",
            "total": "float",
        }

    def test_without_every_input_only_an_enum_input_is_typed(self) -> None:
        assert types_of_function(self._DEFINITION) == {
            "level": "integer",
            "note": "string",
            "total": "float",
        }

    def test_an_output_wins_a_name_an_input_shares(self) -> None:
        function_def = {
            "inputs": [{"name": "x", "type": "string"}],
            "outputs": [{"name": "x", "type": "integer"}],
        }

        assert types_of_function(function_def, every_input=True) == {"x": "integer"}
