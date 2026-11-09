"""Variable management endpoints (REQ-5.2.4.7).

This module implements variable scope, system variable, and entity variable endpoints
providing unified access to the hierarchical variable system.

Endpoints:
- GET /variables/scopes: List variable scopes
- GET /variables/system: Get system variables (auto-init)
- POST /variables/system: Set system variables (replace)
- DELETE /variables/system: Delete all system variables
- GET /variables/system/export: Export system variables as file download
- POST /variables/system/import/validate: Validate import file
- POST /variables/system/import: Import system variables from file
- DELETE /variables/system/{name}: Delete single system variable
- GET /variables/{scope}/{entity_id}: Get variables for entity
- POST /variables/{scope}/{entity_id}: Set variables (replace entire collection)
- PATCH /variables/{scope}/{entity_id}: Update variables (merge semantics)
- DELETE /variables/{scope}/{entity_id}/{name}: Delete variable
"""

import json
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import build_response_meta, read_json_object, validate_uuid
from wavecore.api.services import shared as shared_service
from wavecore.api.services import variable_service
from wavecore.api.services.file_tree import content_disposition

_ERR_VARIABLES_REQUIRED = "Field 'variables' is required"

# Create router for variable endpoints
router = APIRouter(tags=["Variables"])

# Valid scopes for validation messages
VALID_SCOPES = ["system", "regression", "suite", "test"]

VALID_EXPORT_FORMATS = {"yaml", "json"}

IMPORTABLE_EXTENSIONS = (".yaml", ".yml", ".json", ".zip")


def validate_scope(scope: str) -> None:
    """Validate scope identifier.

    Args:
        scope: Scope to validate

    Raises:
        ValueError: If scope is invalid
    """
    if scope not in VALID_SCOPES:
        raise ValidationException(
            f"Invalid scope '{scope}': valid scopes are {', '.join(VALID_SCOPES)}"
        )


# =============================================================================
# Static/specific routes MUST come BEFORE parameterized routes
# FastAPI matches routes in order of definition
# =============================================================================


@router.get("/variables/scopes")
async def list_variable_scopes(request: Request, response: Response) -> dict[str, Any]:
    """List available variable scopes.

    Returns ordered list of scopes from broadest to narrowest:
    system, regression, suite, test, block.

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        List of scopes with metadata
    """
    result = variable_service.list_scopes()

    # Scope list is static, set long cache
    response.headers["Cache-Control"] = "max-age=3600"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


# =============================================================================
# Dedicated system variable routes (no entity_id in URL)
# =============================================================================


@router.get("/variables/system")
async def get_system_variables(request: Request, response: Response) -> dict[str, Any]:
    """Get system variables (auto-initializes to empty set).

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        System variables with metadata
    """
    result = variable_service.get_system_variables()
    response.headers["Cache-Control"] = "max-age=60"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.post("/variables/system")
