"""K8s verb-core read-output tests (REQ-5.1.1, REQ-3.4.1.5, REQ-3.4.1.6, REQ-3.4.1.15).

The output half of the verb core: the shared success/error/reason core every K8s
block returns, the fail-or-record dispatch that writes its one WARN line through
the log callable a verb is handed, the wire mode each output format asks the
cluster for, and the JSON-safe envelopes a read hands back. Nothing here parses or
renders YAML and nothing here builds a WAVE table object: the core requests JSON,
emits envelopes, and leaves rendering to the caller that receives them. The
value-typed table the SQL and OpenSearch cores build from rows lives here too.
"""

import inspect
import json
import re
import uuid
from datetime import date, datetime
from datetime import time as clock_time
from decimal import Decimal
from typing import Any

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    SERVER,
    UNREADABLE_BODY_MESSAGE,
    Call,
    FakeK8sClient,
    resource,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.connectivity.k8s.verbs import _outputs
from wavecore.connectivity.k8s.verbs._outputs import (
    TABLE_ACCEPT,
    block_failure,
    block_success,
    empty_read_result,
    read_formatted,
    render_read_result,
    strip_managed_fields,
    table_from_k8s,
)
from wavecore.core.table import Table

_ON_ERROR_MODES = ["fail", "record"]
_NOT_FOUND_MESSAGE = "K8s Pod 'web-1' not found in namespace 'apps'"
_CLUSTER_REASONS = ["NotFound", "AlreadyExists", "Forbidden", "Conflict"]
_CLIENT_FAILURES = [
    pytest.param(
        f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] Connection refused",
        id="transport",
    ),
    pytest.param(
        f"Could not verify the TLS certificate of {SERVER}: certificate verify failed",
        id="tls",
    ),
    pytest.param(
        "Kubernetes API request GET /api/v1/namespaces/apps/pods timed out after 30 seconds",
        id="timeout",
    ),
]
_BLOCK_ACTIONS = ["Read", "Apply", "Delete", "Scale", "Rollout"]
_MANAGED_FIELDS = [
    {
        "manager": "kubectl-client-side-apply",
        "operation": "Update",
        "apiVersion": "v1",
        "time": "2026-08-20T10:00:00Z",
        "fieldsType": "FieldsV1",
        "fieldsV1": {"f:spec": {"f:containers": {}}},
    }
]
# metrics-server reports CPU in nanocores, so this is the ordinary magnitude, not an edge case.
_NANOCORE_CPU = 0.000001234
_APPLY_COLUMNS = [("RESOURCE", "string"), ("OUTCOME", "string")]
_ROLLOUT_COLUMNS = [("RESOURCE", "string"), ("OUTCOME", "string"), ("MESSAGE", "string")]
_SCALE_COLUMNS = [
    ("RESOURCE", "string"),
    ("OUTCOME", "string"),
    ("PREVIOUS", "integer"),
    ("REPLICAS", "integer"),
]
_COPY_COLUMNS = [("SOURCE", "string"), ("TARGET", "string"), ("SIZE", "integer")]
_APPLY_ROWS = [["configmap/probe-a", "created"], ["secret/db", "configured"]]
_ROLLOUT_ROWS = [["deployment.apps/web", "restarted", "deployment.apps/web restarted"]]
_SCALE_ROWS = [["deployment.apps/web", "scaled", 0, 3]]
_COPY_ROWS = [["/srv/probe.txt", "web-1:/srv/probe.txt", 12]]
_SUMMARY_SHAPES = [
    pytest.param(_APPLY_COLUMNS, _APPLY_ROWS, id="apply-delete"),
    pytest.param(_ROLLOUT_COLUMNS, _ROLLOUT_ROWS, id="rollout"),
    pytest.param(_SCALE_COLUMNS, _SCALE_ROWS, id="scale"),
    pytest.param(_COPY_COLUMNS, _COPY_ROWS, id="copy"),
]
_RESOURCE_SHAPES = [
    pytest.param(_APPLY_COLUMNS, id="apply-delete"),
    pytest.param(_ROLLOUT_COLUMNS, id="rollout"),
    pytest.param(_SCALE_COLUMNS, id="scale"),
]
_EMPTY_STREAMS = {"stdout": "", "stderr": "", "exit_code": 0}


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _signature_of(function: Any, name: str) -> inspect.Parameter:
    return inspect.signature(function).parameters[name]


