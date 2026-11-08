"""Test service layer for business logic (REQ-5.2.4.3).

This module provides the service layer for test workflow operations.
It acts as an intermediary between API routes and the storage layer,
providing test lifecycle management, version control, workflow management,
variable configuration, and validation.

Tests are composable workflows built from blocks with sequential and parallel
execution paths, control flow structures, and variable management, forming the
executable units within suites and regressions.
"""

import ast
import hashlib
import json
import logging
import re
import uuid
import zipfile
from collections.abc import Callable, Collection, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.exceptions import (
    ConflictException,
    ValidationException,
    WaveException,
)
from wavecore.api.services import file_tree, shared
from wavecore.api.services.block_node_checks import (
    READ_ONLY_CODE,
    REMOVE_BLOCK,
    block_type_registered,
    error_entry,
    validate_node_element_type,
    validate_node_metadata,
    validate_read_only_expressions,
    variable_read_only_violation,
)
from wavecore.api.services.block_schema import BlockSchema, block_schema
from wavecore.api.services.entity_cache import DirectoryCache
from wavecore.api.services.storage_paths import entity_dir, get_tests_storage_path, is_entity_id
from wavecore.api.services.tests import testdata_service
from wavecore.api.services.typed_numbers import store_workflow_numbers
from wavecore.api.services.variable_service import refuse_value_problems
from wavecore.api.services.workbench.block_source import node_type_name
from wavecore.core.execution.field_checks import (
    FieldFinding,
    check_block_fields,
    is_blank_expression,
)
from wavecore.core.execution.row_checks import literal_row_findings
from wavecore.core.expressions.template import _TEMPLATE_PATTERN
from wavecore.core.functions.declarations import (
    VARIABLE_NAME_PATTERN,
    declaration_problems,
    declared_value_of,
)
from wavecore.core.functions.references import function_holders, nested_function_workflows
from wavecore.core.secrets import masking_settings
from wavecore.core.secrets.sealing import (
    mask_workflow_function_secrets,
    read_workflow_secrets,
    restore_masked_workflow_secrets,
    seal_variables,
    seal_workflow_node_secrets,
    unseal_variables,
)
from wavecore.core.utf8_text import load_yaml
from wavecore.core.variables.computed import extract_expression_names
from wavecore.core.variables.usage import (
    NameSite,
    SiteKind,
    block_sites,
    block_write_sites,
)
from wavecore.models.plugins import (
    ENGINE_DISPATCHED_ELEMENT_TYPES,
    get_param_attr,
    resolve_output_type,
)

logger = logging.getLogger(__name__)

_TEST_FILENAME = "test.yaml"
# Each block site naming a variable, with the block it sits in.
_FoundSites = list[tuple[dict[str, Any], NameSite]]
_SOURCE_KINDS = frozenset({SiteKind.EXPRESSION, SiteKind.TEMPLATE})

# In-memory cache for test metadata (everything except workflow).
# The storage directory is the record; this cache is reconciled against it on read.
_test_cache: dict[str, dict[str, Any]] = {}


def _node_binding_pids(node: Any) -> list[str]:
    """Extract profile ids from a single workflow node's profileBindings.

    Returns an empty list when the node shape is anything other than the
    expected dict/data/config/profileBindings nested structure.
    """
    if not isinstance(node, dict):
        return []
    data = node.get("data")
    if not isinstance(data, dict):
        return []
    cfg = data.get("config")
    if not isinstance(cfg, dict):
        return []
    bindings = cfg.get("profileBindings") or []
    pids: list[str] = []
    for binding in bindings:
        if isinstance(binding, dict):
            pid = binding.get("profileId")
            if pid:
                pids.append(pid)
    return pids


def _collect_profile_refs(test: dict[str, Any]) -> list[str]:
    """Collect every profile id this test references (metadata + node bindings).

    Returned at view-extraction time so callers in profile usage paths don't
    have to reload the full workflow from disk. Tolerant of malformed
    workflow shapes (e.g., nodes that aren't dicts) - those are simply skipped
    so this can run on every saved test, including invalid ones loaded from
    disk.
    """
    refs: set[str] = set()
    meta_pid = (test.get("metadata") or {}).get("profile_id")
    if meta_pid:
        refs.add(meta_pid)
    workflow = test.get("workflow") or {}
    nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
    if isinstance(nodes, list):
        for node in nodes:
            refs.update(_node_binding_pids(node))
    return sorted(refs)


def _extract_test_view(test: dict[str, Any]) -> dict[str, Any]:
    """Extract a metadata-only view from a full test dict (strips workflow)."""
    view = {k: v for k, v in test.items() if k != "workflow"}
    view["_profile_refs"] = _collect_profile_refs(test)
    return view


def _test_metadata_defect(test: dict[str, Any]) -> str | None:
    """The field beyond id that every listing dereferences unconditionally."""
    if not isinstance(test.get("metadata", {}), dict):
        return "metadata is not a mapping"
    return None


_test_directory = DirectoryCache(
    label="test",
    filename=_TEST_FILENAME,
    storage_dir=get_tests_storage_path,
    cache=lambda: _test_cache,
    logger=logger,
    view=_extract_test_view,
    defect=_test_metadata_defect,
)


def _read_test_document(test_id: str) -> dict[str, Any] | None:
    """One stored test, or None when its file cannot be turned into a test."""
    return _test_directory.read(test_id)


def _reconcile_cache() -> None:
    """Sync the in-memory cache with the storage directory, which is the record."""
    _test_directory.reconcile()


def _clear_in_memory_cache() -> None:
    """Clear in-memory cache without touching disk storage."""
    _test_directory.clear()


class SaveValidationError(Exception):
    """Raised when validation fails during save, blocking the write."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        self.errors = errors
        super().__init__(f"Validation failed with {len(errors)} error(s)")


class ReadOnlyExpressionImportError(ValidationException):
    """An imported test carries an expression that would change a variable."""

    def __init__(self, message: str, errors: list[dict[str, Any]]) -> None:
        super().__init__(message)
        self.errors = errors


class VariableValueImportError(ValidationException):
    """An imported test holds a variable value the number rule refuses (REQ-3.1.3.14)."""


def _collect_repairs(
    errors: list[dict[str, Any]],
    removed_nodes: set[str],
    removed_edges: list[dict[str, Any]],
    node_labels: dict[str, str],
) -> list[dict[str, Any]]:
    """Describe the deletions the autofix pass made, for the caller's reply."""
    codes = {
        error.get("node_id"): error.get("code", "")
        for error in errors
        if error.get("code", "") in _NODE_REMOVAL_CODES and error.get("node_id")
    }
    repairs: list[dict[str, Any]] = [
        {
            "kind": "node",
            "id": node_id,
            "label": node_labels.get(node_id, node_id),
            "code": codes.get(node_id, ""),
            "message": f"Block '{node_labels.get(node_id, node_id)}' was removed",
        }
        for node_id in sorted(removed_nodes)
    ]
    repairs.extend(
        {
            "kind": "edge",
            "id": edge.get("id", ""),
            "code": "",
            "message": (f"Connection {edge.get('source')} -> {edge.get('target')} was removed"),
        }
        for edge in removed_edges
    )
    return repairs


_ContractLoader = Callable[[str, str], dict[str, Any] | None]
_ReferenceIndex = Mapping[str, Collection[str]]


@dataclass(frozen=True)
class _FunctionLibrary:
    """The Function library a Test is validated against."""

    registry: Mapping[str, Any]
    load_contract: _ContractLoader
    reference_index: _ReferenceIndex


def _apply_safe_autofixes(
    test: dict[str, Any],
    repairs: list[dict[str, Any]] | None = None,
    *,
    function_registry: Mapping[str, Any] | None = None,
    contract_loader: _ContractLoader | None = None,
    reference_index: _ReferenceIndex | None = None,
) -> dict[str, Any]:
    """Stage 1 of the unified write-path pipeline.

    Runs save-context validation, applies structural autofixes
    (NODE_FIX_CODES + EDGE_FIX_CODES + VARIABLE_FIX_CODES) in-place, and
    returns the (mutated) test dict. Visible-class codes
    (REQUIRED_PARAM_MISSING/EMPTY, INVALID_OUTPUT_BINDING_TYPE) are NOT
    auto-fixable and remain to be surfaced by `_validate_for_persist`.
    Deletions are recorded into `repairs` when the caller supplies a list.
    """
    workflow = test.get("workflow") or {"nodes": [], "edges": []}
    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])

    validation = _validate_test_data(
        test,
        context="save",
        function_registry=function_registry,
        contract_loader=contract_loader,
        reference_index=reference_index,
    )
    if validation.get("fatal"):
        return test

    node_labels = {
        node.get("id"): (node.get("data") or {}).get("label") or node.get("id")
        for node in nodes
        if node.get("id")
    }
    edges_before = {id(edge): edge for edge in edges}

    errors = validation.get("errors", [])
    nodes, edges, nodes_to_remove = _apply_error_fixes(errors, test, nodes, edges)
    nodes, edges = _post_fix_edge_cleanup(nodes, edges, nodes_to_remove)

    if repairs is not None:
        kept = {id(edge) for edge in edges}
        repairs.extend(
            _collect_repairs(
                errors,
                {node_id for node_id in nodes_to_remove if node_id},
                [edge for key, edge in edges_before.items() if key not in kept],
                node_labels,
            )
        )

    workflow["nodes"] = nodes
    workflow["edges"] = edges
    test["workflow"] = workflow
    return test


def _validate_for_persist(
    test: dict[str, Any],
    repairs: list[dict[str, Any]] | None = None,
    *,
    function_registry: Mapping[str, Any] | None = None,
    contract_loader: _ContractLoader | None = None,
    reference_index: _ReferenceIndex | None = None,
) -> list[dict[str, Any]]:
    """Stage 2 of the unified write-path pipeline.

    Runs `_apply_safe_autofixes` then re-validates at save context. Returns
    the residual user-actionable errors. The caller raises
    `SaveValidationError(errors)` if non-empty.
    """
    _apply_safe_autofixes(
        test,
        repairs,
        function_registry=function_registry,
        contract_loader=contract_loader,
        reference_index=reference_index,
    )
    validation = _validate_test_data(
        test,
        context="save",
        function_registry=function_registry,
        contract_loader=contract_loader,
        reference_index=reference_index,
    )
    return list(validation.get("errors", []))


def _process_variables_for_save(
    submitted_variables: dict[str, Any],
) -> dict[str, Any]:
    """Process variables for saving: drop the response-only ``masked`` flag."""
    variables: dict[str, Any] = {}

    for name, var_info in submitted_variables.items():
        if isinstance(var_info, dict):
            variables[name] = {k: v for k, v in var_info.items() if k != "masked"}
        else:
            variables[name] = var_info

    return variables


def _clear_storage() -> None:
    """Clear all test storage and reset storage instance."""
    import shutil

    _test_directory.clear()
    storage_dir = get_tests_storage_path()
    if storage_dir.exists():
        shutil.rmtree(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)


def _get_raw_test(test_id: str) -> dict[str, Any] | None:
    """Get raw test data without masking secrets."""
    return _load_test(test_id)


def _update_raw_test(test_id: str, updates: dict[str, Any]) -> None:
    """Update raw test data directly without validation."""
    test = _load_test(test_id)
    if test:
        test.update(updates)
        _save_test(test)


def _set_version_attribute(test_id: str, version: str, attr: str, value: Any) -> None:
    """Set attribute on a version entry."""
    versions = _load_versions(test_id)
    for v in versions:
        if v["version"] == version:
            v[attr] = value
            break
    _save_versions(test_id, versions)


def _ensure_storage_dir() -> None:
    """Ensure storage directory exists."""
    get_tests_storage_path().mkdir(parents=True, exist_ok=True)


def _get_test_dir(test_id: str) -> Path:
    """Get directory path for a test."""
    return entity_dir(get_tests_storage_path(), test_id)


def _load_test(test_id: str) -> dict[str, Any] | None:
    """Load test from file storage, forgetting the cached entry when the file is gone."""
    if not is_entity_id(test_id):
        return None
    test_file = _get_test_dir(test_id) / _TEST_FILENAME
    if not test_file.exists():
        _test_directory.forget(test_id)
        return None
    with open(test_file, encoding="utf-8") as f:
        data: dict[str, Any] | None = yaml.safe_load(f)
        return data


def _drop_local_input_defaults(workflow: Any) -> None:
    """A secret input of a Function the Test holds keeps no default."""
    from wavecore.api.services.functions._storage import drop_secret_input_defaults

    for holder in function_holders(workflow):
        drop_secret_input_defaults(holder)
        _drop_local_input_defaults(holder.get("workflow"))


def _save_test(test: dict[str, Any]) -> None:
    """Save test to file storage and update in-memory cache."""
    _ensure_storage_dir()
    if "variables" in test:
        test["variables"] = seal_variables(shared.stored_variable_values(test["variables"]))
    if isinstance(test.get("workflow"), dict):
        from wavecore.api.services.functions.service import secret_input_names

        store_workflow_numbers(test["workflow"])
        _drop_local_input_defaults(test["workflow"])
        test["workflow"] = seal_workflow_node_secrets(
            test["workflow"], secret_inputs=secret_input_names
        )
    test_dir = _get_test_dir(test["id"])
    test_dir.mkdir(parents=True, exist_ok=True)
    test_file = test_dir / _TEST_FILENAME
    with open(test_file, "w", encoding="utf-8") as f:
        yaml.dump(test, f, default_flow_style=False, sort_keys=False)
    # Update cache with metadata view (no workflow)
    _test_cache[test["id"]] = _extract_test_view(test)


def _delete_test_files(test_id: str) -> None:
    """Delete all files for a test and remove from in-memory cache."""
    test_dir = _get_test_dir(test_id)
    if test_dir.exists():
        for file in test_dir.iterdir():
            file.unlink()
        test_dir.rmdir()
    _test_cache.pop(test_id, None)


def _load_versions(test_id: str) -> list[dict[str, Any]]:
    """Load version history from file storage."""
    versions_file = _get_test_dir(test_id) / "versions.yaml"
    if not versions_file.exists():
        return []
    with open(versions_file, encoding="utf-8") as f:
        return yaml.safe_load(f) or []


def _save_versions(test_id: str, versions: list[dict[str, Any]]) -> None:
    """Save version history to file storage."""
    _ensure_storage_dir()
    test_dir = _get_test_dir(test_id)
    test_dir.mkdir(parents=True, exist_ok=True)
    versions_file = test_dir / "versions.yaml"
    with open(versions_file, "w", encoding="utf-8") as f:
        yaml.dump(versions, f, default_flow_style=False, sort_keys=False)


def _list_all_tests() -> list[dict[str, Any]]:
    """List all tests from in-memory cache (metadata views, no workflow)."""
    _reconcile_cache()
    return list(_test_cache.values())


def _cached_tests() -> list[dict[str, Any]]:
    """Test metadata views for counts derived elsewhere, with no directory scan.

    The Tests list reconciles; a page that only counts references into tests
    must not pay for that scan on top of its own.
    """
    _test_directory.ensure_loaded()
    return list(_test_cache.values())


def _list_all_tests_full() -> list[dict[str, Any]]:
    """Load all tests with full data including workflow. For backup/export only."""
    _reconcile_cache()
    tests = []
    # Snapshot the ids: reading a test evicts it from the cache when its file is gone.
    cached_ids = tuple(_test_cache)
    for test_id in cached_ids:
        test = _read_test_document(test_id)
        if test is not None:
            tests.append(test)
    return tests


def list_test_documents() -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    """Every stored test, whole and in stored form, each with its history rows."""
    return [(test, _load_versions(test["id"])) for test in _list_all_tests_full()]


def _generate_etag(test: dict[str, Any]) -> str:
    """Generate ETag hash for a test based on its content.

    Args:
        test: Test data dictionary

    Returns:
        Quoted hex string ETag
    """
    content = f"{test.get('id')}{test.get('version')}{test.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


def _read_workflow(workflow: Any) -> Any:
    """A workflow as a read shows it: Function secrets and credentials as their reveals say."""
    return read_workflow_secrets(workflow) if isinstance(workflow, dict) else workflow


def _reveal_or_mask_secret_variables(variables: dict[str, Any]) -> dict[str, Any]:
    """A test's secret variable values on read: masked to the placeholder by default,
    or unsealed to plaintext when the test-variables unmask is on - the flag governing
    the workbench Variable Manager panel and its watchers (REQ-3.1.3.17). Encryption at
    rest is unaffected."""
    if masking_settings.is_test_variables_revealed():
        return unseal_variables(variables)
    return shared.mask_secret_variables(variables, flag_masked=True)


def _merge_metadata_from_data(data: dict[str, Any], metadata: dict[str, Any]) -> None:
    """Merge top-level tags from data into metadata."""
    if "tags" in data:
        metadata["tags"] = data["tags"]


def _filter_by_search(tests: list[dict[str, Any]], search: str) -> list[dict[str, Any]]:
    """Filter tests by search text in name and description."""
    search_lower = search.lower()
    return [
        t
        for t in tests
        if search_lower in t.get("name", "").lower()
        or search_lower in t.get("description", "").lower()
    ]


def _filter_by_suite_ids(tests: list[dict[str, Any]], suite_ids: list[str]) -> list[dict[str, Any]]:
    """Filter tests to those referenced by any of the given suites."""
    from wavecore.api.services.suites import service as suite_service

    allowed_test_ids: set[str] = set()
    for sid in suite_ids:
        suite = suite_service.get_suite(sid)
        if suite:
            allowed_test_ids.update(suite.get("tests", []))
    return [t for t in tests if t.get("id") in allowed_test_ids]


def _test_matches_status(test: dict[str, Any], status_list: list[str]) -> bool:
    """Check if a test matches any of the given status values."""
    test_status = test.get("metadata", {}).get("status")
    for s in status_list:
        if s == "never_run":
            if test_status in (None, "never_run") or "status" not in test.get("metadata", {}):
                return True
        elif test_status == s:
            return True
    return False


_STATUS_SORT_ORDER = {
    "running": 0,
    "passed": 1,
    "failed": 2,
    "stopped": 3,
    "never_run": 4,
}

_TERMINAL_STATUSES = {"passed", "failed", "stopped"}


def _build_latest_execution_by_test_id() -> dict[str, dict[str, Any]]:
    """Most recent execution record keyed by `entity_id` for tests.

    Single pass over the executions cache; ties broken by `started_at`.
    """
    from wavecore.api.services.executions._storage import (
        _ensure_cache_loaded as _ensure_exec_cache_loaded,
    )
    from wavecore.api.services.executions._storage import (
        _execution_storage,
    )

    _ensure_exec_cache_loaded()
    latest: dict[str, dict[str, Any]] = {}
    for execution in _execution_storage.values():
        if execution.get("entity_type") != "test":
            continue
        entity_id = execution.get("entity_id")
        if not entity_id:
            continue
        prev = latest.get(entity_id)
        if prev is None or execution.get("started_at", "") > prev.get("started_at", ""):
            latest[entity_id] = execution
    return latest


def _patch_metadata_from_latest_execution(
    test: dict[str, Any], latest_by_test_id: dict[str, dict[str, Any]]
) -> None:
    """Overwrite `metadata.status` and `metadata.last_run` with values derived
    from the most recent execution for this test. If no execution exists, the
    existing metadata is preserved (defaults to `never_run`)."""
    test_id = test.get("id")
    if not test_id:
        return
    execution = latest_by_test_id.get(test_id)
    if execution is None:
        return
    metadata = test.setdefault("metadata", {})
    metadata["status"] = execution.get("status", "never_run")
    # For terminal statuses prefer the ended_at; otherwise the started_at reflects
    # when the live execution began.
    last_run = execution.get("ended_at") if execution.get("status") in _TERMINAL_STATUSES else None
    metadata["last_run"] = last_run or execution.get("started_at")


_SORT_KEY_FUNCS: dict[str, Any] = {
    "name": lambda t: t.get("name", "").lower(),
    "suite": lambda t: t.get("suite_count", 0),
    "status": lambda t: _STATUS_SORT_ORDER.get(
        t.get("metadata", {}).get("status", "never_run"), _STATUS_SORT_ORDER["never_run"]
    ),
    "lastRun": lambda t: t.get("metadata", {}).get("last_run") or "",
    "tags": lambda t: ",".join(sorted(t.get("tags", []))).lower(),
    "createdAt": lambda t: t.get("created_at") or "",
    "updatedAt": lambda t: t.get("updated_at") or "",
}


