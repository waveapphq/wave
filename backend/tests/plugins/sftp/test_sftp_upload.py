"""SFTP Upload: WAVE files and folders onto the server (REQ-3.4.1.8, SFTP-3, SFTP-5, SFTP-7)."""

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from tests.plugins.sftp.conftest import (
    LogRecorder,
    SFTPEndpoint,
    WaveDirs,
    columns,
    rows,
    tree,
)
from wavecore.core.ssh.session_registry import SSHSessionRegistry

SUMMARY_COLUMNS = [("source", "string"), ("destination", "string"), ("size", "integer")]

Arrange = Callable[[SFTPEndpoint], tuple[dict[str, Any], str]]


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _seed(folder: Path, files: dict[str, str]) -> Path:
    """Write files below a WAVE folder; a name ending in / is an empty folder."""
    for name, text in files.items():
        target = folder / name
        if name.endswith("/"):
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    return folder


def _uploaded(count: int, size: int, source: str, destination: str) -> tuple[str, str]:
    """The Upload summary console line."""
    noun = "file" if count == 1 else "files"
    return ("INFO", f"Uploaded {count} {noun}, {size} bytes, from {source} to {destination}")


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
    """Everything a refused upload must leave as it was: the server and the WAVE folders."""
    return {
        "server": _state(ep.root),
        "home": _state(ep.wave.home),
        "artifacts": _state(ep.wave.artifacts),
        "testdata": _state(ep.wave.testdata),
    }


async def _upload(ep: SFTPEndpoint, log: LogRecorder, **settings: Any) -> dict[str, Any]:
    return await ep.run(ep.params("upload", **settings), log)


SOURCE_FORMS = [
    pytest.param(lambda wave: ("testdata://orders.csv", wave.testdata), id="testdata"),
    pytest.param(lambda wave: ("artifact://orders.csv", wave.artifacts), id="artifact"),
    pytest.param(
        lambda wave: (str(wave.home / "exports" / "orders.csv"), wave.home / "exports"),
        id="absolute",
    ),
    pytest.param(lambda wave: ("exports/orders.csv", wave.home / "exports"), id="relative"),
]

WILDCARD_FORMS = [
    pytest.param(lambda wave: ("artifact://*.log", wave.artifacts), id="artifact"),
    pytest.param(lambda wave: (f"{wave.home}/exports/*.log", wave.home / "exports"), id="absolute"),
    pytest.param(lambda wave: ("exports/*.log", wave.home / "exports"), id="relative"),
]


class TestOneFile:
    """One WAVE file lands on the server byte for byte (SFTP-4, SFTP-9)."""

    async def test_a_testdata_file_lands_at_the_named_path(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "a,b\n"})
        out = await _upload(
            sftp_endpoint, log, source="testdata://orders.csv", destination="/inbound/orders.csv"
        )
        assert sftp_endpoint.disk("/inbound/orders.csv").read_text() == "a,b\n"
        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert "__block_warning" not in out
        assert columns(out["summary"]) == SUMMARY_COLUMNS
        assert rows(out["summary"]) == [
            [str(sftp_endpoint.wave.testdata / "orders.csv"), "/inbound/orders.csv", 4]
        ]
        assert log == [
            ("INFO", "Uploaded 1 file, 4 bytes, from testdata://orders.csv to /inbound/orders.csv")
        ]

    @pytest.mark.parametrize("form", SOURCE_FORMS)
    async def test_every_wave_reference_form_is_a_source(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        form: Callable[[WaveDirs], tuple[str, Path]],
    ) -> None:
        source, folder = form(sftp_endpoint.wave)
        _seed(folder, {"orders.csv": "x,y\n"})
        out = await _upload(sftp_endpoint, log, source=source, destination="/inbound/orders.csv")
        assert sftp_endpoint.disk("/inbound/orders.csv").read_text() == "x,y\n"
        assert rows(out["summary"]) == [[str(folder / "orders.csv"), "/inbound/orders.csv", 4]]
        assert log == [_uploaded(1, 4, source, "/inbound/orders.csv")]

    async def test_the_bytes_arrive_unchanged(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        payload = bytes(range(256)) * 4
        (sftp_endpoint.wave.testdata / "blob.bin").write_bytes(payload)
        out = await _upload(
            sftp_endpoint, log, source="testdata://blob.bin", destination="/inbound/blob.bin"
        )
        assert sftp_endpoint.disk("/inbound/blob.bin").read_bytes() == payload
        assert rows(out["summary"])[0][2] == 1024

    async def test_a_relative_server_destination_starts_in_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "a"})
        await _upload(
            sftp_endpoint, log, source="testdata://orders.csv", destination="inbound/orders.csv"
        )
        assert (sftp_endpoint.home / "inbound" / "orders.csv").read_text() == "a"
        assert sftp_endpoint.tree("/") == [
            "home/",
            "home/wave/",
            "home/wave/inbound/",
            "home/wave/inbound/orders.csv",
        ]

    async def test_the_console_names_the_rows_trimmed(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "abc"})
        await _upload(
            sftp_endpoint,
            log,
            source="  testdata://orders.csv ",
            destination="\t/inbound/orders.csv \n",
        )
        assert sftp_endpoint.disk("/inbound/orders.csv").read_text() == "abc"
        assert log == [
            ("INFO", "Uploaded 1 file, 3 bytes, from testdata://orders.csv to /inbound/orders.csv")
        ]


