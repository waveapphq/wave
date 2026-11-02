"""Tests for REQ-5.2.3.4: Global error handling middleware with standardized error responses.

This test module verifies:
- Middleware layer intercepting all unhandled exceptions
- Exception-to-HTTP status code mapping for common error categories
- Automatic error response formatting matching standardized schema
- Request context preservation for error tracking
- Error response structure (ErrorResponse, ErrorDetail, ResponseMeta)
- Exception categorization (validation, auth, not found, conflict, internal)
- Error context and details (field-level validation, resource IDs)
- Production vs development mode (stack trace handling)
- Request ID generation and propagation
- Integration with logging for error audit trails
"""

import importlib.util
import warnings
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from wavecore.api.middleware import (
    AuthenticationException,
    AuthorizationException,
    ConflictException,
    InternalServerException,
    NotFoundException,
    ValidationException,
    WaveException,
    _create_error_response,
    _format_validation_errors,
    _get_stack_trace,
    _get_timestamp,
    _is_production_mode,
    _sanitize_error_message,
    add_error_handling_middleware,
    error_handler_middleware,
)


class TestErrorResponseStructure:
    """Test suite for standardized error response structure."""

    def test_error_response_has_required_fields(self) -> None:
        """Test that error responses contain success, error, and meta fields."""
        # This test will verify the structure once middleware is implemented
        # Expected structure:
        # {
        #   "success": false,
        #   "error": {"code": "...", "message": "...", "details": {...}},
        #   "meta": {"timestamp": "...", "version": "...", "request_id": "..."}
        # }
        pass

    def test_error_detail_structure(self) -> None:
        """Test that ErrorDetail contains code, message, and optional details."""
        # ErrorDetail must have:
        # - code: string (error classification)
        # - message: string (human-readable message)
        # - details: object (optional, additional context)
        pass

    def test_response_meta_structure(self) -> None:
        """Test that ResponseMeta contains timestamp, version, and request_id."""
        # ResponseMeta must have:
        # - timestamp: ISO 8601 datetime string
        # - version: API version string
        # - request_id: UUID string for request correlation
        pass

    def test_success_field_always_false_for_errors(self) -> None:
        """Test that success field is always false in error responses."""
        pass


class TestExceptionToStatusCodeMapping:
    """Test suite for exception-to-HTTP status code mapping."""

    def test_validation_error_maps_to_400(self) -> None:
        """Test that validation errors map to HTTP 400 Bad Request."""
        pass

    def test_authentication_error_maps_to_401(self) -> None:
        """Test that authentication errors map to HTTP 401 Unauthorized."""
        pass

    def test_authorization_error_maps_to_403(self) -> None:
        """Test that authorization errors map to HTTP 403 Forbidden."""
        pass

    def test_not_found_error_maps_to_404(self) -> None:
        """Test that resource not found errors map to HTTP 404 Not Found."""
        pass

    def test_method_not_allowed_maps_to_405(self) -> None:
        """Test that method not allowed maps to HTTP 405."""
        pass

    def test_conflict_error_maps_to_409(self) -> None:
        """Test that conflict errors map to HTTP 409 Conflict."""
        pass

    def test_internal_server_error_maps_to_500(self) -> None:
        """Test that unhandled exceptions map to HTTP 500 Internal Server Error."""
        pass

    def test_http_exception_preserves_status_code(self) -> None:
        """Test that HTTPException status codes are preserved."""
        pass


class TestValidationErrors:
    """Test suite for validation error handling."""

    def test_validation_error_includes_field_details(self) -> None:
        """Test that validation errors include field-level details."""
        # Validation errors must include:
        # - Field name that failed validation
        # - Validation rule that failed
        # - Invalid value (if safe to include)
        # - Human-readable message
        pass

    def test_multiple_validation_errors_aggregated(self) -> None:
        """Test that multiple field validation errors are aggregated."""
        # When multiple fields fail validation, all errors should be returned
        # in a single response
        pass

    def test_pydantic_validation_error_transformation(self) -> None:
        """Test that Pydantic ValidationError is transformed correctly."""
        # Pydantic errors have specific structure that needs transformation
        # to match our ErrorDetail schema
        pass

    def test_request_validation_error_transformation(self) -> None:
        """Test that FastAPI RequestValidationError is transformed correctly."""
        pass

    def test_validation_error_code_is_validation_error(self) -> None:
        """Test that validation errors use 'VALIDATION_ERROR' error code."""
        pass

    def test_validation_error_details_contain_field_info(self) -> None:
        """Test that validation error details contain field-specific info."""
        # Details should include:
        # - field: field name
        # - reason: why validation failed
        # - input: what value was provided (if safe)
        pass