def list_tests(
    page: int = 1,
    per_page: int = 20,
    search: str | None = None,
    suite_ids: list[str] | None = None,
    tags: list[str] | None = None,
    status: list[str] | None = None,
    sort_by: str | None = None,
    sort_order: str | None = "asc",
) -> dict[str, Any]:
    """List tests with filtering and pagination.

    Args:
        page: Page number (1-based)
        per_page: Number of results per page
        search: Text search query (searches name and description)
        suite_ids: Filter by suite IDs (any match)
        tags: Filter by tags (all tags must match)
        status: Filter by execution status list (any match: passed, failed, never_run)
        sort_by: Sort by field (name, status, lastRun)
        sort_order: Sort order (asc, desc)

    Returns:
        Dictionary with tests list and pagination info
    """
    # Work on copies so metadata patching does not mutate the in-memory cache.
    filtered_tests = [t.copy() for t in _list_all_tests()]
    for t in filtered_tests:
        # Copy metadata too; the cached dict is shared.
        t["metadata"] = dict(t.get("metadata", {}))

    # Derive status/last_run from the most recent execution for each test so
    # the Tests List reflects live execution state instead of whatever was
    # persisted to test metadata at creation time.
    latest_by_test_id = _build_latest_execution_by_test_id()
    for t in filtered_tests:
        _patch_metadata_from_latest_execution(t, latest_by_test_id)

    if search:
        filtered_tests = _filter_by_search(filtered_tests, search)

    if suite_ids:
        filtered_tests = _filter_by_suite_ids(filtered_tests, suite_ids)

    if tags:
        filtered_tests = [
            t
            for t in filtered_tests
            if any(tag in tags for tag in t.get("metadata", {}).get("tags", []))
        ]

    if status:
        filtered_tests = [t for t in filtered_tests if _test_matches_status(t, status)]

    # Attach suite membership data (filtered_tests already holds copies).
    from wavecore.api.services.relations import service as relation_service

    test_ids = [t.get("id", "") for t in filtered_tests]
    membership = relation_service.get_suite_membership_bulk(test_ids)
    for t in filtered_tests:
        info = membership.get(t.get("id", ""), [])
        t["suite_count"] = len(info)
        t["suite_ids"] = [s["id"] for s in info]
        t["suite_names"] = [s["name"] for s in info]

    if sort_by:
        key_func = _SORT_KEY_FUNCS.get(sort_by, lambda t: "")
        filtered_tests = sorted(filtered_tests, key=key_func, reverse=sort_order == "desc")

    # Calculate pagination
    total = len(filtered_tests)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0
    start_idx = (page - 1) * per_page
    end_idx = start_idx + per_page

    return {
        "tests": filtered_tests[start_idx:end_idx],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


def create_test(data: dict[str, Any]) -> dict[str, Any]:
    """Create a new test.

    Args:
        data: Test data including name, description, workflow, variables, etc.

    Returns:
        Created test with metadata

    Raises:
        ConflictException: If test name already exists
    """
    name = data.get("name", "")

    # Check if test with same name already exists
    for test in _list_all_tests():
        if test.get("name") == name:
            raise ConflictException(f"Test with name '{name}' already exists")

    # Generate new test
    test_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()

    # Build metadata - merge existing with top-level tags/suite_id
    metadata = data.get("metadata", {})
    _merge_metadata_from_data(data, metadata)

    # Process variables: drop response-only fields, validate values
    raw_variables = data.get("variables", {})
    workflow = data.get("workflow", {"nodes": [], "edges": []})
    variables = _process_variables_for_save(raw_variables)

    test = {
        "id": test_id,
        "name": name,
        "version": "1.0.0",
        "description": data.get("description", ""),
        "workflow": workflow,
        "variables": variables,
        "metadata": metadata,
        "created_at": now,
        "updated_at": now,
    }
    stored_test = test.copy()

    # Unified write-path pipeline: autofix structural errors, then surface residuals.
    repairs: list[dict[str, Any]] = []
    residual = _validate_for_persist(stored_test, repairs)
    if residual:
        raise SaveValidationError(residual)

    _save_test(stored_test)
    test["variables"] = shared.mask_secret_variables(stored_test["variables"], flag_masked=True)

    # Save initial version history
    _save_versions(
        test_id,
        [
            {
                "version": "1.0.0",
                "created_at": now,
                "created_by": "system",
                "changes": "Initial version",
            }
        ],
    )

    test["repairs"] = repairs
    return test


def validate_test_data_for_create(
    data: dict[str, Any],
    *,
    check_name: bool = True,
    function_registry: Mapping[str, Any] | None = None,
    contract_loader: _ContractLoader | None = None,
    reference_index: _ReferenceIndex | None = None,
) -> list[dict[str, Any]]:
    """Dry-run the create pipeline: name-conflict scan + persist validation.

    Runs on a deep copy so the caller's dict is never mutated; persists nothing.
    """
    import copy

    errors: list[dict[str, Any]] = []
    name = data.get("name", "")
    if check_name and any(test.get("name") == name for test in _list_all_tests()):
        errors.append(
            error_entry(
                path="name",
                code="NAME_CONFLICT",
                message=f"Test with name '{name}' already exists",
            )
        )
    errors.extend(
        _validate_for_persist(
            copy.deepcopy(data),
            function_registry=function_registry,
            contract_loader=contract_loader,
            reference_index=reference_index,
        )
    )
    return errors


def validate_test_data_for_update(test_id: str, data: dict[str, Any]) -> list[dict[str, Any]]:
    """Dry-run the update pipeline: merge onto the stored test + persist validation.

    Mirrors update_test's merge on a deep copy so neither the caller's dict nor
    stored state changes; the target's own name is never flagged as a conflict.
    """
    import copy

    test = _load_test(test_id)
    if test is None:
        return [
            error_entry(path="id", code="NOT_FOUND", message=f"Test with ID '{test_id}' not found")
        ]

    merged = copy.deepcopy(test)
    payload = copy.deepcopy(data)
    if "name" in payload:
        merged["name"] = payload["name"]
    if "description" in payload:
        merged["description"] = payload["description"]
    if "workflow" in payload:
        merged["workflow"] = payload["workflow"]

    existing_metadata = merged.get("metadata", {})
    if "metadata" in payload:
        existing_metadata.update(payload["metadata"])
    _merge_metadata_from_data(payload, existing_metadata)
    merged["metadata"] = existing_metadata

    if "variables" in payload:
        restored = shared.restore_masked_secrets(payload["variables"], merged.get("variables", {}))
        merged["variables"] = _process_variables_for_save(restored)

    return _validate_for_persist(merged)


def _collect_suite_variables(
    membership: list[dict[str, str]],
    suite_service: Any,
) -> list[dict[str, str]]:
    """Merge variable metadata (name + type) from all suites containing this test.

    Types are guaranteed consistent by collision validation, so the merge is
    simply a deduplicated union.  Returns a flat list for autocomplete.
    """
    seen: dict[str, str] = {}
    for suite_info in membership:
        suite_vars = suite_service.get_suite_variables(suite_info["id"])
        if not suite_vars:
            continue
        for name, var_info in suite_vars.items():
            if name not in seen:
                var_type = (
                    var_info.get("type", "string") if isinstance(var_info, dict) else "string"
                )
                seen[name] = var_type
    return [{"name": n, "type": t} for n, t in seen.items()]


def _collect_regression_variables(
    suite_ids: list[str],
) -> list[dict[str, str]]:
    """Merge variable metadata (name + type) from all regressions containing the test's suites.

    Finds all regressions that reference any of the given suite IDs, then
    collects and deduplicates their variables into a flat list for autocomplete.
    """
    from wavecore.api.services.regressions import service as regression_service

    all_regressions = regression_service._list_all_regressions()

    suite_id_set = set(suite_ids)
    seen: dict[str, str] = {}

    for regression in all_regressions:
        reg_suites = set(regression.get("suites", []))
        if not reg_suites.intersection(suite_id_set):
            continue
        reg_vars = regression.get("variables", {})
        for name, var_info in reg_vars.items():
            if name not in seen:
                var_type = (
                    var_info.get("type", "string") if isinstance(var_info, dict) else "string"
                )
                seen[name] = var_type

    return [{"name": n, "type": t} for n, t in seen.items()]


def get_test(test_id: str) -> dict[str, Any] | None:
    """Get test by ID.

    Args:
        test_id: Test UUID

    Returns:
        Test data with masked secrets, or None if not found
    """
    test = _load_test(test_id)
    if test is None:
        return None

    result = test.copy()
    variables = {
        name: dict(var_info) if isinstance(var_info, dict) else var_info
        for name, var_info in test.get("variables", {}).items()
    }
    result["variables"] = _reveal_or_mask_secret_variables(variables)
    # The Variable Manager unmask surface also reveals plugin credential fields.
    if "workflow" in result:
        result["workflow"] = _read_workflow(result["workflow"])
    # Attach suite membership data and merged suite variables
    from wavecore.api.services.relations import service as relation_service
    from wavecore.api.services.suites import service as suite_service

    membership = relation_service.get_suites_for_test(test_id)
    result["suite_ids"] = [s["id"] for s in membership]
    result["suite_names"] = [s["name"] for s in membership]
    result["suite_variables"] = _collect_suite_variables(membership, suite_service)

    # Attach regression variables from regressions containing these suites
    suite_ids = result["suite_ids"]
    result["regression_variables"] = _collect_regression_variables(suite_ids)

    return result


def _refuse_taken_rename(test: Mapping[str, Any], data: Mapping[str, Any]) -> None:
    """Raise when the update renames the test onto a name another test holds."""
    if "name" not in data or data["name"] == test.get("name"):
        return
    if any(
        existing.get("name") == data["name"] and existing.get("id") != test.get("id")
        for existing in _list_all_tests()
    ):
        raise ConflictException(f"Test with name '{data['name']}' already exists")


def update_test(
    test_id: str, data: dict[str, Any], etag: str | None = None
) -> dict[str, Any] | None:
    """Update test.

    Args:
        test_id: Test UUID
        data: Update data
        etag: Optional ETag for concurrency control

    Returns:
        Updated test or None if not found

    Raises:
        ConflictException: If ETag mismatch or the new name is taken
        ValidationException: If the stored version is not MAJOR.MINOR.PATCH
        SaveValidationError: If validation errors remain after autofix
    """
    test = _load_test(test_id)
    if test is None:
        return None

    # Check ETag if provided
    if etag:
        current_etag = _generate_etag(test)
        if etag != current_etag:
            raise ConflictException("Precondition failed: resource has been modified")

    _refuse_taken_rename(test, data)

    new_version = shared.next_semantic_version(str(test.get("version", "1.0.0")), "minor")

    now = datetime.now(UTC).isoformat()

    # Update fields
    if "name" in data:
        test["name"] = data["name"]
    if "description" in data:
        test["description"] = data["description"]
    if "workflow" in data:
        # A read masks Function secrets, so their placeholder keeps the stored value.
        test["workflow"] = restore_masked_workflow_secrets(data["workflow"], test.get("workflow"))

    # Handle metadata updates (merge to preserve existing fields)
    existing_metadata = test.get("metadata", {})
    if "metadata" in data:
        existing_metadata.update(data["metadata"])
    _merge_metadata_from_data(data, existing_metadata)
    test["metadata"] = existing_metadata

    # Process variables through save pipeline if provided. Restore masked secrets
    # against the stored (sealed) values so a placeholder never overwrites a secret.
    if "variables" in data:
        restored = shared.restore_masked_secrets(data["variables"], test.get("variables", {}))
        test["variables"] = _process_variables_for_save(restored)

    test["version"] = new_version
    test["updated_at"] = now

    # Unified write-path pipeline: autofix structural errors, then surface residuals.
    repairs: list[dict[str, Any]] = []
    residual = _validate_for_persist(test, repairs)
    if residual:
        raise SaveValidationError(residual)

    # Save updated test
    _save_test(test)

    # Add version history
    versions = _load_versions(test_id)
    versions.append(
        {
            "version": new_version,
            "created_at": now,
            "created_by": "system",
            "changes": data.get("description", "Update"),
        }
    )
    _save_versions(test_id, versions)

    # Return copy with masked secrets
    result = test.copy()
    result["variables"] = shared.mask_secret_variables(test.get("variables", {}), flag_masked=True)
    if isinstance(test.get("workflow"), dict):
        result["workflow"] = mask_workflow_function_secrets(test["workflow"])
    result["repairs"] = repairs
    return result


def update_test_metadata(
    test_id: str, data: dict[str, Any], etag: str | None = None
) -> dict[str, Any] | None:
    """Update only test metadata (name, description, tags, suite_id).

    Does NOT update workflow or increment version.

    Args:
        test_id: Test UUID
        data: Metadata update data
        etag: Optional ETag for concurrency control

    Returns:
        Updated test or None if not found

    Raises:
        ConflictException: If ETag mismatch or duplicate name
    """
    test = _load_test(test_id)
    if test is None:
        return None

    # Check ETag if provided
    if etag:
        current_etag = _generate_etag(test)
        if etag != current_etag:
            raise ConflictException("Precondition failed: resource has been modified")

    _refuse_taken_rename(test, data)

    now = datetime.now(UTC).isoformat()

    # Update only metadata fields
    if "name" in data:
        test["name"] = data["name"]
    if "description" in data:
        test["description"] = data["description"]

    # Handle metadata updates
    existing_metadata = test.get("metadata", {})
    _merge_metadata_from_data(data, existing_metadata)
    test["metadata"] = existing_metadata

    test["updated_at"] = now

    # Save updated test (no version increment for metadata-only changes)
    _save_test(test)

    # Return copy with masked secrets
    result = test.copy()
    result["variables"] = shared.mask_secret_variables(test.get("variables", {}), flag_masked=True)
    return result


def delete_test(test_id: str) -> bool:
    """Delete test.

    Rejects with ``ConflictException`` while a tracked execution of the test,
    a Suite or Regression execution running it, or a workbench session on it
    is ``running`` or ``paused``. The exception carries the blocking IDs so
    the route layer can surface them in the 409 response.

    Args:
        test_id: Test UUID

    Returns:
        True if deleted, False if not found
    """
    from wavecore.api.exceptions import ConflictException
    from wavecore.api.services.relations import service as relation_service
    from wavecore.api.services.suites import version_service as suite_version_service

    test = _load_test(test_id)
    if test is None:
        return False

    blocking = testdata_service.running_holders(test_id)
    if blocking:
        raise ConflictException(
            f"Cannot delete test '{test_id}': execution is running or paused",
            details={"execution_ids": blocking},
        )

    # Cascade: remove test from all suites that reference it
    affected_suite_ids = relation_service.on_test_deleted(test_id)
    for suite_id in affected_suite_ids:
        suite_version_service.remove_test_from_suite(suite_id, test_id)

    # Delete test files. Tracked execution records are persisted separately
    # under the executions storage and are intentionally preserved so the
    # Historical Test Canvas can still paint past runs of a deleted test.
    _delete_test_files(test_id)
    testdata_service.delete_for_test(test_id)

    return True


def batch_create_tests(tests: list[Any]) -> dict[str, Any]:
    """Create multiple tests in a batch.

    Args:
        tests: List of test data dictionaries

    Returns:
        Dictionary with created IDs and failed items
    """
    created: list[str] = []
    failed: list[dict[str, Any]] = []

    for idx, test_data in enumerate(tests):
        try:
            test = create_test(shared.batch_object(test_data))
            created.append(test["id"])
        except SaveValidationError as e:
            failed.append({"index": idx, "error": e.errors[0]["message"]})
        except (WaveException, ValueError) as e:
            failed.append({"index": idx, "error": str(e)})

    return {"created": created, "failed": failed}


def batch_update_tests(updates: list[Any]) -> dict[str, Any]:
    """Update multiple tests in a batch.

    Args:
        updates: List of dictionaries with 'id' and update fields.
                 Supports both {id, update: {...}} and {id, metadata: {...}} formats.

    Returns:
        Dictionary with updated IDs and failed items
    """
    updated: list[str] = []
    failed: list[dict[str, Any]] = []

    for idx, item in enumerate(updates):
        try:
            update = shared.batch_object(item)
            test_id = str(update.get("id", ""))
            # Support both {id, update: {...}} and direct field formats like {id, metadata: {...}}
            update_data = shared.batch_update_fields(update)
            if not update_data:
                # If no "update" key, use remaining fields as update data
                update_data = {k: v for k, v in update.items() if k != "id"}
            result = update_test(test_id, update_data)
            if result is None:
                failed.append({"index": idx, "error": f"Test with ID '{test_id}' not found"})
            else:
                updated.append(test_id)
        except SaveValidationError as e:
            failed.append({"index": idx, "error": e.errors[0]["message"]})
        except Exception as e:
            failed.append({"index": idx, "error": str(e)})

    return {"updated": updated, "failed": failed}


def batch_delete_tests(test_ids: list[Any]) -> dict[str, Any]:
    """Delete multiple tests in a batch.

    Args:
        test_ids: List of test UUIDs to delete

    Returns:
        Dictionary with deleted IDs and failed items
    """
    return shared.batch_delete(test_ids, delete_test, "Test")


def add_test_version(test_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Add a new version to a test.

    Args:
        test_id: Test UUID
        data: Version data

    Returns:
        Updated test with new version or None if not found
    """
    test = _load_test(test_id)
    if test is None:
        return None

    versions = _load_versions(test_id)

    # Determine version bump
    version_bump = data.get("version_bump", "minor")
    new_version = shared.next_semantic_version(str(test.get("version", "1.0.0")), version_bump)

    # Update test
    now = datetime.now(UTC).isoformat()
    test["version"] = new_version
    test["updated_at"] = now
    if "description" in data:
        test["description"] = data["description"]

    # Save updated test
    _save_test(test)

    # Add version history
    versions.append(
        {
            "version": new_version,
            "created_at": now,
            "created_by": "system",
            "changes": data.get("description", "Version update"),
        }
    )
    _save_versions(test_id, versions)

    # Return copy with masked secrets
    result = test.copy()
    result["variables"] = shared.mask_secret_variables(test.get("variables", {}), flag_masked=True)
    return result


def delete_test_version(test_id: str, version: str) -> bool:
    """Delete specific test version.

    Args:
        test_id: Test UUID
        version: Semantic version string

    Returns:
        True if deleted, False if not found

    Raises:
        ValueError: If version has dependencies
    """
    test = _load_test(test_id)
    if test is None:
        return False

    versions = _load_versions(test_id)

    # Find version
    version_idx = next((i for i, v in enumerate(versions) if v["version"] == version), None)
    if version_idx is None:
        return False

    # Check for dependencies on this version (simplified)
    version_entry = versions[version_idx]
    refs = version_entry.get("suite_refs", 0)
    if refs > 0:
        raise ConflictException(
            f"Cannot delete version '{version}': {refs} suites reference this version"
        )

    # Delete version from history
    versions.pop(version_idx)
    _save_versions(test_id, versions)

    return True


def get_test_workflow(test_id: str) -> dict[str, Any] | None:
    """Get test workflow graph.

    Args:
        test_id: Test UUID

    Returns:
        Workflow graph (nodes and edges) or None if not found
    """
    test = _load_test(test_id)
    if test is None:
        return None

    workflow: dict[str, Any] = test.get("workflow", {"nodes": [], "edges": []})
    revealed: dict[str, Any] = _read_workflow(workflow)
    return revealed


def get_test_variables(test_id: str) -> dict[str, Any] | None:
    """Get test variables.

    Args:
        test_id: Test UUID

    Returns:
        Variable declarations with masked secrets or None if not found
    """
    test = _load_test(test_id)
    if test is None:
        return None

    return shared.mask_secret_variables(test.get("variables", {}), flag_masked=True)


def get_test_workflow_raw(test_id: str) -> dict[str, Any] | None:
    """The stored workflow, secrets sealed, for the run load and a masked echo only."""
    test = _load_test(test_id)
    workflow = test.get("workflow") if test is not None else None
    return workflow if isinstance(workflow, dict) else None


def get_test_variables_raw(test_id: str) -> dict[str, Any] | None:
    """Test variables without masking, for engine injection only.

    The masked getter stays the API-facing read; the run path must receive
    real values so secret-flagged ones register with the run registry.
    """
    test = _load_test(test_id)
    if test is None:
        return None

    return {
        name: dict(var_info) if isinstance(var_info, dict) else var_info
        for name, var_info in test.get("variables", {}).items()
    }


def _validate_merge_type_consistency(
    variables: dict[str, Any], existing_vars: dict[str, Any]
) -> None:
    """Validate type consistency when merging variables."""
    for var_name, var_info in variables.items():
        if var_name not in existing_vars or not isinstance(var_info, dict):
            continue
        existing_type = existing_vars[var_name].get("type")
        new_type = var_info.get("type")
        if existing_type and new_type and existing_type != new_type:
            raise ValidationException(
                f"Type mismatch for variable '{var_name}': "
                f"expected '{existing_type}', got '{new_type}'"
            )


def _validate_computed_expressions(
    variables: dict[str, Any], existing_vars: dict[str, Any], merge: bool
) -> None:
    """Validate computed variable expressions for syntax and references."""
    for var_name, var_info in variables.items():
        if not isinstance(var_info, dict) or not var_info.get("computed"):
            continue
        expression = var_info.get("expression", "")

        if " then " in expression and "if " in expression:
            raise ValidationException(
                f"Invalid expression syntax for computed variable '{var_name}': "
                f"unexpected token 'then' at position {expression.index(' then ')}"
            )

        all_vars = {**existing_vars, **variables} if merge else variables
        refs = extract_expression_names(expression)
        for ref in refs:
            if ref not in all_vars:
                raise ValidationException(
                    f"Computed variable '{var_name}' references undefined variable '{ref}'"
                )


def _reject_read_only_variables(variables: dict[str, Any]) -> None:
    """Refuse a variable declaration whose expression or template would change data."""
    for var_name, var_info in variables.items():
        if not isinstance(var_info, dict):
            continue
        reason = variable_read_only_violation(var_info)
        if reason:
            raise ValidationException(f"{reason} Variable: {var_name}.")


def update_test_variables(
    test_id: str, variables: dict[str, Any], merge: bool = False
) -> dict[str, Any] | None:
    """Update test variables.

    Args:
        test_id: Test UUID
        variables: New variable declarations
        merge: If True, merge with existing variables; if False, replace

    Returns:
        Updated variable declarations or None if not found

    Raises:
        ValueError: If type mismatch or invalid expression syntax
    """
    test = _load_test(test_id)
    if test is None:
        return None

    existing_vars = test.get("variables", {})

    # A placeholder secret value must resolve to the stored (sealed) value, never seal
    # the mask over the real secret.
    variables = shared.restore_masked_secrets(variables, existing_vars)

    if merge:
        _validate_merge_type_consistency(variables, existing_vars)

    _validate_computed_expressions(variables, existing_vars, merge)
    _reject_read_only_variables(variables)

    refuse_value_problems(variables)
    updated_vars = {**existing_vars, **variables} if merge else variables
    test["variables"] = updated_vars
    test["updated_at"] = datetime.now(UTC).isoformat()

    _save_test(test)
    return shared.mask_secret_variables(test["variables"], flag_masked=True)


def validate_test(test_id: str, context: str = "load") -> dict[str, Any] | None:
    """Validate test definition with two-phase validation.

    Step 1 (fatal): MISSING_WORKFLOW, INVALID_NODES, CYCLE_DETECTED
    - If any fatal error exists, returns immediately with only fatal errors.

    Step 2 (fixable + warnings): all remaining validations
    - Each fixable error includes a fix_action description.
    - REQUIRED_PARAM_MISSING/EMPTY: warning on load, error on import/run.
    - Disabled elements skip required param checks.

    Args:
        test_id: Test UUID
        context: Validation context - "load", "import", or "run"

    Returns:
        Validation result dict, or None if test not found
    """
    test = _load_test(test_id)
    if test is None:
        return None

    return _validate_test_data(test, context=context)


def unsaved_test(
    test_id: str,
    stored: dict[str, Any],
    workflow: dict[str, Any],
    variables: dict[str, Any] | None,
) -> dict[str, Any]:
    """The stored test carrying an unsaved workflow, and unsaved variables when given."""
    return {
        "id": test_id,
        "name": stored.get("name", test_id),
        "workflow": workflow,
        "variables": stored.get("variables", {}) if variables is None else variables,
    }


def validate_unsaved_test(
    test_id: str,
    workflow: dict[str, Any],
    variables: dict[str, Any] | None,
    context: str = "run",
) -> dict[str, Any] | None:
    """Validate an unsaved workflow of a stored test, or None if the test is not found."""
    stored = _load_test(test_id)
    if stored is None:
        return None
    return _validate_test_data(unsaved_test(test_id, stored, workflow, variables), context=context)


def _log_validation_result(result: dict[str, Any], context: str, test_name: str) -> None:
    """Log validation result at DEBUG level."""
    errors = result.get("errors", [])
    warnings = result.get("warnings", [])
    if errors or warnings:
        logger.debug(
            "Validation [%s] test=%s: %d error(s), %d warning(s)%s",
            context,
            test_name,
            len(errors),
            len(warnings),
            " (FATAL)" if result.get("fatal") else "",
        )
        for e in errors:
            logger.debug(
                "  ERROR  %-25s node=%-12s %s",
                e.get("code", "?"),
                e.get("node_id") or e.get("node_label") or "-",
                e.get("message", ""),
            )
        for w in warnings:
            logger.debug(
                "  WARN   %-25s node=%-12s %s",
                w.get("code", "?"),
                w.get("node_id") or w.get("node_label") or "-",
                w.get("message", ""),
            )
    else:
        logger.debug("Validation [%s] test=%s: clean", context, test_name)


def _make_fatal_error(path: str, code: str, message: str) -> dict[str, Any]:
    """Build a fatal validation error dict (no fix possible)."""
    return error_entry(path=path, code=code, message=message)


def _make_warning_entry(
    *,
    path: str,
    code: str,
    message: str,
    node_id: str | None = None,
    node_label: str | None = None,
    element_type: str | None = None,
) -> dict[str, Any]:
    """Build a validation warning dict."""
    return {
        "path": path,
        "node_id": node_id,
        "node_label": node_label,
        "element_type": element_type,
        "code": code,
        "message": message,
    }


def _cycle_dfs(
    node: str,
    adj: dict[str, list[str]],
    visited: set[str],
    rec_stack: set[str],
    path: list[str],
) -> str | None:
    """DFS traversal to find a cycle. Returns cycle string or None."""
    visited.add(node)
    rec_stack.add(node)
    path.append(node)
    for neighbor in adj.get(node, []):
        if neighbor not in visited:
            cycle_str = _cycle_dfs(neighbor, adj, visited, rec_stack, path)
            if cycle_str:
                return cycle_str
        elif neighbor in rec_stack:
            cycle_start = path.index(neighbor)
            cycle = path[cycle_start:] + [neighbor]
            return " -> ".join(cycle)
    path.pop()
    rec_stack.remove(node)
    return None


def _check_cycle_and_append(
    start: str,
    adj: dict[str, list[str]],
    visited: set[str],
    rec_stack: set[str],
    fatal_errors: list[dict[str, Any]],
) -> None:
    """Run DFS from start node and append CYCLE_DETECTED error if found."""
    if start in visited:
        return
    cycle = _cycle_dfs(start, adj, visited, rec_stack, [])
    if cycle:
        fatal_errors.append(
            _make_fatal_error(
                "workflow", "CYCLE_DETECTED", f"Workflow graph contains cycle: {cycle}"
            )
        )


def _build_cycle_adj(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> tuple[set[str], dict[str, list[str]]]:
    """Build node ID set and adjacency list for cycle detection."""
    node_ids: set[str] = set()
    for node in nodes:
        nid = node.get("id")
        if nid and isinstance(nid, str):
            node_ids.add(nid)

    adj: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source in adj and target in node_ids and source != target:
            adj[source].append(target)

    return node_ids, adj


def _detect_cycles(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Detect cycles in the workflow graph using DFS.

    Args:
        nodes: Workflow node list
        edges: Workflow edge list

    Returns:
        List of fatal CYCLE_DETECTED error dicts (empty if acyclic)
    """
    node_ids_for_cycle, adj = _build_cycle_adj(nodes, edges)
    visited: set[str] = set()
    rec_stack: set[str] = set()
    fatal_errors: list[dict[str, Any]] = []

    if nodes:
        first_node_id = nodes[0].get("id")
        if first_node_id and first_node_id in adj:
            _check_cycle_and_append(first_node_id, adj, visited, rec_stack, fatal_errors)

    for nid in node_ids_for_cycle:
        _check_cycle_and_append(nid, adj, visited, rec_stack, fatal_errors)

    return fatal_errors


def _validate_fatal_checks(
    test: dict[str, Any],
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], list[dict[str, Any]]]:
    """Run step 1 fatal validation checks on a test.

    Returns:
        (fatal_result_or_None, nodes, edges)
        If fatal_result is not None, validation should stop and return it.
        Otherwise nodes and edges are extracted for step 2.
    """
    workflow = test.get("workflow")
    if not workflow or not isinstance(workflow, dict):
        return (
            {
                "fatal": True,
                "errors": [
                    _make_fatal_error("workflow", "MISSING_WORKFLOW", "Test must have a workflow")
                ],
                "warnings": [],
            },
            [],
            [],
        )

    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])

    if not isinstance(nodes, list):
        return (
            {
                "fatal": True,
                "errors": [
                    _make_fatal_error(
                        "workflow.nodes", "INVALID_NODES", "Workflow blocks must be an array"
                    )
                ],
                "warnings": [],
            },
            [],
            [],
        )

    if not isinstance(edges, list):
        edges = []

    cycle_errors = _detect_cycles(nodes, edges)
    if cycle_errors:
        return ({"fatal": True, "errors": cycle_errors, "warnings": []}, nodes, edges)

    return (None, nodes, edges)


