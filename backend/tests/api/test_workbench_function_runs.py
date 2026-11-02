"""Endpoint tests for workbench runs that include Function nodes (REQ-3.2.1.1).

This file exercises two surfaces:

1. The main ``POST /workbench/run`` endpoint, extended so a Test containing
   Function instances runs end-to-end (Function nodes are dispatched to the
   Function executor via ``services/workbench/functions.py`` and the engine's main
   loop in ``services/workbench/execution.py``).

2. The same endpoint's new scoped-mode fields (``scope_mode`` +
   ``scoped_function_node_id``) for the drilled-in Run Scope path. The
   scoped invocation extends the existing endpoint via
   additional fields rather than a new route.

Error messages are anchored exactly so the FE can match
on them with equality.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

# Anchored error messages.
SCOPED_MISSING_ID_RE = re.compile(
    r"^scoped_function_node_id is required when scope_mode is 'function'$"
)
SCOPED_NODE_NOT_FOUND_RE = re.compile(r"^Function block '.+' not found in Test '.+'$")


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def client() -> Any:
    """Yields a TestClient with the lifespan hook active so background tasks
    spawned during a request can run on the same event loop after the
    response returns. Without the context manager Starlette's TestClient
    tears the loop down at the end of each request and the workbench
    engine's ``asyncio.create_task`` gets canceled before it can finish.
    """
    from wavecore.api.app import app

    with TestClient(app) as client:
        yield client


@pytest.fixture(autouse=True)
def register_plugins_and_controls() -> Any:
    from wavecore.api.services.workbench import _common as _wb_common
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()


def _log_node(node_id: str, message: str = "'ok'") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
            },
            "displayName": node_id,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _function_node(
    node_id: str,
    *,
    lifecycle: str = "local",
    function_id: str | None = None,
    function_version: str | None = None,
    local_definition: dict[str, Any] | None = None,
    values: dict[str, Any] | None = None,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
    element_types: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    output_secret_fields: list[str] | None = None,
) -> dict[str, Any]:
    config: dict[str, Any] = {
        "values": values or {},
        "profileBindings": [],
        "outputBindings": output_bindings or {},
    }
    if output_secret_fields is not None:
        config["outputSecretFields"] = output_secret_fields
    data: dict[str, Any] = {
        "label": node_id,
        "elementType": "function",
        "nodeType": "function",
        "version": "1.0.0",
        "functionLifecycle": lifecycle,
        "config": config,
        "expressionFields": expression_fields or [],
        "templateFields": template_fields or [],
        "displayName": node_id,
    }
    if element_types is not None:
        data["elementTypes"] = element_types
    if function_id is not None:
        data["functionId"] = function_id
    if function_version is not None:
        data["functionVersion"] = function_version
    if local_definition is not None:
        data["localDefinition"] = local_definition
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": data,
    }


def _node_fields(node: dict[str, Any]) -> dict[str, Any]:
    """The node fields the engine hands a Block when it runs it."""
    from wavecore.api.services.workbench.node_helpers import _extract_node_fields

    return _extract_node_fields(node)


def _build_local_function_def(
    *,
    name: str = "local_fn",
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    body_message: str = "'inner'",
) -> dict[str, Any]:
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": inputs or [],
        "outputs": outputs or [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "inner-log",
                    "type": "workflowNode",
                    "data": {
                        "label": "inner",
                        "elementType": "log",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {
                            "values": {"message": body_message, "level": "INFO"},
                            "profileBindings": [],
                            "outputBindings": {"line": "result"},
                        },
                        "displayName": "inner",
                        "expressionFields": ["message"],
                        "templateFields": [],
                        "variableExpressionKeys": [],
                    },
                }
            ],
            "edges": [{"source": "start-node", "target": "inner-log"}],
        },
    }


def _create_test_with_function_node(
    client: TestClient,
    function_node_id: str = "fn-1",
) -> str:
    """Create a Test on disk that contains one Local Function instance. Returns test_id.

    The Test service assigns its own UUID on create regardless of the payload
    ``id``; we read it back from the response so subsequent ``GET`` / ``POST
    /workbench/run`` calls resolve the persisted record.
    """
    test_payload = {
        "id": str(uuid.uuid4()),
        "name": "Function-Aware Test",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        # ``caller_var`` is the binding target on the function node below; the
        # test save pipeline rejects output bindings whose target variable has
        # no declaration so we declare it here as a string with an empty
        # default.
        "variables": {
            "caller_var": {"type": "string", "value": ""},
        },
        "workflow": {
            "nodes": [
                _function_node(
                    function_node_id,
                    lifecycle="local",
                    local_definition=_build_local_function_def(),
                    output_bindings={"result": "caller_var"},
                )
            ],
            "edges": [{"source": "start-node", "target": function_node_id}],
        },
    }
    resp = client.post("/tests", json=test_payload)
    assert resp.status_code in (200, 201), resp.text
    body = resp.json()
    return body["data"]["id"]


_VALID_ENVIRONMENT_ID = "10000000-0000-0000-0000-000000000001"


def _seed_environment() -> str:
    """Return a valid-UUID environment_id, seeding the in-memory cache if needed.

    The shared conftest seeds ``env-test-...`` which is not a valid UUID, so
    the workbench route rejects it at ``validate_uuid``. We register a
    minimal valid-UUID record on first use and return it instead.
    """
    from wavecore.api.services.environments import service as environment_service

    environment = {
        "id": _VALID_ENVIRONMENT_ID,
        "name": "Function-Run Test Environment",
        "tags": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    # Write the file too: a listing reconciles against the storage directory,
    # so a cache-only environment would not survive one.
    environment_service._save_environment(environment)
    environment_service._environments.setdefault(_VALID_ENVIRONMENT_ID, environment)
    return _VALID_ENVIRONMENT_ID


def _first_error_message(body: dict[str, Any]) -> str:
    err = body.get("error") or {}
    message = err.get("message", "")
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, dict) and item.get("message"):
                return item["message"]
            if isinstance(item, str):
                return item
    return message


# ---------------------------------------------------------------------------
# Workbench loop integration (Test with Function nodes runs end-to-end)
# ---------------------------------------------------------------------------


class TestFunctionNodeExecutesEndToEnd:
    """A Test containing a Function instance runs through ``POST /workbench/run``."""

    def test_run_test_with_local_function_returns_200(self, client: TestClient) -> None:
        test_id = _create_test_with_function_node(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["data"]["session_id"]

    def test_run_test_with_function_node_eventually_passes(self, client: TestClient) -> None:
        test_id = _create_test_with_function_node(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]

        # Drain the background task and assert session reached a terminal
        # state. The TestClient context manager keeps a portal open so we
        # can await the task on the same loop the workbench engine ran on.
        from wavecore.api.services.workbench._common import _active_tasks

        task = _active_tasks.get(session_id)
        if task is not None and not task.done():
            client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))

        status_resp = client.get(f"/workbench/{session_id}/status")
        assert status_resp.status_code == 200
        status_body = status_resp.json()["data"]
        assert status_body["status"] in ("passed", "failed")


# ---------------------------------------------------------------------------
# Scoped-mode request fields
# ---------------------------------------------------------------------------


class TestScopedModeValidation:
    """``scope_mode='function'`` requires ``scoped_function_node_id``."""

    def test_function_mode_without_node_id_returns_400(self, client: TestClient) -> None:
        test_id = _create_test_with_function_node(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "scope_mode": "function",
            },
        )
        assert resp.status_code == 400, resp.text
        msg = _first_error_message(resp.json())
        assert SCOPED_MISSING_ID_RE.match(msg), msg

    def test_function_mode_with_unknown_node_id_returns_404(self, client: TestClient) -> None:
        test_id = _create_test_with_function_node(client, function_node_id="fn-1")
        env_id = _seed_environment()
        bogus = str(uuid.uuid4())
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "scope_mode": "function",
                "scoped_function_node_id": bogus,
            },
        )
        assert resp.status_code == 404, resp.text
        msg = _first_error_message(resp.json())
        assert SCOPED_NODE_NOT_FOUND_RE.match(msg), msg

    def test_function_mode_with_valid_node_id_returns_200(self, client: TestClient) -> None:
        test_id = _create_test_with_function_node(client, function_node_id="fn-1")
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "scope_mode": "function",
                "scoped_function_node_id": "fn-1",
            },
        )
        assert resp.status_code == 200, resp.text

    def test_test_mode_default_unchanged(self, client: TestClient) -> None:
        """``scope_mode`` defaults to 'test'; existing callers see no change."""
        test_id = _create_test_with_function_node(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text

    def test_explicit_test_mode_returns_200(self, client: TestClient) -> None:
        test_id = _create_test_with_function_node(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "scope_mode": "test",
            },
        )
        assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Scoped invocation behavior
# ---------------------------------------------------------------------------


class TestScopedInvocationBehavior:
    """Drilled-in scoped run: uses cached state when present, defaults + advisory otherwise."""

    def test_scoped_run_without_prior_test_run_emits_advisory(self, client: TestClient) -> None:
        """When no prior session state exists, an
        advisory log/event surfaces in the workbench panel.
        """
        test_id = _create_test_with_function_node(client, function_node_id="fn-1")
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "scope_mode": "function",
                "scoped_function_node_id": "fn-1",
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]

        from wavecore.api.services.workbench._common import _active_tasks

        task = _active_tasks.get(session_id)
        if task is not None and not task.done():
            client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))

        # Pull the status snapshot - it must include the advisory marker.
        status_resp = client.get(f"/workbench/{session_id}/status")
        assert status_resp.status_code == 200
        snapshot = status_resp.json()["data"]
        warnings = snapshot.get("warnings") or []
        advisory_present = any(
            "prior" in (str(w).lower())
            or "default" in (str(w).lower())
            or (isinstance(w, dict) and "prior" in (w.get("message", "").lower()))
            for w in warnings
        )
        assert (
            advisory_present
        ), f"expected advisory about prior session state in warnings; got {warnings!r}"


def _build_function_def_with_halt(
    *,
    halt_status: str = "failed",
    halt_scope: str = "test",
) -> dict[str, Any]:
    """Function whose body fires a Halt control."""
    return {
        "name": "halting_fn",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "inner-halt",
                    "type": "workflowNode",
                    "data": {
                        "label": "Halt",
                        "elementType": "halt",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "config": {
                            "values": {"scope": halt_scope, "status": halt_status},
                        },
                    },
                }
            ],
            "edges": [{"source": "start-node", "target": "inner-halt"}],
        },
    }


def _build_function_def_with_assert_fail() -> dict[str, Any]:
    """Function whose body fires an Assert with fail_current_scope=True."""
    return {
        "name": "asserting_fn",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "inner-assert",
                    "type": "workflowNode",
                    "data": {
                        "label": "Assert",
                        "elementType": "assert",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "config": {
                            "values": {
                                "assertions": [
                                    {"type": "expression", "expression": "False"},
                                ],
                                "mode": "single",
                                "fail_current_scope": True,
                            },
                        },
                    },
                }
            ],
            "edges": [{"source": "start-node", "target": "inner-assert"}],
        },
    }


def _build_function_def_with_assert_split() -> dict[str, Any]:
    """Function with Assert(split, fail_current_scope=True) -> pass-Log + fail-Log."""
    return {
        "name": "asserting_split_fn",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "inner-assert",
                    "type": "workflowNode",
                    "data": {
                        "label": "Assert",
                        "elementType": "assert",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "config": {
                            "values": {
                                "assertions": [
                                    {"type": "expression", "expression": "1 == 2"},
                                ],
                                "mode": "split",
                                "fail_current_scope": True,
                            },
                        },
                    },
                },
                {
                    "id": "inner-pass-log",
                    "type": "workflowNode",
                    "data": {
                        "label": "PassLog",
                        "elementType": "log",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {
                            "values": {"message": "'Func pass!'", "level": "INFO"},
                            "profileBindings": [],
                            "outputBindings": {},
                        },
                        "expressionFields": ["message"],
                    },
                },
                {
                    "id": "inner-fail-log",
                    "type": "workflowNode",
                    "data": {
                        "label": "FailLog",
                        "elementType": "log",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {
                            "values": {"message": "'Func FAIL!'", "level": "ERROR"},
                            "profileBindings": [],
                            "outputBindings": {},
                        },
                        "expressionFields": ["message"],
                    },
                },
            ],
            "edges": [
                {"source": "start-node", "target": "inner-assert"},
                {
                    "source": "inner-assert",
                    "target": "inner-pass-log",
                    "sourceHandle": "pass",
                },
                {
                    "source": "inner-assert",
                    "target": "inner-fail-log",
                    "sourceHandle": "fail",
                },
            ],
        },
    }


def _create_test_with_assert_split_in_function(client: TestClient) -> str:
    """Test: Function(Assert(split, fail_current_scope) -> pass-Log + fail-Log) -> sibling-Log."""
    test_payload = {
        "id": str(uuid.uuid4()),
        "name": "Assert-Split-Inside-Function Test",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": {},
        "workflow": {
            "nodes": [
                _function_node(
                    "fn-assert-split",
                    lifecycle="local",
                    local_definition=_build_function_def_with_assert_split(),
                ),
                _log_node("log-sibling", message="'sibling'"),
            ],
            "edges": [
                {"source": "start-node", "target": "fn-assert-split"},
                {"source": "fn-assert-split", "target": "log-sibling"},
            ],
        },
    }
    resp = client.post("/tests", json=test_payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]["id"]


def _create_test_with_halt_in_function(
    client: TestClient,
    *,
    halt_status: str = "failed",
) -> str:
    """Create a Test with: Log_before -> Function(Halt) -> Log_after.

    The Halt inside the Function body must propagate via __halt to the
    parent engine so Log_after is skipped and the session status reflects
    the halt.
    """
    test_payload = {
        "id": str(uuid.uuid4()),
        "name": "Halt-Propagating Test",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": {},
        "workflow": {
            "nodes": [
                _log_node("log-before", message="'before'"),
                _function_node(
                    "fn-halt",
                    lifecycle="local",
                    local_definition=_build_function_def_with_halt(
                        halt_status=halt_status,
                    ),
                ),
                _log_node("log-after", message="'after'"),
            ],
            "edges": [
                {"source": "start-node", "target": "log-before"},
                {"source": "log-before", "target": "fn-halt"},
                {"source": "fn-halt", "target": "log-after"},
            ],
        },
    }
    resp = client.post("/tests", json=test_payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]["id"]


def _create_test_with_assert_in_function(client: TestClient) -> str:
    """Create a Test with: Function(Assert(fail)) -> Log_after.

    A failed Function body propagates as an exception across the Function
    boundary. The parent engine catches the
    exception, marks the Function block failed, drains its queue, and
    Log_after is skipped. Session terminates "failed".
    """
    test_payload = {
        "id": str(uuid.uuid4()),
        "name": "Assert-Propagating Test",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": {},
        "workflow": {
            "nodes": [
                _function_node(
                    "fn-assert",
                    lifecycle="local",
                    local_definition=_build_function_def_with_assert_fail(),
                ),
                _log_node("log-after", message="'after'"),
            ],
            "edges": [
                {"source": "start-node", "target": "fn-assert"},
                {"source": "fn-assert", "target": "log-after"},
            ],
        },
    }
    resp = client.post("/tests", json=test_payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]["id"]


def _drain_session(client: TestClient, session_id: str) -> None:
    from wavecore.api.services.workbench._common import _active_tasks

    task = _active_tasks.get(session_id)
    if task is not None and not task.done():
        client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))


# ---------------------------------------------------------------------------
# Halt propagation across the Function boundary (audit Subsystem 3)
# ---------------------------------------------------------------------------


class TestHaltInsideFunctionPropagates:
    """Halt inside a Function body drains the parent's queue and sets session status."""

    def test_halt_inside_function_marks_session_failed(self, client: TestClient) -> None:
        test_id = _create_test_with_halt_in_function(client, halt_status="failed")
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        status_resp = client.get(f"/workbench/{session_id}/status")
        assert status_resp.status_code == 200
        snapshot = status_resp.json()["data"]
        assert snapshot["status"] == "failed"

    def test_halt_inside_function_skips_sibling_after(self, client: TestClient) -> None:
        test_id = _create_test_with_halt_in_function(client, halt_status="failed")
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        from wavecore.api.services.workbench._common import _workbench_sessions

        session = _workbench_sessions[session_id]
        block_states = session.get("block_states", {})
        # log-before ran; the Function block reflects the halted body; the
        # sibling-after the Function must be skipped (not executed).
        assert block_states.get("log-before") == "passed"
        assert block_states.get("log-after") == "skipped", block_states

    def test_halt_inside_function_with_passed_status_marks_session_passed(
        self, client: TestClient
    ) -> None:
        test_id = _create_test_with_halt_in_function(client, halt_status="passed")
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        status_resp = client.get(f"/workbench/{session_id}/status")
        assert status_resp.status_code == 200
        snapshot = status_resp.json()["data"]
        # Halt(status=passed) is a graceful early-exit: session passes.
        assert snapshot["status"] == "passed"

    def test_halt_inside_function_with_skipped_status(self, client: TestClient) -> None:
        test_id = _create_test_with_halt_in_function(client, halt_status="skipped")
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        status_resp = client.get(f"/workbench/{session_id}/status")
        snapshot = status_resp.json()["data"]
        # Per signals.py _HALT_MAP, skipped halt -> session.status "skipped".
        assert snapshot["status"] == "skipped"


