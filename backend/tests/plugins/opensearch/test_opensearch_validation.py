"""OpenSearch validate(): the static checks for the rows in effect, in check order.

validate() raises ValueError whatever On error says; every other refusal belongs to the run
(REQ-3.4.1.15, REQ-3.3.2.5).
"""

from typing import Any

import pytest

from tests.plugins.opensearch.conftest import exact, os_params
from wavecore.plugins.opensearch import OpenSearchPlugin

ABSENT: Any = object()

# Validation fails the block whatever On error says.
ON_ERROR = pytest.mark.parametrize("on_error", ["fail", "record"])


def shaped(base: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """The base parameter set with overrides applied; an ABSENT override removes the key."""
    merged = {**base, **overrides}
    return {key: value for key, value in merged.items() if value is not ABSENT}


def search(**overrides: Any) -> dict[str, Any]:
    """A valid Search block."""
    return shaped(os_params(), **overrides)


def aggregate(**overrides: Any) -> dict[str, Any]:
    """A valid Aggregate block."""
    return shaped(os_params(mode="aggregate"), **overrides)


async def refuses(message: str, params: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match=exact(message)):
        await OpenSearchPlugin().validate(params)


async def passes(params: dict[str, Any]) -> None:
    assert await OpenSearchPlugin().validate(params) is None


def blank_values() -> list[Any]:
    """Absent, None, empty and spaces, each with a readable id."""
    return [
        pytest.param(ABSENT, id="absent"),
        pytest.param(None, id="none"),
        pytest.param("", id="empty"),
        pytest.param("   ", id="spaces"),
    ]


class TestChoices:
    """Each select holds one of its wire values while its row is in effect."""

    @ON_ERROR
    @pytest.mark.parametrize(
        ("params", "name", "value", "values"),
        [
            pytest.param(search(), "mode", "count", "search, aggregate", id="mode"),
            pytest.param(
                search(), "query_language", "lucene", "dql, query_dsl", id="query_language"
            ),
            pytest.param(search(), "on_error", "ignore", "fail, record", id="on_error"),
            pytest.param(search(), "order", "newest", "desc, asc", id="order-in-search"),
            pytest.param(
                aggregate(),
                "group_by_time",
                "2m",
                "none, 10s, 30s, 1m, 5m, 15m, 1h",
                id="group_by_time-in-aggregate",
            ),
            pytest.param(
                aggregate(), "query_language", "sql", "dql, query_dsl", id="language-in-aggregate"
            ),
        ],
    )
    async def test_value_outside_its_choices(
        self, params: dict[str, Any], name: str, value: str, values: str, on_error: str
    ) -> None:
        overrides = {name: value} if name == "on_error" else {name: value, "on_error": on_error}

        await refuses(
            f"Parameter '{name}' must be one of: {values}; Actual value was '{value}'.",
            shaped(params, **overrides),
        )

    async def test_the_pinned_mode_message(self) -> None:
        await refuses(
            "Parameter 'mode' must be one of: search, aggregate; Actual value was 'count'.",
            search(mode="count"),
        )

    async def test_a_long_value_is_shown_by_its_length(self) -> None:
        await refuses(
            "Parameter 'mode' must be one of: search, aggregate; "
            "Actual value was a 60-character value.",
            search(mode="x" * 60),
        )

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(aggregate(order="newest"), id="order-in-aggregate"),
            pytest.param(search(group_by_time="2m"), id="group_by_time-in-search"),
        ],
    )
    async def test_a_select_whose_row_is_hidden_is_not_checked(
        self, params: dict[str, Any]
    ) -> None:
        await passes(params)


class TestRequiredRows:
    """Cluster URL and Index pattern are required in both modes (REQ-3.3.2.5)."""

    @ON_ERROR
    @pytest.mark.parametrize("mode", ["search", "aggregate"])
    @pytest.mark.parametrize("value", blank_values())
    async def test_url_missing_or_blank(self, mode: str, value: Any, on_error: str) -> None:
        await refuses(
            "Missing required parameter: url", search(mode=mode, url=value, on_error=on_error)
        )

    @ON_ERROR
    @pytest.mark.parametrize("mode", ["search", "aggregate"])
    @pytest.mark.parametrize("value", blank_values())
    async def test_index_missing_or_blank(self, mode: str, value: Any, on_error: str) -> None:
        await refuses(
            "Missing required parameter: index",
            search(mode=mode, index=value, on_error=on_error),
        )

    async def test_url_is_named_before_index(self) -> None:
        await refuses("Missing required parameter: url", search(url="", index=""))

    @pytest.mark.parametrize(
        "name",
        ["username", "password", "api_key", "bearer_token", "ca_cert", "client_cert", "client_key"],
    )
    async def test_the_optional_rows_may_be_blank(self, name: str) -> None:
        await passes(search(**{name: ""}))


