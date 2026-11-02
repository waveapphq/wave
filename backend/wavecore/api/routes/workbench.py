"""Workbench endpoints for ephemeral test execution (V-CANVAS-14 / REQ-3.2.1.1).

This module implements ephemeral Workbench execution endpoints that enable users
to run workflows directly from the canvas during test development. Unlike tracked
executions, Workbench runs do NOT create Execution entities.

Endpoints:
- GET /workbench/session: Get current user's active session (session recovery)
- POST /workbench/run: Start ephemeral workbench run (with optional debug mode)
- POST /workbench/{session_id}/stop: Stop running session
- POST /workbench/{session_id}/continue: Resume a paused debug session
- POST /workbench/{session_id}/skip-block: Skip the paused node and re-pause
- POST /workbench/{session_id}/step-over: Run the paused node then re-pause at sibling
- POST /workbench/{session_id}/step-into: Run the paused node and re-pause at next node
- POST /workbench/{session_id}/repeat-step: Re-run the paused node in place
- PATCH /workbench/{session_id}/breakpoints: Replace live breakpoint set
- GET /workbench/{session_id}/status: Get session status and progress
- GET /workbench/{session_id}/variables: Get realized runtime variables
- DELETE /workbench/session: Clear/reset current user's session
"""

import json
from typing import Annotated, Any, Literal, Never

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from wavecore.api.exceptions import (
    InternalServerException,
    NotFoundException,
    ValidationException,
    WaveException,
)
from wavecore.api.routes.shared import validate_uuid
from wavecore.api.services import file_tree
from wavecore.api.services.workbench import ownership
from wavecore.api.services.workbench import service as workbench_service


def _workbench_error_response(e: Exception) -> Never:
    """Convert workbench exceptions to WaveExceptions and re-raise.

    Args:
        e: The caught exception.

    Raises:
        NotFoundException: For LookupError.
        ValidationException: For ValueError.
        InternalServerException: For any other exception.
    """
    if isinstance(e, WaveException):
        raise e
    if isinstance(e, LookupError):
        raise NotFoundException(str(e)) from e
    if isinstance(e, ValueError):
        raise ValidationException(str(e)) from e
    raise InternalServerException(str(e)) from e


# Create router for workbench endpoints
router = APIRouter(tags=["Workbench"])


class WorkbenchDebugOptions(BaseModel):
    """Debug options attached to a Debug-mode workbench run."""

    model_config = ConfigDict(extra="forbid")

    pause_on_first_block: bool
    pause_on_errors: bool


class FunctionVariables(BaseModel):
    """Pre-run Current values of one Function instance's own variables (REQ-3.2.1.6)."""

    model_config = ConfigDict(extra="forbid")

    # Instance node ids from the run's root canvas inward.
    function_path: list[str]
    variables: dict[str, dict[str, Any]]


class WorkbenchRunRequest(BaseModel):
    """Request model for starting a workbench run."""

    test_id: str
    environment_id: str
    # V-CANVAS-04: Client-provided session ID to enable WebSocket subscription
    # BEFORE execution starts (prevents race condition with first block events)
    session_id: str | None = None
    # CANVAS-72: Runtime-skipped node IDs (transient, not saved)
    skipped_node_ids: list[str] | None = None
    # Debug mode: both fields absent/null = regular run; either present = debug run
    breakpoints: list[str] | None = None
    debug_options: WorkbenchDebugOptions | None = None
    # Ad-hoc execution: mutually exclusive. start_node_id overrides the engine
    # entry point and traverses downstream until the graph drains; single_node_id
    # bounds traversal to the target's structural sub-tree only.
    start_node_id: str | None = None
    single_node_id: str | None = None
    # PYRUN-21: the single_node_id block runs the editor's unsaved draft; the run gate holds to it.
    block_draft: bool = False
    # Drilled-in Run Scope path: scope_mode='function' invokes a single
    # Function instance with cached parent-test inputs (or declared defaults
    # plus an advisory). scoped_function_node_id is the canvas node id of
    # the Function instance to invoke; required when scope_mode='function'.
    scope_mode: Literal["test", "function"] = "test"
    scoped_function_node_id: str | None = None
    # Function instance ids from the Test canvas to the canvas holding the target
    # (scoped_function_node_id, start_node_id or single_node_id); empty = the Test canvas.
    function_path: list[str] | None = None
    # Run-current: optional in-memory body. When `workflow` is present the run
    # executes that dirty canvas state (run gate validates it) instead of
    # loading the test from storage; `variables` overrides the persisted ones.
    workflow: dict[str, Any] | None = None
    variables: dict[str, Any] | None = None
    # Staged Current values of Function instances' own values; `variables` holds the Test's.
    function_variables: list[FunctionVariables] | None = None


