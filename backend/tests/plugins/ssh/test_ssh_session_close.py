"""
SSH Session Close plugin tests (REQ-3.4.1.3, REQ-5.1.5).

The rebuilt plugin closes the named session through the run's
SSHSessionRegistry, cascading to every descendant session (child before
parent). Closing an unknown or already-closed session is an idempotent
no-op returning an empty closed_session_ids list.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.plugins.ssh.conftest import SESSION_ID, plugin_context
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.ssh_session_close import SSHSessionClosePlugin


def _make_context(
    registry: SSHSessionRegistry | None,
    session_id: str = SESSION_ID,
) -> dict[str, Any]:
    return plugin_context(registry, {"session_id": session_id})


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_identity(self) -> None:
        meta = SSHSessionClosePlugin().metadata

        assert meta["id"] == "ssh-session-close"
        assert meta["name"] == "SSH Session Close"
        assert meta["category"] == "remote"
        assert meta["return_type"] == "map"

    def test_parameter_names(self) -> None:
        names = [p["name"] for p in SSHSessionClosePlugin().metadata["parameters"]]

        assert names == ["session_id"]

    def test_session_id_spec(self) -> None:
        params = {p["name"]: p for p in SSHSessionClosePlugin().metadata["parameters"]}

        assert params["session_id"]["type"] == "string"
        assert params["session_id"]["required"] is True
        assert params["session_id"]["trim"] is True

    def test_output_schema(self) -> None:
        outputs = SSHSessionClosePlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("closed_session_ids", "array"),
        ]

    def test_every_output_carries_a_description(self) -> None:
        for output in SSHSessionClosePlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_there_is_no_closed_hostname_output(self) -> None:
        names = [o["name"] for o in SSHSessionClosePlugin().metadata["output_schema"]]

        assert "closed_hostname" not in names

    def test_metadata_builds_a_valid_plugin_model(self) -> None:
        model = SSHSessionClosePlugin().get_plugin_model()

        assert model.id == "ssh-session-close"


class TestValidation:
    """validate() - required params."""

    async def test_missing_session_id(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: session_id$"):
            await SSHSessionClosePlugin().validate({})

    async def test_empty_session_id_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: session_id$"):
            await SSHSessionClosePlugin().validate({"session_id": ""})

    async def test_valid_params_pass(self) -> None:
        await SSHSessionClosePlugin().validate({"session_id": "ssh_session_abc123"})


class TestExecute:
    """execute() - registry-backed close with cascade and idempotency."""

    async def test_closes_the_session_and_returns_its_id(self) -> None:
        registry = SSHSessionRegistry()
        conn = MagicMock()
        registry.register(
            "ssh_session_abc123", conn, None, "node-1", None, None, connect_timeout=30
        )

        result = await SSHSessionClosePlugin().execute(_make_context(registry))

        assert result == {"closed_session_ids": ["ssh_session_abc123"]}
        conn.close.assert_called_once_with()
        assert registry.get("ssh_session_abc123") is None

    async def test_cascade_returns_children_before_the_parent(self) -> None:
        registry = SSHSessionRegistry()
        registry.register("parent-1", MagicMock(), None, "bastion", None, None, connect_timeout=30)
        registry.register(
            "child-1", MagicMock(), "parent-1", "node-1", None, None, connect_timeout=30
        )

        result = await SSHSessionClosePlugin().execute(
            _make_context(registry, session_id="parent-1")
        )

        assert result == {"closed_session_ids": ["child-1", "parent-1"]}

    async def test_unknown_session_is_a_no_op(self) -> None:
        registry = SSHSessionRegistry()

        result = await SSHSessionClosePlugin().execute(_make_context(registry))

        assert result == {"closed_session_ids": []}

    async def test_double_close_is_idempotent(self) -> None:
        registry = SSHSessionRegistry()
        registry.register(
            "ssh_session_abc123", MagicMock(), None, "node-1", None, None, connect_timeout=30
        )
        plugin = SSHSessionClosePlugin()

        first = await plugin.execute(_make_context(registry))
        second = await plugin.execute(_make_context(registry))

        assert first == {"closed_session_ids": ["ssh_session_abc123"]}
        assert second == {"closed_session_ids": []}

    async def test_missing_registry_is_a_no_op(self) -> None:
        result = await SSHSessionClosePlugin().execute(_make_context(None))

        assert result == {"closed_session_ids": []}

    async def test_close_spares_unrelated_sessions(self) -> None:
        registry = SSHSessionRegistry()
        registry.register(
            "ssh_session_abc123", MagicMock(), None, "node-1", None, None, connect_timeout=30
        )
        registry.register("other-1", MagicMock(), None, "node-2", None, None, connect_timeout=30)

        await SSHSessionClosePlugin().execute(_make_context(registry))

        assert registry.get("other-1") is not None

    async def test_close_flips_the_bound_connected_variable(self) -> None:
        pushes: list[tuple[str, Any]] = []
        registry = SSHSessionRegistry(
            push_variable=lambda name, value: pushes.append((name, value))
        )
        variables: dict[str, Any] = {"conn_ok": True}
        registry.register(
            "ssh_session_abc123",
            MagicMock(),
            None,
            "node-1",
            "conn_ok",
            None,
            variables=variables,
            connect_timeout=30,
        )

        await SSHSessionClosePlugin().execute(_make_context(registry))

        assert variables["conn_ok"] is False
        assert pushes == [("conn_ok", False)]
