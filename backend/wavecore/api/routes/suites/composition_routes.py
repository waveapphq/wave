"""Suite composition and lifecycle endpoints.

This module implements suite composition endpoints for managing test membership,
variable configuration, and cloning.

Endpoints:
- GET /suites/{suite_id}/tests: Get tests belonging to a suite
- POST /suites/{suite_id}/tests: Add test to suite
- DELETE /suites/{suite_id}/tests/{test_id}: Remove test from suite
- GET /suites/{suite_id}/variables: Get suite variables
- PUT /suites/{suite_id}/variables: Update suite variables
- POST /suites/{suite_id}/clone: Clone suite
"""

import re
from typing import Any

from fastapi import APIRouter, Request
from fastapi import status as status_module

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import validate_uuid, validate_variable_types
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.suites import version_service as _suite_version_svc

# Create router for suite composition endpoints
router = APIRouter(tags=["Suites"])

# Semantic version pattern
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


def validate_semantic_version(version: str) -> None:
    """Validate semantic version format.

    Args:
        version: Version string to validate

    Raises:
        ValidationException: If version format is invalid
    """
    if not SEMVER_PATTERN.match(version):
        raise ValidationException(
            f"Version '{version}' does not follow semantic versioning format (x.y.z)"
        )


@router.get("/suites/{suite_id}/tests")
async def get_suite_tests(suite_id: str) -> dict[str, Any]:
    """Get tests belonging to a suite.

    Returns tests either from the suite's tests array or from tests
    with parent_suite metadata matching this suite's name.

    Args:
        suite_id: Suite UUID

    Returns:
        List of tests
    """
    validate_uuid(suite_id, "suite_id")

    result = suite_service.get_suite_tests(suite_id)

    if result is None:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    return {"success": True, "data": result}


@router.post("/suites/{suite_id}/tests")
async def add_test_to_suite(suite_id: str, request: Request) -> dict[str, Any]:
    """Add a test to a suite.

    Validates test existence before creating the association with optional
    ordering position.

    Args:
        suite_id: Suite UUID
        request: HTTP request with test_id and optional order

    Returns:
        Updated suite
    """
    validate_uuid(suite_id, "suite_id")

    body = await request.json()

    # Validate required field
    if "test_id" not in body:
        raise ValidationException("Field 'test_id' is required")

    test_id = body["test_id"]
    validate_uuid(test_id, "test_id")
    order = body.get("order")

    # ValidationException propagates to middleware for test not found
    result = _suite_version_svc.add_test_to_suite(suite_id, test_id, order)

    if result is None:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    return {"success": True, "data": result}


@router.delete("/suites/{suite_id}/tests/{test_id}")
async def remove_test_from_suite(suite_id: str, test_id: str) -> dict[str, Any]:
    """Remove a test from a suite.

    Preserves suite integrity by updating ordering indices for remaining tests.

    Args:
        suite_id: Suite UUID
        test_id: Test UUID to remove

    Returns:
        Updated suite
    """
    validate_uuid(suite_id, "suite_id")
    validate_uuid(test_id, "test_id")

    result = _suite_version_svc.remove_test_from_suite(suite_id, test_id)

    if result is None:
        raise NotFoundException(f"Test '{test_id}' not found in suite '{suite_id}'")

    return {"success": True, "data": result}


@router.get("/suites/{suite_id}/variables")
async def get_suite_variables(suite_id: str) -> dict[str, Any]:
    """Get suite variables.

    Args:
        suite_id: Suite UUID

    Returns:
        Variable declarations with secret indicators
    """
    validate_uuid(suite_id, "suite_id")

    variables = suite_service.get_suite_variables(suite_id)

    if variables is None:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    return {"success": True, "data": variables}


@router.put("/suites/{suite_id}/variables")
async def update_suite_variables(suite_id: str, request: Request) -> dict[str, Any]:
    """Update suite variables.

    Replaces the suite's full variable map. Collision validation (types
    across suites sharing tests) runs inside update_suite() and raises
    ConflictException on conflict.

    Args:
        suite_id: Suite UUID
        request: HTTP request body is the variable declaration map

    Returns:
        Updated suite with the new variables
    """
    validate_uuid(suite_id, "suite_id")

    body = await request.json()

    try:
        validate_variable_types(body)
    except ValueError as e:
        raise ValidationException(str(e)) from e

    result = suite_service.update_suite(suite_id, {"variables": body})

    if result is None:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    return {"success": True, "data": result}


@router.post("/suites/{suite_id}/clone", status_code=status_module.HTTP_201_CREATED)
async def clone_suite(suite_id: str, request: Request) -> dict[str, Any]:
    """Clone suite with a new name.

    Creates a copy of an existing suite with new name, supporting suite
    derivation workflows.

    Args:
        suite_id: Source suite UUID
        request: HTTP request with new_name and optional new_version

    Returns:
        Cloned suite
    """
    validate_uuid(suite_id, "suite_id")

    body = await request.json()

    # Validate required field
    if "new_name" not in body:
        raise ValidationException("Field 'new_name' is required")

    new_name = body["new_name"]
    new_version = body.get("new_version")

    # Validate new_version if provided
    if new_version:
        validate_semantic_version(new_version)

    result = _suite_version_svc.clone_suite(suite_id, new_name, new_version)

    if result is None:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    return {"success": True, "data": result}
