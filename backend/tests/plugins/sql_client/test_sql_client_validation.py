"""SQL block validation: exact messages for the rows in effect, in check order (REQ-3.4.1.6).

validate() raises ValueError whatever On error says; one parameter set gives one message,
and the earliest failing check wins (SQL-2, SQL-8).
"""

from pathlib import Path
from typing import Any

import pytest

from tests.plugins.sql_client.conftest import exact, sql_params, sqlite_params
from wavecore.core.table import Table
from wavecore.plugins.sql_client import SQLClientPlugin

ABSENT: Any = object()

NETWORK_TYPES = ["postgresql", "mysql", "oracle", "mssql"]
ALL_TYPES = [*NETWORK_TYPES, "sqlite"]
DSN = {"dsn": "db.internal:1521/APP"}

# Validation fails the block whatever On error says.
ON_ERROR = pytest.mark.parametrize("on_error", ["fail", "record"])


def shaped(base: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """The base parameter set with overrides applied; an ABSENT override removes the key."""
    merged = {**base, **overrides}
    return {key: value for key, value in merged.items() if value is not ABSENT}


def run_sql(database_type: str = "postgresql", **overrides: Any) -> dict[str, Any]:
    """A valid Run SQL block of the given type."""
    if database_type == "sqlite":
        return shaped(sqlite_params(Path("/data/app.db")), **overrides)
    return shaped(sql_params(database_type=database_type), **overrides)


def call_procedure(database_type: str = "postgresql", **overrides: Any) -> dict[str, Any]:
    """A valid Call procedure block of the given network type."""
    base = run_sql(database_type, sql=ABSENT, operation="call_procedure", procedure="app.p")
    return shaped(base, **overrides)


def load_table(database_type: str = "postgresql", **overrides: Any) -> dict[str, Any]:
    """A valid Load table block of the given type, loading a Test Data CSV into orders."""
    base = run_sql(
        database_type,
        sql=ABSENT,
        operation="load_table",
        table="testdata://orders.csv",
        target_table="orders",
    )
    return shaped(base, **overrides)


def oracle_dsn(**overrides: Any) -> dict[str, Any]:
    """An Oracle Run SQL block whose Driver options carry a dsn instead of Host and Database."""
    base = run_sql("oracle", host=ABSENT, database=ABSENT, driver_options=dict(DSN))
    return shaped(base, **overrides)


async def refuses(message: str, params: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match=exact(message)):
        await SQLClientPlugin().validate(params)


async def passes(params: dict[str, Any]) -> None:
    assert await SQLClientPlugin().validate(params) is None


def blank_values(*values: str | None) -> list[Any]:
    """Absent first, then the given blank values, each with a readable id."""
    ids = {None: "none", "": "empty"}
    cases = [pytest.param(ABSENT, id="absent")]
    return cases + [pytest.param(v, id=ids.get(v) or f"spaces-{len(v or '')}") for v in values]


class TestChoices:
    """Each select holds one of its wire values while its row is in effect (SQL-1)."""

    @pytest.mark.parametrize(
        ("params", "name", "value", "values"),
        [
            pytest.param(
                run_sql(),
                "operation",
                "drop",
                "run_sql, call_procedure, load_table",
                id="operation",
            ),
            pytest.param(
                run_sql(),
                "database_type",
                "db2",
                "postgresql, mysql, oracle, mssql, sqlite",
                id="database_type",
            ),
            pytest.param(run_sql(), "script_type", "inline", "source, file", id="script_type"),
            pytest.param(
                load_table(), "mode", "merge", "add, add_or_replace, overwrite", id="mode"
            ),
            pytest.param(run_sql(), "on_error", "ignore", "fail, record", id="on_error"),
        ],
    )
    async def test_value_outside_its_choices(
        self, params: dict[str, Any], name: str, value: str, values: str
    ) -> None:
        await refuses(
            f"Parameter '{name}' must be one of: {values}; Actual value was '{value}'.",
            shaped(params, **{name: value}),
        )

    async def test_a_long_value_is_shown_by_its_length(self) -> None:
        await refuses(
            "Parameter 'database_type' must be one of: postgresql, mysql, oracle, mssql, sqlite; "
            "Actual value was a 60-character value.",
            run_sql(database_type="x" * 60),
        )

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(call_procedure(script_type="inline"), id="script-type-on-call"),
            pytest.param(load_table(script_type="inline"), id="script-type-on-load"),
            pytest.param(run_sql(mode="merge"), id="mode-on-run"),
            pytest.param(call_procedure(mode="merge"), id="mode-on-call"),
        ],
    )
    async def test_a_select_whose_row_is_hidden_is_not_checked(
        self, params: dict[str, Any]
    ) -> None:
        await passes(params)


