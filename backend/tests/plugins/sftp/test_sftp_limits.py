"""SFTP Download limits: Max files, then Max size (MiB), before anything is written (SFTP-6)."""

import importlib
import os
import re
from pathlib import Path
from typing import Any

import pytest

from tests.plugins.sftp.conftest import UNSAFE_NAME, LogRecorder, SFTPEndpoint, rows, tree

MIB = 1_048_576


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _too_many(source: str, count: int, max_files: int) -> str:
    return (
        f"Download of {source} holds {count} files, more than the {max_files} Max files allows; "
        "download fewer files or raise Max files"
    )


def _too_large(source: str, total: int, max_size_mib: int) -> str:
    return (
        f"Download of {source} is {total} bytes, larger than the {max_size_mib} MiB Max size "
        "(MiB) allows; download a narrower path or raise Max size (MiB)"
    )


def _seed(ep: SFTPEndpoint, sizes: dict[str, int]) -> None:
    """Seed server files of the given sizes; a path ending in / is an empty folder."""
    for path, size in sizes.items():
        if path.endswith("/"):
            ep.mkdir(path)
        else:
            ep.write(path, b"x" * size)


def _state(folder: Path) -> dict[str, bytes | None]:
    """Each entry below a folder with a file's bytes (None for a folder)."""
    return {
        entry: None if entry.endswith("/") else (folder / entry).read_bytes()
        for entry in tree(folder)
    }


def _snapshot(ep: SFTPEndpoint) -> dict[str, dict[str, bytes | None]]:
    """The server and the WAVE folders a refused download must leave as they were."""
    return {
        "server": _state(ep.root),
        "home": _state(ep.wave.home),
        "artifacts": _state(ep.wave.artifacts),
    }


async def _download(ep: SFTPEndpoint, log: LogRecorder, **settings: Any) -> dict[str, Any]:
    return await ep.run(ep.params("download", **settings), log)