class _Log:
    """Records the (level, message) pairs a verb writes through its log callable."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def __call__(self, level: str, message: str) -> None:
        self.calls.append((level, message))


def _get_empties() -> dict[str, Any]:
    return {"result": {}, "names": [], "count": 0}


def _managed_pod() -> dict[str, Any]:
    return {
        "kind": "Pod",
        "apiVersion": "v1",
        "metadata": {
            "name": "web-1",
            "namespace": "apps",
            "resourceVersion": "42",
            "managedFields": _MANAGED_FIELDS,
        },
        "status": {"phase": "Running"},
    }


def _through_recordable_branch(params: dict[str, Any], error: Exception, reason: str = "") -> Any:
    """The branch a read verb wraps its client call in: only ValueErrors record."""
    try:
        raise error
    except ValueError as exc:
        return block_failure(params, {}, str(exc), reason, _Log(), action="Read")


def _rebuilt(envelope: dict[str, Any]) -> Table:
    """The table a caller materializes from a summary envelope, minus its wire-type key."""
    return Table.from_dict({key: value for key, value in envelope.items() if key != "__wave_type"})


def _k8s_table(columns: list[dict[str, Any]], rows: list[list[Any]]) -> dict[str, Any]:
    """A Kubernetes Table answer with the given column definitions and cell rows."""
    return {
        "kind": "Table",
        "apiVersion": "meta.k8s.io/v1",
        "columnDefinitions": columns,
        "rows": [{"cells": cells} for cells in rows],
    }


class TestBlockOutcome:
    """The output core and the on_error dispatch at their own seam."""

    def test_success_merges_the_core_after_the_unique_outputs(self) -> None:
        result = block_success({"logs": "line-1", "count": 1})

        assert result == {
            "logs": "line-1",
            "count": 1,
            "success": True,
            "error": "",
            "reason": "",
        }
        assert list(result) == ["logs", "count", "success", "error", "reason"]

    def test_success_sets_the_core_to_its_empty_values(self) -> None:
        result = block_success({})

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    def test_success_does_not_mutate_the_outputs_it_is_given(self) -> None:
        outputs: dict[str, Any] = {"logs": "line-1"}

        block_success(outputs)

        assert outputs == {"logs": "line-1"}

    def test_record_returns_the_empty_defaults_with_the_failed_core(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(
            params, _get_empties(), _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
        )

        assert result == {
            "result": {},
            "names": [],
            "count": 0,
            "success": False,
            "error": _NOT_FOUND_MESSAGE,
            "reason": "NotFound",
            "__block_warning": True,
        }
        assert list(result) == [
            "result",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        ]

    def test_record_keeps_success_false_as_a_boolean(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(
            params, {"logs": ""}, _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
        )

        assert result["success"] is False

    def test_record_does_not_mutate_the_empty_defaults(self) -> None:
        empties: dict[str, Any] = {"logs": ""}

        block_failure(
            {"on_error": "record"},
            empties,
            _NOT_FOUND_MESSAGE,
            "NotFound",
            _Log(),
            action="Read",
        )

        assert empties == {"logs": ""}

    @pytest.mark.parametrize("reason", _CLUSTER_REASONS)
    def test_cluster_reason_is_passed_through_verbatim(self, reason: str) -> None:
        params = {"on_error": "record"}

        result = block_failure(params, {}, _NOT_FOUND_MESSAGE, reason, _Log(), action="Read")

        assert result["reason"] == reason

    def test_an_unknown_reason_is_passed_through_unchanged(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(
            params, {}, _NOT_FOUND_MESSAGE, "SomethingNew", _Log(), action="Read"
        )

        assert result["reason"] == "SomethingNew"

    def test_an_absent_reason_records_as_an_empty_string(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(params, {}, _NOT_FOUND_MESSAGE, "", _Log(), action="Read")

        assert result["reason"] == ""

    def test_a_missing_reason_never_records_as_none(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(params, {}, _NOT_FOUND_MESSAGE, None, _Log(), action="Read")

        assert result["reason"] == ""

    def test_fail_mode_raises_the_exact_message(self) -> None:
        params = {"on_error": "fail"}

        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure(
                params, _get_empties(), _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
            )

    def test_fail_is_the_default_when_on_error_is_absent(self) -> None:
        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure({}, _get_empties(), _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read")

    def test_only_record_records_and_any_other_value_raises(self) -> None:
        params = {"on_error": "continue"}

        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure(
                params, _get_empties(), _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
            )


class TestRecordedFailureIsAmber:
    """A recorded failure asks for the amber block status and says so at WARN."""

    def test_the_recorded_result_carries_the_warning_signal(self) -> None:
        result = block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
        )

        assert result["__block_warning"] is True

    def test_the_signal_is_the_last_key_so_the_outputs_keep_their_order(self) -> None:
        result = block_failure(
            {"on_error": "record"},
            {"logs": ""},
            _NOT_FOUND_MESSAGE,
            "NotFound",
            _Log(),
            action="Read",
        )

        assert list(result)[-1] == "__block_warning"

    def test_the_warn_line_names_the_reason_and_the_error_and_stops_there(self) -> None:
        log = _Log()

        block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action="Read"
        )

        assert log.calls == [("WARN", f"Read failed (NotFound): {_NOT_FOUND_MESSAGE}")]

    @pytest.mark.parametrize("reason", ["", None], ids=["empty", "absent"])
    def test_a_failure_with_no_cluster_reason_drops_the_parenthetical(
        self, reason: str | None
    ) -> None:
        log = _Log()

        block_failure({"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, reason, log, action="Read")

        assert log.calls == [("WARN", f"Read failed: {_NOT_FOUND_MESSAGE}")]

    def test_the_level_is_warn_and_nothing_else(self) -> None:
        log = _Log()

        block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action="Read"
        )

        assert [level for level, _ in log.calls] == ["WARN"]

    @pytest.mark.parametrize("params", [{"on_error": "fail"}, {}], ids=["explicit", "default"])
    def test_fail_mode_raises_and_logs_nothing(self, params: dict[str, Any]) -> None:
        log = _Log()

        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure(params, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action="Read")

        assert log.calls == []


class TestRecordedFailureAction:
    """The WARN line heads with the block's own noun, not with the operation verb."""

    def test_the_action_is_keyword_only_and_has_no_default(self) -> None:
        parameter = _signature_of(block_failure, "action")

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is inspect.Parameter.empty

    @pytest.mark.parametrize("action", _BLOCK_ACTIONS)
    def test_the_line_names_the_action_then_the_reason(self, action: str) -> None:
        line = _outputs._recorded_failure_line(action, _NOT_FOUND_MESSAGE, "NotFound")

        assert line == f"{action} failed (NotFound): {_NOT_FOUND_MESSAGE}"

    @pytest.mark.parametrize("action", _BLOCK_ACTIONS)
    def test_a_line_with_no_reason_drops_the_parenthetical(self, action: str) -> None:
        line = _outputs._recorded_failure_line(action, _NOT_FOUND_MESSAGE, None)

        assert line == f"{action} failed: {_NOT_FOUND_MESSAGE}"

    @pytest.mark.parametrize("action", _BLOCK_ACTIONS)
    def test_the_dispatch_logs_the_action_it_was_handed(self, action: str) -> None:
        log = _Log()

        block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action=action
        )

        assert log.calls == [("WARN", f"{action} failed (NotFound): {_NOT_FOUND_MESSAGE}")]

    def test_the_action_never_reaches_the_recorded_outputs(self) -> None:
        result = block_failure(
            {"on_error": "record"},
            {},
            _NOT_FOUND_MESSAGE,
            "NotFound",
            _Log(),
            action="Apply",
        )

        assert set(result) == {"success", "error", "reason", "__block_warning"}

    @pytest.mark.parametrize("action", _BLOCK_ACTIONS)
    def test_fail_mode_raises_the_message_alone(self, action: str) -> None:
        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure({}, {}, _NOT_FOUND_MESSAGE, "NotFound", _Log(), action=action)


