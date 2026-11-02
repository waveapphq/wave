"""The backup archives kept between the requests of one restore."""

import re
import shutil
import stat
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path

import pytest

from tests.api.backup_support import (
    FakeExpiryTimer,
    disk_state,
    expiry_timers_fixture,  # noqa: F401
    kept_uploads_cleared_fixture,  # noqa: F401
)
from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.services import storage_paths
from wavecore.api.services.backup import uploads

_UPLOAD_ID = r"^[0-9a-f]{32}$"
_NOT_FOUND = r"^Backup upload not found$"
_NEVER_KEPT = "0" * 32
_REAL_EXPIRY = uploads.EXPIRY

# No test of this file waits on a real timer unless it puts the real one back.
pytestmark = pytest.mark.usefixtures("expiry_timers")


@pytest.fixture(name="host_temp", autouse=True)
def host_temp_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The folder ``tempfile`` hands out temp locations in, one of the test's own."""
    folder = tmp_path / "host-temp"
    folder.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(folder))
    return folder


def _folders(host_temp: Path) -> list[Path]:
    return sorted(host_temp.iterdir())


def _kept_files(host_temp: Path) -> dict[str, bytes]:
    """Every file under the host's temp folder: name to content."""
    return {path.name: path.read_bytes() for path in host_temp.rglob("*") if path.is_file()}


def _assert_unknown(upload_id: str) -> None:
    with pytest.raises(uploads.BackupUploadNotFound, match=_NOT_FOUND):
        uploads.source(None, "ignored.zip", upload_id)


def _is_armed(timer: FakeExpiryTimer) -> bool:
    """True for a running daemon timer of the idle time."""
    return (timer.seconds, timer.daemon, timer.started, timer.canceled) == (
        uploads.IDLE_SECONDS,
        True,
        True,
        False,
    )


class TestKeep:
    """keep() writes the bytes into the private folder and answers a new id."""

    def test_keep_answers_a_new_32_character_hex_id_each_time(self) -> None:
        first = uploads.keep(b"one", "one.zip")
        second = uploads.keep(b"one", "one.zip")

        assert re.fullmatch(_UPLOAD_ID, first)
        assert re.fullmatch(_UPLOAD_ID, second)
        assert first != second

    def test_keep_writes_each_upload_as_one_file_of_one_private_folder(
        self, host_temp: Path
    ) -> None:
        first = uploads.keep(b"first archive", "first.zip")
        second = uploads.keep(b"second archive", "second.zip")

        (folder,) = _folders(host_temp)
        assert folder.is_dir()
        assert stat.S_IMODE(folder.stat().st_mode) == 0o700
        assert {path.name: path.read_bytes() for path in folder.iterdir()} == {
            first: b"first archive",
            second: b"second archive",
        }

    def test_the_private_folder_is_not_under_the_data_folder(self, host_temp: Path) -> None:
        data_folder = storage_paths.get_base_path()
        before = disk_state()

        uploads.keep(b"archive", "backup.zip")

        (folder,) = _folders(host_temp)
        assert folder.parent == host_temp
        assert not folder.resolve().is_relative_to(data_folder.resolve())
        assert disk_state() == before

    def test_the_upload_file_name_is_never_part_of_the_kept_path(self, host_temp: Path) -> None:
        upload_id = uploads.keep(b"archive", "../../outside.zip")

        (folder,) = _folders(host_temp)
        assert [path.name for path in folder.iterdir()] == [upload_id]
        assert _kept_files(host_temp) == {upload_id: b"archive"}
        assert uploads.source(None, "ignored.zip", upload_id) == (b"archive", "../../outside.zip")


