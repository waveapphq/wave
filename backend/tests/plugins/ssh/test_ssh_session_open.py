"""
SSH Session Open plugin tests (REQ-3.4.1.3, REQ-5.1.5).

The rebuilt plugin opens one SSH connection from config-form parameters
(secrets flow from a bound SSH profile via expression mode), optionally
through a parent session's live connection (multi-hop by parent linkage),
registers it in the run's SSHSessionRegistry, and exposes Session ID /
Connected / Server Banner / Hop Count outputs. Keepalive drops flip the
bound Connected variable to false with a WARN log.
"""

import asyncio
import contextlib
import functools
import re
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, call, patch

import asyncssh
import pytest

from tests.plugins.netcat.conftest import SSH_HOST, tunnel_registry
from tests.plugins.ssh.conftest import (
    HOST_KEY,
    KEY_CHANGED,
    NOT_TRUSTED_LOCKED,
    NOT_TRUSTED_STRICT,
    KeyEndpoint,
    SSHEndpoint,
    host_key_refusal,
    plugin_context,
    public_key_text,
    set_lock,
    ssh_hosts_config,
    trust_host,
    trusted_entries,
)
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins import ssh_session_open
from wavecore.plugins._ssh_session import OpenedSSHConnection, open_connection
from wavecore.plugins.ssh_session_open import SSHSessionOpenPlugin

EXPECTED_PARAM_ORDER = [
    "host",
    "port",
    "username",
    "password",
    "private_key",
    "use_parent",
    "parent_session_id",
    "passphrase",
    "host_key_verification",
    "connect_timeout",
    "keep_alive_interval",
    "keep_alive_max_count",
    "compression",
]


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _params_by_name(plugin: SSHSessionOpenPlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


def _valid_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "host": "node-1",
        "username": "wave",
        "password": "s3cr3t-pw",
    }
    params.update(overrides)
    return params


def _make_registry() -> tuple[SSHSessionRegistry, list[tuple[str, Any]]]:
    pushes: list[tuple[str, Any]] = []

    def _push(name: str, value: Any) -> None:
        pushes.append((name, value))

    return SSHSessionRegistry(push_variable=_push), pushes


def _make_conn(banner: str = "SSH-2.0-Sim") -> MagicMock:
    conn = MagicMock()
    conn.get_extra_info.return_value = banner
    return conn


def _opened(conn: Any, host_key_check: Any = None) -> AsyncMock:
    """A stand-in for open_connection: the connection plus its host key check."""
    return AsyncMock(return_value=OpenedSSHConnection(conn, host_key_check))


