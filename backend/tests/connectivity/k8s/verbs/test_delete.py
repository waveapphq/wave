"""K8s Delete verb tests (REQ-5.1.1, REQ-3.4.1.5, K8SWRITE-5).

delete.run is the sync core behind the K8s Delete block: it resolves the kind
through live discovery, removes one object by name or every object a label
selector matches, and then waits until the cluster no longer serves them,
bounded by the block timeout. It hands back the wire envelope whose summary is
a table envelope of one row per deleted object.
"""

import inspect
import json
import urllib.parse
from typing import Any
from unittest.mock import patch

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
from wavecore.connectivity.k8s.verbs import delete

_TIME_TARGET = "wavecore.connectivity.k8s.verbs.delete.time"
_INTERVAL_TARGET = "wavecore.connectivity.k8s.verbs.delete._POLL_INTERVAL_SECONDS"

_CONFIGMAPS = {"ConfigMap": resource("ConfigMap", "configmaps")}
_DEPLOYMENTS = {"Deployment": resource("Deployment", "deployments", group_version="apps/v1")}
_NODES = {"Node": resource("Node", "nodes", namespaced=False)}
_WIDGETS = {"widgets": resource("Widget", "widgets", group_version="acme.io/v1")}

_CONFIGMAP_PATH = f"/api/v1/namespaces/{NAMESPACE}/configmaps"
_NAMED_PATH = f"{_CONFIGMAP_PATH}/probe-a"
_COLUMNS = [{"name": "RESOURCE", "type": "string"}, {"name": "OUTCOME", "type": "string"}]

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_DISCOVERY_MISS_MESSAGE = (
    "This cluster has no resource kind 'Widget' "
    "- check the spelling, or whether the CRD is installed"
)
_NOT_FOUND_MESSAGE = f"K8s ConfigMap 'probe-a' not found in namespace '{NAMESPACE}'"
_FORBIDDEN_DETAIL = 'configmaps "probe-a" is forbidden: User "dev" cannot delete resource'
_FORBIDDEN_MESSAGE = f"Kubernetes API permission denied: {_FORBIDDEN_DETAIL}"
_SERVER_DETAIL = "the server is currently unable to handle the request"
_SERVER_MESSAGE = (
    f"Kubernetes could not delete ConfigMap 'probe-a' in namespace '{NAMESPACE}': {_SERVER_DETAIL}"
)
_SELECTOR_SERVER_MESSAGE = (
    f"Kubernetes could not delete ConfigMap objects in namespace '{NAMESPACE}': {_SERVER_DETAIL}"
)
_NAME_TIMEOUT_MESSAGE = "Timed out after 5 seconds waiting for configmap/probe-a to be deleted"
_SELECTOR_TIMEOUT_MESSAGE = (
    "Timed out after 5 seconds waiting for configmaps matching app=web to be deleted"
)


class _Clock:
    """A fake time module: the monotonic reading moves when the loop sleeps, or by step."""

    def __init__(self, start: float = 0.0, step: float = 0.0) -> None:
        self.now = start
        self.step = step
        self.sleeps: list[float] = []
        self.reads = 0

    def monotonic(self) -> float:
        self.reads += 1
        reading = self.now
        self.now += self.step
        return reading

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def _failure(reason: str, message: str, code: int) -> dict[str, Any]:
    return {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
    }


def _accepted(name: str = "probe-a", plural: str = "configmaps") -> tuple[int, dict[str, Any]]:
    """The Status the apiserver returns when it accepts a delete by name."""
    return (
        200,
        {
            "kind": "Status",
            "apiVersion": "v1",
            "status": "Success",
            "details": {"name": name, "kind": plural},
        },
    )


def _gone(name: str = "probe-a", plural: str = "configmaps") -> tuple[int, dict[str, Any]]:
    """The answer a poll gets once the object is really gone."""
    return (404, _failure("NotFound", f'{plural} "{name}" not found', 404))


def _still_there(name: str = "probe-a") -> tuple[int, dict[str, Any]]:
    """The answer a poll gets while the object is still being removed."""
    return (
        200,
        {
            "kind": "ConfigMap",
            "apiVersion": "v1",
            "metadata": {"name": name, "namespace": NAMESPACE, "deletionTimestamp": "2026-08-27"},
        },
    )


def _refused_poll() -> tuple[int, dict[str, Any]]:
    """The answer a poll gets when the cluster refuses the read."""
    return (403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))


def _broken_poll() -> tuple[int, dict[str, Any]]:
    """The answer a poll gets when the read breaks inside the cluster."""
    return (500, _failure("InternalError", _SERVER_DETAIL, 500))


def _collection(*names: str) -> tuple[int, dict[str, Any]]:
    """The list the apiserver returns for a delete on a collection."""
    return (
        200,
        {
            "kind": "ConfigMapList",
            "apiVersion": "v1",
            "items": [{"metadata": {"name": name, "namespace": NAMESPACE}} for name in names],
        },
    )


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


def _name_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"kind": "ConfigMap", "delete_by": "name", "name": "probe-a"}
    params.update(overrides)
    return block_params(**params)


def _selector_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "kind": "ConfigMap",
        "delete_by": "selector",
        "label_selector": "app=web",
    }
    params.update(overrides)
    return block_params(**params)


