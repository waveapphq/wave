"""The OpenSearch block's core, run on WAVE and on a remote host alike (REQ-3.4.1.15, REQ-5.1.2)."""

import time
from collections.abc import Callable
from datetime import datetime, timezone
from functools import partial
from typing import Any

from wavecore.connectivity.k8s.verbs._outputs import (
    block_failure,
    block_success,
    summary_table,
    typed_table,
)
from wavecore.connectivity.opensearch._aggregate import Stat, aggregation_body, check_stats
from wavecore.connectivity.opensearch._auth import authorization
from wavecore.connectivity.opensearch._errors import (
    TIMEOUT,
    VALIDATION,
    OpenSearchFailure,
    kind_of,
    timeout_message,
)
from wavecore.connectivity.opensearch._fields import FieldList, read_field_list
from wavecore.connectivity.opensearch._query import (
    AuthorQuery,
    author_query,
    final_query,
    named_fields,
)
from wavecore.connectivity.opensearch._rest import Client, _shutdown_socket
from wavecore.connectivity.opensearch._results import results_table
from wavecore.connectivity.opensearch._search import partial_lines, run_search
from wavecore.connectivity.opensearch._stats_table import stats_columns, stats_table
from wavecore.connectivity.opensearch._time import Window, iso, parse_time, window, window_warnings
from wavecore.connectivity.opensearch._url import index_path, parse_cluster_url
from wavecore.connectivity.url_credentials import mask_url_passwords
from wavecore.plugins._held_run import Live, held

Log = Callable[[str, str], None]

# The run's clock, read once per run.
NOW = partial(datetime.now, timezone.utc)

_ACTIONS = {"search": "Search", "aggregate": "Aggregate"}
_DATE_TYPES = frozenset({"date", "date_nanos"})
# An answer that reports no shard failures and no cluster timeout is whole.
_WHOLE = {"_shards": {"failed": 0}, "timed_out": False}


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _text(params: dict[str, Any], name: str) -> str:
    value = params.get(name)
    return "" if value is None else str(value).strip()


def _secret(params: dict[str, Any], name: str) -> str:
    value = params.get(name)
    return "" if value is None else str(value)


def _number(params: dict[str, Any], name: str, default: int) -> int:
    value = params.get(name)
    return default if value is None or value == "" else int(value)


def _setting(params: dict[str, Any], name: str, default: Any) -> Any:
    value = params.get(name)
    return default if _blank(value) else value


def _entry(row: Any) -> Any:
    """A list row's value: `{"value": x}` gives x; a bare item stands for itself."""
    return row["value"] if isinstance(row, dict) and "value" in row else row


class _Block:
    """The block's settings in effect, a blank or absent row taking its default (OS-1)."""

    def __init__(self, params: dict[str, Any]) -> None:
        self.mode = str(params.get("mode") or "search")
        self.url = _text(params, "url")
        self.index = _text(params, "index")
        self.start = _setting(params, "from", "now-15m")
        self.end = _setting(params, "to", "now")
        self.language = str(params.get("query_language") or "dql")
        self.query = params.get("query")
        self.time_field = _text(params, "time_field") or "@timestamp"
        self.sort_by = _text(params, "sort_by") or self.time_field
        self.order = str(params.get("order") or "desc")
        self.max_results = _number(params, "max_results", 10000)
        self.group_by_time = str(params.get("group_by_time") or "1m")
        self.group_field = _text(params, "group_by_field")
        self.top_values = _number(params, "top_values", 10)
        self.timeout = _number(params, "timeout", 300)
        self.connect_timeout = _number(params, "connect_timeout", 30)
        self.field_rows = _setting(params, "fields", [{"value": "@timestamp"}])
        self.stat_rows = _setting(params, "stats", [{"value": {"stat": "count"}}])
        self.credentials = [
            _secret(params, name) for name in ("username", "password", "api_key", "bearer_token")
        ]
        verify = params.get("verify_ssl")
        self.tls_rows = {
            "verify_ssl": True if verify is None else bool(verify),
            "ca_cert": _text(params, "ca_cert"),
            "client_cert": _text(params, "client_cert"),
            "client_key": _text(params, "client_key"),
        }
        self.server_name = _text(params, "server_name") or None
        self.host_header = _text(params, "host_header") or None
        self.fields: list[str] = []
        self.stats: list[Stat] = []

    @property
    def searching(self) -> bool:
        return self.mode == "search"


def _field_names(rows: list[Any]) -> list[str]:
    """Each Fields entry names one field."""
    names = []
    for number, row in enumerate(rows, start=1):
        name = _entry(row)
        if _blank(name):
            raise OpenSearchFailure(
                f"Fields entry {number} is empty: give a field name or remove the entry",
                VALIDATION,
            )
        if not isinstance(name, str):
            raise OpenSearchFailure(
                f"Fields entry {number} must be a field name; it is {kind_of(name)}", VALIDATION
            )
        names.append(name.strip())
    return names


def _empties() -> dict[str, Any]:
    """What a recorded failure leaves in Results and Total results."""
    return {"results": summary_table([], []), "total_results": 0}


def _count(number: int, noun: str) -> str:
    return f"{number} {noun}" if number == 1 else f"{number} {noun}s"