class TestCallProcedureOnSqlite:
    """SQLite has no procedures, so the operation is refused there (SQL-6)."""

    @ON_ERROR
    async def test_call_procedure_on_sqlite(self, on_error: str) -> None:
        params = run_sql("sqlite", sql=ABSENT, operation="call_procedure", procedure="p")

        await refuses(
            "Operation 'Call procedure' is not available on SQLite",
            shaped(params, on_error=on_error),
        )

    @pytest.mark.parametrize(
        "params",
        [pytest.param(run_sql("sqlite"), id="run"), pytest.param(load_table("sqlite"), id="load")],
    )
    async def test_the_other_operations_pass_on_sqlite(self, params: dict[str, Any]) -> None:
        await passes(params)


class TestHostOrFile:
    """A network type needs a Host, SQLite a File; an Oracle dsn stands in for Host (SQL-8)."""

    @ON_ERROR
    @pytest.mark.parametrize("database_type", NETWORK_TYPES)
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_host_missing_or_blank(
        self, database_type: str, value: Any, on_error: str
    ) -> None:
        params = run_sql(database_type, host=value, on_error=on_error)

        await refuses("Set a Host or a File", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "  "))
    async def test_sqlite_file_missing_or_blank(self, value: Any, on_error: str) -> None:
        params = run_sql("sqlite", file=value, on_error=on_error)

        await refuses("Set a Host or a File", params)

    async def test_sqlite_with_a_host_but_no_file(self) -> None:
        await refuses("Set a Host or a File", run_sql("sqlite", file=ABSENT, host="db"))

    async def test_an_oracle_dsn_waives_host_and_database(self) -> None:
        await passes(oracle_dsn())

    async def test_an_empty_oracle_dsn_waives_nothing(self) -> None:
        await refuses("Set a Host or a File", oracle_dsn(driver_options={"dsn": ""}))

    @pytest.mark.parametrize("database_type", ["postgresql", "mysql", "mssql"])
    async def test_a_dsn_waives_host_on_oracle_only(self, database_type: str) -> None:
        params = run_sql(database_type, host=ABSENT, driver_options=dict(DSN))

        await refuses("Set a Host or a File", params)


