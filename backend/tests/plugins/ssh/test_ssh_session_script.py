"""
SSH Session Script plugin tests (REQ-3.4.1.3, REQ-5.1.5).

The plugin looks a session up in the run's SSHSessionRegistry and runs a
script on its live connection by piping the script to a chosen interpreter's
stdin (default /bin/sh, no allowlist), returning stdout / stderr / exit_code.
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

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
from wavecore.plugins.ssh_session_script import SSHSessionScriptPlugin


def _script_written_to(conn: MagicMock) -> str:
    """The script the plugin piped to the interpreter's stdin."""
    return str(process_of(conn).stdin.write.call_args.args[0])


def _make_context(
    registry: SSHSessionRegistry | None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return plugin_context(registry, params or {"session_id": SESSION_ID, "script": "echo hello"})


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_identity(self) -> None:
        meta = SSHSessionScriptPlugin().metadata

        assert meta["id"] == "ssh-session-script"
        assert meta["name"] == "SSH Session Script"
        assert meta["category"] == "remote"
        assert meta["return_type"] == "map"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in SSHSessionScriptPlugin().metadata["parameters"]]

        assert names == ["session_id", "script", "interpreter", "working_dir", "timeout"]

    def test_parameter_specs(self) -> None:
        params = {p["name"]: p for p in SSHSessionScriptPlugin().metadata["parameters"]}

        assert params["session_id"]["type"] == "string"
        assert params["session_id"]["required"] is True
        assert params["session_id"]["trim"] is True
        assert params["script"]["type"] == "string"
        assert params["script"]["required"] is True
        assert params["interpreter"]["type"] == "string"
        assert params["interpreter"]["required"] is False
        assert params["interpreter"]["trim"] is True
        assert params["interpreter"]["default"] == "/bin/sh"
        assert params["working_dir"]["type"] == "string"
        assert params["working_dir"]["required"] is False
        assert params["working_dir"]["trim"] is True
        assert params["timeout"]["type"] == "integer"
        assert params["timeout"]["required"] is False
        assert params["timeout"]["default"] == 300

    def test_timeout_row_declares_its_floor(self) -> None:
        params = {p["name"]: p for p in SSHSessionScriptPlugin().metadata["parameters"]}

        assert params["timeout"] == {
            **timeout_parameter(300, "Execution timeout in seconds. Default: 300 (5 minutes)."),
            "minimum": 1,
        }

    def test_script_is_not_trimmed(self) -> None:
        params = {p["name"]: p for p in SSHSessionScriptPlugin().metadata["parameters"]}

        # A script's leading whitespace is significant (Python indentation) - never trim it.
        assert params["script"].get("trim") is not True

    def test_output_schema(self) -> None:
        outputs = SSHSessionScriptPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("stdout", "string"),
            ("stderr", "string"),
            ("exit_code", "integer"),
        ]

    def test_every_output_carries_a_description(self) -> None:
        for output in SSHSessionScriptPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_every_parameter_carries_a_description(self) -> None:
        for param in SSHSessionScriptPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_metadata_builds_a_valid_plugin_model(self) -> None:
        model = SSHSessionScriptPlugin().get_plugin_model()

        assert model.id == "ssh-session-script"


