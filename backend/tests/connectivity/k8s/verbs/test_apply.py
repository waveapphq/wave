"""K8s Apply verb tests (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

apply.run is the sync core behind the K8s Apply block: it builds the objects a
short form or a hand-typed manifest describes, resolves each kind through live
discovery, and writes them in order with a server-side apply patch or a create.
It hands back the wire envelope whose 'summary' output is a table envelope,
whose 'result' follows the chosen output format, and whose secrets list carries
every Secret value written or echoed back, plaintext and base64 alike.
"""

import base64
import inspect
import json
import urllib.parse
from typing import Any

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    NAMESPACE,
    SERVER,
    UNREADABLE_BODY_MESSAGE,
    DeniedDiscoveryClient,
    FakeK8sClient,
    RecordingLog,
    block_params,
    exact,
    patch_verb_client,
    resource,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.connectivity.k8s.verbs import apply
from wavecore.core.remote_exec.materialize import materialize
from wavecore.core.table import Table
from wavecore.plugins.k8s_apply import K8sApplyPlugin

APPLY_PATCH_CONTENT_TYPE = "application/apply-patch+yaml"

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_MANIFEST_KIND_MESSAGE = "Parameter 'manifest' must include 'apiVersion' and 'kind'"
_MANIFEST_NAME_MESSAGE = "Parameter 'manifest' must include 'metadata.name'"
_TIMED_OUT_MESSAGE = "Kubernetes API request PATCH /api/v1/configmaps timed out after 30 seconds"
_TRUNCATED_MESSAGE = "Kubernetes API response ended before the body was complete"

_CONFIGMAP_COLLECTION = "/api/v1/namespaces/apps/configmaps"
_JOB_COLLECTION = "/apis/batch/v1/namespaces/apps/jobs"
_CRD_COLLECTION = "/apis/apiextensions.k8s.io/v1/customresourcedefinitions"
_APPLY_QUERY = {"fieldManager": ["wave"], "force": ["true"]}
_CREATE_QUERY = {"fieldManager": ["wave"], "fieldValidation": ["Strict"]}

_SUMMARY_COLUMNS = [{"name": "RESOURCE", "type": "string"}, {"name": "OUTCOME", "type": "string"}]

_CONFIGMAPS = {"ConfigMap": resource("ConfigMap", "configmaps")}
_SECRETS = {"Secret": resource("Secret", "secrets")}
_JOBS = {"Job": resource("Job", "jobs", group_version="batch/v1")}
_WIDGETS = {"Widget": resource("Widget", "widgets", group_version="example.com/v1beta1")}
_CRDS = {
    "CustomResourceDefinition": resource(
        "CustomResourceDefinition",
        "customresourcedefinitions",
        namespaced=False,
        group_version="apiextensions.k8s.io/v1",
    )
}
_JOBS_AND_CRONJOBS = {
    **_JOBS,
    "CronJob": resource("CronJob", "cronjobs", group_version="batch/v1"),
}

_CRONJOB_TEMPLATE_SPEC: dict[str, Any] = {
    "template": {
        "spec": {
            "containers": [{"name": "worker", "image": "busybox:1.36"}],
            "restartPolicy": "Never",
        }
    },
    "backoffLimit": 4,
}
_CRONJOB = {
    "apiVersion": "batch/v1",
    "kind": "CronJob",
    "metadata": {"name": "nightly", "namespace": NAMESPACE},
    "spec": {"schedule": "0 2 * * *", "jobTemplate": {"spec": _CRONJOB_TEMPLATE_SPEC}},
}
_CRONJOB_WITHOUT_TEMPLATE = {
    "apiVersion": "batch/v1",
    "kind": "CronJob",
    "metadata": {"name": "nightly", "namespace": NAMESPACE},
    "spec": {"schedule": "0 2 * * *"},
}

_TYPED_PATCH_DETAIL = ".data.count: expected string, got &value.valueUnstructured{Value:3}"
_TYPED_PATCH_MESSAGE = (
    "failed to create typed patch object "
    f"(apps/probe-a; /v1, Kind=ConfigMap): {_TYPED_PATCH_DETAIL}"
)
_UNMARKED_PATCH_MESSAGE = "failed to create typed patch object for apps/probe-a"
_FORBIDDEN_DETAIL = 'configmaps is forbidden: user cannot patch resource "configmaps"'
_UNAVAILABLE_DETAIL = "the server is currently unable to handle the request"
_STRICT_DETAIL = (
    'ConfigMap in version "v1" cannot be handled as a ConfigMap: '
    'strict decoding error: unknown field "bogusTopLevel"'
)
_CONFLICT_DETAIL = "Operation cannot be fulfilled on configmaps: the object has been modified"
_DISCOVERY_FORBIDDEN = 'forbidden: User "wave" cannot get path "/api/v1"'


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _document(name: str, count: str = "3") -> dict[str, Any]:
    """The ConfigMap object one manifest document describes."""
    return {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {"name": name},
        "data": {"count": count},
    }


def _manifest_text(*documents: dict[str, Any]) -> str:
    """The canonical JSON text the engine hands the verb: one object, or an array."""
    if len(documents) == 1:
        return json.dumps(documents[0])
    return json.dumps(list(documents))


_MANIFEST_ONE = _manifest_text(_document("probe-a"))
_MANIFEST_TWO = _manifest_text(_document("probe-a"), _document("probe-b"))
_MANIFEST_THREE = _manifest_text(_document("probe-a"), _document("probe-b"), _document("probe-c"))


def _applied(name: str, namespace: str = NAMESPACE) -> dict[str, Any]:
    """The ConfigMap the cluster answers an apply with."""
    return {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {"name": name, "namespace": namespace, "resourceVersion": "42"},
        "data": {"count": "3"},
    }


def _crd_document() -> dict[str, Any]:
    """A cluster-scoped document that names a namespace it must never be given."""
    return {
        "apiVersion": "apiextensions.k8s.io/v1",
        "kind": "CustomResourceDefinition",
        "metadata": {"name": "widgets.example.com", "namespace": "ignored"},
        "spec": {"group": "example.com"},
    }


def _crd_applied() -> dict[str, Any]:
    return {
        "apiVersion": "apiextensions.k8s.io/v1",
        "kind": "CustomResourceDefinition",
        "metadata": {"name": "widgets.example.com"},
    }


def _applied_secret(data: dict[str, str] | None = None) -> dict[str, Any]:
    """The Secret the cluster answers with: every value base64-encoded into 'data'."""
    answer: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": "db", "namespace": NAMESPACE},
        "type": "Opaque",
    }
    if data is not None:
        answer["data"] = data
    return answer


def _applied_job() -> dict[str, Any]:
    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {"name": "probe", "namespace": NAMESPACE},
        "spec": _CRONJOB_TEMPLATE_SPEC,
    }


def _failure(
    reason: str, message: str, code: int, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
    }
    if details is not None:
        body["details"] = details
    return body


def _split(path: str) -> tuple[str, dict[str, list[str]]]:
    base, _, query = path.partition("?")
    return base, urllib.parse.parse_qs(query)


def _summary(*rows: list[Any]) -> dict[str, Any]:
    """The table envelope the summary output carries."""
    return {"__wave_type": "table", "columns": _SUMMARY_COLUMNS, "rows": [list(r) for r in rows]}


def _manifest_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"define_with": "manifest", "manifest": _MANIFEST_ONE}
    params.update(overrides)
    return block_params(**params)


def _form_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "define_with": "form",
        "kind": "ConfigMap",
        "name": "probe-a",
        "data": {"count": "3"},
    }
    params.update(overrides)
    return block_params(**params)


def _secret_params(**overrides: Any) -> dict[str, Any]:
    """The Secret form. Its values ride 'secret_data'; the ConfigMap 'data' row stays filled
    so every Secret test also proves the Secret form never reads it."""
    params: dict[str, Any] = {
        "kind": "Secret",
        "name": "db",
        "secret_data": {"password": "s3cr3t"},
    }
    params.update(overrides)
    return _form_params(**params)


def _job_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "define_with": "form",
        "kind": "Job",
        "name": "probe",
        "job_from": "image",
        "image": "busybox:1.36",
    }
    params.update(overrides)
    return block_params(**params)


def _cronjob_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "kind": "Job",
        "name": "probe",
        "job_from": "cronjob",
        "cronjob_name": "nightly",
    }
    params.update(overrides)
    return _form_params(**params)