def _run(
    fake: FakeK8sClient,
    params: dict[str, Any],
    log: Any = None,
    clock: _Clock | None = None,
) -> dict[str, Any]:
    """Run the verb against the fake core and a fake clock, so no test ever really sleeps."""
    with patch_verb_client("delete", fake), patch(_TIME_TARGET, clock or _Clock()):
        envelope: dict[str, Any] = delete.run(params, RecordingLog() if log is None else log)
    return envelope


def _outputs(
    fake: FakeK8sClient,
    params: dict[str, Any],
    log: Any = None,
    clock: _Clock | None = None,
) -> dict[str, Any]:
    outputs: dict[str, Any] = _run(fake, params, log, clock)["outputs"]
    return outputs


def _rows(outputs: dict[str, Any]) -> list[list[Any]]:
    rows: list[list[Any]] = outputs["summary"]["rows"]
    return rows


def _named_client(*responses: Any, resources: dict[str, Any] | None = None) -> FakeK8sClient:
    """A named delete the cluster accepts, then the polls the test scripts."""
    return FakeK8sClient(
        responses=list(responses) or [_accepted(), _gone()],
        resources=resources or _CONFIGMAPS,
    )


def _never_gone_client() -> FakeK8sClient:
    """A named delete the cluster accepts, then polls that always say it is still there."""
    return FakeK8sClient(responses=[_accepted()], resources=_CONFIGMAPS, default=_still_there())


def _selector_poll_client(poll: tuple[int, dict[str, Any]]) -> FakeK8sClient:
    """A selector delete the cluster accepts, then a poll that answers the same way for ever."""
    return FakeK8sClient(responses=[_collection("probe-a")], resources=_CONFIGMAPS, default=poll)


def _refusing_client(status: int, body: dict[str, Any]) -> FakeK8sClient:
    """A cluster that refuses the delete itself."""
    return FakeK8sClient(responses=[(status, body)], resources=_CONFIGMAPS)


