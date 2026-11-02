"""Call procedure: the call statement and the out signature (REQ-3.4.1.6, REQ-5.1.4, SQL-6).

Named notation on PostgreSQL, Oracle and SQL Server; positional session variables read
back on MySQL; out values as NULL / None slots, OUTPUT variables or @wave_ variables.
"""

from decimal import Decimal
from typing import Any

import pytest

from tests.connectivity.sql.fakes import FakeConnection, Result
from wavecore.connectivity.sql._procedure import Call, build_call, function_select, read_signature

INT_OUT = {"o": "int"}


def call(
    dialect: str,
    arguments: list[tuple[str, Any]],
    out_arguments: list[str],
    signature: dict[str, str] | None = None,
) -> Call:
    return build_call(dialect, "app.p", arguments, out_arguments, signature or {})


def exec_part(statement: str) -> tuple[str, str]:
    """A SQL Server batch split into its DECLARE lead and the text from EXEC on."""
    lead, _, rest = statement.partition("EXEC ")
    return lead, f"EXEC {rest}"


class TestInAndOut:
    """Procedure app.p, argument a = 5, out argument o (SQL-6)."""

    def test_postgresql(self) -> None:
        assert call("postgresql", [("a", 5)], ["o"]) == Call(
            setup=[], call=("CALL app.p(a => $1, o => NULL)", (5,)), fetch=None
        )

    def test_mysql(self) -> None:
        assert call("mysql", [("a", 5)], ["o"]) == Call(
            setup=[],
            call=("CALL app.p(%s, @wave_o)", (5,)),
            fetch=("SELECT @wave_o AS `o`", None),
        )

    def test_oracle(self) -> None:
        assert call("oracle", [("a", 5)], ["o"]) == Call(
            setup=[], call=("BEGIN app.p(a => :1, o => :2); END;", [5, None]), fetch=None
        )

    def test_mssql(self) -> None:
        assert call("mssql", [("a", 5)], ["o"], INT_OUT) == Call(
            setup=[],
            call=(
                "DECLARE @wave_o int; EXEC app.p @a = %s, @o = @wave_o OUTPUT; "
                "SELECT @wave_o AS [o];",
                (5,),
            ),
            fetch=None,
        )


class TestInOnly:
    """No Out arguments: no out slot, no fetch."""

    @pytest.mark.parametrize(
        ("dialect", "statement", "binds"),
        [
            ("postgresql", "CALL app.p(a => $1)", (5,)),
            ("mysql", "CALL app.p(%s)", (5,)),
            ("oracle", "BEGIN app.p(a => :1); END;", [5]),
            ("mssql", "EXEC app.p @a = %s;", (5,)),
        ],
    )
    def test_in_only(self, dialect: str, statement: str, binds: Any) -> None:
        assert call(dialect, [("a", 5)], []) == Call(setup=[], call=(statement, binds), fetch=None)


class TestNoArguments:
    """Neither Arguments nor Out arguments: an empty call and nothing bound."""

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            ("postgresql", "CALL app.p()"),
            ("mysql", "CALL app.p()"),
            ("oracle", "BEGIN app.p(); END;"),
            ("mssql", "EXEC app.p;"),
        ],
    )
    def test_no_arguments(self, dialect: str, statement: str) -> None:
        built = call(dialect, [], [])
        assert built.setup == []
        assert built.call[0] == statement
        assert not built.call[1]
        assert built.fetch is None


class TestOutOnly:
    """An out argument absent from Arguments takes a slot after the Arguments."""

    def test_postgresql(self) -> None:
        built = call("postgresql", [], ["o"])
        assert (built.setup, built.call[0], built.fetch) == ([], "CALL app.p(o => NULL)", None)
        assert not built.call[1]

    def test_mysql(self) -> None:
        built = call("mysql", [], ["o"])
        assert built.setup == []
        assert built.call[0] == "CALL app.p(@wave_o)"
        assert not built.call[1]
        assert built.fetch == ("SELECT @wave_o AS `o`", None)

    def test_oracle(self) -> None:
        assert call("oracle", [], ["o"]) == Call(
            setup=[], call=("BEGIN app.p(o => :1); END;", [None]), fetch=None
        )

    def test_mssql(self) -> None:
        built = call("mssql", [], ["o"], INT_OUT)
        assert built.setup == []
        assert built.call[0] == (
            "DECLARE @wave_o int; EXEC app.p @o = @wave_o OUTPUT; SELECT @wave_o AS [o];"
        )
        assert not built.call[1]
        assert built.fetch is None


