"""Move in the stdlib File I/O core (REQ-3.4.1.10).

Move is Copy's semantics with the source removed: the destination is the full
target path, missing parents are created, a folder merges under Replace it, and
a move inside one filesystem is a rename.
"""

import os
import re
from pathlib import Path

import pytest

from wavecore.plugins import _file_ops


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


class TestMoveAFile:
    """The file lands at the full target path and the source is gone."""

    def test_writes_the_content_at_the_target_path(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "target.txt"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert destination.read_text(encoding="utf-8") == "payload"

    def test_removes_the_source(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")

        _file_ops.move(str(source), str(tmp_path / "target.txt"), "overwrite")

        assert not source.exists()

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")

        assert _file_ops.move(str(source), str(tmp_path / "target.txt"), "overwrite") == {}

    def test_moves_across_folders(self, tmp_path: Path) -> None:
        origin = tmp_path / "origin"
        origin.mkdir()
        source = origin / "source.txt"
        source.write_text("payload", encoding="utf-8")
        landing = tmp_path / "landing"
        landing.mkdir()
        destination = landing / "moved.txt"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert destination.read_text(encoding="utf-8") == "payload"
        assert list(origin.iterdir()) == []

    def test_creates_missing_parents(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "a" / "b" / "target.txt"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert destination.read_text(encoding="utf-8") == "payload"

    def test_moves_binary_bytes_unchanged(self, tmp_path: Path) -> None:
        source = tmp_path / "source.bin"
        source.write_bytes(b"\x00\xff\x10binary")
        destination = tmp_path / "target.bin"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert destination.read_bytes() == b"\x00\xff\x10binary"


class TestMoveInsideOneFilesystemIsARename:
    """A same-filesystem move renames rather than copying and deleting."""

    def test_keeps_the_inode(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        inode = os.stat(source).st_ino
        destination = tmp_path / "target.txt"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert os.stat(destination).st_ino == inode

    def test_keeps_the_inode_across_folders(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        inode = os.stat(source).st_ino
        destination = tmp_path / "landing" / "target.txt"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert os.stat(destination).st_ino == inode


class TestMoveAFileOntoAnExistingFile:
    """Replace it overwrites the destination file; Fail the block refuses it."""

    def test_overwrite_replaces_the_destination(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        _file_ops.move(str(source), str(destination), "overwrite")

        assert destination.read_text(encoding="utf-8") == "new"
        assert not source.exists()

    def test_fail_refuses_the_destination(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        with pytest.raises(
            OSError, match=_exact(f"Destination exists and if_exists=fail: {destination}")
        ):
            _file_ops.move(str(source), str(destination), "fail")

    def test_fail_leaves_both_sides_untouched(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        with pytest.raises(OSError):
            _file_ops.move(str(source), str(destination), "fail")

        assert source.read_text(encoding="utf-8") == "new"
        assert destination.read_text(encoding="utf-8") == "old"

    def test_fail_moves_when_the_destination_is_missing(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"

        assert _file_ops.move(str(source), str(destination), "fail") == {}
        assert destination.read_text(encoding="utf-8") == "new"
        assert not source.exists()


class TestMoveAFileOntoAnExistingFolder:
    """A file whose destination is an existing folder is refused."""

    def test_refuses_the_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "folder"
        destination.mkdir()

        with pytest.raises(OSError, match=_exact(f"Destination is a folder: {destination}")):
            _file_ops.move(str(source), str(destination), "overwrite")

    def test_refuses_the_folder_under_fail(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "folder"
        destination.mkdir()

        with pytest.raises(OSError, match=_exact(f"Destination is a folder: {destination}")):
            _file_ops.move(str(source), str(destination), "fail")

    def test_the_source_survives_the_refusal(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "folder"
        destination.mkdir()

        with pytest.raises(OSError):
            _file_ops.move(str(source), str(destination), "overwrite")

        assert source.read_text(encoding="utf-8") == "payload"
        assert list(destination.iterdir()) == []


class TestMoveAFolder:
    """A folder moves whole and the source folder is gone."""

    def test_moves_the_tree(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        (source / "nested").mkdir(parents=True)
        (source / "top.txt").write_text("top", encoding="utf-8")
        (source / "nested" / "deep.txt").write_text("deep", encoding="utf-8")
        destination = tmp_path / "target"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert (destination / "top.txt").read_text(encoding="utf-8") == "top"
        assert (destination / "nested" / "deep.txt").read_text(encoding="utf-8") == "deep"
        assert not source.exists()

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()

        assert _file_ops.move(str(source), str(tmp_path / "target"), "overwrite") == {}

    def test_moves_an_empty_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        destination = tmp_path / "target"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert destination.is_dir()
        assert not source.exists()

    def test_creates_missing_parents(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "top.txt").write_text("top", encoding="utf-8")
        destination = tmp_path / "a" / "b" / "target"

        _file_ops.move(str(source), str(destination), "overwrite")

        assert (destination / "top.txt").read_text(encoding="utf-8") == "top"


class TestMoveAFolderOntoAnExistingFolder:
    """Replace it merges and the source folder is still removed."""

    def test_replaces_a_same_named_file(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "shared.txt").write_text("from source", encoding="utf-8")
        destination = tmp_path / "target"
        destination.mkdir()
        (destination / "shared.txt").write_text("from target", encoding="utf-8")

        _file_ops.move(str(source), str(destination), "overwrite")

        assert (destination / "shared.txt").read_text(encoding="utf-8") == "from source"

    def test_keeps_entries_the_source_does_not_carry(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "added.txt").write_text("added", encoding="utf-8")
        destination = tmp_path / "target"
        destination.mkdir()
        (destination / "kept.txt").write_text("kept", encoding="utf-8")

        _file_ops.move(str(source), str(destination), "overwrite")

        assert (destination / "kept.txt").read_text(encoding="utf-8") == "kept"
        assert (destination / "added.txt").read_text(encoding="utf-8") == "added"

    def test_removes_the_source_after_the_merge(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "added.txt").write_text("added", encoding="utf-8")
        destination = tmp_path / "target"
        destination.mkdir()
        (destination / "kept.txt").write_text("kept", encoding="utf-8")

        _file_ops.move(str(source), str(destination), "overwrite")

        assert not source.exists()

    def test_fail_refuses_the_existing_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        destination = tmp_path / "target"
        destination.mkdir()

        with pytest.raises(
            OSError, match=_exact(f"Destination exists and if_exists=fail: {destination}")
        ):
            _file_ops.move(str(source), str(destination), "fail")

    def test_fail_leaves_the_source_folder_in_place(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "added.txt").write_text("added", encoding="utf-8")
        destination = tmp_path / "target"
        destination.mkdir()

        with pytest.raises(OSError):
            _file_ops.move(str(source), str(destination), "fail")

        assert (source / "added.txt").read_text(encoding="utf-8") == "added"


class TestMoveSourceNotFound:
    """A source that is not there names itself in the refusal."""

    def test_missing_file_source(self, tmp_path: Path) -> None:
        source = tmp_path / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"Source not found: {source}")):
            _file_ops.move(str(source), str(tmp_path / "target.txt"), "overwrite")

    def test_missing_source_under_a_missing_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "nowhere" / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"Source not found: {source}")):
            _file_ops.move(str(source), str(tmp_path / "target.txt"), "overwrite")

    def test_the_destination_is_not_created(self, tmp_path: Path) -> None:
        source = tmp_path / "absent.txt"
        destination = tmp_path / "a" / "target.txt"

        with pytest.raises(OSError):
            _file_ops.move(str(source), str(destination), "overwrite")

        assert not destination.parent.exists()
