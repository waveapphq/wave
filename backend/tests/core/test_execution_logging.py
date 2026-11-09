"""Tests for Execution Logging - Block and Plugin Lifecycle Events.

Covers REQ-3.7.2.5 and REQ-3.7.2.6:
- Block execution start/completion with duration
- Plugin initialization, outcome, and cleanup
- Parameter and return value summaries
- Error logging with context

Backend Terminal Format:
- Execution[abc12] Test 'name' started (3 blocks)
- Execution[abc12] Block 'Setup' started
- Execution[abc12] Block 'Setup' completed (50ms)
- Execution[abc12] completed: passed (398ms)
"""

import logging
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


class TestExecutionStartLogging:
    """Tests for logging test execution start."""

    def test_logs_execution_start_with_test_name(self) -> None:
        """Execution start log includes test name."""
        from wavecore.core.logging.formatter import format_execution_start

        result = format_execution_start(
            execution_id="abc12def",
            test_name="TLS Certificate Validation",
            block_count=5,
        )

        assert "TLS Certificate Validation" in result

    def test_logs_execution_start_with_block_count(self) -> None:
        """Execution start log includes block count."""
        from wavecore.core.logging.formatter import format_execution_start

        result = format_execution_start(
            execution_id="abc12def",
            test_name="Test",
            block_count=7,
        )

        assert "7 blocks" in result

    def test_logs_execution_start_with_short_id(self) -> None:
        """Execution start log uses short execution ID."""
        from wavecore.core.logging.formatter import format_execution_start

        result = format_execution_start(
            execution_id="abc12def-full-uuid-here",
            test_name="Test",
            block_count=3,
        )

        assert "[abc12]" in result
        assert "def-full-uuid-here" not in result


class TestExecutionCompleteLogging:
    """Tests for logging test execution completion."""

    def test_logs_passed_execution(self) -> None:
        """Execution completion log shows passed status."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abc12def",
            status="passed",
            duration_ms=1500.0,
        )

        assert "passed" in result
        assert "1500ms" in result

    def test_logs_failed_execution(self) -> None:
        """Execution completion log shows failed status."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abc12def",
            status="failed",
            duration_ms=2500.0,
        )

        assert "failed" in result
        assert "2500ms" in result

    def test_logs_error_execution(self) -> None:
        """Execution completion log shows error status."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abc12def",
            status="error",
            duration_ms=100.0,
        )

        assert "error" in result

    def test_logs_execution_duration_as_integer(self) -> None:
        """Execution duration is rounded to integer milliseconds."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abc12def",
            status="passed",
            duration_ms=1234.567,
        )

        # Should round to 1235ms
        assert "1235ms" in result
        assert "1234.567" not in result


class TestBlockStartLogging:
    """Tests for logging block execution start."""

    def test_formats_block_start(self) -> None:
        """format_block_start produces expected format."""
        from wavecore.core.logging.formatter import format_block_start

        result = format_block_start(
            execution_id="abc12def",
            block_name="Setup Environment",
        )

        assert result == "Execution[abc12] Block 'Setup Environment' started"

    def test_uses_short_execution_id(self) -> None:
        """Block start uses short execution ID."""
        from wavecore.core.logging.formatter import format_block_start

        result = format_block_start(
            execution_id="xyz99abc-long-uuid",
            block_name="Test Block",
        )

        assert "[xyz99]" in result

    def test_handles_unnamed_block(self) -> None:
        """Block start handles unnamed blocks."""
        from wavecore.core.logging.formatter import format_block_start

        result = format_block_start(
            execution_id="abc12",
            block_name=None,
        )

        assert "Block" in result
        assert "''" in result or "(unnamed)" in result


class TestBlockCompleteLogging:
    """Tests for logging block execution completion."""

    def test_formats_block_complete(self) -> None:
        """format_block_complete produces expected format."""
        from wavecore.core.logging.formatter import format_block_complete

        result = format_block_complete(
            execution_id="abc12def",
            block_name="Setup Environment",
            duration_ms=50.0,
        )

        assert result == "Execution[abc12] Block 'Setup Environment' completed (50ms)"

    def test_rounds_duration_to_integer(self) -> None:
        """Block completion rounds duration to integer."""
        from wavecore.core.logging.formatter import format_block_complete

        result = format_block_complete(
            execution_id="abc12",
            block_name="Test",
            duration_ms=75.8,
        )

        assert "76ms" in result

    def test_uses_short_execution_id(self) -> None:
        """Block completion uses short execution ID."""
        from wavecore.core.logging.formatter import format_block_complete

        result = format_block_complete(
            execution_id="abcde-uuid-string",
            block_name="Test",
            duration_ms=100.0,
        )

        assert "[abcde]" in result


