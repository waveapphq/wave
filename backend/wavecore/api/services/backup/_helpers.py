"""Internal helpers for backup service: entity listing, serialization, validation, parsing."""

import io
import json
import zipfile
from collections.abc import Callable, Iterable
from typing import Any

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.network import certificates, ssh_hosts
from wavecore.api.services.shared import (
    apply_secrets_mode_to_variables,
    apply_secrets_mode_to_workflow,
    refuse_unencodable_file,
)
from wavecore.core.utf8_text import dump_exact_yaml, load_yaml

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BACKUP_ENTITY_TYPES: tuple[str, ...] = (
    "tests",
    "environments",
    "profiles",
    "suites",
    "regressions",
    "functions",
    "system_variables",
    "ssh_hosts",
    "certificates",
)

RESTORE_ORDER: list[str] = [
    "system_variables",
    "environments",
    "profiles",
    "functions",
    "tests",
    "suites",
    "regressions",
    "ssh_hosts",
    "certificates",
]

COMPRESSION_METHODS: set[str] = {"stored", "deflate", "bzip2", "lzma"}

_MANIFEST_FILENAME = "manifest.json"
_HISTORY_KEY = "version_history"
TESTDATA_MEMBER_PREFIX = "tests/testdata/"

TestDataFiles = dict[str, list[tuple[str, bytes]]]

_COMPRESSION_MAP: dict[str, int] = {
    "stored": zipfile.ZIP_STORED,
    "deflate": zipfile.ZIP_DEFLATED,
    "bzip2": zipfile.ZIP_BZIP2,
    "lzma": zipfile.ZIP_LZMA,
}

_CRON_DESCRIPTIONS: dict[str, str] = {
    "0": "0",
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4",
    "5": "5",
    "6": "6",
}


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------


def _sanitize_filename(name: str) -> str:
    """Sanitize entity name for use as filename."""
    safe = "".join(c if c.isalnum() or c in (" ", "-", "_", ".") else "_" for c in name)
    return safe.strip().replace(" ", "-") or "unnamed"


# ---------------------------------------------------------------------------
# Entity listing - dispatch table
# ---------------------------------------------------------------------------


def _list_system_variables() -> list[dict[str, Any]]:
    """List system variables for backup (raw stored form, secrets sealed)."""
    from wavecore.api.services import variable_service

    result = variable_service.get_system_variables_raw()
    variables = result.get("variables", {})
    if not variables:
        return []
    return [{"variables": variables}]


def _with_history(
    stored: Iterable[tuple[dict[str, Any], list[dict[str, Any]]]],
) -> list[dict[str, Any]]:
    """Each stored document with its history rows under one extra key (REQ-5.2.4.9.5)."""
    return [{**document, _HISTORY_KEY: rows} for document, rows in stored]


def _list_tests_entities() -> list[dict[str, Any]]:
    from wavecore.api.services.tests import service as test_service

    return _with_history(test_service.list_test_documents())


def _list_environments_entities() -> list[dict[str, Any]]:
    from wavecore.api.services.environments import service as environment_service

    return environment_service.list_environment_documents()


def _list_profiles_entities() -> list[dict[str, Any]]:
    """List profiles for backup (raw stored form, credentials sealed)."""
    from wavecore.api.services.profiles import service as profile_service

    return profile_service.list_profile_documents()


def _list_suites_entities() -> list[dict[str, Any]]:
    from wavecore.api.services.suites import service as suite_service

    return _with_history(suite_service.list_suite_documents())


def _list_regressions_entities() -> list[dict[str, Any]]:
    from wavecore.api.services.regressions import service as regression_service

    return _with_history(regression_service.list_regression_documents())


def _list_functions_entities(secrets: str) -> list[dict[str, Any]]:
    """One export document per library Function, every version under the secrets mode."""
    from wavecore.api.services.functions import import_export as function_import
    from wavecore.api.services.functions import service as function_service

    return [
        function_import.function_export_document(summary["id"], secrets)
        for summary in function_service.library_summaries()
    ]


_ENTITY_LISTERS: dict[str, Callable[[], list[dict[str, Any]]]] = {
    "system_variables": _list_system_variables,
    "tests": _list_tests_entities,
    "environments": _list_environments_entities,
    "profiles": _list_profiles_entities,
    "suites": _list_suites_entities,
    "regressions": _list_regressions_entities,
    "ssh_hosts": ssh_hosts.saved_entries,
    "certificates": certificates.saved_entries,
}


def _list_entities(entity_type: str) -> list[dict[str, Any]]:
    """List all entities of a given type from storage."""
    lister = _ENTITY_LISTERS.get(entity_type)
    if lister is None:
        return []
    return lister()


def _history_row_under_mode(row: dict[str, Any], secrets: str) -> dict[str, Any]:
    """One history row with the secrets mode applied to the variables of its snapshot."""
    snapshot = row.get("snapshot")
    if not isinstance(snapshot, dict) or "variables" not in snapshot:
        return row
    variables = apply_secrets_mode_to_variables(snapshot["variables"], secrets)
    return {**row, "snapshot": {**snapshot, "variables": variables}}


