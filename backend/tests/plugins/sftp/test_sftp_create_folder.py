"""SFTP Create folder: a server folder with its missing parents (REQ-3.4.1.8, SFTP-5)."""

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


class TestCreate:
    """The folder is created with every missing parent."""

    async def test_missing_parents_are_created(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        out = await ep.run(ep.params("create_folder", path="/reports/2026/09"), log)
        assert out == PASSED
        assert ep.tree("/reports") == ["2026/", "2026/09/"]
        assert log == [("INFO", "Created folder /reports/2026/09")]

    async def test_one_new_folder_in_an_existing_one(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "a")
        await ep.run(ep.params("create_folder", path="/outbound/done"), log)
        assert ep.tree("/outbound") == ["a.txt", "done/"]
        assert log == [("INFO", "Created folder /outbound/done")]

    async def test_a_relative_path_starts_in_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        await ep.run(ep.params("create_folder", path="reports/2026"), log)
        assert ep.tree(HOME) == ["reports/", "reports/2026/"]
        assert log == [("INFO", "Created folder reports/2026")]


class TestAlreadyThere:
    """An existing folder is not an error and is left as it is."""

    @pytest.mark.parametrize("path", ["/outbound", "outbound-home", "/home/wave"])
    async def test_an_existing_folder(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, path: str
    ) -> None:
        ep = sftp_endpoint
        ep.write(f"{path}/a.txt", "a")
        before = ep.tree()
        out = await ep.run(ep.params("create_folder", path=path), log)
        assert out == PASSED
        assert ep.tree() == before
        assert log == [("INFO", f"Folder already exists: {path}")]


NOT_A_FOLDER = ["file", "link-to-folder", "link-to-file", "broken-link"]


class TestNotAFolder:
    """A file or a symbolic link at Path fails the block, or is recorded."""

    @staticmethod
    def _seed(ep: SFTPEndpoint, kind: str) -> list[str]:
        ep.write("/outbound/a.txt", "a")
        ep.mkdir("/data")
        target = ep.disk("/outbound/in-the-way")
        if kind == "file":
            ep.write("/outbound/in-the-way", "f")
        elif kind == "link-to-folder":
            os.symlink(ep.disk("/data"), target)
        elif kind == "link-to-file":
            os.symlink("a.txt", target)
        else:
            os.symlink("gone", target)
        return ep.tree()

    MESSAGE = "Not a folder on the SFTP server: /outbound/in-the-way"

    @pytest.mark.parametrize("kind", NOT_A_FOLDER)
    async def test_fail_the_block(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, kind: str
    ) -> None:
        ep = sftp_endpoint
        before = self._seed(ep, kind)
        params = ep.params("create_folder", path="/outbound/in-the-way")
        with pytest.raises(ValueError, match=_exact(self.MESSAGE)):
            await ep.run(params, log)
        assert ep.tree() == before
        assert log == []

    @pytest.mark.parametrize("kind", NOT_A_FOLDER)
    async def test_record(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, kind: str) -> None:
        ep = sftp_endpoint
        before = self._seed(ep, kind)
        params = ep.params("create_folder", path="/outbound/in-the-way", on_error="record")
        out = await ep.run(params, log)
        assert out == _recorded(self.MESSAGE, "NotAFolder")
        assert ep.tree() == before
        assert log == [("WARN", f"Create folder failed (NotAFolder): {self.MESSAGE}")]