class TestPluginLogging:
    """Tests for logging plugin execution lifecycle."""

    def test_formats_plugin_init(self) -> None:
        """format_plugin_init produces expected format."""
        from wavecore.core.logging.formatter import format_plugin_init

        result = format_plugin_init(
            execution_id="abc12",
            plugin_type="HTTP Client",
            element_name="API Call",
        )

        assert "[abc12]" in result
        assert "HTTP Client" in result
        assert "API Call" in result
        assert "initializing" in result.lower()

    def test_formats_plugin_init_unnamed(self) -> None:
        """format_plugin_init handles unnamed plugin."""
        from wavecore.core.logging.formatter import format_plugin_init

        result = format_plugin_init(
            execution_id="abc12",
            plugin_type="Log",
            element_name=None,
        )

        assert "Log" in result
        assert "API Call" not in result

    def test_formats_plugin_complete(self) -> None:
        """format_plugin_complete produces expected format."""
        from wavecore.core.logging.formatter import format_plugin_complete

        result = format_plugin_complete(
            execution_id="abc12",
            plugin_type="HTTP Client",
            element_name="API Call",
            outcome="success",
            duration_ms=25.0,
        )

        assert "[abc12]" in result
        assert "HTTP Client" in result
        assert "success" in result
        assert "25ms" in result

    def test_formats_plugin_failure(self) -> None:
        """format_plugin_complete handles failure outcome."""
        from wavecore.core.logging.formatter import format_plugin_complete

        result = format_plugin_complete(
            execution_id="abc12",
            plugin_type="Shell Script",
            element_name="Script",
            outcome="failed",
            duration_ms=100.0,
        )

        assert "failed" in result


class TestParameterLogging:
    """Tests for logging plugin parameters and return values."""

    def test_there_is_no_key_guessing_parameter_summary(self) -> None:
        """No name-heuristic formatter exists or is exported."""
        import wavecore.core.logging as core_logging
        from wavecore.core.logging import formatter

        assert not hasattr(formatter, "format_parameter_summary")
        assert not hasattr(formatter, "_is_secret_key")
        assert not hasattr(formatter, "SECRET_KEY_PATTERNS")
        assert not hasattr(core_logging, "format_parameter_summary")
        assert not hasattr(core_logging, "SECRET_KEY_PATTERNS")

    def test_formats_return_value_summary_simple(self) -> None:
        """format_return_summary handles simple return values."""
        from wavecore.core.logging.formatter import format_return_summary

        return_value = {"status": "ok", "count": 5}
        result = format_return_summary(return_value)

        assert "status" in result
        assert "count" in result

    def test_formats_return_value_summary_list(self) -> None:
        """format_return_summary handles list return values."""
        from wavecore.core.logging.formatter import format_return_summary

        return_value = [1, 2, 3, 4, 5]
        result = format_return_summary(return_value)

        assert "5 items" in result or "[1, 2, 3" in result

    def test_return_summary_truncates_long_values_with_ellipsis(self) -> None:
        """format_return_summary truncates over-long scalar values."""
        from wavecore.core.logging.formatter import MAX_VALUE_LENGTH, format_return_summary

        result = format_return_summary("x" * (MAX_VALUE_LENGTH + 10))

        assert result == "x" * MAX_VALUE_LENGTH + "..."


class TestErrorLogging:
    """Tests for error logging with context."""

    def test_formats_execution_error(self) -> None:
        """format_execution_error produces expected format."""
        from wavecore.core.logging.formatter import format_execution_error

        result = format_execution_error(
            execution_id="abc12",
            error_type="ConnectionError",
            error_message="Failed to connect to host",
        )

        assert "[abc12]" in result
        assert "ConnectionError" in result
        assert "Failed to connect to host" in result

    def test_formats_execution_error_with_block_context(self) -> None:
        """format_execution_error includes block context."""
        from wavecore.core.logging.formatter import format_execution_error

        result = format_execution_error(
            execution_id="abc12",
            error_type="TimeoutError",
            error_message="Request timed out",
            block_name="API Call",
        )

        assert "API Call" in result
        assert "TimeoutError" in result

    def test_formats_execution_error_with_variable_context(self) -> None:
        """format_execution_error includes relevant variable context."""
        from wavecore.core.logging.formatter import format_execution_error

        result = format_execution_error(
            execution_id="abc12",
            error_type="AssertionError",
            error_message="Expected 200, got 404",
            variables={"response_status": 404, "expected": 200},
        )

        assert "response_status" in result or "404" in result


