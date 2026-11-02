"""
SSH Session Open Plugin

Implements REQ-3.4.1.3 (SSH remote execution) and REQ-5.1.5 (SSH protocol
for node access): opens a stateful SSH session from config-form parameters,
optionally chained through a parent session (multi-hop), and registers it
in the run's SSHSessionRegistry for downstream Exec / Script / Close / Tunnel Open / \
SFTP / Remote Execution nodes.
"""

import asyncio
import uuid
from typing import Any

from wavecore.api.config.instance_settings import HOST_KEY_ACTIONS
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins._executor_base import validate_enum_from_schema
from wavecore.plugins._ports import check_port
from wavecore.plugins._shared_params import (
    check_at_least,
    check_integer,
    number_setting,
    plural,
)
from wavecore.plugins._ssh_session import (
    DEFAULT_CONNECT_TIMEOUT,
    drop_session_on_a_refused_host_key,
    host_key_identity,
    host_key_mode,
    host_key_target,
    open_connection,
    require_session,
    resolve_tunnel,
    server_banner,
)
from wavecore.plugins.base import PluginBase

_NUMBER_ROWS = ("connect_timeout", "keep_alive_interval", "keep_alive_max_count")


async def _monitor_liveness(
    conn: Any,
    session_id: str,
    registry: SSHSessionRegistry,
    logger: Any,
) -> None:
    """Warn and drop the session when keepalive loses the connection."""
    await conn.wait_closed()
    if logger:
        logger.warning(f"SSH session '{session_id}' lost: keepalive timeout")
    record = registry.get(session_id)
    if record:
        # Self-cancel would mark this task canceled even after a clean return.
        record["monitor_task"] = None
    registry.close(session_id)


def _hop_count(registry: SSHSessionRegistry | None, parent_id: str | None) -> int:
    """Chain depth of the new session: 1 for a direct connection, +1 per ancestor."""
    count = 1
    current = parent_id
    while registry is not None and current is not None:
        count += 1
        record = registry.get(current) or {}
        current = record.get("parent_id")
    return count


def _tunnel_identity(
    params: dict[str, Any],
    host: str,
    port: int,
    registry: SSHSessionRegistry | None,
    logger: Any,
) -> tuple[str, int] | None:
    """The far host and port a host key is checked under when Host / Port is a tunnel (SSH-8)."""
    route = resolve_tunnel(host, port, registry)
    if route is None:
        return None
    identity = host_key_identity(route)
    if logger and host_key_mode(params) != "disabled":
        far_host, far_port = identity
        logger.info(
            f"SSH tunnel detected on local port {port}: the host key is checked and recorded "
            f"for {far_host}:{far_port}"
        )
    return identity


