"""Regression import/export endpoints.

This module implements endpoints for importing/exporting regression data.

Endpoints:
- GET /regressions/{regression_id}/export: Export single regression
- POST /regressions/export: Bulk export regressions
- POST /regressions/import/validate: Validate import file
- POST /regressions/import: Import regressions from file
"""

import json
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.shared import read_json_object
from wavecore.api.routes.shared import validate_uuid as _validate_uuid_shared
from wavecore.api.services import shared as shared_service
from wavecore.api.services.file_tree import content_disposition
from wavecore.api.services.regressions import import_export as regression_import_export

# Create router for regression import/export endpoints
router = APIRouter(tags=["Regressions"])

VALID_EXPORT_FORMATS = {"yaml", "json"}


@router.get("/regressions/{regression_id}/export")
async def export_regression(
    regression_id: str,
    format: Annotated[str, Query(description="Export format (yaml or json)")] = "yaml",
    secrets: Annotated[
        str | None,
        Query(description="Secret values handling (mask, encrypted, or plaintext)"),
    ] = None,
) -> Response:
    """Export a single regression as downloadable file."""
    from wavecore.api.exceptions import NotFoundException

    _validate_uuid_shared(regression_id, "regression_id")

    if format not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{format}'. Must be 'yaml' or 'json'")

    secrets_mode = shared_service.parse_secrets_mode(secrets)
    result = regression_import_export.export_regression(regression_id, format, secrets_mode)
    if result is None:
        raise NotFoundException(f"Regression not found: {regression_id}")

    content, filename = result
    content_type = "application/json" if format == "json" else "application/x-yaml"

    return StreamingResponse(
        iter([content]),
        media_type=content_type,
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )


@router.post("/regressions/export")
async def export_regressions_bulk(request: Request) -> Response:
    """Export multiple regressions as single file or ZIP archive."""
    body = await read_json_object(request)
    regression_ids = body.get("regression_ids", [])
    fmt = body.get("format", "yaml")
    secrets_mode = shared_service.parse_secrets_mode(body.get("secrets"))

    if not regression_ids:
        raise ValidationException("regression_ids must be a non-empty list")

    if fmt not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{fmt}'. Must be 'yaml' or 'json'")

    # NotFoundException propagates to middleware if any regression not found
    results = regression_import_export.export_regressions_batch(regression_ids, fmt, secrets_mode)

    if len(results) == 1:
        _rid, content, filename = results[0]
        content_type = "application/json" if fmt == "json" else "application/x-yaml"
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={"Content-Disposition": content_disposition("attachment", filename)},
        )

    archive = shared_service.build_export_zip(
        [(filename, content) for _rid, content, filename in results]
    )

    return StreamingResponse(
        iter([archive]),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="regressions-export.zip"'},
    )


@router.post("/regressions/import/validate")
async def validate_regression_import(
    file: Annotated[UploadFile, File(...)],
) -> Response:
    """Validate a file for regression import without persisting."""
    filename = file.filename or ""
    lower = filename.lower()

    if not lower.endswith((".yaml", ".yml", ".json", ".zip")):
        raise ValidationException(f"Unsupported file format: '{filename}'")

    content = await file.read()

    # ValidationException from service propagates to middleware
    result = regression_import_export.validate_regression_import(content, filename)

    return JSONResponse(
        content={
            "success": True,
            "data": result,
        },
    )


@router.post("/regressions/import")
async def import_regressions(
    file: Annotated[UploadFile, File(...)],
    conflict_resolutions: Annotated[str, Form()] = "",
) -> Response:
    """Import regressions from file."""
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
    result = regression_import_export.import_regressions(content, filename, resolutions)

    return JSONResponse(
        content={
            "success": True,
            "data": result,
        },
    )