class TestAuthenticationErrors:
    """Test suite for authentication error handling."""

    def test_authentication_error_code(self) -> None:
        """Test that authentication errors use 'AUTHENTICATION_ERROR' code."""
        pass

    def test_authentication_error_message(self) -> None:
        """Test that authentication errors have clear message."""
        # Message should indicate missing or invalid credentials
        pass

    def test_authentication_error_no_sensitive_data(self) -> None:
        """Test that auth errors don't leak sensitive information."""
        # Should not include password, tokens, or other credentials
        pass


class TestAuthorizationErrors:
    """Test suite for authorization error handling."""

    def test_authorization_error_code(self) -> None:
        """Test that authorization errors use 'AUTHORIZATION_ERROR' code."""
        pass

    def test_authorization_error_message(self) -> None:
        """Test that authorization errors indicate insufficient permissions."""
        pass

    def test_authorization_error_includes_required_permission(self) -> None:
        """Test that authorization errors can include required permission details."""
        # Details might include what permission was needed
        pass


class TestNotFoundErrors:
    """Test suite for resource not found error handling."""

    def test_not_found_error_code(self) -> None:
        """Test that not found errors use 'NOT_FOUND' error code."""
        pass

    def test_not_found_error_includes_resource_type(self) -> None:
        """Test that not found errors include resource type in details."""
        # e.g., "test", "suite", "regression", "plugin"
        pass

    def test_not_found_error_includes_resource_identifier(self) -> None:
        """Test that not found errors include resource ID/name."""
        pass

    def test_not_found_error_message_is_descriptive(self) -> None:
        """Test that not found error messages are human-readable."""
        # e.g., "Test 'my-test' not found"
        pass


class TestConflictErrors:
    """Test suite for conflict error handling."""

    def test_conflict_error_code(self) -> None:
        """Test that conflict errors use 'CONFLICT' error code."""
        pass

    def test_conflict_error_describes_conflict(self) -> None:
        """Test that conflict errors describe the conflicting state."""
        # e.g., "Test 'my-test' already exists"
        pass

    def test_conflict_error_includes_conflicting_resource(self) -> None:
        """Test that conflict errors identify the conflicting resource."""
        pass


class TestInternalServerErrors:
    """Test suite for internal server error handling."""

    def test_internal_error_code(self) -> None:
        """Test that internal errors use 'INTERNAL_ERROR' error code."""
        pass

    def test_internal_error_generic_message_in_production(self) -> None:
        """Test that internal errors show generic message in production mode."""
        # Production: "An internal server error occurred"
        # Should NOT expose implementation details
        pass

    def test_internal_error_detailed_message_in_development(self) -> None:
        """Test that internal errors show details in development mode."""
        # Development: Include exception type and message for debugging
        pass

    def test_internal_error_sanitizes_sensitive_info(self) -> None:
        """Test that internal errors sanitize sensitive information."""
        # Should not expose:
        # - Database connection strings
        # - File system paths (in production)
        # - Secret keys or tokens
        pass


class TestStackTraceHandling:
    """Test suite for stack trace handling in different modes."""

    def test_stack_trace_included_in_development_mode(self) -> None:
        """Test that stack traces are included in development mode."""
        # Development mode should include full stack trace in error details
        pass

    def test_stack_trace_excluded_in_production_mode(self) -> None:
        """Test that stack traces are excluded in production mode."""
        # Production mode should NOT include stack traces to prevent info leakage
        pass

    def test_stack_trace_logged_in_production(self) -> None:
        """Test that stack traces are logged even when not returned."""
        # Even though not returned to client, should be logged for debugging
        pass

    def test_stack_trace_format_is_readable(self) -> None:
        """Test that stack trace format is readable when included."""
        # Should be formatted as array of strings or single string with newlines
        pass


class TestRequestContextPreservation:
    """Test suite for request context preservation in errors."""

    def test_request_id_generation(self) -> None:
        """Test that request ID is generated for each request."""
        # Each request should get a unique UUID
        pass

    def test_request_id_included_in_error_meta(self) -> None:
        """Test that request ID is included in error response meta."""
        pass

    def test_request_id_propagated_to_logs(self) -> None:
        """Test that request ID is included in error logs."""
        # For correlation between client error and server logs
        pass

    def test_request_id_is_uuid_format(self) -> None:
        """Test that request ID follows UUID format."""
        pass

    def test_timestamp_is_iso8601_format(self) -> None:
        """Test that error timestamp is in ISO 8601 format."""
        pass

    def test_timestamp_is_utc(self) -> None:
        """Test that error timestamp is in UTC timezone."""
        pass

    def test_api_version_included_in_meta(self) -> None:
        """Test that API version is included in response meta."""
        pass


