"""
Shared SSH Session Transport

Shared asyncssh transport for the SSH Session plugins: parameter-to-connect-kwargs
mapping (host-key policy, login sources, keepalive, compression, parent tunnel), the
host key check against WAVE's trusted SSH hosts list with its first-contact record,
the safe connect wrapper, the remote run, the tunnel channel and the SFTP channel open,
each releasing its channel whenever it is abandoned, the hand-over of the channel
a tunnel holds for its first client (SSHTUN-7), the tunnel a loopback host
and port reach and the far host a host key then belongs to (SSH-8), safe
stdout/stderr decoding, the session lookup-or-raise, and the server banner reader.
"""

import asyncio
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from functools import partial
from typing import Any, NamedTuple

import asyncssh

from wavecore.core.ssh import trusted_hosts
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins._file_paths import plain_path
from wavecore.plugins._plural import plural
from wavecore.plugins._shared_params import number_setting
from wavecore.plugins._tls_material import is_pem

_DEFAULT_SSH_PORT = 22
DEFAULT_CONNECT_TIMEOUT = 30
_LOOPBACK = ("127.0.0.1", "localhost")
_LOOPBACK_FAR_HOSTS = (*_LOOPBACK, "::1")

_INVALID_PEM = "Invalid PEM private key"
_LEGACY_PEM_ENCRYPTED = b"Proc-Type: 4,ENCRYPTED"
_LEGACY_PEM_NOT_DECRYPTED = "Unable to decrypt PKCS#1 private key"

_KEY_CHANGED = "key-changed"
_HOST_UNKNOWN = "host-unknown"
_HOST_LOCKED = "host-locked"
_REFUSAL_DETAIL = {
    _KEY_CHANGED: (
        "the host offered a key that differs from the one in WAVE's trusted hosts list. "
        "Check Settings > Network > SSH Hosts"
    ),
    _HOST_UNKNOWN: (
        "the host is not in WAVE's trusted hosts list and the host key policy is 'strict'. "
        "Add it in Settings > Network > SSH Hosts"
    ),
    _HOST_LOCKED: (
        "the host is not in WAVE's trusted hosts list and trusted hosts are locked. "
        "Add it in Settings > Network > SSH Hosts"
    ),
}

SESSION_ID_PARAM: dict[str, Any] = {
    "name": "session_id",
    "type": "string",
    "trim": True,
    "required": True,
    "description": "Session ID of the target SSH session, as returned by SSH Session Open",
}


def session_id_param() -> dict[str, Any]:
    """The shared 'session_id' parameter definition for the session-riding plugins."""
    return dict(SESSION_ID_PARAM)


def require_session(
    registry: SSHSessionRegistry | None,
    session_id: str,
    label: str = "SSH session",
) -> dict[str, Any]:
    """Return the live session record or raise the canonical not-found error."""
    record = registry.get(session_id) if registry is not None else None
    if record is None:
        raise ValueError(f"{label} '{session_id}' not found or already closed")
    return record


def _release(process: Any) -> None:
    """Signal the remote command, then close its channel regardless so the slot is freed."""
    with suppress(Exception):
        process.kill()
    with suppress(Exception):
        process.close()


def _close_writer(pair: tuple[Any, Any]) -> None:
    """Close a tunnel channel through its writer."""
    with suppress(Exception):
        pair[1].close()


def _release_channel(
    creating: asyncio.Future[Any], releaser: Callable[[Any], None] = _release
) -> None:
    """Release the channel once asyncssh has produced it; never awaits, so a stop is never held."""
    if not creating.done():
        creating.add_done_callback(partial(_release_channel, releaser=releaser))
    elif not creating.cancelled() and creating.exception() is None:
        releaser(creating.result())


