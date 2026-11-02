"""A Stop cancels every Parallel lane (REQ-3.2.3.8, REQ-3.2.2.4).

Canceling the run task cancels each lane still working and awaits it before
the cancellation reaches the caller, so a block owns every process it started
and a Stop ends them (SHRUN-15): a Shell Script inside a lane has its whole
tree killed. Each lane the Stop cut short reports itself stopped once, and the
section reports no time limit, because no limit expired.
"""

import asyncio
import contextlib
import re
import time
from pathlib import Path
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    delay_node,
    edge,
    engine_registries,
    log_messages,
    log_node,
    make_node,
    parallel_node,
    start_graph,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.plugin_registry import register_plugin
from wavecore.plugins.shell_script import ShellScriptPlugin

pytestmark = pytest.mark.usefixtures("engine_registries")

_STOPPED_INGEST = re.compile(r"^Branch 'ingest' stopped$")
_STOPPED_PROBE = re.compile(r"^Branch 'probe' stopped$")
_STOPPED_QUICK = re.compile(r"^Branch 'quick' stopped$")
_SECTION_LIMIT = re.compile(r"^Parallel section exceeded its time limit of \d+ ms$")
# A group SIGKILL is sent before the caller resumes; the kernel ends the process a moment later.
_GONE_WAIT_S = 2.0
_GONE_POLL_S = 0.005


def _pid_is_gone(pid: int) -> bool:
    """True when the pid names no live process; a zombie counts as gone."""
    try:
        stat_line = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    except OSError:
        return True
    fields = stat_line.rsplit(")", 1)[-1].split()
    return not fields or fields[0] == "Z"


async def _until_gone(pid: int, message: str) -> None:
    """Poll to a short bound; the wait ends the moment the pid is gone."""
    deadline = time.monotonic() + _GONE_WAIT_S
    while time.monotonic() < deadline:
        if _pid_is_gone(pid):
            return
        await asyncio.sleep(_GONE_POLL_S)
    raise AssertionError(message)


def _shell_script_node(node_id: str, script: str, name: str) -> dict[str, Any]:
    """A Shell Script node running ``script`` under bash on the WAVE server."""
    return make_node(
        node_id,
        label="Shell Script",
        element_type="shell-script",
        node_type="plugin",
        config_values={
            "script": script,
            "shell": "/bin/bash",
            "timeout": 60,
            "on_error": "fail",
        },
        name=name,
    )


