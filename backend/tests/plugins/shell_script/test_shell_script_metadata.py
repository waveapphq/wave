"""Shell Script plugin metadata: identity, input descriptors and outputs (REQ-3.4.1.1).

SHRUN-3: the Shell row names the program that runs the script and nothing detects which
shell is in use. SHRUN-2: no sandbox, resource-limit or run-as row exists. REQ-3.4.2.2:
the variable-export list carries the declared-outputs marker.
"""

import inspect
from typing import Any

import pytest

from wavecore.plugins import shell_script
from wavecore.plugins.shell_script import ShellScriptPlugin

EXPECTED_PARAM_ORDER = [
    "script_type",
    "shell",
    "script",
    "script_file",
    "arguments",
    "input_vars",
    "script_variables",
    "working_dir",
    "timeout",
    "stream_output",
    "stop_on_pattern",
    "pass_pattern",
    "fail_pattern",
    "on_error",
]

EXPECTED_PARAMS = {
    "script_type",
    "script",
    "script_file",
    "shell",
    "arguments",
    "input_vars",
    "script_variables",
    "working_dir",
    "timeout",
    "stream_output",
    "stop_on_pattern",
    "pass_pattern",
    "fail_pattern",
    "on_error",
}

EXPECTED_OUTPUT_ORDER = ["stdout", "stderr", "exit_code", "success", "error", "reason"]

STRING_PARAMS = [
    "script_type",
    "script",
    "script_file",
    "shell",
    "working_dir",
    "pass_pattern",
    "fail_pattern",
    "on_error",
]
INTEGER_PARAMS = ["timeout"]
BOOLEAN_PARAMS = ["stream_output", "stop_on_pattern"]
ARRAY_PARAMS = ["arguments", "script_variables"]
MAP_PARAMS = ["input_vars"]

TRIMMED_PARAMS = ["script_file", "shell", "working_dir"]

DEFAULTS: list[tuple[str, Any]] = [
    ("script_type", "source"),
    ("shell", "/bin/bash"),
    ("arguments", []),
    ("input_vars", {}),
    ("script_variables", []),
    ("timeout", 300),
    ("stream_output", False),
    ("stop_on_pattern", False),
    ("pass_pattern", ""),
    ("fail_pattern", ""),
    ("on_error", "fail"),
]

RECORD_GATE = {"field": "on_error", "values": ["record"]}
STOP_GATE = {"field": "stop_on_pattern", "values": ["true"]}
SOURCE_GATE = {"field": "script_type", "values": ["source"]}
FILE_GATE = {"field": "script_type", "values": ["file"]}

PATTERN_PARAMS = ["pass_pattern", "fail_pattern"]

PARAM_DESCRIPTIONS = {
    "script_type": (
        "Source runs the script typed here. File runs a script file from Test Data, "
        "Artifacts or the WAVE server."
    ),
    "script": (
        "The script to run. It runs under the shell named above, whatever its first line says."
    ),
    "script_file": (
        "The script file to run: testdata://, artifact:// or an absolute or relative path on "
        "the WAVE server. It runs under the shell named above, whatever its first line says."
    ),
    "shell": (
        "The shell that runs the script. It may include flags, for example /bin/bash -o pipefail."
    ),
    "arguments": (
        "Passed to the script as $1, $2 and on, in row order. An empty row is passed as an "
        "empty argument."
    ),
    "input_vars": (
        "Each entry is exported into the script's environment. Text, numbers and booleans "
        "arrive as text; arrays, maps and tables as JSON text."
    ),
    "script_variables": (
        "Shell variables the script sets, each bound to one WAVE variable and read as that "
        "variable's type."
    ),
    "working_dir": (
        "Where the script starts: testdata://, artifact:// or an absolute or relative path on "
        "the WAVE server. The folder must exist. Empty starts in the system temp folder of the "
        "machine the script runs on."
    ),
    "timeout": "Seconds the script may run before WAVE stops it.",
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
    "reason": (
        "Why it failed: NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable; "
        "empty when it passed."
    ),
}

