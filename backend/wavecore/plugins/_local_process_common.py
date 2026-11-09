"""WAVE-side material shared by Shell Script, Shell Exec and Python (REQ-3.4.1.1, REQ-3.4.1.18).

The descriptors the blocks declare, the checks that need WAVE's own folders, the
environment the child inherits (SHRUN-2), the value-to-text table (SHRUN-5), the
working-directory and script-file resolvers (SHRUN-10), the typed export coercion
(PYRUN-6), the start line (SHRUN-12), the outputs a stopped run leaves (SHRUN-7)
and the outcome-to-message judgment. The standard-library half every remote run
shares lives in _local_process_runtime.
"""

import os
import shutil
from collections.abc import Callable, Iterable, Mapping
from decimal import Decimal
from typing import Any

from wavecore.api.services.storage_paths import get_local_process_storage_path
from wavecore.connectivity.block_outputs import block_failure
from wavecore.core.execution.field_checks import name_rule_refusals
from wavecore.core.expressions.errors import NullValueError, null_failure_message
from wavecore.core.table import Table
from wavecore.core.table_values import as_table
from wavecore.core.variables.decimal_value import decimal_to_str, to_wave_decimal
from wavecore.core.variables.print_form import encode_typed_json
from wavecore.plugins._executor_base import validate_enum_param
from wavecore.plugins._file_paths import has_plugin_scheme, plain_path, resolve_plugin_path
from wavecore.plugins._local_process import ProcessOutcome
from wavecore.plugins._local_process_runtime import (
    _NOT_STARTED,
    NAME_PATTERN,
    export_refusal,
    require_existing_dir,
    resolve_program,
    setting,
    stream_values,
)
from wavecore.plugins._shared_params import (
    on_error_parameter,
    output_core,
    stream_output_parameter,
    timeout_parameter,
)
from wavecore.plugins._verb_bridge import log_via

_PATTERN_GATE: dict[str, Any] = {"field": "stop_on_pattern", "values": ["true"]}
_ON_ERROR_DESCRIPTION = "Fail the block, or record the outcome and let the test continue."
_SERVER_LOCUS = "on the WAVE server"
REMOTE_LOCUS = "on the remote host"
_OWN_INTERPRETER = "WAVE's own interpreter"
RESERVED_OUTPUTS = frozenset({"stdout", "stderr", "exit_code", "success", "error", "reason"})
_BAD_EXPORT_NAME = "Invalid script variable name: '{name}'"
HOOK_NEVER_RAN = "Variable exports were not read: the script replaced WAVE's exit handler"
HOOK_NOT_REACHED = "Variable exports were not read: the script did not end after the pattern match"
_PROGRAM_DESCRIPTIONS = {
    "shell": (
        "The shell that runs the {noun}. It may include flags, for example "
        "/bin/bash -o pipefail."
    ),
    "interpreter": (
        "The Python interpreter that runs the {noun}. It may include flags, for example "
        "-X utf8. An empty row runs it under WAVE's own interpreter."
    ),
}
_PLAIN_TYPES: dict[str, tuple[type, ...]] = {
    "string": (str,),
    "integer": (int,),
    "boolean": (bool,),
    "array": (list,),
    "map": (dict,),
}
_REFUSED = object()


def shell_parameter(noun: str, default: str, program_name: str = "shell") -> dict[str, Any]:
    """The Shell row, or the Interpreter row the Python block names its program in."""
    return {
        "name": program_name,
        "type": "string",
        "trim": True,
        "required": False,
        "default": default,
        "description": _PROGRAM_DESCRIPTIONS[program_name].format(noun=noun.lower()),
    }


def environment_parameter(name: str, noun: str) -> dict[str, Any]:
    """The map of values exported into the child's environment."""
    return {
        "name": name,
        "type": "map",
        "required": False,
        "default": {},
        "description": (
            f"Each entry is exported into the {noun.lower()}'s environment. Text, numbers "
            "and booleans arrive as text; arrays, maps and tables as JSON text."
        ),
    }


def shell_environment_parameter(name: str, noun: str) -> dict[str, Any]:
    """A shell block's Input Variables, whose names the save checks as the run does (SHRUN-5)."""
    return {
        **environment_parameter(name, noun),
        "name_rule": {
            "pattern": NAME_PATTERN.pattern,
            "message": "Invalid variable name: '{name}'",
            "blocked_prefixes": [
                {"prefix": "WAVE_", "message": "Variable names may not start with WAVE_: '{name}'"}
            ],
        },
    }


