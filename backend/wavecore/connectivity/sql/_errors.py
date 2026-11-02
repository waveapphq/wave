"""The block's message and reason for whatever a driver raised (REQ-3.4.1.6 SQL-5)."""

from typing import Any

UNREACHABLE = "Unreachable"
AUTH_FAILED = "AuthFailed"
DATABASE_ERROR = "DatabaseError"
TIMEOUT = "Timeout"
VALIDATION = "Validation"
UNSUPPORTED = "Unsupported"

_LOGIN_REFUSED = {
    "mysql": frozenset({1044, 1045, 1698}),
    "oracle": frozenset({"ORA-01005", "ORA-01017", "ORA-28000", "ORA-28001"}),
    "mssql": frozenset({18452, 18456, 18486, 18487, 18488}),
}
# PyMySQL numbers its own client-side failures in this range.
_MYSQL_CLIENT_CODES = range(2000, 3000)
# A driver's own code for "a library I need could not be imported".
_NOT_LOADED = {"oracle": frozenset({"DPY-3016"})}


class SqlFailure(Exception):
    """A failure the SQL core raises itself, with the reason the block reports."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason


def timeout_message(seconds: int) -> str:
    return f"Statement timed out after {seconds} seconds"


def _first_arg(exc: BaseException) -> Any:
    return exc.args[0] if exc.args else None


def _mysql_pair(exc: BaseException) -> bool:
    """PyMySQL's (code, text) error shape; an OSError's (errno, text) is not one."""
    args = exc.args
    return (
        not isinstance(exc, OSError)
        and len(args) == 2
        and type(args[0]) is int
        and isinstance(args[1], str)
    )


def _server_error(dialect: str, exc: BaseException) -> tuple[Any, str] | None:
    """The database's own (code, text) when the error came from the server."""
    first = _first_arg(exc)
    if dialect == "postgresql" and isinstance(first, dict) and "C" in first:
        return first["C"], str(first.get("M", ""))
    if dialect == "mysql" and _mysql_pair(exc) and first not in _MYSQL_CLIENT_CODES:
        return first, exc.args[1]
    number = getattr(exc, "number", None)
    if dialect == "mssql" and type(number) is int and number > 0:
        return number, getattr(exc, "text", "") or str(exc)
    code = str(getattr(first, "full_code", ""))
    if dialect == "oracle" and code.startswith("ORA-"):
        return code, str(first.message)
    return None


def _driver_text(dialect: str, exc: BaseException) -> str:
    """The driver's own words for a failure that did not come from the server."""
    if dialect == "mysql" and _mysql_pair(exc):
        return str(exc.args[1])
    message = getattr(_first_arg(exc), "message", None)
    if dialect == "oracle" and isinstance(message, str):
        return message
    return str(exc) or type(exc).__name__


def load_failure(dialect: str, exc: BaseException) -> str | None:
    """The loader's own words when the driver, or a build under it, could not be imported."""
    code = getattr(_first_arg(exc), "full_code", None)
    if isinstance(exc, ImportError) or code in _NOT_LOADED.get(dialect, ()):
        return _driver_text(dialect, exc)
    return None


def map_error(dialect: str, exc: BaseException, context: dict[str, Any]) -> tuple[str, str]:
    """(message, reason) for a failure at connect or while a statement ran."""
    if isinstance(exc, SqlFailure):
        return exc.message, exc.reason
    if isinstance(exc, TimeoutError) and not str(exc) and exc.__cause__ is not None:
        return map_error(dialect, exc.__cause__, context)
    # Imported here so the dialects can import this module at their top.
    from wavecore.connectivity.sql.dialects import dialect as dialect_module

    connecting = context["phase"] == "connect"
    if dialect == "sqlite":
        text = str(exc)
        if connecting:
            return f"Could not open the SQLite file {context['file']}: {text}", UNREACHABLE
        return text, DATABASE_ERROR
    server = _server_error(dialect, exc)
    if server is None:
        text = _driver_text(dialect, exc)
        if connecting:
            where = context.get("dsn") or f"{context['host']}:{context['port']}"
            name = dialect_module(dialect).NAME
            return f"Could not connect to {name} at {where}: {text}", UNREACHABLE
        return text, DATABASE_ERROR
    code, text = server
    if connecting and _login_refused(dialect, code):
        where = context.get("dsn") or context["host"]
        return f"Authentication failed for {context['username']} at {where}: {text}", AUTH_FAILED
    return (text if dialect == "oracle" else f"{code}: {text}"), DATABASE_ERROR


def _login_refused(dialect: str, code: Any) -> bool:
    if dialect == "postgresql":
        return str(code).startswith("28")
    return code in _LOGIN_REFUSED[dialect]
