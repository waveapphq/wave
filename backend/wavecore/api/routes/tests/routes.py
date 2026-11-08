"""Test workflow endpoints - core CRUD (REQ-5.2.4.3).

This module implements core test workflow endpoints providing lifecycle operations
for test entities enabling creation, modification, deletion, and validation.

Endpoints:
- GET /tests/tags: List all test tags
- GET /tests: List all tests with filtering and pagination
- POST /tests: Create a new test
- GET /tests/{test_id}: Get test by ID
- PUT /tests/{test_id}: Update test
- PATCH /tests/{test_id}/metadata: Update test metadata only
- DELETE /tests/{test_id}: Delete test
- GET /tests/{test_id}/workflow: Get test workflow graph
- GET /tests/{test_id}/variables: Get test variables
- PATCH /tests/{test_id}/variables: Update test variables
- POST /tests/{test_id}/validate: Validate test definition
- POST /tests/{test_id}/fix: Apply automatic fixes
- POST /tests/{test_id}/clone: Clone test
- GET /tests/{test_id}/dependency-graph: Get dependency graph
- POST /workflows/validate: Validate workflow structure
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Body, Header, Query, Request, Response, status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.routes.shared import (
    read_json_object,
    validate_uuid,
)
from wavecore.api.services import workflow_service
from wavecore.api.services.shared import validate_semantic_version
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests.service import SaveValidationError

# Create router for test endpoints
router = APIRouter(tags=["Tests"])

# Reusable string constants
_CACHE_CONTROL_60 = "max-age=60"
_ERR_PRECONDITION = "Precondition failed"


def _format_save_validation_message(errors: list[dict[str, Any]]) -> str:
    """Produce the unified 422 message used by POST /tests and PUT /tests/{id}."""
    return f"Test has {len(errors)} validation error(s)"


def _save_validation_response(error: SaveValidationError) -> JSONResponse:
    """Build the standard 422 response for the unified write-path pipeline."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "success": False,
            "error": {
                "message": _format_save_validation_message(error.errors),
                "code": "VALIDATION_ERROR",
                "details": error.errors,
            },
        },
    )


def validate_test_name(name: str) -> None:
    """Validate test name length.

    No character restrictions - all characters allowed.
    Future: REQ-6.4.1 will add proper sanitization for security.

    Args:
        name: Test name to validate

    Raises:
        ValueError: If name is empty or too long
    """
    if not name or len(name) > 255:
        raise ValueError("Test name must be between 1 and 255 characters")


def _generate_etag(test: dict[str, Any]) -> str:
    """Generate ETag for a test.

    Args:
        test: Test data

    Returns:
        ETag string (quoted hex hash)
    """
    import hashlib

    content = f"{test.get('id')}{test.get('version')}{test.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


# =============================================================================
# Tags Support
# =============================================================================


@router.get("/tests/tags")
async def list_tags_endpoint(request: Request, response: Response) -> dict[str, Any]:
    """Get all unique tags from all tests.

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        List of unique tags sorted alphabetically
    """
    result = test_service.list_all_tags()

    # Tags change when tests are modified
    response.headers["Cache-Control"] = _CACHE_CONTROL_60

    return {
        "success": True,
        "data": result,
        "meta": {
            "request_id": request.headers.get("X-Request-ID", ""),
        },
    }


# =============================================================================
# Core CRUD Endpoints
# =============================================================================


