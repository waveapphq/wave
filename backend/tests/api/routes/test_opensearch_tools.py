"""The opensearch-tools endpoints behind the OpenSearch Query editor.

REQ-5.1.2, REQ-3.3.2.5, REQ-3.3.2.6, OS-12, OS-13:

    POST   /opensearch-tools/check            -> {"issues": [{line, col, length, message}]}
    POST   /opensearch-tools/suggest          -> {"from", "to", "items": [{label, kind, ...}]}
    POST   /opensearch-tools/fields           -> 202 {"job_id", "cached": False} | 200 cached
    GET    /opensearch-tools/fields/{job_id}  -> {"status", ...}
    DELETE /opensearch-tools/fields/{job_id}  -> {"status", ...}

Get fields resolves the block's connection rows on the server, as a run would, before anything
connects; the check and the suggestions read its field list by job id.
"""

import inspect
import re
import socket
import threading
import time
from collections.abc import Callable, Generator
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from httpx import Response

from tests.api.services._pull_threads import pull_threads_ended
from wavecore.api.services import catalog_jobs
from wavecore.connectivity.opensearch import _fields, _rest
from wavecore.connectivity.opensearch._errors import OpenSearchFailure
from wavecore.connectivity.web_address import basic_authorization
from wavecore.core.execution.plugin_executor import resolve_parameters
from wavecore.core.expressions.errors import ExpressionEvaluationError

CHECK_PATH = "/opensearch-tools/check"
SUGGEST_PATH = "/opensearch-tools/suggest"
FIELDS_PATH = "/opensearch-tools/fields"
MB = 1024 * 1024
BOUND = 1.0
URL = "http://opensearch.internal:9200"
PATTERN = "filebeat-*"
CLIENT_ARGS = ("url", "tls_rows", "connect_timeout", "live")
UNKNOWN_LANGUAGE = "Unknown query language 'lucene': use dql, query_dsl or aggregation"
END_OF_FIELD = 'Expected "(", "{", value, whitespace but end of input found.'
UNREACHABLE = (
    "Could not connect to OpenSearch at opensearch.internal:9200: [Errno 111] Connection refused"
)
OPERATORS = [
    {"label": word, "kind": "operator", "detail": "", "info": ""} for word in ("and", "or")
]
INDEXES = [
    {"name": "filebeat-*", "kind": "folded", "count": 412},
    {"name": "logs", "kind": "alias", "count": 1},
]
FIELD_LIST = _fields.FieldList(
    indices=["filebeat-2026.09.25"],
    fields={
        "@timestamp": _fields.FieldInfo(types=["date"], aggregatable=True),
        "host.name": _fields.FieldInfo(types=["keyword", "text"], aggregatable=False),
        "log.level": _fields.FieldInfo(types=["keyword"], aggregatable=True),
    },
)
FIELDS = [
    {"name": "@timestamp", "types": ["date"], "aggregatable": True},
    {"name": "host.name", "types": ["keyword", "text"], "aggregatable": False},
    {"name": "log.level", "types": ["keyword"], "aggregatable": True},
]

# (row, label, declared type)
LABELED_ROWS = [
    ("url", "Cluster URL", "string"),
    ("username", "Username", "string"),
    ("password", "Password", "string"),
    ("api_key", "API Key", "string"),
    ("bearer_token", "Bearer Token", "string"),
    ("verify_ssl", "Verify Server Certificate", "boolean"),
    ("ca_cert", "CA Certificate", "string"),
    ("client_cert", "Client Certificate", "string"),
    ("client_key", "Client Key", "string"),
    ("index", "Index pattern", "string"),
    ("connect_timeout", "Connect timeout", "integer"),
]


def connection(**rows: Any) -> dict[str, Any]:
    """The eleven connection rows of a block on filebeat-* as wave, as they sit on the block."""
    base: dict[str, Any] = {
        "url": URL,
        "username": "wave",
        "password": "s3cret-pass",
        "api_key": "",
        "bearer_token": "",
        "verify_ssl": True,
        "ca_cert": "",
        "client_cert": "",
        "client_key": "",
        "index": PATTERN,
        "connect_timeout": None,
    }
    return {**base, **rows}


