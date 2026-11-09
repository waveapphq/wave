"""Storage, save validation and dependency primitives for Published Functions."""

from __future__ import annotations

import ast
import copy
import hashlib
import json
import re
import shutil
from collections.abc import Callable, Collection, Iterable, Iterator, Mapping, MutableMapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services import settings_file
from wavecore.api.services.block_node_checks import (
    block_type_registered,
    validate_node_element_type,
    validate_node_metadata,
    validate_read_only_expressions,
)
from wavecore.api.services.block_schema import block_schema
from wavecore.api.services.functions import _versioning
from wavecore.api.services.storage_paths import (
    entity_dir,
    get_functions_storage_path,
    get_tests_storage_path,
    is_entity_id,
    path_under,
)
from wavecore.api.services.typed_numbers import store_definition_numbers
from wavecore.core.execution.field_checks import check_block_fields
from wavecore.core.execution.row_checks import literal_row_findings
from wavecore.core.functions.declarations import (
    DECLARATION_LISTS,
    DECLARED_TYPES,
    PARAMETER_NAME_PATTERN,
    declaration_problems,
    input_problems,
    name_collisions,
    value_problems,
)
from wavecore.core.functions.references import iter_function_references, referenced_function_ids
from wavecore.core.secrets.sealing import seal_definition_secrets
from wavecore.core.variables.usage import (
    NameSite,
    block_sites,
    block_write_sites,
    computed_declarations,
    cycle_message,
    cycle_path,
    unused_inputs,
    unwritten_outputs,
)
from wavecore.models.enums import ControlId
from wavecore.models.plugins import ENGINE_DISPATCHED_ELEMENT_TYPES

# libyaml's C-accelerated loader where available; fall back to pure Python
# otherwise. Every publish and every library listing reads these files, so the
# 5-7x speedup shows up directly in the Functions surfaces.
_YAML_LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)

_INDEX_FILENAME = "index.yaml"
_VERSIONS_SUBDIR = "versions"
_TEST_FILENAME = "test.yaml"

PARAM_NAME_PATTERN = f"^{PARAMETER_NAME_PATTERN}$"

NAME_MAX_LENGTH = 32

_PARAM_NAME_RE = re.compile(PARAM_NAME_PATTERN)


def _functions_dir() -> Path:
    return get_functions_storage_path()


def _function_dir(function_id: str) -> Path:
    return entity_dir(_functions_dir(), function_id)


def _index_file(function_id: str) -> Path:
    return _function_dir(function_id) / _INDEX_FILENAME


def _versions_dir(function_id: str) -> Path:
    return _function_dir(function_id) / _VERSIONS_SUBDIR


def _version_file(function_id: str, version: str) -> Path:
    _validate_version_str(version)
    return path_under(_versions_dir(function_id), f"{version}.yaml")


