"""Shell Exec metadata: the command rows, the shared rows and the outputs (REQ-3.4.1.18).

SHRUN-17: one command line on the WAVE server, through the shell the author names, and not
remotable. SHRUN-18: the rows Shell Script has minus the script ones, and every text names
the command. REQ-3.4.2.2: the descriptor keys the editor reads.
"""

from typing import Any

import pytest

from wavecore.plugins.shell_exec import ShellExecPlugin

EXPECTED_PARAM_ORDER = [
    "command",
    "shell",
    "env_vars",
    "working_dir",
    "timeout",
    "stream_output",
    "stop_on_pattern",
    "pass_pattern",
    "fail_pattern",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["stdout", "stderr", "exit_code", "success", "error", "reason"]

RECORD_GATE = {"field": "on_error", "values": ["record"]}
PATTERN_GATE = {"field": "stop_on_pattern", "values": ["true"]}

SCRIPT_ONLY_PARAMS = [
    "script_type",
    "script",
    "script_file",
    "arguments",
    "input_vars",
    "script_variables",
]

PARAM_DESCRIPTIONS = {
    "command": (
        "One command line, run as <shell> -c <command>, so pipes, redirects, globs and && "
        "work. For example kubectl get pods -A | grep -c Running."
    ),
    "shell": (
        "The shell that runs the command. It may include flags, for example "
        "/bin/bash -o pipefail."
    ),
    "env_vars": (
        "Each entry is exported into the command's environment. Text, numbers and booleans "
        "arrive as text; arrays, maps and tables as JSON text."
    ),
    "working_dir": (
        "Where the command starts: testdata://, artifact:// or an absolute or relative path on "
        "the WAVE server. The folder must exist. Empty starts in the system temp folder of the "
        "machine the command runs on."
    ),
    "timeout": "Seconds the command may run before WAVE stops it.",
    "stream_output": (
        "Write each output line to the run console as it arrives: stdout at INFO, stderr at "
        "WARN."
    ),
    "stop_on_pattern": "Stop the command as soon as a line of its output matches a pattern.",
    "pass_pattern": (
        "A Python regular expression. A matching line stops the command and the block passes."
    ),
    "fail_pattern": (
        "A Python regular expression. A matching line stops the command and the block fails."
    ),
    "on_error": "Fail the block, or record the outcome and let the test continue.",
}

OUTPUT_DESCRIPTIONS = {
    "stdout": "Everything the command wrote to standard output.",
    "stderr": "Everything the command wrote to standard error.",
    "exit_code": (
        "The command's exit code; 137 when WAVE stopped it, -1 when it never started. A "
        "non-zero code is a failure."
    ),
    "success": (
        "True when the command passed. False when it failed and On error is Record and " "continue."
    ),
    "error": (
        "The error message when the operation failed under Record and continue; empty " "otherwise"
    ),
    "reason": (
        "Why it failed: NonZeroExit, Timeout, FailPattern or StartFailed; empty when it " "passed."
    ),
}

OUTPUT_TYPES = {
    "stdout": "string",
    "stderr": "string",
    "exit_code": "integer",
    "success": "boolean",
    "error": "string",
    "reason": "string",
}


def _parameters() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in ShellExecPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in ShellExecPlugin().metadata["output_schema"]}


class TestShellExecIdentity:
    """The block's identity, category and model validity."""

    def test_plugin_instantiates(self) -> None:
        assert ShellExecPlugin() is not None

    def test_identity_fields(self) -> None:
        meta = ShellExecPlugin().metadata

        assert meta["id"] == "shell-exec"
        assert meta["name"] == "Shell Exec"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "system"
        assert meta["description"]

    def test_return_type_is_map(self) -> None:
        assert ShellExecPlugin().metadata["return_type"] == "map"

    def test_tags(self) -> None:
        assert ShellExecPlugin().metadata["tags"] == ["shell", "command", "exec", "system"]

    def test_the_block_is_not_remotable(self) -> None:
        assert "remotable" not in ShellExecPlugin().metadata

    def test_metadata_validates_as_a_plugin_model(self) -> None:
        model = ShellExecPlugin().get_plugin_model()

        assert model.id == "shell-exec"
        assert model.version == "1.0.0"
        assert model.metadata.category == "system"
        assert [p.name for p in model.parameters] == EXPECTED_PARAM_ORDER
        assert [o.name for o in model.outputs] == EXPECTED_OUTPUT_ORDER


