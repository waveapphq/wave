"""Test batch operation endpoints.

This module implements batch operation endpoints for test entities,
enabling bulk create, update, and delete operations.

Endpoints:
- POST /tests/batch: Batch create tests
- PATCH /tests/batch: Batch update tests
- DELETE /tests/batch: Batch delete tests
"""

from typing import Any

from fastapi import APIRouter, Request

from wavecore.api.services.tests import service as test_service

# Create router for test batch endpoints
router = APIRouter(tags=["Tests"])


@router.post("/tests/batch", status_code=201)
async def batch_create_tests(request: Request) -> dict[str, Any]:
    """Create multiple tests in a batch.

    Args:
        request: HTTP request with list of test data

    Returns:
        Dictionary with created IDs and failed items
    """
    body = await request.json()
    result = test_service.batch_create_tests(body)
    return result


@router.patch("/tests/batch")
async def batch_update_tests(request: Request) -> dict[str, Any]:
    """Update multiple tests in a batch.

    Args:
        request: HTTP request with list of update items

    Returns:
        Dictionary with updated IDs and failed items
    """
    body = await request.json()
    result = test_service.batch_update_tests(body)
    return result


@router.delete("/tests/batch")
async def batch_delete_tests(request: Request) -> dict[str, Any]:
    """Delete multiple tests in a batch.

    Args:
        request: HTTP request with list of test IDs (or {ids: [...]} object)

    Returns:
        Dictionary with deleted IDs and failed items
    """
    body = await request.json()
    # Support both {ids: [...]} and [...] formats
    test_ids = body.get("ids", body) if isinstance(body, dict) else body
    result = test_service.batch_delete_tests(test_ids)
    return result
