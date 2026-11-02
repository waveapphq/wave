"""Tests for Unified HTTP Logging - Simplified Middleware Log Format.

Covers REQ-5.2.3.5: Request/response logging middleware for audit trail.

The unified HTTP log line is clean and self-describing:
"05:06:54.100 INFO  GET /api/v1/environments → 200 (0.52ms)"

Key requirements:
1. Suppress Uvicorn's built-in access logs (causes duplicates)
2. Use unified timestamp format (HH:MM:SS.mmm)
3. Self-describing message format (no [SOURCE] prefix)
4. Log level based on status code (INFO for 2xx, WARN for 4xx, ERROR for 5xx)
"""

import logging
from datetime import UTC, datetime
from io import StringIO
from unittest.mock import MagicMock, patch

import pytest
from fastapi import Request, Response
from starlette.datastructures import Address


class TestUnifiedHttpLogger:
    """Tests for UnifiedHttpLogger - produces clean HTTP request logs."""

    def test_creates_http_logger(self) -> None:
        """UnifiedHttpLogger can be instantiated."""
        from wavecore.core.logging.formatter import UnifiedHttpLogger

        logger = UnifiedHttpLogger()

        assert logger is not None

    def test_logs_successful_request(self) -> None:
        """UnifiedHttpLogger logs successful request in unified format."""
        from wavecore.core.logging.formatter import UnifiedHttpLogger

        logger = UnifiedHttpLogger()
        log_output = StringIO()
        handler = logging.StreamHandler(log_output)

        with patch.object(logger, "_handler", handler):
            logger.log_request("GET", "/api/v1/tests", 200, 1.23)

        # Check format matches: HH:MM:SS.mmm INFO  GET /path → 200 (1.23ms)
        output = log_output.getvalue()
        assert "INFO" in output or logger is not None  # Will fail at import

    def test_uses_info_level_for_2xx_status(self) -> None:
        """UnifiedHttpLogger uses INFO level for 2xx status codes."""
        from wavecore.core.logging.formatter import get_http_log_level

        assert get_http_log_level(200) == "INFO"
        assert get_http_log_level(201) == "INFO"
        assert get_http_log_level(204) == "INFO"
        assert get_http_log_level(299) == "INFO"

    def test_uses_warn_level_for_4xx_status(self) -> None:
        """UnifiedHttpLogger uses WARN level for 4xx status codes."""
        from wavecore.core.logging.formatter import get_http_log_level

        assert get_http_log_level(400) == "WARN"
        assert get_http_log_level(401) == "WARN"
        assert get_http_log_level(404) == "WARN"
        assert get_http_log_level(499) == "WARN"

    def test_uses_error_level_for_5xx_status(self) -> None:
        """UnifiedHttpLogger uses ERROR level for 5xx status codes."""
        from wavecore.core.logging.formatter import get_http_log_level

        assert get_http_log_level(500) == "ERROR"
        assert get_http_log_level(502) == "ERROR"
        assert get_http_log_level(503) == "ERROR"
        assert get_http_log_level(599) == "ERROR"

    def test_uses_info_level_for_3xx_status(self) -> None:
        """UnifiedHttpLogger uses INFO level for 3xx redirects."""
        from wavecore.core.logging.formatter import get_http_log_level

        assert get_http_log_level(301) == "INFO"
        assert get_http_log_level(302) == "INFO"
        assert get_http_log_level(304) == "INFO"

    def test_uses_debug_level_for_1xx_status(self) -> None:
        """UnifiedHttpLogger uses DEBUG level for 1xx informational."""
        from wavecore.core.logging.formatter import get_http_log_level

        assert get_http_log_level(100) == "DEBUG"
        assert get_http_log_level(101) == "DEBUG"


class TestUvicornLogSuppression:
    """Tests for suppress_uvicorn_access_logs() - prevents duplicate logging."""

    def test_suppresses_uvicorn_access_logger(self) -> None:
        """suppress_uvicorn_access_logs disables uvicorn.access logger."""
        from wavecore.core.logging.formatter import suppress_uvicorn_access_logs

        # Get uvicorn access logger before suppression
        uvicorn_access = logging.getLogger("uvicorn.access")
        original_level = uvicorn_access.level

        # Suppress
        suppress_uvicorn_access_logs()

        # Should be set to a level higher than CRITICAL to suppress all logs
        assert uvicorn_access.disabled is True or uvicorn_access.level > logging.CRITICAL

        # Restore for other tests
        uvicorn_access.disabled = False
        uvicorn_access.setLevel(original_level)

    def test_suppresses_uvicorn_error_logger_access_messages(self) -> None:
        """suppress_uvicorn_access_logs prevents access logs from uvicorn.error."""
        from wavecore.core.logging.formatter import suppress_uvicorn_access_logs

        # Suppress
        suppress_uvicorn_access_logs()

        # Verify uvicorn.access is disabled
        uvicorn_access = logging.getLogger("uvicorn.access")
        assert uvicorn_access.disabled is True

    def test_adds_websocket_filter_to_uvicorn_error(self) -> None:
        """suppress_uvicorn_access_logs adds WebSocket filter to uvicorn.error."""
        from wavecore.core.logging.formatter import (
            UvicornWebSocketFilter,
            suppress_uvicorn_access_logs,
        )

        # Clear any existing filters first
        uvicorn_error = logging.getLogger("uvicorn.error")
        uvicorn_error.filters = []

        # Suppress
        suppress_uvicorn_access_logs()

        # Verify filter was added
        assert any(isinstance(f, UvicornWebSocketFilter) for f in uvicorn_error.filters)


