"""Shell Script: runs a script on the WAVE server under the named shell (REQ-3.4.1.1)."""

import shutil
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

from wavecore.api.services.storage_paths import get_local_process_storage_path
from wavecore.core.expressions.errors import NullValueError
from wavecore.plugins._executor_base import validate_enum_param
from wavecore.plugins._local_process import ProcessOutcome, run_local_process
from wavecore.plugins._local_process_common import (
    HOOK_NEVER_RAN,
    HOOK_NOT_REACHED,
    argument_texts,
    bad_script_variable_name,
    build_environment,
    check_on_error,
    check_script_variables,
    execution_parameters,
    export_name_rule,
    fail_or_record,
    failure_parameter,
    local_output_core,
    not_started,
    resolve_script_file,
    resolve_shell,
    resolve_working_dir,
    shell_environment_parameter,
    shell_parameter,
    start_line,
    stop_on_pattern_parameters,
    stop_reporter,
    stream_outputs,
)
from wavecore.plugins._local_process_runtime import (
    NAME_PATTERN,
    check_environment_names,
    check_map_shape,
    check_shell,
    compile_patterns,
    judge_outcome,
    launch_spec,
    passed,
    require_setting,
    setting,
    stream_values,
    working_dir_setting,
)
from wavecore.plugins._shared_params import require_positive
from wavecore.plugins._shell_capture import (
    Captured,
    CaptureError,
    build_preamble,
    coerce,
    hook_ran,
    parse_capture,
)
from wavecore.plugins.base import PluginBase

NOUN = "Script"
DEFAULT_SHELL = "/bin/bash"
_REASONS = "NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable"
_EXPORT_NAME_RULE = export_name_rule(NAME_PATTERN.pattern)


def _list_rows(params: Mapping[str, Any], name: str) -> list[Any]:
    """A list parameter's rows; none when it is absent."""
    value = params.get(name)
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"Parameter '{name}' must be a list")
    return value


def _check_shapes(params: Mapping[str, Any]) -> None:
    check_map_shape(params, "input_vars")
    for index, row in enumerate(_list_rows(params, "arguments")):
        if not isinstance(row, dict):
            raise ValueError(f"Parameter 'arguments' row {index} must be a map")
    for name in _list_rows(params, "script_variables"):
        if not isinstance(name, str):
            raise bad_script_variable_name(name)


def _make_private_dir() -> Path:
    root = get_local_process_storage_path()
    root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="shell-script-", dir=root))


def _read_capture(path: str) -> bytes:
    try:
        return Path(path).read_bytes()
    except FileNotFoundError:
        return b""


def _exports_are_read(outcome: ProcessOutcome) -> bool:
    """After a run that ended on its own or a pattern stop; never after a timeout or no start."""
    return outcome.stop in ("pass", "fail") or (outcome.stop is None and outcome.ended_on_own)


def _convert(
    captured: dict[str, Captured], names: list[str], context: Mapping[str, Any], logger: Any
) -> tuple[dict[str, Any], str | None]:
    """The bound exports as their declared types, and the first failure in list order."""
    bindings = context.get("output_bindings") or {}
    types = context.get("output_types") or {}
    values: dict[str, Any] = {}
    failure: str | None = None
    for name in names:
        if not bindings.get(name):
            continue
        entry = captured[name]
        if entry.kind == "u":
            logger.debug(
                f"Variable export '{name}' was never set; the bound variable keeps its value"
            )
            continue
        try:
            values[name] = coerce(name, entry, types.get(name))
        except CaptureError as exc:
            if failure is None:
                failure = str(exc)
    return values, failure


def _read_exports(
    outcome: ProcessOutcome,
    capture_path: str,
    names: list[str],
    context: Mapping[str, Any],
    logger: Any,
) -> tuple[dict[str, Any], str | None, bool]:
    """The converted exports, the first conversion failure, and whether the hook never wrote."""
    if not names or not _exports_are_read(outcome):
        return {}, None, False
    data = _read_capture(capture_path)
    if hook_ran(data):
        exports, failure = _convert(parse_capture(data), names, context, logger)
        return exports, failure, False
    logger.warn(HOOK_NEVER_RAN if outcome.ended_on_own else HOOK_NOT_REACHED)
    return {}, None, True


