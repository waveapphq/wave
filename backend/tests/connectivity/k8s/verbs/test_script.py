"""K8s Script verb tests (REQ-5.1.1, REQ-3.4.1.5).

script.run is the sync core behind the K8s Script block: it resolves the pod
container from the session, starts an interpreter there bare, feeds the script
body to it on standard input, and hands back the wire envelope carrying the two
streams and the exit code. Standard input needs the v5 subprotocol, so a cluster
below 1.30 refuses the run as a recordable block failure. A non-zero exit code is
data; session, transport and timeout failures always raise.
"""

import inspect
import json
from typing import Any

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    NAMESPACE,
    SERVER,
    FakeExecChannel,
    RecordingLog,
    block_params,
    exact,
    patch_exec,
    session_value,
)
from wavecore.connectivity.k8s.verbs import script
from wavecore.connectivity.k8s.ws import (
    ExecRejected,
    ExecTimeout,
    ExecTransportError,
    ExecVersionUnsupported,
)
from wavecore.plugins.k8s_script import K8sScriptPlugin

POD = "web-1"
CONTAINER = "app"
SCRIPT = "set -e\necho hello\nexit 0\n"
DEFAULT_INTERPRETER = "/bin/sh"
TIMEOUT_DEFAULT = 60

_DECLARED_OUTPUTS = {"stdout", "stderr", "exit_code", "success", "error", "reason"}
_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_UNCLOSED_QUOTE = "Parameter 'interpreter' has an unclosed quote"
_UNSUPPORTED_VERSION = (
    "K8s Script needs Kubernetes 1.30 or newer. Use K8s Copy and K8s Exec on older clusters."
)
_NOT_FOUND = 'pods "web-1" not found'

_BOTH_MODES = pytest.mark.parametrize("mode", ["fail", "record"])
_NOT_RECORD = pytest.mark.parametrize("on_error", ["Record", "RECORD", "ignore", True, None])


def _valid_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"pod": POD, "container": CONTAINER, "script": SCRIPT}
    params.update(overrides)
    return block_params(**params)


def _channel(*results: Any) -> FakeExecChannel:
    return FakeExecChannel(results=list(results))


