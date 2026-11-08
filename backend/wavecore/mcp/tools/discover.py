"""Discover tool handlers: catalog, entities, variables, executions.

Handlers are plain sync functions calling wavecore services in-process; the
catalog reads the live plugin/control registries, never file storage.
"""

from collections.abc import Callable
from typing import Any

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.services import variable_service
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.functions import service as function_service
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.shared import read_secret_variables
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_service
from wavecore.controls.registry import list_latest_control_metadata
from wavecore.core.plugin_registry import list_plugins
from wavecore.core.recipes.validator import remote_execution_entry
from wavecore.core.secrets.sealing import mask_definition_function_secrets
from wavecore.plugins.base import PROXY_NOT_APPLICABLE, PluginBase

STUB_GUIDANCE = "Not yet implemented - do not use in authored tests."

_LIST_ALL = 10_000
EXECUTION_STATUSES = ("pending", "running", "passed", "failed", "stopped")
ENTITY_TYPES = ("test", "suite", "regression")


def _remote_execution_entry() -> dict[str, Any]:
    """The container entry, its setting and output taken from the recipe compiler's entry."""
    remote = remote_execution_entry()
    return {
        "id": remote.id,
        "name": remote.name,
        "kind": "container",
        "category": "remote",
        "version": remote.version,
        "description": (
            "Container that runs its body blocks on a remote host over an open SSH "
            "session. Blocks are placed in the body via the 'body' handle."
        ),
        "parameter_schema": [dict(param) for param in remote.parameters.values()],
        "output_schema": [
            {"name": name, "type": output_type} for name, output_type in remote.outputs.items()
        ],
        "structure_hints": {
            "type": "scoped",
            "has_body": True,
            "branches": ["body", "then"],
            "egress": "then",
        },
        "proxy_support": PROXY_NOT_APPLICABLE,
        "implemented": True,
    }


def _as_dict(item: Any) -> Any:
    return item if isinstance(item, dict) else item.model_dump()


def _plugin_entry(plugin: PluginBase) -> dict[str, Any]:
    metadata = plugin.metadata
    parameters = [_as_dict(param) for param in metadata.get("parameters") or []]
    output_schema = [_as_dict(field) for field in metadata.get("output_schema") or []]
    implemented = bool(parameters or output_schema)
    entry: dict[str, Any] = {
        "id": metadata["id"],
        "name": metadata.get("name", ""),
        "kind": "plugin",
        "category": metadata.get("category", ""),
        "version": metadata.get("version", ""),
        "description": metadata.get("description", ""),
        "parameters": parameters,
        "output_schema": output_schema,
        "return_type": metadata.get("return_type"),
        "remotable": bool(metadata.get("remotable", False)),
        "proxy_support": plugin.proxy_support,
        "implemented": implemented,
    }
    if not implemented:
        entry["guidance"] = STUB_GUIDANCE
    return entry


def _control_entry(metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(metadata["id"].value),
        "name": metadata.get("name", ""),
        "kind": "control",
        "category": metadata.get("category", ""),
        "version": metadata.get("version", ""),
        "description": metadata.get("description", ""),
        "parameter_schema": [_as_dict(param) for param in metadata.get("parameter_schema") or []],
        "output_schema": [_as_dict(field) for field in metadata.get("output_schema") or []],
        "structure_hints": dict(metadata.get("structure_hints") or {}),
        "proxy_support": PROXY_NOT_APPLICABLE,
        "implemented": True,
    }


def list_blocks() -> dict[str, Any]:
    """The full block catalog from the live registries: plugins, controls, containers."""
    blocks = [_plugin_entry(plugin) for plugin in list_plugins()]
    blocks.extend(_control_entry(metadata) for metadata in list_latest_control_metadata())
    blocks.append(_remote_execution_entry())
    return {"blocks": blocks}


def get_block(block_id: str) -> dict[str, Any]:
    """One full catalog entry by block id."""
    blocks: list[dict[str, Any]] = list_blocks()["blocks"]
    for block in blocks:
        if block["id"] == block_id:
            return block
    raise NotFoundException(f"Block '{block_id}' not found")