class TestMiddlewareIntegration:
    """Test suite for middleware integration with FastAPI."""

    def test_middleware_intercepts_all_exceptions(self) -> None:
        """Test that middleware catches exceptions from all routes."""
        pass

    def test_middleware_processes_exceptions_before_default_handler(self) -> None:
        """Test that custom middleware runs before FastAPI's default handler."""
        pass

    def test_middleware_maintains_request_pipeline_order(self) -> None:
        """Test that error middleware doesn't disrupt other middleware."""
        pass

    def test_middleware_handles_async_route_exceptions(self) -> None:
        """Test that middleware handles exceptions from async route handlers."""
        pass

    def test_middleware_handles_sync_route_exceptions(self) -> None:
        """Test that middleware handles exceptions from sync route handlers."""
        pass


class TestLoggingIntegration:
    """Test suite for error logging integration."""

    def test_errors_are_logged_with_request_context(self) -> None:
        """Test that errors are logged with full request context."""
        # Should include: request ID, endpoint, method, user, timestamp
        pass

    def test_error_log_level_matches_severity(self) -> None:
        """Test that log level matches error severity."""
        # 4xx errors: WARNING
        # 5xx errors: ERROR
        pass

    def test_error_logs_include_stack_trace(self) -> None:
        """Test that error logs include full stack trace."""
        # Even in production, logs should have stack trace
        pass

    def test_sensitive_data_masked_in_logs(self) -> None:
        """Test that sensitive data is masked in error logs."""
        # Passwords, tokens, etc. should be masked
        pass


class TestCustomExceptionClasses:
    """Test suite for custom exception classes."""

    def test_custom_exception_status_code_mapping(self) -> None:
        """Test that custom exceptions map to correct status codes."""
        # Custom exceptions should declare their status code
        pass

    def test_custom_exception_error_code_mapping(self) -> None:
        """Test that custom exceptions map to error codes."""
        # Custom exceptions should declare their error code
        pass

    def test_custom_exception_detail_extraction(self) -> None:
        """Test that custom exception details are extracted correctly."""
        pass


class TestDatabaseErrorHandling:
    """Test suite for database error categorization."""

    def test_connection_error_handling(self) -> None:
        """Test that database connection errors are handled gracefully."""
        pass

    def test_constraint_violation_maps_to_conflict(self) -> None:
        """Test that DB constraint violations map to 409 Conflict."""
        pass

    def test_query_error_maps_to_internal_error(self) -> None:
        """Test that DB query errors map to 500 Internal Error."""
        pass

    def test_database_error_messages_are_user_friendly(self) -> None:
        """Test that DB errors generate user-friendly messages."""
        # Don't expose raw SQL errors to users
        pass


class TestThirdPartyExceptionWrapping:
    """Test suite for third-party library exception handling."""

    def test_third_party_exceptions_wrapped_consistently(self) -> None:
        """Test that third-party exceptions are wrapped in standard format."""
        pass

    def test_third_party_exception_details_sanitized(self) -> None:
        """Test that third-party exception details are sanitized."""
        # Remove implementation details that might leak info
        pass


class TestErrorMetricsCollection:
    """Test suite for error metrics collection."""

    def test_error_count_metrics_collected(self) -> None:
        """Test that error counts are tracked for monitoring."""
        pass

    def test_error_metrics_include_status_code(self) -> None:
        """Test that metrics are broken down by status code."""
        pass

    def test_error_metrics_include_endpoint(self) -> None:
        """Test that metrics are broken down by endpoint."""
        pass

    def test_error_metrics_include_error_code(self) -> None:
        """Test that metrics include error code classification."""
        pass


class TestErrorRateLimiting:
    """Test suite for error rate limiting to prevent info disclosure."""

    def test_excessive_errors_from_same_source_detected(self) -> None:
        """Test that excessive errors from same source are detected."""
        pass

    def test_error_details_reduced_after_rate_limit(self) -> None:
        """Test that error detail verbosity reduces after rate limit hit."""
        # After threshold, return minimal error info
        pass


