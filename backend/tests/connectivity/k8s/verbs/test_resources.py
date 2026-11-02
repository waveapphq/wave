"""K8s verb-core resource targeting tests (REQ-5.1.1, REQ-3.4.1.5).

resolve_namespace picks the namespace a read targets, resource_path builds the
API path for a collection or one named object with every segment percent-encoded,
and resolve_read_resource turns a kind into a discovery hit the way kubectl's REST
mapper does. All three live in the verb core and run synchronously, so a vendored
copy targets the same object a local run does.
"""

import inspect
import re
from dataclasses import FrozenInstanceError
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.plugins.k8s._k8s_fixtures import NAMESPACE, SERVER, exact, session_value
from wavecore.connectivity.k8s.rest import K8sResource
from wavecore.connectivity.k8s.verbs import _resources
from wavecore.connectivity.k8s.verbs._context import K8sContext
from wavecore.connectivity.k8s.verbs._errors import K8sReadRejected
from wavecore.connectivity.k8s.verbs._resources import (
    resolve_namespace,
    resolve_read_resource,
    resource_path,
)


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_EXEC_TIMEOUT = 60
_POD_FIELDS = ["context", "namespace", "pod", "container", "timeout"]


def _exec_params(session_namespace: str = NAMESPACE, **overrides: Any) -> dict[str, Any]:
    """The params an exec-channel verb hands pod_exec, with the session default it was opened on."""
    params: dict[str, Any] = {
        "session": session_value(namespace=session_namespace),
        "pod": "web-1",
        "container": "app",
    }
    params.update(overrides)
    return params


def _signature_of(function: Any, name: str) -> inspect.Parameter:
    return inspect.signature(function).parameters[name]


def _k8s_context(namespace: str = "apps") -> K8sContext:
    return K8sContext(server=SERVER, namespace=namespace)


def _pods_resource() -> K8sResource:
    return K8sResource("Pod", "pods", True, "v1", "/api/v1")


def _nodes_resource() -> K8sResource:
    return K8sResource("Node", "nodes", False, "v1", "/api/v1")


def _deployments_resource() -> K8sResource:
    return K8sResource("Deployment", "deployments", True, "apps/v1", "/apis/apps/v1")


class TestResolveNamespace:
    """Which namespace a read verb targets: the param, the session default, or none."""

    def test_explicit_namespace_wins_over_the_session_default(self) -> None:
        params = {"namespace": "orders"}

        assert resolve_namespace(params, _k8s_context()) == "orders"

    def test_session_default_applies_without_a_namespace_param(self) -> None:
        assert resolve_namespace({}, _k8s_context()) == "apps"

    def test_session_default_is_returned_verbatim(self) -> None:
        assert resolve_namespace({}, _k8s_context("kube-system")) == "kube-system"

    def test_missing_namespace_key_falls_back_to_the_session_default(self) -> None:
        assert resolve_namespace({"timeout": 30}, _k8s_context()) == "apps"

    @pytest.mark.parametrize("value", ["", "   ", "\t\n"], ids=["empty", "spaces", "whitespace"])
    def test_blank_namespace_falls_back_to_the_session_default(self, value: str) -> None:
        params = {"namespace": value}

        assert resolve_namespace(params, _k8s_context()) == "apps"

    def test_all_namespaces_resolves_to_no_namespace(self) -> None:
        assert resolve_namespace({"all_namespaces": True}, _k8s_context()) is None

    def test_all_namespaces_wins_over_an_explicit_namespace(self) -> None:
        params = {"all_namespaces": True, "namespace": "orders"}

        assert resolve_namespace(params, _k8s_context()) is None

    def test_all_namespaces_wins_over_the_session_default(self) -> None:
        assert resolve_namespace({"all_namespaces": True}, _k8s_context("orders")) is None

    def test_unticked_all_namespaces_leaves_the_session_default(self) -> None:
        assert resolve_namespace({"all_namespaces": False}, _k8s_context()) == "apps"


class TestResolveNamespaceNamed:
    """A read by name lives in one namespace: the named flag ignores all_namespaces."""

    def test_a_named_read_ignores_all_namespaces_and_keeps_the_session_default(self) -> None:
        params = {"all_namespaces": True}

        assert resolve_namespace(params, _k8s_context(), named=True) == "apps"

    def test_a_named_read_ignores_all_namespaces_and_keeps_an_explicit_namespace(self) -> None:
        params = {"all_namespaces": True, "namespace": "orders"}

        assert resolve_namespace(params, _k8s_context(), named=True) == "orders"

    def test_an_unnamed_read_still_honors_all_namespaces(self) -> None:
        params = {"all_namespaces": True}

        assert resolve_namespace(params, _k8s_context(), named=False) is None

    def test_the_flag_defaults_to_an_unnamed_read(self) -> None:
        assert resolve_namespace({"all_namespaces": True}, _k8s_context()) is None


