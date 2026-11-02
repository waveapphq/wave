"""
Tests for Log Plugin

Implements comprehensive test coverage for requirement:
- REQ-3.4.1.17: Log plugin (write messages to execution log with configurable level)

Following TDD approach with exact error messages and 100% coverage requirement.
"""

import pytest

from wavecore.plugins.log import VALID_LOG_LEVELS, LogPlugin


class TestLogPluginMetadata:
    """Test plugin metadata declaration."""

    def test_level_declares_trim(self):
        """The log level is an enum selection - it declares trim=True."""
        params = {p["name"]: p for p in LogPlugin().metadata["parameters"]}
        assert params["level"].get("trim") is True

    def test_message_param_preserves_whitespace(self):
        """A log message is free-form text - it must never be trimmed."""
        params = {p["name"]: p for p in LogPlugin().metadata["parameters"]}
        assert not params["message"].get("trim")

    def test_metadata_structure(self):
        """Test that metadata contains all required fields."""
        plugin = LogPlugin()
        metadata = plugin.metadata

        assert metadata["id"] == "log"
        assert metadata["name"] == "Log"
        assert metadata["version"] == "1.0.0"
        assert metadata["category"] == "system"
        assert "description" in metadata
        assert "parameters" in metadata
        # Log plugin returns None (writes to log, no return value)
        assert metadata["return_type"] is None

    def test_metadata_parameters(self):
        """Test that all required parameters are defined in metadata."""
        plugin = LogPlugin()
        metadata = plugin.metadata
        params = {p["name"]: p for p in metadata["parameters"]}

        # Required parameter: message
        assert "message" in params
        assert params["message"]["type"] == "string"
        assert params["message"]["required"] is True

        # Optional parameter: level
        assert "level" in params
        assert params["level"]["type"] == "string"
        assert params["level"]["required"] is False
        assert params["level"]["default"] == "INFO"

    def test_level_is_a_choice_list_of_the_log_levels_least_to_most_severe(self):
        """The level offers the five log levels in order, INFO by default (REQ-6.2.1)."""
        params = {p["name"]: p for p in LogPlugin().metadata["parameters"]}

        assert list(params["level"]["enum_values"]) == ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]
        assert params["level"]["default"] == "INFO"

    def test_the_choice_list_and_the_run_check_read_one_ordered_list(self):
        """VALID_LOG_LEVELS is the ordered list both the choice list and validate() read."""
        params = {p["name"]: p for p in LogPlugin().metadata["parameters"]}

        assert VALID_LOG_LEVELS == ("DEBUG", "INFO", "WARN", "ERROR", "FATAL")
        assert tuple(params["level"]["enum_values"]) == VALID_LOG_LEVELS

    def test_the_plugin_model_carries_the_level_choices(self):
        level = {p.name: p for p in LogPlugin().get_plugin_model().parameters}["level"]

        assert level.enum_values == ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]

    def test_metadata_description_content(self):
        """Test that metadata description describes log functionality."""
        plugin = LogPlugin()
        metadata = plugin.metadata

        description = metadata["description"]
        assert "log" in description.lower() or "message" in description.lower()

    def test_metadata_has_author_and_tags(self):
        """Test that metadata includes author and tags."""
        plugin = LogPlugin()
        metadata = plugin.metadata

        assert "author" in metadata
        assert "tags" in metadata
        assert isinstance(metadata["tags"], list)