def _three_lanes(ingest_body: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Two lanes that outlast the Stop, and one that finishes before it lands."""
    nodes = [
        parallel_node(
            "par-1",
            [
                branch("branch_1", "ingest"),
                branch("branch_2", "probe"),
                branch("branch_3", "quick"),
            ],
        ),
        ingest_body,
        delay_node("br-b", 5000, "Probe Body"),
        log_node("br-c", "Quick Body", "'QUICK'"),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "par-1"),
        edge("par-1", "br-a", "branch_1"),
        edge("par-1", "br-b", "branch_2"),
        edge("par-1", "br-c", "branch_3"),
        edge("par-1", "after", "then"),
    ]
    return nodes, edges


def _delay_lanes() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return _three_lanes(delay_node("br-a", 5000, "Ingest Body"))


async def _wait_for_states(session: dict[str, Any], wanted: dict[str, str]) -> None:
    """Poll until every named block reads the state wanted, or the budget ends."""
    for _ in range(500):
        await asyncio.sleep(0.01)
        states = session["block_states"]
        if all(states.get(node_id) == state for node_id, state in wanted.items()):
            return
    raise AssertionError(f"blocks never settled as {wanted}: {dict(session['block_states'])}")


async def _wait_for_pid(pid_file: Path) -> int:
    """Poll until the script has written the pid of the job it started."""
    for _ in range(500):
        await asyncio.sleep(0.01)
        if pid_file.exists():
            text = pid_file.read_text().strip()
            if text:
                return int(text)
    raise AssertionError(f"the script never wrote a pid to {pid_file}")


async def _cancel_run(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    wanted: dict[str, str],
) -> dict[str, Any]:
    """Run until ``wanted`` holds, cancel the run task, absorb the cancellation."""
    session, task = start_graph(session_id, nodes, edges, {})
    await _wait_for_states(session, wanted)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await asyncio.wait_for(task, timeout=5.0)
    return session


async def _stop_run(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    wanted: dict[str, str],
) -> dict[str, Any]:
    """Run until ``wanted`` holds, then Stop it the way the workbench does."""
    session, task = start_graph(session_id, nodes, edges, {})
    _wb_common._active_tasks[session_id] = task
    try:
        await _wait_for_states(session, wanted)
        workbench_service.stop_workbench_run(session_id=session_id)
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)
    finally:
        _wb_common._active_tasks.pop(session_id, None)
    return session


_IN_FLIGHT = {"par-1": "running", "br-a": "running", "br-b": "running", "br-c": "passed"}


class TestCancelingTheRunCancelsEveryLane:
    """The join settles every pending lane and lets the cancellation through."""

    async def test_the_cancellation_reaches_the_caller(self) -> None:
        session_id = "par-cancel-reraise"
        nodes, edges = _delay_lanes()
        session, task = start_graph(session_id, nodes, edges, {})
        await _wait_for_states(session, _IN_FLIGHT)

        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)

    async def test_every_in_flight_lane_block_paints_stopped(self) -> None:
        nodes, edges = _delay_lanes()

        session = await _cancel_run("par-cancel-painted", nodes, edges, _IN_FLIGHT)

        assert session["block_states"]["br-a"] == "stopped", session["block_states"]
        assert session["block_states"]["br-b"] == "stopped", session["block_states"]

    async def test_no_block_is_left_running(self) -> None:
        nodes, edges = _delay_lanes()

        session = await _cancel_run("par-cancel-running", nodes, edges, _IN_FLIGHT)

        still_running = [
            node_id for node_id, state in session["block_states"].items() if state == "running"
        ]
        assert still_running == [], session["block_states"]

    async def test_a_lane_that_finished_keeps_its_own_outcome(self) -> None:
        # Guard: settling the section must not repaint a lane that completed.
        nodes, edges = _delay_lanes()

        session = await _cancel_run("par-cancel-finished", nodes, edges, _IN_FLIGHT)

        assert session["block_states"]["br-c"] == "passed", session["block_states"]

    async def test_the_exit_lane_never_runs(self) -> None:
        nodes, edges = _delay_lanes()

        await _cancel_run("par-cancel-exit-lane", nodes, edges, _IN_FLIGHT)

        assert "AFTER" not in log_messages("par-cancel-exit-lane")


class TestAShellScriptLaneHasItsTreeKilled:
    """SHRUN-15: the lane's process group dies before the caller resumes."""

    async def test_the_background_pid_is_gone_when_the_cancellation_lands(
        self, tmp_path: Path
    ) -> None:
        register_plugin(ShellScriptPlugin())
        pid_file = tmp_path / "child.pid"
        script = f"sleep 999 &\necho $! > {pid_file}\nsleep 60\n"
        nodes, edges = _three_lanes(_shell_script_node("br-a", script, "Ingest Body"))
        session, task = start_graph("par-cancel-tree", nodes, edges, {})
        pid = await _wait_for_pid(pid_file)

        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)

        await _until_gone(pid, f"pid {pid} outlived the canceled lane")
        assert session["block_states"]["br-a"] == "stopped", session["block_states"]

    async def test_a_stop_kills_the_tree_too(self, tmp_path: Path) -> None:
        register_plugin(ShellScriptPlugin())
        pid_file = tmp_path / "child.pid"
        script = f"sleep 999 &\necho $! > {pid_file}\nsleep 60\n"
        nodes, edges = _three_lanes(_shell_script_node("br-a", script, "Ingest Body"))
        session_id = "par-cancel-tree-stop"
        session, task = start_graph(session_id, nodes, edges, {})
        _wb_common._active_tasks[session_id] = task
        try:
            pid = await _wait_for_pid(pid_file)
            workbench_service.stop_workbench_run(session_id=session_id)
            with contextlib.suppress(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=5.0)
        finally:
            _wb_common._active_tasks.pop(session_id, None)

        await _until_gone(pid, f"pid {pid} outlived the stopped lane")
        assert session["status"] == "stopped", session.get("status")


class TestEachStoppedLaneIsReportedOnce:
    """Every lane the Stop cut short names itself in the run log, one line each."""

    async def test_each_running_lane_logs_one_stopped_line(self) -> None:
        session_id = "par-cancel-log"
        nodes, edges = _delay_lanes()

        await _stop_run(session_id, nodes, edges, _IN_FLIGHT)

        messages = log_messages(session_id)
        assert sum(1 for line in messages if _STOPPED_INGEST.match(line)) == 1, messages
        assert sum(1 for line in messages if _STOPPED_PROBE.match(line)) == 1, messages

    async def test_a_lane_that_finished_is_not_reported_stopped(self) -> None:
        session_id = "par-cancel-log-quick"
        nodes, edges = _delay_lanes()

        await _stop_run(session_id, nodes, edges, _IN_FLIGHT)

        messages = log_messages(session_id)
        assert not any(_STOPPED_QUICK.match(line) for line in messages), messages

    async def test_the_stopped_lane_blocks_are_painted_stopped(self) -> None:
        session_id = "par-cancel-stop-painted"
        nodes, edges = _delay_lanes()

        session = await _stop_run(session_id, nodes, edges, _IN_FLIGHT)

        assert session["block_states"]["br-a"] == "stopped", session["block_states"]
        assert session["block_states"]["br-b"] == "stopped", session["block_states"]
        assert "running" not in session["block_states"].values(), session["block_states"]

    async def test_the_section_reports_no_time_limit(self) -> None:
        # A Stop is not an expired limit: the section must not blame one.
        session_id = "par-cancel-no-limit"
        nodes, edges = _delay_lanes()

        await _stop_run(session_id, nodes, edges, _IN_FLIGHT)

        messages = log_messages(session_id)
        assert not any(_SECTION_LIMIT.match(line) for line in messages), messages