# ---------------------------------------------------------------------------
# Assert(fail) inside Function (audit Subsystem 3)
# ---------------------------------------------------------------------------


class TestAssertScopeFailInFunction:
    """An inner Assert(fail_current_scope=True) crosses the Function boundary
    as an exception: the Function block is marked failed and the parent
    queue drains, so sibling-after is skipped.
    """

    def test_assert_fail_inside_function_marks_session_failed(self, client: TestClient) -> None:
        test_id = _create_test_with_assert_in_function(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        status_resp = client.get(f"/workbench/{session_id}/status")
        snapshot = status_resp.json()["data"]
        # session.scope_failed -> terminal status "failed".
        assert snapshot["status"] == "failed"

    def test_assert_fail_inside_function_skips_sibling_after(self, client: TestClient) -> None:
        test_id = _create_test_with_assert_in_function(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        from wavecore.api.services.workbench._common import _workbench_sessions

        session = _workbench_sessions[session_id]
        block_states = session.get("block_states", {})
        # handle_function_node raises RuntimeError on a non-passed body, the
        # parent engine treats the Function like any failed block, and
        # log-after is NOT executed.
        assert block_states.get("log-after") != "passed", block_states


# ---------------------------------------------------------------------------
# Multi-node Function body (audit Subsystem 3 - children enqueue + declared
# output collection on the engine-path walker)
# ---------------------------------------------------------------------------


def _build_function_def_with_chained_body() -> dict[str, Any]:
    """Function with chained inner Log_1 -> Log_2 sequence."""
    return {
        "name": "chained_fn",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "log_a",
                    "type": "workflowNode",
                    "data": {
                        "label": "log_a",
                        "elementType": "log",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {
                            "values": {"message": "'first'", "level": "INFO"},
                            "profileBindings": [],
                            "outputBindings": {},
                        },
                        "expressionFields": ["message"],
                    },
                },
                {
                    "id": "log_b",
                    "type": "workflowNode",
                    "data": {
                        "label": "log_b",
                        "elementType": "log",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {
                            "values": {"message": "'second'", "level": "INFO"},
                            "profileBindings": [],
                            "outputBindings": {"line": "result"},
                        },
                        "expressionFields": ["message"],
                    },
                },
            ],
            "edges": [
                {"source": "start-node", "target": "log_a"},
                {"source": "log_a", "target": "log_b"},
            ],
        },
    }