class TestRequiredRows:
    """Connection and operation rows are required while in effect (SQL-8)."""

    @ON_ERROR
    @pytest.mark.parametrize("database_type", NETWORK_TYPES)
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_database_missing_or_blank(
        self, database_type: str, value: Any, on_error: str
    ) -> None:
        params = run_sql(database_type, database=value, on_error=on_error)

        await refuses("Missing required parameter: database", params)

    @ON_ERROR
    @pytest.mark.parametrize("database_type", NETWORK_TYPES)
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_username_missing_or_blank(
        self, database_type: str, value: Any, on_error: str
    ) -> None:
        params = run_sql(database_type, username=value, on_error=on_error)

        await refuses("Missing required parameter: username", params)

    async def test_an_oracle_dsn_still_needs_a_username(self) -> None:
        await refuses("Missing required parameter: username", oracle_dsn(username=""))

    async def test_a_dsn_waives_database_on_oracle_only(self) -> None:
        params = run_sql("postgresql", database=ABSENT, driver_options=dict(DSN))

        await refuses("Missing required parameter: database", params)

    @pytest.mark.parametrize("database_type", NETWORK_TYPES)
    async def test_password_is_not_required(self, database_type: str) -> None:
        await passes(run_sql(database_type, password=ABSENT))

    @ON_ERROR
    @pytest.mark.parametrize("script_type", [ABSENT, "source"])
    @pytest.mark.parametrize("value", blank_values(None, "", " \n "))
    async def test_sql_missing_or_blank_in_source(
        self, script_type: Any, value: Any, on_error: str
    ) -> None:
        params = run_sql(script_type=script_type, sql=value, on_error=on_error)

        await refuses("Missing required parameter: sql", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_sql_file_missing_or_blank_in_file(self, value: Any, on_error: str) -> None:
        params = run_sql(script_type="file", sql=ABSENT, sql_file=value, on_error=on_error)

        await refuses("Missing required parameter: sql_file", params)

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_procedure_missing_or_blank(self, value: Any, on_error: str) -> None:
        await refuses(
            "Missing required parameter: procedure",
            call_procedure(procedure=value, on_error=on_error),
        )

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_table_missing_or_blank(self, value: Any, on_error: str) -> None:
        await refuses(
            "Missing required parameter: table", load_table(table=value, on_error=on_error)
        )

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values(None, "", "   "))
    async def test_target_table_missing_or_blank(self, value: Any, on_error: str) -> None:
        await refuses(
            "Missing required parameter: target_table",
            load_table(target_table=value, on_error=on_error),
        )

    async def test_table_is_named_before_target_table(self) -> None:
        await refuses("Missing required parameter: table", load_table(table="", target_table=""))

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(call_procedure(), id="sql-on-call"),
            pytest.param(load_table(), id="sql-on-load"),
            pytest.param(
                run_sql(script_type="file", sql_file="testdata://q.sql"), id="sql-in-file"
            ),
            pytest.param(run_sql(sql_file=""), id="sql-file-in-source"),
            pytest.param(run_sql(procedure=""), id="procedure-on-run"),
            pytest.param(run_sql(table="", target_table=""), id="load-rows-on-run"),
            pytest.param(call_procedure(table=None, target_table=None), id="load-rows-on-call"),
            pytest.param(load_table(procedure="  "), id="procedure-on-load"),
            pytest.param(run_sql("sqlite", host=""), id="host-on-sqlite"),
            pytest.param(run_sql(file=""), id="file-on-network"),
        ],
    )
    async def test_a_row_that_is_not_in_effect_is_not_required(
        self, params: dict[str, Any]
    ) -> None:
        await passes(params)


INTEGER_ROWS = [
    pytest.param(run_sql(), "port", id="port"),
    pytest.param(run_sql(), "timeout", id="timeout"),
    pytest.param(run_sql(), "connect_timeout", id="connect_timeout"),
    pytest.param(run_sql(), "max_rows", id="max_rows-on-run"),
    pytest.param(call_procedure(), "max_rows", id="max_rows-on-call"),
    pytest.param(load_table(), "batch_size", id="batch_size"),
]

BOOLEAN_ROWS = [
    pytest.param(run_sql(), "stop_on_error", id="stop_on_error-on-run"),
    pytest.param(load_table(commit_each_batch=True), "stop_on_error", id="stop_on_error-on-load"),
    pytest.param(run_sql(), "tls", id="tls"),
    pytest.param(run_sql(tls=True), "verify_ssl", id="verify_ssl"),
    pytest.param(load_table(), "commit_each_batch", id="commit_each_batch"),
]


class TestValueTypes:
    """Integer and switch rows hold their own type; a bool is not an integer."""

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

    @ON_ERROR
    @pytest.mark.parametrize(("params", "name"), BOOLEAN_ROWS)
    @pytest.mark.parametrize(
        "value", ["yes", "true", 1, 0], ids=["yes", "true-text", "one", "zero"]
    )
    async def test_switch_row_not_a_boolean(
        self, params: dict[str, Any], name: str, value: Any, on_error: str
    ) -> None:
        await refuses(
            f"Parameter '{name}' must be a boolean",
            shaped(params, on_error=on_error, **{name: value}),
        )

    async def test_verify_ssl_is_checked_on_sql_server_where_tls_defaults_on(self) -> None:
        await refuses(
            "Parameter 'verify_ssl' must be a boolean", run_sql("mssql", verify_ssl="yes")
        )

    @pytest.mark.parametrize("value", [None, ""], ids=["none", "empty"])
    @pytest.mark.parametrize("database_type", NETWORK_TYPES)
    async def test_a_blank_port_is_the_types_default(self, value: Any, database_type: str) -> None:
        await passes(run_sql(database_type, port=value))

    @pytest.mark.parametrize(
        ("params", "name"),
        [
            pytest.param(run_sql(), "timeout", id="timeout"),
            pytest.param(run_sql(), "connect_timeout", id="connect_timeout"),
            pytest.param(run_sql(), "max_rows", id="max_rows-on-run"),
            pytest.param(call_procedure(), "max_rows", id="max_rows-on-call"),
            pytest.param(load_table(), "batch_size", id="batch_size"),
        ],
    )
    async def test_an_empty_integer_row_takes_its_default(
        self, params: dict[str, Any], name: str
    ) -> None:
        await passes(shaped(params, **{name: ""}))


