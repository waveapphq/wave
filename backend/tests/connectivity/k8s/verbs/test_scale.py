"""K8s Scale verb tests (REQ-5.1.1, REQ-3.4.1.5).

scale.run is the sync core behind the K8s Scale block: it resolves the kind
through live discovery, reads the count in place off the /scale subresource and
merge-patches the new one back. It does not wait and does not poll, and a kind
the cluster serves no scale endpoint for is refused before anything is written.
The wire envelope's only unique output is the summary table envelope.
"""

import inspect
import json
from typing import Any

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    NAMESPACE,
    SERVER,
    DeniedDiscoveryClient,
    FakeK8sClient,
    RecordingLog,
    block_params,
    exact,
    patch_verb_client,
    resource,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.connectivity.k8s.verbs import scale

_DEPLOYMENTS = {"Deployment": resource("Deployment", "deployments", group_version="apps/v1")}
_STATEFULSETS = {"StatefulSet": resource("StatefulSet", "statefulsets", group_version="apps/v1")}
_WIDGETS = {"Widget": resource("Widget", "widgets", group_version="example.com/v1")}
_CLUSTER_WIDGETS = {
    "Widget": resource("Widget", "widgets", namespaced=False, group_version="example.com/v1")
}
_CONFIGMAPS = {"ConfigMap": resource("ConfigMap", "configmaps")}

_DEPLOY_SCALE = f"/apis/apps/v1/namespaces/{NAMESPACE}/deployments/web/scale"
_STATEFULSET_SCALE = f"/apis/apps/v1/namespaces/{NAMESPACE}/statefulsets/db/scale"
_WIDGET_SCALE = f"/apis/example.com/v1/namespaces/{NAMESPACE}/widgets/gizmo/scale"
_CLUSTER_WIDGET_SCALE = "/apis/example.com/v1/widgets/gizmo/scale"
_CONFIGMAP_SCALE = f"/api/v1/namespaces/{NAMESPACE}/configmaps/probe-a/scale"

_MERGE_PATCH = "application/merge-patch+json"
_COLUMNS = [
    {"name": "RESOURCE", "type": "string"},
    {"name": "OUTCOME", "type": "string"},
    {"name": "PREVIOUS", "type": "integer"},
    {"name": "REPLICAS", "type": "integer"},
]

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_DISCOVERY_MISS_MESSAGE = (
    "This cluster has no resource kind 'Widget' "
    "- check the spelling, or whether the CRD is installed"
)
_NOT_FOUND_MESSAGE = f"K8s Deployment 'web' not found in namespace '{NAMESPACE}'"
_SERVER_DETAIL = "the server is currently unable to handle the request"
_SERVER_MESSAGE = (
    f"Kubernetes could not scale Deployment 'web' in namespace '{NAMESPACE}': {_SERVER_DETAIL}"
)
_FORBIDDEN_DETAIL = 'deployments.apps "web" is forbidden: User "wave" cannot patch resource'
_FORBIDDEN_MESSAGE = f"Kubernetes API permission denied: {_FORBIDDEN_DETAIL}"


def _cannot_scale(kind: str) -> str:
    return f"Kind '{kind}' cannot be scaled - the cluster serves no scale endpoint for it"


def _failure(reason: str, message: str, code: int) -> dict[str, Any]:
    return {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
    }


def _scale_object(
    replicas: Any = None,
    observed: int | None = None,
    name: str = "web",
) -> dict[str, Any]:
    """A Scale as the API serves it; spec.replicas is omitted when the count is zero."""
    spec: dict[str, Any] = {} if replicas is None else {"replicas": replicas}
    status: dict[str, Any] = {} if observed is None else {"replicas": observed}
    return {
        "kind": "Scale",
        "apiVersion": "autoscaling/v1",
        "metadata": {"name": name, "namespace": NAMESPACE},
        "spec": spec,
        "status": status,
    }


_NO_SCALE_SUBRESOURCE = (
    404,
    {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": "the server could not find the requested resource",
        "reason": "NotFound",
        "details": {},
        "code": 404,
    },
)

_NO_DETAILS_AT_ALL = (404, _failure("NotFound", "the server could not find it", 404))

