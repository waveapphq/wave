"""Read in the stdlib File I/O core (REQ-3.4.1.10).

Read answers a file's text decoded as UTF-8 with a leading byte-order mark
dropped, follows symlinks, and applies no size cap. A missing path, a folder,
and bytes that are not UTF-8 each raise their own exact message.
"""

import re
from pathlib import Path

import pytest

from wavecore.plugins import _file_ops


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


class TestReadReturnsTheText:
    """Read hands back the file's text under the single 'content' key."""

    def test_returns_the_content_key_only(self, tmp_path: Path) -> None:
        target = tmp_path / "note.txt"
        target.write_text("hello world", encoding="utf-8")

        assert _file_ops.read(str(target)) == {"content": "hello world"}

    def test_reads_an_empty_file(self, tmp_path: Path) -> None:
        target = tmp_path / "empty.txt"
        target.write_text("", encoding="utf-8")

        assert _file_ops.read(str(target)) == {"content": ""}

    def test_preserves_line_breaks_and_the_trailing_newline(self, tmp_path: Path) -> None:
        target = tmp_path / "lines.txt"
        target.write_text("one\ntwo\n", encoding="utf-8")

        assert _file_ops.read(str(target)) == {"content": "one\ntwo\n"}

    def test_reads_non_ascii_text(self, tmp_path: Path) -> None:
        target = tmp_path / "accents.txt"
        target.write_text("héllo wörld ✓", encoding="utf-8")

        assert _file_ops.read(str(target)) == {"content": "héllo wörld ✓"}

    def test_reads_a_file_in_a_nested_folder(self, tmp_path: Path) -> None:
        target = tmp_path / "a" / "b" / "deep.txt"
        target.parent.mkdir(parents=True)
        target.write_text("deep", encoding="utf-8")

        assert _file_ops.read(str(target)) == {"content": "deep"}


class TestReadDropsTheByteOrderMark:
    """A leading UTF-8 byte-order mark is not part of the text; a later one is."""

    def test_drops_a_leading_byte_order_mark(self, tmp_path: Path) -> None:
        target = tmp_path / "bom.txt"
        target.write_bytes(b"\xef\xbb\xbfhello")

        assert _file_ops.read(str(target)) == {"content": "hello"}

    def test_drops_the_mark_before_non_ascii_text(self, tmp_path: Path) -> None:
        target = tmp_path / "bom-accents.txt"
        target.write_bytes(b"\xef\xbb\xbf" + "héllo".encode())

        assert _file_ops.read(str(target)) == {"content": "héllo"}

    def test_keeps_a_mark_that_is_not_leading(self, tmp_path: Path) -> None:
        target = tmp_path / "inner-bom.txt"
        target.write_bytes("a\ufeffb".encode())

        assert _file_ops.read(str(target)) == {"content": "a\ufeffb"}


class TestReadHasNoSizeCap:
    """A large file is read whole."""

    def test_reads_a_one_megabyte_file(self, tmp_path: Path) -> None:
        target = tmp_path / "big.txt"
        text = "x" * 1_000_000
        target.write_text(text, encoding="utf-8")

        assert _file_ops.read(str(target)) == {"content": text}


class TestReadFollowsSymlinks:
    """A symlink is followed to the file it points at."""

    def test_reads_through_a_symlink_beside_the_file(self, tmp_path: Path) -> None:
        target = tmp_path / "real.txt"
        target.write_text("linked", encoding="utf-8")
        link = tmp_path / "alias.txt"
        link.symlink_to(target)

        assert _file_ops.read(str(link)) == {"content": "linked"}

    def test_reads_through_a_symlink_into_another_folder(self, tmp_path: Path) -> None:
        outside = tmp_path / "outside"
        outside.mkdir()
        target = outside / "real.txt"
        target.write_text("elsewhere", encoding="utf-8")
        inside = tmp_path / "inside"
        inside.mkdir()
        link = inside / "alias.txt"
        link.symlink_to(target)

        assert _file_ops.read(str(link)) == {"content": "elsewhere"}


class TestReadErrors:
    """A missing path, a folder, and non-UTF-8 bytes each raise their exact message."""

    def test_missing_file(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"File not found: {target}")):
            _file_ops.read(str(target))

    def test_missing_file_under_a_missing_folder(self, tmp_path: Path) -> None:
        target = tmp_path / "nowhere" / "absent.txt"

        with pytest.raises(OSError, match=_exact(f"File not found: {target}")):
            _file_ops.read(str(target))

    def test_folder_as_the_path(self, tmp_path: Path) -> None:
        target = tmp_path / "folder"
        target.mkdir()

        with pytest.raises(OSError, match=_exact(f"File not found: {target}")):
            _file_ops.read(str(target))

    def test_bytes_that_are_not_utf8(self, tmp_path: Path) -> None:
        target = tmp_path / "binary.bin"
        target.write_bytes(b"\xff\xfe\x00\x01")

        with pytest.raises(ValueError, match=_exact(f"File is not UTF-8 text: {target}")):
            _file_ops.read(str(target))

    def test_a_truncated_multibyte_sequence(self, tmp_path: Path) -> None:
        target = tmp_path / "truncated.txt"
        target.write_bytes(b"cafe\xc3")

        with pytest.raises(ValueError, match=_exact(f"File is not UTF-8 text: {target}")):
            _file_ops.read(str(target))
