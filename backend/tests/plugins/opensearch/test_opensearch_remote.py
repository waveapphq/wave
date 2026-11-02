"""The OpenSearch block on a remote host with nothing installed (REQ-5.1.2, OS-14).

The core rides the Remote Execution bundle and dispatches as `opensearch`; the worker dials the
Cluster URL as written, so a loopback URL there names the remote host itself: a remote run
never looks up a tunnel, and its failures follow On error as on WAVE.
"""

import socket
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.connectivity.opensearch.fakes import enqueue_json, field_caps_answer, hit, search_answer
from tests.core.remote_exec.test_bundle import _REGISTRY_PROBE, _run_bundle, _run_bundle_lines
from tests.plugins.http.conftest import RecordingHTTPServer
from tests.plugins.opensearch.conftest import (
    BLOCK_DEFAULTS,
    failed_line,
    host_of,
    os_params,
    outputs,
    recorded,
    served,
    timed,
)
from tests.plugins.python.test_python_remote import (
    HOST_SESSION,
    _bundle_worker,
    _console,
    _node,
    _passed,
    _session,
)
from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench.remote_exec import execute_remote_container
from wavecore.core.remote_exec.materialize import materialize
from wavecore.core.table import Table
from wavecore.plugins import opensearch as opensearch_plugin

REMOTE = "sshd"
FAR = "opensearch.internal:9200"
WINDOW = {"from": "2026-09-25T10:27:05.123Z", "to": "2026-09-25T10:42:05.123Z"}
FIELDS = [{"value": "@timestamp"}, {"value": "log.level"}, {"value": "message"}]
FIELD_CAPS_OK = field_caps_answer(
    {"@timestamp": "date", "log.level": "keyword", "message": "text"}, ["logs-1"]
)
HITS = [
    hit(
        "a1",
        {"@timestamp": "2026-09-25T10:40:01.120Z", "log": {"level": "ERROR"}, "message": "Failed"},
        sort=[1790332801120, "a1"],
    ),
    hit(
        "a2",
        {"@timestamp": "2026-09-25T10:39:58.004Z", "log.level": "INFO", "message": "Complete"},
        sort=[1790332798004, "a2"],
    ),
]
RUN_LINE = (
    "Search filebeat-* from 2026-09-25T10:27:05.123Z to 2026-09-25T10:42:05.123Z: "
    "2 results, 2 kept, N s"
)
# The lines a printed Results table would be; the run log never holds them.
TABLE_LINES = [
    "@timestamp | log.level | message",
    "2026-09-25T10:40:01.120Z | ERROR | Failed",
    "2026-09-25T10:39:58.004Z | INFO | Complete",
]
FIELD_CAPS_LINE = (
    "GET /filebeat-%2A/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true"
)
EMPTY_TABLE = {"__wave_type": "table", "columns": [], "rows": []}


@pytest.fixture(autouse=True)
def _registered_plugins() -> Iterator[None]:
    """Register the OpenSearch block the container looks up, and leave no session behind."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(opensearch_plugin.OpenSearchPlugin())
    yield
    clear_registry()
    wb_common._workbench_sessions.clear()
    log_streaming_service._session_logs.clear()
    log_streaming_service._session_registries.clear()


def answer_two_hits(server: RecordingHTTPServer) -> None:
    enqueue_json(server, FIELD_CAPS_OK)
    enqueue_json(server, search_answer(HITS, 2))


def request_line(params: dict[str, Any]) -> dict[str, Any]:
    return {"plugin_id": "opensearch", "params": {**BLOCK_DEFAULTS, **params}, "variables": {}}


def at(logs: list[dict[str, Any]], level: str) -> list[str]:
    return [str(entry["message"]) for entry in logs if entry["level"] == level]


def assert_the_two_hits(results: Any) -> None:
    assert isinstance(results, Table)
    assert results.col_names() == ["@timestamp", "log.level", "message"]
    assert results.col_types() == ["string", "string", "string"]
    assert results.to_list() == [
        {"@timestamp": "2026-09-25T10:40:01.120Z", "log.level": "ERROR", "message": "Failed"},
        {"@timestamp": "2026-09-25T10:39:58.004Z", "log.level": "INFO", "message": "Complete"},
    ]


def free_port() -> int:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = int(probe.getsockname()[1])
    probe.close()
    return port


def body(values: dict[str, Any], bindings: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "rex-1": _node("rex-1", "remote-execution", {"session_id": HOST_SESSION}),
        "body-1": _node("body-1", "opensearch", {**BLOCK_DEFAULTS, **values}, bindings=bindings),
    }


def tunneled_session(local_port: int) -> dict[str, Any]:
    """A run whose open SSH session holds a tunnel on `local_port` to the far cluster."""
    session = _session()
    session["ssh_session_registry"].add_tunnel(HOST_SESSION, "t1", MagicMock(), local_port, FAR)
    return session


async def run_body(
    node_map: dict[str, Any], session: dict[str, Any], worker: Any
) -> dict[str, Any]:
    """Run one OpenSearch block inside a Remote Execution body; hand back the run variables."""
    run_variables: dict[str, Any] = {}
    handle = MagicMock()
    handle.host = REMOTE
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=handle)),
        patch.object(_remote_exec, "run_on_worker", worker),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
        patch.object(_remote_exec, "push_wheels", AsyncMock()),
    ):
        await execute_remote_container(
            "rex-1",
            {"rex-1": [("body-1", "body")]},
            node_map,
            run_variables,
            session,
            session["session_id"],
            set(),
            [],
            None,
        )
    return run_variables


class TestTheBundleCarriesTheOpenSearchBlock:
    """The worker's registry holds the block under its canvas element type."""

    def test_the_worker_registry_lists_opensearch(self) -> None:
        [response] = _run_bundle_lines(
            [{"plugin_id": "registry-probe", "params": {}, "variables": {}}],
            source_patch=_REGISTRY_PROBE,
        )

        assert response["status"] == "passed", response["error"]
        assert "opensearch" in response["return_value"]


