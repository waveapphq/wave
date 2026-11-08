"""Test import/export endpoints (REQ-5.2.4.9).

This module implements test import and export endpoints for single and bulk
test data transfer in YAML, JSON, and ZIP formats.

Endpoints:
- POST /tests/export: Export multiple tests as single file or ZIP archive
- POST /tests/import/validate: Validate a file for import without persisting
- POST /tests/import: Import tests from file
- GET /tests/{test_id}/export: Export a single test as downloadable file
"""

import json
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services import shared as shared_service
from wavecore.api.services.file_tree import content_disposition
from wavecore.api.services.tests import service as test_service

# Create router for test import/export endpoints
router = APIRouter(tags=["Tests"])

VALID_EXPORT_FORMATS = {"yaml", "json"}


@router.post("/tests/export")
async def export_tests_bulk(request: Request) -> Response:
    """Export multiple tests as single file or ZIP archive.

    Args:
        request: HTTP request with test_ids, format, secrets

    Returns:
        File download: the document for one test without files, a ZIP otherwise
    """
    body = await read_json_object(request)
    test_ids = body.get("test_ids", [])
    fmt = body.get("format", "yaml")
    secrets_mode = shared_service.parse_secrets_mode(body.get("secrets"))

    if not test_ids:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {
                    "message": "test_ids must be a non-empty list",
                    "code": "INVALID_PARAMETER",
                },
            },
        )

    if fmt not in VALID_EXPORT_FORMATS:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {
                    "message": f"Invalid format: '{fmt}'. Must be 'yaml' or 'json'",
                    "code": "INVALID_PARAMETER",
                },
            },
        )

    try:
        documents, files = test_service.export_tests_batch(test_ids, fmt, secrets_mode)
    except (ValueError, ValidationException) as exc:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "success": False,
                "error": {"message": str(exc), "code": "NOT_FOUND"},
            },
        )

    if len(documents) == 1 and not files:
        _tid, content, filename = documents[0]
        return StreamingResponse(
            iter([content]),
            media_type=test_service.document_media_type(fmt),
            headers={"Content-Disposition": content_disposition("attachment", filename)},
        )

    # One selected test with files keeps its stem; several tests share one archive
    entries: list[tuple[str, shared_service.ZipContent]] = [
        (filename, content) for _tid, content, filename in documents
    ]
    entries.extend((test_service.testdata_member_name(tid, rel), path) for tid, rel, path in files)
    archive = shared_service.build_export_zip(entries)
    archive_name = (
        f"{documents[0][2].rsplit('.', 1)[0]}.zip" if len(documents) == 1 else "tests-export.zip"
    )

    return StreamingResponse(
        iter([archive]),
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition("attachment", archive_name)},
    )


@router.post("/tests/import/validate")
async def validate_import(
    file: Annotated[UploadFile, File(...)],
) -> Response:
    """Validate a file for import without persisting.

    Args:
        file: Uploaded file (.yaml, .json, or .zip)

    Returns:
        Validation results per test
    """
    filename = file.filename or ""
    lower = filename.lower()

    if not lower.endswith((".yaml", ".yml", ".json", ".zip")):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {
                    "message": f"Unsupported file format: '{filename}'",
                    "code": "INVALID_FORMAT",
                },
            },
        )

    content = await file.read()

    try:
        result = test_service.validate_test_import(content, filename)
    except (ValueError, ValidationException) as exc:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(exc), "code": "PARSE_ERROR"},
            },
        )

    return JSONResponse(
        content={
            "success": True,
            "data": result,
        },
    )


@router.post("/tests/import")
async def import_tests(
    file: Annotated[UploadFile, File(...)],
    conflict_resolutions: Annotated[str, Form()] = "",
) -> Response:
    """Import tests from file.

    Args:
        file: Uploaded file (.yaml, .json, or .zip)
        conflict_resolutions: JSON string mapping test names to resolution

    Returns:
        Import results
    """
    filename = file.filename or ""
    lower = filename.lower()

    if not lower.endswith((".yaml", ".yml", ".json", ".zip")):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {
                    "message": f"Unsupported file format: '{filename}'",
                    "code": "INVALID_FORMAT",
                },
            },
        )

    content = await file.read()

    resolutions: dict[str, str] = {}
    if conflict_resolutions:
        try:
            resolutions = json.loads(conflict_resolutions)
        except json.JSONDecodeError:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "error": {
                        "message": "Invalid JSON in conflict_resolutions",
                        "code": "PARSE_ERROR",
                    },
                },
            )

    try:
        result = test_service.import_tests(content, filename, resolutions)
    except test_service.ReadOnlyExpressionImportError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "success": False,
                "error": {
                    "message": exc.message,
                    "code": "EXPRESSION_CHANGES_DATA",
                    "details": exc.errors,
                },
            },
        )
    except test_service.VariableValueImportError as exc:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": exc.message, "code": "INVALID_VARIABLE_VALUE"},
            },
        )
    except (ValueError, ValidationException) as exc:
        error_msg = str(exc)
        if "Fatal" in error_msg:
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                content={
                    "success": False,
                    "error": {"message": error_msg, "code": "FATAL_VALIDATION"},
                },
            )
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": error_msg, "code": "PARSE_ERROR"},
            },
        )

    return JSONResponse(
        content={
            "success": True,
            "data": result,
        },
    )


@router.get("/tests/{test_id}/export")
async def export_test(
    test_id: str,
    format: Annotated[str, Query(description="Export format (yaml or json)")] = "yaml",
    secrets: Annotated[
        str | None,
        Query(description="Secret values handling (mask, encrypted, or plaintext)"),
    ] = None,
) -> Response:
    """Export a single test as downloadable file.

    Args:
        test_id: Test UUID
        format: Export format (yaml or json)
        secrets: Secret values handling (mask, encrypted, or plaintext)

    Returns:
        File download with appropriate content-type
    """
    try:
        validate_uuid(test_id)
    except (ValueError, ValidationException) as exc:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(exc), "code": "INVALID_UUID"},
            },
        )

    if format not in VALID_EXPORT_FORMATS:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {
                    "message": f"Invalid format: '{format}'. Must be 'yaml' or 'json'",
                    "code": "INVALID_PARAMETER",
                },
            },
        )

    secrets_mode = shared_service.parse_secrets_mode(secrets)
    result = test_service.export_test(test_id, format, secrets_mode)
    if result is None:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "success": False,
                "error": {"message": f"Test not found: {test_id}", "code": "NOT_FOUND"},
            },
        )

    content_val, filename, media_type = result

    return StreamingResponse(
        iter([content_val]),
        media_type=media_type,
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )
