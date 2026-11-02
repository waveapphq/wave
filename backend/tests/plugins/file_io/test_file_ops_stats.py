"""Stats in the stdlib File I/O core (REQ-3.4.1.10).

Stats reports whether a path is there and what it is, optionally its size and a
digest of its bytes, in one of three shapes: individual outputs, one map, or a
one-row table. A missing path is never a failure.
"""

import hashlib
import os
from pathlib import Path

from wavecore.plugins import _file_ops

# A whole-second timestamp, so the ISO text carries no fractional part.
_MTIME = 1767225600
_MTIME_ISO = "2026-01-01T00:00:00+00:00"

_BODY = b"the file's bytes"


def _file_with_known_mtime(tmp_path: Path, name: str = "note.txt") -> Path:
    """A file holding the known body, stamped with the known modification time."""
    target = tmp_path / name
    target.write_bytes(_BODY)
    os.utime(target, (_MTIME, _MTIME))
    return target


def _folder_with_known_mtime(tmp_path: Path, name: str = "folder") -> Path:
    """A folder stamped with the known modification time."""
    target = tmp_path / name
    target.mkdir()
    os.utime(target, (_MTIME, _MTIME))
    return target


class TestStatsIndividualOnAFile:
    """The individual outputs of a file, and the keys each setting adds."""

    def test_reports_exists_type_and_modified(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "individual")

        assert result == {"exists": True, "type": "file", "modified": _MTIME_ISO}

    def test_adds_the_size_when_ticked(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), True, "none", "individual")

        assert result == {
            "exists": True,
            "type": "file",
            "modified": _MTIME_ISO,
            "size": len(_BODY),
        }

    def test_reports_zero_for_an_empty_file(self, tmp_path: Path) -> None:
        target = tmp_path / "empty.txt"
        target.write_bytes(b"")

        result = _file_ops.stats(str(target), True, "none", "individual")

        assert result["size"] == 0

    def test_the_modified_text_carries_the_utc_offset(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "individual")

        assert result["modified"].endswith("+00:00")

    def test_follows_a_symlink_to_the_file(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)
        link = tmp_path / "alias.txt"
        link.symlink_to(target)

        result = _file_ops.stats(str(link), True, "none", "individual")

        assert result["type"] == "file"
        assert result["size"] == len(_BODY)


class TestStatsChecksum:
    """Each algorithm answers the hex digest of the file's bytes; None adds no key."""

    def test_none_adds_no_checksum_key(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "individual")

        assert "checksum" not in result

    def test_md5(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "md5", "individual")

        assert result["checksum"] == hashlib.md5(_BODY).hexdigest()

    def test_sha1(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "sha1", "individual")

        assert result["checksum"] == hashlib.sha1(_BODY).hexdigest()

    def test_sha256(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "sha256", "individual")

        assert result["checksum"] == hashlib.sha256(_BODY).hexdigest()

    def test_sha512(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "sha512", "individual")

        assert result["checksum"] == hashlib.sha512(_BODY).hexdigest()

    def test_digests_an_empty_file(self, tmp_path: Path) -> None:
        target = tmp_path / "empty.txt"
        target.write_bytes(b"")

        result = _file_ops.stats(str(target), False, "sha256", "individual")

        assert result["checksum"] == hashlib.sha256(b"").hexdigest()

    def test_digests_bytes_that_are_not_text(self, tmp_path: Path) -> None:
        target = tmp_path / "binary.bin"
        target.write_bytes(b"\x00\xff\x10")

        result = _file_ops.stats(str(target), False, "sha256", "individual")

        assert result["checksum"] == hashlib.sha256(b"\x00\xff\x10").hexdigest()

    def test_a_folder_has_an_empty_checksum(self, tmp_path: Path) -> None:
        target = _folder_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "sha256", "individual")

        assert result["checksum"] == ""


class TestStatsIndividualOnAFolder:
    """A folder reports type folder; only its checksum is defined as empty."""

    def test_reports_the_folder_type(self, tmp_path: Path) -> None:
        target = _folder_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "individual")

        assert result == {"exists": True, "type": "folder", "modified": _MTIME_ISO}

    def test_reports_a_size_when_ticked(self, tmp_path: Path) -> None:
        target = _folder_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), True, "none", "individual")

        assert isinstance(result["size"], int)
        assert result["size"] >= 0

    def test_an_empty_folder_reports_zero(self, tmp_path: Path) -> None:
        target = _folder_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), True, "none", "individual")

        assert result["size"] == 0

    def test_the_size_totals_everything_inside(self, tmp_path: Path) -> None:
        """A folder's size answers how much it holds, not the directory entry."""
        target = _folder_with_known_mtime(tmp_path)
        (target / "top.txt").write_bytes(b"12345")
        (target / "nested").mkdir()
        (target / "nested" / "inner.txt").write_bytes(b"678")

        result = _file_ops.stats(str(target), True, "none", "individual")

        assert result["size"] == 8

    def test_the_size_skips_symlinks(self, tmp_path: Path) -> None:
        """A link is not the bytes it points at, so it never double-counts them."""
        outside = tmp_path / "outside.txt"
        outside.write_bytes(b"0123456789")
        target = _folder_with_known_mtime(tmp_path)
        (target / "real.txt").write_bytes(b"12345")
        (target / "link.txt").symlink_to(outside)
        (target / "linked-folder").symlink_to(tmp_path, target_is_directory=True)

        result = _file_ops.stats(str(target), True, "none", "individual")

        assert result["size"] == 5

    def test_a_folder_that_cannot_be_walked_counts_as_nothing(self, tmp_path: Path) -> None:
        """A folder WAVE cannot open contributes zero instead of failing the block."""
        not_a_folder = tmp_path / "note.txt"
        not_a_folder.write_bytes(_BODY)

        assert _file_ops._folder_size(str(not_a_folder)) == 0

    def test_the_size_counts_every_depth(self, tmp_path: Path) -> None:
        """Nested folders count too, all the way down."""
        target = _folder_with_known_mtime(tmp_path)
        deep = target / "a" / "b" / "c"
        deep.mkdir(parents=True)
        (deep / "deep.txt").write_bytes(b"0123456789")

        result = _file_ops.stats(str(target), True, "none", "individual")

        assert result["size"] == 10


class TestStatsOnAMissingPath:
    """A missing path never fails: it answers the empty shape."""

    def test_reports_exists_false(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        result = _file_ops.stats(str(target), False, "none", "individual")

        assert result == {"exists": False, "type": "", "modified": ""}

    def test_reports_zero_size_when_ticked(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        result = _file_ops.stats(str(target), True, "none", "individual")

        assert result == {"exists": False, "type": "", "modified": "", "size": 0}

    def test_reports_an_empty_checksum_when_chosen(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        result = _file_ops.stats(str(target), False, "sha256", "individual")

        assert result == {"exists": False, "type": "", "modified": "", "checksum": ""}

    def test_reports_the_empty_shape_under_a_missing_folder(self, tmp_path: Path) -> None:
        target = tmp_path / "nowhere" / "absent.txt"

        result = _file_ops.stats(str(target), False, "none", "individual")

        assert result == {"exists": False, "type": "", "modified": ""}

    def test_creates_nothing(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        _file_ops.stats(str(target), True, "sha256", "individual")

        assert list(tmp_path.iterdir()) == []


class TestStatsMap:
    """The map shape carries the same keys under a single 'stats' output."""

    def test_wraps_the_individual_keys(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "map")

        assert result == {"stats": {"exists": True, "type": "file", "modified": _MTIME_ISO}}

    def test_carries_the_size_and_the_checksum(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), True, "sha256", "map")

        assert result == {
            "stats": {
                "exists": True,
                "type": "file",
                "modified": _MTIME_ISO,
                "size": len(_BODY),
                "checksum": hashlib.sha256(_BODY).hexdigest(),
            }
        }

    def test_carries_the_empty_shape_for_a_missing_path(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        result = _file_ops.stats(str(target), False, "none", "map")

        assert result == {"stats": {"exists": False, "type": "", "modified": ""}}


class TestStatsTable:
    """The table shape is a one-row table envelope with the same columns."""

    def test_is_a_table_envelope(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "table")

        assert result["stats"]["__wave_type"] == "table"

    def test_columns_without_the_size_or_the_checksum(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "table")

        assert result["stats"]["columns"] == [
            {"name": "exists", "type": "boolean"},
            {"name": "type", "type": "string"},
            {"name": "modified", "type": "string"},
        ]

    def test_columns_with_the_size_and_the_checksum(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), True, "sha256", "table")

        assert result["stats"]["columns"] == [
            {"name": "exists", "type": "boolean"},
            {"name": "type", "type": "string"},
            {"name": "modified", "type": "string"},
            {"name": "size", "type": "integer"},
            {"name": "checksum", "type": "string"},
        ]

    def test_holds_exactly_one_row(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "table")

        assert result["stats"]["rows"] == [[True, "file", _MTIME_ISO]]

    def test_the_row_carries_the_size_and_the_checksum(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), True, "sha256", "table")

        assert result["stats"]["rows"] == [
            [
                True,
                "file",
                _MTIME_ISO,
                len(_BODY),
                hashlib.sha256(_BODY).hexdigest(),
            ]
        ]

    def test_a_missing_path_still_holds_one_row(self, tmp_path: Path) -> None:
        target = tmp_path / "absent.txt"

        result = _file_ops.stats(str(target), True, "sha256", "table")

        assert result["stats"]["rows"] == [[False, "", "", 0, ""]]

    def test_the_envelope_carries_no_other_key(self, tmp_path: Path) -> None:
        target = _file_with_known_mtime(tmp_path)

        result = _file_ops.stats(str(target), False, "none", "table")

        assert set(result) == {"stats"}
        assert set(result["stats"]) == {"__wave_type", "columns", "rows"}
