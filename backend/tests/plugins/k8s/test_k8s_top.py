"""K8s Top plugin tests (REQ-5.1.1, REQ-3.3.2.1).

Top reads resource usage from the aggregated metrics API for pods or nodes,
converts the wire quantities into raw cores and bytes, and never returns a
percentage. A cluster with no metrics API is a dependency error, so it hard
fails in both on_error modes.
"""

from typing import Any
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    SERVER,
    Call,
    FakeK8sClient,
    block_params,
    exact,
    execute_context,
    required_conditions,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.core.table import Table
from wavecore.plugins.k8s_top import K8sTopPlugin

_CLIENT_TARGET = "wavecore.connectivity.k8s.verbs.top.K8sClient"

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "scope",
    "select_by",
    "name",
    "label_selector",
    "include_containers",
    "all_namespaces",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

_PROBE_PATH = "/apis/metrics.k8s.io/v1beta1"
_NODE_METRICS_PATH = "/apis/metrics.k8s.io/v1beta1/nodes"
_POD_METRICS_PATH = f"/apis/metrics.k8s.io/v1beta1/namespaces/{NAMESPACE}/pods"
_ALL_POD_METRICS_PATH = "/apis/metrics.k8s.io/v1beta1/pods"
_NODES_PATH = "/api/v1/nodes"

_PROBE_OK = (200, {"kind": "APIResourceList", "groupVersion": "metrics.k8s.io/v1beta1"})
_PROBE_MISSING = (
    404,
    {
        "kind": "Status",
        "reason": "NotFound",
        "message": "the server could not find the requested resource",
    },
)

_METRICS_MISSING = (
    "This cluster does not serve the metrics API 'metrics.k8s.io/v1beta1' - "
    "check whether metrics-server is installed"
)
_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)

_BOTH_MODES = pytest.mark.parametrize("mode", ["fail", "record"])


def _container(name: str, cpu: str, memory: str) -> dict[str, Any]:
    return {"name": name, "usage": {"cpu": cpu, "memory": memory}}


def _pod_metrics(
    name: str, containers: list[dict[str, Any]], namespace: str = NAMESPACE
) -> dict[str, Any]:
    return {
        "kind": "PodMetrics",
        "apiVersion": "metrics.k8s.io/v1beta1",
        "metadata": {"name": name, "namespace": namespace},
        "timestamp": "2026-08-22T10:00:00Z",
        "window": "30s",
        "containers": containers,
    }


def _pod_metrics_list(*items: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "PodMetricsList",
        "apiVersion": "metrics.k8s.io/v1beta1",
        "items": list(items),
    }


def _node_metrics(name: str, cpu: str, memory: str) -> dict[str, Any]:
    return {
        "kind": "NodeMetrics",
        "apiVersion": "metrics.k8s.io/v1beta1",
        "metadata": {"name": name},
        "timestamp": "2026-08-22T10:00:00Z",
        "window": "30s",
        "usage": {"cpu": cpu, "memory": memory},
    }


def _node_metrics_list(*items: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "NodeMetricsList",
        "apiVersion": "metrics.k8s.io/v1beta1",
        "items": list(items),
    }


def _node(name: str, cpu: str, memory: str, alloc_cpu: str, alloc_memory: str) -> dict[str, Any]:
    return {
        "kind": "Node",
        "apiVersion": "v1",
        "metadata": {"name": name},
        "status": {
            "capacity": {"cpu": cpu, "memory": memory, "pods": "110"},
            "allocatable": {"cpu": alloc_cpu, "memory": alloc_memory, "pods": "110"},
        },
    }


def _node_list(*items: dict[str, Any]) -> dict[str, Any]:
    return {"kind": "NodeList", "apiVersion": "v1", "items": list(items)}


_WEB_1 = _pod_metrics(
    "web-1",
    [_container("app", "250002515n", "3128772Ki"), _container("sidecar", "1500u", "512Mi")],
)
_API_7 = _pod_metrics("api-7", [_container("api", "2", "2Gi")])
_POD_LIST = _pod_metrics_list(_WEB_1, _API_7)

_NODE_0 = _node_metrics("kwok-node-0", "236785417n", "3128772Ki")
_NODE_1 = _node_metrics("kwok-node-1", "12m", "1048576")
_NODE_LIST = _node_metrics_list(_NODE_0, _NODE_1)
_NODE_0_OBJECT = _node("kwok-node-0", "8", "32Gi", "7900m", "31Gi")
_NODE_1_OBJECT = _node("kwok-node-1", "4", "8Gi", "4", "8Gi")
_NODE_2_OBJECT = _node("kwok-node-2", "4", "8Gi", "4", "8Gi")
_NODE_OBJECT_LIST = _node_list(_NODE_0_OBJECT, _NODE_1_OBJECT)
_THREE_NODE_OBJECTS = _node_list(_NODE_0_OBJECT, _NODE_1_OBJECT, _NODE_2_OBJECT)

# web-1: 250002515n + 1500u cores, 3128772Ki + 512Mi bytes.
_WEB_1_CPU = 0.251502515
_WEB_1_MEMORY = 3740733440


