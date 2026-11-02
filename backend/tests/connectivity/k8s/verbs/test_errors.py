"""K8s verb-core error-message tests (REQ-5.1.1, REQ-4.5.5, REQ-3.4.1.5).

map_api_error renders the shared K8s API error-message rows every verb reports a
cluster refusal through, discovery_miss_message names a kind the cluster does not
serve, and K8sReadRejected carries the rendered message and the cluster reason to
whichever verb decides between raising and recording.
"""

import inspect
from typing import Any

import pytest

from wavecore.connectivity.k8s.verbs._errors import (
    K8sReadRejected,
    discovery_miss_message,
    map_api_error,
)

_WRITE_VERBS = ["apply", "delete", "scale", "roll back"]
_MANIFEST_REJECTION = (
    "failed to create typed patch object (apps/probe-a; /v1, Kind=ConfigMap): "
    ".data.count: expected string, got &value.valueUnstructured{Value:3}"
)


def _signature_of(function: Any, name: str) -> inspect.Parameter:
    return inspect.signature(function).parameters[name]


class TestMapApiError:
    """The shared status-row rendering (REQ-4.5.5 owns the 403 row)."""

    def test_404_named_in_a_namespace(self) -> None:
        body = {"kind": "Status", "reason": "NotFound", "message": 'pods "web-1" not found'}

        message = map_api_error(404, body, "Pod", "web-1", "apps", verb="read")

        assert message == "K8s Pod 'web-1' not found in namespace 'apps'"

    def test_404_cluster_scoped(self) -> None:
        body = {
            "kind": "Status",
            "reason": "NotFound",
            "message": 'namespaces "staging" not found',
        }

        message = map_api_error(404, body, "Namespace", "staging", None, verb="read")

        assert message == "K8s Namespace 'staging' not found"

    def test_409_already_exists_in_a_namespace(self) -> None:
        body = {
            "kind": "Status",
            "reason": "AlreadyExists",
            "message": 'configmaps "app-config" already exists',
        }

        message = map_api_error(409, body, "ConfigMap", "app-config", "apps", verb="read")

        assert message == "K8s ConfigMap 'app-config' already exists in namespace 'apps'"

    def test_409_already_exists_cluster_scoped(self) -> None:
        body = {
            "kind": "Status",
            "reason": "AlreadyExists",
            "message": 'namespaces "staging" already exists',
        }

        message = map_api_error(409, body, "Namespace", "staging", None, verb="read")

        assert message == "K8s Namespace 'staging' already exists"

    def test_401_authentication_failed(self) -> None:
        body = {"kind": "Status", "reason": "Unauthorized", "message": "Unauthorized"}

        message = map_api_error(401, body, "Pod", "web-1", "apps", verb="read")

        assert message == "Kubernetes API authentication failed: Unauthorized"

    def test_403_permission_denied(self) -> None:
        detail = 'pods is forbidden: User "system:anonymous" cannot list resource "pods"'
        body = {"kind": "Status", "reason": "Forbidden", "message": detail}

        message = map_api_error(403, body, "Pod", "web-1", "apps", verb="read")

        assert message == f"Kubernetes API permission denied: {detail}"

    def test_401_without_a_cluster_message_names_the_read_and_the_status(self) -> None:
        message = map_api_error(401, {}, "Pod", "web-1", "apps", verb="read")

        assert message == "Kubernetes could not read Pod 'web-1' in namespace 'apps' (HTTP 401)"

    def test_401_with_a_reason_but_no_message_still_ends_with_the_status(self) -> None:
        body = {"kind": "Status", "reason": "Unauthorized"}

        message = map_api_error(401, body, "Pod", "", "apps", verb="list")

        assert message == "Kubernetes could not list Pod objects in namespace 'apps' (HTTP 401)"

    def test_403_without_a_cluster_message_names_the_read_and_the_status(self) -> None:
        message = map_api_error(403, {}, "Secret", "db-credentials", "apps", verb="read")

        assert message == (
            "Kubernetes could not read Secret 'db-credentials' in namespace 'apps' (HTTP 403)"
        )

    def test_403_without_a_cluster_message_on_a_collection_read(self) -> None:
        message = map_api_error(403, {}, "Secret", "", None, verb="list")

        assert message == "Kubernetes could not list Secret objects (HTTP 403)"

    def test_a_conflict_without_a_cluster_message_ends_with_the_status(self) -> None:
        body = {"kind": "Status", "reason": "Conflict"}

        message = map_api_error(409, body, "Deployment", "web", "apps", verb="read")

        assert message == (
            "Kubernetes could not read Deployment 'web' in namespace 'apps' (HTTP 409)"
        )

    def test_409_update_conflict(self) -> None:
        detail = (
            'Operation cannot be fulfilled on deployments.apps "web": '
            "the object has been modified"
        )
        body = {"kind": "Status", "reason": "Conflict", "message": detail}

        message = map_api_error(409, body, "Deployment", "web", "apps", verb="read")

        assert message == (
            "Kubernetes rejected the update to Deployment 'web' because it changed "
            f"on the cluster first: {detail}"
        )

    def test_500_on_a_named_read_says_the_read_failed(self) -> None:
        detail = "Internal error occurred: rpc error: code = Unknown"
        body = {"kind": "Status", "reason": "InternalError", "message": detail}

        message = map_api_error(500, body, "Pod", "web-1", "apps", verb="read")

        assert message == f"Kubernetes could not read Pod 'web-1' in namespace 'apps': {detail}"

    def test_503_on_a_named_read_says_the_read_failed(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = {"kind": "Status", "reason": "ServiceUnavailable", "message": detail}

        message = map_api_error(503, body, "Pod", "web-1", "apps", verb="read")

        assert message == f"Kubernetes could not read Pod 'web-1' in namespace 'apps': {detail}"

    def test_503_on_a_cluster_scoped_read_drops_the_namespace_clause(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = {"kind": "Status", "reason": "ServiceUnavailable", "message": detail}

        message = map_api_error(503, body, "Node", "kwok-node-0", None, verb="read")

        assert message == f"Kubernetes could not read Node 'kwok-node-0': {detail}"

    def test_503_on_a_collection_read_names_the_kind_not_an_object(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = {"kind": "Status", "reason": "ServiceUnavailable", "message": detail}

        message = map_api_error(503, body, "Event", "", "apps", verb="list")

        assert message == f"Kubernetes could not list Event objects in namespace 'apps': {detail}"

    def test_a_named_read_without_a_cluster_message_names_the_status(self) -> None:
        message = map_api_error(502, {}, "Pod", "web-1", "apps", verb="read")

        assert message == "Kubernetes could not read Pod 'web-1' in namespace 'apps' (HTTP 502)"

    def test_a_collection_read_without_a_cluster_message_names_the_status(self) -> None:
        message = map_api_error(502, {}, "Pod", "", "apps", verb="list")

        assert message == "Kubernetes could not list Pod objects in namespace 'apps' (HTTP 502)"

    def test_404_on_a_collection_read_names_the_kind_not_an_object(self) -> None:
        detail = "the server could not find the requested resource"
        body = {"kind": "Status", "reason": "NotFound", "message": detail}

        message = map_api_error(404, body, "Event", "", "apps", verb="list")

        assert message == f"Kubernetes could not list Event objects in namespace 'apps': {detail}"

    def test_406_on_a_collection_read_carries_the_cluster_text_once(self) -> None:
        detail = "only the following media types are accepted: application/json"
        body = {"kind": "Status", "reason": "NotAcceptable", "message": detail}

        message = map_api_error(406, body, "Event", "", "apps", verb="list")

        assert message == f"Kubernetes could not list Event objects in namespace 'apps': {detail}"


class TestMapApiErrorVerb:
    """The fallback rows name the operation the caller states, not a baked-in read."""

    def test_the_verb_is_keyword_only_and_has_no_default(self) -> None:
        parameter = _signature_of(map_api_error, "verb")

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is inspect.Parameter.empty

    @pytest.mark.parametrize("verb", _WRITE_VERBS)
    def test_a_named_target_without_a_cluster_message_names_the_verb(self, verb: str) -> None:
        message = map_api_error(503, {}, "Deployment", "web", "apps", verb=verb)

        assert message == (
            f"Kubernetes could not {verb} Deployment 'web' in namespace 'apps' (HTTP 503)"
        )

    @pytest.mark.parametrize("verb", _WRITE_VERBS)
    def test_a_nameless_target_without_a_cluster_message_names_the_kind(self, verb: str) -> None:
        message = map_api_error(503, {}, "Deployment", "", "apps", verb=verb)

        assert message == (
            f"Kubernetes could not {verb} Deployment objects in namespace 'apps' (HTTP 503)"
        )

    @pytest.mark.parametrize("verb", _WRITE_VERBS)
    def test_a_named_target_carries_the_cluster_text_after_the_verb(self, verb: str) -> None:
        detail = "Internal error occurred: rpc error: code = Unknown"
        body = {"kind": "Status", "reason": "InternalError", "message": detail}

        message = map_api_error(500, body, "Deployment", "web", None, verb=verb)

        assert message == f"Kubernetes could not {verb} Deployment 'web': {detail}"

    @pytest.mark.parametrize("verb", _WRITE_VERBS)
    def test_a_nameless_target_carries_the_cluster_text_after_the_verb(self, verb: str) -> None:
        detail = "the server is currently unable to handle the request"
        body = {"kind": "Status", "reason": "ServiceUnavailable", "message": detail}

        message = map_api_error(503, body, "Deployment", "", "apps", verb=verb)

        assert message == (
            f"Kubernetes could not {verb} Deployment objects in namespace 'apps': {detail}"
        )

    @pytest.mark.parametrize("verb", _WRITE_VERBS)
    def test_the_rows_that_never_read_the_target_ignore_the_verb(self, verb: str) -> None:
        body = {"kind": "Status", "reason": "AlreadyExists", "message": "configmaps exist"}

        message = map_api_error(409, body, "ConfigMap", "probe-a", "apps", verb=verb)

        assert message == "K8s ConfigMap 'probe-a' already exists in namespace 'apps'"


class TestMapApiErrorMissingNamespace:
    """A 404 raised by the namespace names the namespace, not the object it looked for."""

    def test_the_missing_namespace_comes_from_the_status_details(self) -> None:
        body = {
            "kind": "Status",
            "reason": "NotFound",
            "message": 'namespaces "ghost" not found',
            "details": {"kind": "namespaces", "name": "ghost"},
        }

        message = map_api_error(404, body, "ConfigMap", "probe-a", "ghost", verb="apply")

        assert message == "K8s namespace 'ghost' not found"

    def test_the_namespace_row_beats_the_object_not_found_row(self) -> None:
        body = {
            "kind": "Status",
            "reason": "NotFound",
            "details": {"kind": "namespaces", "name": "ghost"},
        }

        message = map_api_error(404, body, "ConfigMap", "probe-a", "ghost", verb="apply")

        assert message != "K8s ConfigMap 'probe-a' not found in namespace 'ghost'"

    def test_without_a_details_name_the_namespace_argument_is_used(self) -> None:
        body = {"kind": "Status", "reason": "NotFound", "details": {"kind": "namespaces"}}

        message = map_api_error(404, body, "ConfigMap", "probe-a", "ghost", verb="apply")

        assert message == "K8s namespace 'ghost' not found"

    def test_without_a_details_name_or_a_namespace_the_name_is_empty(self) -> None:
        body = {"kind": "Status", "reason": "NotFound", "details": {"kind": "namespaces"}}

        message = map_api_error(404, body, "ConfigMap", "probe-a", None, verb="apply")

        assert message == "K8s namespace '' not found"

    def test_a_404_on_any_other_kind_still_names_the_object(self) -> None:
        body = {
            "kind": "Status",
            "reason": "NotFound",
            "details": {"kind": "configmaps", "name": "probe-a"},
        }

        message = map_api_error(404, body, "ConfigMap", "probe-a", "apps", verb="apply")

        assert message == "K8s ConfigMap 'probe-a' not found in namespace 'apps'"

    def test_a_404_with_no_details_at_all_still_names_the_object(self) -> None:
        body = {"kind": "Status", "reason": "NotFound"}

        message = map_api_error(404, body, "ConfigMap", "probe-a", "apps", verb="apply")

        assert message == "K8s ConfigMap 'probe-a' not found in namespace 'apps'"

    def test_the_row_only_fires_on_a_404(self) -> None:
        body = {
            "kind": "Status",
            "message": "gone",
            "details": {"kind": "namespaces", "name": "ghost"},
        }

        message = map_api_error(500, body, "ConfigMap", "probe-a", "ghost", verb="apply")

        assert message == (
            "Kubernetes could not apply ConfigMap 'probe-a' in namespace 'ghost': gone"
        )


class TestMapApiErrorManifestRejected:
    """Server-side apply answers a malformed manifest with a 500 the user can act on."""

    def test_the_rejection_carries_only_the_field_path(self) -> None:
        body = {
            "kind": "Status",
            "status": "Failure",
            "message": _MANIFEST_REJECTION,
            "code": 500,
        }

        message = map_api_error(500, body, "ConfigMap", "probe-a", "apps", verb="apply")

        assert message == (
            "Kubernetes rejected the manifest: .data.count: expected string, "
            "got &value.valueUnstructured{Value:3}"
        )

    def test_the_rejection_beats_the_row_that_would_name_the_verb(self) -> None:
        body = {"kind": "Status", "message": _MANIFEST_REJECTION, "code": 500}

        message = map_api_error(500, body, "ConfigMap", "probe-a", "apps", verb="apply")

        assert "Kubernetes could not apply" not in message

    def test_only_the_first_marker_splits_the_message(self) -> None:
        detail = "failed to create typed patch object (a; b): .spec: bad (x): more"
        body = {"kind": "Status", "message": detail, "code": 500}

        message = map_api_error(500, body, "ConfigMap", "probe-a", "apps", verb="apply")

        assert message == "Kubernetes rejected the manifest: .spec: bad (x): more"

    def test_the_detail_is_stripped_of_its_surrounding_space(self) -> None:
        detail = "failed to create typed patch object (a):   .spec.count: bad   "
        body = {"kind": "Status", "message": detail, "code": 500}

        message = map_api_error(500, body, "ConfigMap", "probe-a", "apps", verb="apply")

        assert message == "Kubernetes rejected the manifest: .spec.count: bad"

    def test_without_the_marker_the_whole_message_is_carried(self) -> None:
        detail = "failed to create typed patch object for the supplied document"
        body = {"kind": "Status", "message": detail, "code": 500}

        message = map_api_error(500, body, "ConfigMap", "probe-a", "apps", verb="apply")

        assert message == f"Kubernetes rejected the manifest: {detail}"

    def test_a_message_that_only_contains_the_phrase_is_not_a_rejection(self) -> None:
        detail = "the apiserver failed to create typed patch object at some point"
        body = {"kind": "Status", "message": detail, "code": 500}

        message = map_api_error(500, body, "ConfigMap", "probe-a", "apps", verb="apply")

        assert message == (
            f"Kubernetes could not apply ConfigMap 'probe-a' in namespace 'apps': {detail}"
        )


class TestDiscoveryMissMessage:
    """A kind the cluster does not serve is named with the two things that explain it."""

    def test_the_kind_is_named_without_an_api_version(self) -> None:
        message = discovery_miss_message("Widget")

        assert message == (
            "This cluster has no resource kind 'Widget' "
            "- check the spelling, or whether the CRD is installed"
        )

    def test_a_named_api_version_is_carried_after_the_kind(self) -> None:
        message = discovery_miss_message("Widget", "example.com/v1")

        assert message == (
            "This cluster has no resource kind 'Widget' in API version 'example.com/v1' "
            "- check the spelling, or whether the CRD is installed"
        )


class TestK8sReadRejected:
    """The refusal a verb catches carries the rendered message and the cluster reason."""

    def test_the_message_is_both_the_attribute_and_the_exception_text(self) -> None:
        rejection = K8sReadRejected(discovery_miss_message("Widget"), "NotFound")

        assert rejection.message == discovery_miss_message("Widget")
        assert str(rejection) == discovery_miss_message("Widget")

    def test_the_cluster_reason_is_carried_verbatim(self) -> None:
        rejection = K8sReadRejected("Kubernetes API permission denied: nope", "Forbidden")

        assert rejection.reason == "Forbidden"

    def test_a_cluster_answer_without_a_reason_keeps_none(self) -> None:
        rejection = K8sReadRejected("Kubernetes could not list Pod objects (HTTP 503)", None)

        assert rejection.reason is None
