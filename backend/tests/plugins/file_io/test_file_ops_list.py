"""List in the stdlib File I/O core (REQ-3.4.1.10).

List answers a folder's entries as a table plus their count. Paths are relative
to the listed folder with posix separators, the pattern is a Python regular
expression searched against each entry name, and symlinks and dot-directories
are never listed.
"""

import os
import re
from pathlib import Path

import pytest

from wavecore.plugins import _file_ops

# A whole-second timestamp, so the ISO text carries no fractional part.
_MTIME = 1767225600
_MTIME_ISO = "2026-01-01T00:00:00+00:00"


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


def _stamp(path: Path) -> Path:
    """Stamp one entry with the known modification time."""
    os.utime(path, (_MTIME, _MTIME))
    return path


def _write(path: Path, body: str) -> Path:
    """Create a file with a body and the known modification time."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return _stamp(path)


class TestListTableEnvelope:
    """Entries are a table envelope; count is its row count."""

    def test_answers_entries_and_count_only(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "one")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert set(result) == {"entries", "count"}

    def test_entries_is_a_table_envelope(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "one")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert result["entries"]["__wave_type"] == "table"
        assert set(result["entries"]) == {"__wave_type", "columns", "rows"}

    def test_columns_without_the_size(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "one")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert result["entries"]["columns"] == [
            {"name": "name", "type": "string"},
            {"name": "path", "type": "string"},
            {"name": "type", "type": "string"},
            {"name": "modified", "type": "string"},
        ]

    def test_columns_with_the_size(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "one")

        result = _file_ops.list_entries(str(tmp_path), "", False, True)

        assert result["entries"]["columns"] == [
            {"name": "name", "type": "string"},
            {"name": "path", "type": "string"},
            {"name": "type", "type": "string"},
            {"name": "modified", "type": "string"},
            {"name": "size", "type": "integer"},
        ]

    def test_a_file_row_carries_name_path_type_and_modified(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "one")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert result["entries"]["rows"] == [["one.txt", "one.txt", "file", _MTIME_ISO]]

    def test_a_file_row_carries_its_size_in_bytes(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "hello")

        result = _file_ops.list_entries(str(tmp_path), "", False, True)

        assert result["entries"]["rows"] == [["one.txt", "one.txt", "file", _MTIME_ISO, 5]]

    def test_a_folder_row_carries_the_folder_type(self, tmp_path: Path) -> None:
        (tmp_path / "sub").mkdir()
        _stamp(tmp_path / "sub")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert result["entries"]["rows"] == [["sub", "sub", "folder", _MTIME_ISO]]

    def test_a_folder_row_carries_an_integer_size_when_ticked(self, tmp_path: Path) -> None:
        (tmp_path / "sub").mkdir()
        _stamp(tmp_path / "sub")

        result = _file_ops.list_entries(str(tmp_path), "", False, True)

        assert isinstance(result["entries"]["rows"][0][4], int)

    def test_a_folder_row_totals_everything_inside_at_every_depth(self, tmp_path: Path) -> None:
        """A folder row answers how much it holds, nested folders included."""
        _write(tmp_path / "sub" / "top.txt", "12345")
        _write(tmp_path / "sub" / "nested" / "inner.txt", "678")
        _stamp(tmp_path / "sub")

        result = _file_ops.list_entries(str(tmp_path), "", False, True)

        assert result["entries"]["rows"][0][4] == 8

    def test_an_empty_folder_row_carries_zero(self, tmp_path: Path) -> None:
        (tmp_path / "sub").mkdir()
        _stamp(tmp_path / "sub")

        result = _file_ops.list_entries(str(tmp_path), "", False, True)

        assert result["entries"]["rows"][0][4] == 0

    def test_each_nested_folder_row_carries_its_own_total(self, tmp_path: Path) -> None:
        """Listing every depth gives each folder row the total below that folder."""
        _write(tmp_path / "sub" / "top.txt", "12345")
        _write(tmp_path / "sub" / "nested" / "inner.txt", "678")
        _stamp(tmp_path / "sub")
        _stamp(tmp_path / "sub" / "nested")

        result = _file_ops.list_entries(str(tmp_path), "", True, True)

        sizes = {row[1]: row[4] for row in result["entries"]["rows"] if row[2] == "folder"}
        assert sizes == {"sub": 8, "sub/nested": 3}

    def test_count_matches_the_row_count(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "one")
        _write(tmp_path / "two.txt", "two")
        _write(tmp_path / "three.txt", "three")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert result["count"] == 3
        assert len(result["entries"]["rows"]) == 3

    def test_an_empty_folder_lists_nothing(self, tmp_path: Path) -> None:
        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert result["count"] == 0
        assert result["entries"]["rows"] == []


class TestListSorting:
    """Entries are sorted by path, byte by byte."""

    def test_sorts_uppercase_before_lowercase(self, tmp_path: Path) -> None:
        _write(tmp_path / "a.txt", "a")
        _write(tmp_path / "B.txt", "b")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert [row[1] for row in result["entries"]["rows"]] == ["B.txt", "a.txt"]

    def test_sorts_nested_paths_after_their_folder(self, tmp_path: Path) -> None:
        _write(tmp_path / "sub" / "inner.txt", "inner")
        _write(tmp_path / "top.txt", "top")
        _stamp(tmp_path / "sub")

        result = _file_ops.list_entries(str(tmp_path), "", True, False)

        assert [row[1] for row in result["entries"]["rows"]] == [
            "sub",
            "sub/inner.txt",
            "top.txt",
        ]


class TestListRecursion:
    """Include subfolders decides whether entries below the folder are listed."""

    def test_off_lists_only_direct_children(self, tmp_path: Path) -> None:
        _write(tmp_path / "sub" / "inner.txt", "inner")
        _write(tmp_path / "top.txt", "top")
        _stamp(tmp_path / "sub")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert [row[1] for row in result["entries"]["rows"]] == ["sub", "top.txt"]

    def test_on_lists_every_depth(self, tmp_path: Path) -> None:
        _write(tmp_path / "a" / "b" / "deep.txt", "deep")
        _stamp(tmp_path / "a" / "b")
        _stamp(tmp_path / "a")

        result = _file_ops.list_entries(str(tmp_path), "", True, False)

        assert [row[1] for row in result["entries"]["rows"]] == ["a", "a/b", "a/b/deep.txt"]

    def test_a_nested_path_uses_posix_separators(self, tmp_path: Path) -> None:
        _write(tmp_path / "a" / "b" / "deep.txt", "deep")
        _stamp(tmp_path / "a" / "b")
        _stamp(tmp_path / "a")

        result = _file_ops.list_entries(str(tmp_path), "", True, False)

        assert result["entries"]["rows"][-1][1] == "a/b/deep.txt"

    def test_a_nested_name_is_the_base_name(self, tmp_path: Path) -> None:
        _write(tmp_path / "a" / "deep.txt", "deep")
        _stamp(tmp_path / "a")

        result = _file_ops.list_entries(str(tmp_path), "", True, False)

        assert result["entries"]["rows"][-1][0] == "deep.txt"


class TestListPattern:
    """The pattern is a Python regular expression searched against the entry name."""

    def test_an_empty_pattern_lists_everything(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "one")
        _write(tmp_path / "two.log", "two")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert result["count"] == 2

    def test_filters_by_the_name(self, tmp_path: Path) -> None:
        _write(tmp_path / "report-1.json", "one")
        _write(tmp_path / "notes.txt", "two")

        result = _file_ops.list_entries(str(tmp_path), r"^report-.*\.json$", False, False)

        assert [row[0] for row in result["entries"]["rows"]] == ["report-1.json"]

    def test_searches_anywhere_in_the_name(self, tmp_path: Path) -> None:
        _write(tmp_path / "report-1.json", "one")
        _write(tmp_path / "notes.txt", "two")

        result = _file_ops.list_entries(str(tmp_path), "port", False, False)

        assert [row[0] for row in result["entries"]["rows"]] == ["report-1.json"]

    def test_matches_the_name_not_the_relative_path(self, tmp_path: Path) -> None:
        _write(tmp_path / "sub" / "inner.txt", "inner")
        _stamp(tmp_path / "sub")

        result = _file_ops.list_entries(str(tmp_path), "^inner", True, False)

        assert [row[1] for row in result["entries"]["rows"]] == ["sub/inner.txt"]

    def test_matches_folders_too(self, tmp_path: Path) -> None:
        (tmp_path / "reports").mkdir()
        _stamp(tmp_path / "reports")
        _write(tmp_path / "notes.txt", "two")

        result = _file_ops.list_entries(str(tmp_path), "^reports$", False, False)

        assert [row[0] for row in result["entries"]["rows"]] == ["reports"]

    def test_a_pattern_that_matches_nothing_lists_nothing(self, tmp_path: Path) -> None:
        _write(tmp_path / "one.txt", "one")

        result = _file_ops.list_entries(str(tmp_path), "^nothing$", False, False)

        assert result["count"] == 0
        assert result["entries"]["rows"] == []

    def test_a_filtered_folder_still_yields_its_matching_children(self, tmp_path: Path) -> None:
        _write(tmp_path / "sub" / "report.txt", "one")
        _stamp(tmp_path / "sub")

        result = _file_ops.list_entries(str(tmp_path), "^report", True, False)

        assert [row[1] for row in result["entries"]["rows"]] == ["sub/report.txt"]


class TestListSkipsSymlinksAndDotDirectories:
    """A symlink is never listed, and a dot-directory is neither listed nor entered."""

    def test_a_symlink_to_a_file_is_not_listed(self, tmp_path: Path) -> None:
        _write(tmp_path / "real.txt", "real")
        (tmp_path / "alias.txt").symlink_to(tmp_path / "real.txt")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert [row[0] for row in result["entries"]["rows"]] == ["real.txt"]

    def test_a_symlink_to_a_folder_is_not_listed(self, tmp_path: Path) -> None:
        _write(tmp_path / "outside" / "real.txt", "real")
        _stamp(tmp_path / "outside")
        root = tmp_path / "root"
        root.mkdir()
        (root / "alias").symlink_to(tmp_path / "outside")

        result = _file_ops.list_entries(str(root), "", False, False)

        assert result["count"] == 0

    def test_a_symlinked_folder_is_not_entered(self, tmp_path: Path) -> None:
        _write(tmp_path / "outside" / "real.txt", "real")
        _stamp(tmp_path / "outside")
        root = tmp_path / "root"
        root.mkdir()
        (root / "alias").symlink_to(tmp_path / "outside")

        result = _file_ops.list_entries(str(root), "", True, False)

        assert result["count"] == 0

    def test_a_dot_directory_is_not_listed(self, tmp_path: Path) -> None:
        _write(tmp_path / ".hidden" / "secret.txt", "secret")
        _stamp(tmp_path / ".hidden")
        _write(tmp_path / "shown.txt", "shown")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert [row[0] for row in result["entries"]["rows"]] == ["shown.txt"]

    def test_a_dot_directory_is_not_entered(self, tmp_path: Path) -> None:
        _write(tmp_path / ".hidden" / "secret.txt", "secret")
        _stamp(tmp_path / ".hidden")
        _write(tmp_path / "shown.txt", "shown")

        result = _file_ops.list_entries(str(tmp_path), "", True, False)

        assert [row[1] for row in result["entries"]["rows"]] == ["shown.txt"]

    def test_a_dot_file_is_listed(self, tmp_path: Path) -> None:
        _write(tmp_path / ".env", "KEY=value")

        result = _file_ops.list_entries(str(tmp_path), "", False, False)

        assert [row[0] for row in result["entries"]["rows"]] == [".env"]


class TestListFolderNotFound:
    """A path that is not a folder names itself in the refusal."""

    def test_a_missing_folder(self, tmp_path: Path) -> None:
        target = tmp_path / "absent"

        with pytest.raises(OSError, match=_exact(f"Folder not found: {target}")):
            _file_ops.list_entries(str(target), "", False, False)

    def test_a_missing_folder_under_a_missing_parent(self, tmp_path: Path) -> None:
        target = tmp_path / "nowhere" / "absent"

        with pytest.raises(OSError, match=_exact(f"Folder not found: {target}")):
            _file_ops.list_entries(str(target), "", False, False)

    def test_a_file_as_the_folder(self, tmp_path: Path) -> None:
        target = _write(tmp_path / "note.txt", "note")

        with pytest.raises(OSError, match=_exact(f"Folder not found: {target}")):
            _file_ops.list_entries(str(target), "", False, False)