class TestBounds:
    """Port, Timeout, Connect timeout, Max rows and Batch size stay in range (SQL-4, SQL-8)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -1, 65536, 100000])
    async def test_port_out_of_range(self, value: int, on_error: str) -> None:
        await refuses("Port must be between 1 and 65535", run_sql(port=value, on_error=on_error))

    @pytest.mark.parametrize("value", [1, 5432, 65535])
    async def test_port_in_range(self, value: int) -> None:
        await passes(run_sql(port=value))

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -5])
    async def test_timeout_below_one(self, value: int, on_error: str) -> None:
        await refuses("Timeout must be at least 1", run_sql(timeout=value, on_error=on_error))

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -1])
    async def test_connect_timeout_below_one(self, value: int, on_error: str) -> None:
        await refuses(
            "Connect timeout must be at least 1",
            run_sql(connect_timeout=value, on_error=on_error),
        )

    @ON_ERROR
    @pytest.mark.parametrize(
        "params",
        [pytest.param(run_sql(), id="run"), pytest.param(call_procedure(), id="call")],
    )
    async def test_max_rows_below_zero(self, params: dict[str, Any], on_error: str) -> None:
        await refuses("Max rows must be 0 or more", shaped(params, max_rows=-1, on_error=on_error))

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -1])
    async def test_batch_size_below_one(self, value: int, on_error: str) -> None:
        await refuses(
            "Batch size must be at least 1", load_table(batch_size=value, on_error=on_error)
        )

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(run_sql(max_rows=0), id="max-rows-zero-keeps-every-row"),
            pytest.param(call_procedure(max_rows=0), id="max-rows-zero-on-call"),
            pytest.param(run_sql(timeout=1, connect_timeout=1), id="timeouts-at-one"),
            pytest.param(load_table(batch_size=1), id="batch-size-one"),
        ],
    )
    async def test_the_lowest_allowed_values_pass(self, params: dict[str, Any]) -> None:
        await passes(params)


class TestSettingsInEffect:
    """A row hidden by Operation, Database type or TLS is not validated."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(run_sql(batch_size=0), id="batch-size-zero-on-run"),
            pytest.param(run_sql(batch_size="many"), id="batch-size-text-on-run"),
            pytest.param(call_procedure(batch_size=-1), id="batch-size-on-call"),
            pytest.param(load_table(max_rows=-1), id="max-rows-below-zero-on-load"),
            pytest.param(load_table(max_rows="all"), id="max-rows-text-on-load"),
            pytest.param(run_sql(commit_each_batch="yes"), id="commit-each-batch-on-run"),
            pytest.param(call_procedure(stop_on_error="yes"), id="stop-on-error-on-call"),
            pytest.param(load_table(stop_on_error="yes"), id="stop-on-error-on-load-one-commit"),
            pytest.param(
                load_table(commit_each_batch=False, stop_on_error="yes"),
                id="stop-on-error-with-commit-each-batch-off",
            ),
            pytest.param(run_sql("sqlite", port=0), id="port-zero-on-sqlite"),
            pytest.param(run_sql("sqlite", port="abc"), id="port-text-on-sqlite"),
            pytest.param(run_sql(tls=False, verify_ssl="yes"), id="verify-ssl-with-tls-off"),
            pytest.param(run_sql(verify_ssl="yes"), id="verify-ssl-with-tls-default-off"),
            pytest.param(run_sql("mssql", tls=False, verify_ssl="yes"), id="verify-ssl-mssql-off"),
            pytest.param(run_sql("sqlite", tls="yes"), id="tls-text-on-sqlite"),
            pytest.param(run_sql("sqlite", tls=True, verify_ssl="yes"), id="verify-ssl-on-sqlite"),
            pytest.param(call_procedure(sql="SELECT :undefined"), id="sql-placeholder-on-call"),
            pytest.param(
                run_sql(script_type="file", sql_file="q.sql", sql="SELECT :undefined"),
                id="sql-placeholder-in-file-mode",
            ),
        ],
    )
    async def test_hidden_row_passes(self, params: dict[str, Any]) -> None:
        await passes(params)


