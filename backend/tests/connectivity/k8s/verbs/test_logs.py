"""K8s Logs verb-core tests (REQ-3.3.2.1, REQ-3.4.1.5).

logs.run is the sync, stdlib-only half of the K8s Logs block: one GET on the pod
log subresource, the byte cut, and the text rendered as a string, one entry per
line, or a TIME/MESSAGE table envelope. It returns the wire envelope both the
local bridge and the remote worker materialize, so every value it emits is plain
JSON - a table is a dict, never a live Table object.
"""

import inspect
import json
import urllib.parse
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    GATEWAY_HTML,
    NAMESPACE,
    SERVER,
    Call,
    FakeK8sClient,
    block_params,
    exact,
)
from wavecore.connectivity.k8s.rest import K8sApiError
from wavecore.connectivity.k8s.verbs import logs

_POD = "web-1"
_CONTAINER = "app"
_LOG_PATH = f"/api/v1/namespaces/{NAMESPACE}/pods/{_POD}/log"
_LOG_TEXT = "2026-08-22T10:00:00Z boot sequence started\n2026-08-22T10:00:01Z ready\n"

_TABLE_COLUMNS = [{"name": "TIME", "type": "string"}, {"name": "MESSAGE", "type": "string"}]
_EMPTY_LOG_TABLE = {"__wave_type": "table", "columns": _TABLE_COLUMNS, "rows": []}

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_BAD_CONTAINER = 'container "nope" is not valid for pod "web-1"'
_NO_PREVIOUS = 'previous terminated container "app" in pod "web-1" not found'
_FORBIDDEN = (
    'pods "web-1" is forbidden: User "wave" cannot get resource "pods/log" '
    'in API group "" in the namespace "apps"'
)
_NOT_FOUND_MESSAGE = f"K8s Pod '{_POD}' not found in namespace '{NAMESPACE}'"


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
    return patch("wavecore.connectivity.k8s.verbs.logs.K8sClient", factory)


def _params(**overrides: Any) -> dict[str, Any]:
    return block_params(**{"pod": _POD, "container": _CONTAINER, **overrides})


def _serving(status: int, body: Any) -> FakeK8sClient:
    return FakeK8sClient(responses=[(status, body)])


def _log(body: bytes) -> FakeK8sClient:
    """One scripted log body; the verb makes no other request."""
    return _serving(200, body)


def _plain_log() -> FakeK8sClient:
    """A log read with Timestamps off, so no line carries a stamp prefix."""
    return _log(b"boot sequence started\nready to serve traffic\n")


def _status_body(message: str, reason: str, code: int) -> bytes:
    return json.dumps(
        {
            "kind": "Status",
            "apiVersion": "v1",
            "status": "Failure",
            "message": message,
            "reason": reason,
            "code": code,
        }
    ).encode()


def _run(
    params: dict[str, Any], fake: FakeK8sClient | None = None, log: Any = None
) -> tuple[dict[str, Any], FakeK8sClient]:
    client = fake if fake is not None else _log(_LOG_TEXT.encode())
    with _patch_client(client):
        envelope = logs.run(params, log if log is not None else _Recorder())
    return envelope, client


def _run_error(
    status: int, body: bytes, log: Any = None, **overrides: Any
) -> tuple[dict[str, Any], FakeK8sClient]:
    return _run(_params(**overrides), _serving(status, body), log)


def _path(call: Call) -> str:
    return urllib.parse.urlsplit(call.path).path


def _query(call: Call) -> dict[str, str]:
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(call.path).query))


def _table_params(**overrides: Any) -> dict[str, Any]:
    """A per-line read with Timestamps on, which is the table shape."""
    return _params(timestamps=True, output_format="array", **overrides)


