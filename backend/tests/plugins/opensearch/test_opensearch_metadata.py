"""OpenSearch block metadata: identity, backend parameter keys and outputs (REQ-3.4.1.15, OS-1)."""

from typing import Any

import pytest

from tests.plugins.opensearch.conftest import BLOCK_DEFAULTS
from wavecore.plugins._shared_params import on_error_parameter, output_core, timeout_parameter
from wavecore.plugins.opensearch import OpenSearchPlugin

PARAM_ORDER = [
    "url",
    "index",
    "from",
    "to",
    "query_language",
    "query",
    "mode",
    "fields",
    "max_results",
    "group_by_time",
    "group_by_field",
    "top_values",
    "stats",
    "timeout",
    "sort_by",
    "order",
    "username",
    "password",
    "api_key",
    "bearer_token",
    "verify_ssl",
    "ca_cert",
    "client_cert",
    "client_key",
    "time_field",
    "connect_timeout",
    "on_error",
]

SEARCH = {"field": "mode", "values": ["search"]}
AGGREGATE = {"field": "mode", "values": ["aggregate"]}
RECORD_GATE = {"field": "on_error", "values": ["record"]}
TEMPLATE_ESCAPE = {
    "by": "query_language",
    "rules": {"dql": "dql", "query_dsl": "json"},
    "default": "dql",
}
GROUP_BY_TIME = ["none", "10s", "30s", "1m", "5m", "15m", "1h"]

# Every key beyond name and description, per parameter.
PARAM_KEYS: dict[str, dict[str, Any]] = {
    "url": {"type": "string", "required": True, "trim": True},
    "index": {"type": "string", "required": True, "trim": True},
    "from": {"type": ["string", "integer"], "default": "now-15m", "trim": True},
    "to": {"type": ["string", "integer"], "default": "now", "trim": True},
    "query_language": {"type": "string", "default": "dql", "enum_values": ["dql", "query_dsl"]},
    "query": {"type": ["string", "map"], "default": "", "template_escape": TEMPLATE_ESCAPE},
    "mode": {"type": "string", "default": "search", "enum_values": ["search", "aggregate"]},
    "fields": {"type": "array", "default": [{"value": "@timestamp"}], "show_when": SEARCH},
    "max_results": {"type": "integer", "default": 10000, "minimum": 0, "show_when": SEARCH},
    "group_by_time": {
        "type": "string",
        "default": "1m",
        "enum_values": GROUP_BY_TIME,
        "show_when": AGGREGATE,
    },
    "group_by_field": {"type": "string", "default": "", "trim": True, "show_when": AGGREGATE},
    "top_values": {"type": "integer", "default": 10, "minimum": 1, "show_when": AGGREGATE},
    "stats": {
        "type": "array",
        "default": [{"value": {"stat": "count"}}],
        "show_when": AGGREGATE,
    },
    "timeout": {"type": "integer", "required": False, "default": 300, "minimum": 1},
    "sort_by": {"type": "string", "default": "", "trim": True, "show_when": SEARCH},
    "order": {
        "type": "string",
        "default": "desc",
        "enum_values": ["desc", "asc"],
        "show_when": SEARCH,
    },
    "username": {"type": "string"},
    "password": {"type": "string", "secret": True},
    "api_key": {"type": "string", "secret": True},
    "bearer_token": {"type": "string", "secret": True},
    "verify_ssl": {"type": "boolean", "default": True},
    "ca_cert": {"type": "string"},
    "client_cert": {"type": "string"},
    "client_key": {"type": "string", "secret": True},
    "time_field": {"type": "string", "default": "@timestamp", "trim": True},
    "connect_timeout": {"type": "integer", "default": 30, "minimum": 1},
    "on_error": {
        "type": "string",
        "required": False,
        "default": "fail",
        "enum_values": ["fail", "record"],
    },
}

