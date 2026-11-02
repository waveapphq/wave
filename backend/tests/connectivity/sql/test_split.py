"""Script splitting and session-state words (REQ-3.4.1.6 SQL-3, REQ-5.1.4).

A script is split the way the database's own tool splits it: `;` on PostgreSQL, MySQL,
Oracle and SQLite, a `GO` line on SQL Server, a `/` line after an Oracle PL/SQL block,
MySQL's DELIMITER and SQLite's trigger bodies. Quotes and comments never split.
"""

import pytest

from wavecore.connectivity.sql._split import Statement, session_state_word, split_script

SEMICOLON_TYPES = ("postgresql", "mysql", "oracle", "sqlite")
ALL_TYPES = (*SEMICOLON_TYPES, "mssql")

# Regions every dialect's lexer skips.
COMMON_REGIONS = ("'a;b'", "'it''s;'", '"a;b"', "-- a;b", "/* a;b */")
# Regions only one dialect's lexer knows, by database type.
DIALECT_REGIONS = {
    "postgresql": ("$$ a; b $$", "$fn$ a; b $fn$", "$fn$ a; $$ b; $$ c; $fn$", "E'a\\';b'"),
    "mysql": ("`a;b`", "# a;b", "'a\\';b'", '"a\\";b"'),
    "oracle": ("q'[a;b]'", "q'{a;b}'", "q'(a;b)'", "q'<a;b>'", "q'!a;b!'", "q'[it's;b]'"),
    "sqlite": ("[a;b]", "`a;b`"),
}
# Openings of dialect regions that never close.
DIALECT_UNTERMINATED = {
    "postgresql": ("$$ a", "$fn$ a", "E'a"),
    "mysql": ("`a", "'a\\'"),
    "oracle": ("q'[a",),
    "sqlite": ("[a", "`a"),
}


def texts(database_type: str, script: str) -> list[str]:
    return [statement.text for statement in split_script(database_type, script)]


def positions(database_type: str, script: str) -> list[tuple[int, int]]:
    return [(s.line, s.column) for s in split_script(database_type, script)]


def blocks(database_type: str, script: str) -> list[tuple[str, bool]]:
    return [(s.text, s.block) for s in split_script(database_type, script)]


class TestDollarQuoteTags:
    """A dollar-quote tag is ASCII letters, digits and underscores, never a digit first."""

    @pytest.mark.parametrize("tag", ["$$", "$t$", "$t_1$", "$_T9$"])
    def test_a_tag_hides_the_separators_inside(self, tag: str) -> None:
        assert texts("postgresql", f"SELECT {tag} a; b {tag}") == [f"SELECT {tag} a; b {tag}"]

    @pytest.mark.parametrize("tag", ["$t\u00e4$", "$\u00e9$", "$1$", "$t\u0661$"])
    def test_a_tag_with_another_character_is_no_tag(self, tag: str) -> None:
        assert texts("postgresql", f"SELECT {tag} a; b {tag}") == [f"SELECT {tag} a", f"b {tag}"]


