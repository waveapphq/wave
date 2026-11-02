"""
Tests for WebSocket variable push with throttling.

Requirements tested:
- REQ-3.1.3.12: Auto-refresh watched variables on change
- REQ-3.2.2.18: Live variable values display

These tests verify the WebSocket push mechanism for variable changes,
including throttling to prevent flooding during rapid updates.
"""

import asyncio
import contextlib
import json
import re
import uuid
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    make_node,
)
from tests.api.services.workbench.test_variable_push_on_write import (
    _definition,
    _instance,
    _push_recorder,
    _pushes_of,
    _run,
    _scopes_of,
    _stored,
)

# =============================================================================
# REQ-3.1.3.12: WebSocket Push for Variable Changes
# =============================================================================


class TestVariablePushBasics:
    """Test basic variable push functionality (REQ-3.1.3.12)."""

    async def test_variable_change_triggers_websocket_push(self) -> None:
        """Verify variable change triggers WebSocket push to subscribed clients.

        When the execution engine emits a variable_changed event, the WS server
        should push the change to all clients subscribed to that variable's watch.
        """
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        # Create a mock WebSocket connection
        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)

        # Subscribe to variable watch
        manager.subscribe(conn_id, "variable:watch_123")

        # Emit variable change event
        event = {
            "type": "variable_changed",
            "path": "my_var",
            "value": "new_value",
            "var_type": "string",
            "scope": "test",
            "watch_id": "watch_123",
        }
        await push_service.push_variable_change(event)

        # Verify push was sent to the client in envelope format
        mock_ws.send_json.assert_called()
        envelope = mock_ws.send_json.call_args[0][0]
        assert envelope["type"] == "event"
        assert envelope["topic"] == "variable:watch_123"
        assert "timestamp" in envelope
        payload = envelope["payload"]
        assert payload["type"] == "variable_changed"
        assert payload["path"] == "my_var"
        assert payload["value"] == "new_value"


class TestVariablePushThrottling:
    """Test variable push throttling (REQ-3.1.3.12)."""

    async def test_rapid_changes_throttled_to_one_per_200ms(self) -> None:
        """Verify rapid changes result in max 1 push per 200ms window.

        When a variable changes rapidly (e.g., 10 times in 50ms), only one
        push should be sent within each 200ms throttle window.
        """
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager, throttle_ms=200)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Rapidly change the variable 10 times within 50ms
        for i in range(10):
            event = {
                "type": "variable_changed",
                "path": "counter",
                "value": i,
                "var_type": "integer",
                "scope": "test",
                "watch_id": "watch_123",
            }
            await push_service.push_variable_change(event)
            await asyncio.sleep(0.005)  # 5ms between changes

        # Wait for throttle window to complete
        await asyncio.sleep(0.25)

        # Should have at most 2 pushes (one within first 200ms window)
        push_count = mock_ws.send_json.call_count
        assert push_count <= 2, f"Expected at most 2 pushes, got {push_count}"

    async def test_last_value_wins_in_throttle_window(self) -> None:
        """Verify the last value within throttle window is pushed (not first).

        When multiple changes occur within a 200ms window, the pushed value
        should be the most recent one, not the first.
        """
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager, throttle_ms=200)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Change variable multiple times rapidly
        for value in ["first", "second", "third", "last"]:
            event = {
                "type": "variable_changed",
                "path": "my_var",
                "value": value,
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
            await push_service.push_variable_change(event)
            await asyncio.sleep(0.01)  # 10ms between changes

        # Wait for throttle to flush
        await asyncio.sleep(0.25)

        # The last pushed value should be "last"
        last_call = mock_ws.send_json.call_args_list[-1]
        envelope = last_call[0][0]
        assert envelope["payload"]["value"] == "last"

    async def test_different_variables_throttled_independently(self) -> None:
        """Verify different variables have independent throttle windows.

        Rapid changes to variable A should not delay pushes for variable B.
        Each variable maintains its own throttle state.
        """
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager, throttle_ms=200)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Rapidly change variable A
        for i in range(5):
            await push_service.push_variable_change(
                {
                    "type": "variable_changed",
                    "path": "var_a",
                    "value": f"a_{i}",
                    "var_type": "string",
                    "scope": "test",
                    "watch_id": "watch_123",
                }
            )

        # Change variable B (should push immediately, not throttled by A)
        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "var_b",
                "value": "b_value",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        # B should be pushed without waiting for A's throttle
        await asyncio.sleep(0.05)

        # Check that var_b was pushed
        envelopes = [call[0][0] for call in mock_ws.send_json.call_args_list]
        var_b_messages = [e for e in envelopes if e.get("payload", {}).get("path") == "var_b"]
        assert len(var_b_messages) >= 1


