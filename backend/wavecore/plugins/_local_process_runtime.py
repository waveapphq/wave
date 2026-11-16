"""The standard-library half of the local-process core (REQ-3.4.1.1, PYRUN-12).

Vendored verbatim into the Remote Execution bundle, so nothing here imports from
wavecore beyond _local_process, _process_group, _user_patterns and _plural, and no
WAVE Table or Decimal value ever reaches it: the WAVE half renders those before the
call.
"""

import os
import re
import shlex
import shutil
import tempfile
from collections.abc import Mapping
from typing import Any

from wavecore.plugins._local_process import LaunchSpec, ProcessOutcome, match_message
from wavecore.plugins._plural import plural
from wavecore.plugins._user_patterns import compile_user_pattern

FAIL_MATCH = "Output matched the fail pattern"
NAME_PATTERN = re.compile(r"[A-Za-z_]\w*", re.ASCII)
STREAMS = frozenset({"stdout", "stderr"})
_NOT_STARTED: dict[str, Any] = {"stdout": "", "stderr": "", "exit_code": -1}
# The bundle's worker sets this to "on the remote host" before it runs a block there.
LOCUS = "on the WAVE server"
# The Python bridge writes a value JSON cannot carry as {"__wave_type": "unsupported"}.
_TYPE_KEY = "__wave_type"
_UNSUPPORTED = "unsupported"

Patterns = tuple[re.Pattern[str] | None, re.Pattern[str] | None]


def setting(params: Mapping[str, Any], name: str, default: Any) -> Any:
    """A present setting as it is; one given nothing (absent or a literal None) as its default."""
    value = params.get(name)
    return default if value is None else value


def check_map_shape(params: Mapping[str, Any], name: str) -> None:
    value = params.get(name)
    if value is not None and not isinstance(value, dict):
        raise ValueError(
            f"Parameter '{name}' must be a map (dictionary), got {type(value).__name__}"
        )


def check_shell(params: Mapping[str, Any], program_name: str = "shell") -> None:
    """A named shell may not be blank; a blank interpreter row is WAVE's own (PYRUN-3)."""
    if program_name == "interpreter":
        return
    value = params.get(program_name)
    if value is not None and not value.strip():
        raise ValueError(f"Parameter '{program_name}' cannot be empty")


def require_setting(params: Mapping[str, Any], name: str, *, trim: bool = False) -> None:
    """Absent, None or empty is missing; whitespace counts as a value unless trimmed."""
    value = params.get(name) or ""
    if not (value.strip() if trim else value):
        raise ValueError(f"Missing required parameter: {name}")


def check_environment_names(params: dict[str, Any], name: str) -> None:
    """Every key is a shell identifier and none starts with WAVE_, in entry order."""
    for key in params.get(name) or {}:
        if not NAME_PATTERN.fullmatch(key):
            raise ValueError(f"Invalid variable name: '{key}'")
        if key.startswith("WAVE_"):
            raise ValueError(f"Variable names may not start with WAVE_: '{key}'")


def working_dir_setting(params: Mapping[str, Any]) -> str:
    """The working directory as written; a blank or absent one is this machine's temp folder."""
    value = params.get("working_dir")
    return value if value and value.strip() else tempfile.gettempdir()


def _compile_pattern(row: str, text: str) -> re.Pattern[str] | None:
    if not text:
        return None
    try:
        return compile_user_pattern(text)
    except ValueError as exc:
        raise ValueError(f"Invalid {row} pattern: {exc}") from exc


def compile_patterns(
    params: dict[str, Any],
) -> tuple[re.Pattern[str] | None, re.Pattern[str] | None]:
    """The (pass, fail) patterns while Stop on pattern is on; (None, None) while it is off."""
    if not params.get("stop_on_pattern"):
        return None, None
    pass_text = params.get("pass_pattern") or ""
    fail_text = params.get("fail_pattern") or ""
    if not pass_text and not fail_text:
        raise ValueError("Set a pass pattern, a fail pattern or both")
    return _compile_pattern("pass", pass_text), _compile_pattern("fail", fail_text)


def resolve_program(
    row: str, env: Mapping[str, str], cwd: str, program_name: str = "shell"
) -> list[str]:
    """The Shell or Interpreter row split into argv, a path program starting from cwd."""
    try:
        argv = shlex.split(row)
    except ValueError:
        argv = []
    program = argv[0] if argv else ""
    if "/" in program:
        path = os.path.abspath(os.path.join(cwd, program))
        found = path if os.path.exists(path) and os.access(path, os.X_OK) else None
    else:
        found = shutil.which(program, path=env.get("PATH"))
    if found is None:
        raise ValueError(f"{program_name.capitalize()} not found {LOCUS}: {program or row}")
    return [found, *argv[1:]]


def require_existing_dir(path: str, named: str = "") -> str:
    """The working directory as it will be used; a missing one is named as the author wrote it."""
    if not os.path.isdir(path):
        raise ValueError(f"Working directory not found: {named or path}")
    return path


def launch_spec(
    params: Mapping[str, Any],
    context: Mapping[str, Any],
    argv: list[str],
    cwd: str,
    env: dict[str, str],
    patterns: Patterns,
) -> LaunchSpec:
    return LaunchSpec(
        argv=argv,
        cwd=cwd,
        env=env,
        timeout=setting(params, "timeout", 300),
        stream_output=bool(setting(params, "stream_output", False)),
        secret_streams=STREAMS.intersection(context.get("output_secret_fields") or []),
        pass_re=patterns[0],
        fail_re=patterns[1],
        logger=context["logger"],
    )


def last_line(text: str) -> str:
    """The last line of the text that holds more than whitespace, trimmed; empty when none does."""
    return next((line.strip() for line in reversed(text.splitlines()) if line.strip()), "")


def judge_outcome(
    outcome: ProcessOutcome, noun: str, timeout: int, secret_streams: frozenset[str]
) -> tuple[str | None, str | None]:
    """(message, reason) for a run that failed; (None, None) for one that passed."""
    if outcome.start_error is not None:
        return f"Could not start the {noun.lower()}: {outcome.start_error}", "StartFailed"
    if outcome.stop == "timeout":
        return f"{noun} timed out after {plural(timeout, 'second', 'seconds')}", "Timeout"
    if outcome.stop == "fail":
        message = match_message(
            FAIL_MATCH, outcome.match_line, outcome.match_stream, secret_streams
        )
        return message, "FailPattern"
    if outcome.stop is None and outcome.exit_code != 0:
        exited = f"{noun} exited with code {outcome.exit_code}"
        why = last_line(outcome.stderr)
        message = match_message(exited, why, "stderr", secret_streams) if why else exited
        return message, "NonZeroExit"
    return None, None


def stream_values(outcome: ProcessOutcome) -> dict[str, Any]:
    return {"stdout": outcome.stdout, "stderr": outcome.stderr, "exit_code": outcome.exit_code}


def passed(outputs: dict[str, Any]) -> dict[str, Any]:
    return {**outputs, "success": True, "error": "", "reason": ""}


def export_refusal(name: str, declared_type: str) -> str:
    """The failure of an export that does not fit the type of the variable it binds to."""
    return f"Script variable '{name}' is not a valid {declared_type}"


def holds_unsupported(value: Any) -> bool:
    """True when the bridge marked the value, or one inside it, as a value JSON cannot carry."""
    if isinstance(value, dict):
        if value.get(_TYPE_KEY) == _UNSUPPORTED:
            return True
        return any(holds_unsupported(item) for item in value.values())
    if isinstance(value, list):
        return any(holds_unsupported(item) for item in value)
    return False
