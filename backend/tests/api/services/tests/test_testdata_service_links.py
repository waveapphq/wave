"""Links in and around a test's Test Data folder: nothing outside the folder is ever an entry."""

import os
from pathlib import Path

import pytest

from tests.api.services.tests.conftest import (
    mode_of,
    modes_under,
    seed_file,
    store,
    testdata_root,
)
from wavecore.api.exceptions import ValidationException
from wavecore.api.services import storage_paths
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_service


def _plant(folder: Path, name: str, target: Path) -> Path:
    """Add a link to a locked folder the way a shared data folder could carry it."""
    os.chmod(folder, 0o700)
    link = folder / name
    link.symlink_to(target, target_is_directory=target.is_dir())
    os.chmod(folder, 0o500)
    return link


def _outside(tmp_path: Path) -> Path:
    """A folder outside the data folder: a file, a subfolder with a file, an old upload."""
    outside = tmp_path / "outside"
    (outside / "sub").mkdir(parents=True)
    (outside / "secret.txt").write_bytes(b"secret")
    (outside / "sub" / "key").write_bytes(b"key")
    stale = outside / "_upld-stale.csv"
    stale.write_bytes(b"partial")
    os.utime(stale, (0, 0))
    return outside


def _clone(test_id: str) -> str:
    clone = test_service.clone_test(test_id, "Clone", None)
    assert clone is not None
    return str(clone["id"])


@pytest.fixture
def linked_folder(test_id: str, tmp_path: Path) -> Path:
    """The test's own folder is a link to a folder outside the data folder."""
    outside = _outside(tmp_path)
    root = testdata_root(test_id)
    root.parent.mkdir(parents=True, exist_ok=True)
    root.symlink_to(outside, target_is_directory=True)
    return outside


class TestALinkInsideTheFolder:
    """A link whose target stays inside is followed on read and acted on as the link."""

    def test_its_content_is_served_under_the_links_own_name(self, test_id: str) -> None:
        """The download carries the name that was asked for."""
        store(test_id, "a.csv", b"x")
        _plant(testdata_root(test_id), "alias.csv", testdata_root(test_id) / "a.csv")

        path = testdata_service.content_path(test_id, "alias.csv")

        assert path.name == "alias.csv"
        assert path.read_bytes() == b"x"

    def test_a_delete_removes_the_link_and_keeps_its_target(self, test_id: str) -> None:
        """Only the named entry goes."""
        store(test_id, "a.csv", b"x")
        link = _plant(testdata_root(test_id), "alias.csv", testdata_root(test_id) / "a.csv")

        testdata_service.delete_entry(test_id, "alias.csv")

        assert not link.is_symlink()
        assert (testdata_root(test_id) / "a.csv").read_bytes() == b"x"

    def test_a_delete_of_a_folder_link_keeps_the_folder(self, test_id: str) -> None:
        """A link to a folder is removed as a link, never emptied."""
        testdata_service.create_folder(test_id, "fixtures")
        store(test_id, "fixtures/a.csv", b"x")
        link = _plant(testdata_root(test_id), "alias", testdata_root(test_id) / "fixtures")

        testdata_service.delete_entry(test_id, "alias")

        assert not link.is_symlink()
        assert (testdata_root(test_id) / "fixtures" / "a.csv").read_bytes() == b"x"

    def test_a_rename_moves_the_link_and_keeps_its_target(self, test_id: str) -> None:
        """The target keeps its name; the link carries the new one."""
        store(test_id, "a.csv", b"x")
        _plant(testdata_root(test_id), "alias.csv", testdata_root(test_id) / "a.csv")

        testdata_service.rename_entry(test_id, "alias.csv", "renamed.csv")

        assert (testdata_root(test_id) / "renamed.csv").is_symlink()
        assert (testdata_root(test_id) / "a.csv").read_bytes() == b"x"

    def test_an_upload_through_a_folder_link_leaves_the_folder_locked(self, test_id: str) -> None:
        """The file lands in the real folder, and that folder gets its write bit back off."""
        testdata_service.create_folder(test_id, "fixtures")
        _plant(testdata_root(test_id), "alias", testdata_root(test_id) / "fixtures")

        stored = store(test_id, "alias/a.csv", b"x")

        assert stored["path"] == "alias/a.csv"
        assert (testdata_root(test_id) / "fixtures" / "a.csv").read_bytes() == b"x"
        assert mode_of(testdata_root(test_id) / "fixtures") == "0o500"
        assert mode_of(testdata_root(test_id) / "fixtures" / "a.csv") == "0o400"


