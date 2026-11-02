"""SFTP Download: server files and folders onto WAVE (REQ-3.4.1.8, SFTP-3..SFTP-7, TDATA-2)."""

import asyncio
import os
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from tests.plugins.sftp.conftest import (
    LogRecorder,
    SFTPEndpoint,
    SFTPServerStarter,
    SlowRead,
    WaveDirs,
    columns,
    rows,
    tree,
)
from wavecore.api.services.storage_paths import get_testdata_storage_path
from wavecore.core.ssh.session_registry import SSHSessionRegistry

SUMMARY_COLUMNS = [("source", "string"), ("destination", "string"), ("size", "integer")]
READ_ONLY = "testdata:// paths are read-only. Cannot write, move, or delete testdata files."

Arrange = Callable[[SFTPEndpoint], tuple[dict[str, Any], str]]


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _seed(ep: SFTPEndpoint, files: dict[str, str]) -> None:
    """Seed server files; a path ending in / is an empty folder."""
    for path, text in files.items():
        if path.endswith("/"):
            ep.mkdir(path)
        else:
            ep.write(path, text)


def _put(folder: Path, files: dict[str, str]) -> Path:
    """Write WAVE files below a folder; a name ending in / is an empty folder."""
    for name, text in files.items():
        target = folder / name
        if name.endswith("/"):
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    return folder


def _downloaded(count: int, size: int, source: str, destination: str) -> tuple[str, str]:
    """The Download summary console line."""
    noun = "file" if count == 1 else "files"
    return ("INFO", f"Downloaded {count} {noun}, {size} bytes, from {source} to {destination}")


def _saved(wave: WaveDirs, relative: str, size: int) -> tuple[str, str]:
    """The console line for one file written into the run's artifacts folder."""
    return ("INFO", f"Saved artifact://{relative} at {wave.artifacts / relative}, {size} bytes")


def _state(folder: Path) -> dict[str, bytes | None]:
    """Each entry below a folder with a file's bytes (None for a folder or a link)."""
    return {
        entry: (
            None
            if entry.endswith("/") or (folder / entry).is_symlink()
            else (folder / entry).read_bytes()
        )
        for entry in tree(folder)
    }


def _snapshot(ep: SFTPEndpoint) -> dict[str, dict[str, bytes | None]]:
    """Everything a refused download must leave as it was: the server and the WAVE folders."""
    return {
        "server": _state(ep.root),
        "home": _state(ep.wave.home),
        "artifacts": _state(ep.wave.artifacts),
        "testdata": _state(ep.wave.testdata),
        "testdata-zone": _state(get_testdata_storage_path()),
    }


async def _download(ep: SFTPEndpoint, log: LogRecorder, **settings: Any) -> dict[str, Any]:
    return await ep.run(ep.params("download", **settings), log)


async def _until_stalled(ep: SFTPEndpoint, task: asyncio.Task[dict[str, Any]]) -> None:
    """Wait for the server to stall a read; a run that ends first surfaces its outcome."""
    stalled = asyncio.ensure_future(ep.state.stalled.wait())
    async with asyncio.timeout(10):
        await asyncio.wait({task, stalled}, return_when=asyncio.FIRST_COMPLETED)
    if not stalled.done():
        stalled.cancel()
        task.result()
        pytest.fail("the download ended before the server stalled a read")


