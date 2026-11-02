"""Backup and restore service module.

Provides backup creation, validation, restoration, and periodic schedule
management for WAVE entities. Supports selective entity types, compression
options, a secrets handling mode, and dependency-ordered restore.
"""

import io
import json
import logging
import zipfile
from datetime import UTC, datetime
from typing import Any

from wavecore.api.config.instance_settings import (
    COMPRESSION_LEVEL_MAX,
    COMPRESSION_LEVEL_MIN,
    whole_number,
)
from wavecore.api.exceptions import ValidationException
from wavecore.api.services.backup._helpers import (
    _COMPRESSION_MAP,
    _MANIFEST_FILENAME,
    COMPRESSION_METHODS,
    TESTDATA_MEMBER_PREFIX,
    TestDataFiles,
    _list_entities,
    _list_functions_entities,
    _parse_backup_zip,
    _serialize_entity,
    _validate_entity_types,
)
from wavecore.api.services.backup.plan import RestorePlan, build_plan, preview_of
from wavecore.api.services.backup.restore import apply_plan
from wavecore.api.services.tests import testdata_service

logger = logging.getLogger(__name__)

_CONFLICT_RESOLUTIONS = ("skip", "overwrite", "rename")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _validate_backup_options(fmt: str, compression_method: str, compression_level: Any) -> Any:
    """Reject a format, method or level the archive writer cannot honor; the level it uses."""
    if fmt not in ("yaml", "json"):
        raise ValidationException(f"Invalid format: '{fmt}'")
    if compression_method not in COMPRESSION_METHODS:
        raise ValidationException(f"Invalid compression method: '{compression_method}'")
    if compression_method in ("stored", "lzma"):
        return compression_level
    level = whole_number(compression_level, COMPRESSION_LEVEL_MIN, COMPRESSION_LEVEL_MAX)
    if level is None:
        raise ValidationException(
            f"Compression level must be between {COMPRESSION_LEVEL_MIN} and {COMPRESSION_LEVEL_MAX}"
        )
    return level


def _validate_restore_options(entity_types: list[str] | None, conflict_resolution: str) -> None:
    """Reject a conflict choice or a part id that a restore does not know."""
    if conflict_resolution not in _CONFLICT_RESOLUTIONS:
        raise ValidationException(f"Unknown conflict resolution: '{conflict_resolution}'")
    if entity_types:
        _validate_entity_types(entity_types)


def _unique_filename(fname: str, taken: set[str]) -> str:
    """The name itself, or the next free ``<stem>-<n>.<ext>`` beside it."""
    candidate = fname
    counter = 2
    while candidate in taken:
        name_part, ext_part = fname.rsplit(".", 1)
        candidate = f"{name_part}-{counter}.{ext_part}"
        counter += 1
    return candidate


def _write_entity(
    zf: zipfile.ZipFile, item: dict[str, Any], et: str, fmt: str, secrets: str, taken: set[str]
) -> None:
    """Write one entity document, plus a test's own data files."""
    content, fname = _serialize_entity(item, et, fmt, secrets)
    fname = _unique_filename(fname, taken)
    taken.add(fname)
    zf.writestr(f"{et}/{fname}", content)
    if et != "tests":
        return
    for rel, path in testdata_service.iter_files(item["id"]):
        zf.write(path, f"{TESTDATA_MEMBER_PREFIX}{item['id']}/{rel}")


def create_backup(
    entity_types: list[str],
    fmt: str = "yaml",
    compression_method: str = "deflate",
    compression_level: Any = 6,
    secrets: str = "mask",
) -> tuple[bytes, str]:
    """Create a backup ZIP archive.

    Returns (zip_bytes, filename).
    """
    _validate_entity_types(entity_types)
    compression_level = _validate_backup_options(fmt, compression_method, compression_level)

    buf = io.BytesIO()
    compress_kwargs: dict[str, Any] = {"compression": _COMPRESSION_MAP[compression_method]}
    if compression_method in ("deflate", "bzip2"):
        compress_kwargs["compresslevel"] = compression_level

    entity_counts: dict[str, int] = {}
    with zipfile.ZipFile(buf, "w", **compress_kwargs) as zf:
        for et in entity_types:
            items = _list_functions_entities(secrets) if et == "functions" else _list_entities(et)
            entity_counts[et] = len(items)
            taken: set[str] = set()
            for item in items:
                _write_entity(zf, item, et, fmt, secrets, taken)

        manifest = {
            "wave_version": "1.0.0",
            "created_at": datetime.now(UTC).isoformat(),
            "entity_counts": entity_counts,
            "compression": {
                "method": compression_method,
                "level": compression_level,
            },
            "format": fmt,
            "secrets": secrets,
            "schema_version": "1.0",
        }
        zf.writestr(_MANIFEST_FILENAME, json.dumps(manifest, indent=2))

    now_str = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    filename = f"wave-backup-{now_str}.zip"

    return buf.getvalue(), filename


def _plan_upload(
    content: bytes,
    filename: str,
    entity_types: list[str] | None,
    conflict_resolution: str,
    auto_repair: bool,
) -> tuple[dict[str, Any], RestorePlan, TestDataFiles]:
    """The manifest, the restore plan and the test data files of an uploaded archive."""
    _validate_restore_options(entity_types, conflict_resolution)
    manifest, entities, testdata_files, unreadable = _parse_backup_zip(content, filename)
    plan = build_plan(
        entities,
        unreadable=unreadable,
        selected=entity_types or None,
        conflict_resolution=conflict_resolution,
        auto_repair=auto_repair,
    )
    return manifest, plan, testdata_files


def validate_backup(
    content: bytes,
    filename: str,
    entity_types: list[str] | None = None,
    conflict_resolution: str = "skip",
    auto_repair: bool = False,
) -> dict[str, Any]:
    """Preview the restore of an uploaded backup archive; nothing is written."""
    manifest, plan, testdata_files = _plan_upload(
        content, filename, entity_types, conflict_resolution, auto_repair
    )
    entity_summary = preview_of(plan)
    if "tests" in entity_summary:
        entity_summary["tests"]["testdata_files"] = sum(
            len(files) for files in testdata_files.values()
        )

    return {
        "metadata": {
            "wave_version": manifest.get("wave_version", "unknown"),
            "created_at": manifest.get("created_at", ""),
            "format": manifest.get("format", "yaml"),
            "schema_version": manifest.get("schema_version", "1.0"),
            "secrets": manifest.get("secrets", "mask"),
        },
        "entity_summary": entity_summary,
    }


def restore_backup(
    content: bytes,
    filename: str,
    entity_types: list[str] | None = None,
    conflict_resolution: str = "skip",
    auto_repair: bool = False,
) -> dict[str, Any]:
    """Restore the ticked parts of a backup archive; one result per part."""
    _manifest, plan, testdata_files = _plan_upload(
        content, filename, entity_types, conflict_resolution, auto_repair
    )
    return apply_plan(plan, testdata_files)
