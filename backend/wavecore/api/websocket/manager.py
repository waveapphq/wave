"""WebSocket Server Implementation for REQ-5.2.5.1: Real-time updates.

Provides bidirectional, real-time communication between the WAVE backend
and connected clients enabling instant delivery of execution events,
status updates, and system notifications.
"""

import asyncio
import json
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, WebSocket

from wavecore.api.exceptions import (
    NotFoundException,
    ValidationException,
    WaveException,
)
from wavecore.api.websocket import session_registry
from wavecore.api.websocket.client_label import derive_client_label
from wavecore.core.utf8_text import unencodable_place

# ============================================================================
# Constants
# ============================================================================

_ERR_CONN_NOT_FOUND = "Connection not found"
_TZ_UTC_SUFFIX = "+00:00"
# Mirrors ownership.OWNERSHIP_TOPIC (the service module is imported lazily).
_OWNERSHIP_TOPIC = "workbench:draft"
# Log history pagination: initial subscribe sends the
# newest page; older pages are fetched on demand as the user scrolls up.
_INITIAL_HISTORY_PAGE_SIZE = 100
_HISTORY_PAGE_SIZE_MAX = 500


def _parse_composite_cursor(raw: Any) -> tuple[int, int | None] | None:
    """Parse a ``"<chronology_index>:<child_seq|x>"`` cursor into a
    tuple, or ``None`` when absent or malformed."""
    if not isinstance(raw, str) or ":" not in raw:
        return None
    idx_part, child_part = raw.rsplit(":", 1)
    try:
        child_seq = None if child_part == "x" else int(child_part)
        return int(idx_part), child_seq
    except ValueError:
        return None


def _format_composite_cursor(cursor: tuple[int, int | None] | None) -> str | None:
    if cursor is None:
        return None
    idx, child_seq = cursor
    return f"{idx}:{'x' if child_seq is None else child_seq}"


# ============================================================================
# Exceptions
# ============================================================================


class ConnectionLimitExceeded(WaveException):
    """Raised when maximum connection limit is reached."""

    status_code = 429
    error_code = "CONNECTION_LIMIT_EXCEEDED"

    def __init__(self, message: str = "Maximum connections reached") -> None:
        super().__init__(message)


class SessionExpired(WaveException):
    """Raised when attempting to use an expired session."""

    status_code = 401
    error_code = "SESSION_EXPIRED"

    def __init__(self, message: str = "Session expired") -> None:
        super().__init__(message)


class ConnectionNotFound(NotFoundException):
    """Raised when a connection ID is not found."""

    error_code = "CONNECTION_NOT_FOUND"

    def __init__(self, message: str = _ERR_CONN_NOT_FOUND) -> None:
        super().__init__(message)


# ============================================================================
# Dataclasses
# ============================================================================


@dataclass
class ConnectionMetadata:
    """Metadata for a WebSocket connection."""

    connection_id: str
    connected_at: datetime
    client_type: str = "unknown"
    subscriptions: set[str] = field(default_factory=set)
    last_activity: datetime = field(default_factory=lambda: datetime.now(UTC))
    ip: str = "unknown"
    client_label: str = "Browser"


@dataclass
class SessionData:
    """Session data for reconnection support."""

    session_id: str
    subscriptions: set[str] = field(default_factory=set)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    last_disconnected_at: datetime | None = None


@dataclass
class QueuedMessage:
    """A message queued for a disconnected session."""

    message: dict[str, Any]
    queued_at: datetime = field(default_factory=lambda: datetime.now(UTC))


# ============================================================================
# Helper Functions
# ============================================================================