class TestDestinationRule:
    """An existing folder or a trailing / keeps the names; another path renames (SFTP-5)."""

    async def test_an_existing_server_folder_keeps_the_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "ab"})
        sftp_endpoint.mkdir("/inbound")
        out = await _upload(
            sftp_endpoint, log, source="testdata://orders.csv", destination="/inbound"
        )
        assert sftp_endpoint.tree("/inbound") == ["orders.csv"]
        assert rows(out["summary"]) == [
            [str(sftp_endpoint.wave.testdata / "orders.csv"), "/inbound/orders.csv", 2]
        ]
        assert log == [_uploaded(1, 2, "testdata://orders.csv", "/inbound")]

    async def test_a_trailing_slash_keeps_the_name_and_creates_the_folder(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "ab"})
        out = await _upload(
            sftp_endpoint, log, source="testdata://orders.csv", destination="/inbound/new/"
        )
        assert sftp_endpoint.tree("/inbound") == ["new/", "new/orders.csv"]
        assert rows(out["summary"])[0][1] == "/inbound/new/orders.csv"

    async def test_a_server_folder_named_like_the_file_receives_it(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "ab"})
        sftp_endpoint.mkdir("/inbound/orders.csv")
        out = await _upload(
            sftp_endpoint, log, source="testdata://orders.csv", destination="/inbound/orders.csv"
        )
        assert sftp_endpoint.tree("/inbound") == ["orders.csv/", "orders.csv/orders.csv"]
        assert rows(out["summary"])[0][1] == "/inbound/orders.csv/orders.csv"

    async def test_any_other_path_is_the_new_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "ab"})
        out = await _upload(
            sftp_endpoint, log, source="testdata://orders.csv", destination="/inbound/orders.tmp"
        )
        assert sftp_endpoint.tree("/inbound") == ["orders.tmp"]
        assert sftp_endpoint.disk("/inbound/orders.tmp").read_text() == "ab"
        assert rows(out["summary"])[0][1] == "/inbound/orders.tmp"

    async def test_a_wildcard_with_one_match_takes_the_new_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "ab", "notes.txt": "n"})
        out = await _upload(
            sftp_endpoint, log, source="testdata://*.csv", destination="/inbound/orders.tmp"
        )
        assert sftp_endpoint.tree("/inbound") == ["orders.tmp"]
        assert rows(out["summary"]) == [
            [str(sftp_endpoint.wave.testdata / "orders.csv"), "/inbound/orders.tmp", 2]
        ]
        assert log == [_uploaded(1, 2, "testdata://*.csv", "/inbound/orders.tmp")]

    async def test_missing_server_folders_are_created(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "ab"})
        await _upload(
            sftp_endpoint,
            log,
            source="testdata://orders.csv",
            destination="/drop/2026/09/orders.csv",
        )
        assert sftp_endpoint.tree("/drop") == ["2026/", "2026/09/", "2026/09/orders.csv"]