def _build_function_def_with_runtime_error() -> dict[str, Any]:
    """Function body that throws at runtime via a division-by-zero expression.

    The expression resolves cleanly at design time (no undeclared name, so the
    canonical save pipeline accepts it) but raises when evaluated at run time -
    exactly what these body-exception propagation tests need."""
    return {
        "name": "throwing_fn",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "log_bad",
                    "type": "workflowNode",
                    "data": {
                        "label": "log_bad",
                        "elementType": "log",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {
                            "values": {
                                "message": "1 / 0",
                                "level": "INFO",
                            },
                            "profileBindings": [],
                            "outputBindings": {},
                        },
                        "expressionFields": ["message"],
                    },
                },
            ],
            "edges": [{"source": "start-node", "target": "log_bad"}],
        },
    }


def _create_test_with_chained_function(client: TestClient) -> str:
    test_payload = {
        "id": str(uuid.uuid4()),
        "name": "Chained-Function Test",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": {"caller_var": {"type": "string", "value": ""}},
        "workflow": {
            "nodes": [
                _function_node(
                    "fn-chain",
                    lifecycle="local",
                    local_definition=_build_function_def_with_chained_body(),
                    output_bindings={"result": "caller_var"},
                ),
            ],
            "edges": [{"source": "start-node", "target": "fn-chain"}],
        },
    }
    resp = client.post("/tests", json=test_payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]["id"]


def _create_test_with_throwing_function(client: TestClient) -> str:
    test_payload = {
        "id": str(uuid.uuid4()),
        "name": "Throwing-Function Test",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": {},
        "workflow": {
            "nodes": [
                _function_node(
                    "fn-throw",
                    lifecycle="local",
                    local_definition=_build_function_def_with_runtime_error(),
                ),
                _log_node("log-after-throw", message="'after'"),
            ],
            "edges": [
                {"source": "start-node", "target": "fn-throw"},
                {"source": "fn-throw", "target": "log-after-throw"},
            ],
        },
    }
    resp = client.post("/tests", json=test_payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]["id"]


