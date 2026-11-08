"""Shared route utilities for the WAVE API.

Provides common functions used across all route modules to ensure
consistent request handling, validation, and response formatting.

Routes should use these instead of implementing their own copies.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request

from wavecore import __version__
from wavecore.api.exceptions import ValidationException
from wavecore.core.variables.return_values import ReturnValueType

NOT_A_JSON_ARRAY = "The request body must be a JSON array"


async def read_json(request: Request) -> Any:
    """The request body as any JSON value; a body that is not JSON is a bad request."""
    try:
        return await request.json()
    except ValueError:
        raise ValidationException("The request body is not valid JSON") from None


async def read_json_object(request: Request) -> dict[str, Any]:
    """The request body as a JSON object; any other body is a bad request, never a server error."""
    body = await read_json(request)
    if not isinstance(body, dict):
        raise ValidationException("The request body must be a JSON object")
    return body


async def read_json_array(request: Request) -> list[Any]:
    """The request body as a JSON array; any other body is a bad request, never a server error."""
    body = await read_json(request)
    if not isinstance(body, list):
        raise ValidationException(NOT_A_JSON_ARRAY)
    return body


def list_field(body: dict[str, Any], field: str, message: str) -> list[Any]:
    """The body's `field` as a list, empty when absent; any other value is a bad request."""
    value = body.get(field, [])
    if not isinstance(value, list):
        raise ValidationException(message)
    return value


def id_list_field(body: dict[str, Any], field: str) -> list[str]:
    """The body's `field` as a list of ID strings, empty when absent; else a bad request."""
    message = f"'{field}' must be a list of ID strings"
    ids = list_field(body, field, message)
    if not all(isinstance(item, str) for item in ids):
        raise ValidationException(message)
    return ids


def envelope(payload: dict[str, Any]) -> dict[str, Any]:
    """The success body every WAVE endpoint answers with; the client reads `data`."""
    return {"success": True, "data": payload}


def validate_uuid(value: str, field_name: str = "id") -> str:
    """Validate that a string is a valid UUID format.

    Args:
        value: UUID string to validate.
        field_name: Name of the field for error messages.

    Returns:
        The validated UUID string (unchanged).

    Raises:
        ValidationException: If the value is not a valid UUID.
    """
    try:
        uuid.UUID(value)
        return value
    except ValueError as err:
        raise ValidationException(f"Invalid UUID format for {field_name}: '{value}'") from err


def build_response_meta(request: Request) -> dict[str, Any]:
    """Build standardized response metadata.

    Args:
        request: The incoming HTTP request.

    Returns:
        Metadata dict with request_id, path, timestamp, and version.
    """
    return {
        "request_id": str(uuid.uuid4()),
        "path": str(request.url.path),
        "timestamp": datetime.now(UTC).isoformat(),
        "version": __version__,
    }


# Valid variable types - derived from ReturnValueType enum (single source of truth)
VALID_VAR_TYPES = [t.value for t in ReturnValueType if t != ReturnValueType.NULL]


def validate_variable_types(variables: dict[str, Any]) -> None:
    """Validate variable type declarations.

    Args:
        variables: Variable declarations to validate.

    Raises:
        ValueError: If any variable has invalid type.
    """
    for var_name, var_info in variables.items():
        if isinstance(var_info, dict):
            var_type = var_info.get("type")
            if var_type and var_type not in VALID_VAR_TYPES:
                raise ValueError(
                    f"Invalid variable type '{var_type}' for variable '{var_name}'. "
                    f"Allowed types: {', '.join(VALID_VAR_TYPES)}"
                )


def validate_computed_expression(var_name: str, expression: str) -> None:
    """Validate computed variable expression syntax.

    Args:
        var_name: Variable name for error messages.
        expression: Expression to validate.

    Raises:
        ValueError: If expression syntax is invalid.
    """
    # Check for unclosed template tags
    open_count = expression.count("{{")
    close_count = expression.count("}}")
    if open_count != close_count:
        raise ValueError(
            f"Invalid expression syntax for computed variable '{var_name}': "
            "unclosed template tag"
        )