class TestVariablePushContentByType:
    """Test push content varies by variable type (REQ-3.1.3.12)."""

    async def test_scalar_string_pushes_full_value(self) -> None:
        """Verify string scalars push full value."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "str_var",
                "value": "hello world",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert sent["value"] == "hello world"

    async def test_scalar_integer_pushes_full_value(self) -> None:
        """Verify integer scalars push full value."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "int_var",
                "value": 42,
                "var_type": "integer",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert sent["value"] == 42

    async def test_scalar_float_pushes_full_value(self) -> None:
        """Verify float scalars push full value."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "float_var",
                "value": 3.14159,
                "var_type": "float",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert sent["value"] == 3.14159

    async def test_scalar_decimal_float_pushes_plain_string(self) -> None:
        """An exact-precision Decimal float pushes as a plain decimal string
        (REQ-3.1.3.14): a raw Decimal is not JSON-serializable, so the
        push would silently drop and the watcher would never see the change."""
        from decimal import Decimal

        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "rate",
                "value": Decimal("21.5892"),
                "var_type": "float",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert sent["value"] == "21.5892"
        assert type(sent["value"]) is str

    async def test_scalar_boolean_pushes_full_value(self) -> None:
        """Verify boolean scalars push full value."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "bool_var",
                "value": True,
                "var_type": "boolean",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert sent["value"] is True

    async def test_array_pushes_summary_not_full_value(self) -> None:
        """Verify arrays push summary (count) instead of full value.

        For large arrays, pushing full content would be inefficient.
        Push summary with count and changed flag; FE fetches on expand.
        """
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "array_var",
                "value": [1, 2, 3, 4, 5],
                "var_type": "array",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        # Should be summary, not full array
        assert isinstance(sent["value"], dict)
        assert sent["value"]["count"] == 5
        assert sent["value"]["changed"] is True

    async def test_map_pushes_summary_not_full_value(self) -> None:
        """Verify maps push summary (count) instead of full value.

        For large maps, pushing full content would be inefficient.
        Push summary with key count and changed flag.
        """
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "map_var",
                "value": {"a": 1, "b": 2, "c": 3},
                "var_type": "map",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        # Should be summary, not full map
        assert isinstance(sent["value"], dict)
        assert sent["value"]["count"] == 3
        assert sent["value"]["changed"] is True

    async def test_table_pushes_dimensions_summary(self) -> None:
        """Verify tables push dimensions summary (rows x cols).

        Tables push summary with row/column counts and changed flag.
        """
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Table is represented as list of lists
        table_value = [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
            [10, 11, 12],
        ]

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "table_var",
                "value": table_value,
                "var_type": "table",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        # Should be dimensions summary
        assert isinstance(sent["value"], dict)
        assert sent["value"]["rows"] == 4
        assert sent["value"]["cols"] == 3
        assert sent["value"]["changed"] is True

    async def test_table_instance_pushes_dimensions(self) -> None:
        """Verify Table class instance pushes dimensions (lines 77-78)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager
        from wavecore.core.table import Table

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Table instance
        table = Table.from_list(
            [
                {"a": 1, "b": 2, "c": 3},
                {"a": 4, "b": 5, "c": 6},
            ]
        )

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "table_var",
                "value": table,
                "var_type": "table",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert isinstance(sent["value"], dict)
        assert sent["value"]["rows"] == 2
        assert sent["value"]["cols"] == 3
        assert sent["value"]["changed"] is True

    async def test_table_list_of_dicts_pushes_dimensions(self) -> None:
        """Verify table as list of dicts pushes correct dimensions (line 85)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Table as list of dicts
        table_value = [
            {"name": "Alice", "age": 30, "city": "NYC"},
            {"name": "Bob", "age": 25, "city": "LA"},
        ]

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "table_var",
                "value": table_value,
                "var_type": "table",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert isinstance(sent["value"], dict)
        assert sent["value"]["rows"] == 2
        assert sent["value"]["cols"] == 3
        assert sent["value"]["changed"] is True

    async def test_table_invalid_first_row_type_returns_zero_cols(self) -> None:
        """Verify table with non-list/non-dict first row returns 0 cols (lines 89-90)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Table with invalid first row type (string instead of list/dict)
        table_value = ["invalid_row"]

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "table_var",
                "value": table_value,
                "var_type": "table",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert isinstance(sent["value"], dict)
        assert sent["value"]["rows"] == 1
        assert sent["value"]["cols"] == 0

    async def test_table_empty_list_returns_zero_dimensions(self) -> None:
        """Verify empty table list returns 0 rows and 0 cols (lines 90-91)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Empty table
        table_value: list[list[Any]] = []

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "table_var",
                "value": table_value,
                "var_type": "table",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert isinstance(sent["value"], dict)
        assert sent["value"]["rows"] == 0
        assert sent["value"]["cols"] == 0

    async def test_table_non_list_value_returns_zero_dimensions(self) -> None:
        """Verify non-list table value returns 0 dimensions (lines 92-94)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Table value that's neither Table nor list (invalid type)
        table_value = "not_a_table"

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "table_var",
                "value": table_value,
                "var_type": "table",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert isinstance(sent["value"], dict)
        assert sent["value"]["rows"] == 0
        assert sent["value"]["cols"] == 0


class TestVariablePushWatchRegistry:
    """Test watch registry integration with push (REQ-3.1.3.12)."""

    async def test_push_only_to_clients_watching_variable(self) -> None:
        """Verify push only goes to clients that registered a watch for the variable."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        # Client A watches variable X
        mock_ws_a = AsyncMock()
        mock_ws_a.accept = AsyncMock()
        conn_a = await manager.connect(mock_ws_a)
        manager.subscribe(conn_a, "variable:watch_x")

        # Client B watches variable Y (different)
        mock_ws_b = AsyncMock()
        mock_ws_b.accept = AsyncMock()
        conn_b = await manager.connect(mock_ws_b)
        manager.subscribe(conn_b, "variable:watch_y")

        # Push change for variable X
        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "var_x",
                "value": "x_value",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_x",
            }
        )

        await asyncio.sleep(0.05)

        # Only client A should receive the push
        assert mock_ws_a.send_json.call_count >= 1
        assert mock_ws_b.send_json.call_count == 0


