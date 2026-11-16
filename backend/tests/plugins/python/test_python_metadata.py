"""Python block metadata: identity, input descriptors and outputs (REQ-3.4.1.2).

PYRUN-1: the block is remotable and carries no sandbox, resource-limit or run-as row.
PYRUN-3: the Interpreter row takes the place of Shell Script's Shell row and an empty row
means WAVE's own interpreter. PYRUN-6: the variable-export list carries the declared-outputs
marker. PYRUN-12: the working-directory text names where the block runs, not the WAVE server.
"""

import inspect
from typing import Any

import pytest

from wavecore.plugins import python
from wavecore.plugins.python import PythonPlugin

EXPECTED_PARAM_ORDER = [
    "script_type",
    "script",
    "script_file",
    "interpreter",
    "arguments",
    "input_vars",
    "working_dir",
    "environment",
    "stream_output",
    "stop_on_pattern",
    "pass_pattern",
    "fail_pattern",
    "timeout",
    "on_error",
    "script_variables",
]

EXPECTED_PARAMS = set(EXPECTED_PARAM_ORDER)

EXPECTED_OUTPUT_ORDER = ["stdout", "stderr", "exit_code", "success", "error", "reason"]

STRING_PARAMS = [
    "script_type",
    "script",
    "script_file",
    "interpreter",
    "working_dir",
    "pass_pattern",
    "fail_pattern",
    "on_error",
]
INTEGER_PARAMS = ["timeout"]
BOOLEAN_PARAMS = ["stream_output", "stop_on_pattern"]
ARRAY_PARAMS = ["arguments", "script_variables"]
MAP_PARAMS = ["input_vars", "environment"]

TRIMMED_PARAMS = ["script_file", "interpreter", "working_dir"]

PATTERN_PARAMS = ["pass_pattern", "fail_pattern"]

ENUM_PARAMS = ["script_type", "on_error"]

DEFAULTS: list[tuple[str, Any]] = [
    ("script_type", "source"),
    ("interpreter", ""),
    ("arguments", []),
    ("input_vars", {}),
    ("environment", {}),
    ("stream_output", False),
    ("stop_on_pattern", False),
    ("pass_pattern", ""),
    ("fail_pattern", ""),
    ("timeout", 300),
    ("on_error", "fail"),
    ("script_variables", []),
]

RECORD_GATE = {"field": "on_error", "values": ["record"]}
STOP_GATE = {"field": "stop_on_pattern", "values": ["true"]}
SOURCE_GATE = {"field": "script_type", "values": ["source"]}
FILE_GATE = {"field": "script_type", "values": ["file"]}

SHARED_PARAM_DESCRIPTIONS = {
    "environment": (
        "Each entry is exported into the script's environment. Text, numbers and booleans "
        "arrive as text; arrays, maps and tables as JSON text."
    ),
    "stream_output": (
        "Write each output line to the run console as it arrives: stdout at INFO, stderr at WARN."
    ),
    "stop_on_pattern": "Stop the script as soon as a line of its output matches a pattern.",
    "pass_pattern": (
        "A Python regular expression. A matching line stops the script and the block passes."
    ),
    "fail_pattern": (
        "A Python regular expression. A matching line stops the script and the block fails."
    ),
    "timeout": "Seconds the script may run before WAVE stops it.",
    "on_error": "Fail the block, or record the outcome and let the test continue.",
}

OUTPUT_DESCRIPTIONS = {
    "stdout": "Everything the script wrote to standard output.",
    "stderr": "Everything the script wrote to standard error.",
    "exit_code": (
        "The script's exit code; 137 when WAVE stopped it, -1 when it never started. A "
        "non-zero code is a failure."
    ),
    "success": (
        "True when the script passed. False when it failed and On error is Record and continue."
    ),
    "error": (
        "The error message when the operation failed under Record and continue; empty otherwise"
    ),
}

OUTPUT_TYPES = [
    ("stdout", "string"),
    ("stderr", "string"),
    ("exit_code", "integer"),
    ("success", "boolean"),
    ("error", "string"),
    ("reason", "string"),
]

REASONS = ["NonZeroExit", "Exception", "Timeout", "FailPattern", "StartFailed", "OutputVariable"]

