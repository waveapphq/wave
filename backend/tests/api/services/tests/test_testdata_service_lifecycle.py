"""Cascade delete, clone copy, export / import pairs, zone reset and the lock helpers."""

import os
import re
import stat
import uuid

import pytest

from tests.api.services.tests.conftest import (
    mode_of,
    modes_under,
    seed_file,
    seed_folder,
    store,
    testdata_root,
)
from wavecore.api.exceptions import ValidationException
from wavecore.api.services.storage_paths import get_testdata_storage_path
from wavecore.api.services.tests import testdata_service


def _seed_locked_tree(test_id: str) -> None:
    testdata_service.create_folder(test_id, "fixtures")
    testdata_service.create_folder(test_id, "fixtures/data")
    store(test_id, "top.csv", b"top")
    store(test_id, "fixtures/data/inner.csv", b"inner")


class TestDeleteForTest:
    """The test's folder goes when the test does."""

    def test_the_whole_folder_is_removed(self, test_id: str) -> None:
        """Read-only folders and files are removed all the same."""
        _seed_locked_tree(test_id)

        testdata_service.delete_for_test(test_id)

        assert not testdata_root(test_id).exists()

    def test_a_test_with_no_folder_is_not_an_error(self, test_id: str) -> None:
        """Nothing to remove is a no-op, not a failure."""
        testdata_service.delete_for_test(test_id)

        assert not testdata_root(test_id).exists()

    def test_it_does_not_need_the_test_document(self) -> None:
        """The cascade runs after the document is already gone."""
        orphan_id = str(uuid.uuid4())
        seed_file(orphan_id, "a.csv", b"x")

        testdata_service.delete_for_test(orphan_id)

        assert not testdata_root(orphan_id).exists()

    def test_other_tests_keep_their_files(self, test_id: str, other_test_id: str) -> None:
        """Only the named test's folder is removed."""
        _seed_locked_tree(test_id)
        seed_file(other_test_id, "theirs.csv", b"x")

        testdata_service.delete_for_test(test_id)

        assert (testdata_root(other_test_id) / "theirs.csv").exists()


class TestCopyForClone:
    """A cloned test starts with a copy of the source's files."""

    def test_the_tree_is_copied(self, test_id: str, other_test_id: str) -> None:
        """Every file and folder appears under the clone's id."""
        _seed_locked_tree(test_id)

        testdata_service.copy_for_clone(test_id, other_test_id)

        assert (testdata_root(other_test_id) / "top.csv").read_bytes() == b"top"
        assert (testdata_root(other_test_id) / "fixtures/data/inner.csv").read_bytes() == b"inner"

    def test_the_copy_is_locked_again(self, test_id: str, other_test_id: str) -> None:
        """Files land 0444 and folders 0555 in the clone."""
        _seed_locked_tree(test_id)

        testdata_service.copy_for_clone(test_id, other_test_id)

        clone_root = testdata_root(other_test_id)
        assert mode_of(clone_root) == "0o500"
        assert modes_under(clone_root) == {
            "fixtures": "0o500",
            "fixtures/data": "0o500",
            "fixtures/data/inner.csv": "0o400",
            "top.csv": "0o400",
        }

    def test_the_source_is_unchanged(self, test_id: str, other_test_id: str) -> None:
        """A clone never moves the original's files."""
        _seed_locked_tree(test_id)

        testdata_service.copy_for_clone(test_id, other_test_id)

        assert (testdata_root(test_id) / "top.csv").read_bytes() == b"top"
        assert mode_of(testdata_root(test_id)) == "0o500"

    def test_a_source_with_no_folder_creates_nothing(
        self, test_id: str, other_test_id: str
    ) -> None:
        """Cloning a test with no files leaves the clone with no folder."""
        testdata_service.copy_for_clone(test_id, other_test_id)

        assert not testdata_root(other_test_id).exists()


