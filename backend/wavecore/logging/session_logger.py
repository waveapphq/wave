"""
SessionLogger - Session-aware Logger for WebSocket Streaming

Implements REQ-3.7.2.5: Custom logging from tests/blocks
Provides a logger that sends logs to the log streaming service for real-time
WebSocket broadcasting during workbench execution.
"""

from typing import Any

from wavecore.models.enums import LogLevel


class SessionLogger:
    """
    Logger that sends logs to the log streaming service for WebSocket broadcasting.

    Used by plugins during workbench execution to emit logs that appear in the
    console panel in real-time.
    """

    def __init__(
        self,
        session_id: str,
        source: str,
        threshold: LogLevel = LogLevel.DEBUG,
        block_id: str | None = None,
        unmask: bool = False,
    ) -> None:
        """
        Initialize SessionLogger.

        Args:
            session_id: Session identifier for log routing.
            source: Source name for log entries (e.g., plugin name).
            threshold: Log level threshold (default: DEBUG).
            block_id: Optional block ID for log entries.
            unmask: Per-node exemption from secret value-scrubbing.
        """
        self.session_id = session_id
        self.source = source
        self.threshold = threshold
        self.block_id = block_id
        self.unmask = unmask

    def _should_log(self, level: LogLevel) -> bool:
        """
        Determine if a log message at the given level should be emitted.

        Args:
            level: Log level of the message.

        Returns:
            True if message should be logged, False if filtered.
        """
        if self.threshold == LogLevel.NONE:
            return False
        return level >= self.threshold

    def _log(self, level: str, msg: str, *args: Any) -> None:
        """
        Send a log message to BOTH WebSocket stream and backend terminal.

        Args:
            level: Log level string (DEBUG, INFO, WARN, ERROR, FATAL).
            msg: Log message (may contain % formatting).
            *args: Format arguments for the message.
        """
        import logging

        from wavecore.api.services import log_streaming_service
        from wavecore.core.logging.formatter import format_source

        # Format message with args if provided
        if args:
            try:
                formatted_msg = msg % args
            except (TypeError, ValueError):
                formatted_msg = msg
        else:
            formatted_msg = msg

        # 1. Stream to WebSocket (console panel)
        log_streaming_service.add_log(
            session_id=self.session_id,
            level=level,
            message=formatted_msg,
            source=self.source,
            block_id=self.block_id,
            unmask=self.unmask,
        )

        # 2. Log to backend terminal with unified format (same scrub + exemption)
        terminal_msg = log_streaming_service.scrub_message(
            self.session_id, formatted_msg, self.source, unmask=self.unmask, block_id=self.block_id
        )
        terminal_logger = logging.getLogger("wavecore.execution")
        formatted_source = format_source(self.source)
        terminal_message = f"{formatted_source} {terminal_msg}"

        # Map level string to logging level
        level_map = {
            "DEBUG": logging.DEBUG,
            "INFO": logging.INFO,
            "WARN": logging.WARNING,
            "WARNING": logging.WARNING,
            "ERROR": logging.ERROR,
            "FATAL": logging.CRITICAL,
            "CRITICAL": logging.CRITICAL,
        }
        log_level = level_map.get(level.upper(), logging.INFO)
        terminal_logger.log(log_level, terminal_message)

    def debug(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log a DEBUG level message if threshold permits."""
        if self._should_log(LogLevel.DEBUG):
            self._log("DEBUG", msg, *args)

    def info(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log an INFO level message if threshold permits."""
        if self._should_log(LogLevel.INFO):
            self._log("INFO", msg, *args)

    def warn(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log a WARN level message if threshold permits."""
        if self._should_log(LogLevel.WARN):
            self._log("WARN", msg, *args)

    def warning(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Alias for warn() for Python logging compatibility."""
        self.warn(msg, *args, **kwargs)

    def error(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log an ERROR level message if threshold permits."""
        if self._should_log(LogLevel.ERROR):
            self._log("ERROR", msg, *args)

    def fatal(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log a FATAL level message if threshold permits."""
        if self._should_log(LogLevel.FATAL):
            self._log("FATAL", msg, *args)

    def critical(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Alias for fatal() for Python logging compatibility."""
        self.fatal(msg, *args, **kwargs)