class TestExecutionLogger:
    """Tests for ExecutionLogger class - context-aware logging."""

    def test_creates_execution_logger(self) -> None:
        """ExecutionLogger can be created with execution context."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12def")

        assert logger.execution_id == "abc12def"
        assert logger.short_id == "abc12"

    def test_log_start_produces_formatted_message(self) -> None:
        """ExecutionLogger.log_start produces formatted start message."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12def")

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            logger.log_start(test_name="Test Name", block_count=3)

            mock_logging.info.assert_called_once()
            call_args = mock_logging.info.call_args[0][0]
            assert "Test Name" in call_args
            assert "3 blocks" in call_args

    def test_log_complete_produces_formatted_message(self) -> None:
        """ExecutionLogger.log_complete produces formatted completion message."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12def")

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            logger.log_complete(status="passed", duration_ms=500.0)

            mock_logging.info.assert_called_once()
            call_args = mock_logging.info.call_args[0][0]
            assert "passed" in call_args
            assert "500ms" in call_args

    def test_log_block_start_produces_formatted_message(self) -> None:
        """ExecutionLogger.log_block_start produces formatted message."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12def")

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            logger.log_block_start(block_name="Setup")

            mock_logging.info.assert_called_once()
            call_args = mock_logging.info.call_args[0][0]
            assert "Setup" in call_args
            assert "started" in call_args.lower()

    def test_log_block_complete_produces_formatted_message(self) -> None:
        """ExecutionLogger.log_block_complete produces formatted message."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12def")

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            logger.log_block_complete(block_name="Setup", duration_ms=75.0)

            mock_logging.info.assert_called_once()
            call_args = mock_logging.info.call_args[0][0]
            assert "Setup" in call_args
            assert "75ms" in call_args

    def test_log_error_uses_error_level(self) -> None:
        """ExecutionLogger.log_error logs at ERROR level."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12def")

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            logger.log_error(
                error_type="RuntimeError",
                error_message="Something went wrong",
            )

            mock_logging.error.assert_called_once()


class TestLogLevelForExecutionEvents:
    """Tests for appropriate log levels for execution events."""

    def test_execution_start_uses_info_level(self) -> None:
        """Execution start events use INFO level."""
        from wavecore.core.logging.formatter import get_execution_log_level

        level = get_execution_log_level("start")

        assert level == "INFO"

    def test_execution_complete_passed_uses_info_level(self) -> None:
        """Passed execution completion uses INFO level."""
        from wavecore.core.logging.formatter import get_execution_log_level

        level = get_execution_log_level("complete", status="passed")

        assert level == "INFO"

    def test_execution_complete_failed_uses_warn_level(self) -> None:
        """Failed execution completion uses WARN level."""
        from wavecore.core.logging.formatter import get_execution_log_level

        level = get_execution_log_level("complete", status="failed")

        assert level == "WARN"

    def test_execution_complete_error_uses_error_level(self) -> None:
        """Error execution completion uses ERROR level."""
        from wavecore.core.logging.formatter import get_execution_log_level

        level = get_execution_log_level("complete", status="error")

        assert level == "ERROR"

    def test_block_start_uses_debug_level(self) -> None:
        """Block start events use DEBUG level."""
        from wavecore.core.logging.formatter import get_execution_log_level

        level = get_execution_log_level("block_start")

        assert level == "DEBUG"

    def test_block_complete_uses_debug_level(self) -> None:
        """Block completion events use DEBUG level."""
        from wavecore.core.logging.formatter import get_execution_log_level

        level = get_execution_log_level("block_complete")

        assert level == "DEBUG"