class TestVariablePushEdgeCases:
    """Test edge cases for variable push (REQ-3.1.3.12)."""

    async def test_push_after_client_disconnects_does_not_fail(self) -> None:
        """Verify push after client disconnect is handled gracefully."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Disconnect the client
        manager.disconnect(conn_id)

        # Push should not raise an error
        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "var",
                "value": "value",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        # No assertion needed - just verify no exception

    async def test_push_with_no_subscribers_does_not_fail(self) -> None:
        """Verify push with no subscribers is handled gracefully."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        # Push with no connected clients
        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "orphan_var",
                "value": "value",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_nobody",
            }
        )

        # No assertion needed - just verify no exception

    async def test_empty_string_value_pushes_correctly(self) -> None:
        """Verify empty string value is pushed correctly (not treated as falsy)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "empty_str",
                "value": "",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert sent["value"] == ""

    async def test_null_value_pushes_correctly(self) -> None:
        """Verify null value is pushed correctly."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "null_var",
                "value": None,
                "var_type": "null",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert sent["value"] is None

    async def test_zero_value_pushes_correctly(self) -> None:
        """Verify zero value is pushed correctly (not treated as falsy)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "zero_var",
                "value": 0,
                "var_type": "integer",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        await asyncio.sleep(0.05)

        sent = mock_ws.send_json.call_args[0][0]["payload"]
        assert sent["value"] == 0

    async def test_flush_when_state_cleared_does_not_fail(self) -> None:
        """Verify delayed flush handles state being cleared during delay (line 161)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager, throttle_ms=100)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Push first event (immediate, sets up throttle window)
        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "my_var",
                "value": "first",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        # Push second event (will be throttled, flush task created)
        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "my_var",
                "value": "second",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        # Clear the throttle state before flush executes
        push_service._throttle_state.clear()

        # Wait for the flush delay to complete
        await asyncio.sleep(0.15)

        # Should not raise - just silently return
        # First call was for "first", no more calls should happen
        assert mock_ws.send_json.call_count == 1

    async def test_flush_when_pending_cleared_does_not_push(self) -> None:
        """Verify delayed flush handles pending event being cleared (line 165)."""
        from wavecore.api.services.variable_push import VariablePushService
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        push_service = VariablePushService(manager, throttle_ms=100)

        mock_ws = AsyncMock()
        mock_ws.accept = AsyncMock()
        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "variable:watch_123")

        # Push first event (immediate)
        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "my_var",
                "value": "first",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        # Push second event (throttled, creates flush task)
        await push_service.push_variable_change(
            {
                "type": "variable_changed",
                "path": "my_var",
                "value": "second",
                "var_type": "string",
                "scope": "test",
                "watch_id": "watch_123",
            }
        )

        # Clear the pending event but keep the state entry
        var_key = push_service._get_variable_key(
            {"path": "my_var", "scope": "test", "watch_id": "watch_123"}
        )
        last_push, _, flush_task = push_service._throttle_state[var_key]
        push_service._throttle_state[var_key] = (last_push, None, flush_task)

        # Wait for the flush delay to complete
        await asyncio.sleep(0.15)

        # Should not push the second event (pending was cleared)
        # Only the first push should have been sent
        assert mock_ws.send_json.call_count == 1


