"""K8s Events verb-core tests (REQ-3.3.5.4, REQ-3.4.1.5).

events.run is the sync, stdlib-only half of the K8s Events block: it lists v1
Events namespace-wide, cluster-wide or scoped to one object, orders them
newest-first inside the age and count limits, and hands back the wire envelope
both the local bridge and the remote worker materialize. Its timestamp parse is
normalized, so an RFC3339 'Z' stamp reads the same on a 3.10 host as here.
"""

import ast
import inspect
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qsl, urlsplit

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    GATEWAY_HTML,
    NAMESPACE,
    SERVER,
    UNREADABLE_BODY_MESSAGE,
    Call,
    DeniedDiscoveryClient,
    FakeK8sClient,
    block_params,
    exact,
    resource,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.connectivity.k8s.verbs import events

_TABLE_ACCEPT = "application/json;as=Table;g=meta.k8s.io;v=v1,application/json"

_NS_PATH = f"/api/v1/namespaces/{NAMESPACE}/events"
_ALL_NS_PATH = "/api/v1/events"

_NEWEST = "2026-08-20T10:00:00Z"
_MIDDLE = "2026-08-20T09:30:00Z"
_OLDEST = "2026-08-20T09:00:00Z"

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_TABLE_UNSUPPORTED_MESSAGE = (
    "This cluster will not print a table for kind 'Event' "
    "- choose Map, JSON or YAML for this kind"
)
_DISCOVERY_MISS_MESSAGE = (
    "This cluster has no resource kind 'Widget' "
    "- check the spelling, or whether the CRD is installed"
)

_FORBIDDEN_DETAIL = 'events is forbidden: User "wave" cannot list resource "events"'
_FORBIDDEN_BODY = {
    "kind": "Status",
    "status": "Failure",
    "message": _FORBIDDEN_DETAIL,
    "reason": "Forbidden",
    "code": 403,
}
_FORBIDDEN_MESSAGE = f"Kubernetes API permission denied: {_FORBIDDEN_DETAIL}"

_UNAUTHORIZED_BODY = {
    "kind": "Status",
    "status": "Failure",
    "message": "Unauthorized",
    "reason": "Unauthorized",
    "code": 401,
}
_UNAUTHORIZED_MESSAGE = "Kubernetes API authentication failed: Unauthorized"

_GATEWAY_401_MESSAGE = (
    f"Kubernetes could not list Event objects in namespace '{NAMESPACE}' (HTTP 401)"
)

_POD_RESOURCE = {"Pod": resource("Pod", "pods")}
_ISTIO = {
    "VirtualService": resource(
        "VirtualService", "virtualservices", group_version="networking.istio.io/v1"
    )
}

_EMPTY_TABLE = {"__wave_type": "table", "columns": [], "rows": []}

# What datetime.fromisoformat accepts before 3.11: no 'Z', 3 or 6 fractional digits.
_PY310_ISOFORMAT = re.compile(
    r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{3}|\.\d{6})?([+-]\d{2}:\d{2})?$"
)


class _RecordingDatetime(datetime):
    """Records every string the verb hands to fromisoformat."""

    parsed: list[str] = []

    @classmethod
    def fromisoformat(cls, value: str) -> datetime:
        _RecordingDatetime.parsed.append(value)
        return datetime.fromisoformat(value)


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
    return patch("wavecore.connectivity.k8s.verbs.events.K8sClient", factory)


def _run(params: dict[str, Any], fake: FakeK8sClient, log: Any = None) -> dict[str, Any]:
    with _patch_client(fake):
        return events.run(params, log if log is not None else _Recorder())


def _ago(seconds: int) -> str:
    stamp = datetime.now(UTC) - timedelta(seconds=seconds)
    return stamp.isoformat().replace("+00:00", "Z")


def _event(
    name: str,
    timestamp: str,
    event_type: str = "Normal",
    reason: str = "Scheduled",
) -> dict[str, Any]:
    return {
        "metadata": {"name": name, "namespace": NAMESPACE, "creationTimestamp": timestamp},
        "involvedObject": {"kind": "Pod", "name": "web-1", "namespace": NAMESPACE},
        "type": event_type,
        "reason": reason,
        "message": "",
        "count": 1,
        "firstTimestamp": timestamp,
        "lastTimestamp": timestamp,
        "eventTime": timestamp,
    }


def _undated_event(name: str) -> dict[str, Any]:
    """An event carrying none of the four stamps the ordering reads."""
    return {
        "metadata": {"name": name, "namespace": NAMESPACE},
        "involvedObject": {"kind": "Pod", "name": "web-1", "namespace": NAMESPACE},
        "type": "Normal",
        "reason": "Scheduled",
        "count": 1,
    }


_MANAGED_FIELDS = [
    {"manager": "kube-controller-manager", "operation": "Update", "apiVersion": "v1"}
]


def _managed_event(name: str, timestamp: str) -> dict[str, Any]:
    event = _event(name, timestamp)
    event["metadata"]["managedFields"] = _MANAGED_FIELDS
    return event


def _event_list(*items: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "EventList",
        "apiVersion": "v1",
        "metadata": {"resourceVersion": "1421"},
        "items": list(items),
    }


def _table_row(name: str, timestamp: str, count: Any = 1) -> dict[str, Any]:
    return {
        "cells": ["30s", "Normal", "Scheduled", f"pod/{name}", count, _OLDEST, "Assigned"],
        "object": {"kind": "Event", "metadata": {"name": name}, "lastTimestamp": timestamp},
    }