class TestIterFiles:
    """Export and backup walk the folder as (relative path, path) pairs."""

    def test_every_file_is_paired_with_its_path(self, test_id: str) -> None:
        """The relative path is posix and the path points at the file on disk."""
        _seed_locked_tree(test_id)

        pairs = dict(testdata_service.iter_files(test_id))

        assert sorted(pairs) == ["fixtures/data/inner.csv", "top.csv"]
        assert pairs["fixtures/data/inner.csv"].read_bytes() == b"inner"

    def test_folders_are_not_yielded(self, test_id: str) -> None:
        """Only files travel with the test."""
        seed_folder(test_id, "empty")
        seed_file(test_id, "a.csv", b"x")

        assert [rel for rel, _ in testdata_service.iter_files(test_id)] == ["a.csv"]

    def test_a_test_with_no_folder_yields_nothing(self, test_id: str) -> None:
        """An empty iterator, not an error."""
        assert list(testdata_service.iter_files(test_id)) == []


class TestWriteFiles:
    """Import and restore write the archive's entries back."""

    def test_files_are_written_under_the_tests_folder(self, test_id: str) -> None:
        """Nested parents are created on the way."""
        count = testdata_service.write_files(
            test_id, [("top.csv", b"top"), ("fixtures/data/inner.csv", b"inner")]
        )

        assert count == 2
        assert (testdata_root(test_id) / "top.csv").read_bytes() == b"top"
        assert (testdata_root(test_id) / "fixtures/data/inner.csv").read_bytes() == b"inner"

    def test_written_files_and_folders_are_locked(self, test_id: str) -> None:
        """Imported files get the same 0444 / 0555 treatment as uploaded ones."""
        testdata_service.write_files(test_id, [("fixtures/data/inner.csv", b"inner")])

        root = testdata_root(test_id)
        assert mode_of(root) == "0o500"
        assert modes_under(root) == {
            "fixtures": "0o500",
            "fixtures/data": "0o500",
            "fixtures/data/inner.csv": "0o400",
        }

    def test_an_empty_iterable_writes_nothing(self, test_id: str) -> None:
        """The count is zero and no folder is created."""
        assert testdata_service.write_files(test_id, []) == 0
        assert not testdata_root(test_id).exists()

    @pytest.mark.parametrize("rel", ["/top.csv", "../out.csv", "a//b.csv", ""])
    def test_an_unsafe_relative_path_is_refused(self, test_id: str, rel: str) -> None:
        """A bad archive entry is fatal, not silently dropped."""
        with pytest.raises(
            ValidationException, match=rf"^Invalid test data path: {re.escape(rel)}$"
        ):
            testdata_service.write_files(test_id, [(rel, b"x")])

    def test_an_invalid_final_name_is_refused(self, test_id: str) -> None:
        """The name rules apply to each segment's final name."""
        name = "a" * 256

        with pytest.raises(ValidationException, match=rf"^Invalid name: {name}$"):
            testdata_service.write_files(test_id, [(name, b"x")])

    def test_an_existing_file_is_replaced(self, test_id: str) -> None:
        """Import and restore with overwrite write the archive's bytes over what is there."""
        store(test_id, "top.csv", b"old")

        count = testdata_service.write_files(test_id, [("top.csv", b"new")])

        assert count == 1
        assert (testdata_root(test_id) / "top.csv").read_bytes() == b"new"
        assert mode_of(testdata_root(test_id) / "top.csv") == "0o400"


class TestResetZone:
    """The admin reset scope empties the whole zone."""

    def test_every_tests_folder_is_removed(self, test_id: str, other_test_id: str) -> None:
        """Locked trees go with the rest."""
        _seed_locked_tree(test_id)
        _seed_locked_tree(other_test_id)

        testdata_service.reset_zone()

        assert not testdata_root(test_id).exists()
        assert not testdata_root(other_test_id).exists()

    def test_the_zone_directory_is_kept(self, test_id: str) -> None:
        """The zone itself survives so the next upload has somewhere to land."""
        _seed_locked_tree(test_id)

        testdata_service.reset_zone()

        zone = get_testdata_storage_path()
        assert zone.is_dir()
        assert list(zone.iterdir()) == []

    def test_an_absent_zone_is_not_an_error(self) -> None:
        """Resetting a server that never stored a file is a no-op."""
        assert not get_testdata_storage_path().exists()

        testdata_service.reset_zone()

    def test_a_loose_file_in_the_zone_is_removed(self, test_id: str) -> None:
        """The zone holds one folder per test; anything else is swept with them."""
        _seed_locked_tree(test_id)
        stray = get_testdata_storage_path() / "stray.txt"
        stray.write_bytes(b"x")

        testdata_service.reset_zone()

        assert not stray.exists()
        assert list(get_testdata_storage_path().iterdir()) == []


