"""File-surface helpers shared by artifacts, session artifacts and test data (REQ-5.2.4.12).

One safe-relative-path rule with its containment check, one flat directory walk,
one content type lookup, one set of download headers and one download response
builder; every file surface answers with the same shapes and headers.
"""

import errno
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict
from urllib.parse import quote

from fastapi.responses import FileResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.storage_paths import path_under
from wavecore.plugins._content_types import CONTENT_TYPES, content_type_for

_VALID_DISPOSITIONS = ("attachment", "inline")
_FALLBACK_DOWNLOAD_NAME = "download"
_GZIP_SUFFIX = ".gz"
# Printable ASCII without the double quote and the backslash, which a quoted name cannot hold.
_NOT_PLAIN = re.compile(r"[^ !#-\[\]-~]")
# The types a browser renders as a page and runs script from.
_PAGE_TYPES = frozenset(
    {
        "application/mathml+xml",
        "application/rdf+xml",
        "application/vnd.wap.xhtml+xml",
        "application/xhtml+xml",
        "application/xml",
        "image/svg+xml",
        "multipart/x-mixed-replace",
        "text/html",
        "text/rdf",
        "text/xml",
        "text/xsl",
    }
)
# Scripts still run, so WAVE's own report keeps working, but in an origin of their own.
_PAGE_POLICY = "sandbox allow-scripts"


class Entry(TypedDict):
    """One flat listing entry: a relative posix path plus its kind, size and mtime."""

    path: str
    kind: str
    size_bytes: int
    modified_at: str


def is_safe_relative_path(path: str) -> bool:
    """True for a non-empty relative posix path without empty or parent segments or a NUL."""
    parts = path.split("/")
    return not path.startswith("/") and "" not in parts and ".." not in parts and "\0" not in path


def contained_path(root: Path, rel: str, message: str) -> Path:
    """The canonical path of the entry rel names under root; ``.`` names root itself.

    The entry's real location and the real folder it sits in must both stay inside
    root's real location, else ValidationException(message). A link at the end stays
    the link, so a rename or delete acts on the link and never on its target.
    """
    if not is_safe_relative_path(rel):
        raise ValidationException(message)
    base = root.resolve()
    entry = base / rel
    real = _canonical_within(base, entry, message)
    if entry == base:
        return real
    folder = _canonical_within(base, entry.parent, message)
    return path_under(folder, entry.name)


def _canonical_within(base: Path, path: Path, message: str) -> Path:
    # The closing separator lets base itself pass and keeps a sibling such as base2 out.
    canonical = os.path.join(os.path.realpath(path), "")
    if not canonical.startswith(os.path.join(base, "")):
        raise ValidationException(message)
    real = Path(canonical)
    try:
        real.stat()
    except OSError as error:
        # A link loop has no real location; a missing entry still has its place.
        if error.errno == errno.ELOOP:
            raise ValidationException(message) from None
    return real


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
    media_type = content_type(path.name)
    return FileResponse(
        path,
        media_type=media_type,
        headers=download_headers(disposition, path.name, media_type),
    )


def download_headers(disposition: str, name: str, media_type: str) -> dict[str, str]:
    """The headers every file surface sends with a file's bytes of media_type."""
    if disposition not in _VALID_DISPOSITIONS:
        raise ValidationException(
            f"Invalid disposition '{disposition}': "
            f"valid values are {', '.join(_VALID_DISPOSITIONS)}"
        )
    return {
        "Content-Disposition": content_disposition(disposition, name),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        **isolation_headers(media_type),
    }


def isolation_headers(media_type: str) -> dict[str, str]:
    """The sandbox policy for a page type; no header for any other type."""
    if media_type in _PAGE_TYPES:
        return {"Content-Security-Policy": _PAGE_POLICY}
    return {}


def content_disposition(disposition: str, name: str) -> str:
    """A download's header value; a name that is not plain goes whole in the RFC 5987 form."""
    plain = _NOT_PLAIN.sub("", name)
    if plain == name:
        return f'{disposition}; filename="{name}"'
    encoded = quote(name, safe="", errors="replace")
    fallback = plain or _FALLBACK_DOWNLOAD_NAME
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"