class TestSemicolonSeparator:
    """`;` ends a statement on PostgreSQL, MySQL, Oracle and SQLite and is not kept."""

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_statements_come_back_in_script_order(self, database_type: str) -> None:
        assert texts(database_type, "SELECT 1; SELECT 2;SELECT 3") == [
            "SELECT 1",
            "SELECT 2",
            "SELECT 3",
        ]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_texts_are_trimmed_and_the_separator_is_dropped(self, database_type: str) -> None:
        assert texts(database_type, "  SELECT 1  ;\n\n  SELECT 2 ;  ") == ["SELECT 1", "SELECT 2"]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_statement_is_a_named_tuple_of_text_line_column_and_block(
        self, database_type: str
    ) -> None:
        statements = split_script(database_type, "SELECT 1")

        assert statements == [Statement(text="SELECT 1", line=1, column=1, block=False)]
        assert (statements[0].text, statements[0].line) == ("SELECT 1", 1)
        assert (statements[0].column, statements[0].block) == (1, False)

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_positions_on_one_line_point_at_each_first_character(self, database_type: str) -> None:
        assert positions(database_type, "SELECT 1; SELECT 2") == [(1, 1), (1, 11)]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_statement_after_a_line_break_starts_at_its_first_character(
        self, database_type: str
    ) -> None:
        assert positions(database_type, "SELECT 1;\n  SELECT 2") == [(1, 1), (2, 3)]

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_leading_blank_lines_move_the_first_statement(self, database_type: str) -> None:
        assert positions(database_type, "\n\n   SELECT 1") == [(3, 4)]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_statement_spanning_lines_keeps_its_line_breaks(self, database_type: str) -> None:
        assert texts(database_type, "SELECT a,\n       b\nFROM t;") == [
            "SELECT a,\n       b\nFROM t"
        ]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_leading_comment_stays_in_the_statement_text(self, database_type: str) -> None:
        statements = split_script(database_type, "-- lead\nSELECT 1; SELECT 2")

        assert [(s.text, s.line, s.column) for s in statements] == [
            ("-- lead\nSELECT 1", 1, 1),
            ("SELECT 2", 2, 11),
        ]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_plain_statements_are_not_blocks(self, database_type: str) -> None:
        assert [s.block for s in split_script(database_type, "SELECT 1; SELECT 2")] == [
            False,
            False,
        ]

    @pytest.mark.parametrize("database_type", ["postgresql", "mysql", "sqlite"])
    def test_transaction_statements_split_like_any_other(self, database_type: str) -> None:
        """WAVE opens no transaction of its own; BEGIN and COMMIT are statements."""
        assert texts(database_type, "BEGIN; UPDATE t SET a = 1; COMMIT;") == [
            "BEGIN",
            "UPDATE t SET a = 1",
            "COMMIT",
        ]


class TestQuotedAndCommentedSeparators:
    """A separator inside a quote, a quoted name or a comment never splits."""

    @pytest.mark.parametrize("region", COMMON_REGIONS)
    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_semicolon_in_a_common_region_never_splits(
        self, database_type: str, region: str
    ) -> None:
        assert texts(database_type, f"SELECT 1 {region}\n; SELECT 2") == [
            f"SELECT 1 {region}",
            "SELECT 2",
        ]

    @pytest.mark.parametrize(
        ("database_type", "region"),
        [(t, region) for t, regions in DIALECT_REGIONS.items() for region in regions],
    )
    def test_a_semicolon_in_a_dialect_region_never_splits(
        self, database_type: str, region: str
    ) -> None:
        assert texts(database_type, f"SELECT 1 {region}\n; SELECT 2") == [
            f"SELECT 1 {region}",
            "SELECT 2",
        ]

    @pytest.mark.parametrize("database_type", ["postgresql", "oracle", "sqlite"])
    def test_a_backslash_escapes_no_quote_outside_mysql(self, database_type: str) -> None:
        assert texts(database_type, "SELECT 'C:\\'; SELECT 2") == ["SELECT 'C:\\'", "SELECT 2"]

    def test_a_hash_starts_no_comment_on_postgresql(self) -> None:
        assert texts("postgresql", "SELECT 5 # 3; SELECT 2") == ["SELECT 5 # 3", "SELECT 2"]

    @pytest.mark.parametrize("opening", ["'a", '"a', "/* a"])
    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_an_unterminated_region_runs_to_the_end_of_the_script(
        self, database_type: str, opening: str
    ) -> None:
        script = f"SELECT 1 {opening}; SELECT 2"

        assert texts(database_type, script) == [script]

    @pytest.mark.parametrize(
        ("database_type", "opening"),
        [(t, opening) for t, openings in DIALECT_UNTERMINATED.items() for opening in openings],
    )
    def test_an_unterminated_dialect_region_runs_to_the_end_of_the_script(
        self, database_type: str, opening: str
    ) -> None:
        script = f"SELECT 1 {opening}; SELECT 2"

        assert texts(database_type, script) == [script]