class TestShellExecInputDescriptors:
    """Every input row: order, type, requirement, default and description."""

    def test_parameter_order(self) -> None:
        assert [p["name"] for p in ShellExecPlugin().metadata["parameters"]] == EXPECTED_PARAM_ORDER

    @pytest.mark.parametrize(("name", "description"), sorted(PARAM_DESCRIPTIONS.items()))
    def test_parameter_descriptions(self, name: str, description: str) -> None:
        assert _parameters()[name]["description"] == description

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("command", "string"),
            ("shell", "string"),
            ("env_vars", "map"),
            ("working_dir", "string"),
            ("timeout", "integer"),
            ("stream_output", "boolean"),
            ("stop_on_pattern", "boolean"),
            ("pass_pattern", "string"),
            ("fail_pattern", "string"),
            ("on_error", "string"),
        ],
    )
    def test_parameter_types(self, name: str, expected: str) -> None:
        assert _parameters()[name]["type"] == expected

    def test_command_is_required(self) -> None:
        command = _parameters()["command"]

        assert command["required"] is True
        assert "required_when" not in command

    def test_command_preserves_whitespace(self) -> None:
        assert not _parameters()["command"].get("trim")

    @pytest.mark.parametrize("name", [n for n in EXPECTED_PARAM_ORDER if n != "command"])
    def test_every_other_row_is_optional(self, name: str) -> None:
        assert _parameters()[name]["required"] is False

    def test_shell_defaults_to_bin_sh(self) -> None:
        shell = _parameters()["shell"]

        assert shell["default"] == "/bin/sh"
        assert shell["trim"] is True

    def test_environment_is_a_map_that_starts_empty(self) -> None:
        assert _parameters()["env_vars"]["default"] == {}

    def test_working_directory_is_trimmed_and_publishes_no_default(self) -> None:
        working_dir = _parameters()["working_dir"]

        assert "default" not in working_dir
        assert working_dir["trim"] is True

    def test_timeout_defaults_to_300_seconds_and_has_a_floor_of_one(self) -> None:
        timeout = _parameters()["timeout"]

        assert timeout["default"] == 300
        assert timeout["minimum"] == 1

    @pytest.mark.parametrize("name", ["stream_output", "stop_on_pattern"])
    def test_the_checkbox_rows_start_off(self, name: str) -> None:
        assert _parameters()[name]["default"] is False

    @pytest.mark.parametrize("name", ["pass_pattern", "fail_pattern"])
    def test_the_pattern_rows_start_empty_behind_the_stop_on_pattern_gate(self, name: str) -> None:
        row = _parameters()[name]

        assert row["default"] == ""
        assert row["show_when"] == PATTERN_GATE

    def test_the_fail_pattern_carries_no_conditional_requirement(self) -> None:
        fail_pattern = _parameters()["fail_pattern"]

        assert "required_when" not in fail_pattern
        assert "required_when_all" not in fail_pattern

    def test_on_error_offers_fail_and_record_with_fail_first(self) -> None:
        on_error = _parameters()["on_error"]

        assert on_error["default"] == "fail"
        assert on_error["enum_values"] == ["fail", "record"]

    @pytest.mark.parametrize("name", EXPECTED_PARAM_ORDER)
    def test_no_row_is_a_credential_field(self, name: str) -> None:
        assert "secret" not in _parameters()[name]

    def test_no_protocol_masking_list(self) -> None:
        assert "secret_mask_fields" not in ShellExecPlugin().metadata

    def test_every_parameter_wire_name_appears_once(self) -> None:
        names = [p["name"] for p in ShellExecPlugin().metadata["parameters"]]

        assert len(names) == len(set(names))


class TestShellExecHasNoScriptRows:
    """The command line carries its own arguments, so the script rows are absent (SHRUN-18)."""

    @pytest.mark.parametrize("name", SCRIPT_ONLY_PARAMS)
    def test_script_only_rows_are_absent(self, name: str) -> None:
        assert name not in _parameters()

    @pytest.mark.parametrize("name", EXPECTED_PARAM_ORDER)
    def test_no_row_declares_extra_outputs(self, name: str) -> None:
        assert "declares_outputs" not in _parameters()[name]


class TestShellExecOutputSchema:
    """The six outputs, with Error and Reason gated behind Record and continue."""

    def test_output_order(self) -> None:
        outputs = ShellExecPlugin().metadata["output_schema"]

        assert [o["name"] for o in outputs] == EXPECTED_OUTPUT_ORDER

    @pytest.mark.parametrize(("name", "expected"), sorted(OUTPUT_TYPES.items()))
    def test_output_types(self, name: str, expected: str) -> None:
        assert _outputs()[name]["type"] == expected

    @pytest.mark.parametrize(("name", "description"), sorted(OUTPUT_DESCRIPTIONS.items()))
    def test_output_descriptions(self, name: str, description: str) -> None:
        assert _outputs()[name]["description"] == description

    def test_the_reason_row_never_offers_the_script_variable_reason(self) -> None:
        assert "OutputVariable" not in _outputs()["reason"]["description"]

    @pytest.mark.parametrize("name", ["error", "reason"])
    def test_the_two_error_rows_show_only_under_record_and_continue(self, name: str) -> None:
        assert _outputs()[name]["show_when"] == RECORD_GATE

    @pytest.mark.parametrize("name", ["stdout", "stderr", "exit_code", "success"])
    def test_the_always_bound_rows_carry_no_gate(self, name: str) -> None:
        assert "show_when" not in _outputs()[name]

    def test_every_output_wire_name_appears_once(self) -> None:
        names = [o["name"] for o in ShellExecPlugin().metadata["output_schema"]]

        assert len(names) == len(set(names))
