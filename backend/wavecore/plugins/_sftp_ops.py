"""The SFTP block's seven operations on an open SSH session's server, run on WAVE (REQ-3.4.1.8)."""

import asyncio
import os
import posixpath
import re
import secrets
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any, NamedTuple

import asyncssh

from wavecore.connectivity.k8s.verbs._outputs import block_failure, block_success, summary_table
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins._file_ops import iso_modified
from wavecore.plugins._file_paths import (
    _READ_ONLY_MESSAGE,
    has_wildcard,
    name_matches,
    resolve_plugin_matches,
    resolve_plugin_path,
)
from wavecore.plugins._shared_params import number_setting, plural
from wavecore.plugins._ssh_session import (
    SFTPUnavailable,
    close_sftp_client,
    open_sftp_client,
    require_session,
)

OPERATIONS = ("upload", "download", "list", "stats", "delete", "move", "create_folder")
LABELS = {
    "upload": "Upload",
    "download": "Download",
    "list": "List",
    "stats": "Stats",
    "delete": "Delete",
    "move": "Move",
    "create_folder": "Create folder",
}
TIMEOUT_DEFAULT = 300
MAX_SIZE_MIB_DEFAULT = 1024
MAX_FILES_DEFAULT = 10_000
REASONS = (
    "Why the block failed: SessionClosed, SftpUnavailable, NoMatch, NotFound, NotAFolder, "
    "Conflict, Exists, ReadOnly, TooManyFiles, TooLarge, UnsafeEntry, Refused, "
    "PermissionDenied, ConnectionLost, ServerFailure, LocalFailure or Timeout; empty otherwise"
)
_SUMMARY_COLUMNS = [("source", "string"), ("destination", "string"), ("size", "integer")]
_ENTRY_COLUMNS = [
    ("name", "string"),
    ("path", "string"),
    ("type", "string"),
    ("modified", "string"),
    ("size", "integer"),
]
_CLEANUP_SECONDS = 5
_MIB = 1_048_576
_FOLDER = asyncssh.FILEXFER_TYPE_DIRECTORY
_LINK = asyncssh.FILEXFER_TYPE_SYMLINK
_FILE = asyncssh.FILEXFER_TYPE_REGULAR
_NOT_THERE = (asyncssh.SFTPNoSuchFile, asyncssh.SFTPNoSuchPath)
_LOST = (asyncssh.SFTPConnectionLost, asyncssh.SFTPNoConnection, asyncssh.DisconnectError)

Log = Callable[[str, str], None]


class SFTPBlockFailure(Exception):
    """A run-time failure with its Reason code; On error decides what it does."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason


@dataclass(frozen=True)
class WaveSide:
    """What the WAVE side of a transfer resolves against."""

    artifacts_dir: str | None
    testdata_dirs: list[str] | None


@dataclass(frozen=True)
class Landing:
    """Where a download lands on WAVE, and whether that is a folder receiving the names."""

    path: Path
    folder: bool


class RemoteEntry(NamedTuple):
    """One server entry as the block reached it."""

    path: str
    name: str
    attrs: asyncssh.SFTPAttrs


class LocalEntry(NamedTuple):
    """One WAVE entry of an upload, with its posix path below the matched source."""

    path: Path
    relative: str
    folder: bool
    size: int


class PlannedEntry(NamedTuple):
    """One file or folder of a transfer plan; a plan runs in target order."""

    target: str
    source: str
    size: int
    folder: bool


@dataclass(frozen=True)
class _Remote:
    """The block's SFTP channel and the session it rides."""

    sftp: asyncssh.SFTPClient
    record: dict[str, Any]
    session_id: str
    label: str


Step = Callable[[_Remote], Awaitable[dict[str, Any]]]


def home_or_root_message(path: str, verb: str) -> str:
    return (
        f"{path} names the account's home, a folder above it or the SFTP server's root folder "
        f"and cannot be {verb}"
    )


def _normal(path: str) -> str:
    """A path with runs of / collapsed and its . and .. segments folded."""
    return posixpath.normpath(re.sub("/+", "/", path.strip()))


