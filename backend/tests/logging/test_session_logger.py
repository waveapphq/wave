"""Tests for SessionLogger - Session-aware Logger for WebSocket Streaming.

Covers REQ-3.7.2.5: Custom logging from tests/blocks.
Tests all log levels, thresholds, and format argument handling.
"""

import uuid
from unittest.mock import patch

import pytest

from wavecore.logging.session_logger import SessionLogger
from wavecore.models.enums import LogLevel


class TestSessionLoggerInit:
    """Tests for SessionLogger initialization."""

    def test_initializes_with_session_id_and_source(self) -> None:
        """SessionLogger initializes with session_id and source."""
        logger = SessionLogger(session_id="sess-123", source="HTTP Client")

        assert logger.session_id == "sess-123"
        assert logger.source == "HTTP Client"

    def test_defaults_threshold_to_debug(self) -> None:
        """SessionLogger defaults threshold to DEBUG."""
        logger = SessionLogger(session_id="sess-123", source="Test")

        assert logger.threshold == LogLevel.DEBUG

    def test_accepts_custom_threshold(self) -> None:
        """SessionLogger accepts custom threshold."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.ERROR)

        assert logger.threshold == LogLevel.ERROR

    def test_accepts_optional_block_id(self) -> None:
        """SessionLogger accepts optional block_id."""
        block_id = str(uuid.uuid4())
        logger = SessionLogger(session_id="sess-123", source="Test", block_id=block_id)

        assert logger.block_id == block_id

    def test_block_id_defaults_to_none(self) -> None:
        """SessionLogger defaults block_id to None."""
        logger = SessionLogger(session_id="sess-123", source="Test")

        assert logger.block_id is None


class TestShouldLog:
    """Tests for _should_log threshold filtering."""

    def test_returns_false_when_threshold_is_none(self) -> None:
        """Returns False when threshold is NONE (all logs filtered)."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.NONE)

        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is False
        assert logger._should_log(LogLevel.WARN) is False
        assert logger._should_log(LogLevel.ERROR) is False
        assert logger._should_log(LogLevel.FATAL) is False

    def test_debug_threshold_allows_all_levels(self) -> None:
        """DEBUG threshold allows all log levels."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.DEBUG)

        assert logger._should_log(LogLevel.DEBUG) is True
        assert logger._should_log(LogLevel.INFO) is True
        assert logger._should_log(LogLevel.WARN) is True
        assert logger._should_log(LogLevel.ERROR) is True
        assert logger._should_log(LogLevel.FATAL) is True

    def test_info_threshold_filters_debug(self) -> None:
        """INFO threshold filters DEBUG but allows INFO and above."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.INFO)

        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is True
        assert logger._should_log(LogLevel.WARN) is True
        assert logger._should_log(LogLevel.ERROR) is True
        assert logger._should_log(LogLevel.FATAL) is True

    def test_warn_threshold_filters_debug_and_info(self) -> None:
        """WARN threshold filters DEBUG and INFO."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.WARN)

        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is False
        assert logger._should_log(LogLevel.WARN) is True
        assert logger._should_log(LogLevel.ERROR) is True
        assert logger._should_log(LogLevel.FATAL) is True

    def test_error_threshold_allows_only_error_and_fatal(self) -> None:
        """ERROR threshold allows only ERROR and FATAL."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.ERROR)

        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is False
        assert logger._should_log(LogLevel.WARN) is False
        assert logger._should_log(LogLevel.ERROR) is True
        assert logger._should_log(LogLevel.FATAL) is True

    def test_fatal_threshold_allows_only_fatal(self) -> None:
        """FATAL threshold allows only FATAL."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.FATAL)

        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is False
        assert logger._should_log(LogLevel.WARN) is False
        assert logger._should_log(LogLevel.ERROR) is False
        assert logger._should_log(LogLevel.FATAL) is True


class TestLogMethod:
    """Tests for internal _log method."""

    def test_formats_message_with_args(self) -> None:
        """_log formats message with % args."""
        logger = SessionLogger(session_id="sess-123", source="Test")

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger._log("INFO", "Value: %s, Count: %d", "test", 42)

            mock_add_log.assert_called_once()
            call_kwargs = mock_add_log.call_args[1]
            assert call_kwargs["message"] == "Value: test, Count: 42"

    def test_handles_format_type_error(self) -> None:
        """_log handles TypeError from % formatting gracefully."""
        logger = SessionLogger(session_id="sess-123", source="Test")

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            # Pass wrong type for %d format
            logger._log("INFO", "Value: %d", "not-an-int")

            mock_add_log.assert_called_once()
            # Should use original message on format error
            call_kwargs = mock_add_log.call_args[1]
            assert call_kwargs["message"] == "Value: %d"

    def test_handles_format_value_error(self) -> None:
        """_log handles ValueError from % formatting gracefully."""
        logger = SessionLogger(session_id="sess-123", source="Test")

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            # Incomplete format string
            logger._log("INFO", "Value: %", "arg")

            mock_add_log.assert_called_once()
            # Should use original message on format error
            call_kwargs = mock_add_log.call_args[1]
            assert call_kwargs["message"] == "Value: %"

    def test_passes_session_and_source(self) -> None:
        """_log passes session_id and source to log_streaming_service."""
        logger = SessionLogger(
            session_id="sess-123",
            source="HTTP Client",
            block_id="block-456",
        )

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger._log("INFO", "Test message")

            mock_add_log.assert_called_once_with(
                session_id="sess-123",
                level="INFO",
                message="Test message",
                source="HTTP Client",
                block_id="block-456",
                unmask=False,
            )


class TestLogLevelMethods:
    """Tests for debug(), info(), warn(), warning(), error(), fatal(), critical()."""

    @pytest.fixture
    def logger(self) -> SessionLogger:
        """Create logger with DEBUG threshold to allow all logs."""
        return SessionLogger(
            session_id="sess-123",
            source="Test",
            threshold=LogLevel.DEBUG,
        )

    def test_debug_logs_at_debug_level(self, logger: SessionLogger) -> None:
        """debug() logs at DEBUG level when threshold permits."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.debug("Debug message")

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["level"] == "DEBUG"
            assert mock_add_log.call_args[1]["message"] == "Debug message"

    def test_debug_filtered_when_threshold_higher(self) -> None:
        """debug() is filtered when threshold is higher than DEBUG."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.INFO)

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.debug("Debug message")

            mock_add_log.assert_not_called()

    def test_info_logs_at_info_level(self, logger: SessionLogger) -> None:
        """info() logs at INFO level when threshold permits."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.info("Info message")

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["level"] == "INFO"
            assert mock_add_log.call_args[1]["message"] == "Info message"

    def test_warn_logs_at_warn_level(self, logger: SessionLogger) -> None:
        """warn() logs at WARN level when threshold permits."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.warn("Warn message")

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["level"] == "WARN"
            assert mock_add_log.call_args[1]["message"] == "Warn message"

    def test_warning_is_alias_for_warn(self, logger: SessionLogger) -> None:
        """warning() is an alias for warn()."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.warning("Warning message")

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["level"] == "WARN"
            assert mock_add_log.call_args[1]["message"] == "Warning message"

    def test_error_logs_at_error_level(self, logger: SessionLogger) -> None:
        """error() logs at ERROR level when threshold permits."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.error("Error message")

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["level"] == "ERROR"
            assert mock_add_log.call_args[1]["message"] == "Error message"

    def test_fatal_logs_at_fatal_level(self, logger: SessionLogger) -> None:
        """fatal() logs at FATAL level when threshold permits."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.fatal("Fatal message")

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["level"] == "FATAL"
            assert mock_add_log.call_args[1]["message"] == "Fatal message"

    def test_critical_is_alias_for_fatal(self, logger: SessionLogger) -> None:
        """critical() is an alias for fatal()."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.critical("Critical message")

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["level"] == "FATAL"
            assert mock_add_log.call_args[1]["message"] == "Critical message"

    def test_log_methods_support_format_args(self, logger: SessionLogger) -> None:
        """All log methods support % format args."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.info("User %s logged in from %s", "admin", "192.168.1.1")

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["message"] == "User admin logged in from 192.168.1.1"

    def test_log_methods_ignore_kwargs(self, logger: SessionLogger) -> None:
        """Log methods accept but ignore kwargs (for stdlib compatibility)."""
        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            # Python logging supports exc_info, stack_info, etc.
            # Our logger should accept but ignore them
            logger.error("Error occurred", exc_info=True, extra={"key": "value"})

            mock_add_log.assert_called_once()
            assert mock_add_log.call_args[1]["message"] == "Error occurred"


