"""
Unit tests for PluginExecutor utility.

Tests requirements:
- REQ-3.4.2.8: Interactive plugin testing interface (backend support)
"""

import datetime
import json
import re
import time
from typing import Any

import pytest
import yaml

from wavecore.core.table import Table


class TestPluginExecutor:
    """Test suite for PluginExecutor utility."""

    @pytest.mark.asyncio
    async def test_execute_plugin_standalone(self):
        """Test executing a plugin in standalone mode."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        class TestPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "test-plugin",
                    "name": "Test Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": "string",
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return "test result"

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = TestPlugin()
        result = await execute_plugin(plugin, {})

        assert result["status"] == "success"
        assert result["return_value"] == "test result"
        assert "duration" in result
        assert result["error"] is None

    @pytest.mark.asyncio
    async def test_execute_plugin_with_parameters(self):
        """Test executing plugin with parameters."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        class ParamPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "param-plugin",
                    "name": "Param Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [{"name": "value", "type": "string", "required": True}],
                    "return_type": "string",
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                params = context["parameters"]
                return f"Received: {params['value']}"

            async def validate(self, params: dict[str, Any]) -> None:
                if "value" not in params:
                    raise ValueError("Missing required parameter: value")

        plugin = ParamPlugin()
        result = await execute_plugin(plugin, {"value": "test_value"})

        assert result["status"] == "success"
        assert result["return_value"] == "Received: test_value"

    @pytest.mark.asyncio
    async def test_execute_plugin_with_logger(self):
        """Test that plugin receives a logger in context."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        class LoggingPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "logging-plugin",
                    "name": "Logging Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                logger = context.get("logger")
                assert logger is not None
                logger.info("Plugin log message")
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = LoggingPlugin()
        result = await execute_plugin(plugin, {})

        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_execute_plugin_with_log_level(self):
        """Test that plugin logger respects log level threshold."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.models.enums import LogLevel
        from wavecore.plugins.base import PluginBase

        class ThresholdPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "threshold-plugin",
                    "name": "Threshold Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                logger = context.get("logger")
                # Verify logger has threshold attribute
                assert hasattr(logger, "threshold")
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = ThresholdPlugin()
        # Execute with WARN threshold
        result = await execute_plugin(plugin, {}, log_level=LogLevel.WARN)

        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_execute_plugin_calls_initialize(self):
        """Test that initialize is called before execute."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        class InitPlugin(PluginBase):
            def __init__(self):
                self.init_called = False

            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "init-plugin",
                    "name": "Init Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": "boolean",
                }

            async def initialize(self, context: dict[str, Any]) -> None:
                self.init_called = True

            async def execute(self, context: dict[str, Any]) -> Any:
                return self.init_called

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = InitPlugin()
        result = await execute_plugin(plugin, {})

        assert result["status"] == "success"
        assert result["return_value"] is True  # init was called

    @pytest.mark.asyncio
    async def test_execute_plugin_calls_cleanup(self):
        """Test that cleanup is called after execute."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        cleanup_state = {"called": False}

        class CleanupPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "cleanup-plugin",
                    "name": "Cleanup Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def cleanup(self) -> None:
                cleanup_state["called"] = True

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = CleanupPlugin()
        await execute_plugin(plugin, {})

        assert cleanup_state["called"] is True

    @pytest.mark.asyncio
    async def test_execute_plugin_cleanup_on_error(self):
        """Test that cleanup is called even if execute fails."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        cleanup_state = {"called": False}

        class ErrorPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "error-plugin",
                    "name": "Error Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                raise RuntimeError("Intentional error")

            async def cleanup(self) -> None:
                cleanup_state["called"] = True

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = ErrorPlugin()
        result = await execute_plugin(plugin, {})

        assert result["status"] == "error"
        assert "Intentional error" in result["error"]
        assert cleanup_state["called"] is True

    @pytest.mark.asyncio
    async def test_execute_plugin_cleanup_error_after_success(self):
        """Test that cleanup errors are caught and reported after successful execution."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        class CleanupErrorPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "cleanup-error",
                    "name": "Cleanup Error",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": "string",
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return "success"

            async def cleanup(self) -> None:
                raise RuntimeError("Cleanup failed")

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = CleanupErrorPlugin()
        result = await execute_plugin(plugin, {})

        assert result["status"] == "error"
        assert "Cleanup failed" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_plugin_validation_error(self):
        """Test that validation errors are caught and returned."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        class ValidatingPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "validating-plugin",
                    "name": "Validating Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [{"name": "required", "type": "string", "required": True}],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                if "required" not in params:
                    raise ValueError("Missing required parameter")

        plugin = ValidatingPlugin()
        result = await execute_plugin(plugin, {})  # Missing required param

        assert result["status"] == "error"
        assert "Missing required parameter" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_plugin_returns_duration(self):
        """Test that execution duration is measured and returned."""
        import asyncio

        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        class SlowPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "slow-plugin",
                    "name": "Slow Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                await asyncio.sleep(0.1)  # 100ms
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = SlowPlugin()
        result = await execute_plugin(plugin, {})

        assert result["status"] == "success"
        assert result["duration"] >= 0.1  # At least 100ms
        assert result["duration"] < 1.0  # But not too long

    @pytest.mark.asyncio
    async def test_execute_plugin_with_variables(self):
        """Test that execution context includes variables scope."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        class VariablePlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "variable-plugin",
                    "name": "Variable Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": "string",
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                variables = context.get("variables", {})
                return variables.get("test_var", "not found")

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = VariablePlugin()
        result = await execute_plugin(plugin, {}, variables={"test_var": "test_value"})

        assert result["status"] == "success"
        assert result["return_value"] == "test_value"

    @pytest.mark.asyncio
    async def test_default_log_level_is_debug_for_testing(self):
        """Test that default log level is DEBUG for plugin testing/development."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.models.enums import LogLevel
        from wavecore.plugins.base import PluginBase

        class LevelCheckPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "level-check",
                    "name": "Level Check",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": "string",
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                logger = context.get("logger")
                return logger.threshold

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = LevelCheckPlugin()
        result = await execute_plugin(plugin, {})

        assert result["status"] == "success"
        # Default for testing should be DEBUG (most permissive)
        assert result["return_value"] == LogLevel.DEBUG


class TestPluginExecutorContextCreation:
    """Test suite for execution context creation."""

    @pytest.mark.asyncio
    async def test_context_contains_required_fields(self):
        """Test that execution context contains all required fields."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        captured_context = {}

        class ContextPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "context-plugin",
                    "name": "Context Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                captured_context.update(context)
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = ContextPlugin()
        await execute_plugin(plugin, {"param1": "value1"})

        # Verify required context fields
        assert "parameters" in captured_context
        assert "logger" in captured_context
        assert "variables" in captured_context
        assert captured_context["parameters"]["param1"] == "value1"

    @pytest.mark.asyncio
    async def test_context_parameters_isolated_from_variables(self):
        """Test that parameters and variables are separate in context."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        captured_context = {}

        class IsolationPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "isolation-plugin",
                    "name": "Isolation Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                captured_context.update(context)
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = IsolationPlugin()
        await execute_plugin(
            plugin, {"param_key": "param_value"}, variables={"var_key": "var_value"}
        )

        # Verify separation
        assert captured_context["parameters"]["param_key"] == "param_value"
        assert captured_context["variables"]["var_key"] == "var_value"
        assert "param_key" not in captured_context["variables"]
        assert "var_key" not in captured_context["parameters"]

    @pytest.mark.asyncio
    async def test_no_variables_reach_the_plugin_as_an_empty_map(self):
        """A run given variables=None hands the plugin an empty variables map."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        captured_context = {}

        class NoVariablesPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "no-variables-plugin",
                    "name": "No Variables Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                captured_context.update(context)
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        await execute_plugin(plugin=NoVariablesPlugin(), parameters={}, variables=None)

        assert captured_context["variables"] == {}


class TestPluginVariableCapture:
    """Test suite for plugin variable capture in execution context."""

    @pytest.mark.asyncio
    async def test_plugin_can_set_variables(self):
        """Test that plugins can set new variables in context."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        variables = {"initial": "value"}

        class SetterPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "setter-plugin",
                    "name": "Setter Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                # Plugin sets a new variable at top level
                context["new_var"] = "new_value"
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = SetterPlugin()
        await execute_plugin(plugin, {}, variables=variables)

        # Variable should be captured in variables dict
        assert "new_var" in variables
        assert variables["new_var"] == "new_value"

    @pytest.mark.asyncio
    async def test_parameters_passed_through_without_evaluation(self):
        """Test parameters are passed through to plugin unchanged (no expression evaluation)."""
        from wavecore.core.execution.plugin_executor import execute_plugin
        from wavecore.plugins.base import PluginBase

        captured_params = {}

        class CapturePlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "capture-plugin",
                    "name": "Capture Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Test",
                    "parameters": [],
                    "return_type": None,
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                captured_params.update(context["parameters"])
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        plugin = CapturePlugin()
        # Parameters are passed through to plugin as-is
        # (no expression evaluation in standalone executor)
        await execute_plugin(
            plugin,
            {"message": "Hello World!", "count": 42, "enabled": True},
            variables={"name": "World"},
        )

        assert captured_params["message"] == "Hello World!"
        assert captured_params["count"] == 42
        assert captured_params["enabled"] is True


class TestResolveParameters:
    """Test suite for resolve_parameters() - new expression-based parameter resolution."""

    def test_literal_params_pass_through(self):
        """Non-expression params are returned unchanged."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"url": "https://example.com", "timeout": 5000}
        result = resolve_parameters(params, set(), {"x": 1}, {})
        assert result == {"url": "https://example.com", "timeout": 5000}

    def test_expression_field_evaluated(self):
        """Params in expression_fields are evaluated as Python."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"timeout": "base * 2"}
        variables = {"base": 500}
        result = resolve_parameters(params, {"timeout"}, variables, {"timeout": "integer"})
        assert result == {"timeout": 1000}

    def test_expression_type_checked(self):
        """Expression result type must match declared parameter type."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import ExpressionTypeError

        params = {"timeout": "'hello'"}
        with pytest.raises(ExpressionTypeError):
            resolve_parameters(params, {"timeout"}, {}, {"timeout": "integer"})

    def test_non_expression_string_not_evaluated(self):
        """String params NOT in expression_fields are left as-is."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"url": "x + 1"}
        result = resolve_parameters(params, set(), {"x": 1}, {})
        assert result == {"url": "x + 1"}

    def test_empty_expression_resolves_to_none(self):
        """Empty expression string resolves to None (no value provided)."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"level": ""}
        result = resolve_parameters(params, {"level"}, {}, {"level": "string"})
        assert result == {"level": None}

    def test_reference_field_resolves_named_variable(self):
        """A reference field's value names a variable; it resolves to that value."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.table import Table

        table = Table(columns=[("id", "integer")])
        table.add_row([1])
        params = {"table": "my_tab"}
        result = resolve_parameters(
            params, set(), {"my_tab": table}, {"table": "table"}, reference_fields={"table"}
        )
        assert result["table"] is table

    def test_reference_field_type_checked(self):
        """A reference resolving to the wrong type raises ExpressionTypeError."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import ExpressionTypeError

        params = {"table": "not_a_table"}
        with pytest.raises(ExpressionTypeError):
            resolve_parameters(
                params,
                set(),
                {"not_a_table": "hello"},
                {"table": "table"},
                reference_fields={"table"},
            )

    def test_reference_field_non_string_passes_through(self):
        """A reference field already holding the object (not a name) is unchanged."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.table import Table

        table = Table(columns=[("id", "integer")])
        params = {"table": table}
        result = resolve_parameters(
            params, set(), {}, {"table": "table"}, reference_fields={"table"}
        )
        assert result["table"] is table

    def test_whitespace_expression_resolves_to_none(self):
        """Whitespace-only expression string resolves to None."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"level": "   "}
        result = resolve_parameters(params, {"level"}, {}, {"level": "string"})
        assert result == {"level": None}

    def test_expression_with_f_string(self):
        """F-strings work as expressions."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"url": "f'http://{host}:{port}/api'"}
        variables = {"host": "localhost", "port": 8080}
        result = resolve_parameters(params, {"url"}, variables, {"url": "string"})
        assert result == {"url": "http://localhost:8080/api"}

    def test_expression_preserves_dict_result(self):
        """Dict expressions return actual dicts."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"headers": "{'Authorization': 'Bearer ' + token}"}
        variables = {"token": "abc123"}
        result = resolve_parameters(params, {"headers"}, variables, {"headers": "map"})
        assert result == {"headers": {"Authorization": "Bearer abc123"}}

    def test_expression_preserves_list_result(self):
        """List expressions return actual lists."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"items": "[x * 2 for x in numbers]"}
        variables = {"numbers": [1, 2, 3]}
        result = resolve_parameters(params, {"items"}, variables, {"items": "array"})
        assert result == {"items": [2, 4, 6]}

    def test_mixed_literal_and_expression(self):
        """Mix of literal and expression params."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"url": "https://static.com", "timeout": "base * retry"}
        variables = {"base": 100, "retry": 3}
        result = resolve_parameters(
            params, {"timeout"}, variables, {"url": "string", "timeout": "integer"}
        )
        assert result == {"url": "https://static.com", "timeout": 300}

    def test_non_string_expression_field_skipped(self):
        """If an expression field's value is not a string, pass through as-is."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"timeout": 5000}
        result = resolve_parameters(params, {"timeout"}, {}, {"timeout": "integer"})
        assert result == {"timeout": 5000}

    def test_expression_without_type_check(self):
        """Expression field without entry in parameter_types skips type check."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        params = {"custom": "42"}
        result = resolve_parameters(params, {"custom"}, {}, {})
        assert result == {"custom": 42}


