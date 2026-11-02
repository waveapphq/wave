"""K8s Script plugin tests (REQ-5.1.1, REQ-3.4.1.5).

Script runs an interpreter in a pod container and feeds it the script body on
standard input, exactly as SSH Session Script does. The interpreter is one String
split shell-style so it may carry flags, and it is invoked bare - never with -c.
Standard input needs the v5 subprotocol, so a cluster below 1.30 is an ordinary
block failure carrying Error and Reason. There is no working-directory row.
A non-zero exit code is data, not a failure. Error and Reason are gated on Record
and continue; Success never is.

The exec seam is a plain sync callable: exec_in_pod is synchronous and the block
reaches it through a thread offload, so an async stub would never run.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    SERVER,
    FakeExecChannel,
    block_params,
    exact,
    execute_context,
    patch_exec,
    required_conditions,
)
from wavecore.connectivity.k8s.ws import (
    ExecRejected,
    ExecTimeout,
    ExecTransportError,
    ExecVersionUnsupported,
)
from wavecore.plugins.k8s_script import K8sScriptPlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "pod",
    "container",
    "interpreter",
    "script",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["stdout", "stderr", "exit_code", "success", "error", "reason"]

RECORD_GATE = {"field": "on_error", "values": ["record"]}
TIMEOUT_DEFAULT = 60
DEFAULT_INTERPRETER = "/bin/sh"
POD = "web-1"
CONTAINER = "app"
SCRIPT = "set -e\necho hello\nexit 0\n"

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_EMPTY_INTERPRETER = "Parameter 'interpreter' cannot be empty"
_UNCLOSED_QUOTE = "Parameter 'interpreter' has an unclosed quote"
_UNSUPPORTED_VERSION = (
    "K8s Script needs Kubernetes 1.30 or newer. Use K8s Copy and K8s Exec on older clusters."
)

_VERB_DESCRIPTIONS = {
    "pod": "The pod to run the script in.",
    "container": "Which container in the pod to use. Name it even when the pod has only one.",
    "interpreter": (
        "The interpreter that runs the script. Anything that reads a program on "
        "standard input: /bin/sh, bash, python3, perl, node. May include flags."
    ),
    "script": "The script to run. It is fed to the interpreter on standard input.",
}

_VERB_OUTPUT_DESCRIPTIONS = {
    "stdout": "Everything the command wrote to standard output.",
    "stderr": "Everything the command wrote to standard error.",
    "exit_code": (
        "The exit code the command returned. A non-zero code is returned as data, "
        "not treated as a failure."
    ),
}

_CORE_DESCRIPTIONS = {
    "success": (
        "True when the cluster carried out the operation without error; false when "
        "On error is Record and continue and the cluster refused it"
    ),
    "error": (
        "The error message when the operation failed under Record and continue; empty otherwise"
    ),
    "reason": (
        "The cluster reason for the failure, like NotFound or Forbidden; empty when the "
        "operation succeeded"
    ),
}

_BOTH_MODES = pytest.mark.parametrize("mode", ["fail", "record"])


def _params_by_name(plugin: K8sScriptPlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


def _outputs_by_name(plugin: K8sScriptPlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _valid_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"pod": POD, "container": CONTAINER, "script": SCRIPT}
    params.update(overrides)
    return block_params(**params)


def _channel(*results: Any) -> FakeExecChannel:
    return FakeExecChannel(results=list(results))


async def _execute(channel: FakeExecChannel, params: dict[str, Any], logger: Any = None) -> Any:
    with patch_exec(channel):
        return await K8sScriptPlugin().execute(execute_context(params, logger=logger))


def _transport(
    detail: str,
    container: str = CONTAINER,
    namespace: str = NAMESPACE,
    pod: str = POD,
) -> str:
    """The 4.2 transport row; every one of them names the container it targeted."""
    clause = f" (container '{container}')"
    return f"Could not run the script in pod '{pod}'{clause} in namespace '{namespace}': {detail}"


class TestMetadata:
    """Plugin identity, the ten parameters, and the six declared outputs."""

    def test_plugin_instantiates(self) -> None:
        assert K8sScriptPlugin() is not None

    def test_identity(self) -> None:
        meta = K8sScriptPlugin().metadata

        assert meta["id"] == "k8s-script"
        assert meta["name"] == "K8s Script"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "kubernetes"
        assert meta["return_type"] == "map"

    def test_the_display_name_is_byte_identical_to_the_frontend_string(self) -> None:
        assert K8sScriptPlugin().metadata["name"] == "K8s Script"

    def test_authorship_and_tags(self) -> None:
        meta = K8sScriptPlugin().metadata

        assert meta["author"] == "WAVE Framework"
        assert meta["tags"][:2] == ["kubernetes", "k8s"]

    def test_the_block_carries_a_description(self) -> None:
        assert K8sScriptPlugin().metadata["description"]

    def test_remotable_is_true(self) -> None:
        assert K8sScriptPlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sScriptPlugin().metadata["proxy_support"] == "supported"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sScriptPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_parameter_list_is_exactly_ten_rows(self) -> None:
        assert len(K8sScriptPlugin().metadata["parameters"]) == 10

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["pod"]["type"] == "string"
        assert params["container"]["type"] == "string"
        assert params["interpreter"]["type"] == "string"
        assert params["script"]["type"] == "string"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sScriptPlugin())
        required = [name for name in EXPECTED_PARAM_ORDER if params[name].get("required")]

        assert required == ["session", "pod", "container", "script"]

    def test_the_rest_declare_required_false(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        for name in EXPECTED_PARAM_ORDER:
            if name in ("session", "pod", "container", "script"):
                continue
            assert params[name].get("required") is False

    def test_defaults(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        assert params["timeout"]["default"] == TIMEOUT_DEFAULT
        assert params["interpreter"]["default"] == DEFAULT_INTERPRETER
        assert params["on_error"]["default"] == "fail"

    def test_the_pod_container_and_script_rows_carry_no_default(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        for name in ("pod", "container", "script"):
            assert "default" not in params[name]

    def test_only_the_session_parameter_is_secret(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_the_identifier_rows_declare_trim(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        for name in (
            "session",
            "pod",
            "container",
            "interpreter",
            "namespace",
            "impersonate_user",
            "impersonate_groups",
        ):
            assert params[name]["trim"] is True

    def test_the_script_body_is_never_trimmed(self) -> None:
        assert _params_by_name(K8sScriptPlugin())["script"].get("trim") is not True

    def test_enum_values(self) -> None:
        assert _params_by_name(K8sScriptPlugin())["on_error"]["enum_values"] == ["fail", "record"]

    def test_only_the_failure_handling_row_is_an_enum(self) -> None:
        params = _params_by_name(K8sScriptPlugin())
        enum_params = {name for name, param in params.items() if "enum_values" in param}

        assert enum_params == {"on_error"}

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sScriptPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_the_script_group_descriptions_are_the_approved_copy(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        assert {
            name: params[name]["description"] for name in _VERB_DESCRIPTIONS
        } == _VERB_DESCRIPTIONS

    def test_the_timeout_description_declares_the_blocks_own_default(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        assert params["timeout"]["description"] == "Request timeout in seconds. Default: 60."

    def test_output_schema(self) -> None:
        outputs = K8sScriptPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("stdout", "string"),
            ("stderr", "string"),
            ("exit_code", "integer"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_the_output_list_is_exactly_six_rows(self) -> None:
        assert len(K8sScriptPlugin().metadata["output_schema"]) == 6

    def test_no_output_is_flagged_secret(self) -> None:
        for output in K8sScriptPlugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sScriptPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_the_verb_output_descriptions_match_the_exec_block(self) -> None:
        outputs = _outputs_by_name(K8sScriptPlugin())

        assert {
            name: outputs[name]["description"] for name in _VERB_OUTPUT_DESCRIPTIONS
        } == _VERB_OUTPUT_DESCRIPTIONS

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name(K8sScriptPlugin())

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS

    def test_no_output_declares_type_rules(self) -> None:
        for output in K8sScriptPlugin().metadata["output_schema"]:
            assert "type_when" not in output


class TestDeliberateAbsences:
    """The rows the sheet deliberately does not carry."""

    def test_no_working_directory_row_is_declared(self) -> None:
        assert "working_dir" not in _params_by_name(K8sScriptPlugin())

    def test_no_row_carries_a_working_directory_under_any_name(self) -> None:
        names = [p["name"] for p in K8sScriptPlugin().metadata["parameters"]]

        assert [name for name in names if "dir" in name or "cwd" in name or "chdir" in name] == []

    def test_no_command_row_is_declared(self) -> None:
        assert "command" not in _params_by_name(K8sScriptPlugin())

    def test_no_stdin_row_is_declared(self) -> None:
        assert "stdin" not in _params_by_name(K8sScriptPlugin())

    def test_the_block_declares_no_all_namespaces_row(self) -> None:
        assert "all_namespaces" not in _params_by_name(K8sScriptPlugin())

    def test_the_connection_timeout_is_the_only_integer_row(self) -> None:
        params = _params_by_name(K8sScriptPlugin())
        integers = [name for name in EXPECTED_PARAM_ORDER if params[name]["type"] == "integer"]

        assert integers == ["timeout"]

    def test_no_row_is_conditionally_required(self) -> None:
        params = _params_by_name(K8sScriptPlugin())

        for name in EXPECTED_PARAM_ORDER:
            assert required_conditions(params[name]) == []

    def test_the_declared_output_names_are_exactly_the_six(self) -> None:
        names = [o["name"] for o in K8sScriptPlugin().metadata["output_schema"]]

        assert names == EXPECTED_OUTPUT_ORDER


class TestValidation:
    """validate() - session, impersonation, the enum, the required rows and the timeout."""

    async def test_minimal_params_pass(self) -> None:
        await K8sScriptPlugin().validate(_valid_params())

    async def test_full_params_pass(self) -> None:
        await K8sScriptPlugin().validate(
            _valid_params(
                timeout=45,
                container=CONTAINER,
                interpreter="python3 -u",
                namespace="ops",
                impersonate_user="qa-bot",
                impersonate_groups="dev, ops",
                on_error="record",
            )
        )

    async def test_missing_session(self) -> None:
        params = {"pod": POD, "script": SCRIPT}

        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sScriptPlugin().validate(params)

    async def test_empty_session_reports_the_empty_case(self) -> None:
        params = {"session": "", "pod": POD, "script": SCRIPT}

        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sScriptPlugin().validate(params)

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sScriptPlugin().validate(_valid_params(impersonate_groups="qa, ops"))

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sScriptPlugin().validate(
            _valid_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )

    async def test_invalid_on_error_is_rejected(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sScriptPlugin().validate(_valid_params(on_error="ignore"))

    async def test_missing_pod_is_rejected(self) -> None:
        params = _valid_params()
        del params["pod"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: pod$"):
            await K8sScriptPlugin().validate(params)

    async def test_empty_pod_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: pod$"):
            await K8sScriptPlugin().validate(_valid_params(pod=""))

    async def test_missing_container_is_rejected(self) -> None:
        params = _valid_params()
        del params["container"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: container$"):
            await K8sScriptPlugin().validate(params)

    async def test_empty_container_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: container$"):
            await K8sScriptPlugin().validate(_valid_params(container=""))

    async def test_missing_script_is_rejected(self) -> None:
        params = _valid_params()
        del params["script"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: script$"):
            await K8sScriptPlugin().validate(params)

    async def test_empty_script_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: script$"):
            await K8sScriptPlugin().validate(_valid_params(script=""))

    async def test_a_namespace_row_is_optional(self) -> None:
        await K8sScriptPlugin().validate(_valid_params(namespace=""))

    async def test_zero_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sScriptPlugin().validate(_valid_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sScriptPlugin().validate(_valid_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sScriptPlugin().validate(_valid_params(timeout=45))


class TestInterpreterSplitting:
    """The interpreter is one String split shell-style and sent as the command, bare."""

    def test_the_interpreter_row_is_a_string_not_an_array(self) -> None:
        assert _params_by_name(K8sScriptPlugin())["interpreter"]["type"] == "string"

    async def test_an_empty_interpreter_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(_EMPTY_INTERPRETER)):
            await K8sScriptPlugin().validate(_valid_params(interpreter=""))

    async def test_a_whitespace_only_interpreter_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(_EMPTY_INTERPRETER)):
            await K8sScriptPlugin().validate(_valid_params(interpreter="   "))

    async def test_an_unclosed_double_quote_in_the_interpreter_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(_UNCLOSED_QUOTE)):
            await K8sScriptPlugin().validate(_valid_params(interpreter='"/opt/my bin/sh'))

    async def test_an_unclosed_single_quote_in_the_interpreter_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(_UNCLOSED_QUOTE)):
            await K8sScriptPlugin().validate(_valid_params(interpreter="'/opt/my bin/sh"))

    async def test_the_unclosed_quote_message_names_the_interpreter_not_the_command(self) -> None:
        with pytest.raises(ValueError, match=exact(_UNCLOSED_QUOTE)) as excinfo:
            await K8sScriptPlugin().validate(_valid_params(interpreter='sh "x'))

        assert "'command'" not in str(excinfo.value)

    async def test_no_interpreter_row_falls_back_to_the_default_shell(self) -> None:
        channel = _channel(("", "", 0))
        params = _valid_params()

        await _execute(channel, params)

        assert "interpreter" not in params
        assert channel.last.command == [DEFAULT_INTERPRETER]

    async def test_an_interpreter_with_flags_becomes_one_argument_per_word(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(interpreter="python3 -u"))

        assert channel.last.command == ["python3", "-u"]

    async def test_a_quoted_interpreter_path_stays_one_argument(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(interpreter='"/opt/my bin/sh"'))

        assert channel.last.command == ["/opt/my bin/sh"]

    async def test_the_interpreter_is_invoked_bare_with_no_dash_c(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(interpreter="bash"))

        assert channel.last.command == ["bash"]
        assert "-c" not in channel.last.command

    async def test_the_default_shell_is_invoked_bare_with_no_dash_c(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params())

        assert "-c" not in channel.last.command

    async def test_the_script_body_never_reaches_the_argument_list(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params())

        assert SCRIPT not in channel.last.command


class TestScriptOnStandardInput:
    """The script body is written to the stdin channel, which is then closed (v5)."""

    async def test_the_script_body_is_the_stdin_payload(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params())

        assert channel.last.stdin == SCRIPT

    async def test_the_body_is_carried_verbatim_including_its_trailing_newline(self) -> None:
        body = "echo one\necho two\n"
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(script=body))

        assert channel.last.stdin == body

    async def test_a_body_with_no_trailing_newline_is_not_padded(self) -> None:
        body = "echo one"
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(script=body))

        assert channel.last.stdin == "echo one"

    async def test_leading_and_trailing_whitespace_in_the_body_survives(self) -> None:
        body = "\n  echo indented\n\n"
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(script=body))

        assert channel.last.stdin == body

    async def test_stdin_is_opened_on_every_run(self) -> None:
        channel = _channel(("", "", 0), ("", "", 0))

        await _execute(channel, _valid_params(on_error="fail"))
        await _execute(channel, _valid_params(on_error="record"))

        assert [call.stdin for call in channel.calls] == [SCRIPT, SCRIPT]

    async def test_one_exec_is_the_whole_round_trip(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params())

        assert len(channel.calls) == 1


class TestExecCall:
    """What reaches the exec seam: pod, container, namespace, timeout and impersonation."""

    async def test_the_pod_reaches_the_seam(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(pod="api-7"))

        assert channel.last.pod == "api-7"

    async def test_a_container_reaches_the_seam(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(container=CONTAINER))

        assert channel.last.container == CONTAINER

    async def test_the_session_namespace_is_used_when_no_namespace_row_is_set(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params())

        assert channel.last.namespace == NAMESPACE

    async def test_a_namespace_row_targets_that_namespace(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(namespace="ops"))

        assert channel.last.namespace == "ops"

    async def test_the_context_comes_from_the_session(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params())

        assert channel.last.context.server == SERVER
        assert channel.last.context.namespace == NAMESPACE
        assert channel.last.context.token == "sa-tok"

    async def test_the_default_timeout_of_sixty_reaches_the_seam(self) -> None:
        channel = _channel(("", "", 0))
        params = _valid_params()

        await _execute(channel, params)

        assert "timeout" not in params
        assert channel.last.timeout == TIMEOUT_DEFAULT

    async def test_an_explicit_timeout_reaches_the_seam(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(timeout=45))

        assert channel.last.timeout == 45

    async def test_impersonation_rows_reach_the_seam(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(
            channel, _valid_params(impersonate_user="qa-bot", impersonate_groups="dev, ops")
        )

        assert channel.last.impersonate_user == "qa-bot"
        assert channel.last.impersonate_groups == ["dev", "ops"]

    async def test_impersonation_reaches_the_seam_as_keyword_arguments(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params(impersonate_user="qa-bot"))

        assert channel.factory.call_args.kwargs["impersonate_user"] == "qa-bot"

    async def test_no_impersonation_is_the_default(self) -> None:
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params())

        assert channel.last.impersonate_user is None
        assert channel.last.impersonate_groups is None

    async def test_the_exec_channel_carries_no_output_ceiling(self) -> None:
        """K8s Script reads the channel unbounded; only K8s Copy caps it."""
        channel = _channel(("", "", 0))

        await _execute(channel, _valid_params())

        assert channel.last.max_output_bytes is None


class TestOutputCore:
    """The three streams the block owns, then success, error and reason."""

    async def test_a_happy_run_returns_exactly_the_declared_outputs(self) -> None:
        channel = _channel(("out", "err", 0))

        result = await _execute(channel, _valid_params())

        assert set(result) == {"stdout", "stderr", "exit_code", "success", "error", "reason"}

    async def test_stdout_and_stderr_come_back_verbatim(self) -> None:
        channel = _channel(("hello\n", "warning: none\n", 0))

        result = await _execute(channel, _valid_params())

        assert result["stdout"] == "hello\n"
        assert result["stderr"] == "warning: none\n"

    async def test_a_zero_exit_code_is_a_success(self) -> None:
        channel = _channel(("", "", 0))

        result = await _execute(channel, _valid_params())

        assert result["exit_code"] == 0
        assert result["success"] is True

    async def test_a_non_zero_exit_code_comes_back_as_data(self) -> None:
        channel = _channel(("", "Traceback\n", 1))

        result = await _execute(channel, _valid_params(interpreter="python3"))

        assert result["exit_code"] == 1
        assert result["success"] is True

    async def test_a_non_zero_exit_code_still_carries_the_streams(self) -> None:
        channel = _channel(("partial\n", "boom\n", 127))

        result = await _execute(channel, _valid_params())

        assert result["stdout"] == "partial\n"
        assert result["stderr"] == "boom\n"

    async def test_a_non_zero_exit_code_leaves_error_and_reason_empty(self) -> None:
        channel = _channel(("", "boom\n", 1))

        result = await _execute(channel, _valid_params())

        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_a_non_zero_exit_code_asks_for_no_warning(self) -> None:
        channel = _channel(("", "boom\n", 1))
        logger = MagicMock()

        result = await _execute(channel, _valid_params(on_error="record"), logger)

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0

    async def test_empty_streams_come_back_as_empty_strings(self) -> None:
        channel = _channel(("", "", 0))

        result = await _execute(channel, _valid_params())

        assert result["stdout"] == ""
        assert result["stderr"] == ""


class TestErrorReasonGate:
    """Error and Reason are offered only under Record and continue."""

    def test_error_and_reason_declare_the_record_gate(self) -> None:
        outputs = _outputs_by_name(K8sScriptPlugin())

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE

    def test_success_is_never_gated(self) -> None:
        assert "show_when" not in _outputs_by_name(K8sScriptPlugin())["success"]

    def test_the_stream_outputs_are_never_gated(self) -> None:
        outputs = _outputs_by_name(K8sScriptPlugin())

        for name in ("stdout", "stderr", "exit_code"):
            assert "show_when" not in outputs[name]

    def test_only_error_and_reason_are_gated(self) -> None:
        outputs = _outputs_by_name(K8sScriptPlugin())
        gated = [name for name in EXPECTED_OUTPUT_ORDER if "show_when" in outputs[name]]

        assert gated == ["error", "reason"]

    async def test_fail_mode_raises_out_of_the_block(self) -> None:
        channel = _channel(ExecRejected('pods "web-1" not found', "NotFound"))

        with pytest.raises(ValueError, match=exact(_transport('pods "web-1" not found'))):
            await _execute(channel, _valid_params())

    async def test_fail_mode_binds_no_value_for_error_or_reason(self) -> None:
        channel = _channel(ExecRejected('pods "web-1" not found', "NotFound"))
        result: Any = None

        with pytest.raises(ValueError):
            result = await _execute(channel, _valid_params(on_error="fail"))

        assert result is None

    async def test_record_mode_returns_normally_with_all_three_filled(self) -> None:
        channel = _channel(ExecRejected('pods "web-1" not found', "NotFound"))

        result = await _execute(channel, _valid_params(on_error="record"))

        assert result["success"] is False
        assert result["error"] == _transport('pods "web-1" not found')
        assert result["reason"] == "NotFound"

    async def test_fail_is_the_default_on_error_mode(self) -> None:
        channel = _channel(ExecRejected("denied", "Forbidden"))
        params = _valid_params()

        assert "on_error" not in params
        with pytest.raises(ValueError, match=exact(_transport("denied"))):
            await _execute(channel, params)


class TestVersionRefusal:
    """A cluster below 1.30 offers no v5, so the stdin path is refused and recordable."""

    async def test_the_refusal_message_is_the_approved_copy(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        with pytest.raises(
            ValueError,
            match=r"^K8s Script needs Kubernetes 1\.30 or newer\. "
            r"Use K8s Copy and K8s Exec on older clusters\.$",
        ):
            await _execute(channel, _valid_params())

    async def test_the_refusal_message_is_anchored_verbatim(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        with pytest.raises(ValueError, match=exact(_UNSUPPORTED_VERSION)):
            await _execute(channel, _valid_params())

    async def test_the_refusal_names_no_pod_or_namespace(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        result = await _execute(channel, _valid_params(on_error="record"))

        assert result["error"] == _UNSUPPORTED_VERSION

    async def test_the_refusal_records_the_unsupported_version_reason(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        result = await _execute(channel, _valid_params(on_error="record"))

        assert result["success"] is False
        assert result["reason"] == "UnsupportedVersion"

    async def test_the_refusal_leaves_the_streams_at_their_empty_defaults(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        result = await _execute(channel, _valid_params(on_error="record"))

        assert result["stdout"] == ""
        assert result["stderr"] == ""
        assert result["exit_code"] == 0

    async def test_the_refusal_carries_the_warning_signal(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        result = await _execute(channel, _valid_params(on_error="record"))

        assert result["__block_warning"] is True

    async def test_the_refusal_logs_the_script_shaped_warn_line(self) -> None:
        channel = _channel(ExecVersionUnsupported())
        logger = MagicMock()

        await _execute(channel, _valid_params(on_error="record"), logger)

        logger.warn.assert_called_once_with(
            f"Script failed (UnsupportedVersion): {_UNSUPPORTED_VERSION}"
        )

    async def test_the_refusal_still_asked_the_channel_for_stdin(self) -> None:
        channel = _channel(ExecVersionUnsupported())

        await _execute(channel, _valid_params(on_error="record"))

        assert channel.last.stdin == SCRIPT


class TestFailureHandling:
    """A cluster-reported exec failure reads as a script, and a recorded one asks for amber."""

    async def test_a_cluster_refusal_names_the_pod_the_container_and_the_namespace(self) -> None:
        channel = _channel(ExecRejected('pods "web-1" not found', "NotFound"))
        message = (
            f"Could not run the script in pod '{POD}' (container '{CONTAINER}') "
            f"in namespace '{NAMESPACE}': "
            'pods "web-1" not found'
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(channel, _valid_params())

    async def test_the_message_names_the_container_the_row_selected(self) -> None:
        channel = _channel(ExecRejected("denied", "Forbidden"))

        result = await _execute(
            channel, _valid_params(container="sidecar", on_error="record"), None
        )

        assert result["error"] == (
            f"Could not run the script in pod '{POD}' (container 'sidecar') "
            f"in namespace '{NAMESPACE}': denied"
        )

    async def test_the_message_names_the_namespace_the_row_selected(self) -> None:
        channel = _channel(ExecRejected("denied", "Forbidden"))

        result = await _execute(channel, _valid_params(namespace="ops", on_error="record"))

        assert result["error"] == _transport("denied", namespace="ops")

    async def test_a_recorded_refusal_leaves_the_streams_at_their_empty_defaults(self) -> None:
        channel = _channel(ExecRejected("denied", "Forbidden"))

        result = await _execute(channel, _valid_params(on_error="record"))

        assert result["stdout"] == ""
        assert result["stderr"] == ""
        assert result["exit_code"] == 0

    async def test_a_recorded_refusal_returns_the_declared_outputs_plus_the_warning(self) -> None:
        channel = _channel(ExecRejected("denied", "Forbidden"))

        result = await _execute(channel, _valid_params(on_error="record"))

        assert set(result) == {
            "stdout",
            "stderr",
            "exit_code",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    async def test_a_recorded_refusal_carries_the_warning_signal(self) -> None:
        channel = _channel(ExecRejected("denied", "Forbidden"))

        result = await _execute(channel, _valid_params(on_error="record"))

        assert result["__block_warning"] is True

    async def test_a_recorded_refusal_logs_the_script_shaped_warn_line(self) -> None:
        channel = _channel(ExecRejected("denied", "Forbidden"))
        logger = MagicMock()

        await _execute(channel, _valid_params(on_error="record"), logger)

        logger.warn.assert_called_once_with(f"Script failed (Forbidden): {_transport('denied')}")

    async def test_a_refusal_with_no_reason_records_an_empty_reason(self) -> None:
        channel = _channel(ExecRejected("the cluster closed the channel", None))

        result = await _execute(channel, _valid_params(on_error="record"))

        assert result["reason"] == ""

    async def test_a_happy_run_logs_info_and_asks_for_nothing(self) -> None:
        channel = _channel(("out", "", 0))
        logger = MagicMock()

        result = await _execute(channel, _valid_params(on_error="record"), logger)

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0
        assert logger.info.call_count == 1

    async def test_fail_mode_logs_no_warn_line(self) -> None:
        channel = _channel(ExecRejected("denied", "Forbidden"))
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(channel, _valid_params(), logger)

        assert logger.warn.call_count == 0


class TestAlwaysHardFail:
    """Session, transport, timeout and invalid-parameter failures raise in both modes."""

    @_BOTH_MODES
    async def test_a_bogus_session_raises(self, mode: str) -> None:
        params = _valid_params(on_error=mode)
        params["session"] = "not-a-kubeconfig"
        channel = _channel(("", "", 0))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            await _execute(channel, params)

    @_BOTH_MODES
    async def test_a_missing_session_raises(self, mode: str) -> None:
        params = _valid_params(on_error=mode)
        del params["session"]
        channel = _channel(("", "", 0))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            await _execute(channel, params)

    @_BOTH_MODES
    async def test_a_transport_failure_raises_the_transport_row(self, mode: str) -> None:
        detail = "[Errno 111] Connection refused"
        channel = _channel(ExecTransportError(detail))

        with pytest.raises(ValueError, match=exact(_transport(detail))):
            await _execute(channel, _valid_params(on_error=mode))

    @_BOTH_MODES
    async def test_a_transport_failure_names_the_selected_container(self, mode: str) -> None:
        detail = "TLS handshake failed"
        channel = _channel(ExecTransportError(detail))

        with pytest.raises(ValueError, match=exact(_transport(detail, container="sidecar"))):
            await _execute(channel, _valid_params(container="sidecar", on_error=mode))

    @_BOTH_MODES
    async def test_a_transport_failure_records_nothing(self, mode: str) -> None:
        channel = _channel(ExecTransportError("socket closed"))
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(channel, _valid_params(on_error=mode), logger)

        assert logger.warn.call_count == 0

    @_BOTH_MODES
    async def test_a_timeout_raises_the_script_timeout_row(self, mode: str) -> None:
        message = "Script execution timed out after 60 seconds"
        channel = _channel(ExecTimeout("Command execution timed out after 60 seconds"))

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(channel, _valid_params(on_error=mode))

    @_BOTH_MODES
    async def test_the_timeout_row_names_the_configured_timeout(self, mode: str) -> None:
        message = "Script execution timed out after 45 seconds"
        channel = _channel(ExecTimeout("Command execution timed out after 45 seconds"))

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(channel, _valid_params(timeout=45, on_error=mode))

    @_BOTH_MODES
    async def test_an_empty_interpreter_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=exact(_EMPTY_INTERPRETER)):
            await K8sScriptPlugin().validate(_valid_params(interpreter="", on_error=mode))

    @_BOTH_MODES
    async def test_an_unclosed_quote_in_the_interpreter_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=exact(_UNCLOSED_QUOTE)):
            await K8sScriptPlugin().validate(_valid_params(interpreter='sh "x', on_error=mode))

    @_BOTH_MODES
    async def test_a_missing_script_raises(self, mode: str) -> None:
        params = _valid_params(on_error=mode)
        del params["script"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: script$"):
            await K8sScriptPlugin().validate(params)

    @_BOTH_MODES
    async def test_a_missing_pod_raises(self, mode: str) -> None:
        params = _valid_params(on_error=mode)
        del params["pod"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: pod$"):
            await K8sScriptPlugin().validate(params)

    @_BOTH_MODES
    async def test_a_non_positive_timeout_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sScriptPlugin().validate(_valid_params(timeout=0, on_error=mode))

    @_BOTH_MODES
    async def test_an_invalid_on_error_value_raises(self, mode: str) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'skip'."
        params = _valid_params(on_error=mode)
        params["on_error"] = "skip"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sScriptPlugin().validate(params)
