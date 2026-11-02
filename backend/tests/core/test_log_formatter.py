"""Tests for Unified Log Formatter - Backend Terminal and Test Console Formats.

Covers:
- REQ-3.7.2.5: Custom logging from tests/blocks
- REQ-3.7.2.6: Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
- REQ-5.2.3.5: Request/response logging middleware for audit trail

The unified log formatter produces clean, readable logs for two audiences:
1. Backend Terminal: Self-describing messages for developers (no [SOURCE])
2. Test Console: WebSocket stream with [SOURCE] for block/plugin attribution

Format Specification:
- Timestamp: HH:MM:SS.mmm (24-hour, milliseconds)
- Level: Right-padded to 5 characters (DEBUG, INFO, WARN, ERROR, FATAL)
- Backend: HH:MM:SS.mmm LEVEL message
- Console: HH:MM:SS.mmm LEVEL [SOURCE] message
"""

import logging
import re
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

INVALID_LEVEL = r"^Invalid log level: '{level}'\. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL$"


class TestFormatTimestamp:
    """Tests for format_timestamp() - produces HH:MM:SS.mmm format."""

    def test_formats_datetime_to_hms_with_milliseconds(self) -> None:
        """format_timestamp produces HH:MM:SS.mmm format from datetime."""
        from wavecore.core.logging.formatter import format_timestamp

        dt = datetime(2025, 1, 15, 14, 30, 45, 123456, tzinfo=UTC)
        result = format_timestamp(dt)

        assert result == "14:30:45.123"

    def test_uses_24_hour_format(self) -> None:
        """format_timestamp uses 24-hour format (14:00 not 2:00 PM)."""
        from wavecore.core.logging.formatter import format_timestamp

        dt = datetime(2025, 1, 15, 22, 15, 30, 500000, tzinfo=UTC)
        result = format_timestamp(dt)

        assert result == "22:15:30.500"

    def test_pads_single_digit_hours(self) -> None:
        """format_timestamp pads single-digit hours with leading zero."""
        from wavecore.core.logging.formatter import format_timestamp

        dt = datetime(2025, 1, 15, 5, 8, 3, 50000, tzinfo=UTC)
        result = format_timestamp(dt)

        assert result == "05:08:03.050"

    def test_uses_current_time_when_no_datetime_provided(self) -> None:
        """format_timestamp uses current time when no datetime provided."""
        from wavecore.core.logging.formatter import format_timestamp

        result = format_timestamp()

        # Should match HH:MM:SS.mmm pattern
        pattern = r"^\d{2}:\d{2}:\d{2}\.\d{3}$"
        assert re.match(pattern, result), f"'{result}' does not match HH:MM:SS.mmm"

    def test_handles_midnight(self) -> None:
        """format_timestamp correctly formats midnight (00:00:00)."""
        from wavecore.core.logging.formatter import format_timestamp

        dt = datetime(2025, 1, 15, 0, 0, 0, 0, tzinfo=UTC)
        result = format_timestamp(dt)

        assert result == "00:00:00.000"

    def test_rounds_microseconds_to_milliseconds(self) -> None:
        """format_timestamp truncates microseconds to 3 decimal places."""
        from wavecore.core.logging.formatter import format_timestamp

        # 999999 microseconds should become 999 milliseconds (truncated, not rounded)
        dt = datetime(2025, 1, 15, 12, 0, 0, 999999, tzinfo=UTC)
        result = format_timestamp(dt)

        assert result == "12:00:00.999"


class TestFormatLevel:
    """Tests for format_level() - right-pads level to 5 characters."""

    def test_formats_debug_level(self) -> None:
        """format_level formats DEBUG with correct padding."""
        from wavecore.core.logging.formatter import format_level

        result = format_level("DEBUG")

        assert result == "DEBUG"
        assert len(result) == 5

    def test_formats_info_level_with_padding(self) -> None:
        """format_level pads INFO to 5 characters."""
        from wavecore.core.logging.formatter import format_level

        result = format_level("INFO")

        assert result == "INFO "
        assert len(result) == 5

    def test_formats_warn_level_with_padding(self) -> None:
        """format_level pads WARN to 5 characters."""
        from wavecore.core.logging.formatter import format_level

        result = format_level("WARN")

        assert result == "WARN "
        assert len(result) == 5

    def test_formats_error_level(self) -> None:
        """format_level formats ERROR with correct padding."""
        from wavecore.core.logging.formatter import format_level

        result = format_level("ERROR")

        assert result == "ERROR"
        assert len(result) == 5

    def test_formats_fatal_level(self) -> None:
        """format_level formats FATAL with correct padding."""
        from wavecore.core.logging.formatter import format_level

        result = format_level("FATAL")

        assert result == "FATAL"
        assert len(result) == 5

    def test_normalizes_lowercase_level(self) -> None:
        """format_level normalizes lowercase levels to uppercase."""
        from wavecore.core.logging.formatter import format_level

        result = format_level("info")

        assert result == "INFO "

    def test_normalizes_mixed_case_level(self) -> None:
        """format_level normalizes mixed-case levels to uppercase."""
        from wavecore.core.logging.formatter import format_level

        result = format_level("WaRn")

        assert result == "WARN "

    def test_raises_for_invalid_level(self) -> None:
        """format_level raises ValueError for invalid log level."""
        from wavecore.core.logging.formatter import format_level

        with pytest.raises(ValueError) as exc_info:
            format_level("TRACE")

        assert (
            str(exc_info.value)
            == "Invalid log level 'TRACE'. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL"
        )


