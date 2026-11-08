"""Python: runs a script under the interpreter the block names (REQ-3.4.1.2)."""

import asyncio
import json
import re
import shutil
import sys
import tempfile
from collections.abc import Mapping
from contextlib import suppress
from decimal import Decimal
from pathlib import Path
from typing import Any, cast

from wavecore.api.services.storage_paths import get_local_process_storage_path
from wavecore.core.expressions.errors import NullValueError
from wavecore.core.table import Table
from wavecore.core.variables.decimal_value import decimal_to_str, to_wave_decimal
from wavecore.plugins._executor_base import validate_enum_param
from wavecore.plugins._local_process import ProcessOutcome, run_local_process
from wavecore.plugins._local_process_common import (
    HOOK_NOT_REACHED,
    argument_texts,
    bad_script_variable_name,
    build_environment,
    check_on_error,
    check_script_variables,
    coerce_typed,
    environment_parameter,
    execution_parameters,
    fail_or_record,
    failure_parameter,
    local_output_core,
    not_started,
    resolve_script_file,
    resolve_shell,
    resolve_working_dir,
    shell_parameter,
    start_line,
    stop_on_pattern_parameters,
    stop_reporter,
    stream_outputs,
)
from wavecore.plugins._local_process_runtime import (
    NAME_PATTERN,
    check_shell,
    compile_patterns,
    export_refusal,
    holds_unsupported,
    judge_outcome,
    launch_spec,
    passed,
    require_setting,
    setting,
    stream_values,
    working_dir_setting,
)
from wavecore.plugins._shared_params import require_positive
from wavecore.plugins.base import PluginBase

NOUN = "Script"
BLOCK_LOCUS = "where the block runs"
TYPE_KEY = "__wave_type"
# The interpreter is handed fd 3 by a shell redirect: the watchdog closes every inherited one.
CHANNEL_REDIRECT = 'exec 3>"$1"\nshift\nexec "$@"\n'
BRIDGE_PATH = str(Path(__file__).with_name("_python_bridge.py"))
_REASONS = "NonZeroExit, Exception, Timeout, FailPattern, StartFailed or OutputVariable"
CHANNEL_POLL = 0.05
# Shell Script's ASCII name that does not start with a double underscore (PYRUN-5, PYRUN-6).
PYTHON_NAME = re.compile(rf"(?!__){NAME_PATTERN.pattern}", re.ASCII)
_LOG_METHODS = {
    "DEBUG": "debug",
    "INFO": "info",
    "WARNING": "warn",
    "ERROR": "error",
    "CRITICAL": "error",
}


def _is_python_name(name: Any) -> bool:
    """A global the script can read and the form can edit."""
    return isinstance(name, str) and PYTHON_NAME.fullmatch(name) is not None


def _check_input_names(params: Mapping[str, Any]) -> None:
    for name in setting(params, "input_vars", {}):
        if not _is_python_name(name):
            raise ValueError(f"Invalid variable name: '{name}'")


def _check_export_shape(params: Mapping[str, Any]) -> None:
    for name in setting(params, "script_variables", []):
        if not isinstance(name, str):
            raise bad_script_variable_name(name)


def _encode(value: Any) -> Any:
    """One WAVE value as the typed envelope the bridge decodes (PYRUN-5)."""
    if isinstance(value, Table):
        return {
            TYPE_KEY: "table",
            "columns": value.col_names(),
            "types": value.col_types(),
            "rows": value.to_dict()["rows"],
        }
    if isinstance(value, Decimal):
        return {TYPE_KEY: "decimal", "value": decimal_to_str(value)}
    if isinstance(value, dict):
        return {key: _encode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_encode(item) for item in value]
    return value


def _decode(value: Any) -> Any:
    """One typed value from the bridge as the WAVE value it stands for (PYRUN-6)."""
    if isinstance(value, dict):
        kind = value.get(TYPE_KEY)
        if kind == "decimal":
            return to_wave_decimal(value["value"])
        if kind == "table":
            columns = [
                {"name": name, "type": item}
                for name, item in zip(value["columns"], value["types"], strict=True)
            ]
            return Table.from_dict({"columns": columns, "rows": value["rows"]})
        return {key: _decode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_decode(item) for item in value]
    return value


