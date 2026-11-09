"""A Stop binds what a local program printed before it (REQ-3.4.1.1, REQ-3.4.1.2, REQ-3.4.1.18).

A script WAVE stops on Stop or on shutdown returns Stdout, Stderr and Exit Code but no
exports (SHRUN-7, PYRUN-6), and the Exit Code reads 137 for every WAVE stop (SHRUN-15,
PYRUN-11). The Stop cancels the run while the block is still running; its bound variables
take what the program printed so far before the cancellation reaches the run.
"""

import asyncio
import contextlib
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    make_node,
    start_graph,
)
from tests.conftest import TEST_ENVIRONMENT_ID
from wavecore.api.services import log_streaming_service
from wavecore.api.services.executions import _sequential
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.storage_paths import get_artifacts_storage_path
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


def _start_tracked_execution(test_id: str) -> str:
    """A tracked test execution whose run the test drives itself; its logs land on disk."""
    with (
        patch.object(
            execution_service, "_get_entity", return_value={"id": test_id, "name": "Long Test"}
        ),
        patch.object(execution_service, "_launch_execution_runner"),
    ):
        execution_id = str(
            execution_service.start_execution(
                entity_type="test", entity_id=test_id, environment_id=TEST_ENVIRONMENT_ID
            )["id"]
        )
    log_streaming_service.register_log_sink(execution_id, execution_id, execution_id, test_id)
    return execution_id


async def _stop_tracked(execution_id: str, test_id: str, node: dict[str, Any], ready: Path) -> None:
    """Run the one block as the tracked run until it has printed, then Stop the execution."""
    session, task = start_graph(execution_id, [node], [edge("start-node", node["id"])], {})
    session.update(execution_id=execution_id, test_id=test_id, test_name="Long Test")
    _wb_common._active_tasks[execution_id] = task
    try:
        await _until_ready(ready)
        execution_service.stop_execution(execution_id)
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)
    finally:
        _wb_common._active_tasks.pop(execution_id, None)


class TestATrackedRunStop:
    """A user Stop stores the outputs the stopped block binds, as a shutdown does."""

    @pytest.fixture(autouse=True)
    def _clean_executions(self) -> Iterator[None]:
        exec_storage._clear_storage()
        yield
        exec_storage._clear_storage()

    async def test_the_stored_snapshot_and_variables_hold_what_the_script_printed(
        self, tmp_path: Path
    ) -> None:
        test_id = str(uuid.uuid4())
        ready = tmp_path / "ready"
        execution_id = _start_tracked_execution(test_id)
        try:
            node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))
            await _stop_tracked(execution_id, test_id, node, ready)
        finally:
            log_streaming_service.unregister_log_sink(execution_id)

        snapshot = exec_storage._load_snapshot(execution_id, execution_id) or {}
        assert snapshot["status"] == "stopped"
        assert _bound(snapshot["variables"]) == STOPPED
        assert _bound(execution_service.get_execution_variables(execution_id) or {}) == STOPPED

    async def test_the_record_keeps_the_end_time_the_stop_gave_it(self, tmp_path: Path) -> None:
        test_id = str(uuid.uuid4())
        ready = tmp_path / "ready"
        execution_id = _start_tracked_execution(test_id)
        ended: dict[str, Any] = {}

        def capture(sid: str, status: str, halt_scope: Any = None) -> None:
            if sid == execution_id and not ended:
                ended.update(exec_storage._execution_storage[sid])

        _wb_common.register_terminal_callback(capture)
        try:
            node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))
            await _stop_tracked(execution_id, test_id, node, ready)
        finally:
            _wb_common.unregister_terminal_callback(capture)
            log_streaming_service.unregister_log_sink(execution_id)

        record = exec_storage._execution_storage[execution_id]
        assert record["status"] == "stopped"
        assert (record["ended_at"], record["duration"]) == (ended["ended_at"], ended["duration"])

    async def test_the_stored_log_file_ends_with_the_stop_line(self, tmp_path: Path) -> None:
        test_id = str(uuid.uuid4())
        ready = tmp_path / "ready"
        execution_id = _start_tracked_execution(test_id)
        try:
            node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))
            await _stop_tracked(execution_id, test_id, node, ready)
        finally:
            log_streaming_service.unregister_log_sink(execution_id)

        artifact_dir = exec_storage._execution_storage[execution_id]["artifact_dir"]
        log_file = get_artifacts_storage_path() / artifact_dir / "logs" / "Long Test.log"
        last_line = log_file.read_text(encoding="utf-8").splitlines()[-1]
        assert last_line.split(" ", 1)[1] == "WARN Test 'Long Test' execution stopped by user"


