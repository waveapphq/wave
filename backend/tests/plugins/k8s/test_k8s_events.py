"""K8s Events plugin tests (REQ-3.3.5.4, REQ-3.3.5.1).

Events is a kind-agnostic read verb: it lists v1 Events namespace-wide or
scoped to one object, filters by type, reason and age, and hands them back
newest-first. It carries the family output core and Failure Handling
and Get's four output formats.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qsl, urlsplit

import pytest
import yaml

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GATEWAY_HTML,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    SERVER,
    UNREADABLE_BODY_MESSAGE,
    Call,
    DeniedDiscoveryClient,
    FakeK8sClient,
    block_params,
    exact,
    execute_context,
    required_conditions,
    resource,
    session_value,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.core.table import Table
from wavecore.core.table_values import as_table
from wavecore.models.plugins import resolve_output_type
from wavecore.plugins.k8s_events import K8sEventsPlugin

_CLIENT_TARGET = "wavecore.connectivity.k8s.verbs.events.K8sClient"

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "scope_to_object",
    "object_type",
    "object_kind",
    "object_kind_custom",
    "object_name",
    "event_type",
    "reason",
    "within_seconds",
    "max_events",
    "output_format",
    "all_namespaces",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

TABLE_ACCEPT = "application/json;as=Table;g=meta.k8s.io;v=v1,application/json"

# Map mode always returns the list of events, so array is the default answer (K8SREAD-6).
RESULT_TYPE_WHEN: list[dict[str, Any]] = [
    {"when": [{"field": "output_format", "values": ["table"]}], "type": "table"},
    {"when": [{"field": "output_format", "values": ["json", "yaml"]}], "type": "string"},
]

RESULT_TYPE_MATRIX = [
    ("map", "array"),
    ("table", "table"),
    ("json", "string"),
    ("yaml", "string"),
]

_NS_PATH = f"/api/v1/namespaces/{NAMESPACE}/events"
_ALL_NS_PATH = "/api/v1/events"

_NEWEST = "2026-08-20T10:00:00Z"
_MIDDLE = "2026-08-20T09:30:00Z"
_OLDEST = "2026-08-20T09:00:00Z"

_FORBIDDEN_DETAIL = 'events is forbidden: User "wave" cannot list resource "events" in API group ""'
_FORBIDDEN_BODY = {
    "kind": "Status",
    "status": "Failure",
    "message": _FORBIDDEN_DETAIL,
    "reason": "Forbidden",
    "code": 403,
}
_FORBIDDEN_MESSAGE = f"Kubernetes API permission denied: {_FORBIDDEN_DETAIL}"

_UNAUTHORIZED_BODY = {
    "kind": "Status",
    "status": "Failure",
    "message": "Unauthorized",
    "reason": "Unauthorized",
    "code": 401,
}
_UNAUTHORIZED_MESSAGE = "Kubernetes API authentication failed: Unauthorized"

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_TRANSPORT_MESSAGE = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
_TIMEOUT_MESSAGE = f"Kubernetes API request GET {_NS_PATH} timed out after 30 seconds"


def _params_by_name(plugin: K8sEventsPlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


RECORD_GATE = {"field": "on_error", "values": ["record"]}

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


def _outputs_by_name(plugin: K8sEventsPlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _ago(seconds: int) -> str:
    """An RFC3339 timestamp that many seconds in the past, for the Max Age filter."""
    return (datetime.now(UTC) - timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _event(
    name: str,
    timestamp: str,
    event_type: str = "Normal",
    reason: str = "Scheduled",
    message: str = "",
    object_kind: str = "Pod",
    object_name: str = "web-1",
) -> dict[str, Any]:
    return {
        "metadata": {"name": name, "namespace": NAMESPACE, "creationTimestamp": timestamp},
        "involvedObject": {"kind": object_kind, "name": object_name, "namespace": NAMESPACE},
        "type": event_type,
        "reason": reason,
        "message": message,
        "count": 1,
        "firstTimestamp": timestamp,
        "lastTimestamp": timestamp,
        "eventTime": timestamp,
    }


def _undated_event(name: str, reason: str = "Scheduled") -> dict[str, Any]:
    """An event carrying no timestamp in any of the four fields the order reads."""
    return {
        "metadata": {"name": name, "namespace": NAMESPACE},
        "involvedObject": {"kind": "Pod", "name": "web-1", "namespace": NAMESPACE},
        "type": "Normal",
        "reason": reason,
        "message": "",
        "count": 1,
    }


_MANAGED_FIELDS = [
    {
        "manager": "kube-controller-manager",
        "operation": "Update",
        "apiVersion": "v1",
        "time": "2026-08-20T10:00:00Z",
        "fieldsType": "FieldsV1",
        "fieldsV1": {"f:count": {}},
    }
]


def _managed_event(name: str, timestamp: str) -> dict[str, Any]:
    """An event as the cluster stores it: metadata carries managedFields."""
    event = _event(name, timestamp)
    event["metadata"]["managedFields"] = _MANAGED_FIELDS
    return event


def _event_list(*events: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "EventList",
        "apiVersion": "v1",
        "metadata": {"resourceVersion": "1421"},
        "items": list(events),
    }


def _table_row(cells: list[Any], name: str, timestamp: str) -> dict[str, Any]:
    return {
        "cells": cells,
        "object": {"kind": "Event", "metadata": {"name": name}, "lastTimestamp": timestamp},
    }


def _undated_table_row(name: str, reason: str) -> dict[str, Any]:
    """A Table row whose embedded event carries no timestamp at all."""
    return {
        "cells": ["<unknown>", "Normal", reason, "pod/web-1", 1, _OLDEST, "No stamp"],
        "object": {"kind": "Event", "metadata": {"name": name}},
    }


def _table_body(count_type: str = "integer", second_count: Any = 1) -> dict[str, Any]:
    return {
        "kind": "Table",
        "apiVersion": "meta.k8s.io/v1",
        "columnDefinitions": [
            {"name": "Last Seen", "type": "string", "format": "", "priority": 0},
            {"name": "Type", "type": "string", "format": "", "priority": 0},
            {"name": "Reason", "type": "string", "format": "", "priority": 0},
            {"name": "Object", "type": "string", "format": "", "priority": 0},
            {"name": "Count", "type": count_type, "format": "", "priority": 0},
            {"name": "First Seen", "type": "date", "format": "", "priority": 0},
            {"name": "Message", "type": "string", "format": "", "priority": 0},
        ],
        "rows": [
            _table_row(
                ["30s", "Warning", "BackOff", "pod/web-1", 3, _OLDEST, "Back-off restarting"],
                "web-1.17a",
                _NEWEST,
            ),
            _table_row(
                ["2m", "Normal", "Scheduled", "pod/web-1", second_count, _OLDEST, "Assigned"],
                "web-1.179",
                _OLDEST,
            ),
        ],
    }


_TABLE_UNSUPPORTED_MESSAGE = (
    "This cluster will not print a table for kind 'Event' "
    "- choose Map, JSON or YAML for this kind"
)

_JSON_BODY = json.dumps(
    _event_list(_event("new-evt", _NEWEST), _event("old-evt", _OLDEST))
).encode()

_YAML_BODY = (
    b"apiVersion: v1\n"
    b"items:\n"
    b"- lastTimestamp: '2026-08-20T10:00:00Z'\n"
    b"  metadata:\n"
    b"    name: new-evt\n"
    b"  reason: Scheduled\n"
    b"  type: Normal\n"
    b"- lastTimestamp: '2026-08-20T09:00:00Z'\n"
    b"  metadata:\n"
    b"    name: old-evt\n"
    b"  reason: Pulled\n"
    b"  type: Normal\n"
    b"kind: EventList\n"
)
_YAML_DOCUMENT_AS_JSON = json.dumps(yaml.safe_load(_YAML_BODY)).encode()


_POD_RESOURCE = {"Pod": resource("Pod", "pods")}
_ISTIO = {
    "VirtualService": resource(
        "VirtualService", "virtualservices", group_version="networking.istio.io/v1"
    )
}


def _listing(*events: dict[str, Any], resources: dict[str, Any] | None = None) -> FakeK8sClient:
    """A fake core serving one EventList, with the kinds discovery can resolve."""
    return FakeK8sClient(
        responses=[(200, _event_list(*events))],
        resources=_POD_RESOURCE if resources is None else resources,
    )


def _serving(status: int, body: Any) -> FakeK8sClient:
    """A fake core serving one scripted response."""
    return FakeK8sClient(responses=[(status, body)], resources=_POD_RESOURCE)


async def _execute(params: dict[str, Any], fake: FakeK8sClient, logger: Any = None) -> Any:
    factory = MagicMock(return_value=fake)
    fake.factory = factory
    with patch(_CLIENT_TARGET, factory):
        return await K8sEventsPlugin().execute(execute_context(params, logger=logger))


def _path(call: Call) -> str:
    """The recorded request path without its query string."""
    return urlsplit(call.path).path


def _query(call: Call) -> dict[str, str]:
    """The recorded query, decoded, so the encoding style does not matter."""
    return dict(parse_qsl(urlsplit(call.path).query))


def _selector(call: Call) -> list[str]:
    """The field-selector clauses of the recorded request, in wire order."""
    return _query(call)["fieldSelector"].split(",")


def _names(result: Any) -> list[str]:
    return [event["metadata"]["name"] for event in result["result"]]


def _text_body(*events: dict[str, Any]) -> bytes:
    """An EventList as the JSON text the cluster serves for both text formats."""
    return json.dumps(_event_list(*events)).encode()


def _text_names(output_format: str, result: Any) -> list[str]:
    """The event names inside the JSON or YAML text 'result' holds, in text order."""
    text = result["result"]
    document = json.loads(text) if output_format == "json" else yaml.safe_load(text)
    return [event["metadata"]["name"] for event in document["items"]]


def _construction(fake: FakeK8sClient) -> tuple[Any, Any]:
    """The context and timeout the plugin handed the REST core."""
    call = fake.factory.call_args
    context = call.args[0] if call.args else call.kwargs["context"]
    if "timeout" in call.kwargs:
        return context, call.kwargs["timeout"]
    return context, call.args[1] if len(call.args) > 1 else None


def _impersonation(fake: FakeK8sClient) -> tuple[Any, Any]:
    """Impersonation as it reaches the core: the two constructor keywords."""
    kwargs = fake.factory.call_args.kwargs
    return kwargs.get("impersonate_user"), kwargs.get("impersonate_groups")


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_plugin_instantiates(self) -> None:
        assert K8sEventsPlugin() is not None

    def test_identity(self) -> None:
        meta = K8sEventsPlugin().metadata

        assert meta["id"] == "k8s-events"
        assert meta["name"] == "K8s Events"
        assert meta["category"] == "kubernetes"
        assert meta["version"] == "1.0.0"
        assert meta["return_type"] == "map"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sEventsPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_remotable_is_true(self) -> None:
        assert K8sEventsPlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sEventsPlugin().metadata["proxy_support"] == "supported"

    def test_session_is_the_only_required_parameter(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["session"]["required"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("required") is False

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["scope_to_object"]["type"] == "boolean"
        assert params["object_type"]["type"] == "string"
        assert params["object_kind"]["type"] == "string"
        assert params["object_kind_custom"]["type"] == "string"
        assert params["object_name"]["type"] == "string"
        assert params["event_type"]["type"] == "string"
        assert params["reason"]["type"] == "string"
        assert params["within_seconds"]["type"] == "integer"
        assert params["max_events"]["type"] == "integer"
        assert params["output_format"]["type"] == "string"
        assert params["all_namespaces"]["type"] == "boolean"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_defaults(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["timeout"]["default"] == 30
        assert params["scope_to_object"]["default"] is False
        assert params["object_type"]["default"] == "default"
        assert params["object_kind"]["default"] == "Pod"
        assert params["event_type"]["default"] == "any"
        assert params["output_format"]["default"] == "map"
        assert params["all_namespaces"]["default"] is False
        assert params["on_error"]["default"] == "fail"

    def test_the_two_limits_have_no_default(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["within_seconds"].get("default") is None
        assert params["max_events"].get("default") is None

    def test_session_is_the_only_secret_parameter(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        for name in (
            "session",
            "object_kind",
            "object_kind_custom",
            "object_name",
            "reason",
            "namespace",
            "impersonate_user",
            "impersonate_groups",
        ):
            assert params[name]["trim"] is True

    def test_enum_values(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["object_type"]["enum_values"] == ["default", "custom"]
        assert params["event_type"]["enum_values"] == ["any", "Warning", "Normal"]
        assert params["output_format"]["enum_values"] == ["map", "table", "json", "yaml"]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_the_four_mode_params_and_the_object_kind_are_enum_validated(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        enum_params = {name for name, param in params.items() if "enum_values" in param}
        assert enum_params == {
            "object_type",
            "object_kind",
            "event_type",
            "output_format",
            "on_error",
        }

    def test_the_object_kind_is_the_stock_kind_choice_list(self) -> None:
        object_kind = _params_by_name(K8sEventsPlugin())["object_kind"]

        assert len(object_kind["enum_values"]) == 23
        assert object_kind["default"] in object_kind["enum_values"]

    def test_the_custom_kind_row_declares_no_enum_values(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert "enum_values" not in params["object_kind_custom"]

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sEventsPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_output_schema(self) -> None:
        outputs = K8sEventsPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("result", "array"),
            ("count", "integer"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_there_is_no_separate_events_output(self) -> None:
        names = [o["name"] for o in K8sEventsPlugin().metadata["output_schema"]]

        assert "events" not in names
        assert names == ["result", "count", "success", "error", "reason"]

    def test_no_output_is_secret_flagged(self) -> None:
        for output in K8sEventsPlugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sEventsPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name(K8sEventsPlugin())

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS

    def test_ordering_is_not_a_parameter(self) -> None:
        names = {p["name"] for p in K8sEventsPlugin().metadata["parameters"]}

        assert not names & {"sort", "sort_by", "order", "order_by", "newest_first"}


class TestConditionalRequirements:
    """The declarations the pre-run gate reads to refuse a half-filled block."""

    def test_object_kind_needs_scoping_and_the_default_object_type(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["object_kind"]["required_when_all"] == [
            {"field": "scope_to_object", "values": ["true"]},
            {"field": "object_type", "values": ["default"]},
        ]

    def test_object_kind_custom_needs_scoping_and_the_custom_object_type(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["object_kind_custom"]["required_when_all"] == [
            {"field": "scope_to_object", "values": ["true"]},
            {"field": "object_type", "values": ["custom"]},
        ]

    def test_object_name_needs_scoping_alone(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        assert params["object_name"]["required_when"] == {
            "field": "scope_to_object",
            "values": ["true"],
        }

    def test_only_the_three_object_rows_are_conditionally_required(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        conditional = [n for n in EXPECTED_PARAM_ORDER if required_conditions(params[n])]

        assert conditional == ["object_kind", "object_kind_custom", "object_name"]

    def test_no_conditionally_required_param_is_also_required(self) -> None:
        params = _params_by_name(K8sEventsPlugin())

        for name in ("object_kind", "object_kind_custom", "object_name"):
            assert params[name].get("required") is False

    def test_the_boolean_condition_uses_the_lowercase_convention(self) -> None:
        """Schemas spell a tick 'true', never Python's True."""
        params = _params_by_name(K8sEventsPlugin())

        for name in EXPECTED_PARAM_ORDER:
            for condition in required_conditions(params[name]):
                assert all(isinstance(value, str) for value in condition["values"])
                assert not {"True", "False"} & set(condition["values"])

    def test_every_condition_reads_a_field_that_declares_a_default(self) -> None:
        """The gate falls back to the referenced field's default, so it must have one."""
        params = _params_by_name(K8sEventsPlugin())

        for name in EXPECTED_PARAM_ORDER:
            for condition in required_conditions(params[name]):
                assert params[condition["field"]]["default"] is not None


