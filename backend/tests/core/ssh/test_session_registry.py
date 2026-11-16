"""
SSHSessionRegistry contract tests (REQ-3.4.1.3).

The per-run registry records every live SSH session opened during a
workbench run: its connection, its parent link (multi-hop chains), the
variable bound to its Connected output, its keepalive monitor task, its
Connection Timeout and the host it identifies with. Closing a session
cascades to every descendant (child before parent), closes its tunnels
with any pair a tunnel still holds, and close_all() drains the registry
at run terminal, best-effort.
"""

import re
from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.core.ssh.session_registry import SSHSessionRegistry


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _make_conn(closed_order: list[str] | None = None, session_id: str = "") -> MagicMock:
    """A fake connection whose close() optionally records its session id."""
    conn = MagicMock()
    if closed_order is not None:
        conn.close.side_effect = lambda: closed_order.append(session_id)
    return conn


def _register(
    registry: SSHSessionRegistry,
    session_id: str,
    connection: Any,
    parent_id: str | None = None,
    host: str = "host-a",
    connected_var: str | None = None,
    monitor_task: Any | None = None,
) -> None:
    registry.register(
        session_id,
        connection,
        parent_id,
        host,
        connected_var,
        monitor_task,
        connect_timeout=30,
    )


class TestRegisterAndGet:
    """register / get - recording and looking up live sessions."""

    def test_get_returns_registered_record(self) -> None:
        registry = SSHSessionRegistry()
        conn = MagicMock()
        _register(registry, "s1", conn, host="node-1", connected_var="conn_ok")

        record = registry.get("s1")

        assert record is not None
        assert record["connection"] is conn
        assert record["parent_id"] is None
        assert record["host"] == "node-1"
        assert record["connected_var"] == "conn_ok"
        assert record["monitor_task"] is None

    def test_get_unknown_session_returns_none(self) -> None:
        registry = SSHSessionRegistry()

        assert registry.get("nope") is None

    def test_record_carries_parent_link(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "parent", MagicMock())
        _register(registry, "child", MagicMock(), parent_id="parent")

        record = registry.get("child")

        assert record is not None
        assert record["parent_id"] == "parent"

    def test_record_carries_monitor_task(self) -> None:
        registry = SSHSessionRegistry()
        task = MagicMock()
        _register(registry, "s1", MagicMock(), monitor_task=task)

        record = registry.get("s1")

        assert record is not None
        assert record["monitor_task"] is task


class TestRegisterKeepsTheSessionSettings:
    """register - the Connection Timeout and the host identity the tunnel messages use."""

    @pytest.mark.parametrize("timeout", [30, 1, 7, 0.05])
    def test_the_connect_timeout_is_stored_as_given(self, timeout: float) -> None:
        registry = SSHSessionRegistry()
        registry.register("s1", MagicMock(), None, "host-a", None, None, connect_timeout=timeout)

        record = registry.get("s1")

        assert record is not None
        assert record["connect_timeout"] == timeout
        assert type(record["connect_timeout"]) is type(timeout)

    def test_omitting_the_connect_timeout_is_a_type_error(self) -> None:
        registry = SSHSessionRegistry()

        with pytest.raises(
            TypeError,
            match=exact(
                "SSHSessionRegistry.register() missing 1 required keyword-only argument: "
                "'connect_timeout'"
            ),
        ):
            registry.register("s1", MagicMock(), None, "host-a", None, None)

        assert registry.get("s1") is None

    def test_the_connect_timeout_cannot_be_passed_by_position(self) -> None:
        registry = SSHSessionRegistry()

        with pytest.raises(
            TypeError,
            match=exact(
                "SSHSessionRegistry.register() takes from 7 to 8 positional arguments "
                "but 9 were given"
            ),
        ):
            registry.register("s1", MagicMock(), None, "host-a", None, None, None, 30)

        assert registry.get("s1") is None

    def test_the_host_identity_is_stored_beside_the_host(self) -> None:
        registry = SSHSessionRegistry()
        registry.register(
            "s1",
            MagicMock(),
            None,
            "127.0.0.1",
            None,
            None,
            connect_timeout=30,
            host_identity="db.internal",
        )

        record = registry.get("s1")

        assert record is not None
        assert record["host"] == "127.0.0.1"
        assert record["host_identity"] == "db.internal"

    def test_an_omitted_host_identity_is_the_host(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock(), host="node-1")

        record = registry.get("s1")

        assert record is not None
        assert record["host_identity"] == "node-1"

    def test_a_none_host_identity_is_the_host(self) -> None:
        registry = SSHSessionRegistry()
        registry.register(
            "s1", MagicMock(), None, "node-1", None, None, connect_timeout=30, host_identity=None
        )

        record = registry.get("s1")

        assert record is not None
        assert record["host_identity"] == "node-1"


