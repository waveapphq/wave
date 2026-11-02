"""The field list, the index list and daily-index folding (REQ-3.3.2.5, REQ-3.3.2.6, REQ-5.1.2).

`_field_caps` gives the fields a run checks every named field against (OS-9); `_resolve/index`
gives the index picker's list, where daily indexes fold into one pattern entry.
"""

from collections.abc import Generator
from datetime import date, timedelta
from typing import Any
from urllib.parse import unquote

import pytest

from tests.connectivity.opensearch.fakes import (
    METADATA_FIELDS,
    enqueue_json,
    error_answer,
    field_caps_answer,
    resolve_index_answer,
    sent,
    serve,
    stop,
)
from tests.plugins.http.conftest import RecordingHTTPServer
from wavecore.connectivity.opensearch._errors import OpenSearchFailure, timeout_message
from wavecore.connectivity.opensearch._fields import (
    FieldInfo,
    FieldList,
    fold_indexes,
    read_field_list,
    read_indexes,
)
from wavecore.connectivity.opensearch._rest import Client
from wavecore.connectivity.opensearch._url import parse_cluster_url
from wavecore.plugins._held_run import Live

DEADLINE_SECONDS = 5
FIELD_CAPS_PATH = "/filebeat-%2A/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true"
KEYWORD = FieldInfo(types=["keyword"], aggregatable=True)
LISTED = FieldList(
    indices=["filebeat-2026.09.25"],
    fields={
        "@timestamp": FieldInfo(types=["date"], aggregatable=True),
        "log.level": KEYWORD,
        "message": FieldInfo(types=["text"], aggregatable=False),
        "service.name": KEYWORD,
    },
)
SECURITY_REASON = "no permissions for [indices:admin/get] and User [name=wave-limited]"


def _timeout_failure() -> OpenSearchFailure:
    return OpenSearchFailure(timeout_message(DEADLINE_SECONDS), "Timeout")


def client(server: RecordingHTTPServer, path: str = "") -> Client:
    live = Live(DEADLINE_SECONDS, lambda _resource: None, _timeout_failure)
    return Client(parse_cluster_url(server.base_url + path), {}, 2.0, live, authorization=None)


def entry(name: str, kind: str = "index", count: int = 1) -> dict[str, Any]:
    return {"name": name, "kind": kind, "count": count}


def folded(name: str, count: int) -> dict[str, Any]:
    return entry(name, "folded", count)


@pytest.fixture(scope="module")
def listener() -> Generator[RecordingHTTPServer, None, None]:
    """One scripted server per module, so its shutdown is paid once."""
    server = serve()
    yield server
    stop(server)


@pytest.fixture
def cluster(listener: RecordingHTTPServer) -> RecordingHTTPServer:
    """The module's server with no request recorded and no answer queued."""
    listener.requests.clear()
    listener._responses.clear()
    return listener


