"""Shell Exec: runs one command line on the WAVE server through the named shell (REQ-3.4.1.18)."""

from typing import Any, cast

from wavecore.core.expressions.errors import NullValueError
from wavecore.plugins._local_process import run_local_process
from wavecore.plugins._local_process_common import (
    build_environment,
    check_on_error,
    environment_parameter,
    execution_parameters,
    fail_or_record,
    failure_parameter,
    local_output_core,
    not_started,
    resolve_shell,
    resolve_working_dir,
    shell_parameter,
    start_line,
    stop_on_pattern_parameters,
    stream_outputs,
)
from wavecore.plugins._local_process_runtime import (
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
from wavecore.plugins.base import PluginBase

NOUN = "Command"
DEFAULT_SHELL = "/bin/sh"
_REASONS = "NonZeroExit, Timeout, FailPattern or StartFailed"


class ShellExecPlugin(PluginBase):
    """Runs one command line as <shell> -c <command> on the WAVE server."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "shell-exec",
            "name": "Shell Exec",
            "version": "1.0.0",
            "category": "system",
            "proxy_support": "unsupported",
            "description": (
                "Runs one command line on the WAVE server through the shell named in its "
                "Shell row, so pipes, redirects, globs and && work as they do at a prompt."
            ),
            "tags": ["shell", "command", "exec", "system"],
            "parameters": [
                {
                    "name": "command",
                    "type": "string",
                    "required": True,
                    "description": (
                        "One command line, run as <shell> -c <command>, so pipes, redirects, "
                        "globs and && work. For example kubectl get pods -A | grep -c Running."
                    ),
                },
                shell_parameter(NOUN, DEFAULT_SHELL),
                environment_parameter("env_vars", NOUN),
                *execution_parameters(NOUN),
                *stop_on_pattern_parameters(NOUN),
                failure_parameter(),
            ],
            "return_type": "map",
            "output_schema": [*stream_outputs(NOUN), *local_output_core(NOUN, _REASONS)],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        check_map_shape(params, "env_vars")
        check_on_error(params)
        require_setting(params, "command")
        check_shell(params)
        require_positive(params, "timeout")
        check_environment_names(params, "env_vars")
        compile_patterns(params)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        params = context["parameters"]
        logger = context["logger"]
        logger.info(start_line(params, NOUN, "shell", DEFAULT_SHELL))
        patterns = compile_patterns(params)
        try:
            env = build_environment(context, setting(params, "env_vars", {}), "env_vars")
            cwd = resolve_working_dir(working_dir_setting(params), context)
            shell_argv = resolve_shell(setting(params, "shell", DEFAULT_SHELL), env, cwd)
        except (ValueError, NullValueError) as exc:
            return not_started(params, str(exc), logger, NOUN)
        argv = [*shell_argv, "-c", setting(params, "command", "")]
        spec = launch_spec(params, context, argv, cwd, env, patterns)
        outcome = await run_local_process(spec)
        outputs = stream_values(outcome)
        timeout = setting(params, "timeout", 300)
        message, reason = judge_outcome(outcome, NOUN, timeout, spec.secret_streams)
        if message is not None:
            return fail_or_record(params, outputs, message, cast(str, reason), logger, NOUN)
        return passed(outputs)