def list_functions(search: str | None = None) -> list[dict[str, Any]]:
    """Published Function contract cards: summary + latest-version typed inputs/outputs."""
    rows = function_service.list_functions(search=search or "", per_page=_LIST_ALL)["data"]
    cards: list[dict[str, Any]] = []
    for row in rows:
        contract = function_service.resolve_version_contract(
            row["id"], row.get("latest_version", "")
        ) or {"inputs": [], "outputs": []}
        # A secret output default reads masked in every read tool (SECUI-11).
        shown = mask_definition_function_secrets(contract)
        cards.append({**row, "inputs": shown["inputs"], "outputs": shown["outputs"]})
    return cards


def get_function(function_id: str, version: str | None = None) -> dict[str, Any]:
    """Deep inspect: the full composed definition plus dependents."""
    if version:
        try:
            definition, _etag = function_service.read_version(function_id, version)
        except LookupError as exc:
            raise NotFoundException(str(exc)) from exc
    else:
        definition, _etag = function_service.get_function(function_id)
    dependents = function_service.get_function_dependents(function_id)
    return {**definition, "dependents": dependents}


def _test_summary_row(test: dict[str, Any]) -> dict[str, Any]:
    metadata = test.get("metadata") or {}
    return {
        "id": test.get("id"),
        "name": test.get("name", ""),
        "description": test.get("description", ""),
        "tags": list(metadata.get("tags") or []),
        "version": test.get("version", ""),
        "status": metadata.get("status", "never_run"),
        "last_run": metadata.get("last_run"),
    }


def list_tests(search: str | None = None, tag: str | None = None) -> list[dict[str, Any]]:
    """Test summaries with optional name/description search and tag filter."""
    result = test_service.list_tests(search=search, tags=[tag] if tag else None, per_page=_LIST_ALL)
    return [_test_summary_row(test) for test in result["tests"]]


def _resolve_ref(
    ref: str,
    *,
    type_label: str,
    get_by_id: Callable[[str], dict[str, Any] | None],
    list_all: Callable[[], list[dict[str, Any]]],
) -> dict[str, Any]:
    """Resolve an entity reference by id first, then by unique name."""
    entity = get_by_id(ref)
    if entity is not None:
        return entity
    matches = [row for row in list_all() if row.get("name") == ref]
    if not matches:
        raise NotFoundException(f"{type_label.capitalize()} '{ref}' not found")
    if len(matches) > 1:
        raise ValidationException(f"Multiple {type_label}s named '{ref}'; use the id")
    resolved = get_by_id(matches[0]["id"])
    if resolved is None:
        raise NotFoundException(f"{type_label.capitalize()} '{ref}' not found")
    return resolved


def resolve_test(ref: str) -> dict[str, Any]:
    """A test by id or unique name (shared with the Run family)."""
    return _resolve_ref(
        ref,
        type_label="test",
        get_by_id=test_service.get_test,
        list_all=lambda: test_service.list_tests(per_page=_LIST_ALL)["tests"],
    )


def get_test(test_ref: str) -> dict[str, Any]:
    """Test summary, masked variables, block inventory, and validation state."""
    test = resolve_test(test_ref)
    workflow = test.get("workflow") or {}
    blocks = [
        {
            "label": (node.get("data") or {}).get("label", ""),
            "elementType": (node.get("data") or {}).get("elementType", ""),
            "nodeType": (node.get("data") or {}).get("nodeType", ""),
        }
        for node in workflow.get("nodes") or []
    ]
    metadata = test.get("metadata") or {}
    return {
        "id": test.get("id"),
        "name": test.get("name", ""),
        "description": test.get("description", ""),
        "tags": list(metadata.get("tags") or []),
        "version": test.get("version", ""),
        "variables": test.get("variables") or {},
        "blocks": blocks,
        "validation": test_service.validate_test(str(test.get("id")), context="load") or {},
    }


def list_testdata(test_ref: str) -> dict[str, Any]:
    """The test's own files as a flat entry list, from the Test Data service."""
    test = resolve_test(test_ref)
    test_id = str(test.get("id"))
    return {
        "test_id": test_id,
        "name": test.get("name", ""),
        "entries": testdata_service.list_entries(test_id)["entries"],
    }


def _suite_row(suite: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": suite.get("id"),
        "name": suite.get("name", ""),
        "description": suite.get("description", ""),
        "tags": list(suite.get("tags") or []),
        "tests": list(suite.get("tests") or []),
        "variables": read_secret_variables(suite.get("variables") or {}),
    }


