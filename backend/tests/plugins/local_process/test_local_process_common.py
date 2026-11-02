"""Shared local-process descriptors, checks, environment and paths.

REQ-3.4.1.1 and REQ-3.4.1.18: Shell Script and Shell Exec declare the same execution,
Stop on pattern and Failure Handling rows and run the same validation checks (REQ-3.4.2.2).
The child inherits the WAVE server's environment as it stands (SHRUN-2), proxy variables
included whatever Settings > Network > Proxy says (REQ-4.7.14), with the test's
Test Data folder and the run's artifacts folder added (REQ-3.4.3.1, REQ-3.4.3.2), a
working directory names one place (SHRUN-10), and a block's first console line names what it
runs and where (SHRUN-12). REQ-3.1.3.22: a null never reaches a script as text; the one text
step names the entry or the row instead, before the script starts.
"""

import importlib
import json
import os
import re
import tempfile
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from wavecore.core.expressions import errors as expression_errors
from wavecore.core.table import Table
from wavecore.plugins import _local_process_common as common
from wavecore.plugins._local_process_common import (
    REMOTE_LOCUS,
    build_environment,
    check_on_error,
    coerce_typed,
    environment_parameter,
    execution_parameters,
    failure_parameter,
    local_output_core,
    resolve_working_dir,
    start_line,
    stop_on_pattern_parameters,
    stream_outputs,
    to_env_text,
)
from wavecore.plugins._local_process_runtime import (
    check_environment_names,
    compile_patterns,
    working_dir_setting,
)

SCRIPT = "Script"
COMMAND = "Command"
SCRIPT_REASONS = "NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable"
COMMAND_REASONS = "NonZeroExit, Timeout, FailPattern or StartFailed"
RECORD_GATE = {"field": "on_error", "values": ["record"]}
OUTPUT_KEYS = {"name", "type", "secret", "description", "show_when"}
ON_ERROR_DESCRIPTION = "Fail the block, or record the outcome and let the test continue."
GENERIC_ERROR_DESCRIPTION = (
    "The error message when the operation failed under Record and continue; empty otherwise"
)
SCRIPT_SUCCESS_DESCRIPTION = (
    "True when the script passed. False when it failed and On error is Record and continue."
)
COMMAND_SUCCESS_DESCRIPTION = (
    "True when the command passed. False when it failed and On error is Record and continue."
)
BAD_PASS_PATTERN = "Invalid pass pattern: missing ), unterminated subpattern at position 0"
BAD_FAIL_PATTERN = "Invalid fail pattern: unterminated character set at position 0"
SCRIPT_WORKING_DIR_DESCRIPTION = (
    "Where the script starts: testdata://, artifact:// or an absolute or relative path on the "
    "WAVE server. The folder must exist. Empty starts in the system temp folder of the machine "
    "the script runs on."
)
# The environment setting each block declares: Shell Script, Shell Exec, Python.
ENVIRONMENT_SETTINGS = ["input_vars", "env_vars", "environment"]
DECLARED_TYPES = ["string", "integer", "float", "boolean", "array", "map", "table"]