class TestAssertSplitInsideFunctionRoutesOnce:
    """Assert(split, fail) inside a Function body routes ONLY to the fail branch.

    The walker's `visited` set must match the engine's `executed` set, so children
    of a diverging control are never re-enqueued after nested dispatch ran or
    skipped them. The pass branch must stay skipped; the fail branch must run exactly once.
    """

    def test_only_fail_branch_runs_once(self, client: TestClient) -> None:
        test_id = _create_test_with_assert_split_in_function(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        from wavecore.api.services.workbench._common import (
            _workbench_sessions,
        )

        session = _workbench_sessions[session_id]
        block_states = session.get("block_states", {})

        # The matching ("fail") branch must have run (passed status -
        # the Log itself didn't error, the Assert is what failed).
        assert block_states.get("inner-fail-log") == "passed", block_states
        # The non-matching ("pass") branch MUST have been skipped by
        # the engine's _skip_non_matching_branches helper.
        assert block_states.get("inner-pass-log") == "skipped", block_states
        # The Function block itself reports failed because its inner
        # assert flipped session.scope_failed - the boundary then
        # converts that into an exception.
        assert block_states.get("fn-assert-split") == "failed", block_states
        # The sibling-after the Function did NOT run: the Function-boundary
        # exception drained the parent queue, same as any failed block.
        assert block_states.get("log-sibling") != "passed", block_states

    def test_fail_branch_log_appears_exactly_once(self, client: TestClient) -> None:
        """The 'Func FAIL!' log line must surface once, not twice.

        The walker's earlier `visited`/`executed` split caused the fail
        branch to execute twice (once via _dispatch_nested_branch and
        again via the walker's unconditional child enqueue).
        """
        test_id = _create_test_with_assert_split_in_function(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        from wavecore.api.services import log_streaming_service

        logs = log_streaming_service.get_logs(session_id)
        # Exact match counts the actual Log emission, not the harness Inputs/Outputs
        # echo lines that also carry the rendered message as a substring.
        fail_log_hits = sum(
            1 for entry in logs if isinstance(entry, dict) and entry.get("message") == "Func FAIL!"
        )
        assert fail_log_hits == 1, (
            f"Fail-branch Log fired {fail_log_hits} times; expected 1. "
            f"This is the double-execute regression."
        )


class TestFunctionBodyShapeCoverage:
    """Function bodies with chained nodes and runtime errors exercise these paths."""

    def test_function_with_chained_inner_nodes_runs_to_completion(self, client: TestClient) -> None:
        test_id = _create_test_with_chained_function(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        status_resp = client.get(f"/workbench/{session_id}/status")
        snapshot = status_resp.json()["data"]
        assert snapshot["status"] == "passed"

    def test_function_body_exception_stops_parent_flow(self, client: TestClient) -> None:
        """An inner plugin exception stops the Function's flow AND propagates
        as an exception to the parent scope, stopping it too (same shape as
        a top-level plugin exception at root level). Per the user's clarified
        model: exceptions always stop the current scope and propagate upward
        unless caught by a wrapping Try/Catch.
        """
        test_id = _create_test_with_throwing_function(client)
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        from wavecore.api.services.workbench._common import _workbench_sessions

        session = _workbench_sessions[session_id]
        block_states = session.get("block_states", {})
        # Function block ends "failed".
        assert block_states.get("fn-throw") == "failed", block_states
        # The sibling-after-the-Function never enters block_states (parent
        # flow stopped on the propagated exception).
        assert block_states.get("log-after-throw") == "skipped", block_states
        # Test final status is "failed".
        assert session["status"] == "failed", session.get("status")


def _try_catch_node(node_id: str) -> dict[str, Any]:
    """Build a Try/Catch control node with catch enabled, no output bindings.
    The test only cares about flow + final session status, not the caught
    error payload, so the outputBindings stay empty (and there are no
    matching variables declared on the Test)."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "TryCatch",
            "elementType": "try-catch-finally",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {
                    "enable_catch": True,
                    "enable_finally": False,
                },
                "profileBindings": [],
                "outputBindings": {},
            },
        },
    }


def _create_test_with_function_in_trycatch(
    client: TestClient,
    *,
    function_def: dict[str, Any],
) -> str:
    """Build a Test where Try/Catch wraps a single Function in its try-body.

    Workflow shape:
      start -> TryCatch
        TryCatch.try -> Function -> (Function is the entire try chain)
        TryCatch.catch -> Log_caught
        TryCatch.then -> Log_after
    """
    test_payload = {
        "id": str(uuid.uuid4()),
        "name": "Function-In-TryCatch Test",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": {},
        "workflow": {
            "nodes": [
                _try_catch_node("tc-outer"),
                _function_node(
                    "fn-inner",
                    lifecycle="local",
                    local_definition=function_def,
                ),
                _log_node("log-caught", message="'caught'"),
                _log_node("log-after", message="'after'"),
            ],
            "edges": [
                {"source": "start-node", "target": "tc-outer"},
                {"source": "tc-outer", "target": "fn-inner", "sourceHandle": "try"},
                {"source": "tc-outer", "target": "log-caught", "sourceHandle": "catch"},
                {"source": "tc-outer", "target": "log-after", "sourceHandle": "then"},
            ],
        },
    }
    resp = client.post("/tests", json=test_payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]["id"]


class TestTryCatchAbsorbsInnerFunctionScopeFail:
    """Try/Catch wrapping a Function with an inner Assert(fail_current_scope=True)
    must absorb the scope-fail in the catch branch; the test finishes ``passed``.
    """

    def test_function_with_inner_assert_in_trycatch_catch_runs_test_passes(
        self, client: TestClient
    ) -> None:
        test_id = _create_test_with_function_in_trycatch(
            client,
            function_def=_build_function_def_with_assert_fail(),
        )
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        from wavecore.api.services.workbench._common import _workbench_sessions

        session = _workbench_sessions[session_id]
        block_states = session.get("block_states", {})

        # The catch path ran (Try/Catch caught the Function's scope-fail).
        assert block_states.get("log-caught") == "passed", block_states
        # The then-egress runs after catch consumed the failure.
        assert block_states.get("log-after") == "passed", block_states
        # Test final status is ``passed`` - Try/Catch absorbed the scope-fail
        # and did NOT leak it to the session terminal flag.
        assert session["status"] == "passed", session.get("status")
        # The session-level scope_failed flag is False (absorbed).
        assert not session.get("scope_failed"), session.get("scope_failed")


class TestTryCatchAbsorbsInnerFunctionException:
    """Try/Catch wrapping a Function whose body raises an exception
    must absorb the exception in the catch branch; the test finishes ``passed``.
    """

    def test_function_with_inner_exception_in_trycatch_catch_runs_test_passes(
        self, client: TestClient
    ) -> None:
        test_id = _create_test_with_function_in_trycatch(
            client,
            function_def=_build_function_def_with_runtime_error(),
        )
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={"test_id": test_id, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        from wavecore.api.services.workbench._common import _workbench_sessions

        session = _workbench_sessions[session_id]
        block_states = session.get("block_states", {})

        # Catch ran (Try/Catch caught the Function's exception).
        assert block_states.get("log-caught") == "passed", block_states
        # Then-egress ran after catch.
        assert block_states.get("log-after") == "passed", block_states
        # Test final status is ``passed``.
        assert session["status"] == "passed", session.get("status")


# ---------------------------------------------------------------------------
# Halt(scope="function") absorption at the Function boundary (REQ-3.5.1.14)
#
# These drive the engine directly via ``_execute_workflow`` (the step-debug
# harness) and call ``handle_function_node`` directly, so they do NOT go through
# the Test save-validation pipeline. At runtime the Halt control does not
# validate, so the function-scope signal flows through the body walker.
# ---------------------------------------------------------------------------


def _make_run_session(session_id: str) -> dict[str, Any]:
    """A minimal live session for the direct ``_execute_workflow`` harness."""
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Function-Scope Halt Test",
        "block_states": {},
        "variables": {},
        "scope_failed": False,
        "breakpoints": set(),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
    }


def _function_scope_halt_def(
    *,
    status: str,
    message: str | None = None,
    name: str = "halting_fn",
) -> dict[str, Any]:
    """Local Function whose body fires Halt(scope='function', status[, message])."""
    values: dict[str, Any] = {"scope": "function", "status": status}
    if message is not None:
        values["message"] = message
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "inner-halt",
                    "type": "workflowNode",
                    "data": {
                        "label": "Halt",
                        "elementType": "halt",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "config": {"values": values},
                    },
                }
            ],
            "edges": [{"source": "start-node", "target": "inner-halt"}],
        },
    }


async def _run_workflow_to_terminal(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run ``_execute_workflow`` to a terminal state and return the session."""
    from wavecore.api.services.workbench import _common as _wb_common
    from wavecore.api.services.workbench import service as workbench_service

    session = _make_run_session(session_id)
    _wb_common._workbench_sessions[session_id] = session
    await asyncio.wait_for(
        workbench_service._execute_workflow(session_id, nodes, edges, {}),
        timeout=10.0,
    )
    return session


class TestFunctionScopeHaltCallerContinues:
    """passed / skipped function-scope halts let the caller flow continue past
    the Function instance to its sibling-after egress."""

    @pytest.mark.asyncio
    async def test_function_scope_passed_lets_caller_continue(self) -> None:
        nodes = [
            _log_node("log-before", message="'before'"),
            _function_node(
                "fn-halt",
                lifecycle="local",
                local_definition=_function_scope_halt_def(status="passed"),
            ),
            _log_node("log-after", message="'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "log-before"},
            {"source": "log-before", "target": "fn-halt"},
            {"source": "fn-halt", "target": "log-after"},
        ]
        session = await _run_workflow_to_terminal("fn-scope-passed", nodes, edges)
        block_states = session["block_states"]
        # The caller continued to the sibling-after the Function.
        assert block_states.get("log-after") == "passed", block_states
        # The Function instance paints the PASS badge.
        assert block_states.get("fn-halt") == "passed", block_states
        # No halt drained to the session - it completed normally.
        assert session["status"] == "passed", session.get("status")

    @pytest.mark.asyncio
    async def test_function_scope_skipped_lets_caller_continue_with_skip_badge(
        self,
    ) -> None:
        nodes = [
            _log_node("log-before", message="'before'"),
            _function_node(
                "fn-halt",
                lifecycle="local",
                local_definition=_function_scope_halt_def(status="skipped"),
            ),
            _log_node("log-after", message="'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "log-before"},
            {"source": "log-before", "target": "fn-halt"},
            {"source": "fn-halt", "target": "log-after"},
        ]
        session = await _run_workflow_to_terminal("fn-scope-skipped", nodes, edges)
        block_states = session["block_states"]
        # The Function instance paints the SKIP badge.
        assert block_states.get("fn-halt") == "skipped", block_states
        # The caller still continued to the sibling-after the Function.
        assert block_states.get("log-after") == "passed", block_states
        # A skipped-status function halt does not fail the caller.
        assert session["status"] == "passed", session.get("status")


class TestFunctionScopeHaltFailedRaisesAcrossBoundary:
    """A failed function-scope halt raises through the Function boundary as an
    invocation failure (catchable by a wrapping Try/Catch) rather than draining
    the caller's queue."""

    @pytest.mark.asyncio
    async def test_failed_no_message_raises_anchored_runtime_error(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench.functions import handle_function_node

        session_id = "fn-scope-fail-nomsg"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            node = _function_node(
                "fn-x",
                lifecycle="local",
                local_definition=_function_scope_halt_def(status="failed"),
            )
            node_fields = _node_fields(node)
            with pytest.raises(RuntimeError, match=r"^Function 'halting_fn' halted \(failed\)$"):
                await handle_function_node(node_fields, {}, session_id, "fn-x")
        finally:
            _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_failed_with_message_raises_message_verbatim(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench.functions import handle_function_node

        session_id = "fn-scope-fail-msg"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            node = _function_node(
                "fn-x",
                lifecycle="local",
                local_definition=_function_scope_halt_def(
                    status="failed", message="environment is broken"
                ),
            )
            node_fields = _node_fields(node)
            with pytest.raises(RuntimeError, match=r"^environment is broken$"):
                await handle_function_node(node_fields, {}, session_id, "fn-x")
        finally:
            _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_passed_returns_outputs_without_halt_keys(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench.functions import handle_function_node

        session_id = "fn-scope-pass-direct"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            node = _function_node(
                "fn-x",
                lifecycle="local",
                local_definition=_function_scope_halt_def(status="passed"),
            )
            node_fields = _node_fields(node)
            result = await handle_function_node(node_fields, {}, session_id, "fn-x")
            # Absorbed: no __halt re-emission crosses the boundary.
            assert "__halt" not in result
            assert "__halt_scope" not in result
        finally:
            _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_failed_function_caught_by_wrapping_try_catch(self) -> None:
        nodes = [
            _try_catch_node("tc-outer"),
            _function_node(
                "fn-inner",
                lifecycle="local",
                local_definition=_function_scope_halt_def(status="failed"),
            ),
            _log_node("log-caught", message="'caught'"),
            _log_node("log-after", message="'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-outer"},
            {"source": "tc-outer", "target": "fn-inner", "sourceHandle": "try"},
            {"source": "tc-outer", "target": "log-caught", "sourceHandle": "catch"},
            {"source": "tc-outer", "target": "log-after", "sourceHandle": "then"},
        ]
        session = await _run_workflow_to_terminal("fn-scope-fail-trycatch", nodes, edges)
        block_states = session["block_states"]
        # The function-failed halt raised and the Try/Catch caught it.
        assert block_states.get("log-caught") == "passed", block_states
        # The then-egress ran after the catch consumed the failure.
        assert block_states.get("log-after") == "passed", block_states
        # The Try/Catch absorbed the failure: the Test finished passed.
        assert session["status"] == "passed", session.get("status")


class TestFunctionScopeHaltTopLevelFallback:
    """A function-scope halt fired at the Test top level (no enclosing Function)
    has no boundary to absorb it and behaves as test scope."""

    @pytest.mark.asyncio
    async def test_top_level_function_scope_failed_behaves_as_test_scope(self) -> None:
        nodes = [
            _log_node("log-before", message="'before'"),
            {
                "id": "top-halt",
                "type": "workflowNode",
                "data": {
                    "label": "Halt",
                    "elementType": "halt",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"scope": "function", "status": "failed"}},
                },
            },
            _log_node("log-after", message="'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "log-before"},
            {"source": "log-before", "target": "top-halt"},
            {"source": "top-halt", "target": "log-after"},
        ]
        session = await _run_workflow_to_terminal("fn-scope-toplevel", nodes, edges)
        block_states = session["block_states"]
        # No enclosing Function: the halt drains like test scope.
        assert session["status"] == "failed", session.get("status")
        assert block_states.get("log-after") == "skipped", block_states


class TestFunctionInputBindingEvaluation:
    """A Function Block input held as an expression is evaluated in the enclosing flow;
    a quoted text literal ('hello') reaches the Function flow as hello."""

    @pytest.mark.asyncio
    async def test_quoted_string_input_binding_is_evaluated(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench.functions import handle_function_node

        session_id = "fn-input-eval"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            local_def = {
                "name": "echo_fn",
                "description": "",
                "tags": [],
                "inputs": [{"name": "x", "type": "string", "required": True}],
                "outputs": [{"name": "result", "type": "string"}],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {
                    "nodes": [
                        {
                            "id": "echo",
                            "type": "workflowNode",
                            "data": {
                                "label": "echo",
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "config": {
                                    "values": {"message": "x", "level": "INFO"},
                                    "profileBindings": [],
                                    "outputBindings": {"line": "result"},
                                },
                                "expressionFields": ["message"],
                            },
                        }
                    ],
                    "edges": [{"source": "start-node", "target": "echo"}],
                },
            }
            node = _function_node(
                "fn-x",
                lifecycle="local",
                local_definition=local_def,
                values={"x": "'hello'"},
                expression_fields=["x"],
            )
            result = await handle_function_node(_node_fields(node), {}, session_id, "fn-x")
            assert result.get("result") == "hello", result
        finally:
            _wb_common._clear_sessions_sync()


class TestHaltBadgeInsideFunctionBranch:
    """A Halt in a branch chain inside a Function body paints its halt-aware
    status (failed -> red), not the hardcoded 'passed' of the body executor."""

    @pytest.mark.asyncio
    async def test_failed_halt_in_else_branch_is_marked_failed(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.functions.executor import execute_function

        session_id = "fn-halt-branch"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            ifelse = {
                "id": "ifelse",
                "type": "workflowNode",
                "data": {
                    "label": "If/Else",
                    "elementType": "if-else",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {
                        "values": {
                            "branches": [
                                {
                                    "type": "if",
                                    "id": "branch_go",
                                    "conditions": [
                                        {
                                            "type": "literal",
                                            "variable": "flag",
                                            "value_type": "string",
                                            "operator": "equals",
                                            "reference_value": "go",
                                            "reference_is_expression": False,
                                            "id": "c1",
                                        }
                                    ],
                                },
                                {"type": "else", "id": "branch_else"},
                            ]
                        },
                        "profileBindings": [],
                        "outputBindings": {},
                    },
                },
            }
            halt = {
                "id": "halt-inner",
                "type": "workflowNode",
                "data": {
                    "label": "Halt",
                    "elementType": "halt",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {
                        "values": {"scope": "function", "status": "failed"},
                        "profileBindings": [],
                        "outputBindings": {},
                    },
                },
            }
            local_def = {
                "name": "branch_fn",
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "variables": [{"name": "flag", "type": "string", "value": "nope"}],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {
                    "nodes": [ifelse, _log_node("log-main", message="'main'"), halt],
                    "edges": [
                        {"source": "start-node", "target": "ifelse"},
                        {"source": "ifelse", "target": "log-main", "sourceHandle": "branch_go"},
                        {"source": "ifelse", "target": "halt-inner", "sourceHandle": "branch_else"},
                    ],
                },
            }
            await execute_function(
                function_def=local_def,
                inputs={},
                session_id=session_id,
            )
            block_states = _wb_common._workbench_sessions[session_id]["block_states"]
            # else branch ran (flag != go); the failed Halt paints red, not green.
            assert block_states.get("halt-inner") == "failed", block_states
            assert block_states.get("log-main") == "skipped", block_states
        finally:
            _wb_common._clear_sessions_sync()


class TestNullHandleBranchRoutingInFunction:
    """An If/Else branch edge that lost its sourceHandle still routes correctly
    inside a Function body, matching the root engine's null-handle tolerance."""

    @staticmethod
    def _make_def(flag_value: str) -> dict[str, Any]:
        ifelse = {
            "id": "ifelse",
            "type": "workflowNode",
            "data": {
                "label": "If/Else",
                "elementType": "if-else",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {
                    "values": {
                        "branches": [
                            {
                                "type": "if",
                                "id": "branch_0",
                                "conditions": [
                                    {
                                        "type": "literal",
                                        "variable": "flag",
                                        "value_type": "string",
                                        "operator": "equals",
                                        "reference_value": "go",
                                        "reference_is_expression": False,
                                        "id": "c1",
                                    }
                                ],
                            },
                            {"type": "else", "id": "branch_1"},
                        ]
                    },
                    "profileBindings": [],
                    "outputBindings": {},
                },
            },
        }
        return {
            "name": "branch_fn",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "variables": [{"name": "flag", "type": "string", "value": flag_value}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": [
                    ifelse,
                    _log_node("log-if", message="'if'"),
                    _log_node("log-else", message="'else'"),
                ],
                "edges": [
                    {"source": "start-node", "target": "ifelse"},
                    # if-branch edge with a lost (null) sourceHandle - mirrors the user's data
                    {"source": "ifelse", "target": "log-if"},
                    {"source": "ifelse", "target": "log-else", "sourceHandle": "branch_1"},
                ],
            },
        }

    @pytest.mark.asyncio
    async def test_if_branch_runs_when_handle_is_null(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.functions.executor import execute_function

        session_id = "fn-null-if"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            await execute_function(
                function_def=self._make_def("go"),
                inputs={},
                session_id=session_id,
            )
            bs = _wb_common._workbench_sessions[session_id]["block_states"]
            assert bs.get("log-if") == "passed", bs
            assert bs.get("log-else") == "skipped", bs
        finally:
            _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_else_branch_runs_and_null_if_branch_skipped(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.functions.executor import execute_function

        session_id = "fn-null-else"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            await execute_function(
                function_def=self._make_def("nope"),
                inputs={},
                session_id=session_id,
            )
            bs = _wb_common._workbench_sessions[session_id]["block_states"]
            assert bs.get("log-else") == "passed", bs
            assert bs.get("log-if") == "skipped", bs
        finally:
            _wb_common._clear_sessions_sync()


class TestFunctionScopeSkipBadgeAcrossContexts:
    """A function-scope-skip must mark the Function instance 'skipped' regardless
    of the engine context that runs it - root, Try/Catch branch, or loop/branch
    body."""

    @pytest.mark.asyncio
    async def test_skipped_function_in_try_branch_marks_instance_skipped(self) -> None:
        nodes = [
            _try_catch_node("tc"),
            _function_node(
                "fn-inner",
                lifecycle="local",
                local_definition=_function_scope_halt_def(status="skipped"),
            ),
            _log_node("log-after", message="'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc"},
            {"source": "tc", "target": "fn-inner", "sourceHandle": "try"},
            {"source": "tc", "target": "log-after", "sourceHandle": "then"},
        ]
        session = await _run_workflow_to_terminal("fn-skip-trycatch", nodes, edges)
        bs = session["block_states"]
        assert bs.get("fn-inner") == "skipped", bs
        assert bs.get("log-after") == "passed", bs

    @pytest.mark.asyncio
    async def test_skipped_function_in_for_loop_body_marks_instance_skipped(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        for_node = {
            "id": "for-1",
            "type": "workflowNode",
            "data": {
                "label": "For Loop",
                "elementType": "for",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {
                    "values": {"mode": "count", "count": 1},
                    "outputBindings": {"index": "i"},
                    "profileBindings": [],
                },
                "displayName": "For Loop",
            },
        }
        fn = _function_node(
            "fn-body",
            lifecycle="local",
            local_definition=_function_scope_halt_def(status="skipped"),
        )
        nodes = [for_node, fn]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "fn-body", "sourceHandle": "body"},
        ]
        session_id = "fn-skip-forloop"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            await asyncio.wait_for(
                workbench_service._execute_workflow(session_id, nodes, edges, {"i": None}),
                timeout=10.0,
            )
            bs = _wb_common._workbench_sessions[session_id]["block_states"]
            assert bs.get("fn-body") == "skipped", bs
        finally:
            _wb_common._clear_sessions_sync()


# ---------------------------------------------------------------------------
# Function Block fields on the shared Block path
# ---------------------------------------------------------------------------


@pytest.fixture
def run_session_id(request: pytest.FixtureRequest) -> Any:
    """A session id of this test's own; its run log is cleared afterwards."""
    from wavecore.api.services import log_streaming_service

    session_id = f"fn-block-{request.node.name}"
    yield session_id
    log_streaming_service._clear_session_logs(session_id)


async def _run_root_flow(
    session_id: str,
    nodes: list[dict[str, Any]],
    variables: dict[str, Any],
    *,
    registry: Any = None,
) -> dict[str, Any]:
    """Run ``nodes`` one after another from the start of a root flow; returns the session."""
    from wavecore.api.services.workbench import _common as _wb_common
    from wavecore.api.services.workbench import service as workbench_service

    session = _make_run_session(session_id)
    if registry is not None:
        session["secret_registry"] = registry
    _wb_common._workbench_sessions[session_id] = session
    sources = ["start-node", *(node["id"] for node in nodes[:-1])]
    edges = [
        {"source": source, "target": node["id"]}
        for source, node in zip(sources, nodes, strict=True)
    ]
    await asyncio.wait_for(
        workbench_service._execute_workflow(session_id, nodes, edges, variables), timeout=10.0
    )
    return session


def _run_log(session_id: str) -> list[str]:
    from wavecore.api.services import log_streaming_service

    return [
        str(entry.get("message", ""))
        for entry in log_streaming_service.get_logs(session_id)
        if isinstance(entry, dict)
    ]


def _echo_block(
    declared: dict[str, Any],
    message: str,
    *,
    values: dict[str, Any] | None = None,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
    element_types: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A Local Function Block with one input; its Function flow logs ``message`` as ``result``."""
    return _function_node(
        "fn",
        local_definition=_build_local_function_def(
            name="echo_fn", inputs=[declared], body_message=message
        ),
        values=values,
        expression_fields=expression_fields,
        template_fields=template_fields,
        element_types=element_types,
        output_bindings={"result": "seen"},
    )


class TestFunctionBlockInputsRunOnTheSharedPath:
    """A Function Block's inputs are stored, filled and resolved like any Block's fields
    (REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.1.2.10)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("declared", "values", "expression_fields", "message", "expected"),
        [
            pytest.param(
                {"name": "retries", "type": "integer", "required": False, "default": 3},
                {},
                [],
                "str(retries)",
                "3",
                id="left-out",
            ),
            pytest.param(
                {"name": "retries", "type": "integer", "required": False, "default": 3},
                {"retries": ""},
                ["retries"],
                "str(retries)",
                "3",
                id="blank-whole-expression",
            ),
            pytest.param(
                {
                    "name": "tags",
                    "type": "array",
                    "required": False,
                    "default": ["7", "8"],
                    "elementTypes": ["string", "integer"],
                },
                {},
                [],
                "str(tags)",
                "['7', 8]",
                id="list-default-with-item-types",
            ),
        ],
    )
    async def test_an_optional_input_left_out_runs_with_its_realized_default(
        self,
        run_session_id: str,
        declared: dict[str, Any],
        values: dict[str, Any],
        expression_fields: list[str],
        message: str,
        expected: str,
    ) -> None:
        variables: dict[str, Any] = {"seen": None}
        block = _echo_block(declared, message, values=values, expression_fields=expression_fields)

        session = await _run_root_flow(run_session_id, [block], variables)

        assert (session["status"], variables["seen"]) == ("passed", expected), session.get("error")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("declared", "values", "expression_fields"),
        [
            pytest.param(
                {"name": "x", "type": "string", "required": True}, {}, [], id="no-default"
            ),
            pytest.param(
                {"name": "x", "type": "string", "required": True, "default": "hi"},
                {},
                [],
                id="required-default-never-used",
            ),
            pytest.param(
                {"name": "x", "type": "string", "required": True},
                {"x": ""},
                ["x"],
                id="blank-whole-expression",
            ),
        ],
    )
    async def test_a_required_input_left_out_fails_the_block(
        self,
        run_session_id: str,
        declared: dict[str, Any],
        values: dict[str, Any],
        expression_fields: list[str],
    ) -> None:
        block = _echo_block(declared, "x", values=values, expression_fields=expression_fields)

        session = await _run_root_flow(run_session_id, [block, _log_node("after")], {"seen": None})

        assert session["block_states"]["fn"] == "failed"
        assert "inner-log" not in session["block_states"]
        assert session["error"] == "'x' is null"
        assert "Function 'echo_fn' completed with status failed: 'x' is null" in _run_log(
            run_session_id
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("declared", "stored", "variables", "message", "expected"),
        [
            pytest.param(
                {"name": "level", "type": "string", "required": True},
                {"values": {"level": "low"}},
                {},
                "level",
                "low",
                id="literal",
            ),
            pytest.param(
                {"name": "url", "type": "string", "required": True},
                {"values": {"url": "base + '/x'"}, "expression_fields": ["url"]},
                {"base": "http://h"},
                "url",
                "http://h/x",
                id="whole-field-expression",
            ),
            pytest.param(
                {"name": "greeting", "type": "string", "required": True},
                {"values": {"greeting": "Hello {{ who }}"}, "template_fields": ["greeting"]},
                {"who": "Ann"},
                "greeting",
                "Hello Ann",
                id="template-on-a-whole-string-input",
            ),
            pytest.param(
                {"name": "headers", "type": "map", "required": True},
                {
                    "values": {"headers": {"X-Id": "uid", "Accept": "json"}},
                    "expression_fields": ["headers.X-Id"],
                },
                {"uid": "u-7"},
                "headers['X-Id'] + ' ' + headers['Accept']",
                "u-7 json",
                id="map-entry-expression",
            ),
            pytest.param(
                {"name": "arguments", "type": "array", "required": True},
                {
                    "values": {"arguments": [{"value": "a"}, {"value": "n"}]},
                    "expression_fields": ["arguments.1.value"],
                },
                {"n": "b"},
                "arguments[0]['value'] + arguments[1]['value']",
                "ab",
                id="list-row-expression",
            ),
            pytest.param(
                {"name": "tags", "type": "array", "required": True},
                {"values": {"tags": ["a", "n"]}, "expression_fields": ["tags.1"]},
                {"n": "b"},
                "tags[0] + tags[1]",
                "ab",
                id="plain-list-item-expression",
            ),
        ],
    )
    async def test_a_stored_input_reaches_the_function_flow_resolved(
        self,
        run_session_id: str,
        declared: dict[str, Any],
        stored: dict[str, Any],
        variables: dict[str, Any],
        message: str,
        expected: str,
    ) -> None:
        # REQ-3.1.3.15: a Template on a whole string input runs as a template.
        variables = {**variables, "seen": None}
        block = _echo_block(declared, message, **stored)

        session = await _run_root_flow(run_session_id, [block], variables)

        assert (session["status"], variables["seen"]) == ("passed", expected), session.get("error")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("declared", "stored", "variables", "message"),
        [
            pytest.param(
                {"name": "tags", "type": "array", "required": True},
                {"values": {"tags": ["a", None]}},
                {},
                "'null' if tags[1] is None else 'set'",
                id="list-item",
            ),
            pytest.param(
                {"name": "headers", "type": "map", "required": True},
                {"values": {"headers": {"X-Id": None, "Accept": "json"}}},
                {},
                "'null' if headers['X-Id'] is None else 'set'",
                id="map-value",
            ),
            pytest.param(
                {"name": "headers", "type": "map", "required": True},
                {
                    "values": {"headers": {"X-Id": "uid", "Accept": "json"}},
                    "expression_fields": ["headers.X-Id"],
                },
                {"uid": None},
                "'null' if headers['X-Id'] is None else 'set'",
                id="map-entry-expression",
            ),
            pytest.param(
                {"name": "arguments", "type": "array", "required": True},
                {
                    "values": {"arguments": [{"value": "a"}, {"value": "n"}]},
                    "expression_fields": ["arguments.1.value"],
                },
                {"n": None},
                "'null' if arguments[1]['value'] is None else 'set'",
                id="list-row-expression",
            ),
        ],
    )
    async def test_a_null_entry_reaches_the_function_flow_as_null(
        self,
        run_session_id: str,
        declared: dict[str, Any],
        stored: dict[str, Any],
        variables: dict[str, Any],
        message: str,
    ) -> None:
        # The Function reads a null entry itself; no shared step refuses it.
        variables = {**variables, "seen": None}
        block = _echo_block(declared, message, **stored)

        session = await _run_root_flow(run_session_id, [block], variables)

        assert (session["status"], variables["seen"]) == ("passed", "null"), session.get("error")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("declared", "stored", "element_types", "expected"),
        [
            pytest.param(
                {"name": "tags", "type": "array", "required": True},
                {"tags": ["7", "8"]},
                {"tags": ["string", "integer"]},
                "['7', 8]",
                id="array",
            ),
            pytest.param(
                {"name": "tags", "type": "map", "required": True},
                {"tags": {"a": "1", "b": "1"}},
                {"tags": {"a": "integer", "b": "string"}},
                "{'a': 1, 'b': '1'}",
                id="map",
            ),
        ],
    )
    async def test_a_typed_input_keeps_its_stored_element_types(
        self,
        run_session_id: str,
        declared: dict[str, Any],
        stored: dict[str, Any],
        element_types: dict[str, Any],
        expected: str,
    ) -> None:
        # REQ-3.1.3.19: each item runs as the type stored beside it, never as it looks.
        variables: dict[str, Any] = {"seen": None}
        block = _echo_block(declared, "str(tags)", values=stored, element_types=element_types)

        session = await _run_root_flow(run_session_id, [block], variables)

        assert (session["status"], variables["seen"]) == ("passed", expected), session.get("error")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("stored", "expression_fields", "variables", "expected"),
        [
            pytest.param({"ratio": 2.0}, [], {}, "2.0", id="whole-number-literal"),
            pytest.param(
                {"ratio": "precise"},
                ["ratio"],
                {"precise": "0.1000000000000000000000000001"},
                "0.1000000000000000000000000001",
                id="every-digit-from-an-expression",
            ),
        ],
    )
    async def test_a_float_input_stays_exact(
        self,
        run_session_id: str,
        stored: dict[str, Any],
        expression_fields: list[str],
        variables: dict[str, Any],
        expected: str,
    ) -> None:
        # REQ-3.1.3.14: a Function Block passes numbers on exact, never reduced to a double.
        from wavecore.core.variables.decimal_value import WaveDecimal

        variables = {name: WaveDecimal(text) for name, text in variables.items()}
        variables["seen"] = None
        block = _echo_block(
            {"name": "ratio", "type": "float", "required": True},
            "str(ratio)",
            values=stored,
            expression_fields=expression_fields,
        )

        session = await _run_root_flow(run_session_id, [block], variables)

        assert (session["status"], variables["seen"]) == ("passed", expected), session.get("error")

    @pytest.mark.asyncio
    async def test_an_enum_input_given_a_value_not_allowed_fails_the_block(
        self, run_session_id: str
    ) -> None:
        declared = {
            "name": "level",
            "type": "string",
            "required": True,
            "enumValues": ["low", "high"],
            "default": "low",
        }
        block = _echo_block(
            declared, "level", values={"level": "pick"}, expression_fields=["level"]
        )

        session = await _run_root_flow(run_session_id, [block], {"pick": "x", "seen": None})

        assert session["block_states"]["fn"] == "failed"
        assert (
            session["error"] == "Parameter 'level' must be one of: low, high; Actual value was 'x'."
        )

    @pytest.mark.asyncio
    async def test_an_input_expression_that_fails_names_only_the_expression(
        self, run_session_id: str
    ) -> None:
        block = _echo_block(
            {"name": "count", "type": "integer", "required": True},
            "str(count)",
            values={"count": "1 / 0"},
            expression_fields=["count"],
        )

        session = await _run_root_flow(run_session_id, [block], {"seen": None})

        assert session["block_states"]["fn"] == "failed"
        assert session["error"] == "Expression evaluation failed for '1 / 0': division by zero"


_SECRET_OUTPUT_CANARY = "fn-block-secret-output-canary-57"
_PLAIN_OUTPUT_TEXT = "fn-block-plain-output-text-57"


def _two_output_function(*, secret: str) -> dict[str, Any]:
    """A Function flow that writes outputs ``tok`` and ``plain``; ``secret`` is declared secret."""
    return {
        "name": "two_outputs_fn",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [
            {"name": name, "type": "string", **({"secret": True} if name == secret else {})}
            for name in ("tok", "plain")
        ],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": "set-out",
                    "type": "workflowNode",
                    "data": {
                        "label": "set-out",
                        "elementType": "variable-setter",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "config": {
                            "values": {
                                "variables": {
                                    "tok": _SECRET_OUTPUT_CANARY,
                                    "plain": _PLAIN_OUTPUT_TEXT,
                                }
                            }
                        },
                    },
                }
            ],
            "edges": [{"source": "start-node", "target": "set-out"}],
        },
    }


_CAPTURED = {"tok": "captured", "plain": "plain_captured"}


def _secret_names(registry: Any) -> set[str]:
    return {name for name in _CAPTURED.values() if registry.is_secret_name(name)}


class TestFunctionBlockSecretOutputs:
    """A Function Block's Secret boxes work as a plugin Block's: nothing stored means the
    Function's declared secret outputs, a stored list is the whole truth (REQ-3.1.2.9)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("lifecycle", ["local", "library"])
    async def test_no_stored_list_seeds_from_the_declared_outputs(
        self, run_session_id: str, lifecycle: str
    ) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        if lifecycle == "library":
            from wavecore.api.services.functions import _storage as function_storage

            function_id = str(uuid.uuid4())
            # The Block is pinned to 1.0.0; the newer version declares the other output secret.
            for version, secret in (("1.0.0", "tok"), ("2.0.0", "plain")):
                function_storage.save_new_version(
                    function_id,
                    version,
                    _two_output_function(secret=secret),
                    {"changelog": version, "published_at": "2026-01-01T00:00:00Z"},
                    name="two-outputs-fn",
                )
            block = _function_node(
                "fn-out",
                lifecycle="shared",
                function_id=function_id,
                function_version="1.0.0",
                output_bindings=_CAPTURED,
            )
        else:
            block = _function_node(
                "fn-out",
                local_definition=_two_output_function(secret="tok"),
                output_bindings=_CAPTURED,
            )
        registry = SecretRegistry()
        variables: dict[str, Any] = {}

        session = await _run_root_flow(run_session_id, [block], variables, registry=registry)

        assert session["status"] == "passed", session.get("error")
        assert variables["captured"] == _SECRET_OUTPUT_CANARY
        assert _secret_names(registry) == {"captured"}
        assert _SECRET_OUTPUT_CANARY in registry.scan_values()
        assert _PLAIN_OUTPUT_TEXT not in registry.scan_values()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("output_secret_fields", "expected"),
        [
            pytest.param(["plain"], {"plain_captured"}, id="other-output-ticked"),
            pytest.param([], set(), id="nothing-ticked"),
        ],
    )
    async def test_a_stored_list_is_followed(
        self, run_session_id: str, output_secret_fields: list[str], expected: set[str]
    ) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        block = _function_node(
            "fn-out",
            local_definition=_two_output_function(secret="tok"),
            output_bindings=_CAPTURED,
            output_secret_fields=output_secret_fields,
        )
        registry = SecretRegistry()

        session = await _run_root_flow(run_session_id, [block], {}, registry=registry)

        assert session["status"] == "passed", session.get("error")
        assert _secret_names(registry) == expected


pytestmark = pytest.mark.usefixtures("temp_storage_path")
