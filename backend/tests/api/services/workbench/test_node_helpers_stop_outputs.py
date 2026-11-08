"""A Stop binds what a local program printed before it (REQ-3.4.1.1, REQ-3.4.1.2, REQ-3.4.1.18).

A script WAVE stops on Stop or on shutdown returns Stdout, Stderr and Exit Code but no
exports (SHRUN-7, PYRUN-6), and the Exit Code reads 137 for every WAVE stop (SHRUN-15,
PYRUN-11). The Stop cancels the run while the block is still running; its bound variables
take what the program printed so far before the cancellation reaches the run.
"""

import asyncio
import contextlib
from pathlib import Path
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    make_node,
    start_graph,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.plugin_registry import register_plugin
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.plugins.python import PythonPlugin
from wavecore.plugins.shell_exec import ShellExecPlugin
from wavecore.plugins.shell_script import ShellScriptPlugin

pytestmark = pytest.mark.usefixtures("engine_registries")

STREAMS = {"stdout": "out", "stderr": "err", "exit_code": "code"}
STOPPED = {"out": "before-stop\n", "err": "warned\n", "code": 137}


def _prints_then_waits(ready: Path) -> str:
    """A line on each stream, a mark that both were written, then longer than any test."""
    return f'echo before-stop\necho warned >&2\necho ready > "{ready}"\nsleep 60\n'


def _shell_script(
    tmp_path: Path, script: str, bindings: dict[str, str], **config: Any
) -> dict[str, Any]:
    register_plugin(ShellScriptPlugin())
    return make_node(
        "shell-1",
        label="Shell Script",
        element_type="shell-script",
        node_type="plugin",
        config_values={
            "script": script,
            "shell": "/bin/bash",
            "timeout": 60,
            "working_dir": str(tmp_path),
            **config,
        },
        output_bindings=bindings,
        name="Long Script",
    )


def _shell_exec(tmp_path: Path, command: str) -> dict[str, Any]:
    register_plugin(ShellExecPlugin())
    return make_node(
        "shell-1",
        label="Shell Exec",
        element_type="shell-exec",
        node_type="plugin",
        config_values={
            "command": command,
            "shell": "/bin/sh",
            "timeout": 60,
            "working_dir": str(tmp_path),
        },
        output_bindings=dict(STREAMS),
        name="Long Command",
    )


def _python(tmp_path: Path, ready: Path) -> dict[str, Any]:
    register_plugin(PythonPlugin())
    script = (
        "import pathlib, sys, time\n"
        "print('before-stop', flush=True)\n"
        "sys.stderr.write('warned\\n')\n"
        "sys.stderr.flush()\n"
        f"pathlib.Path({str(ready)!r}).write_text('ready')\n"
        "time.sleep(60)\n"
    )
    return make_node(
        "python-1",
        label="Python",
        element_type="python",
        node_type="plugin",
        config_values={"script": script, "timeout": 60, "working_dir": str(tmp_path)},
        output_bindings=dict(STREAMS),
        name="Long Python",
    )


def _bound(variables: dict[str, Any]) -> dict[str, Any]:
    return {name: variables.get(name) for name in STOPPED}


async def _until_ready(ready: Path) -> None:
    for _ in range(500):
        if ready.exists():
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"the program never wrote {ready}")


async def _stop(
    session_id: str,
    node: dict[str, Any],
    variables: dict[str, Any],
    ready: Path,
    registry: SecretRegistry | None = None,
) -> None:
    """Run the one block until it has printed, then Stop the run the way the workbench does."""
    session, task = start_graph(session_id, [node], [edge("start-node", node["id"])], variables)
    if registry is not None:
        session["secret_registry"] = registry
    _wb_common._active_tasks[session_id] = task
    try:
        await _until_ready(ready)
        workbench_service.stop_workbench_run(session_id=session_id)
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)
    finally:
        _wb_common._active_tasks.pop(session_id, None)


class TestAUserStop:
    """The block's Stdout, Stderr and Exit Code variables hold what the Stop cut short."""

    async def test_a_shell_script_binds_what_it_printed_and_137(self, tmp_path: Path) -> None:
        ready = tmp_path / "ready"
        variables: dict[str, Any] = {}
        node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))

        await _stop("stop-shell-script", node, variables, ready)

        assert _bound(variables) == STOPPED

    async def test_a_shell_exec_binds_what_it_printed_and_137(self, tmp_path: Path) -> None:
        ready = tmp_path / "ready"
        variables: dict[str, Any] = {}
        node = _shell_exec(tmp_path, _prints_then_waits(ready))

        await _stop("stop-shell-exec", node, variables, ready)

        assert _bound(variables) == STOPPED

    async def test_a_python_block_binds_what_it_printed_and_137(self, tmp_path: Path) -> None:
        ready = tmp_path / "ready"
        variables: dict[str, Any] = {}

        await _stop("stop-python", _python(tmp_path, ready), variables, ready)

        assert _bound(variables) == STOPPED

    async def test_an_export_keeps_the_value_it_had(self, tmp_path: Path) -> None:
        ready = tmp_path / "ready"
        variables: dict[str, Any] = {"count": 5}
        node = _shell_script(
            tmp_path,
            "COUNT=9\n" + _prints_then_waits(ready),
            {**STREAMS, "COUNT": "count"},
            script_variables=["COUNT"],
        )

        await _stop("stop-shell-script-export", node, variables, ready)

        assert variables["count"] == 5
        assert _bound(variables) == STOPPED

    async def test_a_secret_stdout_flags_the_variable_it_binds(self, tmp_path: Path) -> None:
        ready = tmp_path / "ready"
        node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))
        node["data"]["config"]["outputSecretFields"] = ["stdout"]
        registry = SecretRegistry()

        await _stop("stop-shell-script-secret", node, {}, ready, registry)

        assert registry.is_secret_name("out") is True
        assert "before-stop\n" in registry.scan_values()


class TestAServerShutdown:
    """The shutdown cancel binds the same outputs before the run's terminal record is taken."""

    async def test_the_terminal_snapshot_holds_what_the_script_printed(
        self, tmp_path: Path
    ) -> None:
        session_id = "shutdown-shell-script"
        ready = tmp_path / "ready"
        node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))
        variables: dict[str, Any] = {}
        seen: dict[str, Any] = {}

        def capture(sid: str, status: str, halt_scope: Any = None) -> None:
            if sid == session_id and "variables" not in seen:
                seen["variables"] = (_wb_common.get_session_snapshot(sid) or {})["variables"]

        _, task = start_graph(session_id, [node], [edge("start-node", "shell-1")], variables)
        _wb_common._active_tasks[session_id] = task
        _wb_common.register_terminal_callback(capture)
        try:
            await _until_ready(ready)
            await _wb_common._clear_sessions()
        finally:
            _wb_common.unregister_terminal_callback(capture)

        assert _bound(variables) == STOPPED
        assert _bound(seen["variables"]) == STOPPED
