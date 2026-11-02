"""SQL block metadata: identity, backend parameter keys and outputs (REQ-3.4.1.6, SQL-8, SQL-9)."""

from typing import Any

import pytest

from wavecore.plugins._shared_params import on_error_parameter, output_core, timeout_parameter
from wavecore.plugins.sql_client import SQLClientPlugin

PARAM_ORDER = [
    "operation",
    "database_type",
    "host",
    "port",
    "database",
    "username",
    "password",
    "file",
    "script_type",
    "sql",
    "sql_file",
    "parameters",
    "stop_on_error",
    "procedure",
    "arguments",
    "out_arguments",
    "table",
    "target_table",
    "mode",
    "key_columns",
    "commit_each_batch",
    "timeout",
    "tls",
    "verify_ssl",
    "ca_cert",
    "client_cert",
    "client_key",
    "connect_timeout",
    "max_rows",
    "driver_options",
    "batch_size",
    "on_error",
]

INTEGER_PARAMS = {"port", "timeout", "connect_timeout", "max_rows", "batch_size"}
BOOLEAN_PARAMS = {"stop_on_error", "commit_each_batch", "tls", "verify_ssl"}
MAP_PARAMS = {"parameters", "arguments", "driver_options"}
ARRAY_PARAMS = {"out_arguments"}
TABLE_PARAMS = {"table"}


def _param_type(name: str) -> str:
    for kind, names in (
        ("integer", INTEGER_PARAMS),
        ("boolean", BOOLEAN_PARAMS),
        ("map", MAP_PARAMS),
        ("array", ARRAY_PARAMS),
        ("table", TABLE_PARAMS),
    ):
        if name in names:
            return kind
    return "string"


PARAM_TYPES = {name: _param_type(name) for name in PARAM_ORDER}

NET = {"field": "database_type", "values": ["postgresql", "mysql", "oracle", "mssql"]}
SQLITE = {"field": "database_type", "values": ["sqlite"]}
RUN = {"field": "operation", "values": ["run_sql"]}
CALL = {"field": "operation", "values": ["call_procedure"]}
LOAD = {"field": "operation", "values": ["load_table"]}
RUN_OR_CALL = {"field": "operation", "values": ["run_sql", "call_procedure"]}
RUN_OR_LOAD = {"field": "operation", "values": ["run_sql", "load_table"]}
SOURCE = {"field": "script_type", "values": ["source"]}
FILE = {"field": "script_type", "values": ["file"]}
TLS = {"field": "tls", "values": ["true"]}
RECORD_GATE = {"field": "on_error", "values": ["record"]}

OPERATIONS = ["run_sql", "call_procedure", "load_table"]
DATABASE_TYPES = ["postgresql", "mysql", "oracle", "mssql", "sqlite"]

# Every key beyond name, type and description, per parameter.
PARAM_KEYS: dict[str, dict[str, Any]] = {
    "operation": {"default": "run_sql", "enum_values": OPERATIONS},
    "database_type": {"default": "postgresql", "enum_values": DATABASE_TYPES},
    "host": {"required_when": NET, "show_when": NET, "trim": True},
    "port": {"minimum": 1, "maximum": 65535, "show_when": NET},
    "database": {"required_when": NET, "show_when": NET, "trim": True},
    "username": {"required_when": NET, "show_when": NET, "trim": True},
    "password": {"secret": True, "show_when": NET},
    "file": {"required_when": SQLITE, "show_when": SQLITE, "trim": True},
    "script_type": {"default": "source", "enum_values": ["source", "file"], "show_when": RUN},
    "sql": {"required_when_all": [RUN, SOURCE]},
    "sql_file": {"required_when_all": [RUN, FILE], "trim": True},
    "parameters": {"default": {}, "show_when": RUN},
    "stop_on_error": {"default": True},
    "procedure": {"required_when": CALL, "show_when": CALL, "trim": True},
    "arguments": {"default": {}, "show_when": CALL},
    "out_arguments": {"default": [], "show_when": CALL},
    "table": {"required_when": LOAD, "show_when": LOAD},
    "target_table": {"required_when": LOAD, "show_when": LOAD, "trim": True},
    "mode": {
        "default": "add",
        "enum_values": ["add", "add_or_replace", "overwrite"],
        "show_when": LOAD,
    },
    "key_columns": {},
    "commit_each_batch": {"default": False, "show_when": LOAD},
    "timeout": {"required": False, "default": 300, "minimum": 1},
    "tls": {"show_when": NET},
    "verify_ssl": {"default": True, "show_when": TLS},
    "ca_cert": {"show_when": TLS},
    "client_cert": {"show_when": TLS},
    "client_key": {"secret": True, "show_when": TLS},
    "connect_timeout": {"default": 30, "minimum": 1},
    "max_rows": {"default": 10000, "minimum": 0, "show_when": RUN_OR_CALL},
    "driver_options": {"default": {}, "typed_values": True},
    "batch_size": {"default": 1000, "minimum": 1, "show_when": LOAD},
    "on_error": {"required": False, "default": "fail", "enum_values": ["fail", "record"]},
}