def names_home_or_root(path: str) -> bool:
    """True when a Delete Path or Move Source names the server root or the home (SFTP-5)."""
    normal = _normal(path)
    return normal in ("/", ".", "~") or set(normal.split("/")) == {".."}


def partial_path(target: Path) -> Path:
    """The hidden name a download writes under until it is complete (SFTP-7)."""
    return target.with_name(f".{target.name}.{secrets.token_hex(4)}.part")


def empty_outputs(operation: str, done: list[list[Any]]) -> dict[str, Any]:
    """The outputs a recorded failure returns; Summary keeps the files that completed."""
    if operation in ("upload", "download"):
        return {"summary": summary_table(_SUMMARY_COLUMNS, done)}
    if operation == "list":
        return {"entries": summary_table(_ENTRY_COLUMNS, []), "count": 0}
    if operation == "stats":
        return {"exists": False, "type": "", "size": 0, "modified": ""}
    return {}


def _row(params: dict[str, Any], name: str) -> str:
    return str(params.get(name) or "").strip()


def _bare(path: str) -> str:
    """The path without trailing slashes; the root stays /."""
    return path.rstrip("/") or path[:1]


def _leaf(path: str) -> str:
    """The name a path gives what it names; . and .. give none, so nothing lands above."""
    name = posixpath.basename(_bare(path))
    return "" if name in (".", "..") else name


def _size(attrs: asyncssh.SFTPAttrs) -> int:
    return 0 if attrs.type == _FOLDER else attrs.size or 0


@contextmanager
def _server(remote: _Remote, path: str) -> Iterator[None]:
    """A server call's asyncssh failure as the block's message naming that call's path."""
    try:
        yield
    except asyncssh.SFTPPermissionDenied as exc:
        raise SFTPBlockFailure(
            f"Permission denied on the SFTP server: {path}", "PermissionDenied"
        ) from exc
    except _NOT_THERE as exc:
        raise SFTPBlockFailure(f"Not found on the SFTP server: {path}", "NotFound") from exc
    except _LOST as exc:
        raise SFTPBlockFailure(
            f"SSH session '{remote.session_id}' to {remote.record['host']} was lost during "
            f"{remote.label}: {str(exc) or type(exc).__name__}",
            "ConnectionLost",
        ) from exc
    except asyncssh.SFTPError as exc:
        raise SFTPBlockFailure(
            f"The SFTP server refused {remote.label} on {path}: {exc.reason}", "ServerFailure"
        ) from exc


@contextmanager
def _wave(path: Path, verb: str) -> Iterator[None]:
    """A WAVE disk call's OS error as the block's message naming the WAVE path."""
    try:
        yield
    except PermissionError as exc:
        raise SFTPBlockFailure(f"Permission denied on WAVE: {path}", "PermissionDenied") from exc
    except OSError as exc:
        raise SFTPBlockFailure(
            f"WAVE could not {verb} {path}: {exc.strerror or exc}", "LocalFailure"
        ) from exc


@contextmanager
def _resolving() -> Iterator[None]:
    """The WAVE path resolvers' refusals, passed on verbatim with their Reason."""
    try:
        yield
    except FileNotFoundError as exc:
        raise SFTPBlockFailure(str(exc), "NotFound") from exc
    except ValueError as exc:
        reason = "ReadOnly" if str(exc) == _READ_ONLY_MESSAGE else "LocalFailure"
        raise SFTPBlockFailure(str(exc), reason) from exc


def _check_name(name: str, folder: str) -> None:
    """Refuse a server entry name that could land outside the destination (SFTP-7)."""
    if not name or "/" in name or "\\" in name:
        raise SFTPBlockFailure(
            f"Unsafe entry name {name!r} in {folder} on the SFTP server: a name holding / or \\ "
            "could land outside the destination",
            "UnsafeEntry",
        )


def _check_shape(count: int, into_folder: bool, source: str, destination: str) -> None:
    if count > 1 and not into_folder:
        raise SFTPBlockFailure(
            f"{count} paths match {source}, so Destination must be an existing folder or end "
            f"with /: {destination}",
            "NotAFolder",
        )


