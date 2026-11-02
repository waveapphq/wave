"""Folder creation, rename / move and delete inside a test's Test Data folder."""

import re
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
    NotFoundException,
    ValidationException,
)
from wavecore.api.services.tests import testdata_service


class TestCreateFolder:
    """A new folder, its parents already in place, stored read-only."""

    def test_a_top_level_folder_is_created(self, test_id: str) -> None:
        """The first folder also creates the test's own folder."""
        result = testdata_service.create_folder(test_id, "fixtures")

        assert result == "fixtures"
        assert (testdata_root(test_id) / "fixtures").is_dir()

    def test_a_new_folder_is_read_only(self, test_id: str) -> None:
        """Folders are stored 0555."""
        testdata_service.create_folder(test_id, "fixtures")

        assert mode_of(testdata_root(test_id) / "fixtures") == "0o500"

    def test_the_test_folder_is_created_locked_on_first_use(self, test_id: str) -> None:
        """Creating the first folder locks the test's folder too."""
        testdata_service.create_folder(test_id, "fixtures")

        assert mode_of(testdata_root(test_id)) == "0o500"

    def test_a_nested_folder_is_created_under_an_existing_parent(self, test_id: str) -> None:
        """A nested path works when every parent is already there."""
        testdata_service.create_folder(test_id, "fixtures")

        result = testdata_service.create_folder(test_id, "fixtures/data")

        assert result == "fixtures/data"
        assert (testdata_root(test_id) / "fixtures/data").is_dir()
        assert mode_of(testdata_root(test_id) / "fixtures/data") == "0o500"

    def test_a_missing_parent_is_not_found(self, test_id: str) -> None:
        """The message names the missing parent, not the requested path."""
        with pytest.raises(NotFoundException, match=r"^Folder not found: fixtures$"):
            testdata_service.create_folder(test_id, "fixtures/data")

    def test_a_file_as_the_parent_is_not_found(self, test_id: str) -> None:
        """A file of that name is not a parent folder."""
        seed_file(test_id, "fixtures", b"x")

        with pytest.raises(NotFoundException, match=r"^Folder not found: fixtures$"):
            testdata_service.create_folder(test_id, "fixtures/data")

    def test_an_existing_folder_is_a_conflict(self, test_id: str) -> None:
        """Creating a folder twice is refused, not silently accepted."""
        seed_folder(test_id, "fixtures")

        with pytest.raises(ConflictException, match=r"^Folder already exists: fixtures$"):
            testdata_service.create_folder(test_id, "fixtures")

    def test_an_existing_file_of_that_name_is_a_conflict(self, test_id: str) -> None:
        """A file in the way is reported as a file conflict."""
        seed_file(test_id, "fixtures", b"x")

        with pytest.raises(ConflictException, match=r"^File already exists: fixtures$"):
            testdata_service.create_folder(test_id, "fixtures")

    @pytest.mark.parametrize("path", ["/fixtures", "fixtures//data", "../out", "", "fixtures/"])
    def test_an_unsafe_path_is_refused(self, test_id: str, path: str) -> None:
        """The safe-path rule applies to the new folder's path."""
        with pytest.raises(
            ValidationException, match=rf"^Invalid test data path: {re.escape(path)}$"
        ):
            testdata_service.create_folder(test_id, path)

    def test_an_invalid_final_name_is_refused(self, test_id: str) -> None:
        """The name rules apply to the folder's own name."""
        name = "a" * 256

        with pytest.raises(ValidationException, match=rf"^Invalid name: {name}$"):
            testdata_service.create_folder(test_id, name)

    def test_a_folder_that_appears_while_it_is_created_is_a_conflict(self, test_id: str) -> None:
        # The pre-check is neutralized, so the create loses the race the way a
        # second concurrent caller would.
        testdata_service.create_folder(test_id, "taken")

        with (
            patch.object(testdata_service, "_check_free_entry"),
            pytest.raises(ConflictException, match=r"^Folder already exists: taken$"),
        ):
            testdata_service.create_folder(test_id, "taken")

    def test_an_unknown_test_is_not_found(self) -> None:
        """The message names the test id."""
        with pytest.raises(NotFoundException, match=r"^Test not found: no-such-test$"):
            testdata_service.create_folder("no-such-test", "fixtures")


