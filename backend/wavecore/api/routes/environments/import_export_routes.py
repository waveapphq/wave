"""Environment import/export endpoints.

This module implements the import and export endpoints for environments,
including single and bulk export, validation, and import with conflict resolution.

Endpoints:
- POST /environments/export: Bulk export environments
- POST /environments/import/validate: Validate import file
- POST /environments/import: Import environments from file
- GET /environments/{environment_id}/export: Export single environment
"""

import json
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import id_list_field, read_json_object, validate_uuid
from wavecore.api.services import shared as shared_service
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.file_tree import content_disposition

# Create router for environment import/export endpoints
router = APIRouter(prefix="/environments", tags=["Environments"])

VALID_EXPORT_FORMATS = {"yaml", "json"}


@router.post("/export")
async def export_environments_bulk(request: Request) -> Response:
    """Export multiple environments as single file or ZIP archive."""
    body = await read_json_object(request)
    env_ids = id_list_field(body, "environment_ids")
    fmt = body.get("format", "yaml")

    if not env_ids:
        raise ValidationException("environment_ids must be a non-empty list")

    if fmt not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{fmt}'. Must be 'yaml' or 'json'")

    results = environment_service.export_environments_batch(env_ids, fmt)

    if len(results) == 1:
        _eid, content, filename = results[0]
        content_type = "application/json" if fmt == "json" else "application/x-yaml"
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={"Content-Disposition": content_disposition("attachment", filename)},
        )

    archive = shared_service.build_export_zip(
        [(filename, content) for _eid, content, filename in results]
    )

    return StreamingResponse(
        iter([archive]),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="environments-export.zip"'},
    )


@router.post("/import/validate")
async def validate_environment_import(
    file: Annotated[UploadFile, File(...)],
) -> Response:
    """Validate a file for environment import without persisting."""
    filename = file.filename or ""
    lower = filename.lower()

    if not lower.endswith((".yaml", ".yml", ".json", ".zip")):
        raise ValidationException(f"Unsupported file format: '{filename}'")

    content = await file.read()
    result = environment_service.validate_environment_import(content, filename)

    return JSONResponse(content={"success": True, "data": result})


@router.post("/import")
async def import_environments(
    file: Annotated[UploadFile, File(...)],
    conflict_resolutions: Annotated[str, Form()] = "",
) -> Response:
    """Import environments from file."""
    filename = file.filename or ""
    lower = filename.lower()

    if not lower.endswith((".yaml", ".yml", ".json", ".zip")):
        raise ValidationException(f"Unsupported file format: '{filename}'")

    content = await file.read()

    resolutions: dict[str, str] = {}
    if conflict_resolutions:
        try:
            resolutions = json.loads(conflict_resolutions)
        except json.JSONDecodeError as err:
            raise ValidationException("Invalid JSON in conflict_resolutions") from err

    result = environment_service.import_environments(content, filename, resolutions)

    return JSONResponse(content={"success": True, "data": result})


@router.get("/{environment_id}/export")
async def export_environment(
    environment_id: str,
    format: Annotated[str, Query(description="Export format (yaml or json)")] = "yaml",
) -> Response:
    """Export a single environment as downloadable file."""
    validate_uuid(environment_id, "environment_id")

    if format not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{format}'. Must be 'yaml' or 'json'")

    result = environment_service.export_environment(environment_id, format)
    if result is None:
        raise NotFoundException(f"Environment not found: {environment_id}")

    content, filename = result
    content_type = "application/json" if format == "json" else "application/x-yaml"

    return StreamingResponse(
        iter([content]),
        media_type=content_type,
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )
