"""
Unit tests for Variable Setter Control (REQ-3.4.1.14).

Tests the Variable Setter as a ControlBase implementation (not PluginBase).
Covers: model/enum presence, metadata, registry, validation, execution,
logging, and per-variable expression resolution.
"""

from decimal import Decimal
from typing import Any
from unittest.mock import Mock

import pytest

from wavecore.controls.base import ControlBase
from wavecore.core.table import Table
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlCategory, ControlId

# =============================================================================
# Model / Enum presence
# =============================================================================


class TestVariableSetterEnumPresence:
    """Test that VARIABLE_SETTER is in ControlId enum and category map."""

    def test_variable_setter_in_control_id_enum(self):
        """ControlId must have VARIABLE_SETTER member."""
        assert hasattr(ControlId, "VARIABLE_SETTER")
        assert ControlId.VARIABLE_SETTER.value == "variable-setter"

    def test_variable_setter_category_is_flow(self):
        """VARIABLE_SETTER must be categorized as FLOW."""
        from wavecore.models.enums import get_control_category

        cat = get_control_category(ControlId.VARIABLE_SETTER)
        assert cat == ControlCategory.FLOW

    def test_variable_setter_in_flow_controls_list(self):
        """VARIABLE_SETTER must appear in get_controls_by_category(FLOW)."""
        from wavecore.models.enums import get_controls_by_category

        flow_controls = get_controls_by_category(ControlCategory.FLOW)
        assert ControlId.VARIABLE_SETTER in flow_controls


# =============================================================================
# Control class structure
# =============================================================================