def compute_etag(definition: Mapping[str, Any]) -> str:
    """Return a SHA-256 hex digest over canonical JSON of the definition."""
    canonical = json.dumps(definition, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _semver_key(version: str) -> tuple[Any, ...]:
    return _versioning.version_precedence_key(version)


def _load_yaml(path: Path) -> Any:
    # CSafeLoader shares SafeLoader's constructor and resolver, so the values match.
    with open(path, encoding="utf-8") as f:
        return yaml.load(f, Loader=_YAML_LOADER)


def _write_yaml(path: Path, payload: Any) -> None:
    settings_file.write_text_atomic(path, yaml.safe_dump(payload, sort_keys=False))


def _read_index(function_id: str) -> dict[str, Any] | None:
    if not is_entity_id(function_id):
        return None
    path = _index_file(function_id)
    if not path.exists():
        return None
    data = _load_yaml(path)
    return data if isinstance(data, dict) else None


def _write_index(function_id: str, index: dict[str, Any]) -> None:
    _write_yaml(_index_file(function_id), index)


def _read_version_payload(function_id: str, version: str) -> dict[str, Any] | None:
    if not _versioning.is_valid_version(version):
        return None
    path = _version_file(function_id, version)
    if not path.exists():
        return None
    data = _load_yaml(path)
    return data if isinstance(data, dict) else None


def _compose_definition(
    *,
    function_id: str,
    name: str,
    version: str,
    payload: Mapping[str, Any],
    available_versions: Iterable[str] = (),
    created_at: str = "",
    updated_at: str = "",
) -> dict[str, Any]:
    """Build the dict shape that ``load_function`` / ``load_version`` return.

    The returned dict carries the entry-wide identity (id, name, version
    timestamps), the per-version body (inputs, outputs, dependencies,
    workflow) plus the version-scoped metadata (description, tags, changelog,
    details, published_at) merged into a single map for callers.
    """
    raw_definition = payload.get("definition")
    definition: Mapping[str, Any] = raw_definition if isinstance(raw_definition, Mapping) else {}
    raw_metadata = payload.get("metadata")
    metadata: Mapping[str, Any] = raw_metadata if isinstance(raw_metadata, Mapping) else {}
    return {
        "id": function_id,
        "name": name,
        "version": version,
        "description": metadata.get("description", "") or "",
        "tags": list(metadata.get("tags") or []),
        **function_body(definition),
        "changelog": metadata.get("changelog", "") or "",
        "details": metadata.get("details", "") or "",
        "available_versions": list(available_versions),
        "metadata": {
            "author": metadata.get("published_by", "wave"),
            "created_at": created_at,
            "updated_at": updated_at,
            "published_at": metadata.get("published_at", ""),
            "published_by": metadata.get("published_by", "wave"),
            "changelog": metadata.get("changelog", "") or "",
            "details": metadata.get("details", "") or "",
        },
    }


def _declarations(source: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    """Copies of a list of declarations; any other shape holds none."""
    items = source.get(key)
    listed = items if isinstance(items, list) else []
    return [copy.deepcopy(dict(item)) for item in listed if isinstance(item, Mapping)]


def function_body(source: Mapping[str, Any]) -> dict[str, Any]:
    """A Function's body: inputs, outputs, local variables, dependencies and workflow, copied."""
    raw_deps = source.get("dependencies")
    deps: Mapping[str, Any] = raw_deps if isinstance(raw_deps, Mapping) else {}
    return {
        "inputs": _declarations(source, "inputs"),
        "outputs": _declarations(source, "outputs"),
        "variables": _declarations(source, "variables"),
        "dependencies": {
            "functions": list(deps.get("functions") or []),
            "plugins": list(deps.get("plugins") or []),
        },
        "workflow": copy.deepcopy(dict(source.get("workflow") or {"nodes": [], "edges": []})),
    }


def drop_secret_input_defaults(function_def: MutableMapping[str, Any]) -> None:
    """A secret input has no default: the Function Block gives the value."""
    for declared in function_def.get("inputs") or []:
        if isinstance(declared, dict) and declared.get("secret"):
            declared.pop("default", None)


def _build_version_body(definition: Mapping[str, Any]) -> dict[str, Any]:
    body = function_body(definition)
    drop_secret_input_defaults(body)
    store_definition_numbers(body)
    called = dict.fromkeys(ref.function_id for ref in iter_function_references(body["workflow"]))
    body["dependencies"]["functions"] = list(called)
    return seal_definition_secrets(body)


def _build_version_metadata(metadata: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "description": metadata.get("description", "") or "",
        "tags": list(metadata.get("tags") or []),
        "changelog": metadata.get("changelog", "") or "",
        "details": metadata.get("details", "") or "",
        "published_at": metadata.get("published_at", "") or "",
        "published_by": metadata.get("published_by", "wave"),
    }


def _upsert_version_index(function_id: str, name: str, version: str, published_at: str) -> None:
    index = _read_index(function_id) or {
        "id": function_id,
        "name": name,
        "latest_version": version,
        "available_versions": [],
        "created_at": published_at,
    }
    index["id"] = function_id
    index["name"] = name
    existing = [v for v in (index.get("available_versions") or []) if v != version]
    all_versions = [*existing, version]
    all_versions.sort(key=_semver_key, reverse=True)
    index["available_versions"] = all_versions
    index["latest_version"] = all_versions[0]
    index["updated_at"] = published_at
    if not index.get("created_at"):
        index["created_at"] = published_at
    _write_index(function_id, index)


def set_index_timestamps(function_id: str, *, created_at: str, updated_at: str) -> None:
    """Set the created and updated times of a Function's index."""
    index = _read_index(function_id)
    if index is None:
        raise LookupError(f"Function '{function_id}' not found")
    index["created_at"] = created_at
    index["updated_at"] = updated_at
    _write_index(function_id, index)


def _validate_version_str(version: str) -> None:
    if len(version) > _versioning.MAX_VERSION_LENGTH:
        msg = (
            f"Function version '{version}' exceeds the maximum length of "
            f"{_versioning.MAX_VERSION_LENGTH} characters"
        )
        raise ValidationException(message=msg, details={"errors": [{"message": msg}]})
    if not _versioning.is_valid_version(version):
        msg = f"Function version '{version}' is not a valid semver"
        raise ValidationException(message=msg, details={"errors": [{"message": msg}]})


def _persist_version(
    function_id: str,
    version: str,
    definition: Mapping[str, Any],
    metadata: Mapping[str, Any],
    *,
    name: str,
    allow_replace: bool,
) -> str:
    version_path = _version_file(function_id, version)
    version_path.parent.mkdir(parents=True, exist_ok=True)

    if not allow_replace and version_path.exists():
        msg = f"Function '{function_id}' version '{version}' already exists"
        raise ConflictException(message=msg, details={"errors": [{"message": msg}]})

    metadata_block = _build_version_metadata(metadata)
    version_payload = {
        "version": version,
        "definition": _build_version_body(definition),
        "metadata": metadata_block,
    }
    _write_yaml(version_path, version_payload)
    _upsert_version_index(function_id, name, version, metadata_block["published_at"])
    return compute_etag(version_payload)


def save_new_version(
    function_id: str,
    version: str,
    definition: Mapping[str, Any],
    metadata: Mapping[str, Any],
    *,
    name: str,
) -> str:
    """Write a new immutable version yaml and update the entry index.

    The version is validated as strict semver before any filesystem write so it
    can never escape the versions directory. A published (id, version) record is
    write-once: a duplicate raises ``ConflictException`` and the bytes never
    change. Returns the version yaml's ETag.
    """
    return _persist_version(
        function_id, version, definition, metadata, name=name, allow_replace=False
    )


def save_or_replace_version(
    function_id: str,
    version: str,
    definition: Mapping[str, Any],
    metadata: Mapping[str, Any],
    *,
    name: str,
) -> str:
    """Write or replace a version yaml and union it into the entry index.

    Unlike ``save_new_version`` an existing (id, version) is overwritten in
    place instead of rejected, so an import overwrite upserts the incoming
    versions while versions held only in the library survive.
    """
    return _persist_version(
        function_id, version, definition, metadata, name=name, allow_replace=True
    )


def load_version(function_id: str, version: str) -> dict[str, Any]:
    """Load a specific version's definition (with metadata merged in)."""
    index = _read_index(function_id)
    if index is None:
        raise LookupError(f"Function '{function_id}' not found")
    payload = _read_version_payload(function_id, version)
    if payload is None:
        raise LookupError(f"Function '{function_id}' version '{version}' not found")
    return _compose_definition(
        function_id=function_id,
        name=index.get("name", ""),
        version=version,
        payload=payload,
        available_versions=index.get("available_versions") or [],
        created_at=index.get("created_at", ""),
        updated_at=index.get("updated_at", ""),
    )


def list_versions(function_id: str) -> dict[str, Any]:
    """Return ``{versions: [...], latest: str}`` per the GET /versions contract."""
    index = _read_index(function_id)
    if index is None:
        raise LookupError(f"Function '{function_id}' not found")
    versions_list: list[dict[str, Any]] = []
    for version in index.get("available_versions") or []:
        payload = _read_version_payload(function_id, version)
        md = (payload or {}).get("metadata") or {}
        body = (payload or {}).get("definition") or {}
        versions_list.append(
            {
                "version": version,
                "published_at": md.get("published_at", "") or "",
                "published_by": md.get("published_by", "") or "",
                "changelog": md.get("changelog", "") or "",
                "details": md.get("details", "") or "",
                "description": md.get("description", "") or "",
                "tags": list(md.get("tags") or []),
                "inputs": [dict(item) for item in (body.get("inputs") or [])],
                "outputs": [dict(item) for item in (body.get("outputs") or [])],
            }
        )
    return {
        "versions": versions_list,
        "latest": index.get("latest_version", ""),
        "name": index.get("name", ""),
    }


def list_version_records(function_id: str) -> list[dict[str, Any]]:
    """Return every stored version record ``[{version, definition, metadata}, ...]``.

    Used by export to serialize the full history (separate body + metadata per
    version). Returns ``[]`` for an unknown Function; callers validate existence
    separately and surface the 404.
    """
    index = _read_index(function_id) or {}
    records: list[dict[str, Any]] = []
    for version in index.get("available_versions") or []:
        payload = _read_version_payload(function_id, version) or {}
        records.append(
            {
                "version": version,
                "definition": dict(payload.get("definition") or {}),
                "metadata": dict(payload.get("metadata") or {}),
            }
        )
    return records


def load_function(function_id: str) -> tuple[dict[str, Any], str]:
    """Read the LATEST version of a Function and return (definition, etag)."""
    index = _read_index(function_id)
    if index is None:
        raise LookupError(function_id)
    latest = index.get("latest_version", "")
    payload = _read_version_payload(function_id, latest)
    if payload is None:
        raise LookupError(function_id)
    definition = _compose_definition(
        function_id=function_id,
        name=index.get("name", ""),
        version=latest,
        payload=payload,
        available_versions=index.get("available_versions") or [],
        created_at=index.get("created_at", ""),
        updated_at=index.get("updated_at", ""),
    )
    return definition, compute_etag(definition)


def delete_function_file(function_id: str) -> None:
    """Remove the Function directory; raise LookupError if missing."""
    if not is_entity_id(function_id) or not _function_dir(function_id).exists():
        raise LookupError(function_id)
    shutil.rmtree(_function_dir(function_id))


def delete_version(function_id: str, version: str) -> None:
    """Remove a single version yaml from a Function and rewrite the index.

    Raises ``LookupError`` for an unknown function id or version. Removes the
    function directory entirely if the last version is being deleted.
    """
    index = _read_index(function_id)
    if index is None:
        raise LookupError(f"Function '{function_id}' not found")
    available = list(index.get("available_versions") or [])
    if version not in available:
        raise LookupError(f"Function '{function_id}' version '{version}' not found")
    path = _version_file(function_id, version)
    if path.exists():
        path.unlink()
    remaining = [v for v in available if v != version]
    if not remaining:
        delete_function_file(function_id)
        return
    remaining.sort(key=_semver_key, reverse=True)
    index["available_versions"] = remaining
    index["latest_version"] = remaining[0]
    _write_index(function_id, index)


def list_function_summaries() -> list[dict[str, Any]]:
    """Return a summary row per Published Function present in the new layout."""
    root = _functions_dir()
    if not root.exists():
        return []
    summaries: list[dict[str, Any]] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        index = _read_index(entry.name)
        if index is None:
            continue
        latest_version = index.get("latest_version", "")
        latest_payload = _read_version_payload(entry.name, latest_version)
        latest_metadata = (latest_payload or {}).get("metadata") or {}
        summaries.append(
            {
                "id": index.get("id", entry.name),
                "name": index.get("name", ""),
                "description": latest_metadata.get("description", "") or "",
                "tags": list(latest_metadata.get("tags") or []),
                "created_at": index.get("created_at", "") or "",
                "updated_at": index.get("updated_at", "") or "",
                "latest_version": latest_version,
            }
        )
    return summaries


def _validate_param(param: Mapping[str, Any], kind: str, errors: list[str]) -> None:
    """Validate one input or output parameter declaration."""
    name = param.get("name", "")
    has_type_key = "type" in param
    raw_type = param.get("type")
    type_value = raw_type if isinstance(raw_type, str) else ""

    if not isinstance(name, str) or not _PARAM_NAME_RE.match(name):
        errors.append(
            f"Function {kind} '{name}' has invalid name; "
            f"must match pattern '{PARAM_NAME_PATTERN}'"
        )
        return

    if not has_type_key or not type_value:
        if kind == "input":
            errors.append(f"Function input '{name}' is required and missing a type")
        else:
            errors.append(f"Function output '{name}' is missing a type")
        return

    if type_value not in DECLARED_TYPES:
        errors.append(f"Function {kind} '{name}' has invalid type '{type_value}'")


def validate_structural(definition: Mapping[str, Any]) -> list[str]:
    """Return a list of structural validation error messages.

    Empty list means the definition is structurally valid.
    """
    errors: list[str] = []
    name = definition.get("name", "")
    if not isinstance(name, str) or not name.strip():
        errors.append("Function name is required")
    elif len(name) > NAME_MAX_LENGTH:
        errors.append(f"Function name '{name}' exceeds {NAME_MAX_LENGTH} characters")

    for param in definition.get("inputs") or []:
        _validate_param(param, "input", errors)
    for param in definition.get("outputs") or []:
        _validate_param(param, "output", errors)

    return errors


def _stored_indexes() -> Iterator[tuple[str, dict[str, Any]]]:
    root = _functions_dir()
    for entry in sorted(root.iterdir()) if root.exists() else []:
        index = _read_index(entry.name) if entry.is_dir() else None
        if index is not None:
            yield entry.name, index


def load_reference_index() -> dict[str, set[str]]:
    """Per Function id, the ids that any of its stored versions references, at every depth."""
    reference_index: dict[str, set[str]] = {}
    for folder, index in _stored_indexes():
        references = reference_index.setdefault(index.get("id", folder), set())
        for version in index.get("available_versions") or []:
            body = (_read_version_payload(folder, version) or {}).get("definition") or {}
            references.update(referenced_function_ids(body.get("workflow")))
    return reference_index


def detect_circular_deps(
    function_id: str, reference_index: Mapping[str, Collection[str]]
) -> str | None:
    """The cycle that includes ``function_id`` as ids joined by `` -> ``, or ``None``."""
    paths = {function_id: [function_id]}
    pending = [function_id]
    while pending:
        current = pending.pop()
        children = reference_index.get(current, ())
        if function_id in children:
            return " -> ".join([*paths[current], function_id])
        for child in sorted(set(children) - paths.keys()):
            paths[child] = [*paths[current], child]
            pending.append(child)
    return None


def scan_dependents(
    function_id: str, version: str | None = None
) -> dict[str, list[dict[str, str]]]:
    """Walk Tests and Functions storage looking for references to function_id.

    When ``version`` is given, only references pinned to that exact version
    (``data.functionVersion``) match; a version-less reference is excluded.
    """
    tests = _scan_test_dependents(function_id, version)
    functions = _scan_function_dependents(function_id, version)
    return {"tests": tests, "functions": functions}


_VersionBucket = Callable[[str], dict[str, list[dict[str, str]]]]


def _read_test_definition(test_dir: Path) -> dict[str, Any] | None:
    """One stored test, or None when its directory no longer holds a readable one."""
    path = test_dir / _TEST_FILENAME
    if not path.exists():
        return None
    data = _load_yaml(path)
    return data if isinstance(data, dict) else None


def _bucket_test_dependents(function_id: str, bucket: _VersionBucket) -> None:
    tests_root = get_tests_storage_path()
    if tests_root.exists():
        for test_dir in sorted(tests_root.iterdir()):
            definition = _read_test_definition(test_dir)
            if definition is None:
                continue
            entry = {
                "id": definition.get("id", test_dir.name),
                "name": definition.get("name", ""),
            }
            for version in _entity_referenced_versions(definition, function_id):
                bucket(version)["tests"].append(entry)


def _other_latest_bodies(function_id: str) -> Iterator[tuple[dict[str, str], dict[str, Any]]]:
    for folder, index in _stored_indexes():
        if index.get("id") != function_id:
            payload = _read_version_payload(folder, index.get("latest_version", "")) or {}
            entry = {"id": index.get("id", folder), "name": index.get("name", "")}
            yield entry, payload.get("definition") or {}


def _bucket_function_dependents(function_id: str, bucket: _VersionBucket) -> None:
    for entry, body in _other_latest_bodies(function_id):
        for version in _entity_referenced_versions(body, function_id):
            bucket(version)["functions"].append(entry)


def scan_dependents_by_version(
    function_id: str,
) -> dict[str, dict[str, list[dict[str, str]]]]:
    """Single-pass dependents scan bucketed by the version each reference pins.

    Returns ``{version: {"tests": [...], "functions": [...]}}`` from one walk of
    the Tests + Functions store, instead of one walk per version.
    """
    by_version: dict[str, dict[str, list[dict[str, str]]]] = {}

    def _bucket(version: str) -> dict[str, list[dict[str, str]]]:
        return by_version.setdefault(version, {"tests": [], "functions": []})

    _bucket_test_dependents(function_id, _bucket)
    _bucket_function_dependents(function_id, _bucket)
    return by_version


def _entity_referenced_versions(definition: Mapping[str, Any], function_id: str) -> set[str]:
    """Distinct versions that ``definition``'s function nodes pin for function_id."""
    return {
        reference.version
        for reference in iter_function_references(definition.get("workflow"))
        if reference.function_id == function_id
        and isinstance(reference.version, str)
        and reference.version
    }


def _scan_test_dependents(function_id: str, version: str | None = None) -> list[dict[str, str]]:
    tests_root = get_tests_storage_path()
    if not tests_root.exists():
        return []
    tests: list[dict[str, str]] = []
    for test_dir in sorted(tests_root.iterdir()):
        definition = _read_test_definition(test_dir)
        if definition is None:
            continue
        if _entity_references_function_node(definition, function_id, version):
            tests.append(
                {
                    "id": definition.get("id", test_dir.name),
                    "name": definition.get("name", ""),
                }
            )
    return tests


def _scan_function_dependents(function_id: str, version: str | None = None) -> list[dict[str, str]]:
    return [
        entry
        for entry, body in _other_latest_bodies(function_id)
        if _entity_references_function_node(body, function_id, version)
    ]


def _entity_references_function_node(
    definition: Mapping[str, Any], function_id: str, version: str | None = None
) -> bool:
    return any(
        reference.function_id == function_id and version in (None, reference.version)
        for reference in iter_function_references(definition.get("workflow"))
    )


# ---------------------------------------------------------------------------
# Save-validation dimensions - dimension validators + aggregator.
# ---------------------------------------------------------------------------


@dataclass
class ValidationIssue:
    """One validation finding from a dimension validator.

    ``node_id`` / ``node_label`` carry the internal node the issue is tied to
    (when one exists) so the surface layer can prefix the message with the
    user-visible name. The text in ``message`` is parameter-shaped and does
    NOT embed the node identity, matching the canonical save-pipeline error
    format (the outside `_validate_test_data` path).
    """

    code: str
    message: str
    severity: str = "error"
    node_id: str | None = None
    node_label: str | None = None
    function_id: str | None = None
    function_version: str | None = None


_EXTERNAL_SCOPES = ("regression", "suite", "system")
_TRY_CATCH_ELEMENT_TYPES = ("try_catch", "try-catch", "try-catch-finally")


def _iter_workflow_nodes(definition: Mapping[str, Any]) -> list[dict[str, Any]]:
    workflow = definition.get("workflow") or {}
    nodes = workflow.get("nodes") or []
    return [n for n in nodes if isinstance(n, dict)]


def _iter_workflow_edges(definition: Mapping[str, Any]) -> list[dict[str, Any]]:
    workflow = definition.get("workflow") or {}
    edges = workflow.get("edges") or []
    return [e for e in edges if isinstance(e, dict)]


def _node_data(node: Mapping[str, Any]) -> dict[str, Any]:
    data = node.get("data")
    return data if isinstance(data, dict) else {}


def _node_config(node: Mapping[str, Any]) -> dict[str, Any]:
    config = _node_data(node).get("config")
    return config if isinstance(config, dict) else {}


def _node_values(node: Mapping[str, Any]) -> dict[str, Any]:
    values = _node_config(node).get("values")
    return values if isinstance(values, dict) else {}


def _attribute_chains(expression: str) -> list[tuple[str, str]]:
    """Return ``(root, attr)`` pairs for every ``Name.Attr`` access in ``expression``."""
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return []
    chains: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            chains.append((node.value.id, node.attr))
    return chains


def _validate_name(name: Any) -> list[ValidationIssue]:
    if not isinstance(name, str):
        return []
    if not name.strip():
        return [ValidationIssue(code="FUNCTION_NAME_REQUIRED", message="Function name is required")]
    if len(name) > NAME_MAX_LENGTH:
        return [
            ValidationIssue(
                code="FUNCTION_NAME_TOO_LONG",
                message=f"Function name '{name}' exceeds {NAME_MAX_LENGTH} characters",
            )
        ]
    return []


def _validate_param_list(
    params: Iterable[Any],
    *,
    duplicate_code: str,
    duplicate_msg: str,
    type_missing_code: str,
    type_missing_msg: str,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    seen: set[str] = set()
    for param in params:
        if not isinstance(param, Mapping):
            continue
        pname = param.get("name", "")
        if not isinstance(pname, str):
            continue
        if pname in seen:
            issues.append(
                ValidationIssue(code=duplicate_code, message=duplicate_msg.format(pname=pname))
            )
        else:
            seen.add(pname)
        if "type" not in param or not param.get("type"):
            issues.append(
                ValidationIssue(
                    code=type_missing_code, message=type_missing_msg.format(pname=pname)
                )
            )
    return issues


def _validate_structural(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Dimension 1: structural rules."""
    name = definition.get("name", "")
    issues: list[ValidationIssue] = []
    issues.extend(_validate_name(name))
    issues.extend(
        _validate_param_list(
            definition.get("inputs") or [],
            duplicate_code="DUPLICATE_INPUT_NAME",
            duplicate_msg="Function declares input '{pname}' more than once",
            type_missing_code="INPUT_TYPE_MISSING",
            type_missing_msg="Function input '{pname}' has no declared type",
        )
    )
    issues.extend(
        _validate_param_list(
            definition.get("outputs") or [],
            duplicate_code="DUPLICATE_OUTPUT_NAME",
            duplicate_msg="Function declares output '{pname}' more than once",
            type_missing_code="OUTPUT_TYPE_MISSING",
            type_missing_msg="Function output '{pname}' has no declared type",
        )
    )

    workflow = definition.get("workflow") or {}
    nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
    if not nodes:
        issues.append(
            ValidationIssue(
                code="EMPTY_FUNCTION_BODY",
                message=f"Function '{name}' has no blocks",
                severity="warning",
            )
        )
    issues.extend(declaration_issues(definition))
    return issues


def _names_of(items: Iterable[Mapping[str, Any]]) -> list[str]:
    return [name for item in items if isinstance(name := item.get("name"), str)]


def _declared_items(definition: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    listed = definition.get(key)
    return [item for item in listed or [] if isinstance(item, Mapping)]


def _named_declaration_problems(definition: Mapping[str, Any]) -> list[tuple[str, str]]:
    """The declaration and value rules a Test variable follows, for each input, output and
    local."""
    return [
        problem
        for key, kind in DECLARATION_LISTS
        for item in _declared_items(definition, key)
        if isinstance(name := item.get("name"), str) and name
        for problem in [
            *declaration_problems(name, item.get("type"), item.get("elementTypes"), kind=kind),
            *value_problems(item, name, kind=kind),
        ]
    ]


def declaration_issues(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """The declaration, enum, Required boolean and one-name rules every Function save applies."""
    inputs = _declared_items(definition, "inputs")
    pairs = _named_declaration_problems(definition)
    pairs.extend(pair for item in inputs for pair in input_problems(item))
    pairs.extend(
        name_collisions(
            inputs,
            _declared_items(definition, "outputs"),
            _names_of(_declared_items(definition, "variables")),
        )
    )
    return [ValidationIssue(code=code, message=message) for code, message in pairs]


def _validate_references(
    definition: Mapping[str, Any],
    *,
    plugin_registry: Any = None,
    function_registry: Mapping[str, Any] | None = None,
) -> list[ValidationIssue]:
    """Dimension 2: every plugin / Function reference resolves.

    ``plugin_registry`` is reserved for future overrides; ``None`` falls back
    to the global registry (matches the production wiring). The
    ``function_registry`` is supplied by the caller and contains known
    Published Functions keyed by id.
    """
    del plugin_registry
    registry = function_registry or {}
    issues: list[ValidationIssue] = []

    for node in _iter_workflow_nodes(definition):
        issues.extend(_reference_issues_for_node(node, registry))

    return issues


def _plugin_reference_issues(
    element_type: str, version: str, node_id: str, display: str
) -> list[ValidationIssue]:
    if element_type in ENGINE_DISPATCHED_ELEMENT_TYPES:
        return []
    if block_type_registered(element_type, version or "1.0.0", control=False):
        return []
    return [
        ValidationIssue(
            code="UNKNOWN_PLUGIN",
            message=f"References unknown plugin '{element_type}'",
            node_id=node_id,
            node_label=display,
        )
    ]


def _shared_function_reference_issues(
    data: Mapping[str, Any], registry: Mapping[str, Any], node_id: str, display: str
) -> list[ValidationIssue]:
    function_id = data.get("functionId", "")
    if not function_id:
        return []
    function_version = data.get("functionVersion", "")
    entry = registry.get(function_id)
    if entry is None:
        return [
            ValidationIssue(
                code="MISSING_FUNCTION_ID",
                message=f"References unknown Function '{function_id}'",
                node_id=node_id,
                node_label=display,
                function_id=function_id,
                function_version=function_version,
            )
        ]
    available = entry.get("available_versions") or []
    if function_version and isinstance(available, list) and function_version not in available:
        return [
            ValidationIssue(
                code="MISSING_FUNCTION_VERSION",
                message=f"Pinned version {function_version} is no longer available in the library",
                node_id=node_id,
                node_label=display,
                function_id=function_id,
                function_version=function_version,
            )
        ]
    return []


def _reference_issues_for_node(
    node: Mapping[str, Any],
    registry: Mapping[str, Any],
) -> list[ValidationIssue]:
    display = _node_display_name(node)
    node_id = str(node.get("id", "") or "")
    data = _node_data(node)
    node_type = data.get("nodeType")
    if node_type == "plugin":
        return _plugin_reference_issues(
            data.get("elementType", ""), data.get("version", "1.0.0"), node_id, display
        )
    if node_type == "function" and data.get("functionLifecycle", "local") == "shared":
        return _shared_function_reference_issues(data, registry, node_id, display)
    return []


def _node_display_name(node: Mapping[str, Any]) -> str:
    """Return the user-facing label for a node, falling back to its id.

    Validators surface this in error messages so users see ``Log_1`` instead
    of ``node-1779383867313-vzh88ic`` (canvas-generated ids are invisible to
    the user).
    """
    data = _node_data(node)
    label = data.get("label")
    if isinstance(label, str) and label.strip():
        return label
    node_id = node.get("id", "")
    return str(node_id) if node_id is not None else ""


def _shared_function_source(data: Mapping[str, Any], registry: Mapping[str, Any]) -> Any:
    """A Shared Function Block's definition: the registry's entry, else its pinned version."""
    function_id = str(data.get("functionId") or "")
    source = registry.get(function_id)
    if isinstance(source, Mapping) and source.get("name"):
        return source
    try:
        return load_version(function_id, str(data.get("functionVersion") or ""))
    except LookupError:
        return None


def function_block_name(data: Mapping[str, Any], registry: Mapping[str, Any]) -> str:
    """The name of the Function a Function Block runs: the block its field findings name."""
    if data.get("functionLifecycle", "local") == "local":
        source: Any = data.get("localDefinition")
    elif data.get("editMode") and isinstance(data.get("draft"), Mapping):
        source = data.get("draft")
    else:
        source = _shared_function_source(data, registry)
    name = source.get("name") if isinstance(source, Mapping) else None
    return name if isinstance(name, str) and name else str(data.get("label") or "")


def _checked_fields(data: Mapping[str, Any], registry: Mapping[str, Any]) -> tuple[Any, str] | None:
    """The declared fields of one Block and the block id its findings name, or None."""
    element_type = str(data.get("elementType") or "")
    version = str(data.get("version") or "1.0.0")
    node_type = data.get("nodeType")
    if node_type == "function":
        if data.get("functionLifecycle", "local") == "local":
            if not isinstance(data.get("localDefinition"), Mapping):
                return None
        elif _shared_function_reference_issues(data, registry, "", ""):
            return None
        return block_schema(data, registry=registry).fields, function_block_name(data, registry)
    if node_type not in ("plugin", "control"):
        return None
    if not block_type_registered(element_type, version, control=node_type == "control"):
        return None
    return block_schema(data).fields, element_type


def _validate_binding_completeness(
    definition: Mapping[str, Any],
    *,
    function_registry: Mapping[str, Any] | None = None,
    required_function_inputs: bool = True,
) -> list[ValidationIssue]:
    """Dimension 3: every unmuted Block's stored values pass the one field check (REQ-3.1.1.5).

    ``required_function_inputs`` off leaves a Function Block's Required inputs to the run.
    """
    registry = function_registry or {}
    issues: list[ValidationIssue] = []
    for node in _iter_workflow_nodes(definition):
        data = _node_data(node)
        if data.get("disabled"):
            continue
        checked = _checked_fields(data, registry)
        if checked is None:
            continue
        fields, block_id = checked
        node_id = str(node.get("id", "") or "")
        display = _node_display_name(node)
        issues.extend(
            ValidationIssue(
                code=finding.code,
                message=finding.message,
                node_id=node_id,
                node_label=display,
            )
            for finding in check_block_fields(
                fields,
                _node_values(node),
                block_id=block_id,
                expression_fields=set(data.get("expressionFields") or []),
                template_fields=set(data.get("templateFields") or []),
                check_required=required_function_inputs or data.get("nodeType") != "function",
                element_types=data.get("elementTypes"),
            )
        )
    return issues


def _validate_literal_rows(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Every unmuted Block's literal setter rows, compare-to values and column indexes follow
    the one number rule (REQ-3.1.3.14)."""
    issues: list[ValidationIssue] = []
    for node in _iter_workflow_nodes(definition):
        data = _node_data(node)
        if data.get("disabled"):
            continue
        node_id = str(node.get("id", "") or "")
        display = _node_display_name(node)
        issues.extend(
            ValidationIssue(
                code=finding.code, message=finding.message, node_id=node_id, node_label=display
            )
            for finding in literal_row_findings(data)
        )
    return issues


def _validate_block_metadata(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Dimension 4: unknown control types, Block metadata and expressions that change data."""
    control_ids = {control_id.value for control_id in ControlId}
    nodes = _iter_workflow_nodes(definition)
    displays = {str(node.get("id", "") or ""): _node_display_name(node) for node in nodes}
    errors: list[dict[str, Any]] = []
    for index, node in enumerate(nodes):
        data = _node_data(node)
        node_id = str(node.get("id", "") or "")
        node_path = f"nodes[{index}]"
        element_type = data.get("elementType")
        if data.get("nodeType") == "control" and not validate_node_element_type(
            node_path, node_id, data.get("label"), element_type, control_ids, errors
        ):
            continue
        if isinstance(element_type, str) and element_type:
            validate_node_metadata(
                data, node_path, node_id, data.get("label"), element_type, control_ids, errors
            )
    validate_read_only_expressions(nodes, {}, errors)
    return [
        ValidationIssue(
            code=error["code"],
            message=error["message"],
            node_id=error["node_id"],
            node_label=displays.get(str(error["node_id"] or "")),
        )
        for error in errors
    ]


def _validate_input_reader(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Dimension 5a: each declared input has an unmuted reader (warning)."""
    return [
        ValidationIssue(
            code="INPUT_HAS_NO_READER",
            message=f"Declared input '{name}' is not used by any block",
            severity="warning",
        )
        for name in unused_inputs(definition)
    ]


def _validate_output_producer(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Dimension 5b: each declared output has an unmuted writer or a kind (warning)."""
    return [
        ValidationIssue(
            code="OUTPUT_HAS_NO_PRODUCER",
            message=f"Declared output '{name}' is not written by any block",
            severity="warning",
        )
        for name in unwritten_outputs(definition)
    ]


def _input_write_issues(
    node: Mapping[str, Any],
    declared_inputs: set[Any],
) -> list[ValidationIssue]:
    display = _node_display_name(node)
    node_id = str(node.get("id", "") or "")
    issues: list[ValidationIssue] = []
    for target_var in (site.text for site in block_write_sites(node)):
        if target_var in declared_inputs:
            issues.append(
                ValidationIssue(
                    code="INPUT_WRITE_FORBIDDEN",
                    message=(f"Writes to declared input '{target_var}'; " "inputs are read-only"),
                    node_id=node_id,
                    node_label=display,
                )
            )
    return issues


def _external_scope_read_issues(node: Mapping[str, Any]) -> list[ValidationIssue]:
    display = _node_display_name(node)
    node_id = str(node.get("id", "") or "")
    issues: list[ValidationIssue] = []
    for value in _node_values(node).values():
        if not isinstance(value, str):
            continue
        for root, attr in _attribute_chains(value):
            if root in _EXTERNAL_SCOPES:
                issues.append(
                    ValidationIssue(
                        code="EXTERNAL_SCOPE_READ_FORBIDDEN",
                        message=(
                            f"Reads variable '{attr}' from external scope "
                            f"'{root}'; only the Function's own scope is visible"
                        ),
                        node_id=node_id,
                        node_label=display,
                    )
                )
    return issues


def _validate_scope_discipline(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Dimension 6: no writes to declared inputs; no reads from external scopes."""
    declared_inputs = {
        inp.get("name")
        for inp in definition.get("inputs") or []
        if isinstance(inp, Mapping) and isinstance(inp.get("name"), str)
    }
    issues: list[ValidationIssue] = []
    for node in _iter_workflow_nodes(definition):
        issues.extend(_input_write_issues(node, declared_inputs))
        issues.extend(_external_scope_read_issues(node))
    return issues


def _is_try_catch_node(node: Mapping[str, Any]) -> bool:
    data = _node_data(node)
    if data.get("nodeType") != "control":
        return False
    element_type = data.get("elementType")
    return element_type in _TRY_CATCH_ELEMENT_TYPES


def _try_catch_enables_catch(node: Mapping[str, Any]) -> bool:
    """Read ``enable_catch`` from either ``config`` or ``config.values``."""
    config = _node_config(node)
    if "enable_catch" in config:
        return bool(config.get("enable_catch"))
    values = _node_values(node)
    return bool(values.get("enable_catch", True))


def _build_flow_adjacency(
    edges: Iterable[Mapping[str, Any]],
) -> dict[str, list[tuple[str, str | None]]]:
    adj: dict[str, list[tuple[str, str | None]]] = {}
    for edge in edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        handle = edge.get("sourceHandle")
        adj.setdefault(src, []).append((tgt, handle))
    return adj


def _reachable_from_start(
    adj: dict[str, list[tuple[str, str | None]]],
) -> set[str]:
    visited: set[str] = set()
    queue: list[str] = [tgt for tgt, _ in adj.get("start-node", [])]
    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        for child, _ in adj.get(current, []):
            if child not in visited:
                queue.append(child)
    return visited


def _try_without_catch_issue(
    node: Mapping[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
) -> ValidationIssue | None:
    if not _is_try_catch_node(node) or not _try_catch_enables_catch(node):
        return None
    node_id = str(node.get("id", "") or "")
    outgoing_handles = {handle for _tgt, handle in adj.get(node_id, [])}
    if "catch" in outgoing_handles:
        return None
    return ValidationIssue(
        code="TRY_WITHOUT_CATCH",
        message="Try construct has no matching catch branch",
        node_id=node_id,
        node_label=_node_display_name(node),
    )


def _validate_flow_consistency(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Dimension 7: unreachable nodes and structurally-broken control constructs."""
    nodes = _iter_workflow_nodes(definition)
    edges = _iter_workflow_edges(definition)
    node_ids = {n.get("id") for n in nodes}
    adj = _build_flow_adjacency(edges)
    visited = _reachable_from_start(adj)

    issues: list[ValidationIssue] = []
    for node in nodes:
        node_id = str(node.get("id", "") or "")
        if node_id and node_id in node_ids and node_id not in visited:
            issues.append(
                ValidationIssue(
                    code="NODE_UNREACHABLE",
                    message="Block is not reachable from the Function's entry",
                    node_id=node_id,
                    node_label=_node_display_name(node),
                )
            )
    for node in nodes:
        issue = _try_without_catch_issue(node, adj)
        if issue is not None:
            issues.append(issue)

    return issues


def _declared_param_names(params: Any) -> set[str]:
    """Collect the valid string names from an input/output declaration list."""
    names: set[str] = set()
    for param in params or []:
        if not isinstance(param, Mapping):
            continue
        name = param.get("name")
        if isinstance(name, str) and name:
            names.add(name)
    return names


def _profile_alias_names(definition: Mapping[str, Any]) -> set[str]:
    """Collect every profile-binding alias declared on the body's nodes."""
    names: set[str] = set()
    for node in _iter_workflow_nodes(definition):
        for binding in _node_config(node).get("profileBindings") or []:
            alias = binding.get("alias") if isinstance(binding, Mapping) else None
            if isinstance(alias, str) and alias:
                names.add(alias)
    return names


def _function_scope_names(definition: Mapping[str, Any]) -> set[str]:
    """Every name a Function body may legally reference: its declared inputs,
    outputs, local variables, and any profile aliases bound on its body nodes.

    The canvas persists `variables` as an array of `{name, type, value}` (same
    shape as inputs/outputs), so it is collected the same way."""
    names = _declared_param_names(definition.get("inputs"))
    names |= _declared_param_names(definition.get("outputs"))
    names |= _declared_param_names(definition.get("variables"))
    names |= _profile_alias_names(definition)
    return names


def _is_checked_site(site: NameSite, flagged: set[str]) -> bool:
    """A write target, or a setting or entry the Block marks expression or template."""
    return site.writes or (site.path[:2] == ("config", "values") and site.setting in flagged)


def _unresolved_reference_issues_for_node(
    node: Mapping[str, Any], scope: set[str]
) -> list[ValidationIssue]:
    """Flag every name a Block reads or writes that escapes ``scope``."""
    data = _node_data(node)
    flagged = {
        str(name) for key in ("expressionFields", "templateFields") for name in data.get(key) or []
    }
    node_id = str(node.get("id", "") or "")
    display = _node_display_name(node)
    return [
        _unresolved_reference(ref, node_id=node_id, node_label=display)
        for site in block_sites(node)
        if _is_checked_site(site, flagged)
        for ref in sorted(site.names - scope)
    ]


def _unresolved_reference(ref: str, **where: str) -> ValidationIssue:
    return ValidationIssue(
        code="UNRESOLVED_VARIABLE_REFERENCE",
        message=(
            f"Variable '{ref}' is not defined in this Function's "
            "scope (inputs, outputs, and local variables)"
        ),
        **where,
    )


def _validate_body_reference_scope(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Dimension 8: a Function body only sees its own scope.

    Every expression-field reference must resolve to a declared input, output,
    local variable, profile alias, or a Python builtin. An unresolved bare name
    is flagged with scope-aware wording so a no-code author knows the name must
    be declared inside the Function - it is not inherited from the Test.
    """
    scope = _function_scope_names(definition)
    issues: list[ValidationIssue] = []
    for node in _iter_workflow_nodes(definition):
        issues.extend(_unresolved_reference_issues_for_node(node, scope))
    return issues


def _validate_computed_declarations(definition: Mapping[str, Any]) -> list[ValidationIssue]:
    """Dimension 9: an Expression / Template output or local reads only the Function's own
    names and never itself (REQ-3.1.2.4)."""
    scope = _function_scope_names(definition)
    issues = [
        _unresolved_reference(ref)
        for reads in computed_declarations(definition).values()
        for ref in sorted(reads - scope)
    ]
    loop = cycle_path(computed_declarations(definition))
    if loop is not None:
        issues.append(ValidationIssue(code="EXPRESSION_CYCLE", message=cycle_message(loop)))
    return issues


def validate_function_for_save(
    definition: Mapping[str, Any],
    *,
    function_registry: Mapping[str, Any] | None = None,
    required_function_inputs: bool = True,
) -> list[ValidationIssue]:
    """Aggregate every save-validation dimension.

    No dimension writes to disk (a nested Shared Function Block's pinned version
    may be read), so this is safe to call from both the Function save endpoints
    and the Test save pipeline when a Function instance lives inside the Test's
    workflow.
    """
    registry = function_registry or {}
    aggregate: list[ValidationIssue] = []
    aggregate.extend(_validate_structural(definition))
    aggregate.extend(_validate_references(definition, function_registry=registry))
    aggregate.extend(
        _validate_binding_completeness(
            definition,
            function_registry=registry,
            required_function_inputs=required_function_inputs,
        )
    )
    aggregate.extend(_validate_literal_rows(definition))
    aggregate.extend(_validate_block_metadata(definition))
    aggregate.extend(_validate_input_reader(definition))
    aggregate.extend(_validate_output_producer(definition))
    aggregate.extend(_validate_scope_discipline(definition))
    aggregate.extend(_validate_flow_consistency(definition))
    aggregate.extend(_validate_body_reference_scope(definition))
    aggregate.extend(_validate_computed_declarations(definition))
    return aggregate