def _validate_node_position(
    node: dict[str, Any],
    node_path: str,
    node_id: str,
    node_label: str | None,
    element_type: str | None,
    errors: list[dict[str, Any]],
) -> None:
    """Validate a node's position field."""
    position = node.get("position")
    if not position or not isinstance(position, dict):
        errors.append(
            error_entry(
                path=f"{node_path}.position",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="MISSING_POSITION",
                message="Block must have a position with numeric x and y",
                fix_action="Place at default position",
            )
        )
        return
    x = position.get("x")
    y = position.get("y")
    if not isinstance(x, int | float) or not isinstance(y, int | float):
        errors.append(
            error_entry(
                path=f"{node_path}.position",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="INVALID_POSITION",
                message="Block position x and y must be numeric",
                fix_action="Place at default position",
            )
        )


def _validate_node_params_and_assertions(
    data: dict[str, Any],
    element_type: str,
    control_ids: set[str],
    node_path: str,
    node_id: str,
    node_label: str | None,
    disabled: bool,
    context: str,
    add_error: Any,
    add_warning: Any,
    errors: list[dict[str, Any]],
    library: _FunctionLibrary | None = None,
) -> None:
    """Validate parameter schema and assertion IDs for a single node."""
    config = data.get("config", {}) or {}
    values = config.get("values", {}) or {}
    is_control = element_type in control_ids
    is_block = is_control or element_type in KNOWN_PLUGIN_IDS
    site = _ReportSite(
        node_path, node_id, node_label, element_type, context, add_error, add_warning
    )

    if element_type == "function" and not disabled:
        _validate_function_block_params(data, library, site)
    elif is_block:
        _validate_block_params(
            site=site,
            control=is_control,
            version=data.get("version") or "1.0.0",
            values=values,
            disabled=disabled,
            expression_fields=set(data.get("expressionFields", [])),
            template_fields=set(data.get("templateFields", [])),
            element_types=data.get("elementTypes"),
        )
    if disabled or not is_block:
        return

    site.report(literal_row_findings(data))
    if is_control and element_type == "variable-setter":
        _validate_setter_expression_rows(
            data=data,
            values=values,
            node_path=node_path,
            node_id=node_id,
            node_label=node_label,
            context=context,
            add_error=add_error,
            add_warning=add_warning,
        )
    if is_control and element_type == "assert":
        _check_assertion_ids(values, site, errors)


def _check_assertion_ids(
    values: Mapping[str, Any], site: "_ReportSite", errors: list[dict[str, Any]]
) -> None:
    """Every Assert item carries a non-empty string id."""
    assertions = values.get("assertions", [])
    if isinstance(assertions, list) and _has_missing_assertion_ids(assertions):
        errors.append(
            error_entry(
                path=f"{site.node_path}.data.config.values.assertions",
                node_id=site.node_id,
                node_label=site.node_label,
                element_type=site.element_type,
                code="MISSING_ASSERTION_ID",
                message="Assertion items must have non-empty string IDs",
                fix_action="Generate unique assertion IDs",
            )
        )


def _validate_setter_expression_rows(
    *,
    data: dict[str, Any],
    values: dict[str, Any],
    node_path: str,
    node_id: str,
    node_label: str | None,
    context: str,
    add_error: Any,
    add_warning: Any,
) -> None:
    """A Variable Setter expression row left empty is an issue; an empty text row is a value."""
    rows = values.get("variables")
    if not isinstance(rows, dict):
        return
    for name in data.get("variableExpressionKeys") or []:
        if name in rows and is_blank_expression(rows[name]):
            _report_required_param(
                path=f"{node_path}.data.config.values.variables.{name}",
                node_id=node_id,
                node_label=node_label,
                element_type="variable-setter",
                code="REQUIRED_PARAM_EMPTY",
                message="Expression is required",
                context=context,
                add_error=add_error,
                add_warning=add_warning,
            )


def _emit_top_level_halt_scope_error(
    data: dict[str, Any],
    element_type: str,
    node_path: str,
    node_id: str,
    node_label: str | None,
    errors: list[dict[str, Any]],
) -> None:
    """Reject a `function`-scope Halt at the Test top level (no enclosing Function).

    The FE hides the option outside a Function; this guards the import / hand-edited
    paths it does not cover. Body Halts are validated via the embedded-Function walk,
    so this top-level-only check never flags a Halt inside a Function.
    """
    if element_type != "halt":
        return
    scope = ((data.get("config") or {}).get("values") or {}).get("scope")
    if scope != "function":
        return
    errors.append(
        error_entry(
            path=f"{node_path}.data.config.values.scope",
            node_id=node_id,
            node_label=node_label,
            element_type=element_type,
            code="HALT_FUNCTION_SCOPE_OUTSIDE_FUNCTION",
            message=(
                "Halt scope 'function' is only valid inside a Function; "
                "use test, suite, or regression at the Test level"
            ),
        )
    )


def _validate_all_nodes(
    nodes: list[dict[str, Any]],
    control_ids: set[str],
    context: str,
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
    library: _FunctionLibrary | None = None,
) -> set[str]:
    """Validate all workflow nodes. Returns set of valid node IDs."""
    # Function nodes are neither controls nor plugins; "function" is the
    # Function-paradigm marker elementType written by the canvas-drop path
    # for both local ("+" handle) and shared (library card) instances. The
    # validator must accept it or the persist-stage autofix will strip the
    # node on save and the user silently loses their work.
    all_known_element_types = control_ids | KNOWN_PLUGIN_IDS | {"function"}
    node_ids: set[str] = set()

    def _add_error(**kwargs: Any) -> None:
        errors.append(error_entry(**kwargs))

    def _add_warning(**kwargs: Any) -> None:
        warnings.append(_make_warning_entry(**kwargs))

    for idx, node in enumerate(nodes):
        node_id = node.get("id")
        node_type = node.get("type")
        data = node.get("data", {}) or {}
        element_type = data.get("elementType")
        node_label = data.get("label")
        disabled = data.get("disabled", False)
        node_path = f"nodes[{idx}]"

        # Validate node ID
        if not node_id or not isinstance(node_id, str):
            errors.append(
                error_entry(
                    path=node_path,
                    code="MISSING_NODE_ID",
                    message="Block must have a non-empty string ID",
                    fix_action="Generate unique ID",
                )
            )
            continue
        # Node ids are the load-bearing key for every per-node structure
        # (block_states map, log blockId attribution, breakpoints, React
        # Flow rendering, engine's node_map). Duplicates cause silent
        # data loss at run time: dict collisions drop one node, logs are
        # misattributed, the canvas renders the wrong state. Reject at
        # validation time so automation that mints duplicates fails
        # fast instead of producing corrupt executions.
        if node_id in node_ids:
            errors.append(
                error_entry(
                    path=node_path,
                    node_id=node_id,
                    node_label=node_label,
                    element_type=element_type,
                    code="DUPLICATE_NODE_ID",
                    message=f"Block ID '{node_id}' is used by more than one block",
                    fix_action="Assign unique IDs to every block",
                )
            )
            continue
        node_ids.add(node_id)

        # Validate node type
        valid_node_types = {"workflowNode", "noteNode"}
        if node_type not in valid_node_types:
            errors.append(
                error_entry(
                    path=node_path,
                    node_id=node_id,
                    node_label=node_label,
                    element_type=element_type,
                    code="INVALID_NODE_TYPE",
                    message=(
                        f"Block type must be one of {sorted(valid_node_types)}, got '{node_type}'"
                    ),
                    fix_action=REMOVE_BLOCK,
                )
            )
            continue

        _validate_node_position(node, node_path, node_id, node_label, element_type, errors)

        if not validate_node_element_type(
            node_path, node_id, node_label, element_type, all_known_element_types, errors
        ):
            continue

        # element_type is guaranteed to be a non-empty str after passing validation above
        assert isinstance(element_type, str)

        validate_node_metadata(
            data, node_path, node_id, node_label, element_type, control_ids, errors
        )

        # Parameter schema and assertion ID validation
        _validate_node_params_and_assertions(
            data,
            element_type,
            control_ids,
            node_path,
            node_id,
            node_label,
            disabled,
            context,
            _add_error,
            _add_warning,
            errors,
            library,
        )

        _emit_top_level_halt_scope_error(data, element_type, node_path, node_id, node_label, errors)

    return node_ids


def _binding_type_mismatch_kwargs(
    *,
    idx: int,
    node_id: str | None,
    node_label: str | None,
    element_type: str,
    param_name: str,
    param_type: str,
    var_name: str,
    var_type: str,
) -> dict[str, Any]:
    """Build the kwargs dict for an INVALID_OUTPUT_BINDING_TYPE entry."""
    return {
        "path": f"nodes[{idx}].data.config.outputBindings.{param_name}",
        "node_id": node_id,
        "node_label": node_label,
        "element_type": element_type,
        "code": "INVALID_OUTPUT_BINDING_TYPE",
        "message": (
            f"Output '{param_name}' (type {param_type}) cannot bind to variable "
            f"'{var_name}' (type {var_type})"
        ),
    }


def _resolve_binding_type_mismatch(
    bindings: dict[str, Any],
    output_schema: list[Any],
    variables: dict[str, Any],
    values: Mapping[str, Any],
    parameters: Mapping[str, Mapping[str, Any]] | None,
) -> Iterator[tuple[str, str, str, str]]:
    """Yield (param_name, param_type, var_name, var_type) for each mismatched binding."""
    for param_name, var_name in bindings.items():
        if not isinstance(var_name, str) or not var_name:
            continue
        param_type = _find_type_in_schema(output_schema, param_name, values, parameters)
        if not param_type:
            continue
        var_info = variables.get(var_name)
        if not isinstance(var_info, dict):
            continue
        var_type = var_info.get("type")
        if not isinstance(var_type, str):
            continue
        compatible = _OUTPUT_TYPE_COMPAT.get(param_type, {param_type})
        if var_type in compatible:
            continue
        yield param_name, param_type, var_name, var_type


def _save_schema(data: dict[str, Any], library: _FunctionLibrary | None) -> BlockSchema | None:
    """The schema a save checks a Block against, or None when it cannot be read."""
    if _is_function_block_data(data):
        return _function_block_schema(data, library)
    return block_schema(data)