class TestVariableSetterControlClass:
    """Test VariableSetterControl class structure."""

    def test_control_exists_and_importable(self):
        """VariableSetterControl must be importable from controls package."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        assert control is not None

    def test_control_extends_control_base(self):
        """VariableSetterControl must extend ControlBase, not PluginBase."""
        from wavecore.controls.variable_setter import VariableSetterControl

        assert issubclass(VariableSetterControl, ControlBase)

    def test_control_not_a_plugin(self):
        """VariableSetterControl must NOT extend PluginBase."""
        from wavecore.controls.variable_setter import VariableSetterControl
        from wavecore.plugins.base import PluginBase

        assert not issubclass(VariableSetterControl, PluginBase)


# =============================================================================
# Metadata
# =============================================================================


class TestVariableSetterMetadata:
    """Test VariableSetterControl metadata declaration."""

    def test_metadata_id_is_variable_setter(self):
        """Metadata id must be ControlId.VARIABLE_SETTER."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        assert meta["id"] == ControlId.VARIABLE_SETTER

    def test_metadata_version(self):
        """Metadata version must be 1.0.0."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        assert meta["version"] == "1.0.0"

    def test_metadata_name(self):
        """Metadata name must be 'Variable Setter'."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        assert meta["name"] == "Variable Setter"

    def test_metadata_category_is_flow(self):
        """Metadata category must be 'flow'."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        assert meta["category"] == "flow"

    def test_metadata_has_icon_name(self):
        """Metadata must include icon_name."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        assert "icon_name" in meta
        assert isinstance(meta["icon_name"], str)
        assert len(meta["icon_name"]) > 0

    def test_metadata_has_description(self):
        """Metadata must include non-empty description."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        assert "description" in meta
        assert len(meta["description"]) > 0

    def test_metadata_has_parameter_schema(self):
        """Metadata must include parameter_schema list."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        assert "parameter_schema" in meta
        assert isinstance(meta["parameter_schema"], list)

    def test_metadata_has_structure_hints(self):
        """Metadata must include structure_hints dict."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        assert "structure_hints" in meta
        assert isinstance(meta["structure_hints"], dict)

    def test_parameter_schema_has_variables_param(self):
        """Parameter schema must define a 'variables' parameter of type 'map'."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        params = meta["parameter_schema"]
        var_params = [p for p in params if p.name == "variables"]
        assert len(var_params) == 1

        var_param = var_params[0]
        assert isinstance(var_param, ControlParameter)
        assert var_param.type == "map"
        assert var_param.required is True

    def test_variables_declare_no_entry_mark_and_refuse_a_whole_null(self):
        """A null row reaches the setter with no per-entry mark; the whole map refuses null
        (REQ-3.1.3.21)."""
        from wavecore.controls.variable_setter import VariableSetterControl

        (var_param,) = VariableSetterControl().metadata["parameter_schema"]

        assert "entries_accept_null" not in var_param.model_dump()
        assert var_param.accepts_null is False
        assert var_param.null_piece_prints is False

    def test_parameter_schema_has_only_variables(self):
        """Parameter schema must contain exactly one parameter: variables."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        params = meta["parameter_schema"]
        assert len(params) == 1
        assert params[0].name == "variables"

    def test_structure_hints_sequential(self):
        """Structure hints must indicate sequential type (no branching)."""
        from wavecore.controls.variable_setter import VariableSetterControl

        meta = VariableSetterControl().metadata
        hints = meta["structure_hints"]
        assert hints["type"] == "sequential"

    def test_get_control_metadata_returns_pydantic_model(self):
        """get_control_metadata() must return validated ControlMetadata model."""
        from wavecore.controls.variable_setter import VariableSetterControl
        from wavecore.models.controls.metadata import ControlMetadata

        control = VariableSetterControl()
        model = control.get_control_metadata()

        assert isinstance(model, ControlMetadata)
        assert model.id == ControlId.VARIABLE_SETTER
        assert model.version == "1.0.0"
        assert model.category == ControlCategory.FLOW


# =============================================================================
# Registry
# =============================================================================


class TestVariableSetterRegistry:
    """Test VariableSetterControl registration in control registry."""

    def test_register_all_core_controls_includes_variable_setter(self):
        """register_all_core_controls must register VARIABLE_SETTER."""
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )

        registry = ControlImplementationRegistry()
        register_all_core_controls(registry)

        impl = registry.get(ControlId.VARIABLE_SETTER, "1.0.0")
        assert impl is not None

    def test_register_all_core_controls_registers_15_controls(self):
        """register_all_core_controls must register 15 controls."""
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )

        registry = ControlImplementationRegistry()
        register_all_core_controls(registry)

        registered_ids = registry.list_control_ids()
        assert len(registered_ids) == 15

    def test_variable_setter_resolves_with_caret_constraint(self):
        """VARIABLE_SETTER 1.0.0 must resolve with ^1.0.0 constraint."""
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )

        registry = ControlImplementationRegistry()
        register_all_core_controls(registry)

        impl = registry.resolve(ControlId.VARIABLE_SETTER, "^1.0.0")
        assert impl is not None


# =============================================================================
# Validation
# =============================================================================


class TestVariableSetterValidation:
    """Test VariableSetterControl parameter validation."""

    @pytest.mark.asyncio
    async def test_validate_requires_variables_parameter(self):
        """Validation must fail when 'variables' parameter is missing."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()

        with pytest.raises(ValueError, match="Missing required parameter: variables"):
            await control.validate({})

    @pytest.mark.asyncio
    async def test_validate_accepts_valid_variables_map(self):
        """Validation must succeed with valid variables map."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        await control.validate({"variables": {"var1": "value1", "var2": 42}})

    @pytest.mark.asyncio
    async def test_validate_rejects_non_map_variables(self):
        """Validation must fail when variables is not a dict."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()

        with pytest.raises(TypeError, match="Parameter 'variables' must be a map"):
            await control.validate({"variables": "not a map"})

    @pytest.mark.asyncio
    async def test_validate_accepts_empty_variables_map(self):
        """Validation must succeed with empty variables map (no-op)."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        await control.validate({"variables": {}})

    @pytest.mark.asyncio
    async def test_validate_rejects_empty_variable_name(self):
        """Validation must fail for empty string variable names."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()

        with pytest.raises(ValueError, match="Variable names must be non-empty strings"):
            await control.validate({"variables": {"": 1}})

    @pytest.mark.asyncio
    async def test_validate_rejects_non_string_variable_name(self):
        """Validation must fail for non-string variable names."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()

        with pytest.raises(ValueError, match="Variable names must be non-empty strings"):
            await control.validate({"variables": {None: 1}})  # type: ignore[dict-item]


# =============================================================================
# Execution
# =============================================================================


class TestVariableSetterExecution:
    """Test VariableSetterControl execution behavior."""

    @pytest.mark.asyncio
    async def test_execute_sets_single_variable(self):
        """Execute must set an existing variable's value."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"myvar": "myvalue"}},
            "variables": {
                "myvar": {"value": "", "scope": "test", "type": "string"},
            },
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["myvar"]["value"] == "myvalue"

    @pytest.mark.asyncio
    async def test_execute_sets_multiple_variables(self):
        """Execute must set multiple existing variables simultaneously."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"var1": "a", "var2": 42, "var3": True}},
            "variables": {
                "var1": {"value": "", "scope": "test", "type": "string"},
                "var2": {"value": 0, "scope": "test", "type": "integer"},
                "var3": {"value": False, "scope": "test", "type": "boolean"},
            },
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["var1"]["value"] == "a"
        assert context["variables"]["var2"]["value"] == 42
        assert context["variables"]["var3"]["value"] is True

    @pytest.mark.asyncio
    async def test_execute_preserves_types(self):
        """Execute must preserve value types (float lands as exact Decimal)."""
        from decimal import Decimal

        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {
                "variables": {
                    "str_var": "text",
                    "int_var": 42,
                    "float_var": 3.14,
                    "bool_var": False,
                    "array_var": [1, 2, 3],
                    "map_var": {"key": "value"},
                    "null_var": None,
                }
            },
            "variables": {
                "str_var": {"value": "", "scope": "test", "type": "string"},
                "int_var": {"value": 0, "scope": "test", "type": "integer"},
                "float_var": {"value": 0.0, "scope": "test", "type": "float"},
                "bool_var": {"value": True, "scope": "test", "type": "boolean"},
                "array_var": {"value": [], "scope": "test", "type": "array"},
                "map_var": {"value": {}, "scope": "test", "type": "map"},
                "null_var": {"value": "", "scope": "test", "type": "string"},
            },
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["str_var"]["value"] == "text"
        assert context["variables"]["int_var"]["value"] == 42
        assert context["variables"]["float_var"]["value"] == Decimal("3.14")
        assert context["variables"]["bool_var"]["value"] is False
        assert context["variables"]["array_var"]["value"] == [1, 2, 3]
        assert context["variables"]["map_var"]["value"] == {"key": "value"}
        assert context["variables"]["null_var"]["value"] is None

    @pytest.mark.asyncio
    async def test_execute_updates_existing_variable(self):
        """Execute must update existing variable value while preserving scope."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"existing": "new_value"}},
            "variables": {"existing": {"value": "old_value", "scope": "test", "type": "string"}},
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["existing"]["value"] == "new_value"
        assert context["variables"]["existing"]["scope"] == "test"

    @pytest.mark.asyncio
    async def test_execute_preserves_suite_scope(self):
        """Execute must preserve original scope (e.g. suite) when updating existing vars."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"suite_var": "updated"}},
            "variables": {"suite_var": {"value": "original", "scope": "suite", "type": "string"}},
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["suite_var"]["value"] == "updated"
        assert context["variables"]["suite_var"]["scope"] == "suite"

    @pytest.mark.asyncio
    async def test_execute_updates_raw_value_variable(self):
        """Execute must overwrite existing raw (non-structured) variable values."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"raw_var": "new_value"}},
            "variables": {"raw_var": "old_value"},
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["raw_var"] == "new_value"

    @pytest.mark.asyncio
    async def test_undeclared_variable_raises_error(self):
        """Execute must raise ValueError for variables not in the context."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"undeclared": "value"}},
            "variables": {},
            "logger": None,
        }

        with pytest.raises(
            ValueError,
            match="Variable 'undeclared' is not declared",
        ):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_undeclared_variable_message_includes_guidance(self):
        """Error message must tell user to add the variable in the variable manager."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"missing_var": 42}},
            "variables": {"other_var": "exists"},
            "logger": None,
        }

        with pytest.raises(ValueError, match="Add it in the variable manager"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_execute_returns_none(self):
        """Execute must return None (no return value)."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"x": 1}},
            "variables": {
                "x": {"value": 0, "scope": "test", "type": "integer"},
            },
            "logger": None,
        }

        result = await control.execute(context)
        assert result is None

    @pytest.mark.asyncio
    async def test_mixed_declared_and_undeclared_fails_on_undeclared(self):
        """Execute must fail if any variable in the map is not declared."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"existing": "updated", "missing": "oops"}},
            "variables": {"existing": {"value": "original", "scope": "test", "type": "string"}},
            "logger": None,
        }

        with pytest.raises(ValueError, match="Variable 'missing' is not declared"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_empty_variables_map_raises_error(self):
        """Execute with empty variables map must raise clear error."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {}},
            "variables": {},
            "logger": None,
        }

        with pytest.raises(ValueError, match="Variable Setter has no variables set"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_missing_variables_key_raises_error(self):
        """Execute with no 'variables' key (unconfigured control) must raise clear error."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {},
            "variables": {},
            "logger": None,
        }

        with pytest.raises(ValueError, match="Variable Setter has no variables set"):
            await control.execute(context)