class TestDroppedPieces:
    """A piece holding only whitespace and comments is dropped; numbering counts kept pieces."""

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_empty_and_comment_only_pieces_are_dropped(self, database_type: str) -> None:
        script = "SELECT 1;;  ;\n-- note\n;SELECT 2; -- done"

        assert texts(database_type, script) == ["SELECT 1", "SELECT 2"]
        assert positions(database_type, script) == [(1, 1), (3, 2)]

    @pytest.mark.parametrize("script", ["", "  \n\t ", "-- a\n/* b */", "/* a */\n-- b\n"])
    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_a_script_without_a_statement_yields_none(
        self, database_type: str, script: str
    ) -> None:
        assert split_script(database_type, script) == []


class TestMysqlDelimiter:
    """A `DELIMITER <token>` line changes MySQL's separator from the next line on."""

    _PROCEDURE = (
        "DELIMITER //\n"
        "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END//\n"
        "DELIMITER ;\n"
        "CALL p();"
    )

    def test_the_delimiter_lines_change_the_separator_and_are_not_sent(self) -> None:
        assert texts("mysql", self._PROCEDURE) == [
            "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END",
            "CALL p()",
        ]

    def test_positions_count_the_delimiter_lines(self) -> None:
        assert positions("mysql", self._PROCEDURE) == [(2, 1), (4, 1)]

    def test_a_procedure_body_is_not_a_block(self) -> None:
        assert [s.block for s in split_script("mysql", self._PROCEDURE)] == [False, False]

    def test_the_keyword_is_case_insensitive(self) -> None:
        script = "delimiter //\nSELECT 1; SELECT 2//\ndelimiter ;\nSELECT 3; SELECT 4"

        assert texts("mysql", script) == ["SELECT 1; SELECT 2", "SELECT 3", "SELECT 4"]

    def test_a_token_ends_every_statement_until_it_is_restored(self) -> None:
        script = "DELIMITER $$\nSELECT 1; SELECT 2$$\nSELECT 3$$\nDELIMITER ;\nSELECT 4; SELECT 5"

        assert texts("mysql", script) == [
            "SELECT 1; SELECT 2",
            "SELECT 3",
            "SELECT 4",
            "SELECT 5",
        ]

    def test_the_token_inside_a_string_never_splits(self) -> None:
        script = "DELIMITER //\nSELECT '//' //\nDELIMITER ;"

        assert texts("mysql", script) == ["SELECT '//'"]

    @pytest.mark.parametrize("database_type", ["postgresql", "oracle", "sqlite"])
    def test_delimiter_means_nothing_on_other_types(self, database_type: str) -> None:
        assert texts(database_type, "DELIMITER //\nSELECT 1; SELECT 2") == [
            "DELIMITER //\nSELECT 1",
            "SELECT 2",
        ]


class TestSqliteTrigger:
    """A SQLite trigger body is one statement up to the `;` after its END."""

    _TRIGGER = (
        "CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES (1); "
        "UPDATE c SET x = 1; END"
    )

    def test_the_body_is_one_statement_ending_at_end(self) -> None:
        script = f"{self._TRIGGER}; SELECT 1"

        assert blocks("sqlite", script) == [(self._TRIGGER, False), ("SELECT 1", False)]
        assert positions("sqlite", script) == [(1, 1), (1, 93)]

    @pytest.mark.parametrize(
        "head", ["CREATE TEMP TRIGGER", "CREATE TEMPORARY TRIGGER", "create temp trigger"]
    )
    def test_temporary_and_lowercase_triggers_are_one_statement(self, head: str) -> None:
        trigger = f"{head} t AFTER DELETE ON a BEGIN DELETE FROM b; DELETE FROM c; END"

        assert texts("sqlite", f"{trigger};\nSELECT 1;") == [trigger, "SELECT 1"]

    def test_a_trigger_without_a_closing_semicolon_ends_with_the_script(self) -> None:
        assert texts("sqlite", self._TRIGGER) == [self._TRIGGER]

    @pytest.mark.parametrize("database_type", ["postgresql", "mysql"])
    def test_the_trigger_rule_is_sqlite_only(self, database_type: str) -> None:
        assert texts(database_type, f"{self._TRIGGER}; SELECT 1") == [
            "CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES (1)",
            "UPDATE c SET x = 1",
            "END",
            "SELECT 1",
        ]


