"""Create folder in the stdlib File I/O core (REQ-3.4.1.10).

Create folder makes the folder and its missing parents. A folder that is
already there is not an error; a file of that name is.
"""

import re
from pathlib import Path

import pytest

from wavecore.plugins import _file_ops


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


class TestCreateFolder:
    """The folder and every missing parent are made."""

    def test_creates_the_folder(self, tmp_path: Path) -> None:
        target = tmp_path / "reports"

        _file_ops.create_folder(str(target))

        assert target.is_dir()

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        target = tmp_path / "reports"

        assert _file_ops.create_folder(str(target)) == {}

    def test_creates_missing_parents(self, tmp_path: Path) -> None:
        target = tmp_path / "a" / "b" / "c"

        _file_ops.create_folder(str(target))

        assert target.is_dir()

    def test_creates_a_folder_inside_an_existing_one(self, tmp_path: Path) -> None:
        parent = tmp_path / "parent"
        parent.mkdir()
        target = parent / "child"

        _file_ops.create_folder(str(target))

        assert target.is_dir()

    def test_leaves_the_siblings_in_place(self, tmp_path: Path) -> None:
        sibling = tmp_path / "kept.txt"
        sibling.write_text("kept", encoding="utf-8")

        _file_ops.create_folder(str(tmp_path / "reports"))

        assert sibling.read_text(encoding="utf-8") == "kept"


class TestCreateFolderOnAnExistingFolder:
    """An existing folder is not an error and keeps what is inside it."""

    def test_succeeds(self, tmp_path: Path) -> None:
        target = tmp_path / "reports"
        target.mkdir()

        assert _file_ops.create_folder(str(target)) == {}

    def test_keeps_the_entries_inside(self, tmp_path: Path) -> None:
        target = tmp_path / "reports"
        target.mkdir()
        (target / "kept.txt").write_text("kept", encoding="utf-8")

        _file_ops.create_folder(str(target))

        assert (target / "kept.txt").read_text(encoding="utf-8") == "kept"

    def test_an_existing_parent_chain_succeeds(self, tmp_path: Path) -> None:
        target = tmp_path / "a" / "b"
        target.mkdir(parents=True)

        assert _file_ops.create_folder(str(target)) == {}


class TestCreateFolderOnAFile:
    """A file of that name is refused with the exact message."""

    def test_refuses_the_file(self, tmp_path: Path) -> None:
        target = tmp_path / "reports"
        target.write_text("a file, not a folder", encoding="utf-8")

        with pytest.raises(OSError, match=_exact(f"Not a folder: {target}")):
            _file_ops.create_folder(str(target))

    def test_leaves_the_file_untouched(self, tmp_path: Path) -> None:
        target = tmp_path / "reports"
        target.write_text("a file, not a folder", encoding="utf-8")

        with pytest.raises(OSError):
            _file_ops.create_folder(str(target))

        assert target.read_text(encoding="utf-8") == "a file, not a folder"

    def test_refuses_an_empty_file(self, tmp_path: Path) -> None:
        target = tmp_path / "reports"
        target.write_text("", encoding="utf-8")

        with pytest.raises(OSError, match=_exact(f"Not a folder: {target}")):
            _file_ops.create_folder(str(target))