class TestMaxFiles:
    """Max files bounds the files the walked match holds; 0 means no limit (SFTP-6)."""

    async def test_more_files_than_max_files_is_refused_before_anything_is_written(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/data/a.bin": 1, "/outbound/data/b.bin": 1})
        _seed(sftp_endpoint, {"/outbound/data/sub/c.bin": 1})
        before = _snapshot(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(_too_many("/outbound/data", 3, 2))):
            await _download(sftp_endpoint, log, source="/outbound/data", max_files=2)
        assert _snapshot(sftp_endpoint) == before
        assert log == []

    async def test_a_match_at_max_files_passes(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/data/a.bin": 1, "/outbound/data/b.bin": 2})
        out = await _download(sftp_endpoint, log, source="/outbound/data", max_files=2)
        assert out["success"] is True
        assert tree(sftp_endpoint.wave.artifacts) == ["data/", "data/a.bin", "data/b.bin"]

    async def test_zero_max_files_means_no_limit(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/data/a.bin": 1, "/outbound/data/b.bin": 1})
        out = await _download(sftp_endpoint, log, source="/outbound/data", max_files=0)
        assert out["success"] is True
        assert len(rows(out["summary"])) == 2

    async def test_folders_do_not_count_toward_max_files(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(
            sftp_endpoint,
            {
                "/outbound/data/a.bin": 1,
                "/outbound/data/sub/b.bin": 1,
                "/outbound/data/empty/": 0,
                "/outbound/data/sub/deeper/": 0,
            },
        )
        out = await _download(sftp_endpoint, log, source="/outbound/data", max_files=2)
        assert out["success"] is True
        assert tree(sftp_endpoint.wave.artifacts) == [
            "data/",
            "data/a.bin",
            "data/empty/",
            "data/sub/",
            "data/sub/b.bin",
            "data/sub/deeper/",
        ]

    async def test_a_wildcard_counts_every_file_inside_its_matches(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(
            sftp_endpoint,
            {"/outbound/d1/a.bin": 1, "/outbound/d1/b.bin": 1, "/outbound/d2/c.bin": 1},
        )
        with pytest.raises(ValueError, match=_exact(_too_many("/outbound/d*", 3, 2))):
            await _download(sftp_endpoint, log, source="/outbound/d*", max_files=2)
        assert tree(sftp_endpoint.wave.artifacts) == []


class TestMaxSize:
    """Max size (MiB) bounds the walked match's total bytes; 0 means no limit (SFTP-6)."""

    async def test_a_file_over_max_size_is_refused_before_anything_is_written(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/big.bin": MIB + 1})
        before = _snapshot(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(_too_large("/outbound/big.bin", MIB + 1, 1))):
            await _download(sftp_endpoint, log, source="/outbound/big.bin", max_size_mib=1)
        assert _snapshot(sftp_endpoint) == before
        assert log == []

    async def test_the_total_of_every_file_in_the_match_counts(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/data/a.bin": 600_000, "/outbound/data/sub/b.bin": 448_577})
        before = _snapshot(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(_too_large("/outbound/data", MIB + 1, 1))):
            await _download(sftp_endpoint, log, source="/outbound/data", max_size_mib=1)
        assert _snapshot(sftp_endpoint) == before

    async def test_a_match_at_max_size_passes(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/a.bin": MIB // 2, "/outbound/b.bin": MIB // 2})
        out = await _download(sftp_endpoint, log, source="/outbound/*.bin", max_size_mib=1)
        assert out["success"] is True
        assert [row[2] for row in rows(out["summary"])] == [MIB // 2, MIB // 2]

    async def test_zero_max_size_means_no_limit(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/big.bin": MIB + 1})
        out = await _download(sftp_endpoint, log, source="/outbound/big.bin", max_size_mib=0)
        assert out["success"] is True
        assert (sftp_endpoint.wave.artifacts / "big.bin").stat().st_size == MIB + 1


class TestOrderOfChecks:
    """The walk, then Max files, then Max size (MiB), then the destination (SFTP-6, SFTP-7)."""

    async def test_max_files_is_checked_before_max_size(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(
            sftp_endpoint,
            {"/outbound/a.bin": 400_000, "/outbound/b.bin": 400_000, "/outbound/c.bin": 400_000},
        )
        before = _snapshot(sftp_endpoint)
        with pytest.raises(ValueError, match=_exact(_too_many("/outbound/*.bin", 3, 2))):
            await _download(
                sftp_endpoint, log, source="/outbound/*.bin", max_files=2, max_size_mib=1
            )
        assert _snapshot(sftp_endpoint) == before

    async def test_the_limits_come_before_the_destination_shape(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/a.bin": 1, "/outbound/b.bin": 1, "/outbound/c.bin": 1})
        with pytest.raises(ValueError, match=_exact(_too_many("/outbound/*.bin", 3, 2))):
            await _download(
                sftp_endpoint,
                log,
                source="/outbound/*.bin",
                destination="artifact://one.bin",
                max_files=2,
            )

    async def test_the_limits_come_before_a_collision(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/big.bin": MIB + 1})
        (sftp_endpoint.wave.artifacts / "big.bin").write_text("old")
        with pytest.raises(ValueError, match=_exact(_too_large("/outbound/big.bin", MIB + 1, 1))):
            await _download(
                sftp_endpoint, log, source="/outbound/big.bin", max_size_mib=1, if_exists="fail"
            )
        assert (sftp_endpoint.wave.artifacts / "big.bin").read_text() == "old"

    async def test_the_walk_comes_before_the_limits(
        self, sftp_endpoint_unsafe_name: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint_unsafe_name
        _seed(ep, {"/outbound/data/a.bin": 1, "/outbound/data/b.bin": 1})
        message = (
            f"Unsafe entry name {UNSAFE_NAME.decode()!r} in /outbound/data on the SFTP server: "
            "a name holding / or \\ could land outside the destination"
        )
        with pytest.raises(ValueError, match=_exact(message)):
            await _download(ep, log, source="/outbound/data", max_files=1)
        assert tree(ep.wave.artifacts) == []


class TestRecordAndContinue:
    """A refused limit follows On error with its own reason (SFTP-6, SFTP-8)."""

    @pytest.mark.parametrize(
        ("settings", "message", "reason"),
        [
            ({"max_files": 1}, _too_many("/outbound/data", 2, 1), "TooManyFiles"),
            ({"max_size_mib": 1}, _too_large("/outbound/data", MIB + 1, 1), "TooLarge"),
        ],
        ids=["max-files", "max-size"],
    )
    async def test_a_refused_limit_is_recorded(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        settings: dict[str, Any],
        message: str,
        reason: str,
    ) -> None:
        _seed(sftp_endpoint, {"/outbound/data/a.bin": MIB, "/outbound/data/b.bin": 1})
        before = _snapshot(sftp_endpoint)
        out = await _download(
            sftp_endpoint, log, source="/outbound/data", on_error="record", **settings
        )
        assert (out["success"], out["error"], out["reason"]) == (False, message, reason)
        assert out["__block_warning"] is True
        assert rows(out["summary"]) == []
        assert log == [("WARN", f"Download failed ({reason}): {message}")]
        assert _snapshot(sftp_endpoint) == before


BLANK_ROWS = [
    pytest.param({}, id="absent"),
    pytest.param({"row": None}, id="none"),
    pytest.param({"row": ""}, id="empty"),
]


def _row(name: str, blank: dict[str, Any]) -> dict[str, Any]:
    return {name: blank["row"]} if blank else {}


class TestDefaults:
    """Absent, None or empty limit rows take 1024 MiB and 10,000 files (SFTP-6)."""

    def test_the_defaults_are_1024_mib_and_10000_files(self) -> None:
        sftp_ops = importlib.import_module("wavecore.plugins._sftp_ops")
        assert (sftp_ops.MAX_SIZE_MIB_DEFAULT, sftp_ops.MAX_FILES_DEFAULT) == (1024, 10_000)

    @pytest.mark.parametrize("blank", BLANK_ROWS)
    async def test_a_blank_max_size_takes_1024_mib(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, blank: dict[str, Any]
    ) -> None:
        huge = sftp_endpoint.write("/outbound/huge.bin")
        os.truncate(huge, 1024 * MIB + 1)
        # A run that failed to refuse would copy a gibibyte; the Timeout bounds it.
        with pytest.raises(
            ValueError, match=_exact(_too_large("/outbound/huge.bin", 1024 * MIB + 1, 1024))
        ):
            await _download(
                sftp_endpoint,
                log,
                source="/outbound/huge.bin",
                timeout=5,
                **_row("max_size_mib", blank),
            )
        assert tree(sftp_endpoint.wave.artifacts) == []

    @pytest.mark.parametrize("blank", BLANK_ROWS)
    async def test_a_blank_max_files_takes_the_default(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
        blank: dict[str, Any],
    ) -> None:
        # Ten thousand and one files would take seconds to walk; the default is pinned above.
        monkeypatch.setattr("wavecore.plugins._sftp_ops.MAX_FILES_DEFAULT", 2)
        _seed(sftp_endpoint, {"/outbound/a.bin": 1, "/outbound/b.bin": 1, "/outbound/c.bin": 1})
        with pytest.raises(ValueError, match=_exact(_too_many("/outbound/*.bin", 3, 2))):
            await _download(
                sftp_endpoint, log, source="/outbound/*.bin", **_row("max_files", blank)
            )
        assert tree(sftp_endpoint.wave.artifacts) == []


TINY = {"max_files": 1, "max_size_mib": 1}


class TestOtherOperations:
    """The limit rows bound Download only, even when set to tiny values (SFTP-6)."""

    async def test_upload_ignores_the_limits(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        data = sftp_endpoint.wave.testdata / "data"
        data.mkdir()
        (data / "a.bin").write_bytes(b"x" * MIB)
        (data / "b.bin").write_bytes(b"y")
        out = await sftp_endpoint.run(
            sftp_endpoint.params(
                "upload", source="testdata://data", destination="/inbound/", **TINY
            ),
            log,
        )
        assert out["success"] is True
        assert sftp_endpoint.tree("/inbound") == ["data/", "data/a.bin", "data/b.bin"]

    async def test_list_ignores_the_limits(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/data/a.bin": 1, "/data/b.bin": 1, "/data/c.bin": MIB + 1})
        out = await sftp_endpoint.run(sftp_endpoint.params("list", path="/data", **TINY), log)
        assert (out["success"], out["count"]) == (True, 3)

    async def test_stats_ignores_the_limits(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/data/big.bin": MIB + 1})
        out = await sftp_endpoint.run(
            sftp_endpoint.params("stats", path="/data/big.bin", **TINY), log
        )
        assert (out["success"], out["exists"], out["size"]) == (True, True, MIB + 1)

    async def test_delete_ignores_the_limits(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/data/a.bin": 1, "/data/b.bin": 1, "/data/c.bin": MIB + 1})
        out = await sftp_endpoint.run(sftp_endpoint.params("delete", path="/data", **TINY), log)
        assert out["success"] is True
        assert not sftp_endpoint.disk("/data").exists()

    async def test_move_ignores_the_limits(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        _seed(sftp_endpoint, {"/data/a.bin": 1, "/data/b.bin": 1, "/data/c.bin": MIB + 1})
        out = await sftp_endpoint.run(
            sftp_endpoint.params("move", source="/data", destination="/moved", **TINY), log
        )
        assert out["success"] is True
        assert sftp_endpoint.tree("/moved") == ["a.bin", "b.bin", "c.bin"]
        assert not sftp_endpoint.disk("/data").exists()

    async def test_create_folder_ignores_the_limits(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        out = await sftp_endpoint.run(
            sftp_endpoint.params("create_folder", path="/data/new", **TINY), log
        )
        assert out["success"] is True
        assert sftp_endpoint.tree("/data") == ["new/"]
