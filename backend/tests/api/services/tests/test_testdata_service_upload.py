"""Streamed single-file upload into a test's own Test Data folder (REQ-3.4.3.2)."""

import re
import threading
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from tests.api.services.tests.conftest import (
    mode_of,
    seed_file,
    seed_folder,
    store,
    testdata_root,
)
from wavecore.api.exceptions import (
    ConflictException,
    InsufficientStorageException,
    InternalServerException,
    NotFoundException,
    ValidationException,
)
from wavecore.api.services.tests import testdata_service

_ONE_GIB = 1024**3


def _disk_with_free(free: int) -> SimpleNamespace:
    return SimpleNamespace(total=free * 2, used=free, free=free)


def _in_progress(test_id: str) -> list[str]:
    root = testdata_root(test_id)
    if not root.exists():
        return []
    return [path.name for path in root.rglob("*") if path.name.startswith("_upld-")]


class TestBeginUploadNameValidation:
    """Every name is checked before the in-progress file is created."""

    @pytest.mark.parametrize(
        "name",
        [
            "",
            "fixtures/customers.csv",
            "fixtures\\customers.csv",
            "customers\x00.csv",
            "customers\n.csv",
            "customers\t.csv",
            ".",
            "..",
        ],
    )
    def test_an_invalid_name_is_refused(self, test_id: str, name: str) -> None:
        """The message names the rejected name verbatim."""
        with pytest.raises(ValidationException, match=rf"^Invalid name: {re.escape(name)}$"):
            testdata_service.begin_upload(test_id, "", name, replace=False)

    def test_a_name_of_255_bytes_is_accepted(self, test_id: str) -> None:
        """The upper bound is inclusive."""
        name = "a" * 255

        result = store(test_id, name, b"x")

        assert result["path"] == name

    def test_a_name_of_256_bytes_is_refused(self, test_id: str) -> None:
        """One byte past the bound is refused."""
        name = "a" * 256

        with pytest.raises(ValidationException, match=rf"^Invalid name: {name}$"):
            testdata_service.begin_upload(test_id, "", name, replace=False)

    def test_the_length_bound_counts_utf_8_bytes_not_characters(self, test_id: str) -> None:
        """128 two-byte characters is 256 bytes, so it is refused."""
        name = "é" * 128

        with pytest.raises(ValidationException, match=rf"^Invalid name: {name}$"):
            testdata_service.begin_upload(test_id, "", name, replace=False)

    def test_a_leading_dot_name_is_accepted(self, test_id: str) -> None:
        """Only '.' and '..' themselves are refused, not every dotted name."""
        result = store(test_id, ".env.fixture", b"x")

        assert result["path"] == ".env.fixture"

    def test_an_invalid_name_creates_no_in_progress_file(self, test_id: str) -> None:
        """Nothing is opened before the name passes."""
        with pytest.raises(ValidationException):
            testdata_service.begin_upload(test_id, "", "..", replace=False)

        assert _in_progress(test_id) == []