class TestEvaluateExpression:
    """Test suite for evaluate_expression() - public expression evaluation entry point."""

    def test_simple_variable(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("x", {"x": 42})
        assert result == 42

    def test_arithmetic(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("x + y", {"x": 10, "y": 20})
        assert result == 30

    def test_method_call(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("name.upper()", {"name": "hello"})
        assert result == "HELLO"

    def test_f_string(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("f'Hello {name}'", {"name": "World"})
        assert result == "Hello World"

    def test_a_float_in_an_f_string_or_str_is_written_in_plain_digits(self) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.variables.decimal_value import WaveDecimal

        variables = {"tiny": WaveDecimal("0.0000001")}

        assert evaluate_expression("f'tiny={tiny}'", variables) == "tiny=0.0000001"
        assert evaluate_expression("str(tiny)", variables) == "0.0000001"

    def test_blocked_expression_raises(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError):
            evaluate_expression("__import__('os')", {})

    def test_undefined_variable_raises(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError, UndefinedVariableError

        with pytest.raises((UndefinedVariableError, InvalidExpressionError)):
            evaluate_expression("unknown_var", {})

    def test_list_comprehension(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("[x * 2 for x in items]", {"items": [1, 2, 3]})
        assert result == [2, 4, 6]

    def test_dict_literal(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("{'key': val}", {"val": 42})
        assert result == {"key": 42}

    def test_boolean_logic(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("a and b", {"a": True, "b": False})
        assert result is False

    def test_string_methods_chained(self):
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("s.strip().upper()", {"s": "  hello  "})
        assert result == "HELLO"

    def test_walrus_operator_rejected(self):
        """Test that walrus operator := is rejected."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match=":="):
            evaluate_expression("(x := 5)", {})

    def test_assignment_statement_rejected(self):
        """Test that assignment statements are rejected."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match="Assignment statements not allowed"):
            evaluate_expression("x = 1", {})

    def test_equality_comparison_allowed(self):
        """Test that equality comparison is allowed (not blocked as assignment)."""
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression("x == 1", {"x": 1})
        assert result is True

    def test_dict_format_variable_resolved(self):
        """Test that dict-format variables pass through without unwrapping."""
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression(
            "x",
            {"x": {"value": 32, "type": "integer", "scope": "test"}},
        )
        assert result == {"value": 32, "type": "integer", "scope": "test"}

    def test_table_from_list_format(self):
        """Test that Table variables passed directly work in expressions."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.table import Table

        table = Table.from_list(
            [
                {"name": "Alice", "age": 30},
                {"name": "Bob", "age": 25},
            ]
        )
        result = evaluate_expression(
            "t1.row_count()",
            {"t1": table},
        )
        assert result == 2

    def test_table_from_dict_format(self):
        """Test that Table variables from dict format work in expressions."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.table import Table

        table = Table.from_dict(
            {
                "columns": [
                    {"name": "id", "type": "integer"},
                    {"name": "name", "type": "string"},
                ],
                "rows": [
                    [1, "Alice"],
                    [2, "Bob"],
                ],
            }
        )
        result = evaluate_expression(
            "t1.col_count()",
            {"t1": table},
        )
        assert result == 2

    def test_table_instance_passed_through(self):
        """Test that existing Table instances are passed through unchanged."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.table import Table

        table = Table([("x", "integer"), ("y", "integer")])
        table.add_row([1, 2])
        table.add_row([3, 4])

        result = evaluate_expression(
            "t1.row_count()",
            {"t1": table},
        )
        assert result == 2

    def test_non_table_dict_value_passed_through(self):
        """Test that dict-format variables pass through without unwrapping."""
        from wavecore.core.execution.plugin_executor import evaluate_expression

        result = evaluate_expression(
            "x",
            {"x": {"value": "hello", "type": "string", "scope": "test"}},
        )
        assert result == {"value": "hello", "type": "string", "scope": "test"}


class TestExtractVariableValueDirect:
    """Direct tests for _extract_variable_value."""

    def test_raw_int_passes_through(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        assert _extract_variable_value(42) == 42

    def test_raw_string_passes_through(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        assert _extract_variable_value("hello") == "hello"

    def test_dict_without_value_key_passes_through(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        d = {"name": "test", "count": 5}
        assert _extract_variable_value(d) == d

    def test_storage_format_unwraps_value(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {"value": 42, "type": "integer", "scope": "test"}
        assert _extract_variable_value(entry) == 42

    def test_storage_format_string_unwraps(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {"value": "hello", "type": "string", "scope": "test"}
        assert _extract_variable_value(entry) == "hello"

    def test_table_from_list_reconstructed(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value
        from wavecore.core.table import Table

        entry = {"value": [{"a": 1}, {"a": 2}], "type": "table"}
        result = _extract_variable_value(entry)
        assert isinstance(result, Table)

    def test_table_from_dict_reconstructed(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value
        from wavecore.core.table import Table

        entry = {
            "value": {"columns": [{"name": "a", "type": "integer"}], "rows": [[1]]},
            "type": "table",
        }
        result = _extract_variable_value(entry)
        assert isinstance(result, Table)

    def test_table_instance_passes_through(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value
        from wavecore.core.table import Table

        t = Table.from_list([{"x": 1}])
        entry = {"value": t, "type": "table"}
        assert _extract_variable_value(entry) is t

    def test_non_table_type_unwraps(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {"value": [1, 2, 3], "type": "array"}
        assert _extract_variable_value(entry) == [1, 2, 3]

    def test_float_string_coerced_to_exact_decimal(self):
        # A float carried as an exact string realizes to an exact Decimal so
        # dict-format seeding matches the shared realize_declared_value path
        # and expression arithmetic stays exact (REQ-3.1.3.14).
        from decimal import Decimal

        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {"value": "-2123.123213123123699999", "type": "float"}
        result = _extract_variable_value(entry)
        assert isinstance(result, Decimal)
        assert result == Decimal("-2123.123213123123699999")
        # Arithmetic with a float operand does not raise (str + float TypeError).
        assert result + 0.01 == Decimal("-2123.113213123123699999")

    def test_float_number_coerced_to_decimal(self):
        from decimal import Decimal

        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {"value": 0.5, "type": "float"}
        result = _extract_variable_value(entry)
        assert isinstance(result, Decimal)
        assert result == Decimal("0.5")

    def test_integer_string_coerced_to_int(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {"value": "1234567890123456789", "type": "integer"}
        result = _extract_variable_value(entry)
        assert result == 1234567890123456789
        assert isinstance(result, int)

    def test_integer_text_past_19_digits_stays_text(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {"value": "123456789012345678901234567890", "type": "integer"}
        assert _extract_variable_value(entry) == "123456789012345678901234567890"

    def test_integer_malformed_string_passes_through(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {"value": "not-an-int", "type": "integer"}
        assert _extract_variable_value(entry) == "not-an-int"

    @pytest.mark.parametrize(
        "declared_type", ["string", "integer", "float", "boolean", "array", "map"]
    )
    def test_a_declaration_with_no_value_resolves_to_null(self, declared_type):
        # A declaration with no value must never reach the run as the dict itself.
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        assert _extract_variable_value({"type": declared_type}) is None

    def test_a_table_declaration_with_no_value_resolves_to_null(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        assert _extract_variable_value({"type": "table"}) is None

    def test_a_secret_declaration_with_no_value_resolves_to_null(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        assert _extract_variable_value({"type": "string", "secret": True}) is None

    def test_stored_empty_string_stays_a_value(self):
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        assert _extract_variable_value({"type": "string", "value": ""}) == ""

    def test_map_elements_realize_their_declared_types(self):
        # REQ-3.1.3.19: the stored sidecar decides each element's run-time type.
        from wavecore.core.execution.plugin_executor import _extract_variable_value

        entry = {
            "value": {"n": "16", "zip": "02134"},
            "type": "map",
            "elementTypes": {"n": "integer", "zip": "string"},
        }
        assert _extract_variable_value(entry) == {"n": 16, "zip": "02134"}


class TestResolveParametersMutationBlocking:
    """Tests for mutation blocking in resolve_parameters (field expressions are read-only)."""

    def test_blocks_mutating_method_in_field_expression(self):
        """resolve_parameters blocks list.append() in field expressions."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError) as exc_info:
            resolve_parameters(
                parameters={"cmd": "my_list.append(1)"},
                expression_fields={"cmd"},
                variables={"my_list": [1, 2, 3]},
                parameter_types={"cmd": "array"},
            )
        assert "append" in str(exc_info.value)

    def test_blocks_sort_in_field_expression(self):
        """resolve_parameters blocks list.sort() in field expressions."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError):
            resolve_parameters(
                parameters={"cmd": "my_list.sort()"},
                expression_fields={"cmd"},
                variables={"my_list": [3, 1, 2]},
                parameter_types={"cmd": "array"},
            )

    def test_blocks_dict_update_in_field_expression(self):
        """resolve_parameters blocks dict.update() in field expressions."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError):
            resolve_parameters(
                parameters={"cfg": 'my_dict.update({"a": 1})'},
                expression_fields={"cfg"},
                variables={"my_dict": {"x": 1}},
                parameter_types={"cfg": "map"},
            )

    def test_blocks_list_constructor_in_field_expression(self):
        """resolve_parameters blocks list() constructor in field expressions."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError) as exc_info:
            resolve_parameters(
                parameters={"cmd": "list(range(10))"},
                expression_fields={"cmd"},
                variables={},
                parameter_types={"cmd": "array"},
            )
        assert "list" in str(exc_info.value)

    def test_allows_non_mutating_method(self):
        """resolve_parameters allows str.upper() in field expressions."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"cmd": "my_str.upper()"},
            expression_fields={"cmd"},
            variables={"my_str": "hello"},
            parameter_types={"cmd": "string"},
        )
        assert result["cmd"] == "HELLO"

    def test_allows_sorted_builtin(self):
        """resolve_parameters allows sorted() in field expressions (returns new list)."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"cmd": "sorted(my_list)"},
            expression_fields={"cmd"},
            variables={"my_list": [3, 1, 2]},
            parameter_types={"cmd": "array"},
        )
        assert result["cmd"] == [1, 2, 3]

    def test_literal_params_not_checked_for_mutations(self):
        """Non-expression fields are not checked for mutations."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"cmd": "my_list.append(1)"},
            expression_fields=set(),  # Not an expression field
            variables={},
            parameter_types={},
        )
        assert result["cmd"] == "my_list.append(1)"  # Passed through as string

    def test_check_field_mutations_handles_syntax_error(self):
        """_check_field_mutations returns None for invalid syntax (caught elsewhere)."""
        from wavecore.core.execution.plugin_executor import _check_field_mutations

        # Invalid Python syntax - should return None (not raise)
        result = _check_field_mutations("def foo(:")
        assert result is None


class TestResolveParametersTemplateFields:
    """Tests for resolve_parameters with template_fields ({{expr}} syntax)."""

    def test_template_field_evaluates_markers(self):
        """Template fields have their {{expr}} markers resolved."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"body": "Hello {{name}}!"},
            expression_fields=set(),
            variables={"name": "Alice"},
            parameter_types={},
            template_fields={"body"},
        )
        assert result["body"] == "Hello Alice!"

    def test_template_field_whitespace_only_marker_unchanged(self):
        """{{ }} (whitespace only) is left as-is by template evaluation."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"body": "empty: {{ }}"},
            expression_fields=set(),
            variables={},
            parameter_types={},
            template_fields={"body"},
        )
        assert result["body"] == "empty: {{ }}"

    def test_template_field_mixed_with_literal(self):
        """Template and literal fields coexist correctly."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"body": "Hi {{name}}", "url": "http://example.com"},
            expression_fields=set(),
            variables={"name": "Bob"},
            parameter_types={},
            template_fields={"body"},
        )
        assert result["body"] == "Hi Bob"
        assert result["url"] == "http://example.com"

    def test_non_string_template_field_passes_through(self):
        """Non-string values in template_fields pass through as literals."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"body": 42},
            expression_fields=set(),
            variables={},
            parameter_types={},
            template_fields={"body"},
        )
        assert result["body"] == 42


class TestDecimalExpressionEvaluation:
    """Float expressions stay exact when an operand is a Decimal (REQ-3.1.3.14)."""

    def test_float_expression_with_decimal_operand_is_exact(self) -> None:
        from decimal import Decimal

        from wavecore.core.execution.plugin_executor import _evaluate_expression
        from wavecore.core.variables.decimal_value import WaveDecimal

        result = _evaluate_expression("price * 1.08", {"price": WaveDecimal("19.99")})
        assert result == Decimal("21.5892")

    def test_float_addition_with_decimal_operand_is_exact(self) -> None:
        from decimal import Decimal

        from wavecore.core.execution.plugin_executor import _evaluate_expression
        from wavecore.core.variables.decimal_value import WaveDecimal

        result = _evaluate_expression("base + 0.2", {"base": WaveDecimal("0.1")})
        assert result == Decimal("0.3")


class TestDecimalParameterDownCoercion:
    """A float-typed Decimal parameter is reduced to a plain float at the plugin
    call edge: plugins are double-precision domains and a Decimal breaks
    any plugin that JSON-serializes its parameters."""

    def test_single_parameter_down_coerces_float_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.core.execution.plugin_executor import _resolve_single_parameter

        result = _resolve_single_parameter(
            "factor", Decimal("1.5"), set(), set(), {}, {"factor": "float"}
        )
        assert result == 1.5
        assert type(result) is float

    def test_resolve_parameters_down_coerces_float_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"factor": Decimal("1.5")},
            expression_fields=set(),
            variables={},
            parameter_types={"factor": "float"},
        )
        assert result["factor"] == 1.5
        assert type(result["factor"]) is float


class TestTypedValueSettingsReachThePluginInPlatformNumbers:
    """A typed-values setting reaches the plugin in platform numbers however its value
    was written: literal rows, a per-entry expression or a whole-row expression such as
    a bound profile's field (REQ-3.1.3.19, REQ-3.1.3.14 plugin boundary)."""

    def test_the_typed_value_fields_are_the_fields_declaring_typed_values(self) -> None:
        from wavecore.core.execution.plugin_executor import typed_value_fields

        fields = [
            {"name": "driver_options", "type": "map", "typed_values": True},
            {"name": "parameters", "type": "map"},
        ]
        assert typed_value_fields(fields) == {"driver_options"}

    def test_an_empty_field_list_declares_none(self) -> None:
        from wavecore.core.execution.plugin_executor import typed_value_fields

        assert typed_value_fields([]) == set()

    def test_a_whole_row_expression_of_exact_decimals_reduces_at_every_depth(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.variables.decimal_value import WaveDecimal

        options = {"timeout": WaveDecimal("16.5"), "nested": [WaveDecimal("0.5")], "n": 16}
        result = resolve_parameters(
            {"driver_options": "opts"},
            {"driver_options"},
            {"opts": options},
            {"driver_options": "map"},
            typed_value_fields={"driver_options"},
        )
        assert result["driver_options"] == {"timeout": 16.5, "nested": [0.5], "n": 16}
        assert type(result["driver_options"]["timeout"]) is float
        assert type(result["driver_options"]["nested"][0]) is float
        assert type(options["timeout"]) is WaveDecimal

    def test_an_entry_expression_of_an_exact_decimal_reduces(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.variables.decimal_value import WaveDecimal

        result = resolve_parameters(
            {"driver_options": {"timeout": "wait + 10", "app": "2024"}},
            {"driver_options.timeout"},
            {"wait": WaveDecimal("6.5")},
            {"driver_options": "map"},
            map_expression_keys={"driver_options": {"timeout"}},
            typed_value_fields={"driver_options"},
        )
        assert result["driver_options"] == {"timeout": 16.5, "app": "2024"}
        assert type(result["driver_options"]["timeout"]) is float

    def test_a_literal_typed_row_reduces(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.variables.decimal_value import WaveDecimal

        result = resolve_parameters(
            {"driver_options": {"timeout": WaveDecimal("2.5"), "cached": 16}},
            set(),
            {},
            {"driver_options": "map"},
            typed_value_fields={"driver_options"},
        )
        assert result["driver_options"] == {"timeout": 2.5, "cached": 16}
        assert type(result["driver_options"]["timeout"]) is float

    def test_a_setting_without_typed_values_keeps_exact_decimals(self) -> None:
        from decimal import Decimal

        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.variables.decimal_value import WaveDecimal

        result = resolve_parameters(
            {"parameters": "opts"},
            {"parameters"},
            {"opts": {"amount": WaveDecimal("0.10")}},
            {"parameters": "map"},
            typed_value_fields={"driver_options"},
        )
        assert result["parameters"] == {"amount": Decimal("0.10")}
        assert isinstance(result["parameters"]["amount"], Decimal)

    def test_a_typed_value_field_the_block_does_not_set_is_skipped(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            {"sql": "SELECT 1"},
            set(),
            {},
            {"sql": "string"},
            typed_value_fields={"driver_options"},
        )
        assert result == {"sql": "SELECT 1"}


class TestResolveParametersSecretRegistration:
    """Values resolved into secret-declared parameters register pre-execute,
    so the byte-form scrubs run-wide on every outbound surface."""

    @staticmethod
    def _registry():
        from wavecore.core.secrets.registry import SecretRegistry

        return SecretRegistry()

    def test_literal_secret_param_registers_its_value(self):
        """A literal typed into a secret-declared param enters the run registry."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        registry = self._registry()

        result = resolve_parameters(
            {"password": "hunter2secret", "url": "https://example.com"},
            set(),
            {},
            {"password": "string", "url": "string"},
            secret_fields={"password"},
            registry=registry,
        )

        assert result["password"] == "hunter2secret"
        assert "hunter2secret" in registry.scan_values()

    def test_expression_secret_param_registers_the_resolved_value(self):
        """The RESOLVED value registers, not the expression source."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        registry = self._registry()

        result = resolve_parameters(
            {"password": "prefix + suffix"},
            {"password"},
            {"prefix": "hunt", "suffix": "er2secret"},
            {"password": "string"},
            secret_fields={"password"},
            registry=registry,
        )

        assert result["password"] == "hunter2secret"
        assert "hunter2secret" in registry.scan_values()
        assert "prefix + suffix" not in registry.scan_values()

    def test_non_secret_params_register_nothing(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        registry = self._registry()

        resolve_parameters(
            {"url": "https://example.com/long-enough"},
            set(),
            {},
            {"url": "string"},
            secret_fields=set(),
            registry=registry,
        )

        assert registry.scan_values() == ()

    def test_secret_fields_without_registry_is_a_no_op(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            {"password": "hunter2secret"},
            set(),
            {},
            {"password": "string"},
            secret_fields={"password"},
        )

        assert result["password"] == "hunter2secret"

    def test_defaults_leave_resolution_unchanged(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            {"url": "https://example.com"},
            set(),
            {},
            {"url": "string"},
        )

        assert result == {"url": "https://example.com"}


class TestResolveParametersIndexedExpressionKeys:
    """Index-addressed ``<index>.<field>`` expression entries within array params."""

    def test_indexed_entry_resolves_by_index(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {
            "parts": [
                {"kind": "text", "name": "token", "value": "prefix + '-77'"},
                {"kind": "text", "name": "plain", "value": "as-is"},
            ]
        }

        result = resolve_parameters(
            parameters,
            set(),
            {"prefix": "tok"},
            {"parts": "array"},
            map_expression_keys={"parts": {"0.value"}},
        )

        assert result["parts"][0]["value"] == "tok-77"
        assert result["parts"][1]["value"] == "as-is"

    def test_indexed_resolution_does_not_mutate_the_original_parameters(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {"parts": [{"kind": "text", "name": "token", "value": "prefix + '-77'"}]}

        resolve_parameters(
            parameters,
            set(),
            {"prefix": "tok"},
            {"parts": "array"},
            map_expression_keys={"parts": {"0.value"}},
        )

        assert parameters["parts"][0]["value"] == "prefix + '-77'"

    def test_malformed_keys_are_skipped(self):
        """Keys without an index or with a non-digit index resolve nothing."""
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {"parts": [{"kind": "text", "name": "token", "value": "prefix + '-77'"}]}

        result = resolve_parameters(
            parameters,
            set(),
            {"prefix": "tok"},
            {"parts": "array"},
            map_expression_keys={"parts": {"value", "x.value"}},
        )

        assert result["parts"][0]["value"] == "prefix + '-77'"

    def test_out_of_range_index_is_skipped(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {"parts": [{"kind": "text", "name": "token", "value": "as-is"}]}

        result = resolve_parameters(
            parameters,
            set(),
            {},
            {"parts": "array"},
            map_expression_keys={"parts": {"5.value"}},
        )

        assert result["parts"][0]["value"] == "as-is"

    def test_non_dict_item_is_skipped(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {"parts": ["bare-string"]}

        result = resolve_parameters(
            parameters,
            set(),
            {},
            {"parts": "array"},
            map_expression_keys={"parts": {"0.value"}},
        )

        assert result["parts"] == ["bare-string"]

    def test_non_string_entry_value_passes_through(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        parameters = {"parts": [{"kind": "text", "name": "count", "value": 42}]}

        result = resolve_parameters(
            parameters,
            set(),
            {},
            {"parts": "array"},
            map_expression_keys={"parts": {"0.value"}},
        )

        assert result["parts"][0]["value"] == 42


class TestExpressionResultsNeverAutoRegister:
    """Expression results register ONLY through declared secret_fields - the
    retired secret-result builtin machinery must stay absent."""

    @staticmethod
    def _registry():
        from wavecore.core.secrets.registry import SecretRegistry

        return SecretRegistry()

    def test_param_level_expression_result_does_not_register(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        registry = self._registry()

        result = resolve_parameters(
            {"body": "'cred-' + str(1234567)"},
            {"body"},
            {},
            {"body": "string"},
            registry=registry,
        )

        assert result["body"] == "cred-1234567"
        assert registry.scan_values() == ()

    def test_map_entry_expression_result_does_not_register(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        registry = self._registry()

        result = resolve_parameters(
            {"headers": {"Authorization": "'Bearer ' + tok"}},
            set(),
            {"tok": "tok-1234567890"},
            {"headers": "map"},
            map_expression_keys={"headers": {"Authorization"}},
            registry=registry,
        )

        assert result["headers"]["Authorization"] == "Bearer tok-1234567890"
        assert registry.scan_values() == ()

    def test_indexed_entry_expression_result_does_not_register(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        registry = self._registry()

        result = resolve_parameters(
            {"parts": [{"kind": "text", "name": "token", "value": "'Bearer ' + tok"}]},
            set(),
            {"tok": "tok-55667788"},
            {"parts": "array"},
            map_expression_keys={"parts": {"0.value"}},
            registry=registry,
        )

        assert result["parts"][0]["value"] == "Bearer tok-55667788"
        assert registry.scan_values() == ()


class TestDeriveParameterMetadata:
    """derive_parameter_metadata yields the type map + trim + reference fields."""

    def test_trim_fields_are_unaffected(self):
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        _, trim_fields, _, _ = derive_parameter_metadata(
            [{"name": "url", "type": "string", "trim": True}]
        )

        assert trim_fields == {"url"}

    def test_reference_fields_from_variable_ref(self):
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        _, _, reference_fields, _ = derive_parameter_metadata(
            [
                {"name": "table", "type": "table", "variable_ref": True},
                {"name": "delimiter", "type": "string"},
            ]
        )

        assert reference_fields == {"table"}

    def test_no_reference_fields_when_none_flagged(self):
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        _, _, reference_fields, _ = derive_parameter_metadata([{"name": "url", "type": "string"}])

        assert reference_fields == set()


class TestFieldListMetadataReadsModelRows:
    """A field list may hold plugin and control parameter models as well as dicts."""

    def test_plugin_parameter_models_give_types_trim_and_references(self) -> None:
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata
        from wavecore.models.plugins import PluginParameter

        fields = [
            PluginParameter(name="url", type="string", trim=True),
            PluginParameter(name="table", type="table", variable_ref=True),
        ]

        assert derive_parameter_metadata(fields) == (
            {"url": "string", "table": "table"},
            {"url"},
            {"table"},
            set(),
        )

    def test_control_parameter_models_give_types_and_references(self) -> None:
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata
        from wavecore.models.controls.parameters import ControlParameter

        fields = [
            ControlParameter(name="collection", type=["array", "map", "table"], variable_ref=True),
            ControlParameter(name="count", type="integer"),
        ]

        assert derive_parameter_metadata(fields) == (
            {"collection": ["array", "map", "table"], "count": "integer"},
            set(),
            {"collection"},
            set(),
        )

    def test_dict_and_model_rows_mix_in_one_list(self) -> None:
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata
        from wavecore.models.controls.parameters import ControlParameter

        fields = [
            ControlParameter(name="duration", type="string"),
            {"name": "manifest", "type": "string", "wire_format": "json"},
        ]

        types, _, _, wire_format_fields = derive_parameter_metadata(fields)

        assert types == {"duration": "string", "manifest": "string"}
        assert wire_format_fields == {"manifest"}

    def test_model_rows_declare_no_typed_values_and_no_escapes(self) -> None:
        from wavecore.core.execution.plugin_executor import (
            template_escape_fields,
            typed_value_fields,
        )
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.plugins import PluginParameter

        fields = [
            PluginParameter(name="options", type="map"),
            ControlParameter(name="assertions", type="array"),
        ]

        assert typed_value_fields(fields) == set()
        assert template_escape_fields(fields) == {}


_ONE_DOCUMENT = "kind: ConfigMap\napiVersion: v1\nmetadata:\n  name: probe\n"
_ONE_OBJECT = {"kind": "ConfigMap", "apiVersion": "v1", "metadata": {"name": "probe"}}
_TWO_DOCUMENTS = "kind: ConfigMap\nmetadata:\n  name: a\n---\nkind: Secret\nmetadata:\n  name: b\n"
_TWO_OBJECTS = [
    {"kind": "ConfigMap", "metadata": {"name": "a"}},
    {"kind": "Secret", "metadata": {"name": "b"}},
]
_UNPARSABLE = "kind: ConfigMap\n- name: probe\n"
_PARSE_FAILURE_PREFIX = "Parameter 'manifest' is not valid YAML or JSON: "
_DATE_DOCUMENT = "when: 2024-01-01\n"
_TIMESTAMP_DOCUMENT = "at: 2024-01-01T10:00:00Z\n"
_SPACED_TIMESTAMP_DOCUMENT = "at: 2024-01-01 10:00:00\n"
_SCALARS_DOCUMENT = "count: 3\nratio: 1.5\nenabled: true\nnothing: null\nname: probe\n"
_DOUBLED_SEPARATOR = (
    "kind: ConfigMap\nmetadata:\n  name: a\n---\n---\nkind: Secret\nmetadata:\n  name: b\n"
)


def _resolve_manifest(value, **kwargs):
    """One manifest-shaped parameter through resolve_parameters, wire format on by default."""
    from wavecore.core.execution.plugin_executor import resolve_parameters

    kwargs.setdefault("wire_format_fields", {"manifest"})
    expression_fields = kwargs.pop("expression_fields", set())
    variables = kwargs.pop("variables", {})
    return resolve_parameters(
        {"manifest": value},
        expression_fields,
        variables,
        {"manifest": "string"},
        **kwargs,
    )["manifest"]


class TestDeriveParameterMetadataWireFormat:
    """A fourth member names the parameters whose descriptor asks for JSON on the wire."""

    @staticmethod
    def _fields():
        return [
            {"name": "manifest", "type": "string", "wire_format": "json", "trim": True},
            {"name": "table", "type": "table", "variable_ref": True},
            {"name": "url", "type": "string"},
        ]

    def test_the_metadata_tuple_carries_four_members(self):
        """The arity is a three-call-site contract, so the count itself is pinned."""
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        assert len(derive_parameter_metadata(self._fields())) == 4

    def test_the_first_three_members_keep_their_position_and_content(self):
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        parameter_types, trim_fields, reference_fields, _ = derive_parameter_metadata(
            self._fields()
        )

        assert parameter_types == {"manifest": "string", "table": "table", "url": "string"}
        assert trim_fields == {"manifest"}
        assert reference_fields == {"table"}

    def test_the_fourth_member_names_the_json_parameters(self):
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        _, _, _, wire_format_fields = derive_parameter_metadata(self._fields())

        assert wire_format_fields == {"manifest"}

    def test_a_descriptor_without_wire_format_contributes_nothing(self):
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        _, _, _, wire_format_fields = derive_parameter_metadata([{"name": "url", "type": "string"}])

        assert wire_format_fields == set()

    def test_any_other_wire_format_value_is_not_collected(self):
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        _, _, _, wire_format_fields = derive_parameter_metadata(
            [
                {"name": "body", "type": "string", "wire_format": "yaml"},
                {"name": "raw", "type": "string", "wire_format": ""},
            ]
        )

        assert wire_format_fields == set()

    def test_an_empty_field_list_yields_an_empty_set(self):
        from wavecore.core.execution.plugin_executor import derive_parameter_metadata

        _, _, _, wire_format_fields = derive_parameter_metadata([])

        assert wire_format_fields == set()


class TestResolveParametersWireFormat:
    """A wire-format parameter reaches the plugin as canonical JSON text, whatever was typed."""

    def test_a_single_yaml_document_becomes_one_json_object(self):
        assert json.loads(_resolve_manifest(_ONE_DOCUMENT)) == _ONE_OBJECT

    def test_a_multi_document_yaml_stream_becomes_one_json_array(self):
        assert json.loads(_resolve_manifest(_TWO_DOCUMENTS)) == _TWO_OBJECTS

    def test_json_text_passes_through_canonicalized(self):
        result = _resolve_manifest('{"kind":"ConfigMap",\n  "metadata": {"name": "probe"}}')

        assert json.loads(result) == {"kind": "ConfigMap", "metadata": {"name": "probe"}}
        assert "\n" not in result

    def test_a_json_array_stays_an_array(self):
        result = _resolve_manifest('[{"kind": "ConfigMap"}, {"kind": "Secret"}]')

        assert json.loads(result) == [{"kind": "ConfigMap"}, {"kind": "Secret"}]

    def test_a_parameter_without_the_attribute_is_untouched(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        resolved = resolve_parameters(
            {"manifest": _ONE_DOCUMENT, "note": _ONE_DOCUMENT},
            set(),
            {},
            {"manifest": "string", "note": "string"},
            wire_format_fields={"manifest"},
        )

        assert resolved["note"] == _ONE_DOCUMENT
        assert json.loads(resolved["manifest"]) == _ONE_OBJECT

    def test_an_empty_wire_format_set_leaves_every_value_untouched(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        resolved = resolve_parameters(
            {"manifest": _ONE_DOCUMENT},
            set(),
            {},
            {"manifest": "string"},
            wire_format_fields=set(),
        )

        assert resolved["manifest"] == _ONE_DOCUMENT

    def test_a_flagged_name_that_is_absent_registers_nothing(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        resolved = resolve_parameters(
            {"url": "https://example.com"},
            set(),
            {},
            {"url": "string"},
            wire_format_fields={"manifest"},
        )

        assert resolved == {"url": "https://example.com"}

    def test_a_mapping_value_is_untouched(self):
        assert _resolve_manifest({"kind": "ConfigMap"}) == {"kind": "ConfigMap"}

    def test_a_none_value_is_untouched(self):
        assert _resolve_manifest(None) is None

    def test_an_empty_value_stays_empty(self):
        """A blank stays blank, so the plugin's required-row check still reports it missing."""
        assert _resolve_manifest("") == ""

    def test_a_whitespace_only_value_stays_untouched(self):
        """Whitespace alone is a blank too, and goes the same way as the empty string."""
        assert _resolve_manifest("   \n  ") == "   \n  "


class TestWireFormatReadsDatesAsText:
    """kubectl decodes an unquoted date or timestamp as text, and so does the engine."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            pytest.param(_DATE_DOCUMENT, {"when": "2024-01-01"}, id="date"),
            pytest.param(_TIMESTAMP_DOCUMENT, {"at": "2024-01-01T10:00:00Z"}, id="timestamp"),
            pytest.param(
                _SPACED_TIMESTAMP_DOCUMENT, {"at": "2024-01-01 10:00:00"}, id="spaced timestamp"
            ),
        ],
    )
    def test_an_unquoted_date_or_timestamp_reaches_the_plugin_as_text(self, text, expected):
        assert json.loads(_resolve_manifest(text)) == expected

    def test_every_other_scalar_keeps_its_yaml_type(self):
        assert json.loads(_resolve_manifest(_SCALARS_DOCUMENT)) == {
            "count": 3,
            "ratio": 1.5,
            "enabled": True,
            "nothing": None,
            "name": "probe",
        }

    def test_the_shared_safe_loader_still_reads_dates_as_dates(self):
        """The engine reads through its own loader; yaml.safe_load stays as PyYAML ships it."""
        _resolve_manifest(_DATE_DOCUMENT)

        assert yaml.safe_load(_DATE_DOCUMENT) == {"when": datetime.date(2024, 1, 1)}


class TestWireFormatDropsNullDocuments:
    """A separator that opens or closes the stream, or sits doubled, adds no object."""

    def test_a_trailing_separator_after_one_document_is_one_object(self):
        assert json.loads(_resolve_manifest(_ONE_DOCUMENT + "---\n")) == _ONE_OBJECT

    def test_a_trailing_separator_after_two_documents_is_an_array_of_two(self):
        assert json.loads(_resolve_manifest(_TWO_DOCUMENTS + "---\n")) == _TWO_OBJECTS

    def test_a_doubled_separator_between_documents_adds_nothing(self):
        assert json.loads(_resolve_manifest(_DOUBLED_SEPARATOR)) == _TWO_OBJECTS

    def test_a_leading_separator_adds_nothing(self):
        assert json.loads(_resolve_manifest("---\n" + _ONE_DOCUMENT)) == _ONE_OBJECT

    @pytest.mark.parametrize(
        "text",
        ["---", "---\n", "---\n---", "---\n---\n", "# only a comment\n", "~\n", "---\nnull\n"],
        ids=["bare", "one line", "two bare", "two lines", "comment only", "tilde", "null word"],
    )
    def test_a_stream_with_no_documents_becomes_an_empty_array(self, text):
        """parse_manifest refuses '[]' as declaring no kind, so an empty apply is refused."""
        assert _resolve_manifest(text) == "[]"


class TestResolveParametersWireFormatFailure:
    """Text that is neither YAML nor JSON is refused at the engine seam."""

    def test_unparsable_text_is_refused_with_the_parser_detail(self):
        with pytest.raises(ValueError) as excinfo:
            _resolve_manifest(_UNPARSABLE)

        message = str(excinfo.value)
        assert message.startswith(_PARSE_FAILURE_PREFIX)
        assert message[len(_PARSE_FAILURE_PREFIX) :].strip() != ""

    def test_the_message_names_the_offending_parameter(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        with pytest.raises(ValueError) as excinfo:
            resolve_parameters(
                {"body": _UNPARSABLE},
                set(),
                {},
                {"body": "string"},
                wire_format_fields={"body"},
            )

        assert str(excinfo.value).startswith("Parameter 'body' is not valid YAML or JSON: ")


class TestWireFormatRidesTheResolvedValue:
    """The conversion runs last, on the value the expression and trim passes produced."""

    def test_a_trimmed_value_is_converted_after_the_trim(self):
        """A leading tab is fatal to the parser, so this can only pass if trim ran first."""
        result = _resolve_manifest("\t" + _ONE_DOCUMENT, trim_fields={"manifest"})

        assert json.loads(result) == _ONE_OBJECT

    def test_an_expression_value_is_converted_after_it_resolves(self):
        result = _resolve_manifest(
            "my_manifest",
            expression_fields={"manifest"},
            variables={"my_manifest": _ONE_DOCUMENT},
        )

        assert json.loads(result) == _ONE_OBJECT

    def test_an_empty_expression_resolves_to_none_and_is_left_alone(self):
        assert _resolve_manifest("   ", expression_fields={"manifest"}, variables={}) is None

    def test_the_secret_registry_receives_the_converted_text(self):
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()

        result = _resolve_manifest(_ONE_DOCUMENT, secret_fields={"manifest"}, registry=registry)

        assert result in registry.scan_values()
        assert _ONE_DOCUMENT not in registry.scan_values()


class TestHttpMapsResolveLiteralsAndExpressions:
    """Map values are literal-or-expression. A literal (no
    dotted expressionFields entry) passes through VERBATIM - even one that
    contains {{ }} chars, which must NOT be evaluated; a dotted expression key
    evaluates as a full expression."""

    def test_literal_map_value_with_braces_is_never_evaluated(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            {"headers": {"X-Trace": "{{ not_an_expr }}", "X-Plain": "on"}},
            set(),
            {"not_an_expr": "SHOULD-NOT-APPEAR"},
            {"headers": "map"},
        )

        assert result["headers"] == {"X-Trace": "{{ not_an_expr }}", "X-Plain": "on"}

    def test_dotted_expression_key_evaluates_as_a_full_expression(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            {"headers": {"Authorization": "'Bearer ' + tok", "X-Env": "prod"}},
            set(),
            {"tok": "tok-999"},
            {"headers": "map"},
            map_expression_keys={"headers": {"Authorization"}},
        )

        assert result["headers"] == {"Authorization": "Bearer tok-999", "X-Env": "prod"}


class TestBuildParameterSources:
    """Rendered source labels for map params, consumed by execution-time key
    policies: literal maps are labeled by parameter name, param-level
    expression maps as "the <name> expression", and a bare profile-field
    reference as 'profile "<name>"'."""

    def test_literal_map_is_labeled_by_its_parameter_name(self):
        from wavecore.core.execution.plugin_executor import build_parameter_sources

        sources = build_parameter_sources({"headers": {"Accept": "*/*"}}, set(), {}, {"headers"})

        assert sources == {"headers": "headers"}

    def test_expression_map_is_labeled_as_the_parameter_expression(self):
        from wavecore.core.execution.plugin_executor import build_parameter_sources

        sources = build_parameter_sources(
            {"headers": "build_headers(env)"}, {"headers"}, {}, {"headers"}
        )

        assert sources == {"headers": "the headers expression"}

    def test_bare_profile_field_reference_is_labeled_with_the_profile_name(self):
        from wavecore.core.execution.plugin_executor import build_parameter_sources
        from wavecore.core.profile_object import ProfileObject

        profile = ProfileObject(
            {"default_headers": {"X-Env": "prod"}}, alias="api", profile_name="Payments API"
        )

        sources = build_parameter_sources(
            {"headers": "api.default_headers"}, {"headers"}, {"api": profile}, {"headers"}
        )

        assert sources == {"headers": 'profile "Payments API"'}

    def test_profile_label_falls_back_to_the_alias_without_a_name(self):
        from wavecore.core.execution.plugin_executor import build_parameter_sources
        from wavecore.core.profile_object import ProfileObject

        profile = ProfileObject({"default_headers": {}}, alias="api")

        sources = build_parameter_sources(
            {"headers": "api.default_headers"}, {"headers"}, {"api": profile}, {"headers"}
        )

        assert sources == {"headers": 'profile "api"'}

    def test_profile_shaped_reference_over_a_plain_variable_keeps_the_expression_label(self):
        from wavecore.core.execution.plugin_executor import build_parameter_sources

        sources = build_parameter_sources(
            {"headers": "conf.headers"}, {"headers"}, {"conf": {"headers": {}}}, {"headers"}
        )

        assert sources == {"headers": "the headers expression"}

    def test_map_params_absent_from_the_parameters_are_skipped(self):
        from wavecore.core.execution.plugin_executor import build_parameter_sources

        sources = build_parameter_sources({}, set(), {}, {"headers"})

        assert sources == {}


class TestTemplateFieldsAreReadOnly:
    """A ``{{ }}`` marker is a read: it may not change a variable (REQ-3.1.3.14).

    Template fields go through the same read-only guard as expression fields,
    so a marker that calls a mutating method is refused with the identical
    message an expression field gives and the variable is left untouched.
    """

    @staticmethod
    def _resolve_template(value, variables):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        return resolve_parameters(
            parameters={"body": value},
            expression_fields=set(),
            variables=variables,
            parameter_types={},
            template_fields={"body"},
        )

    def test_append_marker_is_refused_and_leaves_the_list_alone(self):
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows = [1]
        with pytest.raises(BlockedExpressionError) as exc_info:
            self._resolve_template("{{rows.append(9)}}", {"rows": rows})
        assert str(exc_info.value) == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Expression: rows.append(9)"
        )
        assert rows == [1]

    def test_update_marker_is_refused_and_leaves_the_map_alone(self):
        from wavecore.core.expressions.errors import BlockedExpressionError

        m = {"x": 1}
        with pytest.raises(BlockedExpressionError) as exc_info:
            self._resolve_template('{{m.update({"y": 2})}}', {"m": m})
        assert "update" in str(exc_info.value)
        assert m == {"x": 1}

    def test_add_row_marker_is_refused_and_leaves_the_table_alone(self):
        from wavecore.core.expressions.errors import BlockedExpressionError
        from wavecore.core.table import Table

        table = Table(columns=[("id", "integer")])
        table.add_row([1])
        with pytest.raises(BlockedExpressionError) as exc_info:
            self._resolve_template("{{t.add_row([2])}}", {"t": table})
        assert "add_row" in str(exc_info.value)
        assert table.col("id") == [1]

    def test_template_field_message_matches_the_expression_field_message(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError) as template_exc:
            self._resolve_template("{{rows.append(9)}}", {"rows": [1]})
        with pytest.raises(BlockedExpressionError) as expression_exc:
            resolve_parameters(
                parameters={"body": "rows.append(9)"},
                expression_fields={"body"},
                variables={"rows": [1]},
                parameter_types={},
            )
        assert str(template_exc.value) == str(expression_exc.value)

    def test_mutating_marker_inside_surrounding_text_is_refused(self):
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows = [1]
        with pytest.raises(BlockedExpressionError):
            self._resolve_template("before {{ rows.append(9) }} after", {"rows": rows})
        assert rows == [1]

    def test_list_constructor_marker_is_refused(self):
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError) as exc_info:
            self._resolve_template("{{list(m.keys())}}", {"m": {"a": 1}})
        assert "list" in str(exc_info.value)

    def test_reading_marker_is_unaffected(self):
        result = self._resolve_template(
            "count={{len(rows)}} first={{rows[0]}} up={{name.upper()}}",
            {"rows": [1, 2, 3], "name": "ada"},
        )
        assert result["body"] == "count=3 first=1 up=ADA"

    def test_sorted_marker_is_unaffected(self):
        result = self._resolve_template("{{sorted(rows)}}", {"rows": [3, 1, 2]})
        assert result["body"] == "[1, 2, 3]"


class TestMapTemplateEntriesAreReadOnly:
    """The per-key template entries a control renders obey the same rule."""

    def test_mutating_map_template_entry_is_refused(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows = [1]
        with pytest.raises(BlockedExpressionError) as exc_info:
            resolve_parameters(
                parameters={"assignments": {"target": "{{rows.append(9)}}"}},
                expression_fields=set(),
                variables={"rows": rows},
                parameter_types={},
                map_template_keys={"assignments": {"target"}},
            )
        assert "append" in str(exc_info.value)
        assert rows == [1]

    def test_reading_map_template_entry_is_unaffected(self):
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            parameters={"assignments": {"target": "n={{len(rows)}}"}},
            expression_fields=set(),
            variables={"rows": [1, 2]},
            parameter_types={},
            map_template_keys={"assignments": {"target"}},
        )
        assert result["assignments"]["target"] == "n=2"


class TestTemplateReadOnlyViolation:
    """The reporting half of the template rule, used by the save-time gate."""

    def test_the_first_offending_marker_is_reported(self) -> None:
        from wavecore.core.execution.plugin_executor import template_read_only_violation

        assert template_read_only_violation("a={{len(rows)}} b={{rows.append(9)}}") == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block."
        )

    def test_a_reading_template_reports_nothing(self) -> None:
        from wavecore.core.execution.plugin_executor import template_read_only_violation

        assert template_read_only_violation("a={{len(rows)}}") is None

    def test_an_empty_marker_reports_nothing(self) -> None:
        from wavecore.core.execution.plugin_executor import template_read_only_violation

        assert template_read_only_violation("a={{  }} b={{ }}") is None

    def test_a_string_with_no_marker_reports_nothing(self) -> None:
        from wavecore.core.execution.plugin_executor import template_read_only_violation

        assert template_read_only_violation("plain text") is None

    def test_a_long_unclosed_run_of_braces_is_scanned_in_linear_time(self) -> None:
        from wavecore.core.execution.plugin_executor import template_read_only_violation

        start = time.perf_counter()
        violation = template_read_only_violation("{" * 50_000)
        elapsed = time.perf_counter() - start

        assert violation is None
        assert elapsed < 1.0


class TestTemplateFillMarkers:
    """Block settings find ``{{ }}`` markers by the one shared marker rule."""

    def test_a_second_opening_starts_the_marker_over(self) -> None:
        from wavecore.core.execution.plugin_executor import _evaluate_template

        assert _evaluate_template("{{ a {{ b }}", {"b": 7}, setting="body") == "{{ a 7"


_QUERY_ESCAPE = {
    "by": "query_language",
    "rules": {"dql": "dql", "query_dsl": "json"},
    "default": "dql",
}

_SECRET_TABLE = Table.from_list([{"name": "alpha", "qty": 1}])


def _resolve_query(
    parameters: dict[str, Any], variables: dict[str, Any], **kwargs: Any
) -> dict[str, Any]:
    """The Query row as a template field carrying its escape spec (REQ-3.3.2.6)."""
    from wavecore.core.execution.plugin_executor import resolve_parameters

    kwargs.setdefault("template_fields", {"query"})
    kwargs.setdefault("template_escapes", {"query": _QUERY_ESCAPE})
    expression_fields = kwargs.pop("expression_fields", set())
    return resolve_parameters(
        parameters,
        expression_fields,
        variables,
        {"query": ["string", "map"], "query_language": "string"},
        **kwargs,
    )


class _SpyRegistry:
    """Answers a fixed set of secret values and records each registration."""

    def __init__(self, scanned: tuple[str, ...]) -> None:
        self.scanned = scanned
        self.registered: list[tuple[Any, str]] = []

    def scan_values(self, exclude_for_block: str | None = None) -> tuple[str, ...]:
        return self.scanned

    def register_value(self, value: Any, source: str, exempt_block: str | None = None) -> None:
        self.registered.append((value, source))


class TestTemplateEscapeFields:
    """Field name -> its template_escape spec, read from the Block's field list."""

    def test_each_param_with_a_spec_maps_to_it(self) -> None:
        from wavecore.core.execution.plugin_executor import template_escape_fields

        note_spec = {"by": "kind", "rules": {"a": "json"}, "default": "a"}
        fields = [
            {"name": "query_language", "type": "string"},
            {"name": "query", "type": ["string", "map"], "template_escape": _QUERY_ESCAPE},
            {"name": "note", "type": "string", "template_escape": note_spec},
        ]

        assert template_escape_fields(fields) == {"query": _QUERY_ESCAPE, "note": note_spec}

    def test_params_without_a_spec_give_an_empty_map(self) -> None:
        from wavecore.core.execution.plugin_executor import template_escape_fields

        assert template_escape_fields([{"name": "url", "type": "string"}]) == {}

    def test_an_empty_field_list_gives_an_empty_map(self) -> None:
        from wavecore.core.execution.plugin_executor import template_escape_fields

        assert template_escape_fields([]) == {}


class TestResolveParametersTemplateEscapes:
    """A template field with a spec fills each value escaped for where it lands (OS-5)."""

    def test_the_dql_language_escapes_by_the_dql_rule(self) -> None:
        result = _resolve_query(
            {"query_language": "dql", "query": "user.name: {{ user }}"}, {"user": "ann or bob"}
        )

        assert result["query"] == r"user.name: ann \or bob"

    def test_the_query_dsl_language_escapes_by_the_json_rule(self) -> None:
        result = _resolve_query(
            {"query_language": "query_dsl", "query": '{"term": {"env": {{ env }}}}'},
            {"env": "prod"},
        )

        assert result["query"] == '{"term": {"env": "prod"}}'

    def test_an_absent_selector_falls_back_to_the_default_rule(self) -> None:
        result = _resolve_query({"query": "user.name: {{ user }}"}, {"user": "ann or bob"})

        assert result["query"] == r"user.name: ann \or bob"

    @pytest.mark.parametrize("blank", ["", None], ids=["empty", "none"])
    def test_a_blank_selector_falls_back_to_the_default_rule(self, blank: Any) -> None:
        result = _resolve_query(
            {"query_language": blank, "query": '"{{ trace }}"'}, {"trace": 'a1"b'}
        )

        assert result["query"] == r'"a1\"b"'

    @pytest.mark.parametrize(
        ("kind", "expected"),
        [("a", 'note: "x"'), ("b", "note: x"), (None, 'note: "x"')],
        ids=["first-rule", "second-rule", "default"],
    )
    def test_the_spec_names_its_own_selector(self, kind: Any, expected: str) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters

        spec = {"by": "kind", "rules": {"a": "json", "b": "dql"}, "default": "a"}

        result = resolve_parameters(
            {"kind": kind, "note": "note: {{ v }}"},
            set(),
            {"v": "x"},
            {"kind": "string", "note": "string"},
            template_fields={"note"},
            template_escapes={"note": spec},
        )

        assert result["note"] == expected

    def test_a_template_field_without_a_spec_renders_unescaped(self) -> None:
        result = _resolve_query(
            {"query": "user.name: {{ user }}", "body": "say {{ user }} {{ flag }}"},
            {"user": "ann or bob", "flag": True},
            template_fields={"query", "body"},
        )

        assert result["body"] == "say ann or bob True"
        assert result["query"] == r"user.name: ann \or bob"

    def test_other_fields_pass_through_unchanged(self) -> None:
        result = _resolve_query(
            {
                "query_language": "dql",
                "query": "user.name: {{ user }}",
                "url": "https://search.example.com:9200",
                "max_results": 10,
            },
            {"user": "ann or bob"},
        )

        assert result == {
            "query_language": "dql",
            "query": r"user.name: ann \or bob",
            "url": "https://search.example.com:9200",
            "max_results": 10,
        }

    def test_values_fill_in_their_text_form(self) -> None:
        from decimal import Decimal

        result = _resolve_query(
            {"query": "flag: {{ on }} and price: {{ price }}"},
            {"on": True, "price": Decimal("12.50")},
        )

        assert result["query"] == "flag: true and price: 12.50"

    def test_expression_mode_is_not_escaped(self) -> None:
        result = _resolve_query(
            {"query": "'user.name: ' + user"},
            {"user": "ann or bob"},
            expression_fields={"query"},
            template_fields=set(),
        )

        assert result["query"] == "user.name: ann or bob"

    def test_a_literal_query_keeps_its_markers(self) -> None:
        result = _resolve_query(
            {"query": "user.name: {{ user }}"}, {"user": "ann or bob"}, template_fields=set()
        )

        assert result["query"] == "user.name: {{ user }}"

    def test_a_map_query_passes_through(self) -> None:
        query = {"match_all": {}}

        result = _resolve_query({"query_language": "query_dsl", "query": query}, {})

        assert result["query"] == {"match_all": {}}

    def test_an_undefined_variable_is_refused(self) -> None:
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match=r"^Variable 'missing' is not defined$"):
            _resolve_query({"query": "user.name: {{missing}}"}, {})

    def test_a_lowercase_not_before_a_space_outside_quotes_is_refused(self) -> None:
        from wavecore.core.expressions.errors import InvalidExpressionError

        message = (
            '{{ user }} puts a lowercase "not" before a space outside quotes. DQL reads that as '
            'the NOT operator, even inside a word such as "cannot stop", and there is no way to '
            "escape it. Put quotes around {{ user }}."
        )
        with pytest.raises(InvalidExpressionError, match=f"^{re.escape(message)}$"):
            _resolve_query(
                {"query_language": "dql", "query": "user.name: {{ user }}"}, {"user": "cannot stop"}
            )

    def test_a_mutating_marker_is_refused_and_leaves_the_list_alone(self) -> None:
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows = [1]
        with pytest.raises(BlockedExpressionError) as exc_info:
            _resolve_query({"query": "n: {{rows.append(9)}}"}, {"rows": rows})

        assert str(exc_info.value) == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Expression: rows.append(9)"
        )
        assert rows == [1]


class TestResolveParametersWithoutTemplateEscapes:
    """No escape specs keeps plain str() filling for every template field."""

    @pytest.mark.parametrize(
        "extra",
        [{}, {"template_escapes": None}, {"template_escapes": {}}],
        ids=["omitted", "none", "empty"],
    )
    def test_template_fields_fill_unescaped(self, extra: dict[str, Any]) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            {"query": "user.name: {{ user }} flag: {{ flag }}"},
            set(),
            {"user": "ann or bob", "flag": True},
            {"query": ["string", "map"]},
            template_fields={"query"},
            **extra,
        )

        assert result["query"] == "user.name: ann or bob flag: True"


class TestTemplateEscapeSecretForms:
    """An escaped secret is registered in its escaped form so logs still mask it."""

    def test_an_escaped_secret_form_is_registered(self) -> None:
        registry = _SpyRegistry(("pass or word",))

        result = _resolve_query(
            {"query": "user.name: {{ token }}"}, {"token": "pass or word"}, registry=registry
        )

        assert result["query"] == r"user.name: pass \or word"
        assert registry.registered == [(r"pass \or word", "template escape")]

    def test_a_standing_alone_secret_registers_its_json_string(self) -> None:
        registry = _SpyRegistry(("s3cretvalue",))

        _resolve_query(
            {"query_language": "query_dsl", "query": '{"term": {"user": {{ token }}}}'},
            {"token": "s3cretvalue"},
            registry=registry,
        )

        assert registry.registered == [('"s3cretvalue"', "template escape")]

    def test_a_secret_inside_a_quoted_dql_value_registers_its_escaped_form(self) -> None:
        registry = _SpyRegistry(('p"w0rd',))

        result = _resolve_query(
            {"query": 'msg: "{{ prefix + token }}"'},
            {"prefix": "id ", "token": 'p"w0rd'},
            registry=registry,
        )

        assert result["query"] == r'msg: "id p\"w0rd"'
        assert registry.registered == [(r"p\"w0rd", "template escape")]

    def test_a_secret_inside_a_bare_dql_value_registers_its_escaped_form(self) -> None:
        registry = _SpyRegistry(("pass(word)",))

        result = _resolve_query(
            {"query": "msg: {{ prefix + token }}"},
            {"prefix": "id ", "token": "pass(word)"},
            registry=registry,
        )

        assert result["query"] == r"msg: id pass\(word\)"
        assert registry.registered == [(r"pass\(word\)", "template escape")]

    def test_a_secret_inside_a_json_string_registers_its_escaped_form(self) -> None:
        registry = _SpyRegistry(("a\\b\fc",))

        result = _resolve_query(
            {"query_language": "query_dsl", "query": '{"match": {"m": "{{ prefix + token }}"}}'},
            {"prefix": "id ", "token": "a\\b\fc"},
            registry=registry,
        )

        assert result["query"] == r'{"match": {"m": "id a\\b\fc"}}'
        assert registry.registered == [(r"a\\b\fc", "template escape")]

    def test_a_secret_inside_a_standing_alone_json_text_registers_its_escaped_form(self) -> None:
        registry = _SpyRegistry(('s3"cret',))

        result = _resolve_query(
            {"query_language": "query_dsl", "query": '{"term": {"user": {{ prefix + token }}}}'},
            {"prefix": "id ", "token": 's3"cret'},
            registry=registry,
        )

        assert result["query"] == r'{"term": {"user": "id s3\"cret"}}'
        assert registry.registered == [(r"s3\"cret", "template escape")]

    def test_the_run_registry_scrubs_a_secret_escaped_inside_a_larger_value(self) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("token", "pass(word)", "variable")

        _resolve_query(
            {"query": "msg: {{ prefix + token }}"},
            {"prefix": "id ", "token": "pass(word)"},
            registry=registry,
        )

        assert r"pass\(word\)" in registry.scan_values()

    def test_the_run_registry_scrubs_a_secret_leaf_in_a_standing_alone_json_map(self) -> None:
        from wavecore.core.secrets.masking import mask_text
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("keys", ["pa\bss\fw0rd", "second-k3y"], "variable")

        result = _resolve_query(
            {"query_language": "query_dsl", "query": '{"match": {{ filter }}}'},
            {"filter": {"pw": "pa\bss\fw0rd"}},
            registry=registry,
        )

        assert result["query"] == r'{"match": {"pw":"pa\bss\fw0rd"}}'
        assert mask_text(result["query"], registry.scan_values()) == '{"match": {"pw":"********"}}'

    @pytest.mark.parametrize(
        ("value", "filled"),
        [
            (_SECRET_TABLE, '[{"name":"alpha","qty":1}]'),
            (["alpha", 1e-07], '["alpha",1e-07]'),
            ({"host": "db.internal", "rate": 1e-07}, '{"host":"db.internal","rate":1e-07}'),
        ],
        ids=["table", "list", "map"],
    )
    def test_the_run_registry_scrubs_a_secret_container_standing_alone_in_json(
        self, value: Any, filled: str
    ) -> None:
        from wavecore.core.secrets.masking import mask_text
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("rows", value, "variable")

        result = _resolve_query(
            {"query_language": "query_dsl", "query": '{"terms": {{ rows }}}'},
            {"rows": value},
            registry=registry,
        )

        assert result["query"] == '{"terms": ' + filled + "}"
        assert mask_text(result["query"], registry.scan_values()) == '{"terms": ********}'

    def test_the_run_registry_scrubs_a_secret_table_filled_inside_a_json_string(self) -> None:
        from wavecore.core.secrets.masking import mask_text
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("rows", _SECRET_TABLE, "variable")

        result = _resolve_query(
            {"query_language": "query_dsl", "query": '{"m": "{{ rows }}"}'},
            {"rows": _SECRET_TABLE},
            registry=registry,
        )

        assert result["query"] == r'{"m": "[{\"name\":\"alpha\",\"qty\":1}]"}'
        assert mask_text(result["query"], registry.scan_values()) == '{"m": "********"}'

    def test_a_value_that_is_no_secret_registers_nothing(self) -> None:
        registry = _SpyRegistry(("hunter2secret",))

        _resolve_query(
            {"query": "user.name: {{ user }}"}, {"user": "ann or bob"}, registry=registry
        )

        assert registry.registered == []

    def test_a_template_field_without_a_spec_registers_nothing(self) -> None:
        registry = _SpyRegistry(("pass or word",))

        result = _resolve_query(
            {"body": "say {{ token }}"},
            {"token": "pass or word"},
            template_fields={"query", "body"},
            registry=registry,
        )

        assert result["body"] == "say pass or word"
        assert registry.registered == []

    def test_the_run_registry_scrubs_the_escaped_form(self) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("token", "pass or word", "variable")

        _resolve_query(
            {"query": "user.name: {{ token }}"}, {"token": "pass or word"}, registry=registry
        )

        assert r"pass \or word" in registry.scan_values()

    def test_without_a_registry_the_value_is_still_escaped(self) -> None:
        result = _resolve_query({"query": "user.name: {{ token }}"}, {"token": "pass or word"})

        assert result["query"] == r"user.name: pass \or word"


def _null_piece(expression: str, setting: str) -> str:
    """The exact refusal for a null ``{{ }}`` piece (REQ-3.1.3.22)."""
    return f"'{{{{ {expression} }}}}' in '{setting}' is null"


def _fill(template: str, variables: dict[str, Any], **marks: Any) -> str:
    """The shared ``{{ }}`` fill, called the way every field calls it."""
    from wavecore.core.execution import plugin_executor

    marks.setdefault("setting", "url")
    return plugin_executor._evaluate_template(template, variables, **marks)


class TestTemplateFillNullPieces:
    """A ``{{ }}`` piece whose result is null fails and names the piece (REQ-3.1.3.22)."""

    def test_a_null_piece_names_the_piece_and_the_setting(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        message = "'{{ user_id }}' in 'url' is null"
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            _fill("https://api.example.com/users/{{ user_id }}", {"user_id": None})

    @pytest.mark.parametrize(
        "marker", ["{{user_id}}", "{{   user_id   }}"], ids=["no-spaces", "wide-spaces"]
    )
    def test_the_piece_is_named_with_its_text_stripped(self, marker: str) -> None:
        from wavecore.core.expressions.errors import NullValueError

        message = _null_piece("user_id", "url")
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            _fill(f"/users/{marker}", {"user_id": None})

    def test_the_null_piece_is_named_among_filled_pieces(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        message = _null_piece("b", "body")
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            _fill("a={{ a }} b={{ b }} c={{ c }}", {"a": 1, "b": None, "c": 3}, setting="body")

    def test_the_check_is_on_the_result_of_the_whole_piece(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        message = _null_piece("m.get('k')", "url")
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            _fill("/items/{{ m.get('k') }}", {"m": {}})

    @pytest.mark.parametrize(
        "piece",
        ["x if x is not None else 'd'", 'x if x is not None else "d"', "x or 'd'"],
        ids=["conditional-single-quotes", "conditional-double-quotes", "or"],
    )
    def test_a_piece_that_falls_back_is_not_null(self, piece: str) -> None:
        assert _fill("/items/{{ " + piece + " }}", {"x": None}) == "/items/d"

    def test_an_empty_marker_is_not_a_null_piece(self) -> None:
        assert _fill("empty: {{ }}", {}) == "empty: {{ }}"

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (True, "v=True"),
            ([1, 2, 3], "v=[1, 2, 3]"),
            ("on", "v=on"),
            (0, "v=0"),
            ("", "v="),
        ],
        ids=["boolean", "list", "text", "zero", "empty-text"],
    )
    def test_a_non_null_piece_keeps_its_text(self, value: Any, expected: str) -> None:
        assert _fill("v={{ v }}", {"v": value}, setting="body") == expected

    def test_the_null_error_is_an_expression_evaluation_error(self) -> None:
        from wavecore.core.expressions.errors import ExpressionEvaluationError, NullValueError

        with pytest.raises(NullValueError) as caught:
            _fill("{{ x }}", {"x": None})

        assert isinstance(caught.value, ExpressionEvaluationError)

    def test_a_piece_that_fails_on_null_reports_the_null_value(self) -> None:
        from wavecore.core.expressions.errors import ExpressionEvaluationError

        message = "A value is null: unsupported operand type(s) for +: 'null' and 'int'"
        with pytest.raises(ExpressionEvaluationError, match=f"^{re.escape(message)}$"):
            _fill("n={{ x + 1 }}", {"x": None}, setting="body")


class TestTemplateFillPrintMark:
    """A field marked to print null writes every piece in WAVE's print form (REQ-3.1.3.23)."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (None, "v=null"),
            (True, "v=true"),
            (False, "v=false"),
            ([1, None, "a"], 'v=[1,null,"a"]'),
            ({"a": None, "b": True}, 'v={"a":null,"b":true}'),
            ("ann", "v=ann"),
            (42, "v=42"),
        ],
        ids=["null", "true", "false", "list", "map", "text", "integer"],
    )
    def test_each_piece_prints_in_the_print_form(self, value: Any, expected: str) -> None:
        assert (
            _fill("v={{ v }}", {"v": value}, setting="message", null_piece_prints=True) == expected
        )

    def test_a_log_message_prints_its_null_boolean_and_list_pieces(self) -> None:
        from wavecore.core.execution import plugin_executor
        from wavecore.plugins.log import LogPlugin

        policies = plugin_executor.null_policy_fields(LogPlugin().metadata["parameters"])

        result = plugin_executor.resolve_parameters(
            {"message": "user={{ user }} ok={{ ok }} ids={{ ids }}"},
            set(),
            {"user": None, "ok": True, "ids": [1, None]},
            {"message": "string"},
            template_fields={"message"},
            null_policies=policies,
        )

        assert result["message"] == "user=null ok=true ids=[1,null]"

    def test_an_http_body_keeps_the_text_of_its_non_null_pieces(self) -> None:
        from wavecore.core.execution import plugin_executor
        from wavecore.plugins.http_client import HTTPClientPlugin

        policies = plugin_executor.null_policy_fields(HTTPClientPlugin().metadata["parameters"])

        result = plugin_executor.resolve_parameters(
            {"body": "flag={{ flag }} ids={{ ids }}"},
            set(),
            {"flag": True, "ids": [1, 2, 3]},
            {"body": "string"},
            template_fields={"body"},
            null_policies=policies,
        )

        assert result["body"] == "flag=True ids=[1, 2, 3]"

    def test_an_http_body_refuses_a_null_piece(self) -> None:
        from wavecore.core.execution import plugin_executor
        from wavecore.core.expressions.errors import NullValueError
        from wavecore.plugins.http_client import HTTPClientPlugin

        policies = plugin_executor.null_policy_fields(HTTPClientPlugin().metadata["parameters"])

        with pytest.raises(NullValueError, match=f"^{re.escape(_null_piece('token', 'body'))}$"):
            plugin_executor.resolve_parameters(
                {"body": '{"token": "{{ token }}"}'},
                set(),
                {"token": None},
                {"body": "string"},
                template_fields={"body"},
                null_policies=policies,
            )


class TestResolveParametersNullPieces:
    """Every template field and map template entry goes through the shared fill."""

    def test_a_template_field_with_a_null_piece_fails_and_names_it(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import NullValueError

        message = "'{{ user_id }}' in 'url' is null"
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            resolve_parameters(
                {"url": "https://api.example.com/users/{{ user_id }}"},
                set(),
                {"user_id": None},
                {"url": "string"},
                template_fields={"url"},
            )

    def test_a_template_field_piece_that_falls_back_fills_in(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters

        result = resolve_parameters(
            {"url": "https://api.example.com/users/{{ x if x is not None else 'd' }}"},
            set(),
            {"x": None},
            {"url": "string"},
            template_fields={"url"},
        )

        assert result["url"] == "https://api.example.com/users/d"

    def test_a_map_template_entry_with_a_null_piece_names_the_setting(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(
            NullValueError, match=f"^{re.escape(_null_piece('name', 'variables'))}$"
        ):
            resolve_parameters(
                {"variables": {"greeting": "hi {{ name }}", "plain": "x"}},
                set(),
                {"name": None},
                {"variables": "map"},
                map_template_keys={"variables": {"greeting"}},
            )

    def test_a_variable_setter_template_row_refuses_a_null_piece(self) -> None:
        from wavecore.controls.variable_setter import VariableSetterControl
        from wavecore.core.execution import plugin_executor
        from wavecore.core.expressions.errors import NullValueError

        policies = plugin_executor.null_policy_fields(
            VariableSetterControl().metadata["parameter_schema"]
        )

        with pytest.raises(
            NullValueError, match=f"^{re.escape(_null_piece('name', 'variables'))}$"
        ):
            plugin_executor.resolve_parameters(
                {"variables": {"greeting": "hi {{ name }}"}},
                set(),
                {"name": None},
                {"variables": "map"},
                map_template_keys={"variables": {"greeting"}},
                null_policies=policies,
            )

    def test_a_map_template_entry_fills_its_pieces(self) -> None:
        from wavecore.core.execution import plugin_executor

        result = plugin_executor._resolve_map_template_entry(
            "hi {{ name }}", {"name": "ann"}, setting="variables"
        )

        assert result == "hi ann"

    def test_a_map_template_entry_names_the_setting_it_was_given(self) -> None:
        from wavecore.core.execution import plugin_executor
        from wavecore.core.expressions.errors import NullValueError

        message = _null_piece("name", "assignments")
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            plugin_executor._resolve_map_template_entry(
                "hi {{ name }}", {"name": None}, setting="assignments"
            )


class TestQueryNullPieces:
    """OS-5: a null piece standing alone in Query DSL is JSON null; anywhere else it fails."""

    def test_a_null_standing_alone_in_query_dsl_is_json_null(self) -> None:
        result = _resolve_query(
            {"query_language": "query_dsl", "query": '{"term": {"user.id": {{ uid }}}}'},
            {"uid": None},
        )

        assert result["query"] == '{"term": {"user.id": null}}'

    @pytest.mark.parametrize(
        ("language", "query"),
        [
            ("query_dsl", '{"term": {"user.id": "{{ uid }}"}}'),
            ("dql", "user.id: {{ uid }}"),
            ("dql", 'user.id: "{{ uid }}"'),
        ],
        ids=["query-dsl-inside-quotes", "dql-outside-quotes", "dql-inside-quotes"],
    )
    def test_a_null_anywhere_else_fails_and_names_the_query(
        self, language: str, query: str
    ) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=f"^{re.escape(_null_piece('uid', 'query'))}$"):
            _resolve_query({"query_language": language, "query": query}, {"uid": None})


class TestExpressionsThatMeetNull:
    """An expression that fails because a value is null says so (REQ-3.1.3.23)."""

    @pytest.mark.parametrize(
        ("expression", "variables", "message"),
        [
            (
                "None + 1",
                {},
                "A value is null: unsupported operand type(s) for +: 'null' and 'int'",
            ),
            (
                "'a' + None",
                {},
                'A value is null: can only concatenate str (not "null") to str',
            ),
            (
                "x + y",
                {"x": None, "y": None},
                "A value is null: unsupported operand type(s) for +: 'null' and 'null'",
            ),
            (
                "x.upper()",
                {"x": None},
                "A value is null: 'null' object has no attribute 'upper'",
            ),
            ("x[0]", {"x": None}, "A value is null: 'null' object is not subscriptable"),
            ("len(x)", {"x": None}, "A value is null: object of type 'null' has no len()"),
            (
                "x > 1",
                {"x": None},
                "A value is null: '>' not supported between instances of 'null' and 'int'",
            ),
            (
                "int(x)",
                {"x": None},
                "A value is null: int() argument must be a string, a bytes-like object "
                "or a real number, not 'null'",
            ),
        ],
        ids=[
            "none-plus-one",
            "text-plus-none",
            "two-nulls",
            "attribute",
            "subscript",
            "length",
            "comparison",
            "conversion",
        ],
    )
    def test_python_none_type_is_written_null(
        self, expression: str, variables: dict[str, Any], message: str
    ) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import ExpressionEvaluationError

        with pytest.raises(ExpressionEvaluationError, match=f"^{re.escape(message)}$"):
            evaluate_expression(expression, variables)

    def test_a_field_expression_that_fails_on_null_reports_the_null_value(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import ExpressionEvaluationError

        message = "A value is null: unsupported operand type(s) for *: 'null' and 'int'"
        with pytest.raises(ExpressionEvaluationError, match=f"^{re.escape(message)}$"):
            resolve_parameters(
                {"timeout": "base * 2"}, {"timeout"}, {"base": None}, {"timeout": "integer"}
            )

    @pytest.mark.parametrize(
        ("expression", "variables", "message"),
        [
            (
                "x + 1",
                {"x": "a"},
                "Expression evaluation failed for 'x + 1': "
                'can only concatenate str (not "int") to str',
            ),
            ("1 / 0", {}, "Expression evaluation failed for '1 / 0': division by zero"),
        ],
        ids=["type-error", "division-by-zero"],
    )
    def test_a_failure_with_no_null_keeps_the_evaluation_message(
        self, expression: str, variables: dict[str, Any], message: str
    ) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match=f"^{re.escape(message)}$"):
            evaluate_expression(expression, variables)


_METHOD_FIELD: dict[str, Any] = {
    "name": "method",
    "type": "string",
    "trim": True,
    "required": True,
    "default": "GET",
    "enum_values": ["GET", "POST", "PUT"],
}
_URL_FIELD: dict[str, Any] = {"name": "url", "type": "string", "trim": True, "required": True}
_LEVEL_FIELD: dict[str, Any] = {
    "name": "level",
    "type": "string",
    "required": False,
    "default": "low",
    "enum_values": ["low", "high"],
}
_LEVEL_REFUSED = "Parameter 'level' must be one of: low, high; Actual value was 'x'."
_HTTP_FIELDS: list[dict[str, Any]] = [_METHOD_FIELD, _URL_FIELD]
_HTTP_URL = "http://example.com/"


def _function_input(name: str, value_type: str, **extra: Any) -> dict[str, Any]:
    """A Function input as the Function adapter gives it; a Required one carries no default."""
    field: dict[str, Any] = {
        "name": name,
        "type": value_type,
        "required": True,
        "description": "",
        "secret": False,
        "accepts_null": False,
    }
    field.update(extra)
    return field


def _fill_defaults(
    stored: dict[str, Any],
    fields: list[dict[str, Any]],
    expression_fields: set[str] | None = None,
) -> dict[str, Any]:
    from wavecore.core.execution.plugin_executor import fill_field_defaults

    return fill_field_defaults(stored, fields, expression_fields=expression_fields or set())


async def _resolve_fields(
    stored: dict[str, Any], fields: list[dict[str, Any]], **settings: Any
) -> dict[str, Any]:
    from wavecore.core.execution.plugin_executor import resolve_block_fields

    options: dict[str, Any] = {
        "expression_fields": set(),
        "template_fields": set(),
        "element_types": {},
        "variables": {},
        "session_id": None,
        "exact_numbers": False,
    }
    options.update(settings)
    return resolve_block_fields(stored, fields, **options)


class TestFillFieldDefaultsFillsWhatTheBlockLeavesOut:
    """A field left out runs on its default, realized by its type (REQ-3.1.1.5, REQ-3.4.2.3)."""

    def test_a_missing_field_is_filled_from_its_default(self) -> None:
        assert _fill_defaults({}, [_LEVEL_FIELD]) == {"level": "low"}

    def test_a_required_field_with_a_default_is_filled(self) -> None:
        filled = _fill_defaults({"url": _HTTP_URL}, _HTTP_FIELDS)

        assert filled == {"url": _HTTP_URL, "method": "GET"}

    def test_an_integer_default_is_an_exact_int(self) -> None:
        field = {"name": "retries", "type": "integer", "default": 12345678901234567891}

        filled = _fill_defaults({}, [field])

        assert filled == {"retries": 12345678901234567891}
        assert type(filled["retries"]) is int

    def test_a_float_default_is_an_exact_decimal(self) -> None:
        from decimal import Decimal

        filled = _fill_defaults({}, [{"name": "ratio", "type": "float", "default": 0.1}])

        assert isinstance(filled["ratio"], Decimal)
        assert filled["ratio"] == Decimal("0.1")

    def test_a_whole_number_float_default_stays_a_float(self) -> None:
        from decimal import Decimal

        filled = _fill_defaults({}, [{"name": "ratio", "type": "float", "default": 2.0}])

        assert isinstance(filled["ratio"], Decimal)
        assert str(filled["ratio"]) == "2.0"

    def test_an_integer_written_as_a_float_default_is_a_decimal(self) -> None:
        from decimal import Decimal

        filled = _fill_defaults({}, [{"name": "ratio", "type": "float", "default": 5}])

        assert isinstance(filled["ratio"], Decimal)
        assert filled["ratio"] == Decimal(5)

    def test_a_list_default_realizes_its_item_types(self) -> None:
        from decimal import Decimal

        field = {
            "name": "codes",
            "type": "array",
            "default": ["7", "2.5", "x"],
            "default_element_types": ["integer", "float", "string"],
        }

        filled = _fill_defaults({}, [field])

        assert filled["codes"] == [7, Decimal("2.5"), "x"]
        assert type(filled["codes"][0]) is int
        assert isinstance(filled["codes"][1], Decimal)
        assert filled["codes"] is not field["default"]

    def test_a_map_default_realizes_its_value_types(self) -> None:
        from decimal import Decimal

        field = {
            "name": "limits",
            "type": "map",
            "default": {"n": "3", "f": "1.5"},
            "default_element_types": {"n": "integer", "f": "float"},
        }

        filled = _fill_defaults({}, [field])

        assert filled["limits"] == {"n": 3, "f": Decimal("1.5")}
        assert isinstance(filled["limits"]["f"], Decimal)

    def test_a_table_default_is_a_table(self) -> None:
        from wavecore.core.table import Table

        field = {
            "name": "rows",
            "type": "table",
            "default": {"columns": [{"name": "id", "type": "integer"}], "rows": [[1], [2]]},
        }

        filled = _fill_defaults({}, [field])

        assert isinstance(filled["rows"], Table)
        assert filled["rows"].to_list() == [{"id": 1}, {"id": 2}]

    @pytest.mark.parametrize("blank", ["", "   "], ids=["empty", "whitespace"])
    def test_a_blank_whole_field_expression_is_filled(self, blank: str) -> None:
        filled = _fill_defaults({"url": _HTTP_URL, "method": blank}, _HTTP_FIELDS, {"method"})

        assert filled["method"] == "GET"

    def test_an_optional_field_with_no_default_stays_left_out(self) -> None:
        filled = _fill_defaults({}, [{"name": "to_revision", "type": "integer"}])

        assert filled == {}

    def test_the_stored_values_are_left_as_they_were(self) -> None:
        stored = {"url": _HTTP_URL}

        _fill_defaults(stored, _HTTP_FIELDS)

        assert stored == {"url": _HTTP_URL}


class TestFillFieldDefaultsKeepsWhatTheBlockHolds:
    """A value the Block holds is its own, whatever the default says (REQ-3.1.1.5)."""

    def test_a_set_value_is_kept(self) -> None:
        filled = _fill_defaults({"url": _HTTP_URL, "method": "POST"}, _HTTP_FIELDS)

        assert filled == {"url": _HTTP_URL, "method": "POST"}

    def test_a_whole_field_expression_with_text_is_kept(self) -> None:
        filled = _fill_defaults({"url": _HTTP_URL, "method": "verb"}, _HTTP_FIELDS, {"method"})

        assert filled["method"] == "verb"

    def test_an_empty_literal_text_is_a_value(self) -> None:
        field = {"name": "pattern", "type": "string", "default": ".*"}

        assert _fill_defaults({"pattern": ""}, [field]) == {"pattern": ""}

    def test_a_blank_entry_expression_is_not_a_whole_field_expression(self) -> None:
        field = {"name": "headers", "type": "map", "default": {"Accept": "*/*"}}

        filled = _fill_defaults({"headers": {"X-Id": ""}}, [field], {"headers.X-Id"})

        assert filled == {"headers": {"X-Id": ""}}

    def test_a_stored_null_on_a_required_field_that_accepts_null_is_kept(self) -> None:
        field = {"name": "message", "type": "string", "required": True, "accepts_null": True}

        assert _fill_defaults({"message": None}, [field]) == {"message": None}

    def test_a_stored_null_on_an_optional_function_input_is_kept(self) -> None:
        field = _function_input("note", "string", required=False, accepts_null=True)

        assert _fill_defaults({"note": None}, [field]) == {"note": None}

    def test_a_stored_null_on_a_field_with_a_default_takes_the_default(self) -> None:
        field = {"name": "timeout", "type": "integer", "default": 30}

        assert _fill_defaults({"timeout": None}, [field]) == {"timeout": 30}

    def test_a_stored_null_on_a_field_with_no_default_stays_null(self) -> None:
        field = {"name": "csv_content", "type": "string"}

        assert _fill_defaults({"csv_content": None}, [field]) == {"csv_content": None}


class TestFillFieldDefaultsRefusesARequiredFieldWithNothing:
    """A Required field with no value and no default stops the Block and names it."""

    def test_a_required_field_left_out_fails_naming_it(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=r"^'url' is null$"):
            _fill_defaults({"method": "GET"}, _HTTP_FIELDS)

    @pytest.mark.parametrize("blank", ["", "  "], ids=["empty", "whitespace"])
    def test_a_required_field_with_a_blank_expression_fails_naming_it(self, blank: str) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=r"^'url' is null$"):
            _fill_defaults({"method": "GET", "url": blank}, _HTTP_FIELDS, {"url"})

    def test_a_required_field_holding_null_fails_naming_it(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=r"^'url' is null$"):
            _fill_defaults({"method": "GET", "url": None}, _HTTP_FIELDS)

    def test_a_required_function_input_is_never_filled(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=r"^'count' is null$"):
            _fill_defaults({}, [_function_input("count", "integer")])

    def test_a_required_function_input_declared_with_a_default_is_never_filled(self) -> None:
        """REQ-3.1.2.10: the declared default serves only a Function run on its own."""
        from wavecore.core.expressions.errors import NullValueError
        from wavecore.core.functions.block_fields import function_block_fields

        definition = {
            "inputs": [{"name": "count", "type": "integer", "required": True, "default": 5}],
            "outputs": [],
        }

        with pytest.raises(NullValueError, match=r"^'count' is null$"):
            _fill_defaults({}, function_block_fields(definition))

    def test_a_required_function_input_given_a_value_keeps_it(self) -> None:
        assert _fill_defaults({"count": 3}, [_function_input("count", "integer")]) == {"count": 3}


class TestResolveBlockFieldsRunsTheStoredFields:
    """The one run entry: drop, fill, resolve, check allowed values (REQ-3.4.2.3)."""

    async def test_a_stored_name_the_schema_does_not_declare_is_dropped(self) -> None:
        resolved = await _resolve_fields(
            {"url": _HTTP_URL, "method": "GET", "retired": "x"}, _HTTP_FIELDS
        )

        assert resolved == {"url": _HTTP_URL, "method": "GET"}

    async def test_a_dropped_expression_is_never_evaluated(self) -> None:
        resolved = await _resolve_fields(
            {"url": _HTTP_URL, "retired": "no_such_variable"},
            _HTTP_FIELDS,
            expression_fields={"retired"},
        )

        assert "retired" not in resolved

    async def test_a_missing_field_runs_on_its_default(self) -> None:
        resolved = await _resolve_fields({"url": _HTTP_URL}, _HTTP_FIELDS)

        assert resolved == {"url": _HTTP_URL, "method": "GET"}

    async def test_a_blank_whole_field_expression_runs_on_its_default(self) -> None:
        resolved = await _resolve_fields(
            {"url": _HTTP_URL, "method": " "}, _HTTP_FIELDS, expression_fields={"method"}
        )

        assert resolved["method"] == "GET"

    async def test_a_required_field_with_nothing_fails_before_the_block_runs(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=r"^'url' is null$"):
            await _resolve_fields({}, _HTTP_FIELDS)

    async def test_the_stored_values_are_left_as_they_were(self) -> None:
        stored = {"url": _HTTP_URL, "retired": 1}

        await _resolve_fields(stored, _HTTP_FIELDS)

        assert stored == {"url": _HTTP_URL, "retired": 1}


class TestResolveBlockFieldsReadsItsMetadataFromTheFieldList:
    """Types, trim, references, wire format and templates come from the field list."""

    async def test_an_expression_field_resolves_against_the_variables(self) -> None:
        fields = [{"name": "timeout", "type": "integer"}]

        resolved = await _resolve_fields(
            {"timeout": "base * 2"},
            fields,
            expression_fields={"timeout"},
            variables={"base": 21},
        )

        assert resolved == {"timeout": 42}

    async def test_an_expression_result_is_checked_against_the_field_type(self) -> None:
        from wavecore.core.expressions.errors import ExpressionTypeError

        with pytest.raises(
            ExpressionTypeError, match=r"^Parameter 'timeout' expects integer, got str$"
        ):
            await _resolve_fields(
                {"timeout": "'soon'"},
                [{"name": "timeout", "type": "integer"}],
                expression_fields={"timeout"},
            )

    async def test_a_template_field_fills_its_markers(self) -> None:
        resolved = await _resolve_fields(
            {"body": "Hello {{ name }}"},
            [{"name": "body", "type": "string"}],
            template_fields={"body"},
            variables={"name": "Ada"},
        )

        assert resolved == {"body": "Hello Ada"}

    async def test_an_entry_expression_resolves_inside_its_map(self) -> None:
        resolved = await _resolve_fields(
            {"headers": {"X-Id": "request_id", "Accept": "text/plain"}},
            [{"name": "headers", "type": "map"}],
            expression_fields={"headers.X-Id"},
            variables={"request_id": "abc"},
        )

        assert resolved == {"headers": {"X-Id": "abc", "Accept": "text/plain"}}

    async def test_a_list_item_expression_runs_as_written_whatever_type_it_had(self) -> None:
        resolved = await _resolve_fields(
            {"params": ['"abc"', "7"]},
            [{"name": "params", "type": "array", "typed_values": True}],
            expression_fields={"params.0"},
            element_types={"params": ["map", "integer"]},
        )

        assert resolved == {"params": ["abc", 7]}

    async def test_a_trimmed_field_is_stripped(self) -> None:
        resolved = await _resolve_fields({"url": f"  {_HTTP_URL}\n"}, _HTTP_FIELDS)

        assert resolved["url"] == _HTTP_URL

    async def test_a_reference_field_resolves_the_named_variable(self) -> None:
        from wavecore.core.table import Table

        table = Table(columns=[("id", "integer")])
        fields = [{"name": "table", "type": "table", "variable_ref": True}]

        resolved = await _resolve_fields({"table": "rows"}, fields, variables={"rows": table})

        assert resolved["table"] is table

    async def test_a_wire_format_field_reaches_the_block_as_json_text(self) -> None:
        fields = [{"name": "manifest", "type": "string", "wire_format": "json"}]

        resolved = await _resolve_fields({"manifest": _ONE_DOCUMENT}, fields)

        assert json.loads(resolved["manifest"]) == _ONE_OBJECT


class TestResolveBlockFieldsChecksAllowedValues:
    """A value outside a field's allowed values stops the Block (REQ-3.4.2.3, REQ-3.1.2.11)."""

    async def test_a_literal_outside_the_allowed_values_is_refused(self) -> None:
        with pytest.raises(ValueError, match=f"^{re.escape(_LEVEL_REFUSED)}$"):
            await _resolve_fields({"level": "x"}, [_LEVEL_FIELD])

    async def test_an_expression_outside_the_allowed_values_is_refused(self) -> None:
        with pytest.raises(ValueError, match=f"^{re.escape(_LEVEL_REFUSED)}$"):
            await _resolve_fields(
                {"level": "chosen"},
                [_LEVEL_FIELD],
                expression_fields={"level"},
                variables={"chosen": "x"},
            )

    async def test_an_allowed_value_runs(self) -> None:
        assert await _resolve_fields({"level": "high"}, [_LEVEL_FIELD]) == {"level": "high"}

    async def test_a_filled_default_is_an_allowed_value(self) -> None:
        assert await _resolve_fields({}, [_LEVEL_FIELD]) == {"level": "low"}

    async def test_typed_allowed_values_compare_by_type(self) -> None:
        field = _function_input("port", "integer", enum_values=[80, 443])
        refused = "Parameter 'port' must be one of: 80, 443; Actual value was '8080'."

        assert await _resolve_fields({"port": 443}, [field], exact_numbers=True) == {"port": 443}
        with pytest.raises(ValueError, match=f"^{re.escape(refused)}$"):
            await _resolve_fields({"port": 8080}, [field], exact_numbers=True)

    async def test_a_choice_field_left_out_with_no_default_is_not_checked(self) -> None:
        field = {"name": "tls", "type": "string", "enum_values": ["disable", "require"]}

        assert await _resolve_fields({}, [field]) == {}


class TestResolveBlockFieldsNumberEdge:
    """Plugins and controls get platform floats; a Function Block keeps exact numbers
    (REQ-3.1.3.14)."""

    async def test_the_plugin_edge_reduces_an_exact_float(self) -> None:
        from wavecore.core.variables.decimal_value import WaveDecimal

        resolved = await _resolve_fields(
            {"ratio": WaveDecimal("1.5")}, [{"name": "ratio", "type": "float"}]
        )

        assert resolved["ratio"] == 1.5
        assert type(resolved["ratio"]) is float

    async def test_the_plugin_edge_reduces_a_filled_float_default(self) -> None:
        resolved = await _resolve_fields({}, [{"name": "ratio", "type": "float", "default": 2.0}])

        assert resolved["ratio"] == 2.0
        assert type(resolved["ratio"]) is float

    async def test_the_plugin_edge_reduces_typed_value_entries(self) -> None:
        from wavecore.core.variables.decimal_value import WaveDecimal

        fields = [{"name": "options", "type": "map", "typed_values": True}]

        resolved = await _resolve_fields({"options": {"timeout": WaveDecimal("2.5")}}, fields)

        assert resolved["options"] == {"timeout": 2.5}
        assert type(resolved["options"]["timeout"]) is float

    async def test_exact_numbers_keep_a_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.core.variables.decimal_value import WaveDecimal

        resolved = await _resolve_fields(
            {"ratio": WaveDecimal("1.25")},
            [_function_input("ratio", "float")],
            exact_numbers=True,
        )

        assert isinstance(resolved["ratio"], Decimal)
        assert resolved["ratio"] == Decimal("1.25")

    async def test_exact_numbers_keep_a_whole_number_float_a_float(self) -> None:
        from decimal import Decimal

        from wavecore.core.variables.decimal_value import WaveDecimal

        resolved = await _resolve_fields(
            {"ratio": WaveDecimal("2.0")},
            [_function_input("ratio", "float")],
            exact_numbers=True,
        )

        assert isinstance(resolved["ratio"], Decimal)
        assert str(resolved["ratio"]) == "2.0"

    async def test_exact_numbers_keep_a_filled_whole_number_float_default(self) -> None:
        from decimal import Decimal

        field = _function_input("ratio", "float", required=False, default=2.0)

        resolved = await _resolve_fields({}, [field], exact_numbers=True)

        assert isinstance(resolved["ratio"], Decimal)
        assert str(resolved["ratio"]) == "2.0"

    async def test_exact_numbers_keep_an_expression_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.core.variables.decimal_value import WaveDecimal

        resolved = await _resolve_fields(
            {"amount": "price"},
            [_function_input("amount", "float")],
            expression_fields={"amount"},
            variables={"price": WaveDecimal("0.10")},
            exact_numbers=True,
        )

        assert isinstance(resolved["amount"], Decimal)
        assert str(resolved["amount"]) == "0.10"

    async def test_exact_numbers_keep_typed_value_entries(self) -> None:
        from decimal import Decimal

        from wavecore.core.variables.decimal_value import WaveDecimal

        field = _function_input("options", "map", typed_values=True)

        resolved = await _resolve_fields(
            {"options": {"timeout": WaveDecimal("2.5")}}, [field], exact_numbers=True
        )

        assert isinstance(resolved["options"]["timeout"], Decimal)
        assert resolved["options"]["timeout"] == Decimal("2.5")


class TestResolveBlockFieldsRealizesNumberLiterals:
    """A number field's literal reaches the Block as the number its digits stand for
    (REQ-3.1.3.14)."""

    async def test_integer_digit_text_reaches_the_block_as_an_integer(self) -> None:
        fields = [{"name": "count", "type": "integer"}]

        resolved = await _resolve_fields({"count": "1234567890123456789"}, fields)

        assert resolved == {"count": 1234567890123456789}
        assert type(resolved["count"]) is int

    async def test_float_digit_text_reaches_a_plugin_as_a_platform_float(self) -> None:
        resolved = await _resolve_fields({"ratio": "2.50"}, [{"name": "ratio", "type": "float"}])

        assert resolved["ratio"] == 2.5
        assert type(resolved["ratio"]) is float

    async def test_float_digit_text_reaches_a_function_block_exactly(self) -> None:
        from wavecore.core.variables.decimal_value import WaveDecimal

        resolved = await _resolve_fields(
            {"ratio": "2.50"}, [_function_input("ratio", "float")], exact_numbers=True
        )

        assert isinstance(resolved["ratio"], WaveDecimal)
        assert str(resolved["ratio"]) == "2.50"

    async def test_a_number_literal_passes_as_it_is(self) -> None:
        fields = [{"name": "count", "type": "integer"}, {"name": "ratio", "type": "float"}]

        assert await _resolve_fields({"count": 3, "ratio": 0.5}, fields) == {
            "count": 3,
            "ratio": 0.5,
        }

    @pytest.mark.parametrize(
        ("value", "said"),
        [
            ("3s", "Setting 'duration' is not a valid integer"),
            ("1e3", "Setting 'duration' is not a valid integer"),
            ("12345678901234567890", "Setting 'duration' allows at most 19 digits, got 20"),
        ],
        ids=["unit", "exponent", "20-digits"],
    )
    async def test_text_that_is_not_the_number_stops_the_block(self, value: str, said: str) -> None:
        with pytest.raises(ValueError, match=f"^{re.escape(said)}$"):
            await _resolve_fields({"duration": value}, [{"name": "duration", "type": "integer"}])

    @pytest.mark.parametrize("blank", ["", "  "], ids=["empty", "spaces"])
    async def test_blank_text_in_a_number_field_takes_the_default(self, blank: str) -> None:
        field = {"name": "timeout", "type": "integer", "default": 30}

        assert await _resolve_fields({"timeout": blank}, [field]) == {"timeout": 30}

    async def test_blank_text_in_a_number_field_with_no_default_is_left_out(self) -> None:
        assert await _resolve_fields({"port": ""}, [{"name": "port", "type": "integer"}]) == {}

    async def test_blank_text_in_a_required_number_field_is_refused_as_null(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        field = {"name": "port", "type": "integer", "required": True}

        with pytest.raises(NullValueError, match=r"^'port' is null$"):
            await _resolve_fields({"port": ""}, [field])

    async def test_text_in_a_text_or_number_field_stays_text(self) -> None:
        field = {"name": "from", "type": ["string", "integer"]}

        assert await _resolve_fields({"from": "15"}, [field]) == {"from": "15"}

    async def test_a_reference_number_field_reads_its_variable(self) -> None:
        field = {"name": "count", "type": "integer", "variable_ref": True}

        assert await _resolve_fields({"count": "n"}, [field], variables={"n": 5}) == {"count": 5}

    async def test_a_template_number_field_is_left_to_its_template(self) -> None:
        resolved = await _resolve_fields(
            {"count": "{{ n }}"},
            [{"name": "count", "type": "integer"}],
            template_fields={"count"},
            variables={"n": 5},
        )

        assert resolved == {"count": "5"}

    async def test_a_field_that_takes_any_type_keeps_its_text(self) -> None:
        field = {"name": "value", "type": "float", "accepts_any_type": True}

        assert await _resolve_fields({"value": "1e5"}, [field]) == {"value": "1e5"}

    async def test_allowed_values_compare_exactly(self) -> None:
        field = _function_input("ratio", "float", enum_values=["2.50", "0.1"])
        refused = "Parameter 'ratio' must be one of: 2.50, 0.1; Actual value was '0.11'."

        resolved = await _resolve_fields({"ratio": "2.5"}, [field], exact_numbers=True)

        assert str(resolved["ratio"]) == "2.5"
        with pytest.raises(ValueError, match=f"^{re.escape(refused)}$"):
            await _resolve_fields({"ratio": "0.11"}, [field], exact_numbers=True)

    async def test_an_allowed_value_that_breaks_the_rule_matches_nothing(self) -> None:
        field = _function_input("port", "integer", enum_values=[" 80", "443"])
        refused = "Parameter 'port' must be one of:  80, 443; Actual value was '80'."

        with pytest.raises(ValueError, match=f"^{re.escape(refused)}$"):
            await _resolve_fields({"port": 80}, [field], exact_numbers=True)


class TestAValueGivenToAFunctionInputIsCheckedByItsType:
    """A Function Block's input is type-checked before the Function flow runs, then
    reaches it as the input's type (REQ-3.1.3.14, REQ-3.1.3.21)."""

    async def test_an_integer_input_bound_to_text_is_refused_before_the_function_flow_runs(
        self,
    ) -> None:
        from wavecore.core.expressions.errors import ExpressionTypeError

        with pytest.raises(ExpressionTypeError, match=r"^Parameter 'n' expects integer, got str$"):
            await _resolve_fields(
                {"n": "label"},
                [_function_input("n", "integer")],
                expression_fields={"n"},
                variables={"label": "abc"},
                exact_numbers=True,
            )

    async def test_a_float_input_given_5_reaches_the_function_flow_as_exact_5(self) -> None:
        from decimal import Decimal

        from wavecore.core.functions.executor import _given_inputs

        resolved = await _resolve_fields(
            {"x": "5"},
            [_function_input("x", "float")],
            expression_fields={"x"},
            exact_numbers=True,
        )
        given = _given_inputs([{"name": "x", "type": "float", "required": True}], resolved)

        assert isinstance(given["x"], Decimal)
        assert given["x"] == Decimal(5)
