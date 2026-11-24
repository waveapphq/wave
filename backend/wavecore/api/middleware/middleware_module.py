"""Error handling (REQ-5.2.3.4) and request and response logging (REQ-5.2.3.5) middleware."""

import contextvars
import json
import logging
import time
import traceback
import uuid
from collections.abc import AsyncIterable, Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from wavecore import __version__
from wavecore.api.config import get_config
from wavecore.api.exceptions import (
    WaveException,
)
from wavecore.core.logging.log_safe import log_safe

# Constant for the generic internal error message (used in multiple places)
_ERR_INTERNAL = "An internal server error occurred"


@runtime_checkable
class _StreamedResponse(Protocol):
    """A response whose body arrives as a stream, as call_next returns it."""

    body_iterator: AsyncIterable[bytes | str]


# The canonical module path keeps log records named "wavecore.api.middleware".
logger = logging.getLogger("wavecore.api.middleware")

# Context variable for correlation ID - accessible from any code running in the request
request_correlation_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_correlation_id", default=None
)


class ErrorDetail(BaseModel):
    """Error detail model for standardized error responses."""

    code: str
    message: str
    details: dict[str, Any] | None = None


class ResponseMeta(BaseModel):
    """Response metadata model for all API responses."""

    timestamp: str
    version: str
    request_id: str


class ErrorResponse(BaseModel):
    """Standardized error response envelope."""

    success: bool = False
    error: ErrorDetail
    meta: ResponseMeta


def _generate_request_id() -> str:
    """Generate unique request ID for correlation."""
    return str(uuid.uuid4())


def _get_timestamp() -> str:
    """Get current timestamp in ISO 8601 format with UTC timezone."""
    return datetime.now(UTC).isoformat()


def _is_production_mode() -> bool:
    """Check if running in production mode."""
    config = get_config()
    return not config.server.debug


def _sanitize_error_message(message: str, production: bool) -> str:
    """Sanitize error message for production safety."""
    if not production:
        return message

    # In production, use generic messages for internal errors
    if "internal" in message.lower() or "server" in message.lower():
        return _ERR_INTERNAL

    return message


def _format_validation_errors(exc: RequestValidationError) -> dict[str, Any]:
    """Format validation errors from FastAPI/Pydantic."""
    errors = []
    for error in exc.errors():
        field_path = " -> ".join(str(loc) for loc in error["loc"])
        errors.append(
            {
                "field": field_path,
                "reason": error["msg"],
                "type": error["type"],
            }
        )
    return {"validation_errors": errors}


def _get_stack_trace(exc: Exception, production: bool) -> list[str] | None:
    """Get stack trace for exception."""
    if production:
        return None

    # In development, include full stack trace
    tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
    return tb_lines