# =============================================================================
# Logging
# =============================================================================


class TestVariableSetterLogging:
    """Test logging behavior during execution."""

    @pytest.mark.asyncio
    async def test_logs_variable_set(self):
        """Setting a variable must log at DEBUG level."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        mock_logger = Mock()
        context: dict[str, Any] = {
            "parameters": {"variables": {"existing": "updated"}},
            "variables": {"existing": {"value": "original", "scope": "test", "type": "string"}},
            "logger": mock_logger,
        }

        await control.execute(context)

        mock_logger.debug.assert_called()
        call_args = mock_logger.debug.call_args[0][0]
        assert "Set variable" in call_args
        assert "existing" in call_args

    @pytest.mark.asyncio
    async def test_no_crash_without_logger(self):
        """Execution must work without a logger (no crashes)."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"myvar": "value"}},
            "variables": {
                "myvar": {"value": "", "scope": "test", "type": "string"},
            },
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["myvar"]["value"] == "value"


class TestVariableSetterDebugLine:
    """The debug line quotes a string and prints every other value in WAVE's print
    form (REQ-3.1.3.23)."""

    @staticmethod
    async def _debug_line(value: Any, declared_type: str) -> str:
        from wavecore.controls.variable_setter import VariableSetterControl

        logger = Mock()
        await VariableSetterControl().execute(
            {
                "parameters": {"variables": {"target": value}},
                "variables": {"target": {"value": None, "scope": "test", "type": declared_type}},
                "logger": logger,
            }
        )
        logger.debug.assert_called_once()
        return logger.debug.call_args[0][0]

    @pytest.mark.asyncio
    async def test_a_null_value_prints_null(self):
        line = await self._debug_line(None, "integer")

        assert line == "Set variable 'target' = null (scope: test)"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("value", "text"), [(True, "true"), (False, "false")])
    async def test_a_boolean_prints_lower_case(self, value: bool, text: str):
        line = await self._debug_line(value, "boolean")

        assert line == f"Set variable 'target' = {text} (scope: test)"

    @pytest.mark.asyncio
    async def test_a_list_prints_compact_json_with_null_inside(self):
        line = await self._debug_line([1, None, "x"], "array")

        assert line == """Set variable 'target' = [1,null,"x"] (scope: test)"""

    @pytest.mark.asyncio
    async def test_a_map_prints_compact_json_with_null_inside(self):
        line = await self._debug_line({"host": "web-1", "port": None}, "map")

        assert line == """Set variable 'target' = {"host":"web-1","port":null} (scope: test)"""

    @pytest.mark.asyncio
    async def test_a_float_prints_its_exact_decimal_text(self):
        line = await self._debug_line("1.50", "float")

        assert line == "Set variable 'target' = 1.50 (scope: test)"

    @pytest.mark.asyncio
    async def test_an_integer_prints_its_digits(self):
        line = await self._debug_line(42, "integer")

        assert line == "Set variable 'target' = 42 (scope: test)"

    @pytest.mark.asyncio
    async def test_a_string_stays_quoted(self):
        line = await self._debug_line("hello", "string")

        assert line == "Set variable 'target' = 'hello' (scope: test)"

    @pytest.mark.asyncio
    async def test_the_text_null_stays_a_quoted_string(self):
        line = await self._debug_line("null", "string")

        assert line == "Set variable 'target' = 'null' (scope: test)"

    @pytest.mark.asyncio
    async def test_a_flat_variable_prints_null_the_same_way(self):
        from wavecore.controls.variable_setter import VariableSetterControl

        logger = Mock()
        await VariableSetterControl().execute(
            {
                "parameters": {"variables": {"raw": None}},
                "variables": {"raw": "old"},
                "logger": logger,
            }
        )

        logger.debug.assert_called_once_with("Set variable 'raw' = null (scope: test)")


# =============================================================================
# resolve_parameters with map_expression_keys
# =============================================================================