class TestALinkBackInThroughAFolderOutside:
    """A path through a folder outside is refused even where the entry links back inside."""

    @pytest.fixture
    def outside(self, test_id: str, tmp_path: Path) -> Path:
        """linked -> a folder outside, whose back.csv links to a file inside the test's folder."""
        store(test_id, "kept.csv", b"kept")
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "back.csv").symlink_to(testdata_root(test_id) / "kept.csv")
        os.chmod(outside, 0o755)
        _plant(testdata_root(test_id), "linked", outside)
        return outside

    def test_a_delete_is_refused_and_the_folder_outside_is_untouched(
        self, test_id: str, outside: Path
    ) -> None:
        """Neither the link out there nor that folder's mode changes."""
        with pytest.raises(
            ValidationException, match=r"^Invalid test data path: linked/back\.csv$"
        ):
            testdata_service.delete_entry(test_id, "linked/back.csv")

        assert (outside / "back.csv").is_symlink()
        assert mode_of(outside) == "0o755"

    def test_a_rename_is_refused_and_the_folder_outside_is_untouched(
        self, test_id: str, outside: Path
    ) -> None:
        """Nothing is moved out of the folder outside."""
        with pytest.raises(
            ValidationException, match=r"^Invalid test data path: linked/back\.csv$"
        ):
            testdata_service.rename_entry(test_id, "linked/back.csv", "moved.csv")

        assert (outside / "back.csv").is_symlink()
        assert not (testdata_root(test_id) / "moved.csv").exists()
        assert mode_of(outside) == "0o755"

    def test_an_import_is_refused_and_writes_nothing_outside(
        self, test_id: str, outside: Path
    ) -> None:
        """The link out there is never replaced by a real file."""
        with pytest.raises(
            ValidationException, match=r"^Invalid test data path: linked/back\.csv$"
        ):
            testdata_service.write_files(test_id, [("linked/back.csv", b"planted")])

        assert (outside / "back.csv").is_symlink()
        assert (testdata_root(test_id) / "kept.csv").read_bytes() == b"kept"
        assert mode_of(outside) == "0o755"


