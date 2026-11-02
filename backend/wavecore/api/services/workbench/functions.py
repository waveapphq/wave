"""Workbench run shim and lifecycle services (publish, detach) for Function nodes."""

from __future__ import annotations

import copy
import functools
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    UnprocessableEntityException,
    ValidationException,
)
from wavecore.api.services.functions import _storage as _function_storage
from wavecore.api.services.functions import _versioning as _function_versioning
from wavecore.api.services.functions import service as _functions_service
from wavecore.api.services.tests import service as _test_service
from wavecore.api.services.workbench._common import (
    current_instance_path,
    function_instance,
)
from wavecore.api.services.workbench.lazy_variables import LazyVariables
from wavecore.core.execution.plugin_executor import resolve_block_fields
from wavecore.core.expressions.errors import ExpressionEvaluationError
from wavecore.core.functions.block_fields import function_block_fields
from wavecore.core.secrets.sealing import unseal_definition_secrets
from wavecore.core.variables.declared_types import types_of_function
from wavecore.core.variables.usage import unused_inputs, unwritten_outputs

if TYPE_CHECKING:
    from wavecore.core.functions.executor import FunctionInvocationResult

logger = logging.getLogger(__name__)


def _load_function_definition(node_data: dict[str, Any]) -> dict[str, Any]:
    lifecycle = node_data.get("functionLifecycle", "local")
    if lifecycle == "local":
        local_def = node_data.get("localDefinition")
        if not isinstance(local_def, dict):
            raise RuntimeError("Local Function block missing localDefinition")
        return local_def
    # Edit-mode: the in-Test draft body is the execution contract (the
    # source-version definition is not consulted while editMode is true), so
    # the draft stays self-contained even if the library entry is deleted.
    draft = node_data.get("draft")
    if node_data.get("editMode") and isinstance(draft, dict):
        return draft
    function_id = node_data.get("functionId", "")
    if not function_id:
        raise RuntimeError("Shared Function block missing functionId")
    version = node_data.get("functionVersion", "")
    try:
        if version:
            definition = _function_storage.load_version(function_id, version)
        else:
            definition, _etag = _function_storage.load_function(function_id)
    except LookupError as exc:
        raise RuntimeError(str(exc)) from exc
    # Library versions are sealed at rest; Local and draft bodies unseal with the Test.
    return unseal_definition_secrets(dict(definition))


def new_instance_scope(session_id: str | None = None, path: tuple[str, ...] = ()) -> dict[str, Any]:
    """A new instance scope noting its writes; a run's masks secrets and pushes (REQ-3.2.1.5)."""
    from wavecore.api.services.workbench._common import _get_session

    if session_id is None or (session := _get_session(session_id)) is None:
        return cast(dict[str, Any], LazyVariables())
    from wavecore.api.services.workbench.service import _schedule_variable_change_push

    scope = LazyVariables(
        on_evaluated=functools.partial(
            _schedule_variable_change_push, session_id, function_path=path
        ),
        secret_registry=session.get("secret_registry"),
    )
    return cast(dict[str, Any], scope)


def resumed_instance_scope(recorded: Mapping[str, Any]) -> dict[str, Any]:
    """The scope an ad-hoc run resumes: what the session gave the instance, so a local
    variable no block wrote is seeded from its definition again (REQ-3.2.1.5)."""
    if isinstance(recorded, LazyVariables):
        return cast(dict[str, Any], recorded.given())
    return cast(dict[str, Any], LazyVariables(dict(recorded)))


def record_instance_scope(
    session_id: str | None,
    path: tuple[str, ...],
    scope: dict[str, Any],
    declared_types: Mapping[str, str],
) -> dict[str, Any]:
    """Keep ``scope`` as the session's live scope of the instance at ``path``, with its types."""
    from wavecore.api.services.workbench._common import _workbench_sessions

    session = _workbench_sessions.get(session_id) if session_id is not None else None
    if session is not None:
        session.setdefault("function_scopes", {})[path] = scope
        session.setdefault("function_scope_types", {})[path] = dict(declared_types)
        session.setdefault("started_scopes", set()).add(path)
    return scope


def staged_values(session_id: str | None, path: tuple[str, ...]) -> Mapping[str, Mapping[str, Any]]:
    """The pre-run Current values for the instance at ``path``, typed, by name (REQ-3.2.1.6)."""
    from wavecore.api.services.workbench._common import _workbench_sessions

    session = _workbench_sessions.get(session_id) if session_id is not None else None
    seed: Mapping[tuple[str, ...], Mapping[str, Mapping[str, Any]]] = (session or {}).get(
        "function_seed"
    ) or {}
    return seed.get(path) or {}