class SSHSessionOpenPlugin(PluginBase):
    """Opens one SSH connection and registers it as a live session for the run."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "ssh-session-open",
            "name": "SSH Session Open",
            "version": "1.0.0",
            "category": "remote",
            "description": (
                "Opens a stateful SSH session that SSH Session Exec, SSH Session Script, "
                "SSH Session Close, SSH Tunnel Open, SFTP and Remote Execution reference by "
                "its Session ID. Chain sessions through Parent Session for multi-hop access."
            ),
            "parameters": [
                {
                    "name": "host",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "Target host name or IP address to connect to",
                },
                {
                    "name": "port",
                    "type": "integer",
                    "required": True,
                    "default": 22,
                    "minimum": 1,
                    "maximum": 65535,
                    "description": "SSH port on the target host. Default: 22.",
                },
                {
                    "name": "username",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "Login user on the target host",
                },
                {
                    "name": "password",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": (
                        "Password for password authentication. Either a password or a "
                        "private key is required."
                    ),
                },
                {
                    "name": "private_key",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": (
                        "Private key for key authentication: inline PEM content or the path "
                        "of a key file on the WAVE host; a relative path starts at the home "
                        "folder of the account WAVE runs under. Either a password or a "
                        "private key is required."
                    ),
                },
                {
                    "name": "use_parent",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Chain through a parent session: route this connection over an "
                        "open SSH session (multi-hop / jump host). Off connects directly."
                    ),
                },
                {
                    "name": "parent_session_id",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": (
                        "Session ID of the open parent SSH session to tunnel over (used "
                        "when 'Chain through a parent session' is on). The connection "
                        "fails if the parent is not open."
                    ),
                },
                {
                    "name": "passphrase",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": (
                        "Passphrase unlocking the private key, when the key is encrypted"
                    ),
                },
                {
                    "name": "host_key_verification",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "disabled",
                    "enum_values": list(HOST_KEY_ACTIONS),
                    "description": (
                        "Host key policy: 'strict' requires the host to be in WAVE's trusted "
                        "hosts list, 'accept-new' adds an unknown host's key to that list the "
                        "first time and refuses it later if it changes, 'disabled' skips "
                        "verification. While trusted hosts are locked in Settings, "
                        "'accept-new' acts as 'strict'. Default: 'disabled'; a newly placed "
                        "block takes the Settings default."
                    ),
                },
                {
                    "name": "connect_timeout",
                    "type": "integer",
                    "required": False,
                    "default": 30,
                    "minimum": 1,
                    "description": "Connection timeout in seconds. Default: 30.",
                },
                {
                    "name": "keep_alive_interval",
                    "type": "integer",
                    "required": False,
                    "default": 0,
                    "minimum": 0,
                    "description": (
                        "Seconds between keepalive probes; 0 disables keepalive. With "
                        "keepalive on, a dropped connection flips the Connected output "
                        "to false. Default: 0."
                    ),
                },
                {
                    "name": "keep_alive_max_count",
                    "type": "integer",
                    "required": False,
                    "default": 3,
                    "minimum": 1,
                    "description": (
                        "Consecutive unanswered keepalives before the connection counts "
                        "as lost. Default: 3."
                    ),
                },
                {
                    "name": "compression",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": "Enable zlib compression on the connection. Default: off.",
                },
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "session_id",
                    "type": "string",
                    "description": (
                        "Handle for this session: bind it to a variable and reference it "
                        "from SSH Session Exec, SSH Session Script, SSH Session Close, SSH "
                        "Tunnel Open, SFTP, Remote Execution, or a chained Open's Parent Session"
                    ),
                },
                {
                    "name": "connected",
                    "type": "boolean",
                    "description": (
                        "Liveness signal: true while the session is open; flips to "
                        "false when the session closes or keepalive detects the "
                        "connection dropped"
                    ),
                },
                {
                    "name": "server_banner",
                    "type": "string",
                    "description": (
                        "SSH identification string reported by the server, e.g. "
                        "'SSH-2.0-OpenSSH_9.6'; empty when the server sends none"
                    ),
                },
                {
                    "name": "hop_count",
                    "type": "integer",
                    "description": (
                        "Number of hops in this session's chain: 1 for a direct "
                        "connection, 2+ when chained through parent sessions"
                    ),
                },
            ],
            "secret_mask_fields": [
                "password",
                "private_key",
                "passphrase",
            ],
            "author": "WAVE Framework",
            "tags": ["ssh", "network", "session", "connection"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate required params, the auth pair, ranges, and the host-key enum."""
        if not params.get("host"):
            raise ValueError("Missing required parameter: host")
        if not params.get("username"):
            raise ValueError("Missing required parameter: username")
        if not params.get("password") and not params.get("private_key"):
            raise ValueError("SSH Session Open requires either 'password' or 'private_key'")
        if params.get("port") is not None:
            check_port("port", params["port"], 1)
        for name in _NUMBER_ROWS:
            check_integer(params, name)
        check_at_least(params, "connect_timeout", 1, "Connect timeout must be at least 1")
        check_at_least(params, "keep_alive_interval", 0, "Keep-alive interval must be 0 or more")
        check_at_least(params, "keep_alive_max_count", 1, "Keep-alive max count must be at least 1")
        if "host_key_verification" in params:
            validate_enum_from_schema(
                "host_key_verification",
                params["host_key_verification"],
                self.metadata["parameters"],
            )

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Open the connection (optionally through a parent) and register the session."""
        params = context["parameters"]
        registry: SSHSessionRegistry | None = context.get("ssh_session_registry")
        logger = context.get("logger")

        host = params["host"]
        port = number_setting(params, "port", 22)
        username = params["username"]

        parent_id = None
        parent_conn = None
        identity = None
        if params.get("use_parent"):
            parent_id = params.get("parent_session_id")
            if not parent_id:
                raise ValueError("Parent SSH session is not open or not connected")
            parent_record = require_session(registry, parent_id, label="Parent SSH session")
            parent_conn = parent_record["connection"]
        else:
            identity = _tunnel_identity(params, host, port, registry, logger)

        via = f" via parent session '{parent_id}'" if parent_id else ""
        if logger:
            logger.info(f"Connecting to {username}@{host}:{port}{via}...")

        conn, host_key_check = await open_connection(
            params, parent_conn, host_key_identity=identity
        )

        session_id = f"ssh_session_{uuid.uuid4().hex[:12]}"
        connected_var = (context.get("output_bindings") or {}).get("connected")
        monitor_task: asyncio.Task[None] | None = None
        if registry is not None:
            if number_setting(params, "keep_alive_interval", 0) > 0:
                monitor_task = asyncio.create_task(
                    _monitor_liveness(conn, session_id, registry, logger)
                )
            registry.register(
                session_id,
                conn,
                parent_id,
                host,
                connected_var,
                monitor_task,
                variables=context["variables"],
                connect_timeout=number_setting(params, "connect_timeout", DEFAULT_CONNECT_TIMEOUT),
                host_identity=identity[0] if identity else None,
            )
            drop_session_on_a_refused_host_key(
                host_key_check, registry, session_id, host_key_target(params, identity), logger
            )

        hop_count = _hop_count(registry, parent_id)
        banner = server_banner(conn)
        hops = plural(hop_count, "hop", "hops")
        banner_note = f" - {banner}" if banner else ""
        if logger:
            logger.info(f"Connected to {host} (session {session_id}, {hops}){banner_note}")

        return {
            "session_id": session_id,
            "connected": True,
            "server_banner": banner,
            "hop_count": hop_count,
        }
