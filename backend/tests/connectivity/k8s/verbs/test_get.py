"""K8s Get verb tests (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

get.run is the sync core behind the K8s Get block: it resolves the kind through
live discovery, reads one object or a list, and returns the wire envelope whose
'result' output follows the chosen output format - a plain map or list, a table
envelope, JSON text, or a yaml envelope. Reading kind Secret carries every data
value, encoded and decoded, in the envelope's secrets list.
"""

import base64
import inspect
import json
import urllib.parse
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    GATEWAY_HTML,
    NAMESPACE,
    SERVER,
    UNREADABLE_BODY_MESSAGE,
    DeniedDiscoveryClient,
    FakeK8sClient,
    block_params,
    exact,
    resource,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.connectivity.k8s.verbs import get

_CLIENT_TARGET = "wavecore.connectivity.k8s.verbs.get.K8sClient"
_TABLE_ACCEPT = "application/json;as=Table;g=meta.k8s.io;v=v1,application/json"
_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_DISCOVERY_MISS_MESSAGE = (
    "This cluster has no resource kind 'Widget' "
    "- check the spelling, or whether the CRD is installed"
)
_TABLE_REFUSED_MESSAGE = (
    "This cluster will not print a table for kind 'Pod' " "- choose Map, JSON or YAML for this kind"
)
_DISCOVERY_FORBIDDEN = 'forbidden: User "wave" cannot get path "/api/v1"'
_EMPTY_TABLE = {"__wave_type": "table", "columns": [], "rows": []}

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

_COLUMN_DEFINITIONS = [
    {"name": "Name", "type": "string", "format": "name", "description": "Object name."},
    {"name": "Ready", "type": "string", "format": "", "description": "Containers ready."},
    {"name": "Restart Count", "type": "integer", "format": "", "description": "Restarts."},
    {"name": "Cpu Ratio", "type": "number", "format": "", "description": "Cpu share."},
    {"name": "Scheduled", "type": "boolean", "format": "", "description": "Scheduled."},
    {"name": "Age", "type": "date", "format": "", "description": "Age."},
]
_ENVELOPE_COLUMNS = [
    {"name": "Name", "type": "string"},
    {"name": "Ready", "type": "string"},
    {"name": "Restart Count", "type": "integer"},
    {"name": "Cpu Ratio", "type": "float"},
    {"name": "Scheduled", "type": "boolean"},
    {"name": "Age", "type": "string"},
]


class _Log:
    """Records the (level, message) pairs a verb writes."""

    def __init__(self) -> None:
        self.entries: list[tuple[str, str]] = []

    def __call__(self, level: str, message: str) -> None:
        self.entries.append((level, message))


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


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


def _row(name: str, cells: list[Any]) -> dict[str, Any]:
    return {
        "cells": cells,
        "object": {
            "kind": "Pod",
            "apiVersion": "v1",
            "metadata": {"name": name, "namespace": "apps"},
        },
    }


def _table(*rows: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "Table",
        "apiVersion": "meta.k8s.io/v1",
        "columnDefinitions": _COLUMN_DEFINITIONS,
        "rows": list(rows),
    }


_TABLE = _table(
    _row("web-1", ["web-1", "1/1", 3, 0.5, True, "4d"]),
    _row("web-2", ["web-2", "0/1", 0, 1.25, False, "2h"]),
)
_MIXED_TABLE = _table(
    _row("web-1", ["web-1", "1/1", 3, 0.5, True, "4d"]),
    _row("web-2", ["web-2", "0/1", "<none>", 1.25, False, "2h"]),
)

_BINARY_VALUE = base64.b64encode(b"\xff\xfe").decode()
_UNDECODABLE_VALUE = "not base64!"
_SECRET = {
    "kind": "Secret",
    "apiVersion": "v1",
    "metadata": {"name": "db-creds", "namespace": "apps"},
    "type": "Opaque",
    "data": {
        "username": _b64("admin"),
        "password": _b64("s3cr3t"),
        "keystore": _BINARY_VALUE,
        "legacy": _UNDECODABLE_VALUE,
    },
}
# The encoded value first, then its plaintext when the bytes decode as text.
_SECRET_VALUES = [
    _b64("admin"),
    "admin",
    _b64("s3cr3t"),
    "s3cr3t",
    _BINARY_VALUE,
    _UNDECODABLE_VALUE,
]
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
            "cells": ["db-creds", "Opaque", 4, "4d"],
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