def _node_binding_type_mismatches(
    data: dict[str, Any],
    variables: dict[str, Any],
    library: _FunctionLibrary | None = None,
) -> Iterator[tuple[str, str, str, str]]:
    """Yield one node's output bindings whose bound variable type is incompatible.

    Yields nothing for a node that carries no checkable binding: disabled,
    no binding map, or an element whose schema cannot be resolved.
    """
    if data.get("disabled"):
        return
    bindings = (data.get("config") or {}).get("outputBindings", {})
    if not isinstance(bindings, dict):
        return
    schema = _save_schema(data, library)
    if schema is None:
        return
    output_schema = list(schema.outputs)
    parameters = _schema_by_name(list(schema.fields))
    values = (data.get("config") or {}).get("values", {})
    yield from _resolve_binding_type_mismatch(
        bindings, output_schema, variables, values, parameters
    )


def _validate_output_binding_types(
    nodes: list[dict[str, Any]],
    variables: dict[str, Any],
    context: str,
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
    library: _FunctionLibrary | None = None,
) -> None:
    """Emit INVALID_OUTPUT_BINDING_TYPE for output bindings whose variable type is incompatible.

    On `load` context the issue is reported as a warning (visible class).
    On every other context (save/run/import/debug) it is reported as an error.
    """
    for idx, node in enumerate(nodes):
        data = node.get("data") or {}
        for param_name, param_type, var_name, var_type in _node_binding_type_mismatches(
            data, variables, library
        ):
            entry_kwargs = _binding_type_mismatch_kwargs(
                idx=idx,
                node_id=node.get("id"),
                node_label=data.get("label"),
                element_type=data.get("elementType", ""),
                param_name=param_name,
                param_type=param_type,
                var_name=var_name,
                var_type=var_type,
            )
            if context == "load":
                warnings.append(_make_warning_entry(**entry_kwargs))
            else:
                errors.append(error_entry(fix_action=None, **entry_kwargs))


_VALID_EDGE_TYPES = {"default", "smoothstep", "step", "straight"}
_PATH_WORKFLOW_EDGES = "workflow.edges"


def _validate_edges_basic(
    edges: list[dict[str, Any]],
    node_ids: set[str],
    errors: list[dict[str, Any]],
) -> None:
    """Validate individual edges for dangling refs, self-loops, and invalid types."""
    valid_sources = node_ids | {"start-node"}
    for idx, edge in enumerate(edges):
        edge_path = f"edges[{idx}]"
        source = edge.get("source")
        target = edge.get("target")

        if source and source not in valid_sources:
            errors.append(
                error_entry(
                    path=edge_path,
                    code="DANGLING_EDGE",
                    message=f"Edge source '{source}' references non-existent block",
                    fix_action="Remove dangling edge",
                )
            )

        if target and target not in node_ids:
            errors.append(
                error_entry(
                    path=edge_path,
                    code="DANGLING_EDGE",
                    message=f"Edge target '{target}' references non-existent block",
                    fix_action="Remove dangling edge",
                )
            )

        if source and target and source == target:
            errors.append(
                error_entry(
                    path=edge_path,
                    code="SELF_LOOP_EDGE",
                    message=f"Edge has same source and target: '{source}'",
                    fix_action="Remove self-loop edge",
                )
            )

        edge_type = edge.get("type")
        if edge_type is not None and edge_type not in _VALID_EDGE_TYPES:
            errors.append(
                error_entry(
                    path=edge_path,
                    code="INVALID_EDGE_TYPE",
                    message=f"Edge has invalid type '{edge_type}'",
                    fix_action="Reset to default edge type",
                )
            )


def _build_node_label_map(nodes: list[dict[str, Any]]) -> dict[str, str | None]:
    """Build a mapping from node ID to label for error messages."""
    label_map: dict[str, str | None] = {"start-node": "Start"}
    for node in nodes:
        nid = node.get("id")
        if nid:
            label_map[nid] = (node.get("data") or {}).get("label")
    return label_map


def _get_node_branching_max(data: dict[str, Any], control_ids: set[str]) -> int | None:
    """Determine max branching edges for a single node. Returns None if not branching."""
    from wavecore.controls.registry import get_control_implementation
    from wavecore.models.enums import ControlId

    element_type = data.get("elementType")
    # Remote Execution is a plugin-catalog container with For-Loop-style egress
    # (a cyan body sub-flow + a then continuation), so it allows two outgoing edges.
    if element_type == "remote-execution":
        return 2
    if not element_type or element_type not in control_ids:
        return None

    version = data.get("version") or "1.0.0"
    impl_class = get_control_implementation(ControlId(element_type), version)
    if not impl_class:
        return None

    hints = impl_class().metadata.get("structure_hints", {})
    hint_type = hints.get("type")

    if hint_type == "branching":
        return _branching_max_from_hints(hints, data)
    if element_type == "wait-until":
        return _wait_until_max(data)
    if hint_type in ("scoped", "looping"):
        dynamic = _scoped_dynamic_max(hints, data)
        if dynamic is not None:
            return dynamic
        branches = hints.get("branches", [])
        return len(branches) if len(branches) > 1 else None
    return None


def _wait_until_max(data: dict[str, Any]) -> int:
    """Watch mode renders one default egress; Retry renders the lane plus the egress."""
    values = (data.get("config") or {}).get("values") or {}
    return 1 if values.get("mode", "retry") == "watch" else 2


def _scoped_dynamic_max(hints: dict[str, Any], data: dict[str, Any]) -> int | None:
    """Cap for a scoped control whose branch lanes are author-configured."""
    if not hints.get("allows_dynamic_branches"):
        return None
    values = (data.get("config") or {}).get("values") or {}
    config_branches = values.get("branches")
    if not isinstance(config_branches, list) or not config_branches:
        return None
    # One lane per configured branch, plus the egress handle.
    return len(config_branches) + 1


def _compute_branching_max_edges(
    nodes: list[dict[str, Any]],
    control_ids: set[str],
) -> dict[str, int]:
    """Compute max allowed outgoing edges per node based on control structure hints."""
    branching_max: dict[str, int] = {}

    for node in nodes:
        nid = node.get("id")
        if not nid:
            continue
        data = node.get("data") or {}
        max_edges = _get_node_branching_max(data, control_ids)
        if max_edges is not None:
            branching_max[nid] = max_edges

    return branching_max


def _branching_max_from_hints(hints: dict[str, Any], data: dict[str, Any]) -> int:
    """Determine max outgoing edges for a branching control from its hints."""
    if hints.get("allows_dynamic_branches"):
        config = data.get("config") or {}
        values = config.get("values") or {}
        config_branches = values.get("branches")
        if isinstance(config_branches, list) and len(config_branches) > 0:
            return len(config_branches)
    # Static branches fallback
    branches = hints.get("branches", [])
    return len(branches) if len(branches) > 1 else 1


def _validate_outgoing_edges(
    edges: list[dict[str, Any]],
    node_label_map: dict[str, str | None],
    branching_max_edges: dict[str, int],
    errors: list[dict[str, Any]],
) -> None:
    """Validate outgoing edge counts per node."""
    outgoing_count: dict[str, int] = {}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source and target and source != target:
            outgoing_count[source] = outgoing_count.get(source, 0) + 1

    for nid, count in outgoing_count.items():
        max_allowed = branching_max_edges.get(nid, 1)
        if count > max_allowed:
            label = node_label_map.get(nid)
            errors.append(
                error_entry(
                    path=_PATH_WORKFLOW_EDGES,
                    node_id=nid if nid != "start-node" else None,
                    node_label=label,
                    code="MULTIPLE_EDGES",
                    message=(
                        f"Block '{label or nid}' has {count} outgoing edges (max {max_allowed})"
                    ),
                    fix_action="Remove all outgoing edges from block",
                )
            )


def _outgoing_handle_counts(edges: list[dict[str, Any]]) -> dict[tuple[str, str], int]:
    """Count outgoing edges per (source node, named source handle)."""
    counts: dict[tuple[str, str], int] = {}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        handle = edge.get("sourceHandle")
        if source and target and source != target and handle:
            key = (str(source), str(handle))
            counts[key] = counts.get(key, 0) + 1
    return counts


def _validate_outgoing_handle_edges(
    edges: list[dict[str, Any]],
    node_label_map: dict[str, str | None],
    errors: list[dict[str, Any]],
) -> None:
    """A named source handle routes to exactly one target at runtime."""
    for (nid, handle), count in _outgoing_handle_counts(edges).items():
        if count > 1:
            label = node_label_map.get(nid)
            errors.append(
                error_entry(
                    path=_PATH_WORKFLOW_EDGES,
                    node_id=nid,
                    node_label=label,
                    code="MULTIPLE_EDGES",
                    message=(
                        f"Block '{label or nid}' has {count} outgoing edges "
                        f"on handle '{handle}' (max 1 per handle)"
                    ),
                    fix_action="Remove duplicate outgoing edges",
                )
            )


def _validate_incoming_edges(
    edges: list[dict[str, Any]],
    node_label_map: dict[str, str | None],
    errors: list[dict[str, Any]],
) -> None:
    """Validate incoming edge counts per handle."""
    ingress_handles: dict[tuple[str, str | None], int] = {}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source and target and source != target:
            key = (target, edge.get("targetHandle"))
            ingress_handles[key] = ingress_handles.get(key, 0) + 1

    for (nid, handle), count in ingress_handles.items():
        if count > 1:
            label = node_label_map.get(nid)
            handle_desc = f" on handle '{handle}'" if handle else ""
            errors.append(
                error_entry(
                    path=_PATH_WORKFLOW_EDGES,
                    node_id=nid,
                    node_label=label,
                    code="MULTIPLE_EDGES",
                    message=(
                        f"Block '{label or nid}' has {count} incoming edges"
                        f"{handle_desc} (max 1 per handle)"
                    ),
                    fix_action="Remove duplicate incoming edges",
                )
            )


def _validate_edge_multiplicity(
    edges: list[dict[str, Any]],
    node_label_map: dict[str, str | None],
    branching_max_edges: dict[str, int],
    errors: list[dict[str, Any]],
) -> None:
    """Validate outgoing and incoming edge counts per node."""
    _validate_outgoing_edges(edges, node_label_map, branching_max_edges, errors)
    _validate_outgoing_handle_edges(edges, node_label_map, errors)
    _validate_incoming_edges(edges, node_label_map, errors)


def _find_tc_node_ids(nodes: list[dict[str, Any]]) -> set[str]:
    """Identify try-catch-finally node IDs."""
    tc_ids: set[str] = set()
    for node in nodes:
        nid = node.get("id")
        data = node.get("data") or {}
        if data.get("elementType") == "try-catch-finally" and nid:
            tc_ids.add(nid)
    return tc_ids


_TC_PATH_HANDLES = frozenset({"try", "catch", "finally"})


@dataclass(frozen=True)
class _ScopeGraph:
    """Flow edges and Try/Catch path entries the scope trace walks."""

    tc_node_ids: set[str]
    first_hops: set[str] = field(default_factory=set)
    egress_targets: set[str] = field(default_factory=set)
    paths: dict[str, list[tuple[str, str]]] = field(default_factory=dict)
    successors: dict[str, list[str]] = field(default_factory=dict)


def _build_scope_graph(edges: list[dict[str, Any]], tc_node_ids: set[str]) -> _ScopeGraph:
    """Split edges into Try/Catch path entries and flow edges; other Try/Catch edges are egress."""
    graph = _ScopeGraph(tc_node_ids)
    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if not src or not tgt:
            continue
        handle = edge.get("sourceHandle")
        if src in tc_node_ids and handle in _TC_PATH_HANDLES:
            graph.first_hops.add(tgt)
            graph.paths.setdefault(src, []).append((f"{src}:{handle}", tgt))
            continue
        if src in tc_node_ids:
            graph.egress_targets.add(tgt)
        graph.successors.setdefault(src, []).append(tgt)
    return graph


def _check_cross_scope_edges(
    edges: list[dict[str, Any]],
    tc_node_ids: set[str],
    scope_map: dict[str, frozenset[str]],
    node_label_map: dict[str, str | None],
    errors: list[dict[str, Any]],
) -> None:
    """Check for cross-scope edges and append errors."""
    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if not src or not tgt or src == tgt:
            continue
        # Only a path handle opens a scope; a Try/Catch egress stays in the Try/Catch's own scope.
        if src in tc_node_ids and edge.get("sourceHandle") in _TC_PATH_HANDLES:
            continue
        if scope_map.get(src) == scope_map.get(tgt):
            continue
        edge_id = edge.get("id", "")
        src_label = node_label_map.get(src)
        tgt_label = node_label_map.get(tgt)
        errors.append(
            error_entry(
                path=f"{_PREFIX_WORKFLOW_EDGES}{edge_id}",
                node_id=src,
                node_label=src_label,
                code="CROSS_SCOPE_EDGE",
                message=(
                    f"Block '{src_label or src}' cannot connect to "
                    f"'{tgt_label or tgt}' (cross-scope edge violates "
                    f"try-catch path isolation)"
                ),
                fix_action="Remove the cross-scope edge",
            )
        )


def _validate_try_catch_scopes(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    node_label_map: dict[str, str | None],
    errors: list[dict[str, Any]],
) -> None:
    """Validate try-catch scope isolation (REQ-3.2.2.6)."""
    tc_node_ids = _find_tc_node_ids(nodes)
    if not tc_node_ids:
        return

    graph = _build_scope_graph(edges, tc_node_ids)
    scope_map = _trace_tc_scopes(graph, _scope_root_entries(nodes, edges))
    _check_cross_scope_edges(edges, tc_node_ids, scope_map, node_label_map, errors)