class TestResultTypeRules:
    """Result declares the type its Output Format returns (K8SREAD-6)."""

    def test_result_declares_the_two_rules_in_order(self) -> None:
        result = _outputs_by_name(K8sEventsPlugin())["result"]

        assert result["type"] == "array"
        assert result["type_when"] == RESULT_TYPE_WHEN

    def test_no_other_output_carries_type_rules(self) -> None:
        outputs = _outputs_by_name(K8sEventsPlugin())

        for name, output in outputs.items():
            if name == "result":
                continue
            assert "type_when" not in output

    def test_the_declared_type_is_what_the_defaults_resolve_to(self) -> None:
        result = _outputs_by_name(K8sEventsPlugin())["result"]
        parameters = _params_by_name(K8sEventsPlugin())

        resolved = resolve_output_type(result["type"], result["type_when"], {}, parameters)

        assert resolved == "array"

    @pytest.mark.parametrize(("output_format", "expected"), RESULT_TYPE_MATRIX)
    def test_every_format_resolves(self, output_format: str, expected: str) -> None:
        result = _outputs_by_name(K8sEventsPlugin())["result"]

        resolved = resolve_output_type(
            result["type"], result["type_when"], {"output_format": output_format}
        )

        assert resolved == expected


class TestValidation:
    """validate() - the conditional object rows, the two limits, and the enums."""

    async def test_minimal_params_pass(self) -> None:
        await K8sEventsPlugin().validate(block_params())

    async def test_full_params_pass(self) -> None:
        await K8sEventsPlugin().validate(
            block_params(
                timeout=45,
                scope_to_object=True,
                object_type="default",
                object_kind="Pod",
                object_name="web-1",
                event_type="Warning",
                reason="BackOff",
                within_seconds=600,
                max_events=25,
                output_format="table",
                all_namespaces=False,
                namespace="ops",
                impersonate_user="qa-bot",
                impersonate_groups="qa,readers",
                on_error="record",
            )
        )

    async def test_missing_session(self) -> None:
        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sEventsPlugin().validate({})

    async def test_empty_session_reports_the_empty_case(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sEventsPlugin().validate(block_params(session=""))

    async def test_scoping_requires_the_object_kind(self) -> None:
        params = block_params(scope_to_object=True, object_name="web-1")

        with pytest.raises(ValueError, match=r"^Missing required parameter: object_kind$"):
            await K8sEventsPlugin().validate(params)

    async def test_scoping_requires_the_object_name(self) -> None:
        params = block_params(scope_to_object=True, object_kind="Pod")

        with pytest.raises(ValueError, match=r"^Missing required parameter: object_name$"):
            await K8sEventsPlugin().validate(params)

    async def test_an_empty_object_kind_is_missing(self) -> None:
        params = block_params(scope_to_object=True, object_kind="", object_name="web-1")

        with pytest.raises(ValueError, match=r"^Missing required parameter: object_kind$"):
            await K8sEventsPlugin().validate(params)

    async def test_an_empty_object_name_is_missing(self) -> None:
        params = block_params(scope_to_object=True, object_kind="Pod", object_name="")

        with pytest.raises(ValueError, match=r"^Missing required parameter: object_name$"):
            await K8sEventsPlugin().validate(params)

    async def test_the_custom_object_type_requires_the_custom_kind(self) -> None:
        params = block_params(scope_to_object=True, object_type="custom", object_name="web-1")

        with pytest.raises(ValueError, match=r"^Missing required parameter: object_kind_custom$"):
            await K8sEventsPlugin().validate(params)

    async def test_an_empty_custom_kind_is_missing(self) -> None:
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind_custom="",
            object_name="web-1",
        )

        with pytest.raises(ValueError, match=r"^Missing required parameter: object_kind_custom$"):
            await K8sEventsPlugin().validate(params)

    async def test_the_custom_object_type_needs_no_picked_kind(self) -> None:
        await K8sEventsPlugin().validate(
            block_params(
                scope_to_object=True,
                object_type="custom",
                object_kind_custom="VirtualService",
                object_name="web-1",
            )
        )

    async def test_the_default_object_type_needs_no_custom_kind(self) -> None:
        await K8sEventsPlugin().validate(
            block_params(
                scope_to_object=True,
                object_type="default",
                object_kind="Pod",
                object_name="web-1",
            )
        )

    async def test_object_type_enum_violation(self) -> None:
        message = (
            "Parameter 'object_type' must be one of: default, custom; Actual value was 'wrong'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sEventsPlugin().validate(block_params(object_type="wrong"))

    async def test_the_object_rows_are_not_required_while_scoping_is_off(self) -> None:
        await K8sEventsPlugin().validate(block_params())
        await K8sEventsPlugin().validate(block_params(scope_to_object=False))

    async def test_within_seconds_must_be_positive(self) -> None:
        message = "Parameter 'within_seconds' must be positive"

        for value in (0, -1, -600):
            with pytest.raises(ValueError, match=exact(message)):
                await K8sEventsPlugin().validate(block_params(within_seconds=value))

    async def test_max_events_must_be_positive(self) -> None:
        message = "Parameter 'max_events' must be positive"

        for value in (0, -1, -25):
            with pytest.raises(ValueError, match=exact(message)):
                await K8sEventsPlugin().validate(block_params(max_events=value))

    async def test_positive_limits_pass(self) -> None:
        await K8sEventsPlugin().validate(block_params(within_seconds=1, max_events=1))

    async def test_timeout_must_be_positive(self) -> None:
        message = "Parameter 'timeout' must be positive"

        for value in (0, -30):
            with pytest.raises(ValueError, match=exact(message)):
                await K8sEventsPlugin().validate(block_params(timeout=value))

    async def test_event_type_enum_violation(self) -> None:
        message = (
            "Parameter 'event_type' must be one of: any, Warning, Normal; "
            "Actual value was 'warning'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sEventsPlugin().validate(block_params(event_type="warning"))

    async def test_every_declared_event_type_passes(self) -> None:
        for value in ("any", "Warning", "Normal"):
            await K8sEventsPlugin().validate(block_params(event_type=value))

    async def test_output_format_enum_violation(self) -> None:
        message = (
            "Parameter 'output_format' must be one of: map, table, json, yaml; "
            "Actual value was 'xml'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sEventsPlugin().validate(block_params(output_format="xml"))

    async def test_on_error_enum_violation(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sEventsPlugin().validate(block_params(on_error="ignore"))

    async def test_invalid_parameters_still_raise_under_record(self) -> None:
        message = "Parameter 'max_events' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sEventsPlugin().validate(block_params(max_events=0, on_error="record"))

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        params = block_params(impersonate_groups="qa, ops")

        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sEventsPlugin().validate(params)

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sEventsPlugin().validate(
            block_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )


class TestExecuteRequest:
    """The path, the field selectors, and what the core is constructed with."""

    async def test_namespace_wide_read_uses_the_session_namespace(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(), fake)

        assert fake.last.method == "GET"
        assert _path(fake.last) == _NS_PATH
        assert _query(fake.last) == {}
        assert fake.last.body is None

    async def test_an_unscoped_read_runs_no_discovery(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(), fake)

        assert fake.discoveries == []
        assert len(fake.calls) == 1

    async def test_scoping_rides_the_involved_object_field_selector(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(scope_to_object=True, object_kind="Pod", object_name="web-1")

        await _execute(params, fake)

        assert _path(fake.last) == _NS_PATH
        assert _query(fake.last) == {
            "fieldSelector": "involvedObject.kind=Pod,involvedObject.name=web-1"
        }

    async def test_the_object_rows_are_ignored_while_scoping_is_off(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(
            scope_to_object=False,
            object_type="custom",
            object_kind="Pod",
            object_kind_custom="VirtualService",
            object_name="web-1",
        )

        await _execute(params, fake)

        assert _query(fake.last) == {}
        assert fake.discoveries == []

    async def test_the_default_object_type_puts_the_picked_kind_on_the_wire(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(
            scope_to_object=True,
            object_type="default",
            object_kind="Pod",
            object_kind_custom="VirtualService",
            object_name="web-1",
        )

        await _execute(params, fake)

        assert _selector(fake.last)[0] == "involvedObject.kind=Pod"

    async def test_the_custom_object_type_puts_the_typed_kind_on_the_wire(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources=_ISTIO)
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind="Pod",
            object_kind_custom="VirtualService",
            object_name="web-1",
        )

        await _execute(params, fake)

        assert _selector(fake.last)[0] == "involvedObject.kind=VirtualService"

    async def test_the_custom_kind_is_trimmed_before_discovery(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources=_ISTIO)
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind_custom="  VirtualService  ",
            object_name="web-1",
        )

        await _execute(params, fake)

        assert fake.discoveries == ["VirtualService"]
        assert _selector(fake.last)[0] == "involvedObject.kind=VirtualService"

    @pytest.mark.parametrize("object_type", ["default", "custom"])
    async def test_object_type_never_reaches_the_wire(self, object_type: str) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources={**_POD_RESOURCE, **_ISTIO})
        params = block_params(
            scope_to_object=True,
            object_type=object_type,
            object_kind="Pod",
            object_kind_custom="VirtualService",
            object_name="web-1",
        )

        await _execute(params, fake)

        assert "object_type" not in _query(fake.last)

    async def test_the_custom_object_type_runs_discovery_too(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources=_ISTIO)
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind_custom="VirtualService",
            object_name="web-1",
        )

        await _execute(params, fake)

        assert fake.discoveries == ["VirtualService"]

    async def test_warning_filter_rides_the_field_selector(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST, event_type="Warning"))

        await _execute(block_params(event_type="Warning"), fake)

        assert _query(fake.last) == {"fieldSelector": "type=Warning"}

    async def test_normal_filter_rides_the_field_selector(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(event_type="Normal"), fake)

        assert _query(fake.last) == {"fieldSelector": "type=Normal"}

    async def test_any_event_type_puts_no_filter_on_the_wire(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(event_type="any"), fake)

        assert _query(fake.last) == {}

    async def test_reason_filter_rides_the_field_selector(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST, reason="BackOff"))

        await _execute(block_params(reason="BackOff"), fake)

        assert _query(fake.last) == {"fieldSelector": "reason=BackOff"}

    async def test_every_filter_rides_one_field_selector(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST, event_type="Warning", reason="BackOff"))
        params = block_params(
            scope_to_object=True,
            object_type="default",
            object_kind="Pod",
            object_name="web-1",
            event_type="Warning",
            reason="BackOff",
        )

        await _execute(params, fake)

        assert _selector(fake.last) == [
            "involvedObject.kind=Pod",
            "involvedObject.name=web-1",
            "type=Warning",
            "reason=BackOff",
        ]

    async def test_max_age_is_applied_in_the_block_not_on_the_wire(self) -> None:
        fake = _listing(_event("new-evt", _ago(60)))

        await _execute(block_params(within_seconds=600), fake)

        assert _query(fake.last) == {}

    async def test_max_events_is_applied_in_the_block_not_on_the_wire(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(max_events=2), fake)

        assert _query(fake.last) == {}

    async def test_all_namespaces_reads_the_cluster_wide_path(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(all_namespaces=True), fake)

        assert _path(fake.last) == _ALL_NS_PATH

    async def test_a_specified_namespace_overrides_the_session_default(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(namespace="ops"), fake)

        assert _path(fake.last) == "/api/v1/namespaces/ops/events"

    async def test_all_namespaces_wins_over_a_specified_namespace(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(all_namespaces=True, namespace="ops")

        await _execute(params, fake)

        assert _path(fake.last) == _ALL_NS_PATH

    async def test_the_core_receives_the_session_context_and_timeout(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(timeout=45), fake)

        context, timeout = _construction(fake)
        assert context.server == SERVER
        assert context.token == "sa-tok"
        assert context.namespace == NAMESPACE
        assert timeout == 45

    async def test_the_core_timeout_defaults_to_30(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(), fake)

        assert _construction(fake)[1] == 30

    async def test_impersonation_rows_reach_the_core(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(impersonate_user="qa-bot", impersonate_groups="qa,readers")

        await _execute(params, fake)

        assert _impersonation(fake) == ("qa-bot", ["qa", "readers"])

    async def test_no_impersonation_by_default(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        await _execute(block_params(), fake)

        assert _impersonation(fake) == (None, None)


class TestScopedKindResolution:
    """The Object Kind is resolved through discovery, the way kubectl resolves it."""

    @pytest.mark.parametrize("typed", ["Pod", "pod", "pods", "po"])
    async def test_any_name_kubectl_accepts_reaches_the_wire_as_the_canonical_kind(
        self, typed: str
    ) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources={typed: resource("Pod", "pods")})
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind_custom=typed,
            object_name="web-1",
        )

        await _execute(params, fake)

        assert fake.discoveries == [typed]
        assert _selector(fake.last)[0] == "involvedObject.kind=Pod"

    async def test_the_selector_carries_no_api_version_clause(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(scope_to_object=True, object_kind="Pod", object_name="web-1")

        await _execute(params, fake)

        assert _selector(fake.last) == [
            "involvedObject.kind=Pod",
            "involvedObject.name=web-1",
        ]

    async def test_a_kind_the_cluster_does_not_serve_fails_the_block(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources={})
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind_custom="Widget",
            object_name="web-1",
        )
        message = (
            "This cluster has no resource kind 'Widget' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(params, fake)

        assert fake.calls == []

    async def test_a_discovery_miss_is_recordable(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources={})
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind_custom="Widget",
            object_name="web-1",
            on_error="record",
        )

        result = await _execute(params, fake)

        assert result == {
            "result": [],
            "count": 0,
            "success": False,
            "error": (
                "This cluster has no resource kind 'Widget' "
                "- check the spelling, or whether the CRD is installed"
            ),
            "reason": "NotFound",
            "__block_warning": True,
        }

    async def test_a_denied_discovery_walk_renders_the_credential_row(self) -> None:
        fake = DeniedDiscoveryClient(401, _UNAUTHORIZED_BODY)
        params = block_params(scope_to_object=True, object_kind="Pod", object_name="web-1")

        with pytest.raises(ValueError, match=exact(_UNAUTHORIZED_MESSAGE)):
            await _execute(params, fake)

        assert fake.discoveries == ["Pod"]
        assert fake.calls == []

    async def test_a_denied_discovery_walk_is_recordable(self) -> None:
        fake = DeniedDiscoveryClient(403, _FORBIDDEN_BODY)
        params = block_params(
            scope_to_object=True, object_kind="Pod", object_name="web-1", on_error="record"
        )

        result = await _execute(params, fake)

        assert result["success"] is False
        assert result["error"] == _FORBIDDEN_MESSAGE
        assert result["reason"] == "Forbidden"
        assert result["__block_warning"] is True


class TestManagedFieldsAreStripped:
    """kubectl hides metadata.managedFields by default, and so does every output format."""

    async def test_the_map_format_drops_them(self) -> None:
        fake = _listing(_managed_event("new-evt", _NEWEST))

        result = await _execute(block_params(), fake)

        assert "managedFields" not in result["result"][0]["metadata"]
        assert result["result"][0]["metadata"]["name"] == "new-evt"

    async def test_the_json_format_drops_them(self) -> None:
        body = json.dumps(_event_list(_managed_event("new-evt", _NEWEST))).encode()
        fake = _serving(200, body)

        result = await _execute(block_params(output_format="json"), fake)

        assert "managedFields" not in result["result"]
        assert json.loads(result["result"])["items"][0]["metadata"]["name"] == "new-evt"

    async def test_the_yaml_format_drops_them(self) -> None:
        body = json.dumps(_event_list(_managed_event("new-evt", _NEWEST))).encode()
        fake = _serving(200, body)

        result = await _execute(block_params(output_format="yaml"), fake)

        assert "managedFields" not in result["result"]
        assert yaml.safe_load(result["result"])["items"][0]["metadata"]["name"] == "new-evt"

    async def test_the_table_format_drops_them_from_the_embedded_events(self) -> None:
        table = _table_body()
        table["rows"][0]["object"]["metadata"]["managedFields"] = _MANAGED_FIELDS
        fake = _serving(200, table)

        result = await _execute(block_params(output_format="table"), fake)

        assert "managedFields" not in table["rows"][0]["object"]["metadata"]
        assert result["count"] == 2


class TestExecuteOrderingAndLimits:
    """Fixed newest-first ordering, the age filter, and the max-events cut."""

    async def test_events_come_back_newest_first(self) -> None:
        fake = _listing(
            _event("mid-evt", _MIDDLE),
            _event("old-evt", _OLDEST),
            _event("new-evt", _NEWEST),
        )

        result = await _execute(block_params(), fake)

        assert _names(result) == ["new-evt", "mid-evt", "old-evt"]

    async def test_count_reflects_the_returned_events(self) -> None:
        fake = _listing(
            _event("mid-evt", _MIDDLE),
            _event("old-evt", _OLDEST),
            _event("new-evt", _NEWEST),
        )

        result = await _execute(block_params(), fake)

        assert result["count"] == 3

    async def test_max_events_truncates_after_the_sort(self) -> None:
        fake = _listing(
            _event("mid-evt", _MIDDLE),
            _event("old-evt", _OLDEST),
            _event("new-evt", _NEWEST),
        )

        result = await _execute(block_params(max_events=2), fake)

        assert _names(result) == ["new-evt", "mid-evt"]
        assert result["count"] == 2

    async def test_max_events_above_the_returned_count_changes_nothing(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), _event("old-evt", _OLDEST))

        result = await _execute(block_params(max_events=10), fake)

        assert _names(result) == ["new-evt", "old-evt"]
        assert result["count"] == 2

    async def test_max_age_drops_older_events(self) -> None:
        fake = _listing(_event("fresh-evt", _ago(60)), _event("stale-evt", _ago(7200)))

        result = await _execute(block_params(within_seconds=600), fake)

        assert _names(result) == ["fresh-evt"]
        assert result["count"] == 1

    async def test_an_unset_max_age_keeps_every_event(self) -> None:
        fake = _listing(_event("fresh-evt", _ago(60)), _event("stale-evt", _ago(7200)))

        result = await _execute(block_params(), fake)

        assert _names(result) == ["fresh-evt", "stale-evt"]

    async def test_an_empty_namespace_is_a_successful_empty_read(self) -> None:
        fake = _listing()

        result = await _execute(block_params(), fake)

        assert result["result"] == []
        assert result["count"] == 0
        assert result["success"] is True