def _make_private_dir() -> Path:
    root = get_local_process_storage_path()
    root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="python-", dir=root))


def _interpreter_argv(row: str, env: Mapping[str, str], cwd: str) -> list[str]:
    """The Interpreter row as argv; an empty row is WAVE's own interpreter (PYRUN-3)."""
    if not row.strip():
        return [sys.executable]
    return resolve_shell(row, env, cwd, "interpreter")


def _envelope_text(
    mode: str,
    script_path: str,
    cwd: str,
    params: Mapping[str, Any],
    arguments: list[str],
    names: list[str],
    context: Mapping[str, Any],
) -> str:
    """The file the bridge reads: what to run, with what globals, and what to hand back."""
    types = context.get("output_types") or {}
    return json.dumps(
        {
            "version": 1,
            "mode": mode,
            "script": script_path,
            "working_dir": cwd,
            "argv": arguments,
            "inputs": {
                name: _encode(value) for name, value in setting(params, "input_vars", {}).items()
            },
            "exports": {name: types.get(name, "") for name in names},
        }
    )


def _read_channel(path: str) -> list[dict[str, Any]]:
    """Every message the bridge wrote, in order."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _announced(records: list[dict[str, Any]]) -> bool:
    """True when the program that ran was the bridge under a Python 3.8 or newer."""
    return bool(records) and records[0].get("hello") == "wave-bridge"


def _relay(records: list[dict[str, Any]], logger: Any) -> None:
    """Each logging record at the run-console level its Python level maps to (PYRUN-8)."""
    for record in records:
        level = record.get("log")
        if level is not None:
            getattr(logger, _LOG_METHODS.get(level, "info"))(record.get("message", ""))


class _ChannelFollower:
    """Relays each log record while the script still runs; the rest is read at the end (PYRUN-8)."""

    def __init__(self, path: str, logger: Any) -> None:
        self._path = path
        self._logger = logger
        self._offset = 0
        self._done = asyncio.Event()
        self._taken = 0
        self._task = asyncio.ensure_future(self._follow())

    async def close(self) -> int:
        """Stop following; how many messages the follower took from the channel."""
        self._done.set()
        await self._task
        return self._taken

    async def _follow(self) -> None:
        while not self._done.is_set():
            try:
                self._take()
            except Exception:  # a follower of its own is never the reason a block fails
                return
            with suppress(TimeoutError):
                await asyncio.wait_for(self._done.wait(), CHANNEL_POLL)

    def _take(self) -> None:
        with open(self._path, "rb") as handle:
            handle.seek(self._offset)
            chunk = handle.read()
        *lines, partial = chunk.split(b"\n")
        self._offset += len(chunk) - len(partial)
        for raw in lines:
            text = raw.decode("utf-8", errors="replace")
            if text.strip():
                _relay([json.loads(text)], self._logger)
                self._taken += 1


def _final(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The bridge's last word; None when the script never ended on its own."""
    return next((record for record in reversed(records) if "exports" in record), None)


def _exports_are_read(outcome: ProcessOutcome) -> bool:
    """After a run that ended on its own or a pattern stop; never after a timeout or no start."""
    return outcome.stop in ("pass", "fail") or (outcome.stop is None and outcome.ended_on_own)


def _bound_value(name: str, exported: Any, declared_type: str) -> Any:
    """One export as the type of the variable it binds to; a value JSON could not carry fails."""
    if holds_unsupported(exported):
        raise ValueError(export_refusal(name, declared_type))
    return coerce_typed(name, _decode(exported), declared_type)


def _judged(
    raw: Mapping[str, Any], names: list[str], context: Mapping[str, Any]
) -> tuple[dict[str, Any], str | None]:
    """Each bound export the script set as its declared type; the first failure in list order."""
    bindings = context.get("output_bindings") or {}
    types = context.get("output_types") or {}
    values: dict[str, Any] = {}
    failure: str | None = None
    for name in names:
        if not bindings.get(name) or name not in raw:
            continue
        try:
            values[name] = _bound_value(name, raw[name], types.get(name, ""))
        except ValueError as exc:
            if failure is None:
                failure = str(exc)
    return values, failure