def _scope_root_entries(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> set[str]:
    """The outer flow starts at every node nothing leads into (Start included)."""
    targets = {edge.get("target") for edge in edges}
    ids = {node.get("id") for node in nodes} | {edge.get("source") for edge in edges}
    return {nid for nid in ids if nid and nid not in targets}


def _flow_reach(graph: _ScopeGraph, entries: set[str], claimed: set[str]) -> set[str]:
    """Nodes a flow reaches without entering a claimed node, a path, or a foreign egress."""
    reach: set[str] = set()
    queue = list(entries)
    while queue:
        node = queue.pop()
        if node in reach:
            continue
        reach.add(node)
        from_tc = node in graph.tc_node_ids
        queue.extend(
            target
            for target in graph.successors.get(node, [])
            if target not in claimed
            and target not in graph.first_hops
            and (from_tc or target not in graph.egress_targets)
        )
    return reach


def _open_paths(graph: _ScopeGraph, openers: set[str], opened: set[str]) -> list[tuple[str, str]]:
    """Path scopes of the Try/Catch nodes not opened yet."""
    fresh = openers - opened
    opened.update(fresh)
    return [scope for tc_id in fresh for scope in graph.paths.get(tc_id, [])]


def _trace_tc_scopes(graph: _ScopeGraph, root_entries: set[str]) -> dict[str, frozenset[str]]:
    """Outer flow first, then paths level by level; a node sibling paths share keeps every scope."""
    scope_map: dict[str, frozenset[str]] = {}
    claimed = _flow_reach(graph, root_entries, set())
    opened: set[str] = set()
    level = _open_paths(graph, claimed & graph.tc_node_ids, opened)
    while level:
        claims: dict[str, set[str]] = {}
        for scope_key, first_hop in level:
            for node in _flow_reach(graph, {first_hop}, claimed):
                claims.setdefault(node, set()).add(scope_key)
        scope_map.update((node, frozenset(keys)) for node, keys in claims.items())
        claimed.update(claims)
        level = _open_paths(graph, claims.keys() & graph.tc_node_ids, opened)
    return scope_map


def _validate_stale_target_handles(
    edges: list[dict[str, Any]],
    node_label_map: dict[str, str | None],
    errors: list[dict[str, Any]],
) -> None:
    """Detect edges with stale ingress_N targetHandle references."""
    incoming_edge_count: dict[str, int] = {}
    for edge in edges:
        tgt = edge.get("target")
        if tgt:
            incoming_edge_count[tgt] = incoming_edge_count.get(tgt, 0) + 1

    for edge in edges:
        tgt = edge.get("target")
        th = edge.get("targetHandle")
        if not (tgt and th and isinstance(th, str) and th.startswith("ingress_")):
            continue
        count = incoming_edge_count.get(tgt, 0)
        if count <= 1:
            tgt_label = node_label_map.get(tgt)
            errors.append(
                error_entry(
                    path=f"{_PREFIX_WORKFLOW_EDGES}{edge.get('id', '')}",
                    node_id=tgt,
                    node_label=tgt_label,
                    code="STALE_TARGET_HANDLE",
                    message=(
                        f"Edge to '{tgt_label or tgt}' references handle "
                        f"'{th}' but block has only {count} incoming edge(s)"
                    ),
                    fix_action="Reset edge to default input handle",
                )
            )


_REMOTE_UNSUPPORTED_SUFFIX = "not supported inside Remote Execution"
_REMOTE_UNSUPPORTED_BODY_MODES = {
    "form": "Form (URL-encoded)",
    "multipart": "Multipart (form-data)",
    "file": "File",
}


def _remote_body_member_ids(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> set[str]:
    """Node ids inside any Remote Execution body sub-flow (reached over the body handle)."""
    rex_ids = {
        node.get("id")
        for node in nodes
        if ((node.get("data") or {}).get("elementType")) == "remote-execution"
    }
    if not rex_ids:
        return set()
    adjacency: dict[str, list[str]] = {}
    stack: list[str] = []
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if not source or not target:
            continue
        adjacency.setdefault(source, []).append(target)
        if source in rex_ids and edge.get("sourceHandle") == "body":
            stack.append(target)
    members: set[str] = set()
    while stack:
        current = stack.pop()
        if current in members:
            continue
        members.add(current)
        stack.extend(adjacency.get(current, []))
    return members


def _remote_unsupported_findings(
    element_type: str, values: dict[str, Any]
) -> Iterator[tuple[str, str]]:
    """Yield (param, message) for HTTP capabilities the remote worker lacks."""
    if element_type != "http-client":
        return
    body_label = _REMOTE_UNSUPPORTED_BODY_MODES.get(str(values.get("body_mode")))
    if body_label:
        yield "body_mode", f'Body mode "{body_label}" is {_REMOTE_UNSUPPORTED_SUFFIX}'
    if values.get("response_mode") == "file":
        yield "response_mode", f'Response mode "file" is {_REMOTE_UNSUPPORTED_SUFFIX}'
    if values.get("max_size") not in (None, ""):
        yield "max_size", f"Max Size is {_REMOTE_UNSUPPORTED_SUFFIX}"


def _validate_remote_body_rules(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    """Reject the capabilities the remote worker lacks on a block inside a Remote body."""
    members = _remote_body_member_ids(nodes, edges)
    if not members:
        return
    for idx, node in enumerate(nodes):
        node_id = node.get("id")
        if node_id not in members:
            continue
        data = node.get("data") or {}
        element_type = str(data.get("elementType") or "")
        values = (data.get("config") or {}).get("values")
        if not isinstance(values, dict):
            continue
        for name, message in _remote_unsupported_findings(element_type, values):
            errors.append(
                error_entry(
                    path=f"nodes[{idx}].data.config.values.{name}",
                    node_id=node_id,
                    node_label=data.get("label"),
                    element_type=element_type,
                    code="REMOTE_UNSUPPORTED",
                    message=message,
                )
            )


def _infer_fix_action_for_undeclared(found: _FoundSites) -> str:
    """Determine fix action for an undeclared variable based on type inference."""
    inferred_types = _expected_types(found)
    if len(inferred_types) <= 1:
        inferred = next(iter(inferred_types), "string")
        return f"Add variable to manager (type: {inferred})"
    return "Remove references (type conflict)"


def _validate_setter_namespace_targets(
    nodes: list[dict[str, Any]],
    node_label_map: dict[str, str | None],
    errors: list[dict[str, Any]],
) -> None:
    """Check that Variable Setter nodes do not target namespace variables."""
    from wavecore.core.variables.reserved import RESERVED_VARIABLE_NAMES

    namespace_prefixes = tuple(f"{ns}." for ns in RESERVED_VARIABLE_NAMES)

    for node in nodes:
        for site in block_write_sites(node):
            target_name = site.text
            if site.kind == SiteKind.SETTER_TARGET and (
                target_name in RESERVED_VARIABLE_NAMES or target_name.startswith(namespace_prefixes)
            ):
                ns = target_name.split(".")[0]
                errors.append(
                    error_entry(
                        path=f"{_PREFIX_VARIABLES}{target_name}",
                        node_id=site.node_id,
                        node_label=node_label_map.get(site.node_id),
                        code="SETTER_TARGETS_NAMESPACE_VARIABLE",
                        message=(
                            f"Variable Setter targets '{target_name}' which is a "
                            f"{ns} namespace variable and cannot be modified"
                        ),
                        fix_action=(f"Use a test-local variable instead of '{target_name}'"),
                    )
                )


def _validate_undeclared_and_setter_targets(
    variables: dict[str, Any],
    nodes: list[dict[str, Any]],
    node_label_map: dict[str, str | None],
    errors: list[dict[str, Any]],
) -> None:
    """Validate undeclared variable references and namespace setter targets.

    UNDECLARED_VARIABLE is emitted as an error in every context. The fix is
    user-initiated: the FE validation dialog offers Fix (adds the missing
    variable) or Cancel (keeps the workflow as-is with a node alert). The
    implicit save-time autofix is intentionally disabled - variables must
    not be resurrected without the user's explicit consent.
    """
    undeclared, namespace_binding_targets = _find_undeclared_variables(nodes, set(variables.keys()))
    for var_name, found in undeclared.items():
        fix_action = _infer_fix_action_for_undeclared(found)
        num_nodes = len({site.node_id for _node, site in found})
        first_node_id = found[0][1].node_id
        errors.append(
            error_entry(
                path=f"{_PREFIX_VARIABLES}{var_name}",
                node_id=first_node_id,
                code="UNDECLARED_VARIABLE",
                message=(
                    f"Variable '{var_name}' is used in {num_nodes}"
                    f" block(s) but not declared in variable manager"
                ),
                fix_action=fix_action,
            )
        )

    for node_id, target_name in namespace_binding_targets:
        ns = target_name.split(".")[0]
        errors.append(
            error_entry(
                path=f"{_PREFIX_VARIABLES}{target_name}",
                node_id=node_id,
                node_label=node_label_map.get(node_id),
                code="BINDING_TARGETS_NAMESPACE_VARIABLE",
                message=(
                    f"Output binding targets '{target_name}' which is a "
                    f"{ns} namespace variable and cannot be modified"
                ),
                fix_action=f"Use a test-local variable instead of '{target_name}'",
            )
        )

    _validate_setter_namespace_targets(nodes, node_label_map, errors)


def _validate_test_data(
    test: dict[str, Any],
    context: str = "load",
    *,
    function_registry: Mapping[str, Any] | None = None,
    contract_loader: _ContractLoader | None = None,
    reference_index: _ReferenceIndex | None = None,
) -> dict[str, Any]:
    """Validate test data with two-phase validation.

    Args:
        test: Test data dict (loaded or in-memory)
        context: Validation context - "load", "import", or "run"

    Returns:
        Validation result with fatal flag, errors, and warnings
    """
    from wavecore.models.enums import ControlId

    control_ids = {cid.value for cid in ControlId}
    test_name = test.get("name", "?")

    # Step 1: Fatal checks
    fatal_result, nodes, edges = _validate_fatal_checks(test)
    if fatal_result is not None:
        _log_validation_result(fatal_result, context, test_name)
        return fatal_result

    # Step 2: Fixable errors + warnings
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    library = _function_library(
        nodes,
        function_registry=function_registry,
        contract_loader=contract_loader,
        reference_index=reference_index,
    )

    # Node-level validation
    node_ids = _validate_all_nodes(nodes, control_ids, context, errors, warnings, library)

    # Edge-level validation
    _validate_edges_basic(edges, node_ids, errors)

    # Edge multiplicity validation
    node_label_map = _build_node_label_map(nodes)
    branching_max_edges = _compute_branching_max_edges(nodes, control_ids)
    _validate_edge_multiplicity(edges, node_label_map, branching_max_edges, errors)

    # Try-catch scope isolation
    _validate_try_catch_scopes(nodes, edges, node_label_map, errors)

    # Stale targetHandle validation
    _validate_stale_target_handles(edges, node_label_map, errors)

    # Remote Execution body rules (WAVE-side schemes, unsupported capabilities)
    _validate_remote_body_rules(nodes, edges, errors)

    # Variable-level validation
    variables = test.get("variables", {})
    if isinstance(variables, dict):
        _validate_variables(variables, nodes, lambda **kw: errors.append(error_entry(**kw)))
        _validate_undeclared_and_setter_targets(variables, nodes, node_label_map, errors)
        validate_read_only_expressions(nodes, variables, errors)

    # Output-binding type validation (visible class)
    if isinstance(variables, dict):
        _validate_output_binding_types(nodes, variables, context, errors, warnings, library)

    # Validate embedded Function instances (REQ-3.1.2.4).
    _validate_embedded_function_instances(nodes, context, errors, warnings, library=library)

    result = {"fatal": False, "errors": errors, "warnings": warnings}
    _log_validation_result(result, context, test_name)
    return result


def _local_function_node_payload(
    node: Any,
) -> tuple[dict[str, Any], str, str] | None:
    """Return ``(localDefinition, outer_id, outer_label)`` for a Local Function
    instance node, or ``None`` if the node is not a validatable Local."""
    if not isinstance(node, dict):
        return None
    data = node.get("data") or {}
    if data.get("nodeType") != "function":
        return None
    if data.get("functionLifecycle") != "local":
        return None
    local_def = data.get("localDefinition")
    if not isinstance(local_def, dict):
        return None
    outer_node_id = node.get("id", "")
    label = data.get("label")
    outer_node_label = label if isinstance(label, str) and label.strip() else outer_node_id
    return local_def, outer_node_id, outer_node_label


# Defensive bound on recursive descent into nested Local Function bodies. A
# finding's function_path trail never exceeds this depth.
MAX_VALIDATION_DEPTH = 25


def _function_path_segment(node_id: str, label: str) -> dict[str, Any]:
    return {"node_id": node_id, "label": label, "element_type": "function"}


def _reference_fields(issue: Any) -> dict[str, Any]:
    """The Function id and version that a missing-reference finding names."""
    if issue.function_id is None:
        return {}
    return {"function_id": issue.function_id, "function_version": issue.function_version}


def _route_by_severity(
    issue: Any,
    entry: dict[str, Any],
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    if issue.severity == "warning":
        warnings.append(entry)
    else:
        errors.append(entry)


def _emit_embedded_issue(
    issue: Any,
    *,
    enclosing_path: list[dict[str, Any]],
    this_segment: dict[str, Any],
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    """Attach a Function-body issue to its leaf and root-to-leaf function_path.

    A body-node issue's leaf is that node; the trail is the enclosing Functions
    including this one. A Function-level issue (no node_id) makes the Function
    instance itself the leaf; the trail is its enclosing Functions only.
    """
    if issue.node_id:
        leaf_id = issue.node_id
        leaf_label = issue.node_label or issue.node_id
        function_path = [*enclosing_path, this_segment]
    else:
        leaf_id = this_segment["node_id"]
        leaf_label = this_segment["label"]
        function_path = list(enclosing_path)
    _route_by_severity(
        issue,
        {
            "code": issue.code,
            "message": issue.message,
            "node_id": leaf_id,
            "node_label": leaf_label,
            "function_path": function_path,
            **_reference_fields(issue),
        },
        errors,
        warnings,
    )


def _validate_top_level_shared_instance(
    node: dict[str, Any],
    data: dict[str, Any],
    library: _FunctionLibrary,
    errors: list[dict[str, Any]],
) -> None:
    """The version-availability gate of a top-level Shared Function Block (REQ-3.1.2.4); its
    fields are checked with every Block's (REQ-3.1.1.5)."""
    from wavecore.api.services.functions._storage import _shared_function_reference_issues

    node_id = node.get("id", "") or ""
    label = data.get("label")
    display = label if isinstance(label, str) and label.strip() else node_id

    for issue in _shared_function_reference_issues(data, library.registry, node_id, display):
        errors.append(
            {
                "code": issue.code,
                "message": issue.message,
                "node_id": issue.node_id or node_id,
                "node_label": issue.node_label or display,
                **_reference_fields(issue),
            }
        )


def _walk_local_function(
    payload: tuple[dict[str, Any], str, str],
    enclosing_path: list[dict[str, Any]],
    library: _FunctionLibrary,
    context: str,
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    """Validate one Function flow (a Local body or a Shared draft) and descend into it."""
    from wavecore.api.services.functions._storage import validate_function_for_save

    local_def, fid, flabel = payload
    this_segment = _function_path_segment(fid, flabel)
    # Only a save refuses a Function Block that leaves a Required input empty; the run names it.
    for issue in validate_function_for_save(
        local_def, function_registry=library.registry, required_function_inputs=context == "save"
    ):
        _emit_embedded_issue(
            issue,
            enclosing_path=enclosing_path,
            this_segment=this_segment,
            errors=errors,
            warnings=warnings,
        )
    body_nodes = (local_def.get("workflow") or {}).get("nodes") or []
    _walk_function_instances(
        body_nodes, [*enclosing_path, this_segment], library, context, errors, warnings
    )


def _maybe_validate_top_level_shared(
    node: dict[str, Any],
    library: _FunctionLibrary,
    errors: list[dict[str, Any]],
) -> None:
    """Run the Shared gate on a non-disabled top-level Shared instance."""
    data = node.get("data") or {}
    if data.get("disabled"):
        return
    if (
        data.get("nodeType") == "function"
        and data.get("functionLifecycle") == "shared"
        and data.get("functionId")
        and data.get("functionVersion")
    ):
        _validate_top_level_shared_instance(node, data, library, errors)


def _is_shared_function_instance(data: dict[str, Any]) -> bool:
    """True when ``data`` describes a Shared (published) Function instance."""
    return (
        data.get("nodeType") == "function"
        and data.get("functionLifecycle") == "shared"
        and bool(data.get("functionId"))
    )


def _emit_nested_editmode_guard(
    node: dict[str, Any],
    data: dict[str, Any],
    enclosing_path: list[dict[str, Any]],
    context: str,
    errors: list[dict[str, Any]],
) -> None:
    """A Shared instance still in edit mode INSIDE another Function's body
    blocks publish (a top-level edit-mode instance is the normal edit flow)."""
    # The run gate executes nested drafts; only persisting paths block.
    if context == "run" or not enclosing_path or not data.get("editMode"):
        return
    node_id = str(node.get("id", "") or "")
    label = data.get("label")
    display = label if isinstance(label, str) and label.strip() else node_id
    errors.append(
        {
            "code": "EDIT_MODE_DRAFT_IN_BODY",
            "message": (
                f"Function '{display}' is still in edit mode; resolve the nested "
                "draft (publish or drop it) before publishing the enclosing Function"
            ),
            "node_id": node_id,
            "node_label": display,
            "function_path": list(enclosing_path),
        }
    )


def _emit_self_reference_guard(
    node: dict[str, Any],
    data: dict[str, Any],
    enclosing_path: list[dict[str, Any]],
    reference_index: _ReferenceIndex,
    errors: list[dict[str, Any]],
) -> None:
    """A Shared instance whose library entry references itself directly
    or transitively is a blocking composition cycle."""
    from wavecore.api.services.functions._storage import detect_circular_deps

    cycle = detect_circular_deps(data.get("functionId", ""), reference_index)
    if cycle is None:
        return
    node_id = str(node.get("id", "") or "")
    label = data.get("label")
    display = label if isinstance(label, str) and label.strip() else node_id
    errors.append(
        {
            "code": "SELF_REFERENTIAL_FUNCTION",
            "message": (
                f"Function '{display}' cannot be nested inside itself "
                f"(composition cycle: {cycle})"
            ),
            "node_id": node_id,
            "node_label": display,
            "function_path": list(enclosing_path),
        }
    )


def _draft_node_payload(
    node: dict[str, Any], data: dict[str, Any]
) -> tuple[dict[str, Any], str, str] | None:
    """Return ``(draft, node_id, node_label)`` for a Shared Function Block in edit mode."""
    draft = data.get("draft")
    if not data.get("editMode") or not isinstance(draft, dict):
        return None
    node_id = str(node.get("id", "") or "")
    label = data.get("label")
    return draft, node_id, label if isinstance(label, str) and label.strip() else node_id


def _walk_function_instances(
    nodes: list[dict[str, Any]],
    enclosing_path: list[dict[str, Any]],
    library: _FunctionLibrary,
    context: str,
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    """Validate every Function instance reachable from ``nodes``.

    Local instances and Shared edit-mode drafts have their immediate body
    validated (issues carry a root-to-leaf ``function_path``) and are descended
    into. Shared instances at any depth are checked for a self-referential
    composition cycle and, when nested, for an unresolved edit-mode draft.
    Top-level Shared instances additionally run the version gate.
    Descent is bounded by MAX_VALIDATION_DEPTH.
    """
    if len(enclosing_path) >= MAX_VALIDATION_DEPTH:
        return
    for node in nodes:
        payload = _local_function_node_payload(node)
        if payload is not None:
            _walk_local_function(payload, enclosing_path, library, context, errors, warnings)
            continue
        if not isinstance(node, dict):
            continue
        data = node.get("data") or {}
        if _is_shared_function_instance(data):
            draft = _draft_node_payload(node, data)
            if draft is not None:
                _walk_local_function(draft, enclosing_path, library, context, errors, warnings)
            _emit_nested_editmode_guard(node, data, enclosing_path, context, errors)
            _emit_self_reference_guard(node, data, enclosing_path, library.reference_index, errors)
        if not enclosing_path:
            _maybe_validate_top_level_shared(node, library, errors)


def _is_function_block_data(data: Mapping[str, Any]) -> bool:
    return data.get("nodeType") == "function" or data.get("elementType") == "function"


def _function_library(
    nodes: list[dict[str, Any]],
    *,
    function_registry: Mapping[str, Any] | None = None,
    contract_loader: _ContractLoader | None = None,
    reference_index: _ReferenceIndex | None = None,
) -> _FunctionLibrary | None:
    """The Function library a Test is checked against, read only when it holds a Function Block."""
    has_function = any(
        isinstance(n, dict) and _is_function_block_data(n.get("data") or {}) for n in nodes
    )
    if not has_function:
        return None

    from wavecore.api.services.functions._storage import load_reference_index
    from wavecore.api.services.functions.service import (
        load_library_index,
        resolve_version_contract,
    )

    return _FunctionLibrary(
        registry=load_library_index() if function_registry is None else function_registry,
        load_contract=contract_loader or resolve_version_contract,
        reference_index=load_reference_index() if reference_index is None else reference_index,
    )


def _validate_embedded_function_instances(
    nodes: list[dict[str, Any]],
    context: str,
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
    *,
    function_registry: Mapping[str, Any] | None = None,
    contract_loader: _ContractLoader | None = None,
    reference_index: _ReferenceIndex | None = None,
    library: _FunctionLibrary | None = None,
) -> None:
    """Canonical Function-instance validation across the whole workflow.

    Descends Local bodies and Shared edit-mode drafts to any depth attaching a path
    trail, and gates top-level Shared instances on version availability.
    """
    if library is None:
        library = _function_library(
            nodes,
            function_registry=function_registry,
            contract_loader=contract_loader,
            reference_index=reference_index,
        )
    if library is None:
        return
    _walk_function_instances(nodes, [], library, context, errors, warnings)


_REQUIRED_CODES = frozenset({"REQUIRED_PARAM_MISSING", "REQUIRED_PARAM_EMPTY"})


@dataclass(frozen=True)
class _ReportSite:
    """Where one Block's save findings go; a required one is a warning on load."""

    node_path: str
    node_id: str
    node_label: str | None
    element_type: str
    context: str
    add_error: Callable[..., None]
    add_warning: Callable[..., None]

    def report(self, findings: Iterable[FieldFinding]) -> None:
        for finding in findings:
            path = f"{self.node_path}.data.config.values.{finding.field}"
            if finding.code in _REQUIRED_CODES:
                _report_required_param(
                    path=path,
                    node_id=self.node_id,
                    node_label=self.node_label,
                    element_type=self.element_type,
                    code=finding.code,
                    message=finding.message,
                    context=self.context,
                    add_error=self.add_error,
                    add_warning=self.add_warning,
                )
                continue
            self.add_error(
                path=path,
                node_id=self.node_id,
                node_label=self.node_label,
                element_type=self.element_type,
                code=finding.code,
                message=finding.message,
                fix_action=finding.fix,
            )


def _function_block_schema(
    data: Mapping[str, Any], library: _FunctionLibrary | None
) -> BlockSchema | None:
    """A Function Block's fields, or None while its Function cannot be read."""
    from wavecore.api.services.functions._storage import _shared_function_reference_issues

    if data.get("functionLifecycle", "local") == "local":
        return block_schema(data) if isinstance(data.get("localDefinition"), Mapping) else None
    if data.get("editMode") and isinstance(data.get("draft"), Mapping):
        return block_schema(data)
    if library is None or _shared_function_reference_issues(data, library.registry, "", ""):
        return None
    function_id = str(data.get("functionId") or "")
    version = str(data.get("functionVersion") or "")
    contract = library.load_contract(function_id, version)
    if contract is None:
        return None
    # The library the Test is checked against supplies the pinned version.
    return block_schema(data, registry={function_id: {**contract, "version": version}})


def _validate_function_block_params(
    data: dict[str, Any], library: _FunctionLibrary | None, site: _ReportSite
) -> None:
    """A Function Block's stored values against the inputs its Function declares; a Required
    input with no value is refused by the save, and by the run when it starts (REQ-3.1.2.10)."""
    from wavecore.api.services.functions._storage import function_block_name

    schema = _function_block_schema(data, library)
    if schema is None:
        return
    registry = library.registry if library is not None else {}
    site.report(
        check_block_fields(
            schema.fields,
            (data.get("config") or {}).get("values") or {},
            block_id=function_block_name(data, registry),
            expression_fields=set(data.get("expressionFields") or []),
            template_fields=set(data.get("templateFields") or []),
            check_required=site.context == "save",
            element_types=data.get("elementTypes"),
        )
    )


def _validate_block_params(
    *,
    site: _ReportSite,
    control: bool,
    version: str,
    values: dict[str, Any],
    disabled: bool,
    expression_fields: set[str] | None = None,
    template_fields: set[str] | None = None,
    element_types: Any = None,
) -> None:
    """A plugin or control Block's stored values against its declared parameters."""
    element_type = site.element_type
    if disabled or not block_type_registered(element_type, version, control=control):
        return
    node_type = "control" if control else "plugin"
    data = {"elementType": element_type, "version": version, "nodeType": node_type}
    fields = list(block_schema(data).fields)
    expressions = expression_fields or set()
    site.report(
        check_block_fields(
            fields,
            values,
            block_id=element_type,
            expression_fields=expressions,
            template_fields=template_fields or set(),
            check_required=True,
            element_types=element_types,
        )
    )
    if control:
        return
    _validate_map_key_policies(
        param_schema=fields,
        values=values,
        node_path=site.node_path,
        node_id=site.node_id,
        node_label=site.node_label,
        element_type=element_type,
        add_error=site.add_error,
    )
    _validate_tls_settings(fields=fields, values=values, expression_fields=expressions, site=site)


_TLS_MIN_MAX_MESSAGE = "Min TLS Version cannot exceed Max TLS Version"
# Blocks whose Cipher Suites and TLS version pins the save checks (REQ-3.1.1.5).
_TLS_BLOCKS = frozenset({"http-client", "k8s-connect"})


def _tls_version(
    values: Mapping[str, Any], fields: Sequence[Any], name: str, expression_fields: set[str]
) -> str | None:
    """A literal TLS version pin, read through its declared default when unset."""
    from wavecore.connectivity import tls_capabilities

    if name in expression_fields:
        return None
    value = values.get(name)
    if value is None:
        value = next(
            (get_param_attr(f, "default") for f in fields if get_param_attr(f, "name") == name),
            None,
        )
    return value if isinstance(value, str) and value in tls_capabilities.TLS_VERSIONS else None


def _tls_pin_findings(
    values: Mapping[str, Any], fields: Sequence[Any], expression_fields: set[str]
) -> Iterator[tuple[str, str, str]]:
    """Yield (code, param, message) for stored TLS pins the runtime would reject."""
    from wavecore.connectivity import tls_capabilities

    minimum = _tls_version(values, fields, "tls_min_version", expression_fields)
    maximum = _tls_version(values, fields, "tls_max_version", expression_fields)
    span: tuple[str, str] | None = None
    if minimum is not None and maximum is not None:
        if tls_capabilities.version_rank(minimum) > tls_capabilities.version_rank(maximum):
            yield "TLS_VERSION_ORDER", "tls_min_version", _TLS_MIN_MAX_MESSAGE
        else:
            span = (minimum, maximum)
    suites = values.get("cipher_suites")
    if "cipher_suites" in expression_fields or not isinstance(suites, list):
        return
    for index, name in enumerate(suites):
        # A null entry is refused by the run, naming its row (REQ-3.1.3.21).
        if name is None or f"cipher_suites.{index}" in expression_fields:
            continue
        if tls_capabilities.normalize(str(name)) is None:
            yield "TLS_CIPHER_UNKNOWN", "cipher_suites", f'Unknown cipher suite "{name}"'
        elif span is not None and not tls_capabilities.suite_in_range(str(name), *span):
            yield (
                "TLS_CIPHER_OUT_OF_RANGE",
                "cipher_suites",
                f'Cipher suite "{name}" is not available in TLS {span[0]} to {span[1]}',
            )


def _validate_tls_settings(
    *,
    fields: Sequence[Any],
    values: dict[str, Any],
    expression_fields: set[str],
    site: _ReportSite,
) -> None:
    """Stored TLS pins the runtime guards would reject fail at save time."""
    if site.element_type not in _TLS_BLOCKS:
        return
    site.report(
        FieldFinding(code, message, None, name)
        for code, name, message in _tls_pin_findings(values, fields, expression_fields)
    )


_KEY_PLACEHOLDER = "{key}"


def _duplicate_key_findings(
    policy: dict[str, Any], entries: dict[str, Any]
) -> Iterator[tuple[str, str]]:
    """Yield (code, message) for later rows whose key duplicates an earlier one."""
    if not policy.get("case_insensitive_duplicates"):
        return
    template = str(policy.get("duplicate_message", ""))
    seen: set[str] = set()
    for key in entries:
        lowered = key.lower()
        if lowered in seen:
            yield "MAP_KEY_DUPLICATE", template.replace(_KEY_PLACEHOLDER, key)
        seen.add(lowered)


def _blocked_key_findings(
    policy: dict[str, Any], entries: dict[str, Any]
) -> Iterator[tuple[str, str]]:
    """Yield (code, message) for keys the transport computes itself."""
    blocked = {str(k).lower() for k in policy.get("blocked_keys", [])}
    template = str(policy.get("blocked_message", ""))
    for key in entries:
        if key.lower() in blocked:
            yield "MAP_KEY_BLOCKED", template.replace(_KEY_PLACEHOLDER, key)


def _generated_key_names(
    policy: dict[str, Any], values: dict[str, Any], param_schema: list[Any]
) -> set[str]:
    """Lowercase key names the saved config generates at send time.

    Rules come from the plugin metadata: each matches when every `when`
    condition's effective value (stored value, else the param default) is in
    its allowed list; the generated name is the `key` literal or the
    effective value of `key_param`.
    """
    defaults = {str(p.get("name")): p.get("default") for p in param_schema if isinstance(p, dict)}

    def effective(name: str) -> Any:
        return values.get(name, defaults.get(name))

    names: set[str] = set()
    for rule in policy.get("generated_keys", []):
        conditions = rule.get("when", {})
        if not all(effective(param) in allowed for param, allowed in conditions.items()):
            continue
        key = rule.get("key") or effective(str(rule.get("key_param")))
        if isinstance(key, str) and key.strip():
            names.add(key.strip().lower())
    return names


def _generated_key_findings(
    policy: dict[str, Any],
    entries: dict[str, Any],
    values: dict[str, Any],
    param_schema: list[Any],
) -> Iterator[tuple[str, str]]:
    """Yield (code, message) for rows colliding with a config-generated key."""
    generated = _generated_key_names(policy, values, param_schema)
    if not generated:
        return
    template = str(policy.get("duplicate_message", ""))
    for key in entries:
        if key.lower() in generated:
            yield "MAP_KEY_DUPLICATE", template.replace(_KEY_PLACEHOLDER, key)


def _validate_map_key_policies(
    *,
    param_schema: list[Any],
    values: dict[str, Any],
    node_path: str,
    node_id: str,
    node_label: str | None,
    element_type: str,
    add_error: Any,
) -> None:
    """Enforce plugin-declared map key policies (duplicate, blocked, generated keys)."""
    for param in param_schema:
        if not isinstance(param, dict) or not isinstance(param.get("key_policy"), dict):
            continue
        name = str(param.get("name"))
        entries = values.get(name)
        if not isinstance(entries, dict):
            continue
        policy = param["key_policy"]
        findings = [
            *_duplicate_key_findings(policy, entries),
            *_blocked_key_findings(policy, entries),
            *_generated_key_findings(policy, entries, values, param_schema),
        ]
        for code, message in findings:
            add_error(
                path=f"{node_path}.data.config.values.{name}",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code=code,
                message=message,
                fix_action=None,
            )


def _report_required_param(
    *,
    path: str,
    node_id: str,
    node_label: str | None,
    element_type: str,
    code: str,
    message: str,
    context: str,
    add_error: Any,
    add_warning: Any,
) -> None:
    """Report a required param issue as error or warning based on context."""
    if context == "load":
        add_warning(
            path=path,
            node_id=node_id,
            node_label=node_label,
            element_type=element_type,
            code=code,
            message=message,
        )
    else:
        add_error(
            path=path,
            node_id=node_id,
            node_label=node_label,
            element_type=element_type,
            code=code,
            message=message,
            fix_action=None,
        )


def _has_missing_assertion_ids(items: list[Any]) -> bool:
    """Check if any assertion item (literal, expression, group) is missing an id."""
    for item in items:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "operator":
            continue
        # literal, expression, group must have a non-empty string id
        item_id = item.get("id")
        if not item_id or not isinstance(item_id, str):
            return True
        # Recurse into group items
        if item_type == "group":
            sub_items = item.get("items", [])
            if isinstance(sub_items, list) and _has_missing_assertion_ids(sub_items):
                return True
    return False


def _fix_missing_assertion_ids(items: list[Any]) -> int:
    """Generate UUIDs for assertion items missing an id. Returns count of IDs generated."""
    count = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "operator":
            continue
        item_id = item.get("id")
        if not item_id or not isinstance(item_id, str):
            item["id"] = str(uuid.uuid4())
            count += 1
        if item_type == "group":
            sub_items = item.get("items", [])
            if isinstance(sub_items, list):
                count += _fix_missing_assertion_ids(sub_items)
    return count


# All 40 known plugin IDs (module-level constant)
KNOWN_PLUGIN_IDS = {
    "csv-parser",
    "excel-parser",
    "file-io",
    "helm-install",
    "helm-rollback",
    "helm-status",
    "helm-test",
    "helm-uninstall",
    "helm-upgrade",
    "http-client",
    "json-parser",
    "k8s-apply",
    "k8s-connect",
    "k8s-copy",
    "k8s-delete",
    "k8s-events",
    "k8s-exec",
    "k8s-get",
    "k8s-logs",
    "k8s-rollout",
    "k8s-scale",
    "k8s-script",
    "k8s-top",
    "log",
    "netcat",
    "opensearch",
    "ping",
    "python",
    "sftp",
    "shell-exec",
    "shell-script",
    "sql-client",
    "ssh-session-close",
    "ssh-session-exec",
    "ssh-session-open",
    "ssh-session-script",
    "ssh-tunnel-close",
    "ssh-tunnel-open",
    "xml-parser",
} | ENGINE_DISPATCHED_ELEMENT_TYPES

_VARIABLE_NAME_PATTERN = re.compile(f"^{VARIABLE_NAME_PATTERN}$")
_PREFIX_WORKFLOW_EDGES = f"{_PATH_WORKFLOW_EDGES}."
_PREFIX_VARIABLES = "variables."
_TYPE_SUFFIX = ".type"
_EXT_JSON = ".json"
_EXT_YAML = ".yaml"
_TESTDATA_ARCHIVE_PREFIX = "testdata/"
_ZIP_MEDIA_TYPE = "application/zip"
_Documents = list[tuple[str, dict[str, Any]]]
_FilesByTestId = dict[str, list[tuple[str, bytes]]]

# Output param type -> set of compatible variable types (mirrors FE OUTPUT_TYPE_COMPAT).
_OUTPUT_TYPE_COMPAT: dict[str, set[str]] = {
    "string": {"string"},
    "integer": {"integer"},
    "float": {"float", "integer"},
    "boolean": {"boolean"},
    "map": {"map"},
    "array": {"array"},
    "table": {"table"},
}


# Where each declaration problem points inside the variable, and the fix it offers.
_DECLARATION_FIXES: dict[str, tuple[str, str]] = {
    "RESERVED_VARIABLE_NAME": ("", "Rename the variable"),
    "INVALID_VARIABLE_TYPE": (_TYPE_SUFFIX, "Set type to string"),
    "INVALID_ELEMENT_TYPES": (
        ".elementTypes",
        "Declare each element's type as one of: array, boolean, float, integer, map, string",
    ),
}


def _invalid_name_fix(nodes: list[dict[str, Any]], var_name: str) -> str:
    if not _sites_naming(nodes, var_name):
        return "Delete unused variable"
    return "Rename to valid identifier and update references"


def _validate_variables(
    variables: dict[str, Any],
    nodes: list[dict[str, Any]],
    add_error: Any,
) -> None:
    """Validate test variable declarations."""
    aliases = _collect_profile_aliases(nodes)
    for var_name, var_info in variables.items():
        var_path = f"{_PREFIX_VARIABLES}{var_name}"
        declared = var_info if isinstance(var_info, dict) else {}
        for code, message in declaration_problems(
            var_name, declared.get("type"), declared.get("elementTypes"), kind="variable"
        ):
            suffix, fix_action = _DECLARATION_FIXES.get(code, ("", ""))
            add_error(
                path=f"{var_path}{suffix}",
                code=code,
                message=message,
                fix_action=fix_action or _invalid_name_fix(nodes, var_name),
            )

        problem = declared_value_of(declared, "value")
        if problem is not None:
            add_error(
                path=f"{var_path}.value",
                code="INVALID_VARIABLE_VALUE",
                message=problem.describe(f"Value for variable '{var_name}'"),
                fix_action=problem.fix,
            )

        # Cross-namespace conflict: variable name collides with a profile alias
        # bound by some element in this test.
        if var_name in aliases:
            add_error(
                path=var_path,
                code="ALIAS_NAME_CONFLICT",
                message=(
                    f"Variable name '{var_name}' conflicts with a profile alias bound "
                    f"in this test"
                ),
                fix_action="Rename the variable or change the profile alias",
            )


def _sites_naming(nodes: list[dict[str, Any]], var_name: str) -> _FoundSites:
    """Each block site naming ``var_name``; an invalid name is found in source text too."""
    as_text = _VARIABLE_NAME_PATTERN.match(var_name) is None
    return [
        (node, site)
        for node in nodes
        for site in block_sites(node)
        if var_name in site.names
        or (as_text and site.kind in _SOURCE_KINDS and var_name in site.text)
    ]


def _expected_types(found: _FoundSites) -> set[str]:
    """The types the settings and outputs naming a variable expect; a Setter target expects none."""
    types: set[str] = set()
    for node, site in found:
        if site.kind != SiteKind.SETTER_TARGET:
            expected = _expected_type(node, site.setting)
            if expected:
                types.add(expected)
    return types


def _collect_profile_aliases(nodes: list[dict[str, Any]]) -> set[str]:
    """Collect profile aliases from all nodes (valid expression references)."""
    aliases: set[str] = set()
    for node in nodes:
        config = node.get("data", {}).get("config", {})
        for binding in config.get("profileBindings", []):
            alias = binding.get("alias", "")
            if alias:
                aliases.add(alias)
    return aliases


def _find_undeclared_variables(
    nodes: list[dict[str, Any]],
    declared: set[str],
) -> tuple[dict[str, _FoundSites], list[tuple[str, str]]]:
    """Names blocks read or write with no declaration, plus output bindings into a namespace.

    The second list holds (block id, target) for each output binding that targets
    a namespace variable; such a target is never reported undeclared.
    """
    from wavecore.core.variables.reserved import RESERVED_VARIABLE_NAMES

    undeclared: dict[str, _FoundSites] = {}
    namespace_binding_targets: list[tuple[str, str]] = []
    all_declared = declared | _collect_profile_aliases(nodes) | RESERVED_VARIABLE_NAMES
    namespace_prefixes = tuple(f"{ns}." for ns in RESERVED_VARIABLE_NAMES)

    for node in nodes:
        for site in _checked_sites(node):
            if site.kind == SiteKind.OUTPUT_BINDING and (
                site.text in RESERVED_VARIABLE_NAMES or site.text.startswith(namespace_prefixes)
            ):
                namespace_binding_targets.append((site.node_id, site.text))
                continue
            for name in sorted(site.names - all_declared):
                undeclared.setdefault(name, []).append((node, site))

    return undeclared, namespace_binding_targets


def _checked_sites(node: dict[str, Any]) -> Iterator[NameSite]:
    """The sites UNDECLARED checks: writes and expression or template settings and entries."""
    data = node.get("data") or {}
    fields = {*(data.get("expressionFields") or []), *(data.get("templateFields") or [])}
    return (site for site in block_sites(node) if site.writes or _is_flagged_setting(site, fields))


def _is_flagged_setting(site: NameSite, fields: set[str]) -> bool:
    """A setting or one entry of it the block marks expression or template."""
    return site.path[:2] == ("config", "values") and site.setting in fields


def _schema_by_name(schema: list[Any]) -> dict[str, dict[str, Any]]:
    """Index a parameter schema by name; non-dict entries keep only their default."""
    indexed: dict[str, dict[str, Any]] = {}
    for p in schema:
        if isinstance(p, dict):
            indexed[str(p.get("name", ""))] = p
        else:
            indexed[str(getattr(p, "name", ""))] = {"default": getattr(p, "default", None)}
    return indexed


def _find_type_in_schema(
    schema: list[Any],
    param_name: str,
    values: Mapping[str, Any],
    parameters: Mapping[str, Mapping[str, Any]] | None,
) -> str | None:
    """Search a parameter/output schema list for a named field's effective type."""
    for p in schema:
        fallback_name = p.get("name", "") if isinstance(p, dict) else ""
        p_name = p.name if hasattr(p, "name") else fallback_name
        if p_name != param_name:
            continue
        declared: Any = "string"
        type_when = None
        if hasattr(p, "type"):
            declared = p.type
            type_when = getattr(p, "type_when", None)
        elif isinstance(p, dict):
            declared = p.get("type", "string")
            type_when = p.get("type_when")
        # A parameter that accepts several types, or any type, has no single expected type.
        if isinstance(declared, list) or get_param_attr(p, "accepts_any_type", False):
            return None
        return resolve_output_type(str(declared), type_when, values, parameters)
    return None


def _expected_type(node: dict[str, Any], setting: str) -> str | None:
    """The single type a Block's setting or output expects, or None when it takes several."""
    data = node.get("data") or {}
    schema = block_schema(data)
    fields = list(schema.fields)
    parameters = _schema_by_name(fields)
    values = (data.get("config") or {}).get("values", {})
    found = _find_type_in_schema(fields, setting, values, parameters)
    return found or _find_type_in_schema(list(schema.outputs), setting, values, parameters)


def _rename_variable_in_expression(expr: str, old_name: str, new_name: str) -> str:
    """Rename a variable in a Python expression using AST to avoid replacing string literals.

    Uses Python's AST parser to find actual identifier (Name) nodes matching
    old_name and replaces only those, leaving string content untouched.

    Example:
        f'my_var: {my_var}' with my_var -> new_var
        Result: f'my_var: {new_var}'  (literal text preserved, identifier renamed)

    Falls back to exact-match-only replacement if the expression can't be parsed.

    Args:
        expr: The expression string
        old_name: Variable name to find
        new_name: Variable name to replace with

    Returns:
        Expression with identifiers renamed
    """
    # If the entire expression is the variable name, replace directly.
    # This handles invalid variable names (e.g., "2-used-same") that may
    # coincidentally parse as valid Python (2 - used - same).
    if expr == old_name:
        return new_name

    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        return expr

    # Collect positions of Name nodes matching old_name
    replacements: list[tuple[int, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == old_name:
            replacements.append(
                (node.col_offset, node.end_col_offset or node.col_offset + len(old_name))
            )

    if not replacements:
        return expr

    # Replace right-to-left to preserve earlier offsets
    result = expr
    for start, end in sorted(replacements, reverse=True):
        result = result[:start] + new_name + result[end:]
    return result


def _find_node_by_id(nodes: list[dict[str, Any]], node_id: str) -> dict[str, Any] | None:
    """Find a node by ID in a list of workflow nodes."""
    for node in nodes:
        if node.get("id") == node_id:
            return node
    return None


def _function_flow_nodes(
    nodes: list[dict[str, Any]], trail: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """The Blocks of the Function flow a body finding's ``function_path`` ends in."""
    for segment in trail:
        holder = _find_node_by_id(nodes, str(segment.get("node_id") or ""))
        flows = nested_function_workflows(holder)
        nodes = [node for flow in flows for node in flow.get("nodes") or []]
    return nodes


# Error codes that cause node removal during fix
_NODE_REMOVAL_CODES = frozenset(
    {
        "INVALID_NODE_TYPE",
        "UNKNOWN_BLOCK_TYPE",
        "MISSING_BLOCK_TYPE",
        "NODE_TYPE_MISMATCH",
        "INVALID_VERSION",
    }
)


def _fix_missing_node_ids(nodes: list[dict[str, Any]], code: str) -> None:
    """Generate IDs for nodes missing them."""
    for node in nodes:
        if not node.get("id") or not isinstance(node.get("id"), str):
            new_id = str(uuid.uuid4())
            node["id"] = new_id
            logger.debug("  FIX %-25s generated id=%s", code, new_id)


def _fix_assertion_ids(nodes: list[dict[str, Any]], node_id: str, code: str) -> None:
    """Generate assertion IDs for a node with missing ones."""
    found = _find_node_by_id(nodes, node_id)
    if not found:
        return
    assertions = found.get("data", {}).get("config", {}).get("values", {}).get("assertions", [])
    if isinstance(assertions, list):
        fixed = _fix_missing_assertion_ids(assertions)
        logger.debug("  FIX %-25s node=%s generated %d assertion IDs", code, node_id, fixed)


def _fix_node_position(nodes: list[dict[str, Any]], node_id: str, code: str) -> None:
    """Set default position for a node."""
    found = _find_node_by_id(nodes, node_id)
    if found:
        found["position"] = {"x": 100, "y": 100}
        logger.debug("  FIX %-25s set default position node=%s", code, node_id)


_UNKNOWN_TYPE_NAME = "Unknown"


def _name_after_type(node: dict[str, Any]) -> str:
    """Give a block with no Name its type's name, as the palette shows it (EXEC-25, EXEC-26)."""
    label = node_type_name(node) or _UNKNOWN_TYPE_NAME
    data = node.get("data") or {}
    data["label"] = label
    return label


def _fix_node_label(nodes: list[dict[str, Any]], node_id: str, code: str) -> None:
    """Name a node that has no label after its type."""
    found = _find_node_by_id(nodes, node_id)
    if found:
        label = _name_after_type(found)
        logger.debug("  FIX %-25s node=%s label='%s'", code, node_id, label)


def _fix_node_description_length(nodes: list[dict[str, Any]], node_id: str, code: str) -> None:
    """Trim an over-length description down to the 64-character cap."""
    found = _find_node_by_id(nodes, node_id)
    if not found:
        return
    data = found.get("data", {})
    description = data.get("description")
    if isinstance(description, str) and len(description) > 64:
        data["description"] = description[:64]
        logger.debug("  FIX %-25s node=%s trimmed description to 64 chars", code, node_id)


def _fix_function_flow_node(code: str, node_id: str, flow_nodes: list[dict[str, Any]]) -> None:
    """Name or trim a Block of a Function flow; a Function flow Block is never removed here."""
    if code == "MISSING_LABEL":
        _fix_node_label(flow_nodes, node_id, code)
    elif code == "DESCRIPTION_TOO_LONG":
        _fix_node_description_length(flow_nodes, node_id, code)


def _fix_node_errors(
    error: dict[str, Any],
    nodes: list[dict[str, Any]],
    nodes_to_remove: set[str],
) -> None:
    """Apply node-level fixes for a single error."""
    code = error.get("code", "")
    node_id = error.get("node_id")
    trail = error.get("function_path")
    if trail and node_id:
        _fix_function_flow_node(code, node_id, _function_flow_nodes(nodes, trail))
        return

    if code == "MISSING_NODE_ID":
        _fix_missing_node_ids(nodes, code)
    elif not node_id:
        return
    elif code == "MISSING_ASSERTION_ID":
        _fix_assertion_ids(nodes, node_id, code)
    elif code in _NODE_REMOVAL_CODES:
        nodes_to_remove.add(node_id)
        logger.debug("  FIX %-25s remove node=%s", code, node_id)
    elif code in ("MISSING_POSITION", "INVALID_POSITION"):
        _fix_node_position(nodes, node_id, code)
    elif code == "MISSING_LABEL":
        _fix_node_label(nodes, node_id, code)
    elif code == "DESCRIPTION_TOO_LONG":
        _fix_node_description_length(nodes, node_id, code)


def _extract_edge_id_from_path(path: str) -> str | None:
    """Extract edge ID from a workflow.edges.{id} path."""
    if path.startswith(_PREFIX_WORKFLOW_EDGES):
        return path[len(_PREFIX_WORKFLOW_EDGES) :]
    return None


def _fix_stale_handle(edges: list[dict[str, Any]], edge_id: str, code: str) -> None:
    """Reset a stale targetHandle to default."""
    for e in edges:
        if e.get("id") == edge_id:
            old_handle = e.pop("targetHandle", None)
            logger.debug("  FIX %-25s edge=%s handle '%s' -> default", code, edge_id, old_handle)
            break


def _fix_cross_scope(edges: list[dict[str, Any]], edge_id: str, code: str) -> list[dict[str, Any]]:
    """Remove a cross-scope edge by ID."""
    edges_before = len(edges)
    edges = [e for e in edges if e.get("id") != edge_id]
    if len(edges) < edges_before:
        logger.debug("  FIX %-25s removed edge=%s", code, edge_id)
    return edges


def _fix_invalid_edge_type(edges: list[dict[str, Any]], path: str, code: str) -> None:
    """Reset edge type for invalid edge type by index path."""
    if not path.startswith("edges["):
        return
    idx_str = path[len("edges[") :].rstrip("]")
    try:
        idx = int(idx_str)
        if 0 <= idx < len(edges):
            edges[idx].pop("type", None)
            logger.debug("  FIX %-25s reset edge[%d] type", code, idx)
    except ValueError:
        pass


def _fix_edge_errors(
    error: dict[str, Any],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Apply edge-level fixes for a single error. Returns (possibly new) edges list."""
    code = error.get("code", "")

    if code == "STALE_TARGET_HANDLE":
        edge_id = _extract_edge_id_from_path(error.get("path", ""))
        if edge_id:
            _fix_stale_handle(edges, edge_id, code)
    elif code == "CROSS_SCOPE_EDGE":
        edge_id = _extract_edge_id_from_path(error.get("path", ""))
        if edge_id:
            edges = _fix_cross_scope(edges, edge_id, code)
    elif code in ("DANGLING_EDGE", "SELF_LOOP_EDGE", "MULTIPLE_EDGES"):
        logger.debug("  FIX %-25s (edge filter pass)", code)
    elif code == "INVALID_EDGE_TYPE":
        _fix_invalid_edge_type(edges, error.get("path", ""), code)

    return edges


def _fix_invalid_variable(
    error: dict[str, Any],
    test: dict[str, Any],
    nodes: list[dict[str, Any]],
) -> None:
    """Fix an invalid variable name: delete if unused, rename if used."""
    var_path = error.get("path", "")
    code = error.get("code", "")
    if not var_path.startswith(_PREFIX_VARIABLES):
        return
    bad_name = var_path[len(_PREFIX_VARIABLES) :]
    variables = test.get("variables", {})
    if bad_name not in variables:
        return

    found = _sites_naming(nodes, bad_name)
    if not found:
        del variables[bad_name]
        logger.debug("  FIX %-25s delete unused var='%s'", code, bad_name)
        return

    fixed_name = f"fixed_{uuid.uuid4().hex[:8]}"
    variables[fixed_name] = variables.pop(bad_name)
    logger.debug(
        "  FIX %-25s rename var='%s' -> '%s' (%d ref(s))",
        code,
        bad_name,
        fixed_name,
        len(found),
    )
    _rename_sites(found, bad_name, fixed_name)


def _rename_in_template(text: str, old_name: str, new_name: str) -> str:
    """A template with the name renamed inside each ``{{ }}`` marker; the text around stays."""

    def marker(match: re.Match[str]) -> str:
        inner = match.group(1)
        piece = inner.strip()
        renamed = _rename_variable_in_expression(piece, old_name, new_name)
        return "{{" + inner.replace(piece, renamed, 1) + "}}"

    return _TEMPLATE_PATTERN.sub(marker, text)


def _renamed_text(site: NameSite, old_name: str, new_name: str) -> str:
    if site.kind == SiteKind.EXPRESSION:
        return _rename_variable_in_expression(site.text, old_name, new_name)
    if site.kind == SiteKind.TEMPLATE:
        return _rename_in_template(site.text, old_name, new_name)
    return new_name if site.text == old_name else site.text


def _renamed_key(name: Any, old_name: str, new_name: str) -> Any:
    return new_name if name == old_name else name


def _rename_setter_target(data: dict[str, Any], old_name: str, new_name: str) -> None:
    """A renamed Setter target moves across its row, kind keys, types and secret keys."""
    config = data["config"]
    rows = config["values"]["variables"]
    config["values"]["variables"] = {
        _renamed_key(key, old_name, new_name): value for key, value in rows.items()
    }
    for owner, key in (
        (data, "variableExpressionKeys"),
        (data, "variableTemplateKeys"),
        (config, "variableSecretKeys"),
    ):
        if isinstance(owner.get(key), list):
            owner[key] = [_renamed_key(name, old_name, new_name) for name in owner[key]]
    for key in ("variableTypes", "variableElementTypes"):
        if isinstance(data.get(key), dict):
            data[key] = {
                _renamed_key(name, old_name, new_name): value for name, value in data[key].items()
            }


def _rename_sites(found: _FoundSites, old_name: str, new_name: str) -> None:
    """Rewrite each site to name ``new_name``; a Setter target moves after its row is rewritten."""
    for node, site in sorted(found, key=lambda pair: pair[1].kind == SiteKind.SETTER_TARGET):
        data = node["data"]
        if site.kind == SiteKind.SETTER_TARGET:
            _rename_setter_target(data, old_name, new_name)
            continue
        holder: Any = data
        *parents, last = site.path
        for part in parents:
            holder = holder[int(part)] if isinstance(holder, list) else holder[part]
        holder[int(last) if isinstance(holder, list) else last] = _renamed_text(
            site, old_name, new_name
        )


def _fix_invalid_variable_type(
    error: dict[str, Any],
    test: dict[str, Any],
) -> None:
    """Fix an invalid variable type by resetting to 'string'."""
    var_path = error.get("path", "")
    code = error.get("code", "")
    if not (var_path.startswith(_PREFIX_VARIABLES) and var_path.endswith(_TYPE_SUFFIX)):
        return
    var_name = var_path[len(_PREFIX_VARIABLES) : -len(_TYPE_SUFFIX)]
    variables = test.get("variables", {})
    if var_name in variables and isinstance(variables[var_name], dict):
        old_type = variables[var_name].get("type", "?")
        variables[var_name]["type"] = "string"
        logger.debug("  FIX %-25s var='%s' type '%s' -> 'string'", code, var_name, old_type)


def _fix_undeclared_variable(
    error: dict[str, Any],
    test: dict[str, Any],
    nodes: list[dict[str, Any]],
) -> None:
    """Fix an undeclared variable: create it or remove conflicting refs."""
    var_path = error.get("path", "")
    code = error.get("code", "")
    if not var_path.startswith(_PREFIX_VARIABLES):
        return
    var_name = var_path[len(_PREFIX_VARIABLES) :]
    variables = test.get("variables", {})

    found = _sites_naming(nodes, var_name)
    if not found:
        logger.debug("  FIX %-25s skip var='%s' (no usages remain)", code, var_name)
        return

    inferred_types = _expected_types(found)
    if len(inferred_types) <= 1:
        inferred = next(iter(inferred_types), "string")
        variables[var_name] = {"type": inferred, "scope": "test"}
        logger.debug("  FIX %-25s create var='%s' type='%s'", code, var_name, inferred)
    else:
        logger.debug(
            "  FIX %-25s type conflict var='%s' types=%s, removing refs",
            code,
            var_name,
            inferred_types,
        )
        _remove_conflicting_bindings(found)


def _remove_conflicting_bindings(found: _FoundSites) -> None:
    """Remove the output bindings of a variable whose readers expect conflicting types."""
    for node, site in found:
        if site.kind == SiteKind.OUTPUT_BINDING:
            del node["data"]["config"]["outputBindings"][site.setting]


def _fix_variable_errors(
    error: dict[str, Any],
    test: dict[str, Any],
    nodes: list[dict[str, Any]],
) -> None:
    """Dispatch variable-related error fixes."""
    code = error.get("code", "")
    if code == "INVALID_VARIABLE":
        _fix_invalid_variable(error, test, nodes)
    elif code == "INVALID_VARIABLE_TYPE":
        _fix_invalid_variable_type(error, test)
    elif code == "UNDECLARED_VARIABLE":
        _fix_undeclared_variable(error, test, nodes)


# Error codes handled by node-level fixer
_NODE_FIX_CODES = _NODE_REMOVAL_CODES | {
    "MISSING_NODE_ID",
    "MISSING_ASSERTION_ID",
    "MISSING_POSITION",
    "INVALID_POSITION",
    "MISSING_LABEL",
    "DESCRIPTION_TOO_LONG",
}

# Error codes handled by edge-level fixer
_EDGE_FIX_CODES = frozenset(
    {
        "STALE_TARGET_HANDLE",
        "CROSS_SCOPE_EDGE",
        "DANGLING_EDGE",
        "SELF_LOOP_EDGE",
        "MULTIPLE_EDGES",
        "INVALID_EDGE_TYPE",
    }
)

# Error codes handled by variable-level fixer during implicit save-time autofix.
# UNDECLARED_VARIABLE is intentionally NOT in this set: silently recreating a
# referenced-but-undeclared variable overrides the user's explicit deletion.
# It lives in `_ON_DEMAND_VARIABLE_FIX_CODES` instead, so the user-initiated
# Fix button (via `fix_test`) still applies the fix while implicit save flows
# surface the error and let the FE dialog ask for consent.
_VARIABLE_FIX_CODES = frozenset(
    {
        "INVALID_VARIABLE",
        "INVALID_VARIABLE_TYPE",
    }
)

# Variable-level fixes applied only on explicit user action (the Fix button
# in the validation dialog calls `fix_test`, which opts in to this set).
_ON_DEMAND_VARIABLE_FIX_CODES = frozenset(
    {
        "UNDECLARED_VARIABLE",
    }
)


def _apply_error_fixes(
    errors: list[dict[str, Any]],
    test: dict[str, Any],
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    *,
    include_on_demand: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], set[str]]:
    """Apply fixes for all errors. Returns (nodes, edges, nodes_to_remove).

    `include_on_demand` opts the user-initiated Fix path (the validation
    dialog's Fix button -> `fix_test`) into `_ON_DEMAND_VARIABLE_FIX_CODES`.
    Implicit save-time autofix leaves this flag off so deletions are never
    silently reverted.
    """
    nodes_to_remove: set[str] = set()
    variable_fix_codes = _VARIABLE_FIX_CODES
    if include_on_demand:
        variable_fix_codes = _VARIABLE_FIX_CODES | _ON_DEMAND_VARIABLE_FIX_CODES

    for error in errors:
        code = error.get("code", "")
        if code in _NODE_FIX_CODES:
            _fix_node_errors(error, nodes, nodes_to_remove)
        elif code in _EDGE_FIX_CODES:
            edges = _fix_edge_errors(error, edges)
        elif code in variable_fix_codes:
            _fix_variable_errors(error, test, nodes)

    return nodes, edges, nodes_to_remove


def _post_fix_edge_cleanup(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    nodes_to_remove: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Clean up edges after error fixes: remove dangling, multi-edge, normalize handles."""
    # Remove nodes marked for removal
    if nodes_to_remove:
        nodes = [n for n in nodes if n.get("id") not in nodes_to_remove]
        edges_before = len(edges)
        edges = [
            e
            for e in edges
            if e.get("source") not in nodes_to_remove and e.get("target") not in nodes_to_remove
        ]
        logger.debug(
            "  Removed %d node(s) + %d connected edge(s)",
            len(nodes_to_remove),
            edges_before - len(edges),
        )

    # Filter dangling/self-loop edges
    node_ids = {n.get("id") for n in nodes if n.get("id")}
    valid_sources = node_ids | {"start-node"}
    edges_before = len(edges)
    edges = [
        e
        for e in edges
        if e.get("source") in valid_sources
        and e.get("target") in node_ids
        and e.get("source") != e.get("target")
    ]
    dangling_removed = edges_before - len(edges)
    if dangling_removed:
        logger.debug("  Filtered %d dangling/self-loop edge(s)", dangling_removed)

    # Fix multiple edges
    edges = _fix_multi_edges(nodes, edges)
    edges = _fix_duplicate_source_handles(edges)

    # Normalize stale targetHandle references
    _normalize_target_handles(edges)

    return nodes, edges


def _fix_multi_edges(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Remove edges for nodes whose outgoing count exceeds their structure-hint
    max, or whose incoming count on the same handle exceeds 1.

    The per-node outgoing max comes from `_compute_branching_max_edges`, which
    reads each control's `structure_hints` (branching / scoped / looping) from
    the registry. This is the same source the validator uses, so the auto-fix
    no longer prunes legitimate body+then edges from for / for-each / while
    loops just because their element types aren't in a hardcoded whitelist.
    """
    from wavecore.models.enums import ControlId

    control_ids = {cid.value for cid in ControlId}
    branching_max = _compute_branching_max_edges(nodes, control_ids)

    outgoing: dict[str, int] = {}
    incoming: dict[tuple[str, str | None], int] = {}
    for e in edges:
        src, tgt = e.get("source"), e.get("target")
        if src:
            outgoing[src] = outgoing.get(src, 0) + 1
        if tgt:
            # Rejoins land on distinct ingress handles; only same-handle collisions are invalid.
            key = (tgt, e.get("targetHandle") or None)
            incoming[key] = incoming.get(key, 0) + 1

    multi_out = {nid for nid, c in outgoing.items() if c > branching_max.get(nid, 1)}
    multi_in = {key for key, c in incoming.items() if c > 1}
    if multi_out or multi_in:
        edges_before = len(edges)
        edges = [
            e
            for e in edges
            if e.get("source") not in multi_out
            and (e.get("target"), e.get("targetHandle") or None) not in multi_in
        ]
        logger.debug(
            "  Multi-edge fix: removed %d edge(s) (multi-out nodes: %s, multi-in handles: %s)",
            edges_before - len(edges),
            ", ".join(sorted(multi_out)) or "none",
            ", ".join(f"{tgt}:{handle or 'default'}" for tgt, handle in sorted(multi_in, key=str))
            or "none",
        )
    return edges


def _fix_duplicate_source_handles(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only the first outgoing edge on each named source handle.

    First-wins matches the runtime handle-target map, which routes to the
    first target it sees and ignores the rest.
    """
    seen: set[tuple[str, str]] = set()
    kept: list[dict[str, Any]] = []
    dropped = 0
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        handle = edge.get("sourceHandle")
        if not handle or not source or source == target:
            kept.append(edge)
            continue
        key = (str(source), str(handle))
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        kept.append(edge)
    if dropped:
        logger.debug("  Duplicate source-handle fix: removed %d edge(s)", dropped)
    return kept


def _normalize_target_handles(edges: list[dict[str, Any]]) -> None:
    """Reset stale targetHandle on edges where the target has only 1 incoming edge."""
    incoming_by_target: dict[str, list[dict[str, Any]]] = {}
    for e in edges:
        tgt = e.get("target")
        if tgt:
            incoming_by_target.setdefault(tgt, []).append(e)

    for _tgt, tgt_edges in incoming_by_target.items():
        if len(tgt_edges) == 1:
            e = tgt_edges[0]
            if e.get("targetHandle"):
                logger.debug(
                    "  Normalize: edge %s targetHandle '%s' -> default (single ingress)",
                    e.get("id"),
                    e.get("targetHandle"),
                )
                e.pop("targetHandle", None)


def fix_test(test_id: str) -> dict[str, Any] | None:
    """Apply automatic fixes to a test.

    Validates the test, applies all fixable fixes, saves, and returns
    the fixed test data along with any post-fix warnings.

    Args:
        test_id: Test UUID

    Returns:
        Dict with "test" (fixed test data) and "warnings" (post-fix
        validation warnings), or None if test not found

    Raises:
        ValueError: If test has fatal errors that cannot be fixed
    """
    test = _load_test(test_id)
    if test is None:
        return None

    validation = _validate_test_data(test, context="load")

    if validation.get("fatal"):
        raise ValidationException("Test has fatal errors that cannot be auto-fixed")

    test_name = test.get("name", "?")
    errors = validation.get("errors", [])
    if not errors:
        logger.debug("Fix test=%s (%s): nothing to fix", test_name, test_id)
        result = test.copy()
        result["variables"] = shared.mask_secret_variables(
            test.get("variables", {}), flag_masked=True
        )
        return {"test": result, "warnings": []}

    logger.debug(
        "Fix test=%s (%s): applying fixes for %d error(s)", test_name, test_id, len(errors)
    )

    workflow = test.get("workflow", {})
    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])

    # Apply per-error fixes. fix_test is the explicit, user-initiated Fix
    # path (the validation dialog's Fix button) so on-demand fixes
    # (`_ON_DEMAND_VARIABLE_FIX_CODES`, currently UNDECLARED_VARIABLE) opt in.
    nodes, edges, nodes_to_remove = _apply_error_fixes(
        errors,
        test,
        nodes,
        edges,
        include_on_demand=True,
    )

    # Post-fix cleanup
    nodes, edges = _post_fix_edge_cleanup(nodes, edges, nodes_to_remove)

    workflow["nodes"] = nodes
    workflow["edges"] = edges
    test["workflow"] = workflow

    _save_test(test)
    logger.debug("  Fix complete: %d node(s), %d edge(s) remaining", len(nodes), len(edges))

    # Re-validate after fix to detect cascading issues. On load context,
    # visible-class issues (REQUIRED_PARAM_*, INVALID_OUTPUT_BINDING_TYPE)
    # are surfaced as warnings (not errors); preserve them so the FE can
    # render alert icons after the auto-fix completes.
    post_fix_validation = _validate_test_data(test, context="load")
    post_fix_warnings = post_fix_validation.get("warnings", [])

    result = test.copy()
    result["variables"] = shared.mask_secret_variables(test.get("variables", {}), flag_masked=True)
    return {"test": result, "warnings": post_fix_warnings}


def clone_test(
    test_id: str, new_name: str, new_version: str | None = None
) -> dict[str, Any] | None:
    """Clone a test with a new name.

    Args:
        test_id: Source test UUID
        new_name: Name for the cloned test
        new_version: Optional version for the clone

    Returns:
        Cloned test or None if source not found
    """
    source = _load_test(test_id)
    if source is None:
        return None

    now = datetime.now(UTC).isoformat()
    clone_id = str(uuid.uuid4())

    clone = source.copy()
    clone["id"] = clone_id
    clone["name"] = new_name
    clone["version"] = new_version or "1.0.0"
    clone["created_at"] = now
    clone["updated_at"] = now
    clone["metadata"] = {**source.get("metadata", {}), "cloned_from": test_id}
    clone["variables"] = source.get("variables", {}).copy()

    # Store clone
    _save_test(clone)
    _save_versions(
        clone_id,
        [
            {
                "version": clone["version"],
                "created_at": now,
                "created_by": "system",
                "changes": f"Cloned from {source.get('name')}",
            }
        ],
    )
    testdata_service.copy_for_clone(test_id, clone_id)

    # Return copy with masked secrets
    result = clone.copy()
    result["variables"] = shared.mask_secret_variables(clone.get("variables", {}), flag_masked=True)
    return result


def get_test_dependency_graph(test_id: str) -> dict[str, Any] | None:
    """Get test dependency graph.

    Args:
        test_id: Test UUID

    Returns:
        Dependency graph with nodes and edges or None if not found
    """
    test = _load_test(test_id)
    if test is None:
        return None

    workflow = test.get("workflow", {})
    nodes = workflow.get("nodes", [])

    # Extract block references from workflow nodes
    dep_nodes: list[dict[str, Any]] = []
    dep_edges: list[dict[str, Any]] = []

    for node in nodes:
        if node.get("type") == "block":
            block_id = node.get("block_id") or node.get("block_ref")
            if block_id:
                dep_nodes.append(
                    {
                        "id": block_id,
                        "type": "block",
                        "version": node.get("version", "1.0.0"),
                    }
                )
                dep_edges.append({"source": test_id, "target": block_id})

    return {"nodes": dep_nodes, "edges": dep_edges}


def get_test_history(test_id: str) -> dict[str, Any] | None:
    """Get complete version history for a test.

    Args:
        test_id: Test UUID

    Returns:
        Version history or None if test not found
    """
    test = _load_test(test_id)
    if test is None:
        return None

    versions = _load_versions(test_id)

    # Sort by version (newest first)
    sorted_versions = sorted(versions, key=lambda v: v["version"], reverse=True)

    return {"versions": sorted_versions}


def restore_test_version(test_id: str, version: str) -> dict[str, Any] | None:
    """Restore test to a specific version.

    Args:
        test_id: Test UUID
        version: Version to restore to

    Returns:
        Test with new version created from restore, or None if not found

    Raises:
        ValueError: If version not found
    """
    test = _load_test(test_id)
    if test is None:
        return None

    versions = _load_versions(test_id)

    # Check version exists
    version_entry = next((v for v in versions if v["version"] == version), None)
    if version_entry is None:
        raise ValidationException(f"Version '{version}' not found for test '{test_id}'")

    now = datetime.now(UTC).isoformat()

    new_version = shared.next_semantic_version(str(test.get("version", "1.0.0")), "minor")

    # Update test
    test["version"] = new_version
    test["updated_at"] = now
    test["metadata"] = {**test.get("metadata", {}), "restored_from": version}

    # Save updated test
    _save_test(test)

    # Add to version history
    versions.append(
        {
            "version": new_version,
            "created_at": now,
            "created_by": "system",
            "changes": f"Restored from v{version}",
        }
    )
    _save_versions(test_id, versions)

    # Return copy with masked secrets
    result = test.copy()
    result["variables"] = shared.mask_secret_variables(test.get("variables", {}), flag_masked=True)
    return result


def list_all_tags() -> list[str]:
    """Get all unique tags from all tests.

    Tags are stored in metadata.tags for tests.

    Returns:
        List of unique tag strings, sorted alphabetically
    """
    tags_set: set[str] = set()
    for test in _list_all_tests():
        metadata = test.get("metadata", {})
        tags_set.update(metadata.get("tags", []))
    return sorted(tags_set)


# ============================================================================
# Import / Export (REQ-5.2.4.9)
# ============================================================================


def _sanitize_filename(name: str) -> str:
    """Remove special characters from a name for use as a filename.

    Replaces spaces with hyphens and strips anything that is not
    alphanumeric, hyphen, or underscore.

    Args:
        name: Raw test name

    Returns:
        Filesystem-safe filename (without extension)
    """
    return shared.export_file_stem(name, "test")


def _generate_unique_name(base_name: str) -> str:
    """Append (2), (3), etc. until the name is unique among existing tests.

    Args:
        base_name: Desired test name

    Returns:
        A unique name (may be base_name itself if already unique)
    """
    return shared.first_free_name(base_name, {t["name"] for t in _list_all_tests() if "name" in t})


def _parse_test_file(content: bytes, filename: str) -> dict[str, Any]:
    """Parse a single YAML or JSON file into a test dict.

    Args:
        content: Raw file bytes
        filename: Original filename (used to detect format)

    Returns:
        Parsed test data dict

    Raises:
        ValueError: If the file cannot be parsed
    """
    text = content.decode("utf-8")
    lower = filename.lower()

    if lower.endswith(_EXT_JSON):
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValidationException(f"Invalid JSON: {exc}") from exc
    elif lower.endswith((_EXT_YAML, ".yml")):
        try:
            data = load_yaml(text)
        except yaml.YAMLError as exc:
            raise ValidationException(f"Invalid YAML: {exc}") from exc
    else:
        raise ValidationException(f"Unsupported file format: {filename}")

    shared.refuse_unencodable_file(text, data)
    if not isinstance(data, dict):
        raise ValidationException(f"Expected a mapping at top level, got {type(data).__name__}")

    return data


def _valid_testdata_path(rel: str) -> bool:
    """The relative-path rule plus the name rule on every segment."""
    if not file_tree.is_safe_relative_path(rel):
        return False
    try:
        for segment in rel.split("/"):
            testdata_service.check_name(segment)
    except ValidationException:
        return False
    return True


def collect_testdata_member(
    files: _FilesByTestId, zf: zipfile.ZipFile, member: str, prefix: str
) -> None:
    """Route one ``<prefix><test id>/<rel>`` archive member into files; folder entries are ignored.

    Raises:
        ValidationException: ``Invalid test data path`` with the full member name on a bad entry
    """
    if member.endswith("/"):
        return
    test_id, _sep, rel = member[len(prefix) :].partition("/")
    if not test_id or not _valid_testdata_path(rel):
        raise ValidationException(f"Invalid test data path: {member}")
    files.setdefault(test_id, []).append((rel, zf.read(member)))


def _parse_zip_file(content: bytes) -> tuple[_Documents, _FilesByTestId]:
    """Split an import archive into its test documents and its test data files.

    ``testdata/<test id>/<rel>`` members are partitioned out before the
    document scan, so a fixture with a document extension is never a test.

    Raises:
        ValidationException: If the ZIP is invalid, carries a bad test data
            entry, or contains no importable documents
    """
    files: _FilesByTestId = {}

    def claim(zf: zipfile.ZipFile, member: str) -> bool:
        if not member.startswith(_TESTDATA_ARCHIVE_PREFIX):
            return False
        collect_testdata_member(files, zf, member, _TESTDATA_ARCHIVE_PREFIX)
        return True

    documents = shared.parse_zip_file(
        content, parse=_parse_test_file, skip_dunder=True, claim_member=claim
    )
    return documents, files


def document_media_type(fmt: str) -> str:
    """The media type of an exported document in the given format."""
    return "application/json" if fmt == "json" else "application/x-yaml"


def testdata_member_name(test_id: str, rel: str) -> str:
    """The export archive member name of one test data file."""
    return f"{_TESTDATA_ARCHIVE_PREFIX}{test_id}/{rel}"


def _export_document(test: dict[str, Any], fmt: str, secrets: str) -> tuple[str, str]:
    """Serialize one test with the secrets mode applied; returns (content, filename)."""
    export_data = test.copy()
    export_data["variables"] = shared.apply_secrets_mode_to_variables(
        test.get("variables", {}), secrets
    )
    export_data["workflow"] = shared.apply_secrets_mode_to_workflow(
        test.get("workflow", {}), secrets
    )

    ext = "json" if fmt == "json" else "yaml"
    filename = f"{_sanitize_filename(test['name'])}.{ext}"

    if fmt == "json":
        content = json.dumps(export_data, indent=2, default=str)
    else:
        content = yaml.dump(export_data, default_flow_style=False, sort_keys=False)

    return content, filename


def export_test(
    test_id: str, fmt: str = "yaml", secrets: str = "mask"
) -> tuple[str | bytes, str, str] | None:
    """Export a single test as (content, filename, media_type), or None if not found.

    A test without files exports its document; a test with files exports a
    zip of the document plus its ``testdata/<test id>/<rel>`` entries under
    the same stem.
    """
    test = _load_test(test_id)
    if test is None:
        return None

    content, filename = _export_document(test, fmt, secrets)
    entries: list[tuple[str, shared.ZipContent]] = [
        (testdata_member_name(test_id, rel), path)
        for rel, path in testdata_service.iter_files(test_id)
    ]
    if not entries:
        return content, filename, document_media_type(fmt)

    entries.insert(0, (filename, content))
    return shared.build_export_zip(entries), f"{filename.rsplit('.', 1)[0]}.zip", _ZIP_MEDIA_TYPE


def export_tests_batch(
    test_ids: list[str], fmt: str = "yaml", secrets: str = "mask"
) -> tuple[list[tuple[str, str, str]], list[tuple[str, str, Path]]]:
    """Export multiple tests.

    Returns the (test_id, content, filename) documents with disambiguated
    filenames, plus the (test_id, relative path, on-disk path) files of every
    selected test that has any.

    Raises:
        ValidationException: If any test is not found
    """
    documents: list[tuple[str, str, str]] = []
    files: list[tuple[str, str, Path]] = []
    seen_filenames: set[str] = set()

    for tid in test_ids:
        test = _load_test(tid)
        if test is None:
            raise ValidationException(f"Test not found: {tid}")

        content, filename = _export_document(test, fmt, secrets)
        base_filename = filename
        counter = 2
        while filename in seen_filenames:
            name_part, ext_part = base_filename.rsplit(".", 1)
            filename = f"{name_part}-{counter}.{ext_part}"
            counter += 1
        seen_filenames.add(filename)

        documents.append((tid, content, filename))
        files.extend((tid, rel, path) for rel, path in testdata_service.iter_files(tid))

    return documents, files


# A variable value the number rule refuses: no import fix can make it a number.
_REFUSED_VALUE_CODE = "INVALID_VARIABLE_VALUE"


def _errors_with(validation: dict[str, Any], codes: frozenset[str]) -> list[dict[str, Any]]:
    """The errors of a validation result whose code is one of ``codes``."""
    return [e for e in validation.get("errors", []) if e.get("code") in codes]


def _read_only_errors(validation: dict[str, Any]) -> list[dict[str, Any]]:
    """The read-only refusals inside a validation result."""
    return _errors_with(validation, frozenset({READ_ONLY_CODE}))


def _blocking_import_errors(validation: dict[str, Any]) -> list[dict[str, Any]]:
    """The findings that block an import: a read-only refusal or a refused variable value."""
    return _errors_with(validation, frozenset({READ_ONLY_CODE, _REFUSED_VALUE_CODE}))


def validate_test_import(content: bytes, filename: str) -> dict[str, Any]:
    """Validate file content for import without persisting.

    Args:
        content: Raw file bytes
        filename: Original filename

    Returns:
        Validation results with per-test status

    Raises:
        ValueError: If file cannot be parsed at all
    """
    documents, files_by_id = _parse_import_entries(content, filename)

    existing_names = {t.get("name"): t.get("id") for t in _list_all_tests()}
    test_results: list[dict[str, Any]] = []

    for _fname, data in documents:
        name = data.get("name", "Unnamed")
        # Build a temporary test structure for validation
        temp_test = {
            "id": str(uuid.uuid4()),
            "name": name,
            "version": "1.0.0",
            "workflow": data.get("workflow", {}),
            "variables": data.get("variables", {}),
            "metadata": data.get("metadata", {}),
        }

        validation = _validate_test_data(temp_test, context="import")
        fatal_errors = []
        fixable_errors = []
        warnings = [
            *validation.get("warnings", []),
            *shared.check_foreign_envelopes(temp_test["variables"]),
            *shared.check_workflow_foreign_envelopes(temp_test["workflow"]),
        ]

        blocking = _blocking_import_errors(validation)
        if validation.get("fatal"):
            fatal_errors = validation.get("errors", [])
            status = "fatal"
        elif blocking:
            fatal_errors = blocking
            status = "fatal"
        elif validation.get("errors"):
            fixable_errors = validation.get("errors", [])
            status = "fixable"
        else:
            status = "ok"

        # Check name conflict
        existing_id = existing_names.get(name)
        if existing_id and status != "fatal":
            status = "conflict"

        test_results.append(
            {
                "name": name,
                "status": status,
                "fatal_errors": fatal_errors,
                "fixable_errors": fixable_errors,
                "warnings": warnings,
                "existing_test_id": existing_id,
                "testdata_files": len(_archive_files_for(files_by_id, data)),
            }
        )

    importable = sum(1 for t in test_results if t["status"] != "fatal")
    blocked = sum(1 for t in test_results if t["status"] == "fatal")

    return {
        "tests": test_results,
        "total": len(test_results),
        "importable": importable,
        "blocked": blocked,
    }


def _parse_import_entries(content: bytes, filename: str) -> tuple[_Documents, _FilesByTestId]:
    """Parse an import upload into (filename, data) documents plus the archive's test data files."""
    lower = filename.lower()
    if lower.endswith(".zip"):
        return _parse_zip_file(content)
    if lower.endswith((_EXT_YAML, ".yml", _EXT_JSON)):
        return [(filename, _parse_test_file(content, filename))], {}
    raise ValidationException(f"Unsupported file format: {filename}")


def _archive_files_for(
    files_by_id: _FilesByTestId, data: dict[str, Any]
) -> list[tuple[str, bytes]]:
    """The archive's files for one document, keyed by the id the document carries."""
    return files_by_id.get(str(data.get("id", "")), [])


def _import_fix_position(nodes: list[dict[str, Any]], node_id: str, applied: list[str]) -> None:
    """Fix missing position during import."""
    node = _find_node_by_id(nodes, node_id)
    if node:
        node["position"] = {"x": 100, "y": 100}
        applied.append(f"Added default position to block {node_id}")


def _import_fix_label(nodes: list[dict[str, Any]], node_id: str, applied: list[str]) -> None:
    """Fix missing label during import."""
    node = _find_node_by_id(nodes, node_id)
    if node:
        applied.append(f"Added name '{_name_after_type(node)}' to block {node_id}")


def _import_fix_node_ids(nodes: list[dict[str, Any]], applied: list[str]) -> None:
    """Generate missing node IDs during import."""
    for node in nodes:
        if not node.get("id"):
            node["id"] = str(uuid.uuid4())
            applied.append("Generated missing block ID")


def _import_fix_assertion_ids(
    nodes: list[dict[str, Any]], node_id: str, applied: list[str]
) -> None:
    """Generate missing assertion IDs during import."""
    node = _find_node_by_id(nodes, node_id)
    if not node:
        return
    assertions = node.get("data", {}).get("config", {}).get("values", {}).get("assertions", [])
    if isinstance(assertions, list):
        fixed = _fix_missing_assertion_ids(assertions)
        if fixed:
            applied.append(f"Generated {fixed} missing assertion IDs in block {node_id}")


def _apply_import_fixes(
    errors: list[dict[str, Any]],
    test_data: dict[str, Any],
) -> list[str]:
    """Apply auto-fixes during import. Returns list of fix descriptions."""
    applied: list[str] = []
    nodes = test_data["workflow"].get("nodes", [])

    for error in errors:
        code = error.get("code", "")
        node_id = error.get("node_id")
        trail = error.get("function_path")

        if code == "MISSING_POSITION" and node_id:
            _import_fix_position(nodes, node_id, applied)
        elif code == "MISSING_LABEL" and node_id:
            _import_fix_label(_function_flow_nodes(nodes, trail or []), node_id, applied)
        elif code == "MISSING_NODE_ID":
            _import_fix_node_ids(nodes, applied)
        elif code == "MISSING_ASSERTION_ID" and node_id:
            _import_fix_assertion_ids(nodes, node_id, applied)

    return applied


def _resolve_import_conflict(
    test_data: dict[str, Any],
    name: str,
    existing: dict[str, Any] | None,
    conflict_resolutions: dict[str, str],
    skipped: list[dict[str, Any]],
) -> str | None:
    """Resolve import conflict. Returns action string or None if skipped."""
    if not existing:
        return "created"

    resolution = conflict_resolutions.get(name)
    if resolution == "overwrite":
        test_data["id"] = existing["id"]
        return "overwritten"
    if resolution == "rename":
        test_data["name"] = _generate_unique_name(name)
        return "renamed"
    skipped.append({"name": name, "reason": "skipped by user"})
    return None


def _import_record(
    name: str, data: dict[str, Any], stored: Mapping[str, Any] | None
) -> dict[str, Any]:
    """The stored test an imported document becomes over ``stored`` (REQ-4.5.19, EXPORT-7)."""
    now = datetime.now(UTC).isoformat()
    here = stored or {}
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": data.get("description", ""),
        "workflow": shared.settle_imported_workflow_secrets(
            data.get("workflow", {"nodes": [], "edges": []}), here.get("workflow")
        ),
        "variables": shared.settle_imported_secret_variables(
            data.get("variables", {}), here.get("variables")
        ),
        "metadata": data.get("metadata", {}),
        "created_at": now,
        "updated_at": now,
    }


def _overwritten_test(
    existing: Mapping[str, Any] | None, resolution: str | None
) -> dict[str, Any] | None:
    """The stored test an import overwrites, read whole, or None."""
    if existing is None or resolution != "overwrite":
        return None
    return _load_test(str(existing["id"]))


def _validated_import_fixes(test_data: dict[str, Any], name: str) -> list[str]:
    """Validate an imported test and apply its auto-fixes; returns what was fixed."""
    validation = _validate_test_data(test_data, context="import")
    if validation.get("fatal"):
        raise ValidationException("Fatal validation errors prevent import")
    read_only = _read_only_errors(validation)
    if read_only:
        reasons = " ".join(str(e.get("message", "")) for e in read_only)
        raise ReadOnlyExpressionImportError(f"Cannot import test '{name}'. {reasons}", read_only)
    refused = _errors_with(validation, frozenset({_REFUSED_VALUE_CODE}))
    if refused:
        raise VariableValueImportError(str(refused[0].get("message", "")))
    errors = validation.get("errors", [])
    return _apply_import_fixes(errors, test_data) if errors else []


def persist_test_document(
    test_data: dict[str, Any],
    history: list[dict[str, Any]],
    files: list[tuple[str, bytes]],
    *,
    replace_files: bool,
) -> None:
    """Write a whole test, its history rows and its data files as given."""
    test_id = test_data["id"]
    is_new = not _get_test_dir(test_id).exists()
    try:
        _save_test(test_data)
        _save_versions(test_id, history)
        if replace_files:
            testdata_service.delete_for_test(test_id)
        if files:
            testdata_service.write_files(test_id, files)
    except Exception:
        if is_new:
            _delete_test_files(test_id)
            testdata_service.delete_for_test(test_id)
        raise


def _import_history(test_data: dict[str, Any]) -> list[dict[str, Any]]:
    """The one history row an imported test starts with."""
    return [
        {
            "version": "1.0.0",
            "created_at": test_data["created_at"],
            "created_by": "import",
            "changes": "Imported",
        }
    ]


def import_tests(
    content: bytes, filename: str, conflict_resolutions: dict[str, str] | None = None
) -> dict[str, Any]:
    """Import tests from file content.

    Args:
        content: Raw file bytes
        filename: Original filename
        conflict_resolutions: Per-test conflict resolution
            (test_name -> "rename"|"overwrite"|"skip")

    Returns:
        Import results dict

    Raises:
        ValueError: If file cannot be parsed or has fatal errors
    """
    if conflict_resolutions is None:
        conflict_resolutions = {}

    documents, files_by_id = _parse_import_entries(content, filename)
    existing_by_name = {t.get("name"): t for t in _list_all_tests()}

    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    fixes_applied: list[dict[str, Any]] = []

    for _fname, data in documents:
        name = data.get("name", "Unnamed")
        existing = existing_by_name.get(name)
        stored = _overwritten_test(existing, conflict_resolutions.get(name))
        test_data = _import_record(name, data, stored)
        applied = _validated_import_fixes(test_data, name)

        action = _resolve_import_conflict(test_data, name, existing, conflict_resolutions, skipped)
        if action is None:
            continue

        persist_test_document(
            test_data,
            _import_history(test_data),
            _archive_files_for(files_by_id, data),
            replace_files=action == "overwritten",
        )
        imported.append({"name": test_data["name"], "id": test_data["id"], "action": action})
        if applied:
            fixes_applied.append({"name": test_data["name"], "fixes": applied})

    return {
        "imported": imported,
        "skipped": skipped,
        "fixes_applied": fixes_applied,
        "total_imported": len(imported),
        "total_skipped": len(skipped),
    }