class TestSource:
    """source() is the one rule "the file or an upload ID"."""

    def test_source_answers_the_file_when_only_the_file_was_sent(self, host_temp: Path) -> None:
        assert uploads.source(b"sent", "sent.zip", None) == (b"sent", "sent.zip")
        assert _folders(host_temp) == []

    def test_an_empty_file_is_still_the_file(self) -> None:
        assert uploads.source(b"", "empty.zip", None) == (b"", "empty.zip")

    def test_source_answers_the_kept_bytes_and_file_name_when_only_the_id_was_sent(self) -> None:
        upload_id = uploads.keep(b"kept archive", "nightly.zip")

        assert uploads.source(None, "ignored.zip", upload_id) == (b"kept archive", "nightly.zip")

    def test_source_reads_a_kept_upload_as_often_as_asked(self) -> None:
        upload_id = uploads.keep(b"kept archive", "nightly.zip")

        answers = [uploads.source(None, "ignored.zip", upload_id) for _ in range(3)]

        assert answers == [(b"kept archive", "nightly.zip")] * 3

    def test_source_refuses_the_file_together_with_an_id(self) -> None:
        upload_id = uploads.keep(b"kept archive", "nightly.zip")

        with pytest.raises(
            ValidationException, match=r"^Send the backup file or an upload ID, not both$"
        ) as refusal:
            uploads.source(b"sent", "sent.zip", upload_id)

        assert refusal.value.status_code == 400
        assert refusal.value.error_code == "VALIDATION_ERROR"

    def test_source_refuses_a_request_with_neither(self) -> None:
        with pytest.raises(
            ValidationException, match=r"^Send the backup file or an upload ID$"
        ) as refusal:
            uploads.source(None, "ignored.zip", None)

        assert refusal.value.status_code == 400
        assert refusal.value.error_code == "VALIDATION_ERROR"

    def test_source_answers_not_found_for_an_id_never_kept(self) -> None:
        with pytest.raises(uploads.BackupUploadNotFound, match=_NOT_FOUND) as refusal:
            uploads.source(None, "ignored.zip", _NEVER_KEPT)

        assert isinstance(refusal.value, NotFoundException)
        assert refusal.value.status_code == 404
        assert refusal.value.error_code == "BACKUP_UPLOAD_NOT_FOUND"

    def test_an_id_naming_a_path_reads_no_file_outside_the_record(self, host_temp: Path) -> None:
        upload_id = uploads.keep(b"kept archive", "nightly.zip")
        (host_temp / "outside.bin").write_bytes(b"not an upload")

        for crafted in ("../outside.bin", f"./{upload_id}", str(host_temp / "outside.bin")):
            _assert_unknown(crafted)


class TestDrop:
    """drop() removes one kept file."""

    def test_drop_removes_the_kept_file(self, host_temp: Path) -> None:
        upload_id = uploads.keep(b"archive", "backup.zip")

        uploads.drop(upload_id)

        assert _kept_files(host_temp) == {}
        _assert_unknown(upload_id)

    def test_drop_leaves_the_other_uploads(self, host_temp: Path) -> None:
        dropped = uploads.keep(b"first", "first.zip")
        kept = uploads.keep(b"second", "second.zip")

        uploads.drop(dropped)

        assert _kept_files(host_temp) == {kept: b"second"}
        assert uploads.source(None, "ignored.zip", kept) == (b"second", "second.zip")

    def test_drop_of_an_unknown_id_is_ignored(self, host_temp: Path) -> None:
        kept = uploads.keep(b"archive", "backup.zip")

        uploads.drop(_NEVER_KEPT)
        uploads.drop(kept)
        uploads.drop(kept)

        assert _kept_files(host_temp) == {}

    def test_an_id_naming_a_path_removes_no_file_outside_the_record(self, host_temp: Path) -> None:
        upload_id = uploads.keep(b"archive", "backup.zip")
        outside = host_temp / "outside.bin"
        outside.write_bytes(b"not an upload")

        for crafted in ("../outside.bin", f"./{upload_id}", str(outside)):
            uploads.drop(crafted)

        assert _kept_files(host_temp) == {upload_id: b"archive", "outside.bin": b"not an upload"}


