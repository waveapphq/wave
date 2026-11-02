"""Search requests and paging on loopback scripted answers (REQ-3.3.2.5, REQ-3.3.3.1, OS-6, OS-9).

Page 1 asks for exact totals; later pages continue with `search_after` on the sort plus the
`_id` tiebreaker, never `from` and never a point in time; Max results bounds what is kept
and says so at WARN; failed shards or a cluster timeout on any page are partial results.
"""

import json
from collections.abc import Generator
from typing import Any

import pytest

from tests.connectivity.opensearch.fakes import (
    enqueue_json,
    enqueue_text,
    error_answer,
    search_answer,
    sent,
    sent_json,
    serve,
    stop,
)
from tests.plugins.http.conftest import RecordingHTTPServer
from wavecore.connectivity.opensearch._errors import OpenSearchFailure, timeout_message
from wavecore.connectivity.opensearch._rest import Client
from wavecore.connectivity.opensearch._search import run_search
from wavecore.connectivity.opensearch._url import parse_cluster_url
from wavecore.plugins._held_run import Live

DEADLINE_SECONDS = 5
PAGE = 10000
INDEX = "filebeat-*"
FIELDS = ["@timestamp", "log.level", "message"]
TOP_MS = 1790332925123
RANGE = {"range": {"@timestamp": {"gte": 1790332025123, "lte": TOP_MS, "format": "epoch_millis"}}}
LEVEL_IS_ERROR = {
    "bool": {"should": [{"match": {"log.level": "ERROR"}}], "minimum_should_match": 1}
}
QUERY = {"bool": {"filter": [RANGE, LEVEL_IS_ERROR]}}
TIEBREAKER = {"_id": {"order": "asc"}}
PAGE_ONE = {
    "size": 10000,
    "track_total_hits": True,
    "query": QUERY,
    "sort": [{"@timestamp": {"order": "desc"}}, TIEBREAKER],
    "_source": {"includes": ["@timestamp", "log.level", "message"]},
}
SHARD_FAILURE = {
    "shard": 0,
    "index": "filebeat-2026.09.25",
    "node": "node-1",
    "reason": {
        "type": "query_shard_exception",
        "reason": 'failed to create query: For input string: "abc"',
    },
}
FAILED_SHARD_LINE = (
    "Partial results: 1 of 2 shards failed. First failure: query_shard_exception: "
    'failed to create query: For input string: "abc"'
)
TIMED_OUT_LINE = "Partial results: the search timed out on the cluster"


class Block(dict[str, Any]):
    """The Search settings by wire name, readable as keys or as attributes."""

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name) from None


def block(**overrides: Any) -> Block:
    settings: dict[str, Any] = {
        "index": INDEX,
        "fields": list(FIELDS),
        "sort_by": "@timestamp",
        "order": "desc",
        "max_results": 10000,
        "time_field": "@timestamp",
    }
    return Block({**settings, **overrides})


def _timeout_failure() -> OpenSearchFailure:
    return OpenSearchFailure(timeout_message(DEADLINE_SECONDS), "Timeout")


def client(server: RecordingHTTPServer, path: str = "") -> Client:
    live = Live(DEADLINE_SECONDS, lambda _resource: None, _timeout_failure)
    return Client(parse_cluster_url(server.base_url + path), {}, 2.0, live, authorization=None)


def page_hits(count: int, start: int = 0) -> list[dict[str, Any]]:
    """Lean sorted hits, so a 10,000-hit page stays cheap to script."""
    return [
        {"_id": f"d{number}", "_source": {}, "sort": [TOP_MS - number, f"d{number}"]}
        for number in range(start, start + count)
    ]


def later_page(hits: list[dict[str, Any]]) -> dict[str, Any]:
    """A page asked with track_total_hits false: OpenSearch leaves the total out."""
    answer = search_answer(hits, 0)
    del answer["hits"]["total"]
    return answer


def search(
    server: RecordingHTTPServer, *answers: dict[str, Any], path: str = "", **overrides: Any
) -> Any:
    for answer in answers:
        enqueue_json(server, answer)
    return run_search(client(server, path), block(**overrides), QUERY)


def ids(hits: list[dict[str, Any]]) -> list[str]:
    return [entry["_id"] for entry in hits]


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


