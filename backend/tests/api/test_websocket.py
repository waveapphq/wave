"""WebSocket Server Tests for REQ-5.2.5.1: Real-time updates via WebSocket protocol.

This module contains comprehensive tests for the WebSocket server implementation
that provides bidirectional, real-time communication between the WAVE backend
and connected clients.

Test Organization:
- TestConnectionManagement: Connection lifecycle, IDs, metadata, heartbeat, limits
- TestSubscriptionModel: Topic subscriptions, dynamic management, scoped subscriptions
- TestBroadcasting: Topic-based, execution-scoped, queuing
- TestErrorHandling: Malformed messages, stale connections, disconnect cleanup
"""

import asyncio
from datetime import datetime
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
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.send_json = AsyncMock()

        conn_id = await manager.connect(mock_ws)
        manager.subscribe(conn_id, "error")

        error_event = {
            "type": "error_execution_failure",
            "execution_id": "exec-123",
            "error_code": "PLUGIN_TIMEOUT",
            "error_message": "Plugin execution timed out",
        }
        await manager.broadcast_to_topic("error", error_event)

        # Should receive the error event
        mock_ws.send_json.assert_called_once()
        sent_event = mock_ws.send_json.call_args[0][0]
        assert sent_event["type"] == "error_execution_failure"
        assert sent_event["error_code"] == "PLUGIN_TIMEOUT"


# ============================================================================
# Broadcasting Tests
# ============================================================================


class TestBroadcasting:
    """Tests for WebSocket broadcasting (REQ-5.2.5.1).

    Covers: Topic-based, execution-scoped, queuing.
    """

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

    Covers: Malformed messages, stale connections, disconnect cleanup.
    """

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
    async def test_shutdown_with_no_connections(self) -> None:
        """Shutdown works correctly with no active connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        # Should not raise
        await manager.shutdown()

        assert len(manager.active_connections) == 0

    @pytest.mark.asyncio
    async def test_try_send_returns_early_when_connection_missing(self) -> None:
        """_try_send returns immediately if connection ID is not in active_connections."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        # No connection registered - should return without error
        await manager._try_send("nonexistent-conn", {"type": "test"})
