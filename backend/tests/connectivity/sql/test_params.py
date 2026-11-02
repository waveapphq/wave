"""`:name` placeholders and their driver binds (REQ-3.4.1.6 SQL-2, REQ-5.1.4, REQ-3.3.3.3).

The author writes `:name` on all five databases; WAVE finds each one outside quotes,
quoted names and comments and hands the driver its own form: `$n` on PostgreSQL, `%s` on
MySQL and SQL Server, the named form unchanged on Oracle and SQLite. Values stay typed.
"""

import re
from decimal import Decimal

import pytest

from wavecore.connectivity.sql._params import Placeholder, bind_params, placeholders

ALL_TYPES = ("postgresql", "mysql", "oracle", "mssql", "sqlite")
PERCENT_TYPES = ("mysql", "mssql")
NAMED_TYPES = ("oracle", "sqlite")

# Regions every dialect's lexer skips, each hiding `:x`.
COMMON_REGIONS = ("':x'", "'it''s :x'", '":x"', "-- :x", "/* :x */")
# Regions only one dialect's lexer knows, each hiding `:x`.
DIALECT_REGIONS = {
    "postgresql": ("$$ :x $$", "$fn$ :x $fn$", "E'\\' :x'"),
    "mysql": ("`:x`", "# :x", "'\\' :x'", '"\\" :x"'),
    "oracle": ("q'[it's :x]'", "q'{:x}'", "q'(:x)'", "q'<:x>'", "q'!:x!'"),
    "sqlite": ("[:x]", "`:x`"),
    "mssql": ("[:x]",),
}
ORACLE_TRIGGER_HEADS = (
    "CREATE TRIGGER",
    "CREATE OR REPLACE TRIGGER",
    "CREATE EDITIONABLE TRIGGER",
    "CREATE OR REPLACE NONEDITIONABLE TRIGGER",
    "create or replace trigger",
)


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def undefined(name: str) -> str:
    return exact(f"Parameter '{name}' is used in the SQL but not defined")


def names(database_type: str, statement: str) -> list[str]:
    return [placeholder.name for placeholder in placeholders(database_type, statement)]


def oracle_trigger(head: str, body: str) -> str:
    return f"{head} trg BEFORE UPDATE ON t FOR EACH ROW\nBEGIN\n  {body}\nEND;"


