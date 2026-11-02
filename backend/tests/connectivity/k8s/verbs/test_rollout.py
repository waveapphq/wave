"""K8s Rollout verb tests (REQ-5.1.1, REQ-3.4.1.5, K8SWRITE-7).

rollout.run is the sync core behind the K8s Rollout block: it restarts a
Deployment, StatefulSet or DaemonSet, reports how its current rollout is going,
or rolls it back to an earlier revision, and hands back the wire envelope whose
'summary' output is a table envelope rather than a live Table. Restart and Undo
write and return without a verdict; Status reads once and never waits.
"""

import inspect
import json
import re
import urllib.parse
from datetime import UTC, datetime
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
from wavecore.connectivity.k8s.verbs import rollout
from wavecore.core.remote_exec.materialize import materialize

RESTART_ANNOTATION = "kubectl.kubernetes.io/restartedAt"
REVISION_ANNOTATION = "deployment.kubernetes.io/revision"
STRATEGIC_MERGE = "application/strategic-merge-patch+json"
HASH_LABEL = "pod-template-hash"

SUMMARY_COLUMNS = [
    {"name": "RESOURCE", "type": "string"},
    {"name": "OUTCOME", "type": "string"},
    {"name": "MESSAGE", "type": "string"},
]
EMPTY_SUMMARY = {"__wave_type": "table", "columns": SUMMARY_COLUMNS, "rows": []}

DEPLOYMENT_TYPE_NAME = "deployment.apps/web"
STATEFULSET_TYPE_NAME = "statefulset.apps/db"
DAEMONSET_TYPE_NAME = "daemonset.apps/agent"

DEPLOYMENT_UID = "web-uid"
STATEFULSET_UID = "db-uid"
DAEMONSET_UID = "agent-uid"
FOREIGN_UID = "other-uid"

DEPLOYMENT_PATH = "/apis/apps/v1/namespaces/apps/deployments/web"
REPLICASETS_PATH = "/apis/apps/v1/namespaces/apps/replicasets"
STATEFULSET_PATH = "/apis/apps/v1/namespaces/apps/statefulsets/db"
DAEMONSET_PATH = "/apis/apps/v1/namespaces/apps/daemonsets/agent"
CONTROLLERREVISIONS_PATH = "/apis/apps/v1/namespaces/apps/controllerrevisions"

# kubectl's own printed sentences, which the MESSAGE column carries verbatim.
DEPLOYMENT_COMPLETE = 'deployment "web" successfully rolled out'
DEPLOYMENT_UPDATING = (
    'Waiting for deployment "web" rollout to finish: 1 out of 3 new replicas have been updated...'
)
DEPLOYMENT_TERMINATING = (
    'Waiting for deployment "web" rollout to finish: 2 old replicas are pending termination...'
)
DEPLOYMENT_AVAILABILITY = (
    'Waiting for deployment "web" rollout to finish: 1 of 3 updated replicas are available...'
)
DEPLOYMENT_UNOBSERVED = "Waiting for deployment spec update to be observed..."
DEPLOYMENT_DEADLINE = 'deployment "web" exceeded its progress deadline'

STATEFULSET_COMPLETE = "partitioned roll out complete: 3 new pods have been updated..."
STATEFULSET_UPDATING = (
    "Waiting for partitioned roll out to finish: 1 out of 3 new pods have been updated..."
)
STATEFULSET_READINESS = "Waiting for 2 pods to be ready..."
STATEFULSET_UNOBSERVED = "Waiting for statefulset spec update to be observed..."

DAEMONSET_COMPLETE = 'daemon set "agent" successfully rolled out'
DAEMONSET_UPDATING = (
    'Waiting for daemon set "agent" rollout to finish: 1 out of 3 new pods have been updated...'
)
DAEMONSET_AVAILABILITY = (
    'Waiting for daemon set "agent" rollout to finish: 1 of 3 updated pods are available...'
)
DAEMONSET_UNOBSERVED = "Waiting for daemon set spec update to be observed..."

SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
PAUSED_MESSAGE = "Deployment 'web' is paused - resume the rollout before restarting it"
ON_DELETE_MESSAGE = (
    "StatefulSet 'db' is on the OnDelete update strategy, which has no rollout to report on"
)
DAEMONSET_ON_DELETE_MESSAGE = (
    "DaemonSet 'agent' is on the OnDelete update strategy, which has no rollout to report on"
)
FORBIDDEN_MESSAGE = "Kubernetes API permission denied: deployments.apps is forbidden"
SERVER_ERROR = "etcd is unavailable"

RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
FIXED_NOW = datetime(2026, 9, 3, 12, 30, 45, 123456, tzinfo=UTC)
FIXED_STAMP = "2026-09-03T12:30:45Z"

_WORKLOADS = {
    "Deployment": resource("Deployment", "deployments", group_version="apps/v1"),
    "StatefulSet": resource("StatefulSet", "statefulsets", group_version="apps/v1"),
    "DaemonSet": resource("DaemonSet", "daemonsets", group_version="apps/v1"),
    "ReplicaSet": resource("ReplicaSet", "replicasets", group_version="apps/v1"),
    "ControllerRevision": resource(
        "ControllerRevision", "controllerrevisions", group_version="apps/v1"
    ),
}

_SELECTOR_LABELS = {"app": "web"}
_PROGRESSING = {
    "type": "Progressing",
    "status": "True",
    "reason": "NewReplicaSetAvailable",
    "message": 'ReplicaSet "web-7c9" has successfully progressed.',
}
_DEADLINE_EXCEEDED = {
    "type": "Progressing",
    "status": "False",
    "reason": "ProgressDeadlineExceeded",
    "message": 'ReplicaSet "web-7c9" has timed out progressing.',
}
_DEADLINE_ON_ANOTHER_CONDITION = {
    "type": "Available",
    "status": "False",
    "reason": "ProgressDeadlineExceeded",
    "message": "Not a progress condition.",
}


