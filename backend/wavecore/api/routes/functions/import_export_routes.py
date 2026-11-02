"""Function import/export endpoints.

Mirrors the Tests/Suites per-feature pattern. Wire shape:

- POST   /functions/export           single file (1 id) or ZIP (2+ ids)
- GET    /functions/{id}/export       single file
- POST   /functions/import/validate   dry-run, persists nothing
- POST   /functions/import            commit
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Body, File, Form, Query, UploadFile
from fastapi.responses import Response

from wavecore.api.exceptions import ValidationException
from wavecore.api.services import shared as shared_service
from wavecore.api.services.file_tree import content_disposition
from wavecore.api.services.functions import import_export

router = APIRouter(tags=["Functions"], prefix="/functions")


def _content_type(fmt: str) -> str:
    return "application/json" if (fmt or "yaml").lower() == "json" else "application/x-yaml"


@router.post("/export", response_model=None)
async def export_functions(payload: Annotated[dict[str, Any], Body(...)]) -> Response:
    ids = payload.get("ids") or []
    fmt = payload.get("format", "yaml")
    secrets_mode = shared_service.parse_secrets_mode(payload.get("secrets"))
    if not ids:
        message = "ids must be a non-empty list"
        raise ValidationException(message=message, details={"errors": [{"message": message}]})

    results = import_export.export_functions_batch(ids, fmt=fmt, secrets=secrets_mode)
    if len(results) == 1:
        _id, body, filename = results[0]
        return Response(
            content=body,
            media_type=_content_type(fmt),
            headers={"Content-Disposition": content_disposition("attachment", filename)},
        )

    archive = shared_service.build_export_zip([(filename, body) for _id, body, filename in results])
    return Response(
        content=archive,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="functions-export.zip"'},
    )


@router.get("/{function_id}/export", response_model=None)
async def export_function(
    function_id: str,
    fmt: Annotated[str, Query(alias="format")] = "yaml",
    secrets: Annotated[str | None, Query()] = None,
) -> Response:
    secrets_mode = shared_service.parse_secrets_mode(secrets)
    body, filename, content_type = import_export.export_function(
        function_id, fmt=fmt, secrets=secrets_mode
    )
    return Response(
        content=body,
        media_type=content_type,
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )


@router.post("/import/validate", response_model=None)
async def validate_function_import(
    file: Annotated[UploadFile, File(...)],
) -> dict[str, Any]:
    contents = await file.read()
    result = import_export.validate_import(contents, file.filename or "")
    return {"success": True, "data": result}


@router.post("/import", response_model=None)
async def import_function_file(
    file: Annotated[UploadFile, File(...)],
    conflict_resolutions: Annotated[str, Form()] = "",
) -> dict[str, Any]:
    contents = await file.read()
    resolutions: dict[str, str] = {}
    if conflict_resolutions:
        try:
            parsed = json.loads(conflict_resolutions)
        except json.JSONDecodeError as exc:
            message = "Invalid JSON in conflict_resolutions"
            raise ValidationException(
                message=message, details={"errors": [{"message": message}]}
            ) from exc
        resolutions = {str(k): str(v) for k, v in parsed.items()}

    result = import_export.import_functions(contents, file.filename or "", resolutions)
    return {"success": True, "data": result}
