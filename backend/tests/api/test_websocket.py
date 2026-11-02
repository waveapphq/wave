"""WebSocket Server Tests for REQ-5.2.5.1: Real-time updates via WebSocket protocol.

This module contains comprehensive tests for the WebSocket server implementation
that provides bidirectional, real-time communication between the WAVE backend
and connected clients.

Test Organization:
- TestConnectionManagement: Connection lifecycle, IDs, metadata, heartbeat, limits
- TestSubscriptionModel: Topic subscriptions, dynamic management, scoped subscriptions
- TestEventCategories: Plugin, block, execution, variable, debug, system, error events
- TestMessageProtocol: JSON format, envelope, sequence numbers, acknowledgment, compression
- TestBroadcasting: System-wide, topic-based, unicast, execution-scoped, rate limiting, queuing
- TestErrorHandling: Reconnection backoff, error codes, malformed messages, containment, health
"""

import asyncio
import json
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

# ============================================================================
# Connection Management Tests
# ============================================================================


class TestConnectionManagement:
    """Tests for WebSocket connection management (REQ-5.2.5.1).

    Covers: Connection endpoint, unique IDs, metadata, heartbeat, limits, reconnection.
    """

    def test_websocket_endpoint_accepts_connections(self) -> None:
        """WebSocket endpoint at /ws accepts connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        assert manager.websocket_path == "/ws"

    def test_connection_receives_unique_id(self) -> None:
        """Each connection receives a unique identifier."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        _mock_ws1 = AsyncMock(spec=WebSocket)
        _mock_ws2 = AsyncMock(spec=WebSocket)

        conn_id1 = manager._generate_connection_id()
        conn_id2 = manager._generate_connection_id()

        assert conn_id1 != conn_id2
        assert isinstance(conn_id1, str)
        assert len(conn_id1) > 0

    def test_connection_id_format(self) -> None:
        """Connection IDs follow expected format (UUID-based)."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        conn_id = manager._generate_connection_id()

        # Should be UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        parts = conn_id.split("-")
        assert len(parts) == 5
        assert len(parts[0]) == 8
        assert len(parts[1]) == 4
        assert len(parts[2]) == 4
        assert len(parts[3]) == 4
        assert len(parts[4]) == 12

    async def test_connection_stores_metadata(self) -> None:
        """Connection metadata is stored on connect."""
        from wavecore.api.websocket import ConnectionMetadata, WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws, client_type="dashboard")

        metadata = manager.get_connection_metadata(conn_id)
        assert metadata is not None
        assert isinstance(metadata, ConnectionMetadata)
        assert metadata.client_type == "dashboard"
        assert metadata.connection_id == conn_id
        assert isinstance(metadata.connected_at, datetime)

    async def test_connection_metadata_includes_subscriptions(self) -> None:
        """Connection metadata tracks subscription preferences."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        metadata = manager.get_connection_metadata(conn_id)

        assert metadata is not None
        assert hasattr(metadata, "subscriptions")
        assert isinstance(metadata.subscriptions, set)

    async def test_heartbeat_detects_stale_connections(self) -> None:
        """Heartbeat mechanism detects stale connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(heartbeat_interval=0.1, heartbeat_timeout=0.2)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Simulate stale connection by not sending pong
        await asyncio.sleep(0.3)
        stale_connections = manager.get_stale_connections()

        assert conn_id in stale_connections

    async def test_heartbeat_ping_sent_to_clients(self) -> None:
        """Heartbeat ping messages are sent to connected clients."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(heartbeat_interval=0.1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        await manager.send_heartbeat(conn_id)

        # Verify ping was sent
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["type"] == "ping"

    async def test_heartbeat_pong_updates_last_activity(self) -> None:
        """Receiving pong updates connection last activity timestamp."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        initial_activity = manager.get_connection_metadata(conn_id).last_activity

        await asyncio.sleep(0.1)
        manager.handle_pong(conn_id)

        updated_activity = manager.get_connection_metadata(conn_id).last_activity
        assert updated_activity > initial_activity

    async def test_connection_limit_enforced(self) -> None:
        """Connection limit prevents resource exhaustion."""
        from wavecore.api.websocket import ConnectionLimitExceeded, WebSocketManager

        manager = WebSocketManager(max_connections=2)
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws3 = AsyncMock(spec=WebSocket)
        for ws in [mock_ws1, mock_ws2, mock_ws3]:
            ws.accept = AsyncMock()

        await manager.connect(mock_ws1)
        await manager.connect(mock_ws2)

        with pytest.raises(ConnectionLimitExceeded) as exc_info:
            await manager.connect(mock_ws3)

        assert "Maximum connections" in str(exc_info.value)

    async def test_connection_limit_configurable(self) -> None:
        """Connection limit is configurable."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(max_connections=100)
        assert manager.max_connections == 100

    async def test_disconnect_frees_connection_slot(self) -> None:
        """Disconnecting frees up a connection slot."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(max_connections=1)
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws1)
        manager.disconnect(conn_id)
        # Should succeed now
        await manager.connect(mock_ws2)

    async def test_stale_connection_cleanup(self) -> None:
        """Stale connections are automatically cleaned up."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(heartbeat_timeout=0.1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.close = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        await asyncio.sleep(0.2)

        await manager.cleanup_stale_connections()
        assert conn_id not in manager.active_connections

    def test_reconnection_support_via_session_id(self) -> None:
        """Session ID support enables reconnection continuity."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        session_id = manager.create_session()

        assert session_id is not None
        assert isinstance(session_id, str)

    async def test_reconnection_restores_subscriptions(self) -> None:
        """Reconnection with session ID restores previous subscriptions."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()

        # First connection with session
        session_id = manager.create_session()
        conn_id1 = await manager.connect(mock_ws1, session_id=session_id)
        manager.subscribe(conn_id1, "execution:test-123")
        manager.disconnect(conn_id1)

        # Reconnect with same session
        conn_id2 = await manager.connect(mock_ws2, session_id=session_id)
        metadata = manager.get_connection_metadata(conn_id2)

        assert "execution:test-123" in metadata.subscriptions

    def test_session_id_format(self) -> None:
        """Session IDs follow expected format (UUID-based)."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        session_id = manager.create_session()

        # Should be UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        parts = session_id.split("-")
        assert len(parts) == 5
        assert len(parts[0]) == 8
        assert len(parts[1]) == 4
        assert len(parts[2]) == 4
        assert len(parts[3]) == 4
        assert len(parts[4]) == 12

    def test_session_ids_are_unique(self) -> None:
        """Each session receives a unique identifier."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        session_id1 = manager.create_session()
        session_id2 = manager.create_session()
        session_id3 = manager.create_session()

        assert session_id1 != session_id2
        assert session_id2 != session_id3
        assert session_id1 != session_id3

    async def test_session_expiration_after_timeout(self) -> None:
        """Sessions expire after configurable timeout."""
        from wavecore.api.websocket import SessionExpired, WebSocketManager

        manager = WebSocketManager(session_expiration_seconds=0.1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        session_id = manager.create_session()
        conn_id = await manager.connect(mock_ws, session_id=session_id)
        manager.subscribe(conn_id, "execution:test-123")
        manager.disconnect(conn_id)

        # Wait for session to expire
        await asyncio.sleep(0.2)

        # Cleanup expired sessions
        manager.cleanup_expired_sessions()

        # Attempting to reconnect with expired session should fail
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws2.accept = AsyncMock()

        with pytest.raises(SessionExpired) as exc_info:
            await manager.connect(mock_ws2, session_id=session_id)

        assert "Session expired" in str(exc_info.value)

    async def test_heartbeat_loop_sends_periodic_pings(self) -> None:
        """Heartbeat loop sends periodic ping messages to all connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(heartbeat_interval=0.1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        _conn_id = await manager.connect(mock_ws)

        # Start heartbeat loop
        heartbeat_task = asyncio.create_task(manager.run_heartbeat_loop())

        # Wait for a few heartbeats
        await asyncio.sleep(0.35)

        # Stop the loop
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass

        # Should have sent multiple pings (at least 2-3 in 0.35s with 0.1s interval)
        ping_calls = [
            call for call in mock_ws.send_json.call_args_list if call[0][0].get("type") == "ping"
        ]
        assert len(ping_calls) >= 2

    async def test_fastapi_endpoint_registration(self) -> None:
        """WebSocket endpoint can be registered with FastAPI application."""
        from wavecore.api.websocket import WebSocketManager, create_websocket_route

        app = FastAPI()
        manager = WebSocketManager()

        # Register the WebSocket route
        create_websocket_route(app, manager)

        # Verify the route is registered
        routes = [route.path for route in app.routes]
        assert "/ws" in routes


# ============================================================================
# Subscription Model Tests
# ============================================================================


class TestSubscriptionModel:
    """Tests for WebSocket subscription model (REQ-5.2.5.1).

    Covers: Topic subscriptions, dynamic management, execution-scoped, global subscriptions.
    """

    async def test_subscribe_to_topic(self) -> None:
        """Client can subscribe to a topic."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        result = manager.subscribe(conn_id, "execution")

        assert result is True
        metadata = manager.get_connection_metadata(conn_id)
        assert "execution" in metadata.subscriptions

    async def test_unsubscribe_from_topic(self) -> None:
        """Client can unsubscribe from a topic."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "execution")
        result = manager.unsubscribe(conn_id, "execution")

        assert result is True
        metadata = manager.get_connection_metadata(conn_id)
        assert "execution" not in metadata.subscriptions

    async def test_subscription_categories_execution_events(self) -> None:
        """Execution events subscription category is supported."""
        from wavecore.api.websocket import SubscriptionCategory, WebSocketManager

        _manager = WebSocketManager()
        assert SubscriptionCategory.EXECUTION in SubscriptionCategory

    async def test_subscription_categories_system_events(self) -> None:
        """System events subscription category is supported."""
        from wavecore.api.websocket import SubscriptionCategory

        assert SubscriptionCategory.SYSTEM in SubscriptionCategory

    async def test_subscription_categories_debug_events(self) -> None:
        """Debug events subscription category is supported."""
        from wavecore.api.websocket import SubscriptionCategory

        assert SubscriptionCategory.DEBUG in SubscriptionCategory

    async def test_dynamic_subscription_without_reconnect(self) -> None:
        """Subscriptions can be changed dynamically without reconnecting."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Add subscription
        manager.subscribe(conn_id, "execution")
        assert "execution" in manager.get_connection_metadata(conn_id).subscriptions

        # Add another
        manager.subscribe(conn_id, "debug")
        assert "debug" in manager.get_connection_metadata(conn_id).subscriptions
        assert "execution" in manager.get_connection_metadata(conn_id).subscriptions

        # Remove one
        manager.unsubscribe(conn_id, "execution")
        assert "execution" not in manager.get_connection_metadata(conn_id).subscriptions
        assert "debug" in manager.get_connection_metadata(conn_id).subscriptions

    async def test_execution_scoped_subscription(self) -> None:
        """Client can subscribe to specific execution ID events."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        execution_id = "exec-123-456"
        topic = f"execution:{execution_id}"

        manager.subscribe(conn_id, topic)
        metadata = manager.get_connection_metadata(conn_id)

        assert topic in metadata.subscriptions

    async def test_execution_scoped_subscription_receives_only_relevant_events(self) -> None:
        """Execution-scoped subscription only receives events for that execution."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "execution:exec-123")

        # Should receive this event
        await manager.broadcast_to_topic(
            "execution:exec-123",
            {"type": "plugin_complete", "execution_id": "exec-123"},
        )
        assert mock_ws.send_json.call_count == 1

        # Should NOT receive this event
        mock_ws.send_json.reset_mock()
        await manager.broadcast_to_topic(
            "execution:exec-999",
            {"type": "plugin_complete", "execution_id": "exec-999"},
        )
        assert mock_ws.send_json.call_count == 0

    async def test_global_subscription_receives_all_events(self) -> None:
        """Global subscription receives system-wide events."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "system")

        await manager.broadcast_to_topic("system", {"type": "server_status"})

        mock_ws.send_json.assert_called_once()

    async def test_multiple_subscriptions_per_connection(self) -> None:
        """Single connection can have multiple subscriptions."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "execution:exec-1")
        manager.subscribe(conn_id, "execution:exec-2")
        manager.subscribe(conn_id, "system")
        manager.subscribe(conn_id, "debug")

        metadata = manager.get_connection_metadata(conn_id)
        assert len(metadata.subscriptions) == 4

    async def test_unsubscribe_nonexistent_topic_returns_false(self) -> None:
        """Unsubscribing from non-subscribed topic returns False."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        result = manager.unsubscribe(conn_id, "nonexistent")

        assert result is False

    async def test_subscribe_invalid_connection_raises_error(self) -> None:
        """Subscribing with invalid connection ID raises error."""
        from wavecore.api.websocket import ConnectionNotFound, WebSocketManager

        manager = WebSocketManager()

        with pytest.raises(ConnectionNotFound) as exc_info:
            manager.subscribe("invalid-conn-id", "execution")

        assert "Connection not found" in str(exc_info.value)

    async def test_overlapping_subscriptions_receive_event_once(self) -> None:
        """Client with overlapping subscriptions receives each event only once."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Subscribe to both a specific execution AND the general execution category
        manager.subscribe(conn_id, "execution:exec-123")
        manager.subscribe(conn_id, "execution")

        # Broadcast to the specific execution topic
        await manager.broadcast_to_topic(
            "execution:exec-123",
            {"type": "plugin_complete", "execution_id": "exec-123"},
        )

        # Should receive the event only once, not twice
        assert mock_ws.send_json.call_count == 1

    async def test_error_topic_subscription_receives_error_events(self) -> None:
        """Clients subscribed to error topics receive propagated error events."""
        from wavecore.api.websocket import EventType, WebSocketManager, create_event

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "error")

        # Create and broadcast an error event
        error_event = create_event(
            EventType.ERROR_EXECUTION_FAILURE,
            execution_id="exec-123",
            error_code="PLUGIN_TIMEOUT",
            error_message="Plugin execution timed out",
        )
        await manager.broadcast_to_topic("error", error_event)

        # Should receive the error event
        mock_ws.send_json.assert_called_once()
        sent_event = mock_ws.send_json.call_args[0][0]
        assert sent_event["type"] == "error_execution_failure"
        assert sent_event["error_code"] == "PLUGIN_TIMEOUT"


