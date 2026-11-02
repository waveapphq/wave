"""Suite import and export operations."""

import copy
import json
import uuid
from datetime import UTC, datetime
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException, NotFoundException
from wavecore.api.services.shared import (
    apply_secrets_mode_to_variables,
    check_foreign_envelopes,
    check_masked_secrets,
    determine_import_item_status,
    export_file_stem,
    first_free_name,
    parse_file,
    parse_zip_file,
    refuse_unimportable_items,
    settle_imported_secret_variables,
    variable_value_errors,
)
from wavecore.api.services.suites import _storage
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.suites.variable_validation import (
    check_variable_collisions_for_tests,
)


def _now_iso() -> str:
    """Get current timestamp in ISO format."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _sanitize_filename(name: str) -> str:
    """Sanitize a name for use as a filename."""
    return export_file_stem(name, "suite")


def _generate_unique_name(base_name: str) -> str:
    """Generate a unique name by appending (2), (3), etc."""
    return first_free_name(base_name, {s["name"] for s in _storage._list_all_suites()})


def export_suite(suite_id: str, fmt: str = "yaml", secrets: str = "mask") -> tuple[str, str] | None:
    """Export a single suite as serialized content.

    Returns (content_string, filename) or None if not found.
    """
    suite = _storage._load_suite(suite_id)
    if suite is None:
        return None

    export_data = copy.deepcopy(suite)
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


def export_suites_batch(
    suite_ids: list[str], fmt: str = "yaml", secrets: str = "mask"
) -> list[tuple[str, str, str]]:
    """Export multiple suites.

    Returns list of (suite_id, content_string, filename).
    Raises NotFoundException if any suite not found.
    """
    results: list[tuple[str, str, str]] = []
    used_filenames: set[str] = set()

    for suite_id in suite_ids:
        result = export_suite(suite_id, fmt, secrets)
        if result is None:
            raise NotFoundException(f"Suite not found: {suite_id}")

        content, filename = result

        if filename in used_filenames:
            base, ext = filename.rsplit(".", 1)
            counter = 2
            while f"{base}-{counter}.{ext}" in used_filenames:
                counter += 1
            filename = f"{base}-{counter}.{ext}"
        used_filenames.add(filename)

        results.append((suite_id, content, filename))

    return results


def _parse_import_items(content: bytes, filename: str) -> list[dict[str, Any]]:
    """Parse import file content into a list of suite data dicts."""
    if filename.lower().endswith(".zip"):
        entries = parse_zip_file(content)
        return [data for _, data in entries]
    return [parse_file(content, filename)]


def _get_existing_names_map() -> dict[str, str]:
    """Build a map of existing suite names to their IDs."""
    return {s["name"]: s["id"] for s in _storage._list_all_suites()}


def _check_unresolvable_tests(test_ids: list[str]) -> list[dict[str, str]]:
    """Check for test IDs that don't exist in the system."""
    return [
        {
            "code": "UNRESOLVABLE_TEST",
            "message": f"Test '{test_id}' not found, will be stripped",
        }
        for test_id in test_ids
        if not _storage._test_exists(test_id)
    ]


