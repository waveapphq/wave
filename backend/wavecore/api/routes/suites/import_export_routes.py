"""Suite import/export endpoints.

This module implements the import and export endpoints for suites,
including single and bulk export, validation, and import with conflict resolution.

Endpoints:
- POST /suites/export: Bulk export suites
- POST /suites/import/validate: Validate import file
- POST /suites/import: Import suites from file
- GET /suites/{suite_id}/export: Export single suite
"""

import json
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services import shared as shared_service
from wavecore.api.services.file_tree import content_disposition
from wavecore.api.services.suites import import_export as suite_import_export

# Create router for suite import/export endpoints
router = APIRouter(tags=["Suites"])

VALID_EXPORT_FORMATS = {"yaml", "json"}


@router.post("/suites/export")
async def export_suites_bulk(request: Request) -> Response:
    """Export multiple suites as single file or ZIP archive."""
    body = await read_json_object(request)
    suite_ids = body.get("suite_ids", [])
    fmt = body.get("format", "yaml")
    secrets_mode = shared_service.parse_secrets_mode(body.get("secrets"))

    if not suite_ids:
        raise ValidationException("suite_ids must be a non-empty list")

    if fmt not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{fmt}'. Must be 'yaml' or 'json'")

    # NotFoundException propagates to middleware if any suite not found
    results = suite_import_export.export_suites_batch(suite_ids, fmt, secrets_mode)

    if len(results) == 1:
        _sid, content, filename = results[0]
        content_type = "application/json" if fmt == "json" else "application/x-yaml"
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={"Content-Disposition": content_disposition("attachment", filename)},
        )

    archive = shared_service.build_export_zip(
        [(filename, content) for _sid, content, filename in results]
    )

    return StreamingResponse(
        iter([archive]),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="suites-export.zip"'},
    )


@router.post("/suites/import/validate")
async def validate_suite_import(
    file: Annotated[UploadFile, File(...)],
) -> Response:
    """Validate a file for suite import without persisting."""
    filename = file.filename or ""
    lower = filename.lower()

    if not lower.endswith((".yaml", ".yml", ".json", ".zip")):
        raise ValidationException(f"Unsupported file format: '{filename}'")

    content = await file.read()

    # ValidationException from service propagates to middleware
    result = suite_import_export.validate_suite_import(content, filename)

    return JSONResponse(
        content={
            "success": True,
            "data": result,
        },
    )


@router.post("/suites/import")
async def import_suites(
    file: Annotated[UploadFile, File(...)],
    conflict_resolutions: Annotated[str, Form()] = "",
) -> Response:
    """Import suites from file."""
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

    # ValidationException from service propagates to middleware
    result = suite_import_export.import_suites(content, filename, resolutions)

    return JSONResponse(
        content={
            "success": True,
            "data": result,
        },
    )


@router.get("/suites/{suite_id}/export")
async def export_suite(
    suite_id: str,
    format: Annotated[str, Query(description="Export format (yaml or json)")] = "yaml",
    secrets: Annotated[
        str | None,
        Query(description="Secret values handling (mask, encrypted, or plaintext)"),
    ] = None,
) -> Response:
    """Export a single suite as downloadable file."""
    from wavecore.api.exceptions import NotFoundException

    validate_uuid(suite_id, "suite_id")

    if format not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{format}'. Must be 'yaml' or 'json'")

    secrets_mode = shared_service.parse_secrets_mode(secrets)
    result = suite_import_export.export_suite(suite_id, format, secrets_mode)
    if result is None:
        raise NotFoundException(f"Suite not found: {suite_id}")

    content, filename = result
    content_type = "application/json" if format == "json" else "application/x-yaml"

    return StreamingResponse(
        iter([content]),
        media_type=content_type,
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )
