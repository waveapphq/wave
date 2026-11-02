"""SFTP List: the entries of a server folder, a file or a pattern (REQ-3.4.1.8, SFTP-3, SFTP-9)."""

import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

from tests.plugins.sftp.conftest import LogRecorder, SFTPEndpoint, columns, rows
from wavecore.plugins import _file_ops

ENTRY_COLUMNS = [
    ("name", "string"),
    ("path", "string"),
    ("type", "string"),
    ("modified", "string"),
    ("size", "integer"),
]
LIST_KEYS = {"entries", "count", "success", "error", "reason"}
# 2026-09-28T10:00:00+00:00; SFTP v3 carries whole seconds.
MTIME = 1_790_589_600


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _stamp(ep: SFTPEndpoint, path: str, offset: int = 0) -> int:
    """Give a server path its own whole-second mtime and return it."""
    mtime = MTIME + offset
    os.utime(ep.disk(path), (mtime, mtime))
    return mtime


def _entry(name: str, path: str, kind: str, mtime: int, size: int = 0) -> list[Any]:
    return [name, path, kind, _file_ops.iso_modified(mtime), size]


def _listed(count: int, path: str) -> tuple[str, str]:
    return ("INFO", f"Listed {count} {'entry' if count == 1 else 'entries'} in {path}")


def _recorded(message: str, reason: str) -> dict[str, Any]:
    return {"success": False, "error": message, "reason": reason, "__block_warning": True}


@contextmanager
def _locked(folder: Path) -> Iterator[None]:
    """Take every permission off a server folder for the test's body."""
    folder.chmod(0)
    try:
        yield
    finally:
        folder.chmod(0o755)


class TestOutputs:
    """List gives Entries and Count plus the output core (SFTP-9)."""

    async def test_entries_columns_in_order(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        sftp_endpoint.write("/outbound/orders.out", "12345")
        out = await sftp_endpoint.run(sftp_endpoint.params("list", path="/outbound"), log)
        assert columns(out["entries"]) == ENTRY_COLUMNS

    async def test_only_the_list_outputs_and_a_passed_core(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        sftp_endpoint.write("/outbound/orders.out", "12345")
        out = await sftp_endpoint.run(sftp_endpoint.params("list", path="/outbound"), log)
        assert set(out) == LIST_KEYS
        assert (out["count"], out["success"], out["error"], out["reason"]) == (1, True, "", "")


class TestFolder:
    """A folder Path lists its entries, one level deep, sorted by path."""

    async def test_absolute_folder(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/orders.out", "12345")
        ep.write("/outbound/archive/old.out", "old")
        file_time = _stamp(ep, "/outbound/orders.out", 60)
        folder_time = _stamp(ep, "/outbound/archive", 120)
        out = await ep.run(ep.params("list", path="/outbound"), log)
        assert rows(out["entries"]) == [
            _entry("archive", "/outbound/archive", "folder", folder_time),
            _entry("orders.out", "/outbound/orders.out", "file", file_time, 5),
        ]
        assert out["count"] == 2
        assert log == [_listed(2, "/outbound")]

    async def test_relative_folder_keeps_the_path_as_written(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("outbound/orders.out", "abc")
        mtime = _stamp(ep, "outbound/orders.out")
        out = await ep.run(ep.params("list", path="outbound"), log)
        assert rows(out["entries"]) == [
            _entry("orders.out", "outbound/orders.out", "file", mtime, 3)
        ]
        assert log == [_listed(1, "outbound")]

    async def test_a_folder_reports_size_zero(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/big/data.bin", b"x" * 10_000)
        mtime = _stamp(ep, "/outbound/big")
        out = await ep.run(ep.params("list", path="/outbound"), log)
        assert rows(out["entries"]) == [_entry("big", "/outbound/big", "folder", mtime, 0)]

    async def test_an_empty_folder_gives_no_entries(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        """The server's own `.` and `..` are never entries."""
        sftp_endpoint.mkdir("/empty")
        out = await sftp_endpoint.run(sftp_endpoint.params("list", path="/empty"), log)
        assert (rows(out["entries"]), out["count"], out["success"]) == ([], 0, True)
        assert log == [_listed(0, "/empty")]

    async def test_rows_are_sorted_by_path(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        for path in ("/o/b.txt", "/o/a-b.txt", "/o/a/z.txt"):
            ep.write(path, "1")
        mtime = _stamp(ep, "/o/a")
        for path in ("/o/b.txt", "/o/a-b.txt", "/o/a/z.txt"):
            _stamp(ep, path)
        out = await ep.run(ep.params("list", path="/o", recursive=True), log)
        assert [row[1] for row in rows(out["entries"])] == [
            "/o/a",
            "/o/a-b.txt",
            "/o/a/z.txt",
            "/o/b.txt",
        ]
        assert rows(out["entries"])[0] == _entry("a", "/o/a", "folder", mtime)


class TestFile:
    """A file Path gives that one entry."""

    @pytest.mark.parametrize("recursive", [None, False, True])
    async def test_a_file_path_gives_one_entry(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, recursive: bool | None
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/orders.out", "12345")
        ep.write("/outbound/other.out", "x")
        mtime = _stamp(ep, "/outbound/orders.out")
        params = ep.params("list", path="/outbound/orders.out", recursive=recursive)
        out = await ep.run(params, log)
        assert rows(out["entries"]) == [
            _entry("orders.out", "/outbound/orders.out", "file", mtime, 5)
        ]
        assert out["count"] == 1
        assert log == [_listed(1, "/outbound/orders.out")]

    async def test_a_relative_file_path(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("orders.out", "1234")
        mtime = _stamp(ep, "orders.out")
        out = await ep.run(ep.params("list", path="orders.out"), log)
        assert rows(out["entries"]) == [_entry("orders.out", "orders.out", "file", mtime, 4)]


class TestIncludeSubfolders:
    """Include subfolders descends into every listed folder, at every depth."""

    @staticmethod
    def _seed(ep: SFTPEndpoint) -> dict[str, int]:
        ep.write("/outbound/top.txt", "t")
        ep.write("/outbound/a/b/c/deep.txt", "deep!")
        ep.write("/outbound/a/mid.txt", "mid")
        paths = [
            "/outbound/top.txt",
            "/outbound/a/b/c/deep.txt",
            "/outbound/a/mid.txt",
            "/outbound/a/b/c",
            "/outbound/a/b",
            "/outbound/a",
        ]
        return {path: _stamp(ep, path, offset) for offset, path in enumerate(paths)}

    @pytest.mark.parametrize("recursive", [None, False])
    async def test_off_lists_one_level(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, recursive: bool | None
    ) -> None:
        times = self._seed(sftp_endpoint)
        params = sftp_endpoint.params("list", path="/outbound", recursive=recursive)
        out = await sftp_endpoint.run(params, log)
        assert rows(out["entries"]) == [
            _entry("a", "/outbound/a", "folder", times["/outbound/a"]),
            _entry("top.txt", "/outbound/top.txt", "file", times["/outbound/top.txt"], 1),
        ]
        assert log == [_listed(2, "/outbound")]

    async def test_on_lists_every_depth(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        times = self._seed(sftp_endpoint)
        params = sftp_endpoint.params("list", path="/outbound", recursive=True)
        out = await sftp_endpoint.run(params, log)
        assert rows(out["entries"]) == [
            _entry("a", "/outbound/a", "folder", times["/outbound/a"]),
            _entry("b", "/outbound/a/b", "folder", times["/outbound/a/b"]),
            _entry("c", "/outbound/a/b/c", "folder", times["/outbound/a/b/c"]),
            _entry(
                "deep.txt",
                "/outbound/a/b/c/deep.txt",
                "file",
                times["/outbound/a/b/c/deep.txt"],
                5,
            ),
            _entry("mid.txt", "/outbound/a/mid.txt", "file", times["/outbound/a/mid.txt"], 3),
            _entry("top.txt", "/outbound/top.txt", "file", times["/outbound/top.txt"], 1),
        ]
        assert out["count"] == 6
        assert log == [_listed(6, "/outbound")]

    async def test_on_keeps_a_relative_path_as_written(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("outbound/sub/x.txt", "xy")
        sub_time = _stamp(ep, "outbound/sub", 1)
        file_time = _stamp(ep, "outbound/sub/x.txt", 2)
        out = await ep.run(ep.params("list", path="outbound", recursive=True), log)
        assert rows(out["entries"]) == [
            _entry("sub", "outbound/sub", "folder", sub_time),
            _entry("x.txt", "outbound/sub/x.txt", "file", file_time, 2),
        ]


class TestSkippedEntries:
    """Listing skips symbolic links and hidden folders, but lists hidden files (FIO-7)."""

    async def test_symbolic_links_are_skipped(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/real.txt", "r")
        ep.write("/data/inside.txt", "i")
        os.symlink(ep.disk("/data"), ep.disk("/outbound/to-folder"))
        os.symlink("real.txt", ep.disk("/outbound/to-file"))
        os.symlink("gone.txt", ep.disk("/outbound/broken"))
        mtime = _stamp(ep, "/outbound/real.txt")
        out = await ep.run(ep.params("list", path="/outbound", recursive=True), log)
        assert rows(out["entries"]) == [_entry("real.txt", "/outbound/real.txt", "file", mtime, 1)]
        assert log == [_listed(1, "/outbound")]

    async def test_hidden_folders_are_skipped_with_their_content(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/.cache/state.bin", "s")
        ep.write("/outbound/sub/.git/HEAD", "h")
        ep.write("/outbound/sub/code.py", "c")
        sub_time = _stamp(ep, "/outbound/sub", 1)
        code_time = _stamp(ep, "/outbound/sub/code.py", 2)
        out = await ep.run(ep.params("list", path="/outbound", recursive=True), log)
        assert rows(out["entries"]) == [
            _entry("sub", "/outbound/sub", "folder", sub_time),
            _entry("code.py", "/outbound/sub/code.py", "file", code_time, 1),
        ]

    async def test_hidden_files_are_listed(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/.env", "KEY=1")
        mtime = _stamp(ep, "/outbound/.env")
        out = await ep.run(ep.params("list", path="/outbound"), log)
        assert rows(out["entries"]) == [_entry(".env", "/outbound/.env", "file", mtime, 5)]


class TestWildcard:
    """A pattern lists only its matches; `*` never matches a leading dot (SFTP-3)."""

    async def test_lists_only_the_matches(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        for name in ("a.csv", "b.csv", "c.txt"):
            ep.write(f"/outbound/{name}", name)
        a_time = _stamp(ep, "/outbound/a.csv", 1)
        b_time = _stamp(ep, "/outbound/b.csv", 2)
        out = await ep.run(ep.params("list", path="/outbound/*.csv"), log)
        assert rows(out["entries"]) == [
            _entry("a.csv", "/outbound/a.csv", "file", a_time, 5),
            _entry("b.csv", "/outbound/b.csv", "file", b_time, 5),
        ]
        assert out["count"] == 2
        assert log == [_listed(2, "/outbound/*.csv")]

    @pytest.mark.parametrize(
        ("pattern", "names"),
        [
            ("/outbound/day?.csv", ["day1.csv", "day2.csv", "day3.csv"]),
            ("/outbound/day[12].csv", ["day1.csv", "day2.csv"]),
            ("/outbound/day[!12].csv", ["day3.csv"]),
            ("/outbound/day1*", ["day1.csv", "day10.csv"]),
        ],
    )
    async def test_question_mark_and_brackets(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, pattern: str, names: list[str]
    ) -> None:
        for name in ("day1.csv", "day2.csv", "day3.csv", "day10.csv"):
            sftp_endpoint.write(f"/outbound/{name}", "d")
        out = await sftp_endpoint.run(sftp_endpoint.params("list", path=pattern), log)
        assert [row[0] for row in rows(out["entries"])] == names

    async def test_star_does_not_match_a_leading_dot(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/.hidden", "h")
        ep.write("/outbound/.cfg/inner.txt", "i")
        ep.write("/outbound/seen.txt", "s")
        out = await ep.run(ep.params("list", path="/outbound/*", recursive=True), log)
        assert [row[1] for row in rows(out["entries"])] == ["/outbound/seen.txt"]

    async def test_a_leading_dot_pattern_matches_hidden_names_but_never_dot_or_dot_dot(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/.hidden", "hh")
        ep.write("/outbound/seen.txt", "s")
        mtime = _stamp(ep, "/outbound/.hidden")
        out = await ep.run(ep.params("list", path="/outbound/.*"), log)
        assert rows(out["entries"]) == [_entry(".hidden", "/outbound/.hidden", "file", mtime, 2)]

    async def test_a_pattern_in_a_middle_segment(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/data/a/orders.csv", "a")
        ep.write("/data/b/orders.csv", "b")
        ep.write("/data/c/other.csv", "c")
        out = await ep.run(ep.params("list", path="/data/*/orders.csv"), log)
        assert [row[1] for row in rows(out["entries"])] == [
            "/data/a/orders.csv",
            "/data/b/orders.csv",
        ]
        assert log == [_listed(2, "/data/*/orders.csv")]

    async def test_a_relative_pattern_keeps_the_path_as_written(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("outbound/a.csv", "1")
        ep.write("outbound/b.txt", "2")
        mtime = _stamp(ep, "outbound/a.csv")
        out = await ep.run(ep.params("list", path="outbound/*.csv"), log)
        assert rows(out["entries"]) == [_entry("a.csv", "outbound/a.csv", "file", mtime, 1)]

    @staticmethod
    def _seed_batches(ep: SFTPEndpoint) -> dict[str, int]:
        ep.write("/outbound/batch-1/x.txt", "x")
        ep.write("/outbound/batch-1/sub/y.txt", "yy")
        ep.write("/outbound/batch-2.txt", "two")
        ep.write("/outbound/other/z.txt", "z")
        paths = [
            "/outbound/batch-1/x.txt",
            "/outbound/batch-1/sub/y.txt",
            "/outbound/batch-1/sub",
            "/outbound/batch-1",
            "/outbound/batch-2.txt",
        ]
        return {path: _stamp(ep, path, offset) for offset, path in enumerate(paths)}

    async def test_a_matched_folder_is_one_entry_without_include_subfolders(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        times = self._seed_batches(sftp_endpoint)
        params = sftp_endpoint.params("list", path="/outbound/batch-*")
        out = await sftp_endpoint.run(params, log)
        assert rows(out["entries"]) == [
            _entry("batch-1", "/outbound/batch-1", "folder", times["/outbound/batch-1"]),
            _entry(
                "batch-2.txt", "/outbound/batch-2.txt", "file", times["/outbound/batch-2.txt"], 3
            ),
        ]
        assert log == [_listed(2, "/outbound/batch-*")]

    async def test_a_matched_folder_adds_its_tree_with_include_subfolders(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        times = self._seed_batches(sftp_endpoint)
        params = sftp_endpoint.params("list", path="/outbound/batch-*", recursive=True)
        out = await sftp_endpoint.run(params, log)
        assert rows(out["entries"]) == [
            _entry("batch-1", "/outbound/batch-1", "folder", times["/outbound/batch-1"]),
            _entry("sub", "/outbound/batch-1/sub", "folder", times["/outbound/batch-1/sub"]),
            _entry(
                "y.txt",
                "/outbound/batch-1/sub/y.txt",
                "file",
                times["/outbound/batch-1/sub/y.txt"],
                2,
            ),
            _entry("x.txt", "/outbound/batch-1/x.txt", "file", times["/outbound/batch-1/x.txt"], 1),
            _entry(
                "batch-2.txt", "/outbound/batch-2.txt", "file", times["/outbound/batch-2.txt"], 3
            ),
        ]
        assert out["count"] == 5
        assert log == [_listed(5, "/outbound/batch-*")]


class TestNothingThere:
    """A missing path or a pattern with no match lists nothing and passes (SFTP-3)."""

    @pytest.mark.parametrize("on_error", [None, "fail", "record"])
    @pytest.mark.parametrize(
        "path",
        [
            "/nowhere",
            "missing.txt",
            "/outbound/*.zip",
            "/nowhere/*.csv",
            "/outbound/*/deeper.csv",
        ],
    )
    async def test_no_entries_count_zero_and_success(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, path: str, on_error: str | None
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "a")
        out = await ep.run(ep.params("list", path=path, on_error=on_error), log)
        entries = out.pop("entries")
        assert (columns(entries), rows(entries)) == (ENTRY_COLUMNS, [])
        assert out == {"count": 0, "success": True, "error": "", "reason": ""}
        assert log == [_listed(0, path)]


class TestConsoleLine:
    """The summary line says entry for one and entries otherwise."""

    @pytest.mark.parametrize(
        ("count", "line"),
        [
            (0, "Listed 0 entries in /outbound"),
            (1, "Listed 1 entry in /outbound"),
            (2, "Listed 2 entries in /outbound"),
            (3, "Listed 3 entries in /outbound"),
        ],
    )
    async def test_entry_or_entries(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, count: int, line: str
    ) -> None:
        sftp_endpoint.mkdir("/outbound")
        for index in range(count):
            sftp_endpoint.write(f"/outbound/f{index}.txt", "f")
        await sftp_endpoint.run(sftp_endpoint.params("list", path="/outbound"), log)
        assert log == [("INFO", line)]


class TestRecordedFailure:
    """A run-time failure follows On error; Record returns the List empties."""

    MESSAGE = "Permission denied on the SFTP server: /outbound"

    async def test_fail_the_block_raises(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        folder = sftp_endpoint.write("/outbound/a.txt", "a").parent
        with _locked(folder), pytest.raises(ValueError, match=_exact(self.MESSAGE)):
            await sftp_endpoint.run(sftp_endpoint.params("list", path="/outbound"), log)
        assert log == []

    async def test_record_returns_the_empties(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        folder = sftp_endpoint.write("/outbound/a.txt", "a").parent
        params = sftp_endpoint.params("list", path="/outbound", on_error="record")
        with _locked(folder):
            out = await sftp_endpoint.run(params, log)
        entries = out.pop("entries")
        assert (columns(entries), rows(entries)) == (ENTRY_COLUMNS, [])
        assert out == {"count": 0, **_recorded(self.MESSAGE, "PermissionDenied")}
        assert log == [("WARN", f"List failed (PermissionDenied): {self.MESSAGE}")]