def _push_session(session_id: str, *, registry: Any = None) -> dict[str, Any]:
    """Minimal workbench session entry the push path reads for masking."""
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": "running",
        "test_id": "test-1",
        "block_states": {},
    }
    if registry is not None:
        session["secret_registry"] = registry
        session["secret_variable_names"] = ["token"]
    return session


def _token_registry() -> Any:
    from wavecore.core.secrets.registry import SecretRegistry

    registry = SecretRegistry()
    registry.register("token", "s3cr3t-t0ken-99", "declared")
    return registry


async def _capture_push(session: dict[str, Any], push: Any) -> dict[str, Any]:
    """Install a real push service + fake socket, run ``push``, return payload."""
    import asyncio as _asyncio

    from wavecore.api.app import app
    from wavecore.api.services.variable_push import VariablePushService
    from wavecore.api.services.workbench import _common as _wb_common
    from wavecore.api.websocket import WebSocketManager

    manager = WebSocketManager()
    push_service = VariablePushService(manager)
    mock_ws = AsyncMock()
    mock_ws.accept = AsyncMock()
    conn_id = await manager.connect(mock_ws)
    session_id = session["session_id"]
    manager.subscribe(conn_id, f"variable:{session_id}")

    _wb_common._workbench_sessions[session_id] = session
    had_service = hasattr(app.state, "variable_push_service")
    old_service = getattr(app.state, "variable_push_service", None)
    app.state.variable_push_service = push_service
    try:
        await push(_wb_common, session_id)
        await _asyncio.sleep(0.05)
    finally:
        if had_service:
            app.state.variable_push_service = old_service
        else:
            del app.state.variable_push_service
        _wb_common._workbench_sessions.pop(session_id, None)

    mock_ws.send_json.assert_called()
    payload: dict[str, Any] = mock_ws.send_json.call_args[0][0]["payload"]
    return payload


