"""
Unit tests for FilteringLogger.

Tests requirements:
- REQ-3.4.2.6: Plugin log level filtering
- REQ-3.4.2.9: Optional log level override per plugin instance
"""

import logging
from io import StringIO


class TestLogLevelEnum:
    """Test suite for LogLevel enum."""

    def test_log_level_enum_exists(self):
        """Test that LogLevel enum is defined with all required values."""
        from wavecore.models.enums import LogLevel

        # Verify all required levels exist
        assert hasattr(LogLevel, "NONE")
        assert hasattr(LogLevel, "FATAL")
        assert hasattr(LogLevel, "ERROR")
        assert hasattr(LogLevel, "WARN")
        assert hasattr(LogLevel, "INFO")
        assert hasattr(LogLevel, "DEBUG")

    def test_log_level_ordering(self):
        """Test that log levels have proper ordering for threshold comparison."""
        from wavecore.models.enums import LogLevel

        # NONE should be highest (most restrictive)
        # DEBUG should be lowest (most permissive)
        # Order: NONE > FATAL > ERROR > WARN > INFO > DEBUG
        levels = [
            LogLevel.DEBUG,
            LogLevel.INFO,
            LogLevel.WARN,
            LogLevel.ERROR,
            LogLevel.FATAL,
            LogLevel.NONE,
        ]

        # Each level should be "greater than" (more restrictive) than previous
        for i in range(len(levels) - 1):
            assert levels[i].value < levels[i + 1].value


class TestFilteringLogger:
    """Test suite for FilteringLogger class (REQ-3.4.2.6)."""

    def test_filtering_logger_creation(self):
        """Test creating a FilteringLogger with a threshold."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test")
        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        assert filtered.threshold == LogLevel.WARN
        assert filtered.logger == base_logger

    def test_default_threshold_is_warn(self):
        """Test that default threshold is WARN if not specified."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test")
        filtered = FilteringLogger(base_logger)

        assert filtered.threshold == LogLevel.WARN

    def test_filter_debug_at_warn_threshold(self):
        """Test that DEBUG logs are filtered when threshold is WARN."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        # Create logger with string handler to capture output
        base_logger = logging.getLogger("test_debug_warn")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        # DEBUG should be filtered
        filtered.debug("This should not appear")
        assert "This should not appear" not in stream.getvalue()

        # WARN should appear
        filtered.warn("This should appear")
        assert "This should appear" in stream.getvalue()

    def test_filter_info_at_warn_threshold(self):
        """Test that INFO logs are filtered when threshold is WARN."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_info_warn")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        # INFO should be filtered
        filtered.info("This should not appear")
        assert "This should not appear" not in stream.getvalue()

    def test_allow_warn_at_warn_threshold(self):
        """Test that WARN logs pass through when threshold is WARN."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_warn_warn")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        filtered.warn("Warning message")
        assert "Warning message" in stream.getvalue()

    def test_allow_error_at_warn_threshold(self):
        """Test that ERROR logs pass through when threshold is WARN."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_error_warn")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        filtered.error("Error message")
        assert "Error message" in stream.getvalue()

    def test_allow_fatal_at_warn_threshold(self):
        """Test that FATAL logs pass through when threshold is WARN."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_fatal_warn")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        filtered.fatal("Fatal message")
        assert "Fatal message" in stream.getvalue()

    def test_debug_threshold_allows_all_logs(self):
        """Test that DEBUG threshold allows all log levels through."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_debug_threshold")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.DEBUG)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")
        filtered.error("Error message")
        filtered.fatal("Fatal message")

        output = stream.getvalue()
        assert "Debug message" in output
        assert "Info message" in output
        assert "Warn message" in output
        assert "Error message" in output
        assert "Fatal message" in output

    def test_none_threshold_suppresses_all_logs(self):
        """Test that NONE threshold suppresses all logs."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_none_threshold")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.NONE)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")
        filtered.error("Error message")
        filtered.fatal("Fatal message")

        output = stream.getvalue()
        assert "Debug message" not in output
        assert "Info message" not in output
        assert "Warn message" not in output
        assert "Error message" not in output
        assert "Fatal message" not in output

    def test_error_threshold_filters_warn_info_debug(self):
        """Test that ERROR threshold filters WARN, INFO, DEBUG but allows ERROR and FATAL."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_error_threshold")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.ERROR)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")
        filtered.error("Error message")
        filtered.fatal("Fatal message")

        output = stream.getvalue()
        assert "Debug message" not in output
        assert "Info message" not in output
        assert "Warn message" not in output
        assert "Error message" in output
        assert "Fatal message" in output

    def test_info_threshold_filters_debug_only(self):
        """Test that INFO threshold filters DEBUG but allows INFO and above."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_info_threshold")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.INFO)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")
        filtered.error("Error message")
        filtered.fatal("Fatal message")

        output = stream.getvalue()
        assert "Debug message" not in output
        assert "Info message" in output
        assert "Warn message" in output
        assert "Error message" in output
        assert "Fatal message" in output

    def test_fatal_threshold_allows_only_fatal(self):
        """Test that FATAL threshold allows only FATAL logs."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_fatal_threshold")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.FATAL)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")
        filtered.error("Error message")
        filtered.fatal("Fatal message")

        output = stream.getvalue()
        assert "Debug message" not in output
        assert "Info message" not in output
        assert "Warn message" not in output
        assert "Error message" not in output
        assert "Fatal message" in output