class TestInOut:
    """A name in both Arguments and Out arguments (value 7) passes its value and reads it back."""

    def test_postgresql_binds_the_value_in_the_out_slot(self) -> None:
        assert call("postgresql", [("a", 5), ("o", 7)], ["o"]) == Call(
            setup=[], call=("CALL app.p(a => $1, o => $2)", (5, 7)), fetch=None
        )

    def test_oracle_binds_the_value_in_the_out_slot(self) -> None:
        assert call("oracle", [("a", 5), ("o", 7)], ["o"]) == Call(
            setup=[], call=("BEGIN app.p(a => :1, o => :2); END;", [5, 7]), fetch=None
        )

    def test_mysql_sets_the_session_variable_first(self) -> None:
        assert call("mysql", [("a", 5), ("o", 7)], ["o"]) == Call(
            setup=[("SET @wave_o = %s", (7,))],
            call=("CALL app.p(%s, @wave_o)", (5,)),
            fetch=("SELECT @wave_o AS `o`", None),
        )

    def test_mysql_in_out_keeps_its_arguments_position(self) -> None:
        assert call("mysql", [("o", 7), ("a", 5)], ["o"]) == Call(
            setup=[("SET @wave_o = %s", (7,))],
            call=("CALL app.p(@wave_o, %s)", (5,)),
            fetch=("SELECT @wave_o AS `o`", None),
        )

    def test_mssql_declares_the_variable_with_its_value_bound_first(self) -> None:
        assert call("mssql", [("a", 5), ("o", 7)], ["o"], INT_OUT) == Call(
            setup=[],
            call=(
                "DECLARE @wave_o int = %s; EXEC app.p @a = %s, @o = @wave_o OUTPUT; "
                "SELECT @wave_o AS [o];",
                (7, 5),
            ),
            fetch=None,
        )


class TestAuthorOrder:
    """Arguments go in the author's order, never sorted."""

    @pytest.mark.parametrize(
        ("dialect", "statement", "binds"),
        [
            ("postgresql", "CALL app.p(b => $1, a => $2)", ("x", 5)),
            ("mysql", "CALL app.p(%s, %s)", ("x", 5)),
            ("oracle", "BEGIN app.p(b => :1, a => :2); END;", ["x", 5]),
            ("mssql", "EXEC app.p @b = %s, @a = %s;", ("x", 5)),
        ],
    )
    def test_several_arguments(self, dialect: str, statement: str, binds: Any) -> None:
        assert call(dialect, [("b", "x"), ("a", 5)], []) == Call(
            setup=[], call=(statement, binds), fetch=None
        )

    def test_values_bound_as_given(self) -> None:
        built = call("postgresql", [("a", Decimal("1.50")), ("b", None), ("c", False)], [])
        assert built.call == (
            "CALL app.p(a => $1, b => $2, c => $3)",
            (Decimal("1.50"), None, False),
        )


class TestAppendedOut:
    """Out arguments not in Arguments follow the Arguments, in Out arguments order."""

    def test_postgresql(self) -> None:
        assert call("postgresql", [("a", 5)], ["o2", "o1"]) == Call(
            setup=[], call=("CALL app.p(a => $1, o2 => NULL, o1 => NULL)", (5,)), fetch=None
        )

    def test_oracle(self) -> None:
        assert call("oracle", [("a", 5)], ["o2", "o1"]) == Call(
            setup=[],
            call=("BEGIN app.p(a => :1, o2 => :2, o1 => :3); END;", [5, None, None]),
            fetch=None,
        )

    def test_mysql(self) -> None:
        assert call("mysql", [("a", 5)], ["o2", "o1"]) == Call(
            setup=[],
            call=("CALL app.p(%s, @wave_o2, @wave_o1)", (5,)),
            fetch=("SELECT @wave_o2 AS `o2`, @wave_o1 AS `o1`", None),
        )

    def test_mysql_in_out_and_appended_out(self) -> None:
        assert call("mysql", [("a", 5), ("io", 7)], ["io", "o"]) == Call(
            setup=[("SET @wave_io = %s", (7,))],
            call=("CALL app.p(%s, @wave_io, @wave_o)", (5,)),
            fetch=("SELECT @wave_io AS `io`, @wave_o AS `o`", None),
        )

    def test_mssql(self) -> None:
        signature = {"o2": "int", "o1": "nvarchar(20)"}
        built = call("mssql", [("a", 5)], ["o2", "o1"], signature)
        lead, rest = exec_part(built.call[0])
        assert rest == (
            "EXEC app.p @a = %s, @o2 = @wave_o2 OUTPUT, @o1 = @wave_o1 OUTPUT; "
            "SELECT @wave_o2 AS [o2], @wave_o1 AS [o1];"
        )
        assert lead.startswith("DECLARE ")
        assert "@wave_o2 int" in lead
        assert "@wave_o1 nvarchar(20)" in lead
        assert "%s" not in lead
        assert built.call[1] == (5,)
        assert (built.setup, built.fetch) == ([], None)

    def test_mssql_in_out_and_appended_out(self) -> None:
        signature = {"io": "int", "o": "nvarchar(20)"}
        built = call("mssql", [("a", 5), ("io", 7)], ["io", "o"], signature)
        lead, rest = exec_part(built.call[0])
        assert rest == (
            "EXEC app.p @a = %s, @io = @wave_io OUTPUT, @o = @wave_o OUTPUT; "
            "SELECT @wave_io AS [io], @wave_o AS [o];"
        )
        assert "@wave_io int = %s" in lead
        assert "@wave_o nvarchar(20)" in lead
        assert built.call[1] == (7, 5)