class TestValidation:
    """validate() - required params and timeout bounds."""

    async def test_missing_session_id(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: session_id$"):
            await SSHSessionScriptPlugin().validate({"script": "echo hello"})

    async def test_empty_session_id_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: session_id$"):
            await SSHSessionScriptPlugin().validate({"session_id": "", "script": "echo hello"})

    async def test_missing_script(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: script$"):
            await SSHSessionScriptPlugin().validate({"session_id": "ssh_session_abc123"})

    async def test_empty_script_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: script$"):
            await SSHSessionScriptPlugin().validate(
                {"session_id": "ssh_session_abc123", "script": ""}
            )

    async def test_valid_params_pass(self) -> None:
        await SSHSessionScriptPlugin().validate(
            {"session_id": "ssh_session_abc123", "script": "echo hello"}
        )

    @pytest.mark.parametrize("below", [0, -5])
    async def test_a_timeout_below_1_is_refused(self, below: int) -> None:
        with pytest.raises(ValueError, match=r"^Timeout must be at least 1$"):
            await SSHSessionScriptPlugin().validate(
                {"session_id": "ssh_session_abc123", "script": "echo hello", "timeout": below}
            )

    @pytest.mark.parametrize(
        "bad", [1.5, "soon", "300", True, False], ids=["float", "word", "digits", "true", "false"]
    )
    async def test_a_timeout_that_is_not_a_whole_number_is_refused(self, bad: Any) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be an integer$"):
            await SSHSessionScriptPlugin().validate(
                {"session_id": "ssh_session_abc123", "script": "echo hello", "timeout": bad}
            )

    @pytest.mark.parametrize("timeout", [1, 60])
    async def test_a_timeout_of_1_or_more_passes(self, timeout: int) -> None:
        await SSHSessionScriptPlugin().validate(
            {"session_id": "ssh_session_abc123", "script": "echo hello", "timeout": timeout}
        )

    @pytest.mark.parametrize("blank", [None, ""], ids=["none", "empty"])
    async def test_a_blank_timeout_is_not_checked(self, blank: Any) -> None:
        await SSHSessionScriptPlugin().validate(
            {"session_id": "ssh_session_abc123", "script": "echo hello", "timeout": blank}
        )

    async def test_a_missing_script_is_reported_before_the_timeout(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: script$"):
            await SSHSessionScriptPlugin().validate(
                {"session_id": "ssh_session_abc123", "script": "", "timeout": 0}
            )

    async def test_the_declared_minimum_is_the_floor_validate_enforces(self) -> None:
        row = {p["name"]: p for p in SSHSessionScriptPlugin().metadata["parameters"]}["timeout"]
        params = {"session_id": "ssh_session_abc123", "script": "echo hello"}

        await SSHSessionScriptPlugin().validate({**params, "timeout": row["minimum"]})
        with pytest.raises(ValueError, match=r"^Timeout must be at least 1$"):
            await SSHSessionScriptPlugin().validate({**params, "timeout": row["minimum"] - 1})


class TestExecute:
    """execute() - script piped to an interpreter on a live registered session."""

    async def test_pipes_the_script_to_the_default_interpreter(self) -> None:
        registry, conn = mock_session_registry()

        await SSHSessionScriptPlugin().execute(_make_context(registry))

        assert conn.create_process.call_args.args == ("/bin/sh",)
        assert _script_written_to(conn) == "echo hello"
        assert process_of(conn).stdin.write_eof.called
        assert process_of(conn).wait.call_args.kwargs.get("check") is False

    async def test_uses_the_configured_interpreter(self) -> None:
        registry, conn = mock_session_registry()
        context = _make_context(
            registry,
            params={
                "session_id": "ssh_session_abc123",
                "script": "print('hi')",
                "interpreter": "python3",
            },
        )

        await SSHSessionScriptPlugin().execute(context)

        assert conn.create_process.call_args.args == ("python3",)
        assert _script_written_to(conn) == "print('hi')"

    async def test_blank_interpreter_falls_back_to_default(self) -> None:
        registry, conn = mock_session_registry()
        context = _make_context(
            registry,
            params={
                "session_id": "ssh_session_abc123",
                "script": "echo hello",
                "interpreter": "",
            },
        )

        await SSHSessionScriptPlugin().execute(context)

        assert conn.create_process.call_args.args == ("/bin/sh",)

    async def test_working_dir_prefixes_a_cd_and_exec(self) -> None:
        registry, conn = mock_session_registry()
        context = _make_context(
            registry,
            params={
                "session_id": "ssh_session_abc123",
                "script": "echo hello",
                "working_dir": "/srv/work",
            },
        )

        await SSHSessionScriptPlugin().execute(context)

        assert conn.create_process.call_args.args == ("cd /srv/work && exec /bin/sh",)

    async def test_working_dir_is_shell_quoted(self) -> None:
        registry, conn = mock_session_registry()
        context = _make_context(
            registry,
            params={
                "session_id": "ssh_session_abc123",
                "script": "echo hello",
                "working_dir": "/srv/my work",
            },
        )

        await SSHSessionScriptPlugin().execute(context)

        assert conn.create_process.call_args.args == ("cd '/srv/my work' && exec /bin/sh",)

    async def test_working_dir_combines_with_the_configured_interpreter(self) -> None:
        registry, conn = mock_session_registry()
        context = _make_context(
            registry,
            params={
                "session_id": "ssh_session_abc123",
                "script": "print('hi')",
                "interpreter": "python3",
                "working_dir": "/opt/app",
            },
        )

        await SSHSessionScriptPlugin().execute(context)

        assert conn.create_process.call_args.args == ("cd /opt/app && exec python3",)

    async def test_script_is_piped_verbatim(self) -> None:
        registry, conn = mock_session_registry()
        context = _make_context(
            registry,
            params={
                "session_id": "ssh_session_abc123",
                "script": "  leading\n\tindented\n",
            },
        )

        await SSHSessionScriptPlugin().execute(context)

        assert _script_written_to(conn) == "  leading\n\tindented\n"

    async def test_returns_stdout_stderr_and_exit_code(self) -> None:
        registry, _conn = mock_session_registry(
            result=run_result(stdout="hello\n", stderr="warn\n", exit_status=0)
        )

        result = await SSHSessionScriptPlugin().execute(_make_context(registry))

        assert result == {"stdout": "hello\n", "stderr": "warn\n", "exit_code": 0}

    async def test_bytes_output_is_decoded(self) -> None:
        registry, _conn = mock_session_registry(
            result=run_result(stdout="café\n".encode(), stderr=b"", exit_status=0)
        )

        result = await SSHSessionScriptPlugin().execute(_make_context(registry))

        assert result["stdout"] == "café\n"
        assert result["stderr"] == ""

    async def test_nonzero_exit_code_is_returned_not_raised(self) -> None:
        registry, _conn = mock_session_registry(
            result=run_result(stdout="", stderr="boom\n", exit_status=3)
        )

        result = await SSHSessionScriptPlugin().execute(_make_context(registry))

        assert result["exit_code"] == 3

    async def test_unknown_session_raises(self) -> None:
        registry = SSHSessionRegistry()

        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await SSHSessionScriptPlugin().execute(_make_context(registry))

    async def test_closed_session_raises(self) -> None:
        registry, _conn = mock_session_registry()
        registry.close("ssh_session_abc123")

        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await SSHSessionScriptPlugin().execute(_make_context(registry))

    async def test_missing_registry_raises_session_not_found(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^SSH session 'ssh_session_abc123' not found or already closed$",
        ):
            await SSHSessionScriptPlugin().execute(_make_context(None))

    async def test_timeout_raises_with_the_configured_timeout(self) -> None:
        registry, conn = mock_session_registry()
        conn.create_process = AsyncMock(side_effect=TimeoutError())
        context = _make_context(
            registry,
            params={
                "session_id": "ssh_session_abc123",
                "script": "sleep 100",
                "timeout": 7,
            },
        )

        with pytest.raises(TimeoutError, match=r"^Command execution timed out after 7 seconds$"):
            await SSHSessionScriptPlugin().execute(context)

    async def test_timeout_defaults_to_300_in_the_error(self) -> None:
        registry, conn = mock_session_registry()
        conn.create_process = AsyncMock(side_effect=TimeoutError())

        with pytest.raises(TimeoutError, match=r"^Command execution timed out after 300 seconds$"):
            await SSHSessionScriptPlugin().execute(_make_context(registry))

    @pytest.mark.parametrize("blank", [None, ""], ids=["none", "empty"])
    async def test_a_blank_timeout_runs_with_300(self, blank: Any) -> None:
        registry, conn = mock_session_registry()
        conn.create_process = AsyncMock(side_effect=TimeoutError())
        context = _make_context(
            registry,
            params={"session_id": "ssh_session_abc123", "script": "sleep 100", "timeout": blank},
        )

        with pytest.raises(TimeoutError, match=r"^Command execution timed out after 300 seconds$"):
            await SSHSessionScriptPlugin().execute(context)


class TestStdinWriteGuardIsNarrow:
    """Only the stdin write is guarded; a broken connection anywhere else surfaces."""

    async def test_connection_reset_on_the_stdin_write_is_tolerated(self) -> None:
        registry, conn = mock_session_registry(
            result=run_result(stdout="", stderr="gone\n", exit_status=127)
        )
        process_of(conn).stdin.write.side_effect = ConnectionResetError("connection reset")

        result = await SSHSessionScriptPlugin().execute(_make_context(registry))

        assert result == {"stdout": "", "stderr": "gone\n", "exit_code": 127}

    async def test_a_broken_channel_at_process_start_still_raises(self) -> None:
        registry, conn = mock_session_registry()
        conn.create_process = AsyncMock(side_effect=BrokenPipeError("Channel not open for sending"))

        with pytest.raises(BrokenPipeError, match=r"^Channel not open for sending$"):
            await SSHSessionScriptPlugin().execute(_make_context(registry))

    async def test_a_broken_channel_while_waiting_for_exit_still_raises(self) -> None:
        registry, conn = mock_session_registry()
        process_of(conn).wait = AsyncMock(side_effect=BrokenPipeError("connection lost"))

        with pytest.raises(BrokenPipeError, match=r"^connection lost$"):
            await SSHSessionScriptPlugin().execute(_make_context(registry))


async def _exits_without_reading_stdin(process: Any) -> None:
    """A missing interpreter: the shell reports it and exits 127, never reading stdin."""
    process.stderr.write("wave-missing-interp: not found\n")
    process.exit(127)


async def _reads_stdin_then_exits(process: Any) -> None:
    """A real interpreter: consume the piped script, then exit 0."""
    script = await process.stdin.read()
    process.stdout.write(f"ran:{script}")
    process.exit(0)


class _RemoteFinishesFirst:
    """Holds the plugin's stdin write until the remote has closed the channel."""

    def __init__(self, connection: Any) -> None:
        self._connection = connection
        self.channel_was_closed = False

    async def create_process(self, command: str) -> Any:
        process = await self._connection.create_process(command)
        await asyncio.wait_for(process.wait_closed(), timeout=10)
        self.channel_was_closed = process.channel.is_closing()
        return process


def _real_context(connection: Any, **overrides: Any) -> dict[str, Any]:
    return _make_context(
        real_session(connection),
        params={"session_id": "ssh_session_real", "script": "echo hello", **overrides},
    )


class TestAgainstARealSSHChannel:
    """Drives a real asyncssh channel, where a mocked connection cannot reach the write path."""

    async def test_interpreter_that_reads_stdin_receives_the_script(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        async with loopback_ssh(_reads_stdin_then_exits) as conn:
            result = await SSHSessionScriptPlugin().execute(_real_context(conn))

        assert result == {"stdout": "ran:echo hello", "stderr": "", "exit_code": 0}

    async def test_remote_that_exits_before_the_write_returns_127_not_an_error(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        async with loopback_ssh(_exits_without_reading_stdin) as conn:
            connection = _RemoteFinishesFirst(conn)

            result = await SSHSessionScriptPlugin().execute(_real_context(connection))

        assert connection.channel_was_closed is True
        assert result == {
            "stdout": "",
            "stderr": "wave-missing-interp: not found\n",
            "exit_code": 127,
        }

    async def test_timeout_signals_the_remote_and_closes_the_channel(
        self, loopback_ssh: LoopbackSSH
    ) -> None:
        watcher = SignalWatcher()

        async with loopback_ssh(watcher.handle) as conn:
            recorder = RecordsTheProcess(conn)
            context = _real_context(recorder, script="sleep 3600", timeout=0.5)

            with pytest.raises(
                TimeoutError, match=r"^Command execution timed out after 0\.5 seconds$"
            ):
                await SSHSessionScriptPlugin().execute(context)

            await watcher.assert_killed_and_closed(recorder)


_NOT_UTF8 = "bar\udce9"


def _cannot_be_sent(label: str, line: int, column: int) -> str:
    return (
        rf"^{label} has a character at line {line}, column {column} that cannot be encoded as "
        r"UTF-8, so nothing was sent to the remote host: remove or replace it$"
    )


class TestTextThatCannotBeEncoded:
    """A Script, Interpreter or Working Directory UTF-8 cannot carry fails before the run."""

    @pytest.mark.parametrize(
        ("overrides", "label", "line", "column"),
        [
            ({"script": f"ls {_NOT_UTF8}.txt\n"}, "Script", 1, 7),
            ({"script": f"echo one\necho {_NOT_UTF8}\n"}, "Script", 2, 9),
            ({"interpreter": f"/opt/{_NOT_UTF8}/sh"}, "Interpreter", 1, 9),
            ({"working_dir": f"/srv/{_NOT_UTF8}"}, "Working Directory", 1, 9),
        ],
        ids=["script", "script second line", "interpreter", "working directory"],
    )
    async def test_the_block_fails_and_starts_no_remote_process(
        self, overrides: dict[str, str], label: str, line: int, column: int
    ) -> None:
        registry, conn = mock_session_registry()
        params = {"session_id": SESSION_ID, "script": "echo hello", **overrides}

        with pytest.raises(ValueError, match=_cannot_be_sent(label, line, column)):
            await SSHSessionScriptPlugin().execute(_make_context(registry, params))

        conn.create_process.assert_not_called()
