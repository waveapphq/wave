"""Standalone Function run/debug endpoints for the library View (REQ-3.2.1.1/.2).

- POST   /functions/{function_id}/run          stage + run a published version
                                               or an edit-mode draft in isolation
- DELETE /functions/view-session/{session_id}  sweep the ephemeral run session

Both delegate to ``services.functions.scratch_run``; the run reuses the workbench
scoped-function machinery and returns the same session shape as ``/workbench/run``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from wavecore.api.routes.shared import validate_uuid
from wavecore.api.routes.workbench import FunctionVariables
from wavecore.api.services.functions import scratch_run
from wavecore.api.services.workbench import service as workbench_service

router = APIRouter(tags=["Functions"], prefix="/functions")


class FunctionRunDebug(BaseModel):
    """Debug payload attached to a standalone Function run."""

    model_config = ConfigDict(extra="forbid")

    breakpoints: list[str] = []
    options: dict[str, bool] | None = None


class FunctionRunRequest(BaseModel):
    """Run request: ``version`` always, ``draft`` optionally made from it."""

    model_config = ConfigDict(extra="forbid")

    environment_id: str
    version: str | None = None
    draft: dict[str, Any] | None = None
    session_id: str | None = None
    debug: FunctionRunDebug | None = None
    variables: dict[str, dict[str, Any]] | None = None
    function_variables: list[FunctionVariables] | None = None


@router.post("/{function_id}/run", response_model=None)
async def run_function_standalone(function_id: str, request: FunctionRunRequest) -> JSONResponse:
    """Run a Function standalone from the library View."""
    validate_uuid(function_id, "function_id")
    validate_uuid(request.environment_id, "environment_id")
    if request.session_id:
        validate_uuid(request.session_id, "session_id")

    debug = None
    if request.debug is not None:
        debug = workbench_service.DebugRunOptions(
            breakpoints=request.debug.breakpoints,
            options=request.debug.options,
        )

    result = scratch_run.start_function_run(
        function_id,
        version=request.version,
        draft=request.draft,
        environment_id=request.environment_id,
        debug=debug,
        session_id=request.session_id,
        variables=request.variables,
        function_variables=[entry.model_dump() for entry in request.function_variables or []],
    )
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"success": True, "data": result},
    )


@router.delete("/view-session/{session_id}", response_model=None)
async def sweep_function_view_session(session_id: str) -> JSONResponse:
    """Sweep the ephemeral standalone-run session (best-effort, idempotent)."""
    validate_uuid(session_id, "session_id")
    scratch_run.sweep_scratch(session_id)
    return JSONResponse(status_code=status.HTTP_200_OK, content={"success": True})