async def set_system_variables(request: Request, response: Response) -> dict[str, Any]:
    """Set system variables (replace entire collection).

    Args:
        request: HTTP request with variables data
        response: HTTP response for setting headers

    Returns:
        Set variables with metadata
    """
    body = await read_json_object(request)

    if "variables" not in body:
        raise ValidationException(_ERR_VARIABLES_REQUIRED)

    result = variable_service.set_system_variables(body["variables"])
    response.headers["X-Cache-Invalidated"] = "variables_system"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.delete("/variables/system", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_system_variables(response: Response) -> Response:
    """Delete all system variables.

    Args:
        response: HTTP response for setting headers

    Returns:
        Empty response with 204 status code
    """
    variable_service.delete_all_system_variables()
    response.headers["X-Cache-Invalidated"] = "variables_system"
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/variables/system/export")
async def export_system_variables(
    format: Annotated[str, Query(description="Export format (yaml or json)")] = "yaml",
    secrets: Annotated[
        str | None,
        Query(description="Secret values handling (mask, encrypted, or plaintext)"),
    ] = None,
) -> Response:
    """Export the system variables collection as a downloadable file.

    Args:
        format: Output format, one of ``yaml`` or ``json``.
        secrets: Secret values handling (mask, encrypted, or plaintext).

    Returns:
        File download with ``Content-Disposition: attachment``.
    """
    if format not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{format}'. Must be 'yaml' or 'json'")

    secrets_mode = shared_service.parse_secrets_mode(secrets)
    payload, filename, content_type = variable_service.export_system_variables(format, secrets_mode)

    return StreamingResponse(
        iter([payload]),
        media_type=content_type,
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )


@router.post("/variables/system/import/validate")
async def validate_system_variables_import(
    file: Annotated[UploadFile, File(...)],
) -> Response:
    """Validate a file for system variable import without persisting.

    Args:
        file: Uploaded file (.yaml, .yml, .json, or .zip).

    Returns:
        Validation results per variable.
    """
    filename = file.filename or ""

    if not filename.lower().endswith(IMPORTABLE_EXTENSIONS):
        raise ValidationException(f"Unsupported file format: '{filename}'")

    content = await file.read()
    result = variable_service.validate_system_variables_import(content, filename)

    return JSONResponse(content={"success": True, "data": result})


@router.post("/variables/system/import")
async def import_system_variables(
    file: Annotated[UploadFile, File(...)],
    conflict_resolutions: Annotated[str, Form()] = "",
) -> Response:
    """Import system variables from an uploaded file.

    Args:
        file: Uploaded file (.yaml, .yml, .json, or .zip).
        conflict_resolutions: JSON map of variable name to resolution
            (``overwrite`` or ``skip``).

    Returns:
        Import results with imported/skipped details.
    """
    filename = file.filename or ""

    if not filename.lower().endswith(IMPORTABLE_EXTENSIONS):
        raise ValidationException(f"Unsupported file format: '{filename}'")

    content = await file.read()

    resolutions: dict[str, str] = {}
    if conflict_resolutions:
        try:
            resolutions = json.loads(conflict_resolutions)
        except json.JSONDecodeError as err:
            raise ValidationException("Invalid JSON in conflict_resolutions") from err

    result = variable_service.import_system_variables(content, filename, resolutions)

    return JSONResponse(content={"success": True, "data": result})


@router.delete("/variables/system/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system_variable(name: str, response: Response) -> Response:
    """Delete a single system variable.

    Args:
        name: Variable name to delete
        response: HTTP response for setting headers

    Returns:
        Empty response with 204 status code
    """
    deleted = variable_service.delete_system_variable(name)

    if not deleted:
        raise NotFoundException(f"Variable '{name}' not found")

    response.headers["X-Cache-Invalidated"] = "variables_system"
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =============================================================================
# Parameterized routes (these match anything, so must come AFTER specific routes)
# =============================================================================


@router.get("/variables/{scope}/{entity_id}")
async def get_entity_variables(
    scope: str, entity_id: str, request: Request, response: Response
) -> dict[str, Any]:
    """Get variables for an entity.

    Args:
        scope: Variable scope (system, regression, suite, test, block)
        entity_id: Entity UUID
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        Entity variables with metadata
    """
    validate_scope(scope)
    validate_uuid(entity_id, "entity_id")

    result = variable_service.get_entity_variables(scope, entity_id)

    if result is None:
        raise NotFoundException(f"Entity with ID '{entity_id}' not found in scope '{scope}'")

    # Set cache header
    response.headers["Cache-Control"] = "max-age=60"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.post("/variables/{scope}/{entity_id}")
async def set_entity_variables(
    scope: str, entity_id: str, request: Request, response: Response
) -> dict[str, Any]:
    """Set variables for an entity (replace entire collection).

    Args:
        scope: Variable scope
        entity_id: Entity UUID
        request: HTTP request with variables data
        response: HTTP response for setting headers

    Returns:
        Set variables with metadata
    """
    validate_scope(scope)
    validate_uuid(entity_id, "entity_id")

    body = await read_json_object(request)

    # Validate required fields
    if "variables" not in body:
        raise ValidationException(_ERR_VARIABLES_REQUIRED)

    result = variable_service.set_entity_variables(scope, entity_id, body["variables"])

    # Set cache invalidation header
    response.headers["X-Cache-Invalidated"] = f"variables_{scope}_{entity_id}"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.patch("/variables/{scope}/{entity_id}")
async def update_entity_variables(
    scope: str, entity_id: str, request: Request, response: Response
) -> dict[str, Any]:
    """Update variables for an entity (merge semantics).

    Args:
        scope: Variable scope
        entity_id: Entity UUID
        request: HTTP request with variables to update/add
        response: HTTP response for setting headers

    Returns:
        Updated variables with metadata
    """
    validate_scope(scope)
    validate_uuid(entity_id, "entity_id")

    body = await read_json_object(request)

    # Validate required fields
    if "variables" not in body:
        raise ValidationException(_ERR_VARIABLES_REQUIRED)

    result = variable_service.update_entity_variables(scope, entity_id, body["variables"])

    if result is None:
        raise NotFoundException(f"Entity with ID '{entity_id}' not found in scope '{scope}'")

    # Set cache invalidation header
    response.headers["X-Cache-Invalidated"] = f"variables_{scope}_{entity_id}"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.delete("/variables/{scope}/{entity_id}/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_variable(scope: str, entity_id: str, name: str, response: Response) -> Response:
    """Delete a variable from an entity.

    Args:
        scope: Variable scope
        entity_id: Entity UUID
        name: Variable name to delete
        response: HTTP response for setting headers

    Returns:
        Empty response with 204 status code
    """
    validate_scope(scope)
    validate_uuid(entity_id, "entity_id")

    # NotFoundException propagates from service if entity not found
    deleted = variable_service.delete_variable(scope, entity_id, name)

    if not deleted:
        raise NotFoundException(f"Variable '{name}' not found")

    # Set cache invalidation header
    response.headers["X-Cache-Invalidated"] = f"variables_{scope}_{entity_id}"

    return Response(status_code=status.HTTP_204_NO_CONTENT)
