"""Variable push service with WebSocket throttling (REQ-3.1.3.12, REQ-3.2.2.18).

This module provides real-time variable change notifications via WebSocket
with intelligent throttling to prevent flooding during rapid updates.
"""

import asyncio
import json
import time
from datetime import UTC, datetime
from typing import Any

from wavecore.api.websocket.manager import WebSocketManager
from wavecore.core.table import Table
from wavecore.core.variables.wire_form import wire_scalar

_COMPLEX_VAR_TYPES = frozenset({"array", "map", "table"})


class VariablePushService:
    """Service for pushing variable changes to WebSocket subscribers.

    Implements per-variable throttling with last-value-wins semantics.
    Scalars are pushed with full values, complex types with summaries.
    """

    def __init__(self, manager: WebSocketManager, throttle_ms: int = 200) -> None:
        """Initialize the variable push service.

        Args:
            manager: WebSocket manager for broadcasting
            throttle_ms: Throttle window in milliseconds (default 200ms)
        """
        self._manager = manager
        self._throttle_ms = throttle_ms

        # Per-variable throttle state: {var_key: (last_push_time, pending_event, flush_task)}
        self._throttle_state: dict[
            str, tuple[float, dict[str, Any] | None, asyncio.Task[None] | None]
        ] = {}

    def _get_variable_key(self, event: dict[str, Any]) -> str:
        """Key a variable event by path, watch, scope and Function path (REQ-3.1.3.12)."""
        path = event.get("path", "")
        watch_id = event.get("watch_id", "")
        scope = json.dumps([event.get("scope"), list(event.get("function_path") or [])])
        return f"{watch_id}:{scope}:{path}"

    @staticmethod
    def _get_table_dimensions(value: Any) -> tuple[int, int]:
        """Extract row and column counts from a table value.

        Args:
            value: Table value - a Table instance, one of the two stored table
                forms (list of row maps, {columns, rows} dict), or other

        Returns:
            Tuple of (rows, cols), zeros when the value is not table-shaped
        """
        if isinstance(value, Table):
            return value.row_count(), value.col_count()
        if isinstance(value, dict):
            columns = value.get("columns")
            rows_data = value.get("rows")
            if isinstance(columns, list) and isinstance(rows_data, list):
                return len(rows_data), len(columns)
            return 0, 0
        if not isinstance(value, list):
            return 0, 0
        rows = len(value)
        if rows == 0:
            return 0, 0
        first_row = value[0]
        if isinstance(first_row, dict | list):
            return rows, len(first_row)
        return rows, 0

    def _summarize_complex_value(self, value: Any) -> dict[str, Any]:
        """Measure a complex value: the receiving row picks a count by its
        DECLARED type, which the push cannot see (REQ-3.2.2.18)."""
        rows, cols = self._get_table_dimensions(value)
        if isinstance(value, Table):
            count = value.row_count()
        elif isinstance(value, list | dict):
            count = len(value)
        else:
            count = 0
        return {"count": count, "rows": rows, "cols": cols, "changed": True}

    def _build_push_value(self, var_type: str, value: Any) -> Any:
        """Build the push value based on variable type.

        For scalars (string, integer, float, boolean, null): returns full value.
        For complex types (array, map, table): returns a summary dict.

        Args:
            var_type: The variable type string
            value: The raw variable value

        Returns:
            The transformed value to push to clients
        """
        if var_type in _COMPLEX_VAR_TYPES:
            return self._summarize_complex_value(value)
        # A scalar pushes whole, a number in its wire form (REQ-3.1.3.14).
        return wire_scalar(value)

    @staticmethod
    def _mask_event_value(event: dict[str, Any]) -> Any:
        """Mask the event value with the session's secret registry (REQ-3.1.3.5).

        Flagged names mask structurally; verbatim copies of registered
        values scrub; sessions without a registry pass values through raw.
        """
        from wavecore.api.services.workbench._common import _workbench_sessions
        from wavecore.core.secrets import masking_settings
        from wavecore.core.secrets.masking import mask_structure

        value = event.get("value")
        session = _workbench_sessions.get(str(event.get("watch_id", "")))
        registry = (session or {}).get("secret_registry")
        # The WS variable stream feeds the workbench Variable Manager panel and its
        # watchers, both governed by the test-variables reveal flag. Splitting into
        # per-surface streams so a masked surface never receives raw bytes is
        # server/multi-user hardening (a local single-user deployment has one
        # authorized viewer of this session topic).
        if registry is None or masking_settings.is_test_variables_revealed():
            return value
        name = str(event.get("path", ""))
        masked: Any = mask_structure({name: value}, registry)[name]
        return masked

    def _create_push_message(self, event: dict[str, Any]) -> dict[str, Any]:
        """Create a WebSocket push message from a variable change event.

        For scalars (string, integer, float, boolean, null): push full value
        For complex types (array, map, table): push summary

        Args:
            event: Variable change event

        Returns:
            Message to push to WebSocket clients
        """
        var_type = event.get("var_type", "string")
        push_value = self._build_push_value(var_type, self._mask_event_value(event))

        return {
            "type": event.get("type", "variable_changed"),
            "path": event.get("path"),
            "value": push_value,
            "var_type": var_type,
            "scope": event.get("scope"),
            "function_path": list(event.get("function_path") or []),
        }

    @staticmethod
    def _wrap_envelope(topic: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Wrap a message in the envelope format expected by the frontend WebSocket client.

        The frontend client dispatches only messages with type 'event' to topic
        handlers, so all broadcasts must use this envelope format.

        Args:
            topic: The WebSocket topic.
            payload: The message payload.

        Returns:
            Envelope dict with type, topic, payload, and timestamp.
        """
        return {
            "type": "event",
            "topic": topic,
            "payload": payload,
            "timestamp": int(datetime.now(UTC).timestamp() * 1000),
        }

    async def push_variable_change(self, event: dict[str, Any]) -> None:
        """Push a variable change to subscribed WebSocket clients.

        Implements throttling: max 1 push per variable per throttle window.
        Last value within the window wins (not first).

        Args:
            event: Variable change event from execution engine
        """
        var_key = self._get_variable_key(event)
        watch_id = event.get("watch_id", "")
        topic = f"variable:{watch_id}"

        current_time = time.monotonic()

        # Get current throttle state for this variable
        last_push_time, _, flush_task = self._throttle_state.get(var_key, (0.0, None, None))

        elapsed_ms = (current_time - last_push_time) * 1000

        if elapsed_ms >= self._throttle_ms:
            # Outside throttle window - push immediately
            message = self._create_push_message(event)
            envelope = self._wrap_envelope(topic, message)
            await self._manager.broadcast_to_topic(topic, envelope)
            self._throttle_state[var_key] = (current_time, None, None)
        else:
            # Inside throttle window - store as pending (last value wins)
            # If there's no pending flush task, create one
            if flush_task is None or flush_task.done():
                # Calculate remaining time in throttle window
                remaining_ms = self._throttle_ms - elapsed_ms
                flush_task = asyncio.create_task(
                    self._flush_pending(var_key, topic, remaining_ms / 1000)
                )

            # Store the event as pending (overwrites any previous pending)
            self._throttle_state[var_key] = (last_push_time, event, flush_task)

    async def close(self) -> None:
        """Cancel the pending flushes started on this event loop and forget the throttle state."""
        loop = asyncio.get_running_loop()
        pending = [
            task
            for _, _, task in self._throttle_state.values()
            if task is not None and task.get_loop() is loop
        ]
        self._throttle_state.clear()
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    async def _flush_pending(self, var_key: str, topic: str, delay_seconds: float) -> None:
        """Flush pending event after throttle delay.

        Args:
            var_key: Variable key
            topic: WebSocket topic
            delay_seconds: Delay before flushing
        """
        await asyncio.sleep(delay_seconds)

        # Get the pending event (may have been updated during sleep)
        state = self._throttle_state.get(var_key)
        if state is None:
            return

        _, pending_event, _ = state
        if pending_event is None:
            return

        # Push the pending event
        message = self._create_push_message(pending_event)
        envelope = self._wrap_envelope(topic, message)
        await self._manager.broadcast_to_topic(topic, envelope)

        # Update state: clear pending, update last push time
        self._throttle_state[var_key] = (time.monotonic(), None, None)
