"""SFTP Move: rename or move a file or folder on the server (REQ-3.4.1.8, SFTP-5)."""

import re
from typing import Any

import asyncssh
import pytest

from tests.plugins.sftp.conftest import (
    HOME,
    LogRecorder,
    RenameUnsupported,
    SFTPEndpoint,
    SFTPServerStarter,
    WaveSFTPServer,
)

PASSED = {"success": True, "error": "", "reason": ""}
REPLACE_IT = pytest.mark.parametrize("if_exists", [None, "overwrite"])


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _recorded(message: str, reason: str) -> dict[str, Any]:
    return {"success": False, "error": message, "reason": reason, "__block_warning": True}


def _moved(source: str, target: str) -> list[tuple[str, str]]:
    return [("INFO", f"Moved {source} to {target}")]


def _exists_message(target: str) -> str:
    return f"Destination exists and If the file exists is Fail the block: {target}"


def _holding_message(source: str, target: str) -> str:
    return (
        f"Cannot move {source} to {target}: the target is the source itself or a folder "
        "holding it"
    )


def _conflict(message: str) -> list[tuple[str, str]]:
    return [("WARN", f"Move failed (Conflict): {message}")]


REALPATH_REFUSAL = "realpath refused by the test server"


class RealpathRefused(WaveSFTPServer):
    """Every realpath answers FX_FAILURE with REALPATH_REFUSAL."""

    def realpath(self, path: bytes) -> bytes:
        raise asyncssh.SFTPFailure(REALPATH_REFUSAL)