def require_utf8(label: str, text: str) -> None:
    """Refuse text UTF-8 cannot carry, before any of it is sent to the remote host."""
    try:
        text.encode("utf-8")
    except UnicodeEncodeError as exc:
        line = text.count("\n", 0, exc.start) + 1
        column = exc.start - text.rfind("\n", 0, exc.start)
        raise ValueError(
            f"{label} has a character at line {line}, column {column} that cannot be encoded "
            "as UTF-8, so nothing was sent to the remote host: remove or replace it"
        ) from exc


async def run_and_release(connection: Any, command: str, script: str | None = None) -> Any:
    """Start the remote process, optionally feed it a script on stdin, and wait for its exit."""
    # The connection replaces what it cannot encode, so the text is refused before it is sent.
    require_utf8("Command", command)
    if script is not None:
        require_utf8("Script", script)
    creating = asyncio.ensure_future(connection.create_process(command))
    exited = False
    try:
        process = await asyncio.shield(creating)
        if script is not None:
            try:
                process.stdin.write(script)
                process.stdin.write_eof()
            except (BrokenPipeError, ConnectionResetError):
                pass  # the remote exited without reading stdin; its exit status still stands
        result = await process.wait(check=False)
        exited = True
        return result
    finally:
        if not exited:
            _release_channel(creating)


async def open_tunnel_channel(
    record: dict[str, Any], far_host: str, far_port: int
) -> tuple[Any, Any]:
    """Open a TCP channel to far_host:far_port through the session; the caller bounds it."""
    creating = asyncio.ensure_future(record["connection"].open_connection(far_host, far_port))
    opened = False
    try:
        # Shielded, so a caller's bound leaves the channel alive for _release_channel (NETCAT-6).
        pair: tuple[Any, Any] = await asyncio.shield(creating)
        opened = True
        return pair
    except asyncssh.ChannelOpenError as exc:
        raise ConnectionRefusedError(exc.reason) from exc
    except asyncssh.Error as exc:
        raise ConnectionResetError(exc.reason) from exc
    finally:
        if not opened:
            _release_channel(creating, _close_writer)


@contextmanager
def _lost_as_reset() -> Iterator[None]:
    """A failure of the SSH connection under a channel surfaces as a reset, as a socket's would."""
    try:
        yield
    except asyncssh.Error as exc:
        raise ConnectionResetError(exc.reason) from exc


class _TunnelReader:
    """A tunnel channel's reader whose SSH failures read as a reset."""

    def __init__(self, reader: Any) -> None:
        self._reader = reader

    async def read(self, size: int) -> Any:
        with _lost_as_reset():
            return await self._reader.read(size)

    def at_eof(self) -> bool:
        """EOF arrived and nothing is left unread."""
        return bool(self._reader.at_eof())


class _TunnelWriter:
    """A tunnel channel's writer whose SSH failures read as a reset."""

    def __init__(self, writer: Any) -> None:
        self._writer = writer

    def write(self, data: Any) -> None:
        with _lost_as_reset():
            self._writer.write(data)

    async def drain(self) -> None:
        with _lost_as_reset():
            await self._writer.drain()

    def write_eof(self) -> None:
        with _lost_as_reset():
            self._writer.write_eof()

    def close(self) -> None:
        """Abort the channel first: asyncssh's close waits for the far end to take unsent data."""
        channel = getattr(self._writer, "channel", None)
        if channel is not None:
            channel.abort()
        self._writer.close()

    def close_after_sending(self) -> None:
        """Close once the data still buffered has gone out, as ssh -L does."""
        self._writer.close()


async def open_tunnel_stream(
    record: dict[str, Any], far_host: str, far_port: int, tunnel: dict[str, Any] | None = None
) -> tuple[Any, Any]:
    """The tunnel's held pair once, else a fresh channel; raises only OSError (SSHTUN-7)."""
    if tunnel is not None and tunnel["held"] is not None:
        held: tuple[Any, Any] = tunnel["held"]
        tunnel["held"] = None
        if not held[0].at_eof():
            return held
        _close_writer(held)
    reader, writer = await open_tunnel_channel(record, far_host, far_port)
    return _TunnelReader(reader), _TunnelWriter(writer)