def _check_kind(item: PlannedEntry, folder_there: bool | None) -> None:
    """A folder may not land on a file, nor a file on a folder."""
    if folder_there is None or folder_there == item.folder:
        return
    kind = "file" if item.folder else "folder"
    raise SFTPBlockFailure(f"Destination is a {kind}: {item.target}", "Conflict")


def _exists(target: str) -> SFTPBlockFailure:
    return SFTPBlockFailure(
        f"Destination exists and If the file exists is Fail the block: {target}", "Exists"
    )


def _check_collisions(files: list[PlannedEntry], present: list[bool]) -> None:
    for item, there in zip(files, present, strict=True):
        if there:
            raise _exists(item.target)


def check_download_limits(files: list[PlannedEntry], params: dict[str, Any], source: str) -> None:
    """Max files, then Max size (MiB), before anything is written; 0 means no limit (SFTP-6)."""
    max_files = number_setting(params, "max_files", MAX_FILES_DEFAULT)
    max_size_mib = number_setting(params, "max_size_mib", MAX_SIZE_MIB_DEFAULT)
    if max_files and len(files) > max_files:
        raise SFTPBlockFailure(
            f"Download of {source} holds {len(files)} files, more than the {max_files} Max files "
            "allows; download fewer files or raise Max files",
            "TooManyFiles",
        )
    total = sum(item.size for item in files)
    if max_size_mib and total > max_size_mib * _MIB:
        raise SFTPBlockFailure(
            f"Download of {source} is {total} bytes, larger than the {max_size_mib} MiB Max size "
            "(MiB) allows; download a narrower path or raise Max size (MiB)",
            "TooLarge",
        )


def _transferred(verb: str, done: list[list[Any]], source: str, destination: str) -> str:
    total = sum(row[2] for row in done)
    files = plural(len(done), "file", "files")
    return f"{verb} {files}, {total} bytes, from {source} to {destination}"


async def _attrs(remote: _Remote, path: str, *, follow: bool = True) -> asyncssh.SFTPAttrs | None:
    """A server path's attributes, or None when nothing is there."""
    with _server(remote, path):
        try:
            return await remote.sftp.stat(path, follow_symlinks=follow)
        except _NOT_THERE:
            return None


async def _is_server_folder(remote: _Remote, path: str) -> bool:
    attrs = await _attrs(remote, path)
    return attrs is not None and attrs.type == _FOLDER


async def _listing(remote: _Remote, folder: str) -> list[tuple[str, asyncssh.SFTPAttrs]]:
    """A server folder's entries by name, without . and ..; a missing folder has none."""
    with _server(remote, folder):
        try:
            names = await remote.sftp.readdir(folder)
        except _NOT_THERE:
            return []
    entries = [(str(name.filename), name.attrs) for name in names]
    return sorted(
        (entry for entry in entries if entry[0] not in (".", "..")), key=lambda entry: entry[0]
    )


async def _matching(remote: _Remote, prefixes: list[str], segment: str) -> list[RemoteEntry]:
    return [
        RemoteEntry(prefix + name, name, attrs)
        for prefix in prefixes
        for name, attrs in await _listing(remote, _bare(prefix) or ".")
        if name_matches(name, segment)
    ]


async def expand_remote(remote: _Remote, pattern: str) -> list[RemoteEntry]:
    """Every server entry a wildcard names, segment by segment, as the listing reports it."""
    segments = pattern.split("/")
    first = next(index for index, segment in enumerate(segments) if has_wildcard(segment))
    tail = segments[first:]
    prefixes = [pattern[: len(pattern) - len("/".join(tail))]]
    for segment in tail[:-1]:
        # Links are not followed from one wildcard segment into the next.
        found = await _matching(remote, prefixes, segment)
        prefixes = [f"{entry.path}/" for entry in found if entry.attrs.type == _FOLDER]
    return sorted(await _matching(remote, prefixes, tail[-1]), key=lambda entry: entry.path)


