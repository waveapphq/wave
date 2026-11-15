"""Test-scoped Function lifecycle endpoints.

Endpoints:
- POST /tests/{test_id}/functions/publish: Publish a local Function node to the library
- POST /tests/{test_id}/functions/detach: Detach a published Function back into the Test as local

Both endpoints honor If-Match for optimistic concurrency on the owning Test.
"""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Header, Request, Response, status

from wavecore.api.exceptions import PreconditionRequiredException, ValidationException
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.workbench import functions as workbench_functions

router = APIRouter(tags=["Tests"])


def _attach_etag(response: Response, test_id: str) -> None:
    updated_test = test_service._load_test(test_id)
    if updated_test is not None:
        response.headers["ETag"] = test_service._generate_etag(updated_test)


def _check_if_match(test_id: str, if_match: str | None) -> None:
    """Refuse an If-Match that no longer names the test's current ETag."""
    if not if_match:
        return
    test = test_service._load_test(test_id)
    if test is not None and if_match.strip() != test_service._generate_etag(test):
        raise PreconditionRequiredException(
            f"Test '{test_id}' was modified concurrently; reload and retry"
        )


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
) -> dict[str, Any]:
    """Shared scaffold for the body-carrying node lifecycle routes (publish /
    detach): validate the uuid, honor If-Match, parse the body, run ``op`` with
    ``(node_id, body)``, and attach the refreshed ETag on success."""
    validate_uuid(test_id, "test_id")
    _check_if_match(test_id, if_match)

    try:
        body = await read_json_object(request)
    except ValidationException:
        body = {}

    # The service's typed refusals propagate to the error handler
    result = op(body.get("node_id", ""), body)
    _attach_etag(response, test_id)
    return {"success": True, "data": result}


@router.post(
    "/tests/{test_id}/functions/publish",
    status_code=status.HTTP_201_CREATED,
)
async def publish_function(
    test_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Publish a local Function node into the library; the answer lists what the save removed."""
    repairs: list[dict[str, Any]] = []
    answer = await _run_body_node_op(
        test_id,
        request,
        response,
        if_match,
        lambda node_id, body: workbench_functions.publish_local_function(
            test_id, node_id, _local_publish_payload(body), repairs=repairs
        ),
    )
    return {**answer, "repairs": repairs}


@router.post("/tests/{test_id}/functions/detach")
async def detach_function(
    test_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Detach a published Function reference back into the Test as a local copy."""
    return await _run_body_node_op(
        test_id,
        request,
        response,
        if_match,
        lambda node_id, _body: workbench_functions.detach_published_instance(test_id, node_id),
    )
