"""Function CRUD, dependents, and batch endpoints.

Error messages emitted by this module are anchored: backend tests assert on
them with `re.match(r"^...$", actual)`.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Query, Response, status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.shared import list_field
from wavecore.api.services.functions import _storage as function_storage
from wavecore.api.services.functions import _versioning as function_versioning
from wavecore.api.services.functions import service as function_service
from wavecore.api.services.functions.service import SaveValidationError

router = APIRouter(tags=["Functions"], prefix="/functions")


def _save_validation_response(error: SaveValidationError) -> JSONResponse:
    """Return the 422 envelope for save-validation failures."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "success": False,
            "error": {
                "message": f"Function has {len(error.errors)} validation error(s)",
                "code": "VALIDATION_ERROR",
                "details": error.errors,
            },
        },
    )


def _validate_pagination(page: int, per_page: int) -> None:
    if page < 1:
        message = "Invalid page parameter; must be a positive integer"
        raise ValidationException(
            message=message,
            details={"errors": [{"message": message}]},
        )
    if per_page < 1 or per_page > 100:
        message = "Invalid per_page parameter; must be between 1 and 100"
        raise ValidationException(
            message=message,
            details={"errors": [{"message": message}]},
        )


@router.get("", response_model=None)
async def list_functions(
    page: Annotated[int, Query()] = 1,
    per_page: Annotated[int, Query()] = 50,
    search: Annotated[str, Query()] = "",
    tags: Annotated[str, Query()] = "",
    sort_by: Annotated[str | None, Query()] = None,
    sort_order: Annotated[str | None, Query()] = "asc",
) -> dict[str, Any]:
    _validate_pagination(page, per_page)
    tag_list = [t for t in tags.split(",") if t] if tags else []
    result = function_service.list_functions(
        page=page,
        per_page=per_page,
        search=search,
        tags=tag_list,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    return {
        "success": True,
        "data": result["data"],
        "pagination": result["pagination"],
    }


# ---------------------------------------------------------------------------
# Batch endpoints (declared BEFORE /{function_id} so /batch is not treated
# as an id by the path router).
# ---------------------------------------------------------------------------


@router.post("/batch", response_model=None)
async def batch_create_functions(
    payload: Annotated[dict[str, Any], Body(...)],
) -> dict[str, Any]:
    items = list_field(payload, "items", "'items' must be a list")
    result = function_service.batch_create_functions(items)
    return {"success": True, "data": result}


@router.delete("/batch", response_model=None)
async def batch_delete_functions(
    payload: Annotated[dict[str, Any], Body(...)],
) -> dict[str, Any]:
    # Each item that is not an ID string fails on its own, so only the list shape is refused here
    ids = list_field(payload, "ids", "'ids' must be a list of ID strings")
    cascade = bool(payload.get("cascade", False))
    result = function_service.batch_delete_functions(ids, cascade=cascade)
    return {"success": True, "data": result}


# ---------------------------------------------------------------------------
# Tags - listed under `/functions/tags` BEFORE `/functions/{id}` so the path
# router doesn't treat "tags" as an id.
# ---------------------------------------------------------------------------


@router.get("/tags", response_model=None)
async def list_function_tags(response: Response) -> dict[str, Any]:
    """Return every unique tag across all Published Functions, sorted A-Z."""
    response.headers["Cache-Control"] = "max-age=60"
    return {"success": True, "data": function_service.list_all_tags()}


# ---------------------------------------------------------------------------
# Single-item CRUD
# ---------------------------------------------------------------------------


def _not_found_response(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={
            "success": False,
            "error": {
                "message": message,
                "code": "NOT_FOUND",
                "details": [{"message": message}],
            },
        },
    )


def _malformed_draft_response(reason: str) -> JSONResponse:
    message = f"Draft definition is malformed: {reason}"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "success": False,
            "error": {
                "message": message,
                "code": "VALIDATION_ERROR",
                "details": [{"message": message}],
            },
        },
    )


@router.get("/{function_id}", response_model=None)
async def get_function(
    function_id: str,
    response: Response,
    version: Annotated[str | None, Query()] = None,
) -> Any:
    """Fetch a Function. With ``?version=`` returns the specific version."""
    if version is not None and version != "":
        try:
            definition, etag = function_service.read_version(function_id, version)
        except LookupError as exc:
            return _not_found_response(str(exc))
        response.headers["ETag"] = etag
        return {"success": True, "data": definition}
    # NotFoundException is propagated through ExceptionHandler middleware;
    # any other exception surfaces via the default envelope.
    definition, etag = function_service.get_function(function_id)
    response.headers["ETag"] = etag
    return {"success": True, "data": definition}