class TestEventsWithNoTimestamp:
    """An event with none of the four stamps sorts as the oldest thing there is."""

    async def test_an_undated_event_sorts_last(self) -> None:
        fake = _listing(
            _undated_event("undated-evt"),
            _event("old-evt", _OLDEST),
            _event("new-evt", _NEWEST),
        )

        result = await _execute(block_params(), fake)

        assert _names(result) == ["new-evt", "old-evt", "undated-evt"]

    async def test_an_undated_event_is_still_returned_and_counted(self) -> None:
        fake = _listing(_undated_event("undated-evt"))

        result = await _execute(block_params(), fake)

        assert _names(result) == ["undated-evt"]
        assert result["count"] == 1
        assert result["success"] is True

    async def test_any_max_age_drops_an_undated_event(self) -> None:
        """It reads as 1970, so it is outside every window an author can ask for."""
        fake = _listing(_undated_event("undated-evt"), _event("fresh-evt", _ago(60)))

        result = await _execute(block_params(within_seconds=600), fake)

        assert _names(result) == ["fresh-evt"]
        assert result["count"] == 1

    async def test_the_max_events_cut_keeps_the_dated_event(self) -> None:
        fake = _listing(_undated_event("undated-evt"), _event("new-evt", _NEWEST))

        result = await _execute(block_params(max_events=1), fake)

        assert _names(result) == ["new-evt"]

    async def test_a_table_row_with_no_timestamp_takes_the_same_fallback(self) -> None:
        body = _table_body()
        body["rows"] = [
            _undated_table_row("undated-evt", "Undated"),
            _table_row(
                ["30s", "Warning", "BackOff", "pod/web-1", 3, _OLDEST, "Back-off restarting"],
                "web-1.17a",
                _NEWEST,
            ),
        ]
        fake = _serving(200, body)

        result = await _execute(block_params(output_format="table"), fake)

        table = as_table(result["result"])
        assert table is not None
        assert [row["Reason"] for row in table.to_list()] == ["BackOff", "Undated"]