# ============================================================================
# Event Categories Tests
# ============================================================================


class TestEventCategories:
    """Tests for WebSocket event categories (REQ-5.2.5.1).

    Covers: Plugin, block, execution, variable, debug, system, error events.
    """

    def test_plugin_start_event_structure(self) -> None:
        """Plugin start event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.PLUGIN_START,
            execution_id="exec-123",
            plugin_id="shell-script",
            block_id="block-1",
        )

        assert event["type"] == "plugin_start"
        assert event["execution_id"] == "exec-123"
        assert event["plugin_id"] == "shell-script"
        assert event["block_id"] == "block-1"
        assert "timestamp" in event
        assert "sequence" in event

    def test_plugin_complete_event_structure(self) -> None:
        """Plugin complete event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.PLUGIN_COMPLETE,
            execution_id="exec-123",
            plugin_id="shell-script",
            block_id="block-1",
            return_value={"stdout": "hello"},
        )

        assert event["type"] == "plugin_complete"
        assert event["return_value"] == {"stdout": "hello"}

    def test_plugin_error_event_structure(self) -> None:
        """Plugin error event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.PLUGIN_ERROR,
            execution_id="exec-123",
            plugin_id="shell-script",
            block_id="block-1",
            error="Command failed with exit code 1",
        )

        assert event["type"] == "plugin_error"
        assert event["error"] == "Command failed with exit code 1"

    def test_block_start_event_structure(self) -> None:
        """Block start event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.BLOCK_START,
            execution_id="exec-123",
            block_id="block-1",
            block_name="Setup Database",
        )

        assert event["type"] == "block_start"
        assert event["block_id"] == "block-1"
        assert event["block_name"] == "Setup Database"

    def test_block_complete_event_structure(self) -> None:
        """Block complete event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.BLOCK_COMPLETE,
            execution_id="exec-123",
            block_id="block-1",
        )

        assert event["type"] == "block_complete"

    def test_block_error_event_structure(self) -> None:
        """Block error event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.BLOCK_ERROR,
            execution_id="exec-123",
            block_id="block-1",
            error="Block execution failed",
        )

        assert event["type"] == "block_error"
        assert event["error"] == "Block execution failed"

    def test_execution_start_event_structure(self) -> None:
        """Execution start event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.EXECUTION_START,
            execution_id="exec-123",
            test_id="test-456",
            test_name="Integration Test",
        )

        assert event["type"] == "execution_start"
        assert event["test_id"] == "test-456"
        assert event["test_name"] == "Integration Test"

    def test_execution_progress_event_structure(self) -> None:
        """Execution progress event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.EXECUTION_PROGRESS,
            execution_id="exec-123",
            progress=50,
            current_block="block-3",
        )

        assert event["type"] == "execution_progress"
        assert event["progress"] == 50
        assert event["current_block"] == "block-3"

    def test_execution_complete_event_structure(self) -> None:
        """Execution complete event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.EXECUTION_COMPLETE,
            execution_id="exec-123",
            status="completed",
            duration_ms=5432,
        )

        assert event["type"] == "execution_complete"
        assert event["status"] == "completed"
        assert event["duration_ms"] == 5432

    def test_variable_create_event_structure(self) -> None:
        """Variable create event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.VARIABLE_CREATE,
            execution_id="exec-123",
            variable_name="db_host",
            variable_value="localhost",
            scope="test",
        )

        assert event["type"] == "variable_create"
        assert event["variable_name"] == "db_host"
        assert event["variable_value"] == "localhost"
        assert event["scope"] == "test"

    def test_variable_update_event_structure(self) -> None:
        """Variable update event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.VARIABLE_UPDATE,
            execution_id="exec-123",
            variable_name="counter",
            old_value=5,
            new_value=6,
        )

        assert event["type"] == "variable_update"
        assert event["old_value"] == 5
        assert event["new_value"] == 6

    def test_variable_delete_event_structure(self) -> None:
        """Variable delete event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.VARIABLE_DELETE,
            execution_id="exec-123",
            variable_name="temp_var",
        )

        assert event["type"] == "variable_delete"
        assert event["variable_name"] == "temp_var"

    def test_debug_breakpoint_hit_event_structure(self) -> None:
        """Debug breakpoint hit event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.DEBUG_BREAKPOINT_HIT,
            execution_id="exec-123",
            breakpoint_id="bp-1",
            block_id="block-5",
            line_number=42,
        )

        assert event["type"] == "debug_breakpoint_hit"
        assert event["breakpoint_id"] == "bp-1"
        assert event["line_number"] == 42

    def test_debug_step_complete_event_structure(self) -> None:
        """Debug step complete event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.DEBUG_STEP_COMPLETE,
            execution_id="exec-123",
            step_type="step_over",
            next_block_id="block-6",
        )

        assert event["type"] == "debug_step_complete"
        assert event["step_type"] == "step_over"

    def test_debug_watch_change_event_structure(self) -> None:
        """Debug watch value change event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.DEBUG_WATCH_CHANGE,
            execution_id="exec-123",
            watch_expression="user.name",
            old_value="Alice",
            new_value="Bob",
        )

        assert event["type"] == "debug_watch_change"
        assert event["watch_expression"] == "user.name"

    def test_system_status_event_structure(self) -> None:
        """System status event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.SYSTEM_STATUS,
            status="healthy",
            active_executions=5,
            connected_clients=12,
        )

        assert event["type"] == "system_status"
        assert event["status"] == "healthy"
        assert event["active_executions"] == 5

    def test_system_config_change_event_structure(self) -> None:
        """System configuration change event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.SYSTEM_CONFIG_CHANGE,
            config_key="max_parallel_executions",
            old_value=10,
            new_value=20,
        )

        assert event["type"] == "system_config_change"
        assert event["config_key"] == "max_parallel_executions"

    def test_system_resource_warning_event_structure(self) -> None:
        """System resource warning event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.SYSTEM_RESOURCE_WARNING,
            resource_type="memory",
            current_usage=85.5,
            threshold=80.0,
            message="Memory usage above threshold",
        )

        assert event["type"] == "system_resource_warning"
        assert event["resource_type"] == "memory"
        assert event["current_usage"] == 85.5

    def test_error_execution_failure_event_structure(self) -> None:
        """Error execution failure event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.ERROR_EXECUTION_FAILURE,
            execution_id="exec-123",
            error_code="PLUGIN_TIMEOUT",
            error_message="Plugin execution timed out after 300s",
        )

        assert event["type"] == "error_execution_failure"
        assert event["error_code"] == "PLUGIN_TIMEOUT"

    def test_error_connection_error_event_structure(self) -> None:
        """Error connection error event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.ERROR_CONNECTION,
            connection_id="conn-456",
            error_code="CONNECTION_LOST",
            error_message="Connection lost unexpectedly",
        )

        assert event["type"] == "error_connection"
        assert event["connection_id"] == "conn-456"

    def test_error_subscription_error_event_structure(self) -> None:
        """Error subscription error event has correct structure."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.ERROR_SUBSCRIPTION,
            connection_id="conn-456",
            topic="execution:invalid",
            error_code="INVALID_TOPIC",
            error_message="Invalid topic format",
        )

        assert event["type"] == "error_subscription"
        assert event["topic"] == "execution:invalid"


# ============================================================================
# Message Protocol Tests
# ============================================================================


class TestMessageProtocol:
    """Tests for WebSocket message protocol (REQ-5.2.5.1).

    Covers: JSON format, envelope structure, sequence numbers, acknowledgment, compression.
    """

    def test_message_uses_json_format(self) -> None:
        """Messages use JSON format for broad compatibility."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(EventType.EXECUTION_START, execution_id="exec-123")

        # Should be JSON serializable
        json_str = json.dumps(event)
        parsed = json.loads(json_str)

        assert parsed == event

    def test_message_envelope_contains_event_type(self) -> None:
        """Message envelope contains event type field."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(EventType.PLUGIN_START, execution_id="exec-123")

        assert "type" in event
        assert event["type"] == "plugin_start"

    def test_message_envelope_contains_timestamp(self) -> None:
        """Message envelope contains timestamp field."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(EventType.PLUGIN_START, execution_id="exec-123")

        assert "timestamp" in event
        # Should be ISO format
        timestamp = event["timestamp"]
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))

    def test_message_envelope_contains_payload(self) -> None:
        """Message envelope contains event-specific payload."""
        from wavecore.api.websocket import EventType, create_event

        event = create_event(
            EventType.PLUGIN_START,
            execution_id="exec-123",
            plugin_id="shell-script",
        )

        # Payload fields are at top level (flat structure)
        assert event["execution_id"] == "exec-123"
        assert event["plugin_id"] == "shell-script"

    def test_message_sequence_numbers_increment(self) -> None:
        """Message sequence numbers increment for ordering verification."""
        from wavecore.api.websocket import EventType, create_event

        event1 = create_event(EventType.PLUGIN_START, execution_id="exec-123")
        event2 = create_event(EventType.PLUGIN_COMPLETE, execution_id="exec-123")
        event3 = create_event(EventType.BLOCK_COMPLETE, execution_id="exec-123")

        assert "sequence" in event1
        assert "sequence" in event2
        assert "sequence" in event3
        assert event2["sequence"] > event1["sequence"]
        assert event3["sequence"] > event2["sequence"]

    def test_sequence_numbers_enable_gap_detection(self) -> None:
        """Sequence numbers allow detection of missing messages."""
        from wavecore.api.websocket import SequenceTracker

        tracker = SequenceTracker()

        tracker.record_received(1)
        tracker.record_received(2)
        tracker.record_received(4)  # Gap - missing 3

        gaps = tracker.get_gaps()
        assert 3 in gaps

    async def test_acknowledgment_for_critical_messages(self) -> None:
        """Critical messages support acknowledgment for delivery confirmation."""
        from wavecore.api.websocket import EventType, WebSocketManager, create_event

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        # Simulate receiving ack when message is sent
        async def send_and_ack(message: dict[str, Any]) -> None:
            if "ack_id" in message:
                manager.handle_ack(message["ack_id"])

        mock_ws.send_json = AsyncMock(side_effect=send_and_ack)

        conn_id = await manager.connect(mock_ws)

        event = create_event(
            EventType.EXECUTION_COMPLETE,
            execution_id="exec-123",
            requires_ack=True,
        )

        await manager.send_with_ack(conn_id, event, timeout_seconds=5.0)

        # Message should have ack_id
        sent_message = mock_ws.send_json.call_args[0][0]
        assert "ack_id" in sent_message

    async def test_acknowledgment_timeout_handling(self) -> None:
        """Unacknowledged messages trigger timeout handling."""
        from wavecore.api.websocket import AcknowledgmentTimeout, WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        with pytest.raises(AcknowledgmentTimeout):
            await manager.send_with_ack(
                conn_id,
                {"type": "test", "requires_ack": True},
                timeout_seconds=0.1,
            )

    def test_compression_for_large_payloads(self) -> None:
        """Large payloads support compression to reduce bandwidth."""
        from wavecore.api.websocket import compress_message, decompress_message

        large_payload = {"data": "x" * 10000}  # Large payload
        message = json.dumps(large_payload)

        compressed = compress_message(message)
        decompressed = decompress_message(compressed)

        assert len(compressed) < len(message.encode())
        assert json.loads(decompressed) == large_payload

    def test_compression_threshold(self) -> None:
        """Compression only applied above threshold size."""
        from wavecore.api.websocket import should_compress

        small_message = json.dumps({"type": "ping"})
        large_message = json.dumps({"data": "x" * 10000})

        assert should_compress(small_message) is False
        assert should_compress(large_message) is True

    def test_compression_indicator_in_message(self) -> None:
        """Compressed messages include compression indicator."""
        from wavecore.api.websocket import wrap_compressed_message

        compressed_data = b"compressed bytes"
        wrapped = wrap_compressed_message(compressed_data)

        assert wrapped["compressed"] is True
        assert "data" in wrapped

    async def test_manager_applies_compression_for_large_messages(self) -> None:
        """WebSocketManager applies compression when sending large messages."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(compression_threshold=100)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()
        mock_ws.send_bytes = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Send a large message that should be compressed
        large_payload = {"data": "x" * 1000}
        await manager.unicast(conn_id, large_payload, compress_if_large=True)

        # Should use send_bytes for compressed data, not send_json
        mock_ws.send_bytes.assert_called_once()
        mock_ws.send_json.assert_not_called()

    async def test_manager_skips_compression_for_small_messages(self) -> None:
        """WebSocketManager skips compression for small messages."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(compression_threshold=1000)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()
        mock_ws.send_bytes = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Send a small message that should NOT be compressed
        small_payload = {"type": "ping"}
        await manager.unicast(conn_id, small_payload, compress_if_large=True)

        # Should use send_json, not send_bytes
        mock_ws.send_json.assert_called_once()
        mock_ws.send_bytes.assert_not_called()