class TestFormatBackendMessage:
    """Tests for format_backend_message() - backend terminal format."""

    def test_formats_simple_message(self) -> None:
        """format_backend_message produces HH:MM:SS.mmm LEVEL message format."""
        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 5, 6, 53, 602000, tzinfo=UTC)
        result = format_backend_message("INFO", "Server started on http://127.0.0.1:8000", dt)

        assert result == "05:06:53.602 INFO  Server started on http://127.0.0.1:8000"

    def test_formats_warning_message(self) -> None:
        """format_backend_message formats WARN level correctly."""
        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 5, 6, 55, 100000, tzinfo=UTC)
        result = format_backend_message("WARN", "Connection timeout", dt)

        assert result == "05:06:55.100 WARN  Connection timeout"

    def test_formats_error_message(self) -> None:
        """format_backend_message formats ERROR level correctly."""
        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 5, 6, 55, 200000, tzinfo=UTC)
        result = format_backend_message("ERROR", "Database connection failed", dt)

        assert result == "05:06:55.200 ERROR Database connection failed"

    def test_uses_current_time_when_no_datetime_provided(self) -> None:
        """format_backend_message uses current time when no datetime provided."""
        from wavecore.core.logging.formatter import format_backend_message

        result = format_backend_message("INFO", "Test message")

        # Should match pattern: HH:MM:SS.mmm LEVEL message
        pattern = r"^\d{2}:\d{2}:\d{2}\.\d{3} INFO  Test message$"
        assert re.match(pattern, result), f"'{result}' does not match expected pattern"


class TestFormatHttpRequest:
    """Tests for format_http_request() - HTTP request log format."""

    def test_formats_successful_get_request(self) -> None:
        """format_http_request produces GET /path → 200 (1.23ms) format."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("GET", "/api/v1/environments", 200, 0.52)

        assert result == "GET /api/v1/environments → 200 (0.52ms)"

    def test_formats_post_request(self) -> None:
        """format_http_request handles POST method."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("POST", "/api/v1/tests", 201, 15.4)

        assert result == "POST /api/v1/tests → 201 (15.40ms)"

    def test_formats_put_request(self) -> None:
        """format_http_request handles PUT method."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("PUT", "/api/v1/blocks/123", 200, 8.75)

        assert result == "PUT /api/v1/blocks/123 → 200 (8.75ms)"

    def test_formats_delete_request(self) -> None:
        """format_http_request handles DELETE method."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("DELETE", "/api/v1/suites/456", 204, 3.21)

        assert result == "DELETE /api/v1/suites/456 → 204 (3.21ms)"

    def test_formats_patch_request(self) -> None:
        """format_http_request handles PATCH method."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("PATCH", "/api/v1/profiles/789", 200, 5.00)

        assert result == "PATCH /api/v1/profiles/789 → 200 (5.00ms)"

    def test_formats_404_response(self) -> None:
        """format_http_request handles 404 status."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("GET", "/api/v1/tests/xyz", 404, 0.23)

        assert result == "GET /api/v1/tests/xyz → 404 (0.23ms)"

    def test_formats_500_response(self) -> None:
        """format_http_request handles 500 status."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("POST", "/api/v1/executions", 500, 102.5)

        assert result == "POST /api/v1/executions → 500 (102.50ms)"

    def test_formats_duration_with_two_decimal_places(self) -> None:
        """format_http_request formats duration with exactly 2 decimal places."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("GET", "/health", 200, 1.0)

        assert result == "GET /health → 200 (1.00ms)"

    def test_formats_long_duration(self) -> None:
        """format_http_request handles long durations correctly."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("GET", "/api/v1/reports", 200, 5432.1)

        assert result == "GET /api/v1/reports → 200 (5432.10ms)"

    def test_formats_sub_millisecond_duration(self) -> None:
        """format_http_request handles sub-millisecond durations."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("OPTIONS", "/api/v1/cors", 200, 0.05)

        assert result == "OPTIONS /api/v1/cors → 200 (0.05ms)"

    def test_formats_path_with_query_string(self) -> None:
        """format_http_request handles paths with query strings."""
        from wavecore.core.logging.formatter import format_http_request

        result = format_http_request("GET", "/api/v1/tests?page=1&limit=10", 200, 12.34)

        assert result == "GET /api/v1/tests?page=1&limit=10 → 200 (12.34ms)"