class Opaque:
    """A value the conversion table has no rule of its own for."""

    def __str__(self) -> str:
        return "opaque"


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def by_name(descriptors: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {descriptor["name"]: descriptor for descriptor in descriptors}


def context(
    artifacts_dir: str | None = None, testdata_dirs: list[str] | None = None
) -> dict[str, Any]:
    """The plugin context keys the environment builder and the path resolver read."""
    return {"artifacts_dir": artifacts_dir, "testdata_dirs": testdata_dirs}


class TestOnErrorCheck:
    """Failure Handling is an enum, and only a value that is present is checked (SHRUN-9)."""

    def test_an_unknown_value_names_both_options(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'x'."

        with pytest.raises(ValueError, match=exact(message)):
            check_on_error({"on_error": "x"})

    @pytest.mark.parametrize("value", ["fail", "record"])
    def test_the_two_declared_values_pass(self, value: str) -> None:
        check_on_error({"on_error": value})

    def test_an_absent_setting_reads_as_fail(self) -> None:
        check_on_error({})

    def test_a_none_setting_reads_as_fail(self) -> None:
        check_on_error({"on_error": None})

    def test_a_long_value_is_shown_by_length_and_never_echoed(self) -> None:
        message = (
            "Parameter 'on_error' must be one of: fail, record; "
            "Actual value was a 51-character value."
        )

        with pytest.raises(ValueError, match=exact(message)):
            check_on_error({"on_error": "z" * 51})


class TestPatternChecks:
    """Stop on pattern gates the pair, and each row is a Python regular expression (SHRUN-13)."""

    def test_the_rows_are_ignored_while_stop_on_pattern_is_off(self) -> None:
        assert compile_patterns({"stop_on_pattern": False, "pass_pattern": "("}) == (None, None)

    def test_the_rows_are_ignored_when_stop_on_pattern_is_absent(self) -> None:
        assert compile_patterns({"fail_pattern": "["}) == (None, None)

    @pytest.mark.parametrize(
        "params",
        [
            {"stop_on_pattern": True},
            {"stop_on_pattern": True, "pass_pattern": "", "fail_pattern": ""},
        ],
        ids=["absent", "empty"],
    )
    def test_at_least_one_pattern_is_required(self, params: dict[str, Any]) -> None:
        with pytest.raises(ValueError, match=exact("Set a pass pattern, a fail pattern or both")):
            compile_patterns(params)

    def test_an_unusable_pass_row_names_the_row_and_the_regex_error(self) -> None:
        with pytest.raises(ValueError, match=exact(BAD_PASS_PATTERN)):
            compile_patterns({"stop_on_pattern": True, "pass_pattern": "("})

    def test_an_unusable_fail_row_names_the_row_and_the_regex_error(self) -> None:
        with pytest.raises(ValueError, match=exact(BAD_FAIL_PATTERN)):
            compile_patterns({"stop_on_pattern": True, "fail_pattern": "["})

    def test_the_pass_row_is_compiled_before_the_fail_row(self) -> None:
        with pytest.raises(ValueError, match=exact(BAD_PASS_PATTERN)):
            compile_patterns({"stop_on_pattern": True, "pass_pattern": "(", "fail_pattern": "["})

    def test_both_rows_compile_to_searching_patterns(self) -> None:
        pass_re, fail_re = compile_patterns(
            {"stop_on_pattern": True, "pass_pattern": "^ready", "fail_pattern": "ERROR"}
        )

        assert pass_re is not None and pass_re.search("ready to serve")
        assert fail_re is not None and fail_re.search("saw ERROR here")

    def test_a_pass_row_on_its_own_leaves_the_fail_row_unset(self) -> None:
        pass_re, fail_re = compile_patterns({"stop_on_pattern": True, "pass_pattern": "ready"})

        assert pass_re is not None
        assert fail_re is None

    def test_a_fail_row_on_its_own_leaves_the_pass_row_unset(self) -> None:
        pass_re, fail_re = compile_patterns({"stop_on_pattern": True, "fail_pattern": "ERROR"})

        assert pass_re is None
        assert fail_re is not None


class TestVariableNameChecks:
    """Input variable names are shell identifiers and never WAVE_-prefixed (SHRUN-5)."""

    def test_a_name_that_is_not_a_shell_identifier_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact("Invalid variable name: '1X'")):
            check_environment_names({"input_vars": {"1X": "v"}}, "input_vars")

    def test_a_trailing_newline_fails_the_full_match(self) -> None:
        with pytest.raises(ValueError, match=exact("Invalid variable name: 'X\n'")):
            check_environment_names({"input_vars": {"X\n": "v"}}, "input_vars")

    def test_the_wave_prefix_is_reserved(self) -> None:
        message = "Variable names may not start with WAVE_: 'WAVE_X'"

        with pytest.raises(ValueError, match=exact(message)):
            check_environment_names({"input_vars": {"WAVE_X": "v"}}, "input_vars")

    def test_the_bare_prefix_is_reserved_too(self) -> None:
        message = "Variable names may not start with WAVE_: 'WAVE_'"

        with pytest.raises(ValueError, match=exact(message)):
            check_environment_names({"input_vars": {"WAVE_": "v"}}, "input_vars")

    def test_the_identifier_rule_is_applied_before_the_prefix_rule(self) -> None:
        with pytest.raises(ValueError, match=exact("Invalid variable name: 'WAVE-X'")):
            check_environment_names({"input_vars": {"WAVE-X": "v"}}, "input_vars")

    def test_the_first_bad_name_in_entry_order_is_the_one_reported(self) -> None:
        entries = {"GOOD": "a", "1BAD": "b", "2BAD": "c"}

        with pytest.raises(ValueError, match=exact("Invalid variable name: '1BAD'")):
            check_environment_names({"input_vars": entries}, "input_vars")

    @pytest.mark.parametrize("name", ["X", "_x", "A1", "LONG_NAME_2", "_"])
    def test_a_shell_identifier_passes(self, name: str) -> None:
        check_environment_names({"input_vars": {name: "v"}}, "input_vars")

    @pytest.mark.parametrize(
        "params", [{}, {"input_vars": None}, {"input_vars": {}}], ids=["absent", "none", "empty"]
    )
    def test_a_map_with_nothing_in_it_passes(self, params: dict[str, Any]) -> None:
        check_environment_names(params, "input_vars")

    def test_the_same_rules_apply_to_the_shell_exec_map(self) -> None:
        with pytest.raises(ValueError, match=exact("Invalid variable name: '1X'")):
            check_environment_names({"env_vars": {"1X": "v"}}, "env_vars")


@pytest.fixture
def system_temp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The folder tempfile.gettempdir() reports for this test."""
    folder = tmp_path / "system-temp"
    folder.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(folder))
    return folder


class TestWorkingDirectorySetting:
    """A blank or absent working directory starts in the system temp folder (REQ-3.4.3.11)."""

    def test_an_absent_setting_starts_in_the_temp_folder(self, system_temp: Path) -> None:
        assert working_dir_setting({}) == str(system_temp)

    def test_a_none_setting_starts_in_the_temp_folder(self, system_temp: Path) -> None:
        assert working_dir_setting({"working_dir": None}) == str(system_temp)

    @pytest.mark.parametrize("value", ["", "   ", "\t"], ids=["empty", "spaces", "tab"])
    def test_a_blank_setting_starts_in_the_temp_folder(self, value: str, system_temp: Path) -> None:
        assert working_dir_setting({"working_dir": value}) == str(system_temp)

    def test_the_temp_folder_is_read_on_each_call(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(tempfile, "tempdir", str(tmp_path / "first"))
        first = working_dir_setting({})
        monkeypatch.setattr(tempfile, "tempdir", str(tmp_path / "second"))

        assert (first, working_dir_setting({})) == (
            str(tmp_path / "first"),
            str(tmp_path / "second"),
        )

    @pytest.mark.parametrize("value", ["rel/dir", "./here", "out", "../beside", "made/../out"])
    def test_a_relative_path_is_kept_as_written(self, value: str) -> None:
        assert working_dir_setting({"working_dir": value}) == value

    @pytest.mark.parametrize(
        "value",
        [
            "/srv/work",
            "/var/lib/run",
            "artifact://out",
            "testdata://seed",
            "artifact://",
            "testdata://",
        ],
    )
    def test_an_absolute_path_or_a_scheme_is_kept_as_written(self, value: str) -> None:
        assert working_dir_setting({"working_dir": value}) == value

    def test_a_padded_path_is_a_value_not_a_blank(self) -> None:
        assert working_dir_setting({"working_dir": "  /srv/work  "}) == "  /srv/work  "


class TestEnvironmentBuilder:
    """The child sees the server's environment as it stands, plus WAVE's two folders."""

    def test_a_wave_prefixed_server_variable_reaches_the_child_unchanged(
        self, monkeypatch: pytest.MonkeyPatch, config_file: Path
    ) -> None:
        monkeypatch.setenv("WAVE_SECRET_KEY", "server-key")

        env = build_environment({}, {}, "input_vars")

        assert env["WAVE_SECRET_KEY"] == "server-key"
        assert env["WAVE_CONFIG_FILE"] == str(config_file)

    def test_nothing_the_server_holds_is_removed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("WAVE_SECRET_KEY", "server-key")

        env = build_environment({}, {}, "input_vars")

        assert set(os.environ) <= set(env)

    def test_the_two_folder_variables_carry_the_runs_own_directories(self) -> None:
        env = build_environment(
            context(artifacts_dir="/runs/42/artifacts", testdata_dirs=["/data", "/shared"]),
            {},
            "input_vars",
        )

        assert env["WAVE_TESTDATA_DIR"] == "/data"
        assert env["WAVE_ARTIFACTS_DIR"] == "/runs/42/artifacts"

    @pytest.mark.parametrize(
        "run_context",
        [
            {},
            {"artifacts_dir": None, "testdata_dirs": None},
            {"artifacts_dir": "", "testdata_dirs": []},
        ],
        ids=["absent", "none", "empty"],
    )
    def test_a_run_with_no_such_folder_still_sets_both_variables(
        self, run_context: dict[str, Any]
    ) -> None:
        env = build_environment(run_context, {}, "input_vars")

        assert env["WAVE_TESTDATA_DIR"] == ""
        assert env["WAVE_ARTIFACTS_DIR"] == ""

    def test_input_variables_are_applied_last_and_win(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GREETING", "from-the-server")

        env = build_environment({}, {"GREETING": "from-the-block"}, "input_vars")

        assert env["GREETING"] == "from-the-block"

    def test_input_variables_are_written_through_the_conversion_table(self) -> None:
        env = build_environment({}, {"FLAG": True, "N": 7}, "input_vars")

        assert env["FLAG"] == "true"
        assert env["N"] == "7"

    def test_a_null_input_variable_fails_and_names_the_entry(self) -> None:
        message = "'NOTHING' in 'input_vars' is null"

        with pytest.raises(expression_errors.NullValueError, match=exact(message)):
            build_environment({}, {"FLAG": True, "N": 7, "NOTHING": None}, "input_vars")

    @pytest.mark.parametrize("setting_name", ENVIRONMENT_SETTINGS)
    def test_the_null_entry_is_named_in_the_setting_the_block_declares(
        self, setting_name: str
    ) -> None:
        message = f"'TOKEN' in '{setting_name}' is null"

        with pytest.raises(expression_errors.NullValueError, match=exact(message)):
            build_environment({}, {"TOKEN": None}, setting_name)

    def test_the_first_null_entry_in_entry_order_is_the_one_named(self) -> None:
        entries = {"FIRST": "a", "SECOND": None, "THIRD": None}

        with pytest.raises(
            expression_errors.NullValueError, match=exact("'SECOND' in 'env_vars' is null")
        ):
            build_environment({}, entries, "env_vars")

    def test_an_entry_left_empty_stays_empty_text(self) -> None:
        env = build_environment({}, {"EMPTY": ""}, "env_vars")

        assert env["EMPTY"] == ""

    def test_a_null_inside_a_list_or_a_map_travels_as_json_null(self) -> None:
        env = build_environment({}, {"ITEMS": [1, None, 2], "PAIRS": {"a": None}}, "environment")

        assert env["ITEMS"] == "[1,null,2]"
        assert env["PAIRS"] == '{"a":null}'

    def test_every_value_handed_to_the_child_is_text(self) -> None:
        env = build_environment(
            context(artifacts_dir="/runs/42/artifacts"), {"N": 7, "ITEMS": ["a"]}, "input_vars"
        )

        assert all(isinstance(value, str) for value in env.values())


class TestValueToText:
    """One table carries every WAVE value across the environment boundary (SHRUN-5)."""

    def test_null_is_refused(self) -> None:
        with pytest.raises(expression_errors.NullValueError):
            to_env_text(None)

    @pytest.mark.parametrize(("value", "text"), [(True, "true"), (False, "false")])
    def test_a_boolean_is_lower_case_and_beats_the_integer_rule(
        self, value: bool, text: str
    ) -> None:
        assert to_env_text(value) == text

    @pytest.mark.parametrize(("value", "text"), [(7, "7"), (0, "0"), (-7, "-7")])
    def test_an_integer_is_its_digits(self, value: int, text: str) -> None:
        assert to_env_text(value) == text

    @pytest.mark.parametrize(
        ("value", "text"), [(Decimal("1.50"), "1.50"), (Decimal("1E+2"), "100")]
    )
    def test_a_decimal_keeps_its_exact_text_and_never_uses_e_notation(
        self, value: Decimal, text: str
    ) -> None:
        assert to_env_text(value) == text

    def test_a_float_is_its_own_text(self) -> None:
        assert to_env_text(0.5) == "0.5"

    @pytest.mark.parametrize("value", ["text", "", "  spaced  "])
    def test_a_string_is_passed_through_verbatim(self, value: str) -> None:
        assert to_env_text(value) == value

    def test_a_list_is_compact_json(self) -> None:
        assert to_env_text(["a", "b"]) == '["a","b"]'

    def test_a_map_is_compact_json(self) -> None:
        assert to_env_text({"a": 1, "b": "x"}) == '{"a":1,"b":"x"}'

    def test_a_float_inside_a_list_is_a_json_number(self) -> None:
        assert to_env_text([0.5]) == "[0.5]"

    def test_a_decimal_inside_a_list_keeps_its_exact_text(self) -> None:
        assert to_env_text([Decimal("1.50")]) == "[1.50]"

    def test_a_decimal_inside_a_map_keeps_its_exact_text(self) -> None:
        assert to_env_text({"d": Decimal("0.10")}) == '{"d":0.10}'

    def test_a_decimal_nested_deeper_keeps_its_exact_text(self) -> None:
        assert to_env_text([{"k": Decimal("2.0")}]) == '[{"k":2.0}]'

    def test_a_table_is_the_json_of_its_columns_and_rows(self) -> None:
        table = Table(columns=[("host", "string"), ("port", "integer")])
        table.add_row(["web-1", 1])

        assert to_env_text(table) == (
            '{"columns":[{"name":"host","type":"string"},'
            '{"name":"port","type":"integer"}],"rows":[["web-1",1]]}'
        )

    def test_an_empty_table_still_carries_both_keys(self) -> None:
        assert to_env_text(Table()) == '{"columns":[],"rows":[]}'

    def test_a_table_round_trips_through_json(self) -> None:
        table = Table(columns=[("host", "string")])
        table.add_row(["web-1"])

        assert json.loads(to_env_text(table)) == table.to_dict()

    def test_any_other_value_is_its_own_text(self) -> None:
        assert to_env_text(Opaque()) == "opaque"

    def test_a_null_item_inside_a_list_is_json_null(self) -> None:
        assert to_env_text([1, None, 2]) == "[1,null,2]"

    def test_a_null_map_value_is_json_null(self) -> None:
        assert to_env_text({"a": None}) == '{"a":null}'

    def test_a_null_table_cell_is_json_null(self) -> None:
        table = Table(columns=[("host", "string")])
        table.add_row([None])

        assert to_env_text(table) == (
            '{"columns":[{"name":"host","type":"string"}],"rows":[[null]]}'
        )


class TestArgumentRows:
    """Each Arguments row as the text the script reads, in row order (SHRUN-4, PYRUN-4)."""

    def test_rows_are_written_through_the_conversion_table_in_row_order(self) -> None:
        rows = [{"value": "a"}, {"value": 7}, {"value": True}, {"value": Decimal("1.50")}]

        assert common.argument_texts(rows, "arguments") == ["a", "7", "true", "1.50"]

    def test_an_empty_row_stays_an_empty_argument(self) -> None:
        rows = [{"value": ""}, {}, {"value": "x"}]

        assert common.argument_texts(rows, "arguments") == ["", "", "x"]

    def test_no_rows_give_no_arguments(self) -> None:
        assert common.argument_texts([], "arguments") == []

    def test_a_null_row_fails_and_names_the_row_counting_from_one(self) -> None:
        rows = [{"value": "a"}, {"value": None}, {"value": "c"}]

        with pytest.raises(
            expression_errors.NullValueError, match=exact("Row 2 in 'arguments' is null")
        ):
            common.argument_texts(rows, "arguments")

    def test_the_first_null_row_is_the_one_named(self) -> None:
        rows = [{"value": None}, {"value": None}]

        with pytest.raises(
            expression_errors.NullValueError, match=exact("Row 1 in 'arguments' is null")
        ):
            common.argument_texts(rows, "arguments")

    def test_a_list_row_travels_as_one_json_text_with_null_inside(self) -> None:
        rows = [{"value": [1, None, 2]}, {"value": {"a": None}}]

        assert common.argument_texts(rows, "arguments") == ["[1,null,2]", '{"a":null}']


class TestTypedJsonEncoder:
    """The typed JSON text lives with WAVE's print form, and the script text step uses it."""

    def test_the_print_form_encoder_writes_the_same_text(self) -> None:
        from wavecore.core.variables.print_form import encode_typed_json

        value = [Decimal("1.50"), {"k": True, "n": None}, "é", [Decimal("1E+2")]]

        assert encode_typed_json(value) == '[1.50,{"k":true,"n":null},"é",[100]]'

    def test_the_print_form_encoder_writes_a_table_as_its_columns_and_rows(self) -> None:
        from wavecore.core.variables.print_form import encode_typed_json

        table = Table(columns=[("host", "string"), ("port", "integer")])
        table.add_row(["web-1", None])

        assert encode_typed_json(table) == (
            '{"columns":[{"name":"host","type":"string"},'
            '{"name":"port","type":"integer"}],"rows":[["web-1",null]]}'
        )

    def test_the_script_text_step_uses_that_same_encoder(self) -> None:
        print_form = importlib.import_module("wavecore.core.variables.print_form")

        assert common.encode_typed_json is print_form.encode_typed_json


class TestExportCoercionOfNull:
    """A null export fits every declared type and binds null (PYRUN-6, REQ-3.1.3.23)."""

    @pytest.mark.parametrize("declared", DECLARED_TYPES)
    def test_null_fits_every_declared_type(self, declared: str) -> None:
        assert coerce_typed("v", None, declared) is None

    @pytest.mark.parametrize("declared", DECLARED_TYPES)
    def test_a_value_no_type_can_carry_keeps_its_message(self, declared: str) -> None:
        message = f"Script variable 'v' is not a valid {declared}"

        with pytest.raises(ValueError, match=exact(message)):
            coerce_typed("v", Opaque(), declared)


class TestWorkingDirectoryResolution:
    """The directory is resolved before anything starts (REQ-3.4.3.1, REQ-3.4.3.2, SHRUN-10)."""

    def test_an_absolute_directory_is_returned_as_it_is(self, tmp_path: Path) -> None:
        assert resolve_working_dir(str(tmp_path), {}) == str(tmp_path)

    def test_a_relative_directory_starts_at_the_server_users_home(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, server_home: Path
    ) -> None:
        (server_home / "work").mkdir()
        (tmp_path / "work").mkdir()
        monkeypatch.chdir(tmp_path)

        assert resolve_working_dir("work", {}) == str(server_home / "work")

    def test_a_parent_segment_through_a_missing_folder_is_normalized_first(
        self, server_home: Path
    ) -> None:
        (server_home / "work").mkdir()

        assert resolve_working_dir("made/../work", {}) == str(server_home / "work")

    def test_a_missing_relative_directory_is_named_as_the_author_wrote_it(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        (tmp_path / "nope").mkdir()
        monkeypatch.chdir(tmp_path)

        with pytest.raises(ValueError, match=exact("Working directory not found: nope")):
            resolve_working_dir("nope", {})

    def test_a_missing_absolute_directory_is_named(self, tmp_path: Path) -> None:
        missing = str(tmp_path / "nope")

        with pytest.raises(ValueError, match=exact(f"Working directory not found: {missing}")):
            resolve_working_dir(missing, {})

    def test_a_regular_file_is_not_a_working_directory(self, tmp_path: Path) -> None:
        target = tmp_path / "file.txt"
        target.write_text("x")

        with pytest.raises(ValueError, match=exact(f"Working directory not found: {target}")):
            resolve_working_dir(str(target), {})

    def test_a_testdata_folder_resolves_under_the_configured_root(self, tmp_path: Path) -> None:
        (tmp_path / "seed").mkdir()

        resolved = resolve_working_dir("testdata://seed", context(testdata_dirs=[str(tmp_path)]))

        assert Path(resolved) == (tmp_path / "seed").resolve()

    def test_a_missing_testdata_folder_is_named_as_the_author_wrote_it(
        self, tmp_path: Path
    ) -> None:
        message = "Working directory not found: testdata://missing"

        with pytest.raises(ValueError, match=exact(message)):
            resolve_working_dir("testdata://missing", context(testdata_dirs=[str(tmp_path)]))

    def test_the_artifacts_root_itself_is_allowed(self, tmp_path: Path) -> None:
        resolved = resolve_working_dir("artifact://", context(artifacts_dir=str(tmp_path)))

        assert Path(resolved) == tmp_path.resolve()

    def test_an_artifact_folder_resolves_under_the_run_directory(self, tmp_path: Path) -> None:
        (tmp_path / "out").mkdir()

        resolved = resolve_working_dir("artifact://out", context(artifacts_dir=str(tmp_path)))

        assert Path(resolved) == (tmp_path / "out").resolve()

    def test_a_parent_segment_reaches_a_folder_beside_the_test_data(self, tmp_path: Path) -> None:
        root = tmp_path / "testdata"
        root.mkdir()
        (tmp_path / "x").mkdir()

        resolved = resolve_working_dir("testdata://../x", context(testdata_dirs=[str(root)]))

        assert Path(resolved) == (tmp_path / "x").resolve()

    def test_an_artifact_path_with_no_run_directory_is_refused_by_the_resolver(self) -> None:
        message = "artifact:// scheme requires artifacts directory, but none configured in context"

        with pytest.raises(ValueError, match=exact(message)):
            resolve_working_dir("artifact://out", {})

    def test_a_testdata_path_with_no_test_data_root_is_refused_by_the_resolver(self) -> None:
        message = (
            "testdata:// scheme requires test data directories, but none configured in context"
        )

        with pytest.raises(ValueError, match=exact(message)):
            resolve_working_dir("testdata://seed", {})


class TestSharedDescriptors:
    """The rows both blocks declare, with the family's own noun filled in (SHRUN-18)."""

    def test_the_execution_rows_are_working_directory_timeout_and_log_output(self) -> None:
        names = [param["name"] for param in execution_parameters(SCRIPT)]

        assert names == ["working_dir", "timeout", "stream_output"]

    def test_the_working_directory_row_is_an_optional_trimmed_string(self) -> None:
        param = by_name(execution_parameters(SCRIPT))["working_dir"]

        assert param["type"] == "string"
        assert param["trim"] is True
        assert param["required"] is False

    def test_the_working_directory_row_publishes_no_default(self) -> None:
        assert "default" not in by_name(execution_parameters(SCRIPT))["working_dir"]

    def test_the_working_directory_help_names_the_temp_folder(self) -> None:
        param = by_name(execution_parameters(SCRIPT))["working_dir"]

        assert param["description"] == SCRIPT_WORKING_DIR_DESCRIPTION

    def test_the_timeout_row_defaults_to_five_minutes_and_floors_at_one_second(self) -> None:
        param = by_name(execution_parameters(SCRIPT))["timeout"]

        assert param["type"] == "integer"
        assert param["required"] is False
        assert param["default"] == 300
        assert param["minimum"] == 1

    def test_the_log_output_row_is_a_boolean_that_starts_off(self) -> None:
        param = by_name(execution_parameters(SCRIPT))["stream_output"]

        assert param["type"] == "boolean"
        assert param["required"] is False
        assert param["default"] is False

    def test_the_stop_on_pattern_rows_are_the_switch_and_its_pair(self) -> None:
        names = [param["name"] for param in stop_on_pattern_parameters(SCRIPT)]

        assert names == ["stop_on_pattern", "pass_pattern", "fail_pattern"]

    def test_the_stop_switch_starts_off(self) -> None:
        param = by_name(stop_on_pattern_parameters(SCRIPT))["stop_on_pattern"]

        assert param["type"] == "boolean"
        assert param["required"] is False
        assert param["default"] is False

    @pytest.mark.parametrize("name", ["pass_pattern", "fail_pattern"])
    def test_a_pattern_row_is_empty_and_shown_only_while_the_switch_is_on(self, name: str) -> None:
        param = by_name(stop_on_pattern_parameters(SCRIPT))[name]

        assert param["type"] == "string"
        assert param["default"] == ""
        assert param["show_when"] == {"field": "stop_on_pattern", "values": ["true"]}

    def test_the_fail_pattern_row_carries_no_conditional_requirement(self) -> None:
        param = by_name(stop_on_pattern_parameters(SCRIPT))["fail_pattern"]

        assert "required_when" not in param
        assert "required_when_all" not in param

    def test_the_environment_row_is_a_map_that_starts_empty(self) -> None:
        param = environment_parameter("input_vars", SCRIPT)

        assert param["name"] == "input_vars"
        assert param["type"] == "map"
        assert param["required"] is False
        assert param["default"] == {}

    def test_the_environment_row_takes_the_wire_name_the_block_uses(self) -> None:
        assert environment_parameter("env_vars", COMMAND)["name"] == "env_vars"

    def test_the_failure_row_is_the_two_value_enum(self) -> None:
        param = failure_parameter()

        assert param["name"] == "on_error"
        assert param["type"] == "string"
        assert param["required"] is False
        assert param["default"] == "fail"
        assert param["enum_values"] == ["fail", "record"]
        assert param["description"] == ON_ERROR_DESCRIPTION

    def test_the_stream_outputs_are_stdout_stderr_and_exit_code(self) -> None:
        outputs = stream_outputs(SCRIPT)

        assert [(output["name"], output["type"]) for output in outputs] == [
            ("stdout", "string"),
            ("stderr", "string"),
            ("exit_code", "integer"),
        ]

    def test_the_output_core_is_success_error_reason_in_order(self) -> None:
        outputs = local_output_core(SCRIPT, SCRIPT_REASONS)

        assert [(output["name"], output["type"]) for output in outputs] == [
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_the_error_and_reason_rows_appear_only_under_record_and_continue(self) -> None:
        outputs = by_name(local_output_core(SCRIPT, SCRIPT_REASONS))

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE
        assert "show_when" not in outputs["success"]

    def test_the_success_row_names_the_family_noun_in_lower_case(self) -> None:
        script = by_name(local_output_core(SCRIPT, SCRIPT_REASONS))["success"]
        command = by_name(local_output_core(COMMAND, COMMAND_REASONS))["success"]

        assert script["description"] == SCRIPT_SUCCESS_DESCRIPTION
        assert command["description"] == COMMAND_SUCCESS_DESCRIPTION

    def test_the_error_row_carries_the_wording_the_builder_owns(self) -> None:
        outputs = by_name(local_output_core(SCRIPT, SCRIPT_REASONS))

        assert outputs["error"]["description"] == GENERIC_ERROR_DESCRIPTION

    def test_the_reason_row_lists_the_ways_the_family_can_fail(self) -> None:
        script = by_name(local_output_core(SCRIPT, SCRIPT_REASONS))["reason"]
        command = by_name(local_output_core(COMMAND, COMMAND_REASONS))["reason"]

        assert script["description"] == f"Why it failed: {SCRIPT_REASONS}; empty when it passed."
        assert command["description"] == f"Why it failed: {COMMAND_REASONS}; empty when it passed."

    def test_no_output_leaks_a_key_outside_the_descriptor_contract(self) -> None:
        outputs = [*stream_outputs(SCRIPT), *local_output_core(SCRIPT, SCRIPT_REASONS)]

        assert all(set(output) <= OUTPUT_KEYS for output in outputs)

    def test_every_shared_descriptor_carries_a_description(self) -> None:
        descriptors = [
            environment_parameter("input_vars", SCRIPT),
            failure_parameter(),
            *execution_parameters(SCRIPT),
            *stop_on_pattern_parameters(SCRIPT),
            *stream_outputs(SCRIPT),
            *local_output_core(SCRIPT, SCRIPT_REASONS),
        ]

        assert all(descriptor["description"] for descriptor in descriptors)

    def test_the_execution_factory_hands_out_fresh_descriptors(self) -> None:
        first = execution_parameters(SCRIPT)
        first[0]["default"] = "/srv/changed"

        assert "default" not in execution_parameters(SCRIPT)[0]

    def test_the_output_core_factory_hands_out_fresh_descriptors(self) -> None:
        first = local_output_core(SCRIPT, SCRIPT_REASONS)
        first[0]["name"] = "changed"

        assert local_output_core(SCRIPT, SCRIPT_REASONS)[0]["name"] == "success"


class TestStartLine:
    """The INFO line a block writes as it starts: what runs, under which program, and where."""

    def test_a_typed_script_is_named_the_script(self) -> None:
        line = start_line({"script": "echo hi", "shell": "/bin/sh"}, SCRIPT, "shell", "/bin/bash")

        assert line == "Running the script under /bin/sh on the WAVE server"

    def test_an_absent_shell_reads_its_default(self) -> None:
        line = start_line({"script": "echo hi"}, SCRIPT, "shell", "/bin/bash")

        assert line == "Running the script under /bin/bash on the WAVE server"

    def test_the_shell_row_is_shown_with_its_flags(self) -> None:
        params = {"script": "echo hi", "shell": "/bin/bash -o pipefail"}

        line = start_line(params, SCRIPT, "shell", "/bin/bash")

        assert line == "Running the script under /bin/bash -o pipefail on the WAVE server"

    def test_a_script_file_is_named_by_its_path_as_written(self) -> None:
        params = {"script_type": "file", "script_file": "testdata://setup/run.sh"}

        line = start_line(params, SCRIPT, "shell", "/bin/bash")

        assert line == "Running testdata://setup/run.sh under /bin/bash on the WAVE server"

    def test_a_source_run_ignores_a_leftover_script_file_row(self) -> None:
        params = {"script_type": "source", "script": "echo hi", "script_file": "/opt/run.sh"}

        line = start_line(params, SCRIPT, "shell", "/bin/bash")

        assert line == "Running the script under /bin/bash on the WAVE server"

    def test_a_command_is_named_the_command_and_never_echoed(self) -> None:
        line = start_line({"command": "kubectl get pods"}, COMMAND, "shell", "/bin/sh")

        assert line == "Running the command under /bin/sh on the WAVE server"

    @pytest.mark.parametrize("params", [{}, {"interpreter": ""}, {"interpreter": "  "}])
    def test_an_empty_interpreter_row_is_waves_own_interpreter(
        self, params: dict[str, Any]
    ) -> None:
        line = start_line({"script": "print(1)", **params}, SCRIPT, "interpreter", "")

        assert line == "Running the script under WAVE's own interpreter on the WAVE server"

    def test_a_remote_run_names_the_remote_host(self) -> None:
        params = {"script": "print(1)", "interpreter": "python3"}

        line = start_line(params, SCRIPT, "interpreter", "", REMOTE_LOCUS)

        assert line == "Running the script under python3 on the remote host"


HOST_PROXY_VARIABLES = {
    "HTTPS_PROXY": "http://ops:host-secret@host-proxy.example:8080",
    "HTTP_PROXY": "http://host-proxy.example:8081",
    "NO_PROXY": "localhost,.internal.example,10.0.0.0/8",
    "https_proxy": "http://lower-proxy.example:3129",
    "http_proxy": "lower-proxy.example:3128",
    "no_proxy": "*",
}


@pytest.fixture
def host_proxy_variables(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """The WAVE host sets all six proxy variables, each to a value of its own."""
    for name, value in HOST_PROXY_VARIABLES.items():
        monkeypatch.setenv(name, value)
    return HOST_PROXY_VARIABLES


@pytest.fixture
def no_host_proxy_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    """The WAVE host sets no proxy variable, in either spelling."""
    for name in HOST_PROXY_VARIABLES:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def settings_proxy_on(load_config: Callable[..., Any]) -> None:
    """Settings > Network > Proxy is on with a Custom proxy, stored and in force."""
    stored = {"enabled": True, "source": "custom", "host": "settings-proxy.example", "port": 3128}
    load_config({"network": {"proxy": stored}})
    importlib.import_module("wavecore.api.services.network.proxy").register_proxy_resolver()


def proxy_variables_of(env: dict[str, str]) -> dict[str, str]:
    return {name: env[name] for name in HOST_PROXY_VARIABLES if name in env}


class TestProxyVariables:
    """The script keeps the WAVE host's proxy variables; the Proxy setting never changes them."""

    def test_they_reach_the_script_unchanged_while_the_settings_proxy_is_off(
        self, host_proxy_variables: dict[str, str]
    ) -> None:
        env = build_environment({}, {}, "input_vars")

        assert proxy_variables_of(env) == host_proxy_variables

    def test_they_reach_the_script_unchanged_while_the_settings_proxy_is_on(
        self, host_proxy_variables: dict[str, str], settings_proxy_on: None
    ) -> None:
        env = build_environment({}, {}, "input_vars")

        assert proxy_variables_of(env) == host_proxy_variables

    def test_none_is_added_while_the_settings_proxy_is_off(
        self, no_host_proxy_variables: None
    ) -> None:
        env = build_environment({}, {}, "input_vars")

        assert proxy_variables_of(env) == {}

    def test_none_is_added_while_the_settings_proxy_is_on(
        self, no_host_proxy_variables: None, settings_proxy_on: None
    ) -> None:
        env = build_environment({}, {}, "input_vars")

        assert proxy_variables_of(env) == {}