class TestPageOne:
    """The first page: exact totals, the sort with the `_id` tiebreaker, the chosen fields."""

    def test_the_pinned_body(self, cluster: RecordingHTTPServer) -> None:
        search(cluster, search_answer(page_hits(2), 2))

        assert sent_json(cluster, 0) == PAGE_ONE

    def test_it_posts_to_the_encoded_index(self, cluster: RecordingHTTPServer) -> None:
        search(cluster, search_answer(page_hits(2), 2))

        request = sent(cluster, 0)
        assert request["method"] == "POST"
        assert request["raw_path"] == "/filebeat-%2A/_search"

    def test_the_gateway_prefix_leads_the_path(self, cluster: RecordingHTTPServer) -> None:
        search(cluster, search_answer(page_hits(2), 2), path="/os/")

        assert sent(cluster, 0)["raw_path"] == "/os/filebeat-%2A/_search"

    def test_an_index_list_is_encoded_whole(self, cluster: RecordingHTTPServer) -> None:
        search(cluster, search_answer([], 0), index="logs-*,-logs-debug*")

        assert sent(cluster, 0)["raw_path"] == "/logs-%2A%2C-logs-debug%2A/_search"

    def test_sort_by_and_order(self, cluster: RecordingHTTPServer) -> None:
        search(cluster, search_answer([], 0), sort_by="latency_ms", order="asc")

        assert sent_json(cluster, 0)["sort"] == [{"latency_ms": {"order": "asc"}}, TIEBREAKER]

    def test_empty_fields_ask_for_the_whole_document(self, cluster: RecordingHTTPServer) -> None:
        search(cluster, search_answer([], 0), fields=[])

        assert sent_json(cluster, 0)["_source"] is True

    def test_the_fields_keep_their_order(self, cluster: RecordingHTTPServer) -> None:
        search(cluster, search_answer([], 0), fields=["message", "user.*", "@timestamp"])

        assert sent_json(cluster, 0)["_source"] == {"includes": ["message", "user.*", "@timestamp"]}

    @pytest.mark.parametrize(
        ("max_results", "size"),
        [(1, 1), (25, 25), (10000, 10000), (25000, 10000), (0, 10000)],
        ids=["one", "below-a-page", "one-page", "past-a-page", "zero-keeps-all"],
    )
    def test_the_page_size(self, cluster: RecordingHTTPServer, max_results: int, size: int) -> None:
        search(cluster, search_answer([], 0), max_results=max_results)

        assert sent_json(cluster, 0)["size"] == size

    def test_the_hits_come_back_in_order(self, cluster: RecordingHTTPServer) -> None:
        hits = page_hits(3)

        outcome = search(cluster, search_answer(hits, 3))

        assert outcome.hits == hits
        assert outcome.total == 3
        assert outcome.warnings == []
        assert outcome.partial is False

    def test_the_total_is_the_page_one_count(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(cluster, search_answer(page_hits(3), 57), max_results=0)

        assert outcome.total == 57
        assert ids(outcome.hits) == ["d0", "d1", "d2"]


class TestPaging:
    """Past 10,000 the block pages by `search_after`; never `from`, never a point in time."""

    def test_max_results_zero_keeps_every_page(self, cluster: RecordingHTTPServer) -> None:
        first = page_hits(PAGE)

        outcome = search(
            cluster,
            search_answer(first, 10003),
            later_page(page_hits(3, start=PAGE)),
            max_results=0,
        )

        assert len(cluster.requests) == 2
        assert sent_json(cluster, 1) == {
            **PAGE_ONE,
            "track_total_hits": False,
            "search_after": first[-1]["sort"],
        }
        assert len(outcome.hits) == 10003
        assert ids(outcome.hits[-4:]) == ["d9999", "d10000", "d10001", "d10002"]
        assert outcome.total == 10003
        assert outcome.warnings == []

    def test_the_last_page_asks_only_for_the_rest(self, cluster: RecordingHTTPServer) -> None:
        first = page_hits(PAGE)

        outcome = search(
            cluster,
            search_answer(first, 20000),
            later_page(page_hits(5000, start=PAGE)),
            max_results=15000,
        )

        assert len(cluster.requests) == 2
        assert sent_json(cluster, 0)["size"] == 10000
        assert sent_json(cluster, 1) == {
            **PAGE_ONE,
            "size": 5000,
            "track_total_hits": False,
            "search_after": first[-1]["sort"],
        }
        assert len(outcome.hits) == 15000
        assert outcome.total == 20000

    def test_an_empty_page_stops(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(
            cluster, search_answer(page_hits(PAGE), 10000), later_page([]), max_results=0
        )

        assert len(cluster.requests) == 2
        assert len(outcome.hits) == 10000
        assert outcome.total == 10000

    def test_a_short_page_stops(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(cluster, search_answer(page_hits(3), 3), max_results=0)

        assert len(cluster.requests) == 1
        assert len(outcome.hits) == 3

    def test_reaching_max_results_stops(self, cluster: RecordingHTTPServer) -> None:
        search(cluster, search_answer(page_hits(5), 57), max_results=5)

        assert len(cluster.requests) == 1

    def test_search_after_keeps_the_exact_sort_values(self, cluster: RecordingHTTPServer) -> None:
        first = page_hits(PAGE)
        first[-1]["sort"] = ["LAST_SORT", "d9999"]
        enqueue_text(
            cluster, json.dumps(search_answer(first, 10001)).replace('"LAST_SORT"', "1.10")
        )
        enqueue_json(cluster, later_page(page_hits(1, start=PAGE)))

        run_search(client(cluster), block(max_results=0), QUERY)

        assert b'"search_after":[1.10,"d9999"]' in cluster.requests[1]["body"]

    def test_never_from_and_never_a_point_in_time(self, cluster: RecordingHTTPServer) -> None:
        search(
            cluster,
            search_answer(page_hits(PAGE), 10001),
            later_page(page_hits(1, start=PAGE)),
            max_results=0,
        )

        for index in range(2):
            request = sent(cluster, index)
            body = sent_json(cluster, index)
            assert request["method"] == "POST"
            assert request["raw_path"] == "/filebeat-%2A/_search"
            assert "from" not in body
            assert "pit" not in body
            assert body["sort"][-1] == TIEBREAKER


class TestMaxResultsCut:
    """Reaching Max results is not a failure: WARN `Kept N of M results (Max results)`."""

    def test_the_pinned_line(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(cluster, search_answer(page_hits(1), 57), max_results=1)

        assert ids(outcome.hits) == ["d0"]
        assert outcome.total == 57
        assert outcome.warnings == ["Kept 1 of 57 results (Max results)"]
        assert outcome.partial is False

    def test_the_cut_past_a_page(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(
            cluster,
            search_answer(page_hits(PAGE), 20000),
            later_page(page_hits(5000, start=PAGE)),
            max_results=15000,
        )

        assert outcome.warnings == ["Kept 15000 of 20000 results (Max results)"]

    @pytest.mark.parametrize(
        ("max_results", "total"),
        [(10, 3), (3, 3)],
        ids=["fewer-matches-than-max", "exactly-max"],
    )
    def test_nothing_cut_says_nothing(
        self, cluster: RecordingHTTPServer, max_results: int, total: int
    ) -> None:
        outcome = search(cluster, search_answer(page_hits(total), total), max_results=max_results)

        assert len(outcome.hits) == total
        assert outcome.warnings == []

    def test_zero_keeps_all_and_says_nothing(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(
            cluster,
            search_answer(page_hits(PAGE), 10002),
            later_page(page_hits(2, start=PAGE)),
            max_results=0,
        )

        assert outcome.warnings == []


class TestPartialResults:
    """Failed shards or a cluster timeout on any page: one WARN per case, partial (OS-9)."""

    def test_the_pinned_failed_shards_line(self, cluster: RecordingHTTPServer) -> None:
        answer = search_answer(page_hits(2), 2, failed=1, shard_failures=[SHARD_FAILURE])

        outcome = search(cluster, answer)

        assert outcome.warnings == [FAILED_SHARD_LINE]
        assert outcome.partial is True
        assert len(outcome.hits) == 2

    def test_the_first_failure_is_named(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(cluster, search_answer(page_hits(2), 2, failed=2))

        assert outcome.warnings == [
            "Partial results: 2 of 3 shards failed. First failure: query_shard_exception: "
            "failed to create query"
        ]

    def test_the_search_timed_out_on_the_cluster(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(cluster, search_answer(page_hits(2), 2, timed_out=True))

        assert outcome.warnings == [TIMED_OUT_LINE]
        assert outcome.partial is True

    def test_both_cases_on_one_page(self, cluster: RecordingHTTPServer) -> None:
        answer = search_answer(
            page_hits(2), 2, failed=1, shard_failures=[SHARD_FAILURE], timed_out=True
        )

        outcome = search(cluster, answer)

        assert len(outcome.warnings) == 2
        assert set(outcome.warnings) == {FAILED_SHARD_LINE, TIMED_OUT_LINE}
        assert outcome.partial is True

    def test_each_case_is_said_once_per_run(self, cluster: RecordingHTTPServer) -> None:
        later = search_answer(
            page_hits(1, start=PAGE), 0, failed=1, shard_failures=[SHARD_FAILURE], timed_out=True
        )
        first = search_answer(
            page_hits(PAGE), 10001, failed=1, shard_failures=[SHARD_FAILURE], timed_out=True
        )

        outcome = search(cluster, first, later, max_results=0)

        assert len(cluster.requests) == 2
        assert sorted(outcome.warnings) == sorted([FAILED_SHARD_LINE, TIMED_OUT_LINE])

    def test_a_later_page_can_be_partial(self, cluster: RecordingHTTPServer) -> None:
        later = search_answer(page_hits(1, start=PAGE), 0, timed_out=True)

        outcome = search(cluster, search_answer(page_hits(PAGE), 10001), later, max_results=0)

        assert outcome.warnings == [TIMED_OUT_LINE]
        assert outcome.partial is True

    def test_skipped_shards_are_not_a_failure(self, cluster: RecordingHTTPServer) -> None:
        outcome = search(cluster, search_answer(page_hits(2), 2, skipped=3))

        assert outcome.warnings == []
        assert outcome.partial is False

    def test_partial_lines_come_before_the_max_results_line(
        self, cluster: RecordingHTTPServer
    ) -> None:
        answer = search_answer(page_hits(5), 57, failed=1, shard_failures=[SHARD_FAILURE])

        outcome = search(cluster, answer, max_results=5)

        assert outcome.warnings == [FAILED_SHARD_LINE, "Kept 5 of 57 results (Max results)"]


class TestRefusedSearch:
    """An error answer fails the search with its failure text; the query as sent is named."""

    def test_all_shards_failed_names_the_query_as_sent(self, cluster: RecordingHTTPServer) -> None:
        envelope = error_answer(
            "search_phase_execution_exception",
            "all shards failed",
            400,
            root_cause=[SHARD_FAILURE["reason"]],
        )
        enqueue_json(cluster, envelope, status=400)

        with pytest.raises(OpenSearchFailure) as caught:
            run_search(client(cluster), block(), QUERY)

        assert caught.value.message == (
            "search_phase_execution_exception: all shards failed. First root cause: "
            'query_shard_exception: failed to create query: For input string: "abc". '
            f"Query as sent: {json.dumps(QUERY, separators=(',', ':'))}"
        )
        assert caught.value.reason == "RequestFailed"

    def test_a_security_refusal_is_auth_failed(self, cluster: RecordingHTTPServer) -> None:
        reason = "no permissions for [indices:data/read/search] and User [name=wave-limited]"
        enqueue_json(cluster, error_answer("security_exception", reason, 403), status=403)

        with pytest.raises(OpenSearchFailure) as caught:
            run_search(client(cluster), block(), QUERY)

        assert caught.value.message == f"security_exception: {reason}"
        assert caught.value.reason == "AuthFailed"

    def test_a_refused_later_page_fails_the_search(self, cluster: RecordingHTTPServer) -> None:
        enqueue_json(cluster, search_answer(page_hits(PAGE), 10001))
        enqueue_json(cluster, error_answer("illegal_argument_exception", "bad sort", 400), 400)

        with pytest.raises(OpenSearchFailure) as caught:
            run_search(client(cluster), block(max_results=0), QUERY)

        assert caught.value.message == "illegal_argument_exception: bad sort"
        assert caught.value.reason == "RequestFailed"
