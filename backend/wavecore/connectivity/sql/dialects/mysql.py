"""MySQL through PyMySQL with WAVE's own RSA password step (REQ-3.4.1.6, REQ-5.1.4)."""

from typing import TYPE_CHECKING, Any

from wavecore.connectivity.sql import _mysql_rsa
from wavecore.connectivity.sql.dialects._common import PROGRAM_NAME, tls_context
from wavecore.connectivity.sql.dialects._common import execute as execute

if TYPE_CHECKING:
    from wavecore.connectivity.sql.dialects import Handle

NAME = "MySQL"
DEFAULT_PORT = 3306
SQLGLOT = "mysql"
TLS_DEFAULT = False


def placeholder(_index: int) -> str:
    return "%s"


def connect(rows: dict[str, Any], connect_timeout: int) -> Any:
    import pymysql
    import pymysql._auth

    # PyMySQL's own RSA step needs `cryptography`, which a remote host does not carry.
    pymysql._auth.sha2_rsa_encrypt = _mysql_rsa.encrypt_password
    arguments = {
        "host": rows["host"],
        "port": rows["port"],
        "user": rows["username"],
        "password": rows["password"],
        "database": rows["database"],
        "connect_timeout": connect_timeout,
        "ssl": tls_context(rows, rows["server_name"]),
        "program_name": PROGRAM_NAME,
    }
    return pymysql.connect(**{**arguments, **rows["driver_options"]})


def autocommit(connection: Any, on: bool) -> None:
    connection.autocommit(on)


def server_version(connection: Any) -> str:
    return str(connection.get_server_info())


def cancel(handle: "Handle") -> None:
    """KILL QUERY for the running session, sent from a second login."""
    if handle.connection is None:
        return
    killer = connect(handle.rows, handle.connect_timeout)
    try:
        killer.cursor().execute(f"KILL QUERY {handle.connection.thread_id()}")
    finally:
        killer.close()
