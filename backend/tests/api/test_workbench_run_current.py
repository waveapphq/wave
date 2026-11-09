"""Run-current of an in-memory (dirty) body (REQ-3.2.1.1, REQ-3.2.1.2).

``POST /workbench/run`` accepts an optional in-memory ``workflow`` (nodes+edges)
and ``variables``. When present, the run executes that exact body instead of
loading the test from storage, so unsaved canvas edits can be tested without
saving or publishing first. ``test_id`` still identifies the entity (name,
profiles).

Coverage (each proves the in-memory body executed over an on-disk-divergent one):
- whole Test (scope_mode="test")
- in-memory variables override the persisted ones
- drilled-in scoped Function (the scoped node is located in the SUPPLIED workflow)
- edit-mode draft (the in-memory node carries editMode+draft, resolved by the
  existing ``_load_function_definition``)
- Debug mode uses the same in-memory body (REQ-3.2.1.2)
- nested folded drafts (REQ-5.2.1.24): a
  depth-2 edit-mode draft executes in a whole-Test run, a scoped function run,
  and the library View run (root function as draft with a nested draft)
- ``function_variables``: staged Current values of a Function instance's own
  inputs, outputs and locals seed that instance when it starts (REQ-3.2.1.6)
"""

from __future__ import annotations

import asyncio
import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

_VALID_ENVIRONMENT_ID = "10000000-0000-0000-0000-000000000050"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """Context-managed client so the background run task finishes on the loop."""
    from wavecore.api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _register_plugins_and_clear_sessions() -> Generator[None, None, None]:
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


def _seed_environment() -> str:
    from wavecore.api.services.environments import service as environment_service

    environment = {
        "id": _VALID_ENVIRONMENT_ID,
        "name": "Run-Current Test Environment",
        "tags": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    # Write the file too: a listing reconciles against the storage directory,
    # so a cache-only environment would not survive one.
    environment_service._save_environment(environment)
    environment_service._environments.setdefault(_VALID_ENVIRONMENT_ID, environment)
    return _VALID_ENVIRONMENT_ID


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _log_node(node_id: str, message: str) -> dict[str, Any]:
    """A Log node with a position (the run gate validates node positions)."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": node_id,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
                "outputBindings": {},
            },
            "displayName": node_id,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _fn_local_def(name: str, message: str) -> dict[str, Any]:
    """A Function definition whose one-Log body logs ``message``."""
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [_log_node("inner-log", message)],
            "edges": [{"source": "start-node", "target": "inner-log"}],
        },
    }


def _local_function_node(node_id: str, *, name: str, message: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": _fn_local_def(name, message),
            "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
        },
    }


def _edit_mode_node_with_draft(
    node_id: str,
    *,
    draft: dict[str, Any],
    function_id: str = "22222222-2222-2222-2222-222222222222",
) -> dict[str, Any]:
    """A Shared instance in edit mode carrying ``draft`` as its execution body."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": "1.0.0",
            "editMode": True,
            "draft": draft,
            "upstreamLink": {"functionId": function_id, "sourceVersion": "1.0.0"},
            "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
        },
    }


def _edit_mode_function_node(node_id: str, *, name: str, message: str) -> dict[str, Any]:
    """A Shared instance in edit mode: its draft body logs ``message``.

    ``_load_function_definition`` returns the draft when ``editMode`` is set, so
    the draft is self-contained and ``functionId`` need not resolve.
    """
    return _edit_mode_node_with_draft(node_id, draft=_fn_local_def(name, message))


def _fn_def_with_nodes(name: str, nodes: list[dict[str, Any]], entry: str) -> dict[str, Any]:
    """A Function definition with an arbitrary body (entry wired from start-node)."""
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": nodes,
            "edges": [{"source": "start-node", "target": entry}],
        },
    }


def _local_fn_node_with_def(node_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": definition,
            "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
        },
    }


def _seed_published_function(
    fn_id: str, name: str, *, body_nodes: list[dict[str, Any]], entry: str
) -> None:
    from wavecore.api.services.functions._storage import save_new_version

    save_new_version(
        fn_id,
        "1.0.0",
        {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": body_nodes,
                "edges": [{"source": "start-node", "target": entry}],
            },
        },
        {
            "description": "",
            "tags": [],
            "changelog": "seed",
            "details": "",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        },
        name=name,
    )


def _create_test_on_disk(
    client: TestClient,
    *,
    nodes: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> str:
    primary = nodes[0]["id"]
    payload = {
        "id": str(uuid.uuid4()),
        "name": "Run-Current Container",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": variables or {},
        "workflow": {
            "nodes": nodes,
            "edges": [{"source": "start-node", "target": primary}],
        },
    }
    resp = client.post("/tests", json=payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]["id"]


def _drain(client: TestClient, session_id: str) -> None:
    from wavecore.api.services.workbench._common import _active_tasks

    task = _active_tasks.get(session_id)
    if task is not None and not task.done():
        client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))


