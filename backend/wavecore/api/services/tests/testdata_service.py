"""Per-test Test Data: the files a test reads, stored read-only under its own folder (REQ-3.4.3.2).

Every relative path goes through the shared safe-path rule plus a real-path
containment check; files are stored 0400 and folders 0500, and WAVE lifts the
write bit only around its own mutations (``_unlocked`` and ``_lock_tree`` are
the only permission sites).
"""

import contextlib
import functools
import os
import re
import shutil
import stat
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from typing import Any, BinaryIO, cast

from wavecore.api.exceptions import (
    ConflictException,
    InsufficientStorageException,
    InternalServerException,
    NotFoundException,
    ValidationException,
)
from wavecore.api.services import file_tree, shared
from wavecore.api.services.artifact_service import safe_filename_part
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.storage_paths import get_test_testdata_path, get_testdata_storage_path
from wavecore.api.services.tests import testdata_uploads

_LOW_DISK_SPACE_BYTES = 1024**3
_NAME_MAX_BYTES = 255
_INVALID_NAME_CHARS = re.compile(r"[/\\\x00-\x1f\x7f]")
_UPLOAD_PREFIX = "_upld-"
_ORPHAN_UPLOAD_SECONDS = 300
# Test data is WAVE's own storage: nothing outside the server process reads it.
_FILE_MODE = stat.S_IRUSR
_DIR_MODE = stat.S_IRUSR | stat.S_IXUSR
_WRITE_MODE = 0o600
# Live write-bit holds per folder, so one mutation never relocks under another.
_unlock_holds: dict[str, int] = {}
_unlock_guard = threading.Lock()
# The prefix plus the file name must still fit NAME_MAX (255 bytes).
_UPLOAD_STEM_MAX_BYTES = _NAME_MAX_BYTES - len(_UPLOAD_PREFIX)
_STORAGE_REFUSED = "Test data storage refused the write"


def _storage_write[Mutation: Callable[..., Any]](func: Mutation) -> Mutation:
    """A refused write is WAVE's own storage failing, so it answers as one."""

    @functools.wraps(func)
    def guarded(*args: Any, **kwargs: Any) -> Any:
        try:
            return func(*args, **kwargs)
        except PermissionError as exc:
            raise InternalServerException(_STORAGE_REFUSED) from exc

    return cast(Mutation, guarded)


# ---------------------------------------------------------------------------
# Lookups and validation
# ---------------------------------------------------------------------------


def _require_test(test_id: str) -> dict[str, Any]:
    # Local import: tests.service cascades into this module on delete and clone.
    from wavecore.api.services.tests import service as test_service

    test = test_service.get_test(test_id)
    if test is None:
        raise NotFoundException(f"Test not found: {test_id}")
    return test


def _root(test_id: str) -> Path:
    return get_test_testdata_path(test_id)


def check_name(name: str) -> None:
    """One path segment: 1-255 UTF-8 bytes, no separators or control characters, not . or .."""
    if (
        name in ("", ".", "..")
        or len(name.encode("utf-8")) > _NAME_MAX_BYTES
        or _INVALID_NAME_CHARS.search(name) is not None
    ):
        raise ValidationException(f"Invalid name: {name}")


def _resolve_under(root: Path, rel: str, *, must_exist: bool, allow_root: bool) -> Path:
    """Validate a relative path and pin it inside the test's folder by real path."""
    if rel == "" and allow_root:
        return root
    if not file_tree.is_safe_relative_path(rel):
        raise ValidationException(f"Invalid test data path: {rel}")
    path = root / rel
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValidationException(f"Invalid test data path: {rel}")
    if must_exist and not path.exists():
        raise NotFoundException(f"Test data entry not found: {rel}")
    return path


def _require_parent(root: Path, rel: str, target: Path) -> Path:
    """The parent folder of a new entry; it must already exist."""
    parent = target.parent
    if parent != root and not parent.is_dir():
        raise NotFoundException(f"Folder not found: {rel.rsplit('/', 1)[0]}")
    return parent


def _check_free_entry(target: Path, rel: str) -> None:
    if target.is_dir():
        raise ConflictException(f"Folder already exists: {rel}")
    if target.exists():
        raise ConflictException(f"File already exists: {rel}")


def _in_progress_name(name: str) -> str:
    """The name an upload carries until its last byte lands."""
    stem = name.encode("utf-8")[:_UPLOAD_STEM_MAX_BYTES].decode("utf-8", "ignore")
    return f"{_UPLOAD_PREFIX}{stem}"


def _is_in_progress(rel: str) -> bool:
    return any(segment.startswith(_UPLOAD_PREFIX) for segment in rel.split("/"))