async def _followed(remote: _Remote, entries: list[RemoteEntry]) -> list[RemoteEntry]:
    """Matches with links followed; a broken link names nothing."""
    found = await asyncio.gather(*(_attrs(remote, entry.path) for entry in entries))
    return [
        entry._replace(attrs=attrs)
        for entry, attrs in zip(entries, found, strict=True)
        if attrs is not None
    ]


async def walk_remote(
    remote: _Remote, root: str, log: Log, prefix: str = ""
) -> list[tuple[RemoteEntry, str]]:
    """A folder download's tree read with readdir, with each entry's path below the root."""
    found: list[tuple[RemoteEntry, str]] = []
    for name, attrs in await _listing(remote, root):
        _check_name(name, root)
        entry = RemoteEntry(posixpath.join(root, name), name, attrs)
        if attrs.type == _LINK:
            log("INFO", f"Skipped symbolic link {entry.path}")
            continue
        relative = prefix + name
        found.append((entry, relative))
        if attrs.type == _FOLDER:
            found.extend(await walk_remote(remote, entry.path, log, f"{relative}/"))
    return found


def walk_local(root: Path, log: Log, prefix: str = "") -> list[LocalEntry]:
    """Every file and folder below root, hidden names included; links skipped as sftp -r does."""
    with _wave(root, "read"), os.scandir(root) as listing:
        children = sorted(listing, key=lambda child: child.name)
    found: list[LocalEntry] = []
    for child in children:
        path = root / child.name
        if child.is_symlink():
            log("INFO", f"Skipped symbolic link {path}")
            continue
        relative = prefix + child.name
        with _wave(path, "read"):
            folder = child.is_dir()
            size = 0 if folder else child.stat().st_size
        found.append(LocalEntry(path, relative, folder, size))
        if folder:
            found.extend(walk_local(path, log, f"{relative}/"))
    return found


def _local_tree(match: Path, log: Log) -> list[LocalEntry]:
    with _wave(match, "read"):
        folder = match.is_dir()
        size = 0 if folder else match.stat().st_size
    top = LocalEntry(match, "", folder, size)
    return [top, *walk_local(match, log)] if folder else [top]


def _outcome_seen(task: asyncio.Future[Any]) -> None:
    # An abandoned transfer ends after the block; reading its outcome keeps asyncio quiet.
    _ = task.cancelled() or task.exception()


async def _detached(transfer: Awaitable[None]) -> None:
    """Await a get or put; Stop or Timeout abandons it, as a stalled server holds a canceled one."""
    task = asyncio.ensure_future(transfer)
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        task.cancel()
        task.add_done_callback(_outcome_seen)
        raise


async def _remove_partial(record: dict[str, Any], target: str) -> None:
    """Best effort: remove a half-sent file over a fresh channel, bounded (SFTP-7)."""
    with suppress(Exception):
        async with asyncio.timeout(_CLEANUP_SECONDS):
            fresh = await open_sftp_client(record)
            try:
                await fresh.remove(target)
            finally:
                close_sftp_client(fresh)


async def _send(remote: _Remote, source: str, target: str) -> None:
    try:
        await _detached(remote.sftp.put(source, target))
    except (OSError, asyncssh.SFTPPermissionDenied, *_NOT_THERE):
        # Refused before the target was opened, so nothing this run wrote is there.
        raise
    except BaseException:
        await _remove_partial(remote.record, target)
        raise


async def _receive(remote: _Remote, source: str, target: Path) -> int:
    partial_file = partial_path(target)
    try:
        await _detached(remote.sftp.get(source, partial_file, follow_symlinks=True))
        os.replace(partial_file, target)
    except BaseException:
        with suppress(OSError):
            partial_file.unlink()
        raise
    return target.stat().st_size


async def _check_server_targets(remote: _Remote, items: list[PlannedEntry], fail: bool) -> None:
    found = await asyncio.gather(*(_attrs(remote, item.target) for item in items))
    for item, attrs in zip(items, found, strict=True):
        _check_kind(item, None if attrs is None else attrs.type == _FOLDER)
    if fail:
        files = [item for item in items if not item.folder]
        there = await asyncio.gather(*(_attrs(remote, item.target, follow=False) for item in files))
        _check_collisions(files, [attrs is not None for attrs in there])