class TestPlaceholders:
    """A placeholder is `:` then a name, outside every skipped region, not after another `:`."""

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_names_and_offsets_in_statement_order(self, database_type: str) -> None:
        assert placeholders(database_type, "SELECT :a, :b_2 FROM t WHERE c = :a") == [
            ("a", 7, 9),
            ("b_2", 11, 15),
            ("a", 33, 35),
        ]

    def test_a_placeholder_is_a_named_tuple_of_name_start_and_end(self) -> None:
        [found] = placeholders("postgresql", "WHERE id = :id")

        assert found == Placeholder(name="id", start=11, end=14)
        assert (found.name, found.start, found.end) == ("id", 11, 14)

    @pytest.mark.parametrize("region", COMMON_REGIONS)
    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_a_common_region_hides_its_names(self, database_type: str, region: str) -> None:
        assert names(database_type, f"SELECT {region}\n, :y") == ["y"]

    @pytest.mark.parametrize(
        ("database_type", "region"),
        [(t, region) for t, regions in DIALECT_REGIONS.items() for region in regions],
    )
    def test_a_dialect_region_hides_its_names(self, database_type: str, region: str) -> None:
        assert names(database_type, f"SELECT {region}\n, :y") == ["y"]

    @pytest.mark.parametrize(
        "statement",
        [
            "SELECT x::int",
            "SELECT x::text",
            "BEGIN a := 1; END;",
            "SELECT a[1:2] FROM t",
            "SELECT :1",
            "SELECT '12:30'",
        ],
    )
    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_casts_assignments_slices_and_digits_are_not_placeholders(
        self, database_type: str, statement: str
    ) -> None:
        assert placeholders(database_type, statement) == []

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_a_placeholder_followed_by_a_cast_is_a_placeholder(self, database_type: str) -> None:
        assert placeholders(database_type, "SELECT :id::int") == [("id", 7, 10)]

    def test_a_name_in_an_array_slice_is_a_placeholder(self) -> None:
        assert names("postgresql", "SELECT a[1:n] FROM t") == ["n"]

    def test_a_hash_hides_nothing_on_postgresql(self) -> None:
        assert names("postgresql", "SELECT 5 # :x") == ["x"]

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_names_are_case_sensitive(self, database_type: str) -> None:
        assert names(database_type, "SELECT :Id, :id") == ["Id", "id"]

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_a_name_is_ascii_letters_digits_and_underscores_only(self, database_type: str) -> None:
        assert placeholders(database_type, "SELECT :n\u00e4me, :\u00e9a, :a\u0661") == [
            ("n", 7, 9),
            ("a", 19, 21),
        ]

    @pytest.mark.parametrize("opening", ["'a", '"a', "/* a"])
    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_an_unterminated_region_hides_the_rest(self, database_type: str, opening: str) -> None:
        assert placeholders(database_type, f"SELECT {opening} :x") == []

    @pytest.mark.parametrize(
        ("database_type", "opening"),
        [
            ("postgresql", "$$"),
            ("postgresql", "$fn$"),
            ("postgresql", "E'"),
            ("mysql", "`"),
            ("oracle", "q'["),
            ("sqlite", "["),
            ("sqlite", "`"),
            ("mssql", "["),
        ],
    )
    def test_an_unterminated_dialect_region_hides_the_rest(
        self, database_type: str, opening: str
    ) -> None:
        assert placeholders(database_type, f"SELECT {opening} :x") == []

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_a_statement_without_a_placeholder_has_none(self, database_type: str) -> None:
        assert placeholders(database_type, "SELECT 1") == []

    @pytest.mark.parametrize("region", ["E'\\' :x'", "e'\\' :x'"])
    def test_an_escape_string_in_either_case_hides_its_names_on_postgresql(
        self, region: str
    ) -> None:
        assert names("postgresql", f"SELECT {region}\n, :y") == ["y"]

    @pytest.mark.parametrize(
        "region", ["q'[it's :x]'", "Q'[it's :x]'", "Q'{it's :x}'", "Q'!it's :x!'"]
    )
    def test_an_alternative_quote_in_either_case_hides_its_names_on_oracle(
        self, region: str
    ) -> None:
        assert names("oracle", f"SELECT {region}\n, :y FROM dual") == ["y"]

    def test_a_nested_block_comment_hides_its_names_on_postgresql(self) -> None:
        assert names("postgresql", "SELECT /* a /* b */ :x */ :y") == ["y"]

    @pytest.mark.parametrize("database_type", ["mysql", "oracle", "mssql", "sqlite"])
    def test_a_block_comment_ends_at_its_first_close_elsewhere(self, database_type: str) -> None:
        assert names(database_type, "SELECT /* a /* b */ :x */ :y") == ["x", "y"]


class TestOracleTriggerRows:
    """In an Oracle trigger `:new` and `:old`, in any case, are row references, not placeholders."""

    @pytest.mark.parametrize("head", ORACLE_TRIGGER_HEADS)
    def test_new_and_old_are_not_placeholders(self, head: str) -> None:
        statement = oracle_trigger(head, ":NEW.total := :old.total + :New.qty;")

        assert placeholders("oracle", statement) == []

    def test_other_names_in_a_trigger_are_placeholders(self) -> None:
        statement = oracle_trigger("CREATE OR REPLACE TRIGGER", ":new.region := :newest;")

        assert names("oracle", statement) == ["newest"]

    def test_new_and_old_outside_a_trigger_are_placeholders(self) -> None:
        assert names("oracle", "SELECT :new, :old FROM dual") == ["new", "old"]

    def test_new_in_a_sqlite_trigger_is_a_placeholder(self) -> None:
        statement = "CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES (:new); END"

        assert names("sqlite", statement) == ["new"]

    def test_a_trigger_binds_nothing_for_new_and_old(self) -> None:
        statement = oracle_trigger("CREATE TRIGGER", ":new.id := :old.id;")

        assert bind_params("oracle", statement, {}) == (statement, None)