class ShellScriptPlugin(PluginBase):
    """Runs a script under the named shell and reads its exports as the bound variables' types."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "shell-script",
            "name": "Shell Script",
            "version": "1.0.0",
            "category": "system",
            "proxy_support": "unsupported",
            "description": (
                "Runs a shell script on the WAVE server under the shell named in its Shell "
                "row, with arguments, input variables and variable exports read back as the "
                "types of the WAVE variables they bind to."
            ),
            "tags": ["shell", "script", "bash", "system"],
            "parameters": [
                {
                    "name": "script_type",
                    "type": "string",
                    "required": False,
                    "default": "source",
                    "enum_values": ["source", "file"],
                    "description": (
                        "Source runs the script typed here. File runs a script file from "
                        "Test Data, Artifacts or the WAVE server."
                    ),
                },
                shell_parameter(NOUN, DEFAULT_SHELL),
                {
                    "name": "script",
                    "type": "string",
                    "required": False,
                    "required_when": {"field": "script_type", "values": ["source"]},
                    "description": (
                        "The script to run. It runs under the shell named above, whatever "
                        "its first line says."
                    ),
                },
                {
                    "name": "script_file",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "script_type", "values": ["file"]},
                    "description": (
                        "The script file to run: testdata://, artifact:// or an absolute or "
                        "relative path on the WAVE server. It runs under the shell named "
                        "above, whatever its first line says."
                    ),
                },
                {
                    "name": "arguments",
                    "type": "array",
                    "required": False,
                    "default": [],
                    "description": (
                        "Passed to the script as $1, $2 and on, in row order. An empty row "
                        "is passed as an empty argument."
                    ),
                },
                shell_environment_parameter("input_vars", NOUN),
                {
                    "name": "script_variables",
                    "type": "array",
                    "required": False,
                    "default": [],
                    "declares_outputs": True,
                    "name_rule": _EXPORT_NAME_RULE,
                    "description": (
                        "Shell variables the script sets, each bound to one WAVE variable "
                        "and read as that variable's type."
                    ),
                },
                *execution_parameters(NOUN),
                *stop_on_pattern_parameters(NOUN),
                failure_parameter(),
            ],
            "return_type": "map",
            "output_schema": [*stream_outputs(NOUN), *local_output_core(NOUN, _REASONS)],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        _check_shapes(params)
        script_type = params.get("script_type")
        if script_type is not None:
            validate_enum_param("script_type", script_type, ["source", "file"])
        check_on_error(params)
        if setting(params, "script_type", "source") == "source":
            require_setting(params, "script")
        else:
            require_setting(params, "script_file", trim=True)
        check_shell(params)
        require_positive(params, "timeout")
        check_environment_names(params, "input_vars")
        check_script_variables(setting(params, "script_variables", []), _EXPORT_NAME_RULE)
        compile_patterns(params)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        params = context["parameters"]
        logger = context["logger"]
        logger.info(start_line(params, NOUN, "shell", DEFAULT_SHELL))
        patterns = compile_patterns(params)
        names = list(setting(params, "script_variables", []))
        source_mode = setting(params, "script_type", "source") == "source"
        private_dir: Path | None = None
        try:
            start_error: str | None = None
            capture_path = ""
            try:
                env = build_environment(context, setting(params, "input_vars", {}), "input_vars")
                arguments = argument_texts(setting(params, "arguments", []), "arguments")
                cwd = resolve_working_dir(working_dir_setting(params), context)
                shell_argv = resolve_shell(setting(params, "shell", DEFAULT_SHELL), env, cwd)
                script_path = (
                    ""
                    if source_mode
                    else resolve_script_file(setting(params, "script_file", ""), context, cwd)
                )
                if source_mode or names:
                    private_dir = _make_private_dir()
                    capture_path = str(private_dir / "capture")
                    if source_mode:
                        script_path = str(private_dir / "script.sh")
                        Path(script_path).write_text(
                            setting(params, "script", ""), encoding="utf-8"
                        )
            except OSError as exc:
                start_error = f"Could not start the script: {exc.strerror}"
            except (ValueError, NullValueError) as exc:
                start_error = str(exc)
            if start_error is not None:
                return not_started(params, start_error, logger, NOUN)
            argv = [
                *shell_argv,
                "-c",
                build_preamble(names, capture_path),
                script_path,
                *arguments,
            ]
            spec = launch_spec(params, context, argv, cwd, env, patterns)
            outcome = await run_local_process(spec, stop_reporter(context))
            outputs = stream_values(outcome)
            timeout = setting(params, "timeout", 300)
            message, reason = judge_outcome(outcome, NOUN, timeout, spec.secret_streams)
            exports, failure, amber = _read_exports(outcome, capture_path, names, context, logger)
            outputs.update(exports)
            if message is None and failure is not None:
                message, reason = failure, "OutputVariable"
            if message is not None:
                return fail_or_record(params, outputs, message, cast(str, reason), logger, NOUN)
            result = passed(outputs)
            if amber:
                result["__block_warning"] = True
            return result
        finally:
            if private_dir is not None:
                shutil.rmtree(private_dir, ignore_errors=True)