class TestVariablePushSecretMasking:
    """variable_changed payloads mask (flag structural; value-scrub copies)."""

    async def test_flagged_string_variable_pushes_masked_value(self) -> None:
        import uuid

        session = _push_session(str(uuid.uuid4()), registry=_token_registry())

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(
                sid, "token", "s3cr3t-t0ken-99"
            ),
        )

        assert payload["path"] == "token"
        assert payload["value"] == "********"
        assert payload["var_type"] == "string"

    async def test_flagged_map_variable_pushes_opaque_count(self) -> None:
        import uuid

        session = _push_session(str(uuid.uuid4()), registry=_token_registry())

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(
                sid, "token", {"user": "u", "pass": "p"}
            ),
        )

        # Full opacity: no true measurement of a flagged map may leak
        assert payload["value"] == {"count": 0, "rows": 0, "cols": 0, "changed": True}

    async def test_verbatim_copy_in_string_is_scrubbed(self) -> None:
        import uuid

        session = _push_session(str(uuid.uuid4()), registry=_token_registry())

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(
                sid, "copied", "Bearer s3cr3t-t0ken-99"
            ),
        )

        assert payload["value"] == "Bearer ********"

    async def test_non_string_scalar_equal_to_registered_value_is_masked(self) -> None:
        import uuid

        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("account", 12345678, "declared")
        session = _push_session(str(uuid.uuid4()), registry=registry)

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(sid, "copied_number", 12345678),
        )

        assert payload["value"] == "********"

    async def test_plain_variable_pushes_raw_value(self) -> None:
        import uuid

        session = _push_session(str(uuid.uuid4()), registry=_token_registry())

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(sid, "plain", "visible value"),
        )

        assert payload["value"] == "visible value"

    async def test_payload_shape_carries_no_masking_internals(self) -> None:
        import uuid

        session = _push_session(str(uuid.uuid4()), registry=_token_registry())

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(
                sid, "token", "s3cr3t-t0ken-99"
            ),
        )

        assert set(payload.keys()) == {
            "type",
            "path",
            "value",
            "var_type",
            "scope",
            "function_path",
        }

    async def test_push_variable_changes_diff_masks_flagged_values(self) -> None:
        import uuid

        session = _push_session(str(uuid.uuid4()), registry=_token_registry())

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_variable_changes(
                sid, {}, {"token": "s3cr3t-t0ken-99"}
            ),
        )

        assert payload["path"] == "token"
        assert payload["value"] == "********"

    async def test_session_without_registry_pushes_raw(self) -> None:
        import uuid

        session = _push_session(str(uuid.uuid4()))

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(
                sid, "token", "s3cr3t-t0ken-99"
            ),
        )

        assert payload["value"] == "s3cr3t-t0ken-99"


class TestVariablePushDerivedType:
    """The pushed envelope is derived from the value, not handed in (REQ-3.2.2.18)."""

    async def test_records_list_pushes_a_readable_item_count(self) -> None:
        """A list of records keeps its item count for a variable declared array."""
        import uuid

        events = [
            {"reason": "Pulled", "count": 1, "object": "pod/a"},
            {"reason": "Created", "count": 1, "object": "pod/a"},
            {"reason": "Started", "count": 1, "object": "pod/a"},
            {"reason": "Killing", "count": 2, "object": "pod/a"},
        ]
        session = _push_session(str(uuid.uuid4()))

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(sid, "events", events),
        )

        assert payload["var_type"] == "array"
        assert payload["value"]["count"] == 4

    async def test_table_instance_reaches_the_wire(self) -> None:
        """A Table pushes a serializable dimensions summary instead of being dropped."""
        import uuid

        from wavecore.core.table import Table

        table = Table.from_list([{"a": 1, "b": 2, "c": 3}, {"a": 4, "b": 5, "c": 6}])
        session = _push_session(str(uuid.uuid4()))

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(sid, "grid", table),
        )

        assert payload["var_type"] == "table"
        assert payload["value"]["rows"] == 2
        assert payload["value"]["cols"] == 3
        json.dumps(payload)

    async def test_stored_table_rows_keep_their_dimensions(self) -> None:
        """A table stored as row maps still pushes dimensions for a declared table."""
        import uuid

        rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
        session = _push_session(str(uuid.uuid4()))

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(sid, "grid", rows),
        )

        assert payload["value"]["rows"] == 2
        assert payload["value"]["cols"] == 2
        assert payload["value"]["count"] == 2

    async def test_stored_table_dict_keeps_its_dimensions(self) -> None:
        """A table stored as {columns, rows} pushes dimensions, not just a key count."""
        import uuid

        stored = {
            "columns": [{"name": "a", "type": "integer"}, {"name": "b", "type": "integer"}],
            "rows": [[1, 2], [3, 4], [5, 6]],
        }
        session = _push_session(str(uuid.uuid4()))

        payload = await _capture_push(
            session,
            lambda common, sid: common._push_single_variable_change(sid, "grid", stored),
        )

        assert payload["value"]["rows"] == 3
        assert payload["value"]["cols"] == 2


# =============================================================================
# REQ-3.1.3.12 / REQ-3.2.1.6: every pushed value names its scope
# =============================================================================

_EVENT_KEYS = {
    "type",
    "path",
    "value",
    "var_type",
    "scope",
    "function_path",
    "watch_id",
    "timestamp",
}
_UTC_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


@contextlib.contextmanager
def _registered(session: dict[str, Any]) -> Iterator[str]:
    """Hold ``session`` in the workbench session store for the block."""
    from wavecore.api.services.workbench import _common as _wb_common

    session_id = str(session["session_id"])
    _wb_common._workbench_sessions[session_id] = session
    try:
        yield session_id
    finally:
        _wb_common._workbench_sessions.pop(session_id, None)