class _Run:
    """One run's block, window, author query and log, and when its first request went out."""

    def __init__(self, block: _Block, span: Window, author: AuthorQuery, log: Log) -> None:
        self.block = block
        self.span = span
        self.author = author
        self.log = log
        self.started = time.monotonic()

    def finish(
        self, table: dict[str, Any], total: int, warnings: list[str], amber: bool
    ) -> dict[str, Any]:
        """Log the WARNs and the one run line (OS-10); answer the outputs."""
        block, log = self.block, self.log
        seconds = time.monotonic() - self.started
        for line in warnings:
            log("WARN", line)
        for note in self.author.notes:
            log("INFO", note)
        kept = len(table["rows"])
        size = f"{kept} kept" if block.searching else _count(kept, "row")
        log(
            "INFO",
            f"{_ACTIONS[block.mode]} {block.index} from {iso(self.span.from_ms)} to "
            f"{iso(self.span.to_ms)}: {_count(total, 'result')}, {size}, {seconds:.2f} s",
        )
        outputs = block_success({"results": table, "total_results": total})
        return {**outputs, "__block_warning": True} if amber else outputs


def _named(block: _Block, author: AuthorQuery) -> list[str]:
    """Every field the run names, in check order, each once (OS-9)."""
    names = named_fields(author)
    if block.searching:
        names += [*block.fields, block.sort_by, block.time_field]
    else:
        names += [block.time_field, *([block.group_field] if block.group_field else [])]
        for stat in block.stats:
            names += [stat.field] if stat.field else _field_values(stat.aggregation)
    return list(dict.fromkeys(names))


def _field_values(node: Any) -> list[str]:
    """The `field` values inside a Custom (JSON) aggregation."""
    if not isinstance(node, dict):
        return []
    own = node.get("field")
    names = [own] if isinstance(own, str) else []
    for child in node.values():
        names += _field_values(child)
    return names


def _check_fields(run: _Run, fields: FieldList) -> bool:
    """The Time field must be a date; each unknown name is a WARN. True when one is unknown."""
    block = run.block
    info = fields.fields.get(block.time_field)
    if info is not None and _DATE_TYPES.isdisjoint(info.types):
        raise OpenSearchFailure(
            f"Time field {block.time_field} is not a date field in {block.index}: "
            f"it is {' and '.join(info.types)}",
            VALIDATION,
        )
    unknown = [name for name in _named(block, run.author) if not fields.known(name)]
    for name in unknown:
        run.log("WARN", f"Field {name} is not in the field list of {block.index}")
    return bool(unknown)


def _search(run: _Run, client: Client, query: dict[str, Any], amber: bool) -> dict[str, Any]:
    outcome = run_search(client, run.block, query)
    table = results_table(run.block.fields, outcome.hits)
    return run.finish(table, outcome.total, outcome.warnings, amber or outcome.partial)


def _aggregate(run: _Run, client: Client, query: dict[str, Any], amber: bool) -> dict[str, Any]:
    block = run.block
    aggs = aggregation_body(
        block.stats,
        block.time_field,
        block.group_by_time,
        block.group_field,
        block.top_values,
        run.span,
    )
    body = {"size": 0, "track_total_hits": True, "query": query, "aggs": aggs}
    path = index_path(client.url.prefix, block.index, "_search")
    answer = client.json(client.request("POST", path, body=body), query)
    partial = list(partial_lines({**_WHOLE, **answer}).values())
    table, top_values = stats_table(
        block.stats,
        answer,
        block.time_field,
        block.group_by_time,
        block.group_field,
        block.top_values,
    )
    total = answer["hits"]["total"]["value"]
    return run.finish(table, total, partial + top_values, amber or bool(partial))


def _read(run: _Run, client: Client) -> dict[str, Any]:
    """The field list, the field checks, then the Search or the Aggregate."""
    block = run.block
    fields = read_field_list(client, block.index)
    if not fields.indices:
        run.log("WARN", f"Index pattern {block.index} matches no index")
        if block.searching:
            table = results_table(block.fields, [])
        else:
            columns = stats_columns(
                block.stats, block.time_field, block.group_by_time, block.group_field
            )
            table = typed_table(columns, [])
        return run.finish(table, 0, [], True)
    amber = _check_fields(run, fields)
    query = final_query(run.author, fields, block.time_field, run.span)
    work = _search if block.searching else _aggregate
    return work(run, client, query, amber)


def _connected(block: _Block, log: Log) -> dict[str, Any]:
    """Refuse what cannot make a request, then read under the deadline with the cancel held."""
    url = parse_cluster_url(block.url)
    auth = authorization(*block.credentials)
    start = parse_time("From", block.start)
    end = parse_time("To", block.end)
    author = author_query(block.language, block.query)
    if block.searching:
        block.fields = _field_names(block.field_rows)
    else:
        time_field = block.time_field if block.group_by_time != "none" else ""
        entries = [_entry(row) for row in block.stat_rows]
        block.stats = check_stats(entries, time_field, block.group_field)
    now = NOW()
    span = window(start, end, now)
    for line in window_warnings(span, now):
        log("WARN", line)
    live = Live(
        block.timeout,
        _shutdown_socket,
        lambda: OpenSearchFailure(timeout_message(block.timeout), TIMEOUT),
    )
    client = Client(
        url,
        block.tls_rows,
        block.connect_timeout,
        live,
        authorization=auth,
        server_name=block.server_name,
        host_header=block.host_header,
        debug=lambda line: log("DEBUG", mask_url_passwords(line)),
    )
    with held(live):
        return _read(_Run(block, span, author, log), client)


def run(params: dict[str, Any], log: Log) -> dict[str, Any]:
    """Run the block and answer the result envelope; a failure follows On error (OS-11)."""
    block = _Block(params)
    try:
        outputs = _connected(block, log)
    except OpenSearchFailure as failure:
        outputs = block_failure(
            params,
            _empties(),
            failure.message,
            failure.reason,
            log,
            action=_ACTIONS[block.mode],
        )
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