def _block_states(session_id: str) -> dict[str, Any]:
    from wavecore.api.services.workbench._common import _workbench_sessions

    return _workbench_sessions[session_id].get("block_states", {})


def _session_status(session_id: str) -> str:
    from wavecore.api.services.workbench._common import _workbench_sessions

    return _workbench_sessions[session_id].get("status", "")


def _log_messages(session_id: str) -> list[str]:
    from wavecore.api.services import log_streaming_service

    return [
        e.get("message", "")
        for e in log_streaming_service.get_logs(session_id)
        if isinstance(e, dict)
    ]


# ---------------------------------------------------------------------------
# Whole-Test run-current
# ---------------------------------------------------------------------------


class TestWholeTestRunCurrent:
    """A dirty whole-Test runs the supplied in-memory workflow, not the on-disk one."""

    def test_in_memory_workflow_executes_over_disk(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("disk-only", "'disk'")])
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "workflow": {
                    "nodes": [_log_node("mem-only", "'mem'")],
                    "edges": [{"source": "start-node", "target": "mem-only"}],
                },
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain(client, session_id)

        states = _block_states(session_id)
        assert "mem-only" in states, states
        assert "disk-only" not in states, states

    def test_in_memory_variables_override_persisted(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(
            client,
            nodes=[_log_node("v-log", "greeting")],
            variables={"greeting": {"type": "string", "value": "disk-value"}},
        )
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "workflow": {
                    "nodes": [_log_node("v-log", "greeting")],
                    "edges": [{"source": "start-node", "target": "v-log"}],
                },
                "variables": {"greeting": {"type": "string", "value": "mem-value"}},
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain(client, session_id)

        messages = _log_messages(session_id)
        assert any("mem-value" in m for m in messages), messages
        assert not any("disk-value" in m for m in messages), messages


# ---------------------------------------------------------------------------
# Debug run-current (REQ-3.2.1.2)
# ---------------------------------------------------------------------------


class TestDebugRunCurrent:
    """Debug mode uses the same in-memory body as a regular run-current."""

    def test_debug_uses_in_memory_workflow(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("disk-debug", "'disk'")])
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "workflow": {
                    "nodes": [_log_node("mem-debug", "'mem'")],
                    "edges": [{"source": "start-node", "target": "mem-debug"}],
                },
                "breakpoints": [],
                "debug_options": {"pause_on_first_block": False, "pause_on_errors": False},
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain(client, session_id)

        states = _block_states(session_id)
        assert "mem-debug" in states, states
        assert "disk-debug" not in states, states


# ---------------------------------------------------------------------------
# Drilled-in scoped run-current (locate the scoped node in the supplied body)
# ---------------------------------------------------------------------------