# Rows shown under two conditions; the frontend descriptor owns that rule.
COMPOUND_ROWS = ["sql", "sql_file", "stop_on_error", "key_columns"]

FRONTEND_ONLY_KEYS = {
    "group",
    "label",
    "enum_labels",
    "fileReference",
    "allowedFormats",
    "noExpression",
    "retainOnHide",
}

OUTPUTS = [
    ("success", "boolean"),
    ("rows", "table"),
    ("row_count", "integer"),
    ("rows_changed", "integer"),
    ("out_values", "table"),
    ("error", "string"),
    ("reason", "string"),
]
OUTPUT_ORDER = [name for name, _ in OUTPUTS]
OUTPUT_GATES: dict[str, dict[str, Any]] = {
    "rows": RUN_OR_CALL,
    "row_count": RUN_OR_CALL,
    "rows_changed": RUN_OR_LOAD,
    "out_values": CALL,
    "error": RECORD_GATE,
    "reason": RECORD_GATE,
}


def _parameters() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in SQLClientPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in SQLClientPlugin().metadata["output_schema"]}


_TRUST_DESCRIPTIONS = {
    "verify_ssl": (
        "Verify the server certificate: against CA Certificate when it is set, otherwise "
        "against the certificates WAVE trusts (Settings > Network > Certificates)"
    ),
    "ca_cert": (
        "CA certificate (file path, variable reference, or PEM string); when set, it is the "
        "only certificate this block trusts"
    ),
}


def _without_description(entry: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in entry.items() if key != "description"}


class TestSqlIdentity:
    """Identity, remotability and the secret catalog (SQL-1, SQL-15)."""

    def test_identity_fields(self) -> None:
        meta = SQLClientPlugin().metadata
        identity = {
            key: meta.get(key)
            for key in ("id", "name", "version", "category", "remotable", "return_type")
        }

        assert identity == {
            "id": "sql-client",
            "name": "SQL",
            "version": "1.0.0",
            "category": "database",
            "remotable": True,
            "return_type": "map",
        }
        assert meta["remotable"] is True

    def test_secret_mask_fields_name_the_password_and_the_client_key(self) -> None:
        assert SQLClientPlugin().metadata["secret_mask_fields"] == ["password", "client_key"]

    def test_every_secret_row_is_in_the_secret_catalog(self) -> None:
        meta = SQLClientPlugin().metadata
        secret_rows = [p["name"] for p in meta["parameters"] if p.get("secret") is True]

        assert secret_rows == ["password", "client_key"]
        assert set(secret_rows) == set(meta["secret_mask_fields"])

    def test_metadata_builds_the_plugin_model(self) -> None:
        model = SQLClientPlugin().get_plugin_model()

        assert model.id == "sql-client"
        assert model.version == "1.0.0"
        assert model.category == "database"
        assert [p.name for p in model.parameters] == PARAM_ORDER
        assert [o.name for o in model.outputs] == OUTPUT_ORDER