class TestAlwaysHardFail:
    """The always-hard-fail classes raise under both on_error values."""

    @pytest.mark.parametrize("on_error", _ON_ERROR_MODES)
    @pytest.mark.parametrize("message", _CLIENT_FAILURES)
    def test_client_failures_stay_raised_in_both_modes(self, message: str, on_error: str) -> None:
        params = {"on_error": on_error}

        with pytest.raises(K8sApiError, match=_exact(message)):
            _through_recordable_branch(params, K8sApiError(message))

    def test_client_failures_are_not_value_errors(self) -> None:
        assert not issubclass(K8sApiError, ValueError)

    def test_a_cluster_error_on_the_same_branch_is_recordable(self) -> None:
        params = {"on_error": "record"}

        result = _through_recordable_branch(params, ValueError(_NOT_FOUND_MESSAGE), "NotFound")

        assert result["success"] is False
        assert result["error"] == _NOT_FOUND_MESSAGE
        assert result["reason"] == "NotFound"


class TestFailureLogCallable:
    """A verb has no logger object, only the log callable the engine hands it."""

    def test_the_log_callable_is_the_fifth_positional_parameter(self) -> None:
        parameter = _signature_of(block_failure, "log")

        assert parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
        assert parameter.default is inspect.Parameter.empty

    def test_the_line_is_written_as_a_level_and_a_message_pair(self) -> None:
        recorded: list[tuple[str, str]] = []

        block_failure(
            {"on_error": "record"},
            {},
            _NOT_FOUND_MESSAGE,
            "NotFound",
            lambda level, message: recorded.append((level, message)),
            action="Read",
        )

        assert recorded == [("WARN", f"Read failed (NotFound): {_NOT_FOUND_MESSAGE}")]

    def test_a_plain_two_argument_function_is_log_enough(self) -> None:
        lines: list[str] = []

        def log(level: str, message: str) -> None:
            lines.append(f"{level} {message}")

        result = block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action="Read"
        )

        assert lines == [f"WARN Read failed (NotFound): {_NOT_FOUND_MESSAGE}"]
        assert result["__block_warning"] is True


class TestStripManagedFields:
    """kubectl hides metadata.managedFields unless it is asked for; so does WAVE."""

    def test_one_object_loses_only_managed_fields(self) -> None:
        scrubbed = strip_managed_fields(_managed_pod())

        assert scrubbed["metadata"] == {
            "name": "web-1",
            "namespace": "apps",
            "resourceVersion": "42",
        }
        assert scrubbed["status"] == {"phase": "Running"}

    def test_an_object_without_managed_fields_is_returned_unchanged(self) -> None:
        pod = {"kind": "Pod", "metadata": {"name": "web-1"}}

        assert strip_managed_fields(pod) == pod

    def test_an_object_with_no_metadata_at_all_is_returned_unchanged(self) -> None:
        assert strip_managed_fields({"kind": "Status"}) == {"kind": "Status"}

    def test_an_empty_document_is_returned_unchanged(self) -> None:
        assert strip_managed_fields({}) == {}

    def test_every_item_of_a_list_document_is_scrubbed(self) -> None:
        listing = {"kind": "PodList", "items": [_managed_pod(), _managed_pod()]}

        scrubbed = strip_managed_fields(listing)

        assert all("managedFields" not in item["metadata"] for item in scrubbed["items"])
        assert scrubbed["kind"] == "PodList"

    def test_the_list_metadata_is_scrubbed_too(self) -> None:
        listing = {"kind": "PodList", "metadata": {"managedFields": _MANAGED_FIELDS}, "items": []}

        assert strip_managed_fields(listing)["metadata"] == {}

    def test_every_embedded_table_object_is_scrubbed(self) -> None:
        table = {
            "kind": "Table",
            "columnDefinitions": [],
            "rows": [{"cells": ["web-1"], "object": _managed_pod()}],
        }

        scrubbed = strip_managed_fields(table)

        assert "managedFields" not in scrubbed["rows"][0]["object"]["metadata"]

    def test_a_table_row_with_no_object_is_left_alone(self) -> None:
        table = {"kind": "Table", "columnDefinitions": [], "rows": [{"cells": ["web-1"]}]}

        assert strip_managed_fields(table) == table

    def test_the_document_is_scrubbed_in_place(self) -> None:
        pod = _managed_pod()

        assert strip_managed_fields(pod) is pod
        assert "managedFields" not in pod["metadata"]


class TestRenderReadResult:
    """The 'result' value each output format hands back."""

    def test_map_returns_the_object_itself(self) -> None:
        pod = {"kind": "Pod", "metadata": {"name": "web-1"}}

        assert render_read_result("map", pod) == pod

    def test_map_returns_the_items_of_a_list_document(self) -> None:
        listing = {"kind": "PodList", "items": [{"metadata": {"name": "web-1"}}]}

        assert render_read_result("map", listing) == listing["items"]

    def test_json_re_serializes_the_document(self) -> None:
        pod = {"kind": "Pod", "metadata": {"name": "web-1"}}

        assert render_read_result("json", pod) == json.dumps(pod)

    def test_yaml_hands_the_document_on_in_an_envelope(self) -> None:
        pod = {"kind": "Pod", "apiVersion": "v1"}

        assert render_read_result("yaml", pod) == {"__wave_type": "yaml", "value": pod}

    def test_an_empty_document_stays_empty_text(self) -> None:
        assert render_read_result("json", {}) == ""

    def test_table_returns_a_table_envelope(self) -> None:
        table = _k8s_table([{"name": "Name", "type": "string"}], [["web-1"]])

        assert render_read_result("table", table) == {
            "__wave_type": "table",
            "columns": [{"name": "Name", "type": "string"}],
            "rows": [["web-1"]],
        }


