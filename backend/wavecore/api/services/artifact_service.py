"""Artifact service over the per-execution artifact layout (REQ-3.7.1.x).

The canonical artifact root holds one isolated timestamped directory per
tracked execution plus a transient ``sessions/`` area for ephemeral workbench
runs. Directories are self-describing: listing and metadata are pure
filesystem scans, artifact identity is path-shaped
(``{artifact_dir_name}/{relative_path}``), and no index file exists.
"""

import hashlib
import itertools
import json
import logging
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    RangeNotSatisfiableException,
    ValidationException,
)
from wavecore.api.services import file_tree, shared
from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.core.artifacts.store import TOMBSTONE_SUFFIX, parse_artifact_filename

logger = logging.getLogger(__name__)

_SESSIONS_DIR_NAME = "sessions"

_LOW_DISK_SPACE_BYTES = 1024**3

_RANGE_RE = re.compile(r"^bytes=(\d+)-(\d*)$")


# ---------------------------------------------------------------------------
# Execution artifact directories
# ---------------------------------------------------------------------------


def allocate_execution_artifact_dir(execution_id: str) -> str:
    """Create ``{root}/{YYYYMMDD-HHMMSS}-{execution_id}`` and return its name.

    Low disk space logs a WARNING and never blocks execution.
    """
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    dir_name = f"{timestamp}-{execution_id}"
    directory = get_artifacts_storage_path() / dir_name
    directory.mkdir(parents=True, exist_ok=True)
    free_bytes = shutil.disk_usage(directory).free
    if free_bytes < _LOW_DISK_SPACE_BYTES:
        logger.warning(
            "Low disk space for artifacts: %.2f GiB available at %s",
            free_bytes / 1024**3,
            directory,
        )
    return dir_name


def _execution_id_from_dir_name(dir_name: str) -> str:
    """Strip the leading ``YYYYMMDD-HHMMSS-`` stamp from an execution dir name."""
    return dir_name[16:]


# ---------------------------------------------------------------------------
# Path-shaped artifact identity
# ---------------------------------------------------------------------------


def resolve_artifact_id(artifact_id: str) -> Path:
    """Validate a path-shaped artifact id and resolve it under the artifact root."""
    parts = artifact_id.split("/")
    if (
        not file_tree.is_safe_relative_path(artifact_id)
        or len(parts) < 2
        or parts[0] == _SESSIONS_DIR_NAME
    ):
        raise ValidationException(f"Invalid artifact identifier: {artifact_id}")
    return get_artifacts_storage_path() / artifact_id


def _resolve_existing_artifact(artifact_id: str) -> Path:
    path = resolve_artifact_id(artifact_id)
    if not path.is_file():
        raise NotFoundException(f"Artifact {artifact_id} not found")
    return path


def _artifact_meta(dir_name: str, relative_path: str, path: Path) -> dict[str, Any]:
    """Build the ArtifactMeta shape for one live artifact file."""
    stat = path.stat()
    name, compression = parse_artifact_filename(path.name)
    return {
        "id": f"{dir_name}/{relative_path}",
        "execution_id": _execution_id_from_dir_name(dir_name),
        "name": name,
        "path": relative_path,
        "size_bytes": stat.st_size,
        "content_type": file_tree.content_type(path.name),
        "compression": compression,
        "created_at": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
    }


def _tombstone_meta(dir_name: str, sidecar: Path) -> dict[str, Any]:
    """Reconstruct ArtifactMeta for a soft-deleted artifact from its sidecar."""
    record = json.loads(sidecar.read_text(encoding="utf-8"))
    relative_path = record["path"]
    file_name = record.get("name") or Path(relative_path).name
    name, compression = parse_artifact_filename(file_name)
    return {
        "id": f"{dir_name}/{relative_path}",
        "execution_id": _execution_id_from_dir_name(dir_name),
        "name": name,
        "path": relative_path,
        "size_bytes": record.get("size_bytes", 0),
        "content_type": file_tree.content_type(file_name),
        "compression": compression,
        "created_at": datetime.fromtimestamp(sidecar.stat().st_mtime, tz=UTC).isoformat(),
        "removed_at": record.get("removed_at"),
        "removed_by": record.get("removed_by"),
    }


