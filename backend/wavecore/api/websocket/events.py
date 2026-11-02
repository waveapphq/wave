"""Fire-and-forget topic broadcasts for service code that is not itself a WS route."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

# Strong refs keep scheduled broadcasts alive until they complete.
_emit_tasks: set[asyncio.Task[None]] = set()


def emit(topic: str, event: dict[str, Any]) -> None:
    """Schedule a broadcast of one event; a caller with no running loop emits nothing."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(broadcast(topic, event))
    _emit_tasks.add(task)
    task.add_done_callback(_emit_tasks.discard)


async def broadcast(topic: str, event: dict[str, Any]) -> None:
    """Send one event envelope to a topic's subscribers; a failed send is logged, not raised."""
    try:
        from wavecore.api.app import app

        ws_manager = getattr(app.state, "ws_manager", None)
        if ws_manager:
            envelope = {
                "type": "event",
                "topic": topic,
                "payload": event,
                "timestamp": int(datetime.now(UTC).timestamp() * 1000),
            }
            await ws_manager.broadcast_to_topic(topic, envelope)
    except Exception as e:
        logger.warning("Failed to broadcast %s event: %s", topic, e)
