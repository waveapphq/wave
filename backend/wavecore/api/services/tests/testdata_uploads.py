"""What is in flight in a test's Test Data, and what did not land (TDATA-14, TDATA-15).

An upload belongs to the test rather than to the tab that started it, so every
session watching sees the same rows and a file that did not land leaves a notice
that outlives the tab. The state sits beside the other workbench state, in
memory, and goes out on the test's own topic.
"""

import time
from dataclasses import dataclass, field
from typing import Any

from wavecore.api.exceptions import ConflictException, NotFoundException
from wavecore.api.services.workbench import ownership
from wavecore.api.websocket import events

TOPIC_PREFIX = "testdata:"
# One frame per upload at most this often; a fast upload must not flood the topic.
PROGRESS_INTERVAL_SECONDS = 0.4

_ERR_UNKNOWN_UPLOAD = "No such upload"
_ERR_NOT_ALLOWED = (
    "Only the session holding the test, or the one that started it, can cancel an upload"
)
_ERR_CANCELED = "Upload canceled"


class UploadCanceled(ConflictException):
    """The upload was stopped on purpose, so it leaves no notice behind."""


@dataclass
class Upload:
    """One file on its way in."""

    id: str
    test_id: str
    folder: str
    name: str
    path: str
    total_bytes: int
    session: str
    replace: bool
    started_at: int
    loaded_bytes: int = 0
    canceled: bool = False
    sent_at: float = field(default=0.0, repr=False)


@dataclass
class Interruption:
    """One file that did not land, and why."""

    id: str
    folder: str
    name: str
    path: str
    reason: str
    replace: bool
    at: int


_uploads: dict[str, dict[str, Upload]] = {}
_interruptions: dict[str, dict[str, Interruption]] = {}


def topic_for(test_id: str) -> str:
    """The topic every session watching this test's files subscribes to."""
    return f"{TOPIC_PREFIX}{test_id}"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _eta_seconds(upload: Upload) -> int | None:
    """Seconds left at the rate so far; None while no rate can be measured yet.

    Worked out here rather than per session, so every session watching shows the
    same figure (TDATA-14).
    """
    if upload.total_bytes <= 0:
        return None
    remaining = upload.total_bytes - upload.loaded_bytes
    if remaining <= 0:
        return 0
    elapsed = _now_ms() - upload.started_at
    if upload.loaded_bytes <= 0 or elapsed <= 0:
        return None
    return round(remaining * elapsed / (upload.loaded_bytes * 1000))


def clear() -> None:
    """Drop every test's upload state."""
    _uploads.clear()
    _interruptions.clear()


def clear_for_test(test_id: str) -> None:
    """Cascade: the test is gone, so nothing about its files is worth keeping."""
    _uploads.pop(test_id, None)
    _interruptions.pop(test_id, None)


def snapshot(test_id: str) -> dict[str, Any]:
    """Everything in flight and everything that did not land, for one test."""
    return {
        "uploads": [
            {
                "id": upload.id,
                "folder": upload.folder,
                "name": upload.name,
                "path": upload.path,
                "total_bytes": upload.total_bytes,
                "loaded_bytes": upload.loaded_bytes,
                "eta_seconds": _eta_seconds(upload),
                "started_at": upload.started_at,
                "session": upload.session,
            }
            for upload in _uploads.get(test_id, {}).values()
        ],
        "interruptions": [
            {
                "id": record.id,
                "folder": record.folder,
                "name": record.name,
                "path": record.path,
                "reason": record.reason,
                "replace": record.replace,
                "at": record.at,
            }
            for record in _interruptions.get(test_id, {}).values()
        ],
    }


def _announce(test_id: str) -> None:
    events.emit(topic_for(test_id), {"event": "uploads_changed", **snapshot(test_id)})


def announce_entries(test_id: str) -> None:
    """Tell every session watching that the listing moved."""
    events.emit(topic_for(test_id), {"event": "entries_changed"})


