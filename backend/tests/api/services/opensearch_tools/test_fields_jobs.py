"""The Get fields adapter on the shared catalog jobs (REQ-5.1.2, REQ-3.3.2.6, OS-13).

A pull resolves the eleven connection rows as a run would, reads `_resolve/index` and, when an
Index pattern is set, `_field_caps` from the WAVE server; it is cached per resolved rows (Index
pattern included), joined while it runs, and canceled by shutting its live socket down. It
follows the Proxy setting like the block and, with no run open, logs no proxy line (REQ-4.7.14).
"""

import base64
import importlib
import json
import logging
import re
import socket
import threading
import time
from collections.abc import Callable, Generator
from typing import Any

import pytest

from tests.api.services._pull_threads import pull_threads_ended
from tests.connectivity._proxy_servers import Proxy
from tests.connectivity.opensearch.fakes import (
    enqueue_json,
    error_answer,
    field_caps_answer,
    port_of,
    resolve_index_answer,
    serve,
    stop,
)
from tests.plugins.http.conftest import RecordingHTTPServer
from wavecore.api.exceptions import NotFoundException, UnprocessableEntityException
from wavecore.api.services import catalog_jobs
from wavecore.api.services.opensearch_tools import fields
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.tests import service as test_service
from wavecore.connectivity.opensearch import _fields, _rest
from wavecore.connectivity.opensearch._errors import OpenSearchFailure, failure_for
from wavecore.connectivity.opensearch._url import parse_cluster_url
from wavecore.connectivity.run_log import RunLog
from wavecore.core.execution.plugin_executor import resolve_parameters
from wavecore.core.expressions.errors import ExpressionEvaluationError
from wavecore.core.secrets.sealing import seal_value
from wavecore.plugins._held_run import Live

BOUND = 1.0
URL = "http://opensearch.internal:9200"
PATTERN = "filebeat-*"
PASSWORD = "s3cret-pass"
CLIENT_KEY = "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBg\n-----END PRIVATE KEY-----\n"
CLIENT_ARGS = ("url", "tls_rows", "connect_timeout", "live")
TRUST_ROWS = ("verify_ssl", "ca_cert", "client_cert", "client_key")
UNREACHABLE = (
    "Could not connect to OpenSearch at opensearch.internal:9200: [Errno 111] Connection refused"
)
FORBIDDEN = (
    "security_exception: no permissions for [indices:admin/mappings/fields/get] and User "
    "[name=wave-limited, backend_roles=[], requestedTenant=null]"
)
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

# One changed value per connection row: each makes a different cache key.
CHANGED_ROWS = [
    ("url", "http://opensearch-b.internal:9200"),
    ("username", "reader"),
    ("password", "another-pass"),
    ("api_key", "os_key_2"),
    ("bearer_token", "eyJhbGciOiJSUzI1NiJ9.e30.sig"),
    ("verify_ssl", False),
    ("ca_cert", "/certs/lab-ca.pem"),
    ("client_cert", "/certs/client.pem"),
    ("client_key", CLIENT_KEY),
    ("index", "metrics-*"),
    ("connect_timeout", 5),
]


def exact(text: str) -> str:
    return rf"^{re.escape(text)}$"


