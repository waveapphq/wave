"""In-memory MCP runtime state: until-restart flag, sessions, activity, last error."""

from collections import deque
from datetime import UTC, datetime
from typing import Any

_ACTIVITY_CAP = 50

_until_restart = False
_last_error: str | None = None
_sessions: dict[str, dict[str, Any]] = {}
_closed_sessions: set[str] = set()
_activity: deque[dict[str, Any]] = deque(maxlen=_ACTIVITY_CAP)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def set_until_restart(value: bool) -> None:
    global _until_restart
    _until_restart = bool(value)


def is_until_restart() -> bool:
    return _until_restart


def set_last_error(message: str | None) -> None:
    global _last_error
    _last_error = message


def get_last_error() -> str | None:
    return _last_error


def register_session(session_id: str, client: str, client_version: str, ip: str) -> None:
    """Record a newly initialized MCP session."""
    now = _now_iso()
    _closed_sessions.discard(session_id)
    _sessions[session_id] = {
        "session_id": session_id,
        "client": client,
        "client_version": client_version,
        "ip": ip,
        "connected_at": now,
        "last_activity": now,
    }


def touch_session(session_id: str, tool: str) -> None:
    """Bump the session's last_activity and append an activity entry."""
    now = _now_iso()
    session = _sessions.get(session_id)
    if session is not None:
        session["last_activity"] = now
    _activity.append(
        {
            "timestamp": now,
            "client": session["client"] if session is not None else "client",
            "tool": tool,
        }
    )


def mcp_holder_label(session_id: str) -> str:
    """Workbench holder label for an MCP session: '<client> (MCP)'."""
    session = _sessions.get(session_id)
    client = session["client"] if session is not None else "client"
    return f"{client} (MCP)"


def close_session(session_id: str) -> bool:
    """Invalidate a session; False when the id is unknown."""
    if session_id not in _sessions:
        return False
    del _sessions[session_id]
    _closed_sessions.add(session_id)
    return True


def is_session_closed(session_id: str) -> bool:
    return session_id in _closed_sessions


def list_sessions() -> list[dict[str, Any]]:
    return [dict(session) for session in _sessions.values()]


def get_activity() -> list[dict[str, Any]]:
    """Activity entries, newest first."""
    return [dict(entry) for entry in reversed(_activity)]


def clear_sessions() -> None:
    _sessions.clear()
    _closed_sessions.clear()


def clear_activity() -> None:
    _activity.clear()
