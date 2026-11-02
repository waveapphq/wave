"""SFTP failure and safety paths, Timeout and Stop (REQ-3.4.1.8, SFTP-7, SFTP-8)."""

import asyncio
import os
import posixpath
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

import asyncssh
import pytest

from tests.plugins.sftp.conftest import (
    SESSION_ID,
    SFTP_HOST,
    DropsOnRead,
    LogRecorder,
    MkdirRefused,
    SFTPEndpoint,
    SFTPServerStarter,
    SlowRead,
    SlowWrite,
    UnsafeName,
    WaveDirs,
    WaveSFTPServer,
    columns,
    read_only,
    rows,
    tree,
)
from wavecore.core.table import Table

SUMMARY_COLUMNS = [("source", "string"), ("destination", "string"), ("size", "integer")]
ENTRY_COLUMNS = [
    ("name", "string"),
    ("path", "string"),
    ("type", "string"),
    ("modified", "string"),
    ("size", "integer"),
]
EMPTIES: dict[str, dict[str, Any]] = {
    "upload": {"summary": (SUMMARY_COLUMNS, [])},
    "download": {"summary": (SUMMARY_COLUMNS, [])},
    "list": {"entries": (ENTRY_COLUMNS, []), "count": 0},
    "stats": {"exists": False, "type": "", "size": 0, "modified": ""},
    "delete": {},
    "move": {},
    "create_folder": {},
}
LABELS = {
    "upload": "Upload",
    "download": "Download",
    "list": "List",
    "stats": "Stats",
    "delete": "Delete",
    "move": "Move",
    "create_folder": "Create folder",
}
MISSING_SESSION = "ssh_session_missing"
UNSAFE_RULE = "a name holding / or \\ could land outside the destination"
STALL_BOUND = 5.0
STOP_BOUND = 3.0
TIMEOUT = 1
# The whole block, cleanup included, ends this soon after Timeout, far below the 30 s stall.
TIMEOUT_BOUND = TIMEOUT + 2.0


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _plain(outputs: dict[str, Any]) -> dict[str, Any]:
    """Outputs with each table shown as (columns, rows), so a whole result compares with ==."""
    return {
        name: (columns(value), rows(value)) if isinstance(value, Table) else value
        for name, value in outputs.items()
    }


def _recorded(
    operation: str, message: str, reason: str, summary: list[list[Any]] | None = None
) -> dict[str, Any]:
    """A recorded failure: the operation's empties (completed Summary rows kept), failed core."""
    empties = dict(EMPTIES[operation])
    if summary is not None:
        empties["summary"] = (SUMMARY_COLUMNS, summary)
    return {
        **empties,
        "success": False,
        "error": message,
        "reason": reason,
        "__block_warning": True,
    }


def _warned(operation: str, reason: str, message: str) -> tuple[str, str]:
    return ("WARN", f"{LABELS[operation]} failed ({reason}): {message}")


def _not_found(session_id: str) -> str:
    return f"SSH session '{session_id}' not found or already closed"


def _unavailable(detail: str) -> str:
    return f"SFTP is not available on {SFTP_HOST} through SSH session '{SESSION_ID}': {detail}"


def _unsafe(name: str, folder: str) -> str:
    return f"Unsafe entry name {name!r} in {folder} on the SFTP server: {UNSAFE_RULE}"


def _lost(operation: str, detail: str) -> str:
    return f"SSH session '{SESSION_ID}' to {SFTP_HOST} was lost during {operation}: {detail}"


def _seed(folder: Path, files: dict[str, str]) -> Path:
    """Write WAVE files below a folder and return it."""
    for name, text in files.items():
        target = folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    return folder


class BackslashName(UnsafeName):
    unsafe_name = b"a\\b"


class EmptyName(UnsafeName):
    unsafe_name = b""


class VanishesOnOpen(WaveSFTPServer):
    """`b.txt` is removed from the server just as the client opens it, after the walk saw it."""

    def open(self, path: bytes, pflags: int, attrs: asyncssh.SFTPAttrs) -> Any:
        if posixpath.basename(path) == b"b.txt":
            os.unlink(self.map_path(path))
        return super().open(path, pflags, attrs)


def _removes_on_open(name: str, victim: Path) -> type[WaveSFTPServer]:
    """A server that deletes a WAVE file when the client opens `name`, as another user could."""

    class RemovesOnOpen(WaveSFTPServer):
        def open(self, path: bytes, pflags: int, attrs: asyncssh.SFTPAttrs) -> Any:
            if posixpath.basename(path) == name.encode():
                victim.unlink()
            return super().open(path, pflags, attrs)

    return RemovesOnOpen