class TestResourcePathEncoding:
    """Namespace and name are percent-encoded into the path; the query is encoded separately."""

    def test_a_dns_name_and_namespace_are_unchanged(self) -> None:
        path = resource_path(_pods_resource(), "apps", "web-1")

        assert path == "/api/v1/namespaces/apps/pods/web-1"

    def test_a_name_with_a_space_and_a_question_mark_is_percent_encoded(self) -> None:
        path = resource_path(_pods_resource(), "apps", "web 1?")

        assert path == "/api/v1/namespaces/apps/pods/web%201%3F"

    def test_a_namespace_with_a_space_and_a_question_mark_is_percent_encoded(self) -> None:
        path = resource_path(_pods_resource(), "my ns?", "web-1")

        assert path == "/api/v1/namespaces/my%20ns%3F/pods/web-1"

    def test_a_slash_in_a_name_is_encoded_so_it_cannot_add_a_segment(self) -> None:
        path = resource_path(_pods_resource(), "apps", "web/log")

        assert path == "/api/v1/namespaces/apps/pods/web%2Flog"

    def test_the_query_follows_the_encoded_name(self) -> None:
        path = resource_path(_pods_resource(), "my ns?", None, {"labelSelector": "a=b"})

        assert path == "/api/v1/namespaces/my%20ns%3F/pods?labelSelector=a%3Db"

    def test_a_cluster_scoped_resource_never_carries_the_namespace(self) -> None:
        path = resource_path(_nodes_resource(), "my ns?", "node 0?")

        assert path == "/api/v1/nodes/node%200%3F"

    def test_a_subresource_lands_after_the_name(self) -> None:
        path = resource_path(_deployments_resource(), "apps", "web", subresource="scale")

        assert path == "/apis/apps/v1/namespaces/apps/deployments/web/scale"

    def test_a_subresource_comes_before_the_query_string(self) -> None:
        path = resource_path(
            _deployments_resource(), "apps", "web", {"dryRun": "All"}, subresource="scale"
        )

        assert path == "/apis/apps/v1/namespaces/apps/deployments/web/scale?dryRun=All"

    def test_a_subresource_follows_an_encoded_name(self) -> None:
        path = resource_path(_pods_resource(), "apps", "web 1?", subresource="status")

        assert path == "/api/v1/namespaces/apps/pods/web%201%3F/status"

    def test_no_subresource_leaves_the_shipped_path_untouched(self) -> None:
        path = resource_path(_deployments_resource(), "apps", "web")

        assert path == "/apis/apps/v1/namespaces/apps/deployments/web"

    def test_the_subresource_is_keyword_only_and_optional(self) -> None:
        parameter = _signature_of(resource_path, "subresource")

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is None