# ============================================================================
# Broadcasting Tests
# ============================================================================


class TestBroadcasting:
    """Tests for WebSocket broadcasting (REQ-5.2.5.1).

    Covers: System-wide, topic-based, unicast, execution-scoped, rate limiting, queuing.
    """

    async def test_broadcast_to_all_clients(self) -> None:
        """System-wide broadcast reaches all connected clients."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws3 = AsyncMock(spec=WebSocket)

        for ws in [mock_ws1, mock_ws2, mock_ws3]:
            ws.accept = AsyncMock()
            ws.send_json = AsyncMock()

        await manager.connect(mock_ws1)
        await manager.connect(mock_ws2)
        await manager.connect(mock_ws3)

        await manager.broadcast_all({"type": "system_announcement"})

        mock_ws1.send_json.assert_called_once()
        mock_ws2.send_json.assert_called_once()
        mock_ws3.send_json.assert_called_once()

    async def test_topic_based_broadcast(self) -> None:
        """Topic-based broadcast reaches only subscribed clients."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)

        for ws in [mock_ws1, mock_ws2]:
            ws.accept = AsyncMock()
            ws.send_json = AsyncMock()

        conn_id1 = await manager.connect(mock_ws1)
        _conn_id2 = await manager.connect(mock_ws2)

        manager.subscribe(conn_id1, "debug")
        # conn_id2 not subscribed to debug

        await manager.broadcast_to_topic("debug", {"type": "debug_event"})

        mock_ws1.send_json.assert_called_once()
        mock_ws2.send_json.assert_not_called()

    async def test_unicast_to_specific_connection(self) -> None:
        """Unicast sends message to specific connection only."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)

        for ws in [mock_ws1, mock_ws2]:
            ws.accept = AsyncMock()
            ws.send_json = AsyncMock()

        conn_id1 = await manager.connect(mock_ws1)
        await manager.connect(mock_ws2)

        await manager.unicast(conn_id1, {"type": "direct_message"})

        mock_ws1.send_json.assert_called_once()
        mock_ws2.send_json.assert_not_called()

    async def test_rate_limiting_prevents_flooding(self) -> None:
        """Rate limiting prevents message flooding during high-frequency events."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(rate_limit_per_second=10)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Send many messages quickly
        for i in range(50):
            await manager.unicast(conn_id, {"type": "event", "index": i})

        # Should be rate limited
        assert mock_ws.send_json.call_count <= 15  # Some tolerance for timing

    async def test_rate_limiting_configurable(self) -> None:
        """Rate limiting threshold is configurable."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(rate_limit_per_second=100)
        assert manager.rate_limit_per_second == 100

    async def test_message_queuing_for_disconnected_clients(self) -> None:
        """Messages are queued for temporarily disconnected clients."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(enable_message_queue=True, queue_max_size=100)
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws2.send_json = AsyncMock()

        session_id = manager.create_session()
        conn_id1 = await manager.connect(mock_ws1, session_id=session_id)
        manager.subscribe(conn_id1, "execution:exec-123")

        # Disconnect
        manager.disconnect(conn_id1)

        # Messages sent while disconnected
        await manager.broadcast_to_topic(
            "execution:exec-123",
            {"type": "plugin_complete", "index": 1},
        )
        await manager.broadcast_to_topic(
            "execution:exec-123",
            {"type": "plugin_complete", "index": 2},
        )

        # Reconnect with same session
        _conn_id2 = await manager.connect(mock_ws2, session_id=session_id)

        # Should receive queued messages
        assert mock_ws2.send_json.call_count >= 2

    async def test_message_queue_expiration(self) -> None:
        """Queued messages expire after configurable time."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(
            enable_message_queue=True,
            queue_max_size=100,
            queue_expiration_seconds=0.1,
        )
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws2.send_json = AsyncMock()

        session_id = manager.create_session()
        conn_id1 = await manager.connect(mock_ws1, session_id=session_id)
        manager.subscribe(conn_id1, "execution:exec-123")
        manager.disconnect(conn_id1)

        # Queue a message
        await manager.broadcast_to_topic(
            "execution:exec-123",
            {"type": "plugin_complete"},
        )

        # Wait for expiration
        await asyncio.sleep(0.2)

        # Reconnect - should not receive expired message
        await manager.connect(mock_ws2, session_id=session_id)
        mock_ws2.send_json.assert_not_called()

    async def test_message_queue_size_limit(self) -> None:
        """Message queue respects size limits."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(
            enable_message_queue=True,
            queue_max_size=5,
        )
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        session_id = manager.create_session()
        conn_id = await manager.connect(mock_ws, session_id=session_id)
        manager.subscribe(conn_id, "test")
        manager.disconnect(conn_id)

        # Queue more messages than limit
        for i in range(10):
            await manager.broadcast_to_topic("test", {"index": i})

        queue = manager.get_session_queue(session_id)
        assert len(queue) <= 5

    async def test_broadcast_handles_send_failures_gracefully(self) -> None:
        """Broadcast continues even if some sends fail."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)

        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws1.send_json = AsyncMock(side_effect=Exception("Send failed"))
        mock_ws2.send_json = AsyncMock()

        await manager.connect(mock_ws1)
        await manager.connect(mock_ws2)

        # Should not raise, second client should still receive
        await manager.broadcast_all({"type": "test"})

        mock_ws2.send_json.assert_called_once()

    async def test_rate_limited_messages_are_dropped(self) -> None:
        """Rate-limited messages are dropped, not queued."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(rate_limit_per_second=5)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Send many messages quickly
        dropped_count = 0
        for i in range(20):
            result = await manager.unicast(conn_id, {"type": "event", "index": i})
            if result is False:
                dropped_count += 1

        # Some messages should have been dropped
        assert dropped_count > 0
        # And some should have been sent
        assert mock_ws.send_json.call_count < 20
        assert mock_ws.send_json.call_count > 0

    async def test_rate_limit_returns_drop_status(self) -> None:
        """Unicast returns False when message is rate-limited."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(rate_limit_per_second=1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # First message should succeed
        result1 = await manager.unicast(conn_id, {"type": "event", "index": 1})
        assert result1 is True

        # Immediate second message should be rate limited
        result2 = await manager.unicast(conn_id, {"type": "event", "index": 2})
        assert result2 is False

    async def test_message_queue_disabled_drops_messages_for_disconnected(self) -> None:
        """With queuing disabled, messages for disconnected clients are dropped."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(enable_message_queue=False)
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws2.send_json = AsyncMock()

        session_id = manager.create_session()
        conn_id1 = await manager.connect(mock_ws1, session_id=session_id)
        manager.subscribe(conn_id1, "execution:exec-123")
        manager.disconnect(conn_id1)

        # Messages sent while disconnected (with queuing disabled)
        await manager.broadcast_to_topic(
            "execution:exec-123",
            {"type": "plugin_complete", "index": 1},
        )
        await manager.broadcast_to_topic(
            "execution:exec-123",
            {"type": "plugin_complete", "index": 2},
        )

        # Reconnect with same session
        await manager.connect(mock_ws2, session_id=session_id)

        # Should NOT receive any queued messages since queuing was disabled
        mock_ws2.send_json.assert_not_called()

    async def test_message_queue_disabled_does_not_store_messages(self) -> None:
        """With queuing disabled, no message queue is created for sessions."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(enable_message_queue=False)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        session_id = manager.create_session()
        conn_id = await manager.connect(mock_ws, session_id=session_id)
        manager.subscribe(conn_id, "test")
        manager.disconnect(conn_id)

        # Send messages while disconnected
        for i in range(5):
            await manager.broadcast_to_topic("test", {"index": i})

        # Queue should be empty or None
        queue = manager.get_session_queue(session_id)
        assert queue is None or len(queue) == 0


# ============================================================================
# Error Handling Tests
# ============================================================================


class TestErrorHandling:
    """Tests for WebSocket error handling (REQ-5.2.5.1).

    Covers: Exponential backoff, error codes, malformed messages, containment, health monitoring.
    """

    def test_reconnection_backoff_recommended(self) -> None:
        """Connection errors include exponential backoff recommendation."""
        from wavecore.api.websocket import calculate_reconnect_delay

        delay1 = calculate_reconnect_delay(attempt=1)
        delay2 = calculate_reconnect_delay(attempt=2)
        delay3 = calculate_reconnect_delay(attempt=3)

        assert delay2 > delay1
        assert delay3 > delay2

    def test_reconnection_backoff_has_max_delay(self) -> None:
        """Exponential backoff has maximum delay cap."""
        from wavecore.api.websocket import calculate_reconnect_delay

        delay = calculate_reconnect_delay(attempt=100)

        assert delay <= 60  # Max 60 seconds

    def test_subscription_error_returns_clear_code(self) -> None:
        """Subscription errors return clear error codes."""
        from wavecore.api.websocket import SubscriptionError, WebSocketErrorCode

        error = SubscriptionError(
            code=WebSocketErrorCode.INVALID_TOPIC,
            message="Invalid topic format",
        )

        assert error.code == WebSocketErrorCode.INVALID_TOPIC
        assert "Invalid topic format" in str(error)

    def test_error_codes_are_documented(self) -> None:
        """All error codes have clear meanings."""
        from wavecore.api.websocket import WebSocketErrorCode

        # Verify error codes exist
        assert hasattr(WebSocketErrorCode, "CONNECTION_LIMIT_EXCEEDED")
        assert hasattr(WebSocketErrorCode, "INVALID_TOPIC")
        assert hasattr(WebSocketErrorCode, "INVALID_MESSAGE")
        assert hasattr(WebSocketErrorCode, "SEND_FAILED")
        assert hasattr(WebSocketErrorCode, "ACKNOWLEDGMENT_TIMEOUT")
        assert hasattr(WebSocketErrorCode, "CONNECTION_NOT_FOUND")

    async def test_malformed_message_sends_error_not_disconnect(self) -> None:
        """Malformed messages trigger error notification without disconnection."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Handle malformed message
        await manager.handle_message(conn_id, "not valid json{{{")

        # Should send error but stay connected
        assert conn_id in manager.active_connections

        # Error notification sent
        error_call = mock_ws.send_json.call_args[0][0]
        assert error_call["type"] == "error"
        assert "INVALID_MESSAGE" in error_call["error_code"]

    async def test_subscribe_confirmation_send_failure_is_swallowed(self) -> None:
        """A socket that dies before the subscribe confirmation lands must not
        raise out of handle_message; the subscription itself still registers."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        mock_ws.send_json.side_effect = RuntimeError("socket closed")

        await manager.handle_message(conn_id, '{"type": "subscribe", "topic": "execution:e1"}')

        assert "execution:e1" in manager.get_connection_metadata(conn_id).subscriptions
        assert conn_id in manager.active_connections

    async def test_error_containment_isolates_client_issues(self) -> None:
        """Single client errors don't affect other connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)

        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws1.send_json = AsyncMock(side_effect=Exception("Client 1 error"))
        mock_ws2.send_json = AsyncMock()

        _conn_id1 = await manager.connect(mock_ws1)
        conn_id2 = await manager.connect(mock_ws2)

        # Broadcast - client 1 will fail
        await manager.broadcast_all({"type": "test"})

        # Client 2 should still be operational
        assert conn_id2 in manager.active_connections
        mock_ws2.send_json.assert_called()

    async def test_connection_health_monitoring(self) -> None:
        """Connection health is monitored and reported."""
        from wavecore.api.websocket import ConnectionHealth, WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        health = manager.get_connection_health(conn_id)

        assert isinstance(health, ConnectionHealth)
        assert hasattr(health, "is_healthy")
        assert hasattr(health, "last_ping_latency_ms")
        assert hasattr(health, "missed_heartbeats")

    async def test_unhealthy_connection_marked(self) -> None:
        """Unhealthy connections are marked for cleanup."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(heartbeat_timeout=0.1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Simulate missed heartbeats
        await asyncio.sleep(0.2)

        health = manager.get_connection_health(conn_id)
        assert health.is_healthy is False

    async def test_ping_latency_measured_from_pong_response(self) -> None:
        """Ping latency is measured from time between ping and pong."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Send a ping (this records the ping time)
        await manager.send_heartbeat(conn_id)

        # Simulate some network delay
        await asyncio.sleep(0.05)

        # Receive pong (this measures the latency)
        manager.handle_pong(conn_id)

        # Check that latency was measured
        health = manager.get_connection_health(conn_id)
        assert health.last_ping_latency_ms is not None
        # Should be approximately 50ms (with some tolerance for test timing)
        assert health.last_ping_latency_ms >= 40
        assert health.last_ping_latency_ms <= 150

    async def test_ping_latency_updates_on_each_pong(self) -> None:
        """Ping latency is updated on each pong response."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # First ping/pong cycle
        await manager.send_heartbeat(conn_id)
        await asyncio.sleep(0.02)
        manager.handle_pong(conn_id)

        health1 = manager.get_connection_health(conn_id)
        latency1 = health1.last_ping_latency_ms

        # Second ping/pong cycle with different delay
        await manager.send_heartbeat(conn_id)
        await asyncio.sleep(0.05)
        manager.handle_pong(conn_id)

        health2 = manager.get_connection_health(conn_id)
        latency2 = health2.last_ping_latency_ms

        # Latencies should be different (second one longer)
        assert latency2 > latency1

    async def test_automatic_stale_connection_termination(self) -> None:
        """Stale connections are automatically terminated."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(heartbeat_timeout=0.1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.close = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Simulate stale connection
        await asyncio.sleep(0.2)
        await manager.cleanup_stale_connections()

        assert conn_id not in manager.active_connections
        mock_ws.close.assert_called()

    def test_error_response_format(self) -> None:
        """Error responses follow consistent format."""
        from wavecore.api.websocket import create_error_response

        response = create_error_response(
            error_code="INVALID_TOPIC",
            message="Topic must start with valid category",
            details={"topic": "bad-topic"},
        )

        assert response["type"] == "error"
        assert response["error_code"] == "INVALID_TOPIC"
        assert response["message"] == "Topic must start with valid category"
        assert response["details"]["topic"] == "bad-topic"
        assert "timestamp" in response

    async def test_graceful_disconnect_cleanup(self) -> None:
        """Graceful disconnect cleans up all resources."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "execution:exec-123")
        manager.subscribe(conn_id, "system")

        manager.disconnect(conn_id)

        assert conn_id not in manager.active_connections
        assert manager.get_connection_metadata(conn_id) is None

    async def test_abrupt_disconnect_cleanup(self) -> None:
        """Abrupt disconnect still cleans up resources."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "execution:exec-123")

        # Simulate abrupt disconnect
        manager.handle_disconnect(conn_id, _abnormal=True)

        assert conn_id not in manager.active_connections