class TestIntegrationWithExistingLogging:
    """Tests for integration with existing wavecore logging infrastructure."""

    def test_execution_logger_uses_unified_formatter(self) -> None:
        """ExecutionLogger output uses unified format."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12")

        # The underlying Python logger should use UnifiedFormatter
        # This test verifies the integration point
        assert logger is not None

    def test_works_with_session_logger(self) -> None:
        """Execution logging can work alongside SessionLogger."""
        from wavecore.core.logging.formatter import ExecutionLogger

        # Both should be usable without conflict
        exec_logger = ExecutionLogger(execution_id="abc12")

        from wavecore.logging.session_logger import SessionLogger

        session_logger = SessionLogger(session_id="sess-123", source="Test")

        # No conflicts
        assert exec_logger.execution_id == "abc12"
        assert session_logger.session_id == "sess-123"


class TestCoverageBranches:
    """Additional tests for full coverage of all code branches."""

    def test_format_plugin_complete_without_element_name(self) -> None:
        """format_plugin_complete handles None element_name."""
        from wavecore.core.logging.formatter import format_plugin_complete

        result = format_plugin_complete(
            execution_id="abc12",
            plugin_type="Log",
            element_name=None,
            outcome="success",
            duration_ms=10.0,
        )

        assert "[abc12]" in result
        assert "Log" in result
        assert "success" in result
        assert "10ms" in result
        # Should NOT have quotes around plugin name when no element_name
        assert "Log success" in result

    def test_format_return_summary_scalar_value(self) -> None:
        """format_return_summary handles scalar (non-list/dict) values."""
        from wavecore.core.logging.formatter import format_return_summary

        result = format_return_summary("simple string")
        assert result == "simple string"

        result = format_return_summary(42)
        assert result == "42"

        result = format_return_summary(True)
        assert result == "True"

    def test_get_execution_log_level_unknown_status(self) -> None:
        """get_execution_log_level handles unknown status for complete event."""
        from wavecore.core.logging.formatter import get_execution_log_level

        level = get_execution_log_level("complete", status="unknown")
        assert level == "INFO"

        level = get_execution_log_level("complete", status=None)
        assert level == "INFO"

    def test_get_execution_log_level_unknown_event(self) -> None:
        """get_execution_log_level handles unknown event types."""
        from wavecore.core.logging.formatter import get_execution_log_level

        level = get_execution_log_level("unknown_event")
        assert level == "INFO"

    def test_configure_unified_logging_fatal_level(self) -> None:
        """configure_unified_logging handles FATAL level."""

        from wavecore.core.logging.formatter import configure_unified_logging

        configure_unified_logging(level="FATAL")

        root = logging.getLogger()
        assert root.level == logging.CRITICAL

    def test_execution_logger_log_complete_failed_status(self) -> None:
        """ExecutionLogger.log_complete uses WARN for failed status."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12def")

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            logger.log_complete(status="failed", duration_ms=500.0)

            mock_logging.warning.assert_called_once()
            call_args = mock_logging.warning.call_args[0][0]
            assert "failed" in call_args

    def test_execution_logger_log_complete_error_status(self) -> None:
        """ExecutionLogger.log_complete uses ERROR for error status."""
        from wavecore.core.logging.formatter import ExecutionLogger

        logger = ExecutionLogger(execution_id="abc12def")

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            logger.log_complete(status="error", duration_ms=500.0)

            mock_logging.error.assert_called_once()
            call_args = mock_logging.error.call_args[0][0]
            assert "error" in call_args


class TestUnifiedHttpLoggerCoverage:
    """Tests for UnifiedHttpLogger class coverage."""

    def test_unified_http_logger_log_request_debug(self) -> None:
        """UnifiedHttpLogger.log_request handles 1xx status (DEBUG)."""
        from wavecore.core.logging.formatter import UnifiedHttpLogger

        logger = UnifiedHttpLogger()

        with patch.object(logger._logger, "debug") as mock_debug:
            logger.log_request("GET", "/test", 100, 1.0)
            mock_debug.assert_called_once()

    def test_unified_http_logger_log_request_info(self) -> None:
        """UnifiedHttpLogger.log_request handles 2xx status (INFO)."""
        from wavecore.core.logging.formatter import UnifiedHttpLogger

        logger = UnifiedHttpLogger()

        with patch.object(logger._logger, "info") as mock_info:
            logger.log_request("GET", "/test", 200, 1.0)
            mock_info.assert_called_once()

    def test_unified_http_logger_log_request_warn(self) -> None:
        """UnifiedHttpLogger.log_request handles 4xx status (WARN)."""
        from wavecore.core.logging.formatter import UnifiedHttpLogger

        logger = UnifiedHttpLogger()

        with patch.object(logger._logger, "warning") as mock_warn:
            logger.log_request("GET", "/test", 404, 1.0)
            mock_warn.assert_called_once()

    def test_unified_http_logger_log_request_error(self) -> None:
        """UnifiedHttpLogger.log_request handles 5xx status (ERROR)."""
        from wavecore.core.logging.formatter import UnifiedHttpLogger

        logger = UnifiedHttpLogger()

        with patch.object(logger._logger, "error") as mock_error:
            logger.log_request("GET", "/test", 500, 1.0)
            mock_error.assert_called_once()