# The four columns of a Variable Exports row (PYRUN-6): the name is the export list entry,
# the other three ride the block's output bindings.
EXPORT_ROW_COLUMNS = ["name", "type", "secret", "variable"]

ABSENT_PARAMETERS = [
    "code",
    "output_vars",
    "input_variables",
    "output_variables",
    "cpu_limit",
    "memory_limit",
    "storage_limit",
]

SANDBOX_TOKENS = ["marshal", "import resource", "python_worker", "CodeExecutorBase"]


def _parameters() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in PythonPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in PythonPlugin().metadata["output_schema"]}


class TestPythonIdentity:
    """The block's identity, category, remotability and model validity (PYRUN-1)."""

    def test_plugin_instantiates(self) -> None:
        assert PythonPlugin() is not None

    def test_identity_fields(self) -> None:
        meta = PythonPlugin().metadata

        assert meta["id"] == "python"
        assert meta["name"] == "Python"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "system"
        assert meta["description"]

    def test_return_type_is_map(self) -> None:
        assert PythonPlugin().metadata["return_type"] == "map"

    def test_tags_name_the_language(self) -> None:
        assert "python" in PythonPlugin().metadata["tags"]

    def test_remotable_is_true(self) -> None:
        assert PythonPlugin().metadata["remotable"] is True

    @pytest.mark.parametrize("word", ["sandbox", "limit", "isolated"])
    def test_description_promises_no_sandbox_or_limits(self, word: str) -> None:
        assert word not in PythonPlugin().metadata["description"].lower()

    def test_metadata_validates_as_a_plugin_model(self) -> None:
        model = PythonPlugin().get_plugin_model()

        assert model.id == "python"
        assert model.version == "1.0.0"
        assert model.metadata.category == "system"
        assert {p.name for p in model.parameters} == EXPECTED_PARAMS
        assert [o.name for o in model.outputs] == EXPECTED_OUTPUT_ORDER


class TestPythonInputDescriptors:
    """Every input descriptor row: name, type, default, trim and description."""

    def test_parameter_order(self) -> None:
        params = PythonPlugin().metadata["parameters"]

        assert [p["name"] for p in params] == EXPECTED_PARAM_ORDER

    def test_parameter_names(self) -> None:
        assert set(_parameters()) == EXPECTED_PARAMS

    def test_every_parameter_wire_name_appears_once(self) -> None:
        names = [p["name"] for p in PythonPlugin().metadata["parameters"]]

        assert len(names) == len(set(names))

    @pytest.mark.parametrize("name", STRING_PARAMS)
    def test_string_parameter_types(self, name: str) -> None:
        assert _parameters()[name]["type"] == "string"

    @pytest.mark.parametrize("name", INTEGER_PARAMS)
    def test_integer_parameter_types(self, name: str) -> None:
        assert _parameters()[name]["type"] == "integer"

    @pytest.mark.parametrize("name", BOOLEAN_PARAMS)
    def test_boolean_parameter_types(self, name: str) -> None:
        assert _parameters()[name]["type"] == "boolean"

    @pytest.mark.parametrize("name", ARRAY_PARAMS)
    def test_array_parameter_types(self, name: str) -> None:
        assert _parameters()[name]["type"] == "array"

    @pytest.mark.parametrize("name", MAP_PARAMS)
    def test_map_parameter_types(self, name: str) -> None:
        assert _parameters()[name]["type"] == "map"

    @pytest.mark.parametrize(("name", "default"), DEFAULTS)
    def test_parameter_defaults(self, name: str, default: Any) -> None:
        assert _parameters()[name]["default"] == default

    @pytest.mark.parametrize("name", ["script", "script_file"])
    def test_the_two_script_rows_have_no_default(self, name: str) -> None:
        assert _parameters()[name].get("default") is None

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS))
    def test_no_row_is_unconditionally_required(self, name: str) -> None:
        assert not _parameters()[name].get("required")

    @pytest.mark.parametrize("name", TRIMMED_PARAMS)
    def test_single_line_paths_and_the_interpreter_row_are_trimmed(self, name: str) -> None:
        assert _parameters()[name]["trim"] is True

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - set(TRIMMED_PARAMS)))
    def test_every_other_row_keeps_its_whitespace(self, name: str) -> None:
        assert not _parameters()[name].get("trim")

    def test_timeout_has_a_minimum_of_one_second(self) -> None:
        assert _parameters()["timeout"]["minimum"] == 1

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS))
    def test_every_row_carries_a_description(self, name: str) -> None:
        assert _parameters()[name]["description"]

    @pytest.mark.parametrize("name", sorted(SHARED_PARAM_DESCRIPTIONS))
    def test_the_shared_rows_keep_their_pinned_text(self, name: str) -> None:
        assert _parameters()[name]["description"] == SHARED_PARAM_DESCRIPTIONS[name]