class TestASearchRoundTripsThroughTheBundle:
    """The built bundle under a bare interpreter runs the block against the scripted cluster."""

    def test_the_results_come_back_as_a_table_with_the_run_log(
        self, os_http: RecordingHTTPServer
    ) -> None:
        answer_two_hits(os_http)
        params = served(os_http, fields=FIELDS, **WINDOW)

        response = _run_bundle(request_line(params), isolated=True)

        assert response["status"] == "passed", response["error"]
        result = materialize(response["return_value"])
        assert_the_two_hits(result["results"])
        assert (result["total_results"], result["success"]) == (2, True)
        assert timed(at(response["logs"], "INFO")) == [RUN_LINE]
        assert [entry for entry in response["logs"] if entry["message"] in TABLE_LINES] == []
        search_line = f"POST /filebeat-%2A/_search {os_http.requests[1]['body'].decode()}"
        assert at(response["logs"], "DEBUG") == [FIELD_CAPS_LINE, search_line]

    def test_the_worker_dials_the_url_as_written(self, os_http: RecordingHTTPServer) -> None:
        enqueue_json(os_http, field_caps_answer({}, []))

        response = _run_bundle(request_line(served(os_http, **WINDOW)), isolated=True)

        assert response["status"] == "passed", response["error"]
        assert [request["headers"]["host"] for request in os_http.requests] == [host_of(os_http)]

    def test_a_failure_follows_on_error(self) -> None:
        port = free_port()
        params = os_params(url=f"http://127.0.0.1:{port}", **WINDOW)
        message = (
            f"Could not connect to OpenSearch at 127.0.0.1:{port}: [Errno 111] Connection refused"
        )

        failed, kept = _run_bundle_lines(
            [request_line(params), request_line({**params, "on_error": "record"})],
            isolated=True,
        )

        assert failed["status"] == "failed"
        assert failed["error"] == message
        assert kept["status"] == "passed", kept["error"]
        assert outputs(kept["return_value"]) == recorded(message, "Unreachable")
        assert at(kept["logs"], "WARN") == [failed_line("search", message, "Unreachable")]


class TestTheBlockInsideARemoteExecutionBody:
    """The body runs the block on the worker; WAVE's tunnels are never looked up for it."""

    async def test_the_worker_reaches_the_cluster_itself_despite_a_tunnel_on_that_port(
        self, os_http: RecordingHTTPServer
    ) -> None:
        answer_two_hits(os_http)
        session = tunneled_session(int(os_http.server_address[1]))
        values = served(os_http, fields=FIELDS, **WINDOW)

        variables = await run_body(
            body(values, bindings={"results": "logs", "total_results": "count"}),
            session,
            _bundle_worker,
        )

        assert_the_two_hits(variables["logs"])
        assert variables["count"] == 2
        assert [request["headers"]["host"] for request in os_http.requests] == [
            host_of(os_http),
            host_of(os_http),
        ]
        assert RUN_LINE in timed(_console())

    async def test_the_request_carries_no_tunnel_settings_and_prepare_never_runs(self) -> None:
        values = os_params(url="https://127.0.0.1:19200", **WINDOW)
        worker = AsyncMock(
            return_value=_passed(
                {
                    "results": EMPTY_TABLE,
                    "total_results": 0,
                    "success": True,
                    "error": "",
                    "reason": "",
                }
            )
        )
        prepare = MagicMock(side_effect=AssertionError("prepare looked up a tunnel"))

        with patch.object(opensearch_plugin, "prepare", prepare):
            await run_body(body(values), tunneled_session(19200), worker)

        sent = worker.await_args.args[2]
        assert sent["url"] == "https://127.0.0.1:19200"
        assert "server_name" not in sent
        assert "host_header" not in sent
        prepare.assert_not_called()
