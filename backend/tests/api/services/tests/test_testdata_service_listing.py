"""Listing and path resolution for a test's own Test Data folder (REQ-3.4.3.2)."""

import os
import re
import time
from pathlib import Path

import pytest

from tests.api.services.tests.conftest import mode_of, seed_file, seed_folder, testdata_root
from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.services.tests import testdata_service, testdata_uploads


def _age(path: Path, seconds: float) -> None:
    """Push a file's mtime that many seconds into the past."""
    stamp = time.time() - seconds
    os.utime(path, (stamp, stamp))


def _seed_locked(test_id: str, rel: str) -> Path:
    """Write a file into an already locked folder and lock it again afterwards."""
    folder = testdata_root(test_id) / rel
    os.chmod(folder.parent, 0o755)
    folder.write_bytes(b"partial")
    os.chmod(folder.parent, 0o500)
    return folder


class TestListEntriesShape:
    """The listing is a flat entry list plus the two totals."""

    def test_a_test_with_no_folder_lists_as_empty(self, test_id: str) -> None:
        """A test that never received a file answers an empty listing."""
        result = testdata_service.list_entries(test_id)

        assert result == {"entries": [], "total_files": 0, "total_bytes": 0}

    def test_a_file_entry_carries_the_four_entry_fields(self, test_id: str) -> None:
        """Each entry is path, kind, size_bytes and modified_at."""
        seed_file(test_id, "customers.csv", b"id,name\n")

        result = testdata_service.list_entries(test_id)

        assert len(result["entries"]) == 1
        entry = result["entries"][0]
        assert entry["path"] == "customers.csv"
        assert entry["kind"] == "file"
        assert entry["size_bytes"] == 8
        assert entry["modified_at"]

    def test_folders_are_explicit_entries(self, test_id: str) -> None:
        """Every folder is its own dir entry, so the list is flat."""
        seed_file(test_id, "fixtures/data/customers.csv", b"x")

        result = testdata_service.list_entries(test_id)

        kinds = {entry["path"]: entry["kind"] for entry in result["entries"]}
        assert kinds == {
            "fixtures": "dir",
            "fixtures/data": "dir",
            "fixtures/data/customers.csv": "file",
        }

    def test_an_empty_folder_is_listed(self, test_id: str) -> None:
        """A folder with nothing in it still appears."""
        seed_folder(test_id, "staging")

        result = testdata_service.list_entries(test_id)

        assert [entry["path"] for entry in result["entries"]] == ["staging"]

    def test_entries_are_sorted_bytewise_by_path(self, test_id: str) -> None:
        """Uppercase sorts before lowercase and non-ASCII sorts last."""
        seed_file(test_id, "Zeta.txt", b"x")
        seed_file(test_id, "alpha.txt", b"x")
        seed_file(test_id, "beta/gamma.txt", b"x")
        seed_file(test_id, "ä.txt", b"x")

        result = testdata_service.list_entries(test_id)

        assert [entry["path"] for entry in result["entries"]] == [
            "Zeta.txt",
            "alpha.txt",
            "beta",
            "beta/gamma.txt",
            "ä.txt",
        ]


class TestListEntriesTotals:
    """The totals count files only."""

    def test_total_files_counts_files_not_folders(self, test_id: str) -> None:
        """Folder entries never inflate the file count."""
        seed_file(test_id, "a.csv", b"x")
        seed_file(test_id, "fixtures/b.csv", b"x")
        seed_folder(test_id, "empty")

        result = testdata_service.list_entries(test_id)

        assert result["total_files"] == 2

    def test_total_bytes_sums_the_file_sizes(self, test_id: str) -> None:
        """The byte total is the sum of the file sizes."""
        seed_file(test_id, "a.csv", b"12345")
        seed_file(test_id, "fixtures/b.csv", b"123")

        result = testdata_service.list_entries(test_id)

        assert result["total_bytes"] == 8

    def test_an_empty_folder_contributes_no_bytes(self, test_id: str) -> None:
        """Folders carry no size of their own."""
        seed_folder(test_id, "staging")

        result = testdata_service.list_entries(test_id)

        assert result["total_files"] == 0
        assert result["total_bytes"] == 0