class TestClose:
    """close - single close, cascade to descendants, idempotency."""

    def test_close_returns_the_closed_id(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())

        assert registry.close("s1") == ["s1"]

    def test_close_calls_connection_close(self) -> None:
        registry = SSHSessionRegistry()
        conn = MagicMock()
        _register(registry, "s1", conn)

        registry.close("s1")

        conn.close.assert_called_once_with()

    def test_closed_session_is_removed(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())

        registry.close("s1")

        assert registry.get("s1") is None

    def test_close_unknown_session_returns_empty_list(self) -> None:
        registry = SSHSessionRegistry()

        assert registry.close("nope") == []

    def test_close_is_idempotent(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.close("s1")

        assert registry.close("s1") == []

    def test_close_cancels_the_monitor_task(self) -> None:
        registry = SSHSessionRegistry()
        task = MagicMock()
        _register(registry, "s1", MagicMock(), monitor_task=task)

        registry.close("s1")

        task.cancel.assert_called_once_with()

    def test_close_without_monitor_task_needs_no_cancel(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock(), monitor_task=None)

        assert registry.close("s1") == ["s1"]

    def test_close_survives_a_connection_close_error(self) -> None:
        registry = SSHSessionRegistry()
        conn = MagicMock()
        conn.close.side_effect = RuntimeError("already dead")
        _register(registry, "s1", conn)

        assert registry.close("s1") == ["s1"]
        assert registry.get("s1") is None


class TestCascadeClose:
    """close - a session's descendants close with it, child before parent."""

    def test_three_node_chain_closes_child_before_parent(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "a", MagicMock())
        _register(registry, "b", MagicMock(), parent_id="a")
        _register(registry, "c", MagicMock(), parent_id="b")

        assert registry.close("a") == ["c", "b", "a"]

    def test_cascade_closes_every_descendant_connection(self) -> None:
        registry = SSHSessionRegistry()
        order: list[str] = []
        _register(registry, "a", _make_conn(order, "a"))
        _register(registry, "b", _make_conn(order, "b"), parent_id="a")
        _register(registry, "c", _make_conn(order, "c"), parent_id="b")

        registry.close("a")

        assert order == ["c", "b", "a"]
        assert registry.get("a") is None
        assert registry.get("b") is None
        assert registry.get("c") is None

    def test_branched_tree_closes_children_before_the_parent(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "a", MagicMock())
        _register(registry, "b1", MagicMock(), parent_id="a")
        _register(registry, "b2", MagicMock(), parent_id="a")

        closed = registry.close("a")

        assert set(closed) == {"a", "b1", "b2"}
        assert closed[-1] == "a"

    def test_closing_a_mid_chain_session_spares_its_ancestors(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "a", MagicMock())
        _register(registry, "b", MagicMock(), parent_id="a")
        _register(registry, "c", MagicMock(), parent_id="b")

        assert registry.close("b") == ["c", "b"]
        assert registry.get("a") is not None

    def test_cascade_cancels_descendant_monitor_tasks(self) -> None:
        registry = SSHSessionRegistry()
        parent_task = MagicMock()
        child_task = MagicMock()
        _register(registry, "a", MagicMock(), monitor_task=parent_task)
        _register(registry, "b", MagicMock(), parent_id="a", monitor_task=child_task)

        registry.close("a")

        parent_task.cancel.assert_called_once_with()
        child_task.cancel.assert_called_once_with()


class TestCloseAll:
    """close_all - terminal cleanup drains the registry, best-effort."""

    def test_close_all_closes_every_session(self) -> None:
        registry = SSHSessionRegistry()
        conn_a = MagicMock()
        conn_b = MagicMock()
        _register(registry, "a", conn_a)
        _register(registry, "b", conn_b)

        registry.close_all()

        conn_a.close.assert_called_once_with()
        conn_b.close.assert_called_once_with()
        assert registry.get("a") is None
        assert registry.get("b") is None

    def test_close_all_on_empty_registry_is_a_no_op(self) -> None:
        registry = SSHSessionRegistry()

        registry.close_all()

    def test_close_all_closes_child_before_parent(self) -> None:
        registry = SSHSessionRegistry()
        order: list[str] = []
        _register(registry, "a", _make_conn(order, "a"))
        _register(registry, "b", _make_conn(order, "b"), parent_id="a")

        registry.close_all()

        assert order.index("b") < order.index("a")

    def test_close_all_is_best_effort(self) -> None:
        registry = SSHSessionRegistry()
        bad_conn = MagicMock()
        bad_conn.close.side_effect = RuntimeError("boom")
        good_conn = MagicMock()
        _register(registry, "bad", bad_conn)
        _register(registry, "good", good_conn)

        registry.close_all()

        good_conn.close.assert_called_once_with()
        assert registry.get("bad") is None
        assert registry.get("good") is None


class TestConnectedFlip:
    """close / close_all - a closed session's bound Connected variable reads false."""

    @staticmethod
    def _make_push() -> tuple[Callable[[str, Any], None], list[tuple[str, Any]]]:
        pushes: list[tuple[str, Any]] = []

        def _push(name: str, value: Any) -> None:
            pushes.append((name, value))

        return _push, pushes

    def test_close_flips_the_bound_connected_variable(self) -> None:
        push, pushes = self._make_push()
        registry = SSHSessionRegistry(push_variable=push)
        variables: dict[str, Any] = {"conn_ok": True}
        registry.register(
            "s1",
            MagicMock(),
            None,
            "node-1",
            "conn_ok",
            None,
            variables=variables,
            connect_timeout=30,
        )

        registry.close("s1")

        assert variables["conn_ok"] is False
        assert pushes == [("conn_ok", False)]

    def test_cascade_close_flips_descendant_connected_variables(self) -> None:
        push, pushes = self._make_push()
        registry = SSHSessionRegistry(push_variable=push)
        variables: dict[str, Any] = {"parent_ok": True, "child_ok": True}
        registry.register(
            "parent",
            MagicMock(),
            None,
            "bastion",
            "parent_ok",
            None,
            variables=variables,
            connect_timeout=30,
        )
        registry.register(
            "child",
            MagicMock(),
            "parent",
            "node-1",
            "child_ok",
            None,
            variables=variables,
            connect_timeout=30,
        )

        registry.close("parent")

        assert variables["parent_ok"] is False
        assert variables["child_ok"] is False
        assert pushes == [("child_ok", False), ("parent_ok", False)]

    def test_close_all_flips_remaining_connected_variables(self) -> None:
        push, pushes = self._make_push()
        registry = SSHSessionRegistry(push_variable=push)
        variables: dict[str, Any] = {"conn_ok": True}
        registry.register(
            "s1",
            MagicMock(),
            None,
            "node-1",
            "conn_ok",
            None,
            variables=variables,
            connect_timeout=30,
        )

        registry.close_all()

        assert variables["conn_ok"] is False
        assert pushes == [("conn_ok", False)]

    def test_close_without_a_connected_var_flips_nothing(self) -> None:
        push, pushes = self._make_push()
        registry = SSHSessionRegistry(push_variable=push)
        variables: dict[str, Any] = {}
        registry.register(
            "s1", MagicMock(), None, "node-1", None, None, variables=variables, connect_timeout=30
        )

        registry.close("s1")

        assert variables == {}
        assert pushes == []

    def test_close_without_a_variables_mapping_still_pushes(self) -> None:
        push, pushes = self._make_push()
        registry = SSHSessionRegistry(push_variable=push)
        registry.register("s1", MagicMock(), None, "node-1", "conn_ok", None, connect_timeout=30)

        registry.close("s1")

        assert pushes == [("conn_ok", False)]

    def test_close_without_a_push_hook_still_flips_the_variable(self) -> None:
        registry = SSHSessionRegistry()
        variables: dict[str, Any] = {"conn_ok": True}
        registry.register(
            "s1",
            MagicMock(),
            None,
            "node-1",
            "conn_ok",
            None,
            variables=variables,
            connect_timeout=30,
        )

        registry.close("s1")

        assert variables["conn_ok"] is False


class TestVariablePush:
    """push_variable - the run-scoped variable-push hook the monitor uses."""

    def test_push_variable_defaults_to_none(self) -> None:
        registry = SSHSessionRegistry()

        assert registry.push_variable is None

    def test_push_variable_holds_the_injected_callback(self) -> None:
        pushes: list[tuple[str, Any]] = []

        def _push(name: str, value: Any) -> None:
            pushes.append((name, value))

        registry = SSHSessionRegistry(push_variable=_push)

        assert registry.push_variable is _push
        registry.push_variable("conn_ok", False)
        assert pushes == [("conn_ok", False)]


class TestRegisterSeedsTunnels:
    """register - each new session record carries an empty tunnels map."""

    def test_register_seeds_an_empty_tunnels_map(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())

        record = registry.get("s1")

        assert record is not None
        assert record["tunnels"] == {}


class TestAddTunnel:
    """add_tunnel - a forwarded listener is recorded under its owning session."""

    def test_add_tunnel_attaches_the_listener_to_the_session(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener = MagicMock()

        assert registry.add_tunnel("s1", "t1", listener, 19446, "127.0.0.1:9446") is True

        listener.close.assert_not_called()
        tunnels = registry.get("s1")["tunnels"]
        assert "t1" in tunnels
        assert tunnels["t1"]["listener"] is listener
        assert tunnels["t1"]["local_port"] == 19446
        assert tunnels["t1"]["remote_destination"] == "127.0.0.1:9446"

    def test_add_tunnel_supports_multiple_tunnels_per_session(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())

        registry.add_tunnel("s1", "t1", MagicMock(), 1, "a:1")
        registry.add_tunnel("s1", "t2", MagicMock(), 2, "b:2")

        assert set(registry.get("s1")["tunnels"]) == {"t1", "t2"}

    def test_add_tunnel_to_a_closed_session_closes_the_tunnel_and_returns_false(self) -> None:
        """No listener outlives its session, even one bound while the session closed."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.close("s1")
        listener = MagicMock()
        held = _held_pair()

        assert registry.add_tunnel("s1", "t1", listener, 1, "a:1", held=held) is False

        listener.close.assert_called_once_with()
        held[1].close.assert_called_once_with()
        assert registry.get("s1") is None
        assert registry.find_tunnel_by_local_port(1) is None

    def test_a_tunnel_holds_no_pair_by_default(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())

        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "db:5432")

        assert registry.get("s1")["tunnels"]["t1"]["held"] is None

    def test_add_tunnel_keeps_the_pair_validate_target_holds(self) -> None:
        """The very pair, so the first client takes that channel (SSHTUN-7)."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        held = _held_pair()

        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "db:5432", held=held)

        assert registry.get("s1")["tunnels"]["t1"]["held"] is held


class TestCloseTunnel:
    """close_tunnel - close one forwarded listener by id, across sessions."""

    def test_close_tunnel_closes_the_listener_and_returns_true(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener = MagicMock()
        registry.add_tunnel("s1", "t1", listener, 19446, "127.0.0.1:9446")

        assert registry.close_tunnel("t1") is True
        listener.close.assert_called_once_with()

    def test_closed_tunnel_is_removed_from_the_session(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "127.0.0.1:9446")

        registry.close_tunnel("t1")

        assert registry.get("s1")["tunnels"] == {}

    def test_close_tunnel_finds_a_tunnel_in_any_session(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        _register(registry, "s2", MagicMock())
        listener = MagicMock()
        registry.add_tunnel("s2", "t1", listener, 19446, "127.0.0.1:9446")

        assert registry.close_tunnel("t1") is True
        listener.close.assert_called_once_with()

    def test_close_tunnel_unknown_returns_false(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())

        assert registry.close_tunnel("nope") is False

    def test_close_tunnel_is_idempotent(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "127.0.0.1:9446")

        assert registry.close_tunnel("t1") is True
        assert registry.close_tunnel("t1") is False

    def test_close_tunnel_survives_a_listener_close_error(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener = MagicMock()
        listener.close.side_effect = RuntimeError("already dead")
        registry.add_tunnel("s1", "t1", listener, 19446, "127.0.0.1:9446")

        assert registry.close_tunnel("t1") is True
        assert registry.get("s1")["tunnels"] == {}


class TestTunnelCascade:
    """close / close_all - a session's tunnels close with the session."""

    def test_closing_a_session_closes_its_tunnel_listeners(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener = MagicMock()
        registry.add_tunnel("s1", "t1", listener, 19446, "127.0.0.1:9446")

        registry.close("s1")

        listener.close.assert_called_once_with()

    def test_cascade_close_closes_descendant_tunnel_listeners(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "parent", MagicMock())
        _register(registry, "child", MagicMock(), parent_id="parent")
        listener = MagicMock()
        registry.add_tunnel("child", "t1", listener, 19446, "127.0.0.1:9446")

        registry.close("parent")

        listener.close.assert_called_once_with()

    def test_close_all_closes_tunnel_listeners(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener = MagicMock()
        registry.add_tunnel("s1", "t1", listener, 19446, "127.0.0.1:9446")

        registry.close_all()

        listener.close.assert_called_once_with()

    def test_closing_a_session_survives_a_tunnel_listener_close_error(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener = MagicMock()
        listener.close.side_effect = RuntimeError("boom")
        registry.add_tunnel("s1", "t1", listener, 19446, "127.0.0.1:9446")

        assert registry.close("s1") == ["s1"]
        assert registry.get("s1") is None


def _held_pair() -> tuple[MagicMock, MagicMock]:
    """A (reader, writer) channel pair as Validate Target leaves it on its tunnel."""
    return MagicMock(), MagicMock()


def _held_tunnel(registry: SSHSessionRegistry) -> tuple[MagicMock, MagicMock]:
    """Session 's1' with tunnel 't1' holding a pair; returns (listener, held writer)."""
    listener = MagicMock()
    held = _held_pair()
    registry.add_tunnel("s1", "t1", listener, 19446, "db:5432", held=held)
    return listener, held[1]


_TUNNEL_ENDS = pytest.mark.parametrize(
    "end",
    [
        lambda registry: registry.close_tunnel("t1"),
        lambda registry: registry.close("s1"),
        lambda registry: registry.close_all(),
    ],
    ids=["tunnel close", "session close", "run end"],
)


class TestAHeldPairClosesWithItsTunnel:
    """Tunnel Close, session close and run end close a pair no client took (SSHTUN-7)."""

    @_TUNNEL_ENDS
    def test_an_unused_held_pair_closes_with_the_listener(
        self, end: Callable[[SSHSessionRegistry], Any]
    ) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener, writer = _held_tunnel(registry)

        end(registry)

        writer.close.assert_called_once_with()
        listener.close.assert_called_once_with()

    @_TUNNEL_ENDS
    def test_a_held_pair_close_error_still_closes_the_listener(
        self, end: Callable[[SSHSessionRegistry], Any]
    ) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener, writer = _held_tunnel(registry)
        writer.close.side_effect = RuntimeError("channel already gone")

        end(registry)

        writer.close.assert_called_once_with()
        listener.close.assert_called_once_with()
        record = registry.get("s1")
        assert record is None or record["tunnels"] == {}

    @_TUNNEL_ENDS
    def test_a_taken_pair_is_left_to_the_client_that_took_it(
        self, end: Callable[[SSHSessionRegistry], Any]
    ) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        listener, writer = _held_tunnel(registry)
        registry.get("s1")["tunnels"]["t1"]["held"] = None

        end(registry)

        writer.close.assert_not_called()
        listener.close.assert_called_once_with()

    def test_close_tunnel_with_a_held_pair_close_error_returns_true(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        _, writer = _held_tunnel(registry)
        writer.close.side_effect = RuntimeError("channel already gone")

        assert registry.close_tunnel("t1") is True

    def test_a_held_pair_close_error_still_closes_the_session(self) -> None:
        registry = SSHSessionRegistry()
        conn = MagicMock()
        _register(registry, "s1", conn)
        _, writer = _held_tunnel(registry)
        writer.close.side_effect = RuntimeError("channel already gone")

        assert registry.close("s1") == ["s1"]
        conn.close.assert_called_once_with()

    def test_run_end_survives_a_held_pair_close_error(self) -> None:
        registry = SSHSessionRegistry()
        conn = MagicMock()
        _register(registry, "s1", conn)
        _, writer = _held_tunnel(registry)
        writer.close.side_effect = RuntimeError("channel already gone")

        registry.close_all()

        assert registry.get("s1") is None
        conn.close.assert_called_once_with()

    def test_cascade_close_closes_a_descendant_held_pair(self) -> None:
        registry = SSHSessionRegistry()
        _register(registry, "parent", MagicMock())
        _register(registry, "child", MagicMock(), parent_id="parent")
        listener = MagicMock()
        held = _held_pair()
        registry.add_tunnel("child", "t1", listener, 19446, "db:5432", held=held)

        registry.close("parent")

        held[1].close.assert_called_once_with()
        listener.close.assert_called_once_with()


class TestFindTunnelByLocalPort:
    """find_tunnel_by_local_port - the open tunnel listening on a Local Port (NETCAT-9)."""

    def test_a_matching_local_port_returns_the_live_session_and_tunnel(self) -> None:
        """The records themselves, not copies."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.add_tunnel("s1", "t0", MagicMock(), 19445, "127.0.0.1:9445")
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "127.0.0.1:9446")

        found = registry.find_tunnel_by_local_port(19446)

        assert found is not None
        session, tunnel = found
        assert session is registry.get("s1")
        assert tunnel is registry.get("s1")["tunnels"]["t1"]

    def test_a_tunnel_in_a_second_session_returns_that_session(self) -> None:
        """Every session is searched."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        _register(registry, "s2", MagicMock(), host="host-b")
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "127.0.0.1:9446")
        registry.add_tunnel("s2", "t2", MagicMock(), 19447, "db.internal:5432")

        found = registry.find_tunnel_by_local_port(19447)

        assert found is not None
        session, tunnel = found
        assert session is registry.get("s2")
        assert tunnel is registry.get("s2")["tunnels"]["t2"]

    def test_the_first_match_in_insertion_order_wins(self) -> None:
        """Sessions, then their tunnels, are searched in the order they were added."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        _register(registry, "s2", MagicMock())
        registry.add_tunnel("s2", "t2", MagicMock(), 19446, "b:2")
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "a:1")

        found = registry.find_tunnel_by_local_port(19446)

        assert found is not None
        assert found[0] is registry.get("s1")
        assert found[1] is registry.get("s1")["tunnels"]["t1"]

    def test_no_matching_local_port_returns_none(self) -> None:
        """A port no tunnel listens on."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "127.0.0.1:9446")

        assert registry.find_tunnel_by_local_port(9446) is None

    def test_an_empty_registry_returns_none(self) -> None:
        """No sessions at all."""
        assert SSHSessionRegistry().find_tunnel_by_local_port(19446) is None

    def test_a_closed_tunnel_is_not_found(self) -> None:
        """close_tunnel removes the tunnel from the lookup."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "127.0.0.1:9446")
        registry.close_tunnel("t1")

        assert registry.find_tunnel_by_local_port(19446) is None

    def test_a_closed_session_is_not_found(self) -> None:
        """Closing the session closes its tunnels with it."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "127.0.0.1:9446")
        registry.close("s1")

        assert registry.find_tunnel_by_local_port(19446) is None

    def test_the_records_keep_their_shape(self) -> None:
        """The destination stays whole; the caller splits it."""
        registry = SSHSessionRegistry()
        _register(registry, "s1", MagicMock())
        registry.add_tunnel("s1", "t1", MagicMock(), 19446, "fd00::5:5432")

        found = registry.find_tunnel_by_local_port(19446)

        assert found is not None
        session, tunnel = found
        assert set(session) == {
            "connection",
            "parent_id",
            "host",
            "connected_var",
            "monitor_task",
            "variables",
            "tunnels",
            "connect_timeout",
            "host_identity",
        }
        assert set(tunnel) == {"listener", "local_port", "remote_destination", "held"}
        assert tunnel["local_port"] == 19446
        assert tunnel["remote_destination"] == "fd00::5:5432"