class TestBeginUploadTargetFolder:
    """The target folder is a relative path; the empty string is the root."""

    def test_an_empty_folder_targets_the_root(self, test_id: str) -> None:
        """Files land directly in the test's folder."""
        store(test_id, "customers.csv", b"x")

        assert (testdata_root(test_id) / "customers.csv").read_bytes() == b"x"

    def test_an_existing_subfolder_receives_the_file(self, test_id: str) -> None:
        """A nested target folder is used as given."""
        seed_folder(test_id, "fixtures/data")

        result = store(test_id, "fixtures/data/customers.csv", b"x")

        assert result["path"] == "fixtures/data/customers.csv"
        assert (testdata_root(test_id) / "fixtures/data/customers.csv").read_bytes() == b"x"

    def test_an_unsafe_folder_path_is_refused(self, test_id: str) -> None:
        """The safe-path rule applies to the target folder too."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: \.\./out$"):
            testdata_service.begin_upload(test_id, "../out", "a.csv", replace=False)

    def test_a_missing_folder_is_not_found(self, test_id: str) -> None:
        """Upload never creates the target folder implicitly."""
        with pytest.raises(NotFoundException, match=r"^Folder not found: fixtures$"):
            testdata_service.begin_upload(test_id, "fixtures", "a.csv", replace=False)

    def test_a_file_as_the_target_folder_is_not_found(self, test_id: str) -> None:
        """A file of that name is not a folder to upload into."""
        seed_file(test_id, "fixtures", b"x")

        with pytest.raises(NotFoundException, match=r"^Folder not found: fixtures$"):
            testdata_service.begin_upload(test_id, "fixtures", "a.csv", replace=False)

    def test_an_unknown_test_is_not_found(self) -> None:
        """The message names the test id."""
        with pytest.raises(NotFoundException, match=r"^Test not found: no-such-test$"):
            testdata_service.begin_upload("no-such-test", "", "a.csv", replace=False)


class TestBeginUploadConflicts:
    """Folder conflicts always refuse; file conflicts refuse unless replace."""

    def test_a_folder_of_the_same_name_refuses_the_upload(self, test_id: str) -> None:
        """The message names the full relative path."""
        seed_folder(test_id, "customers.csv")

        with pytest.raises(ConflictException, match=r"^Folder already exists: customers\.csv$"):
            testdata_service.begin_upload(test_id, "", "customers.csv", replace=False)

    def test_a_folder_of_the_same_name_refuses_even_with_replace(self, test_id: str) -> None:
        """Replace never turns a folder into a file."""
        seed_folder(test_id, "customers.csv")

        with pytest.raises(ConflictException, match=r"^Folder already exists: customers\.csv$"):
            testdata_service.begin_upload(test_id, "", "customers.csv", replace=True)

    def test_a_nested_folder_conflict_names_the_nested_path(self, test_id: str) -> None:
        """The conflict path includes the target folder."""
        seed_folder(test_id, "fixtures/customers.csv")

        with pytest.raises(
            ConflictException, match=r"^Folder already exists: fixtures/customers\.csv$"
        ):
            testdata_service.begin_upload(test_id, "fixtures", "customers.csv", replace=False)

    def test_an_existing_file_refuses_the_upload(self, test_id: str) -> None:
        """Without replace the request is refused and the file is untouched."""
        seed_file(test_id, "customers.csv", b"old")

        with pytest.raises(ConflictException, match=r"^File already exists: customers\.csv$"):
            testdata_service.begin_upload(test_id, "", "customers.csv", replace=False)

        assert (testdata_root(test_id) / "customers.csv").read_bytes() == b"old"

    def test_an_existing_file_is_replaced_with_replace(self, test_id: str) -> None:
        """With replace the new bytes win."""
        seed_file(test_id, "customers.csv", b"old")

        result = store(test_id, "customers.csv", b"new", replace=True)

        assert (testdata_root(test_id) / "customers.csv").read_bytes() == b"new"
        assert result["replaced"] is True

    def test_a_second_upload_of_the_same_name_is_refused(self, test_id: str) -> None:
        """One in-progress file per name; the message names the relative path."""
        testdata_service.begin_upload(test_id, "", "customers.csv", replace=False)

        with pytest.raises(
            ConflictException, match=r"^Upload already in progress: customers\.csv$"
        ):
            testdata_service.begin_upload(test_id, "", "customers.csv", replace=False)

    def test_the_in_progress_conflict_names_the_nested_path(self, test_id: str) -> None:
        """The conflict path includes the target folder."""
        seed_folder(test_id, "fixtures")
        testdata_service.begin_upload(test_id, "fixtures", "a.csv", replace=False)

        with pytest.raises(
            ConflictException, match=r"^Upload already in progress: fixtures/a\.csv$"
        ):
            testdata_service.begin_upload(test_id, "fixtures", "a.csv", replace=False)

    def test_a_finished_upload_frees_the_name(self, test_id: str) -> None:
        """The in-progress file is gone once the upload completes."""
        store(test_id, "customers.csv", b"x")

        result = store(test_id, "customers.csv", b"y", replace=True)

        assert result["path"] == "customers.csv"


class TestUploadWriteMechanics:
    """In-progress name, atomic rename, read-only bits and cleanup."""

    def test_the_in_progress_file_carries_the_upld_prefix(self, test_id: str) -> None:
        """Nothing half-written ever exists under the final name."""
        testdata_service.begin_upload(test_id, "", "customers.csv", replace=False)

        assert _in_progress(test_id) == ["_upld-customers.csv"]
        assert not (testdata_root(test_id) / "customers.csv").exists()

    def test_the_in_progress_name_stays_within_the_name_limit(self, test_id: str) -> None:
        """A 255-byte name still leaves a storable in-progress name."""
        name = "a" * 255

        testdata_service.begin_upload(test_id, "", name, replace=False)

        assert len(_in_progress(test_id)[0].encode("utf-8")) <= 255

    def test_the_final_name_appears_only_on_finish(self, test_id: str) -> None:
        """The rename is the last step."""
        upload = testdata_service.begin_upload(test_id, "", "customers.csv", replace=False)
        upload.write(b"id,name\n")
        assert not (testdata_root(test_id) / "customers.csv").exists()

        result = upload.finish()

        assert result == {"path": "customers.csv", "size_bytes": 8, "replaced": False}
        assert (testdata_root(test_id) / "customers.csv").read_bytes() == b"id,name\n"
        assert _in_progress(test_id) == []

    def test_the_test_folder_is_created_locked_on_first_use(self, test_id: str) -> None:
        """The first upload creates the folder at 0555."""
        assert not testdata_root(test_id).exists()

        store(test_id, "a.csv", b"x")

        assert mode_of(testdata_root(test_id)) == "0o500"

    def test_uploaded_files_are_read_only(self, test_id: str) -> None:
        """Every stored file is 0444."""
        store(test_id, "a.csv", b"x")

        assert mode_of(testdata_root(test_id) / "a.csv") == "0o400"

    def test_a_second_upload_lands_in_the_already_locked_folder(self, test_id: str) -> None:
        """The rename into a 0555 folder works because WAVE lifts the bit itself."""
        store(test_id, "a.csv", b"x")
        assert mode_of(testdata_root(test_id)) == "0o500"

        store(test_id, "b.csv", b"y")

        assert (testdata_root(test_id) / "b.csv").read_bytes() == b"y"
        assert mode_of(testdata_root(test_id)) == "0o500"
        assert mode_of(testdata_root(test_id) / "b.csv") == "0o400"

    def test_replacing_a_read_only_file_works(self, test_id: str) -> None:
        """0444 on the target never blocks WAVE's own replace."""
        store(test_id, "a.csv", b"old")

        store(test_id, "a.csv", b"new", replace=True)

        assert (testdata_root(test_id) / "a.csv").read_bytes() == b"new"
        assert mode_of(testdata_root(test_id) / "a.csv") == "0o400"

    def test_an_upload_into_a_locked_subfolder_works(self, test_id: str) -> None:
        """Nested locked folders are unlocked for the write and relocked after."""
        testdata_service.create_folder(test_id, "fixtures")
        assert mode_of(testdata_root(test_id) / "fixtures") == "0o500"

        store(test_id, "fixtures/a.csv", b"x")

        assert (testdata_root(test_id) / "fixtures/a.csv").read_bytes() == b"x"
        assert mode_of(testdata_root(test_id) / "fixtures") == "0o500"

    def test_many_chunks_land_in_order(self, test_id: str) -> None:
        """The file is the concatenation of every chunk written."""
        upload = testdata_service.begin_upload(test_id, "", "a.csv", replace=False)
        for chunk in (b"one", b"two", b"three"):
            upload.write(chunk)

        result = upload.finish()

        assert result["size_bytes"] == 11
        assert (testdata_root(test_id) / "a.csv").read_bytes() == b"onetwothree"

    def test_abort_removes_the_in_progress_file(self, test_id: str) -> None:
        """A canceled upload leaves nothing behind."""
        upload = testdata_service.begin_upload(test_id, "", "a.csv", replace=False)
        upload.write(b"half")

        upload.abort()

        assert _in_progress(test_id) == []
        assert not (testdata_root(test_id) / "a.csv").exists()

    def test_abort_after_finish_is_harmless(self, test_id: str) -> None:
        """A late cleanup never removes the stored file."""
        upload = testdata_service.begin_upload(test_id, "", "a.csv", replace=False)
        upload.write(b"x")
        upload.finish()

        upload.abort()

        assert (testdata_root(test_id) / "a.csv").read_bytes() == b"x"

    def test_a_failed_write_leaves_no_in_progress_file(self, test_id: str) -> None:
        """store_bytes cleans up whatever it opened."""
        with (
            patch.object(testdata_service.Upload, "write", side_effect=OSError("disk gone")),
            pytest.raises(OSError, match=r"^disk gone$"),
        ):
            store(test_id, "a.csv", b"x")

        assert _in_progress(test_id) == []
        assert not (testdata_root(test_id) / "a.csv").exists()


