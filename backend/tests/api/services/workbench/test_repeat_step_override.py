"""Repeat Step with a one-shot parameter override (PYRUN-21, REQ-3.2.1.4).

The Python editor's Run is Repeat Step with the editor's script substituted for that one
execution. The substituted script is what runs - its stdout proves it - the saved block is
untouched, a following repeat without an override runs the saved script again, an override on
the script body runs in Source mode whatever the saved Script Type, and an override naming a
block that is not the paused one is refused with a 409.
"""

import asyncio
import contextlib
import re
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    log_messages,
    make_node,
    make_session,
    start_graph,
    wait_until_paused,
)
from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.plugin_registry import register_plugin
from wavecore.plugins.python import PythonPlugin

NODE_ID = "py-1"
OTHER_NODE_ID = "py-2"
SAVED_SOURCE = 'print("SAVED-STDOUT")'
OVERRIDE_SOURCE = 'print("OVERRIDE-STDOUT")'
FILE_SOURCE = 'print("FILE-STDOUT")'
WRONG_NODE_MESSAGE = "Cannot repeat: override targets a block that is not paused"
_WRONG_NODE_RE = f"^{re.escape(WRONG_NODE_MESSAGE)}$"
_REPEAT_LINE = "⟳ Repeated"
_TICKS = 500


def _script_override(node_id: str = NODE_ID, value: str = OVERRIDE_SOURCE) -> dict[str, Any]:
    """The override the Python editor's Run sends: one parameter of one block."""
    return {"node_id": node_id, "parameter": "script", "value": value}


def _repeat_result(session_id: str) -> dict[str, Any]:
    return {"session_id": session_id, "status": "paused", "repeated_node_id": NODE_ID}


def _strings(value: Any) -> Iterator[str]:
    """Every string anywhere inside a session dict."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _strings(key)
            yield from _strings(item)
    elif isinstance(value, list | tuple | set | frozenset):
        for item in value:
            yield from _strings(item)


def _holds(value: Any, text: str) -> bool:
    return any(text in found for found in _strings(value))


def _python_node(values: dict[str, Any], node_id: str = NODE_ID) -> dict[str, Any]:
    return make_node(
        node_id,
        label="Python",
        element_type="python",
        node_type="plugin",
        config_values=values,
        output_bindings={"stdout": "out"},
        name="Python",
    )


def _settings(work_dir: Path, **values: Any) -> dict[str, Any]:
    return {"working_dir": str(work_dir), "timeout": 30, "on_error": "fail", **values}


def _source_node(work_dir: Path) -> dict[str, Any]:
    return _python_node(_settings(work_dir, script_type="source", script=SAVED_SOURCE))


def _file_node(work_dir: Path, script_file: Path) -> dict[str, Any]:
    """A block saved in File mode that also carries a saved Source body."""
    return _python_node(
        _settings(
            work_dir,
            script_type="file",
            script_file=str(script_file),
            script=SAVED_SOURCE,
        )
    )


@pytest.fixture
def python_plugin(request: pytest.FixtureRequest) -> None:
    """Core controls plus the Python block, with the session table cleared around the test."""
    request.getfixturevalue("engine_registries")
    register_plugin(PythonPlugin())


@dataclass
class _Paused:
    """A debug session parked on the Python block, with the run still alive."""

    session_id: str
    session: dict[str, Any]
    node: dict[str, Any]

    def _repeats(self) -> int:
        return sum(line.startswith(_REPEAT_LINE) for line in log_messages(self.session_id))

    async def _settle(self, done: int) -> None:
        for _ in range(_TICKS):
            if self._repeats() >= done:
                return
            await asyncio.sleep(0.01)

    async def repeat(self, override: dict[str, Any]) -> dict[str, Any]:
        done = self._repeats() + 1
        result = workbench_service.repeat_step(session_id=self.session_id, override=override)
        await self._settle(done)
        return result

    async def repeat_saved(self) -> dict[str, Any]:
        """Today's repeat: the Paused Toolbar's call, with no override at all."""
        done = self._repeats() + 1
        result = workbench_service.repeat_step(session_id=self.session_id)
        await self._settle(done)
        return result

    def stdout(self) -> str:
        return str(self.session["variables"].get("out") or "").strip()

    def stored(self, setting: str) -> Any:
        """A setting of the block as the run's copy of the stored workflow holds it."""
        node_map: dict[str, Any] = self.session.get("_node_map") or {}
        return node_map[self.node["id"]]["data"]["config"]["values"].get(setting)


@contextlib.asynccontextmanager
async def _paused_at(node: dict[str, Any]) -> AsyncIterator[_Paused]:
    """Run the one-block graph under a breakpoint on it; stop whatever is left at the end."""
    node_id = node["id"]
    session_id = str(uuid.uuid4())
    session, task = start_graph(
        session_id,
        [node],
        [edge("start-node", node_id)],
        {"out": ""},
        breakpoints={node_id},
    )
    try:
        await wait_until_paused(session, node_id, ticks=_TICKS)
        assert session.get("paused_node_id") == node_id, log_messages(session_id)
        yield _Paused(session_id, session, node)
    finally:
        if not task.done():
            session["status"] = "stopped"
            session["pause_event"].set()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await asyncio.wait_for(task, timeout=2)