class TestTwoLayerFiltering:
    """Test suite for two-layer filtering (plugin threshold + execution level)."""

    def test_execution_level_restricts_plugin_debug(self):
        """Test execution at INFO restricts plugin at DEBUG to INFO+."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        # Simulate execution level: INFO (base logger set to INFO)
        base_logger = logging.getLogger("test_two_layer_1")
        base_logger.setLevel(logging.INFO)  # Execution level
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        # Plugin threshold: DEBUG (allows all)
        filtered = FilteringLogger(base_logger, LogLevel.DEBUG)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")

        output = stream.getvalue()
        # Plugin allows DEBUG, but execution level INFO restricts it
        assert "Debug message" not in output
        assert "Info message" in output
        assert "Warn message" in output

    def test_plugin_threshold_restricts_despite_execution_debug(self):
        """Test plugin at WARN restricts to WARN+ even when execution is DEBUG."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        # Simulation execution level: DEBUG (base logger set to DEBUG)
        base_logger = logging.getLogger("test_two_layer_2")
        base_logger.setLevel(logging.DEBUG)  # Execution level
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        # Plugin threshold: WARN (restricts to WARN+)
        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")

        output = stream.getvalue()
        # Plugin threshold WARN restricts despite execution DEBUG
        assert "Debug message" not in output
        assert "Info message" not in output
        assert "Warn message" in output

    def test_both_thresholds_at_info(self):
        """Test when both plugin and execution thresholds are INFO."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_two_layer_3")
        base_logger.setLevel(logging.INFO)  # Execution level
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        # Plugin threshold: INFO
        filtered = FilteringLogger(base_logger, LogLevel.INFO)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")

        output = stream.getvalue()
        assert "Debug message" not in output
        assert "Info message" in output
        assert "Warn message" in output

    def test_plugin_none_overrides_execution_debug(self):
        """Test plugin NONE suppresses all logs even when execution is DEBUG."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_two_layer_4")
        base_logger.setLevel(logging.DEBUG)  # Execution level
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        # Plugin threshold: NONE
        filtered = FilteringLogger(base_logger, LogLevel.NONE)

        filtered.debug("Debug message")
        filtered.info("Info message")
        filtered.warn("Warn message")
        filtered.error("Error message")
        filtered.fatal("Fatal message")

        output = stream.getvalue()
        # NONE suppresses all
        assert len(output.strip()) == 0


class TestFilteringLoggerInterface:
    """Test suite for FilteringLogger interface completeness."""

    def test_has_all_log_level_methods(self):
        """Test that FilteringLogger provides all standard log level methods."""
        from wavecore.logging.filtering_logger import FilteringLogger

        base_logger = logging.getLogger("test_interface")
        filtered = FilteringLogger(base_logger)

        # Verify all methods exist
        assert hasattr(filtered, "debug")
        assert hasattr(filtered, "info")
        assert hasattr(filtered, "warn")
        assert hasattr(filtered, "error")
        assert hasattr(filtered, "fatal")

        # Verify they're callable
        assert callable(filtered.debug)
        assert callable(filtered.info)
        assert callable(filtered.warn)
        assert callable(filtered.error)
        assert callable(filtered.fatal)

    def test_supports_formatted_messages(self):
        """Test that FilteringLogger supports format string logging."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_format")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.INFO)

        # Format string with arguments
        filtered.info("User %s logged in from %s", "alice", "192.168.1.1")

        output = stream.getvalue()
        assert "alice" in output
        assert "192.168.1.1" in output

    def test_threshold_is_mutable(self):
        """Test that threshold can be changed after creation (for runtime configuration)."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_mutable")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        # Initially at WARN - INFO filtered
        filtered.info("Message 1")
        assert "Message 1" not in stream.getvalue()

        # Change threshold to INFO
        filtered.threshold = LogLevel.INFO

        # Now INFO should appear
        filtered.info("Message 2")
        assert "Message 2" in stream.getvalue()

    def test_warning_alias(self):
        """Test that warning() is an alias for warn()."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_warning_alias")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        filtered.warning("Warning via alias")
        assert "Warning via alias" in stream.getvalue()

    def test_critical_alias(self):
        """Test that critical() is an alias for fatal()."""
        from wavecore.logging.filtering_logger import FilteringLogger
        from wavecore.models.enums import LogLevel

        base_logger = logging.getLogger("test_critical_alias")
        base_logger.setLevel(logging.DEBUG)
        base_logger.handlers.clear()

        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        base_logger.addHandler(handler)

        filtered = FilteringLogger(base_logger, LogLevel.WARN)

        filtered.critical("Critical via alias")
        assert "Critical via alias" in stream.getvalue()