@dataclass(frozen=True)
class FunctionCanvas:
    """One canvas on a Function instance path: its graph and the instance whose body it is."""

    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    instance: dict[str, Any] | None = None
    definition: dict[str, Any] | None = None


def locate_function_instance(
    nodes: list[dict[str, Any]], node_id: str, test_id: str
) -> dict[str, Any]:
    """The Function instance ``node_id`` on a canvas, or LookupError."""
    for node in nodes:
        if node.get("id") == node_id and (node.get("data") or {}).get("nodeType") == "function":
            return node
    raise LookupError(f"Function block '{node_id}' not found in Test '{test_id}'")


def resolve_function_canvases(
    workflow: dict[str, Any], function_path: tuple[str, ...], test_id: str
) -> list[FunctionCanvas]:
    """The Test canvas, then the body of each Function instance on ``function_path``, in order."""
    canvases = [
        FunctionCanvas(list(workflow.get("nodes") or []), list(workflow.get("edges") or []))
    ]
    for node_id in function_path:
        instance = locate_function_instance(canvases[-1].nodes, node_id, test_id)
        try:
            definition = _load_function_definition(instance.get("data") or {})
        except RuntimeError as exc:
            raise LookupError(str(exc)) from exc
        body = definition.get("workflow") or {}
        canvases.append(
            FunctionCanvas(
                list(body.get("nodes") or []), list(body.get("edges") or []), instance, definition
            )
        )
    return canvases


def _log_function_entry(session_id: str, function_def: dict[str, Any], node_id: str) -> None:
    from wavecore.api.services.workbench._common import _add_execution_log

    _add_execution_log(
        session_id,
        "INFO",
        f"Entering Function '{function_def.get('name', 'function')}'",
        "FUNCTION",
        block_id=node_id,
    )


def _log_function_result(
    session_id: str,
    result: FunctionInvocationResult,
    function_def: dict[str, Any],
    node_id: str,
) -> None:
    from wavecore.api.services.workbench._common import _add_execution_log

    if result.halt_status is not None:
        log_summary = f"halted ({result.halt_scope or 'test'}) {result.halt_status}"
    elif result.status != "passed" and result.error:
        log_summary = f"completed with status {result.status}: {result.error}"
    else:
        log_summary = f"completed with status {result.status}"
    _add_execution_log(
        session_id,
        "INFO" if result.status == "passed" else "ERROR",
        f"Function '{function_def.get('name', 'function')}' {log_summary}",
        "FUNCTION",
        block_id=node_id,
    )


def _log_edit_mode_warning(
    session_id: str,
    node_data: dict[str, Any],
    function_def: dict[str, Any],
    node_id: str,
) -> None:
    """Warn once on entering a Shared Function instance that is in edit mode."""
    if not node_data.get("editMode"):
        return
    from wavecore.api.services.workbench._common import _add_execution_log

    name = function_def.get("name", "function")
    _add_execution_log(
        session_id,
        "WARN",
        f"Function '{name}' is in edit mode: changes are not published and "
        "this instance is unlinked from the shared library",
        "FUNCTION",
        block_id=node_id,
    )


def _log_unused_parameters(session_id: str, function_def: Mapping[str, Any], node_id: str) -> None:
    """One WARN per input no block uses and per output no block writes, at run start (FNCFG-5)."""
    from wavecore.api.services.workbench._common import _add_execution_log

    name = function_def.get("name", "function")
    lines = [
        *(
            f"Function '{name}' declares input '{input_name}' but no block uses it"
            for input_name in unused_inputs(function_def)
        ),
        *(
            f"Function '{name}' declares output '{output_name}' but no block writes it"
            for output_name in unwritten_outputs(function_def)
        ),
    ]
    for line in lines:
        _add_execution_log(session_id, "WARN", line, "FUNCTION", block_id=node_id)