def _entries(root: Path) -> list[file_tree.Entry]:
    """The flat listing with in-progress uploads hidden (one shared walk)."""
    return [entry for entry in file_tree.walk_entries(root) if not _is_in_progress(entry["path"])]


def _sweep_orphans(test_id: str, root: Path) -> None:
    """Remove abandoned in-progress uploads; a file a live upload still owns is never swept."""
    if not root.is_dir():
        return
    live = {
        _in_progress_name(rel.rsplit("/", 1)[-1])
        for rel in testdata_uploads.in_progress_paths(test_id)
    }
    cutoff = time.time() - _ORPHAN_UPLOAD_SECONDS
    for path in root.rglob(f"{_UPLOAD_PREFIX}*"):
        if path.name in live or path.is_symlink() or not path.is_file():
            continue
        if path.stat().st_mtime < cutoff:
            with _unlocked(path.parent):
                path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def _lock_tree(path: Path) -> None:
    """Set files 0400 and folders 0500 under path, path included."""
    entries = [path, *path.rglob("*")] if path.is_dir() else [path]
    for entry in entries:
        if not entry.is_symlink():
            os.chmod(entry, _DIR_MODE if entry.is_dir() else _FILE_MODE)


def _hold_unlocked(folder: Path) -> None:
    """Take one hold on a folder's write bit, lifting it for the first holder."""
    with _unlock_guard:
        held = _unlock_holds.get(str(folder), 0)
        if held == 0:
            os.chmod(folder, stat.S_IRWXU)
        _unlock_holds[str(folder)] = held + 1


def _drop_unlocked(folder: Path) -> None:
    """Release one hold; the last one out locks the folder again."""
    with _unlock_guard:
        held = _unlock_holds[str(folder)] - 1
        if held > 0:
            _unlock_holds[str(folder)] = held
            return
        del _unlock_holds[str(folder)]
        if folder.is_dir() and not folder.is_symlink():
            os.chmod(folder, _DIR_MODE)


@contextlib.contextmanager
def _unlocked_folder(folder: Path) -> Iterator[None]:
    _hold_unlocked(folder)
    try:
        yield
    finally:
        _drop_unlocked(folder)


@contextlib.contextmanager
def _unlocked(path: Path, *, recursive: bool = False) -> Iterator[None]:
    """Lift the write bit on a folder (its subfolders too when recursive) for one mutation.

    Holds nest and are counted per folder, so concurrent mutations on one folder
    never restore the write bit under each other.
    """
    folders = [path]
    if recursive:
        folders.extend(p for p in path.rglob("*") if p.is_dir() and not p.is_symlink())
    with contextlib.ExitStack() as stack:
        for folder in folders:
            stack.enter_context(_unlocked_folder(folder))
        yield


def _ensure_root(root: Path) -> None:
    """Create the test's folder locked, once, whichever concurrent mutation gets there first."""
    with _unlock_guard:
        if root.is_dir():
            return
        root.mkdir(parents=True)
        os.chmod(root, _DIR_MODE)


def _ensure_folder(root: Path, folder: Path) -> None:
    """Create a missing folder chain below root, each folder locked."""
    if folder == root or folder.is_dir():
        return
    _ensure_folder(root, folder.parent)
    with _unlocked(folder.parent):
        folder.mkdir()
    _lock_tree(folder)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def list_entries(test_id: str) -> dict[str, Any]:
    """Flat listing of the test's folder plus the file count and byte total."""
    _require_test(test_id)
    root = _root(test_id)
    _sweep_orphans(test_id, root)
    entries = _entries(root)
    files = [entry for entry in entries if entry["kind"] == "file"]
    return {
        "entries": entries,
        "total_files": len(files),
        "total_bytes": sum(entry["size_bytes"] for entry in files),
    }


def resolve_entry(
    test_id: str, rel: str, *, must_exist: bool = True, allow_root: bool = False
) -> Path:
    """Resolve a relative path inside the test's folder; "" needs allow_root."""
    _require_test(test_id)
    return _resolve_under(_root(test_id), rel, must_exist=must_exist, allow_root=allow_root)


def content_path(test_id: str, rel: str) -> Path:
    """The on-disk path of one file, for the content route."""
    path = resolve_entry(test_id, rel)
    if not path.is_file():
        raise NotFoundException(f"Test data entry not found: {rel}")
    return path