class TestLogPluginValidation:
    """Test parameter validation."""

    @pytest.mark.asyncio
    async def test_validate_missing_message(self):
        """Test validation fails when message parameter is missing."""
        plugin = LogPlugin()
        params = {}

        with pytest.raises(ValueError, match="^Missing required parameter: message$"):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_message_coerces_int_to_string(self):
        """Test validation coerces non-string message to string."""
        plugin = LogPlugin()
        params = {"message": 123}

        await plugin.validate(params)
        assert params["message"] == "123"

    @pytest.mark.asyncio
    async def test_validate_message_prints_null_as_null(self):
        """A null message is written in WAVE's print form, never as Python's None."""
        plugin = LogPlugin()
        params = {"message": None}

        await plugin.validate(params)
        assert params["message"] == "null"

    @pytest.mark.asyncio
    async def test_validate_message_coerces_list_to_string(self):
        """A list message becomes compact JSON text."""
        plugin = LogPlugin()
        params = {"message": ["msg1", "msg2"]}

        await plugin.validate(params)
        assert params["message"] == '["msg1","msg2"]'

    @pytest.mark.asyncio
    async def test_validate_level_not_string(self):
        """Test validation fails when level is not a string."""
        plugin = LogPlugin()
        params = {"message": "test message", "level": 123}

        with pytest.raises(
            TypeError,
            match="^Parameter 'level' must be a string, got int$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_invalid_level(self):
        """Test validation fails when level is not a valid log level."""
        plugin = LogPlugin()
        params = {"message": "test message", "level": "INVALID"}

        with pytest.raises(
            ValueError,
            match="^Invalid level: 'INVALID'\\. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_invalid_level_lowercase(self):
        """Test validation fails when level is lowercase (must be uppercase)."""
        plugin = LogPlugin()
        params = {"message": "test message", "level": "info"}

        with pytest.raises(
            ValueError,
            match="^Invalid level: 'info'\\. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_invalid_level_warning(self):
        """Test validation fails for 'WARNING' (correct is 'WARN')."""
        plugin = LogPlugin()
        params = {"message": "test message", "level": "WARNING"}

        with pytest.raises(
            ValueError,
            match="^Invalid level: 'WARNING'\\. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_invalid_level_empty_string(self):
        """Test validation fails when level is empty string."""
        plugin = LogPlugin()
        params = {"message": "test message", "level": ""}

        with pytest.raises(
            ValueError,
            match="^Invalid level: ''\\. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_invalid_level_whitespace(self):
        """Test validation fails when level is whitespace only."""
        plugin = LogPlugin()
        params = {"message": "test message", "level": "   "}

        with pytest.raises(
            ValueError,
            match="^Invalid level: '   '\\. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_valid_params_minimal(self):
        """Test validation passes with minimal valid parameters (message only)."""
        plugin = LogPlugin()
        params = {"message": "test message"}

        # Should not raise
        await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_valid_params_empty_message(self):
        """Test validation passes with empty string message."""
        plugin = LogPlugin()
        params = {"message": ""}

        # Empty messages are allowed - useful for logging blank lines
        await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_valid_params_all_levels(self):
        """Test validation passes for all valid log levels."""
        plugin = LogPlugin()

        for level in ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]:
            params = {"message": "test message", "level": level}
            await plugin.validate(params)  # Should not raise

    @pytest.mark.asyncio
    async def test_validate_valid_params_complete(self):
        """Test validation passes with all parameters."""
        plugin = LogPlugin()
        params = {
            "message": "Processing started for user admin_01",
            "level": "INFO",
        }

        # Should not raise
        await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_message_with_variable_syntax(self):
        """Test validation passes with variable expression syntax in message."""
        plugin = LogPlugin()
        params = {"message": "Variable value: some_result"}

        # Validation does not resolve variables - that happens at execution
        await plugin.validate(params)


class TestLogPluginExecution:
    """Test plugin execution."""

    @pytest.mark.asyncio
    async def test_execute_default_level_info(self):
        """Test executing log with default level (INFO)."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        context = {
            "parameters": {"message": "Test log message"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        # Log plugin returns None
        assert result is None
        # Message should be logged at INFO level
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Test log message")

    @pytest.mark.asyncio
    async def test_execute_level_debug(self):
        """Test executing log with DEBUG level."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def debug(self, msg):
                self.messages.append(("debug", msg))

        logger = MockLogger()
        context = {
            "parameters": {"message": "Debug message", "level": "DEBUG"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("debug", "Debug message")

    @pytest.mark.asyncio
    async def test_execute_level_info(self):
        """Test executing log with INFO level explicitly."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        context = {
            "parameters": {"message": "Info message", "level": "INFO"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Info message")

    @pytest.mark.asyncio
    async def test_execute_level_warn(self):
        """Test executing log with WARN level."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def warn(self, msg):
                self.messages.append(("warn", msg))

        logger = MockLogger()
        context = {
            "parameters": {"message": "Warning message", "level": "WARN"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("warn", "Warning message")

    @pytest.mark.asyncio
    async def test_execute_level_error(self):
        """Test executing log with ERROR level."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def error(self, msg):
                self.messages.append(("error", msg))

        logger = MockLogger()
        context = {
            "parameters": {"message": "Error message", "level": "ERROR"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("error", "Error message")

    @pytest.mark.asyncio
    async def test_execute_level_fatal(self):
        """Test executing log with FATAL level."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def fatal(self, msg):
                self.messages.append(("fatal", msg))

        logger = MockLogger()
        context = {
            "parameters": {"message": "Fatal error occurred", "level": "FATAL"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("fatal", "Fatal error occurred")

    @pytest.mark.asyncio
    async def test_execute_without_logger(self):
        """Test executing log without logger (should not fail)."""
        plugin = LogPlugin()
        context = {
            "parameters": {"message": "Test message"},
            "logger": None,
        }

        # Should not raise even without logger
        result = await plugin.execute(context)
        assert result is None

    @pytest.mark.asyncio
    async def test_execute_without_logger_key(self):
        """Test executing log without logger key in context (should not fail)."""
        plugin = LogPlugin()
        context = {
            "parameters": {"message": "Test message"},
        }

        # Should not raise even without logger key
        result = await plugin.execute(context)
        assert result is None

    @pytest.mark.asyncio
    async def test_execute_empty_message(self):
        """Test executing log with empty message."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        context = {
            "parameters": {"message": ""},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "")

    @pytest.mark.asyncio
    async def test_execute_multiline_message(self):
        """Test executing log with multiline message."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        multiline = "Line 1\nLine 2\nLine 3"
        context = {
            "parameters": {"message": multiline},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", multiline)

    @pytest.mark.asyncio
    async def test_execute_with_resolved_parameters(self):
        """Test executing log with pre-resolved message.

        Note: Expression evaluation is done centrally in plugin_executor,
        so LogPlugin receives already-resolved parameters.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved by plugin_executor before reaching LogPlugin
        context = {
            "parameters": {"message": "User 12345 completed action login"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "User 12345 completed action login")

    @pytest.mark.asyncio
    async def test_execute_with_resolved_numeric_values(self):
        """Test log with pre-resolved numeric values.

        Note: Expression evaluation is done centrally in plugin_executor.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved by plugin_executor
        context = {
            "parameters": {"message": "Count: 42, Total: 100.5"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Count: 42, Total: 100.5")

    @pytest.mark.asyncio
    async def test_execute_with_resolved_boolean_values(self):
        """Test log with pre-resolved boolean values.

        Note: Expression evaluation is done centrally in plugin_executor.
        Booleans are converted to lowercase "true"/"false" by plugin_executor.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved by plugin_executor
        context = {
            "parameters": {"message": "Success: true, Enabled: false"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Success: true, Enabled: false")

    @pytest.mark.asyncio
    async def test_execute_with_undefined_variable(self):
        """Test execution with pre-resolved undefined variable.

        Note: Expression evaluation is done centrally in plugin_executor.
        Undefined variables resolve to empty string during evaluation.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved - undefined vars become empty
        context = {
            "parameters": {"message": "Value: "},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Value: ")

    @pytest.mark.asyncio
    async def test_execute_with_special_characters(self):
        """Test log with message containing special characters.

        Log plugin should faithfully output any string content,
        including curly braces and other special characters.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        context = {
            "parameters": {"message": "Literal: {not_a_variable}"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Literal: {not_a_variable}")

    @pytest.mark.asyncio
    async def test_execute_with_null_variable(self):
        """Test log with pre-resolved null/None variable.

        Note: Expression evaluation is done centrally in plugin_executor.
        A null variable prints null during evaluation.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved - None prints null
        context = {
            "parameters": {"message": "Value: null"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Value: null")

    @pytest.mark.asyncio
    async def test_execute_with_curly_brace_content(self):
        """Test log with message containing curly braces.

        Log plugin should output resolved values as-is, even when
        they contain curly braces or template-like patterns.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved - output appears as-is
        context = {
            "parameters": {"message": 'Config: {"key": "value"}'},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", 'Config: {"key": "value"}')

    @pytest.mark.asyncio
    async def test_execute_mixed_defined_and_undefined_variables(self):
        """Test log with mix of defined and undefined variables pre-resolved.

        Note: Expression evaluation is done centrally in plugin_executor.
        Defined vars get their values, undefined becomes empty string.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved
        context = {
            "parameters": {"message": "User user123 has role  in engineering"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "User user123 has role  in engineering")

    @pytest.mark.asyncio
    async def test_execute_with_array_variable(self):
        """Test log with pre-resolved array variable.

        Note: Expression evaluation is done centrally in plugin_executor.
        Arrays are converted to JSON string representation.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved - array as JSON string
        context = {
            "parameters": {"message": "Items: [1, 2, 3]"},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Items: [1, 2, 3]")

    @pytest.mark.asyncio
    async def test_execute_with_map_variable(self):
        """Test log with pre-resolved map/dict variable.

        Note: Expression evaluation is done centrally in plugin_executor.
        Dicts are converted to JSON string representation.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved - dict as JSON string
        context = {
            "parameters": {"message": 'Config: {"key": "value"}'},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", 'Config: {"key": "value"}')

    @pytest.mark.asyncio
    async def test_execute_no_variables_context(self):
        """Test execution when no variables were in scope.

        Note: Expression evaluation is done centrally in plugin_executor.
        When no variables exist, references resolve to empty string.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        # Message is already resolved - var became empty
        context = {
            "parameters": {"message": "Static message with "},
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result is None
        assert len(logger.messages) == 1
        assert logger.messages[0] == ("info", "Static message with ")

    @pytest.mark.asyncio
    async def test_execute_logger_method_missing(self):
        """Test execution when logger doesn't have the required method."""
        plugin = LogPlugin()

        class IncompleteLogger:
            """Logger without fatal method."""

            def __init__(self):
                self.messages = []

            def debug(self, msg):
                self.messages.append(("debug", msg))

            def info(self, msg):
                self.messages.append(("info", msg))

            def warn(self, msg):
                self.messages.append(("warn", msg))

            def error(self, msg):
                self.messages.append(("error", msg))

            # Missing fatal method

        logger = IncompleteLogger()
        context = {
            "parameters": {"message": "Fatal message", "level": "FATAL"},
            "logger": logger,
        }

        # Should not raise - gracefully handles missing method
        result = await plugin.execute(context)
        assert result is None
        # No message logged since method is missing
        assert len(logger.messages) == 0


class _InfoLogger:
    """Records each INFO line the plugin writes."""

    def __init__(self) -> None:
        self.messages: list[str] = []

    def info(self, msg: str) -> None:
        self.messages.append(msg)


class TestLogPluginPrintsWholeValues:
    """A message that is not text prints in WAVE's print form (REQ-3.1.3.23)."""

    @staticmethod
    async def _printed(message: object) -> str:
        logger = _InfoLogger()
        await LogPlugin().execute({"parameters": {"message": message}, "logger": logger})
        assert len(logger.messages) == 1
        return logger.messages[0]

    @pytest.mark.asyncio
    async def test_a_null_message_prints_null(self):
        assert await self._printed(None) == "null"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("message", "text"), [(True, "true"), (False, "false")])
    async def test_a_boolean_message_prints_lower_case(self, message: bool, text: str):
        assert await self._printed(message) == text

    @pytest.mark.asyncio
    async def test_a_map_message_prints_compact_json_with_null_inside(self):
        printed = await self._printed({"host": "web-1", "port": None, "up": True})

        assert printed == '{"host":"web-1","port":null,"up":true}'

    @pytest.mark.asyncio
    async def test_a_list_message_prints_compact_json_with_null_inside(self):
        assert await self._printed([1, None, "x"]) == '[1,null,"x"]'

    @pytest.mark.asyncio
    async def test_a_decimal_message_prints_its_exact_text(self):
        from decimal import Decimal

        assert await self._printed(Decimal("1.50")) == "1.50"

    @pytest.mark.asyncio
    async def test_an_integer_message_prints_its_digits(self):
        assert await self._printed(42) == "42"

    @pytest.mark.asyncio
    async def test_a_text_message_prints_as_it_is(self):
        assert await self._printed("null") == "null"


class TestLogMessagePieces:
    """Every ``{{ }}`` piece in the message prints in WAVE's print form, so a null
    piece prints null instead of failing the block (REQ-3.1.3.22, REQ-3.1.3.23)."""

    @staticmethod
    def _filled(template: str, variables: dict[str, object]) -> str:
        from wavecore.core.execution import plugin_executor

        metadata = LogPlugin().metadata
        parameter_types, *_ = plugin_executor.derive_parameter_metadata(metadata["parameters"])
        resolved = plugin_executor.resolve_parameters(
            {"message": template},
            set(),
            dict(variables),
            parameter_types,
            template_fields={"message"},
            null_policies=plugin_executor.null_policy_fields(metadata["parameters"]),
        )
        return resolved["message"]

    def test_a_null_piece_prints_null(self):
        assert self._filled("Value: {{ x }}", {"x": None}) == "Value: null"

    def test_a_boolean_piece_prints_lower_case(self):
        assert self._filled("Ready: {{ ok }}", {"ok": True}) == "Ready: true"

    def test_a_list_piece_prints_compact_json_with_null_inside(self):
        assert self._filled("Items: {{ items }}", {"items": [1, None]}) == "Items: [1,null]"

    def test_a_map_piece_prints_compact_json(self):
        filled = self._filled("Config: {{ cfg }}", {"cfg": {"key": "value", "n": None}})

        assert filled == 'Config: {"key":"value","n":null}'

    def test_a_text_piece_prints_as_it_is(self):
        assert self._filled("User: {{ name }}", {"name": "alice"}) == "User: alice"

    def test_a_piece_that_falls_back_prints_the_fallback(self):
        filled = self._filled("Value: {{ x if x is not None else 'none yet' }}", {"x": None})

        assert filled == "Value: none yet"


class TestLogPluginLifecycle:
    """Test plugin lifecycle methods."""

    @pytest.mark.asyncio
    async def test_initialize_no_op(self):
        """Test initialize method (should be no-op)."""
        plugin = LogPlugin()
        context = {"parameters": {}}

        # Should not raise
        await plugin.initialize(context)

    @pytest.mark.asyncio
    async def test_cleanup_no_op(self):
        """Test cleanup method (should be no-op)."""
        plugin = LogPlugin()

        # Should not raise
        await plugin.cleanup()


class TestLogPluginGetModel:
    """Test get_plugin_model method."""

    def test_get_plugin_model(self):
        """Test that get_plugin_model returns valid Plugin model."""
        plugin = LogPlugin()
        model = plugin.get_plugin_model()

        assert model.id == "log"
        assert model.name == "Log"
        assert model.version == "1.0.0"
        assert model.category == "system"

    def test_get_plugin_model_parameters(self):
        """Test that get_plugin_model includes correct parameters."""
        plugin = LogPlugin()
        model = plugin.get_plugin_model()

        param_names = [p.name for p in model.parameters]
        assert "message" in param_names
        assert "level" in param_names
        assert len(model.parameters) == 2

    def test_message_is_a_data_field_that_prints_null_pieces(self):
        """The message accepts a null value and prints a null piece (REQ-3.4.2.2)."""
        params = {p.name: p for p in LogPlugin().get_plugin_model().parameters}

        assert params["message"].accepts_null is True
        assert params["message"].null_piece_prints is True

    def test_message_accepts_a_value_of_any_type_and_level_does_not(self):
        """Only the message takes any type; the level refuses a wrong type (REQ-3.4.2.2)."""
        params = {p.name: p for p in LogPlugin().get_plugin_model().parameters}

        assert params["message"].accepts_any_type is True
        assert params["level"].accepts_any_type is False

    def test_message_description_names_what_prints(self):
        """The description says the message takes any value and how each prints."""
        params = {p["name"]: p for p in LogPlugin().metadata["parameters"]}

        assert params["message"]["description"] == (
            "Text to write to the log. An expression or a {{ }} piece may give a value of "
            "any type: text prints as it is, null as null, a boolean as true or false, and "
            "a list, map or table as JSON text."
        )

    def test_level_refuses_null(self):
        """The level is a block setting, so null fails it (REQ-3.1.3.21)."""
        level = {p.name: p for p in LogPlugin().get_plugin_model().parameters}["level"]

        assert level.accepts_null is False
        assert level.null_piece_prints is False


class TestLogPluginMethodCalls:
    """Test method call results in pre-resolved messages.

    Note: Method call evaluation is done centrally in plugin_executor.
    These tests verify LogPlugin correctly logs pre-processed results.
    """

    @pytest.mark.asyncio
    async def test_execute_with_string_method_upper(self):
        """Test log with pre-evaluated .upper() method result."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(msg)

        logger = MockLogger()
        # Message is already resolved by plugin_executor
        context = {
            "parameters": {"message": "ALICE"},
            "logger": logger,
        }

        await plugin.execute(context)
        assert logger.messages[0] == "ALICE"

    @pytest.mark.asyncio
    async def test_execute_with_string_method_capitalize(self):
        """Test log with pre-evaluated .capitalize() method result."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(msg)

        logger = MockLogger()
        # Message is already resolved by plugin_executor
        context = {
            "parameters": {"message": "Alice"},
            "logger": logger,
        }

        await plugin.execute(context)
        assert logger.messages[0] == "Alice"

    @pytest.mark.asyncio
    async def test_execute_with_chained_methods(self):
        """Test log with pre-evaluated chained methods result."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(msg)

        logger = MockLogger()
        # Message is already resolved - .strip().upper() result
        context = {
            "parameters": {"message": "ALICE"},
            "logger": logger,
        }

        await plugin.execute(context)
        assert logger.messages[0] == "ALICE"

    @pytest.mark.asyncio
    async def test_execute_mixed_simple_and_method_variables(self):
        """Test log with mix of simple and method call results."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(msg)

        logger = MockLogger()
        # Message is already resolved by plugin_executor
        context = {
            "parameters": {"message": "alice - Alice"},
            "logger": logger,
        }

        await plugin.execute(context)
        assert logger.messages[0] == "alice - Alice"

    @pytest.mark.asyncio
    async def test_execute_blocks_dangerous_patterns(self):
        """Test log with blocked pattern result.

        Note: Dangerous patterns are blocked by plugin_executor
        and result in "[blocked: __]" text.
        """
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(msg)

        logger = MockLogger()
        # Message shows blocked result from plugin_executor
        context = {
            "parameters": {"message": "[blocked: __]"},
            "logger": logger,
        }

        await plugin.execute(context)
        assert "[blocked:" in logger.messages[0]

    @pytest.mark.asyncio
    async def test_execute_method_on_undefined_variable(self):
        """Test log with empty result for undefined variable method call."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(msg)

        logger = MockLogger()
        # Message is already resolved - undefined var method returns empty
        context = {
            "parameters": {"message": "Hello !"},
            "logger": logger,
        }

        await plugin.execute(context)
        assert logger.messages[0] == "Hello !"

    @pytest.mark.asyncio
    async def test_execute_method_on_none_value_variable(self):
        """Test log with empty result for None value method call."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(msg)

        logger = MockLogger()
        # Message is already resolved - method on None returns empty
        context = {
            "parameters": {"message": "Value: "},
            "logger": logger,
        }

        await plugin.execute(context)
        assert logger.messages[0] == "Value: "

    @pytest.mark.asyncio
    async def test_execute_method_raises_exception(self):
        """Test log with empty result for failed method call."""
        plugin = LogPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def info(self, msg):
                self.messages.append(msg)

        logger = MockLogger()
        # Message is already resolved - failed method returns empty
        context = {
            "parameters": {"message": "Result: "},
            "logger": logger,
        }

        await plugin.execute(context)
        assert logger.messages[0] == "Result: "