class TestListEntriesExclusions:
    """Dot-directories, symlinks and in-flight upload temp files stay hidden."""

    def test_dot_directories_are_excluded(self, test_id: str) -> None:
        """A dot-directory and everything under it stays out of the listing."""
        seed_file(test_id, ".cache/blob", b"x")
        seed_file(test_id, "customers.csv", b"x")

        result = testdata_service.list_entries(test_id)

        assert [entry["path"] for entry in result["entries"]] == ["customers.csv"]

    def test_symlinks_are_excluded(self, test_id: str) -> None:
        """A symlink is never listed, even when its target is inside the folder."""
        target = seed_file(test_id, "customers.csv", b"x")
        (testdata_root(test_id) / "alias.csv").symlink_to(target)

        result = testdata_service.list_entries(test_id)

        assert [entry["path"] for entry in result["entries"]] == ["customers.csv"]

    def test_in_progress_uploads_are_excluded(self, test_id: str) -> None:
        """A half-written upload never shows up as a file."""
        seed_file(test_id, "_upld-customers.csv", b"partial")
        seed_file(test_id, "customers.csv", b"x")

        result = testdata_service.list_entries(test_id)

        assert [entry["path"] for entry in result["entries"]] == ["customers.csv"]
        assert result["total_files"] == 1

    def test_nested_in_progress_uploads_are_excluded(self, test_id: str) -> None:
        """The exclusion applies inside subfolders too."""
        seed_file(test_id, "fixtures/_upld-b.csv", b"partial")
        seed_file(test_id, "fixtures/b.csv", b"x")

        result = testdata_service.list_entries(test_id)

        assert [entry["path"] for entry in result["entries"]] == ["fixtures", "fixtures/b.csv"]


class TestOrphanUploadSweep:
    """Listing clears in-progress files no writer has touched for five minutes."""

    def test_a_stale_in_progress_file_is_deleted(self, test_id: str) -> None:
        """The writer is gone, so the bytes are gone too."""
        stale = seed_file(test_id, "_upld-customers.csv", b"partial")
        _age(stale, 301)

        testdata_service.list_entries(test_id)

        assert not stale.exists()

    def test_a_fresh_in_progress_file_survives(self, test_id: str) -> None:
        """A live upload writes constantly, so its mtime stays fresh."""
        fresh = seed_file(test_id, "_upld-customers.csv", b"partial")
        _age(fresh, 299)

        testdata_service.list_entries(test_id)

        assert fresh.exists()

    def test_a_stale_in_progress_file_in_a_locked_subfolder_is_deleted(self, test_id: str) -> None:
        """The sweep lifts the write bit the same way every other mutation does."""
        testdata_service.create_folder(test_id, "fixtures")
        stale = _seed_locked(test_id, "fixtures/_upld-a.csv")
        _age(stale, 600)

        testdata_service.list_entries(test_id)

        assert not stale.exists()
        assert mode_of(testdata_root(test_id) / "fixtures") == "0o500"

    def test_stored_files_are_never_swept(self, test_id: str) -> None:
        """Only the in-progress prefix is touched."""
        kept = seed_file(test_id, "customers.csv", b"x")
        _age(kept, 6000)

        testdata_service.list_entries(test_id)

        assert kept.exists()

    def test_a_missing_test_folder_sweeps_nothing(self, test_id: str) -> None:
        """A test that never received a file has nothing to clean."""
        assert testdata_service.list_entries(test_id)["entries"] == []

    def test_a_file_a_live_upload_still_owns_is_never_swept(self, test_id: str) -> None:
        """A stalled upload is not timed out, so its bytes stay where they are (TDATA-18)."""
        stalled = seed_file(test_id, "_upld-customers.csv", b"partial")
        _age(stalled, 6000)
        testdata_uploads.start(
            test_id,
            "u1",
            folder="",
            name="customers.csv",
            path="customers.csv",
            total_bytes=1024,
            session="tab-1",
            replace=False,
        )

        testdata_service.list_entries(test_id)

        assert stalled.exists()

    def test_a_file_a_live_upload_owns_in_a_subfolder_is_never_swept(self, test_id: str) -> None:
        """The owner is matched by name inside its own folder."""
        seed_folder(test_id, "fixtures")
        stalled = seed_file(test_id, "fixtures/_upld-a.csv", b"partial")
        _age(stalled, 6000)
        testdata_uploads.start(
            test_id,
            "u1",
            folder="fixtures",
            name="a.csv",
            path="fixtures/a.csv",
            total_bytes=1024,
            session="tab-1",
            replace=False,
        )

        testdata_service.list_entries(test_id)

        assert stalled.exists()


class TestListEntriesUnknownTest:
    """An unknown test id is a 404 naming the id."""

    def test_unknown_test_is_not_found(self) -> None:
        """The message names the test id that was asked for."""
        with pytest.raises(NotFoundException, match=r"^Test not found: no-such-test$"):
            testdata_service.list_entries("no-such-test")

    def test_another_tests_files_are_never_listed(self, test_id: str, other_test_id: str) -> None:
        """Each test sees only its own folder."""
        seed_file(other_test_id, "theirs.csv", b"x")
        seed_file(test_id, "mine.csv", b"x")

        result = testdata_service.list_entries(test_id)

        assert [entry["path"] for entry in result["entries"]] == ["mine.csv"]


