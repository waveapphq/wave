"""Tests for per-block secret-field extraction in workbench node_helpers.

Covers REQ-3.1.3.16 / REQ-3.1.3.5:
- _extract_node_fields reads `config.unmasked_secret_fields` into
  `unmasked_secret_fields` - an ordered list of the field keys the user
  REVEALED for this block. The stored default is the empty list (all masked).
- _extract_node_fields reads `config.outputSecretFields` into
  `output_secret_fields` - the outputs the user marked secret on this block.
  An absent stored list is preserved as None (schema-seed fallback); a present
  list, including empty, is the complete per-block truth.
- _execute_node forwards both `unmasked_secret_fields` and
  `output_secret_fields` to the plugin executor, mirroring the existing
  per-node `unmask_secrets` thread. Controls declare no catalog, so only the
  plugin path threads them.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from wavecore.api.services.workbench.node_helpers import (
    _execute_node,
    _extract_node_fields,
)


def _make_plugin_node(
    *,
    unmasked_secret_fields: list[str] | None = None,
    output_secret_fields: list[str] | None = None,
) -> dict[str, Any]:
    """Build an http-client plugin workflowNode carrying an optional reveal set."""
    config: dict[str, Any] = {"values": {}, "outputBindings": {}}
    if unmasked_secret_fields is not None:
        config["unmasked_secret_fields"] = unmasked_secret_fields
    if output_secret_fields is not None:
        config["outputSecretFields"] = output_secret_fields
    return {
        "id": "node-1",
        "type": "workflowNode",
        "data": {
            "label": "HTTP",
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": config,
        },
    }


class TestExtractNodeFieldsUnmaskedSecretFields:
    """`_extract_node_fields` exposes `unmasked_secret_fields` as a list."""

    def test_extract_includes_unmasked_secret_fields(self) -> None:
        node = _make_plugin_node(unmasked_secret_fields=["authorization", "cookie"])
        fields = _extract_node_fields(node)
        assert fields["unmasked_secret_fields"] == ["authorization", "cookie"]

    def test_extract_unmasked_secret_fields_defaults_to_empty_list(self) -> None:
        node = _make_plugin_node(unmasked_secret_fields=None)
        fields = _extract_node_fields(node)
        assert fields["unmasked_secret_fields"] == []


class TestExecuteNodeForwardsUnmaskedSecretFields:
    """_execute_node forwards `unmasked_secret_fields` to the plugin executor."""

    @pytest.mark.asyncio
    async def test_execute_node_forwards_unmasked_secret_fields_to_plugin(self) -> None:
        node = _make_plugin_node(unmasked_secret_fields=["authorization"])
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            mock_plugin.assert_awaited_once()
            kwargs = mock_plugin.call_args.kwargs
            assert kwargs["unmasked_secret_fields"] == ["authorization"]

    @pytest.mark.asyncio
    async def test_execute_node_forwards_empty_unmasked_secret_fields_to_plugin(self) -> None:
        node = _make_plugin_node(unmasked_secret_fields=None)
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            kwargs = mock_plugin.call_args.kwargs
            assert kwargs["unmasked_secret_fields"] == []


class TestExtractNodeFieldsOutputSecretFields:
    """`_extract_node_fields` exposes `output_secret_fields` as a list."""

    def test_extract_includes_output_secret_fields(self) -> None:
        node = _make_plugin_node(output_secret_fields=["body", "headers"])
        fields = _extract_node_fields(node)
        assert fields["output_secret_fields"] == ["body", "headers"]

    def test_extract_output_secret_fields_absent_is_none(self) -> None:
        node = _make_plugin_node(output_secret_fields=None)
        fields = _extract_node_fields(node)
        assert fields["output_secret_fields"] is None

    def test_extract_output_secret_fields_empty_list_is_preserved(self) -> None:
        node = _make_plugin_node(output_secret_fields=[])
        fields = _extract_node_fields(node)
        assert fields["output_secret_fields"] == []


class TestExecuteNodeForwardsOutputSecretFields:
    """_execute_node forwards `output_secret_fields` to the plugin executor."""

    @pytest.mark.asyncio
    async def test_execute_node_forwards_output_secret_fields_to_plugin(self) -> None:
        node = _make_plugin_node(output_secret_fields=["body"])
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            mock_plugin.assert_awaited_once()
            kwargs = mock_plugin.call_args.kwargs
            assert kwargs["output_secret_fields"] == ["body"]

    @pytest.mark.asyncio
    async def test_execute_node_forwards_absent_output_secret_fields_as_none(self) -> None:
        node = _make_plugin_node(output_secret_fields=None)
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            kwargs = mock_plugin.call_args.kwargs
            assert kwargs["output_secret_fields"] is None

    @pytest.mark.asyncio
    async def test_execute_node_forwards_empty_output_secret_fields_to_plugin(self) -> None:
        node = _make_plugin_node(output_secret_fields=[])
        fields = _extract_node_fields(node)
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            kwargs = mock_plugin.call_args.kwargs
            assert kwargs["output_secret_fields"] == []