def _create_error_response(
    _status_code: int,
    error_code: str,
    message: str,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> ErrorResponse:
    """Create standardized error response."""
    return ErrorResponse(
        success=False,
        error=ErrorDetail(
            code=error_code,
            message=message,
            details=details,
        ),
        meta=ResponseMeta(
            timestamp=_get_timestamp(),
            version=__version__,
            request_id=request_id or _generate_request_id(),
        ),
    )


# Map HTTP status codes to WAVE error codes (shared across handlers)
_HTTP_ERROR_CODE_MAP: dict[int, str] = {
    400: "BAD_REQUEST",
    401: "AUTHENTICATION_ERROR",
    403: "AUTHORIZATION_ERROR",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    500: "INTERNAL_ERROR",
    507: "INSUFFICIENT_STORAGE",
}


def _build_dev_details(
    exc: Exception,
    production: bool,
    base_details: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Build error details dict, preserving business details in all modes."""
    details = dict(base_details) if base_details else {}
    if not production:
        stack_trace = _get_stack_trace(exc, production)
        if stack_trace:
            details["stack_trace"] = stack_trace
    return details if details else None


def _error_json_response(
    status_code: int,
    error_code: str,
    message: str,
    request_id: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    """Create a JSONResponse wrapping a standardized ErrorResponse."""
    error_response = _create_error_response(
        _status_code=status_code,
        error_code=error_code,
        message=message,
        details=details,
        request_id=request_id,
    )
    return JSONResponse(status_code=status_code, content=error_response.model_dump())


def _handle_validation_error(
    exc: RequestValidationError, request_id: str, path: str
) -> JSONResponse:
    """Handle FastAPI request validation errors."""
    logger.warning(
        f"Validation error for request {request_id}: {exc}",
        extra={"request_id": request_id, "endpoint": path},
    )
    return _error_json_response(
        status_code=status.HTTP_400_BAD_REQUEST,
        error_code="VALIDATION_ERROR",
        message="Request validation failed",
        request_id=request_id,
        details=_format_validation_errors(exc),
    )


def _handle_wave_exception(
    exc: WaveException, request_id: str, path: str, production: bool
) -> JSONResponse:
    """Handle custom WAVE exceptions."""
    logger.error(
        f"WAVE exception for request {request_id}: {log_safe(exc)}",
        extra={"request_id": request_id, "endpoint": path, "error_code": exc.error_code},
        exc_info=True,
    )
    details = _build_dev_details(exc, production, exc.details)
    return _error_json_response(
        status_code=exc.status_code,
        error_code=exc.error_code,
        message=exc.message,
        request_id=request_id,
        details=details,
    )


def _handle_http_exception(
    exc: HTTPException | StarletteHTTPException,
    request_id: str,
    path: str,
    production: bool,
    label: str,
) -> JSONResponse:
    """Handle FastAPI or Starlette HTTP exceptions."""
    logger.warning(
        f"{label} for request {request_id}: {log_safe(exc.detail)}",
        extra={"request_id": request_id, "endpoint": path, "status_code": exc.status_code},
    )
    error_code = _HTTP_ERROR_CODE_MAP.get(exc.status_code, "HTTP_ERROR")
    details = _build_dev_details(exc, production)
    return _error_json_response(
        status_code=exc.status_code,
        error_code=error_code,
        message=str(exc.detail),
        request_id=request_id,
        details=details,
    )


def _handle_unhandled_exception(
    exc: Exception, request_id: str, path: str, production: bool
) -> JSONResponse:
    """Handle unexpected / unhandled exceptions."""
    logger.error(
        f"Unhandled exception for request {request_id}: {log_safe(exc)}",
        extra={"request_id": request_id, "endpoint": path},
        exc_info=True,
    )

    message = _ERR_INTERNAL if production else _sanitize_error_message(str(exc), production)

    base_details: dict[str, Any] | None = None
    if not production:
        base_details = {
            "exception_type": type(exc).__name__,
            "exception_message": str(exc),
        }

    details = _build_dev_details(exc, production, base_details)
    return _error_json_response(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code="INTERNAL_ERROR",
        message=message,
        request_id=request_id,
        details=details,
    )


async def error_handler_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Global error handling middleware."""
    # One id per request: the logging middleware's when it ran first.
    request_id: str = getattr(request.state, "correlation_id", None) or _generate_request_id()
    request.state.request_id = request_id
    production = _is_production_mode()
    path = request.url.path

    error_response: Response
    try:
        return await call_next(request)
    except RequestValidationError as exc:
        error_response = _handle_validation_error(exc, request_id, path)
    except WaveException as exc:
        error_response = _handle_wave_exception(exc, request_id, path, production)
    except HTTPException as exc:
        error_response = _handle_http_exception(exc, request_id, path, production, "HTTP exception")
    except StarletteHTTPException as exc:
        error_response = _handle_http_exception(
            exc, request_id, path, production, "Starlette HTTP exception"
        )
    except Exception as exc:
        error_response = _handle_unhandled_exception(exc, request_id, path, production)

    # Stamped here too: the logging middleware may have skipped this request.
    error_response.headers["X-Request-ID"] = request_id
    error_response.headers["X-Correlation-ID"] = request_id
    return error_response


def add_error_handling_middleware(app: FastAPI) -> None:
    """Add global error handling middleware to FastAPI application."""
    app.middleware("http")(error_handler_middleware)


# REQ-5.2.3.5: Request/Response Logging Middleware

# Only a JSON body is ever rendered into the log, so only that one is read into memory.
_LOGGED_MEDIA_TYPE = "application/json"
_UNNAMED_MEDIA_TYPE = "unknown"

# Global configuration for logging middleware
_logging_config: dict[str, Any] = {
    "log_request_body": True,
    "log_response_body": True,
    "log_request_headers": True,
    "log_response_headers": True,
    "max_body_size": 10000,  # 10KB default
    "exclude_paths": [],
    "sensitive_field_patterns": [
        "password",
        "token",
        "secret",
        "key",
        "authorization",
        "cookie",
        "credential",
        "ssn",
    ],
}


def _generate_correlation_id() -> str:
    """Generate unique correlation ID for request tracing."""
    return str(uuid.uuid4())


def _filter_sensitive_headers(headers: dict[str, str]) -> dict[str, str]:
    """Filter sensitive data from headers."""
    filtered = {}
    sensitive_keys = ["authorization", "cookie", "set-cookie", "x-api-key"]

    for key, value in headers.items():
        if key.lower() in sensitive_keys:
            filtered[key] = "***REDACTED***"
        else:
            filtered[key] = value

    return filtered


def _filter_sensitive_body(body: Any) -> Any:
    """Filter sensitive data from request/response body."""
    if isinstance(body, list):
        return [_filter_sensitive_body(item) for item in body]
    if not isinstance(body, dict):
        return body

    sensitive_patterns: list[str] = _logging_config["sensitive_field_patterns"]
    filtered: dict[Any, Any] = {}
    for key, value in body.items():
        if isinstance(key, str) and any(pattern in key.lower() for pattern in sensitive_patterns):
            filtered[key] = "***REDACTED***"
        else:
            filtered[key] = _filter_sensitive_body(value)

    return filtered


def _truncate_body(body: Any, max_size: int) -> Any:
    """Truncate body to enforce size limits."""
    body_str = json.dumps(body) if isinstance(body, dict | list) else str(body)

    if len(body_str) <= max_size:
        return body

    # Truncate and add marker
    truncated_str = body_str[:max_size] + "...[TRUNCATED]"
    return {"_truncated": True, "data": truncated_str}


def _request_media_type(request: Request) -> str:
    """The request's media type without its parameters, lowercased."""
    return request.headers.get("content-type", "").split(";")[0].strip().lower()


def _request_body_is_logged(request: Request) -> bool:
    """True only for a body the log can render; anything else is never read into memory."""
    if not _logging_config.get("log_request_body", True):
        return False
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return False
    return _request_media_type(request) == _LOGGED_MEDIA_TYPE


def _should_log_endpoint(path: str) -> bool:
    """Determine if endpoint should be logged based on configuration."""
    exclude_paths: list[str] = _logging_config.get("exclude_paths", [])
    return path not in exclude_paths


_LOG_LEVEL_DISPATCH: dict[str, Callable[..., None]] = {
    "DEBUG": logger.debug,
    "INFO": logger.info,
    "WARN": logger.warning,
}


def _log_at_level(level: str, message: str) -> None:
    """Emit a log message at the given named level."""
    _LOG_LEVEL_DISPATCH.get(level, logger.error)(message)


def _log_body_bytes(
    rid: str,
    label: str,
    body: bytes | None,
    config_key: str,
) -> None:
    """Log a JSON body (request or response) at DEBUG level."""
    if not body or not _logging_config.get(config_key, True):
        return

    try:
        body_json = json.loads(body)
        filtered = _filter_sensitive_body(body_json)
        max_size: int = _logging_config.get("max_body_size", 10000)
        truncated = _truncate_body(filtered, max_size)
        logger.debug(f"[{rid}]   {label} body: {json.dumps(truncated)}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.debug(f"[{rid}]   {label} body: <binary {len(body)} bytes>")


class RequestResponseLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for comprehensive request/response logging."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """Process request and log details."""
        # Check if endpoint should be excluded
        if not _should_log_endpoint(request.url.path):
            return await call_next(request)

        # One id per request (the error handler's when it ran first), also set for service logs.
        correlation_id: str = (
            getattr(request.state, "request_id", None) or _generate_correlation_id()
        )
        request.state.correlation_id = correlation_id
        request_correlation_id.set(correlation_id)

        # Capture request start time
        start_time = time.time()

        # Log request details
        try:
            await self._log_request(request, correlation_id)
        except Exception:
            # Logging failures should not crash requests - silently continue
            pass

        # Process request
        response = await call_next(request)

        # Calculate duration
        duration_ms = (time.time() - start_time) * 1000

        # Capture response body for logging (requires consuming the stream)
        response_body: bytes | None = None
        if _logging_config.get("log_response_body", True):
            try:
                if isinstance(response, _StreamedResponse):
                    body_chunks = []
                    async for chunk in response.body_iterator:
                        body_chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
                    response_body = b"".join(body_chunks)
                    # Rebuild the response with the captured body
                    response = Response(
                        content=response_body,
                        status_code=response.status_code,
                        headers=dict(response.headers),
                        media_type=response.media_type,
                    )
            except Exception:
                # Body capture failure should not crash requests
                pass

        # Log response details
        try:
            self._log_response(request, response, correlation_id, duration_ms, response_body)
        except Exception:
            # Logging failures should not crash requests - silently continue
            pass

        # Add correlation ID to response headers
        response.headers["X-Request-ID"] = correlation_id
        response.headers["X-Correlation-ID"] = correlation_id

        return response

    async def _log_request(self, request: Request, _correlation_id: str) -> None:
        """Capture request body for later logging (body must be read before handler)."""
        request.state.request_body = None
        if not _request_body_is_logged(request):
            return
        try:
            # Read before the handler; the middleware replays it downstream.
            request.state.request_body = await request.body()
        except Exception:
            request.state.request_body = None

    def _log_response(
        self,
        request: Request,
        response: Response,
        correlation_id: str,
        duration_ms: float,
        response_body: bytes | None = None,
    ) -> None:
        """Log complete request/response cycle in unified format."""
        from wavecore.core.logging.formatter import format_http_request, get_http_log_level

        rid = correlation_id[:8]

        # The path as routed: the parsed URL would drop a tab, CR or LF from it.
        path = str(request.scope["path"])
        if request.url.query:
            path = f"{path}?{request.url.query}"

        summary = format_http_request(
            method=request.method,
            path=log_safe(path),
            status=response.status_code,
            duration_ms=duration_ms,
        )
        summary = f"[{rid}] {summary}"

        level = get_http_log_level(response.status_code)
        _log_at_level(level, summary)

        self._log_headers(rid, request, response)
        self._log_request_body(rid, request)
        _log_body_bytes(rid, "res", response_body, "log_response_body")

    @staticmethod
    def _log_headers(rid: str, request: Request, response: Response) -> None:
        """Log filtered request and response headers at DEBUG level."""
        if _logging_config.get("log_request_headers", True):
            filtered = _filter_sensitive_headers(dict(request.headers))
            logger.debug(f"[{rid}]   req headers: {json.dumps(filtered)}")

        if _logging_config.get("log_response_headers", True):
            filtered = _filter_sensitive_headers(dict(response.headers))
            logger.debug(f"[{rid}]   res headers: {json.dumps(filtered)}")

    @staticmethod
    def _log_request_body(rid: str, request: Request) -> None:
        """Log the captured request body at DEBUG level."""
        if not _logging_config.get("log_request_body", True):
            return
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return
        if not _request_body_is_logged(request):
            media_type = _request_media_type(request) or _UNNAMED_MEDIA_TYPE
            logger.debug(f"[{rid}]   req body: <{media_type} not read>")
            return

        req_body = getattr(request.state, "request_body", None)
        if not req_body:
            logger.debug(f"[{rid}]   req body: <empty>")
            return

        try:
            body_json = json.loads(req_body)
            filtered_body = _filter_sensitive_body(body_json)
            max_size: int = _logging_config.get("max_body_size", 10000)
            truncated = _truncate_body(filtered_body, max_size)
            logger.debug(f"[{rid}]   req body: {json.dumps(truncated)}")
        except json.JSONDecodeError:
            logger.debug(f"[{rid}]   req body: <non-JSON {len(req_body)} bytes>")


def add_request_response_logging_middleware(
    app: FastAPI,
    log_request_body: bool = True,
    log_response_body: bool = True,
    log_request_headers: bool = True,
    log_response_headers: bool = True,
    max_body_size: int = 10000,
    exclude_paths: list[str] | None = None,
    sensitive_field_patterns: list[str] | None = None,
) -> None:
    """Add request/response logging middleware to FastAPI application."""
    # Update global configuration
    _logging_config.update(
        {
            "log_request_body": log_request_body,
            "log_response_body": log_response_body,
            "log_request_headers": log_request_headers,
            "log_response_headers": log_response_headers,
            "max_body_size": max_body_size,
            "exclude_paths": exclude_paths or [],
            "sensitive_field_patterns": sensitive_field_patterns
            or [
                "password",
                "token",
                "secret",
                "key",
                "authorization",
                "cookie",
                "credential",
                "ssn",
            ],
        }
    )

    # Add middleware
    app.add_middleware(RequestResponseLoggingMiddleware)


def update_logging_config(**kwargs: Any) -> None:
    """Update logging configuration at runtime."""
    _logging_config.update(kwargs)