def connection(**rows: Any) -> dict[str, Any]:
    """The eleven connection rows of a block on filebeat-* as wave, which `rows` reshape."""
    base: dict[str, Any] = {
        "url": URL,
        "username": "wave",
        "password": PASSWORD,
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


def basic(username: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()


def start(rows: dict[str, Any], **options: Any) -> dict[str, Any]:
    """Start a pull; `options` set refresh, the test, the flags, bindings and Environment."""
    refresh = options.pop("refresh", False)
    test_id = options.pop("test_id", None)
    resolution: dict[str, Any] = {
        "expression_fields": [],
        "template_fields": [],
        "profile_bindings": [],
        "environment_id": None,
        "element_types": {},
    }
    return fields.start(rows, refresh, test_id, **{**resolution, **options})


def settled(job_id: str) -> dict[str, Any]:
    """The job's status once it has left connecting and reading, polled within the bound."""
    deadline = time.monotonic() + BOUND
    answer = fields.status(job_id)
    while answer["status"] in ("connecting", "reading") and time.monotonic() < deadline:
        answer = fields.status(job_id)
    return answer


def pulled(rows: dict[str, Any], **options: Any) -> str:
    """Start a pull and wait for it to settle; the job id."""
    job_id = str(start(rows, **options)["job_id"])
    settled(job_id)
    return job_id


def resolver_text(row: str, value: str, declared_type: str) -> str:
    """What the parameter resolver itself says about one expression row."""
    with pytest.raises(ExpressionEvaluationError) as raised:
        resolve_parameters({row: value}, {row}, {}, {row: declared_type})
    return str(raised.value)


def saved_test(variables: dict[str, Any], name: str = "Fields Carrier") -> str:
    return str(test_service.create_test({"name": name, "variables": variables})["id"])


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
        self.index_calls: list[tuple[Any, str]] = []
        self.field_calls: list[tuple[Any, str]] = []
        self.clients: list[dict[str, Any]] = []
        self.index_error: BaseException | None = None
        self.field_error: BaseException | None = None
        self.pull_thread: threading.Thread | None = None

    def client(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        settings = {**dict(zip(CLIENT_ARGS, args, strict=False)), **kwargs}
        self.clients.append(settings)
        return settings

    def read_indexes(self, client: Any, pattern: str) -> list[dict[str, Any]]:
        self.pull_thread = threading.current_thread()
        self.index_calls.append((client, pattern))
        self.indexes_entered.set()
        self.indexes_gate.wait(BOUND)
        if self.index_error is not None:
            raise self.index_error
        return INDEXES

    def read_field_list(self, client: Any, pattern: str) -> Any:
        self.field_calls.append((client, pattern))
        self.fields_entered.set()
        self.fields_gate.wait(BOUND)
        if self.field_error is not None:
            raise self.field_error
        return FIELD_LIST

    def open(self) -> None:
        self.indexes_gate.set()
        self.fields_gate.set()

    def finished(self) -> None:
        """Wait until the pull thread has settled its job."""
        assert self.pull_thread is not None
        self.pull_thread.join(BOUND)
        assert not self.pull_thread.is_alive()


@pytest.fixture(autouse=True)
def registry(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(catalog_jobs, "_JOBS", {})
    monkeypatch.setattr(catalog_jobs, "_BY_KEY", {})
    with pull_threads_ended():
        yield


@pytest.fixture
def reads(monkeypatch: pytest.MonkeyPatch) -> Generator[Callable[..., SteppedReads], None, None]:
    """Install stepped reads and the recorded client; `stepped=False` opens both gates at once."""
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


class TestJobStates:
    """A pull is connecting while it lists indexes, reading while it reads the field list."""

    def test_a_new_pull_answers_its_job_and_is_not_cached(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        reads()

        started = start(connection())

        assert started == {"job_id": started["job_id"], "cached": False}
        assert isinstance(started["job_id"], str) and started["job_id"]

    def test_the_pull_steps_through_connecting_and_reading_to_done(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads()
        job_id = start(connection())["job_id"]

        assert stepped.indexes_entered.wait(BOUND)
        assert fields.status(job_id) == {"status": "connecting"}
        stepped.indexes_gate.set()
        assert stepped.fields_entered.wait(BOUND)
        assert fields.status(job_id) == {"status": "reading"}
        stepped.fields_gate.set()

        assert settled(job_id) == {"status": "done", "indexes": INDEXES, "fields": FIELDS}

    def test_both_reads_use_the_index_pattern_and_one_client(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)

        pulled(connection())

        [(index_client, index_pattern)] = stepped.index_calls
        [(field_client, field_pattern)] = stepped.field_calls
        assert (index_pattern, field_pattern) == (PATTERN, PATTERN)
        assert index_client is field_client
        assert stepped.clients == [index_client]

    @pytest.mark.parametrize("index", ["", "   "])
    def test_a_blank_index_pattern_lists_indexes_only(
        self, reads: Callable[..., SteppedReads], index: str
    ) -> None:
        stepped = reads(stepped=False)

        job_id = pulled(connection(index=index))

        assert fields.status(job_id) == {"status": "done", "indexes": INDEXES, "fields": []}
        assert len(stepped.index_calls) == 1
        assert stepped.field_calls == []


class TestClientSettings:
    """The pull builds its own client from the resolved rows, with no tunnel and no deadline."""

    def test_the_client_takes_the_parsed_url_and_the_jobs_own_live(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)

        job_id = pulled(connection())

        [settings] = stepped.clients
        assert settings["url"] == parse_cluster_url(URL)
        assert isinstance(settings["live"], Live)
        assert catalog_jobs._JOBS[job_id].live is settings["live"]

    @pytest.mark.parametrize(("value", "seconds"), [(None, 30), ("", 30), (5, 5)])
    def test_a_blank_connect_timeout_takes_30_seconds(
        self, reads: Callable[..., SteppedReads], value: Any, seconds: int
    ) -> None:
        stepped = reads(stepped=False)

        pulled(connection(connect_timeout=value))

        assert stepped.clients[0]["connect_timeout"] == seconds

    def test_the_trust_rows_reach_the_client(self, reads: Callable[..., SteppedReads]) -> None:
        stepped = reads(stepped=False)
        trust = {
            "verify_ssl": False,
            "ca_cert": "/certs/lab-ca.pem",
            "client_cert": "/certs/client.pem",
            "client_key": CLIENT_KEY,
        }

        pulled(connection(url="https://opensearch.internal:9200", **trust))

        tls_rows = stepped.clients[0]["tls_rows"]
        assert {row: tls_rows[row] for row in TRUST_ROWS} == trust

    @pytest.mark.parametrize(
        ("rows", "authorization"),
        [
            ({}, basic("wave", PASSWORD)),
            ({"password": ""}, basic("wave", "")),
            ({"username": "", "password": "", "api_key": "os_key_1"}, "ApiKey os_key_1"),
            ({"username": "", "password": "", "bearer_token": "eyJ.e30.sig"}, "Bearer eyJ.e30.sig"),
            ({"username": "", "password": ""}, None),
        ],
    )
    def test_the_authentication_rows_make_the_authorization_header(
        self, reads: Callable[..., SteppedReads], rows: dict[str, Any], authorization: str | None
    ) -> None:
        stepped = reads(stepped=False)

        pulled(connection(**rows))

        assert stepped.clients[0]["authorization"] == authorization

    def test_no_tunnel_is_looked_up(self, reads: Callable[..., SteppedReads]) -> None:
        stepped = reads(stepped=False)

        pulled(connection(url="http://127.0.0.1:19200"))

        settings = stepped.clients[0]
        assert settings.get("server_name") is None
        assert settings.get("host_header") is None


class TestJobFailure:
    """A failed pull carries the message a run would give; nothing is read after a refusal."""

    def test_an_unreachable_cluster_fails_with_the_runs_message(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = OpenSearchFailure(UNREACHABLE, "Unreachable")

        job_id = pulled(connection())

        assert fields.status(job_id) == {"status": "failed", "error": UNREACHABLE}
        assert stepped.field_calls == []

    def test_a_refused_field_list_read_fails_with_the_runs_message(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.field_error = OpenSearchFailure(FORBIDDEN, "AuthFailed")

        job_id = pulled(connection())

        assert fields.status(job_id) == {"status": "failed", "error": FORBIDDEN}

    @pytest.mark.parametrize(
        ("url", "message"),
        [
            ("ftp://opensearch.internal:9200", "Cluster URL must start with http:// or https://"),
            ("http://", "Cluster URL needs a host, such as https://opensearch.internal:9200"),
            (
                "http://wave:pw@opensearch.internal:9200",
                "Cluster URL must not hold a username or password: put them in Username and "
                "Password",
            ),
            (
                "http://opensearch.internal:9200/?pretty",
                "Cluster URL must not hold a query (?...) or fragment (#...)",
            ),
            ("http://opensearch.internal:70000", "Cluster URL port must be between 1 and 65535"),
        ],
    )
    def test_a_cluster_url_that_cannot_work_fails_the_pull_before_any_read(
        self, reads: Callable[..., SteppedReads], url: str, message: str
    ) -> None:
        stepped = reads(stepped=False)

        job_id = pulled(connection(url=url))

        assert fields.status(job_id) == {"status": "failed", "error": message}
        assert stepped.index_calls == []

    @pytest.mark.parametrize(
        ("rows", "message"),
        [
            (
                {"api_key": "os_key_1"},
                "Set only one of Username and Password, API Key or Bearer Token: all three go in "
                "the one Authorization header",
            ),
            ({"username": ""}, "Password needs a Username"),
        ],
    )
    def test_authentication_rows_that_cannot_work_fail_the_pull_before_any_read(
        self, reads: Callable[..., SteppedReads], rows: dict[str, Any], message: str
    ) -> None:
        stepped = reads(stepped=False)

        job_id = pulled(connection(**rows))

        assert fields.status(job_id) == {"status": "failed", "error": message}
        assert stepped.index_calls == []

    def test_a_start_after_a_failure_begins_a_new_pull(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = OpenSearchFailure(UNREACHABLE, "Unreachable")
        failed = pulled(connection())

        again = start(connection())

        assert again == {"job_id": again["job_id"], "cached": False}
        assert again["job_id"] != failed
        settled(again["job_id"])
        assert len(stepped.index_calls) == 2


class TestCancel:
    """Cancel ends a running pull; while reading it shuts the live socket down."""

    def test_cancel_while_reading_shuts_the_live_socket_down(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads()
        job_id = start(connection())["job_id"]
        stepped.indexes_gate.set()
        assert stepped.fields_entered.wait(BOUND)
        sock = FakeSocket()
        catalog_jobs._JOBS[job_id].live.attach(sock)

        assert fields.cancel(job_id) == {"status": "canceled"}

        assert sock.shutdowns == [socket.SHUT_RDWR]
        stepped.fields_gate.set()
        stepped.finished()
        assert fields.status(job_id) == {"status": "canceled"}

    def test_cancel_while_connecting_drops_the_late_answer_and_reads_no_field_list(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads()
        job_id = start(connection())["job_id"]
        assert stepped.indexes_entered.wait(BOUND)

        assert fields.cancel(job_id) == {"status": "canceled"}
        stepped.open()
        stepped.finished()

        assert fields.status(job_id) == {"status": "canceled"}
        assert stepped.field_calls == []

    def test_a_second_cancel_answers_canceled_again(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads()
        job_id = start(connection())["job_id"]
        assert stepped.indexes_entered.wait(BOUND)
        fields.cancel(job_id)

        assert fields.cancel(job_id) == {"status": "canceled"}

    def test_cancel_of_a_done_job_keeps_it_done(self, reads: Callable[..., SteppedReads]) -> None:
        reads(stepped=False)
        job_id = pulled(connection())

        assert fields.cancel(job_id) == {"status": "done", "indexes": INDEXES, "fields": FIELDS}
        assert fields.status(job_id)["status"] == "done"

    def test_cancel_of_a_failed_job_keeps_it_failed(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = OpenSearchFailure(UNREACHABLE, "Unreachable")
        job_id = pulled(connection())

        assert fields.cancel(job_id) == {"status": "failed", "error": UNREACHABLE}

    @pytest.mark.parametrize("answer", [fields.status, fields.cancel])
    def test_an_unknown_job_is_not_found(self, answer: Callable[[str], Any]) -> None:
        with pytest.raises(NotFoundException, match=exact("Catalog job 'abc' not found")):
            answer("abc")


class TestJoinAndCache:
    """One pull per resolved rows, Index pattern included: joined while it runs, then cached."""

    @pytest.mark.parametrize("refresh", [False, True])
    def test_a_running_pull_is_joined(
        self, reads: Callable[..., SteppedReads], refresh: bool
    ) -> None:
        stepped = reads()
        first = start(connection())["job_id"]
        assert stepped.indexes_entered.wait(BOUND)

        joined = start(connection(), refresh=refresh)

        assert joined == {"job_id": first, "cached": False}
        stepped.open()
        assert settled(first)["status"] == "done"
        assert len(stepped.index_calls) == 1

    def test_a_done_pull_answers_from_the_cache(self, reads: Callable[..., SteppedReads]) -> None:
        stepped = reads(stepped=False)
        first = pulled(connection())

        assert start(connection()) == {
            "job_id": first,
            "cached": True,
            "indexes": INDEXES,
            "fields": FIELDS,
        }
        assert len(stepped.index_calls) == 1

    def test_refresh_on_a_done_pull_starts_a_new_one(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        first = pulled(connection())

        refreshed = start(connection(), refresh=True)

        assert refreshed == {"job_id": refreshed["job_id"], "cached": False}
        assert refreshed["job_id"] != first
        assert settled(refreshed["job_id"])["status"] == "done"
        assert len(stepped.index_calls) == 2

    @pytest.mark.parametrize(("row", "value"), CHANGED_ROWS)
    def test_each_connection_row_is_part_of_the_cache_key(
        self, reads: Callable[..., SteppedReads], row: str, value: Any
    ) -> None:
        reads(stepped=False)
        first = pulled(connection())

        other = start(connection(**{row: value}))

        assert other == {"job_id": other["job_id"], "cached": False}
        assert other["job_id"] != first
        settled(other["job_id"])

    def test_the_same_rows_in_two_tests_share_one_pull(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        first = pulled(connection(), test_id=saved_test({}, "First Carrier"))

        again = start(connection(), test_id=saved_test({}, "Second Carrier"))

        assert again == {"job_id": first, "cached": True, "indexes": INDEXES, "fields": FIELDS}
        assert len(stepped.index_calls) == 1

    def test_a_padded_url_and_index_pattern_share_the_pull(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        first = pulled(connection(url=f"  {URL}  ", index=f" {PATTERN} "))

        again = start(connection())

        assert again == {"job_id": first, "cached": True, "indexes": INDEXES, "fields": FIELDS}
        assert stepped.index_calls[0][1] == PATTERN


class TestResolution:
    """The rows resolve on the server before anything connects, refused by their labels."""

    @pytest.mark.parametrize("url", ["", "   "])
    def test_a_blank_cluster_url_is_refused(
        self, reads: Callable[..., SteppedReads], url: str
    ) -> None:
        stepped = reads(stepped=False)

        with pytest.raises(UnprocessableEntityException, match=exact("Cluster URL is required")):
            start(connection(url=url))

        assert catalog_jobs._JOBS == {}
        assert stepped.clients == []

    def test_sealed_secrets_are_unsealed_before_the_pull(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        rows = connection(
            url="https://opensearch.internal:9200",
            password=seal_value(PASSWORD),
            client_key=seal_value(CLIENT_KEY),
        )

        pulled(rows)

        assert stepped.clients[0]["authorization"] == basic("wave", PASSWORD)
        assert stepped.clients[0]["tls_rows"]["client_key"] == CLIENT_KEY

    @pytest.mark.parametrize(
        ("row", "header"),
        [("api_key", "ApiKey os_sealed_key"), ("bearer_token", "Bearer os_sealed_key")],
    )
    def test_a_sealed_token_is_unsealed_before_the_pull(
        self, reads: Callable[..., SteppedReads], row: str, header: str
    ) -> None:
        stepped = reads(stepped=False)

        pulled(connection(username="", password="", **{row: seal_value("os_sealed_key")}))

        assert stepped.clients[0]["authorization"] == header

    def test_expression_rows_resolve_against_the_tests_variables(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        test_id = saved_test(
            {
                "os_url": {"type": "string", "value": "http://vars-host:9201"},
                "os_user": {"type": "string", "value": "vars-user"},
                "os_index": {"type": "string", "value": "'app' + '-*'", "isExpression": True},
            }
        )
        request = connection(url="os_url", username="os_user", password="", index="os_index")

        pulled(request, expression_fields=["url", "username", "index"], test_id=test_id)

        settings = stepped.clients[0]
        assert settings["url"] == parse_cluster_url("http://vars-host:9201")
        assert settings["authorization"] == basic("vars-user", "")
        assert stepped.index_calls[0][1] == "app-*"

    def test_template_rows_render_against_the_tests_variables(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        test_id = saved_test({"prefix": {"type": "string", "value": "filebeat"}})

        pulled(connection(index="{{ prefix }}-*"), template_fields=["index"], test_id=test_id)

        assert stepped.index_calls[0][1] == PATTERN
        assert stepped.field_calls[0][1] == PATTERN

    @pytest.mark.parametrize(
        ("in_environment", "url", "password"),
        [
            (True, "http://env-host:9200", "env-pass"),
            (False, "http://profile-host:9200", "profile-pass"),
        ],
    )
    def test_profile_bindings_resolve_in_the_chosen_environment(
        self,
        reads: Callable[..., SteppedReads],
        seed_test_environment: str,
        in_environment: bool,
        url: str,
        password: str,
    ) -> None:
        stepped = reads(stepped=False)
        profile = profile_service.create_profile(
            name="Logs Cluster",
            profile_type="opensearch",
            config={
                "url": "http://profile-host:9200",
                "username": "app",
                "password": "profile-pass",
            },
            environment_values={
                seed_test_environment: {
                    "url": "http://env-host:9200",
                    "username": "app",
                    "password": "env-pass",
                }
            },
        )
        binding = {
            "profileId": profile["id"],
            "alias": "logs",
            "profileName": "Logs Cluster",
            "profileType": "opensearch",
        }
        rows = connection(url="logs.url", username="logs.username", password="logs.password")

        pulled(
            rows,
            expression_fields=["url", "username", "password"],
            profile_bindings=[binding],
            environment_id=seed_test_environment if in_environment else None,
        )

        settings = stepped.clients[0]
        assert settings["url"] == parse_cluster_url(url)
        assert settings["authorization"] == basic("app", password)

    def test_an_environment_that_does_not_exist_is_refused(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)

        with pytest.raises(
            UnprocessableEntityException, match=exact("Environment with ID 'e1' not found")
        ):
            start(connection(), environment_id="e1")

        assert catalog_jobs._JOBS == {}
        assert stepped.clients == []

    @pytest.mark.parametrize(("row", "label", "declared"), LABELED_ROWS)
    def test_a_row_that_cannot_be_resolved_is_refused_by_its_label(
        self, reads: Callable[..., SteppedReads], row: str, label: str, declared: str
    ) -> None:
        stepped = reads(stepped=False)
        expected = f"Cannot resolve {label}: {resolver_text(row, 'later_value', declared)}"

        with pytest.raises(UnprocessableEntityException, match=exact(expected)):
            start(connection(**{row: "later_value"}), expression_fields=[row])

        assert catalog_jobs._JOBS == {}
        assert stepped.clients == []

    def test_rows_that_resolve_to_the_same_cluster_share_one_pull(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        first = pulled(connection())
        test_id = saved_test({"os_url": {"type": "string", "value": URL}})

        again = start(connection(url="os_url"), expression_fields=["url"], test_id=test_id)

        assert again == {"job_id": first, "cached": True, "indexes": INDEXES, "fields": FIELDS}
        assert len(stepped.index_calls) == 1

    def test_two_sealings_of_one_password_share_one_pull(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        first = pulled(connection(password=seal_value(PASSWORD)))

        again = start(connection(password=seal_value(PASSWORD)))

        assert again == {"job_id": first, "cached": True, "indexes": INDEXES, "fields": FIELDS}
        assert len(stepped.index_calls) == 1


RESOLVE_REFUSED = (
    "no permissions for [indices:admin/resolve/index] and User "
    "[name=wave-limited, backend_roles=[], requestedTenant=null]"
)
FIELD_CAPS_REFUSED = (
    "no permissions for [indices:admin/mappings/fields/get] and User "
    "[name=wave-limited, backend_roles=[], requestedTenant=null]"
)
EVERY_INDEX_REFUSED = (
    "These credentials may not list every index. Type an index pattern they can read, "
    "such as logs-*"
)


def cluster_refusal(status: int, error_type: str, reason: str) -> OpenSearchFailure:
    """The failure the cluster's error answer with this status and envelope stands for."""
    body = json.dumps(error_answer(error_type, reason, status)).encode()
    return failure_for(_rest.Answer(status=status, reason="", headers={}, body=body))


class TestSecurityRefusal:
    """A 403 security_exception is said in plain words; every other failure keeps its text."""

    @pytest.mark.parametrize("index", ["", "   "])
    def test_a_refused_listing_of_every_index_asks_for_a_pattern(
        self, reads: Callable[..., SteppedReads], index: str
    ) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = cluster_refusal(403, "security_exception", RESOLVE_REFUSED)

        job_id = pulled(connection(index=index))

        assert fields.status(job_id) == {"status": "failed", "error": EVERY_INDEX_REFUSED}
        assert stepped.field_calls == []

    def test_a_refused_listing_of_a_pattern_names_it_and_quotes_opensearch(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = cluster_refusal(403, "security_exception", RESOLVE_REFUSED)

        job_id = pulled(connection())

        assert fields.status(job_id) == {
            "status": "failed",
            "error": "These credentials may not read filebeat-*. OpenSearch said: "
            f"security_exception: {RESOLVE_REFUSED}",
        }
        assert stepped.field_calls == []

    def test_a_refused_field_read_names_the_pattern_and_quotes_opensearch(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.field_error = cluster_refusal(403, "security_exception", FIELD_CAPS_REFUSED)

        job_id = pulled(connection())

        assert fields.status(job_id) == {
            "status": "failed",
            "error": "These credentials may not read filebeat-*. OpenSearch said: "
            f"security_exception: {FIELD_CAPS_REFUSED}",
        }

    def test_the_refusal_names_the_pattern_as_resolved(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = cluster_refusal(403, "security_exception", RESOLVE_REFUSED)

        job_id = pulled(connection(index=f"  {PATTERN}  "))

        assert fields.status(job_id)["error"] == (
            f"These credentials may not read {PATTERN}. OpenSearch said: "
            f"security_exception: {RESOLVE_REFUSED}"
        )

    @pytest.mark.parametrize("index", ["", PATTERN])
    def test_a_401_keeps_todays_text(self, reads: Callable[..., SteppedReads], index: str) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = cluster_refusal(
            401, "security_exception", "missing authentication credentials"
        )

        job_id = pulled(connection(index=index))

        assert fields.status(job_id) == {
            "status": "failed",
            "error": "security_exception: missing authentication credentials",
        }

    def test_a_401_on_the_field_read_keeps_todays_text(
        self, reads: Callable[..., SteppedReads]
    ) -> None:
        stepped = reads(stepped=False)
        stepped.field_error = cluster_refusal(
            401, "security_exception", "missing authentication credentials"
        )

        job_id = pulled(connection())

        assert fields.status(job_id) == {
            "status": "failed",
            "error": "security_exception: missing authentication credentials",
        }

    @pytest.mark.parametrize("index", ["", PATTERN])
    def test_a_403_of_another_type_keeps_todays_text(
        self, reads: Callable[..., SteppedReads], index: str
    ) -> None:
        stepped = reads(stepped=False)
        reason = "index [filebeat-1] blocked by: [FORBIDDEN/12/index read-only (api)];"
        stepped.index_error = cluster_refusal(403, "cluster_block_exception", reason)

        job_id = pulled(connection(index=index))

        assert fields.status(job_id) == {
            "status": "failed",
            "error": f"cluster_block_exception: {reason}",
        }

    @pytest.mark.parametrize("index", ["", PATTERN])
    def test_an_unreachable_cluster_keeps_todays_text(
        self, reads: Callable[..., SteppedReads], index: str
    ) -> None:
        stepped = reads(stepped=False)
        stepped.index_error = OpenSearchFailure(UNREACHABLE, "Unreachable")

        job_id = pulled(connection(index=index))

        assert fields.status(job_id) == {"status": "failed", "error": UNREACHABLE}


PULLED_INDEX = "filebeat-2026.09.25"
PULLED = {
    "status": "done",
    "indexes": [{"name": PULLED_INDEX, "kind": "index", "count": 1}],
    "fields": [{"name": "log.level", "types": ["keyword"], "aggregatable": True}],
}
PROXY_VARIABLES = ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")


@pytest.fixture
def cluster() -> Generator[RecordingHTTPServer, None, None]:
    """A loopback cluster that answers one index listing, then one field read."""
    server = serve()
    enqueue_json(server, resolve_index_answer(indices=[PULLED_INDEX]))
    enqueue_json(server, field_caps_answer({"log.level": "keyword"}, [PULLED_INDEX]))
    yield server
    stop(server)


def proxy_in_force(port: int, through: bool = True) -> None:
    """Put a hand-built proxy on 127.0.0.1 in force for both protocols."""
    proxy = importlib.import_module("wavecore.connectivity.proxy")
    endpoint = proxy.ProxyEndpoint("127.0.0.1", port, None, None)
    spec = proxy.ProxySpec(endpoint, endpoint, lambda _scheme, _host, _port: through)
    proxy.set_resolver(lambda: spec)


RealPull = Callable[[RecordingHTTPServer], dict[str, Any]]


@pytest.fixture
def real_pull(monkeypatch: pytest.MonkeyPatch) -> RealPull:
    """Pull from a loopback cluster with the real client; the answer once the pull thread ended."""
    entered = threading.Event()
    pulling: list[threading.Thread] = []
    read_indexes = _fields.read_indexes

    def recorded(client: Any, pattern: str) -> list[dict[str, Any]]:
        pulling.append(threading.current_thread())
        entered.set()
        return read_indexes(client, pattern)

    # The adapter may import the name or reach it through its module.
    for module, raising in ((_fields, True), (fields, False)):
        monkeypatch.setattr(module, "read_indexes", recorded, raising=raising)

    def pull(server: RecordingHTTPServer) -> dict[str, Any]:
        job_id = str(start(connection(url=server.base_url))["job_id"])
        assert entered.wait(BOUND)
        pulling[0].join(BOUND)
        return fields.status(job_id)

    return pull


class TestProxy:
    """The pull follows the Proxy setting like the block; no run is open, so no line is logged."""

    def test_with_a_route_both_reads_go_through_a_tunnel_to_the_cluster(
        self, cluster: RecordingHTTPServer, real_pull: RealPull
    ) -> None:
        tunnel = ("CONNECT", f"127.0.0.1:{port_of(cluster)}")
        with Proxy() as server:
            proxy_in_force(server.port)

            answer = real_pull(cluster)

            assert answer == PULLED
            assert [(asked.method, asked.target) for asked in server.requests] == [tunnel, tunnel]
        assert [record["method"] for record in cluster.requests] == ["GET", "GET"]

    def test_a_direct_decision_reads_from_the_cluster_itself(
        self, cluster: RecordingHTTPServer, real_pull: RealPull
    ) -> None:
        with Proxy() as server:
            proxy_in_force(server.port, through=False)

            answer = real_pull(cluster)

            assert answer == PULLED
            assert server.untouched

    def test_without_a_proxy_in_force_the_wave_hosts_proxy_variables_are_not_used(
        self, cluster: RecordingHTTPServer, real_pull: RealPull, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with Proxy() as server:
            for name in PROXY_VARIABLES:
                monkeypatch.setenv(name, server.url)

            answer = real_pull(cluster)

            assert answer == PULLED
            assert server.untouched

    def test_a_pull_through_the_proxy_logs_no_proxy_line(
        self,
        cluster: RecordingHTTPServer,
        real_pull: RealPull,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        written: list[tuple[str, str]] = []
        monkeypatch.setattr(
            RunLog, "once", lambda _sink, level, message: written.append((level, message))
        )
        with Proxy() as server, caplog.at_level(logging.DEBUG):
            proxy_in_force(server.port)

            answer = real_pull(cluster)

            assert answer == PULLED
            assert not server.untouched
        assert written == []
        assert "Using the proxy" not in caplog.text
