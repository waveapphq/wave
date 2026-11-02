"""The standard-library File I/O core shared by the local block and the remote bundle.

Eight synchronous operations on file paths (REQ-3.4.1.10): read, write, copy,
move, delete, stats, list_entries and create_folder. Each returns the block's
outputs for that operation and raises the exact execution messages. run
dispatches one request against raw paths, refuses a WAVE-side scheme and
normalizes every path before touching the disk, applies the block's defaults,
logs through the callable it is handed and answers the result envelope the
bundle materializes. Standard library only, and no name the remote interpreter
floor lacks.
"""

import hashlib
import os
import re
import shutil
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from typing import Any

Log = Callable[[str, str], None]

_DIGEST_CHUNK = 1 << 20
_WAVE_SCHEMES = ("testdata://", "artifact://")
_PATH_ROWS = {
    "read": ("path",),
    "write": ("path",),
    "copy": ("source", "destination"),
    "move": ("source", "destination"),
    "delete": ("path",),
    "stats": ("path",),
    "list": ("path",),
    "create_folder": ("path",),
}
_STAT_COLUMN_TYPES = {
    "exists": "boolean",
    "type": "string",
    "modified": "string",
    "size": "integer",
    "checksum": "string",
}
_LIST_COLUMNS = [
    ("name", "string"),
    ("path", "string"),
    ("type", "string"),
    ("modified", "string"),
]


def refuse_wave_scheme(path: str) -> None:
    """A WAVE-side scheme names nothing on the remote host, so it is refused untouched."""
    for scheme in _WAVE_SCHEMES:
        if path.startswith(scheme):
            raise ValueError(
                f"{scheme} paths are not available on the remote host - "
                "use an absolute or relative path on the remote host"
            )


def local_path(path: str) -> str:
    """The path made absolute with `..` collapsed, as on WAVE; a WAVE scheme is refused."""
    refuse_wave_scheme(path)
    return os.path.abspath(path)


def _table(columns: list[tuple[str, str]], rows: list[list[Any]]) -> dict[str, Any]:
    return {
        "__wave_type": "table",
        "columns": [{"name": name, "type": kind} for name, kind in columns],
        "rows": rows,
    }


def iso_modified(mtime: float) -> str:
    # The UTC constant alias is 3.11+; the remote bundle runs on 3.10 hosts (keep timezone.utc).
    return datetime.fromtimestamp(mtime, timezone.utc).isoformat()