class TestRename:
    """A destination that is not an existing folder is the new name."""

    async def test_rename_in_place(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "payload")
        params = ep.params("move", source="/outbound/a.txt", destination="/outbound/b.txt")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/outbound") == ["b.txt"]
        assert ep.disk("/outbound/b.txt").read_text() == "payload"
        assert log == _moved("/outbound/a.txt", "/outbound/b.txt")

    async def test_a_folder_moves_with_everything_inside(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/batch/x.txt", "x")
        ep.write("/outbound/batch/sub/y.txt", "y")
        ep.mkdir("/archive")
        params = ep.params("move", source="/outbound/batch", destination="/archive/batch-1")
        await ep.run(params, log)
        assert ep.tree("/outbound") == []
        assert ep.tree("/archive") == [
            "batch-1/",
            "batch-1/sub/",
            "batch-1/sub/y.txt",
            "batch-1/x.txt",
        ]
        assert log == _moved("/outbound/batch", "/archive/batch-1")

    async def test_relative_paths_start_in_the_home(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("a.txt", "a")
        await ep.run(ep.params("move", source="a.txt", destination="b.txt"), log)
        assert ep.tree(HOME) == ["b.txt"]
        assert log == _moved("a.txt", "b.txt")


class TestDestinationFolder:
    """An existing folder or a trailing / receives the source under its own name (SFTP-5)."""

    async def test_into_an_existing_folder_keeps_the_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "a")
        ep.write("/archive/old.txt", "o")
        params = ep.params("move", source="/outbound/a.txt", destination="/archive")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/archive") == ["a.txt", "old.txt"]
        assert ep.disk("/archive/a.txt").read_text() == "a"
        assert log == _moved("/outbound/a.txt", "/archive/a.txt")

    async def test_a_folder_into_an_existing_folder(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/batch/x.txt", "x")
        ep.mkdir("/archive")
        params = ep.params("move", source="/outbound/batch", destination="/archive")
        await ep.run(params, log)
        assert ep.tree("/archive") == ["batch/", "batch/x.txt"]
        assert log == _moved("/outbound/batch", "/archive/batch")

    async def test_a_trailing_slash_names_a_folder_created_when_missing(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "a")
        params = ep.params("move", source="/outbound/a.txt", destination="/archive/2026/")
        await ep.run(params, log)
        assert ep.tree("/archive") == ["2026/", "2026/a.txt"]
        assert log == _moved("/outbound/a.txt", "/archive/2026/a.txt")

    async def test_a_relative_trailing_slash(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("a.txt", "a")
        await ep.run(ep.params("move", source="a.txt", destination="done/"), log)
        assert ep.tree(HOME) == ["done/", "done/a.txt"]
        assert log == _moved("a.txt", "done/a.txt")

    async def test_a_trailing_slash_on_the_source_is_ignored(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/batch/x.txt", "x")
        ep.mkdir("/archive")
        params = ep.params("move", source="/outbound/batch/", destination="/archive")
        await ep.run(params, log)
        assert ep.tree("/archive") == ["batch/", "batch/x.txt"]
        assert log == _moved("/outbound/batch/", "/archive/batch")


class TestMissingParents:
    """Missing parent folders of the target are created first."""

    async def test_a_new_name_under_missing_folders(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "a")
        params = ep.params("move", source="/outbound/a.txt", destination="/archive/2026/09/b.txt")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/archive") == ["2026/", "2026/09/", "2026/09/b.txt"]
        assert ep.tree("/outbound") == []
        assert log == _moved("/outbound/a.txt", "/archive/2026/09/b.txt")


class TestReplaceIt:
    """Replace it removes what is at the target, then moves (SFTP-5)."""

    @REPLACE_IT
    async def test_a_file_over_a_file(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, if_exists: str | None
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "new")
        ep.write("/archive/a.txt", "old")
        params = ep.params(
            "move", source="/outbound/a.txt", destination="/archive/a.txt", if_exists=if_exists
        )
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/outbound") == []
        assert ep.disk("/archive/a.txt").read_text() == "new"
        assert log == _moved("/outbound/a.txt", "/archive/a.txt")

    @REPLACE_IT
    async def test_a_file_over_a_folder(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, if_exists: str | None
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "new")
        ep.write("/archive/a.txt/inner.txt", "i")
        params = ep.params(
            "move", source="/outbound/a.txt", destination="/archive", if_exists=if_exists
        )
        await ep.run(params, log)
        assert ep.tree("/archive") == ["a.txt"]
        assert ep.disk("/archive/a.txt").read_text() == "new"
        assert log == _moved("/outbound/a.txt", "/archive/a.txt")

    @REPLACE_IT
    async def test_a_folder_over_a_folder_is_not_merged(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, if_exists: str | None
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/batch/x.txt", "x")
        ep.write("/archive/batch/old.txt", "o")
        params = ep.params(
            "move", source="/outbound/batch", destination="/archive", if_exists=if_exists
        )
        await ep.run(params, log)
        assert ep.tree("/archive") == ["batch/", "batch/x.txt"]
        assert log == _moved("/outbound/batch", "/archive/batch")

    @REPLACE_IT
    async def test_a_folder_over_a_file(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, if_exists: str | None
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/batch/x.txt", "x")
        ep.write("/archive/batch", "a file")
        params = ep.params(
            "move", source="/outbound/batch", destination="/archive/batch", if_exists=if_exists
        )
        await ep.run(params, log)
        assert ep.tree("/archive") == ["batch/", "batch/x.txt"]
        assert log == _moved("/outbound/batch", "/archive/batch")


class TestFailTheBlock:
    """Fail the block refuses when anything is at the target, and changes nothing."""

    @staticmethod
    def _seed(ep: SFTPEndpoint, target: str) -> list[str]:
        ep.write("/outbound/a.txt", "new")
        if target == "file":
            ep.write("/archive/a.txt", "old")
        else:
            ep.write("/archive/a.txt/inner.txt", "i")
        return ep.tree()

    @pytest.mark.parametrize("target", ["file", "folder"])
    async def test_refused_with_nothing_changed(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, target: str
    ) -> None:
        ep = sftp_endpoint
        before = self._seed(ep, target)
        params = ep.params(
            "move", source="/outbound/a.txt", destination="/archive", if_exists="fail"
        )
        with pytest.raises(ValueError, match=_exact(_exists_message("/archive/a.txt"))):
            await ep.run(params, log)
        assert ep.tree() == before
        assert ep.disk("/outbound/a.txt").read_text() == "new"
        assert log == []

    async def test_a_named_target_file(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        before = self._seed(ep, "file")
        params = ep.params(
            "move", source="/outbound/a.txt", destination="/archive/a.txt", if_exists="fail"
        )
        with pytest.raises(ValueError, match=_exact(_exists_message("/archive/a.txt"))):
            await ep.run(params, log)
        assert ep.tree() == before
        assert ep.disk("/archive/a.txt").read_text() == "old"

    async def test_record(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        before = self._seed(ep, "file")
        params = ep.params(
            "move",
            source="/outbound/a.txt",
            destination="/archive",
            if_exists="fail",
            on_error="record",
        )
        out = await ep.run(params, log)
        message = _exists_message("/archive/a.txt")
        assert out == _recorded(message, "Exists")
        assert ep.tree() == before
        assert log == [("WARN", f"Move failed (Exists): {message}")]

    async def test_a_free_target_moves(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "a")
        ep.mkdir("/archive")
        params = ep.params(
            "move", source="/outbound/a.txt", destination="/archive", if_exists="fail"
        )
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/archive") == ["a.txt"]
        assert log == _moved("/outbound/a.txt", "/archive/a.txt")


class TestMissingSource:
    """A source not on the server fails the block, or is recorded."""

    MESSAGE = "Source not found on the SFTP server: /outbound/none.txt"

    async def test_fail_the_block(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.mkdir("/archive")
        before = ep.tree()
        params = ep.params("move", source="/outbound/none.txt", destination="/archive")
        with pytest.raises(ValueError, match=_exact(self.MESSAGE)):
            await ep.run(params, log)
        assert ep.tree() == before
        assert log == []

    async def test_record(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder) -> None:
        ep = sftp_endpoint
        ep.mkdir("/archive")
        params = ep.params(
            "move", source="/outbound/none.txt", destination="/archive", on_error="record"
        )
        out = await ep.run(params, log)
        assert out == _recorded(self.MESSAGE, "NotFound")
        assert log == [("WARN", f"Move failed (NotFound): {self.MESSAGE}")]


class TestPosixRenameUnsupported:
    """A server without posix-rename still moves: remove the target, then a plain rename."""

    async def test_replace_it_over_a_file(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(RenameUnsupported)
        ep.write("/outbound/a.txt", "new")
        ep.write("/archive/a.txt", "old")
        params = ep.params("move", source="/outbound/a.txt", destination="/archive/a.txt")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/outbound") == []
        assert ep.tree("/archive") == ["a.txt"]
        assert ep.disk("/archive/a.txt").read_text() == "new"
        assert log == _moved("/outbound/a.txt", "/archive/a.txt")

    async def test_a_free_target(self, sftp_server: SFTPServerStarter, log: LogRecorder) -> None:
        ep = await sftp_server(RenameUnsupported)
        ep.write("/outbound/a.txt", "a")
        params = ep.params("move", source="/outbound/a.txt", destination="/archive/b.txt")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/archive") == ["b.txt"]
        assert log == _moved("/outbound/a.txt", "/archive/b.txt")


HOLDERS = pytest.mark.parametrize(
    ("source", "destination", "target"),
    [
        ("/data/dir", "/data/", "/data/dir"),
        ("/data/dir", "/data", "/data/dir"),
        ("/data/dir/", "/data//", "/data/dir"),
        ("/data/dir/dir", "/data/", "/data/dir"),
        ("/data/./dir", "/data/", "/data/dir"),
        ("/data/dir", "/data/./", "/data/./dir"),
        ("/data/dir/../dir", "/data", "/data/dir"),
        ("/data/dir/dir/..", "/data/", "/data/dir"),
        ("dir", HOME, f"{HOME}/dir"),
        (f"{HOME}/dir", ".", "./dir"),
    ],
)


class TestTargetHoldsTheSource:
    """Replace it never removes the source: a target that is it or holds it is refused (SFTP-5)."""

    @staticmethod
    def _seed(ep: SFTPEndpoint) -> list[str]:
        ep.write("/data/dir/x.txt", "x")
        ep.write("/data/dir/dir/y.txt", "y")
        ep.write(f"{HOME}/dir/z.txt", "z")
        return ep.tree()

    @staticmethod
    def _untouched(ep: SFTPEndpoint, before: list[str]) -> None:
        assert ep.tree() == before
        assert ep.disk("/data/dir/x.txt").read_text() == "x"
        assert ep.disk("/data/dir/dir/y.txt").read_text() == "y"
        assert ep.disk(f"{HOME}/dir/z.txt").read_text() == "z"

    @HOLDERS
    async def test_fail_the_block(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        source: str,
        destination: str,
        target: str,
    ) -> None:
        ep = sftp_endpoint
        before = self._seed(ep)
        params = ep.params("move", source=source, destination=destination)
        with pytest.raises(ValueError, match=_exact(_holding_message(source, target))):
            await ep.run(params, log)
        self._untouched(ep, before)
        assert log == []

    @HOLDERS
    async def test_record(
        self,
        sftp_endpoint: SFTPEndpoint,
        log: LogRecorder,
        source: str,
        destination: str,
        target: str,
    ) -> None:
        ep = sftp_endpoint
        before = self._seed(ep)
        params = ep.params(
            "move",
            source=source,
            destination=destination,
            if_exists="overwrite",
            on_error="record",
        )
        out = await ep.run(params, log)
        message = _holding_message(source, target)
        assert out == _recorded(message, "Conflict")
        self._untouched(ep, before)
        assert log == _conflict(message)

    async def test_fail_the_block_setting_is_checked_first(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        before = self._seed(ep)
        params = ep.params("move", source="/data/dir", destination="/data/", if_exists="fail")
        with pytest.raises(ValueError, match=_exact(_exists_message("/data/dir"))):
            await ep.run(params, log)
        self._untouched(ep, before)

    async def test_a_server_error_while_resolving_is_recorded(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(RealpathRefused)
        before = self._seed(ep)
        params = ep.params("move", source="/data/dir", destination="/data/", on_error="record")
        out = await ep.run(params, log)
        message = f"The SFTP server refused Move on /data/dir: {REALPATH_REFUSAL}"
        assert out == _recorded(message, "ServerFailure")
        self._untouched(ep, before)
        assert log == [("WARN", f"Move failed (ServerFailure): {message}")]


SAME_FILE = pytest.mark.parametrize(
    ("source", "destination", "target"),
    [
        ("/data/a.txt", "/data/a.txt", "/data/a.txt"),
        ("/data/a.txt", "/data/", "/data/a.txt"),
        ("/data/./a.txt", "/data/a.txt", "/data/a.txt"),
        ("a.txt", f"{HOME}/a.txt", f"{HOME}/a.txt"),
    ],
)


class TestFileOntoItself:
    """A file moved onto itself is refused before the posix-rename fallback removes it (SFTP-5)."""

    @staticmethod
    def _seed(ep: SFTPEndpoint) -> list[str]:
        ep.write("/data/a.txt", "a")
        ep.write(f"{HOME}/a.txt", "h")
        return ep.tree()

    @staticmethod
    def _untouched(ep: SFTPEndpoint, before: list[str]) -> None:
        assert ep.tree() == before
        assert ep.disk("/data/a.txt").read_text() == "a"
        assert ep.disk(f"{HOME}/a.txt").read_text() == "h"

    @SAME_FILE
    async def test_fail_the_block(
        self,
        sftp_server: SFTPServerStarter,
        log: LogRecorder,
        source: str,
        destination: str,
        target: str,
    ) -> None:
        ep = await sftp_server(RenameUnsupported)
        before = self._seed(ep)
        params = ep.params("move", source=source, destination=destination)
        with pytest.raises(ValueError, match=_exact(_holding_message(source, target))):
            await ep.run(params, log)
        self._untouched(ep, before)
        assert log == []

    @SAME_FILE
    async def test_record(
        self,
        sftp_server: SFTPServerStarter,
        log: LogRecorder,
        source: str,
        destination: str,
        target: str,
    ) -> None:
        ep = await sftp_server(RenameUnsupported)
        before = self._seed(ep)
        params = ep.params(
            "move",
            source=source,
            destination=destination,
            if_exists="overwrite",
            on_error="record",
        )
        out = await ep.run(params, log)
        message = _holding_message(source, target)
        assert out == _recorded(message, "Conflict")
        self._untouched(ep, before)
        assert log == _conflict(message)

    async def test_refused_with_posix_rename_too(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        before = self._seed(ep)
        params = ep.params("move", source="/data/a.txt", destination="/data/")
        with pytest.raises(
            ValueError, match=_exact(_holding_message("/data/a.txt", "/data/a.txt"))
        ):
            await ep.run(params, log)
        self._untouched(ep, before)


class TestReplaceItBesideTheSource:
    """Replace it still removes a target that neither is the source nor holds it (SFTP-5)."""

    async def test_a_folder_whose_path_prefixes_the_source_is_replaced(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/data/dirs/dir/x.txt", "new")
        ep.write("/data/dir/old.txt", "old")
        params = ep.params("move", source="/data/dirs/dir", destination="/data/")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/data") == ["dir/", "dir/x.txt", "dirs/"]
        assert ep.disk("/data/dir/x.txt").read_text() == "new"
        assert log == _moved("/data/dirs/dir", "/data/dir")

    async def test_a_link_at_the_target_is_compared_as_itself(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/data/dir/x.txt", "x")
        ep.mkdir("/archive")
        ep.disk("/archive/dir").symlink_to("../data")
        params = ep.params("move", source="/data/dir", destination="/archive/")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/data") == []
        assert ep.tree("/archive") == ["dir/", "dir/x.txt"]
        assert ep.disk("/archive/dir/x.txt").read_text() == "x"
        assert log == _moved("/data/dir", "/archive/dir")


def _home_or_root_message(source: str) -> str:
    return (
        f"{source} names the account's home, a folder above it or the SFTP server's root folder "
        "and cannot be moved"
    )


HOME_OR_ABOVE = pytest.mark.parametrize(
    "source", ["/home", "/", ".", "..", HOME, f"{HOME}/", "/data/../home"]
)


class TestSourceHomeOrRoot:
    """A Source resolving to the root, the home or a folder above it is refused (SFTP-5)."""

    @staticmethod
    def _seed(ep: SFTPEndpoint) -> list[str]:
        ep.write(f"{HOME}/keep.txt", "k")
        ep.write("/data/x.txt", "x")
        ep.mkdir("/archive")
        return ep.tree()

    @HOME_OR_ABOVE
    async def test_fail_the_block(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, source: str
    ) -> None:
        ep = sftp_endpoint
        before = self._seed(ep)
        params = ep.params("move", source=source, destination="/archive/")
        with pytest.raises(ValueError, match=_exact(_home_or_root_message(source))):
            await ep.run(params, log)
        assert ep.tree() == before
        assert ep.disk(f"{HOME}/keep.txt").read_text() == "k"
        assert log == []

    @HOME_OR_ABOVE
    async def test_record(self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, source: str) -> None:
        ep = sftp_endpoint
        before = self._seed(ep)
        params = ep.params("move", source=source, destination="/archive/", on_error="record")
        out = await ep.run(params, log)
        message = _home_or_root_message(source)
        assert out == _recorded(message, "Refused")
        assert ep.tree() == before
        assert log == [("WARN", f"Move failed (Refused): {message}")]

    async def test_a_link_to_the_home_moves_as_a_link(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write(f"{HOME}/keep.txt", "k")
        ep.mkdir("/data")
        ep.disk("/data/home-link").symlink_to("../home/wave")
        params = ep.params("move", source="/data/home-link", destination="/archive/")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/archive") == ["home-link"]
        assert ep.disk("/archive/home-link").is_symlink()
        assert ep.tree(HOME) == ["keep.txt"]
        assert log == _moved("/data/home-link", "/archive/home-link")


class TestSourceNormalized:
    """Move lands the Source under the name of its normalized path; . and .. fold first."""

    async def test_a_trailing_dot_lands_under_the_folder_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/data/dir/x.txt", "x")
        ep.write("/other/keep.txt", "k")
        params = ep.params("move", source="/data/dir/.", destination="/other/")
        out = await ep.run(params, log)
        assert out == PASSED
        assert ep.tree("/data") == []
        assert ep.tree("/other") == ["dir/", "dir/x.txt", "keep.txt"]
        assert ep.disk("/other/keep.txt").read_text() == "k"
        assert log == _moved("/data/dir/.", "/other/dir")

    async def test_a_trailing_dot_into_an_existing_folder_by_name(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/data/dir/x.txt", "x")
        ep.write("/other/keep.txt", "k")
        params = ep.params("move", source="/data/dir/.", destination="/other")
        await ep.run(params, log)
        assert ep.tree("/other") == ["dir/", "dir/x.txt", "keep.txt"]
        assert log == _moved("/data/dir/.", "/other/dir")

    async def test_a_trailing_dot_dot_moves_the_parent(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/data/dir/x.txt", "x")
        ep.write("/data/y.txt", "y")
        ep.write("/other/keep.txt", "k")
        params = ep.params("move", source="/data/dir/..", destination="/other/")
        out = await ep.run(params, log)
        assert out == PASSED
        assert not ep.disk("/data").exists()
        assert ep.tree("/other") == [
            "data/",
            "data/dir/",
            "data/dir/x.txt",
            "data/y.txt",
            "keep.txt",
        ]
        assert log == _moved("/data/dir/..", "/other/data")

    async def test_doubled_slashes_and_dots_fold(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/data/dir/x.txt", "x")
        ep.mkdir("/other")
        params = ep.params("move", source="//data/./dir//", destination="/other/")
        await ep.run(params, log)
        assert ep.tree("/other") == ["dir/", "dir/x.txt"]
        assert log == _moved("//data/./dir//", "/other/dir")