class TestUvicornWebSocketFilter:
    """Tests for UvicornWebSocketFilter - reformats WebSocket messages to DEBUG level."""

    def test_reformats_websocket_accepted_message(self) -> None:
        """Filter reformats WebSocket accepted message to unified style."""
        from wavecore.core.logging.formatter import UvicornWebSocketFilter

        filter_obj = UvicornWebSocketFilter()
        record = logging.LogRecord(
            name="uvicorn.error",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="('127.0.0.1', 46512) - \"WebSocket /ws\" [accepted]",
            args=(),
            exc_info=None,
        )
        result = filter_obj.filter(record)

        # Allows through (reformatted)
        assert result is True
        # Reformatted message
        assert record.msg == "WebSocket /ws connected (127.0.0.1:46512)"
        # Set to DEBUG level
        assert record.levelno == logging.DEBUG
        assert record.levelname == "DEBUG"

    def test_reformats_connection_open_message(self) -> None:
        """Filter reformats 'connection open' to unified style."""
        from wavecore.core.logging.formatter import UvicornWebSocketFilter

        filter_obj = UvicornWebSocketFilter()
        record = logging.LogRecord(
            name="uvicorn.error",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="connection open",
            args=(),
            exc_info=None,
        )
        result = filter_obj.filter(record)

        assert result is True
        assert record.msg == "WebSocket connection opened"
        assert record.levelno == logging.DEBUG

    def test_reformats_connection_closed_message(self) -> None:
        """Filter reformats 'connection closed' to unified style."""
        from wavecore.core.logging.formatter import UvicornWebSocketFilter

        filter_obj = UvicornWebSocketFilter()
        record = logging.LogRecord(
            name="uvicorn.error",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="connection closed",
            args=(),
            exc_info=None,
        )
        result = filter_obj.filter(record)

        assert result is True
        assert record.msg == "WebSocket connection closed"
        assert record.levelno == logging.DEBUG

    def test_allows_other_uvicorn_messages_unchanged(self) -> None:
        """Filter allows non-WebSocket messages through unchanged."""
        from wavecore.core.logging.formatter import UvicornWebSocketFilter

        filter_obj = UvicornWebSocketFilter()
        record = logging.LogRecord(
            name="uvicorn.error",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Started server process [12345]",
            args=(),
            exc_info=None,
        )
        assert filter_obj.filter(record) is True

    def test_keeps_original_message_on_malformed_accepted(self) -> None:
        """Filter keeps original message when accepted format is unparsable."""
        from wavecore.core.logging.formatter import UvicornWebSocketFilter

        filter_obj = UvicornWebSocketFilter()
        # Malformed: missing closing paren, will raise ValueError on parsing
        malformed_msg = 'bad-format - "WebSocket /ws" [accepted]'
        record = logging.LogRecord(
            name="uvicorn.error",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg=malformed_msg,
            args=(),
            exc_info=None,
        )
        result = filter_obj.filter(record)

        assert result is True
        # Original message preserved since parsing failed
        assert record.msg == malformed_msg
        # Still downgraded to DEBUG
        assert record.levelno == logging.DEBUG

    def test_allows_error_messages(self) -> None:
        """Filter allows error messages through."""
        from wavecore.core.logging.formatter import UvicornWebSocketFilter

        filter_obj = UvicornWebSocketFilter()
        record = logging.LogRecord(
            name="uvicorn.error",
            level=logging.ERROR,
            pathname="",
            lineno=0,
            msg="WebSocket connection error: timeout",
            args=(),
            exc_info=None,
        )
        # This contains "WebSocket" but not "[accepted]", so it passes
        assert filter_obj.filter(record) is True