def _check_wave_targets(items: list[PlannedEntry], fail: bool) -> None:
    for item in items:
        target = Path(item.target)
        _check_kind(item, target.is_dir() if os.path.lexists(target) else None)
    if fail:
        files = [item for item in items if not item.folder]
        _check_collisions(files, [os.path.lexists(item.target) for item in files])


async def upload(
    remote: _Remote,
    *,
    params: dict[str, Any],
    sources: list[Path],
    log: Log,
    done: list[list[Any]],
) -> dict[str, Any]:
    """Send each WAVE match to the server in target order (SFTP-3, SFTP-5, SFTP-7)."""
    source, destination = _row(params, "source"), _row(params, "destination")
    trees = [_local_tree(match, log) for match in sources]
    into = destination.endswith("/") or await _is_server_folder(remote, destination)
    _check_shape(len(trees), into, source, destination)
    items: list[PlannedEntry] = []
    for tree in trees:
        root = posixpath.join(destination, tree[0].path.name) if into else destination
        items.extend(
            PlannedEntry(
                _bare(posixpath.join(root, entry.relative)),
                str(entry.path),
                entry.size,
                entry.folder,
            )
            for entry in tree
        )
    items.sort()
    await _check_server_targets(remote, items, params.get("if_exists") == "fail")
    made: set[str] = set()
    for item in items:
        folder = item.target if item.folder else posixpath.dirname(item.target) or "."
        if folder not in made:
            with _server(remote, folder):
                await remote.sftp.makedirs(folder, exist_ok=True)
            made.add(folder)
        if item.folder:
            continue
        with _wave(Path(item.source), "read"), _server(remote, item.target):
            await _send(remote, item.source, item.target)
        done.append([item.source, item.target, item.size])
    log("INFO", _transferred("Uploaded", done, source, destination))
    return {"summary": summary_table(_SUMMARY_COLUMNS, done)}


async def _download_tops(remote: _Remote, source: str) -> list[RemoteEntry]:
    if has_wildcard(source):
        matches = await expand_remote(remote, _bare(source))
        for match in matches:
            _check_name(match.name, _bare(match.path.removesuffix(match.name)) or ".")
        tops = await _followed(remote, matches)
        if not tops:
            raise SFTPBlockFailure(f"Nothing on the SFTP server matches {source}", "NoMatch")
        return tops
    attrs = await _attrs(remote, _bare(source))
    if attrs is None:
        raise SFTPBlockFailure(f"Source not found on the SFTP server: {source}", "NotFound")
    return [RemoteEntry(_bare(source), _leaf(source), attrs)]


async def _remote_tree(
    remote: _Remote, top: RemoteEntry, log: Log
) -> list[tuple[RemoteEntry, str]]:
    if top.attrs.type != _FOLDER:
        return [(top, "")]
    return [(top, ""), *await walk_remote(remote, top.path, log)]


async def download(
    remote: _Remote,
    *,
    params: dict[str, Any],
    landing: Landing,
    wave: WaveSide,
    log: Log,
    done: list[list[Any]],
) -> dict[str, Any]:
    """Bring each server match to WAVE under a temporary name, in target order (SFTP-5..SFTP-7)."""
    source, row = _row(params, "source"), _row(params, "destination")
    tops = await _download_tops(remote, source)
    items: list[PlannedEntry] = []
    for top in tops:
        root = landing.path / top.name if landing.folder else landing.path
        items.extend(
            PlannedEntry(
                str(root / relative), entry.path, _size(entry.attrs), entry.attrs.type == _FOLDER
            )
            for entry, relative in await _remote_tree(remote, top, log)
        )
    items.sort()
    check_download_limits([item for item in items if not item.folder], params, source)
    _check_shape(len(tops), landing.folder, source, row)
    _check_wave_targets(items, params.get("if_exists") == "fail")
    artifacts = Path(wave.artifacts_dir).resolve() if wave.artifacts_dir else None
    for item in items:
        target = Path(item.target)
        with _wave(target, "write"):
            os.makedirs(target if item.folder else target.parent, exist_ok=True)
        if item.folder:
            continue
        with _wave(target, "write"), _server(remote, item.source):
            size = await _receive(remote, item.source, target)
        done.append([item.source, item.target, size])
        if artifacts is not None and target.is_relative_to(artifacts):
            relative = target.relative_to(artifacts).as_posix()
            log("INFO", f"Saved artifact://{relative} at {target}, {size} bytes")
    log("INFO", _transferred("Downloaded", done, source, row or "the run's files"))
    return {"summary": summary_table(_SUMMARY_COLUMNS, done)}