@pytest.mark.usefixtures("python_plugin")
class TestARepeatWithAScriptOverride:
    """PYRUN-21: the repeat executes the substituted script for that one execution."""

    async def test_the_substituted_script_is_what_runs(self, tmp_path: Path) -> None:
        async with _paused_at(_source_node(tmp_path)) as run:
            await run.repeat(_script_override())

            assert run.stdout() == "OVERRIDE-STDOUT", log_messages(run.session_id)

    async def test_the_stored_workflow_still_holds_the_saved_script(self, tmp_path: Path) -> None:
        async with _paused_at(_source_node(tmp_path)) as run:
            await run.repeat(_script_override())

            assert run.stored("script") == SAVED_SOURCE
            assert run.stored("script_type") == "source"

    async def test_a_following_repeat_without_an_override_runs_the_saved_script(
        self, tmp_path: Path
    ) -> None:
        async with _paused_at(_source_node(tmp_path)) as run:
            await run.repeat(_script_override())
            await run.repeat_saved()

            assert run.stdout() == "SAVED-STDOUT", log_messages(run.session_id)

    async def test_an_override_on_the_script_runs_in_source_mode_in_a_file_mode_block(
        self, tmp_path: Path
    ) -> None:
        script_file = tmp_path / "saved.py"
        script_file.write_text(f"{FILE_SOURCE}\n", encoding="utf-8")

        async with _paused_at(_file_node(tmp_path, script_file)) as run:
            await run.repeat(_script_override())

            assert run.stdout() == "OVERRIDE-STDOUT", log_messages(run.session_id)
            assert run.stored("script_type") == "file"
            assert run.stored("script_file") == str(script_file)

    async def test_the_substituted_value_never_lands_in_the_session_snapshot(
        self, tmp_path: Path
    ) -> None:
        async with _paused_at(_source_node(tmp_path)) as run:
            await run.repeat(_script_override())

            snapshot = _wb_common.get_session_snapshot(run.session_id)
            assert not _holds(snapshot, OVERRIDE_SOURCE), snapshot
            assert not _holds(run.session, OVERRIDE_SOURCE)

    async def test_a_repeat_with_no_override_is_todays_repeat(self, tmp_path: Path) -> None:
        async with _paused_at(_source_node(tmp_path)) as run:
            result = await run.repeat_saved()

            assert result == _repeat_result(run.session_id)
            assert run.stdout() == "SAVED-STDOUT", log_messages(run.session_id)

    async def test_an_override_that_names_another_block_is_refused(self, tmp_path: Path) -> None:
        async with _paused_at(_source_node(tmp_path)) as run:
            with pytest.raises(ConflictException, match=_WRONG_NODE_RE):
                workbench_service.repeat_step(
                    session_id=run.session_id,
                    override=_script_override(OTHER_NODE_ID),
                )


class TestTheRepeatStepRouteBody:
    """POST /workbench/{session_id}/repeat-step carries the optional override."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture(autouse=True)
    def _clear_sessions(self) -> Iterator[None]:
        _wb_common._workbench_sessions.clear()
        yield
        _wb_common._workbench_sessions.clear()

    @staticmethod
    def _override_sent(mock_repeat: Any) -> Any:
        call = mock_repeat.call_args
        if len(call.args) > 1:
            return call.args[1]
        return call.kwargs.get("override")

    def test_a_body_with_an_override_reaches_the_service(
        self, client: TestClient, session_id: str
    ) -> None:
        with patch("wavecore.api.routes.workbench.workbench_service.repeat_step") as mock_repeat:
            mock_repeat.return_value = _repeat_result(session_id)

            response = client.post(
                f"/workbench/{session_id}/repeat-step",
                json={"override": _script_override()},
            )

            assert response.status_code == 200
            assert response.json()["data"] == _repeat_result(session_id)
            assert self._override_sent(mock_repeat) == _script_override()

    def test_an_empty_body_is_todays_repeat(self, client: TestClient, session_id: str) -> None:
        with patch("wavecore.api.routes.workbench.workbench_service.repeat_step") as mock_repeat:
            mock_repeat.return_value = _repeat_result(session_id)

            response = client.post(f"/workbench/{session_id}/repeat-step")

            assert response.status_code == 200
            assert response.json()["data"] == _repeat_result(session_id)
            assert self._override_sent(mock_repeat) is None

    def test_an_override_on_another_block_comes_back_as_409(
        self, client: TestClient, session_id: str
    ) -> None:
        session = make_session(session_id)
        session["status"] = "paused"
        session["paused_node_id"] = NODE_ID
        _wb_common._workbench_sessions[session_id] = session

        response = client.post(
            f"/workbench/{session_id}/repeat-step",
            json={"override": _script_override(OTHER_NODE_ID)},
        )

        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "CONFLICT"
        assert re.match(_WRONG_NODE_RE, body["error"]["message"]) is not None