class TestReadResultEnvelopes:
    """Every format's 'result' is JSON-safe: text, plain data, or a typed envelope."""

    def test_an_empty_document_still_becomes_a_yaml_envelope(self) -> None:
        assert render_read_result("yaml", {}) == {"__wave_type": "yaml", "value": {}}

    def test_an_empty_document_becomes_an_empty_table_envelope(self) -> None:
        assert render_read_result("table", {}) == {
            "__wave_type": "table",
            "columns": [],
            "rows": [],
        }

    def test_a_list_document_is_serialized_whole_as_json(self) -> None:
        listing = {"kind": "PodList", "items": [{"metadata": {"name": "web-1"}}]}

        assert render_read_result("json", listing) == json.dumps(listing)

    def test_a_list_document_rides_whole_in_the_yaml_envelope(self) -> None:
        listing = {"kind": "PodList", "items": [{"metadata": {"name": "web-1"}}]}

        assert render_read_result("yaml", listing) == {"__wave_type": "yaml", "value": listing}

    def test_a_document_with_no_items_key_is_returned_whole_as_a_map(self) -> None:
        pod = {"kind": "Pod", "metadata": {"name": "web-1"}}

        assert render_read_result("map", pod) is pod

    def test_an_empty_table_result_is_an_empty_table_envelope(self) -> None:
        assert empty_read_result("table", listed=True) == {
            "__wave_type": "table",
            "columns": [],
            "rows": [],
        }

    def test_an_empty_table_result_ignores_the_listed_flag(self) -> None:
        assert empty_read_result("table", listed=False) == empty_read_result("table", listed=True)

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_an_empty_text_result_is_the_empty_string(self, output_format: str) -> None:
        assert empty_read_result(output_format, listed=True) == ""

    def test_an_empty_listed_map_result_is_an_empty_list(self) -> None:
        assert empty_read_result("map", listed=True) == []

    def test_an_empty_named_map_result_is_an_empty_object(self) -> None:
        assert empty_read_result("map", listed=False) == {}

    def test_the_listed_flag_is_keyword_only(self) -> None:
        parameter = _signature_of(empty_read_result, "listed")

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY


class TestReadRequestOptions:
    """The wire mode each output format asks for; yaml asks for exactly what json asks for."""

    def test_the_table_accept_header_names_the_meta_table_kind(self) -> None:
        assert TABLE_ACCEPT == "application/json;as=Table;g=meta.k8s.io;v=v1,application/json"

    def test_table_asks_for_the_table_accept_header_and_a_parsed_body(self) -> None:
        assert _outputs._read_request_options("table") == (TABLE_ACCEPT, False)

    def test_json_asks_for_the_raw_body_under_the_default_accept(self) -> None:
        assert _outputs._read_request_options("json") == (None, True)

    def test_yaml_asks_for_the_raw_body_under_the_default_accept(self) -> None:
        assert _outputs._read_request_options("yaml") == (None, True)

    def test_yaml_asks_for_exactly_what_json_asks_for(self) -> None:
        assert _outputs._read_request_options("yaml") == _outputs._read_request_options("json")

    def test_no_format_asks_the_cluster_for_yaml(self) -> None:
        formats = ["map", "table", "json", "yaml"]

        accepts = [_outputs._read_request_options(name)[0] for name in formats]

        assert "application/yaml" not in accepts

    def test_map_takes_the_default_accept_and_a_parsed_body(self) -> None:
        assert _outputs._read_request_options("map") == (None, False)


class TestDecodeTextBody:
    """A raw body is JSON: an unreadable success body is an error, an unreadable failure is not."""

    def test_a_json_object_body_is_parsed(self) -> None:
        assert _outputs._decode_text_body(200, b'{"kind": "Pod"}') == {"kind": "Pod"}

    def test_a_text_body_is_parsed_too(self) -> None:
        assert _outputs._decode_text_body(200, '{"kind": "Pod"}') == {"kind": "Pod"}

    def test_an_empty_body_is_an_empty_document(self) -> None:
        assert _outputs._decode_text_body(200, b"") == {}

    def test_an_unreadable_success_body_is_refused(self) -> None:
        with pytest.raises(K8sApiError, match=_exact(UNREADABLE_BODY_MESSAGE)):
            _outputs._decode_text_body(200, b"<html><body>502 Bad Gateway</body></html>")

    def test_a_json_scalar_success_body_is_refused(self) -> None:
        with pytest.raises(K8sApiError, match=_exact(UNREADABLE_BODY_MESSAGE)):
            _outputs._decode_text_body(200, b"42")

    def test_a_yaml_document_is_no_longer_readable(self) -> None:
        with pytest.raises(K8sApiError, match=_exact(UNREADABLE_BODY_MESSAGE)):
            _outputs._decode_text_body(200, b"kind: Pod\napiVersion: v1\n")

    def test_an_unreadable_failure_body_is_an_empty_document(self) -> None:
        assert _outputs._decode_text_body(404, b"<html><body>404</body></html>") == {}

    def test_a_readable_failure_body_is_still_parsed(self) -> None:
        status = b'{"kind": "Status", "reason": "NotFound"}'

        assert _outputs._decode_text_body(404, status) == {"kind": "Status", "reason": "NotFound"}


class TestReadFormatted:
    """Each format's GET, on the calling thread: the exact request the cluster receives."""

    def test_a_table_read_asks_for_the_table_accept_header(self) -> None:
        client = FakeK8sClient([(200, {"kind": "Table"})])

        status, parsed = read_formatted(client, "/api/v1/namespaces/apps/pods", "table")

        assert (status, parsed) == (200, {"kind": "Table"})
        assert client.last == Call(
            "GET", "/api/v1/namespaces/apps/pods", None, TABLE_ACCEPT, None, False
        )

    def test_a_json_read_asks_for_the_raw_body(self) -> None:
        client = FakeK8sClient([(200, b'{"kind": "Pod"}')])

        status, parsed = read_formatted(client, "/api/v1/namespaces/apps/pods/web-1", "json")

        assert (status, parsed) == (200, {"kind": "Pod"})
        assert client.last == Call(
            "GET", "/api/v1/namespaces/apps/pods/web-1", None, None, None, True
        )

    def test_a_yaml_read_asks_the_cluster_for_json(self) -> None:
        client = FakeK8sClient([(200, b'{"kind": "Pod"}')])

        status, parsed = read_formatted(client, "/api/v1/namespaces/apps/pods/web-1", "yaml")

        assert (status, parsed) == (200, {"kind": "Pod"})
        assert client.last == Call(
            "GET", "/api/v1/namespaces/apps/pods/web-1", None, None, None, True
        )

    def test_a_map_read_takes_the_parsed_body_the_client_returns(self) -> None:
        client = FakeK8sClient([(200, {"kind": "Pod"})])

        status, parsed = read_formatted(client, "/api/v1/namespaces/apps/pods/web-1", "map")

        assert (status, parsed) == (200, {"kind": "Pod"})
        assert client.last == Call(
            "GET", "/api/v1/namespaces/apps/pods/web-1", None, None, None, False
        )

    def test_the_status_the_cluster_answered_is_handed_back(self) -> None:
        client = FakeK8sClient([(404, {"kind": "Status", "reason": "NotFound"})])

        status, parsed = read_formatted(client, "/api/v1/namespaces/apps/pods/web-1", "map")

        assert status == 404
        assert parsed == {"kind": "Status", "reason": "NotFound"}

    def test_one_read_makes_exactly_one_request(self) -> None:
        client = FakeK8sClient([(200, {})])

        read_formatted(client, "/api/v1/namespaces/apps/pods", "map")

        assert len(client.calls) == 1