class TestFormatExecutionStart:
    """Tests for format_execution_start() - execution start log format."""

    def test_formats_test_execution_start(self) -> None:
        """format_execution_start produces Execution[id] Test 'name' started format."""
        from wavecore.core.logging.formatter import format_execution_start

        result = format_execution_start(
            execution_id="abc12def-3456-7890-abcd-ef1234567890",
            test_name="TLS Validation",
            block_count=3,
        )

        assert result == "Execution[abc12] Test 'TLS Validation' started (3 blocks)"

    def test_uses_first_5_chars_of_execution_id(self) -> None:
        """format_execution_start uses only first 5 characters of execution ID."""
        from wavecore.core.logging.formatter import format_execution_start

        result = format_execution_start(
            execution_id="xyz99abc-longer-uuid-here",
            test_name="Test Name",
            block_count=5,
        )

        assert "[xyz99]" in result

    def test_formats_single_block(self) -> None:
        """format_execution_start handles singular 'block' for count of 1."""
        from wavecore.core.logging.formatter import format_execution_start

        result = format_execution_start(
            execution_id="abc12",
            test_name="Simple Test",
            block_count=1,
        )

        assert result == "Execution[abc12] Test 'Simple Test' started (1 block)"

    def test_formats_zero_blocks(self) -> None:
        """format_execution_start handles zero blocks."""
        from wavecore.core.logging.formatter import format_execution_start

        result = format_execution_start(
            execution_id="abc12",
            test_name="Empty Test",
            block_count=0,
        )

        assert result == "Execution[abc12] Test 'Empty Test' started (0 blocks)"

    def test_handles_test_name_with_special_characters(self) -> None:
        """format_execution_start handles test names with special characters."""
        from wavecore.core.logging.formatter import format_execution_start

        result = format_execution_start(
            execution_id="abc12",
            test_name="Test: Check [API] <response>",
            block_count=2,
        )

        assert "Test: Check [API] <response>" in result


