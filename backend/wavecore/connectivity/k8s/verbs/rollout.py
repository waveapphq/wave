"""The K8s Rollout verb (REQ-5.1.1, REQ-3.4.1.5, K8SWRITE-7).

Restarts a Deployment, StatefulSet or DaemonSet, reports how its current
rollout is going, or rolls it back to an earlier revision. Restart and Undo
write and return without a verdict; Status reads once and never waits.
Carries the family output core and the fail-or-record Failure Handling
control, with Status gated behind its own operation.
"""

import copy
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..rest import K8sClient, K8sResource
from ._context import require_context
from ._errors import K8sReadRejected, map_api_error
from ._outputs import block_failure, block_success, read_objects, summary_table, type_name
from ._resources import (
    DEFAULT_TIMEOUT,
    client_options,
    resolve_namespace,
    resolve_read_resource,
    resource_path,
)

_SUMMARY_COLUMNS = [("RESOURCE", "string"), ("OUTCOME", "string"), ("MESSAGE", "string")]
_STRATEGIC_MERGE = "application/strategic-merge-patch+json"
_RESTART_ANNOTATION = "kubectl.kubernetes.io/restartedAt"
_REVISION_ANNOTATION = "deployment.kubernetes.io/revision"
_HASH_LABEL = "pod-template-hash"
_ROLLING_UPDATE = "RollingUpdate"
_TIMED_OUT = "ProgressDeadlineExceeded"
_REVISION_KINDS = {
    "Deployment": "ReplicaSet",
    "StatefulSet": "ControllerRevision",
    "DaemonSet": "ControllerRevision",
}
_VERBS = {"restart": "restart", "status": "read", "undo": "roll back"}
_SELECTOR_OPERATORS: dict[str, Callable[[str, list[str]], str]] = {
    "In": lambda key, values: f"{key} in ({','.join(values)})",
    "NotIn": lambda key, values: f"{key} notin ({','.join(values)})",
    "Exists": lambda key, _values: key,
    "DoesNotExist": lambda key, _values: f"!{key}",
}


@dataclass(frozen=True)
class _Rollout:
    """One workload the verb acts on, plus the verb word its errors read with."""

    client: K8sClient
    resource: K8sResource
    namespace: str | None
    name: str
    verb: str

    @property
    def path(self) -> str:
        """The API path of the workload itself."""
        return resource_path(self.resource, self.namespace, self.name)

    @property
    def target(self) -> str:
        """The workload in kubectl's type/name form."""
        return type_name(self.resource, self.name)

    def call(
        self, method: str, path: str, body: dict[str, Any] | None, content_type: str | None = None
    ) -> dict[str, Any]:
        """Send one request; a cluster error becomes a rejection the on_error dispatch handles."""
        status, parsed = self.client.request(method, path, body, content_type=content_type)
        if status >= 400:
            raise K8sReadRejected(
                map_api_error(
                    status, parsed, self.resource.kind, self.name, self.namespace, verb=self.verb
                ),
                parsed.get("reason"),
            )
        return dict(parsed)

    def summary(self, outcome: str, message: str) -> dict[str, Any]:
        """The one-row Summary table envelope an operation returns."""
        return summary_table(_SUMMARY_COLUMNS, [[self.target, outcome, message]])


def _empty_outputs(params: dict[str, Any]) -> dict[str, Any]:
    outputs: dict[str, Any] = {"summary": summary_table(_SUMMARY_COLUMNS, [])}
    if params.get("operation", "restart") == "status":
        outputs["status"] = ""
    return outputs


def _timed_out(status: dict[str, Any]) -> bool:
    return any(
        condition.get("type") == "Progressing" and condition.get("reason") == _TIMED_OUT
        for condition in status.get("conditions", [])
    )


def _deployment_verdict(obj: dict[str, Any], name: str) -> tuple[str, str]:
    """kubectl's own DeploymentStatusViewer wording, verdict first."""
    spec, status = obj.get("spec", {}), obj.get("status", {})
    if obj.get("metadata", {}).get("generation", 0) > status.get("observedGeneration", 0):
        return "progressing", "Waiting for deployment spec update to be observed..."
    if _timed_out(status):
        return "failed", f'deployment "{name}" exceeded its progress deadline'
    replicas = spec.get("replicas", 0)
    updated = status.get("updatedReplicas", 0)
    current = status.get("replicas", 0)
    available = status.get("availableReplicas", 0)
    waiting = f'Waiting for deployment "{name}" rollout to finish: '
    if updated < replicas:
        return (
            "progressing",
            f"{waiting}{updated} out of {replicas} new replicas have been updated...",
        )
    if current > updated:
        return (
            "progressing",
            f"{waiting}{current - updated} old replicas are pending termination...",
        )
    if available < updated:
        return "progressing", f"{waiting}{available} of {updated} updated replicas are available..."
    return "complete", f'deployment "{name}" successfully rolled out'


