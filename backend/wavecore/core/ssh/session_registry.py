"""Per-run SSH session registry (REQ-3.4.1.3)."""

import contextlib
import contextvars
from collections.abc import Callable, MutableMapping
from typing import Any


class SSHSessionRegistry:
    """Live SSH sessions opened during a run, parent-linked for multi-hop chains."""

    def __init__(self, push_variable: Callable[[str, Any], None] | None = None) -> None:
        self.push_variable = push_variable
        self._sessions: dict[str, dict[str, Any]] = {}
        # Each session closes in the context it opened in, so its Connected push names its scope.
        self._contexts: dict[str, contextvars.Context] = {}

    def register(
        self,
        session_id: str,
        connection: Any,
        parent_id: str | None,
        host: str,
        connected_var: str | None,
        monitor_task: Any | None,
        variables: MutableMapping[str, Any] | None = None,
        *,
        connect_timeout: float,
        host_identity: str | None = None,
    ) -> None:
        """Record a live session, its parent link and the host it identifies with (SSH-8)."""
        self._sessions[session_id] = {
            "connection": connection,
            "parent_id": parent_id,
            "host": host,
            "connected_var": connected_var,
            "monitor_task": monitor_task,
            "variables": variables,
            "tunnels": {},
            "connect_timeout": connect_timeout,
            "host_identity": host if host_identity is None else host_identity,
        }
        self._contexts[session_id] = contextvars.copy_context()

    def get(self, session_id: str) -> dict[str, Any] | None:
        """Look up a live session record."""
        return self._sessions.get(session_id)

    def add_tunnel(
        self,
        session_id: str,
        tunnel_id: str,
        listener: Any,
        local_port: int,
        remote_destination: str,
        held: tuple[Any, Any] | None = None,
    ) -> None:
        """Record a forwarded listener and any pair it holds (SSHTUN-7); no-op if it is gone."""
        record = self._sessions.get(session_id)
        if record is None:
            return
        record["tunnels"][tunnel_id] = {
            "listener": listener,
            "local_port": local_port,
            "remote_destination": remote_destination,
            "held": held,
        }

    def close_tunnel(self, tunnel_id: str) -> bool:
        """Close one forwarded listener by id, across sessions; False when unknown."""
        for record in self._sessions.values():
            tunnel = record["tunnels"].pop(tunnel_id, None)
            if tunnel is not None:
                _close_tunnel(tunnel)
                return True
        return False

    def find_tunnel_by_local_port(self, port: int) -> tuple[dict[str, Any], dict[str, Any]] | None:
        """The first open (session record, tunnel record) listening on `port`, else None."""
        for record in self._sessions.values():
            for tunnel in record["tunnels"].values():
                if tunnel["local_port"] == port:
                    return record, tunnel
        return None

    def close(self, session_id: str) -> list[str]:
        """Close the session and every descendant, child before parent; idempotent."""
        if session_id not in self._sessions:
            return []
        closed: list[str] = []
        children = [sid for sid, rec in self._sessions.items() if rec["parent_id"] == session_id]
        for child_id in children:
            closed.extend(self.close(child_id))
        record = self._sessions.pop(session_id)
        self._contexts.pop(session_id).run(self._close_record, record)
        closed.append(session_id)
        return closed

    def close_all(self) -> None:
        """Close every remaining session (terminal cleanup), best-effort."""
        while self._sessions:
            self.close(next(iter(self._sessions)))

    def _close_record(self, record: dict[str, Any]) -> None:
        task = record["monitor_task"]
        if task is not None:
            task.cancel()
        for tunnel in record["tunnels"].values():
            _close_tunnel(tunnel)
        record["tunnels"].clear()
        self._flip_connected(record)
        with contextlib.suppress(Exception):
            record["connection"].close()

    def _flip_connected(self, record: dict[str, Any]) -> None:
        """A closed session's bound Connected variable reads false, silently."""
        connected_var = record["connected_var"]
        if not connected_var:
            return
        variables = record["variables"]
        if variables is not None:
            variables[connected_var] = False
        if self.push_variable is not None:
            self.push_variable(connected_var, False)


def _close_tunnel(tunnel: dict[str, Any]) -> None:
    """Close a pair no client took, then the listener, each best-effort."""
    held = tunnel["held"]
    if held is not None:
        with contextlib.suppress(Exception):
            held[1].close()
    with contextlib.suppress(Exception):
        tunnel["listener"].close()