class TestFormatExecutionComplete:
    """Tests for format_execution_complete() - execution completion log format."""

    def test_formats_passed_execution(self) -> None:
        """format_execution_complete produces Execution[id] completed: passed format."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abc12def-3456-7890-abcd-ef1234567890",
            status="passed",
            duration_ms=398.0,
        )

        assert result == "Execution[abc12] completed: passed (398ms)"

    def test_formats_failed_execution(self) -> None:
        """format_execution_complete formats failed status."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abc12",
            status="failed",
            duration_ms=1234.5,
        )

        assert result == "Execution[abc12] completed: failed (1234ms)"

    def test_formats_error_execution(self) -> None:
        """format_execution_complete formats error status."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="xyz99",
            status="error",
            duration_ms=500.0,
        )

        assert result == "Execution[xyz99] completed: error (500ms)"

    def test_rounds_duration_to_integer_milliseconds(self) -> None:
        """format_execution_complete rounds duration to integer milliseconds."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abc12",
            status="passed",
            duration_ms=398.7,
        )

        assert "(399ms)" in result

    def test_uses_first_5_chars_of_execution_id(self) -> None:
        """format_execution_complete uses only first 5 characters of execution ID."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abcde-uuid-that-is-very-long",
            status="passed",
            duration_ms=100.0,
        )

        assert "[abcde]" in result

    def test_handles_stopped_status(self) -> None:
        """format_execution_complete handles stopped status."""
        from wavecore.core.logging.formatter import format_execution_complete

        result = format_execution_complete(
            execution_id="abc12",
            status="stopped",
            duration_ms=250.0,
        )

        assert result == "Execution[abc12] completed: stopped (250ms)"


class TestFormatSource:
    """Tests for format_source() - test console source formatting."""

    def test_formats_system_source(self) -> None:
        """format_source produces [SYSTEM] for system lifecycle events."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="SYSTEM")

        assert result == "[SYSTEM]"

    def test_formats_named_plugin_source(self) -> None:
        """format_source produces [PluginType : ElementName] for named blocks."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="Log", element_name="Named Log")

        assert result == "[Log : Named Log]"

    def test_formats_unnamed_plugin_source(self) -> None:
        """format_source produces [PluginType] for unnamed blocks."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="Log")

        assert result == "[Log]"

    def test_formats_http_client_source(self) -> None:
        """format_source handles HTTP Client plugin type."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="HTTP Client", element_name="API Call")

        assert result == "[HTTP Client : API Call]"

    def test_handles_empty_element_name(self) -> None:
        """format_source treats empty string element_name same as None."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="Shell Script", element_name="")

        assert result == "[Shell Script]"

    def test_handles_whitespace_element_name(self) -> None:
        """format_source treats whitespace-only element_name same as None."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="Python", element_name="   ")

        assert result == "[Python]"

    def test_handles_combined_source_with_colon(self) -> None:
        """format_source splits 'Type:Name' and adds proper spacing."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="Delay:Wait half a sec")

        assert result == "[Delay : Wait half a sec]"

    def test_handles_combined_source_with_spaces(self) -> None:
        """format_source handles combined source with existing spaces."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="Log : Named Log")

        assert result == "[Log : Named Log]"

    def test_handles_combined_source_type_only(self) -> None:
        """format_source handles source with colon but no name after."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="Delay:")

        assert result == "[Delay]"

    def test_formats_a_block_source_with_the_type_alone(self) -> None:
        """format_source prints a block named as its type as [Type] (EXEC-25)."""
        from wavecore.core.logging.formatter import format_source

        assert format_source(source_type="SQL") == "[SQL]"

    def test_formats_a_block_source_with_a_name(self) -> None:
        """format_source prints a block's `Type : Name` source as it stands (EXEC-25)."""
        from wavecore.core.logging.formatter import format_source

        assert format_source(source_type="SQL : Run PSQL Proc") == "[SQL : Run PSQL Proc]"

    def test_keeps_a_colon_inside_the_name_as_typed(self) -> None:
        """format_source splits at the first colon only, so a Name keeps its own colons."""
        from wavecore.core.logging.formatter import format_source

        result = format_source(source_type="HTTP : GET http://host/x")

        assert result == "[HTTP : GET http://host/x]"

    def test_keeps_a_name_that_starts_with_a_colon(self) -> None:
        """format_source keeps a Name whose first character is a colon."""
        from wavecore.core.logging.formatter import format_source

        assert format_source(source_type="SQL : :staging") == "[SQL : :staging]"

    @pytest.mark.parametrize(
        ("source", "expected"),
        [
            ("If / Else", "[If / Else]"),
            ("If / Else : Check stock", "[If / Else : Check stock]"),
            ("Try / Catch : Guard the call", "[Try / Catch : Guard the call]"),
            ("Var Setter : Var Setter_1", "[Var Setter : Var Setter_1]"),
        ],
        ids=["type-alone", "if-else", "try-catch", "var-setter"],
    )
    def test_keeps_a_palette_name_that_holds_a_slash_or_a_space(
        self, source: str, expected: str
    ) -> None:
        """format_source leaves the spaces and slashes of a palette name alone."""
        from wavecore.core.logging.formatter import format_source

        assert format_source(source_type=source) == expected


class TestFormatConsoleMessage:
    """Tests for format_console_message() - test console format with [SOURCE]."""

    def test_formats_system_message(self) -> None:
        """format_console_message produces HH:MM:SS.mmm LEVEL [SYSTEM] message."""
        from wavecore.core.logging.formatter import format_console_message

        dt = datetime(2025, 1, 15, 5, 6, 53, 602000, tzinfo=UTC)
        result = format_console_message(
            level="INFO",
            message="Test 'TLS Certificate Validation' execution started (3 blocks)",
            source_type="SYSTEM",
            timestamp=dt,
        )

        assert (
            result == "05:06:53.602 INFO  [SYSTEM] Test 'TLS Certificate Validation' "
            "execution started (3 blocks)"
        )

    def test_formats_named_plugin_message(self) -> None:
        """format_console_message formats named plugin source."""
        from wavecore.core.logging.formatter import format_console_message

        dt = datetime(2025, 1, 15, 5, 6, 54, 602000, tzinfo=UTC)
        result = format_console_message(
            level="INFO",
            message="log with a name",
            source_type="Log",
            element_name="Named Log",
            timestamp=dt,
        )

        assert result == "05:06:54.602 INFO  [Log : Named Log] log with a name"

    def test_formats_unnamed_plugin_message(self) -> None:
        """format_console_message formats unnamed plugin source."""
        from wavecore.core.logging.formatter import format_console_message

        dt = datetime(2025, 1, 15, 5, 6, 54, 602000, tzinfo=UTC)
        result = format_console_message(
            level="WARN",
            message="log with no name",
            source_type="Log",
            timestamp=dt,
        )

        assert result == "05:06:54.602 WARN  [Log] log with no name"

    def test_formats_completion_message(self) -> None:
        """format_console_message formats test completion message."""
        from wavecore.core.logging.formatter import format_console_message

        dt = datetime(2025, 1, 15, 5, 6, 54, 602000, tzinfo=UTC)
        result = format_console_message(
            level="INFO",
            message="Test 'TLS Certificate Validation' completed successfully",
            source_type="SYSTEM",
            timestamp=dt,
        )

        assert (
            result == "05:06:54.602 INFO  [SYSTEM] Test 'TLS Certificate Validation' "
            "completed successfully"
        )

    def test_uses_current_time_when_no_timestamp_provided(self) -> None:
        """format_console_message uses current time when no timestamp provided."""
        from wavecore.core.logging.formatter import format_console_message

        result = format_console_message(
            level="DEBUG",
            message="Debug output",
            source_type="Python",
        )

        # Should match pattern: HH:MM:SS.mmm LEVEL [SOURCE] message
        pattern = r"^\d{2}:\d{2}:\d{2}\.\d{3} DEBUG \[Python\] Debug output$"
        assert re.match(pattern, result), f"'{result}' does not match expected pattern"


