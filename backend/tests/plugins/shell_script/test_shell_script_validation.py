"""Shell Script parameter validation (REQ-3.4.1.1, REQ-3.4.2.2).

Every rejection carries the exact pinned message and raises ValueError, whatever On error
says. An absent or None setting reads as its metadata default before any check, so a
parameter set holding only the script validates clean.
"""

import re
from typing import Any

import pytest

from wavecore.plugins.shell_script import ShellScriptPlugin

RESERVED_OUTPUTS = ["stdout", "stderr", "exit_code", "success", "error", "reason"]

VALID_NAMES = ["X", "_x", "COUNT", "A1", "_", "a_b_9"]


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def params_for(**overrides: Any) -> dict[str, Any]:
    """A valid Source-mode parameter set with the overrides applied."""
    merged: dict[str, Any] = {"script": "echo hi"}
    merged.update(overrides)
    return merged


class TestScriptSourceMode:
    """Source mode runs the script typed into the block, so that row is required."""

    @pytest.mark.parametrize("params", [{}, {"script_type": "source"}])
    async def test_missing_script(self, params: dict[str, Any]) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script")):
            await ShellScriptPlugin().validate(params)

    @pytest.mark.parametrize("value", [None, ""])
    async def test_empty_script(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script")):
            await ShellScriptPlugin().validate({"script_type": "source", "script": value})

    async def test_a_script_validates(self) -> None:
        await ShellScriptPlugin().validate({"script_type": "source", "script": "echo hi"})

    async def test_whitespace_is_part_of_the_script(self) -> None:
        await ShellScriptPlugin().validate({"script": "  "})


class TestScriptFileMode:
    """File mode runs a script file, so that row is required and the Script row is not."""

    async def test_missing_script_file(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script_file")):
            await ShellScriptPlugin().validate({"script_type": "file"})

    @pytest.mark.parametrize("value", [None, "", "   "])
    async def test_blank_script_file(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script_file")):
            await ShellScriptPlugin().validate({"script_type": "file", "script_file": value})

    @pytest.mark.parametrize(
        "value", ["testdata://run.sh", "artifact://run.sh", "/opt/scripts/run.sh"]
    )
    async def test_a_script_file_validates_without_a_script(self, value: str) -> None:
        await ShellScriptPlugin().validate({"script_type": "file", "script_file": value})


class TestShellRow:
    """A present Shell row may not be blank; an absent one reads /bin/bash (SHRUN-3)."""

    @pytest.mark.parametrize("value", ["", "   ", "\t"])
    async def test_blank_shell(self, value: str) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'shell' cannot be empty")):
            await ShellScriptPlugin().validate(params_for(shell=value))

    @pytest.mark.parametrize("value", ["/bin/sh", "/bin/bash -o pipefail", "/usr/bin/env ksh"])
    async def test_a_shell_validates(self, value: str) -> None:
        await ShellScriptPlugin().validate(params_for(shell=value))

    async def test_an_unset_shell_reads_the_default(self) -> None:
        await ShellScriptPlugin().validate(params_for(shell=None))


class TestScriptVariableNames:
    """A variable export is named like a shell identifier (SHRUN-6)."""

    @pytest.mark.parametrize("name", VALID_NAMES)
    async def test_valid_names(self, name: str) -> None:
        await ShellScriptPlugin().validate(params_for(script_variables=[name]))

    @pytest.mark.parametrize("name", ["1x", "a-b", "a b", "", "a.b", "X\n"])
    async def test_invalid_names(self, name: str) -> None:
        message = f"Invalid script variable name: '{name}'"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(script_variables=[name]))

    @pytest.mark.parametrize(("item", "shown"), [(3, "3"), (None, "None"), (True, "True")])
    async def test_a_non_string_item_is_named_by_its_text(self, item: Any, shown: str) -> None:
        message = f"Invalid script variable name: '{shown}'"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(script_variables=[item]))

    async def test_the_wave_prefix_rule_is_not_applied_to_exports(self) -> None:
        await ShellScriptPlugin().validate(params_for(script_variables=["WAVE_X"]))


class TestScriptVariableClashes:
    """A variable export may not take the name of a fixed block output (SHRUN-6)."""

    @pytest.mark.parametrize("name", RESERVED_OUTPUTS)
    async def test_reserved_output_names(self, name: str) -> None:
        message = f"Script variable '{name}' has the name of a block output"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(script_variables=[name]))

    @pytest.mark.parametrize("name", ["STDOUT", "Stdout", "exitcode", "exit_code_2"])
    async def test_the_clash_check_is_an_exact_match(self, name: str) -> None:
        await ShellScriptPlugin().validate(params_for(script_variables=[name]))


class TestScriptVariableDuplicates:
    """A name may be listed once (SHRUN-6)."""

    @pytest.mark.parametrize("names", [["A", "A"], ["A", "B", "A"], ["B", "A", "A"]])
    async def test_a_repeated_name(self, names: list[str]) -> None:
        with pytest.raises(ValueError, match=exact("Script variable 'A' is listed more than once")):
            await ShellScriptPlugin().validate(params_for(script_variables=names))

    @pytest.mark.parametrize("names", [["A", "a"], ["COUNT", "count"]])
    async def test_names_that_differ_in_case_are_two_names(self, names: list[str]) -> None:
        await ShellScriptPlugin().validate(params_for(script_variables=names))

    async def test_only_the_exactly_repeated_name_is_reported(self) -> None:
        message = "Script variable 'COUNT' is listed more than once"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(
                params_for(script_variables=["COUNT", "count", "COUNT"])
            )


