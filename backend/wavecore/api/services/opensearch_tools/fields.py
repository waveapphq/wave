"""Get fields: an index pattern's indexes and fields, pulled from the WAVE server (OS-13).

The rows resolve as a run would; the pull never looks up a tunnel, since no test run exists.
"""

from collections.abc import Collection, Iterable, Mapping
from typing import Any

from wavecore.api.exceptions import UnprocessableEntityException
from wavecore.api.services import catalog_jobs
from wavecore.api.services.catalog_jobs import (
    NOT_HELD,
    Job,
    connection_key,
    mark_reading,
    row_resolver,
    start_job,
    starting_variables,
)
from wavecore.connectivity.opensearch._auth import authorization
from wavecore.connectivity.opensearch._errors import TIMEOUT, OpenSearchFailure, timeout_message
from wavecore.connectivity.opensearch._fields import read_field_list, read_indexes
from wavecore.connectivity.opensearch._rest import Client, _shutdown_socket
from wavecore.connectivity.opensearch._url import parse_cluster_url
from wavecore.core.number_rule import parse_number
from wavecore.core.secrets.sealing import unseal_all
from wavecore.core.variables.element_types import realize_typed_settings
from wavecore.plugins._held_run import Live
from wavecore.plugins.opensearch import OpenSearchPlugin

CONNECT_TIMEOUT = 30
# A pull has no deadline (a cancel shuts its socket down); this bounds one blocked read.
READ_BOUND = 300
_LABELS = {
    "url": "Cluster URL",
    "username": "Username",
    "password": "Password",
    "api_key": "API Key",
    "bearer_token": "Bearer Token",
    "verify_ssl": "Verify Server Certificate",
    "ca_cert": "CA Certificate",
    "client_cert": "Client Certificate",
    "client_key": "Client Key",
    "index": "Index pattern",
    "connect_timeout": "Connect timeout",
}
_CREDENTIALS = ("username", "password", "api_key", "bearer_token")
_TRUST_FILES = ("ca_cert", "client_cert", "client_key")
EVERY_INDEX_REFUSED = (
    "These credentials may not list every index. Type an index pattern they can read, "
    "such as logs-*"
)


def start(
    connection: dict[str, Any],
    refresh: bool = False,
    test_id: str | None = None,
    *,
    expression_fields: Collection[str] = (),
    template_fields: Collection[str] = (),
    profile_bindings: Iterable[dict[str, Any]] = (),
    environment_id: str | None = None,
    element_types: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Answer the cached lists, join the running pull, or start one that replaces the last."""
    variables = starting_variables(test_id, environment_id, profile_bindings)
    resolve = row_resolver(
        OpenSearchPlugin().metadata,
        _LABELS,
        set(expression_fields),
        set(template_fields),
        variables,
    )
    typed = realize_typed_settings(unseal_all(connection), element_types, set(expression_fields))
    rows = {row: resolve(row, typed.get(row, NOT_HELD)) for row in _LABELS}
    if not _text(rows["url"]):
        raise UnprocessableEntityException("Cluster URL is required")
    live = Live(
        READ_BOUND,
        _shutdown_socket,
        lambda: OpenSearchFailure(timeout_message(READ_BOUND), TIMEOUT),
    )
    return start_job(
        connection_key(rows), lambda job: _pull(job, rows), _cancel_read, live, refresh
    )


def status(job_id: str) -> dict[str, Any]:
    """Where a pull stands: connecting, reading, done with its lists, failed or canceled."""
    return catalog_jobs.status(job_id)


def cancel(job_id: str) -> dict[str, Any]:
    """Stop a running pull; a finished one keeps its own answer."""
    return catalog_jobs.cancel(job_id)


def _cancel_read(job: Job) -> None:
    """Shut the pull's live socket down so its blocked read wakes at once."""
    job.live.stop()


def _pull(job: Job, rows: dict[str, Any]) -> dict[str, Any]:
    """List the indexes, then read the pattern's field list when there is a pattern."""
    url = parse_cluster_url(_text(rows["url"]))
    credentials = ("" if rows[row] is None else str(rows[row]) for row in _CREDENTIALS)
    # PEM text stays as written: its line breaks are part of it.
    trust = {row: rows[row] or "" for row in _TRUST_FILES}
    client = Client(
        url,
        {"verify_ssl": rows["verify_ssl"] is None or bool(rows["verify_ssl"]), **trust},
        _seconds(rows["connect_timeout"]),
        job.live,
        authorization=authorization(*credentials),
    )
    pattern = _text(rows["index"])
    try:
        indexes = read_indexes(client, pattern)
        fields = read_field_list(client, pattern).fields if pattern and mark_reading(job) else {}
    except OpenSearchFailure as failure:
        if failure.forbidden:
            raise _refused(pattern, failure) from failure
        raise
    return {
        "indexes": indexes,
        "fields": [
            {"name": name, "types": info.types, "aggregatable": info.aggregatable}
            for name, info in fields.items()
        ],
    }


def _refused(pattern: str, failure: OpenSearchFailure) -> OpenSearchFailure:
    """A security refusal in plain words: ask for a pattern, or name the one refused."""
    if not pattern:
        return OpenSearchFailure(EVERY_INDEX_REFUSED, failure.reason)
    return OpenSearchFailure(
        f"These credentials may not read {pattern}. OpenSearch said: {failure.message}",
        failure.reason,
    )


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _seconds(value: Any) -> int:
    """Connect timeout in seconds; blank takes the block's default."""
    return CONNECT_TIMEOUT if value is None or value == "" else int(parse_number(value, "integer"))