def _make_context(
    registry: SSHSessionRegistry,
    params: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    variables: dict[str, Any] | None = None,
    logger: Any | None = None,
) -> dict[str, Any]:
    context = plugin_context(
        registry, params if params is not None else _valid_params(), logger, variables
    )
    context["output_bindings"] = (
        output_bindings
        if output_bindings is not None
        else {"session_id": "sid_var", "connected": "conn_ok"}
    )
    return context


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_plugin_instantiates(self) -> None:
        assert SSHSessionOpenPlugin() is not None

    def test_identity(self) -> None:
        meta = SSHSessionOpenPlugin().metadata

        assert meta["id"] == "ssh-session-open"
        assert meta["name"] == "SSH Session Open"
        assert meta["category"] == "remote"
        assert meta["return_type"] == "map"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in SSHSessionOpenPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_there_is_no_profile_or_keep_alive_parameter(self) -> None:
        names = [p["name"] for p in SSHSessionOpenPlugin().metadata["parameters"]]

        assert "profile" not in names
        assert "jump_host_profile" not in names
        assert "keep_alive" not in names

    def test_required_flags(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["host"]["required"] is True
        assert params["port"]["required"] is True
        assert params["username"]["required"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name in ("host", "port", "username"):
                continue
            assert params[name].get("required") is False

    def test_parent_session_alone_is_required_by_a_mode(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        conditional = {
            name: param.get("required_when") or param.get("required_when_all")
            for name, param in params.items()
            if param.get("required_when") or param.get("required_when_all")
        }

        assert conditional == {"parent_session_id": {"field": "use_parent", "values": ["true"]}}

    def test_parameter_types(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["host"]["type"] == "string"
        assert params["port"]["type"] == "integer"
        assert params["username"]["type"] == "string"
        assert params["password"]["type"] == "string"
        assert params["private_key"]["type"] == "string"
        assert params["use_parent"]["type"] == "boolean"
        assert params["parent_session_id"]["type"] == "string"
        assert params["passphrase"]["type"] == "string"
        assert params["host_key_verification"]["type"] == "string"
        assert params["connect_timeout"]["type"] == "integer"
        assert params["keep_alive_interval"]["type"] == "integer"
        assert params["keep_alive_max_count"]["type"] == "integer"
        assert params["compression"]["type"] == "boolean"

    def test_defaults(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["port"]["default"] == 22
        assert params["host_key_verification"]["default"] == "disabled"
        assert params["connect_timeout"]["default"] == 30
        assert params["keep_alive_interval"]["default"] == 0
        assert params["keep_alive_max_count"]["default"] == 3
        assert params["compression"]["default"] is False
        assert params["use_parent"]["default"] is False

    def test_secret_flags(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["password"]["secret"] is True
        assert params["private_key"]["secret"] is True
        assert params["passphrase"]["secret"] is True
        for name in ("host", "port", "username", "parent_session_id"):
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["host"]["trim"] is True
        assert params["username"]["trim"] is True
        assert params["parent_session_id"]["trim"] is True
        assert params["host_key_verification"]["trim"] is True

    def test_secret_params_do_not_trim(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        for name in ("password", "private_key", "passphrase"):
            assert params[name].get("trim", False) is False

    def test_host_key_verification_enum(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["host_key_verification"]["enum_values"] == [
            "strict",
            "accept-new",
            "disabled",
        ]

    def test_the_host_key_actions_are_the_list_settings_shares(self) -> None:
        from wavecore.api.config import instance_settings

        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["host_key_verification"]["enum_values"] == list(
            instance_settings.HOST_KEY_ACTIONS
        )

    def test_output_schema(self) -> None:
        outputs = SSHSessionOpenPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("session_id", "string"),
            ("connected", "boolean"),
            ("server_banner", "string"),
            ("hop_count", "integer"),
        ]

    def test_every_output_carries_a_description(self) -> None:
        for output in SSHSessionOpenPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_there_is_no_remote_host_or_connection_status_output(self) -> None:
        names = [o["name"] for o in SSHSessionOpenPlugin().metadata["output_schema"]]

        assert "remote_host" not in names
        assert "connection_status" not in names

    def test_every_parameter_carries_a_description(self) -> None:
        for param in SSHSessionOpenPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_metadata_builds_a_valid_plugin_model(self) -> None:
        model = SSHSessionOpenPlugin().get_plugin_model()

        assert model.id == "ssh-session-open"


class TestHelpText:
    """The host key and Private Key help say where trust and keys come from (REQ-4.5.14)."""

    def test_the_host_key_verification_help(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["host_key_verification"]["description"] == (
            "Host key policy: 'strict' requires the host to be in WAVE's trusted hosts list, "
            "'accept-new' adds an unknown host's key to that list the first time and refuses it "
            "later if it changes, 'disabled' skips verification. While trusted hosts are locked "
            "in Settings, 'accept-new' acts as 'strict'. Default: 'disabled'; a newly placed "
            "block takes the Settings default."
        )

    def test_the_private_key_help(self) -> None:
        params = _params_by_name(SSHSessionOpenPlugin())

        assert params["private_key"]["description"] == (
            "Private key for key authentication: inline PEM content or the path of a key file "
            "on the WAVE host; a relative path starts at the home folder of the account WAVE "
            "runs under. Either a password or a private key is required."
        )


class TestTheBlocksThatReferenceTheSession:
    """Every text naming the Session ID's consumers names the same blocks (SSH-11)."""

    def test_the_description_names_every_consumer(self) -> None:
        assert SSHSessionOpenPlugin().metadata["description"] == (
            "Opens a stateful SSH session that SSH Session Exec, SSH Session Script, "
            "SSH Session Close, SSH Tunnel Open, SFTP and Remote Execution reference by "
            "its Session ID. Chain sessions through Parent Session for multi-hop access."
        )

    def test_the_session_id_output_names_every_consumer(self) -> None:
        outputs = {o["name"]: o for o in SSHSessionOpenPlugin().metadata["output_schema"]}

        assert outputs["session_id"]["description"] == (
            "Handle identifying an open SSH session: Open produces it; Execute, Script, Close, "
            "Tunnel Open, SFTP, Remote Execution, and a chained Open's Parent Session reference it"
        )

    def test_the_module_docstring_names_every_consumer(self) -> None:
        assert ssh_session_open.__doc__ is not None
        lines = [line.strip() for line in ssh_session_open.__doc__.splitlines()]

        assert (
            "in the run's SSHSessionRegistry for downstream Exec / Script / Close / "
            "Tunnel Open / SFTP / Remote Execution nodes."
        ) in lines


_BOUNDED_ROWS: dict[str, dict[str, Any]] = {
    "port": {
        "name": "port",
        "type": "integer",
        "required": True,
        "default": 22,
        "minimum": 1,
        "maximum": 65535,
        "description": "SSH port on the target host. Default: 22.",
    },
    "connect_timeout": {
        "name": "connect_timeout",
        "type": "integer",
        "required": False,
        "default": 30,
        "minimum": 1,
        "description": "Connection timeout in seconds. Default: 30.",
    },
    "keep_alive_interval": {
        "name": "keep_alive_interval",
        "type": "integer",
        "required": False,
        "default": 0,
        "minimum": 0,
        "description": (
            "Seconds between keepalive probes; 0 disables keepalive. With "
            "keepalive on, a dropped connection flips the Connected output "
            "to false. Default: 0."
        ),
    },
    "keep_alive_max_count": {
        "name": "keep_alive_max_count",
        "type": "integer",
        "required": False,
        "default": 3,
        "minimum": 1,
        "description": (
            "Consecutive unanswered keepalives before the connection counts " "as lost. Default: 3."
        ),
    },
}

_FLOOR_MESSAGES = {
    "connect_timeout": "Connect timeout must be at least 1",
    "keep_alive_interval": "Keep-alive interval must be 0 or more",
    "keep_alive_max_count": "Keep-alive max count must be at least 1",
}

_PORT_RANGE = "Parameter 'port' must be between 1 and 65535"


class TestDeclaredBounds:
    """The numeric rows declare their bounds once, and validate enforces them (SSH-9)."""

    @pytest.mark.parametrize("name", list(_BOUNDED_ROWS))
    def test_the_row_declares_its_bounds(self, name: str) -> None:
        assert _params_by_name(SSHSessionOpenPlugin())[name] == _BOUNDED_ROWS[name]

    @pytest.mark.parametrize("name", list(_FLOOR_MESSAGES))
    async def test_the_declared_minimum_passes(self, name: str) -> None:
        minimum = _params_by_name(SSHSessionOpenPlugin())[name]["minimum"]

        await SSHSessionOpenPlugin().validate(_valid_params(**{name: minimum}))

    @pytest.mark.parametrize("name", list(_FLOOR_MESSAGES))
    async def test_one_below_the_declared_minimum_is_refused(self, name: str) -> None:
        minimum = _params_by_name(SSHSessionOpenPlugin())[name]["minimum"]

        with pytest.raises(ValueError, match=exact(_FLOOR_MESSAGES[name])):
            await SSHSessionOpenPlugin().validate(_valid_params(**{name: minimum - 1}))

    async def test_the_declared_port_range_is_the_one_enforced(self) -> None:
        row = _params_by_name(SSHSessionOpenPlugin())["port"]
        plugin = SSHSessionOpenPlugin()

        await plugin.validate(_valid_params(port=row["minimum"]))
        await plugin.validate(_valid_params(port=row["maximum"]))
        for outside in (row["minimum"] - 1, row["maximum"] + 1):
            with pytest.raises(ValueError, match=exact(_PORT_RANGE)):
                await plugin.validate(_valid_params(port=outside))


class TestValidation:
    """validate() - required params, auth pair, ranges, enum."""

    async def test_missing_host(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: host$"):
            await SSHSessionOpenPlugin().validate({"username": "wave", "password": "x-pw-123"})

    async def test_empty_host_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: host$"):
            await SSHSessionOpenPlugin().validate(
                {"host": "", "username": "wave", "password": "x-pw-123"}
            )

    async def test_missing_username(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: username$"):
            await SSHSessionOpenPlugin().validate({"host": "node-1", "password": "x-pw-123"})

    async def test_empty_username_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: username$"):
            await SSHSessionOpenPlugin().validate(
                {"host": "node-1", "username": "", "password": "x-pw-123"}
            )

    async def test_requires_password_or_private_key(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^SSH Session Open requires either 'password' or 'private_key'$",
        ):
            await SSHSessionOpenPlugin().validate({"host": "node-1", "username": "wave"})

    async def test_empty_auth_values_count_as_missing(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^SSH Session Open requires either 'password' or 'private_key'$",
        ):
            await SSHSessionOpenPlugin().validate(
                {"host": "node-1", "username": "wave", "password": "", "private_key": ""}
            )

    async def test_password_alone_is_sufficient(self) -> None:
        await SSHSessionOpenPlugin().validate(_valid_params())

    async def test_private_key_alone_is_sufficient(self) -> None:
        params = _valid_params()
        del params["password"]
        params["private_key"] = "/keys/id_ed25519"

        await SSHSessionOpenPlugin().validate(params)

    async def test_port_zero_is_out_of_range(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'port' must be between 1 and 65535$"):
            await SSHSessionOpenPlugin().validate(_valid_params(port=0))

    async def test_port_above_range(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'port' must be between 1 and 65535$"):
            await SSHSessionOpenPlugin().validate(_valid_params(port=65536))

    async def test_non_integer_port(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'port' must be between 1 and 65535$"):
            await SSHSessionOpenPlugin().validate(_valid_params(port="22"))

    async def test_valid_port_passes(self) -> None:
        await SSHSessionOpenPlugin().validate(_valid_params(port=2222))

    async def test_a_null_port_is_not_checked(self) -> None:
        """A Port with no value runs on 22 (SSH-10)."""
        await SSHSessionOpenPlugin().validate(_valid_params(port=None))

    async def test_an_empty_text_port_is_refused(self) -> None:
        """Empty text is text, not a missing value (SSH-10)."""
        with pytest.raises(ValueError, match=r"^Parameter 'port' must be between 1 and 65535$"):
            await SSHSessionOpenPlugin().validate(_valid_params(port=""))

    @pytest.mark.parametrize("bad", [True, False, 22.5], ids=["true", "false", "float"])
    async def test_a_port_that_is_not_a_whole_number_is_out_of_range(self, bad: Any) -> None:
        with pytest.raises(ValueError, match=exact(_PORT_RANGE)):
            await SSHSessionOpenPlugin().validate(_valid_params(port=bad))

    async def test_zero_connect_timeout(self) -> None:
        with pytest.raises(ValueError, match=r"^Connect timeout must be at least 1$"):
            await SSHSessionOpenPlugin().validate(_valid_params(connect_timeout=0))

    async def test_negative_connect_timeout(self) -> None:
        with pytest.raises(ValueError, match=r"^Connect timeout must be at least 1$"):
            await SSHSessionOpenPlugin().validate(_valid_params(connect_timeout=-5))

    async def test_positive_connect_timeout_passes(self) -> None:
        await SSHSessionOpenPlugin().validate(_valid_params(connect_timeout=10))

    @pytest.mark.parametrize(
        "name", ["connect_timeout", "keep_alive_interval", "keep_alive_max_count"]
    )
    @pytest.mark.parametrize(
        "bad", [1.5, "30", True, False], ids=["float", "text", "true", "false"]
    )
    async def test_a_number_row_that_is_not_a_whole_number_is_refused(
        self, name: str, bad: Any
    ) -> None:
        with pytest.raises(ValueError, match=exact(f"Parameter '{name}' must be an integer")):
            await SSHSessionOpenPlugin().validate(_valid_params(**{name: bad}))

    @pytest.mark.parametrize(
        ("name", "below"),
        [("keep_alive_interval", -1), ("keep_alive_interval", -30), ("keep_alive_max_count", 0)],
    )
    async def test_a_keepalive_row_below_its_floor_is_refused(self, name: str, below: int) -> None:
        with pytest.raises(ValueError, match=exact(_FLOOR_MESSAGES[name])):
            await SSHSessionOpenPlugin().validate(_valid_params(**{name: below}))

    @pytest.mark.parametrize(
        ("name", "value"),
        [("keep_alive_interval", 0), ("keep_alive_interval", 15), ("keep_alive_max_count", 5)],
    )
    async def test_a_keepalive_row_within_its_bounds_passes(self, name: str, value: int) -> None:
        await SSHSessionOpenPlugin().validate(_valid_params(**{name: value}))

    @pytest.mark.parametrize(
        "name", ["connect_timeout", "keep_alive_interval", "keep_alive_max_count"]
    )
    @pytest.mark.parametrize("blank", [None, ""], ids=["none", "empty"])
    async def test_a_blank_number_row_is_not_checked(self, name: str, blank: Any) -> None:
        await SSHSessionOpenPlugin().validate(_valid_params(**{name: blank}))

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            (
                {"password": "", "private_key": "", "port": 0},
                "SSH Session Open requires either 'password' or 'private_key'",
            ),
            ({"port": 0, "connect_timeout": "30"}, _PORT_RANGE),
            (
                {"connect_timeout": "30", "keep_alive_interval": "0"},
                "Parameter 'connect_timeout' must be an integer",
            ),
            (
                {"keep_alive_interval": "15", "keep_alive_max_count": "3"},
                "Parameter 'keep_alive_interval' must be an integer",
            ),
            (
                {"connect_timeout": 0, "keep_alive_max_count": 2.5},
                "Parameter 'keep_alive_max_count' must be an integer",
            ),
            ({"connect_timeout": 0, "keep_alive_interval": -1}, _FLOOR_MESSAGES["connect_timeout"]),
            (
                {"keep_alive_interval": -1, "keep_alive_max_count": 0},
                _FLOOR_MESSAGES["keep_alive_interval"],
            ),
            (
                {"keep_alive_max_count": 0, "host_key_verification": "yolo"},
                _FLOOR_MESSAGES["keep_alive_max_count"],
            ),
            (
                {"connect_timeout": True, "host_key_verification": "yolo"},
                "Parameter 'connect_timeout' must be an integer",
            ),
        ],
        ids=[
            "auth before port",
            "port before integers",
            "connect timeout integer first",
            "keepalive interval integer before max count",
            "every integer check before any floor",
            "connect timeout floor first",
            "keepalive interval floor before max count",
            "floors before the host key policy",
            "integers before the host key policy",
        ],
    )
    async def test_checks_run_in_order(self, overrides: dict[str, Any], message: str) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            await SSHSessionOpenPlugin().validate(_valid_params(**overrides))

    async def test_invalid_host_key_verification(self) -> None:
        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'host_key_verification' must be one of: "
                r"strict, accept-new, disabled; Actual value was 'yolo'\.$"
            ),
        ):
            await SSHSessionOpenPlugin().validate(_valid_params(host_key_verification="yolo"))

    async def test_long_invalid_enum_value_shows_length_not_content(self) -> None:
        long_value = "x" * 60
        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'host_key_verification' must be one of: "
                r"strict, accept-new, disabled; Actual value was a 60-character value\.$"
            ),
        ):
            await SSHSessionOpenPlugin().validate(_valid_params(host_key_verification=long_value))

    async def test_all_host_key_modes_pass(self) -> None:
        plugin = SSHSessionOpenPlugin()
        for mode in ("strict", "accept-new", "disabled"):
            await plugin.validate(_valid_params(host_key_verification=mode))


class TestExecuteSingleHop:
    """execute() - direct connection, outputs, registry registration."""

    async def test_outputs_shape(self) -> None:
        registry, _pushes = _make_registry()
        conn = _make_conn(banner="SSH-2.0-OpenSSH_9.6")
        context = _make_context(registry)

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(conn),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        assert result["session_id"].startswith("ssh_session_")
        assert result["connected"] is True
        assert result["server_banner"] == "SSH-2.0-OpenSSH_9.6"
        assert result["hop_count"] == 1

    async def test_session_registers_in_the_run_registry(self) -> None:
        registry, _pushes = _make_registry()
        conn = _make_conn()
        context = _make_context(registry)

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(conn),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        record = registry.get(result["session_id"])
        assert record is not None
        assert record["connection"] is conn
        assert record["parent_id"] is None
        assert record["host"] == "node-1"
        assert record["connected_var"] == "conn_ok"
        assert record["monitor_task"] is None

    async def test_connects_without_a_tunnel(self) -> None:
        registry, _pushes = _make_registry()
        open_mock = _opened(_make_conn())
        context = _make_context(registry)

        with patch("wavecore.plugins.ssh_session_open.open_connection", new=open_mock):
            await SSHSessionOpenPlugin().execute(context)

        args = open_mock.call_args
        tunnel = args.kwargs.get("tunnel", args.args[1] if len(args.args) > 1 else None)
        assert tunnel is None

    async def test_unbound_connected_output_registers_none(self) -> None:
        registry, _pushes = _make_registry()
        context = _make_context(registry, output_bindings={"session_id": "sid_var"})

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        record = registry.get(result["session_id"])
        assert record is not None
        assert record["connected_var"] is None

    async def test_each_open_yields_a_distinct_session_id(self) -> None:
        registry, _pushes = _make_registry()

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            first = await SSHSessionOpenPlugin().execute(_make_context(registry))
            second = await SSHSessionOpenPlugin().execute(_make_context(registry))

        assert first["session_id"] != second["session_id"]

    async def test_connection_failure_propagates(self) -> None:
        registry, _pushes = _make_registry()
        context = _make_context(registry)

        with (
            patch(
                "wavecore.plugins.ssh_session_open.open_connection",
                new=AsyncMock(
                    side_effect=ConnectionError(
                        "SSH connection to node-1:22 failed: connection refused"
                    )
                ),
            ),
            pytest.raises(
                ConnectionError,
                match=r"^SSH connection to node-1:22 failed: connection refused$",
            ),
        ):
            await SSHSessionOpenPlugin().execute(context)

    async def test_failed_connection_registers_nothing(self) -> None:
        registry, _pushes = _make_registry()
        context = _make_context(registry)

        with (
            patch.object(registry, "register", wraps=registry.register) as register_spy,
            patch(
                "wavecore.plugins.ssh_session_open.open_connection",
                new=AsyncMock(side_effect=ConnectionError("SSH connection to node-1:22 failed: x")),
            ),
            contextlib.suppress(ConnectionError),
        ):
            await SSHSessionOpenPlugin().execute(context)

        register_spy.assert_not_called()

    async def test_a_host_key_refused_later_drops_the_session_and_says_why(self) -> None:
        registry, pushes = _make_registry()
        logger = MagicMock()
        context = _make_context(registry, logger=logger)
        check = MagicMock(on_refused=None)

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn(), check),
        ):
            result = await SSHSessionOpenPlugin().execute(context)
        check.on_refused("key-changed")

        assert registry.get(result["session_id"]) is None
        assert ("conn_ok", False) in pushes
        logger.error.assert_called_once_with(
            f"SSH session '{result['session_id']}' dropped: SSH host key verification failed "
            "for node-1:22: the host offered a key that differs from the one in WAVE's trusted "
            "hosts list. Check Settings > Network > SSH Hosts"
        )


def _lab_key(home: Path) -> tuple[Any, bytes]:
    """A private key at <home>/keys/id_lab and the exact bytes of that file."""
    key = asyncssh.generate_private_key("ssh-ed25519")
    data = key.export_private_key("openssh")
    folder = home / "keys"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "id_lab").write_bytes(data)
    return key, data


def _stray_siblings(home: Path, key: Any) -> None:
    """Files ssh would load beside the key: another key's public half and a certificate."""
    folder = home / "keys"
    (folder / "id_lab.pub").write_bytes(
        asyncssh.generate_private_key("ssh-ed25519").export_public_key("openssh")
    )
    authority = asyncssh.generate_private_key("ssh-ed25519")
    certificate = authority.generate_user_certificate(key, "lab", principals=["wave"])
    (folder / "id_lab-cert.pub").write_bytes(certificate.export_certificate())


def _key_file_params(**overrides: Any) -> dict[str, Any]:
    """Key login naming the Private Key by a path relative to the home folder."""
    params = _valid_params(password="", private_key="keys/id_lab", host_key_verification="disabled")
    params.update(overrides)
    return params


class TestThePrivateKeyIsReadByWave:
    """A Private Key path is read by WAVE from the home folder rule (REQ-4.5.4, REQ-3.4.3.12)."""

    async def test_a_relative_path_is_read_from_the_home_folder_and_passed_as_bytes(
        self, server_home: Path
    ) -> None:
        _key, data = _lab_key(server_home)
        registry, _pushes = _make_registry()
        connect_mock = AsyncMock(return_value=_make_conn())

        with patch("wavecore.plugins._ssh_session.asyncssh.connect", new=connect_mock):
            await SSHSessionOpenPlugin().execute(_make_context(registry, params=_key_file_params()))

        assert connect_mock.call_args.kwargs["client_keys"] == [data]

    async def test_a_missing_key_file_is_refused_before_connecting(self) -> None:
        registry, _pushes = _make_registry()
        connect_mock = AsyncMock(return_value=_make_conn())

        with (
            patch.object(registry, "register", wraps=registry.register) as register_spy,
            patch("wavecore.plugins._ssh_session.asyncssh.connect", new=connect_mock),
            pytest.raises(ValueError, match=r"^Private Key file not found: /.+/keys/id_lab$"),
        ):
            await SSHSessionOpenPlugin().execute(_make_context(registry, params=_key_file_params()))

        connect_mock.assert_not_called()
        register_spy.assert_not_called()

    async def test_the_missing_message_names_the_home_folder_path(self, server_home: Path) -> None:
        registry, _pushes = _make_registry()
        missing = server_home / "keys" / "id_lab"

        with pytest.raises(ValueError, match=exact(f"Private Key file not found: {missing}")):
            await SSHSessionOpenPlugin().execute(_make_context(registry, params=_key_file_params()))

    async def test_an_unreadable_key_file_is_refused_with_the_reason(
        self, server_home: Path
    ) -> None:
        unreadable = server_home / "keys" / "id_lab"
        unreadable.mkdir(parents=True)
        registry, _pushes = _make_registry()

        with pytest.raises(
            ValueError,
            match="^" + re.escape(f"Private Key file {unreadable} cannot be read: ") + ".+$",
        ):
            await SSHSessionOpenPlugin().execute(_make_context(registry, params=_key_file_params()))

    async def test_the_unreadable_message_has_the_documented_shape(self, server_home: Path) -> None:
        (server_home / "keys" / "id_lab").mkdir(parents=True)
        registry, _pushes = _make_registry()

        with pytest.raises(ValueError, match=r"^Private Key file /.+ cannot be read: .+$"):
            await SSHSessionOpenPlugin().execute(_make_context(registry, params=_key_file_params()))

    async def test_the_key_file_logs_in_and_its_stray_siblings_are_not_loaded(
        self, key_endpoint: KeyEndpoint, server_home: Path
    ) -> None:
        key, _data = _lab_key(server_home)
        _stray_siblings(server_home, key)
        key_endpoint.authorize(key)
        registry = SSHSessionRegistry()
        params = _key_file_params(host="127.0.0.1", port=key_endpoint.port)

        async with _opened_session(registry, params) as result:
            assert result["connected"] is True

        assert [k.public_data for k in key_endpoint.offered_keys] == [key.public_data]

    async def test_inline_pem_content_still_logs_in(self, key_endpoint: KeyEndpoint) -> None:
        key = asyncssh.generate_private_key("ssh-ed25519")
        key_endpoint.authorize(key)
        registry = SSHSessionRegistry()
        params = _key_file_params(
            host="127.0.0.1",
            port=key_endpoint.port,
            private_key=key.export_private_key("openssh").decode(),
        )

        async with _opened_session(registry, params) as result:
            assert result["connected"] is True

        assert [k.public_data for k in key_endpoint.offered_keys] == [key.public_data]


class TestExecuteParentChain:
    """execute() - multi-hop by parent linkage."""

    async def test_parent_connection_is_used_as_tunnel(self) -> None:
        registry, _pushes = _make_registry()
        parent_conn = MagicMock()
        registry.register("parent-1", parent_conn, None, "bastion", None, None, connect_timeout=30)
        open_mock = _opened(_make_conn())
        context = _make_context(
            registry, params=_valid_params(use_parent=True, parent_session_id="parent-1")
        )

        with patch("wavecore.plugins.ssh_session_open.open_connection", new=open_mock):
            await SSHSessionOpenPlugin().execute(context)

        args = open_mock.call_args
        tunnel = args.kwargs.get("tunnel", args.args[1] if len(args.args) > 1 else None)
        assert tunnel is parent_conn

    async def test_child_records_its_parent_link(self) -> None:
        registry, _pushes = _make_registry()
        registry.register("parent-1", MagicMock(), None, "bastion", None, None, connect_timeout=30)
        context = _make_context(
            registry, params=_valid_params(use_parent=True, parent_session_id="parent-1")
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        record = registry.get(result["session_id"])
        assert record is not None
        assert record["parent_id"] == "parent-1"

    async def test_hop_count_counts_the_chain(self) -> None:
        registry, _pushes = _make_registry()
        registry.register("hop-1", MagicMock(), None, "bastion-1", None, None, connect_timeout=30)
        registry.register(
            "hop-2", MagicMock(), "hop-1", "bastion-2", None, None, connect_timeout=30
        )
        context = _make_context(
            registry, params=_valid_params(use_parent=True, parent_session_id="hop-2")
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        assert result["hop_count"] == 3

    async def test_direct_child_of_a_root_session_is_hop_2(self) -> None:
        registry, _pushes = _make_registry()
        registry.register("parent-1", MagicMock(), None, "bastion", None, None, connect_timeout=30)
        context = _make_context(
            registry, params=_valid_params(use_parent=True, parent_session_id="parent-1")
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        assert result["hop_count"] == 2

    async def test_unknown_parent_raises(self) -> None:
        registry, _pushes = _make_registry()
        context = _make_context(
            registry, params=_valid_params(use_parent=True, parent_session_id="nope")
        )

        with pytest.raises(
            ValueError,
            match=r"^Parent SSH session 'nope' not found or already closed$",
        ):
            await SSHSessionOpenPlugin().execute(context)

    async def test_use_parent_off_connects_directly(self) -> None:
        # Chain-through-parent OFF ignores any parent_session_id and connects direct.
        registry, _pushes = _make_registry()
        open_mock = _opened(_make_conn())
        context = _make_context(
            registry, params=_valid_params(use_parent=False, parent_session_id="parent-1")
        )

        with patch("wavecore.plugins.ssh_session_open.open_connection", new=open_mock):
            result = await SSHSessionOpenPlugin().execute(context)

        args = open_mock.call_args
        tunnel = args.kwargs.get("tunnel", args.args[1] if len(args.args) > 1 else None)
        assert tunnel is None
        assert result["hop_count"] == 1

    async def test_use_parent_on_with_unresolved_parent_raises(self) -> None:
        # Chain-through-parent ON but the parent reference resolved empty (the
        # parent isn't open) - must FAIL, never silently connect direct to the host.
        registry, _pushes = _make_registry()
        open_mock = _opened(_make_conn())
        context = _make_context(
            registry, params=_valid_params(use_parent=True, parent_session_id="")
        )

        with patch("wavecore.plugins.ssh_session_open.open_connection", new=open_mock):
            with pytest.raises(ValueError, match="Parent SSH session"):
                await SSHSessionOpenPlugin().execute(context)

        open_mock.assert_not_called()


class TestExecuteLogging:
    """execute() - INFO narrative of the connect (users should see it happen)."""

    async def test_logs_connecting_and_connected_at_info(self) -> None:
        registry, _pushes = _make_registry()
        logger = MagicMock()
        context = _make_context(registry, logger=logger)

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn(banner="SSH-2.0-OpenSSH_9.6")),
        ):
            await SSHSessionOpenPlugin().execute(context)

        messages = [call.args[0] for call in logger.info.call_args_list]
        assert any(m.startswith("Connecting to wave@node-1:22") for m in messages)
        assert any(
            m.startswith("Connected to node-1 (session ssh_session_")
            and "1 hop" in m
            and "SSH-2.0-OpenSSH_9.6" in m
            for m in messages
        )

    async def test_logs_via_parent_when_chained(self) -> None:
        registry, _pushes = _make_registry()
        registry.register("parent-1", MagicMock(), None, "bastion", None, None, connect_timeout=30)
        logger = MagicMock()
        context = _make_context(
            registry,
            logger=logger,
            params=_valid_params(use_parent=True, parent_session_id="parent-1"),
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            await SSHSessionOpenPlugin().execute(context)

        messages = [call.args[0] for call in logger.info.call_args_list]
        assert any("via parent session 'parent-1'" in m for m in messages)
        assert any("2 hops" in m for m in messages)

    async def test_a_direct_session_is_connected_in_1_hop(self) -> None:
        registry, _pushes = _make_registry()
        logger = MagicMock()

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn(banner="SSH-2.0-OpenSSH_9.6")),
        ):
            result = await SSHSessionOpenPlugin().execute(_make_context(registry, logger=logger))

        assert (
            call(
                f"Connected to node-1 (session {result['session_id']}, 1 hop) - SSH-2.0-OpenSSH_9.6"
            )
            in logger.info.call_args_list
        )

    async def test_a_session_chained_on_a_root_is_connected_in_2_hops(self) -> None:
        registry, _pushes = _make_registry()
        registry.register("parent-1", MagicMock(), None, "bastion", None, None, connect_timeout=30)
        logger = MagicMock()
        params = _valid_params(use_parent=True, parent_session_id="parent-1")

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn(banner="")),
        ):
            result = await SSHSessionOpenPlugin().execute(
                _make_context(registry, params=params, logger=logger)
            )

        assert (
            call(f"Connected to node-1 (session {result['session_id']}, 2 hops)")
            in logger.info.call_args_list
        )


class TestKeepaliveMonitor:
    """execute() - keepalive liveness monitor."""

    @staticmethod
    def _closable_conn() -> tuple[MagicMock, asyncio.Event]:
        closed = asyncio.Event()
        conn = _make_conn()

        async def _wait_closed() -> None:
            await closed.wait()

        conn.wait_closed = _wait_closed
        return conn, closed

    async def test_keepalive_starts_a_monitor_task(self) -> None:
        registry, _pushes = _make_registry()
        conn, closed = self._closable_conn()
        context = _make_context(registry, params=_valid_params(keep_alive_interval=15))

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(conn),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        record = registry.get(result["session_id"])
        assert record is not None
        task = record["monitor_task"]
        assert isinstance(task, asyncio.Task)
        assert not task.done()

        closed.set()
        await asyncio.wait_for(task, timeout=1)

    async def test_drop_flips_the_bound_connected_variable(self) -> None:
        registry, pushes = _make_registry()
        conn, closed = self._closable_conn()
        variables: dict[str, Any] = {}
        context = _make_context(
            registry,
            params=_valid_params(keep_alive_interval=15),
            variables=variables,
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(conn),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        task = registry.get(result["session_id"])["monitor_task"]  # type: ignore[index]
        closed.set()
        await asyncio.wait_for(task, timeout=1)

        assert variables["conn_ok"] is False
        assert pushes == [("conn_ok", False)]

    async def test_drop_logs_a_warn_and_removes_the_session(self) -> None:
        registry, _pushes = _make_registry()
        conn, closed = self._closable_conn()
        logger = MagicMock()
        context = _make_context(
            registry, params=_valid_params(keep_alive_interval=15), logger=logger
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(conn),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        session_id = result["session_id"]
        task = registry.get(session_id)["monitor_task"]  # type: ignore[index]
        closed.set()
        await asyncio.wait_for(task, timeout=1)

        logger.warning.assert_any_call(f"SSH session '{session_id}' lost: keepalive timeout")
        assert registry.get(session_id) is None

    async def test_drop_without_a_connected_binding_pushes_nothing(self) -> None:
        registry, pushes = _make_registry()
        conn, closed = self._closable_conn()
        variables: dict[str, Any] = {}
        context = _make_context(
            registry,
            params=_valid_params(keep_alive_interval=15),
            output_bindings={"session_id": "sid_var"},
            variables=variables,
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(conn),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        task = registry.get(result["session_id"])["monitor_task"]  # type: ignore[index]
        closed.set()
        await asyncio.wait_for(task, timeout=1)

        assert pushes == []
        assert variables == {}
        assert registry.get(result["session_id"]) is None

    async def test_deliberate_close_cancels_the_monitor_without_a_warn(self) -> None:
        # Deliberate close flips the bound Connected variable silently:
        # the WARN stays exclusive to keepalive-detected loss.
        registry, pushes = _make_registry()
        conn, _closed = self._closable_conn()
        logger = MagicMock()
        variables: dict[str, Any] = {}
        context = _make_context(
            registry,
            params=_valid_params(keep_alive_interval=15),
            variables=variables,
            logger=logger,
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(conn),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        session_id = result["session_id"]
        task = registry.get(session_id)["monitor_task"]  # type: ignore[index]
        registry.close(session_id)
        with contextlib.suppress(asyncio.CancelledError):
            await task

        assert task.cancelled()
        logger.warning.assert_not_called()
        assert pushes == [("conn_ok", False)]
        assert variables["conn_ok"] is False

    async def test_no_keepalive_means_no_monitor(self) -> None:
        registry, _pushes = _make_registry()
        conn = _make_conn()
        context = _make_context(registry, params=_valid_params(keep_alive_interval=0))

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(conn),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        record = registry.get(result["session_id"])
        assert record is not None
        assert record["monitor_task"] is None


class TestExecuteWithBlankNumberRows:
    """A present-but-blank row runs with its default, never with the blank value (SSH-9)."""

    @pytest.mark.parametrize("blank", [None, ""], ids=["none", "empty"])
    async def test_a_blank_port_and_keepalive_interval_run_with_22_and_0(self, blank: Any) -> None:
        registry, _pushes = _make_registry()
        logger = MagicMock()
        context = _make_context(
            registry,
            params=_valid_params(port=blank, keep_alive_interval=blank),
            logger=logger,
        )

        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            result = await SSHSessionOpenPlugin().execute(context)

        record = registry.get(result["session_id"])
        assert record is not None
        assert record["monitor_task"] is None
        assert call("Connecting to wave@node-1:22...") in logger.info.call_args_list

    async def test_a_null_port_passes_validate_and_connects_on_22(self) -> None:
        """Validate and execute agree: a Port with no value is SSH's own 22 (SSH-10)."""
        registry, _pushes = _make_registry()
        params = _valid_params(port=None, host_key_verification="disabled")
        connect = AsyncMock(return_value=_make_conn())
        plugin = SSHSessionOpenPlugin()

        await plugin.validate(params)
        with patch("wavecore.plugins._ssh_session.asyncssh.connect", new=connect):
            await plugin.execute(_make_context(registry, params=params))

        assert connect.await_args is not None
        assert connect.await_args.kwargs["host"] == "node-1"
        assert connect.await_args.kwargs["port"] == 22


class TestTheSessionRecordKeepsTheConnectionTimeout:
    """The record keeps the resolved Connection Timeout that bounds Validate Target (SSHTUN-7)."""

    async def _record_for(self, params: dict[str, Any]) -> dict[str, Any]:
        registry, _pushes = _make_registry()
        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            result = await SSHSessionOpenPlugin().execute(_make_context(registry, params=params))
        record = registry.get(result["session_id"])
        assert record is not None
        return record

    async def test_a_given_connection_timeout_is_stored(self) -> None:
        record = await self._record_for(_valid_params(connect_timeout=7))

        assert record["connect_timeout"] == 7

    @pytest.mark.parametrize("blank", ["absent", None, ""], ids=["absent", "none", "empty"])
    async def test_a_blank_connection_timeout_is_stored_as_30(self, blank: Any) -> None:
        params = _valid_params()
        if blank != "absent":
            params["connect_timeout"] = blank

        record = await self._record_for(params)

        assert record["connect_timeout"] == 30


_INCORRECT_PASSPHRASE = "Incorrect passphrase"
_PASSPHRASE_MISSING = "Passphrase must be specified to import encrypted private keys"
_PKCS8_NOT_DECRYPTED = "Unable to decrypt PKCS#8 private key"
_PKCS1_NOT_DECRYPTED = "Unable to decrypt PKCS#1 private key"
_PASSPHRASE = "correct horse battery"


@functools.cache
def _rsa_key() -> Any:
    """One RSA key per run: PKCS#1 holds RSA keys only, and generating one is slow."""
    return asyncssh.generate_private_key("ssh-rsa")


def _encrypted_key(export_format: str) -> tuple[Any, str]:
    """A key `export_format` can hold, and its private half exported under _PASSPHRASE."""
    key = (
        _rsa_key() if export_format == "pkcs1-pem" else asyncssh.generate_private_key("ssh-ed25519")
    )
    # One key-derivation round keeps the bcrypt of the OpenSSH format fast.
    exported = key.export_private_key(
        export_format, passphrase=_PASSPHRASE, rounds=1, ignore_few_rounds=True
    ).decode()
    return key, exported


_KEY_FORMATS = pytest.mark.parametrize(
    ("export_format", "wrong_passphrase_detail"),
    [
        ("openssh", _INCORRECT_PASSPHRASE),
        ("pkcs8-pem", _PKCS8_NOT_DECRYPTED),
        ("pkcs1-pem", _PKCS1_NOT_DECRYPTED),
    ],
    ids=["openssh", "pkcs8-pem", "pkcs1-pem"],
)


def _key_params(endpoint: KeyEndpoint, private_key: str, passphrase: str) -> dict[str, Any]:
    """Key login to the loopback server with Password left empty."""
    return {
        "host": "127.0.0.1",
        "port": endpoint.port,
        "username": "wave",
        "password": "",
        "private_key": private_key,
        "passphrase": passphrase,
        "host_key_verification": "disabled",
    }


@asynccontextmanager
async def _opened_session(
    registry: SSHSessionRegistry, params: dict[str, Any], logger: Any | None = None
) -> AsyncIterator[dict[str, Any]]:
    """Validate and run Session Open for real, then hang the live session up."""
    plugin = SSHSessionOpenPlugin()
    await plugin.validate(params)
    result = await plugin.execute(plugin_context(registry, params, logger))
    record = registry.get(result["session_id"])
    assert record is not None
    connection = record["connection"]
    try:
        yield result
    finally:
        registry.close_all()
        await asyncio.wait_for(connection.wait_closed(), 5)


async def _refused(registry: SSHSessionRegistry, params: dict[str, Any], message: str) -> None:
    """Session Open fails with exactly `message`; a session it opened anyway is hung up."""
    try:
        with pytest.raises(ConnectionError, match=exact(message)):
            await SSHSessionOpenPlugin().execute(plugin_context(registry, params))
    finally:
        registry.close_all()


class TestPassphraseProtectedKeys:
    """An encrypted private key unlocks in every format ssh-keygen writes (SSH-7, REQ-4.5.4)."""

    @_KEY_FORMATS
    async def test_the_passphrase_unlocks_the_key_and_opens_the_session(
        self, key_endpoint: KeyEndpoint, export_format: str, wrong_passphrase_detail: str
    ) -> None:
        key, exported = _encrypted_key(export_format)
        key_endpoint.authorize(key)
        registry = SSHSessionRegistry()

        async with _opened_session(
            registry, _key_params(key_endpoint, exported, _PASSPHRASE)
        ) as result:
            assert result["connected"] is True
            assert result["hop_count"] == 1
            assert registry.get(result["session_id"]) is not None

        assert key.public_data in [k.public_data for k in key_endpoint.offered_keys]

    @_KEY_FORMATS
    async def test_a_wrong_passphrase_is_refused_with_the_reason(
        self, key_endpoint: KeyEndpoint, export_format: str, wrong_passphrase_detail: str
    ) -> None:
        key, exported = _encrypted_key(export_format)
        key_endpoint.authorize(key)
        registry = SSHSessionRegistry()
        params = _key_params(key_endpoint, exported, "not the passphrase")

        await _refused(
            registry,
            params,
            f"SSH connection to 127.0.0.1:{key_endpoint.port} failed: {wrong_passphrase_detail}",
        )

        assert key_endpoint.offered_keys == []

    @_KEY_FORMATS
    async def test_an_empty_passphrase_is_refused(
        self, key_endpoint: KeyEndpoint, export_format: str, wrong_passphrase_detail: str
    ) -> None:
        key, exported = _encrypted_key(export_format)
        key_endpoint.authorize(key)
        registry = SSHSessionRegistry()
        params = _key_params(key_endpoint, exported, "")

        await _refused(
            registry,
            params,
            f"SSH connection to 127.0.0.1:{key_endpoint.port} failed: {_PASSPHRASE_MISSING}",
        )


FAR_HOST = "far.internal"


def _another_key() -> Any:
    """A host key that is not the one the loopback server presents."""
    return asyncssh.generate_private_key("ssh-ed25519")


def _entry(host: str, port: int, key: Any = None) -> tuple[str, int, str]:
    """A trusted hosts entry, holding the loopback server's key unless told otherwise."""
    return (host, port, public_key_text(key or HOST_KEY))


def _through_tunnel(destination: str, endpoint: SSHEndpoint) -> SSHSessionRegistry:
    """A run where an open tunnel's Local Port is the loopback server's port."""
    return tunnel_registry({endpoint.port: destination}, MagicMock())


def _tunnel_params(endpoint: SSHEndpoint, mode: str, host: str = "127.0.0.1") -> dict[str, Any]:
    """Session Open aimed at the tunnel's Local Port, under one host key policy."""
    return {
        "host": host,
        "port": endpoint.port,
        "username": "wave",
        "password": "s3cr3t-pw",
        "host_key_verification": mode,
    }


def _unset_params(endpoint: SSHEndpoint) -> dict[str, Any]:
    """Session Open aimed at the loopback server, carrying no host key setting at all."""
    return {
        "host": "127.0.0.1",
        "port": endpoint.port,
        "username": "wave",
        "password": "s3cr3t-pw",
    }


def _tunnel_line(port: int, far: str) -> str:
    return (
        f"SSH tunnel detected on local port {port}: the host key is checked and recorded for {far}"
    )


def _info(logger: MagicMock) -> list[str]:
    return [entry.args[0] for entry in logger.info.call_args_list]


class TestHostKeyUnderTheTunnelsFarHost:
    """A session on a tunnel's Local Port is verified under the far host and port (SSH-8)."""

    @pytest.mark.parametrize("host", ["127.0.0.1", "localhost"])
    async def test_accept_new_records_the_far_host_never_the_loopback_port(
        self, ssh_endpoint: SSHEndpoint, host: str
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)

        async with _opened_session(
            registry, _tunnel_params(ssh_endpoint, "accept-new", host)
        ) as result:
            record = registry.get(result["session_id"])
            assert record is not None
            assert record["host"] == host

        assert trusted_entries() == [_entry(FAR_HOST, 22)]

    async def test_a_far_port_other_than_22_is_recorded_with_the_port(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:2222", ssh_endpoint)

        async with _opened_session(registry, _tunnel_params(ssh_endpoint, "accept-new")):
            pass

        assert trusted_entries() == [_entry(FAR_HOST, 2222)]

    @pytest.mark.parametrize(
        ("destination", "port"),
        [
            ("127.0.0.1:2200", 2200),
            ("localhost:2200", 2200),
            ("::1:2200", 2200),
            ("localhost:22", 22),
        ],
        ids=["address", "name", "ipv6", "port 22"],
    )
    async def test_a_loopback_far_host_is_the_tunnel_sessions_own_host(
        self, ssh_endpoint: SSHEndpoint, destination: str, port: int
    ) -> None:
        registry = _through_tunnel(destination, ssh_endpoint)

        async with _opened_session(registry, _tunnel_params(ssh_endpoint, "accept-new")):
            pass

        assert trusted_entries() == [_entry(SSH_HOST, port)]

    async def test_a_loopback_far_end_on_a_session_through_a_tunnel_records_its_far_host(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)
        params = _tunnel_params(ssh_endpoint, "accept-new")
        logger = MagicMock()

        async with _opened_session(registry, params) as first:
            registry.close_tunnel(f"t{ssh_endpoint.port}")
            registry.add_tunnel(
                first["session_id"], "t-inner", MagicMock(), ssh_endpoint.port, "127.0.0.1:2200"
            )
            async with _opened_session(registry, params, logger) as second:
                record = registry.get(second["session_id"])
                assert record is not None
                assert record["host_identity"] == FAR_HOST

        assert _tunnel_line(ssh_endpoint.port, f"{FAR_HOST}:2200") in _info(logger)
        assert trusted_entries() == [_entry(FAR_HOST, 22), _entry(FAR_HOST, 2200)]

    async def test_accept_new_reuses_the_far_host_record_on_the_next_session(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)
        params = _tunnel_params(ssh_endpoint, "accept-new")

        async with _opened_session(registry, params):
            pass
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)
        async with _opened_session(registry, params):
            pass

        assert trusted_entries() == [_entry(FAR_HOST, 22)]

    async def test_strict_accepts_the_key_recorded_under_the_far_host(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        trust_host(FAR_HOST, 22, HOST_KEY)
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)

        async with _opened_session(registry, _tunnel_params(ssh_endpoint, "strict")) as result:
            assert result["connected"] is True

        assert trusted_entries() == [_entry(FAR_HOST, 22)]

    @pytest.mark.parametrize("mode", ["strict", "accept-new"])
    async def test_a_different_key_recorded_under_the_far_host_is_refused(
        self, ssh_endpoint: SSHEndpoint, mode: str
    ) -> None:
        original = _another_key()
        trust_host(FAR_HOST, 22, original)
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)

        await _refused(
            registry,
            _tunnel_params(ssh_endpoint, mode),
            host_key_refusal(
                f"{FAR_HOST}:22 through the SSH tunnel on 127.0.0.1:{ssh_endpoint.port}",
                KEY_CHANGED,
            ),
        )

        assert trusted_entries() == [_entry(FAR_HOST, 22, original)]
        assert ssh_endpoint.offered_passwords == []

    async def test_strict_refuses_a_far_host_with_no_record(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:2222", ssh_endpoint)

        await _refused(
            registry,
            _tunnel_params(ssh_endpoint, "strict", "localhost"),
            host_key_refusal(
                f"{FAR_HOST}:2222 through the SSH tunnel on localhost:{ssh_endpoint.port}",
                NOT_TRUSTED_STRICT,
            ),
        )

        assert trusted_entries() == []
        assert ssh_endpoint.offered_passwords == []

    async def test_a_key_recorded_under_the_loopback_port_is_not_trusted_for_the_far_host(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        ssh_endpoint.trust()
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)

        await _refused(
            registry,
            _tunnel_params(ssh_endpoint, "strict"),
            host_key_refusal(
                f"{FAR_HOST}:22 through the SSH tunnel on 127.0.0.1:{ssh_endpoint.port}",
                NOT_TRUSTED_STRICT,
            ),
        )

    async def test_accept_new_while_locked_refuses_the_far_host_with_the_lock_text(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        set_lock(True)
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)

        await _refused(
            registry,
            _tunnel_params(ssh_endpoint, "accept-new"),
            host_key_refusal(
                f"{FAR_HOST}:22 through the SSH tunnel on 127.0.0.1:{ssh_endpoint.port}",
                NOT_TRUSTED_LOCKED,
            ),
        )

        assert trusted_entries() == []
        assert ssh_endpoint.offered_passwords == []

    async def test_a_refused_later_exchange_drops_the_session_naming_the_far_host(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)
        logger = MagicMock()
        opened: list[OpenedSSHConnection] = []

        async def keeps_what_it_opened(*args: Any, **kwargs: Any) -> OpenedSSHConnection:
            result = await open_connection(*args, **kwargs)
            opened.append(result)
            return result

        with patch("wavecore.plugins.ssh_session_open.open_connection", new=keeps_what_it_opened):
            result = await SSHSessionOpenPlugin().execute(
                plugin_context(registry, _tunnel_params(ssh_endpoint, "accept-new"), logger)
            )
        connection, check = opened[0]
        try:
            assert check is not None
            check.validate_host_public_key(
                "127.0.0.1", "127.0.0.1", ssh_endpoint.port, _another_key().convert_to_public()
            )
            connection.close()
            await asyncio.wait_for(connection.wait_closed(), 5)

            assert registry.get(result["session_id"]) is None
            logger.error.assert_called_once_with(
                f"SSH session '{result['session_id']}' dropped: "
                + host_key_refusal(
                    f"{FAR_HOST}:22 through the SSH tunnel on 127.0.0.1:{ssh_endpoint.port}",
                    KEY_CHANGED,
                )
            )
        finally:
            registry.close_all()


class TestTunnelDetectedLine:
    """Session Open says when it checks a host key under a tunnel's far host (SSH-8)."""

    @pytest.mark.parametrize("mode", ["strict", "accept-new"])
    async def test_the_line_names_the_local_port_and_the_far_host(
        self, ssh_endpoint: SSHEndpoint, mode: str
    ) -> None:
        trust_host(FAR_HOST, 2222, HOST_KEY)
        registry = _through_tunnel(f"{FAR_HOST}:2222", ssh_endpoint)
        logger = MagicMock()

        async with _opened_session(registry, _tunnel_params(ssh_endpoint, mode), logger):
            pass

        line = _tunnel_line(ssh_endpoint.port, f"{FAR_HOST}:2222")
        assert logger.info.call_args_list.count(call(line)) == 1
        logger.warning.assert_not_called()
        logger.error.assert_not_called()

    async def test_the_line_names_the_tunnel_sessions_host_for_a_loopback_far_host(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel("127.0.0.1:2200", ssh_endpoint)
        logger = MagicMock()

        async with _opened_session(registry, _tunnel_params(ssh_endpoint, "accept-new"), logger):
            pass

        line = _tunnel_line(ssh_endpoint.port, f"{SSH_HOST}:2200")
        assert logger.info.call_args_list.count(call(line)) == 1

    async def test_disabled_logs_no_line_and_records_nothing(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)
        logger = MagicMock()

        async with _opened_session(
            registry, _tunnel_params(ssh_endpoint, "disabled"), logger
        ) as result:
            assert result["connected"] is True

        assert not [m for m in _info(logger) if m.startswith("SSH tunnel detected")]
        assert trusted_entries() == []

    async def test_a_block_without_the_host_key_setting_logs_no_line_and_records_nothing(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)
        logger = MagicMock()

        async with _opened_session(registry, _unset_params(ssh_endpoint), logger) as result:
            assert result["connected"] is True

        assert not [m for m in _info(logger) if m.startswith("SSH tunnel detected")]
        assert trusted_entries() == []

    async def test_a_direct_session_on_a_port_with_no_tunnel_logs_no_line(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = tunnel_registry({ssh_endpoint.port + 1: f"{FAR_HOST}:22"}, MagicMock())
        logger = MagicMock()

        async with _opened_session(registry, _tunnel_params(ssh_endpoint, "accept-new"), logger):
            pass

        assert not [m for m in _info(logger) if m.startswith("SSH tunnel detected")]
        assert trusted_entries() == [ssh_endpoint.entry()]


class TestABlockWithoutTheHostKeySetting:
    """A block that carries no host key setting runs with verification off (REQ-4.5.14)."""

    async def test_it_connects_to_an_unknown_host_and_records_nothing(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry, _pushes = _make_registry()

        async with _opened_session(registry, _unset_params(ssh_endpoint)) as result:
            assert result["connected"] is True

        assert trusted_entries() == []
        assert ssh_endpoint.offered_passwords == ["s3cr3t-pw"]

    async def test_it_connects_when_the_trusted_key_differs(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        held = _another_key()
        ssh_endpoint.trust(held)
        registry, _pushes = _make_registry()

        async with _opened_session(registry, _unset_params(ssh_endpoint)) as result:
            assert result["connected"] is True

        assert trusted_entries() == [ssh_endpoint.entry(held)]

    async def test_it_connects_while_trusted_hosts_are_locked(
        self, ssh_endpoint: SSHEndpoint, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_hosts_config(True, "strict"))
        registry, _pushes = _make_registry()

        async with _opened_session(registry, _unset_params(ssh_endpoint)) as result:
            assert result["connected"] is True

        assert trusted_entries() == []

    async def test_the_settings_default_is_not_applied_at_run_time(
        self, ssh_endpoint: SSHEndpoint, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_hosts_config(False, "strict"))
        registry, _pushes = _make_registry()

        async with _opened_session(registry, _unset_params(ssh_endpoint)) as result:
            assert result["connected"] is True

        assert trusted_entries() == []


class TestAcceptNewOnTheBlockUnderTheConfigLock:
    """Accept New set on the block acts as Strict while the config locks the list (REQ-4.5.14)."""

    async def test_an_unknown_host_is_refused_with_the_lock_text(
        self, ssh_endpoint: SSHEndpoint, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_hosts_config(True, "strict"))
        registry, _pushes = _make_registry()
        params = {**_unset_params(ssh_endpoint), "host_key_verification": "accept-new"}

        await _refused(
            registry,
            params,
            host_key_refusal(f"127.0.0.1:{ssh_endpoint.port}", NOT_TRUSTED_LOCKED),
        )

        assert trusted_entries() == []
        assert ssh_endpoint.offered_passwords == []


def _identity_given(open_mock: AsyncMock) -> Any:
    """The host key identity Session Open handed to open_connection, None when it gave none."""
    args = open_mock.call_args
    return args.kwargs.get("host_key_identity", args.args[2] if len(args.args) > 2 else None)


class TestAChainedSessionIgnoresTunnels:
    """With Chain through a parent session on, the parent is the transport: no tunnel lookup."""

    async def test_a_chained_session_on_a_tunnel_port_keeps_its_own_identity(self) -> None:
        registry = tunnel_registry({40022: f"{FAR_HOST}:22"}, MagicMock())
        registry.register("parent-1", MagicMock(), None, "bastion", None, None, connect_timeout=30)
        logger = MagicMock()
        check = MagicMock(on_refused=None)
        open_mock = _opened(_make_conn(), check)
        params = _valid_params(
            host="127.0.0.1", port=40022, use_parent=True, parent_session_id="parent-1"
        )

        with patch("wavecore.plugins.ssh_session_open.open_connection", new=open_mock):
            result = await SSHSessionOpenPlugin().execute(
                _make_context(registry, params=params, logger=logger)
            )
        check.on_refused("key-changed")

        assert _identity_given(open_mock) is None
        assert not [m for m in _info(logger) if m.startswith("SSH tunnel detected")]
        logger.error.assert_called_once_with(
            f"SSH session '{result['session_id']}' dropped: "
            + host_key_refusal("127.0.0.1:40022", KEY_CHANGED)
        )


class TestTheSessionRecordKeepsItsHostIdentity:
    """The host a session identifies with, named as the SSH host in tunnel messages (SSH-8)."""

    async def _identity_of(
        self, registry: SSHSessionRegistry, params: dict[str, Any]
    ) -> dict[str, Any]:
        with patch(
            "wavecore.plugins.ssh_session_open.open_connection",
            new=_opened(_make_conn()),
        ):
            result = await SSHSessionOpenPlugin().execute(_make_context(registry, params=params))
        record = registry.get(result["session_id"])
        assert record is not None
        return record

    async def test_a_direct_session_is_the_host_as_typed(self) -> None:
        registry, _pushes = _make_registry()

        record = await self._identity_of(registry, _valid_params(host="db-gw.example"))

        assert record["host_identity"] == "db-gw.example"

    async def test_a_loopback_host_with_no_tunnel_on_its_port_is_the_host_as_typed(self) -> None:
        registry = tunnel_registry({40023: f"{FAR_HOST}:22"}, MagicMock())

        record = await self._identity_of(registry, _valid_params(host="127.0.0.1", port=40022))

        assert record["host_identity"] == "127.0.0.1"

    async def test_a_chained_session_is_the_host_as_typed(self) -> None:
        registry, _pushes = _make_registry()
        registry.register("parent-1", MagicMock(), None, "bastion", None, None, connect_timeout=30)
        params = _valid_params(host="node-2", use_parent=True, parent_session_id="parent-1")

        record = await self._identity_of(registry, params)

        assert record["host_identity"] == "node-2"

    async def test_a_chained_session_on_a_tunnel_port_is_the_host_as_typed(self) -> None:
        """The parent is the transport, so no tunnel is looked up."""
        registry = tunnel_registry({40022: f"{FAR_HOST}:22"}, MagicMock())
        registry.register("parent-1", MagicMock(), None, "bastion", None, None, connect_timeout=30)
        params = _valid_params(
            host="127.0.0.1", port=40022, use_parent=True, parent_session_id="parent-1"
        )

        record = await self._identity_of(registry, params)

        assert record["host_identity"] == "127.0.0.1"

    @pytest.mark.parametrize("mode", ["strict", "accept-new", "disabled"])
    async def test_a_session_on_a_tunnels_local_port_is_the_far_host(self, mode: str) -> None:
        registry = tunnel_registry({40022: f"{FAR_HOST}:2222"}, MagicMock())
        params = _valid_params(host="localhost", port=40022, host_key_verification=mode)

        record = await self._identity_of(registry, params)

        assert record["host"] == "localhost"
        assert record["host_identity"] == FAR_HOST

    @pytest.mark.parametrize(
        "destination",
        ["127.0.0.1:2200", "localhost:22", "::1:2200"],
        ids=["address", "name", "ipv6"],
    )
    async def test_a_loopback_far_end_is_the_tunnel_sessions_own_host(
        self, destination: str
    ) -> None:
        registry = tunnel_registry({40022: destination}, MagicMock())

        record = await self._identity_of(registry, _valid_params(host="127.0.0.1", port=40022))

        assert record["host_identity"] == SSH_HOST

    async def test_a_live_session_through_a_tunnel_keeps_the_far_host(
        self, ssh_endpoint: SSHEndpoint
    ) -> None:
        registry = _through_tunnel(f"{FAR_HOST}:22", ssh_endpoint)

        async with _opened_session(registry, _tunnel_params(ssh_endpoint, "accept-new")) as result:
            record = registry.get(result["session_id"])
            assert record is not None
            assert record["host"] == "127.0.0.1"
            assert record["host_identity"] == FAR_HOST
