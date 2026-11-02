"""Call procedure on each network type through fake connections (REQ-3.4.1.6, REQ-5.1.4)."""

import re
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tests.connectivity.sql.fakes import FakeConnection, Result
from tests.plugins.sql_client.conftest import (
    LogRecorder,
    columns,
    exact,
    outputs,
    rows,
    sql_context,
    sql_params,
    sqlite_params,
)
from wavecore.core.expressions.errors import NullValueError
from wavecore.core.table import Table
from wavecore.plugins import _sql_core
from wavecore.plugins.sql_client import SQLClientPlugin, remote_request

NOT_ON_SQLITE = "Operation 'Call procedure' is not available on SQLite"
CALL_OUTPUTS = {"rows", "row_count", "out_values", "success", "error", "reason"}
UNDECLARED_OUT = "Out argument 'zz' is not a parameter of app.p"
MSSQL_CALL = "DECLARE @wave_o int; EXEC app.p @a = %s, @o = @wave_o OUTPUT; SELECT @wave_o AS [o];"


def call_params(database_type: str, **overrides: Any) -> dict[str, Any]:
    """Call app.p with a = 5 and out argument o on `database_type`, which `overrides` reshape."""
    base = {
        "database_type": database_type,
        "operation": "call_procedure",
        "procedure": "app.p",
        "arguments": {"a": 5},
        "out_arguments": ["o"],
    }
    return sql_params(**{**base, **overrides})


def calls(connection: FakeConnection) -> list[tuple[str, Any]]:
    """Each execute the connection saw as (statement, binds), binds as a list or None."""
    return [
        (statement, None if binds is None else list(binds))
        for _, statement, binds in connection.executed
    ]


def signature(*arguments: tuple[str, str]) -> Result:
    """The argument catalog answer read_signature reads: name and declared type per row."""
    return Result(columns=["argument_name", "data_type"], rows=list(arguments))


def pg_error(code: str, text: str) -> Exception:
    return Exception({"S": "ERROR", "C": code, "M": text})


class TdsError(Exception):
    """python-tds's server error shape: a message number and its text."""

    def __init__(self, number: int, text: str) -> None:
        super().__init__(text)
        self.number, self.text = number, text


class OutVariable:
    """What oracle.out_variable hands back: the declared type and the value the call wrote."""

    def __init__(self, type_text: str, value: Any) -> None:
        self.type_text, self.value = type_text, value

    sent: tuple[int, Any] | None = None

    def getvalue(self) -> Any:
        return self.value

    def setvalue(self, position: int, value: Any) -> None:
        self.sent = (position, value)


def oracle_out_variables(fake: Any, *values: Any) -> list[OutVariable]:
    """Give the fake oracle dialect out_variable; each call takes the next of `values`."""
    made: list[OutVariable] = []
    pending = list(values)

    def out_variable(cursor: Any, type_text: str) -> OutVariable:
        made.append(OutVariable(type_text, pending.pop(0)))
        return made[-1]

    fake.out_variable = out_variable
    return made


