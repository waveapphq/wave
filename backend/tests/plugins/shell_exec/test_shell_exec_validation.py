"""Shell Exec parameter validation (REQ-3.4.1.18).

Every rejection carries the exact pinned message and raises ValueError, whatever On error
says. REQ-3.4.2.2: the Input Variables names follow the shell identifier rule and may not
take the WAVE_ prefix. An absent or None setting reads its metadata default before any check.
"""

import re
from typing import Any

import pytest

from wavecore.plugins.shell_exec import ShellExecPlugin


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def params(**overrides: Any) -> dict[str, Any]:
    """A valid parameter set with the overrides applied."""
    merged: dict[str, Any] = {"command": "echo hi"}
    merged.update(overrides)
    return merged


def compile_reason(pattern: str) -> str:
    """The regular-expression compiler's own message for a pattern that does not compile."""
    try:
        re.compile(pattern)
    except re.error as exc:
        return str(exc)
    raise AssertionError(f"{pattern!r} compiles")


class TestCommandParameter:
    """The command line is the one setting the block cannot run without."""

    @pytest.mark.parametrize("params_in", [{}, {"command": None}, {"command": ""}])
    async def test_missing_command(self, params_in: dict[str, Any]) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: command")):
            await ShellExecPlugin().validate(params_in)

    async def test_a_command_on_its_own_validates(self) -> None:
        await ShellExecPlugin().validate({"command": "echo hi"})

    async def test_an_unset_on_error_reads_as_fail(self) -> None:
        await ShellExecPlugin().validate({"command": "echo hi", "on_error": None})


class TestShellParameter:
    """The Shell row names the program; blank is refused, unset reads /bin/sh."""

    @pytest.mark.parametrize("value", ["", "   ", "\t"])
    async def test_a_blank_shell_is_refused(self, value: str) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'shell' cannot be empty")):
            await ShellExecPlugin().validate(params(shell=value))

    @pytest.mark.parametrize("value", [None, "/bin/sh", "/bin/bash -o pipefail"])
    async def test_an_unset_or_named_shell_is_accepted(self, value: str | None) -> None:
        await ShellExecPlugin().validate(params(shell=value))


class TestEnvironmentShape:
    """Input Variables is a map of names to values."""

    @pytest.mark.parametrize(
        ("value", "type_name"), [([], "list"), ("GREETING=hi", "str"), (3, "int")]
    )
    async def test_a_non_map_environment_is_refused(self, value: Any, type_name: str) -> None:
        message = f"Parameter 'env_vars' must be a map (dictionary), got {type_name}"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate(params(env_vars=value))

    async def test_an_empty_map_is_accepted(self) -> None:
        await ShellExecPlugin().validate(params(env_vars={}))


class TestEnvironmentNames:
    """A name is a shell identifier, and WAVE_ is reserved for the server's own settings."""

    @pytest.mark.parametrize("name", ["bad-name", "1st", "", "has space", "WAVE-KEY", "a.b"])
    async def test_a_name_that_is_not_a_shell_identifier(self, name: str) -> None:
        with pytest.raises(ValueError, match=exact(f"Invalid variable name: '{name}'")):
            await ShellExecPlugin().validate(params(env_vars={name: "value"}))

    @pytest.mark.parametrize("name", ["WAVE_KEY", "WAVE_", "WAVE_TESTDATA_DIR"])
    async def test_a_name_that_takes_the_reserved_prefix(self, name: str) -> None:
        message = f"Variable names may not start with WAVE_: '{name}'"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate(params(env_vars={name: "value"}))

    async def test_the_identifier_rule_is_checked_before_the_prefix_rule(self) -> None:
        with pytest.raises(ValueError, match=exact("Invalid variable name: 'WAVE-KEY'")):
            await ShellExecPlugin().validate(params(env_vars={"WAVE-KEY": "value"}))

    @pytest.mark.parametrize("name", ["GREETING", "_private", "a1", "WAVES", "count_2"])
    async def test_accepted_names(self, name: str) -> None:
        await ShellExecPlugin().validate(params(env_vars={name: "value"}))


