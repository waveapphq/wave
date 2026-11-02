"""
FilteringLogger - Log Level Filtering for Plugins

Implements REQ-3.4.2.6: Plugin log level filtering
Provides per-plugin-instance log level thresholds to control log verbosity.
"""

import logging
from typing import Any

from wavecore.models.enums import LogLevel


class FilteringLogger:
    """
    Logger wrapper that filters log messages based on a configured threshold.

    Implements two-layer filtering architecture where:
    1. Plugin instance threshold filters at plugin logger level
    2. Execution-level threshold filters at the base logger level

    The more restrictive threshold wins.
    """

    def __init__(self, logger: logging.Logger, threshold: LogLevel = LogLevel.WARN) -> None:
        """
        Initialize FilteringLogger with base logger and threshold.

        Args:
            logger: Base Python logger to wrap
            threshold: Log level threshold (default: WARN)
        """
        self.logger = logger
        self.threshold = threshold

    def _should_log(self, level: LogLevel) -> bool:
        """
        Determine if a log message at the given level should be emitted.

        Args:
            level: Log level of the message

        Returns:
            True if message should be logged, False if filtered
        """
        if self.threshold == LogLevel.NONE:
            return False
        return level >= self.threshold

    def debug(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log a DEBUG level message if threshold permits."""
        if self._should_log(LogLevel.DEBUG):
            self.logger.debug(msg, *args, **kwargs)

    def info(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log an INFO level message if threshold permits."""
        if self._should_log(LogLevel.INFO):
            self.logger.info(msg, *args, **kwargs)

    def warn(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log a WARN level message if threshold permits."""
        if self._should_log(LogLevel.WARN):
            self.logger.warning(msg, *args, **kwargs)

    def warning(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Alias for warn() for Python logging compatibility."""
        self.warn(msg, *args, **kwargs)

    def error(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log an ERROR level message if threshold permits."""
        if self._should_log(LogLevel.ERROR):
            self.logger.error(msg, *args, **kwargs)

    def fatal(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log a FATAL level message if threshold permits."""
        if self._should_log(LogLevel.FATAL):
            self.logger.critical(msg, *args, **kwargs)

    def critical(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Alias for fatal() for Python logging compatibility."""
        self.fatal(msg, *args, **kwargs)
