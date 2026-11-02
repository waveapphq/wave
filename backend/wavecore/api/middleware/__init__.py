"""Middleware components for WAVE backend.

Re-exports public symbols from the middleware_module for convenient access.
"""

# Re-export exception classes that callers import through this namespace
from wavecore.api.exceptions import (  # noqa: F401
    AuthenticationException,
    AuthorizationException,
    ConflictException,
    InsufficientStorageException,
    InternalServerException,
    NotFoundException,
    UnprocessableEntityException,
    ValidationException,
    WaveException,
)
from wavecore.api.middleware.middleware_module import (  # noqa: F401
    ErrorDetail,
    ErrorResponse,
    RequestResponseLoggingMiddleware,
    ResponseMeta,
    _build_dev_details,
    _create_error_response,
    _error_json_response,
    _filter_sensitive_body,
    _filter_sensitive_headers,
    _format_validation_errors,
    _generate_correlation_id,
    _generate_request_id,
    _get_stack_trace,
    _get_timestamp,
    _handle_http_exception,
    _handle_unhandled_exception,
    _handle_validation_error,
    _handle_wave_exception,
    _is_production_mode,
    _log_at_level,
    _log_body_bytes,
    _logging_config,
    _sanitize_error_message,
    _should_log_endpoint,
    _should_sample_request,
    _truncate_body,
    add_error_handling_middleware,
    add_request_response_logging_middleware,
    error_handler_middleware,
    logger,
    request_correlation_id,
    update_logging_config,
)