class TestExpiryTimer:
    """Every kept upload has a timer of its own that drops it after IDLE_SECONDS without use."""

    def test_the_idle_time_is_thirty_minutes(self) -> None:
        assert uploads.IDLE_SECONDS == 30 * 60

    def test_keep_arms_a_daemon_timer_for_the_idle_time(
        self, expiry_timers: list[FakeExpiryTimer]
    ) -> None:
        uploads.keep(b"archive", "backup.zip")

        (timer,) = expiry_timers
        assert _is_armed(timer)

    def test_a_timer_that_fires_drops_its_upload_and_the_file(
        self, expiry_timers: list[FakeExpiryTimer], host_temp: Path
    ) -> None:
        idle = uploads.keep(b"idle archive", "idle.zip")
        other = uploads.keep(b"other archive", "other.zip")

        expiry_timers[0].fire()

        assert _kept_files(host_temp) == {other: b"other archive"}
        _assert_unknown(idle)
        assert uploads.source(None, "ignored.zip", other) == (b"other archive", "other.zip")

    def test_a_read_cancels_the_timer_and_arms_a_new_one(
        self, expiry_timers: list[FakeExpiryTimer]
    ) -> None:
        upload_id = uploads.keep(b"archive", "backup.zip")

        uploads.source(None, "ignored.zip", upload_id)

        first, second = expiry_timers
        assert first.canceled
        assert _is_armed(second)

    def test_a_timer_replaced_by_a_read_does_nothing_when_it_fires(
        self, expiry_timers: list[FakeExpiryTimer], host_temp: Path
    ) -> None:
        upload_id = uploads.keep(b"archive", "backup.zip")
        uploads.source(None, "ignored.zip", upload_id)

        expiry_timers[0].fire()

        assert _kept_files(host_temp) == {upload_id: b"archive"}
        assert uploads.source(None, "ignored.zip", upload_id) == (b"archive", "backup.zip")

    def test_only_the_newest_timer_of_an_upload_drops_it(
        self, expiry_timers: list[FakeExpiryTimer], host_temp: Path
    ) -> None:
        upload_id = uploads.keep(b"archive", "backup.zip")
        uploads.source(None, "ignored.zip", upload_id)
        uploads.source(None, "ignored.zip", upload_id)
        first, second, newest = expiry_timers

        first.fire()
        second.fire()
        assert _kept_files(host_temp) == {upload_id: b"archive"}

        newest.fire()
        assert _kept_files(host_temp) == {}
        _assert_unknown(upload_id)

    def test_a_request_with_the_file_arms_no_timer(
        self, expiry_timers: list[FakeExpiryTimer]
    ) -> None:
        uploads.source(b"sent", "sent.zip", None)

        assert expiry_timers == []

    def test_a_refused_request_leaves_the_timer_running(
        self, expiry_timers: list[FakeExpiryTimer]
    ) -> None:
        upload_id = uploads.keep(b"archive", "backup.zip")

        with pytest.raises(ValidationException):
            uploads.source(b"sent", "sent.zip", upload_id)

        (timer,) = expiry_timers
        assert _is_armed(timer)

    def test_drop_cancels_the_timer_of_the_upload(
        self, expiry_timers: list[FakeExpiryTimer]
    ) -> None:
        dropped = uploads.keep(b"first", "first.zip")
        uploads.keep(b"second", "second.zip")

        uploads.drop(dropped)

        assert [timer.canceled for timer in expiry_timers] == [True, False]

    def test_clear_cancels_every_timer(self, expiry_timers: list[FakeExpiryTimer]) -> None:
        uploads.keep(b"first", "first.zip")
        uploads.keep(b"second", "second.zip")

        uploads.clear()

        assert [timer.canceled for timer in expiry_timers] == [True, True]

    def test_a_timer_that_fires_after_drop_does_nothing(
        self, expiry_timers: list[FakeExpiryTimer], host_temp: Path
    ) -> None:
        dropped = uploads.keep(b"first", "first.zip")
        kept = uploads.keep(b"second", "second.zip")
        uploads.drop(dropped)

        expiry_timers[0].fire()

        assert _kept_files(host_temp) == {kept: b"second"}

    def test_a_timer_that_fires_after_clear_does_nothing(
        self, expiry_timers: list[FakeExpiryTimer], host_temp: Path
    ) -> None:
        uploads.keep(b"archive", "backup.zip")
        uploads.clear()

        expiry_timers[0].fire()

        assert _folders(host_temp) == []


class TestRealTimer:
    """Outside the tests the expiry timer is ``threading.Timer``."""

    @pytest.fixture(name="real_timers")
    def real_timers_fixture(
        self, expiry_timers: list[FakeExpiryTimer], monkeypatch: pytest.MonkeyPatch
    ) -> list[threading.Timer]:
        """The real timers the test's uploads arm, oldest first."""
        armed: list[threading.Timer] = []

        def recorded(seconds: float, callback: Callable[[], None]) -> threading.Timer:
            armed.append(_REAL_EXPIRY(seconds, callback))
            return armed[-1]

        monkeypatch.setattr(uploads, "EXPIRY", recorded)
        return armed

    def test_the_seam_is_the_threading_timer(self) -> None:
        assert _REAL_EXPIRY is threading.Timer

    def test_the_armed_timer_is_a_daemon_that_waits_for_the_idle_time(
        self, real_timers: list[threading.Timer]
    ) -> None:
        upload_id = uploads.keep(b"archive", "backup.zip")

        (timer,) = real_timers
        assert timer.daemon
        assert timer.is_alive()
        assert timer.interval == uploads.IDLE_SECONDS
        uploads.drop(upload_id)
        timer.join(timeout=5)
        assert not timer.is_alive()

    def test_the_timer_drops_the_upload_when_the_idle_time_is_over(
        self, real_timers: list[threading.Timer], monkeypatch: pytest.MonkeyPatch, host_temp: Path
    ) -> None:
        monkeypatch.setattr(uploads, "IDLE_SECONDS", 0.01)

        upload_id = uploads.keep(b"archive", "backup.zip")
        (timer,) = real_timers
        timer.join(timeout=5)

        assert not timer.is_alive()
        assert _kept_files(host_temp) == {}
        _assert_unknown(upload_id)