class TestResolveParametersMapExpressionKeys:
    """Test resolve_parameters extension for per-entry map expression resolution."""

    def test_map_expression_keys_evaluates_flagged_entries(self):
        """Entries flagged in map_expression_keys must be evaluated as expressions."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "literal_var": "hello",
                "expr_var": "1 + 2",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys={"variables": {"expr_var"}},
        )

        assert result["variables"]["literal_var"] == "hello"
        assert result["variables"]["expr_var"] == 3

    def test_map_expression_keys_leaves_non_flagged_entries_as_literals(self):
        """Entries NOT flagged in map_expression_keys must pass through unchanged."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "literal_var": "1 + 2",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys={"variables": set()},
        )

        assert result["variables"]["literal_var"] == "1 + 2"

    def test_map_expression_keys_with_variable_references(self):
        """Map expression entries must resolve variable references."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "computed": "base_val + 10",
            }
        }
        variables = {"base_val": 5}
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables=variables,
            parameter_types={},
            map_expression_keys={"variables": {"computed"}},
        )

        assert result["variables"]["computed"] == 15

    def test_map_expression_keys_none_means_no_map_resolution(self):
        """When map_expression_keys is None, map values pass through as literals."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "expr_looking": "1 + 2",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys=None,
        )

        assert result["variables"]["expr_looking"] == "1 + 2"

    def test_map_expression_keys_empty_dict_means_no_map_resolution(self):
        """When map_expression_keys is empty dict, map values pass through as literals."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "expr_looking": "1 + 2",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys={},
        )

        assert result["variables"]["expr_looking"] == "1 + 2"

    def test_map_expression_keys_non_string_values_pass_through(self):
        """Non-string map values must pass through even if flagged as expressions."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "num_val": 42,
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys={"variables": {"num_val"}},
        )

        assert result["variables"]["num_val"] == 42

    def test_map_expression_keys_coexists_with_expression_fields(self):
        """map_expression_keys must work alongside regular expression_fields."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "timeout": "10 + 5",
            "variables": {
                "computed": "2 * 3",
                "literal": "hello",
            },
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields={"timeout"},
            variables={},
            parameter_types={"timeout": "integer"},
            map_expression_keys={"variables": {"computed"}},
        )

        assert result["timeout"] == 15
        assert result["variables"]["computed"] == 6
        assert result["variables"]["literal"] == "hello"

    def test_map_expression_keys_invalid_expression_raises(self):
        """Invalid expressions in map entries must raise InvalidExpressionError."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import InvalidExpressionError

        parameters = {
            "variables": {
                "bad": "undefined_var + 1",
            }
        }
        with pytest.raises(InvalidExpressionError):
            resolve_parameters(
                parameters=parameters,
                expression_fields=set(),
                variables={},
                parameter_types={},
                map_expression_keys={"variables": {"bad"}},
            )

    def test_map_expression_keys_blocked_expression_raises(self):
        """Blocked expressions in map entries must raise BlockedExpressionError."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        parameters = {
            "variables": {
                "bad": "__import__('os').system('rm -rf /')",
            }
        }
        with pytest.raises(BlockedExpressionError):
            resolve_parameters(
                parameters=parameters,
                expression_fields=set(),
                variables={},
                parameter_types={},
                map_expression_keys={"variables": {"bad"}},
            )

    def test_map_expression_keys_empty_string_expression_resolves_to_none(self):
        """Empty string expression in map entry must resolve to None."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "empty": "",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys={"variables": {"empty"}},
        )

        assert result["variables"]["empty"] is None

    def test_map_expression_keys_only_applies_to_specified_parameter(self):
        """map_expression_keys must only apply to the named parameter, not others."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {"computed": "1 + 1"},
            "other_map": {"also_looks_like_expr": "2 + 2"},
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys={"variables": {"computed"}},
        )

        assert result["variables"]["computed"] == 2
        assert result["other_map"]["also_looks_like_expr"] == "2 + 2"

    def test_map_expression_keys_skips_missing_parameter(self):
        """map_expression_keys referencing a param not in parameters must be skipped."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {"x": "hello"},
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys={"nonexistent_param": {"x"}},
        )

        # variables should pass through unchanged (nonexistent_param is skipped)
        assert result["variables"]["x"] == "hello"

    def test_map_expression_keys_skips_non_dict_parameter(self):
        """map_expression_keys on a non-dict parameter must be skipped."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "scalar_param": "just a string",
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_expression_keys={"scalar_param": {"x"}},
        )

        # scalar_param should pass through unchanged
        assert result["scalar_param"] == "just a string"

    def test_map_expression_keys_blocked_mutation_raises(self):
        """Mutating expressions in map entries must raise BlockedExpressionError."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        parameters = {
            "variables": {
                "bad": "my_list.append(42)",
            }
        }
        with pytest.raises(BlockedExpressionError):
            resolve_parameters(
                parameters=parameters,
                expression_fields=set(),
                variables={},
                parameter_types={},
                map_expression_keys={"variables": {"bad"}},
            )


# =============================================================================
# resolve_parameters with map_template_keys (eager per-key template rendering)
# =============================================================================


class TestResolveParametersMapTemplateKeys:
    """resolve_parameters renders {{ }} markers in flagged map entries (REQ-3.1.3.15).

    Mirrors TestResolveParametersMapExpressionKeys: the setter's per-key template
    path clones the per-key expression path but renders {{ }} markers eagerly
    instead of evaluating a whole-string expression.
    """

    def test_map_template_keys_renders_flagged_entries(self):
        """Entries flagged in map_template_keys have their {{ }} markers rendered."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "literal_var": "plain text",
                "tmpl_var": "Hello {{ name }}",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"name": "World"},
            parameter_types={},
            map_template_keys={"variables": {"tmpl_var"}},
        )

        assert result["variables"]["literal_var"] == "plain text"
        assert result["variables"]["tmpl_var"] == "Hello World"

    def test_map_template_keys_leaves_non_flagged_entries_as_literals(self):
        """Entries NOT flagged in map_template_keys keep their {{ }} text verbatim."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "literal_var": "Hello {{ name }}",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"name": "World"},
            parameter_types={},
            map_template_keys={"variables": set()},
        )

        assert result["variables"]["literal_var"] == "Hello {{ name }}"

    def test_map_template_keys_renders_multiple_markers(self):
        """A flagged entry renders every {{ }} marker it contains."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "full": "{{ first }} {{ last }}",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"first": "Ada", "last": "Lovelace"},
            parameter_types={},
            map_template_keys={"variables": {"full"}},
        )

        assert result["variables"]["full"] == "Ada Lovelace"

    def test_map_template_keys_without_markers_passes_through(self):
        """A flagged entry with no {{ }} markers renders to its literal text."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "plain": "just a string",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_template_keys={"variables": {"plain"}},
        )

        assert result["variables"]["plain"] == "just a string"

    def test_map_template_keys_whitespace_only_marker_unchanged(self):
        """{{ }} (whitespace only) is left as-is inside a flagged entry."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "weird": "empty: {{ }}",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_template_keys={"variables": {"weird"}},
        )

        assert result["variables"]["weird"] == "empty: {{ }}"

    def test_map_template_keys_empty_string_renders_to_empty(self):
        """An empty flagged entry renders to an empty string (a template, not None)."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "empty": "",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_template_keys={"variables": {"empty"}},
        )

        assert result["variables"]["empty"] == ""

    def test_map_template_keys_none_means_no_map_resolution(self):
        """When map_template_keys is None, map values pass through verbatim."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "tmpl_looking": "Hello {{ name }}",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"name": "World"},
            parameter_types={},
            map_template_keys=None,
        )

        assert result["variables"]["tmpl_looking"] == "Hello {{ name }}"

    def test_map_template_keys_empty_dict_means_no_map_resolution(self):
        """When map_template_keys is an empty dict, map values pass through verbatim."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "tmpl_looking": "Hello {{ name }}",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"name": "World"},
            parameter_types={},
            map_template_keys={},
        )

        assert result["variables"]["tmpl_looking"] == "Hello {{ name }}"

    def test_map_template_keys_non_string_values_pass_through(self):
        """Non-string map values pass through even if flagged as templates."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "num_val": 42,
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={},
            parameter_types={},
            map_template_keys={"variables": {"num_val"}},
        )

        assert result["variables"]["num_val"] == 42

    def test_map_template_and_expression_keys_both_resolved_when_disjoint(self):
        """Expression and template keys in the same map both resolve (disjoint sets)."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {
                "computed": "2 * 3",
                "greeting": "Hi {{ name }}",
                "literal": "plain",
            }
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"name": "Bob"},
            parameter_types={},
            map_expression_keys={"variables": {"computed"}},
            map_template_keys={"variables": {"greeting"}},
        )

        assert result["variables"]["computed"] == 6
        assert result["variables"]["greeting"] == "Hi Bob"
        assert result["variables"]["literal"] == "plain"

    def test_map_template_keys_only_applies_to_specified_parameter(self):
        """map_template_keys only renders entries in the named parameter."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {"greeting": "Hi {{ name }}"},
            "other_map": {"also_tmpl": "Bye {{ name }}"},
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"name": "Bob"},
            parameter_types={},
            map_template_keys={"variables": {"greeting"}},
        )

        assert result["variables"]["greeting"] == "Hi Bob"
        assert result["other_map"]["also_tmpl"] == "Bye {{ name }}"

    def test_map_template_keys_skips_missing_parameter(self):
        """map_template_keys naming a param absent from parameters is skipped."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "variables": {"x": "Hi {{ name }}"},
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"name": "Bob"},
            parameter_types={},
            map_template_keys={"nonexistent_param": {"x"}},
        )

        assert result["variables"]["x"] == "Hi {{ name }}"

    def test_map_template_keys_skips_non_dict_parameter(self):
        """map_template_keys on a non-dict parameter is skipped."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "scalar_param": "just a string {{ name }}",
        }
        result = resolve_parameters(
            parameters=parameters,
            expression_fields=set(),
            variables={"name": "Bob"},
            parameter_types={},
            map_template_keys={"scalar_param": {"x"}},
        )

        assert result["scalar_param"] == "just a string {{ name }}"

    def test_map_template_keys_invalid_marker_expression_raises(self):
        """An undefined reference inside {{ }} raises InvalidExpressionError."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import InvalidExpressionError

        parameters = {
            "variables": {
                "bad": "Hi {{ undefined_var }}",
            }
        }
        with pytest.raises(InvalidExpressionError):
            resolve_parameters(
                parameters=parameters,
                expression_fields=set(),
                variables={},
                parameter_types={},
                map_template_keys={"variables": {"bad"}},
            )


