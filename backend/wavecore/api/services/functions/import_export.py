"""Function import / export service.

Mirrors the Tests/Suites per-feature import-export pattern (ZIP multi-export,
dry-run validate, shared ``rename`` / ``overwrite`` / ``skip`` conflict flow)
and layers the one Function-specific extension: cross-Function dependency
ordering, so an exported archive re-imports into a runnable graph and an
import commits a dependency before its dependents.

The validate and import results use the canonical shared shape from
``frontend/src/types/import-export.ts`` (``items`` / ``existing_id`` /
``imported[].action``) so the shared FE import dialog consumes them unchanged.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from functools import partial
from typing import Any, Self

import yaml

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.services.functions import _storage, _versioning
from wavecore.api.services.shared import (
    ItemTarget,
    apply_secrets_mode_to_definition,
    check_definition_foreign_envelopes,
    decide_item_target,
    export_file_stem,
    parse_zip_file,
    settle_imported_definition_secrets,
    unencodable_file_message,
)
from wavecore.core.functions.references import (
    FunctionReference,
    iter_function_references,
    referenced_function_ids,
    remap_function_ids,
)
from wavecore.core.utf8_text import load_yaml

_EXT_JSON = ".json"

Finding = tuple[str, dict[str, Any]]

CIRCULAR_TEXT = "Circular Function reference: {circle}"


def circle_path(circle: str, names: Mapping[str, str]) -> list[str]:
    """The Functions of a circle of ids joined by `` -> ``, each by its name when known."""
    return [names.get(function_id) or function_id for function_id in circle.split(" -> ")]


def circle_text(path: Sequence[str]) -> str:
    """The one text naming a circle of Functions."""
    return CIRCULAR_TEXT.format(circle=" -> ".join(path))


_WRITTEN_AS = {"create": "created", "overwrite": "overwritten", "rename": "renamed"}
_SAME_RUN_WORDS = {"id": "ID", "name": "name"}
# A finding with no entry here carries its own message.
_IMPORT_TEXTS = {
    "MISSING_FUNCTION_ID": 'Uses Function "{block}", which is not in the library or in this file',
    "MISSING_FUNCTION_VERSION": (
        'Uses Function "{function_name}" {version}, which is not in the library or in this file'
    ),
    "CIRCULAR": CIRCULAR_TEXT,
    "NAME_TAKEN": "Another Function here has this name",
    "SAME_RUN": "The file holds another Function with this {same}",
    "AMBIGUOUS_NAME": "Several Functions in the library have this name",
}
_UNNAMED_FUNCTION = "Uses a Function that is not in the library or in this file"


def _details(message: str) -> dict[str, list[dict[str, str]]]:
    return {"errors": [{"message": message}]}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def _validate_format(fmt: str) -> str:
    fmt_lower = (fmt or "yaml").lower()
    if fmt_lower not in ("yaml", "json"):
        message = f"Invalid export format '{fmt}'; must be 'yaml' or 'json'"
        raise ValidationException(message=message, details=_details(message))
    return fmt_lower


def _encode(payload: Any, fmt: str) -> tuple[bytes, str]:
    if fmt == "yaml":
        return yaml.safe_dump(payload, sort_keys=False).encode("utf-8"), "application/x-yaml"
    return json.dumps(payload, indent=2).encode("utf-8"), "application/json"


def _sanitize_filename(name: str) -> str:
    return export_file_stem(name or "", "function")


def function_export_document(function_id: str, secrets: str) -> dict[str, Any]:
    """One Function's export document with every version, under a secrets mode."""
    definition, _etag = _storage.load_function(function_id)
    return _apply_secrets(_with_versions(definition, function_id), secrets)


def export_function(
    function_id: str, *, fmt: str = "yaml", secrets: str = "mask"
) -> tuple[bytes, str, str]:
    """Return (payload_bytes, filename, content_type) for a single Function."""
    fmt_lower = _validate_format(fmt)
    try:
        definition, _etag = _storage.load_function(function_id)
    except LookupError as exc:
        message = f"Function '{function_id}' not found"
        raise NotFoundException(message=message, details=_details(message)) from exc
    document = function_export_document(function_id, secrets)
    body, content_type = _encode(document, fmt_lower)
    extension = "yaml" if fmt_lower == "yaml" else "json"
    filename = f"{_sanitize_filename(definition.get('name', function_id))}.{extension}"
    return body, filename, content_type


