"""
RemoteWorkerRegistry contract tests (REQ-3.4.1.3).

The per-run remote-worker registry records every persistent remote worker
opened by a Remote Execution container during a workbench run: the live
worker handle, the SSH session it rides on, the remote host, and any
variable bound to a Connected output. It mirrors SSHSessionRegistry's
shape - register / get / close / close_all plus the Connected-variable
flip on close - because a remote worker is opened over, and torn down
with, an already-open SSH session.

The remote worker has no parent-chain or tunnel semantics (each worker is
a flat leaf riding one session), so close is per-worker, not cascading.
"""

from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock

from wavecore.core.remote_exec.worker_registry import RemoteWorkerRegistry


def _make_worker(closed_order: list[str] | None = None, worker_id: str = "") -> MagicMock:
    """A fake worker handle whose close() optionally records its id."""
    worker = MagicMock()
    if closed_order is not None:
        worker.close.side_effect = lambda: closed_order.append(worker_id)
    return worker


def _register(
    registry: RemoteWorkerRegistry,
    remote_session_id: str,
    worker: Any,
    session_id: str = "ssh-1",
    host: str = "prod-host",
    connected_var: str | None = None,
    variables: Any = None,
) -> None:
    registry.register(
        remote_session_id,
        worker,
        session_id,
        host,
        connected_var,
        variables=variables,
    )


class TestRegisterAndGet:
    """register / get - recording and looking up live remote workers."""

    def test_get_returns_registered_record(self) -> None:
        registry = RemoteWorkerRegistry()
        worker = MagicMock()
        _register(registry, "rw1", worker, session_id="ssh-9", host="node-1")

        record = registry.get("rw1")

        assert record is not None
        assert record["worker"] is worker
        assert record["session_id"] == "ssh-9"
        assert record["host"] == "node-1"
        assert record["connected_var"] is None

    def test_get_unknown_worker_returns_none(self) -> None:
        registry = RemoteWorkerRegistry()

        assert registry.get("nope") is None

    def test_record_carries_the_riding_session_id(self) -> None:
        registry = RemoteWorkerRegistry()
        _register(registry, "rw1", MagicMock(), session_id="ssh-host-42")

        record = registry.get("rw1")

        assert record is not None
        assert record["session_id"] == "ssh-host-42"


class TestClose:
    """close - single worker teardown, idempotency, best-effort."""

    def test_close_returns_true_for_a_live_worker(self) -> None:
        registry = RemoteWorkerRegistry()
        _register(registry, "rw1", MagicMock())

        assert registry.close("rw1") is True

    def test_close_calls_worker_close(self) -> None:
        registry = RemoteWorkerRegistry()
        worker = MagicMock()
        _register(registry, "rw1", worker)

        registry.close("rw1")

        worker.close.assert_called_once_with()

    def test_closed_worker_is_removed(self) -> None:
        registry = RemoteWorkerRegistry()
        _register(registry, "rw1", MagicMock())

        registry.close("rw1")

        assert registry.get("rw1") is None

    def test_close_unknown_worker_returns_false(self) -> None:
        registry = RemoteWorkerRegistry()

        assert registry.close("nope") is False

    def test_close_is_idempotent(self) -> None:
        registry = RemoteWorkerRegistry()
        _register(registry, "rw1", MagicMock())
        registry.close("rw1")

        assert registry.close("rw1") is False

    def test_close_survives_a_worker_close_error(self) -> None:
        registry = RemoteWorkerRegistry()
        worker = MagicMock()
        worker.close.side_effect = RuntimeError("already dead")
        _register(registry, "rw1", worker)

        assert registry.close("rw1") is True
        assert registry.get("rw1") is None


class TestCloseAll:
    """close_all - terminal cleanup drains the registry, best-effort."""

    def test_close_all_closes_every_worker(self) -> None:
        registry = RemoteWorkerRegistry()
        worker_a = MagicMock()
        worker_b = MagicMock()
        _register(registry, "a", worker_a)
        _register(registry, "b", worker_b)

        registry.close_all()

        worker_a.close.assert_called_once_with()
        worker_b.close.assert_called_once_with()
        assert registry.get("a") is None
        assert registry.get("b") is None

    def test_close_all_on_empty_registry_is_a_no_op(self) -> None:
        registry = RemoteWorkerRegistry()

        registry.close_all()

    def test_close_all_is_best_effort(self) -> None:
        registry = RemoteWorkerRegistry()
        bad_worker = MagicMock()
        bad_worker.close.side_effect = RuntimeError("boom")
        good_worker = MagicMock()
        _register(registry, "bad", bad_worker)
        _register(registry, "good", good_worker)

        registry.close_all()

        good_worker.close.assert_called_once_with()
        assert registry.get("bad") is None
        assert registry.get("good") is None


class TestConnectedFlip:
    """close / close_all - a closed worker's bound Connected variable reads false."""

    @staticmethod
    def _make_push() -> tuple[Callable[[str, Any], None], list[tuple[str, Any]]]:
        pushes: list[tuple[str, Any]] = []

        def _push(name: str, value: Any) -> None:
            pushes.append((name, value))

        return _push, pushes

    def test_close_flips_the_bound_connected_variable(self) -> None:
        push, pushes = self._make_push()
        registry = RemoteWorkerRegistry(push_variable=push)
        variables: dict[str, Any] = {"conn_ok": True}
        _register(registry, "rw1", MagicMock(), connected_var="conn_ok", variables=variables)

        registry.close("rw1")

        assert variables["conn_ok"] is False
        assert pushes == [("conn_ok", False)]

    def test_close_all_flips_remaining_connected_variables(self) -> None:
        push, pushes = self._make_push()
        registry = RemoteWorkerRegistry(push_variable=push)
        variables: dict[str, Any] = {"conn_ok": True}
        _register(registry, "rw1", MagicMock(), connected_var="conn_ok", variables=variables)

        registry.close_all()

        assert variables["conn_ok"] is False
        assert pushes == [("conn_ok", False)]

    def test_close_without_a_connected_var_flips_nothing(self) -> None:
        push, pushes = self._make_push()
        registry = RemoteWorkerRegistry(push_variable=push)
        variables: dict[str, Any] = {}
        _register(registry, "rw1", MagicMock(), connected_var=None, variables=variables)

        registry.close("rw1")

        assert variables == {}
        assert pushes == []

    def test_close_without_a_variables_mapping_still_pushes(self) -> None:
        push, pushes = self._make_push()
        registry = RemoteWorkerRegistry(push_variable=push)
        _register(registry, "rw1", MagicMock(), connected_var="conn_ok", variables=None)

        registry.close("rw1")

        assert pushes == [("conn_ok", False)]

    def test_close_without_a_push_hook_still_flips_the_variable(self) -> None:
        registry = RemoteWorkerRegistry()
        variables: dict[str, Any] = {"conn_ok": True}
        _register(registry, "rw1", MagicMock(), connected_var="conn_ok", variables=variables)

        registry.close("rw1")

        assert variables["conn_ok"] is False


class TestVariablePush:
    """push_variable - the run-scoped variable-push hook."""

    def test_push_variable_defaults_to_none(self) -> None:
        registry = RemoteWorkerRegistry()

        assert registry.push_variable is None

    def test_push_variable_holds_the_injected_callback(self) -> None:
        pushes: list[tuple[str, Any]] = []

        def _push(name: str, value: Any) -> None:
            pushes.append((name, value))

        registry = RemoteWorkerRegistry(push_variable=_push)

        assert registry.push_variable is _push
        registry.push_variable("conn_ok", False)
        assert pushes == [("conn_ok", False)]