@router.get("/workbench/session")
async def get_current_session() -> JSONResponse:
    """Get current user's active workbench session for session recovery.

    This endpoint enables frontend session recovery after page refresh,
    navigation, or browser crash. Returns session data in any status
    (running, passed, failed, stopped), not just running sessions.

    Returns:
        Session data if exists, null otherwise. Always returns 200 OK.
    """
    try:
        result = workbench_service.get_session_for_user()
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except Exception as e:
        _workbench_error_response(e)


@router.delete("/workbench/session")
async def clear_current_session() -> JSONResponse:
    """Clear/reset the current user's workbench session.

    This endpoint is used when the user clicks Reset or when the frontend
    detects stale session state. It is idempotent - succeeds even if no
    session exists.

    Returns:
        Dict with 'cleared' boolean indicating if a session was cleared.
    """
    try:
        result = workbench_service.clear_session_for_user()
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except Exception as e:
        _workbench_error_response(e)


@router.get("/workbench/session/artifacts")
async def list_session_artifacts() -> dict[str, Any]:
    """List the current user's active session artifacts."""
    return workbench_service.list_session_artifacts()


@router.get("/workbench/session/artifacts/content/{path:path}")
async def get_session_artifact_content(
    path: str, disposition: Annotated[str, Query()] = "attachment"
) -> Response:
    """Serve one artifact file from the active session's directory."""
    return file_tree.content_response(workbench_service.session_artifact_path(path), disposition)


