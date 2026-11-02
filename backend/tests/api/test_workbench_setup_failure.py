"""Setup-phase run failures fail loudly, never hang.

Setup work (graph build, output-var seeding, namespace/secret injection) runs
inside `_execute_workflow`'s error boundary, so a setup exception produces a
failed run - ERROR log + `execution_completed{failed}` + status failed -
instead of leaving the session 'running' until GC surfaces a swallowed
`Task exception was never retrieved`. Setup errors are value-scrubbed so an
error carrying a secret is not itself a leak. The fire-and-forget run task
also logs any exception that escapes its own boundary.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Generator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import execution
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.secrets.registry import SecretRegistry

SETUP_FUNCS = ("_inject_namespace_variables", "_ensure_output_variables")


@pytest.fixture(autouse=True)
def _clean_state() -> Generator[None, None, None]:
    _wb_common._clear_sessions_sync()
    workbench_service._user_active_session.clear()
    yield
    _wb_common._clear_sessions_sync()
    workbench_service._user_active_session.clear()


def _seed_session(session_id: str, registry: SecretRegistry | None = None) -> dict[str, Any]:
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 1, "percentage": 0.0},
        "block_states": {},
        "test_name": "Setup Test",
        "secret_registry": registry,
    }
    _wb_common._workbench_sessions[session_id] = session
    return session


def _simple_graph() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    node_id = "node-1"
    nodes = [
        {
            "id": node_id,
            "type": "workflowNode",
            "data": {
                "label": "Test Delay",
                "elementType": "delay",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {"values": {"duration": 5}},
            },
        }
    ]
    edges = [{"source": "start-node", "target": node_id}]
    return nodes, edges


class TestSetupFailureFailsLoudly:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("setup_func", SETUP_FUNCS)
    async def test_setup_failure_flips_status_to_failed(self, setup_func: str) -> None:
        session = _seed_session("setup-fail-status")
        nodes, edges = _simple_graph()

        with (
            patch.object(execution, setup_func, side_effect=RuntimeError("setup boom")),
            patch.object(execution, "_broadcast_event", new_callable=AsyncMock),
            patch.object(execution, "_add_execution_log"),
        ):
            await execution._execute_workflow("setup-fail-status", nodes, edges, {})

        assert session["status"] == "failed"
        assert "error" in session

    @pytest.mark.asyncio
    async def test_setup_failure_broadcasts_execution_completed_failed(self) -> None:
        _seed_session("setup-fail-ws")
        nodes, edges = _simple_graph()

        with (
            patch.object(
                execution, "_inject_namespace_variables", side_effect=RuntimeError("setup boom")
            ),
            patch.object(execution, "_broadcast_event", new_callable=AsyncMock) as broadcast,
            patch.object(execution, "_add_execution_log"),
        ):
            await execution._execute_workflow("setup-fail-ws", nodes, edges, {})

        completed = [
            call.args[1]
            for call in broadcast.call_args_list
            if call.args[1].get("type") == "execution_completed"
        ]
        assert completed, "a terminal execution_completed event must be broadcast"
        assert completed[-1]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_setup_failure_emits_error_log(self) -> None:
        _seed_session("setup-fail-log")
        nodes, edges = _simple_graph()

        with (
            patch.object(
                execution, "_inject_namespace_variables", side_effect=RuntimeError("setup boom")
            ),
            patch.object(execution, "_broadcast_event", new_callable=AsyncMock),
            patch.object(execution, "_add_execution_log") as add_log,
        ):
            await execution._execute_workflow("setup-fail-log", nodes, edges, {})

        error_levels = [call.args[1] for call in add_log.call_args_list]
        assert "ERROR" in error_levels

    @pytest.mark.asyncio
    async def test_setup_error_carrying_a_secret_is_scrubbed(self) -> None:
        secret = "sup3r-s3cret-t0ken"
        registry = SecretRegistry()
        registry.register("token", secret, "declared")
        _seed_session("setup-fail-scrub", registry=registry)
        nodes, edges = _simple_graph()

        with (
            patch.object(
                execution,
                "_inject_namespace_variables",
                side_effect=RuntimeError(f"failed to unseal {secret}"),
            ),
            patch.object(execution, "_broadcast_event", new_callable=AsyncMock) as broadcast,
            patch.object(execution, "_add_execution_log"),
        ):
            await execution._execute_workflow("setup-fail-scrub", nodes, edges, {})

        completed = [
            call.args[1]
            for call in broadcast.call_args_list
            if call.args[1].get("type") == "execution_completed"
        ]
        assert completed
        assert secret not in completed[-1]["error"]
        assert secret not in _wb_common._workbench_sessions["setup-fail-scrub"]["error"]


class TestRunTaskDoneCallback:
    @pytest.mark.asyncio
    async def test_logs_exception_that_escaped_the_boundary(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        async def _boom() -> None:
            raise RuntimeError("escaped-boundary")

        task: asyncio.Task[None] = asyncio.create_task(_boom())
        with contextlib.suppress(RuntimeError):
            await task

        with caplog.at_level(logging.ERROR):
            workbench_service._log_task_exception(task)

        assert "escaped-boundary" in caplog.text

    @pytest.mark.asyncio
    async def test_ignores_a_canceled_task(self, caplog: pytest.LogCaptureFixture) -> None:
        async def _sleep() -> None:
            await asyncio.sleep(10)

        task: asyncio.Task[None] = asyncio.create_task(_sleep())
        await asyncio.sleep(0)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

        with caplog.at_level(logging.ERROR):
            workbench_service._log_task_exception(task)

        assert not [r for r in caplog.records if r.levelno >= logging.ERROR]

    @pytest.mark.asyncio
    async def test_ignores_a_clean_completion(self, caplog: pytest.LogCaptureFixture) -> None:
        async def _ok() -> None:
            return None

        task: asyncio.Task[None] = asyncio.create_task(_ok())
        await task

        with caplog.at_level(logging.ERROR):
            workbench_service._log_task_exception(task)

        assert not [r for r in caplog.records if r.levelno >= logging.ERROR]