class TestVerbShape:
    """run is a plain function returning one JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(logs.run) is False

    def test_the_envelope_carries_exactly_the_three_wire_keys(self) -> None:
        envelope, _ = _run(_params())

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_logs_never_registers_a_secret(self) -> None:
        envelope, _ = _run(_params())

        assert envelope["secrets"] == []

    def test_the_whole_envelope_survives_a_json_round_trip(self) -> None:
        envelope, _ = _run(_table_params())

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_successful_read_fills_the_output_core(self) -> None:
        envelope, _ = _run(_params())

        assert envelope["outputs"] == {
            "logs": _LOG_TEXT,
            "success": True,
            "error": "",
            "reason": "",
        }


class TestTransport:
    """The single GET on the pod log subresource and its query."""

    def test_the_log_subresource_is_read_once_and_raw(self) -> None:
        _, fake = _run(_params())

        assert len(fake.calls) == 1
        assert fake.last.method == "GET"
        assert _path(fake.last) == _LOG_PATH
        assert fake.last.body is None
        assert fake.last.raw is True
        assert fake.last.accept is None

    def test_no_discovery_is_needed(self) -> None:
        _, fake = _run(_params())

        assert fake.discoveries == []

    def test_unset_optionals_do_not_reach_the_wire(self) -> None:
        _, fake = _run(_params())

        assert _query(fake.last) == {"container": _CONTAINER}

    def test_false_booleans_do_not_reach_the_wire(self) -> None:
        _, fake = _run(_params(previous=False, timestamps=False))

        assert _query(fake.last) == {"container": _CONTAINER}

    def test_the_named_container_is_the_one_read(self) -> None:
        _, fake = _run(_params(container="sidecar"))

        assert _query(fake.last) == {"container": "sidecar"}

    def test_a_non_string_container_reaches_the_wire_as_text(self) -> None:
        _, fake = _run(_params(container=7))

        assert _query(fake.last) == {"container": "7"}

    def test_previous_reaches_the_wire_lowercased(self) -> None:
        _, fake = _run(_params(previous=True))

        assert _query(fake.last) == {"container": _CONTAINER, "previous": "true"}

    def test_tail_lines_reaches_the_wire_as_tail_lines(self) -> None:
        _, fake = _run(_params(tail_lines=25))

        assert _query(fake.last) == {"container": _CONTAINER, "tailLines": "25"}

    def test_since_seconds_reaches_the_wire_as_since_seconds(self) -> None:
        _, fake = _run(_params(since_seconds=600))

        assert _query(fake.last) == {"container": _CONTAINER, "sinceSeconds": "600"}

    def test_timestamps_reaches_the_wire_lowercased(self) -> None:
        _, fake = _run(_params(timestamps=True))

        assert _query(fake.last) == {"container": _CONTAINER, "timestamps": "true"}

    def test_max_bytes_reaches_the_wire_as_limit_bytes(self) -> None:
        _, fake = _run(_params(max_bytes=4096))

        assert _query(fake.last) == {"container": _CONTAINER, "limitBytes": "4096"}

    def test_every_option_rides_the_query_in_wire_order(self) -> None:
        _, fake = _run(
            _params(
                previous=True,
                tail_lines=25,
                since_seconds=600,
                timestamps=True,
                max_bytes=4096,
            )
        )

        assert urllib.parse.urlsplit(fake.last.path).query == (
            "container=app&previous=true&tailLines=25&sinceSeconds=600"
            "&timestamps=true&limitBytes=4096"
        )

    def test_since_time_is_never_sent(self) -> None:
        _, fake = _run(_params(since_seconds=600))

        assert "sinceTime" not in _query(fake.last)

    def test_the_output_format_never_reaches_the_cluster(self) -> None:
        _, fake = _run(_table_params())

        assert "output_format" not in _query(fake.last)
        assert "outputFormat" not in _query(fake.last)


class TestNamespaceResolution:
    """A pod log is always read by name, so All namespaces never applies."""

    def test_the_session_namespace_is_the_default(self) -> None:
        _, fake = _run(_params())

        assert _path(fake.last) == _LOG_PATH

    def test_a_typed_namespace_wins(self) -> None:
        _, fake = _run(_params(namespace="prod"))

        assert _path(fake.last) == f"/api/v1/namespaces/prod/pods/{_POD}/log"

    def test_a_blank_namespace_falls_back_to_the_session(self) -> None:
        _, fake = _run(_params(namespace="   "))

        assert _path(fake.last) == _LOG_PATH

    def test_a_stray_all_namespaces_changes_nothing(self) -> None:
        _, fake = _run(_params(all_namespaces=True))

        assert _path(fake.last) == _LOG_PATH

    def test_a_stray_all_namespaces_does_not_beat_a_typed_namespace(self) -> None:
        _, fake = _run(_params(all_namespaces=True, namespace="prod"))

        assert _path(fake.last) == f"/api/v1/namespaces/prod/pods/{_POD}/log"

    def test_the_pod_name_and_namespace_reach_the_wire_percent_encoded(self) -> None:
        _, fake = _run(_params(pod="web 1?", namespace="my ns?"))

        assert _path(fake.last) == "/api/v1/namespaces/my%20ns%3F/pods/web%201%3F/log"


class TestClientConstruction:
    """The REST core is built from the session context and the block's rows."""

    def test_the_context_comes_from_the_session(self) -> None:
        _, fake = _run(_params())
        context = fake.factory.call_args.args[0]

        assert context.server == SERVER
        assert context.namespace == NAMESPACE
        assert context.token == "sa-tok"

    def test_the_timeout_defaults_to_thirty(self) -> None:
        _, fake = _run(_params())

        assert fake.factory.call_args.args[1] == 30

    def test_a_typed_timeout_reaches_the_core(self) -> None:
        _, fake = _run(_params(timeout=45))

        assert fake.factory.call_args.args[1] == 45

    def test_the_impersonation_rows_reach_the_core(self) -> None:
        _, fake = _run(_params(impersonate_user="jane", impersonate_groups="dev, ops"))

        assert fake.factory.call_args.kwargs["impersonate_user"] == "jane"
        assert fake.factory.call_args.kwargs["impersonate_groups"] == ["dev", "ops"]

    def test_no_impersonation_by_default(self) -> None:
        _, fake = _run(_params())

        assert fake.factory.call_args.kwargs["impersonate_user"] is None
        assert fake.factory.call_args.kwargs["impersonate_groups"] is None