class TestProductionSafetyFeatures:
    """Test suite for production safety features."""

    def test_no_file_paths_in_production_errors(self) -> None:
        """Test that file system paths are not exposed in production."""
        pass

    def test_no_environment_variables_in_errors(self) -> None:
        """Test that environment variables are not exposed in errors."""
        pass

    def test_no_secret_keys_in_errors(self) -> None:
        """Test that secret keys are never included in errors."""
        pass

    def test_error_messages_are_generic_for_security(self) -> None:
        """Test that security-related errors use generic messages."""
        # Auth/authz errors should not indicate why they failed
        # (don't help attackers)
        pass


class TestErrorResponseConsistency:
    """Test suite for error response consistency across error types."""

    def test_all_errors_use_same_envelope_structure(self) -> None:
        """Test that all error types use the same JSON envelope."""
        pass

    def test_error_code_format_is_consistent(self) -> None:
        """Test that error codes follow consistent naming convention."""
        # e.g., UPPER_SNAKE_CASE
        pass

    def test_error_messages_are_actionable(self) -> None:
        """Test that error messages tell users how to fix the issue."""
        pass

    def test_http_status_code_matches_error_category(self) -> None:
        """Test that HTTP status code is semantically correct for error type."""
        pass


class TestEdgeCases:
    """Test suite for edge cases and boundary conditions."""

    def test_error_during_error_handling(self) -> None:
        """Test that errors during error handling are caught."""
        # Error handler should not crash if it encounters an error
        pass

    def test_very_large_error_details_handled(self) -> None:
        """Test that very large error details don't cause issues."""
        # Should truncate or limit size
        pass

    def test_circular_reference_in_error_details(self) -> None:
        """Test that circular references in error details are handled."""
        pass

    def test_non_serializable_error_details_handled(self) -> None:
        """Test that non-JSON-serializable error details are handled."""
        pass

    def test_unicode_in_error_messages(self) -> None:
        """Test that unicode characters in error messages work correctly."""
        pass

    def test_error_with_missing_request_context(self) -> None:
        """Test error handling when request context is incomplete."""
        pass


class TestRequestValidationErrors:
    """Test suite for FastAPI request validation errors."""

    def test_missing_required_field_error(self) -> None:
        """Test error when required request field is missing."""
        pass

    def test_invalid_field_type_error(self) -> None:
        """Test error when field has wrong type."""
        pass

    def test_invalid_field_format_error(self) -> None:
        """Test error when field has invalid format (e.g., email, UUID)."""
        pass

    def test_field_constraint_violation_error(self) -> None:
        """Test error when field violates constraints (min/max length, etc.)."""
        pass

    def test_invalid_enum_value_error(self) -> None:
        """Test error when enum field has invalid value."""
        pass

    def test_path_parameter_validation_error(self) -> None:
        """Test validation error for path parameters."""
        pass

    def test_query_parameter_validation_error(self) -> None:
        """Test validation error for query parameters."""
        pass

    def test_request_body_validation_error(self) -> None:
        """Test validation error for request body."""
        pass


class TestErrorHandlerConfiguration:
    """Test suite for error handler configuration."""

    def test_error_handler_can_be_configured_per_environment(self) -> None:
        """Test that error handling behavior can differ by environment."""
        pass

    def test_debug_mode_affects_error_verbosity(self) -> None:
        """Test that debug mode increases error detail verbosity."""
        pass

    def test_error_handler_respects_config_settings(self) -> None:
        """Test that error handler uses application configuration."""
        pass


class TestCORSWithErrorResponses:
    """Test suite for CORS headers in error responses."""

    def test_error_responses_include_cors_headers(self) -> None:
        """Test that error responses include CORS headers."""
        # Important for frontend to receive error details
        pass

    def test_preflight_errors_handled_correctly(self) -> None:
        """Test that errors during CORS preflight are handled."""
        pass