@asynccontextmanager
async def _stalled(
    ep: SFTPEndpoint, params: dict[str, Any], log: LogRecorder
) -> AsyncIterator[asyncio.Task[dict[str, Any]]]:
    """Run the block until the server stalls mid-transfer; the stall is released only on exit."""
    task = asyncio.create_task(ep.run(params, log))
    stalled = asyncio.create_task(ep.state.stalled.wait())
    try:
        await asyncio.wait(
            {task, stalled}, timeout=STALL_BOUND, return_when=asyncio.FIRST_COMPLETED
        )
        if task.done():
            task.result()
        assert ep.state.stalled.is_set()
        yield task
    finally:
        stalled.cancel()
        ep.state.release.set()
        task.cancel()
        with suppress(Exception, asyncio.CancelledError):
            await task


async def _ends_within(task: asyncio.Task[Any], seconds: float) -> None:
    """The task ends on its own within `seconds`; it is never canceled here."""
    done, _ = await asyncio.wait({task}, timeout=seconds)
    assert done == {task}


async def _still_usable(ep: SFTPEndpoint, folder: str) -> None:
    """A later block on the same session still reaches the server."""
    run = ep.run(ep.params("stats", path=folder), LogRecorder())
    outputs = await asyncio.wait_for(run, STOP_BOUND)
    assert (outputs["success"], outputs["exists"], outputs["type"]) == (True, True, "folder")


def _partials(folder: Path) -> list[str]:
    return [entry for entry in tree(folder) if entry.endswith(".part")]


def _mid_transfer_download(ep: SFTPEndpoint, **settings: Any) -> dict[str, Any]:
    """`a.txt` is empty and lands at once; `b.txt` is caught mid-transfer by the stalled read."""
    ep.write("/outbound/a.txt", b"")
    ep.write("/outbound/b.txt", b"bravo")
    return ep.params("download", source="/outbound", destination="in/", **settings)


def _mid_transfer_upload(ep: SFTPEndpoint, **settings: Any) -> dict[str, Any]:
    """`a.csv` is empty and lands at once; `b.csv` is caught mid-transfer by the stalled write."""
    ep.mkdir("/inbound")
    _seed(ep.wave.testdata / "batch", {"a.csv": "", "b.csv": "bravo"})
    return ep.params("upload", source="testdata://batch", destination="/inbound/", **settings)


SESSION_ROWS: dict[str, dict[str, str]] = {
    "upload": {"source": "testdata://orders.csv", "destination": "/inbound/"},
    "download": {"source": "/outbound/orders.out", "destination": ""},
    "list": {"path": "/outbound"},
    "stats": {"path": "/outbound/orders.out"},
    "delete": {"path": "/outbound/orders.out"},
    "move": {"source": "/outbound/orders.out", "destination": "/archive/"},
    "create_folder": {"path": "/archive"},
}


