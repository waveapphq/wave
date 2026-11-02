"""Block dispatch establishes the render-time secret scope (REQ-3.1.3.5).

Every block runs inside `_execute_node`, so that is where the run's secret
registry becomes the one a Table renders against. A table a block logs is
therefore masked while it is laid out, not after.
"""

from collections.abc import Generator
from typing import Any
from unittest.mock import patch

import pytest

import wavecore.api.services.workbench._common as wb_common
from wavecore.api.services.workbench.node_helpers import (
    _execute_node,
    _extract_node_fields,
)
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.secrets.render_scope import active_scan_values
from wavecore.core.table import Table

_SECRET = "s3cr3t-" + "v" * 20


@pytest.fixture(autouse=True)
def _isolate_sessions() -> Generator[None, None, None]:
    wb_common._workbench_sessions.clear()
    yield
    wb_common._workbench_sessions.clear()


def _plugin_node(node_id: str = "node-1") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Log",
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {}, "outputBindings": {}},
        },
    }


def _token_table() -> Table:
    table = Table(columns=["Name", "Token"])
    table.add_row(["payments-api", _SECRET])
    return table


async def _run(session_id: str, node_id: str, sink: list[str]) -> None:
    async def _render(*args: Any, **kwargs: Any) -> None:
        sink.append(str(_token_table()))

    fields = _extract_node_fields(_plugin_node(node_id))
    with patch("wavecore.api.services.workbench.plugins._execute_plugin", new=_render):
        await _execute_node(fields, {}, session_id, node_id)


class TestRenderScopeWiring:
    """A table rendered inside a block sees the run's registry."""

    @pytest.mark.asyncio
    async def test_table_rendered_by_a_block_is_masked(self) -> None:
        registry = SecretRegistry()
        registry.register("token", _SECRET, "declared")
        wb_common._workbench_sessions["s-1"] = {"secret_registry": registry}
        sink: list[str] = []

        await _run("s-1", "node-1", sink)

        assert "********" in sink[0]
        assert "s3cr3t" not in sink[0]

    @pytest.mark.asyncio
    async def test_scope_is_released_when_the_block_finishes(self) -> None:
        registry = SecretRegistry()
        registry.register("token", _SECRET, "declared")
        wb_common._workbench_sessions["s-1"] = {"secret_registry": registry}

        await _run("s-1", "node-1", [])

        assert active_scan_values() == ()

    @pytest.mark.asyncio
    async def test_scope_carries_the_block_id_for_per_field_reveal(self) -> None:
        registry = SecretRegistry()
        registry.register_value(_SECRET, "reveal", exempt_block="node-1")
        wb_common._workbench_sessions["s-1"] = {"secret_registry": registry}
        own: list[str] = []
        other: list[str] = []

        await _run("s-1", "node-1", own)
        await _run("s-1", "node-2", other)

        assert _SECRET in own[0]
        assert "s3cr3t" not in other[0]

    @pytest.mark.asyncio
    async def test_session_without_a_registry_renders_raw(self) -> None:
        wb_common._workbench_sessions["s-1"] = {}
        sink: list[str] = []

        await _run("s-1", "node-1", sink)

        assert _SECRET in sink[0]