def execution_parameters(noun: str, locus: str = _SERVER_LOCUS) -> list[dict[str, Any]]:
    """Working directory, timeout and Log Output; the locus names where the block runs."""
    what = noun.lower()
    return [
        {
            "name": "working_dir",
            "type": "string",
            "trim": True,
            "required": False,
            "description": (
                f"Where the {what} starts: testdata://, artifact:// or an absolute or relative "
                f"path {locus}. The folder must exist. Empty starts in the system temp folder "
                f"of the machine the {what} runs on."
            ),
        },
        timeout_parameter(300, f"Seconds the {what} may run before WAVE stops it."),
        stream_output_parameter(
            "Write each output line to the run console as it arrives: stdout at INFO, "
            "stderr at WARN."
        ),
    ]


def stop_on_pattern_parameters(noun: str) -> list[dict[str, Any]]:
    """The Stop on pattern switch and its pass / fail pair."""
    what = noun.lower()
    return [
        {
            "name": "stop_on_pattern",
            "type": "boolean",
            "required": False,
            "default": False,
            "description": f"Stop the {what} as soon as a line of its output matches a pattern.",
        },
        {
            "name": "pass_pattern",
            "type": "string",
            "required": False,
            "default": "",
            "show_when": dict(_PATTERN_GATE),
            "description": (
                f"A Python regular expression. A matching line stops the {what} and the "
                "block passes."
            ),
        },
        {
            "name": "fail_pattern",
            "type": "string",
            "required": False,
            "default": "",
            "show_when": dict(_PATTERN_GATE),
            "description": (
                f"A Python regular expression. A matching line stops the {what} and the "
                "block fails."
            ),
        },
    ]


def failure_parameter() -> dict[str, Any]:
    return on_error_parameter(_ON_ERROR_DESCRIPTION)


def stream_outputs(noun: str) -> list[dict[str, Any]]:
    """stdout, stderr and exit_code."""
    what = noun.lower()
    return [
        {
            "name": "stdout",
            "type": "string",
            "description": f"Everything the {what} wrote to standard output.",
        },
        {
            "name": "stderr",
            "type": "string",
            "description": f"Everything the {what} wrote to standard error.",
        },
        {
            "name": "exit_code",
            "type": "integer",
            "description": (
                f"The {what}'s exit code; 137 when WAVE stopped it, -1 when it never "
                "started. A non-zero code is a failure."
            ),
        },
    ]


def local_output_core(noun: str, reasons: str) -> list[dict[str, Any]]:
    """success, error and reason, the last two shown only under Record and continue."""
    return output_core(
        gated=True,
        success_description=(
            f"True when the {noun.lower()} passed. False when it failed and On error is "
            "Record and continue."
        ),
        reason_description=f"Why it failed: {reasons}; empty when it passed.",
    )


def start_line(
    params: Mapping[str, Any],
    noun: str,
    program_name: str,
    default_program: str,
    locus: str = _SERVER_LOCUS,
) -> str:
    """The INFO line a block writes as it starts; a typed script or command is never echoed."""
    program = setting(params, program_name, default_program).strip() or _OWN_INTERPRETER
    in_file_mode = setting(params, "script_type", "source") == "file"
    subject = setting(params, "script_file", "") if in_file_mode else f"the {noun.lower()}"
    return f"Running {subject} under {program} {locus}"


def check_on_error(params: dict[str, Any]) -> None:
    value = params.get("on_error")
    if value is not None:
        validate_enum_param("on_error", value, ["fail", "record"])


def bad_script_variable_name(name: Any) -> ValueError:
    """The refusal for a row that cannot be an export name."""
    return ValueError(_BAD_EXPORT_NAME.replace("{name}", str(name)))


def export_name_rule(pattern: str) -> dict[str, Any]:
    """The Variable Exports name rule the save and the run share (SHRUN-6, PYRUN-6)."""
    return {
        "pattern": pattern,
        "message": _BAD_EXPORT_NAME,
        "reserved_names": sorted(RESERVED_OUTPUTS),
        "reserved_message": "Script variable '{name}' has the name of a block output",
        "repeated_message": "Script variable '{name}' is listed more than once",
    }


def check_script_variables(names: Iterable[Any], rule: Mapping[str, Any]) -> None:
    """The first export the rule refuses fails validation with the message the save reports."""
    refusal = next(name_rule_refusals(rule, names), None)
    if refusal is not None:
        raise ValueError(refusal)


def build_environment(
    context: dict[str, Any], variables: Mapping[str, Any], setting_name: str
) -> dict[str, str]:
    """The server's environment as it stands, WAVE's two folders, then the block's variables."""
    env = dict(os.environ)
    env["WAVE_TESTDATA_DIR"] = (context.get("testdata_dirs") or [""])[0]
    env["WAVE_ARTIFACTS_DIR"] = context.get("artifacts_dir") or ""
    env.update(entry_texts(variables, setting_name))
    return env