class TestSqlServerGo:
    """On SQL Server only a line whose trimmed text is GO separates; `;` stays in the text."""

    def test_a_go_line_separates_batches_and_semicolons_stay(self) -> None:
        assert texts("mssql", "SELECT 1; SELECT 2\nGO\nSELECT 3") == [
            "SELECT 1; SELECT 2",
            "SELECT 3",
        ]

    def test_positions_point_at_each_batch_start(self) -> None:
        assert positions("mssql", "SELECT 1\nGO\nSELECT 3") == [(1, 1), (3, 1)]

    def test_a_trailing_semicolon_is_kept(self) -> None:
        assert texts("mssql", "SELECT 1; SELECT 2;") == ["SELECT 1; SELECT 2;"]

    @pytest.mark.parametrize("line", ["go", "  GO  ", "Go", "\tGO"])
    def test_go_separates_in_any_case_and_padding(self, line: str) -> None:
        assert texts("mssql", f"SELECT 1\n{line}\nSELECT 2") == ["SELECT 1", "SELECT 2"]

    @pytest.mark.parametrize(
        "script",
        [
            "SELECT 1\nGO 5\nSELECT 2",
            "SELECT 1\nGOTO done\nSELECT 2",
            "SELECT 1\n-- GO\nSELECT 2",
            "SELECT '\nGO\n'",
            'SELECT "\nGO\n"',
            "SELECT 1 /*\nGO\n*/",
            "SELECT [\nGO\n]",
        ],
    )
    def test_go_that_is_not_a_whole_line_of_its_own_does_not_separate(self, script: str) -> None:
        assert texts("mssql", script) == [script]

    @pytest.mark.parametrize("opening", ["'a", '"a', "/* a", "[a"])
    def test_a_go_line_after_an_unterminated_region_does_not_separate(self, opening: str) -> None:
        script = f"SELECT 1 {opening}\nGO\nSELECT 2"

        assert texts("mssql", script) == [script]

    @pytest.mark.parametrize(
        "script", ["SELECT 1\nGO\n", "SELECT 1\nGO", "SELECT 1\nGO\nGO\n", "GO\nSELECT 1"]
    )
    def test_a_go_line_at_either_end_leaves_no_empty_statement(self, script: str) -> None:
        assert texts("mssql", script) == ["SELECT 1"]

    def test_a_comment_only_batch_is_dropped(self) -> None:
        assert texts("mssql", "-- setup\nGO\nSELECT 1") == ["SELECT 1"]

    def test_a_batch_is_never_a_block(self) -> None:
        assert blocks("mssql", "BEGIN\n  SELECT 1;\nEND\nGO") == [
            ("BEGIN\n  SELECT 1;\nEND", False)
        ]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_go_is_plain_text_on_other_types(self, database_type: str) -> None:
        assert texts(database_type, "SELECT 1\nGO\nSELECT 2") == ["SELECT 1\nGO\nSELECT 2"]