def _event(session_id: str, name: str, value: Any, path: tuple[str, ...]) -> dict[str, Any]:
    from wavecore.api.services.workbench import _common as _wb_common

    event: dict[str, Any] = _wb_common.variable_changed_event(session_id, name, value, path)
    return event


def _on_the_wire(payload: dict[str, Any]) -> dict[str, Any]:
    """The payload as the browser parses it."""
    parsed: dict[str, Any] = json.loads(json.dumps(payload))
    return parsed


async def _socket_payloads(
    events: list[dict[str, Any]],
    session_id: str,
    *,
    throttle_ms: int = 200,
    settle: float = 0.0,
) -> list[dict[str, Any]]:
    """Push ``events`` through a real push service; the payloads one subscriber received
    within ``settle`` seconds."""
    from wavecore.api.services.variable_push import VariablePushService
    from wavecore.api.websocket import WebSocketManager

    manager = WebSocketManager()
    push_service = VariablePushService(manager, throttle_ms=throttle_ms)
    mock_ws = AsyncMock()
    mock_ws.accept = AsyncMock()
    conn_id = await manager.connect(mock_ws)
    manager.subscribe(conn_id, f"variable:{session_id}")
    for event in events:
        await push_service.push_variable_change(event)
    await asyncio.sleep(settle)
    return [_on_the_wire(call.args[0]["payload"]) for call in mock_ws.send_json.call_args_list]


class TestVariableChangedEvent:
    """One event builder for every ``variable_changed`` push (REQ-3.1.3.12, REQ-3.2.1.6)."""

    def test_a_test_scope_value_names_the_test_scope_and_an_empty_path(self) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            event = _event(session_id, "count", 5, ())

        assert set(event) == _EVENT_KEYS
        assert event["type"] == "variable_changed"
        assert event["path"] == "count"
        assert event["value"] == 5
        assert event["var_type"] == "integer"
        assert event["scope"] == "test"
        assert _on_the_wire(event)["function_path"] == []
        assert event["watch_id"] == session_id
        assert _UTC_STAMP.match(event["timestamp"])

    def test_a_function_scope_value_names_its_instance_path(self) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            event = _event(session_id, "count", 5, ("fn-1",))

        assert set(event) == _EVENT_KEYS
        assert event["path"] == "count"
        assert event["scope"] == "function"
        assert _on_the_wire(event)["function_path"] == ["fn-1"]

    def test_a_nested_instance_keeps_every_node_id_from_the_root_canvas_inward(self) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            event = _event(session_id, "deep", "x", ("outer", "inner"))

        assert event["scope"] == "function"
        assert _on_the_wire(event)["function_path"] == ["outer", "inner"]

    def test_a_null_value_is_pushed_as_null(self) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            event = _event(session_id, "count", None, ("fn-1",))

        assert event["value"] is None
        assert event["var_type"] == "null"

    @pytest.mark.parametrize(
        ("path", "scope", "on_the_wire"),
        [((), "test", []), (("fn-1",), "function", ["fn-1"])],
    )
    def test_a_session_no_longer_held_still_gets_the_whole_event(
        self, path: tuple[str, ...], scope: str, on_the_wire: list[str]
    ) -> None:
        event = _event("session-gone", "count", 5, path)

        assert set(event) == _EVENT_KEYS
        assert event["watch_id"] == "session-gone"
        assert event["scope"] == scope
        assert _on_the_wire(event)["function_path"] == on_the_wire


