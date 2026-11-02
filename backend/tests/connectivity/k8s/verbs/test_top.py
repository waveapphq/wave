"""K8s Top verb-core tests (REQ-5.1.1, REQ-3.3.2.1, REQ-3.4.1.5).

top.run is the sync, stdlib-only half of the K8s Top block: it probes the
aggregated metrics API, reads pod or node usage, converts the wire quantities to
raw cores and bytes, and emits a usage table envelope. CPU crosses the wire as an
exact decimal string, so a nanocore reading keeps every digit instead of turning
into E notation on the way through JSON.
"""

import inspect
import json
from decimal import Decimal, InvalidOperation
from typing import Any
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    NAMESPACE,
    SERVER,
    Call,
    FakeK8sClient,
    block_params,
    exact,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.connectivity.k8s.verbs import top

_PROBE_PATH = "/apis/metrics.k8s.io/v1beta1"
_POD_METRICS_PATH = f"/apis/metrics.k8s.io/v1beta1/namespaces/{NAMESPACE}/pods"
_ALL_POD_METRICS_PATH = "/apis/metrics.k8s.io/v1beta1/pods"
_NODE_METRICS_PATH = "/apis/metrics.k8s.io/v1beta1/nodes"
_NODES_PATH = "/api/v1/nodes"

_PROBE_OK = (200, {"kind": "APIResourceList", "groupVersion": "metrics.k8s.io/v1beta1"})
_PROBE_MISSING = (
    404,
    {"kind": "Status", "reason": "NotFound", "message": "the server could not find it"},
)

_METRICS_MISSING = (
    "This cluster does not serve the metrics API 'metrics.k8s.io/v1beta1' - "
    "check whether metrics-server is installed"
)
_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)

_POD_COLUMNS = [
    {"name": "NAME", "type": "string"},
    {"name": "CPU", "type": "float"},
    {"name": "MEMORY", "type": "integer"},
]
_CONTAINER_COLUMNS = [
    {"name": "NAME", "type": "string"},
    {"name": "CONTAINER", "type": "string"},
    {"name": "CPU", "type": "float"},
    {"name": "MEMORY", "type": "integer"},
]
_NODE_COLUMNS = [
    {"name": "NAME", "type": "string"},
    {"name": "CPU", "type": "float"},
    {"name": "MEMORY", "type": "integer"},
    {"name": "CAPACITY CPU", "type": "float"},
    {"name": "CAPACITY MEMORY", "type": "integer"},
    {"name": "ALLOCATABLE CPU", "type": "float"},
    {"name": "ALLOCATABLE MEMORY", "type": "integer"},
]

_BOTH_MODES = pytest.mark.parametrize("on_error", ["fail", "record"])


class _Recorder:
    """Collects the (level, message) pairs a verb logs, in order."""

    def __init__(self) -> None:
        self.entries: list[tuple[str, str]] = []

    def __call__(self, level: str, message: str) -> None:
        self.entries.append((level, message))

    @property
    def levels(self) -> list[str]:
        return [level for level, _message in self.entries]


def _patch_client(client: FakeK8sClient) -> Any:
    """Make the verb build the fake REST core instead of a real one."""
    factory = MagicMock(return_value=client)
    client.factory = factory
    return patch("wavecore.connectivity.k8s.verbs.top.K8sClient", factory)


def _container(name: str, cpu: str, memory: str) -> dict[str, Any]:
    return {"name": name, "usage": {"cpu": cpu, "memory": memory}}