class SFTPUnavailable(Exception):
    """The session's server would not start SFTP; detail is the asyncssh reason."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def close_sftp_client(client: Any) -> None:
    """End the SFTP channel without waiting on the server; never raises."""
    with suppress(Exception):
        client.exit()


async def open_sftp_client(record: dict[str, Any]) -> asyncssh.SFTPClient:
    """Open one SFTP channel on the session; the caller closes it with close_sftp_client."""
    creating = asyncio.ensure_future(record["connection"].start_sftp_client())
    opened = False
    try:
        client: asyncssh.SFTPClient = await asyncio.shield(creating)
        opened = True
        return client
    except (asyncssh.ChannelOpenError, asyncssh.SFTPError) as exc:
        raise SFTPUnavailable(exc.reason) from exc
    finally:
        if not opened:
            _release_channel(creating, close_sftp_client)


class TunnelRoute(NamedTuple):
    """The open tunnel a loopback host and port reach, and the far end it forwards to."""

    record: dict[str, Any]
    far_host: str
    far_port: int
    tunnel: dict[str, Any]


def resolve_tunnel(host: str, port: int, registry: SSHSessionRegistry | None) -> TunnelRoute | None:
    """The tunnel whose Local Port a loopback Host names in this run, else None (SQL-15)."""
    if registry is None or host.strip() not in _LOOPBACK:
        return None
    found = registry.find_tunnel_by_local_port(port)
    if found is None:
        return None
    record, tunnel = found
    far_host, _, far_port = str(tunnel["remote_destination"]).rpartition(":")
    return TunnelRoute(record, far_host, int(far_port), tunnel)


def host_key_identity(route: TunnelRoute) -> tuple[str, int]:
    """The far host and port whose host key a session on the tunnel's Local Port meets (SSH-8)."""
    if route.far_host in _LOOPBACK_FAR_HOSTS:
        # A loopback far end is the tunnel session's own server.
        return route.record["host_identity"], route.far_port
    return route.far_host, route.far_port


def host_key_mode(params: dict[str, Any]) -> str:
    """The block's host key policy; a block that carries none skips verification."""
    return str(params.get("host_key_verification") or "disabled")


def host_key_target(params: dict[str, Any], identity: tuple[str, int] | None) -> str:
    """What a host key refusal names: the far host through the tunnel, else the Host and Port."""
    given = f"{params['host']}:{number_setting(params, 'port', _DEFAULT_SSH_PORT)}"
    if identity is None:
        return given
    far_host, far_port = identity
    return f"{far_host}:{far_port} through the SSH tunnel on {given}"


def command_timed_out(timeout: float) -> TimeoutError:
    """The wording both SSH session plugins report when a remote command outlives its bound."""
    within = plural(timeout, "second", "seconds")
    return TimeoutError(f"Command execution timed out after {within}")


def _trusted_keys(host: str, addr: str, port: int) -> list[asyncssh.SSHKey]:
    """Keys WAVE's list trusts for exactly this host (or address) and port (REQ-4.5.14)."""
    bracketed = port != _DEFAULT_SSH_PORT
    # Only this port's lines: asyncssh would otherwise fall back from [host]:port to the bare host.
    lines = [
        line
        for line in trusted_hosts.known_hosts_bytes().decode().splitlines()
        if line.startswith("[") == bracketed
    ]
    known = asyncssh.import_known_hosts("\n".join(lines))
    return list(known.match(host, addr, port if bracketed else None)[0])


def _trust_nothing(
    _host: str, _addr: str, _port: int | None
) -> tuple[list[Any], list[Any], list[Any]]:
    """Known hosts under an identity: asyncssh trusts no record, so every key is ruled on."""
    return [], [], []