# Each row's description is the frontend descriptor's.
DESCRIPTIONS = {
    "url": "The cluster's REST address with scheme and port: https://opensearch.internal:9200",
    "index": (
        "Where to look: one index, a wildcard such as logs-*, a comma list, exclusions with a "
        "leading minus, an alias, a data stream, or a date-math name such as <logs-{now/d}> for "
        "today's daily index. Sent as written; OpenSearch resolves it"
    ),
    "from": "Start of the window: Absolute, Relative or Now, or a variable or expression with {}",
    "to": "End of the window: Absolute, Relative or Now, or a variable or expression with {}",
    "query_language": "DQL or Query DSL",
    "query": (
        "A DQL line or the query part of a Query DSL request; with {}, an expression that gives "
        "the query; empty means no filter"
    ),
    "mode": "Search returns the matching documents; Aggregate returns numbers worked out from them",
    "fields": (
        "The fields that come back, one column each, in this order; nested fields with dots, "
        "such as user.name. Empty returns the whole document as one column"
    ),
    "max_results": "Lines Results keeps; 0 keeps every line",
    "group_by_time": (
        "No, or Every 10 seconds, 30 seconds, 1 minute, 5 minutes, 15 minutes or 1 hour"
    ),
    "group_by_field": "A field whose values each get their own rows",
    "top_values": "How many of the grouped field's most common values get rows",
    "stats": (
        "The numbers to work out, one column each: Count, Sum, Average, Min, Max, Percentile, "
        "Unique count, Increase or Custom (JSON)"
    ),
    "timeout": (
        "Seconds for the whole block, paging included; when it runs out the search is ended on "
        "the cluster"
    ),
    "sort_by": "The field to sort on; any sortable field",
    "order": "Newest first or Oldest first",
    "username": "Login name",
    "password": "A secret, masked everywhere",
    "api_key": "An API key the cluster issued; a secret",
    "bearer_token": "A token such as a JSON Web Token; a secret",
    "verify_ssl": (
        "Verify the server certificate: against CA Certificate when it is set, otherwise "
        "against the certificates WAVE trusts (Settings > Network > Certificates)"
    ),
    "ca_cert": (
        "CA certificate (file path, variable reference, or PEM string); when set, it is the "
        "only certificate this block trusts"
    ),
    "client_cert": (
        "Client certificate for mutual TLS (file path, variable reference, or PEM string)"
    ),
    "client_key": "Private key for the client certificate (file path or PEM string)",
    "time_field": "The date field the window reads",
    "connect_timeout": (
        "Seconds to wait for the cluster to accept the connection and finish the TLS handshake"
    ),
    "on_error": "Fail the block, or record the outcome and let the test continue.",
}

FRONTEND_ONLY_KEYS = {
    "group",
    "label",
    "enum_labels",
    "placeholder",
    "allowedFormats",
    "noExpression",
    "retainOnHide",
    "fieldSuggest",
    "timeValue",
    "templateByDefault",
    "rowNote",
    "orderedList",
}

OUTPUTS = [
    ("success", "boolean"),
    ("results", "table"),
    ("total_results", "integer"),
    ("error", "string"),
    ("reason", "string"),
]
OUTPUT_ORDER = [name for name, _ in OUTPUTS]
REASON_DESCRIPTION = (
    "Why the block failed: Unreachable, AuthFailed, RequestFailed, Timeout or Validation; "
    "empty otherwise"
)
OUTPUT_DESCRIPTIONS = {
    "results": (
        "A table. Search: one row per matching document and one column per entry in Fields. "
        "Aggregate: one row per time slot and / or field value, or one row for the whole window, "
        "with one column per stat."
    ),
    "total_results": "The exact number of matching documents, whatever Max results says.",
    "reason": REASON_DESCRIPTION,
}


def _parameters() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in OpenSearchPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in OpenSearchPlugin().metadata["output_schema"]}


def _without_description(entry: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in entry.items() if key != "description"}


