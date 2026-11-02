"""The SQL editor's syntax check: sqlglot in the block's dialect, never run (SQL-10)."""

from typing import Any

import sqlglot
from sqlglot.errors import ParseError, TokenError

from wavecore.api.exceptions import UnprocessableEntityException, ValidationException
from wavecore.connectivity.sql._params import placeholders
from wavecore.connectivity.sql._split import Statement, split_script
from wavecore.connectivity.sql.dialects import dialect

MAX_SCRIPT_BYTES = 1024 * 1024


def check_syntax(database_type: str, script: str) -> list[dict[str, Any]]:
    """Every parse finding of the script as {line, col, message}, in script order."""
    try:
        sqlglot_dialect = dialect(database_type).SQLGLOT
    except ValueError as error:
        raise ValidationException(str(error)) from None
    if len(script.encode("utf-8")) > MAX_SCRIPT_BYTES:
        raise UnprocessableEntityException("Script exceeds 1 MB")
    issues: list[dict[str, Any]] = []
    for statement in split_script(database_type, script):
        if not statement.block:
            issues.extend(_statement_issues(database_type, sqlglot_dialect, statement))
    return sorted(issues, key=lambda issue: (issue["line"], issue["col"]))


def _statement_issues(
    database_type: str, sqlglot_dialect: str, statement: Statement
) -> list[dict[str, Any]]:
    try:
        sqlglot.parse(_without_placeholders(database_type, statement.text), read=sqlglot_dialect)
    except ParseError as error:
        return [
            _issue(statement, entry["line"], entry["col"], entry["description"])
            for entry in error.errors
        ]
    except TokenError as error:
        return [{"line": statement.line, "col": statement.column, "message": str(error)}]
    return []


def _without_placeholders(database_type: str, text: str) -> str:
    """Each `:name` becomes `0` padded to its length, so positions stay where they were."""
    for found in reversed(placeholders(database_type, text)):
        text = text[: found.start] + "0".ljust(found.end - found.start) + text[found.end :]
    return text


def _issue(statement: Statement, line: int, col: int, message: str) -> dict[str, Any]:
    """A finding at sqlglot's 1-based statement position, moved to its place in the script."""
    if line == 1:
        col += statement.column - 1
    return {"line": statement.line + line - 1, "col": col, "message": message}