class TestScriptTypeEnum:
    """Script Type is one of the two modes (SHRUN-3)."""

    @pytest.mark.parametrize("value", ["x", "Source", "FILE", ""])
    async def test_unknown_value(self, value: str) -> None:
        message = (
            "Parameter 'script_type' must be one of: source, file; " f"Actual value was '{value}'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(script_type=value))

    async def test_a_long_value_is_shown_by_length_only(self) -> None:
        message = (
            "Parameter 'script_type' must be one of: source, file; "
            "Actual value was a 51-character value."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(script_type="s" * 51))

    @pytest.mark.parametrize("value", ["source", "file"])
    async def test_accepted_values(self, value: str) -> None:
        await ShellScriptPlugin().validate(
            {"script_type": value, "script": "echo hi", "script_file": "/run.sh"}
        )


class TestParameterShapes:
    """A present setting of the wrong shape is named before anything reads it."""

    @pytest.mark.parametrize(
        ("value", "type_name"), [([], "list"), ("x", "str"), (3, "int"), (True, "bool")]
    )
    async def test_input_vars_must_be_a_map(self, value: Any, type_name: str) -> None:
        message = f"Parameter 'input_vars' must be a map (dictionary), got {type_name}"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(input_vars=value))

    @pytest.mark.parametrize("value", ["x", {}, 3])
    async def test_arguments_must_be_a_list(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'arguments' must be a list")):
            await ShellScriptPlugin().validate(params_for(arguments=value))

    @pytest.mark.parametrize(
        ("rows", "index"),
        [
            ([{"value": "a"}, "b"], 1),
            (["a"], 0),
            ([{"value": "a"}, {"value": "b"}, 3], 2),
        ],
    )
    async def test_an_arguments_row_must_be_a_map(self, rows: list[Any], index: int) -> None:
        message = f"Parameter 'arguments' row {index} must be a map"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(arguments=rows))

    @pytest.mark.parametrize("value", ["A", {}, 3])
    async def test_script_variables_must_be_a_list(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'script_variables' must be a list")):
            await ShellScriptPlugin().validate(params_for(script_variables=value))

    async def test_well_shaped_settings_validate(self) -> None:
        await ShellScriptPlugin().validate(
            params_for(
                input_vars={"NAME": "value"},
                arguments=[{"value": ""}, {"value": "--flag"}],
                script_variables=["COUNT"],
            )
        )


class TestUnsetSettings:
    """An absent or None setting reads as its metadata default before any check."""

    async def test_only_the_script_is_needed(self) -> None:
        await ShellScriptPlugin().validate({"script": "echo hi"})

    async def test_script_type_none_reads_source(self) -> None:
        await ShellScriptPlugin().validate({"script": "echo hi", "script_type": None})

    async def test_on_error_none_reads_fail(self) -> None:
        await ShellScriptPlugin().validate({"script": "echo hi", "on_error": None})

    async def test_every_optional_setting_may_be_none(self) -> None:
        await ShellScriptPlugin().validate(
            {
                "script": "echo hi",
                "script_type": None,
                "shell": None,
                "arguments": None,
                "input_vars": None,
                "script_variables": None,
                "working_dir": None,
                "timeout": None,
                "stream_output": None,
                "stop_on_pattern": None,
                "pass_pattern": None,
                "fail_pattern": None,
                "on_error": None,
            }
        )


class TestWorkingDirectory:
    """Working Directory takes a scheme or a path, absolute or relative; blank is accepted."""

    @pytest.mark.parametrize(
        "value", ["/srv/work", "artifact://out", "work", "../beside", "a/../b"]
    )
    async def test_a_scheme_or_any_path_validates(self, value: str) -> None:
        await ShellScriptPlugin().validate({"script": "echo hi", "working_dir": value})

    @pytest.mark.parametrize("value", ["", "  "])
    async def test_a_blank_working_directory_is_accepted(self, value: str) -> None:
        await ShellScriptPlugin().validate({"script": "echo hi", "working_dir": value})


class TestValidationOrder:
    """One input gives one deterministic message."""

    async def test_the_script_type_enum_runs_before_the_script_row(self) -> None:
        message = "Parameter 'script_type' must be one of: source, file; Actual value was 'x'."

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate({"script_type": "x"})

    async def test_the_script_row_runs_before_the_shell_row(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script")):
            await ShellScriptPlugin().validate({"shell": ""})

    async def test_the_shell_row_runs_before_the_timeout(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'shell' cannot be empty")):
            await ShellScriptPlugin().validate(params_for(shell="", timeout=0))

    async def test_the_name_check_runs_before_the_clash_check(self) -> None:
        with pytest.raises(ValueError, match=exact("Invalid script variable name: '1x'")):
            await ShellScriptPlugin().validate(params_for(script_variables=["1x", "stdout"]))

    async def test_the_clash_check_runs_before_the_repeat_check(self) -> None:
        message = "Script variable 'stdout' has the name of a block output"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(script_variables=["stdout", "stdout"]))

    async def test_a_bad_shape_runs_before_the_enum(self) -> None:
        message = "Parameter 'input_vars' must be a map (dictionary), got list"

        with pytest.raises(ValueError, match=exact(message)):
            await ShellScriptPlugin().validate(params_for(input_vars=[], script_type="x"))
