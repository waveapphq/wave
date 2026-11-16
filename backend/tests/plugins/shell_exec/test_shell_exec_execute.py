"""Shell Exec end to end: the shell gets the whole command line (REQ-3.4.1.18).

SHRUN-17: the command runs as <shell> -c <command>, so pipes, redirects, globs and && work,
and the Shell row may carry flags. SHRUN-2: the command inherits the WAVE server's
environment as it stands, with the two folder variables added. SHRUN-13 and SHRUN-14 end a
run early on a pattern match or the deadline. SHRUN-12: the first console line names the
shell, never the command; SHRUN-9: a non-zero exit names the last stderr line. REQ-3.1.3.22:
a null input variable fails the block before the command starts.
"""

import re
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.core.execution import plugin_executor
from wavecore.core.execution.plugin_executor import (
    build_map_expression_keys,
    derive_parameter_metadata,
    resolve_parameters,
)
from wavecore.plugins import shell_exec as shell_exec_module
from wavecore.plugins.shell_exec import ShellExecPlugin

PASS_LINE = "Output matched the pass pattern"
START_LINE = "Running the command under /bin/sh on the WAVE server"
NULL_ENTRY = "'TOKEN' in 'env_vars' is null"


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def context(
    params: dict[str, Any],
    artifacts_dir: Path | None = None,
    testdata_dirs: list[Path] | None = None,
    logger: Any = None,
    output_secret_fields: list[str] | None = None,
) -> dict[str, Any]:
    """The execute() context the workbench builds for a block."""
    return {
        "parameters": params,
        "variables": {},
        "logger": logger if logger is not None else MagicMock(),
        "artifacts_dir": str(artifacts_dir) if artifacts_dir is not None else None,
        "testdata_dirs": [str(d) for d in testdata_dirs] if testdata_dirs is not None else None,
        "output_secret_fields": output_secret_fields or [],
    }


def messages(logger: MagicMock, level: str) -> list[str]:
    return [str(call.args[0]) for call in getattr(logger, level).call_args_list if call.args]


