"""Shared utilities for service-layer operations.

Provides reusable helpers for common patterns that appear across multiple
service modules, such as version bumping with history recording,
entity resolution, and file parsing for import/export.
"""

import copy
import io
import json
import re
import unicodedata
import uuid
import zipfile
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any, BinaryIO, overload

from wavecore.api.exceptions import ConflictException, ValidationException, WaveException
from wavecore.core.functions.declarations import declaration_numbers, value_problems
from wavecore.core.secrets import masking_settings
from wavecore.core.secrets.cipher import SecretDecryptionError, is_secret_envelope
from wavecore.core.secrets.key_provider import get_cipher
from wavecore.core.secrets.masking import MASK_PLACEHOLDER, masked_declaration
from wavecore.core.secrets.sealing import (
    iter_definition_secret_items,
    iter_workflow_secret_items,
    mask_definition_secrets,
    mask_workflow_node_secrets,
    restore_masked_definition_secrets,
    restore_masked_workflow_secrets,
    transform_definition_secrets,
    transform_setter_node_secrets,
    unseal_all,
    unseal_definition_secrets,
    unseal_variables,
    unseal_workflow_node_secrets,
)
from wavecore.core.utf8_text import load_yaml, unencodable_place
from wavecore.core.variables.value_checks import stored_number

SECRETS_MODES = ("mask", "encrypted", "plaintext")


def is_name_char(char: str) -> bool:
    """True for a letter, digit or mark of any language, and for the underscore."""
    return char == "_" or unicodedata.category(char)[0] in "LMN"


def export_file_stem(name: str, fallback: str) -> str:
    """A display name as a file name: letters of any language kept, spaces as dashes."""
    kept = "".join(char for char in name if is_name_char(char) or char == "-" or char.isspace())
    return "-".join(kept.split()) or fallback


def parse_secrets_mode(value: str | None) -> str:
    """Validate an export secrets mode, defaulting a missing value to 'mask'.

    Args:
        value: Raw mode from the request, or None when omitted.

    Returns:
        One of 'mask', 'encrypted', or 'plaintext'.

    Raises:
        ValidationException: If the value is not a recognized mode.
    """
    if value is None:
        return "mask"
    if value not in SECRETS_MODES:
        raise ValidationException(
            f"Invalid secrets mode '{value}'; must be 'mask', 'encrypted', or 'plaintext'"
        )
    return value


def apply_secrets_mode_to_variables(variables: dict[str, Any], mode: str) -> dict[str, Any]:
    """Transform a name-keyed variables dict per the export secrets mode.

    'mask' replaces secret values with the placeholder and flags them masked,
    'encrypted' emits the stored envelopes verbatim, 'plaintext' decrypts them.

    Args:
        variables: Mapping of variable name to variable info.
        mode: One of 'mask', 'encrypted', or 'plaintext'.

    Returns:
        A new dict with the mode applied; the input is not mutated.

    Raises:
        ConflictException: In plaintext mode, when the encryption key is
            missing/invalid or an envelope cannot be decrypted.
    """
    if mode == "encrypted":
        return dict(variables)
    if mode == "plaintext":
        try:
            return unseal_variables(variables)
        except (ValueError, SecretDecryptionError) as e:
            raise ConflictException(str(e)) from e
    return mask_secret_variables(variables, flag_masked=True)


def _under_mode[
    Document
](
    document: Document,
    mode: str,
    *,
    mask: Callable[[Document], Document],
    unseal: Callable[[Document], Document],
) -> Document:
    """'mask' shows the placeholder, 'encrypted' keeps the envelopes, 'plaintext' opens them."""
    if mode == "encrypted":
        return copy.deepcopy(document)
    if mode == "plaintext":
        try:
            return unseal(document)
        except (ValueError, SecretDecryptionError) as e:
            raise ConflictException(str(e)) from e
    return mask(document)


def apply_secrets_mode_to_workflow(workflow: dict[str, Any], mode: str) -> dict[str, Any]:
    """A workflow under an export secrets mode, every secret it holds at every depth.

    Raises:
        ConflictException: In plaintext mode, when an envelope cannot be decrypted.
    """
    if not isinstance(workflow, dict):
        return workflow
    return _under_mode(
        workflow, mode, mask=mask_workflow_node_secrets, unseal=unseal_workflow_node_secrets
    )


