"""Regression import and export operations."""

import copy
import json
import uuid
from datetime import UTC, datetime
from typing import Any

import yaml

from wavecore.api.exceptions import NotFoundException
from wavecore.api.services.regressions import _storage
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.regressions.variable_validation import (
    check_variable_collisions_for_regression,
)
from wavecore.api.services.shared import (
    ImportMembers,
    apply_secrets_mode_to_variables,
    check_foreign_envelopes,
    check_masked_secrets,
    determine_import_item_status,
    export_file_stem,
    first_free_name,
    member_list_error,
    parse_file,
    parse_zip_file,
    record_import_fixes,
    refuse_import_collisions,
    refuse_unimportable_items,
    settle_imported_secret_variables,
    strip_import_members,
    variable_value_errors,
)


def _now_iso() -> str:
    """Get current timestamp in ISO format."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _sanitize_filename(name: str) -> str:
    """Sanitize a name for use as a filename."""
    return export_file_stem(name, "regression")


def _generate_unique_name(base_name: str) -> str:
    """Generate a unique name by appending (2), (3), etc."""
    return first_free_name(base_name, {r["name"] for r in _storage._list_all_regressions()})


def export_regression(
    regression_id: str, fmt: str = "yaml", secrets: str = "mask"
) -> tuple[str, str] | None:
    """Export a single regression as serialized content.

    Returns (content_string, filename) or None if not found.
    """
    regression = _storage._load_regression(regression_id)
    if regression is None:
        return None

    export_data = copy.deepcopy(regression)
    export_data["variables"] = apply_secrets_mode_to_variables(
        export_data.get("variables", {}), secrets
    )

    filename_base = _sanitize_filename(export_data["name"])
    if fmt == "json":
        content = json.dumps(export_data, indent=2)
        filename = f"{filename_base}.json"
    else:
        content = yaml.dump(export_data, default_flow_style=False, sort_keys=False)
        filename = f"{filename_base}.yaml"

    return content, filename


def export_regressions_batch(
    regression_ids: list[str], fmt: str = "yaml", secrets: str = "mask"
) -> list[tuple[str, str, str]]:
    """Export multiple regressions.

    Returns list of (regression_id, content_string, filename).
    Raises NotFoundException if any regression not found.
    """
    results: list[tuple[str, str, str]] = []
    used_filenames: set[str] = set()

    for regression_id in regression_ids:
        result = export_regression(regression_id, fmt, secrets)
        if result is None:
            raise NotFoundException(f"Regression not found: {regression_id}")

        content, filename = result

        if filename in used_filenames:
            base, ext = filename.rsplit(".", 1)
            counter = 2
            while f"{base}-{counter}.{ext}" in used_filenames:
                counter += 1
            filename = f"{base}-{counter}.{ext}"
        used_filenames.add(filename)

        results.append((regression_id, content, filename))

    return results


def _parse_import_items(content: bytes, filename: str) -> list[dict[str, Any]]:
    """Parse import file content into a list of regression data dicts."""
    if filename.lower().endswith(".zip"):
        entries = parse_zip_file(content)
        return [data for _, data in entries]
    return [parse_file(content, filename)]


def _get_existing_names_map() -> dict[str, str]:
    """Build a map of existing regression names to their IDs."""
    return {r["name"]: r["id"] for r in _storage._list_all_regressions()}


def _import_suites(item: dict[str, Any]) -> ImportMembers:
    """The suites an imported regression keeps, and each one stripped as a fix."""
    return strip_import_members(item, _storage._suite_exists, "Suite")


def _validate_single_import_item(
    item: dict[str, Any],
    existing_names: dict[str, str],
) -> dict[str, Any]:
    """Validate a single regression item for import."""
    name = item.get("name", "")
    fatal_errors: list[dict[str, str]] = []
    has_fatal = False

    if not name:
        fatal_errors.append({"code": "MISSING_NAME", "message": "Regression must have a name"})
        has_fatal = True

    value_errors = variable_value_errors(item.get("variables", {}))
    if value_errors:
        fatal_errors.extend(value_errors)
        has_fatal = True

    member_error = member_list_error(item, "Suite")
    if member_error:
        fatal_errors.append(member_error)
        has_fatal = True

    # Check variable type collisions between regression vars and suite vars
    members = _import_suites(item)
    proposed_vars = item.get("variables", {})
    if members.kept and proposed_vars and not has_fatal:
        collisions = check_variable_collisions_for_regression(
            suite_ids=members.kept,
            variable_names_to_check=list(proposed_vars.keys()),
            proposed_variables=proposed_vars,
        )
        if collisions:
            collision_desc = "; ".join(
                f"'{c['variable']}' is '{c['this_type']}' here but "
                f"'{c['other_type']}' in suite '{c['other_suite']}'"
                for c in collisions
            )
            fatal_errors.append(
                {
                    "code": "VARIABLE_TYPE_COLLISION",
                    "message": f"Variable type collision: {collision_desc}",
                }
            )
            has_fatal = True

    fixable_errors = members.findings
    variables = item.get("variables", {})
    warnings = [*check_masked_secrets(variables), *check_foreign_envelopes(variables)]

    item_status, existing_regression_id = determine_import_item_status(
        name, has_fatal, fixable_errors, existing_names
    )

    return {
        "name": name or "",
        "status": item_status,
        "fatal_errors": fatal_errors,
        "fixable_errors": fixable_errors,
        "warnings": warnings,
        "existing_regression_id": existing_regression_id,
    }


def validate_regression_import(content: bytes, filename: str) -> dict[str, Any]:
    """Validate file content for regression import without persisting."""
    items = _parse_import_items(content, filename)
    existing_names = _get_existing_names_map()

    regressions = [_validate_single_import_item(item, existing_names) for item in items]

    blocked = sum(1 for r in regressions if r["status"] == "fatal")
    importable = len(regressions) - blocked

    return {
        "regressions": regressions,
        "total": len(items),
        "importable": importable,
        "blocked": blocked,
    }


def _build_import_regression_data(
    regression_id: str,
    name: str,
    item: dict[str, Any],
    resolved_suites: list[str],
    now: str,
) -> dict[str, Any]:
    """Build a regression data dict from an import item."""
    regression_data: dict[str, Any] = {
        "id": regression_id,
        "name": name,
        "version": "1.0.0",
        "description": item.get("description", ""),
        "suites": resolved_suites,
        "tags": item.get("tags", []),
        "variables": settle_imported_secret_variables(
            item.get("variables", {}),
            (_storage._load_regression(regression_id) or {}).get("variables"),
        ),
        "metadata": item.get("metadata", {}),
        "created_at": now,
        "updated_at": now,
    }
    return regression_data


def _import_history(regression_data: dict[str, Any]) -> list[dict[str, Any]]:
    """The one history row an imported regression starts with."""
    return [
        {
            "version": "1.0.0",
            "created_at": regression_data["created_at"],
            "created_by": "import",
            "changes": "Imported regression",
        }
    ]


def _import_existing_item(
    name: str,
    resolution: str,
    existing_id: str,
    item: dict[str, Any],
    resolved_suites: list[str],
    now: str,
    existing_names: dict[str, str],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Handle import of an item whose name conflicts with an existing regression."""
    if resolution == "skip":
        return None, {"name": name, "reason": "skipped by user"}

    if resolution == "overwrite":
        regression_data = _build_import_regression_data(
            existing_id, name, item, resolved_suites, now
        )
        regression_service.persist_regression_document(
            regression_data, _import_history(regression_data)
        )
        return {"name": name, "id": existing_id, "action": "overwritten"}, None

    new_name = _generate_unique_name(name)
    new_id = str(uuid.uuid4())
    regression_data = _build_import_regression_data(new_id, new_name, item, resolved_suites, now)
    regression_service.persist_regression_document(
        regression_data, _import_history(regression_data)
    )
    existing_names[new_name] = new_id
    return {"name": new_name, "id": new_id, "action": "renamed"}, None