def _secret_declarations(function_def: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    return [
        declared
        for declared in function_def.get(key) or []
        if isinstance(declared, Mapping) and declared.get("secret") and declared.get("name")
    ]


def declared_secret_names(function_def: Mapping[str, Any]) -> set[str]:
    """The inputs, outputs and local variables a Function declares secret."""
    return {
        str(declared["name"])
        for key in ("inputs", "outputs", "variables")
        for declared in _secret_declarations(function_def, key)
    }


def register_function_secrets(
    session_id: str, function_def: Mapping[str, Any], inputs: Mapping[str, Any]
) -> None:
    """Mask a Function's given secret inputs, output defaults and locals for the run (SECUI-11)."""
    from wavecore.api.services.workbench.plugins import _get_session_registry

    registry = _get_session_registry(session_id)
    if registry is None:
        return
    for declared in _secret_declarations(function_def, "inputs"):
        registry.register(str(declared["name"]), inputs.get(declared["name"]), "function")
    for declared in _secret_declarations(function_def, "outputs"):
        # Secret for this run only: the Function Block's Secret box decides on return.
        registry.hold_name(current_instance_path(), str(declared["name"]))
        _register_declared_value(registry, declared, "default")
    for declared in _secret_declarations(function_def, "variables"):
        registry.mark_name(str(declared["name"]))
        _register_declared_value(registry, declared, "value")


def _register_declared_value(registry: Any, declared: Mapping[str, Any], value_key: str) -> None:
    """A stored secret value scrubs for the run; a computed one registers when it is evaluated."""
    if not (declared.get("isExpression") or declared.get("isTemplate")):
        registry.register_value(declared.get(value_key), "function")


def _return_outputs(
    node_data: Mapping[str, Any],
    outputs: dict[str, Any],
    session_id: str,
    holder: tuple[str, ...],
) -> dict[str, Any]:
    """Outputs leave the Function flow: those its Block marks Secret stay masked, the rest plain."""
    _register_secret_outputs(node_data, outputs, session_id)
    from wavecore.api.services.workbench.plugins import _get_session_registry

    registry = _get_session_registry(session_id)
    if registry is not None:
        registry.release(holder)
    return outputs


def _register_secret_outputs(
    node_data: Mapping[str, Any], outputs: Mapping[str, Any], session_id: str
) -> None:
    """The outputs the Function Block marks Secret are registered like a plugin's (SECUI-11)."""
    from wavecore.api.services.workbench import plugins as _plugins
    from wavecore.api.services.workbench.node_helpers import _extract_node_fields

    _plugins._register_secret_outputs(
        _extract_node_fields({"data": dict(node_data)}), dict(outputs), session_id
    )


def _resolve_function_halt(
    result: FunctionInvocationResult, function_def: dict[str, Any]
) -> dict[str, Any]:
    """Translate a halted Function result into the Function Block's outputs, or raise on failed."""
    if result.halt_scope == "function":
        # Absorbed here: passed/skipped continue the outer flow; failed raises (Try/Catch).
        if result.halt_status == "failed":
            function_name = function_def.get("name", "function")
            raise RuntimeError(result.halt_message or f"Function '{function_name}' halted (failed)")
        outputs_dict = dict(result.outputs)
        if result.halt_status == "skipped":
            outputs_dict["__function_skipped"] = True
        return outputs_dict
    # Other scopes re-emit the halt so the parent engine's signal extractor drains it.
    outputs_dict = dict(result.outputs)
    outputs_dict["__halt"] = True
    outputs_dict["__halt_scope"] = result.halt_scope
    outputs_dict["__halt_status"] = result.halt_status
    outputs_dict["__halt_message"] = result.halt_message
    return outputs_dict


def _resolved_inputs(
    node_fields: Mapping[str, Any],
    function_def: dict[str, Any],
    variables: Mapping[str, Any],
    session_id: str,
    node_id: str,
) -> dict[str, Any]:
    """The Function Block's fields resolved over the outer flow like any Block's (REQ-3.1.1.5).

    A refusal prints the result line and fails the Block before its Function flow starts.
    """
    from wavecore.core.functions.executor import FunctionInvocationResult

    try:
        return resolve_block_fields(
            node_fields["config_values"],
            function_block_fields(function_def),
            expression_fields=node_fields["expression_fields"],
            template_fields=node_fields["template_fields"],
            element_types={},
            variables=variables,
            session_id=session_id,
            exact_numbers=True,
        )
    except (ExpressionEvaluationError, ValueError) as exc:
        refused = FunctionInvocationResult(status="failed", error=str(exc))
        _log_function_result(session_id, refused, function_def, node_id)
        raise RuntimeError(str(exc)) from exc


async def handle_function_node(
    node_fields: dict[str, Any],
    variables: dict[str, Any],
    session_id: str,
    node_id: str,
) -> dict[str, Any]:
    """Execute the Function instance referenced by ``node_fields``.

    Returns a dict keyed by declared output name so the engine's existing
    ``_assign_output_bindings`` helper can map outputs to the outer flow's variables.
    """
    from wavecore.core.functions.executor import execute_function

    node_data = node_fields["node_data"]
    function_def = _load_function_definition(node_data)

    _log_function_entry(session_id, function_def, node_id)
    _log_edit_mode_warning(session_id, node_data, function_def, node_id)
    _log_unused_parameters(session_id, function_def, node_id)

    path = (*current_instance_path(), node_id)
    scope = record_instance_scope(
        session_id,
        path,
        new_instance_scope(session_id, path),
        types_of_function(function_def, every_input=True),
    )
    inputs = _resolved_inputs(node_fields, function_def, variables, session_id, node_id)
    with function_instance(path):
        result = await execute_function(
            function_def=function_def,
            inputs=inputs,
            session_id=session_id,
            scope=scope,
            staged=staged_values(session_id, path),
        )

    _log_function_result(session_id, result, function_def, node_id)

    if result.halt_status is not None:
        return _return_outputs(
            node_data, _resolve_function_halt(result, function_def), session_id, path
        )

    if result.status != "passed":
        # The Function boundary converts an inner scope failure into an outer
        # exception, so the parent engine treats it like any failed node.
        if result.error is not None:
            raise RuntimeError(result.error)
        function_name = function_def.get("name", "function")
        raise RuntimeError(f"Function '{function_name}' body failed (scope failure)")

    return _return_outputs(node_data, dict(result.outputs), session_id, path)


def _details(messages: list[str]) -> dict[str, list[dict[str, str]]]:
    return {"errors": [{"message": m} for m in messages]}


def _find_node(test: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    workflow = test.get("workflow") or {}
    for node in workflow.get("nodes") or []:
        if isinstance(node, dict) and node.get("id") == node_id:
            return node
    return None


def _replace_node(test: dict[str, Any], node_id: str, new_node: dict[str, Any]) -> None:
    workflow = test.setdefault("workflow", {"nodes": [], "edges": []})
    nodes = workflow.get("nodes") or []
    for i, node in enumerate(nodes):
        if isinstance(node, dict) and node.get("id") == node_id:
            nodes[i] = new_node
            return


def _touch_test_timestamp(test: dict[str, Any]) -> None:
    from datetime import UTC, datetime

    test["updated_at"] = datetime.now(UTC).isoformat()


def _load_test_and_node(test_id: str, node_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resolve (test, node) by id, raising NotFoundException with precise wording
    (``Test '{id}' not found`` / ``Block '{id}' not found in Test '{id}'``)."""
    test = _test_service._load_test(test_id)
    if test is None:
        msg = f"Test '{test_id}' not found"
        raise NotFoundException(message=msg, details=_details([msg]))
    node = _find_node(test, node_id)
    if node is None:
        msg = f"Block '{node_id}' not found in Test '{test_id}'"
        raise NotFoundException(message=msg, details=_details([msg]))
    return test, node


def _validate_publish_name(name: str) -> None:
    if not name.strip():
        msg = "Function name is required"
        raise ValidationException(message=msg, details=_details([msg]))
    if len(name) > _function_storage.NAME_MAX_LENGTH:
        msg = f"Function name '{name}' exceeds {_function_storage.NAME_MAX_LENGTH} characters"
        raise ValidationException(message=msg, details=_details([msg]))
    if _functions_service._name_already_taken(name, _functions_service.library_summaries()):
        msg = f"Function name '{name}' is already in use"
        raise ConflictException(message=msg, details=_details([msg]))


def _resolve_publish_version(payload: dict[str, Any]) -> str:
    raw_version = payload.get("version") or "1.0.0"
    version_str = raw_version if isinstance(raw_version, str) else ""
    if len(version_str) > _function_versioning.MAX_VERSION_LENGTH:
        msg = (
            f"Function version '{raw_version}' exceeds the maximum length of "
            f"{_function_versioning.MAX_VERSION_LENGTH} characters"
        )
        raise ValidationException(message=msg, details=_details([msg]))
    if not _function_versioning.is_valid_version(version_str):
        msg = f"Function version '{raw_version}' is not a valid semver"
        raise ValidationException(message=msg, details=_details([msg]))
    return version_str


def _build_library_payload(
    name: str,
    payload: dict[str, Any],
    local_def: dict[str, Any],
    version_str: str,
) -> dict[str, Any]:
    return {
        "name": name,
        "description": payload.get("description") or "",
        "tags": list(payload.get("tags") or []),
        "changelog": payload.get("changelog") or "",
        "details": payload.get("details") or "",
        **_function_storage.function_body(local_def),
        "version": version_str,
    }


def _create_library_entry(library_payload: dict[str, Any]) -> dict[str, Any]:
    """Wrap `create_function` with the publish-specific exception remapping."""
    try:
        definition, _etag = _functions_service.create_function(library_payload)
        return definition
    except ValidationException as exc:
        if "is already in use" in (exc.message or ""):
            raise ConflictException(message=exc.message, details=exc.details) from exc
        raise
    except _functions_service.SaveValidationError as exc:
        first = exc.errors[0]["message"] if exc.errors else "Function body is invalid"
        raise UnprocessableEntityException(message=first, details={"errors": exc.errors}) from exc


def publish_local_function(
    test_id: str,
    node_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Promote a local Function node to a published library entry.

    Atomically creates the library record via ``services.functions.create_function``
    and rewrites the owning Test's node from ``functionLifecycle="local"``
    to ``functionLifecycle="shared"`` carrying the new ``functionId``. The
    library entry never carries per-instance Profile bindings; those live on
    the Test node and are preserved across the transition.

    Rolls the library entry back if the Test save fails so the system can
    never persist a half-published state.
    """
    test, node = _load_test_and_node(test_id, node_id)
    data = node.get("data") or {}
    is_function = data.get("nodeType") == "function"
    is_local = data.get("functionLifecycle", "local") == "local"
    local_def = (
        data.get("localDefinition") if isinstance(data.get("localDefinition"), dict) else None
    )
    if not is_function or not is_local or local_def is None:
        msg = f"Block '{node_id}' is not a local Function"
        raise ConflictException(message=msg, details=_details([msg]))

    raw_name = payload.get("name", "")
    name = raw_name if isinstance(raw_name, str) else ""
    _validate_publish_name(name)
    version_str = _resolve_publish_version(payload)

    library_payload = _build_library_payload(name, payload, local_def, version_str)
    definition = _create_library_entry(library_payload)
    function_id = definition["id"]

    new_data = {k: v for k, v in data.items() if k != "localDefinition"}
    new_data["functionLifecycle"] = "shared"
    new_data["functionId"] = function_id
    new_data["functionVersion"] = version_str
    new_node = dict(node)
    new_node["data"] = new_data
    new_test = copy.deepcopy(test)
    _replace_node(new_test, node_id, new_node)
    _touch_test_timestamp(new_test)

    try:
        _test_service._save_test(new_test)
    except Exception:
        try:
            _function_storage.delete_function_file(function_id)
        except LookupError:
            pass
        raise

    return {
        "function_id": function_id,
        "version": version_str,
        "node": new_node,
    }


def _detach_source(function_id: str, version: str) -> dict[str, Any]:
    """The library definition Make local copies: the pinned version, else the latest."""
    try:
        latest, _etag = _function_storage.load_function(function_id)
    except LookupError as exc:
        msg = f"Library entry '{function_id}' does not exist"
        raise NotFoundException(message=msg, details=_details([msg])) from exc
    if not version:
        return latest
    try:
        return _function_storage.load_version(function_id, version)
    except LookupError as exc:
        msg = f"Pinned version {version} is no longer available in the library"
        raise NotFoundException(message=msg, details=_details([msg])) from exc


def detach_published_instance(
    test_id: str,
    node_id: str,
) -> dict[str, Any]:
    """Deep-copy the pinned library version into the owning Test as a local Function."""
    test, node = _load_test_and_node(test_id, node_id)
    data = node.get("data") or {}
    is_function = data.get("nodeType") == "function"
    is_shared = data.get("functionLifecycle") == "shared"
    function_id = data.get("functionId") if isinstance(data.get("functionId"), str) else ""
    if not is_function or not is_shared or not function_id:
        msg = f"Block '{node_id}' is not a published Function reference"
        raise ConflictException(message=msg, details=_details([msg]))

    library_entry = _detach_source(function_id, str(data.get("functionVersion") or ""))

    new_local_definition = {
        "name": library_entry.get("name", ""),
        "description": library_entry.get("description", ""),
        "tags": list(library_entry.get("tags") or []),
        **_function_storage.function_body(library_entry),
    }

    new_data = {k: v for k, v in data.items() if k != "functionId"}
    new_data["functionLifecycle"] = "local"
    new_data["localDefinition"] = new_local_definition

    new_node = dict(node)
    new_node["data"] = new_data

    new_test = copy.deepcopy(test)
    _replace_node(new_test, node_id, new_node)
    _touch_test_timestamp(new_test)

    _test_service._save_test(new_test)

    return {"node": new_node}