class TestResolveReadResource:
    """Discovery resolves a kind on its own, or inside the API version a caller names."""

    @staticmethod
    def _client(found: K8sResource | None) -> Any:
        client = MagicMock()
        client.discover.return_value = found
        return client

    def test_a_kind_alone_leaves_the_version_to_discovery(self) -> None:
        pods = _pods_resource()
        client = self._client(pods)

        resolved = resolve_read_resource(client, "Pod")

        assert resolved is pods
        client.discover.assert_called_once_with("Pod")

    def test_a_named_api_version_resolves_inside_that_group_version(self) -> None:
        deployments = _deployments_resource()
        client = self._client(deployments)

        resolved = resolve_read_resource(client, "Deployment", "apps/v1")

        assert resolved is deployments
        client.discover.assert_called_once_with("Deployment", "apps/v1")

    def test_a_blank_api_version_leaves_the_version_to_discovery(self) -> None:
        client = self._client(_pods_resource())

        resolve_read_resource(client, "Pod", "")

        client.discover.assert_called_once_with("Pod")

    def test_a_miss_under_a_named_version_names_that_version(self) -> None:
        client = self._client(None)
        message = (
            "This cluster has no resource kind 'Widget' in API version 'example.com/v1beta1' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(K8sReadRejected, match=_exact(message)):
            resolve_read_resource(client, "Widget", "example.com/v1beta1")

    def test_a_miss_without_a_version_names_the_kind_alone(self) -> None:
        client = self._client(None)
        message = (
            "This cluster has no resource kind 'Widget' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(K8sReadRejected, match=_exact(message)):
            resolve_read_resource(client, "Widget")


class TestPodExecTarget:
    """What one exec-channel call aims at: the cluster, the namespace, the pod and its container."""

    def test_the_session_is_parsed_into_the_context(self) -> None:
        target = _resources.pod_exec(_exec_params(), _EXEC_TIMEOUT)

        assert target.context.server == SERVER

    def test_an_unreadable_session_is_refused(self) -> None:
        params = _exec_params(session="not-a-kubeconfig")

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _resources.pod_exec(params, _EXEC_TIMEOUT)

    def test_the_session_namespace_is_the_default_target(self) -> None:
        target = _resources.pod_exec(_exec_params(), _EXEC_TIMEOUT)

        assert target.namespace == NAMESPACE

    def test_an_explicit_namespace_wins_over_the_session_default(self) -> None:
        target = _resources.pod_exec(_exec_params(namespace="orders"), _EXEC_TIMEOUT)

        assert target.namespace == "orders"

    @pytest.mark.parametrize("value", ["", "   ", "\t\n"], ids=["empty", "spaces", "whitespace"])
    def test_a_blank_namespace_falls_back_to_the_session_default(self, value: str) -> None:
        target = _resources.pod_exec(_exec_params(namespace=value), _EXEC_TIMEOUT)

        assert target.namespace == NAMESPACE

    def test_all_namespaces_is_ignored_because_a_pod_is_read_by_name(self) -> None:
        target = _resources.pod_exec(_exec_params(all_namespaces=True), _EXEC_TIMEOUT)

        assert target.namespace == NAMESPACE

    def test_a_session_that_carries_no_namespace_leaves_the_target_namespace_empty(self) -> None:
        target = _resources.pod_exec(_exec_params(""), _EXEC_TIMEOUT)

        assert target.namespace == ""

    def test_the_pod_and_container_names_are_stripped(self) -> None:
        params = _exec_params(pod="  web-1 ", container=" app ")

        target = _resources.pod_exec(params, _EXEC_TIMEOUT)

        assert (target.pod, target.container) == ("web-1", "app")

    def test_a_pod_and_container_that_are_not_text_are_coerced_to_text(self) -> None:
        params = _exec_params(pod=7, container=8)

        target = _resources.pod_exec(params, _EXEC_TIMEOUT)

        assert (target.pod, target.container) == ("7", "8")

    def test_a_missing_pod_is_a_key_error(self) -> None:
        params = _exec_params()
        del params["pod"]

        with pytest.raises(KeyError, match=exact("'pod'")):
            _resources.pod_exec(params, _EXEC_TIMEOUT)

    def test_a_missing_container_is_a_key_error(self) -> None:
        params = _exec_params()
        del params["container"]

        with pytest.raises(KeyError, match=exact("'container'")):
            _resources.pod_exec(params, _EXEC_TIMEOUT)

    def test_a_timeout_that_is_set_is_read_verbatim(self) -> None:
        target = _resources.pod_exec(_exec_params(timeout=45), _EXEC_TIMEOUT)

        assert target.timeout == 45

    def test_an_absent_timeout_falls_back_to_the_default_the_caller_named(self) -> None:
        target = _resources.pod_exec(_exec_params(), _EXEC_TIMEOUT)

        assert target.timeout == _EXEC_TIMEOUT
        assert target.timeout != _resources.DEFAULT_TIMEOUT

    def test_the_target_fields_read_context_namespace_pod_container_and_timeout(self) -> None:
        assert list(_resources.PodExec.__dataclass_fields__) == _POD_FIELDS


class TestPodExecWhere:
    """The one clause K8s Exec, Script and Copy all name their target with."""

    def test_the_clause_names_the_pod_then_the_container_then_the_namespace(self) -> None:
        target = _resources.pod_exec(_exec_params(), _EXEC_TIMEOUT)

        assert target.where() == "pod 'web-1' (container 'app') in namespace 'apps'"

    def test_the_names_are_named_after_they_were_stripped(self) -> None:
        params = _exec_params(pod="  web-1 ", container=" app ")

        assert _resources.pod_exec(params, _EXEC_TIMEOUT).where() == (
            "pod 'web-1' (container 'app') in namespace 'apps'"
        )

    def test_an_explicit_namespace_is_named_after_it_was_stripped(self) -> None:
        params = _exec_params(namespace="  orders  ")

        assert _resources.pod_exec(params, _EXEC_TIMEOUT).where() == (
            "pod 'web-1' (container 'app') in namespace 'orders'"
        )

    def test_a_session_default_namespace_keeps_the_spaces_it_was_stored_with(self) -> None:
        params = _exec_params("  apps  ")

        assert _resources.pod_exec(params, _EXEC_TIMEOUT).where() == (
            "pod 'web-1' (container 'app') in namespace '  apps  '"
        )

    def test_a_quote_in_a_pod_name_is_named_unescaped(self) -> None:
        params = _exec_params(pod="web'1")

        assert _resources.pod_exec(params, _EXEC_TIMEOUT).where() == (
            "pod 'web'1' (container 'app') in namespace 'apps'"
        )


class TestPodExecIsFrozen:
    """A target is settled the moment it is parsed, so nothing can retarget a call in flight."""

    @pytest.mark.parametrize("field", _POD_FIELDS)
    def test_assigning_to_a_field_is_refused(self, field: str) -> None:
        target = _resources.pod_exec(_exec_params(), _EXEC_TIMEOUT)

        with pytest.raises(FrozenInstanceError, match=exact(f"cannot assign to field '{field}'")):
            setattr(target, field, "changed")
