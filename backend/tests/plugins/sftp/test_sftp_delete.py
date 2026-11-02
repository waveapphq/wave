"""SFTP Delete: files, folder trees and patterns on the server (REQ-3.4.1.8, SFTP-3, SFTP-5)."""

import os
import re
from typing import Any

import pytest

from tests.plugins.sftp.conftest import HOME, LogRecorder, SFTPEndpoint

PASSED = {"success": True, "error": "", "reason": ""}


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _recorded(message: str, reason: str) -> dict[str, Any]:
    return {"success": False, "error": message, "reason": reason, "__block_warning": True}


def _refusal(path: str) -> str:
    return (
        f"{path} names the account's home, a folder above it or the SFTP server's root folder "
        "and cannot be deleted"
    )


class TestPlainPath:
    """A path without a wildcard deletes that one file or folder tree."""

    async def test_a_file(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/orders.out", "o")
        ep.write("/outbound/keep.txt", "k")
        out = await ep.run(ep.params("delete", path="/outbound/orders.out"), log)
        assert out == PASSED
        assert ep.tree("/outbound") == ["keep.txt"]
        assert log == [("INFO", "Deleted /outbound/orders.out")]

    async def test_a_folder_goes_with_everything_inside(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/batch/a.txt", "a")
        ep.write("/outbound/batch/sub/deeper/b.txt", "b")
        ep.write("/outbound/batch/.hidden", "h")
        ep.mkdir("/outbound/batch/empty")
        ep.write("/outbound/keep.txt", "k")
        out = await ep.run(ep.params("delete", path="/outbound/batch"), log)
        assert out == PASSED
        assert ep.tree("/outbound") == ["keep.txt"]
        assert log == [("INFO", "Deleted /outbound/batch")]

    async def test_a_relative_path_starts_in_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("old/x.txt", "x")
        ep.write("keep.txt", "k")
        out = await ep.run(ep.params("delete", path="old"), log)
        assert out == PASSED
        assert ep.tree(HOME) == ["keep.txt"]
        assert log == [("INFO", "Deleted old")]

    async def test_an_absolute_folder_inside_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/home/wave/old/x.txt", "x")
        ep.write("/home/wave/keep.txt", "k")
        await ep.run(ep.params("delete", path="/home/wave/old"), log)
        assert ep.tree(HOME) == ["keep.txt"]
        assert log == [("INFO", "Deleted /home/wave/old")]

    async def test_a_sibling_whose_name_starts_like_the_home_is_not_above_it(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/home/w/x.txt", "x")
        await ep.run(ep.params("delete", path="/home/w"), log)
        assert ep.tree("/home") == ["wave/"]
        assert log == [("INFO", "Deleted /home/w")]


class TestSymbolicLinks:
    """A link is removed as a link; what it points to stays."""

    async def test_a_link_to_a_folder(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/data/keep.txt", "k")
        ep.mkdir("/outbound")
        os.symlink(ep.disk("/data"), ep.disk("/outbound/link"))
        out = await ep.run(ep.params("delete", path="/outbound/link"), log)
        assert out == PASSED
        assert ep.tree("/outbound") == []
        assert ep.tree("/data") == ["keep.txt"]
        assert log == [("INFO", "Deleted /outbound/link")]

    async def test_a_link_to_a_file(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/orders.out", "o")
        os.symlink("orders.out", ep.disk("/outbound/latest"))
        await ep.run(ep.params("delete", path="/outbound/latest"), log)
        assert ep.tree("/outbound") == ["orders.out"]
        assert ep.disk("/outbound/orders.out").read_text() == "o"

    async def test_a_broken_link(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.mkdir("/outbound")
        os.symlink("gone.out", ep.disk("/outbound/latest"))
        out = await ep.run(ep.params("delete", path="/outbound/latest"), log)
        assert out == PASSED
        assert ep.tree("/outbound") == []
        assert log == [("INFO", "Deleted /outbound/latest")]

    async def test_a_matched_link_to_a_folder(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/data/keep.txt", "k")
        ep.write("/outbound/other.txt", "o")
        os.symlink(ep.disk("/data"), ep.disk("/outbound/link-data"))
        out = await ep.run(ep.params("delete", path="/outbound/link-*"), log)
        assert out == PASSED
        assert ep.tree("/outbound") == ["other.txt"]
        assert ep.tree("/data") == ["keep.txt"]
        assert log == [("INFO", "Deleted 1 match of /outbound/link-*")]


class TestWildcard:
    """A pattern deletes every match; `*` never matches a leading dot (SFTP-3)."""

    async def test_every_match(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        for name in ("a.out", "b.out", "c.txt", ".hidden.out"):
            ep.write(f"/outbound/{name}", name)
        out = await ep.run(ep.params("delete", path="/outbound/*.out"), log)
        assert out == PASSED
        assert ep.tree("/outbound") == [".hidden.out", "c.txt"]
        assert log == [("INFO", "Deleted 2 matches of /outbound/*.out")]

    async def test_one_match_is_singular(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.out", "a")
        ep.write("/outbound/b.txt", "b")
        await ep.run(ep.params("delete", path="/outbound/*.out"), log)
        assert ep.tree("/outbound") == ["b.txt"]
        assert log == [("INFO", "Deleted 1 match of /outbound/*.out")]

    async def test_a_matched_folder_goes_with_its_tree(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/batch-1/x.txt", "x")
        ep.write("/outbound/batch-1/sub/y.txt", "y")
        ep.write("/outbound/batch-2.txt", "2")
        ep.write("/outbound/keep.txt", "k")
        await ep.run(ep.params("delete", path="/outbound/batch-?*"), log)
        assert ep.tree("/outbound") == ["keep.txt"]
        assert log == [("INFO", "Deleted 2 matches of /outbound/batch-?*")]

    async def test_a_pattern_in_a_middle_segment(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/drop/a/orders.csv", "a")
        ep.write("/drop/b/orders.csv", "b")
        ep.write("/drop/b/keep.csv", "k")
        await ep.run(ep.params("delete", path="/drop/*/orders.csv"), log)
        assert ep.tree("/drop") == ["a/", "b/", "b/keep.csv"]
        assert log == [("INFO", "Deleted 2 matches of /drop/*/orders.csv")]

    async def test_a_relative_pattern_starts_in_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("staging/a.part", "a")
        ep.write("staging/b.part", "b")
        ep.write("staging/c.csv", "c")
        await ep.run(ep.params("delete", path="staging/*.part"), log)
        assert ep.tree(f"{HOME}/staging") == ["c.csv"]
        assert log == [("INFO", "Deleted 2 matches of staging/*.part")]


NOTHING_THERE = ["/outbound/none.txt", "none.txt", "/outbound/*.zip", "/nowhere/*.txt"]


class TestIgnoreMissing:
    """Nothing there passes with Ignore missing on and fails the block with it off."""

    @pytest.mark.parametrize("path", NOTHING_THERE)
    async def test_on_passes(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, path: str
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/keep.txt", "k")
        before = ep.tree()
        out = await ep.run(ep.params("delete", path=path, missing_ok=True), log)
        assert out == PASSED
        assert ep.tree() == before
        assert log == [("INFO", f"Nothing to delete: {path}")]

    @pytest.mark.parametrize("missing_ok", [None, False])
    @pytest.mark.parametrize("path", NOTHING_THERE)
    async def test_off_fails_the_block(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, path: str, missing_ok: bool | None
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/keep.txt", "k")
        params = ep.params("delete", path=path, missing_ok=missing_ok)
        with pytest.raises(ValueError, match=_exact(f"Nothing to delete: {path}")):
            await ep.run(params, log)
        assert log == []

    @pytest.mark.parametrize("path", NOTHING_THERE)
    async def test_off_under_record(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, path: str
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/keep.txt", "k")
        out = await ep.run(ep.params("delete", path=path, on_error="record"), log)
        message = f"Nothing to delete: {path}"
        assert out == _recorded(message, "NotFound")
        assert log == [("WARN", f"Delete failed (NotFound): {message}")]


REFUSED_PATHS = [
    pytest.param("/home", id="the-homes-parent"),
    pytest.param("/home/wave", id="the-home"),
    pytest.param("/home/wave/", id="the-home-with-a-trailing-slash"),
    pytest.param("../wave", id="relative-to-the-home"),
    pytest.param("/home/wave/sub/..", id="dot-dot-back-to-the-home"),
    pytest.param("/home/../home", id="dot-dot-to-the-homes-parent"),
]
REFUSED_PATTERNS = [
    pytest.param("/*", id="root-pattern-matches-home"),
    pytest.param("/home/*", id="pattern-matches-the-home"),
    pytest.param("/[ah]*", id="brackets-match-home"),
]


class TestHomeOrAboveRefusedAtRunTime:
    """A target whose server-resolved path is the root, the home or above it is refused (SFTP-5)."""

    @staticmethod
    def _seed(ep: SFTPEndpoint) -> list[str]:
        ep.write("/a-drop/x.txt", "x")
        ep.write("/home/other/y.txt", "y")
        ep.write("/home/wave/keep.txt", "k")
        ep.write("/home/wave/sub/z.txt", "z")
        ep.write("/zeta.txt", "z")
        return ep.tree()

    @pytest.mark.parametrize("path", REFUSED_PATHS + REFUSED_PATTERNS)
    async def test_fail_the_block_refuses_before_anything_is_deleted(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, path: str
    ) -> None:
        before = self._seed(sftp_endpoint)
        params = sftp_endpoint.params("delete", path=path)
        with pytest.raises(ValueError, match=_exact(_refusal(path))):
            await sftp_endpoint.run(params, log)
        assert sftp_endpoint.tree() == before
        assert log == []

    @pytest.mark.parametrize("path", REFUSED_PATHS + REFUSED_PATTERNS)
    async def test_record_refuses_before_anything_is_deleted(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, path: str
    ) -> None:
        before = self._seed(sftp_endpoint)
        params = sftp_endpoint.params("delete", path=path, on_error="record")
        out = await sftp_endpoint.run(params, log)
        assert out == _recorded(_refusal(path), "Refused")
        assert sftp_endpoint.tree() == before
        assert log == [("WARN", f"Delete failed (Refused): {_refusal(path)}")]

    async def test_ignore_missing_does_not_lift_the_refusal(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        before = self._seed(sftp_endpoint)
        params = sftp_endpoint.params("delete", path="/home", missing_ok=True)
        with pytest.raises(ValueError, match=_exact(_refusal("/home"))):
            await sftp_endpoint.run(params, log)
        assert sftp_endpoint.tree() == before
