"""Shared SFTP test furniture: a real chrooted loopback SFTP server, a live session on it,
WAVE-side folders, a log recorder and the execution context the block reads.

The server root is `/` as the client sees it and the account's home is `/home/wave`
below it, so a relative server path starts in the home and `realpath('.')` answers
`/home/wave`. The session is opened by WAVE's own connect path under the strict host
key policy, with the server in WAVE's trusted SSH hosts list (REQ-4.5.14). Server
classes below change one behavior each; start one with the `sftp_server` factory.
Fixtures live here and are never imported into test modules.
"""

import asyncio
import os
import posixpath
import stat
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import AsyncExitStack, asynccontextmanager, contextmanager, suppress
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any

import asyncssh
import pytest

from tests.plugins.ssh.conftest import (
    HOST_KEY,
    NoAuthServer,
    exits_immediately,
    ssh_server,
    trust_host,
)
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.core.table import Table
from wavecore.plugins._ssh_session import open_connection
from wavecore.plugins.sftp import SFTPPlugin

HOME = "/home/wave"
SESSION_ID = "ssh_session_sftp"
SFTP_HOST = "127.0.0.1"
MKDIR_REFUSAL = "Folder creation refused by the test server"
UNSAFE_NAME = b"../escaped.txt"
# A stalled handler goes on after this long unless a test shortens it (ServerState.hold_seconds).
HOLD_SECONDS = 30.0


@dataclass
class ServerState:
    """What every SFTP server channel of one endpoint shares with the test."""

    root: Path
    stalled: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)
    hold_seconds: float = HOLD_SECONDS

    async def hold(self, channel: Any) -> None:
        """Signal `stalled`; wait for `release`, a closed channel or `hold_seconds`."""
        self.stalled.set()
        with suppress(TimeoutError):
            async with asyncio.timeout(self.hold_seconds):
                while not (self.release.is_set() or channel.is_closing()):
                    await asyncio.sleep(0.01)


class WaveSFTPServer(asyncssh.SFTPServer):
    """A server chrooted at the endpoint root whose relative paths start in HOME."""

    def __init__(self, chan: Any, state: ServerState) -> None:
        super().__init__(chan, chroot=str(state.root).encode())
        self.state = state

    def map_path(self, path: bytes) -> bytes:
        if not path.startswith(b"/"):
            path = posixpath.join(HOME.encode(), path)
        return super().map_path(path)


class UnsafeName(WaveSFTPServer):
    """Every folder listing also names `unsafe_name`, as a hostile server could."""

    unsafe_name: bytes = UNSAFE_NAME

    async def scandir(self, path: bytes) -> AsyncIterator[asyncssh.SFTPName]:
        async for name in super().scandir(path):
            yield name
        attrs = asyncssh.SFTPAttrs(
            type=asyncssh.FILEXFER_TYPE_REGULAR, size=7, permissions=0o100644, mtime=0, atime=0
        )
        yield asyncssh.SFTPName(self.unsafe_name, attrs=attrs)


class RenameUnsupported(WaveSFTPServer):
    """posix-rename answers OP_UNSUPPORTED; plain rename still works."""

    def posix_rename(self, oldpath: bytes, newpath: bytes) -> None:
        raise asyncssh.SFTPOpUnsupported("posix-rename is not supported")


class MkdirRefused(WaveSFTPServer):
    """Every mkdir answers FX_FAILURE with MKDIR_REFUSAL."""

    def mkdir(self, path: bytes, attrs: asyncssh.SFTPAttrs) -> None:
        raise asyncssh.SFTPFailure(MKDIR_REFUSAL)


class SlowRead(WaveSFTPServer):
    """Every read stalls (ServerState.hold), so a download is caught mid-transfer."""

    async def read(self, file_obj: object, offset: int, size: int) -> bytes:
        await self.state.hold(self.channel)
        return super().read(file_obj, offset, size)


class SlowWrite(WaveSFTPServer):
    """Every write stalls (ServerState.hold), so an upload is caught mid-transfer."""

    async def write(self, file_obj: object, offset: int, data: bytes) -> int:
        await self.state.hold(self.channel)
        return super().write(file_obj, offset, data)


class DropsOnRead(WaveSFTPServer):
    """The first read closes the SSH connection, so a download loses its session mid-transfer."""

    async def read(self, file_obj: object, offset: int, size: int) -> bytes:
        self.connection.close()
        await self.state.hold(self.channel)
        return b""