def _entry_row(entry: RemoteEntry) -> list[Any]:
    kind = "folder" if entry.attrs.type == _FOLDER else "file"
    modified = iso_modified(entry.attrs.mtime or 0)
    return [entry.name, entry.path, kind, modified, _size(entry.attrs)]


async def _listed(remote: _Remote, folder: str, recursive: bool) -> list[RemoteEntry]:
    """A folder's listable entries (FIO-7): links and hidden folders skipped."""
    found: list[RemoteEntry] = []
    for name, attrs in await _listing(remote, folder):
        if attrs.type == _LINK or (attrs.type == _FOLDER and name.startswith(".")):
            continue
        entry = RemoteEntry(posixpath.join(folder, name), name, attrs)
        found.append(entry)
        if recursive and attrs.type == _FOLDER:
            found.extend(await _listed(remote, entry.path, recursive))
    return found


async def _list_path(remote: _Remote, path: str, recursive: bool) -> list[RemoteEntry]:
    attrs = await _attrs(remote, path)
    if attrs is None:
        return []
    if attrs.type == _FOLDER:
        return await _listed(remote, path, recursive)
    return [RemoteEntry(path, _leaf(path), attrs)]


async def list_entries(remote: _Remote, *, params: dict[str, Any], log: Log) -> dict[str, Any]:
    """A folder's entries, a file, or a pattern's matches; nothing there is Count 0 (SFTP-3)."""
    path = _row(params, "path")
    recursive = params.get("recursive") is True
    if has_wildcard(path):
        found: list[RemoteEntry] = []
        for match in await _followed(remote, await expand_remote(remote, _bare(path))):
            found.append(match)
            if recursive and match.attrs.type == _FOLDER:
                found.extend(await _listed(remote, match.path, recursive))
    else:
        found = await _list_path(remote, path, recursive)
    rows = sorted((_entry_row(entry) for entry in found), key=lambda row: str(row[1]))
    log("INFO", f"Listed {plural(len(rows), 'entry', 'entries')} in {path}")
    return {"entries": summary_table(_ENTRY_COLUMNS, rows), "count": len(rows)}


async def stats(remote: _Remote, *, params: dict[str, Any], log: Log) -> dict[str, Any]:
    """Whether the path is there and what it is; a missing path is not a failure (SFTP-9)."""
    path = _row(params, "path")
    attrs = await _attrs(remote, path)
    log("INFO", f"Reported stats for {path}")
    if attrs is None:
        return empty_outputs("stats", [])
    return {
        "exists": True,
        "type": "folder" if attrs.type == _FOLDER else "file",
        "size": _size(attrs),
        "modified": iso_modified(attrs.mtime or 0),
    }


async def _remove(remote: _Remote, path: str, attrs: asyncssh.SFTPAttrs) -> None:
    """A folder goes with its tree; a link or file is removed alone."""
    with _server(remote, path):
        if attrs.type == _FOLDER:
            await remote.sftp.rmtree(path)
        else:
            await remote.sftp.remove(path)


def _holds(folder: str, path: str) -> bool:
    """True when a canonical server path is the folder itself or sits inside it."""
    return path == folder or path.startswith(folder.rstrip("/") + "/")


async def _refuse_home_or_above(remote: _Remote, path: str, resolved: list[str], verb: str) -> None:
    """Server-resolved paths are checked against the home before anything changes (SFTP-5)."""
    with _server(remote, path):
        home = await remote.sftp.realpath(".")
    if any(_holds(folder, home) for folder in resolved):
        raise SFTPBlockFailure(home_or_root_message(path, verb), "Refused")