class TestBody:
    """The raw bytes, the client-side byte cut, and the decode."""

    def test_the_text_body_comes_back_as_a_string(self) -> None:
        envelope, _ = _run(_params())

        assert envelope["outputs"]["logs"] == _LOG_TEXT
        assert isinstance(envelope["outputs"]["logs"], str)

    def test_a_body_that_is_not_json_is_returned_verbatim(self) -> None:
        text = "boot sequence started\nnot json at all: {{{ [unterminated\n"

        envelope, _ = _run(_params(), _log(text.encode()))

        assert envelope["outputs"]["logs"] == text

    def test_an_empty_log_is_an_empty_string(self) -> None:
        envelope, _ = _run(_params(), _log(b""))

        assert envelope["outputs"]["logs"] == ""
        assert envelope["outputs"]["success"] is True

    def test_a_body_shorter_than_max_bytes_is_untouched(self) -> None:
        envelope, _ = _run(_params(max_bytes=10), _log(b"012345678"))

        assert envelope["outputs"]["logs"] == "012345678"

    def test_a_body_of_exactly_max_bytes_is_untouched(self) -> None:
        envelope, _ = _run(_params(max_bytes=10), _log(b"0123456789"))

        assert envelope["outputs"]["logs"] == "0123456789"

    def test_a_body_one_byte_over_max_bytes_is_cut(self) -> None:
        envelope, _ = _run(_params(max_bytes=10), _log(b"0123456789X"))

        assert envelope["outputs"]["logs"] == "0123456789"

    def test_a_long_body_is_cut_to_max_bytes(self) -> None:
        envelope, _ = _run(_params(max_bytes=64), _log(b"z" * 5000))

        assert envelope["outputs"]["logs"] == "z" * 64

    def test_bytes_that_are_not_utf8_become_the_replacement_character(self) -> None:
        envelope, _ = _run(_params(), _log(b"start \xff end"))

        assert envelope["outputs"]["logs"] == "start \ufffd end"


class TestOutputFormatString:
    """The default: whatever the cluster returned, unchanged."""

    def test_the_unset_format_returns_the_text_unchanged(self) -> None:
        envelope, _ = _run(_params())

        assert envelope["outputs"]["logs"] == _LOG_TEXT

    def test_an_explicit_string_returns_the_text_unchanged(self) -> None:
        envelope, _ = _run(_params(output_format="string"))

        assert envelope["outputs"]["logs"] == _LOG_TEXT

    def test_string_keeps_the_trailing_newline(self) -> None:
        envelope, _ = _run(_params(output_format="string"), _log(b"only line\n"))

        assert envelope["outputs"]["logs"] == "only line\n"

    def test_timestamps_alone_never_makes_a_table(self) -> None:
        envelope, _ = _run(_params(timestamps=True))

        assert envelope["outputs"]["logs"] == _LOG_TEXT


