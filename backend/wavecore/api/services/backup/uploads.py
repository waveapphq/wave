"""Backup archives kept between the requests of one restore, outside the data folder."""

import tempfile
import threading
import uuid
from dataclasses import dataclass
from functools import partial
from pathlib import Path

from wavecore.api.exceptions import NotFoundException, ValidationException

IDLE_SECONDS = 30 * 60
# The expiry timer of one kept upload: EXPIRY(seconds, callback).
EXPIRY = threading.Timer

_FOLDER_PREFIX = "wave-backup-uploads-"
_ERR_BOTH = "Send the backup file or an upload ID, not both"
_ERR_NEITHER = "Send the backup file or an upload ID"


class BackupUploadNotFound(NotFoundException):
    """The upload ID names no kept archive."""

    error_code = "BACKUP_UPLOAD_NOT_FOUND"
    message = "Backup upload not found"


@dataclass
class _Kept:
    """One kept archive and the timer that drops it."""

    path: Path
    filename: str
    timer: threading.Timer
    generation: int = 0


# Reentrant: making the folder again clears first.
_lock = threading.RLock()
_kept: dict[str, _Kept] = {}
_folder: tempfile.TemporaryDirectory[str] | None = None


def _private_folder() -> Path:
    """The folder of the kept archives, made on first use."""
    global _folder
    # A host may clean its temp files, so a folder that is gone is made again.
    if _folder is None or not Path(_folder.name).is_dir():
        clear()
        _folder = tempfile.TemporaryDirectory(prefix=_FOLDER_PREFIX, ignore_cleanup_errors=True)
    return Path(_folder.name)


def _forget(upload_id: str) -> None:
    kept = _kept.pop(upload_id, None)
    if kept is not None:
        kept.timer.cancel()
        kept.path.unlink(missing_ok=True)


def _sweep() -> None:
    """Drop every upload whose file is gone."""
    gone = [upload_id for upload_id, kept in _kept.items() if not kept.path.is_file()]
    for upload_id in gone:
        _forget(upload_id)


def _expire(upload_id: str, generation: int) -> None:
    """Drop an upload whose idle time is over, unless it was used or dropped meanwhile."""
    with _lock:
        kept = _kept.get(upload_id)
        if kept is not None and kept.generation == generation:
            _forget(upload_id)


def _armed(upload_id: str, generation: int) -> threading.Timer:
    """A running timer that ends the upload after IDLE_SECONDS without use."""
    timer = EXPIRY(IDLE_SECONDS, partial(_expire, upload_id, generation))
    timer.daemon = True
    timer.start()
    return timer


def keep(content: bytes, filename: str) -> str:
    """Keep an archive for the requests that follow and answer its new ID."""
    with _lock:
        _sweep()
        upload_id = uuid.uuid4().hex
        path = _private_folder() / upload_id
        path.write_bytes(content)
        _kept[upload_id] = _Kept(path=path, filename=filename, timer=_armed(upload_id, 0))
        return upload_id


def source(content: bytes | None, filename: str, upload_id: str | None) -> tuple[bytes, str]:
    """The archive of a request that sent the file or the ID of a kept upload."""
    with _lock:
        _sweep()
        if content is not None and upload_id is not None:
            raise ValidationException(_ERR_BOTH)
        if content is not None:
            return content, filename
        if upload_id is None:
            raise ValidationException(_ERR_NEITHER)
        kept = _kept.get(upload_id)
        if kept is None:
            raise BackupUploadNotFound()
        kept.timer.cancel()
        kept.generation += 1
        kept.timer = _armed(upload_id, kept.generation)
        return kept.path.read_bytes(), kept.filename


def drop(upload_id: str) -> None:
    """Remove one kept archive; an unknown ID is ignored."""
    with _lock:
        _sweep()
        _forget(upload_id)


def clear() -> None:
    """Remove every kept archive and the folder."""
    global _folder
    with _lock:
        for kept in _kept.values():
            kept.timer.cancel()
        _kept.clear()
        if _folder is not None:
            _folder.cleanup()
            _folder = None
