"""
Log Plugin

Implements requirements:
- REQ-3.4.1.17: Log plugin (write messages to execution log with configurable level)

Enables test designers to write explicit messages to the execution log with
configurable severity levels, providing workflow progress markers, diagnostic
output, and audit trail entries.
"""

from typing import Any

from wavecore.core.variables.print_form import value_text
from wavecore.plugins.base import PluginBase

# Valid log levels, least to most severe
VALID_LOG_LEVELS = ("DEBUG", "INFO", "WARN", "ERROR", "FATAL")


class LogPlugin(PluginBase):
    """
    Log Plugin.

    Writes explicit log entries at designated workflow points with configurable
    severity levels. Primary use cases include progress markers for workflow
    milestones, diagnostic output displaying computed values, and audit trail
    entries for compliance.

    Parameters:
        message (string): Text to write to the log (required). Supports expressions
            for dynamic content when is_expression is set.
        level (string): Log severity level (optional, default: INFO). Valid values:
            DEBUG, INFO, WARN, ERROR, FATAL.

    Behavior:
        - Messages are logged at the specified severity level
        - Expression parameters are resolved upstream by resolve_parameters()
        - Gracefully handles missing logger (no-op)

    Example:
        # Simple progress message
        parameters = {"message": "Processing started"}

        # Debug diagnostic with expression
        parameters = {
            "message": "f'User {user_id} authenticated'",
            "level": "DEBUG"
        }
    """

    @property
    def metadata(self) -> dict[str, Any]:
        """
        Plugin metadata declaration.

        Returns:
            dict containing plugin identity, parameters, and documentation
        """
        return {
            "id": "log",
            "name": "Log",
            "version": "1.0.0",
            "category": "system",
            "description": (
                "Writes messages to the execution log with configurable severity "
                "level. Supports expression evaluation for dynamic content."
            ),
            "parameters": [
                {
                    "name": "message",
                    "type": "string",
                    "required": True,
                    "accepts_null": True,
                    "null_piece_prints": True,
                    "accepts_any_type": True,
                    "description": (
                        "Text to write to the log. An expression or a {{ }} piece may give "
                        "a value of any type: text prints as it is, null as null, a boolean "
                        "as true or false, and a list, map or table as JSON text."
                    ),
                },
                {
                    "name": "level",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "INFO",
                    "enum_values": list(VALID_LOG_LEVELS),
                    "description": (
                        "Log severity level: DEBUG for verbose diagnostics, "
                        "INFO for general progress (default), WARN for important "
                        "notices, ERROR for significant problems, FATAL for "
                        "critical issues."
                    ),
                },
            ],
            "return_type": None,
            "output_schema": [],
            "author": "WAVE Framework",
            "tags": ["logging", "system", "utility", "diagnostics"],
            "documentation": {
                "overview": (
                    "The log plugin enables explicit logging within test workflows. "
                    "Use it for progress markers, diagnostic output, validation status, "
                    "and audit trail entries."
                ),
                "behavior": (
                    "Messages are written to the execution log at the specified severity "
                    "level. Expression parameters are resolved upstream before execution. "
                    "The plugin integrates with the two-layer filtering "
                    "architecture for controlling verbosity."
                ),
                "examples": [
                    {
                        "description": "Log workflow progress",
                        "parameters": {
                            "message": "Starting data validation phase",
                            "level": "INFO",
                        },
                    },
                    {
                        "description": "Debug diagnostic with expression",
                        "parameters": {
                            "message": "f'Processing record {record_id} of {total}'",
                            "level": "DEBUG",
                        },
                    },
                    {
                        "description": "Warning message",
                        "parameters": {
                            "message": "Retry count exceeded, using fallback",
                            "level": "WARN",
                        },
                    },
                ],
            },
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """
        Validate plugin parameters.

        Validates:
        - 'message' parameter is present and is a string
        - 'level' parameter (if present) is a valid log level

        Args:
            params: Parameter values to validate

        Raises:
            ValueError: On validation failure with descriptive error message
            TypeError: On type mismatch
        """
        # Check required 'message' parameter
        if "message" not in params:
            raise ValueError("Missing required parameter: message")

        message = params["message"]

        if not isinstance(message, str):
            params["message"] = value_text(message)

        # Validate level if present
        if "level" in params:
            level = params["level"]

            # Type check: level must be a string
            if not isinstance(level, str):
                raise TypeError(f"Parameter 'level' must be a string, got {type(level).__name__}")

            # Validate level is a valid log level
            if level not in VALID_LOG_LEVELS:
                raise ValueError(
                    f"Invalid level: '{level}'. Must be one of: {', '.join(VALID_LOG_LEVELS)}"
                )

    async def execute(self, context: dict[str, Any]) -> Any:
        """
        Execute log plugin.

        Writes the message to the log at the specified severity level.
        Note: Expression evaluation is handled centrally by plugin_executor,
        so params["message"] is already resolved when we receive it.

        Args:
            context: Execution context containing:
                - parameters: Plugin parameter values (already resolved)
                - logger: Logger instance (optional)

        Returns:
            None (no return value)
        """
        params = context["parameters"]
        message = value_text(params["message"])
        level = params.get("level", "INFO")
        logger = context.get("logger")

        # Log the message if logger is available
        if logger is not None:
            self._log_message(logger, level, message)

        return None

    def _log_message(self, logger: Any, level: str, message: str) -> None:
        """
        Log a message at the specified level.

        Gracefully handles loggers that don't have the required method.

        Args:
            logger: Logger instance
            level: Log level (DEBUG, INFO, WARN, ERROR, FATAL)
            message: Message to log
        """
        level_to_method = {
            "DEBUG": "debug",
            "INFO": "info",
            "WARN": "warn",
            "ERROR": "error",
            "FATAL": "fatal",
        }

        method_name = level_to_method.get(level, "info")
        log_method = getattr(logger, method_name, None)

        if log_method is not None and callable(log_method):
            log_method(message)
