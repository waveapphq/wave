"""Function service layer.

Wraps `_storage.py` with the business rules required by the API surface:
- structural + circular-dep validation enforced on every write
- ETag-aware update flow with explicit If-Match handling
- dependents enumeration and cascade-aware deletion
- batch CRUD with per-item error reporting
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    UnprocessableEntityException,
    ValidationException,
    WaveException,
)
from wavecore.api.services.block_schema import block_schema
from wavecore.api.services.functions import _storage, _versioning
from wavecore.api.services.functions.import_export import circle_path, circle_text
from wavecore.core.functions.references import referenced_function_ids
from wavecore.core.secrets.sealing import (
    mask_definition_function_secrets,
    read_definition_secrets,
    restore_masked_definition_secrets,
)


def _clear_in_memory_cache() -> None:
    """Hook used by the test conftest. No in-memory cache to reset."""


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


_MISSING_REFERENCE_CODES = ("MISSING_FUNCTION_ID", "MISSING_FUNCTION_VERSION")


def _normalize_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Coerce optional fields to their defaults so downstream code is uniform."""
    body = _storage.function_body(payload)
    _storage.drop_secret_input_defaults(body)
    return {
        "name": payload.get("name", ""),
        "description": payload.get("description", "") or "",
        "tags": list(payload.get("tags") or []),
        **body,
        "version": payload.get("version", "1.0.0") or "1.0.0",
    }


def _build_definition(
    function_id: str,
    payload: Mapping[str, Any],
    *,
    created_at: str,
    updated_at: str,
    author: str = "wave",
) -> dict[str, Any]:
    normalized = _normalize_payload(payload)
    return {
        "id": function_id,
        "name": normalized["name"],
        "description": normalized["description"],
        "tags": normalized["tags"],
        "inputs": normalized["inputs"],
        "outputs": normalized["outputs"],
        "variables": normalized["variables"],
        "dependencies": normalized["dependencies"],
        "workflow": normalized["workflow"],
        "version": normalized["version"],
        "metadata": {
            "author": author,
            "created_at": created_at,
            "updated_at": updated_at,
        },
    }


