"""Nested Function execution at depth (REQ-3.1.1.4).

A Local Function may contain other Functions (Local or Published) to any depth.
Execution dispatches every Function node through the shared engine walker, so a
nested Function runs exactly like a top-level one: ``_execute_node`` routes
``nodeType=="function"`` to ``handle_function_node`` -> ``execute_function``,
which runs the body on the same session (recursively for nested Functions).

This file proves nesting executes end-to-end:
    - a 3-level Local nesting runs to completion and the deepest body executes,
    - a Local Function containing a Published Function executes,
    - a Published Function referencing another Published Function executes.

Cycle detection at 3+ links is covered in
``tests/functions/test_validation_self_reference.py`` and
``tests/functions/test_functions_storage.py``.

The runs drive ``_execute_workflow`` directly (the step-debug harness) so they
do not depend on the Test save pipeline. Published bodies are seeded through the
low-level storage layer.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest

from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

pytestmark = pytest.mark.usefixtures("temp_storage_path")


@pytest.fixture(autouse=True)
def register_plugins_and_controls() -> Any:
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


def _make_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Nested Function Test",
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


def _log_node(node_id: str, message: str) -> dict[str, Any]:
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
                "outputBindings": {},
            },
            "displayName": node_id,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _local_def(*, name: str, nodes: list[dict[str, Any]], entry: str) -> dict[str, Any]:
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


def _local_function_node(node_id: str, *, local_definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": local_definition,
            "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
        },
    }


def _shared_function_node(
    node_id: str, *, function_id: str, version: str = "1.0.0"
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": version,
            "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
        },
    }


def _edit_mode_shared_node(
    node_id: str,
    *,
    function_id: str,
    draft: dict[str, Any],
    version: str = "1.0.0",
) -> dict[str, Any]:
    node = _shared_function_node(node_id, function_id=function_id, version=version)
    node["data"]["editMode"] = True
    node["data"]["draft"] = draft
    node["data"]["upstreamLink"] = {"functionId": function_id, "sourceVersion": version}
    return node


def _seed_published(
    *,
    fn_id: str,
    name: str,
    body_nodes: list[dict[str, Any]],
    entry: str,
    dep_function_ids: list[str],
    version: str = "1.0.0",
) -> None:
    """Seed a Published Function whose stored body holds ``body_nodes``."""
    from wavecore.api.services.functions._storage import save_new_version

    save_new_version(
        fn_id,
        version,
        {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": dep_function_ids, "plugins": []},
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


async def _run(
    session_id: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, Any]:
    session = _make_session(session_id)
    _wb_common._workbench_sessions[session_id] = session
    await asyncio.wait_for(
        workbench_service._execute_workflow(session_id, nodes, edges, {}),
        timeout=10.0,
    )
    return session


def _log_messages(session_id: str) -> list[str]:
    return [
        entry.get("message", "")
        for entry in log_streaming_service.get_logs(session_id)
        if isinstance(entry, dict)
    ]


class TestThreeLevelLocalNesting:
    """A Local Function containing a Local Function containing a Local Function
    runs to completion and the deepest body executes."""

    @pytest.mark.asyncio
    async def test_three_level_local_run_executes_deepest_body(self) -> None:
        inner = _local_def(
            name="Inner", nodes=[_log_node("deep-log", "'DEEP-LEVEL-3'")], entry="deep-log"
        )
        middle = _local_def(
            name="Middle",
            nodes=[_local_function_node("inner-fn", local_definition=inner)],
            entry="inner-fn",
        )
        outer = _local_def(
            name="Outer",
            nodes=[_local_function_node("middle-fn", local_definition=middle)],
            entry="middle-fn",
        )
        nodes = [_local_function_node("outer-fn", local_definition=outer)]
        edges = [{"source": "start-node", "target": "outer-fn"}]

        session = await _run("nested-3-level", nodes, edges)

        assert session["status"] == "passed", session.get("status")
        assert any("DEEP-LEVEL-3" in m for m in _log_messages("nested-3-level"))
        assert session["block_states"].get("outer-fn") == "passed"


class TestLocalContainsPublished:
    """A Local Function whose body references a Published Function executes."""

    @pytest.mark.asyncio
    async def test_local_body_with_published_instance_runs(self) -> None:
        published_id = str(uuid.uuid4())
        _seed_published(
            fn_id=published_id,
            name="PublishedLeaf",
            body_nodes=[_log_node("pub-log", "'PUBLISHED-BODY'")],
            entry="pub-log",
            dep_function_ids=[],
        )
        local = _local_def(
            name="LocalParent",
            nodes=[_shared_function_node("pub-ref", function_id=published_id)],
            entry="pub-ref",
        )
        nodes = [_local_function_node("local-fn", local_definition=local)]
        edges = [{"source": "start-node", "target": "local-fn"}]

        session = await _run("nested-local-pub", nodes, edges)

        assert session["status"] == "passed", session.get("status")
        assert any("PUBLISHED-BODY" in m for m in _log_messages("nested-local-pub"))


class TestPublishedReferencesPublished:
    """A Published Function whose definition references another Published
    Function executes."""

    @pytest.mark.asyncio
    async def test_published_referencing_published_runs(self) -> None:
        inner_id = str(uuid.uuid4())
        outer_id = str(uuid.uuid4())
        _seed_published(
            fn_id=inner_id,
            name="InnerPublished",
            body_nodes=[_log_node("inner-log", "'INNER-PUBLISHED'")],
            entry="inner-log",
            dep_function_ids=[],
        )
        _seed_published(
            fn_id=outer_id,
            name="OuterPublished",
            body_nodes=[_shared_function_node("inner-ref", function_id=inner_id)],
            entry="inner-ref",
            dep_function_ids=[inner_id],
        )
        nodes = [_shared_function_node("top-ref", function_id=outer_id)]
        edges = [{"source": "start-node", "target": "top-ref"}]

        session = await _run("nested-pub-pub", nodes, edges)

        assert session["status"] == "passed", session.get("status")
        assert any("INNER-PUBLISHED" in m for m in _log_messages("nested-pub-pub"))


class TestNestedEditModeDraftDepthTwo:
    """A Shared Function in edit mode nested inside a local parent (depth 2)
    executes its draft body, not the published one (REQ-5.2.1.24)."""

    @pytest.mark.asyncio
    async def test_depth_two_draft_executes_instead_of_published(self) -> None:
        published_id = str(uuid.uuid4())
        _seed_published(
            fn_id=published_id,
            name="EditTargetD2",
            body_nodes=[_log_node("pub-d2-log", "'published-d2-body'")],
            entry="pub-d2-log",
            dep_function_ids=[],
        )
        draft = _local_def(
            name="EditTargetD2",
            nodes=[_log_node("draft-d2-log", "'draft-d2-executed'")],
            entry="draft-d2-log",
        )
        outer = _local_def(
            name="Outer",
            nodes=[_edit_mode_shared_node("edit-d2", function_id=published_id, draft=draft)],
            entry="edit-d2",
        )
        nodes = [_local_function_node("outer-fn", local_definition=outer)]
        edges = [{"source": "start-node", "target": "outer-fn"}]

        session = await _run("nested-draft-d2", nodes, edges)

        messages = _log_messages("nested-draft-d2")
        assert session["status"] == "passed", session.get("status")
        assert "draft-d2-executed" in messages, messages
        assert not any("published-d2-body" in m for m in messages), messages
        assert session["block_states"].get("outer-fn") == "passed"


class TestNestedEditModeDraftDepthThree:
    """A Shared-in-edit nested inside another Shared-in-edit's draft (depth 3)
    resolves the draft body at every depth (REQ-5.2.1.24)."""

    @pytest.mark.asyncio
    async def test_depth_three_drafts_execute_at_each_depth(self) -> None:
        inner_id = str(uuid.uuid4())
        outer_id = str(uuid.uuid4())
        _seed_published(
            fn_id=inner_id,
            name="InnerEdit",
            body_nodes=[_log_node("pub-d3-log", "'published-d3-body'")],
            entry="pub-d3-log",
            dep_function_ids=[],
        )
        _seed_published(
            fn_id=outer_id,
            name="OuterEdit",
            body_nodes=[_log_node("pub-d2-log", "'published-d2-body'")],
            entry="pub-d2-log",
            dep_function_ids=[],
        )
        inner_draft = _local_def(
            name="InnerEdit",
            nodes=[_log_node("draft-d3-log", "'draft-d3-executed'")],
            entry="draft-d3-log",
        )
        outer_draft = _local_def(
            name="OuterEdit",
            nodes=[
                _log_node("draft-d2-log", "'draft-d2-executed'"),
                _edit_mode_shared_node("edit-d3", function_id=inner_id, draft=inner_draft),
            ],
            entry="draft-d2-log",
        )
        outer_draft["workflow"]["edges"].append({"source": "draft-d2-log", "target": "edit-d3"})
        parent = _local_def(
            name="Parent",
            nodes=[_edit_mode_shared_node("edit-d2", function_id=outer_id, draft=outer_draft)],
            entry="edit-d2",
        )
        nodes = [_local_function_node("parent-fn", local_definition=parent)]
        edges = [{"source": "start-node", "target": "parent-fn"}]

        session = await _run("nested-draft-d3", nodes, edges)

        messages = _log_messages("nested-draft-d3")
        assert session["status"] == "passed", session.get("status")
        assert "draft-d2-executed" in messages, messages
        assert "draft-d3-executed" in messages, messages
        assert not any("published-d2-body" in m for m in messages), messages
        assert not any("published-d3-body" in m for m in messages), messages


class TestNestedLocalUnderEditModeParent:
    """A local Function (inline localDefinition) nested inside an edit-mode
    parent's draft executes its inline body (REQ-5.2.1.24)."""

    @pytest.mark.asyncio
    async def test_local_definition_inside_draft_executes(self) -> None:
        published_id = str(uuid.uuid4())
        _seed_published(
            fn_id=published_id,
            name="EditParent",
            body_nodes=[_log_node("pub-d1-log", "'published-d1-body'")],
            entry="pub-d1-log",
            dep_function_ids=[],
        )
        nested_local = _local_def(
            name="NestedLocal",
            nodes=[_log_node("local-d2-log", "'local-under-draft-executed'")],
            entry="local-d2-log",
        )
        draft = _local_def(
            name="EditParent",
            nodes=[_local_function_node("local-d2", local_definition=nested_local)],
            entry="local-d2",
        )
        nodes = [_edit_mode_shared_node("edit-d1", function_id=published_id, draft=draft)]
        edges = [{"source": "start-node", "target": "edit-d1"}]

        session = await _run("nested-local-in-draft", nodes, edges)

        messages = _log_messages("nested-local-in-draft")
        assert session["status"] == "passed", session.get("status")
        assert "local-under-draft-executed" in messages, messages
        assert not any("published-d1-body" in m for m in messages), messages