class TestOraclePlsqlBlocks:
    """An Oracle PL/SQL block keeps its inner `;` and ends at a `/` line or the script's end."""

    _BLOCKS = [
        "DECLARE\n  x NUMBER;\nBEGIN\n  x := 1;\nEND;",
        "CREATE OR REPLACE PROCEDURE app.p AS\nBEGIN\n  NULL;\nEND;",
        "CREATE OR REPLACE PACKAGE BODY app.pkg AS\n  PROCEDURE p IS\n  BEGIN\n"
        "    NULL;\n  END;\nEND;",
        "CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW\nBEGIN\n  :new.id := 1;\nEND;",
        "CREATE OR REPLACE TYPE BODY app.pt AS\n  MEMBER FUNCTION f RETURN NUMBER IS\n"
        "  BEGIN\n    RETURN 1;\n  END;\nEND;",
        "CREATE EDITIONABLE FUNCTION app.f RETURN NUMBER AS\nBEGIN\n  RETURN 1;\nEND;",
        "CREATE NONEDITIONABLE PROCEDURE app.p AS\nBEGIN\n  NULL;\nEND;",
        "CREATE PACKAGE app.pkg AS\n  PROCEDURE p;\nEND;",
        "CREATE OR REPLACE TYPE app.pt AS OBJECT (\n  a NUMBER\n);",
        "CREATE OR REPLACE EDITIONABLE TRIGGER trg AFTER DELETE ON t\nBEGIN\n"
        "  DELETE FROM u;\nEND;",
        "CREATE FUNCTION app.f RETURN NUMBER AS\nBEGIN\n  RETURN 1;\nEND;",
        "begin\n  null;\nend;",
        "declare\n  x number;\nbegin\n  x := 1;\nend;",
    ]

    def test_a_block_between_plain_statements(self) -> None:
        script = "SELECT 1 FROM dual;\nBEGIN\n  NULL;\nEND;\n/\nSELECT 2 FROM dual"

        assert blocks("oracle", script) == [
            ("SELECT 1 FROM dual", False),
            ("BEGIN\n  NULL;\nEND;", True),
            ("SELECT 2 FROM dual", False),
        ]
        assert positions("oracle", script) == [(1, 1), (2, 1), (6, 1)]

    @pytest.mark.parametrize("block", _BLOCKS, ids=lambda b: b.split("\n")[0][:40])
    def test_each_block_head_opens_a_block(self, block: str) -> None:
        assert blocks("oracle", f"{block}\n/\nSELECT 1 FROM dual") == [
            (block, True),
            ("SELECT 1 FROM dual", False),
        ]

    def test_a_block_without_a_slash_runs_to_the_end_of_the_script(self) -> None:
        script = "BEGIN\n  NULL;\nEND;\nSELECT 1 FROM dual;"

        assert blocks("oracle", script) == [(script, True)]

    def test_a_block_at_the_end_is_trimmed(self) -> None:
        assert blocks("oracle", "BEGIN\n  NULL;\nEND;\n\n") == [("BEGIN\n  NULL;\nEND;", True)]

    def test_two_blocks_in_a_row(self) -> None:
        script = "BEGIN\n  NULL;\nEND;\n/\nBEGIN\n  COMMIT;\nEND;\n/"

        assert blocks("oracle", script) == [
            ("BEGIN\n  NULL;\nEND;", True),
            ("BEGIN\n  COMMIT;\nEND;", True),
        ]

    def test_plain_statements_after_a_block_split_on_semicolons(self) -> None:
        script = "BEGIN\n  NULL;\nEND;\n/\nSELECT 1 FROM dual;\nSELECT 2 FROM dual;"

        assert blocks("oracle", script) == [
            ("BEGIN\n  NULL;\nEND;", True),
            ("SELECT 1 FROM dual", False),
            ("SELECT 2 FROM dual", False),
        ]

    def test_a_comment_before_a_block_stays_in_its_text(self) -> None:
        assert blocks("oracle", "-- setup\nBEGIN\n  NULL;\nEND;\n/") == [
            ("-- setup\nBEGIN\n  NULL;\nEND;", True)
        ]

    def test_create_view_and_create_table_are_plain_statements(self) -> None:
        script = "CREATE OR REPLACE VIEW v AS SELECT 1 FROM dual;\nCREATE TABLE t (a NUMBER);"

        assert blocks("oracle", script) == [
            ("CREATE OR REPLACE VIEW v AS SELECT 1 FROM dual", False),
            ("CREATE TABLE t (a NUMBER)", False),
        ]

    def test_a_slash_line_ends_a_plain_statement(self) -> None:
        assert blocks("oracle", "SELECT 1 FROM dual\n/\n") == [("SELECT 1 FROM dual", False)]

    def test_a_padded_slash_line_separates(self) -> None:
        assert texts("oracle", "SELECT 1 FROM dual\n  /  \nSELECT 2 FROM dual") == [
            "SELECT 1 FROM dual",
            "SELECT 2 FROM dual",
        ]

    @pytest.mark.parametrize(
        "script",
        [
            "SELECT 10 / 2 FROM dual",
            "SELECT 10\n/ 2 FROM dual",
            "SELECT '\n/\n' FROM dual",
            "SELECT 1 /*\n/\n*/ FROM dual",
        ],
    )
    def test_a_slash_that_is_not_a_line_of_its_own_does_not_separate(self, script: str) -> None:
        assert texts("oracle", script) == [script]

    @pytest.mark.parametrize("database_type", ["postgresql", "mysql", "sqlite", "mssql"])
    def test_a_slash_line_means_nothing_on_other_types(self, database_type: str) -> None:
        assert texts(database_type, "SELECT 1\n/\nSELECT 2") == ["SELECT 1\n/\nSELECT 2"]

    @pytest.mark.parametrize("database_type", ["postgresql", "mysql", "sqlite"])
    def test_begin_opens_no_block_on_other_types(self, database_type: str) -> None:
        assert blocks(database_type, "BEGIN;\nSELECT 1;") == [("BEGIN", False), ("SELECT 1", False)]