def _with_versions(definition: Mapping[str, Any], function_id: str) -> dict[str, Any]:
    """Latest-definition document augmented with the full version history."""
    document = dict(definition)
    document["versions"] = _storage.list_version_records(function_id)
    return document


def _apply_secrets(document: dict[str, Any], secrets: str) -> dict[str, Any]:
    """Apply the export secrets mode to the definition and every version record."""
    result = apply_secrets_mode_to_definition(document, secrets)
    result["versions"] = [_version_under_mode(record, secrets) for record in document["versions"]]
    return result


def _version_under_mode(record: dict[str, Any], secrets: str) -> dict[str, Any]:
    """A version record with the export secrets mode applied to its definition."""
    definition = record.get("definition")
    return (
        {**record, "definition": apply_secrets_mode_to_definition(definition, secrets)}
        if isinstance(definition, Mapping)
        else record
    )


def _dependency_first(references: Mapping[str, Collection[str]]) -> list[str]:
    """The keys ordered so that each one follows the keys it references."""
    ordered: list[str] = []
    visited: set[str] = set()

    def _visit(key: str) -> None:
        if key in visited:
            return
        visited.add(key)
        for dep in sorted(references.keys() & references[key]):
            _visit(dep)
        ordered.append(key)

    for key in references:
        _visit(key)
    return ordered


def _topological_ids(definitions: Mapping[str, Mapping[str, Any]]) -> list[str]:
    """Return ids in dependency-first order (a dependency precedes its dependent)."""
    return _dependency_first(
        {
            function_id: referenced_function_ids(definition.get("workflow"))
            for function_id, definition in definitions.items()
        }
    )


def export_functions_batch(
    ids: Sequence[str], *, fmt: str = "yaml", secrets: str = "mask"
) -> list[tuple[str, bytes, str]]:
    """Return ``[(id, content_bytes, filename)]`` in dependency-first order.

    Raises ``ValidationException`` (400) for a bad format and
    ``NotFoundException`` (404) listing every missing id.
    """
    fmt_lower = _validate_format(fmt)
    definitions: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    for function_id in ids:
        try:
            definition, _etag = _storage.load_function(function_id)
            definitions[function_id] = definition
        except LookupError:
            missing.append(function_id)
    if missing:
        message = f"One or more Functions not found: {', '.join(missing)}"
        raise NotFoundException(message=message, details=_details(message))

    extension = "yaml" if fmt_lower == "yaml" else "json"
    seen: set[str] = set()
    results: list[tuple[str, bytes, str]] = []
    for function_id in _topological_ids(definitions):
        definition = definitions[function_id]
        document = function_export_document(function_id, secrets)
        body, _content_type = _encode(document, fmt_lower)
        base = f"{_sanitize_filename(definition.get('name', function_id))}.{extension}"
        filename = base
        counter = 2
        while filename in seen:
            filename = f"{base[: -(len(extension) + 1)]}-{counter}.{extension}"
            counter += 1
        seen.add(filename)
        results.append((function_id, body, filename))
    return results


# ---------------------------------------------------------------------------
# Parsing (YAML / JSON / ZIP)
# ---------------------------------------------------------------------------


class _ParseError(Exception):
    """Internal: a payload could not be parsed into Function documents."""


def _parse_doc(raw: bytes, filename: str) -> dict[str, Any]:
    text = raw.decode("utf-8", errors="replace")
    try:
        if filename.lower().endswith(_EXT_JSON):
            data = json.loads(text)
        else:
            data = load_yaml(text)
    except (yaml.YAMLError, json.JSONDecodeError) as exc:
        raise _ParseError(str(exc)) from exc
    unencodable = unencodable_file_message(text, data)
    if unencodable is not None:
        raise ValidationException(message=unencodable, details=_details(unencodable))
    if not isinstance(data, dict):
        raise _ParseError("expected a Function definition mapping at the top level")
    return data


def _parse_entries(payload: bytes, filename: str) -> list[dict[str, Any]]:
    if (filename or "").lower().endswith(".zip"):
        entries = parse_zip_file(payload, parse=_parse_doc, error=_ParseError, skip_dunder=True)
        return [data for _, data in entries]
    return [_parse_doc(payload, filename or "function.yaml")]


# ---------------------------------------------------------------------------
# Entry documents
# ---------------------------------------------------------------------------


def _published_at(entry: Mapping[str, Any]) -> str:
    metadata = entry.get("metadata") or {}
    return (
        metadata.get("published_at")
        or metadata.get("updated_at")
        or metadata.get("created_at")
        or ""
    )


def _published_by(entry: Mapping[str, Any]) -> str:
    metadata = entry.get("metadata") or {}
    return metadata.get("published_by") or metadata.get("author") or "wave"


def _build_definition(
    body: Mapping[str, Any],
    function_id: str,
    target_name: str,
    version: str | None = None,
    stored: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    # A secret WAVE cannot open, or a placeholder with nothing stored at its place, is null.
    settled = settle_imported_definition_secrets(_storage.function_body(body), stored)
    return {
        "id": function_id,
        "name": target_name,
        "description": body.get("description", "") or "",
        "tags": list(body.get("tags") or []),
        **settled,
        "version": version or body.get("version", "1.0.0") or "1.0.0",
    }


def _stored_version(function_id: str, version: str) -> dict[str, Any] | None:
    """The version an import overwrites, as the library holds it, or None."""
    try:
        return _storage.load_version(function_id, version)
    except LookupError:
        return None


def entry_version_records(
    entry: Mapping[str, Any],
) -> list[tuple[str, Mapping[str, Any], Mapping[str, Any]]]:
    """Version, body and metadata of every version an entry holds, else of its top level."""
    versions = entry.get("versions")
    listed = versions if isinstance(versions, list) else []
    records = [item for item in listed if isinstance(item, Mapping)]
    if records:
        return [
            (
                str(item.get("version") or entry.get("version") or "1.0.0"),
                item.get("definition") or {},
                item.get("metadata") or {},
            )
            for item in records
        ]
    fallback_metadata = {
        "description": entry.get("description", "") or "",
        "tags": list(entry.get("tags") or []),
        "changelog": entry.get("changelog", "") or "",
        "details": entry.get("details", "") or "",
        "published_at": _published_at(entry),
        "published_by": _published_by(entry),
    }
    return [(str(entry.get("version") or "1.0.0"), entry, fallback_metadata)]


def _entry_references(entry: Mapping[str, Any]) -> list[FunctionReference]:
    return [
        reference
        for _version, body, _metadata in entry_version_records(entry)
        for reference in iter_function_references(body.get("workflow"))
    ]


def _remapped_body(body: Mapping[str, Any], id_map: Mapping[str, str]) -> dict[str, Any]:
    result = dict(body)
    if "workflow" in body:
        result["workflow"] = remap_function_ids(body["workflow"], id_map)
    return result


def _remapped_entry(entry: Mapping[str, Any], id_map: Mapping[str, str]) -> dict[str, Any]:
    result = _remapped_body(entry, id_map)
    if isinstance(entry.get("versions"), list):
        result["versions"] = [
            (
                {**record, "definition": _remapped_body(record.get("definition") or {}, id_map)}
                if isinstance(record, Mapping)
                else record
            )
            for record in entry["versions"]
        ]
    return result


# ---------------------------------------------------------------------------
# Decide (nothing is written)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EntryDecision:
    """What an import does with one entry of a file."""

    entry: dict[str, Any]
    source_id: str | None
    name: str
    status: str
    conflict: str | None = None
    action: str | None = None
    target_id: str | None = None
    target_name: str | None = None
    existing_id: str | None = None
    finding: Finding | None = None

    def changed(self, **changes: Any) -> Self:
        """A copy of the decision with the given fields changed."""
        return type(self)(**{**vars(self), **changes})


@dataclass(frozen=True)
class EntryOutcome:
    """What an import did with one entry of a file."""

    source_id: str | None
    final_id: str | None
    final_name: str | None
    action: str
    reason: str | None = None


@dataclass
class _Draft:
    """One entry while the references of the whole file are checked."""

    decision: EntryDecision
    key: str
    versions: set[str]
    references: list[FunctionReference]

    def present(self, preview: bool) -> bool:
        return preview or self.decision.action in _WRITTEN_AS

    def unchecked(self, preview: bool) -> bool:
        return self.decision.finding is None and self.present(preview)


def _finding_text(finding: Finding) -> str:
    code, parts = finding
    unnamed = code == "MISSING_FUNCTION_ID" and not parts.get("block")
    template = _UNNAMED_FUNCTION if unnamed else _IMPORT_TEXTS.get(code, "{message}")
    return template.format(
        **parts,
        circle=" -> ".join(parts.get("path", ())),
        same=_SAME_RUN_WORDS.get(parts.get("match", "")),
    )


def _own_finding(entry: Mapping[str, Any]) -> Finding | None:
    structural = _storage.validate_structural(entry)
    if structural:
        return "STRUCTURAL", {"message": structural[0]}
    declarations = _storage.declaration_issues(entry)
    if declarations:
        return declarations[0].code, {"message": declarations[0].message}
    version = entry.get("version", "1.0.0") or "1.0.0"
    if not _versioning.is_valid_version(version):
        message = f"Invalid version '{version}'; expected a valid semver"
        return "INVALID_VERSION", {"message": message}
    return None


def _refusal(target: ItemTarget) -> Finding:
    parts: dict[str, Any] = {"type": "Function"}
    if target.blocked == "SAME_RUN":
        parts["match"] = "name" if target.conflict == "name" else "id"
    return target.blocked or "", parts


def _blocked(decision: EntryDecision, finding: Finding, preview: bool) -> EntryDecision:
    return decision.changed(
        status="fatal",
        finding=finding,
        action=None if preview else "blocked",
        target_id=None,
        target_name=None,
    )


def _decide_target(
    entry: dict[str, Any],
    resolution_for: Callable[[str], str] | None,
    names_by_id: Mapping[str, str],
    written: Collection[str],
) -> EntryDecision:
    raw_id = entry.get("id")
    source_id = raw_id if isinstance(raw_id, str) and raw_id else None
    name = entry.get("name", "Unnamed")
    finding = _own_finding(entry)
    if finding is not None:
        unmatched = EntryDecision(entry, source_id, name, "fatal")
        return _blocked(unmatched, finding, resolution_for is None)
    target_under = partial(
        decide_item_target,
        source_id=source_id,
        name=name,
        names_by_id=names_by_id,
        written_ids=written,
        normalize=str.casefold,
        max_name_length=_storage.NAME_MAX_LENGTH,
    )
    here = target_under(resolution="skip")
    target = target_under(resolution=resolution_for(name) if resolution_for else None)
    decision = EntryDecision(
        entry=entry,
        source_id=source_id,
        name=name,
        status="conflict" if here.conflict else "ok",
        conflict=here.conflict,
        action=target.action,
        target_id=target.target_id,
        target_name=target.target_name,
        existing_id=here.target_id if here.conflict else None,
    )
    return _blocked(decision, _refusal(target), False) if target.blocked else decision


def _decide_targets(
    entries: Sequence[dict[str, Any]],
    resolution_for: Callable[[str], str] | None,
    names_by_id: dict[str, str],
) -> list[EntryDecision]:
    """Each entry's match and target in file order; `names_by_id` gains what will be written."""
    written: set[str] = set()
    decisions: list[EntryDecision] = []
    for entry in entries:
        here = dict(sorted(names_by_id.items()))
        decision = _decide_target(entry, resolution_for, here, written)
        if decision.target_id and decision.target_name and decision.action in _WRITTEN_AS:
            written.add(decision.target_id)
            names_by_id[decision.target_id] = decision.target_name
        decisions.append(decision)
    return decisions


def _id_map(decisions: Iterable[EntryDecision]) -> dict[str, str]:
    targets: dict[str, str] = {}
    for decision in decisions:
        if decision.source_id and decision.target_id:
            targets.setdefault(decision.source_id, decision.target_id)
    return {source: target for source, target in targets.items() if source != target}


def _draft(decision: EntryDecision, id_map: Mapping[str, str]) -> _Draft:
    entry = _remapped_entry(decision.entry, id_map) if id_map else decision.entry
    return _Draft(
        decision=decision.changed(entry=entry),
        key=decision.target_id or decision.source_id or "",
        versions={version for version, _body, _metadata in entry_version_records(entry)},
        references=_entry_references(entry),
    )


def _stored_versions(function_ids: Iterable[str]) -> dict[str, set[str]]:
    """The versions the library holds of each of the given Functions that it has."""
    stored: dict[str, set[str]] = {}
    for function_id in function_ids:
        with contextlib.suppress(LookupError):
            definition, _etag = _storage.load_function(function_id)
            stored[function_id] = set(definition["available_versions"])
    return stored


def _versions_by_key(drafts: Iterable[_Draft]) -> dict[str, set[str]]:
    versions: dict[str, set[str]] = {}
    for draft in drafts:
        versions.setdefault(draft.key, set()).update(draft.versions)
    return versions


def _missing_reference(
    draft: _Draft,
    available: Mapping[str, set[str]],
    held: Mapping[str, set[str]],
    names: Mapping[str, str],
) -> Finding | None:
    for reference in draft.references:
        function_id, version = reference.function_id, reference.version
        if function_id not in available:
            parts = {"block": reference.node_label, "in_archive": function_id in held}
            return "MISSING_FUNCTION_ID", parts
        if version and version not in available[function_id]:
            return "MISSING_FUNCTION_VERSION", {
                "block": reference.node_label,
                "function_name": names.get(function_id) or function_id,
                "version": version,
                "in_archive": version in held.get(function_id, ()),
            }
    return None


def _block_missing(
    drafts: Sequence[_Draft],
    stored: Mapping[str, set[str]],
    held: Mapping[str, set[str]],
    names: Mapping[str, str],
    preview: bool,
) -> None:
    """Block each entry that uses a Function or a version that is not here after the import."""
    blocked = True
    while blocked:
        blocked = False
        available = _versions_by_key(draft for draft in drafts if draft.present(preview))
        for function_id, versions in stored.items():
            available.setdefault(function_id, set()).update(versions)
        for draft in drafts:
            finding = (
                _missing_reference(draft, available, held, names)
                if draft.unchecked(preview)
                else None
            )
            if finding is not None:
                draft.decision = _blocked(draft.decision, finding, preview)
                blocked = not preview


def _block_circles(drafts: Sequence[_Draft], names: Mapping[str, str], preview: bool) -> None:
    """Block each entry that is part of a circle of references after the import."""
    reference_index = _storage.load_reference_index()
    present = [draft for draft in drafts if draft.present(preview)]
    for draft in present:
        called = {reference.function_id for reference in draft.references}
        reference_index[draft.key] = reference_index.get(draft.key, set()) | called
    for draft in present:
        circle = (
            _storage.detect_circular_deps(draft.key, reference_index)
            if draft.decision.finding is None
            else None
        )
        if circle is not None:
            path = circle_path(circle, names)
            draft.decision = _blocked(draft.decision, ("CIRCULAR", {"path": path}), preview)


def decide_entries(
    entries: Sequence[dict[str, Any]], resolution_for: Callable[[str], str] | None
) -> list[EntryDecision]:
    """One decision per entry, in their order; nothing is written."""
    preview = resolution_for is None
    names = {row["id"]: row["name"] for row in _storage.list_function_summaries()}
    decisions = _decide_targets(entries, resolution_for, names)
    id_map = _id_map(decisions)
    drafts = [_draft(decision, id_map) for decision in decisions]
    names.update(
        {
            draft.key: str(draft.decision.target_name or draft.decision.name)
            for draft in drafts
            if draft.present(preview)
        }
    )
    stored = _stored_versions(
        {reference.function_id for draft in drafts for reference in draft.references}
    )
    held = _versions_by_key(drafts)
    _block_missing(drafts, stored, held, names, preview)
    _block_circles(drafts, names, preview)
    _block_missing(drafts, stored, held, names, preview)
    return [draft.decision for draft in drafts]


# ---------------------------------------------------------------------------
# Commit
# ---------------------------------------------------------------------------


def _write_order(decisions: Sequence[EntryDecision]) -> list[int]:
    """The positions of the decisions that are written, dependency first."""
    positions = {
        decision.target_id: position
        for position, decision in enumerate(decisions)
        if decision.target_id and decision.action in _WRITTEN_AS
    }
    references = {
        function_id: {ref.function_id for ref in _entry_references(decisions[position].entry)}
        for function_id, position in positions.items()
    }
    return [positions[function_id] for function_id in _dependency_first(references)]


def _write_versions(entry: Mapping[str, Any], function_id: str, name: str, *, merge: bool) -> None:
    # Every version write moves the stored updated time, so it is read first.
    stored = _storage.load_function(function_id)[0]["metadata"] if merge else {}
    save = _storage.save_or_replace_version if merge else _storage.save_new_version
    records = entry_version_records(entry)
    for version, body, metadata in records:
        here = _stored_version(function_id, version) if merge else None
        definition = _build_definition(body, function_id, name, version, here)
        save(function_id, version, definition, metadata, name=name)
    document = entry.get("metadata") or {}
    published: list[str] = [
        metadata["published_at"]
        for _version, _body, metadata in records
        if metadata.get("published_at")
    ]
    created: list[str] = [
        document.get("created_at") or min(published, default=""),
        stored.get("created_at") or "",
    ]
    updated: list[str] = [
        document.get("updated_at") or max(published, default=""),
        stored.get("updated_at") or "",
    ]
    _storage.set_index_timestamps(
        function_id,
        created_at=min(filter(None, created), default=""),
        updated_at=max(updated),
    )


def _write(decision: EntryDecision) -> EntryOutcome:
    function_id, name = decision.target_id or "", decision.target_name or ""
    merge = decision.action == "overwrite"
    try:
        _write_versions(decision.entry, function_id, name, merge=merge)
    except Exception as exc:
        if not merge:
            with contextlib.suppress(LookupError):
                _storage.delete_function_file(function_id)
        reason = str(exc) or type(exc).__name__
        return EntryOutcome(decision.source_id, function_id, name, "failed", reason)
    return EntryOutcome(decision.source_id, function_id, name, _WRITTEN_AS[decision.action or ""])


def commit_decisions(decisions: Sequence[EntryDecision]) -> list[EntryOutcome]:
    """Write the decided entries dependency first; one outcome per decision, in their order."""
    outcomes = [
        EntryOutcome(decision.source_id, decision.target_id, decision.target_name, "skipped")
        for decision in decisions
    ]
    for position in _write_order(decisions):
        outcomes[position] = _write(decisions[position])
    return outcomes


# ---------------------------------------------------------------------------
# File-upload entry points
# ---------------------------------------------------------------------------


def _preview_item(decision: EntryDecision) -> dict[str, Any]:
    entry, finding = decision.entry, decision.finding
    item: dict[str, Any] = {
        "name": decision.name,
        "status": decision.status,
        "fatal_errors": (
            [{"code": finding[0], "message": _finding_text(finding)}] if finding else []
        ),
        "fixable_errors": [],
        "warnings": check_definition_foreign_envelopes(entry),
        "existing_id": None,
    }
    if decision.status == "conflict":
        item["existing_id"] = decision.existing_id
        item["conflict_reason"] = decision.conflict
    return item


def validate_import(payload: bytes, filename: str) -> dict[str, Any]:
    """Dry-run validate; persists nothing. Returns the shared ValidateImportResult."""
    try:
        entries = _parse_entries(payload, filename)
    except _ParseError as exc:
        reason = " ".join(str(exc).split()) or "could not parse file"
        message = f"Validation failed: {reason}"
        raise ValidationException(message=message, details=_details(message)) from exc

    items = [_preview_item(decision) for decision in decide_entries(entries, None)]
    blocked = sum(1 for item in items if item["status"] == "fatal")
    return {
        "items": items,
        "total": len(items),
        "importable": len(items) - blocked,
        "blocked": blocked,
    }


def _skip_reason(decision: EntryDecision) -> str:
    if decision.conflict in ("id", "both"):
        return f"UUID '{decision.source_id}' already exists in the library"
    return f"conflicts with existing Function '{decision.name}'"


def _unwritten_reason(decision: EntryDecision, outcome: EntryOutcome) -> str:
    finding = decision.finding
    return outcome.reason or (_finding_text(finding) if finding else _skip_reason(decision))


def import_functions(
    payload: bytes,
    filename: str,
    conflict_resolutions: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Commit imported Functions; returns the shared ImportResult shape."""
    try:
        entries = _parse_entries(payload, filename)
    except _ParseError as exc:
        message = "Import payload is not valid YAML or JSON"
        raise ValidationException(message=message, details=_details(message)) from exc

    resolutions = dict(conflict_resolutions or {})
    decisions = decide_entries(entries, lambda name: resolutions.get(name, "skip"))
    outcomes = commit_decisions(decisions)
    imported = [
        {"name": outcome.final_name, "id": outcome.final_id, "action": outcome.action}
        for outcome in (outcomes[position] for position in _write_order(decisions))
        if outcome.action != "failed"
    ]
    skipped = [
        {"name": decision.name, "reason": _unwritten_reason(decision, outcome)}
        for decision, outcome in zip(decisions, outcomes, strict=True)
        if outcome.action in ("skipped", "failed")
    ]
    return {
        "imported": imported,
        "skipped": skipped,
        "fixes_applied": [],
        "total_imported": len(imported),
        "total_skipped": len(skipped),
    }