# =============================================================================
# Type coercion
# =============================================================================


class TestVariableSetterTypeCoercion:
    """Test type coercion and validation in Variable Setter execute()."""

    # --- String to numeric coercion ---

    @pytest.mark.asyncio
    async def test_string_value_coerced_to_float_structured(self):
        """String '3.14' must be coerced to an exact Decimal for a float variable."""
        from decimal import Decimal

        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"pi": "3.14"}},
            "variables": {
                "pi": {"value": 0.0, "scope": "test", "type": "float"},
            },
            "logger": None,
        }

        await control.execute(context)

        result = context["variables"]["pi"]["value"]
        assert result == Decimal("3.14")
        assert isinstance(result, Decimal)

    @pytest.mark.asyncio
    async def test_string_value_coerced_to_integer_structured(self):
        """String '42' must be coerced to int 42 for integer-typed variable."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"count": "42"}},
            "variables": {
                "count": {"value": 0, "scope": "test", "type": "integer"},
            },
            "logger": None,
        }

        await control.execute(context)

        result = context["variables"]["count"]["value"]
        assert result == 42
        assert isinstance(result, int)

    @pytest.mark.asyncio
    async def test_raw_flat_variable_passes_through_without_coercion(self):
        """Raw/flat variables must pass through without coercion.

        Flat variables lost type info during flattening (YAML 0 loads as int
        even for declared-float variables). Pre-execution validation in
        _execute_control handles type safety using declared types.
        """
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"pi": "3.14"}},
            "variables": {"pi": 0.0},
            "logger": None,
        }

        await control.execute(context)

        # String passes through as-is for flat variables
        assert context["variables"]["pi"] == "3.14"

    @pytest.mark.asyncio
    async def test_string_boolean_true_coerced(self):
        """String 'true' must be coerced to bool True."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"flag": "true"}},
            "variables": {
                "flag": {"value": False, "scope": "test", "type": "boolean"},
            },
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["flag"]["value"] is True

    @pytest.mark.asyncio
    async def test_string_boolean_false_coerced(self):
        """String 'false' must be coerced to bool False."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"flag": "false"}},
            "variables": {
                "flag": {"value": True, "scope": "test", "type": "boolean"},
            },
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["flag"]["value"] is False

    # --- int to float widening ---

    @pytest.mark.asyncio
    async def test_int_value_widened_to_float(self):
        """Integer value must be widened to an exact Decimal for a float variable."""
        from decimal import Decimal

        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"rate": 5}},
            "variables": {
                "rate": {"value": 0.0, "scope": "test", "type": "float"},
            },
            "logger": None,
        }

        await control.execute(context)

        result = context["variables"]["rate"]["value"]
        assert result == Decimal("5")
        assert isinstance(result, Decimal)

    # --- float to int narrowing (lossless) ---

    @pytest.mark.asyncio
    async def test_float_value_narrowed_to_int_lossless(self):
        """Float 5.0 must be narrowed to int 5 for integer-typed variable."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"count": 5.0}},
            "variables": {
                "count": {"value": 0, "scope": "test", "type": "integer"},
            },
            "logger": None,
        }

        await control.execute(context)

        result = context["variables"]["count"]["value"]
        assert result == 5
        assert isinstance(result, int)

    # --- Type mismatch errors ---

    @pytest.mark.asyncio
    async def test_string_to_integer_invalid_raises(self):
        """Non-numeric string must raise TypeError for integer variable."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"count": "abc"}},
            "variables": {
                "count": {"value": 0, "scope": "test", "type": "integer"},
            },
            "logger": None,
        }

        with pytest.raises(TypeError, match="cannot convert 'abc' to integer"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_string_to_float_invalid_raises(self):
        """Non-numeric string must raise TypeError for float variable."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"rate": "not_a_number"}},
            "variables": {
                "rate": {"value": 0.0, "scope": "test", "type": "float"},
            },
            "logger": None,
        }

        with pytest.raises(TypeError, match="cannot convert 'not_a_number' to float"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_float_with_fraction_to_integer_raises(self):
        """Float 3.14 must raise TypeError for integer variable (lossy narrowing)."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"count": 3.14}},
            "variables": {
                "count": {"value": 0, "scope": "test", "type": "integer"},
            },
            "logger": None,
        }

        with pytest.raises(TypeError, match="has fractional part"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_string_fraction_to_integer_raises(self):
        """String '3.14' must raise TypeError for integer variable."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"count": "3.14"}},
            "variables": {
                "count": {"value": 0, "scope": "test", "type": "integer"},
            },
            "logger": None,
        }

        with pytest.raises(TypeError, match="has fractional part"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_list_to_string_raises(self):
        """List value must raise TypeError for string variable."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"name": [1, 2, 3]}},
            "variables": {
                "name": {"value": "", "scope": "test", "type": "string"},
            },
            "logger": None,
        }

        with pytest.raises(TypeError, match="cannot assign list value to string"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_string_to_boolean_invalid_raises(self):
        """Invalid boolean string must raise TypeError."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"flag": "maybe"}},
            "variables": {
                "flag": {"value": False, "scope": "test", "type": "boolean"},
            },
            "logger": None,
        }

        with pytest.raises(TypeError, match="cannot convert 'maybe' to boolean"):
            await control.execute(context)

    @pytest.mark.asyncio
    async def test_bool_to_integer_raises(self):
        """Boolean must not be silently converted to integer."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"count": True}},
            "variables": {
                "count": {"value": 0, "scope": "test", "type": "integer"},
            },
            "logger": None,
        }

        with pytest.raises(TypeError, match="cannot assign bool value to integer"):
            await control.execute(context)

    # --- None is always allowed ---

    @pytest.mark.asyncio
    async def test_none_allowed_for_any_type(self):
        """Null is a value of every type, so it is written whatever the declared type."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {
                "variables": {
                    "count": None,
                    "rate": None,
                    "flag": None,
                    "items": None,
                    "config": None,
                }
            },
            "variables": {
                "count": {"value": 42, "scope": "test", "type": "integer"},
                "rate": {"value": 3.14, "scope": "test", "type": "float"},
                "flag": {"value": True, "scope": "test", "type": "boolean"},
                "items": {"value": [1, 2], "scope": "test", "type": "array"},
                "config": {"value": {"k": "v"}, "scope": "test", "type": "map"},
            },
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["count"]["value"] is None
        assert context["variables"]["rate"]["value"] is None
        assert context["variables"]["flag"]["value"] is None
        assert context["variables"]["items"]["value"] is None
        assert context["variables"]["config"]["value"] is None

    # --- Raw value type inference ---

    @pytest.mark.asyncio
    async def test_raw_flat_allows_any_value(self):
        """Raw/flat variables accept any value - type safety is at pre-execution layer."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"flag": "not_bool", "x": 42}},
            "variables": {"flag": True, "x": None},
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["flag"] == "not_bool"
        assert context["variables"]["x"] == 42


# =============================================================================
# Unit tests for _coerce_value and _infer_type
# =============================================================================


class TestCoerceValue:
    """Direct tests for the _coerce_value helper."""

    def test_string_integer_whole_float_string(self):
        """'5.0' must coerce to int 5 for integer type."""
        from wavecore.controls.variable_setter import _coerce_value

        assert _coerce_value("5.0", "integer", "x") == 5
        assert isinstance(_coerce_value("5.0", "integer", "x"), int)

    def test_string_boolean_case_insensitive(self):
        """'True', 'TRUE', 'true' must all coerce to True."""
        from wavecore.controls.variable_setter import _coerce_value

        assert _coerce_value("True", "boolean", "x") is True
        assert _coerce_value("TRUE", "boolean", "x") is True
        assert _coerce_value("False", "boolean", "x") is False

    def test_string_boolean_numeric(self):
        """'1' and '0' must coerce to True and False."""
        from wavecore.controls.variable_setter import _coerce_value

        assert _coerce_value("1", "boolean", "x") is True
        assert _coerce_value("0", "boolean", "x") is False

    def test_passthrough_array(self):
        """List value for array type must pass through unchanged."""
        from wavecore.controls.variable_setter import _coerce_value

        data = [1, 2, 3]
        assert _coerce_value(data, "array", "x") is data

    def test_passthrough_map(self):
        """Dict value for map type must pass through unchanged."""
        from wavecore.controls.variable_setter import _coerce_value

        data = {"a": 1}
        assert _coerce_value(data, "map", "x") is data

    def test_int_to_string_raises(self):
        """Integer must not be silently assigned to string variable."""
        from wavecore.controls.variable_setter import _coerce_value

        with pytest.raises(TypeError, match="cannot assign int value to string"):
            _coerce_value(42, "string", "x")

    def test_dict_to_integer_raises(self):
        """Dict must not be assigned to integer variable."""
        from wavecore.controls.variable_setter import _coerce_value

        with pytest.raises(TypeError, match="cannot assign dict value to integer"):
            _coerce_value({"a": 1}, "integer", "x")


class TestInferType:
    """Direct tests for the _infer_type helper."""

    def test_infer_bool_before_int(self):
        """Bool must be inferred as 'boolean', not 'integer'."""
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type(True) == "boolean"
        assert _infer_type(False) == "boolean"

    def test_infer_int(self):
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type(42) == "integer"

    def test_infer_float(self):
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type(3.14) == "float"

    def test_infer_str(self):
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type("hello") == "string"

    def test_infer_list(self):
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type([1, 2]) == "array"

    def test_infer_dict(self):
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type({"a": 1}) == "map"

    def test_infer_none(self):
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type(None) is None

    def test_is_correct_type_returns_false_for_unknown_type(self):
        """Unknown expected_type returns False from _is_correct_type."""
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type("hello", "unknown_type") is False

    def test_coerce_string_to_scalar_returns_none_for_non_scalar_type(self):
        """Non-scalar expected_type returns None from _coerce_string_to_scalar."""
        from wavecore.controls.variable_setter import _coerce_string_to_scalar

        result = _coerce_string_to_scalar("hello", "array", "my_var")
        assert result is None


# =============================================================================
# Lazy (workbench) expression interaction
#
# A direct write supersedes a pending expression without realizing it.
# =============================================================================


class TestVariableSetterPendingExpression:
    """Setting a name declared as a still-pending expression must supersede it
    via a direct write WITHOUT realizing the expression."""

    @pytest.mark.asyncio
    async def test_set_pending_expression_does_not_realize_it(self):
        """Overwriting a pending expression must not evaluate it as a side
        effect (realizing it fires a stale push that races the write)."""
        from wavecore.api.services.workbench.lazy_variables import LazyVariables
        from wavecore.controls.variable_setter import VariableSetterControl

        realized: list[tuple[str, Any]] = []
        lazy = LazyVariables(
            {},
            expr_map={"s1": ('"123"', "string")},
            on_evaluated=lambda name, value: realized.append((name, value)),
        )
        context: dict[str, Any] = {
            "parameters": {"variables": {"s1": "new value!"}},
            "variables": lazy,
            "logger": None,
        }

        await VariableSetterControl().execute(context)

        assert realized == []
        assert lazy["s1"] == "new value!"
        assert "s1" not in set(lazy.pending_expression_names())

    @pytest.mark.asyncio
    async def test_set_realized_lazy_variable_still_updates(self):
        """A literal (already realized) lazy variable still updates normally and
        is unaffected by the pending-expression guard."""
        from wavecore.api.services.workbench.lazy_variables import LazyVariables
        from wavecore.controls.variable_setter import VariableSetterControl

        realized: list[tuple[str, Any]] = []
        lazy = LazyVariables(
            {"greeting": "old"},
            on_evaluated=lambda name, value: realized.append((name, value)),
        )
        context: dict[str, Any] = {
            "parameters": {"variables": {"greeting": "fresh"}},
            "variables": lazy,
            "logger": None,
        }

        await VariableSetterControl().execute(context)

        assert lazy["greeting"] == "fresh"
        assert realized == []


class TestVariableSetterFloatExactPrecision:
    """Setting a float variable keeps it in the exact-precision domain
    (REQ-3.1.3.14): coercion produces a Decimal, never a lossy float."""

    def test_coerce_string_to_float_is_exact(self) -> None:
        from decimal import Decimal

        from wavecore.controls.variable_setter import _coerce_string_to_float

        result = _coerce_string_to_float("-2123.123213123123699999", "v")
        assert result == Decimal("-2123.123213123123699999")
        assert isinstance(result, Decimal)

    def test_coerce_dotless_string_to_float(self) -> None:
        from decimal import Decimal

        from wavecore.controls.variable_setter import _coerce_string_to_float

        result = _coerce_string_to_float("123", "v")
        assert result == Decimal("123")
        assert isinstance(result, Decimal)

    def test_coerce_string_to_integer_keeps_every_digit(self) -> None:
        from wavecore.controls.variable_setter import _coerce_string_to_integer

        result = _coerce_string_to_integer("12345678901234567890", "v")
        assert result == 12345678901234567890
        assert _coerce_string_to_integer("-99999999999999999999.0", "v") == -(10**20 - 1)

    @pytest.mark.parametrize(
        ("text", "number"),
        [(" 30 ", 30), ("5.0", 5), ("1e3", 1000), ("1_000", 1000), ("+7", 7)],
        ids=["spaces", "whole-decimal", "exponent", "underscore", "plus"],
    )
    def test_coerce_string_to_integer_keeps_its_run_time_reading(
        self, text: str, number: int
    ) -> None:
        from wavecore.controls.variable_setter import _coerce_string_to_integer

        assert _coerce_string_to_integer(text, "v") == number

    @pytest.mark.parametrize("text", ["abc", "nan", "inf", "-Infinity", "1e5000"])
    def test_coerce_string_to_integer_refuses_what_is_no_whole_number(self, text: str) -> None:
        from wavecore.controls.variable_setter import _coerce_string_to_integer

        with pytest.raises(TypeError, match=f"^Variable 'v': cannot convert '{text}' to integer$"):
            _coerce_string_to_integer(text, "v")

    def test_coerce_string_to_integer_refuses_a_fraction(self) -> None:
        from wavecore.controls.variable_setter import _coerce_string_to_integer

        with pytest.raises(
            TypeError,
            match=r"^Variable 'v': cannot convert '3\.14' to integer \(has fractional part\)$",
        ):
            _coerce_string_to_integer("3.14", "v")

    def test_coerce_string_to_float_invalid_still_raises(self) -> None:
        from wavecore.controls.variable_setter import _coerce_string_to_float

        with pytest.raises(TypeError, match="^Variable 'v': cannot convert 'abc' to float$"):
            _coerce_string_to_float("abc", "v")

    @pytest.mark.parametrize("text", ["NaN", "sNaN", "Infinity", "-inf"])
    def test_coerce_string_to_float_refuses_what_is_no_number(self, text: str) -> None:
        from wavecore.controls.variable_setter import _coerce_string_to_float

        with pytest.raises(TypeError, match=f"^Variable 'v': cannot convert '{text}' to float$"):
            _coerce_string_to_float(text, "v")

    @pytest.mark.parametrize(
        ("value", "expected_type", "shown"),
        [
            (float("nan"), "float", "nan"),
            (float("inf"), "float", "inf"),
            (float("-inf"), "integer", "-inf"),
            (float("nan"), "integer", "nan"),
            (Decimal("NaN"), "float", "NaN"),
            (Decimal("-Infinity"), "float", "-Infinity"),
        ],
        ids=[
            "nan",
            "infinity",
            "minus-infinity-for-integer",
            "nan-for-integer",
            "decimal-nan",
            "decimal-minus-infinity",
        ],
    )
    def test_coerce_value_refuses_a_number_that_is_not_finite(
        self, value: float | Decimal, expected_type: str, shown: str
    ) -> None:
        from wavecore.controls.variable_setter import _coerce_value

        with pytest.raises(
            TypeError, match=f"^Variable 'v': cannot convert {shown} to {expected_type}$"
        ):
            _coerce_value(value, expected_type, "v")

    def test_coerce_value_string_to_float_is_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.controls.variable_setter import _coerce_value

        result = _coerce_value("123", "float", "v")
        assert result == Decimal("123")
        assert isinstance(result, Decimal)

    def test_coerce_value_native_float_becomes_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.controls.variable_setter import _coerce_value

        result = _coerce_value(1.5, "float", "v")
        assert result == Decimal("1.5")
        assert isinstance(result, Decimal)

    def test_coerce_value_decimal_passes_through_exact(self) -> None:
        from decimal import Decimal

        from wavecore.controls.variable_setter import _coerce_value

        result = _coerce_value(Decimal("1.0000000000000000001"), "float", "v")
        assert result == Decimal("1.0000000000000000001")
        assert isinstance(result, Decimal)

    def test_is_correct_type_float_accepts_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type(Decimal("1.5"), "float") is True


# =============================================================================
# Table assignment (REQ-3.4.1.14)
#
# A table variable can hold either runtime form: a Table produced by a
# converter plugin, or the stored form of a variable declared in the Variable
# Manager.
# =============================================================================


def _orders_table() -> Table:
    """A table as a converter plugin's output binding supplies it."""
    table = Table(columns=[("sku", "string"), ("qty", "integer")])
    table.add_row(["A-1", 3])
    table.add_row(["B-2", 7])
    return table