async def delete(remote: _Remote, *, params: dict[str, Any], log: Log) -> dict[str, Any]:
    """Remove a file, a folder tree or every match; links are removed as links (SFTP-5)."""
    path = _row(params, "path")
    if has_wildcard(path):
        targets = await expand_remote(remote, _bare(path))
        line = f"Deleted {plural(len(targets), 'match', 'matches')} of {path}"
    else:
        attrs = await _attrs(remote, _bare(path), follow=False)
        targets = [] if attrs is None else [RemoteEntry(_bare(path), _leaf(path), attrs)]
        line = f"Deleted {path}"
    if not targets:
        if params.get("missing_ok") is not True:
            raise SFTPBlockFailure(f"Nothing to delete: {path}", "NotFound")
        log("INFO", f"Nothing to delete: {path}")
        return {}
    with _server(remote, path):
        resolved = await asyncio.gather(*(remote.sftp.realpath(entry.path) for entry in targets))
    await _refuse_home_or_above(remote, path, resolved, "deleted")
    for target in targets:
        await _remove(remote, target.path, target.attrs)
    log("INFO", line)
    return {}


async def _replace_file(remote: _Remote, source: str, target: str) -> None:
    with _server(remote, source):
        try:
            await remote.sftp.posix_rename(source, target)
        except asyncssh.SFTPOpUnsupported:
            await remote.sftp.remove(target)
            await remote.sftp.rename(source, target)


async def _canonical(remote: _Remote, path: str) -> str:
    """The server's spelling of a path; a final link is kept as itself, not followed."""
    name = _leaf(path)
    folder = posixpath.dirname(_bare(path)) if name else path
    with _server(remote, path):
        real = await remote.sftp.realpath(folder or ".")
    return _bare(posixpath.join(real, name))


async def _check_occupied(
    remote: _Remote, params: dict[str, Any], source: str, real: str, target: str
) -> None:
    """Fail the block refuses first; Replace it never removes the source or its holder (SFTP-5)."""
    if params.get("if_exists") == "fail":
        raise _exists(target)
    if _holds(await _canonical(remote, target), real):
        raise SFTPBlockFailure(
            f"Cannot move {source} to {target}: the target is the source itself or a folder "
            "holding it",
            "Conflict",
        )


async def move(remote: _Remote, *, params: dict[str, Any], log: Log) -> dict[str, Any]:
    """Rename or move on the server; Replace it removes what is at the target first (SFTP-5)."""
    source, destination = _row(params, "source"), _row(params, "destination")
    moving = _normal(source)
    source_attrs = await _attrs(remote, moving, follow=False)
    if source_attrs is None:
        raise SFTPBlockFailure(f"Source not found on the SFTP server: {source}", "NotFound")
    real = await _canonical(remote, moving)
    await _refuse_home_or_above(remote, source, [real], "moved")
    into = destination.endswith("/") or await _is_server_folder(remote, destination)
    target = posixpath.join(_bare(destination), _leaf(moving)) if into else destination
    there = await _attrs(remote, target, follow=False)
    if there is not None:
        await _check_occupied(remote, params, source, real, target)
    if there is not None and source_attrs.type == _FILE and there.type == _FILE:
        await _replace_file(remote, moving, target)
    else:
        if there is None:
            parent = posixpath.dirname(target) or "."
            with _server(remote, parent):
                await remote.sftp.makedirs(parent, exist_ok=True)
        else:
            await _remove(remote, target, there)
        with _server(remote, source):
            await remote.sftp.rename(moving, target)
    log("INFO", f"Moved {source} to {target}")
    return {}


async def create_folder(remote: _Remote, *, params: dict[str, Any], log: Log) -> dict[str, Any]:
    """Make the folder with its missing parents; an existing folder is not an error (SFTP-5)."""
    path = _row(params, "path")
    attrs = await _attrs(remote, path, follow=False)
    if attrs is not None and attrs.type != _FOLDER:
        raise SFTPBlockFailure(f"Not a folder on the SFTP server: {path}", "NotAFolder")
    if attrs is None:
        with _server(remote, path):
            await remote.sftp.makedirs(_bare(path), exist_ok=True)
    log("INFO", f"Created folder {path}" if attrs is None else f"Folder already exists: {path}")
    return {}