def zip_entry(test_id: str, rel: str, sink: BinaryIO) -> str:
    """Zip a folder ("" = the whole test folder) into sink; returns the download name."""
    test = _require_test(test_id)
    folder = _resolve_under(_root(test_id), rel, must_exist=True, allow_root=True)
    if rel and not folder.is_dir():
        raise ValidationException(f"Not a folder: {rel}")
    files: list[tuple[str, shared.ZipContent]] = [
        (f"{rel}/{entry['path']}" if rel else entry["path"], folder / entry["path"])
        for entry in _entries(folder)
        if entry["kind"] == "file"
    ]
    shared.build_export_zip(files, sink=sink)
    stem = rel.rsplit("/", 1)[-1] if rel else str(test.get("name") or test_id)
    return f"testdata-{safe_filename_part(stem, fallback=test_id)}.zip"


def iter_files(test_id: str) -> Iterator[tuple[str, Path]]:
    """(relative path, on-disk path) pairs of every file, for export and backup."""
    root = _root(test_id)
    for entry in _entries(root):
        if entry["kind"] == "file":
            yield entry["path"], root / entry["path"]


# ---------------------------------------------------------------------------
# Running guard
# ---------------------------------------------------------------------------


def _running_holders(test_id: str) -> list[str]:
    """Ids of the tracked executions and workbench sessions that hold the test."""
    # Local import: workbench.service imports tests.service, which cascades into this module.
    from wavecore.api.services.workbench import service as workbench_service

    return list(
        dict.fromkeys(
            [
                *exec_storage.get_active_executions_holding_test(test_id),
                *workbench_service.sessions_running_test(test_id),
            ]
        )
    )


def is_running(test_id: str) -> bool:
    """True while any tracked execution or workbench session holds the test."""
    return bool(_running_holders(test_id))


def assert_not_running(test_id: str) -> None:
    """409 while any tracked execution or workbench session holds the test."""
    test = _require_test(test_id)
    if is_running(test_id):
        raise ConflictException(
            f"Test '{test['name']}' is running; test data cannot be changed until it finishes",
            details={"execution_ids": _running_holders(test_id)},
        )


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------


class Upload:
    """One streamed file: it lives under the in-progress name until its last byte lands."""

    def __init__(self, folder: Path, name: str, rel: str) -> None:
        self._folder = folder
        self._name = name
        self._rel = rel
        self._temp = folder / _in_progress_name(name)
        with _unlocked(folder):
            try:
                handle = os.open(self._temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, _WRITE_MODE)
            except FileExistsError as exc:
                raise ConflictException(f"Upload already in progress: {rel}") from exc
        self._sink = os.fdopen(handle, "wb")
        self._size = 0

    def write(self, chunk: bytes) -> None:
        """Append one chunk, then re-check the reserve; the disk is the only size limit."""
        self._sink.write(chunk)
        self._size += len(chunk)
        if shutil.disk_usage(self._folder).free < _LOW_DISK_SPACE_BYTES:
            raise InsufficientStorageException(
                f"Storing {self._name} would leave less than 1 GB free"
            )

    @_storage_write
    def finish(self) -> dict[str, Any]:
        """Rename onto the final name and lock it; nothing half-written ever carries that name."""
        self._sink.close()
        target = self._folder / self._name
        replaced = target.exists()
        with _unlocked(self._folder):
            os.replace(self._temp, target)
        _lock_tree(target)
        return {"path": self._rel, "size_bytes": self._size, "replaced": replaced}

    @_storage_write
    def abort(self) -> None:
        """Drop the in-progress file; a stored file is never touched."""
        self._sink.close()
        with _unlocked(self._folder):
            self._temp.unlink(missing_ok=True)


@_storage_write
def begin_upload(
    test_id: str, folder: str, name: str, *, replace: bool, displace: bool = False
) -> Upload:
    """Run every pre-check, then open the in-progress file; no byte is accepted before this.

    ``displace`` is the retry of an attempt that was abandoned but still owns the
    in-progress name, which must never refuse itself (TDATA-17).
    """
    assert_not_running(test_id)
    check_name(name)
    root = _root(test_id)
    target_dir = _resolve_under(root, folder, must_exist=False, allow_root=True)
    if folder and not target_dir.is_dir():
        raise NotFoundException(f"Folder not found: {folder}")
    rel = f"{folder}/{name}" if folder else name
    if (target_dir / name).is_dir():
        raise ConflictException(f"Folder already exists: {rel}")
    if not replace and (target_dir / name).exists():
        raise ConflictException(f"File already exists: {rel}")
    _ensure_root(root)
    if displace:
        leftover = target_dir / _in_progress_name(name)
        with _unlocked(target_dir):
            leftover.unlink(missing_ok=True)
    return Upload(target_dir, name, rel)