class TestVariableSetterTableTypeCheck:
    """_is_correct_type recognizes every runtime form of a table."""

    def test_live_table_is_a_table(self) -> None:
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type(_orders_table(), "table") is True

    def test_empty_live_table_is_a_table(self) -> None:
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type(Table(), "table") is True

    def test_stored_list_form_is_a_table(self) -> None:
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type([{"sku": "A-1", "qty": 3}], "table") is True

    def test_stored_dict_form_is_a_table(self) -> None:
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type(_orders_table().to_dict(), "table") is True

    def test_string_is_not_a_table(self) -> None:
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type("orders", "table") is False

    def test_integer_is_not_a_table(self) -> None:
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type(42, "table") is False

    def test_array_of_scalars_is_not_a_table(self) -> None:
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type([1, 2, 3], "table") is False

    def test_table_is_not_an_array(self) -> None:
        """array and table are distinct types."""
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type(_orders_table(), "array") is False

    def test_array_still_accepts_a_list(self) -> None:
        from wavecore.controls.variable_setter import _is_correct_type

        assert _is_correct_type([1, 2, 3], "array") is True


class TestVariableSetterTableInference:
    """_infer_type reports 'table' for a Table and leaves array/map alone."""

    def test_infer_table(self) -> None:
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type(_orders_table()) == "table"

    def test_infer_empty_table(self) -> None:
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type(Table()) == "table"

    def test_infer_list_is_still_array(self) -> None:
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type([{"sku": "A-1"}]) == "array"

    def test_infer_dict_is_still_map(self) -> None:
        from wavecore.controls.variable_setter import _infer_type

        assert _infer_type({"sku": "A-1"}) == "map"