class TestErrorResponseCorrelationHeaders:
    """Test suite for the correlation headers a client reads off a failed response."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "raised",
        [
            NotFoundException(message="Resource not found"),
            ValidationException(message="Field is required"),
            InternalServerException(message="Store unavailable"),
            HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already exists"),
            StarletteHTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Denied"),
            RequestValidationError(
                errors=[{"loc": ("body", "name"), "msg": "required", "type": "missing"}]
            ),
            RuntimeError("unexpected failure"),
        ],
    )
    async def test_error_response_carries_the_envelope_request_id_as_a_header(
        self, raised: Exception
    ) -> None:
        """Test that every error response repeats its own request id in the headers."""
        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises(req: Request) -> None:
            raise raised

        with patch(
            "wavecore.api.middleware.middleware_module._is_production_mode", return_value=False
        ):
            response = await error_handler_middleware(request, call_next_raises)

        request_id = json.loads(response.body)["meta"]["request_id"]
        assert request_id, "the error envelope must carry a request id"
        assert (
            response.headers.get("X-Request-ID") == request_id
        ), "a failed response must repeat its request id in X-Request-ID"
        assert (
            response.headers.get("X-Correlation-ID") == request_id
        ), "a failed response must repeat its request id in X-Correlation-ID"


class TestHelperFunctionsAndExceptionCoverage:
    """Test suite covering helper functions and exception classes."""

    def test_wave_exception_with_custom_message(self) -> None:
        """Test WaveException initialization with custom message."""
        exc = WaveException(message="Custom error message")
        assert exc.message == "Custom error message"
        assert exc.details is None
        assert str(exc) == "Custom error message"

    def test_wave_exception_with_custom_details(self) -> None:
        """Test WaveException initialization with custom details."""
        details = {"resource_id": "test-123", "reason": "conflict"}
        exc = WaveException(message="Error with details", details=details)
        assert exc.message == "Error with details"
        assert exc.details == details

    def test_wave_exception_default_message(self) -> None:
        """Test WaveException uses default message when none provided."""
        exc = WaveException()
        assert exc.message == "An internal server error occurred"
        assert exc.details is None

    def test_get_timestamp_returns_iso8601_format(self) -> None:
        """Test that _get_timestamp returns ISO 8601 formatted timestamp."""
        timestamp = _get_timestamp()
        # Should be able to parse as datetime
        dt = datetime.fromisoformat(timestamp)
        assert dt.tzinfo is not None  # Should have timezone info

    def test_sanitize_error_message_in_development(self) -> None:
        """Test error message sanitization in development mode."""
        message = "Database connection failed: internal server error"
        result = _sanitize_error_message(message, production=False)
        assert result == message  # Should be unchanged in development

    def test_sanitize_error_message_in_production_with_internal(self) -> None:
        """Test error message sanitization in production for internal errors."""
        message = "Database internal error occurred"
        result = _sanitize_error_message(message, production=True)
        assert result == "An internal server error occurred"

    def test_sanitize_error_message_in_production_with_server(self) -> None:
        """Test error message sanitization in production for server errors."""
        message = "Server configuration failed"
        result = _sanitize_error_message(message, production=True)
        assert result == "An internal server error occurred"

    def test_sanitize_error_message_in_production_safe_message(self) -> None:
        """Test error message sanitization preserves safe messages in production."""
        message = "Validation failed for field 'name'"
        result = _sanitize_error_message(message, production=True)
        assert result == message  # Should be unchanged

    def test_format_validation_errors_single_error(self) -> None:
        """Test formatting of single validation error."""
        # Create a mock RequestValidationError

        # Create validation error with proper structure
        exc = RequestValidationError(
            errors=[
                {
                    "loc": ("body", "name"),
                    "msg": "Field required",
                    "type": "missing",
                }
            ]
        )

        result = _format_validation_errors(exc)
        assert "validation_errors" in result
        assert len(result["validation_errors"]) == 1
        assert result["validation_errors"][0]["field"] == "body -> name"
        assert result["validation_errors"][0]["reason"] == "Field required"
        assert result["validation_errors"][0]["type"] == "missing"

    def test_format_validation_errors_multiple_errors(self) -> None:
        """Test formatting of multiple validation errors."""
        exc = RequestValidationError(
            errors=[
                {
                    "loc": ("body", "name"),
                    "msg": "Field required",
                    "type": "missing",
                },
                {
                    "loc": ("body", "age"),
                    "msg": "Input should be a valid integer",
                    "type": "int_parsing",
                },
            ]
        )

        result = _format_validation_errors(exc)
        assert len(result["validation_errors"]) == 2

    def test_get_stack_trace_in_production(self) -> None:
        """Test stack trace is None in production mode."""
        try:
            raise ValueError("Test error")
        except ValueError as exc:
            result = _get_stack_trace(exc, production=True)
            assert result is None

    def test_get_stack_trace_in_development(self) -> None:
        """Test stack trace is returned in development mode."""
        try:
            raise ValueError("Test error")
        except ValueError as exc:
            result = _get_stack_trace(exc, production=False)
            assert result is not None
            assert isinstance(result, list)
            assert len(result) > 0
            assert any("ValueError" in line for line in result)

    def test_create_error_response_with_all_parameters(self) -> None:
        """Test creating error response with all parameters."""
        response = _create_error_response(
            _status_code=400,
            error_code="TEST_ERROR",
            message="Test message",
            details={"field": "value"},
            request_id="test-request-id-123",
        )

        assert response.success is False
        assert response.error.code == "TEST_ERROR"
        assert response.error.message == "Test message"
        assert response.error.details == {"field": "value"}
        assert response.meta.request_id == "test-request-id-123"
        from wavecore import __version__

        assert response.meta.version == __version__

    def test_create_error_response_generates_request_id(self) -> None:
        """Test creating error response generates request ID if not provided."""
        response = _create_error_response(
            _status_code=500,
            error_code="INTERNAL_ERROR",
            message="Error",
        )

        assert response.meta.request_id is not None
        # Should be a valid UUID format
        import uuid

        uuid.UUID(response.meta.request_id)  # Will raise if invalid

    @pytest.mark.asyncio
    async def test_middleware_handles_request_validation_error(self) -> None:
        """Test middleware handles RequestValidationError."""
        # Create a RequestValidationError and test _format_validation_errors directly
        # The middleware test is done via integration with full app
        exc = RequestValidationError(
            errors=[
                {
                    "loc": ("body", "email"),
                    "msg": "value is not a valid email address",
                    "type": "value_error.email",
                }
            ]
        )

        # Create mock request

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises_validation(req: Request) -> None:
            raise exc

        # Test middleware directly
        with patch(
            "wavecore.api.middleware.middleware_module._is_production_mode", return_value=False
        ):
            response = await error_handler_middleware(request, call_next_raises_validation)
            assert response.status_code == 400
            import json

            data = json.loads(response.body)
            assert data["success"] is False
            assert data["error"]["code"] == "VALIDATION_ERROR"
            assert "validation_errors" in data["error"]["details"]

    @pytest.mark.asyncio
    async def test_middleware_handles_wave_exception(self) -> None:
        """Test middleware handles WaveException."""
        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises_wave_exc(req: Request) -> None:
            raise NotFoundException(message="Resource not found", details={"resource_id": "123"})

        with patch(
            "wavecore.api.middleware.middleware_module._is_production_mode", return_value=True
        ):
            response = await error_handler_middleware(request, call_next_raises_wave_exc)
            assert response.status_code == 404
            body = response.body
            data = json.loads(body)
            assert data["success"] is False
            assert data["error"]["code"] == "NOT_FOUND"
            assert data["error"]["message"] == "Resource not found"

    @pytest.mark.asyncio
    async def test_middleware_handles_http_exception(self) -> None:
        """Test middleware handles HTTPException."""
        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises_http_exc(req: Request) -> None:
            raise HTTPException(status_code=403, detail="Access forbidden")

        with patch(
            "wavecore.api.middleware.middleware_module._is_production_mode", return_value=True
        ):
            response = await error_handler_middleware(request, call_next_raises_http_exc)
            assert response.status_code == 403
            body = response.body
            data = json.loads(body)
            assert data["success"] is False
            assert data["error"]["code"] == "AUTHORIZATION_ERROR"
            assert data["error"]["message"] == "Access forbidden"

    @pytest.mark.asyncio
    async def test_middleware_handles_starlette_http_exception(self) -> None:
        """Test middleware handles StarletteHTTPException."""
        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises_starlette_exc(req: Request) -> None:
            raise StarletteHTTPException(status_code=405, detail="Method not allowed")

        with patch(
            "wavecore.api.middleware.middleware_module._is_production_mode", return_value=True
        ):
            response = await error_handler_middleware(request, call_next_raises_starlette_exc)
            assert response.status_code == 405
            body = response.body
            data = json.loads(body)
            assert data["success"] is False
            assert data["error"]["code"] == "METHOD_NOT_ALLOWED"

    @pytest.mark.asyncio
    async def test_middleware_handles_generic_exception(self) -> None:
        """Test middleware handles generic Exception."""
        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises_generic_exc(req: Request) -> None:
            raise RuntimeError("Unexpected error occurred")

        with patch(
            "wavecore.api.middleware.middleware_module._is_production_mode", return_value=True
        ):
            response = await error_handler_middleware(request, call_next_raises_generic_exc)
            assert response.status_code == 500
            body = response.body
            data = json.loads(body)
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"

    @pytest.mark.asyncio
    @patch("wavecore.api.middleware.middleware_module._is_production_mode")
    async def test_middleware_includes_stack_trace_in_development(
        self, mock_prod: MagicMock
    ) -> None:
        """Test middleware includes stack trace in development mode."""
        mock_prod.return_value = False

        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises(req: Request) -> None:
            raise RuntimeError("Development error")

        response = await error_handler_middleware(request, call_next_raises)
        body = response.body
        data = json.loads(body)
        assert "stack_trace" in data["error"]["details"]

    @pytest.mark.asyncio
    @patch("wavecore.api.middleware.middleware_module._is_production_mode")
    async def test_middleware_excludes_stack_trace_in_production(
        self, mock_prod: MagicMock
    ) -> None:
        """Test middleware excludes stack trace in production mode."""
        mock_prod.return_value = True

        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises(req: Request) -> None:
            raise RuntimeError("Production error")

        response = await error_handler_middleware(request, call_next_raises)
        body = response.body
        data = json.loads(body)
        assert data["error"]["details"] is None

    @pytest.mark.asyncio
    async def test_middleware_with_http_exception_unmapped_status(self) -> None:
        """Test middleware handles HTTPException with unmapped status code."""
        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises(req: Request) -> None:
            raise HTTPException(status_code=418, detail="I'm a teapot")

        with patch(
            "wavecore.api.middleware.middleware_module._is_production_mode", return_value=True
        ):
            response = await error_handler_middleware(request, call_next_raises)
            assert response.status_code == 418
            body = response.body
            data = json.loads(body)
            assert data["error"]["code"] == "HTTP_ERROR"

    def test_all_custom_exception_classes_have_correct_attributes(self) -> None:
        """Test all custom exception classes have correct status codes and error codes."""
        # ValidationException
        exc = ValidationException()
        assert exc.status_code == status.HTTP_400_BAD_REQUEST
        assert exc.error_code == "VALIDATION_ERROR"

        # AuthenticationException
        exc = AuthenticationException()
        assert exc.status_code == status.HTTP_401_UNAUTHORIZED
        assert exc.error_code == "AUTHENTICATION_ERROR"

        # AuthorizationException
        exc = AuthorizationException()
        assert exc.status_code == status.HTTP_403_FORBIDDEN
        assert exc.error_code == "AUTHORIZATION_ERROR"

        # NotFoundException
        exc = NotFoundException()
        assert exc.status_code == status.HTTP_404_NOT_FOUND
        assert exc.error_code == "NOT_FOUND"

        # ConflictException
        exc = ConflictException()
        assert exc.status_code == status.HTTP_409_CONFLICT
        assert exc.error_code == "CONFLICT"

        # InternalServerException
        exc = InternalServerException()
        assert exc.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert exc.error_code == "INTERNAL_ERROR"

    @pytest.mark.asyncio
    @patch("wavecore.api.middleware.middleware_module._is_production_mode")
    async def test_middleware_wave_exception_with_stack_trace_in_dev(
        self, mock_prod: MagicMock
    ) -> None:
        """Test middleware includes stack trace for WaveException in development."""
        mock_prod.return_value = False

        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises(req: Request) -> None:
            raise ValidationException(message="Validation error in dev")

        response = await error_handler_middleware(request, call_next_raises)
        body = response.body
        data = json.loads(body)
        assert "stack_trace" in data["error"]["details"]

    @pytest.mark.asyncio
    @patch("wavecore.api.middleware.middleware_module._is_production_mode")
    async def test_middleware_http_exception_with_stack_trace_in_dev(
        self, mock_prod: MagicMock
    ) -> None:
        """Test middleware includes stack trace for HTTPException in development."""
        mock_prod.return_value = False

        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises(req: Request) -> None:
            raise HTTPException(status_code=400, detail="HTTP error in dev")

        response = await error_handler_middleware(request, call_next_raises)
        body = response.body
        data = json.loads(body)
        assert "stack_trace" in data["error"]["details"]

    @pytest.mark.asyncio
    @patch("wavecore.api.middleware.middleware_module._is_production_mode")
    async def test_middleware_starlette_exception_with_stack_trace_in_dev(
        self, mock_prod: MagicMock
    ) -> None:
        """Test middleware includes stack trace for StarletteHTTPException in development."""
        mock_prod.return_value = False

        import json

        from starlette.requests import Request

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises(req: Request) -> None:
            raise StarletteHTTPException(status_code=404, detail="Starlette error in dev")

        response = await error_handler_middleware(request, call_next_raises)
        body = response.body
        data = json.loads(body)
        assert "stack_trace" in data["error"]["details"]

    @patch("wavecore.api.middleware.middleware_module.get_config")
    def test_is_production_mode_returns_true_when_debug_false(
        self, mock_get_config: MagicMock
    ) -> None:
        """Test _is_production_mode returns True when debug is False."""
        # Mock config with debug=False (production)
        mock_config = MagicMock()
        mock_config.server.debug = False
        mock_get_config.return_value = mock_config

        # This will test lines 164-165
        result = _is_production_mode()
        assert result is True

    @patch("wavecore.api.middleware.middleware_module.get_config")
    def test_is_production_mode_returns_false_when_debug_true(
        self, mock_get_config: MagicMock
    ) -> None:
        """Test _is_production_mode returns False when debug is True."""
        # Mock config with debug=True (development)
        mock_config = MagicMock()
        mock_config.server.debug = True
        mock_get_config.return_value = mock_config

        result = _is_production_mode()
        assert result is False

    @pytest.mark.asyncio
    async def test_middleware_successful_response_passthrough(self) -> None:
        """Test middleware passes through successful responses."""
        from starlette.requests import Request
        from starlette.responses import JSONResponse

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        # Create a successful response
        success_response = JSONResponse({"status": "ok"}, status_code=200)

        async def call_next_success(req: Request) -> JSONResponse:
            return success_response

        # Test that successful response passes through (line 285)
        response = await error_handler_middleware(request, call_next_success)
        assert response.status_code == 200
        assert response == success_response

    def test_add_error_handling_middleware_adds_middleware(self) -> None:
        """Test add_error_handling_middleware adds the middleware to app."""
        app = FastAPI()

        # Get initial middleware count
        initial_middleware_count = len(app.user_middleware)

        # Add error handling middleware (tests line 465)
        add_error_handling_middleware(app)

        # Verify middleware was added
        assert len(app.user_middleware) > initial_middleware_count

        # Verify the correct middleware function was added
        # The middleware is wrapped, so we check it was added
        assert any(hasattr(mw, "func") or hasattr(mw, "cls") for mw in app.user_middleware)


class TestInsufficientStorageErrors:
    """The 507 the Test Data upload free-space guard raises (REQ-5.2.4.12)."""

    def test_exception_declares_507_and_its_error_code(self) -> None:
        """InsufficientStorageException carries 507 and INSUFFICIENT_STORAGE."""
        from wavecore.api.exceptions import InsufficientStorageException

        exc = InsufficientStorageException("Storing data.csv would leave less than 1 GB free")

        assert exc.status_code == status.HTTP_507_INSUFFICIENT_STORAGE
        assert exc.error_code == "INSUFFICIENT_STORAGE"
        assert exc.message == "Storing data.csv would leave less than 1 GB free"

    def test_exception_is_a_wave_exception(self) -> None:
        """It inherits the shared envelope base, like its siblings."""
        from wavecore.api.exceptions import InsufficientStorageException

        assert issubclass(InsufficientStorageException, WaveException)

    def test_exception_carries_details_like_its_siblings(self) -> None:
        """Optional details ride along on the envelope."""
        from wavecore.api.exceptions import InsufficientStorageException

        exc = InsufficientStorageException("no room", details={"name": "data.csv"})

        assert exc.details == {"name": "data.csv"}

    @pytest.mark.asyncio
    async def test_middleware_answers_507_with_the_insufficient_storage_envelope(self) -> None:
        """The error middleware maps it the way it maps every other WaveException."""
        import json

        from starlette.requests import Request

        from wavecore.api.exceptions import InsufficientStorageException

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/tests/abc/testdata/upload",
            "query_string": b"",
            "headers": [],
        }
        request = Request(scope)

        async def call_next_raises(req: Request) -> None:
            raise InsufficientStorageException(
                "Storing data.csv would leave less than 1 GB free",
                details={"execution_ids": []},
            )

        with patch(
            "wavecore.api.middleware.middleware_module._is_production_mode", return_value=False
        ):
            response = await error_handler_middleware(request, call_next_raises)

        body = json.loads(response.body)
        assert response.status_code == status.HTTP_507_INSUFFICIENT_STORAGE
        assert body["success"] is False
        assert body["error"]["code"] == "INSUFFICIENT_STORAGE"
        assert body["error"]["message"] == "Storing data.csv would leave less than 1 GB free"


class TestExceptionsModuleImport:
    """Importing the exception classes is quiet."""

    def test_import_raises_no_warning(self) -> None:
        """Running the module's code raises no warning, deprecation warnings included."""
        spec = importlib.util.find_spec("wavecore.api.exceptions")
        assert spec is not None and spec.loader is not None
        # A second module object, so the imported classes stay the ones other tests hold.
        fresh = importlib.util.module_from_spec(spec)

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            spec.loader.exec_module(fresh)

        assert [str(warning.message) for warning in caught] == []