class TestUndefinedPlaceholders:
    """A :name with no Parameters entry passes validate(); the check belongs to the run (SQL-2)."""

    @ON_ERROR
    @pytest.mark.parametrize("database_type", ALL_TYPES)
    @pytest.mark.parametrize("parameters", [ABSENT, None, {}], ids=["absent", "none", "empty"])
    async def test_a_placeholder_without_an_entry_passes(
        self, database_type: str, parameters: Any, on_error: str
    ) -> None:
        params = run_sql(database_type, sql="SELECT :x", parameters=parameters, on_error=on_error)

        await passes(params)

    @pytest.mark.parametrize(
        ("sql", "parameters"),
        [
            pytest.param("SELECT :a, :b", {"a": 1}, id="second-of-two"),
            pytest.param("SELECT :z;\nSELECT :a", {}, id="two-statements"),
            pytest.param("SELECT :A", {"a": 1}, id="case-sensitive"),
        ],
    )
    async def test_an_undefined_name_is_left_to_the_run(
        self, sql: str, parameters: dict[str, Any]
    ) -> None:
        await passes(run_sql(sql=sql, parameters=parameters))

    async def test_a_later_sql_server_batch_is_left_to_the_run(self) -> None:
        await passes(run_sql("mssql", sql="SELECT 1\nGO\nSELECT :x"))

    @pytest.mark.parametrize(
        ("database_type", "sql", "parameters"),
        [
            pytest.param("postgresql", "SELECT :a, :b, :a", {"a": 1, "b": "x"}, id="all-defined"),
            pytest.param("postgresql", "SELECT :a", {"a": 1, "unused": 2}, id="unused-entry"),
            pytest.param("postgresql", "SELECT :a", {"a": ""}, id="empty-value-is-empty-text"),
            pytest.param("postgresql", "SELECT :a", {"a": None}, id="none-value-is-null"),
            pytest.param("postgresql", "SELECT :a", {"a": "  "}, id="spaces-value-is-a-value"),
            pytest.param("postgresql", "SELECT e'\\' :x'", {}, id="lower-case-escape-string"),
            pytest.param("postgresql", "SELECT /* a /* b */ :x */ 1", {}, id="nested-comment"),
            pytest.param("oracle", "SELECT Q'[it's :x]' FROM dual", {}, id="oracle-upper-q-quote"),
            pytest.param("postgresql", "SELECT x::int, :a::text", {"a": 1}, id="casts"),
            pytest.param(
                "postgresql",
                "SELECT ':x', \":y\" -- :z\n/* :w */ FROM t",
                {},
                id="strings-and-comments",
            ),
            pytest.param("postgresql", "SELECT $$ :x $$", {}, id="dollar-quoted-body"),
            pytest.param("mysql", "SELECT 1 # :x", {}, id="mysql-hash-comment"),
            pytest.param("mssql", "SELECT [:x] FROM t", {}, id="mssql-bracket-name"),
            pytest.param("oracle", "SELECT q'[:x]' FROM dual", {}, id="oracle-q-quote"),
            pytest.param(
                "oracle",
                "CREATE OR REPLACE TRIGGER t BEFORE INSERT ON a FOR EACH ROW\n"
                "BEGIN\n  :NEW.id := :old.id;\nEND;",
                {},
                id="oracle-trigger-new-and-old",
            ),
        ],
    )
    async def test_every_used_name_defined_or_not_a_placeholder(
        self, database_type: str, sql: str, parameters: dict[str, Any]
    ) -> None:
        await passes(run_sql(database_type, sql=sql, parameters=parameters))