class TestSqlParameters:
    """Every parameter row carries exactly the backend keys of its wire contract (SQL-8)."""

    def test_parameter_order(self) -> None:
        params = SQLClientPlugin().metadata["parameters"]

        assert [p["name"] for p in params] == PARAM_ORDER

    @pytest.mark.parametrize(("name", "expected"), list(PARAM_TYPES.items()))
    def test_parameter_type(self, name: str, expected: str) -> None:
        assert _parameters()[name]["type"] == expected

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_exact_key_set(self, name: str) -> None:
        expected = {"name": name, "type": PARAM_TYPES[name], **PARAM_KEYS[name]}

        assert _without_description(_parameters()[name]) == expected

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_every_parameter_has_a_description(self, name: str) -> None:
        description = _parameters()[name]["description"]

        assert isinstance(description, str) and description.strip()

    def test_the_sql_row_says_an_expression_gives_the_script_text(self) -> None:
        assert _parameters()["sql"]["description"] == (
            "The script, split into statements the way the database's own tool splits it. "
            ":name placeholders take their values from Parameters. With the expression toggle, "
            "an expression gives the script text."
        )

    def test_the_parameters_row_says_how_empty_text_and_null_bind(self) -> None:
        """SQL-2, REQ-3.1.3.22."""
        assert _parameters()["parameters"]["description"] == (
            "The value of each :name placeholder; empty text binds as empty text; null binds NULL."
        )

    @pytest.mark.parametrize(
        ("name", "shared"),
        [
            ("timeout", {**timeout_parameter(300, "-"), "minimum": 1}),
            ("on_error", on_error_parameter("-")),
        ],
    )
    def test_shared_rows_keep_the_shared_shape(self, name: str, shared: dict[str, Any]) -> None:
        assert _without_description(_parameters()[name]) == _without_description(shared)

    def test_no_row_is_required_outright(self) -> None:
        required = [name for name, param in _parameters().items() if param.get("required")]

        assert required == []

    @pytest.mark.parametrize("name", COMPOUND_ROWS)
    def test_compound_visibility_rows_carry_no_backend_show_when(self, name: str) -> None:
        assert "show_when" not in _parameters()[name]

    def test_key_columns_is_a_comma_separated_string_with_no_default(self) -> None:
        key_columns = _parameters()["key_columns"]

        assert key_columns["type"] == "string"
        assert "default" not in key_columns

    def test_tls_has_no_default_so_each_type_keeps_its_own(self) -> None:
        assert "default" not in _parameters()["tls"]

    def test_tls_shows_on_the_network_types_only(self) -> None:
        """SQLite is a file with no network, so it has no TLS group."""
        assert _parameters()["tls"]["show_when"] == NET

    @pytest.mark.parametrize("name", ["verify_ssl", "ca_cert", "client_cert", "client_key"])
    def test_the_trust_rows_show_while_tls_is_on(self, name: str) -> None:
        assert _parameters()[name]["show_when"] == TLS

    @pytest.mark.parametrize(("name", "description"), list(_TRUST_DESCRIPTIONS.items()))
    def test_the_trust_rows_state_the_trust_rule(self, name: str, description: str) -> None:
        """REQ-4.5.16."""
        assert _parameters()[name]["description"] == description

    @pytest.mark.parametrize("name", PARAM_ORDER)
    def test_no_frontend_only_key(self, name: str) -> None:
        assert FRONTEND_ONLY_KEYS.isdisjoint(_parameters()[name])


class TestSqlOutputs:
    """Success always; Rows, Row count, Rows changed and Out values per operation (SQL-9)."""

    def test_output_order(self) -> None:
        outputs = SQLClientPlugin().metadata["output_schema"]

        assert [o["name"] for o in outputs] == OUTPUT_ORDER

    @pytest.mark.parametrize(("name", "expected"), OUTPUTS)
    def test_output_type(self, name: str, expected: str) -> None:
        assert _outputs()[name]["type"] == expected

    @pytest.mark.parametrize(("name", "gate"), list(OUTPUT_GATES.items()))
    def test_output_gate(self, name: str, gate: dict[str, Any]) -> None:
        assert _outputs()[name]["show_when"] == gate

    def test_success_carries_no_show_when(self) -> None:
        assert "show_when" not in _outputs()["success"]

    def test_success_error_and_reason_keep_the_shared_shape(self) -> None:
        shared = {
            entry["name"]: _without_description(entry)
            for entry in output_core(gated=True, success_description="-", reason_description="-")
        }

        for name in ("success", "error", "reason"):
            assert _without_description(_outputs()[name]) == shared[name], name

    @pytest.mark.parametrize("name", OUTPUT_ORDER)
    def test_every_output_has_a_description(self, name: str) -> None:
        description = _outputs()[name]["description"]

        assert isinstance(description, str) and description.strip()