class TestScopedRunCurrent:
    """A scoped Function run uses the Function body from the supplied workflow."""

    def test_scoped_uses_in_memory_function_body(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(
            client,
            nodes=[_local_function_node("fn-1", name="scoped_fn", message="'disk-fn'")],
        )
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "scope_mode": "function",
                "scoped_function_node_id": "fn-1",
                "workflow": {
                    "nodes": [_local_function_node("fn-1", name="scoped_fn", message="'mem-fn'")],
                    "edges": [{"source": "start-node", "target": "fn-1"}],
                },
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain(client, session_id)

        messages = _log_messages(session_id)
        assert any("mem-fn" in m for m in messages), messages
        assert not any("disk-fn" in m for m in messages), messages


# ---------------------------------------------------------------------------
# Edit-mode draft run-current (the in-memory node's draft is the run contract)
# ---------------------------------------------------------------------------


class TestEditModeDraftRunCurrent:
    """A scoped run on an in-memory edit-mode node executes its draft body."""

    def test_edit_mode_draft_executes_over_disk_source(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(
            client,
            nodes=[_local_function_node("fn-1", name="draft_fn", message="'disk-fn'")],
        )
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "scope_mode": "function",
                "scoped_function_node_id": "fn-1",
                "workflow": {
                    "nodes": [
                        _edit_mode_function_node("fn-1", name="draft_fn", message="'from-draft'")
                    ],
                    "edges": [{"source": "start-node", "target": "fn-1"}],
                },
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain(client, session_id)

        messages = _log_messages(session_id)
        assert any("from-draft" in m for m in messages), messages
        assert not any("disk-fn" in m for m in messages), messages


# ---------------------------------------------------------------------------
# Nested folded drafts (REQ-5.2.1.24)
# ---------------------------------------------------------------------------


class TestWholeTestRunCurrentNestedDraft:
    """A whole-Test run executes a depth-2 edit-mode draft folded into the
    supplied in-memory workflow (local parent containing a Shared-in-edit)."""

    def test_depth_two_draft_in_memory_executes(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("disk-only", "'disk-only-body'")])
        env_id = _seed_environment()
        nested_id = str(uuid.uuid4())
        _seed_published_function(
            nested_id,
            "EditTargetD2",
            body_nodes=[_log_node("pub-d2-log", "'published-d2-mem-body'")],
            entry="pub-d2-log",
        )
        nested_draft = _fn_def_with_nodes(
            "EditTargetD2", [_log_node("draft-d2-log", "'draft-d2-mem'")], "draft-d2-log"
        )
        outer_def = _fn_def_with_nodes(
            "OuterFn",
            [_edit_mode_node_with_draft("edit-d2", draft=nested_draft, function_id=nested_id)],
            "edit-d2",
        )
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "workflow": {
                    "nodes": [_local_fn_node_with_def("fn-outer", outer_def)],
                    "edges": [{"source": "start-node", "target": "fn-outer"}],
                },
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain(client, session_id)

        messages = _log_messages(session_id)
        assert any("draft-d2-mem" in m for m in messages), messages
        assert not any("disk-only-body" in m for m in messages), messages
        assert not any("published-d2-mem-body" in m for m in messages), messages
        assert _session_status(session_id) == "passed"


class TestScopedRunCurrentNestedDraft:
    """A scoped function run executes a depth-2 edit-mode draft nested inside
    the scoped node's in-memory body."""

    def test_scoped_node_body_with_nested_draft_executes(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(
            client,
            nodes=[_local_function_node("fn-1", name="scoped_fn", message="'disk-fn-body'")],
        )
        env_id = _seed_environment()
        nested_id = str(uuid.uuid4())
        _seed_published_function(
            nested_id,
            "EditTargetD2",
            body_nodes=[_log_node("pub-d2-log", "'published-d2-scoped-body'")],
            entry="pub-d2-log",
        )
        nested_draft = _fn_def_with_nodes(
            "EditTargetD2", [_log_node("draft-d2-log", "'draft-d2-scoped'")], "draft-d2-log"
        )
        scoped_def = _fn_def_with_nodes(
            "scoped_fn",
            [_edit_mode_node_with_draft("edit-d2", draft=nested_draft, function_id=nested_id)],
            "edit-d2",
        )
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "scope_mode": "function",
                "scoped_function_node_id": "fn-1",
                "workflow": {
                    "nodes": [_local_fn_node_with_def("fn-1", scoped_def)],
                    "edges": [{"source": "start-node", "target": "fn-1"}],
                },
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain(client, session_id)

        messages = _log_messages(session_id)
        assert any("draft-d2-scoped" in m for m in messages), messages
        assert not any("disk-fn-body" in m for m in messages), messages
        assert not any("published-d2-scoped-body" in m for m in messages), messages
        assert _session_status(session_id) == "passed"


class TestViewRunNestedDraft:
    """The library View run (root function as draft via POST /functions/{id}/run)
    executes a nested edit-mode draft inside the root draft body."""

    def test_view_draft_with_nested_draft_executes(self, client: TestClient) -> None:
        env_id = _seed_environment()
        root_id = str(uuid.uuid4())
        nested_id = str(uuid.uuid4())
        _seed_published_function(
            root_id,
            "ViewRoot",
            body_nodes=[_log_node("pub-root-log", "'published-root-body'")],
            entry="pub-root-log",
        )
        _seed_published_function(
            nested_id,
            "NestedEdit",
            body_nodes=[_log_node("pub-d2-log", "'published-d2-view-body'")],
            entry="pub-d2-log",
        )
        nested_draft = _fn_def_with_nodes(
            "NestedEdit", [_log_node("draft-d2-log", "'draft-d2-view'")], "draft-d2-log"
        )
        root_draft = _fn_def_with_nodes(
            "ViewRoot",
            [
                _log_node("root-draft-log", "'view-root-draft-executed'"),
                _edit_mode_node_with_draft("edit-d2", draft=nested_draft, function_id=nested_id),
            ],
            "root-draft-log",
        )
        root_draft["workflow"]["edges"].append({"source": "root-draft-log", "target": "edit-d2"})
        root_draft["dependencies"]["functions"] = [nested_id]

        resp = client.post(
            f"/functions/{root_id}/run",
            json={"version": "1.0.0", "draft": root_draft, "environment_id": env_id},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain(client, session_id)

        messages = _log_messages(session_id)
        assert any("view-root-draft-executed" in m for m in messages), messages
        assert any("draft-d2-view" in m for m in messages), messages
        assert not any("published-root-body" in m for m in messages), messages
        assert not any("published-d2-view-body" in m for m in messages), messages
        assert _session_status(session_id) == "passed"


# ---------------------------------------------------------------------------
# Drilled-in run: a Function input's Current value (FNCFG-8, REQ-3.1.2.10)
# ---------------------------------------------------------------------------


def _staged(value: Any, value_type: str = "string") -> dict[str, Any]:
    """One staged Current value as the run request carries it."""
    return {"type": value_type, "value": value}


def _who_function_node(node_id: str = "fn-1") -> dict[str, Any]:
    """A Local Function with one optional string input ``who``, unbound, logged by its body."""
    definition = _fn_def_with_nodes("greet", [_log_node("who-log", "f'who={who}'")], "who-log")
    definition["inputs"] = [{"name": "who", "type": "string", "required": False}]
    return _local_fn_node_with_def(node_id, definition)


def _drilled_in_run(client: TestClient, test_id: str, env_id: str) -> str:
    resp = client.post(
        "/workbench/run",
        json={
            "test_id": test_id,
            "environment_id": env_id,
            "scope_mode": "function",
            "scoped_function_node_id": "fn-1",
            "workflow": {
                "nodes": [_who_function_node()],
                "edges": [{"source": "start-node", "target": "fn-1"}],
            },
            "function_variables": [
                {"function_path": ["fn-1"], "variables": {"who": _staged("ann")}}
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    session_id = resp.json()["data"]["session_id"]
    _drain(client, session_id)
    return session_id


class TestScopedRunCurrentValueOfAnInput:
    """A drilled-in run seeds each Function input from its Current value, also after Reset."""

    def test_a_drilled_in_run_seeds_the_input_from_its_current_value(
        self, client: TestClient
    ) -> None:
        test_id = _create_test_on_disk(client, nodes=[_who_function_node()])
        env_id = _seed_environment()

        session_id = _drilled_in_run(client, test_id, env_id)

        messages = _log_messages(session_id)
        assert "who=ann" in messages, messages
        assert "who=None" not in messages, messages

    def test_the_current_value_still_seeds_the_input_right_after_reset(
        self, client: TestClient
    ) -> None:
        test_id = _create_test_on_disk(client, nodes=[_who_function_node()])
        env_id = _seed_environment()
        first = _drilled_in_run(client, test_id, env_id)
        assert "who=ann" in _log_messages(first), _log_messages(first)

        reset = client.delete("/workbench/session")
        assert reset.status_code == 200, reset.text
        second = _drilled_in_run(client, test_id, env_id)

        assert "who=ann" in _log_messages(second), _log_messages(second)


# ---------------------------------------------------------------------------
# Scoped pre-run seed: staged Current values of a Function's own variables
# (REQ-3.2.1.6, REQ-3.1.2.10)
# ---------------------------------------------------------------------------


def _seed(path: list[str], variables: dict[str, Any]) -> dict[str, Any]:
    """One ``function_variables`` entry: staged values for the instance at ``path``."""
    return {"function_path": path, "variables": variables}


def _staged_fn_def(name: str = "staged") -> dict[str, Any]:
    """A Function with an optional input, a defaulted output and a local, all logged."""
    definition = _fn_def_with_nodes(
        name, [_log_node("staged-log", "f'who={who} note={note} out={out}'")], "staged-log"
    )
    definition["inputs"] = [{"name": "who", "type": "string", "required": False}]
    definition["outputs"] = [{"name": "out", "type": "string", "default": "initial-out"}]
    definition["variables"] = [{"name": "note", "type": "string", "value": "initial-note"}]
    return definition


def _note_fn_def(name: str, label: str) -> dict[str, Any]:
    """A Function with one local ``note`` whose body logs ``<label> note=<note>``."""
    definition = _fn_def_with_nodes(
        name, [_log_node(f"{name}-log", f"f'{label} note={{note}}'")], f"{name}-log"
    )
    definition["variables"] = [{"name": "note", "type": "string", "value": "initial-note"}]
    return definition


def _outer_node_holding_inner() -> dict[str, Any]:
    """Test-canvas instance ``fn-1`` whose body is the Function Block ``fn-2``."""
    inner = _local_fn_node_with_def("fn-2", _note_fn_def("inner", "inner"))
    return _local_fn_node_with_def("fn-1", _fn_def_with_nodes("outer", [inner], "fn-2"))


def _must_fn_node(must: dict[str, Any]) -> dict[str, Any]:
    """Test-canvas instance ``fn-1`` with one Required input ``must`` its Block leaves unbound."""
    definition = _fn_def_with_nodes(
        "needs_must", [_log_node("must-log", "f'must={must}'")], "must-log"
    )
    definition["inputs"] = [{"name": "must", "type": "string", "required": True, **must}]
    return _local_fn_node_with_def("fn-1", definition)


def _run(client: TestClient, test_id: str, env_id: str, node: dict[str, Any], **extra: Any) -> Any:
    """POST /workbench/run over an in-memory canvas holding ``node`` alone."""
    return client.post(
        "/workbench/run",
        json={
            "test_id": test_id,
            "environment_id": env_id,
            "workflow": {
                "nodes": [node],
                "edges": [{"source": "start-node", "target": node["id"]}],
            },
            **extra,
        },
    )


_RUN_SCOPE: dict[str, Any] = {"scope_mode": "function", "scoped_function_node_id": "fn-1"}


def _finished(client: TestClient, resp: Any) -> str:
    assert resp.status_code == 200, resp.text
    session_id: str = resp.json()["data"]["session_id"]
    _drain(client, session_id)
    return session_id


def _session(session_id: str) -> dict[str, Any]:
    from wavecore.api.services.workbench._common import _workbench_sessions

    return _workbench_sessions[session_id]


STAGED_TYPED_VALUES = [
    pytest.param(
        {"name": "n", "type": "integer", "value": 1},
        "f'n={n + 1}'",
        {"type": "integer", "value": "9007199254740993"},
        "n=9007199254740994",
        id="integer-exact-text",
    ),
    pytest.param(
        {"name": "cfg", "type": "map", "value": {"port": 1}},
        "f\"port={cfg['port'] + 1}\"",
        {"type": "map", "value": {"port": "8080"}, "elementTypes": {"port": "integer"}},
        "port=8081",
        id="map-element-types",
    ),
]


class TestScopedPreRunSeed:
    """``function_variables`` stage a Function instance's own input, output and local values;
    each entry is used when its instance starts."""

    def test_a_staged_expression_of_a_local_is_evaluated_in_the_instance(
        self, client: TestClient
    ) -> None:
        node = _local_fn_node_with_def("fn-1", _staged_fn_def())
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[
                    _seed(
                        ["fn-1"],
                        {
                            "who": _staged("ann"),
                            "note": {
                                "type": "string",
                                "isExpression": True,
                                "value": "who + '-expr'",
                            },
                        },
                    )
                ],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "who=ann note=ann-expr out=initial-out" in messages, messages

    @pytest.mark.parametrize(("local", "message", "staged", "logged"), STAGED_TYPED_VALUES)
    def test_a_staged_value_is_realized_as_its_declared_type(
        self,
        client: TestClient,
        local: dict[str, Any],
        message: str,
        staged: dict[str, Any],
        logged: str,
    ) -> None:
        definition = _fn_def_with_nodes("typed", [_log_node("typed-log", message)], "typed-log")
        definition["variables"] = [local]
        node = _local_fn_node_with_def("fn-1", definition)
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[_seed(["fn-1"], {local["name"]: staged})],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        assert logged in _log_messages(session_id), _log_messages(session_id)

    def test_a_run_scope_starts_the_instance_from_its_staged_input_output_and_local(
        self, client: TestClient
    ) -> None:
        node = _local_fn_node_with_def("fn-1", _staged_fn_def())
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[
                    _seed(
                        ["fn-1"],
                        {
                            "who": _staged("ann"),
                            "note": _staged("staged-note"),
                            "out": _staged("staged-out"),
                        },
                    )
                ],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "who=ann note=staged-note out=staged-out" in messages, messages
        assert _session(session_id)["scoped_result"]["outputs"] == {"out": "staged-out"}

    def test_a_whole_test_run_starts_the_instance_from_its_staged_local(
        self, client: TestClient
    ) -> None:
        node = _local_fn_node_with_def("fn-1", _note_fn_def("whole", "whole"))
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                function_variables=[_seed(["fn-1"], {"note": _staged("staged-note")})],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "whole note=staged-note" in messages, messages
        assert "whole note=initial-note" not in messages, messages

    def test_a_local_named_like_a_test_variable_leaves_the_test_variable_untouched(
        self, client: TestClient
    ) -> None:
        node = _local_fn_node_with_def("fn-1", _note_fn_def("whole", "whole"))
        test_id = _create_test_on_disk(
            client, nodes=[node], variables={"note": {"type": "string", "value": "test-note"}}
        )
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                variables={"note": _staged("test-note")},
                function_variables=[_seed(["fn-1"], {"note": _staged("staged-note")})],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "whole note=staged-note" in messages, messages
        assert _session(session_id)["variables"]["note"] == "test-note"

    def test_a_staged_template_of_a_local_is_rendered_in_the_run(self, client: TestClient) -> None:
        node = _local_fn_node_with_def("fn-1", _staged_fn_def())
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[
                    _seed(
                        ["fn-1"],
                        {
                            "who": _staged("ann"),
                            "note": {"type": "string", "isTemplate": True, "value": "hi {{who}}"},
                        },
                    )
                ],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "who=ann note=hi ann out=initial-out" in messages, messages

    def test_a_nested_instance_starts_from_its_own_staged_local(self, client: TestClient) -> None:
        node = _outer_node_holding_inner()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[_seed(["fn-1", "fn-2"], {"note": _staged("staged-inner")})],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "inner note=staged-inner" in messages, messages
        assert "inner note=initial-note" not in messages, messages

    def test_an_input_named_like_a_test_variable_gets_its_own_staged_value(
        self, client: TestClient
    ) -> None:
        node = _who_function_node()
        test_id = _create_test_on_disk(
            client, nodes=[node], variables={"who": {"type": "string", "value": "test-who"}}
        )
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                variables={"who": _staged("test-who")},
                function_variables=[_seed(["fn-1"], {"who": _staged("fn-who")})],
            ),
        )

        messages = _log_messages(session_id)
        assert "who=fn-who" in messages, messages
        assert "who=test-who" not in messages, messages
        session = _session(session_id)
        assert session["function_scopes"][("fn-1",)]["who"] == "fn-who"
        assert session["variables"].get("who") != "fn-who"

    def test_a_flat_variables_entry_does_not_seed_a_function_input(
        self, client: TestClient
    ) -> None:
        node = _who_function_node()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(client, test_id, env_id, node, **_RUN_SCOPE, variables={"who": _staged("ann")}),
        )

        messages = _log_messages(session_id)
        assert "who=None" in messages, messages
        assert "who=ann" not in messages, messages

    def test_an_entry_for_a_path_the_run_never_enters_is_ignored(self, client: TestClient) -> None:
        node = _who_function_node()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[
                    _seed(["fn-9"], {"x": _staged("ignored")}),
                    _seed(["fn-1"], {"who": _staged("ann")}),
                ],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        assert "who=ann" in _log_messages(session_id), _log_messages(session_id)


UNDECLARED_SEEDS = [
    pytest.param(_RUN_SCOPE, ["fn-1"], id="run-scope"),
    pytest.param({}, ["fn-1"], id="whole-test"),
    pytest.param(_RUN_SCOPE, ["fn-1", "fn-2"], id="nested-instance"),
]


class TestScopedPreRunSeedRefusals:
    """A staged name the Function at its path does not declare is refused before the run."""

    @pytest.mark.parametrize(("mode", "path"), UNDECLARED_SEEDS)
    def test_an_undeclared_name_is_refused_before_the_run_starts(
        self, client: TestClient, mode: dict[str, Any], path: list[str]
    ) -> None:
        from wavecore.api.services.workbench._common import _workbench_sessions

        node = _outer_node_holding_inner()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        resp = _run(
            client,
            test_id,
            env_id,
            node,
            **mode,
            function_variables=[_seed(path, {"x": _staged("v")})],
        )

        assert resp.status_code == 400, resp.text
        assert resp.json()["error"]["message"] == "Variable 'x' is not declared by this Function"
        assert _workbench_sessions == {}

    @pytest.mark.parametrize(
        ("value", "said"),
        [
            ("1e3", "is not a valid integer"),
            ("12345678901234567890", "allows at most 19 digits, got 20"),
        ],
        ids=["exponent", "20-digits"],
    )
    def test_a_value_that_breaks_the_number_rule_is_refused_before_the_run_starts(
        self, client: TestClient, value: str, said: str
    ) -> None:
        from wavecore.api.services.workbench._common import _workbench_sessions

        definition = _fn_def_with_nodes(
            "counted", [_log_node("count-log", "f'count={count}'")], "count-log"
        )
        definition["variables"] = [{"name": "count", "type": "integer", "value": "1"}]
        node = _local_fn_node_with_def("fn-1", definition)
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        resp = _run(
            client,
            test_id,
            env_id,
            node,
            **_RUN_SCOPE,
            function_variables=[_seed(["fn-1"], {"count": _staged(value, "integer")})],
        )

        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["message"] == f"Value for variable 'count' {said}"
        assert _workbench_sessions == {}


class TestDrilledRunAloneRequiredDefault:
    """A drilled run alone (Run Scope or a block run inside the Function) fills a Required
    input with no staged value from its default, else stops naming it; a whole-Test run
    never does (REQ-3.1.2.10)."""

    @pytest.mark.parametrize(
        "mode",
        [
            pytest.param(_RUN_SCOPE, id="run-scope"),
            pytest.param({"function_path": ["fn-1"], "single_node_id": "must-log"}, id="block-run"),
            pytest.param(
                {"function_path": ["fn-1"], "start_node_id": "must-log"}, id="run-from-here"
            ),
        ],
    )
    def test_a_required_input_with_a_default_and_no_staged_value_uses_the_default(
        self, client: TestClient, mode: dict[str, Any]
    ) -> None:
        node = _must_fn_node({"default": "d"})
        test_id = _create_test_on_disk(client, nodes=[_log_node("disk", "'disk'")])
        env_id = _seed_environment()

        session_id = _finished(client, _run(client, test_id, env_id, node, **mode))

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        assert "must=d" in _log_messages(session_id), _log_messages(session_id)

    def test_a_staged_value_wins_over_the_default(self, client: TestClient) -> None:
        node = _must_fn_node({"default": "d"})
        test_id = _create_test_on_disk(client, nodes=[_log_node("disk", "'disk'")])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[_seed(["fn-1"], {"must": _staged("staged")})],
            ),
        )

        messages = _log_messages(session_id)
        assert "must=staged" in messages, messages
        assert "must=d" not in messages, messages

    def test_with_neither_default_nor_staged_value_the_run_stops_naming_the_input(
        self, client: TestClient
    ) -> None:
        node = _must_fn_node({})
        test_id = _create_test_on_disk(client, nodes=[_log_node("disk", "'disk'")])
        env_id = _seed_environment()

        session_id = _finished(client, _run(client, test_id, env_id, node, **_RUN_SCOPE))

        assert _session_status(session_id) == "failed"
        assert re.match(r"^'must' is null$", _session(session_id).get("error") or "")
        assert not any(m.startswith("must=") for m in _log_messages(session_id))

    def test_a_whole_test_run_never_fills_it_from_the_default(self, client: TestClient) -> None:
        node = _must_fn_node({"default": "d"})
        test_id = _create_test_on_disk(client, nodes=[_log_node("disk", "'disk'")])
        env_id = _seed_environment()

        session_id = _finished(client, _run(client, test_id, env_id, node))

        assert _session_status(session_id) == "failed"
        assert re.match(r"^'must' is null$", _session(session_id).get("error") or "")
        assert _block_states(session_id)["fn-1"] == "failed"
        assert not any(m.startswith("must=") for m in _log_messages(session_id))


def _bound(node: dict[str, Any], bindings: dict[str, str]) -> dict[str, Any]:
    """``node`` with its Function Block fields holding the expressions ``bindings``."""
    node["data"]["config"]["values"] = dict(bindings)
    node["data"]["expressionFields"] = list(bindings)
    return node


def _outer_holding_bound_inner(bindings: dict[str, str]) -> dict[str, Any]:
    """``fn-1`` whose body is the Function Block ``fn-2`` binding ``bindings`` to its input."""
    inner_def = _fn_def_with_nodes(
        "inner", [_log_node("inner-log", "f'inner who={who} note={note}'")], "inner-log"
    )
    inner_def["inputs"] = [{"name": "who", "type": "string", "required": False}]
    inner_def["variables"] = [{"name": "note", "type": "string", "value": "initial-note"}]
    inner = _bound(_local_fn_node_with_def("fn-2", inner_def), bindings)
    return _local_fn_node_with_def("fn-1", _fn_def_with_nodes("outer", [inner], "fn-2"))


NESTED_BINDINGS = [
    pytest.param({"who": "'inner-bound'"}, "inner-bound", id="bound"),
    pytest.param({}, "None", id="unbound"),
]


class TestAFunctionBlockGivesEveryInput:
    """Where a Function Block starts the instance, its binding gives every input's value and a
    staged input value is not used; staged locals and outputs still apply (REQ-3.1.2.10)."""

    def test_a_whole_test_run_takes_the_blocks_binding_over_a_staged_input_value(
        self, client: TestClient
    ) -> None:
        node = _bound(_who_function_node(), {"who": "'bound'"})
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                function_variables=[_seed(["fn-1"], {"who": _staged("staged-who")})],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "who=bound" in messages, messages
        assert "who=staged-who" not in messages, messages
        assert _session(session_id)["function_scopes"][("fn-1",)]["who"] == "bound"

    def test_a_whole_test_run_leaves_an_unbound_input_to_the_block(
        self, client: TestClient
    ) -> None:
        node = _who_function_node()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                function_variables=[_seed(["fn-1"], {"who": _staged("staged-who")})],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "who=None" in messages, messages
        assert "who=staged-who" not in messages, messages

    def test_a_whole_test_run_never_fills_an_unbound_required_input_from_a_staged_value(
        self, client: TestClient
    ) -> None:
        node = _must_fn_node({})
        test_id = _create_test_on_disk(client, nodes=[_log_node("disk", "'disk'")])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                function_variables=[_seed(["fn-1"], {"must": _staged("staged")})],
            ),
        )

        assert _session_status(session_id) == "failed"
        assert re.match(r"^'must' is null$", _session(session_id).get("error") or "")
        assert _block_states(session_id)["fn-1"] == "failed"
        assert not any(m.startswith("must=") for m in _log_messages(session_id))

    def test_a_whole_test_run_applies_the_staged_local_and_output_beside_the_binding(
        self, client: TestClient
    ) -> None:
        node = _bound(_local_fn_node_with_def("fn-1", _staged_fn_def()), {"who": "'bound'"})
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                function_variables=[
                    _seed(
                        ["fn-1"],
                        {
                            "who": _staged("staged-who"),
                            "note": _staged("staged-note"),
                            "out": _staged("staged-out"),
                        },
                    )
                ],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "who=bound note=staged-note out=staged-out" in messages, messages

    @pytest.mark.parametrize(("bindings", "given"), NESTED_BINDINGS)
    def test_a_whole_test_run_gives_a_nested_instance_its_blocks_value(
        self, client: TestClient, bindings: dict[str, str], given: str
    ) -> None:
        node = _outer_holding_bound_inner(bindings)
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                function_variables=[
                    _seed(
                        ["fn-1", "fn-2"],
                        {"who": _staged("staged-who"), "note": _staged("staged-note")},
                    )
                ],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert f"inner who={given} note=staged-note" in messages, messages

    @pytest.mark.parametrize(("bindings", "given"), NESTED_BINDINGS)
    def test_a_run_scope_gives_a_nested_instance_its_blocks_value(
        self, client: TestClient, bindings: dict[str, str], given: str
    ) -> None:
        node = _outer_holding_bound_inner(bindings)
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[
                    _seed(
                        ["fn-1", "fn-2"],
                        {"who": _staged("staged-who"), "note": _staged("staged-note")},
                    )
                ],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert f"inner who={given} note=staged-note" in messages, messages