@router.get("/tests", response_model=None)
async def list_tests(
    response: Response,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    per_page: Annotated[int, Query(ge=1, le=100, description="Results per page")] = 20,
    search: Annotated[str | None, Query(description="Text search query")] = None,
    suite_ids: Annotated[
        str | None, Query(description="Filter by suite IDs (comma-separated)")
    ] = None,
    tags: Annotated[str | None, Query(description="Filter by tags (comma-separated)")] = None,
    status_filter: Annotated[
        str | None,
        Query(
            alias="status",
            description="Filter by status (comma-separated: passed,failed,never_run)",
        ),
    ] = None,
    sort_by: Annotated[
        str | None, Query(description="Sort by field (name, status, lastRun)")
    ] = None,
    sort_order: Annotated[str | None, Query(description="Sort order (asc, desc)")] = "asc",
) -> dict[str, Any] | JSONResponse:
    """List all tests with filtering and pagination.

    Supports page-based pagination and filtering by suite_ids, tags, status, and text search.

    Args:
        response: HTTP response for setting cache headers
        page: Page number (1-based)
        per_page: Number of results per page (1-100)
        search: Text search across names and descriptions
        suite_ids: Filter by suite IDs (comma-separated)
        tags: Filter by tags
        status_filter: Filter by execution status (comma-separated: passed,failed,never_run)

    Returns:
        Paginated list of tests with metadata
    """
    # Set cache control headers
    response.headers["Cache-Control"] = _CACHE_CONTROL_60

    # Parse comma-separated suite_ids into list
    suite_id_list: list[str] | None = None
    if suite_ids:
        suite_id_list = [s.strip() for s in suite_ids.split(",") if s.strip()]
        # Validate each UUID
        for sid in suite_id_list:
            try:
                validate_uuid(sid, "suite_id")
            except (ValueError, ValidationException) as e:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={
                        "success": False,
                        "error": {"message": str(e), "code": "INVALID_PARAMETER"},
                    },
                )

    # Parse comma-separated status values into list
    status_list: list[str] | None = None
    if status_filter:
        status_list = [s.strip() for s in status_filter.split(",") if s.strip()]

    # Parse comma-separated tags into list
    tags_list: list[str] | None = None
    if tags:
        tags_list = [t.strip() for t in tags.split(",") if t.strip()]

    # Get tests from service
    result = test_service.list_tests(
        page=page,
        per_page=per_page,
        search=search,
        suite_ids=suite_id_list,
        tags=tags_list,
        status=status_list,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    return {
        "success": True,
        "data": result["tests"],
        "pagination": {
            "total": result["total"],
            "page": result["page"],
            "per_page": result["per_page"],
            "total_pages": result["total_pages"],
        },
    }


@router.post("/tests", status_code=status.HTTP_201_CREATED, response_model=None)
async def create_test(request: Request, response: Response) -> dict[str, Any] | JSONResponse:
    """Create a new test.

    Validates test definition including naming conventions and workflow structure.

    Args:
        request: HTTP request with test data
        response: HTTP response for setting headers

    Returns:
        Created test with metadata
    """
    try:
        body = await read_json_object(request)

        # Validate required fields
        if "name" not in body:
            raise ValueError("Field 'name' is required")

        # Validate field values
        validate_test_name(body["name"])

        # Create test (service layer runs the unified write-path pipeline)
        test = test_service.create_test(body)
        repairs = test.pop("repairs", [])

        # Set cache invalidation header
        response.headers["X-Cache-Invalidated"] = "tests_list"

        return {"success": True, "data": test, "repairs": repairs}

    except SaveValidationError as e:
        return _save_validation_response(e)
    except ConflictException as e:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "success": False,
                "error": {"message": e.message, "code": "CONFLICT"},
            },
        )
    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )
    except Exception:
        correlation_id = str(uuid.uuid4())
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": {
                    "message": "Internal server error",
                    "code": "INTERNAL_ERROR",
                    "correlation_id": correlation_id,
                },
            },
        )


@router.get("/tests/{test_id}", response_model=None)
async def get_test(test_id: str, response: Response) -> dict[str, Any] | JSONResponse:
    """Get test by ID.

    Args:
        test_id: Test UUID
        response: HTTP response for setting headers

    Returns:
        Test details with metadata
    """
    try:
        validate_uuid(test_id, "test_id")

        test = test_service.get_test(test_id)

        if test is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        # Set ETag header for concurrency control
        response.headers["ETag"] = _generate_etag(test)

        return {"success": True, "data": test}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.put("/tests/{test_id}", response_model=None)
async def update_test(
    test_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any] | JSONResponse:
    """Update test.

    Args:
        test_id: Test UUID
        request: HTTP request with update data
        response: HTTP response for setting headers
        if_match: ETag for optimistic concurrency control

    Returns:
        Updated test
    """
    try:
        validate_uuid(test_id, "test_id")

        body = await read_json_object(request)

        # Validate name if being updated
        if "name" in body:
            validate_test_name(body["name"])

        result = test_service.update_test(test_id, body, etag=if_match)

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        repairs = result.pop("repairs", [])

        # Set new ETag
        response.headers["ETag"] = _generate_etag(result)

        return {"success": True, "data": result, "repairs": repairs}

    except SaveValidationError as e:
        return _save_validation_response(e)
    except ConflictException as e:
        error_message = e.message
        if _ERR_PRECONDITION in error_message:
            status_code = status.HTTP_412_PRECONDITION_FAILED
        else:
            status_code = status.HTTP_409_CONFLICT
        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "CONFLICT"},
            },
        )
    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )


