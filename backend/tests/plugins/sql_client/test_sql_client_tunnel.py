"""The SQL block through the run's SSH tunnels (REQ-3.4.1.6, REQ-5.1.4, SQL-15)."""

from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.connectivity.sql.fakes import FakeConnection
from tests.plugins.netcat.conftest import tunnel_registry
from tests.plugins.sql_client.conftest import LogRecorder, sql_context, sql_params
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.sql_client import SQLClientPlugin, prepare

LOCAL = 15432
FAR = "db.internal:5432"
DEFAULT_PORTS = [("postgresql", 5432), ("mysql", 3306), ("oracle", 1521), ("mssql", 1433)]


def registry_for(case: str, port: int = LOCAL) -> SSHSessionRegistry | None:
    """A run whose tunnel on `port` is open, closed, or elsewhere, per `case`."""
    if case == "registry None":
        return None
    registry = tunnel_registry({LOCAL + 1 if case == "other port" else port: FAR}, MagicMock())
    if case == "tunnel closed":
        assert registry.close_tunnel(f"t{port}") is True
    return registry


def optional_keys(case: str) -> dict[str, Any]:
    """The context keys of a run shaped by `case`; no key at all without a registry."""
    return {} if case == "no registry" else {"ssh_session_registry": registry_for(case)}


async def connect_rows(
    use_fake: Callable[..., Any],
    log: LogRecorder,
    params: dict[str, Any],
    **optional: Any,
) -> dict[str, Any]:
    """Run the block through execute() on a fake dialect and hand back what connect() got."""
    fake = use_fake(params.get("database_type", "postgresql"), FakeConnection())

    await SQLClientPlugin().execute(sql_context(params, log, **optional))

    assert len(fake.connects) == 1
    rows: dict[str, Any] = fake.connects[0][0]
    return rows


class TestATunneledHost:
    """A loopback Host on an open tunnel's Local Port: the TLS name becomes the far host."""

    @pytest.mark.parametrize(
        "host", ["127.0.0.1", "localhost", " localhost "], ids=["address", "name", "padded"]
    )
    async def test_the_connect_rows_carry_the_far_host_as_the_server_name(
        self, host: str, use_fake: Callable[..., Any], log: LogRecorder
    ) -> None:
        ssh_connection = MagicMock()
        registry = tunnel_registry({LOCAL: FAR}, ssh_connection)

        rows = await connect_rows(
            use_fake, log, sql_params(host=host, port=LOCAL), ssh_session_registry=registry
        )

        assert rows["server_name"] == "db.internal"
        assert rows["host"].strip() == host.strip()
        assert rows["port"] == LOCAL
        assert ssh_connection.mock_calls == []

    async def test_an_ipv6_far_host_is_the_server_name(
        self, use_fake: Callable[..., Any], log: LogRecorder
    ) -> None:
        registry = tunnel_registry({LOCAL: "fd00::5:5432"}, MagicMock())

        rows = await connect_rows(
            use_fake, log, sql_params(host="127.0.0.1", port=LOCAL), ssh_session_registry=registry
        )

        assert rows["server_name"] == "fd00::5"
        assert (rows["host"], rows["port"]) == ("127.0.0.1", LOCAL)

    @pytest.mark.parametrize(("database_type", "default_port"), DEFAULT_PORTS)
    @pytest.mark.parametrize(
        "blank", [{"port": None}, {"port": ""}, {}], ids=["None", "empty", "absent"]
    )
    async def test_a_blank_port_looks_up_the_type_default_port(
        self,
        database_type: str,
        default_port: int,
        blank: dict[str, Any],
        use_fake: Callable[..., Any],
        log: LogRecorder,
    ) -> None:
        registry = tunnel_registry({default_port: FAR}, MagicMock())
        params = sql_params(host="127.0.0.1", database_type=database_type, **blank)

        rows = await connect_rows(use_fake, log, params, ssh_session_registry=registry)

        assert rows["server_name"] == "db.internal"
        assert (rows["host"], rows["port"]) == ("127.0.0.1", default_port)


class TestAnUntunneledHost:
    """Any other host, port or run keeps the Host as the TLS name."""

    @pytest.mark.parametrize(
        ("case", "host"),
        [
            ("no registry", "127.0.0.1"),
            ("registry None", "127.0.0.1"),
            ("other host", "db.example"),
            ("other host", "127.0.0.2"),
            ("tunnel closed", "127.0.0.1"),
            ("other port", "localhost"),
        ],
    )
    async def test_the_server_name_is_the_host(
        self, case: str, host: str, use_fake: Callable[..., Any], log: LogRecorder
    ) -> None:
        rows = await connect_rows(
            use_fake, log, sql_params(host=host, port=LOCAL), **optional_keys(case)
        )

        assert rows["server_name"] == host
        assert (rows["host"], rows["port"]) == (host, LOCAL)

    async def test_a_blank_port_without_a_tunnel_dials_the_default_port(
        self, use_fake: Callable[..., Any], log: LogRecorder
    ) -> None:
        registry = tunnel_registry({LOCAL: FAR}, MagicMock())

        rows = await connect_rows(
            use_fake, log, sql_params(host="127.0.0.1"), ssh_session_registry=registry
        )

        assert rows["server_name"] == "127.0.0.1"
        assert rows["port"] == 5432


class TestPrepare:
    """prepare settles the tunnel on WAVE and leaves the dial target as the block names it."""

    def test_a_route_sets_the_server_name_and_keeps_host_and_port(self) -> None:
        params = sql_params(host="127.0.0.1", port=LOCAL)
        registry = tunnel_registry({LOCAL: FAR}, MagicMock())

        core, values = prepare(params, sql_context(params, ssh_session_registry=registry))

        assert values == []
        assert core["server_name"] == "db.internal"
        assert (core["host"], core["port"]) == ("127.0.0.1", LOCAL)

    def test_a_blank_port_finds_the_tunnel_on_the_default_port(self) -> None:
        params = sql_params(host="localhost")
        registry = tunnel_registry({5432: FAR}, MagicMock())

        core, values = prepare(params, sql_context(params, ssh_session_registry=registry))

        assert values == []
        assert core["server_name"] == "db.internal"
        assert core["host"] == "localhost"

    @pytest.mark.parametrize(
        "case", ["no registry", "registry None", "tunnel closed", "other port"]
    )
    def test_no_route_leaves_the_server_name_to_the_host(self, case: str) -> None:
        params = sql_params(host="127.0.0.1", port=LOCAL)

        core, values = prepare(params, sql_context(params, **optional_keys(case)))

        assert values == []
        assert core.get("server_name", "127.0.0.1") == "127.0.0.1"
        assert (core["host"], core["port"]) == ("127.0.0.1", LOCAL)