class TestPythonScriptSource:
    """Script Type picks Source or File, and each mode requires its own row (PYRUN-2)."""

    def test_script_type_enum_values(self) -> None:
        assert _parameters()["script_type"]["enum_values"] == ["source", "file"]

    def test_script_is_required_in_source_mode(self) -> None:
        assert _parameters()["script"]["required_when"] == SOURCE_GATE

    def test_script_file_is_required_in_file_mode(self) -> None:
        assert _parameters()["script_file"]["required_when"] == FILE_GATE

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - {"script", "script_file"}))
    def test_no_other_row_is_conditionally_required(self, name: str) -> None:
        param = _parameters()[name]

        assert "required_when" not in param
        assert "required_when_all" not in param

    def test_the_at_least_one_pattern_rule_is_not_a_descriptor_rule(self) -> None:
        assert "required_when_all" not in _parameters()["fail_pattern"]


class TestPythonInterpreterRow:
    """Interpreter is a free-text command line; empty means WAVE's own (PYRUN-3)."""

    def test_interpreter_defaults_to_empty(self) -> None:
        interpreter = _parameters()["interpreter"]

        assert interpreter["type"] == "string"
        assert interpreter["default"] == ""

    def test_interpreter_is_shown_in_both_script_types(self) -> None:
        interpreter = _parameters()["interpreter"]

        assert "show_when" not in interpreter
        assert "required_when" not in interpreter

    def test_interpreter_is_not_a_picker(self) -> None:
        assert "enum_values" not in _parameters()["interpreter"]

    def test_the_description_allows_flags(self) -> None:
        assert "flags" in _parameters()["interpreter"]["description"]

    def test_the_description_names_the_default_interpreter(self) -> None:
        assert "WAVE's own interpreter" in _parameters()["interpreter"]["description"]

    @pytest.mark.parametrize("word", ["shell", "/bin/bash"])
    def test_the_description_is_not_the_shell_row(self, word: str) -> None:
        assert word not in _parameters()["interpreter"]["description"]

    def test_there_is_no_shell_row(self) -> None:
        assert "shell" not in _parameters()


class TestPythonWorkingDirectoryText:
    """The working-directory text is correct for a remotable block (PYRUN-12)."""

    def test_the_text_names_where_the_block_runs(self) -> None:
        assert "where the block runs" in _parameters()["working_dir"]["description"]

    def test_the_text_does_not_pin_the_wave_server(self) -> None:
        assert "on the WAVE server" not in _parameters()["working_dir"]["description"]

    def test_the_folder_must_exist(self) -> None:
        assert "The folder must exist." in _parameters()["working_dir"]["description"]

    def test_the_text_is_exact(self) -> None:
        assert _parameters()["working_dir"]["description"] == (
            "Where the script starts: testdata://, artifact:// or an absolute or relative path "
            "where the block runs. The folder must exist. Empty starts in the system temp folder "
            "of the machine the script runs on."
        )

    def test_the_row_publishes_no_default(self) -> None:
        assert "default" not in _parameters()["working_dir"]


class TestPythonInputVariables:
    """Input Variables are globals, never process environment text (PYRUN-5)."""

    def test_input_vars_is_a_map(self) -> None:
        assert _parameters()["input_vars"]["type"] == "map"

    def test_the_description_names_globals(self) -> None:
        assert "global" in _parameters()["input_vars"]["description"].lower()

    def test_the_description_does_not_name_the_environment(self) -> None:
        assert "environment" not in _parameters()["input_vars"]["description"].lower()

    def test_the_environment_map_is_a_separate_row(self) -> None:
        assert _parameters()["environment"]["type"] == "map"