def _declarations_under_mode(key: str, entries: Any, mode: str) -> Any:
    """Function declarations (``variables`` or ``outputs``) under an export secrets mode."""
    held = _under_mode(
        {key: entries}, mode, mask=mask_definition_secrets, unseal=unseal_definition_secrets
    )
    return held[key]


def apply_secrets_mode_to_variable_list(
    variables: list[dict[str, Any]], mode: str
) -> list[dict[str, Any]]:
    """A Function's list-shaped local variables under an export secrets mode."""
    held: list[dict[str, Any]] = _declarations_under_mode("variables", variables, mode)
    return held


def _with_parts(definition: Mapping[str, Any], **parts: Callable[[Any], Any]) -> dict[str, Any]:
    """A copy of a Function definition with each part it carries converted."""
    result = dict(definition)
    for key, convert in parts.items():
        if key in result:
            result[key] = convert(result[key])
    return result


def apply_secrets_mode_to_definition(definition: Mapping[str, Any], mode: str) -> dict[str, Any]:
    """A Function definition under an export secrets mode: locals, output defaults, workflow."""
    return _with_parts(
        definition,
        variables=partial(apply_secrets_mode_to_variable_list, mode=mode),
        outputs=partial(_declarations_under_mode, "outputs", mode=mode),
        workflow=partial(apply_secrets_mode_to_workflow, mode=mode),
    )


def _foreign_warnings(items: Iterable[tuple[str, Any]]) -> list[dict[str, str]]:
    return [foreign_secret_warning(name) for name, value in items if is_foreign_envelope(value)]


def check_workflow_foreign_envelopes(workflow: Any) -> list[dict[str, str]]:
    """Warn for each secret a workflow holds that another WAVE instance sealed."""
    if not isinstance(workflow, dict):
        return []
    return _foreign_warnings(iter_workflow_secret_items(workflow))


def check_definition_foreign_envelopes(definition: dict[str, Any]) -> list[dict[str, str]]:
    """Warn for each secret a Function definition holds that another WAVE instance sealed."""
    return _foreign_warnings(iter_definition_secret_items(definition))


def _is_unusable(value: Any) -> bool:
    """A value WAVE cannot open, or the placeholder a masked export left (REQ-4.5.19)."""
    return value == MASK_PLACEHOLDER or is_foreign_envelope(value)


def _sanitized(value: Any) -> Any:
    return None if _is_unusable(value) else value


def sanitize_foreign_secret_variables(variables: dict[str, Any]) -> dict[str, Any]:
    """A copy where a secret WAVE cannot open, or the placeholder, holds null and stays secret."""
    if not isinstance(variables, dict):
        return variables
    result: dict[str, Any] = {}
    for name, var_info in variables.items():
        if (
            isinstance(var_info, dict)
            and var_info.get("secret")
            and _is_unusable(var_info.get("value"))
        ):
            kept = {k: v for k, v in var_info.items() if k not in ("masked", "elementTypes")}
            result[name] = {**kept, "value": None}
        else:
            result[name] = var_info
    return result


def sanitize_foreign_workflow_secrets(workflow: dict[str, Any]) -> dict[str, Any]:
    """Every secret a workflow holds that WAVE cannot open, or the placeholder, becomes null."""
    if not isinstance(workflow, dict):
        return workflow
    return transform_setter_node_secrets(workflow, _sanitized)


def _sanitized_declarations(key: str, entries: Any) -> Any:
    return transform_definition_secrets({key: entries}, _sanitized)[key]