ABSENT_PARAMETERS = [
    "command",
    "cpu_limit",
    "memory_limit",
    "storage_limit",
    "env_vars",
    "output_vars",
]


def _parameters() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in ShellScriptPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in ShellScriptPlugin().metadata["output_schema"]}


class TestShellScriptIdentity:
    """The block's identity, category and model validity (SHRUN-1, SHRUN-16)."""

    def test_plugin_instantiates(self) -> None:
        assert ShellScriptPlugin() is not None

    def test_identity_fields(self) -> None:
        meta = ShellScriptPlugin().metadata

        assert meta["id"] == "shell-script"
        assert meta["name"] == "Shell Script"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "system"
        assert meta["description"]

    def test_return_type_is_map(self) -> None:
        assert ShellScriptPlugin().metadata["return_type"] == "map"

    def test_tags(self) -> None:
        assert ShellScriptPlugin().metadata["tags"] == ["shell", "script", "bash", "system"]

    def test_no_remotable_key(self) -> None:
        assert "remotable" not in ShellScriptPlugin().metadata

    @pytest.mark.parametrize("word", ["sandbox", "limit", "strip"])
    def test_description_promises_no_sandbox_or_limits(self, word: str) -> None:
        assert word not in ShellScriptPlugin().metadata["description"].lower()

    def test_metadata_validates_as_a_plugin_model(self) -> None:
        model = ShellScriptPlugin().get_plugin_model()

        assert model.id == "shell-script"
        assert model.version == "1.0.0"
        assert model.metadata.category == "system"
        assert model.metadata.remotable is False
        assert {p.name for p in model.parameters} == EXPECTED_PARAMS
        assert [o.name for o in model.outputs] == EXPECTED_OUTPUT_ORDER


class TestShellScriptInputDescriptors:
    """Every input descriptor row: name, type, default, trim and description."""

    def test_parameter_order(self) -> None:
        params = ShellScriptPlugin().metadata["parameters"]

        assert [p["name"] for p in params] == EXPECTED_PARAM_ORDER

    def test_parameter_names(self) -> None:
        assert set(_parameters()) == EXPECTED_PARAMS

    def test_every_parameter_wire_name_appears_once(self) -> None:
        names = [p["name"] for p in ShellScriptPlugin().metadata["parameters"]]

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

    def test_the_working_directory_row_publishes_no_default(self) -> None:
        assert "default" not in _parameters()["working_dir"]

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS))
    def test_no_row_is_unconditionally_required(self, name: str) -> None:
        assert not _parameters()[name].get("required")

    @pytest.mark.parametrize("name", TRIMMED_PARAMS)
    def test_single_line_paths_and_the_shell_row_are_trimmed(self, name: str) -> None:
        assert _parameters()[name]["trim"] is True

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - set(TRIMMED_PARAMS)))
    def test_every_other_row_keeps_its_whitespace(self, name: str) -> None:
        assert not _parameters()[name].get("trim")

    def test_timeout_has_a_minimum_of_one_second(self) -> None:
        assert _parameters()["timeout"]["minimum"] == 1

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS))
    def test_parameter_descriptions(self, name: str) -> None:
        assert _parameters()[name]["description"] == PARAM_DESCRIPTIONS[name]


class TestShellScriptScriptSource:
    """Script Type picks Source or File, and each mode requires its own row (SHRUN-3)."""

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


class TestShellScriptShellRow:
    """The Shell row is free text, shown in both Script Types, with no shell detection."""

    def test_shell_defaults_to_bash(self) -> None:
        shell = _parameters()["shell"]

        assert shell["type"] == "string"
        assert shell["default"] == "/bin/bash"

    def test_shell_is_shown_in_both_script_types(self) -> None:
        shell = _parameters()["shell"]

        assert "show_when" not in shell
        assert "required_when" not in shell

    def test_shell_is_not_a_picker(self) -> None:
        assert "enum_values" not in _parameters()["shell"]

    @pytest.mark.parametrize("name", ["shell_type", "interpreter", "shebang"])
    def test_no_shell_detection_row(self, name: str) -> None:
        assert name not in _parameters()

    @pytest.mark.parametrize("token", ["detect_shell", "shell_type"])
    def test_the_module_detects_no_shell(self, token: str) -> None:
        assert token not in inspect.getsource(shell_script)