def fields_request(rows: dict[str, Any], **fields: Any) -> dict[str, Any]:
    """A Get fields request for `rows`; `fields` set the flags, bindings, Environment and test."""
    base: dict[str, Any] = {
        "connection": rows,
        "expression_fields": [],
        "template_fields": [],
        "profile_bindings": [],
        "environment_id": None,
        "test_id": None,
    }
    return {**base, **fields}


def resolver_text(row: str, value: str, declared_type: str) -> str:
    """What the parameter resolver itself says about one expression row."""
    with pytest.raises(ExpressionEvaluationError) as raised:
        resolve_parameters({row: value}, {row}, {}, {row: declared_type})
    return str(raised.value)


def assert_error(response: Response, *, status_code: int, code: str, message: str) -> None:
    """Assert the WAVE error envelope with an anchored, escaped message match."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    assert re.match(rf"^{re.escape(message)}$", body["error"]["message"]) is not None


def data_of(response: Response, status_code: int = 200) -> dict[str, Any]:
    """The data of a success envelope answered with `status_code`."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert set(body) == {"success", "data"}
    assert body["success"] is True
    data: dict[str, Any] = body["data"]
    return data


class FakeSocket:
    """A connected socket stand-in that records how it was shut down."""

    def __init__(self) -> None:
        self.shutdowns: list[int] = []

    def shutdown(self, how: int) -> None:
        self.shutdowns.append(how)

    def close(self) -> None:
        pass


