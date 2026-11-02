"""OpenSearch Plugin: reads documents and numbers from an OpenSearch cluster (REQ-3.4.1.15)."""

from dataclasses import replace
from functools import partial
from typing import Any

from wavecore.connectivity.opensearch._errors import OpenSearchFailure
from wavecore.connectivity.opensearch._url import parse_cluster_url
from wavecore.connectivity.web_address import basic_authorization
from wavecore.plugins import _opensearch_core
from wavecore.plugins._shared_params import (
    blank,
    check_at_least,
    check_boolean,
    check_integer,
    chosen,
    gate,
    on_error_parameter,
    output_core,
    select_parameter,
    timeout_parameter,
)
from wavecore.plugins._ssh_session import resolve_tunnel
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase

# Each select's wire values in order, then its default.
_CHOICES: dict[str, tuple[list[str], str]] = {
    "mode": (["search", "aggregate"], "search"),
    "query_language": (["dql", "query_dsl"], "dql"),
    "order": (["desc", "asc"], "desc"),
    "group_by_time": (["none", "10s", "30s", "1m", "5m", "15m", "1h"], "1m"),
    "on_error": (["fail", "record"], "fail"),
}
_REASONS = (
    "Why the block failed: Unreachable, AuthFailed, RequestFailed, Timeout or Validation; "
    "empty otherwise"
)

_select = partial(select_parameter, _CHOICES)
_choice = partial(chosen, _CHOICES)

_SEARCH = gate("mode", "search")
_AGGREGATE = gate("mode", "aggregate")


def _basic_text(params: dict[str, Any]) -> list[str]:
    """The Basic credential's header text, which the run's log must never show."""
    username = params.get("username")
    if not username:
        return []
    return [basic_authorization(username, params.get("password")).partition(" ")[2]]


