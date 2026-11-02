"""K8s Scale plugin tests (REQ-5.1.1, REQ-3.4.1.5).

Scale reads an object's scale subresource for the count it is replacing, then
writes the new count back as a merge patch. It does not wait and does not poll
(K8SWRITE-6), and a kind the cluster serves no scale endpoint for is refused
before anything is written. Error and Reason are gated on Record and continue;
Success never is.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    SERVER,
    DeniedDiscoveryClient,
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
from wavecore.plugins.k8s_scale import K8sScalePlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "resource_type",
    "kind",
    "kind_custom",
    "name",
    "replicas",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["summary", "success", "error", "reason"]

SUMMARY_COLUMNS = ["RESOURCE", "OUTCOME", "PREVIOUS", "REPLICAS"]
SUMMARY_COLUMN_TYPES = ["string", "string", "integer", "integer"]

MERGE_PATCH = "application/merge-patch+json"
RECORD_GATE = {"field": "on_error", "values": ["record"]}

_DEPLOYMENTS = {"Deployment": resource("Deployment", "deployments", group_version="apps/v1")}
_STATEFULSETS = {"StatefulSet": resource("StatefulSet", "statefulsets", group_version="apps/v1")}
_WIDGETS = {"Widget": resource("Widget", "widgets", group_version="example.com/v1")}
_CONFIGMAPS = {"ConfigMap": resource("ConfigMap", "configmaps")}

_DEPLOY_SCALE = f"/apis/apps/v1/namespaces/{NAMESPACE}/deployments/web/scale"
_STATEFULSET_SCALE = f"/apis/apps/v1/namespaces/{NAMESPACE}/statefulsets/db/scale"
_WIDGET_SCALE = f"/apis/example.com/v1/namespaces/{NAMESPACE}/widgets/gizmo/scale"
_CONFIGMAP_SCALE = f"/api/v1/namespaces/{NAMESPACE}/configmaps/probe-a/scale"

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_NEGATIVE_REPLICAS = "Parameter 'replicas' must be non-negative"

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

_BOTH_MODES = pytest.mark.parametrize("mode", ["fail", "record"])


def _cannot_scale(kind: str) -> str:
    return f"Kind '{kind}' cannot be scaled - the cluster serves no scale endpoint for it"


def _scale_object(
    replicas: int | None,
    observed: int | None = None,
    name: str = "web",
    namespace: str = NAMESPACE,
) -> dict[str, Any]:
    """A Scale as the API serves it; spec.replicas is omitted when the count is zero."""
    spec: dict[str, Any] = {} if replicas is None else {"replicas": replicas}
    status: dict[str, Any] = {} if observed is None else {"replicas": observed}
    return {
        "kind": "Scale",
        "apiVersion": "autoscaling/v1",
        "metadata": {"name": name, "namespace": namespace},
        "spec": spec,
        "status": status,
    }


def _failure(reason: str, message: str, code: int) -> dict[str, Any]:
    return {
        "kind": "Status",
        "apiVersion": "v1",
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
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


def _params_by_name(plugin: K8sScalePlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


def _outputs_by_name(plugin: K8sScalePlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _valid_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"kind": "Deployment", "name": "web", "replicas": 3}
    params.update(overrides)
    return block_params(**params)


def _scaling(previous: int | None, wanted: int | None, observed: int | None = None) -> list[Any]:
    """The two scripted answers of one scale: the read, then the patched object."""
    return [(200, _scale_object(previous)), (200, _scale_object(wanted, observed))]


def _fake(*responses: Any, resources: dict[str, Any] | None = None) -> FakeK8sClient:
    return FakeK8sClient(responses=list(responses), resources=resources or _DEPLOYMENTS)


async def _execute(fake: FakeK8sClient, params: dict[str, Any], logger: Any = None) -> Any:
    with patch_verb_client("scale", fake):
        return await K8sScalePlugin().execute(execute_context(params, logger=logger))


def _row(result: Any, index: int = 0) -> list[Any]:
    return list(result["summary"].row(index).to_list())


class TestMetadata:
    """Plugin identity, the eleven parameters, and the four declared outputs."""

    def test_plugin_instantiates(self) -> None:
        assert K8sScalePlugin() is not None

    def test_identity(self) -> None:
        meta = K8sScalePlugin().metadata

        assert meta["id"] == "k8s-scale"
        assert meta["name"] == "K8s Scale"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "kubernetes"
        assert meta["return_type"] == "map"

    def test_authorship_and_tags(self) -> None:
        meta = K8sScalePlugin().metadata

        assert meta["author"] == "WAVE Framework"
        assert meta["tags"][:2] == ["kubernetes", "k8s"]

    def test_the_block_carries_a_description(self) -> None:
        assert K8sScalePlugin().metadata["description"]

    def test_remotable_is_true(self) -> None:
        assert K8sScalePlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sScalePlugin().metadata["proxy_support"] == "supported"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sScalePlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_parameter_list_is_exactly_eleven_rows(self) -> None:
        assert len(K8sScalePlugin().metadata["parameters"]) == 11

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["resource_type"]["type"] == "string"
        assert params["kind"]["type"] == "string"
        assert params["kind_custom"]["type"] == "string"
        assert params["name"]["type"] == "string"
        assert params["replicas"]["type"] == "integer"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sScalePlugin())
        required = [name for name in EXPECTED_PARAM_ORDER if params[name].get("required")]

        assert required == ["session", "name", "replicas"]

    def test_the_rest_declare_required_false(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        for name in EXPECTED_PARAM_ORDER:
            if name in ("session", "name", "replicas"):
                continue
            assert params[name].get("required") is False

    def test_defaults(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        assert params["timeout"]["default"] == 30
        assert params["resource_type"]["default"] == "default"
        assert params["kind"]["default"] == "Deployment"
        assert params["on_error"]["default"] == "fail"

    def test_name_and_replicas_carry_no_default(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        assert "default" not in params["name"]
        assert "default" not in params["replicas"]

    def test_only_the_session_parameter_is_secret(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        for name in (
            "session",
            "kind_custom",
            "name",
            "namespace",
            "impersonate_user",
            "impersonate_groups",
        ):
            assert params[name]["trim"] is True

    def test_the_picked_kind_declares_no_trim(self) -> None:
        assert _params_by_name(K8sScalePlugin())["kind"].get("trim") is not True

    def test_enum_values(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        assert params["resource_type"]["enum_values"] == ["default", "custom"]
        assert params["kind"]["enum_values"] == [
            "Deployment",
            "ReplicaSet",
            "ReplicationController",
            "StatefulSet",
        ]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_only_the_three_mode_params_are_enums(self) -> None:
        params = _params_by_name(K8sScalePlugin())
        enum_params = {name for name, param in params.items() if "enum_values" in param}

        assert enum_params == {"resource_type", "kind", "on_error"}

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sScalePlugin().metadata["parameters"]:
            assert param.get("description")

    def test_output_schema(self) -> None:
        outputs = K8sScalePlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("summary", "table"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_the_output_list_is_exactly_four_rows(self) -> None:
        assert len(K8sScalePlugin().metadata["output_schema"]) == 4

    def test_no_output_is_flagged_secret(self) -> None:
        for output in K8sScalePlugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sScalePlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name(K8sScalePlugin())

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS

    def test_no_output_declares_type_rules(self) -> None:
        for output in K8sScalePlugin().metadata["output_schema"]:
            assert "type_when" not in output


class TestDeliberateAbsences:
    """The rows and outputs the sheet deliberately does not carry (K8SWRITE-6)."""

    def test_no_current_replicas_row_is_declared(self) -> None:
        assert "current_replicas" not in _params_by_name(K8sScalePlugin())

    def test_no_precondition_row_is_declared_under_any_name(self) -> None:
        names = [p["name"] for p in K8sScalePlugin().metadata["parameters"]]

        assert [name for name in names if "current" in name or "precondition" in name] == []

    def test_no_wait_or_poll_row_is_declared(self) -> None:
        names = [p["name"] for p in K8sScalePlugin().metadata["parameters"]]

        assert [name for name in names if "wait" in name or "poll" in name] == []

    def test_the_connection_timeout_is_the_only_duration(self) -> None:
        params = _params_by_name(K8sScalePlugin())
        integers = [n for n in EXPECTED_PARAM_ORDER if params[n]["type"] == "integer"]

        assert integers == ["timeout", "replicas"]

    def test_the_block_declares_no_all_namespaces_row(self) -> None:
        assert "all_namespaces" not in _params_by_name(K8sScalePlugin())

    def test_no_replica_count_output_is_declared(self) -> None:
        outputs = _outputs_by_name(K8sScalePlugin())

        for name in ("replicas", "previous_replicas", "observed_replicas"):
            assert name not in outputs

    def test_the_declared_output_names_are_exactly_the_four(self) -> None:
        names = [o["name"] for o in K8sScalePlugin().metadata["output_schema"]]

        assert names == EXPECTED_OUTPUT_ORDER


class TestConditionalRequirements:
    """The declarations the pre-run gate reads to refuse a half-filled block."""

    def test_kind_is_required_under_the_default_resource_type(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        assert params["kind"]["required_when"] == {
            "field": "resource_type",
            "values": ["default"],
        }

    def test_kind_custom_is_required_under_the_custom_resource_type(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        assert params["kind_custom"]["required_when"] == {
            "field": "resource_type",
            "values": ["custom"],
        }

    def test_only_the_kind_pair_is_conditionally_required(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        conditional = [n for n in EXPECTED_PARAM_ORDER if required_conditions(params[n])]

        assert conditional == ["kind", "kind_custom"]

    def test_no_conditionally_required_param_is_also_required(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        for name in ("kind", "kind_custom"):
            assert params[name].get("required") is False

    def test_every_condition_reads_a_field_that_declares_a_default(self) -> None:
        params = _params_by_name(K8sScalePlugin())

        for name in EXPECTED_PARAM_ORDER:
            for condition in required_conditions(params[name]):
                assert params[condition["field"]]["default"] is not None


class TestValidation:
    """validate() - session, impersonation, enums, the per-mode rows, replicas, timeout."""

    async def test_default_mode_params_pass(self) -> None:
        await K8sScalePlugin().validate(_valid_params())

    async def test_custom_mode_params_pass(self) -> None:
        await K8sScalePlugin().validate(_valid_params(resource_type="custom", kind_custom="Widget"))

    async def test_full_params_pass(self) -> None:
        await K8sScalePlugin().validate(
            _valid_params(
                timeout=45,
                replicas=0,
                namespace="ops",
                impersonate_user="qa-bot",
                impersonate_groups="dev, ops",
                on_error="record",
            )
        )

    async def test_missing_session(self) -> None:
        params = {"kind": "Deployment", "name": "web", "replicas": 3}

        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sScalePlugin().validate(params)

    async def test_empty_session_reports_the_empty_case(self) -> None:
        params = {"session": "", "kind": "Deployment", "name": "web", "replicas": 3}

        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sScalePlugin().validate(params)

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sScalePlugin().validate(_valid_params(impersonate_groups="qa, ops"))

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sScalePlugin().validate(
            _valid_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )

    async def test_invalid_resource_type_is_rejected(self) -> None:
        message = (
            "Parameter 'resource_type' must be one of: default, custom; "
            "Actual value was 'builtin'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sScalePlugin().validate(_valid_params(resource_type="builtin"))

    async def test_invalid_kind_is_rejected(self) -> None:
        message = (
            "Parameter 'kind' must be one of: Deployment, ReplicaSet, ReplicationController, "
            "StatefulSet; Actual value was 'ConfigMap'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sScalePlugin().validate(_valid_params(kind="ConfigMap"))

    async def test_kind_is_case_sensitive(self) -> None:
        message = (
            "Parameter 'kind' must be one of: Deployment, ReplicaSet, ReplicationController, "
            "StatefulSet; Actual value was 'deployment'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sScalePlugin().validate(_valid_params(kind="deployment"))

    async def test_invalid_on_error_is_rejected(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sScalePlugin().validate(_valid_params(on_error="ignore"))

    async def test_missing_kind_under_the_default_resource_type(self) -> None:
        params = _valid_params()
        del params["kind"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: kind$"):
            await K8sScalePlugin().validate(params)

    async def test_missing_kind_custom_under_the_custom_resource_type(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: kind_custom$"):
            await K8sScalePlugin().validate(_valid_params(resource_type="custom"))

    async def test_kind_is_not_required_under_the_custom_resource_type(self) -> None:
        params = _valid_params(resource_type="custom", kind_custom="Widget")
        del params["kind"]

        await K8sScalePlugin().validate(params)

    async def test_kind_custom_is_not_required_under_the_default_resource_type(self) -> None:
        await K8sScalePlugin().validate(_valid_params())

    async def test_missing_name_is_rejected(self) -> None:
        params = _valid_params()
        del params["name"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sScalePlugin().validate(params)

    async def test_empty_name_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sScalePlugin().validate(_valid_params(name=""))

    async def test_missing_replicas_is_rejected(self) -> None:
        params = _valid_params()
        del params["replicas"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: replicas$"):
            await K8sScalePlugin().validate(params)

    async def test_a_negative_replica_count_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(_NEGATIVE_REPLICAS)):
            await K8sScalePlugin().validate(_valid_params(replicas=-1))

    async def test_a_deeply_negative_replica_count_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(_NEGATIVE_REPLICAS)):
            await K8sScalePlugin().validate(_valid_params(replicas=-100))

    async def test_zero_replicas_is_valid(self) -> None:
        await K8sScalePlugin().validate(_valid_params(replicas=0))

    async def test_zero_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sScalePlugin().validate(_valid_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sScalePlugin().validate(_valid_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sScalePlugin().validate(_valid_params(timeout=45))


class TestRequestShape:
    """The scale subresource is read, then merge-patched with the new count."""

    async def test_the_kind_is_discovered_once(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.discoveries == ["Deployment"]

    async def test_the_previous_count_is_read_from_the_scale_subresource(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.calls[0].method == "GET"
        assert fake.calls[0].path == _DEPLOY_SCALE
        assert fake.calls[0].body is None

    async def test_the_read_sends_no_content_type_of_its_own(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.calls[0].content_type is None

    async def test_the_write_is_a_patch_on_the_same_subresource_path(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.calls[1].method == "PATCH"
        assert fake.calls[1].path == _DEPLOY_SCALE

    async def test_the_patched_path_carries_the_scale_subresource(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.calls[1].path.endswith("/deployments/web/scale")

    async def test_the_write_declares_the_merge_patch_media_type(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.calls[1].content_type == MERGE_PATCH

    async def test_the_patch_body_is_the_replica_count_and_nothing_else(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.calls[1].body == {"spec": {"replicas": 5}}

    async def test_no_precondition_reaches_the_query_string(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        for call in fake.calls:
            assert "?" not in call.path

    async def test_a_namespace_row_targets_that_namespace(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5, namespace="ops"), None)

        assert fake.calls[0].path == "/apis/apps/v1/namespaces/ops/deployments/web/scale"
        assert fake.calls[1].path == "/apis/apps/v1/namespaces/ops/deployments/web/scale"

    async def test_the_name_is_percent_encoded_before_the_subresource(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5, name="web 1?"))

        assert fake.calls[1].path == (
            f"/apis/apps/v1/namespaces/{NAMESPACE}/deployments/web%201%3F/scale"
        )

    async def test_the_namespace_is_percent_encoded(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5, namespace="my ns?"))

        assert fake.calls[1].path == "/apis/apps/v1/namespaces/my%20ns%3F/deployments/web/scale"


class TestClientConstruction:
    """The REST core is built from the session context and the block's rows."""

    async def test_the_context_comes_from_the_session(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))
        context = fake.factory.call_args.args[0]

        assert context.server == SERVER
        assert context.namespace == NAMESPACE
        assert context.token == "sa-tok"

    async def test_the_default_timeout_reaches_the_client(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.factory.call_args.args[1] == 30

    async def test_an_explicit_timeout_reaches_the_client(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5, timeout=45))

        assert fake.factory.call_args.args[1] == 45

    async def test_impersonation_rows_reach_the_client(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(
            fake,
            _valid_params(replicas=5, impersonate_user="qa-bot", impersonate_groups="dev, ops"),
        )

        assert fake.factory.call_args.kwargs["impersonate_user"] == "qa-bot"
        assert fake.factory.call_args.kwargs["impersonate_groups"] == ["dev", "ops"]

    async def test_no_impersonation_is_the_default(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert fake.factory.call_args.kwargs["impersonate_user"] is None
        assert fake.factory.call_args.kwargs["impersonate_groups"] is None


class TestKindIsAgnostic:
    """The verb is the same shape whatever kind serves a scale endpoint."""

    async def test_a_statefulset_is_read_and_patched_the_same_way(self) -> None:
        fake = _fake(*_scaling(1, 3), resources=_STATEFULSETS)

        await _execute(fake, _valid_params(kind="StatefulSet", name="db", replicas=3))

        assert [call.path for call in fake.calls] == [_STATEFULSET_SCALE, _STATEFULSET_SCALE]
        assert fake.calls[1].method == "PATCH"
        assert fake.calls[1].content_type == MERGE_PATCH
        assert fake.calls[1].body == {"spec": {"replicas": 3}}

    async def test_a_statefulset_summary_names_it_the_way_kubectl_does(self) -> None:
        fake = _fake(*_scaling(1, 3), resources=_STATEFULSETS)

        result = await _execute(fake, _valid_params(kind="StatefulSet", name="db", replicas=3))

        assert _row(result) == ["statefulset.apps/db", "scaled", 1, 3]

    async def test_a_custom_resource_type_reaches_an_arbitrary_kind(self) -> None:
        fake = _fake(*_scaling(2, 4), resources=_WIDGETS)
        params = _valid_params(
            resource_type="custom", kind_custom="Widget", name="gizmo", replicas=4
        )

        await _execute(fake, params)

        assert fake.discoveries == ["Widget"]
        assert [call.path for call in fake.calls] == [_WIDGET_SCALE, _WIDGET_SCALE]

    async def test_a_custom_kind_summary_carries_its_api_group(self) -> None:
        fake = _fake(*_scaling(2, 4), resources=_WIDGETS)
        params = _valid_params(
            resource_type="custom", kind_custom="Widget", name="gizmo", replicas=4
        )

        result = await _execute(fake, params)

        assert _row(result) == ["widget.example.com/gizmo", "scaled", 2, 4]

    async def test_a_kind_the_cluster_does_not_serve_is_a_discovery_miss(self) -> None:
        fake = FakeK8sClient(resources={})
        params = _valid_params(resource_type="custom", kind_custom="Widget")
        message = (
            "This cluster has no resource kind 'Widget' "
            "- check the spelling, or whether the CRD is installed"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, params)

        assert fake.calls == []


class TestScalabilityGuard:
    """A kind with no scale endpoint is refused by WAVE before anything is written."""

    async def test_the_refusal_names_the_kind(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(resource_type="custom", kind_custom="ConfigMap", name="probe-a")

        with pytest.raises(ValueError, match=exact(_cannot_scale("ConfigMap"))):
            await _execute(fake, params)

    async def test_no_patch_is_recorded_at_all(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(resource_type="custom", kind_custom="ConfigMap", name="probe-a")

        with pytest.raises(ValueError, match=exact(_cannot_scale("ConfigMap"))):
            await _execute(fake, params)

        assert [call.method for call in fake.calls] == ["GET"]
        assert fake.calls[0].path == _CONFIGMAP_SCALE

    async def test_a_custom_resource_with_no_scale_endpoint_is_refused_the_same_way(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_WIDGETS)
        params = _valid_params(resource_type="custom", kind_custom="Widget", name="gizmo")

        with pytest.raises(ValueError, match=exact(_cannot_scale("Widget"))):
            await _execute(fake, params)

        assert [call.method for call in fake.calls] == ["GET"]

    async def test_record_mode_records_the_refusal_instead_of_raising(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(
            resource_type="custom", kind_custom="ConfigMap", name="probe-a", on_error="record"
        )

        result = await _execute(fake, params)

        assert result["success"] is False
        assert result["error"] == _cannot_scale("ConfigMap")
        assert result["reason"] == "NotFound"

    async def test_record_mode_writes_nothing_either(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(
            resource_type="custom", kind_custom="ConfigMap", name="probe-a", on_error="record"
        )

        await _execute(fake, params)

        assert [call.method for call in fake.calls] == ["GET"]

    async def test_the_refusal_logs_the_scale_shaped_warn_line(self) -> None:
        fake = _fake(_NO_SCALE_SUBRESOURCE, resources=_CONFIGMAPS)
        params = _valid_params(
            resource_type="custom", kind_custom="ConfigMap", name="probe-a", on_error="record"
        )
        logger = MagicMock()

        await _execute(fake, params, logger)

        message = _cannot_scale("ConfigMap")
        logger.warn.assert_called_once_with(f"Scale failed (NotFound): {message}")

    async def test_a_missing_object_is_a_not_found_and_not_a_scalability_refusal(self) -> None:
        fake = _fake(_OBJECT_MISSING)
        message = f"K8s Deployment 'web' not found in namespace '{NAMESPACE}'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _valid_params(replicas=5))

    async def test_a_missing_object_writes_nothing(self) -> None:
        fake = _fake(_OBJECT_MISSING)

        with pytest.raises(ValueError):
            await _execute(fake, _valid_params(replicas=5))

        assert [call.method for call in fake.calls] == ["GET"]


class TestZeroSurvivesTheRoundTrip:
    """The scale response omits spec.replicas at zero, so a missing key reads as 0."""

    async def test_scaling_to_zero_sends_the_zero(self) -> None:
        fake = _fake((200, _scale_object(3)), (200, _scale_object(None)))

        await _execute(fake, _valid_params(replicas=0))

        assert fake.calls[1].body == {"spec": {"replicas": 0}}

    async def test_scaling_to_zero_reports_zero_and_not_absent(self) -> None:
        fake = _fake((200, _scale_object(3)), (200, _scale_object(None)))

        result = await _execute(fake, _valid_params(replicas=0))

        assert _row(result) == ["deployment.apps/web", "scaled", 3, 0]
        assert _row(result)[3] is not None

    async def test_scaling_from_zero_reads_the_missing_previous_as_zero(self) -> None:
        fake = _fake((200, _scale_object(None)), (200, _scale_object(2)))

        result = await _execute(fake, _valid_params(replicas=2))

        assert _row(result) == ["deployment.apps/web", "scaled", 0, 2]
        assert _row(result)[2] is not None

    async def test_zero_to_zero_reads_both_missing_keys_as_zero(self) -> None:
        fake = _fake((200, _scale_object(None)), (200, _scale_object(None)))

        result = await _execute(fake, _valid_params(replicas=0))

        assert _row(result) == ["deployment.apps/web", "scaled", 0, 0]

    async def test_a_scale_to_zero_still_succeeds(self) -> None:
        fake = _fake((200, _scale_object(3)), (200, _scale_object(None)))

        result = await _execute(fake, _valid_params(replicas=0))

        assert result["success"] is True
        assert result["error"] == ""


class TestNoWaitAndNoPoll:
    """The block writes the count and returns; nothing about the cluster's pace changes it."""

    async def test_exactly_one_read_and_one_write_are_issued(self) -> None:
        fake = _fake(*_scaling(2, 5))

        await _execute(fake, _valid_params(replicas=5))

        assert [(call.method, call.path) for call in fake.calls] == [
            ("GET", _DEPLOY_SCALE),
            ("PATCH", _DEPLOY_SCALE),
        ]

    async def test_a_still_converging_cluster_reports_the_written_count(self) -> None:
        fake = _fake(*_scaling(2, 5, observed=2))

        result = await _execute(fake, _valid_params(replicas=5))

        assert _row(result) == ["deployment.apps/web", "scaled", 2, 5]

    async def test_a_still_converging_cluster_is_not_polled(self) -> None:
        fake = _fake(*_scaling(2, 5, observed=2))

        await _execute(fake, _valid_params(replicas=5))

        assert len(fake.calls) == 2

    async def test_a_cluster_that_reports_no_status_at_all_changes_nothing(self) -> None:
        fake = _fake((200, _scale_object(2)), (200, _scale_object(5)))

        result = await _execute(fake, _valid_params(replicas=5))

        assert _row(result) == ["deployment.apps/web", "scaled", 2, 5]
        assert len(fake.calls) == 2

    async def test_a_scale_to_the_same_count_still_writes_once_and_returns(self) -> None:
        fake = _fake(*_scaling(3, 3))

        result = await _execute(fake, _valid_params(replicas=3))

        assert len(fake.calls) == 2
        assert _row(result) == ["deployment.apps/web", "scaled", 3, 3]


class TestSummaryTable:
    """Summary is a four-column table, one row per scaled object."""

    async def test_summary_is_a_wave_table(self) -> None:
        fake = _fake(*_scaling(2, 5))

        result = await _execute(fake, _valid_params(replicas=5))

        assert isinstance(result["summary"], Table)

    async def test_the_columns_are_the_four_pinned_names(self) -> None:
        fake = _fake(*_scaling(2, 5))

        result = await _execute(fake, _valid_params(replicas=5))

        assert result["summary"].col_names() == SUMMARY_COLUMNS

    async def test_the_two_count_columns_are_typed_integer(self) -> None:
        fake = _fake(*_scaling(2, 5))

        result = await _execute(fake, _valid_params(replicas=5))

        assert result["summary"].col_types() == SUMMARY_COLUMN_TYPES

    async def test_a_scale_from_two_to_five_is_one_row(self) -> None:
        fake = _fake(*_scaling(2, 5))

        result = await _execute(fake, _valid_params(replicas=5))

        assert result["summary"].row_count() == 1
        assert _row(result) == ["deployment.apps/web", "scaled", 2, 5]

    async def test_the_outcome_reads_scaled(self) -> None:
        fake = _fake(*_scaling(2, 5))

        result = await _execute(fake, _valid_params(replicas=5))

        assert _row(result)[1] == "scaled"


class TestOutputCore:
    """The output core and the empties a recorded failure leaves behind."""

    async def test_a_happy_scale_returns_exactly_the_declared_outputs(self) -> None:
        fake = _fake(*_scaling(2, 5))

        result = await _execute(fake, _valid_params(replicas=5))

        assert set(result) == {"summary", "success", "error", "reason"}

    async def test_a_happy_scale_carries_the_full_core(self) -> None:
        fake = _fake(*_scaling(2, 5))

        result = await _execute(fake, _valid_params(replicas=5))

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_record_mode_leaves_summary_as_an_empty_table(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"))

        assert isinstance(result["summary"], Table)
        assert result["summary"].row_count() == 0

    async def test_the_empty_table_still_carries_the_four_columns(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"))

        assert result["summary"].col_names() == SUMMARY_COLUMNS

    async def test_record_mode_returns_no_replica_counts_of_its_own(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"))

        assert set(result) == {"summary", "success", "error", "reason", "__block_warning"}


class TestErrorReasonGate:
    """The output gating, asserted the same way on all four write blocks."""

    def test_error_and_reason_declare_the_record_gate(self) -> None:
        outputs = _outputs_by_name(K8sScalePlugin())

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE

    def test_success_is_never_gated(self) -> None:
        assert "show_when" not in _outputs_by_name(K8sScalePlugin())["success"]

    def test_summary_is_never_gated(self) -> None:
        assert "show_when" not in _outputs_by_name(K8sScalePlugin())["summary"]

    def test_only_error_and_reason_are_gated(self) -> None:
        outputs = _outputs_by_name(K8sScalePlugin())
        gated = [name for name in EXPECTED_OUTPUT_ORDER if "show_when" in outputs[name]]

        assert gated == ["error", "reason"]

    async def test_fail_mode_raises_out_of_the_block(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))

        with pytest.raises(ValueError, match=exact("Kubernetes API permission denied: denied")):
            await _execute(fake, _valid_params(replicas=5))

    async def test_fail_mode_binds_no_value_for_error_or_reason(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))
        result: Any = None

        with pytest.raises(ValueError):
            result = await _execute(fake, _valid_params(replicas=5, on_error="fail"))

        assert result is None

    async def test_record_mode_returns_normally_with_all_three_filled(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"))

        assert result["success"] is False
        assert result["error"] == "Kubernetes API permission denied: denied"
        assert result["reason"] == "Forbidden"

    async def test_fail_is_the_default_on_error_mode(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))
        params = _valid_params(replicas=5)

        assert "on_error" not in params
        with pytest.raises(ValueError, match=exact("Kubernetes API permission denied: denied")):
            await _execute(fake, params)


class TestFailureHandling:
    """Cluster refusals read as a scale, and a recorded one asks for amber."""

    async def test_a_server_error_on_the_write_says_the_scale_failed(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = _fake((200, _scale_object(2)), (503, _failure("ServiceUnavailable", detail, 503)))
        message = (
            f"Kubernetes could not scale Deployment 'web' in namespace '{NAMESPACE}': {detail}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _valid_params(replicas=5))

    async def test_a_server_error_on_the_read_says_the_scale_failed_too(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = _fake((503, _failure("ServiceUnavailable", detail, 503)))
        message = (
            f"Kubernetes could not scale Deployment 'web' in namespace '{NAMESPACE}': {detail}"
        )

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(fake, _valid_params(replicas=5))

    async def test_a_recorded_server_error_logs_the_scale_shaped_warn_line(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = _fake((200, _scale_object(2)), (503, _failure("ServiceUnavailable", detail, 503)))
        logger = MagicMock()

        await _execute(fake, _valid_params(replicas=5, on_error="record"), logger)

        logger.warn.assert_called_once_with(
            "Scale failed (ServiceUnavailable): Kubernetes could not scale Deployment 'web' "
            f"in namespace '{NAMESPACE}': {detail}"
        )

    async def test_a_denied_write_records_the_permission_row(self) -> None:
        denial = 'deployments.apps "web" is forbidden: User "wave" cannot patch resource'
        fake = _fake((200, _scale_object(2)), (403, _failure("Forbidden", denial, 403)))

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"), None)

        assert result["error"] == f"Kubernetes API permission denied: {denial}"
        assert result["reason"] == "Forbidden"

    async def test_an_expired_token_records_the_authentication_row(self) -> None:
        fake = _fake((401, _failure("Unauthorized", "token expired", 401)))

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"))

        assert result["error"] == "Kubernetes API authentication failed: token expired"
        assert result["reason"] == "Unauthorized"

    async def test_a_recorded_failure_carries_the_warning_signal(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"))

        assert result["__block_warning"] is True

    async def test_a_happy_scale_logs_info_and_asks_for_nothing(self) -> None:
        fake = _fake(*_scaling(2, 5))
        logger = MagicMock()

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"), logger)

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0
        assert logger.info.call_count == 1

    async def test_fail_mode_logs_no_warn_line(self) -> None:
        fake = _fake((403, _failure("Forbidden", "denied", 403)))
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(fake, _valid_params(replicas=5), logger)

        assert logger.warn.call_count == 0

    async def test_a_recorded_discovery_denial_reads_as_a_denial(self) -> None:
        denial = 'User "wave" cannot list resource "apis"'
        fake = DeniedDiscoveryClient(403, _failure("Forbidden", denial, 403))
        logger = MagicMock()

        result = await _execute(fake, _valid_params(replicas=5, on_error="record"), logger)

        assert result["error"] == f"Kubernetes API permission denied: {denial}"
        assert result["reason"] == "Forbidden"
        assert fake.calls == []


class TestAlwaysHardFail:
    """Dependency errors raise in both on_error modes."""

    @_BOTH_MODES
    async def test_a_bogus_session_raises(self, mode: str) -> None:
        params = _valid_params(replicas=5, on_error=mode)
        params["session"] = "not-a-kubeconfig"
        fake = _fake(*_scaling(2, 5))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            await _execute(fake, params)

    @_BOTH_MODES
    async def test_a_missing_session_raises(self, mode: str) -> None:
        params = _valid_params(replicas=5, on_error=mode)
        del params["session"]
        fake = _fake(*_scaling(2, 5))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            await _execute(fake, params)

    @_BOTH_MODES
    async def test_a_transport_failure_raises(self, mode: str) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = _fake(K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _valid_params(replicas=5, on_error=mode))

    @_BOTH_MODES
    async def test_a_tls_failure_raises(self, mode: str) -> None:
        message = f"Could not verify the TLS certificate of {SERVER}: self-signed certificate"
        fake = _fake(K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _valid_params(replicas=5, on_error=mode))

    @_BOTH_MODES
    async def test_a_timeout_on_the_write_raises(self, mode: str) -> None:
        message = f"Kubernetes API request PATCH {_DEPLOY_SCALE} timed out after 30 seconds"
        fake = _fake((200, _scale_object(2)), K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(fake, _valid_params(replicas=5, on_error=mode))

    @_BOTH_MODES
    async def test_a_negative_replica_count_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=exact(_NEGATIVE_REPLICAS)):
            await K8sScalePlugin().validate(_valid_params(replicas=-1, on_error=mode))

    @_BOTH_MODES
    async def test_an_invalid_kind_raises(self, mode: str) -> None:
        message = (
            "Parameter 'kind' must be one of: Deployment, ReplicaSet, ReplicationController, "
            "StatefulSet; Actual value was 'ConfigMap'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sScalePlugin().validate(_valid_params(kind="ConfigMap", on_error=mode))

    @_BOTH_MODES
    async def test_a_non_positive_timeout_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sScalePlugin().validate(_valid_params(timeout=0, on_error=mode))


class TestNamespaceDescription:
    """A write block's Namespace row says what it writes to, not what it reads from."""

    def test_the_namespace_row_does_not_say_read_from(self) -> None:
        description = _params_by_name(K8sScalePlugin())["namespace"]["description"]

        assert "read from" not in description

    def test_the_namespace_row_still_names_the_session_default(self) -> None:
        description = _params_by_name(K8sScalePlugin())["namespace"]["description"]

        assert "session default" in description