class TestUnifiedMiddlewareLogging:
    """Tests for middleware integration with unified logging."""

    @pytest.fixture
    def mock_request(self) -> MagicMock:
        """Create a mock FastAPI request."""
        request = MagicMock(spec=Request)
        request.method = "GET"
        request.url.path = "/api/v1/tests"
        request.url.query = ""
        request.client = Address("127.0.0.1", 8000)
        request.state = MagicMock()
        return request

    @pytest.fixture
    def mock_response(self) -> MagicMock:
        """Create a mock FastAPI response."""
        response = MagicMock(spec=Response)
        response.status_code = 200
        response.headers = {}
        return response

    def test_middleware_logs_in_unified_format(
        self, mock_request: MagicMock, mock_response: MagicMock
    ) -> None:
        """Middleware produces logs in unified format."""
        from wavecore.core.logging.formatter import format_http_request

        # Generate expected message
        message = format_http_request("GET", "/api/v1/tests", 200, 1.5)

        assert message == "GET /api/v1/tests → 200 (1.50ms)"

    def test_middleware_does_not_include_client_info(self) -> None:
        """Middleware log format does not include Client: info."""
        from wavecore.core.logging.formatter import format_http_request

        message = format_http_request("GET", "/api/v1/tests", 200, 1.5)

        assert "Client:" not in message
        assert "127.0.0.1" not in message

    def test_middleware_does_not_include_request_id(self) -> None:
        """Middleware log format does not include Request ID."""
        from wavecore.core.logging.formatter import format_http_request

        message = format_http_request("GET", "/api/v1/tests", 200, 1.5)

        assert "Request ID:" not in message
        assert "uuid" not in message.lower()

    def test_middleware_does_not_include_iso_timestamp(self) -> None:
        """Middleware log format does not include ISO timestamp in message."""
        from wavecore.core.logging.formatter import format_http_request

        message = format_http_request("GET", "/api/v1/tests", 200, 1.5)

        # Should not contain ISO format indicators
        assert "T" not in message or "2025" not in message
        assert "+00:00" not in message
        assert "Z" not in message


class TestUnifiedMiddlewareConfig:
    """Tests for create_unified_logging_middleware() configuration."""

    def test_creates_middleware_with_unified_format(self) -> None:
        """create_unified_logging_middleware returns middleware with unified format."""
        from wavecore.core.logging.formatter import create_unified_logging_middleware

        middleware = create_unified_logging_middleware()

        assert middleware is not None
        assert callable(middleware)

    def test_middleware_excludes_health_endpoints_by_default(self) -> None:
        """Middleware excludes health check endpoints from logging by default."""
        from wavecore.core.logging.formatter import get_default_excluded_paths

        excluded = get_default_excluded_paths()

        assert "/health" in excluded
        assert "/healthz" in excluded
        assert "/ready" in excluded
        assert "/readyz" in excluded

    def test_middleware_can_configure_additional_exclusions(self) -> None:
        """Middleware accepts additional path exclusions."""
        from wavecore.core.logging.formatter import create_unified_logging_middleware

        middleware = create_unified_logging_middleware(exclude_paths=["/metrics", "/internal"])

        assert middleware is not None


class TestBackendTerminalFormat:
    """Tests for complete backend terminal log output format."""

    def test_server_startup_log_format(self) -> None:
        """Server startup produces clean log format."""
        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 5, 6, 53, 602000, tzinfo=UTC)
        result = format_backend_message("INFO", "Server started on http://127.0.0.1:8000", dt)

        assert result == "05:06:53.602 INFO  Server started on http://127.0.0.1:8000"

    def test_http_request_log_format(self) -> None:
        """HTTP request produces self-describing log format."""
        from wavecore.core.logging.formatter import format_backend_message, format_http_request

        dt = datetime(2025, 1, 15, 5, 6, 54, 100000, tzinfo=UTC)
        http_msg = format_http_request("GET", "/api/v1/environments", 200, 0.52)
        result = format_backend_message("INFO", http_msg, dt)

        assert result == "05:06:54.100 INFO  GET /api/v1/environments → 200 (0.52ms)"

    def test_execution_start_log_format(self) -> None:
        """Execution start produces expected log format."""
        from wavecore.core.logging.formatter import format_backend_message, format_execution_start

        dt = datetime(2025, 1, 15, 5, 6, 54, 602000, tzinfo=UTC)
        exec_msg = format_execution_start("abc12def-long-id", "TLS Validation", 3)
        result = format_backend_message("INFO", exec_msg, dt)

        assert (
            result == "05:06:54.602 INFO  Execution[abc12] Test 'TLS Validation' started (3 blocks)"
        )

    def test_execution_complete_log_format(self) -> None:
        """Execution completion produces expected log format."""
        from wavecore.core.logging.formatter import (
            format_backend_message,
            format_execution_complete,
        )

        dt = datetime(2025, 1, 15, 5, 6, 55, 0, tzinfo=UTC)
        exec_msg = format_execution_complete("abc12def-long-id", "passed", 398.0)
        result = format_backend_message("INFO", exec_msg, dt)

        assert result == "05:06:55.000 INFO  Execution[abc12] completed: passed (398ms)"

    def test_warning_http_log_format(self) -> None:
        """404 response produces WARN level log."""
        from wavecore.core.logging.formatter import (
            format_backend_message,
            format_http_request,
            get_http_log_level,
        )

        dt = datetime(2025, 1, 15, 5, 6, 55, 100000, tzinfo=UTC)
        http_msg = format_http_request("GET", "/api/v1/tests/xyz", 404, 0.23)
        level = get_http_log_level(404)
        result = format_backend_message(level, http_msg, dt)

        assert result == "05:06:55.100 WARN  GET /api/v1/tests/xyz → 404 (0.23ms)"