def _validate_single_import_item(
    item: dict[str, Any],
    existing_names: dict[str, str],
) -> dict[str, Any]:
    """Validate a single suite item for import."""
    name = item.get("name", "")
    fatal_errors: list[dict[str, str]] = []
    has_fatal = False

    if not name:
        fatal_errors.append({"code": "MISSING_NAME", "message": "Suite must have a name"})
        has_fatal = True

    value_errors = variable_value_errors(item.get("variables", {}))
    if value_errors:
        fatal_errors.extend(value_errors)
        has_fatal = True

    # Check variable type collisions with existing suites sharing tests
    test_ids = item.get("tests", [])
    variables = item.get("variables", {})
    if test_ids and variables and not has_fatal:
        collisions = check_variable_collisions_for_tests(
            exclude_suite_id="",  # new suite, exclude nothing
            test_ids=test_ids,
            proposed_variables=variables,
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

    fixable_errors = _check_unresolvable_tests(test_ids)
    warnings = [*check_masked_secrets(variables), *check_foreign_envelopes(variables)]

    item_status, existing_suite_id = determine_import_item_status(
        name, has_fatal, fixable_errors, existing_names
    )

    return {
        "name": name or "",
        "status": item_status,
        "fatal_errors": fatal_errors,
        "fixable_errors": fixable_errors,
        "warnings": warnings,
        "existing_suite_id": existing_suite_id,
    }


def validate_suite_import(content: bytes, filename: str) -> dict[str, Any]:
    """Validate file content for suite import without persisting."""
    items = _parse_import_items(content, filename)
    existing_names = _get_existing_names_map()

    suites = [_validate_single_import_item(item, existing_names) for item in items]

    blocked = sum(1 for s in suites if s["status"] == "fatal")
    importable = len(suites) - blocked

    return {
        "suites": suites,
        "total": len(items),
        "importable": importable,
        "blocked": blocked,
    }


def _resolve_test_references(test_ids: list[str]) -> tuple[list[str], list[str]]:
    """Filter test IDs to only valid ones, returning (valid_ids, fix_descriptions)."""
    valid: list[str] = []
    fixes: list[str] = []
    for test_id in test_ids:
        if _storage._test_exists(test_id):
            valid.append(test_id)
        else:
            fixes.append(f"Stripped unresolvable test '{test_id}'")
    return valid, fixes


def _build_import_suite_data(
    suite_id: str,
    name: str,
    item: dict[str, Any],
    resolved_tests: list[str],
    now: str,
) -> dict[str, Any]:
    """Build a suite data dict from an import item."""
    suite_data: dict[str, Any] = {
        "id": suite_id,
        "name": name,
        "version": "1.0.0",
        "description": item.get("description", ""),
        "tests": resolved_tests,
        "tags": item.get("tags", []),
        "variables": settle_imported_secret_variables(
            item.get("variables", {}), (_storage._load_suite(suite_id) or {}).get("variables")
        ),
        "metadata": item.get("metadata", {}),
        "created_at": now,
        "updated_at": now,
    }
    return suite_data


def _import_history(suite_data: dict[str, Any]) -> list[dict[str, Any]]:
    """The one history row an imported suite starts with."""
    return [
        {
            "version": "1.0.0",
            "created_at": suite_data["created_at"],
            "created_by": "import",
            "changes": "Imported suite",
        }
    ]


def _import_existing_item(
    name: str,
    resolution: str,
    existing_id: str,
    item: dict[str, Any],
    resolved_tests: list[str],
    now: str,
    existing_names: dict[str, str],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Handle import of an item whose name conflicts with an existing suite."""
    if resolution == "skip":
        return None, {"name": name, "reason": "skipped by user"}

    if resolution == "overwrite":
        suite_data = _build_import_suite_data(existing_id, name, item, resolved_tests, now)
        suite_service.persist_suite_document(suite_data, _import_history(suite_data))
        return {"name": name, "id": existing_id, "action": "overwritten"}, None

    new_name = _generate_unique_name(name)
    new_id = str(uuid.uuid4())
    suite_data = _build_import_suite_data(new_id, new_name, item, resolved_tests, now)
    suite_service.persist_suite_document(suite_data, _import_history(suite_data))
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


def _check_import_collisions(items: list[dict[str, Any]]) -> None:
    """Raise ConflictException if any import item has variable type collisions."""
    for item in items:
        test_ids = item.get("tests", [])
        variables = item.get("variables", {})
        if not test_ids or not variables:
            continue
        collisions = check_variable_collisions_for_tests(
            exclude_suite_id="",
            test_ids=test_ids,
            proposed_variables=variables,
        )
        if collisions:
            collision_details = "; ".join(
                f"variable '{c['variable']}' is '{c['this_type']}' here but "
                f"'{c['other_type']}' in suite '{c['other_suite']}'"
                for c in collisions
            )
            raise ConflictException(
                f"Variable type collision: {collision_details}",
                details={"collisions": collisions},
            )


def import_suites(
    content: bytes,
    filename: str,
    conflict_resolutions: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Import suites from file content."""
    resolutions = conflict_resolutions or {}

    items = _parse_import_items(content, filename)
    refuse_unimportable_items(items)
    _check_import_collisions(items)

    existing_names = _get_existing_names_map()

    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    fixes_applied: list[dict[str, Any]] = []

    for item in items:
        name = item["name"]

        resolved_tests, test_fixes = _resolve_test_references(item.get("tests", []))
        item_fixes = test_fixes
        now = _now_iso()

        if name in existing_names:
            imported_entry, skipped_entry = _import_existing_item(
                name,
                resolutions.get(name, "rename"),
                existing_names[name],
                item,
                resolved_tests,
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
        suite_data = _build_import_suite_data(new_id, name, item, resolved_tests, now)
        suite_service.persist_suite_document(suite_data, _import_history(suite_data))
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
