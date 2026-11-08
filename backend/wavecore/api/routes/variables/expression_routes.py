"""Variable expression and watch endpoints (REQ-5.2.4.7).

This module implements expression evaluation, validation, and variable watch
endpoints for the real-time debugging and expression system.

Endpoints:
- POST /variables/evaluate: Evaluate expression
- POST /variables/validate-expression: Validate expression syntax
- POST /variables/watch: Register variable watch
- GET /variables/watch/{watch_id}: Get watched values
- DELETE /variables/watch/{watch_id}: Unregister watch
"""

from typing import Any

from fastapi import APIRouter, Request, Response, status

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import build_response_meta, read_json_object, validate_uuid
from wavecore.api.services import variable_service

_ERR_VARIABLES_REQUIRED = "Field 'variables' is required"

# Create router for variable expression/watch endpoints
router = APIRouter(tags=["Variables"])


@router.post("/variables/evaluate")
async def evaluate_expression(request: Request) -> dict[str, Any]:
    """Evaluate a variable expression.

    Supports variable references, arithmetic/logical operators,
    string formatting, and built-in functions.

    Args:
        request: HTTP request with expression and optional context

    Returns:
        Evaluation result with type and secret indicator
    """
    body = await read_json_object(request)

    # Validate required fields
    if "expression" not in body:
        raise ValidationException("Field 'expression' is required")

    result = variable_service.evaluate_expression(body["expression"], body.get("context"))

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.post("/variables/validate-expression")
async def validate_expression(request: Request) -> dict[str, Any]:
    """Validate expression syntax without evaluation.

    Returns structural correctness, undefined variable warnings,
    and type compatibility warnings.

    Args:
        request: HTTP request with expression and optional context

    Returns:
        Validation result with errors and warnings
    """
    body = await read_json_object(request)

    # Validate required fields
    if "expression" not in body:
        raise ValidationException("Field 'expression' is required")

    result = variable_service.validate_expression(
        body["expression"],
        body.get("context"),
        is_field_expression=body.get("isFieldExpression", False),
    )

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.post("/variables/watch", status_code=status.HTTP_201_CREATED)
async def watch_variables(request: Request) -> dict[str, Any]:
    """Register variable watch.

    Accepts variable paths with optional scope qualifiers for
    real-time debugging scenarios.

    Args:
        request: HTTP request with variables to watch

    Returns:
        Watch registration with watch_id
    """
    body = await read_json_object(request)

    # Validate required fields
    if "variables" not in body:
        raise ValidationException(_ERR_VARIABLES_REQUIRED)

    result = variable_service.register_watch(body["variables"], body.get("execution_id"))

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.get("/variables/watch/{watch_id}")
async def get_watched_values(watch_id: str, request: Request) -> dict[str, Any]:
    """Get current values for watched variables.

    Args:
        watch_id: Watch UUID
        request: HTTP request for meta info

    Returns:
        Current values for all watched variables
    """
    validate_uuid(watch_id, "watch_id")

    result = variable_service.get_watched_values(watch_id)

    if result is None:
        raise NotFoundException(f"Watch with ID '{watch_id}' not found")

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.delete("/variables/watch/{watch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unwatch_variables(watch_id: str) -> Response:
    """Unregister a variable watch.

    Args:
        watch_id: Watch UUID

    Returns:
        Empty response with 204 status code
    """
    validate_uuid(watch_id, "watch_id")

    deleted = variable_service.unregister_watch(watch_id)

    if not deleted:
        raise NotFoundException(f"Watch with ID '{watch_id}' not found")

    return Response(status_code=status.HTTP_204_NO_CONTENT)
