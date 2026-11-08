"""Python block parameter validation (REQ-3.4.1.2, REQ-3.4.2.2).

Every rejection carries the exact pinned message and raises ValueError, whatever On error
says. A name is an ASCII letter or underscore, then ASCII letters, digits or underscores, and
may not start with a double underscore (PYRUN-5, PYRUN-6); the save refuses the same names.
An empty Interpreter row is WAVE's own interpreter, never an error (PYRUN-3). One parameter
set gives one message: the first failing rule wins.
"""

import re
from typing import Any

import pytest

from wavecore.core.execution.field_checks import check_block_fields
from wavecore.plugins.python import PythonPlugin

RESERVED_OUTPUTS = ["stdout", "stderr", "exit_code", "success", "error", "reason"]

VALID_NAMES = ["x", "_x", "COUNT", "A1", "_", "a_b_9", "x__"]

NON_IDENTIFIERS = ["1x", "a-b", "a b", "", "a.b", "x!"]

NON_ASCII_NAMES = ["café", "été", "名前", "x\u0661"]

DUNDER_NAMES = ["__x", "__", "__init__", "___y"]

DUNDER_NON_IDENTIFIERS = ["__a-b", "__café"]

BAD_PATTERNS = ["(", "[", "*"]

BLANK_INTERPRETERS = ["", "   ", "\t"]


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def params_for(**overrides: Any) -> dict[str, Any]:
    """A valid Source-mode parameter set with the overrides applied."""
    merged: dict[str, Any] = {"script": "print('hi')"}
    merged.update(overrides)
    return merged


async def refuses(message: str, **overrides: Any) -> None:
    """The parameter set is refused with exactly this message."""
    with pytest.raises(ValueError, match=exact(message)):
        await PythonPlugin().validate(params_for(**overrides))