class TestLexerSpellings:
    """Each spelling of a region lexes alike; block comments nest on PostgreSQL only (SQL-3)."""

    @pytest.mark.parametrize("prefix", ["E", "e"])
    def test_an_escape_string_opens_in_either_case_on_postgresql(self, prefix: str) -> None:
        region = f"{prefix}'a\\';b'"

        assert texts("postgresql", f"SELECT {region}; SELECT 2") == [f"SELECT {region}", "SELECT 2"]

    @pytest.mark.parametrize("body", ["[it's;b]", "{it's;b}", "(it's;b)", "<it's;b>", "!it's;b!"])
    @pytest.mark.parametrize("prefix", ["q", "Q"])
    def test_an_alternative_quote_opens_in_either_case_on_oracle(
        self, prefix: str, body: str
    ) -> None:
        region = f"{prefix}'{body}'"

        assert texts("oracle", f"SELECT {region} FROM dual; SELECT 2 FROM dual") == [
            f"SELECT {region} FROM dual",
            "SELECT 2 FROM dual",
        ]

    def test_a_nested_block_comment_hides_its_separator_on_postgresql(self) -> None:
        assert texts("postgresql", "SELECT 1 /* a /* b */ ; c */; SELECT 2") == [
            "SELECT 1 /* a /* b */ ; c */",
            "SELECT 2",
        ]

    def test_an_unclosed_nested_block_comment_runs_to_the_end_on_postgresql(self) -> None:
        script = "SELECT 1 /* a /* b */ ; SELECT 2"

        assert texts("postgresql", script) == [script]

    @pytest.mark.parametrize("database_type", ["mysql", "oracle", "sqlite"])
    def test_a_block_comment_ends_at_its_first_close_elsewhere(self, database_type: str) -> None:
        assert texts(database_type, "SELECT 1 /* a /* b */ ; c */; SELECT 2") == [
            "SELECT 1 /* a /* b */",
            "c */",
            "SELECT 2",
        ]

    def test_a_block_comment_ends_at_its_first_close_on_sql_server(self) -> None:
        assert texts("mssql", "SELECT 1 /* a /* b */\nGO\nc */") == [
            "SELECT 1 /* a /* b */",
            "c */",
        ]

    @pytest.mark.parametrize("line", ["GO;", "go;", "  GO ;  "])
    def test_go_followed_by_a_semicolon_does_not_separate(self, line: str) -> None:
        script = f"SELECT 1\n{line}\nSELECT 2"

        assert texts("mssql", script) == [script]