class TestShellScriptPatternGates:
    """Pass and Fail pattern are shown only while Stop on pattern is on (SHRUN-13)."""

    @pytest.mark.parametrize("name", PATTERN_PARAMS)
    def test_pattern_rows_are_gated(self, name: str) -> None:
        assert _parameters()[name]["show_when"] == STOP_GATE

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - set(PATTERN_PARAMS)))
    def test_no_other_row_is_gated(self, name: str) -> None:
        assert "show_when" not in _parameters()[name]


class TestShellScriptFailureHandling:
    """On error offers Fail the block and Record and continue (SHRUN-9)."""

    def test_on_error_enum_values(self) -> None:
        assert _parameters()["on_error"]["enum_values"] == ["fail", "record"]

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - {"script_type", "on_error"}))
    def test_no_other_row_carries_an_enum(self, name: str) -> None:
        assert "enum_values" not in _parameters()[name]


class TestShellScriptDeclaredOutputs:
    """The variable-export list declares the extra outputs a recipe may capture."""

    def test_script_variables_declares_outputs(self) -> None:
        assert _parameters()["script_variables"]["declares_outputs"] is True

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS - {"script_variables"}))
    def test_no_other_row_declares_outputs(self, name: str) -> None:
        assert "declares_outputs" not in _parameters()[name]

    def test_script_variables_are_not_in_the_output_schema(self) -> None:
        assert set(_outputs()) == set(EXPECTED_OUTPUT_ORDER)


class TestShellScriptOutputSchema:
    """Stdout, Stderr, Exit Code and Success always; Error and Reason under Record."""

    def test_output_order(self) -> None:
        outputs = ShellScriptPlugin().metadata["output_schema"]

        assert [o["name"] for o in outputs] == EXPECTED_OUTPUT_ORDER

    def test_every_output_wire_name_appears_once(self) -> None:
        names = [o["name"] for o in ShellScriptPlugin().metadata["output_schema"]]

        assert len(names) == len(set(names))

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("stdout", "string"),
            ("stderr", "string"),
            ("exit_code", "integer"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ],
    )
    def test_output_types(self, name: str, expected: str) -> None:
        assert _outputs()[name]["type"] == expected

    @pytest.mark.parametrize("name", EXPECTED_OUTPUT_ORDER)
    def test_output_descriptions(self, name: str) -> None:
        assert _outputs()[name]["description"] == OUTPUT_DESCRIPTIONS[name]

    def test_reason_names_the_variable_export_failure(self) -> None:
        assert "OutputVariable" in _outputs()["reason"]["description"]

    @pytest.mark.parametrize("name", ["error", "reason"])
    def test_error_and_reason_are_gated_on_record(self, name: str) -> None:
        assert _outputs()[name]["show_when"] == RECORD_GATE

    @pytest.mark.parametrize("name", ["stdout", "stderr", "exit_code", "success"])
    def test_the_always_present_outputs_are_not_gated(self, name: str) -> None:
        assert "show_when" not in _outputs()[name]

    @pytest.mark.parametrize("name", EXPECTED_OUTPUT_ORDER)
    def test_no_output_switches_type(self, name: str) -> None:
        assert "type_when" not in _outputs()[name]


class TestShellScriptAbsentFields:
    """No sandbox, no resource limits, no protocol secret (SHRUN-2, REQ-3.1.3.16)."""

    @pytest.mark.parametrize("name", ABSENT_PARAMETERS)
    def test_the_parameter_is_absent(self, name: str) -> None:
        assert name not in _parameters()

    @pytest.mark.parametrize("name", sorted(EXPECTED_PARAMS))
    def test_no_parameter_is_a_secret(self, name: str) -> None:
        assert not _parameters()[name].get("secret")

    def test_no_protocol_secret_fields(self) -> None:
        assert "secret_mask_fields" not in ShellScriptPlugin().metadata