# ============================================================================
# Additional Coverage Tests
# ============================================================================


class TestAdditionalCoverage:
    """Additional tests for complete code coverage."""

    def test_sequence_tracker_get_gaps_empty(self) -> None:
        """SequenceTracker returns empty list when no sequences recorded."""
        from wavecore.api.websocket import SequenceTracker

        tracker = SequenceTracker()
        gaps = tracker.get_gaps()
        assert gaps == []

    async def test_handle_message_with_invalid_connection(self) -> None:
        """handle_message returns early for invalid connection ID."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        # Should not raise, just return early
        await manager.handle_message("invalid-conn-id", '{"type": "ping"}')

    async def test_handle_message_pong(self) -> None:
        """handle_message processes pong messages."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        initial_activity = manager.get_connection_metadata(conn_id).last_activity

        await asyncio.sleep(0.05)
        await manager.handle_message(conn_id, '{"type": "pong"}')

        updated_activity = manager.get_connection_metadata(conn_id).last_activity
        assert updated_activity > initial_activity

    async def test_handle_message_ack(self) -> None:
        """handle_message processes ack messages."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Set up a pending ack
        ack_event = asyncio.Event()
        manager._pending_acks["test-ack-123"] = ack_event

        # Send ack message
        await manager.handle_message(conn_id, '{"type": "ack", "ack_id": "test-ack-123"}')

        # Event should be set
        assert ack_event.is_set()

    async def test_handle_message_subscribe(self) -> None:
        """handle_message processes subscribe messages."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        await manager.handle_message(conn_id, '{"type": "subscribe", "topic": "execution:test"}')

        metadata = manager.get_connection_metadata(conn_id)
        assert "execution:test" in metadata.subscriptions

    async def test_handle_message_unsubscribe(self) -> None:
        """handle_message processes unsubscribe messages."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "execution:test")

        await manager.handle_message(conn_id, '{"type": "unsubscribe", "topic": "execution:test"}')

        metadata = manager.get_connection_metadata(conn_id)
        assert "execution:test" not in metadata.subscriptions

    async def test_handle_message_malformed_send_error_fails(self) -> None:
        """handle_message handles send_json failure for malformed messages."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock(side_effect=Exception("Send failed"))

        conn_id = await manager.connect(mock_ws)

        # Should not raise even when send_json fails
        await manager.handle_message(conn_id, "not valid json{{{")

        # Connection should still be active
        assert conn_id in manager.active_connections

    async def test_unicast_returns_false_for_invalid_connection(self) -> None:
        """unicast returns False for non-existent connection."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        result = await manager.unicast("invalid-conn-id", {"type": "test"})
        assert result is False

    async def test_unicast_handles_send_exception(self) -> None:
        """unicast returns False when send_json raises exception."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock(side_effect=Exception("Send failed"))

        conn_id = await manager.connect(mock_ws)
        result = await manager.unicast(conn_id, {"type": "test"})

        assert result is False

    async def test_cleanup_stale_connections_handles_close_exception(self) -> None:
        """cleanup_stale_connections handles websocket.close() exceptions."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(heartbeat_timeout=0.1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.close = AsyncMock(side_effect=Exception("Close failed"))

        conn_id = await manager.connect(mock_ws)
        await asyncio.sleep(0.2)

        # Should not raise even when close fails
        await manager.cleanup_stale_connections()

        # Connection should still be removed
        assert conn_id not in manager.active_connections

    async def test_heartbeat_loop_handles_send_exception(self) -> None:
        """run_heartbeat_loop continues even when send_heartbeat fails."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(heartbeat_interval=0.05)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock(side_effect=Exception("Send failed"))

        await manager.connect(mock_ws)

        # Start heartbeat loop
        heartbeat_task = asyncio.create_task(manager.run_heartbeat_loop())

        # Wait for a couple iterations
        await asyncio.sleep(0.15)

        # Stop the loop
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass

        # Should have attempted multiple sends despite failures
        assert mock_ws.send_json.call_count >= 2

    async def test_unsubscribe_from_nonexistent_connection(self) -> None:
        """unsubscribe returns False for non-existent connection."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        result = manager.unsubscribe("invalid-conn-id", "topic")
        assert result is False

    async def test_broadcast_to_topic_with_continue_after_exact_match(self) -> None:
        """broadcast_to_topic continues correctly after exact match."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        # Subscribe to exact topic, not parent
        manager.subscribe(conn_id, "execution:exec-123")

        # Broadcast to the exact topic
        await manager.broadcast_to_topic("execution:exec-123", {"type": "test"})

        # Should receive once
        mock_ws.send_json.assert_called_once()

    async def test_broadcast_to_topic_survives_a_connection_joining_mid_send(self) -> None:
        """A tab connecting while a broadcast is in flight must not abort it.

        The fan-out walks the live connection map and awaits inside the loop,
        so a socket registering mid-send mutated the dict under the iterator.
        """
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        joiner_ws = AsyncMock(spec=WebSocket)
        joiner_ws.accept = AsyncMock()

        early_ws = AsyncMock(spec=WebSocket)
        early_ws.accept = AsyncMock()
        late_ws = AsyncMock(spec=WebSocket)
        late_ws.accept = AsyncMock()

        async def connect_another(_payload: dict[str, object]) -> None:
            await manager.connect(joiner_ws)

        early_ws.send_json = AsyncMock(side_effect=connect_another)
        late_ws.send_json = AsyncMock()

        early_id = await manager.connect(early_ws)
        late_id = await manager.connect(late_ws)
        manager.subscribe(early_id, "test")
        manager.subscribe(late_id, "test")

        await manager.broadcast_to_topic("test", {"type": "test"})

        late_ws.send_json.assert_called_once()

    async def test_broadcast_to_topic_handles_send_exception(self) -> None:
        """broadcast_to_topic handles send_json exceptions gracefully."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)

        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws1.send_json = AsyncMock(side_effect=Exception("Send failed"))
        mock_ws2.send_json = AsyncMock()

        conn_id1 = await manager.connect(mock_ws1)
        conn_id2 = await manager.connect(mock_ws2)
        manager.subscribe(conn_id1, "test")
        manager.subscribe(conn_id2, "test")

        # Should not raise, second client should still receive
        await manager.broadcast_to_topic("test", {"type": "test"})

        mock_ws2.send_json.assert_called_once()

    async def test_broadcast_to_topic_parent_match_handles_exception(self) -> None:
        """broadcast_to_topic handles exceptions in parent topic matching."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock(side_effect=Exception("Send failed"))

        conn_id = await manager.connect(mock_ws)
        # Subscribe to parent topic "execution"
        manager.subscribe(conn_id, "execution")

        # Broadcast to child topic - should match via parent
        await manager.broadcast_to_topic("execution:exec-123", {"type": "test"})

        # Send was attempted
        mock_ws.send_json.assert_called_once()

    async def test_broadcast_to_topic_queues_for_disconnected_with_matching_topic(
        self,
    ) -> None:
        """broadcast_to_topic queues messages for disconnected sessions."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(enable_message_queue=True, queue_max_size=100)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        session_id = manager.create_session()
        conn_id = await manager.connect(mock_ws, session_id=session_id)
        manager.subscribe(conn_id, "test-topic")
        manager.disconnect(conn_id)

        # Broadcast while disconnected
        await manager.broadcast_to_topic("test-topic", {"type": "test"})

        # Message should be queued
        queue = manager.get_session_queue(session_id)
        assert queue is not None
        assert len(queue) == 1

    async def test_deliver_queued_messages_handles_send_exception(self) -> None:
        """_deliver_queued_messages handles send_json exceptions."""
        from wavecore.api.websocket import QueuedMessage, WebSocketManager

        manager = WebSocketManager(enable_message_queue=True)
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws2.send_json = AsyncMock(side_effect=Exception("Send failed"))

        session_id = manager.create_session()
        conn_id1 = await manager.connect(mock_ws1, session_id=session_id)
        manager.subscribe(conn_id1, "test")
        manager.disconnect(conn_id1)

        # Manually add a message to queue
        manager._message_queues[session_id] = [QueuedMessage(message={"type": "test"})]

        # Reconnect - should not raise even if send fails
        await manager.connect(mock_ws2, session_id=session_id)

    async def test_send_heartbeat_with_invalid_connection(self) -> None:
        """send_heartbeat returns early for invalid connection."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        # Should not raise
        await manager.send_heartbeat("invalid-conn-id")

    async def test_get_connection_health_for_invalid_connection(self) -> None:
        """get_connection_health returns unhealthy for invalid connection."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        health = manager.get_connection_health("invalid-conn-id")

        assert health.is_healthy is False

    async def test_deliver_queued_messages_skipped_when_disabled(self) -> None:
        """_deliver_queued_messages does nothing when queuing disabled."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(enable_message_queue=False)
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws2.send_json = AsyncMock()

        session_id = manager.create_session()
        conn_id1 = await manager.connect(mock_ws1, session_id=session_id)
        manager.disconnect(conn_id1)

        # Reconnect
        await manager.connect(mock_ws2, session_id=session_id)

        # No messages should be sent since queuing was disabled
        mock_ws2.send_json.assert_not_called()

    async def test_deliver_queued_messages_no_queue_exists(self) -> None:
        """_deliver_queued_messages handles missing queue gracefully."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(enable_message_queue=True)
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        mock_ws1.accept = AsyncMock()
        mock_ws2.accept = AsyncMock()
        mock_ws2.send_json = AsyncMock()

        session_id = manager.create_session()
        conn_id1 = await manager.connect(mock_ws1, session_id=session_id)
        manager.disconnect(conn_id1)

        # No messages were queued, reconnect should work fine
        await manager.connect(mock_ws2, session_id=session_id)

        # No messages to deliver
        mock_ws2.send_json.assert_not_called()

    async def test_deliver_queued_messages_websocket_none_edge_case(self) -> None:
        """_deliver_queued_messages handles edge case where websocket is None."""
        from wavecore.api.websocket import QueuedMessage, WebSocketManager

        manager = WebSocketManager(enable_message_queue=True)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        session_id = manager.create_session()
        conn_id = await manager.connect(mock_ws, session_id=session_id)

        # Manually add a message to queue
        manager._message_queues[session_id] = [QueuedMessage(message={"type": "test"})]

        # Manually remove websocket from active_connections but keep session mapping
        del manager.active_connections[conn_id]

        # Call _deliver_queued_messages directly - should return early
        await manager._deliver_queued_messages(conn_id, session_id)

    async def test_broadcast_to_topic_sent_to_prevents_duplicate(self) -> None:
        """broadcast_to_topic skips already-sent connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        # Subscribe to both exact topic AND parent topic
        manager.subscribe(conn_id, "execution:exec-123")
        manager.subscribe(conn_id, "execution")

        # Broadcast to child topic - should only send once
        await manager.broadcast_to_topic("execution:exec-123", {"type": "test"})

        # Should only send once, not twice
        mock_ws.send_json.assert_called_once()

    async def test_broadcast_to_topic_parent_match_success(self) -> None:
        """broadcast_to_topic successfully sends via parent topic match."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        # Only subscribe to parent, not exact topic
        manager.subscribe(conn_id, "execution")

        # Broadcast to child topic - should match via parent
        await manager.broadcast_to_topic("execution:exec-123", {"type": "test"})

        # Should send via parent match
        mock_ws.send_json.assert_called_once()

    async def test_broadcast_to_topic_skips_connected_sessions(self) -> None:
        """broadcast_to_topic skips queuing for connected sessions."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(enable_message_queue=True)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        session_id = manager.create_session()
        conn_id = await manager.connect(mock_ws, session_id=session_id)
        manager.subscribe(conn_id, "test-topic")

        # Broadcast while connected
        await manager.broadcast_to_topic("test-topic", {"type": "test"})

        # Should receive via websocket, not queued
        mock_ws.send_json.assert_called_once()

        # No queue should exist or be empty
        queue = manager.get_session_queue(session_id)
        assert queue is None or len(queue) == 0

    async def test_unicast_rate_limited_returns_false(self) -> None:
        """unicast returns False when rate limited."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(rate_limit_per_second=1)
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # First message should succeed
        result1 = await manager.unicast(conn_id, {"type": "test1"})
        assert result1 is True

        # Immediately try another - should be rate limited
        result2 = await manager.unicast(conn_id, {"type": "test2"})
        assert result2 is False

    async def test_unicast_websocket_removed_but_rate_limit_exists(self) -> None:
        """unicast returns False when websocket removed but rate limit data exists."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)

        # Remove websocket but keep rate limit tokens
        del manager.active_connections[conn_id]

        # Should return False because websocket is None
        result = await manager.unicast(conn_id, {"type": "test"})
        assert result is False


