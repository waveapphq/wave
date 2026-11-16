"""Regression composition and lifecycle endpoints.

This module implements regression composition endpoints for managing suite
membership and cloning.

Endpoints:
- GET /regressions/{regression_id}/suites: Get suites in regression
- POST /regressions/{regression_id}/clone: Clone regression
"""

from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi import status as http_status

from wavecore.api.routes.regressions.routes import (
    regression_not_found,
    validate_regression_name,
)
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.regressions import version_service as _reg_version_svc

# Create router for regression composition endpoints
router = APIRouter(tags=["Regressions"])


@router.get("/regressions/{regression_id}/suites", response_model=None)
async def get_regression_suites(regression_id: str) -> dict[str, Any]:
    """Get suites belonging to a regression with their tests.

    Returns suites either from the regression's suites array or from suites
    with parent_regression metadata matching this regression's name.

    Args:
        regression_id: Regression UUID

    Returns:
        List of suites with their tests
    """
    validate_uuid(regression_id, "regression_id")

    result = regression_service.get_regression_suites_with_tests(regression_id)

    if result is None:
        raise regression_not_found(regression_id)

    return {"success": True, "data": result}


@router.post(
    "/regressions/{regression_id}/clone",
    status_code=http_status.HTTP_201_CREATED,
    response_model=None,
)
async def clone_regression(
    regression_id: str,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    """Clone a regression with a new name."""
    validate_uuid(regression_id, "regression_id")
    body = await read_json_object(request)
    new_name = body.get("name")
    if new_name:
        validate_regression_name(new_name)
    cloned = _reg_version_svc.clone_regression(regression_id, new_name)
    if cloned is None:
        raise regression_not_found(regression_id)
    response.headers["X-Cache-Invalidated"] = "regressions_list"
    return {"success": True, "data": cloned}