def _table_body(count_type: str = "integer", second_count: Any = 1) -> dict[str, Any]:
    return {
        "kind": "Table",
        "apiVersion": "meta.k8s.io/v1",
        "columnDefinitions": [
            {"name": "Last Seen", "type": "string", "format": "", "priority": 0},
            {"name": "Type", "type": "string", "format": "", "priority": 0},
            {"name": "Reason", "type": "string", "format": "", "priority": 0},
            {"name": "Object", "type": "string", "format": "", "priority": 0},
            {"name": "Count", "type": count_type, "format": "", "priority": 0},
            {"name": "First Seen", "type": "date", "format": "", "priority": 0},
            {"name": "Message", "type": "string", "format": "", "priority": 0},
        ],
        "rows": [_table_row("new-evt", _NEWEST, 3), _table_row("old-evt", _OLDEST, second_count)],
    }


_TABLE_COLUMNS = [
    {"name": "Last Seen", "type": "string"},
    {"name": "Type", "type": "string"},
    {"name": "Reason", "type": "string"},
    {"name": "Object", "type": "string"},
    {"name": "Count", "type": "integer"},
    {"name": "First Seen", "type": "string"},
    {"name": "Message", "type": "string"},
]


def _listing(*items: dict[str, Any], resources: dict[str, Any] | None = None) -> FakeK8sClient:
    """A fake core serving one EventList, with the kinds discovery can resolve."""
    return FakeK8sClient(
        responses=[(200, _event_list(*items))],
        resources=_POD_RESOURCE if resources is None else resources,
    )


def _serving(status: int, body: Any) -> FakeK8sClient:
    return FakeK8sClient(responses=[(status, body)], resources=_POD_RESOURCE)


def _json_bytes(*items: dict[str, Any]) -> bytes:
    return json.dumps(_event_list(*items)).encode()


def _path(call: Call) -> str:
    return urlsplit(call.path).path


def _query(call: Call) -> dict[str, str]:
    return dict(parse_qsl(urlsplit(call.path).query))


def _selector(call: Call) -> list[str]:
    return _query(call)["fieldSelector"].split(",")


def _names(envelope: dict[str, Any]) -> list[str]:
    return [event["metadata"]["name"] for event in envelope["outputs"]["result"]]


def _module_tree() -> ast.Module:
    return ast.parse(Path(events.__file__).read_text(encoding="utf-8"))