def _convert(
    final: dict[str, Any], names: list[str], context: Mapping[str, Any], logger: Any
) -> tuple[dict[str, Any], str | None]:
    """The bound exports as their declared types, and the first failure in list order."""
    bindings = context.get("output_bindings") or {}
    raw = final.get("exports") or {}
    for name in names:
        if bindings.get(name) and name not in raw:
            logger.debug(
                f"Variable export '{name}' was never set; the bound variable keeps its value"
            )
    return _judged(raw, names, context)


def remote_exports(
    params: Mapping[str, Any], result: dict[str, Any], context: Mapping[str, Any]
) -> tuple[dict[str, Any], str | None]:
    """A remote result with its exports bound as on WAVE, and the failure they add to a pass."""
    names = list(setting(params, "script_variables", []))
    outputs = {key: value for key, value in result.items() if key not in names}
    exports, failure = _judged(result, names, context)
    outputs.update(exports)
    return outputs, failure if outputs.get("success") else None


def _read_exports(
    outcome: ProcessOutcome,
    final: dict[str, Any] | None,
    names: list[str],
    context: Mapping[str, Any],
    logger: Any,
) -> tuple[dict[str, Any], str | None, bool]:
    """The converted exports, the first conversion failure, and whether none were read."""
    if not names or not _exports_are_read(outcome):
        return {}, None, False
    if final is None:
        logger.warn(HOOK_NOT_REACHED)
        return {}, None, True
    exports, failure = _convert(final, names, context, logger)
    return exports, failure, False


def _run_result(
    params: dict[str, Any],
    context: dict[str, Any],
    outcome: ProcessOutcome,
    records: list[dict[str, Any]],
    names: list[str],
    secret_streams: frozenset[str],
    logger: Any,
) -> dict[str, Any]:
    """The block's result once the interpreter ended: its streams, its verdict and its exports."""
    outputs = stream_values(outcome)
    timeout = setting(params, "timeout", 300)
    message, reason = judge_outcome(outcome, NOUN, timeout, secret_streams)
    final = _final(records)
    if final is not None and reason == "NonZeroExit" and final.get("error"):
        message, reason = str(final["error"]), "Exception"
        if "stderr" not in secret_streams:
            logger.error(outcome.stderr)
    exports, failure, amber = _read_exports(outcome, final, names, context, logger)
    outputs.update(exports)
    if message is None and failure is not None:
        message, reason = failure, "OutputVariable"
    if message is not None:
        return fail_or_record(params, outputs, message, cast(str, reason), logger, NOUN)
    result = passed(outputs)
    if amber:
        result["__block_warning"] = True
    return result