class TestPushMessageCarriesTheScope:
    """The browser learns which scope a live value belongs to (REQ-3.1.3.12)."""

    async def test_the_message_forwards_the_function_path(self) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            payloads = await _socket_payloads(
                [_event(session_id, "count", 5, ("outer", "inner"))], session_id
            )

        assert len(payloads) == 1
        assert payloads[0]["path"] == "count"
        assert payloads[0]["value"] == 5
        assert payloads[0]["scope"] == "function"
        assert payloads[0]["function_path"] == ["outer", "inner"]

    async def test_a_test_scope_message_carries_an_empty_path(self) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            payloads = await _socket_payloads([_event(session_id, "count", 5, ())], session_id)

        assert payloads[0]["scope"] == "test"
        assert payloads[0]["function_path"] == []

    async def test_the_message_holds_the_value_its_type_and_its_scope_only(self) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            payloads = await _socket_payloads(
                [_event(session_id, "count", 5, ("fn-1",))], session_id
            )

        assert set(payloads[0]) == {"type", "path", "value", "var_type", "scope", "function_path"}

    async def test_a_secret_function_value_is_masked_and_keeps_its_scope(self) -> None:
        session = _push_session(str(uuid.uuid4()), registry=_token_registry())
        with _registered(session) as session_id:
            payloads = await _socket_payloads(
                [_event(session_id, "copied", "Bearer s3cr3t-t0ken-99", ("fn-1",))], session_id
            )

        assert payloads[0]["value"] == "Bearer ********"
        assert payloads[0]["function_path"] == ["fn-1"]

    async def test_a_test_variable_and_a_function_local_of_one_name_are_throttled_apart(
        self,
    ) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            payloads = await _socket_payloads(
                [_event(session_id, "x", 1, ()), _event(session_id, "x", 2, ("fn-1",))],
                session_id,
            )

        assert [(p["value"], p["scope"], p["function_path"]) for p in payloads] == [
            (1, "test", []),
            (2, "function", ["fn-1"]),
        ]

    async def test_two_function_instances_of_one_name_are_throttled_apart(self) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            payloads = await _socket_payloads(
                [_event(session_id, "x", 1, ("fn-1",)), _event(session_id, "x", 2, ("fn-2",))],
                session_id,
            )

        assert [(p["value"], p["function_path"]) for p in payloads] == [
            (1, ["fn-1"]),
            (2, ["fn-2"]),
        ]

    async def test_a_function_value_is_never_replaced_by_a_test_value_of_one_name(
        self,
    ) -> None:
        with _registered(_push_session(str(uuid.uuid4()))) as session_id:
            payloads = await _socket_payloads(
                [
                    _event(session_id, "x", 1, ()),
                    _event(session_id, "x", 2, ("fn-1",)),
                    _event(session_id, "x", 3, ()),
                ],
                session_id,
                throttle_ms=20,
                settle=0.15,
            )

        assert [(p["value"], p["scope"], p["function_path"]) for p in payloads] == [
            (1, "test", []),
            (2, "function", ["fn-1"]),
            (3, "test", []),
        ]