class TestFolder:
    """A folder goes with everything inside it and merges into a server folder (SFTP-5)."""

    async def test_a_folder_goes_whole_with_hidden_names_and_empty_folders(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        reports = _seed(
            sftp_endpoint.wave.testdata / "reports",
            {
                "a.csv": "a",
                "sub/b.csv": "bb",
                "empty/": "",
                ".hidden": "hhh",
                ".config/settings.ini": "ssss",
            },
        )
        out = await _upload(
            sftp_endpoint, log, source="testdata://reports", destination="/inbound/"
        )
        assert sftp_endpoint.tree("/inbound") == [
            "reports/",
            "reports/.config/",
            "reports/.config/settings.ini",
            "reports/.hidden",
            "reports/a.csv",
            "reports/empty/",
            "reports/sub/",
            "reports/sub/b.csv",
        ]
        assert sftp_endpoint.disk("/inbound/reports/sub/b.csv").read_text() == "bb"
        assert rows(out["summary"]) == [
            [str(reports / ".config" / "settings.ini"), "/inbound/reports/.config/settings.ini", 4],
            [str(reports / ".hidden"), "/inbound/reports/.hidden", 3],
            [str(reports / "a.csv"), "/inbound/reports/a.csv", 1],
            [str(reports / "sub" / "b.csv"), "/inbound/reports/sub/b.csv", 2],
        ]
        assert log == [("INFO", "Uploaded 4 files, 10 bytes, from testdata://reports to /inbound/")]

    async def test_a_folder_merges_into_the_server_folder_of_its_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata / "reports", {"a.csv": "new", "sub/b.csv": "bb"})
        sftp_endpoint.write("/inbound/reports/a.csv", "old")
        sftp_endpoint.write("/inbound/reports/keep.txt", "kept")
        sftp_endpoint.write("/inbound/reports/sub/other.txt", "o")
        out = await _upload(sftp_endpoint, log, source="testdata://reports", destination="/inbound")
        assert sftp_endpoint.tree("/inbound/reports") == [
            "a.csv",
            "keep.txt",
            "sub/",
            "sub/b.csv",
            "sub/other.txt",
        ]
        assert sftp_endpoint.disk("/inbound/reports/a.csv").read_text() == "new"
        assert sftp_endpoint.disk("/inbound/reports/keep.txt").read_text() == "kept"
        assert [row[1] for row in rows(out["summary"])] == [
            "/inbound/reports/a.csv",
            "/inbound/reports/sub/b.csv",
        ]

    async def test_a_folder_takes_a_new_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata / "reports", {"a.csv": "a", "sub/b.csv": "bb"})
        out = await _upload(
            sftp_endpoint, log, source="testdata://reports", destination="/inbound/renamed"
        )
        assert sftp_endpoint.tree("/inbound") == [
            "renamed/",
            "renamed/a.csv",
            "renamed/sub/",
            "renamed/sub/b.csv",
        ]
        assert [row[1] for row in rows(out["summary"])] == [
            "/inbound/renamed/a.csv",
            "/inbound/renamed/sub/b.csv",
        ]

    async def test_a_trailing_slash_on_the_source_is_ignored(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata / "reports", {"a.csv": "a"})
        await _upload(sftp_endpoint, log, source="testdata://reports/", destination="/inbound/")
        assert sftp_endpoint.tree("/inbound") == ["reports/", "reports/a.csv"]
        assert log == [_uploaded(1, 1, "testdata://reports/", "/inbound/")]

    async def test_missing_server_folders_above_a_folder_are_created(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata / "reports", {"a.csv": "a"})
        await _upload(sftp_endpoint, log, source="testdata://reports", destination="/drop/2026/")
        assert sftp_endpoint.tree("/drop") == ["2026/", "2026/reports/", "2026/reports/a.csv"]

    async def test_an_empty_folder_is_created_and_counts_no_files(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"empty/": ""})
        out = await _upload(sftp_endpoint, log, source="testdata://empty", destination="/inbound/")
        assert sftp_endpoint.tree("/inbound") == ["empty/"]
        assert rows(out["summary"]) == []
        assert out["success"] is True
        assert log == [("INFO", "Uploaded 0 files, 0 bytes, from testdata://empty to /inbound/")]

    async def test_fail_the_block_merges_when_no_file_collides(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata / "reports", {"a.csv": "a"})
        sftp_endpoint.write("/inbound/reports/keep.txt", "kept")
        out = await _upload(
            sftp_endpoint,
            log,
            source="testdata://reports",
            destination="/inbound/",
            if_exists="fail",
        )
        assert out["success"] is True
        assert sftp_endpoint.tree("/inbound/reports") == ["a.csv", "keep.txt"]

    @pytest.mark.parametrize("points_at", ["a.csv", "sub"], ids=["to-a-file", "to-a-folder"])
    async def test_a_symbolic_link_in_the_folder_is_skipped(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, points_at: str
    ) -> None:
        reports = _seed(sftp_endpoint.wave.testdata / "reports", {"a.csv": "a", "sub/b.csv": "bb"})
        link = reports / "linked"
        link.symlink_to(points_at)
        out = await _upload(
            sftp_endpoint, log, source="testdata://reports", destination="/inbound/"
        )
        assert sftp_endpoint.tree("/inbound") == [
            "reports/",
            "reports/a.csv",
            "reports/sub/",
            "reports/sub/b.csv",
        ]
        assert len(rows(out["summary"])) == 2
        assert log == [
            ("INFO", f"Skipped symbolic link {link}"),
            _uploaded(2, 3, "testdata://reports", "/inbound/"),
        ]