def _find_execution_dir(execution_id: str) -> Path | None:
    """Locate the execution's artifact dir by its trailing id, if it exists."""
    root = get_artifacts_storage_path()
    if not root.exists():
        return None
    for exec_dir in root.iterdir():
        if (
            exec_dir.is_dir()
            and exec_dir.name != _SESSIONS_DIR_NAME
            and _execution_id_from_dir_name(exec_dir.name) == execution_id
        ):
            return exec_dir
    return None


def _live_artifact_files(base: Path) -> list[Path]:
    """Every live (non-tombstoned) artifact file under a directory."""
    return [
        base / entry["path"]
        for entry in file_tree.walk_entries(base)
        if entry["kind"] == "file" and not entry["path"].endswith(TOMBSTONE_SUFFIX)
    ]


# ---------------------------------------------------------------------------
# List / meta / content / delete
# ---------------------------------------------------------------------------


def _scan_execution_dir(
    exec_dir: Path, execution_id: str | None, include_removed: bool
) -> list[dict[str, Any]]:
    """ArtifactMeta items for one execution dir; empty when filtered out.

    Tombstone sidecars are skipped by default; ``include_removed`` reconstructs
    the removed entries from them.
    """
    if not exec_dir.is_dir() or exec_dir.name == _SESSIONS_DIR_NAME:
        return []
    if execution_id is not None and _execution_id_from_dir_name(exec_dir.name) != execution_id:
        return []
    items: list[dict[str, Any]] = []
    for entry in file_tree.walk_entries(exec_dir):
        if entry["kind"] != "file":
            continue
        path = exec_dir / entry["path"]
        if path.name.endswith(TOMBSTONE_SUFFIX):
            if include_removed:
                items.append(_tombstone_meta(exec_dir.name, path))
            continue
        items.append(_artifact_meta(exec_dir.name, entry["path"], path))
    return items


def list_artifacts(
    execution_id: str | None = None,
    page: int = 1,
    per_page: int = 50,
    include_removed: bool = False,
) -> dict[str, Any]:
    """Scan execution dirs (``sessions/`` excluded) into a paginated listing."""
    root = get_artifacts_storage_path()
    items: list[dict[str, Any]] = []
    if root.exists():
        for exec_dir in root.iterdir():
            items.extend(_scan_execution_dir(exec_dir, execution_id, include_removed))

    items.sort(key=lambda item: item["created_at"], reverse=True)
    total = len(items)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    start = (page - 1) * per_page
    return {
        "items": items[start : start + per_page],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
        },
    }


