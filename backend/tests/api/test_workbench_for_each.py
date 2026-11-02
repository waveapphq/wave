"""Tests for for-each execution in workbench_service._execute_workflow.

Tests the for-each execution engine: typed envelope wrapping, collection resolution,
iteration loop, variable injection, break/continue hooks, timeout, error handling,
signal extraction, and engine key stripping.

Coverage targets:
- for_each._wrap_item: Typed envelope creation for all WAVE types
- for_each._run_for_each_iteration_loop: Main iteration loop
- for_each._execute_for_each_body: Full for-each orchestration
- signals._extract_engine_signals: __for_each and related signals
- try_catch._strip_engine_keys: __for_each in strip set

REQ-3.5.1.16: For-Each loop with typed envelope iteration
REQ-3.5.1.2: Break hook points
REQ-3.5.1.3: Continue hook points
"""

import asyncio
from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench.node_helpers import _extract_node_fields
from wavecore.api.services.workbench.signals import _extract_engine_signals
from wavecore.api.services.workbench.try_catch import _strip_engine_keys
from wavecore.core.table import Table


def _hosts_table() -> Table:
    """A two-column table, as a converter plugin's output binding would supply."""
    table = Table(columns=[("host", "string"), ("port", "integer")])
    table.add_row(["10.0.0.1", 22])
    table.add_row(["10.0.0.2", 8080])
    return table


def _make_session(session_id: str) -> dict[str, Any]:
    """Create a minimal workbench session for testing."""
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "ForEach Test",
        "scope_failed": False,
    }


