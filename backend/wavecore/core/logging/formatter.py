"""
Unified Log Formatter - Backend Terminal and Test Console Formats.

Implements:
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
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

# Valid log levels
VALID_LEVELS = {"DEBUG", "INFO", "WARN", "ERROR", "FATAL"}

# Python's names for two of the levels.
_LEVEL_ALIASES = {"WARNING": "WARN", "CRITICAL": "FATAL"}

# Maximum length for parameter/return value display
MAX_VALUE_LENGTH = 100

# One hard bound on a finished log message, applied after the last masker.
MAX_MESSAGE_DISPLAY = 16384
_MESSAGE_MARKER_BUDGET = 64


def cap_message(text: str) -> str:
    """Bound a finished log message, stating how much was left out.

    Applied downstream of every masker so a cut can never strand a fragment a
    later scrub would have matched.
    """
    if len(text) <= MAX_MESSAGE_DISPLAY:
        return text
    body = text[: MAX_MESSAGE_DISPLAY - _MESSAGE_MARKER_BUDGET]
    return body + f"\n... and {len(text) - len(body)} more characters"


def format_timestamp(dt: datetime | None = None) -> str:
    """
    Format datetime as HH:MM:SS.mmm.

    Args:
        dt: Datetime to format. Uses current time if None.

    Returns:
        Formatted timestamp string.
    """
    if dt is None:
        dt = datetime.now(UTC)

    # Extract milliseconds from microseconds (truncate, not round)
    milliseconds = dt.microsecond // 1000

    return f"{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d}.{milliseconds:03d}"


def format_level(level: str) -> str:
    """
    Format log level with right-padding to 5 characters.

    Args:
        level: Log level string.

    Returns:
        Formatted level string, right-padded to 5 chars.

    Raises:
        ValueError: If level is not valid.
    """
    normalized = level.upper()

    if normalized not in VALID_LEVELS:
        raise ValueError(
            f"Invalid log level '{level}'. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL"
        )

    return normalized.ljust(5)


def format_backend_message(level: str, message: str, timestamp: datetime | None = None) -> str:
    """
    Format a message for backend terminal output.

    Args:
        level: Log level string.
        message: Log message.
        timestamp: Optional timestamp. Uses current time if None.

    Returns:
        Formatted log message: HH:MM:SS.mmm LEVEL message
    """
    ts = format_timestamp(timestamp)
    lvl = format_level(level)
    return f"{ts} {lvl} {message}"


def format_http_request(method: str, path: str, status: int, duration_ms: float) -> str:
    """
    Format an HTTP request log message.

    Args:
        method: HTTP method (GET, POST, etc.).
        path: Request path including query string.
        status: HTTP status code.
        duration_ms: Request duration in milliseconds.

    Returns:
        Formatted message: GET /path → 200 (1.23ms)
    """
    return f"{method} {path} → {status} ({duration_ms:.2f}ms)"


def short_execution_id(execution_id: str) -> str:
    """
    Extract first 5 characters of execution ID.

    Args:
        execution_id: Full execution ID.

    Returns:
        First 5 characters or entire string if shorter.
    """
    return execution_id[:5]


def format_execution_start(execution_id: str, test_name: str, block_count: int) -> str:
    """
    Format execution start message.

    Args:
        execution_id: Execution ID (only first 5 chars used).
        test_name: Name of the test.
        block_count: Number of blocks in the test.

    Returns:
        Formatted message: Execution[abc12] Test 'name' started (N blocks)
    """
    short_id = short_execution_id(execution_id)
    block_word = "block" if block_count == 1 else "blocks"
    return f"Execution[{short_id}] Test '{test_name}' started ({block_count} {block_word})"


def format_execution_complete(execution_id: str, status: str, duration_ms: float) -> str:
    """
    Format execution completion message.

    Args:
        execution_id: Execution ID (only first 5 chars used).
        status: Execution status (passed, failed, error, stopped).
        duration_ms: Execution duration in milliseconds.

    Returns:
        Formatted message: Execution[abc12] completed: status (Nms)
    """
    short_id = short_execution_id(execution_id)
    # Round duration to integer
    duration_int = round(duration_ms)
    return f"Execution[{short_id}] completed: {status} ({duration_int}ms)"


def format_source(source_type: str, element_name: str | None = None) -> str:
    """
    Format source for test console output.

    Args:
        source_type: Source type (SYSTEM, plugin type, etc.).
                     Can also be a combined "Type:Name" string.
        element_name: Optional element name.

    Returns:
        Formatted source: [SYSTEM], [Type : Name], or [Type]
    """
    # Handle combined "Type:Name" format (split and add proper spacing)
    if element_name is None and ":" in source_type:
        parts = source_type.split(":", 1)
        source_type = parts[0].strip()
        element_name = parts[1].strip() if len(parts) > 1 else None

    # Treat empty/whitespace element_name as None
    if element_name is not None and not element_name.strip():
        element_name = None

    if element_name is not None:
        return f"[{source_type} : {element_name}]"
    return f"[{source_type}]"


def format_console_message(
    level: str,
    message: str,
    source_type: str,
    element_name: str | None = None,
    timestamp: datetime | None = None,
) -> str:
    """
    Format a message for test console output with [SOURCE].

    Args:
        level: Log level string.
        message: Log message.
        source_type: Source type for [SOURCE] prefix.
        element_name: Optional element name.
        timestamp: Optional timestamp. Uses current time if None.

    Returns:
        Formatted message: HH:MM:SS.mmm LEVEL [SOURCE] message
    """
    ts = format_timestamp(timestamp)
    lvl = format_level(level)
    src = format_source(source_type, element_name)
    return f"{ts} {lvl} {src} {message}"


def format_block_start(execution_id: str, block_name: str | None) -> str:
    """
    Format block start message.

    Args:
        execution_id: Execution ID (only first 5 chars used).
        block_name: Block name or None for unnamed blocks.

    Returns:
        Formatted message: Execution[abc12] Block 'name' started
    """
    short_id = short_execution_id(execution_id)
    name = block_name if block_name else "(unnamed)"
    return f"Execution[{short_id}] Block '{name}' started"


def format_block_complete(execution_id: str, block_name: str, duration_ms: float) -> str:
    """
    Format block completion message.

    Args:
        execution_id: Execution ID (only first 5 chars used).
        block_name: Block name.
        duration_ms: Block duration in milliseconds.

    Returns:
        Formatted message: Execution[abc12] Block 'name' completed (Nms)
    """
    short_id = short_execution_id(execution_id)
    duration_int = round(duration_ms)
    return f"Execution[{short_id}] Block '{block_name}' completed ({duration_int}ms)"


def format_plugin_init(execution_id: str, plugin_type: str, element_name: str | None) -> str:
    """
    Format plugin initialization message.

    Args:
        execution_id: Execution ID (only first 5 chars used).
        plugin_type: Type of plugin.
        element_name: Optional element name.

    Returns:
        Formatted message indicating plugin initialization.
    """
    short_id = short_execution_id(execution_id)
    if element_name:
        return f"[{short_id}] {plugin_type} '{element_name}' initializing"
    return f"[{short_id}] {plugin_type} initializing"


def format_plugin_complete(
    execution_id: str,
    plugin_type: str,
    element_name: str | None,
    outcome: str,
    duration_ms: float,
) -> str:
    """
    Format plugin completion message.

    Args:
        execution_id: Execution ID (only first 5 chars used).
        plugin_type: Type of plugin.
        element_name: Optional element name.
        outcome: Plugin outcome (success, failed, etc.).
        duration_ms: Plugin duration in milliseconds.

    Returns:
        Formatted message indicating plugin completion.
    """
    short_id = short_execution_id(execution_id)
    duration_int = round(duration_ms)
    if element_name:
        return f"[{short_id}] {plugin_type} '{element_name}' {outcome} ({duration_int}ms)"
    return f"[{short_id}] {plugin_type} {outcome} ({duration_int}ms)"


def _truncate_value(value: str, max_length: int = MAX_VALUE_LENGTH) -> str:
    """
    Truncate a string value if it exceeds max length.

    Args:
        value: String value to truncate.
        max_length: Maximum length before truncation.

    Returns:
        Original or truncated string with ellipsis.
    """
    if len(value) > max_length:
        return value[:max_length] + "..."
    return value


def format_return_summary(return_value: Any) -> str:
    """
    Format return value summary for logging.

    Args:
        return_value: Return value to summarize.

    Returns:
        Formatted return value summary.
    """
    if isinstance(return_value, list):
        return f"[{len(return_value)} items]"
    if isinstance(return_value, dict):
        parts = []
        for key, value in return_value.items():
            str_value = str(value)
            truncated = _truncate_value(str_value)
            parts.append(f"{key}={truncated}")
        return "{" + ", ".join(parts) + "}"
    return _truncate_value(str(return_value))


def format_execution_error(
    execution_id: str,
    error_type: str,
    error_message: str,
    block_name: str | None = None,
    variables: dict[str, Any] | None = None,
) -> str:
    """
    Format execution error message with context.

    Args:
        execution_id: Execution ID (only first 5 chars used).
        error_type: Type of error (e.g., ConnectionError).
        error_message: Error message.
        block_name: Optional block name where error occurred.
        variables: Optional variable context.

    Returns:
        Formatted error message.
    """
    short_id = short_execution_id(execution_id)
    parts = [f"[{short_id}] {error_type}: {error_message}"]

    if block_name:
        parts.append(f"in block '{block_name}'")

    if variables:
        var_str = ", ".join(f"{k}={v}" for k, v in variables.items())
        parts.append(f"context: {{{var_str}}}")

    return " ".join(parts)


def log_level_from_python(level: int) -> str:
    """
    Map Python logging level to WAVE log level.

    Args:
        level: Python logging level integer.

    Returns:
        WAVE log level string.
    """
    if level == logging.DEBUG:
        return "DEBUG"
    if level == logging.INFO:
        return "INFO"
    if level == logging.WARNING:
        return "WARN"
    if level == logging.ERROR:
        return "ERROR"
    if level == logging.CRITICAL:
        return "FATAL"
    # Default to INFO for unknown levels
    return "INFO"


def get_http_log_level(status_code: int) -> str:
    """
    Determine log level based on HTTP status code.

    Args:
        status_code: HTTP status code.

    Returns:
        Appropriate log level string.
    """
    if 100 <= status_code < 200:
        return "DEBUG"
    if 200 <= status_code < 400:
        return "INFO"
    if 400 <= status_code < 500:
        return "WARN"
    # 5xx and other codes
    return "ERROR"


def get_execution_log_level(event: str, status: str | None = None) -> str:
    """
    Determine log level for execution events.

    Args:
        event: Event type (start, complete, block_start, block_complete).
        status: Optional execution status for complete events.

    Returns:
        Appropriate log level string.
    """
    if event == "start":
        return "INFO"
    if event == "complete":
        if status == "passed":
            return "INFO"
        if status == "failed":
            return "WARN"
        if status == "error":
            return "ERROR"
        return "INFO"
    if event in ("block_start", "block_complete"):
        return "DEBUG"
    return "INFO"


def get_default_excluded_paths() -> list[str]:
    """
    Get default paths excluded from HTTP logging.

    Returns:
        List of paths to exclude (health checks, etc.).
    """
    return ["/health", "/healthz", "/ready", "/readyz"]


class UvicornWebSocketFilter(logging.Filter):
    """Filter to reformat Uvicorn WebSocket messages to unified style at DEBUG level."""

    def filter(self, record: logging.LogRecord) -> bool:
        """
        Reformat WebSocket connection messages to unified style.

        Converts Uvicorn's verbose WebSocket messages to clean format
        and sets them to DEBUG level (hidden by default, visible when needed).

        Returns True (allow) for all messages after reformatting.
        """
        msg = record.getMessage()

        # Reformat WebSocket accepted messages
        # From: ('127.0.0.1', 46512) - "WebSocket /ws" [accepted]
        # To: WebSocket /ws connected (127.0.0.1:46512)
        if "WebSocket" in msg and "[accepted]" in msg:
            # Parse: ('127.0.0.1', 46512) - "WebSocket /ws" [accepted]
            try:
                addr_end = msg.index(")")
                addr_part = msg[: addr_end + 1]  # ('127.0.0.1', 46512)
                inner = addr_part.strip("()")  # '127.0.0.1', 46512
                host, port_str = inner.split(",", 1)
                host = host.strip().strip("'\"")
                port = port_str.strip()
                ws_start = msg.index('"WebSocket') + 1
                ws_end = msg.index('"', ws_start)
                path = msg[ws_start + len("WebSocket ") : ws_end]
                record.msg = f"WebSocket {path} connected ({host}:{port})"
                record.args = ()
            except (ValueError, IndexError):
                pass  # Keep original message if format doesn't match
            record.levelno = logging.DEBUG
            record.levelname = "DEBUG"
        elif msg == "connection open":
            # Reformat "connection open" messages
            record.msg = "WebSocket connection opened"
            record.levelno = logging.DEBUG
            record.levelname = "DEBUG"
        elif msg == "connection closed":
            # Reformat "connection closed" messages
            record.msg = "WebSocket connection closed"
            record.levelno = logging.DEBUG
            record.levelname = "DEBUG"

        return True


def suppress_uvicorn_access_logs() -> None:
    """
    Suppress Uvicorn's built-in HTTP access logging and reformat WebSocket logs.

    Our middleware handles HTTP logging with unified format, so we disable
    Uvicorn's access logger entirely. WebSocket connection messages are
    reformatted to unified style and set to DEBUG level.
    """
    # Disable access logs entirely (our middleware handles HTTP logging)
    uvicorn_access = logging.getLogger("uvicorn.access")
    uvicorn_access.disabled = True

    # Get root logger level for syncing
    root_level = logging.getLogger().level

    # Handle ALL uvicorn loggers - they all need unified format
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.asgi"]:
        uv_logger = logging.getLogger(logger_name)

        # Add filter to reformat WebSocket messages
        uv_logger.addFilter(UvicornWebSocketFilter())

        # Replace handlers with our own unified handler
        uv_logger.handlers.clear()
        handler = logging.StreamHandler()
        handler.setFormatter(UnifiedFormatter(stream_type="backend"))
        handler.setLevel(root_level)
        uv_logger.addHandler(handler)
        uv_logger.setLevel(root_level)
        uv_logger.propagate = False  # Don't double-log to root


def _level_str_to_python(level: str) -> int:
    """Convert WAVE level string to Python logging level."""
    level_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARN": logging.WARNING,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "FATAL": logging.CRITICAL,
        "CRITICAL": logging.CRITICAL,
    }
    return level_map.get(level.upper(), logging.INFO)


def configure_unified_logging(level: str | None = None) -> None:
    """
    Configure root logger with unified format.

    Priority for log level:
    1. Explicit `level` parameter (if provided)
    2. WAVE_LOG_LEVEL environment variable
    3. Default: INFO

    Args:
        level: Log level string (DEBUG, INFO, WARN, ERROR, FATAL).
               If None, reads from WAVE_LOG_LEVEL env var or defaults to INFO.
    """
    import os

    root_logger = logging.getLogger()

    # Determine log level: param > env var > default
    if level is None:
        level = os.environ.get("WAVE_LOG_LEVEL", "INFO")

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Create new handler with unified formatter
    handler = logging.StreamHandler()
    handler.setFormatter(UnifiedFormatter(stream_type="backend"))

    python_level = _level_str_to_python(level)

    handler.setLevel(python_level)
    root_logger.addHandler(handler)
    root_logger.setLevel(python_level)
    _sync_third_party_levels(python_level)


# Their INFO lines are transport detail: the SSH worker command, the SQL Server login reply.
_TRANSPORT_LOGGERS = ("asyncssh", "pytds")


def _sync_third_party_levels(python_level: int) -> None:
    """Keep the transport loggers one level stricter than WAVE, so they show only at DEBUG."""
    # They propagate to the root handler, so each logger's own level decides what is emitted.
    stricter = min(python_level + 10, logging.CRITICAL)
    for name in _TRANSPORT_LOGGERS:
        logging.getLogger(name).setLevel(stricter)


def canonical_level(level: str) -> str:
    """The WAVE name of a level given by its name or its Python name, in any case."""
    name = level.upper()
    name = _LEVEL_ALIASES.get(name, name)
    if name not in VALID_LEVELS:
        raise ValueError(
            f"Invalid log level: '{level}'. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL"
        )
    return name


def set_log_level(level: str) -> str:
    """
    Change the log level at runtime.

    Updates all handlers on the root logger to the new level.

    Args:
        level: Log level string (DEBUG, INFO, WARN, ERROR, FATAL).

    Returns:
        The canonical name of the level that was set.

    Raises:
        ValueError: If level is not a valid log level.
    """
    canonical = canonical_level(level)
    python_level = _level_str_to_python(canonical)
    root_logger = logging.getLogger()

    # Update root logger level
    root_logger.setLevel(python_level)

    # Update all handlers on root
    for handler in root_logger.handlers:
        handler.setLevel(python_level)

    # Also sync all uvicorn loggers (for WebSocket messages)
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.asgi"]:
        uv_logger = logging.getLogger(logger_name)
        uv_logger.setLevel(python_level)
        for handler in uv_logger.handlers:
            handler.setLevel(python_level)

    _sync_third_party_levels(python_level)

    return canonical


def get_log_level() -> str:
    """
    Get the current log level.

    Returns:
        Current log level as a string (DEBUG, INFO, WARN, ERROR, FATAL).
    """
    root_logger = logging.getLogger()
    python_level = root_logger.level

    level_map = {
        logging.DEBUG: "DEBUG",
        logging.INFO: "INFO",
        logging.WARNING: "WARN",
        logging.ERROR: "ERROR",
        logging.CRITICAL: "FATAL",
    }
    return level_map.get(python_level, "INFO")


class UnifiedFormatter(logging.Formatter):
    """
    Python logging formatter for unified log format.

    Produces clean logs without module paths, using HH:MM:SS.mmm timestamp format.
    """

    def __init__(self, stream_type: str = "backend") -> None:
        """
        Initialize UnifiedFormatter.

        Args:
            stream_type: Either 'backend' or 'console'.

        Raises:
            ValueError: If stream_type is not 'backend' or 'console'.
        """
        super().__init__()
        if stream_type not in ("backend", "console"):
            raise ValueError(f"Invalid stream type '{stream_type}'. Must be 'backend' or 'console'")
        self.stream_type = stream_type

    def format(self, record: logging.LogRecord) -> str:
        """
        Format a log record.

        Automatically prefixes with [short-correlation-id] when a request
        correlation ID is active (set by the logging middleware via contextvar).

        Args:
            record: Python logging LogRecord.

        Returns:
            Formatted log string.
        """
        # Get timestamp from record
        dt = datetime.fromtimestamp(record.created, tz=UTC)

        # Map Python level to WAVE level
        level = log_level_from_python(record.levelno)

        # Format message with args
        message = record.getMessage()

        # Inject correlation ID prefix if available and not already present
        if not message.startswith("["):
            try:
                from wavecore.api.middleware import (  # type: ignore[attr-defined]
                    request_correlation_id,
                )

                cid = request_correlation_id.get()
                if cid:
                    message = f"[{cid[:8]}] {message}"
            except (ImportError, LookupError):
                pass

        return format_backend_message(level, message, dt)


class UnifiedHttpLogger:
    """
    HTTP request logger using unified format.

    Provides clean HTTP request/response logging without verbose metadata.
    """

    def __init__(self) -> None:
        """Initialize UnifiedHttpLogger."""
        self._logger = logging.getLogger("wavecore.http")
        self._handler = logging.StreamHandler()
        self._handler.setFormatter(UnifiedFormatter(stream_type="backend"))

    def log_request(self, method: str, path: str, status: int, duration_ms: float) -> None:
        """
        Log an HTTP request.

        Args:
            method: HTTP method.
            path: Request path.
            status: Response status code.
            duration_ms: Request duration in milliseconds.
        """
        message = format_http_request(method, path, status, duration_ms)
        level = get_http_log_level(status)

        if level == "DEBUG":
            self._logger.debug(message)
        elif level == "INFO":
            self._logger.info(message)
        elif level == "WARN":
            self._logger.warning(message)
        else:
            self._logger.error(message)


class ExecutionLogger:
    """
    Context-aware logger for test execution events.

    Maintains execution context (ID) and provides formatted logging for
    execution lifecycle events.
    """

    def __init__(self, execution_id: str) -> None:
        """
        Initialize ExecutionLogger.

        Args:
            execution_id: Full execution ID.
        """
        self.execution_id = execution_id
        self.short_id = short_execution_id(execution_id)

    def log_start(self, test_name: str, block_count: int) -> None:
        """
        Log test execution start.

        Args:
            test_name: Name of the test.
            block_count: Number of blocks in the test.
        """
        message = format_execution_start(self.execution_id, test_name, block_count)
        logging.info(message)

    def log_complete(self, status: str, duration_ms: float) -> None:
        """
        Log test execution completion.

        Args:
            status: Execution status.
            duration_ms: Execution duration in milliseconds.
        """
        message = format_execution_complete(self.execution_id, status, duration_ms)
        level = get_execution_log_level("complete", status)

        if level == "INFO":
            logging.info(message)
        elif level == "WARN":
            logging.warning(message)
        else:
            logging.error(message)

    def log_block_start(self, block_name: str | None) -> None:
        """
        Log block execution start.

        Args:
            block_name: Block name or None for unnamed blocks.
        """
        message = format_block_start(self.execution_id, block_name)
        logging.info(message)

    def log_block_complete(self, block_name: str, duration_ms: float) -> None:
        """
        Log block execution completion.

        Args:
            block_name: Block name.
            duration_ms: Block duration in milliseconds.
        """
        message = format_block_complete(self.execution_id, block_name, duration_ms)
        logging.info(message)

    def log_error(
        self,
        error_type: str,
        error_message: str,
        block_name: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> None:
        """
        Log execution error.

        Args:
            error_type: Type of error.
            error_message: Error message.
            block_name: Optional block name where error occurred.
            variables: Optional variable context.
        """
        message = format_execution_error(
            self.execution_id, error_type, error_message, block_name, variables
        )
        logging.error(message)


def create_unified_logging_middleware(
    exclude_paths: list[str] | None = None,
) -> Callable[
    [Any, Callable[[Any], Awaitable[Any]]],
    Awaitable[Any],
]:
    """
    Create ASGI middleware for unified HTTP logging.

    Args:
        exclude_paths: Additional paths to exclude from logging.

    Returns:
        ASGI middleware function.
    """
    excluded = set(get_default_excluded_paths())
    if exclude_paths:
        excluded.update(exclude_paths)

    async def middleware(
        request: Any,
        call_next: Callable[[Any], Awaitable[Any]],
    ) -> Any:
        """
        Log HTTP requests in unified format.

        Args:
            request: FastAPI Request object.
            call_next: Next middleware/handler.

        Returns:
            Response from next handler.
        """
        import time

        # Skip excluded paths
        path = request.url.path
        if path in excluded:
            return await call_next(request)

        # Time the request
        start_time = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start_time) * 1000

        # Log in unified format
        method = request.method
        status = response.status_code
        message = format_http_request(method, path, status, duration_ms)
        level = get_http_log_level(status)

        if level == "DEBUG":
            logging.debug(message)
        elif level == "INFO":
            logging.info(message)
        elif level == "WARN":
            logging.warning(message)
        else:
            logging.error(message)

        return response

    return middleware
