"""Profile import and export operations."""

import copy
import json
import uuid
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.api.services.profiles import _common as _profile_common
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.profiles._common import (
    VALID_PROFILE_TYPES,
    _cached_profile,
    _generate_unique_name,
    _mask_environment_values,
    _mask_secrets,
    _now_iso,
    _reconcile_cache,
    _sanitize_filename,
    document_problem,
    secret_field_names,
    stored_document,
)
from wavecore.api.services.shared import (
    check_flat_secret_fields,
    determine_import_item_status,
    parse_file,
    parse_zip_file,
    settle_imported_flat_secret_fields,
)
from wavecore.core.secrets.cipher import SecretDecryptionError
from wavecore.core.secrets.sealing import unseal_all


def apply_secrets_mode_to_profile(data: dict[str, Any], secrets: str) -> dict[str, Any]:
    """Copy a profile dict with the secrets mode applied to its credential fields.

    'mask' applies the per-type credential masking to config and environment
    values, 'encrypted' emits the stored envelopes verbatim, 'plaintext'
    decrypts every envelope.

    Raises:
        ConflictException: In plaintext mode, when the encryption key is
            missing/invalid or an envelope cannot be decrypted.
    """
    result = dict(data)
    if secrets == "mask":
        result["config"] = _mask_secrets(result.get("config", {}), result["type"])
        if "environment_values" in result:
            result["environment_values"] = _mask_environment_values(
                result["environment_values"], result["type"]
            )
    elif secrets == "plaintext":
        try:
            result["config"] = unseal_all(result.get("config", {}))
            if "environment_values" in result:
                result["environment_values"] = unseal_all(result["environment_values"])
        except (ValueError, SecretDecryptionError) as e:
            raise ConflictException(str(e)) from e
    return result


def export_profile(
    profile_id: str, fmt: str = "yaml", secrets: str = "mask"
) -> tuple[str, str] | None:
    """Export a single profile as serialized content.

    Returns (content_string, filename) or None if not found.
    """
    profile = _cached_profile(profile_id)
    if profile is None:
        return None

    export_data = apply_secrets_mode_to_profile(copy.deepcopy(profile), secrets)

    if "environment_values" in export_data and export_data["environment_values"]:
        from wavecore.api.services.environments import service as environment_service

        env_names_list = environment_service.list_environment_names()
        id_to_name: dict[str, str] = {e["id"]: e["name"] for e in env_names_list}

        renamed_env_values: dict[str, Any] = {}
        for env_id, env_config in export_data["environment_values"].items():
            env_name = id_to_name.get(env_id, env_id)
            renamed_env_values[env_name] = env_config
        export_data["environment_values"] = renamed_env_values

    filename_base = _sanitize_filename(export_data["name"])
    if fmt == "json":
        content = json.dumps(export_data, indent=2)
        filename = f"{filename_base}.json"
    else:
        content = yaml.dump(export_data, default_flow_style=False, sort_keys=False)
        filename = f"{filename_base}.yaml"

    return content, filename


def export_profiles_batch(
    profile_ids: list[str], fmt: str = "yaml", secrets: str = "mask"
) -> list[tuple[str, str, str]]:
    """Export multiple profiles.

    Returns list of (profile_id, content_string, filename).
    Raises ValueError if any profile not found.
    """
    results: list[tuple[str, str, str]] = []
    used_filenames: set[str] = set()

    for profile_id in profile_ids:
        result = export_profile(profile_id, fmt, secrets)
        if result is None:
            raise NotFoundException(f"Profile not found: {profile_id}")

        content, filename = result

        if filename in used_filenames:
            base, ext = filename.rsplit(".", 1)
            counter = 2
            while f"{base}-{counter}.{ext}" in used_filenames:
                counter += 1
            filename = f"{base}-{counter}.{ext}"
        used_filenames.add(filename)

        results.append((profile_id, content, filename))

    return results


def _parse_import_items(content: bytes, filename: str) -> list[dict[str, Any]]:
    """Parse import file content into a list of profile data dicts."""
    if filename.lower().endswith(".zip"):
        entries = parse_zip_file(content)
        return [data for _, data in entries]
    return [parse_file(content, filename)]


def _get_existing_names_map() -> dict[str, str]:
    """Build a map of existing profile names to their IDs."""
    return {p["name"]: p["id"] for p in _profile_common._profile_storage.values()}