class TestVariableSetterTableCoercion:
    """_coerce_value passes a table through and rejects a non-table."""

    def test_live_table_passes_through_unchanged(self) -> None:
        from wavecore.controls.variable_setter import _coerce_value

        table = _orders_table()
        assert _coerce_value(table, "table", "orders") is table

    def test_stored_list_form_passes_through_unchanged(self) -> None:
        from wavecore.controls.variable_setter import _coerce_value

        stored = [{"sku": "A-1", "qty": 3}]
        assert _coerce_value(stored, "table", "orders") is stored

    def test_string_to_table_raises_exact_message(self) -> None:
        from wavecore.controls.variable_setter import _coerce_value

        with pytest.raises(
            TypeError, match="^Variable 'orders': cannot assign str value to table variable$"
        ):
            _coerce_value("orders", "table", "orders")

    def test_integer_to_table_raises_exact_message(self) -> None:
        from wavecore.controls.variable_setter import _coerce_value

        with pytest.raises(
            TypeError, match="^Variable 'orders': cannot assign int value to table variable$"
        ):
            _coerce_value(42, "table", "orders")

    def test_table_to_array_raises_exact_message(self) -> None:
        from wavecore.controls.variable_setter import _coerce_value

        with pytest.raises(
            TypeError, match="^Variable 'rows': cannot assign Table value to array variable$"
        ):
            _coerce_value(_orders_table(), "array", "rows")

    def test_none_clears_a_table_variable(self) -> None:
        from wavecore.controls.variable_setter import _coerce_value

        assert _coerce_value(None, "table", "orders") is None


