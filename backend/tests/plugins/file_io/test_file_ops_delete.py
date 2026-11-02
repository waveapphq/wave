"""Delete in the stdlib File I/O core (REQ-3.4.1.10).

A file is unlinked, a folder is removed with everything inside it, and a path
that is not there follows Ignore missing: silence when it is on, the exact
refusal when it is off.
"""

import re
from pathlib import Path

import pytest

from wavecore.plugins import _file_ops


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


class TestDeleteAFile:
    """A file is unlinked and nothing around it is touched."""

    def test_removes_the_file(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("bye", encoding="utf-8")

        _file_ops.delete(str(target), False)

        assert not target.exists()

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("bye", encoding="utf-8")

        assert _file_ops.delete(str(target), False) == {}

    def test_removes_an_empty_file(self, tmp_path: Path) -> None:
        target = tmp_path / "empty.txt"
        target.write_text("", encoding="utf-8")

        _file_ops.delete(str(target), False)

        assert not target.exists()

    def test_leaves_the_siblings_in_place(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("bye", encoding="utf-8")
        sibling = tmp_path / "kept.txt"
        sibling.write_text("kept", encoding="utf-8")

        _file_ops.delete(str(target), False)

        assert sibling.read_text(encoding="utf-8") == "kept"

    def test_leaves_the_parent_folder_in_place(self, tmp_path: Path) -> None:
        folder = tmp_path / "folder"
        folder.mkdir()
        target = folder / "note.txt"
        target.write_text("bye", encoding="utf-8")

        _file_ops.delete(str(target), False)

        assert folder.is_dir()

    def test_removes_a_file_when_ignore_missing_is_on(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("bye", encoding="utf-8")

        _file_ops.delete(str(target), True)

        assert not target.exists()


class TestDeleteAFolder:
    """A folder goes with everything inside it."""

    def test_removes_an_empty_folder(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()

        _file_ops.delete(str(target), False)

        assert not target.exists()

    def test_removes_a_folder_with_files(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()
        (target / "one.txt").write_text("one", encoding="utf-8")
        (target / "two.txt").write_text("two", encoding="utf-8")

        _file_ops.delete(str(target), False)

        assert not target.exists()

    def test_removes_nested_folders(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        (target / "a" / "b").mkdir(parents=True)
        (target / "a" / "b" / "deep.txt").write_text("deep", encoding="utf-8")

        _file_ops.delete(str(target), False)

        assert not target.exists()

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()

        assert _file_ops.delete(str(target), False) == {}

    def test_leaves_the_sibling_folder_in_place(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()
        sibling = tmp_path / "kept"
        sibling.mkdir()
        (sibling / "keep.txt").write_text("keep", encoding="utf-8")

        _file_ops.delete(str(target), False)

        assert (sibling / "keep.txt").read_text(encoding="utf-8") == "keep"


class TestDeleteAMissingPath:
    """Ignore missing decides whether nothing to delete is a failure."""

    def test_ignore_missing_on_succeeds(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        assert _file_ops.delete(str(target), True) == {}

    def test_ignore_missing_on_succeeds_under_a_missing_folder(self, tmp_path: Path) -> None:
        target = tmp_path / "nowhere" / "absent.txt"

        assert _file_ops.delete(str(target), True) == {}

    def test_ignore_missing_off_refuses(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"Nothing to delete: {target}")):
            _file_ops.delete(str(target), False)

    def test_ignore_missing_off_refuses_under_a_missing_folder(self, tmp_path: Path) -> None:
        target = tmp_path / "nowhere" / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"Nothing to delete: {target}")):
            _file_ops.delete(str(target), False)

    def test_ignore_missing_on_creates_nothing(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        _file_ops.delete(str(target), True)

        assert list(tmp_path.iterdir()) == []
