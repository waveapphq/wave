"""Suite batch operation endpoints.

This module implements batch CRUD operations for suite entities.

Endpoints:
- DELETE /suites/batch: Batch delete suites
- POST /suites/batch/clone: Batch clone suites
"""

from typing import Any

from fastapi import APIRouter, Request

from wavecore.api.services.suites import service as suite_service

# Create router for suite batch endpoints
router = APIRouter(tags=["Suites"])


@router.delete("/suites/batch")
async def batch_delete_suites(request: Request) -> dict[str, Any]:
    """Delete multiple suites in a batch.

    Args:
        request: HTTP request with list of suite IDs

    Returns:
        Dictionary with deleted IDs and failed items
    """
    body = await request.json()
    result = suite_service.batch_delete_suites(body)
    return result


@router.post("/suites/batch/clone")
async def batch_clone_suites(request: Request) -> dict[str, Any]:
    """Clone multiple suites in a batch.

    Args:
        request: HTTP request with list of suite IDs

    Returns:
        Dictionary with cloned items and failed items
    """
    body = await request.json()
    result = suite_service.batch_clone_suites(body)
    return result