class TestResolveEntryValidation:
    """Every relative path goes through the shared safe-path rule."""

    @pytest.mark.parametrize(
        "rel",
        ["/customers.csv", "fixtures//a.csv", "fixtures/", "../secrets", "fixtures/../../x"],
    )
    def test_an_unsafe_relative_path_is_refused(self, test_id: str, rel: str) -> None:
        """The message names the path that was asked for."""
        with pytest.raises(
            ValidationException, match=rf"^Invalid test data path: {re.escape(rel)}$"
        ):
            testdata_service.resolve_entry(test_id, rel)

    def test_the_root_is_refused_by_default(self, test_id: str) -> None:
        """An empty relative path is not an entry."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: $"):
            testdata_service.resolve_entry(test_id, "")

    def test_the_root_is_accepted_with_allow_root(self, test_id: str) -> None:
        """The upload target and the zip accept the folder itself."""
        seed_folder(test_id, "fixtures")

        resolved = testdata_service.resolve_entry(test_id, "", allow_root=True)

        assert resolved == testdata_root(test_id)


class TestResolveEntryContainment:
    """Containment is checked on the real path, so symlinks cannot escape."""

    def test_a_symlink_that_leaves_the_folder_is_refused(
        self, test_id: str, tmp_path: Path
    ) -> None:
        """A link whose target sits outside the test's folder is not a valid entry."""
        outside = tmp_path / "outside.csv"
        outside.write_bytes(b"secret")
        root = testdata_root(test_id)
        root.mkdir(parents=True, exist_ok=True)
        (root / "escape.csv").symlink_to(outside)

        with pytest.raises(ValidationException, match=r"^Invalid test data path: escape\.csv$"):
            testdata_service.resolve_entry(test_id, "escape.csv")

    def test_a_symlinked_folder_that_leaves_the_folder_is_refused(
        self, test_id: str, tmp_path: Path
    ) -> None:
        """A link to an outside folder cannot be reached through either."""
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "secret.csv").write_bytes(b"secret")
        root = testdata_root(test_id)
        root.mkdir(parents=True, exist_ok=True)
        (root / "linked").symlink_to(outside, target_is_directory=True)

        with pytest.raises(
            ValidationException, match=r"^Invalid test data path: linked/secret\.csv$"
        ):
            testdata_service.resolve_entry(test_id, "linked/secret.csv")

    def test_a_symlink_that_stays_inside_the_folder_resolves(self, test_id: str) -> None:
        """Containment is about the real location, not about being a link."""
        target = seed_file(test_id, "customers.csv", b"x")
        root = testdata_root(test_id)
        (root / "alias.csv").symlink_to(target)

        resolved = testdata_service.resolve_entry(test_id, "alias.csv")

        assert resolved.resolve() == target.resolve()


class TestResolveEntryExistence:
    """must_exist decides whether a missing entry is an error."""

    def test_a_file_resolves_to_its_path(self, test_id: str) -> None:
        """An existing file resolves under the test's folder."""
        seed_file(test_id, "fixtures/customers.csv", b"x")

        resolved = testdata_service.resolve_entry(test_id, "fixtures/customers.csv")

        assert resolved == testdata_root(test_id) / "fixtures" / "customers.csv"

    def test_a_folder_resolves_to_its_path(self, test_id: str) -> None:
        """An existing folder resolves too."""
        seed_folder(test_id, "fixtures")

        resolved = testdata_service.resolve_entry(test_id, "fixtures")

        assert resolved == testdata_root(test_id) / "fixtures"

    def test_a_missing_entry_is_not_found_by_default(self, test_id: str) -> None:
        """The message names the relative path that was asked for."""
        with pytest.raises(
            NotFoundException, match=r"^Test data entry not found: fixtures/absent\.csv$"
        ):
            testdata_service.resolve_entry(test_id, "fixtures/absent.csv")

    def test_a_missing_entry_resolves_with_must_exist_false(self, test_id: str) -> None:
        """A write target does not have to be there yet."""
        resolved = testdata_service.resolve_entry(test_id, "new.csv", must_exist=False)

        assert resolved == testdata_root(test_id) / "new.csv"
        assert not resolved.exists()

    def test_must_exist_false_still_validates_the_path(self, test_id: str) -> None:
        """Skipping the existence check never skips the safe-path rule."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: \.\./x$"):
            testdata_service.resolve_entry(test_id, "../x", must_exist=False)