INTEGER_ROWS = [
    pytest.param(search(), "timeout", id="timeout-in-search"),
    pytest.param(aggregate(), "timeout", id="timeout-in-aggregate"),
    pytest.param(search(), "connect_timeout", id="connect_timeout-in-search"),
    pytest.param(aggregate(), "connect_timeout", id="connect_timeout-in-aggregate"),
    pytest.param(search(), "max_results", id="max_results-in-search"),
    pytest.param(aggregate(), "top_values", id="top_values-in-aggregate"),
]


class TestValueTypes:
    """Integer rows hold integers and Verify Server Certificate a boolean."""

    @ON_ERROR
    @pytest.mark.parametrize(("params", "name"), INTEGER_ROWS)
    @pytest.mark.parametrize(
        "value", ["10", 1.5, True, False], ids=["text", "float", "true", "false"]
    )
    async def test_integer_row_not_an_integer(
        self, params: dict[str, Any], name: str, value: Any, on_error: str
    ) -> None:
        await refuses(
            f"Parameter '{name}' must be an integer",
            shaped(params, on_error=on_error, **{name: value}),
        )

    async def test_the_pinned_integer_message(self) -> None:
        await refuses("Parameter 'max_results' must be an integer", search(max_results="all"))

    @ON_ERROR
    @pytest.mark.parametrize("mode", ["search", "aggregate"])
    @pytest.mark.parametrize(
        "value", ["yes", "true", 1, 0], ids=["yes", "true-text", "one", "zero"]
    )
    async def test_verify_ssl_not_a_boolean(self, mode: str, value: Any, on_error: str) -> None:
        await refuses(
            "Parameter 'verify_ssl' must be a boolean",
            search(mode=mode, verify_ssl=value, on_error=on_error),
        )

    async def test_verify_ssl_is_checked_on_a_plain_http_url(self) -> None:
        await refuses(
            "Parameter 'verify_ssl' must be a boolean",
            search(url="http://opensearch.internal:9200", verify_ssl="no"),
        )

    @pytest.mark.parametrize("value", [True, False])
    async def test_verify_ssl_either_way_passes(self, value: bool) -> None:
        await passes(search(verify_ssl=value))


class TestBounds:
    """Timeout, Connect timeout, Max results and Top values stay in range."""

    @ON_ERROR
    @pytest.mark.parametrize("mode", ["search", "aggregate"])
    @pytest.mark.parametrize("value", [0, -5])
    async def test_timeout_below_one(self, mode: str, value: int, on_error: str) -> None:
        await refuses(
            "Timeout must be at least 1", search(mode=mode, timeout=value, on_error=on_error)
        )

    @ON_ERROR
    @pytest.mark.parametrize("mode", ["search", "aggregate"])
    @pytest.mark.parametrize("value", [0, -1])
    async def test_connect_timeout_below_one(self, mode: str, value: int, on_error: str) -> None:
        await refuses(
            "Connect timeout must be at least 1",
            search(mode=mode, connect_timeout=value, on_error=on_error),
        )

    @ON_ERROR
    @pytest.mark.parametrize("value", [-1, -10000])
    async def test_max_results_below_zero_in_search(self, value: int, on_error: str) -> None:
        await refuses("Max results must be 0 or more", search(max_results=value, on_error=on_error))

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -1])
    async def test_top_values_below_one_in_aggregate(self, value: int, on_error: str) -> None:
        await refuses(
            "Top values must be at least 1", aggregate(top_values=value, on_error=on_error)
        )

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(search(max_results=0), id="max-results-zero-keeps-every-line"),
            pytest.param(search(timeout=1, connect_timeout=1), id="timeouts-at-one"),
            pytest.param(aggregate(top_values=1), id="top-values-one"),
            pytest.param(search(max_results=50000), id="max-results-past-ten-thousand"),
            pytest.param(search(timeout=86400), id="a-long-timeout"),
        ],
    )
    async def test_the_allowed_values_pass(self, params: dict[str, Any]) -> None:
        await passes(params)