def store_bytes(
    test_id: str, folder: str, name: str, data: bytes, *, replace: bool
) -> dict[str, Any]:
    """Store one file whose bytes are already in memory."""
    upload = begin_upload(test_id, folder, name, replace=replace)
    try:
        upload.write(data)
        return upload.finish()
    except BaseException:
        upload.abort()
        raise


def check_space(test_id: str, byte_count: int, name: str) -> None:
    """507 when storing that many more bytes would leave under 1 GiB free."""
    assert_not_running(test_id)
    probe = _root(test_id)
    while not probe.exists():
        probe = probe.parent
    if shutil.disk_usage(probe).free - byte_count < _LOW_DISK_SPACE_BYTES:
        raise InsufficientStorageException(f"Storing {name} would leave less than 1 GB free")


@_storage_write
def create_folder(test_id: str, path: str) -> str:
    """Create one folder under an existing parent; returns its relative path."""
    assert_not_running(test_id)
    root = _root(test_id)
    target = _resolve_under(root, path, must_exist=False, allow_root=False)
    check_name(target.name)
    parent = _require_parent(root, path, target)
    _check_free_entry(target, path)
    _ensure_root(root)
    with _unlocked(parent):
        try:
            target.mkdir()
        except FileExistsError as exc:
            raise ConflictException(f"Folder already exists: {path}") from exc
    _lock_tree(target)
    testdata_uploads.announce_entries(test_id)
    return path


@_storage_write
def rename_entry(test_id: str, rel: str, path: str) -> str:
    """Rename or move an entry within the test's folder; returns the new relative path."""
    assert_not_running(test_id)
    root = _root(test_id)
    source = _resolve_under(root, rel, must_exist=True, allow_root=False)
    target = _resolve_under(root, path, must_exist=False, allow_root=False)
    check_name(target.name)
    parent = _require_parent(root, path, target)
    _check_free_entry(target, path)
    with contextlib.ExitStack() as stack:
        for folder in {source.parent, parent}:
            stack.enter_context(_unlocked(folder))
        os.replace(source, target)
    testdata_uploads.announce_entries(test_id)
    return path


@_storage_write
def delete_entry(test_id: str, rel: str) -> None:
    """Remove a file, or a folder with everything inside it."""
    assert_not_running(test_id)
    entry = _resolve_under(_root(test_id), rel, must_exist=True, allow_root=False)
    with _unlocked(entry.parent):
        if entry.is_dir() and not entry.is_symlink():
            with _unlocked(entry, recursive=True):
                shutil.rmtree(entry)
        else:
            entry.unlink()
    testdata_uploads.announce_entries(test_id)


# ---------------------------------------------------------------------------
# Lifecycle: the files travel with the test
# ---------------------------------------------------------------------------


def delete_for_test(test_id: str) -> None:
    """Cascade: remove the test's whole folder; nothing to remove is not an error."""
    testdata_uploads.clear_for_test(test_id)
    root = _root(test_id)
    if not root.is_dir():
        return
    with _unlocked(root, recursive=True):
        shutil.rmtree(root)


def copy_for_clone(source_id: str, clone_id: str) -> None:
    """Give the clone a locked copy of the source's folder when the source has one."""
    source = _root(source_id)
    if not source.is_dir():
        return
    target = _root(clone_id)
    shutil.copytree(source, target)
    _lock_tree(target)


@_storage_write
def write_files(test_id: str, entries: Iterable[tuple[str, bytes]]) -> int:
    """Write archive entries under the test's folder (import and restore); returns the count."""
    root = _root(test_id)
    targets: list[tuple[Path, bytes]] = []
    for rel, data in entries:
        if not file_tree.is_safe_relative_path(rel):
            raise ValidationException(f"Invalid test data path: {rel}")
        for segment in rel.split("/"):
            check_name(segment)
        targets.append((_resolve_under(root, rel, must_exist=False, allow_root=False), data))
    if not targets:
        return 0
    _ensure_root(root)
    for target, data in targets:
        _ensure_folder(root, target.parent)
        with _unlocked(target.parent):
            if target.exists():
                target.unlink()
            target.write_bytes(data)
        _lock_tree(target)
    testdata_uploads.announce_entries(test_id)
    return len(targets)


def reset_zone() -> None:
    """Empty the whole Test Data zone, keeping the zone directory itself."""
    testdata_uploads.clear()
    zone = get_testdata_storage_path()
    if not zone.is_dir():
        return
    for child in zone.iterdir():
        if child.is_dir() and not child.is_symlink():
            delete_for_test(child.name)
        else:
            child.unlink()