class TestTableEnvelope:
    """The table envelope a read emits: the Table.to_dict shape, built from a Kubernetes Table."""

    def test_the_envelope_names_its_wire_type(self) -> None:
        table = _k8s_table([{"name": "Name", "type": "string"}], [["web-1"]])

        assert table_from_k8s(table)["__wave_type"] == "table"

    def test_the_envelope_carries_only_the_three_wire_keys(self) -> None:
        table = _k8s_table([{"name": "Name", "type": "string"}], [["web-1"]])

        assert set(table_from_k8s(table)) == {"__wave_type", "columns", "rows"}

    def test_a_document_with_no_table_in_it_is_an_empty_envelope(self) -> None:
        assert table_from_k8s({}) == {"__wave_type": "table", "columns": [], "rows": []}

    def test_a_string_column_keeps_its_cells_verbatim(self) -> None:
        table = _k8s_table([{"name": "Name", "type": "string"}], [["web-1"], ["web-2"]])

        assert table_from_k8s(table) == {
            "__wave_type": "table",
            "columns": [{"name": "Name", "type": "string"}],
            "rows": [["web-1"], ["web-2"]],
        }

    def test_an_integer_column_carries_its_type_across(self) -> None:
        table = _k8s_table([{"name": "Restarts", "type": "integer"}], [[3], [0]])

        assert table_from_k8s(table) == {
            "__wave_type": "table",
            "columns": [{"name": "Restarts", "type": "integer"}],
            "rows": [[3], [0]],
        }

    def test_a_number_column_becomes_a_float_column(self) -> None:
        table = _k8s_table([{"name": "Load", "type": "number"}], [[1.5], [2]])

        assert table_from_k8s(table) == {
            "__wave_type": "table",
            "columns": [{"name": "Load", "type": "float"}],
            "rows": [[1.5], [2]],
        }

    def test_a_boolean_column_carries_its_type_across(self) -> None:
        table = _k8s_table([{"name": "Ready", "type": "boolean"}], [[True], [False]])

        assert table_from_k8s(table) == {
            "__wave_type": "table",
            "columns": [{"name": "Ready", "type": "boolean"}],
            "rows": [[True], [False]],
        }

    def test_a_column_type_the_cluster_invented_prints_as_a_string(self) -> None:
        table = _k8s_table([{"name": "Age", "type": "date"}], [["5d"]])

        assert table_from_k8s(table)["columns"] == [{"name": "Age", "type": "string"}]

    def test_a_column_with_no_declared_type_prints_as_a_string(self) -> None:
        table = _k8s_table([{"name": "Age"}], [["5d"]])

        assert table_from_k8s(table)["columns"] == [{"name": "Age", "type": "string"}]

    def test_a_column_with_no_declared_name_is_named_by_an_empty_string(self) -> None:
        table = _k8s_table([{"type": "string"}], [["web-1"]])

        assert table_from_k8s(table)["columns"] == [{"name": "", "type": "string"}]

    def test_a_column_downgrades_to_string_when_one_cell_conflicts(self) -> None:
        table = _k8s_table([{"name": "Restarts", "type": "integer"}], [[3], ["n/a"]])

        assert table_from_k8s(table) == {
            "__wave_type": "table",
            "columns": [{"name": "Restarts", "type": "string"}],
            "rows": [["3"], ["n/a"]],
        }

    def test_a_boolean_never_conforms_to_an_integer_column(self) -> None:
        table = _k8s_table([{"name": "Restarts", "type": "integer"}], [[3], [True]])

        assert table_from_k8s(table) == {
            "__wave_type": "table",
            "columns": [{"name": "Restarts", "type": "string"}],
            "rows": [["3"], ["True"]],
        }

    def test_an_integer_conforms_to_a_number_column(self) -> None:
        table = _k8s_table([{"name": "Load", "type": "number"}], [[2]])

        assert table_from_k8s(table)["columns"] == [{"name": "Load", "type": "float"}]

    def test_a_float_never_conforms_to_an_integer_column(self) -> None:
        table = _k8s_table([{"name": "Restarts", "type": "integer"}], [[1.5]])

        assert table_from_k8s(table)["columns"] == [{"name": "Restarts", "type": "string"}]

    def test_a_none_cell_conforms_to_every_column_type(self) -> None:
        columns = [
            {"name": "Restarts", "type": "integer"},
            {"name": "Load", "type": "number"},
            {"name": "Ready", "type": "boolean"},
        ]
        table = _k8s_table(columns, [[None, None, None]])

        assert table_from_k8s(table) == {
            "__wave_type": "table",
            "columns": [
                {"name": "Restarts", "type": "integer"},
                {"name": "Load", "type": "float"},
                {"name": "Ready", "type": "boolean"},
            ],
            "rows": [[None, None, None]],
        }

    def test_a_none_cell_in_a_string_column_stays_none(self) -> None:
        table = _k8s_table([{"name": "Name", "type": "string"}], [[None]])

        assert table_from_k8s(table)["rows"] == [[None]]

    def test_a_short_row_is_ignored_when_the_column_is_typed(self) -> None:
        columns = [{"name": "Name", "type": "string"}, {"name": "Restarts", "type": "integer"}]
        table = _k8s_table(columns, [["web-1", 3], ["web-2"]])

        assert table_from_k8s(table) == {
            "__wave_type": "table",
            "columns": [
                {"name": "Name", "type": "string"},
                {"name": "Restarts", "type": "integer"},
            ],
            "rows": [["web-1", 3], ["web-2"]],
        }

    def test_a_row_with_more_cells_than_columns_drops_the_extra_cells(self) -> None:
        table = _k8s_table([{"name": "Name", "type": "string"}], [["web-1", "extra"]])

        assert table_from_k8s(table)["rows"] == [["web-1"]]

    def test_a_row_that_declares_no_cells_is_an_empty_row(self) -> None:
        table = {
            "kind": "Table",
            "columnDefinitions": [{"name": "Name", "type": "string"}],
            "rows": [{"object": {"kind": "Pod"}}],
        }

        assert table_from_k8s(table)["rows"] == [[]]

    def test_the_envelope_survives_a_json_round_trip(self) -> None:
        columns = [{"name": "Name", "type": "string"}, {"name": "CPU", "type": "number"}]
        table = _k8s_table(columns, [["web-1", _NANOCORE_CPU]])

        envelope = table_from_k8s(table)

        assert json.loads(json.dumps(envelope)) == envelope