def _seed_sequential_execution(entity_type: str, test_id: str) -> str:
    """A running suite or regression execution of one test, whose run the test drives itself."""
    execution_id = str(uuid.uuid4())
    entity_id = str(uuid.uuid4())
    execution = {
        "id": execution_id,
        "name": "Long Run",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "environment_id": TEST_ENVIRONMENT_ID,
        "status": "running",
        "started_at": "2026-04-22T00:00:00+00:00",
    }
    exec_storage._save_execution(execution)
    exec_storage._execution_storage[execution_id] = execution
    tests = [{"id": test_id, "name": "Long Test", "run_id": "run-1"}]
    composition = {"suites": [{"id": "suite-1", "name": "Long Suite", "tests": tests}]}
    exec_storage._save_composition(execution_id, composition)
    exec_storage._init_runtime_state(execution_id, execution["started_at"], composition, None)
    return execution_id


async def _stop_child(
    execution_id: str,
    entity_type: str,
    test_id: str,
    node: dict[str, Any],
    ready: Path,
    before_unwind: Callable[[], None] = lambda: None,
) -> dict[str, Any]:
    """Run the one block as the execution's child run until it has printed, then Stop it."""
    children: list[asyncio.Task[None]] = []

    def start(**kwargs: Any) -> dict[str, Any]:
        child_id = kwargs["session_id"]
        session, task = start_graph(child_id, [node], [edge("start-node", node["id"])], {})
        session.update(test_id=test_id, test_name="Long Test")
        _wb_common._active_tasks[child_id] = task
        children.append(task)
        return {"session_id": child_id, "status": "running", "test_id": test_id}

    run_test = _sequential._build_run_test(
        execution_id,
        TEST_ENVIRONMENT_ID,
        parent_entity_type=entity_type,
        parent_entity_id=exec_storage._execution_storage[execution_id]["entity_id"],
        default_suite_id="suite-1",
    )
    with patch.object(workbench_service, "start_workbench_run", side_effect=start):
        run = asyncio.ensure_future(
            run_test({"run_id": "run-1", "test_id": test_id, "suite_id": "suite-1"})
        )
        await _until_ready(ready)
    execution_service.stop_execution(execution_id)
    result = await asyncio.wait_for(run, timeout=5.0)
    before_unwind()
    with contextlib.suppress(asyncio.CancelledError):
        await asyncio.wait_for(children[0], timeout=5.0)
    return result


@pytest.mark.parametrize("entity_type", ["suite", "regression"])
class TestASequentialChildStop:
    """A Stop of a suite or regression stores the outputs its stopped child's block binds."""

    @pytest.fixture(autouse=True)
    def _clean_executions(self) -> Iterator[None]:
        exec_storage._clear_storage()
        yield
        exec_storage._clear_storage()

    async def test_the_stored_child_snapshot_holds_what_the_script_printed(
        self, tmp_path: Path, entity_type: str
    ) -> None:
        test_id = str(uuid.uuid4())
        ready = tmp_path / "ready"
        execution_id = _seed_sequential_execution(entity_type, test_id)
        node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))

        result = await _stop_child(execution_id, entity_type, test_id, node, ready)

        snapshot = exec_storage._load_snapshot(execution_id, "run-1") or {}
        assert (result["status"], snapshot["status"]) == ("stopped", "stopped")
        assert snapshot["block_states"] == {"shell-1": "stopped"}
        assert _bound(snapshot["variables"]) == STOPPED

    async def test_the_child_run_records_one_stop(self, tmp_path: Path, entity_type: str) -> None:
        test_id = str(uuid.uuid4())
        ready = tmp_path / "ready"
        execution_id = _seed_sequential_execution(entity_type, test_id)
        node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))

        result = await _stop_child(execution_id, entity_type, test_id, node, ready)

        transitions = [
            (entry["status"], entry.get("duration"))
            for entry in exec_storage._load_status(execution_id)
            if entry["run_id"] == "run-1"
        ]
        assert transitions == [("running", None), ("stopped", result["duration"])]

    async def test_a_run_deleted_before_its_child_unwinds_keeps_no_snapshot(
        self, tmp_path: Path, entity_type: str
    ) -> None:
        test_id = str(uuid.uuid4())
        ready = tmp_path / "ready"
        execution_id = _seed_sequential_execution(entity_type, test_id)
        node = _shell_script(tmp_path, _prints_then_waits(ready), dict(STREAMS))

        def delete_the_stopped_run() -> None:
            _sequential._finalize_execution(execution_id, "stopped")
            assert execution_service.delete_execution(execution_id) is True

        await _stop_child(execution_id, entity_type, test_id, node, ready, delete_the_stopped_run)

        assert exec_storage._snapshot_file(execution_id, "run-1").exists() is False
        assert exec_storage._execution_storage.get(execution_id) is None