class _TrackedServer(NoAuthServer):
    """Keeps each accepted server-side connection so teardown and `drop` can close it."""

    def __init__(self, connections: list[Any]) -> None:
        self._connections = connections

    def connection_made(self, conn: Any) -> None:
        self._connections.append(conn)


@dataclass(frozen=True)
class WaveDirs:
    """The WAVE side: where a relative path starts, the run's artifacts and Test Data."""

    home: Path
    artifacts: Path
    testdata: Path


def sftp_context(
    params: dict[str, Any],
    logger: Any,
    *,
    registry: SSHSessionRegistry | None = None,
    wave: WaveDirs | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """The context SFTPPlugin.execute reads; `extra` adds or overrides keys (None drops one)."""
    context: dict[str, Any] = {"parameters": params, "logger": logger, "variables": {}}
    if registry is not None:
        context["ssh_session_registry"] = registry
    if wave is not None:
        context["artifacts_dir"] = str(wave.artifacts)
        context["testdata_dirs"] = [str(wave.testdata)]
    context.update(extra)
    return context


@dataclass
class SFTPEndpoint:
    """A live loopback SFTP server plus one open WAVE SSH session to it."""

    port: int
    root: Path
    state: ServerState
    registry: SSHSessionRegistry
    connection: Any
    wave: WaveDirs
    server_connections: list[Any]
    session_id: str = SESSION_ID
    host: str = SFTP_HOST

    @property
    def home(self) -> Path:
        """The account's home folder on disk (HOME as the client sees it)."""
        return self.disk(HOME)

    def disk(self, path: str) -> Path:
        """Where a server path lives on disk: absolute from the root, relative from HOME."""
        resolved = posixpath.normpath(posixpath.join(HOME, path))
        return self.root / resolved.lstrip("/")

    def write(self, path: str, data: bytes | str = b"") -> Path:
        """Seed a server file (parents created) and return where it lives on disk."""
        target = self.disk(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data.encode() if isinstance(data, str) else data)
        return target

    def mkdir(self, path: str) -> Path:
        """Seed a server folder (parents created) and return where it lives on disk."""
        target = self.disk(path)
        target.mkdir(parents=True, exist_ok=True)
        return target

    def tree(self, path: str = "/") -> list[str]:
        """Every entry below a server folder, as `tree` lists it."""
        return tree(self.disk(path))

    def params(self, operation: str, **rows: Any) -> dict[str, Any]:
        """The block's parameters: this session, the operation and the given rows."""
        return {"session_id": self.session_id, "operation": operation, **rows}

    def context(self, params: dict[str, Any], logger: Any, **extra: Any) -> dict[str, Any]:
        """The execution context with this session's registry and the WAVE folders."""
        return sftp_context(params, logger, registry=self.registry, wave=self.wave, **extra)

    async def run(self, params: dict[str, Any], logger: Any, **extra: Any) -> dict[str, Any]:
        """Run the SFTP block against this endpoint and return its outputs."""
        outputs: dict[str, Any] = await SFTPPlugin().execute(self.context(params, logger, **extra))
        return outputs

    @asynccontextmanager
    async def client(self) -> AsyncIterator[asyncssh.SFTPClient]:
        """A separate SFTP channel on the session, for a test's own look at the server."""
        async with self.connection.start_sftp_client() as sftp:
            yield sftp

    def drop(self) -> None:
        """Close every server-side SSH connection now, as a server that goes away does."""
        for conn in self.server_connections:
            conn.close()


SFTPServerStarter = Callable[..., Awaitable[SFTPEndpoint]]


def tree(folder: Path) -> list[str]:
    """Every entry below a folder, posix-relative and sorted; folders end with / (links are not)."""
    entries: list[str] = []
    for current, folders, files in os.walk(folder):
        relative = Path(current).relative_to(folder).as_posix()
        prefix = "" if relative == "." else f"{relative}/"
        for name in folders:
            link = os.path.islink(os.path.join(current, name))
            entries.append(f"{prefix}{name}" if link else f"{prefix}{name}/")
        entries.extend(f"{prefix}{name}" for name in files)
    return sorted(entries)


@contextmanager
def read_only(path: Path) -> Iterator[Path]:
    """Make a file or folder read-only for the test's body, then restore its mode."""
    mode = stat.S_IMODE(path.stat().st_mode)
    path.chmod(0o555 if path.is_dir() else 0o444)
    try:
        yield path
    finally:
        path.chmod(mode)


def rows(table: Table) -> list[list[Any]]:
    """A materialized table's rows as plain lists."""
    return [row.to_list() for row in table]


def columns(table: Table) -> list[tuple[str, str]]:
    """A materialized table's (name, type) columns in order."""
    return list(zip(table.col_names(), table.col_types(), strict=True))


class LogRecorder(list[tuple[str, str]]):
    """A context logger whose debug/info/warn/error calls record (LEVEL, message)."""

    def __call__(self, level: str, message: str) -> None:
        self.append((level, message))

    def __getattr__(self, name: str) -> Callable[[str], None]:
        if name not in ("debug", "info", "warn", "error"):
            raise AttributeError(name)
        return partial(self, name.upper())


def _restore_writable(root: Path) -> None:
    """Undo any read-only mode a test left behind, so the temporary folder can be removed."""
    for current, _folders, _files in os.walk(root):
        with suppress(OSError):
            os.chmod(current, 0o755)


@asynccontextmanager
async def _endpoint(
    root: Path, wave: WaveDirs, server_class: type[WaveSFTPServer], subsystem: bool
) -> AsyncIterator[SFTPEndpoint]:
    (root / HOME.lstrip("/")).mkdir(parents=True)
    state = ServerState(root)
    tracked: list[Any] = []
    options: dict[str, Any] = {"process_factory": exits_immediately}
    if subsystem:
        options["sftp_factory"] = partial(_new_server, server_class, state)
    async with ssh_server(partial(_TrackedServer, tracked), **options) as port:
        trust_host(SFTP_HOST, port, HOST_KEY)
        opened = await open_connection(
            {
                "host": SFTP_HOST,
                "port": port,
                "username": "wave",
                "host_key_verification": "strict",
            },
            None,
        )
        connection = opened.connection
        registry = SSHSessionRegistry()
        registry.register(SESSION_ID, connection, None, SFTP_HOST, None, None, connect_timeout=30)
        try:
            yield SFTPEndpoint(port, root, state, registry, connection, wave, tracked)
        finally:
            state.release.set()
            registry.close_all()
            connection.close()
            await connection.wait_closed()
            for conn in tracked:
                conn.close()
                await conn.wait_closed()
            _restore_writable(root)


def _new_server(
    server_class: type[WaveSFTPServer], state: ServerState, chan: Any
) -> WaveSFTPServer:
    return server_class(chan, state)


@pytest.fixture(autouse=True)
def isolated_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Point HOME at an empty folder so the account's own SSH config and keys never load."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    yield home


@pytest.fixture
def wave_dirs(tmp_path: Path, server_home: Path) -> WaveDirs:
    """The WAVE side: where relative paths start, an empty artifacts and Test Data folder."""
    artifacts = tmp_path / "artifacts"
    testdata = tmp_path / "testdata"
    artifacts.mkdir()
    testdata.mkdir()
    return WaveDirs(server_home, artifacts, testdata)


@pytest.fixture
def log() -> LogRecorder:
    return LogRecorder()


@pytest.fixture
async def sftp_server(tmp_path: Path, wave_dirs: WaveDirs) -> AsyncIterator[SFTPServerStarter]:
    """Start endpoints: `await sftp_server(server_class=WaveSFTPServer, subsystem=True)`."""
    started = 0

    async def start(
        server_class: type[WaveSFTPServer] = WaveSFTPServer, *, subsystem: bool = True
    ) -> SFTPEndpoint:
        nonlocal started
        started += 1
        root = tmp_path / ("server" if started == 1 else f"server{started}")
        return await stack.enter_async_context(_endpoint(root, wave_dirs, server_class, subsystem))

    async with AsyncExitStack() as stack:
        yield start


@pytest.fixture
async def sftp_endpoint(sftp_server: SFTPServerStarter) -> SFTPEndpoint:
    """The plain server: a chrooted SFTP server with HOME below its root."""
    return await sftp_server()


@pytest.fixture
async def sftp_endpoint_without_subsystem(sftp_server: SFTPServerStarter) -> SFTPEndpoint:
    """An SSH server with no sftp subsystem: starting SFTP fails with Session request failed."""
    return await sftp_server(subsystem=False)


@pytest.fixture
async def sftp_endpoint_unsafe_name(sftp_server: SFTPServerStarter) -> SFTPEndpoint:
    """A server whose every folder listing also names UNSAFE_NAME, which holds a /."""
    return await sftp_server(UnsafeName)