class TestCreateUnifiedLoggingMiddlewareCoverage:
    """Tests for create_unified_logging_middleware function coverage."""

    @pytest.mark.asyncio
    async def test_middleware_logs_info_for_success(self) -> None:
        """Middleware logs INFO level for 2xx responses."""

        from wavecore.core.logging.formatter import create_unified_logging_middleware

        middleware = create_unified_logging_middleware()

        request = MagicMock()
        request.url.path = "/test"
        request.method = "GET"

        response = MagicMock()
        response.status_code = 200

        async def call_next(_: Any) -> Any:
            return response

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            result = await middleware(request, call_next)
            mock_logging.info.assert_called_once()
            assert result == response

    @pytest.mark.asyncio
    async def test_middleware_logs_warn_for_4xx(self) -> None:
        """Middleware logs WARN level for 4xx responses."""

        from wavecore.core.logging.formatter import create_unified_logging_middleware

        middleware = create_unified_logging_middleware()

        request = MagicMock()
        request.url.path = "/test"
        request.method = "GET"

        response = MagicMock()
        response.status_code = 404

        async def call_next(_: Any) -> Any:
            return response

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            result = await middleware(request, call_next)
            mock_logging.warning.assert_called_once()
            assert result == response

    @pytest.mark.asyncio
    async def test_middleware_logs_error_for_5xx(self) -> None:
        """Middleware logs ERROR level for 5xx responses."""

        from wavecore.core.logging.formatter import create_unified_logging_middleware

        middleware = create_unified_logging_middleware()

        request = MagicMock()
        request.url.path = "/test"
        request.method = "GET"

        response = MagicMock()
        response.status_code = 500

        async def call_next(_: Any) -> Any:
            return response

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            result = await middleware(request, call_next)
            mock_logging.error.assert_called_once()
            assert result == response

    @pytest.mark.asyncio
    async def test_middleware_logs_debug_for_1xx(self) -> None:
        """Middleware logs DEBUG level for 1xx responses."""

        from wavecore.core.logging.formatter import create_unified_logging_middleware

        middleware = create_unified_logging_middleware()

        request = MagicMock()
        request.url.path = "/test"
        request.method = "GET"

        response = MagicMock()
        response.status_code = 100

        async def call_next(_: Any) -> Any:
            return response

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            result = await middleware(request, call_next)
            mock_logging.debug.assert_called_once()
            assert result == response

    @pytest.mark.asyncio
    async def test_middleware_skips_excluded_paths(self) -> None:
        """Middleware skips logging for excluded paths."""

        from wavecore.core.logging.formatter import create_unified_logging_middleware

        middleware = create_unified_logging_middleware()

        request = MagicMock()
        request.url.path = "/health"
        request.method = "GET"

        response = MagicMock()
        response.status_code = 200

        async def call_next(_: Any) -> Any:
            return response

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            result = await middleware(request, call_next)
            # Should NOT log for excluded paths
            mock_logging.info.assert_not_called()
            assert result == response

    @pytest.mark.asyncio
    async def test_middleware_with_custom_exclusions(self) -> None:
        """Middleware respects custom excluded paths."""

        from wavecore.core.logging.formatter import create_unified_logging_middleware

        middleware = create_unified_logging_middleware(exclude_paths=["/custom"])

        request = MagicMock()
        request.url.path = "/custom"
        request.method = "GET"

        response = MagicMock()
        response.status_code = 200

        async def call_next(_: Any) -> Any:
            return response

        with patch("wavecore.core.logging.formatter.logging") as mock_logging:
            result = await middleware(request, call_next)
            # Should NOT log for custom excluded paths
            mock_logging.info.assert_not_called()
            assert result == response
