"""Per-run remote-worker registry (REQ-3.4.1.3).

Tracks every persistent remote worker a Remote Execution container opens
during a run so terminal cleanup can force-close any that leaked. Mirrors
SSHSessionRegistry (register / get / close / close_all + Connected-variable
flip), but each worker is a flat leaf riding one SSH session: no
parent-chain, no tunnels, so close is per-worker, not cascading. Teardown stops
the host before its session closes, so a worker still working leaves nothing
behind (REQ-3.2.2.4).
"""

import contextlib
from collections.abc import Callable, MutableMapping
from typing import Any

from wavecore.core.remote_exec.runner import stop_worker


class RemoteWorkerRegistry:
    """Live remote workers opened during a run, each riding one SSH session."""

    def __init__(self, push_variable: Callable[[str, Any], None] | None = None) -> None:
        self.push_variable = push_variable
        self._workers: dict[str, dict[str, Any]] = {}

    def register(
        self,
        remote_session_id: str,
        worker: Any,
        session_id: str,
        host: str,
        connected_var: str | None = None,
        variables: MutableMapping[str, Any] | None = None,
    ) -> None:
        """Record a live worker under its Remote Session ID handle."""
        self._workers[remote_session_id] = {
            "worker": worker,
            "session_id": session_id,
            "host": host,
            "connected_var": connected_var,
            "variables": variables,
        }

    def get(self, remote_session_id: str) -> dict[str, Any] | None:
        """Look up a live worker record."""
        return self._workers.get(remote_session_id)

    def close(self, remote_session_id: str) -> bool:
        """Tear down one worker; idempotent, best-effort. False when unknown."""
        record = self._workers.pop(remote_session_id, None)
        if record is None:
            return False
        self._close_record(record)
        return True

    def close_all(self) -> None:
        """Close every remaining worker (terminal cleanup), best-effort."""
        while self._workers:
            self.close(next(iter(self._workers)))

    def _close_record(self, record: dict[str, Any]) -> None:
        stop_worker(record["worker"])
        with contextlib.suppress(Exception):
            record["worker"].close()
        self._flip_connected(record)

    def _flip_connected(self, record: dict[str, Any]) -> None:
        """A closed worker's bound Connected variable reads false, silently."""
        connected_var = record["connected_var"]
        if not connected_var:
            return
        variables = record["variables"]
        if variables is not None:
            variables[connected_var] = False
        if self.push_variable is not None:
            self.push_variable(connected_var, False)