def _pod_metrics(name: str, containers: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "kind": "PodMetrics",
        "apiVersion": "metrics.k8s.io/v1beta1",
        "metadata": {"name": name, "namespace": NAMESPACE},
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
_NODE_METRIC_LIST = _node_metrics_list(_NODE_0, _NODE_1)
_NODE_0_OBJECT = _node("kwok-node-0", "8", "32Gi", "7900m", "31Gi")
_NODE_1_OBJECT = _node("kwok-node-1", "4", "8Gi", "4", "8Gi")
_NODE_2_OBJECT = _node("kwok-node-2", "4", "8Gi", "4", "8Gi")
_NODE_OBJECT_LIST = _node_list(_NODE_0_OBJECT, _NODE_1_OBJECT)
_THREE_NODE_OBJECTS = _node_list(_NODE_0_OBJECT, _NODE_1_OBJECT, _NODE_2_OBJECT)

# Measured on the fixtures above; CPU is the exact decimal, never a float repr.
_WEB_1_ROW = ["web-1", "0.251502515", 3740733440]
_API_7_ROW = ["api-7", "2", 2147483648]
_NODE_0_ROW = ["kwok-node-0", "0.236785417", 3203862528, "8", 34359738368, "7.900", 33285996544]
_NODE_1_ROW = ["kwok-node-1", "0.012", 1048576, "4", 8589934592, "4", 8589934592]
_NODE_2_ROW = ["kwok-node-2", None, None, "4", 8589934592, "4", 8589934592]


def _params(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"scope": "pod", "select_by": "name", "name": "web-1"}
    base.update(overrides)
    return block_params(**base)


def _fake(*responses: Any) -> FakeK8sClient:
    """A fake core that answers the metrics-API probe, then the scripted reads."""
    return FakeK8sClient(responses=[_PROBE_OK, *responses])


def _run(params: dict[str, Any], fake: FakeK8sClient, log: Any = None) -> dict[str, Any]:
    with _patch_client(fake):
        return top.run(params, log if log is not None else _Recorder())


def _path_of(call: Call) -> str:
    return urlsplit(call.path).path


def _query_of(call: Call) -> dict[str, list[str]]:
    return parse_qs(urlsplit(call.path).query)


def _usage(envelope: dict[str, Any]) -> dict[str, Any]:
    usage: dict[str, Any] = envelope["outputs"]["usage"]
    return usage


def _rows(envelope: dict[str, Any]) -> list[list[Any]]:
    rows: list[list[Any]] = _usage(envelope)["rows"]
    return rows


def _row_named(envelope: dict[str, Any], name: str) -> list[Any]:
    return next(row for row in _rows(envelope) if row[0] == name)


def _one_pod(cpu: str, memory: str) -> dict[str, Any]:
    return _pod_metrics("solo", [_container("app", cpu, memory)])


class TestVerbShape:
    """run is a plain function returning one JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(top.run) is False

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(_params(select_by="all"), _fake((200, _POD_LIST)))

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_top_never_registers_a_secret(self) -> None:
        envelope = _run(_params(select_by="all"), _fake((200, _POD_LIST)))

        assert envelope["secrets"] == []

    def test_the_whole_envelope_survives_a_json_round_trip(self) -> None:
        envelope = _run(_params(select_by="all"), _fake((200, _POD_LIST)))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_successful_read_fills_the_output_core(self) -> None:
        envelope = _run(_params(select_by="all"), _fake((200, _POD_LIST)))

        assert envelope["outputs"] == {
            "usage": {
                "__wave_type": "table",
                "columns": _POD_COLUMNS,
                "rows": [_WEB_1_ROW, _API_7_ROW],
            },
            "count": 2,
            "success": True,
            "error": "",
            "reason": "",
        }


class TestMetricsProbe:
    """The metrics API is probed before any usage read."""

    def test_the_probe_is_the_first_request(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="all"), fake)

        assert fake.calls[0].method == "GET"
        assert _path_of(fake.calls[0]) == _PROBE_PATH
        assert fake.calls[0].body is None
        assert fake.calls[0].accept is None
        assert fake.calls[0].raw is False

    @_BOTH_MODES
    def test_an_absent_metrics_api_hard_fails_in_both_modes(self, on_error: str) -> None:
        fake = FakeK8sClient(responses=[_PROBE_MISSING])

        with pytest.raises(ValueError, match=exact(_METRICS_MISSING)):
            _run(_params(select_by="all", on_error=on_error), fake)

        assert [_path_of(call) for call in fake.calls] == [_PROBE_PATH]

    @_BOTH_MODES
    def test_the_node_scope_hard_fails_on_the_same_probe(self, on_error: str) -> None:
        fake = FakeK8sClient(responses=[_PROBE_MISSING])

        with pytest.raises(ValueError, match=exact(_METRICS_MISSING)):
            _run(_params(scope="node", select_by="all", on_error=on_error), fake)

    def test_a_failed_probe_logs_nothing(self) -> None:
        log = _Recorder()
        fake = FakeK8sClient(responses=[(404, {})])

        with pytest.raises(ValueError, match=exact(_METRICS_MISSING)):
            _run(_params(select_by="all", on_error="record"), fake, log)

        assert log.entries == []


class TestPodScopeTransport:
    """The pod metrics path, namespace resolution and target selection."""

    def test_all_mode_lists_the_session_namespace(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="all"), fake)

        assert [_path_of(call) for call in fake.calls] == [_PROBE_PATH, _POD_METRICS_PATH]
        assert fake.calls[1].body is None

    def test_all_namespaces_drops_the_namespace_segment(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="all", all_namespaces=True), fake)

        assert _path_of(fake.calls[1]) == _ALL_POD_METRICS_PATH

    def test_a_typed_namespace_targets_that_namespace(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="all", namespace="ops"), fake)

        assert _path_of(fake.calls[1]) == "/apis/metrics.k8s.io/v1beta1/namespaces/ops/pods"

    def test_name_mode_narrows_to_the_single_pod(self) -> None:
        fake = _fake((200, _WEB_1))

        envelope = _run(_params(name="web-1"), fake)

        assert _path_of(fake.calls[1]) == f"{_POD_METRICS_PATH}/web-1"
        assert _query_of(fake.calls[1]) == {}
        assert envelope["outputs"]["count"] == 1

    def test_name_mode_ignores_all_namespaces(self) -> None:
        fake = _fake((200, _WEB_1))

        _run(_params(name="web-1", all_namespaces=True), fake)

        assert _path_of(fake.calls[1]) == f"{_POD_METRICS_PATH}/web-1"

    def test_selector_mode_puts_the_label_selector_on_the_wire(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="selector", label_selector="app=web"), fake)

        assert _path_of(fake.calls[1]) == _POD_METRICS_PATH
        assert _query_of(fake.calls[1]) == {"labelSelector": ["app=web"]}

    def test_a_blank_label_selector_stays_off_the_wire(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="selector", label_selector=""), fake)

        assert _query_of(fake.calls[1]) == {}

    def test_selector_mode_still_honors_all_namespaces(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="selector", label_selector="app=web", all_namespaces=True), fake)

        assert _path_of(fake.calls[1]) == _ALL_POD_METRICS_PATH

    def test_an_unset_select_by_lists_everything(self) -> None:
        fake = _fake((200, _POD_LIST))

        envelope = _run(block_params(scope="pod"), fake)

        assert _path_of(fake.calls[1]) == _POD_METRICS_PATH
        assert envelope["outputs"]["count"] == 2

    def test_the_pod_name_and_namespace_reach_the_wire_percent_encoded(self) -> None:
        fake = _fake((200, _WEB_1))

        _run(_params(name="web 1?", namespace="my ns?"), fake)

        assert fake.calls[1].path == (
            "/apis/metrics.k8s.io/v1beta1/namespaces/my%20ns%3F/pods/web%201%3F"
        )


class TestNodeScopeTransport:
    """Node scope reads the metrics list and the node objects, in that order."""

    def test_all_mode_reads_the_metrics_then_the_node_objects(self) -> None:
        fake = _fake((200, _NODE_METRIC_LIST), (200, _NODE_OBJECT_LIST))

        envelope = _run(_params(scope="node", select_by="all"), fake)

        assert [_path_of(call) for call in fake.calls] == [
            _PROBE_PATH,
            _NODE_METRICS_PATH,
            _NODES_PATH,
        ]
        assert envelope["outputs"]["count"] == 2

    def test_name_mode_narrows_both_reads(self) -> None:
        fake = _fake((200, _NODE_0), (200, _NODE_0_OBJECT))

        envelope = _run(_params(scope="node", name="kwok-node-0"), fake)

        assert _path_of(fake.calls[1]) == f"{_NODE_METRICS_PATH}/kwok-node-0"
        assert _path_of(fake.calls[2]) == f"{_NODES_PATH}/kwok-node-0"
        assert [row[0] for row in _rows(envelope)] == ["kwok-node-0"]

    def test_selector_mode_puts_the_label_selector_on_both_reads(self) -> None:
        fake = _fake((200, _NODE_METRIC_LIST), (200, _NODE_OBJECT_LIST))

        _run(
            _params(scope="node", select_by="selector", label_selector="role=worker"),
            fake,
        )

        assert _query_of(fake.calls[1]) == {"labelSelector": ["role=worker"]}
        assert _query_of(fake.calls[2]) == {"labelSelector": ["role=worker"]}

    def test_no_namespace_reaches_the_node_paths(self) -> None:
        fake = _fake((200, _NODE_METRIC_LIST), (200, _NODE_OBJECT_LIST))

        _run(_params(scope="node", select_by="all", namespace="ops", all_namespaces=True), fake)

        for call in fake.calls:
            assert "/namespaces/" not in call.path


class TestClientConstruction:
    """The REST core is built from the session context and the block's rows."""

    def test_the_context_comes_from_the_session(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="all"), fake)
        context = fake.factory.call_args.args[0]

        assert context.server == SERVER
        assert context.namespace == NAMESPACE
        assert context.token == "sa-tok"

    def test_the_timeout_defaults_to_thirty(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="all"), fake)

        assert fake.factory.call_args.args[1] == 30

    def test_a_typed_timeout_reaches_the_core(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="all", timeout=45), fake)

        assert fake.factory.call_args.args[1] == 45

    def test_the_impersonation_rows_reach_the_core(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(
            _params(select_by="all", impersonate_user="qa-bot", impersonate_groups="dev, ops"), fake
        )

        assert fake.factory.call_args.kwargs["impersonate_user"] == "qa-bot"
        assert fake.factory.call_args.kwargs["impersonate_groups"] == ["dev", "ops"]

    def test_no_impersonation_by_default(self) -> None:
        fake = _fake((200, _POD_LIST))

        _run(_params(select_by="all"), fake)

        assert fake.factory.call_args.kwargs["impersonate_user"] is None
        assert fake.factory.call_args.kwargs["impersonate_groups"] is None


class TestUsageTableEnvelope:
    """usage is always a table envelope, with the columns the mode prints."""

    def test_pod_rows_carry_no_capacity_or_allocatable(self) -> None:
        envelope = _run(_params(select_by="all"), _fake((200, _POD_LIST)))

        assert _usage(envelope)["columns"] == _POD_COLUMNS

    def test_a_pod_row_totals_its_containers(self) -> None:
        envelope = _run(_params(name="web-1"), _fake((200, _WEB_1)))

        assert _rows(envelope) == [_WEB_1_ROW]

    def test_a_pod_with_no_containers_totals_to_zero(self) -> None:
        envelope = _run(_params(name="solo"), _fake((200, _pod_metrics("solo", []))))

        assert _rows(envelope) == [["solo", "0", 0]]

    def test_include_containers_switches_the_columns_and_the_rows(self) -> None:
        fake = _fake((200, _POD_LIST))

        envelope = _run(_params(select_by="all", include_containers=True), fake)

        assert _usage(envelope)["columns"] == _CONTAINER_COLUMNS
        assert _rows(envelope) == [
            ["web-1", "app", "0.250002515", 3203862528],
            ["web-1", "sidecar", "0.001500", 536870912],
            ["api-7", "api", "2", 2147483648],
        ]
        assert envelope["outputs"]["count"] == 3

    def test_node_rows_carry_capacity_and_allocatable(self) -> None:
        fake = _fake((200, _NODE_METRIC_LIST), (200, _NODE_OBJECT_LIST))

        envelope = _run(_params(scope="node", select_by="all"), fake)

        assert _usage(envelope)["columns"] == _NODE_COLUMNS
        assert _rows(envelope) == [_NODE_0_ROW, _NODE_1_ROW]

    def test_node_rows_never_break_down_by_container(self) -> None:
        fake = _fake((200, _NODE_METRIC_LIST), (200, _NODE_OBJECT_LIST))

        envelope = _run(_params(scope="node", select_by="all", include_containers=True), fake)

        assert _usage(envelope)["columns"] == _NODE_COLUMNS

    def test_an_empty_pod_list_is_a_success_with_no_rows(self) -> None:
        envelope = _run(_params(select_by="all"), _fake((200, _pod_metrics_list())))

        assert _usage(envelope) == {
            "__wave_type": "table",
            "columns": _POD_COLUMNS,
            "rows": [],
        }
        assert envelope["outputs"]["count"] == 0
        assert envelope["outputs"]["success"] is True

    def test_an_empty_node_list_is_a_success_with_no_rows(self) -> None:
        fake = _fake((200, _node_metrics_list()), (200, _node_list()))

        envelope = _run(_params(scope="node", select_by="all"), fake)

        assert _usage(envelope)["rows"] == []
        assert envelope["outputs"]["count"] == 0

    def test_no_column_reports_a_percentage(self) -> None:
        fake = _fake((200, _NODE_METRIC_LIST), (200, _NODE_OBJECT_LIST))

        envelope = _run(_params(scope="node", select_by="all"), fake)

        assert [
            column["name"] for column in _usage(envelope)["columns"] if "%" in column["name"]
        ] == []


class TestExactDecimalCells:
    """CPU crosses the wire as an exact decimal string, never as a float."""

    def test_a_nanocore_reading_keeps_its_digits_instead_of_e_notation(self) -> None:
        envelope = _run(_params(name="solo"), _fake((200, _one_pod("1n", "1Ki"))))

        assert _rows(envelope) == [["solo", "0.000000001", 1024]]
        assert "e" not in _rows(envelope)[0][1]

    def test_a_cpu_cell_is_a_string_and_a_memory_cell_is_an_integer(self) -> None:
        envelope = _run(_params(name="web-1"), _fake((200, _WEB_1)))
        row = _rows(envelope)[0]

        assert isinstance(row[1], str)
        assert isinstance(row[2], int)
        assert not isinstance(row[2], bool)

    def test_a_cpu_cell_round_trips_through_json_to_the_same_decimal(self) -> None:
        envelope = _run(_params(name="web-1"), _fake((200, _WEB_1)))

        restored = json.loads(json.dumps(envelope))
        cell = restored["outputs"]["usage"]["rows"][0][1]
        assert cell == "0.251502515"
        assert Decimal(cell) == Decimal("0.251502515")

    def test_the_sum_over_containers_is_exact(self) -> None:
        envelope = _run(_params(name="web-1"), _fake((200, _WEB_1)))

        assert Decimal(_rows(envelope)[0][1]) == Decimal("0.250002515") + Decimal("0.001500")

    @pytest.mark.parametrize(
        ("wire", "cores"),
        [
            ("250002515n", "0.250002515"),
            ("999999999n", "0.999999999"),
            ("1n", "0.000000001"),
            ("1500u", "0.001500"),
            ("500m", "0.500"),
            ("2", "2"),
            ("3k", "3000"),
            ("0", "0"),
        ],
    )
    def test_cpu_quantities_convert_to_exact_cores(self, wire: str, cores: str) -> None:
        envelope = _run(_params(name="solo"), _fake((200, _one_pod(wire, "1Ki"))))

        assert _rows(envelope)[0][1] == cores

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
    def test_memory_quantities_convert_to_whole_bytes(self, wire: str, byte_count: int) -> None:
        envelope = _run(_params(name="solo"), _fake((200, _one_pod("1m", wire))))

        assert _rows(envelope)[0][2] == byte_count

    def test_a_missing_usage_key_counts_as_zero(self) -> None:
        pod = _pod_metrics("solo", [{"name": "app", "usage": {}}])

        envelope = _run(_params(name="solo"), _fake((200, pod)))

        assert _rows(envelope) == [["solo", "0", 0]]


class TestNodesTheMetricsApiDoesNotReport:
    """A node with no metrics is printed as unknown, never dropped."""

    def test_a_non_reporting_node_carries_unknown_usage(self) -> None:
        fake = _fake((200, _NODE_METRIC_LIST), (200, _THREE_NODE_OBJECTS))

        envelope = _run(_params(scope="node", select_by="all"), fake)

        assert _row_named(envelope, "kwok-node-2") == _NODE_2_ROW
        assert envelope["outputs"]["count"] == 3

    def test_the_reporting_nodes_are_listed_first(self) -> None:
        fake = _fake((200, _node_metrics_list(_NODE_1)), (200, _THREE_NODE_OBJECTS))

        envelope = _run(_params(scope="node", select_by="all"), fake)

        assert [row[0] for row in _rows(envelope)] == [
            "kwok-node-1",
            "kwok-node-0",
            "kwok-node-2",
        ]

    def test_a_metrics_entry_with_no_node_object_is_dropped(self) -> None:
        fake = _fake((200, _NODE_METRIC_LIST), (200, _node_list(_NODE_0_OBJECT)))

        envelope = _run(_params(scope="node", select_by="all"), fake)

        assert [row[0] for row in _rows(envelope)] == ["kwok-node-0"]

    def test_a_404_on_the_node_metrics_leaves_every_node_unknown(self) -> None:
        fake = _fake(
            (404, {"reason": "NotFound", "message": "nodes.metrics.k8s.io not found"}),
            (200, _NODE_OBJECT_LIST),
        )

        envelope = _run(_params(scope="node", select_by="all"), fake)

        assert envelope["outputs"]["count"] == 2
        assert [row[1] for row in _rows(envelope)] == [None, None]

    def test_a_named_node_with_no_metrics_still_reports_its_capacity(self) -> None:
        fake = _fake(
            (404, {"reason": "NotFound", "message": "nodemetrics not found"}),
            (200, _NODE_0_OBJECT),
        )

        envelope = _run(_params(scope="node", name="kwok-node-0"), fake)

        assert _rows(envelope) == [
            ["kwok-node-0", None, None, "8", 34359738368, "7.900", 33285996544]
        ]

    def test_a_node_metrics_denial_still_fails_the_read(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "no access"}))
        message = "Kubernetes API permission denied: no access"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(scope="node", select_by="all"), fake)

    def test_a_404_on_the_node_objects_still_fails_the_read(self) -> None:
        missing = (404, {"reason": "NotFound", "message": "nodes 'gone' not found"})
        fake = _fake(missing, missing)

        with pytest.raises(ValueError, match=exact("K8s Node 'gone' not found")):
            _run(_params(scope="node", name="gone"), fake)