def _stateful_set_verdict(obj: dict[str, Any], name: str) -> tuple[str, str]:
    """kubectl's own StatefulSetStatusViewer wording; the partition defaults to zero."""
    spec, status = obj.get("spec", {}), obj.get("status", {})
    if obj.get("metadata", {}).get("generation", 0) > status.get("observedGeneration", 0):
        return "progressing", "Waiting for statefulset spec update to be observed..."
    replicas = spec.get("replicas", 0)
    ready = status.get("readyReplicas", 0)
    if ready < replicas:
        return "progressing", f"Waiting for {replicas - ready} pods to be ready..."
    partition = spec.get("updateStrategy", {}).get("rollingUpdate", {}).get("partition", 0)
    wanted = replicas - partition
    updated = status.get("updatedReplicas", 0)
    if updated < wanted:
        return "progressing", (
            f"Waiting for partitioned roll out to finish: "
            f"{updated} out of {wanted} new pods have been updated..."
        )
    return "complete", f"partitioned roll out complete: {updated} new pods have been updated..."


def _daemon_set_verdict(obj: dict[str, Any], name: str) -> tuple[str, str]:
    """kubectl's own DaemonSetStatusViewer wording, verdict first."""
    status = obj.get("status", {})
    if obj.get("metadata", {}).get("generation", 0) > status.get("observedGeneration", 0):
        return "progressing", "Waiting for daemon set spec update to be observed..."
    desired = status.get("desiredNumberScheduled", 0)
    updated = status.get("updatedNumberScheduled", 0)
    available = status.get("numberAvailable", 0)
    waiting = f'Waiting for daemon set "{name}" rollout to finish: '
    if updated < desired:
        return "progressing", f"{waiting}{updated} out of {desired} new pods have been updated..."
    if available < desired:
        return "progressing", f"{waiting}{available} of {desired} updated pods are available..."
    return "complete", f'daemon set "{name}" successfully rolled out'


_VERDICTS: dict[str, Callable[[dict[str, Any], str], tuple[str, str]]] = {
    "Deployment": _deployment_verdict,
    "StatefulSet": _stateful_set_verdict,
    "DaemonSet": _daemon_set_verdict,
}


def _require_reportable(obj: dict[str, Any], kind: str, name: str) -> None:
    """A Deployment always reports; the other two need a rolling update to report on."""
    if kind == "Deployment":
        return
    strategy = obj.get("spec", {}).get("updateStrategy", {}).get("type", _ROLLING_UPDATE)
    if strategy != _ROLLING_UPDATE:
        raise K8sReadRejected(
            f"{kind} '{name}' is on the {strategy} update strategy, "
            "which has no rollout to report on",
            None,
        )


def _requirement(expression: dict[str, Any]) -> tuple[str, str] | None:
    """One matchExpressions entry in kubectl's selector syntax, keyed for the sort."""
    render = _SELECTOR_OPERATORS.get(str(expression.get("operator", "")))
    if render is None:
        return None
    key = str(expression.get("key", ""))
    return key, render(key, sorted(str(value) for value in expression.get("values", [])))


def _selector(workload: dict[str, Any]) -> str:
    """The workload's whole label selector - both halves - the way kubectl serializes it."""
    selector = workload.get("spec", {}).get("selector", {})
    labels = selector.get("matchLabels", {})
    terms = [(key, f"{key}={labels[key]}") for key in labels]
    terms += [term for term in map(_requirement, selector.get("matchExpressions", [])) if term]
    return ",".join(term for _, term in sorted(terms, key=lambda pair: pair[0]))


def _revision_number(kind: str, item: dict[str, Any]) -> int | None:
    """A ReplicaSet carries its revision as an annotation; a ControllerRevision as a field."""
    if kind == "Deployment":
        raw = item.get("metadata", {}).get("annotations", {}).get(_REVISION_ANNOTATION)
    else:
        raw = item.get("revision")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _revisions(kind: str, workload: dict[str, Any], listing: dict[str, Any]) -> dict[int, Any]:
    """The numbered revisions the workload controls; the rest of the namespace is not history."""
    uid = workload.get("metadata", {}).get("uid")
    owned: dict[int, Any] = {}
    for item in read_objects(listing):
        references = item.get("metadata", {}).get("ownerReferences", [])
        # kubectl matches history with IsControlledBy: the controller reference, not any owner.
        if not any(
            reference.get("controller") is True and reference.get("uid") == uid
            for reference in references
        ):
            continue
        number = _revision_number(kind, item)
        if number is not None:
            owned[number] = item
    return owned