class TestRenameEntry:
    """One endpoint covers rename and move within the test."""

    def test_a_file_is_renamed_in_place(self, test_id: str) -> None:
        """The new relative path is returned and the old one is gone."""
        store(test_id, "old.csv", b"x")

        result = testdata_service.rename_entry(test_id, "old.csv", "new.csv")

        assert result == "new.csv"
        assert (testdata_root(test_id) / "new.csv").read_bytes() == b"x"
        assert not (testdata_root(test_id) / "old.csv").exists()

    def test_a_renamed_file_stays_read_only(self, test_id: str) -> None:
        """The 0444 bit survives the move."""
        store(test_id, "old.csv", b"x")

        testdata_service.rename_entry(test_id, "old.csv", "new.csv")

        assert mode_of(testdata_root(test_id) / "new.csv") == "0o400"
        assert mode_of(testdata_root(test_id)) == "0o500"

    def test_a_file_is_moved_into_an_existing_folder(self, test_id: str) -> None:
        """Rename and move share one call."""
        testdata_service.create_folder(test_id, "fixtures")
        store(test_id, "a.csv", b"x")

        result = testdata_service.rename_entry(test_id, "a.csv", "fixtures/a.csv")

        assert result == "fixtures/a.csv"
        assert (testdata_root(test_id) / "fixtures/a.csv").read_bytes() == b"x"
        assert mode_of(testdata_root(test_id) / "fixtures") == "0o500"

    def test_a_folder_is_renamed_with_everything_inside_it(self, test_id: str) -> None:
        """The subtree travels with the folder."""
        testdata_service.create_folder(test_id, "fixtures")
        store(test_id, "fixtures/a.csv", b"x")

        result = testdata_service.rename_entry(test_id, "fixtures", "inputs")

        assert result == "inputs"
        assert (testdata_root(test_id) / "inputs/a.csv").read_bytes() == b"x"
        assert mode_of(testdata_root(test_id) / "inputs") == "0o500"
        assert mode_of(testdata_root(test_id) / "inputs/a.csv") == "0o400"

    def test_a_missing_entry_is_not_found(self, test_id: str) -> None:
        """The message names the source path."""
        with pytest.raises(NotFoundException, match=r"^Test data entry not found: absent\.csv$"):
            testdata_service.rename_entry(test_id, "absent.csv", "new.csv")

    def test_a_missing_destination_parent_is_not_found(self, test_id: str) -> None:
        """The message names the missing parent folder."""
        store(test_id, "a.csv", b"x")

        with pytest.raises(NotFoundException, match=r"^Folder not found: fixtures$"):
            testdata_service.rename_entry(test_id, "a.csv", "fixtures/a.csv")

    def test_an_existing_file_at_the_destination_is_a_conflict(self, test_id: str) -> None:
        """Rename never replaces a file."""
        store(test_id, "a.csv", b"a")
        store(test_id, "b.csv", b"b")

        with pytest.raises(ConflictException, match=r"^File already exists: b\.csv$"):
            testdata_service.rename_entry(test_id, "a.csv", "b.csv")

        assert (testdata_root(test_id) / "b.csv").read_bytes() == b"b"

    def test_an_existing_folder_at_the_destination_is_a_conflict(self, test_id: str) -> None:
        """Rename never merges into a folder."""
        testdata_service.create_folder(test_id, "inputs")
        store(test_id, "a.csv", b"x")

        with pytest.raises(ConflictException, match=r"^Folder already exists: inputs$"):
            testdata_service.rename_entry(test_id, "a.csv", "inputs")

    @pytest.mark.parametrize("path", ["/new.csv", "a//b.csv", "../out.csv", ""])
    def test_an_unsafe_destination_is_refused(self, test_id: str, path: str) -> None:
        """The safe-path rule applies to the new path."""
        store(test_id, "a.csv", b"x")

        with pytest.raises(
            ValidationException, match=rf"^Invalid test data path: {re.escape(path)}$"
        ):
            testdata_service.rename_entry(test_id, "a.csv", path)

    def test_an_unsafe_source_is_refused(self, test_id: str) -> None:
        """The safe-path rule applies to the source too."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: \.\./x$"):
            testdata_service.rename_entry(test_id, "../x", "new.csv")

    def test_an_invalid_new_name_is_refused(self, test_id: str) -> None:
        """The name rules apply to the new final segment."""
        store(test_id, "a.csv", b"x")
        name = "a" * 256

        with pytest.raises(ValidationException, match=rf"^Invalid name: {name}$"):
            testdata_service.rename_entry(test_id, "a.csv", name)

    def test_an_unknown_test_is_not_found(self) -> None:
        """The message names the test id."""
        with pytest.raises(NotFoundException, match=r"^Test not found: no-such-test$"):
            testdata_service.rename_entry("no-such-test", "a.csv", "b.csv")


class TestDeleteEntry:
    """Files are unlinked; folders go with everything inside them."""

    def test_a_file_is_deleted(self, test_id: str) -> None:
        """A read-only file is still WAVE's to remove."""
        store(test_id, "a.csv", b"x")

        testdata_service.delete_entry(test_id, "a.csv")

        assert not (testdata_root(test_id) / "a.csv").exists()

    def test_the_parent_stays_locked_after_a_delete(self, test_id: str) -> None:
        """The write bit is lifted for the delete and put back afterwards."""
        store(test_id, "a.csv", b"x")

        testdata_service.delete_entry(test_id, "a.csv")

        assert mode_of(testdata_root(test_id)) == "0o500"

    def test_a_nested_file_is_deleted_and_its_parent_chain_relocked(self, test_id: str) -> None:
        """Every folder on the way down goes back to 0555."""
        testdata_service.create_folder(test_id, "fixtures")
        testdata_service.create_folder(test_id, "fixtures/data")
        store(test_id, "fixtures/data/a.csv", b"x")

        testdata_service.delete_entry(test_id, "fixtures/data/a.csv")

        assert not (testdata_root(test_id) / "fixtures/data/a.csv").exists()
        assert mode_of(testdata_root(test_id) / "fixtures/data") == "0o500"
        assert mode_of(testdata_root(test_id) / "fixtures") == "0o500"
        assert mode_of(testdata_root(test_id)) == "0o500"

    def test_a_folder_is_deleted_recursively(self, test_id: str) -> None:
        """Read-only folders and files inside are removed all the same."""
        testdata_service.create_folder(test_id, "fixtures")
        testdata_service.create_folder(test_id, "fixtures/data")
        store(test_id, "fixtures/data/a.csv", b"x")

        testdata_service.delete_entry(test_id, "fixtures")

        assert not (testdata_root(test_id) / "fixtures").exists()
        assert mode_of(testdata_root(test_id)) == "0o500"

    def test_an_empty_folder_is_deleted(self, test_id: str) -> None:
        """A folder with nothing in it is removed the same way."""
        testdata_service.create_folder(test_id, "fixtures")

        testdata_service.delete_entry(test_id, "fixtures")

        assert not (testdata_root(test_id) / "fixtures").exists()

    def test_a_sibling_survives_the_delete(self, test_id: str) -> None:
        """Only the named entry goes."""
        store(test_id, "a.csv", b"a")
        store(test_id, "b.csv", b"b")

        testdata_service.delete_entry(test_id, "a.csv")

        assert (testdata_root(test_id) / "b.csv").read_bytes() == b"b"

    def test_a_missing_entry_is_not_found(self, test_id: str) -> None:
        """The message names the path that was asked for."""
        with pytest.raises(NotFoundException, match=r"^Test data entry not found: absent\.csv$"):
            testdata_service.delete_entry(test_id, "absent.csv")

    def test_an_unsafe_path_is_refused(self, test_id: str) -> None:
        """The safe-path rule applies before anything is removed."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: \.\./x$"):
            testdata_service.delete_entry(test_id, "../x")

    def test_the_root_cannot_be_deleted_through_this_call(self, test_id: str) -> None:
        """Emptying the whole folder is a cascade, not an entry delete."""
        seed_file(test_id, "a.csv", b"x")

        with pytest.raises(ValidationException, match=r"^Invalid test data path: $"):
            testdata_service.delete_entry(test_id, "")

    def test_an_unknown_test_is_not_found(self) -> None:
        """The message names the test id."""
        with pytest.raises(NotFoundException, match=r"^Test not found: no-such-test$"):
            testdata_service.delete_entry("no-such-test", "a.csv")
