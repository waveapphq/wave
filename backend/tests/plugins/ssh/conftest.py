"""Shared scaffolding for the SSH plugin specs: plugin context, mocked session
registry, and a real loopback SSH harness.

A mocked connection can never reach the channel-release path, so the timeout and
cancellation specs drive a real asyncssh server on 127.0.0.1: the `loopback_ssh`
fixture yields a live client connection wired to a caller-supplied process
handler, `RecordsTheProcess` wraps that connection so a spec can inspect the
channel the code under test actually opened, `SlowToHandOver` holds a real
channel open past the caller's deadline, and `SignalWatcher` plays a remote
command that never exits and reports the signal it was sent.

Host key verification happens during key exchange, which a mocked connection
never performs, so the `ssh_endpoint` fixture starts the same server and hands
back its port and host key while leaving the connecting to the code under test;
`key_endpoint` does the same for a server that admits only the public keys a spec
authorizes on it (SSH-7). The server building blocks (`HOST_KEY`, `NoAuthServer`,
`ssh_server`, `exits_immediately`) are plain helpers other conftests import.
`isolated_home` points HOME at the `server_home` folder, so the account WAVE runs
under has one home for its relative paths and its own SSH files, and the
machine's real SSH files never reach a spec. `trust_host` and `trusted_entries`
seed and read WAVE's trusted SSH hosts list in the data folder; `set_lock` saves
Lock trusted hosts into the config, where the policy lives, and `ssh_hosts_config`
is that policy as config file content (REQ-4.5.14).

Tunnel channels: `forwarding_ssh` yields a live client connection to a server that
forwards direct-tcpip or refuses it with a chosen code and reason, and
`channel_connection` is the mocked stand-in whose channels reach a loopback port,
are refused by code, hang on a gate, or meet a closed connection.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock

import asyncssh
import pytest
import yaml

from tests.plugins.netcat.conftest import WriterProbe
from wavecore.api.services.storage_paths import get_base_path
from wavecore.core.ssh.session_registry import SSHSessionRegistry

HOST_KEY = asyncssh.generate_private_key("ssh-ed25519")

ProcessHandler = Callable[[Any], Awaitable[None]]
LoopbackSSH = Callable[[ProcessHandler], AbstractAsyncContextManager[Any]]

SESSION_ID = "ssh_session_abc123"

NOT_TRUSTED_STRICT = (
    "the host is not in WAVE's trusted hosts list and the host key policy is 'strict'. "
    "Add it in Settings > Network > SSH Hosts"
)
NOT_TRUSTED_LOCKED = (
    "the host is not in WAVE's trusted hosts list and trusted hosts are locked. "
    "Add it in Settings > Network > SSH Hosts"
)
KEY_CHANGED = (
    "the host offered a key that differs from the one in WAVE's trusted hosts list. "
    "Check Settings > Network > SSH Hosts"
)


def host_key_refusal(target: str, detail: str) -> str:
    """The whole refusal a host key check reports for `target` (REQ-4.5.14)."""
    return f"SSH host key verification failed for {target}: {detail}"


def public_key_text(key: Any) -> str:
    """A key's OpenSSH public form, `<algorithm> <base64>`, as WAVE's list stores it."""
    return str(key.convert_to_public().export_public_key("openssh").decode().strip())


def ssh_hosts_file() -> Path:
    """WAVE's trusted SSH hosts list inside the data folder."""
    return get_base_path() / "network" / "ssh_hosts.yaml"


def trust_host(host: str, port: int, key: Any) -> None:
    """Add one host and its key to WAVE's trusted SSH hosts list."""
    from wavecore.core.ssh import trusted_hosts

    trusted_hosts.record_first_contact(host, port, key.convert_to_public())


def set_lock(locked: bool) -> None:
    """Save Lock trusted hosts into the config, with the default block action Lock allows."""
    from wavecore.core.ssh import trusted_hosts

    action = "strict" if locked else "disabled"
    trusted_hosts.save_policy({"lock_trusted_hosts": locked, "default_block_action": action})


def ssh_hosts_config(lock: bool, action: str) -> dict[str, Any]:
    """Config file content holding the SSH hosts policy, for the `load_config` fixture."""
    return {"network": {"ssh_hosts": {"lock_trusted_hosts": lock, "default_block_action": action}}}