@router.delete(
    "/workbench/session/artifacts/{path:path}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_session_artifact(path: str) -> Response:
    """Hard-delete one artifact file from the active ephemeral session."""
    workbench_service.delete_session_artifact(path)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workbench/run")
async def start_workbench_run(request: WorkbenchRunRequest) -> JSONResponse:
    """Start an ephemeral workbench run for a test.

    This endpoint initiates a workflow execution for rapid iteration during
    test development. Unlike tracked executions, workbench runs:
    - Do NOT create Execution entities (ephemeral)
    - Use session_id instead of execution_id
    - Stream events via WebSocket topic: workbench:{session_id}

    Args:
        request: Workbench run request with test_id, environment_id, and
            optional breakpoints + debug_options for Debug Mode.

    Returns:
        Session data with session_id and websocket_topic for event subscription.
    """
    # Validate UUID formats
    validate_uuid(request.test_id, "test_id")
    validate_uuid(request.environment_id, "environment_id")
    if request.session_id:
        validate_uuid(request.session_id, "session_id")

    if request.start_node_id is not None and request.single_node_id is not None:
        raise ValidationException("start_node_id and single_node_id are mutually exclusive")

    if request.scope_mode == "function" and not request.scoped_function_node_id:
        raise ValidationException(
            "scoped_function_node_id is required when scope_mode is 'function'"
        )

    debug_options_dict = request.debug_options.model_dump() if request.debug_options else None

    try:
        result = workbench_service.start_workbench_run(
            test_id=request.test_id,
            environment_id=request.environment_id,
            session_id=request.session_id,
            skipped_node_ids=request.skipped_node_ids,
            debug=workbench_service.DebugRunOptions(
                breakpoints=request.breakpoints,
                options=debug_options_dict,
            ),
            target=workbench_service.RunTarget(
                start_node_id=request.start_node_id,
                single_node_id=request.single_node_id,
                block_draft=request.block_draft,
            ),
            scope=workbench_service.ScopedRunOptions(
                mode=request.scope_mode,
                function_node_id=request.scoped_function_node_id,
                function_path=tuple(request.function_path or ()),
            ),
            workflow=request.workflow,
            variables=request.variables,
            function_variables=[entry.model_dump() for entry in request.function_variables or []],
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


class WorkbenchSkipUpdateRequest(BaseModel):
    """Request model for updating skipped nodes during execution."""

    skipped_node_ids: list[str]


@router.post("/workbench/{session_id}/skip")
async def update_skipped_nodes(
    session_id: str, request: WorkbenchSkipUpdateRequest
) -> JSONResponse:
    """Update skipped node IDs for a running workbench session.

    Enables mid-execution skip toggling from the canvas UI. The execution
    loop reads from the session's skipped_node_ids on each iteration,
    so updates take effect before the next block executes.

    Args:
        session_id: Session identifier.
        request: Updated skipped node IDs.

    Returns:
        Updated skip state.
    """
    validate_uuid(session_id, "session_id")
    try:
        result = workbench_service.update_skipped_nodes(
            session_id=session_id,
            skipped_node_ids=request.skipped_node_ids,
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


@router.post("/workbench/{session_id}/stop")
async def stop_workbench_run(session_id: str) -> JSONResponse:
    """Stop a running workbench session.

    Args:
        session_id: Session identifier.

    Returns:
        Session data with stopped status.
    """
    # Validate UUID format
    validate_uuid(session_id, "session_id")

    try:
        result = workbench_service.stop_workbench_run(session_id=session_id)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


@router.get("/workbench/{session_id}/status")
async def get_workbench_status(session_id: str) -> JSONResponse:
    """Get current status of a workbench session.

    Args:
        session_id: Session identifier.

    Returns:
        Session status including current block and progress.
    """
    # Validate UUID format
    validate_uuid(session_id, "session_id")

    try:
        result = workbench_service.get_workbench_status(session_id=session_id)
        if result is None:
            raise NotFoundException(f"Workbench session '{session_id}' not found or expired")

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except ValueError as e:
        _workbench_error_response(e)


def _csv(text: str) -> list[str]:
    return [item for item in text.split(",") if item]


@router.get("/workbench/{session_id}/variables")
async def get_session_variables(
    session_id: str, names: str | None = None, function_path: str | None = None
) -> JSONResponse:
    """Get one session scope's realized runtime variables (secrets masked)."""
    validate_uuid(session_id, "session_id")

    name_list = _csv(names) if names else None

    # No WaveException re-raise arm: the service only raises LookupError.
    try:
        result = workbench_service.get_session_variables(
            session_id=session_id, names=name_list, function_path=_csv(function_path or "")
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


class WorkbenchVariableOverrideRequest(BaseModel):
    """A transient runtime override: exactly one of value, expression or template."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: str
    value: Any = None
    expression: str | None = None
    template: str | None = None
    element_types: list[str] | dict[str, str] | None = Field(default=None, alias="elementTypes")
    function_path: list[str] | None = None


@router.patch("/workbench/{session_id}/variables/{name}")
async def set_variable_override(
    session_id: str, name: str, request: WorkbenchVariableOverrideRequest
) -> JSONResponse:
    """Apply a transient runtime override to one session variable (Current-edit).

    Literal override coerces + assigns the live value (pushing a change);
    expression override re-arms the source for lazy re-evaluation. Rejected
    with 409 while the session is running.
    """
    validate_uuid(session_id, "session_id")
    try:
        result = workbench_service.set_variable_override(
            session_id,
            name,
            value=request.value,
            value_given="value" in request.model_fields_set,
            expression=request.expression,
            template=request.template,
            declared_type=request.type,
            element_types=request.element_types,
            function_path=tuple(request.function_path or ()),
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


class WorkbenchBreakpointsRequest(BaseModel):
    """Request model for updating the live breakpoint set on a session."""

    breakpoints: list[str]


@router.patch("/workbench/{session_id}/breakpoints")
async def update_breakpoints(session_id: str, request: WorkbenchBreakpointsRequest) -> JSONResponse:
    """Replace the live breakpoint set on a running or paused debug session."""
    validate_uuid(session_id, "session_id")
    try:
        result = workbench_service.update_breakpoints(
            session_id=session_id,
            breakpoints=request.breakpoints,
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


class WorkbenchDebugOptionsPatchRequest(BaseModel):
    """Request model for patching the live debug-options on a session."""

    model_config = ConfigDict(extra="forbid")

    pause_on_first_block: bool | None = None
    pause_on_errors: bool | None = None


@router.patch("/workbench/{session_id}/debug-options")
async def update_debug_options(
    session_id: str, request: WorkbenchDebugOptionsPatchRequest
) -> JSONResponse:
    """Patch live debug-options on a running or paused debug session."""
    validate_uuid(session_id, "session_id")
    try:
        result = workbench_service.update_debug_options(
            session_id=session_id,
            pause_on_first_block=request.pause_on_first_block,
            pause_on_errors=request.pause_on_errors,
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


@router.post("/workbench/{session_id}/continue")
async def continue_session(session_id: str) -> JSONResponse:
    """Resume a paused debug session so the engine runs the paused node."""
    validate_uuid(session_id, "session_id")
    try:
        result = workbench_service.continue_session(session_id=session_id)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


@router.post("/workbench/{session_id}/skip-block")
async def skip_block(session_id: str) -> JSONResponse:
    """Skip the paused node and re-pause before the next node executes."""
    validate_uuid(session_id, "session_id")
    try:
        result = workbench_service.skip_current_block(session_id=session_id)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


@router.post("/workbench/{session_id}/step-over")
async def step_over(session_id: str) -> JSONResponse:
    """Run the paused node (and any sub-graph) then re-pause at the sibling-after."""
    validate_uuid(session_id, "session_id")
    try:
        result = workbench_service.step_over(session_id=session_id)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


@router.post("/workbench/{session_id}/step-into")
async def step_into(session_id: str) -> JSONResponse:
    """Run the paused node and re-pause BEFORE the immediate next node."""
    validate_uuid(session_id, "session_id")
    try:
        result = workbench_service.step_into(session_id=session_id)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


class WorkbenchRepeatStepRequest(BaseModel):
    """Optional body for a repeat: one parameter of the paused block, for that run only."""

    override: dict[str, Any] | None = None


@router.post("/workbench/{session_id}/repeat-step")
async def repeat_step(
    session_id: str, request: WorkbenchRepeatStepRequest | None = None
) -> JSONResponse:
    """Re-execute the currently paused node in place without advancing."""
    validate_uuid(session_id, "session_id")
    try:
        if request is None:
            result = workbench_service.repeat_step(session_id=session_id)
        else:
            result = workbench_service.repeat_step(session_id=session_id, override=request.override)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": result},
        )
    except WaveException:
        raise
    except (LookupError, ValueError) as e:
        _workbench_error_response(e)


class OwnershipClaimRequest(BaseModel):
    """Request model for claiming workbench editing ownership."""

    model_config = ConfigDict(extra="forbid")

    holder_id: str
    holder_label: str


class OwnershipHolderRequest(BaseModel):
    """Request model for holder-authenticated ownership actions."""

    model_config = ConfigDict(extra="forbid")

    holder_id: str


class OwnershipTakeoverRequest(BaseModel):
    """Request model for take-over requests."""

    model_config = ConfigDict(extra="forbid")

    requester_id: str
    requester_label: str


class OwnershipRequesterRequest(BaseModel):
    """Request model for a requester-authenticated take-over action."""

    model_config = ConfigDict(extra="forbid")

    requester_id: str


def _ownership_response(data: dict[str, Any]) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"success": True, "data": data},
    )


@router.get("/workbench/ownership")
async def get_ownership_state(holder_id: str | None = None) -> JSONResponse:
    """Current holder, watcher count, pending take-over, and caller projection."""
    result = ownership.get_ownership()
    holder = result["holder"]
    return _ownership_response(
        {
            **result,
            "you_are_holder": holder is not None and holder["id"] == holder_id,
            "mcp_session_id": holder["id"] if holder and holder["kind"] == "mcp" else None,
            "browser_session_id": (holder["id"] if holder and holder["kind"] == "person" else None),
        }
    )


@router.post("/workbench/ownership/claim")
async def claim_ownership(request: OwnershipClaimRequest) -> JSONResponse:
    """Become the workbench holder if the slot is free (409 when held)."""
    result = ownership.claim(request.holder_id, request.holder_label, "person")
    return _ownership_response({"you_are_holder": True, **result})


@router.post("/workbench/ownership/heartbeat")
async def ownership_heartbeat(request: OwnershipHolderRequest) -> JSONResponse:
    """Refresh the holder's liveness (409 when not the holder)."""
    ownership.heartbeat(request.holder_id)
    return _ownership_response({"ok": True})


@router.post("/workbench/ownership/release")
async def release_ownership(request: OwnershipHolderRequest) -> JSONResponse:
    """Relinquish the workbench slot; a pending take-over is granted."""
    ownership.release(request.holder_id, "released")
    return _ownership_response({"released": True})


@router.post("/workbench/ownership/leaving")
async def ownership_leaving(request: Request) -> JSONResponse:
    """A departing tab: reserve its slot briefly, drop it from watchers and the roster.

    Parses the raw body itself: the browser beacon must stay a CORS simple
    request (a preflight does not survive page unload), so no JSON content type.
    """
    from wavecore.api.websocket import session_registry

    try:
        payload = json.loads(await request.body())
    except ValueError:
        payload = None
    if not isinstance(payload, dict) or not isinstance(payload.get("holder_id"), str):
        return _ownership_response({"ok": True})
    holder_id: str = payload["holder_id"]
    page_id = payload.get("page_id") if isinstance(payload.get("page_id"), str) else None
    from wavecore.api.app import app

    ws_manager = getattr(app.state, "ws_manager", None)
    # A keepalive beacon can land after the reloaded page re-identified the same tab.
    if ws_manager is not None and not ws_manager.is_current_page(holder_id, page_id):
        return _ownership_response({"ok": True})
    ownership.mark_away(holder_id)
    session_registry.remove_session(holder_id)
    if ws_manager is not None:
        ws_manager.drop_draft_watcher(holder_id, page_id)
    return _ownership_response({"ok": True})


@router.post("/workbench/ownership/takeover")
async def request_ownership_takeover(request: OwnershipTakeoverRequest) -> JSONResponse:
    """Request a take-over: grant when idle, else await approval or release."""
    result = ownership.request_takeover(request.requester_id, request.requester_label)
    return _ownership_response(result)


@router.post("/workbench/ownership/takeover/approve")
async def approve_ownership_takeover(request: OwnershipHolderRequest) -> JSONResponse:
    """Holder approves the pending take-over and hands the draft over."""
    return _ownership_response(ownership.resolve_takeover(request.holder_id, True))


@router.post("/workbench/ownership/takeover/deny")
async def deny_ownership_takeover(request: OwnershipHolderRequest) -> JSONResponse:
    """Holder denies the pending take-over and keeps editing."""
    return _ownership_response(ownership.resolve_takeover(request.holder_id, False))


@router.post("/workbench/ownership/takeover/cancel")
async def cancel_ownership_takeover(request: OwnershipRequesterRequest) -> JSONResponse:
    """The requester retracts its own pending take-over."""
    return _ownership_response(ownership.cancel_takeover(request.requester_id))


@router.post("/workbench/ownership/takeover/force")
async def force_ownership_takeover(request: OwnershipTakeoverRequest) -> JSONResponse:
    """Unconditionally take the slot over, interrupting the current holder."""
    result = ownership.force_takeover(request.requester_id, request.requester_label)
    return _ownership_response({"you_are_holder": True, **result})
