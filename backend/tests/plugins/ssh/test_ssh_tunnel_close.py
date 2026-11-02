"""
SSH Tunnel Close plugin tests (REQ-3.4.1.3, REQ-5.1.5).

The rebuilt plugin closes a forwarded tunnel by its Tunnel ID through the run's
SSHSessionRegistry, closing the listener and detaching it from its owning
session. Closing an unknown or already-closed tunnel is an idempotent no-op
returning closed=False.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.plugins.ssh.conftest import SESSION_ID as _SESSION_ID
from tests.plugins.ssh.conftest import plugin_context
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.ssh_tunnel_close import SSHTunnelClosePlugin

_TUNNEL_ID = "tunnel_abc123"


def _registry_with_tunnel(
    tunnel_id: str = _TUNNEL_ID,
    session_id: str = _SESSION_ID,
    listener: MagicMock | None = None,
) -> tuple[SSHSessionRegistry, MagicMock]:
    """A registry holding one session with one forwarded tunnel listener."""
    registry = SSHSessionRegistry()
    registry.register(session_id, MagicMock(), None, "node-1", None, None, connect_timeout=30)
    resolved = listener if listener is not None else MagicMock()
    registry.add_tunnel(session_id, tunnel_id, resolved, 19446, "db.internal.net:5432")
    return registry, resolved


def _make_context(
    registry: SSHSessionRegistry | None,
    tunnel_id: str = _TUNNEL_ID,
) -> dict[str, Any]:
    return plugin_context(registry, {"tunnel_id": tunnel_id})


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_identity(self) -> None:
        meta = SSHTunnelClosePlugin().metadata

        assert meta["id"] == "ssh-tunnel-close"
        assert meta["name"] == "SSH Tunnel Close"
        assert meta["category"] == "remote"
        assert meta["return_type"] == "map"

    def test_parameter_names(self) -> None:
        names = [p["name"] for p in SSHTunnelClosePlugin().metadata["parameters"]]

        assert names == ["tunnel_id"]

    def test_tunnel_id_spec(self) -> None:
        params = {p["name"]: p for p in SSHTunnelClosePlugin().metadata["parameters"]}

        assert params["tunnel_id"]["type"] == "string"
        assert params["tunnel_id"]["required"] is True

    def test_output_schema(self) -> None:
        outputs = SSHTunnelClosePlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("closed", "boolean"),
        ]

    def test_obsolete_outputs_are_gone(self) -> None:
        names = [o["name"] for o in SSHTunnelClosePlugin().metadata["output_schema"]]

        assert "local_port" not in names
        assert "remote_destination" not in names

    def test_every_parameter_carries_a_description(self) -> None:
        for param in SSHTunnelClosePlugin().metadata["parameters"]:
            assert param.get("description")

    def test_every_output_carries_a_description(self) -> None:
        for output in SSHTunnelClosePlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_metadata_builds_a_valid_plugin_model(self) -> None:
        model = SSHTunnelClosePlugin().get_plugin_model()

        assert model.id == "ssh-tunnel-close"


class TestValidation:
    """validate() - required param."""

    async def test_missing_tunnel_id(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: tunnel_id$"):
            await SSHTunnelClosePlugin().validate({})

    async def test_empty_tunnel_id_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: tunnel_id$"):
            await SSHTunnelClosePlugin().validate({"tunnel_id": ""})

    async def test_valid_params_pass(self) -> None:
        await SSHTunnelClosePlugin().validate({"tunnel_id": _TUNNEL_ID})


class TestExecute:
    """execute() - registry-backed close by tunnel id, idempotent."""

    async def test_closes_a_registered_tunnel(self) -> None:
        registry, listener = _registry_with_tunnel()

        result = await SSHTunnelClosePlugin().execute(_make_context(registry))

        assert result == {"closed": True}
        listener.close.assert_called_once_with()

    async def test_closed_tunnel_is_detached_from_its_session(self) -> None:
        registry, _listener = _registry_with_tunnel()

        await SSHTunnelClosePlugin().execute(_make_context(registry))

        assert registry.close_tunnel(_TUNNEL_ID) is False

    async def test_unknown_tunnel_is_a_no_op(self) -> None:
        registry = SSHSessionRegistry()

        result = await SSHTunnelClosePlugin().execute(_make_context(registry, tunnel_id="nope"))

        assert result == {"closed": False}

    async def test_double_close_is_idempotent(self) -> None:
        registry, _listener = _registry_with_tunnel()
        plugin = SSHTunnelClosePlugin()

        first = await plugin.execute(_make_context(registry))
        second = await plugin.execute(_make_context(registry))

        assert first == {"closed": True}
        assert second == {"closed": False}

    async def test_missing_registry_is_a_no_op(self) -> None:
        result = await SSHTunnelClosePlugin().execute(_make_context(None))

        assert result == {"closed": False}