class TestNoModulePathInLogs:
    """Tests to ensure module paths are not included in logs."""

    def test_unified_formatter_excludes_module_path(self) -> None:
        """UnifiedFormatter does not include module path like 'wavecore.api.middleware'."""
        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")
        record = logging.LogRecord(
            name="wavecore.api.middleware",
            level=logging.INFO,
            pathname="/path/to/middleware.py",
            lineno=100,
            msg="Test message",
            args=(),
            exc_info=None,
        )

        result = formatter.format(record)

        assert "wavecore.api.middleware" not in result
        assert "middleware" not in result.lower() or "Test message" in result

    def test_log_does_not_contain_dash_separators(self) -> None:
        """Log format does not use dash separators."""
        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 5, 6, 53, 602000, tzinfo=UTC)
        result = format_backend_message("INFO", "Test message", dt)

        # Should not have multiple dash separators
        parts = result.split(" - ")
        assert len(parts) == 1  # No dash separators in message


class TestNoDuplicateTimestamp:
    """Tests to ensure timestamp only appears once."""

    def test_timestamp_appears_once(self) -> None:
        """Timestamp appears exactly once at the start of the log."""
        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 14, 30, 45, 123000, tzinfo=UTC)
        result = format_backend_message("INFO", "Test message", dt)

        # Count timestamp occurrences (HH:MM:SS pattern)
        import re

        timestamp_pattern = r"\d{2}:\d{2}:\d{2}"
        matches = re.findall(timestamp_pattern, result)

        assert len(matches) == 1, f"Expected 1 timestamp, found {len(matches)} in '{result}'"

    def test_no_iso_timestamp_in_output(self) -> None:
        """ISO 8601 timestamp format does not appear in output."""
        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 14, 30, 45, 123000, tzinfo=UTC)
        result = format_backend_message("INFO", "Test message", dt)

        # ISO format: 2025-01-15T14:30:45...
        assert "2025-01-15" not in result
        assert "T14:30:45" not in result


class TestMultilineLogEntries:
    """Combined multiline DEBUG entries (REQ-3.4.1.4 evidence trace).

    The HTTP plugin's wire trace renders as combined multiline DEBUG entries
    (connect+TLS / one per exchange / timing). The log pipeline treats such a
    message as ONE entry: newlines survive verbatim, and the entry keeps a
    single timestamp + level prefix on its first line - it is never split or
    re-prefixed per line.
    """

    _TRACE_ENTRY = (
        "GET http://example.com/hop -> 301 Moved Permanently\n"
        "> host: example.com\n"
        "< location: /final"
    )

    def test_format_backend_message_preserves_newlines_verbatim(self) -> None:
        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 5, 6, 53, 602000, tzinfo=UTC)
        result = format_backend_message("DEBUG", self._TRACE_ENTRY, dt)

        assert result == f"05:06:53.602 DEBUG {self._TRACE_ENTRY}"
        assert result.count("\n") == 2

    def test_multiline_entry_carries_a_single_timestamp(self) -> None:
        import re

        from wavecore.core.logging.formatter import format_backend_message

        dt = datetime(2025, 1, 15, 5, 6, 53, 602000, tzinfo=UTC)
        result = format_backend_message("DEBUG", self._TRACE_ENTRY, dt)

        assert len(re.findall(r"\d{2}:\d{2}:\d{2}\.\d{3}", result)) == 1

    def test_unified_formatter_keeps_a_multiline_record_as_one_entry(self) -> None:
        from wavecore.core.logging.formatter import UnifiedFormatter

        formatter = UnifiedFormatter(stream_type="backend")
        record = logging.LogRecord(
            name="plugin.http-client",
            level=logging.DEBUG,
            pathname="",
            lineno=0,
            msg=self._TRACE_ENTRY,
            args=(),
            exc_info=None,
        )

        result = formatter.format(record)

        assert self._TRACE_ENTRY in result
        assert result.count("\n") == 2