def prepare(params: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Settle on WAVE what only WAVE knows: a tunnel's far host and the values to mask."""
    masked = _basic_text(params)
    try:
        url = parse_cluster_url(str(params.get("url") or ""))
    except OpenSearchFailure:
        # The core refuses the URL with its own message.
        return dict(params), masked
    route = resolve_tunnel(url.host, url.port, context.get("ssh_session_registry"))
    if route is None:
        return dict(params), masked
    far = replace(url, host=route.far_host, port=route.far_port)
    return {**params, "server_name": far.host, "host_header": far.where}, masked


class OpenSearchPlugin(PluginBase):
    """Searches or aggregates the documents of an index pattern inside a time window (OS-1)."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        success, error, reason = output_core(
            gated=True,
            success_description=(
                "True when the block finished; false when the block failed and On error is "
                "Record and continue"
            ),
            reason_description=_REASONS,
        )
        return {
            "id": "opensearch",
            "name": "OpenSearch",
            "version": "1.0.0",
            "category": "database",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Reads what the application under test sent to OpenSearch: matching documents "
                "in Search mode, numbers worked out from them in Aggregate mode. Never writes."
            ),
            "tags": ["opensearch", "search", "logs", "dql", "database"],
            "secret_mask_fields": ["password", "api_key", "bearer_token", "client_key"],
            "parameters": [
                {
                    "name": "url",
                    "type": "string",
                    "required": True,
                    "trim": True,
                    "description": (
                        "The cluster's REST address with scheme and port: "
                        "https://opensearch.internal:9200"
                    ),
                },
                {
                    "name": "index",
                    "type": "string",
                    "required": True,
                    "trim": True,
                    "description": (
                        "Where to look: one index, a wildcard such as logs-*, a comma list, "
                        "exclusions with a leading minus, an alias, a data stream, or a "
                        "date-math name such as <logs-{now/d}> for today's daily index. Sent as "
                        "written; OpenSearch resolves it"
                    ),
                },
                {
                    "name": "from",
                    "type": ["string", "integer"],
                    "default": "now-15m",
                    "trim": True,
                    "description": (
                        "Start of the window: Absolute, Relative or Now, or a variable or "
                        "expression with {}"
                    ),
                },
                {
                    "name": "to",
                    "type": ["string", "integer"],
                    "default": "now",
                    "trim": True,
                    "description": (
                        "End of the window: Absolute, Relative or Now, or a variable or "
                        "expression with {}"
                    ),
                },
                _select("query_language", "DQL or Query DSL"),
                {
                    "name": "query",
                    "type": ["string", "map"],
                    "default": "",
                    "template_escape": {
                        "by": "query_language",
                        "rules": {"dql": "dql", "query_dsl": "json"},
                        "default": "dql",
                    },
                    "description": (
                        "A DQL line or the query part of a Query DSL request; with {}, an "
                        "expression that gives the query; empty means no filter"
                    ),
                },
                _select(
                    "mode",
                    "Search returns the matching documents; Aggregate returns numbers worked "
                    "out from them",
                ),
                {
                    "name": "fields",
                    "type": "array",
                    "default": [{"value": "@timestamp"}],
                    "show_when": _SEARCH,
                    "description": (
                        "The fields that come back, one column each, in this order; nested "
                        "fields with dots, such as user.name. Empty returns the whole document "
                        "as one column"
                    ),
                },
                {
                    "name": "max_results",
                    "type": "integer",
                    "default": 10000,
                    "minimum": 0,
                    "show_when": _SEARCH,
                    "description": "Lines Results keeps; 0 keeps every line",
                },
                _select(
                    "group_by_time",
                    "No, or Every 10 seconds, 30 seconds, 1 minute, 5 minutes, 15 minutes or "
                    "1 hour",
                    show_when=_AGGREGATE,
                ),
                {
                    "name": "group_by_field",
                    "type": "string",
                    "default": "",
                    "trim": True,
                    "show_when": _AGGREGATE,
                    "description": "A field whose values each get their own rows",
                },
                {
                    "name": "top_values",
                    "type": "integer",
                    "default": 10,
                    "minimum": 1,
                    "show_when": _AGGREGATE,
                    "description": "How many of the grouped field's most common values get rows",
                },
                {
                    "name": "stats",
                    "type": "array",
                    "default": [{"value": {"stat": "count"}}],
                    "show_when": _AGGREGATE,
                    "description": (
                        "The numbers to work out, one column each: Count, Sum, Average, Min, "
                        "Max, Percentile, Unique count, Increase or Custom (JSON)"
                    ),
                },
                timeout_parameter(
                    300,
                    "Seconds for the whole block, paging included; when it runs out the "
                    "search is ended on the cluster",
                ),
                {
                    "name": "sort_by",
                    "type": "string",
                    "default": "",
                    "trim": True,
                    "show_when": _SEARCH,
                    "description": "The field to sort on; any sortable field",
                },
                _select("order", "Newest first or Oldest first", show_when=_SEARCH),
                {"name": "username", "type": "string", "description": "Login name"},
                {
                    "name": "password",
                    "type": "string",
                    "secret": True,
                    "description": "A secret, masked everywhere",
                },
                {
                    "name": "api_key",
                    "type": "string",
                    "secret": True,
                    "description": "An API key the cluster issued; a secret",
                },
                {
                    "name": "bearer_token",
                    "type": "string",
                    "secret": True,
                    "description": "A token such as a JSON Web Token; a secret",
                },
                {
                    "name": "verify_ssl",
                    "type": "boolean",
                    "default": True,
                    "description": (
                        "Verify the server certificate: against CA Certificate when it is set, "
                        "otherwise against the certificates WAVE trusts "
                        "(Settings > Network > Certificates)"
                    ),
                },
                {
                    "name": "ca_cert",
                    "type": "string",
                    "description": (
                        "CA certificate (file path, variable reference, or PEM string); when set, "
                        "it is the only certificate this block trusts"
                    ),
                },
                {
                    "name": "client_cert",
                    "type": "string",
                    "description": (
                        "Client certificate for mutual TLS (file path, variable reference, or "
                        "PEM string)"
                    ),
                },
                {
                    "name": "client_key",
                    "type": "string",
                    "secret": True,
                    "description": (
                        "Private key for the client certificate (file path or PEM string)"
                    ),
                },
                {
                    "name": "time_field",
                    "type": "string",
                    "default": "@timestamp",
                    "trim": True,
                    "description": "The date field the window reads",
                },
                {
                    "name": "connect_timeout",
                    "type": "integer",
                    "default": 30,
                    "minimum": 1,
                    "description": (
                        "Seconds to wait for the cluster to accept the connection and finish "
                        "the TLS handshake"
                    ),
                },
                on_error_parameter(
                    "Fail the block, or record the outcome and let the test continue."
                ),
            ],
            "return_type": "map",
            "output_schema": [
                success,
                {
                    "name": "results",
                    "type": "table",
                    "description": (
                        "A table. Search: one row per matching document and one column per "
                        "entry in Fields. Aggregate: one row per time slot and / or field value, "
                        "or one row for the whole window, with one column per stat."
                    ),
                },
                {
                    "name": "total_results",
                    "type": "integer",
                    "description": (
                        "The exact number of matching documents, whatever Max results says."
                    ),
                },
                error,
                reason,
            ],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Refuse a misconfigured block, checking only the rows in effect (REQ-3.4.1.15)."""
        searching = _choice(params, "mode") == "search"
        _choice(params, "query_language")
        _choice(params, "on_error")
        _choice(params, "order" if searching else "group_by_time")
        for name in ("url", "index"):
            if blank(params.get(name)):
                raise ValueError(f"Missing required parameter: {name}")
        for name in ("timeout", "connect_timeout", "max_results" if searching else "top_values"):
            check_integer(params, name)
        check_boolean(params, "verify_ssl")
        check_at_least(params, "timeout", 1, "Timeout must be at least 1")
        check_at_least(params, "connect_timeout", 1, "Connect timeout must be at least 1")
        if searching:
            check_at_least(params, "max_results", 0, "Max results must be 0 or more")
        else:
            check_at_least(params, "top_values", 1, "Top values must be at least 1")
        rows = "fields" if searching else "stats"
        value = params.get(rows)
        if value is not None and not isinstance(value, list):
            raise ValueError(f"Parameter '{rows}' must be a list")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the block's core off the event loop; Stop and Timeout shut its connection down."""
        return await run_verb(_opensearch_core.run, context["parameters"], context, prepare=prepare)