class TestExecuteOutputFormat:
    """result carries the four shapes Get carries."""

    async def test_map_returns_the_parsed_events(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST, event_type="Warning", reason="BackOff"))

        result = await _execute(block_params(output_format="map"), fake)

        assert fake.last.accept is None
        assert fake.last.raw is False
        assert result["result"][0]["reason"] == "BackOff"
        assert result["result"][0]["type"] == "Warning"

    async def test_map_is_the_default_format(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        result = await _execute(block_params(), fake)

        assert _names(result) == ["new-evt"]

    async def test_table_asks_the_cluster_to_print_one(self) -> None:
        fake = _serving(200, _table_body())

        await _execute(block_params(output_format="table"), fake)

        assert fake.last.accept == TABLE_ACCEPT
        assert fake.last.raw is False

    async def test_table_returns_a_wave_table_and_costs_one_request(self) -> None:
        fake = _serving(200, _table_body())

        result = await _execute(block_params(output_format="table"), fake)

        assert isinstance(result["result"], Table)
        assert len(fake.calls) == 1

    async def test_table_carries_every_column_verbatim(self) -> None:
        fake = _serving(200, _table_body())

        result = await _execute(block_params(output_format="table"), fake)

        table = as_table(result["result"])
        assert table is not None
        assert table.col_names() == [
            "Last Seen",
            "Type",
            "Reason",
            "Object",
            "Count",
            "First Seen",
            "Message",
        ]

    async def test_table_column_types_follow_the_cluster(self) -> None:
        fake = _serving(200, _table_body())

        result = await _execute(block_params(output_format="table"), fake)

        table = as_table(result["result"])
        assert table is not None
        assert table.col_types() == [
            "string",
            "string",
            "string",
            "string",
            "integer",
            "string",
            "string",
        ]

    async def test_table_rows_carry_every_cell(self) -> None:
        fake = _serving(200, _table_body())

        result = await _execute(block_params(output_format="table"), fake)

        table = as_table(result["result"])
        assert table is not None
        assert table.to_list()[0] == {
            "Last Seen": "30s",
            "Type": "Warning",
            "Reason": "BackOff",
            "Object": "pod/web-1",
            "Count": 3,
            "First Seen": _OLDEST,
            "Message": "Back-off restarting",
        }

    async def test_a_column_whose_cells_disagree_downgrades_to_string(self) -> None:
        fake = _serving(200, _table_body(second_count="n/a"))

        result = await _execute(block_params(output_format="table"), fake)

        table = as_table(result["result"])
        assert table is not None
        assert table.col_types()[4] == "string"
        assert [row["Count"] for row in table.to_list()] == ["3", "n/a"]

    async def test_table_count_is_the_row_count(self) -> None:
        fake = _serving(200, _table_body())

        result = await _execute(block_params(output_format="table"), fake)

        assert result["count"] == 2

    async def test_json_returns_the_response_text_verbatim(self) -> None:
        fake = _serving(200, _JSON_BODY)

        result = await _execute(block_params(output_format="json"), fake)

        assert fake.last.raw is True
        assert fake.last.accept is None
        assert result["result"] == _JSON_BODY.decode()
        assert result["count"] == 2

    async def test_yaml_asks_the_cluster_for_json_and_renders_the_yaml_itself(self) -> None:
        fake = _serving(200, _YAML_DOCUMENT_AS_JSON)

        result = await _execute(block_params(output_format="yaml"), fake)

        assert fake.last.raw is True
        assert fake.last.accept is None
        assert result["result"] == _YAML_BODY.decode()
        assert result["count"] == 2

    async def test_the_text_formats_return_a_string(self) -> None:
        for output_format, body in (("json", _JSON_BODY), ("yaml", _YAML_DOCUMENT_AS_JSON)):
            result = await _execute(block_params(output_format=output_format), _serving(200, body))

            assert isinstance(result["result"], str)

    async def test_table_asks_for_the_full_object_in_every_row(self) -> None:
        fake = _serving(200, _table_body())

        await _execute(block_params(output_format="table"), fake)

        assert _query(fake.last) == {"includeObject": "Object"}

    async def test_table_keeps_the_field_selector_alongside_the_full_object_ask(self) -> None:
        fake = _serving(200, _table_body())

        await _execute(block_params(output_format="table", event_type="Warning"), fake)

        assert _query(fake.last) == {"fieldSelector": "type=Warning", "includeObject": "Object"}

    async def test_json_text_is_ordered_newest_first(self) -> None:
        body = _text_body(
            _event("mid-evt", _MIDDLE),
            _event("old-evt", _OLDEST),
            _event("new-evt", _NEWEST),
        )

        result = await _execute(block_params(output_format="json"), _serving(200, body))

        assert _text_names("json", result) == ["new-evt", "mid-evt", "old-evt"]
        assert result["count"] == 3

    async def test_yaml_text_is_ordered_newest_first(self) -> None:
        body = _text_body(
            _event("mid-evt", _MIDDLE),
            _event("old-evt", _OLDEST),
            _event("new-evt", _NEWEST),
        )

        result = await _execute(block_params(output_format="yaml"), _serving(200, body))

        assert _text_names("yaml", result) == ["new-evt", "mid-evt", "old-evt"]
        assert result["count"] == 3

    async def test_json_text_keeps_only_the_newest_event_under_both_limits(self) -> None:
        body = _text_body(
            _event("mid-evt", _ago(300)),
            _event("stale-evt", _ago(7200)),
            _event("fresh-evt", _ago(60)),
        )
        params = block_params(output_format="json", within_seconds=600, max_events=1)

        result = await _execute(params, _serving(200, body))

        assert _text_names("json", result) == ["fresh-evt"]
        assert "stale-evt" not in result["result"]
        assert result["count"] == 1

    async def test_yaml_text_keeps_only_the_newest_event_under_both_limits(self) -> None:
        body = _text_body(
            _event("mid-evt", _ago(300)),
            _event("stale-evt", _ago(7200)),
            _event("fresh-evt", _ago(60)),
        )
        params = block_params(output_format="yaml", within_seconds=600, max_events=1)

        result = await _execute(params, _serving(200, body))

        assert _text_names("yaml", result) == ["fresh-evt"]
        assert "stale-evt" not in result["result"]
        assert result["count"] == 1


class TestOutputFormatTableUnsupported:
    """A cluster that will not print a table says so in house wording, as Get does."""

    async def test_a_406_says_the_cluster_will_not_print_a_table(self) -> None:
        body = {
            "kind": "Status",
            "status": "Failure",
            "reason": "NotAcceptable",
            "message": "only the following media types are accepted: application/json",
            "code": 406,
        }

        with pytest.raises(ValueError, match=exact(_TABLE_UNSUPPORTED_MESSAGE)):
            await _execute(block_params(output_format="table"), _serving(406, body))

    async def test_a_plain_event_list_body_says_the_cluster_will_not_print_a_table(self) -> None:
        body = _event_list(_event("new-evt", _NEWEST))

        with pytest.raises(ValueError, match=exact(_TABLE_UNSUPPORTED_MESSAGE)):
            await _execute(block_params(output_format="table"), _serving(200, body))

    async def test_the_other_formats_never_meet_the_table_arm(self) -> None:
        body = _event_list(_event("new-evt", _NEWEST))

        result = await _execute(block_params(output_format="map"), _serving(200, body))

        assert _names(result) == ["new-evt"]

    async def test_record_mode_records_it_with_the_not_acceptable_reason(self) -> None:
        body = _event_list(_event("new-evt", _NEWEST))
        params = block_params(output_format="table", on_error="record")

        result = await _execute(params, _serving(200, body))

        assert result["success"] is False
        assert result["error"] == _TABLE_UNSUPPORTED_MESSAGE
        assert result["reason"] == "NotAcceptable"
        assert result["count"] == 0
        assert isinstance(result["result"], Table)


class TestOutputCore:
    """The output core and failure handling on every leg."""

    async def test_happy_path_reports_success(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        result = await _execute(block_params(), fake)

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_a_cluster_error_raises_by_default(self) -> None:
        fake = _serving(403, _FORBIDDEN_BODY)

        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            await _execute(block_params(), fake)

    async def test_a_cluster_error_is_recorded_under_record(self) -> None:
        fake = _serving(403, _FORBIDDEN_BODY)

        result = await _execute(block_params(on_error="record"), fake)

        assert result["success"] is False
        assert result["error"] == _FORBIDDEN_MESSAGE
        assert result["reason"] == "Forbidden"

    async def test_a_recorded_failure_returns_an_empty_result_in_the_declared_type(self) -> None:
        fake = _serving(403, _FORBIDDEN_BODY)

        result = await _execute(block_params(on_error="record"), fake)

        assert result["result"] == []
        assert result["count"] == 0

    async def test_a_recorded_failure_returns_an_empty_table_under_table(self) -> None:
        fake = _serving(403, _FORBIDDEN_BODY)

        result = await _execute(block_params(on_error="record", output_format="table"), fake)

        assert isinstance(result["result"], Table)
        assert result["result"].row_count() == 0

    async def test_a_recorded_failure_returns_empty_text_under_json(self) -> None:
        fake = _serving(403, json.dumps(_FORBIDDEN_BODY).encode())

        result = await _execute(block_params(on_error="record", output_format="json"), fake)

        assert result["result"] == ""

    async def test_an_authentication_failure_is_recorded_with_its_reason(self) -> None:
        fake = _serving(401, _UNAUTHORIZED_BODY)

        result = await _execute(block_params(on_error="record"), fake)

        assert result["error"] == _UNAUTHORIZED_MESSAGE
        assert result["reason"] == "Unauthorized"

    async def test_an_authentication_failure_raises_by_default(self) -> None:
        fake = _serving(401, _UNAUTHORIZED_BODY)

        with pytest.raises(ValueError, match=exact(_UNAUTHORIZED_MESSAGE)):
            await _execute(block_params(), fake)

    async def test_a_server_error_says_the_list_failed_and_names_the_kind_once(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = {"kind": "Status", "reason": "ServiceUnavailable", "message": detail, "code": 503}
        fake = _serving(503, body)
        message = f"Kubernetes could not list Event objects in namespace '{NAMESPACE}': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(block_params(), fake)

    async def test_a_server_error_is_recorded_with_its_reason(self) -> None:
        detail = "Internal error occurred: rpc error: code = Unknown"
        body = {"kind": "Status", "reason": "InternalError", "message": detail, "code": 500}
        fake = _serving(500, body)

        result = await _execute(block_params(on_error="record"), fake)

        assert result["error"] == (
            f"Kubernetes could not list Event objects in namespace '{NAMESPACE}': {detail}"
        )
        assert result["reason"] == "InternalError"

    async def test_a_bogus_session_raises_in_both_modes(self) -> None:
        for on_error in ("fail", "record"):
            params = {"session": "not-a-kubeconfig", "on_error": on_error}

            with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
                await _execute(params, _listing())

    async def test_a_missing_session_raises_in_both_modes(self) -> None:
        for on_error in ("fail", "record"):
            with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
                await _execute({"on_error": on_error}, _listing())

    async def test_a_transport_failure_raises_in_both_modes(self) -> None:
        for on_error in ("fail", "record"):
            fake = FakeK8sClient(responses=[K8sApiError(_TRANSPORT_MESSAGE)])

            with pytest.raises(K8sApiError, match=exact(_TRANSPORT_MESSAGE)):
                await _execute(block_params(on_error=on_error), fake)

    async def test_a_tls_failure_raises_in_both_modes(self) -> None:
        message = f"Could not verify the TLS certificate of {SERVER}: unknown issuer"

        for on_error in ("fail", "record"):
            fake = FakeK8sClient(responses=[K8sApiError(message)])

            with pytest.raises(K8sApiError, match=exact(message)):
                await _execute(block_params(on_error=on_error), fake)

    async def test_a_timeout_raises_in_both_modes(self) -> None:
        for on_error in ("fail", "record"):
            fake = FakeK8sClient(responses=[K8sApiError(_TIMEOUT_MESSAGE)])

            with pytest.raises(K8sApiError, match=exact(_TIMEOUT_MESSAGE)):
                await _execute(block_params(on_error=on_error), fake)

    async def test_the_event_reason_filter_does_not_collide_with_the_outcome_reason(self) -> None:
        fake = _serving(403, _FORBIDDEN_BODY)

        result = await _execute(block_params(reason="BackOff", on_error="record"), fake)

        assert _query(fake.last) == {"fieldSelector": "reason=BackOff"}
        assert result["reason"] == "Forbidden"

    async def test_the_outcome_reason_is_empty_on_a_filtered_success(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST, reason="BackOff"))

        result = await _execute(block_params(reason="BackOff"), fake)

        assert _query(fake.last) == {"fieldSelector": "reason=BackOff"}
        assert result["result"][0]["reason"] == "BackOff"
        assert result["reason"] == ""


class TestGatewayAnswers:
    """Something other than the cluster answering reads the same as it does in Get."""

    async def test_401_with_a_body_that_is_not_a_status_ends_with_the_http_status(self) -> None:
        fake = _serving(401, {})
        message = f"Kubernetes could not list Event objects in namespace '{NAMESPACE}' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(block_params(), fake)

    async def test_403_with_a_body_that_is_not_a_status_is_recordable(self) -> None:
        fake = _serving(403, {})

        result = await _execute(block_params(on_error="record"), fake)

        assert result["error"] == (
            f"Kubernetes could not list Event objects in namespace '{NAMESPACE}' (HTTP 403)"
        )
        assert result["reason"] == ""

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_a_gateway_page_at_200_fails_the_block(self, output_format: str) -> None:
        fake = _serving(200, GATEWAY_HTML)

        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            await _execute(block_params(output_format=output_format), fake)

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_record_mode_does_not_soften_it(self, output_format: str) -> None:
        fake = _serving(200, GATEWAY_HTML)

        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            await _execute(block_params(output_format=output_format, on_error="record"), fake)

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_a_gateway_401_reads_the_same_in_every_output_format(
        self, output_format: str
    ) -> None:
        fake = _serving(401, GATEWAY_HTML)
        message = f"Kubernetes could not list Event objects in namespace '{NAMESPACE}' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(block_params(output_format=output_format), fake)


class TestSessionMessagesAcrossVariableResolution:
    """A declared variable with no value holds null, and a session given null fails the
    run before the block and names the setting (REQ-3.1.3.21); a blank Block field is
    still a missing session."""

    @staticmethod
    def _resolve_session(raw_variables: dict[str, Any], source: str | None) -> dict[str, Any]:
        from wavecore.api.services.workbench.service import _flatten_variables
        from wavecore.core.execution.plugin_executor import resolve_parameters

        literals, _expr_map, _tmpl_map = _flatten_variables(raw_variables)
        return resolve_parameters(
            parameters={"session": source},
            expression_fields={"session"},
            variables=literals,
            parameter_types={"session": "string"},
            trim_fields={"session"},
        )

    @staticmethod
    def _resolve_gated_session(raw_variables: dict[str, Any], source: str) -> dict[str, Any]:
        """Resolve the session as a run does, with the block's own null policies."""
        from wavecore.api.services.workbench.service import _flatten_variables
        from wavecore.core.execution import plugin_executor

        literals, _expr_map, _tmpl_map = _flatten_variables(raw_variables)
        return plugin_executor.resolve_parameters(
            parameters={"session": source},
            expression_fields={"session"},
            variables=literals,
            parameter_types={"session": "string"},
            trim_fields={"session"},
            null_policies=plugin_executor.null_policy_fields(
                K8sEventsPlugin().metadata["parameters"]
            ),
        )

    def test_a_variable_with_no_value_fails_the_run_before_the_block(self) -> None:
        from wavecore.core.expressions import errors

        with pytest.raises(errors.NullValueError, match=exact("'session' is null")):
            self._resolve_gated_session({"k8s_session": {"type": "string"}}, "k8s_session")

    def test_a_secret_variable_with_no_value_fails_the_run_before_the_block(self) -> None:
        from wavecore.core.expressions import errors

        with pytest.raises(errors.NullValueError, match=exact("'session' is null")):
            self._resolve_gated_session(
                {"k8s_session": {"type": "string", "secret": True}}, "k8s_session"
            )

    async def test_a_blank_block_field_still_reads_as_missing(self) -> None:
        params = self._resolve_session({"k8s_session": {"type": "string"}}, "   ")

        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sEventsPlugin().validate(params)

    async def test_a_filled_variable_still_reaches_the_block(self) -> None:
        params = self._resolve_session(
            {"k8s_session": {"type": "string", "value": session_value()}}, "k8s_session"
        )

        await K8sEventsPlugin().validate(params)


class TestRecordedFailureIsAmber:
    """A recorded cluster refusal asks for amber and says why at WARN (K8SREAD-10)."""

    async def test_a_recorded_denial_carries_the_warning_signal(self) -> None:
        fake = _serving(403, _FORBIDDEN_BODY)

        result = await _execute(block_params(on_error="record"), fake)

        assert result["__block_warning"] is True

    async def test_a_recorded_denial_logs_the_warn_line(self) -> None:
        fake = _serving(403, _FORBIDDEN_BODY)
        logger = MagicMock()

        await _execute(block_params(on_error="record"), fake, logger)

        logger.warn.assert_called_once_with(f"Read failed (Forbidden): {_FORBIDDEN_MESSAGE}")

    async def test_a_happy_read_logs_info_and_asks_for_nothing(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        logger = MagicMock()

        result = await _execute(block_params(on_error="record"), fake, logger)

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0
        assert logger.info.call_count == 1

    async def test_fail_mode_logs_no_warn_line(self) -> None:
        fake = _serving(403, _FORBIDDEN_BODY)
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(block_params(), fake, logger)

        assert logger.warn.call_count == 0


class TestOutputGating:
    """Error and Reason render only under Record and continue; Success never hides."""

    def test_error_and_reason_render_only_under_record_and_continue(self) -> None:
        outputs = _outputs_by_name(K8sEventsPlugin())

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE

    def test_success_carries_no_gate(self) -> None:
        """Success stays visible in both On error modes, deliberately."""
        outputs = _outputs_by_name(K8sEventsPlugin())

        assert "show_when" not in outputs["success"]

    def test_only_error_and_reason_are_gated(self) -> None:
        gated = {o["name"] for o in K8sEventsPlugin().metadata["output_schema"] if "show_when" in o}

        assert gated == {"error", "reason"}