class TestCrlfLineBreaks:
    """A CRLF is one line break, and a column counts characters, not bytes (SQL-3, SQL-10)."""

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_statement_after_a_crlf_starts_at_its_first_character(
        self, database_type: str
    ) -> None:
        assert positions(database_type, "SELECT 1;\r\n  SELECT 2") == [(1, 1), (2, 3)]

    @pytest.mark.parametrize("database_type", ALL_TYPES)
    def test_leading_crlf_lines_move_the_first_statement(self, database_type: str) -> None:
        assert positions(database_type, "\r\n\r\n   SELECT 1") == [(3, 4)]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_statement_spanning_crlf_lines_keeps_its_line_breaks(
        self, database_type: str
    ) -> None:
        assert texts(database_type, "SELECT a,\r\n  b\r\nFROM t;\r\nSELECT 2") == [
            "SELECT a,\r\n  b\r\nFROM t",
            "SELECT 2",
        ]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_line_comment_ends_at_the_crlf(self, database_type: str) -> None:
        assert texts(database_type, "SELECT 1 -- a;b\r\n; SELECT 2") == [
            "SELECT 1 -- a;b",
            "SELECT 2",
        ]

    def test_a_go_line_ending_in_crlf_separates(self) -> None:
        script = "SELECT 1\r\nGO\r\nSELECT 2"

        assert texts("mssql", script) == ["SELECT 1", "SELECT 2"]
        assert positions("mssql", script) == [(1, 1), (3, 1)]

    def test_a_slash_line_ending_in_crlf_ends_an_oracle_block(self) -> None:
        script = "BEGIN\r\n  NULL;\r\nEND;\r\n/\r\nSELECT 1 FROM dual"

        assert blocks("oracle", script) == [
            ("BEGIN\r\n  NULL;\r\nEND;", True),
            ("SELECT 1 FROM dual", False),
        ]
        assert positions("oracle", script) == [(1, 1), (5, 1)]

    def test_a_delimiter_line_ending_in_crlf_changes_the_separator(self) -> None:
        script = "DELIMITER //\r\nSELECT 1; SELECT 2//\r\nDELIMITER ;\r\nSELECT 3; SELECT 4"

        assert texts("mysql", script) == ["SELECT 1; SELECT 2", "SELECT 3", "SELECT 4"]
        assert positions("mysql", script) == [(2, 1), (4, 1), (4, 11)]

    @pytest.mark.parametrize("database_type", SEMICOLON_TYPES)
    def test_a_column_counts_characters_not_bytes(self, database_type: str) -> None:
        assert positions(database_type, "SELECT '\u00e9\u20ac';  SELECT 2") == [(1, 1), (1, 15)]


class TestSessionStateWord:
    """USE, SET and ALTER SESSION are flagged; the matched keyword comes back as written."""

    @pytest.mark.parametrize(
        ("statement", "word"),
        [
            ("SET search_path TO app", "SET"),
            ("-- c\n  set role admin", "set"),
            ("USE app", "USE"),
            ("ALTER SESSION SET CURRENT_SCHEMA = app", "ALTER SESSION"),
            ("alter session set nls_date_format = 'YYYY-MM-DD'", "alter session"),
            ("SET @x = 1", "SET"),
            ("SET ROLE admin", "SET"),
            ("SET NOCOUNT ON", "SET"),
            ("/* switch */ USE app", "USE"),
            ("Use app", "Use"),
            ("\n\n  SET TIME ZONE 'UTC'", "SET"),
        ],
    )
    def test_a_session_state_statement_names_its_keyword(self, statement: str, word: str) -> None:
        assert session_state_word(statement) == word

    @pytest.mark.parametrize(
        "statement",
        [
            "ALTER  SESSION SET CURRENT_SCHEMA = app",
            "ALTER\tSESSION SET CURRENT_SCHEMA = app",
            "alter\n  session set nls_date_format = 'YYYY-MM-DD'",
            "ALTER\r\nSESSION SET CURRENT_SCHEMA = app",
        ],
    )
    def test_alter_session_matches_with_any_whitespace_between_its_words(
        self, statement: str
    ) -> None:
        word = session_state_word(statement)

        assert word is not None
        assert word.split() == statement.split()[:2]

    @pytest.mark.parametrize(
        "statement",
        [
            "RESET ALL",
            "ALTER TABLE t ADD c int",
            "ALTER SYSTEM SET processes = 300",
            "SELECT 1",
            "UPDATE t SET a = 1",
            "SETUP x",
            "DECLARE @x int",
            "-- USE app\nSELECT 1",
            "-- only a note",
            "",
        ],
    )
    def test_any_other_statement_names_none(self, statement: str) -> None:
        assert session_state_word(statement) is None