def _get_env_name_to_id_map() -> dict[str, str]:
    """Build a map of environment names to their IDs."""
    from wavecore.api.services.environments import service as environment_service

    return {e["name"]: e["id"] for e in environment_service.list_environment_names()}


def _check_import_type_errors(
    profile_type: str,
) -> list[dict[str, str]]:
    """Check for type-related fixable errors on an import item."""
    if not profile_type:
        return [
            {"code": "MISSING_TYPE", "message": "Profile type missing, will default to 'custom'"}
        ]
    if profile_type not in VALID_PROFILE_TYPES:
        return [
            {
                "code": "INVALID_TYPE",
                "message": f"Unknown profile type '{profile_type}', will default to 'custom'",
            }
        ]
    return []


def _check_import_env_errors(
    env_values: dict[str, Any],
    env_name_to_id: dict[str, str],
) -> list[dict[str, str]]:
    """Check for unresolvable environment references on an import item."""
    return [
        {
            "code": "UNRESOLVABLE_ENVIRONMENT",
            "message": f"Environment '{env_name}' not found, will be stripped",
        }
        for env_name in env_values
        if env_name not in env_name_to_id
    ]


def _validate_single_import_item(
    item: dict[str, Any],
    existing_names: dict[str, str],
    env_name_to_id: dict[str, str],
) -> dict[str, Any]:
    """Validate a single profile item for import."""
    name = item.get("name", "")
    fatal_errors: list[dict[str, str]] = []
    has_fatal = False

    if not name:
        fatal_errors.append({"code": "MISSING_NAME", "message": "Profile must have a name"})
        has_fatal = True
    problem = document_problem(item, _fix_import_type(item)[0])
    if problem is not None:
        fatal_errors.append({"code": "INVALID_VALUE", "message": problem})
        has_fatal = True

    fixable_errors = _check_import_type_errors(item.get("type", ""))
    fixable_errors.extend(
        _check_import_env_errors(item.get("environment_values", {}), env_name_to_id)
    )
    warnings = check_flat_secret_fields(item.get("config", {}))

    item_status, existing_profile_id = determine_import_item_status(
        name, has_fatal, fixable_errors, existing_names
    )

    return {
        "name": name or "",
        "status": item_status,
        "fatal_errors": fatal_errors,
        "fixable_errors": fixable_errors,
        "warnings": warnings,
        "existing_profile_id": existing_profile_id,
    }


def validate_profile_import(content: bytes, filename: str) -> dict[str, Any]:
    """Validate file content for profile import without persisting."""
    _reconcile_cache()

    items = _parse_import_items(content, filename)
    existing_names = _get_existing_names_map()
    env_name_to_id = _get_env_name_to_id_map()

    profiles = [
        _validate_single_import_item(item, existing_names, env_name_to_id) for item in items
    ]

    blocked = sum(1 for p in profiles if p["status"] == "fatal")
    importable = len(profiles) - blocked

    return {
        "profiles": profiles,
        "total": len(items),
        "importable": importable,
        "blocked": blocked,
    }


def _fix_import_type(item: dict[str, Any]) -> tuple[str, list[str]]:
    """Normalize the profile type of an import item, recording any fixes applied."""
    profile_type = item.get("type", "")
    if profile_type and profile_type in VALID_PROFILE_TYPES:
        return profile_type, []
    if not profile_type:
        return "custom", ["Type defaulted to 'custom'"]
    return "custom", [f"Type '{profile_type}' defaulted to 'custom'"]


def _resolve_import_env_values(
    env_values: dict[str, Any],
    env_name_to_id: dict[str, str],
) -> tuple[dict[str, Any], list[str]]:
    """Resolve environment name references to IDs, recording fixes for unresolvable ones."""
    resolved: dict[str, Any] = {}
    fixes: list[str] = []
    for env_name, env_config in env_values.items():
        if env_name in env_name_to_id:
            resolved[env_name_to_id[env_name]] = env_config
        else:
            fixes.append(f"Stripped unresolvable environment '{env_name}'")
    return resolved, fixes


def settle_imported_profile_secrets(
    profile_data: dict[str, Any], stored: dict[str, Any] | None
) -> None:
    """A profile an import or a restore writes over ``stored``: a placeholder keeps the
    credential stored at its place, else it and one WAVE cannot open become null."""
    fields = secret_field_names(str(profile_data.get("type") or ""))
    here = stored or {}
    if "config" in profile_data:
        profile_data["config"] = settle_imported_flat_secret_fields(
            profile_data["config"], here.get("config"), fields
        )
    environments = profile_data.get("environment_values")
    if isinstance(environments, dict):
        kept = here.get("environment_values") or {}
        profile_data["environment_values"] = {
            environment_id: settle_imported_flat_secret_fields(
                values, kept.get(environment_id), fields
            )
            for environment_id, values in environments.items()
        }