class TestVerbShape:
    """run is a plain sync function returning the JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(delete.run) is False

    def test_run_is_a_plain_module_level_function(self) -> None:
        assert inspect.isfunction(delete.run) is True

    def test_run_takes_the_parameters_and_the_log_callable(self) -> None:
        assert list(inspect.signature(delete.run).parameters) == ["params", "log"]

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(_named_client(), _name_params())

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_a_happy_delete_returns_exactly_the_declared_outputs(self) -> None:
        outputs = _outputs(_named_client(), _name_params())

        assert set(outputs) == {"summary", "names", "count", "success", "error", "reason"}

    def test_a_happy_delete_carries_the_full_output_core(self) -> None:
        outputs = _outputs(_named_client(), _name_params())

        assert outputs["success"] is True
        assert outputs["error"] == ""
        assert outputs["reason"] == ""

    def test_a_recorded_failure_adds_the_warning_signal_to_the_declared_outputs(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert set(outputs) == {
            "summary",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    def test_the_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(_named_client(), _name_params())

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_failure_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        envelope = _run(fake, _name_params(on_error="record"))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_the_summary_is_a_plain_table_envelope_dict(self) -> None:
        outputs = _outputs(_named_client(), _name_params())

        assert type(outputs["summary"]) is dict
        assert outputs["summary"]["__wave_type"] == "table"


class TestNoSecretsEverTravel:
    """Delete reads no object bodies, so every path carries an empty secrets list."""

    def test_a_named_delete_carries_no_secrets(self) -> None:
        assert _run(_named_client(), _name_params())["secrets"] == []

    def test_a_selector_delete_carries_no_secrets(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        assert _run(fake, _selector_params())["secrets"] == []

    def test_a_swallowed_missing_name_carries_no_secrets(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        assert _run(fake, _name_params(ignore_not_found=True))["secrets"] == []

    def test_a_recorded_refusal_carries_no_secrets(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        assert _run(fake, _name_params(on_error="record"))["secrets"] == []

    def test_a_recorded_timeout_carries_no_secrets(self) -> None:
        envelope = _run(_never_gone_client(), _name_params(timeout=5, on_error="record"))

        assert envelope["secrets"] == []

    def test_a_recorded_discovery_miss_carries_no_secrets(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(
            resource_type="custom", kind_custom="Widget", name="w-1", on_error="record"
        )

        assert _run(fake, params)["secrets"] == []


class TestSummaryEnvelope:
    """One row per deleted object, the resource in kubectl's type/name form."""

    def test_the_columns_are_resource_and_outcome_in_that_order(self) -> None:
        outputs = _outputs(_named_client(), _name_params())

        assert outputs["summary"]["columns"] == _COLUMNS

    def test_a_named_delete_summarizes_exactly_one_row(self) -> None:
        outputs = _outputs(_named_client(), _name_params())

        assert _rows(outputs) == [["configmap/probe-a", "deleted"]]

    def test_a_grouped_kind_carries_its_group_in_the_resource_cell(self) -> None:
        fake = _named_client(
            _accepted("web", "deployments"),
            _gone("web", "deployments"),
            resources=_DEPLOYMENTS,
        )

        outputs = _outputs(fake, _name_params(kind="Deployment", name="web"))

        assert _rows(outputs) == [["deployment.apps/web", "deleted"]]

    def test_a_cluster_scoped_kind_renders_without_a_group(self) -> None:
        fake = _named_client(
            _accepted("kwok-node-0", "nodes"),
            _gone("kwok-node-0", "nodes"),
            resources=_NODES,
        )

        outputs = _outputs(fake, _name_params(kind="Node", name="kwok-node-0"))

        assert _rows(outputs) == [["node/kwok-node-0", "deleted"]]

    def test_a_selector_delete_summarizes_one_row_per_object_in_wire_order(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-b", "probe-a"), _collection()], resources=_CONFIGMAPS
        )

        outputs = _outputs(fake, _selector_params())

        assert _rows(outputs) == [
            ["configmap/probe-b", "deleted"],
            ["configmap/probe-a", "deleted"],
        ]

    def test_a_selector_that_matches_nothing_keeps_the_columns_and_no_rows(self) -> None:
        fake = FakeK8sClient(responses=[_collection()], resources=_CONFIGMAPS)

        outputs = _outputs(fake, _selector_params())

        assert outputs["summary"] == {"__wave_type": "table", "columns": _COLUMNS, "rows": []}

    def test_a_recorded_failure_keeps_the_columns_and_no_rows(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["summary"] == {"__wave_type": "table", "columns": _COLUMNS, "rows": []}

    def test_every_outcome_cell_reads_deleted(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a", "probe-b"), _collection()], resources=_CONFIGMAPS
        )

        outputs = _outputs(fake, _selector_params())

        assert [row[1] for row in _rows(outputs)] == ["deleted", "deleted"]


class TestKindResolution:
    """Default mode discovers 'kind'; custom mode discovers 'kind_custom', both stripped."""

    def test_the_declared_kind_is_discovered_once(self) -> None:
        fake = _named_client()

        _run(fake, _name_params())

        assert fake.discoveries == ["ConfigMap"]

    def test_a_custom_kind_is_discovered_verbatim(self) -> None:
        fake = _named_client(
            _accepted("w-1", "widgets"), _gone("w-1", "widgets"), resources=_WIDGETS
        )
        params = block_params(resource_type="custom", kind_custom="widgets", name="w-1")

        _run(fake, params)

        assert fake.discoveries == ["widgets"]

    def test_a_default_kind_is_stripped_before_discovery(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(kind="  ConfigMap  "))

        assert fake.discoveries == ["ConfigMap"]

    def test_a_custom_kind_is_stripped_before_discovery(self) -> None:
        fake = _named_client(
            _accepted("w-1", "widgets"), _gone("w-1", "widgets"), resources=_WIDGETS
        )
        params = block_params(resource_type="custom", kind_custom="  widgets  ", name="w-1")

        _run(fake, params)

        assert fake.discoveries == ["widgets"]

    def test_a_discovery_miss_names_the_typed_kind_and_issues_no_request(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(resource_type="custom", kind_custom="Widget", name="w-1")

        with pytest.raises(ValueError, match=exact(_DISCOVERY_MISS_MESSAGE)):
            _run(fake, params)

        assert fake.calls == []

    def test_a_discovery_miss_is_recordable_and_still_issues_no_request(self) -> None:
        fake = FakeK8sClient(resources={})
        params = block_params(
            resource_type="custom", kind_custom="Widget", name="w-1", on_error="record"
        )

        outputs = _outputs(fake, params)

        assert outputs["success"] is False
        assert outputs["error"] == _DISCOVERY_MISS_MESSAGE
        assert outputs["reason"] == "NotFound"
        assert fake.calls == []


class TestDiscoveryDenied:
    """A 401 or 403 on the discovery walk renders the credential rows, not a kind miss."""

    def test_401_renders_the_authentication_row(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))
        message = "Kubernetes API authentication failed: Unauthorized"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params())

    def test_403_renders_the_permission_row(self) -> None:
        detail = 'forbidden: User "wave" cannot get path "/api/v1"'
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", detail, 403))

        with pytest.raises(ValueError, match=exact(f"Kubernetes API permission denied: {detail}")):
            _run(fake, _name_params())

    def test_a_denied_walk_is_recordable_with_its_reason(self) -> None:
        detail = 'forbidden: User "wave" cannot get path "/api/v1"'
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", detail, 403))

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == f"Kubernetes API permission denied: {detail}"
        assert outputs["reason"] == "Forbidden"

    def test_a_denial_without_a_reason_records_an_empty_reason(self) -> None:
        fake = DeniedDiscoveryClient(401, {})

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["error"] == "Kubernetes could not list ConfigMap objects (HTTP 401)"
        assert outputs["reason"] == ""

    def test_a_denied_walk_issues_no_request(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))

        _run(fake, _name_params(on_error="record"))

        assert fake.discoveries == ["ConfigMap"]
        assert fake.calls == []