class TestPythonPatternGates:
    """Pass and Fail pattern are shown only while Stop on pattern is on (PYRUN-11)."""

    @pytest.mark.parametrize("name", PATTERN_PARAMS)
    def test_pattern_rows_are_gated(self, name: str) -> None:
        assert _parameters()[name]["show_when"] == STOP_GATE

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - set(PATTERN_PARAMS)))
    def test_no_other_row_is_gated(self, name: str) -> None:
        assert "show_when" not in _parameters()[name]


class TestPythonFailureHandling:
    """On error offers Fail the block and Record and continue (PYRUN-7)."""

    def test_on_error_enum_values(self) -> None:
        assert _parameters()["on_error"]["enum_values"] == ["fail", "record"]

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - set(ENUM_PARAMS)))
    def test_no_other_row_carries_an_enum(self, name: str) -> None:
        assert "enum_values" not in _parameters()[name]


class TestPythonVariableExportRows:
    """Variable Exports rows: Script Variable, Type, Secret and WAVE Variable (PYRUN-6)."""

    def test_script_variables_declares_outputs(self) -> None:
        assert _parameters()["script_variables"]["declares_outputs"] is True

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - {"script_variables"}))
    def test_no_other_row_declares_outputs(self, name: str) -> None:
        assert "declares_outputs" not in _parameters()[name]

    def test_the_export_list_is_an_array_of_names(self) -> None:
        exports = _parameters()["script_variables"]

        assert exports["type"] == "array"
        assert exports["default"] == []

    def test_script_variables_are_not_in_the_output_schema(self) -> None:
        assert set(_outputs()) == set(EXPECTED_OUTPUT_ORDER)

    @pytest.mark.parametrize("column", EXPORT_ROW_COLUMNS)
    def test_no_export_row_column_is_a_parameter_of_its_own(self, column: str) -> None:
        assert column not in _parameters()


class TestPythonOutputSchema:
    """Stdout, Stderr, Exit Code and Success always; Error and Reason under Record."""

    def test_output_order(self) -> None:
        outputs = PythonPlugin().metadata["output_schema"]

        assert [o["name"] for o in outputs] == EXPECTED_OUTPUT_ORDER

    def test_every_output_wire_name_appears_once(self) -> None:
        names = [o["name"] for o in PythonPlugin().metadata["output_schema"]]

        assert len(names) == len(set(names))

    @pytest.mark.parametrize(("name", "expected"), OUTPUT_TYPES)
    def test_output_types(self, name: str, expected: str) -> None:
        assert _outputs()[name]["type"] == expected

    @pytest.mark.parametrize("name", sorted(OUTPUT_DESCRIPTIONS))
    def test_output_descriptions(self, name: str) -> None:
        assert _outputs()[name]["description"] == OUTPUT_DESCRIPTIONS[name]

    @pytest.mark.parametrize("reason", REASONS)
    def test_reason_names_every_failure_reason(self, reason: str) -> None:
        assert reason in _outputs()["reason"]["description"]

    @pytest.mark.parametrize("name", ["error", "reason"])
    def test_error_and_reason_are_gated_on_record(self, name: str) -> None:
        assert _outputs()[name]["show_when"] == RECORD_GATE

    @pytest.mark.parametrize("name", ["stdout", "stderr", "exit_code", "success"])
    def test_the_always_present_outputs_are_not_gated(self, name: str) -> None:
        assert "show_when" not in _outputs()[name]

    @pytest.mark.parametrize("name", EXPECTED_OUTPUT_ORDER)
    def test_no_output_switches_type(self, name: str) -> None:
        assert "type_when" not in _outputs()[name]


class TestPythonAbsentFields:
    """No sandbox and no resource limits (PYRUN-1)."""

    @pytest.mark.parametrize("name", ABSENT_PARAMETERS)
    def test_the_parameter_is_absent(self, name: str) -> None:
        assert name not in _parameters()

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS))
    def test_no_parameter_is_a_secret(self, name: str) -> None:
        assert not _parameters()[name].get("secret")

    def test_no_protocol_secret_fields(self) -> None:
        assert "secret_mask_fields" not in PythonPlugin().metadata

    @pytest.mark.parametrize("token", SANDBOX_TOKENS)
    def test_the_module_carries_no_sandbox_token(self, token: str) -> None:
        assert token not in inspect.getsource(python)