class TestALinkLoop:
    """Two links that point at each other name no entry, so every use is an invalid path."""

    @pytest.fixture(autouse=True)
    def loop(self, test_id: str) -> None:
        store(test_id, "kept.csv", b"kept")
        _plant(testdata_root(test_id), "a", testdata_root(test_id) / "b")
        _plant(testdata_root(test_id), "b", testdata_root(test_id) / "a")

    @pytest.mark.parametrize("rel", ["a", "a/x"])
    def test_content_is_an_invalid_path(self, test_id: str, rel: str) -> None:
        """The message names the path that was asked for, never a server path."""
        with pytest.raises(ValidationException, match=rf"^Invalid test data path: {rel}$"):
            testdata_service.content_path(test_id, rel)

    def test_a_delete_is_an_invalid_path(self, test_id: str) -> None:
        """A refusal, not a server error."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: a$"):
            testdata_service.delete_entry(test_id, "a")

    def test_the_listing_still_answers(self, test_id: str) -> None:
        """Links are skipped, so the loop never reaches the listing."""
        listed = [entry["path"] for entry in testdata_service.list_entries(test_id)["entries"]]

        assert listed == ["kept.csv"]


class TestAFolderThatIsALink:
    """A test folder that is itself a link holds no test data: nothing it points at is reached."""

    def test_the_listing_is_empty(self, test_id: str, linked_folder: Path) -> None:
        """What the link points at is never listed."""
        result = testdata_service.list_entries(test_id)

        assert result == {"entries": [], "total_files": 0, "total_bytes": 0}

    def test_an_abandoned_upload_there_is_never_swept(
        self, test_id: str, linked_folder: Path
    ) -> None:
        """The listing's sweep touches nothing it points at."""
        testdata_service.list_entries(test_id)

        assert (linked_folder / "_upld-stale.csv").exists()

    @pytest.mark.parametrize("rel", ["secret.txt", "sub/key", "sub"])
    def test_every_entry_is_an_invalid_path(
        self, test_id: str, linked_folder: Path, rel: str
    ) -> None:
        """Their real location lies outside the test's folder."""
        with pytest.raises(ValidationException, match=rf"^Invalid test data path: {rel}$"):
            testdata_service.resolve_entry(test_id, rel)

    def test_the_folder_itself_is_an_invalid_path(self, test_id: str, linked_folder: Path) -> None:
        """Not even the folder is a target, so a zip or an upload into it is refused."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: $"):
            testdata_service.resolve_entry(test_id, "", allow_root=True)

    def test_an_upload_is_refused_and_writes_nothing(
        self, test_id: str, linked_folder: Path
    ) -> None:
        """No byte lands where the link points."""
        before = sorted(path.name for path in linked_folder.iterdir())

        with pytest.raises(ValidationException, match=r"^Invalid test data path: $"):
            store(test_id, "planted.txt", b"x")

        assert sorted(path.name for path in linked_folder.iterdir()) == before

    def test_an_import_is_refused_and_writes_nothing(
        self, test_id: str, linked_folder: Path
    ) -> None:
        """Archive entries never land where the link points."""
        with pytest.raises(ValidationException, match=r"^Invalid test data path: planted\.txt$"):
            testdata_service.write_files(test_id, [("planted.txt", b"x")])

        assert not (linked_folder / "planted.txt").exists()

    def test_export_and_backup_carry_nothing(self, test_id: str, linked_folder: Path) -> None:
        """The file pairs the archives read are empty."""
        assert list(testdata_service.iter_files(test_id)) == []

    def test_a_clone_copies_nothing(self, test_id: str, linked_folder: Path) -> None:
        """The clone starts without a folder of its own."""
        assert not testdata_root(_clone(test_id)).exists()

    def test_deleting_the_test_removes_the_link_and_leaves_its_target(
        self, test_id: str, linked_folder: Path
    ) -> None:
        """Nothing it points at is removed or has its permissions changed."""
        modes = modes_under(linked_folder)

        testdata_service.delete_for_test(test_id)

        assert not testdata_root(test_id).is_symlink()
        assert not testdata_root(test_id).exists()
        assert (linked_folder / "sub" / "key").read_bytes() == b"key"
        assert modes_under(linked_folder) == modes


class TestCloneAndLinks:
    """A clone copies what a link inside points at and nothing a link outside points at."""

    def test_a_link_inside_is_copied_as_its_content(self, test_id: str) -> None:
        """The clone holds what the link pointed at, as its own file."""
        store(test_id, "a.csv", b"x")
        _plant(testdata_root(test_id), "alias.csv", testdata_root(test_id) / "a.csv")

        clone_id = _clone(test_id)

        copied = testdata_root(clone_id) / "alias.csv"
        assert not copied.is_symlink()
        assert copied.read_bytes() == b"x"

    def test_links_that_leave_the_folder_are_left_out(self, test_id: str, tmp_path: Path) -> None:
        """Neither a file nor a folder outside reaches the clone."""
        outside = _outside(tmp_path)
        store(test_id, "a.csv", b"x")
        _plant(testdata_root(test_id), "escape.txt", outside / "secret.txt")
        _plant(testdata_root(test_id), "escdir", outside / "sub")

        clone_id = _clone(test_id)

        listed = [entry["path"] for entry in testdata_service.list_entries(clone_id)["entries"]]
        assert listed == ["a.csv"]
        assert sorted(path.name for path in testdata_root(clone_id).iterdir()) == ["a.csv"]

    def test_a_link_into_another_tests_folder_is_left_out(
        self, test_id: str, other_test_id: str
    ) -> None:
        """Another test's files are outside this test's folder too."""
        seed_file(other_test_id, "theirs.csv", b"theirs")
        store(test_id, "a.csv", b"x")
        _plant(testdata_root(test_id), "theirs.csv", testdata_root(other_test_id) / "theirs.csv")

        clone_id = _clone(test_id)

        assert sorted(path.name for path in testdata_root(clone_id).iterdir()) == ["a.csv"]

    def test_a_link_nested_in_a_folder_is_judged_by_its_own_target(
        self, test_id: str, tmp_path: Path
    ) -> None:
        """The check runs in every folder the copy walks."""
        outside = _outside(tmp_path)
        testdata_service.create_folder(test_id, "fixtures")
        store(test_id, "fixtures/a.csv", b"x")
        _plant(testdata_root(test_id) / "fixtures", "escape.txt", outside / "secret.txt")
        _plant(testdata_root(test_id) / "fixtures", "alias.csv", testdata_root(test_id) / "a.csv")
        store(test_id, "a.csv", b"top")

        clone_id = _clone(test_id)

        copied = sorted(path.name for path in (testdata_root(clone_id) / "fixtures").iterdir())
        assert copied == ["a.csv", "alias.csv"]

    @pytest.mark.parametrize("target", ["..", "."])
    def test_a_link_to_a_folder_being_copied_is_left_out(self, test_id: str, target: str) -> None:
        """Following it would copy the folder into itself without end."""
        testdata_service.create_folder(test_id, "fixtures")
        store(test_id, "fixtures/a.csv", b"x")
        fixtures = testdata_root(test_id) / "fixtures"
        _plant(fixtures, "loop", (fixtures / target).resolve())

        clone_id = _clone(test_id)

        listed = [entry["path"] for entry in testdata_service.list_entries(clone_id)["entries"]]
        assert listed == ["fixtures", "fixtures/a.csv"]
        assert modes_under(testdata_root(clone_id)) == {
            "fixtures": "0o500",
            "fixtures/a.csv": "0o400",
        }

    def test_two_folders_linking_to_each_other_are_copied_once(self, test_id: str) -> None:
        """Each link is followed once; the link back into the copy is left out."""
        for folder in ("one", "two"):
            testdata_service.create_folder(test_id, folder)
            store(test_id, f"{folder}/{folder}.csv", folder.encode())
        _plant(testdata_root(test_id) / "one", "to-two", testdata_root(test_id) / "two")
        _plant(testdata_root(test_id) / "two", "to-one", testdata_root(test_id) / "one")

        clone_id = _clone(test_id)

        listed = [entry["path"] for entry in testdata_service.list_entries(clone_id)["entries"]]
        assert listed == [
            "one",
            "one/one.csv",
            "one/to-two",
            "one/to-two/two.csv",
            "two",
            "two/to-one",
            "two/to-one/one.csv",
            "two/two.csv",
        ]

    def test_links_that_lead_nowhere_are_left_out(self, test_id: str) -> None:
        """A link to nothing and a link loop have no content to copy."""
        store(test_id, "a.csv", b"x")
        root = testdata_root(test_id)
        _plant(root, "gone.csv", root / "missing.csv")
        _plant(root, "ping", root / "pong")
        _plant(root, "pong", root / "ping")

        clone_id = _clone(test_id)

        assert sorted(path.name for path in testdata_root(clone_id).iterdir()) == ["a.csv"]


class TestDataFolderUnderALink:
    """A data folder reached through a link answers every path in its real location."""

    @pytest.fixture
    def linked_base(self, tmp_path: Path) -> Path:
        """The configured data folder is a link to the real one."""
        real = tmp_path / "real-data"
        real.mkdir()
        alias = tmp_path / "data-alias"
        alias.symlink_to(real, target_is_directory=True)
        storage_paths.set_base_path(alias)
        return real

    def test_paths_resolve_in_the_real_location(self, linked_base: Path) -> None:
        """One folder has one path, whichever form the configuration names."""
        test_id = str(test_service.create_test({"name": "Linked Base"})["id"])
        store(test_id, "a.csv", b"x")

        resolved = testdata_service.resolve_entry(test_id, "a.csv")

        assert resolved == linked_base.resolve() / "testdata" / test_id / "a.csv"

    def test_every_change_answers_relative_paths(self, linked_base: Path) -> None:
        """Nothing the service answers carries the real location."""
        test_id = str(test_service.create_test({"name": "Linked Base"})["id"])

        assert testdata_service.create_folder(test_id, "fixtures") == "fixtures"
        assert store(test_id, "fixtures/a.csv", b"x")["path"] == "fixtures/a.csv"
        assert testdata_service.rename_entry(test_id, "fixtures/a.csv", "b.csv") == "b.csv"
        assert [entry["path"] for entry in testdata_service.list_entries(test_id)["entries"]] == [
            "b.csv",
            "fixtures",
        ]
        assert [rel for rel, _ in testdata_service.iter_files(test_id)] == ["b.csv"]

    def test_the_folders_are_locked_again_after_each_change(self, linked_base: Path) -> None:
        """The write bit comes back off whichever form the configuration names."""
        test_id = str(test_service.create_test({"name": "Linked Base"})["id"])
        testdata_service.create_folder(test_id, "fixtures")
        store(test_id, "fixtures/a.csv", b"x")
        testdata_service.delete_entry(test_id, "fixtures/a.csv")

        root = linked_base / "testdata" / test_id
        assert modes_under(root) == {"fixtures": "0o500"}
        assert oct(root.stat().st_mode & 0o777) == "0o500"
