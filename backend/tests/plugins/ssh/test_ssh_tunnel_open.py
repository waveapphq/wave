"""
SSH Tunnel Open plugin tests (REQ-3.4.1.3, REQ-5.1.5).

The tunnel rides an open SSH session from the run's SSHSessionRegistry: it binds a
loopback Local Port whose every accepted connection opens its own channel through the
session (SSHTUN-6), registers the listener under the owning session, and returns only
the Tunnel ID and the resolved Local Port. Validate Target checks the destination once
at open and holds that channel for the first client (SSHTUN-7).
"""

import asyncio
import re
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any
from unittest.mock import MagicMock, call

import asyncssh
import pytest

import wavecore.plugins.ssh_tunnel_open as tunnel_open_module
from tests.plugins.netcat.conftest import free_port
from tests.plugins.ssh.conftest import SESSION_ID as _SESSION_ID
from tests.plugins.ssh.conftest import RunLog, channel_connection, plugin_context, tunnel_session
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.ssh_tunnel_open import SSHTunnelOpenPlugin

_VALID_OPEN = {
    "session_id": _SESSION_ID,
    "remote_host": "db.internal.net",
    "remote_port": 5432,
}
_FAR_CALL = call("db.internal.net", 5432)
_VALIDATE_TARGET_HELP = (
    "Connects to the target once when the tunnel opens and fails if the SSH host refuses "
    "or cannot reach it. That connection is handed to the first block that uses the tunnel."
)
_DESCRIPTION = (
    "Forwards a local port to a remote host and port through an open SSH session, like "
    "ssh -L: each connection to the Local Port reaches the destination afresh, and one the "
    "SSH host refuses is logged as a warning. Validate Target checks the destination once at "
    "open. The tunnel lives until closed by SSH Tunnel Close or until its session closes."
)


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _failed(cause: str) -> str:
    return f"SSH tunnel to db.internal.net:5432 failed: {cause}"


@pytest.fixture
def log() -> RunLog:
    return RunLog()


async def _open(registry: SSHSessionRegistry | None, log: RunLog, **params: Any) -> dict[str, Any]:
    """Run Tunnel Open on db.internal.net:5432 with `params` over the valid base."""
    context = plugin_context(registry, {**_VALID_OPEN, **params}, logger=log)
    return await SSHTunnelOpenPlugin().execute(context)


def _tunnel(registry: SSHSessionRegistry, tunnel_id: str) -> dict[str, Any]:
    tunnel: dict[str, Any] = registry.get(_SESSION_ID)["tunnels"][tunnel_id]
    return tunnel


class FarEnd:
    """A loopback destination that greets each connection, then echoes; it can hang up the first."""

    def __init__(self, greeting: bytes, hang_up_first: bool) -> None:
        self.greeting = greeting
        self.hang_up_first = hang_up_first
        self.port = 0
        self.writers: list[asyncio.StreamWriter] = []

    async def serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.writers.append(writer)
        if self.hang_up_first and len(self.writers) == 1:
            writer.close()
            return
        with suppress(ConnectionError):
            writer.write(self.greeting)
            while chunk := await reader.read(65536):
                writer.write(chunk)
                await writer.drain()
        writer.close()


@asynccontextmanager
async def far_end(greeting: bytes = b"", hang_up_first: bool = False) -> AsyncIterator[FarEnd]:
    """Serve a FarEnd on 127.0.0.1 until the block ends, then close it and its connections."""
    far = FarEnd(greeting, hang_up_first)
    server = await asyncio.start_server(far.serve, "127.0.0.1", 0)
    far.port = server.sockets[0].getsockname()[1]
    try:
        yield far
    finally:
        server.close()
        for writer in far.writers:
            writer.close()


async def _talk(local_port: int, greeting: bytes = b"") -> None:
    """A client of the Local Port reads `greeting` first, then gets its ping echoed back."""
    reader, writer = await asyncio.open_connection("127.0.0.1", local_port)
    try:
        async with asyncio.timeout(1):
            assert await reader.readexactly(len(greeting)) == greeting
            writer.write(b"ping")
            await writer.drain()
            assert await reader.readexactly(4) == b"ping"
    finally:
        writer.close()
        with suppress(ConnectionError):
            await writer.wait_closed()


