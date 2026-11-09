"""Regression composition and lifecycle endpoints.

This module implements regression composition endpoints for managing suite
membership and cloning.

Endpoints:
- GET /regressions/{regression_id}/suites: Get suites in regression
- POST /regressions/{regression_id}/clone: Clone regression
"""

import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi import status as http_status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import WaveException
from wavecore.api.routes.regressions.routes import (
    _ERR_ALREADY_EXISTS,
    validate_regression_name,
    validate_uuid,
)
from wavecore.api.routes.shared import read_json_object
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.regressions import version_service as _reg_version_svc

# Create router for regression composition endpoints
router = APIRouter(tags=["Regressions"])


@router.get("/regressions/{regression_id}/suites", response_model=None)
async def get_regression_suites(regression_id: str) -> dict[str, Any] | JSONResponse:
    """Get suites belonging to a regression with their tests.

    Returns suites either from the regression's suites array or from suites
    with parent_regression metadata matching this regression's name.

    Args:
        regression_id: Regression UUID

    Returns:
        List of suites with their tests
    """
    try:
        validate_uuid(regression_id, "regression_id")

        result = regression_service.get_regression_suites_with_tests(regression_id)

        if result is None:
            return JSONResponse(
                status_code=http_status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Regression with ID '{regression_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": result}

    except ValueError as e:
        return JSONResponse(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.post(
    "/regressions/{regression_id}/clone",
    status_code=http_status.HTTP_201_CREATED,
    response_model=None,
)
async def clone_regression(
    regression_id: str,
    request: Request,
    response: Response,
) -> dict[str, Any] | JSONResponse:
    """Clone a regression with a new name."""
    try:
        validate_uuid(regression_id, "regression_id")
        body = await read_json_object(request)
        new_name = body.get("name")
        if new_name:
            validate_regression_name(new_name)
        cloned = _reg_version_svc.clone_regression(regression_id, new_name)
        if cloned is None:
            return JSONResponse(
                status_code=http_status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Regression with ID '{regression_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )
        response.headers["X-Cache-Invalidated"] = "regressions_list"
        return {"success": True, "data": cloned}
    except ValueError as e:
        error_message = str(e)
        if _ERR_ALREADY_EXISTS in error_message:
            status_code_val = http_status.HTTP_409_CONFLICT
        else:
            status_code_val = http_status.HTTP_400_BAD_REQUEST
        return JSONResponse(
            status_code=status_code_val,
            content={
                "success": False,
                "error": {"message": error_message, "code": "VALIDATION_ERROR"},
            },
        )
    except WaveException:
        raise
    except Exception:
        correlation_id = str(uuid.uuid4())
        return JSONResponse(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": {
                    "message": "Internal server error",
                    "code": "INTERNAL_ERROR",
                    "correlation_id": correlation_id,
                },
            },
        )