class TestTimeout:
    """The bound is in seconds and must be positive."""

    @pytest.mark.parametrize("value", [0, -1, -300])
    async def test_a_timeout_that_is_not_positive(self, value: int) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await ShellExecPlugin().validate(params(timeout=value))

    @pytest.mark.parametrize("value", [None, 1, 300])
    async def test_accepted_timeouts(self, value: int | None) -> None:
        await ShellExecPlugin().validate(params(timeout=value))

    async def test_the_timeout_is_checked_before_the_environment_names(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await ShellExecPlugin().validate(params(timeout=0, env_vars={"bad-name": "value"}))


class TestWorkingDirectory:
    """The folder is a WAVE scheme or a path, absolute or relative; blank is accepted."""

    @pytest.mark.parametrize("value", ["", "   "])
    async def test_a_blank_working_directory_is_accepted(self, value: str) -> None:
        await ShellExecPlugin().validate(params(working_dir=value))

    @pytest.mark.parametrize(
        "value",
        [
            None,
            "/srv/work",
            "/var/log/wave",
            "artifact://out",
            "testdata://cases",
            "relative/dir",
            "./here",
            "out",
            "../beside",
        ],
    )
    async def test_accepted_working_directories(self, value: str | None) -> None:
        await ShellExecPlugin().validate(params(working_dir=value))


class TestStopOnPattern:
    """While the box is ticked, at least one pattern is required and both must compile."""

    async def test_both_patterns_empty(self) -> None:
        message = "Set a pass pattern, a fail pattern or both"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate(params(stop_on_pattern=True))

    @pytest.mark.parametrize("value", ["[", "(", "a{2,1}"])
    async def test_a_pass_pattern_that_does_not_compile(self, value: str) -> None:
        message = f"Invalid pass pattern: {compile_reason(value)}"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate(params(stop_on_pattern=True, pass_pattern=value))

    @pytest.mark.parametrize("value", ["[", "(", "a{2,1}"])
    async def test_a_fail_pattern_that_does_not_compile(self, value: str) -> None:
        message = f"Invalid fail pattern: {compile_reason(value)}"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate(
                params(stop_on_pattern=True, pass_pattern="^ready", fail_pattern=value)
            )

    async def test_the_pass_pattern_is_compiled_before_the_fail_pattern(self) -> None:
        message = f"Invalid pass pattern: {compile_reason('[')}"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate(
                params(stop_on_pattern=True, pass_pattern="[", fail_pattern="(")
            )

    async def test_both_patterns_may_be_set(self) -> None:
        await ShellExecPlugin().validate(
            params(stop_on_pattern=True, pass_pattern="^ready", fail_pattern="^ERROR")
        )

    async def test_the_patterns_are_ignored_while_the_box_is_off(self) -> None:
        await ShellExecPlugin().validate(params(stop_on_pattern=False, pass_pattern="["))


class TestOnError:
    """Failure Handling is fail or record, and the enum message never echoes a long value."""

    @pytest.mark.parametrize("value", [None, "fail", "record"])
    async def test_accepted_values(self, value: str | None) -> None:
        await ShellExecPlugin().validate(params(on_error=value))

    @pytest.mark.parametrize("value", ["continue", "FAIL", ""])
    async def test_refused_values(self, value: str) -> None:
        message = f"Parameter 'on_error' must be one of: fail, record; Actual value was '{value}'."

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate(params(on_error=value))

    async def test_a_long_value_is_shown_by_length_only(self) -> None:
        value = "x" * 60
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was "
        message += "a 60-character value."

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate(params(on_error=value))

    async def test_on_error_is_checked_before_the_command(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'continue'."

        with pytest.raises(ValueError, match=exact(message)):
            await ShellExecPlugin().validate({"on_error": "continue"})