class TestTheCallEachTypeBuilds:
    """Each type's call statements reach the connection; Out values come back typed (SQL-6)."""

    def test_postgresql_calls_with_named_notation_and_reads_the_result_row(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([Result(columns=["o"], rows=[(42,)])])
        use_fake("postgresql", connection)

        out = outputs(_sql_core.run(call_params("postgresql"), log))

        assert set(out) == CALL_OUTPUTS
        assert calls(connection) == [("CALL app.p(a => $1, o => NULL)", [5])]
        assert (columns(out["out_values"]), rows(out["out_values"])) == ([("o", "integer")], [[42]])
        assert (out["success"], out["error"], out["reason"]) == (True, "", "")

    def test_mysql_calls_positionally_and_reads_the_session_variable_back(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([Result(), Result(columns=["o"], rows=[("done",)])])
        use_fake("mysql", connection)

        out = outputs(_sql_core.run(call_params("mysql"), log))

        assert calls(connection) == [
            ("CALL app.p(%s, @wave_o)", [5]),
            ("SELECT @wave_o AS `o`", None),
        ]
        assert (columns(out["out_values"]), rows(out["out_values"])) == (
            [("o", "string")],
            [["done"]],
        )

    def test_oracle_binds_an_out_variable_of_the_declared_type(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([signature(("a", "NUMBER"), ("o", "NUMBER")), Result()])
        fake = use_fake("oracle", connection)
        made = oracle_out_variables(fake, 42)

        out = outputs(_sql_core.run(call_params("oracle"), log))

        assert [variable.type_text for variable in made] == ["NUMBER"]
        assert calls(connection)[-1] == ("BEGIN app.p(a => :1, o => :2); END;", [5, made[0]])
        assert len(connection.executed) == 2
        assert (columns(out["out_values"]), rows(out["out_values"])) == ([("o", "integer")], [[42]])

    def test_mssql_declares_the_out_variable_with_its_declared_type(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection(
            [signature(("@a", "int"), ("@o", "int")), Result(columns=["o"], rows=[(42,)])]
        )
        use_fake("mssql", connection)

        out = outputs(_sql_core.run(call_params("mssql"), log))

        assert calls(connection)[-1] == (MSSQL_CALL, [5])
        assert len(connection.executed) == 2
        assert (columns(out["out_values"]), rows(out["out_values"])) == ([("o", "integer")], [[42]])

    def test_mssql_adds_the_at_sign_only_where_it_is_missing(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection(
            [signature(("@a", "int"), ("@o", "int")), Result(columns=["o"], rows=[(42,)])]
        )
        use_fake("mssql", connection)

        _sql_core.run(call_params("mssql", arguments={"@a": 5}, out_arguments=["@o"]), log)

        statement, binds = calls(connection)[-1]
        assert "EXEC app.p @a = %s, @o = @wave_o OUTPUT;" in statement
        assert "@@" not in statement
        assert "wave_@" not in statement
        assert binds == [5]


class TestTheDeclaredSignature:
    """Oracle and SQL Server read the procedure's arguments before the call (SQL-6)."""

    @pytest.mark.parametrize(
        ("out_name", "declared", "value", "typed"),
        [
            pytest.param("o", ("O", "VARCHAR2"), "done", "string", id="lower-case-out"),
            pytest.param("Total", ("TOTAL", "NUMBER"), 42, "integer", id="mixed-case-out"),
        ],
    )
    def test_oracle_matches_out_names_without_case_and_keeps_the_authors_spelling(
        self,
        use_fake: Any,
        log: LogRecorder,
        out_name: str,
        declared: tuple[str, str],
        value: Any,
        typed: str,
    ) -> None:
        connection = FakeConnection([signature(("A", "NUMBER"), declared), Result()])
        fake = use_fake("oracle", connection)
        made = oracle_out_variables(fake, value)

        out = outputs(_sql_core.run(call_params("oracle", out_arguments=[out_name]), log))

        assert out["success"] is True
        assert [variable.type_text for variable in made] == [declared[1]]
        assert calls(connection)[-1] == (
            f"BEGIN app.p(a => :1, {out_name} => :2); END;",
            [5, made[0]],
        )
        assert (columns(out["out_values"]), rows(out["out_values"])) == (
            [(out_name, typed)],
            [[value]],
        )

    @pytest.mark.parametrize(
        ("database_type", "declared"),
        [
            pytest.param("oracle", signature(("A", "NUMBER"), ("O", "NUMBER")), id="oracle"),
            pytest.param("mssql", signature(("@a", "int"), ("@o", "int")), id="mssql"),
        ],
    )
    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_an_out_argument_the_procedure_does_not_declare_fails_before_the_call(
        self,
        use_fake: Any,
        log: LogRecorder,
        database_type: str,
        declared: Result,
        on_error: str,
    ) -> None:
        connection = FakeConnection([declared])
        fake = use_fake(database_type, connection)
        oracle_out_variables(fake, None, None)
        params = call_params(database_type, out_arguments=["o", "zz"], on_error=on_error)

        if on_error == "fail":
            with pytest.raises(ValueError, match=exact(UNDECLARED_OUT)):
                _sql_core.run(params, log)
        else:
            out = outputs(_sql_core.run(params, log))
            assert (out["success"], out["error"], out["reason"]) == (
                False,
                UNDECLARED_OUT,
                "Validation",
            )
            assert (out["row_count"], rows(out["rows"]), rows(out["out_values"])) == (0, [], [])
            assert log.at("WARN") == [f"Call procedure failed (Validation): {UNDECLARED_OUT}"]

        assert len(connection.executed) == 1
        assert connection.closed is True


class TestTheCallRunsThroughTheDialect:
    """Setup, call, fetch and the function fallback reach the driver through the dialect."""

    @pytest.mark.parametrize(
        ("database_type", "script", "overrides"),
        [
            pytest.param(
                "postgresql",
                [Result(columns=["o"], rows=[(8,)])],
                {"arguments": {"a": 5, "o": 7}},
                id="postgresql",
            ),
            pytest.param(
                "postgresql",
                [
                    Result(error=pg_error("42809", "app.p(integer) is not a procedure")),
                    Result(columns=["id"], rows=[(1,)]),
                ],
                {"out_arguments": []},
                id="postgresql-function-fallback",
            ),
            pytest.param(
                "mysql",
                [Result(), Result(), Result(columns=["o"], rows=[(8,)])],
                {"arguments": {"a": 5, "o": 7}},
                id="mysql",
            ),
        ],
    )
    def test_every_statement_of_the_call_goes_through_the_dialect(
        self,
        use_fake: Any,
        log: LogRecorder,
        database_type: str,
        script: list[Result],
        overrides: dict[str, Any],
    ) -> None:
        connection = FakeConnection(script)
        fake = use_fake(database_type, connection)

        out = outputs(_sql_core.run(call_params(database_type, **overrides), log))

        assert out["success"] is True
        assert fake.executes == [(statement, binds) for _, statement, binds in connection.executed]


class TestInOutArguments:
    """A name in both Arguments and Out arguments passes its value in and reads it back."""

    def test_postgresql_binds_the_value_in_the_out_slot(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([Result(columns=["o"], rows=[(8,)])])
        use_fake("postgresql", connection)

        out = outputs(_sql_core.run(call_params("postgresql", arguments={"a": 5, "o": 7}), log))

        assert calls(connection) == [("CALL app.p(a => $1, o => $2)", [5, 7])]
        assert rows(out["out_values"]) == [[8]]

    def test_mysql_sets_the_session_variable_first(self, use_fake: Any, log: LogRecorder) -> None:
        connection = FakeConnection([Result(), Result(), Result(columns=["o"], rows=[(8,)])])
        use_fake("mysql", connection)

        out = outputs(_sql_core.run(call_params("mysql", arguments={"a": 5, "o": 7}), log))

        assert calls(connection) == [
            ("SET @wave_o = %s", [7]),
            ("CALL app.p(%s, @wave_o)", [5]),
            ("SELECT @wave_o AS `o`", None),
        ]
        assert rows(out["out_values"]) == [[8]]

    def test_oracle_sets_the_out_variable_to_the_value_before_the_call(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([signature(("a", "NUMBER"), ("o", "NUMBER")), Result()])
        fake = use_fake("oracle", connection)
        made = oracle_out_variables(fake, 8)

        out = outputs(_sql_core.run(call_params("oracle", arguments={"a": 5, "o": 7}), log))

        assert made[0].sent == (0, 7)
        assert calls(connection)[-1] == ("BEGIN app.p(a => :1, o => :2); END;", [5, made[0]])
        assert rows(out["out_values"]) == [[8]]

    def test_mssql_initializes_the_declared_variable_with_its_bind_first(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection(
            [signature(("@a", "int"), ("@o", "int")), Result(columns=["o"], rows=[(8,)])]
        )
        use_fake("mssql", connection)

        _sql_core.run(call_params("mssql", arguments={"a": 5, "o": 7}), log)

        assert calls(connection)[-1] == (
            "DECLARE @wave_o int = %s; EXEC app.p @a = %s, @o = @wave_o OUTPUT; "
            "SELECT @wave_o AS [o];",
            [7, 5],
        )


class TestOutValues:
    """Out values is one row with a column per Out argument, in their order, typed (SQL-6)."""

    def test_columns_follow_out_arguments_matched_without_case(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        answer = Result(columns=["LABEL", "Total"], rows=[("x", Decimal("12.50"))])
        connection = FakeConnection([answer])
        use_fake("postgresql", connection)
        params = call_params("postgresql", out_arguments=["total", "label"])

        out = outputs(_sql_core.run(params, log))

        assert calls(connection) == [("CALL app.p(a => $1, total => NULL, label => NULL)", [5])]
        assert columns(out["out_values"]) == [("total", "float"), ("label", "string")]
        assert rows(out["out_values"]) == [["12.50", "x"]]

    async def test_execute_hands_back_out_values_as_a_table(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        use_fake("postgresql", FakeConnection([Result(columns=["o"], rows=[(42,)])]))

        params = call_params("postgresql", out_arguments=[{"value": "o"}])

        out = await SQLClientPlugin().execute(sql_context(params, log))

        assert isinstance(out["out_values"], Table)
        assert out["out_values"].col_names() == ["o"]
        assert [row.to_list() for row in out["out_values"]] == [[42]]

    async def test_execute_reads_each_out_argument_name_from_its_list_row(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([Result(columns=["total", "label"], rows=[(5, "sum")])])
        use_fake("postgresql", connection)
        params = call_params("postgresql", out_arguments=[{"value": "total"}, {"value": "label"}])

        await SQLClientPlugin().execute(sql_context(params, log))

        assert calls(connection) == [("CALL app.p(a => $1, total => NULL, label => NULL)", [5])]

    def test_the_remote_request_carries_the_out_argument_names(self) -> None:
        params = call_params("postgresql", out_arguments=[{"value": "total"}, {"value": "label"}])

        assert remote_request(params, None, None)["out_arguments"] == ["total", "label"]

    def test_a_decimal_envelope_argument_binds_a_decimal(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([Result(columns=["o"], rows=[(1,)])])
        use_fake("postgresql", connection)
        amount = {"__wave_type": "decimal", "value": "12.50"}

        _sql_core.run(call_params("postgresql", arguments={"a": amount}), log)

        assert calls(connection) == [("CALL app.p(a => $1, o => NULL)", [Decimal("12.50")])]


class TestRowsAProcedureReturns:
    """Rows and Row count hold what the procedure returned; Max rows caps them (SQL-4, SQL-9)."""

    def test_oracle_rows_are_the_last_implicit_result(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        first = Result(columns=["id"], rows=[(7,)])
        last = Result(columns=["k", "sq"], rows=[(1, 1), (2, 4), (3, 9)])
        call = Result(implicit=[first, last])
        connection = FakeConnection([signature(("A", "NUMBER"), ("O", "NUMBER")), call])
        fake = use_fake("oracle", connection)
        oracle_out_variables(fake, 42)

        out = outputs(_sql_core.run(call_params("oracle", max_rows=2), log))

        assert (columns(out["rows"]), rows(out["rows"])) == (
            [("k", "integer"), ("sq", "integer")],
            [[1, 1], [2, 4]],
        )
        assert out["row_count"] == 2
        assert rows(out["out_values"]) == [[42]]
        assert log.at("WARN") == ["Stopped after 2 rows (Max rows)"]

    def test_oracle_without_an_implicit_result_has_no_rows(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([signature(("A", "NUMBER")), Result()])
        use_fake("oracle", connection)

        out = outputs(_sql_core.run(call_params("oracle", out_arguments=[]), log))

        assert (columns(out["rows"]), rows(out["rows"]), out["row_count"]) == ([], [], 0)

    def test_mysql_rows_are_the_call_result_set(self, use_fake: Any, log: LogRecorder) -> None:
        answer = Result(columns=["id"], rows=[(1,), (2,), (3,)])
        use_fake("mysql", FakeConnection([answer, Result(columns=["o"], rows=[(9,)])]))

        out = outputs(_sql_core.run(call_params("mysql", max_rows=2), log))

        assert (columns(out["rows"]), rows(out["rows"])) == ([("id", "integer")], [[1], [2]])
        assert out["row_count"] == 2
        assert rows(out["out_values"]) == [[9]]
        assert log.at("WARN") == ["Stopped after 2 rows (Max rows)"]

    def test_mssql_rows_are_the_result_set_before_the_out_values(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        answer = Result(
            columns=["id"], rows=[(1,), (2,)], more=[Result(columns=["o"], rows=[(42,)])]
        )
        use_fake("mssql", FakeConnection([signature(("@a", "int"), ("@o", "int")), answer]))

        out = outputs(_sql_core.run(call_params("mssql"), log))

        assert (rows(out["rows"]), out["row_count"]) == ([[1], [2]], 2)
        assert (columns(out["out_values"]), rows(out["out_values"])) == ([("o", "integer")], [[42]])

    def test_postgresql_falls_back_to_a_function_call_on_42809(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        not_a_procedure = pg_error("42809", "app.p(integer) is not a procedure")
        answer = Result(columns=["id", "qty"], rows=[(1, 5), (2, 7)])
        connection = FakeConnection([Result(error=not_a_procedure), answer])
        use_fake("postgresql", connection)

        out = outputs(_sql_core.run(call_params("postgresql", out_arguments=[]), log))

        assert calls(connection) == [
            ("CALL app.p(a => $1)", [5]),
            ("SELECT * FROM app.p(a => $1)", [5]),
        ]
        assert rows(out["rows"]) == [[1, 5], [2, 7]]
        assert (out["row_count"], out["success"]) == (2, True)

    def test_postgresql_falls_back_when_no_procedure_matches_a_table_function(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        # CALL counts a RETURNS TABLE function's OUT columns, so it finds no match: 42883.
        no_match = pg_error("42883", "procedure app.p(a => unknown) does not exist")
        answer = Result(columns=["k", "sq"], rows=[(1, 1), (2, 4)])
        connection = FakeConnection([Result(error=no_match), answer])
        use_fake("postgresql", connection)

        out = outputs(_sql_core.run(call_params("postgresql", out_arguments=[]), log))

        assert calls(connection) == [
            ("CALL app.p(a => $1)", [5]),
            ("SELECT * FROM app.p(a => $1)", [5]),
        ]
        assert (rows(out["rows"]), out["row_count"]) == ([[1, 1], [2, 4]], 2)

    @pytest.mark.parametrize(
        ("select_code", "select_text"),
        [
            ("42883", "function app.p(a => unknown) does not exist"),
            ("42809", "app.p(a => unknown) is a procedure"),
        ],
    )
    def test_postgresql_keeps_the_call_error_when_the_select_finds_no_function(
        self, use_fake: Any, log: LogRecorder, select_code: str, select_text: str
    ) -> None:
        missing = pg_error("42883", "procedure app.p(a => unknown) does not exist")
        not_selectable = pg_error(select_code, select_text)
        connection = FakeConnection([Result(error=missing), Result(error=not_selectable)])
        use_fake("postgresql", connection)

        with pytest.raises(
            ValueError, match=exact("42883: procedure app.p(a => unknown) does not exist")
        ):
            _sql_core.run(call_params("postgresql", out_arguments=[]), log)

        assert len(connection.executed) == 2

    @pytest.mark.parametrize("call_code", ["42883", "42809"])
    def test_postgresql_reports_the_selected_functions_own_error(
        self, use_fake: Any, log: LogRecorder, call_code: str
    ) -> None:
        not_a_procedure = pg_error(call_code, "app.p(a => unknown) is not a procedure")
        failed = pg_error("22012", "division by zero")
        connection = FakeConnection([Result(error=not_a_procedure), Result(error=failed)])
        use_fake("postgresql", connection)

        with pytest.raises(ValueError, match=exact("22012: division by zero")):
            _sql_core.run(call_params("postgresql", out_arguments=[]), log)

    def test_postgresql_function_out_parameters_fill_out_values(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        # A function's OUT parameters are result columns, never arguments of its SELECT.
        no_match = pg_error("42883", "procedure app.p(a => unknown, o => unknown) does not exist")
        answer = Result(columns=["o", "note"], rows=[(10, "x")])
        connection = FakeConnection([Result(error=no_match), answer])
        use_fake("postgresql", connection)

        out = outputs(_sql_core.run(call_params("postgresql"), log))

        assert calls(connection) == [
            ("CALL app.p(a => $1, o => NULL)", [5]),
            ("SELECT * FROM app.p(a => $1)", [5]),
        ]
        assert (columns(out["out_values"]), rows(out["out_values"])) == ([("o", "integer")], [[10]])
        assert (rows(out["rows"]), out["row_count"]) == ([], 0)

    def test_postgresql_function_without_the_out_column_is_refused(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        no_match = pg_error("42883", "procedure app.p(a => unknown, o => unknown) does not exist")
        connection = FakeConnection([Result(error=no_match), Result(columns=["x"], rows=[(1,)])])
        use_fake("postgresql", connection)

        with pytest.raises(ValueError, match=exact("Out argument 'o' is not a parameter of app.p")):
            _sql_core.run(call_params("postgresql"), log)

    def test_postgresql_has_no_fallback_for_any_other_error(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        failed = pg_error("22012", "division by zero")
        connection = FakeConnection([Result(error=failed)])
        use_fake("postgresql", connection)

        with pytest.raises(ValueError, match=exact("22012: division by zero")):
            _sql_core.run(call_params("postgresql", out_arguments=[]), log)

        assert len(connection.executed) == 1


class TestFailures:
    """A refused call follows On error; SQLite has no procedures (SQL-5, SQL-6)."""

    def test_a_refused_call_records_the_database_error_with_empties(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        missing = TdsError(2812, "Could not find stored procedure 'app.p'.")
        connection = FakeConnection([signature(("@o", "int")), Result(error=missing)])
        use_fake("mssql", connection)
        message = "2812: Could not find stored procedure 'app.p'."

        out = outputs(_sql_core.run(call_params("mssql", on_error="record"), log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "DatabaseError")
        assert out["__block_warning"] is True
        assert (columns(out["rows"]), rows(out["rows"]), out["row_count"]) == ([], [], 0)
        assert (columns(out["out_values"]), rows(out["out_values"])) == ([], [])
        assert log.at("WARN") == [f"Call procedure failed (DatabaseError): {message}"]
        assert connection.closed is True

    def test_sqlite_is_refused_before_the_file_is_opened(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = tmp_path / "t.db"
        params = sqlite_params(path, operation="call_procedure", procedure="p")

        with pytest.raises(ValueError, match=exact(NOT_ON_SQLITE)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, NOT_ON_SQLITE, "Validation")
        assert (out["row_count"], rows(out["rows"]), rows(out["out_values"])) == (0, [], [])
        assert log.at("WARN") == [f"Call procedure failed (Validation): {NOT_ON_SQLITE}"]
        assert log.at("INFO") == []
        assert not path.exists()


class TestTheConnection:
    """A call runs on an autocommit connection that is closed afterward (SQL-1)."""

    @pytest.mark.parametrize(
        ("database_type", "script", "connected"),
        [
            pytest.param(
                "postgresql",
                [Result(columns=["o"], rows=[(1,)])],
                "Connected to PostgreSQL 9.9 at db:5432",
                id="postgresql",
            ),
            pytest.param(
                "mysql",
                [Result(), Result(columns=["o"], rows=[(1,)])],
                "Connected to MySQL 9.9 at db:3306",
                id="mysql",
            ),
            pytest.param(
                "mssql",
                [signature(("@o", "int")), Result(columns=["o"], rows=[(1,)])],
                "Connected to SQL Server 9.9 at db:1433",
                id="mssql",
            ),
        ],
    )
    def test_autocommit_is_on_and_the_connection_is_closed(
        self,
        use_fake: Any,
        log: LogRecorder,
        database_type: str,
        script: list[Result],
        connected: str,
    ) -> None:
        connection = FakeConnection(script, version="9.9")
        use_fake(database_type, connection)

        out = outputs(_sql_core.run(call_params(database_type), log))

        assert out["success"] is True
        assert connection.autocommit_calls[-1] is True
        assert connection.closed is True
        assert log.at("INFO")[0] == connected


class TestTheConsoleLine:
    """A finished call writes one console line: its rows, its out values, its time (REQ-3.4.1.6)."""

    @staticmethod
    def called(row_count: int, out_count: int) -> str:
        return rf"^Called app\.p: {row_count} rows, {out_count} out values, \d+ ms$"

    @pytest.mark.parametrize(
        ("database_type", "script", "overrides", "row_count", "out_count"),
        [
            pytest.param(
                "postgresql", [Result(columns=["o"], rows=[(42,)])], {}, 0, 1, id="out-values-only"
            ),
            pytest.param(
                "mysql",
                [
                    Result(columns=["id"], rows=[(1,), (2,), (3,)]),
                    Result(columns=["o"], rows=[(9,)]),
                ],
                {},
                3,
                1,
                id="rows-and-out-values",
            ),
            pytest.param(
                "mssql",
                [
                    signature(("@a", "int"), ("@o", "int")),
                    Result(
                        columns=["id"],
                        rows=[(1,), (2,)],
                        more=[Result(columns=["o"], rows=[(42,)])],
                    ),
                ],
                {},
                2,
                1,
                id="rows-before-the-out-values",
            ),
            pytest.param(
                "oracle",
                [signature(("A", "NUMBER")), Result()],
                {"out_arguments": []},
                0,
                0,
                id="nothing-back",
            ),
            pytest.param(
                "postgresql",
                [
                    Result(error=pg_error("42809", "app.p(integer) is not a procedure")),
                    Result(columns=["id", "qty"], rows=[(1, 5), (2, 7)]),
                ],
                {"out_arguments": []},
                2,
                0,
                id="function-selected",
            ),
        ],
    )
    def test_the_line_follows_the_connected_line(
        self,
        use_fake: Any,
        log: LogRecorder,
        database_type: str,
        script: list[Result],
        overrides: dict[str, Any],
        row_count: int,
        out_count: int,
    ) -> None:
        use_fake(database_type, FakeConnection(script, version="9.9"))

        _sql_core.run(call_params(database_type, **overrides), log)

        connected, line = log.at("INFO")
        assert connected.startswith("Connected to ")
        assert re.search(self.called(row_count, out_count), line)

    def test_the_line_counts_the_rows_kept_and_comes_before_the_max_rows_warning(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        answer = Result(columns=["id"], rows=[(1,), (2,), (3,)])
        use_fake("mysql", FakeConnection([answer, Result(columns=["o"], rows=[(9,)])]))

        _sql_core.run(call_params("mysql", max_rows=2), log)

        assert [level for level, _line in log] == ["INFO", "INFO", "WARN"]
        assert re.search(self.called(2, 1), log[1][1])
        assert log[2][1] == "Stopped after 2 rows (Max rows)"

    def test_a_refused_call_writes_no_line(self, use_fake: Any, log: LogRecorder) -> None:
        missing = TdsError(2812, "Could not find stored procedure 'app.p'.")
        connection = FakeConnection(
            [signature(("@o", "int")), Result(error=missing)], version="9.9"
        )
        use_fake("mssql", connection)

        _sql_core.run(call_params("mssql", on_error="record"), log)

        assert log.at("INFO") == ["Connected to SQL Server 9.9 at db:1433"]


async def run_block(params: dict[str, Any], log: LogRecorder) -> dict[str, Any]:
    """One SQL Client in the engine's order: validate, then execute."""
    plugin = SQLClientPlugin()
    await plugin.validate(params)
    result: dict[str, Any] = await plugin.execute(sql_context(params, log))
    return result


class TestNullEntries:
    """A null Arguments value binds NULL; an Out argument is a name, so a null one fails
    naming its row before anything is dialed (REQ-3.1.3.20, REQ-3.1.3.21)."""

    async def test_a_null_argument_binds_null_through_the_block(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([Result(columns=["o"], rows=[(1,)])])
        use_fake("postgresql", connection)
        params = call_params("postgresql", arguments={"a": None}, out_arguments=[{"value": "o"}])

        out = await run_block(params, log)

        assert calls(connection) == [("CALL app.p(a => $1, o => NULL)", [None])]
        assert out["success"] is True

    @pytest.mark.parametrize(
        ("out_arguments", "row"),
        [
            pytest.param([{"value": None}], 1, id="first-row"),
            pytest.param([{"value": "total"}, {"value": None}], 2, id="second-row"),
        ],
    )
    async def test_a_null_out_argument_fails_naming_its_row(
        self, use_fake: Any, log: LogRecorder, out_arguments: list[Any], row: int
    ) -> None:
        connection = FakeConnection([Result(columns=["total"], rows=[(1,)])])
        fake = use_fake("postgresql", connection)
        params = call_params("postgresql", out_arguments=out_arguments)

        with pytest.raises(NullValueError, match=exact(f"Row {row} in 'out_arguments' is null")):
            await run_block(params, log)

        assert fake.connects == []
        assert calls(connection) == []