def _params_by_name(plugin: K8sTopPlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


RECORD_GATE = {"field": "on_error", "values": ["record"]}

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


def _outputs_by_name(plugin: K8sTopPlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _valid_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"scope": "pod", "select_by": "name", "name": "web-1"}
    params.update(overrides)
    return block_params(**params)


def _fake(*responses: Any) -> FakeK8sClient:
    """A fake core that answers the availability probe, then the scripted reads."""
    return FakeK8sClient(responses=[_PROBE_OK, *responses])


async def _execute(params: dict[str, Any], fake: FakeK8sClient, logger: Any = None) -> Any:
    factory = MagicMock(return_value=fake)
    fake.factory = factory
    with patch(_CLIENT_TARGET, factory):
        return await K8sTopPlugin().execute(execute_context(params, logger=logger))


def _path_of(call: Call) -> str:
    return urlsplit(call.path).path


def _query_of(call: Call) -> dict[str, list[str]]:
    return parse_qs(urlsplit(call.path).query)


def _rows_by_name(result: Any) -> dict[str, Any]:
    return {row["NAME"]: row for row in result["usage"]}


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_plugin_instantiates(self) -> None:
        assert K8sTopPlugin() is not None

    def test_identity(self) -> None:
        meta = K8sTopPlugin().metadata

        assert meta["id"] == "k8s-top"
        assert meta["name"] == "K8s Top"
        assert meta["category"] == "kubernetes"
        assert meta["version"] == "1.0.0"
        assert meta["return_type"] == "map"

    def test_authorship_and_tags(self) -> None:
        meta = K8sTopPlugin().metadata

        assert meta["author"] == "WAVE Framework"
        assert meta["tags"][:2] == ["kubernetes", "k8s"]

    def test_remotable_is_true(self) -> None:
        assert K8sTopPlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sTopPlugin().metadata["proxy_support"] == "supported"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sTopPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sTopPlugin())

        for name in ("session", "scope", "select_by"):
            assert params[name]["required"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name in ("session", "scope", "select_by"):
                continue
            assert params[name].get("required") is False

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sTopPlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["scope"]["type"] == "string"
        assert params["select_by"]["type"] == "string"
        assert params["name"]["type"] == "string"
        assert params["label_selector"]["type"] == "string"
        assert params["include_containers"]["type"] == "boolean"
        assert params["all_namespaces"]["type"] == "boolean"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["on_error"]["type"] == "string"

    def test_defaults(self) -> None:
        params = _params_by_name(K8sTopPlugin())

        assert params["timeout"]["default"] == 30
        assert params["scope"]["default"] == "pod"
        assert params["select_by"]["default"] == "all"
        assert params["include_containers"]["default"] is False
        assert params["all_namespaces"]["default"] is False
        assert params["on_error"]["default"] == "fail"

    def test_only_the_session_parameter_is_secret(self) -> None:
        params = _params_by_name(K8sTopPlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sTopPlugin())

        for name in (
            "session",
            "name",
            "label_selector",
            "namespace",
            "impersonate_user",
            "impersonate_groups",
        ):
            assert params[name]["trim"] is True

    def test_enum_parameters(self) -> None:
        params = _params_by_name(K8sTopPlugin())
        enum_params = {name for name, param in params.items() if "enum_values" in param}

        assert enum_params == {"scope", "select_by", "on_error"}
        assert params["scope"]["enum_values"] == ["pod", "node"]
        assert params["select_by"]["enum_values"] == ["all", "name", "selector"]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sTopPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_output_schema(self) -> None:
        outputs = K8sTopPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("usage", "table"),
            ("count", "integer"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_no_output_is_secret_flagged(self) -> None:
        for output in _outputs_by_name(K8sTopPlugin()).values():
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sTopPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name(K8sTopPlugin())

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS


class TestConditionalRequirements:
    """The declarations the pre-run gate reads to refuse a half-filled block."""

    def test_name_is_required_under_select_by_name(self) -> None:
        params = _params_by_name(K8sTopPlugin())

        assert params["name"]["required_when"] == {"field": "select_by", "values": ["name"]}

    def test_name_is_the_only_conditionally_required_param(self) -> None:
        params = _params_by_name(K8sTopPlugin())

        conditional = [n for n in EXPECTED_PARAM_ORDER if required_conditions(params[n])]

        assert conditional == ["name"]

    def test_name_is_not_also_unconditionally_required(self) -> None:
        params = _params_by_name(K8sTopPlugin())

        assert params["name"].get("required") is False

    def test_the_condition_reads_the_default_validate_falls_back_to(self) -> None:
        """validate() reads select_by with a fallback of 'all'; the gate reads the default."""
        params = _params_by_name(K8sTopPlugin())

        assert params["select_by"]["default"] == "all"


class TestValidation:
    """validate() - required params, conditional name, ranges, enums."""

    async def test_name_mode_params_pass(self) -> None:
        await K8sTopPlugin().validate(_valid_params())

    async def test_full_params_pass(self) -> None:
        await K8sTopPlugin().validate(
            _valid_params(
                scope="pod",
                select_by="selector",
                name="",
                label_selector="app=web",
                include_containers=True,
                all_namespaces=True,
                timeout=45,
                impersonate_user="qa-bot",
                impersonate_groups="dev,ops",
                on_error="record",
            )
        )

    async def test_missing_session(self) -> None:
        params = {"scope": "pod", "select_by": "all"}

        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sTopPlugin().validate(params)

    async def test_empty_session_reports_the_empty_case(self) -> None:
        params = {"session": "", "scope": "pod", "select_by": "all"}

        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sTopPlugin().validate(params)

    async def test_missing_name_under_select_by_name(self) -> None:
        params = _valid_params()
        del params["name"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sTopPlugin().validate(params)

    async def test_empty_name_under_select_by_name_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: name$"):
            await K8sTopPlugin().validate(_valid_params(name=""))

    async def test_name_is_not_required_under_select_by_all(self) -> None:
        params = _valid_params(select_by="all")
        del params["name"]

        await K8sTopPlugin().validate(params)

    async def test_name_is_not_required_under_select_by_selector(self) -> None:
        params = _valid_params(select_by="selector", label_selector="app=web")
        del params["name"]

        await K8sTopPlugin().validate(params)

    async def test_invalid_scope_is_rejected(self) -> None:
        message = "Parameter 'scope' must be one of: pod, node; Actual value was 'cluster'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sTopPlugin().validate(_valid_params(scope="cluster"))

    async def test_scope_is_case_sensitive(self) -> None:
        message = "Parameter 'scope' must be one of: pod, node; Actual value was 'Pod'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sTopPlugin().validate(_valid_params(scope="Pod"))

    async def test_invalid_select_by_is_rejected(self) -> None:
        message = (
            "Parameter 'select_by' must be one of: all, name, selector; Actual value was 'label'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sTopPlugin().validate(_valid_params(select_by="label"))

    async def test_invalid_on_error_is_rejected(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sTopPlugin().validate(_valid_params(on_error="ignore"))

    async def test_zero_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sTopPlugin().validate(_valid_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sTopPlugin().validate(_valid_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sTopPlugin().validate(_valid_params(timeout=45))

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        params = _valid_params(impersonate_groups="qa, ops")

        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sTopPlugin().validate(params)

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sTopPlugin().validate(
            _valid_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )


class TestExecutePodScope:
    """The pod metrics path, namespace resolution, and target selection."""

    async def test_the_metrics_api_is_probed_before_the_first_read(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all"), fake)

        assert _path_of(fake.calls[0]) == _PROBE_PATH
        assert fake.calls[0].method == "GET"

    async def test_all_mode_lists_the_session_namespace(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert _path_of(fake.calls[1]) == _POD_METRICS_PATH
        assert result["count"] == 2

    async def test_all_mode_returns_every_pod(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert sorted(_rows_by_name(result)) == ["api-7", "web-1"]

    async def test_all_namespaces_drops_the_namespace_segment(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all", all_namespaces=True), fake)

        assert _path_of(fake.calls[1]) == _ALL_POD_METRICS_PATH

    async def test_a_namespace_value_targets_that_namespace(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all", namespace="ops"), fake)

        assert _path_of(fake.calls[1]) == "/apis/metrics.k8s.io/v1beta1/namespaces/ops/pods"

    async def test_all_namespaces_wins_over_a_specified_namespace(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all", all_namespaces=True, namespace="ops"), fake)

        assert _path_of(fake.calls[1]) == _ALL_POD_METRICS_PATH

    async def test_name_mode_narrows_to_the_single_pod(self) -> None:
        fake = _fake((200, _WEB_1))

        result = await _execute(_valid_params(name="web-1"), fake)

        assert _path_of(fake.calls[1]) == f"{_POD_METRICS_PATH}/web-1"
        assert [row["NAME"] for row in result["usage"]] == ["web-1"]
        assert result["count"] == 1

    async def test_name_mode_sends_no_label_selector(self) -> None:
        fake = _fake((200, _WEB_1))

        await _execute(_valid_params(name="web-1"), fake)

        assert _query_of(fake.calls[1]) == {}

    async def test_selector_mode_puts_the_label_selector_on_the_wire(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="selector", label_selector="app=web"), fake)

        assert _path_of(fake.calls[1]) == _POD_METRICS_PATH
        assert _query_of(fake.calls[1])["labelSelector"] == ["app=web"]

    async def test_selector_mode_returns_every_match(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="selector", label_selector="app=web"), fake)

        assert result["count"] == 2

    async def test_an_empty_pod_list_is_a_success_with_no_rows(self) -> None:
        fake = _fake((200, _pod_metrics_list()))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert len(result["usage"]) == 0
        assert result["count"] == 0
        assert result["success"] is True

    async def test_pod_rows_carry_no_capacity_or_allocatable(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert result["usage"].col_names() == ["NAME", "CPU", "MEMORY"]

    async def test_pod_scope_reads_only_the_metrics_api(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all"), fake)

        assert [_path_of(call) for call in fake.calls] == [_PROBE_PATH, _POD_METRICS_PATH]


class TestExecuteNodeScope:
    """The node metrics path and the node objects that carry capacity."""

    async def test_all_mode_lists_node_metrics_and_node_objects(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _NODE_OBJECT_LIST))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)

        assert [_path_of(call) for call in fake.calls] == [
            _PROBE_PATH,
            _NODE_METRICS_PATH,
            _NODES_PATH,
        ]
        assert result["count"] == 2

    async def test_name_mode_narrows_to_the_single_node(self) -> None:
        fake = _fake((200, _NODE_0), (200, _NODE_0_OBJECT))

        result = await _execute(_valid_params(scope="node", name="kwok-node-0"), fake)

        assert _path_of(fake.calls[1]) == f"{_NODE_METRICS_PATH}/kwok-node-0"
        assert _path_of(fake.calls[2]) == f"{_NODES_PATH}/kwok-node-0"
        assert [row["NAME"] for row in result["usage"]] == ["kwok-node-0"]

    async def test_selector_mode_puts_the_label_selector_on_the_wire(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _NODE_OBJECT_LIST))

        await _execute(
            _valid_params(scope="node", select_by="selector", label_selector="role=worker"),
            fake,
        )

        assert _path_of(fake.calls[1]) == _NODE_METRICS_PATH
        assert _query_of(fake.calls[1])["labelSelector"] == ["role=worker"]

    async def test_no_namespace_reaches_the_node_paths(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _NODE_OBJECT_LIST))

        await _execute(_valid_params(scope="node", select_by="all", namespace="ops"), fake)

        for call in fake.calls:
            assert "/namespaces/" not in call.path

    async def test_node_rows_carry_capacity_and_allocatable(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _NODE_OBJECT_LIST))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)
        row = _rows_by_name(result)["kwok-node-0"]

        assert result["usage"].col_names() == [
            "NAME",
            "CPU",
            "MEMORY",
            "CAPACITY CPU",
            "CAPACITY MEMORY",
            "ALLOCATABLE CPU",
            "ALLOCATABLE MEMORY",
        ]
        assert row["CAPACITY CPU"] is not None
        assert row["CAPACITY MEMORY"] is not None
        assert row["ALLOCATABLE CPU"] is not None
        assert row["ALLOCATABLE MEMORY"] is not None

    async def test_node_capacity_and_allocatable_are_converted(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _NODE_OBJECT_LIST))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)
        row = _rows_by_name(result)["kwok-node-0"]

        assert row["CAPACITY CPU"] == pytest.approx(8.0)
        assert row["CAPACITY MEMORY"] == 34359738368
        assert row["ALLOCATABLE CPU"] == pytest.approx(7.9)
        assert row["ALLOCATABLE MEMORY"] == 33285996544

    async def test_node_usage_is_raw_quantities_not_percentages(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _NODE_OBJECT_LIST))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)
        row = _rows_by_name(result)["kwok-node-0"]

        assert row["CPU"] == pytest.approx(0.236785417)
        assert row["MEMORY"] == 3203862528
        assert [name for name in result["usage"].col_names() if "%" in name] == []

    async def test_an_empty_node_list_is_a_success_with_no_rows(self) -> None:
        fake = _fake((200, _node_metrics_list()), (200, _node_list()))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)

        assert len(result["usage"]) == 0
        assert result["count"] == 0
        assert result["success"] is True


class TestIncludeContainers:
    """The per-container breakdown, pods only."""

    async def test_container_key_is_absent_while_unticked(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert "CONTAINER" not in result["usage"].col_names()

    async def test_unticked_gives_one_row_per_pod(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert [row["NAME"] for row in result["usage"]] == ["web-1", "api-7"]
        assert result["count"] == 2

    async def test_pod_row_totals_are_the_sum_over_its_containers(self) -> None:
        fake = _fake((200, _WEB_1))

        result = await _execute(_valid_params(name="web-1"), fake)
        row = result["usage"][0]

        assert row["CPU"] == pytest.approx(_WEB_1_CPU)
        assert row["MEMORY"] == _WEB_1_MEMORY

    async def test_ticked_breaks_each_pod_into_container_rows(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all", include_containers=True), fake)

        assert [(row["NAME"], row["CONTAINER"]) for row in result["usage"]] == [
            ("web-1", "app"),
            ("web-1", "sidecar"),
            ("api-7", "api"),
        ]
        assert result["count"] == 3

    async def test_container_rows_carry_that_container_usage_only(self) -> None:
        fake = _fake((200, _WEB_1))

        result = await _execute(_valid_params(name="web-1", include_containers=True), fake)
        rows = {row["CONTAINER"]: row for row in result["usage"]}

        assert result["usage"].col_names() == ["NAME", "CONTAINER", "CPU", "MEMORY"]
        assert rows["app"]["CPU"] == pytest.approx(0.250002515)
        assert rows["app"]["MEMORY"] == 3203862528
        assert rows["sidecar"]["CPU"] == pytest.approx(0.0015)
        assert rows["sidecar"]["MEMORY"] == 536870912

    async def test_node_rows_never_break_down_by_container(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _NODE_OBJECT_LIST))

        result = await _execute(
            _valid_params(scope="node", select_by="all", include_containers=True), fake
        )

        assert result["count"] == 2
        assert "CONTAINER" not in result["usage"].col_names()


class TestUnitConversion:
    """Wire quantity strings become raw cores and bytes."""

    @pytest.mark.parametrize(
        ("wire", "cores"),
        [
            ("250002515n", 0.250002515),
            ("1500u", 0.0015),
            ("500m", 0.5),
            ("2", 2.0),
            ("3k", 3000.0),
            ("0", 0.0),
        ],
    )
    async def test_cpu_quantities_convert_to_cores(self, wire: str, cores: float) -> None:
        pod = _pod_metrics("solo", [_container("app", wire, "1Ki")])
        fake = _fake((200, pod))

        result = await _execute(_valid_params(name="solo"), fake)

        assert result["usage"][0]["CPU"] == pytest.approx(cores)

    @pytest.mark.parametrize(
        ("wire", "byte_count"),
        [
            ("3128772Ki", 3203862528),
            ("512Mi", 536870912),
            ("2Gi", 2147483648),
            ("1Ti", 1099511627776),
            ("1048576", 1048576),
            ("64M", 64000000),
            ("2G", 2000000000),
            ("512k", 512000),
            ("0", 0),
        ],
    )
    async def test_memory_quantities_convert_to_bytes(self, wire: str, byte_count: int) -> None:
        pod = _pod_metrics("solo", [_container("app", "1m", wire)])
        fake = _fake((200, pod))

        result = await _execute(_valid_params(name="solo"), fake)

        assert result["usage"][0]["MEMORY"] == byte_count

    async def test_node_quantities_use_the_same_conversion(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _NODE_OBJECT_LIST))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)
        row = _rows_by_name(result)["kwok-node-1"]

        assert row["CPU"] == pytest.approx(0.012)
        assert row["MEMORY"] == 1048576


class TestOutputCore:
    """The output core and failure handling on ordinary cluster errors."""

    async def test_outputs_are_exactly_the_declared_names(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert set(result) == {"usage", "count", "success", "error", "reason"}

    async def test_usage_is_a_table(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert isinstance(result["usage"], Table)
        assert result["usage"].col_names() == ["NAME", "CPU", "MEMORY"]

    async def test_happy_path_sets_the_success_core(self) -> None:
        fake = _fake((200, _POD_LIST))

        result = await _execute(_valid_params(select_by="all"), fake)

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_record_mode_records_a_forbidden_read(self) -> None:
        body = {
            "kind": "Status",
            "reason": "Forbidden",
            "message": 'pods.metrics.k8s.io is forbidden: User "wave-tests" cannot list resource',
        }
        fake = _fake((403, body))

        result = await _execute(_valid_params(select_by="all", on_error="record"), fake)

        assert result["success"] is False
        assert result["error"] == f"Kubernetes API permission denied: {body['message']}"
        assert result["reason"] == "Forbidden"

    async def test_record_mode_leaves_usage_and_count_at_empty_defaults(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        result = await _execute(_valid_params(select_by="all", on_error="record"), fake)

        assert len(result["usage"]) == 0
        assert result["count"] == 0

    async def test_fail_mode_raises_on_a_forbidden_read(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        with pytest.raises(ValueError, match=exact("Kubernetes API permission denied: denied")):
            await _execute(_valid_params(select_by="all", on_error="fail"), fake)

    async def test_the_default_on_error_is_fail(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        with pytest.raises(ValueError, match=exact("Kubernetes API permission denied: denied")):
            await _execute(_valid_params(select_by="all"), fake)

    async def test_fail_mode_raises_when_the_named_pod_is_absent(self) -> None:
        fake = _fake((404, {"reason": "NotFound", "message": "pods 'web-1' not found"}))
        message = f"K8s Pod 'web-1' not found in namespace '{NAMESPACE}'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(_valid_params(name="web-1"), fake)

    async def test_record_mode_records_an_absent_named_pod(self) -> None:
        fake = _fake((404, {"reason": "NotFound", "message": "pods 'web-1' not found"}))

        result = await _execute(_valid_params(name="web-1", on_error="record"), fake)

        assert result["success"] is False
        assert result["error"] == f"K8s Pod 'web-1' not found in namespace '{NAMESPACE}'"
        assert result["reason"] == "NotFound"

    async def test_record_mode_records_an_absent_named_node(self) -> None:
        missing = (404, {"reason": "NotFound", "message": "nodes 'gone' not found"})
        fake = _fake(missing, missing)

        result = await _execute(_valid_params(scope="node", name="gone", on_error="record"), fake)

        assert result["error"] == "K8s Node 'gone' not found"
        assert result["reason"] == "NotFound"

    async def test_record_mode_records_an_authentication_failure(self) -> None:
        fake = _fake((401, {"reason": "Unauthorized", "message": "token expired"}))

        result = await _execute(_valid_params(select_by="all", on_error="record"), fake)

        assert result["error"] == "Kubernetes API authentication failed: token expired"
        assert result["reason"] == "Unauthorized"

    async def test_a_server_error_on_a_named_read_says_the_read_failed(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = _fake((503, {"reason": "ServiceUnavailable", "message": detail}))
        message = f"Kubernetes could not read Pod 'web-1' in namespace '{NAMESPACE}': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(_valid_params(name="web-1"), fake)

    async def test_a_server_error_on_an_unnamed_read_names_the_kind_not_an_object(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = _fake((503, {"reason": "ServiceUnavailable", "message": detail}))

        result = await _execute(_valid_params(select_by="all", on_error="record"), fake)

        assert result["error"] == (
            f"Kubernetes could not list Pod objects in namespace '{NAMESPACE}': {detail}"
        )
        assert result["reason"] == "ServiceUnavailable"


class TestGatewayAnswers:
    """Something other than the cluster answering reads the same as it does in Get."""

    async def test_401_with_a_body_that_is_not_a_status_ends_with_the_http_status(self) -> None:
        fake = _fake((401, {}))
        message = f"Kubernetes could not read Pod 'web-1' in namespace '{NAMESPACE}' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(_valid_params(name="web-1"), fake)

    async def test_403_on_an_unnamed_read_names_the_kind_not_an_object(self) -> None:
        fake = _fake((403, {}))
        message = f"Kubernetes could not list Pod objects in namespace '{NAMESPACE}' (HTTP 403)"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(_valid_params(select_by="all"), fake)

    async def test_a_gateway_401_is_recordable_with_an_empty_reason(self) -> None:
        fake = _fake((401, {}))

        result = await _execute(_valid_params(name="web-1", on_error="record"), fake)

        assert result["error"] == (
            f"Kubernetes could not read Pod 'web-1' in namespace '{NAMESPACE}' (HTTP 401)"
        )
        assert result["reason"] == ""


class TestMissingMetricsApi:
    """The carve-out: an absent metrics API is a dependency error."""

    async def test_fail_mode_raises_the_metrics_message(self) -> None:
        fake = FakeK8sClient(responses=[_PROBE_MISSING])

        with pytest.raises(ValueError, match=exact(_METRICS_MISSING)):
            await _execute(_valid_params(select_by="all", on_error="fail"), fake)

    async def test_record_mode_also_raises_the_metrics_message(self) -> None:
        fake = FakeK8sClient(responses=[_PROBE_MISSING])

        with pytest.raises(ValueError, match=exact(_METRICS_MISSING)):
            await _execute(_valid_params(select_by="all", on_error="record"), fake)

    async def test_record_mode_also_raises_for_the_node_scope(self) -> None:
        fake = FakeK8sClient(responses=[_PROBE_MISSING])

        with pytest.raises(ValueError, match=exact(_METRICS_MISSING)):
            await _execute(_valid_params(scope="node", select_by="all", on_error="record"), fake)

    @_BOTH_MODES
    async def test_no_metrics_read_follows_the_failed_probe(self, mode: str) -> None:
        fake = FakeK8sClient(responses=[_PROBE_MISSING])

        with pytest.raises(ValueError, match=exact(_METRICS_MISSING)):
            await _execute(_valid_params(select_by="all", on_error=mode), fake)

        assert [_path_of(call) for call in fake.calls] == [_PROBE_PATH]


class TestAlwaysHardFail:
    """Dependency errors raise in both on_error modes."""

    @_BOTH_MODES
    async def test_a_bogus_session_raises(self, mode: str) -> None:
        params = _valid_params(select_by="all", on_error=mode)
        params["session"] = "not-a-kubeconfig"
        fake = _fake((200, _POD_LIST))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            await _execute(params, fake)

    @_BOTH_MODES
    async def test_a_missing_session_raises(self, mode: str) -> None:
        params = _valid_params(select_by="all", on_error=mode)
        del params["session"]
        fake = _fake((200, _POD_LIST))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            await _execute(params, fake)

    @_BOTH_MODES
    async def test_a_transport_failure_raises(self, mode: str) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(_valid_params(select_by="all", on_error=mode), fake)

    @_BOTH_MODES
    async def test_a_tls_failure_raises(self, mode: str) -> None:
        message = f"Could not verify the TLS certificate of {SERVER}: self-signed certificate"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(_valid_params(select_by="all", on_error=mode), fake)

    @_BOTH_MODES
    async def test_a_timeout_raises(self, mode: str) -> None:
        message = f"Kubernetes API request GET {_POD_METRICS_PATH} timed out after 30 seconds"
        fake = _fake(K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            await _execute(_valid_params(select_by="all", on_error=mode), fake)

    @_BOTH_MODES
    async def test_an_invalid_enum_raises(self, mode: str) -> None:
        message = "Parameter 'scope' must be one of: pod, node; Actual value was 'cluster'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sTopPlugin().validate(_valid_params(scope="cluster", on_error=mode))

    @_BOTH_MODES
    async def test_a_non_positive_timeout_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sTopPlugin().validate(_valid_params(timeout=0, on_error=mode))


class TestClientConstruction:
    """The REST core is built from the session context and the block's rows."""

    async def test_the_context_comes_from_the_session(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all"), fake)
        context = fake.factory.call_args.args[0]

        assert context.server == SERVER
        assert context.namespace == NAMESPACE
        assert context.token == "sa-tok"

    async def test_the_default_timeout_reaches_the_client(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all"), fake)

        assert fake.factory.call_args.args[1] == 30

    async def test_an_explicit_timeout_reaches_the_client(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all", timeout=45), fake)

        assert fake.factory.call_args.args[1] == 45

    async def test_impersonation_rows_reach_the_client(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(
            _valid_params(
                select_by="all", impersonate_user="qa-bot", impersonate_groups="dev, ops"
            ),
            fake,
        )

        assert fake.factory.call_args.kwargs["impersonate_user"] == "qa-bot"
        assert fake.factory.call_args.kwargs["impersonate_groups"] == ["dev", "ops"]

    async def test_no_impersonation_is_the_default(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(_valid_params(select_by="all"), fake)

        assert fake.factory.call_args.kwargs["impersonate_user"] is None
        assert fake.factory.call_args.kwargs["impersonate_groups"] is None


class TestNameModeNamespace:
    """A named pod lives in one namespace: All namespaces is ignored in Name mode."""

    async def test_all_namespaces_is_ignored_for_a_named_pod(self) -> None:
        fake = _fake((200, _WEB_1))

        result = await _execute(_valid_params(name="web-1", all_namespaces=True), fake)

        assert _path_of(fake.calls[1]) == f"{_POD_METRICS_PATH}/web-1"
        assert result["count"] == 1

    async def test_a_specified_namespace_still_wins_for_a_named_pod(self) -> None:
        fake = _fake((200, _WEB_1))

        await _execute(_valid_params(name="web-1", all_namespaces=True, namespace="ops"), fake)

        assert _path_of(fake.calls[1]) == "/apis/metrics.k8s.io/v1beta1/namespaces/ops/pods/web-1"

    async def test_selector_mode_still_honors_all_namespaces(self) -> None:
        fake = _fake((200, _POD_LIST))

        await _execute(
            _valid_params(select_by="selector", label_selector="app=web", all_namespaces=True),
            fake,
        )

        assert _path_of(fake.calls[1]) == _ALL_POD_METRICS_PATH

    async def test_a_named_node_is_unaffected_by_all_namespaces(self) -> None:
        fake = _fake((200, _NODE_0), (200, _NODE_0_OBJECT))

        await _execute(_valid_params(scope="node", name="kwok-node-0", all_namespaces=True), fake)

        assert _path_of(fake.calls[1]) == f"{_NODE_METRICS_PATH}/kwok-node-0"
        assert _path_of(fake.calls[2]) == f"{_NODES_PATH}/kwok-node-0"


class TestNodesTheMetricsApiDoesNotReport:
    """kubectl prints a node with no metrics as unknown; it is never dropped."""

    async def test_a_node_the_metrics_api_does_not_report_still_appears(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _THREE_NODE_OBJECTS))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)

        assert sorted(_rows_by_name(result)) == ["kwok-node-0", "kwok-node-1", "kwok-node-2"]
        assert result["count"] == 3

    async def test_a_non_reporting_node_carries_unknown_usage(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _THREE_NODE_OBJECTS))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)
        row = _rows_by_name(result)["kwok-node-2"]

        assert row["CPU"] is None
        assert row["MEMORY"] is None
        assert row["CAPACITY CPU"] == pytest.approx(4.0)
        assert row["ALLOCATABLE MEMORY"] == 8589934592

    async def test_a_reporting_node_is_unchanged_alongside_it(self) -> None:
        fake = _fake((200, _NODE_LIST), (200, _THREE_NODE_OBJECTS))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)
        row = _rows_by_name(result)["kwok-node-0"]

        assert row["CPU"] == pytest.approx(0.236785417)
        assert row["MEMORY"] == 3203862528

    async def test_the_reporting_nodes_are_listed_first(self) -> None:
        fake = _fake((200, _node_metrics_list(_NODE_1)), (200, _THREE_NODE_OBJECTS))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)

        assert [row["NAME"] for row in result["usage"]] == [
            "kwok-node-1",
            "kwok-node-0",
            "kwok-node-2",
        ]

    async def test_a_metrics_entry_with_no_node_object_is_dropped(self) -> None:
        """A node deleted between the two reads has no capacity to report."""
        fake = _fake((200, _NODE_LIST), (200, _node_list(_NODE_0_OBJECT)))

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)

        assert sorted(_rows_by_name(result)) == ["kwok-node-0"]
        assert result["count"] == 1

    async def test_a_metrics_api_that_serves_no_node_list_leaves_every_node_unknown(self) -> None:
        fake = _fake(
            (404, {"reason": "NotFound", "message": "nodes.metrics.k8s.io not found"}),
            (200, _NODE_OBJECT_LIST),
        )

        result = await _execute(_valid_params(scope="node", select_by="all"), fake)

        assert result["count"] == 2
        assert all(row["CPU"] is None for row in result["usage"])

    async def test_a_named_node_with_no_metrics_reports_unknown(self) -> None:
        fake = _fake(
            (404, {"reason": "NotFound", "message": "nodemetrics not found"}),
            (200, _NODE_0_OBJECT),
        )

        result = await _execute(_valid_params(scope="node", name="kwok-node-0"), fake)

        assert result["count"] == 1
        assert _rows_by_name(result)["kwok-node-0"]["CPU"] is None
        assert _rows_by_name(result)["kwok-node-0"]["CAPACITY CPU"] == pytest.approx(8.0)

    async def test_a_node_metrics_denial_still_fails_the_block(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "no access"}))

        with pytest.raises(ValueError, match=exact("Kubernetes API permission denied: no access")):
            await _execute(_valid_params(scope="node", select_by="all"), fake)


class TestSelectByDefaultsToAll:
    """An untouched Select by measures everything, the way kubectl top does."""

    async def test_no_select_by_at_all_lists_everything(self) -> None:
        fake = _fake((200, _POD_LIST))
        params = block_params(scope="pod")

        result = await _execute(params, fake)

        assert _path_of(fake.calls[1]) == _POD_METRICS_PATH
        assert result["count"] == 2

    async def test_no_select_by_at_all_passes_validation_without_a_name(self) -> None:
        await K8sTopPlugin().validate(block_params(scope="pod"))


class TestPathEncoding:
    """Pod name and namespace reach the wire percent-encoded; messages keep the typed values."""

    async def test_a_pod_name_with_a_space_and_a_question_mark_is_percent_encoded(self) -> None:
        fake = _fake((200, _WEB_1))

        await _execute(_valid_params(name="web 1?"), fake)

        assert fake.calls[1].path == f"{_POD_METRICS_PATH}/web%201%3F"

    async def test_a_namespace_with_a_space_and_a_question_mark_is_percent_encoded(self) -> None:
        fake = _fake((200, _WEB_1))

        await _execute(_valid_params(namespace="my ns?"), fake)

        assert fake.calls[1].path == "/apis/metrics.k8s.io/v1beta1/namespaces/my%20ns%3F/pods/web-1"

    async def test_an_absent_pod_is_reported_by_its_typed_name_and_namespace(self) -> None:
        fake = _fake((404, {"reason": "NotFound", "message": "pods 'web 1?' not found"}))
        message = "K8s Pod 'web 1?' not found in namespace 'my ns?'"

        with pytest.raises(ValueError, match=exact(message)):
            await _execute(_valid_params(name="web 1?", namespace="my ns?"), fake)

        assert fake.calls[1].path == (
            "/apis/metrics.k8s.io/v1beta1/namespaces/my%20ns%3F/pods/web%201%3F"
        )


class TestRecordedFailureIsAmber:
    """A recorded usage-read failure asks for amber and says why at WARN (K8SREAD-10)."""

    async def test_a_recorded_denial_carries_the_warning_signal(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        result = await _execute(_valid_params(select_by="all", on_error="record"), fake)

        assert result["__block_warning"] is True

    async def test_a_recorded_denial_logs_the_warn_line(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))
        logger = MagicMock()

        await _execute(_valid_params(select_by="all", on_error="record"), fake, logger)

        logger.warn.assert_called_once_with(
            "Read failed (Forbidden): Kubernetes API permission denied: denied"
        )

    async def test_a_happy_read_logs_info_and_asks_for_nothing(self) -> None:
        fake = _fake((200, _POD_LIST))
        logger = MagicMock()

        result = await _execute(_valid_params(select_by="all", on_error="record"), fake, logger)

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0
        assert logger.info.call_count == 1

    @_BOTH_MODES
    async def test_a_missing_metrics_api_still_raises_and_logs_no_warn_line(
        self, mode: str
    ) -> None:
        fake = FakeK8sClient(responses=[(404, {})])
        logger = MagicMock()

        with pytest.raises(ValueError, match=exact(_METRICS_MISSING)):
            await _execute(_valid_params(select_by="all", on_error=mode), fake, logger)

        assert logger.warn.call_count == 0

    async def test_fail_mode_logs_no_warn_line(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(_valid_params(select_by="all", on_error="fail"), fake, logger)

        assert logger.warn.call_count == 0


class TestOutputGating:
    """Error and Reason render only under Record and continue; Success never hides."""

    def test_error_and_reason_render_only_under_record_and_continue(self) -> None:
        outputs = _outputs_by_name(K8sTopPlugin())

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE

    def test_success_carries_no_gate(self) -> None:
        """Success stays visible in both On error modes, deliberately."""
        outputs = _outputs_by_name(K8sTopPlugin())

        assert "show_when" not in outputs["success"]

    def test_only_error_and_reason_are_gated(self) -> None:
        gated = {o["name"] for o in K8sTopPlugin().metadata["output_schema"] if "show_when" in o}

        assert gated == {"error", "reason"}