def sanitize_secret_variable_list(variables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The list-shaped form for Function local variables: an unusable secret becomes null."""
    held: list[dict[str, Any]] = _sanitized_declarations("variables", variables)
    return held


def sanitize_foreign_definition_secrets(definition: Mapping[str, Any]) -> dict[str, Any]:
    """Every secret a Function definition holds that WAVE cannot open becomes null."""
    return _with_parts(
        definition,
        variables=sanitize_secret_variable_list,
        outputs=partial(_sanitized_declarations, "outputs"),
        workflow=sanitize_foreign_workflow_secrets,
    )


def _sanitized_field(field: str, value: Any, secret_fields: Collection[str]) -> Any:
    if isinstance(value, dict):
        return sanitize_foreign_secret_variables({field: value})[field]
    return _sanitized(value) if field in secret_fields else value


def sanitize_flat_secret_fields(
    values: dict[str, Any], secret_fields: Collection[str]
) -> dict[str, Any]:
    """Profile config or environment values: an unusable credential becomes null."""
    return (
        {field: _sanitized_field(field, value, secret_fields) for field, value in values.items()}
        if isinstance(values, dict)
        else values
    )


def settle_imported_secret_variables(
    variables: dict[str, Any], stored: Mapping[str, Any] | None
) -> dict[str, Any]:
    """Variables an import or a restore writes over ``stored`` (EXPORT-7, REQ-4.5.19)."""
    held = (
        restore_masked_secrets(variables, dict(stored or {}))
        if isinstance(variables, dict)
        else variables
    )
    return sanitize_foreign_secret_variables(held)


def settle_imported_flat_secret_fields(
    values: dict[str, Any], stored: Mapping[str, Any] | None, secret_fields: Collection[str]
) -> dict[str, Any]:
    """Profile config or environment values an import or a restore writes over ``stored``."""
    held = (
        restore_masked_secrets(values, dict(stored or {})) if isinstance(values, dict) else values
    )
    return sanitize_flat_secret_fields(held, secret_fields)


def settle_imported_workflow_secrets(workflow: dict[str, Any], stored: Any) -> dict[str, Any]:
    """A workflow an import or a restore writes over ``stored`` (EXPORT-7, REQ-4.5.19)."""
    return sanitize_foreign_workflow_secrets(restore_masked_workflow_secrets(workflow, stored))


def settle_imported_definition_secrets(
    definition: Mapping[str, Any], stored: Any
) -> dict[str, Any]:
    """A Function definition an import writes over ``stored`` (EXPORT-7, REQ-4.5.19)."""
    return sanitize_foreign_definition_secrets(
        restore_masked_definition_secrets(dict(definition), stored)
    )


def foreign_secret_warning(name: str) -> dict[str, str]:
    """The FOREIGN_ENCRYPTED_SECRET warning entry for one secret name."""
    return {
        "code": "FOREIGN_ENCRYPTED_SECRET",
        "message": (
            f"Secret '{name}' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        ),
    }


def is_foreign_envelope(value: Any) -> bool:
    """True iff the value is a sealed envelope this instance cannot decrypt."""
    if not is_secret_envelope(value):
        return False
    try:
        get_cipher().unseal(value)
    except SecretDecryptionError:
        return True
    return False


def check_foreign_envelopes(variables: Any) -> list[dict[str, str]]:
    """Check secret variables for envelopes sealed by another WAVE instance.

    Scans secret-flagged variable declarations for sealed values that fail
    local decryption, indicating they were exported by a different instance.
    Used during import validation to warn users.

    Args:
        variables: Dict of variable name to variable info, or non-dict
            (returns empty list).

    Returns:
        List of warning dicts with 'code' and 'message' keys.
    """
    if not isinstance(variables, dict):
        return []
    return [
        foreign_secret_warning(var_name)
        for var_name, var_info in variables.items()
        if isinstance(var_info, dict)
        and var_info.get("secret")
        and is_foreign_envelope(var_info.get("value"))
    ]


def check_masked_secrets(variables: Any) -> list[dict[str, str]]:
    """Check for masked secret values in variables.

    Scans variable declarations for values that contain the masked
    placeholder '***', indicating a secret that was exported without
    its real value. Used during import validation to warn users.

    Args:
        variables: Dict of variable name to variable info, or non-dict
            (returns empty list).

    Returns:
        List of warning dicts with 'code' and 'message' keys.
    """
    if not isinstance(variables, dict):
        return []
    return [
        _masked_secret_warning("Variable", var_name)
        for var_name, var_info in variables.items()
        if isinstance(var_info, dict)
        and isinstance(var_info.get("value"), str)
        and var_info["value"] == MASK_PLACEHOLDER
    ]


def variable_value_errors(variables: Any) -> list[dict[str, str]]:
    """Each variable value a save refuses by the number rule, as an import error (REQ-3.1.3.14)."""
    if not isinstance(variables, dict):
        return []
    return [
        {"code": code, "message": message}
        for name, var_info in variables.items()
        if isinstance(var_info, dict)
        for code, message in value_problems(var_info, str(name), kind="variable")
    ]


def refuse_unimportable_items(items: Iterable[Mapping[str, Any]]) -> None:
    """A suite or regression import stops on a nameless item or a refused variable value."""
    for item in items:
        if not item.get("name"):
            raise ValidationException("Fatal validation errors prevent import")
        value_errors = variable_value_errors(item.get("variables", {}))
        if value_errors:
            raise ValidationException(value_errors[0]["message"])


def stored_variable_values(variables: Mapping[str, Any]) -> dict[str, Any]:
    """Variables as a save writes them: each valid typed number in wire form (REQ-3.1.3.14)."""
    return {
        name: (
            declaration_numbers(var_info, kind="variable", form=stored_number)
            if isinstance(var_info, dict)
            else var_info
        )
        for name, var_info in variables.items()
    }


def _masked_secret_warning(noun: str, name: str) -> dict[str, str]:
    return {"code": "MASKED_SECRET", "message": f"{noun} '{name}' contains a masked value"}


def check_flat_secret_fields(values: Any) -> list[dict[str, str]]:
    """Import validation of profile fields: each masked value, then each foreign envelope."""
    if not isinstance(values, dict):
        return []
    held = {
        field: value.get("value") if isinstance(value, dict) else value
        for field, value in values.items()
    }
    return [
        *(
            _masked_secret_warning("Field", field)
            for field, value in held.items()
            if value == MASK_PLACEHOLDER
        ),
        *(
            foreign_secret_warning(field)
            for field, value in held.items()
            if is_foreign_envelope(value)
        ),
    ]


def restore_masked_secrets(submitted: dict[str, Any], existing: dict[str, Any]) -> dict[str, Any]:
    """Preserve a stored secret value when the submitted value is the mask placeholder.

    The frontend echoes a saved secret back as ``MASK_PLACEHOLDER`` (it never holds
    the real value); saving that verbatim would seal the placeholder over the stored
    secret. This swaps each masked secret back to its stored value at every save
    chokepoint, serving both the name-keyed variables shape (``{name: {value, secret}}``)
    and the flat profile-field shape (``{field: value}``). The input is not mutated.

    Args:
        submitted: The incoming variables/config map from the client.
        existing: The currently stored (sealed) map to restore values from.

    Returns:
        A new dict with masked secret entries restored to their stored values.
    """
    restored: dict[str, Any] = {}
    for name, entry in submitted.items():
        if isinstance(entry, dict):
            restored[name] = _restore_dict_entry(entry, existing.get(name))
        elif entry == MASK_PLACEHOLDER and name in existing:
            restored[name] = existing[name]
        else:
            restored[name] = entry
    return restored


def _restore_dict_entry(entry: dict[str, Any], stored_entry: Any) -> dict[str, Any]:
    """Drop ``masked``, swap a placeholder back and keep the entry secret (REQ-3.1.3.5)."""
    entry = {k: v for k, v in entry.items() if k != "masked"}
    if entry.get("value") != MASK_PLACEHOLDER:
        return entry
    stored_is_dict = isinstance(stored_entry, dict)
    secret = entry.get("secret") or (stored_is_dict and stored_entry.get("secret"))
    if secret and stored_is_dict and "value" in stored_entry:
        return {**_with_stored_value(entry, stored_entry), "secret": True}
    return entry


def _with_stored_value(entry: dict[str, Any], stored_entry: dict[str, Any]) -> dict[str, Any]:
    """The echoed entry with the stored value, and its element types while the type holds."""
    restored = {k: v for k, v in entry.items() if k != "elementTypes"}
    restored["value"] = stored_entry["value"]
    if "elementTypes" in stored_entry and entry.get("type") == stored_entry.get("type"):
        restored["elementTypes"] = stored_entry["elementTypes"]
    return restored


def mask_secret_variables(
    variables: dict[str, Any], *, flag_masked: bool = False
) -> dict[str, Any]:
    """Mask ``value`` fields on variables declared with ``secret: true``.

    Shared by suites and regressions to keep secret values out of read
    responses. Non-secret variables are left untouched; a secret holding no
    value is left as it is (nothing to mask).

    Args:
        variables: Mapping of variable name to variable info. Non-dict
            values are passed through unchanged.
        flag_masked: Mark each masked entry with the response-only ``masked`` flag.

    Returns:
        A new dict with masked secret values; original is not mutated.
    """
    if not isinstance(variables, dict):
        return variables
    masked: dict[str, Any] = {}
    for name, var_info in variables.items():
        if isinstance(var_info, dict) and var_info.get("secret"):
            masked[name] = masked_declaration(var_info, flag_masked=flag_masked)
        else:
            masked[name] = var_info
    return masked


def read_secret_variables(variables: dict[str, Any]) -> dict[str, Any]:
    """Reveal-aware read masker for global / regression / suite variable VIEWS
    (never export).

    Identical to :func:`mask_secret_variables` while the system
    ``shared_variables`` reveal flag is off; when it is on, secret values are
    unsealed to plaintext for display. Encryption at rest is unaffected.
    """
    if not isinstance(variables, dict):
        return variables
    reveal = masking_settings.is_shared_variables_revealed()
    result: dict[str, Any] = {}
    for name, var_info in variables.items():
        if not (isinstance(var_info, dict) and var_info.get("secret")):
            result[name] = var_info
        elif "value" not in var_info:
            result[name] = {**var_info}
        elif reveal:
            result[name] = {**var_info, "value": unseal_all(var_info["value"])}
        else:
            result[name] = masked_declaration(var_info)
    return result


# Semantic version pattern: MAJOR.MINOR.PATCH
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


def validate_semantic_version(version: str) -> None:
    """Validate semantic version format (MAJOR.MINOR.PATCH).

    Args:
        version: Version string to validate.

    Raises:
        ValidationException: If version format is invalid.
    """
    if not SEMVER_PATTERN.match(version):
        raise ValidationException(
            f"Invalid version format '{version}': "
            "must follow semantic versioning (MAJOR.MINOR.PATCH)"
        )


def next_semantic_version(version: str, version_bump: str) -> str:
    """The version after ``version`` for a ``major``, ``minor`` or any other (patch) bump.

    Raises:
        ValidationException: If ``version`` is not MAJOR.MINOR.PATCH.
    """
    validate_semantic_version(version)
    major, minor, patch = (int(part) for part in version.split("."))
    if version_bump == "major":
        return f"{major + 1}.0.0"
    if version_bump == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def bump_version_and_record(
    entity: dict[str, Any],
    entity_id: str,
    change_description: str,
    save_entity: Callable[[dict[str, Any]], None],
    load_versions: Callable[[str], list[dict[str, Any]]],
    save_versions: Callable[[str, list[dict[str, Any]]], None],
    extra_fields: dict[str, Any] | None = None,
) -> str:
    """Increment an entity's minor version and record the change in version history.

    Performs a minor version bump (e.g., 1.0.0 -> 1.1.0), updates the entity's
    version and updated_at fields, saves the entity, and appends a version
    history entry.

    Args:
        entity: The entity dict to update (modified in place).
        entity_id: UUID of the entity (for version history storage).
        change_description: Human-readable description of the change.
        save_entity: Callback to persist the updated entity.
        load_versions: Callback to load version history for the entity.
        save_versions: Callback to save version history for the entity.
        extra_fields: Optional additional key/value pairs to merge into the
            appended version history record (e.g. ``{"snapshot": {...}}``
            for regressions). Keys here do not override the core fields
            (version, created_at, created_by, changes).

    Returns:
        The ISO-formatted timestamp of the update.

    Raises:
        ValidationException: If the stored version is not MAJOR.MINOR.PATCH;
            nothing is saved then.
    """
    new_version = next_semantic_version(str(entity.get("version", "1.0.0")), "minor")

    now = datetime.now(UTC).isoformat()
    entity["version"] = new_version
    entity["updated_at"] = now

    save_entity(entity)

    versions = load_versions(entity_id)
    version_record: dict[str, Any] = {
        "version": new_version,
        "created_at": now,
        "created_by": "system",
        "changes": change_description,
    }
    if extra_fields:
        for key, value in extra_fields.items():
            if key not in version_record:
                version_record[key] = value
    versions.append(version_record)
    save_versions(entity_id, versions)

    return now


def resolve_entities_by_ids(
    entity_ids: list[str],
    get_entity: Callable[[str], dict[str, Any] | None],
) -> list[dict[str, Any]]:
    """Resolve entities by their IDs, returning id/name dicts.

    Args:
        entity_ids: List of entity UUIDs to look up.
        get_entity: Callable that retrieves an entity by ID, returning
            None if not found.

    Returns:
        List of dicts with 'id' and 'name' keys for each found entity.
    """
    results: list[dict[str, Any]] = []
    for entity_id in entity_ids:
        entity = get_entity(entity_id)
        if entity:
            results.append({"id": entity["id"], "name": entity.get("name", "")})
    return results


def refuse_unknown_members(
    proposed: Iterable[Any],
    held: Collection[str],
    kind: str,
    exists: Callable[[str], bool],
) -> None:
    """Refuse the first member a save adds that matches nothing; a held member is not re-checked."""
    for member_id in proposed:
        if not isinstance(member_id, str) or (member_id not in held and not exists(member_id)):
            raise ValidationException(f"{kind} with ID '{member_id}' not found")


_NOT_AN_OBJECT_ITEM = "The item must be a JSON object"
_NOT_AN_UPDATE_OBJECT = "'update' must be a JSON object"


def batch_object(item: Any) -> dict[str, Any]:
    """A batch item as a JSON object; any other item fails on its own."""
    if not isinstance(item, dict):
        raise ValidationException(_NOT_AN_OBJECT_ITEM)
    return item


def batch_update_problem(item: Any) -> str | None:
    """Why a batch update item fails: not an object, or an 'update' that is not one; else None."""
    if not isinstance(item, dict):
        return _NOT_AN_OBJECT_ITEM
    if not isinstance(item.get("update", {}), dict):
        return _NOT_AN_UPDATE_OBJECT
    return None


def batch_update_fields(item: dict[str, Any]) -> dict[str, Any]:
    """A batch item's 'update' as a JSON object, empty when absent; else the item fails."""
    problem = batch_update_problem(item)
    if problem is not None:
        raise ValidationException(problem)
    fields: dict[str, Any] = item.get("update", {})
    return fields


def batch_id(item: Any) -> str:
    """A batch item as an ID string; any other item fails on its own."""
    if not isinstance(item, str):
        raise ValidationException("The item must be an ID string")
    return item


def _batch_each[
    Done
](ids: Sequence[Any], act: Callable[[str], Done | None], kind: str) -> tuple[
    list[Done], list[dict[str, Any]]
]:
    """Act on each ID in turn; a malformed, missing (None) or refused one fails by its index."""
    done: list[Done] = []
    failed: list[dict[str, Any]] = []
    for idx, item in enumerate(ids):
        try:
            item_id = batch_id(item)
            result = act(item_id)
        except (ValueError, WaveException) as e:
            failed.append({"index": idx, "error": str(e)})
            continue
        if result is None:
            failed.append({"index": idx, "error": f"{kind} with ID '{item_id}' not found"})
        else:
            done.append(result)
    return done, failed


def batch_delete(ids: Sequence[Any], delete: Callable[[str], bool], kind: str) -> dict[str, Any]:
    """Delete each ID in turn; a missing, refused or malformed one goes to ``failed``."""
    deleted, failed = _batch_each(ids, lambda item_id: item_id if delete(item_id) else None, kind)
    return {"deleted": deleted, "failed": failed}


def batch_clone(
    ids: Sequence[Any], clone: Callable[[str], dict[str, Any] | None], kind: str
) -> dict[str, Any]:
    """Clone each ID in turn; a missing, refused or malformed one goes to ``failed``."""

    def clone_one(item_id: str) -> dict[str, str] | None:
        copied = clone(item_id)
        return None if copied is None else {"original_id": item_id, "cloned_id": copied["id"]}

    cloned, failed = _batch_each(ids, clone_one, kind)
    return {"cloned": cloned, "failed": failed}


ZipContent = str | bytes | Path


@overload
def build_export_zip(files: Sequence[tuple[str, ZipContent]], *, sink: None = None) -> bytes: ...


@overload
def build_export_zip(files: Sequence[tuple[str, ZipContent]], *, sink: BinaryIO) -> None: ...


def build_export_zip(
    files: Sequence[tuple[str, ZipContent]], *, sink: BinaryIO | None = None
) -> bytes | None:
    """Assemble a deflate-compressed ZIP archive from (archive name, content) pairs.

    Single source for every ZIP the product builds: bulk exports, the test
    export archive, the artifacts zip and the test data zip.

    Args:
        files: (archive name, content) pairs; a ``str`` or ``bytes`` content is
            written inline, a ``Path`` content is written straight from disk.
        sink: Optional binary stream that receives the archive instead of the
            bytes return.

    Returns:
        The complete ZIP archive as raw bytes, or None when a sink was given.
    """
    if sink is not None:
        _write_zip(sink, files)
        return None
    buf = io.BytesIO()
    _write_zip(buf, files)
    return buf.getvalue()


def _write_zip(target: BinaryIO, files: Sequence[tuple[str, ZipContent]]) -> None:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, content in files:
            if isinstance(content, Path):
                zf.write(content, filename)
            else:
                zf.writestr(filename, content)


def unencodable_file_message(raw: bytes | str, document: Any) -> str | None:
    """Why an imported file is refused for text UTF-8 cannot write, or None (REQ-4.6.9)."""
    where = unencodable_place(raw, document, "the file")
    if where is None:
        return None
    return (
        f"The file has a character at {where} that cannot be encoded as UTF-8, "
        "so it was not imported: remove or replace it"
    )


def refuse_unencodable_file(raw: bytes | str, document: Any) -> None:
    """Refuse an imported file that holds text UTF-8 cannot write (REQ-4.6.9)."""
    message = unencodable_file_message(raw, document)
    if message is not None:
        raise ValidationException(message)


def parse_file(content: bytes, filename: str) -> dict[str, Any]:
    """Parse a YAML or JSON file into a dict.

    Args:
        content: Raw file content bytes.
        filename: Name of the file (used to determine format by extension).

    Returns:
        Parsed dictionary.

    Raises:
        ValueError: If the file cannot be parsed or doesn't contain a mapping.
    """
    lower = filename.lower()
    try:
        if lower.endswith(".json"):
            data = json.loads(content)
        else:
            data = load_yaml(content)
    except Exception as e:
        raise ValidationException(
            f"Invalid {'JSON' if lower.endswith('.json') else 'YAML'}: could not parse file"
        ) from e
    refuse_unencodable_file(content, data)
    if not isinstance(data, dict):
        raise ValidationException("File must contain a mapping/object")
    return data


def parse_zip_file(
    content: bytes,
    *,
    parse: Callable[[bytes, str], dict[str, Any]] = parse_file,
    error: type[Exception] = ValidationException,
    skip_dunder: bool = False,
    claim_member: Callable[[zipfile.ZipFile, str], bool] | None = None,
) -> list[tuple[str, dict[str, Any]]]:
    """Parse a ZIP file containing YAML/JSON files.

    Single source for every import archive the product reads.

    Args:
        content: Raw ZIP file bytes.
        parse: Per-document parser, given the member bytes and its name.
        error: Exception class raised for a bad archive or an empty one.
        skip_dunder: Ignore members whose name starts with '__' (archiver
            metadata such as __MACOSX).
        claim_member: Hook run for each member before the document scan;
            returning True consumes the member so it is never a document.

    Returns:
        List of (filename, parsed_data) tuples for each importable file.

    Raises:
        Exception: The ``error`` class, if the ZIP is invalid or contains no
            importable files.
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as e:
        raise error("Invalid ZIP archive") from e
    results: list[tuple[str, dict[str, Any]]] = []
    for name in zf.namelist():
        if claim_member is not None and claim_member(zf, name):
            continue
        if skip_dunder and name.startswith("__"):
            continue
        if name.lower().endswith((".yaml", ".yml", ".json")):
            results.append((name, parse(zf.read(name), name)))
    if not results:
        raise error("ZIP archive contains no importable files")
    return results


def determine_import_item_status(
    name: str,
    has_fatal: bool,
    fixable_errors: list[dict[str, str]],
    existing_names: dict[str, str],
) -> tuple[str, str | None]:
    """Determine the validation status of an import item.

    Shared logic used by both profile and suite import validation.

    Args:
        name: The name of the item being imported.
        has_fatal: Whether the item has fatal validation errors.
        fixable_errors: List of fixable error dicts.
        existing_names: Map of existing entity names to their IDs.

    Returns:
        Tuple of (status_string, existing_entity_id_or_none).
    """
    if has_fatal:
        return "fatal", None
    if name and name in existing_names:
        return "conflict", existing_names[name]
    if fixable_errors:
        return "fixable", None
    return "ok", None


def _as_written(name: str) -> str:
    return name


def first_free_name(
    base: str,
    taken: Iterable[str],
    *,
    max_length: int | None = None,
    normalize: Callable[[str], str] | None = None,
) -> str:
    """`base` when it is free, else the first free of `<base> (2)`, `<base> (3)`, ..."""
    compare = normalize or _as_written
    used = {compare(name) for name in taken}
    if compare(base) not in used:
        return base
    counter = 2
    while True:
        suffix = f" ({counter})"
        stem = base if max_length is None else base[: max_length - len(suffix)]
        if compare(f"{stem}{suffix}") not in used:
            return f"{stem}{suffix}"
        counter += 1


@dataclass(frozen=True)
class ItemTarget:
    """How an incoming item matches the items here and where it lands."""

    conflict: str | None
    action: str | None = None
    target_id: str | None = None
    target_name: str | None = None
    blocked: str | None = None


def _conflict_kind(same_id: str | None, same_name: list[str]) -> str | None:
    if same_id and same_name:
        return "both"
    if same_id:
        return "id"
    return "name" if same_name else None


def _overwrite_refusal(same_id: str | None, same_name: list[str], written: bool) -> str | None:
    if same_id and any(holder != same_id for holder in same_name):
        return "NAME_TAKEN"
    if written:
        return "SAME_RUN"
    return "AMBIGUOUS_NAME" if not same_id and len(same_name) > 1 else None


def decide_item_target(
    *,
    source_id: str | None,
    name: str,
    resolution: str | None,
    names_by_id: Mapping[str, str],
    written_ids: Collection[str],
    normalize: Callable[[str], str] | None = None,
    max_name_length: int | None = None,
) -> ItemTarget:
    """The match of one incoming item and, under a resolution, its action, id and name."""
    compare = normalize or _as_written
    wanted = compare(name)
    same_id = source_id if source_id and source_id in names_by_id else None
    same_name = [item_id for item_id, held in names_by_id.items() if compare(held) == wanted]
    conflict = _conflict_kind(same_id, same_name)
    if resolution is None:
        return ItemTarget(conflict, target_name=name)
    if conflict is None:
        return ItemTarget(None, "create", source_id or str(uuid.uuid4()), name)
    target_id = same_id or same_name[0]
    if resolution == "overwrite":
        blocked = _overwrite_refusal(same_id, same_name, target_id in written_ids)
        if blocked:
            return ItemTarget(conflict, "blocked", blocked=blocked)
        return ItemTarget(conflict, "overwrite", target_id, name)
    if resolution == "rename":
        free_id = source_id if source_id and not same_id else str(uuid.uuid4())
        free_name = first_free_name(
            name, names_by_id.values(), max_length=max_name_length, normalize=normalize
        )
        return ItemTarget(conflict, "rename", free_id, free_name)
    return ItemTarget(conflict, "skip", target_id)
