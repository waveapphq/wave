"""Test-scoped Function lifecycle endpoints.

Endpoints:
- POST /tests/{test_id}/functions/publish: Publish a local Function node to the library
- POST /tests/{test_id}/functions/detach: Detach a published Function back into the Test as local

Both endpoints honor If-Match for optimistic concurrency on the owning Test.
"""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Header, Request, Response, status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    UnprocessableEntityException,
    ValidationException,
)
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services.functions.service import SaveValidationError
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.workbench import functions as workbench_functions

router = APIRouter(tags=["Tests"])

_STALE_ETAG_CODE = "STALE_ETAG"


def _generate_etag(test: dict[str, Any]) -> str:
    """Generate ETag for a test (mirrors routes.py implementation)."""
    import hashlib

    content = f"{test.get('id')}{test.get('version')}{test.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


def _stale_etag_response(test_id: str) -> JSONResponse:
    message = f"Test '{test_id}' was modified concurrently; reload and retry"
    return JSONResponse(
        status_code=status.HTTP_412_PRECONDITION_FAILED,
        content={
            "success": False,
            "error": {
                "message": message,
                "code": _STALE_ETAG_CODE,
                "details": [{"message": message}],
            },
        },
    )


def _wave_exception_response(exc: Exception, status_code: int) -> JSONResponse:
    message = getattr(exc, "message", None) or str(exc)
    details = getattr(exc, "details", None) or {"errors": [{"message": message}]}
    error_code = getattr(exc, "error_code", "ERROR")
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "error": {
                "message": message,
                "code": error_code,
                "details": details.get("errors", [{"message": message}]),
            },
        },
    )


def _save_validation_response(exc: SaveValidationError) -> JSONResponse:
    first_message = exc.errors[0]["message"] if exc.errors else str(exc)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "success": False,
            "error": {
                "message": first_message,
                "code": "VALIDATION_ERROR",
                "details": exc.errors,
            },
        },
    )


def _attach_etag(response: Response, test_id: str) -> None:
    updated_test = test_service._load_test(test_id)
    if updated_test is not None:
        response.headers["ETag"] = _generate_etag(updated_test)


def _call_workbench_service(
    op: Callable[[], dict[str, Any]],
) -> dict[str, Any] | JSONResponse:
    """Invoke a workbench-scoped Function service and map exceptions to the
    canonical HTTP envelope. Returns the service result on success or a
    JSONResponse for the matched error class."""
    try:
        return op()
    except NotFoundException as exc:
        return _wave_exception_response(exc, status.HTTP_404_NOT_FOUND)
    except ConflictException as exc:
        return _wave_exception_response(exc, status.HTTP_409_CONFLICT)
    except ValidationException as exc:
        return _wave_exception_response(exc, status.HTTP_400_BAD_REQUEST)
    except UnprocessableEntityException as exc:
        return _wave_exception_response(exc, status.HTTP_422_UNPROCESSABLE_CONTENT)
    except SaveValidationError as exc:
        return _save_validation_response(exc)


def _check_if_match(test_id: str, if_match: str | None) -> JSONResponse | None:
    """Compare If-Match against the test's current ETag; None on success."""
    if not if_match:
        return None
    test = test_service._load_test(test_id)
    if test is None:
        return None
    current_etag = _generate_etag(test)
    if if_match.strip() != current_etag:
        return _stale_etag_response(test_id)
    return None


def _local_publish_payload(body: dict[str, Any]) -> dict[str, Any]:
    """Normalize the from-Local publish payload (carries name + initial version)."""
    return {
        "name": body.get("name", ""),
        "description": body.get("description", "") or "",
        "tags": body.get("tags") or [],
        "changelog": body.get("changelog", "") or "",
        "details": body.get("details", "") or "",
        "version": body.get("version") or "1.0.0",
    }


async def _run_body_node_op(
    test_id: str,
    request: Request,
    response: Response,
    if_match: str | None,
    op: Callable[[str, dict[str, Any]], dict[str, Any]],
) -> dict[str, Any] | JSONResponse:
    """Shared scaffold for the body-carrying node lifecycle routes (publish /
    detach): validate the uuid, honor If-Match, parse the body, run ``op`` with
    ``(node_id, body)``, and attach the refreshed ETag on success."""
    try:
        validate_uuid(test_id, "test_id")
    except (ValueError, ValidationException) as exc:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(exc), "code": "INVALID_PARAMETER"},
            },
        )

    stale = _check_if_match(test_id, if_match)
    if stale is not None:
        return stale

    try:
        body = await read_json_object(request)
    except ValidationException:
        body = {}

    node_id = body.get("node_id", "")
    result = _call_workbench_service(lambda: op(node_id, body))
    if isinstance(result, JSONResponse):
        return result
    _attach_etag(response, test_id)
    return {"success": True, "data": result}


@router.post(
    "/tests/{test_id}/functions/publish",
    status_code=status.HTTP_201_CREATED,
    response_model=None,
)
async def publish_function(
    test_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any] | JSONResponse:
    """Publish a local Function node into the library."""
    return await _run_body_node_op(
        test_id,
        request,
        response,
        if_match,
        lambda node_id, body: workbench_functions.publish_local_function(
            test_id, node_id, _local_publish_payload(body)
        ),
    )


@router.post("/tests/{test_id}/functions/detach", response_model=None)
async def detach_function(
    test_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any] | JSONResponse:
    """Detach a published Function reference back into the Test as a local copy."""
    return await _run_body_node_op(
        test_id,
        request,
        response,
        if_match,
        lambda node_id, _body: workbench_functions.detach_published_instance(test_id, node_id),
    )