class TestOutputFormatArray:
    """Array is one entry per line, with Timestamps off so a line has no prefix."""

    def test_each_line_is_its_own_entry(self) -> None:
        envelope, _ = _run(_params(output_format="array"), _plain_log())

        assert envelope["outputs"]["logs"] == ["boot sequence started", "ready to serve traffic"]

    def test_the_trailing_newline_adds_no_empty_entry(self) -> None:
        envelope, _ = _run(_params(output_format="array"), _plain_log())

        assert len(envelope["outputs"]["logs"]) == 2

    def test_a_last_line_without_a_newline_survives(self) -> None:
        envelope, _ = _run(_params(output_format="array"), _log(b"one\ntwo"))

        assert envelope["outputs"]["logs"] == ["one", "two"]

    def test_a_blank_line_inside_the_log_is_an_empty_entry(self) -> None:
        envelope, _ = _run(_params(output_format="array"), _log(b"one\n\ntwo\n"))

        assert envelope["outputs"]["logs"] == ["one", "", "two"]

    def test_an_empty_log_is_an_empty_list(self) -> None:
        envelope, _ = _run(_params(output_format="array"), _log(b""))

        assert envelope["outputs"]["logs"] == []
        assert envelope["outputs"]["success"] is True

    def test_the_byte_cut_happens_before_the_split(self) -> None:
        envelope, _ = _run(_params(output_format="array", max_bytes=5), _log(b"one\ntwo\nthree\n"))

        assert envelope["outputs"]["logs"] == ["one", "t"]


class TestOutputFormatTable:
    """A per-line read with Timestamps on is a TIME/MESSAGE table envelope."""

    def test_the_whole_table_envelope_is_emitted(self) -> None:
        envelope, _ = _run(_table_params())

        assert envelope["outputs"]["logs"] == {
            "__wave_type": "table",
            "columns": _TABLE_COLUMNS,
            "rows": [
                ["2026-08-22T10:00:00Z", "boot sequence started"],
                ["2026-08-22T10:00:01Z", "ready"],
            ],
        }

    def test_the_table_envelope_is_json_serializable(self) -> None:
        envelope, _ = _run(_table_params())
        table = envelope["outputs"]["logs"]

        assert json.loads(json.dumps(table)) == table

    def test_a_message_keeps_every_space_after_the_first(self) -> None:
        body = b"2026-08-22T10:00:02Z GET /healthz 200  in 3ms\n"

        envelope, _ = _run(_table_params(), _log(body))

        assert envelope["outputs"]["logs"]["rows"] == [
            ["2026-08-22T10:00:02Z", "GET /healthz 200  in 3ms"]
        ]

    def test_a_line_with_no_space_at_all_is_all_time(self) -> None:
        envelope, _ = _run(_table_params(), _log(b"2026-08-22T10:00:03Z\n"))

        assert envelope["outputs"]["logs"]["rows"] == [["2026-08-22T10:00:03Z", ""]]

    def test_a_blank_line_is_two_empty_cells(self) -> None:
        envelope, _ = _run(_table_params(), _log(b"\n"))

        assert envelope["outputs"]["logs"]["rows"] == [["", ""]]

    def test_an_empty_log_keeps_the_columns_and_no_rows(self) -> None:
        envelope, _ = _run(_table_params(), _log(b""))

        assert envelope["outputs"]["logs"] == _EMPTY_LOG_TABLE
        assert envelope["outputs"]["success"] is True

    def test_the_cells_are_plain_strings(self) -> None:
        envelope, _ = _run(_table_params())

        for row in envelope["outputs"]["logs"]["rows"]:
            assert [type(cell) for cell in row] == [str, str]