class TestSummaryTableEnvelope:
    """The Summary table every write verb returns, as an envelope the caller materializes."""

    def test_the_value_is_a_table_envelope(self) -> None:
        assert _outputs.summary_table(_APPLY_COLUMNS, [])["__wave_type"] == "table"

    def test_the_envelope_carries_only_the_three_wire_keys(self) -> None:
        envelope = _outputs.summary_table(_APPLY_COLUMNS, _APPLY_ROWS)

        assert set(envelope) == {"__wave_type", "columns", "rows"}

    def test_the_columns_keep_the_order_they_were_declared_in(self) -> None:
        envelope = _outputs.summary_table(_SCALE_COLUMNS, [])

        assert [column["name"] for column in envelope["columns"]] == [
            "RESOURCE",
            "OUTCOME",
            "PREVIOUS",
            "REPLICAS",
        ]

    def test_the_declared_column_types_are_the_ones_the_caller_named(self) -> None:
        envelope = _outputs.summary_table(_SCALE_COLUMNS, [])

        assert [column["type"] for column in envelope["columns"]] == [
            "string",
            "string",
            "integer",
            "integer",
        ]

    def test_a_column_type_no_table_knows_is_carried_verbatim(self) -> None:
        envelope = _outputs.summary_table([("AGE", "duration")], [])

        assert envelope["columns"] == [{"name": "AGE", "type": "duration"}]

    def test_the_rows_keep_the_order_they_were_given_in(self) -> None:
        envelope = _outputs.summary_table(_APPLY_COLUMNS, _APPLY_ROWS)

        assert envelope["rows"] == [
            ["configmap/probe-a", "created"],
            ["secret/db", "configured"],
        ]

    def test_an_integer_cell_of_zero_stays_the_number_zero(self) -> None:
        envelope = _outputs.summary_table(_SCALE_COLUMNS, _SCALE_ROWS)

        assert envelope["rows"] == [["deployment.apps/web", "scaled", 0, 3]]

    def test_a_row_shorter_than_the_columns_is_carried_unpadded(self) -> None:
        envelope = _outputs.summary_table(_SCALE_COLUMNS, [["deployment.apps/web"]])

        assert envelope["rows"] == [["deployment.apps/web"]]

    def test_a_cell_the_declared_type_would_refuse_is_carried_anyway(self) -> None:
        envelope = _outputs.summary_table(_SCALE_COLUMNS, [["web", "scaled", "two", 3]])

        assert envelope["rows"] == [["web", "scaled", "two", 3]]

    def test_no_rows_still_declares_the_columns(self) -> None:
        envelope = _outputs.summary_table(_APPLY_COLUMNS, [])

        assert envelope["rows"] == []
        assert [column["name"] for column in envelope["columns"]] == ["RESOURCE", "OUTCOME"]

    def test_no_columns_and_no_rows_is_an_empty_table_envelope(self) -> None:
        empty = {"__wave_type": "table", "columns": [], "rows": []}

        assert _outputs.summary_table([], []) == empty

    def test_the_empty_call_is_what_an_empty_read_hands_back(self) -> None:
        assert _outputs.summary_table([], []) == table_from_k8s({})


class TestSummaryTableShapes:
    """The four shipped column shapes, so a later column change is caught here first."""

    def test_the_apply_and_delete_shape_is_resource_and_outcome(self) -> None:
        envelope = _outputs.summary_table(_APPLY_COLUMNS, _APPLY_ROWS)

        assert envelope["columns"] == [
            {"name": "RESOURCE", "type": "string"},
            {"name": "OUTCOME", "type": "string"},
        ]

    def test_the_rollout_shape_adds_a_message_column(self) -> None:
        envelope = _outputs.summary_table(_ROLLOUT_COLUMNS, _ROLLOUT_ROWS)

        assert envelope["columns"] == [
            {"name": "RESOURCE", "type": "string"},
            {"name": "OUTCOME", "type": "string"},
            {"name": "MESSAGE", "type": "string"},
        ]

    def test_the_scale_shape_ends_with_two_integer_counts(self) -> None:
        envelope = _outputs.summary_table(_SCALE_COLUMNS, _SCALE_ROWS)

        assert envelope["columns"] == [
            {"name": "RESOURCE", "type": "string"},
            {"name": "OUTCOME", "type": "string"},
            {"name": "PREVIOUS", "type": "integer"},
            {"name": "REPLICAS", "type": "integer"},
        ]

    def test_the_copy_shape_is_source_target_and_size(self) -> None:
        envelope = _outputs.summary_table(_COPY_COLUMNS, _COPY_ROWS)

        assert envelope["columns"] == [
            {"name": "SOURCE", "type": "string"},
            {"name": "TARGET", "type": "string"},
            {"name": "SIZE", "type": "integer"},
        ]

    @pytest.mark.parametrize("columns", _RESOURCE_SHAPES)
    def test_every_resource_shape_leads_with_resource_and_outcome(
        self, columns: list[tuple[str, str]]
    ) -> None:
        envelope = _outputs.summary_table(columns, [])

        assert [column["name"] for column in envelope["columns"]][:2] == ["RESOURCE", "OUTCOME"]