async def _settled(registry: SSHSessionRegistry, connection: MagicMock) -> None:
    """Close the run's sessions; every channel the stand-in opened then ends closed."""
    registry.close_all()
    await connection.channels.released()


def _assert_nothing_left(registry: SSHSessionRegistry, log: RunLog, local_port: int) -> None:
    """No tunnel is registered, no WARN was written, and the Local Port binds again."""
    assert registry.get(_SESSION_ID)["tunnels"] == {}
    assert [line for line in log if line[0] == "WARN"] == []
    with socket.socket() as again:
        again.bind(("127.0.0.1", local_port))


class ExpiresAtOnce:
    """Stands in for asyncio.wait_for: records each bound, drops the awaitable, times out."""

    def __init__(self) -> None:
        self.bounds: list[Any] = []

    async def __call__(self, awaitable: Any, timeout: Any) -> Any:
        self.bounds.append(timeout)
        if asyncio.iscoroutine(awaitable):
            awaitable.close()
        else:
            awaitable.cancel()
        raise TimeoutError


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_identity(self) -> None:
        meta = SSHTunnelOpenPlugin().metadata

        assert meta["id"] == "ssh-tunnel-open"
        assert meta["name"] == "SSH Tunnel Open"
        assert meta["category"] == "remote"
        assert meta["return_type"] == "map"

    def test_description_names_the_default_and_validate_target(self) -> None:
        assert SSHTunnelOpenPlugin().metadata["description"] == _DESCRIPTION

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in SSHTunnelOpenPlugin().metadata["parameters"]]

        assert names == [
            "session_id",
            "local_port",
            "remote_host",
            "remote_port",
            "validate_target",
        ]

    def test_session_id_reuses_the_shared_spec(self) -> None:
        params = {p["name"]: p for p in SSHTunnelOpenPlugin().metadata["parameters"]}

        assert params["session_id"]["type"] == "string"
        assert params["session_id"]["required"] is True
        assert params["session_id"]["trim"] is True

    def test_parameter_specs(self) -> None:
        params = {p["name"]: p for p in SSHTunnelOpenPlugin().metadata["parameters"]}

        assert params["local_port"]["type"] == "integer"
        assert params["local_port"]["required"] is False
        assert params["local_port"]["default"] == 0
        assert params["remote_host"]["type"] == "string"
        assert params["remote_host"]["required"] is True
        assert params["remote_port"]["type"] == "integer"
        assert params["remote_port"]["required"] is True

    def test_validate_target_is_an_optional_boolean_off_by_default(self) -> None:
        params = {p["name"]: p for p in SSHTunnelOpenPlugin().metadata["parameters"]}

        assert params["validate_target"] == {
            "name": "validate_target",
            "type": "boolean",
            "required": False,
            "default": False,
            "description": _VALIDATE_TARGET_HELP,
        }

    def test_port_rows_declare_their_bounds(self) -> None:
        params = {p["name"]: p for p in SSHTunnelOpenPlugin().metadata["parameters"]}

        assert params["local_port"] == {
            "name": "local_port",
            "type": "integer",
            "required": False,
            "default": 0,
            "minimum": 0,
            "maximum": 65535,
            "description": "Local port to listen on; 0 auto-assigns a free port",
        }
        assert params["remote_port"] == {
            "name": "remote_port",
            "type": "integer",
            "required": True,
            "minimum": 1,
            "maximum": 65535,
            "description": "Destination port to forward to",
        }

    def test_output_schema(self) -> None:
        outputs = SSHTunnelOpenPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("tunnel_id", "string"),
            ("local_port", "integer"),
        ]

    def test_obsolete_outputs_are_gone(self) -> None:
        names = [o["name"] for o in SSHTunnelOpenPlugin().metadata["output_schema"]]

        assert "remote_destination" not in names
        assert "tunnel_status" not in names

    def test_obsolete_profile_scope_params_are_gone(self) -> None:
        names = [p["name"] for p in SSHTunnelOpenPlugin().metadata["parameters"]]

        assert "profile" not in names
        assert "scope" not in names
        assert "jump_host_profile" not in names

    def test_every_parameter_carries_a_description(self) -> None:
        for param in SSHTunnelOpenPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_every_output_carries_a_description(self) -> None:
        for output in SSHTunnelOpenPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_metadata_builds_a_valid_plugin_model(self) -> None:
        model = SSHTunnelOpenPlugin().get_plugin_model()

        assert model.id == "ssh-tunnel-open"


