"""Shell Script end to end on a real shell (REQ-3.4.1.1).

The Shell row names the program (SHRUN-3), arguments arrive as positionals (SHRUN-4), input
variables reach the environment (SHRUN-5), variable exports are read as the bound variable's
type (SHRUN-6, SHRUN-7), outcomes carry their reason (SHRUN-8, SHRUN-9), the private directory
lives under WAVE's own storage (SHRUN-10), console lines follow Log Output (SHRUN-12), a
pattern stops the run (SHRUN-13) and a deadline bounds it (SHRUN-14); the first console line
names the shell and the script, and a non-zero exit names the last stderr line (SHRUN-9,
SHRUN-12). REQ-3.4.3.1 and
REQ-3.4.3.2 reach the block through testdata:// and artifact:// paths, and REQ-3.1.3.16 keeps
a stream marked secret out of the live console. REQ-3.1.3.22: a null input variable or argument
row fails the block before the script starts.
"""

import asyncio
import os
import re
import sys
import tempfile
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.api.services import storage_paths
from wavecore.core.execution import plugin_executor
from wavecore.core.execution.plugin_executor import (
    build_map_expression_keys,
    derive_parameter_metadata,
    resolve_parameters,
)
from wavecore.plugins import _local_process
from wavecore.plugins import shell_script as shell_script_module
from wavecore.plugins.shell_script import ShellScriptPlugin

EXPORT_NAMES = ["COUNT", "STATUS"]
EXPORT_BINDINGS = {"COUNT": "c", "STATUS": "s"}
EXPORT_TYPES = {"COUNT": "integer", "STATUS": "string"}
NEVER_SET_DEBUG = "Variable export 'MISSING' was never set; the bound variable keeps its value"
HANDED_ON_WARN = "Variable exports were not read: the script replaced WAVE's exit handler"
NOT_ENDED_WARN = "Variable exports were not read: the script did not end after the pattern match"
PASS_LINE = "Output matched the pass pattern"
START_LINE = "Running the script under /bin/bash on the WAVE server"
NULL_INPUT_VARIABLE = "'TOKEN' in 'input_vars' is null"
NULL_ARGUMENT_ROW = "Row 2 in 'arguments' is null"

_OMITTED = object()


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def context(
    params: dict[str, Any],
    *,
    logger: Any = None,
    output_bindings: dict[str, str] | None = None,
    output_types: Any = _OMITTED,
    output_secret_fields: list[str] | None = None,
    artifacts_dir: Path | None = None,
    testdata_dirs: list[Path] | None = None,
) -> dict[str, Any]:
    """The execute() context the workbench builds for a block."""
    built: dict[str, Any] = {
        "parameters": params,
        "variables": {},
        "logger": logger if logger is not None else MagicMock(),
        "output_bindings": output_bindings or {},
        "output_secret_fields": output_secret_fields or [],
        "artifacts_dir": str(artifacts_dir) if artifacts_dir is not None else None,
        "testdata_dirs": [str(d) for d in testdata_dirs] if testdata_dirs is not None else [],
    }
    if output_types is not _OMITTED:
        built["output_types"] = output_types
    return built


async def run_script(params: dict[str, Any], **ctx: Any) -> dict[str, Any]:
    """Run Shell Script once against a real shell."""
    return await ShellScriptPlugin().execute(context(params, **ctx))


def messages(logger: MagicMock, level: str) -> list[str]:
    """The messages written at one log level."""
    return [str(call.args[0]) for call in getattr(logger, level).call_args_list if call.args]


def every_message(logger: MagicMock) -> list[str]:
    """Every argument of every logger call, at any level."""
    return [str(arg) for _, args, kwargs in logger.mock_calls for arg in (*args, *kwargs.values())]


async def wait_for_private_dir(root: Path) -> Path:
    """Wait for the block's private directory to appear, then answer with it."""
    for _ in range(200):
        made = list(root.glob("shell-script-*"))
        if made:
            return made[0]
        await asyncio.sleep(0.005)
    raise AssertionError("the block never made its private directory")


def export_params(script: str, **overrides: Any) -> dict[str, Any]:
    """Params that declare the two exports of the variable-export matrix."""
    return {"script": script, "script_variables": list(EXPORT_NAMES), **overrides}


@pytest.fixture
def testdata(tmp_path: Path) -> Path:
    root = tmp_path / "testdata"
    root.mkdir()
    return root