class TestOpenSearchIdentity:
    """Identity, remotability and the secret catalog (REQ-3.4.1.15)."""

    def test_identity_fields(self) -> None:
        meta = OpenSearchPlugin().metadata
        identity = {
            key: meta.get(key)
            for key in ("id", "name", "version", "category", "remotable", "return_type")
        }

        assert identity == {
            "id": "opensearch",
            "name": "OpenSearch",
            "version": "1.0.0",
            "category": "database",
            "remotable": True,
            "return_type": "map",
        }
        assert meta["remotable"] is True

    def test_tags(self) -> None:
        assert OpenSearchPlugin().metadata["tags"] == [
            "opensearch",
            "search",
            "logs",
            "dql",
            "database",
        ]

    def test_description_says_the_block_only_reads(self) -> None:
        assert OpenSearchPlugin().metadata["description"] == (
            "Reads what the application under test sent to OpenSearch: matching documents in "
            "Search mode, numbers worked out from them in Aggregate mode. Never writes."
        )

    def test_secret_mask_fields_name_the_four_secret_rows(self) -> None:
        assert OpenSearchPlugin().metadata["secret_mask_fields"] == [
            "password",
            "api_key",
            "bearer_token",
            "client_key",
        ]

    def test_every_secret_row_is_in_the_secret_catalog(self) -> None:
        meta = OpenSearchPlugin().metadata
        secret_rows = [p["name"] for p in meta["parameters"] if p.get("secret") is True]

        assert secret_rows == meta["secret_mask_fields"]

    def test_metadata_builds_the_plugin_model(self) -> None:
        model = OpenSearchPlugin().get_plugin_model()

        assert model.id == "opensearch"
        assert model.version == "1.0.0"
        assert model.category == "database"
        assert [p.name for p in model.parameters] == PARAM_ORDER
        assert [o.name for o in model.outputs] == OUTPUT_ORDER


class TestOpenSearchParameters:
    """Every parameter row carries exactly the backend keys of its wire contract (OS-1, OS-2)."""

    def test_parameter_order(self) -> None:
        params = OpenSearchPlugin().metadata["parameters"]

        assert [p["name"] for p in params] == PARAM_ORDER

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_parameter_type(self, name: str) -> None:
        assert _parameters()[name]["type"] == PARAM_KEYS[name]["type"]

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_exact_key_set(self, name: str) -> None:
        expected = {"name": name, **PARAM_KEYS[name]}

        assert _without_description(_parameters()[name]) == expected

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_description(self, name: str) -> None:
        assert _parameters()[name]["description"] == DESCRIPTIONS[name]

    def test_defaults_are_the_block_defaults(self) -> None:
        defaults = {name: p["default"] for name, p in _parameters().items() if "default" in p}

        assert defaults == BLOCK_DEFAULTS

    def test_rows_without_a_default(self) -> None:
        bare = [name for name, p in _parameters().items() if "default" not in p]

        assert bare == [
            "url",
            "index",
            "username",
            "password",
            "api_key",
            "bearer_token",
            "ca_cert",
            "client_cert",
            "client_key",
        ]

    def test_cluster_url_and_index_pattern_are_the_required_rows(self) -> None:
        required = [name for name, p in _parameters().items() if p.get("required") is True]

        assert required == ["url", "index"]

    def test_trimmed_rows(self) -> None:
        trimmed = [name for name, p in _parameters().items() if p.get("trim") is True]

        assert trimmed == [
            "url",
            "index",
            "from",
            "to",
            "group_by_field",
            "sort_by",
            "time_field",
        ]

    @pytest.mark.parametrize(
        ("name", "values"),
        [
            ("query_language", ["dql", "query_dsl"]),
            ("mode", ["search", "aggregate"]),
            ("group_by_time", GROUP_BY_TIME),
            ("order", ["desc", "asc"]),
            ("on_error", ["fail", "record"]),
        ],
    )
    def test_select_values_in_order(self, name: str, values: list[str]) -> None:
        assert _parameters()[name]["enum_values"] == values

    def test_only_the_selects_carry_enum_values(self) -> None:
        selects = [name for name, p in _parameters().items() if "enum_values" in p]

        assert selects == ["query_language", "mode", "group_by_time", "order", "on_error"]

    def test_search_rows_show_in_search_only(self) -> None:
        shown = [name for name, p in _parameters().items() if p.get("show_when") == SEARCH]

        assert shown == ["fields", "max_results", "sort_by", "order"]

    def test_aggregate_rows_show_in_aggregate_only(self) -> None:
        shown = [name for name, p in _parameters().items() if p.get("show_when") == AGGREGATE]

        assert shown == ["group_by_time", "group_by_field", "top_values", "stats"]

    def test_no_other_row_is_gated(self) -> None:
        gated = {name for name, p in _parameters().items() if "show_when" in p}

        assert gated == {
            "fields",
            "max_results",
            "sort_by",
            "order",
            "group_by_time",
            "group_by_field",
            "top_values",
            "stats",
        }

    def test_mode_and_query_language_are_never_gated(self) -> None:
        params = _parameters()

        assert "show_when" not in params["mode"]
        assert "show_when" not in params["query_language"]

    def test_query_escapes_template_values_by_query_language(self) -> None:
        assert _parameters()["query"]["template_escape"] == TEMPLATE_ESCAPE

    def test_only_query_carries_a_template_escape(self) -> None:
        escaped = [name for name, p in _parameters().items() if "template_escape" in p]

        assert escaped == ["query"]

    @pytest.mark.parametrize(
        ("name", "minimum"),
        [("max_results", 0), ("top_values", 1), ("timeout", 1), ("connect_timeout", 1)],
    )
    def test_integer_floors(self, name: str, minimum: int) -> None:
        assert _parameters()[name]["minimum"] == minimum

    @pytest.mark.parametrize(
        ("name", "shared"),
        [
            ("timeout", {**timeout_parameter(300, "-"), "minimum": 1}),
            ("on_error", on_error_parameter("-")),
        ],
    )
    def test_shared_rows_keep_the_shared_shape(self, name: str, shared: dict[str, Any]) -> None:
        assert _without_description(_parameters()[name]) == _without_description(shared)

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_no_frontend_only_key(self, name: str) -> None:
        assert FRONTEND_ONLY_KEYS.isdisjoint(_parameters()[name])