def list_suites() -> list[dict[str, Any]]:
    """Suite summaries with composition ids and masked variables."""
    rows = suite_service.list_suites(per_page=_LIST_ALL)["suites"]
    return [_suite_row(suite) for suite in rows]


def resolve_suite(ref: str) -> dict[str, Any]:
    """A suite by id or unique name (shared with the Run family)."""
    return _resolve_ref(
        ref,
        type_label="suite",
        get_by_id=suite_service.get_suite,
        list_all=lambda: suite_service.list_suites(per_page=_LIST_ALL)["suites"],
    )


def get_suite(suite_ref: str) -> dict[str, Any]:
    """Suite detail: composition (test id + name rows) and masked variables."""
    suite = resolve_suite(suite_ref)
    suite_id = str(suite.get("id"))
    tests = suite_service.get_suite_tests(suite_id) or []
    return {
        "id": suite.get("id"),
        "name": suite.get("name", ""),
        "description": suite.get("description", ""),
        "tags": list(suite.get("tags") or []),
        "tests": [{"id": row["id"], "name": row["name"]} for row in tests],
        "variables": suite.get("variables") or {},
    }


def list_regressions() -> list[dict[str, Any]]:
    """Regression summaries; the service masks variables at the boundary."""
    return list(regression_service.list_regressions(per_page=_LIST_ALL)["regressions"])


def resolve_regression(ref: str) -> dict[str, Any]:
    """A regression by id or unique name (shared with the Run family)."""
    return _resolve_ref(
        ref,
        type_label="regression",
        get_by_id=regression_service.get_regression,
        list_all=lambda: regression_service.list_regressions(per_page=_LIST_ALL)["regressions"],
    )


def get_regression(regression_ref: str) -> dict[str, Any]:
    """Regression detail: composition (suite id + name rows) and masked variables."""
    regression = resolve_regression(regression_ref)
    suites: list[dict[str, Any]] = []
    for suite_id in regression.get("suites") or []:
        suite = suite_service.get_suite(suite_id)
        suites.append({"id": suite_id, "name": suite.get("name", "") if suite else ""})
    return {
        "id": regression.get("id"),
        "name": regression.get("name", ""),
        "description": regression.get("description", ""),
        "tags": list(regression.get("tags") or []),
        "suites": suites,
        "variables": regression.get("variables") or {},
    }


def list_environments() -> list[dict[str, Any]]:
    """Environment rows from the environments service."""
    return list(environment_service.list_environments(per_page=_LIST_ALL)["environments"])


def list_profiles() -> list[dict[str, Any]]:
    """Profile rows; the service masks credential fields at the boundary."""
    return list(profile_service.list_profiles(per_page=_LIST_ALL)["profiles"])


def list_variables(scope: str) -> list[dict[str, Any]]:
    """System-scope variables, secrets masked; 'global' aliases the shared store.

    One row per variable, carrying its name, like every other listing tool."""
    if scope not in ("system", "global"):
        raise ValidationException("Scope must be 'system' or 'global'")
    variables = variable_service.get_system_variables()["variables"]
    return [
        {"name": name, **(declaration if isinstance(declaration, dict) else {"value": declaration})}
        for name, declaration in variables.items()
    ]


def list_executions(
    status: str | None = None,
    entity_type: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Recent executions, newest first."""
    if limit < 1:
        raise ValidationException("limit must be a positive integer")
    if status is not None and status not in EXECUTION_STATUSES:
        raise ValidationException(
            f"Invalid status '{status}': valid statuses are {', '.join(EXECUTION_STATUSES)}"
        )
    if entity_type is not None and entity_type not in ENTITY_TYPES:
        raise ValidationException(
            f"Invalid entity_type '{entity_type}': valid types are {', '.join(ENTITY_TYPES)}"
        )
    result = execution_service.list_executions(
        status=[status] if status else None,
        entity_type=[entity_type] if entity_type else None,
        per_page=limit,
    )
    return [
        {
            "id": execution.get("id"),
            "name": execution.get("name", ""),
            "entity_type": execution.get("entity_type", ""),
            "status": execution.get("status", ""),
            "triggered_by": execution.get("triggered_by", ""),
            "started_at": execution.get("started_at"),
            "duration": execution.get("duration"),
        }
        for execution in result["executions"]
    ]