class TestOneFile:
    """One server file lands on WAVE byte for byte (SFTP-4, SFTP-9)."""

    @pytest.mark.parametrize(
        "destination", [None, "", "  ", ...], ids=["none", "empty", "blank", "absent"]
    )
    async def test_an_empty_destination_lands_in_the_run_files_under_its_own_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, destination: Any
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "payload")
        settings = {} if destination is ... else {"destination": destination}
        out = await _download(sftp_endpoint, log, source="/outbound/orders.out", **settings)
        assert (wave.artifacts / "orders.out").read_text() == "payload"
        assert tree(wave.artifacts) == ["orders.out"]
        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert "__block_warning" not in out
        assert columns(out["summary"]) == SUMMARY_COLUMNS
        assert rows(out["summary"]) == [
            ["/outbound/orders.out", str(wave.artifacts / "orders.out"), 7]
        ]
        assert log == [
            ("INFO", f"Saved artifact://orders.out at {wave.artifacts / 'orders.out'}, 7 bytes"),
            (
                "INFO",
                "Downloaded 1 file, 7 bytes, from /outbound/orders.out to the run's files",
            ),
        ]

    async def test_the_bytes_arrive_unchanged(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        payload = bytes(range(256)) * 4
        sftp_endpoint.write("/outbound/blob.bin", payload)
        out = await _download(sftp_endpoint, log, source="/outbound/blob.bin")
        assert (sftp_endpoint.wave.artifacts / "blob.bin").read_bytes() == payload
        assert rows(out["summary"])[0][2] == 1024

    async def test_a_relative_server_source_starts_in_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        sftp_endpoint.write("outbound/orders.out", "home")
        await _download(sftp_endpoint, log, source="outbound/orders.out")
        assert (sftp_endpoint.wave.artifacts / "orders.out").read_text() == "home"

    async def test_the_bare_artifact_scheme_names_the_run_files_folder(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "abc")
        await _download(
            sftp_endpoint, log, source="/outbound/orders.out", destination="artifact://"
        )
        assert tree(wave.artifacts) == ["orders.out"]
        assert log == [
            _saved(wave, "orders.out", 3),
            _downloaded(1, 3, "/outbound/orders.out", "artifact://"),
        ]

    @pytest.mark.parametrize(
        "destination",
        [lambda wave: str(wave.home / "downloads" / "orders.out"), lambda wave: "downloads/"],
        ids=["absolute", "relative"],
    )
    async def test_a_plain_path_outside_the_run_files_logs_no_saved_line(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        destination: Callable[[WaveDirs], str],
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "abc")
        row = destination(wave)
        out = await _download(sftp_endpoint, log, source="/outbound/orders.out", destination=row)
        target = wave.home / "downloads" / "orders.out"
        assert target.read_text() == "abc"
        assert tree(wave.artifacts) == []
        assert rows(out["summary"]) == [["/outbound/orders.out", str(target), 3]]
        assert log == [_downloaded(1, 3, "/outbound/orders.out", row)]

    async def test_a_plain_path_inside_the_run_files_logs_the_saved_line(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "abc")
        row = str(wave.artifacts / "results" / "orders.out")
        await _download(sftp_endpoint, log, source="/outbound/orders.out", destination=row)
        assert log == [
            _saved(wave, "results/orders.out", 3),
            _downloaded(1, 3, "/outbound/orders.out", row),
        ]

    async def test_the_console_names_the_rows_trimmed(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "abc")
        await _download(
            sftp_endpoint,
            log,
            source="  /outbound/orders.out\t",
            destination=" artifact://results/ \n",
        )
        assert (wave.artifacts / "results" / "orders.out").read_text() == "abc"
        assert log == [
            _saved(wave, "results/orders.out", 3),
            (
                "INFO",
                "Downloaded 1 file, 3 bytes, from /outbound/orders.out to artifact://results/",
            ),
        ]


class TestDestinationRule:
    """An existing folder, a trailing / or an empty row keeps the names (SFTP-5)."""

    async def test_an_existing_wave_folder_keeps_the_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "ab")
        (wave.artifacts / "results").mkdir()
        out = await _download(
            sftp_endpoint, log, source="/outbound/orders.out", destination="artifact://results"
        )
        assert tree(wave.artifacts) == ["results/", "results/orders.out"]
        assert rows(out["summary"]) == [
            ["/outbound/orders.out", str(wave.artifacts / "results" / "orders.out"), 2]
        ]

    async def test_a_trailing_slash_keeps_the_name_and_creates_the_folders(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "ab")
        await _download(
            sftp_endpoint, log, source="/outbound/orders.out", destination="artifact://runs/2026/"
        )
        assert tree(wave.artifacts) == ["runs/", "runs/2026/", "runs/2026/orders.out"]

    async def test_a_wave_folder_named_like_the_file_receives_it(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "ab")
        (wave.artifacts / "orders.out").mkdir()
        await _download(
            sftp_endpoint, log, source="/outbound/orders.out", destination="artifact://orders.out"
        )
        assert tree(wave.artifacts) == ["orders.out/", "orders.out/orders.out"]

    async def test_any_other_path_is_the_new_name_with_its_folders_created(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "ab")
        out = await _download(
            sftp_endpoint,
            log,
            source="/outbound/orders.out",
            destination="artifact://checked/orders.csv",
        )
        assert tree(wave.artifacts) == ["checked/", "checked/orders.csv"]
        assert rows(out["summary"]) == [
            ["/outbound/orders.out", str(wave.artifacts / "checked" / "orders.csv"), 2]
        ]
        assert log == [
            _saved(wave, "checked/orders.csv", 2),
            _downloaded(1, 2, "/outbound/orders.out", "artifact://checked/orders.csv"),
        ]

    async def test_a_wildcard_with_one_match_takes_the_new_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(sftp_endpoint, {"/outbound/orders.out": "ab", "/outbound/notes.txt": "n"})
        out = await _download(
            sftp_endpoint, log, source="/outbound/*.out", destination="artifact://result.csv"
        )
        assert tree(wave.artifacts) == ["result.csv"]
        assert rows(out["summary"]) == [
            ["/outbound/orders.out", str(wave.artifacts / "result.csv"), 2]
        ]