def _run(channel: FakeExecChannel, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    with patch_exec(channel):
        envelope: dict[str, Any] = script.run(params, log if log is not None else RecordingLog())
    return envelope


def _outputs(channel: FakeExecChannel, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    outputs: dict[str, Any] = _run(channel, params, log)["outputs"]
    return outputs


def _declared(name: str) -> Any:
    """The default the plugin shell declares for one parameter."""
    return {p["name"]: p for p in K8sScriptPlugin().metadata["parameters"]}[name]["default"]


def _row(
    detail: str, pod: str = POD, container: str = CONTAINER, namespace: str = NAMESPACE
) -> str:
    """The script failure row: every one of them names the pod, container and namespace."""
    return (
        f"Could not run the script in pod '{pod}' (container '{container}') "
        f"in namespace '{namespace}': {detail}"
    )


class TestVerbShape:
    """run is a plain sync function returning the JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(script.run) is False

    def test_run_is_a_plain_module_level_function(self) -> None:
        assert inspect.isfunction(script.run) is True

    def test_run_takes_the_parameters_and_the_log_callable(self) -> None:
        assert list(inspect.signature(script.run).parameters) == ["params", "log"]

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(_channel(("", "", 0)), _valid_params())

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_the_outputs_are_a_mapping(self) -> None:
        envelope = _run(_channel(("", "", 0)), _valid_params())

        assert isinstance(envelope["outputs"], dict)

    def test_a_happy_run_carries_no_secrets(self) -> None:
        envelope = _run(_channel(("out", "", 0)), _valid_params())

        assert envelope["secrets"] == []

    def test_a_recorded_refusal_carries_no_secrets(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))

        envelope = _run(channel, _valid_params(on_error="record"))

        assert envelope["secrets"] == []

    def test_a_recorded_version_refusal_carries_no_secrets(self) -> None:
        envelope = _run(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"))

        assert envelope["secrets"] == []

    def test_a_success_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(_channel(("out\n", "err\n", 0)), _valid_params())

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_refusal_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))

        envelope = _run(channel, _valid_params(on_error="record"))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_version_refusal_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_neither_the_session_nor_the_script_body_reaches_the_secrets(self) -> None:
        envelope = _run(_channel(("out", "", 0)), _valid_params())

        rendered = json.dumps(envelope)
        assert envelope["secrets"] == []
        assert session_value() not in rendered
        assert "sa-tok" not in rendered


class TestInterpreterHandling:
    """The interpreter is one string split shell-style and invoked bare, never with -c."""

    def test_no_interpreter_row_falls_back_to_the_default_shell(self) -> None:
        channel = _channel(("", "", 0))
        params = _valid_params()

        _run(channel, params)

        assert "interpreter" not in params
        assert channel.last.command == [DEFAULT_INTERPRETER]

    def test_an_empty_interpreter_falls_back_to_the_default_shell(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(interpreter=""))

        assert channel.last.command == [DEFAULT_INTERPRETER]

    def test_a_none_interpreter_falls_back_to_the_default_shell(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(interpreter=None))

        assert channel.last.command == [DEFAULT_INTERPRETER]

    def test_a_whitespace_only_interpreter_reaches_the_seam_as_an_empty_argument_list(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(interpreter="   "))

        assert channel.last.command == []

    def test_an_interpreter_with_flags_becomes_one_argument_per_word(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(interpreter="python3 -u"))

        assert channel.last.command == ["python3", "-u"]

    def test_a_quoted_interpreter_path_stays_one_argument(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(interpreter='"/opt/my bin/sh"'))

        assert channel.last.command == ["/opt/my bin/sh"]

    def test_a_named_interpreter_is_invoked_bare_with_no_dash_c(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(interpreter="bash"))

        assert channel.last.command == ["bash"]

    def test_the_default_shell_is_invoked_bare_with_no_dash_c(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert "-c" not in channel.last.command

    def test_the_script_body_never_reaches_the_argument_list(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert SCRIPT not in channel.last.command

    def test_spaces_around_the_interpreter_create_no_empty_arguments(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(interpreter="  bash  "))

        assert channel.last.command == ["bash"]

    def test_an_unclosed_quote_in_the_interpreter_is_refused_inside_the_verb(self) -> None:
        channel = _channel()

        with pytest.raises(ValueError, match=exact(_UNCLOSED_QUOTE)) as excinfo:
            _run(channel, _valid_params(interpreter='sh "x'))

        assert "'command'" not in str(excinfo.value)
        assert channel.calls == []

    def test_the_declared_interpreter_default_and_the_runtime_fallback_agree(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert channel.last.command == [_declared("interpreter")]


class TestScriptOnStandardInput:
    """The script body is the stdin payload the exec channel carries, byte for byte."""

    def test_the_script_body_is_the_stdin_payload(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert channel.last.stdin == SCRIPT

    def test_a_trailing_newline_in_the_body_is_preserved(self) -> None:
        body = "echo one\necho two\n"
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(script=body))

        assert channel.last.stdin == body

    def test_a_body_with_no_trailing_newline_is_not_padded(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(script="echo one"))

        assert channel.last.stdin == "echo one"

    def test_leading_and_trailing_whitespace_in_the_body_survives(self) -> None:
        body = "\n  echo indented\n\n"
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(script=body))

        assert channel.last.stdin == body

    def test_standard_input_is_opened_under_every_on_error_mode(self) -> None:
        channel = _channel(("", "", 0), ("", "", 0))

        _run(channel, _valid_params(on_error="fail"))
        _run(channel, _valid_params(on_error="record"))

        assert [call.stdin for call in channel.calls] == [SCRIPT, SCRIPT]

    def test_a_body_with_a_nul_and_non_ascii_characters_passes_through_unchanged(self) -> None:
        body = "echo \x00 café 你好\n"
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(script=body))

        assert channel.last.stdin == body

    def test_the_stdin_payload_is_text_never_bytes(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert isinstance(channel.last.stdin, str)

    def test_a_body_that_is_not_a_string_is_coerced_before_it_reaches_the_seam(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(script=42))

        assert channel.last.stdin == "42"

    def test_a_version_refusal_still_asked_the_channel_for_standard_input(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        _run(channel, _valid_params(on_error="record"))

        assert channel.last.stdin == SCRIPT


class TestExecCall:
    """What reaches the exec seam: target, argv, stdin, timeout and impersonation."""

    def test_the_channel_is_reached_through_the_ws_module_attribute(self) -> None:
        """Patching ws.exec_in_pod must intercept, so the verb may not bind the name early."""
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert len(channel.calls) == 1
        assert channel.factory.call_count == 1

    def test_the_pod_reaches_the_seam_stripped(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(pod="  api-7  "))

        assert channel.last.pod == "api-7"

    def test_the_container_reaches_the_seam_stripped(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(container="  sidecar  "))

        assert channel.last.container == "sidecar"

    def test_the_session_namespace_is_used_when_no_namespace_row_is_set(self) -> None:
        channel = _channel(("", "", 0))
        params = _valid_params()

        _run(channel, params)

        assert "namespace" not in params
        assert channel.last.namespace == NAMESPACE

    def test_a_namespace_row_targets_that_namespace(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(namespace="ops"))

        assert channel.last.namespace == "ops"

    def test_a_blank_namespace_row_falls_back_to_the_session_namespace(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(namespace="   "))

        assert channel.last.namespace == NAMESPACE

    def test_a_padded_namespace_row_is_stripped(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(namespace="  ops  "))

        assert channel.last.namespace == "ops"

    def test_a_stray_all_namespaces_tick_is_ignored(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(all_namespaces=True))

        assert channel.last.namespace == NAMESPACE

    def test_the_context_comes_from_the_session(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert channel.last.context.server == SERVER
        assert channel.last.context.namespace == NAMESPACE
        assert channel.last.context.token == "sa-tok"

    def test_the_default_timeout_of_sixty_reaches_the_seam(self) -> None:
        channel = _channel(("", "", 0))
        params = _valid_params()

        _run(channel, params)

        assert "timeout" not in params
        assert channel.last.timeout == TIMEOUT_DEFAULT

    def test_an_explicit_timeout_reaches_the_seam(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(timeout=45))

        assert channel.last.timeout == 45

    def test_the_declared_timeout_default_and_the_runtime_fallback_agree(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert channel.last.timeout == _declared("timeout")

    def test_impersonation_reaches_the_seam_as_keyword_arguments(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(impersonate_user="qa-bot", impersonate_groups="dev, ops, "))

        assert channel.factory.call_args.kwargs["impersonate_user"] == "qa-bot"
        assert channel.factory.call_args.kwargs["impersonate_groups"] == ["dev", "ops"]

    def test_no_impersonation_leaves_both_keywords_unset(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert channel.last.impersonate_user is None
        assert channel.last.impersonate_groups is None

    def test_the_exec_channel_carries_no_output_ceiling(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert channel.last.max_output_bytes is None
        assert "max_output_bytes" not in channel.factory.call_args.kwargs

    def test_one_exec_is_the_whole_round_trip(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params())

        assert len(channel.calls) == 1

    def test_the_seam_is_called_with_the_seven_positional_arguments_in_order(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(timeout=45))

        args = channel.factory.call_args.args
        assert len(args) == 7
        assert args[0] is channel.last.context
        assert args[1:] == (NAMESPACE, POD, CONTAINER, [DEFAULT_INTERPRETER], SCRIPT, 45)


class TestSuccessOutputs:
    """The three streams the block owns, then success, error and reason."""

    def test_a_happy_run_returns_exactly_the_declared_outputs(self) -> None:
        outputs = _outputs(_channel(("out", "err", 0)), _valid_params())

        assert set(outputs) == _DECLARED_OUTPUTS

    def test_stdout_and_stderr_come_back_verbatim(self) -> None:
        outputs = _outputs(_channel(("hello\n", "warning: none\n", 0)), _valid_params())

        assert outputs["stdout"] == "hello\n"
        assert outputs["stderr"] == "warning: none\n"

    def test_empty_streams_come_back_as_empty_text(self) -> None:
        outputs = _outputs(_channel(("", "", 0)), _valid_params())

        assert outputs["stdout"] == ""
        assert outputs["stderr"] == ""

    def test_a_zero_exit_code_is_a_success(self) -> None:
        outputs = _outputs(_channel(("", "", 0)), _valid_params())

        assert outputs["exit_code"] == 0
        assert outputs["success"] is True

    def test_a_non_zero_exit_code_comes_back_as_data(self) -> None:
        outputs = _outputs(_channel(("", "failed", 1)), _valid_params())

        assert outputs["exit_code"] == 1
        assert outputs["success"] is True
        assert outputs["error"] == ""
        assert outputs["reason"] == ""

    def test_a_non_zero_exit_code_still_carries_both_streams(self) -> None:
        outputs = _outputs(_channel(("partial\n", "failed", 1)), _valid_params())

        assert outputs["stdout"] == "partial\n"
        assert outputs["stderr"] == "failed"

    def test_a_non_zero_exit_code_asks_for_no_warning_and_writes_no_warn_line(self) -> None:
        log = RecordingLog()

        outputs = _outputs(_channel(("", "", 1)), _valid_params(), log)

        assert "__block_warning" not in outputs
        assert [level for level, _message in log.entries] == ["INFO"]

    def test_the_success_line_names_the_pod_and_the_exit_code(self) -> None:
        log = RecordingLog()

        _run(_channel(("", "", 3)), _valid_params(pod="api-7"), log)

        assert log.entries == [("INFO", "Ran the script in pod 'api-7': exit code 3")]

    def test_a_success_writes_exactly_one_line(self) -> None:
        log = RecordingLog()

        _run(_channel(("out", "err", 0)), _valid_params(), log)

        assert len(log.entries) == 1


class TestVersionRefusal:
    """A cluster below 1.30 offers no v5, so the standard-input run is refused, recordably."""

    def test_the_default_mode_raises_the_approved_refusal_copy(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        with pytest.raises(ValueError, match=exact(_UNSUPPORTED_VERSION)):
            _run(channel, _valid_params())

    def test_fail_mode_raises_the_approved_refusal_copy(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        with pytest.raises(ValueError, match=exact(_UNSUPPORTED_VERSION)):
            _run(channel, _valid_params(on_error="fail"))

    def test_record_mode_records_the_approved_refusal_copy(self) -> None:
        outputs = _outputs(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"))

        assert outputs["error"] == _UNSUPPORTED_VERSION

    def test_the_refusal_names_no_pod_no_container_and_no_namespace(self) -> None:
        params = _valid_params(pod="api-7", container="sidecar", namespace="ops", on_error="record")

        outputs = _outputs(_channel(ExecVersionUnsupported()), params)

        assert "api-7" not in outputs["error"]
        assert "sidecar" not in outputs["error"]
        assert "ops" not in outputs["error"]

    def test_the_refusal_records_the_wave_authored_reason(self) -> None:
        outputs = _outputs(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"))

        assert outputs["reason"] == "UnsupportedVersion"
        assert outputs["success"] is False

    def test_the_refusal_leaves_the_streams_at_their_empty_defaults(self) -> None:
        outputs = _outputs(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"))

        assert outputs["stdout"] == ""
        assert outputs["stderr"] == ""
        assert outputs["exit_code"] == 0

    def test_the_refusal_returns_the_declared_outputs_plus_the_warning_signal(self) -> None:
        outputs = _outputs(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"))

        assert set(outputs) == _DECLARED_OUTPUTS | {"__block_warning"}
        assert outputs["__block_warning"] is True

    def test_the_refusal_writes_the_script_shaped_warn_line(self) -> None:
        log = RecordingLog()

        _run(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"), log)

        assert log.entries == [
            ("WARN", f"Script failed (UnsupportedVersion): {_UNSUPPORTED_VERSION}")
        ]

    def test_the_channels_own_refusal_text_is_never_used(self) -> None:
        channel = _channel(ExecVersionUnsupported("some other text"))

        outputs = _outputs(channel, _valid_params(on_error="record"))

        assert outputs["error"] == _UNSUPPORTED_VERSION
        assert "some other text" not in outputs["error"]

    def test_a_version_refusal_never_renders_as_a_cluster_rejection_row(self) -> None:
        outputs = _outputs(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"))

        assert "Could not run the script" not in outputs["error"]


class TestClusterRefusal:
    """A cluster-reported refusal carries the shared core and honors Failure Handling."""

    def test_the_default_mode_raises_the_refusal_row(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))
        params = _valid_params()

        with pytest.raises(ValueError, match=exact(_row(_NOT_FOUND))):
            _run(channel, params)

        assert "on_error" not in params

    def test_fail_mode_raises_the_refusal_row(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))

        with pytest.raises(ValueError, match=exact(_row(_NOT_FOUND))):
            _run(channel, _valid_params(on_error="fail"))

    def test_record_mode_returns_the_failed_core(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))

        outputs = _outputs(channel, _valid_params(on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == _row(_NOT_FOUND)
        assert outputs["reason"] == "NotFound"

    def test_a_recorded_refusal_leaves_the_streams_empty_beside_the_warning_signal(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))

        outputs = _outputs(channel, _valid_params(on_error="record"))

        assert outputs["stdout"] == ""
        assert outputs["stderr"] == ""
        assert outputs["exit_code"] == 0
        assert set(outputs) == _DECLARED_OUTPUTS | {"__block_warning"}
        assert outputs["__block_warning"] is True

    def test_a_recorded_refusal_writes_one_warn_line(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))
        log = RecordingLog()

        _run(channel, _valid_params(on_error="record"), log)

        assert log.entries == [("WARN", f"Script failed (NotFound): {_row(_NOT_FOUND)}")]

    def test_a_refusal_without_a_reason_records_an_empty_reason(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, None))
        log = RecordingLog()

        outputs = _outputs(channel, _valid_params(on_error="record"), log)

        assert outputs["reason"] == ""
        assert log.entries == [("WARN", f"Script failed: {_row(_NOT_FOUND)}")]

    def test_the_refusal_row_names_the_container_the_namespace_and_the_pod_selected(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))
        params = _valid_params(pod="api-7", container="sidecar", namespace="ops")

        outputs = _outputs(channel, {**params, "on_error": "record"})

        assert outputs["error"] == _row(
            _NOT_FOUND, pod="api-7", container="sidecar", namespace="ops"
        )

    @_NOT_RECORD
    def test_any_on_error_value_other_than_record_raises(self, on_error: Any) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))

        with pytest.raises(ValueError, match=exact(_row(_NOT_FOUND))):
            _run(channel, _valid_params(on_error=on_error))

    def test_fail_mode_writes_no_warn_line(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))
        log = RecordingLog()

        with pytest.raises(ValueError, match=exact(_row(_NOT_FOUND))):
            _run(channel, _valid_params(on_error="fail"), log)

        assert log.entries == []


class TestAlwaysHardFail:
    """Session, transport and timeout failures raise under both Failure Handling modes."""

    @_BOTH_MODES
    def test_a_bogus_session_raises_before_any_exec_call(self, mode: str) -> None:
        channel = _channel()

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(channel, _valid_params(session="not-a-kubeconfig", on_error=mode))

        assert channel.calls == []

    @_BOTH_MODES
    def test_a_missing_session_raises_before_any_exec_call(self, mode: str) -> None:
        channel = _channel()
        params = _valid_params(on_error=mode)
        params.pop("session")

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(channel, params)

        assert channel.calls == []

    @_BOTH_MODES
    def test_a_transport_failure_raises_in_both_modes(self, mode: str) -> None:
        detail = "Kubernetes exec channel closed before the command finished"
        channel = _channel(ExecTransportError(detail))

        with pytest.raises(ValueError, match=exact(_row(detail))):
            _run(channel, _valid_params(on_error=mode))

    def test_the_transport_row_names_the_container_the_row_selected(self) -> None:
        detail = "Kubernetes refused the exec channel upgrade (HTTP 403)"
        channel = _channel(ExecTransportError(detail))

        with pytest.raises(ValueError, match=exact(_row(detail, container="sidecar"))):
            _run(channel, _valid_params(container="sidecar"))

    @_BOTH_MODES
    def test_a_transport_failure_writes_no_warn_line(self, mode: str) -> None:
        channel = _channel(ExecTransportError("boom"))
        log = RecordingLog()

        with pytest.raises(ValueError, match=exact(_row("boom"))):
            _run(channel, _valid_params(on_error=mode), log)

        assert log.entries == []

    @_BOTH_MODES
    def test_a_timeout_raises_in_both_modes(self, mode: str) -> None:
        channel = _channel(ExecTimeout("Kubernetes exec channel timed out after 60 seconds"))
        message = f"Script execution timed out after {TIMEOUT_DEFAULT} seconds"

        with pytest.raises(ValueError, match=exact(message)):
            _run(channel, _valid_params(on_error=mode))

    def test_the_timeout_row_is_script_shaped_whatever_the_channel_said(self) -> None:
        channel = _channel(ExecTimeout("Command execution timed out after 45 seconds"))

        with pytest.raises(ValueError, match=exact("Script execution timed out after 45 seconds")):
            _run(channel, _valid_params(timeout=45))

    def test_the_timeout_row_names_the_configured_timeout_not_the_channel_number(self) -> None:
        channel = _channel(ExecTimeout("Kubernetes exec channel timed out after 9 seconds"))

        with pytest.raises(ValueError, match=exact("Script execution timed out after 45 seconds")):
            _run(channel, _valid_params(timeout=45))

    def test_the_timeout_row_falls_back_to_sixty_when_no_timeout_is_set(self) -> None:
        channel = _channel(ExecTimeout("Kubernetes exec channel timed out after 9 seconds"))
        params = _valid_params()

        with pytest.raises(ValueError, match=exact("Script execution timed out after 60 seconds")):
            _run(channel, params)

        assert "timeout" not in params

    @_BOTH_MODES
    def test_a_timeout_writes_no_warn_line(self, mode: str) -> None:
        channel = _channel(ExecTimeout("timed out"))
        log = RecordingLog()

        with pytest.raises(ValueError):
            _run(channel, _valid_params(on_error=mode), log)

        assert log.entries == []

    def test_the_session_is_parsed_before_the_interpreter_is_split(self) -> None:
        channel = _channel()
        params = _valid_params(session="not-a-kubeconfig", interpreter='sh "x')

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(channel, params)

        assert channel.calls == []


class TestEdgeCases:
    """The verb reads the row the engine sent it, uncoerced and unvalidated."""

    def test_a_missing_script_raises_a_key_error(self) -> None:
        channel = _channel()
        params = _valid_params()
        params.pop("script")

        with pytest.raises(KeyError):
            _run(channel, params)

        assert channel.calls == []

    def test_a_timeout_given_as_text_passes_through_uncoerced(self) -> None:
        channel = _channel(("", "", 0))

        _run(channel, _valid_params(timeout="45"))

        assert channel.last.timeout == "45"

    def test_a_quoted_container_name_survives_into_the_failure_row_unescaped(self) -> None:
        channel = _channel(ExecRejected(_NOT_FOUND, "NotFound"))

        outputs = _outputs(channel, _valid_params(container="si'de car", on_error="record"))

        assert outputs["error"] == _row(_NOT_FOUND, container="si'de car")


class TestLogging:
    """The verb writes through the log callable only, at upper-case levels."""

    def test_no_log_line_carries_the_session_the_token_or_the_script_body(self) -> None:
        log = RecordingLog()

        _run(_channel(("out", "err", 0)), _valid_params(), log)

        joined = " ".join(log.messages)
        assert session_value() not in joined
        assert "sa-tok" not in joined
        assert SCRIPT not in joined

    def test_the_levels_the_verb_writes_are_upper_case(self) -> None:
        success = RecordingLog()
        recorded = RecordingLog()

        _run(_channel(("", "", 0)), _valid_params(), success)
        _run(_channel(ExecVersionUnsupported()), _valid_params(on_error="record"), recorded)

        assert [level for level, _message in success.entries + recorded.entries] == ["INFO", "WARN"]

    def test_the_verb_module_holds_no_logger_of_its_own(self) -> None:
        assert not {"logger", "logging", "LOGGER"} & set(vars(script))