class TestUploadSpaceGuard:
    """The reserve is checked as the bytes land, not only up front."""

    def test_a_chunk_that_exhausts_the_reserve_is_refused(self, test_id: str) -> None:
        """The message names the file being stored."""
        upload = testdata_service.begin_upload(test_id, "", "customers.csv", replace=False)

        with (
            patch("shutil.disk_usage", return_value=_disk_with_free(_ONE_GIB - 1)),
            pytest.raises(
                InsufficientStorageException,
                match=r"^Storing customers\.csv would leave less than 1 GB free$",
            ),
        ):
            upload.write(b"123456")

    def test_exactly_the_reserve_left_is_accepted(self, test_id: str) -> None:
        """The bound is 'under 1 GiB', so landing exactly on it is fine."""
        upload = testdata_service.begin_upload(test_id, "", "customers.csv", replace=False)

        with patch("shutil.disk_usage", return_value=_disk_with_free(_ONE_GIB)):
            upload.write(b"123456")

        assert upload.finish()["size_bytes"] == 6

    def test_store_bytes_removes_the_in_progress_file_when_the_guard_refuses(
        self, test_id: str
    ) -> None:
        """Nothing survives a refused write."""
        with (
            patch("shutil.disk_usage", return_value=_disk_with_free(_ONE_GIB - 1)),
            pytest.raises(InsufficientStorageException),
        ):
            store(test_id, "customers.csv", b"123456")

        assert _in_progress(test_id) == []
        assert not (testdata_root(test_id) / "customers.csv").exists()

    def test_a_file_conflict_is_reported_before_the_space_guard(self, test_id: str) -> None:
        """The conflict is the more useful answer, so it is checked first."""
        seed_file(test_id, "first.csv", b"old")

        with (
            patch("shutil.disk_usage", return_value=_disk_with_free(0)),
            pytest.raises(ConflictException, match=r"^File already exists: first\.csv$"),
        ):
            store(test_id, "first.csv", b"123456")

    def test_a_folder_conflict_is_reported_before_the_space_guard(self, test_id: str) -> None:
        """The folder conflict also outranks the space guard."""
        seed_folder(test_id, "first.csv")

        with (
            patch("shutil.disk_usage", return_value=_disk_with_free(0)),
            pytest.raises(ConflictException, match=r"^Folder already exists: first\.csv$"),
        ):
            store(test_id, "first.csv", b"123456")