RUNS_ALONE = [
    pytest.param(_RUN_SCOPE, id="run-scope"),
    pytest.param({"function_path": ["fn-1"], "single_node_id": "who-log"}, id="block-run"),
    pytest.param({"function_path": ["fn-1"], "start_node_id": "who-log"}, id="run-from-here"),
]


class TestARunAloneUsesTheStagedInputValue:
    """The instance a run alone starts in takes the staged value of its input, over the value
    its Function Block's binding gave it in the last run (REQ-3.1.2.10)."""

    @pytest.mark.parametrize("mode", RUNS_ALONE)
    def test_the_staged_input_value_wins_over_the_blocks_binding(
        self, client: TestClient, mode: dict[str, Any]
    ) -> None:
        node = _bound(_who_function_node(), {"who": "'bound'"})
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()
        first = _finished(client, _run(client, test_id, env_id, node))
        assert "who=bound" in _log_messages(first), _log_messages(first)

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **mode,
                function_variables=[_seed(["fn-1"], {"who": _staged("ann")})],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "who=ann" in messages, messages
        assert "who=bound" not in messages, messages


_STAGED_SECRET = "staged-secret-canary-58"
_SECRET_MASK = "********"


def _staged_secret() -> dict[str, Any]:
    return {"type": "string", "value": _STAGED_SECRET, "secret": True}