def trusted_entries() -> list[tuple[str, int, str]]:
    """(host, port, public key) of every entry, read from ssh_hosts.yaml itself."""
    path = ssh_hosts_file()
    if not path.exists():
        return []
    stored = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return [
        (entry["host"], entry["port"], entry["public_key"]) for entry in stored.get("hosts") or []
    ]


def known_hosts_lines() -> list[str]:
    """The known hosts text WAVE hands asyncssh, one entry per line."""
    from wavecore.core.ssh import trusted_hosts

    text = trusted_hosts.known_hosts_bytes().decode()
    return [line for line in text.splitlines() if line.strip() and not line.startswith("#")]


def plugin_context(
    registry: SSHSessionRegistry | None,
    params: dict[str, Any],
    logger: Any | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The execution context a session plugin reads, with the registry omitted when absent."""
    context: dict[str, Any] = {
        "parameters": params,
        "logger": logger if logger is not None else MagicMock(),
        "variables": variables if variables is not None else {},
    }
    if registry is not None:
        context["ssh_session_registry"] = registry
    return context


def run_result(stdout: Any = "ok\n", stderr: Any = "", exit_status: int = 0) -> MagicMock:
    """What asyncssh hands back when a remote process exits."""
    result = MagicMock()
    result.stdout = stdout
    result.stderr = stderr
    result.exit_status = exit_status
    return result


def mock_session_registry(
    session_id: str = SESSION_ID,
    result: MagicMock | None = None,
) -> tuple[SSHSessionRegistry, MagicMock]:
    """A registry holding one session whose mocked connection starts one exiting process."""
    registry = SSHSessionRegistry()
    process = MagicMock()
    process.stdin = MagicMock()
    process.wait = AsyncMock(return_value=result or run_result())
    conn = MagicMock()
    conn.create_process = AsyncMock(return_value=process)
    registry.register(session_id, conn, None, "node-1", None, None, connect_timeout=30)
    return registry, conn


def process_of(conn: MagicMock) -> MagicMock:
    """The process the plugin started on this connection."""
    return conn.create_process.return_value


class NoAuthServer(asyncssh.SSHServer):
    """Loopback test server that admits any username without authentication."""

    def begin_auth(self, username: str) -> bool:
        return False


@asynccontextmanager
async def ssh_server(
    server_factory: Callable[[], asyncssh.SSHServer], **options: Any
) -> AsyncIterator[int]:
    """A real asyncssh server on 127.0.0.1 with HOST_KEY; yields its port, closes on exit."""
    server = await asyncssh.listen(
        "127.0.0.1", 0, server_factory=server_factory, server_host_keys=[HOST_KEY], **options
    )
    try:
        yield server.sockets[0].getsockname()[1]
    finally:
        server.close()
        await server.wait_closed()


@asynccontextmanager
async def _loopback_ssh(handler: ProcessHandler) -> AsyncIterator[Any]:
    """A real asyncssh server plus a live client connection over loopback."""
    async with (
        ssh_server(NoAuthServer, process_factory=handler) as port,
        asyncssh.connect("127.0.0.1", port, username="wave", known_hosts=None) as conn,
    ):
        yield conn


class RecordsTheProcess:
    """Delegates to a live connection and keeps the process that was started on it."""

    def __init__(self, connection: Any) -> None:
        self._connection = connection
        self.process: Any = None

    async def create_process(self, command: str) -> Any:
        self.process = await self._connection.create_process(command)
        return self.process


class SlowToHandOver(RecordsTheProcess):
    """Opens a real channel, then withholds it long enough for the caller to give up first."""

    def __init__(self, connection: Any, delay: float = 0.5) -> None:
        super().__init__(connection)
        self._delay = delay
        self.opened = asyncio.Event()

    async def create_process(self, command: str) -> Any:
        self.process = await self._connection.create_process(command)
        self.opened.set()
        await asyncio.sleep(self._delay)
        return self.process


class SignalWatcher:
    """A remote command that never exits on its own and records the signal it receives."""

    def __init__(self) -> None:
        self.signals: list[str] = []
        self.received = asyncio.Event()

    async def handle(self, process: Any) -> None:
        try:
            while True:
                await process.stdin.read()
                await asyncio.sleep(0.05)
        except asyncssh.SignalReceived as exc:
            self.signals.append(exc.signal)
            self.received.set()

    async def assert_killed_and_closed(self, recorder: RecordsTheProcess) -> None:
        """The abandoned command was signaled and its channel was closed."""
        await asyncio.wait_for(recorder.process.wait_closed(), timeout=10)
        await asyncio.wait_for(self.received.wait(), timeout=10)
        assert recorder.process.is_closing() is True
        assert self.signals == ["KILL"]


def real_session(connection: Any) -> SSHSessionRegistry:
    """A registry holding one live session under the id 'ssh_session_real'."""
    registry = SSHSessionRegistry()
    registry.register(
        "ssh_session_real", connection, None, "node-1", None, None, connect_timeout=30
    )
    return registry


@pytest.fixture
def loopback_ssh() -> LoopbackSSH:
    """Opens a real asyncssh server and a live client connection against it."""
    return _loopback_ssh


Refusal = tuple[int, str]
ForwardingSSH = Callable[..., AbstractAsyncContextManager[Any]]


class ForwardsOrRefuses(NoAuthServer):
    """Forwards every direct-tcpip request, or refuses each with one code and reason."""

    def __init__(self, refuse: Refusal | None) -> None:
        self._refuse = refuse

    def connection_requested(
        self, dest_host: str, dest_port: int, orig_host: str, orig_port: int
    ) -> bool:
        if self._refuse is not None:
            raise asyncssh.ChannelOpenError(*self._refuse)
        return True


@asynccontextmanager
async def _forwarding_ssh(refuse: Refusal | None = None) -> AsyncIterator[Any]:
    """A live client connection to a server that forwards, or refuses with `refuse`."""
    async with (
        ssh_server(partial(ForwardsOrRefuses, refuse)) as port,
        asyncssh.connect("127.0.0.1", port, username="wave", known_hosts=None) as conn,
    ):
        yield conn


@pytest.fixture
def forwarding_ssh() -> ForwardingSSH:
    """Opens a forwarding (or refusing, by code) server and a live client connection to it."""
    return _forwarding_ssh


@dataclass
class Channels:
    """What the stand-in connection opened: its hang gate, opens in progress and writers."""

    gate: asyncio.Event = field(default_factory=asyncio.Event)
    opening: int = 0
    writers: list[WriterProbe] = field(default_factory=list)

    def closed(self) -> list[bool]:
        return [writer.closed.is_set() for writer in self.writers]

    async def released(self) -> None:
        """Open the gate; every channel still opening must end closed (1 s bound, NETCAT-6)."""
        self.gate.set()
        async with asyncio.timeout(1):
            while self.opening or not all(self.closed()):
                await asyncio.sleep(0.001)


def channel_connection(
    target_port: int = 0,
    refuse: str = "",
    hang: bool = False,
    code: int = asyncssh.OPEN_CONNECT_FAILED,
    closed: bool = False,
) -> MagicMock:
    """The SSH connection stand-in: a channel waits its gate when `hang`, then reaches
    target_port or is refused with `code`; a `closed` one meets asyncssh's closed-connection
    refusal (code 2 'SSH connection closed') at once."""
    channels = Channels()

    async def open_connection(host: str, port: int) -> tuple[Any, Any]:
        if closed:
            raise asyncssh.ChannelOpenError(asyncssh.OPEN_CONNECT_FAILED, "SSH connection closed")
        channels.opening += 1
        try:
            if hang:
                await channels.gate.wait()
            if refuse:
                raise asyncssh.ChannelOpenError(code, refuse)
            reader, writer = await asyncio.open_connection("127.0.0.1", target_port)
        finally:
            channels.opening -= 1
        channels.writers.append(WriterProbe(writer))
        return reader, channels.writers[-1]

    connection = MagicMock(
        open_connection=AsyncMock(side_effect=open_connection), channels=channels
    )
    connection.is_closed.return_value = closed
    return connection


def tunnel_session(
    connection: Any,
    session_id: str = SESSION_ID,
    connect_timeout: float = 30,
    host_identity: str | None = "bastion",
) -> SSHSessionRegistry:
    """A registry holding one session on host 'node-1' that names itself `host_identity`."""
    registry = SSHSessionRegistry()
    registry.register(
        session_id,
        connection,
        None,
        "node-1",
        None,
        None,
        connect_timeout=connect_timeout,
        host_identity=host_identity,
    )
    return registry


class RunLog(list[tuple[str, str]]):
    """A block logger recording (level, message); warn and warning both write WARN."""

    def debug(self, message: str) -> None:
        self.append(("DEBUG", message))

    def info(self, message: str) -> None:
        self.append(("INFO", message))

    def warn(self, message: str) -> None:
        self.append(("WARN", message))

    warning = warn

    def error(self, message: str) -> None:
        self.append(("ERROR", message))


class SSHEndpoint(NamedTuple):
    """A live loopback SSH server the code under test connects to itself."""

    port: int
    host_key: Any
    offered_passwords: list[str]

    def entry(self, key: Any = None) -> tuple[str, int, str]:
        """This endpoint as a trusted hosts entry, for a key of the caller's choosing."""
        return ("127.0.0.1", self.port, public_key_text(key or self.host_key))

    def trust(self, key: Any = None) -> None:
        """Put this endpoint in WAVE's trusted SSH hosts list, with its own key by default."""
        trust_host("127.0.0.1", self.port, key or self.host_key)


class _RecordsWhatItWasOffered(asyncssh.SSHServer):
    """Demands a password and keeps every one it is given, so a spec can prove none was sent."""

    def __init__(self, offered: list[str]) -> None:
        self._offered = offered

    def begin_auth(self, username: str) -> bool:
        return True

    def password_auth_supported(self) -> bool:
        return True

    def validate_password(self, username: str, password: str) -> bool:
        self._offered.append(password)
        return True

    def connection_requested(
        self, dest_host: str, dest_port: int, orig_host: str, orig_port: int
    ) -> bool:
        """Permit forwarding so a chained hop can be carried over this connection."""
        return True


async def exits_immediately(process: Any) -> None:
    """A remote command that reports nothing and exits cleanly."""
    process.exit(0)


@pytest.fixture
async def ssh_endpoint() -> AsyncIterator[SSHEndpoint]:
    """A real asyncssh server on 127.0.0.1 whose port, host key and auth attempts the spec sees."""
    offered: list[str] = []
    async with ssh_server(
        lambda: _RecordsWhatItWasOffered(offered), process_factory=exits_immediately
    ) as port:
        yield SSHEndpoint(port, HOST_KEY, offered)


class KeyEndpoint(NamedTuple):
    """A loopback SSH server admitting only the keys a spec authorizes; offered_keys is deduped."""

    port: int
    host_key: Any
    authorized_keys: list[Any]
    offered_keys: list[Any]

    def authorize(self, key: Any) -> None:
        """Let this key (private or public) log in; the public half is what is kept."""
        self.authorized_keys.append(key.convert_to_public())


class _AdmitsAuthorizedKeys(asyncssh.SSHServer):
    """Public key auth only, admitting a key whose public half was authorized."""

    def __init__(self, authorized: list[Any], offered: list[Any]) -> None:
        self._authorized = authorized
        self._offered = offered

    def begin_auth(self, username: str) -> bool:
        return True

    def password_auth_supported(self) -> bool:
        return False

    def public_key_auth_supported(self) -> bool:
        return True

    def validate_public_key(self, username: str, key: Any) -> bool:
        if all(key.public_data != seen.public_data for seen in self._offered):
            self._offered.append(key)
        return any(key.public_data == known.public_data for known in self._authorized)


@pytest.fixture
async def key_endpoint() -> AsyncIterator[KeyEndpoint]:
    """A real asyncssh server on 127.0.0.1 that refuses passwords and every unauthorized key."""
    authorized: list[Any] = []
    offered: list[Any] = []
    async with ssh_server(
        lambda: _AdmitsAuthorizedKeys(authorized, offered), process_factory=exits_immediately
    ) as port:
        yield KeyEndpoint(port, HOST_KEY, authorized, offered)


@pytest.fixture(autouse=True)
def isolated_home(server_home: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """HOME is the server_home folder, so the account's SSH files are the spec's own."""
    monkeypatch.setenv("HOME", str(server_home))
    yield server_home
