"""Tests for per-key variable template-key extraction in workbench node_helpers.

Covers:
- _extract_node_fields reads `variableTemplateKeys` into `variable_template_keys`.
- The default is an empty set when the node carries no template keys.
- _execute_node forwards `variable_template_keys` to the control executor,
  mirroring the existing `variable_expression_keys` thread.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from wavecore.api.services.workbench.node_helpers import (
    _execute_node,
    _extract_node_fields,
)


def _make_node(
    *,
    element_type: str = "variable-setter",
    node_type: str = "control",
    variable_expression_keys: list[str] | None = None,
    variable_template_keys: list[str] | None = None,
) -> dict[str, Any]:
    """Build a control workflowNode dict carrying per-key expression/template flags."""
    data: dict[str, Any] = {
        "label": "Set Vars",
        "elementType": element_type,
        "nodeType": node_type,
        "version": "1.0.0",
        "config": {"values": {"variables": {}}, "outputBindings": {}},
        "expressionFields": [],
        "templateFields": [],
        "variableExpressionKeys": variable_expression_keys or [],
        "variableTypes": {},
    }
    if variable_template_keys is not None:
        data["variableTemplateKeys"] = variable_template_keys
    return {"id": "node-1", "type": "workflowNode", "data": data}


class TestExtractNodeFieldsVariableTemplateKeys:
    """`_extract_node_fields` exposes `variable_template_keys` as a set."""

    def test_extract_includes_variable_template_keys(self) -> None:
        node = _make_node(variable_template_keys=["greeting", "farewell"])
        fields = _extract_node_fields(node)
        assert fields["variable_template_keys"] == {"greeting", "farewell"}

    def test_extract_variable_template_keys_defaults_to_empty_set(self) -> None:
        node = _make_node(variable_template_keys=None)
        fields = _extract_node_fields(node)
        assert fields["variable_template_keys"] == set()

    def test_extract_template_keys_are_disjoint_from_expression_keys(self) -> None:
        """Expression and template key-sets coexist independently on the node."""
        node = _make_node(
            variable_expression_keys=["computed"],
            variable_template_keys=["greeting"],
        )
        fields = _extract_node_fields(node)
        assert fields["variable_expression_keys"] == {"computed"}
        assert fields["variable_template_keys"] == {"greeting"}


class TestExecuteNodeForwardsTemplateKeys:
    """_execute_node forwards variable_template_keys to the control executor."""

    @pytest.mark.asyncio
    async def test_execute_node_forwards_variable_template_keys_to_control(self) -> None:
        node = _make_node(variable_template_keys=["greeting"])
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new=AsyncMock(return_value=None),
        ) as mock_control:
            await _execute_node(fields, {"name": "Bob"}, "s-1", "node-1")
            mock_control.assert_awaited_once()
            kwargs = mock_control.call_args.kwargs
            assert kwargs["setter_rows"].template_keys == {"greeting"}

    @pytest.mark.asyncio
    async def test_execute_node_forwards_empty_template_keys_to_control(self) -> None:
        node = _make_node(variable_template_keys=None)
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new=AsyncMock(return_value=None),
        ) as mock_control:
            await _execute_node(fields, {}, "s-1", "node-1")
            kwargs = mock_control.call_args.kwargs
            assert kwargs["setter_rows"].template_keys == set()
