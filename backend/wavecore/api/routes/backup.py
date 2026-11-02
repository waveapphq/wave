"""Backup and restore API endpoints.

Provides endpoints for creating backups, validating and restoring
from backup archives, and managing periodic backup schedules.

Endpoints:
- POST /api/backup/create: Create and download backup ZIP
- POST /api/backup/uploads: Keep an uploaded backup ZIP and answer its upload ID
- DELETE /api/backup/uploads/{upload_id}: Drop a kept backup ZIP
- POST /api/backup/validate: Validate a backup ZIP, uploaded or kept
- POST /api/backup/restore: Restore from a backup ZIP, uploaded or kept
- GET /api/backup/schedule: Get periodic backup schedule
- PUT /api/backup/schedule: Save periodic backup schedule (on or off)
"""

from typing import Annotated, Any

from fastapi import APIRouter, Form, Request, UploadFile, status
from fastapi.responses import JSONResponse, Response

from wavecore.api.routes.executions.shared import _create_success_response
from wavecore.api.services import shared as shared_service
from wavecore.api.services.backup import scheduler as backup_scheduler
from wavecore.api.services.backup import service as backup_service
from wavecore.api.services.backup import uploads as backup_uploads
from wavecore.api.services.file_tree import content_disposition
from wavecore.core.number_rule import wire_number

router = APIRouter(prefix="/api/backup", tags=["Backup"])

_DEFAULT_FILENAME = "backup.zip"


@router.post("/create")
async def create_backup(request: Request) -> Response:
    """Create a backup archive and return it as a download.

    Raises:
        ValidationException: 400 if entity types, format, or secrets mode
            is invalid.
    """
    body = await request.json()

    entity_types = body.get("entity_types", [])
    fmt = body.get("format", "yaml")
    compression_method = body.get("compression_method", "deflate")
    compression_level = body.get("compression_level", 6)
    secrets_mode = shared_service.parse_secrets_mode(body.get("secrets"))

    zip_bytes, filename = backup_service.create_backup(
        entity_types=entity_types,
        fmt=fmt,
        compression_method=compression_method,
        compression_level=compression_level,
        secrets=secrets_mode,
    )

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )


@router.post("/uploads")
async def keep_upload(file: UploadFile) -> JSONResponse:
    """Keep an uploaded backup archive and answer its upload ID."""
    upload_id = backup_uploads.keep(await file.read(), file.filename or _DEFAULT_FILENAME)
    return _create_success_response({"upload_id": upload_id})


@router.delete("/uploads/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
async def drop_upload(upload_id: str) -> Response:
    """Drop a kept backup archive; an unknown upload ID is not an error."""
    backup_uploads.drop(upload_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _archive(file: UploadFile | None, upload_id: str | None) -> tuple[bytes, str]:
    """The archive of a request and its file name: the file sent or the kept upload named."""
    if file is None:
        return backup_uploads.source(None, _DEFAULT_FILENAME, upload_id)
    return backup_uploads.source(await file.read(), file.filename or _DEFAULT_FILENAME, upload_id)


def _restore_options(
    entity_types: str | None, conflict_resolution: str, auto_repair: str
) -> dict[str, Any]:
    """The three restore form fields as the backup service takes them."""
    return {
        "entity_types": [t.strip() for t in entity_types.split(",")] if entity_types else None,
        "conflict_resolution": conflict_resolution,
        "auto_repair": auto_repair.lower() == "true",
    }


@router.post("/validate")
async def validate_backup(
    file: UploadFile | None = None,
    upload_id: Annotated[str | None, Form()] = None,
    entity_types: Annotated[str | None, Form()] = None,
    conflict_resolution: Annotated[str, Form()] = "skip",
    auto_repair: Annotated[str, Form()] = "false",
) -> JSONResponse:
    """Preview the restore of a backup archive, sent as a file or named by upload ID.

    Raises:
        ValidationException: 400 if the archive or a restore option is invalid,
            or the request has both the file and an upload ID, or neither.
        BackupUploadNotFound: 404 if the upload ID is not known.
    """
    content, filename = await _archive(file, upload_id)
    options = _restore_options(entity_types, conflict_resolution, auto_repair)

    result = backup_service.validate_backup(content, filename, **options)
    return _create_success_response(result)


@router.post("/restore")
async def restore_backup(
    file: UploadFile | None = None,
    upload_id: Annotated[str | None, Form()] = None,
    entity_types: Annotated[str | None, Form()] = None,
    conflict_resolution: Annotated[str, Form()] = "skip",
    auto_repair: Annotated[str, Form()] = "false",
) -> JSONResponse:
    """Restore entities from a backup archive, sent as a file or named by upload ID.

    Raises:
        ValidationException: 400 if the archive or a restore option is invalid,
            or the request has both the file and an upload ID, or neither.
        BackupUploadNotFound: 404 if the upload ID is not known.
    """
    content, filename = await _archive(file, upload_id)
    options = _restore_options(entity_types, conflict_resolution, auto_repair)

    result = backup_service.restore_backup(content, filename, **options)
    return _create_success_response(result)


def _schedule_on_the_wire(schedule: dict[str, Any]) -> dict[str, Any]:
    """The schedule as the page reads it: Max backups in its wire form (REQ-3.1.3.14)."""
    return {**schedule, "max_backups": wire_number(schedule["max_backups"])}


@router.get("/schedule")
async def get_schedule() -> JSONResponse:
    """Get the current periodic backup schedule."""
    result = backup_scheduler.get_schedule()
    return _create_success_response(_schedule_on_the_wire(result))


@router.put("/schedule")
async def update_schedule(request: Request) -> JSONResponse:
    """Update the periodic backup schedule.

    Raises:
        ValidationException: 400 if schedule configuration is invalid.
    """
    body = await request.json()

    result = backup_scheduler.update_schedule(body)

    # Restart scheduler with new config
    await backup_scheduler.start_scheduler()

    return _create_success_response(_schedule_on_the_wire(result))