def _deployment(
    *,
    replicas: int = 3,
    updated: int = 3,
    available: int = 3,
    status_replicas: int = 3,
    generation: int = 2,
    observed: int = 2,
    revision: str = "3",
    paused: bool = False,
    strategy: str = "RollingUpdate",
    conditions: list[dict[str, Any]] | None = None,
    labels: dict[str, str] | None = None,
    selector: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A Deployment as the API serves it, settled by default."""
    pod_labels = dict(labels or _SELECTOR_LABELS)
    spec: dict[str, Any] = {
        "replicas": replicas,
        "selector": {"matchLabels": dict(pod_labels)} if selector is None else selector,
        "strategy": {"type": strategy},
        "template": {
            "metadata": {"labels": dict(pod_labels)},
            "spec": {"containers": [{"name": "app", "image": "nginx:1.27"}]},
        },
    }
    if paused:
        spec["paused"] = True
    return {
        "kind": "Deployment",
        "apiVersion": "apps/v1",
        "metadata": {
            "name": "web",
            "namespace": NAMESPACE,
            "uid": DEPLOYMENT_UID,
            "generation": generation,
            "annotations": {REVISION_ANNOTATION: revision},
        },
        "spec": spec,
        "status": {
            "observedGeneration": observed,
            "replicas": status_replicas,
            "updatedReplicas": updated,
            "readyReplicas": available,
            "availableReplicas": available,
            "conditions": list(conditions or [_PROGRESSING]),
        },
    }


def _stateful_set(
    *,
    replicas: int = 3,
    ready: int = 3,
    updated: int = 3,
    partition: int | None = 0,
    generation: int = 2,
    observed: int = 2,
    strategy: str = "RollingUpdate",
) -> dict[str, Any]:
    """A StatefulSet as the API serves it, settled by default."""
    update_strategy: dict[str, Any] = {"type": strategy}
    if partition is not None:
        update_strategy["rollingUpdate"] = {"partition": partition}
    return {
        "kind": "StatefulSet",
        "apiVersion": "apps/v1",
        "metadata": {
            "name": "db",
            "namespace": NAMESPACE,
            "uid": STATEFULSET_UID,
            "generation": generation,
        },
        "spec": {
            "replicas": replicas,
            "selector": {"matchLabels": {"app": "db"}},
            "updateStrategy": update_strategy,
            "template": {
                "metadata": {"labels": {"app": "db"}},
                "spec": {"containers": [{"name": "app", "image": "postgres:17"}]},
            },
        },
        "status": {
            "observedGeneration": observed,
            "replicas": replicas,
            "readyReplicas": ready,
            "updatedReplicas": updated,
            "currentRevision": "db-7",
            "updateRevision": "db-7",
        },
    }


def _daemon_set(
    *,
    desired: int = 3,
    updated: int = 3,
    available: int = 3,
    generation: int = 2,
    observed: int = 2,
    strategy: str = "RollingUpdate",
) -> dict[str, Any]:
    """A DaemonSet as the API serves it, settled by default."""
    return {
        "kind": "DaemonSet",
        "apiVersion": "apps/v1",
        "metadata": {
            "name": "agent",
            "namespace": NAMESPACE,
            "uid": DAEMONSET_UID,
            "generation": generation,
        },
        "spec": {
            "selector": {"matchLabels": {"app": "agent"}},
            "updateStrategy": {"type": strategy},
            "template": {
                "metadata": {"labels": {"app": "agent"}},
                "spec": {"containers": [{"name": "app", "image": "fluentbit:3.1"}]},
            },
        },
        "status": {
            "observedGeneration": observed,
            "desiredNumberScheduled": desired,
            "updatedNumberScheduled": updated,
            "numberAvailable": available,
        },
    }


def _owner_reference(kind: str, name: str, uid: str) -> dict[str, Any]:
    """The controller reference a workload stamps on every revision it owns."""
    return {
        "apiVersion": "apps/v1",
        "kind": kind,
        "name": name,
        "uid": uid,
        "controller": True,
    }


def _replica_set(
    revision: str, image: str, suffix: str, owner_uid: str = DEPLOYMENT_UID
) -> dict[str, Any]:
    """A Deployment-owned ReplicaSet carrying one revision of the pod template."""
    labels = {"app": "web", HASH_LABEL: suffix}
    return {
        "kind": "ReplicaSet",
        "apiVersion": "apps/v1",
        "metadata": {
            "name": f"web-{suffix}",
            "namespace": NAMESPACE,
            "annotations": {REVISION_ANNOTATION: revision},
            "ownerReferences": [_owner_reference("Deployment", "web", owner_uid)],
        },
        "spec": {
            "selector": {"matchLabels": dict(labels)},
            "template": {
                "metadata": {"labels": dict(labels)},
                "spec": {"containers": [{"name": "app", "image": image}]},
            },
        },
    }


def _restored_template(image: str) -> dict[str, Any]:
    """The ReplicaSet's pod template as it goes back onto the workload: no hash label."""
    return {
        "metadata": {"labels": {"app": "web"}},
        "spec": {"containers": [{"name": "app", "image": image}]},
    }


_CONTROLLER_OWNERS = {
    "db": ("StatefulSet", STATEFULSET_UID),
    "agent": ("DaemonSet", DAEMONSET_UID),
}


def _controller_revision(
    revision: int, image: str, owner: str = "db", owner_uid: str | None = None
) -> dict[str, Any]:
    """A ControllerRevision carrying one revision of a StatefulSet or DaemonSet template."""
    owner_kind, owned_by = _CONTROLLER_OWNERS[owner]
    return {
        "kind": "ControllerRevision",
        "apiVersion": "apps/v1",
        "metadata": {
            "name": f"{owner}-{revision}",
            "namespace": NAMESPACE,
            "labels": {"app": owner},
            "ownerReferences": [_owner_reference(owner_kind, owner, owner_uid or owned_by)],
        },
        "revision": revision,
        "data": {
            "spec": {
                "template": {
                    "metadata": {"labels": {"app": owner}},
                    "spec": {"containers": [{"name": "app", "image": image}]},
                }
            }
        },
    }


def _listed(kind: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "kind": f"{kind}List",
        "apiVersion": "apps/v1",
        "metadata": {"resourceVersion": "42"},
        "items": items,
    }


def _replica_sets() -> dict[str, Any]:
    """Three Deployment-owned revisions, 1 through 3, freshly built for one test."""
    return _listed(
        "ReplicaSet",
        [
            _replica_set("1", "nginx:1.25", "5f4"),
            _replica_set("2", "nginx:1.26", "6b8"),
            _replica_set("3", "nginx:1.27", "7c9"),
        ],
    )


def _controller_revisions() -> dict[str, Any]:
    """Three StatefulSet-owned revisions, 5 through 7, freshly built for one test."""
    return _listed(
        "ControllerRevision",
        [
            _controller_revision(5, "postgres:15"),
            _controller_revision(6, "postgres:16"),
            _controller_revision(7, "postgres:17"),
        ],
    )


def _params(**overrides: Any) -> dict[str, Any]:
    """The Deployment the tests roll, plus the test's own parameters."""
    params: dict[str, Any] = {"kind": "Deployment", "name": "web"}
    params.update(overrides)
    return block_params(**params)


def _run(fake: FakeK8sClient, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    with patch_verb_client("rollout", fake):
        envelope: dict[str, Any] = rollout.run(params, log if log is not None else RecordingLog())
    return envelope


def _outputs(fake: FakeK8sClient, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    outputs: dict[str, Any] = _run(fake, params, log)["outputs"]
    return outputs


def _rows(outputs: dict[str, Any]) -> list[list[Any]]:
    """Every row of the Summary envelope, as plain lists."""
    rows: list[list[Any]] = outputs["summary"]["rows"]
    return rows


def _stamp(fake: FakeK8sClient) -> str:
    annotations = fake.last.body["spec"]["template"]["metadata"]["annotations"]
    stamp: str = annotations[RESTART_ANNOTATION]
    return stamp


def _split(path: str) -> tuple[str, dict[str, list[str]]]:
    base, _, query = path.partition("?")
    return base, urllib.parse.parse_qs(query)


def _failure(reason: str, message: str, code: int) -> dict[str, Any]:
    return {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
    }


def _writes(fake: FakeK8sClient) -> list[str]:
    """Every request that was not a read."""
    return [call.method for call in fake.calls if call.method != "GET"]


def _restart_client(**overrides: Any) -> FakeK8sClient:
    """A cluster that answers the restart's guard read and then the patch."""
    return FakeK8sClient(
        responses=[(200, _deployment(**overrides)), (200, _deployment(**overrides))],
        resources=_WORKLOADS,
    )


def _undo_client(workload: dict[str, Any], revisions: dict[str, Any]) -> FakeK8sClient:
    """A cluster that answers the undo's workload read, its revision list, and the patch."""
    return FakeK8sClient(
        responses=[(200, workload), (200, revisions), (200, workload)],
        resources=_WORKLOADS,
    )


def _status_client(obj: dict[str, Any]) -> FakeK8sClient:
    """A cluster that answers one read and nothing else."""
    return FakeK8sClient(responses=[(200, obj)], resources=_WORKLOADS)


def _client_for(operation: str) -> FakeK8sClient:
    """A cluster scripted for exactly the call sequence one operation makes."""
    if operation == "undo":
        return _undo_client(_deployment(), _replica_sets())
    if operation == "status":
        return _status_client(_deployment())
    return _restart_client()


def _refusing_client(status: int, body: dict[str, Any]) -> FakeK8sClient:
    """A cluster that refuses the block's very first request."""
    return FakeK8sClient(responses=[(status, body)], resources=_WORKLOADS)


def _forbidden_client() -> FakeK8sClient:
    return _refusing_client(403, _failure("Forbidden", "deployments.apps is forbidden", 403))


class TestVerbShape:
    """run is a plain sync function returning the JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(rollout.run) is False

    def test_run_is_a_plain_module_level_function(self) -> None:
        assert inspect.isfunction(rollout.run) is True

    def test_run_takes_the_parameters_and_the_log_callable(self) -> None:
        assert list(inspect.signature(rollout.run).parameters) == ["params", "log"]

    def test_the_module_names_the_utc_zone_the_floor_interpreter_carries(self) -> None:
        assert rollout.timezone.utc is UTC
        assert not hasattr(rollout, "UTC")

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(_restart_client(), _params(operation="restart"))

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_a_happy_run_carries_an_empty_secrets_list(self, operation: str) -> None:
        envelope = _run(_client_for(operation), _params(operation=operation))

        assert envelope["secrets"] == []

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_a_recorded_failure_carries_an_empty_secrets_list(self, operation: str) -> None:
        envelope = _run(_forbidden_client(), _params(operation=operation, on_error="record"))

        assert envelope["secrets"] == []

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_the_envelope_survives_a_json_round_trip_unchanged(self, operation: str) -> None:
        envelope = _run(_client_for(operation), _params(operation=operation))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_failure_envelope_survives_a_json_round_trip(self) -> None:
        envelope = _run(_forbidden_client(), _params(operation="status", on_error="record"))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_the_summary_materializes_back_into_a_table(self) -> None:
        envelope = _run(_restart_client(), _params(operation="restart"))

        table = materialize(envelope)["summary"]

        assert table.col_names() == ["RESOURCE", "OUTCOME", "MESSAGE"]
        assert table.col_types() == ["string", "string", "string"]
        assert table[0].to_list() == [
            DEPLOYMENT_TYPE_NAME,
            "restarted",
            f"{DEPLOYMENT_TYPE_NAME} restarted",
        ]


class TestOutputShape:
    """Each operation declares its own outputs, and only Status carries a verdict."""

    def test_restart_returns_exactly_the_outputs_its_mode_declares(self) -> None:
        outputs = _outputs(_restart_client(), _params(operation="restart"))

        assert set(outputs) == {"summary", "success", "error", "reason"}

    def test_status_returns_exactly_the_outputs_its_mode_declares(self) -> None:
        outputs = _outputs(_status_client(_deployment()), _params(operation="status"))

        assert set(outputs) == {"summary", "status", "success", "error", "reason"}

    def test_undo_returns_exactly_the_outputs_its_mode_declares(self) -> None:
        outputs = _outputs(_undo_client(_deployment(), _replica_sets()), _params(operation="undo"))

        assert set(outputs) == {"summary", "success", "error", "reason"}

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_a_happy_run_carries_the_full_output_core(self, operation: str) -> None:
        outputs = _outputs(_client_for(operation), _params(operation=operation))

        assert outputs["success"] is True
        assert outputs["error"] == ""
        assert outputs["reason"] == ""

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_the_summary_is_a_table_envelope_and_not_a_live_table(self, operation: str) -> None:
        outputs = _outputs(_client_for(operation), _params(operation=operation))

        assert isinstance(outputs["summary"], dict)
        assert outputs["summary"]["__wave_type"] == "table"

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_the_summary_carries_the_three_typed_columns(self, operation: str) -> None:
        outputs = _outputs(_client_for(operation), _params(operation=operation))

        assert outputs["summary"]["columns"] == SUMMARY_COLUMNS

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_a_happy_run_summarizes_the_one_workload_it_rolled(self, operation: str) -> None:
        outputs = _outputs(_client_for(operation), _params(operation=operation))

        assert len(_rows(outputs)) == 1

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_a_happy_run_asks_for_no_amber_block_status(self, operation: str) -> None:
        outputs = _outputs(_client_for(operation), _params(operation=operation))

        assert "__block_warning" not in outputs


class TestClientConstruction:
    """One client, built from the session with the timeout and the impersonation keywords."""

    def test_the_client_receives_the_session_context_and_the_timeout(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart", timeout=45))

        assert fake.factory.call_args.args[0].server == SERVER
        assert fake.factory.call_args.args[1] == 45

    def test_the_client_timeout_defaults_to_thirty(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        assert fake.factory.call_args.args[1] == 30

    def test_the_client_is_constructed_exactly_once(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert fake.factory.call_count == 1

    def test_impersonation_reaches_the_client_as_a_user_and_a_group_list(self) -> None:
        fake = _restart_client()

        _run(
            fake, _params(operation="restart", impersonate_user="dev", impersonate_groups="qa, ops")
        )

        assert fake.factory.call_args.kwargs["impersonate_user"] == "dev"
        assert fake.factory.call_args.kwargs["impersonate_groups"] == ["qa", "ops"]

    def test_no_impersonation_is_handed_over_when_none_is_configured(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        assert fake.factory.call_args.kwargs["impersonate_user"] is None
        assert fake.factory.call_args.kwargs["impersonate_groups"] is None


class TestTargeting:
    """The kind is discovered live and the workload path is built from it."""

    def test_the_workload_kind_is_discovered_once(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        assert fake.discoveries == ["Deployment"]

    def test_status_discovers_the_workload_kind_once(self) -> None:
        fake = _status_client(_deployment())

        _run(fake, _params(operation="status"))

        assert fake.discoveries == ["Deployment"]

    def test_the_kind_is_stripped_before_discovery(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart", kind=" Deployment "))

        assert fake.discoveries == ["Deployment"]

    def test_the_name_is_stripped_before_it_reaches_the_path(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart", name="  web  "))

        assert fake.last.path == DEPLOYMENT_PATH

    def test_a_given_namespace_wins_over_the_session_default(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart", namespace="staging"))

        assert fake.last.path == "/apis/apps/v1/namespaces/staging/deployments/web"

    def test_the_session_namespace_is_used_when_none_is_given(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        assert fake.last.path == DEPLOYMENT_PATH

    def test_the_namespace_reaches_the_wire_percent_encoded(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart", namespace="ops team"))

        assert fake.last.path == "/apis/apps/v1/namespaces/ops%20team/deployments/web"


class TestRestart:
    """Restart reads the workload for the guard, then stamps its pod template."""

    def test_restart_is_the_default_operation(self) -> None:
        fake = _restart_client()

        outputs = _outputs(fake, _params())

        assert fake.last.method == "PATCH"
        assert _rows(outputs)[0][1] == "restarted"

    def test_the_workload_is_read_then_patched(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        assert [(call.method, call.path) for call in fake.calls] == [
            ("GET", DEPLOYMENT_PATH),
            ("PATCH", DEPLOYMENT_PATH),
        ]
        assert len(fake.calls) == 2

    def test_the_guard_read_carries_no_body_and_no_content_type(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        assert fake.calls[0].body is None
        assert fake.calls[0].content_type is None

    def test_the_patch_carries_the_strategic_merge_media_type(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        assert fake.last.content_type == STRATEGIC_MERGE

    def test_the_body_stamps_only_the_restarted_at_annotation(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        annotations = fake.last.body["spec"]["template"]["metadata"]["annotations"]
        assert list(annotations) == [RESTART_ANNOTATION]
        assert fake.last.body == {
            "spec": {"template": {"metadata": {"annotations": dict(annotations)}}}
        }

    def test_the_stamp_carries_seconds_and_a_literal_zulu(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        assert RFC3339.match(_stamp(fake))

    def test_the_stamp_is_the_utc_clock_reading(self) -> None:
        fake = _restart_client()

        with patch.object(rollout, "datetime") as clock:
            clock.now.return_value = FIXED_NOW
            _run(fake, _params(operation="restart"))

        assert _stamp(fake) == FIXED_STAMP
        assert clock.now.call_args.args == (UTC,)

    def test_the_stamp_is_the_moment_the_restart_ran(self) -> None:
        fake = _restart_client()

        _run(fake, _params(operation="restart"))

        stamped = datetime.fromisoformat(_stamp(fake).replace("Z", "+00:00"))
        assert abs((datetime.now(UTC) - stamped).total_seconds()) < 60

    def test_the_summary_row_reads_as_kubectl_prints_it(self) -> None:
        fake = _restart_client()

        outputs = _outputs(fake, _params(operation="restart"))

        assert _rows(outputs) == [
            [DEPLOYMENT_TYPE_NAME, "restarted", f"{DEPLOYMENT_TYPE_NAME} restarted"]
        ]

    def test_a_statefulset_restart_targets_the_statefulset(self) -> None:
        obj = _stateful_set()
        fake = FakeK8sClient(responses=[(200, obj), (200, obj)], resources=_WORKLOADS)

        outputs = _outputs(fake, _params(operation="restart", kind="StatefulSet", name="db"))

        assert fake.last.method == "PATCH"
        assert fake.last.path == STATEFULSET_PATH
        assert fake.last.content_type == STRATEGIC_MERGE
        assert _rows(outputs) == [
            [STATEFULSET_TYPE_NAME, "restarted", f"{STATEFULSET_TYPE_NAME} restarted"]
        ]

    def test_a_daemonset_restart_targets_the_daemonset(self) -> None:
        obj = _daemon_set()
        fake = FakeK8sClient(responses=[(200, obj), (200, obj)], resources=_WORKLOADS)

        outputs = _outputs(fake, _params(operation="restart", kind="DaemonSet", name="agent"))

        assert fake.last.path == DAEMONSET_PATH
        assert _rows(outputs) == [
            [DAEMONSET_TYPE_NAME, "restarted", f"{DAEMONSET_TYPE_NAME} restarted"]
        ]

    def test_an_on_delete_statefulset_still_restarts(self) -> None:
        obj = _stateful_set(strategy="OnDelete", partition=None)
        fake = FakeK8sClient(responses=[(200, obj), (200, obj)], resources=_WORKLOADS)

        outputs = _outputs(fake, _params(operation="restart", kind="StatefulSet", name="db"))

        assert outputs["success"] is True
        assert fake.last.method == "PATCH"

    def test_restart_logs_one_info_line_naming_the_operation(self) -> None:
        fake = _restart_client()
        log = RecordingLog()

        _run(fake, _params(operation="restart"), log)

        assert log.entries == [("INFO", f"Rollout restart on {DEPLOYMENT_TYPE_NAME}")]


class TestRestartPausedGuard:
    """A paused workload has no rollout to restart, and WAVE says so itself."""

    def test_a_paused_deployment_refuses_a_restart(self) -> None:
        fake = _status_client(_deployment(paused=True))

        with pytest.raises(ValueError, match=exact(PAUSED_MESSAGE)):
            _run(fake, _params(operation="restart"))

    def test_a_paused_deployment_is_never_patched(self) -> None:
        fake = _status_client(_deployment(paused=True))

        with pytest.raises(ValueError):
            _run(fake, _params(operation="restart"))

        assert _writes(fake) == []
        assert len(fake.calls) == 1

    def test_a_paused_deployment_restart_is_recordable(self) -> None:
        fake = _status_client(_deployment(paused=True))

        outputs = _outputs(fake, _params(operation="restart", on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == PAUSED_MESSAGE
        assert outputs["reason"] == ""
        assert _writes(fake) == []

    def test_a_wave_refusal_logs_a_warn_line_with_no_reason_in_it(self) -> None:
        fake = _status_client(_deployment(paused=True))
        log = RecordingLog()

        _run(fake, _params(operation="restart", on_error="record"), log)

        assert log.entries == [("WARN", f"Rollout failed: {PAUSED_MESSAGE}")]

    def test_a_deployment_whose_paused_flag_is_false_restarts(self) -> None:
        obj = _deployment()
        obj["spec"]["paused"] = False
        fake = FakeK8sClient(responses=[(200, obj), (200, obj)], resources=_WORKLOADS)

        outputs = _outputs(fake, _params(operation="restart"))

        assert outputs["success"] is True
        assert _writes(fake) == ["PATCH"]

    def test_a_deployment_carrying_no_paused_flag_restarts(self) -> None:
        fake = _restart_client()

        outputs = _outputs(fake, _params(operation="restart"))

        assert outputs["success"] is True
        assert _writes(fake) == ["PATCH"]


class TestStatus:
    """Status reads once, reports a verdict, and never waits."""

    def test_status_issues_exactly_one_read(self) -> None:
        fake = _status_client(_deployment())

        _run(fake, _params(operation="status"))

        assert [(call.method, call.path) for call in fake.calls] == [("GET", DEPLOYMENT_PATH)]
        assert fake.calls[0].body is None
        assert len(fake.calls) == 1

    def test_status_never_writes(self) -> None:
        fake = _status_client(_deployment())

        _run(fake, _params(operation="status"))

        assert _writes(fake) == []

    def test_status_never_sleeps_between_reads(self) -> None:
        fake = _status_client(_deployment())

        with patch("time.sleep") as sleeper:
            outputs = _outputs(fake, _params(operation="status"))

        assert sleeper.call_count == 0
        assert len(fake.calls) == 1
        assert outputs["status"] == "complete"

    def test_the_verdict_output_repeats_the_outcome_cell(self) -> None:
        fake = _status_client(_deployment(updated=1, available=1))

        outputs = _outputs(fake, _params(operation="status"))

        assert outputs["status"] == _rows(outputs)[0][1] == "progressing"

    def test_status_logs_one_info_line_naming_the_operation(self) -> None:
        fake = _status_client(_deployment())
        log = RecordingLog()

        _run(fake, _params(operation="status"), log)

        assert log.entries == [("INFO", f"Rollout status on {DEPLOYMENT_TYPE_NAME}")]

    def test_a_paused_deployment_still_reports_its_status(self) -> None:
        fake = _status_client(_deployment(paused=True))

        outputs = _outputs(fake, _params(operation="status"))

        assert outputs["status"] == "complete"


def _verdict(obj: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """The Status outputs for one workload object."""
    return _outputs(_status_client(obj), _params(operation="status", **overrides))


class TestDeploymentVerdict:
    """kubectl's DeploymentStatusViewer, verdict and printed sentence alike."""

    def test_a_settled_deployment_is_complete(self) -> None:
        outputs = _verdict(_deployment())

        assert outputs["status"] == "complete"
        assert _rows(outputs) == [[DEPLOYMENT_TYPE_NAME, "complete", DEPLOYMENT_COMPLETE]]

    def test_an_unobserved_spec_change_is_progressing(self) -> None:
        outputs = _verdict(_deployment(generation=3, observed=2))

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DEPLOYMENT_UNOBSERVED

    def test_a_missed_progress_deadline_is_failed(self) -> None:
        outputs = _verdict(_deployment(conditions=[_DEADLINE_EXCEEDED]))

        assert outputs["status"] == "failed"
        assert _rows(outputs) == [[DEPLOYMENT_TYPE_NAME, "failed", DEPLOYMENT_DEADLINE]]

    def test_replicas_still_to_be_updated_is_progressing(self) -> None:
        outputs = _verdict(_deployment(updated=1, available=1, status_replicas=3))

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DEPLOYMENT_UPDATING

    def test_old_replicas_pending_termination_is_progressing(self) -> None:
        outputs = _verdict(_deployment(updated=3, status_replicas=5))

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DEPLOYMENT_TERMINATING

    def test_updated_replicas_not_yet_available_is_progressing(self) -> None:
        outputs = _verdict(_deployment(updated=3, available=1, status_replicas=3))

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DEPLOYMENT_AVAILABILITY

    def test_an_unobserved_spec_change_outranks_a_missed_deadline(self) -> None:
        outputs = _verdict(_deployment(generation=3, observed=2, conditions=[_DEADLINE_EXCEEDED]))

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DEPLOYMENT_UNOBSERVED

    def test_a_missed_deadline_outranks_the_replica_arithmetic(self) -> None:
        outputs = _verdict(_deployment(updated=1, available=1, conditions=[_DEADLINE_EXCEEDED]))

        assert outputs["status"] == "failed"
        assert _rows(outputs)[0][2] == DEPLOYMENT_DEADLINE

    def test_a_deadline_reason_on_another_condition_is_not_a_timeout(self) -> None:
        outputs = _verdict(
            _deployment(updated=1, available=1, conditions=[_DEADLINE_ON_ANOTHER_CONDITION])
        )

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DEPLOYMENT_UPDATING

    def test_a_progressing_condition_with_another_reason_is_not_a_timeout(self) -> None:
        outputs = _verdict(_deployment(updated=1, available=1, conditions=[_PROGRESSING]))

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DEPLOYMENT_UPDATING

    def test_a_status_with_no_conditions_at_all_is_not_a_timeout(self) -> None:
        obj = _deployment()
        obj["status"].pop("conditions")

        outputs = _verdict(obj)

        assert outputs["status"] == "complete"
        assert _rows(outputs)[0][2] == DEPLOYMENT_COMPLETE

    def test_missing_counters_read_as_zero_and_settle_the_rollout(self) -> None:
        bare = {"kind": "Deployment", "apiVersion": "apps/v1", "metadata": {"name": "web"}}

        outputs = _verdict(bare)

        assert outputs["status"] == "complete"
        assert _rows(outputs)[0][2] == DEPLOYMENT_COMPLETE


class TestStatefulSetVerdict:
    """kubectl's StatefulSetStatusViewer, which never names the workload."""

    def test_a_settled_statefulset_is_complete(self) -> None:
        outputs = _verdict(_stateful_set(), kind="StatefulSet", name="db")

        assert outputs["status"] == "complete"
        assert _rows(outputs) == [[STATEFULSET_TYPE_NAME, "complete", STATEFULSET_COMPLETE]]

    def test_an_unobserved_spec_change_is_progressing(self) -> None:
        outputs = _verdict(_stateful_set(generation=3, observed=2), kind="StatefulSet", name="db")

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == STATEFULSET_UNOBSERVED

    def test_pods_still_to_become_ready_is_progressing(self) -> None:
        outputs = _verdict(_stateful_set(ready=1), kind="StatefulSet", name="db")

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == STATEFULSET_READINESS

    def test_a_partially_updated_statefulset_is_progressing(self) -> None:
        outputs = _verdict(_stateful_set(updated=1), kind="StatefulSet", name="db")

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == STATEFULSET_UPDATING

    def test_a_partition_covering_every_replica_is_complete(self) -> None:
        outputs = _verdict(_stateful_set(partition=3), kind="StatefulSet", name="db")

        assert outputs["status"] == "complete"
        assert _rows(outputs)[0][2] == STATEFULSET_COMPLETE

    def test_a_statefulset_with_no_rolling_update_map_partitions_at_zero(self) -> None:
        outputs = _verdict(_stateful_set(updated=1, partition=None), kind="StatefulSet", name="db")

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == STATEFULSET_UPDATING

    def test_the_printed_sentence_never_names_the_workload(self) -> None:
        outputs = _verdict(_stateful_set(ready=1), kind="StatefulSet", name="db")
        renamed = _verdict(_stateful_set(ready=1), kind="StatefulSet", name="other")

        assert _rows(outputs)[0][2] == _rows(renamed)[0][2] == STATEFULSET_READINESS


class TestDaemonSetVerdict:
    """kubectl's DaemonSetStatusViewer, which prints 'daemon set' as two words."""

    def test_a_settled_daemonset_is_complete(self) -> None:
        outputs = _verdict(_daemon_set(), kind="DaemonSet", name="agent")

        assert outputs["status"] == "complete"
        assert _rows(outputs) == [[DAEMONSET_TYPE_NAME, "complete", DAEMONSET_COMPLETE]]

    def test_an_unobserved_spec_change_is_progressing(self) -> None:
        outputs = _verdict(_daemon_set(generation=3, observed=2), kind="DaemonSet", name="agent")

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DAEMONSET_UNOBSERVED

    def test_pods_still_to_be_updated_is_progressing(self) -> None:
        outputs = _verdict(_daemon_set(updated=1, available=1), kind="DaemonSet", name="agent")

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DAEMONSET_UPDATING

    def test_updated_pods_not_yet_available_is_progressing(self) -> None:
        outputs = _verdict(_daemon_set(available=1), kind="DaemonSet", name="agent")

        assert outputs["status"] == "progressing"
        assert _rows(outputs)[0][2] == DAEMONSET_AVAILABILITY


class TestReportableGuard:
    """Only a rolling update has a rollout to report on; a Deployment always reports."""

    def test_a_statefulset_off_rolling_update_has_no_status_to_report(self) -> None:
        fake = _status_client(_stateful_set(strategy="OnDelete", partition=None))

        with pytest.raises(ValueError, match=exact(ON_DELETE_MESSAGE)):
            _run(fake, _params(operation="status", kind="StatefulSet", name="db"))

    def test_a_daemonset_off_rolling_update_has_no_status_to_report(self) -> None:
        fake = _status_client(_daemon_set(strategy="OnDelete"))

        with pytest.raises(ValueError, match=exact(DAEMONSET_ON_DELETE_MESSAGE)):
            _run(fake, _params(operation="status", kind="DaemonSet", name="agent"))

    def test_an_update_strategy_refusal_never_writes(self) -> None:
        fake = _status_client(_daemon_set(strategy="OnDelete"))

        with pytest.raises(ValueError):
            _run(fake, _params(operation="status", kind="DaemonSet", name="agent"))

        assert _writes(fake) == []
        assert len(fake.calls) == 1

    def test_an_update_strategy_refusal_is_recordable(self) -> None:
        fake = _status_client(_stateful_set(strategy="OnDelete", partition=None))

        outputs = _outputs(
            fake, _params(operation="status", kind="StatefulSet", name="db", on_error="record")
        )

        assert outputs["success"] is False
        assert outputs["error"] == ON_DELETE_MESSAGE
        assert outputs["reason"] == ""
        assert outputs["status"] == ""

    def test_a_workload_with_no_named_update_strategy_rolls_and_reports(self) -> None:
        obj = _stateful_set()
        obj["spec"]["updateStrategy"].pop("type")
        fake = _status_client(obj)

        outputs = _outputs(fake, _params(operation="status", kind="StatefulSet", name="db"))

        assert outputs["status"] == "complete"

    def test_a_recreate_deployment_still_reports_its_status(self) -> None:
        outputs = _verdict(_deployment(strategy="Recreate"))

        assert outputs["status"] == "complete"


class TestUndo:
    """Undo finds the target revision through the workload's selector and writes it back."""

    def test_the_workload_and_its_revisions_are_read_then_patched(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert [call.method for call in fake.calls] == ["GET", "GET", "PATCH"]
        assert fake.calls[0].path == DEPLOYMENT_PATH
        assert _split(fake.calls[1].path)[0] == REPLICASETS_PATH
        assert fake.calls[2].path == DEPLOYMENT_PATH
        assert len(fake.calls) == 3

    def test_the_history_kind_is_discovered_after_the_workload(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert fake.discoveries == ["Deployment", "ReplicaSet"]

    def test_the_history_listing_names_no_object(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path) == (REPLICASETS_PATH, {"labelSelector": ["app=web"]})

    def test_the_patch_carries_the_strategic_merge_media_type(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert fake.last.method == "PATCH"
        assert fake.last.content_type == STRATEGIC_MERGE

    def test_the_patch_targets_the_workload_and_not_the_revision(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert fake.last.path == DEPLOYMENT_PATH

    def test_the_deployment_body_is_the_revisions_pod_template(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.26")}}

    def test_the_pod_template_hash_label_never_goes_back_onto_the_workload(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo", to_revision=2))

        assert HASH_LABEL not in fake.last.body["spec"]["template"]["metadata"]["labels"]

    def test_the_listed_revision_keeps_its_own_hash_label(self) -> None:
        listing = _replica_sets()
        fake = _undo_client(_deployment(), listing)

        _run(fake, _params(operation="undo", to_revision=2))

        labels = listing["items"][1]["spec"]["template"]["metadata"]["labels"]
        assert labels[HASH_LABEL] == "6b8"

    def test_the_summary_row_reads_as_kubectl_prints_it(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        outputs = _outputs(fake, _params(operation="undo"))

        assert _rows(outputs) == [
            [DEPLOYMENT_TYPE_NAME, "rolled back", f"{DEPLOYMENT_TYPE_NAME} rolled back"]
        ]

    def test_a_statefulset_rolls_back_through_its_controller_revisions(self) -> None:
        fake = _undo_client(_stateful_set(), _controller_revisions())

        outputs = _outputs(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.discoveries == ["StatefulSet", "ControllerRevision"]
        assert _split(fake.calls[1].path) == (
            CONTROLLERREVISIONS_PATH,
            {"labelSelector": ["app=db"]},
        )
        assert fake.last.path == STATEFULSET_PATH
        assert _rows(outputs) == [
            [STATEFULSET_TYPE_NAME, "rolled back", f"{STATEFULSET_TYPE_NAME} rolled back"]
        ]

    def test_a_statefulset_writes_the_revisions_own_data_back(self) -> None:
        fake = _undo_client(_stateful_set(), _controller_revisions())

        _run(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.last.body == _controller_revision(6, "postgres:16")["data"]
        assert fake.last.content_type == STRATEGIC_MERGE

    def test_a_daemonset_rolls_back_through_its_controller_revisions(self) -> None:
        revisions = _listed(
            "ControllerRevision",
            [
                _controller_revision(1, "fluentbit:3.0", owner="agent"),
                _controller_revision(2, "fluentbit:3.1", owner="agent"),
            ],
        )
        fake = _undo_client(_daemon_set(), revisions)

        outputs = _outputs(fake, _params(operation="undo", kind="DaemonSet", name="agent"))

        assert fake.discoveries == ["DaemonSet", "ControllerRevision"]
        assert fake.last.path == DAEMONSET_PATH
        assert fake.last.body == _controller_revision(1, "fluentbit:3.0", owner="agent")["data"]
        assert _rows(outputs) == [
            [DAEMONSET_TYPE_NAME, "rolled back", f"{DAEMONSET_TYPE_NAME} rolled back"]
        ]

    def test_undo_logs_one_info_line_naming_the_operation(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())
        log = RecordingLog()

        _run(fake, _params(operation="undo"), log)

        assert log.entries == [("INFO", f"Rollout undo on {DEPLOYMENT_TYPE_NAME}")]


class TestUndoSelector:
    """Undo lists revision history through the workload's whole label selector."""

    def _selector_sent(self, selector: dict[str, Any]) -> dict[str, list[str]]:
        fake = _undo_client(_deployment(selector=selector), _replica_sets())
        _run(fake, _params(operation="undo"))
        return _split(fake.calls[1].path)[1]

    def test_one_match_label_renders_as_a_pair(self) -> None:
        assert self._selector_sent({"matchLabels": {"app": "web"}}) == {
            "labelSelector": ["app=web"]
        }

    def test_several_match_labels_are_sorted_by_key(self) -> None:
        sent = self._selector_sent({"matchLabels": {"tier": "front", "app": "web"}})

        assert sent == {"labelSelector": ["app=web,tier=front"]}

    def test_an_in_expression_is_sent_in_kubectl_syntax(self) -> None:
        sent = self._selector_sent(
            {
                "matchExpressions": [
                    {"key": "app", "operator": "In", "values": ["web", "web-canary"]}
                ]
            }
        )

        assert sent == {"labelSelector": ["app in (web,web-canary)"]}

    def test_a_notin_expression_is_sent_in_kubectl_syntax(self) -> None:
        sent = self._selector_sent(
            {
                "matchExpressions": [
                    {"key": "tier", "operator": "NotIn", "values": ["batch", "cron"]}
                ]
            }
        )

        assert sent == {"labelSelector": ["tier notin (batch,cron)"]}

    def test_an_exists_expression_is_sent_as_the_bare_key(self) -> None:
        sent = self._selector_sent({"matchExpressions": [{"key": "app", "operator": "Exists"}]})

        assert sent == {"labelSelector": ["app"]}

    def test_a_doesnotexist_expression_is_sent_with_its_bang(self) -> None:
        sent = self._selector_sent(
            {"matchExpressions": [{"key": "legacy", "operator": "DoesNotExist"}]}
        )

        assert sent == {"labelSelector": ["!legacy"]}

    def test_the_values_of_an_expression_are_sorted(self) -> None:
        sent = self._selector_sent(
            {"matchExpressions": [{"key": "app", "operator": "In", "values": ["web", "api"]}]}
        )

        assert sent == {"labelSelector": ["app in (api,web)"]}

    def test_both_selector_halves_are_sent_together_sorted_by_key(self) -> None:
        sent = self._selector_sent(
            {
                "matchLabels": {"app": "web"},
                "matchExpressions": [
                    {"key": "zone", "operator": "Exists"},
                    {"key": "tier", "operator": "In", "values": ["front"]},
                ],
            }
        )

        assert sent == {"labelSelector": ["app=web,tier in (front),zone"]}

    def test_an_operator_the_api_does_not_define_is_left_out(self) -> None:
        sent = self._selector_sent(
            {
                "matchLabels": {"app": "web"},
                "matchExpressions": [{"key": "tier", "operator": "GreaterThan", "values": ["2"]}],
            }
        )

        assert sent == {"labelSelector": ["app=web"]}

    def test_a_workload_with_no_selector_sends_no_query_at_all(self) -> None:
        fake = _undo_client(_deployment(selector={}), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert fake.calls[1].path == REPLICASETS_PATH


class TestUndoRevisionHistory:
    """Only the revisions the workload controls, and only the ones carrying a number."""

    def test_an_empty_to_revision_picks_the_previous_revision(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.26")}}

    def test_the_previous_revision_is_the_highest_one_below_the_highest(self) -> None:
        revisions = _listed(
            "ReplicaSet",
            [_replica_set("1", "nginx:1.25", "5f4"), _replica_set("5", "nginx:1.29", "9d1")],
        )
        fake = _undo_client(_deployment(revision="3"), revisions)

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    def test_an_explicit_to_revision_picks_that_one(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo", to_revision=1))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    def test_a_to_revision_of_zero_falls_through_to_the_previous_revision(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        _run(fake, _params(operation="undo", to_revision=0))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.26")}}

    def test_an_unknown_revision_is_refused_and_never_written(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())
        message = "No revision 7 found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="undo", to_revision=7))

        assert _writes(fake) == []
        assert len(fake.calls) == 2

    def test_an_unknown_revision_is_recordable(self) -> None:
        fake = _undo_client(_deployment(), _replica_sets())

        outputs = _outputs(fake, _params(operation="undo", to_revision=7, on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == "No revision 7 found for Deployment 'web'"
        assert outputs["reason"] == ""

    def test_a_workload_whose_only_revision_is_the_current_one_is_refused(self) -> None:
        only_current = _listed("ReplicaSet", [_replica_set("1", "nginx:1.25", "5f4")])
        fake = _undo_client(_deployment(), only_current)
        message = "No earlier revision found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="undo"))

        assert _writes(fake) == []

    def test_a_namespace_of_only_foreign_revisions_reads_as_no_history(self) -> None:
        revisions = _listed(
            "ReplicaSet", [_replica_set("9", "redis:7", "aa1", owner_uid=FOREIGN_UID)]
        )
        fake = _undo_client(_deployment(), revisions)
        message = "No earlier revision found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="undo"))

        assert _writes(fake) == []

    def test_no_earlier_revision_is_recordable(self) -> None:
        only_current = _listed("ReplicaSet", [_replica_set("1", "nginx:1.25", "5f4")])
        fake = _undo_client(_deployment(), only_current)

        outputs = _outputs(fake, _params(operation="undo", on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == "No earlier revision found for Deployment 'web'"

    def test_a_foreign_revision_matching_the_selector_is_not_history(self) -> None:
        revisions = _listed(
            "ReplicaSet",
            [
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
                _replica_set("9", "redis:7", "aa1", owner_uid=FOREIGN_UID),
            ],
        )
        fake = _undo_client(_deployment(), revisions)

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    def test_a_foreign_revision_cannot_be_rolled_back_to_by_number(self) -> None:
        revisions = _listed(
            "ReplicaSet", [_replica_set("9", "redis:7", "aa1", owner_uid=FOREIGN_UID)]
        )
        fake = _undo_client(_deployment(), revisions)
        message = "No revision 9 found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="undo", to_revision=9))

        assert _writes(fake) == []

    def test_a_revision_owned_but_not_controlled_is_not_history(self) -> None:
        demoted = _replica_set("3", "nginx:1.27", "7c9")
        demoted["metadata"]["ownerReferences"][0]["controller"] = False
        revisions = _listed(
            "ReplicaSet",
            [
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
                demoted,
            ],
        )
        fake = _undo_client(_deployment(), revisions)

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    def test_an_owner_reference_with_no_controller_flag_is_not_history(self) -> None:
        unflagged = _replica_set("3", "nginx:1.27", "7c9")
        unflagged["metadata"]["ownerReferences"][0].pop("controller")
        revisions = _listed(
            "ReplicaSet",
            [
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
                unflagged,
            ],
        )
        fake = _undo_client(_deployment(), revisions)

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    def test_a_revision_with_no_owner_references_at_all_is_not_history(self) -> None:
        adopted = _replica_set("3", "nginx:1.27", "7c9")
        adopted["metadata"].pop("ownerReferences")
        revisions = _listed(
            "ReplicaSet",
            [
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
                adopted,
            ],
        )
        fake = _undo_client(_deployment(), revisions)

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    def test_a_replicaset_numbers_itself_by_its_revision_annotation(self) -> None:
        fielded = _replica_set("3", "nginx:1.27", "7c9")
        fielded["metadata"].pop("annotations")
        fielded["revision"] = 3
        revisions = _listed(
            "ReplicaSet",
            [
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
                fielded,
            ],
        )
        fake = _undo_client(_deployment(), revisions)

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    def test_a_replicaset_whose_revision_annotation_is_not_a_number_is_skipped(self) -> None:
        revisions = _listed(
            "ReplicaSet",
            [
                _replica_set("latest", "nginx:1.20", "3a2"),
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
            ],
        )
        fake = _undo_client(_deployment(), revisions)

        _run(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    def test_a_controller_revision_numbers_itself_by_its_revision_field(self) -> None:
        annotated = _controller_revision(7, "postgres:17")
        annotated.pop("revision")
        annotated["metadata"]["annotations"] = {REVISION_ANNOTATION: "7"}
        revisions = _listed(
            "ControllerRevision",
            [
                _controller_revision(5, "postgres:15"),
                _controller_revision(6, "postgres:16"),
                annotated,
            ],
        )
        fake = _undo_client(_stateful_set(), revisions)

        _run(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.last.body == _controller_revision(5, "postgres:15")["data"]

    def test_a_foreign_controller_revision_is_not_history(self) -> None:
        revisions = _listed(
            "ControllerRevision",
            [
                _controller_revision(5, "postgres:15"),
                _controller_revision(6, "postgres:16"),
                _controller_revision(9, "redis:7", owner_uid=FOREIGN_UID),
            ],
        )
        fake = _undo_client(_stateful_set(), revisions)

        _run(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.last.body == _controller_revision(5, "postgres:15")["data"]

    def test_a_controller_revision_owned_but_not_controlled_is_not_history(self) -> None:
        demoted = _controller_revision(9, "postgres:17")
        demoted["metadata"]["ownerReferences"][0]["controller"] = False
        revisions = _listed(
            "ControllerRevision",
            [
                _controller_revision(5, "postgres:15"),
                _controller_revision(6, "postgres:16"),
                demoted,
            ],
        )
        fake = _undo_client(_stateful_set(), revisions)

        _run(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.last.body == _controller_revision(5, "postgres:15")["data"]


class TestClusterErrors:
    """The cluster's refusal reaches the block under the operation's own verb word."""

    def test_a_restart_failure_names_the_restart(self) -> None:
        body = _failure("InternalError", SERVER_ERROR, 500)
        fake = FakeK8sClient(responses=[(200, _deployment()), (500, body)], resources=_WORKLOADS)
        message = (
            f"Kubernetes could not restart Deployment 'web' in namespace 'apps': {SERVER_ERROR}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="restart"))

    def test_a_status_failure_names_the_read(self) -> None:
        fake = _refusing_client(500, _failure("InternalError", SERVER_ERROR, 500))
        message = f"Kubernetes could not read Deployment 'web' in namespace 'apps': {SERVER_ERROR}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="status"))

    def test_an_undo_failure_names_the_roll_back(self) -> None:
        body = _failure("InternalError", SERVER_ERROR, 500)
        fake = FakeK8sClient(
            responses=[(200, _deployment()), (200, _replica_sets()), (500, body)],
            resources=_WORKLOADS,
        )
        message = (
            f"Kubernetes could not roll back Deployment 'web' in namespace 'apps': {SERVER_ERROR}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="undo"))

    def test_a_failed_history_listing_still_names_the_workload_and_the_roll_back(self) -> None:
        body = _failure("InternalError", SERVER_ERROR, 500)
        fake = FakeK8sClient(responses=[(200, _deployment()), (500, body)], resources=_WORKLOADS)
        message = (
            f"Kubernetes could not roll back Deployment 'web' in namespace 'apps': {SERVER_ERROR}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="undo"))

        assert len(fake.calls) == 2

    def test_a_missing_workload_names_the_workload_and_its_namespace(self) -> None:
        body = _failure("NotFound", 'deployments.apps "web" not found', 404)
        fake = _refusing_client(404, body)
        message = "K8s Deployment 'web' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="status"))

    def test_a_missing_workload_records_the_not_found_reason(self) -> None:
        body = _failure("NotFound", 'deployments.apps "web" not found', 404)
        fake = _refusing_client(404, body)

        outputs = _outputs(fake, _params(operation="status", on_error="record"))

        assert outputs["error"] == "K8s Deployment 'web' not found in namespace 'apps'"
        assert outputs["reason"] == "NotFound"

    def test_a_missing_namespace_is_named_on_its_own(self) -> None:
        body = _failure("NotFound", 'namespaces "apps" not found', 404)
        body["details"] = {"kind": "namespaces", "name": "apps"}
        fake = _refusing_client(404, body)

        with pytest.raises(ValueError, match=exact("K8s namespace 'apps' not found")):
            _run(fake, _params(operation="status"))

    def test_a_rejected_token_reads_as_an_authentication_failure(self) -> None:
        fake = _refusing_client(401, _failure("Unauthorized", "Unauthorized", 401))

        with pytest.raises(
            ValueError, match=exact("Kubernetes API authentication failed: Unauthorized")
        ):
            _run(fake, _params(operation="status"))

    def test_a_permission_denial_is_recordable_with_its_reason(self) -> None:
        outputs = _outputs(_forbidden_client(), _params(operation="restart", on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == FORBIDDEN_MESSAGE
        assert outputs["reason"] == "Forbidden"

    def test_a_workload_that_changed_first_reads_as_a_conflict(self) -> None:
        body = _failure("Conflict", "the object has been modified", 409)
        fake = FakeK8sClient(responses=[(200, _deployment()), (409, body)], resources=_WORKLOADS)
        message = (
            "Kubernetes rejected the update to Deployment 'web' because it changed on the "
            "cluster first: the object has been modified"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="restart"))

    def test_an_error_with_no_message_falls_back_to_the_status_code(self) -> None:
        body = {"kind": "Status", "apiVersion": "v1", "reason": "InternalError", "code": 500}
        fake = FakeK8sClient(responses=[(200, _deployment()), (500, body)], resources=_WORKLOADS)
        message = "Kubernetes could not restart Deployment 'web' in namespace 'apps' (HTTP 500)"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="restart"))

    def test_a_discovery_miss_on_the_workload_kind_names_the_kind(self) -> None:
        fake = FakeK8sClient(resources={})
        message = (
            "This cluster has no resource kind 'Deployment' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="restart"))

        assert fake.calls == []

    def test_a_discovery_miss_records_the_not_found_reason(self) -> None:
        fake = FakeK8sClient(resources={})

        outputs = _outputs(fake, _params(operation="restart", on_error="record"))

        assert outputs["reason"] == "NotFound"

    def test_a_discovery_miss_on_the_history_kind_names_the_history_kind(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _deployment())],
            resources={"Deployment": _WORKLOADS["Deployment"]},
        )
        message = (
            "This cluster has no resource kind 'ReplicaSet' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="undo"))

        assert len(fake.calls) == 1

    def test_a_statefulset_discovery_miss_names_the_controller_revision(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _stateful_set())],
            resources={"StatefulSet": _WORKLOADS["StatefulSet"]},
        )
        message = (
            "This cluster has no resource kind 'ControllerRevision' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="undo", kind="StatefulSet", name="db"))

    def test_a_denied_discovery_walk_reads_as_a_permission_denial(self) -> None:
        fake = DeniedDiscoveryClient(
            403, _failure("Forbidden", "deployments.apps is forbidden", 403)
        )

        with pytest.raises(ValueError, match=exact(FORBIDDEN_MESSAGE)):
            _run(fake, _params(operation="restart"))

        assert fake.calls == []

    def test_a_denied_discovery_walk_with_another_status_reads_as_a_failed_listing(self) -> None:
        fake = DeniedDiscoveryClient(500, _failure("InternalError", SERVER_ERROR, 500))
        message = f"Kubernetes could not list Deployment objects: {SERVER_ERROR}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _params(operation="restart"))


class TestFailureDispatch:
    """Fail raises and binds nothing; Record returns the empties with the failed core."""

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_a_cluster_refusal_raises_out_of_the_verb(self, operation: str) -> None:
        with pytest.raises(ValueError, match=exact(FORBIDDEN_MESSAGE)):
            _run(_forbidden_client(), _params(operation=operation))

    def test_fail_is_the_default_mode(self) -> None:
        with pytest.raises(ValueError, match=exact(FORBIDDEN_MESSAGE)):
            _run(_forbidden_client(), _params())

    def test_a_raised_refusal_writes_no_log_line_at_all(self) -> None:
        log = RecordingLog()

        with pytest.raises(ValueError):
            _run(_forbidden_client(), _params(operation="restart"), log)

        assert log.entries == []

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_record_returns_the_failed_output_core(self, operation: str) -> None:
        outputs = _outputs(_forbidden_client(), _params(operation=operation, on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == FORBIDDEN_MESSAGE
        assert outputs["reason"] == "Forbidden"

    def test_a_recorded_failure_asks_for_the_amber_block_status(self) -> None:
        outputs = _outputs(_forbidden_client(), _params(operation="restart", on_error="record"))

        assert outputs["__block_warning"] is True

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_a_recorded_failure_keeps_the_summary_columns_with_no_rows(
        self, operation: str
    ) -> None:
        outputs = _outputs(_forbidden_client(), _params(operation=operation, on_error="record"))

        assert outputs["summary"] == EMPTY_SUMMARY

    def test_a_recorded_status_failure_carries_an_empty_verdict(self) -> None:
        outputs = _outputs(_forbidden_client(), _params(operation="status", on_error="record"))

        assert outputs["status"] == ""
        assert set(outputs) == {
            "summary",
            "status",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    @pytest.mark.parametrize("operation", ["restart", "undo"])
    def test_a_recorded_failure_outside_status_declares_no_verdict(self, operation: str) -> None:
        outputs = _outputs(_forbidden_client(), _params(operation=operation, on_error="record"))

        assert set(outputs) == {"summary", "success", "error", "reason", "__block_warning"}

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    def test_the_recorded_line_is_headed_by_the_block_not_the_operation(
        self, operation: str
    ) -> None:
        log = RecordingLog()

        _run(_forbidden_client(), _params(operation=operation, on_error="record"), log)

        assert log.entries == [("WARN", f"Rollout failed (Forbidden): {FORBIDDEN_MESSAGE}")]

    def test_a_recorded_failure_writes_no_info_line(self) -> None:
        log = RecordingLog()

        _run(_forbidden_client(), _params(operation="restart", on_error="record"), log)

        assert [level for level, _message in log.entries] == ["WARN"]

    def test_record_keeps_a_happy_run_green(self) -> None:
        log = RecordingLog()

        outputs = _outputs(_restart_client(), _params(operation="restart", on_error="record"), log)

        assert outputs["success"] is True
        assert "__block_warning" not in outputs
        assert [level for level, _message in log.entries] == ["INFO"]

    @pytest.mark.parametrize("on_error", ["Record", "RECORD", True, None])
    def test_only_the_literal_record_records(self, on_error: Any) -> None:
        with pytest.raises(ValueError, match=exact(FORBIDDEN_MESSAGE)):
            _run(_forbidden_client(), _params(operation="restart", on_error=on_error))


class TestAlwaysHardFail:
    """Session and transport failures raise under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_bogus_session_raises(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=exact(SESSION_MESSAGE)):
            _run(_restart_client(), _params(session="not-a-kubeconfig", on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_missing_session_raises(self, on_error: str) -> None:
        params = {"kind": "Deployment", "name": "web", "on_error": on_error}

        with pytest.raises(ValueError, match=exact(SESSION_MESSAGE)):
            _run(_restart_client(), params)

    def test_a_bogus_session_never_constructs_a_client(self) -> None:
        fake = _restart_client()

        with pytest.raises(ValueError):
            _run(fake, _params(session="not-a-kubeconfig"))

        assert fake.factory.call_count == 0
        assert fake.calls == []

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_transport_failure_raises(self, on_error: str) -> None:
        message = (
            f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] Connection refused"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_WORKLOADS)

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _params(operation="restart", on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_timeout_raises(self, on_error: str) -> None:
        message = f"Kubernetes API request GET {DEPLOYMENT_PATH} timed out after 30 seconds"
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_WORKLOADS)

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _params(operation="status", on_error=on_error))
