"""Stateless artifact store (REQ-3.7.1.1, REQ-3.7.1.3).

WAVE-generated artifacts are written under their plain logical name
(``name.ext``, optionally suffixed ``.gz`` / ``.zip``). Re-writing the same
logical name overwrites in place: reports and failure summaries are immutable
per execution, and "regenerate" is a delete-then-write flow owned by the
caller. The directory is self-describing; ``parse_artifact_filename`` recovers
(logical name, compression) from any filename in it. Callers pass the target
directory and pre-masked data; the store neither masks nor resolves roots.
"""

import gzip
import hashlib
import json
import logging
import zipfile
from collections.abc import Iterable
from pathlib import Path, PurePosixPath
from typing import Any

logger = logging.getLogger(__name__)

_VALID_COMPRESSION = ("none", "gzip", "zip")

_COMPRESSION_BY_SUFFIX = {".gz": "gzip", ".zip": "zip"}

TOMBSTONE_SUFFIX = ".removed"


def write_json(directory: Path, name: str, data: Any, *, compression: str = "none") -> Path:
    """Validate ``data`` in memory, then write it as ``name.json``."""
    _validate_compression(compression)
    _detect_circular_reference(data)
    payload = json.dumps(data, indent=2).encode("utf-8")
    return _write(directory, name, "json", payload, compression)


def write_text(directory: Path, name: str, data: str, *, compression: str = "none") -> Path:
    """Write ``data`` as ``name.txt`` (or the caller's extension)."""
    _validate_compression(compression)
    return _write(directory, name, "txt", data.encode("utf-8"), compression)


def write_bytes(directory: Path, name: str, data: bytes, *, compression: str = "none") -> Path:
    """Write ``data`` as ``name.bin`` (or the caller's extension)."""
    _validate_compression(compression)
    return _write(directory, name, "bin", data, compression)


def write_stream(
    directory: Path, name: str, chunks: Iterable[bytes], *, hash: bool = True
) -> tuple[Path, int, str]:
    """Write ``chunks`` under the verbatim ``name``, hashing incrementally.

    Returns (path, byte count, sha256 hex digest - empty when hashing is off).
    """
    path = Path(directory) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256() if hash else None
    size = 0
    with open(path, "wb") as fh:
        for chunk in chunks:
            fh.write(chunk)
            size += len(chunk)
            if digest is not None:
                digest.update(chunk)
    path.with_name(path.name + TOMBSTONE_SUFFIX).unlink(missing_ok=True)
    return path, size, digest.hexdigest() if digest is not None else ""


def parse_artifact_filename(filename: str) -> tuple[str, str | None]:
    """Return (logical name, compression) for a directory entry.

    The logical name is the filename minus any ``.gz`` / ``.zip`` compression
    suffix. Files without a compression suffix (including plugin-written files)
    return the full filename with no compression.
    """
    for suffix, compression in _COMPRESSION_BY_SUFFIX.items():
        if filename.endswith(suffix):
            return filename[: -len(suffix)], compression
    return filename, None


def _validate_compression(compression: str) -> None:
    if compression not in _VALID_COMPRESSION:
        raise ValueError(
            f"Invalid compression type '{compression}': "
            f"valid types are {', '.join(_VALID_COMPRESSION)}"
        )


def _detect_circular_reference(data: Any, seen: set[int] | None = None) -> None:
    if seen is None:
        seen = set()
    if id(data) in seen:
        raise ValueError("Circular reference detected")
    if isinstance(data, dict):
        seen.add(id(data))
        for value in data.values():
            _detect_circular_reference(value, seen)
        seen.remove(id(data))
    elif isinstance(data, list):
        seen.add(id(data))
        for item in data:
            _detect_circular_reference(item, seen)
        seen.remove(id(data))


def _split_name(name: str, default_ext: str) -> tuple[Path, str, str]:
    """Split ``name`` into (relative parent, stem, extension)."""
    pure = PurePosixPath(name)
    suffix = pure.suffix
    if suffix:
        return Path(pure.parent), pure.stem, suffix[1:]
    return Path(pure.parent), pure.name, default_ext


def _write(directory: Path, name: str, default_ext: str, payload: bytes, compression: str) -> Path:
    relative_parent, stem, ext = _split_name(name, default_ext)
    parent = directory / relative_parent
    parent.mkdir(parents=True, exist_ok=True)
    base_name = f"{stem}.{ext}"
    if compression == "gzip":
        path = _write_gzip(parent, base_name, payload)
    elif compression == "zip":
        path = _write_zip(parent, base_name, payload)
    else:
        path = _write_plain(parent / base_name, payload)
    # Re-creating an artifact supersedes any prior soft-delete tombstone.
    path.with_name(path.name + TOMBSTONE_SUFFIX).unlink(missing_ok=True)
    return path


def _write_plain(path: Path, payload: bytes) -> Path:
    with open(path, "wb") as fh:
        fh.write(payload)
    return path


def _write_gzip(parent: Path, base_name: str, payload: bytes) -> Path:
    path = parent / f"{base_name}.gz"
    try:
        with gzip.open(path, "wb") as fh:
            fh.write(payload)
    except OSError as exc:
        # REQ-3.7.1.3: compression failure falls back to uncompressed storage.
        logger.warning("gzip compression failed for %s: %s; storing uncompressed", base_name, exc)
        return _write_plain(parent / base_name, payload)
    return path


def _write_zip(parent: Path, base_name: str, payload: bytes) -> Path:
    path = parent / f"{base_name}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(base_name, payload)
    return path