def _check_import_collisions(items: list[dict[str, Any]], members: list[ImportMembers]) -> None:
    """Refuse the import when an item's variables collide in type with its Suites' variables."""
    refuse_import_collisions(
        items,
        members,
        lambda suite_ids, variables: check_variable_collisions_for_regression(
            suite_ids=suite_ids,
            variable_names_to_check=list(variables),
            proposed_variables=variables,
        ),
    )


def import_regressions(
    content: bytes,
    filename: str,
    conflict_resolutions: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Import regressions from file content."""
    resolutions = conflict_resolutions or {}

    items = _parse_import_items(content, filename)
    refuse_unimportable_items(items, "Suite")
    members = [_import_suites(item) for item in items]
    _check_import_collisions(items, members)

    existing_names = _get_existing_names_map()

    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    fixes_applied: list[dict[str, Any]] = []

    for item, item_members in zip(items, members, strict=True):
        name = item["name"]

        resolved_suites, item_fixes = item_members.kept, item_members.fixes
        now = _now_iso()

        if name in existing_names:
            imported_entry, skipped_entry = _import_existing_item(
                name,
                resolutions.get(name, "rename"),
                existing_names[name],
                item,
                resolved_suites,
                now,
                existing_names,
            )
            if skipped_entry:
                skipped.append(skipped_entry)
                record_import_fixes(fixes_applied, item_fixes, name)
                continue
            if imported_entry:
                imported.append(imported_entry)
                record_import_fixes(fixes_applied, item_fixes, imported_entry["name"])
                continue

        new_id = str(uuid.uuid4())
        regression_data = _build_import_regression_data(new_id, name, item, resolved_suites, now)
        regression_service.persist_regression_document(
            regression_data, _import_history(regression_data)
        )
        existing_names[name] = new_id
        imported.append({"name": name, "id": new_id, "action": "created"})
        record_import_fixes(fixes_applied, item_fixes, name)

    return {
        "imported": imported,
        "skipped": skipped,
        "fixes_applied": fixes_applied,
        "total_imported": len(imported),
        "total_skipped": len(skipped),
    }