_GUARDED: dict[str, Callable[[], object]] = {
    "keep": lambda: uploads.keep(b"next", "next.zip"),
    "source": lambda: uploads.source(b"sent", "sent.zip", None),
    "drop": lambda: uploads.drop(_NEVER_KEPT),
    "clear": uploads.clear,
    "timer": lambda: FakeExpiryTimer.made[-1].fire(),
}


class TestLock:
    """The timer thread and the requests share the kept uploads under one lock."""

    @pytest.mark.parametrize("guarded", sorted(_GUARDED))
    def test_every_entry_point_waits_for_the_lock(self, guarded: str) -> None:
        uploads.keep(b"archive", "backup.zip")
        worker = threading.Thread(target=_GUARDED[guarded], daemon=True)

        with uploads._lock:
            worker.start()
            worker.join(timeout=0.05)
            waited = worker.is_alive()
        worker.join(timeout=5)

        assert waited
        assert not worker.is_alive()

    def test_the_thread_that_holds_the_lock_can_take_it_again(self) -> None:
        with uploads._lock:
            taken_again = uploads._lock.acquire(blocking=False)

        assert taken_again
        uploads._lock.release()


class TestClear:
    """clear() ends every kept upload and the folder."""

    def test_clear_removes_every_kept_upload_and_the_folder(self, host_temp: Path) -> None:
        first = uploads.keep(b"first", "first.zip")
        second = uploads.keep(b"second", "second.zip")

        uploads.clear()

        assert _folders(host_temp) == []
        _assert_unknown(first)
        _assert_unknown(second)

    def test_clear_with_nothing_kept_does_nothing(self, host_temp: Path) -> None:
        uploads.clear()
        uploads.clear()

        assert _folders(host_temp) == []

    def test_keep_after_clear_uses_a_new_folder(self, host_temp: Path) -> None:
        uploads.keep(b"first", "first.zip")
        (old_folder,) = _folders(host_temp)
        uploads.clear()

        upload_id = uploads.keep(b"second", "second.zip")

        (new_folder,) = _folders(host_temp)
        assert new_folder != old_folder
        assert _kept_files(host_temp) == {upload_id: b"second"}


class TestFilesTheHostRemoved:
    """A host that cleans its temp files loses the uploads, never the feature."""

    def test_an_upload_whose_file_is_gone_is_unknown(
        self, expiry_timers: list[FakeExpiryTimer], host_temp: Path
    ) -> None:
        lost = uploads.keep(b"lost archive", "lost.zip")
        kept = uploads.keep(b"kept archive", "kept.zip")
        (folder,) = _folders(host_temp)
        (folder / lost).unlink()

        _assert_unknown(lost)
        assert [timer.canceled for timer in expiry_timers] == [True, False]
        assert uploads.source(None, "ignored.zip", kept) == (b"kept archive", "kept.zip")

    def test_keep_makes_the_folder_again_when_it_is_gone(
        self, expiry_timers: list[FakeExpiryTimer], host_temp: Path
    ) -> None:
        lost = uploads.keep(b"lost archive", "lost.zip")
        (old_folder,) = _folders(host_temp)
        shutil.rmtree(old_folder)

        upload_id = uploads.keep(b"new archive", "new.zip")

        lost_timer, new_timer = expiry_timers
        assert lost_timer.canceled
        assert _is_armed(new_timer)
        assert _kept_files(host_temp) == {upload_id: b"new archive"}
        assert uploads.source(None, "ignored.zip", upload_id) == (b"new archive", "new.zip")
        _assert_unknown(lost)

    def test_clear_does_not_mind_a_folder_that_is_gone(self, host_temp: Path) -> None:
        uploads.keep(b"archive", "backup.zip")
        (folder,) = _folders(host_temp)
        shutil.rmtree(folder)

        uploads.clear()

        assert _folders(host_temp) == []