class TestSummaryTableRoundTrip:
    """The envelope rides the wire as JSON and rebuilds the table the write verbs returned."""

    @pytest.mark.parametrize(("columns", "rows"), _SUMMARY_SHAPES)
    def test_the_envelope_survives_a_json_round_trip(
        self, columns: list[tuple[str, str]], rows: list[list[Any]]
    ) -> None:
        envelope = _outputs.summary_table(columns, rows)

        assert json.loads(json.dumps(envelope)) == envelope

    @pytest.mark.parametrize(("columns", "rows"), _SUMMARY_SHAPES)
    def test_the_rebuilt_table_declares_the_columns_the_verb_named(
        self, columns: list[tuple[str, str]], rows: list[list[Any]]
    ) -> None:
        table = _rebuilt(_outputs.summary_table(columns, rows))

        assert table.col_names() == [name for name, _type in columns]
        assert table.col_types() == [col_type for _name, col_type in columns]

    @pytest.mark.parametrize(("columns", "rows"), _SUMMARY_SHAPES)
    def test_the_rebuilt_table_carries_the_cells_the_verb_gave_it(
        self, columns: list[tuple[str, str]], rows: list[list[Any]]
    ) -> None:
        table = _rebuilt(_outputs.summary_table(columns, rows))

        assert [list(entry.values()) for entry in table.to_list()] == rows


class TestTypeName:
    """kubectl's type/name form: the kind, its API group when it has one, then the object."""

    def test_a_grouped_workload_carries_its_group(self) -> None:
        deployments = resource("Deployment", "deployments", group_version="apps/v1")

        assert _outputs.type_name(deployments, "web") == "deployment.apps/web"

    def test_a_core_group_object_carries_no_group(self) -> None:
        configmaps = resource("ConfigMap", "configmaps")

        assert _outputs.type_name(configmaps, "probe-a") == "configmap/probe-a"

    def test_another_grouped_workload_reads_the_same_way(self) -> None:
        statefulsets = resource("StatefulSet", "statefulsets", group_version="apps/v1")

        assert _outputs.type_name(statefulsets, "db") == "statefulset.apps/db"

    def test_another_core_group_object_reads_the_same_way(self) -> None:
        pods = resource("Pod", "pods")

        assert _outputs.type_name(pods, "web-1") == "pod/web-1"

    def test_a_batch_workload_carries_the_batch_group(self) -> None:
        jobs = resource("Job", "jobs", group_version="batch/v1")

        assert _outputs.type_name(jobs, "nightly") == "job.batch/nightly"

    def test_a_dotted_group_is_carried_whole(self) -> None:
        crds = resource(
            "CustomResourceDefinition",
            "customresourcedefinitions",
            namespaced=False,
            group_version="apiextensions.k8s.io/v1",
        )

        assert _outputs.type_name(crds, "widgets.example.com") == (
            "customresourcedefinition.apiextensions.k8s.io/widgets.example.com"
        )

    def test_a_kind_with_no_group_version_carries_no_group(self) -> None:
        pods = resource("Pod", "pods", group_version="")

        assert _outputs.type_name(pods, "web-1") == "pod/web-1"

    def test_an_object_with_no_name_still_reads_as_a_type_and_a_slash(self) -> None:
        pods = resource("Pod", "pods")

        assert _outputs.type_name(pods, "") == "pod/"

    def test_the_kind_is_lower_cased_and_the_object_name_is_not(self) -> None:
        configmaps = resource("ConfigMap", "configmaps")

        assert _outputs.type_name(configmaps, "Probe-A") == "configmap/Probe-A"


class TestEmptyStreams:
    """The stream outputs a recorded exec failure leaves behind."""

    def test_the_streams_are_empty_and_the_exit_code_is_zero(self) -> None:
        assert _outputs.empty_streams() == _EMPTY_STREAMS

    def test_the_three_stream_outputs_are_the_only_ones(self) -> None:
        assert set(_outputs.empty_streams()) == {"stdout", "stderr", "exit_code"}

    def test_each_call_hands_back_a_fresh_dict(self) -> None:
        assert _outputs.empty_streams() is not _outputs.empty_streams()

    def test_a_caller_that_edits_the_result_never_reaches_the_next_caller(self) -> None:
        streams = _outputs.empty_streams()
        streams["stdout"] = "leaked"

        assert _outputs.empty_streams() == _EMPTY_STREAMS


_IDENT = uuid.UUID("12345678-1234-5678-1234-567812345678")
_CELL_COLUMNS = [
    "amount",
    "ratio",
    "qty",
    "active",
    "name",
    "at",
    "day",
    "clock",
    "blob",
    "doc",
    "tags",
    "nothing",
    "mixed",
    "ident",
]
_CELL_ROWS: list[list[Any]] = [
    [
        Decimal("12.50"),
        1.5,
        1,
        True,
        "a",
        datetime(2026, 9, 23, 10, 30),
        date(2026, 9, 23),
        clock_time(10, 30),
        b"\x01\xab",
        {"a": 1},
        [1, "x"],
        None,
        1,
        _IDENT,
    ],
    [
        Decimal("1E+2"),
        2,
        None,
        False,
        "b",
        None,
        None,
        None,
        bytearray(b"\xff"),
        {"when": date(2026, 1, 1)},
        [],
        None,
        "a",
        None,
    ],
]


class TestValueColumnType:
    """A column's type comes from the values it holds (SQL-9, OS-8)."""

    @pytest.mark.parametrize(
        ("cells", "expected"),
        [
            pytest.param([], "string", id="no-cells"),
            pytest.param([None, None], "string", id="only-none"),
            pytest.param([True, False, None], "boolean", id="booleans"),
            pytest.param([1, 2, None], "integer", id="integers"),
            pytest.param([1, 1.5], "float", id="an-int-and-a-float"),
            pytest.param([1.0], "float", id="a-whole-float"),
            pytest.param([Decimal("12.50")], "float", id="a-decimal"),
            pytest.param([Decimal("100"), 2], "float", id="a-whole-decimal-and-an-int"),
            pytest.param([1, "a"], "string", id="a-number-and-text"),
            pytest.param([True, 1], "string", id="a-bool-and-an-int"),
            pytest.param(["a"], "string", id="text"),
            pytest.param([date(2026, 9, 23)], "string", id="a-date"),
            pytest.param([b"\x01"], "string", id="bytes"),
            pytest.param([{"a": 1}], "string", id="a-document"),
        ],
    )
    def test_the_type_the_values_share(self, cells: list[Any], expected: str) -> None:
        assert _outputs.value_column_type(cells) == expected