class _HostKeyCheck(asyncssh.SSHClient):
    """Rules on a host key asyncssh found no match for, during key exchange."""

    def __init__(
        self,
        record_first_contact: bool,
        identity: tuple[str, int] | None = None,
        locked: bool = False,
    ) -> None:
        self._record = record_first_contact and not locked
        self._identity = identity
        self._locked = locked
        self._accepted: asyncssh.SSHKey | None = None
        self.refusal: str | None = None
        self.on_refused: Callable[[str], None] | None = None

    def __call__(self) -> "_HostKeyCheck":
        """asyncssh calls client_factory() once per connection; one connection, one check."""
        return self

    def known_hosts(
        self, host: str, addr: str, port: int | None
    ) -> tuple[list[asyncssh.SSHKey], list[Any], list[Any]]:
        """What asyncssh trusts by itself: the keys of this exact host and port, no fallback."""
        return _trusted_keys(host, addr, port or _DEFAULT_SSH_PORT), [], []

    def _accept(self, key: asyncssh.SSHKey) -> bool:
        self._accepted = key
        return True

    def _refuse(self, refusal: str) -> bool:
        self.refusal = refusal
        return False

    def validate_host_public_key(
        self, host: str, addr: str, port: int, key: asyncssh.SSHKey
    ) -> bool:
        """Accept and record an unknown host under accept-new; refuse a key that changed."""
        if self._accepted is not None:
            # SSH rekeys: a later exchange may only re-offer the key this connection accepted.
            return True if key == self._accepted else self._refuse(_KEY_CHANGED)
        if self._identity is not None:
            # asyncssh parses addr as an IP address, so a far host name goes with an empty one.
            host, addr, port = self._identity[0], "", self._identity[1]
        # Re-read here, never at connect time: another open may have recorded this host since.
        trusted = _trusted_keys(host, addr, port)
        if trusted:
            return self._accept(key) if key in trusted else self._refuse(_KEY_CHANGED)
        if not self._record:
            return self._refuse(_HOST_LOCKED if self._locked else _HOST_UNKNOWN)
        try:
            trusted_hosts.record_first_contact(host, port, key)
        except trusted_hosts.TrustedHostConflict:
            # Another run recorded a different key for this host since the read above.
            return self._refuse(_KEY_CHANGED)
        return self._accept(key)

    def connection_lost(self, exc: Exception | None) -> None:
        """A refusal on a later exchange kills the connection; tell whoever owns the session."""
        if self.refusal is not None and self.on_refused is not None:
            self.on_refused(self.refusal)


def _private_key_bytes(value: str) -> bytes:
    """Inline PEM as given, else the key file WAVE reads itself, so no sibling file loads."""
    if is_pem(value):
        return value.encode()
    path = plain_path(value)
    try:
        return path.read_bytes()
    except FileNotFoundError as exc:
        raise ValueError(f"Private Key file not found: {path}") from exc
    except OSError as exc:
        raise ValueError(f"Private Key file {path} cannot be read: {exc}") from exc