class TestCheckSpace:
    """The pre-check answers before the client sends anything."""

    def test_enough_room_passes(self, test_id: str) -> None:
        """A write that leaves the reserve free is allowed."""
        with patch("shutil.disk_usage", return_value=_disk_with_free(_ONE_GIB + 10)):
            testdata_service.check_space(test_id, 10, "customers.csv")

    def test_too_little_room_is_refused(self, test_id: str) -> None:
        """The message names the file the client asked about."""
        with (
            patch("shutil.disk_usage", return_value=_disk_with_free(_ONE_GIB + 9)),
            pytest.raises(
                InsufficientStorageException,
                match=r"^Storing customers\.csv would leave less than 1 GB free$",
            ),
        ):
            testdata_service.check_space(test_id, 10, "customers.csv")

    def test_it_probes_an_existing_ancestor_when_the_test_folder_is_missing(
        self, test_id: str
    ) -> None:
        """The test's own folder need not exist yet."""
        assert not testdata_root(test_id).exists()

        with patch("shutil.disk_usage", return_value=_disk_with_free(_ONE_GIB + 10)) as usage:
            testdata_service.check_space(test_id, 10, "customers.csv")

        assert usage.call_args[0][0].exists()

    def test_an_unknown_test_is_not_found(self) -> None:
        """The guard resolves the test first."""
        with pytest.raises(NotFoundException, match=r"^Test not found: no-such-test$"):
            testdata_service.check_space("no-such-test", 10, "customers.csv")