class TestScriptSourceMode:
    """Source mode runs the script typed into the block, so that row is required."""

    @pytest.mark.parametrize("params", [{}, {"script_type": "source"}])
    async def test_missing_script(self, params: dict[str, Any]) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script")):
            await PythonPlugin().validate(params)

    @pytest.mark.parametrize("value", [None, ""])
    async def test_empty_script(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script")):
            await PythonPlugin().validate({"script_type": "source", "script": value})

    async def test_a_script_validates(self) -> None:
        await PythonPlugin().validate({"script_type": "source", "script": "print('hi')"})

    async def test_whitespace_is_part_of_the_script(self) -> None:
        await PythonPlugin().validate({"script": "  "})


class TestScriptFileMode:
    """File mode runs a script file, so that row is required and the Script row is not."""

    async def test_missing_script_file(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script_file")):
            await PythonPlugin().validate({"script_type": "file"})

    @pytest.mark.parametrize("value", [None, "", "   "])
    async def test_blank_script_file(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script_file")):
            await PythonPlugin().validate({"script_type": "file", "script_file": value})

    @pytest.mark.parametrize(
        "value", ["testdata://run.py", "artifact://run.py", "/opt/scripts/run.py", "run.py"]
    )
    async def test_a_script_file_validates_without_a_script(self, value: str) -> None:
        await PythonPlugin().validate({"script_type": "file", "script_file": value})


class TestTimeout:
    """Timeout is the bound on the run and must be positive (PYRUN-11)."""

    @pytest.mark.parametrize("value", [0, -1, -300])
    async def test_zero_or_negative(self, value: int) -> None:
        await refuses("Parameter 'timeout' must be positive", timeout=value)

    @pytest.mark.parametrize("value", [1, 300, 86400])
    async def test_a_positive_timeout_validates(self, value: int) -> None:
        await PythonPlugin().validate(params_for(timeout=value))

    async def test_an_unset_timeout_reads_the_default(self) -> None:
        await PythonPlugin().validate(params_for(timeout=None))


class TestStopOnPattern:
    """While Stop on pattern is on at least one pattern is required and both compile."""

    @pytest.mark.parametrize(
        "overrides",
        [
            {},
            {"pass_pattern": "", "fail_pattern": ""},
            {"pass_pattern": None, "fail_pattern": None},
        ],
    )
    async def test_both_patterns_empty(self, overrides: dict[str, Any]) -> None:
        await refuses(
            "Set a pass pattern, a fail pattern or both", stop_on_pattern=True, **overrides
        )

    async def test_both_patterns_empty_is_fine_while_the_switch_is_off(self) -> None:
        await PythonPlugin().validate(params_for(stop_on_pattern=False))

    @pytest.mark.parametrize(
        "overrides",
        [
            {"pass_pattern": "READY"},
            {"fail_pattern": "ERROR"},
            {"pass_pattern": "READY", "fail_pattern": "ERROR"},
        ],
    )
    async def test_one_pattern_or_both_validate(self, overrides: dict[str, Any]) -> None:
        await PythonPlugin().validate(params_for(stop_on_pattern=True, **overrides))

    @pytest.mark.parametrize("value", BAD_PATTERNS)
    async def test_an_invalid_pass_pattern(self, value: str) -> None:
        with pytest.raises(ValueError, match=r"^Invalid pass pattern: .+$"):
            await PythonPlugin().validate(params_for(stop_on_pattern=True, pass_pattern=value))

    @pytest.mark.parametrize("value", BAD_PATTERNS)
    async def test_an_invalid_fail_pattern(self, value: str) -> None:
        with pytest.raises(ValueError, match=r"^Invalid fail pattern: .+$"):
            await PythonPlugin().validate(params_for(stop_on_pattern=True, fail_pattern=value))

    async def test_a_broken_pattern_is_ignored_while_the_switch_is_off(self) -> None:
        await PythonPlugin().validate(params_for(pass_pattern="(", fail_pattern="["))


class TestInputVariableNames:
    """An Input Variable is named like a Python global (PYRUN-5)."""

    @pytest.mark.parametrize("name", VALID_NAMES)
    async def test_valid_names(self, name: str) -> None:
        await PythonPlugin().validate(params_for(input_vars={name: "value"}))

    @pytest.mark.parametrize("name", NON_IDENTIFIERS)
    async def test_a_name_that_is_not_an_identifier(self, name: str) -> None:
        await refuses(f"Invalid variable name: '{name}'", input_vars={name: "value"})

    @pytest.mark.parametrize("name", NON_ASCII_NAMES)
    async def test_a_name_with_a_letter_outside_ascii(self, name: str) -> None:
        await refuses(f"Invalid variable name: '{name}'", input_vars={name: "value"})

    @pytest.mark.parametrize("name", DUNDER_NAMES)
    async def test_a_name_that_starts_with_a_double_underscore(self, name: str) -> None:
        await refuses(f"Variable names may not start with __: '{name}'", input_vars={name: "value"})

    @pytest.mark.parametrize("name", DUNDER_NON_IDENTIFIERS)
    async def test_the_name_rule_is_checked_before_the_dunder_rule(self, name: str) -> None:
        await refuses(f"Invalid variable name: '{name}'", input_vars={name: "value"})

    async def test_the_dunder_rule_reports_the_first_bad_name(self) -> None:
        await refuses(
            "Variable names may not start with __: '__x'", input_vars={"__x": 1, "__z": 2}
        )

    async def test_the_wave_prefix_rule_is_not_applied_to_input_variables(self) -> None:
        await PythonPlugin().validate(params_for(input_vars={"WAVE_X": "value"}))

    async def test_an_unset_map_validates(self) -> None:
        await PythonPlugin().validate(params_for(input_vars=None))


class TestScriptVariableNames:
    """A variable export is named like a Python global too (PYRUN-6)."""

    @pytest.mark.parametrize("name", VALID_NAMES)
    async def test_valid_names(self, name: str) -> None:
        await PythonPlugin().validate(params_for(script_variables=[name]))

    @pytest.mark.parametrize("name", NON_IDENTIFIERS)
    async def test_a_name_that_is_not_an_identifier(self, name: str) -> None:
        await refuses(f"Invalid script variable name: '{name}'", script_variables=[name])

    @pytest.mark.parametrize("name", NON_ASCII_NAMES)
    async def test_a_name_with_a_letter_outside_ascii(self, name: str) -> None:
        await refuses(f"Invalid script variable name: '{name}'", script_variables=[name])

    @pytest.mark.parametrize("name", DUNDER_NAMES)
    async def test_a_name_that_starts_with_a_double_underscore(self, name: str) -> None:
        await refuses(f"Invalid script variable name: '{name}'", script_variables=[name])

    async def test_the_dunder_rule_reports_the_first_bad_name(self) -> None:
        await refuses("Invalid script variable name: '__y'", script_variables=["__y", "__z"])

    @pytest.mark.parametrize(("item", "shown"), [(3, "3"), (None, "None"), (True, "True")])
    async def test_a_non_string_item_is_named_by_its_text(self, item: Any, shown: str) -> None:
        await refuses(f"Invalid script variable name: '{shown}'", script_variables=[item])

    async def test_the_wave_prefix_rule_is_not_applied_to_exports(self) -> None:
        await PythonPlugin().validate(params_for(script_variables=["WAVE_X"]))


def saved(**overrides: Any) -> list[tuple[str, str, str | None, str]]:
    """The save's findings for a valid Source-mode Block with the overrides applied."""
    findings = check_block_fields(
        PythonPlugin().metadata["parameters"],
        params_for(**overrides),
        block_id="python",
        expression_fields=set(),
        template_fields=set(),
        check_required=True,
    )
    return [(f.code, f.message, f.fix, f.field) for f in findings]


class TestNamesAtSave:
    """The save refuses the names the run refuses, with the run's own message (PYRUN-5, PYRUN-6)."""

    @pytest.mark.parametrize("name", [*NON_ASCII_NAMES, *NON_IDENTIFIERS, *DUNDER_NON_IDENTIFIERS])
    def test_an_input_variable_name_the_run_refuses(self, name: str) -> None:
        assert saved(input_vars={name: 1}) == [
            ("INVALID_NAME", f"Invalid variable name: '{name}'", None, "input_vars")
        ]

    @pytest.mark.parametrize("name", DUNDER_NAMES)
    def test_an_input_variable_name_with_a_double_underscore(self, name: str) -> None:
        assert saved(input_vars={name: 1}) == [
            ("INVALID_NAME", f"Variable names may not start with __: '{name}'", None, "input_vars")
        ]

    @pytest.mark.parametrize("name", [*NON_ASCII_NAMES, *NON_IDENTIFIERS, *DUNDER_NAMES])
    def test_an_export_name_the_run_refuses(self, name: str) -> None:
        assert saved(script_variables=[name]) == [
            ("INVALID_NAME", f"Invalid script variable name: '{name}'", None, "script_variables")
        ]

    @pytest.mark.parametrize(("item", "shown"), [(3, "3"), (None, "None"), (True, "True")])
    def test_an_export_that_is_not_text_is_named_by_its_text(self, item: Any, shown: str) -> None:
        assert saved(script_variables=[item]) == [
            ("INVALID_NAME", f"Invalid script variable name: '{shown}'", None, "script_variables")
        ]

    @pytest.mark.parametrize("name", VALID_NAMES)
    def test_a_name_the_run_takes_is_saved(self, name: str) -> None:
        assert saved(input_vars={name: 1}, script_variables=[name]) == []

    def test_every_refused_name_is_reported_in_order(self) -> None:
        assert saved(input_vars={"x": 1, "café": 2, "__y": 3}) == [
            ("INVALID_NAME", "Invalid variable name: 'café'", None, "input_vars"),
            ("INVALID_NAME", "Variable names may not start with __: '__y'", None, "input_vars"),
        ]


class TestScriptVariableClashes:
    """A variable export may not take the name of a fixed block output (PYRUN-6)."""

    @pytest.mark.parametrize("name", RESERVED_OUTPUTS)
    async def test_reserved_output_names(self, name: str) -> None:
        await refuses(
            f"Script variable '{name}' has the name of a block output", script_variables=[name]
        )

    @pytest.mark.parametrize("name", ["STDOUT", "Stdout", "exitcode", "exit_code_2"])
    async def test_the_clash_check_is_an_exact_match(self, name: str) -> None:
        await PythonPlugin().validate(params_for(script_variables=[name]))


class TestScriptVariableDuplicates:
    """A name may be listed once (PYRUN-6)."""

    @pytest.mark.parametrize("names", [["a", "a"], ["a", "b", "a"], ["b", "a", "a"]])
    async def test_a_repeated_name(self, names: list[str]) -> None:
        await refuses("Script variable 'a' is listed more than once", script_variables=names)

    @pytest.mark.parametrize("names", [["A", "a"], ["COUNT", "count"]])
    async def test_names_that_differ_in_case_are_two_names(self, names: list[str]) -> None:
        await PythonPlugin().validate(params_for(script_variables=names))

    async def test_only_the_exactly_repeated_name_is_reported(self) -> None:
        await refuses(
            "Script variable 'COUNT' is listed more than once",
            script_variables=["COUNT", "count", "COUNT"],
        )


class TestWorkingDirectory:
    """Working Directory takes a scheme or a path, absolute or relative; blank is accepted."""

    @pytest.mark.parametrize(
        "value", ["/srv/work", "artifact://out", "work", "../beside", "a/../b"]
    )
    async def test_a_scheme_or_any_path_validates(self, value: str) -> None:
        await PythonPlugin().validate(params_for(working_dir=value))

    @pytest.mark.parametrize("value", ["", "  ", "\t"])
    async def test_a_blank_working_directory_is_accepted(self, value: str) -> None:
        await PythonPlugin().validate(params_for(working_dir=value))

    async def test_an_unset_working_directory_reads_the_default(self) -> None:
        await PythonPlugin().validate(params_for(working_dir=None))


class TestInterpreterRow:
    """An empty Interpreter row means WAVE's own interpreter, never an error (PYRUN-3)."""

    @pytest.mark.parametrize("value", BLANK_INTERPRETERS)
    async def test_a_blank_interpreter_validates(self, value: str) -> None:
        await PythonPlugin().validate(params_for(interpreter=value))

    async def test_an_unset_interpreter_validates(self) -> None:
        await PythonPlugin().validate(params_for(interpreter=None))

    @pytest.mark.parametrize(
        "value",
        [
            "python3",
            "/opt/venv311/bin/python",
            "uv run --project /opt/lab-env",
            "conda run -n lab python",
            "{{py}}",
        ],
    )
    async def test_a_command_line_validates(self, value: str) -> None:
        await PythonPlugin().validate(params_for(interpreter=value))

    @pytest.mark.parametrize("value", BLANK_INTERPRETERS)
    async def test_a_blank_interpreter_does_not_mask_a_later_rule(self, value: str) -> None:
        await refuses(
            "Set a pass pattern, a fail pattern or both", interpreter=value, stop_on_pattern=True
        )


class TestValidBlock:
    """A block whose settings are all in order passes validation."""

    async def test_only_the_script_is_needed(self) -> None:
        await PythonPlugin().validate({"script": "print('hi')"})

    async def test_every_setting_at_once(self) -> None:
        await PythonPlugin().validate(
            {
                "script_type": "source",
                "script": "print('hi')",
                "interpreter": "/opt/venv311/bin/python",
                "arguments": [{"value": "--env"}, {"value": "staging"}],
                "input_vars": {"threshold": "30.5", "readings": "rows"},
                "working_dir": "testdata://data",
                "environment": {"LANG": "C"},
                "stream_output": True,
                "stop_on_pattern": True,
                "pass_pattern": "READY",
                "fail_pattern": "ERROR",
                "timeout": 60,
                "on_error": "record",
                "script_variables": ["summary", "out_of_range"],
            }
        )

    async def test_every_optional_setting_may_be_none(self) -> None:
        await PythonPlugin().validate(
            {
                "script": "print('hi')",
                "script_type": None,
                "interpreter": None,
                "arguments": None,
                "input_vars": None,
                "working_dir": None,
                "environment": None,
                "stream_output": None,
                "stop_on_pattern": None,
                "pass_pattern": None,
                "fail_pattern": None,
                "timeout": None,
                "on_error": None,
                "script_variables": None,
            }
        )


class TestValidationOrder:
    """One parameter set gives one message: the first failing rule of the table wins."""

    async def test_the_script_row_runs_before_the_timeout(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script")):
            await PythonPlugin().validate({"timeout": 0})

    async def test_the_script_file_row_runs_before_the_timeout(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: script_file")):
            await PythonPlugin().validate({"script_type": "file", "timeout": 0})

    async def test_the_timeout_runs_before_the_pattern_pair(self) -> None:
        await refuses("Parameter 'timeout' must be positive", timeout=0, stop_on_pattern=True)

    async def test_the_pattern_pair_runs_before_the_input_variable_names(self) -> None:
        await refuses(
            "Set a pass pattern, a fail pattern or both",
            stop_on_pattern=True,
            input_vars={"__x": 1},
        )

    async def test_the_pass_pattern_compiles_before_the_fail_pattern(self) -> None:
        with pytest.raises(ValueError, match=r"^Invalid pass pattern: .+$"):
            await PythonPlugin().validate(
                params_for(stop_on_pattern=True, pass_pattern="(", fail_pattern="[")
            )

    async def test_the_patterns_compile_before_the_input_variable_names(self) -> None:
        with pytest.raises(ValueError, match=r"^Invalid pass pattern: .+$"):
            await PythonPlugin().validate(
                params_for(stop_on_pattern=True, pass_pattern="(", input_vars={"__x": 1})
            )

    async def test_the_input_variable_names_run_before_the_export_names(self) -> None:
        await refuses(
            "Variable names may not start with __: '__x'",
            input_vars={"__x": 1},
            script_variables=["__y"],
        )

    async def test_the_export_name_check_runs_before_the_clash_check(self) -> None:
        await refuses("Invalid script variable name: '__y'", script_variables=["__y", "stdout"])

    async def test_the_clash_check_runs_before_the_repeat_check(self) -> None:
        await refuses(
            "Script variable 'stdout' has the name of a block output",
            script_variables=["stdout", "stdout"],
        )

    async def test_a_blank_working_directory_does_not_mask_the_repeat_check(self) -> None:
        await refuses(
            "Script variable 'a' is listed more than once",
            script_variables=["a", "a"],
            working_dir="",
        )