class TestValidation:
    """validate() - required params, port ranges, blank Local Port and Validate Target."""

    async def test_missing_session_id(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: session_id$"):
            await SSHTunnelOpenPlugin().validate(
                {"remote_host": "db.internal.net", "remote_port": 5432}
            )

    async def test_empty_session_id_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: session_id$"):
            await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "session_id": ""})

    async def test_missing_remote_host(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: remote_host$"):
            await SSHTunnelOpenPlugin().validate({"session_id": _SESSION_ID, "remote_port": 5432})

    async def test_empty_remote_host_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: remote_host$"):
            await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "remote_host": ""})

    async def test_missing_remote_port(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: remote_port$"):
            await SSHTunnelOpenPlugin().validate(
                {"session_id": _SESSION_ID, "remote_host": "db.internal.net"}
            )

    @pytest.mark.parametrize("bad", [0, -1, 65536, 70000, True, "5432"])
    async def test_remote_port_out_of_range(self, bad: Any) -> None:
        with pytest.raises(
            ValueError, match=r"^Parameter 'remote_port' must be between 1 and 65535$"
        ):
            await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "remote_port": bad})

    @pytest.mark.parametrize("bad", [-1, 65536, 70000, True, "80"])
    async def test_local_port_out_of_range(self, bad: Any) -> None:
        with pytest.raises(
            ValueError, match=r"^Parameter 'local_port' must be between 0 and 65535$"
        ):
            await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "local_port": bad})

    @pytest.mark.parametrize("port", [1, 22, 5432, 65535])
    async def test_remote_port_within_range_passes(self, port: int) -> None:
        await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "remote_port": port})

    @pytest.mark.parametrize("port", [0, 1, 8080, 65535])
    async def test_local_port_within_range_passes(self, port: int) -> None:
        await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "local_port": port})

    async def test_local_port_absent_passes(self) -> None:
        await SSHTunnelOpenPlugin().validate(_VALID_OPEN)

    async def test_a_null_local_port_passes(self) -> None:
        """SSH-10: a Local Port with no value falls back to 0 when the block runs."""
        await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "local_port": None})

    async def test_an_empty_text_local_port_is_refused(self) -> None:
        """SSH-10: empty text is text, not a missing value."""
        with pytest.raises(
            ValueError, match=r"^Parameter 'local_port' must be between 0 and 65535$"
        ):
            await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "local_port": ""})

    @pytest.mark.parametrize("bad", ["true", 1, 0, "yes"])
    async def test_a_non_boolean_validate_target_is_refused(self, bad: Any) -> None:
        with pytest.raises(
            ValueError, match=exact("Parameter 'validate_target' must be a boolean")
        ):
            await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "validate_target": bad})

    @pytest.mark.parametrize("value", [None, True, False])
    async def test_a_boolean_or_blank_validate_target_passes(self, value: Any) -> None:
        await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "validate_target": value})

    async def test_valid_params_pass(self) -> None:
        await SSHTunnelOpenPlugin().validate({**_VALID_OPEN, "local_port": 19446})

    @pytest.mark.parametrize(
        ("name", "message"),
        [
            ("local_port", "Parameter 'local_port' must be between 0 and 65535"),
            ("remote_port", "Parameter 'remote_port' must be between 1 and 65535"),
        ],
    )
    async def test_the_declared_bounds_are_the_ones_validate_enforces(
        self, name: str, message: str
    ) -> None:
        row = {p["name"]: p for p in SSHTunnelOpenPlugin().metadata["parameters"]}[name]
        plugin = SSHTunnelOpenPlugin()

        await plugin.validate({**_VALID_OPEN, name: row["minimum"]})
        await plugin.validate({**_VALID_OPEN, name: row["maximum"]})
        for outside in (row["minimum"] - 1, row["maximum"] + 1):
            with pytest.raises(ValueError, match=exact(message)):
                await plugin.validate({**_VALID_OPEN, name: outside})