class TestUnifiedFormatter:
    """Tests for UnifiedFormatter - Python logging.Formatter integration."""

    def test_creates_formatter_for_backend_terminal(self) -> None:
        """UnifiedFormatter can be created for backend terminal output."""
        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")

        assert formatter.stream_type == "backend"

    def test_creates_formatter_for_test_console(self) -> None:
        """UnifiedFormatter can be created for test console output."""
        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="console")

        assert formatter.stream_type == "console"

    def test_formats_log_record_for_backend(self) -> None:
        """UnifiedFormatter formats LogRecord for backend terminal."""
        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")
        record = logging.LogRecord(
            name="wavecore.api",
            level=logging.INFO,
            pathname="app.py",
            lineno=10,
            msg="Server started",
            args=(),
            exc_info=None,
        )

        result = formatter.format(record)

        # Should match pattern: HH:MM:SS.mmm INFO  Server started
        pattern = r"^\d{2}:\d{2}:\d{2}\.\d{3} INFO  Server started$"
        assert re.match(pattern, result), f"'{result}' does not match expected pattern"

    def test_formats_log_record_with_args(self) -> None:
        """UnifiedFormatter formats LogRecord with message arguments."""
        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")
        record = logging.LogRecord(
            name="wavecore.api",
            level=logging.INFO,
            pathname="app.py",
            lineno=10,
            msg="User %s logged in",
            args=("admin",),
            exc_info=None,
        )

        result = formatter.format(record)

        assert "User admin logged in" in result

    def test_maps_python_warning_to_warn(self) -> None:
        """UnifiedFormatter maps Python WARNING level to WARN."""
        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")
        record = logging.LogRecord(
            name="test",
            level=logging.WARNING,
            pathname="test.py",
            lineno=1,
            msg="A warning",
            args=(),
            exc_info=None,
        )

        result = formatter.format(record)

        assert "WARN " in result
        assert "WARNING" not in result

    def test_maps_python_critical_to_fatal(self) -> None:
        """UnifiedFormatter maps Python CRITICAL level to FATAL."""
        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")
        record = logging.LogRecord(
            name="test",
            level=logging.CRITICAL,
            pathname="test.py",
            lineno=1,
            msg="Critical error",
            args=(),
            exc_info=None,
        )

        result = formatter.format(record)

        assert "FATAL" in result
        assert "CRITICAL" not in result

    def test_raises_for_invalid_stream_type(self) -> None:
        """UnifiedFormatter raises ValueError for invalid stream type."""
        from wavecore.core.logging.formatter import UnifiedFormatter

        with pytest.raises(ValueError) as exc_info:
            UnifiedFormatter(stream_type="invalid")

        assert (
            str(exc_info.value) == "Invalid stream type 'invalid'. Must be 'backend' or 'console'"
        )

    def test_format_silently_ignores_import_error_for_correlation_id(self) -> None:
        """UnifiedFormatter.format silently ignores ImportError when middleware is unavailable."""
        import sys

        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")
        record = logging.LogRecord(
            name="wavecore.api",
            level=logging.INFO,
            pathname="app.py",
            lineno=10,
            msg="No correlation id available",
            args=(),
            exc_info=None,
        )

        # Remove the middleware module so the import inside format() raises ImportError
        saved = sys.modules.pop("wavecore.api.middleware", None)
        try:
            with patch.dict(sys.modules, {"wavecore.api.middleware": None}):  # type: ignore[dict-item]
                result = formatter.format(record)
        finally:
            if saved is not None:
                sys.modules["wavecore.api.middleware"] = saved

        # Message must be formatted normally - no correlation ID prefix, no exception raised
        pattern = r"^\d{2}:\d{2}:\d{2}\.\d{3} INFO  No correlation id available$"
        assert re.match(pattern, result), f"'{result}' does not match expected pattern"

    def test_format_silently_ignores_lookup_error_from_context_var(self) -> None:
        """UnifiedFormatter.format silently ignores LookupError from context var .get()."""
        import sys
        from unittest.mock import MagicMock

        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")
        record = logging.LogRecord(
            name="wavecore.api",
            level=logging.INFO,
            pathname="app.py",
            lineno=10,
            msg="Context var lookup failed",
            args=(),
            exc_info=None,
        )

        # Build a fake middleware module whose ContextVar.get() raises LookupError
        fake_middleware = MagicMock()
        fake_middleware.request_correlation_id.get.side_effect = LookupError("no value in context")

        with patch.dict(sys.modules, {"wavecore.api.middleware": fake_middleware}):
            result = formatter.format(record)

        # Message must be formatted normally - no prefix, no exception raised
        pattern = r"^\d{2}:\d{2}:\d{2}\.\d{3} INFO  Context var lookup failed$"
        assert re.match(pattern, result), f"'{result}' does not match expected pattern"


