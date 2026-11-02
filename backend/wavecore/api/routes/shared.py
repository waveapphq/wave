"""Shared route utilities for the WAVE API.

Provides common functions used across all route modules to ensure
consistent request handling, validation, and response formatting.

Routes should use these instead of implementing their own copies.
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request

from wavecore import __version__
from wavecore.api.exceptions import ValidationException
from wavecore.core.variables.return_values import ReturnValueType

# Semantic version pattern: MAJOR.MINOR.PATCH
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


async def read_json_object(request: Request) -> dict[str, Any]:
    """The request body as a JSON object; any other body is a bad request, never a server error."""
    try:
        body = await request.json()
    except ValueError:
        raise ValidationException("The request body is not valid JSON") from None
    if not isinstance(body, dict):
        raise ValidationException("The request body must be a JSON object")
    return body


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


def validate_semantic_version(version: str) -> None:
    """Validate semantic version format (MAJOR.MINOR.PATCH).

    Args:
        version: Version string to validate.

    Raises:
        ValueError: If version format is invalid.
    """
    if not SEMVER_PATTERN.match(version):
        raise ValueError(
            f"Invalid version format '{version}': "
            "must follow semantic versioning (MAJOR.MINOR.PATCH)"
        )


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