def _serving(*responses: Any, resources: dict[str, Any] | None = None) -> FakeK8sClient:
    """A fake core scripted with exactly one answer per expected request."""
    return FakeK8sClient(
        responses=list(responses), resources=_CONFIGMAPS if resources is None else resources
    )


def _run(fake: FakeK8sClient, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    with patch_verb_client("apply", fake):
        envelope: dict[str, Any] = apply.run(params, log if log is not None else RecordingLog())
    return envelope


def _outputs(fake: FakeK8sClient, params: dict[str, Any], log: Any = None) -> dict[str, Any]:
    outputs: dict[str, Any] = _run(fake, params, log)["outputs"]
    return outputs


def _writes(fake: FakeK8sClient) -> list[Any]:
    return [entry for entry in fake.calls if entry.method in ("PATCH", "POST")]


def _body(fake: FakeK8sClient) -> dict[str, Any]:
    body: dict[str, Any] = fake.last.body or {}
    return body


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
        assert inspect.iscoroutinefunction(apply.run) is False

    def test_run_is_a_plain_module_level_function(self) -> None:
        assert inspect.isfunction(apply.run) is True

    def test_run_takes_the_parameters_and_the_log_callable(self) -> None:
        assert list(inspect.signature(apply.run).parameters) == ["params", "log"]

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(_serving((201, _applied("probe-a"))), _manifest_params())

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_a_happy_apply_returns_exactly_the_declared_outputs(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _manifest_params())

        assert set(outputs) == {
            "summary",
            "result",
            "names",
            "count",
            "success",
            "error",
            "reason",
        }

    def test_every_output_is_one_the_block_declares(self) -> None:
        declared = {output["name"] for output in K8sApplyPlugin().metadata["output_schema"]}

        outputs = _outputs(_serving((201, _applied("probe-a"))), _manifest_params())

        assert set(outputs) == declared

    def test_a_happy_apply_carries_the_full_output_core(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _manifest_params())

        assert outputs["success"] is True
        assert outputs["error"] == ""
        assert outputs["reason"] == ""

    def test_a_happy_apply_carries_no_secrets(self) -> None:
        envelope = _run(_serving((201, _applied("probe-a"))), _manifest_params())

        assert envelope["secrets"] == []

    def test_the_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(_serving((201, _applied("probe-a"))), _manifest_params())

        assert json.loads(json.dumps(envelope)) == envelope


class TestClientConstruction:
    """One client, built from the session before any request goes out."""

    def test_the_client_receives_the_session_context_and_the_timeout(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params(timeout=45))
        context, timeout, _ = _construction(fake)

        assert context.server == SERVER
        assert context.token == "sa-tok"
        assert context.namespace == NAMESPACE
        assert timeout == 45

    def test_the_client_timeout_defaults_to_thirty(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert _construction(fake)[1] == 30

    def test_impersonation_reaches_the_client_as_a_user_and_a_group_list(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params(impersonate_user="dev", impersonate_groups="qa, ops"))
        _, _, extra = _construction(fake)

        assert extra["impersonate_user"] == "dev"
        assert extra["impersonate_groups"] == ["qa", "ops"]

    def test_no_impersonation_is_handed_over_when_none_is_configured(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())
        _, _, extra = _construction(fake)

        assert extra["impersonate_user"] is None
        assert extra["impersonate_groups"] is None

    def test_one_client_serves_every_document_of_a_manifest(self) -> None:
        fake = _serving((201, _applied("probe-a")), (201, _applied("probe-b")))

        _run(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert fake.factory.call_count == 1


class TestApplyPatch:
    """if_exists=update brings the object to match with a server-side apply patch."""

    def test_the_object_is_applied_with_a_patch(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert fake.last.method == "PATCH"
        assert len(fake.calls) == 1

    def test_the_patch_carries_the_server_side_apply_media_type(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert fake.last.content_type == APPLY_PATCH_CONTENT_TYPE

    def test_the_patch_names_wave_as_the_field_manager_and_forces_ownership(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert _split(fake.last.path) == (f"{_CONFIGMAP_COLLECTION}/probe-a", _APPLY_QUERY)

    def test_the_patch_body_is_the_document_as_typed(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert fake.last.body == _document("probe-a")

    def test_the_patch_body_keeps_the_documents_own_key_order(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert list(_body(fake)) == ["apiVersion", "kind", "metadata", "data"]

    def test_the_kind_is_discovered_from_the_document(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert fake.discoveries == ["ConfigMap"]

    def test_a_one_document_manifest_still_comes_back_as_a_list(self) -> None:
        outputs = _outputs(_serving((200, _applied("probe-a"))), _manifest_params())

        assert outputs["result"] == [_applied("probe-a")]
        assert isinstance(outputs["result"], list)

    def test_names_and_count_describe_the_applied_object(self) -> None:
        outputs = _outputs(_serving((200, _applied("probe-a"))), _manifest_params())

        assert outputs["names"] == ["probe-a"]
        assert outputs["count"] == 1

    def test_re_applying_the_same_document_sends_the_same_request(self) -> None:
        first = _serving((201, _applied("probe-a")))
        second = _serving((200, _applied("probe-a")))

        _run(first, _manifest_params())
        _run(second, _manifest_params())

        assert first.last.path == second.last.path
        assert first.last.body == second.last.body
        assert first.last.content_type == second.last.content_type

    def test_a_re_apply_is_a_success_carrying_the_object_the_cluster_returned(self) -> None:
        outputs = _outputs(_serving((200, _applied("probe-a"))), _manifest_params())

        assert outputs["success"] is True
        assert outputs["result"] == [_applied("probe-a")]
        assert outputs["count"] == 1


class TestNamespaceTargeting:
    """Which namespace a write lands in, and how it reaches the path."""

    def test_the_session_namespace_is_used_when_none_is_given(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert _split(fake.last.path)[0] == f"/api/v1/namespaces/{NAMESPACE}/configmaps/probe-a"

    def test_a_given_namespace_beats_the_session_default(self) -> None:
        fake = _serving((200, _applied("probe-a", "ops")))

        _run(fake, _manifest_params(namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/ops/configmaps/probe-a"

    def test_a_document_that_names_its_own_namespace_wins(self) -> None:
        document = _document("probe-a")
        document["metadata"]["namespace"] = "own"
        fake = _serving((200, _applied("probe-a", "own")))

        _run(fake, _manifest_params(manifest=_manifest_text(document), namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/own/configmaps/probe-a"

    def test_a_blank_namespace_on_the_document_falls_through_to_the_parameter(self) -> None:
        document = _document("probe-a")
        document["metadata"]["namespace"] = "   "
        fake = _serving((200, _applied("probe-a", "ops")))

        _run(fake, _manifest_params(manifest=_manifest_text(document), namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/ops/configmaps/probe-a"

    def test_the_documents_namespace_is_stripped_before_it_reaches_the_path(self) -> None:
        document = _document("probe-a")
        document["metadata"]["namespace"] = "  own  "
        fake = _serving((200, _applied("probe-a", "own")))

        _run(fake, _manifest_params(manifest=_manifest_text(document)))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/own/configmaps/probe-a"

    def test_a_cluster_scoped_kind_never_carries_a_namespace_segment(self) -> None:
        fake = _serving((201, _crd_applied()), resources=_CRDS)

        _run(fake, _manifest_params(manifest=_manifest_text(_crd_document()), namespace="ops"))

        assert _split(fake.last.path)[0] == f"{_CRD_COLLECTION}/widgets.example.com"

    def test_a_cluster_scoped_failure_carries_no_namespace_clause(self) -> None:
        body = _failure("NotFound", 'customresourcedefinitions "w" not found', 404)
        fake = _serving((404, body), resources=_CRDS)
        message = "K8s CustomResourceDefinition 'widgets.example.com' not found"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _manifest_params(manifest=_manifest_text(_crd_document())))

    def test_the_name_and_the_namespace_reach_the_wire_percent_encoded(self) -> None:
        fake = _serving((200, _applied("probe a/b")))

        _run(
            fake,
            _manifest_params(manifest=_manifest_text(_document("probe a/b")), namespace="my ns"),
        )

        assert _split(fake.last.path)[0] == ("/api/v1/namespaces/my%20ns/configmaps/probe%20a%2Fb")


class TestApiVersionRouting:
    """The document's own apiVersion resolves the write, the way kubectl apply does."""

    def test_the_documents_api_version_reaches_the_lookup(self) -> None:
        fake = _serving((200, _applied("probe-a")))

        _run(fake, _manifest_params())

        assert fake.discovery_calls == [("ConfigMap", "v1")]

    def test_a_document_rides_the_path_root_of_the_version_it_names(self) -> None:
        document = {
            "apiVersion": "example.com/v1beta1",
            "kind": "Widget",
            "metadata": {"name": "w1"},
        }
        applied = {**document, "metadata": {"name": "w1", "namespace": NAMESPACE}}
        fake = _serving((200, applied), resources=_WIDGETS)

        _run(fake, _manifest_params(manifest=_manifest_text(document)))

        assert fake.discovery_calls == [("Widget", "example.com/v1beta1")]
        assert _split(fake.last.path)[0] == "/apis/example.com/v1beta1/namespaces/apps/widgets/w1"

    def test_each_document_resolves_with_the_version_it_names(self) -> None:
        job = {"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": "probe"}}
        applied_job = {**job, "metadata": {"name": "probe", "namespace": NAMESPACE}}
        fake = _serving(
            (200, _applied("probe-a")),
            (201, applied_job),
            resources={**_CONFIGMAPS, **_JOBS},
        )

        _run(fake, _manifest_params(manifest=_manifest_text(_document("probe-a"), job)))

        assert fake.discovery_calls == [("ConfigMap", "v1"), ("Job", "batch/v1")]

    def test_the_form_resolves_the_version_it_synthesizes(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        _run(fake, _form_params())

        assert fake.discovery_calls == [("ConfigMap", "v1")]

    def test_the_job_form_resolves_the_batch_version(self) -> None:
        fake = _serving((201, _applied_job()), resources=_JOBS)

        _run(fake, _job_params())

        assert fake.discovery_calls == [("Job", "batch/v1")]

    def test_the_cronjob_template_read_names_no_version(self) -> None:
        fake = _serving((200, _CRONJOB), (201, _applied_job()), resources=_JOBS_AND_CRONJOBS)

        _run(fake, _cronjob_params())

        assert fake.discovery_calls == [("CronJob", None), ("Job", "batch/v1")]


class TestIfExistsFail:
    """if_exists=fail creates the object and surfaces the cluster's own already-exists row."""

    def test_the_object_is_created_with_a_post_to_the_collection(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        _run(fake, _manifest_params(if_exists="fail"))

        assert fake.last.method == "POST"
        assert _split(fake.last.path)[0] == _CONFIGMAP_COLLECTION

    def test_the_create_asks_the_cluster_for_strict_field_validation(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        _run(fake, _manifest_params(if_exists="fail"))

        assert _split(fake.last.path) == (_CONFIGMAP_COLLECTION, _CREATE_QUERY)

    def test_the_post_carries_the_default_content_type(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        _run(fake, _manifest_params(if_exists="fail"))

        assert fake.last.content_type is None

    def test_the_post_body_is_the_document_as_typed(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        _run(fake, _manifest_params(if_exists="fail"))

        assert fake.last.body == _document("probe-a")

    def test_no_patch_is_ever_sent_in_fail_mode(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        _run(fake, _manifest_params(if_exists="fail"))

        assert [entry.method for entry in _writes(fake)] == ["POST"]

    def test_a_created_object_comes_back_in_result(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _manifest_params(if_exists="fail"))

        assert outputs["result"] == [_applied("probe-a")]
        assert outputs["success"] is True

    def test_an_existing_object_surfaces_the_already_exists_row(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409)
        message = "K8s ConfigMap 'probe-a' already exists in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving((409, body)), _manifest_params(if_exists="fail"))

    def test_the_already_exists_row_is_chosen_on_the_body_reason_not_the_status(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 500)
        message = "K8s ConfigMap 'probe-a' already exists in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving((500, body)), _manifest_params(if_exists="fail"))

    def test_an_existing_object_is_recordable_with_its_reason(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409)
        params = _manifest_params(if_exists="fail", on_error="record")

        outputs = _outputs(_serving((409, body)), params)

        assert outputs["success"] is False
        assert outputs["reason"] == "AlreadyExists"
        assert outputs["error"] == "K8s ConfigMap 'probe-a' already exists in namespace 'apps'"

    def test_a_recorded_already_exists_leaves_the_unique_outputs_empty(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409)
        params = _manifest_params(if_exists="fail", on_error="record")

        outputs = _outputs(_serving((409, body)), params)

        assert outputs["result"] == []
        assert outputs["names"] == []
        assert outputs["count"] == 0
        assert outputs["summary"] == _summary()

    def test_a_recorded_already_exists_names_the_apply_action(self) -> None:
        body = _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409)
        params = _manifest_params(if_exists="fail", on_error="record")
        log = RecordingLog()

        _run(_serving((409, body)), params, log=log)

        assert log.entries == [
            (
                "WARN",
                "Apply failed (AlreadyExists): K8s ConfigMap 'probe-a' already exists "
                "in namespace 'apps'",
            )
        ]

    def test_an_unknown_field_is_rejected_rather_than_dropped(self) -> None:
        body = _failure("BadRequest", _STRICT_DETAIL, 400)
        message = (
            f"Kubernetes could not apply ConfigMap 'probe-a' in namespace 'apps': {_STRICT_DETAIL}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving((400, body)), _manifest_params(if_exists="fail"))


class TestMultiDocumentManifest:
    """Several documents apply in order and never roll back."""

    @staticmethod
    def _two() -> FakeK8sClient:
        return _serving((201, _applied("probe-a")), (201, _applied("probe-b")))

    @staticmethod
    def _stopped() -> FakeK8sClient:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        return _serving((201, _applied("probe-a")), (403, body))

    def test_every_document_is_applied_in_the_order_it_was_typed(self) -> None:
        fake = self._two()

        _run(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert [_split(entry.path)[0] for entry in _writes(fake)] == [
            f"{_CONFIGMAP_COLLECTION}/probe-a",
            f"{_CONFIGMAP_COLLECTION}/probe-b",
        ]

    def test_result_carries_one_entry_per_document(self) -> None:
        outputs = _outputs(self._two(), _manifest_params(manifest=_MANIFEST_TWO))

        assert outputs["result"] == [_applied("probe-a"), _applied("probe-b")]

    def test_names_and_count_describe_every_document(self) -> None:
        outputs = _outputs(self._two(), _manifest_params(manifest=_MANIFEST_TWO))

        assert outputs["names"] == ["probe-a", "probe-b"]
        assert outputs["count"] == 2

    def test_the_summary_carries_a_row_per_document(self) -> None:
        fake = _serving((201, _applied("probe-a")), (200, _applied("probe-b")))

        outputs = _outputs(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert outputs["summary"] == _summary(
            ["configmap/probe-a", "created"], ["configmap/probe-b", "configured"]
        )

    def test_a_failure_at_the_second_document_fails_the_block_by_default(self) -> None:
        message = "Kubernetes API permission denied: configmaps is forbidden"

        with pytest.raises(ValueError, match=exact(message)):
            _run(self._stopped(), _manifest_params(manifest=_MANIFEST_THREE))

    def test_a_failure_at_the_second_document_stops_before_the_third(self) -> None:
        fake = self._stopped()

        with pytest.raises(ValueError):
            _run(fake, _manifest_params(manifest=_MANIFEST_THREE))

        assert [_split(entry.path)[0] for entry in _writes(fake)] == [
            f"{_CONFIGMAP_COLLECTION}/probe-a",
            f"{_CONFIGMAP_COLLECTION}/probe-b",
        ]

    def test_a_failure_at_the_second_document_never_undoes_the_first(self) -> None:
        fake = self._stopped()

        with pytest.raises(ValueError):
            _run(fake, _manifest_params(manifest=_MANIFEST_THREE))

        assert [entry for entry in fake.calls if entry.method == "DELETE"] == []

    def test_a_recorded_failure_reports_how_many_documents_landed(self) -> None:
        params = _manifest_params(manifest=_MANIFEST_THREE, on_error="record")

        outputs = _outputs(self._stopped(), params)

        assert outputs["count"] == 1
        assert outputs["names"] == ["probe-a"]
        assert outputs["result"] == [_applied("probe-a")]

    def test_a_recorded_failure_summarizes_only_what_landed(self) -> None:
        params = _manifest_params(manifest=_MANIFEST_THREE, on_error="record")

        outputs = _outputs(self._stopped(), params)

        assert outputs["summary"] == _summary(["configmap/probe-a", "created"])
        assert outputs["success"] is False
        assert outputs["reason"] == "Forbidden"

    def test_a_failure_at_the_first_document_leaves_the_unique_outputs_empty(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        params = _manifest_params(manifest=_MANIFEST_TWO, on_error="record")

        outputs = _outputs(_serving((403, body)), params)

        assert outputs["result"] == []
        assert outputs["names"] == []
        assert outputs["count"] == 0
        assert outputs["summary"] == _summary()

    def test_an_empty_manifest_is_refused_before_anything_is_written(self) -> None:
        fake = _serving()
        log = RecordingLog()

        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            _run(fake, _manifest_params(manifest="[]"), log=log)

        assert fake.calls == []
        assert log.entries == []


class TestFormConfigMap:
    """The ConfigMap form builds the object a manifest would have described."""

    def test_the_form_sends_what_the_manifest_path_sends(self) -> None:
        form = _serving((201, _applied("probe-a")))
        typed = _serving((201, _applied("probe-a")))

        _run(form, _form_params())
        _run(typed, _manifest_params())

        assert form.last.body == typed.last.body
        assert form.last.path == typed.last.path
        assert form.last.content_type == typed.last.content_type

    def test_the_form_result_is_the_applied_object_itself(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _form_params())

        assert outputs["result"] == _applied("probe-a")
        assert isinstance(outputs["result"], dict)

    def test_names_and_count_describe_the_one_object(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _form_params())

        assert outputs["names"] == ["probe-a"]
        assert outputs["count"] == 1

    def test_an_empty_data_map_still_applies_the_object(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        outputs = _outputs(fake, _form_params(data={}))

        assert outputs["success"] is True
        assert _body(fake)["data"] == {}

    def test_a_form_with_no_data_row_writes_an_empty_map(self) -> None:
        fake = _serving((201, _applied("probe-a")))
        params = block_params(define_with="form", kind="ConfigMap", name="probe-a")

        _run(fake, params)

        assert _body(fake)["data"] == {}

    def test_the_secret_data_row_never_reaches_a_config_map(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        _run(fake, _form_params(secret_data={"password": "s3cr3t"}))

        assert _body(fake)["data"] == {"count": "3"}
        assert "s3cr3t" not in json.dumps(fake.last.body)

    def test_the_form_targets_a_specified_namespace(self) -> None:
        fake = _serving((201, _applied("probe-a", "ops")))

        _run(fake, _form_params(namespace="ops"))

        assert _split(fake.last.path)[0] == "/api/v1/namespaces/ops/configmaps/probe-a"

    def test_a_form_with_no_kind_row_builds_a_config_map(self) -> None:
        fake = _serving((201, _applied("probe-a")))
        params = block_params(define_with="form", name="probe-a", data={"count": "3"})

        _run(fake, params)

        assert _body(fake)["kind"] == "ConfigMap"
        assert _body(fake)["apiVersion"] == "v1"


class TestFormSecret:
    """The Secret form writes plaintext the cluster encodes; WAVE never base64s."""

    def test_the_values_are_written_to_string_data(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        _run(fake, _secret_params())

        assert _body(fake)["stringData"] == {"password": "s3cr3t"}

    def test_the_config_map_data_row_never_reaches_a_secret(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        _run(fake, _secret_params(data={"count": "3"}))

        assert _body(fake)["stringData"] == {"password": "s3cr3t"}
        assert "count" not in json.dumps(fake.last.body)

    def test_the_secret_never_carries_a_base64_data_field(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        _run(fake, _secret_params())

        assert "data" not in _body(fake)

    def test_no_value_is_encoded_on_the_way_out(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        _run(fake, _secret_params())

        assert _b64("s3cr3t") not in json.dumps(fake.last.body)

    @pytest.mark.parametrize(
        "secret_type", ["Opaque", "kubernetes.io/tls", "kubernetes.io/dockerconfigjson"]
    )
    def test_the_secret_type_reaches_the_wire(self, secret_type: str) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        _run(fake, _secret_params(secret_type=secret_type, secret_data={}))

        assert _body(fake)["type"] == secret_type

    def test_a_secret_with_no_type_row_carries_no_type_at_all(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        _run(fake, _secret_params())

        assert "type" not in _body(fake)

    def test_an_empty_secret_data_map_is_accepted(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        outputs = _outputs(fake, _secret_params(secret_data={}))

        assert outputs["success"] is True
        assert outputs["count"] == 1
        assert _body(fake)["stringData"] == {}

    def test_a_secret_with_no_secret_data_row_at_all_writes_an_empty_map(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        outputs = _outputs(fake, _form_params(kind="Secret", name="db"))

        assert outputs["success"] is True
        assert _body(fake)["stringData"] == {}

    def test_a_typed_secret_with_no_keys_still_reaches_the_cluster(self) -> None:
        detail = 'Secret "db" is invalid: data[tls.crt]: Required value'
        fake = _serving((422, _failure("Invalid", detail, 422)), resources=_SECRETS)
        params = _secret_params(secret_type="kubernetes.io/tls", secret_data={})

        with pytest.raises(ValueError):
            _run(fake, params)

        assert len(_writes(fake)) == 1

    def test_the_apiserver_error_is_what_a_typed_secret_surfaces(self) -> None:
        detail = 'Secret "db" is invalid: data[tls.crt]: Required value'
        fake = _serving((422, _failure("Invalid", detail, 422)), resources=_SECRETS)
        params = _secret_params(secret_type="kubernetes.io/tls", secret_data={})
        message = f"Kubernetes could not apply Secret 'db' in namespace 'apps': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, params)


class TestFormJob:
    """The Job form runs an image, or runs what a CronJob would have run."""

    @staticmethod
    def _container(fake: FakeK8sClient) -> dict[str, Any]:
        containers: list[dict[str, Any]] = _body(fake)["spec"]["template"]["spec"]["containers"]
        return containers[0]

    def test_a_job_from_an_image_runs_that_image(self) -> None:
        fake = _serving((201, _applied_job()), resources=_JOBS)

        _run(fake, _job_params())

        body = _body(fake)
        assert body["apiVersion"] == "batch/v1"
        assert body["kind"] == "Job"
        assert body["spec"]["template"]["spec"]["restartPolicy"] == "Never"
        assert self._container(fake) == {"name": "probe", "image": "busybox:1.36"}

    def test_a_job_with_no_source_row_runs_the_image(self) -> None:
        fake = _serving((201, _applied_job()), resources=_JOBS)
        params = block_params(define_with="form", kind="Job", name="probe", image="busybox:1.36")

        _run(fake, params)

        assert self._container(fake)["image"] == "busybox:1.36"

    def test_a_job_rides_the_batch_api_path(self) -> None:
        fake = _serving((201, _applied_job()), resources=_JOBS)

        _run(fake, _job_params())

        assert _split(fake.last.path) == (f"{_JOB_COLLECTION}/probe", _APPLY_QUERY)

    def test_a_quoted_argument_reaches_the_container_as_one_argument(self) -> None:
        fake = _serving((201, _applied_job()), resources=_JOBS)

        _run(fake, _job_params(command='sh -c "echo hi there"'))

        assert self._container(fake)["command"] == ["sh", "-c", "echo hi there"]

    def test_an_escaped_space_stays_inside_its_argument(self) -> None:
        fake = _serving((201, _applied_job()), resources=_JOBS)

        _run(fake, _job_params(command="echo a\\ b"))

        assert self._container(fake)["command"] == ["echo", "a b"]

    def test_an_empty_command_leaves_the_image_entrypoint_alone(self) -> None:
        fake = _serving((201, _applied_job()), resources=_JOBS)

        _run(fake, _job_params(command=""))

        assert "command" not in self._container(fake)

    def test_a_whitespace_only_command_leaves_the_image_entrypoint_alone(self) -> None:
        fake = _serving((201, _applied_job()), resources=_JOBS)

        _run(fake, _job_params(command="   \t  "))

        assert "command" not in self._container(fake)

    def test_a_job_from_a_cronjob_reads_the_named_cronjob_first(self) -> None:
        fake = _serving((200, _CRONJOB), (201, _applied_job()), resources=_JOBS_AND_CRONJOBS)

        _run(fake, _cronjob_params())

        assert fake.calls[0].method == "GET"
        assert fake.calls[0].body is None
        assert _split(fake.calls[0].path)[0] == "/apis/batch/v1/namespaces/apps/cronjobs/nightly"

    def test_a_job_from_a_cronjob_copies_the_job_template(self) -> None:
        fake = _serving((200, _CRONJOB), (201, _applied_job()), resources=_JOBS_AND_CRONJOBS)

        _run(fake, _cronjob_params())

        assert _body(fake)["spec"] == _CRONJOB_TEMPLATE_SPEC

    def test_a_job_from_a_cronjob_carries_the_form_name(self) -> None:
        fake = _serving((200, _CRONJOB), (201, _applied_job()), resources=_JOBS_AND_CRONJOBS)

        _run(fake, _cronjob_params())

        body = _body(fake)
        assert body["kind"] == "Job"
        assert body["metadata"]["name"] == "probe"
        assert _split(fake.last.path)[0] == f"{_JOB_COLLECTION}/probe"

    def test_a_job_from_a_cronjob_never_carries_a_leftover_image(self) -> None:
        fake = _serving((200, _CRONJOB), (201, _applied_job()), resources=_JOBS_AND_CRONJOBS)

        _run(fake, _cronjob_params(image="leftover:1"))

        assert "leftover:1" not in json.dumps(fake.last.body)

    def test_a_leftover_command_is_never_split_for_a_job_from_a_cronjob(self) -> None:
        fake = _serving((200, _CRONJOB), (201, _applied_job()), resources=_JOBS_AND_CRONJOBS)

        _run(fake, _cronjob_params(command='echo "unclosed'))

        assert _body(fake)["spec"] == _CRONJOB_TEMPLATE_SPEC

    def test_a_cronjob_without_a_job_template_yields_an_empty_spec(self) -> None:
        fake = _serving(
            (200, _CRONJOB_WITHOUT_TEMPLATE), (201, _applied_job()), resources=_JOBS_AND_CRONJOBS
        )

        _run(fake, _cronjob_params())

        assert _body(fake)["spec"] == {}

    def test_the_cronjob_name_is_stripped_before_it_reaches_the_path(self) -> None:
        fake = _serving((200, _CRONJOB), (201, _applied_job()), resources=_JOBS_AND_CRONJOBS)

        _run(fake, _cronjob_params(cronjob_name="  nightly  "))

        assert _split(fake.calls[0].path)[0] == "/apis/batch/v1/namespaces/apps/cronjobs/nightly"

    def test_a_missing_cronjob_surfaces_the_not_found_row(self) -> None:
        body = _failure("NotFound", 'cronjobs.batch "nightly" not found', 404)
        fake = _serving((404, body), resources=_JOBS_AND_CRONJOBS)
        message = "K8s CronJob 'nightly' not found in namespace 'apps'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _cronjob_params())

    def test_a_missing_cronjob_writes_nothing(self) -> None:
        body = _failure("NotFound", 'cronjobs.batch "nightly" not found', 404)
        fake = _serving((404, body), resources=_JOBS_AND_CRONJOBS)

        with pytest.raises(ValueError):
            _run(fake, _cronjob_params())

        assert _writes(fake) == []

    def test_a_missing_cronjob_under_record_leaves_every_output_empty(self) -> None:
        body = _failure("NotFound", 'cronjobs.batch "nightly" not found', 404)
        fake = _serving((404, body), resources=_JOBS_AND_CRONJOBS)

        outputs = _outputs(fake, _cronjob_params(on_error="record"))

        assert outputs["result"] == {}
        assert outputs["names"] == []
        assert outputs["count"] == 0
        assert outputs["summary"] == _summary()


class TestCronJobReadErrors:
    """The CronJob template read renders the shared rows against the read verb."""

    @pytest.mark.parametrize(
        ("status", "body", "message"),
        [
            (
                404,
                _failure(
                    "NotFound",
                    'namespaces "ghost" not found',
                    404,
                    {"kind": "namespaces", "name": "ghost"},
                ),
                "K8s namespace 'ghost' not found",
            ),
            (
                404,
                _failure("NotFound", 'cronjobs.batch "nightly" not found', 404),
                "K8s CronJob 'nightly' not found in namespace 'apps'",
            ),
            (
                409,
                _failure("AlreadyExists", 'cronjobs.batch "nightly" exists', 409),
                "K8s CronJob 'nightly' already exists in namespace 'apps'",
            ),
            (
                502,
                {},
                "Kubernetes could not read CronJob 'nightly' in namespace 'apps' (HTTP 502)",
            ),
            (
                401,
                _failure("Unauthorized", "Unauthorized", 401),
                "Kubernetes API authentication failed: Unauthorized",
            ),
            (
                403,
                _failure("Forbidden", "cronjobs is forbidden", 403),
                "Kubernetes API permission denied: cronjobs is forbidden",
            ),
            (
                409,
                _failure("Conflict", _CONFLICT_DETAIL, 409),
                "Kubernetes rejected the update to CronJob 'nightly' because it changed "
                f"on the cluster first: {_CONFLICT_DETAIL}",
            ),
            (
                503,
                _failure("ServiceUnavailable", _UNAVAILABLE_DETAIL, 503),
                "Kubernetes could not read CronJob 'nightly' in namespace 'apps': "
                f"{_UNAVAILABLE_DETAIL}",
            ),
        ],
        ids=[
            "namespace",
            "not-found",
            "already-exists",
            "no-message",
            "unauthorized",
            "forbidden",
            "conflict",
            "unavailable",
        ],
    )
    def test_the_cluster_answer_renders_its_read_row(
        self, status: int, body: dict[str, Any], message: str
    ) -> None:
        fake = _serving((status, body), resources=_JOBS_AND_CRONJOBS)

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _cronjob_params())

    def test_a_cluster_without_the_cronjob_kind_says_so(self) -> None:
        fake = _serving(resources=_JOBS)
        message = (
            "This cluster has no resource kind 'CronJob' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _cronjob_params())

    def test_a_denied_walk_on_the_cronjob_lookup_renders_the_permission_row(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))
        message = f"Kubernetes API permission denied: {_DISCOVERY_FORBIDDEN}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _cronjob_params())


class TestSummaryEnvelope:
    """Summary reports what the block did, as a table envelope."""

    def test_the_summary_is_the_table_envelope(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _manifest_params())

        assert outputs["summary"] == _summary(["configmap/probe-a", "created"])

    def test_the_summary_declares_exactly_the_two_columns(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _manifest_params())

        assert outputs["summary"]["columns"] == _SUMMARY_COLUMNS

    def test_a_new_object_reads_created(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _manifest_params())

        assert outputs["summary"]["rows"] == [["configmap/probe-a", "created"]]

    @pytest.mark.parametrize("status", [200, 202])
    def test_any_other_accepted_answer_reads_configured(self, status: int) -> None:
        outputs = _outputs(_serving((status, _applied("probe-a"))), _manifest_params())

        assert outputs["summary"]["rows"] == [["configmap/probe-a", "configured"]]

    @pytest.mark.parametrize("status", [200, 201, 202])
    def test_the_outcome_is_never_unchanged(self, status: int) -> None:
        outputs = _outputs(_serving((status, _applied("probe-a"))), _manifest_params())

        assert outputs["summary"]["rows"][0][1] in ("created", "configured")

    def test_a_core_group_resource_carries_no_group(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _form_params())

        assert outputs["summary"]["rows"][0][0] == "configmap/probe-a"

    def test_a_grouped_resource_carries_its_group(self) -> None:
        applied = {
            "apiVersion": "batch/v1",
            "kind": "Job",
            "metadata": {"name": "probe", "namespace": NAMESPACE},
        }
        outputs = _outputs(_serving((201, applied), resources=_JOBS), _job_params())

        assert outputs["summary"]["rows"][0][0] == "job.batch/probe"

    def test_a_dotted_group_is_carried_whole(self) -> None:
        fake = _serving((201, _crd_applied()), resources=_CRDS)

        outputs = _outputs(fake, _manifest_params(manifest=_manifest_text(_crd_document())))

        assert outputs["summary"]["rows"][0][0] == (
            "customresourcedefinition.apiextensions.k8s.io/widgets.example.com"
        )

    def test_the_resource_cell_names_the_object_the_cluster_answered_with(self) -> None:
        fake = _serving((201, _applied("probe-renamed")))

        outputs = _outputs(fake, _manifest_params())

        assert outputs["summary"]["rows"] == [["configmap/probe-renamed", "created"]]
        assert outputs["names"] == ["probe-renamed"]

    @pytest.mark.parametrize("output_format", ["map", "json", "yaml"])
    def test_the_summary_is_the_same_envelope_under_every_output_format(
        self, output_format: str
    ) -> None:
        fake = _serving((201, _applied("probe-a")))

        outputs = _outputs(fake, _manifest_params(output_format=output_format))

        assert outputs["summary"] == _summary(["configmap/probe-a", "created"])


class TestThroughMaterialize:
    """What the bridge and the remote worker make of the envelope's two wrapped values."""

    def test_the_summary_envelope_becomes_the_wave_table(self) -> None:
        envelope = _run(_serving((201, _applied("probe-a"))), _manifest_params())

        summary = materialize(envelope)["summary"]

        assert isinstance(summary, Table)
        assert summary.col_names() == ["RESOURCE", "OUTCOME"]
        assert summary.col_types() == ["string", "string"]
        assert [row.to_list() for row in summary] == [["configmap/probe-a", "created"]]

    def test_the_form_yaml_envelope_renders_the_object_with_sorted_keys(self) -> None:
        params = _form_params(output_format="yaml")

        envelope = _run(_serving((201, _applied("probe-a"))), params)

        assert materialize(envelope)["result"] == (
            "apiVersion: v1\n"
            "data:\n"
            "  count: '3'\n"
            "kind: ConfigMap\n"
            "metadata:\n"
            "  name: probe-a\n"
            "  namespace: apps\n"
            "  resourceVersion: '42'\n"
        )

    def test_the_manifest_yaml_envelope_renders_one_sequence_not_a_document_stream(self) -> None:
        params = _manifest_params(output_format="yaml")

        envelope = _run(_serving((201, _applied("probe-a"))), params)
        rendered = materialize(envelope)["result"]

        assert rendered.startswith("- apiVersion: v1\n")
        assert "---" not in rendered

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_an_empty_apply_renders_empty_text(self, output_format: str) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        params = _manifest_params(on_error="record", output_format=output_format)

        envelope = _run(_serving((403, body)), params)

        assert materialize(envelope)["result"] == ""


class TestOutputFormats:
    """Output Format shapes Result and nothing else."""

    def test_map_in_form_mode_is_the_applied_object(self) -> None:
        outputs = _outputs(_serving((201, _applied("probe-a"))), _form_params(output_format="map"))

        assert outputs["result"] == _applied("probe-a")

    def test_map_in_manifest_mode_is_a_list(self) -> None:
        fake = _serving((201, _applied("probe-a")), (201, _applied("probe-b")))

        outputs = _outputs(fake, _manifest_params(manifest=_MANIFEST_TWO))

        assert outputs["result"] == [_applied("probe-a"), _applied("probe-b")]

    def test_json_in_form_mode_is_the_object_as_text(self) -> None:
        params = _form_params(output_format="json")

        outputs = _outputs(_serving((201, _applied("probe-a"))), params)

        assert outputs["result"] == json.dumps(_applied("probe-a"))
        assert json.loads(outputs["result"]) == _applied("probe-a")

    def test_json_in_manifest_mode_is_the_list_as_text(self) -> None:
        fake = _serving((201, _applied("probe-a")), (201, _applied("probe-b")))
        params = _manifest_params(manifest=_MANIFEST_TWO, output_format="json")

        outputs = _outputs(fake, params)

        assert outputs["result"] == json.dumps([_applied("probe-a"), _applied("probe-b")])

    def test_yaml_in_form_mode_is_the_yaml_envelope_over_the_object(self) -> None:
        params = _form_params(output_format="yaml")

        outputs = _outputs(_serving((201, _applied("probe-a"))), params)

        assert outputs["result"] == {"__wave_type": "yaml", "value": _applied("probe-a")}

    def test_yaml_in_manifest_mode_is_the_yaml_envelope_over_the_list(self) -> None:
        fake = _serving((201, _applied("probe-a")), (201, _applied("probe-b")))
        params = _manifest_params(manifest=_MANIFEST_TWO, output_format="yaml")

        outputs = _outputs(fake, params)

        assert outputs["result"] == {
            "__wave_type": "yaml",
            "value": [_applied("probe-a"), _applied("probe-b")],
        }

    def test_the_yaml_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        params = _manifest_params(output_format="yaml")

        envelope = _run(_serving((201, _applied("probe-a"))), params)

        assert json.loads(json.dumps(envelope)) == envelope

    def test_an_empty_apply_is_empty_text_under_json(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        params = _manifest_params(on_error="record", output_format="json")

        outputs = _outputs(_serving((403, body)), params)

        assert outputs["result"] == ""

    def test_an_empty_apply_is_an_empty_list_in_listed_map_mode(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)

        outputs = _outputs(_serving((403, body)), _manifest_params(on_error="record"))

        assert outputs["result"] == []

    def test_an_empty_apply_is_an_empty_map_in_form_map_mode(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)

        outputs = _outputs(_serving((403, body)), _form_params(on_error="record"))

        assert outputs["result"] == {}

    @pytest.mark.parametrize("output_format", ["map", "json", "yaml"])
    def test_the_output_format_never_changes_what_goes_on_the_wire(
        self, output_format: str
    ) -> None:
        fake = _serving((201, _applied("probe-a")))

        _run(fake, _manifest_params(output_format=output_format))

        assert fake.last.method == "PATCH"
        assert fake.last.content_type == APPLY_PATCH_CONTENT_TYPE
        assert fake.last.body == _document("probe-a")
        assert _split(fake.last.path) == (f"{_CONFIGMAP_COLLECTION}/probe-a", _APPLY_QUERY)

    @pytest.mark.parametrize("output_format", ["map", "json", "yaml"])
    def test_names_and_count_read_the_same_in_every_format(self, output_format: str) -> None:
        outputs = _outputs(
            _serving((201, _applied("probe-a"))), _manifest_params(output_format=output_format)
        )

        assert outputs["names"] == ["probe-a"]
        assert outputs["count"] == 1

    def test_a_manifest_run_without_a_define_with_row_is_listed(self) -> None:
        params = block_params(manifest=_MANIFEST_ONE)

        outputs = _outputs(_serving((201, _applied("probe-a"))), params)

        assert outputs["result"] == [_applied("probe-a")]

    def test_any_define_with_value_other_than_form_is_listed_manifest_mode(self) -> None:
        params = _manifest_params(define_with="whatever-else")

        outputs = _outputs(_serving((201, _applied("probe-a"))), params)

        assert outputs["result"] == [_applied("probe-a")]


class TestSecrets:
    """Every value written to or echoed back by a Secret rides the envelope."""

    def test_a_form_secret_carries_its_plaintext_and_its_base64(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        envelope = _run(fake, _secret_params())

        assert set(envelope["secrets"]) == {"s3cr3t", _b64("s3cr3t")}

    def test_every_typed_value_carries_both_forms(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)
        params = _secret_params(secret_data={"password": "s3cr3t", "user": "admin"})

        envelope = _run(fake, params)

        assert set(envelope["secrets"]) == {
            "s3cr3t",
            _b64("s3cr3t"),
            "admin",
            _b64("admin"),
        }

    def test_a_manifest_secret_carries_its_string_data_in_both_forms(self) -> None:
        document = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db"},
            "stringData": {"password": "s3cr3t"},
        }
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        envelope = _run(fake, _manifest_params(manifest=_manifest_text(document)))

        assert set(envelope["secrets"]) == {"s3cr3t", _b64("s3cr3t")}

    def test_a_manifest_secret_carries_encoded_data_in_both_forms(self) -> None:
        document = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db"},
            "data": {"password": _b64("s3cr3t")},
        }
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        envelope = _run(fake, _manifest_params(manifest=_manifest_text(document)))

        assert set(envelope["secrets"]) == {"s3cr3t", _b64("s3cr3t")}

    def test_a_manifest_secret_carrying_both_maps_contributes_both(self) -> None:
        document = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db"},
            "stringData": {"password": "s3cr3t"},
            "data": {"token": _b64("tok")},
        }
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        envelope = _run(fake, _manifest_params(manifest=_manifest_text(document)))

        assert set(envelope["secrets"]) == {"s3cr3t", _b64("s3cr3t"), "tok", _b64("tok")}

    def test_the_value_the_cluster_encodes_back_carries_both_forms(self) -> None:
        fake = _serving((201, _applied_secret({"password": _b64("s3cr3t")})), resources=_SECRETS)

        envelope = _run(fake, _secret_params())

        assert set(envelope["secrets"]) == {"s3cr3t", _b64("s3cr3t")}

    def test_a_returned_value_the_form_never_typed_still_carries(self) -> None:
        fake = _serving((201, _applied_secret({"password": _b64("rotated")})), resources=_SECRETS)

        envelope = _run(fake, _secret_params())

        assert set(envelope["secrets"]) == {
            "s3cr3t",
            _b64("s3cr3t"),
            "rotated",
            _b64("rotated"),
        }

    def test_every_document_of_a_manifest_carries_what_it_gets_back(self) -> None:
        first = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db"},
            "stringData": {"password": "first"},
        }
        second = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "api"},
            "stringData": {"password": "second"},
        }
        fake = _serving(
            (201, _applied_secret({"password": _b64("rotated-a")})),
            (201, _applied_secret({"password": _b64("rotated-b")})),
            resources=_SECRETS,
        )

        envelope = _run(fake, _manifest_params(manifest=_manifest_text(first, second)))

        assert set(envelope["secrets"]) == {
            "first",
            _b64("first"),
            "rotated-a",
            _b64("rotated-a"),
            "second",
            _b64("second"),
            "rotated-b",
            _b64("rotated-b"),
        }

    def test_a_value_that_is_not_base64_carries_only_the_form_it_was_given(self) -> None:
        document = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db"},
            "data": {"legacy": "not base64!"},
        }
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        envelope = _run(fake, _manifest_params(manifest=_manifest_text(document)))

        assert set(envelope["secrets"]) == {"not base64!"}

    def test_a_value_whose_bytes_are_not_text_carries_only_its_encoded_form(self) -> None:
        binary = base64.b64encode(b"\xff\xfe").decode()
        document = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "db"},
            "data": {"keystore": binary},
        }
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        envelope = _run(fake, _manifest_params(manifest=_manifest_text(document)))

        assert set(envelope["secrets"]) == {binary}

    def test_a_config_map_carries_nothing_even_with_a_filled_secret_row(self) -> None:
        fake = _serving((201, _applied("probe-a")))

        envelope = _run(fake, _form_params(secret_data={"password": "s3cr3t"}))

        assert envelope["secrets"] == []

    def test_the_gate_is_the_kind_the_request_carried(self) -> None:
        answered = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {"name": "probe-a", "namespace": NAMESPACE},
            "data": {"count": _b64("s3cr3t")},
        }
        fake = _serving((201, answered))

        envelope = _run(fake, _manifest_params())

        assert envelope["secrets"] == []

    def test_a_recorded_failure_still_carries_what_was_collected_before_the_write(self) -> None:
        body = _failure("Forbidden", "secrets is forbidden", 403)
        fake = _serving((403, body), resources=_SECRETS)

        envelope = _run(fake, _secret_params(on_error="record"))

        assert envelope["outputs"]["success"] is False
        assert set(envelope["secrets"]) == {"s3cr3t", _b64("s3cr3t")}

    def test_the_secret_applies_without_any_registry_in_sight(self) -> None:
        fake = _serving((201, _applied_secret()), resources=_SECRETS)

        outputs = _outputs(fake, _secret_params())

        assert outputs["success"] is True
        assert outputs["count"] == 1

    def test_a_secret_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        fake = _serving((201, _applied_secret({"password": _b64("s3cr3t")})), resources=_SECRETS)

        envelope = _run(fake, _secret_params())

        assert json.loads(json.dumps(envelope)) == envelope

    def test_no_line_the_verb_logs_carries_a_secret_value(self) -> None:
        fake = _serving((201, _applied_secret({"password": _b64("s3cr3t")})), resources=_SECRETS)
        log = RecordingLog()

        envelope = _run(fake, _secret_params(), log=log)

        assert log.entries == [("INFO", "Applied 1 object(s)")]
        assert not [
            message for message in log.messages for value in envelope["secrets"] if value in message
        ]

    def test_no_recorded_failure_line_carries_a_secret_value(self) -> None:
        body = _failure("Forbidden", "secrets is forbidden", 403)
        fake = _serving((403, body), resources=_SECRETS)
        log = RecordingLog()

        envelope = _run(fake, _secret_params(on_error="record"), log=log)

        assert log.entries == [
            (
                "WARN",
                "Apply failed (Forbidden): Kubernetes API permission denied: "
                "secrets is forbidden",
            )
        ]
        assert not [
            message for message in log.messages for value in envelope["secrets"] if value in message
        ]


class TestClusterWarnings:
    """A Warning header the cluster sends back is surfaced, not dropped."""

    def test_a_cluster_warning_is_logged(self) -> None:
        fake = _serving((201, _applied("probe-a")))
        fake.last_warnings = ['unknown field "spec.foo"']
        log = RecordingLog()

        _run(fake, _manifest_params(), log=log)

        assert log.entries == [
            ("WARN", 'Cluster warning: unknown field "spec.foo"'),
            ("INFO", "Applied 1 object(s)"),
        ]

    def test_several_warnings_are_logged_in_the_order_received(self) -> None:
        fake = _serving((201, _applied("probe-a")))
        fake.last_warnings = ["first", "second"]
        log = RecordingLog()

        _run(fake, _manifest_params(), log=log)

        assert log.messages == [
            "Cluster warning: first",
            "Cluster warning: second",
            "Applied 1 object(s)",
        ]

    def test_a_write_with_no_warnings_logs_only_the_count(self) -> None:
        log = RecordingLog()

        _run(_serving((201, _applied("probe-a"))), _manifest_params(), log=log)

        assert log.entries == [("INFO", "Applied 1 object(s)")]

    def test_a_warning_does_not_fail_the_block(self) -> None:
        fake = _serving((201, _applied("probe-a")))
        fake.last_warnings = ['unknown field "spec.foo"']

        outputs = _outputs(fake, _manifest_params())

        assert outputs["success"] is True
        assert "__block_warning" not in outputs

    def test_a_failing_documents_warnings_are_never_logged(self) -> None:
        body = _failure("Forbidden", "configmaps is forbidden", 403)
        fake = _serving((403, body))
        fake.last_warnings = ["late"]
        log = RecordingLog()

        _run(fake, _manifest_params(on_error="record"), log=log)

        assert log.messages == [
            "Apply failed (Forbidden): Kubernetes API permission denied: configmaps is forbidden"
        ]


class TestApiErrors:
    """The shared error rows, rendered for the apply verb and the Apply action."""

    @pytest.mark.parametrize(
        ("status", "body", "message"),
        [
            (
                404,
                _failure(
                    "NotFound",
                    'namespaces "ghost" not found',
                    404,
                    {"kind": "namespaces", "name": "ghost"},
                ),
                "K8s namespace 'ghost' not found",
            ),
            (
                404,
                _failure("NotFound", 'configmaps "probe-a" not found', 404),
                "K8s ConfigMap 'probe-a' not found in namespace 'apps'",
            ),
            (
                409,
                _failure("AlreadyExists", 'configmaps "probe-a" already exists', 409),
                "K8s ConfigMap 'probe-a' already exists in namespace 'apps'",
            ),
            (
                500,
                {"kind": "Status", "message": _TYPED_PATCH_MESSAGE, "code": 500},
                f"Kubernetes rejected the manifest: {_TYPED_PATCH_DETAIL}",
            ),
            (
                500,
                {"kind": "Status", "message": _UNMARKED_PATCH_MESSAGE, "code": 500},
                f"Kubernetes rejected the manifest: {_UNMARKED_PATCH_MESSAGE}",
            ),
            (
                502,
                {},
                "Kubernetes could not apply ConfigMap 'probe-a' in namespace 'apps' (HTTP 502)",
            ),
            (
                401,
                _failure("Unauthorized", "Unauthorized", 401),
                "Kubernetes API authentication failed: Unauthorized",
            ),
            (
                403,
                _failure("Forbidden", _FORBIDDEN_DETAIL, 403),
                f"Kubernetes API permission denied: {_FORBIDDEN_DETAIL}",
            ),
            (
                409,
                _failure("Conflict", _CONFLICT_DETAIL, 409),
                "Kubernetes rejected the update to ConfigMap 'probe-a' because it changed "
                f"on the cluster first: {_CONFLICT_DETAIL}",
            ),
            (
                503,
                _failure("ServiceUnavailable", _UNAVAILABLE_DETAIL, 503),
                "Kubernetes could not apply ConfigMap 'probe-a' in namespace 'apps': "
                f"{_UNAVAILABLE_DETAIL}",
            ),
        ],
        ids=[
            "namespace",
            "not-found",
            "already-exists",
            "typed-patch",
            "typed-patch-unmarked",
            "no-message",
            "unauthorized",
            "forbidden",
            "conflict",
            "unavailable",
        ],
    )
    def test_the_cluster_answer_renders_its_apply_row(
        self, status: int, body: dict[str, Any], message: str
    ) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            _run(_serving((status, body)), _manifest_params())

    @pytest.mark.parametrize(
        ("status", "body", "reason"),
        [
            (409, _failure("AlreadyExists", 'configmaps "probe-a" exists', 409), "AlreadyExists"),
            (409, _failure("Conflict", _CONFLICT_DETAIL, 409), "Conflict"),
            (403, _failure("Forbidden", _FORBIDDEN_DETAIL, 403), "Forbidden"),
            (500, {"kind": "Status", "message": _TYPED_PATCH_MESSAGE, "code": 500}, ""),
        ],
        ids=["already-exists", "conflict", "forbidden", "no-reason"],
    )
    def test_the_recorded_reason_is_the_one_the_status_carried(
        self, status: int, body: dict[str, Any], reason: str
    ) -> None:
        outputs = _outputs(_serving((status, body)), _manifest_params(on_error="record"))

        assert outputs["reason"] == reason

    def test_a_discovery_miss_names_the_kind_and_its_api_version(self) -> None:
        document = {"apiVersion": "example.com/v1", "kind": "Widget", "metadata": {"name": "w1"}}
        fake = _serving(resources={})
        message = (
            "This cluster has no resource kind 'Widget' in API version 'example.com/v1' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            _run(fake, _manifest_params(manifest=_manifest_text(document)))

        assert fake.calls == []

    def test_a_discovery_miss_is_recordable_with_a_not_found_reason(self) -> None:
        document = {"apiVersion": "example.com/v1", "kind": "Widget", "metadata": {"name": "w1"}}
        params = _manifest_params(manifest=_manifest_text(document), on_error="record")

        outputs = _outputs(_serving(resources={}), params)

        assert outputs["success"] is False
        assert outputs["reason"] == "NotFound"

    def test_a_denied_discovery_walk_renders_the_authentication_row(self) -> None:
        fake = DeniedDiscoveryClient(401, _failure("Unauthorized", "Unauthorized", 401))

        with pytest.raises(
            ValueError, match=exact("Kubernetes API authentication failed: Unauthorized")
        ):
            _run(fake, _manifest_params())

    def test_a_denied_discovery_walk_records_the_permission_row_and_its_reason(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))

        outputs = _outputs(fake, _manifest_params(on_error="record"))

        assert outputs["error"] == f"Kubernetes API permission denied: {_DISCOVERY_FORBIDDEN}"
        assert outputs["reason"] == "Forbidden"

    def test_a_denied_walk_without_a_message_names_the_list_verb(self) -> None:
        fake = DeniedDiscoveryClient(401, {})

        outputs = _outputs(fake, _manifest_params(on_error="record"))

        assert outputs["error"] == "Kubernetes could not list ConfigMap objects (HTTP 401)"
        assert outputs["reason"] == ""

    def test_a_denied_walk_issues_no_write_request(self) -> None:
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", _DISCOVERY_FORBIDDEN, 403))

        _run(fake, _manifest_params(on_error="record"))

        assert fake.calls == []


class TestRecordedFailure:
    """Record and continue returns the partial outputs, the failed core and the amber signal."""

    @staticmethod
    def _forbidden() -> FakeK8sClient:
        return _serving((403, _failure("Forbidden", "configmaps is forbidden", 403)))

    def test_a_recorded_failure_returns_the_declared_outputs_and_the_signal(self) -> None:
        outputs = _outputs(self._forbidden(), _manifest_params(on_error="record"))

        assert set(outputs) == {
            "summary",
            "result",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        }

    def test_a_recorded_failure_carries_the_failed_core_and_the_warning_signal(self) -> None:
        outputs = _outputs(self._forbidden(), _manifest_params(on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == "Kubernetes API permission denied: configmaps is forbidden"
        assert outputs["reason"] == "Forbidden"
        assert outputs["__block_warning"] is True

    def test_the_recorded_warn_line_names_the_apply_action_and_the_reason(self) -> None:
        log = RecordingLog()

        _run(self._forbidden(), _manifest_params(on_error="record"), log=log)

        assert log.entries == [
            (
                "WARN",
                "Apply failed (Forbidden): Kubernetes API permission denied: "
                "configmaps is forbidden",
            )
        ]

    def test_a_failure_without_a_reason_drops_the_parenthesized_clause(self) -> None:
        log = RecordingLog()

        outputs = _outputs(_serving((502, {})), _manifest_params(on_error="record"), log=log)

        assert outputs["reason"] == ""
        assert log.entries == [
            (
                "WARN",
                "Apply failed: Kubernetes could not apply ConfigMap 'probe-a' "
                "in namespace 'apps' (HTTP 502)",
            )
        ]

    def test_a_recorded_failure_envelope_survives_a_json_round_trip_unchanged(self) -> None:
        envelope = _run(self._forbidden(), _manifest_params(on_error="record"))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_nothing_comes_back_under_fail(self) -> None:
        outputs: dict[str, Any] | None = None

        with pytest.raises(ValueError):
            outputs = _outputs(self._forbidden(), _manifest_params())

        assert outputs is None

    def test_a_failing_apply_under_fail_mode_logs_nothing(self) -> None:
        log = RecordingLog()

        with pytest.raises(ValueError):
            _run(self._forbidden(), _manifest_params(), log=log)

        assert log.entries == []

    def test_fail_is_the_default_mode(self) -> None:
        message = "Kubernetes API permission denied: configmaps is forbidden"

        with pytest.raises(ValueError, match=exact(message)):
            _run(self._forbidden(), _manifest_params())

    @pytest.mark.parametrize(
        "on_error", ["Record", "", None, True], ids=["cased", "blank", "none", "true"]
    )
    def test_only_the_literal_record_keeps_the_block_running(self, on_error: Any) -> None:
        with pytest.raises(ValueError):
            _run(self._forbidden(), _manifest_params(on_error=on_error))

    def test_record_mode_keeps_a_happy_apply_green(self) -> None:
        outputs = _outputs(
            _serving((201, _applied("probe-a"))), _manifest_params(on_error="record")
        )

        assert outputs["success"] is True
        assert outputs["error"] == ""
        assert outputs["reason"] == ""
        assert "__block_warning" not in outputs


class TestAlwaysHardFail:
    """The carve-out: these raise under fail AND under record."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_bogus_session_raises_in_both_modes(self, on_error: str) -> None:
        params = _manifest_params(session="not-a-kubeconfig", on_error=on_error)

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(_serving((201, _applied("probe-a"))), params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_an_absent_session_raises_in_both_modes(self, on_error: str) -> None:
        params = {"define_with": "manifest", "manifest": _MANIFEST_ONE, "on_error": on_error}

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(_serving((201, _applied("probe-a"))), params)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    @pytest.mark.parametrize(
        "message",
        [
            f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused",
            _TIMED_OUT_MESSAGE,
            UNREADABLE_BODY_MESSAGE,
            _TRUNCATED_MESSAGE,
        ],
        ids=["refused", "timeout", "unreadable-body", "truncated"],
    )
    def test_a_transport_failure_raises_in_both_modes(self, message: str, on_error: str) -> None:
        fake = _serving(K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(fake, _manifest_params(on_error=on_error))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_an_api_version_holding_no_text_raises_in_both_modes(self, on_error: str) -> None:
        document = {"apiVersion": "  ", "kind": "ConfigMap", "metadata": {"name": "probe-a"}}
        params = _manifest_params(manifest=_manifest_text(document), on_error=on_error)
        fake = _serving()

        with pytest.raises(ValueError, match=exact(_MANIFEST_KIND_MESSAGE)):
            _run(fake, params)

        assert fake.discovery_calls == []
        assert fake.calls == []

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_document_without_a_name_raises_in_both_modes(self, on_error: str) -> None:
        document = {"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": "  "}}
        params = _manifest_params(manifest=_manifest_text(document), on_error=on_error)
        fake = _serving()

        with pytest.raises(ValueError, match=exact(_MANIFEST_NAME_MESSAGE)):
            _run(fake, params)

        assert fake.calls == []