class TestFailurePaths:
    """The verb's own 400 row and the shared cluster rows."""

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_an_unreadable_session_raises_before_any_request(self, on_error: str) -> None:
        fake = FakeK8sClient()

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run({"session": "not-a-kubeconfig", "pod": _POD, "on_error": on_error}, fake)

        assert fake.calls == []

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_missing_session_raises_in_both_modes(self, on_error: str) -> None:
        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _run({"pod": _POD, "on_error": on_error}, FakeK8sClient())

    def test_a_container_the_pod_does_not_have_surfaces_the_cluster_message(self) -> None:
        message = f"Kubernetes rejected the log request: {_BAD_CONTAINER}"

        with pytest.raises(ValueError, match=exact(message)):
            _run_error(400, _status_body(_BAD_CONTAINER, "BadRequest", 400), container="nope")

    def test_previous_without_a_restart_surfaces_the_cluster_message(self) -> None:
        message = f"Kubernetes rejected the log request: {_NO_PREVIOUS}"

        with pytest.raises(ValueError, match=exact(message)):
            _run_error(400, _status_body(_NO_PREVIOUS, "BadRequest", 400), previous=True)

    def test_a_400_without_a_cluster_message_takes_the_shared_row(self) -> None:
        message = f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}' (HTTP 400)"

        with pytest.raises(ValueError, match=exact(message)):
            _run_error(400, GATEWAY_HTML)

    def test_a_missing_pod_renders_the_shared_not_found_row(self) -> None:
        with pytest.raises(ValueError, match=exact(_NOT_FOUND_MESSAGE)):
            _run_error(404, _status_body('pods "web-1" not found', "NotFound", 404))

    def test_a_missing_pod_in_a_typed_namespace_names_that_namespace(self) -> None:
        message = f"K8s Pod '{_POD}' not found in namespace 'prod'"

        with pytest.raises(ValueError, match=exact(message)):
            _run_error(
                404, _status_body('pods "web-1" not found', "NotFound", 404), namespace="prod"
            )

    def test_unauthorized_renders_the_shared_authentication_row(self) -> None:
        message = "Kubernetes API authentication failed: Unauthorized"

        with pytest.raises(ValueError, match=exact(message)):
            _run_error(401, _status_body("Unauthorized", "Unauthorized", 401))

    def test_forbidden_renders_the_shared_permission_row(self) -> None:
        message = f"Kubernetes API permission denied: {_FORBIDDEN}"

        with pytest.raises(ValueError, match=exact(message)):
            _run_error(403, _status_body(_FORBIDDEN, "Forbidden", 403))

    def test_a_server_error_names_the_pod_once(self) -> None:
        detail = "the server is currently unable to handle the request"
        message = f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}': {detail}"

        with pytest.raises(ValueError, match=exact(message)):
            _run_error(503, _status_body(detail, "ServiceUnavailable", 503))

    def test_a_gateway_answer_at_401_ends_with_the_http_status(self) -> None:
        message = f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}' (HTTP 401)"

        with pytest.raises(ValueError, match=exact(message)):
            _run_error(401, GATEWAY_HTML)

    def test_a_pod_with_a_space_is_reported_by_its_typed_name(self) -> None:
        message = "K8s Pod 'web 1?' not found in namespace 'my ns?'"
        fake = _serving(404, _status_body('pods "web 1?" not found', "NotFound", 404))

        with pytest.raises(ValueError, match=exact(message)):
            _run(_params(pod="web 1?", namespace="my ns?"), fake)

        assert _path(fake.last) == "/api/v1/namespaces/my%20ns%3F/pods/web%201%3F/log"

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_transport_failure_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Could not connect to the Kubernetes API at {SERVER}: [Errno 111] refused"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(_params(on_error=on_error), fake)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_tls_failure_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Could not verify the TLS certificate of {SERVER}: unknown issuer"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(_params(on_error=on_error), fake)

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_timeout_raises_in_both_modes(self, on_error: str) -> None:
        message = f"Kubernetes API request GET {_LOG_PATH} timed out after 30 seconds"
        fake = FakeK8sClient(responses=[K8sApiError(message)])

        with pytest.raises(K8sApiError, match=exact(message)):
            _run(_params(on_error=on_error), fake)


