"""
SSH Session Exec Plugin

Implements REQ-3.4.1.3 (SSH remote execution) and REQ-5.1.5 (SSH protocol
for node access): runs one independent command on a live SSH session from
the run's SSHSessionRegistry (no shell-state carryover between commands).
"""

import asyncio
from typing import Any

from wavecore.plugins._shared_params import (
    blank_number,
    check_at_least,
    check_integer,
    timeout_parameter,
)
from wavecore.plugins._ssh_session import (
    command_timed_out,
    require_session,
    run_and_release,
    safe_decode,
    session_id_param,
)
from wavecore.plugins.base import PluginBase


class SSHSessionExecPlugin(PluginBase):
    """Runs one command on a live registered SSH session."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "ssh-session-exec",
            "name": "SSH Session Exec",
            "version": "1.0.0",
            "category": "remote",
            "description": (
                "Executes one command on an open SSH session and captures its "
                "stdout, stderr, and exit code. Each command runs independently - "
                "no shell state carries over between executions."
            ),
            "parameters": [
                session_id_param(),
                {
                    "name": "command",
                    "type": "string",
                    "required": True,
                    "description": "Command line to execute on the remote host",
                },
                timeout_parameter(300, "Execution timeout in seconds. Default: 300 (5 minutes)."),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "stdout",
                    "type": "string",
                    "description": "Standard output captured from the command",
                },
                {
                    "name": "stderr",
                    "type": "string",
                    "description": "Standard error captured from the command",
                },
                {
                    "name": "exit_code",
                    "type": "integer",
                    "description": (
                        "Exit code returned by the command; non-zero codes are "
                        "returned, not raised"
                    ),
                },
            ],
            "author": "WAVE Framework",
            "tags": ["ssh", "network", "session", "execute"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate required params and the timeout bound."""
        if not params.get("session_id"):
            raise ValueError("Missing required parameter: session_id")
        if not params.get("command"):
            raise ValueError("Missing required parameter: command")
        check_integer(params, "timeout")
        check_at_least(params, "timeout", 1, "Timeout must be at least 1")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the command on the registered session's live connection."""
        params = context["parameters"]
        registry = context.get("ssh_session_registry")

        session_id = params["session_id"]
        command = params["command"]
        timeout = params.get("timeout")
        if blank_number(timeout):
            timeout = 300

        record = require_session(registry, session_id)

        try:
            async with asyncio.timeout(timeout):
                result = await run_and_release(record["connection"], command)
        except TimeoutError as exc:
            raise command_timed_out(timeout) from exc

        return {
            "stdout": safe_decode(result.stdout),
            "stderr": safe_decode(result.stderr),
            "exit_code": result.exit_status,
        }