class TestStoreBytesResult:
    """The single stored file reports its path, size and whether it replaced one."""

    def test_the_result_carries_path_size_and_replaced(self, test_id: str) -> None:
        """A new file reports replaced false and its byte count."""
        result = store(test_id, "customers.csv", b"id,name\n")

        assert result == {"path": "customers.csv", "size_bytes": 8, "replaced": False}

    def test_a_nested_path_includes_the_target_folder(self, test_id: str) -> None:
        """The path is relative to the test's folder, not to the target folder."""
        seed_folder(test_id, "fixtures")

        result = store(test_id, "fixtures/a.csv", b"x")

        assert result["path"] == "fixtures/a.csv"

    def test_an_empty_file_is_stored(self, test_id: str) -> None:
        """A zero-byte fixture is a legitimate file."""
        result = store(test_id, "empty.csv", b"")

        assert result["size_bytes"] == 0
        assert (testdata_root(test_id) / "empty.csv").read_bytes() == b""


class TestConcurrentUploads:
    """Two uploads into one folder: neither may relock the folder under the other."""

    def test_a_second_upload_writes_while_the_first_still_holds_the_folder(
        self, test_id: str
    ) -> None:
        first = testdata_service.begin_upload(test_id, "", "alpha.txt", replace=False)
        second = testdata_service.begin_upload(test_id, "", "beta.txt", replace=False)

        first.write(b"alpha")
        second.write(b"beta")
        first.finish()
        second.finish()

        root = testdata_root(test_id)
        assert (root / "alpha.txt").read_bytes() == b"alpha"
        assert (root / "beta.txt").read_bytes() == b"beta"

    def test_the_folder_is_locked_again_only_once_both_uploads_are_done(self, test_id: str) -> None:
        first = testdata_service.begin_upload(test_id, "", "alpha.txt", replace=False)
        second = testdata_service.begin_upload(test_id, "", "beta.txt", replace=False)
        first.write(b"alpha")
        first.finish()

        second.write(b"beta")
        second.finish()

        assert mode_of(testdata_root(test_id)) == "0o500"

    def test_uploads_racing_in_threads_all_land(self, test_id: str) -> None:
        names = [f"file-{index}.txt" for index in range(12)]
        start = threading.Barrier(len(names))
        failures: list[BaseException] = []

        def send(name: str) -> None:
            try:
                start.wait()
                testdata_service.store_bytes(test_id, "", name, name.encode("utf-8"), replace=False)
            except BaseException as exc:  # noqa: BLE001 - reported, not swallowed
                failures.append(exc)

        threads = [threading.Thread(target=send, args=(name,)) for name in names]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert failures == []
        root = testdata_root(test_id)
        assert sorted(path.name for path in root.iterdir()) == sorted(names)
        assert mode_of(root) == "0o500"

    def test_two_uploads_create_the_test_folder_between_them_without_failing(
        self, test_id: str
    ) -> None:
        root = testdata_root(test_id)
        assert not root.exists()
        start = threading.Barrier(2)
        failures: list[BaseException] = []

        def send(name: str) -> None:
            try:
                start.wait()
                testdata_service.store_bytes(test_id, "", name, b"x", replace=False)
            except BaseException as exc:  # noqa: BLE001 - reported, not swallowed
                failures.append(exc)

        threads = [threading.Thread(target=send, args=(name,)) for name in ("a.txt", "b.txt")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert failures == []
        assert sorted(path.name for path in root.iterdir()) == ["a.txt", "b.txt"]


class TestStorageRefusal:
    """A write the file system refuses is WAVE's own failure, answered as one."""

    def test_an_upload_the_store_refuses_answers_a_handled_error(self, test_id: str) -> None:
        upload = testdata_service.begin_upload(test_id, "", "alpha.txt", replace=False)
        upload.write(b"alpha")

        with (
            patch("os.replace", side_effect=PermissionError(13, "Permission denied")),
            pytest.raises(InternalServerException, match=r"^Test data storage refused the write$"),
        ):
            upload.finish()

    def test_a_folder_the_store_refuses_answers_a_handled_error(self, test_id: str) -> None:
        seed_folder(test_id, "kept")

        with (
            patch("pathlib.Path.mkdir", side_effect=PermissionError(13, "Permission denied")),
            pytest.raises(InternalServerException, match=r"^Test data storage refused the write$"),
        ):
            testdata_service.create_folder(test_id, "blocked")