def _make_node(
    node_id: str,
    label: str = "Block",
    element_type: str = "delay",
    node_type: str = "control",
    version: str = "1.0.0",
    config_values: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    display_name: str | None = None,
    disabled: bool = False,
) -> dict[str, Any]:
    """Create a workflow node for testing."""
    config: dict[str, Any] = {"values": config_values or {"duration": 10}}
    if output_bindings:
        config["outputBindings"] = output_bindings
    config.setdefault("profileBindings", [])
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "config": config,
            "disabled": disabled,
            "displayName": display_name or label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_log_node(
    node_id: str,
    display_name: str,
    message: str = "'ok'",
) -> dict[str, Any]:
    """Create a Log plugin node for testing."""
    node = _make_node(
        node_id,
        label="Log",
        element_type="log",
        node_type="plugin",
        version="1.0.0",
        config_values={"message": message, "level": "INFO"},
        display_name=display_name,
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_for_each_node(
    node_id: str = "fe-1",
    collection: Any = None,
    timeout: float | None = None,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Create a For Each control node."""
    values: dict[str, Any] = {}
    if collection is not None:
        values["collection"] = collection
    if timeout is not None:
        values["timeout"] = timeout
    return _make_node(
        node_id,
        label="For Each",
        element_type="for-each",
        node_type="control",
        version="1.0.0",
        config_values=values,
        output_bindings=output_bindings or {"item": "current_item", "index": "i"},
        display_name="For Each",
    )


# ---------------------------------------------------------------------------
# Typed envelope wrapping tests (_wrap_item)
# ---------------------------------------------------------------------------


class TestWrapItem:
    """Test _wrap_item typed envelope creation for all WAVE types."""

    def test_wrap_string(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item("hello") == {"type": "string", "value": "hello"}

    def test_wrap_integer(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item(42) == {"type": "integer", "value": 42}

    def test_wrap_float(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item(3.14) == {"type": "float", "value": 3.14}

    def test_wrap_boolean_true(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item(True) == {"type": "boolean", "value": True}

    def test_wrap_boolean_false(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item(False) == {"type": "boolean", "value": False}

    def test_wrap_list(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item([1, 2, 3]) == {"type": "array", "value": [1, 2, 3]}

    def test_wrap_dict(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item({"key": "val"}) == {"type": "map", "value": {"key": "val"}}

    def test_wrap_none_keeps_the_item_null(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item(None) == {"type": "string", "value": None}

    def test_wrap_custom_object_fallback_to_string(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        class Custom:
            def __str__(self) -> str:
                return "custom-obj"

        result = _wrap_item(Custom())
        assert result["type"] == "string"
        assert result["value"] == "custom-obj"

    def test_wrap_bool_before_int(self) -> None:
        """bool is a subclass of int in Python - must detect bool BEFORE int."""
        from wavecore.api.services.workbench.for_each import _wrap_item

        # True is isinstance(True, int) == True, so order matters
        assert _wrap_item(True)["type"] == "boolean"
        assert _wrap_item(False)["type"] == "boolean"

    def test_wrap_empty_dict(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item({}) == {"type": "map", "value": {}}

    def test_wrap_empty_list(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item([]) == {"type": "array", "value": []}

    def test_wrap_negative_integer(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item(-7) == {"type": "integer", "value": -7}

    def test_wrap_zero_integer(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item(0) == {"type": "integer", "value": 0}

    def test_wrap_zero_float(self) -> None:
        from wavecore.api.services.workbench.for_each import _wrap_item

        assert _wrap_item(0.0) == {"type": "float", "value": 0.0}


# ---------------------------------------------------------------------------
# Egress queuing tests (_queue_for_loop_egress, shared by every loop)
# ---------------------------------------------------------------------------


class TestForEachSignalExtraction:
    """Test _extract_engine_signals for for-each related signals."""

    def test_extract_for_each_signals(self) -> None:
        """__for_each and related keys are extracted from result dict."""
        result: dict[str, Any] = {
            "__for_each": True,
            "__collection": ["a", "b"],
            "__item_variable": "item",
            "__index_variable": "index",
            "item": {"type": "string", "value": "a"},
            "index": 0,
        }
        signals = _extract_engine_signals(result)
        assert signals["for_each"] is True
        assert signals["collection"] == ["a", "b"]
        assert signals["item_variable"] == "item"
        assert signals["index_variable"] == "index"
        # Engine keys removed from result, user output remains
        assert "__for_each" not in result
        assert "__collection" not in result
        assert "__item_variable" not in result
        assert "__index_variable" not in result
        assert "item" in result
        assert "index" in result

    def test_extract_for_each_signals_default_none(self) -> None:
        """Without for-each keys, signals default to None."""
        result: dict[str, Any] = {"some_output": "val"}
        signals = _extract_engine_signals(result)
        assert signals["for_each"] is None
        assert signals["collection"] is None
        assert signals["item_variable"] is None
        assert signals["index_variable"] is None

    def test_extract_for_each_with_none_result(self) -> None:
        """None result returns all-None signals."""
        signals = _extract_engine_signals(None)
        assert signals["for_each"] is None
        assert signals["collection"] is None

    def test_extract_for_each_with_non_dict_result(self) -> None:
        """Non-dict result returns all-None signals."""
        signals = _extract_engine_signals("not a dict")
        assert signals["for_each"] is None


# ---------------------------------------------------------------------------
# Engine key strip list tests
# ---------------------------------------------------------------------------


class TestStripEngineKeysForEach:
    """Test that __for_each is in the _strip_engine_keys set."""

    def test_strip_for_each_key(self) -> None:
        """__for_each is removed by _strip_engine_keys."""
        result: dict[str, Any] = {
            "__for_each": True,
            "__collection": ["a"],
            "__item_variable": "item",
            "__index_variable": "index",
            "item": {"type": "string", "value": "a"},
            "index": 0,
        }
        _strip_engine_keys(result)
        assert "__for_each" not in result
        assert "__collection" not in result
        assert "__item_variable" not in result
        assert "__index_variable" not in result
        # User data preserved
        assert result["item"] == {"type": "string", "value": "a"}
        assert result["index"] == 0

    def test_strip_preserves_existing_for_loop_keys(self) -> None:
        """Existing for-loop keys still stripped alongside for-each keys."""
        result: dict[str, Any] = {
            "__for_loop": True,
            "__for_each": True,
            "__collection": [],
            "output": "val",
        }
        _strip_engine_keys(result)
        assert "__for_loop" not in result
        assert "__for_each" not in result
        assert "__collection" not in result
        assert result["output"] == "val"


# ---------------------------------------------------------------------------
# End-to-end workflow execution tests
# ---------------------------------------------------------------------------


class TestForEachWorkflowExecution:
    """End-to-end for-each workflow execution tests."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Register controls/plugins and clear sessions before/after each test."""
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

    @pytest.mark.asyncio
    async def test_for_each_array_3_elements(self) -> None:
        """ForEach(["a","b","c"]) with body Log and then Log - 3 iterations, all pass."""
        session_id = "fe-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b", "c"]),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_empty_collection(self) -> None:
        """ForEach([]) - body skipped, then executed, session passes."""
        session_id = "fe-2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=[]),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_map_iterates_keys(self) -> None:
        """ForEach({"host": "10.0.0.1", "port": 8080}) - iterates over keys."""
        session_id = "fe-3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection={"host": "10.0.0.1", "port": 8080}),
            _make_log_node("body-log", "Body Log", "'key'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_table_iterates_rows(self) -> None:
        """ForEach(Table) - the live path iterates rows, not characters or keys.

        A Table reaches the loop whenever an upstream converter binds its output
        to a variable. Before this was supported the run failed at validation with
        "collection must be a list or dict".
        """
        session_id = "fe-table-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"current_item": None, "i": None}

        nodes = [
            _make_for_each_node("fe-1", collection=_hosts_table()),
            _make_log_node("body-log", "Body Log", "'row'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        # Two rows -> indices 0 and 1; the last item is the last row as a map.
        assert variables["i"] == 1
        assert variables["current_item"] == {
            "type": "map",
            "value": {"host": "10.0.0.2", "port": 8080},
        }

    @pytest.mark.asyncio
    async def test_for_each_table_row_columns_readable_in_body(self) -> None:
        """A body expression reads item.value.<column> for the current row."""
        session_id = "fe-table-2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"current_item": None, "i": None}

        nodes = [
            _make_for_each_node("fe-1", collection=_hosts_table()),
            _make_log_node("body-log", "Body Log", "current_item['value']['host']"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        # A column the row does not carry would fail the Log node and the session.
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_empty_table_skips_body(self) -> None:
        """ForEach(empty Table) - zero iterations, then-path still runs."""
        session_id = "fe-table-3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"current_item": None, "i": None}

        nodes = [
            _make_for_each_node("fe-1", collection=Table(columns=[("host", "string")])),
            _make_log_node("body-log", "Body Log", "'row'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        assert variables["current_item"] is None

    @pytest.mark.asyncio
    async def test_for_each_non_collection_fails_with_updated_message(self) -> None:
        """A non-collection still aborts the run, now naming all three types."""
        session_id = "fe-table-4"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=42),
            _make_log_node("body-log", "Body Log", "'row'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["fe-1"] == "failed"

    @pytest.mark.asyncio
    async def test_for_each_resolves_a_collection_picked_from_the_variable_list(self) -> None:
        """A collection bound through the variable picker iterates its value.

        The picker stores the variable NAME as a literal; without reference
        resolution the loop was handed the name itself and aborted.
        """
        session_id = "fe-ref-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {
            "hosts": ["alpha", "bravo"],
            "current_item": None,
            "i": None,
        }

        nodes = [
            _make_for_each_node("fe-1", collection="hosts"),
            _make_log_node("body-log", "Body Log", "'row'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert variables["i"] == 1
        assert variables["current_item"] == {"type": "string", "value": "bravo"}

    @pytest.mark.asyncio
    async def test_for_each_resolves_a_picked_table_variable(self) -> None:
        """The picker path reaches the table branch too, not only arrays."""
        session_id = "fe-ref-2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {
            "orders": _hosts_table(),
            "current_item": None,
            "i": None,
        }

        nodes = [
            _make_for_each_node("fe-1", collection="orders"),
            _make_log_node("body-log", "Body Log", "current_item['value']['host']"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert variables["current_item"] == {
            "type": "map",
            "value": {"host": "10.0.0.2", "port": 8080},
        }

    @pytest.mark.asyncio
    async def test_for_each_null_list_item_reaches_the_body_as_null(self) -> None:
        """A null item in the list reaches the body as null, never as the text "None"."""
        from wavecore.api.services import log_streaming_service

        session_id = "fe-null-item-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {
            "hosts": ["alpha", None],
            "current_item": None,
            "i": None,
        }

        nodes = [
            _make_for_each_node("fe-1", collection="hosts"),
            _make_log_node(
                "body-log",
                "Body Log",
                "'item is null' if current_item['value'] is None else 'item is text'",
            ),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        printed = [
            entry["message"]
            for entry in log_streaming_service.get_logs(session_id)
            if entry["message"].startswith("item is ")
        ]
        assert session["status"] == "passed"
        assert printed == ["item is text", "item is null"]
        assert variables["current_item"] == {"type": "string", "value": None}

    @pytest.mark.asyncio
    async def test_for_each_over_null_runs_zero_times(self) -> None:
        """A null collection runs zero times: then runs, index 0, item keeps its value."""
        from wavecore.api.services import log_streaming_service

        session_id = "fe-null-collection"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"hosts": None, "current_item": "before", "i": None}

        nodes = [
            _make_for_each_node("fe-1", collection="hosts"),
            _make_log_node("body-log", "Body Log", "'row'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        started = [
            entry["message"]
            for entry in log_streaming_service.get_logs(session_id)
            if entry["message"].startswith("[FOR-EACH] Starting loop")
        ]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"
        assert (variables["i"], variables["current_item"]) == (0, "before")
        assert started == ["[FOR-EACH] Starting loop (0 iterations)"]

    @pytest.mark.asyncio
    async def test_for_each_literal_collection_is_not_treated_as_a_reference(self) -> None:
        """An inline literal collection is still iterated as itself."""
        session_id = "fe-ref-3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"current_item": None, "i": None}

        nodes = [
            _make_for_each_node("fe-1", collection=["x", "y", "z"]),
            _make_log_node("body-log", "Body Log", "'row'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert variables["i"] == 2

    @pytest.mark.asyncio
    async def test_for_each_variable_injection(self) -> None:
        """Output bindings inject item and index into variables each iteration."""
        session_id = "fe-4"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"current_item": None, "i": None}

        nodes = [
            _make_for_each_node(
                "fe-1",
                collection=["host-a", "host-b", "host-c"],
                output_bindings={"item": "current_item", "index": "i"},
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # After 3 iterations: last item is host-c (typed envelope), index is 2
        assert variables["i"] == 2
        assert variables["current_item"] == {"type": "string", "value": "host-c"}

    @pytest.mark.asyncio
    async def test_for_each_body_error_aborts(self) -> None:
        """Body node throws - loop aborts, then NOT executed, session FAILED."""
        session_id = "fe-5"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b", "c"]),
            _make_log_node("body-log", "Bad Log", "1/0"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["body-log"] == "failed"
        assert session["block_states"].get("after-log") in ("skipped", None)

    @pytest.mark.asyncio
    async def test_for_each_break_signal(self) -> None:
        """Body node returning __break exits loop, then IS executed."""
        session_id = "fe-6"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b", "c", "d", "e"]),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        call_count = 0
        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, session_id: str, node_id: str) -> Any:
            nonlocal call_count
            result = await original_execute(nf, variables, session_id, node_id)
            if node_id == "body-a":
                call_count += 1
                if call_count >= 2:
                    if result and isinstance(result, dict):
                        result["__break"] = True
                    else:
                        result = {"__break": True}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"current_item": None, "i": None}
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_continue_signal(self) -> None:
        """Body node returning __continue skips rest of body, next iteration starts."""
        session_id = "fe-7"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b", "c"]),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, session_id: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, session_id, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__continue"] = True
                else:
                    result = {"__continue": True}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"current_item": None, "i": None}
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        # body-b should have been skipped on every iteration due to continue
        assert session["block_states"]["body-b"] == "skipped"

    @pytest.mark.asyncio
    async def test_for_each_timeout_interrupts_execution(self) -> None:
        """ForEach with tiny timeout - timeout interrupts, then skipped, session FAILED."""
        session_id = "fe-8"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Large collection to ensure timeout triggers
        large_collection = [f"item-{i}" for i in range(100)]

        nodes = [
            _make_for_each_node("fe-1", collection=large_collection, timeout=0.001),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"].get("after-log") in ("skipped", None)

    @pytest.mark.asyncio
    async def test_for_each_no_body_then_executes(self) -> None:
        """No body connection. Then target executes directly."""
        session_id = "fe-9"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b"]),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_disabled_body_node(self) -> None:
        """Disabled body node is skipped, loop continues."""
        session_id = "fe-10"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        body_node = _make_log_node("body-log", "Body Log", "'ok'")
        body_node["data"]["disabled"] = True

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b"]),
            body_node,
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_stopped_session_breaks(self) -> None:
        """Session set to 'stopped' mid-iteration - loop exits."""
        session_id = "fe-11"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        large_collection = [f"item-{i}" for i in range(100)]

        nodes = [
            _make_for_each_node("fe-1", collection=large_collection),
            _make_log_node("body-log", "Body Log", "'iteration'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node
        call_count = 0

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            nonlocal call_count
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-log":
                call_count += 1
                if call_count >= 2:
                    _wb_common._workbench_sessions[sid]["status"] = "stopped"
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"current_item": None, "i": None}
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_for_each_body_chain_multi_nodes(self) -> None:
        """ForEach with 2 body nodes - both pass on each iteration."""
        session_id = "fe-12"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["x", "y", "z"]),
            _make_log_node("body-a", "Body A", "'a'"),
            _make_log_node("body-b", "Body B", "'b'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-a"] == "passed"
        assert session["block_states"]["body-b"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_body_chain_second_fails(self) -> None:
        """Body chain: LogA -> BadLog. LogA passes, BadLog fails, rest skipped."""
        session_id = "fe-13"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b"]),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "1/0"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["body-a"] == "passed"
        assert session["block_states"]["body-b"] == "failed"

    @pytest.mark.asyncio
    async def test_for_each_table_rows(self) -> None:
        """ForEach over table (list of dicts) - each item is a map-typed envelope."""
        session_id = "fe-14"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"current_item": None, "i": None}

        table = [{"name": "row-a", "val": 1}, {"name": "row-b", "val": 2}]

        nodes = [
            _make_for_each_node(
                "fe-1",
                collection=table,
                output_bindings={"item": "current_item", "index": "i"},
            ),
            _make_log_node("body-log", "Body Log", "'row'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Last item: second row
        assert variables["current_item"] == {"type": "map", "value": {"name": "row-b", "val": 2}}
        assert variables["i"] == 1

    @pytest.mark.asyncio
    async def test_for_each_empty_dict_zero_iterations(self) -> None:
        """Empty dict results in 0 iterations, then-path executes."""
        session_id = "fe-15"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection={}),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_with_profile_bindings(self) -> None:
        """Body node with profileBindings triggers injection."""
        session_id = "fe-16"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        body_node = _make_log_node("body-log", "Body Log", "'ok'")
        body_node["data"]["config"]["profileBindings"] = [
            {"profileField": "host", "variableName": "my_host"}
        ]

        nodes = [
            _make_for_each_node("fe-1", collection=["a"]),
            body_node,
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None, "my_host": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_for_each_single_element(self) -> None:
        """Single element collection - 1 iteration, final variable state correct."""
        session_id = "fe-17"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"current_item": None, "i": None}

        nodes = [
            _make_for_each_node(
                "fe-1",
                collection=["only-one"],
                output_bindings={"item": "current_item", "index": "i"},
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["current_item"] == {"type": "string", "value": "only-one"}
        assert variables["i"] == 0


# ---------------------------------------------------------------------------
# Engine dispatch integration test
# ---------------------------------------------------------------------------


class TestForEachEngineDispatch:
    """Test that execution.py dispatches for_each signals correctly."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Register controls/plugins and clear sessions."""
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

    @pytest.mark.asyncio
    async def test_for_each_dispatch_in_run_and_route(self) -> None:
        """Verify _run_and_route_node dispatches to _execute_for_each_body when for_each signal."""
        session_id = "fe-dispatch-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Build a simple workflow: ForEach -> body -> then
        nodes = [
            _make_for_each_node("fe-1", collection=["x", "y"]),
            _make_log_node("body-log", "Body Log", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"current_item": None, "i": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Proof of dispatch: body was executed and then-path was queued
        assert session["block_states"]["body-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"


class TestForEachBodyNodeGuards:
    """Edge-case guards in for-each body node execution."""

    @pytest.mark.asyncio
    async def test_body_node_not_in_node_map(self) -> None:
        """Body node ID not found in node_map returns (None, None)."""
        from wavecore.api.services.workbench.for_loop import (
            _execute_body_node,
        )

        result, error = await _execute_body_node(
            path_node_id="nonexistent",
            node_map={},
            variables={},
            session={"block_states": {}},
            session_id="guard-1",
            environment_id=None,
        )
        assert result is None
        assert error is None


class TestForEachBodyChainStopped:
    """Stopped session during body chain iteration."""

    @pytest.mark.asyncio
    async def test_body_chain_stopped_mid_iteration(self) -> None:
        """Session set to 'stopped' between body chain nodes returns 'stopped'."""
        from wavecore.api.services.workbench import for_loop as _wb_for_loop
        from wavecore.api.services.workbench.for_loop import (
            _execute_body_chain_iteration,
        )

        session: dict[str, Any] = {"block_states": {}, "status": "running"}

        async def mock_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            session["status"] = "stopped"
            return None

        with patch.object(_wb_for_loop, "_execute_node", mock_execute):
            result = await _execute_body_chain_iteration(
                body_chain=["n1", "n2"],
                node_map={
                    "n1": _make_log_node("n1", "N1", "'a'"),
                    "n2": _make_log_node("n2", "N2", "'b'"),
                },
                variables={},
                session=session,
                session_id="stop-1",
                executed=set(),
                environment_id=None,
            )
        assert result == "stopped"


class TestForEachTimeoutCleanup:
    """Timeout cleanup marks running body nodes as skipped."""

    @pytest.mark.asyncio
    async def test_timeout_marks_running_body_as_stopped(self) -> None:
        """When timeout fires via _dispatch_loop, running body nodes become 'stopped'."""
        import asyncio

        from wavecore.api.services.workbench import for_loop as _wb_for_loop
        from wavecore.api.services.workbench.execution import _dispatch_loop

        session_id = "tc-1"
        session: dict[str, Any] = {
            "block_states": {"loop-1": "running"},
            "status": "running",
            "skipped_node_ids": [],
        }

        async def slow_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            session["block_states"][nid] = "running"
            await asyncio.sleep(10)
            return None

        body_node = _make_log_node("body-1", "Body", "'x'")
        node_map = {"loop-1": _make_for_each_node("loop-1", collection=["a"]), "body-1": body_node}
        adj: dict[str, list[tuple[str, str | None]]] = {
            "loop-1": [("body-1", "body")],
        }
        signals: dict[str, Any] = {
            "for_loop": None,
            "for_each": True,
            "collection": ["a", "b", "c"],
            "item_variable": "item",
            "index_variable": "index",
            # 0.1s gives the dispatcher reliable headroom over the per-iteration
            # asyncio.sleep + log/broadcast overhead so the body's slow_execute
            # registers as 'running' before the timeout fires; the test still
            # exercises the same timeout cleanup path.
            "timeout": 0.1,
        }

        with patch.object(_wb_for_loop, "_execute_node", slow_execute):
            status = await _dispatch_loop(
                signals=signals,
                node_id="loop-1",
                adj=adj,
                node_map=node_map,
                variables={},
                session=session,
                session_id=session_id,
                executed=set(),
                exec_queue=[],
                output_bindings={},
                environment_id="",
            )

        assert status == "failed"
        assert session["block_states"]["body-1"] == "stopped"


class TestSignalCleanupAfterDispatch:
    """Test that _run_and_route_node cleans up nested signals after try-catch and loop dispatch."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Register controls/plugins and clear sessions."""
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

    @pytest.mark.asyncio
    async def test_halt_cleaned_after_try_catch(self) -> None:
        """Stale _halt is cleaned up after try-catch execution."""
        from wavecore.api.services.workbench import execution as _exec_mod

        session_id = "cleanup-tc"
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
        }

        nf = _extract_node_fields(
            _make_node(
                "tc-1",
                label="TC",
                element_type="try-catch-finally",
                node_type="control",
                version="1.0.0",
            )
        )

        async def mock_tc(**kwargs: Any) -> None:
            # Simulate a nested halt being set during try-catch
            kwargs["session"]["_halt"] = True

        with patch.object(_exec_mod, "_execute_try_catch_paths", mock_tc):
            await _exec_mod._run_and_route_node(
                nf=nf,
                variables={},
                session_id=session_id,
                session=session,
                node_id="tc-1",
                block_name="TC",
                output_bindings={},
                adj={"tc-1": [("then-n", "then")]},
                node_map={
                    "tc-1": _make_node("tc-1", element_type="try-catch-finally"),
                    "then-n": _make_log_node("then-n", "Then", "'y'"),
                },
                executed=set(),
                exec_queue=[],
                environment_id="",
            )

        # _halt should have been cleaned up by signal cleanup code
        assert "_halt" not in session

    @pytest.mark.asyncio
    async def test_halt_cleaned_after_loop_dispatch(self) -> None:
        """Stale _halt is cleaned up after loop dispatch."""
        from wavecore.api.services.workbench import execution as _exec_mod

        session_id = "cleanup-loop"
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
        }

        nf = _extract_node_fields(_make_for_each_node("fe-1", collection=["a"]))

        async def mock_dispatch(*args: Any, **kwargs: Any) -> str:
            kwargs.get("session", args[5] if len(args) > 5 else session)["_halt"] = True
            return "passed"

        with patch.object(_exec_mod, "_dispatch_loop", mock_dispatch):
            await _exec_mod._run_and_route_node(
                nf=nf,
                variables={"item": None, "index": None},
                session_id=session_id,
                session=session,
                node_id="fe-1",
                block_name="ForEach",
                output_bindings={"item": "item", "index": "index"},
                adj={"fe-1": [("body-n", "body"), ("then-n", "then")]},
                node_map={
                    "fe-1": _make_for_each_node("fe-1", collection=["a"]),
                    "body-n": _make_log_node("body-n", "Body", "'x'"),
                    "then-n": _make_log_node("then-n", "Then", "'y'"),
                },
                executed=set(),
                exec_queue=[],
                environment_id="",
            )

        # _halt should have been cleaned up by signal cleanup code
        assert "_halt" not in session


class TestForEachTargetAwareBreakContinue:
    """Test target-aware break/continue signal propagation in for-each loop.

    REQ-3.5.1.2: Break with target_loop for multi-level break
    REQ-3.5.1.3: Continue with target_loop for multi-level continue
    """

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Register controls/plugins and clear sessions before/after each test."""
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

    @pytest.mark.asyncio
    async def test_break_targeting_this_loop_queues_then(self) -> None:
        """Break with target matching this for-each's node_id - exits, then-path executes."""
        session_id = "fe-target-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b", "c", "d", "e"]),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node
        call_count = 0

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            nonlocal call_count
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                call_count += 1
                if call_count >= 2:
                    if result and isinstance(result, dict):
                        result["__break"] = True
                        result["__break_target"] = "fe-1"
                    else:
                        result = {"__break": True, "__break_target": "fe-1"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"current_item": None, "i": None}
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_break_targeting_parent_loop_skips_then(self) -> None:
        """Break with target NOT matching this for-each - exits, SKIPS then-path, propagates."""
        session_id = "fe-target-2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b", "c"]),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__break"] = True
                    result["__break_target"] = "outer-for-999"
                else:
                    result = {"__break": True, "__break_target": "outer-for-999"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"current_item": None, "i": None}
            )

        session = _wb_common._workbench_sessions[session_id]
        # Then-path SKIPPED because break targets a parent loop
        assert session["block_states"].get("after-log") in ("skipped", None)
        # Session carries propagation signal for parent
        assert session.get("_loop_signal") == "break"
        assert session.get("_loop_signal_target") == "outer-for-999"

    @pytest.mark.asyncio
    async def test_continue_targeting_this_loop_advances(self) -> None:
        """Continue with target matching this for-each - skips body, continues iteration."""
        session_id = "fe-target-3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b", "c"]),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__continue"] = True
                    result["__continue_target"] = "fe-1"
                else:
                    result = {"__continue": True, "__continue_target": "fe-1"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"current_item": None, "i": None}
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        # body-b skipped because continue fires before it
        assert session["block_states"]["body-b"] == "skipped"

    @pytest.mark.asyncio
    async def test_continue_targeting_parent_loop_propagates(self) -> None:
        """Continue with target NOT matching this for-each - exits, propagates to parent."""
        session_id = "fe-target-4"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_each_node("fe-1", collection=["a", "b", "c"]),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "fe-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__continue"] = True
                    result["__continue_target"] = "outer-while-888"
                else:
                    result = {"__continue": True, "__continue_target": "outer-while-888"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"current_item": None, "i": None}
            )

        session = _wb_common._workbench_sessions[session_id]
        # Then-path SKIPPED because continue targets a parent loop
        assert session["block_states"].get("after-log") in ("skipped", None)
        # Session carries propagation signal for parent
        assert session.get("_loop_signal") == "continue"
        assert session.get("_loop_signal_target") == "outer-while-888"


# ---------------------------------------------------------------------------
# Zero runs inside a container: the item keeps its value at any depth
# ---------------------------------------------------------------------------


def _make_run_session(session_id: str) -> dict[str, Any]:
    """A live session with the debugger and broadcast keys every container reads."""
    return {
        **_make_session(session_id),
        "variables": {},
        "breakpoints": set(),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
    }


_ALWAYS_TRUE: list[dict[str, Any]] = [{"type": "expression", "expression": "True"}]
_ALWAYS_FALSE: list[dict[str, Any]] = [{"type": "expression", "expression": "False"}]


def _container(container: str) -> tuple[dict[str, Any], str, str | None]:
    """The container node, the handle its inner lane leaves by, and its exit handle."""
    if container == "for-body":
        node = _make_node("outer", label="For Loop", element_type="for")
        node["data"]["config"]["values"] = {"mode": "count", "count": 1}
        node["data"]["config"]["outputBindings"] = {"index": "outer_i"}
        return node, "body", "then"
    if container == "while-body":
        node = _make_node("outer", label="While Loop", element_type="while")
        node["data"]["config"]["values"] = {"mode": "do-while", "conditions": _ALWAYS_FALSE}
        node["data"]["config"]["outputBindings"] = {"index": "outer_i"}
        return node, "body", "then"
    if container == "switch-case":
        node = _make_node("outer", label="Switch/Case", element_type="switch-case")
        node["data"]["config"]["values"] = {
            "branches": [
                {"id": "branch_0", "type": "case", "label": "", "conditions": _ALWAYS_TRUE}
            ]
        }
        return node, "branch_0", "then"
    if container == "try-body":
        node = _make_node("outer", label="Try/Catch", element_type="try-catch-finally")
        node["data"]["config"]["values"] = {"enable_catch": True, "enable_finally": False}
        node["data"]["config"]["outputBindings"] = {"error": "tc_error", "caught": "tc_caught"}
        return node, "try", "then"
    if container == "parallel-lane":
        node = _make_node("outer", label="Parallel", element_type="parallel")
        node["data"]["config"]["values"] = {
            "branches": [{"id": "branch_1", "name": "lane"}, {"id": "branch_2", "name": "idle"}]
        }
        node["data"]["config"]["outputBindings"] = {}
        return node, "branch_1", "then"
    if container == "wait-until-lane":
        node = _make_node("outer", label="Wait Until", element_type="wait-until")
        node["data"]["config"]["values"] = {
            "conditions": [{"id": "c-index", "type": "expression", "expression": "i == 0"}],
            "timeout": 500,
            "check_interval": 1,
            "mode": "retry",
        }
        node["data"]["config"]["outputBindings"] = {"passed": "ok", "elapsed": "waited"}
        return node, "retry", "then"
    return _function_holding_the_loop(), "", None


def _function_holding_the_loop() -> dict[str, Any]:
    """A Local Function whose body is the For Each; its outputs carry the item and index out."""
    definition = {
        "name": "zero_runs",
        "description": "",
        "tags": [],
        "inputs": [{"name": "items", "type": "array"}],
        "outputs": [
            {"name": "current_item", "type": "string", "default": "before"},
            {"name": "i", "type": "integer", "default": None},
        ],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": [_make_for_each_node("fe-inner", collection="items")],
            "edges": [{"source": "start-node", "target": "fe-inner"}],
        },
    }
    return {
        "id": "outer",
        "type": "workflowNode",
        "data": {
            "label": "outer",
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": definition,
            "config": {
                "values": {"items": "items"},
                "profileBindings": [],
                "outputBindings": {"current_item": "current_item", "i": "i"},
            },
            "expressionFields": ["items"],
            "templateFields": [],
            "displayName": "outer",
        },
    }


def _graph_with_the_loop_inside(
    container: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    outer, lane, exit_handle = _container(container)
    nodes = [outer, _make_log_node("after-log", "After Log", "'done'")]
    edges: list[dict[str, Any]] = [{"source": "start-node", "target": "outer"}]
    if container != "function-body":
        nodes.append(_make_for_each_node("fe-inner", collection="items"))
        edges.append({"source": "outer", "target": "fe-inner", "sourceHandle": lane})
    exit_edge: dict[str, Any] = {"source": "outer", "target": "after-log"}
    if exit_handle is not None:
        exit_edge["sourceHandle"] = exit_handle
    edges.append(exit_edge)
    return nodes, edges


CONTAINERS = [
    "for-body",
    "while-body",
    "switch-case",
    "try-body",
    "parallel-lane",
    "function-body",
    "wait-until-lane",
]


class TestForEachZeroRunsInsideAContainer:
    """A For Each that runs zero times inside a container leaves its item untouched and still
    writes index 0 (REQ-3.5.1.16, REQ-3.1.3.25)."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
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

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "collection", [pytest.param([], id="empty-list"), pytest.param(None, id="null")]
    )
    @pytest.mark.parametrize("container", CONTAINERS)
    async def test_the_item_keeps_its_value(
        self, container: str, collection: list[Any] | None
    ) -> None:
        session_id = f"fe-zero-{container}-{'null' if collection is None else 'empty'}"
        _wb_common._workbench_sessions[session_id] = _make_run_session(session_id)
        variables: dict[str, Any] = {"items": collection, "current_item": "before", "i": None}
        nodes, edges = _graph_with_the_loop_inside(container)

        await asyncio.wait_for(
            workbench_service._execute_workflow(session_id, nodes, edges, variables),
            timeout=10.0,
        )

        session = _wb_common._workbench_sessions[session_id]
        assert (
            session["status"],
            session["block_states"].get("after-log"),
            variables["i"],
            variables["current_item"],
        ) == ("passed", "passed", 0, "before")
