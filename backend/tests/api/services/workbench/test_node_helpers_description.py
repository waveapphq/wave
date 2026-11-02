"""How the workbench names a block from its canvas node.

Covers:
- `_extract_node_fields` names a block by its Name; the Description names nothing.
- _execute_node forwards the block's Name to control/plugin executors as `block_label`;
  the Description is not forwarded (EXEC-25).
"""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    log_messages,
    log_node,
    run_graph,
    try_catch_node,
)
from wavecore.api.services.workbench import execution as execution_module
from wavecore.api.services.workbench.node_helpers import (
    _enqueue_children,
    _execute_node,
    _extract_node_fields,
)

LONG_DESCRIPTION = "Loads the seed rows before the checks run"
DIVISION_ERROR = "Expression evaluation failed for '1/0': division by zero"


def _make_node(
    *,
    label: str = "Probe Gateway",
    description: str | None = None,
    element_type: str = "http-client",
    node_type: str = "plugin",
    version: str = "1.0.0",
    config_values: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
    variable_expression_keys: list[str] | None = None,
    variable_types: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a workflowNode dict shaped like the production payload (post-rename)."""
    data: dict[str, Any] = {
        "label": label,
        "elementType": element_type,
        "nodeType": node_type,
        "version": version,
        "config": {
            "values": config_values or {},
            "outputBindings": output_bindings or {},
        },
        "expressionFields": expression_fields or [],
        "templateFields": template_fields or [],
        "variableExpressionKeys": variable_expression_keys or [],
        "variableTypes": variable_types or {},
    }
    if description is not None:
        data["description"] = description
    return {
        "id": "node-1",
        "type": "workflowNode",
        "data": data,
    }


class TestExtractNodeFieldsName:
    """`_extract_node_fields` names a block by its Name alone."""

    def test_block_name_is_the_name_when_a_description_is_set(self) -> None:
        node = _make_node(label="HTTP Probe", description="Probe gateway")
        fields = _extract_node_fields(node)
        assert fields["block_name"] == "HTTP Probe"

    def test_block_name_is_the_name_when_no_description_is_set(self) -> None:
        node = _make_node(label="HTTP Probe", description=None)
        fields = _extract_node_fields(node)
        assert fields["block_name"] == "HTTP Probe"

    def test_block_name_is_the_name_when_the_description_is_empty(self) -> None:
        node = _make_node(label="HTTP Probe", description="")
        fields = _extract_node_fields(node)
        assert fields["block_name"] == "HTTP Probe"

    def test_a_block_with_no_stored_name_is_called_unknown(self) -> None:
        node = _make_node(description="Probe gateway")
        del node["data"]["label"]
        fields = _extract_node_fields(node)
        assert fields["block_name"] == "Unknown"

    def test_the_description_is_not_among_the_fields(self) -> None:
        node = _make_node(description="Probe gateway")
        fields = _extract_node_fields(node)
        assert "description" not in fields
        assert "display_name" not in fields
        assert "Probe gateway" not in [value for value in fields.values() if isinstance(value, str)]

    def test_the_name_is_carried_once(self) -> None:
        node = _make_node(label="HTTP Probe", description="Probe gateway")
        fields = _extract_node_fields(node)
        assert "block_label" not in fields

    def test_node_data_does_not_carry_display_name(self) -> None:
        """The pass-through `node_data` dict mirrors the input - no synthesized display_name."""
        node = _make_node(description="Probe gateway")
        fields = _extract_node_fields(node)
        assert "displayName" not in fields["node_data"]
        assert "display_name" not in fields["node_data"]


def _described_failing_block() -> dict[str, Any]:
    """A block named ``Load seed rows`` that carries a Description and fails."""
    node = log_node("load", "Load seed rows", "1/0")
    node["data"]["description"] = LONG_DESCRIPTION
    return node


@pytest.mark.usefixtures("engine_registries")
class TestTheEngineCallsABlockByItsName:
    """Every line and event the engine writes about a block carries its Name."""

    async def test_the_failure_line_names_the_block(self) -> None:
        session_id = "engine-name-failure-line"
        await run_graph(session_id, [_described_failing_block()], [edge("start-node", "load")], {})

        lines = [m for m in log_messages(session_id) if m.startswith("Block '")]
        assert lines == [f"Block 'Load seed rows' failed: {DIVISION_ERROR}"], lines

    async def test_the_description_is_in_no_line(self) -> None:
        session_id = "engine-name-no-description"
        await run_graph(session_id, [_described_failing_block()], [edge("start-node", "load")], {})

        messages = log_messages(session_id)
        assert "Executing 'Load seed rows' (plugin/log)" in messages, messages
        assert [m for m in messages if LONG_DESCRIPTION in m] == []

    async def test_the_status_events_name_the_block(self, monkeypatch: pytest.MonkeyPatch) -> None:
        session_id = "engine-name-status-events"
        names: list[str] = []

        async def record(_broadcast_id: str, event: dict[str, Any]) -> None:
            if event.get("type") == "block_status_changed" and event.get("block_id") == "load":
                names.append(str(event["block_name"]))

        monkeypatch.setattr(execution_module, "_broadcast_event", record)
        await run_graph(session_id, [_described_failing_block()], [edge("start-node", "load")], {})

        assert names and set(names) == {"Load seed rows"}, names

    async def test_a_caught_error_names_the_block(self) -> None:
        session_id = "engine-name-caught-error"
        catcher = try_catch_node("tc-1")
        catcher["data"]["config"]["outputBindings"] = {"error": "tc_error", "caught": "tc_caught"}
        nodes = [
            catcher,
            _described_failing_block(),
            log_node("catch-log", "Catch Log", "'caught'"),
        ]
        edges = [
            edge("start-node", "tc-1"),
            edge("tc-1", "load", "try"),
            edge("tc-1", "catch-log", "catch"),
        ]
        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await run_graph(session_id, nodes, edges, variables)

        assert variables["tc_error"]["node"] == "Load seed rows", variables["tc_error"]


class TestExecuteNodeNameForwarding:
    """_execute_node forwards the Name as block_label=; the Description stays behind."""

    @pytest.mark.asyncio
    async def test_execute_node_forwards_the_name_to_plugin(self) -> None:
        node = _make_node(
            element_type="http-client",
            node_type="plugin",
            label="Probe Gateway",
            description="Probe gateway",
        )
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value={"status": "ok"}),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            mock_plugin.assert_awaited_once()
            kwargs = mock_plugin.call_args.kwargs
            assert kwargs["block_label"] == "Probe Gateway"
            assert "description" not in kwargs
            assert "display_name" not in kwargs

    @pytest.mark.asyncio
    async def test_execute_node_forwards_the_name_to_control(self) -> None:
        node = _make_node(
            element_type="delay",
            node_type="control",
            label="Wait Gateway",
            description="Wait gateway",
        )
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new=AsyncMock(return_value={"status": "ok"}),
        ) as mock_control:
            await _execute_node(fields, {}, "s-1", "node-1")
            mock_control.assert_awaited_once()
            kwargs = mock_control.call_args.kwargs
            assert kwargs["block_label"] == "Wait Gateway"
            assert "description" not in kwargs
            assert "display_name" not in kwargs

    @pytest.mark.asyncio
    async def test_execute_node_passes_none_for_an_absent_name(self) -> None:
        node = _make_node(element_type="http-client", node_type="plugin", description=None)
        del node["data"]["label"]
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value={"status": "ok"}),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            kwargs = mock_plugin.call_args.kwargs
            assert kwargs["block_label"] is None

    @pytest.mark.asyncio
    async def test_execute_node_unknown_node_type_returns_none(self) -> None:
        node = _make_node(node_type="bogus")
        fields = _extract_node_fields(node)
        result = await _execute_node(fields, {}, "s-1", "node-1")
        assert result is None


class TestEnqueueChildren:
    """Pre-existing helper is untouched by the rename; smoke-test included for completeness."""

    def test_enqueue_children_adds_unexecuted_targets(self) -> None:
        adj: dict[str, list[tuple[str, str | None]]] = {
            "n1": [("n2", None), ("n3", None)],
        }
        executed: set[str] = {"n3"}
        queue: list[str] = []
        _enqueue_children("n1", adj, executed, queue)
        assert queue == ["n2"]

    def test_enqueue_children_no_children_is_noop(self) -> None:
        queue: list[str] = []
        _enqueue_children("n1", {}, set(), queue)
        assert queue == []