@router.get("/{function_id}/versions", response_model=None)
async def list_function_versions(function_id: str) -> Any:
    """Return ``{versions, latest}`` for a Function."""
    try:
        result = function_storage.list_versions(function_id)
    except LookupError:
        return _not_found_response(f"Function '{function_id}' not found")
    return {"success": True, "data": result}


@router.post("/{function_id}/versions", status_code=status.HTTP_201_CREATED, response_model=None)
async def add_function_version(
    function_id: str,
    payload: Annotated[dict[str, Any], Body(...)],
) -> Any:
    """Write a new immutable library version from a client-supplied draft.

    Test-independent edit-mode publish path: no owning Test, no node to compare
    against. Malformed-draft checks run here (mirroring POST /validate-bumps);
    the service raises the 404/409/422 business errors.
    """
    draft = payload.get("draft_definition")
    source_version = payload.get("source_version")
    if not isinstance(draft, dict):
        return _malformed_draft_response("draft_definition is required and must be a dict")
    if not isinstance(source_version, str) or not source_version:
        return _malformed_draft_response("source_version is required and must be a string")
    try:
        result = function_service.add_function_version(
            function_id,
            source_version=source_version,
            target_version=payload.get("target_version", "") or "",
            draft_definition=draft,
            changelog=payload.get("changelog", "") or "",
            description=payload.get("description", "") or "",
            tags=payload.get("tags") or [],
            details=payload.get("details", "") or "",
        )
    except SaveValidationError as exc:
        return _save_validation_response(exc)
    return {"success": True, "data": result}


@router.get("/{function_id}/versions/{version}", response_model=None)
async def get_function_version(function_id: str, version: str, response: Response) -> Any:
    """Return ``{definition, etag}`` for a specific version."""
    try:
        definition, etag = function_service.read_version(function_id, version)
    except LookupError as exc:
        return _not_found_response(str(exc))
    response.headers["ETag"] = etag
    return {"success": True, "data": {"definition": definition, "etag": etag}}


@router.delete("/{function_id}/versions/{version}", response_model=None)
async def delete_function_version(function_id: str, version: str) -> Response:
    """Remove a single published version; never blocked by usage."""
    function_service.delete_function_version(function_id, version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{function_id}/validate-bumps", response_model=None)
async def validate_function_bumps(
    function_id: str,
    payload: Annotated[dict[str, Any], Body(...)],
) -> Any:
    """Compute allowed bump levels for a draft against a source version."""
    draft = payload.get("draft_definition")
    source_version = payload.get("source_version")
    if not isinstance(draft, dict):
        return _malformed_draft_response("draft_definition is required and must be a dict")
    if not isinstance(source_version, str) or not source_version:
        return _malformed_draft_response("source_version is required and must be a string")
    try:
        source_def = function_storage.load_version(function_id, source_version)
    except LookupError as exc:
        return _not_found_response(str(exc))
    draft = function_service.draft_over_source(draft, source_def)
    result = function_versioning.compute_allowed_bumps(source_def, draft)
    return {
        "success": True,
        "data": {
            "allowed": sorted(result["allowed"]),
            "blocked": result["blocked"],
        },
    }


@router.post("", status_code=status.HTTP_201_CREATED, response_model=None)
async def create_function(
    response: Response,
    payload: Annotated[dict[str, Any], Body(...)],
) -> Any:
    try:
        definition, etag = function_service.create_function(payload)
    except SaveValidationError as exc:
        return _save_validation_response(exc)
    response.headers["ETag"] = etag
    return {"success": True, "data": definition}


@router.delete("/{function_id}", response_model=None)
async def delete_function(
    function_id: str,
    cascade: Annotated[bool, Query()] = False,
) -> Any:
    result = function_service.delete_function(function_id, cascade=cascade)
    if cascade and result.get("cascaded"):
        return {"success": True, "data": result}
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{function_id}/dependents/by-version", response_model=None)
async def get_function_dependents_by_version(function_id: str) -> dict[str, Any]:
    """Per-version dependents in a single pass: ``{version: {tests, functions}}``."""
    result = function_service.get_dependents_by_version(function_id)
    return {"success": True, "data": result}


@router.get("/{function_id}/dependents", response_model=None)
async def get_function_dependents(
    function_id: str,
    version: Annotated[str | None, Query()] = None,
) -> dict[str, Any]:
    """Tests + Functions that reference this Function; ``?version=`` scopes to a pin."""
    result = function_service.get_function_dependents(function_id, version or None)
    return {"success": True, "data": result}