class TestRenderedCell:
    """A cell as text: exact decimals, ISO times, hex bytes, JSON documents, else str()."""

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            pytest.param(Decimal("12.50"), "12.50", id="decimal-keeps-its-scale"),
            pytest.param(Decimal("1E+2"), "100", id="decimal-exponent-written-out"),
            pytest.param(Decimal("-0.001"), "-0.001", id="small-negative-decimal"),
            pytest.param(datetime(2026, 9, 23, 10, 30), "2026-09-23T10:30:00", id="datetime"),
            pytest.param(date(2026, 9, 23), "2026-09-23", id="date"),
            pytest.param(clock_time(10, 30), "10:30:00", id="time"),
            pytest.param(b"\x01\xab", "01ab", id="bytes"),
            pytest.param(bytearray(b"\xff"), "ff", id="bytearray"),
            pytest.param(memoryview(b"\x00\x10"), "0010", id="memoryview"),
            pytest.param({"a": 1}, '{"a": 1}', id="dict"),
            pytest.param({"when": date(2026, 1, 1)}, '{"when": "2026-01-01"}', id="dict-of-date"),
            pytest.param([1, "x"], '[1, "x"]', id="list"),
            pytest.param([], "[]", id="empty-list"),
            pytest.param(_IDENT, str(_IDENT), id="uuid"),
            pytest.param(1, "1", id="int"),
            pytest.param(1.5, "1.5", id="float"),
            pytest.param(True, "True", id="bool"),
            pytest.param("a", "a", id="text"),
        ],
    )
    def test_the_text_of_a_value(self, value: Any, text: str) -> None:
        assert _outputs.rendered_cell(value) == text


class TestTypedCell:
    """Each cell by its column's type: None stays None, string columns hold text."""

    @pytest.mark.parametrize("kind", ["string", "integer", "float", "boolean"])
    def test_none_stays_none(self, kind: str) -> None:
        assert _outputs.typed_cell(None, kind) is None

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            pytest.param(1, "1", id="int"),
            pytest.param("a", "a", id="text"),
            pytest.param(Decimal("12.50"), "12.50", id="decimal"),
            pytest.param(date(2026, 9, 23), "2026-09-23", id="date"),
            pytest.param({"a": 1}, '{"a": 1}', id="dict"),
        ],
    )
    def test_a_string_column_renders_the_value(self, value: Any, text: str) -> None:
        assert _outputs.typed_cell(value, "string") == text

    def test_a_decimal_in_a_float_column_rides_as_exact_text(self) -> None:
        assert _outputs.typed_cell(Decimal("12.50"), "float") == "12.50"

    @pytest.mark.parametrize(
        ("value", "kind"),
        [
            pytest.param(1.5, "float", id="float"),
            pytest.param(2, "float", id="int-in-a-float-column"),
            pytest.param(7, "integer", id="integer"),
            pytest.param(True, "boolean", id="boolean"),
        ],
    )
    def test_a_native_value_in_its_own_column_is_kept(self, value: Any, kind: str) -> None:
        assert _outputs.typed_cell(value, kind) is value


class TestTypedTable:
    """Rows to a Summary table envelope with each column typed by its values (SQL-9, OS-8)."""

    def test_types_and_cells_follow_the_values(self) -> None:
        envelope = _outputs.typed_table(_CELL_COLUMNS, _CELL_ROWS)

        assert envelope == {
            "__wave_type": "table",
            "columns": [
                {"name": "amount", "type": "float"},
                {"name": "ratio", "type": "float"},
                {"name": "qty", "type": "integer"},
                {"name": "active", "type": "boolean"},
                {"name": "name", "type": "string"},
                {"name": "at", "type": "string"},
                {"name": "day", "type": "string"},
                {"name": "clock", "type": "string"},
                {"name": "blob", "type": "string"},
                {"name": "doc", "type": "string"},
                {"name": "tags", "type": "string"},
                {"name": "nothing", "type": "string"},
                {"name": "mixed", "type": "string"},
                {"name": "ident", "type": "string"},
            ],
            "rows": [
                [
                    "12.50",
                    1.5,
                    1,
                    True,
                    "a",
                    "2026-09-23T10:30:00",
                    "2026-09-23",
                    "10:30:00",
                    "01ab",
                    '{"a": 1}',
                    '[1, "x"]',
                    None,
                    "1",
                    str(_IDENT),
                ],
                [
                    "100",
                    2,
                    None,
                    False,
                    "b",
                    None,
                    None,
                    None,
                    "ff",
                    '{"when": "2026-01-01"}',
                    "[]",
                    None,
                    "a",
                    None,
                ],
            ],
        }

    def test_no_rows_types_every_column_as_string(self) -> None:
        assert _outputs.typed_table(["a", "b"], []) == {
            "__wave_type": "table",
            "columns": [{"name": "a", "type": "string"}, {"name": "b", "type": "string"}],
            "rows": [],
        }

    def test_no_columns_and_no_rows_is_the_empty_envelope(self) -> None:
        assert _outputs.typed_table([], []) == _outputs.summary_table([], [])

    def test_the_envelope_survives_a_json_round_trip(self) -> None:
        envelope = _outputs.typed_table(_CELL_COLUMNS, _CELL_ROWS)

        assert json.loads(json.dumps(envelope)) == envelope

    def test_float_cells_rebuild_as_exact_decimals(self) -> None:
        envelope = _outputs.typed_table(["amount"], [[Decimal("12.50")], [Decimal("1E+2")]])

        table = _rebuilt(envelope)

        assert table.col_types() == ["float"]
        assert table.col("amount") == [Decimal("12.50"), Decimal("100")]