class TestDefaultOpen:
    """SSHTUN-6: opening binds the loopback Local Port and checks nothing else, like ssh -L."""

    @pytest.mark.parametrize(
        "mode",
        [{}, {"validate_target": False}, {"validate_target": None}],
        ids=["absent", "false", "blank"],
    )
    async def test_open_opens_no_channel_and_each_client_gets_a_fresh_one(
        self, mode: dict[str, Any], log: RunLog
    ) -> None:
        async with far_end() as far:
            connection = channel_connection(far.port)
            registry = tunnel_session(connection)
            try:
                result = await _open(registry, log, local_port=free_port(), **mode)

                assert connection.open_connection.call_count == 0
                await _talk(result["local_port"])
                await _talk(result["local_port"])
                assert connection.open_connection.await_args_list == [_FAR_CALL, _FAR_CALL]
                await _settled(registry, connection)
            finally:
                registry.close_all()

    async def test_returns_only_tunnel_id_and_local_port(self, log: RunLog) -> None:
        local_port = free_port()
        registry = tunnel_session(channel_connection())
        try:
            result = await _open(registry, log, local_port=local_port)

            assert set(result.keys()) == {"tunnel_id", "local_port"}
            assert isinstance(result["tunnel_id"], str)
            assert result["tunnel_id"]
            assert result["local_port"] == local_port
        finally:
            registry.close_all()

    @pytest.mark.parametrize(
        "params",
        [{"local_port": 0}, {"local_port": None}, {}],
        ids=["zero", "None", "absent"],
    )
    async def test_a_zero_or_blank_local_port_is_auto_assigned(
        self, params: dict[str, Any], log: RunLog
    ) -> None:
        """SSH-10: the returned port is the one the listener actually bound."""
        registry = tunnel_session(channel_connection())
        try:
            result = await _open(registry, log, **params)

            assert result["local_port"] > 0
            listener = _tunnel(registry, result["tunnel_id"])["listener"]
            assert listener.get_port() == result["local_port"]
        finally:
            registry.close_all()

    async def test_registers_the_tunnel_under_the_session(self, log: RunLog) -> None:
        local_port = free_port()
        registry = tunnel_session(channel_connection())
        try:
            result = await _open(registry, log, local_port=local_port)

            tunnel = _tunnel(registry, result["tunnel_id"])
            assert tunnel["listener"].get_port() == local_port
            assert tunnel["local_port"] == local_port
            assert tunnel["remote_destination"] == "db.internal.net:5432"
            assert tunnel["held"] is None
        finally:
            registry.close_all()

    async def test_tunnel_close_stops_the_listener(self, log: RunLog) -> None:
        local_port = free_port()
        registry = tunnel_session(channel_connection())
        try:
            result = await _open(registry, log, local_port=local_port)

            assert registry.close_tunnel(result["tunnel_id"]) is True
            with socket.socket() as again:
                again.bind(("127.0.0.1", local_port))
        finally:
            registry.close_all()


class TestMissingSession:
    """The session the tunnel would ride must be open in this run."""

    async def test_unknown_session_raises(self, log: RunLog) -> None:
        registry = SSHSessionRegistry()

        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await _open(registry, log, local_port=19446)

    async def test_closed_session_raises(self, log: RunLog) -> None:
        connection = channel_connection()
        registry = tunnel_session(connection)
        registry.close(_SESSION_ID)

        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await _open(registry, log, local_port=19446)

        assert connection.open_connection.call_count == 0

    async def test_missing_registry_raises_session_not_found(self, log: RunLog) -> None:
        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await _open(None, log, local_port=19446)


