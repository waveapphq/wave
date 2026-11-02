"""Copy in the stdlib File I/O core (REQ-3.4.1.10).

Destination is always the full target path including the new name; nothing
lands inside a folder by default. Missing parents are created, a folder copied
onto an existing folder merges under Replace it, and the three refusals carry
their exact messages.
"""

import re
from pathlib import Path

import pytest

from wavecore.plugins import _file_ops


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


class TestCopyAFile:
    """A file is copied to the full target path and the source stays."""

    def test_writes_the_content_at_the_target_path(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "target.txt"

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert destination.read_text(encoding="utf-8") == "payload"

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")

        assert _file_ops.copy(str(source), str(tmp_path / "target.txt"), "overwrite") == {}

    def test_leaves_the_source_in_place(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")

        _file_ops.copy(str(source), str(tmp_path / "target.txt"), "overwrite")

        assert source.read_text(encoding="utf-8") == "payload"

    def test_the_target_path_names_the_new_file(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        folder = tmp_path / "into"
        folder.mkdir()
        destination = folder / "renamed.txt"

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert sorted(item.name for item in folder.iterdir()) == ["renamed.txt"]

    def test_creates_missing_parents(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "a" / "b" / "target.txt"

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert destination.read_text(encoding="utf-8") == "payload"

    def test_copies_binary_bytes_unchanged(self, tmp_path: Path) -> None:
        source = tmp_path / "source.bin"
        source.write_bytes(b"\x00\xff\x10binary")
        destination = tmp_path / "target.bin"

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert destination.read_bytes() == b"\x00\xff\x10binary"


class TestCopyAFileOntoAnExistingFile:
    """Replace it overwrites the destination file; Fail the block refuses it."""

    def test_overwrite_replaces_the_destination(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert destination.read_text(encoding="utf-8") == "new"

    def test_fail_refuses_the_destination(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        with pytest.raises(
            OSError, match=_exact(f"Destination exists and if_exists=fail: {destination}")
        ):
            _file_ops.copy(str(source), str(destination), "fail")

    def test_fail_leaves_the_destination_untouched(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"
        destination.write_text("old", encoding="utf-8")

        with pytest.raises(OSError):
            _file_ops.copy(str(source), str(destination), "fail")

        assert destination.read_text(encoding="utf-8") == "old"

    def test_fail_copies_when_the_destination_is_missing(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("new", encoding="utf-8")
        destination = tmp_path / "target.txt"

        assert _file_ops.copy(str(source), str(destination), "fail") == {}
        assert destination.read_text(encoding="utf-8") == "new"


class TestCopyAFileOntoAnExistingFolder:
    """A file whose destination is an existing folder is refused."""

    def test_refuses_the_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "folder"
        destination.mkdir()

        with pytest.raises(OSError, match=_exact(f"Destination is a folder: {destination}")):
            _file_ops.copy(str(source), str(destination), "overwrite")

    def test_refuses_the_folder_under_fail(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "folder"
        destination.mkdir()

        with pytest.raises(OSError, match=_exact(f"Destination is a folder: {destination}")):
            _file_ops.copy(str(source), str(destination), "fail")

    def test_nothing_lands_inside_the_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "source.txt"
        source.write_text("payload", encoding="utf-8")
        destination = tmp_path / "folder"
        destination.mkdir()

        with pytest.raises(OSError):
            _file_ops.copy(str(source), str(destination), "overwrite")

        assert list(destination.iterdir()) == []


class TestCopyAFolder:
    """A folder is copied whole to the full target path."""

    def test_copies_the_tree(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        (source / "nested").mkdir(parents=True)
        (source / "top.txt").write_text("top", encoding="utf-8")
        (source / "nested" / "deep.txt").write_text("deep", encoding="utf-8")
        destination = tmp_path / "target"

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert (destination / "top.txt").read_text(encoding="utf-8") == "top"
        assert (destination / "nested" / "deep.txt").read_text(encoding="utf-8") == "deep"

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()

        assert _file_ops.copy(str(source), str(tmp_path / "target"), "overwrite") == {}

    def test_leaves_the_source_in_place(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "top.txt").write_text("top", encoding="utf-8")

        _file_ops.copy(str(source), str(tmp_path / "target"), "overwrite")

        assert (source / "top.txt").read_text(encoding="utf-8") == "top"

    def test_copies_an_empty_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        destination = tmp_path / "target"

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert destination.is_dir()

    def test_creates_missing_parents(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "top.txt").write_text("top", encoding="utf-8")
        destination = tmp_path / "a" / "b" / "target"

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert (destination / "top.txt").read_text(encoding="utf-8") == "top"


class TestCopyAFolderOntoAnExistingFolder:
    """Replace it merges: same-named files are replaced, other entries are kept."""

    def test_replaces_a_same_named_file(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "shared.txt").write_text("from source", encoding="utf-8")
        destination = tmp_path / "target"
        destination.mkdir()
        (destination / "shared.txt").write_text("from target", encoding="utf-8")

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert (destination / "shared.txt").read_text(encoding="utf-8") == "from source"

    def test_keeps_entries_the_source_does_not_carry(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "added.txt").write_text("added", encoding="utf-8")
        destination = tmp_path / "target"
        destination.mkdir()
        (destination / "kept.txt").write_text("kept", encoding="utf-8")

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert (destination / "kept.txt").read_text(encoding="utf-8") == "kept"
        assert (destination / "added.txt").read_text(encoding="utf-8") == "added"

    def test_merges_nested_folders(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        (source / "nested").mkdir(parents=True)
        (source / "nested" / "added.txt").write_text("added", encoding="utf-8")
        destination = tmp_path / "target"
        (destination / "nested").mkdir(parents=True)
        (destination / "nested" / "kept.txt").write_text("kept", encoding="utf-8")

        _file_ops.copy(str(source), str(destination), "overwrite")

        assert (destination / "nested" / "kept.txt").read_text(encoding="utf-8") == "kept"
        assert (destination / "nested" / "added.txt").read_text(encoding="utf-8") == "added"

    def test_fail_refuses_the_existing_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        destination = tmp_path / "target"
        destination.mkdir()

        with pytest.raises(
            OSError, match=_exact(f"Destination exists and if_exists=fail: {destination}")
        ):
            _file_ops.copy(str(source), str(destination), "fail")

    def test_fail_leaves_the_existing_folder_untouched(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        (source / "added.txt").write_text("added", encoding="utf-8")
        destination = tmp_path / "target"
        destination.mkdir()

        with pytest.raises(OSError):
            _file_ops.copy(str(source), str(destination), "fail")

        assert list(destination.iterdir()) == []


class TestCopySourceNotFound:
    """A source that is not there names itself in the refusal."""

    def test_missing_file_source(self, tmp_path: Path) -> None:
        source = tmp_path / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"Source not found: {source}")):
            _file_ops.copy(str(source), str(tmp_path / "target.txt"), "overwrite")

    def test_missing_source_under_a_missing_folder(self, tmp_path: Path) -> None:
        source = tmp_path / "nowhere" / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"Source not found: {source}")):
            _file_ops.copy(str(source), str(tmp_path / "target.txt"), "overwrite")

    def test_the_destination_is_not_created(self, tmp_path: Path) -> None:
        source = tmp_path / "absent.txt"
        destination = tmp_path / "a" / "target.txt"

        with pytest.raises(OSError):
            _file_ops.copy(str(source), str(destination), "overwrite")

        assert not destination.parent.exists()
