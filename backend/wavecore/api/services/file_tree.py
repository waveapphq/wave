"""File-surface helpers shared by artifacts, session artifacts and test data (REQ-5.2.4.12).

One safe-relative-path rule, one flat directory walk, one content type lookup and
one download response builder; every file surface answers with the same shapes
and headers.
"""

import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict
from urllib.parse import quote

from fastapi.responses import FileResponse

from wavecore.api.exceptions import ValidationException
from wavecore.plugins._content_types import CONTENT_TYPES, content_type_for

_VALID_DISPOSITIONS = ("attachment", "inline")
_FALLBACK_DOWNLOAD_NAME = "download"
_GZIP_SUFFIX = ".gz"
# Printable ASCII without the double quote and the backslash, which a quoted name cannot hold.
_NOT_PLAIN = re.compile(r"[^ !#-\[\]-~]")


class Entry(TypedDict):
    """One flat listing entry: a relative posix path plus its kind, size and mtime."""

    path: str
    kind: str
    size_bytes: int
    modified_at: str


def is_safe_relative_path(path: str) -> bool:
    """True for a non-empty relative posix path without empty or parent segments."""
    parts = path.split("/")
    return not path.startswith("/") and "" not in parts and ".." not in parts


def walk_entries(root: Path) -> list[Entry]:
    """Every file and folder under root as flat entries sorted by path.

    Folders are explicit ``dir`` entries with size 0; dot-directories and
    symlinks are skipped; a missing root lists as empty.
    """
    entries: list[Entry] = []
    if root.is_dir():
        _collect(root, root, entries)
    entries.sort(key=lambda entry: entry["path"])
    return entries


def _collect(root: Path, folder: Path, entries: list[Entry]) -> None:
    with os.scandir(folder) as scan:
        for item in scan:
            if item.is_symlink():
                continue
            is_dir = item.is_dir(follow_symlinks=False)
            if is_dir and item.name.startswith("."):
                continue
            stat_result = item.stat(follow_symlinks=False)
            entries.append(
                Entry(
                    path=Path(item.path).relative_to(root).as_posix(),
                    kind="dir" if is_dir else "file",
                    size_bytes=0 if is_dir else stat_result.st_size,
                    modified_at=datetime.fromtimestamp(stat_result.st_mtime, tz=UTC).isoformat(),
                )
            )
            if is_dir:
                _collect(root, Path(item.path), entries)


def content_type(file_name: str) -> str:
    """A file's type from WAVE's table; a .gz file whose inner type it knows takes that type."""
    inner = file_name.removesuffix(_GZIP_SUFFIX)
    if inner != file_name and os.path.splitext(inner)[1].lower() in CONTENT_TYPES:
        return content_type_for(inner)
    return content_type_for(file_name)


def content_response(path: Path, disposition: str) -> FileResponse:
    """Serve a file from disk with the download headers every file surface sends."""
    if disposition not in _VALID_DISPOSITIONS:
        raise ValidationException(
            f"Invalid disposition '{disposition}': "
            f"valid values are {', '.join(_VALID_DISPOSITIONS)}"
        )
    return FileResponse(
        path,
        media_type=content_type(path.name),
        headers={
            "Content-Disposition": content_disposition(disposition, path.name),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )


def content_disposition(disposition: str, name: str) -> str:
    """A download's header value; a name that is not plain goes whole in the RFC 5987 form."""
    plain = _NOT_PLAIN.sub("", name)
    if plain == name:
        return f'{disposition}; filename="{name}"'
    encoded = quote(name, safe="", errors="replace")
    fallback = plain or _FALLBACK_DOWNLOAD_NAME
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"