def build_connect_kwargs(
    params: dict[str, Any],
    tunnel: Any | None,
    host_key_identity: tuple[str, int] | None = None,
) -> dict[str, Any]:
    """Map plugin parameters (+ optional parent connection) to asyncssh connect kwargs."""
    kwargs: dict[str, Any] = {
        "host": params["host"],
        "port": number_setting(params, "port", _DEFAULT_SSH_PORT),
        "username": params["username"],
        "connect_timeout": number_setting(params, "connect_timeout", DEFAULT_CONNECT_TIMEOUT),
        # A byte that is not UTF-8 shows as U+FFFD on every text channel (REQ-4.6.9).
        "errors": "replace",
        # Nothing of the account WAVE runs under takes part (REQ-4.5.15).
        "config": [],
        "agent_path": None,
        "client_keys": None,
        "x509_trusted_certs": None,
        "x509_trusted_cert_paths": None,
        "gss_auth": False,
        "gss_kex": False,
    }
    password = params.get("password")
    if password:
        kwargs["password"] = password
    private_key = params.get("private_key")
    if private_key:
        kwargs["client_keys"] = [_private_key_bytes(private_key)]
        passphrase = params.get("passphrase")
        if passphrase:
            kwargs["passphrase"] = passphrase
    mode = host_key_mode(params)
    if mode == "disabled":
        kwargs["known_hosts"] = None
    else:
        # An unreadable trusted hosts list stops the connection before it starts.
        trusted_hosts.load()
        # Read at each connect, so a saved Lock applies to the next connection.
        locked = trusted_hosts.is_locked() and mode == "accept-new"
        check = _HostKeyCheck(mode == "accept-new", host_key_identity, locked=locked)
        kwargs["known_hosts"] = check.known_hosts if host_key_identity is None else _trust_nothing
        kwargs["client_factory"] = check
    keep_alive_interval = number_setting(params, "keep_alive_interval", 0)
    if keep_alive_interval > 0:
        kwargs["keepalive_interval"] = keep_alive_interval
        kwargs["keepalive_count_max"] = number_setting(params, "keep_alive_max_count", 3)
    if params.get("compression"):
        kwargs["compression_algs"] = ["zlib@openssh.com", "zlib"]
    if tunnel is not None:
        kwargs["tunnel"] = tunnel
    return kwargs


def _refusal_message(target: str, refusal: str) -> str:
    """What the user is told when a host key is refused, at connect time or on a rekey."""
    return f"SSH host key verification failed for {target}: {_REFUSAL_DETAIL[refusal]}"


class OpenedSSHConnection(NamedTuple):
    """A live connection plus the check that keeps ruling on this connection's later exchanges."""

    connection: Any
    host_key_check: "_HostKeyCheck | None"


async def open_connection(
    params: dict[str, Any],
    tunnel: Any | None,
    host_key_identity: tuple[str, int] | None = None,
) -> OpenedSSHConnection:
    """Connect via asyncssh (optionally through a parent connection); raise a safe
    ConnectionError on failure."""
    kwargs = build_connect_kwargs(params, tunnel, host_key_identity)
    check = kwargs.get("client_factory")
    check = check if isinstance(check, _HostKeyCheck) else None
    try:
        return OpenedSSHConnection(await asyncssh.connect(**kwargs), check)
    except Exception as exc:
        if check is not None and check.refusal:
            target = host_key_target(params, host_key_identity)
            raise ConnectionError(_refusal_message(target, check.refusal)) from exc
        detail = _connect_failure_detail(exc, kwargs.get("client_keys"))
        raise ConnectionError(
            f"SSH connection to {kwargs['host']}:{kwargs['port']} failed: {detail}"
        ) from exc


def _connect_failure_detail(exc: Exception, client_keys: list[bytes] | None) -> str:
    """The reason a connect failed, as the user reads it after "failed: "."""
    detail = str(exc) or type(exc).__name__
    # A wrong passphrase on a legacy encrypted PEM can unpad cleanly; asyncssh then says invalid.
    if (
        isinstance(exc, asyncssh.KeyImportError)
        and detail == _INVALID_PEM
        and any(_LEGACY_PEM_ENCRYPTED in key for key in client_keys or [])
    ):
        return _LEGACY_PEM_NOT_DECRYPTED
    return detail


def drop_session_on_a_refused_host_key(
    check: "_HostKeyCheck | None",
    registry: SSHSessionRegistry,
    session_id: str,
    target: str,
    logger: Any,
) -> None:
    """Close the registered session, and say why, if a later key exchange is refused."""
    if check is None:
        return

    def refused(refusal: str) -> None:
        if logger:
            logger.error(f"SSH session '{session_id}' dropped: {_refusal_message(target, refusal)}")
        registry.close(session_id)

    check.on_refused = refused


def safe_decode(value: Any) -> str:
    """Decode stdout/stderr (str or bytes) tolerantly; never raises."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        return value
    return str(value)


def server_banner(connection: Any) -> str:
    """The remote server's identification string, empty when absent."""
    return connection.get_extra_info("server_version") or ""