def _assert_run_treats_it_as_secret(session_id: str, logged: str) -> None:
    """The staged value is masked where it is logged and held by the run's secret registry."""
    assert _session_status(session_id) == "passed", _session(session_id).get("error")
    messages = _log_messages(session_id)
    assert any(logged in m for m in messages), messages
    assert not any(_STAGED_SECRET in m for m in messages), messages
    assert _STAGED_SECRET in _session(session_id)["secret_registry"].scan_values()


STAGED_SECRET_ENTRIES = [
    pytest.param(_RUN_SCOPE, "who", id="run-scope-input"),
    pytest.param(_RUN_SCOPE, "note", id="run-scope-local"),
    pytest.param(_RUN_SCOPE, "out", id="run-scope-output"),
    pytest.param({}, "note", id="whole-test-local"),
    pytest.param({}, "out", id="whole-test-output"),
]


class TestAStagedSecretValue:
    """A ``secret`` flag on a ``function_variables`` entry makes the run treat the staged value
    as a secret, as the same flag on a flat ``variables`` entry does (REQ-3.1.3.5)."""

    def test_a_flat_entry_marked_secret_is_masked_in_the_run(self, client: TestClient) -> None:
        node = _log_node("tok-log", "'tok=' + tok")
        test_id = _create_test_on_disk(
            client, nodes=[node], variables={"tok": {"type": "string", "value": "plain"}}
        )
        env_id = _seed_environment()

        session_id = _finished(
            client, _run(client, test_id, env_id, node, variables={"tok": _staged_secret()})
        )

        _assert_run_treats_it_as_secret(session_id, f"tok={_SECRET_MASK}")

    @pytest.mark.parametrize(("mode", "name"), STAGED_SECRET_ENTRIES)
    def test_a_scoped_entry_marked_secret_is_masked_in_the_run(
        self, client: TestClient, mode: dict[str, Any], name: str
    ) -> None:
        node = _local_fn_node_with_def("fn-1", _staged_fn_def())
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **mode,
                function_variables=[_seed(["fn-1"], {name: _staged_secret()})],
            ),
        )

        _assert_run_treats_it_as_secret(session_id, f"{name}={_SECRET_MASK}")

    def test_a_staged_expression_marked_secret_is_masked_in_the_run(
        self, client: TestClient
    ) -> None:
        node = _local_fn_node_with_def("fn-1", _staged_fn_def())
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()
        staged = {
            "type": "string",
            "isExpression": True,
            "value": f"'{_STAGED_SECRET}'",
            "secret": True,
        }

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[_seed(["fn-1"], {"note": staged})],
            ),
        )

        _assert_run_treats_it_as_secret(session_id, f"note={_SECRET_MASK}")

    def test_a_nested_instance_entry_marked_secret_is_masked_in_the_run(
        self, client: TestClient
    ) -> None:
        node = _outer_node_holding_inner()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **_RUN_SCOPE,
                function_variables=[_seed(["fn-1", "fn-2"], {"note": _staged_secret()})],
            ),
        )

        _assert_run_treats_it_as_secret(session_id, f"inner note={_SECRET_MASK}")


pytestmark = pytest.mark.usefixtures("temp_storage_path")