class TestWildcard:
    """*, ? and [...] upload every WAVE match in path order (SFTP-3)."""

    async def test_every_match_lands_in_the_folder_in_path_order(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        testdata = _seed(
            sftp_endpoint.wave.testdata,
            {"b.csv": "bb", "a.csv": "a", "notes.txt": "n", ".hidden.csv": "h"},
        )
        out = await _upload(sftp_endpoint, log, source="testdata://*.csv", destination="/inbound/")
        assert sftp_endpoint.tree("/inbound") == ["a.csv", "b.csv"]
        assert rows(out["summary"]) == [
            [str(testdata / "a.csv"), "/inbound/a.csv", 1],
            [str(testdata / "b.csv"), "/inbound/b.csv", 2],
        ]
        assert log == [("INFO", "Uploaded 2 files, 3 bytes, from testdata://*.csv to /inbound/")]

    @pytest.mark.parametrize(
        ("pattern", "expected"),
        [
            ("*.csv", ["a.csv", "ab.csv", "b.csv", "c.csv"]),
            ("?.csv", ["a.csv", "b.csv", "c.csv"]),
            ("[ab].csv", ["a.csv", "b.csv"]),
            ("[!a]*.csv", ["b.csv", "c.csv"]),
            (".*.csv", [".hidden.csv"]),
        ],
    )
    async def test_each_wildcard_form_selects_its_matches(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, pattern: str, expected: list[str]
    ) -> None:
        _seed(
            sftp_endpoint.wave.testdata,
            {
                "a.csv": "a",
                "b.csv": "b",
                "c.csv": "c",
                "ab.csv": "ab",
                ".hidden.csv": "h",
                "notes.txt": "n",
            },
        )
        await _upload(sftp_endpoint, log, source=f"testdata://{pattern}", destination="/inbound/")
        assert sftp_endpoint.tree("/inbound") == expected

    async def test_a_middle_segment_wildcard_reaches_into_matching_folders(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        testdata = _seed(sftp_endpoint.wave.testdata, {"jan/orders.csv": "j", "feb/notes.txt": "n"})
        out = await _upload(
            sftp_endpoint, log, source="testdata://*/orders.csv", destination="/inbound/"
        )
        assert sftp_endpoint.tree("/inbound") == ["orders.csv"]
        assert rows(out["summary"]) == [
            [str(testdata / "jan" / "orders.csv"), "/inbound/orders.csv", 1]
        ]

    async def test_wildcards_in_several_segments_combine(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        testdata = _seed(
            sftp_endpoint.wave.testdata,
            {"2025/a.csv": "a", "2026/b.csv": "bb", "2026/notes.txt": "n", "other/c.csv": "c"},
        )
        out = await _upload(
            sftp_endpoint, log, source="testdata://20*/*.csv", destination="/inbound/"
        )
        assert sftp_endpoint.tree("/inbound") == ["a.csv", "b.csv"]
        assert rows(out["summary"]) == [
            [str(testdata / "2025" / "a.csv"), "/inbound/a.csv", 1],
            [str(testdata / "2026" / "b.csv"), "/inbound/b.csv", 2],
        ]
        assert log == [_uploaded(2, 3, "testdata://20*/*.csv", "/inbound/")]

    async def test_a_matched_folder_goes_whole(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(
            sftp_endpoint.wave.testdata,
            {"reports/a.csv": "a", "reports/sub/b.csv": "bb", "readme.txt": "r"},
        )
        await _upload(sftp_endpoint, log, source="testdata://rep*", destination="/inbound/")
        assert sftp_endpoint.tree("/inbound") == [
            "reports/",
            "reports/a.csv",
            "reports/sub/",
            "reports/sub/b.csv",
        ]

    @pytest.mark.parametrize("form", WILDCARD_FORMS)
    async def test_every_wave_reference_form_takes_a_wildcard(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        form: Callable[[WaveDirs], tuple[str, Path]],
    ) -> None:
        source, folder = form(sftp_endpoint.wave)
        _seed(folder, {"run.log": "log", "other.txt": "o"})
        out = await _upload(sftp_endpoint, log, source=source, destination="/inbound/")
        assert sftp_endpoint.tree("/inbound") == ["run.log"]
        assert rows(out["summary"]) == [[str(folder / "run.log"), "/inbound/run.log", 3]]


class TestIfTheFileExists:
    """Replace it overwrites; Fail the block refuses before anything is written (SFTP-5, SFTP-7)."""

    @pytest.mark.parametrize("if_exists", [None, "overwrite"], ids=["default", "overwrite"])
    async def test_replace_it_overwrites_the_server_file(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, if_exists: str | None
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "new"})
        sftp_endpoint.write("/inbound/orders.csv", "old contents")
        settings = {} if if_exists is None else {"if_exists": if_exists}
        out = await _upload(
            sftp_endpoint, log, source="testdata://orders.csv", destination="/inbound/", **settings
        )
        assert sftp_endpoint.disk("/inbound/orders.csv").read_text() == "new"
        assert rows(out["summary"])[0][1:] == ["/inbound/orders.csv", 3]

    async def test_fail_the_block_uploads_when_nothing_is_there(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "new"})
        out = await _upload(
            sftp_endpoint,
            log,
            source="testdata://orders.csv",
            destination="/inbound/",
            if_exists="fail",
        )
        assert out["success"] is True
        assert sftp_endpoint.disk("/inbound/orders.csv").read_text() == "new"

    async def test_fail_the_block_names_the_first_collision_and_writes_nothing(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"a.csv": "a", "b.csv": "b", "c.csv": "c"})
        sftp_endpoint.write("/inbound/c.csv", "old c")
        sftp_endpoint.write("/inbound/b.csv", "old b")
        before = _snapshot(sftp_endpoint)
        message = "Destination exists and If the file exists is Fail the block: /inbound/b.csv"
        with pytest.raises(ValueError, match=_exact(message)):
            await _upload(
                sftp_endpoint,
                log,
                source="testdata://*.csv",
                destination="/inbound/",
                if_exists="fail",
            )
        assert sftp_endpoint.tree("/inbound") == ["b.csv", "c.csv"]
        assert sftp_endpoint.disk("/inbound/b.csv").read_text() == "old b"
        assert _snapshot(sftp_endpoint) == before
        assert log == []


def _no_match(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata, {"orders.csv": "a"})
    return (
        {"source": "testdata://*.xml", "destination": "/inbound/"},
        "Nothing on WAVE matches testdata://*.xml",
    )


def _no_match_fixed_part_missing(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata, {"orders.csv": "a"})
    return (
        {"source": "testdata://missing/*.csv", "destination": "/inbound/"},
        "Nothing on WAVE matches testdata://missing/*.csv",
    )


def _no_match_middle_segment(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata, {"jan/notes.txt": "n"})
    return (
        {"source": "testdata://*/orders.csv", "destination": "/inbound/"},
        "Nothing on WAVE matches testdata://*/orders.csv",
    )


def _no_match_artifact(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    return (
        {"source": "artifact://*.log", "destination": "/inbound/"},
        "Nothing on WAVE matches artifact://*.log",
    )


def _no_match_plain_path(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    pattern = f"{ep.wave.home}/exports/*.csv"
    return {"source": pattern, "destination": "/inbound/"}, f"Nothing on WAVE matches {pattern}"


def _not_found_absolute(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    missing = str(ep.wave.home / "missing.csv")
    return {"source": missing, "destination": "/inbound/"}, f"Source not found on WAVE: {missing}"


def _not_found_relative(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    return (
        {"source": "missing.csv", "destination": "/inbound/"},
        "Source not found on WAVE: missing.csv",
    )


def _not_found_artifact(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    return (
        {"source": "artifact://missing.csv", "destination": "/inbound/"},
        "Source not found on WAVE: artifact://missing.csv",
    )


def _not_found_testdata(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    searched = ep.wave.testdata / "missing.csv"
    return (
        {"source": "testdata://missing.csv", "destination": "/inbound/"},
        f"testdata file not found: testdata://missing.csv\nSearched paths: {searched}",
    )


def _several_matches_new_name(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata, {"a.csv": "a", "b.csv": "b"})
    return (
        {"source": "testdata://*.csv", "destination": "/inbound/combined.csv"},
        "2 paths match testdata://*.csv, so Destination must be an existing folder or end "
        "with /: /inbound/combined.csv",
    )


def _several_matches_onto_a_file(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    ep.write("/inbound/combined.csv", "old")
    return _several_matches_new_name(ep)


def _folder_onto_a_file(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata / "reports", {"a.csv": "a"})
    ep.write("/inbound/reports", "a file")
    return (
        {"source": "testdata://reports", "destination": "/inbound/"},
        "Destination is a file: /inbound/reports",
    )


def _subfolder_onto_a_file(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata / "reports", {"a.csv": "a", "sub/b.csv": "b"})
    ep.write("/inbound/reports/sub", "a file")
    return (
        {"source": "testdata://reports", "destination": "/inbound/"},
        "Destination is a file: /inbound/reports/sub",
    )


def _folder_renamed_onto_a_file(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata / "reports", {"a.csv": "a"})
    ep.write("/inbound/report.txt", "a file")
    return (
        {"source": "testdata://reports", "destination": "/inbound/report.txt"},
        "Destination is a file: /inbound/report.txt",
    )


def _file_in_folder_onto_a_folder(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata / "reports", {"a.csv": "a"})
    ep.mkdir("/inbound/reports/a.csv")
    return (
        {"source": "testdata://reports", "destination": "/inbound/"},
        "Destination is a folder: /inbound/reports/a.csv",
    )


def _match_onto_a_folder(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata, {"a.csv": "a", "b.csv": "b"})
    ep.mkdir("/inbound/b.csv")
    return (
        {"source": "testdata://*.csv", "destination": "/inbound/"},
        "Destination is a folder: /inbound/b.csv",
    )


def _file_exists(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata, {"orders.csv": "new"})
    ep.write("/inbound/orders.csv", "old")
    return (
        {"source": "testdata://orders.csv", "destination": "/inbound/", "if_exists": "fail"},
        "Destination exists and If the file exists is Fail the block: /inbound/orders.csv",
    )


def _collision_inside_a_folder(ep: SFTPEndpoint) -> tuple[dict[str, Any], str]:
    _seed(ep.wave.testdata / "reports", {"a.csv": "a", "empty/": "", "sub/b.csv": "b"})
    ep.write("/inbound/reports/sub/b.csv", "old")
    return (
        {"source": "testdata://reports", "destination": "/inbound/", "if_exists": "fail"},
        "Destination exists and If the file exists is Fail the block: /inbound/reports/sub/b.csv",
    )


REFUSALS = [
    pytest.param(_no_match, "NoMatch", id="no-match"),
    pytest.param(_no_match_fixed_part_missing, "NoMatch", id="no-match-fixed-part-missing"),
    pytest.param(_no_match_middle_segment, "NoMatch", id="no-match-middle-segment"),
    pytest.param(_no_match_artifact, "NoMatch", id="no-match-artifact"),
    pytest.param(_no_match_plain_path, "NoMatch", id="no-match-plain-path"),
    pytest.param(_not_found_absolute, "NotFound", id="not-found-absolute"),
    pytest.param(_not_found_relative, "NotFound", id="not-found-relative"),
    pytest.param(_not_found_artifact, "NotFound", id="not-found-artifact"),
    pytest.param(_not_found_testdata, "NotFound", id="not-found-testdata"),
    pytest.param(_several_matches_new_name, "NotAFolder", id="several-matches-new-name"),
    pytest.param(_several_matches_onto_a_file, "NotAFolder", id="several-matches-onto-a-file"),
    pytest.param(_folder_onto_a_file, "Conflict", id="folder-onto-a-file"),
    pytest.param(_subfolder_onto_a_file, "Conflict", id="subfolder-onto-a-file"),
    pytest.param(_folder_renamed_onto_a_file, "Conflict", id="folder-renamed-onto-a-file"),
    pytest.param(_file_in_folder_onto_a_folder, "Conflict", id="file-in-folder-onto-a-folder"),
    pytest.param(_match_onto_a_folder, "Conflict", id="match-onto-a-folder"),
    pytest.param(_file_exists, "Exists", id="file-exists"),
    pytest.param(_collision_inside_a_folder, "Exists", id="collision-inside-a-folder"),
]


class TestRefusals:
    """Every run-time refusal follows On error and writes nothing (SFTP-3, SFTP-5, SFTP-7)."""

    @pytest.mark.parametrize(("arrange", "reason"), REFUSALS)
    async def test_fail_the_block_raises_the_message_and_writes_nothing(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, arrange: Arrange, reason: str
    ) -> None:
        settings, message = arrange(sftp_endpoint)
        before = _snapshot(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(message)):
            await _upload(sftp_endpoint, log, **settings)
        assert _snapshot(sftp_endpoint) == before
        assert log == []

    @pytest.mark.parametrize(("arrange", "reason"), REFUSALS)
    async def test_record_and_continue_returns_the_message_and_reason(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, arrange: Arrange, reason: str
    ) -> None:
        settings, message = arrange(sftp_endpoint)
        before = _snapshot(sftp_endpoint)
        out = await _upload(sftp_endpoint, log, on_error="record", **settings)
        assert (out["success"], out["error"], out["reason"]) == (False, message, reason)
        assert out["__block_warning"] is True
        assert columns(out["summary"]) == SUMMARY_COLUMNS
        assert rows(out["summary"]) == []
        assert log == [("WARN", f"Upload failed ({reason}): {message}")]
        assert _snapshot(sftp_endpoint) == before

    async def test_on_error_fail_is_the_same_as_the_default(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        settings, message = _no_match(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(message)):
            await _upload(sftp_endpoint, log, on_error="fail", **settings)
        assert log == []


class TestOrderOfChecks:
    """WAVE side, then the session, then shape, conflicts and collisions (SFTP-7)."""

    @pytest.mark.parametrize(
        "arrange",
        [_no_match, _not_found_absolute, _not_found_testdata],
        ids=["no-match", "not-found", "testdata-not-found"],
    )
    async def test_the_wave_side_is_checked_before_the_session(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, arrange: Arrange
    ) -> None:
        settings, message = arrange(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(message)):
            await sftp_endpoint.run(
                sftp_endpoint.params("upload", **settings),
                log,
                ssh_session_registry=SSHSessionRegistry(),
            )

    async def test_the_destination_shape_comes_before_a_collision(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        settings, message = _several_matches_onto_a_file(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(message)):
            await _upload(sftp_endpoint, log, if_exists="fail", **settings)

    async def test_a_type_conflict_comes_before_an_earlier_collision(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"a.csv": "a", "b.csv": "b"})
        sftp_endpoint.write("/inbound/a.csv", "old")
        sftp_endpoint.mkdir("/inbound/b.csv")
        with pytest.raises(ValueError, match=_exact("Destination is a folder: /inbound/b.csv")):
            await _upload(
                sftp_endpoint,
                log,
                source="testdata://*.csv",
                destination="/inbound/",
                if_exists="fail",
            )

    @pytest.mark.parametrize(
        ("folder_file", "file_folder", "message"),
        [
            ("b", "c.csv", "Destination is a file: /inbound/reports/b"),
            ("c", "b.csv", "Destination is a folder: /inbound/reports/b.csv"),
        ],
        ids=["folder-first", "file-first"],
    )
    async def test_the_first_conflict_in_plan_order_is_reported(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        folder_file: str,
        file_folder: str,
        message: str,
    ) -> None:
        _seed(
            sftp_endpoint.wave.testdata / "reports",
            {f"{folder_file}/x.csv": "x", file_folder: "f"},
        )
        sftp_endpoint.write(f"/inbound/reports/{folder_file}", "a file")
        sftp_endpoint.mkdir(f"/inbound/reports/{file_folder}")
        with pytest.raises(ValueError, match=_exact(message)):
            await _upload(sftp_endpoint, log, source="testdata://reports", destination="/inbound/")
