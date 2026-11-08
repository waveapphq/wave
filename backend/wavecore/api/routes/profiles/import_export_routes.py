"""Profile import/export endpoints.

This module implements the import and export endpoints for connection profiles,
including single and bulk export, validation, and import with conflict resolution.

Endpoints:
- POST /profiles/export: Bulk export profiles
- POST /profiles/import/validate: Validate import file
- POST /profiles/import: Import profiles from file
- GET /profiles/{profile_id}/export: Export single profile
"""

import io
import json
import zipfile
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services import shared as shared_service
from wavecore.api.services.file_tree import content_disposition
from wavecore.api.services.profiles import import_export as profile_import_export

# Create router for profile import/export endpoints
router = APIRouter(tags=["Profiles"])

VALID_EXPORT_FORMATS = {"yaml", "json"}


@router.post("/profiles/export")
async def export_profiles_bulk(request: Request) -> Response:
    """Export multiple profiles as single file or ZIP archive."""
    body = await read_json_object(request)
    profile_ids = body.get("profile_ids", [])
    fmt = body.get("format", "yaml")
    secrets_mode = shared_service.parse_secrets_mode(body.get("secrets"))

    if not profile_ids:
        raise ValidationException("profile_ids must be a non-empty list")

    if fmt not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{fmt}'. Must be 'yaml' or 'json'")

    # NotFoundException propagates to middleware if any profile not found
    results = profile_import_export.export_profiles_batch(profile_ids, fmt, secrets_mode)

    if len(results) == 1:
        _pid, content, filename = results[0]
        content_type = "application/json" if fmt == "json" else "application/x-yaml"
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={"Content-Disposition": content_disposition("attachment", filename)},
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for _pid, content, filename in results:
            zf.writestr(filename, content)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="profiles-export.zip"'},
    )


@router.post("/profiles/import/validate")
async def validate_profile_import(
    file: Annotated[UploadFile, File(...)],
) -> Response:
    """Validate a file for profile import without persisting."""
    filename = file.filename or ""
    lower = filename.lower()

    if not lower.endswith((".yaml", ".yml", ".json", ".zip")):
        raise ValidationException(f"Unsupported file format: '{filename}'")

    content = await file.read()

    # ValidationException from service propagates to middleware
    result = profile_import_export.validate_profile_import(content, filename)

    return JSONResponse(
        content={
            "success": True,
            "data": result,
        },
    )


@router.post("/profiles/import")
async def import_profiles(
    file: Annotated[UploadFile, File(...)],
    conflict_resolutions: Annotated[str, Form()] = "",
) -> Response:
    """Import profiles from file."""
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
    result = profile_import_export.import_profiles(content, filename, resolutions)

    return JSONResponse(
        content={
            "success": True,
            "data": result,
        },
    )


@router.get("/profiles/{profile_id}/export")
async def export_profile(
    profile_id: str,
    format: Annotated[str, Query(description="Export format (yaml or json)")] = "yaml",
    secrets: Annotated[
        str | None,
        Query(description="Secret values handling (mask, encrypted, or plaintext)"),
    ] = None,
) -> Response:
    """Export a single profile as downloadable file."""
    validate_uuid(profile_id, "profile_id")

    if format not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{format}'. Must be 'yaml' or 'json'")

    secrets_mode = shared_service.parse_secrets_mode(secrets)
    result = profile_import_export.export_profile(profile_id, format, secrets_mode)
    if result is None:
        raise NotFoundException(f"Profile not found: {profile_id}")

    content, filename = result
    content_type = "application/json" if format == "json" else "application/x-yaml"

    return StreamingResponse(
        iter([content]),
        media_type=content_type,
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )
