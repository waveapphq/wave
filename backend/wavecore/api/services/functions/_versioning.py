"""Semver bump-validation matrix for Function edit-mode publish.

``compute_allowed_bumps(source_def, draft_def)`` classifies a draft definition
against its source version:

- PATCH permits body / description / changelog / details edits.
- MINOR additionally permits adding OPTIONAL inputs, relaxing an existing input
  from required to optional, adding outputs, adding tags.
- MAJOR permits everything except the library entry's name.

Returns ``{"allowed": set[Literal["patch","minor","major"]], "blocked": dict}``
where ``blocked`` maps each disallowed bump level to a human-readable reason
the FE renders in the (i) tooltips on the disabled dropdown rows.

Pure function; no IO. Used by both the FE (via POST /functions/{id}/validate-bumps)
and the BE publish pipeline.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

BumpLevel = Literal["patch", "minor", "major"]
_ALL_LEVELS: tuple[BumpLevel, ...] = ("patch", "minor", "major")

# Global cap on a version string's length (mirrors storage NAME_MAX_LENGTH = 32).
MAX_VERSION_LENGTH = 32

# Single source of truth for a valid Function version: full semver 2.0.0
# (X.Y.Z with optional pre-release / build metadata). The X.Y.Z core drives the
# bump matrix and version grouping; pre-release identifiers drive precedence.
_SEMVER_RE = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+(?P<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


def parse_version(version: object) -> tuple[int, int, int] | None:
    """Return the (major, minor, patch) core, or None when not valid semver."""
    if not isinstance(version, str):
        return None
    match = _SEMVER_RE.match(version)
    if match is None:
        return None
    return (int(match.group("major")), int(match.group("minor")), int(match.group("patch")))


def is_valid_version(version: object) -> bool:
    """True when ``version`` is valid semver 2.0.0 within the global length cap."""
    if isinstance(version, str) and len(version) > MAX_VERSION_LENGTH:
        return False
    return parse_version(version) is not None


def version_precedence_key(version: object) -> tuple[Any, ...]:
    """Semver 2.0.0 precedence sort key.

    Build metadata is ignored (per spec); a normal release outranks any
    pre-release sharing its core; pre-release identifiers compare field by field
    (numeric < alphanumeric, more fields outrank fewer). Invalid input sorts lowest.
    """
    match = _SEMVER_RE.match(version) if isinstance(version, str) else None
    if match is None:
        return (-1, -1, -1, (0, ()))
    core = (
        int(match.group("major")),
        int(match.group("minor")),
        int(match.group("patch")),
    )
    prerelease = match.group("prerelease")
    if prerelease is None:
        return (*core, (1, ()))
    identifiers: list[tuple[int, int, str]] = []
    for ident in prerelease.split("."):
        if ident.isdigit():
            identifiers.append((0, int(ident), ""))
        else:
            identifiers.append((1, -1, ident))
    return (*core, (0, tuple(identifiers)))


def latest_in_major(versions: Sequence[Mapping[str, Any]], major: int) -> str | None:
    """Highest version within one major line, or None when that line is empty.

    A normal release outranks any pre-release sharing its core (semver precedence).
    """
    in_line: list[str] = []
    for entry in versions:
        version = str(entry.get("version"))
        parsed = parse_version(version)
        if parsed is not None and parsed[0] == major:
            in_line.append(version)
    if not in_line:
        return None
    return max(in_line, key=version_precedence_key)


def _normalize_param(param: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "name": param.get("name", ""),
        "type": param.get("type", ""),
        "required": bool(param.get("required", False)),
        "settings": (
            param.get("default"),
            bool(param.get("isExpression")),
            bool(param.get("isTemplate")),
            bool(param.get("secret")),
            param.get("enumValues"),
        ),
    }


def _settings_changed(
    source: dict[str, dict[str, Any]], draft: dict[str, dict[str, Any]]
) -> list[str]:
    """Kept parameters whose default, kind, secret flag or allowed values changed."""
    return [
        name
        for name, draft_param in draft.items()
        if name in source and draft_param["settings"] != source[name]["settings"]
    ]


def _index_params(params: Any) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    if not isinstance(params, list):
        return indexed
    for entry in params:
        if not isinstance(entry, Mapping):
            continue
        normalized = _normalize_param(entry)
        if normalized["name"]:
            indexed[normalized["name"]] = normalized
    return indexed


def _diff_inputs(
    source: dict[str, dict[str, Any]],
    draft: dict[str, dict[str, Any]],
) -> tuple[list[str], list[str], list[str], list[str], list[str], list[str]]:
    """Return (added_required, added_optional, removed, type_changed,
    made_required, made_optional)."""
    added_required: list[str] = []
    added_optional: list[str] = []
    type_changed: list[str] = []
    made_required: list[str] = []
    made_optional: list[str] = []

    for name, draft_param in draft.items():
        if name not in source:
            target = added_required if draft_param["required"] else added_optional
            target.append(name)
            continue
        src_param = source[name]
        if draft_param["type"] != src_param["type"]:
            type_changed.append(name)
        if draft_param["required"] == src_param["required"]:
            continue
        target = made_required if draft_param["required"] else made_optional
        target.append(name)

    removed = [name for name in source if name not in draft]

    return (
        added_required,
        added_optional,
        removed,
        type_changed,
        made_required,
        made_optional,
    )


def _diff_outputs(
    source: dict[str, dict[str, Any]],
    draft: dict[str, dict[str, Any]],
) -> tuple[list[str], list[str], list[str]]:
    """Return (added, removed, type_changed)."""
    added: list[str] = []
    removed: list[str] = []
    type_changed: list[str] = []

    for name, draft_param in draft.items():
        if name not in source:
            added.append(name)
            continue
        if draft_param["type"] != source[name]["type"]:
            type_changed.append(name)

    for name in source:
        if name not in draft:
            removed.append(name)

    return added, removed, type_changed


def _diff_tags(source: Any, draft: Any) -> tuple[list[str], list[str]]:
    src_tags = list(source) if isinstance(source, list) else []
    dst_tags = list(draft) if isinstance(draft, list) else []
    src_set = set(src_tags)
    dst_set = set(dst_tags)
    added = sorted(dst_set - src_set)
    removed = sorted(src_set - dst_set)
    return added, removed


@dataclass
class _Deltas:
    """I/O + tag deltas between a source and draft definition (first item of
    each list drives the human-readable blocker message)."""

    tags_added: list[str]
    tags_removed: list[str]
    inputs_added_required: list[str]
    inputs_added_optional: list[str]
    inputs_removed: list[str]
    inputs_type_changed: list[str]
    inputs_made_required: list[str]
    inputs_made_optional: list[str]
    outputs_added: list[str]
    outputs_removed: list[str]
    outputs_type_changed: list[str]
    inputs_renamed: list[tuple[str, str]]
    outputs_renamed: list[tuple[str, str]]
    settings_changed: list[str]


def _detect_renames(
    source_idx: dict[str, dict[str, Any]],
    draft_idx: dict[str, dict[str, Any]],
    removed: list[str],
    added: list[str],
    shape_keys: tuple[str, ...],
) -> list[tuple[str, str]]:
    """Pair each removed name with an added name of identical shape (a rename).

    ``shape_keys`` are the param fields that must match for a removed+added pair
    to read as a rename rather than an unrelated delete + add (``type`` +
    ``required`` for inputs; ``type`` alone for outputs)."""
    renames: list[tuple[str, str]] = []
    available = list(added)
    for old in removed:
        old_shape = tuple(source_idx[old].get(key) for key in shape_keys)
        match = next(
            (
                new
                for new in available
                if tuple(draft_idx[new].get(k) for k in shape_keys) == old_shape
            ),
            None,
        )
        if match is not None:
            renames.append((old, match))
            available.remove(match)
    return renames


def _compute_deltas(source_def: Mapping[str, Any], draft_def: Mapping[str, Any]) -> _Deltas:
    tags_added, tags_removed = _diff_tags(source_def.get("tags"), draft_def.get("tags"))
    source_inputs = _index_params(source_def.get("inputs"))
    draft_inputs = _index_params(draft_def.get("inputs"))
    (
        inputs_added_required,
        inputs_added_optional,
        inputs_removed,
        inputs_type_changed,
        inputs_made_required,
        inputs_made_optional,
    ) = _diff_inputs(source_inputs, draft_inputs)
    source_outputs = _index_params(source_def.get("outputs"))
    draft_outputs = _index_params(draft_def.get("outputs"))
    outputs_added, outputs_removed, outputs_type_changed = _diff_outputs(
        source_outputs, draft_outputs
    )
    inputs_renamed = _detect_renames(
        source_inputs,
        draft_inputs,
        inputs_removed,
        inputs_added_required + inputs_added_optional,
        ("type", "required"),
    )
    outputs_renamed = _detect_renames(
        source_outputs, draft_outputs, outputs_removed, outputs_added, ("type",)
    )
    return _Deltas(
        tags_added=tags_added,
        tags_removed=tags_removed,
        inputs_added_required=inputs_added_required,
        inputs_added_optional=inputs_added_optional,
        inputs_removed=inputs_removed,
        inputs_type_changed=inputs_type_changed,
        inputs_made_required=inputs_made_required,
        inputs_made_optional=inputs_made_optional,
        outputs_added=outputs_added,
        outputs_removed=outputs_removed,
        outputs_type_changed=outputs_type_changed,
        inputs_renamed=inputs_renamed,
        outputs_renamed=outputs_renamed,
        settings_changed=[
            *_settings_changed(source_inputs, draft_inputs),
            *_settings_changed(source_outputs, draft_outputs),
        ],
    )


def _removed_or_renamed_msg(
    level: str, kind: str, removed_name: str, renames: list[tuple[str, str]]
) -> str:
    """Word a removed-param blocker as a rename when a same-shape add compensates."""
    rename = next((pair for pair in renames if pair[0] == removed_name), None)
    if rename is not None:
        return f"{level} cannot rename {kind} (renamed '{rename[0]}' to '{rename[1]}')"
    return f"{level} cannot remove {kind} (removed '{removed_name}')"


def _patch_blockers(d: _Deltas) -> list[str]:
    blockers: list[str] = []
    if d.inputs_added_required:
        blockers.append(f"PATCH cannot add a REQUIRED input ('{d.inputs_added_required[0]}')")
    if d.inputs_added_optional:
        blockers.append(
            f"PATCH cannot include input or output changes (added optional input "
            f"'{d.inputs_added_optional[0]}')"
        )
    if d.outputs_added:
        blockers.append(f"PATCH cannot add outputs (added '{d.outputs_added[0]}')")
    if d.inputs_removed:
        blockers.append(
            _removed_or_renamed_msg("PATCH", "inputs", d.inputs_removed[0], d.inputs_renamed)
        )
    if d.outputs_removed:
        blockers.append(
            _removed_or_renamed_msg("PATCH", "outputs", d.outputs_removed[0], d.outputs_renamed)
        )
    if d.inputs_type_changed:
        blockers.append(f"PATCH cannot change input types (changed '{d.inputs_type_changed[0]}')")
    if d.outputs_type_changed:
        blockers.append(f"PATCH cannot change output types (changed '{d.outputs_type_changed[0]}')")
    required_flips = d.inputs_made_required + d.inputs_made_optional
    if required_flips:
        blockers.append(
            "PATCH cannot change an input's required flag (changed " + f"'{required_flips[0]}')"
        )
    if d.settings_changed:
        blockers.append(
            "PATCH cannot change a parameter's default, kind, secret flag or allowed values "
            f"(changed '{d.settings_changed[0]}')"
        )
    if d.tags_added:
        blockers.append(f"PATCH cannot add tags (added '{d.tags_added[0]}')")
    if d.tags_removed:
        blockers.append(f"PATCH cannot remove tags (removed '{d.tags_removed[0]}')")
    return blockers


def _minor_blockers(d: _Deltas) -> list[str]:
    blockers: list[str] = []
    if d.inputs_added_required:
        blockers.append(
            f"MINOR cannot add a REQUIRED input ('{d.inputs_added_required[0]}'); "
            f"only optional inputs may be added at MINOR"
        )
    if d.inputs_removed:
        blockers.append(
            _removed_or_renamed_msg("MINOR", "inputs", d.inputs_removed[0], d.inputs_renamed)
        )
    if d.outputs_removed:
        blockers.append(
            _removed_or_renamed_msg("MINOR", "outputs", d.outputs_removed[0], d.outputs_renamed)
        )
    if d.inputs_type_changed:
        blockers.append(f"MINOR cannot change input types (changed '{d.inputs_type_changed[0]}')")
    if d.outputs_type_changed:
        blockers.append(f"MINOR cannot change output types (changed '{d.outputs_type_changed[0]}')")
    if d.inputs_made_required:
        blockers.append(
            f"MINOR cannot make an existing input REQUIRED (changed "
            f"'{d.inputs_made_required[0]}'); relaxing to optional is allowed"
        )
    if d.tags_removed:
        blockers.append(f"MINOR cannot remove tags (removed '{d.tags_removed[0]}')")
    return blockers


def compute_allowed_bumps(
    source_def: Mapping[str, Any],
    draft_def: Mapping[str, Any],
) -> dict[str, Any]:
    """Classify ``draft_def`` against ``source_def`` per the semver-bump matrix.

    Returns ``{"allowed": set[BumpLevel], "blocked": dict[BumpLevel, str]}``.
    """
    # Name lock: the entry name is immutable at every level.
    source_name = source_def.get("name", "")
    draft_name = draft_def.get("name", "")
    if source_name != draft_name:
        reason = (
            f"Function name is locked; cannot rename '{source_name}' to "
            f"'{draft_name}' at any version level"
        )
        return {"allowed": set(), "blocked": dict.fromkeys(_ALL_LEVELS, reason)}

    deltas = _compute_deltas(source_def, draft_def)
    blocked: dict[BumpLevel, str] = {}
    patch_blockers = _patch_blockers(deltas)
    if patch_blockers:
        blocked["patch"] = patch_blockers[0]
    minor_blockers = _minor_blockers(deltas)
    if minor_blockers:
        blocked["minor"] = minor_blockers[0]
    # MAJOR has no blockers other than the name lock handled above.
    allowed: set[BumpLevel] = set(_ALL_LEVELS) - set(blocked.keys())
    return {"allowed": allowed, "blocked": dict(blocked)}


def classify_target_version(source_version: str, target_version: str) -> BumpLevel | None:
    """Return the bump level of ``target_version`` relative to ``source_version``.

    Returns None when ``target_version`` is not a strictly-increasing semver
    bump of ``source_version`` along one of the three classes.
    """
    src = parse_version(source_version)
    tgt = parse_version(target_version)
    if src is None or tgt is None:
        return None
    sm, sn, sp = src
    tm, tn, tp = tgt
    if tm == sm and tn == sn and tp > sp:
        return "patch"
    if tm == sm and tn > sn:
        return "minor"
    if tm > sm:
        return "major"
    return None