class TestOpenSearchOutputs:
    """Success, Results and Total results in both modes; Error and Reason under Record (OS-11)."""

    def test_output_order(self) -> None:
        outputs = OpenSearchPlugin().metadata["output_schema"]

        assert [o["name"] for o in outputs] == OUTPUT_ORDER

    @pytest.mark.parametrize(("name", "expected"), OUTPUTS)
    def test_output_type(self, name: str, expected: str) -> None:
        assert _outputs()[name]["type"] == expected

    @pytest.mark.parametrize("name", ["error", "reason"])
    def test_error_and_reason_show_under_record(self, name: str) -> None:
        assert _outputs()[name]["show_when"] == RECORD_GATE

    @pytest.mark.parametrize("name", ["success", "results", "total_results"])
    def test_outputs_of_both_modes_carry_no_show_when(self, name: str) -> None:
        assert "show_when" not in _outputs()[name]

    @pytest.mark.parametrize(("name", "description"), list(OUTPUT_DESCRIPTIONS.items()))
    def test_output_description(self, name: str, description: str) -> None:
        assert _outputs()[name]["description"] == description

    def test_success_error_and_reason_keep_the_shared_shape(self) -> None:
        shared = {
            entry["name"]: _without_description(entry)
            for entry in output_core(gated=True, success_description="-", reason_description="-")
        }

        for name in ("success", "error", "reason"):
            assert _without_description(_outputs()[name]) == shared[name], name

    @pytest.mark.parametrize("name", ["success", "error"])
    def test_success_and_error_have_a_description(self, name: str) -> None:
        description = _outputs()[name]["description"]

        assert isinstance(description, str) and description.strip()

    @pytest.mark.parametrize("name", OUTPUT_ORDER)
    def test_output_entry_keys(self, name: str) -> None:
        allowed = {"name", "type", "description", "show_when"}

        assert set(_outputs()[name]) <= allowed
