"""Domain exception classes for the WAVE API.

These exceptions map to HTTP status codes and are automatically handled
by the error handling middleware, which formats them into standardized
JSON responses with correlation IDs and consistent error envelopes.

Routes should raise these exceptions instead of manually constructing
JSONResponse objects. The middleware catches WaveException subclasses
and returns the appropriate HTTP response.

Usage:
    from wavecore.api.exceptions import NotFoundException, ValidationException

    async def get_test(test_id: str):
        validate_uuid(test_id, "test_id")  # raises ValidationException
        test = test_service.get(test_id)
        if test is None:
            raise NotFoundException(f"Test '{test_id}' not found")
        return test
"""

from typing import Any

from fastapi import status

# Constant for the generic internal error message
_ERR_INTERNAL = "An internal server error occurred"


class WaveException(Exception):
    """Base exception class for WAVE custom exceptions.

    All WAVE custom exceptions should inherit from this class.
    The middleware catches these and formats them into standardized responses.
    """

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    error_code: str = "INTERNAL_ERROR"
    message: str = _ERR_INTERNAL
    details: dict[str, Any] | None = None

    def __init__(self, message: str | None = None, details: dict[str, Any] | None = None) -> None:
        """Initialize exception.

        Args:
            message: Optional custom error message
            details: Optional additional error context
        """
        self.message = message or self.message
        self.details = details
        super().__init__(self.message)


class ValidationException(WaveException):
    """Exception for validation errors (400 Bad Request)."""

    status_code = status.HTTP_400_BAD_REQUEST
    error_code = "VALIDATION_ERROR"
    message = "Validation failed"


class AuthenticationException(WaveException):
    """Exception for authentication errors (401 Unauthorized)."""

    status_code = status.HTTP_401_UNAUTHORIZED
    error_code = "AUTHENTICATION_ERROR"
    message = "Authentication failed"


class AuthorizationException(WaveException):
    """Exception for authorization errors (403 Forbidden)."""

    status_code = status.HTTP_403_FORBIDDEN
    error_code = "AUTHORIZATION_ERROR"
    message = "Insufficient permissions"


class NotFoundException(WaveException):
    """Exception for resource not found errors (404 Not Found)."""

    status_code = status.HTTP_404_NOT_FOUND
    error_code = "NOT_FOUND"
    message = "Resource not found"


class ConflictException(WaveException):
    """Exception for resource conflict errors (409 Conflict)."""

    status_code = status.HTTP_409_CONFLICT
    error_code = "CONFLICT"
    message = "Resource conflict"


class RangeNotSatisfiableException(WaveException):
    """Exception for unsatisfiable byte ranges (416 Range Not Satisfiable)."""

    status_code = status.HTTP_416_RANGE_NOT_SATISFIABLE
    error_code = "RANGE_NOT_SATISFIABLE"
    message = "Invalid range"


class UnprocessableEntityException(WaveException):
    """Exception for unprocessable entity errors (422 Unprocessable Entity)."""

    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    error_code = "UNPROCESSABLE_ENTITY"
    message = "Unprocessable entity"


class UnencodableTextException(WaveException):
    """Exception for request text that UTF-8 cannot write (422 Unprocessable Entity)."""

    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    error_code = "VALIDATION_ERROR"
    message = "The request has text that cannot be encoded as UTF-8"


class PreconditionRequiredException(WaveException):
    """Exception for missing required preconditions (412 Precondition Failed)."""

    status_code = status.HTTP_412_PRECONDITION_FAILED
    error_code = "PRECONDITION_REQUIRED"
    message = "Precondition required"


class InsufficientStorageException(WaveException):
    """Exception for a write that would exhaust storage (507 Insufficient Storage)."""

    status_code = status.HTTP_507_INSUFFICIENT_STORAGE
    error_code = "INSUFFICIENT_STORAGE"
    message = "Insufficient storage"


class InternalServerException(WaveException):
    """Exception for internal server errors (500 Internal Server Error)."""

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    error_code = "INTERNAL_ERROR"
    message = _ERR_INTERNAL