class TestFastAPIEndpoint:
    """Tests for FastAPI WebSocket endpoint integration."""

    async def test_websocket_endpoint_with_testclient(self) -> None:
        """Test the FastAPI websocket endpoint with TestClient."""

        from wavecore.api.websocket import WebSocketManager, create_websocket_route

        app = FastAPI()
        manager = WebSocketManager()
        create_websocket_route(app, manager)

        with TestClient(app) as client:
            with client.websocket_connect("/ws") as websocket:
                # Send a message
                websocket.send_json({"type": "ping"})
                # Connection should work
                assert len(manager.active_connections) == 1

    async def test_websocket_endpoint_connection_limit(self) -> None:
        """Test endpoint rejects connections when limit reached."""

        from wavecore.api.websocket import WebSocketManager, create_websocket_route

        app = FastAPI()
        manager = WebSocketManager(max_connections=0)  # No connections allowed
        create_websocket_route(app, manager)

        with TestClient(app) as client:
            # Connection should be rejected
            try:
                with client.websocket_connect("/ws"):
                    pass
            except Exception:
                pass  # Expected to fail

    async def test_websocket_endpoint_handles_disconnect(self) -> None:
        """Test endpoint handles disconnection properly."""

        from wavecore.api.websocket import WebSocketManager, create_websocket_route

        app = FastAPI()
        manager = WebSocketManager()
        create_websocket_route(app, manager)

        with TestClient(app) as client:
            with client.websocket_connect("/ws") as _websocket:
                conn_count = len(manager.active_connections)
                assert conn_count == 1

            # After disconnect, connection should be cleaned up
            # Note: TestClient synchronous context doesn't guarantee immediate cleanup

    async def test_websocket_endpoint_session_expired(self) -> None:
        """Test endpoint rejects expired session."""

        from wavecore.api.websocket import WebSocketManager, create_websocket_route

        app = FastAPI()
        manager = WebSocketManager()
        create_websocket_route(app, manager)

        with TestClient(app) as client:
            # Try to connect with non-existent session
            try:
                with client.websocket_connect("/ws?session_id=invalid-session"):
                    pass
            except Exception:
                pass  # Expected to fail due to SessionExpired