class TestLists:
    """Fields in Search and Stats in Aggregate are lists."""

    @ON_ERROR
    @pytest.mark.parametrize(
        "value",
        ["@timestamp", {"value": "@timestamp"}, 5],
        ids=["text", "map", "integer"],
    )
    async def test_fields_not_a_list_in_search(self, value: Any, on_error: str) -> None:
        await refuses("Parameter 'fields' must be a list", search(fields=value, on_error=on_error))

    @ON_ERROR
    @pytest.mark.parametrize(
        "value",
        ["count", {"value": {"stat": "count"}}, 5],
        ids=["text", "map", "integer"],
    )
    async def test_stats_not_a_list_in_aggregate(self, value: Any, on_error: str) -> None:
        await refuses("Parameter 'stats' must be a list", aggregate(stats=value, on_error=on_error))

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(search(fields=[]), id="empty-fields-is-the-whole-document"),
            pytest.param(search(fields=["@timestamp", "message"]), id="fields-as-names"),
            pytest.param(aggregate(stats=[{"stat": "count"}]), id="stats-as-stat-maps"),
        ],
    )
    async def test_lists_pass(self, params: dict[str, Any]) -> None:
        await passes(params)


class TestRowsInEffect:
    """A row hidden by Mode is not validated."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(aggregate(max_results="all"), id="max-results-text-in-aggregate"),
            pytest.param(aggregate(max_results=-1), id="max-results-below-zero-in-aggregate"),
            pytest.param(search(top_values="ten"), id="top-values-text-in-search"),
            pytest.param(search(top_values=0), id="top-values-zero-in-search"),
            pytest.param(aggregate(fields="@timestamp"), id="fields-text-in-aggregate"),
            pytest.param(search(stats="count"), id="stats-text-in-search"),
            pytest.param(aggregate(order="newest"), id="order-in-aggregate"),
            pytest.param(search(group_by_time="2m"), id="group-by-time-in-search"),
        ],
    )
    async def test_hidden_row_passes(self, params: dict[str, Any]) -> None:
        await passes(params)


class TestRunChecksAreLeftToTheRun:
    """What only the core refuses passes validate(), so it follows On error."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(search(url="ftp://opensearch.internal:9200"), id="url-scheme"),
            pytest.param(search(url="https://:9200"), id="url-without-a-host"),
            pytest.param(search(url="https://wave:s3cr3t@opensearch.internal:9200"), id="url-user"),
            pytest.param(search(url="https://opensearch.internal:9200/?pretty"), id="url-query"),
            pytest.param(search(url="https://opensearch.internal:0"), id="url-port"),
            pytest.param(search(username="wave", api_key="os_key"), id="two-credentials"),
            pytest.param(search(password="s3cr3t"), id="password-without-username"),
            pytest.param(search(**{"from": 1790332925}), id="from-in-epoch-seconds"),
            pytest.param(search(to="yesterday"), id="to-not-a-time"),
            pytest.param(search(query="log.level:"), id="dql-does-not-parse"),
            pytest.param(
                search(query_language="query_dsl", query="[1]"), id="query-dsl-not-an-object"
            ),
            pytest.param(search(fields=[{"value": ""}]), id="blank-fields-entry"),
            pytest.param(aggregate(stats=[]), id="empty-stats"),
            pytest.param(aggregate(stats=[{"value": {"stat": "median"}}]), id="unknown-stat"),
            pytest.param(
                aggregate(stats=[{"value": {"stat": "count"}}, {"value": {"stat": "count"}}]),
                id="duplicate-stat-columns",
            ),
            pytest.param(aggregate(time_field="log.level"), id="time-field-is-checked-per-run"),
        ],
    )
    async def test_passes_validate(self, params: dict[str, Any]) -> None:
        await passes(params)


