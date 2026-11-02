"""K8s Logs plugin tests (REQ-3.3.2.1).

Logs reads one container's log through the pod log subresource, hands it back
as text or per line, where a per-line read with Timestamps on is a TIME/MESSAGE
table, and carries the shared success/error/reason output core with Failure
Handling (K8SREAD-10).
It has no All namespaces row (K8SREAD-8), and its container is a required row
(K8SREAD-20).
"""

import json
import urllib.parse
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GATEWAY_HTML,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    SERVER,
    Call,
    FakeK8sClient,
    block_params,
    exact,
    execute_context,
    required_conditions,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.core.table import Table
from wavecore.models.plugins import resolve_output_type
from wavecore.plugins.k8s_logs import K8sLogsPlugin

_CLIENT_TARGET = "wavecore.connectivity.k8s.verbs.logs.K8sClient"

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "pod",
    "container",
    "previous",
    "tail_lines",
    "since_seconds",
    "timestamps",
    "output_format",
    "max_bytes",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

RECORD_GATE = {"field": "on_error", "values": ["record"]}

# Logs declares the type its Output Format and Timestamps return (K8SREAD-6).
LOGS_TYPE_WHEN: list[dict[str, Any]] = [
    {
        "when": [
            {"field": "output_format", "values": ["array"]},
            {"field": "timestamps", "values": ["true"]},
        ],
        "type": "table",
    },
    {"when": [{"field": "output_format", "values": ["array"]}], "type": "array"},
]

LOGS_TYPE_MATRIX = [
    ("string", False, "string"),
    ("string", True, "string"),
    ("array", False, "array"),
    ("array", True, "table"),
]

_POD = "web-1"
_CONTAINER = "app"
# Every block in the family names its container the same way (K8SREAD-20).
CONTAINER_DESCRIPTION = "Which container in the pod to use. Name it even when the pod has only one."
_LOG_PATH = f"/api/v1/namespaces/{NAMESPACE}/pods/{_POD}/log"
_LOG_TEXT = "2026-08-22T10:00:00Z boot sequence started\n2026-08-22T10:00:01Z ready\n"
_BAD_CONTAINER = 'container "nope" is not valid for pod "web-1"'
_NO_PREVIOUS = 'previous terminated container "app" in pod "web-1" not found'
_FORBIDDEN = (
    'pods "web-1" is forbidden: User "wave" cannot get resource "pods/log" '
    'in API group "" in the namespace "apps"'
)


def _params_by_name(plugin: K8sLogsPlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


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


def _outputs_by_name(plugin: K8sLogsPlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _logs_params(**overrides: Any) -> dict[str, Any]:
    return block_params(**{"pod": _POD, "container": _CONTAINER, **overrides})


def _status_body(message: str, reason: str, code: int) -> bytes:
    return json.dumps(
        {
            "kind": "Status",
            "apiVersion": "v1",
            "status": "Failure",
            "message": message,
            "reason": reason,
            "code": code,
        }
    ).encode()


def _path(call: Call) -> str:
    return urllib.parse.urlsplit(call.path).path


def _query(call: Call) -> dict[str, str]:
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(call.path).query))


def _construction(client: FakeK8sClient) -> tuple[Any, Any]:
    call = client.factory.call_args
    context = call.args[0] if call.args else call.kwargs["context"]
    if "timeout" in call.kwargs:
        return context, call.kwargs["timeout"]
    return context, call.args[1] if len(call.args) > 1 else None


def _impersonation(client: FakeK8sClient) -> tuple[Any, Any]:
    kwargs = client.factory.call_args.kwargs
    return kwargs.get("impersonate_user"), kwargs.get("impersonate_groups")


def _log(body: bytes) -> FakeK8sClient:
    """One scripted log body; the block makes no other request."""
    return FakeK8sClient(responses=[(200, body)])


def _plain_log() -> FakeK8sClient:
    """A log with Timestamps off, so no line carries a prefix."""
    return _log(b"boot sequence started\nready to serve traffic\n")


def _table_params(**overrides: Any) -> dict[str, Any]:
    """A per-line read with Timestamps on, which is the table shape."""
    return _logs_params(timestamps=True, output_format="array", **overrides)


async def _run(
    params: dict[str, Any],
    client: FakeK8sClient | None = None,
    logger: Any = None,
) -> tuple[Any, FakeK8sClient]:
    fake = client if client is not None else _log(_LOG_TEXT.encode())
    factory = MagicMock(return_value=fake)
    fake.factory = factory
    with patch(_CLIENT_TARGET, factory):
        result = await K8sLogsPlugin().execute(execute_context(params, logger=logger))
    return result, fake


