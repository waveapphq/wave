"""Ephemeral standalone Function run for the library View (REQ-3.2.1.1/.2)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from wavecore.api.exceptions import NotFoundException, UnprocessableEntityException
from wavecore.api.services.functions import _storage as _function_storage
from wavecore.api.services.functions import service as function_service
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.secrets.sealing import unseal_definition_secrets


def _details(messages: list[str]) -> dict[str, list[dict[str, str]]]:
    return {"errors": [{"message": m} for m in messages]}


def _resolve_version_body(function_id: str, version: str) -> dict[str, Any]:
    try:
        return _function_storage.load_version(function_id, version)
    except LookupError as exc:
        msg = f"Function '{function_id}' version '{version}' not found"
        raise NotFoundException(message=msg, details=_details([msg])) from exc


def _refuse_draft(errors: list[dict[str, Any]]) -> None:
    msg = f"Function draft has {len(errors)} validation error(s)"
    raise UnprocessableEntityException(message=msg, details={"errors": errors})


def _checked_draft(
    function_id: str, draft: Mapping[str, Any], source: Mapping[str, Any]
) -> dict[str, Any]:
    """The draft over its source version, unsealed, once it passes the checks a create runs."""
    definition = unseal_definition_secrets(function_service.draft_over_source(draft, source))
    structural = _function_storage.validate_structural(definition)
    if structural:
        _refuse_draft([{"message": message} for message in structural])
    try:
        # As on a Test run, the run refuses a Function Block's Required input left empty.
        function_service.refuse_invalid_body(
            function_id, definition, required_function_inputs=False
        )
    except function_service.SaveValidationError as exc:
        _refuse_draft(exc.errors)
    return definition


def start_function_run(
    function_id: str,
    *,
    version: str | None,
    draft: Mapping[str, Any] | None,
    environment_id: str,
    debug: workbench_service.DebugRunOptions | None = None,
    session_id: str | None = None,
    variables: Mapping[str, Any] | None = None,
    function_variables: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run a published version of a Function, or an edit-mode draft of it, standalone."""
    try:
        _function_storage.load_function(function_id)
    except LookupError as exc:
        msg = f"Function '{function_id}' not found"
        raise NotFoundException(message=msg, details=_details([msg])) from exc

    if version is None:
        msg = "'version' is required"
        raise UnprocessableEntityException(message=msg, details=_details([msg]))

    source = _resolve_version_body(function_id, version)
    if draft is None:
        function_def = unseal_definition_secrets(source)
    else:
        function_def = _checked_draft(function_id, draft, source)

    function_name = function_def.get("name") or "function"
    return workbench_service.start_standalone_function_run(
        function_def=function_def,
        function_name=function_name,
        function_id=function_id,
        environment_id=environment_id,
        debug=debug,
        session_id=session_id,
        variables=variables,
        function_variables=function_variables,
    )


def sweep_scratch(session_id: str) -> None:
    """Tear down a standalone-run session (library-View sweep). Idempotent."""
    workbench_service.clear_standalone_function_session(session_id)