class TestLockTree:
    """_lock_tree walks a tree and takes the write bit off everything."""

    def test_files_become_read_only_and_folders_traversable(self, test_id: str) -> None:
        """Files 0444, folders 0555, root included."""
        root = testdata_root(test_id)
        seed_file(test_id, "fixtures/data/inner.csv", b"x")
        seed_file(test_id, "top.csv", b"x")

        testdata_service._lock_tree(root)

        assert mode_of(root) == "0o500"
        assert modes_under(root) == {
            "fixtures": "0o500",
            "fixtures/data": "0o500",
            "fixtures/data/inner.csv": "0o400",
            "top.csv": "0o400",
        }

    def test_locking_an_already_locked_tree_is_stable(self, test_id: str) -> None:
        """The helper is safe to call after every mutation."""
        root = testdata_root(test_id)
        seed_file(test_id, "top.csv", b"x")
        testdata_service._lock_tree(root)

        testdata_service._lock_tree(root)

        assert modes_under(root) == {"top.csv": "0o400"}


class TestUnlocked:
    """_unlocked lifts the write bit for one of WAVE's own mutations."""

    def test_the_write_bit_is_lifted_inside_the_context(self, test_id: str) -> None:
        """The folder is writable while the mutation runs."""
        root = testdata_root(test_id)
        seed_folder(test_id, "fixtures")
        testdata_service._lock_tree(root)

        with testdata_service._unlocked(root / "fixtures"):
            assert (root / "fixtures").stat().st_mode & stat.S_IWUSR

    def test_the_folder_is_relocked_on_exit(self, test_id: str) -> None:
        """The bit goes back the moment the mutation is done."""
        root = testdata_root(test_id)
        seed_folder(test_id, "fixtures")
        testdata_service._lock_tree(root)

        with testdata_service._unlocked(root / "fixtures"):
            pass

        assert mode_of(root / "fixtures") == "0o500"

    def test_the_folder_stays_writable_until_the_last_hold_ends(self, test_id: str) -> None:
        """An inner mutation ending never locks the folder under the outer one."""
        root = testdata_root(test_id)
        seed_folder(test_id, "fixtures")
        testdata_service._lock_tree(root)

        with testdata_service._unlocked(root / "fixtures"):
            with testdata_service._unlocked(root / "fixtures"):
                pass
            assert (root / "fixtures").stat().st_mode & stat.S_IWUSR

        assert mode_of(root / "fixtures") == "0o500"

    def test_a_folder_that_was_not_locked_is_locked_on_exit(self, test_id: str) -> None:
        """Leaving the context always leaves the folder read-only."""
        target = seed_folder(test_id, "fixtures")
        os.chmod(target, 0o755)

        with testdata_service._unlocked(target):
            pass

        assert mode_of(target) == "0o500"

    def test_a_replace_into_a_locked_folder_succeeds(self, test_id: str) -> None:
        """os.replace needs the parent writable; the helper provides it."""
        root = testdata_root(test_id)
        seed_file(test_id, "top.csv", b"old")
        source = seed_file(test_id, "_upld-top.csv", b"new")
        testdata_service._lock_tree(root)

        with testdata_service._unlocked(root):
            os.replace(source, root / "top.csv")

        assert (root / "top.csv").read_bytes() == b"new"
        assert mode_of(root) == "0o500"

    def test_the_folder_is_relocked_when_the_mutation_raises(self, test_id: str) -> None:
        """A failed mutation never leaves the folder writable."""
        root = testdata_root(test_id)
        seed_folder(test_id, "fixtures")
        testdata_service._lock_tree(root)

        with pytest.raises(RuntimeError, match=r"^mutation failed$"):
            with testdata_service._unlocked(root / "fixtures"):
                raise RuntimeError("mutation failed")

        assert mode_of(root / "fixtures") == "0o500"