def _patch_client(fake: FakeK8sClient) -> Any:
    factory = MagicMock(return_value=fake)
    fake.factory = factory
    return patch(_CLIENT_TARGET, factory)


def _run(fake: FakeK8sClient, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    with _patch_client(fake):
        envelope: dict[str, Any] = get.run(params, log if log is not None else _Log())
    return envelope


def _outputs(fake: FakeK8sClient, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    outputs: dict[str, Any] = _run(fake, params, log)["outputs"]
    return outputs


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


def _selector_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"kind": "Pod", "search_by": "selector"}
    params.update(overrides)
    return block_params(**params)


def _serving(status: int, body: Any, resources: dict[str, Any] | None = None) -> FakeK8sClient:
    return FakeK8sClient(
        responses=[(status, body)], resources=_PODS if resources is None else resources
    )


class TestVerbShape:
    """run is a plain sync function returning the JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(get.run) is False

    def test_run_is_a_plain_module_level_function(self) -> None:
        assert inspect.isfunction(get.run) is True

    def test_run_takes_the_parameters_and_the_log_callable(self) -> None:
        assert list(inspect.signature(get.run).parameters) == ["params", "log"]

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(_serving(200, _POD), _name_params())

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_a_happy_read_returns_exactly_the_declared_outputs(self) -> None:
        outputs = _outputs(_serving(200, _POD), _name_params())

        assert set(outputs) == {"result", "names", "count", "success", "error", "reason"}

    def test_a_happy_read_carries_the_full_output_core(self) -> None:
        outputs = _outputs(_serving(200, _POD), _name_params())

        assert outputs["success"] is True
        assert outputs["error"] == ""
        assert outputs["reason"] == ""

    def test_a_map_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(_serving(200, _POD_LIST), _list_params())

        assert json.loads(json.dumps(envelope)) == envelope


class TestNameMode:
    """search_by=name reads exactly one object."""

    def test_the_single_object_comes_back_in_result(self) -> None:
        outputs = _outputs(_serving(200, _POD), _name_params())

        assert outputs["result"] == _POD

    def test_names_and_count_describe_the_single_object(self) -> None:
        outputs = _outputs(_serving(200, _POD), _name_params())

        assert outputs["names"] == ["web-1"]
        assert outputs["count"] == 1

    def test_the_request_targets_the_named_object(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params())

        assert fake.last.method == "GET"
        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods/web-1", {})
        assert fake.last.body is None

    def test_the_name_is_stripped_before_it_reaches_the_path(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params(name="  web-1  "))

        assert fake.last.path == "/api/v1/namespaces/apps/pods/web-1"

    def test_selectors_left_behind_never_reach_a_named_read(self) -> None:
        fake = _serving(200, _POD)

        _run(
            fake,
            _name_params(label_selector="app=web", field_selector="status.phase=Running"),
        )

        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods/web-1", {})

    def test_a_named_read_ignores_an_all_namespaces_tick(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params(all_namespaces=True))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/apps/pods/web-1"


class TestListModes:
    """search_by=selector and search_by=list read a list."""

    def test_list_mode_returns_the_items(self) -> None:
        outputs = _outputs(_serving(200, _POD_LIST), _list_params())

        assert outputs["result"] == _POD_ITEMS
        assert outputs["names"] == ["web-1", "web-2"]
        assert outputs["count"] == 2

    def test_selector_mode_returns_the_items(self) -> None:
        outputs = _outputs(_serving(200, _POD_LIST), _selector_params(label_selector="app=web"))

        assert outputs["result"] == _POD_ITEMS
        assert isinstance(outputs["result"], list)

    def test_an_empty_list_is_a_success_with_count_zero(self) -> None:
        outputs = _outputs(_serving(200, _EMPTY_LIST), _list_params())

        assert outputs["success"] is True
        assert outputs["result"] == []
        assert outputs["names"] == []
        assert outputs["count"] == 0

    def test_a_list_read_that_answers_with_one_object_keeps_the_object(self) -> None:
        outputs = _outputs(_serving(200, _POD), _list_params())

        assert outputs["result"] == _POD
        assert outputs["names"] == ["web-1"]
        assert outputs["count"] == 1


class TestRequestShape:
    """What goes on the wire: path, namespace, query, client construction."""

    def test_list_mode_sends_no_query_at_all(self) -> None:
        fake = _serving(200, _POD_LIST)

        _run(fake, _list_params(label_selector="app=web", field_selector="a=b"))

        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods", {})

    def test_selector_mode_sends_both_selectors(self) -> None:
        fake = _serving(200, _POD_LIST)

        _run(
            fake,
            _selector_params(
                label_selector="app=web,tier=front", field_selector="status.phase=Running"
            ),
        )

        assert _split(fake.last.path) == (
            "/api/v1/namespaces/apps/pods",
            {
                "labelSelector": ["app=web,tier=front"],
                "fieldSelector": ["status.phase=Running"],
            },
        )

    def test_a_label_selector_alone_is_the_only_query_param(self) -> None:
        fake = _serving(200, _POD_LIST)

        _run(fake, _selector_params(label_selector="  app=web  "))

        assert _split(fake.last.path) == (
            "/api/v1/namespaces/apps/pods",
            {"labelSelector": ["app=web"]},
        )

    def test_a_field_selector_alone_is_the_only_query_param(self) -> None:
        fake = _serving(200, _POD_LIST)

        _run(fake, _selector_params(field_selector="status.phase=Running"))

        assert _split(fake.last.path) == (
            "/api/v1/namespaces/apps/pods",
            {"fieldSelector": ["status.phase=Running"]},
        )

    def test_selector_mode_with_blank_selectors_sends_no_query(self) -> None:
        fake = _serving(200, _POD_LIST)

        _run(fake, _selector_params(label_selector="   "))

        assert _split(fake.last.path) == ("/api/v1/namespaces/apps/pods", {})

    def test_the_session_namespace_is_used_when_none_is_given(self) -> None:
        fake = _serving(200, _POD_LIST)

        _run(fake, _list_params())

        assert _split(fake.last.path)[0] == f"/api/v1/namespaces/{NAMESPACE}/pods"

    def test_a_given_namespace_wins_over_the_session_default(self) -> None:
        fake = _serving(200, _POD_LIST)

        _run(fake, _list_params(namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/ops/pods"

    def test_all_namespaces_drops_the_namespace_segment_on_a_list_read(self) -> None:
        fake = _serving(200, _POD_LIST)

        _run(fake, _list_params(all_namespaces=True, namespace="ops"))

        assert _split(fake.last.path) == ("/api/v1/pods", {})

    def test_a_cluster_scoped_kind_never_carries_a_namespace_segment(self) -> None:
        fake = _serving(200, _POD_LIST, _NODES)

        _run(fake, _list_params(kind="Node", namespace="ops"))

        assert _split(fake.last.path) == ("/api/v1/nodes", {})

    def test_a_grouped_kind_rides_its_own_path_root(self) -> None:
        fake = _serving(200, _POD, _DEPLOYMENTS)

        _run(fake, _name_params(kind="Deployment", name="web"))

        assert _split(fake.last.path)[0] == "/apis/apps/v1/namespaces/apps/deployments/web"

    def test_the_name_and_the_namespace_reach_the_wire_percent_encoded(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params(name="web 1?", namespace="my ns?"))

        assert fake.last.path == "/api/v1/namespaces/my%20ns%3F/pods/web%201%3F"

    def test_the_client_receives_the_session_context_and_the_timeout(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params(timeout=45))
        context, timeout, _ = _construction(fake)

        assert context.server == SERVER
        assert context.token == "sa-tok"
        assert context.namespace == NAMESPACE
        assert timeout == 45

    def test_the_client_timeout_defaults_to_thirty(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params())

        assert _construction(fake)[1] == 30

    def test_impersonation_reaches_the_client_as_a_user_and_a_group_list(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params(impersonate_user="dev", impersonate_groups="qa, ops"))
        _, _, extra = _construction(fake)

        assert extra["impersonate_user"] == "dev"
        assert extra["impersonate_groups"] == ["qa", "ops"]

    def test_no_impersonation_is_handed_over_when_none_is_configured(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params())
        _, _, extra = _construction(fake)

        assert extra["impersonate_user"] is None
        assert extra["impersonate_groups"] is None


class TestDiscovery:
    """The kind resolution that precedes every read."""

    def test_the_declared_kind_is_discovered_once(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params())

        assert fake.discoveries == ["Pod"]

    def test_a_custom_kind_is_discovered_verbatim(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _POD_LIST)],
            resources={"widgets": resource("Widget", "widgets", group_version="example.com/v1")},
        )

        _run(fake, block_params(resource_type="custom", kind_custom=" widgets ", search_by="list"))

        assert fake.discoveries == ["widgets"]
        assert _split(fake.last.path)[0] == "/apis/example.com/v1/namespaces/apps/widgets"

    def test_a_discovery_miss_names_the_kind_and_issues_no_read(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(resource_type="custom", kind_custom="Widget", search_by="list")

        with pytest.raises(ValueError, match=exact(_DISCOVERY_MISS_MESSAGE)):
            _run(fake, params)

        assert fake.calls == []

    def test_a_discovery_miss_is_recordable(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(
            resource_type="custom", kind_custom="Widget", search_by="list", on_error="record"
        )

        outputs = _outputs(fake, params)

        assert outputs["success"] is False
        assert outputs["error"] == _DISCOVERY_MISS_MESSAGE
        assert outputs["reason"] == "NotFound"


class TestDiscoveryDenied:
    """A 401 or 403 on the discovery walk renders the credential rows, not a kind miss."""

    def test_401_renders_the_authentication_row(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))
        message = "Kubernetes API authentication failed: Unauthorized"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params())

    def test_403_renders_the_permission_row(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))
        message = f"Kubernetes API permission denied: {_DISCOVERY_FORBIDDEN}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params())

    def test_a_denied_walk_is_recordable_with_its_reason(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))

        outputs = _outputs(fake, _list_params(on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == f"Kubernetes API permission denied: {_DISCOVERY_FORBIDDEN}"
        assert outputs["reason"] == "Forbidden"

    def test_a_denial_without_a_status_reason_records_an_empty_reason(self) -> None:
        fake = DeniedDiscoveryClient(401, {})

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["error"] == "Kubernetes could not list Pod objects (HTTP 401)"
        assert outputs["reason"] == ""

    def test_a_denied_walk_issues_no_read_request(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))

        _run(fake, _name_params(on_error="record"))

        assert fake.discoveries == ["Pod"]
        assert fake.calls == []


class TestOutputFormatMap:
    """output_format=map hands back the parsed structure and asks for no wire mode."""

    def test_a_map_read_asks_for_no_accept_header_and_no_raw_body(self) -> None:
        fake = _serving(200, _POD)

        _run(fake, _name_params(output_format="map"))

        assert fake.last.accept is None
        assert fake.last.raw is False

    def test_name_mode_gives_the_parsed_object(self) -> None:
        outputs = _outputs(_serving(200, _POD), _name_params(output_format="map"))

        assert outputs["result"] == _POD

    def test_list_mode_gives_the_parsed_items(self) -> None:
        outputs = _outputs(_serving(200, _POD_LIST), _list_params(output_format="map"))

        assert outputs["result"] == _POD_ITEMS


class TestOutputFormatTable:
    """output_format=table hands back a table envelope built from the cluster's Table."""

    def test_the_table_accept_header_is_sent_verbatim_on_the_parsed_path(self) -> None:
        fake = _serving(200, _TABLE)

        _run(fake, _list_params(output_format="table"))

        assert fake.last.accept == _TABLE_ACCEPT
        assert fake.last.raw is False

    def test_the_result_is_the_table_envelope(self) -> None:
        outputs = _outputs(_serving(200, _TABLE), _list_params(output_format="table"))

        assert outputs["result"] == {
            "__wave_type": "table",
            "columns": _ENVELOPE_COLUMNS,
            "rows": [
                ["web-1", "1/1", 3, 0.5, True, "4d"],
                ["web-2", "0/1", 0, 1.25, False, "2h"],
            ],
        }

    def test_a_column_whose_cells_disagree_is_downgraded_to_string(self) -> None:
        outputs = _outputs(_serving(200, _MIXED_TABLE), _list_params(output_format="table"))

        assert [column["type"] for column in outputs["result"]["columns"]] == [
            "string",
            "string",
            "string",
            "float",
            "boolean",
            "string",
        ]
        assert [row[2] for row in outputs["result"]["rows"]] == ["3", "<none>"]

    def test_names_and_count_come_from_the_embedded_objects(self) -> None:
        outputs = _outputs(_serving(200, _TABLE), _list_params(output_format="table"))

        assert outputs["names"] == ["web-1", "web-2"]
        assert outputs["count"] == 2

    def test_a_table_read_costs_one_request(self) -> None:
        fake = _serving(200, _TABLE)

        _run(fake, _list_params(output_format="table"))

        assert len(fake.calls) == 1

    def test_an_empty_table_is_a_success_with_no_rows(self) -> None:
        outputs = _outputs(_serving(200, _table()), _list_params(output_format="table"))

        assert outputs["success"] is True
        assert outputs["result"]["rows"] == []
        assert outputs["result"]["columns"] == _ENVELOPE_COLUMNS
        assert outputs["count"] == 0

    def test_the_table_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(_serving(200, _TABLE), _list_params(output_format="table"))

        assert json.loads(json.dumps(envelope)) == envelope


class TestOutputFormatTableUnsupported:
    """A cluster that will not print a table says so in house wording."""

    def test_a_406_says_the_cluster_will_not_print_a_table(self) -> None:
        body = _failure("NotAcceptable", "only the following media types are accepted", 406)

        with pytest.raises(ValueError, match=exact(_TABLE_REFUSED_MESSAGE)):
            _run(_serving(406, body), _list_params(output_format="table"))

    def test_a_plain_object_body_says_the_cluster_will_not_print_a_table(self) -> None:
        with pytest.raises(ValueError, match=exact(_TABLE_REFUSED_MESSAGE)):
            _run(_serving(200, _POD_LIST), _list_params(output_format="table"))

    def test_the_message_names_the_resolved_kind(self) -> None:
        body = _failure("NotAcceptable", "only the following media types are accepted", 406)
        fake = FakeK8sClient(responses=[(406, body)], resources=_DEPLOYMENTS)
        message = (
            "This cluster will not print a table for kind 'Deployment' "
            "- choose Map, JSON or YAML for this kind"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _list_params(kind="Deployment", output_format="table"))

    def test_a_table_refusal_is_recordable_with_a_not_acceptable_reason(self) -> None:
        body = _failure("NotAcceptable", "only the following media types are accepted", 406)

        outputs = _outputs(
            _serving(406, body), _list_params(output_format="table", on_error="record")
        )

        assert outputs["error"] == _TABLE_REFUSED_MESSAGE
        assert outputs["reason"] == "NotAcceptable"


class TestOutputFormatJson:
    """output_format=json hands back the document re-serialized as JSON text."""

    def test_the_request_asks_for_json_on_the_raw_path(self) -> None:
        fake = _serving(200, json.dumps(_POD_LIST).encode())

        _run(fake, _list_params(output_format="json"))

        assert fake.last.accept is None
        assert fake.last.raw is True

    def test_the_result_is_the_whole_document_as_text(self) -> None:
        payload = json.dumps(_POD_LIST)
        outputs = _outputs(_serving(200, payload.encode()), _list_params(output_format="json"))

        assert outputs["result"] == payload
        assert isinstance(outputs["result"], str)

    def test_names_and_count_come_from_the_serialized_document(self) -> None:
        fake = _serving(200, json.dumps(_POD_LIST).encode())

        outputs = _outputs(fake, _list_params(output_format="json"))

        assert outputs["names"] == ["web-1", "web-2"]
        assert outputs["count"] == 2
        assert len(fake.calls) == 1

    def test_an_empty_body_serializes_to_empty_text(self) -> None:
        outputs = _outputs(_serving(200, b""), _list_params(output_format="json"))

        assert outputs["result"] == ""
        assert outputs["success"] is True
        assert outputs["count"] == 0


class TestOutputFormatYaml:
    """output_format=yaml reads JSON off the wire and hands back a yaml envelope."""

    def test_the_request_asks_for_json_on_the_raw_path(self) -> None:
        fake = _serving(200, json.dumps(_POD_LIST).encode())

        _run(fake, _list_params(output_format="yaml"))

        assert fake.last.accept is None
        assert fake.last.raw is True

    def test_the_result_is_the_yaml_envelope_over_the_whole_document(self) -> None:
        fake = _serving(200, json.dumps(_POD_LIST).encode())

        outputs = _outputs(fake, _list_params(output_format="yaml"))

        assert outputs["result"] == {"__wave_type": "yaml", "value": _POD_LIST}

    def test_name_mode_wraps_the_single_object(self) -> None:
        fake = _serving(200, json.dumps(_POD).encode())

        outputs = _outputs(fake, _name_params(output_format="yaml"))

        assert outputs["result"] == {"__wave_type": "yaml", "value": _POD}
        assert outputs["names"] == ["web-1"]
        assert outputs["count"] == 1

    def test_an_empty_body_still_becomes_a_yaml_envelope(self) -> None:
        outputs = _outputs(_serving(200, b""), _list_params(output_format="yaml"))

        assert outputs["result"] == {"__wave_type": "yaml", "value": {}}
        assert outputs["success"] is True

    def test_the_yaml_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        fake = _serving(200, json.dumps(_POD_LIST).encode())

        envelope = _run(fake, _list_params(output_format="yaml"))

        assert json.loads(json.dumps(envelope)) == envelope


class TestManagedFieldsAreStripped:
    """kubectl hides metadata.managedFields by default, and so does every read path."""

    def test_a_map_read_drops_them(self) -> None:
        outputs = _outputs(_serving(200, _managed_pod()), _name_params())

        assert "managedFields" not in outputs["result"]["metadata"]
        assert outputs["result"]["metadata"]["name"] == "web-1"

    def test_a_list_read_drops_them_from_every_item(self) -> None:
        outputs = _outputs(_serving(200, _managed_list()), _list_params())

        assert all("managedFields" not in obj["metadata"] for obj in outputs["result"])

    def test_json_text_drops_them(self) -> None:
        fake = _serving(200, json.dumps(_managed_list()).encode())

        outputs = _outputs(fake, _list_params(output_format="json"))

        assert "managedFields" not in outputs["result"]

    def test_the_yaml_envelope_value_drops_them(self) -> None:
        fake = _serving(200, json.dumps(_managed_list()).encode())

        outputs = _outputs(fake, _list_params(output_format="yaml"))

        assert "managedFields" not in outputs["result"]["value"]["items"][0]["metadata"]

    def test_a_table_read_drops_them_from_the_embedded_objects(self) -> None:
        table = _table({"cells": ["web-1", "1/1", 3, 0.5, True, "4d"], "object": _managed_pod()})
        fake = _serving(200, table)

        outputs = _outputs(fake, _list_params(output_format="table"))

        assert "managedFields" not in table["rows"][0]["object"]["metadata"]
        assert outputs["names"] == ["web-1"]


class TestApiErrors:
    """The shared 4xx and 5xx rows rendered through the family error table."""

    def test_a_missing_named_object_renders_the_not_found_row(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        message = "K8s Pod 'web-1' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(404, body), _name_params())

    def test_a_missing_cluster_scoped_object_drops_the_namespace_clause(self) -> None:
        body = _failure("NotFound", 'nodes "kwok-node-0" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_NODES)
        message = "K8s Node 'kwok-node-0' not found"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params(kind="Node", name="kwok-node-0"))

    def test_401_renders_the_authentication_row(self) -> None:
        body = _failure("Unauthorized", "Unauthorized", 401)
        message = "Kubernetes API authentication failed: Unauthorized"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(401, body), _name_params())

    def test_403_renders_the_permission_row(self) -> None:
        detail = 'pods "web-1" is forbidden: user cannot get resource "pods"'
        body = _failure("Forbidden", detail, 403)
        message = f"Kubernetes API permission denied: {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(403, body), _name_params())

    def test_a_server_error_on_a_named_read_says_the_read_failed(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = _failure("ServiceUnavailable", detail, 503)
        message = f"Kubernetes could not read Pod 'web-1' in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(503, body), _name_params())

    def test_a_server_error_on_a_list_read_names_the_kind_not_an_object(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = _failure("ServiceUnavailable", detail, 503)
        message = f"Kubernetes could not list Pod objects in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(503, body), _list_params())

    def test_an_error_without_a_cluster_message_names_the_http_status(self) -> None:
        message = "Kubernetes could not read Pod 'web-1' in namespace 'apps' (HTTP 502)"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(502, {}), _name_params())

    def test_a_given_namespace_shows_in_the_not_found_row(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        message = "K8s Pod 'web-1' not found in namespace 'ops'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(404, body), _name_params(namespace="ops"))

    def test_a_missing_object_is_reported_by_its_typed_name_not_its_encoded_one(self) -> None:
        body = _failure("NotFound", 'pods "web 1?" not found', 404)
        message = "K8s Pod 'web 1?' not found in namespace 'my ns?'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(404, body), _name_params(name="web 1?", namespace="my ns?"))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_a_gateway_answer_at_401_reads_the_same_in_every_text_format(
        self, output_format: str
    ) -> None:
        message = "Kubernetes could not read Pod 'web-1' in namespace 'apps' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(401, GATEWAY_HTML), _name_params(output_format=output_format))


class TestUnreadableBody:
    """A 2xx body that is not the JSON object it claims fails the block in both modes."""

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_a_gateway_page_at_200_fails_the_block(self, output_format: str) -> None:
        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            _run(_serving(200, GATEWAY_HTML), _list_params(output_format=output_format))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_a_body_that_is_not_an_object_fails(self, output_format: str) -> None:
        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            _run(_serving(200, b"[1, 2, 3]"), _list_params(output_format=output_format))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_record_mode_does_not_soften_it(self, output_format: str) -> None:
        params = _list_params(output_format=output_format, on_error="record")

        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            _run(_serving(200, GATEWAY_HTML), params)


class TestAlwaysHardFail:
    """The carve-out: an unreadable session raises under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_an_absent_session_raises_in_both_modes(self, on_error: str) -> None:
        params = {"kind": "Pod", "search_by": "name", "name": "web-1", "on_error": on_error}

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(_serving(200, _POD), params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_rejected_session_raises_in_both_modes(self, on_error: str) -> None:
        params = _name_params(session="not-a-kubeconfig", on_error=on_error)

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(_serving(200, _POD), params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_transport_failure_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_PODS)

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _name_params(on_error=on_error))


class TestRecordedFailure:
    """Record and continue returns the empties, the failed core and the amber signal."""

    def test_a_recorded_failure_carries_the_failed_core_and_the_warning_signal(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)

        outputs = _outputs(_serving(404, body), _name_params(on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == "K8s Pod 'web-1' not found in namespace 'apps'"
        assert outputs["reason"] == "NotFound"
        assert outputs["__block_warning"] is True

    def test_a_recorded_failure_returns_exactly_the_declared_outputs_plus_the_signal(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)

        outputs = _outputs(_serving(404, body), _name_params(on_error="record"))

        assert set(outputs) == {
            "result",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    def test_a_recorded_failure_leaves_the_names_and_the_count_empty(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)

        outputs = _outputs(_serving(404, body), _name_params(on_error="record"))

        assert outputs["names"] == []
        assert outputs["count"] == 0

    def test_a_named_map_read_records_an_empty_object(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)

        outputs = _outputs(_serving(404, body), _name_params(on_error="record"))

        assert outputs["result"] == {}

    def test_a_list_map_read_records_an_empty_list(self) -> None:
        body = _failure("Forbidden", "pods is forbidden", 403)

        outputs = _outputs(_serving(403, body), _list_params(on_error="record"))

        assert outputs["result"] == []

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_a_text_read_records_empty_text(self, output_format: str) -> None:
        body = json.dumps(_failure("NotFound", 'pods "web-1" not found', 404)).encode()
        params = _name_params(on_error="record", output_format=output_format)

        outputs = _outputs(_serving(404, body), params)

        assert outputs["result"] == ""

    def test_a_table_read_records_an_empty_table_envelope(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        params = _name_params(on_error="record", output_format="table")

        outputs = _outputs(_serving(404, body), params)

        assert outputs["result"] == _EMPTY_TABLE

    def test_a_recorded_failure_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        params = _name_params(on_error="record", output_format="table")

        envelope = _run(_serving(404, body), params)

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_failure_reads_nothing_and_so_carries_no_secrets(self) -> None:
        body = _failure("Forbidden", "secrets is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_SECRETS)

        envelope = _run(fake, _list_params(kind="Secret", on_error="record"))

        assert envelope["secrets"] == []

    def test_record_mode_keeps_a_happy_read_green(self) -> None:
        outputs = _outputs(_serving(200, _POD_LIST), _list_params(on_error="record"))

        assert outputs["success"] is True
        assert outputs["count"] == 2
        assert "__block_warning" not in outputs

    def test_fail_is_the_default_mode(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        message = "K8s Pod 'web-1' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving(404, body), _name_params())


class TestSecrets:
    """Reading kind Secret carries every data value, encoded and decoded, in the envelope."""

    def test_every_data_value_is_carried_encoded_then_decoded(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)

        envelope = _run(fake, _name_params(kind="Secret", name="db-creds"))

        assert envelope["secrets"] == _SECRET_VALUES

    def test_a_value_whose_bytes_are_not_text_stays_encoded_only(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)

        envelope = _run(fake, _name_params(kind="Secret", name="db-creds"))

        assert envelope["secrets"].count(_BINARY_VALUE) == 1

    def test_a_value_that_is_not_base64_is_carried_verbatim_and_adds_nothing(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)

        envelope = _run(fake, _name_params(kind="Secret", name="db-creds"))

        assert envelope["secrets"].count(_UNDECODABLE_VALUE) == 1
        assert len(envelope["secrets"]) == len(_SECRET_VALUES)

    def test_a_list_of_secrets_carries_every_item_in_order(self) -> None:
        other = {
            "metadata": {"name": "tls-cert", "namespace": "apps"},
            "data": {"tls.key": _b64("private")},
        }
        listing = {"kind": "SecretList", "apiVersion": "v1", "items": [_SECRET, other]}
        fake = FakeK8sClient(responses=[(200, listing)], resources=_SECRETS)

        envelope = _run(fake, _list_params(kind="Secret"))

        assert envelope["secrets"] == [*_SECRET_VALUES, _b64("private"), "private"]

    def test_the_kind_that_counts_is_the_resolved_one_not_the_typed_one(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _SECRET)], resources={"secrets": resource("Secret", "secrets")}
        )
        params = block_params(
            resource_type="custom", kind_custom="secrets", search_by="name", name="db-creds"
        )

        envelope = _run(fake, params)

        assert envelope["secrets"] == _SECRET_VALUES

    def test_a_secret_without_data_carries_nothing(self) -> None:
        empty = {"kind": "Secret", "apiVersion": "v1", "metadata": {"name": "blank"}}
        fake = FakeK8sClient(responses=[(200, empty)], resources=_SECRETS)

        envelope = _run(fake, _name_params(kind="Secret", name="blank"))

        assert envelope["secrets"] == []

    def test_a_non_secret_kind_carries_nothing(self) -> None:
        envelope = _run(_serving(200, _POD), _name_params())

        assert envelope["secrets"] == []

    def test_the_secret_still_reads_with_its_values_in_the_result(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)

        outputs = _outputs(fake, _name_params(kind="Secret", name="db-creds"))

        assert outputs["success"] is True
        assert outputs["result"] == _SECRET

    def test_a_secret_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET)], resources=_SECRETS)

        envelope = _run(fake, _name_params(kind="Secret", name="db-creds"))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_table_read_of_secrets_asks_for_no_embedded_object_and_carries_nothing(self) -> None:
        fake = FakeK8sClient(responses=[(200, _SECRET_TABLE)], resources=_SECRETS)

        envelope = _run(fake, _list_params(kind="Secret", output_format="table"))

        assert _split(fake.last.path)[1] == {}
        assert envelope["secrets"] == []
        assert envelope["outputs"]["names"] == ["db-creds"]


class TestLogging:
    """The exact console lines, in order, through the log callable."""

    def test_a_happy_named_read_logs_the_count_the_kind_and_the_path(self) -> None:
        log = _Log()

        _run(_serving(200, _POD), _name_params(), log=log)

        assert log.entries == [
            ("INFO", "Read 1 Pod object(s) from /api/v1/namespaces/apps/pods/web-1")
        ]

    def test_a_happy_list_read_logs_the_full_path_including_the_query(self) -> None:
        log = _Log()

        _run(_serving(200, _POD_LIST), _selector_params(label_selector="app=web"), log=log)

        assert log.entries == [
            (
                "INFO",
                "Read 2 Pod object(s) from " "/api/v1/namespaces/apps/pods?labelSelector=app%3Dweb",
            )
        ]

    def test_a_recorded_failure_logs_the_read_failed_line_at_warn(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        log = _Log()

        _run(_serving(404, body), _name_params(on_error="record"), log=log)

        assert log.entries == [
            ("WARN", "Read failed (NotFound): K8s Pod 'web-1' not found in namespace 'apps'")
        ]

    def test_a_recorded_failure_without_a_reason_drops_the_parenthesized_clause(self) -> None:
        log = _Log()

        _run(_serving(401, {}), _name_params(on_error="record"), log=log)

        assert log.entries == [
            (
                "WARN",
                "Read failed: Kubernetes could not read Pod 'web-1' "
                "in namespace 'apps' (HTTP 401)",
            )
        ]

    def test_a_recorded_discovery_miss_logs_the_read_failed_line(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(
            resource_type="custom", kind_custom="Widget", search_by="list", on_error="record"
        )
        log = _Log()

        _run(fake, params, log=log)

        assert log.entries == [("WARN", f"Read failed (NotFound): {_DISCOVERY_MISS_MESSAGE}")]

    def test_a_failing_read_under_fail_mode_logs_nothing(self) -> None:
        body = _failure("NotFound", 'pods "web-1" not found', 404)
        log = _Log()

        with pytest.raises(ValueError):
            _run(_serving(404, body), _name_params(), log=log)

        assert log.entries == []