class TestBindParams:
    """Each database gets its own placeholder form; one entry serves every use of its name."""

    def test_postgresql_numbers_by_first_appearance(self) -> None:
        assert bind_params("postgresql", "SELECT :a, :b, :a", {"a": 1, "b": "x"}) == (
            "SELECT $1, $2, $1",
            (1, "x"),
        )

    def test_postgresql_numbers_do_not_follow_the_names(self) -> None:
        assert bind_params("postgresql", "SELECT :b, :a, :b", {"a": 1, "b": 2}) == (
            "SELECT $1, $2, $1",
            (2, 1),
        )

    def test_postgresql_keeps_a_cast_after_the_placeholder(self) -> None:
        assert bind_params("postgresql", "SELECT :id::int", {"id": 5}) == ("SELECT $1::int", (5,))

    @pytest.mark.parametrize("database_type", PERCENT_TYPES)
    def test_percent_types_bind_per_occurrence(self, database_type: str) -> None:
        assert bind_params(database_type, "SELECT :a, :b, :a", {"a": 1, "b": "x"}) == (
            "SELECT %s, %s, %s",
            (1, "x", 1),
        )

    @pytest.mark.parametrize("database_type", NAMED_TYPES)
    def test_named_types_keep_the_statement_and_bind_a_dict(self, database_type: str) -> None:
        assert bind_params(database_type, "SELECT :a, :b, :a", {"a": 1, "b": "x"}) == (
            "SELECT :a, :b, :a",
            {"a": 1, "b": "x"},
        )

    @pytest.mark.parametrize("database_type", PERCENT_TYPES)
    def test_percent_types_double_every_other_percent(self, database_type: str) -> None:
        assert bind_params(database_type, "SELECT '50%', 5 % 2, :a", {"a": 1}) == (
            "SELECT '50%%', 5 %% 2, %s",
            (1,),
        )

    @pytest.mark.parametrize("database_type", PERCENT_TYPES)
    def test_percent_types_leave_percent_alone_without_a_placeholder(
        self, database_type: str
    ) -> None:
        assert bind_params(database_type, "SELECT '50%'", {}) == ("SELECT '50%'", None)

    def test_postgresql_leaves_percent_alone(self) -> None:
        assert bind_params("postgresql", "SELECT '50%', 5 % 2, :a", {"a": 1}) == (
            "SELECT '50%', 5 % 2, $1",
            (1,),
        )

    @pytest.mark.parametrize("database_type", NAMED_TYPES)
    def test_named_types_leave_percent_alone(self, database_type: str) -> None:
        statement = "SELECT '50%', 5 % 2, :a"

        assert bind_params(database_type, statement, {"a": 1}) == (statement, {"a": 1})

    @pytest.mark.parametrize("params", [{}, {"a": 1}])
    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_a_statement_without_a_placeholder_is_returned_unchanged(
        self, database_type: str, params: dict[str, int]
    ) -> None:
        assert bind_params(database_type, "SELECT 1", params) == ("SELECT 1", None)

    @pytest.mark.parametrize(
        ("database_type", "binds"),
        [
            ("postgresql", (1,)),
            ("mysql", (1,)),
            ("mssql", (1,)),
            ("oracle", {"a": 1}),
            ("sqlite", {"a": 1}),
        ],
    )
    def test_unused_entries_are_never_bound(
        self, database_type: str, binds: tuple[int] | dict[str, int]
    ) -> None:
        _statement, bound = bind_params(database_type, "SELECT :a", {"a": 1, "b": 2, "c": 3})

        assert bound == binds

    @pytest.mark.parametrize("database_type", ["postgresql", *PERCENT_TYPES])
    def test_empty_text_binds_as_empty_text_and_null_binds_null(self, database_type: str) -> None:
        """Empty text is a value, null is NULL; a number stays a number (SQL-2, REQ-3.1.3.22)."""
        values = {"e": "", "n": None, "z": 0, "f": False, "d": Decimal("1.50")}

        _statement, bound = bind_params(database_type, "SELECT :e, :n, :z, :f, :d", values)

        assert bound == ("", None, 0, False, Decimal("1.50"))
        assert [type(value) for value in bound] == [str, type(None), int, bool, Decimal]
        assert str(bound[4]) == "1.50"

    @pytest.mark.parametrize("database_type", NAMED_TYPES)
    def test_named_types_bind_empty_text_as_empty_text_and_null_as_null(
        self, database_type: str
    ) -> None:
        values = {"e": "", "n": None, "z": 0, "f": False, "d": Decimal("1.50")}

        _statement, bound = bind_params(database_type, "SELECT :e, :n, :z, :f, :d", values)

        assert bound == {"e": "", "n": None, "z": 0, "f": False, "d": Decimal("1.50")}
        assert [type(bound[name]) for name in "enzfd"] == [
            str,
            type(None),
            int,
            bool,
            Decimal,
        ]
        assert str(bound["d"]) == "1.50"

    @pytest.mark.parametrize(
        ("database_type", "binds"),
        [
            ("postgresql", ("  ",)),
            ("mysql", ("  ",)),
            ("mssql", ("  ",)),
            ("oracle", {"s": "  "}),
            ("sqlite", {"s": "  "}),
        ],
    )
    def test_a_value_of_only_spaces_binds_as_written(
        self, database_type: str, binds: tuple[str] | dict[str, str]
    ) -> None:
        """Only null is NULL; spaces are a value (SQL-2)."""
        _statement, bound = bind_params(database_type, "SELECT :s", {"s": "  "})

        assert bound == binds

    @pytest.mark.parametrize(
        ("database_type", "statement", "translated", "binds"),
        [
            ("postgresql", "SELECT $fn$ :x $fn$, :y", "SELECT $fn$ :x $fn$, $1", (1,)),
            ("mysql", "SELECT 1 # :x\n, :y", "SELECT 1 # :x\n, %s", (1,)),
            ("mssql", "SELECT [:x], :y", "SELECT [:x], %s", (1,)),
            ("oracle", "SELECT q'[:x]', :y FROM dual", "SELECT q'[:x]', :y FROM dual", {"y": 1}),
            ("sqlite", "SELECT [:x], :y", "SELECT [:x], :y", {"y": 1}),
        ],
    )
    def test_a_skipped_region_is_carried_through_untouched(
        self,
        database_type: str,
        statement: str,
        translated: str,
        binds: tuple[int] | dict[str, int],
    ) -> None:
        assert bind_params(database_type, statement, {"y": 1}) == (translated, binds)


class TestUndefinedPlaceholder:
    """A placeholder with no entry fails before anything is sent, naming it (SQL-2)."""

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_an_undefined_name_is_refused(self, database_type: str) -> None:
        with pytest.raises(ValueError, match=undefined("x")):
            bind_params(database_type, "SELECT :x", {})

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_the_first_undefined_name_in_statement_order_is_named(self, database_type: str) -> None:
        with pytest.raises(ValueError, match=undefined("c")):
            bind_params(database_type, "SELECT :a, :c, :b", {"a": 1})

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_an_entry_in_another_case_does_not_define_the_name(self, database_type: str) -> None:
        with pytest.raises(ValueError, match=undefined("A")):
            bind_params(database_type, "SELECT :A", {"a": 1})

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_a_name_only_in_a_comment_or_string_is_never_required(self, database_type: str) -> None:
        statement = "SELECT ':x', \"y:z\" -- :w\n/* :v */"

        assert bind_params(database_type, statement, {}) == (statement, None)