class TestConfigureUnifiedLogging:
    """Tests for configure_unified_logging() - logging configuration."""

    def test_configures_root_logger_with_unified_format(self) -> None:
        """configure_unified_logging sets UnifiedFormatter on root logger."""
        from wavecore.core.logging.formatter import configure_unified_logging

        # Configure logging
        configure_unified_logging()

        # Get the root logger's handler
        root_logger = logging.getLogger()
        handlers = [h for h in root_logger.handlers if hasattr(h, "formatter")]

        # At least one handler should have UnifiedFormatter
        assert any(
            type(h.formatter).__name__ == "UnifiedFormatter"
            for h in handlers
            if h.formatter is not None
        ), "No handler with UnifiedFormatter found"

    def test_accepts_log_level_parameter(self) -> None:
        """configure_unified_logging accepts log level parameter."""
        from wavecore.core.logging.formatter import configure_unified_logging

        # Should not raise
        configure_unified_logging(level="DEBUG")
        configure_unified_logging(level="INFO")
        configure_unified_logging(level="WARN")
        configure_unified_logging(level="ERROR")

    def test_removes_existing_handlers_by_default(self) -> None:
        """configure_unified_logging removes existing handlers by default."""
        from wavecore.core.logging.formatter import configure_unified_logging

        root_logger = logging.getLogger()

        # Add a custom handler
        test_handler = logging.StreamHandler()
        test_handler.name = "test_handler_to_remove"
        root_logger.addHandler(test_handler)

        # Configure logging
        configure_unified_logging()

        # Test handler should be removed
        handler_names = [h.name for h in root_logger.handlers]
        assert "test_handler_to_remove" not in handler_names


class TestShortExecutionId:
    """Tests for short_execution_id() - extracts first 5 chars of execution ID."""

    def test_extracts_first_5_chars(self) -> None:
        """short_execution_id extracts first 5 characters."""
        from wavecore.core.logging.formatter import short_execution_id

        result = short_execution_id("abc12def-3456-7890")

        assert result == "abc12"

    def test_handles_short_id(self) -> None:
        """short_execution_id handles IDs shorter than 5 characters."""
        from wavecore.core.logging.formatter import short_execution_id

        result = short_execution_id("abc")

        assert result == "abc"

    def test_handles_exactly_5_chars(self) -> None:
        """short_execution_id handles ID with exactly 5 characters."""
        from wavecore.core.logging.formatter import short_execution_id

        result = short_execution_id("exact")

        assert result == "exact"

    def test_handles_empty_string(self) -> None:
        """short_execution_id handles empty string."""
        from wavecore.core.logging.formatter import short_execution_id

        result = short_execution_id("")

        assert result == ""


class TestLogLevelFromPython:
    """Tests for log_level_from_python() - maps Python levels to WAVE levels."""

    def test_maps_debug_level(self) -> None:
        """log_level_from_python maps DEBUG correctly."""
        from wavecore.core.logging.formatter import log_level_from_python

        result = log_level_from_python(logging.DEBUG)

        assert result == "DEBUG"

    def test_maps_info_level(self) -> None:
        """log_level_from_python maps INFO correctly."""
        from wavecore.core.logging.formatter import log_level_from_python

        result = log_level_from_python(logging.INFO)

        assert result == "INFO"

    def test_maps_warning_to_warn(self) -> None:
        """log_level_from_python maps WARNING to WARN."""
        from wavecore.core.logging.formatter import log_level_from_python

        result = log_level_from_python(logging.WARNING)

        assert result == "WARN"

    def test_maps_error_level(self) -> None:
        """log_level_from_python maps ERROR correctly."""
        from wavecore.core.logging.formatter import log_level_from_python

        result = log_level_from_python(logging.ERROR)

        assert result == "ERROR"

    def test_maps_critical_to_fatal(self) -> None:
        """log_level_from_python maps CRITICAL to FATAL."""
        from wavecore.core.logging.formatter import log_level_from_python

        result = log_level_from_python(logging.CRITICAL)

        assert result == "FATAL"

    def test_maps_unknown_level_to_info(self) -> None:
        """log_level_from_python maps unknown levels to INFO."""
        from wavecore.core.logging.formatter import log_level_from_python

        result = log_level_from_python(25)  # Between INFO (20) and WARNING (30)

        assert result == "INFO"