class TestFailurePaths:
    """Session, cluster and quantity failures."""

    @_BOTH_MODES
    def test_an_unreadable_session_raises_before_any_request(self, on_error: str) -> None:
        params = _params(select_by="all", on_error=on_error)
        params["session"] = "not-a-kubeconfig"
        fake = _fake((200, _POD_LIST))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(params, fake)

        assert fake.calls == []

    @_BOTH_MODES
    def test_a_missing_session_raises_in_both_modes(self, on_error: str) -> None:
        params = _params(select_by="all", on_error=on_error)
        del params["session"]

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run(params, _fake((200, _POD_LIST)))

    def test_a_permission_denial_renders_the_shared_row(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        with pytest.raises(ValueError, match=exact("Kubernetes API permission denied: denied")):
            _run(_params(select_by="all"), fake)

    def test_an_authentication_failure_renders_the_shared_row(self) -> None:
        fake = _fake((401, {"reason": "Unauthorized", "message": "token expired"}))
        message = "Kubernetes API authentication failed: token expired"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(select_by="all"), fake)

    def test_an_absent_named_pod_renders_the_shared_not_found_row(self) -> None:
        fake = _fake((404, {"reason": "NotFound", "message": "pods 'web-1' not found"}))
        message = f"K8s Pod 'web-1' not found in namespace '{NAMESPACE}'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(name="web-1"), fake)

    def test_a_server_error_on_a_named_read_says_the_read_failed(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = _fake((503, {"reason": "ServiceUnavailable", "message": detail}))
        message = f"Kubernetes could not read Pod 'web-1' in namespace '{NAMESPACE}': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(name="web-1"), fake)

    def test_a_server_error_on_an_unnamed_read_names_the_kind(self) -> None:
        detail = "the server is currently unable to handle the request"
        fake = _fake((503, {"reason": "ServiceUnavailable", "message": detail}))
        message = f"Kubernetes could not list Pod objects in namespace '{NAMESPACE}': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(select_by="all"), fake)

    def test_a_gateway_answer_ends_with_the_http_status(self) -> None:
        fake = _fake((401, {}))
        message = f"Kubernetes could not read Pod 'web-1' in namespace '{NAMESPACE}' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(name="web-1"), fake)

    def test_an_absent_pod_is_reported_by_its_typed_name_and_namespace(self) -> None:
        fake = _fake((404, {"reason": "NotFound", "message": "pods 'web 1?' not found"}))
        message = "K8s Pod 'web 1?' not found in namespace 'my ns?'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(name="web 1?", namespace="my ns?"), fake)

    @_BOTH_MODES
    def test_an_unknown_quantity_suffix_hard_fails(self, on_error: str) -> None:
        fake = _fake((200, _one_pod("5mm", "1Ki")))

        with pytest.raises(KeyError, match=r"^'mm'$"):
            _run(_params(name="solo", on_error=on_error), fake)

    @_BOTH_MODES
    def test_a_malformed_quantity_number_hard_fails(self, on_error: str) -> None:
        fake = _fake((200, _one_pod("abc", "1Ki")))

        with pytest.raises(InvalidOperation, match=exact("[<class 'decimal.ConversionSyntax'>]")):
            _run(_params(name="solo", on_error=on_error), fake)

    @_BOTH_MODES
    def test_a_pod_without_metadata_hard_fails(self, on_error: str) -> None:
        fake = _fake((200, {"kind": "PodMetrics", "containers": []}))

        with pytest.raises(KeyError, match=r"^'metadata'$"):
            _run(_params(name="solo", on_error=on_error), fake)

    @_BOTH_MODES
    def test_a_container_without_usage_hard_fails(self, on_error: str) -> None:
        fake = _fake((200, _pod_metrics("solo", [{"name": "app"}])))

        with pytest.raises(KeyError, match=r"^'usage'$"):
            _run(_params(name="solo", include_containers=True, on_error=on_error), fake)

    @_BOTH_MODES
    def test_a_transport_failure_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(_params(select_by="all", on_error=on_error), fake)

    @_BOTH_MODES
    def test_a_timeout_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Kubernetes API request GET {_POD_METRICS_PATH} timed out after 30 seconds"
        fake = _fake(K8sApiError(message))

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(_params(select_by="all", on_error=on_error), fake)


class TestRecordAndContinue:
    """A recorded refusal keeps the block running and empties the usage table."""

    def test_a_recorded_denial_fills_the_failure_envelope(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        envelope = _run(_params(select_by="all", on_error="record"), fake)

        assert envelope["outputs"] == {
            "usage": {"__wave_type": "table", "columns": _POD_COLUMNS, "rows": []},
            "count": 0,
            "success": False,
            "error": "Kubernetes API permission denied: denied",
            "reason": "Forbidden",
            "__block_warning": True,
        }
        assert envelope["secrets"] == []

    def test_a_recorded_failure_is_json_serializable(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        envelope = _run(_params(select_by="all", on_error="record"), fake)

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_failure_keeps_the_container_columns(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        envelope = _run(_params(select_by="all", include_containers=True, on_error="record"), fake)

        assert _usage(envelope)["columns"] == _CONTAINER_COLUMNS

    def test_a_recorded_failure_keeps_the_node_columns(self) -> None:
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        envelope = _run(_params(scope="node", select_by="all", on_error="record"), fake)

        assert _usage(envelope)["columns"] == _NODE_COLUMNS

    def test_a_recorded_absent_named_pod_carries_its_reason(self) -> None:
        fake = _fake((404, {"reason": "NotFound", "message": "pods 'web-1' not found"}))

        envelope = _run(_params(name="web-1", on_error="record"), fake)

        assert envelope["outputs"]["error"] == (
            f"K8s Pod 'web-1' not found in namespace '{NAMESPACE}'"
        )
        assert envelope["outputs"]["reason"] == "NotFound"

    def test_a_gateway_answer_records_an_empty_reason(self) -> None:
        fake = _fake((401, {}))

        envelope = _run(_params(name="web-1", on_error="record"), fake)

        assert envelope["outputs"]["error"] == (
            f"Kubernetes could not read Pod 'web-1' in namespace '{NAMESPACE}' (HTTP 401)"
        )
        assert envelope["outputs"]["reason"] == ""


class TestLogCalls:
    """The verb logs through the callable it is handed, never a logger object."""

    def test_a_successful_pod_read_logs_one_info_line(self) -> None:
        log = _Recorder()

        _run(_params(select_by="all"), _fake((200, _POD_LIST)), log)

        assert log.entries == [("INFO", "Read pod usage: 2 rows")]

    def test_a_successful_node_read_names_the_node_scope(self) -> None:
        log = _Recorder()
        fake = _fake((200, _NODE_METRIC_LIST), (200, _NODE_OBJECT_LIST))

        _run(_params(scope="node", select_by="all"), fake, log)

        assert log.entries == [("INFO", "Read node usage: 2 rows")]

    def test_an_empty_read_still_logs_its_row_count(self) -> None:
        log = _Recorder()

        _run(_params(select_by="all"), _fake((200, _pod_metrics_list())), log)

        assert log.entries == [("INFO", "Read pod usage: 0 rows")]

    def test_a_recorded_denial_logs_one_warn_line(self) -> None:
        log = _Recorder()
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        _run(_params(select_by="all", on_error="record"), fake, log)

        assert log.entries == [
            ("WARN", "Read failed (Forbidden): Kubernetes API permission denied: denied")
        ]

    def test_a_recorded_failure_with_no_reason_leaves_the_detail_out(self) -> None:
        log = _Recorder()
        message = f"Kubernetes could not read Pod 'web-1' in namespace '{NAMESPACE}' (HTTP 401)"
        fake = _fake((401, {}))

        _run(_params(name="web-1", on_error="record"), fake, log)

        assert log.entries == [("WARN", f"Read failed: {message}")]

    def test_fail_mode_logs_nothing(self) -> None:
        log = _Recorder()
        fake = _fake((403, {"reason": "Forbidden", "message": "denied"}))

        with pytest.raises(ValueError):
            _run(_params(select_by="all", on_error="fail"), fake, log)

        assert log.entries == []

    def test_a_happy_read_logs_no_warn_line(self) -> None:
        log = _Recorder()

        _run(_params(select_by="all", on_error="record"), _fake((200, _POD_LIST)), log)

        assert log.levels == ["INFO"]