def create_error_response(
    error_code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a standardized error response.

    Args:
        error_code: The error code.
        message: Human-readable error message.
        details: Additional error details.

    Returns:
        Error response dictionary.
    """
    response: dict[str, Any] = {
        "type": "error",
        "error_code": error_code,
        "message": message,
        "timestamp": datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z"),
    }
    if details:
        response["details"] = details
    return response


# ============================================================================
# WebSocket Manager
# ============================================================================


class WebSocketManager:
    """Manages WebSocket connections, subscriptions, and message delivery."""

    def __init__(
        self,
        heartbeat_interval: float = 30.0,
        heartbeat_timeout: float = 60.0,
        max_connections: int = 1000,
        session_expiration_seconds: float = 300.0,
        enable_message_queue: bool = False,
        queue_max_size: int = 1000,
        queue_expiration_seconds: float = 60.0,
    ) -> None:
        """Initialize the WebSocket manager.

        Args:
            heartbeat_interval: Seconds between heartbeat pings.
            heartbeat_timeout: Seconds before connection is considered stale.
            max_connections: Maximum number of concurrent connections.
            session_expiration_seconds: Session expiration time in seconds.
            enable_message_queue: Whether to queue messages for disconnected clients.
            queue_max_size: Maximum messages to queue per session.
            queue_expiration_seconds: Time before queued messages expire.
        """
        self.websocket_path = "/ws"
        self.heartbeat_interval = heartbeat_interval
        self.heartbeat_timeout = heartbeat_timeout
        self.max_connections = max_connections
        self.session_expiration_seconds = session_expiration_seconds
        self.enable_message_queue = enable_message_queue
        self.queue_max_size = queue_max_size
        self.queue_expiration_seconds = queue_expiration_seconds

        # Connection tracking
        self.active_connections: dict[str, WebSocket] = {}
        self._metadata: dict[str, ConnectionMetadata] = {}

        # Session management
        self._sessions: dict[str, SessionData] = {}
        self._session_to_connection: dict[str, str] = {}
        self._connection_to_session: dict[str, str] = {}

        # Message queuing
        self._message_queues: dict[str, list[QueuedMessage]] = {}

        # Log subscription levels: conn_id -> session_id -> level
        self._log_subscription_levels: dict[str, dict[str, str]] = {}

        # Workbench ownership: conn_id -> identified holder id
        self._connection_holders: dict[str, str] = {}
        # conn_id -> the page load that identified it (a reload keeps the holder id)
        self._connection_pages: dict[str, str | None] = {}

    def _generate_connection_id(self) -> str:
        """Generate a unique connection ID.

        Returns:
            UUID string for the connection.
        """
        return str(uuid.uuid4())

    @staticmethod
    def _client_host(websocket: WebSocket) -> str:
        """Origin IP of a connection, or 'unknown' when the client is unavailable."""
        client = getattr(websocket, "client", None)
        host = getattr(client, "host", None) if client is not None else None
        return host if isinstance(host, str) else "unknown"

    @staticmethod
    def _user_agent(websocket: WebSocket) -> str | None:
        """The connection's User-Agent header, or None when absent."""
        headers = getattr(websocket, "headers", None)
        if not isinstance(headers, Mapping):
            return None
        user_agent = headers.get("user-agent")
        return user_agent if isinstance(user_agent, str) else None

    def create_session(self) -> str:
        """Create a new session for reconnection support.

        Returns:
            UUID string for the session.
        """
        session_id = str(uuid.uuid4())
        self._sessions[session_id] = SessionData(session_id=session_id)
        return session_id

    async def connect(
        self,
        websocket: WebSocket,
        client_type: str = "unknown",
        session_id: str | None = None,
    ) -> str:
        """Accept a new WebSocket connection.

        Args:
            websocket: The WebSocket connection.
            client_type: Type of client (e.g., "dashboard", "cli").
            session_id: Optional session ID for reconnection.

        Returns:
            Connection ID.

        Raises:
            ConnectionLimitExceeded: If maximum connections reached.
            SessionExpired: If the session has expired.
        """
        if len(self.active_connections) >= self.max_connections:
            raise ConnectionLimitExceeded("Maximum connections reached")

        # Handle session reconnection
        subscriptions: set[str] = set()
        if session_id:
            if session_id not in self._sessions:
                raise SessionExpired("Session expired")
            session = self._sessions[session_id]
            subscriptions = session.subscriptions.copy()

        await websocket.accept()

        conn_id = self._generate_connection_id()
        self.active_connections[conn_id] = websocket
        self._metadata[conn_id] = ConnectionMetadata(
            connection_id=conn_id,
            connected_at=datetime.now(UTC),
            client_type=client_type,
            subscriptions=subscriptions,
            ip=self._client_host(websocket),
            client_label=derive_client_label(self._user_agent(websocket)),
        )

        # Link session to connection
        if session_id:
            self._session_to_connection[session_id] = conn_id
            self._connection_to_session[conn_id] = session_id
            # Deliver queued messages
            await self._deliver_queued_messages(conn_id, session_id)

        return conn_id

    async def _deliver_queued_messages(self, conn_id: str, session_id: str) -> None:
        """Deliver queued messages to a reconnected client.

        Args:
            conn_id: The connection ID.
            session_id: The session ID.
        """
        if not self.enable_message_queue:
            return

        if session_id not in self._message_queues:
            return

        websocket = self.active_connections.get(conn_id)
        if websocket is None:
            return

        now = datetime.now(UTC)
        queue = self._message_queues[session_id]
        valid_messages = [
            qm
            for qm in queue
            if (now - qm.queued_at).total_seconds() < self.queue_expiration_seconds
        ]

        for qm in valid_messages:
            try:
                await websocket.send_json(qm.message)
            except Exception:
                pass

        # Clear the queue
        self._message_queues[session_id] = []

    def disconnect(self, conn_id: str) -> None:
        """Disconnect a WebSocket connection.

        Args:
            conn_id: The connection ID to disconnect.
        """
        self._save_session_on_disconnect(conn_id)
        self._cleanup_connection_data(conn_id)

    def _save_session_on_disconnect(self, conn_id: str) -> None:
        """Persist subscriptions to session before disconnecting.

        Args:
            conn_id: The connection ID.
        """
        if conn_id not in self._connection_to_session:
            return

        session_id = self._connection_to_session[conn_id]
        if session_id in self._sessions:
            metadata = self._metadata.get(conn_id)
            if metadata:
                self._sessions[session_id].subscriptions = metadata.subscriptions.copy()
                self._sessions[session_id].last_disconnected_at = datetime.now(UTC)
        del self._connection_to_session[conn_id]
        if session_id in self._session_to_connection:
            del self._session_to_connection[session_id]

    def _cleanup_connection_data(self, conn_id: str) -> None:
        """Remove all tracking data for a connection.

        Args:
            conn_id: The connection ID.
        """
        self.active_connections.pop(conn_id, None)
        self._metadata.pop(conn_id, None)
        self._log_subscription_levels.pop(conn_id, None)
        self._connection_pages.pop(conn_id, None)
        holder_id = self._connection_holders.pop(conn_id, None)
        if holder_id is not None:
            from wavecore.api.services.workbench import ownership

            still_connected = self.has_live_connection(holder_id)
            ownership.on_connection_lost(holder_id, still_connected)
            if not still_connected:
                session_registry.remove_session(holder_id)
        self.refresh_draft_watchers()

    def has_live_connection(self, holder_id: str) -> bool:
        """True when a socket still registered on the manager carries this id."""
        return any(
            hid == holder_id and conn_id in self.active_connections
            for conn_id, hid in self._connection_holders.items()
        )

    def handle_disconnect(self, conn_id: str, _abnormal: bool = False) -> None:
        """Handle a disconnection (graceful or abrupt).

        Args:
            conn_id: The connection ID.
            _abnormal: Whether the disconnect was abnormal.
        """
        self.disconnect(conn_id)

    def get_connection_metadata(self, conn_id: str) -> ConnectionMetadata | None:
        """Get metadata for a connection.

        Args:
            conn_id: The connection ID.

        Returns:
            ConnectionMetadata or None if not found.
        """
        return self._metadata.get(conn_id)

    def get_stale_connections(self) -> list[str]:
        """Get list of stale connection IDs.

        Returns:
            List of connection IDs that are stale.
        """
        stale = []
        now = datetime.now(UTC)
        for conn_id, metadata in self._metadata.items():
            time_since_activity = (now - metadata.last_activity).total_seconds()
            if time_since_activity > self.heartbeat_timeout:
                stale.append(conn_id)
        return stale

    async def send_heartbeat(self, conn_id: str) -> None:
        """Send a heartbeat ping to a connection.

        Args:
            conn_id: The connection ID.
        """
        websocket = self.active_connections.get(conn_id)
        if websocket is None:
            return

        await websocket.send_json({"type": "ping"})

    def handle_pong(self, conn_id: str) -> None:
        """Handle a pong response from a client.

        Args:
            conn_id: The connection ID.
        """
        metadata = self._metadata.get(conn_id)
        if metadata:
            metadata.last_activity = datetime.now(UTC)

    async def cleanup_stale_connections(self) -> None:
        """Clean up all stale connections."""
        stale = self.get_stale_connections()
        for conn_id in stale:
            websocket = self.active_connections.get(conn_id)
            if websocket is not None:
                try:
                    await websocket.close()
                except Exception:
                    pass
            self.disconnect(conn_id)

    def cleanup_expired_sessions(self) -> None:
        """Clean up expired sessions."""
        now = datetime.now(UTC)
        expired = []
        for session_id, session in self._sessions.items():
            if session.last_disconnected_at:
                elapsed = (now - session.last_disconnected_at).total_seconds()
                if elapsed > self.session_expiration_seconds:
                    expired.append(session_id)

        for session_id in expired:
            del self._sessions[session_id]
            self._message_queues.pop(session_id, None)

    async def run_heartbeat_loop(self) -> None:
        """Run the heartbeat loop (sends periodic pings)."""
        while True:
            for conn_id in self.active_connections:
                try:
                    await self.send_heartbeat(conn_id)
                except Exception:
                    pass
            await asyncio.sleep(self.heartbeat_interval)

    async def run_stale_cleanup_loop(self) -> None:
        """Reap dead connections (and their browser-session rows) on a timer.

        Covers abrupt disconnects the socket-close path never detects, so a dead
        tab stops lingering in the WAVE Server roster.
        """
        while True:
            await self.cleanup_stale_connections()
            await asyncio.sleep(self.heartbeat_interval)

    # ========================================================================
    # Subscription Management
    # ========================================================================

    def subscribe(self, conn_id: str, topic: str) -> bool:
        """Subscribe a connection to a topic.

        Args:
            conn_id: The connection ID.
            topic: The topic to subscribe to.

        Returns:
            True if subscription succeeded.

        Raises:
            ConnectionNotFound: If connection doesn't exist.
        """
        if conn_id not in self._metadata:
            raise ConnectionNotFound(_ERR_CONN_NOT_FOUND)

        self._metadata[conn_id].subscriptions.add(topic)
        if topic == _OWNERSHIP_TOPIC:
            self.refresh_draft_watchers()
        return True

    def unsubscribe(self, conn_id: str, topic: str) -> bool:
        """Unsubscribe a connection from a topic.

        Args:
            conn_id: The connection ID.
            topic: The topic to unsubscribe from.

        Returns:
            True if was subscribed and now unsubscribed, False otherwise.
        """
        if conn_id not in self._metadata:
            return False

        subscriptions = self._metadata[conn_id].subscriptions
        if topic in subscriptions:
            subscriptions.remove(topic)
            if topic == _OWNERSHIP_TOPIC:
                self.refresh_draft_watchers()
            # Also remove log subscription level tracking
            if conn_id in self._log_subscription_levels:
                # Extract session_id from topic (log:{session_id})
                if topic.startswith("log:"):
                    session_id = topic[4:]
                    self._log_subscription_levels[conn_id].pop(session_id, None)
                    # Check if any other connections are still subscribed to this session
                    still_subscribed = any(
                        topic in m.subscriptions
                        for cid, m in self._metadata.items()
                        if cid != conn_id
                    )
                    if not still_subscribed:
                        from wavecore.api.services.log_streaming_service import (
                            unregister_session_manager,
                        )

                        unregister_session_manager(session_id)
            return True
        return False

    # ========================================================================
    # Log Subscription Management (V-CANVAS-01d)
    # ========================================================================

    async def subscribe_logs(self, conn_id: str, session_id: str, level: str = "INFO") -> None:
        """Subscribe a connection to a log topic with level filtering.

        Registers the subscription (topic + level), hooks the
        log-streaming manager in for live broadcasts, and pushes the
        newest page of history to the subscribing socket.

        Args:
            conn_id: The connection ID.
            session_id: The session ID to subscribe to logs for.
            level: Minimum log level to receive (DEBUG, INFO, WARN, ERROR, FATAL).

        Raises:
            ConnectionNotFound: If connection doesn't exist.
            ValidationException: If level is invalid.
        """
        from wavecore.api.services.executions._storage import _execution_storage
        from wavecore.api.services.log_streaming_service import register_session_manager

        self._validate_log_subscription(conn_id, level)

        topic = f"log:{session_id}"
        self._record_log_subscription(conn_id, session_id, topic, level)
        register_session_manager(session_id, self)

        websocket = self.active_connections.get(conn_id)
        if websocket is None:
            return

        if session_id in _execution_storage:
            await self._send_tracked_history(websocket, session_id, topic, level)
        else:
            await self._send_ephemeral_history(websocket, session_id, topic, level)

    def _validate_log_subscription(self, conn_id: str, level: str) -> None:
        """Verify the connection exists and the requested level is valid."""
        from wavecore.api.services.log_streaming_service import VALID_LOG_LEVELS

        if conn_id not in self._metadata:
            raise ConnectionNotFound(_ERR_CONN_NOT_FOUND)
        if level not in VALID_LOG_LEVELS:
            raise ValidationException(
                f"Invalid log level '{level}'. Must be one of: {', '.join(VALID_LOG_LEVELS)}"
            )

    def _record_log_subscription(
        self, conn_id: str, session_id: str, topic: str, level: str
    ) -> None:
        """Add the topic to the connection's subscription set and pin its
        minimum level."""
        self._metadata[conn_id].subscriptions.add(topic)
        if conn_id not in self._log_subscription_levels:
            self._log_subscription_levels[conn_id] = {}
        self._log_subscription_levels[conn_id][session_id] = level

    async def _send_tracked_history(
        self, websocket: WebSocket, session_id: str, topic: str, level: str
    ) -> None:
        """Push the newest page of a tracked execution's merged console to
        the subscribing socket. Silent on send failures so a flaky client
        doesn't break the rest of the subscribe flow."""
        from wavecore.api.services.log_streaming_service import (
            fetch_execution_logs,
            filter_logs_by_level,
        )

        entries, prev_cursor = fetch_execution_logs(session_id, None, _INITIAL_HISTORY_PAGE_SIZE)
        entries = filter_logs_by_level(entries, level)
        if not entries:
            return
        payload = {
            "entries": entries,
            "hasMore": prev_cursor is not None,
            "cursor": _format_composite_cursor(prev_cursor),
        }
        await self._emit_history_event(websocket, topic, payload)

    async def _send_ephemeral_history(
        self, websocket: WebSocket, session_id: str, topic: str, level: str
    ) -> None:
        """Push the newest page of an ephemeral session's in-memory log
        buffer (workbench viewer path)."""
        from wavecore.api.services.log_streaming_service import (
            filter_logs_by_level,
            get_logs,
        )

        existing_logs = get_logs(session_id)
        if not existing_logs:
            return
        filtered_logs = filter_logs_by_level(existing_logs, level)
        if not filtered_logs:
            return
        page = filtered_logs[-_INITIAL_HISTORY_PAGE_SIZE:]
        has_more = len(filtered_logs) > len(page)
        cursor = page[0].get("sequence") if page and has_more else None
        payload = {"entries": page, "hasMore": has_more, "cursor": cursor}
        await self._emit_history_event(websocket, topic, payload)

    async def _emit_history_event(
        self, websocket: WebSocket, topic: str, payload: dict[str, Any]
    ) -> None:
        """Envelope + send a history-page event, swallowing transient
        send errors from a closed/slow client."""
        event = {
            "type": "event",
            "topic": topic,
            "payload": payload,
            "timestamp": datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z"),
        }
        try:
            await websocket.send_json(event)
        except Exception:
            pass

    async def change_log_level(
        self, conn_id: str, session_id: str, new_level: str
    ) -> dict[str, Any]:
        """Change the log level for an existing subscription.

        When level changes to show more logs (e.g., INFO -> DEBUG), historical
        logs that were previously filtered are pushed to the client.

        Args:
            conn_id: The connection ID.
            session_id: The session ID.
            new_level: The new minimum log level.

        Returns:
            Acknowledgment dict with status and new_level.

        Raises:
            ValueError: If not subscribed to this session or level is invalid.
        """
        from wavecore.api.services import log_streaming_service
        from wavecore.api.services.log_streaming_service import (
            LOG_LEVEL_HIERARCHY,
            VALID_LOG_LEVELS,
        )

        if new_level not in VALID_LOG_LEVELS:
            raise ValidationException(
                f"Invalid log level '{new_level}'. "
                f"Must be one of: {', '.join(VALID_LOG_LEVELS)}"
            )

        topic = f"log:{session_id}"
        if conn_id not in self._metadata or topic not in self._metadata[conn_id].subscriptions:
            raise ValidationException(f"Not subscribed to log topic for session '{session_id}'")

        # Get old level for comparison
        old_level = self.get_log_subscription_level(conn_id, session_id)
        if old_level is None:
            raise ValidationException(f"Not subscribed to log topic for session '{session_id}'")

        old_severity = LOG_LEVEL_HIERARCHY[old_level]
        new_severity = LOG_LEVEL_HIERARCHY[new_level]

        # Update the level
        self._log_subscription_levels[conn_id][session_id] = new_level

        websocket = self.active_connections.get(conn_id)
        if websocket:
            # Send acknowledgment first
            ack = {
                "type": "level_change_ack",
                "session_id": session_id,
                "new_level": new_level,
                "timestamp": datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z"),
            }
            await websocket.send_json(ack)

            # If new level shows more logs, push historical logs that were filtered
            if new_severity < old_severity:
                # Get all logs and filter to find entries that are now visible
                # but weren't before
                all_logs = log_streaming_service.get_logs(session_id)
                newly_visible_logs = [
                    log
                    for log in all_logs
                    if LOG_LEVEL_HIERARCHY[log["level"]] >= new_severity
                    and LOG_LEVEL_HIERARCHY[log["level"]] < old_severity
                ]

                if newly_visible_logs:
                    # Send as historical_logs batch
                    historical_msg = {
                        "type": "historical_logs",
                        "payload": {
                            "session_id": session_id,
                            "logs": newly_visible_logs,
                        },
                        "timestamp": datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z"),
                    }
                    await websocket.send_json(historical_msg)

        return {"status": "acknowledged", "new_level": new_level}

    def get_log_subscription_level(self, conn_id: str, session_id: str) -> str | None:
        """Get the subscription level for a log topic.

        Args:
            conn_id: The connection ID.
            session_id: The session ID.

        Returns:
            The subscribed log level or None if not subscribed.
        """
        if conn_id not in self._log_subscription_levels:
            return None
        return self._log_subscription_levels[conn_id].get(session_id)

    # ========================================================================
    # Broadcasting
    # ========================================================================

    async def broadcast_to_topic(self, topic: str, message: dict[str, Any]) -> None:
        """Broadcast a message to all subscribers of a topic.

        Args:
            topic: The topic to broadcast to.
            message: The message to broadcast.
        """
        parent_topic = topic.split(":")[0] if ":" in topic else None

        # Snapshot: a tab connecting or closing mid-send mutates the live map.
        for conn_id, metadata in self._metadata.copy().items():
            if not self._is_subscribed(metadata, topic, parent_topic):
                continue
            await self._try_send(conn_id, message)

        self._queue_for_disconnected(topic, message)

    @staticmethod
    def _is_subscribed(
        metadata: ConnectionMetadata,
        topic: str,
        parent_topic: str | None,
    ) -> bool:
        """Check whether a connection is subscribed to a topic.

        Matches exact topic or parent category (e.g. "execution" matches
        "execution:id").

        Args:
            metadata: The connection metadata.
            topic: The full topic string.
            parent_topic: The parent category, or None if topic has no colon.

        Returns:
            True if subscribed.
        """
        if topic in metadata.subscriptions:
            return True
        return parent_topic is not None and parent_topic in metadata.subscriptions

    async def _try_send(self, conn_id: str, message: dict[str, Any]) -> None:
        """Attempt to send a message to a connection, ignoring failures.

        Args:
            conn_id: The connection ID.
            message: The message to send.
        """
        websocket = self.active_connections.get(conn_id)
        if websocket is None:
            return
        try:
            await websocket.send_json(message)
        except Exception:
            pass

    def _queue_for_disconnected(self, topic: str, message: dict[str, Any]) -> None:
        """Queue a message for disconnected sessions subscribed to this topic.

        Args:
            topic: The topic to match.
            message: The message to queue.
        """
        if not self.enable_message_queue:
            return

        for session_id, session in self._sessions.items():
            if session_id in self._session_to_connection:
                continue
            if topic in session.subscriptions:
                self._queue_message(session_id, message)

    async def handle_message(self, conn_id: str, raw_message: str) -> None:
        """Handle an incoming message from a client.

        Args:
            conn_id: The connection ID.
            raw_message: The raw message string.
        """
        websocket = self.active_connections.get(conn_id)
        if websocket is None:
            return

        try:
            message = json.loads(raw_message)
        except json.JSONDecodeError:
            await self._send_json_error(websocket)
            return
        where = unencodable_place(raw_message, message, "the message")
        if where is not None:
            await self._send_json_error(
                websocket,
                f"The message has a character at {where} that cannot be encoded as UTF-8, "
                "so it was refused: remove or replace it",
            )
            return

        msg_type = message.get("type")

        if msg_type == "pong":
            self.handle_pong(conn_id)
        elif msg_type in ("subscribe", "unsubscribe", "request_history") and "topic" in message:
            await self._dispatch_topic_frame(conn_id, websocket, msg_type, message)
        else:
            await self._dispatch_holder_frame(conn_id, websocket, message)

    async def _dispatch_topic_frame(
        self, conn_id: str, websocket: WebSocket, msg_type: str, message: dict[str, Any]
    ) -> None:
        """Route a topic-scoped frame (subscribe / unsubscribe / history)."""
        self._touch_browser_session(conn_id)
        if msg_type == "subscribe":
            await self._handle_subscribe(conn_id, websocket, message)
        elif msg_type == "unsubscribe":
            self.unsubscribe(conn_id, message["topic"])
        else:
            await self._handle_request_history(conn_id, websocket, message)

    async def _dispatch_holder_frame(
        self, conn_id: str, websocket: WebSocket, message: dict[str, Any]
    ) -> None:
        """Route a holder-identified frame; malformed frames drop silently."""
        msg_type = message.get("type")
        if msg_type == "identify" and "holderId" in message:
            await self._handle_identify(conn_id, websocket, message)
        elif msg_type == "leaving" and "holderId" in message:
            self._handle_leaving(conn_id, message["holderId"])
        elif msg_type == "draft_update" and "holderId" in message and "snapshot" in message:
            self._touch_browser_session(conn_id)
            await self._handle_draft_update(message)
        elif msg_type == "draft_state" and "holderId" in message and "dirty" in message:
            self._handle_draft_state(conn_id, message)

    async def _handle_subscribe(
        self,
        conn_id: str,
        websocket: WebSocket,
        message: dict[str, Any],
    ) -> None:
        """Process a subscribe message and send confirmation.

        Args:
            conn_id: The connection ID.
            websocket: The WebSocket connection.
            message: The parsed subscribe message.
        """
        topic = message["topic"]
        if topic.startswith("log:"):
            session_id = topic[4:]
            level = message.get("level", "DEBUG")
            await self.subscribe_logs(conn_id, session_id, level)
        else:
            self.subscribe(conn_id, topic)

        confirmation = {
            "type": "subscribed",
            "topic": topic,
            "timestamp": int(datetime.now(UTC).timestamp() * 1000),
        }
        try:
            await websocket.send_json(confirmation)
            if topic == _OWNERSHIP_TOPIC:
                await self._replay_shared_draft(websocket)
                await self._replay_run_state(websocket)
        except Exception:
            pass  # Connection might have closed

    async def _replay_shared_draft(self, websocket: WebSocket) -> None:
        """Replay the cached draft snapshot to a fresh draft-topic subscriber."""
        from wavecore.api.services.workbench import ownership

        if ownership.get_holder() is None:
            return  # no live holder: any cached draft is stale, never seed it
        shared = ownership.get_shared_draft()
        if shared is None:
            return
        await websocket.send_json(
            {
                "type": "event",
                "topic": _OWNERSHIP_TOPIC,
                "payload": shared,
                "timestamp": int(datetime.now(UTC).timestamp() * 1000),
            }
        )

    async def _replay_run_state(self, websocket: WebSocket) -> None:
        """Tell a fresh draft-topic subscriber about the announced run, if any.

        A run outlives its holder tab, so this replay is not gated on a holder.
        """
        from wavecore.api.services.workbench import ownership

        run = ownership.get_run_state()
        if run is None:
            return
        await websocket.send_json(
            {
                "type": "event",
                "topic": _OWNERSHIP_TOPIC,
                "payload": {"event": "run_state_changed", "run": run},
                "timestamp": int(datetime.now(UTC).timestamp() * 1000),
            }
        )

    async def _handle_draft_update(self, message: dict[str, Any]) -> None:
        """Relay the holder's draft snapshot to draft-topic mirrors.

        Non-holder frames are dropped silently.
        """
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.workbench import ownership

        try:
            payload = ownership.apply_draft(message["holderId"], message["snapshot"])
        except ConflictException:
            return
        envelope = {
            "type": "event",
            "topic": _OWNERSHIP_TOPIC,
            "payload": payload,
            "timestamp": int(datetime.now(UTC).timestamp() * 1000),
        }
        await self.broadcast_to_topic(_OWNERSHIP_TOPIC, envelope)

    def _handle_draft_state(self, conn_id: str, message: dict[str, Any]) -> None:
        """Record the holder's reported draft dirtiness; non-holder frames drop."""
        from wavecore.api.services.workbench import ownership

        self._touch_browser_session(conn_id)
        ownership.set_holder_dirty(message["holderId"], bool(message["dirty"]))

    def _handle_leaving(self, conn_id: str, holder_id: str) -> None:
        """Departure announced on the tab's own socket, in-order before its close.

        TCP ordering guarantees the away reservation is in place before the
        close is processed; the HTTP beacon cannot promise that.
        """
        from wavecore.api.services.workbench import ownership

        page_id = self._connection_pages.get(conn_id)
        if not self.is_current_page(holder_id, page_id):
            return
        ownership.mark_away(holder_id)
        session_registry.remove_session(holder_id)
        self.drop_draft_watcher(holder_id, page_id)

    def _touch_browser_session(self, conn_id: str) -> None:
        """Bump the browser-session row's last_activity for a meaningful frame."""
        holder_id = self._connection_holders.get(conn_id)
        if holder_id is not None:
            session_registry.touch_session(holder_id)

    async def _handle_identify(
        self, conn_id: str, websocket: WebSocket, message: dict[str, Any]
    ) -> None:
        """Register the identified tab as a browser session, rejecting tombstoned ids."""
        holder_id = message["holderId"]
        if session_registry.is_session_closed(holder_id):
            try:
                await websocket.close()
            except Exception:
                pass
            return
        metadata = self._metadata.get(conn_id)
        ip = metadata.ip if metadata is not None else "unknown"
        client_label = metadata.client_label if metadata is not None else "Browser"
        session_registry.register_session(holder_id, client_label, ip)
        self._connection_holders[conn_id] = holder_id
        page_id = message.get("pageId")
        self._connection_pages[conn_id] = page_id if isinstance(page_id, str) else None
        self.refresh_draft_watchers()

    async def terminate_session(self, session_id: str) -> None:
        """Send a session_terminated frame to every live socket bearing this id.

        A half-open prior connection can still hold the same id when a tab
        reconnects with its stable per-tab id, so notify all matches, not the first.
        """
        targets = [
            conn_id
            for conn_id, holder_id in self._connection_holders.items()
            if holder_id == session_id
        ]
        for conn_id in targets:
            websocket = self.active_connections.get(conn_id)
            if websocket is not None:
                try:
                    await websocket.send_json({"type": "session_terminated"})
                except Exception:
                    pass

    def draft_watcher_ids(self) -> set[str]:
        """Session ids currently subscribed to the draft topic (holder + mirrors)."""
        ids: set[str] = set()
        for conn_id, metadata in self._metadata.items():
            if _OWNERSHIP_TOPIC not in metadata.subscriptions:
                continue
            holder_id = self._connection_holders.get(conn_id)
            if holder_id is not None:
                ids.add(holder_id)
        return ids

    def refresh_draft_watchers(self) -> None:
        """Recount draft-topic mirrors, excluding the holder's own connection."""
        from wavecore.api.services.workbench import ownership

        holder = ownership.get_holder()
        holder_id = holder["id"] if holder is not None else None
        count = 0
        for conn_id, metadata in self._metadata.items():
            if _OWNERSHIP_TOPIC not in metadata.subscriptions:
                continue
            if holder_id is not None and self._connection_holders.get(conn_id) == holder_id:
                continue
            count += 1
        if count != ownership.get_ownership()["watchers"]:
            ownership.set_watchers(count)

    def is_current_page(self, holder_id: str, page_id: str | None) -> bool:
        """False once a socket of this tab belongs to a later page load than ``page_id``."""
        return all(
            self._connection_pages.get(conn_id) == page_id
            for conn_id, hid in self._connection_holders.items()
            if hid == holder_id
        )

    def drop_draft_watcher(self, holder_id: str, page_id: str | None) -> None:
        """Drop a closing page's draft-topic subscriptions and recount immediately.

        Called from the /leaving beacon so the watcher count (and the holder's
        pill) updates at once instead of waiting for the WS heartbeat to notice
        the dead socket.
        """
        for conn_id, hid in self._connection_holders.items():
            if hid == holder_id and self._connection_pages.get(conn_id) == page_id:
                self._metadata[conn_id].subscriptions.discard(_OWNERSHIP_TOPIC)
        self.refresh_draft_watchers()

    async def _handle_request_history(
        self,
        conn_id: str,
        websocket: WebSocket,
        message: dict[str, Any],
    ) -> None:
        """Send an older page of logs for a ``log:<session_id>`` topic.

        Routes tracked executions to the append-only per-test storage
        (``fetch_execution_logs``) and ephemeral sessions to the in-memory
        buffer. Two cursor shapes are supported:

        - Tracked: ``cursor`` is ``"<run_id>:<seq>"`` or ``null``; response
          payload includes ``prev_cursor`` in the same shape (``null``
          when the start of history has been reached).
        - Ephemeral: ``cursor`` is an integer sequence (legacy), kept so
          the Workbench viewer keeps working unchanged.
        """
        from wavecore.api.services.executions._storage import _execution_storage
        from wavecore.api.services.log_streaming_service import (
            filter_logs_by_level,
            get_logs,
        )

        topic = message["topic"]
        if not topic.startswith("log:"):
            return
        session_id = topic[4:]
        level = self.get_log_subscription_level(conn_id, session_id)
        if level is None:
            return

        raw_size = message.get("pageSize")
        page_size = (
            raw_size
            if isinstance(raw_size, int) and 0 < raw_size <= _HISTORY_PAGE_SIZE_MAX
            else _INITIAL_HISTORY_PAGE_SIZE
        )

        if session_id in _execution_storage:
            payload = self._tracked_history_page(session_id, message, level, page_size)
        else:
            payload = self._ephemeral_history_page(
                session_id, message, level, page_size, filter_logs_by_level, get_logs
            )

        history_event = {
            "type": "event",
            "topic": topic,
            "payload": payload,
            "timestamp": datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z"),
        }
        try:
            await websocket.send_json(history_event)
        except Exception:
            pass

    def _tracked_history_page(
        self,
        session_id: str,
        message: dict[str, Any],
        level: str,
        page_size: int,
    ) -> dict[str, Any]:
        """Reverse-walk the execution's ``runs.yaml`` to collect one page
        of merged logs older than ``cursor``."""
        from wavecore.api.services.log_streaming_service import (
            fetch_execution_logs,
            filter_logs_by_level,
        )

        cursor = _parse_composite_cursor(message.get("cursor"))
        entries, prev_cursor = fetch_execution_logs(session_id, cursor, page_size)
        entries = filter_logs_by_level(entries, level)
        return {
            "entries": entries,
            "hasMore": prev_cursor is not None,
            "cursor": _format_composite_cursor(prev_cursor),
        }

    def _ephemeral_history_page(
        self,
        session_id: str,
        message: dict[str, Any],
        level: str,
        page_size: int,
        filter_logs_by_level: Any,
        get_logs: Any,
    ) -> dict[str, Any]:
        raw_cursor = message.get("cursor")
        cursor = raw_cursor if isinstance(raw_cursor, int) else None
        filtered = filter_logs_by_level(get_logs(session_id), level)
        if cursor is not None:
            filtered = [e for e in filtered if e.get("sequence", -1) < cursor]
        page = filtered[-page_size:]
        has_more = len(filtered) > len(page)
        next_cursor = page[0].get("sequence") if page and has_more else None
        return {
            "entries": page,
            "hasMore": has_more,
            "cursor": next_cursor,
        }

    async def _send_json_error(
        self, websocket: WebSocket, message: str = "Invalid JSON format"
    ) -> None:
        """Tell the client its frame was refused: not valid JSON, or the reason given."""
        error_response = create_error_response(error_code="INVALID_MESSAGE", message=message)
        try:
            await websocket.send_json(error_response)
        except Exception:
            pass

    # ========================================================================
    # Message Queuing
    # ========================================================================

    def _queue_message(self, session_id: str, message: dict[str, Any]) -> None:
        """Queue a message for a disconnected session.

        Args:
            session_id: The session ID.
            message: The message to queue.
        """
        if session_id not in self._message_queues:
            self._message_queues[session_id] = []

        queue = self._message_queues[session_id]

        # Remove expired messages
        now = datetime.now(UTC)
        queue = [
            qm
            for qm in queue
            if (now - qm.queued_at).total_seconds() < self.queue_expiration_seconds
        ]

        # Enforce size limit (keep newest)
        if len(queue) >= self.queue_max_size:
            queue = queue[-(self.queue_max_size - 1) :]

        queue.append(QueuedMessage(message=message))
        self._message_queues[session_id] = queue

    def get_session_queue(self, session_id: str) -> list[QueuedMessage] | None:
        """Get the message queue for a session.

        Args:
            session_id: The session ID.

        Returns:
            List of queued messages or None.
        """
        return self._message_queues.get(session_id)

    async def shutdown(self) -> None:
        """Gracefully shut down the WebSocket manager.

        Closes all active connections, clears sessions, and releases resources.
        This should be called during application shutdown.
        """
        # Close all active WebSocket connections
        for websocket in self.active_connections.values():
            try:
                await websocket.close(code=1001, reason="Server shutting down")
            except Exception:
                pass  # Connection may already be closed

        # Clean up all connection data
        self.active_connections.clear()
        self._metadata.clear()
        self._log_subscription_levels.clear()

        # Clear session mappings
        self._session_to_connection.clear()
        self._connection_to_session.clear()

        # Clear sessions and queues (they won't be needed after shutdown)
        self._sessions.clear()
        self._message_queues.clear()


# ============================================================================
# FastAPI Integration
# ============================================================================


def create_websocket_route(app: FastAPI, manager: WebSocketManager) -> None:
    """Register the WebSocket route with a FastAPI application.

    Args:
        app: The FastAPI application.
        manager: The WebSocket manager.
    """

    @app.websocket("/ws")
    async def websocket_endpoint(
        websocket: WebSocket,
        client_type: str = "unknown",
        session_id: str | None = None,
    ) -> None:
        """WebSocket endpoint handler."""
        try:
            conn_id = await manager.connect(
                websocket, client_type=client_type, session_id=session_id
            )
        except (ConnectionLimitExceeded, SessionExpired) as e:
            await websocket.close(code=1008, reason=str(e))
            return

        try:
            while True:
                data = await websocket.receive_text()
                await manager.handle_message(conn_id, data)
        except Exception:
            manager.handle_disconnect(conn_id, _abnormal=True)