def _digest(path: str, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_DIGEST_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _ensure_parent(path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)


def _copy_tree(source: str, destination: str) -> None:
    """Merge ``source`` into ``destination``; files are replaced, other entries kept."""
    with os.scandir(source) as entries:
        children = list(entries)
    os.makedirs(destination, exist_ok=True)
    for entry in children:
        target = os.path.join(destination, entry.name)
        if entry.is_dir():
            _copy_tree(entry.path, target)
        else:
            shutil.copyfile(entry.path, target)


def _check_transfer(source: str, destination: str, if_exists: str) -> None:
    if not os.path.exists(source):
        raise FileNotFoundError(f"Source not found: {source}")
    if os.path.isdir(destination) and not os.path.isdir(source):
        raise IsADirectoryError(f"Destination is a folder: {destination}")
    if if_exists == "fail" and os.path.exists(destination):
        raise FileExistsError(f"Destination exists and if_exists=fail: {destination}")


def read(path: str) -> dict[str, Any]:
    """The file's text as UTF-8, a leading byte-order mark dropped."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"File not found: {path}")
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        return {"content": raw.decode("utf-8-sig")}
    except UnicodeDecodeError as error:
        raise ValueError(f"File is not UTF-8 text: {path}") from error


def write(path: str, content: str, if_exists: str) -> dict[str, Any]:
    """Write UTF-8 text, creating missing parents; replace, append or fail on an existing file."""
    if os.path.isdir(path):
        raise IsADirectoryError(f"Destination is a folder: {path}")
    if if_exists == "fail" and os.path.exists(path):
        raise FileExistsError(f"File exists and if_exists=fail: {path}")
    _ensure_parent(path)
    mode = "a" if if_exists == "append" else "w"
    with open(path, mode, encoding="utf-8", newline="") as handle:
        handle.write(content)
    return {}


def copy(source: str, destination: str, if_exists: str) -> dict[str, Any]:
    """Copy a file or folder to the full target path; a folder merges under overwrite."""
    _check_transfer(source, destination, if_exists)
    _ensure_parent(destination)
    if os.path.isdir(source):
        _copy_tree(source, destination)
    else:
        shutil.copyfile(source, destination)
    return {}


def move(source: str, destination: str, if_exists: str) -> dict[str, Any]:
    """Copy semantics, then the source is removed; a same-filesystem move is a rename."""
    _check_transfer(source, destination, if_exists)
    _ensure_parent(destination)
    if os.path.isdir(source) and os.path.isdir(destination):
        _copy_tree(source, destination)
        shutil.rmtree(source)
    else:
        shutil.move(source, destination)
    return {}


def delete(path: str, missing_ok: bool) -> dict[str, Any]:
    """Unlink a file or remove a folder with everything inside it."""
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.lexists(path):
        os.remove(path)
    elif not missing_ok:
        raise FileNotFoundError(f"Nothing to delete: {path}")
    return {}


def _folder_size(folder: str) -> int:
    """Bytes of every file below a folder, at every depth; unreadable entries count as nothing."""
    total = 0
    try:
        with os.scandir(folder) as entries:
            for entry in entries:
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    total += _folder_size(entry.path)
                else:
                    total += entry.stat().st_size
    except OSError:
        return total
    return total


def _stat_values(path: str, size: bool, checksum: str) -> dict[str, Any]:
    exists = os.path.exists(path)
    is_file = os.path.isfile(path)
    kind = ""
    if exists:
        kind = "file" if is_file else "folder"
    values: dict[str, Any] = {
        "exists": exists,
        "type": kind,
        "modified": iso_modified(os.stat(path).st_mtime) if exists else "",
    }
    if size:
        values["size"] = _entry_size(path, is_file) if exists else 0
    if checksum != "none":
        values["checksum"] = _digest(path, checksum) if is_file else ""
    return values


def _entry_size(path: str, is_file: bool) -> int:
    """A file's own bytes, or everything a folder holds."""
    return os.path.getsize(path) if is_file else _folder_size(path)


def stats(path: str, size: bool, checksum: str, output_format: str) -> dict[str, Any]:
    """Whether the path is there and what it is; never fails on a missing path."""
    values = _stat_values(path, size, checksum)
    if output_format == "map":
        return {"stats": values}
    if output_format == "table":
        columns = [(name, _STAT_COLUMN_TYPES[name]) for name in values]
        return {"stats": _table(columns, [list(values.values())])}
    return values


def _walk(folder: str, prefix: str, recursive: bool) -> Iterator[tuple[os.DirEntry[str], str]]:
    """Every listable entry below ``folder`` with its posix path relative to the listed root."""
    with os.scandir(folder) as entries:
        for entry in entries:
            if entry.is_symlink():
                continue
            is_dir = entry.is_dir()
            if is_dir and entry.name.startswith("."):
                continue
            relative = prefix + entry.name
            yield entry, relative
            if is_dir and recursive:
                yield from _walk(entry.path, relative + "/", recursive)


def _entry_row(entry: os.DirEntry[str], relative: str, size: bool) -> list[Any]:
    is_dir = entry.is_dir()
    row: list[Any] = [
        entry.name,
        relative,
        "folder" if is_dir else "file",
        iso_modified(entry.stat().st_mtime),
    ]
    if size:
        row.append(_folder_size(entry.path) if is_dir else entry.stat().st_size)
    return row


def list_entries(path: str, pattern: str, recursive: bool, size: bool) -> dict[str, Any]:
    """The folder's entries as a table sorted by path, plus their count."""
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Folder not found: {path}")
    matcher = re.compile(pattern)
    rows = [
        _entry_row(entry, relative, size)
        for entry, relative in _walk(path, "", recursive)
        if matcher.search(entry.name)
    ]
    rows.sort(key=lambda row: row[1])
    columns = list(_LIST_COLUMNS)
    if size:
        columns.append(("size", "integer"))
    return {"entries": _table(columns, rows), "count": len(rows)}


def create_folder(path: str) -> dict[str, Any]:
    """Make the folder and its missing parents; an existing folder is not an error."""
    if os.path.lexists(path) and not os.path.isdir(path):
        raise NotADirectoryError(f"Not a folder: {path}")
    os.makedirs(path, exist_ok=True)
    return {}


def _run_read(params: dict[str, Any], log: Log) -> dict[str, Any]:
    path = params["path"]
    outputs = read(path)
    log("INFO", f"Read {len(outputs['content'])} characters from {path}")
    return outputs


def _run_write(params: dict[str, Any], log: Log) -> dict[str, Any]:
    path = params["path"]
    content = params["content"]
    outputs = write(path, content, params.get("if_exists") or "overwrite")
    log("INFO", f"Wrote {len(content)} characters to {path}")
    return outputs


def _run_copy(params: dict[str, Any], log: Log) -> dict[str, Any]:
    source, destination = params["source"], params["destination"]
    outputs = copy(source, destination, params.get("if_exists") or "overwrite")
    log("INFO", f"Copied {source} to {destination}")
    return outputs


def _run_move(params: dict[str, Any], log: Log) -> dict[str, Any]:
    source, destination = params["source"], params["destination"]
    outputs = move(source, destination, params.get("if_exists") or "overwrite")
    log("INFO", f"Moved {source} to {destination}")
    return outputs


def _run_delete(params: dict[str, Any], log: Log) -> dict[str, Any]:
    path = params["path"]
    existed = os.path.lexists(path)
    outputs = delete(path, bool(params.get("missing_ok")))
    log("INFO", f"Deleted {path}" if existed else f"Nothing to delete: {path}")
    return outputs


def _run_stats(params: dict[str, Any], log: Log) -> dict[str, Any]:
    path = params["path"]
    outputs = stats(
        path,
        bool(params.get("size")),
        params.get("checksum") or "none",
        params.get("output_format") or "individual",
    )
    log("INFO", f"Reported stats for {path}")
    return outputs


def _run_list(params: dict[str, Any], log: Log) -> dict[str, Any]:
    path = params["path"]
    outputs = list_entries(
        path,
        params.get("pattern") or "",
        bool(params.get("recursive")),
        bool(params.get("size")),
    )
    log("INFO", f"Listed {outputs['count']} entries in {path}")
    return outputs


def _run_create_folder(params: dict[str, Any], log: Log) -> dict[str, Any]:
    path = params["path"]
    existed = os.path.isdir(path)
    outputs = create_folder(path)
    log("INFO", f"Folder already exists: {path}" if existed else f"Created folder {path}")
    return outputs


_RUNNERS: dict[str, Callable[[dict[str, Any], Log], dict[str, Any]]] = {
    "read": _run_read,
    "write": _run_write,
    "copy": _run_copy,
    "move": _run_move,
    "delete": _run_delete,
    "stats": _run_stats,
    "list": _run_list,
    "create_folder": _run_create_folder,
}


def run(params: dict[str, Any], log: Log) -> dict[str, Any]:
    """Worker entry: one request on raw paths, answered as the result envelope."""
    operation = params["operation"]
    # On WAVE every path arrives resolved, so this only changes anything on the remote host.
    paths = {name: local_path(params[name]) for name in _PATH_ROWS[operation]}
    outputs = _RUNNERS[operation]({**params, **paths}, log)
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