class TestRecordAndContinue:
    """A recorded refusal keeps the block running and leaves logs empty in its type."""

    def test_a_recorded_bad_request_fills_the_failure_envelope(self) -> None:
        envelope, _ = _run_error(
            400,
            _status_body(_BAD_CONTAINER, "BadRequest", 400),
            container="nope",
            on_error="record",
        )

        assert envelope["outputs"] == {
            "logs": "",
            "success": False,
            "error": f"Kubernetes rejected the log request: {_BAD_CONTAINER}",
            "reason": "BadRequest",
            "__block_warning": True,
        }
        assert envelope["secrets"] == []

    def test_a_recorded_failure_is_json_serializable(self) -> None:
        envelope, _ = _run_error(
            404,
            _status_body('pods "web-1" not found', "NotFound", 404),
            on_error="record",
            output_format="array",
            timestamps=True,
        )

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_recorded_missing_pod_carries_the_shared_row(self) -> None:
        envelope, _ = _run_error(
            404, _status_body('pods "web-1" not found', "NotFound", 404), on_error="record"
        )

        assert envelope["outputs"]["error"] == _NOT_FOUND_MESSAGE
        assert envelope["outputs"]["reason"] == "NotFound"

    def test_string_records_an_empty_string(self) -> None:
        envelope, _ = _run_error(
            404,
            _status_body('pods "web-1" not found', "NotFound", 404),
            on_error="record",
            output_format="string",
        )

        assert envelope["outputs"]["logs"] == ""

    def test_array_records_an_empty_list(self) -> None:
        envelope, _ = _run_error(
            404,
            _status_body('pods "web-1" not found', "NotFound", 404),
            on_error="record",
            output_format="array",
        )

        assert envelope["outputs"]["logs"] == []

    def test_the_table_shape_records_an_empty_table_envelope(self) -> None:
        envelope, _ = _run_error(
            404,
            _status_body('pods "web-1" not found', "NotFound", 404),
            on_error="record",
            output_format="array",
            timestamps=True,
        )

        assert envelope["outputs"]["logs"] == _EMPTY_LOG_TABLE

    def test_a_gateway_answer_records_an_empty_reason(self) -> None:
        envelope, _ = _run_error(401, GATEWAY_HTML, on_error="record")

        assert envelope["outputs"]["error"] == (
            f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}' (HTTP 401)"
        )
        assert envelope["outputs"]["reason"] == ""


class TestLogCalls:
    """The verb logs through the callable it is handed, never a logger object."""

    def test_a_successful_read_logs_one_info_line(self) -> None:
        log = _Recorder()

        _run(_params(), None, log)

        assert log.entries == [
            (
                "INFO",
                f"Read {len(_LOG_TEXT)} characters of log from pod '{_POD}' in '{NAMESPACE}'",
            )
        ]

    def test_the_info_line_counts_the_characters_left_after_the_byte_cut(self) -> None:
        log = _Recorder()

        _run(_params(max_bytes=4), _log(b"z" * 5000), log)

        assert log.entries == [
            ("INFO", f"Read 4 characters of log from pod '{_POD}' in '{NAMESPACE}'")
        ]

    def test_the_info_line_names_the_resolved_namespace(self) -> None:
        log = _Recorder()

        _run(_params(namespace="prod"), None, log)

        assert log.entries[0][1].endswith(f"from pod '{_POD}' in 'prod'")

    def test_an_empty_log_still_logs_its_count(self) -> None:
        log = _Recorder()

        _run(_params(), _log(b""), log)

        assert log.entries == [
            ("INFO", f"Read 0 characters of log from pod '{_POD}' in '{NAMESPACE}'")
        ]

    def test_a_recorded_refusal_logs_one_warn_line(self) -> None:
        log = _Recorder()

        _run_error(
            400,
            _status_body(_BAD_CONTAINER, "BadRequest", 400),
            log,
            container="nope",
            on_error="record",
        )

        assert log.entries == [
            (
                "WARN",
                f"Read failed (BadRequest): Kubernetes rejected the log request: {_BAD_CONTAINER}",
            )
        ]

    def test_a_recorded_refusal_with_no_reason_leaves_the_detail_out(self) -> None:
        log = _Recorder()
        message = f"Kubernetes could not read Pod '{_POD}' in namespace '{NAMESPACE}' (HTTP 401)"

        _run_error(401, GATEWAY_HTML, log, on_error="record")

        assert log.entries == [("WARN", f"Read failed: {message}")]

    def test_fail_mode_logs_nothing(self) -> None:
        log = _Recorder()

        with pytest.raises(ValueError):
            _run_error(404, _status_body('pods "web-1" not found', "NotFound", 404), log)

        assert log.entries == []

    def test_a_happy_read_logs_no_warn_line(self) -> None:
        log = _Recorder()

        _run(_params(on_error="record"), None, log)

        assert log.levels == ["INFO"]