_ON_SERVER: dict[str, Callable[..., Awaitable[dict[str, Any]]]] = {
    "list": list_entries,
    "stats": stats,
    "delete": delete,
    "move": move,
    "create_folder": create_folder,
}


def _upload_sources(source: str, wave: WaveSide) -> list[Path]:
    if has_wildcard(source):
        with _resolving():
            matches = resolve_plugin_matches(source, wave.artifacts_dir, wave.testdata_dirs)
        if not matches:
            raise SFTPBlockFailure(f"Nothing on WAVE matches {source}", "NoMatch")
        return matches
    with _resolving():
        path = resolve_plugin_path(
            source, wave.artifacts_dir, wave.testdata_dirs, read_only_ok=True
        )
    if not path.exists():
        raise SFTPBlockFailure(f"Source not found on WAVE: {source}", "NotFound")
    return [path]


def _landing(destination: str, wave: WaveSide) -> Landing:
    with _resolving():
        path = resolve_plugin_path(
            destination or "artifact://",
            wave.artifacts_dir,
            wave.testdata_dirs,
            read_only_ok=False,
        )
    return Landing(path, not destination or destination.endswith("/") or path.is_dir())


def prepare_wave_side(
    operation: str, params: dict[str, Any], wave: WaveSide, log: Log, done: list[list[Any]]
) -> Step:
    """Settle the WAVE side before the session is touched; the step then runs on the server."""
    if operation == "upload":
        sources = _upload_sources(_row(params, "source"), wave)
        return partial(upload, params=params, sources=sources, log=log, done=done)
    if operation == "download":
        landing = _landing(_row(params, "destination"), wave)
        return partial(download, params=params, landing=landing, wave=wave, log=log, done=done)
    return partial(_ON_SERVER[operation], params=params, log=log)


async def _operate(
    operation: str,
    params: dict[str, Any],
    log: Log,
    registry: SSHSessionRegistry | None,
    wave: WaveSide,
    done: list[list[Any]],
) -> dict[str, Any]:
    step = prepare_wave_side(operation, params, wave, log, done)
    session_id = _row(params, "session_id")
    try:
        record = require_session(registry, session_id)
    except ValueError as exc:
        raise SFTPBlockFailure(str(exc), "SessionClosed") from exc
    try:
        sftp = await open_sftp_client(record)
    except SFTPUnavailable as exc:
        raise SFTPBlockFailure(
            f"SFTP is not available on {record['host']} through SSH session '{session_id}': "
            f"{exc.detail}",
            "SftpUnavailable",
        ) from exc
    try:
        return await step(_Remote(sftp, record, session_id, LABELS[operation]))
    finally:
        close_sftp_client(sftp)


async def run(
    params: dict[str, Any],
    log: Log,
    *,
    registry: SSHSessionRegistry | None,
    wave: WaveSide,
) -> dict[str, Any]:
    """Worker entry: the whole block inside one Timeout, answered as the result envelope."""
    operation = str(params.get("operation") or "upload")
    timeout = number_setting(params, "timeout", TIMEOUT_DEFAULT)
    done: list[list[Any]] = []
    try:
        async with asyncio.timeout(timeout):
            outputs = await _operate(operation, params, log, registry, wave, done)
    except SFTPBlockFailure as exc:
        failure = exc
    except TimeoutError:
        message = f"{LABELS[operation]} did not finish within {timeout} seconds"
        failure = SFTPBlockFailure(message, "Timeout")
    else:
        return {"__wave_type": "result", "outputs": block_success(outputs), "secrets": []}
    recorded = block_failure(
        params,
        empty_outputs(operation, done),
        failure.message,
        failure.reason,
        log,
        action=LABELS[operation],
    )
    return {"__wave_type": "result", "outputs": recorded, "secrets": []}
