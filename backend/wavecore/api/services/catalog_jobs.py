"""The catalog pulls the editor tools run from the WAVE server (SQL-12, OS-13).

One pull per connection key on a daemon thread: joined while it runs, answered from the cache
once done, replaced by a refresh or by a new start after a failure or a cancel.
"""

import hashlib
import json
import threading
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Final, cast

from pydantic import BaseModel

from wavecore.api.exceptions import NotFoundException, UnprocessableEntityException
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.workbench.lazy_variables import LazyVariables
from wavecore.api.services.workbench.plugins import (
    _inject_namespace_variables,
    _inject_profile_variables,
)
from wavecore.api.services.workbench.service import _prepare_variable_maps
from wavecore.core.execution.plugin_executor import resolve_block_fields
from wavecore.core.expressions.errors import ExpressionEvaluationError
from wavecore.core.secrets.sealing import unseal_all

_RUNNING = ("connecting", "reading")


class CatalogRequestBody(BaseModel):
    """How a catalog request's rows are written, and where they resolve."""

    expression_fields: list[str] = []
    template_fields: list[str] = []
    element_types: dict[str, Any] = {}
    profile_bindings: list[dict[str, Any]] = []
    environment_id: str | None = None
    test_id: str | None = None
    refresh: bool = False


@dataclass
class Job:
    """One pull: its state, its answer, and what a cancel reaches."""

    id: str
    live: Any
    status: str = "connecting"
    data: dict[str, Any] = field(default_factory=dict)
    error: str = ""
    cancel_read: Callable[["Job"], None] = field(init=False, repr=False, compare=False)


_JOBS: dict[str, Job] = {}
_BY_KEY: dict[str, str] = {}
_LOCK = threading.Lock()


def connection_key(rows: dict[str, Any]) -> str:
    """The cache and join key of a resolved connection."""
    text = json.dumps(rows, sort_keys=True, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def start_job(
    key: str,
    pull: Callable[[Job], dict[str, Any]],
    cancel_read: Callable[[Job], None],
    live: Any,
    refresh: bool,
) -> dict[str, Any]:
    """Answer the cached data, join the running pull, or start one that replaces the last."""
    with _LOCK:
        latest = _JOBS.get(_BY_KEY.get(key, ""))
        if latest is not None:
            if latest.status in _RUNNING:
                return {"job_id": latest.id, "cached": False}
            if latest.status == "done" and not refresh:
                return {"job_id": latest.id, "cached": True, **latest.data}
            del _JOBS[latest.id]
        job = Job(uuid.uuid4().hex, live)
        job.cancel_read = cancel_read
        _JOBS[job.id] = job
        _BY_KEY[key] = job.id
    threading.Thread(target=_run, args=(job, pull), daemon=True).start()
    return {"job_id": job.id, "cached": False}


def _run(job: Job, pull: Callable[[Job], dict[str, Any]]) -> None:
    try:
        data = pull(job)
    except Exception as error:
        settle(job, "failed", error=str(error))
        return
    settle(job, "done", data=data)


def status(job_id: str) -> dict[str, Any]:
    """Where a pull stands: connecting, reading, done with its data, failed or canceled."""
    job = _job(job_id)
    with _LOCK:
        return _answer(job)


def cancel(job_id: str) -> dict[str, Any]:
    """Stop a running pull; a finished one keeps its own answer."""
    job = _job(job_id)
    with _LOCK:
        if job.status not in _RUNNING:
            return _answer(job)
        reading = job.status == "reading"
        job.status = "canceled"
    if reading:
        job.cancel_read(job)
    return {"status": "canceled"}


def result(job_id: str) -> dict[str, Any] | None:
    """A done pull's data; None for any other state or an unknown job."""
    job = _JOBS.get(job_id)
    with _LOCK:
        return job.data if job is not None and job.status == "done" else None


def mark_reading(job: Job) -> bool:
    """Move a connected pull to reading; False when it was canceled while connecting."""
    with _LOCK:
        if job.status == "canceled":
            return False
        job.status = "reading"
        return True


def settle(job: Job, final: str, *, data: dict[str, Any] | None = None, error: str = "") -> None:
    """Write the pull's final state; a canceled job keeps no late answer."""
    with _LOCK:
        if job.status == "canceled":
            return
        job.status = final
        job.data = data or {}
        job.error = error


def _job(job_id: str) -> Job:
    job = _JOBS.get(job_id)
    if job is None:
        raise NotFoundException(f"Catalog job '{job_id}' not found")
    return job


def _answer(job: Job) -> dict[str, Any]:
    if job.status == "done":
        return {"status": "done", **job.data}
    if job.status == "failed":
        return {"status": "failed", "error": job.error}
    return {"status": job.status}


def starting_variables(
    test_id: str | None, environment_id: str | None, profile_bindings: Iterable[dict[str, Any]]
) -> dict[str, Any]:
    """The variables a run of the test in the Environment starts with, plus the block's profiles."""
    if environment_id and environment_service.get_environment(environment_id) is None:
        raise UnprocessableEntityException(f"Environment with ID '{environment_id}' not found")
    declared = test_service.get_test_variables_raw(test_id) if test_id else None
    maps = _prepare_variable_maps(unseal_all(declared or {}))
    variables = cast(
        dict[str, Any],
        LazyVariables(maps.literals, expr_map=maps.expressions, tmpl_map=maps.templates),
    )
    _inject_namespace_variables(variables, test_id=test_id or "")
    _inject_profile_variables(list(profile_bindings), variables, environment_id or "")
    return variables


# A row the Block does not hold, told apart from one it holds as null.
NOT_HELD: Final = object()


def _pulled_row(field: Mapping[str, Any]) -> dict[str, Any]:
    """A row as a pull resolves it: the pull refuses a missing or unknown row by its label."""
    return {key: value for key, value in field.items() if key not in ("required", "enum_values")}


def row_resolver(
    plugin_metadata: Mapping[str, Any],
    labels: Mapping[str, str],
    expression_fields: set[str],
    template_fields: set[str],
    variables: dict[str, Any],
) -> Callable[[str, Any], Any]:
    """Resolve one row as the block's run would, refusing it by its label when it cannot.

    A row not held, left empty (None) or a blank whole expression takes the Block's default;
    a credential row held as null is refused, as a run refuses it.
    """
    rows = {
        str(field["name"]): _pulled_row(field) for field in plugin_metadata.get("parameters") or []
    }
    credentials = {name for name, field in rows.items() if field.get("secret")}

    def resolve(row: str, value: Any) -> Any:
        left_empty = value is NOT_HELD or (value is None and row not in credentials)
        try:
            resolved = resolve_block_fields(
                {} if left_empty else {row: value},
                [rows[row]] if row in rows else [],
                expression_fields=expression_fields,
                template_fields=template_fields,
                element_types={},
                variables=variables,
                session_id=None,
                exact_numbers=False,
            )
        except (ExpressionEvaluationError, ValueError) as error:
            raise UnprocessableEntityException(f"Cannot resolve {labels[row]}: {error}") from None
        return resolved.get(row)

    return resolve
