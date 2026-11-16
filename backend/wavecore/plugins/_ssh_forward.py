"""
SSH Tunnel Forwarder

Implements REQ-5.1.5 (SSH protocol for node access): the loopback Local Port behind
SSH Tunnel Open. Each accepted connection asks the session's server for its own
channel and is relayed both ways, like ssh -L (SSHTUN-6); one the SSH host refuses or
cannot complete writes a WARN through the Tunnel Open block's logger (SSHTUN-8).
Validate Target opens one channel at open, bounded by the session's Connection
Timeout, for the tunnel to hold for its first client (SSHTUN-7).
"""

import asyncio
from contextlib import suppress
from typing import Any

import asyncssh

from wavecore.plugins._plural import plural
from wavecore.plugins._ssh_session import open_tunnel_stream

_LOOPBACK = "127.0.0.1"
_CHUNK = 65536
# Bounds the read of a refused client that never ends its side.
_REFUSED_CLIENT_BOUND = 10


def tunnel_failed(remote_host: str, remote_port: int, cause: str) -> ConnectionError:
    """The error a Tunnel Open that cannot bind or pass its check fails with."""
    return ConnectionError(f"SSH tunnel to {remote_host}:{remote_port} failed: {cause}")


def closed_phrase(record: dict[str, Any]) -> str:
    """The cause a tunnel names when its SSH connection is closed."""
    return f"the SSH connection to {record['host_identity']} is closed"


def cause_phrase(exc: BaseException, record: dict[str, Any]) -> str:
    """Why the SSH host did not complete a channel, as the WARN and the check name it."""
    ssh_host = record["host_identity"]
    refusal = exc.__cause__
    # asyncssh refuses a channel on a closed connection as code 2, so closed is read first.
    if record["connection"].is_closed() or not isinstance(refusal, asyncssh.ChannelOpenError):
        return closed_phrase(record)
    if refusal.code == asyncssh.OPEN_ADMINISTRATIVELY_PROHIBITED:
        return f"{ssh_host} refused to forward (administratively prohibited)"
    if refusal.code == asyncssh.OPEN_CONNECT_FAILED:
        return f"{ssh_host} could not connect ({refusal.reason})"
    return f"{ssh_host} refused the connection ({refusal.reason})"


async def validate_target(
    record: dict[str, Any], remote_host: str, remote_port: int
) -> tuple[Any, Any]:
    """One channel to the destination within the Connection Timeout, returned open."""
    timeout = record["connect_timeout"]
    try:
        return await asyncio.wait_for(open_tunnel_stream(record, remote_host, remote_port), timeout)
    except TimeoutError as exc:
        within = plural(timeout, "second", "seconds")
        cause = f"{record['host_identity']} did not connect within {within}"
        raise tunnel_failed(remote_host, remote_port, cause) from exc
    except OSError as exc:
        raise tunnel_failed(remote_host, remote_port, cause_phrase(exc, record)) from exc


class Forwarder:
    """The Local Port listener a tunnel record holds."""

    def __init__(self, server: asyncio.Server) -> None:
        self._server = server
        self._port: int = server.sockets[0].getsockname()[1]

    def get_port(self) -> int:
        """The port bound, the auto-assigned one when 0 was asked for."""
        return self._port

    def close(self) -> None:
        """Stop accepting; connections in progress keep running until the session closes."""
        self._server.close()


async def start_forwarder(
    record: dict[str, Any],
    tunnel_id: str,
    local_port: int,
    remote_host: str,
    remote_port: int,
    logger: Any,
) -> Forwarder:
    """Bind 127.0.0.1:local_port and give every accepted connection its own channel."""

    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        tunnel = record["tunnels"].get(tunnel_id)
        try:
            channel = await open_tunnel_stream(record, remote_host, remote_port, tunnel=tunnel)
        except OSError as exc:
            bound = writer.get_extra_info("sockname")[1]
            logger.warning(
                f"Connection through SSH tunnel {_LOOPBACK}:{bound} to {remote_host}:"
                f"{remote_port} failed: {cause_phrase(exc, record)}"
            )
            await _end_refused_client(reader, writer)
            return
        await _relay(reader, writer, channel)

    return Forwarder(await asyncio.start_server(serve, _LOOPBACK, local_port))


async def _end_refused_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """Send EOF, then read what the client sent before closing, so the close sends no reset."""
    with suppress(OSError):
        writer.write_eof()
        async with asyncio.timeout(_REFUSED_CLIENT_BOUND):
            while await reader.read(_CHUNK):
                pass  # nowhere to send it; read only so the close is orderly
    writer.close()


async def _pump(reader: Any, writer: Any) -> None:
    """Copy one direction until its EOF, then pass the EOF on; the other keeps flowing."""
    while data := await reader.read(_CHUNK):
        writer.write(data)
        await writer.drain()
    writer.write_eof()


async def _relay(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, channel: tuple[Any, Any]
) -> None:
    """Relay both ways; once both directions end, or either fails, both sides close."""
    channel_reader, channel_writer = channel
    try:
        with suppress(OSError):
            async with asyncio.TaskGroup() as pumps:
                pumps.create_task(_pump(reader, channel_writer))
                pumps.create_task(_pump(channel_reader, writer))
    finally:
        writer.close()
        channel_writer.close_after_sending()