@pytest.fixture
def fresh_storage_base(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Generator[Path, None, None]:
    """A storage base whose local-process root does not exist yet."""
    base = tmp_path / "fresh-base"
    base.mkdir()
    monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", str(base))
    storage_paths.reset_path_cache()
    yield base
    storage_paths.reset_path_cache()


@pytest.fixture
def storage_base_is_a_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Generator[Path, None, None]:
    """A storage base that is a regular file, so no private directory can be made."""
    blocker = tmp_path / "storage-file"
    blocker.write_text("", encoding="utf-8")
    monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", str(blocker))
    storage_paths.reset_path_cache()
    yield blocker
    storage_paths.reset_path_cache()


class TestLaunchPath:
    """Both Script Types launch the same way, and the Shell row names the program."""

    @pytest.mark.parametrize("script_type", ["source", "file"])
    async def test_both_script_types_launch_the_same_way(
        self, script_type: str, testdata: Path
    ) -> None:
        body = 'echo "$# $1"'
        params: dict[str, Any] = {"arguments": [{"value": "a"}]}
        if script_type == "source":
            params["script"] = body
        else:
            (testdata / "run.sh").write_text(f"{body}\n", encoding="utf-8")
            params["script_type"] = "file"
            params["script_file"] = "testdata://run.sh"

        result = await run_script(params, testdata_dirs=[testdata])

        assert result["stdout"] == "1 a\n"

    async def test_a_source_script_runs_from_a_file(self) -> None:
        result = await run_script({"script": 'echo "$0"'})

        printed = Path(result["stdout"].strip())
        assert printed.is_absolute()
        assert printed.name == "script.sh"

    async def test_a_file_script_keeps_its_own_path(self, testdata: Path) -> None:
        script_file = testdata / "run.sh"
        script_file.write_text('echo "$0"\n', encoding="utf-8")

        result = await run_script(
            {"script_type": "file", "script_file": "testdata://run.sh"},
            testdata_dirs=[testdata],
        )

        assert Path(result["stdout"].strip()).samefile(script_file)

    @pytest.mark.parametrize("shell", ["/bin/bash", "/bin/sh"])
    async def test_the_shell_row_decides_the_program(self, shell: str) -> None:
        result = await run_script(
            {"script": 'p=$(readlink /proc/$$/exe); echo "$p"', "shell": shell}
        )

        assert result["stdout"].strip() == os.path.realpath(shell)

    async def test_a_shebang_line_is_ignored(self, testdata: Path) -> None:
        (testdata / "run.sh").write_text("#!/usr/bin/python3\necho shell-ran\n", encoding="utf-8")

        result = await run_script(
            {"script_type": "file", "script_file": "testdata://run.sh", "shell": "/bin/bash"},
            testdata_dirs=[testdata],
        )

        assert result["stdout"] == "shell-ran\n"


class TestRelativePaths:
    """Script File and Shell start from the Working Directory, which starts from the home folder."""

    async def test_a_relative_script_file_starts_from_the_working_directory(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, server_home: Path
    ) -> None:
        work = tmp_path / "work"
        (work / "scripts").mkdir(parents=True)
        (work / "scripts" / "run.sh").write_text("echo from-work\n", encoding="utf-8")
        for decoy_root in (tmp_path, server_home):
            (decoy_root / "scripts").mkdir()
            (decoy_root / "scripts" / "run.sh").write_text("echo decoy\n", encoding="utf-8")
        monkeypatch.chdir(tmp_path)

        result = await run_script(
            {"script_type": "file", "script_file": "scripts/run.sh", "working_dir": str(work)}
        )

        assert result["stdout"] == "from-work\n"

    async def test_a_relative_script_file_keeps_its_resolved_path(self, tmp_path: Path) -> None:
        work = tmp_path / "work"
        work.mkdir()
        (tmp_path / "run.sh").write_text('echo "$0"\n', encoding="utf-8")

        result = await run_script(
            {"script_type": "file", "script_file": "made/../../run.sh", "working_dir": str(work)}
        )

        assert result["stdout"] == f"{tmp_path / 'run.sh'}\n"

    async def test_a_relative_script_file_under_a_relative_working_directory(
        self, server_home: Path
    ) -> None:
        (server_home / "jobs" / "bin").mkdir(parents=True)
        (server_home / "jobs" / "bin" / "run.sh").write_text("pwd -P\n", encoding="utf-8")

        result = await run_script(
            {"script_type": "file", "script_file": "bin/run.sh", "working_dir": "jobs"}
        )

        assert result["stdout"] == f"{(server_home / 'jobs').resolve()}\n"

    async def test_a_relative_script_file_missing_from_the_working_directory_is_named(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        work = tmp_path / "work"
        work.mkdir()
        (tmp_path / "run.sh").write_text("echo decoy\n", encoding="utf-8")
        monkeypatch.chdir(tmp_path)

        result = await run_script(
            {
                "script_type": "file",
                "script_file": "run.sh",
                "working_dir": str(work),
                "on_error": "record",
            }
        )

        assert result["error"] == "Script file not found: run.sh"
        assert result["reason"] == "StartFailed"

    async def test_a_relative_shell_program_starts_from_the_working_directory(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        work = tmp_path / "work"
        (work / "bin").mkdir(parents=True)
        program = work / "bin" / "mysh"
        program.write_text('#!/bin/sh\necho "via mysh"\n', encoding="utf-8")
        program.chmod(0o755)
        monkeypatch.chdir(tmp_path)

        result = await run_script(
            {"script": "ignored", "shell": "./bin/mysh", "working_dir": str(work)}
        )

        assert result["stdout"] == "via mysh\n"


class TestArguments:
    """Rows reach the script as positionals in row order (SHRUN-4)."""

    async def test_rows_arrive_in_row_order(self) -> None:
        result = await run_script(
            {
                "script": 'echo "$1 $2 $3"',
                "arguments": [{"value": "one"}, {"value": "two"}, {"value": "three"}],
            }
        )

        assert result["stdout"] == "one two three\n"

    async def test_an_empty_row_and_a_spaced_row_arrive_intact(self) -> None:
        result = await run_script(
            {
                "script": "printf '[%s]' \"$@\"",
                "arguments": [{"value": ""}, {}, {"value": "a b"}],
            }
        )

        assert result["stdout"] == "[][][a b]"

    async def test_the_row_count_is_the_positional_count(self) -> None:
        result = await run_script(
            {
                "script": "echo $#",
                "arguments": [{"value": ""}, {"value": "x"}, {"value": "y z"}],
            }
        )

        assert result["stdout"] == "3\n"

    async def test_an_expression_row_is_resolved_before_the_launch(self) -> None:
        parameter_types, *_ = derive_parameter_metadata(ShellScriptPlugin().metadata["parameters"])
        resolved = resolve_parameters(
            {"arguments": [{"value": "--env"}, {"value": "n"}]},
            {"arguments.1.value"},
            {"n": 5},
            parameter_types,
            map_expression_keys=build_map_expression_keys({"arguments.1.value"}),
        )

        result = await run_script({"script": 'echo "$1 $2"', **resolved})

        assert result["stdout"] == "--env 5\n"


class TestInputVariables:
    """An input variable is exported, so every program the script starts sees it (SHRUN-5)."""

    async def test_a_child_process_sees_an_input_variable(self) -> None:
        result = await run_script(
            {
                "script": "bash -c 'echo \"$GREETING\"'",
                "input_vars": {"GREETING": "hi"},
            }
        )

        assert result["stdout"] == "hi\n"


@pytest.fixture
def launches(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every process the block asks to start; a launch fails the test."""
    started: list[Any] = []

    async def launch(spec: Any) -> Any:
        started.append(spec)
        raise AssertionError("the script was started")

    monkeypatch.setattr(shell_script_module, "run_local_process", launch)
    return started


NULL_TEXT_CASES = [
    pytest.param(
        {"input_vars": {"GREETING": "hi", "TOKEN": None}},
        NULL_INPUT_VARIABLE,
        id="input-variable",
    ),
    pytest.param(
        {"arguments": [{"value": "a"}, {"value": None}, {"value": "c"}]},
        NULL_ARGUMENT_ROW,
        id="argument-row",
    ),
]


class TestNullTextValues:
    """A shell has no null, so a null input variable or argument row fails before the start."""

    @pytest.mark.parametrize(("params", "message"), NULL_TEXT_CASES)
    async def test_it_fails_the_block_and_names_the_entry_or_row(
        self, params: dict[str, Any], message: str, launches: list[Any]
    ) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            await run_script({"script": "echo hi", **params})

        assert launches == []

    @pytest.mark.parametrize(("params", "message"), NULL_TEXT_CASES)
    async def test_it_records_a_start_failure_under_record(
        self, params: dict[str, Any], message: str, launches: list[Any]
    ) -> None:
        result = await run_script({"script": "echo hi", "on_error": "record", **params})

        assert result["exit_code"] == -1
        assert result["reason"] == "StartFailed"
        assert result["error"] == message
        assert result["success"] is False
        assert launches == []

    @pytest.mark.parametrize(("params", "message"), NULL_TEXT_CASES)
    async def test_no_private_directory_outlives_the_refusal(
        self, params: dict[str, Any], message: str, launches: list[Any], fresh_storage_base: Path
    ) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            await run_script({"script": "echo hi", **params})

        assert list(storage_paths.get_local_process_storage_path().glob("shell-script-*")) == []

    async def test_a_null_item_reaches_the_script_as_json_null(self) -> None:
        result = await run_script(
            {
                "script": 'echo "$ITEMS $1"',
                "input_vars": {"ITEMS": [1, None, 2]},
                "arguments": [{"value": {"a": None}}],
            }
        )

        assert result["stdout"] == '[1,null,2] {"a":null}\n'

    async def test_an_input_variable_left_empty_arrives_as_empty_text(self) -> None:
        result = await run_script({"script": 'echo "[$VALUE]"', "input_vars": {"VALUE": ""}})

        assert result["stdout"] == "[]\n"

    @pytest.mark.parametrize(
        ("raw", "expression_field", "message"),
        [
            pytest.param(
                {"input_vars": {"TOKEN": "token"}},
                "input_vars.TOKEN",
                NULL_INPUT_VARIABLE,
                id="input-variable",
            ),
            pytest.param(
                {"arguments": [{"value": "a"}, {"value": "token"}]},
                "arguments.1.value",
                NULL_ARGUMENT_ROW,
                id="argument-row",
            ),
        ],
    )
    async def test_an_expression_that_gives_null_passes_the_resolve_and_fails_the_block(
        self, raw: dict[str, Any], expression_field: str, message: str, launches: list[Any]
    ) -> None:
        resolved = resolve_as_a_run_does(
            {"script": "echo hi", **raw}, {expression_field}, {"token": None}
        )

        with pytest.raises(ValueError, match=exact(message)):
            await run_script(resolved)

        assert launches == []


def resolve_as_a_run_does(
    values: dict[str, Any], expressions: set[str], variables: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Resolve the settings the way a run does, the null gate included."""
    fields = ShellScriptPlugin().metadata["parameters"]
    parameter_types, *_ = derive_parameter_metadata(fields)
    return resolve_parameters(
        values,
        expressions,
        dict(variables or {}),
        parameter_types,
        map_expression_keys=build_map_expression_keys(expressions),
        null_policies=plugin_executor.null_policy_fields(fields),
    )


async def run_as_resolved(values: dict[str, Any], expressions: set[str]) -> dict[str, Any]:
    """Resolve the settings the way a run does, then run the block."""
    return await run_script(resolve_as_a_run_does(values, expressions))


PRINTS_ARGUMENTS_AND_TOKEN = 'printf "[%s]" "$#" "$@" "${TOKEN-unset}"'

LEFT_WITH_NO_VALUE = [
    pytest.param("input_vars", "input_vars.TOKEN", NULL_INPUT_VARIABLE, id="input-variable"),
    pytest.param("arguments", "arguments.1.value", NULL_ARGUMENT_ROW, id="argument-row"),
]

STORED_NULLS = [
    pytest.param("input_vars", NULL_INPUT_VARIABLE, id="input-variable"),
    pytest.param("arguments", NULL_ARGUMENT_ROW, id="argument-row"),
]


class TestEntriesGivenNothing:
    """An input variable or argument row left with no value reaches the block as null and fails
    it before the start; empty text stays empty text (SHRUN-4, REQ-3.1.3.22)."""

    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "blank"])
    @pytest.mark.parametrize(("setting", "expression", "message"), LEFT_WITH_NO_VALUE)
    async def test_an_expression_left_blank_fails_before_the_start(
        self, setting: str, expression: str, message: str, text: str, launches: list[Any]
    ) -> None:
        entries = {"input_vars": {"TOKEN": text}, "arguments": [{"value": "a"}, {"value": text}]}

        with pytest.raises(ValueError, match=exact(message)):
            await run_as_resolved(
                {"script": PRINTS_ARGUMENTS_AND_TOKEN, setting: entries[setting]}, {expression}
            )

        assert launches == []

    @pytest.mark.parametrize(("setting", "message"), STORED_NULLS)
    async def test_a_stored_null_fails_before_the_start(
        self, setting: str, message: str, launches: list[Any]
    ) -> None:
        entries = {"input_vars": {"TOKEN": None}, "arguments": [{"value": "a"}, {"value": None}]}

        with pytest.raises(ValueError, match=exact(message)):
            await run_as_resolved(
                {"script": PRINTS_ARGUMENTS_AND_TOKEN, setting: entries[setting]}, set()
            )

        assert launches == []

    async def test_empty_text_arrives_as_empty_text(self) -> None:
        result = await run_as_resolved(
            {
                "script": PRINTS_ARGUMENTS_AND_TOKEN,
                "input_vars": {"TOKEN": ""},
                "arguments": [{"value": "a"}, {"value": ""}],
            },
            set(),
        )

        assert result["stdout"] == "[2][a][][]"


class TestStartLine:
    """One INFO line names the shell and the script as the block starts (SHRUN-12)."""

    async def test_a_typed_script_is_named_without_its_body(self) -> None:
        logger = MagicMock()

        await run_script({"script": "echo body-text", "shell": "/bin/sh"}, logger=logger)

        assert messages(logger, "info") == ["Running the script under /bin/sh on the WAVE server"]

    async def test_a_script_file_is_named_by_its_path_as_written(self, testdata: Path) -> None:
        (testdata / "run.sh").write_text("echo hi\n", encoding="utf-8")
        logger = MagicMock()

        await run_script(
            {"script_type": "file", "script_file": "testdata://run.sh"},
            logger=logger,
            testdata_dirs=[testdata],
        )

        assert messages(logger, "info") == [
            "Running testdata://run.sh under /bin/bash on the WAVE server"
        ]

    async def test_the_line_is_written_before_a_start_failure(self) -> None:
        logger = MagicMock()

        await run_script(
            {"script": "echo hi", "shell": "/nope/sh", "on_error": "record"}, logger=logger
        )

        assert messages(logger, "info") == ["Running the script under /nope/sh on the WAVE server"]

    async def test_the_line_comes_before_the_first_live_line(self) -> None:
        logger = MagicMock()

        await run_script({"script": "echo out", "stream_output": True}, logger=logger)

        assert messages(logger, "info") == [START_LINE, "out"]

    async def test_a_non_shell_program_shows_why_the_script_never_ran(self) -> None:
        logger = MagicMock()

        result = await run_script(
            {"script": "puts 'test'", "shell": sys.executable, "on_error": "record"},
            logger=logger,
        )

        assert messages(logger, "info") == [
            f"Running the script under {sys.executable} on the WAVE server"
        ]
        assert result["error"] == "Script exited with code 1: SyntaxError: invalid syntax"


class TestNonZeroExit:
    """A non-zero exit code is a failure that names the last stderr line (SHRUN-8, SHRUN-9)."""

    async def test_it_raises_under_fail(self) -> None:
        with pytest.raises(ValueError, match=exact("Script exited with code 2")):
            await run_script({"script": "exit 2"})

    async def test_it_records_the_outcome_under_record(self) -> None:
        result = await run_script({"script": "exit 2", "on_error": "record"})

        assert result["success"] is False
        assert result["reason"] == "NonZeroExit"
        assert result["exit_code"] == 2
        assert result["error"] == "Script exited with code 2"
        assert result["__block_warning"] is True

    async def test_a_recorded_failure_logs_the_warn_line(self) -> None:
        logger = MagicMock()

        await run_script({"script": "exit 2", "on_error": "record"}, logger=logger)

        logger.warn.assert_called_once_with(
            "Script failed (NonZeroExit): Script exited with code 2"
        )

    async def test_the_message_ends_with_the_last_stderr_line(self) -> None:
        with pytest.raises(ValueError, match=exact("Script exited with code 3: err")):
            await run_script({"script": "echo out; echo err >&2; exit 3"})

    async def test_a_recorded_failure_names_the_last_stderr_line(self) -> None:
        logger = MagicMock()

        result = await run_script(
            {"script": "echo first >&2; echo 'last words' >&2; exit 3", "on_error": "record"},
            logger=logger,
        )

        assert result["error"] == "Script exited with code 3: last words"
        assert result["stderr"] == "first\nlast words\n"
        logger.warn.assert_called_once_with(
            "Script failed (NonZeroExit): Script exited with code 3: last words"
        )

    async def test_a_stderr_stream_marked_secret_keeps_the_bare_message(self) -> None:
        result = await run_script(
            {"script": "echo token-value >&2; exit 3", "on_error": "record"},
            output_secret_fields=["stderr"],
        )

        assert result["error"] == "Script exited with code 3"


START_FAILURES = [
    pytest.param(
        {"script_type": "file", "script_file": "testdata://missing.sh"},
        "Script file not found: testdata://missing.sh",
        id="script-file-missing",
    ),
    pytest.param(
        {"script": "echo hi", "working_dir": "/nope"},
        "Working directory not found: /nope",
        id="working-dir-missing",
    ),
    pytest.param(
        {"script": "echo hi", "shell": "/nope/sh"},
        "Shell not found on the WAVE server: /nope/sh",
        id="shell-missing",
    ),
    pytest.param(
        {"script_type": "file", "script_file": "testdata://"},
        "Path is the root folder: testdata://",
        id="scheme-root",
    ),
]


class TestStartFailed:
    """A run that never starts fails with exit code -1 and reason StartFailed (SHRUN-9)."""

    @pytest.mark.parametrize(("params", "message"), START_FAILURES)
    async def test_it_raises_under_fail(
        self, params: dict[str, Any], message: str, testdata: Path
    ) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            await run_script(dict(params), testdata_dirs=[testdata])

    @pytest.mark.parametrize(("params", "message"), START_FAILURES)
    async def test_it_records_minus_one_under_record(
        self, params: dict[str, Any], message: str, testdata: Path
    ) -> None:
        result = await run_script({**params, "on_error": "record"}, testdata_dirs=[testdata])

        assert result["exit_code"] == -1
        assert result["reason"] == "StartFailed"
        assert result["error"] == message
        assert result["success"] is False

    async def test_a_private_dir_that_cannot_be_made_raises(
        self, storage_base_is_a_file: Path
    ) -> None:
        with pytest.raises(ValueError, match=exact("Could not start the script: Not a directory")):
            await run_script({"script": "echo hi"})

    async def test_a_private_dir_that_cannot_be_made_records_minus_one(
        self, storage_base_is_a_file: Path
    ) -> None:
        result = await run_script({"script": "echo hi", "on_error": "record"})

        assert result["exit_code"] == -1
        assert result["reason"] == "StartFailed"
        assert result["error"] == "Could not start the script: Not a directory"

    async def test_a_script_file_that_is_a_directory_records_minus_one(
        self, tmp_path: Path
    ) -> None:
        result = await run_script(
            {"script_type": "file", "script_file": str(tmp_path), "on_error": "record"}
        )

        assert result["exit_code"] == -1
        assert result["reason"] == "StartFailed"
        assert result["error"] == f"Script file not found: {tmp_path}"


class TestPrivateDir:
    """The block's private directory lives under WAVE's storage and never outlives the run."""

    async def test_it_is_gone_after_a_successful_run(self, tmp_path: Path) -> None:
        result = await run_script({"script": 'echo "$0"', "working_dir": str(tmp_path)})

        assert not Path(result["stdout"].strip()).parent.exists()

    async def test_it_is_gone_after_a_failed_run(self, tmp_path: Path) -> None:
        result = await run_script(
            {"script": 'echo "$0"; exit 2', "working_dir": str(tmp_path), "on_error": "record"}
        )

        assert not Path(result["stdout"].strip()).parent.exists()

    async def test_it_is_gone_after_a_cancel(self, tmp_path: Path) -> None:
        root = storage_paths.get_local_process_storage_path()
        task = asyncio.create_task(
            run_script({"script": 'echo "$0"; sleep 5', "working_dir": str(tmp_path)})
        )
        await wait_for_private_dir(root)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert list(root.glob("shell-script-*")) == []

    async def test_it_sits_under_the_local_process_storage_path(self, tmp_path: Path) -> None:
        result = await run_script({"script": 'echo "$0"', "working_dir": str(tmp_path)})

        private = Path(result["stdout"].strip()).parent
        assert private.parent == storage_paths.get_local_process_storage_path()

    async def test_it_sits_outside_the_working_directory(self, tmp_path: Path) -> None:
        result = await run_script({"script": 'echo "$0"', "working_dir": str(tmp_path)})

        assert tmp_path not in Path(result["stdout"].strip()).parents

    async def test_its_name_carries_the_block_prefix(self, tmp_path: Path) -> None:
        result = await run_script({"script": 'echo "$0"', "working_dir": str(tmp_path)})

        assert Path(result["stdout"].strip()).parent.name.startswith("shell-script-")

    async def test_a_missing_local_process_root_is_made_and_left_empty(
        self, fresh_storage_base: Path
    ) -> None:
        result = await run_script({"script": "echo hi"})

        root = storage_paths.get_local_process_storage_path()
        assert result["stdout"] == "hi\n"
        assert list(root.glob("shell-script-*")) == []


class TestTimeout:
    """The deadline bounds the whole run (SHRUN-14)."""

    async def test_timeout_message(self) -> None:
        with pytest.raises(ValueError, match=exact("Script timed out after 1 second")):
            await run_script({"script": "sleep 5", "timeout": 1})


@pytest.fixture
def system_temp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The folder tempfile.gettempdir() reports for this test."""
    folder = tmp_path / "system-temp"
    folder.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(folder))
    return folder


class TestDefaults:
    """An absent or blank working directory starts in the system temp folder (REQ-3.4.3.11)."""

    async def test_a_bare_script_runs_in_the_temp_folder(self, system_temp: Path) -> None:
        result = await run_script({"script": "pwd -P"})

        assert result["stdout"] == f"{system_temp.resolve()}\n"

    @pytest.mark.parametrize("value", [None, "", "   "], ids=["none", "empty", "whitespace"])
    async def test_a_blank_working_directory_starts_in_the_temp_folder(
        self, value: str | None, system_temp: Path
    ) -> None:
        result = await run_script({"script": "pwd -P", "working_dir": value})

        assert result["stdout"] == f"{system_temp.resolve()}\n"


class TestBindings:
    """Only a bound export is returned, and an undeclared type reads as raw text (SHRUN-6)."""

    async def test_an_unbound_export_returns_no_output(self) -> None:
        result = await run_script({"script": "X=1", "script_variables": ["X"]})

        assert "X" not in result

    async def test_a_binding_with_no_declared_type_returns_raw_text(self) -> None:
        result = await run_script(
            {"script": "COUNT=007", "script_variables": ["COUNT"]},
            output_bindings={"COUNT": "c"},
        )

        assert result["COUNT"] == "007"


class TestStdout:
    """Stdout is a block output and is returned as the script wrote it."""

    async def test_stdout_is_returned_verbatim(self) -> None:
        result = await run_script({"script": "printf 'a\\nb\\n'"})

        assert result["stdout"] == "a\nb\n"

    async def test_a_trailing_newline_is_kept(self) -> None:
        result = await run_script({"script": "echo hi"})

        assert result["stdout"] == "hi\n"


class TestNoRawIoDumps:
    """With Log Output off the block writes no I/O of its own to the console (REQ-3.1.3.16)."""

    async def test_no_logger_call_holds_an_exported_value(self) -> None:
        logger = MagicMock()

        result = await run_script(
            {"script": "SECRETISH=leaky-value", "script_variables": ["SECRETISH"]},
            logger=logger,
            output_bindings={"SECRETISH": "s"},
            output_types={"SECRETISH": "string"},
        )

        assert result["SECRETISH"] == "leaky-value"
        assert [line for line in every_message(logger) if "leaky-value" in line] == []


class TestVariableExports:
    """Exports are read as the bound variable's type when the script ends on its own."""

    async def test_each_export_is_read_as_its_bound_type(self) -> None:
        result = await run_script(
            export_params("COUNT=7; STATUS=ok"),
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["COUNT"] == 7
        assert isinstance(result["COUNT"], int)
        assert result["STATUS"] == "ok"
        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_a_file_scripts_exports_are_read_as_their_bound_types(
        self, testdata: Path
    ) -> None:
        (testdata / "run.sh").write_text("COUNT=7; STATUS=ok\n", encoding="utf-8")

        result = await run_script(
            {
                "script_type": "file",
                "script_file": "testdata://run.sh",
                "script_variables": list(EXPORT_NAMES),
            },
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
            testdata_dirs=[testdata],
        )

        assert result["COUNT"] == 7
        assert result["STATUS"] == "ok"
        assert result["success"] is True

    async def test_a_conversion_failure_raises_under_fail(self) -> None:
        with pytest.raises(
            ValueError, match=exact("Script variable 'COUNT' is not a valid integer")
        ):
            await run_script(
                export_params("COUNT=abc; STATUS=ok"),
                output_bindings=EXPORT_BINDINGS,
                output_types=EXPORT_TYPES,
            )

    async def test_a_recorded_conversion_failure_binds_what_converted(self) -> None:
        result = await run_script(
            export_params("COUNT=abc; STATUS=ok", on_error="record"),
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["STATUS"] == "ok"
        assert "COUNT" not in result
        assert result["reason"] == "OutputVariable"
        assert result["success"] is False
        assert result["__block_warning"] is True

    async def test_a_recorded_conversion_failure_logs_the_warn_line(self) -> None:
        logger = MagicMock()

        await run_script(
            export_params("COUNT=abc; STATUS=ok", on_error="record"),
            logger=logger,
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        logger.warn.assert_called_once_with(
            "Script failed (OutputVariable): Script variable 'COUNT' is not a valid integer"
        )

    async def test_a_never_set_export_does_not_shadow_a_real_failure(self) -> None:
        result = await run_script(
            export_params("COUNT=abc", on_error="record"),
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["error"] == "Script variable 'COUNT' is not a valid integer"
        assert result["reason"] == "OutputVariable"
        assert "STATUS" not in result

    async def test_the_error_names_the_first_failure_in_list_order(self) -> None:
        result = await run_script(
            export_params("COUNT=abc; STATUS=def", on_error="record"),
            output_bindings=EXPORT_BINDINGS,
            output_types={"COUNT": "integer", "STATUS": "integer"},
        )

        assert result["error"] == "Script variable 'COUNT' is not a valid integer"

    async def test_the_list_order_decides_which_failure_is_named(self) -> None:
        result = await run_script(
            {
                "script": "COUNT=abc; STATUS=def",
                "script_variables": ["STATUS", "COUNT"],
                "on_error": "record",
            },
            output_bindings=EXPORT_BINDINGS,
            output_types={"COUNT": "integer", "STATUS": "integer"},
        )

        assert result["error"] == "Script variable 'STATUS' is not a valid integer"

    async def test_a_non_zero_exit_outranks_a_converted_export(self) -> None:
        result = await run_script(
            export_params("COUNT=7; STATUS=ok; exit 3", on_error="record"),
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["COUNT"] == 7
        assert result["reason"] == "NonZeroExit"
        assert result["exit_code"] == 3

    async def test_an_export_the_script_never_set_is_not_a_failure(self) -> None:
        logger = MagicMock()

        result = await run_script(
            {"script": "echo hi", "script_variables": ["MISSING"]},
            logger=logger,
            output_bindings={"MISSING": "m"},
            output_types={"MISSING": "string"},
        )

        assert result["success"] is True
        assert result["reason"] == ""
        assert "MISSING" not in result
        assert messages(logger, "debug").count(NEVER_SET_DEBUG) == 1
        assert [line for line in every_message(logger) if "was not set by the script" in line] == []

    async def test_a_handed_on_process_takes_the_amber_path(self) -> None:
        logger = MagicMock()

        result = await run_script(
            {"script": "SET_TWO=2; exec /bin/true", "script_variables": ["SET_TWO"]},
            logger=logger,
            output_bindings={"SET_TWO": "two"},
            output_types={"SET_TWO": "integer"},
        )

        assert result["success"] is True
        assert result["__block_warning"] is True
        assert "SET_TWO" not in result
        logger.warn.assert_called_once_with(HANDED_ON_WARN)


class TestLiveConsoleLines:
    """Log Output writes stdout at INFO and stderr at WARN (SHRUN-12)."""

    async def test_stdout_logs_at_info_and_stderr_at_warn(self) -> None:
        logger = MagicMock()

        await run_script({"script": "echo out; echo err >&2", "stream_output": True}, logger=logger)

        assert "out" in messages(logger, "info")
        assert "err" in messages(logger, "warn")

    async def test_a_stream_marked_secret_writes_no_live_line(self) -> None:
        logger = MagicMock()

        await run_script(
            {"script": "echo out; echo err >&2", "stream_output": True},
            logger=logger,
            output_secret_fields=["stdout"],
        )

        assert [line for line in every_message(logger) if "out" in line] == []
        assert "err" in messages(logger, "warn")


PATTERN_PARAMS: dict[str, Any] = {
    "script": "echo ERROR x; sleep 30",
    "stop_on_pattern": True,
    "fail_pattern": "ERROR",
    "timeout": 60,
}
PASS_PARAMS: dict[str, Any] = {
    "script": "echo READY now; sleep 30",
    "stop_on_pattern": True,
    "pass_pattern": "READY",
    "timeout": 60,
}
EXPORTS_THEN_PASS = "COUNT=7; STATUS=ok; echo READY now; sleep 30"
EXPORTS_THEN_FAIL = "COUNT=7; STATUS=ok; echo ERROR x; sleep 30"
EXPORTS_THEN_IGNORE_TERM = 'COUNT=7; STATUS=ok; trap "" TERM; echo READY now; sleep 30'


def pass_stop(script: str, **overrides: Any) -> dict[str, Any]:
    return export_params(script, stop_on_pattern=True, pass_pattern="READY", **overrides)


def fail_stop(script: str, **overrides: Any) -> dict[str, Any]:
    return export_params(script, stop_on_pattern=True, fail_pattern="ERROR", **overrides)


class TestStopOnPattern:
    """A Fail pattern stops the script and fails the block (SHRUN-13)."""

    async def test_a_recorded_match_reports_the_line(self) -> None:
        result = await run_script({**PATTERN_PARAMS, "on_error": "record"})

        assert result["success"] is False
        assert result["reason"] == "FailPattern"
        assert result["exit_code"] == 137
        assert result["error"] == "Output matched the fail pattern: ERROR x"

    async def test_a_match_on_a_secret_stream_omits_the_line(self) -> None:
        result = await run_script(
            {**PATTERN_PARAMS, "on_error": "record"}, output_secret_fields=["stdout"]
        )

        assert result["error"] == "Output matched the fail pattern"

    async def test_a_match_raises_under_fail(self) -> None:
        with pytest.raises(ValueError, match=exact("Output matched the fail pattern: ERROR x")):
            await run_script(PATTERN_PARAMS)

    async def test_a_fail_match_adds_no_info_line(self) -> None:
        logger = MagicMock()

        await run_script({**PATTERN_PARAMS, "on_error": "record"}, logger=logger)

        assert messages(logger, "info") == [START_LINE]


class TestPassPatternStop:
    """A Pass pattern stops the script, says so at INFO and the block passes (SHRUN-13)."""

    async def test_the_block_passes_with_exit_code_137(self) -> None:
        result = await run_script(PASS_PARAMS)

        assert result["success"] is True
        assert result["exit_code"] == 137
        assert result["error"] == ""
        assert result["reason"] == ""
        assert "__block_warning" not in result

    async def test_the_console_says_why_the_script_stopped(self) -> None:
        logger = MagicMock()

        await run_script(PASS_PARAMS, logger=logger)

        assert messages(logger, "info") == [START_LINE, f"{PASS_LINE}: READY now"]
        assert messages(logger, "warn") == []

    async def test_a_match_on_a_secret_stream_omits_the_line(self) -> None:
        logger = MagicMock()

        await run_script(PASS_PARAMS, logger=logger, output_secret_fields=["stdout"])

        assert messages(logger, "info") == [START_LINE, PASS_LINE]


class TestExportsAfterAPatternStop:
    """A pattern stop lets the script run WAVE's exit handler, so the exports are read."""

    async def test_exports_bind_after_a_pass_match(self) -> None:
        result = await run_script(
            pass_stop(EXPORTS_THEN_PASS),
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["COUNT"] == 7
        assert result["STATUS"] == "ok"
        assert result["success"] is True
        assert result["exit_code"] == 137
        assert "__block_warning" not in result

    async def test_exports_bind_after_a_recorded_fail_match(self) -> None:
        result = await run_script(
            fail_stop(EXPORTS_THEN_FAIL, on_error="record"),
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["COUNT"] == 7
        assert result["STATUS"] == "ok"
        assert result["success"] is False
        assert result["reason"] == "FailPattern"
        assert result["error"] == "Output matched the fail pattern: ERROR x"
        assert result["exit_code"] == 137
        assert result["__block_warning"] is True

    async def test_nothing_binds_after_a_fail_match_under_fail(self) -> None:
        with pytest.raises(ValueError, match=exact("Output matched the fail pattern: ERROR x")):
            await run_script(
                fail_stop(EXPORTS_THEN_FAIL),
                output_bindings=EXPORT_BINDINGS,
                output_types=EXPORT_TYPES,
            )

    async def test_a_conversion_failure_after_a_pass_match_is_an_output_variable_failure(
        self,
    ) -> None:
        result = await run_script(
            pass_stop("COUNT=abc; STATUS=ok; echo READY now; sleep 30", on_error="record"),
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["STATUS"] == "ok"
        assert "COUNT" not in result
        assert result["reason"] == "OutputVariable"
        assert result["error"] == "Script variable 'COUNT' is not a valid integer"

    async def test_no_exports_are_read_after_a_timeout(self) -> None:
        logger = MagicMock()

        result = await run_script(
            export_params("COUNT=7; STATUS=ok; sleep 30", timeout=0.2, on_error="record"),
            logger=logger,
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["reason"] == "Timeout"
        assert "COUNT" not in result
        assert "STATUS" not in result
        assert messages(logger, "warn") == [
            "Script failed (Timeout): Script timed out after 0.2 seconds"
        ]

    async def test_a_script_that_does_not_end_after_a_pass_match_passes_amber(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(_local_process, "PATTERN_STOP_GRACE", 0.2)
        logger = MagicMock()

        result = await run_script(
            pass_stop(EXPORTS_THEN_IGNORE_TERM),
            logger=logger,
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["success"] is True
        assert result["exit_code"] == 137
        assert result["__block_warning"] is True
        assert "COUNT" not in result
        assert "STATUS" not in result
        logger.warn.assert_called_once_with(NOT_ENDED_WARN)
        assert messages(logger, "info") == [START_LINE, f"{PASS_LINE}: READY now"]

    async def test_a_script_that_does_not_end_after_a_recorded_fail_match_is_amber(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(_local_process, "PATTERN_STOP_GRACE", 0.2)
        logger = MagicMock()

        result = await run_script(
            fail_stop(
                'COUNT=7; STATUS=ok; trap "" TERM; echo ERROR x; sleep 30', on_error="record"
            ),
            logger=logger,
            output_bindings=EXPORT_BINDINGS,
            output_types=EXPORT_TYPES,
        )

        assert result["reason"] == "FailPattern"
        assert result["exit_code"] == 137
        assert result["__block_warning"] is True
        assert "COUNT" not in result
        assert messages(logger, "warn") == [
            NOT_ENDED_WARN,
            "Script failed (FailPattern): Output matched the fail pattern: ERROR x",
        ]