class TestVariableSetterTableExecution:
    """Storing a table through the control, end to end."""

    @pytest.mark.asyncio
    async def test_stores_a_plugin_produced_table(self) -> None:
        from wavecore.controls.variable_setter import VariableSetterControl

        table = _orders_table()
        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"orders": table}},
            "variables": {"orders": {"value": None, "scope": "test", "type": "table"}},
            "logger": None,
        }

        await control.execute(context)

        stored = context["variables"]["orders"]["value"]
        assert isinstance(stored, Table)
        assert stored.to_list() == [{"sku": "A-1", "qty": 3}, {"sku": "B-2", "qty": 7}]

    @pytest.mark.asyncio
    async def test_stores_a_filtered_table(self) -> None:
        """Storing a derived table is the second half of read-then-work-on-it."""
        from wavecore.controls.variable_setter import VariableSetterControl

        filtered = _orders_table().filter("qty").greater_than(5)
        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"big_orders": filtered}},
            "variables": {"big_orders": {"value": None, "scope": "test", "type": "table"}},
            "logger": None,
        }

        await control.execute(context)

        stored = context["variables"]["big_orders"]["value"]
        assert isinstance(stored, Table)
        assert stored.to_list() == [{"sku": "B-2", "qty": 7}]

    @pytest.mark.asyncio
    async def test_stores_a_stored_form_table(self) -> None:
        """A table declared in the Variable Manager still assigns."""
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"orders": [{"sku": "A-1", "qty": 3}]}},
            "variables": {"orders": {"value": None, "scope": "test", "type": "table"}},
            "logger": None,
        }

        await control.execute(context)

        assert context["variables"]["orders"]["value"] == [{"sku": "A-1", "qty": 3}]

    @pytest.mark.asyncio
    async def test_string_to_table_variable_raises_exact_message(self) -> None:
        from wavecore.controls.variable_setter import VariableSetterControl

        control = VariableSetterControl()
        context: dict[str, Any] = {
            "parameters": {"variables": {"orders": "A-1"}},
            "variables": {"orders": {"value": None, "scope": "test", "type": "table"}},
            "logger": None,
        }

        with pytest.raises(
            TypeError, match="^Variable 'orders': cannot assign str value to table variable$"
        ):
            await control.execute(context)