class TestLogMethodsFiltering:
    """Tests for log method filtering at each level."""

    def test_warn_filtered_when_threshold_error(self) -> None:
        """warn() is filtered when threshold is ERROR."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.ERROR)

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.warn("This should be filtered")

            mock_add_log.assert_not_called()

    def test_error_filtered_when_threshold_fatal(self) -> None:
        """error() is filtered when threshold is FATAL."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.FATAL)

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.error("This should be filtered")

            mock_add_log.assert_not_called()

    def test_fatal_always_logged_unless_none(self) -> None:
        """fatal() is only filtered when threshold is NONE."""
        logger = SessionLogger(session_id="sess-123", source="Test", threshold=LogLevel.NONE)

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger.fatal("This should be filtered")

            mock_add_log.assert_not_called()


class TestUnmaskThreading:
    """Per-node unmask option rides the logger into every sink."""

    def test_unmask_defaults_to_false(self) -> None:
        logger = SessionLogger(session_id="sess-123", source="Test")

        assert logger.unmask is False

    def test_accepts_unmask_flag(self) -> None:
        logger = SessionLogger(session_id="sess-123", source="Test", unmask=True)

        assert logger.unmask is True

    def test_unmask_flag_is_passed_to_add_log(self) -> None:
        logger = SessionLogger(session_id="sess-123", source="Log", unmask=True)

        with patch("wavecore.api.services.log_streaming_service.add_log") as mock_add_log:
            logger._log("INFO", "revealed value")

            assert mock_add_log.call_args[1]["unmask"] is True


class TestTerminalTwinScrubbing:
    """The backend terminal sink is scrubbed with the same registry."""

    @staticmethod
    def _register(session_id: str) -> None:
        from wavecore.api.services import log_streaming_service
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        log_streaming_service.register_secret_registry(session_id, registry)

    def test_terminal_message_is_scrubbed(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging

        session_id = str(uuid.uuid4())
        self._register(session_id)
        logger = SessionLogger(session_id=session_id, source="HTTP")

        with caplog.at_level(logging.INFO, logger="wavecore.execution"):
            logger._log("INFO", "Bearer s3cr3t-t0ken-99")

        assert "s3cr3t-t0ken-99" not in caplog.text
        assert "Bearer ********" in caplog.text

    def test_unmask_logger_keeps_terminal_raw(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging

        session_id = str(uuid.uuid4())
        self._register(session_id)
        logger = SessionLogger(session_id=session_id, source="HTTP", unmask=True)

        with caplog.at_level(logging.INFO, logger="wavecore.execution"):
            logger._log("INFO", "Bearer s3cr3t-t0ken-99")

        assert "Bearer s3cr3t-t0ken-99" in caplog.text