class SteppedReads:
    """Fake index and field-list reads, each waiting on a test-owned gate, and a recorded client."""

    def __init__(self) -> None:
        self.indexes_entered = threading.Event()
        self.indexes_gate = threading.Event()
        self.fields_entered = threading.Event()
        self.fields_gate = threading.Event()
        self.field_calls: list[str] = []
        self.clients: list[dict[str, Any]] = []
        self.index_error: BaseException | None = None

    def client(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        settings = {**dict(zip(CLIENT_ARGS, args, strict=False)), **kwargs}
        self.clients.append(settings)
        return settings

    def read_indexes(self, client: Any, pattern: str) -> list[dict[str, Any]]:
        self.indexes_entered.set()
        self.indexes_gate.wait(BOUND)
        if self.index_error is not None:
            raise self.index_error
        return INDEXES

    def read_field_list(self, client: Any, pattern: str) -> Any:
        self.field_calls.append(pattern)
        self.fields_entered.set()
        self.fields_gate.wait(BOUND)
        return FIELD_LIST

    def open(self) -> None:
        self.indexes_gate.set()
        self.fields_gate.set()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def registry(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(catalog_jobs, "_JOBS", {})
    monkeypatch.setattr(catalog_jobs, "_BY_KEY", {})
    with pull_threads_ended():
        yield


@pytest.fixture
def reads(monkeypatch: pytest.MonkeyPatch) -> Generator[Callable[..., SteppedReads], None, None]:
    """Install stepped reads and the recorded client; `stepped=False` opens both gates at once."""
    from wavecore.api.services.opensearch_tools import fields

    made: list[SteppedReads] = []

    def install(*, stepped: bool = True) -> SteppedReads:
        stepped_reads = SteppedReads()
        if not stepped:
            stepped_reads.open()
        # The adapter may import the names or reach them through their modules.
        for module, raising in ((_fields, True), (fields, False)):
            monkeypatch.setattr(module, "read_indexes", stepped_reads.read_indexes, raising=raising)
            monkeypatch.setattr(
                module, "read_field_list", stepped_reads.read_field_list, raising=raising
            )
        for module, raising in ((_rest, True), (fields, False)):
            monkeypatch.setattr(module, "Client", stepped_reads.client, raising=raising)
        made.append(stepped_reads)
        return stepped_reads

    yield install
    for stepped_reads in made:
        stepped_reads.open()


def start(client: TestClient, request: dict[str, Any]) -> Response:
    return client.post(FIELDS_PATH, json=request)


def job_status(client: TestClient, job_id: str) -> dict[str, Any]:
    return data_of(client.get(f"{FIELDS_PATH}/{job_id}"))


def settled(client: TestClient, job_id: str) -> dict[str, Any]:
    """The job's status once it has left connecting and reading, polled within the bound."""
    deadline = time.monotonic() + BOUND
    answer = job_status(client, job_id)
    while answer["status"] in ("connecting", "reading") and time.monotonic() < deadline:
        answer = job_status(client, job_id)
    return answer


def pulled(client: TestClient, request: dict[str, Any]) -> str:
    """Start a new pull through the route and wait for it to settle; the job id."""
    job_id = str(data_of(start(client, request), 202)["job_id"])
    settled(client, job_id)
    return job_id


class TestRouter:
    """The router: prefix, tag, sync handlers, and its place in the app."""

    def test_the_router_carries_the_prefix_and_the_tag(self) -> None:
        from wavecore.api.routes.opensearch_tools import router

        assert router.prefix == "/opensearch-tools"
        assert router.tags == ["OpenSearch Tools"]

    def test_the_endpoints_are_registered_on_the_app(self) -> None:
        from wavecore.api.app import app

        paths = app.openapi()["paths"]

        assert set(paths[CHECK_PATH]) == {"post"}
        assert set(paths[SUGGEST_PATH]) == {"post"}
        assert set(paths[FIELDS_PATH]) == {"post"}
        assert set(paths[f"{FIELDS_PATH}/{{job_id}}"]) == {"get", "delete"}

    def test_the_router_is_included_right_after_the_sql_tools_router(self) -> None:
        from wavecore.api.app import app

        # Included routers stay wrapped in app.routes; the OpenAPI paths keep the routes' order.
        paths = list(app.openapi()["paths"])
        last_sql = max(i for i, path in enumerate(paths) if path.startswith("/sql-tools/"))
        first_opensearch = min(
            i for i, path in enumerate(paths) if path.startswith("/opensearch-tools/")
        )

        assert first_opensearch == last_sql + 1

    def test_the_handlers_run_in_the_threadpool(self) -> None:
        from wavecore.api.routes.opensearch_tools import router

        endpoints = [route.endpoint for route in router.routes if isinstance(route, APIRoute)]

        assert len(endpoints) == 5
        assert not any(inspect.iscoroutinefunction(endpoint) for endpoint in endpoints)


class TestCheckRoute:
    """POST /opensearch-tools/check: advisory findings, never a run."""

    def test_a_dql_syntax_finding_is_answered_in_the_envelope(self, client: TestClient) -> None:
        response = client.post(CHECK_PATH, json={"language": "dql", "text": "log.level:"})

        assert response.status_code == 200, response.text
        assert response.json() == {
            "success": True,
            "data": {"issues": [{"line": 1, "col": 11, "length": 1, "message": END_OF_FIELD}]},
        }

    @pytest.mark.parametrize(
        ("language", "text"),
        [
            ("dql", "log.level: ERROR"),
            ("query_dsl", '{"match_all": {}}'),
            ("aggregation", '{"avg": {"field": "latency_ms"}}'),
        ],
    )
    def test_a_clean_text_answers_no_issues(
        self, client: TestClient, language: str, text: str
    ) -> None:
        response = client.post(CHECK_PATH, json={"language": language, "text": text})

        assert data_of(response) == {"issues": []}

    @pytest.mark.parametrize(
        ("language", "text", "key", "message"),
        [
            ("query_dsl", '{"matchall": {}}', '"matchall"', '"matchall" is not a query type'),
            (
                "aggregation",
                '{"median": {"field": "x"}}',
                '"median"',
                '"median" is not an aggregation type',
            ),
        ],
    )
    def test_the_packaged_extract_names_the_known_types(
        self, client: TestClient, language: str, text: str, key: str, message: str
    ) -> None:
        response = client.post(CHECK_PATH, json={"language": language, "text": text})

        assert data_of(response) == {
            "issues": [{"line": 1, "col": 2, "length": len(key), "message": message}]
        }

    def test_a_pulled_field_list_finds_an_unknown_field(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        reads(stepped=False)
        job_id = pulled(client, fields_request(connection()))
        body = {
            "language": "dql",
            "text": "log.invalid: ERROR",
            "fields_job_id": job_id,
            "index": PATTERN,
        }

        response = client.post(CHECK_PATH, json=body)

        assert data_of(response) == {
            "issues": [
                {
                    "line": 1,
                    "col": 1,
                    "length": 11,
                    "message": "Unknown field log.invalid in filebeat-*",
                }
            ]
        }

    def test_an_unknown_job_id_skips_the_unknown_field_findings(self, client: TestClient) -> None:
        body = {"language": "dql", "text": "log.invalid: ERROR", "fields_job_id": "abc"}

        assert data_of(client.post(CHECK_PATH, json=body)) == {"issues": []}

    def test_the_template_flag_masks_the_markers(self, client: TestClient) -> None:
        body = {"language": "dql", "text": "log.level: {{ lvl }}", "template": True}

        assert data_of(client.post(CHECK_PATH, json=body)) == {"issues": []}

    def test_an_unknown_language_is_refused(self, client: TestClient) -> None:
        response = client.post(CHECK_PATH, json={"language": "lucene", "text": "ERROR"})

        assert_error(response, status_code=400, code="VALIDATION_ERROR", message=UNKNOWN_LANGUAGE)

    def test_a_text_one_byte_over_the_cap_is_refused(self, client: TestClient) -> None:
        response = client.post(CHECK_PATH, json={"language": "dql", "text": "x" * (MB + 1)})

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message="Query exceeds 1 MB",
        )

    @pytest.mark.parametrize(
        ("body", "message"),
        [
            ({"text": "ERROR"}, "Validation error for 'language': Field required"),
            ({"language": "dql"}, "Validation error for 'text': Field required"),
        ],
    )
    def test_a_body_that_fails_the_model_is_refused(
        self, client: TestClient, body: dict[str, Any], message: str
    ) -> None:
        response = client.post(CHECK_PATH, json=body)

        assert_error(response, status_code=400, code="VALIDATION_ERROR", message=message)


class TestSuggestRoute:
    """POST /opensearch-tools/suggest: the range a choice replaces and the choices."""

    def test_the_operators_are_answered_in_the_envelope(self, client: TestClient) -> None:
        text = "log.level: ERROR "

        response = client.post(
            SUGGEST_PATH, json={"language": "dql", "text": text, "cursor": len(text)}
        )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "success": True,
            "data": {"from": len(text), "to": len(text), "items": OPERATORS},
        }

    def test_a_pulled_field_list_supplies_the_fields(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        reads(stepped=False)
        job_id = pulled(client, fields_request(connection()))
        body = {"language": "dql", "text": "lo", "cursor": 2, "fields_job_id": job_id}

        assert data_of(client.post(SUGGEST_PATH, json=body)) == {
            "from": 0,
            "to": 2,
            "items": [{"label": "log.level", "kind": "field", "detail": "keyword", "info": ""}],
        }

    def test_the_packaged_extract_offers_query_types_and_no_search_keys(
        self, client: TestClient
    ) -> None:
        body = {"language": "query_dsl", "text": '{""}', "cursor": 2}

        data = data_of(client.post(SUGGEST_PATH, json=body))

        labels = {item["label"] for item in data["items"]}
        assert (data["from"], data["to"]) == (2, 2)
        assert {"bool", "match", "match_all", "range", "term"} <= labels
        assert not labels & {"query", "size", "aggs", "sort"}
        assert {item["kind"] for item in data["items"]} == {"key"}

    def test_an_unknown_language_is_refused(self, client: TestClient) -> None:
        response = client.post(SUGGEST_PATH, json={"language": "lucene", "text": "", "cursor": 0})

        assert_error(response, status_code=400, code="VALIDATION_ERROR", message=UNKNOWN_LANGUAGE)

    def test_a_cursor_outside_the_text_is_refused(self, client: TestClient) -> None:
        body = {"language": "dql", "text": "log.level: ERROR", "cursor": 42}

        assert_error(
            client.post(SUGGEST_PATH, json=body),
            status_code=400,
            code="VALIDATION_ERROR",
            message="Cursor 42 is outside the text",
        )

    def test_a_text_one_byte_over_the_cap_is_refused(self, client: TestClient) -> None:
        body = {"language": "dql", "text": "x" * (MB + 1), "cursor": 0}

        assert_error(
            client.post(SUGGEST_PATH, json=body),
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message="Query exceeds 1 MB",
        )

    @pytest.mark.parametrize(
        ("body", "message"),
        [
            ({"language": "dql", "text": "lo"}, "Validation error for 'cursor': Field required"),
            (
                {"language": "dql", "text": "lo", "cursor": "x"},
                "Validation error for 'cursor': Input should be a valid integer, unable to parse "
                "string as an integer",
            ),
        ],
    )
    def test_a_body_that_fails_the_model_is_refused(
        self, client: TestClient, body: dict[str, Any], message: str
    ) -> None:
        response = client.post(SUGGEST_PATH, json=body)

        assert_error(response, status_code=400, code="VALIDATION_ERROR", message=message)


class TestFieldsStart:
    """POST /opensearch-tools/fields: a new pull, a joined one, a cached one and a refresh."""

    def test_a_new_pull_answers_202_not_cached(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        reads()

        data = data_of(start(client, fields_request(connection())), 202)

        assert data == {"job_id": data["job_id"], "cached": False}

    def test_a_done_pull_answers_200_with_the_cached_lists(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        job_id = pulled(client, fields_request(connection()))

        data = data_of(start(client, fields_request(connection())), 200)

        assert data == {"job_id": job_id, "cached": True, "indexes": INDEXES, "fields": FIELDS}
        assert len(stepped.clients) == 1

    def test_a_running_pull_is_joined_under_the_same_job(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads()
        job_id = data_of(start(client, fields_request(connection())), 202)["job_id"]
        assert stepped.indexes_entered.wait(BOUND)

        joined = data_of(start(client, fields_request(connection())), 202)

        assert joined == {"job_id": job_id, "cached": False}

    def test_refresh_on_a_done_pull_starts_a_new_job(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        job_id = pulled(client, fields_request(connection()))

        data = data_of(start(client, fields_request(connection(), refresh=True)), 202)

        assert data["job_id"] != job_id
        assert settled(client, data["job_id"])["status"] == "done"
        assert len(stepped.clients) == 2

    def test_a_different_index_pattern_is_its_own_pull(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        job_id = pulled(client, fields_request(connection()))

        data = data_of(start(client, fields_request(connection(index="metrics-*"))), 202)

        assert data["job_id"] != job_id
        settled(client, data["job_id"])
        assert stepped.field_calls == [PATTERN, "metrics-*"]

    def test_a_blank_index_pattern_lists_indexes_only(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)

        job_id = pulled(client, fields_request(connection(index="")))

        assert job_status(client, job_id) == {"status": "done", "indexes": INDEXES, "fields": []}
        assert stepped.field_calls == []

    def test_rows_left_out_take_their_defaults(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)

        job_id = pulled(client, {"connection": {"url": URL, "index": PATTERN}})

        assert job_status(client, job_id)["status"] == "done"
        [settings] = stepped.clients
        assert settings["authorization"] is None
        assert settings["connect_timeout"] == 30
        assert settings["tls_rows"]["verify_ssl"] is True

    def test_the_connection_carries_only_the_rows_the_block_holds(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.opensearch_tools import fields

        received: list[dict[str, Any]] = []

        def recorded_start(connection_rows: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
            received.append(connection_rows)
            return {"job_id": "job-1", "cached": False}

        monkeypatch.setattr(fields, "start", recorded_start)
        held = {"url": URL, "index": PATTERN}

        data_of(start(client, fields_request(held)), 202)

        assert received == [held]


class TestFieldsRefusals:
    """The refusals answered before a pull starts."""

    @pytest.mark.parametrize("rows", [{}, {"url": "   ", "index": PATTERN}])
    def test_a_blank_cluster_url_is_refused(
        self, client: TestClient, reads: Callable[..., SteppedReads], rows: dict[str, Any]
    ) -> None:
        stepped = reads(stepped=False)

        response = start(client, {"connection": rows})

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message="Cluster URL is required",
        )
        assert catalog_jobs._JOBS == {}
        assert stepped.clients == []

    def test_an_environment_that_does_not_exist_is_refused(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        reads(stepped=False)

        response = start(client, fields_request(connection(), environment_id="e1"))

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message="Environment with ID 'e1' not found",
        )
        assert catalog_jobs._JOBS == {}

    @pytest.mark.parametrize(("row", "label", "declared"), LABELED_ROWS)
    def test_a_row_that_cannot_be_resolved_is_refused_by_its_label(
        self,
        client: TestClient,
        reads: Callable[..., SteppedReads],
        row: str,
        label: str,
        declared: str,
    ) -> None:
        reads(stepped=False)
        rows = connection(**{row: "later_value"})
        expected = f"Cannot resolve {label}: {resolver_text(row, 'later_value', declared)}"

        response = start(client, fields_request(rows, expression_fields=[row]))

        assert_error(response, status_code=422, code="UNPROCESSABLE_ENTITY", message=expected)
        assert catalog_jobs._JOBS == {}

    @pytest.mark.parametrize(
        ("row", "label"),
        [
            ("password", "Password"),
            ("api_key", "API Key"),
            ("bearer_token", "Bearer Token"),
            ("client_key", "Client Key"),
        ],
    )
    def test_a_credential_row_holding_null_is_refused_as_a_run_refuses_it(
        self, client: TestClient, reads: Callable[..., SteppedReads], row: str, label: str
    ) -> None:
        stepped = reads(stepped=False)

        response = start(client, fields_request(connection(**{row: None})))

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message=f"Cannot resolve {label}: '{row}' is null",
        )
        assert catalog_jobs._JOBS == {}
        assert stepped.clients == []

    def test_credential_rows_the_block_does_not_hold_are_nothing_given(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        rows = {"url": URL, "username": "wave", "password": "s3cret-pass", "index": PATTERN}

        job_id = pulled(client, fields_request(rows))

        assert job_status(client, job_id)["status"] == "done"
        [settings] = stepped.clients
        assert settings["authorization"] == basic_authorization("wave", "s3cret-pass")
        assert settings["tls_rows"]["client_key"] == ""

    def test_a_body_without_the_connection_is_refused(self, client: TestClient) -> None:
        response = start(client, {"refresh": False})

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Validation error for 'connection': Field required",
        )


class TestFieldsJobRoutes:
    """GET and DELETE /opensearch-tools/fields/{job_id}."""

    def test_get_reports_connecting_then_reading_then_done(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads()
        job_id = data_of(start(client, fields_request(connection())), 202)["job_id"]

        assert stepped.indexes_entered.wait(BOUND)
        assert job_status(client, job_id) == {"status": "connecting"}
        stepped.indexes_gate.set()
        assert stepped.fields_entered.wait(BOUND)
        assert job_status(client, job_id) == {"status": "reading"}
        stepped.fields_gate.set()

        assert settled(client, job_id) == {"status": "done", "indexes": INDEXES, "fields": FIELDS}

    def test_get_reports_a_failed_pull_with_the_runs_message(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = OpenSearchFailure(UNREACHABLE, "Unreachable")

        job_id = pulled(client, fields_request(connection()))

        assert job_status(client, job_id) == {"status": "failed", "error": UNREACHABLE}

    def test_delete_cancels_a_running_pull_and_shuts_its_socket_down(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads()
        job_id = data_of(start(client, fields_request(connection())), 202)["job_id"]
        stepped.indexes_gate.set()
        assert stepped.fields_entered.wait(BOUND)
        sock = FakeSocket()
        catalog_jobs._JOBS[job_id].live.attach(sock)

        assert data_of(client.delete(f"{FIELDS_PATH}/{job_id}")) == {"status": "canceled"}
        assert job_status(client, job_id) == {"status": "canceled"}
        assert sock.shutdowns == [socket.SHUT_RDWR]

    def test_delete_of_a_done_pull_answers_it_done(
        self, client: TestClient, reads: Callable[..., SteppedReads]
    ) -> None:
        reads(stepped=False)
        job_id = pulled(client, fields_request(connection()))

        assert data_of(client.delete(f"{FIELDS_PATH}/{job_id}")) == {
            "status": "done",
            "indexes": INDEXES,
            "fields": FIELDS,
        }

    @pytest.mark.parametrize("method", ["get", "delete"])
    def test_an_unknown_job_is_not_found(self, client: TestClient, method: str) -> None:
        response = getattr(client, method)(f"{FIELDS_PATH}/abc")

        assert_error(
            response, status_code=404, code="NOT_FOUND", message="Catalog job 'abc' not found"
        )
