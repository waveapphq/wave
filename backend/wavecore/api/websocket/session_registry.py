"""In-memory browser-session registry: rows keyed by the frontend session id.

Mirrors ``wavecore/mcp/state.py`` for browser sockets, with a remove/close split:
a normal disconnect removes the row and leaves no tombstone (auto-reconnect is
fine), while an admin close tombstones the id so a reconnect bearing it is rejected.
Wiped on process restart (no file/DB storage).
"""

from datetime import UTC, datetime
from typing import Any

_sessions: dict[str, dict[str, Any]] = {}
_closed_sessions: set[str] = set()


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def register_session(session_id: str, client: str, ip: str) -> None:
    """Record a connected browser session (connected_at == last_activity == now)."""
    now = _now_iso()
    _closed_sessions.discard(session_id)
    _sessions[session_id] = {
        "session_id": session_id,
        "client": client,
        "ip": ip,
        "connected_at": now,
        "last_activity": now,
    }


def touch_session(session_id: str) -> None:
    """Bump last_activity on a meaningful interaction; no-op for unknown ids."""
    session = _sessions.get(session_id)
    if session is not None:
        session["last_activity"] = _now_iso()


def remove_session(session_id: str) -> None:
    """Drop the row on a normal disconnect, leaving no tombstone."""
    _sessions.pop(session_id, None)


def close_session(session_id: str) -> bool:
    """Admin-terminate: drop the row and tombstone the id. False when unknown."""
    if session_id not in _sessions:
        return False
    del _sessions[session_id]
    _closed_sessions.add(session_id)
    return True


def is_session_closed(session_id: str) -> bool:
    return session_id in _closed_sessions


def list_sessions() -> list[dict[str, Any]]:
    return [dict(session) for session in _sessions.values()]


def disconnect_others(exclude: str | None = None) -> int:
    """Tombstone every session except ``exclude``; return the count terminated."""
    targets = [session_id for session_id in _sessions if session_id != exclude]
    for session_id in targets:
        close_session(session_id)
    return len(targets)


def disconnect_all() -> int:
    """Tombstone every session; return the count terminated."""
    return disconnect_others(exclude=None)


def clear_sessions() -> None:
    _sessions.clear()
    _closed_sessions.clear()