def _library_index(summaries: Iterable[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    library: dict[str, dict[str, Any]] = {}
    for summary in summaries:
        definition, _ = _storage.load_function(summary["id"])
        try:
            version_list = _storage.list_versions(summary["id"])
            definition["available_versions"] = [v["version"] for v in version_list["versions"]]
        except LookupError:
            definition["available_versions"] = []
        library[summary["id"]] = definition
    return library


def load_library_index() -> dict[str, dict[str, Any]]:
    """Read every Published Function from disk and index it by id.

    Each entry carries ``available_versions`` so the save-validation pipeline
    can distinguish ``MISSING_FUNCTION_ID`` from ``MISSING_FUNCTION_VERSION``
    without re-reading the index. Shared by Function-save validation and the
    embedded Local-Function-body validator in the Test save pipeline (so
    nested Shared references resolve against the library).
    """
    return _library_index(_storage.list_function_summaries())


def library_summaries() -> list[dict[str, Any]]:
    """Every Published Function summary, from one scan."""
    return _storage.list_function_summaries()


def load_reference_index() -> dict[str, set[str]]:
    """Per Function id, the ids any of its stored versions references."""
    return _storage.load_reference_index()


def resolve_version_contract(function_id: str, version: str) -> dict[str, Any] | None:
    """Resolve a Published Function's pinned-version input/output contract.

    Returns ``{"inputs": [...], "outputs": [...]}`` read from the specific
    pinned version (never the latest), or ``None`` when the id or version is
    unknown. Feeds the canonical pipeline's binding/type checks for top-level
    Shared instances (REQ-3.1.2.4).
    """
    try:
        definition = _storage.load_version(function_id, version)
    except LookupError:
        return None
    return {
        "inputs": [dict(item) for item in (definition.get("inputs") or [])],
        "outputs": [dict(item) for item in (definition.get("outputs") or [])],
    }


def _name_already_taken(name: str, summaries: Iterable[Mapping[str, Any]]) -> bool:
    """Case-insensitive, short-circuiting on the first match."""
    target = (name or "").casefold()
    return any(summary["name"].casefold() == target for summary in summaries)


def _classify_structural_errors(errors: Sequence[str]) -> tuple[list[str], list[str]]:
    """Split structural errors into 400-class (name) and 422-class (param)."""
    name_errors: list[str] = []
    param_errors: list[str] = []
    for err in errors:
        if err == "Function name is required" or err.startswith("Function name '"):
            name_errors.append(err)
        else:
            param_errors.append(err)
    return name_errors, param_errors


def _details_payload(errors: Sequence[str]) -> dict[str, list[dict[str, str]]]:
    return {"errors": [{"message": err} for err in errors]}


def _raise_structural(errors: Sequence[str]) -> None:
    """Raise the appropriate exception class for a set of validation errors."""
    name_errors, param_errors = _classify_structural_errors(errors)
    if name_errors and param_errors:
        raise ValidationException(
            message=name_errors[0],
            details=_details_payload([*name_errors, *param_errors]),
        )
    if name_errors:
        raise ValidationException(
            message=name_errors[0],
            details=_details_payload(name_errors),
        )
    if param_errors:
        raise UnprocessableEntityException(
            message=param_errors[0],
            details=_details_payload(param_errors),
        )


class SaveValidationError(Exception):
    """Raised when validation rejects a Function save.

    ``errors`` carries the per-dimension issue list verbatim (each entry has
    ``code``, ``message``, and ``severity`` keys). Routes convert this to a
    HTTP 422 envelope. Warning-severity issues are filtered out by callers
    before raising so warnings persist on save.
    """

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        self.errors = errors
        super().__init__(f"Function validation failed with {len(errors)} error(s)")


def _validate_for_save(
    function_id: str,
    definition: Mapping[str, Any],
) -> None:
    structural_errors = _storage.validate_structural(definition)
    _raise_structural(structural_errors)

    # The name check answers from summaries alone; definitions load only past it.
    summaries = _storage.list_function_summaries()

    name = definition.get("name", "")
    if _name_already_taken(name, summaries):
        message = f"Function name '{name}' is already in use"
        raise ValidationException(
            message=message,
            details=_details_payload([message]),
        )

    refuse_invalid_body(function_id, definition, _library_index(summaries))


def refuse_invalid_body(
    function_id: str,
    definition: Mapping[str, Any],
    library: Mapping[str, Any] | None = None,
    *,
    required_function_inputs: bool = True,
) -> None:
    """The create checks past the name: a circle of Functions, then every save error."""
    _refuse_circle(function_id, definition)
    registry = load_library_index() if library is None else library
    _refuse_errors(
        _storage.validate_function_for_save(
            definition,
            function_registry=registry,
            required_function_inputs=required_function_inputs,
        )
    )


def _refuse_circle(function_id: str, definition: Mapping[str, Any]) -> None:
    reference_index = _storage.load_reference_index()
    called = referenced_function_ids(definition.get("workflow"))
    reference_index.setdefault(function_id, set()).update(called)
    cycle = _storage.detect_circular_deps(function_id, reference_index)
    if cycle is not None:
        names = {row["id"]: row["name"] for row in _storage.list_function_summaries()}
        if definition.get("name"):
            names[function_id] = str(definition["name"])
        message = circle_text(circle_path(cycle, names))
        raise UnprocessableEntityException(
            message=message,
            details=_details_payload([message]),
        )


def _refuse_errors(issues: Iterable[_storage.ValidationIssue]) -> None:
    error_payload = [
        {
            "code": issue.code,
            "message": issue.message,
            "severity": issue.severity,
            "node_id": issue.node_id,
            "node_label": issue.node_label,
            "function_id": issue.function_id,
            "function_version": issue.function_version,
        }
        for issue in issues
        if issue.severity == "error"
    ]
    if error_payload:
        raise SaveValidationError(error_payload)


def list_all_tags() -> list[str]:
    """Return every unique tag across all Published Functions, sorted A-Z."""
    seen: set[str] = set()
    for summary in _storage.list_function_summaries():
        for tag in summary.get("tags") or []:
            if isinstance(tag, str) and tag:
                seen.add(tag)
    return sorted(seen)


_FUNCTION_SORT_KEYS: dict[str, Any] = {
    "name": lambda row: (row.get("name") or "").lower(),
    "version": lambda row: _versioning.parse_version(row.get("latest_version", "")) or (-1, -1, -1),
    "updated": lambda row: row.get("updated_at") or "",
    "tags": lambda row: ",".join(sorted(row.get("tags") or [])).lower(),
}


def list_functions(
    *,
    page: int = 1,
    per_page: int = 50,
    search: str = "",
    tags: Sequence[str] = (),
    sort_by: str | None = None,
    sort_order: str | None = "asc",
) -> dict[str, Any]:
    """Return paginated FunctionSummary entries plus pagination metadata."""
    rows = _storage.list_function_summaries()
    if search:
        rows = [row for row in rows if search.lower() in row["name"].lower()]
    if tags:
        wanted = {tag for tag in tags if tag}
        if wanted:
            rows = [row for row in rows if wanted.issubset(set(row.get("tags") or []))]

    # Sort the full result set BEFORE paginating, never the current page only.
    if sort_by:
        key_func = _FUNCTION_SORT_KEYS.get(sort_by, lambda row: "")
        rows = sorted(rows, key=key_func, reverse=sort_order == "desc")

    total = len(rows)
    total_pages = (total + per_page - 1) // per_page
    start = (page - 1) * per_page
    end = start + per_page
    return {
        "data": rows[start:end],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
        },
    }


def get_function(function_id: str) -> tuple[dict[str, Any], str]:
    """The latest definition as a read shows it, with the ETag of the stored one."""
    try:
        definition, etag = _storage.load_function(function_id)
    except LookupError as exc:
        raise NotFoundException(message=f"Function '{function_id}' not found") from exc
    return read_definition_secrets(definition), etag


def read_version(function_id: str, version: str) -> tuple[dict[str, Any], str]:
    """One version as a read shows it (SECUI-11, REQ-3.1.3.17), with its ETag."""
    definition = _storage.load_version(function_id, version)
    return read_definition_secrets(definition), _storage.compute_etag(definition)


def secret_input_names(node_data: Mapping[str, Any]) -> set[str]:
    """The secret inputs of the Function version a Function Block is pinned to (REQ-3.1.2.9)."""
    return {str(field["name"]) for field in block_schema(node_data).fields if field.get("secret")}


def draft_over_source(
    draft_definition: Mapping[str, Any], source_definition: Mapping[str, Any]
) -> dict[str, Any]:
    """A draft whose masked secrets keep the values the source version holds at their place."""
    restored: dict[str, Any] = restore_masked_definition_secrets(
        dict(draft_definition), source_definition
    )
    return restored


def create_function(payload: Mapping[str, Any]) -> tuple[dict[str, Any], str]:
    function_id = str(uuid.uuid4())
    now = _now_iso()
    definition = _build_definition(function_id, payload, created_at=now, updated_at=now)
    _validate_for_save(function_id, definition)
    version_str = definition.get("version", "1.0.0") or "1.0.0"
    metadata = {
        "description": definition.get("description", ""),
        "tags": list(definition.get("tags") or []),
        "changelog": payload.get("changelog", "") or "",
        "details": payload.get("details", "") or "",
        "published_at": now,
        "published_by": "wave",
    }
    _storage.save_new_version(
        function_id,
        version_str,
        definition,
        metadata,
        name=definition.get("name", ""),
    )
    # Return the GET-canonical shape so create-then-GET yields the same body + ETag.
    try:
        stored, etag = _storage.load_function(function_id)
    except LookupError:
        # Defensive: entry vanished post-write (race) - still return the created shape.
        stored, etag = definition, _storage.compute_etag(definition)
    return mask_definition_function_secrets(stored), etag


def add_function_version(
    function_id: str,
    *,
    source_version: str,
    target_version: str,
    draft_definition: Mapping[str, Any],
    changelog: str,
    description: str,
    tags: Sequence[str],
    details: str,
) -> dict[str, Any]:
    """Write a new immutable library version from a client-supplied draft.

    Test-independent edit-mode publish: validates the draft against its source
    version (changelog required, valid semver, source exists, target not a
    duplicate, target is an allowed bump) then persists via save_new_version.
    Returns ``{function_id, version}``.
    """
    if not changelog.strip():
        msg = "Changelog is required for edit-mode publish"
        raise UnprocessableEntityException(message=msg, details=_details_payload([msg]))
    if len(target_version) > _versioning.MAX_VERSION_LENGTH:
        msg = (
            f"Function version '{target_version}' exceeds the maximum length of "
            f"{_versioning.MAX_VERSION_LENGTH} characters"
        )
        raise UnprocessableEntityException(message=msg, details=_details_payload([msg]))
    target_core = _versioning.parse_version(target_version)
    if target_core is None:
        msg = f"Function version '{target_version}' is not a valid semver"
        raise UnprocessableEntityException(message=msg, details=_details_payload([msg]))
    try:
        source_def = _storage.load_version(function_id, source_version)
    except LookupError as exc:
        raise NotFoundException(message=str(exc), details=_details_payload([str(exc)])) from exc
    existing = _storage.list_versions(function_id)["versions"]
    if any(entry["version"] == target_version for entry in existing):
        msg = f"Target version '{target_version}' already exists in the library"
        raise ConflictException(message=msg, details=_details_payload([msg]))

    # No backports is PER-MAJOR: a target must advance past the latest version of
    # its OWN major line; other major lines do not constrain it. This also blocks
    # a pre-release of an already-released version within the line (2.0.0-dev1 < 2.0.0).
    target_major = target_core[0]
    line_head = _versioning.latest_in_major(existing, target_major)
    if line_head is not None and _versioning.version_precedence_key(
        target_version
    ) <= _versioning.version_precedence_key(line_head):
        msg = (
            f"Target version '{target_version}' must be greater than the latest "
            f"version '{line_head}' in the {target_major}.x line"
        )
        raise UnprocessableEntityException(message=msg, details=_details_payload([msg]))

    draft_definition = draft_over_source(draft_definition, source_def)
    _refuse_errors(_storage.declaration_issues(draft_definition))
    bumps = _versioning.compute_allowed_bumps(source_def, draft_definition)
    level = _versioning.classify_target_version(source_version, target_version)
    if level is None or level not in bumps["allowed"]:
        reason = bumps["blocked"].get(level or "patch", "not a valid bump path")
        msg = (
            f"Target version '{target_version}' is not a valid bump from "
            f"'{source_version}' (disallowed change: {reason})"
        )
        raise UnprocessableEntityException(message=msg, details=_details_payload([msg]))

    _refuse_circle(function_id, draft_definition)
    _refuse_errors(
        issue
        for issue in _storage._validate_references(
            draft_definition, function_registry=load_library_index()
        )
        if issue.code in _MISSING_REFERENCE_CODES
    )

    metadata = {
        "description": description or "",
        "tags": list(tags or []),
        "changelog": changelog.strip(),
        "details": details or "",
        "published_at": _now_iso(),
        "published_by": "wave",
    }
    _storage.save_new_version(
        function_id,
        target_version,
        draft_definition,
        metadata,
        name=source_def.get("name", ""),
    )
    return {"function_id": function_id, "version": target_version}


def delete_function(function_id: str, *, cascade: bool = False) -> dict[str, Any]:
    try:
        _storage.load_function(function_id)
    except LookupError as exc:
        raise NotFoundException(message=f"Function '{function_id}' not found") from exc

    dependents = _storage.scan_dependents(function_id)
    count = len(dependents["tests"]) + len(dependents["functions"])
    if count and not cascade:
        message = (
            f"Function '{function_id}' has {count} dependent(s); " "pass cascade=true to delete"
        )
        raise ConflictException(
            message=message,
            details=_details_payload([message]),
        )

    cascaded: list[dict[str, str]] = []
    if cascade:
        for kind in ("tests", "functions"):
            for entry in dependents[kind]:
                cascaded.append({"kind": kind[:-1], **entry})
    _storage.delete_function_file(function_id)
    return {"deleted_id": function_id, "cascaded": cascaded}


def get_function_dependents(function_id: str, version: str | None = None) -> dict[str, Any]:
    try:
        _storage.load_function(function_id)
    except LookupError as exc:
        raise NotFoundException(message=f"Function '{function_id}' not found") from exc
    return _storage.scan_dependents(function_id, version)


def get_dependents_by_version(function_id: str) -> dict[str, Any]:
    """Per-version dependents in a single storage pass: {version: {tests, functions}}."""
    try:
        _storage.load_function(function_id)
    except LookupError as exc:
        raise NotFoundException(message=f"Function '{function_id}' not found") from exc
    return _storage.scan_dependents_by_version(function_id)


def delete_function_version(function_id: str, version: str) -> None:
    """Remove a single published version; never blocked by usage.

    Deleting the last remaining version removes the whole Function. Raises
    ``NotFoundException`` for an unknown Function id or version.
    """
    try:
        _storage.delete_version(function_id, version)
    except LookupError as exc:
        raise NotFoundException(message=str(exc), details=_details_payload([str(exc)])) from exc


def _collect_errors(exc: WaveException) -> list[str]:
    """Pull every error string off a WaveException's details payload."""
    details = exc.details or {}
    errs = details.get("errors") or []
    if errs:
        return [item["message"] for item in errs if isinstance(item, dict)]
    return [exc.message]


def batch_create_functions(items: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    created: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        try:
            definition, _etag = create_function(item)
            created.append(definition)
        except WaveException as exc:
            failed.append({"index": index, "errors": _collect_errors(exc)})
    return {"created": created, "failed": failed}


def batch_delete_functions(ids: Sequence[str], *, cascade: bool = False) -> dict[str, Any]:
    deleted: list[str] = []
    failed: list[dict[str, Any]] = []
    for function_id in ids:
        try:
            delete_function(function_id, cascade=cascade)
            deleted.append(function_id)
        except WaveException as exc:
            failed.append({"id": function_id, "errors": _collect_errors(exc)})
    return {"deleted": deleted, "failed": failed}