class TestCurrentEditPushScheduler:
    """One scheduler pushes a Current edit with the scope it landed in (REQ-3.2.1.6)."""

    async def test_a_function_scope_edit_pushes_its_instance_path(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        with _registered(_push_session(str(uuid.uuid4()))) as session_id, _push_recorder() as rec:
            workbench_service._schedule_variable_change_push(session_id, "count", 7, ("fn-1",))
            await asyncio.sleep(0.01)

        events = [call.args[0] for call in rec.push_variable_change.call_args_list]
        assert len(events) == 1
        assert events[0]["path"] == "count"
        assert events[0]["value"] == 7
        assert events[0]["scope"] == "function"
        assert _on_the_wire(events[0])["function_path"] == ["fn-1"]
        assert events[0]["watch_id"] == session_id

    async def test_a_test_scope_edit_pushes_an_empty_path(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        with _registered(_push_session(str(uuid.uuid4()))) as session_id, _push_recorder() as rec:
            workbench_service._schedule_variable_change_push(session_id, "count", 7, ())
            await asyncio.sleep(0.01)

        events = [call.args[0] for call in rec.push_variable_change.call_args_list]
        assert [(e["scope"], _on_the_wire(e)["function_path"]) for e in events] == [("test", [])]

    async def test_a_null_edit_is_pushed_as_null(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        with _registered(_push_session(str(uuid.uuid4()))) as session_id, _push_recorder() as rec:
            workbench_service._schedule_variable_change_push(session_id, "count", None, ("fn-1",))
            await asyncio.sleep(0.01)

        events = [call.args[0] for call in rec.push_variable_change.call_args_list]
        assert [(e["value"], e["var_type"]) for e in events] == [(None, "null")]

    def test_without_a_running_loop_nothing_is_pushed(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        with _registered(_push_session(str(uuid.uuid4()))) as session_id, _push_recorder() as rec:
            workbench_service._schedule_variable_change_push(session_id, "count", 7, ("fn-1",))

        rec.push_variable_change.assert_not_called()


class TestEveryPushSiteHandsOverTheOneEvent:
    """The run's push helpers and the session's SSH registry build the one event
    (REQ-3.1.3.12)."""

    async def test_a_single_value_push_carries_the_scope(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        with _registered(_push_session(str(uuid.uuid4()))) as session_id, _push_recorder() as rec:
            await _wb_common._push_single_variable_change(session_id, "n", 1)

        events = [call.args[0] for call in rec.push_variable_change.call_args_list]
        assert [set(e) for e in events] == [_EVENT_KEYS]
        assert [(e["scope"], _on_the_wire(e)["function_path"]) for e in events] == [("test", [])]

    async def test_a_block_write_push_carries_the_scope(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        with _registered(_push_session(str(uuid.uuid4()))) as session_id, _push_recorder() as rec:
            await _wb_common._push_variable_changes(session_id, {}, {"n": 1})

        events = [call.args[0] for call in rec.push_variable_change.call_args_list]
        assert [set(e) for e in events] == [_EVENT_KEYS]
        assert [(e["scope"], _on_the_wire(e)["function_path"]) for e in events] == [("test", [])]

    async def test_a_dropped_ssh_session_pushes_its_connected_variable_with_the_scope(
        self,
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        with _registered(_push_session(str(uuid.uuid4()))) as session_id, _push_recorder() as rec:
            registry = workbench_service._session_registry(None, session_id)
            assert registry.push_variable is not None
            registry.push_variable("connected", False)
            await asyncio.sleep(0.01)

        events = [call.args[0] for call in rec.push_variable_change.call_args_list]
        assert [set(e) for e in events] == [_EVENT_KEYS]
        assert [
            (e["path"], e["value"], e["scope"], _on_the_wire(e)["function_path"]) for e in events
        ] == [("connected", False, "test", [])]


def _ssh_open_node() -> dict[str, Any]:
    """An SSH Session Open block binding its Connected output to ``conn_ok``."""
    return make_node(
        "ssh-open",
        label="SSH Session Open",
        element_type="ssh-session-open",
        node_type="plugin",
        config_values={
            "host": "node-1",
            "username": "wave",
            "password": "s3cr3t-pw",
            "keep_alive_interval": 0,
        },
        output_bindings={"connected": "conn_ok"},
    )


def _opening_a_session(name: str) -> dict[str, Any]:
    """A Function whose body opens an SSH session; its local ``conn_ok`` holds Connected."""
    return _definition(
        name,
        [_ssh_open_node()],
        [edge("start-node", "ssh-open")],
        variables=[{"name": "conn_ok", "type": "boolean", "value": False}],
    )


SSH_INSTANCES = [
    pytest.param(None, [], id="test-canvas"),
    pytest.param(_opening_a_session("Opener"), ["fn"], id="function"),
    pytest.param(
        _definition(
            "Holder",
            [_instance("inner", _opening_a_session("Opener"))],
            [edge("start-node", "inner")],
        ),
        ["fn", "inner"],
        id="nested-function",
    ),
]


@pytest.mark.usefixtures("engine_registries", "_ssh_open_plugin")
class TestTheSshConnectedPushNamesItsScope:
    """The SSH registry's push of the Connected variable names the scope of the block that
    opened the session, a Function instance included, when the run's end closes it
    (REQ-3.1.3.12)."""

    @pytest.fixture
    def _ssh_open_plugin(self) -> Iterator[None]:
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins._ssh_session import OpenedSSHConnection
        from wavecore.plugins.ssh_session_open import SSHSessionOpenPlugin

        register_plugin(SSHSessionOpenPlugin())
        connection = MagicMock()
        connection.get_extra_info.return_value = "SSH-2.0-Sim"
        opened = AsyncMock(return_value=OpenedSSHConnection(connection, None))
        with patch("wavecore.plugins.ssh_session_open.open_connection", new=opened):
            yield

    @pytest.mark.parametrize(("definition", "path"), SSH_INSTANCES)
    async def test_the_closed_sessions_connected_push_names_the_scope_of_its_block(
        self, definition: dict[str, Any] | None, path: list[str]
    ) -> None:
        block = _ssh_open_node() if definition is None else _instance("fn", definition)
        scope = "function" if path else "test"

        with _stored(([block], [edge("start-node", block["id"])])), _push_recorder() as rec:
            await _run()

        assert _pushes_of(rec, "conn_ok")[-1] == (False, scope, path)
        assert _scopes_of(rec, "conn_ok") == {(scope, tuple(path))}
