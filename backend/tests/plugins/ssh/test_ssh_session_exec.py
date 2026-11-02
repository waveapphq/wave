"""
SSH Session Exec plugin tests (REQ-3.4.1.3, REQ-5.1.5).

The rebuilt plugin looks a session up in the run's SSHSessionRegistry and
runs one independent command on its live connection (no shell-state
carryover), returning stdout / stderr / exit_code.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest

from tests.plugins.ssh.conftest import (
    SESSION_ID,
    LoopbackSSH,
    RecordsTheProcess,
    SignalWatcher,
    mock_session_registry,
    plugin_context,
    process_of,
    real_session,
    run_result,
)
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins._shared_params import timeout_parameter
from wavecore.plugins.ssh_session_exec import SSHSessionExecPlugin


def _make_context(
    registry: SSHSessionRegistry | None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return plugin_context(registry, params or {"session_id": SESSION_ID, "command": "echo ok"})


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_identity(self) -> None:
        meta = SSHSessionExecPlugin().metadata

        assert meta["id"] == "ssh-session-exec"
        assert meta["name"] == "SSH Session Exec"
        assert meta["category"] == "remote"
        assert meta["return_type"] == "map"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in SSHSessionExecPlugin().metadata["parameters"]]

        assert names == ["session_id", "command", "timeout"]

    def test_parameter_specs(self) -> None:
        params = {p["name"]: p for p in SSHSessionExecPlugin().metadata["parameters"]}

        assert params["session_id"]["type"] == "string"
        assert params["session_id"]["required"] is True
        assert params["session_id"]["trim"] is True
        assert params["command"]["type"] == "string"
        assert params["command"]["required"] is True
        assert params["timeout"]["type"] == "integer"
        assert params["timeout"]["required"] is False
        assert params["timeout"]["default"] == 300

    def test_timeout_row_declares_its_floor(self) -> None:
        params = {p["name"]: p for p in SSHSessionExecPlugin().metadata["parameters"]}

        assert params["timeout"] == {
            **timeout_parameter(300, "Execution timeout in seconds. Default: 300 (5 minutes)."),
            "minimum": 1,
        }

    def test_output_schema(self) -> None:
        outputs = SSHSessionExecPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("stdout", "string"),
            ("stderr", "string"),
            ("exit_code", "integer"),
        ]

    def test_every_output_carries_a_description(self) -> None:
        for output in SSHSessionExecPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_every_parameter_carries_a_description(self) -> None:
        for param in SSHSessionExecPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_metadata_builds_a_valid_plugin_model(self) -> None:
        model = SSHSessionExecPlugin().get_plugin_model()

        assert model.id == "ssh-session-exec"


class TestValidation:
    """validate() - required params and timeout bounds."""

    async def test_missing_session_id(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: session_id$"):
            await SSHSessionExecPlugin().validate({"command": "echo ok"})

    async def test_empty_session_id_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: session_id$"):
            await SSHSessionExecPlugin().validate({"session_id": "", "command": "echo ok"})

    async def test_missing_command(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: command$"):
            await SSHSessionExecPlugin().validate({"session_id": "ssh_session_abc123"})

    async def test_empty_command_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: command$"):
            await SSHSessionExecPlugin().validate(
                {"session_id": "ssh_session_abc123", "command": ""}
            )

    async def test_valid_params_pass(self) -> None:
        await SSHSessionExecPlugin().validate(
            {"session_id": "ssh_session_abc123", "command": "echo ok"}
        )

    @pytest.mark.parametrize("below", [0, -5])
    async def test_a_timeout_below_1_is_refused(self, below: int) -> None:
        with pytest.raises(ValueError, match=r"^Timeout must be at least 1$"):
            await SSHSessionExecPlugin().validate(
                {"session_id": "ssh_session_abc123", "command": "echo ok", "timeout": below}
            )

    @pytest.mark.parametrize(
        "bad", [1.5, "soon", "300", True, False], ids=["float", "word", "digits", "true", "false"]
    )
    async def test_a_timeout_that_is_not_a_whole_number_is_refused(self, bad: Any) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be an integer$"):
            await SSHSessionExecPlugin().validate(
                {"session_id": "ssh_session_abc123", "command": "echo ok", "timeout": bad}
            )

    @pytest.mark.parametrize("timeout", [1, 60])
    async def test_a_timeout_of_1_or_more_passes(self, timeout: int) -> None:
        await SSHSessionExecPlugin().validate(
            {"session_id": "ssh_session_abc123", "command": "echo ok", "timeout": timeout}
        )

    @pytest.mark.parametrize("blank", [None, ""], ids=["none", "empty"])
    async def test_a_blank_timeout_is_not_checked(self, blank: Any) -> None:
        await SSHSessionExecPlugin().validate(
            {"session_id": "ssh_session_abc123", "command": "echo ok", "timeout": blank}
        )

    async def test_a_missing_command_is_reported_before_the_timeout(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: command$"):
            await SSHSessionExecPlugin().validate(
                {"session_id": "ssh_session_abc123", "command": "", "timeout": 0}
            )

    async def test_the_declared_minimum_is_the_floor_validate_enforces(self) -> None:
        row = {p["name"]: p for p in SSHSessionExecPlugin().metadata["parameters"]}["timeout"]
        params = {"session_id": "ssh_session_abc123", "command": "echo ok"}

        await SSHSessionExecPlugin().validate({**params, "timeout": row["minimum"]})
        with pytest.raises(ValueError, match=r"^Timeout must be at least 1$"):
            await SSHSessionExecPlugin().validate({**params, "timeout": row["minimum"] - 1})


class TestExecute:
    """execute() - command run on a live registered session."""

    async def test_runs_the_command_on_the_session_connection(self) -> None:
        registry, conn = mock_session_registry()

        await SSHSessionExecPlugin().execute(_make_context(registry))

        assert conn.create_process.call_args.args == ("echo ok",)
        assert process_of(conn).wait.call_args.kwargs.get("check") is False

    async def test_nothing_is_piped_to_the_command_stdin(self) -> None:
        registry, conn = mock_session_registry()

        await SSHSessionExecPlugin().execute(_make_context(registry))

        assert process_of(conn).stdin.write.called is False
        assert process_of(conn).stdin.write_eof.called is False

    async def test_returns_stdout_stderr_and_exit_code(self) -> None:
        registry, _conn = mock_session_registry(
            result=run_result(stdout="hello\n", stderr="warn\n", exit_status=0)
        )

        result = await SSHSessionExecPlugin().execute(_make_context(registry))

        assert result == {"stdout": "hello\n", "stderr": "warn\n", "exit_code": 0}

    async def test_bytes_output_is_decoded(self) -> None:
        registry, _conn = mock_session_registry(
            result=run_result(stdout="café\n".encode(), stderr=b"", exit_status=0)
        )

        result = await SSHSessionExecPlugin().execute(_make_context(registry))

        assert result["stdout"] == "café\n"
        assert result["stderr"] == ""

    async def test_nonzero_exit_code_is_returned_not_raised(self) -> None:
        registry, _conn = mock_session_registry(
            result=run_result(stdout="", stderr="no such file\n", exit_status=2)
        )

        result = await SSHSessionExecPlugin().execute(_make_context(registry))

        assert result["exit_code"] == 2

    async def test_unknown_session_raises(self) -> None:
        registry = SSHSessionRegistry()

        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await SSHSessionExecPlugin().execute(_make_context(registry))

    async def test_closed_session_raises(self) -> None:
        registry, _conn = mock_session_registry()
        registry.close("ssh_session_abc123")

        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await SSHSessionExecPlugin().execute(_make_context(registry))

    async def test_missing_registry_raises_session_not_found(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await SSHSessionExecPlugin().execute(_make_context(None))

    async def test_timeout_raises_with_the_configured_timeout(self) -> None:
        registry, conn = mock_session_registry()
        conn.create_process = AsyncMock(side_effect=TimeoutError())
        context = _make_context(
            registry,
            params={
                "session_id": "ssh_session_abc123",
                "command": "sleep 100",
                "timeout": 7,
            },
        )

        with pytest.raises(TimeoutError, match=r"^Command execution timed out after 7 seconds$"):
            await SSHSessionExecPlugin().execute(context)

    async def test_timeout_defaults_to_300_in_the_error(self) -> None:
        registry, conn = mock_session_registry()
        conn.create_process = AsyncMock(side_effect=TimeoutError())

        with pytest.raises(TimeoutError, match=r"^Command execution timed out after 300 seconds$"):
            await SSHSessionExecPlugin().execute(_make_context(registry))

    @pytest.mark.parametrize("blank", [None, ""], ids=["none", "empty"])
    async def test_a_blank_timeout_runs_with_300(self, blank: Any) -> None:
        registry, conn = mock_session_registry()
        conn.create_process = AsyncMock(side_effect=TimeoutError())
        context = _make_context(
            registry,
            params={"session_id": "ssh_session_abc123", "command": "sleep 100", "timeout": blank},
        )

        with pytest.raises(TimeoutError, match=r"^Command execution timed out after 300 seconds$"):
            await SSHSessionExecPlugin().execute(context)


async def _reports_and_exits(process: Any) -> None:
    """A command that writes to both streams and exits non-zero."""
    process.stdout.write("hello\n")
    process.stderr.write("warn\n")
    process.exit(3)


def _real_context(connection: Any, **overrides: Any) -> dict[str, Any]:
    return _make_context(
        real_session(connection),
        params={"session_id": "ssh_session_real", "command": "report", **overrides},
    )


class TestAgainstARealSSHChannel:
    """Drives a real asyncssh channel, where a mocked connection cannot reach the cleanup."""

    async def test_output_and_exit_code_come_back_over_a_real_channel(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        async with loopback_ssh(_reports_and_exits) as conn:
            result = await SSHSessionExecPlugin().execute(_real_context(conn))

        assert result == {"stdout": "hello\n", "stderr": "warn\n", "exit_code": 3}

    async def test_timeout_signals_the_remote_and_closes_the_channel(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        watcher = SignalWatcher()

        async with loopback_ssh(watcher.handle) as conn:
            recorder = RecordsTheProcess(conn)
            context = _real_context(recorder, command="sleep 3600", timeout=0.5)

            with pytest.raises(
                TimeoutError, match=r"^Command execution timed out after 0\.5 seconds$"
            ):
                await SSHSessionExecPlugin().execute(context)

            await watcher.assert_killed_and_closed(recorder)


class TestCommandThatCannotBeEncoded:
    """A Command UTF-8 cannot carry fails the block before anything is sent."""

    async def test_the_block_fails_and_starts_no_remote_process(self) -> None:
        registry, conn = mock_session_registry()
        params = {"session_id": SESSION_ID, "command": "ls bar\udce9.txt"}

        with pytest.raises(
            ValueError,
            match=(
                r"^Command has a character at line 1, column 7 that cannot be encoded as UTF-8, "
                r"so nothing was sent to the remote host: remove or replace it$"
            ),
        ):
            await SSHSessionExecPlugin().execute(_make_context(registry, params))

        conn.create_process.assert_not_called()