async def _run_error(
    status: int, body: bytes, logger: Any = None, **overrides: Any
) -> tuple[Any, FakeK8sClient]:
    params = _logs_params(**overrides)
    return await _run(params, FakeK8sClient(responses=[(status, body)]), logger)


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_plugin_instantiates(self) -> None:
        assert K8sLogsPlugin() is not None

    def test_identity(self) -> None:
        meta = K8sLogsPlugin().metadata

        assert meta["id"] == "k8s-logs"
        assert meta["name"] == "K8s Logs"
        assert meta["category"] == "kubernetes"
        assert meta["version"] == "1.0.0"
        assert meta["return_type"] == "map"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sLogsPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_remotable_is_true(self) -> None:
        assert K8sLogsPlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sLogsPlugin().metadata["proxy_support"] == "supported"

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        assert params["session"]["required"] is True
        assert params["pod"]["required"] is True
        assert params["container"]["required"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name in ("session", "pod", "container"):
                continue
            assert params[name].get("required") is False

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["pod"]["type"] == "string"
        assert params["container"]["type"] == "string"
        assert params["previous"]["type"] == "boolean"
        assert params["tail_lines"]["type"] == "integer"
        assert params["since_seconds"]["type"] == "integer"
        assert params["timestamps"]["type"] == "boolean"
        assert params["output_format"]["type"] == "string"
        assert params["max_bytes"]["type"] == "integer"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_defaults(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        assert params["timeout"]["default"] == 30
        assert params["previous"]["default"] is False
        assert params["timestamps"]["default"] is False
        assert params["output_format"]["default"] == "string"
        assert params["on_error"]["default"] == "fail"

    def test_output_format_follows_timestamps(self) -> None:
        names = [p["name"] for p in K8sLogsPlugin().metadata["parameters"]]

        assert names[names.index("timestamps") + 1] == "output_format"

    def test_optional_value_params_carry_no_default(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        for name in (
            "tail_lines",
            "since_seconds",
            "max_bytes",
            "namespace",
            "impersonate_user",
            "impersonate_groups",
        ):
            assert params[name].get("default") is None

    def test_only_the_session_is_secret(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        for name in (
            "session",
            "pod",
            "container",
            "namespace",
            "impersonate_user",
            "impersonate_groups",
        ):
            assert params[name]["trim"] is True

    def test_enum_parameters(self) -> None:
        params = _params_by_name(K8sLogsPlugin())
        enum_params = {name for name, param in params.items() if "enum_values" in param}

        assert enum_params == {"output_format", "on_error"}
        assert params["output_format"]["enum_values"] == ["string", "array"]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_no_all_namespaces_parameter(self) -> None:
        assert "all_namespaces" not in _params_by_name(K8sLogsPlugin())

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sLogsPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_the_container_row_reads_like_the_rest_of_the_family(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        assert params["container"]["description"] == CONTAINER_DESCRIPTION

    def test_output_schema(self) -> None:
        outputs = K8sLogsPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("logs", "string"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_no_output_is_secret_flagged(self) -> None:
        for output in K8sLogsPlugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sLogsPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name(K8sLogsPlugin())

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS


class TestOutputGating:
    """Error and Reason render only under Record and continue; Success never hides."""

    def test_error_and_reason_render_only_under_record_and_continue(self) -> None:
        outputs = _outputs_by_name(K8sLogsPlugin())

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE

    def test_success_carries_no_gate(self) -> None:
        """Success stays visible in both On error modes, deliberately."""
        outputs = _outputs_by_name(K8sLogsPlugin())

        assert "show_when" not in outputs["success"]

    def test_only_error_and_reason_are_gated(self) -> None:
        gated = {o["name"] for o in K8sLogsPlugin().metadata["output_schema"] if "show_when" in o}

        assert gated == {"error", "reason"}


class TestLogsTypeRules:
    """Logs declares the type its Output Format and Timestamps return (K8SREAD-6)."""

    def test_logs_declares_the_two_rules_in_order(self) -> None:
        logs = _outputs_by_name(K8sLogsPlugin())["logs"]

        assert logs["type"] == "string"
        assert logs["type_when"] == LOGS_TYPE_WHEN

    def test_no_other_output_carries_type_rules(self) -> None:
        outputs = _outputs_by_name(K8sLogsPlugin())

        for name, output in outputs.items():
            if name == "logs":
                continue
            assert "type_when" not in output

    def test_the_declared_type_is_what_the_defaults_resolve_to(self) -> None:
        logs = _outputs_by_name(K8sLogsPlugin())["logs"]
        parameters = _params_by_name(K8sLogsPlugin())

        resolved = resolve_output_type(logs["type"], logs["type_when"], {}, parameters)

        assert resolved == "string"

    @pytest.mark.parametrize(("output_format", "timestamps", "expected"), LOGS_TYPE_MATRIX)
    def test_every_format_and_timestamp_mode_resolves(
        self, output_format: str, timestamps: bool, expected: str
    ) -> None:
        logs = _outputs_by_name(K8sLogsPlugin())["logs"]
        values = {"output_format": output_format, "timestamps": timestamps}

        assert resolve_output_type(logs["type"], logs["type_when"], values) == expected


class TestConditionalRequirements:
    """Logs asks for the pod and the container outright, so nothing is conditional."""

    def test_no_parameter_is_conditionally_required(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        assert [n for n in EXPECTED_PARAM_ORDER if required_conditions(params[n])] == []

    def test_the_pod_and_the_container_are_required_outright(self) -> None:
        params = _params_by_name(K8sLogsPlugin())

        assert params["pod"]["required"] is True
        assert params["container"]["required"] is True


class TestValidation:
    """validate() - required params, positivity rules, enums."""

    async def test_minimal_params_pass(self) -> None:
        await K8sLogsPlugin().validate(_logs_params())

    async def test_full_params_pass(self) -> None:
        await K8sLogsPlugin().validate(
            _logs_params(
                timeout=45,
                container="app",
                previous=True,
                tail_lines=100,
                since_seconds=600,
                timestamps=True,
                output_format="array",
                max_bytes=4096,
                namespace="prod",
                impersonate_user="jane",
                impersonate_groups="dev, ops",
                on_error="record",
            )
        )

    async def test_missing_pod(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: pod$"):
            await K8sLogsPlugin().validate(block_params())

    async def test_empty_pod_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: pod$"):
            await K8sLogsPlugin().validate(block_params(pod=""))

    async def test_missing_container(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: container$"):
            await K8sLogsPlugin().validate(block_params(pod=_POD))

    async def test_empty_container_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: container$"):
            await K8sLogsPlugin().validate(_logs_params(container=""))

    async def test_missing_session(self) -> None:
        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sLogsPlugin().validate({"pod": _POD})

    async def test_empty_session_reports_the_empty_case(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sLogsPlugin().validate({"session": "", "pod": _POD})

    async def test_zero_tail_lines_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'tail_lines' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(tail_lines=0))

    async def test_negative_tail_lines_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'tail_lines' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(tail_lines=-10))

    async def test_positive_tail_lines_passes(self) -> None:
        await K8sLogsPlugin().validate(_logs_params(tail_lines=1))

    async def test_zero_since_seconds_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'since_seconds' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(since_seconds=0))

    async def test_negative_since_seconds_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'since_seconds' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(since_seconds=-1))

    async def test_positive_since_seconds_passes(self) -> None:
        await K8sLogsPlugin().validate(_logs_params(since_seconds=1))

    async def test_zero_max_bytes_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'max_bytes' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(max_bytes=0))

    async def test_negative_max_bytes_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'max_bytes' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(max_bytes=-2048))

    async def test_positive_max_bytes_passes(self) -> None:
        await K8sLogsPlugin().validate(_logs_params(max_bytes=1))

    async def test_zero_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sLogsPlugin().validate(_logs_params(timeout=45))

    async def test_invalid_on_error_is_rejected(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'retry'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sLogsPlugin().validate(_logs_params(on_error="retry"))

    async def test_both_on_error_values_pass(self) -> None:
        await K8sLogsPlugin().validate(_logs_params(on_error="fail"))
        await K8sLogsPlugin().validate(_logs_params(on_error="record"))

    @pytest.mark.parametrize("value", ["yaml", "table"])
    async def test_invalid_output_format_is_rejected(self, value: str) -> None:
        message = (
            "Parameter 'output_format' must be one of: string, array; "
            f"Actual value was '{value}'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sLogsPlugin().validate(_logs_params(output_format=value))

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        params = _logs_params(impersonate_groups="qa, ops")

        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sLogsPlugin().validate(params)

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sLogsPlugin().validate(
            _logs_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )


class TestEveryFormatAndTimestampPairIsAccepted:
    """Timestamps renames the per-line choice, so no pair can be refused."""

    @pytest.mark.parametrize("timestamps", [True, False])
    @pytest.mark.parametrize("output_format", ["string", "array"])
    async def test_both_formats_pass_in_both_timestamp_modes(
        self, output_format: str, timestamps: bool
    ) -> None:
        await K8sLogsPlugin().validate(
            _logs_params(output_format=output_format, timestamps=timestamps)
        )

    @pytest.mark.parametrize("timestamps", [True, False])
    async def test_an_untouched_format_passes_in_both_timestamp_modes(
        self, timestamps: bool
    ) -> None:
        await K8sLogsPlugin().validate(_logs_params(timestamps=timestamps))


class TestExecuteRequest:
    """The GET on the pod log subresource and its query parameters."""

    async def test_reads_the_log_subresource_once(self) -> None:
        _, fake = await _run(_logs_params(container="app"))

        assert len(fake.calls) == 1
        assert fake.last.method == "GET"
        assert _path(fake.last) == _LOG_PATH
        assert fake.last.body is None

    async def test_no_discovery_is_needed(self) -> None:
        _, fake = await _run(_logs_params())

        assert fake.discoveries == []

    async def test_the_body_is_read_raw(self) -> None:
        _, fake = await _run(_logs_params())

        assert fake.last.raw is True

    async def test_unset_optionals_do_not_reach_the_wire(self) -> None:
        _, fake = await _run(_logs_params())

        assert _query(fake.last) == {"container": "app"}

    async def test_false_booleans_do_not_reach_the_wire(self) -> None:
        _, fake = await _run(_logs_params(previous=False, timestamps=False))

        assert _query(fake.last) == {"container": "app"}

    async def test_container_reaches_the_wire(self) -> None:
        _, fake = await _run(_logs_params(container="app"))

        assert _query(fake.last) == {"container": "app"}
        assert len(fake.calls) == 1

    async def test_previous_reaches_the_wire_lowercased(self) -> None:
        _, fake = await _run(_logs_params(container="app", previous=True))

        assert _query(fake.last) == {"container": "app", "previous": "true"}

    async def test_tail_lines_reaches_the_wire_as_tailLines(self) -> None:
        _, fake = await _run(_logs_params(container="app", tail_lines=25))

        assert _query(fake.last) == {"container": "app", "tailLines": "25"}

    async def test_since_seconds_reaches_the_wire_as_sinceSeconds(self) -> None:
        _, fake = await _run(_logs_params(container="app", since_seconds=600))

        assert _query(fake.last) == {"container": "app", "sinceSeconds": "600"}

    async def test_timestamps_reaches_the_wire_lowercased(self) -> None:
        _, fake = await _run(_logs_params(container="app", timestamps=True))

        assert _query(fake.last) == {"container": "app", "timestamps": "true"}

    async def test_max_bytes_reaches_the_wire_as_limitBytes(self) -> None:
        _, fake = await _run(_logs_params(container="app", max_bytes=4096))

        assert _query(fake.last) == {"container": "app", "limitBytes": "4096"}

    async def test_every_option_together(self) -> None:
        _, fake = await _run(
            _logs_params(
                container="app",
                previous=True,
                tail_lines=25,
                since_seconds=600,
                timestamps=True,
                max_bytes=4096,
            )
        )

        assert _query(fake.last) == {
            "container": "app",
            "previous": "true",
            "tailLines": "25",
            "sinceSeconds": "600",
            "timestamps": "true",
            "limitBytes": "4096",
        }

    async def test_since_time_is_never_sent(self) -> None:
        _, fake = await _run(_logs_params(container="app", since_seconds=600))

        assert "sinceTime" not in _query(fake.last)


class TestNoContainerDefaulting:
    """Container is a required row, so the block never reads the pod to choose one (K8SREAD-20)."""

    async def test_the_pod_object_is_never_read(self) -> None:
        _, fake = await _run(_logs_params())

        assert [_path(call) for call in fake.calls] == [_LOG_PATH]

    async def test_the_named_container_is_the_one_read(self) -> None:
        _, fake = await _run(_logs_params(container="sidecar"))

        assert _query(fake.last) == {"container": "sidecar"}

    async def test_the_log_read_is_the_only_request_in_record_mode_too(self) -> None:
        _, fake = await _run(_logs_params(on_error="record"))

        assert len(fake.calls) == 1


class TestExecuteNamespace:
    """Namespace resolution: a typed namespace governs, the session carries the default."""

    async def test_session_namespace_is_the_default(self) -> None:
        _, fake = await _run(_logs_params())

        assert _path(fake.last) == f"/api/v1/namespaces/{NAMESPACE}/pods/{_POD}/log"

    async def test_a_typed_namespace_wins(self) -> None:
        _, fake = await _run(_logs_params(namespace="prod"))

        assert _path(fake.last) == f"/api/v1/namespaces/prod/pods/{_POD}/log"

    async def test_an_empty_namespace_falls_back_to_the_session(self) -> None:
        _, fake = await _run(_logs_params(namespace=""))

        assert _path(fake.last) == f"/api/v1/namespaces/{NAMESPACE}/pods/{_POD}/log"

    async def test_a_stray_all_namespaces_value_changes_nothing(self) -> None:
        _, fake = await _run(_logs_params(all_namespaces=True))

        assert _path(fake.last) == f"/api/v1/namespaces/{NAMESPACE}/pods/{_POD}/log"
        assert "allNamespaces" not in _query(fake.last)


class TestExecuteImpersonation:
    """The impersonation rows travel to the REST core."""

    async def test_impersonation_reaches_the_core(self) -> None:
        _, fake = await _run(_logs_params(impersonate_user="jane", impersonate_groups="dev, ops"))

        assert _impersonation(fake) == ("jane", ["dev", "ops"])

    async def test_a_single_group_reaches_the_core(self) -> None:
        _, fake = await _run(_logs_params(impersonate_user="jane", impersonate_groups="dev"))

        assert _impersonation(fake) == ("jane", ["dev"])

    async def test_no_impersonation_by_default(self) -> None:
        _, fake = await _run(_logs_params())

        assert _impersonation(fake) == (None, None)


class TestExecuteBody:
    """The raw text body and the max_bytes cut."""

    async def test_the_text_body_comes_back_as_a_string(self) -> None:
        result, _ = await _run(_logs_params())

        assert result["logs"] == _LOG_TEXT
        assert isinstance(result["logs"], str)

    async def test_a_body_that_is_not_json_is_returned_verbatim(self) -> None:
        text = "boot sequence started\nnot json at all: {{{ [unterminated\n"
        fake = _log(text.encode())

        result, _ = await _run(_logs_params(), fake)

        assert result["logs"] == text

    async def test_an_empty_log_is_an_empty_string(self) -> None:
        fake = _log(b"")

        result, _ = await _run(_logs_params(), fake)

        assert result["logs"] == ""
        assert result["success"] is True

    async def test_a_body_shorter_than_max_bytes_is_untouched(self) -> None:
        fake = _log(b"012345678")

        result, _ = await _run(_logs_params(max_bytes=10), fake)

        assert result["logs"] == "012345678"

    async def test_a_body_of_exactly_max_bytes_is_untouched(self) -> None:
        fake = _log(b"0123456789")

        result, _ = await _run(_logs_params(max_bytes=10), fake)

        assert result["logs"] == "0123456789"

    async def test_a_body_one_byte_over_max_bytes_is_cut(self) -> None:
        fake = _log(b"0123456789X")

        result, _ = await _run(_logs_params(max_bytes=10), fake)

        assert result["logs"] == "0123456789"

    async def test_a_long_body_is_cut_to_max_bytes(self) -> None:
        fake = _log(b"z" * 5000)

        result, _ = await _run(_logs_params(max_bytes=64), fake)

        assert result["logs"] == "z" * 64


class TestOutputFormatString:
    """The default: whatever the API returned, unchanged."""

    async def test_the_untouched_format_returns_the_text_unchanged(self) -> None:
        result, _ = await _run(_logs_params())

        assert result["logs"] == _LOG_TEXT

    async def test_an_explicit_string_returns_the_text_unchanged(self) -> None:
        result, _ = await _run(_logs_params(output_format="string"))

        assert result["logs"] == _LOG_TEXT

    async def test_string_keeps_the_trailing_newline(self) -> None:
        fake = _log(b"only line\n")

        result, _ = await _run(_logs_params(output_format="string"), fake)

        assert result["logs"] == "only line\n"


class TestOutputFormatArray:
    """Array is one entry per line, with Timestamps off so a line has no prefix."""

    async def test_each_line_is_its_own_entry(self) -> None:
        result, _ = await _run(_logs_params(output_format="array"), _plain_log())

        assert result["logs"] == ["boot sequence started", "ready to serve traffic"]

    async def test_a_line_with_spaces_stays_one_entry(self) -> None:
        result, _ = await _run(_logs_params(output_format="array"), _plain_log())

        assert result["logs"][0] == "boot sequence started"

    async def test_the_trailing_newline_adds_no_empty_entry(self) -> None:
        result, _ = await _run(_logs_params(output_format="array"), _plain_log())

        assert len(result["logs"]) == 2

    async def test_a_last_line_without_a_newline_survives(self) -> None:
        result, _ = await _run(_logs_params(output_format="array"), _log(b"one\ntwo"))

        assert result["logs"] == ["one", "two"]

    async def test_a_blank_line_inside_the_log_is_an_empty_entry(self) -> None:
        result, _ = await _run(_logs_params(output_format="array"), _log(b"one\n\ntwo\n"))

        assert result["logs"] == ["one", "", "two"]

    async def test_an_empty_log_is_an_empty_list(self) -> None:
        result, _ = await _run(_logs_params(output_format="array"), _log(b""))

        assert result["logs"] == []
        assert result["success"] is True

    async def test_the_byte_cut_happens_before_the_split(self) -> None:
        result, _ = await _run(
            _logs_params(output_format="array", max_bytes=5), _log(b"one\ntwo\nthree\n")
        )

        assert result["logs"] == ["one", "t"]


class TestOutputFormatTable:
    """Table is TIME and MESSAGE, split on the first space the cluster's timestamp leaves."""

    async def test_the_result_is_a_wave_table(self) -> None:
        result, _ = await _run(_table_params())

        assert isinstance(result["logs"], Table)

    async def test_the_columns_are_time_and_message(self) -> None:
        result, _ = await _run(_table_params())

        assert result["logs"].col_names() == ["TIME", "MESSAGE"]

    async def test_both_columns_are_strings(self) -> None:
        result, _ = await _run(_table_params())

        assert result["logs"].col_types() == ["string", "string"]

    async def test_one_row_per_line(self) -> None:
        result, _ = await _run(_table_params())

        assert result["logs"].row_count() == 2

    async def test_each_line_splits_on_its_first_space(self) -> None:
        result, _ = await _run(_table_params())
        table = result["logs"]

        assert table.row(0).to_list() == ["2026-08-22T10:00:00Z", "boot sequence started"]
        assert table.row(1).to_list() == ["2026-08-22T10:00:01Z", "ready"]

    async def test_a_message_keeps_every_space_after_the_first(self) -> None:
        body = b"2026-08-22T10:00:02Z GET /healthz 200  in 3ms\n"

        result, _ = await _run(_table_params(), _log(body))

        assert result["logs"].row(0).to_list() == [
            "2026-08-22T10:00:02Z",
            "GET /healthz 200  in 3ms",
        ]

    async def test_a_line_with_no_space_at_all_is_all_time(self) -> None:
        result, _ = await _run(_table_params(), _log(b"2026-08-22T10:00:03Z\n"))

        assert result["logs"].row(0).to_list() == ["2026-08-22T10:00:03Z", ""]

    async def test_an_empty_log_is_a_table_with_no_rows(self) -> None:
        result, _ = await _run(_table_params(), _log(b""))

        assert result["logs"].col_names() == ["TIME", "MESSAGE"]
        assert result["logs"].row_count() == 0
        assert result["success"] is True


class TestOutputFormatOnTheWire:
    """The format is a rendering choice, so it never reaches the cluster."""

    @pytest.mark.parametrize("timestamps", [True, False])
    @pytest.mark.parametrize("output_format", ["string", "array"])
    async def test_the_format_is_never_sent(self, output_format: str, timestamps: bool) -> None:
        params = _logs_params(container="app", output_format=output_format, timestamps=timestamps)

        _, fake = await _run(params)

        assert "output_format" not in _query(fake.last)
        assert "outputFormat" not in _query(fake.last)


class TestRecordedFailureEmptiesLogsInItsType:
    """A recorded refusal leaves logs empty in whatever type the format declares."""

    async def test_string_records_an_empty_string(self) -> None:
        result, _ = await _run_error(
            404,
            _status_body('pods "web-1" not found', "NotFound", 404),
            on_error="record",
            output_format="string",
        )

        assert result["logs"] == ""

    async def test_array_records_an_empty_list(self) -> None:
        result, _ = await _run_error(
            404,
            _status_body('pods "web-1" not found', "NotFound", 404),
            on_error="record",
            output_format="array",
        )

        assert result["logs"] == []

    async def test_table_records_an_empty_table(self) -> None:
        result, _ = await _run_error(
            404,
            _status_body('pods "web-1" not found', "NotFound", 404),
            on_error="record",
            output_format="array",
            timestamps=True,
        )

        assert isinstance(result["logs"], Table)
        assert result["logs"].col_names() == ["TIME", "MESSAGE"]
        assert result["logs"].row_count() == 0


class TestExecuteClusterErrors:
    """The block's own 400 row and the shared 404/401/403 rows."""

    async def test_a_container_the_pod_does_not_have_surfaces_the_cluster_message(self) -> None:
        message = f"Kubernetes rejected the log request: {_BAD_CONTAINER}"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(400, _status_body(_BAD_CONTAINER, "BadRequest", 400), container="nope")

    async def test_previous_without_a_restart_surfaces_the_cluster_message(self) -> None:
        message = f"Kubernetes rejected the log request: {_NO_PREVIOUS}"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(
                400, _status_body(_NO_PREVIOUS, "BadRequest", 400), container="app", previous=True
            )

    async def test_missing_pod_renders_the_shared_not_found_row(self) -> None:
        message = f"K8s Pod '{_POD}' not found in namespace '{NAMESPACE}'"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(404, _status_body('pods "web-1" not found', "NotFound", 404))

    async def test_missing_pod_in_a_specified_namespace_names_that_namespace(self) -> None:
        message = f"K8s Pod '{_POD}' not found in namespace 'prod'"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(
                404,
                _status_body('pods "web-1" not found', "NotFound", 404),
                namespace="prod",
            )

    async def test_unauthorized_renders_the_shared_authentication_row(self) -> None:
        message = "Kubernetes API authentication failed: Unauthorized"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(401, _status_body("Unauthorized", "Unauthorized", 401))

    async def test_forbidden_renders_the_shared_permission_row(self) -> None:
        message = f"Kubernetes API permission denied: {_FORBIDDEN}"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(403, _status_body(_FORBIDDEN, "Forbidden", 403))

    async def test_a_server_error_says_the_read_failed_and_names_the_pod_once(self) -> None:
        detail = "the server is currently unable to handle the request"
        message = f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(503, _status_body(detail, "ServiceUnavailable", 503))

    async def test_a_server_error_is_recorded_with_its_reason(self) -> None:
        detail = "Internal error occurred: rpc error: code = Unknown"

        result, _ = await _run_error(
            500, _status_body(detail, "InternalError", 500), on_error="record"
        )

        assert result["error"] == (
            f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}': {detail}"
        )
        assert result["reason"] == "InternalError"


class TestGatewayAnswers:
    """Something other than the cluster answering reads the same as it does in Get."""

    async def test_401_with_a_body_that_is_not_a_status_ends_with_the_http_status(self) -> None:
        message = f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(401, GATEWAY_HTML)

    async def test_403_with_a_body_that_is_not_a_status_ends_with_the_http_status(self) -> None:
        message = f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}' (HTTP 403)"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(403, GATEWAY_HTML)

    async def test_400_without_a_cluster_message_ends_with_the_http_status(self) -> None:
        message = f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}' (HTTP 400)"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(400, GATEWAY_HTML)

    async def test_a_gateway_401_is_recordable_with_an_empty_reason(self) -> None:
        result, _ = await _run_error(401, GATEWAY_HTML, on_error="record")

        assert result["error"] == (
            f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}' (HTTP 401)"
        )
        assert result["reason"] == ""


class TestOutputCore:
    """The shared success/error/reason core and the on_error dispatch."""

    async def test_happy_path_fills_the_core(self) -> None:
        result, _ = await _run(_logs_params())

        assert result == {"logs": _LOG_TEXT, "success": True, "error": "", "reason": ""}

    async def test_record_mode_records_the_cluster_400(self) -> None:
        message = f"Kubernetes rejected the log request: {_BAD_CONTAINER}"

        result, _ = await _run_error(
            400,
            _status_body(_BAD_CONTAINER, "BadRequest", 400),
            container="nope",
            on_error="record",
        )

        assert result == {
            "logs": "",
            "success": False,
            "error": message,
            "reason": "BadRequest",
            "__block_warning": True,
        }

    async def test_record_mode_records_a_missing_pod(self) -> None:
        result, _ = await _run_error(
            404, _status_body('pods "web-1" not found', "NotFound", 404), on_error="record"
        )

        assert result == {
            "logs": "",
            "success": False,
            "error": f"K8s Pod '{_POD}' not found in namespace '{NAMESPACE}'",
            "reason": "NotFound",
            "__block_warning": True,
        }

    async def test_record_mode_records_a_permission_denial(self) -> None:
        result, _ = await _run_error(
            403, _status_body(_FORBIDDEN, "Forbidden", 403), on_error="record"
        )

        assert result == {
            "logs": "",
            "success": False,
            "error": f"Kubernetes API permission denied: {_FORBIDDEN}",
            "reason": "Forbidden",
            "__block_warning": True,
        }

    async def test_fail_is_the_default_mode(self) -> None:
        message = f"K8s Pod '{_POD}' not found in namespace '{NAMESPACE}'"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(404, _status_body('pods "web-1" not found', "NotFound", 404))

    async def test_explicit_fail_mode_raises(self) -> None:
        message = f"K8s Pod '{_POD}' not found in namespace '{NAMESPACE}'"

        with pytest.raises(ValueError, match=exact(message)):
            await _run_error(
                404, _status_body('pods "web-1" not found', "NotFound", 404), on_error="fail"
            )


class TestAlwaysHardFail:
    """Dependency errors raise in both on_error modes."""

    async def test_a_bogus_session_raises_in_fail_mode(self) -> None:
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )
        fake = FakeK8sClient()

        with pytest.raises(ValueError, match=exact(message)):
            await _run({"session": "not-a-kubeconfig", "pod": _POD}, fake)

        assert fake.calls == []

    async def test_a_bogus_session_raises_in_record_mode(self) -> None:
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _run({"session": "not-a-kubeconfig", "pod": _POD, "on_error": "record"})

    async def test_a_missing_session_raises_in_fail_mode(self) -> None:
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )
        fake = FakeK8sClient()

        with pytest.raises(ValueError, match=exact(message)):
            await _run({"pod": _POD}, fake)

        assert fake.calls == []

    async def test_a_missing_session_raises_in_record_mode(self) -> None:
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _run({"pod": _POD, "on_error": "record"})

    async def test_a_transport_failure_raises_in_fail_mode(self) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            await _run(_logs_params(), fake)

    async def test_a_transport_failure_raises_in_record_mode(self) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            await _run(_logs_params(on_error="record"), fake)

    async def test_a_tls_failure_raises_in_fail_mode(self) -> None:
        message = f"Could not verify the TLS certificate of {SERVER}: unknown issuer"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            await _run(_logs_params(), fake)

    async def test_a_tls_failure_raises_in_record_mode(self) -> None:
        message = f"Could not verify the TLS certificate of {SERVER}: unknown issuer"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            await _run(_logs_params(on_error="record"), fake)

    async def test_a_timeout_raises_in_fail_mode(self) -> None:
        message = f"Kubernetes API request GET {_LOG_PATH} timed out after 30 seconds"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            await _run(_logs_params(), fake)

    async def test_a_timeout_raises_in_record_mode(self) -> None:
        message = f"Kubernetes API request GET {_LOG_PATH} timed out after 30 seconds"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            await _run(_logs_params(on_error="record"), fake)

    async def test_invalid_parameters_are_rejected_in_record_mode(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'tail_lines' must be positive$"):
            await K8sLogsPlugin().validate(_logs_params(tail_lines=0, on_error="record"))

    async def test_a_missing_pod_is_rejected_in_record_mode(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: pod$"):
            await K8sLogsPlugin().validate(block_params(on_error="record"))


class TestClientConstruction:
    """Logs hands the REST core the parsed session context and the timeout."""

    async def test_client_receives_the_session_context(self) -> None:
        _, fake = await _run(_logs_params())
        context, _ = _construction(fake)

        assert context.server == SERVER
        assert context.namespace == NAMESPACE
        assert context.token == "sa-tok"

    async def test_client_receives_the_timeout(self) -> None:
        _, fake = await _run(_logs_params(timeout=45))

        assert _construction(fake)[1] == 45

    async def test_client_timeout_defaults_to_30(self) -> None:
        _, fake = await _run(_logs_params())

        assert _construction(fake)[1] == 30


class TestPathEncoding:
    """Pod name and namespace reach the wire percent-encoded; messages keep the typed values."""

    async def test_a_pod_name_with_a_space_and_a_question_mark_is_percent_encoded(self) -> None:
        _, fake = await _run(_logs_params(pod="web 1?"))

        assert _path(fake.last) == f"/api/v1/namespaces/{NAMESPACE}/pods/web%201%3F/log"

    async def test_a_namespace_with_a_space_and_a_question_mark_is_percent_encoded(self) -> None:
        _, fake = await _run(_logs_params(namespace="my ns?"))

        assert _path(fake.last) == f"/api/v1/namespaces/my%20ns%3F/pods/{_POD}/log"

    async def test_the_query_follows_the_encoded_log_path(self) -> None:
        _, fake = await _run(_logs_params(pod="web 1?", container="app", tail_lines=5))

        assert _path(fake.last) == f"/api/v1/namespaces/{NAMESPACE}/pods/web%201%3F/log"
        assert _query(fake.last) == {"container": "app", "tailLines": "5"}

    async def test_a_missing_pod_is_reported_by_its_typed_name_and_namespace(self) -> None:
        fake = FakeK8sClient(
            responses=[(404, _status_body('pods "web 1?" not found', "NotFound", 404))]
        )
        message = "K8s Pod 'web 1?' not found in namespace 'my ns?'"

        with pytest.raises(ValueError, match=exact(message)):
            await _run(_logs_params(pod="web 1?", namespace="my ns?"), fake)

        assert _path(fake.last) == "/api/v1/namespaces/my%20ns%3F/pods/web%201%3F/log"

    async def test_a_stray_all_namespaces_does_not_beat_the_typed_namespace(self) -> None:
        _, fake = await _run(_logs_params(all_namespaces=True, namespace="prod"))

        assert _path(fake.last) == f"/api/v1/namespaces/prod/pods/{_POD}/log"


class TestRecordedFailureIsAmber:
    """A recorded log refusal asks for amber and says why at WARN (K8SREAD-10)."""

    async def test_a_recorded_bad_request_carries_the_warning_signal(self) -> None:
        result, _ = await _run_error(
            400,
            _status_body(_BAD_CONTAINER, "BadRequest", 400),
            container="nope",
            on_error="record",
        )

        assert result["__block_warning"] is True

    async def test_a_recorded_bad_request_logs_the_warn_line(self) -> None:
        logger = MagicMock()

        await _run_error(
            400,
            _status_body(_BAD_CONTAINER, "BadRequest", 400),
            logger,
            container="nope",
            on_error="record",
        )

        logger.warn.assert_called_once_with(
            f"Read failed (BadRequest): Kubernetes rejected the log request: {_BAD_CONTAINER}"
        )

    async def test_a_happy_read_logs_info_and_asks_for_nothing(self) -> None:
        logger = MagicMock()

        result, _ = await _run(_logs_params(on_error="record"), None, logger)

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0
        assert logger.info.call_count == 1

    async def test_fail_mode_logs_no_warn_line(self) -> None:
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _run_error(404, _status_body('pods "web-1" not found', "NotFound", 404), logger)

        assert logger.warn.call_count == 0