class TestCheckOrder:
    """With two faults the earlier check names the message."""

    @pytest.mark.parametrize(
        ("params", "message"),
        [
            pytest.param(
                run_sql("sqlite", sql=ABSENT, operation="call_procedure", on_error="ignore"),
                "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'.",
                id="choice-before-sqlite-operation",
            ),
            pytest.param(
                run_sql("sqlite", sql=ABSENT, operation="call_procedure", file=ABSENT),
                "Operation 'Call procedure' is not available on SQLite",
                id="sqlite-operation-before-file",
            ),
            pytest.param(
                run_sql(host="", database="", username=""),
                "Set a Host or a File",
                id="host-before-database",
            ),
            pytest.param(
                run_sql(username=ABSENT, timeout="soon"),
                "Missing required parameter: username",
                id="required-before-type",
            ),
            pytest.param(
                run_sql(sql="", port="x"),
                "Missing required parameter: sql",
                id="sql-required-before-port-type",
            ),
            pytest.param(
                run_sql(timeout="soon", port=0),
                "Parameter 'timeout' must be an integer",
                id="type-before-bound",
            ),
            pytest.param(
                run_sql(port="5432"),
                "Parameter 'port' must be an integer",
                id="port-text-is-a-type-fault",
            ),
            pytest.param(
                run_sql(timeout=0, sql="SELECT :x"),
                "Timeout must be at least 1",
                id="bound-fault-with-an-undefined-placeholder",
            ),
            pytest.param(
                run_sql(username="", sql="SELECT :x"),
                "Missing required parameter: username",
                id="required-fault-with-an-undefined-placeholder",
            ),
        ],
    )
    async def test_the_earlier_check_wins(self, params: dict[str, Any], message: str) -> None:
        await refuses(message, params)


class TestValidConfigurations:
    """Complete blocks pass; absent or None settings take their defaults."""

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    async def test_run_sql_passes(self, database_type: str) -> None:
        await passes(run_sql(database_type))

    @pytest.mark.parametrize("database_type", NETWORK_TYPES)
    async def test_call_procedure_passes(self, database_type: str) -> None:
        params = call_procedure(database_type, arguments={"a": 5}, out_arguments=[{"value": "o"}])

        await passes(params)

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    @pytest.mark.parametrize("mode", ["add", "add_or_replace", "overwrite"])
    async def test_load_table_passes(self, database_type: str, mode: str) -> None:
        await passes(load_table(database_type, mode=mode))

    async def test_load_table_from_a_table_value(self) -> None:
        table = Table.from_list([{"id": 1, "qty": 2}])

        await passes(load_table(table=table))

    async def test_load_table_with_key_columns_and_commit_each_batch(self) -> None:
        params = load_table(
            mode="add_or_replace",
            key_columns="id, region",
            commit_each_batch=True,
            stop_on_error=False,
            batch_size=500,
        )

        await passes(params)

    async def test_run_sql_from_a_file(self) -> None:
        await passes(run_sql(script_type="file", sql=ABSENT, sql_file="testdata://q.sql"))

    async def test_run_sql_with_bound_parameters(self) -> None:
        params = run_sql(
            sql="SELECT * FROM orders WHERE id = :id AND region = :region",
            parameters={"id": 42, "region": "eu"},
        )

        await passes(params)

    async def test_tls_rows_on(self) -> None:
        params = run_sql(
            tls=True,
            verify_ssl=False,
            ca_cert="/etc/ssl/ca.pem",
            client_cert="/etc/ssl/client.pem",
            client_key="/etc/ssl/client.key",
        )

        await passes(params)

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(
                run_sql(
                    operation=None,
                    database_type=None,
                    script_type=None,
                    on_error=None,
                    port=None,
                    timeout=None,
                    connect_timeout=None,
                    max_rows=None,
                    stop_on_error=None,
                    tls=None,
                    verify_ssl=None,
                    parameters=None,
                    driver_options=None,
                ),
                id="none-run-rows",
            ),
            pytest.param(
                load_table(mode=None, batch_size=None, commit_each_batch=None, key_columns=None),
                id="none-load-rows",
            ),
            pytest.param(
                call_procedure(arguments=None, out_arguments=None, max_rows=None),
                id="none-call-rows",
            ),
        ],
    )
    async def test_none_settings_take_their_defaults(self, params: dict[str, Any]) -> None:
        await passes(params)