def _under_secrets_mode(entity: dict[str, Any], entity_type: str, secrets: str) -> dict[str, Any]:
    """A copy of a stored document with the secrets mode applied to every secret it holds."""
    data = dict(entity)

    if "variables" in data:
        data["variables"] = apply_secrets_mode_to_variables(data["variables"], secrets)

    if "workflow" in data:
        data["workflow"] = apply_secrets_mode_to_workflow(data["workflow"], secrets)

    if _HISTORY_KEY in data:
        data[_HISTORY_KEY] = [_history_row_under_mode(row, secrets) for row in data[_HISTORY_KEY]]

    if entity_type == "profiles":
        from wavecore.api.services.profiles.import_export import apply_secrets_mode_to_profile

        data = apply_secrets_mode_to_profile(data, secrets)

    return data


def _serialize_entity(
    entity: dict[str, Any],
    entity_type: str,
    fmt: str,
    secrets: str,
) -> tuple[str, str]:
    """Serialize an entity to string content and filename, applying the secrets mode."""
    # A Function export document comes with the secrets mode applied to every version.
    untouched = entity_type == "functions"
    data = entity if untouched else _under_secrets_mode(entity, entity_type, secrets)

    if entity_type == "system_variables":
        safe_name = "system-variables"
    else:
        name = data.get("name", data.get("id", "unknown"))
        safe_name = _sanitize_filename(name)
    ext = "json" if fmt == "json" else "yaml"
    filename = f"{safe_name}.{ext}"

    if fmt == "json":
        content = json.dumps(data, indent=2, default=str)
    else:
        content = dump_exact_yaml(data)

    return content, filename


def _validate_entity_types(entity_types: list[str]) -> None:
    """Validate entity type list."""
    if not entity_types:
        raise ValidationException("At least one entity type must be selected")
    for et in entity_types:
        if et not in BACKUP_ENTITY_TYPES:
            raise ValidationException(f"Unknown entity type: '{et}'")


# ---------------------------------------------------------------------------
# ZIP parsing
# ---------------------------------------------------------------------------


def _open_backup_zip(content: bytes, filename: str) -> zipfile.ZipFile:
    """Open and validate a backup ZIP file."""
    if not filename.lower().endswith(".zip"):
        raise ValidationException("Invalid backup file: must be a .zip file")
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise ValidationException("Invalid backup file: not a ZIP archive") from None
    if _MANIFEST_FILENAME not in zf.namelist():
        raise ValidationException("Invalid backup archive: missing manifest.json")
    return zf


def _read_manifest(zf: zipfile.ZipFile) -> dict[str, Any]:
    """Read and parse the manifest from a backup ZIP."""
    try:
        raw = zf.read(_MANIFEST_FILENAME)
        result = json.loads(raw)
        refuse_unencodable_file(raw, result)
        return dict(result)
    except (json.JSONDecodeError, KeyError, ValidationException):
        raise ValidationException("Invalid backup archive: corrupt manifest.json") from None


def _member_document(content: bytes, as_json: bool) -> dict[str, Any] | None:
    """One member as a mapping; None when it does not parse into one that UTF-8 can write."""
    try:
        data = json.loads(content) if as_json else load_yaml(content)
        refuse_unencodable_file(content, data)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _extract_entities(
    zf: zipfile.ZipFile, fmt: str
) -> tuple[dict[str, list[dict[str, Any]]], TestDataFiles, dict[str, list[str]]]:
    """Extract entities by type; tests/testdata/ members go to the per-test files first."""
    from wavecore.api.services.tests.service import collect_testdata_member

    entities: dict[str, list[dict[str, Any]]] = {}
    files: TestDataFiles = {}
    unreadable: dict[str, list[str]] = {}
    for name in zf.namelist():
        if name == _MANIFEST_FILENAME:
            continue
        if name.startswith(TESTDATA_MEMBER_PREFIX):
            collect_testdata_member(files, zf, name, TESTDATA_MEMBER_PREFIX)
            continue
        parts = name.split("/", 1)
        if len(parts) != 2 or not parts[1]:
            continue
        entity_type = parts[0]
        data = _member_document(zf.read(name), fmt == "json" or name.endswith(".json"))
        if data is None:
            unreadable.setdefault(entity_type, []).append(parts[1])
        else:
            entities.setdefault(entity_type, []).append(data)
    return entities, files, unreadable


def _parse_backup_zip(
    content: bytes, filename: str
) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]], TestDataFiles, dict[str, list[str]]]:
    """Parse a backup ZIP into (manifest, entities, testdata files, unreadable members)."""
    zf = _open_backup_zip(content, filename)
    manifest = _read_manifest(zf)
    fmt = manifest.get("format", "yaml")
    entities, files, unreadable = _extract_entities(zf, fmt)
    zf.close()
    return manifest, entities, files, unreadable