class TestSession:
    """No live session under Session ID follows On error with SessionClosed."""

    async def test_unknown_session_id_fails_the_block(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        params = sftp_endpoint.params("list", path="/", session_id=MISSING_SESSION)
        with pytest.raises(ValueError, match=_exact(_not_found(MISSING_SESSION))):
            await sftp_endpoint.run(params, log)
        assert log == []

    async def test_closed_session_fails_the_block(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        sftp_endpoint.registry.close(SESSION_ID)
        params = sftp_endpoint.params("list", path="/")
        with pytest.raises(ValueError, match=_exact(_not_found(SESSION_ID))):
            await sftp_endpoint.run(params, log)

    async def test_no_registry_in_the_context_fails_the_block(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        params = sftp_endpoint.params("list", path="/")
        with pytest.raises(ValueError, match=_exact(_not_found(SESSION_ID))):
            await sftp_endpoint.run(params, log, ssh_session_registry=None)

    @pytest.mark.parametrize("operation", list(SESSION_ROWS))
    async def test_missing_session_is_recorded_with_the_empties_of_each_operation(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder, operation: str
    ) -> None:
        _seed(sftp_endpoint.wave.testdata, {"orders.csv": "a,b\n"})
        params = sftp_endpoint.params(
            operation, session_id=MISSING_SESSION, on_error="record", **SESSION_ROWS[operation]
        )
        message = _not_found(MISSING_SESSION)
        outputs = await sftp_endpoint.run(params, log)
        assert _plain(outputs) == _recorded(operation, message, "SessionClosed")
        assert log == [_warned(operation, "SessionClosed", message)]
        assert tree(sftp_endpoint.wave.artifacts) == []


class TestChannel:
    """A server or connection that will not start SFTP follows On error with SftpUnavailable."""

    async def test_server_without_the_sftp_subsystem_fails_the_block(
        self, sftp_endpoint_without_subsystem: SFTPEndpoint, log: LogRecorder
    ) -> None:
        params = sftp_endpoint_without_subsystem.params("list", path="/")
        message = _unavailable("Session request failed")
        with pytest.raises(ValueError, match=_exact(message)):
            await sftp_endpoint_without_subsystem.run(params, log)
        assert log == []

    async def test_server_without_the_sftp_subsystem_is_recorded(
        self, sftp_endpoint_without_subsystem: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint_without_subsystem
        params = ep.params("stats", path="/outbound", on_error="record")
        message = _unavailable("Session request failed")
        outputs = await ep.run(params, log)
        assert _plain(outputs) == _recorded("stats", message, "SftpUnavailable")
        assert log == [_warned("stats", "SftpUnavailable", message)]

    async def test_connection_dropped_before_the_channel_opens_fails_the_block(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        sftp_endpoint.drop()
        await asyncio.wait_for(sftp_endpoint.connection.wait_closed(), STOP_BOUND)
        params = sftp_endpoint.params("list", path="/")
        with pytest.raises(ValueError, match=_exact(_unavailable("SSH connection closed"))):
            await sftp_endpoint.run(params, log)


class TestUnsafeEntryName:
    """A folder download refuses a server entry name that could land outside the destination."""

    async def test_name_holding_a_slash_fails_the_block(
        self, sftp_endpoint_unsafe_name: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint_unsafe_name
        ep.write("/outbound/a.txt", "alpha")
        params = ep.params("download", source="/outbound", destination="")
        with pytest.raises(ValueError, match=_exact(_unsafe("../escaped.txt", "/outbound"))):
            await ep.run(params, log)
        assert (tree(ep.wave.artifacts), tree(ep.wave.home), log) == ([], [], [])

    @pytest.mark.parametrize(
        ("server_class", "name"),
        [
            pytest.param(BackslashName, "a\\b", id="backslash"),
            pytest.param(EmptyName, "", id="empty"),
        ],
    )
    async def test_name_holding_a_backslash_or_empty_fails_the_block(
        self,
        sftp_server: SFTPServerStarter,
        log: LogRecorder,
        server_class: type[WaveSFTPServer],
        name: str,
    ) -> None:
        ep = await sftp_server(server_class)
        ep.write("/outbound/a.txt", "alpha")
        params = ep.params("download", source="/outbound", destination="")
        with pytest.raises(ValueError, match=_exact(_unsafe(name, "/outbound"))):
            await ep.run(params, log)
        assert (tree(ep.wave.artifacts), tree(ep.wave.home)) == ([], [])

    async def test_unsafe_name_is_recorded(
        self, sftp_endpoint_unsafe_name: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint_unsafe_name
        ep.write("/outbound/a.txt", "alpha")
        params = ep.params("download", source="/outbound", destination="", on_error="record")
        message = _unsafe("../escaped.txt", "/outbound")
        outputs = await ep.run(params, log)
        assert _plain(outputs) == _recorded("download", message, "UnsafeEntry")
        assert log == [_warned("download", "UnsafeEntry", message)]
        assert tree(ep.wave.artifacts) == []


class TestSymbolicLinks:
    """Folder walks on either side skip symbolic links and say so (SFTP-7)."""

    async def test_folder_download_skips_a_server_link(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "alpha")
        ep.write("/elsewhere/secret.txt", "secret")
        os.symlink("../elsewhere", ep.disk("/outbound/linked"))
        params = ep.params("download", source="/outbound", destination="in/")
        outputs = await ep.run(params, log)
        target = ep.wave.home / "in" / "outbound" / "a.txt"
        assert rows(outputs["summary"]) == [["/outbound/a.txt", str(target), 5]]
        assert tree(ep.wave.home) == ["in/", "in/outbound/", "in/outbound/a.txt"]
        assert log == [
            ("INFO", "Skipped symbolic link /outbound/linked"),
            ("INFO", "Downloaded 1 file, 5 bytes, from /outbound to in/"),
        ]

    async def test_folder_upload_skips_a_wave_link(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.mkdir("/inbound")
        batch = _seed(ep.wave.testdata / "batch", {"a.csv": "a,b\n"}).resolve()
        os.symlink("a.csv", batch / "linked.csv")
        params = ep.params("upload", source="testdata://batch", destination="/inbound/")
        outputs = await ep.run(params, log)
        assert rows(outputs["summary"]) == [[str(batch / "a.csv"), "/inbound/batch/a.csv", 4]]
        assert ep.tree("/inbound") == ["batch/", "batch/a.csv"]
        assert log == [
            ("INFO", f"Skipped symbolic link {batch / 'linked.csv'}"),
            ("INFO", "Uploaded 1 file, 4 bytes, from testdata://batch to /inbound/"),
        ]


class TestServerSideFailures:
    """asyncssh errors map to one message per kind, naming the server path the call named."""

    async def test_read_only_server_folder_fails_the_upload(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        _seed(ep.wave.testdata, {"orders.csv": "a,b\n"})
        params = ep.params(
            "upload", source="testdata://orders.csv", destination="/inbound/orders.csv"
        )
        message = "Permission denied on the SFTP server: /inbound/orders.csv"
        with read_only(ep.mkdir("/inbound")):
            with pytest.raises(ValueError, match=_exact(message)):
                await ep.run(params, log)
        assert ep.tree("/inbound") == []

    async def test_unreadable_server_file_is_recorded(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/secret.txt", "alpha").chmod(0)
        params = ep.params(
            "download", source="/outbound/secret.txt", destination="got.txt", on_error="record"
        )
        message = "Permission denied on the SFTP server: /outbound/secret.txt"
        outputs = await ep.run(params, log)
        assert _plain(outputs) == _recorded("download", message, "PermissionDenied")
        assert log == [_warned("download", "PermissionDenied", message)]
        assert tree(ep.wave.home) == []

    async def test_file_gone_mid_download_is_recorded_and_completed_rows_are_kept(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(VanishesOnOpen)
        ep.write("/outbound/a.txt", "alpha")
        ep.write("/outbound/b.txt", "bravo")
        params = ep.params("download", source="/outbound", destination="in/", on_error="record")
        message = "Not found on the SFTP server: /outbound/b.txt"
        outputs = await ep.run(params, log)
        landed = ep.wave.home / "in" / "outbound" / "a.txt"
        kept = [["/outbound/a.txt", str(landed), 5]]
        assert _plain(outputs) == _recorded("download", message, "NotFound", kept)
        assert log == [_warned("download", "NotFound", message)]
        assert tree(ep.wave.home) == ["in/", "in/outbound/", "in/outbound/a.txt"]

    async def test_file_gone_mid_download_fails_the_block_and_keeps_completed_files(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(VanishesOnOpen)
        ep.write("/outbound/a.txt", "alpha")
        ep.write("/outbound/b.txt", "bravo")
        params = ep.params("download", source="/outbound", destination="in/")
        message = "Not found on the SFTP server: /outbound/b.txt"
        with pytest.raises(ValueError, match=_exact(message)):
            await ep.run(params, log)
        assert tree(ep.wave.home) == ["in/", "in/outbound/", "in/outbound/a.txt"]
        assert (ep.wave.home / "in" / "outbound" / "a.txt").read_text() == "alpha"

    async def test_connection_lost_mid_download_fails_the_block(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(DropsOnRead)
        ep.write("/outbound/a.txt", "alpha")
        params = ep.params("download", source="/outbound/a.txt", destination="got.txt")
        with pytest.raises(ValueError, match=_exact(_lost("Download", "Connection closed"))):
            await ep.run(params, log)
        assert (tree(ep.wave.home), log) == ([], [])

    async def test_connection_lost_mid_download_is_recorded(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(DropsOnRead)
        ep.write("/outbound/a.txt", "alpha")
        params = ep.params(
            "download", source="/outbound/a.txt", destination="got.txt", on_error="record"
        )
        message = _lost("Download", "Connection closed")
        outputs = await ep.run(params, log)
        assert _plain(outputs) == _recorded("download", message, "ConnectionLost")
        assert log == [_warned("download", "ConnectionLost", message)]
        assert tree(ep.wave.home) == []

    async def test_refused_create_folder_is_recorded_with_the_server_detail(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(MkdirRefused)
        params = ep.params("create_folder", path="/new", on_error="record")
        message = "The SFTP server refused Create folder on /new: /new is not a directory"
        outputs = await ep.run(params, log)
        assert _plain(outputs) == _recorded("create_folder", message, "ServerFailure")
        assert log == [_warned("create_folder", "ServerFailure", message)]
        assert ep.tree() == ["home/", "home/wave/"]

    async def test_refused_folder_fails_an_upload_that_needs_it(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(MkdirRefused)
        ep.mkdir("/inbound")
        _seed(ep.wave.testdata / "batch", {"a.csv": "a,b\n"})
        params = ep.params("upload", source="testdata://batch", destination="/inbound/batch")
        message = (
            "The SFTP server refused Upload on /inbound/batch: /inbound/batch is not a directory"
        )
        with pytest.raises(ValueError, match=_exact(message)):
            await ep.run(params, log)
        assert ep.tree("/inbound") == []


class TestWaveSideFailures:
    """WAVE disk errors and resolver refusals name the WAVE side and follow On error."""

    async def test_unreadable_wave_source_is_recorded(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.mkdir("/inbound")
        source = _seed(ep.wave.testdata, {"orders.csv": "a,b\n"}).resolve() / "orders.csv"
        source.chmod(0)
        params = ep.params(
            "upload",
            source="testdata://orders.csv",
            destination="/inbound/orders.csv",
            on_error="record",
        )
        message = f"Permission denied on WAVE: {source}"
        outputs = await ep.run(params, log)
        assert _plain(outputs) == _recorded("upload", message, "PermissionDenied")
        assert log == [_warned("upload", "PermissionDenied", message)]
        assert ep.tree("/inbound") == []

    async def test_read_only_wave_folder_fails_the_download(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "alpha")
        locked = ep.wave.home / "locked"
        locked.mkdir()
        params = ep.params("download", source="/outbound/a.txt", destination="locked/")
        message = f"Permission denied on WAVE: {locked / 'a.txt'}"
        with read_only(locked):
            with pytest.raises(ValueError, match=_exact(message)):
                await ep.run(params, log)
        assert tree(locked) == []

    async def test_wave_source_gone_mid_upload_is_recorded_and_completed_rows_are_kept(
        self, sftp_server: SFTPServerStarter, wave_dirs: WaveDirs, log: LogRecorder
    ) -> None:
        batch = _seed(wave_dirs.testdata / "batch", {"a.csv": "alpha", "b.csv": "bravo"}).resolve()
        ep = await sftp_server(_removes_on_open("a.csv", batch / "b.csv"))
        ep.mkdir("/inbound")
        params = ep.params(
            "upload", source="testdata://batch", destination="/inbound/", on_error="record"
        )
        message = f"WAVE could not read {batch / 'b.csv'}: No such file or directory"
        outputs = await ep.run(params, log)
        kept = [[str(batch / "a.csv"), "/inbound/batch/a.csv", 5]]
        assert _plain(outputs) == _recorded("upload", message, "LocalFailure", kept)
        assert log == [_warned("upload", "LocalFailure", message)]
        assert ep.tree("/inbound") == ["batch/", "batch/a.csv"]

    async def test_wave_write_error_fails_the_download(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "alpha")
        # The name fits, but the temporary name the download writes under does not.
        name = "n" * 250
        params = ep.params("download", source="/outbound/a.txt", destination=name)
        message = f"WAVE could not write {ep.wave.home / name}: File name too long"
        with pytest.raises(ValueError, match=_exact(message)):
            await ep.run(params, log)
        assert tree(ep.wave.home) == []

    async def test_download_without_an_artifacts_folder_is_recorded(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        ep.write("/outbound/a.txt", "alpha")
        params = ep.params("download", source="/outbound/a.txt", destination="", on_error="record")
        message = "artifact:// scheme requires artifacts directory, but none configured in context"
        outputs = await ep.run(params, log, artifacts_dir=None)
        assert _plain(outputs) == _recorded("download", message, "LocalFailure")
        assert log == [_warned("download", "LocalFailure", message)]
        assert (tree(ep.wave.home), tree(ep.wave.artifacts)) == ([], [])

    async def test_upload_from_artifacts_without_an_artifacts_folder_fails_the_block(
        self, sftp_endpoint: SFTPEndpoint, log: LogRecorder
    ) -> None:
        ep = sftp_endpoint
        _seed(ep.wave.artifacts, {"orders.csv": "a,b\n"})
        params = ep.params("upload", source="artifact://orders.csv", destination="/inbound/")
        message = "artifact:// scheme requires artifacts directory, but none configured in context"
        with pytest.raises(ValueError, match=_exact(message)):
            await ep.run(params, log, artifacts_dir=None)
        assert ep.tree() == ["home/", "home/wave/"]


class TestStop:
    """Stop ends a stalled transfer at once and leaves no partial file (SFTP-7, SFTP-8)."""

    async def test_stop_mid_download_leaves_no_partial_file_on_wave(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(SlowRead)
        params = _mid_transfer_download(ep)
        async with _stalled(ep, params, log) as task:
            partial = _partials(ep.wave.home)
            assert len(partial) == 1
            assert re.fullmatch(r"in/outbound/\.b\.txt\.[0-9a-f]{8}\.part", partial[0])
            task.cancel()
            await _ends_within(task, STOP_BOUND)
            with pytest.raises(asyncio.CancelledError):
                task.result()
            assert tree(ep.wave.home) == ["in/", "in/outbound/", "in/outbound/a.txt"]
            assert log == []
            await _still_usable(ep, "/outbound")

    async def test_stop_mid_upload_removes_the_partial_file_from_the_server(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(SlowWrite)
        params = _mid_transfer_upload(ep)
        async with _stalled(ep, params, log) as task:
            assert ep.tree("/inbound") == ["batch/", "batch/a.csv", "batch/b.csv"]
            task.cancel()
            await _ends_within(task, STOP_BOUND)
            with pytest.raises(asyncio.CancelledError):
                task.result()
            assert ep.tree("/inbound") == ["batch/", "batch/a.csv"]
            assert log == []
            await _still_usable(ep, "/inbound")


class TestTimeout:
    """Timeout bounds the whole block and ends a stalled transfer at once (SFTP-8)."""

    async def test_timeout_mid_download_fails_the_block(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(SlowRead)
        params = _mid_transfer_download(ep, timeout=TIMEOUT)
        async with _stalled(ep, params, log) as task:
            await _ends_within(task, TIMEOUT_BOUND)
            with pytest.raises(
                ValueError, match=_exact("Download did not finish within 1 seconds")
            ):
                task.result()
            assert tree(ep.wave.home) == ["in/", "in/outbound/", "in/outbound/a.txt"]
            assert log == []
            await _still_usable(ep, "/outbound")

    async def test_timeout_mid_download_is_recorded_and_completed_rows_are_kept(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(SlowRead)
        params = _mid_transfer_download(ep, timeout=TIMEOUT, on_error="record")
        message = "Download did not finish within 1 seconds"
        async with _stalled(ep, params, log) as task:
            await _ends_within(task, TIMEOUT_BOUND)
            landed = ep.wave.home / "in" / "outbound" / "a.txt"
            kept = [["/outbound/a.txt", str(landed), 0]]
            assert _plain(task.result()) == _recorded("download", message, "Timeout", kept)
            assert log == [_warned("download", "Timeout", message)]
            assert tree(ep.wave.home) == ["in/", "in/outbound/", "in/outbound/a.txt"]
            await _still_usable(ep, "/outbound")

    async def test_timeout_mid_upload_fails_the_block(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(SlowWrite)
        params = _mid_transfer_upload(ep, timeout=TIMEOUT)
        async with _stalled(ep, params, log) as task:
            await _ends_within(task, TIMEOUT_BOUND)
            with pytest.raises(ValueError, match=_exact("Upload did not finish within 1 seconds")):
                task.result()
            assert ep.tree("/inbound") == ["batch/", "batch/a.csv"]
            assert log == []
            await _still_usable(ep, "/inbound")

    async def test_timeout_mid_upload_is_recorded_and_completed_rows_are_kept(
        self, sftp_server: SFTPServerStarter, log: LogRecorder
    ) -> None:
        ep = await sftp_server(SlowWrite)
        params = _mid_transfer_upload(ep, timeout=TIMEOUT, on_error="record")
        message = "Upload did not finish within 1 seconds"
        async with _stalled(ep, params, log) as task:
            await _ends_within(task, TIMEOUT_BOUND)
            source = (ep.wave.testdata / "batch").resolve() / "a.csv"
            kept = [[str(source), "/inbound/batch/a.csv", 0]]
            assert _plain(task.result()) == _recorded("upload", message, "Timeout", kept)
            assert log == [_warned("upload", "Timeout", message)]
            assert ep.tree("/inbound") == ["batch/", "batch/a.csv"]
            await _still_usable(ep, "/inbound")
