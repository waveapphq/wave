"""SFTP Stats: whether a server path is there and what it is (REQ-3.4.1.8, SFTP-9)."""

import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

from tests.plugins.sftp.conftest import LogRecorder, SFTPEndpoint
from wavecore.plugins import _file_ops

# 2026-09-28T10:00:00+00:00; SFTP v3 carries whole seconds.
MTIME = 1_790_589_600
MISSING = {"exists": False, "type": "", "size": 0, "modified": ""}
PASSED = {"success": True, "error": "", "reason": ""}


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _stamp(ep: SFTPEndpoint, path: str, offset: int = 0) -> int:
    """Give a server path (a link's target, for a link) its own whole-second mtime."""
    mtime = MTIME + offset
    os.utime(ep.disk(path), (mtime, mtime))
    return mtime


def _reported(path: str) -> list[tuple[str, str]]:
    return [("INFO", f"Reported stats for {path}")]


def _there(kind: str, size: int, mtime: int) -> dict[str, Any]:
    return {
        "exists": True,
        "type": kind,
        "size": size,
        "modified": _file_ops.iso_modified(mtime),
        **PASSED,
    }


@contextmanager
def _locked(folder: Path) -> Iterator[None]:
    """Take every permission off a server folder for the test's body."""
    folder.chmod(0)
    try:
        yield
    finally:
        folder.chmod(0o755)


class TestFile:
    """A file reports Exists, Type file, its bytes and its modified time."""

    async def test_a_file(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/orders.out", "12345")
        mtime = _stamp(ep, "/outbound/orders.out")
        out = await ep.run(ep.params("stats", path="/outbound/orders.out"), log)
        assert out == _there("file", 5, mtime)
        assert log == _reported("/outbound/orders.out")

    async def test_modified_is_iso_8601_utc(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/orders.out", "12345")
        _stamp(ep, "/outbound/orders.out")
        out = await ep.run(ep.params("stats", path="/outbound/orders.out"), log)
        assert out["modified"] == "2026-09-28T10:00:00+00:00"

    async def test_an_empty_file(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/empty.out")
        mtime = _stamp(ep, "/outbound/empty.out")
        out = await ep.run(ep.params("stats", path="/outbound/empty.out"), log)
        assert out == _there("file", 0, mtime)

    async def test_a_relative_path_starts_in_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("reports/today.csv", "a,b\n")
        mtime = _stamp(ep, "reports/today.csv")
        out = await ep.run(ep.params("stats", path="reports/today.csv"), log)
        assert out == _there("file", 4, mtime)
        assert log == _reported("reports/today.csv")


class TestFolder:
    """A folder reports Type folder and Size 0 (the server's own folder size is not a size)."""

    async def test_a_folder(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/big/data.bin", b"x" * 10_000)
        mtime = _stamp(ep, "/outbound/big", 30)
        out = await ep.run(ep.params("stats", path="/outbound/big"), log)
        assert out == _there("folder", 0, mtime)
        assert log == _reported("/outbound/big")

    async def test_the_home(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("inside.txt", "i")
        mtime = _stamp(ep, "/home/wave")
        out = await ep.run(ep.params("stats", path="/home/wave"), log)
        assert out == _there("folder", 0, mtime)


class TestLinks:
    """Stats follows a symbolic link and reports its target."""

    async def test_a_link_to_a_file(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/orders.out", "123456789")
        os.symlink("orders.out", ep.disk("/outbound/latest"))
        mtime = _stamp(ep, "/outbound/orders.out", 5)
        out = await ep.run(ep.params("stats", path="/outbound/latest"), log)
        assert out == _there("file", 9, mtime)
        assert log == _reported("/outbound/latest")

    async def test_a_link_to_a_folder(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/data/inside.txt", "i")
        os.symlink(ep.disk("/data"), ep.disk("/current"))
        mtime = _stamp(ep, "/data", 7)
        out = await ep.run(ep.params("stats", path="/current"), log)
        assert out == _there("folder", 0, mtime)

    async def test_a_broken_link_is_missing(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.mkdir("/outbound")
        os.symlink("gone.out", ep.disk("/outbound/latest"))
        out = await ep.run(ep.params("stats", path="/outbound/latest"), log)
        assert out == {**MISSING, **PASSED}
        assert log == _reported("/outbound/latest")


class TestMissing:
    """A missing path is not a failure: Exists false, Type empty, Size 0, Modified empty."""

    @pytest.mark.parametrize("on_error", [None, "fail", "record"])
    @pytest.mark.parametrize(
        "path",
        ["/nowhere.txt", "/nowhere/deeper.txt", "missing.txt", "/outbound/a.txt/under-a-file"],
    )
    async def test_missing_path(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, path: str, on_error: str | None
    ) -> None:
        sftp_endpoint.write("/outbound/a.txt", "a")
        params = sftp_endpoint.params("stats", path=path, on_error=on_error)
        out = await sftp_endpoint.run(params, log)
        assert out == {**MISSING, **PASSED}
        assert log == _reported(path)


class TestRecordedFailure:
    """A run-time failure follows On error; Record returns the Stats empties."""

    MESSAGE = "Permission denied on the SFTP server: /locked/secret.txt"

    async def test_fail_the_block_raises(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        folder = sftp_endpoint.write("/locked/secret.txt", "s").parent
        params = sftp_endpoint.params("stats", path="/locked/secret.txt")
        with _locked(folder), pytest.raises(ValueError, match=_exact(self.MESSAGE)):
            await sftp_endpoint.run(params, log)
        assert log == []

    async def test_record_returns_the_empties(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        folder = sftp_endpoint.write("/locked/secret.txt", "s").parent
        params = sftp_endpoint.params("stats", path="/locked/secret.txt", on_error="record")
        with _locked(folder):
            out = await sftp_endpoint.run(params, log)
        assert out == {
            **MISSING,
            "success": False,
            "error": self.MESSAGE,
            "reason": "PermissionDenied",
            "__block_warning": True,
        }
        assert log == [("WARN", f"Stats failed (PermissionDenied): {self.MESSAGE}")]