def _target_revision(params: dict[str, Any], revisions: dict[int, Any], rollout: _Rollout) -> int:
    """The revision to write back: the one asked for, or the highest below the current one."""
    kind, name = rollout.resource.kind, rollout.name
    requested = params.get("to_revision")
    if requested:
        if int(requested) not in revisions:
            raise K8sReadRejected(f"No revision {int(requested)} found for {kind} '{name}'", None)
        return int(requested)
    earlier = [number for number in revisions if number < max(revisions, default=0)]
    if not earlier:
        raise K8sReadRejected(f"No earlier revision found for {kind} '{name}'", None)
    return max(earlier)


def _rollback_body(kind: str, revision: dict[str, Any]) -> dict[str, Any]:
    """A Deployment takes the ReplicaSet template; the other two take the revision data."""
    if kind == "Deployment":
        template = copy.deepcopy(revision["spec"]["template"])
        template.get("metadata", {}).get("labels", {}).pop(_HASH_LABEL, None)
        return {"spec": {"template": template}}
    return copy.deepcopy(revision["data"])


def _restart(rollout: _Rollout, params: dict[str, Any]) -> dict[str, Any]:
    """Read the workload for the paused guard, then stamp its pod template."""
    obj = rollout.call("GET", rollout.path, None)
    if obj.get("spec", {}).get("paused"):
        raise K8sReadRejected(
            f"{rollout.resource.kind} '{rollout.name}' is paused "
            "- resume the rollout before restarting it",
            None,
        )
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = {"spec": {"template": {"metadata": {"annotations": {_RESTART_ANNOTATION: stamp}}}}}
    rollout.call("PATCH", rollout.path, body, _STRATEGIC_MERGE)
    return {"summary": rollout.summary("restarted", f"{rollout.target} restarted")}


def _status(rollout: _Rollout, params: dict[str, Any]) -> dict[str, Any]:
    """One read, no wait: kubectl's verdict and its printed sentence."""
    obj = rollout.call("GET", rollout.path, None)
    _require_reportable(obj, rollout.resource.kind, rollout.name)
    verdict, message = _VERDICTS[rollout.resource.kind](obj, rollout.name)
    return {"summary": rollout.summary(verdict, message), "status": verdict}


def _undo(rollout: _Rollout, params: dict[str, Any]) -> dict[str, Any]:
    """Find the target revision through the workload's selector and write its template back."""
    kind = rollout.resource.kind
    workload = rollout.call("GET", rollout.path, None)
    history = resolve_read_resource(rollout.client, _REVISION_KINDS[kind])
    selector = _selector(workload)
    query = {"labelSelector": selector} if selector else None
    listing = rollout.call("GET", resource_path(history, rollout.namespace, None, query), None)
    revisions = _revisions(kind, workload, listing)
    target = _target_revision(params, revisions, rollout)
    body = _rollback_body(kind, revisions[target])
    rollout.call("PATCH", rollout.path, body, _STRATEGIC_MERGE)
    return {"summary": rollout.summary("rolled back", f"{rollout.target} rolled back")}


_OPERATIONS: dict[str, Callable[[_Rollout, dict[str, Any]], dict[str, Any]]] = {
    "restart": _restart,
    "status": _status,
    "undo": _undo,
}


def _failed(
    params: dict[str, Any], message: str, reason: str | None, log: Callable[[str, str], None]
) -> dict[str, Any]:
    """The result envelope of a recorded rollout failure; raises under on_error=fail."""
    outputs = block_failure(params, _empty_outputs(params), message, reason, log, action="Rollout")
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Resolve the workload, run the chosen operation, return the Summary."""
    k8s_context = require_context(params)
    client = K8sClient(
        k8s_context, params.get("timeout", DEFAULT_TIMEOUT), **client_options(params)
    )
    operation = params.get("operation", "restart")
    name = str(params["name"]).strip()
    try:
        resource = resolve_read_resource(client, str(params["kind"]).strip())
        rollout = _Rollout(
            client, resource, resolve_namespace(params, k8s_context), name, _VERBS[operation]
        )
        outputs = _OPERATIONS[operation](rollout, params)
    except K8sReadRejected as exc:
        return _failed(params, exc.message, exc.reason, log)
    log("INFO", f"Rollout {operation} on {rollout.target}")
    return {"__wave_type": "result", "outputs": block_success(outputs), "secrets": []}