class TestSessionClosedMidOpen:
    """A session another branch closes while the tunnel opens leaves no Local Port bound."""

    async def test_a_session_closed_during_the_bind_fails_the_block_and_frees_the_port(
        self, log: RunLog, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        connection = channel_connection()
        registry = tunnel_session(connection)
        local_port = free_port()
        bind = tunnel_open_module.start_forwarder

        async def closed_while_binding(*args: Any) -> Any:
            listener = await bind(*args)
            registry.close(_SESSION_ID)
            return listener

        monkeypatch.setattr(tunnel_open_module, "start_forwarder", closed_while_binding)
        message = _failed("the SSH connection to bastion is closed")
        try:
            with pytest.raises(ConnectionError, match=exact(message)):
                await _open(registry, log, local_port=local_port)

            assert registry.get(_SESSION_ID) is None
            assert connection.open_connection.call_count == 0
            with socket.socket() as again:
                again.bind(("127.0.0.1", local_port))
        finally:
            registry.close_all()

    async def test_a_session_closed_during_the_check_also_closes_the_held_channel(
        self, log: RunLog, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async with far_end() as far:
            connection = channel_connection(far.port)
            registry = tunnel_session(connection)
            local_port = free_port()
            check = tunnel_open_module.validate_target

            async def closed_while_checking(*args: Any) -> Any:
                held = await check(*args)
                registry.close(_SESSION_ID)
                return held

            monkeypatch.setattr(tunnel_open_module, "validate_target", closed_while_checking)
            message = _failed("the SSH connection to bastion is closed")
            try:
                with pytest.raises(ConnectionError, match=exact(message)):
                    await _open(registry, log, local_port=local_port, validate_target=True)

                assert connection.channels.closed() == [True]
                # The destination sees the held channel hang up.
                async with asyncio.timeout(1):
                    while not far.writers[0].is_closing():
                        await asyncio.sleep(0.001)
                with socket.socket() as again:
                    again.bind(("127.0.0.1", local_port))
            finally:
                registry.close_all()


class TestValidateTargetHolds:
    """SSHTUN-7: a passed check holds its channel for the first client of the tunnel."""

    async def test_the_first_client_takes_the_held_channel_and_later_ones_open_fresh(
        self, log: RunLog
    ) -> None:
        """Bytes the destination sent before hand-over reach the first client first."""
        async with far_end(greeting=b"hello") as far:
            connection = channel_connection(far.port)
            registry = tunnel_session(connection)
            try:
                result = await _open(registry, log, local_port=free_port(), validate_target=True)
                tunnel = _tunnel(registry, result["tunnel_id"])

                assert connection.open_connection.await_args_list == [_FAR_CALL]
                assert tunnel["held"] is not None
                await _talk(result["local_port"], greeting=b"hello")
                assert connection.open_connection.call_count == 1
                assert tunnel["held"] is None
                await _talk(result["local_port"], greeting=b"hello")
                assert connection.open_connection.await_args_list == [_FAR_CALL, _FAR_CALL]
                assert [line for line in log if line[0] == "WARN"] == []
                await _settled(registry, connection)
            finally:
                registry.close_all()

    async def test_a_held_channel_the_destination_closed_gives_way_to_a_fresh_one(
        self, log: RunLog
    ) -> None:
        async with far_end(greeting=b"hello", hang_up_first=True) as far:
            connection = channel_connection(far.port)
            registry = tunnel_session(connection)
            try:
                result = await _open(registry, log, local_port=free_port(), validate_target=True)
                tunnel = _tunnel(registry, result["tunnel_id"])
                held_reader = tunnel["held"][0]
                async with asyncio.timeout(1):
                    while not held_reader.at_eof():
                        await asyncio.sleep(0.001)

                await _talk(result["local_port"], greeting=b"hello")

                assert connection.open_connection.call_count == 2
                assert connection.channels.closed()[0] is True
                assert tunnel["held"] is None
                await _settled(registry, connection)
            finally:
                registry.close_all()


class TestValidateTargetFails:
    """SSHTUN-8: a failed check fails the block, leaves no tunnel and frees the Local Port."""

    @pytest.mark.parametrize(
        ("channel", "cause"),
        [
            pytest.param(
                {"refuse": "open failed", "code": asyncssh.OPEN_ADMINISTRATIVELY_PROHIBITED},
                "bastion refused to forward (administratively prohibited)",
                id="code 1",
            ),
            pytest.param(
                {"refuse": "Connection refused", "code": asyncssh.OPEN_CONNECT_FAILED},
                "bastion could not connect (Connection refused)",
                id="code 2",
            ),
            pytest.param(
                {"refuse": "unknown channel type", "code": asyncssh.OPEN_UNKNOWN_CHANNEL_TYPE},
                "bastion refused the connection (unknown channel type)",
                id="code 3",
            ),
            pytest.param(
                {"refuse": "resource shortage", "code": asyncssh.OPEN_RESOURCE_SHORTAGE},
                "bastion refused the connection (resource shortage)",
                id="code 4",
            ),
            pytest.param(
                {"closed": True},
                "the SSH connection to bastion is closed",
                id="closed connection",
            ),
        ],
    )
    async def test_a_refused_or_closed_channel_fails_the_block(
        self, channel: dict[str, Any], cause: str, log: RunLog
    ) -> None:
        connection = channel_connection(**channel)
        registry = tunnel_session(connection)
        local_port = free_port()
        try:
            with pytest.raises(ConnectionError, match=exact(_failed(cause))):
                await _open(registry, log, local_port=local_port, validate_target=True)

            _assert_nothing_left(registry, log, local_port)
            await connection.channels.released()
        finally:
            registry.close_all()

    @pytest.mark.parametrize(
        ("connect_timeout", "within"),
        [(30, "30 seconds"), (1, "1 second")],
        ids=["M9 30 seconds", "M10 1 second"],
    )
    async def test_no_answer_within_the_connection_timeout_fails_the_block(
        self,
        connect_timeout: int,
        within: str,
        log: RunLog,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        connection = channel_connection(hang=True)
        registry = tunnel_session(connection, connect_timeout=connect_timeout)
        local_port = free_port()
        expire = ExpiresAtOnce()
        monkeypatch.setattr(asyncio, "wait_for", expire)
        message = _failed(f"bastion did not connect within {within}")
        try:
            with pytest.raises(ConnectionError, match=exact(message)):
                async with asyncio.timeout(1):
                    await _open(registry, log, local_port=local_port, validate_target=True)

            assert expire.bounds == [connect_timeout]
            _assert_nothing_left(registry, log, local_port)
            await connection.channels.released()
        finally:
            registry.close_all()


class TestBindFailure:
    """A Local Port that cannot be bound fails the block before any channel opens."""

    async def test_a_local_port_in_use_fails_without_opening_a_channel(self, log: RunLog) -> None:
        connection = channel_connection()
        registry = tunnel_session(connection)
        try:
            with socket.socket() as taken:
                taken.bind(("127.0.0.1", 0))
                taken.listen()
                prefix = re.escape(_failed(""))
                with pytest.raises(ConnectionError, match=f"^{prefix}.+$"):
                    await _open(
                        registry, log, local_port=taken.getsockname()[1], validate_target=True
                    )

            assert registry.get(_SESSION_ID)["tunnels"] == {}
            assert connection.open_connection.call_count == 0
        finally:
            registry.close_all()

    @pytest.mark.parametrize(
        ("error", "detail"),
        [(OSError("address in use"), "address in use"), (OSError(), "OSError")],
        ids=["error text", "empty text falls back to the type name"],
    )
    async def test_the_bind_error_is_the_detail(
        self,
        error: OSError,
        detail: str,
        log: RunLog,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def cannot_bind(*args: Any, **kwargs: Any) -> Any:
            raise error

        monkeypatch.setattr(tunnel_open_module, "start_forwarder", cannot_bind)
        connection = channel_connection()
        registry = tunnel_session(connection)
        try:
            with pytest.raises(ConnectionError, match=exact(_failed(detail))):
                await _open(registry, log, local_port=19446, validate_target=True)

            assert registry.get(_SESSION_ID)["tunnels"] == {}
            assert connection.open_connection.call_count == 0
        finally:
            registry.close_all()