def entry_texts(entries: Mapping[str, Any], setting_name: str) -> dict[str, str]:
    """Each named entry as the text the child reads; a null entry fails before anything starts."""
    texts: dict[str, str] = {}
    for key, value in entries.items():
        if value is None:
            raise NullValueError(null_failure_message(setting_name, key=str(key)))
        texts[key] = to_env_text(value)
    return texts


def argument_texts(rows: list[Any], setting_name: str) -> list[str]:
    """Each argument row as text, in row order; a row with no value is an empty argument."""
    texts: list[str] = []
    for number, row in enumerate(rows, start=1):
        if "value" not in row:
            texts.append("")
        elif row["value"] is None:
            raise NullValueError(null_failure_message(setting_name, row=number))
        else:
            texts.append(to_env_text(row["value"]))
    return texts


def to_env_text(value: Any) -> str:
    """One WAVE value as the text the child reads; null has no text."""
    if value is None:
        raise NullValueError("A null value has no text a script can read")
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Decimal):
        return decimal_to_str(value)
    if isinstance(value, list | dict | Table):
        return encode_typed_json(value)
    return str(value)


def _as_declared(value: Any, declared_type: str) -> Any:
    if value is None:
        return None
    if declared_type == "float":
        if isinstance(value, bool) or not isinstance(value, int | float | Decimal):
            return _REFUSED
        return to_wave_decimal(str(value))
    if declared_type == "table":
        table = as_table(value)
        return _REFUSED if table is None else table
    # An unnamed type matches nothing, so it is refused like a value of the wrong shape.
    expected = _PLAIN_TYPES.get(declared_type, ())
    if not isinstance(value, expected) or (isinstance(value, bool) and declared_type != "boolean"):
        return _REFUSED
    return value


def coerce_typed(name: str, value: Any, declared_type: str) -> Any:
    """One script export as the type of the variable it binds to (PYRUN-6); null fits every type."""
    coerced = _as_declared(value, declared_type)
    if coerced is _REFUSED:
        raise ValueError(export_refusal(name, declared_type))
    return coerced


def resolve_shell(
    shell: str, env: Mapping[str, str], cwd: str, program_name: str = "shell"
) -> list[str]:
    """The Shell row as argv, its program named from the working directory as WAVE writes paths."""
    return resolve_program(shell, env, str(plain_path(".", cwd)), program_name)


def resolve_working_dir(path: str, context: dict[str, Any]) -> str:
    """The directory the child starts in, a relative one under the home folder; named as written."""
    try:
        resolved = resolve_plugin_path(
            path,
            context.get("artifacts_dir"),
            context.get("testdata_dirs"),
            read_only_ok=True,
        )
    except FileNotFoundError as exc:
        raise ValueError(f"Working directory not found: {path}") from exc
    return require_existing_dir(str(resolved), path)


def resolve_script_file(path: str, context: Mapping[str, Any], cwd: str) -> str:
    """The script file the block runs; a scheme root names no file."""
    if has_plugin_scheme(path) and path.endswith("://"):
        raise ValueError(f"Path is the root folder: {path}")
    try:
        resolved = resolve_plugin_path(
            path,
            context.get("artifacts_dir"),
            context.get("testdata_dirs"),
            read_only_ok=True,
            base=cwd,
        )
    except FileNotFoundError as exc:
        raise ValueError(f"Script file not found: {path}") from exc
    if not resolved.is_file():
        raise ValueError(f"Script file not found: {path}")
    return str(resolved)


def fail_or_record(
    params: dict[str, Any],
    outputs: dict[str, Any],
    message: str,
    reason: str,
    logger: Any,
    noun: str,
) -> dict[str, Any]:
    """Raise under Fail the block; return the recorded envelope under Record and continue."""
    return block_failure(params, outputs, message, reason, log_via(logger), action=noun)


def not_started(params: dict[str, Any], message: str, logger: Any, noun: str) -> dict[str, Any]:
    """The StartFailed outcome: exit code -1 and nothing captured."""
    return fail_or_record(params, dict(_NOT_STARTED), message, "StartFailed", logger, noun)


def stop_reporter(context: Mapping[str, Any]) -> Callable[[ProcessOutcome], None] | None:
    """Hands the engine Stdout, Stderr and Exit Code of a run a stop cut short, never exports."""
    left = context.get("stop_outputs")
    if left is None:
        return None
    return lambda outcome: left.update(stream_values(outcome))


def sweep_private_dirs() -> None:
    """Clear every leftover under the private process root, creating the root if missing."""
    root = get_local_process_storage_path()
    root.mkdir(parents=True, exist_ok=True)
    for entry in root.iterdir():
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink()
