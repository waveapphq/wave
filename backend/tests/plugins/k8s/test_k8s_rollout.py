"""K8s Rollout plugin tests (REQ-5.1.1, REQ-3.4.1.5, K8SWRITE-7).

Rollout restarts a Deployment, StatefulSet or DaemonSet, reports how its current
rollout is going, or rolls it back to an earlier revision. Restart and Undo write
and return without a verdict; Status reads once and never waits. The block carries
the shared success/error/reason output core, gated behind Record and continue, and
Status is gated behind its own operation (K8SWRITE-7).
"""

import re
import urllib.parse
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    SERVER,
    FakeK8sClient,
    block_params,
    exact,
    execute_context,
    patch_verb_client,
    required_conditions,
    resource,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.core.table import Table
from wavecore.plugins.k8s_rollout import K8sRolloutPlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "operation",
    "kind",
    "name",
    "to_revision",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = [
    ("summary", "table"),
    ("status", "string"),
    ("success", "boolean"),
    ("error", "string"),
    ("reason", "string"),
]

# Outputs the sheet deliberately does not carry; a stray one is a design regression.
FORBIDDEN_OUTPUTS = {"message", "revision", "desired", "updated", "ready", "available"}

SUMMARY_COLUMNS = ["RESOURCE", "OUTCOME", "MESSAGE"]

STATUS_SHOW_WHEN = {"field": "operation", "values": ["status"]}
RECORD_SHOW_WHEN = {"field": "on_error", "values": ["record"]}

RESTART_ANNOTATION = "kubectl.kubernetes.io/restartedAt"
REVISION_ANNOTATION = "deployment.kubernetes.io/revision"
STRATEGIC_MERGE = "application/strategic-merge-patch+json"

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

RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")

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
    labels = {"app": "web", "pod-template-hash": suffix}
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