_OBJECT_MISSING = (
    404,
    {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": 'deployments.apps "web" not found',
        "reason": "NotFound",
        "details": {"name": "web", "group": "apps", "kind": "deployments"},
        "code": 404,
    },
)


def _valid_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"kind": "Deployment", "name": "web", "replicas": 3}
    params.update(overrides)
    return block_params(**params)


def _scaling(previous: Any, wanted: Any, observed: int | None = None) -> list[Any]:
    """The two scripted answers of one scale: the read, then the patched object."""
    return [(200, _scale_object(previous)), (200, _scale_object(wanted, observed))]


def _fake(*responses: Any, resources: dict[str, Any] | None = None) -> FakeK8sClient:
    return FakeK8sClient(responses=list(responses), resources=resources or _DEPLOYMENTS)


def _run(fake: FakeK8sClient, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    with patch_verb_client("scale", fake):
        envelope: dict[str, Any] = scale.run(params, RecordingLog() if log is None else log)
    return envelope


def _outputs(fake: FakeK8sClient, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    outputs: dict[str, Any] = _run(fake, params, log)["outputs"]
    return outputs


def _rows(outputs: dict[str, Any]) -> list[list[Any]]:
    rows: list[list[Any]] = outputs["summary"]["rows"]
    return rows


def _row(outputs: dict[str, Any], index: int = 0) -> list[Any]:
    return _rows(outputs)[index]


def _construction(fake: FakeK8sClient) -> tuple[Any, Any, dict[str, Any]]:
    call = fake.factory.call_args
    kwargs = dict(call.kwargs)
    context = call.args[0] if call.args else kwargs.pop("context", None)
    if "timeout" in kwargs:
        timeout = kwargs.pop("timeout")
    else:
        timeout = call.args[1] if len(call.args) > 1 else None
    return context, timeout, kwargs


class TestVerbShape:
    """run is a plain sync function returning the JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(scale.run) is False

    def test_run_is_a_plain_module_level_function(self) -> None:
        assert inspect.isfunction(scale.run) is True

    def test_run_takes_the_parameters_and_the_log_callable(self) -> None:
        assert list(inspect.signature(scale.run).parameters) == ["params", "log"]

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_a_happy_scale_returns_exactly_the_declared_outputs(self) -> None:
        outputs = _outputs(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert set(outputs) == {"summary", "success", "error", "reason"}

    def test_a_happy_scale_carries_the_full_output_core(self) -> None:
        outputs = _outputs(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert outputs["success"] is True
        assert outputs["error"] == ""
        assert outputs["reason"] == ""

    def test_a_recorded_failure_adds_the_warning_signal_to_the_declared_outputs(self) -> None:
        fake = _fake((403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403)))

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert set(outputs) == {"summary", "success", "error", "reason", "__block_warning"}

    def test_the_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_failure_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        fake = _fake((403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403)))

        envelope = _run(fake, _valid_params(replicas=5, on_error="record"))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_the_summary_is_a_plain_table_envelope_dict(self) -> None:
        outputs = _outputs(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert type(outputs["summary"]) is dict
        assert outputs["summary"]["__wave_type"] == "table"


class TestNoSecretsEverTravel:
    """Scale reads no object bodies, so every path carries an empty secrets list."""

    def test_a_happy_scale_carries_no_secrets(self) -> None:
        assert _run(_fake(*_scaling(2, 5)), _valid_params(replicas=5))["secrets"] == []

    def test_a_recorded_read_failure_carries_no_secrets(self) -> None:
        fake = _fake((401, _failure("Unauthorized", "token expired", 401)))

        assert _run(fake, _valid_params(replicas=5, on_error="record"))["secrets"] == []

    def test_a_recorded_write_failure_carries_no_secrets(self) -> None:
        fake = _fake((200, _scale_object(2)), (403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403)))

        assert _run(fake, _valid_params(replicas=5, on_error="record"))["secrets"] == []

    def test_a_recorded_scalability_refusal_carries_no_secrets(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(
            resource_type="custom", kind_custom="ConfigMap", name="probe-a", on_error="record"
        )

        assert _run(fake, params)["secrets"] == []

    def test_a_recorded_discovery_miss_carries_no_secrets(self) -> None:
        fake = FakeK8sClient(resources={})
        params = _valid_params(resource_type="custom", kind_custom="Widget", on_error="record")

        assert _run(fake, params)["secrets"] == []


class TestSummaryEnvelope:
    """Summary is a four-column table envelope, one row per scaled object."""

    def test_the_columns_are_the_four_pinned_names_and_types_in_order(self) -> None:
        outputs = _outputs(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert outputs["summary"]["columns"] == _COLUMNS

    def test_a_scale_from_two_to_five_is_exactly_one_row(self) -> None:
        outputs = _outputs(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert _rows(outputs) == [["deployment.apps/web", "scaled", 2, 5]]

    def test_a_statefulset_renders_the_way_kubectl_names_it(self) -> None:
        fake = _fake(*_scaling(1, 3), resources=_STATEFULSETS)

        outputs = _outputs(fake, _valid_params(kind="StatefulSet", name="db", replicas=3))

        assert _row(outputs) == ["statefulset.apps/db", "scaled", 1, 3]

    def test_a_custom_grouped_kind_carries_its_api_group(self) -> None:
        fake = _fake(*_scaling(2, 4), resources=_WIDGETS)
        params = _valid_params(
            resource_type="custom", kind_custom="Widget", name="gizmo", replicas=4
        )

        outputs = _outputs(fake, params)

        assert _row(outputs) == ["widget.example.com/gizmo", "scaled", 2, 4]

    def test_the_outcome_cell_reads_scaled(self) -> None:
        outputs = _outputs(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert _row(outputs)[1] == "scaled"

    def test_the_two_count_cells_are_integers(self) -> None:
        outputs = _outputs(_fake(*_scaling(2, 5)), _valid_params(replicas=5))

        assert type(_row(outputs)[2]) is int
        assert type(_row(outputs)[3]) is int

    def test_a_recorded_failure_keeps_the_four_columns_and_no_rows(self) -> None:
        fake = _fake((403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403)))

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["summary"] == {"__wave_type": "table", "columns": _COLUMNS, "rows": []}


class TestRequestShape:
    """The scale subresource is read, then merge-patched with the new count."""

    def test_the_typed_kind_is_discovered_once(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))

        assert fake.discoveries == ["Deployment"]

    def test_a_custom_kind_is_discovered_verbatim(self) -> None:
        fake = _fake(*_scaling(2, 4), resources=_WIDGETS)
        params = _valid_params(
            resource_type="custom", kind_custom="  Widget  ", name="gizmo", replicas=4
        )

        _run(fake, params)

        assert fake.discoveries == ["Widget"]

    def test_the_read_targets_the_scale_subresource(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))

        assert fake.calls[0].method == "GET"
        assert fake.calls[0].path == _DEPLOY_SCALE
        assert fake.calls[0].body is None
        assert fake.calls[0].content_type is None

    def test_the_write_is_a_patch_on_the_same_path(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))

        assert fake.calls[1].method == "PATCH"
        assert fake.calls[1].path == _DEPLOY_SCALE

    def test_the_write_declares_the_merge_patch_media_type(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))

        assert fake.calls[1].content_type == _MERGE_PATCH

    def test_the_patch_body_is_the_replica_count_and_nothing_else(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))

        assert fake.calls[1].body == {"spec": {"replicas": 5}}

    def test_no_query_string_is_ever_produced(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))

        assert [call.path for call in fake.calls if "?" in call.path] == []

    def test_the_name_is_percent_encoded_before_the_subresource(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5, name="  web 1?  "))

        assert fake.calls[1].path == (
            f"/apis/apps/v1/namespaces/{NAMESPACE}/deployments/web%201%3F/scale"
        )

    def test_the_namespace_is_percent_encoded(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5, namespace="my ns?"))

        assert fake.calls[0].path == "/apis/apps/v1/namespaces/my%20ns%3F/deployments/web/scale"

    def test_a_given_namespace_wins_over_the_session_default(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5, namespace="ops"))

        assert [call.path for call in fake.calls] == [
            "/apis/apps/v1/namespaces/ops/deployments/web/scale",
            "/apis/apps/v1/namespaces/ops/deployments/web/scale",
        ]

    def test_a_stray_all_namespaces_tick_is_ignored(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5, all_namespaces=True))

        assert fake.calls[0].path == _DEPLOY_SCALE

    def test_a_cluster_scoped_kind_carries_no_namespace_segment(self) -> None:
        fake = _fake(*_scaling(2, 5), resources=_CLUSTER_WIDGETS)
        params = _valid_params(
            resource_type="custom", kind_custom="Widget", name="gizmo", replicas=5
        )

        _run(fake, params)

        assert [call.path for call in fake.calls] == [
            _CLUSTER_WIDGET_SCALE,
            _CLUSTER_WIDGET_SCALE,
        ]

    def test_a_cluster_scoped_failure_drops_the_namespace_clause(self) -> None:
        fake = _fake(
            (503, _failure("ServiceUnavailable", _SERVER_DETAIL, 503)), resources=_CLUSTER_WIDGETS
        )
        params = _valid_params(
            resource_type="custom", kind_custom="Widget", name="gizmo", replicas=5
        )
        message = f"Kubernetes could not scale Widget 'gizmo': {_SERVER_DETAIL}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, params)


class TestReplicaRoundTrip:
    """Zero is a value, the cluster's echo is the truth, and both counts are integers."""

    def test_scaling_to_zero_sends_the_zero(self) -> None:
        fake = _fake((200, _scale_object(3)), (200, _scale_object(None)))

        _run(fake, _valid_params(replicas=0))

        assert fake.calls[1].body == {"spec": {"replicas": 0}}

    def test_a_patched_object_without_a_replica_key_reads_back_as_zero(self) -> None:
        fake = _fake((200, _scale_object(3)), (200, _scale_object(None)))

        outputs = _outputs(fake, _valid_params(replicas=0))

        assert _row(outputs) == ["deployment.apps/web", "scaled", 3, 0]

    def test_a_read_object_without_a_replica_key_reads_previous_as_zero(self) -> None:
        fake = _fake((200, _scale_object(None)), (200, _scale_object(2)))

        outputs = _outputs(fake, _valid_params(replicas=2))

        assert _row(outputs) == ["deployment.apps/web", "scaled", 0, 2]

    def test_zero_to_zero_reads_both_missing_keys_as_zero(self) -> None:
        fake = _fake((200, _scale_object(None)), (200, _scale_object(None)))

        outputs = _outputs(fake, _valid_params(replicas=0))

        assert _row(outputs) == ["deployment.apps/web", "scaled", 0, 0]
        assert outputs["success"] is True

    def test_a_replica_count_that_rides_the_wire_as_text_is_coerced(self) -> None:
        fake = _fake((200, _scale_object("2")), (200, _scale_object("5")))

        outputs = _outputs(fake, _valid_params(replicas=5))

        assert _row(outputs) == ["deployment.apps/web", "scaled", 2, 5]

    def test_the_requested_count_is_coerced_before_it_reaches_the_body(self) -> None:
        fake = _fake(*_scaling(2, 4))

        _run(fake, _valid_params(replicas="4"))

        assert fake.calls[1].body == {"spec": {"replicas": 4}}

    def test_the_replicas_cell_is_the_clusters_echo_and_not_the_request(self) -> None:
        fake = _fake((200, _scale_object(2)), (200, _scale_object(4)))
        log = RecordingLog()

        outputs = _outputs(fake, _valid_params(replicas=5), log=log)

        assert fake.calls[1].body == {"spec": {"replicas": 5}}
        assert _row(outputs) == ["deployment.apps/web", "scaled", 2, 4]
        assert log.entries == [("INFO", "Scaled deployment.apps/web from 2 to 4")]


class TestNoWaitAndNoPoll:
    """The verb writes the count and returns; the cluster's pace changes nothing."""

    def test_exactly_one_read_and_one_write_are_issued(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))

        assert [(call.method, call.path) for call in fake.calls] == [
            ("GET", _DEPLOY_SCALE),
            ("PATCH", _DEPLOY_SCALE),
        ]

    def test_a_still_converging_cluster_reports_the_written_count_and_is_not_polled(self) -> None:
        fake = _fake(*_scaling(2, 5, observed=2))

        outputs = _outputs(fake, _valid_params(replicas=5))

        assert _row(outputs) == ["deployment.apps/web", "scaled", 2, 5]
        assert len(fake.calls) == 2

    def test_an_answer_carrying_no_status_at_all_changes_nothing(self) -> None:
        fake = _fake((200, _scale_object(2)), (200, _scale_object(5)))

        outputs = _outputs(fake, _valid_params(replicas=5))

        assert _row(outputs) == ["deployment.apps/web", "scaled", 2, 5]
        assert len(fake.calls) == 2

    def test_a_scale_to_the_count_already_in_place_still_writes_once(self) -> None:
        fake = _fake(*_scaling(3, 3))

        outputs = _outputs(fake, _valid_params(replicas=3))

        assert len(fake.calls) == 2
        assert _row(outputs) == ["deployment.apps/web", "scaled", 3, 3]

    def test_the_observed_replica_count_is_never_read(self) -> None:
        fake = _fake((200, _scale_object(2, observed=99)), (200, _scale_object(5, observed=99)))

        outputs = _outputs(fake, _valid_params(replicas=5))

        assert _row(outputs) == ["deployment.apps/web", "scaled", 2, 5]


class TestScalabilityGuard:
    """A kind with no scale endpoint is refused by WAVE before anything is written."""

    def test_the_refusal_names_the_resolved_kind(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(resource_type="custom", kind_custom="ConfigMap", name="probe-a")

        with pytest.raises(ValueError, match=exact(_cannot_scale("ConfigMap"))):
            _run(fake, params)

    def test_the_refusal_writes_nothing_at_all(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(resource_type="custom", kind_custom="ConfigMap", name="probe-a")

        with pytest.raises(ValueError):
            _run(fake, params)

        assert [call.method for call in fake.calls] == ["GET"]
        assert fake.calls[0].path == _CONFIGMAP_SCALE

    def test_the_refusal_is_recordable_with_the_cluster_reason(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(
            resource_type="custom", kind_custom="ConfigMap", name="probe-a", on_error="record"
        )

        outputs = _outputs(fake, params)

        assert outputs["success"] is False
        assert outputs["error"] == _cannot_scale("ConfigMap")
        assert outputs["reason"] == "NotFound"

    def test_a_recorded_refusal_writes_nothing_either(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(
            resource_type="custom", kind_custom="ConfigMap", name="probe-a", on_error="record"
        )

        _run(fake, params)

        assert [call.method for call in fake.calls] == ["GET"]

    def test_a_recorded_refusal_logs_the_scale_shaped_warn_line(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(
            resource_type="custom", kind_custom="ConfigMap", name="probe-a", on_error="record"
        )
        log = RecordingLog()

        _run(fake, params, log=log)

        assert log.entries == [
            (
                "WARN",
                "Scale failed (NotFound): Kind 'ConfigMap' cannot be scaled "
                "- the cluster serves no scale endpoint for it",
            )
        ]

    def test_a_missing_object_is_a_not_found_and_not_a_scalability_refusal(self) -> None:
        fake = _fake(_OBJECT_MISSING)

        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            _run(fake, _valid_params(replicas=5))

    def test_a_missing_object_writes_nothing(self) -> None:
        fake = _fake(_OBJECT_MISSING)

        with pytest.raises(ValueError):
            _run(fake, _valid_params(replicas=5))

        assert [call.method for call in fake.calls] == ["GET"]

    def test_a_missing_namespace_renders_the_namespace_row(self) -> None:
        body = _failure("NotFound", 'namespaces "gone" not found', 404)
        body["details"] = {"name": "gone", "kind": "namespaces"}
        fake = _fake((404, body))

        with pytest.raises(ValueError, match=exact("K8s namespace 'gone' not found")):
            _run(fake, _valid_params(replicas=5, namespace="gone"))

    def test_a_body_with_no_details_at_all_reads_as_the_missing_subresource(self) -> None:
        fake = _fake(_NO_DETAILS_AT_ALL)

        with pytest.raises(ValueError, match=exact(_cannot_scale("Deployment"))):
            _run(fake, _valid_params(replicas=5))


class TestFailureHandling:
    """Cluster refusals read as a scale, and a recorded one asks for amber."""

    def test_a_server_error_on_the_read_says_the_scale_failed(self) -> None:
        fake = _fake((503, _failure("ServiceUnavailable", _SERVER_DETAIL, 503)))

        with pytest.raises(ValueError, match=exact(_SERVER_MESSAGE)):
            _run(fake, _valid_params(replicas=5))

    def test_a_server_error_on_the_write_says_the_scale_failed_too(self) -> None:
        fake = _fake(
            (200, _scale_object(2)), (503, _failure("ServiceUnavailable", _SERVER_DETAIL, 503))
        )

        with pytest.raises(ValueError, match=exact(_SERVER_MESSAGE)):
            _run(fake, _valid_params(replicas=5))

    def test_a_recorded_server_error_on_the_write_logs_the_scale_shaped_warn_line(self) -> None:
        fake = _fake(
            (200, _scale_object(2)), (503, _failure("ServiceUnavailable", _SERVER_DETAIL, 503))
        )
        log = RecordingLog()

        _run(fake, _valid_params(replicas=5, on_error="record"), log=log)

        assert log.entries == [("WARN", f"Scale failed (ServiceUnavailable): {_SERVER_MESSAGE}")]

    def test_a_denied_write_records_the_permission_row(self) -> None:
        fake = _fake((200, _scale_object(2)), (403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403)))

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["error"] == _FORBIDDEN_MESSAGE
        assert outputs["reason"] == "Forbidden"

    def test_an_expired_token_on_the_read_records_the_authentication_row(self) -> None:
        fake = _fake((401, _failure("Unauthorized", "token expired", 401)))

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["error"] == "Kubernetes API authentication failed: token expired"
        assert outputs["reason"] == "Unauthorized"

    def test_an_expired_token_on_the_write_records_the_authentication_row(self) -> None:
        fake = _fake((200, _scale_object(2)), (401, _failure("Unauthorized", "token expired", 401)))

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["error"] == "Kubernetes API authentication failed: token expired"
        assert outputs["reason"] == "Unauthorized"

    def test_a_denied_read_records_the_permission_row(self) -> None:
        detail = 'deployments.apps "web" is forbidden: User "wave" cannot get resource'
        fake = _fake((403, _failure("Forbidden", detail, 403)))

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["error"] == f"Kubernetes API permission denied: {detail}"
        assert outputs["reason"] == "Forbidden"

    def test_a_vanished_object_on_the_write_records_the_not_found_row(self) -> None:
        fake = _fake((200, _scale_object(2)), _OBJECT_MISSING)

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["error"] == _NOT_FOUND_MESSAGE
        assert outputs["reason"] == "NotFound"

    def test_a_conflicting_write_records_the_update_row(self) -> None:
        detail = "the object has been modified; please apply your changes to the latest version"
        fake = _fake((200, _scale_object(2)), (409, _failure("Conflict", detail, 409)))
        message = (
            "Kubernetes rejected the update to Deployment 'web' "
            f"because it changed on the cluster first: {detail}"
        )

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["error"] == message
        assert outputs["reason"] == "Conflict"

    def test_a_read_error_without_a_message_names_the_http_status(self) -> None:
        fake = _fake((500, {}))
        message = (
            f"Kubernetes could not scale Deployment 'web' in namespace '{NAMESPACE}' (HTTP 500)"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _valid_params(replicas=5))

    def test_a_write_error_without_a_message_names_the_http_status(self) -> None:
        fake = _fake((200, _scale_object(2)), (500, {}))
        message = (
            f"Kubernetes could not scale Deployment 'web' in namespace '{NAMESPACE}' (HTTP 500)"
        )

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["error"] == message
        assert outputs["reason"] == ""

    def test_a_recorded_failure_carries_the_warning_signal(self) -> None:
        fake = _fake((403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403)))

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["__block_warning"] is True

    def test_a_happy_scale_logs_exactly_one_info_line_and_no_warning(self) -> None:
        log = RecordingLog()

        _run(_fake(*_scaling(2, 5)), _valid_params(replicas=5, on_error="record"), log=log)

        assert log.entries == [("INFO", "Scaled deployment.apps/web from 2 to 5")]

    def test_fail_mode_logs_no_warn_line(self) -> None:
        fake = _fake((403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403)))
        log = RecordingLog()

        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            _run(fake, _valid_params(replicas=5), log=log)

        assert log.entries == []

    def test_fail_is_the_default_on_error_mode(self) -> None:
        fake = _fake((403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403)))
        params = _valid_params(replicas=5)

        assert "on_error" not in params
        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            _run(fake, params)


class TestDiscovery:
    """The kind resolution that precedes both requests."""

    def test_a_discovery_miss_names_the_typed_kind_and_issues_no_request(self) -> None:
        fake = FakeK8sClient(resources={})
        params = _valid_params(resource_type="custom", kind_custom="Widget")

        with pytest.raises(ValueError, match=exact(_DISCOVERY_MISS_MESSAGE)):
            _run(fake, params)

        assert fake.calls == []

    def test_a_discovery_miss_is_recordable_and_still_issues_no_request(self) -> None:
        fake = FakeK8sClient(resources={})
        params = _valid_params(resource_type="custom", kind_custom="Widget", on_error="record")

        outputs = _outputs(fake, params)

        assert outputs["success"] is False
        assert outputs["error"] == _DISCOVERY_MISS_MESSAGE
        assert outputs["reason"] == "NotFound"
        assert fake.calls == []

    def test_a_denied_walk_renders_the_authentication_row(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))

        with pytest.raises(
            ValueError, match=exact("Kubernetes API authentication failed: Unauthorized")
        ):
            _run(fake, _valid_params(replicas=5))

    def test_a_denied_walk_is_recordable_with_its_reason_and_issues_no_request(self) -> None:
        detail = 'User "wave" cannot list resource "apis"'
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", detail, 403))

        outputs = _outputs(fake, _valid_params(replicas=5, on_error="record"))

        assert outputs["error"] == f"Kubernetes API permission denied: {detail}"
        assert outputs["reason"] == "Forbidden"
        assert fake.calls == []


class TestClientConstruction:
    """The REST core is built from the session context and the block's rows."""

    def test_the_client_receives_the_session_context(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))
        context, _, _ = _construction(fake)

        assert context.server == SERVER
        assert context.namespace == NAMESPACE
        assert context.token == "sa-tok"

    def test_the_client_timeout_defaults_to_thirty(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))

        assert _construction(fake)[1] == 30

    def test_an_explicit_timeout_reaches_the_client(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5, timeout=45))

        assert _construction(fake)[1] == 45

    def test_impersonation_reaches_the_client_as_a_user_and_a_group_list(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(
            fake,
            _valid_params(replicas=5, impersonate_user="qa-bot", impersonate_groups="dev, ops"),
        )

        assert _construction(fake)[2] == {
            "impersonate_user": "qa-bot",
            "impersonate_groups": ["dev", "ops"],
        }

    def test_no_impersonation_is_handed_over_when_none_is_configured(self) -> None:
        fake = _fake(*_scaling(2, 5))

        _run(fake, _valid_params(replicas=5))
        _, _, extra = _construction(fake)

        assert extra["impersonate_user"] is None
        assert extra["impersonate_groups"] is None


class TestAlwaysHardFail:
    """The carve-out: these raise under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_bogus_session_raises_in_both_modes(self, on_error: str) -> None:
        fake = _fake(*_scaling(2, 5))
        params = _valid_params(replicas=5, on_error=on_error, session="not-a-kubeconfig")

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(fake, params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_an_absent_session_raises_in_both_modes(self, on_error: str) -> None:
        fake = _fake(*_scaling(2, 5))
        params = _valid_params(replicas=5, on_error=on_error)
        del params["session"]

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(fake, params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_transport_failure_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = _fake(K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _valid_params(replicas=5, on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_tls_failure_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Could not verify the TLS certificate of {SERVER}: self-signed certificate"
        fake = _fake(K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _valid_params(replicas=5, on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_request_timeout_on_the_write_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Kubernetes API request PATCH {_DEPLOY_SCALE} timed out after 30 seconds"
        fake = _fake((200, _scale_object(2)), K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _valid_params(replicas=5, on_error=on_error))
