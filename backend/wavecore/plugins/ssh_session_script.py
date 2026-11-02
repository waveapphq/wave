"""
SSH Session Script Plugin

Implements REQ-3.4.1.3 (SSH remote execution) and REQ-5.1.5 (SSH protocol
for node access): runs a script on a live SSH session from the run's
SSHSessionRegistry by piping it to a chosen interpreter's stdin, capturing
stdout, stderr, and the exit code.
"""

import asyncio
import shlex
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
    require_utf8,
    run_and_release,
    safe_decode,
    session_id_param,
)
from wavecore.plugins.base import PluginBase

_DEFAULT_INTERPRETER = "/bin/sh"


class SSHSessionScriptPlugin(PluginBase):
    """Pipes a script to an interpreter on a live registered SSH session."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "ssh-session-script",
            "name": "SSH Session Script",
            "version": "1.0.0",
            "category": "remote",
            "description": (
                "Runs a script on an open SSH session by piping it to a chosen "
                "interpreter's stdin (default /bin/sh) and captures its stdout, "
                "stderr, and exit code. No file is uploaded to the remote host."
            ),
            "parameters": [
                session_id_param(),
                {
                    "name": "script",
                    "type": "string",
                    "required": True,
                    "description": ("Script piped to the interpreter on the remote host via stdin"),
                },
                {
                    "name": "interpreter",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": _DEFAULT_INTERPRETER,
                    "description": (
                        "Interpreter that reads the script from stdin, e.g. /bin/sh, "
                        "bash, python3, perl, or node. May include flags. Default: /bin/sh."
                    ),
                },
                {
                    "name": "working_dir",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": "Directory to change into before running the interpreter",
                },
                timeout_parameter(300, "Execution timeout in seconds. Default: 300 (5 minutes)."),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "stdout",
                    "type": "string",
                    "description": "Standard output captured from the script",
                },
                {
                    "name": "stderr",
                    "type": "string",
                    "description": "Standard error captured from the script",
                },
                {
                    "name": "exit_code",
                    "type": "integer",
                    "description": (
                        "Exit code returned by the interpreter; non-zero codes are "
                        "returned, not raised"
                    ),
                },
            ],
            "author": "WAVE Framework",
            "tags": ["ssh", "network", "session", "script"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate required params and the timeout bound."""
        if not params.get("session_id"):
            raise ValueError("Missing required parameter: session_id")
        if not params.get("script"):
            raise ValueError("Missing required parameter: script")
        check_integer(params, "timeout")
        check_at_least(params, "timeout", 1, "Timeout must be at least 1")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Pipe the script to the interpreter on the registered session's connection."""
        params = context["parameters"]
        registry = context.get("ssh_session_registry")

        session_id = params["session_id"]
        script = params["script"]
        interpreter = params.get("interpreter") or _DEFAULT_INTERPRETER
        working_dir = params.get("working_dir")
        timeout = params.get("timeout")
        if blank_number(timeout):
            timeout = 300

        record = require_session(registry, session_id)

        require_utf8("Interpreter", interpreter)
        if working_dir:
            require_utf8("Working Directory", working_dir)
        command = (
            f"cd {shlex.quote(working_dir)} && exec {interpreter}" if working_dir else interpreter
        )

        try:
            async with asyncio.timeout(timeout):
                result = await run_and_release(record["connection"], command, script=script)
        except TimeoutError as exc:
            raise command_timed_out(timeout) from exc

        return {
            "stdout": safe_decode(result.stdout),
            "stderr": safe_decode(result.stderr),
            "exit_code": result.exit_status,
        }