class TestCheckOrder:
    """With two faults the earlier check names the message."""

    @pytest.mark.parametrize(
        ("params", "message"),
        [
            pytest.param(
                search(on_error="ignore", url=""),
                "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'.",
                id="choice-before-url",
            ),
            pytest.param(
                search(url="", index=""),
                "Missing required parameter: url",
                id="url-before-index",
            ),
            pytest.param(
                search(index="", timeout="soon"),
                "Missing required parameter: index",
                id="index-before-type",
            ),
            pytest.param(
                search(timeout="soon", verify_ssl="yes"),
                "Parameter 'timeout' must be an integer",
                id="integer-before-boolean",
            ),
            pytest.param(
                search(verify_ssl="yes", timeout=0),
                "Parameter 'verify_ssl' must be a boolean",
                id="boolean-before-timeout",
            ),
            pytest.param(
                search(timeout=0, connect_timeout=0),
                "Timeout must be at least 1",
                id="timeout-before-connect-timeout",
            ),
            pytest.param(
                search(connect_timeout=0, max_results=-1),
                "Connect timeout must be at least 1",
                id="connect-timeout-before-max-results",
            ),
            pytest.param(
                search(max_results=-1, fields="@timestamp"),
                "Max results must be 0 or more",
                id="max-results-before-fields",
            ),
            pytest.param(
                aggregate(top_values=0, stats="count"),
                "Top values must be at least 1",
                id="top-values-before-stats",
            ),
            pytest.param(
                search(timeout="soon", connect_timeout=0),
                "Parameter 'timeout' must be an integer",
                id="type-before-bound",
            ),
            pytest.param(
                search(max_results=-1, url="ftp://opensearch.internal:9200"),
                "Max results must be 0 or more",
                id="a-static-fault-with-a-run-fault",
            ),
        ],
    )
    async def test_the_earlier_check_wins(self, params: dict[str, Any], message: str) -> None:
        await refuses(message, params)


class TestValidConfigurations:
    """Complete blocks pass; absent or None settings take their defaults."""

    @pytest.mark.parametrize("mode", ["search", "aggregate"])
    @pytest.mark.parametrize("language", ["dql", "query_dsl"])
    async def test_a_clean_block_passes(self, mode: str, language: str) -> None:
        await passes(search(mode=mode, query_language=language))

    async def test_every_search_row_set(self) -> None:
        params = search(
            **{"from": "2026-09-25T10:00:00Z", "to": 1790332925000},
            query_language="dql",
            query='log.level: ERROR and message: "Load test finished"',
            fields=[{"value": "@timestamp"}, {"value": "message"}],
            max_results=500,
            timeout=60,
            sort_by="latency_ms",
            order="asc",
            username="wave",
            password="s3cr3t",
            verify_ssl=False,
            ca_cert="/etc/ssl/ca.pem",
            client_cert="/etc/ssl/client.pem",
            client_key="/etc/ssl/client.key",
            time_field="event.created",
            connect_timeout=5,
            on_error="record",
        )

        await passes(params)

    async def test_every_aggregate_row_set(self) -> None:
        params = aggregate(
            **{"from": "now-1h", "to": "now"},
            query_language="query_dsl",
            query={"term": {"log.level": "ERROR"}},
            group_by_time="5m",
            group_by_field="service.name",
            top_values=5,
            stats=[
                {"value": {"stat": "count"}},
                {"value": {"stat": "percentile", "field": "latency_ms", "percent": 95}},
            ],
            api_key="os_key",
            timeout=120,
        )

        await passes(params)

    @pytest.mark.parametrize("value", ["none", "10s", "30s", "1m", "5m", "15m", "1h"])
    async def test_each_group_by_time(self, value: str) -> None:
        await passes(aggregate(group_by_time=value))

    @pytest.mark.parametrize("value", ["desc", "asc"])
    async def test_each_order(self, value: str) -> None:
        await passes(search(order=value))

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(
                search(
                    **{"from": None, "to": None},
                    query_language=None,
                    query=None,
                    mode=None,
                    fields=None,
                    max_results=None,
                    timeout=None,
                    sort_by=None,
                    order=None,
                    verify_ssl=None,
                    time_field=None,
                    connect_timeout=None,
                    on_error=None,
                ),
                id="none-search-rows",
            ),
            pytest.param(
                aggregate(group_by_time=None, group_by_field=None, top_values=None, stats=None),
                id="none-aggregate-rows",
            ),
        ],
    )
    async def test_none_settings_take_their_defaults(self, params: dict[str, Any]) -> None:
        await passes(params)
