"""K8s Get plugin tests (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

Get reads any kind by name, by label/field selector, or as a plain list, and
renders the answer as a map, a WAVE table, raw JSON text or raw YAML text. It
carries the shared success/error/reason output core and the fail-or-record
Failure Handling control.
"""

import base64
import json
import urllib.parse
from typing import Any
from unittest.mock import MagicMock, patch

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
    DeniedDiscoveryClient,
    FakeK8sClient,
    block_params,
    exact,
    execute_context,
    required_conditions,
    resource,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.core.table import Table
from wavecore.models.plugins import resolve_output_type
from wavecore.plugins.k8s_get import K8sGetPlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "resource_type",
    "kind",
    "kind_custom",
    "search_by",
    "name",
    "label_selector",
    "field_selector",
    "output_format",
    "all_namespaces",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

# Params 4.3 shows only under a mode; none of them is unconditionally required.
CONDITIONALLY_VISIBLE_PARAMS = [
    "kind",
    "kind_custom",
    "name",
    "label_selector",
    "field_selector",
    "all_namespaces",
    "namespace",
]

_CLIENT_TARGET = "wavecore.connectivity.k8s.verbs.get.K8sClient"
TABLE_ACCEPT = "application/json;as=Table;g=meta.k8s.io;v=v1,application/json"

# Result's declared type follows Output Format, and map splits on Search by (K8SREAD-6).
RESULT_TYPE_WHEN: list[dict[str, Any]] = [
    {"when": [{"field": "output_format", "values": ["table"]}], "type": "table"},
    {"when": [{"field": "output_format", "values": ["json", "yaml"]}], "type": "string"},
    {
        "when": [
            {"field": "output_format", "values": ["map"]},
            {"field": "search_by", "values": ["selector", "list"]},
        ],
        "type": "array",
    },
]

RESULT_TYPE_MATRIX = [
    ("map", "name", "map"),
    ("map", "selector", "array"),
    ("map", "list", "array"),
    ("table", "name", "table"),
    ("table", "selector", "table"),
    ("table", "list", "table"),
    ("json", "name", "string"),
    ("json", "selector", "string"),
    ("json", "list", "string"),
    ("yaml", "name", "string"),
    ("yaml", "selector", "string"),
    ("yaml", "list", "string"),
]

_POD = {
    "kind": "Pod",
    "apiVersion": "v1",
    "metadata": {"name": "web-1", "namespace": "apps"},
    "status": {"phase": "Running"},
}
_POD_ITEMS: list[dict[str, Any]] = [
    {"metadata": {"name": "web-1", "namespace": "apps"}, "status": {"phase": "Running"}},
    {"metadata": {"name": "web-2", "namespace": "apps"}, "status": {"phase": "Pending"}},
]
_POD_LIST = {
    "kind": "PodList",
    "apiVersion": "v1",
    "metadata": {"resourceVersion": "42"},
    "items": _POD_ITEMS,
}
_EMPTY_LIST = {
    "kind": "PodList",
    "apiVersion": "v1",
    "metadata": {"resourceVersion": "42"},
    "items": [],
}

_MANAGED_FIELDS = [
    {
        "manager": "kubectl-client-side-apply",
        "operation": "Update",
        "apiVersion": "v1",
        "time": "2026-08-20T10:00:00Z",
        "fieldsType": "FieldsV1",
        "fieldsV1": {"f:spec": {"f:containers": {}}},
    }
]


def _managed_pod() -> dict[str, Any]:
    """A Pod as the cluster stores it: metadata carries managedFields."""
    return {
        "kind": "Pod",
        "apiVersion": "v1",
        "metadata": {"name": "web-1", "namespace": "apps", "managedFields": _MANAGED_FIELDS},
        "status": {"phase": "Running"},
    }


def _managed_list() -> dict[str, Any]:
    return {
        "kind": "PodList",
        "apiVersion": "v1",
        "metadata": {"resourceVersion": "42"},
        "items": [_managed_pod()],
    }


_COLUMNS = [
    {"name": "Name", "type": "string", "format": "name", "description": "Object name."},
    {"name": "Ready", "type": "string", "format": "", "description": "Containers ready."},
    {"name": "Restart Count", "type": "integer", "format": "", "description": "Restarts."},
    {"name": "Cpu Ratio", "type": "number", "format": "", "description": "Cpu share."},
    {"name": "Scheduled", "type": "boolean", "format": "", "description": "Scheduled."},
    {"name": "Age", "type": "date", "format": "", "description": "Age."},
]


def _row(name: str, cells: list[Any]) -> dict[str, Any]:
    return {
        "cells": cells,
        "object": {
            "kind": "Pod",
            "apiVersion": "v1",
            "metadata": {"name": name, "namespace": "apps"},
        },
    }


_TABLE = {
    "kind": "Table",
    "apiVersion": "meta.k8s.io/v1",
    "columnDefinitions": _COLUMNS,
    "rows": [
        _row("web-1", ["web-1", "1/1", 3, 0.5, True, "4d"]),
        _row("web-2", ["web-2", "0/1", 0, 1.25, False, "2h"]),
    ],
}
_MIXED_TABLE = {
    "kind": "Table",
    "apiVersion": "meta.k8s.io/v1",
    "columnDefinitions": _COLUMNS,
    "rows": [
        _row("web-1", ["web-1", "1/1", 3, 0.5, True, "4d"]),
        _row("web-2", ["web-2", "0/1", "<none>", 1.25, False, "2h"]),
    ],
}


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


_BINARY_VALUE = base64.b64encode(b"\xff\xfe").decode()
_SECRET = {
    "kind": "Secret",
    "apiVersion": "v1",
    "metadata": {"name": "db-creds", "namespace": "apps"},
    "type": "Opaque",
    "data": {"username": _b64("admin"), "password": _b64("s3cr3t"), "keystore": _BINARY_VALUE},
}
# Both forms are masked: the plaintext AND the base64 the response body carries.
_SECRET_REGISTERED = ["admin", _b64("admin"), "s3cr3t", _b64("s3cr3t"), _BINARY_VALUE]

_SECRET_TABLE = {
    "kind": "Table",
    "apiVersion": "meta.k8s.io/v1",
    "columnDefinitions": [
        {"name": "Name", "type": "string", "format": "", "priority": 0},
        {"name": "Type", "type": "string", "format": "", "priority": 0},
        {"name": "Data", "type": "integer", "format": "", "priority": 0},
        {"name": "Age", "type": "string", "format": "", "priority": 0},
    ],
    "rows": [
        {
            "cells": ["db-creds", "Opaque", 3, "4d"],
            "object": {
                "kind": "PartialObjectMetadata",
                "apiVersion": "meta.k8s.io/v1",
                "metadata": {"name": "db-creds", "namespace": "apps"},
            },
        }
    ],
}

_PODS = {"Pod": resource("Pod", "pods")}
_NODES = {"Node": resource("Node", "nodes", namespaced=False)}
_DEPLOYMENTS = {"Deployment": resource("Deployment", "deployments", group_version="apps/v1")}
_SECRETS = {"Secret": resource("Secret", "secrets")}


def _params_by_name(plugin: K8sGetPlugin) -> dict[str, dict[str, Any]]:
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


def _outputs_by_name(plugin: K8sGetPlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _split(path: str) -> tuple[str, dict[str, list[str]]]:
    base, _, query = path.partition("?")
    return base, urllib.parse.parse_qs(query)


def _construction(fake: FakeK8sClient) -> tuple[Any, Any, dict[str, Any]]:
    call = fake.factory.call_args
    kwargs = dict(call.kwargs)
    context = call.args[0] if call.args else kwargs.pop("context", None)
    if "timeout" in kwargs:
        timeout = kwargs.pop("timeout")
    else:
        timeout = call.args[1] if len(call.args) > 1 else None
    return context, timeout, kwargs


def _failure(reason: str, message: str, code: int) -> dict[str, Any]:
    return {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
    }


def _name_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"kind": "Pod", "search_by": "name", "name": "web-1"}
    params.update(overrides)
    return block_params(**params)


def _list_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"kind": "Pod", "search_by": "list"}
    params.update(overrides)
    return block_params(**params)


async def _execute(
    fake: FakeK8sClient,
    params: dict[str, Any],
    register_secret: Any = None,
    logger: Any = None,
) -> Any:
    factory = MagicMock(return_value=fake)
    fake.factory = factory
    with patch(_CLIENT_TARGET, factory):
        return await K8sGetPlugin().execute(execute_context(params, register_secret, logger))


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_plugin_instantiates(self) -> None:
        assert K8sGetPlugin() is not None

    def test_identity(self) -> None:
        meta = K8sGetPlugin().metadata

        assert meta["id"] == "k8s-get"
        assert meta["name"] == "K8s Get"
        assert meta["category"] == "kubernetes"
        assert meta["version"] == "1.0.0"
        assert meta["return_type"] == "map"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sGetPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_remotable_is_true(self) -> None:
        assert K8sGetPlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sGetPlugin().metadata["proxy_support"] == "supported"

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        assert params["session"]["required"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("required") is False

    def test_conditionally_visible_params_are_never_descriptor_required(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        for name in CONDITIONALLY_VISIBLE_PARAMS:
            assert name in EXPECTED_PARAM_ORDER
            assert params[name].get("required") is False
        assert [n for n in EXPECTED_PARAM_ORDER if params[n].get("required")] == ["session"]

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["resource_type"]["type"] == "string"
        assert params["kind"]["type"] == "string"
        assert params["kind_custom"]["type"] == "string"
        assert params["search_by"]["type"] == "string"
        assert params["name"]["type"] == "string"
        assert params["label_selector"]["type"] == "string"
        assert params["field_selector"]["type"] == "string"
        assert params["output_format"]["type"] == "string"
        assert params["all_namespaces"]["type"] == "boolean"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_defaults(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        assert params["timeout"]["default"] == 30
        assert params["resource_type"]["default"] == "default"
        assert params["kind"]["default"] == "Pod"
        assert params["search_by"]["default"] == "name"
        assert params["output_format"]["default"] == "map"
        assert params["all_namespaces"]["default"] is False
        assert params["on_error"]["default"] == "fail"

    def test_session_is_the_only_secret_parameter(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        for name in (
            "session",
            "kind_custom",
            "name",
            "label_selector",
            "field_selector",
            "namespace",
            "impersonate_user",
            "impersonate_groups",
        ):
            assert params[name]["trim"] is True

    def test_enum_values(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        assert params["resource_type"]["enum_values"] == ["default", "custom"]
        assert params["search_by"]["enum_values"] == ["name", "selector", "list"]
        assert params["output_format"]["enum_values"] == ["map", "table", "json", "yaml"]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_kind_is_the_stock_kind_choice_list(self) -> None:
        kind = _params_by_name(K8sGetPlugin())["kind"]

        assert len(kind["enum_values"]) == 23
        assert kind["default"] in kind["enum_values"]

    def test_the_four_mode_params_and_the_kind_are_enums(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        enum_params = {name for name, param in params.items() if "enum_values" in param}
        assert enum_params == {"resource_type", "kind", "search_by", "output_format", "on_error"}

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sGetPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_output_schema(self) -> None:
        outputs = K8sGetPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("result", "map"),
            ("names", "array"),
            ("count", "integer"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_no_output_is_flagged_secret(self) -> None:
        outputs = _outputs_by_name(K8sGetPlugin())

        assert outputs["result"].get("secret") is not True
        for output in K8sGetPlugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sGetPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name(K8sGetPlugin())

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS


class TestConditionalRequirements:
    """The declarations the pre-run gate reads to refuse a half-filled block."""

    def test_kind_is_required_under_the_default_resource_type(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        assert params["kind"]["required_when"] == {
            "field": "resource_type",
            "values": ["default"],
        }

    def test_kind_custom_is_required_under_the_custom_resource_type(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        assert params["kind_custom"]["required_when"] == {
            "field": "resource_type",
            "values": ["custom"],
        }

    def test_name_is_required_under_search_by_name(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        assert params["name"]["required_when"] == {"field": "search_by", "values": ["name"]}

    def test_only_the_three_mode_bound_params_are_conditionally_required(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        conditional = [n for n in EXPECTED_PARAM_ORDER if required_conditions(params[n])]

        assert conditional == ["kind", "kind_custom", "name"]

    def test_no_conditionally_required_param_is_also_required(self) -> None:
        params = _params_by_name(K8sGetPlugin())

        for name in ("kind", "kind_custom", "name"):
            assert params[name].get("required") is False

    def test_every_condition_reads_a_field_that_declares_a_default(self) -> None:
        """The gate falls back to the referenced field's default, so it must have one."""
        params = _params_by_name(K8sGetPlugin())

        for name in EXPECTED_PARAM_ORDER:
            for condition in required_conditions(params[name]):
                assert params[condition["field"]]["default"] is not None


class TestResultTypeRules:
    """Result declares the type its Output Format and Search by return (K8SREAD-6)."""

    def test_result_declares_the_three_rules_in_order(self) -> None:
        result = _outputs_by_name(K8sGetPlugin())["result"]

        assert result["type"] == "map"
        assert result["type_when"] == RESULT_TYPE_WHEN

    def test_no_other_output_carries_type_rules(self) -> None:
        outputs = _outputs_by_name(K8sGetPlugin())

        for name, output in outputs.items():
            if name == "result":
                continue
            assert "type_when" not in output

    def test_the_declared_type_is_what_the_defaults_resolve_to(self) -> None:
        result = _outputs_by_name(K8sGetPlugin())["result"]
        parameters = _params_by_name(K8sGetPlugin())

        resolved = resolve_output_type(result["type"], result["type_when"], {}, parameters)

        assert resolved == "map"

    @pytest.mark.parametrize(("output_format", "search_by", "expected"), RESULT_TYPE_MATRIX)
    def test_every_format_and_search_mode_resolves(
        self, output_format: str, search_by: str, expected: str
    ) -> None:
        result = _outputs_by_name(K8sGetPlugin())["result"]
        values = {"output_format": output_format, "search_by": search_by}

        assert resolve_output_type(result["type"], result["type_when"], values) == expected


class TestValidation:
    """validate() - required params per mode, positivity, enums."""

    async def test_name_mode_minimal_params_pass(self) -> None:
        await K8sGetPlugin().validate(_name_params())

    async def test_full_params_pass(self) -> None:
        await K8sGetPlugin().validate(
            block_params(
                timeout=45,
                resource_type="custom",
                kind_custom="widgets",
                search_by="selector",
                label_selector="app=web",
                field_selector="status.phase=Running",
                output_format="table",
                all_namespaces=True,
                impersonate_user="dev",
                impersonate_groups="qa, ops",
                on_error="record",
            )
        )

    async def test_missing_session(self) -> None:
        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sGetPlugin().validate({"kind": "Pod", "name": "web-1"})

    async def test_empty_session_reports_the_empty_case(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sGetPlugin().validate(block_params(session="", kind="Pod", name="web-1"))

    async def test_missing_kind_under_the_default_resource_type(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind$"):
            await K8sGetPlugin().validate(block_params(search_by="list"))

    async def test_empty_kind_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind$"):
            await K8sGetPlugin().validate(block_params(kind="", search_by="list"))

    async def test_missing_kind_custom_under_the_custom_resource_type(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind_custom$"):
            await K8sGetPlugin().validate(block_params(resource_type="custom", search_by="list"))

    async def test_kind_is_not_required_under_the_custom_resource_type(self) -> None:
        await K8sGetPlugin().validate(
            block_params(resource_type="custom", kind_custom="widgets", search_by="list")
        )

    async def test_kind_custom_is_not_required_under_the_default_resource_type(self) -> None:
        await K8sGetPlugin().validate(block_params(kind="Pod", search_by="list"))

    async def test_missing_name_under_search_by_name(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sGetPlugin().validate(block_params(kind="Pod", search_by="name"))

    async def test_empty_name_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sGetPlugin().validate(block_params(kind="Pod", search_by="name", name=""))

    async def test_name_defaults_to_required_when_search_by_is_absent(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sGetPlugin().validate(block_params(kind="Pod"))

    async def test_name_is_not_required_under_search_by_selector(self) -> None:
        await K8sGetPlugin().validate(
            block_params(kind="Pod", search_by="selector", label_selector="app=web")
        )

    async def test_name_is_not_required_under_search_by_list(self) -> None:
        await K8sGetPlugin().validate(block_params(kind="Pod", search_by="list"))

    async def test_selector_mode_needs_no_selector_at_all(self) -> None:
        await K8sGetPlugin().validate(block_params(kind="Pod", search_by="selector"))

    async def test_resource_type_enum(self) -> None:
        message = (
            "Parameter 'resource_type' must be one of: default, custom; "
            "Actual value was 'bogus'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sGetPlugin().validate(
                _name_params(resource_type="bogus", kind_custom="widgets")
            )

    async def test_search_by_enum(self) -> None:
        message = (
            "Parameter 'search_by' must be one of: name, selector, list; "
            "Actual value was 'everything'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sGetPlugin().validate(_name_params(search_by="everything"))

    async def test_output_format_enum(self) -> None:
        message = (
            "Parameter 'output_format' must be one of: map, table, json, yaml; "
            "Actual value was 'xml'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sGetPlugin().validate(_name_params(output_format="xml"))

    async def test_on_error_enum(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sGetPlugin().validate(_name_params(on_error="ignore"))

    async def test_zero_timeout_is_rejected(self) -> None:
        message = "Parameter 'timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sGetPlugin().validate(_name_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        message = "Parameter 'timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sGetPlugin().validate(_name_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sGetPlugin().validate(_name_params(timeout=1))

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        params = _name_params(impersonate_groups="qa, ops")

        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sGetPlugin().validate(params)

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sGetPlugin().validate(
            _name_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )


class TestExecuteNameMode:
    """search_by=name reads exactly one object."""

    async def test_the_single_object_comes_back_in_result(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        result = await _execute(fake, _name_params())

        assert result["result"] == _POD

    async def test_names_and_count_describe_the_single_object(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        result = await _execute(fake, _name_params())

        assert result["names"] == ["web-1"]
        assert result["count"] == 1

    async def test_the_request_targets_the_named_object(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params())

        assert fake.last.method == "GET"
        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods/web-1", {})
        assert fake.last.body is None

    async def test_selectors_left_behind_never_reach_a_named_read(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(
            fake,
            _name_params(label_selector="app=web", field_selector="status.phase=Running"),
        )

        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods/web-1", {})

    async def test_a_missing_object_fails_the_block_by_default(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)
        message = "K8s Pod 'web-1' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_a_missing_object_is_recordable(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["success"] is False
        assert result["error"] == "K8s Pod 'web-1' not found in namespace 'apps'"
        assert result["reason"] == "NotFound"

    async def test_a_missing_cluster_scoped_object_drops_the_namespace_clause(self) -> None:
        body = _failure("NotFound", 'nodes "kwok-node-0" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_NODES)
        message = "K8s Node 'kwok-node-0' not found"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params(kind="Node", name="kwok-node-0"))


class TestExecuteListModes:
    """search_by=selector and search_by=list read a list."""

    async def test_selector_mode_returns_the_items_list(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = block_params(kind="Pod", search_by="selector", label_selector="app=web")

        result = await _execute(fake, params)

        assert result["result"] == _POD_ITEMS
        assert isinstance(result["result"], list)

    async def test_list_mode_returns_the_items_list(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        result = await _execute(fake, _list_params())

        assert result["result"] == _POD_ITEMS

    async def test_list_mode_names_and_count(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        result = await _execute(fake, _list_params())

        assert result["names"] == ["web-1", "web-2"]
        assert result["count"] == 2

    async def test_an_empty_list_is_a_success_with_count_zero(self) -> None:
        fake = FakeK8sClient(responses=[(200, _EMPTY_LIST)], resources=_PODS)

        result = await _execute(fake, _list_params())

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""
        assert result["result"] == []
        assert result["names"] == []
        assert result["count"] == 0

    async def test_an_empty_selector_result_is_a_success_with_count_zero(self) -> None:
        fake = FakeK8sClient(responses=[(200, _EMPTY_LIST)], resources=_PODS)
        params = block_params(kind="Pod", search_by="selector", label_selector="app=nothing")

        result = await _execute(fake, params)

        assert result["success"] is True
        assert result["count"] == 0
        assert result["names"] == []

    async def test_an_empty_list_still_fails_the_block_on_a_cluster_error(self) -> None:
        body = _failure("Forbidden", 'pods is forbidden: user cannot list resource "pods"', 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_PODS)
        message = (
            "Kubernetes API permission denied: pods is forbidden: "
            'user cannot list resource "pods"'
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _list_params())


class TestRequestShape:
    """What actually goes on the wire: path, query, namespace, headers."""

    async def test_list_mode_sends_no_query_at_all(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        await _execute(fake, _list_params())

        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods", {})

    async def test_selectors_become_label_selector_and_field_selector_query_params(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = block_params(
            kind="Pod",
            search_by="selector",
            label_selector="app=web,tier=front",
            field_selector="status.phase=Running",
        )

        await _execute(fake, params)

        assert _split(fake.last.path) == (
            "/api/v1/namespaces/apps/pods",
            {
                "labelSelector": ["app=web,tier=front"],
                "fieldSelector": ["status.phase=Running"],
            },
        )

    async def test_a_label_selector_alone_is_the_only_query_param(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = block_params(kind="Pod", search_by="selector", label_selector="app=web")

        await _execute(fake, params)

        assert _split(fake.last.path) == (
            "/api/v1/namespaces/apps/pods",
            {"labelSelector": ["app=web"]},
        )

    async def test_a_field_selector_alone_is_the_only_query_param(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = block_params(
            kind="Pod", search_by="selector", field_selector="status.phase=Running"
        )

        await _execute(fake, params)

        assert _split(fake.last.path) == (
            "/api/v1/namespaces/apps/pods",
            {"fieldSelector": ["status.phase=Running"]},
        )

    async def test_selector_mode_with_no_selectors_sends_no_query(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        await _execute(fake, block_params(kind="Pod", search_by="selector"))

        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods", {})

    async def test_the_session_namespace_is_used_when_no_namespace_is_specified(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        await _execute(fake, _list_params())

        assert _split(fake.last.path)[0] == f"/api/v1/namespaces/{NAMESPACE}/pods"

    async def test_a_specified_namespace_wins(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        await _execute(fake, _list_params(namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/ops/pods"

    async def test_all_namespaces_drops_the_namespace_segment(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        await _execute(fake, _list_params(all_namespaces=True))

        assert _split(fake.last.path) == ("/api/v1/pods", {})

    async def test_all_namespaces_beats_a_specified_namespace(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        await _execute(fake, _list_params(all_namespaces=True, namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/pods"

    async def test_all_namespaces_keeps_the_selector_query(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = block_params(
            kind="Pod", search_by="selector", label_selector="app=web", all_namespaces=True
        )

        await _execute(fake, params)

        assert _split(fake.last.path) == ("/api/v1/pods", {"labelSelector": ["app=web"]})

    async def test_a_cluster_scoped_kind_never_carries_a_namespace_segment(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_NODES)

        await _execute(fake, _list_params(kind="Node", namespace="ops"))

        assert _split(fake.last.path) == ("/api/v1/nodes", {})

    async def test_a_named_group_kind_rides_its_own_path_root(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_DEPLOYMENTS)

        await _execute(fake, _name_params(kind="Deployment", name="web"))

        assert _split(fake.last.path)[0] == "/apis/apps/v1/namespaces/apps/deployments/web"

    async def test_a_map_read_asks_for_no_special_accept_and_no_raw_body(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params())

        assert fake.last.accept is None
        assert fake.last.raw is False

    async def test_the_client_receives_the_session_context_and_the_timeout(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params(timeout=45))
        context, timeout, _ = _construction(fake)

        assert context.server == SERVER
        assert context.token == "sa-tok"
        assert context.namespace == NAMESPACE
        assert timeout == 45

    async def test_the_client_timeout_defaults_to_30(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params())
        _, timeout, _ = _construction(fake)

        assert timeout == 30

    async def test_impersonation_reaches_the_client(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params(impersonate_user="dev", impersonate_groups="qa, ops"))
        _, _, extra = _construction(fake)

        assert extra["impersonate_user"] == "dev"
        assert extra["impersonate_groups"] == ["qa", "ops"]

    async def test_a_single_impersonated_group_is_still_a_list(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params(impersonate_groups="qa"))
        _, _, extra = _construction(fake)

        assert extra["impersonate_groups"] == ["qa"]

    async def test_no_impersonation_is_handed_over_when_none_is_configured(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params())
        _, _, extra = _construction(fake)

        assert extra.get("impersonate_user") is None
        assert extra.get("impersonate_groups") is None


class TestDiscovery:
    """The kind resolution that precedes every read."""

    async def test_the_declared_kind_is_discovered_once(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params())

        assert fake.discoveries == ["Pod"]

    async def test_a_custom_kind_is_discovered_verbatim(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _POD_LIST)],
            resources={"widgets": resource("Widget", "widgets", group_version="example.com/v1")},
        )
        params = block_params(resource_type="custom", kind_custom="widgets", search_by="list")

        await _execute(fake, params)

        assert fake.discoveries == ["widgets"]
        assert _split(fake.last.path)[0] == "/apis/example.com/v1/namespaces/apps/widgets"

    async def test_a_discovery_miss_names_the_kind(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(resource_type="custom", kind_custom="Widget", search_by="list")
        message = (
            "This cluster has no resource kind 'Widget' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

    async def test_a_discovery_miss_issues_no_read_request(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(resource_type="custom", kind_custom="Widget", search_by="list")
        message = (
            "This cluster has no resource kind 'Widget' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

        assert fake.calls == []


class TestOutputFormatMap:
    """output_format=map hands back the parsed structure."""

    async def test_name_mode_gives_the_parsed_object(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        result = await _execute(fake, _name_params(output_format="map"))

        assert result["result"] == _POD
        assert result["names"] == ["web-1"]
        assert result["count"] == 1

    async def test_list_mode_gives_the_parsed_list(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="map"))

        assert result["result"] == _POD_ITEMS
        assert result["names"] == ["web-1", "web-2"]
        assert result["count"] == 2


class TestOutputFormatTable:
    """output_format=table hands back a WAVE table."""

    async def test_the_table_accept_header_is_sent_verbatim(self) -> None:
        fake = FakeK8sClient(responses=[(200, _TABLE)], resources=_PODS)

        await _execute(fake, _list_params(output_format="table"))

        assert fake.last.accept == TABLE_ACCEPT
        assert fake.last.raw is False

    async def test_the_result_is_a_wave_table(self) -> None:
        fake = FakeK8sClient(responses=[(200, _TABLE)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))

        assert isinstance(result["result"], Table)

    async def test_every_column_the_cluster_returned_is_kept_with_its_name_verbatim(self) -> None:
        fake = FakeK8sClient(responses=[(200, _TABLE)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))

        assert result["result"].col_names() == [
            "Name",
            "Ready",
            "Restart Count",
            "Cpu Ratio",
            "Scheduled",
            "Age",
        ]

    async def test_column_types_follow_the_kubernetes_column_types(self) -> None:
        fake = FakeK8sClient(responses=[(200, _TABLE)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))

        assert result["result"].col_types() == [
            "string",
            "string",
            "integer",
            "float",
            "boolean",
            "string",
        ]

    async def test_the_cells_land_in_the_rows(self) -> None:
        fake = FakeK8sClient(responses=[(200, _TABLE)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))
        table = result["result"]

        assert table.row_count() == 2
        assert table.row(0).to_list() == ["web-1", "1/1", 3, 0.5, True, "4d"]
        assert table.row(1).to_list() == ["web-2", "0/1", 0, 1.25, False, "2h"]

    async def test_a_column_whose_cells_disagree_is_downgraded_to_string(self) -> None:
        fake = FakeK8sClient(responses=[(200, _MIXED_TABLE)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))
        table = result["result"]

        assert table.col_types()[2] == "string"
        assert table.col("Restart Count") == ["3", "<none>"]

    async def test_a_downgraded_column_leaves_the_other_columns_typed(self) -> None:
        fake = FakeK8sClient(responses=[(200, _MIXED_TABLE)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))

        assert result["result"].col_types() == [
            "string",
            "string",
            "string",
            "float",
            "boolean",
            "string",
        ]

    async def test_names_and_count_come_from_the_embedded_objects(self) -> None:
        fake = FakeK8sClient(responses=[(200, _TABLE)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))

        assert result["names"] == ["web-1", "web-2"]
        assert result["count"] == 2

    async def test_names_ignore_the_printed_cells_and_read_the_embedded_object(self) -> None:
        columns = [
            {"name": "Namespace", "type": "string", "format": "", "description": "Namespace."},
            *_COLUMNS,
        ]
        wide = {
            "kind": "Table",
            "apiVersion": "meta.k8s.io/v1",
            "columnDefinitions": columns,
            "rows": [
                _row("web-1", ["apps", "web-1", "1/1", 3, 0.5, True, "4d"]),
                _row("web-2", ["apps", "web-2", "0/1", 0, 1.25, False, "2h"]),
            ],
        }
        fake = FakeK8sClient(responses=[(200, wide)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table", all_namespaces=True))

        assert result["names"] == ["web-1", "web-2"]
        assert result["count"] == 2
        assert result["result"].col_names()[0] == "Namespace"

    async def test_names_and_count_cost_no_second_request(self) -> None:
        fake = FakeK8sClient(responses=[(200, _TABLE)], resources=_PODS)

        await _execute(fake, _list_params(output_format="table"))

        assert len(fake.calls) == 1

    async def test_name_mode_tables_carry_the_single_object(self) -> None:
        single = {
            "kind": "Table",
            "apiVersion": "meta.k8s.io/v1",
            "columnDefinitions": _COLUMNS,
            "rows": [_row("web-1", ["web-1", "1/1", 3, 0.5, True, "4d"])],
        }
        fake = FakeK8sClient(responses=[(200, single)], resources=_PODS)

        result = await _execute(fake, _name_params(output_format="table"))

        assert fake.last.accept == TABLE_ACCEPT
        assert result["names"] == ["web-1"]
        assert result["count"] == 1

    async def test_an_empty_table_is_a_success_with_count_zero(self) -> None:
        empty = {
            "kind": "Table",
            "apiVersion": "meta.k8s.io/v1",
            "columnDefinitions": _COLUMNS,
            "rows": [],
        }
        fake = FakeK8sClient(responses=[(200, empty)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))

        assert result["success"] is True
        assert result["names"] == []
        assert result["count"] == 0
        assert result["result"].row_count() == 0


class TestOutputFormatTableUnsupported:
    """A cluster that will not print a table says so in house wording (4.2)."""

    async def test_a_406_says_the_cluster_will_not_print_a_table(self) -> None:
        body = _failure("NotAcceptable", "only the following media types are accepted", 406)
        fake = FakeK8sClient(responses=[(406, body)], resources=_PODS)
        message = (
            "This cluster will not print a table for kind 'Pod' "
            "- choose Map, JSON or YAML for this kind"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _list_params(output_format="table"))

    async def test_a_plain_object_body_says_the_cluster_will_not_print_a_table(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        message = (
            "This cluster will not print a table for kind 'Pod' "
            "- choose Map, JSON or YAML for this kind"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _list_params(output_format="table"))

    async def test_the_message_names_the_resolved_kind(self) -> None:
        body = _failure("NotAcceptable", "only the following media types are accepted", 406)
        fake = FakeK8sClient(
            responses=[(406, body)],
            resources={"deploy": resource("Deployment", "deployments", group_version="apps/v1")},
        )
        params = block_params(
            resource_type="custom",
            kind_custom="deploy",
            search_by="list",
            output_format="table",
        )
        message = (
            "This cluster will not print a table for kind 'Deployment' "
            "- choose Map, JSON or YAML for this kind"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)


class TestOutputFormatJson:
    """output_format=json hands back the raw response text."""

    async def test_the_result_is_the_raw_text(self) -> None:
        payload = json.dumps(_POD_LIST)
        fake = FakeK8sClient(responses=[(200, payload.encode())], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="json"))

        assert result["result"] == payload
        assert isinstance(result["result"], str)

    async def test_the_request_asks_for_json_on_the_raw_path(self) -> None:
        fake = FakeK8sClient(responses=[(200, json.dumps(_POD_LIST).encode())], resources=_PODS)

        await _execute(fake, _list_params(output_format="json"))

        assert fake.last.accept is None
        assert fake.last.raw is True

    async def test_names_and_count_are_populated_from_the_raw_text(self) -> None:
        fake = FakeK8sClient(responses=[(200, json.dumps(_POD_LIST).encode())], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="json"))

        assert result["names"] == ["web-1", "web-2"]
        assert result["count"] == 2
        assert len(fake.calls) == 1

    async def test_name_mode_json_describes_the_single_object(self) -> None:
        payload = json.dumps(_POD)
        fake = FakeK8sClient(responses=[(200, payload.encode())], resources=_PODS)

        result = await _execute(fake, _name_params(output_format="json"))

        assert result["result"] == payload
        assert result["names"] == ["web-1"]
        assert result["count"] == 1


class TestOutputFormatYaml:
    """output_format=yaml serializes the document WAVE parsed, not the wire bytes."""

    async def test_the_result_is_yaml_text_over_the_document(self) -> None:
        fake = FakeK8sClient(responses=[(200, json.dumps(_POD_LIST).encode())], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="yaml"))

        assert result["result"] == yaml.safe_dump(_POD_LIST, sort_keys=True)
        assert isinstance(result["result"], str)

    async def test_the_request_asks_for_json_on_the_raw_path(self) -> None:
        fake = FakeK8sClient(responses=[(200, json.dumps(_POD_LIST).encode())], resources=_PODS)

        await _execute(fake, _list_params(output_format="yaml"))

        assert fake.last.accept is None
        assert fake.last.raw is True

    async def test_names_and_count_are_populated_from_the_document(self) -> None:
        fake = FakeK8sClient(responses=[(200, json.dumps(_POD_LIST).encode())], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="yaml"))

        assert result["names"] == ["web-1", "web-2"]
        assert result["count"] == 2
        assert len(fake.calls) == 1

    async def test_name_mode_yaml_describes_the_single_object(self) -> None:
        fake = FakeK8sClient(responses=[(200, json.dumps(_POD).encode())], resources=_PODS)

        result = await _execute(fake, _name_params(output_format="yaml"))

        assert result["result"] == yaml.safe_dump(_POD, sort_keys=True)
        assert result["names"] == ["web-1"]
        assert result["count"] == 1


class TestManagedFieldsAreStripped:
    """kubectl hides metadata.managedFields by default, and so does every read path."""

    async def test_a_map_read_drops_them(self) -> None:
        fake = FakeK8sClient(responses=[(200, _managed_pod())], resources=_PODS)

        result = await _execute(fake, _name_params())

        assert "managedFields" not in result["result"]["metadata"]
        assert result["result"]["metadata"]["name"] == "web-1"
        assert result["result"]["status"] == {"phase": "Running"}

    async def test_a_list_read_drops_them_from_every_item(self) -> None:
        fake = FakeK8sClient(responses=[(200, _managed_list())], resources=_PODS)

        result = await _execute(fake, _list_params())

        assert all("managedFields" not in obj["metadata"] for obj in result["result"])
        assert result["names"] == ["web-1"]
        assert result["count"] == 1

    async def test_json_text_drops_them(self) -> None:
        body = json.dumps(_managed_list()).encode()
        fake = FakeK8sClient(responses=[(200, body)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="json"))

        assert "managedFields" not in result["result"]
        assert json.loads(result["result"])["items"][0]["metadata"]["name"] == "web-1"

    async def test_yaml_text_drops_them(self) -> None:
        body = json.dumps(_managed_list()).encode()
        fake = FakeK8sClient(responses=[(200, body)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="yaml"))

        assert "managedFields" not in result["result"]
        assert yaml.safe_load(result["result"])["items"][0]["metadata"]["name"] == "web-1"

    async def test_a_table_read_drops_them_from_the_embedded_objects(self) -> None:
        table = {
            "kind": "Table",
            "apiVersion": "meta.k8s.io/v1",
            "columnDefinitions": _COLUMNS,
            "rows": [{"cells": ["web-1", "1/1", 3, 0.5, True, "4d"], "object": _managed_pod()}],
        }
        fake = FakeK8sClient(responses=[(200, table)], resources=_PODS)

        result = await _execute(fake, _list_params(output_format="table"))

        assert "managedFields" not in table["rows"][0]["object"]["metadata"]
        assert result["names"] == ["web-1"]

    async def test_a_secret_read_still_registers_its_values(self) -> None:
        registered: list[Any] = []
        secret = _managed_pod()
        secret["kind"] = "Secret"
        secret["data"] = {"password": "czNjcjN0"}
        fake = FakeK8sClient(responses=[(200, secret)], resources=_SECRETS)

        await _execute(
            fake,
            _name_params(kind="Secret"),
            lambda value, revealed=False: registered.append(value),
        )

        assert sorted(registered) == ["czNjcjN0", "s3cr3t"]


class TestApiErrors:
    """The shared 4xx rows rendered through map_api_error (4.2)."""

    async def test_401_renders_the_authentication_row(self) -> None:
        body = _failure("Unauthorized", "Unauthorized", 401)
        fake = FakeK8sClient(responses=[(401, body)], resources=_PODS)
        message = "Kubernetes API authentication failed: Unauthorized"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_403_renders_the_permission_row(self) -> None:
        detail = 'pods "web-1" is forbidden: user cannot get resource "pods"'
        fake = FakeK8sClient(responses=[(403, _failure("Forbidden", detail, 403))], resources=_PODS)
        message = f"Kubernetes API permission denied: {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_404_renders_the_not_found_row(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)
        message = "K8s Pod 'web-1' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_401_is_recordable_with_its_reason(self) -> None:
        body = _failure("Unauthorized", "Unauthorized", 401)
        fake = FakeK8sClient(responses=[(401, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["error"] == "Kubernetes API authentication failed: Unauthorized"
        assert result["reason"] == "Unauthorized"

    async def test_403_is_recordable_with_its_reason(self) -> None:
        detail = 'pods is forbidden: user cannot list resource "pods"'
        fake = FakeK8sClient(responses=[(403, _failure("Forbidden", detail, 403))], resources=_PODS)

        result = await _execute(fake, _list_params(on_error="record"))

        assert result["error"] == f"Kubernetes API permission denied: {detail}"
        assert result["reason"] == "Forbidden"

    async def test_a_specified_namespace_shows_in_the_not_found_row(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)
        message = "K8s Pod 'web-1' not found in namespace 'ops'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params(namespace="ops"))

    async def test_a_server_error_on_a_named_read_says_the_read_failed(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = _failure("ServiceUnavailable", detail, 503)
        fake = FakeK8sClient(responses=[(503, body)], resources=_PODS)
        message = f"Kubernetes could not read Pod 'web-1' in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_a_server_error_on_a_named_read_is_recordable(self) -> None:
        detail = "Internal error occurred: rpc error: code = Unknown"
        body = _failure("InternalError", detail, 500)
        fake = FakeK8sClient(responses=[(500, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["error"] == (
            f"Kubernetes could not read Pod 'web-1' in namespace 'apps': {detail}"
        )
        assert result["reason"] == "InternalError"

    async def test_a_server_error_on_a_list_read_names_the_kind_not_an_object(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = _failure("ServiceUnavailable", detail, 503)
        fake = FakeK8sClient(responses=[(503, body)], resources=_PODS)
        message = f"Kubernetes could not list Pod objects in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _list_params())

    async def test_a_missing_collection_names_the_kind_not_an_object(self) -> None:
        detail = "the server could not find the requested resource"
        body = _failure("NotFound", detail, 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)
        message = f"Kubernetes could not list Pod objects in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _list_params())

    async def test_a_server_error_without_a_cluster_message_names_the_status(self) -> None:
        fake = FakeK8sClient(responses=[(502, {})], resources=_PODS)
        message = "Kubernetes could not read Pod 'web-1' in namespace 'apps' (HTTP 502)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_401_with_a_body_that_is_not_a_status_ends_with_the_http_status(self) -> None:
        fake = FakeK8sClient(responses=[(401, {})], resources=_PODS)
        message = "Kubernetes could not read Pod 'web-1' in namespace 'apps' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_403_with_a_body_that_is_not_a_status_ends_with_the_http_status(self) -> None:
        fake = FakeK8sClient(responses=[(403, {})], resources=_PODS)
        message = "Kubernetes could not list Pod objects in namespace 'apps' (HTTP 403)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _list_params())

    async def test_a_gateway_401_is_recordable_with_an_empty_reason(self) -> None:
        fake = FakeK8sClient(responses=[(401, {})], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["error"] == (
            "Kubernetes could not read Pod 'web-1' in namespace 'apps' (HTTP 401)"
        )
        assert result["reason"] == ""

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_a_gateway_401_reads_the_same_in_every_output_format(
        self, output_format: str
    ) -> None:
        fake = FakeK8sClient(responses=[(401, GATEWAY_HTML)], resources=_PODS)
        message = "Kubernetes could not read Pod 'web-1' in namespace 'apps' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params(output_format=output_format))


class TestTextFormatsRejectAnUnreadableBody:
    """JSON and YAML fail on a body that is not the object it claims, as map and table do."""

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_a_gateway_page_at_200_fails_the_block(self, output_format: str) -> None:
        fake = FakeK8sClient(responses=[(200, GATEWAY_HTML)], resources=_PODS)

        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            await _execute(fake, _list_params(output_format=output_format))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_a_named_read_fails_the_same_way(self, output_format: str) -> None:
        fake = FakeK8sClient(responses=[(200, GATEWAY_HTML)], resources=_PODS)

        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            await _execute(fake, _name_params(output_format=output_format))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_record_mode_does_not_soften_it(self, output_format: str) -> None:
        fake = FakeK8sClient(responses=[(200, GATEWAY_HTML)], resources=_PODS)

        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            await _execute(fake, _list_params(output_format=output_format, on_error="record"))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_a_body_that_is_not_an_object_fails(self, output_format: str) -> None:
        fake = FakeK8sClient(responses=[(200, b"[1, 2, 3]")], resources=_PODS)

        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            await _execute(fake, _list_params(output_format=output_format))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    async def test_an_empty_body_stays_a_success(self, output_format: str) -> None:
        fake = FakeK8sClient(responses=[(200, b"")], resources=_PODS)

        result = await _execute(fake, _list_params(output_format=output_format))

        assert result["success"] is True
        assert (result["result"], result["names"], result["count"]) == ("", [], 0)


class TestOutputCore:
    """The output core and the fail-or-record dispatch."""

    async def test_a_happy_read_carries_the_full_core(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        result = await _execute(fake, _name_params())

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_a_happy_read_returns_exactly_the_declared_outputs(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        result = await _execute(fake, _name_params())

        assert set(result) == {"result", "names", "count", "success", "error", "reason"}

    async def test_record_mode_returns_instead_of_raising(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["success"] is False

    async def test_record_mode_leaves_the_unique_outputs_at_their_empty_defaults(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["result"] == {}
        assert result["names"] == []
        assert result["count"] == 0

    async def test_record_mode_returns_empty_text_under_json(self) -> None:
        body = json.dumps(_failure("NotFound", 'pods "web-1" not found', 404)).encode()
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record", output_format="json"))

        assert result["result"] == ""

    async def test_record_mode_returns_an_empty_list_under_a_list_read(self) -> None:
        body = _failure("Forbidden", "pods is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_PODS)

        result = await _execute(fake, _list_params(on_error="record"))

        assert result["result"] == []

    async def test_record_mode_returns_an_empty_table_under_table(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record", output_format="table"))

        assert isinstance(result["result"], Table)
        assert result["result"].row_count() == 0

    async def test_record_mode_returns_the_declared_outputs_and_the_warning_signal(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert set(result) == {
            "result",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    async def test_record_mode_passes_the_cluster_reason_through(self) -> None:
        body = _failure("Forbidden", "pods is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_PODS)

        result = await _execute(fake, _list_params(on_error="record"))

        assert result["reason"] == "Forbidden"

    async def test_fail_is_the_default_mode(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)
        message = "K8s Pod 'web-1' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_record_mode_keeps_a_happy_read_green(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)

        result = await _execute(fake, _list_params(on_error="record"))

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""
        assert result["count"] == 2


class TestAlwaysHardFail:
    """The carve-out: these raise under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_missing_session_raises(self, on_error: str) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)
        params = {"kind": "Pod", "search_by": "name", "name": "web-1", "on_error": on_error}
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_bogus_session_raises(self, on_error: str) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)
        params = _name_params(session="not-a-kubeconfig", on_error=on_error)
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_transport_failure_raises(self, on_error: str) -> None:
        message = (
            f"Could not connect to the Kubernetes API at {SERVER}: "
            "[Errno 111] Connection refused"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_PODS)

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _name_params(on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_tls_failure_raises(self, on_error: str) -> None:
        message = (
            f"Could not verify the TLS certificate of {SERVER}: "
            "certificate signed by unknown authority"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_PODS)

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _name_params(on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_timeout_raises(self, on_error: str) -> None:
        message = (
            "Kubernetes API request GET /api/v1/namespaces/apps/pods/web-1 "
            "timed out after 30 seconds"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_PODS)

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _name_params(on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_invalid_params_raise_from_validate(self, on_error: str) -> None:
        message = "Parameter 'timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sGetPlugin().validate(_name_params(timeout=0, on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_missing_required_param_raises_from_validate(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sGetPlugin().validate(block_params(kind="Pod", on_error=on_error))


class TestSecretKind:
    """Reading kind Secret registers every data value (REQ-4.5.6)."""

    async def test_every_data_value_is_registered(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)
        params = _name_params(kind="Secret", name="db-creds")

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert sorted(registered) == sorted(_SECRET_REGISTERED)

    async def test_both_the_decoded_and_the_base64_form_are_registered(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)
        params = _name_params(kind="Secret", name="db-creds")

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        for text in ("admin", "s3cr3t"):
            assert text in registered
            assert _b64(text) in registered

    async def test_a_non_utf8_value_stays_base64(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)
        params = _name_params(kind="Secret", name="db-creds")

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert _BINARY_VALUE in registered
        assert registered.count(_BINARY_VALUE) == 1

    async def test_registration_follows_the_resolved_kind_not_the_typed_one(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(
            responses=[(200, _SECRET)], resources={"secrets": resource("Secret", "secrets")}
        )
        params = block_params(
            resource_type="custom", kind_custom="secrets", search_by="name", name="db-creds"
        )

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert sorted(registered) == sorted(_SECRET_REGISTERED)

    async def test_a_list_of_secrets_registers_every_item(self) -> None:
        registered: list[Any] = []
        other = {
            "metadata": {"name": "tls-cert", "namespace": "apps"},
            "data": {"tls.key": _b64("private")},
        }
        listing = {"kind": "SecretList", "apiVersion": "v1", "items": [_SECRET, other]}
        fake = FakeK8sClient(responses=[(200, listing)], resources=_SECRETS)

        await _execute(
            fake,
            _list_params(kind="Secret"),
            lambda value, revealed=False: registered.append(value),
        )

        assert sorted(registered) == sorted([*_SECRET_REGISTERED, "private", _b64("private")])

    async def test_a_secret_without_data_registers_nothing(self) -> None:
        registered: list[Any] = []
        empty = {"kind": "Secret", "apiVersion": "v1", "metadata": {"name": "blank"}}
        fake = FakeK8sClient(responses=[(200, empty)], resources=_SECRETS)
        params = _name_params(kind="Secret", name="blank")

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert registered == []

    async def test_a_non_secret_kind_registers_nothing(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params(), lambda value, revealed=False: registered.append(value))

        assert registered == []

    async def test_the_secret_still_reads_without_the_register_secret_facility(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)
        params = _name_params(kind="Secret", name="db-creds")

        result = await _execute(fake, params)

        assert result["success"] is True
        assert result["result"] == _SECRET


class TestSecretKindInTableMode:
    """Table mode asks for no embedded object, so a Secret table carries no values."""

    async def test_the_request_never_asks_the_cluster_to_embed_the_object(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET_TABLE)], resources=_SECRETS)
        params = _list_params(kind="Secret", output_format="table")

        await _execute(fake, params)

        _, query = _split(fake.last.path)
        assert "includeObject" not in query
        assert query == {}

    async def test_no_secret_value_is_registered(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(200, _SECRET_TABLE)], resources=_SECRETS)
        params = _list_params(kind="Secret", output_format="table")

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert registered == []

    async def test_the_table_carries_a_count_and_no_value(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET_TABLE)], resources=_SECRETS)
        params = _list_params(kind="Secret", output_format="table")

        result = await _execute(fake, params)

        assert result["result"].col_names() == ["Name", "Type", "Data", "Age"]
        assert result["result"].row(0).to_list() == ["db-creds", "Opaque", 3, "4d"]
        assert result["names"] == ["db-creds"]

    async def test_map_mode_on_the_same_secret_does_register_every_value(self) -> None:
        registered: list[Any] = []
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)
        params = _name_params(kind="Secret", name="db-creds", output_format="map")

        await _execute(fake, params, lambda value, revealed=False: registered.append(value))

        assert sorted(registered) == sorted(_SECRET_REGISTERED)


_DISCOVERY_FORBIDDEN = 'forbidden: User "wave" cannot get path "/api/v1"'


class TestDiscoveryDenied:
    """A 401 or 403 on the discovery walk renders the credential rows, not the kind miss."""

    async def test_401_renders_the_authentication_row(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))
        message = "Kubernetes API authentication failed: Unauthorized"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_403_renders_the_permission_row(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))
        message = f"Kubernetes API permission denied: {_DISCOVERY_FORBIDDEN}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params())

    async def test_a_denied_walk_is_never_reported_as_a_kind_miss(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))

        with pytest.raises(ValueError) as raised:
            await _execute(fake, block_params(resource_type="custom", kind_custom="Widget"))

        assert "no resource kind" not in str(raised.value)

    async def test_401_is_recordable_with_its_reason(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["success"] is False
        assert result["error"] == "Kubernetes API authentication failed: Unauthorized"
        assert result["reason"] == "Unauthorized"

    async def test_403_is_recordable_with_its_reason(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))

        result = await _execute(fake, _list_params(on_error="record"))

        assert result["success"] is False
        assert result["error"] == f"Kubernetes API permission denied: {_DISCOVERY_FORBIDDEN}"
        assert result["reason"] == "Forbidden"

    async def test_a_recorded_denial_leaves_the_unique_outputs_empty(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))

        result = await _execute(fake, _name_params(on_error="record"))

        assert (result["result"], result["names"], result["count"]) == ({}, [], 0)
        assert set(result) == {
            "result",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_denied_walk_issues_no_read_request(self, on_error: str) -> None:
        from contextlib import suppress

        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))

        with suppress(ValueError):
            await _execute(fake, _name_params(on_error=on_error))

        assert fake.discoveries == ["Pod"]
        assert fake.calls == []

    async def test_a_denial_without_a_status_reason_records_an_empty_reason(self) -> None:
        fake = DeniedDiscoveryClient(401, {})

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["error"] == "Kubernetes could not list Pod objects (HTTP 401)"
        assert result["reason"] == ""


class TestListModeSelectors:
    """List mode is a plain list: selectors a previous Selector choice left behind stay off."""

    async def test_list_mode_ignores_selectors_left_behind_by_a_selector_choice(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = _list_params(label_selector="app=web", field_selector="status.phase=Running")

        await _execute(fake, params)

        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods", {})

    async def test_list_mode_across_namespaces_still_sends_no_query(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = _list_params(all_namespaces=True, label_selector="app=web")

        await _execute(fake, params)

        assert _split(fake.last.path) == ("/api/v1/pods", {})

    async def test_selector_mode_still_sends_the_same_selectors(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = block_params(
            kind="Pod",
            search_by="selector",
            label_selector="app=web",
            field_selector="status.phase=Running",
        )

        await _execute(fake, params)

        assert _split(fake.last.path) == (
            "/api/v1/namespaces/apps/pods",
            {"labelSelector": ["app=web"], "fieldSelector": ["status.phase=Running"]},
        )


class TestPathEncoding:
    """Namespace and name reach the wire percent-encoded; messages keep the typed values."""

    async def test_a_name_with_a_space_and_a_question_mark_is_percent_encoded(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params(name="web 1?"))

        assert fake.last.path == "/api/v1/namespaces/apps/pods/web%201%3F"

    async def test_a_namespace_with_a_space_and_a_question_mark_is_percent_encoded(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)

        await _execute(fake, _name_params(namespace="my ns?"))

        assert fake.last.path == "/api/v1/namespaces/my%20ns%3F/pods/web-1"

    async def test_a_missing_object_is_reported_by_its_typed_name_and_namespace(self) -> None:
        body = _failure("NotFound", 'pods "web 1?" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)
        message = "K8s Pod 'web 1?' not found in namespace 'my ns?'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _name_params(name="web 1?", namespace="my ns?"))

        assert fake.last.path == "/api/v1/namespaces/my%20ns%3F/pods/web%201%3F"

    async def test_a_selector_query_follows_the_encoded_namespace(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD_LIST)], resources=_PODS)
        params = block_params(
            kind="Pod",
            search_by="selector",
            label_selector="app=web",
            namespace="my ns?",
        )

        await _execute(fake, params)

        assert _split(fake.last.path) == (
            "/api/v1/namespaces/my%20ns%3F/pods",
            {"labelSelector": ["app=web"]},
        )


class TestRecordedFailureIsAmber:
    """Every recordable path asks for amber and says why at WARN (K8SREAD-10)."""

    async def test_a_recorded_not_found_carries_the_warning_signal(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)

        result = await _execute(fake, _name_params(on_error="record"))

        assert result["__block_warning"] is True

    async def test_a_recorded_not_found_logs_the_warn_line(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)
        logger = MagicMock()

        await _execute(fake, _name_params(on_error="record"), logger=logger)

        logger.warn.assert_called_once_with(
            "Read failed (NotFound): K8s Pod 'web-1' not found in namespace 'apps'"
        )

    async def test_a_recorded_server_error_logs_a_read_shaped_warn_line(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = _failure("ServiceUnavailable", detail, 503)
        fake = FakeK8sClient(responses=[(503, body)], resources=_PODS)
        logger = MagicMock()

        await _execute(fake, _name_params(on_error="record"), logger=logger)

        logger.warn.assert_called_once_with(
            "Read failed (ServiceUnavailable): Kubernetes could not read Pod 'web-1' "
            f"in namespace 'apps': {detail}"
        )

    async def test_a_recorded_discovery_denial_carries_the_warning_signal(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))
        logger = MagicMock()

        result = await _execute(fake, _name_params(on_error="record"), logger=logger)

        assert result["__block_warning"] is True
        logger.warn.assert_called_once_with(
            f"Read failed (Forbidden): Kubernetes API permission denied: {_DISCOVERY_FORBIDDEN}"
        )

    async def test_a_recorded_discovery_miss_carries_the_warning_signal(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(
            resource_type="custom", kind_custom="Widget", search_by="list", on_error="record"
        )
        logger = MagicMock()

        result = await _execute(fake, params, logger=logger)

        assert result["__block_warning"] is True
        logger.warn.assert_called_once_with(
            "Read failed (NotFound): This cluster has no resource kind 'Widget' "
            "- check the spelling, or whether the CRD is installed"
        )

    async def test_a_recorded_table_refusal_carries_the_warning_signal(self) -> None:
        body = _failure("NotAcceptable", "only the following media types are accepted", 406)
        fake = FakeK8sClient(responses=[(406, body)], resources=_PODS)
        logger = MagicMock()

        result = await _execute(
            fake, _list_params(output_format="table", on_error="record"), logger=logger
        )

        assert result["__block_warning"] is True
        logger.warn.assert_called_once_with(
            "Read failed (NotAcceptable): This cluster will not print a table for kind 'Pod' "
            "- choose Map, JSON or YAML for this kind"
        )

    async def test_a_happy_read_logs_info_and_asks_for_nothing(self) -> None:
        fake = FakeK8sClient(responses=[(200, _POD)], resources=_PODS)
        logger = MagicMock()

        result = await _execute(fake, _name_params(on_error="record"), logger=logger)

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0
        assert logger.info.call_count == 1

    async def test_fail_mode_logs_no_warn_line(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_PODS)
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(fake, _name_params(on_error="fail"), logger=logger)

        assert logger.warn.call_count == 0


class TestOutputGating:
    """Error and Reason render only under Record and continue; Success never hides."""

    def test_error_and_reason_render_only_under_record_and_continue(self) -> None:
        outputs = _outputs_by_name(K8sGetPlugin())

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE

    def test_success_carries_no_gate(self) -> None:
        """Success stays visible in both On error modes, deliberately."""
        outputs = _outputs_by_name(K8sGetPlugin())

        assert "show_when" not in outputs["success"]

    def test_only_error_and_reason_are_gated(self) -> None:
        gated = {o["name"] for o in K8sGetPlugin().metadata["output_schema"] if "show_when" in o}

        assert gated == {"error", "reason"}
