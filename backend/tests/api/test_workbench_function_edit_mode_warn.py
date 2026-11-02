"""Edit-mode Shared Function instances emit a WARN on entry (REQ-3.1.2.2).

When the engine enters a Shared Function instance that is in edit mode, it emits
exactly one WARN log line reminding the user that the draft changes are not
published and the instance is unlinked from the shared library. A clean
(non-edit-mode) instance emits no such warning.

The message wording these tests pin:

    Function '<name>' is in edit mode: changes are not published and this
    instance is unlinked from the shared library
"""

from __future__ import annotations

import re
from collections.abc import Generator
from typing import Any

import pytest

# Anchored message (the function name is interpolated at runtime).
EDIT_MODE_WARN_RE = re.compile(
    r"^Function '.+' is in edit mode: changes are not published and this "
    r"instance is unlinked from the shared library$"
)


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
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


def _make_run_session(session_id: str) -> dict[str, Any]:
    import asyncio

    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Edit-Mode Warn Test",
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


def _draft_def(name: str = "edit_draft_fn", message: str = "'editing'") -> dict[str, Any]:
    """A self-contained edit-mode draft body that logs a literal (no I/O)."""
    return {
        "name": name,
        "description": "draft under edit",
        "tags": [],
        "inputs": [],
        "outputs": [],
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
                            "values": {"message": message, "level": "INFO"},
                            "profileBindings": [],
                            "outputBindings": {},
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


def _edit_mode_node_data(name: str = "edit_draft_fn") -> dict[str, Any]:
    """A Shared Function instance in edit mode: draft is the execution contract."""
    return {
        "label": name,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "shared",
        "functionId": "11111111-1111-1111-1111-111111111111",
        "functionVersion": "1.0.0",
        "editMode": True,
        "draft": _draft_def(name=name),
        "upstreamLink": {
            "functionId": "11111111-1111-1111-1111-111111111111",
            "sourceVersion": "1.0.0",
        },
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }


def _local_node_data(name: str = "plain_local_fn") -> dict[str, Any]:
    """A clean Local Function instance (NOT in edit mode)."""
    return {
        "label": name,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "local",
        "localDefinition": _draft_def(name=name, message="'local'"),
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }


def _warn_lines(session_id: str) -> list[dict[str, Any]]:
    from wavecore.api.services import log_streaming_service

    logs = log_streaming_service.get_logs(session_id)
    return [
        e for e in logs if isinstance(e, dict) and EDIT_MODE_WARN_RE.match(e.get("message", ""))
    ]


class TestEditModeEntryEmitsWarn:
    """Entering an edit-mode instance emits exactly one WARN line."""

    @pytest.mark.asyncio
    async def test_edit_mode_entry_emits_one_warn(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench.functions import handle_function_node
        from wavecore.api.services.workbench.node_helpers import _extract_node_fields

        session_id = "warn-edit-mode"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            await handle_function_node(
                _extract_node_fields({"data": _edit_mode_node_data()}), {}, session_id, "fn-edit"
            )
            warns = _warn_lines(session_id)
            assert len(warns) == 1, [e.get("message") for e in warns]
            assert warns[0].get("level") in ("WARN", "WARNING")
        finally:
            _wb_common._clear_sessions_sync()


class TestCleanInstanceEmitsNoWarn:
    """A non-edit-mode instance must NOT emit the edit-mode WARN (no over-warning)."""

    @pytest.mark.asyncio
    async def test_local_instance_emits_no_edit_mode_warn(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench.functions import handle_function_node
        from wavecore.api.services.workbench.node_helpers import _extract_node_fields

        session_id = "warn-clean-local"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        try:
            await handle_function_node(
                _extract_node_fields({"data": _local_node_data()}), {}, session_id, "fn-local"
            )
            assert _warn_lines(session_id) == []
        finally:
            _wb_common._clear_sessions_sync()


pytestmark = pytest.mark.usefixtures("temp_storage_path")