def in_progress_paths(test_id: str) -> set[str]:
    """Relative paths a live upload still owns, so the orphan sweep leaves them alone."""
    return {upload.path for upload in _uploads.get(test_id, {}).values()}


def start(
    test_id: str,
    upload_id: str,
    *,
    folder: str,
    name: str,
    path: str,
    total_bytes: int,
    session: str,
    replace: bool,
) -> Upload:
    """Register a file that has started arriving, and say so."""
    upload = Upload(
        id=upload_id,
        test_id=test_id,
        folder=folder,
        name=name,
        path=path,
        total_bytes=total_bytes,
        session=session,
        replace=replace,
        started_at=_now_ms(),
    )
    _uploads.setdefault(test_id, {})[upload_id] = upload
    _announce(test_id)
    return upload


def advance(upload: Upload, chunk_bytes: int) -> None:
    """Count bytes in; a frame goes out at most once every PROGRESS_INTERVAL_SECONDS."""
    upload.loaded_bytes += chunk_bytes
    now = time.monotonic()
    if now - upload.sent_at < PROGRESS_INTERVAL_SECONDS:
        return
    upload.sent_at = now
    _announce(upload.test_id)


def is_canceled(upload: Upload) -> bool:
    """True once somebody entitled to stop this upload has done so."""
    return upload.canceled


def _drop(upload: Upload) -> bool:
    """Take the row out; False when somebody already did."""
    return _uploads.get(upload.test_id, {}).pop(upload.id, None) is not None


def finish(upload: Upload) -> None:
    """The file landed: the row goes, and any notice about that path goes with it."""
    _drop(upload)
    kept = _interruptions.get(upload.test_id)
    if kept is not None:
        _interruptions[upload.test_id] = {
            record_id: record for record_id, record in kept.items() if record.path != upload.path
        }
    _announce(upload.test_id)
    announce_entries(upload.test_id)


def abandon(upload: Upload) -> None:
    """The upload was canceled: announced once, kept nowhere, told to nobody later."""
    if not _drop(upload):
        return
    events.emit(
        topic_for(upload.test_id),
        {
            "event": "upload_canceled",
            "id": upload.id,
            "name": upload.name,
            "path": upload.path,
        },
    )
    _announce(upload.test_id)


def interrupt(
    test_id: str,
    upload_id: str,
    *,
    folder: str,
    name: str,
    path: str,
    reason: str,
    replace: bool,
) -> None:
    """Record why a file did not land; the notice outlives the tab that tried."""
    _uploads.get(test_id, {}).pop(upload_id, None)
    _interruptions.setdefault(test_id, {})[upload_id] = Interruption(
        id=upload_id,
        folder=folder,
        name=name,
        path=path,
        reason=reason,
        replace=replace,
        at=_now_ms(),
    )
    _announce(test_id)


def cancel(test_id: str, upload_id: str, session: str) -> None:
    """Stop one upload; only the session holding the test or the one that started it may."""
    upload = _uploads.get(test_id, {}).get(upload_id)
    if upload is None:
        raise NotFoundException(_ERR_UNKNOWN_UPLOAD)
    holder = ownership.get_holder()
    if session != upload.session and (holder is None or holder["id"] != session):
        raise ConflictException(_ERR_NOT_ALLOWED)
    # Announced now rather than when the transfer finally stops, which waits on
    # the sender's next chunk and leaves every other session watching a dead row.
    upload.canceled = True
    abandon(upload)


def canceled_error(upload: Upload) -> UploadCanceled:
    """The answer the canceled request itself gets."""
    return UploadCanceled(f"{_ERR_CANCELED}: {upload.path}")


def dismiss(test_id: str, record_id: str) -> None:
    """Clear one notice."""
    records = _interruptions.get(test_id, {})
    if record_id not in records:
        raise NotFoundException(_ERR_UNKNOWN_UPLOAD)
    del records[record_id]
    _announce(test_id)


def drop_interruption(test_id: str, record_id: str) -> None:
    """Clear one notice without a frame of its own; the retry that follows announces itself."""
    _interruptions.get(test_id, {}).pop(record_id, None)