class TestFolder:
    """A folder comes whole, empty folders included, and merges on WAVE (SFTP-5, SFTP-7)."""

    async def test_a_folder_comes_whole_with_hidden_names_and_empty_folders(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(
            sftp_endpoint,
            {
                "/outbound/reports/a.csv": "a",
                "/outbound/reports/sub/b.csv": "bb",
                "/outbound/reports/empty/": "",
                "/outbound/reports/.hidden": "hhh",
            },
        )
        out = await _download(sftp_endpoint, log, source="/outbound/reports")
        reports = wave.artifacts / "reports"
        assert tree(wave.artifacts) == [
            "reports/",
            "reports/.hidden",
            "reports/a.csv",
            "reports/empty/",
            "reports/sub/",
            "reports/sub/b.csv",
        ]
        assert (reports / "sub" / "b.csv").read_text() == "bb"
        assert rows(out["summary"]) == [
            ["/outbound/reports/.hidden", str(reports / ".hidden"), 3],
            ["/outbound/reports/a.csv", str(reports / "a.csv"), 1],
            ["/outbound/reports/sub/b.csv", str(reports / "sub" / "b.csv"), 2],
        ]
        assert log == [
            _saved(wave, "reports/.hidden", 3),
            _saved(wave, "reports/a.csv", 1),
            _saved(wave, "reports/sub/b.csv", 2),
            ("INFO", "Downloaded 3 files, 6 bytes, from /outbound/reports to the run's files"),
        ]

    async def test_a_folder_merges_into_the_wave_folder_of_its_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(sftp_endpoint, {"/outbound/reports/a.csv": "new", "/outbound/reports/sub/b.csv": "b"})
        _put(wave.artifacts / "reports", {"a.csv": "old", "keep.txt": "kept", "sub/c.txt": "c"})
        await _download(sftp_endpoint, log, source="/outbound/reports", destination="artifact://")
        assert tree(wave.artifacts / "reports") == [
            "a.csv",
            "keep.txt",
            "sub/",
            "sub/b.csv",
            "sub/c.txt",
        ]
        assert (wave.artifacts / "reports" / "a.csv").read_text() == "new"
        assert (wave.artifacts / "reports" / "keep.txt").read_text() == "kept"

    async def test_a_folder_takes_a_new_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(sftp_endpoint, {"/outbound/reports/a.csv": "a", "/outbound/reports/sub/b.csv": "b"})
        out = await _download(
            sftp_endpoint, log, source="/outbound/reports", destination="artifact://renamed"
        )
        assert tree(wave.artifacts) == [
            "renamed/",
            "renamed/a.csv",
            "renamed/sub/",
            "renamed/sub/b.csv",
        ]
        assert [row[1] for row in rows(out["summary"])] == [
            str(wave.artifacts / "renamed" / "a.csv"),
            str(wave.artifacts / "renamed" / "sub" / "b.csv"),
        ]

    async def test_a_trailing_slash_on_the_source_is_ignored(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/reports/a.csv", "a")
        await _download(sftp_endpoint, log, source="/outbound/reports/")
        assert tree(wave.artifacts) == ["reports/", "reports/a.csv"]
        assert log == [
            _saved(wave, "reports/a.csv", 1),
            _downloaded(1, 1, "/outbound/reports/", "the run's files"),
        ]

    async def test_an_empty_folder_is_recreated_and_counts_no_files(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.mkdir("/outbound/empty")
        out = await _download(sftp_endpoint, log, source="/outbound/empty")
        assert tree(wave.artifacts) == ["empty/"]
        assert rows(out["summary"]) == []
        assert out["success"] is True
        assert log == [
            ("INFO", "Downloaded 0 files, 0 bytes, from /outbound/empty to the run's files")
        ]

    async def test_fail_the_block_merges_when_no_file_collides(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/reports/a.csv", "a")
        _put(wave.artifacts / "reports", {"keep.txt": "kept"})
        out = await _download(sftp_endpoint, log, source="/outbound/reports", if_exists="fail")
        assert out["success"] is True
        assert tree(wave.artifacts / "reports") == ["a.csv", "keep.txt"]


class TestWildcard:
    """*, ? and [...] download every server match in path order (SFTP-3)."""

    async def test_every_match_lands_in_path_order(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(
            sftp_endpoint,
            {
                "/outbound/b.out": "bb",
                "/outbound/a.out": "a",
                "/outbound/c.txt": "c",
                "/outbound/.d.out": "d",
            },
        )
        out = await _download(
            sftp_endpoint, log, source="/outbound/*.out", destination="artifact://results/"
        )
        assert tree(wave.artifacts) == ["results/", "results/a.out", "results/b.out"]
        assert rows(out["summary"]) == [
            ["/outbound/a.out", str(wave.artifacts / "results" / "a.out"), 1],
            ["/outbound/b.out", str(wave.artifacts / "results" / "b.out"), 2],
        ]
        assert log == [
            _saved(wave, "results/a.out", 1),
            _saved(wave, "results/b.out", 2),
            ("INFO", "Downloaded 2 files, 3 bytes, from /outbound/*.out to artifact://results/"),
        ]

    @pytest.mark.parametrize(
        ("pattern", "expected"),
        [
            ("*.out", ["a.out", "ab.out", "b.out", "c.out"]),
            ("?.out", ["a.out", "b.out", "c.out"]),
            ("[ab].out", ["a.out", "b.out"]),
            ("[!a]*.out", ["b.out", "c.out"]),
            (".*.out", [".hidden.out"]),
        ],
    )
    async def test_each_wildcard_form_selects_its_matches(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, pattern: str, expected: list[str]
    ) -> None:
        names = ["a.out", "b.out", "c.out", "ab.out", ".hidden.out", "notes.txt"]
        _seed(sftp_endpoint, {f"/outbound/{name}": name for name in names})
        await _download(sftp_endpoint, log, source=f"/outbound/{pattern}")
        assert tree(sftp_endpoint.wave.artifacts) == expected

    async def test_an_empty_destination_takes_every_match(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/a.out": "a", "/outbound/b.out": "b"})
        out = await _download(sftp_endpoint, log, source="/outbound/*.out", destination="")
        assert tree(sftp_endpoint.wave.artifacts) == ["a.out", "b.out"]
        assert log[-1] == _downloaded(2, 2, "/outbound/*.out", "the run's files")
        assert len(rows(out["summary"])) == 2

    async def test_a_middle_segment_wildcard_reaches_into_matching_folders(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(sftp_endpoint, {"/outbound/jan/result.out": "j", "/outbound/feb/other.txt": "o"})
        out = await _download(sftp_endpoint, log, source="/outbound/*/result.out")
        assert tree(wave.artifacts) == ["result.out"]
        assert rows(out["summary"]) == [
            ["/outbound/jan/result.out", str(wave.artifacts / "result.out"), 1]
        ]

    async def test_wildcards_in_several_segments_combine(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(
            sftp_endpoint,
            {
                "/outbound/2025/a.out": "a",
                "/outbound/2026/b.out": "bb",
                "/outbound/2026/notes.txt": "n",
                "/outbound/other/c.out": "c",
            },
        )
        out = await _download(sftp_endpoint, log, source="/outbound/20*/*.out")
        assert tree(wave.artifacts) == ["a.out", "b.out"]
        assert rows(out["summary"]) == [
            ["/outbound/2025/a.out", str(wave.artifacts / "a.out"), 1],
            ["/outbound/2026/b.out", str(wave.artifacts / "b.out"), 2],
        ]

    async def test_a_matched_folder_comes_whole(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(
            sftp_endpoint,
            {
                "/outbound/reports/a.csv": "a",
                "/outbound/reports/sub/b.csv": "b",
                "/outbound/readme.txt": "r",
            },
        )
        await _download(sftp_endpoint, log, source="/outbound/rep*")
        assert tree(sftp_endpoint.wave.artifacts) == [
            "reports/",
            "reports/a.csv",
            "reports/sub/",
            "reports/sub/b.csv",
        ]

    async def test_a_relative_pattern_starts_in_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"x.out": "x", "y.txt": "y"})
        await _download(sftp_endpoint, log, source="*.out")
        assert tree(sftp_endpoint.wave.artifacts) == ["x.out"]


class TestPartialFile:
    """A file in flight lives under a hidden temporary name beside its target (SFTP-7)."""

    @pytest.mark.parametrize(
        ("destination", "folder", "name"),
        [(None, "", "orders.out"), ("artifact://results/renamed.out", "results", "renamed.out")],
        ids=["own-name", "new-name"],
    )
    async def test_the_file_takes_its_real_name_only_when_complete(
        self,
        sftp_server: SFTPServerStarter,
        log: LogRecorder,
        destination: str | None,
        folder: str,
        name: str,
    ) -> None:
        ep = await sftp_server(SlowRead)
        ep.write("/outbound/orders.out", "payload")
        settings = {} if destination is None else {"destination": destination}
        task = asyncio.create_task(_download(ep, log, source="/outbound/orders.out", **settings))
        await _until_stalled(ep, task)
        landing = ep.wave.artifacts / folder
        in_flight = os.listdir(landing)
        assert len(in_flight) == 1
        assert re.fullmatch(rf"\.{re.escape(name)}\.[0-9a-f]{{8}}\.part", in_flight[0])
        assert not (landing / name).exists()
        ep.state.release.set()
        async with asyncio.timeout(10):
            out = await task
        assert (landing / name).read_text() == "payload"
        assert os.listdir(landing) == [name]
        assert rows(out["summary"]) == [["/outbound/orders.out", str(landing / name), 7]]


class TestIfTheFileExists:
    """Replace it overwrites; Fail the block refuses before anything is written (SFTP-5, SFTP-7)."""

    @pytest.mark.parametrize("if_exists", [None, "overwrite"], ids=["default", "overwrite"])
    @pytest.mark.parametrize(
        "destination", ["", "artifact://orders.out"], ids=["own-name", "new-name"]
    )
    async def test_replace_it_overwrites_the_wave_file(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        if_exists: str | None,
        destination: str,
    ) -> None:
        wave = sftp_endpoint.wave
        sftp_endpoint.write("/outbound/orders.out", "new")
        _put(wave.artifacts, {"orders.out": "old contents"})
        settings = {} if if_exists is None else {"if_exists": if_exists}
        out = await _download(
            sftp_endpoint,
            log,
            source="/outbound/orders.out",
            destination=destination,
            **settings,
        )
        assert (wave.artifacts / "orders.out").read_text() == "new"
        assert tree(wave.artifacts) == ["orders.out"]
        assert rows(out["summary"]) == [
            ["/outbound/orders.out", str(wave.artifacts / "orders.out"), 3]
        ]

    async def test_fail_the_block_downloads_when_nothing_is_there(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        sftp_endpoint.write("/outbound/orders.out", "new")
        out = await _download(sftp_endpoint, log, source="/outbound/orders.out", if_exists="fail")
        assert out["success"] is True
        assert (sftp_endpoint.wave.artifacts / "orders.out").read_text() == "new"

    async def test_fail_the_block_names_the_first_collision_and_writes_nothing(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(
            sftp_endpoint,
            {"/outbound/a.out": "a", "/outbound/b.out": "b", "/outbound/c.out": "c"},
        )
        _put(wave.artifacts, {"c.out": "old c", "b.out": "old b"})
        before = _snapshot(sftp_endpoint)
        target = wave.artifacts / "b.out"
        message = f"Destination exists and If the file exists is Fail the block: {target}"
        with pytest.raises(ValueError, match=_exact(message)):
            await _download(sftp_endpoint, log, source="/outbound/*.out", if_exists="fail")
        assert tree(wave.artifacts) == ["b.out", "c.out"]
        assert target.read_text() == "old b"
        assert _snapshot(sftp_endpoint) == before
        assert log == []


def _no_match(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/a.out", "a")
    return {"source": "/outbound/*.zip"}, "Nothing on the SFTP server matches /outbound/*.zip"


def _no_match_fixed_part_missing(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    return {"source": "/missing/*.out"}, "Nothing on the SFTP server matches /missing/*.out"


def _no_match_middle_segment(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/jan/notes.txt", "n")
    return (
        {"source": "/outbound/*/result.out"},
        "Nothing on the SFTP server matches /outbound/*/result.out",
    )


def _not_found(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    return (
        {"source": "/outbound/missing.out"},
        "Source not found on the SFTP server: /outbound/missing.out",
    )


def _not_found_relative(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    return {"source": "missing.out"}, "Source not found on the SFTP server: missing.out"


def _several_matches_new_name(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep, {"/outbound/a.out": "a", "/outbound/b.out": "b"})
    return (
        {"source": "/outbound/*.out", "destination": "artifact://combined.out"},
        "2 paths match /outbound/*.out, so Destination must be an existing folder or end "
        "with /: artifact://combined.out",
    )


def _several_matches_onto_a_file(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _put(ep.wave.artifacts, {"combined.out": "old"})
    return _several_matches_new_name(ep)


def _folder_onto_a_file(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/reports/a.csv", "a")
    _put(ep.wave.artifacts, {"reports": "a file"})
    return {"source": "/outbound/reports"}, f"Destination is a file: {ep.wave.artifacts}/reports"


def _subfolder_onto_a_file(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep, {"/outbound/reports/a.csv": "a", "/outbound/reports/sub/b.csv": "b"})
    _put(ep.wave.artifacts, {"reports/sub": "a file"})
    return (
        {"source": "/outbound/reports"},
        f"Destination is a file: {ep.wave.artifacts}/reports/sub",
    )


def _folder_renamed_onto_a_file(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/reports/a.csv", "a")
    _put(ep.wave.artifacts, {"report.txt": "a file"})
    return (
        {"source": "/outbound/reports", "destination": "artifact://report.txt"},
        f"Destination is a file: {ep.wave.artifacts}/report.txt",
    )


def _file_in_folder_onto_a_folder(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/reports/a.csv", "a")
    _put(ep.wave.artifacts, {"reports/a.csv/": ""})
    return (
        {"source": "/outbound/reports"},
        f"Destination is a folder: {ep.wave.artifacts}/reports/a.csv",
    )


def _match_onto_a_folder(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep, {"/outbound/a.out": "a", "/outbound/b.out": "b"})
    _put(ep.wave.artifacts, {"b.out/": ""})
    return {"source": "/outbound/*.out"}, f"Destination is a folder: {ep.wave.artifacts}/b.out"


def _file_onto_a_folder_in_the_run_files(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/orders.out", "o")
    _put(ep.wave.artifacts, {"orders.out/": ""})
    return (
        {"source": "/outbound/orders.out", "destination": ""},
        f"Destination is a folder: {ep.wave.artifacts}/orders.out",
    )


def _file_exists(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/orders.out", "new")
    _put(ep.wave.artifacts, {"orders.out": "old"})
    return (
        {"source": "/outbound/orders.out", "if_exists": "fail"},
        "Destination exists and If the file exists is Fail the block: "
        f"{ep.wave.artifacts}/orders.out",
    )


def _collision_inside_a_folder(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(
        ep,
        {
            "/outbound/reports/a.csv": "a",
            "/outbound/reports/empty/": "",
            "/outbound/reports/sub/b.csv": "b",
        },
    )
    _put(ep.wave.artifacts, {"reports/sub/b.csv": "old"})
    return (
        {"source": "/outbound/reports", "if_exists": "fail"},
        "Destination exists and If the file exists is Fail the block: "
        f"{ep.wave.artifacts}/reports/sub/b.csv",
    )


def _testdata_scheme(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/orders.out", "o")
    return {"source": "/outbound/orders.out", "destination": "testdata://incoming/"}, READ_ONLY


def _testdata_folder_path(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/orders.out", "o")
    destination = f"{ep.wave.testdata}/incoming/"
    return {"source": "/outbound/orders.out", "destination": destination}, READ_ONLY


def _testdata_storage_zone(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/orders.out", "o")
    destination = f"{get_testdata_storage_path()}/test-1/"
    return {"source": "/outbound/orders.out", "destination": destination}, READ_ONLY


def _testdata_through_a_link(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/outbound/orders.out", "o")
    (ep.wave.home / "shortcut").symlink_to(ep.wave.testdata)
    return {"source": "/outbound/orders.out", "destination": "shortcut/"}, READ_ONLY


REFUSALS = [
    pytest.param(_no_match, "NoMatch", id="no-match"),
    pytest.param(_no_match_fixed_part_missing, "NoMatch", id="no-match-fixed-part-missing"),
    pytest.param(_no_match_middle_segment, "NoMatch", id="no-match-middle-segment"),
    pytest.param(_not_found, "NotFound", id="not-found"),
    pytest.param(_not_found_relative, "NotFound", id="not-found-relative"),
    pytest.param(_several_matches_new_name, "NotAFolder", id="several-matches-new-name"),
    pytest.param(_several_matches_onto_a_file, "NotAFolder", id="several-matches-onto-a-file"),
    pytest.param(_folder_onto_a_file, "Conflict", id="folder-onto-a-file"),
    pytest.param(_subfolder_onto_a_file, "Conflict", id="subfolder-onto-a-file"),
    pytest.param(_folder_renamed_onto_a_file, "Conflict", id="folder-renamed-onto-a-file"),
    pytest.param(_file_in_folder_onto_a_folder, "Conflict", id="file-in-folder-onto-a-folder"),
    pytest.param(_match_onto_a_folder, "Conflict", id="match-onto-a-folder"),
    pytest.param(
        _file_onto_a_folder_in_the_run_files, "Conflict", id="file-onto-a-folder-in-run-files"
    ),
    pytest.param(_file_exists, "Exists", id="file-exists"),
    pytest.param(_collision_inside_a_folder, "Exists", id="collision-inside-a-folder"),
    pytest.param(_testdata_scheme, "ReadOnly", id="testdata-scheme"),
    pytest.param(_testdata_folder_path, "ReadOnly", id="testdata-folder-path"),
    pytest.param(_testdata_storage_zone, "ReadOnly", id="testdata-storage-zone"),
    pytest.param(_testdata_through_a_link, "ReadOnly", id="testdata-through-a-link"),
]


class TestRefusals:
    """Every run-time refusal follows On error and writes nothing (SFTP-3..SFTP-7, TDATA-2)."""

    @pytest.mark.parametrize(("arrange", "reason"), REFUSALS)
    async def test_fail_the_block_raises_the_message_and_writes_nothing(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, arrange: Arrange, reason: str
    ) -> None:
        settings, message = arrange(sftp_endpoint)
        before = _snapshot(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(message)):
            await _download(sftp_endpoint, log, **settings)
        assert _snapshot(sftp_endpoint) == before
        assert log == []

    @pytest.mark.parametrize(("arrange", "reason"), REFUSALS)
    async def test_record_and_continue_returns_the_message_and_reason(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, arrange: Arrange, reason: str
    ) -> None:
        settings, message = arrange(sftp_endpoint)
        before = _snapshot(sftp_endpoint)
        out = await _download(sftp_endpoint, log, on_error="record", **settings)
        assert (out["success"], out["error"], out["reason"]) == (False, message, reason)
        assert out["__block_warning"] is True
        assert columns(out["summary"]) == SUMMARY_COLUMNS
        assert rows(out["summary"]) == []
        assert log == [("WARN", f"Download failed ({reason}): {message}")]
        assert _snapshot(sftp_endpoint) == before


class TestOrderOfChecks:
    """WAVE side, then the session, then shape, conflicts and collisions (SFTP-7)."""

    async def test_the_wave_destination_is_checked_before_the_session(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        settings, message = _testdata_scheme(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(message)):
            await sftp_endpoint.run(
                sftp_endpoint.params("download", **settings),
                log,
                ssh_session_registry=SSHSessionRegistry(),
            )

    async def test_the_destination_shape_comes_before_a_collision(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        settings, message = _several_matches_onto_a_file(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(message)):
            await _download(sftp_endpoint, log, if_exists="fail", **settings)

    async def test_a_type_conflict_comes_before_an_earlier_collision(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        wave = sftp_endpoint.wave
        _seed(sftp_endpoint, {"/outbound/a.out": "a", "/outbound/b.out": "b"})
        _put(wave.artifacts, {"a.out": "old", "b.out/": ""})
        message = f"Destination is a folder: {wave.artifacts}/b.out"
        with pytest.raises(ValueError, match=_exact(message)):
            await _download(sftp_endpoint, log, source="/outbound/*.out", if_exists="fail")