def get_artifact_meta(artifact_id: str) -> dict[str, Any]:
    """ArtifactMeta plus an on-demand sha256 integrity checksum."""
    path = _resolve_existing_artifact(artifact_id)
    dir_name, relative_path = artifact_id.split("/", 1)
    meta = _artifact_meta(dir_name, relative_path, path)
    meta["checksum_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return meta


def read_artifact_content(artifact_id: str, range_header: str | None = None) -> dict[str, Any]:
    """Read full or partial artifact bytes for the content endpoint."""
    path = _resolve_existing_artifact(artifact_id)
    size = path.stat().st_size
    content_type = file_tree.content_type(path.name)
    byte_range = _parse_range(range_header, size)
    if byte_range is None:
        return {
            "content": path.read_bytes(),
            "content_type": content_type,
            "filename": path.name,
            "status_code": 200,
            "content_range": None,
        }
    start, end = byte_range
    with open(path, "rb") as fh:
        fh.seek(start)
        content = fh.read(end - start + 1)
    return {
        "content": content,
        "content_type": content_type,
        "filename": path.name,
        "status_code": 206,
        "content_range": f"bytes {start}-{end}/{size}",
    }


def _parse_range(range_header: str | None, size: int) -> tuple[int, int] | None:
    """Parse a bytes Range header; malformed headers are ignored per RFC 9110."""
    if range_header is None:
        return None
    match = _RANGE_RE.match(range_header)
    if match is None:
        return None
    start = int(match.group(1))
    if start >= size:
        raise RangeNotSatisfiableException("Invalid range")
    end = int(match.group(2)) if match.group(2) else size - 1
    return start, min(end, size - 1)


def delete_artifact(artifact_id: str) -> None:
    """Soft-delete one artifact: free its bytes and write a tombstone sidecar.

    Executions in progress are protected (409). There is no restore - the
    tombstone is an audit record, not a recycle bin.
    """
    path = _resolve_existing_artifact(artifact_id)
    dir_name, relative_path = artifact_id.split("/", 1)
    _assert_execution_not_in_progress(_execution_id_from_dir_name(dir_name))
    _soft_delete(path, relative_path)


def delete_execution_artifacts(execution_id: str) -> None:
    """Soft-delete every live artifact of an execution in one call."""
    exec_dir = _find_execution_dir(execution_id)
    live = _live_artifact_files(exec_dir) if exec_dir is not None else []
    if exec_dir is None or not live:
        raise NotFoundException(f"No artifacts found for execution {execution_id}")
    _assert_execution_not_in_progress(execution_id)
    for path in live:
        _soft_delete(path, path.relative_to(exec_dir).as_posix())


def purge_execution_artifact_dir(execution_id: str) -> None:
    """Hard-remove an execution's whole artifact dir (artifacts, reports, logs,
    tombstones) - called when the execution record itself is deleted."""
    exec_dir = _find_execution_dir(execution_id)
    if exec_dir is not None:
        shutil.rmtree(exec_dir)


def _soft_delete(path: Path, relative_path: str) -> None:
    size_bytes = path.stat().st_size
    _write_tombstone(path, relative_path, size_bytes)
    path.unlink()


def _write_tombstone(path: Path, relative_path: str, size_bytes: int) -> None:
    from wavecore.api.services.workbench._common import DEFAULT_USER_ID

    sidecar = path.with_name(path.name + TOMBSTONE_SUFFIX)
    sidecar.write_text(
        json.dumps(
            {
                "name": path.name,
                "path": relative_path,
                "size_bytes": size_bytes,
                "removed_at": datetime.now(UTC).isoformat(),
                "removed_by": DEFAULT_USER_ID,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _execution_in_progress(execution_id: str) -> bool:
    from wavecore.api.services.executions import _storage as exec_storage

    record = exec_storage._execution_storage.get(execution_id) or exec_storage._load_execution(
        execution_id
    )
    return record is not None and record.get("status") in exec_storage._ACTIVE_EXECUTION_STATUSES


def _assert_execution_not_in_progress(execution_id: str) -> None:
    """409 carrying the blocking execution id, the shape every entity guard answers."""
    if _execution_in_progress(execution_id):
        raise ConflictException(
            "Cannot delete artifact of an execution in progress",
            details={"execution_ids": [execution_id]},
        )


# ---------------------------------------------------------------------------
# Execution-artifact summary listing (landing list)
# ---------------------------------------------------------------------------


def list_execution_artifact_summaries(
    page: int = 1,
    per_page: int = 50,
    search: str | None = None,
    entity_type: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    """One row per execution that has live artifacts, newest first.

    Joins each artifact directory's rollup (live count + total bytes) with the
    execution record (name/type/status/finished). Directories with no live
    artifacts are excluded.
    """
    from wavecore.api.services.executions import _storage as exec_storage

    root = get_artifacts_storage_path()
    rows: list[dict[str, Any]] = []
    if root.exists():
        for exec_dir in sorted(root.iterdir(), key=lambda entry: entry.name, reverse=True):
            if not exec_dir.is_dir() or exec_dir.name == _SESSIONS_DIR_NAME:
                continue
            live = _live_artifact_files(exec_dir)
            if not live:
                continue
            execution_id = _execution_id_from_dir_name(exec_dir.name)
            record = (
                exec_storage._execution_storage.get(execution_id)
                or exec_storage._load_execution(execution_id)
                or {}
            )
            rows.append(
                {
                    "execution_id": execution_id,
                    "name": record.get("name"),
                    "entity_type": record.get("entity_type"),
                    "status": record.get("status"),
                    "finished_at": record.get("ended_at"),
                    "artifact_count": len(live),
                    "total_size_bytes": sum(path.stat().st_size for path in live),
                }
            )

    rows = _filter_summaries(rows, search, entity_type, status)
    total = len(rows)
    total_size_bytes = sum(row["total_size_bytes"] for row in rows)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    start = (page - 1) * per_page
    return {
        "items": rows[start : start + per_page],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "total_size_bytes": total_size_bytes,
        },
    }


def _filter_summaries(
    rows: list[dict[str, Any]],
    search: str | None,
    entity_type: str | None,
    status: str | None,
) -> list[dict[str, Any]]:
    if search:
        needle = search.lower()
        rows = [row for row in rows if needle in (row["name"] or "").lower()]
    if entity_type:
        wanted_types = set(entity_type.split(","))
        rows = [row for row in rows if row["entity_type"] in wanted_types]
    if status:
        wanted_statuses = set(status.split(","))
        rows = [row for row in rows if row["status"] in wanted_statuses]
    return rows


# ---------------------------------------------------------------------------
# Zip download (whole-execution / subtree)
# ---------------------------------------------------------------------------


def _is_filename_char(char: str) -> bool:
    return shared.is_name_char(char) or char in ".-"


def safe_filename_part(value: str, fallback: str = "artifacts") -> str:
    """A display name as a download file name: letters of any language, ``.``, ``_`` and ``-``."""
    runs = itertools.groupby(value, _is_filename_char)
    return "".join("".join(run) if kept else "-" for kept, run in runs).strip("-") or fallback


def zip_download_name(execution_id: str, subtree: str | None = None) -> str:
    """Human-readable zip filename: ``<stamp>-<exec name>[-<subtree>].zip``."""
    from wavecore.api.services.executions import _storage as exec_storage

    exec_dir = _find_execution_dir(execution_id)
    timestamp = exec_dir.name[:15] if exec_dir else execution_id
    record = (
        exec_storage._execution_storage.get(execution_id)
        or exec_storage._load_execution(execution_id)
        or {}
    )
    name = record.get("name") or execution_id
    parts = f"{timestamp}-{safe_filename_part(name)}"
    if subtree:
        parts = f"{parts}-{safe_filename_part(subtree)}"
    return f"{parts}.zip"


def zip_execution_artifacts(execution_id: str, subtree: str | None = None) -> bytes:
    """Build a zip of an execution's live artifacts (or a subtree of them).

    Tombstones and removed originals are excluded. An execution with no live
    artifacts raises 404; a subtree that escapes the execution dir raises 400.
    """
    exec_dir = _find_execution_dir(execution_id)
    if exec_dir is None:
        raise NotFoundException(f"No artifacts found for execution {execution_id}")
    base = exec_dir
    if subtree:
        _validate_subtree(execution_id, subtree)
        base = exec_dir / subtree
    files = _live_artifact_files(base)
    if not files:
        raise NotFoundException(f"No artifacts found for execution {execution_id}")
    return shared.build_export_zip(
        [(path.relative_to(exec_dir).as_posix(), path) for path in files]
    )


def _validate_subtree(execution_id: str, subtree: str) -> None:
    if not file_tree.is_safe_relative_path(subtree):
        raise ValidationException(f"Invalid artifact identifier: {execution_id}/{subtree}")


# ---------------------------------------------------------------------------
# Workbench session artifact directories
# ---------------------------------------------------------------------------


def session_artifacts_dir(session_id: str) -> Path:
    """Temporary artifact dir for an ephemeral workbench session."""
    return get_artifacts_storage_path() / _SESSIONS_DIR_NAME / session_id


def wipe_session_artifacts(session_id: str) -> None:
    """Remove a session's artifact dir; no-op when it does not exist."""
    directory = session_artifacts_dir(session_id)
    if directory.exists():
        shutil.rmtree(directory)


def move_session_artifacts(previous_session_id: str, new_session_id: str) -> None:
    """Transfer a session dir to its run-without-reset successor."""
    source = session_artifacts_dir(previous_session_id)
    if source.exists():
        shutil.move(str(source), str(session_artifacts_dir(new_session_id)))


def sweep_session_artifacts() -> None:
    """Startup sweep: sessions are in-memory and cannot survive a restart."""
    sessions_root = get_artifacts_storage_path() / _SESSIONS_DIR_NAME
    if sessions_root.exists():
        shutil.rmtree(sessions_root)