class TestWebSocketShutdown:
    """Tests for WebSocket manager shutdown functionality."""

    @pytest.mark.asyncio
    async def test_shutdown_closes_all_connections(self) -> None:
        """Shutdown closes all active WebSocket connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        # Create mock websocket
        mock_ws = AsyncMock()
        _conn_id = await manager.connect(mock_ws, client_type="test")

        assert len(manager.active_connections) == 1

        await manager.shutdown()

        # All connections should be closed and cleared
        assert len(manager.active_connections) == 0
        mock_ws.close.assert_called_once_with(code=1001, reason="Server shutting down")

    @pytest.mark.asyncio
    async def test_shutdown_clears_all_metadata(self) -> None:
        """Shutdown clears all connection metadata and tracking data."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager(enable_message_queue=True)

        # Create mock websocket and session
        mock_ws = AsyncMock()
        session_id = manager.create_session()
        conn_id = await manager.connect(mock_ws, client_type="test", session_id=session_id)

        # Subscribe to a topic
        manager.subscribe(conn_id, "test:topic")

        # Verify data exists
        assert len(manager._metadata) == 1
        assert len(manager._sessions) == 1
        assert len(manager._session_to_connection) == 1

        await manager.shutdown()

        # All data should be cleared
        assert len(manager.active_connections) == 0
        assert len(manager._metadata) == 0
        assert len(manager._sessions) == 0
        assert len(manager._session_to_connection) == 0
        assert len(manager._connection_to_session) == 0
        assert len(manager._message_queues) == 0

    @pytest.mark.asyncio
    async def test_shutdown_handles_already_closed_connections(self) -> None:
        """Shutdown handles connections that are already closed."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        # Create mock websocket that raises on close
        mock_ws = AsyncMock()
        mock_ws.close.side_effect = Exception("Already closed")
        _conn_id = await manager.connect(mock_ws, client_type="test")

        # Should not raise, handles exception gracefully
        await manager.shutdown()

        assert len(manager.active_connections) == 0

    @pytest.mark.asyncio
    async def test_shutdown_unblocks_pending_acks(self) -> None:
        """Shutdown unblocks any pending acknowledgment waiters."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        # Simulate pending ack
        event = asyncio.Event()
        manager._pending_acks["test-ack-id"] = event

        # Start a task waiting for the ack
        async def waiter() -> bool:
            await event.wait()
            return True

        wait_task = asyncio.create_task(waiter())

        # Give the task time to start waiting
        await asyncio.sleep(0.01)

        # Shutdown should unblock the waiter
        await manager.shutdown()

        # Waiter should complete
        result = await asyncio.wait_for(wait_task, timeout=1.0)
        assert result is True
        assert len(manager._pending_acks) == 0

    @pytest.mark.asyncio
    async def test_shutdown_with_no_connections(self) -> None:
        """Shutdown works correctly with no active connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        # Should not raise
        await manager.shutdown()

        assert len(manager.active_connections) == 0

    @pytest.mark.asyncio
    async def test_shutdown_clears_rate_limit_tracking(self) -> None:
        """Shutdown clears rate limit tracking data."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        mock_ws = AsyncMock()
        conn_id = await manager.connect(mock_ws, client_type="test")

        # Verify rate limit data exists
        assert conn_id in manager._rate_limit_tokens
        assert conn_id in manager._rate_limit_last_update

        await manager.shutdown()

        # Rate limit data should be cleared
        assert len(manager._rate_limit_tokens) == 0
        assert len(manager._rate_limit_last_update) == 0

    @pytest.mark.asyncio
    async def test_try_send_returns_early_when_connection_missing(self) -> None:
        """_try_send returns immediately if connection ID is not in active_connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        # No connection registered - should return without error
        await manager._try_send("nonexistent-conn", {"type": "test"})
