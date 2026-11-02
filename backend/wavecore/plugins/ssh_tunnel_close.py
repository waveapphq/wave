"""
SSH Tunnel Close Plugin

Implements REQ-3.4.1.3 (SSH remote execution) and REQ-5.1.5 (SSH protocol
for node access): closes a forwarded tunnel by its Tunnel ID through the
run's SSHSessionRegistry; idempotent.
"""

from typing import Any

from wavecore.plugins.base import PluginBase


class SSHTunnelClosePlugin(PluginBase):
    """Closes a registered SSH tunnel by its Tunnel ID."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "ssh-tunnel-close",
            "name": "SSH Tunnel Close",
            "version": "1.0.0",
            "category": "remote",
            "description": (
                "Closes an open SSH tunnel and stops its local listener. "
                "Closing an unknown or already-closed tunnel is a no-op."
            ),
            "parameters": [
                {
                    "name": "tunnel_id",
                    "type": "string",
                    "required": True,
                    "description": (
                        "Handle identifying the open tunnel, as returned by SSH Tunnel Open"
                    ),
                },
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "closed",
                    "type": "boolean",
                    "description": (
                        "True when the tunnel was open and is now closed; false "
                        "when it was unknown or already closed"
                    ),
                },
            ],
            "author": "WAVE Framework",
            "tags": ["ssh", "network", "tunnel", "close"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate required params."""
        if not params.get("tunnel_id"):
            raise ValueError("Missing required parameter: tunnel_id")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Close the named tunnel; no-op when absent."""
        params = context["parameters"]
        registry = context.get("ssh_session_registry")
        if registry is None:
            return {"closed": False}
        return {"closed": registry.close_tunnel(params["tunnel_id"])}