class TestVerbShape:
    """run is a plain function returning one JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(events.run) is False

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope = _run(block_params(), _listing(_event("new-evt", _NEWEST)))

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_events_never_registers_a_secret(self) -> None:
        envelope = _run(block_params(), _listing(_event("new-evt", _NEWEST)))

        assert envelope["secrets"] == []

    def test_the_whole_envelope_survives_a_json_round_trip(self) -> None:
        envelope = _run(block_params(), _listing(_event("new-evt", _NEWEST)))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_successful_read_fills_the_output_core(self) -> None:
        event = _event("new-evt", _NEWEST)

        envelope = _run(block_params(), _listing(event))

        assert envelope["outputs"] == {
            "result": [event],
            "count": 1,
            "success": True,
            "error": "",
            "reason": "",
        }


class TestTransport:
    """The path, the field selectors and what the REST core is constructed with."""

    def test_a_namespace_wide_read_uses_the_session_namespace(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(), fake)

        assert fake.last.method == "GET"
        assert _path(fake.last) == _NS_PATH
        assert _query(fake.last) == {}
        assert fake.last.body is None

    def test_an_unscoped_read_runs_no_discovery_and_costs_one_request(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(), fake)

        assert fake.discoveries == []
        assert len(fake.calls) == 1

    def test_all_namespaces_reads_the_cluster_wide_path(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(all_namespaces=True), fake)

        assert _path(fake.last) == _ALL_NS_PATH

    def test_a_typed_namespace_overrides_the_session_default(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(namespace="ops"), fake)

        assert _path(fake.last) == "/api/v1/namespaces/ops/events"

    def test_all_namespaces_wins_over_a_typed_namespace(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(all_namespaces=True, namespace="ops"), fake)

        assert _path(fake.last) == _ALL_NS_PATH

    def test_scoping_rides_the_involved_object_field_selector(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(scope_to_object=True, object_kind="Pod", object_name="  web-1  ")

        _run(params, fake)

        assert fake.discoveries == ["Pod"]
        assert _query(fake.last) == {
            "fieldSelector": "involvedObject.kind=Pod,involvedObject.name=web-1"
        }

    def test_the_custom_object_type_resolves_the_trimmed_typed_kind(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources=_ISTIO)
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind="Pod",
            object_kind_custom="  VirtualService  ",
            object_name="web-1",
        )

        _run(params, fake)

        assert fake.discoveries == ["VirtualService"]
        assert _selector(fake.last)[0] == "involvedObject.kind=VirtualService"

    def test_the_object_rows_are_ignored_while_scoping_is_off(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(
            scope_to_object=False,
            object_type="custom",
            object_kind_custom="VirtualService",
            object_name="web-1",
        )

        _run(params, fake)

        assert _query(fake.last) == {}
        assert fake.discoveries == []

    @pytest.mark.parametrize("event_type", ["Warning", "Normal"])
    def test_the_event_type_filter_rides_the_field_selector(self, event_type: str) -> None:
        fake = _listing(_event("new-evt", _NEWEST, event_type=event_type))

        _run(block_params(event_type=event_type), fake)

        assert _query(fake.last) == {"fieldSelector": f"type={event_type}"}

    def test_the_any_event_type_puts_no_filter_on_the_wire(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(event_type="any"), fake)

        assert _query(fake.last) == {}

    def test_the_reason_filter_rides_the_field_selector_trimmed(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST, reason="BackOff"))

        _run(block_params(reason="  BackOff  "), fake)

        assert _query(fake.last) == {"fieldSelector": "reason=BackOff"}

    def test_a_blank_reason_never_reaches_the_wire(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(reason="   "), fake)

        assert _query(fake.last) == {}

    def test_every_filter_rides_one_field_selector_in_wire_order(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST, event_type="Warning", reason="BackOff"))
        params = block_params(
            scope_to_object=True,
            object_kind="Pod",
            object_name="web-1",
            event_type="Warning",
            reason="BackOff",
        )

        _run(params, fake)

        assert _selector(fake.last) == [
            "involvedObject.kind=Pod",
            "involvedObject.name=web-1",
            "type=Warning",
            "reason=BackOff",
        ]

    def test_the_two_limits_are_applied_in_the_verb_not_on_the_wire(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(within_seconds=600, max_events=2), fake)

        assert _query(fake.last) == {}

    def test_the_table_ask_follows_the_field_selector_on_the_wire(self) -> None:
        fake = _serving(200, _table_body())

        _run(block_params(output_format="table", event_type="Warning"), fake)

        assert urlsplit(fake.last.path).query == (
            "fieldSelector=type%3DWarning&includeObject=Object"
        )

    def test_the_table_ask_rides_alone_when_no_filter_is_set(self) -> None:
        fake = _serving(200, _table_body())

        _run(block_params(output_format="table"), fake)

        assert _query(fake.last) == {"includeObject": "Object"}

    def test_the_core_receives_the_session_context_and_the_typed_timeout(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(timeout=45), fake)

        context = fake.factory.call_args.args[0]
        assert context.server == SERVER
        assert context.namespace == NAMESPACE
        assert context.token == "sa-tok"
        assert fake.factory.call_args.args[1] == 45

    def test_the_core_timeout_defaults_to_thirty(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(), fake)

        assert fake.factory.call_args.args[1] == 30

    def test_the_impersonation_rows_reach_the_core(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(impersonate_user="qa-bot", impersonate_groups="qa, readers"), fake)

        assert fake.factory.call_args.kwargs["impersonate_user"] == "qa-bot"
        assert fake.factory.call_args.kwargs["impersonate_groups"] == ["qa", "readers"]

    def test_no_impersonation_by_default(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(), fake)

        assert fake.factory.call_args.kwargs["impersonate_user"] is None
        assert fake.factory.call_args.kwargs["impersonate_groups"] is None


class TestRequestOptionsPerFormat:
    """Each output format picks its own wire mode; yaml asks for JSON."""

    def test_map_reads_a_parsed_body(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST))

        _run(block_params(output_format="map"), fake)

        assert fake.last.accept is None
        assert fake.last.raw is False

    def test_table_asks_the_cluster_to_print_one(self) -> None:
        fake = _serving(200, _table_body())

        _run(block_params(output_format="table"), fake)

        assert fake.last.accept == _TABLE_ACCEPT
        assert fake.last.raw is False

    def test_json_reads_the_raw_bytes_with_the_default_accept(self) -> None:
        fake = _serving(200, _json_bytes(_event("new-evt", _NEWEST)))

        _run(block_params(output_format="json"), fake)

        assert fake.last.accept is None
        assert fake.last.raw is True

    def test_yaml_asks_the_cluster_for_json_too(self) -> None:
        fake = _serving(200, _json_bytes(_event("new-evt", _NEWEST)))

        _run(block_params(output_format="yaml"), fake)

        assert fake.last.accept is None
        assert fake.last.raw is True


class TestOutputFormats:
    """result carries the four shapes the read family carries."""

    def test_map_returns_the_parsed_events(self) -> None:
        event = _event("new-evt", _NEWEST, event_type="Warning", reason="BackOff")

        envelope = _run(block_params(output_format="map"), _listing(event))

        assert envelope["outputs"]["result"] == [event]
        assert envelope["outputs"]["count"] == 1

    def test_map_is_the_default_format(self) -> None:
        envelope = _run(block_params(), _listing(_event("new-evt", _NEWEST)))

        assert _names(envelope) == ["new-evt"]

    def test_table_returns_the_table_envelope(self) -> None:
        envelope = _run(block_params(output_format="table"), _serving(200, _table_body()))

        assert envelope["outputs"]["result"] == {
            "__wave_type": "table",
            "columns": _TABLE_COLUMNS,
            "rows": [
                ["30s", "Normal", "Scheduled", "pod/new-evt", 3, _OLDEST, "Assigned"],
                ["30s", "Normal", "Scheduled", "pod/old-evt", 1, _OLDEST, "Assigned"],
            ],
        }

    def test_the_table_envelope_is_json_serializable(self) -> None:
        envelope = _run(block_params(output_format="table"), _serving(200, _table_body()))
        result = envelope["outputs"]["result"]

        assert json.loads(json.dumps(result)) == result

    def test_a_column_whose_cells_disagree_downgrades_to_string(self) -> None:
        fake = _serving(200, _table_body(second_count="n/a"))

        envelope = _run(block_params(output_format="table"), fake)
        result = envelope["outputs"]["result"]

        assert result["columns"][4] == {"name": "Count", "type": "string"}
        assert [row[4] for row in result["rows"]] == ["3", "n/a"]

    def test_table_count_is_the_row_count(self) -> None:
        envelope = _run(block_params(output_format="table"), _serving(200, _table_body()))

        assert envelope["outputs"]["count"] == 2

    def test_json_returns_the_serialized_document(self) -> None:
        items = (_event("new-evt", _NEWEST), _event("old-evt", _OLDEST))
        fake = _serving(200, _json_bytes(*items))

        envelope = _run(block_params(output_format="json"), fake)

        assert envelope["outputs"]["result"] == json.dumps(_event_list(*items))
        assert envelope["outputs"]["count"] == 2

    def test_yaml_returns_the_yaml_envelope_over_the_whole_document(self) -> None:
        items = (_event("new-evt", _NEWEST), _event("old-evt", _OLDEST))
        fake = _serving(200, _json_bytes(*items))

        envelope = _run(block_params(output_format="yaml"), fake)

        assert envelope["outputs"]["result"] == {
            "__wave_type": "yaml",
            "value": _event_list(*items),
        }
        assert envelope["outputs"]["count"] == 2

    def test_an_empty_json_body_still_renders_the_ordered_document(self) -> None:
        envelope = _run(block_params(output_format="json"), _serving(200, b""))

        assert envelope["outputs"]["result"] == json.dumps({"items": []})
        assert envelope["outputs"]["count"] == 0

    def test_an_empty_yaml_body_still_renders_the_ordered_document(self) -> None:
        envelope = _run(block_params(output_format="yaml"), _serving(200, b""))

        assert envelope["outputs"]["result"] == {"__wave_type": "yaml", "value": {"items": []}}

    def test_an_empty_namespace_is_a_successful_empty_read(self) -> None:
        envelope = _run(block_params(), _listing())

        assert envelope["outputs"]["result"] == []
        assert envelope["outputs"]["count"] == 0
        assert envelope["outputs"]["success"] is True

    def test_the_map_format_drops_managed_fields(self) -> None:
        fake = _listing(_managed_event("new-evt", _NEWEST))

        envelope = _run(block_params(), fake)

        assert "managedFields" not in envelope["outputs"]["result"][0]["metadata"]

    def test_the_json_format_drops_managed_fields(self) -> None:
        fake = _serving(200, _json_bytes(_managed_event("new-evt", _NEWEST)))

        envelope = _run(block_params(output_format="json"), fake)

        assert "managedFields" not in envelope["outputs"]["result"]

    def test_the_yaml_format_drops_managed_fields(self) -> None:
        fake = _serving(200, _json_bytes(_managed_event("new-evt", _NEWEST)))

        envelope = _run(block_params(output_format="yaml"), fake)
        value = envelope["outputs"]["result"]["value"]

        assert "managedFields" not in value["items"][0]["metadata"]

    def test_the_table_format_drops_managed_fields_from_the_embedded_events(self) -> None:
        body = _table_body()
        body["rows"][0]["object"]["metadata"]["managedFields"] = _MANAGED_FIELDS

        envelope = _run(block_params(output_format="table"), _serving(200, body))

        assert "managedFields" not in body["rows"][0]["object"]["metadata"]
        assert envelope["outputs"]["count"] == 2


class TestOrderingAndLimits:
    """Newest-first ordering, the age window and the max-events cut."""

    def test_events_come_back_newest_first(self) -> None:
        fake = _listing(
            _event("mid-evt", _MIDDLE), _event("old-evt", _OLDEST), _event("new-evt", _NEWEST)
        )

        envelope = _run(block_params(), fake)

        assert _names(envelope) == ["new-evt", "mid-evt", "old-evt"]
        assert envelope["outputs"]["count"] == 3

    def test_max_events_truncates_after_the_sort(self) -> None:
        fake = _listing(
            _event("mid-evt", _MIDDLE), _event("old-evt", _OLDEST), _event("new-evt", _NEWEST)
        )

        envelope = _run(block_params(max_events=2), fake)

        assert _names(envelope) == ["new-evt", "mid-evt"]
        assert envelope["outputs"]["count"] == 2

    def test_an_unset_max_events_keeps_every_event(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), _event("old-evt", _OLDEST))

        envelope = _run(block_params(), fake)

        assert _names(envelope) == ["new-evt", "old-evt"]

    def test_the_age_window_drops_older_events(self) -> None:
        fake = _listing(_event("fresh-evt", _ago(60)), _event("stale-evt", _ago(7200)))

        envelope = _run(block_params(within_seconds=600), fake)

        assert _names(envelope) == ["fresh-evt"]
        assert envelope["outputs"]["count"] == 1

    def test_an_unset_age_window_keeps_every_event(self) -> None:
        fake = _listing(_event("fresh-evt", _ago(60)), _event("stale-evt", _ago(7200)))

        envelope = _run(block_params(), fake)

        assert _names(envelope) == ["fresh-evt", "stale-evt"]

    def test_the_table_rows_are_ordered_newest_first(self) -> None:
        body = _table_body()
        body["rows"] = [_table_row("old-evt", _OLDEST), _table_row("new-evt", _NEWEST)]

        envelope = _run(block_params(output_format="table"), _serving(200, body))

        assert [row[3] for row in envelope["outputs"]["result"]["rows"]] == [
            "pod/new-evt",
            "pod/old-evt",
        ]
        assert envelope["outputs"]["count"] == 2

    def test_the_json_text_carries_both_limits(self) -> None:
        fake = _serving(
            200,
            _json_bytes(
                _event("mid-evt", _ago(300)),
                _event("stale-evt", _ago(7200)),
                _event("fresh-evt", _ago(60)),
            ),
        )
        params = block_params(output_format="json", within_seconds=600, max_events=1)

        envelope = _run(params, fake)
        document = json.loads(envelope["outputs"]["result"])

        assert [item["metadata"]["name"] for item in document["items"]] == ["fresh-evt"]
        assert envelope["outputs"]["count"] == 1

    def test_the_yaml_envelope_carries_both_limits(self) -> None:
        fake = _serving(
            200,
            _json_bytes(
                _event("mid-evt", _ago(300)),
                _event("stale-evt", _ago(7200)),
                _event("fresh-evt", _ago(60)),
            ),
        )
        params = block_params(output_format="yaml", within_seconds=600, max_events=1)

        envelope = _run(params, fake)
        document = envelope["outputs"]["result"]["value"]

        assert [item["metadata"]["name"] for item in document["items"]] == ["fresh-evt"]


class TestTimestampNormalization:
    """An RFC3339 stamp must parse on the 3.10 remote host, Z suffix and all."""

    def test_a_z_suffixed_stamp_parses_as_utc(self) -> None:
        seen = events._seen_at(_event("new-evt", "2026-08-20T10:00:00Z"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, tzinfo=UTC)
        assert seen.utcoffset() == timedelta(0)

    def test_an_explicit_zero_offset_reads_the_same_instant(self) -> None:
        zulu = events._seen_at(_event("new-evt", "2026-08-20T10:00:00Z"))
        offset = events._seen_at(_event("new-evt", "2026-08-20T10:00:00+00:00"))

        assert offset == zulu

    def test_a_non_utc_offset_keeps_its_instant(self) -> None:
        seen = events._seen_at(_event("new-evt", "2026-08-20T12:00:00+02:00"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, tzinfo=UTC)

    def test_three_fractional_digits_parse(self) -> None:
        seen = events._seen_at(_event("new-evt", "2026-08-20T10:00:00.123Z"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, 123000, tzinfo=UTC)

    def test_six_fractional_digits_parse(self) -> None:
        seen = events._seen_at(_event("new-evt", "2026-08-20T10:00:00.123456Z"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, 123456, tzinfo=UTC)

    def test_two_fractional_digits_parse(self) -> None:
        seen = events._seen_at(_event("new-evt", "2026-08-20T10:00:00.12Z"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, 120000, tzinfo=UTC)

    def test_nanosecond_precision_truncates_to_microseconds(self) -> None:
        seen = events._seen_at(_event("new-evt", "2026-08-20T10:00:00.123456789Z"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, 123456, tzinfo=UTC)

    def test_a_z_suffixed_micro_time_orders_the_read(self) -> None:
        fake = _listing(
            _event("old-evt", "2026-08-20T09:00:00.500Z"),
            _event("new-evt", "2026-08-20T10:00:00.123456789Z"),
        )

        envelope = _run(block_params(), fake)

        assert _names(envelope) == ["new-evt", "old-evt"]

    def test_the_age_window_compares_z_stamps_against_now(self) -> None:
        fake = _listing(_event("fresh-evt", _ago(30)), _event("stale-evt", "2020-01-01T00:00:00Z"))

        envelope = _run(block_params(within_seconds=600), fake)

        assert _names(envelope) == ["fresh-evt"]

    @pytest.mark.parametrize(
        "stamp",
        [
            "2026-08-20T10:00:00Z",
            "2026-08-20T10:00:00.12Z",
            "2026-08-20T10:00:00.123Z",
            "2026-08-20T10:00:00.123456Z",
            "2026-08-20T10:00:00.123456789Z",
            "2026-08-20T12:00:00+02:00",
        ],
    )
    def test_the_string_that_reaches_the_parser_is_one_3_10_accepts(self, stamp: str) -> None:
        _RecordingDatetime.parsed = []

        with patch.object(events, "datetime", _RecordingDatetime):
            events._seen_at(_event("evt", stamp))

        assert _RecordingDatetime.parsed
        for value in _RecordingDatetime.parsed:
            assert _PY310_ISOFORMAT.match(value), value

    def test_a_malformed_stamp_still_raises_the_interpreter_message(self) -> None:
        message = "Invalid isoformat string: 'not-a-timestamp'"

        with pytest.raises(ValueError, match=exact(message)):
            events._seen_at(_event("bad-evt", "not-a-timestamp"))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_malformed_stamp_hard_fails_the_read_in_both_modes(self, on_error: str) -> None:
        fake = _listing(_event("bad-evt", "not-a-timestamp"))
        message = "Invalid isoformat string: 'not-a-timestamp'"

        with pytest.raises(ValueError, match=exact(message)):
            _run(block_params(on_error=on_error), fake)


class TestOffsetNormalization:
    """The offset forms 3.11 widened: on a 3.10 host only '+HH:MM' parses."""

    @pytest.mark.parametrize(
        "stamp, normalized",
        [
            ("2026-08-20T10:00:00+0000", "2026-08-20T10:00:00+00:00"),
            ("2026-08-20T10:00:00+00", "2026-08-20T10:00:00+00:00"),
            ("2026-08-20T10:00:00", "2026-08-20T10:00:00+00:00"),
            ("2026-08-20T12:00:00+0200", "2026-08-20T12:00:00+02:00"),
            ("2026-08-20T08:00:00-0200", "2026-08-20T08:00:00-02:00"),
            ("2026-08-20T12:00:00+02", "2026-08-20T12:00:00+02:00"),
            ("2026-08-20T10:00:00.123456789+0000", "2026-08-20T10:00:00.123456+00:00"),
        ],
    )
    def test_the_string_that_reaches_the_parser_is_one_3_10_accepts(
        self, stamp: str, normalized: str
    ) -> None:
        _RecordingDatetime.parsed = []

        with patch.object(events, "datetime", _RecordingDatetime):
            events._seen_at(_event("evt", stamp))

        assert _RecordingDatetime.parsed == [normalized]
        assert _PY310_ISOFORMAT.match(normalized), normalized

    def test_a_colonless_offset_reads_the_same_instant_as_zulu(self) -> None:
        seen = events._seen_at(_event("evt", "2026-08-20T10:00:00+0000"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, tzinfo=UTC)

    def test_an_hour_only_offset_reads_the_same_instant_as_zulu(self) -> None:
        seen = events._seen_at(_event("evt", "2026-08-20T10:00:00+00"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, tzinfo=UTC)

    def test_a_colonless_non_utc_offset_keeps_its_instant(self) -> None:
        seen = events._seen_at(_event("evt", "2026-08-20T12:00:00+0200"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, tzinfo=UTC)

    def test_a_stamp_with_no_offset_at_all_reads_as_utc(self) -> None:
        seen = events._seen_at(_event("evt", "2026-08-20T10:00:00"))

        assert seen == datetime(2026, 8, 20, 10, 0, 0, tzinfo=UTC)
        assert seen.utcoffset() == timedelta(0)

    def test_a_colonless_offset_orders_the_read(self) -> None:
        fake = _listing(
            _event("old-evt", "2026-08-20T09:00:00+0000"),
            _event("new-evt", "2026-08-20T10:00:00+0000"),
        )

        envelope = _run(block_params(), fake)

        assert _names(envelope) == ["new-evt", "old-evt"]

    def test_a_stamp_with_no_offset_orders_against_one_that_has_it(self) -> None:
        """Mixing the two forms is what makes the sort raise, not either form on its own."""
        fake = _listing(
            _event("naive-evt", "2026-08-20T09:00:00"),
            _event("zulu-evt", _NEWEST),
        )

        envelope = _run(block_params(), fake)

        assert _names(envelope) == ["zulu-evt", "naive-evt"]

    def test_a_stamp_with_no_offset_is_measured_against_the_age_window(self) -> None:
        fresh = _ago(30).replace("Z", "")
        fake = _listing(_event("fresh-evt", fresh), _event("stale-evt", "2020-01-01T00:00:00"))

        envelope = _run(block_params(within_seconds=600), fake)

        assert _names(envelope) == ["fresh-evt"]


class TestEventsWithNoTimestamp:
    """The no-stamp fallback is itself a Z stamp, so it must parse too."""

    def test_an_event_with_no_stamp_reads_as_the_epoch(self) -> None:
        seen = events._seen_at(_undated_event("undated-evt"))

        assert seen == datetime(1970, 1, 1, 0, 0, 0, tzinfo=UTC)

    def test_the_epoch_sentinel_reaches_the_parser_normalized(self) -> None:
        _RecordingDatetime.parsed = []

        with patch.object(events, "datetime", _RecordingDatetime):
            events._seen_at(_undated_event("undated-evt"))

        assert _RecordingDatetime.parsed == ["1970-01-01T00:00:00+00:00"]

    def test_an_undated_event_sorts_last_without_raising(self) -> None:
        fake = _listing(
            _undated_event("undated-evt"),
            _event("old-evt", _OLDEST),
            _event("new-evt", _NEWEST),
        )

        envelope = _run(block_params(), fake)

        assert _names(envelope) == ["new-evt", "old-evt", "undated-evt"]

    def test_an_undated_event_is_still_returned_and_counted(self) -> None:
        envelope = _run(block_params(), _listing(_undated_event("undated-evt")))

        assert _names(envelope) == ["undated-evt"]
        assert envelope["outputs"]["count"] == 1
        assert envelope["outputs"]["success"] is True

    def test_any_age_window_drops_an_undated_event(self) -> None:
        fake = _listing(_undated_event("undated-evt"), _event("fresh-evt", _ago(60)))

        envelope = _run(block_params(within_seconds=600), fake)

        assert _names(envelope) == ["fresh-evt"]

    def test_a_table_row_with_no_stamp_takes_the_same_fallback(self) -> None:
        body = _table_body()
        undated = _table_row("undated-evt", _OLDEST)
        del undated["object"]["lastTimestamp"]
        body["rows"] = [undated, _table_row("new-evt", _NEWEST)]

        envelope = _run(block_params(output_format="table"), _serving(200, body))

        assert [row[3] for row in envelope["outputs"]["result"]["rows"]] == [
            "pod/new-evt",
            "pod/undated-evt",
        ]
        assert envelope["outputs"]["count"] == 2

    def test_the_creation_timestamp_is_the_last_stamp_the_order_reads(self) -> None:
        event = _undated_event("created-evt")
        event["metadata"]["creationTimestamp"] = _NEWEST

        assert events._seen_at(event) == datetime(2026, 8, 20, 10, 0, 0, tzinfo=UTC)


class TestRemoteInterpreterFloor:
    """The verb must import on the 3.10 host the remote bundle runs on."""

    def test_the_module_never_imports_utc_from_datetime(self) -> None:
        imported = {
            alias.name
            for node in ast.walk(_module_tree())
            if isinstance(node, ast.ImportFrom) and node.module == "datetime"
            for alias in node.names
        }

        assert imported
        assert "UTC" not in imported

    def test_the_module_never_reads_the_datetime_utc_attribute(self) -> None:
        attributes = {
            node.attr for node in ast.walk(_module_tree()) if isinstance(node, ast.Attribute)
        }

        assert attributes
        assert "UTC" not in attributes


class TestFailurePaths:
    """Every refusal the read can meet, in fail mode."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_an_unreadable_session_raises_before_any_request(self, on_error: str) -> None:
        fake = _listing()

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run({"session": "not-a-kubeconfig", "on_error": on_error}, fake)

        assert fake.calls == []

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_missing_session_raises_in_both_modes(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run({"on_error": on_error}, _listing())

    def test_a_kind_the_cluster_does_not_serve_fails_the_read(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources={})
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind_custom="Widget",
            object_name="web-1",
        )

        with pytest.raises(ValueError, match=exact(_DISCOVERY_MISS_MESSAGE)):
            _run(params, fake)

        assert fake.calls == []

    def test_a_denied_discovery_walk_renders_the_credential_row(self) -> None:
        fake = DeniedDiscoveryClient(401, _UNAUTHORIZED_BODY)
        params = block_params(scope_to_object=True, object_kind="Pod", object_name="web-1")

        with pytest.raises(ValueError, match=exact(_UNAUTHORIZED_MESSAGE)):
            _run(params, fake)

        assert fake.discoveries == ["Pod"]
        assert fake.calls == []

    def test_a_406_says_the_cluster_will_not_print_a_table(self) -> None:
        body = {"kind": "Status", "reason": "NotAcceptable", "message": "not acceptable"}

        with pytest.raises(ValueError, match=exact(_TABLE_UNSUPPORTED_MESSAGE)):
            _run(block_params(output_format="table"), _serving(406, body))

    def test_a_plain_list_body_says_the_cluster_will_not_print_a_table(self) -> None:
        body = _event_list(_event("new-evt", _NEWEST))

        with pytest.raises(ValueError, match=exact(_TABLE_UNSUPPORTED_MESSAGE)):
            _run(block_params(output_format="table"), _serving(200, body))

    def test_the_other_formats_never_meet_the_table_arm(self) -> None:
        body = _event_list(_event("new-evt", _NEWEST))

        envelope = _run(block_params(output_format="map"), _serving(200, body))

        assert _names(envelope) == ["new-evt"]

    def test_a_permission_denial_renders_the_shared_row(self) -> None:
        with pytest.raises(ValueError, match=exact(_FORBIDDEN_MESSAGE)):
            _run(block_params(), _serving(403, _FORBIDDEN_BODY))

    def test_an_authentication_failure_renders_the_shared_row(self) -> None:
        with pytest.raises(ValueError, match=exact(_UNAUTHORIZED_MESSAGE)):
            _run(block_params(), _serving(401, _UNAUTHORIZED_BODY))

    def test_a_server_error_names_the_kind_and_the_namespace_once(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = {"kind": "Status", "reason": "ServiceUnavailable", "message": detail, "code": 503}
        message = f"Kubernetes could not list Event objects in namespace '{NAMESPACE}': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(block_params(), _serving(503, body))

    def test_a_cluster_wide_server_error_leaves_the_namespace_out(self) -> None:
        detail = "the server is currently unable to handle the request"
        body = {"kind": "Status", "reason": "ServiceUnavailable", "message": detail}
        message = f"Kubernetes could not list Event objects: {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run(block_params(all_namespaces=True), _serving(503, body))

    def test_a_gateway_answer_at_401_ends_with_the_http_status(self) -> None:
        with pytest.raises(ValueError, match=exact(_GATEWAY_401_MESSAGE)):
            _run(block_params(), _serving(401, {}))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_a_gateway_page_at_200_fails_the_read(self, output_format: str) -> None:
        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            _run(block_params(output_format=output_format), _serving(200, GATEWAY_HTML))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_record_mode_does_not_soften_an_unreadable_body(self, output_format: str) -> None:
        params = block_params(output_format=output_format, on_error="record")

        with pytest.raises(K8sApiError, match=exact(UNREADABLE_BODY_MESSAGE)):
            _run(params, _serving(200, GATEWAY_HTML))

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_a_gateway_page_at_401_still_reads_as_the_status_row(self, output_format: str) -> None:
        with pytest.raises(ValueError, match=exact(_GATEWAY_401_MESSAGE)):
            _run(block_params(output_format=output_format), _serving(401, GATEWAY_HTML))

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_transport_failure_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(block_params(on_error=on_error), fake)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_timeout_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Kubernetes API request GET {_NS_PATH} timed out after 30 seconds"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(block_params(on_error=on_error), fake)


class TestRecordAndContinue:
    """A recorded refusal keeps the block running and says why."""

    def test_a_recorded_denial_fills_the_failure_envelope(self) -> None:
        envelope = _run(block_params(on_error="record"), _serving(403, _FORBIDDEN_BODY))

        assert envelope["outputs"] == {
            "result": [],
            "count": 0,
            "success": False,
            "error": _FORBIDDEN_MESSAGE,
            "reason": "Forbidden",
            "__block_warning": True,
        }
        assert envelope["secrets"] == []

    def test_a_recorded_failure_is_json_serializable(self) -> None:
        envelope = _run(block_params(on_error="record"), _serving(403, _FORBIDDEN_BODY))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_failure_empties_the_table_result(self) -> None:
        params = block_params(on_error="record", output_format="table")

        envelope = _run(params, _serving(403, _FORBIDDEN_BODY))

        assert envelope["outputs"]["result"] == _EMPTY_TABLE

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_a_recorded_failure_empties_the_text_result(self, output_format: str) -> None:
        params = block_params(on_error="record", output_format=output_format)

        envelope = _run(params, _serving(403, json.dumps(_FORBIDDEN_BODY).encode()))

        assert envelope["outputs"]["result"] == ""

    def test_a_discovery_miss_is_recordable(self) -> None:
        fake = _listing(_event("new-evt", _NEWEST), resources={})
        params = block_params(
            scope_to_object=True,
            object_type="custom",
            object_kind_custom="Widget",
            object_name="web-1",
            on_error="record",
        )

        envelope = _run(params, fake)

        assert envelope["outputs"]["error"] == _DISCOVERY_MISS_MESSAGE
        assert envelope["outputs"]["reason"] == "NotFound"

    def test_a_denied_discovery_walk_is_recordable(self) -> None:
        fake = DeniedDiscoveryClient(403, _FORBIDDEN_BODY)
        params = block_params(
            scope_to_object=True, object_kind="Pod", object_name="web-1", on_error="record"
        )

        envelope = _run(params, fake)

        assert envelope["outputs"]["error"] == _FORBIDDEN_MESSAGE
        assert envelope["outputs"]["reason"] == "Forbidden"

    def test_the_table_refusal_is_recorded_with_the_not_acceptable_reason(self) -> None:
        body = _event_list(_event("new-evt", _NEWEST))
        params = block_params(output_format="table", on_error="record")

        envelope = _run(params, _serving(200, body))

        assert envelope["outputs"]["error"] == _TABLE_UNSUPPORTED_MESSAGE
        assert envelope["outputs"]["reason"] == "NotAcceptable"
        assert envelope["outputs"]["result"] == _EMPTY_TABLE

    def test_a_gateway_answer_records_an_empty_reason(self) -> None:
        envelope = _run(block_params(on_error="record"), _serving(403, {}))

        assert envelope["outputs"]["error"] == (
            f"Kubernetes could not list Event objects in namespace '{NAMESPACE}' (HTTP 403)"
        )
        assert envelope["outputs"]["reason"] == ""


class TestLogCalls:
    """The verb logs through the callable it is handed, never a logger object."""

    def test_a_successful_read_logs_one_info_line(self) -> None:
        log = _Recorder()
        fake = _listing(_event("new-evt", _NEWEST), _event("old-evt", _OLDEST))

        _run(block_params(), fake, log)

        assert log.entries == [("INFO", f"Read 2 event(s) from {_NS_PATH}")]

    def test_the_info_line_names_the_path_the_verb_requested(self) -> None:
        log = _Recorder()
        fake = _listing(_event("new-evt", _NEWEST))
        params = block_params(scope_to_object=True, object_kind="Pod", object_name="web-1")

        _run(params, fake, log)

        assert log.entries == [("INFO", f"Read 1 event(s) from {fake.last.path}")]

    def test_an_empty_read_still_logs_its_count(self) -> None:
        log = _Recorder()

        _run(block_params(), _listing(), log)

        assert log.entries == [("INFO", f"Read 0 event(s) from {_NS_PATH}")]

    def test_a_recorded_denial_logs_one_warn_line(self) -> None:
        log = _Recorder()

        _run(block_params(on_error="record"), _serving(403, _FORBIDDEN_BODY), log)

        assert log.entries == [("WARN", f"Read failed (Forbidden): {_FORBIDDEN_MESSAGE}")]

    def test_a_recorded_failure_with_no_reason_leaves_the_detail_out(self) -> None:
        log = _Recorder()
        message = f"Kubernetes could not list Event objects in namespace '{NAMESPACE}' (HTTP 403)"

        _run(block_params(on_error="record"), _serving(403, {}), log)

        assert log.entries == [("WARN", f"Read failed: {message}")]

    def test_fail_mode_logs_nothing(self) -> None:
        log = _Recorder()

        with pytest.raises(ValueError):
            _run(block_params(), _serving(403, _FORBIDDEN_BODY), log)

        assert log.entries == []

    def test_a_happy_read_logs_no_warn_line(self) -> None:
        log = _Recorder()

        _run(block_params(on_error="record"), _listing(_event("new-evt", _NEWEST)), log)

        assert log.levels == ["INFO"]