class TestReadFieldList:
    """`GET <index>/_field_caps`: every field with its sorted types and the aggregatable rule."""

    def test_the_request(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, field_caps_answer({"message": "text"}, ["filebeat-2026.09.25"]))

        read_field_list(client(cluster), "filebeat-*")

        request = sent(cluster, 0)
        assert request["method"] == "GET"
        assert request["raw_path"] == FIELD_CAPS_PATH
        assert request["body"] == b""

    def test_the_gateway_prefix_leads_the_path(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, field_caps_answer({}, []))

        read_field_list(client(cluster, "/os/"), "filebeat-*")

        assert sent(cluster, 0)["raw_path"] == f"/os{FIELD_CAPS_PATH}"

    def test_the_fields_and_indexes(self, cluster: RecordingHTTPServer) -> None:
        answer = field_caps_answer(
            {"@timestamp": "date", "log.level": "keyword", "message": "text"},
            ["filebeat-2026.09.24", "filebeat-2026.09.25"],
            not_aggregatable=("message",),
        )
        enqueue_json(cluster, answer)

        field_list = read_field_list(client(cluster), "filebeat-*")

        assert field_list.indices == ["filebeat-2026.09.24", "filebeat-2026.09.25"]
        assert field_list.fields == {
            "@timestamp": FieldInfo(types=["date"], aggregatable=True),
            "log.level": FieldInfo(types=["keyword"], aggregatable=True),
            "message": FieldInfo(types=["text"], aggregatable=False),
        }

    def test_types_across_indexes_are_sorted(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(
            cluster,
            field_caps_answer({"status": ["long", "keyword"]}, ["logs-1", "logs-2"]),
        )

        field_list = read_field_list(client(cluster), "logs-*")

        assert field_list.fields["status"] == FieldInfo(
            types=["keyword", "long"], aggregatable=True
        )

    @pytest.mark.parametrize(
        ("keyword_aggregatable", "aggregatable"),
        [(True, False), (False, False)],
        ids=["one-type-is-not", "none-is"],
    )
    def test_aggregatable_only_when_every_type_says_so(
        self, cluster: RecordingHTTPServer, keyword_aggregatable: bool, aggregatable: bool
    ) -> None:
        enqueue_json(
            cluster,
            {
                "indices": ["logs-1", "logs-2"],
                "fields": {
                    "code": {
                        "text": {"type": "text", "searchable": True, "aggregatable": False},
                        "keyword": {
                            "type": "keyword",
                            "searchable": True,
                            "aggregatable": keyword_aggregatable,
                        },
                    }
                },
            },
        )

        field_list = read_field_list(client(cluster), "logs-*")

        assert field_list.fields["code"] == FieldInfo(
            types=["keyword", "text"], aggregatable=aggregatable
        )

    def test_metadata_fields_are_known_but_not_listed(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, field_caps_answer({"message": "text"}, ["logs-1"]))

        field_list = read_field_list(client(cluster), "logs-*")

        assert list(field_list.fields) == ["message"]
        assert all(field_list.known(name) for name in METADATA_FIELDS)

    def test_no_index_matches(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, {"indices": [], "fields": {}})

        field_list = read_field_list(client(cluster), "nothing-*")

        assert field_list.indices == []
        assert field_list.fields == {}

    def test_a_refusal_fails_with_its_reason(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, error_answer("security_exception", SECURITY_REASON, 403), 403)

        with pytest.raises(OpenSearchFailure) as caught:
            read_field_list(client(cluster), "filebeat-*")

        assert caught.value.message == f"security_exception: {SECURITY_REASON}"
        assert caught.value.reason == "AuthFailed"


class TestKnown:
    """A listed field, a metadata field, or a pattern with `*` matching a listed field."""

    @pytest.mark.parametrize("name", ["@timestamp", "log.level", "message", "service.name"])
    def test_a_listed_field(self, name: str) -> None:
        assert LISTED.known(name) is True

    @pytest.mark.parametrize("name", METADATA_FIELDS)
    def test_a_metadata_field(self, name: str) -> None:
        assert LISTED.known(name) is True

    @pytest.mark.parametrize("name", ["log.invalid", "log", "service", "Message"])
    def test_an_unlisted_name(self, name: str) -> None:
        assert LISTED.known(name) is False

    @pytest.mark.parametrize("name", ["log.*", "*", "*.name", "serv*", "*level"])
    def test_a_pattern_that_matches_a_listed_field(self, name: str) -> None:
        assert LISTED.known(name) is True

    @pytest.mark.parametrize("name", ["nope.*", "log.x*", "_i*"])
    def test_a_pattern_that_matches_no_listed_field(self, name: str) -> None:
        assert LISTED.known(name) is False

    def test_a_pattern_on_an_empty_list(self) -> None:
        assert FieldList(indices=[], fields={}).known("*") is False


class TestReadIndexes:
    """`GET _resolve/index/<pattern>`: indexes, aliases and data streams, dailies folded."""

    def test_the_request(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, resolve_index_answer())

        read_indexes(client(cluster), "logs-*")

        request = sent(cluster, 0)
        assert request["method"] == "GET"
        assert request["raw_path"] == "/_resolve/index/logs-%2A"
        assert request["body"] == b""

    def test_the_gateway_prefix_leads_the_path(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, resolve_index_answer())

        read_indexes(client(cluster, "/os/"), "logs-*")

        assert sent(cluster, 0)["raw_path"] == "/os/_resolve/index/logs-%2A"

    def test_a_blank_pattern_lists_everything(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, resolve_index_answer())

        read_indexes(client(cluster), "")

        request = sent(cluster, 0)
        assert unquote(request["raw_path"]) == "/_resolve/index/*"
        assert request["query"] == {}

    def test_every_kind_in_name_order(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(
            cluster,
            resolve_index_answer(
                indices=["orders", "logs-2026.09.25", "logs-2026.09.24"],
                aliases=["logs"],
                data_streams=["metrics"],
            ),
        )

        indexes = read_indexes(client(cluster), "*")

        assert indexes == [
            entry("logs", "alias"),
            folded("logs-*", 2),
            entry("metrics", "data_stream"),
            entry("orders"),
        ]

    def test_nothing_matches(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, resolve_index_answer())

        assert read_indexes(client(cluster), "nothing-*") == []

    def test_a_refusal_fails_with_its_reason(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, error_answer("security_exception", SECURITY_REASON, 403), 403)

        with pytest.raises(OpenSearchFailure) as caught:
            read_indexes(client(cluster), "logs-*")

        assert caught.value.message == f"security_exception: {SECURITY_REASON}"
        assert caught.value.reason == "AuthFailed"


class TestFoldIndexes:
    """Names ending in a date stamp fold by their prefix when two or more share it."""

    @pytest.mark.parametrize(
        ("names", "name"),
        [
            pytest.param(["logs-2026.09.25", "logs-2026.09.24"], "logs-*", id="dash-dotted-date"),
            pytest.param(
                ["wave-e2e-a1b2-daily-2026.09.25", "wave-e2e-a1b2-daily-2026.09.24"],
                "wave-e2e-a1b2-daily-*",
                id="dashes-inside-the-prefix",
            ),
            pytest.param(["metrics_20260925", "metrics_20260924"], "metrics_*", id="underscore"),
            pytest.param(["app20260925", "app20260924"], "app*", id="no-separator"),
            pytest.param(["logs.2026.09.25", "logs.2026.09.24"], "logs.*", id="dot"),
            pytest.param(["logs-2026.09", "logs-2026.10"], "logs-*", id="month-stamp"),
            pytest.param(["logs-2026-09-25", "logs-2026_09_24"], "logs-*", id="mixed-inner-marks"),
            pytest.param(["logs-2026.09.25", "logs-20260924"], "logs-*", id="two-stamp-styles"),
        ],
    )
    def test_the_folded_name(self, names: list[str], name: str) -> None:
        assert fold_indexes(names, [], []) == [folded(name, 2)]

    def test_the_count_is_every_folded_index(self) -> None:
        first = date(2025, 1, 1)
        names = [f"logs-{first + timedelta(days=day):%Y.%m.%d}" for day in range(412)]

        assert fold_indexes(names, [], []) == [folded("logs-*", 412)]

    def test_a_lone_dated_index_stays_itself(self) -> None:
        assert fold_indexes(["logs-2026.09.25", "orders"], [], []) == [
            entry("logs-2026.09.25"),
            entry("orders"),
        ]

    def test_different_separators_never_fold_together(self) -> None:
        assert fold_indexes(["logs-2026.09.25", "logs_2026.09.25"], [], []) == [
            entry("logs-2026.09.25"),
            entry("logs_2026.09.25"),
        ]

    def test_each_separator_folds_on_its_own(self) -> None:
        names = ["logs_2026.09.24", "logs-2026.09.24", "logs_2026.09.25", "logs-2026.09.25"]

        assert fold_indexes(names, [], []) == [folded("logs-*", 2), folded("logs_*", 2)]

    def test_names_without_a_stamp_stay_themselves(self) -> None:
        assert fold_indexes(["orders", "orders-v2", "logs-2026"], [], []) == [
            entry("logs-2026"),
            entry("orders"),
            entry("orders-v2"),
        ]

    def test_folded_and_single_entries_by_name(self) -> None:
        names = [
            "zeta",
            "metrics_20260925",
            "logs-2026.09.25",
            "app20260924",
            "logs-2026.09.24",
            "app20260925",
        ]

        assert fold_indexes(names, [], []) == [
            folded("app*", 2),
            folded("logs-*", 2),
            entry("metrics_20260925"),
            entry("zeta"),
        ]

    def test_aliases_and_data_streams_keep_their_kind(self) -> None:
        assert fold_indexes(["orders"], ["all-orders"], ["events"]) == [
            entry("all-orders", "alias"),
            entry("events", "data_stream"),
            entry("orders"),
        ]

    def test_nothing(self) -> None:
        assert fold_indexes([], [], []) == []