class TestSetLogLevel:
    """Tests for set_log_level() - runtime log level changes."""

    def test_sets_debug_level(self) -> None:
        """set_log_level changes level to DEBUG."""
        from wavecore.core.logging.formatter import get_log_level, set_log_level

        result = set_log_level("DEBUG")

        assert result == "DEBUG"
        assert get_log_level() == "DEBUG"

    def test_sets_info_level(self) -> None:
        """set_log_level changes level to INFO."""
        from wavecore.core.logging.formatter import get_log_level, set_log_level

        result = set_log_level("INFO")

        assert result == "INFO"
        assert get_log_level() == "INFO"

    def test_sets_warn_level(self) -> None:
        """set_log_level changes level to WARN."""
        from wavecore.core.logging.formatter import get_log_level, set_log_level

        result = set_log_level("WARN")

        assert result == "WARN"
        assert get_log_level() == "WARN"

    def test_sets_error_level(self) -> None:
        """set_log_level changes level to ERROR."""
        from wavecore.core.logging.formatter import get_log_level, set_log_level

        result = set_log_level("ERROR")

        assert result == "ERROR"
        assert get_log_level() == "ERROR"

    def test_sets_fatal_level(self) -> None:
        """set_log_level changes level to FATAL."""
        from wavecore.core.logging.formatter import get_log_level, set_log_level

        result = set_log_level("FATAL")

        assert result == "FATAL"
        assert get_log_level() == "FATAL"

    def test_normalizes_lowercase_level(self) -> None:
        """set_log_level normalizes lowercase input."""
        from wavecore.core.logging.formatter import set_log_level

        result = set_log_level("debug")

        assert result == "DEBUG"

    def test_asyncssh_logger_is_one_level_stricter_than_wave(self) -> None:
        # asyncssh logs the whole SSH transport (incl. the base64 remote-exec
        # worker command) at INFO; keep it one level finer so it surfaces only
        # at DEBUG.
        import logging

        from wavecore.core.logging.formatter import set_log_level

        set_log_level("INFO")
        assert logging.getLogger("asyncssh").level == logging.WARNING

        set_log_level("DEBUG")
        assert logging.getLogger("asyncssh").level == logging.INFO

        set_log_level("FATAL")
        assert logging.getLogger("asyncssh").level == logging.CRITICAL

        set_log_level("INFO")

    def test_the_sql_server_driver_logger_is_one_level_stricter_than_wave(self) -> None:
        import logging

        from wavecore.core.logging.formatter import set_log_level

        driver = logging.getLogger("pytds")
        login = logging.getLogger("pytds.tds_session")
        before = driver.level
        try:
            set_log_level("INFO")
            assert driver.level == logging.WARNING
            assert login.isEnabledFor(logging.INFO) is False

            set_log_level("DEBUG")
            assert driver.level == logging.INFO
            assert login.isEnabledFor(logging.INFO) is True

            set_log_level("FATAL")
            assert driver.level == logging.CRITICAL
        finally:
            set_log_level("INFO")
            driver.setLevel(before)

    def test_raises_for_invalid_level(self) -> None:
        """set_log_level raises ValueError for invalid level."""
        import pytest

        from wavecore.core.logging.formatter import set_log_level

        with pytest.raises(ValueError, match="Invalid log level"):
            set_log_level("INVALID")

    def test_updates_all_handlers(self) -> None:
        """set_log_level updates all handlers on root logger."""
        import logging

        from wavecore.core.logging.formatter import set_log_level

        # Add a test handler
        root_logger = logging.getLogger()
        test_handler = logging.StreamHandler()
        root_logger.addHandler(test_handler)

        try:
            set_log_level("ERROR")

            # Verify handler level was updated
            assert test_handler.level == logging.ERROR
        finally:
            root_logger.removeHandler(test_handler)


