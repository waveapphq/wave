"""Write in the stdlib File I/O core (REQ-3.4.1.10).

Write puts UTF-8 text at the given path, creating missing parents. The three
If-the-file-exists choices are Replace it, Append to it and Fail the block; a
path that is already a folder is refused whatever the choice.
"""

import re
from pathlib import Path

import pytest

from wavecore.plugins import _file_ops


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


class TestWriteCreatesTheFile:
    """A new file is created with the text and nothing is returned."""

    def test_writes_the_text(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"

        _file_ops.write(str(target), "hello", "overwrite")

        assert target.read_text(encoding="utf-8") == "hello"

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"

        assert _file_ops.write(str(target), "hello", "overwrite") == {}

    def test_writes_empty_content(self, tmp_path: Path) -> None:
        target = tmp_path / "empty.txt"

        _file_ops.write(str(target), "", "overwrite")

        assert target.read_bytes() == b""

    def test_writes_non_ascii_text_as_utf8(self, tmp_path: Path) -> None:
        target = tmp_path / "accents.txt"

        _file_ops.write(str(target), "héllo ✓", "overwrite")

        assert target.read_bytes() == "héllo ✓".encode()

    def test_creates_missing_parents(self, tmp_path: Path) -> None:
        target = tmp_path / "reports" / "q1" / "summary.txt"

        _file_ops.write(str(target), "made", "overwrite")

        assert target.read_text(encoding="utf-8") == "made"

    def test_creates_a_file_next_to_an_existing_one(self, tmp_path: Path) -> None:
        (tmp_path / "kept.txt").write_text("kept", encoding="utf-8")
        target = tmp_path / "new.txt"

        _file_ops.write(str(target), "new", "overwrite")

        assert (tmp_path / "kept.txt").read_text(encoding="utf-8") == "kept"
        assert target.read_text(encoding="utf-8") == "new"


class TestWriteWritesNoByteOrderMark:
    """The bytes on disk are plain UTF-8 with no leading mark."""

    def test_ascii_text_has_no_mark(self, tmp_path: Path) -> None:
        target = tmp_path / "plain.txt"

        _file_ops.write(str(target), "hello", "overwrite")

        assert target.read_bytes() == b"hello"

    def test_non_ascii_text_has_no_mark(self, tmp_path: Path) -> None:
        target = tmp_path / "accents.txt"

        _file_ops.write(str(target), "héllo", "overwrite")

        assert not target.read_bytes().startswith(b"\xef\xbb\xbf")


class TestWriteOverwrite:
    """Replace it puts the new text in place of whatever was there."""

    def test_replaces_the_previous_text(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("old", encoding="utf-8")

        _file_ops.write(str(target), "new", "overwrite")

        assert target.read_text(encoding="utf-8") == "new"

    def test_truncates_a_longer_previous_text(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("a much longer previous body", encoding="utf-8")

        _file_ops.write(str(target), "short", "overwrite")

        assert target.read_text(encoding="utf-8") == "short"

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("old", encoding="utf-8")

        assert _file_ops.write(str(target), "new", "overwrite") == {}


class TestWriteAppend:
    """Append to it adds the text to the end, with nothing inserted between."""

    def test_appends_to_the_existing_text(self, tmp_path: Path) -> None:
        target = tmp_path / "log.txt"
        target.write_text("first", encoding="utf-8")

        _file_ops.write(str(target), "second", "append")

        assert target.read_text(encoding="utf-8") == "firstsecond"

    def test_appends_without_adding_a_separator(self, tmp_path: Path) -> None:
        target = tmp_path / "log.txt"
        target.write_text("line\n", encoding="utf-8")

        _file_ops.write(str(target), "next\n", "append")

        assert target.read_bytes() == b"line\nnext\n"

    def test_appends_to_a_missing_file_by_creating_it(self, tmp_path: Path) -> None:
        target = tmp_path / "fresh.txt"

        _file_ops.write(str(target), "only", "append")

        assert target.read_text(encoding="utf-8") == "only"

    def test_appends_under_created_parents(self, tmp_path: Path) -> None:
        target = tmp_path / "deep" / "fresh.txt"

        _file_ops.write(str(target), "only", "append")

        assert target.read_text(encoding="utf-8") == "only"

    def test_returns_an_empty_result(self, tmp_path: Path) -> None:
        target = tmp_path / "log.txt"
        target.write_text("first", encoding="utf-8")

        assert _file_ops.write(str(target), "second", "append") == {}


class TestWriteFail:
    """Fail the block refuses an existing file and writes a missing one."""

    def test_refuses_an_existing_file(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("old", encoding="utf-8")

        with pytest.raises(OSError, match=_exact(f"File exists and if_exists=fail: {target}")):
            _file_ops.write(str(target), "new", "fail")

    def test_leaves_the_existing_text_untouched(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("old", encoding="utf-8")

        with pytest.raises(OSError):
            _file_ops.write(str(target), "new", "fail")

        assert target.read_text(encoding="utf-8") == "old"

    def test_refuses_an_existing_empty_file(self, tmp_path: Path) -> None:
        target = tmp_path / "empty.txt"
        target.write_text("", encoding="utf-8")

        with pytest.raises(OSError, match=_exact(f"File exists and if_exists=fail: {target}")):
            _file_ops.write(str(target), "new", "fail")

    def test_writes_a_missing_file(self, tmp_path: Path) -> None:
        target = tmp_path / "fresh.txt"

        assert _file_ops.write(str(target), "new", "fail") == {}
        assert target.read_text(encoding="utf-8") == "new"


class TestWriteOntoAFolder:
    """A path that is already a folder is refused whatever the choice is."""

    def test_refuses_a_folder_on_overwrite(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()

        with pytest.raises(OSError, match=_exact(f"Destination is a folder: {target}")):
            _file_ops.write(str(target), "text", "overwrite")

    def test_refuses_a_folder_on_append(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()

        with pytest.raises(OSError, match=_exact(f"Destination is a folder: {target}")):
            _file_ops.write(str(target), "text", "append")

    def test_refuses_a_folder_on_fail(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()

        with pytest.raises(OSError, match=_exact(f"Destination is a folder: {target}")):
            _file_ops.write(str(target), "text", "fail")

    def test_leaves_the_folder_in_place(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()
        (target / "inside.txt").write_text("kept", encoding="utf-8")

        with pytest.raises(OSError):
            _file_ops.write(str(target), "text", "overwrite")

        assert (target / "inside.txt").read_text(encoding="utf-8") == "kept"