class TestSqlServerNames:
    """SQL Server adds @ to a name that lacks it and reads the declared type from the signature."""

    def test_at_sign_not_doubled_on_arguments(self) -> None:
        assert call("mssql", [("@a", 5)], []).call == ("EXEC app.p @a = %s;", (5,))

    def test_signature_key_with_at_sign(self) -> None:
        assert call("mssql", [("a", 5)], ["o"], {"@o": "int"}) == call(
            "mssql", [("a", 5)], ["o"], INT_OUT
        )

    def test_out_name_with_at_sign(self) -> None:
        statement = call("mssql", [("a", 5)], ["@o"], {"@o": "int"}).call[0]
        assert "EXEC app.p @a = %s, @o = @wave_o OUTPUT;" in statement
        assert "@@" not in statement
        assert "wave_@" not in statement

    def test_declared_type_used_as_written(self) -> None:
        built = call("mssql", [("a", 5)], ["o"], {"o": "decimal(10,2)"})
        assert built.call == (
            "DECLARE @wave_o decimal(10,2); EXEC app.p @a = %s, @o = @wave_o OUTPUT; "
            "SELECT @wave_o AS [o];",
            (5,),
        )


class TestSignatureNotNeeded:
    """Only SQL Server's statement reads the signature; Oracle's out slots stay None."""

    @pytest.mark.parametrize("dialect", ["postgresql", "mysql", "oracle"])
    def test_signature_changes_nothing(self, dialect: str) -> None:
        signature = {"a": "NUMBER", "o": "VARCHAR2", "A": "NUMBER", "O": "VARCHAR2"}
        assert call(dialect, [("a", 5)], ["o"], signature) == call(dialect, [("a", 5)], ["o"])


class TestReadSignature:
    """Oracle and SQL Server declare out types in their argument catalog; the others need none."""

    @pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
    def test_no_query_where_no_type_is_needed(self, dialect: str) -> None:
        connection = FakeConnection()
        assert read_signature(connection, dialect, "app.p") == {}
        assert connection.executed == []

    @pytest.mark.parametrize("dialect", ["oracle", "mssql"])
    def test_declared_types_in_argument_order(self, dialect: str) -> None:
        rows = [("A", "NUMBER"), ("O", "VARCHAR2")]
        connection = FakeConnection([Result(columns=["argument_name", "data_type"], rows=rows)])
        signature = read_signature(connection, dialect, "app.p")
        assert signature == {"A": "NUMBER", "O": "VARCHAR2"}
        assert list(signature) == ["A", "O"]
        assert len(connection.executed) == 1

    @pytest.mark.parametrize("dialect", ["oracle", "mssql"])
    def test_only_the_first_two_columns_are_read(self, dialect: str) -> None:
        rows = [("@a", "int", 1), ("@o", "nvarchar", 2)]
        columns = ["name", "type", "position"]
        connection = FakeConnection([Result(columns=columns, rows=rows)])
        assert read_signature(connection, dialect, "app.p") == {"@a": "int", "@o": "nvarchar"}

    @pytest.mark.parametrize("dialect", ["oracle", "mssql"])
    def test_procedure_without_arguments(self, dialect: str) -> None:
        connection = FakeConnection([Result(columns=["argument_name", "data_type"], rows=[])])
        assert read_signature(connection, dialect, "app.p") == {}


class TestTheFunctionForm:
    """PostgreSQL: a function is selected with its Arguments only (SQL-6)."""

    def test_the_arguments_only_in_the_list_order(self) -> None:
        assert function_select("app.f", [("b", "x"), ("a", 5)]) == (
            "SELECT * FROM app.f(b => $1, a => $2)",
            ("x", 5),
        )

    def test_no_arguments_binds_nothing(self) -> None:
        assert function_select("app.f", []) == ("SELECT * FROM app.f()", None)
