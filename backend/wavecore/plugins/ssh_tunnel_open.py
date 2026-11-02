"""
SSH Tunnel Open Plugin

Implements REQ-3.4.1.3 (SSH remote execution) and REQ-5.1.5 (SSH protocol
for node access): forwards a loopback local port to a remote host:port
through an open SSH session from the run's SSHSessionRegistry, like ssh -L
(SSHTUN-6), optionally checking the destination once at open (SSHTUN-7).
"""

import uuid
from typing import Any, cast

from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins._ports import check_port
from wavecore.plugins._shared_params import check_boolean, number_setting
from wavecore.plugins._ssh_forward import start_forwarder, tunnel_failed, validate_target
from wavecore.plugins._ssh_session import require_session, session_id_param
from wavecore.plugins.base import PluginBase


class SSHTunnelOpenPlugin(PluginBase):
    """Forwards a local port through a live registered SSH session."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "ssh-tunnel-open",
            "name": "SSH Tunnel Open",
            "version": "1.0.0",
            "category": "remote",
            "description": (
                "Forwards a local port to a remote host and port through an open SSH "
                "session, like ssh -L: each connection to the Local Port reaches the "
                "destination afresh, and one the SSH host refuses is logged as a warning. "
                "Validate Target checks the destination once at open. The tunnel lives "
                "until closed by SSH Tunnel Close or until its session closes."
            ),
            "parameters": [
                session_id_param(),
                {
                    "name": "local_port",
                    "type": "integer",
                    "required": False,
                    "default": 0,
                    "minimum": 0,
                    "maximum": 65535,
                    "description": "Local port to listen on; 0 auto-assigns a free port",
                },
                {
                    "name": "remote_host",
                    "type": "string",
                    "required": True,
                    "description": (
                        "Destination host to forward to, resolved from the session's remote end"
                    ),
                },
                {
                    "name": "remote_port",
                    "type": "integer",
                    "required": True,
                    "minimum": 1,
                    "maximum": 65535,
                    "description": "Destination port to forward to",
                },
                {
                    "name": "validate_target",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Connects to the target once when the tunnel opens and fails if the "
                        "SSH host refuses or cannot reach it. That connection is handed to the "
                        "first block that uses the tunnel."
                    ),
                },
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "tunnel_id",
                    "type": "string",
                    "description": (
                        "Handle identifying the open tunnel; SSH Tunnel Close references it"
                    ),
                },
                {
                    "name": "local_port",
                    "type": "integer",
                    "description": (
                        "Local port the tunnel listens on; the auto-assigned "
                        "port when 0 was requested"
                    ),
                },
            ],
            "author": "WAVE Framework",
            "tags": ["ssh", "network", "tunnel", "port-forward"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate required params, port ranges and Validate Target."""
        if not params.get("session_id"):
            raise ValueError("Missing required parameter: session_id")
        if not params.get("remote_host"):
            raise ValueError("Missing required parameter: remote_host")
        if "remote_port" not in params:
            raise ValueError("Missing required parameter: remote_port")
        check_port("remote_port", params["remote_port"], 1)
        if params.get("local_port") is not None:
            check_port("local_port", params["local_port"], 0)
        check_boolean(params, "validate_target")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Bind the loopback Local Port, check the target when asked, and register the tunnel."""
        params = context["parameters"]
        logger = context["logger"]
        registry = context.get("ssh_session_registry")

        session_id = params["session_id"]
        remote_host = params["remote_host"]
        remote_port = params["remote_port"]

        record = require_session(registry, session_id)
        # registry is non-None here: require_session raised otherwise
        registry = cast(SSHSessionRegistry, registry)

        tunnel_id = f"tunnel_{uuid.uuid4().hex[:12]}"
        try:
            listener = await start_forwarder(
                record,
                tunnel_id,
                number_setting(params, "local_port", 0),
                remote_host,
                remote_port,
                logger,
            )
        except OSError as exc:
            raise tunnel_failed(remote_host, remote_port, str(exc) or type(exc).__name__) from exc

        try:
            held = (
                await validate_target(record, remote_host, remote_port)
                if params.get("validate_target")
                else None
            )
        except BaseException:
            listener.close()
            raise

        local_port = listener.get_port()
        registry.add_tunnel(
            session_id,
            tunnel_id,
            listener,
            local_port,
            f"{remote_host}:{remote_port}",
            held=held,
        )
        logger.debug(
            f"Opened tunnel {tunnel_id}: localhost:{local_port} -> {remote_host}:{remote_port}"
        )

        return {"tunnel_id": tunnel_id, "local_port": local_port}