class TestNameModeRequest:
    """delete_by=name removes exactly one object."""

    def test_exactly_one_delete_targets_the_named_object(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(wait_until_gone=False))

        assert [call.method for call in fake.calls] == ["DELETE"]
        assert _split(fake.calls[0].path)[0] == _NAMED_PATH

    def test_the_delete_carries_no_body_and_asks_for_no_media_type(self) -> None:
        fake = _named_client()

        _run(fake, _name_params())

        assert fake.calls[0].body is None
        assert fake.calls[0].content_type is None
        assert fake.calls[0].accept is None
        assert fake.calls[0].raw is False

    def test_the_name_is_stripped_and_percent_encoded_in_the_path(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(name="  web 1?  ", wait_until_gone=False))

        assert _split(fake.calls[0].path)[0] == f"{_CONFIGMAP_PATH}/web%201%3F"

    def test_the_namespace_is_percent_encoded_in_the_path(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(namespace="my ns?", wait_until_gone=False))

        assert _split(fake.calls[0].path)[0] == "/api/v1/namespaces/my%20ns%3F/configmaps/probe-a"

    def test_a_label_selector_left_behind_never_reaches_a_named_delete(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(label_selector="app=web"))

        assert "labelSelector" not in _split(fake.calls[0].path)[1]

    def test_the_session_namespace_is_used_when_none_is_given(self) -> None:
        fake = _named_client()

        _run(fake, _name_params())

        assert _split(fake.calls[0].path)[0] == _NAMED_PATH

    def test_a_given_namespace_wins_over_the_session_default(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(namespace="ops"))

        assert _split(fake.calls[0].path)[0] == "/api/v1/namespaces/ops/configmaps/probe-a"

    def test_a_cluster_scoped_kind_carries_no_namespace_segment(self) -> None:
        fake = _named_client(
            _accepted("kwok-node-0", "nodes"),
            _gone("kwok-node-0", "nodes"),
            resources=_NODES,
        )

        _run(fake, _name_params(kind="Node", name="kwok-node-0", namespace="ops"))

        assert _split(fake.calls[0].path)[0] == "/api/v1/nodes/kwok-node-0"

    def test_a_cluster_scoped_failure_drops_the_namespace_clause(self) -> None:
        body = _failure("NotFound", 'nodes "kwok-node-0" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_NODES)

        with pytest.raises(ValueError, match=exact("K8s Node 'kwok-node-0' not found")):
            _run(fake, _name_params(kind="Node", name="kwok-node-0"))

    def test_a_grouped_kind_rides_its_own_path_root(self) -> None:
        fake = _named_client(
            _accepted("web", "deployments"),
            _gone("web", "deployments"),
            resources=_DEPLOYMENTS,
        )

        _run(fake, _name_params(kind="Deployment", name="web"))

        assert _split(fake.calls[0].path)[0] == "/apis/apps/v1/namespaces/apps/deployments/web"


class TestSelectorModeRequest:
    """delete_by=selector removes every object the label selector matches."""

    def test_exactly_one_delete_targets_the_collection(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        _run(fake, _selector_params(wait_until_gone=False))

        assert [call.method for call in fake.calls] == ["DELETE"]
        assert _split(fake.calls[0].path)[0] == _CONFIGMAP_PATH

    def test_the_label_selector_rides_the_query_stripped(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        _run(fake, _selector_params(label_selector="  app=web  "))

        assert _split(fake.calls[0].path)[1]["labelSelector"] == ["app=web"]

    def test_a_name_left_behind_never_reaches_a_selector_delete(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        _run(fake, _selector_params(name="probe-z"))

        assert _split(fake.calls[0].path)[0] == _CONFIGMAP_PATH

    def test_the_selector_delete_carries_the_same_cascade_and_grace_keys(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        _run(fake, _selector_params(cascade="orphan", grace_period_seconds=5))

        assert _split(fake.calls[0].path)[1] == {
            "propagationPolicy": ["Orphan"],
            "gracePeriodSeconds": ["5"],
            "labelSelector": ["app=web"],
        }


class TestCascade:
    """The three propagation policies, spelled the way the API spells them."""

    @pytest.mark.parametrize(
        ("cascade", "policy"),
        [("background", "Background"), ("foreground", "Foreground"), ("orphan", "Orphan")],
    )
    def test_a_named_delete_sends_the_propagation_policy(self, cascade: str, policy: str) -> None:
        fake = _named_client()

        _run(fake, _name_params(cascade=cascade))

        assert _split(fake.calls[0].path)[1]["propagationPolicy"] == [policy]

    @pytest.mark.parametrize(
        ("cascade", "policy"),
        [("background", "Background"), ("foreground", "Foreground"), ("orphan", "Orphan")],
    )
    def test_a_selector_delete_sends_the_propagation_policy(
        self, cascade: str, policy: str
    ) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        _run(fake, _selector_params(cascade=cascade))

        assert _split(fake.calls[0].path)[1]["propagationPolicy"] == [policy]

    def test_an_absent_cascade_sends_background(self) -> None:
        fake = _named_client()

        _run(fake, _name_params())

        assert _split(fake.calls[0].path)[1]["propagationPolicy"] == ["Background"]


class TestGracePeriod:
    """The gracePeriodSeconds query key, present only when the row carries a number."""

    def test_an_absent_grace_period_sends_no_query_key(self) -> None:
        fake = _named_client()

        _run(fake, _name_params())

        assert "gracePeriodSeconds" not in _split(fake.calls[0].path)[1]

    def test_a_grace_period_reaches_the_query(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(grace_period_seconds=30))

        assert _split(fake.calls[0].path)[1]["gracePeriodSeconds"] == ["30"]

    def test_a_zero_grace_period_is_sent_and_not_dropped(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(grace_period_seconds=0))

        assert _split(fake.calls[0].path)[1]["gracePeriodSeconds"] == ["0"]

    def test_the_named_query_is_the_cascade_and_the_grace_period_and_nothing_else(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(cascade="foreground", grace_period_seconds=15))

        assert _split(fake.calls[0].path)[1] == {
            "propagationPolicy": ["Foreground"],
            "gracePeriodSeconds": ["15"],
        }


class TestMissingTarget:
    """kubectl's own answers on a target that is not there."""

    def test_a_missing_name_fails_the_block_by_default(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            _run(fake, _name_params())

    def test_a_missing_name_fails_with_ignore_not_found_unticked(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            _run(fake, _name_params(ignore_not_found=False))

    def test_a_missing_name_is_recordable(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == _NOT_FOUND_MESSAGE
        assert outputs["reason"] == "NotFound"

    def test_ignore_not_found_turns_the_missing_name_into_a_pass(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        outputs = _outputs(fake, _name_params(ignore_not_found=True))

        assert outputs["success"] is True
        assert outputs["count"] == 0
        assert outputs["names"] == []
        assert _rows(outputs) == []

    def test_a_swallowed_missing_name_records_no_failure_and_logs_no_warning(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)
        log = RecordingLog()

        outputs = _outputs(fake, _name_params(ignore_not_found=True), log=log)

        assert outputs["error"] == ""
        assert outputs["reason"] == ""
        assert "__block_warning" not in outputs
        assert [level for level, _message in log.entries] == ["INFO"]

    def test_a_swallowed_missing_name_never_polls(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        _run(fake, _name_params(ignore_not_found=True))

        assert len(fake.calls) == 1

    @pytest.mark.parametrize("ignore_not_found", [True, False])
    def test_a_selector_that_matches_nothing_passes(self, ignore_not_found: bool) -> None:
        fake = FakeK8sClient(responses=[_collection()], resources=_CONFIGMAPS)

        outputs = _outputs(fake, _selector_params(ignore_not_found=ignore_not_found))

        assert outputs["success"] is True
        assert outputs["count"] == 0
        assert outputs["names"] == []

    def test_a_selector_that_matches_nothing_never_polls(self) -> None:
        fake = FakeK8sClient(responses=[_collection()], resources=_CONFIGMAPS)

        _run(fake, _selector_params())

        assert len(fake.calls) == 1

    def test_ignore_not_found_does_not_swallow_a_selector_refusal(self) -> None:
        body = _failure("NotFound", 'configmaps "probe-a" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_CONFIGMAPS)
        message = (
            f"Kubernetes could not delete ConfigMap objects in namespace '{NAMESPACE}': "
            'configmaps "probe-a" not found'
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _selector_params(ignore_not_found=True))

    def test_ignore_not_found_does_not_swallow_a_denied_named_delete(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            _run(fake, _name_params(ignore_not_found=True))


class TestClusterRefusal:
    """The shared error mapper, in Delete's own words."""

    def test_401_renders_the_authentication_row(self) -> None:
        fake = _refusing_client(401, _failure("Unauthorized", "Unauthorized", 401))

        with pytest.raises(
            ValueError, match=exact("Kubernetes API authentication failed: Unauthorized")
        ):
            _run(fake, _name_params())

    def test_401_is_recordable_with_its_reason(self) -> None:
        fake = _refusing_client(401, _failure("Unauthorized", "Unauthorized", 401))

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["error"] == "Kubernetes API authentication failed: Unauthorized"
        assert outputs["reason"] == "Unauthorized"

    def test_403_renders_the_permission_row(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            _run(fake, _name_params())

    def test_403_is_recordable_with_its_reason(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["error"] == _FORBIDDEN_MESSAGE
        assert outputs["reason"] == "Forbidden"

    def test_a_server_error_on_a_named_delete_names_the_object(self) -> None:
        fake = _refusing_client(503, _failure("ServiceUnavailable", _SERVER_DETAIL, 503))

        with pytest.raises(ValueError, match=exact(_SERVER_MESSAGE)):
            _run(fake, _name_params())

    def test_a_server_error_on_a_selector_delete_names_the_kind(self) -> None:
        fake = _refusing_client(503, _failure("ServiceUnavailable", _SERVER_DETAIL, 503))

        with pytest.raises(ValueError, match=exact(_SELECTOR_SERVER_MESSAGE)):
            _run(fake, _selector_params())

    def test_an_error_without_a_message_names_the_http_status(self) -> None:
        fake = _refusing_client(502, {})
        message = (
            f"Kubernetes could not delete ConfigMap 'probe-a' in namespace '{NAMESPACE}' (HTTP 502)"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params())

    def test_a_selector_error_without_a_message_names_the_kind_and_the_status(self) -> None:
        fake = _refusing_client(502, {})
        message = (
            f"Kubernetes could not delete ConfigMap objects in namespace '{NAMESPACE}' (HTTP 502)"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _selector_params())

    def test_a_missing_namespace_renders_the_namespace_row(self) -> None:
        body = _failure("NotFound", 'namespaces "gone" not found', 404)
        body["details"] = {"name": "gone", "kind": "namespaces"}
        fake = FakeK8sClient(responses=[(404, body)], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact("K8s namespace 'gone' not found")):
            _run(fake, _name_params(namespace="gone"))

    def test_a_namespace_row_without_a_name_falls_back_to_the_resolved_namespace(self) -> None:
        body = _failure("NotFound", "namespace not found", 404)
        body["details"] = {"kind": "namespaces"}
        fake = FakeK8sClient(responses=[(404, body)], resources=_CONFIGMAPS)

        with pytest.raises(ValueError, match=exact(f"K8s namespace '{NAMESPACE}' not found")):
            _run(fake, _name_params())

    def test_an_already_exists_answer_renders_the_shared_row(self) -> None:
        fake = _refusing_client(409, _failure("AlreadyExists", "object already exists", 409))
        message = f"K8s ConfigMap 'probe-a' already exists in namespace '{NAMESPACE}'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params())

    def test_a_conflict_answer_renders_the_update_row(self) -> None:
        detail = "the object has been modified; please apply your changes to the latest version"
        fake = _refusing_client(409, _failure("Conflict", detail, 409))
        message = (
            "Kubernetes rejected the update to ConfigMap 'probe-a' "
            f"because it changed on the cluster first: {detail}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params())

    def test_a_rejected_manifest_renders_the_manifest_row(self) -> None:
        detail = (
            "failed to create typed patch object (apps/v1, Kind=Deployment): "
            ".spec.replicas: expected integer"
        )
        fake = _refusing_client(422, _failure("Invalid", detail, 422))
        message = "Kubernetes rejected the manifest: .spec.replicas: expected integer"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params())

    def test_a_refused_delete_issues_no_poll(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        _run(fake, _name_params(on_error="record"))

        assert len(fake.calls) == 1

    def test_a_recorded_refusal_leaves_the_unique_outputs_empty(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["names"] == []
        assert outputs["count"] == 0
        assert _rows(outputs) == []

    def test_a_recorded_refusal_carries_the_warning_signal(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))

        outputs = _outputs(fake, _name_params(on_error="record"))

        assert outputs["__block_warning"] is True


class TestLogging:
    """The exact console lines, in order, through the log callable."""

    def test_a_happy_named_delete_logs_the_count_the_kind_and_the_full_path(self) -> None:
        log = RecordingLog()

        _run(_named_client(), _name_params(), log=log)

        assert log.entries == [
            (
                "INFO",
                "Deleted 1 ConfigMap object(s) from " f"{_NAMED_PATH}?propagationPolicy=Background",
            )
        ]

    def test_a_happy_selector_delete_logs_the_whole_query_string(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a", "probe-b"), _collection()], resources=_CONFIGMAPS
        )
        log = RecordingLog()

        _run(fake, _selector_params(), log=log)

        assert log.entries == [
            (
                "INFO",
                "Deleted 2 ConfigMap object(s) from "
                f"{_CONFIGMAP_PATH}?propagationPolicy=Background&labelSelector=app%3Dweb",
            )
        ]

    def test_a_recorded_refusal_logs_one_delete_shaped_warn_line(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))
        log = RecordingLog()

        _run(fake, _name_params(on_error="record"), log=log)

        assert log.entries == [("WARN", f"Delete failed (Forbidden): {_FORBIDDEN_MESSAGE}")]

    def test_a_recorded_failure_without_a_reason_drops_the_parenthesized_clause(self) -> None:
        fake = _refusing_client(502, {})
        log = RecordingLog()

        _run(fake, _name_params(on_error="record"), log=log)

        assert log.entries == [
            (
                "WARN",
                "Delete failed: Kubernetes could not delete ConfigMap 'probe-a' "
                f"in namespace '{NAMESPACE}' (HTTP 502)",
            )
        ]

    def test_a_recorded_missing_name_logs_the_delete_shaped_warn_line(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)
        log = RecordingLog()

        _run(fake, _name_params(on_error="record"), log=log)

        assert log.entries == [("WARN", f"Delete failed (NotFound): {_NOT_FOUND_MESSAGE}")]

    def test_a_failing_delete_under_fail_mode_logs_nothing(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))
        log = RecordingLog()

        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            _run(fake, _name_params(), log=log)

        assert log.entries == []

    def test_a_happy_delete_logs_no_warning(self) -> None:
        log = RecordingLog()

        _run(_named_client(), _name_params(on_error="record"), log=log)

        assert [level for level, _message in log.entries] == ["INFO"]


class TestWaitUntilGoneNameMode:
    """The default wait polls the object until the cluster answers 404."""

    def test_the_default_wait_polls_until_the_object_answers_404(self) -> None:
        fake = _named_client()

        outputs = _outputs(fake, _name_params())

        assert [call.method for call in fake.calls] == ["DELETE", "GET"]
        assert outputs["success"] is True

    def test_the_poll_reads_the_plain_object_path_with_no_query(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(grace_period_seconds=5))

        assert fake.calls[1].path == _NAMED_PATH

    def test_the_poll_repeats_while_the_object_is_still_there(self) -> None:
        fake = _named_client(_accepted(), _still_there(), _gone())

        outputs = _outputs(fake, _name_params())

        assert [call.method for call in fake.calls] == ["DELETE", "GET", "GET"]
        assert outputs["count"] == 1

    def test_an_unticked_wait_returns_as_soon_as_the_cluster_accepts(self) -> None:
        fake = FakeK8sClient(responses=[_accepted()], resources=_CONFIGMAPS)

        outputs = _outputs(fake, _name_params(wait_until_gone=False))

        assert [call.method for call in fake.calls] == ["DELETE"]
        assert outputs["success"] is True
        assert outputs["count"] == 1
        assert _rows(outputs) == [["configmap/probe-a", "deleted"]]

    @pytest.mark.parametrize("poll", [_still_there(), _refused_poll(), _broken_poll()])
    def test_only_a_404_reads_as_gone_in_name_mode(self, poll: tuple[int, Any]) -> None:
        fake = FakeK8sClient(responses=[_accepted()], resources=_CONFIGMAPS, default=poll)

        with pytest.raises(ValueError, match=exact(_NAME_TIMEOUT_MESSAGE)):
            _run(fake, _name_params(timeout=5))

    def test_the_wait_is_skipped_when_nothing_was_deleted(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)

        _run(fake, _name_params(ignore_not_found=True, wait_until_gone=True))

        assert [call.method for call in fake.calls] == ["DELETE"]


class TestWaitUntilGoneSelectorMode:
    """The selector wait polls the collection until it comes back empty."""

    def test_the_collection_poll_carries_only_the_label_selector(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a"), _collection()], resources=_CONFIGMAPS
        )

        _run(fake, _selector_params(cascade="orphan", grace_period_seconds=5))

        assert _split(fake.calls[1].path) == (_CONFIGMAP_PATH, {"labelSelector": ["app=web"]})

    def test_the_collection_poll_repeats_until_the_items_are_empty(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a", "probe-b"), _collection("probe-b"), _collection()],
            resources=_CONFIGMAPS,
        )

        outputs = _outputs(fake, _selector_params())

        assert [call.method for call in fake.calls] == ["DELETE", "GET", "GET"]
        assert outputs["count"] == 2

    @pytest.mark.parametrize("poll", [_refused_poll(), _broken_poll()])
    def test_a_refused_or_broken_collection_poll_is_not_read_as_gone(
        self, poll: tuple[int, Any]
    ) -> None:
        fake = _selector_poll_client(poll)

        with pytest.raises(ValueError, match=exact(_SELECTOR_TIMEOUT_MESSAGE)):
            _run(fake, _selector_params(timeout=5))

    def test_a_two_hundred_answer_with_no_items_ends_the_wait(self) -> None:
        fake = FakeK8sClient(
            responses=[_collection("probe-a")],
            resources=_CONFIGMAPS,
            default=(200, {"kind": "Status", "apiVersion": "v1", "status": "Success"}),
        )

        outputs = _outputs(fake, _selector_params())

        assert [call.method for call in fake.calls] == ["DELETE", "GET"]
        assert outputs["success"] is True

    def test_a_status_shaped_collection_answer_names_one_empty_object(self) -> None:
        status = (200, {"kind": "Status", "apiVersion": "v1", "status": "Success"})
        fake = FakeK8sClient(responses=[status], resources=_CONFIGMAPS, default=status)

        outputs = _outputs(fake, _selector_params())

        assert outputs["names"] == [""]
        assert outputs["count"] == 1
        assert _rows(outputs) == [["configmap/", "deleted"]]


class TestDeadlineLoop:
    """The wait is a monotonic deadline loop that never sleeps past its own deadline."""

    def test_the_deadline_is_the_clock_at_entry_plus_the_block_timeout(self) -> None:
        clock = _Clock(start=1000.0)
        fake = _never_gone_client()

        with pytest.raises(ValueError, match=exact(_NAME_TIMEOUT_MESSAGE)):
            _run(fake, _name_params(timeout=5), clock=clock)

        assert clock.sleeps == [1.0, 1.0, 1.0, 1.0, 1.0]
        assert [call.method for call in fake.calls].count("GET") == 6

    def test_the_first_poll_happens_even_when_the_deadline_has_passed(self) -> None:
        clock = _Clock(step=100.0)
        fake = _never_gone_client()

        with pytest.raises(ValueError, match=exact(_NAME_TIMEOUT_MESSAGE)):
            _run(fake, _name_params(timeout=5), clock=clock)

        assert [call.method for call in fake.calls] == ["DELETE", "GET"]
        assert clock.sleeps == []

    def test_a_timed_out_named_wait_names_the_object_in_kubectl_form(self) -> None:
        fake = _named_client(_accepted("web", "deployments"), resources=_DEPLOYMENTS)
        fake.default = _still_there("web")
        message = "Timed out after 5 seconds waiting for deployment.apps/web to be deleted"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params(kind="Deployment", name="web", timeout=5))

    def test_a_timed_out_selector_wait_names_the_matching_collection(self) -> None:
        fake = _selector_poll_client(_collection("probe-a"))

        with pytest.raises(ValueError, match=exact(_SELECTOR_TIMEOUT_MESSAGE)):
            _run(fake, _selector_params(timeout=5))

    @pytest.mark.parametrize(
        ("timeout", "rendered"), [(5, "5"), (120, "120"), (None, "30"), (0.05, "0.05")]
    )
    def test_the_message_renders_the_timeout_parameter(
        self, timeout: float | None, rendered: str
    ) -> None:
        fake = _never_gone_client()
        params = _name_params() if timeout is None else _name_params(timeout=timeout)
        message = f"Timed out after {rendered} seconds waiting for configmap/probe-a to be deleted"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, params)

    def test_a_timed_out_wait_reports_nothing_deleted(self) -> None:
        outputs = _outputs(_never_gone_client(), _name_params(timeout=5, on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == _NAME_TIMEOUT_MESSAGE
        assert outputs["reason"] == "Timeout"
        assert outputs["names"] == []
        assert outputs["count"] == 0
        assert _rows(outputs) == []

    def test_a_recorded_timeout_logs_the_delete_shaped_warn_line(self) -> None:
        log = RecordingLog()

        _run(_never_gone_client(), _name_params(timeout=5, on_error="record"), log=log)

        assert log.entries == [("WARN", f"Delete failed (Timeout): {_NAME_TIMEOUT_MESSAGE}")]

    def test_a_poll_that_answers_gone_never_sleeps(self) -> None:
        clock = _Clock()

        _run(_named_client(), _name_params(), clock=clock)

        assert clock.sleeps == []

    def test_one_poll_interval_passes_between_two_polls(self) -> None:
        clock = _Clock()
        fake = _named_client(_accepted(), _still_there(), _gone())

        _run(fake, _name_params(), clock=clock)

        assert clock.sleeps == [1.0]

    def test_the_loop_never_sleeps_past_its_own_deadline(self) -> None:
        clock = _Clock()
        fake = _never_gone_client()

        with pytest.raises(ValueError):
            _run(fake, _name_params(timeout=2.5), clock=clock)

        assert clock.sleeps == [1.0, 1.0, 0.5]

    def test_the_poll_interval_comes_from_the_module_attribute(self) -> None:
        clock = _Clock()
        fake = _never_gone_client()

        with patch(_INTERVAL_TARGET, 0.25), pytest.raises(ValueError):
            _run(fake, _name_params(timeout=1), clock=clock)

        assert clock.sleeps == [0.25, 0.25, 0.25, 0.25]

    def test_the_wait_reads_the_monotonic_clock_off_the_module_attribute(self) -> None:
        clock = _Clock()
        fake = _named_client(_accepted(), _still_there(), _gone())

        _run(fake, _name_params(timeout=30), clock=clock)

        assert clock.reads > 0
        assert clock.now == 1.0


class TestClientConstruction:
    """The REST core is built from the session context and the block's rows."""

    def test_the_client_receives_the_session_context_and_the_timeout(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(timeout=45))
        context, timeout, _ = _construction(fake)

        assert context.server == SERVER
        assert context.namespace == NAMESPACE
        assert context.token == "sa-tok"
        assert timeout == 45

    def test_the_client_timeout_defaults_to_thirty(self) -> None:
        fake = _named_client()

        _run(fake, _name_params())

        assert _construction(fake)[1] == 30

    def test_impersonation_reaches_the_client_as_a_user_and_a_group_list(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(impersonate_user="dev", impersonate_groups="qa, ops"))

        assert _construction(fake)[2] == {
            "impersonate_user": "dev",
            "impersonate_groups": ["qa", "ops"],
        }

    def test_no_impersonation_is_handed_over_when_none_is_configured(self) -> None:
        fake = _named_client()

        _run(fake, _name_params())
        _, _, extra = _construction(fake)

        assert extra["impersonate_user"] is None
        assert extra["impersonate_groups"] is None

    def test_the_same_timeout_bounds_the_client_and_the_wait(self) -> None:
        clock = _Clock()
        fake = _never_gone_client()
        message = "Timed out after 3 seconds waiting for configmap/probe-a to be deleted"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _name_params(timeout=3), clock=clock)

        assert _construction(fake)[1] == 3
        assert clock.sleeps == [1.0, 1.0, 1.0]


class TestParameterDefaults:
    """The verb reads its own defaults; an absent key and the engine's default agree."""

    def test_an_absent_delete_by_reads_as_name_mode(self) -> None:
        fake = _named_client()

        outputs = _outputs(fake, block_params(kind="ConfigMap", name="probe-a"))

        assert _split(fake.calls[0].path)[0] == _NAMED_PATH
        assert outputs["names"] == ["probe-a"]

    def test_an_absent_resource_type_reads_the_kind_row(self) -> None:
        fake = _named_client()

        _run(fake, block_params(kind="ConfigMap", name="probe-a", kind_custom="Widget"))

        assert fake.discoveries == ["ConfigMap"]

    def test_an_absent_wait_until_gone_polls(self) -> None:
        fake = _named_client()

        _run(fake, _name_params())

        assert [call.method for call in fake.calls] == ["DELETE", "GET"]

    def test_an_explicit_wait_until_gone_polls_the_same_way(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(wait_until_gone=True))

        assert [call.method for call in fake.calls] == ["DELETE", "GET"]

    def test_an_absent_on_error_fails_the_block(self) -> None:
        fake = _refusing_client(403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403))
        params = _name_params()

        assert "on_error" not in params
        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            _run(fake, params)

    def test_an_absent_ignore_not_found_reads_as_unticked(self) -> None:
        fake = FakeK8sClient(responses=[_gone()], resources=_CONFIGMAPS)
        params = _name_params()

        assert "ignore_not_found" not in params
        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            _run(fake, params)

    def test_a_stray_all_namespaces_tick_drops_the_namespace_even_in_name_mode(self) -> None:
        fake = _named_client()

        _run(fake, _name_params(all_namespaces=True))

        assert _split(fake.calls[0].path)[0] == "/api/v1/configmaps/probe-a"


class TestAlwaysHardFail:
    """The carve-out: these raise under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_bogus_session_raises_in_both_modes(self, on_error: str) -> None:
        fake = _named_client()

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(fake, _name_params(session="not-a-kubeconfig", on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_an_absent_session_raises_in_both_modes(self, on_error: str) -> None:
        fake = _named_client()
        params = _name_params(on_error=on_error)
        del params["session"]

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(fake, params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_transport_failure_raises_in_both_modes(self, on_error: str) -> None:
        message = (
            f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] Connection refused"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_CONFIGMAPS)

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _name_params(on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_request_timeout_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Kubernetes API request DELETE {_NAMED_PATH} timed out after 30 seconds"
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_CONFIGMAPS)

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _name_params(on_error=on_error))