@router.patch("/tests/{test_id}/metadata", response_model=None)
async def update_test_metadata(
    test_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any] | JSONResponse:
    """Update test metadata only (name, description, tags).

    Does NOT update workflow or increment version.

    Args:
        test_id: Test UUID
        request: HTTP request with metadata update data
        response: HTTP response for setting headers
        if_match: ETag for optimistic concurrency control

    Returns:
        Updated test
    """
    try:
        validate_uuid(test_id, "test_id")

        body = await read_json_object(request)

        # Validate name if being updated
        if "name" in body:
            validate_test_name(body["name"])

        result = test_service.update_test_metadata(test_id, body, etag=if_match)

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        # Set new ETag
        response.headers["ETag"] = _generate_etag(result)

        return {"success": True, "data": result}

    except ConflictException as e:
        error_message = e.message
        if _ERR_PRECONDITION in error_message:
            status_code = status.HTTP_412_PRECONDITION_FAILED
        else:
            status_code = status.HTTP_409_CONFLICT
        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "CONFLICT"},
            },
        )
    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )


@router.delete("/tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test(
    test_id: str,
    if_match: Annotated[str | None, Header()] = None,
) -> Response:
    """Delete test.

    Enforces dependency checking to prevent orphaned suite references.

    Args:
        test_id: Test UUID
        if_match: ETag for optimistic concurrency control

    Returns:
        Empty response with 204 status code
    """
    try:
        # Check ETag if provided
        if if_match:
            test = test_service.get_test(test_id)
            if test:
                current_etag = _generate_etag(test)
                if if_match != current_etag:
                    raise ValueError("Precondition failed: resource has been modified")

        deleted = test_service.delete_test(test_id)

        if not deleted:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    except (ValueError, ValidationException) as e:
        error_message = str(e)

        if _ERR_PRECONDITION in error_message:
            status_code = status.HTTP_412_PRECONDITION_FAILED
        else:
            status_code = status.HTTP_400_BAD_REQUEST

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "CONFLICT"},
            },
        )


# =============================================================================
# Workflow, Variables, Validation, Fix, Clone, Dependencies, Executions
# =============================================================================


@router.get("/tests/{test_id}/workflow", response_model=None)
async def get_test_workflow(test_id: str) -> dict[str, Any] | JSONResponse:
    """Get test workflow graph.

    Args:
        test_id: Test UUID

    Returns:
        Workflow graph (nodes and edges)
    """
    try:
        validate_uuid(test_id, "test_id")

        workflow = test_service.get_test_workflow(test_id)

        if workflow is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": workflow}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.get("/tests/{test_id}/variables", response_model=None)
async def get_test_variables(test_id: str) -> dict[str, Any] | JSONResponse:
    """Get test variables.

    Args:
        test_id: Test UUID

    Returns:
        Variable declarations with masked secrets
    """
    try:
        validate_uuid(test_id, "test_id")

        variables = test_service.get_test_variables(test_id)

        if variables is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": variables}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.patch("/tests/{test_id}/variables", response_model=None)
async def update_test_variables(test_id: str, request: Request) -> dict[str, Any] | JSONResponse:
    """Update test variables.

    Args:
        test_id: Test UUID
        request: HTTP request with variables data

    Returns:
        Updated variable declarations
    """
    try:
        validate_uuid(test_id, "test_id")

        body = await read_json_object(request)

        # Validate required field
        if "variables" not in body:
            raise ValueError("Field 'variables' is required")

        variables = body["variables"]
        merge = body.get("merge", False)

        result = test_service.update_test_variables(test_id, variables, merge=merge)

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": result}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )


def _unsaved_parts(body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """The workflow and the variables, when given, of an unsaved test body."""
    workflow = body.get("workflow")
    if not isinstance(workflow, dict):
        raise ValueError("Field 'workflow' must be an object")
    variables = body.get("variables")
    if variables is not None and not isinstance(variables, dict):
        raise ValueError("Field 'variables' must be an object")
    return workflow, variables


@router.post("/tests/{test_id}/validate", response_model=None)
async def validate_test(
    test_id: str,
    context: Annotated[str, Query(description="Validation context: load, import, or run")] = "load",
    unsaved: Annotated[
        dict[str, Any] | None,
        Body(
            description="An unsaved workflow and its variables, checked instead of the stored test"
        ),
    ] = None,
) -> dict[str, Any] | JSONResponse:
    """Validate test definition.

    Two-phase validation verifying structural integrity including workflow graph
    validation, element reference validation, variable binding completeness, and
    parameter consistency.

    Args:
        test_id: Test UUID
        context: Validation context - "load", "import", or "run"
        unsaved: Optional unsaved workflow and variables to check instead of the stored test

    Returns:
        Validation result with fatal flag, errors, and warnings
    """
    try:
        validate_uuid(test_id, "test_id")

        if context not in ("load", "import", "run"):
            raise ValueError(
                f"Invalid validation context: '{context}' (must be load, import, or run)"
            )

        if unsaved is None:
            result = test_service.validate_test(test_id, context=context)
        else:
            workflow, variables = _unsaved_parts(unsaved)
            result = test_service.validate_unsaved_test(
                test_id, workflow, variables, context=context
            )

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        # 422 when validation found errors, 200 when clean
        if result.get("fatal") or result.get("errors"):
            error_count = len(result.get("errors", []))
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test has {error_count} validation error(s)",
                        "code": "VALIDATION_ERRORS",
                        "details": [result],
                    },
                },
            )

        return {"success": True, "data": result}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.post("/tests/{test_id}/fix", response_model=None)
async def fix_test(test_id: str) -> dict[str, Any] | JSONResponse:
    """Apply automatic fixes to a test.

    Validates the test, applies all fixable error corrections, saves the
    result, and returns the fixed test data.

    Args:
        test_id: Test UUID

    Returns:
        Fixed test data
    """
    try:
        validate_uuid(test_id, "test_id")

        fix_result = test_service.fix_test(test_id)

        if fix_result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {
            "success": True,
            "data": fix_result["test"],
            "warnings": fix_result.get("warnings", []),
        }

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )


@router.post("/tests/{test_id}/clone", status_code=status.HTTP_201_CREATED, response_model=None)
async def clone_test(test_id: str, request: Request) -> dict[str, Any] | JSONResponse:
    """Clone test with a new name.

    Args:
        test_id: Source test UUID
        request: HTTP request with optional new_name and new_version

    Returns:
        Cloned test
    """
    try:
        validate_uuid(test_id, "test_id")

        # Handle empty body or missing fields
        try:
            body = await read_json_object(request)
        except ValidationException:
            body = {}

        # Auto-generate name if not provided
        new_name = body.get("new_name")
        if not new_name:
            # Get original test name and append " (Copy)"
            original = test_service.get_test(test_id)
            if original:
                new_name = f"{original.get('name', 'Test')} (Copy)"
            else:
                new_name = "Test (Copy)"

        new_version = body.get("new_version")

        # Validate new_version if provided
        if new_version:
            validate_semantic_version(new_version)

        result = test_service.clone_test(test_id, new_name, new_version)

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": result}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )


@router.get("/tests/{test_id}/dependency-graph", response_model=None)
async def get_test_dependency_graph(test_id: str) -> dict[str, Any] | JSONResponse:
    """Get test dependency graph.

    Reveals all block references with version constraints.

    Args:
        test_id: Test UUID

    Returns:
        Dependency graph with nodes and edges
    """
    try:
        validate_uuid(test_id, "test_id")

        result = test_service.get_test_dependency_graph(test_id)

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": result, "nodes": result["nodes"], "edges": result["edges"]}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.post("/workflows/validate", response_model=None)
async def validate_workflow(request: Request) -> dict[str, Any] | JSONResponse:
    """Validate workflow structure independently of test context.

    Supports cycle detection, reachability analysis, termination verification,
    and block reference validation.

    Args:
        request: HTTP request with workflow definition

    Returns:
        Validation result with errors and warnings
    """
    try:
        body = await read_json_object(request)

        # Validate required fields
        if "nodes" not in body:
            raise ValueError("Field 'nodes' is required")
        if "edges" not in body:
            raise ValueError("Field 'edges' is required")

        result = workflow_service.validate_workflow(body)

        return {"success": True, "data": result}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )
