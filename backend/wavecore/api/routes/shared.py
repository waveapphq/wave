"""Shared route utilities for the WAVE API.

Provides common functions used across all route modules to ensure
consistent request handling, validation, and response formatting.

Routes should use these instead of implementing their own copies.
"""

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import Request

from wavecore import __version__
from wavecore.api.exceptions import PreconditionRequiredException, ValidationException
from wavecore.core.variables.return_values import ReturnValueType

NOT_A_JSON_ARRAY = "The request body must be a JSON array"


async def read_json(request: Request) -> Any:
    """The request body as any JSON value; a body that is not JSON is a bad request."""
    try:
        return await request.json()
    except ValueError:
        # Text that is not JSON, not UTF-8, or holds a number too long to read
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


def read_conflict_resolutions(text: str) -> dict[str, str]:
    """An import form's name-to-resolution map, empty when the field is empty."""
    if not text:
        return {}
    try:
        resolutions = json.loads(text)
    except ValueError:
        raise ValidationException("Invalid JSON in conflict_resolutions") from None
    if not isinstance(resolutions, dict):
        raise ValidationException("'conflict_resolutions' must be a JSON object")
    if not all(isinstance(value, str) for value in resolutions.values()):
        raise ValidationException("Each value in 'conflict_resolutions' must be a string")
    return resolutions


def envelope(payload: dict[str, Any]) -> dict[str, Any]:
    """The success body every WAVE endpoint answers with; the client reads `data`."""
    return {"success": True, "data": payload}


def validate_uuid(value: Any, field_name: str = "id") -> str:
    """Validate that a value is a string in UUID format.

    Args:
        value: UUID string to validate.
        field_name: Name of the field for error messages.

    Returns:
        The validated UUID string (unchanged).

    Raises:
        ValidationException: If the value is not a string or not a valid UUID.
    """
    message = f"Invalid UUID format for {field_name}: '{value}'"
    if not isinstance(value, str):
        raise ValidationException(message)
    try:
        uuid.UUID(value)
    except ValueError as err:
        raise ValidationException(message) from err
    return value


def entity_etag(entity: dict[str, Any]) -> str:
    """The ETag of a stored entity: a quoted hash of its ID, version and last change."""
    content = f"{entity.get('id')}{entity.get('version')}{entity.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


def refuse_stale_etag(
    if_match: str | None,
    load: Callable[[str], dict[str, Any] | None],
    entity_id: str,
    etag_of: Callable[[dict[str, Any]], str] = entity_etag,
) -> None:
    """Refuse a write whose If-Match no longer matches the ETag of the stored entity."""
    if not if_match:
        return
    entity = load(entity_id)
    if entity and if_match != etag_of(entity):
        raise PreconditionRequiredException("Precondition failed: resource has been modified")


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


def validate_variable_types(variables: Any) -> None:
    """Validate variable type declarations.

    Args:
        variables: Variable declarations to validate.

    Raises:
        ValidationException: If the variables are not an object or one has an invalid type.
    """
    if not isinstance(variables, dict):
        raise ValidationException("Field 'variables' must be an object")
    for var_name, var_info in variables.items():
        if isinstance(var_info, dict):
            var_type = var_info.get("type")
            if var_type and var_type not in VALID_VAR_TYPES:
                raise ValidationException(
                    f"Invalid variable type '{var_type}' for variable '{var_name}'. "
                    f"Allowed types: {', '.join(VALID_VAR_TYPES)}"
                )


def validate_computed_expression(var_name: str, expression: str) -> None:
    """Validate computed variable expression syntax.

    Args:
        var_name: Variable name for error messages.
        expression: Expression to validate.

    Raises:
        ValidationException: If expression syntax is invalid.
    """
    # Check for unclosed template tags
    open_count = expression.count("{{")
    close_count = expression.count("}}")
    if open_count != close_count:
        raise ValidationException(
            f"Invalid expression syntax for computed variable '{var_name}': "
            "unclosed template tag"
        )