class PythonPlugin(PluginBase):
    """Runs a Python script and reads its globals back as the bound variables' types."""

    @property
    def metadata(self) -> dict[str, Any]:
        working_dir, timeout, log_output = execution_parameters(NOUN, BLOCK_LOCUS)
        return {
            "id": "python",
            "name": "Python",
            "version": "1.0.0",
            "category": "system",
            "remotable": True,
            "proxy_support": "unsupported",
            "description": (
                "Runs a Python script on the WAVE server, or on a remote host inside a Remote "
                "Execution body, with arguments, input variables as globals and variable "
                "exports read back as the types of the WAVE variables they bind to."
            ),
            "tags": ["python", "script", "system"],
            "parameters": [
                {
                    "name": "script_type",
                    "type": "string",
                    "required": False,
                    "default": "source",
                    "enum_values": ["source", "file"],
                    "description": (
                        "Source runs the script typed here. File runs a script file from "
                        "Test Data, Artifacts or where the block runs."
                    ),
                },
                {
                    "name": "script",
                    "type": "string",
                    "required": False,
                    "required_when": {"field": "script_type", "values": ["source"]},
                    "description": (
                        "The script to run. It runs under the interpreter named below, "
                        "whatever its first line says."
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
                        "relative path. A testdata:// or artifact:// file is read on WAVE and "
                        "sent with the request, so File mode works on a remote host too."
                    ),
                },
                shell_parameter(NOUN, "", "interpreter"),
                {
                    "name": "arguments",
                    "type": "array",
                    "required": False,
                    "default": [],
                    "description": (
                        "Passed to the script as sys.argv[1:], in row order. An empty row is "
                        "passed as an empty argument."
                    ),
                },
                {
                    "name": "input_vars",
                    "type": "map",
                    "required": False,
                    "default": {},
                    "name_rule": {
                        "pattern": PYTHON_NAME.pattern,
                        "message": "Invalid variable name: '{name}'",
                    },
                    "description": (
                        "Each entry becomes a global of the script before its first line "
                        "runs, as the Python type its WAVE type maps to: a float arrives as "
                        "an exact Decimal, a table as a read-only table object and null as None."
                    ),
                },
                working_dir,
                environment_parameter("environment", NOUN),
                log_output,
                *stop_on_pattern_parameters(NOUN),
                timeout,
                failure_parameter(),
                {
                    "name": "script_variables",
                    "type": "array",
                    "required": False,
                    "default": [],
                    "declares_outputs": True,
                    "name_rule": {
                        "pattern": PYTHON_NAME.pattern,
                        "message": "Invalid script variable name: '{name}'",
                    },
                    "description": (
                        "Globals the script sets, each bound to one WAVE variable and read "
                        "as that variable's type. They are read even when the script raises."
                    ),
                },
            ],
            "return_type": "map",
            "output_schema": [*stream_outputs(NOUN), *local_output_core(NOUN, _REASONS)],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        _check_export_shape(params)
        script_type = params.get("script_type")
        if script_type is not None:
            validate_enum_param("script_type", script_type, ["source", "file"])
        check_on_error(params)
        if setting(params, "script_type", "source") == "source":
            require_setting(params, "script")
        else:
            require_setting(params, "script_file", trim=True)
        check_shell(params, "interpreter")
        require_positive(params, "timeout")
        compile_patterns(params)
        _check_input_names(params)
        check_script_variables(setting(params, "script_variables", []), _is_python_name)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        params = context["parameters"]
        logger = context["logger"]
        logger.info(start_line(params, NOUN, "interpreter", ""))
        patterns = compile_patterns(params)
        names = list(setting(params, "script_variables", []))
        mode = "source" if setting(params, "script_type", "source") == "source" else "file"
        private_dir: Path | None = None
        try:
            start_error: str | None = None
            channel_path = ""
            try:
                env = build_environment(context, setting(params, "environment", {}), "environment")
                arguments = argument_texts(setting(params, "arguments", []), "arguments")
                cwd = resolve_working_dir(working_dir_setting(params), context)
                interpreter = _interpreter_argv(setting(params, "interpreter", ""), env, cwd)
                script_path = (
                    ""
                    if mode == "source"
                    else resolve_script_file(setting(params, "script_file", ""), context, cwd)
                )
                private_dir = _make_private_dir()
                if mode == "source":
                    script_path = str(private_dir / "script.py")
                    Path(script_path).write_text(setting(params, "script", ""), encoding="utf-8")
                channel_path = str(private_dir / "channel")
                Path(channel_path).touch()
                envelope_path = private_dir / "bridge-in.json"
                envelope_path.write_text(
                    _envelope_text(mode, script_path, cwd, params, arguments, names, context),
                    encoding="utf-8",
                )
                env["WAVE_BRIDGE_IN"] = str(envelope_path)
            except OSError as exc:
                start_error = f"Could not start the script: {exc.strerror}"
            except (ValueError, NullValueError) as exc:
                start_error = str(exc)
            if start_error is not None:
                return not_started(params, start_error, logger, NOUN)
            argv = [
                "/bin/sh",
                "-c",
                CHANNEL_REDIRECT,
                "sh",
                channel_path,
                *interpreter,
                BRIDGE_PATH,
                script_path,
                *arguments,
            ]
            spec = launch_spec(params, context, argv, cwd, env, patterns)
            follower = _ChannelFollower(channel_path, logger)
            try:
                outcome = await run_local_process(spec, stop_reporter(context))
            finally:
                taken = await follower.close()
            records = _read_channel(channel_path)
            if outcome.start_error is None and not _announced(records):
                refused = f"Interpreter is not Python 3.8 or newer: {interpreter[0]}"
                return not_started(params, refused, logger, NOUN)
            _relay(records[taken:], logger)
            return _run_result(
                params, context, outcome, records, names, spec.secret_streams, logger
            )
        finally:
            if private_dir is not None:
                shutil.rmtree(private_dir, ignore_errors=True)
