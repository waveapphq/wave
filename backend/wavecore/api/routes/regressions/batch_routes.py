"""Regression batch operation endpoints.

Endpoints:
- DELETE /regressions/batch: Batch delete regressions
- POST /regressions/batch/clone: Batch clone regressions
"""

from typing import Any

from fastapi import APIRouter, Request

from wavecore.api.routes.shared import read_json_array
from wavecore.api.services.regressions import service as regression_service

router = APIRouter(tags=["Regressions"])


@router.delete("/regressions/batch")
async def batch_delete_regressions(request: Request) -> dict[str, Any]:
    """Delete multiple regressions in a batch.

    Args:
        request: HTTP request with list of regression IDs

    Returns:
        Dictionary with deleted IDs and failed items
    """
    body = await read_json_array(request)
    result = regression_service.batch_delete_regressions(body)
    return result


@router.post("/regressions/batch/clone")
async def batch_clone_regressions(request: Request) -> dict[str, Any]:
    """Clone multiple regressions in a batch.

    Args:
        request: HTTP request with list of regression IDs

    Returns:
        Dictionary with cloned items and failed items
    """
    body = await read_json_array(request)
    result = regression_service.batch_clone_regressions(body)
    return result
