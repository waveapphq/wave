"""
SSH Session Close Plugin

Implements REQ-3.4.1.3 (SSH remote execution) and REQ-5.1.5 (SSH protocol
for node access): closes a named SSH session through the run's
SSHSessionRegistry, cascading to every descendant session; idempotent.
"""

from typing import Any

from wavecore.plugins._ssh_session import session_id_param
from wavecore.plugins.base import PluginBase


class SSHSessionClosePlugin(PluginBase):
    """Closes a registered SSH session and its descendant chain."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "ssh-session-close",
            "name": "SSH Session Close",
            "version": "1.0.0",
            "category": "remote",
            "description": (
                "Closes an open SSH session and every session chained through it "
                "(child before parent). Closing an unknown or already-closed "
                "session is a no-op."
            ),
            "parameters": [
                session_id_param(),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "closed_session_ids",
                    "type": "array",
                    "description": (
                        "Session IDs actually closed, descendants first; empty when "
                        "the session was unknown or already closed"
                    ),
                },
            ],
            "author": "WAVE Framework",
            "tags": ["ssh", "network", "session", "close"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate required params."""
        if not params.get("session_id"):
            raise ValueError("Missing required parameter: session_id")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Close the named session (cascade to descendants); no-op when absent."""
        params = context["parameters"]
        registry = context.get("ssh_session_registry")
        if registry is None:
            return {"closed_session_ids": []}
        return {"closed_session_ids": registry.close(params["session_id"])}
