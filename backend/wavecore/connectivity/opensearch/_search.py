"""Search requests and `search_after` paging (REQ-3.3.3.1, OS-6, OS-9)."""

from dataclasses import dataclass
from typing import Any

from ._rest import Client
from ._url import index_path

PAGE = 10000
_TIEBREAKER = {"_id": {"order": "asc"}}
_TIMED_OUT = "Partial results: the search timed out on the cluster"


@dataclass(frozen=True)
class SearchOutcome:
    hits: list[dict[str, Any]]
    total: int
    warnings: list[str]
    partial: bool


def run_search(client: Client, block: Any, query: dict[str, Any]) -> SearchOutcome:
    """Page by the sort plus the `_id` tiebreaker until Max results or the last hit."""
    path = index_path(client.url.prefix, block.index, "_search")
    limit = block.max_results
    hits: list[dict[str, Any]] = []
    partial: dict[str, str] = {}
    total = 0
    after = None
    while True:
        size = min(PAGE, limit - len(hits)) if limit else PAGE
        body = _page_body(block, query, size, after)
        answer = client.json(client.request("POST", path, body=body), query)
        page = answer["hits"]["hits"]
        if after is None:
            total = answer["hits"]["total"]["value"]
        for case, line in partial_lines(answer).items():
            partial.setdefault(case, line)
        hits.extend(page)
        if len(page) < size or (limit and len(hits) >= limit):
            break
        after = page[-1]["sort"]
    warnings = list(partial.values())
    if limit and total > len(hits):
        warnings.append(f"Kept {len(hits)} of {total} results (Max results)")
    return SearchOutcome(hits, total, warnings, bool(partial))


def _page_body(block: Any, query: dict[str, Any], size: int, after: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "size": size,
        "track_total_hits": after is None,
        "query": query,
        "sort": [{block.sort_by: {"order": block.order}}, _TIEBREAKER],
        "_source": {"includes": list(block.fields)} if block.fields else True,
    }
    if after is not None:
        body["search_after"] = after
    return body


def partial_lines(answer: dict[str, Any]) -> dict[str, str]:
    """The partial-result WARN lines of one `_search` answer, keyed by case."""
    lines = {}
    shards = answer["_shards"]
    if shards["failed"] > 0:
        first = shards["failures"][0]["reason"]
        lines["shards"] = (
            f"Partial results: {shards['failed']} of {shards['total']} shards failed. "
            f"First failure: {first['type']}: {first['reason']}"
        )
    if answer["timed_out"]:
        lines["timed_out"] = _TIMED_OUT
    return lines
