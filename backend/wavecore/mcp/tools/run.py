"""Run tool handlers: start and monitor executions."""

import re
from typing import Any

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.workbench import _common as workbench_common
from wavecore.api.services.workbench import ownership
from wavecore.api.services.workbench import service as workbench_service
from wavecore.mcp import state as mcp_state
from wavecore.mcp.tools.discover import (
    _LIST_ALL,
    _resolve_ref,
    resolve_regression,
    resolve_suite,
    resolve_test,
)

_CLIENT_NAME_MAX = 40
_CLIENT_NAME_INVALID = re.compile(r"[^a-zA-Z0-9._-]")

_ENTITY_RESOLVERS = {
    "test": resolve_test,
    "suite": resolve_suite,
    "regression": resolve_regression,
}


def sanitize_client_name(client_name: str | None) -> str:
    """Attribution name: replace invalid chars with '-', cap at 40; fallback 'client'."""
    if not client_name:
        return "client"
    return _CLIENT_NAME_INVALID.sub("-", client_name)[:_CLIENT_NAME_MAX]


def _resolve_environment(ref: str) -> dict[str, Any]:
    return _resolve_ref(
        ref,
        type_label="environment",
        get_by_id=environment_service.get_environment,
        list_all=lambda: environment_service.list_environments(per_page=_LIST_ALL)["environments"],
    )


def _resolve_profile(ref: str) -> dict[str, Any]:
    return _resolve_ref(
        ref,
        type_label="profile",
        get_by_id=profile_service.get_profile,
        list_all=lambda: profile_service.list_profiles(per_page=_LIST_ALL)["profiles"],
    )


def _claim_run_slot(holder_id: str) -> bool:
    """Borrow the workbench slot for the run's duration; False on a refused claim."""
    try:
        ownership.claim(holder_id, mcp_state.mcp_holder_label(holder_id), "mcp")
    except ConflictException:
        return False
    return True


def _release_run_slot(holder_id: str) -> None:
    """Hand the slot back if this run still holds it."""
    holder = ownership.get_holder()
    if holder is not None and holder["id"] == holder_id:
        ownership.release(holder_id, "handoff")


def _register_release_on_terminal(execution_id: str, holder_id: str) -> None:
    """Release the borrowed slot when the tracked run reaches terminal state."""

    def _on_terminal(session_id: str, status: str, halt_scope: str | None = None) -> None:
        if session_id != execution_id:
            return
        workbench_common.unregister_terminal_callback(_on_terminal)
        _release_run_slot(holder_id)

    workbench_common.register_terminal_callback(_on_terminal)


def start_execution(
    entity_type: str,
    ref: str,
    environment: str,
    profile: str | None = None,
    variables: dict[str, Any] | None = None,
    client_name: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Start a test, suite, or regression execution attributed to the MCP client."""
    resolver = _ENTITY_RESOLVERS.get(entity_type)
    if resolver is None:
        raise ValidationException(
            f"Invalid entity_type '{entity_type}': "
            f"valid types are {', '.join(_ENTITY_RESOLVERS)}"
        )
    entity = resolver(ref)
    environment_record = _resolve_environment(environment)
    profile_id = _resolve_profile(profile)["id"] if profile else None

    # The conflict surfaces here, in the tool reply, before any record is written.
    workbench_service._guard_no_active_session(workbench_common.DEFAULT_USER_ID)

    holder_id = session_id or "mcp"
    mirrored = entity_type == "test" and _claim_run_slot(holder_id)

    try:
        execution = execution_service.start_execution(
            entity_type,
            str(entity["id"]),
            str(environment_record["id"]),
            variables=variables,
            profile_id=profile_id,
            triggered_by=f"mcp:{sanitize_client_name(client_name)}",
        )
    except Exception:
        if mirrored:
            _release_run_slot(holder_id)
        raise

    if mirrored:
        _register_release_on_terminal(str(execution["id"]), holder_id)
    return {
        "execution_id": execution["id"],
        "status": execution["status"],
        "mirrored": mirrored,
    }


def get_execution(execution_id: str) -> dict[str, Any]:
    """Enriched execution detail: status, progress, per-test rows, counts."""
    detail = execution_service.get_execution(execution_id)
    if detail is None:
        raise NotFoundException(f"Execution '{execution_id}' not found")
    return detail