async def run(params: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    """Run one command through the block."""
    result: dict[str, Any] = await ShellExecPlugin().execute(context(params, **kwargs))
    return result


class TestShellSyntax:
    """The shell is handed the whole command line, so its own syntax works."""

    async def test_a_pipe_runs(self) -> None:
        result = await run({"command": "printf 'x\\ny\\n' | grep -c y"})

        assert result["stdout"] == "1\n"
        assert result["exit_code"] == 0
        assert result["success"] is True

    async def test_a_glob_expands(self, tmp_path: Path) -> None:
        (tmp_path / "a.txt").write_text("", encoding="utf-8")
        (tmp_path / "b.txt").write_text("", encoding="utf-8")

        result = await run({"command": "echo *.txt", "working_dir": str(tmp_path)})

        assert result["stdout"] == "a.txt b.txt\n"

    async def test_a_redirect_writes_a_file(self, tmp_path: Path) -> None:
        result = await run({"command": "echo hi > out.txt", "working_dir": str(tmp_path)})

        assert result["stdout"] == ""
        assert (tmp_path / "out.txt").read_text(encoding="utf-8") == "hi\n"

    async def test_and_runs_the_second_command(self) -> None:
        result = await run({"command": "true && echo joined"})

        assert result["stdout"] == "joined\n"

    async def test_stderr_is_captured_separately(self) -> None:
        result = await run({"command": "printf 'out\\n'; printf 'err\\n' >&2"})

        assert result["stdout"] == "out\n"
        assert result["stderr"] == "err\n"


class TestShellFlags:
    """The Shell row may name flags, and the shell runs with them."""

    async def test_the_pipefail_flag_fails_the_pipeline(self) -> None:
        result = await run(
            {
                "command": "false | true",
                "shell": "/bin/bash -o pipefail",
                "on_error": "record",
            }
        )

        assert result["exit_code"] == 1
        assert result["success"] is False
        assert result["error"] == "Command exited with code 1"
        assert result["reason"] == "NonZeroExit"

    async def test_without_the_flag_the_same_pipeline_passes(self) -> None:
        result = await run({"command": "false | true"})

        assert result["exit_code"] == 0
        assert result["success"] is True


@pytest.fixture
def system_temp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The folder tempfile.gettempdir() reports for this test."""
    folder = tmp_path / "system-temp"
    folder.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(folder))
    return folder


class TestDefaults:
    """An unset setting reads its default: the system temp folder under /bin/sh (REQ-3.4.3.11)."""

    async def test_a_command_on_its_own_runs_in_the_temp_folder_under_bin_sh(
        self, system_temp: Path
    ) -> None:
        result = await run({"command": 'pwd -P; echo "$0"'})

        assert result["stdout"] == f"{system_temp.resolve()}\n/bin/sh\n"

    @pytest.mark.parametrize("value", [None, "", "   "], ids=["none", "empty", "whitespace"])
    async def test_a_blank_working_directory_starts_in_the_temp_folder(
        self, value: str | None, system_temp: Path
    ) -> None:
        result = await run({"command": "pwd -P", "working_dir": value})

        assert result["stdout"] == f"{system_temp.resolve()}\n"


class TestRelativeWorkingDirectory:
    """A relative working directory starts at the WAVE server user's home folder (SHRUN-10)."""

    async def test_the_command_starts_in_the_folder_below_the_server_users_home(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, server_home: Path
    ) -> None:
        (server_home / "work").mkdir()
        (tmp_path / "work").mkdir()
        monkeypatch.chdir(tmp_path)
        plugin = ShellExecPlugin()
        params = {"command": "pwd -P", "working_dir": "made/../work"}

        await plugin.validate(params)
        result: dict[str, Any] = await plugin.execute(context(params))

        assert result["stdout"] == f"{(server_home / 'work').resolve()}\n"

    async def test_a_relative_shell_program_starts_from_the_working_directory(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        work = tmp_path / "work"
        (work / "bin").mkdir(parents=True)
        program = work / "bin" / "mysh"
        program.write_text('#!/bin/sh\necho "via mysh"\n', encoding="utf-8")
        program.chmod(0o755)
        monkeypatch.chdir(tmp_path)

        result = await run({"command": "ignored", "shell": "bin/mysh", "working_dir": str(work)})

        assert result["stdout"] == "via mysh\n"
        assert result["success"] is True

    async def test_a_relative_shell_program_missing_from_the_working_directory_is_not_found(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        work = tmp_path / "work"
        work.mkdir()
        (tmp_path / "bin").mkdir()
        decoy = tmp_path / "bin" / "mysh"
        decoy.write_text("#!/bin/sh\necho decoy\n", encoding="utf-8")
        decoy.chmod(0o755)
        monkeypatch.chdir(tmp_path)

        result = await run(
            {"command": "x", "shell": "bin/mysh", "working_dir": str(work), "on_error": "record"}
        )

        assert result["error"] == "Shell not found on the WAVE server: bin/mysh"
        assert result["reason"] == "StartFailed"


class TestOutcomes:
    """What the block binds when the command ends on its own."""

    async def test_a_passing_run_binds_the_streams_and_empty_error_rows(self) -> None:
        result = await run({"command": "echo done"})

        assert result == {
            "stdout": "done\n",
            "stderr": "",
            "exit_code": 0,
            "success": True,
            "error": "",
            "reason": "",
        }

    async def test_a_non_zero_exit_fails_the_block(self) -> None:
        with pytest.raises(ValueError, match=exact("Command exited with code 1")):
            await run({"command": "exit 1"})

    async def test_a_recorded_failure_binds_what_the_command_produced(self) -> None:
        result = await run(
            {
                "command": "printf 'out\\n'; printf 'err\\n' >&2; exit 3",
                "on_error": "record",
            }
        )

        assert result["stdout"] == "out\n"
        assert result["stderr"] == "err\n"
        assert result["exit_code"] == 3
        assert result["success"] is False
        assert result["error"] == "Command exited with code 3: err"
        assert result["reason"] == "NonZeroExit"
        assert result["__block_warning"] is True

    async def test_a_recorded_failure_writes_one_warn_line(self) -> None:
        logger = MagicMock()

        await ShellExecPlugin().execute(
            context({"command": "exit 1", "on_error": "record"}, logger=logger)
        )

        logger.warn.assert_called_once_with(
            "Command failed (NonZeroExit): Command exited with code 1"
        )

    async def test_a_non_zero_exit_names_the_last_stderr_line(self) -> None:
        message = "Command exited with code 5: no such thing"

        with pytest.raises(ValueError, match=exact(message)):
            await run({"command": "printf 'first\\nno such thing\\n\\n' >&2; exit 5"})

    async def test_a_stderr_stream_marked_secret_keeps_the_bare_message(self) -> None:
        result = await run(
            {"command": "echo token-value >&2; exit 5", "on_error": "record"},
            output_secret_fields=["stderr"],
        )

        assert result["error"] == "Command exited with code 5"


class TestStartLine:
    """One INFO line names the shell as the command starts; the command is never echoed."""

    async def test_the_default_shell_is_named(self) -> None:
        logger = MagicMock()

        await run({"command": "echo body-text"}, logger=logger)

        assert messages(logger, "info") == [START_LINE]

    async def test_a_named_shell_is_shown_with_its_flags(self) -> None:
        logger = MagicMock()

        await run({"command": "true", "shell": "/bin/bash -o pipefail"}, logger=logger)

        assert messages(logger, "info") == [
            "Running the command under /bin/bash -o pipefail on the WAVE server"
        ]

    async def test_the_line_is_written_before_a_start_failure(self) -> None:
        logger = MagicMock()

        await run({"command": "echo hi", "shell": "/nope/sh", "on_error": "record"}, logger=logger)

        assert messages(logger, "info") == ["Running the command under /nope/sh on the WAVE server"]


class TestStartFailures:
    """Nothing ran: the exit code is -1 and the reason is StartFailed."""

    async def test_a_shell_that_is_not_on_the_server(self) -> None:
        message = "Shell not found on the WAVE server: /nope/sh"

        with pytest.raises(ValueError, match=exact(message)):
            await run({"command": "echo hi", "shell": "/nope/sh"})

    async def test_a_missing_shell_records_a_start_failure(self) -> None:
        result = await run({"command": "echo hi", "shell": "/nope/sh", "on_error": "record"})

        assert result["exit_code"] == -1
        assert result["reason"] == "StartFailed"
        assert result["error"] == "Shell not found on the WAVE server: /nope/sh"

    async def test_a_shell_with_an_unbalanced_quote(self) -> None:
        shell = '/bin/bash -c "'

        with pytest.raises(ValueError, match=exact(f"Shell not found on the WAVE server: {shell}")):
            await run({"command": "echo hi", "shell": shell})

    async def test_a_shell_the_server_cannot_run(self, tmp_path: Path) -> None:
        message = "Could not start the command: Permission denied"

        with pytest.raises(ValueError, match=exact(message)):
            await run({"command": "echo hi", "shell": str(tmp_path)})

    async def test_a_working_directory_that_does_not_exist(self, tmp_path: Path) -> None:
        missing = tmp_path / "missing"

        with pytest.raises(ValueError, match=exact(f"Working directory not found: {missing}")):
            await run({"command": "echo hi", "working_dir": str(missing)})


class TestEnvironment:
    """The command sees the server's environment as it stands, plus the two folders."""

    async def test_a_wave_prefixed_server_setting_arrives_unchanged(
        self, monkeypatch: pytest.MonkeyPatch, config_file: Path
    ) -> None:
        monkeypatch.setenv("WAVE_SECRET_KEY", "server-key")

        result = await run(
            {"command": 'printf "%s\\n%s\\n" "$WAVE_SECRET_KEY" "$WAVE_CONFIG_FILE"'}
        )

        assert result["stdout"] == f"server-key\n{config_file}\n"

    async def test_nothing_is_stripped_from_the_server_environment(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", "DEBUG")

        result = await run({"command": "env"})

        assert "WAVE_LOG_LEVEL=DEBUG\n" in result["stdout"]

    async def test_the_two_folder_variables_are_added(self, tmp_path: Path) -> None:
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        testdata = tmp_path / "testdata"
        testdata.mkdir()

        result = await run(
            {"command": 'printf "%s\\n%s\\n" "$WAVE_TESTDATA_DIR" "$WAVE_ARTIFACTS_DIR"'},
            artifacts_dir=artifacts,
            testdata_dirs=[testdata],
        )

        assert result["stdout"] == f"{testdata}\n{artifacts}\n"

    async def test_the_two_folder_variables_are_empty_without_folders(self) -> None:
        result = await run(
            {"command": 'printf "[%s][%s]\\n" "$WAVE_TESTDATA_DIR" "$WAVE_ARTIFACTS_DIR"'}
        )

        assert result["stdout"] == "[][]\n"


class TestInputVariables:
    """Each entry is exported into the command's environment."""

    async def test_a_value_reaches_the_command(self) -> None:
        result = await run({"command": 'echo "$GREETING"', "env_vars": {"GREETING": "hi"}})

        assert result["stdout"] == "hi\n"

    @pytest.mark.parametrize(
        ("value", "text"),
        [("hi", "hi"), (3, "3"), (True, "true"), (False, "false")],
    )
    async def test_values_arrive_as_text(self, value: Any, text: str) -> None:
        result = await run({"command": 'echo "[$VALUE]"', "env_vars": {"VALUE": value}})

        assert result["stdout"] == f"[{text}]\n"


@pytest.fixture
def launches(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every process the block asks to start; a launch fails the test."""
    started: list[Any] = []

    async def launch(spec: Any) -> Any:
        started.append(spec)
        raise AssertionError("the command was started")

    monkeypatch.setattr(shell_exec_module, "run_local_process", launch)
    return started


class TestNullInputVariables:
    """A shell has no null, so a null entry fails the block before the command starts."""

    async def test_a_null_entry_fails_the_block_and_names_the_entry(
        self, launches: list[Any]
    ) -> None:
        params = {"command": 'echo "$TOKEN"', "env_vars": {"GREETING": "hi", "TOKEN": None}}

        with pytest.raises(ValueError, match=exact(NULL_ENTRY)):
            await run(params)

        assert launches == []

    async def test_a_null_entry_records_a_start_failure_under_record(
        self, launches: list[Any]
    ) -> None:
        result = await run(
            {"command": 'echo "$TOKEN"', "env_vars": {"TOKEN": None}, "on_error": "record"}
        )

        assert result["exit_code"] == -1
        assert result["reason"] == "StartFailed"
        assert result["error"] == NULL_ENTRY
        assert result["success"] is False
        assert launches == []

    async def test_an_entry_left_empty_arrives_as_empty_text(self) -> None:
        result = await run({"command": 'echo "[$VALUE]"', "env_vars": {"VALUE": ""}})

        assert result["stdout"] == "[]\n"

    async def test_a_null_item_inside_a_list_arrives_as_json_null(self) -> None:
        result = await run({"command": 'echo "$ITEMS"', "env_vars": {"ITEMS": [1, None, 2]}})

        assert result["stdout"] == "[1,null,2]\n"

    @pytest.mark.parametrize(
        ("entry", "variables"),
        [
            pytest.param("token", {"token": None}, id="expression-gives-null"),
            pytest.param("", {}, id="expression-left-empty"),
            pytest.param("   ", {}, id="expression-left-blank"),
        ],
    )
    async def test_an_entry_expression_with_no_value_passes_the_resolve_and_fails_the_block(
        self, entry: str, variables: dict[str, Any], launches: list[Any]
    ) -> None:
        resolved = resolve_as_a_run_does(
            {"command": "env", "env_vars": {"TOKEN": entry}}, {"env_vars.TOKEN"}, variables
        )

        with pytest.raises(ValueError, match=exact(NULL_ENTRY)):
            await run(resolved)

        assert launches == []

    async def test_a_stored_null_entry_passes_the_resolve_and_fails_the_block(
        self, launches: list[Any]
    ) -> None:
        resolved = resolve_as_a_run_does({"command": "env", "env_vars": {"TOKEN": None}}, set(), {})

        with pytest.raises(ValueError, match=exact(NULL_ENTRY)):
            await run(resolved)

        assert launches == []


def resolve_as_a_run_does(
    values: dict[str, Any], expressions: set[str], variables: dict[str, Any]
) -> dict[str, Any]:
    """Resolve the settings the way a run does, the null gate included."""
    fields = ShellExecPlugin().metadata["parameters"]
    parameter_types, *_ = derive_parameter_metadata(fields)
    return resolve_parameters(
        values,
        expressions,
        variables,
        parameter_types,
        map_expression_keys=build_map_expression_keys(expressions),
        null_policies=plugin_executor.null_policy_fields(fields),
    )


PASS_PARAMS: dict[str, Any] = {
    "command": "echo ready; sleep 30",
    "stop_on_pattern": True,
    "pass_pattern": "^ready",
}


class TestStopOnPattern:
    """A matching line ends the command and decides the outcome."""

    async def test_a_pass_match_stops_the_command_and_the_block_passes(self) -> None:
        result = await run(PASS_PARAMS)

        assert result["success"] is True
        assert result["exit_code"] == 137
        assert result["error"] == ""
        assert result["reason"] == ""
        assert "ready\n" in result["stdout"]

    async def test_a_pass_match_says_why_the_command_stopped(self) -> None:
        logger = MagicMock()

        await ShellExecPlugin().execute(context(PASS_PARAMS, logger=logger))

        assert messages(logger, "info") == [START_LINE, f"{PASS_LINE}: ready"]

    async def test_a_pass_match_on_a_secret_stream_omits_the_line(self) -> None:
        logger = MagicMock()

        await ShellExecPlugin().execute(
            context(PASS_PARAMS, logger=logger, output_secret_fields=["stdout"])
        )

        assert messages(logger, "info") == [START_LINE, PASS_LINE]

    async def test_a_fail_match_adds_no_info_line(self) -> None:
        logger = MagicMock()

        await ShellExecPlugin().execute(
            context(
                {
                    "command": "echo boom; sleep 30",
                    "stop_on_pattern": True,
                    "fail_pattern": "^boom",
                    "on_error": "record",
                },
                logger=logger,
            )
        )

        assert messages(logger, "info") == [START_LINE]

    async def test_a_pass_match_lets_the_command_handle_the_stop(self) -> None:
        result = await run(
            {
                **PASS_PARAMS,
                "command": "trap 'echo bye; exit 0' TERM; echo ready; sleep 30 & wait",
            }
        )

        assert result["stdout"] == "ready\nbye\n"
        assert result["exit_code"] == 137
        assert result["success"] is True

    async def test_a_fail_match_stops_the_command_and_the_block_fails(self) -> None:
        result = await run(
            {
                "command": "echo boom; sleep 30",
                "stop_on_pattern": True,
                "fail_pattern": "^boom",
                "on_error": "record",
            }
        )

        assert result["success"] is False
        assert result["exit_code"] == 137
        assert result["error"] == "Output matched the fail pattern: boom"
        assert result["reason"] == "FailPattern"


class TestLogOutput:
    """With Log Output on, each line reaches the run console as it arrives."""

    async def test_a_stdout_line_is_logged_at_info(self) -> None:
        logger = MagicMock()

        await ShellExecPlugin().execute(
            context({"command": "echo live", "stream_output": True}, logger=logger)
        )

        assert [call.args[0] for call in logger.info.call_args_list] == [START_LINE, "live"]

    async def test_a_stderr_line_is_logged_at_warn(self) -> None:
        logger = MagicMock()

        await ShellExecPlugin().execute(
            context({"command": "printf 'bad\\n' >&2", "stream_output": True}, logger=logger)
        )

        assert [call.args[0] for call in logger.warn.call_args_list] == ["bad"]


async def test_timeout_message() -> None:
    """The deadline ends the command with the Timeout message (SHRUN-14)."""
    with pytest.raises(ValueError, match=exact("Command timed out after 1 second")):
        await run({"command": "sleep 30", "timeout": 1})