_REPLICA_SETS = _listed(
    "ReplicaSet",
    [
        _replica_set("1", "nginx:1.25", "5f4"),
        _replica_set("2", "nginx:1.26", "6b8"),
        _replica_set("3", "nginx:1.27", "7c9"),
    ],
)
_CONTROLLER_REVISIONS = _listed(
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


def _params_by_name(plugin: K8sRolloutPlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


def _outputs_by_name(plugin: K8sRolloutPlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


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


def _rows(result: dict[str, Any]) -> list[list[Any]]:
    """Every row of the Summary table, as plain lists."""
    table = result["summary"]
    assert isinstance(table, Table)
    return [table[index].to_list() for index in range(table.row_count())]


def _writes(fake: FakeK8sClient) -> list[str]:
    """Every request that was not a read."""
    return [call.method for call in fake.calls if call.method != "GET"]


def _restart_client(**overrides: Any) -> FakeK8sClient:
    """A cluster that answers the restart's guard read and then the patch."""
    obj = _deployment(**overrides)
    return FakeK8sClient(responses=[(200, obj), (200, obj)], resources=_WORKLOADS)


def _undo_client(workload: dict[str, Any], revisions: dict[str, Any]) -> FakeK8sClient:
    """A cluster that answers the undo's workload read, its revision list, and the patch."""
    return FakeK8sClient(
        responses=[(200, workload), (200, revisions), (200, workload)],
        resources=_WORKLOADS,
    )


def _status_client(obj: dict[str, Any]) -> FakeK8sClient:
    """A cluster that answers the status read and nothing else."""
    return FakeK8sClient(responses=[(200, obj)], resources=_WORKLOADS)


def _client_for(operation: str) -> FakeK8sClient:
    """A cluster scripted for exactly the call sequence one operation makes."""
    if operation == "undo":
        return _undo_client(_deployment(), _REPLICA_SETS)
    if operation == "status":
        return _status_client(_deployment())
    return _restart_client()


async def _execute(
    fake: FakeK8sClient,
    params: dict[str, Any],
    logger: Any = None,
) -> Any:
    with patch_verb_client("rollout", fake):
        return await K8sRolloutPlugin().execute(execute_context(params, None, logger))


class TestMetadata:
    """Plugin identity, the ten parameters, and the five outputs."""

    def test_plugin_instantiates(self) -> None:
        assert K8sRolloutPlugin() is not None

    def test_identity(self) -> None:
        meta = K8sRolloutPlugin().metadata

        assert meta["id"] == "k8s-rollout"
        assert meta["name"] == "K8s Rollout"
        assert meta["category"] == "kubernetes"
        assert meta["version"] == "1.0.0"
        assert meta["return_type"] == "map"
        assert meta["author"] == "WAVE Framework"

    def test_remotable_is_true(self) -> None:
        assert K8sRolloutPlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sRolloutPlugin().metadata["proxy_support"] == "supported"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sRolloutPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_sheet_carries_exactly_ten_rows(self) -> None:
        assert len(K8sRolloutPlugin().metadata["parameters"]) == 10

    def test_there_is_no_resource_type_kind_custom_pair(self) -> None:
        names = [p["name"] for p in K8sRolloutPlugin().metadata["parameters"]]

        assert "resource_type" not in names
        assert "kind_custom" not in names

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        required = [name for name in EXPECTED_PARAM_ORDER if params[name].get("required")]
        assert required == ["session", "kind", "name"]

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["operation"]["type"] == "string"
        assert params["kind"]["type"] == "string"
        assert params["name"]["type"] == "string"
        assert params["to_revision"]["type"] == "integer"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_defaults(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        assert params["timeout"]["default"] == 30
        assert params["operation"]["default"] == "restart"
        assert params["kind"]["default"] == "Deployment"
        assert params["on_error"]["default"] == "fail"

    def test_the_free_text_rows_declare_no_default(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        for name in ("name", "to_revision", "namespace", "impersonate_user", "impersonate_groups"):
            assert params[name].get("default") is None

    def test_enum_values(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        assert params["operation"]["enum_values"] == ["restart", "status", "undo"]
        assert params["kind"]["enum_values"] == ["Deployment", "StatefulSet", "DaemonSet"]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_only_the_three_mode_params_are_enums(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        assert {name for name, p in params.items() if "enum_values" in p} == {
            "operation",
            "kind",
            "on_error",
        }

    def test_there_is_no_history_operation(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        assert "history" not in params["operation"]["enum_values"]

    def test_session_is_the_only_secret_parameter(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        for name in ("session", "name", "namespace", "impersonate_user", "impersonate_groups"):
            assert params[name]["trim"] is True

    def test_the_enum_and_number_rows_declare_no_trim(self) -> None:
        params = _params_by_name(K8sRolloutPlugin())

        for name in ("timeout", "operation", "kind", "to_revision", "on_error"):
            assert params[name].get("trim") is not True

    def test_no_parameter_is_conditionally_required(self) -> None:
        """Every Rollout row is either always required or never required."""
        params = _params_by_name(K8sRolloutPlugin())

        assert [n for n in EXPECTED_PARAM_ORDER if required_conditions(params[n])] == []

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sRolloutPlugin().metadata["parameters"]:
            assert param.get("description")


class TestOutputSchema:
    """Five outputs, in order, with the two independent visibility gates."""

    def test_output_names_types_and_order(self) -> None:
        outputs = K8sRolloutPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == EXPECTED_OUTPUT_ORDER

    def test_there_are_exactly_five_outputs(self) -> None:
        assert len(K8sRolloutPlugin().metadata["output_schema"]) == 5

    def test_the_sheet_carries_none_of_the_dropped_outputs(self) -> None:
        names = {o["name"] for o in K8sRolloutPlugin().metadata["output_schema"]}

        assert names & FORBIDDEN_OUTPUTS == set()

    def test_status_is_gated_on_the_operation(self) -> None:
        outputs = _outputs_by_name(K8sRolloutPlugin())

        assert outputs["status"]["show_when"] == STATUS_SHOW_WHEN

    def test_error_and_reason_are_gated_on_record_and_continue(self) -> None:
        outputs = _outputs_by_name(K8sRolloutPlugin())

        assert outputs["error"]["show_when"] == RECORD_SHOW_WHEN
        assert outputs["reason"]["show_when"] == RECORD_SHOW_WHEN

    def test_success_is_never_gated(self) -> None:
        """The deliberate exception: Success stays visible in both On error modes."""
        outputs = _outputs_by_name(K8sRolloutPlugin())

        assert "show_when" not in outputs["success"]

    def test_summary_is_never_gated(self) -> None:
        outputs = _outputs_by_name(K8sRolloutPlugin())

        assert "show_when" not in outputs["summary"]

    def test_the_two_gates_read_different_fields(self) -> None:
        outputs = _outputs_by_name(K8sRolloutPlugin())

        gated = {name: o["show_when"]["field"] for name, o in outputs.items() if "show_when" in o}
        assert gated == {"status": "operation", "error": "on_error", "reason": "on_error"}

    def test_the_output_core_reads_the_verb_neutral_wording(self) -> None:
        outputs = _outputs_by_name(K8sRolloutPlugin())

        assert outputs["success"]["description"] == (
            "True when the cluster carried out the operation without error; false when "
            "On error is Record and continue and the cluster refused it"
        )
        assert outputs["error"]["description"] == (
            "The error message when the operation failed under Record and continue; empty otherwise"
        )
        assert outputs["reason"]["description"] == (
            "The cluster reason for the failure, like NotFound or Forbidden; empty when the "
            "operation succeeded"
        )

    def test_no_output_carries_type_rules(self) -> None:
        for output in K8sRolloutPlugin().metadata["output_schema"]:
            assert "type_when" not in output

    def test_no_output_is_flagged_secret(self) -> None:
        for output in K8sRolloutPlugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sRolloutPlugin().metadata["output_schema"]:
            assert output.get("description")


class TestValidation:
    """validate() - session, impersonation, enums, name, timeout, to_revision."""

    async def test_minimal_params_pass(self) -> None:
        await K8sRolloutPlugin().validate(_params())

    async def test_full_params_pass(self) -> None:
        await K8sRolloutPlugin().validate(
            block_params(
                timeout=45,
                operation="undo",
                kind="StatefulSet",
                name="db",
                to_revision=4,
                namespace="staging",
                impersonate_user="dev",
                impersonate_groups="qa, ops",
                on_error="record",
            )
        )

    async def test_missing_session(self) -> None:
        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sRolloutPlugin().validate({"kind": "Deployment", "name": "web"})

    async def test_empty_session_reports_the_empty_case(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sRolloutPlugin().validate(_params(session=""))

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sRolloutPlugin().validate(_params(impersonate_groups="qa, ops"))

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sRolloutPlugin().validate(
            _params(impersonate_user="dev", impersonate_groups="qa, ops")
        )

    async def test_operation_enum(self) -> None:
        message = (
            "Parameter 'operation' must be one of: restart, status, undo; "
            "Actual value was 'history'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sRolloutPlugin().validate(_params(operation="history"))

    async def test_kind_enum(self) -> None:
        message = (
            "Parameter 'kind' must be one of: Deployment, StatefulSet, DaemonSet; "
            "Actual value was 'ReplicaSet'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sRolloutPlugin().validate(_params(kind="ReplicaSet"))

    async def test_on_error_enum(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sRolloutPlugin().validate(_params(on_error="ignore"))

    @pytest.mark.parametrize("kind", ["Deployment", "StatefulSet", "DaemonSet"])
    async def test_every_declared_kind_passes(self, kind: str) -> None:
        await K8sRolloutPlugin().validate(_params(kind=kind))

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    async def test_every_declared_operation_passes(self, operation: str) -> None:
        await K8sRolloutPlugin().validate(_params(operation=operation))

    async def test_missing_name(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sRolloutPlugin().validate(block_params(kind="Deployment"))

    async def test_empty_name_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sRolloutPlugin().validate(_params(name=""))

    async def test_zero_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await K8sRolloutPlugin().validate(_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await K8sRolloutPlugin().validate(_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sRolloutPlugin().validate(_params(timeout=1))

    async def test_zero_to_revision_is_rejected(self) -> None:
        message = "Parameter 'to_revision' must be 1 or greater"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sRolloutPlugin().validate(_params(operation="undo", to_revision=0))

    async def test_negative_to_revision_is_rejected(self) -> None:
        message = "Parameter 'to_revision' must be 1 or greater"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sRolloutPlugin().validate(_params(operation="undo", to_revision=-2))

    async def test_a_stale_to_revision_is_rejected_under_any_operation(self) -> None:
        message = "Parameter 'to_revision' must be 1 or greater"

        with pytest.raises(ValueError, match=exact(message)):
            await K8sRolloutPlugin().validate(_params(operation="restart", to_revision=0))

    async def test_the_first_revision_passes(self) -> None:
        await K8sRolloutPlugin().validate(_params(operation="undo", to_revision=1))

    async def test_an_absent_to_revision_passes(self) -> None:
        await K8sRolloutPlugin().validate(_params(operation="undo"))


class TestExecuteRestart:
    """Restart stamps the pod template and returns without a verdict."""

    async def test_the_patch_carries_the_strategic_merge_media_type(self) -> None:
        fake = _restart_client()

        await _execute(fake, _params(operation="restart"))

        assert fake.last.method == "PATCH"
        assert fake.last.path == DEPLOYMENT_PATH
        assert fake.last.content_type == STRATEGIC_MERGE

    async def test_the_body_stamps_only_the_restarted_at_annotation(self) -> None:
        fake = _restart_client()

        await _execute(fake, _params(operation="restart"))

        annotations = fake.last.body["spec"]["template"]["metadata"]["annotations"]
        assert list(annotations) == [RESTART_ANNOTATION]
        assert fake.last.body == {
            "spec": {"template": {"metadata": {"annotations": dict(annotations)}}}
        }

    async def test_the_stamp_is_rfc3339(self) -> None:
        fake = _restart_client()

        await _execute(fake, _params(operation="restart"))

        stamp = fake.last.body["spec"]["template"]["metadata"]["annotations"][RESTART_ANNOTATION]
        assert RFC3339.match(stamp)
        assert datetime.fromisoformat(stamp.replace("Z", "+00:00")).tzinfo is not None

    async def test_the_stamp_is_now(self) -> None:
        fake = _restart_client()

        await _execute(fake, _params(operation="restart"))

        stamp = fake.last.body["spec"]["template"]["metadata"]["annotations"][RESTART_ANNOTATION]
        stamped = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        assert abs((datetime.now(UTC) - stamped).total_seconds()) < 60

    async def test_restart_is_the_default_operation(self) -> None:
        fake = _restart_client()

        await _execute(fake, _params())

        assert fake.last.method == "PATCH"
        assert RESTART_ANNOTATION in fake.last.body["spec"]["template"]["metadata"]["annotations"]

    async def test_the_summary_row_reads_as_kubectl_prints_it(self) -> None:
        fake = _restart_client()

        result = await _execute(fake, _params(operation="restart"))

        assert _rows(result) == [
            [DEPLOYMENT_TYPE_NAME, "restarted", f"{DEPLOYMENT_TYPE_NAME} restarted"]
        ]

    async def test_the_summary_carries_the_three_typed_columns(self) -> None:
        fake = _restart_client()

        result = await _execute(fake, _params(operation="restart"))

        assert result["summary"].col_names() == SUMMARY_COLUMNS
        assert result["summary"].col_types() == ["string", "string", "string"]

    async def test_restart_produces_no_verdict(self) -> None:
        fake = _restart_client()

        result = await _execute(fake, _params(operation="restart"))

        assert "status" not in result

    async def test_restart_returns_exactly_the_outputs_its_mode_declares(self) -> None:
        fake = _restart_client()

        result = await _execute(fake, _params(operation="restart"))

        assert set(result) == {"summary", "success", "error", "reason"}
        assert result["success"] is True

    async def test_a_statefulset_restart_targets_the_statefulset(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _stateful_set()), (200, _stateful_set())], resources=_WORKLOADS
        )

        result = await _execute(fake, _params(operation="restart", kind="StatefulSet", name="db"))

        assert fake.last.method == "PATCH"
        assert fake.last.path == STATEFULSET_PATH
        assert fake.last.content_type == STRATEGIC_MERGE
        assert _rows(result) == [
            [STATEFULSET_TYPE_NAME, "restarted", f"{STATEFULSET_TYPE_NAME} restarted"]
        ]

    async def test_a_daemonset_restart_targets_the_daemonset(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _daemon_set()), (200, _daemon_set())], resources=_WORKLOADS
        )

        result = await _execute(fake, _params(operation="restart", kind="DaemonSet", name="agent"))

        assert fake.last.method == "PATCH"
        assert fake.last.path == DAEMONSET_PATH
        assert _rows(result) == [
            [DAEMONSET_TYPE_NAME, "restarted", f"{DAEMONSET_TYPE_NAME} restarted"]
        ]

    async def test_a_specified_namespace_wins_over_the_session_default(self) -> None:
        fake = _restart_client()

        await _execute(fake, _params(operation="restart", namespace="staging"))

        assert fake.last.path == "/apis/apps/v1/namespaces/staging/deployments/web"

    async def test_the_kind_is_discovered_once(self) -> None:
        fake = _restart_client()

        await _execute(fake, _params(operation="restart"))

        assert fake.discoveries == ["Deployment"]

    async def test_the_client_receives_the_session_context_and_the_timeout(self) -> None:
        fake = _restart_client()

        await _execute(fake, _params(operation="restart", timeout=45))

        context = fake.factory.call_args.args[0]
        assert context.server == SERVER
        assert fake.factory.call_args.args[1] == 45

    async def test_impersonation_reaches_the_client(self) -> None:
        fake = _restart_client()

        await _execute(
            fake, _params(operation="restart", impersonate_user="dev", impersonate_groups="qa, ops")
        )

        assert fake.factory.call_args.kwargs["impersonate_user"] == "dev"
        assert fake.factory.call_args.kwargs["impersonate_groups"] == ["qa", "ops"]


class TestExecuteStatus:
    """Status reads once, reports a verdict, and never waits."""

    async def test_status_issues_exactly_one_read(self) -> None:
        fake = _status_client(_deployment())

        await _execute(fake, _params(operation="status"))

        assert [(call.method, call.path) for call in fake.calls] == [("GET", DEPLOYMENT_PATH)]
        assert fake.calls[0].body is None

    async def test_status_never_writes(self) -> None:
        fake = _status_client(_deployment())

        await _execute(fake, _params(operation="status"))

        assert _writes(fake) == []

    async def test_status_returns_exactly_the_outputs_its_mode_declares(self) -> None:
        fake = _status_client(_deployment())

        result = await _execute(fake, _params(operation="status"))

        assert set(result) == {"summary", "status", "success", "error", "reason"}

    async def test_a_settled_deployment_is_complete(self) -> None:
        fake = _status_client(_deployment())

        result = await _execute(fake, _params(operation="status"))

        assert result["status"] == "complete"
        assert _rows(result) == [[DEPLOYMENT_TYPE_NAME, "complete", DEPLOYMENT_COMPLETE]]

    async def test_a_mid_rollout_deployment_is_progressing(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _deployment(updated=1, available=1, status_replicas=3))],
            resources=_WORKLOADS,
        )

        result = await _execute(fake, _params(operation="status"))

        assert result["status"] == "progressing"
        assert _rows(result) == [[DEPLOYMENT_TYPE_NAME, "progressing", DEPLOYMENT_UPDATING]]

    async def test_the_summary_carries_the_three_typed_columns(self) -> None:
        fake = _status_client(_deployment())

        result = await _execute(fake, _params(operation="status"))

        assert result["summary"].col_names() == SUMMARY_COLUMNS
        assert result["summary"].col_types() == ["string", "string", "string"]

    async def test_a_specified_namespace_wins_over_the_session_default(self) -> None:
        fake = _status_client(_deployment())

        await _execute(fake, _params(operation="status", namespace="staging"))

        assert fake.calls[0].path == "/apis/apps/v1/namespaces/staging/deployments/web"

    async def test_a_missing_workload_fails_the_block(self) -> None:
        body = _failure("NotFound", 'deployments.apps "web" not found', 404)
        fake = FakeK8sClient(responses=[(404, body)], resources=_WORKLOADS)
        message = "K8s Deployment 'web' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="status"))


class TestStatusVerdict:
    """complete / progressing / failed, read through the Summary MESSAGE column."""

    async def _verdict(self, obj: dict[str, Any], **overrides: Any) -> dict[str, Any]:
        fake = FakeK8sClient(responses=[(200, obj)], resources=_WORKLOADS)
        return await _execute(fake, _params(operation="status", **overrides))

    async def test_only_three_verdicts_exist(self) -> None:
        result = await self._verdict(_deployment())

        assert result["status"] in {"complete", "progressing", "failed"}

    async def test_old_replicas_pending_termination_is_progressing(self) -> None:
        result = await self._verdict(_deployment(updated=3, status_replicas=5))

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == DEPLOYMENT_TERMINATING

    async def test_updated_replicas_not_yet_available_is_progressing(self) -> None:
        result = await self._verdict(_deployment(updated=3, available=1, status_replicas=3))

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == DEPLOYMENT_AVAILABILITY

    async def test_an_unobserved_spec_change_is_progressing(self) -> None:
        result = await self._verdict(_deployment(generation=3, observed=2))

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == DEPLOYMENT_UNOBSERVED

    async def test_a_missed_progress_deadline_is_failed(self) -> None:
        result = await self._verdict(
            _deployment(updated=1, available=1, conditions=[_DEADLINE_EXCEEDED])
        )

        assert result["status"] == "failed"
        assert _rows(result) == [[DEPLOYMENT_TYPE_NAME, "failed", DEPLOYMENT_DEADLINE]]

    async def test_a_settled_statefulset_is_complete(self) -> None:
        result = await self._verdict(_stateful_set(), kind="StatefulSet", name="db")

        assert result["status"] == "complete"
        assert _rows(result) == [[STATEFULSET_TYPE_NAME, "complete", STATEFULSET_COMPLETE]]

    async def test_a_statefulset_short_of_ready_pods_is_progressing(self) -> None:
        result = await self._verdict(_stateful_set(ready=1), kind="StatefulSet", name="db")

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == STATEFULSET_READINESS

    async def test_a_partially_updated_statefulset_is_progressing(self) -> None:
        result = await self._verdict(_stateful_set(updated=1), kind="StatefulSet", name="db")

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == STATEFULSET_UPDATING

    async def test_a_statefulset_with_an_unobserved_spec_change_is_progressing(self) -> None:
        result = await self._verdict(
            _stateful_set(generation=3, observed=2), kind="StatefulSet", name="db"
        )

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == STATEFULSET_UNOBSERVED

    async def test_a_settled_daemonset_is_complete(self) -> None:
        result = await self._verdict(_daemon_set(), kind="DaemonSet", name="agent")

        assert result["status"] == "complete"
        assert _rows(result) == [[DAEMONSET_TYPE_NAME, "complete", DAEMONSET_COMPLETE]]

    async def test_a_partially_updated_daemonset_is_progressing(self) -> None:
        result = await self._verdict(
            _daemon_set(updated=1, available=1), kind="DaemonSet", name="agent"
        )

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == DAEMONSET_UPDATING

    async def test_a_daemonset_short_of_available_pods_is_progressing(self) -> None:
        result = await self._verdict(_daemon_set(available=1), kind="DaemonSet", name="agent")

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == DAEMONSET_AVAILABILITY

    async def test_a_daemonset_with_an_unobserved_spec_change_is_progressing(self) -> None:
        result = await self._verdict(
            _daemon_set(generation=3, observed=2), kind="DaemonSet", name="agent"
        )

        assert result["status"] == "progressing"
        assert _rows(result)[0][2] == DAEMONSET_UNOBSERVED


class TestExecuteUndo:
    """Undo finds the target revision and writes its pod template back."""

    async def test_the_workload_and_its_revisions_are_read_then_patched(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert [call.method for call in fake.calls] == ["GET", "GET", "PATCH"]
        assert fake.calls[0].path == DEPLOYMENT_PATH
        assert _split(fake.calls[1].path)[0] == REPLICASETS_PATH
        assert fake.calls[2].path == DEPLOYMENT_PATH

    async def test_the_revisions_are_found_through_the_workload_selector(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["app=web"]}

    async def test_a_multi_label_selector_is_sent_in_kubectl_syntax(self) -> None:
        workload = _deployment(labels={"tier": "front", "app": "web"})
        fake = _undo_client(workload, _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["app=web,tier=front"]}

    async def test_the_replicaset_kind_is_discovered_alongside_the_workload(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert fake.discoveries == ["Deployment", "ReplicaSet"]

    async def test_an_empty_to_revision_picks_the_previous_revision(self) -> None:
        fake = _undo_client(_deployment(revision="3"), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.26")}}

    async def test_the_previous_revision_is_the_highest_one_below_the_current(self) -> None:
        revisions = _listed(
            "ReplicaSet",
            [
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("5", "nginx:1.29", "9d1"),
            ],
        )
        fake = _undo_client(_deployment(revision="5"), revisions)

        await _execute(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    async def test_an_explicit_to_revision_picks_that_one(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo", to_revision=1))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    async def test_the_pod_template_hash_label_never_goes_back_onto_the_workload(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo", to_revision=2))

        labels = fake.last.body["spec"]["template"]["metadata"]["labels"]
        assert "pod-template-hash" not in labels

    async def test_the_patch_carries_the_strategic_merge_media_type(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert fake.last.method == "PATCH"
        assert fake.last.content_type == STRATEGIC_MERGE

    async def test_the_summary_row_reads_as_kubectl_prints_it(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        result = await _execute(fake, _params(operation="undo"))

        assert _rows(result) == [
            [DEPLOYMENT_TYPE_NAME, "rolled back", f"{DEPLOYMENT_TYPE_NAME} rolled back"]
        ]

    async def test_undo_produces_no_verdict(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        result = await _execute(fake, _params(operation="undo"))

        assert "status" not in result
        assert set(result) == {"summary", "success", "error", "reason"}

    async def test_an_unknown_revision_is_refused(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)
        message = "No revision 7 found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="undo", to_revision=7))

    async def test_an_unknown_revision_never_reaches_a_write(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        with pytest.raises(ValueError):
            await _execute(fake, _params(operation="undo", to_revision=7))

        assert _writes(fake) == []

    async def test_an_unknown_revision_is_recordable(self) -> None:
        fake = _undo_client(_deployment(), _REPLICA_SETS)

        result = await _execute(fake, _params(operation="undo", to_revision=7, on_error="record"))

        assert result["success"] is False
        assert result["error"] == "No revision 7 found for Deployment 'web'"

    async def test_a_workload_with_no_earlier_revision_is_refused(self) -> None:
        only_current = _listed("ReplicaSet", [_replica_set("1", "nginx:1.25", "5f4")])
        fake = _undo_client(_deployment(), only_current)
        message = "No earlier revision found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="undo"))

    async def test_a_workload_with_no_earlier_revision_is_recordable(self) -> None:
        only_current = _listed("ReplicaSet", [_replica_set("1", "nginx:1.25", "5f4")])
        fake = _undo_client(_deployment(), only_current)

        result = await _execute(fake, _params(operation="undo", on_error="record"))

        assert result["success"] is False
        assert result["error"] == "No earlier revision found for Deployment 'web'"

    async def test_a_statefulset_rolls_back_through_its_controller_revisions(self) -> None:
        fake = _undo_client(_stateful_set(), _CONTROLLER_REVISIONS)

        result = await _execute(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.discoveries == ["StatefulSet", "ControllerRevision"]
        assert _split(fake.calls[1].path) == (
            CONTROLLERREVISIONS_PATH,
            {"labelSelector": ["app=db"]},
        )
        assert fake.last.path == STATEFULSET_PATH
        assert _rows(result) == [
            [STATEFULSET_TYPE_NAME, "rolled back", f"{STATEFULSET_TYPE_NAME} rolled back"]
        ]

    async def test_a_statefulset_writes_the_revisions_own_pod_template_back(self) -> None:
        fake = _undo_client(_stateful_set(), _CONTROLLER_REVISIONS)

        await _execute(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.last.body == _controller_revision(6, "postgres:16")["data"]
        assert fake.last.content_type == STRATEGIC_MERGE

    async def test_a_statefulset_takes_an_explicit_revision(self) -> None:
        fake = _undo_client(_stateful_set(), _CONTROLLER_REVISIONS)

        await _execute(
            fake, _params(operation="undo", kind="StatefulSet", name="db", to_revision=5)
        )

        assert fake.last.body == _controller_revision(5, "postgres:15")["data"]

    async def test_a_statefulset_refuses_an_unknown_revision(self) -> None:
        fake = _undo_client(_stateful_set(), _CONTROLLER_REVISIONS)
        message = "No revision 9 found for StatefulSet 'db'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(
                fake, _params(operation="undo", kind="StatefulSet", name="db", to_revision=9)
            )

    async def test_a_daemonset_rolls_back_through_its_controller_revisions(self) -> None:
        revisions = _listed(
            "ControllerRevision",
            [
                _controller_revision(1, "fluentbit:3.0", owner="agent"),
                _controller_revision(2, "fluentbit:3.1", owner="agent"),
            ],
        )
        fake = _undo_client(_daemon_set(), revisions)

        result = await _execute(fake, _params(operation="undo", kind="DaemonSet", name="agent"))

        assert fake.discoveries == ["DaemonSet", "ControllerRevision"]
        assert fake.last.path == DAEMONSET_PATH
        assert fake.last.body == _controller_revision(1, "fluentbit:3.0", owner="agent")["data"]
        assert _rows(result) == [
            [DAEMONSET_TYPE_NAME, "rolled back", f"{DAEMONSET_TYPE_NAME} rolled back"]
        ]

    async def test_a_daemonset_refuses_an_unknown_revision(self) -> None:
        revisions = _listed(
            "ControllerRevision", [_controller_revision(1, "fluentbit:3.0", owner="agent")]
        )
        fake = _undo_client(_daemon_set(), revisions)
        message = "No revision 4 found for DaemonSet 'agent'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(
                fake, _params(operation="undo", kind="DaemonSet", name="agent", to_revision=4)
            )


class TestUndoSelector:
    """Undo lists revision history through the workload's WHOLE label selector."""

    async def test_an_in_expression_is_sent_in_kubectl_syntax(self) -> None:
        selector = {
            "matchExpressions": [{"key": "app", "operator": "In", "values": ["web", "web-canary"]}]
        }
        fake = _undo_client(_deployment(selector=selector), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["app in (web,web-canary)"]}

    async def test_a_notin_expression_is_sent_in_kubectl_syntax(self) -> None:
        selector = {
            "matchExpressions": [{"key": "tier", "operator": "NotIn", "values": ["batch", "cron"]}]
        }
        fake = _undo_client(_deployment(selector=selector), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["tier notin (batch,cron)"]}

    async def test_an_exists_expression_is_sent_as_the_bare_key(self) -> None:
        selector = {"matchExpressions": [{"key": "app", "operator": "Exists"}]}
        fake = _undo_client(_deployment(selector=selector), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["app"]}

    async def test_a_doesnotexist_expression_is_sent_with_its_bang(self) -> None:
        selector = {"matchExpressions": [{"key": "legacy", "operator": "DoesNotExist"}]}
        fake = _undo_client(_deployment(selector=selector), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["!legacy"]}

    async def test_both_selector_halves_are_sent_together_sorted_by_key(self) -> None:
        selector = {
            "matchLabels": {"app": "web"},
            "matchExpressions": [
                {"key": "zone", "operator": "Exists"},
                {"key": "tier", "operator": "In", "values": ["front"]},
            ],
        }
        fake = _undo_client(_deployment(selector=selector), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["app=web,tier in (front),zone"]}

    async def test_the_values_of_an_expression_are_sorted(self) -> None:
        selector = {
            "matchExpressions": [{"key": "app", "operator": "In", "values": ["web", "api"]}]
        }
        fake = _undo_client(_deployment(selector=selector), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["app in (api,web)"]}

    async def test_a_workload_with_no_selector_sends_no_label_selector_at_all(self) -> None:
        fake = _undo_client(_deployment(selector={}), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert fake.calls[1].path == REPLICASETS_PATH

    async def test_an_operator_the_api_does_not_define_is_left_out(self) -> None:
        selector = {
            "matchLabels": {"app": "web"},
            "matchExpressions": [{"key": "tier", "operator": "GreaterThan", "values": ["2"]}],
        }
        fake = _undo_client(_deployment(selector=selector), _REPLICA_SETS)

        await _execute(fake, _params(operation="undo"))

        assert _split(fake.calls[1].path)[1] == {"labelSelector": ["app=web"]}
        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.26")}}


class TestUndoRevisionHistory:
    """Only the revisions the workload owns, and only the ones carrying a number."""

    async def test_a_foreign_replicaset_matching_the_selector_is_not_history(self) -> None:
        revisions = _listed(
            "ReplicaSet",
            [
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
                _replica_set("9", "redis:7", "aa1", owner_uid=FOREIGN_UID),
            ],
        )
        fake = _undo_client(_deployment(revision="2"), revisions)

        await _execute(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    async def test_a_foreign_revision_cannot_be_rolled_back_to_by_number(self) -> None:
        revisions = _listed(
            "ReplicaSet", [_replica_set("9", "redis:7", "aa1", owner_uid=FOREIGN_UID)]
        )
        fake = _undo_client(_deployment(), revisions)
        message = "No revision 9 found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="undo", to_revision=9))

        assert _writes(fake) == []

    async def test_a_namespace_of_only_foreign_revisions_reads_as_no_history(self) -> None:
        revisions = _listed(
            "ReplicaSet", [_replica_set("9", "redis:7", "aa1", owner_uid=FOREIGN_UID)]
        )
        fake = _undo_client(_deployment(), revisions)
        message = "No earlier revision found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="undo"))

        assert _writes(fake) == []

    async def test_an_ownerless_replicaset_is_not_history(self) -> None:
        adopted = _replica_set("9", "redis:7", "aa1")
        adopted["metadata"].pop("ownerReferences")
        revisions = _listed("ReplicaSet", [_replica_set("1", "nginx:1.25", "5f4"), adopted])
        fake = _undo_client(_deployment(revision="1"), revisions)
        message = "No earlier revision found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="undo"))

    async def test_a_replicaset_owned_as_controller_is_history(self) -> None:
        revisions = _listed(
            "ReplicaSet",
            [_replica_set("1", "nginx:1.25", "5f4"), _replica_set("2", "nginx:1.26", "6b8")],
        )
        fake = _undo_client(_deployment(revision="2"), revisions)

        await _execute(fake, _params(operation="undo", to_revision=1))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    async def test_a_replicaset_owned_but_not_controlled_is_not_history(self) -> None:
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
        fake = _undo_client(_deployment(revision="2"), revisions)

        await _execute(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    async def test_a_replicaset_owned_but_not_controlled_cannot_be_reached_by_number(
        self,
    ) -> None:
        demoted = _replica_set("3", "nginx:1.27", "7c9")
        demoted["metadata"]["ownerReferences"][0]["controller"] = False
        fake = _undo_client(_deployment(), _listed("ReplicaSet", [demoted]))
        message = "No revision 3 found for Deployment 'web'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="undo", to_revision=3))

        assert _writes(fake) == []

    async def test_an_owner_reference_with_no_controller_flag_is_not_history(self) -> None:
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
        fake = _undo_client(_deployment(revision="2"), revisions)

        await _execute(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    async def test_a_controller_revision_owned_but_not_controlled_is_not_history(self) -> None:
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

        await _execute(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.last.body == _controller_revision(5, "postgres:15")["data"]

    async def test_a_replicaset_carrying_no_revision_annotation_is_skipped(self) -> None:
        unnumbered = _replica_set("1", "nginx:1.20", "3a2")
        unnumbered["metadata"].pop("annotations")
        revisions = _listed(
            "ReplicaSet",
            [
                unnumbered,
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
            ],
        )
        fake = _undo_client(_deployment(revision="2"), revisions)

        await _execute(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    async def test_a_replicaset_whose_revision_annotation_is_not_a_number_is_skipped(
        self,
    ) -> None:
        unnumbered = _replica_set("latest", "nginx:1.20", "3a2")
        revisions = _listed(
            "ReplicaSet",
            [
                unnumbered,
                _replica_set("1", "nginx:1.25", "5f4"),
                _replica_set("2", "nginx:1.26", "6b8"),
            ],
        )
        fake = _undo_client(_deployment(revision="2"), revisions)

        await _execute(fake, _params(operation="undo"))

        assert fake.last.body == {"spec": {"template": _restored_template("nginx:1.25")}}

    async def test_a_foreign_controller_revision_is_not_history(self) -> None:
        revisions = _listed(
            "ControllerRevision",
            [
                _controller_revision(5, "postgres:15"),
                _controller_revision(6, "postgres:16"),
                _controller_revision(9, "redis:7", owner_uid=FOREIGN_UID),
            ],
        )
        fake = _undo_client(_stateful_set(), revisions)

        await _execute(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.last.body == _controller_revision(5, "postgres:15")["data"]

    async def test_a_controller_revision_carrying_no_revision_field_is_skipped(self) -> None:
        unnumbered = _controller_revision(4, "postgres:14")
        unnumbered.pop("revision")
        revisions = _listed(
            "ControllerRevision",
            [
                unnumbered,
                _controller_revision(5, "postgres:15"),
                _controller_revision(6, "postgres:16"),
            ],
        )
        fake = _undo_client(_stateful_set(), revisions)

        await _execute(fake, _params(operation="undo", kind="StatefulSet", name="db"))

        assert fake.last.body == _controller_revision(5, "postgres:15")["data"]

    async def test_a_namespace_of_only_foreign_revisions_is_recordable(self) -> None:
        revisions = _listed(
            "ReplicaSet", [_replica_set("9", "redis:7", "aa1", owner_uid=FOREIGN_UID)]
        )
        fake = _undo_client(_deployment(), revisions)

        result = await _execute(fake, _params(operation="undo", on_error="record"))

        assert result["success"] is False
        assert result["error"] == "No earlier revision found for Deployment 'web'"


class TestGuardRails:
    """Refusals WAVE issues itself, because the cluster will not."""

    async def test_a_kind_outside_the_three_is_refused_by_name(self) -> None:
        message = (
            "Parameter 'kind' must be one of: Deployment, StatefulSet, DaemonSet; "
            "Actual value was 'Pod'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sRolloutPlugin().validate(_params(operation="undo", kind="Pod"))

    async def test_a_kind_outside_the_three_never_touches_the_cluster(self) -> None:
        fake = FakeK8sClient(resources=_WORKLOADS)

        with patch_verb_client("rollout", fake), pytest.raises(ValueError):
            await K8sRolloutPlugin().validate(_params(operation="undo", kind="Job"))

        assert fake.calls == []
        assert fake.factory.call_count == 0

    async def test_a_paused_deployment_refuses_a_restart(self) -> None:
        fake = _status_client(_deployment(paused=True))
        message = "Deployment 'web' is paused - resume the rollout before restarting it"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="restart"))

    async def test_a_paused_deployment_is_never_patched(self) -> None:
        fake = _status_client(_deployment(paused=True))

        with pytest.raises(ValueError):
            await _execute(fake, _params(operation="restart"))

        assert _writes(fake) == []

    async def test_a_paused_deployment_restart_is_recordable(self) -> None:
        fake = _status_client(_deployment(paused=True))

        result = await _execute(fake, _params(operation="restart", on_error="record"))

        assert result["success"] is False
        assert result["error"] == (
            "Deployment 'web' is paused - resume the rollout before restarting it"
        )
        assert _writes(fake) == []

    async def test_a_paused_deployment_still_reports_its_status(self) -> None:
        fake = _status_client(_deployment(paused=True))

        result = await _execute(fake, _params(operation="status"))

        assert result["status"] == "complete"

    async def test_a_running_deployment_restarts_normally(self) -> None:
        fake = _restart_client(paused=False)

        result = await _execute(fake, _params(operation="restart"))

        assert result["success"] is True
        assert _writes(fake) == ["PATCH"]

    async def test_a_statefulset_off_rolling_update_has_no_status_to_report(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _stateful_set(strategy="OnDelete", partition=None))],
            resources=_WORKLOADS,
        )
        message = (
            "StatefulSet 'db' is on the OnDelete update strategy, "
            "which has no rollout to report on"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="status", kind="StatefulSet", name="db"))

    async def test_a_daemonset_off_rolling_update_has_no_status_to_report(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _daemon_set(strategy="OnDelete"))], resources=_WORKLOADS
        )
        message = (
            "DaemonSet 'agent' is on the OnDelete update strategy, "
            "which has no rollout to report on"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="status", kind="DaemonSet", name="agent"))

    async def test_an_update_strategy_refusal_never_writes(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _daemon_set(strategy="OnDelete"))], resources=_WORKLOADS
        )

        with pytest.raises(ValueError):
            await _execute(fake, _params(operation="status", kind="DaemonSet", name="agent"))

        assert _writes(fake) == []

    async def test_an_update_strategy_refusal_is_recordable(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _stateful_set(strategy="OnDelete", partition=None))],
            resources=_WORKLOADS,
        )

        result = await _execute(
            fake, _params(operation="status", kind="StatefulSet", name="db", on_error="record")
        )

        assert result["success"] is False
        assert result["error"] == (
            "StatefulSet 'db' is on the OnDelete update strategy, "
            "which has no rollout to report on"
        )
        assert result["status"] == ""

    async def test_an_on_delete_statefulset_still_restarts(self) -> None:
        """The guard rail is about reporting a rollout, not about writing one."""
        obj = _stateful_set(strategy="OnDelete", partition=None)
        fake = FakeK8sClient(responses=[(200, obj), (200, obj)], resources=_WORKLOADS)

        result = await _execute(fake, _params(operation="restart", kind="StatefulSet", name="db"))

        assert result["success"] is True
        assert fake.last.method == "PATCH"

    async def test_a_recreate_deployment_still_reports_its_status(self) -> None:
        fake = FakeK8sClient(
            responses=[(200, _deployment(strategy="Recreate"))], resources=_WORKLOADS
        )

        result = await _execute(fake, _params(operation="status"))

        assert result["status"] == "complete"


class TestClusterRefusals:
    """The verb reaches the message and the action heads the recorded line."""

    async def test_a_restart_failure_names_the_restart(self) -> None:
        obj = _deployment()
        body = _failure("InternalError", "etcd is unavailable", 500)
        fake = FakeK8sClient(responses=[(200, obj), (500, body)], resources=_WORKLOADS)
        message = (
            "Kubernetes could not restart Deployment 'web' in namespace 'apps': "
            "etcd is unavailable"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="restart"))

    async def test_a_status_failure_names_the_read(self) -> None:
        body = _failure("InternalError", "etcd is unavailable", 500)
        fake = FakeK8sClient(responses=[(500, body)], resources=_WORKLOADS)
        message = (
            "Kubernetes could not read Deployment 'web' in namespace 'apps': etcd is unavailable"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="status"))

    async def test_an_undo_failure_names_the_roll_back(self) -> None:
        body = _failure("InternalError", "etcd is unavailable", 500)
        fake = FakeK8sClient(
            responses=[(200, _deployment()), (200, _REPLICA_SETS), (500, body)],
            resources=_WORKLOADS,
        )
        message = (
            "Kubernetes could not roll back Deployment 'web' in namespace 'apps': "
            "etcd is unavailable"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="undo"))

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    async def test_the_recorded_line_is_headed_by_the_block_not_the_operation(
        self, operation: str
    ) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)
        logger = MagicMock()

        await _execute(fake, _params(operation=operation, on_error="record"), logger=logger)

        logger.warn.assert_called_once_with(
            "Rollout failed (Forbidden): Kubernetes API permission denied: "
            "deployments.apps is forbidden"
        )

    async def test_a_permission_denial_is_recordable_with_its_reason(self) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)

        result = await _execute(fake, _params(operation="restart", on_error="record"))

        assert result["success"] is False
        assert result["reason"] == "Forbidden"
        assert result["error"] == (
            "Kubernetes API permission denied: deployments.apps is forbidden"
        )

    async def test_a_recorded_failure_asks_for_the_amber_block_status(self) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)

        result = await _execute(fake, _params(operation="restart", on_error="record"))

        assert result["__block_warning"] is True

    async def test_a_recorded_restart_failure_leaves_an_empty_summary(self) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)

        result = await _execute(fake, _params(operation="restart", on_error="record"))

        assert result["summary"].row_count() == 0
        assert result["summary"].col_names() == SUMMARY_COLUMNS

    async def test_a_recorded_status_failure_carries_an_empty_verdict(self) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)

        result = await _execute(fake, _params(operation="status", on_error="record"))

        assert result["status"] == ""
        assert set(result) == {
            "summary",
            "status",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    async def test_a_recorded_restart_failure_declares_no_verdict(self) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)

        result = await _execute(fake, _params(operation="restart", on_error="record"))

        assert set(result) == {"summary", "success", "error", "reason", "__block_warning"}

    async def test_a_discovery_miss_names_the_kind(self) -> None:
        fake = FakeK8sClient(resources={})
        message = (
            "This cluster has no resource kind 'Deployment' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation="restart"))


class TestErrorReasonGate:
    """Under Fail the block nothing is bound; under Record all three carry values."""

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    async def test_a_cluster_refusal_raises_out_of_the_block(self, operation: str) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)
        message = "Kubernetes API permission denied: deployments.apps is forbidden"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(operation=operation))

    async def test_a_raised_refusal_binds_nothing_at_all(self) -> None:
        """The engine binds outputs after execute() returns, and it never returns."""
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)
        logger = MagicMock()
        bound: dict[str, Any] = {}

        with pytest.raises(ValueError):
            bound = await _execute(fake, _params(operation="restart"), logger=logger)

        assert bound == {}
        assert "error" not in bound
        assert "reason" not in bound
        logger.warn.assert_not_called()

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    async def test_record_and_continue_returns_all_three(self, operation: str) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)

        result = await _execute(fake, _params(operation=operation, on_error="record"))

        assert result["success"] is False
        assert result["error"] == "Kubernetes API permission denied: deployments.apps is forbidden"
        assert result["reason"] == "Forbidden"

    async def test_fail_is_the_default_mode(self) -> None:
        body = _failure("Forbidden", "deployments.apps is forbidden", 403)
        fake = FakeK8sClient(responses=[(403, body)], resources=_WORKLOADS)

        with pytest.raises(ValueError):
            await _execute(fake, _params())

    @pytest.mark.parametrize("operation", ["restart", "status", "undo"])
    async def test_a_happy_run_carries_the_full_core(self, operation: str) -> None:
        fake = _client_for(operation)

        result = await _execute(fake, _params(operation=operation))

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_record_and_continue_keeps_a_happy_run_green(self) -> None:
        fake = _restart_client()
        logger = MagicMock()

        result = await _execute(fake, _params(operation="restart", on_error="record"), logger)

        assert result["success"] is True
        assert "__block_warning" not in result
        logger.warn.assert_not_called()


class TestAlwaysHardFail:
    """Session and transport failures raise under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_bogus_session_raises(self, on_error: str) -> None:
        fake = _restart_client()
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _params(session="not-a-kubeconfig", on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_missing_session_raises(self, on_error: str) -> None:
        fake = _restart_client()
        params = {"kind": "Deployment", "name": "web", "on_error": on_error}
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_transport_failure_raises(self, on_error: str) -> None:
        message = (
            f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] Connection refused"
        )
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_WORKLOADS)

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _params(operation="restart", on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_timeout_raises(self, on_error: str) -> None:
        message = f"Kubernetes API request PATCH {DEPLOYMENT_PATH} timed out after 30 seconds"
        fake = FakeK8sClient(responses=[K8sApiError(message)], resources=_WORKLOADS)

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _params(operation="restart", on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_invalid_params_raise_from_validate(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await K8sRolloutPlugin().validate(_params(timeout=0, on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_missing_name_raises_from_validate(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sRolloutPlugin().validate(block_params(kind="Deployment", on_error=on_error))


class TestNamespaceDescription:
    """A write block's Namespace row says what it writes to, not what it reads from."""

    def test_the_namespace_row_does_not_say_read_from(self) -> None:
        description = _params_by_name(K8sRolloutPlugin())["namespace"]["description"]

        assert "read from" not in description

    def test_the_namespace_row_still_names_the_session_default(self) -> None:
        description = _params_by_name(K8sRolloutPlugin())["namespace"]["description"]

        assert "session default" in description