class TestCanonicalLevel:
    """canonical_level() gives the one name WAVE uses for a level and changes nothing."""

    @pytest.mark.parametrize(
        ("given", "expected"),
        [
            ("DEBUG", "DEBUG"),
            ("INFO", "INFO"),
            ("WARN", "WARN"),
            ("ERROR", "ERROR"),
            ("FATAL", "FATAL"),
            ("debug", "DEBUG"),
            ("Info", "INFO"),
            ("warn", "WARN"),
            ("fatal", "FATAL"),
        ],
    )
    def test_returns_the_upper_case_name(self, given: str, expected: str) -> None:
        from wavecore.core.logging.formatter import canonical_level

        assert canonical_level(given) == expected

    @pytest.mark.parametrize(
        ("given", "expected"),
        [
            ("warning", "WARN"),
            ("WARNING", "WARN"),
            ("critical", "FATAL"),
            ("CRITICAL", "FATAL"),
        ],
    )
    def test_maps_the_python_names_to_the_wave_names(self, given: str, expected: str) -> None:
        from wavecore.core.logging.formatter import canonical_level

        assert canonical_level(given) == expected

    @pytest.mark.parametrize("given", ["verbose", "TRACE"])
    def test_refuses_an_unknown_level_with_the_exact_message(self, given: str) -> None:
        from wavecore.core.logging.formatter import canonical_level

        with pytest.raises(ValueError, match=INVALID_LEVEL.format(level=re.escape(given))):
            canonical_level(given)

    def test_every_valid_level_is_its_own_canonical_name(self) -> None:
        from wavecore.core.logging.formatter import VALID_LEVELS, canonical_level

        assert VALID_LEVELS == {"DEBUG", "INFO", "WARN", "ERROR", "FATAL"}
        assert {canonical_level(level) for level in VALID_LEVELS} == VALID_LEVELS

    def test_leaves_the_level_in_force_alone(self) -> None:
        from wavecore.core.logging.formatter import canonical_level

        root_logger = logging.getLogger()
        before = root_logger.level
        other = "ERROR" if before == logging.DEBUG else "DEBUG"

        canonical_level(other)

        assert root_logger.level == before


@pytest.mark.usefixtures("restore_log_levels")
class TestSetLogLevelCanonicalName:
    """set_log_level() answers with the canonical name of the level it set."""

    @pytest.mark.parametrize(
        ("given", "name", "python_level"),
        [
            ("warning", "WARN", logging.WARNING),
            ("WARNING", "WARN", logging.WARNING),
            ("critical", "FATAL", logging.CRITICAL),
            ("CRITICAL", "FATAL", logging.CRITICAL),
        ],
    )
    def test_python_name_sets_the_level_and_returns_the_wave_name(
        self, given: str, name: str, python_level: int
    ) -> None:
        from wavecore.core.logging.formatter import get_log_level, set_log_level

        result = set_log_level(given)

        assert result == name
        assert logging.getLogger().level == python_level
        assert get_log_level() == name

    def test_unknown_level_keeps_the_exact_message_and_the_level_in_force(self) -> None:
        from wavecore.core.logging.formatter import set_log_level

        set_log_level("ERROR")

        with pytest.raises(ValueError, match=INVALID_LEVEL.format(level="verbose")):
            set_log_level("verbose")

        assert logging.getLogger().level == logging.ERROR


class TestGetLogLevel:
    """Tests for get_log_level() - query current log level."""

    def test_returns_current_level(self) -> None:
        """get_log_level returns the current log level."""
        from wavecore.core.logging.formatter import get_log_level, set_log_level

        set_log_level("WARN")
        result = get_log_level()

        assert result == "WARN"

    def test_returns_info_for_unknown_level(self) -> None:
        """get_log_level returns INFO for unmapped Python levels."""
        import logging

        from wavecore.core.logging.formatter import get_log_level

        root_logger = logging.getLogger()
        original_level = root_logger.level

        try:
            # Set to an unusual level not in the map
            root_logger.setLevel(25)  # Between INFO and WARNING
            result = get_log_level()

            assert result == "INFO"
        finally:
            root_logger.setLevel(original_level)


class TestCapMessage:
    """One hard bound on a finished log message, applied after the last masker.

    A message that would flood the console is cut once, at the end of the
    pipeline, and the cut says how much it removed.
    """

    def test_message_under_the_cap_passes_through(self) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY, cap_message

        text = "x" * (MAX_MESSAGE_DISPLAY - 1)

        assert cap_message(text) == text

    def test_message_at_the_cap_passes_through(self) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY, cap_message

        text = "x" * MAX_MESSAGE_DISPLAY

        assert cap_message(text) == text

    def test_message_over_the_cap_is_cut_and_says_so(self) -> None:
        from wavecore.core.logging.formatter import (
            _MESSAGE_MARKER_BUDGET,
            MAX_MESSAGE_DISPLAY,
            cap_message,
        )

        text = "x" * (MAX_MESSAGE_DISPLAY + 1)
        body_len = MAX_MESSAGE_DISPLAY - _MESSAGE_MARKER_BUDGET

        result = cap_message(text)

        assert result == "x" * body_len + f"\n... and {len(text) - body_len} more characters"
        assert len(result) <= MAX_MESSAGE_DISPLAY

    def test_cap_is_idempotent(self) -> None:
        from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY, cap_message

        text = "x" * (MAX_MESSAGE_DISPLAY * 3)
        once = cap_message(text)

        assert cap_message(once) == once