def _build_import_profile_data(
    profile_id: str,
    name: str,
    profile_type: str,
    item: dict[str, Any],
    resolved_env_values: dict[str, Any],
    now: str,
) -> dict[str, Any]:
    """Build a profile data dict from an import item, written over the profile stored here."""
    profile_data: dict[str, Any] = stored_document(
        {
            "id": profile_id,
            "name": name,
            "type": profile_type,
            "config": item.get("config", {}),
            "environment_values": resolved_env_values,
            "tags": item.get("tags", []),
            "created_at": now,
            "updated_at": now,
        },
        profile_type,
    )
    if item.get("description") is not None:
        profile_data["description"] = item["description"]
    settle_imported_profile_secrets(profile_data, _profile_common._profile_storage.get(profile_id))
    return profile_data


def _import_existing_item(
    name: str,
    resolution: str,
    existing_id: str,
    profile_type: str,
    item: dict[str, Any],
    resolved_env_values: dict[str, Any],
    now: str,
    existing_names: dict[str, str],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Handle import of an item whose name conflicts with an existing profile."""
    if resolution == "skip":
        return None, {"name": name, "reason": "skipped by user"}

    if resolution == "overwrite":
        profile_data = _build_import_profile_data(
            existing_id, name, profile_type, item, resolved_env_values, now
        )
        profile_service.persist_profile_document(profile_data)
        return {"name": name, "id": existing_id, "action": "overwritten"}, None

    new_name = _generate_unique_name(name)
    new_id = str(uuid.uuid4())
    profile_data = _build_import_profile_data(
        new_id, new_name, profile_type, item, resolved_env_values, now
    )
    profile_service.persist_profile_document(profile_data)
    existing_names[new_name] = new_id
    return {"name": new_name, "id": new_id, "action": "renamed"}, None


def _record_fixes(
    fixes_applied: list[dict[str, Any]],
    item_fixes: list[str],
    result_name: str,
) -> None:
    """Record applied fixes if any exist."""
    if item_fixes:
        fixes_applied.append({"name": result_name, "fixes": item_fixes})


def import_profiles(
    content: bytes,
    filename: str,
    conflict_resolutions: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Import profiles from file content."""
    _reconcile_cache()
    resolutions = conflict_resolutions or {}

    items = _parse_import_items(content, filename)

    for item in items:
        if not item.get("name"):
            raise ValidationException("Fatal validation errors prevent import")
        problem = document_problem(item, _fix_import_type(item)[0])
        if problem is not None:
            raise ValidationException(problem)

    existing_names = _get_existing_names_map()
    env_name_to_id = _get_env_name_to_id_map()

    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    fixes_applied: list[dict[str, Any]] = []

    for item in items:
        name = item["name"]

        profile_type, type_fixes = _fix_import_type(item)
        resolved_env_values, env_fixes = _resolve_import_env_values(
            item.get("environment_values", {}), env_name_to_id
        )
        item_fixes = type_fixes + env_fixes
        now = _now_iso()

        if name in existing_names:
            imported_entry, skipped_entry = _import_existing_item(
                name,
                resolutions.get(name, "rename"),
                existing_names[name],
                profile_type,
                item,
                resolved_env_values,
                now,
                existing_names,
            )
            if skipped_entry:
                skipped.append(skipped_entry)
                _record_fixes(fixes_applied, item_fixes, name)
                continue
            if imported_entry:
                imported.append(imported_entry)
                _record_fixes(fixes_applied, item_fixes, imported_entry["name"])
                continue

        new_id = str(uuid.uuid4())
        profile_data = _build_import_profile_data(
            new_id, name, profile_type, item, resolved_env_values, now
        )
        profile_service.persist_profile_document(profile_data)
        existing_names[name] = new_id
        imported.append({"name": name, "id": new_id, "action": "created"})
        _record_fixes(fixes_applied, item_fixes, name)

    return {
        "imported": imported,
        "skipped": skipped,
        "fixes_applied": fixes_applied,
        "total_imported": len(imported),
        "total_skipped": len(skipped),
    }
