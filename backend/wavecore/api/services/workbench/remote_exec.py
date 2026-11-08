"""Remote Execution container body execution for the workbench engine.

REQ-3.4.1.3: a Remote Execution container runs its body sub-flow on a remote
host over a mandatory Execution Host = an already-open SSH session. On execute
it resolves that session's live connection, opens ONE persistent remote worker
(interpreter validated at runtime), routes each remotable body block's execute
to the worker, binds the container's single output (Remote Session ID), then
tears the worker down (agentless - nothing WAVE-authored persists).

The body runs through the shared body walker with its worker held for the body's
duration; an ad-hoc run that starts inside a body opens the same kind of worker when it
first reaches a block that runs on the remote host and holds it for the rest of the run.
The runner functions are imported by name so tests patch them on this module.
"""

import asyncio
import base64
import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Sequence
from contextlib import AsyncExitStack, asynccontextmanager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wavecore.api.services.network import certificates
from wavecore.api.services.workbench._common import _add_execution_log, _get_session
from wavecore.api.services.workbench.block_source import block_source
from wavecore.api.services.workbench.block_status import skip_lane_never_run
from wavecore.api.services.workbench.for_loop import (
    _execute_body_chain_iteration,
    _trace_body_chain,
)
from wavecore.api.services.workbench.node_helpers import _extract_node_fields
from wavecore.api.services.workbench.plugins import (
    _effective_secret_output_names,
    _get_session_registry,
    _log_masked_inputs,
    _log_masked_outputs,
    _mask_catalog_for,
    _register_revealed_param_exemptions,
    _register_secret_output_values,
)
from wavecore.api.services.workbench.try_catch import _map_handle_targets
from wavecore.core.execution.plugin_executor import (
    NullPolicy,
    build_map_expression_keys,
    resolve_block_fields,
)
from wavecore.core.expressions.errors import InvalidExpressionError, NullValueError
from wavecore.core.remote_exec.materialize import materialize
from wavecore.core.remote_exec.runner import (
    COMPILED_PACKAGES,
    UnsupportedHost,
    close_worker,
    open_worker,
    push_wheels,
    run_on_worker,
    select_wheels,
)
from wavecore.core.remote_exec.worker_registry import RemoteWorkerRegistry
from wavecore.core.secrets import masking_settings
from wavecore.core.table import Table
from wavecore.core.variables.declared_types import declared_type
from wavecore.logging.session_logger import SessionLogger
from wavecore.models.enums import LogLevel
from wavecore.plugins._file_paths import has_plugin_scheme
from wavecore.plugins._local_process_common import (
    REMOTE_LOCUS,
    argument_texts,
    entry_texts,
    fail_or_record,
    resolve_script_file,
    start_line,
)
from wavecore.plugins._netcat_core import NetcatFailure
from wavecore.plugins._sql_core import database_type_of
from wavecore.plugins._ssh_session import require_session
from wavecore.plugins.netcat import read_wave_payload
from wavecore.plugins.python import NOUN as PYTHON_NOUN
from wavecore.plugins.python import TYPE_KEY, _encode, remote_exports
from wavecore.plugins.sql_client import needs_wheels, remote_request

_PYTHON_ELEMENT = "python"
_NETCAT_ELEMENT = "netcat"
_SQL_ELEMENT = "sql-client"


@dataclass
class BodyWorker:
    """The open worker of the innermost Remote Execution body that is running."""

    worker: Any
    host: str
    # Set when a block at any depth of the body fails on the host.
    failed_on_host: bool = False


class _AdhocBodyWorker:
    """The worker of the body an ad-hoc run starts in, opened by the first block that needs it."""

    def __init__(
        self,
        container: dict[str, Any],
        variables: dict[str, Any],
        session: dict[str, Any],
        session_id: str,
        held: AsyncExitStack,
    ) -> None:
        self._container = container
        self._variables = variables
        self._session = session
        self._session_id = session_id
        self._held = held
        self._lock = asyncio.Lock()
        self._opened: BodyWorker | None = None

    async def opened(self) -> BodyWorker:
        """Open the worker once, on first use, and keep it until the ad-hoc run ends."""
        async with self._lock:
            if self._opened is None:
                record, session_ref = _require_adhoc_session(
                    self._container, self._variables, self._session, self._session_id
                )
                _remote_session_id, opened = await self._held.enter_async_context(
                    _registered_worker(self._session, record, session_ref)
                )
                self._opened = opened
        return self._opened


class RemoteHostError(RuntimeError):
    """A remotable body block failed on the Execution Host; reads as the block's own error."""


_body_worker: ContextVar[BodyWorker | _AdhocBodyWorker | None] = ContextVar(
    "wave_remote_body_worker", default=None
)


@contextmanager
def _body_worker_scope(body_worker: BodyWorker | _AdhocBodyWorker) -> Iterator[None]:
    """Hold the body's worker for everything the body runs, nested walkers and lanes included."""
    token = _body_worker.set(body_worker)
    try:
        yield
    finally:
        _body_worker.reset(token)


def active_body_worker() -> BodyWorker | _AdhocBodyWorker | None:
    """The worker serving the current block's innermost Remote Execution body, if any."""
    return _body_worker.get()


def _get_remote_worker_registry(session: dict[str, Any]) -> RemoteWorkerRegistry:
    """The run's remote-worker registry, created on first use."""
    registry = session.get("remote_worker_registry")
    if registry is None:
        registry = RemoteWorkerRegistry()
        session["remote_worker_registry"] = registry
    return registry


def is_remotable(element_type: str, version: str) -> bool:
    """Whether a block runs on the host inside a body (remotable plugin) or on WAVE."""
    from wavecore.core.plugin_registry import get_plugin

    plugin = get_plugin(element_type, version)
    return bool(plugin and plugin.metadata.get("remotable", False))


def _forward_reaches(start: str, target: str, adj: dict[str, list[tuple[str, str | None]]]) -> bool:
    """Whether target is forward-reachable from start over the graph edges."""
    seen: set[str] = set()
    stack = [start]
    while stack:
        current = stack.pop()
        if current == target:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(t for t, _handle in adj.get(current, []))
    return False


def _remote_body_entries(
    adj: dict[str, list[tuple[str, str | None]]], node_map: dict[str, Any]
) -> dict[str, str]:
    """The first node of every Remote Execution body, by container id."""
    entries: dict[str, str] = {}
    for rex_id, rex in node_map.items():
        if (rex.get("data") or {}).get("elementType") != "remote-execution":
            continue
        body_target = _map_handle_targets(adj.get(rex_id, [])).get("body")
        if body_target:
            entries[rex_id] = body_target
    return entries


def find_enclosing_remote_container(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
) -> str | None:
    """The innermost Remote Execution whose body holds this node, or None.

    A body holds every node reached forward from its first node, the rule the canvas
    locus badge follows; the innermost holder is the one whose body holds no other holder.
    """
    holders = {
        rex_id: entry
        for rex_id, entry in _remote_body_entries(adj, node_map).items()
        if _forward_reaches(entry, node_id, adj)
    }
    for rex_id, entry in holders.items():
        if not any(other != rex_id and _forward_reaches(entry, other, adj) for other in holders):
            return rex_id
    return None


def _require_adhoc_session(
    container: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
) -> tuple[dict[str, Any], Any]:
    """The live Execution Host session of the body an ad-hoc run starts in, and its handle."""
    nf = _extract_node_fields(container)
    try:
        session_ref = _resolve_session_id(nf, variables, session_id)
    except (InvalidExpressionError, NullValueError):
        session_ref = None
    registry = session.get("ssh_session_registry")
    record = registry.get(session_ref) if (registry and session_ref) else None
    if record is None:
        raw_session = nf["config_values"].get("session_id") or "(unset)"
        raise RuntimeError(
            f"This block runs on a remote host, but its SSH session '{raw_session}' is "
            f"closed or not connected. Open it first (Run Current on the SSH Session "
            f"Open block), then run this block."
        )
    return record, session_ref


@asynccontextmanager
async def _registered_worker(
    session: dict[str, Any], record: dict[str, Any], session_ref: Any
) -> AsyncIterator[tuple[str, BodyWorker]]:
    """Open a worker on the session's remote host; on exit the registry stops it, then it closes."""
    registry = _get_remote_worker_registry(session)
    remote_session_id = uuid.uuid4().hex
    worker = await open_worker(record["connection"])
    # A session opened on a tunnel's Local Port is named by its far host, not the loopback.
    host = record["host_identity"]
    registry.register(remote_session_id, worker, session_ref, host)
    try:
        yield remote_session_id, BodyWorker(worker=worker, host=host)
    finally:
        registry.close(remote_session_id)
        await close_worker(worker)


@asynccontextmanager
async def _held_body_worker(
    session: dict[str, Any], record: dict[str, Any], session_ref: Any
) -> AsyncIterator[tuple[str, BodyWorker]]:
    """Open a worker on the session's remote host and hold it for everything run inside."""
    async with _registered_worker(session, record, session_ref) as (remote_session_id, body_worker):
        with _body_worker_scope(body_worker):
            yield remote_session_id, body_worker


@dataclass(frozen=True)
class AdhocPlace:
    """Where an ad-hoc run starts on one canvas: the node, its graph and the scope it reads."""

    node_id: str
    adj: dict[str, list[tuple[str, str | None]]]
    node_map: dict[str, Any]
    variables: dict[str, Any]


async def run_adhoc_in_body(
    places: Sequence[AdhocPlace],
    session: dict[str, Any],
    session_id: str,
    run: Callable[[], Awaitable[None]],
) -> None:
    """Run an ad-hoc run with the worker of its body, opened when first needed (REQ-3.4.1.3).

    ``places`` go from the canvas the run starts on out to the Test canvas; the first
    canvas whose Remote Execution body holds its place names the innermost body.
    """
    for place in places:
        container_id = find_enclosing_remote_container(place.node_id, place.adj, place.node_map)
        if container_id is None:
            continue
        async with AsyncExitStack() as held:
            container = place.node_map[container_id]
            adhoc = _AdhocBodyWorker(container, place.variables, session, session_id, held)
            with _body_worker_scope(adhoc):
                await run()
        return
    await run()


def _resolve_remote_params(
    nf: dict[str, Any], variables: dict[str, Any], session_id: str
) -> dict[str, Any]:
    """Resolve a body block's params locally (defaults, expressions, secret registration)
    before they cross to the remote worker."""
    from wavecore.core.plugin_registry import get_plugin

    plugin = get_plugin(nf["element_type"], nf["version"])
    # The body was validated remotable, so its plugin is registered.
    assert plugin is not None
    return resolve_block_fields(
        nf["config_values"],
        plugin.metadata.get("parameters") or [],
        expression_fields=nf["expression_fields"],
        template_fields=nf["template_fields"],
        element_types={},
        variables=variables,
        session_id=session_id,
        exact_numbers=False,
        unmasked_secret_fields=nf.get("unmasked_secret_fields") or (),
    )


def _remote_value(value: Any) -> Any:
    """One resolved input as the typed envelope the worker decodes; a table in its stored shape."""
    if isinstance(value, Table):
        return {TYPE_KEY: "table", **value.to_dict()}
    return _encode(value)


def _export_context(output_bindings: dict[str, Any]) -> dict[str, Any]:
    """The bindings and declared types a Python block's exports are bound by, as on WAVE."""
    types = {
        name: declared_type(target) or "" for name, target in output_bindings.items() if target
    }
    return {"output_bindings": output_bindings, "output_types": types}


def _python_request(
    resolved: dict[str, Any],
    session_id: str,
    output_secret_fields: list[str],
    output_bindings: dict[str, Any],
) -> dict[str, Any]:
    """The remote Python request: values rendered as on WAVE, a WAVE-side file read (PYRUN-2)."""
    params = dict(resolved)
    params["output_secret_fields"] = output_secret_fields
    params["bound_exports"] = sorted(name for name, target in output_bindings.items() if target)
    params["input_vars"] = {
        name: _remote_value(value) for name, value in (params.get("input_vars") or {}).items()
    }
    params["environment"] = entry_texts(params.get("environment") or {}, "environment")
    rows = params.get("arguments") or []
    params["arguments"] = [
        {**row, "value": text}
        for row, text in zip(rows, argument_texts(rows, "arguments"), strict=True)
    ]
    script_file = str(params.get("script_file") or "")
    if params.get("script_type") == "file" and has_plugin_scheme(script_file):
        session = _get_session(session_id) or {}
        context = {
            "artifacts_dir": session.get("artifacts_dir"),
            "testdata_dirs": list(session.get("testdata_dirs") or []),
        }
        path = Path(resolve_script_file(script_file, context, ""))
        params["script_type"] = "source"
        params["script"] = path.read_text(encoding="utf-8")
        params["script_name"] = path.name
        del params["script_file"]
    return params


def _netcat_request(resolved: dict[str, Any], session_id: str) -> dict[str, Any]:
    """A WAVE-side File payload read here and shipped base64, or its failure (NETCAT-10)."""
    params = dict(resolved)
    file = str(params.get("file") or "").strip()
    if params.get("mode") == "talk" and params.get("send") == "file" and has_plugin_scheme(file):
        session = _get_session(session_id) or {}
        try:
            data = read_wave_payload(
                file, session.get("artifacts_dir"), list(session.get("testdata_dirs") or [])
            )
        except NetcatFailure as exc:
            params["payload_error"] = str(exc)
        else:
            params["payload_base64"] = base64.b64encode(data).decode("ascii")
    return params


async def _sql_request(worker: Any, resolved: dict[str, Any], session_id: str) -> dict[str, Any]:
    """WAVE-side files read here, decimals as text, the driver's wheels pushed first (SQL-15)."""
    session = _get_session(session_id) or {}
    request = remote_request(
        resolved, session.get("artifacts_dir"), list(session.get("testdata_dirs") or [])
    )
    database_type = database_type_of(resolved)
    if database_type in COMPILED_PACKAGES and needs_wheels(resolved):
        try:
            paths = select_wheels(worker.probe, database_type, worker.host)
        except UnsupportedHost as exc:
            request["unsupported"] = str(exc)
        else:
            await push_wheels(worker, paths)
    return request


def _json_safe_variables(variables: Any) -> dict[str, Any]:
    """Only JSON-serializable variables cross to the remote worker.

    The request is JSON-framed and the run's variable mapping holds
    non-serializable objects (LazyVariables, SystemObject, ProfileObject, ...);
    params are already resolved on WAVE, so the worker needs only plain values.
    """
    safe: dict[str, Any] = {}
    for key, value in variables.items():
        try:
            json.dumps(value)
        except (TypeError, ValueError):
            continue
        safe[key] = value
    return safe


def _replay_remote_logs(
    logs: list[dict[str, Any]],
    session_id: str,
    source: str,
    block_id: str,
    unmask: bool | None = None,
) -> None:
    """Replay the worker's captured logs into the run, masked unless ``unmask`` reveals them."""
    for entry in logs:
        _add_execution_log(
            session_id,
            str(entry.get("level", "INFO")),
            str(entry.get("message", "")),
            source,
            block_id=block_id,
            unmask=unmask,
        )


def _register_map_response_credentials(
    value_map: dict[str, Any],
    catalog: set[str],
    reveal: set[str],
    registry: Any,
    block_id: str,
) -> None:
    """Register each catalog-named credential sub-key of one map-shaped output."""
    for sub_key, sub_value in value_map.items():
        low = sub_key.lower()
        if low in catalog:
            registry.register_value(
                sub_value, f"response:{low}", exempt_block=block_id if low in reveal else None
            )


def _remote_register_secret(registry: Any) -> Any:
    """The one-argument hook envelope secrets register through; never marks a reveal."""
    if registry is None:
        return None
    return lambda value: registry.register_value(value, "remote:envelope")


def _register_remote_response_credentials(
    surfaced: Any,
    plugin_metadata: dict[str, Any],
    unmasked_secret_fields: list[str],
    registry: Any,
    block_id: str,
) -> None:
    """Register credential values inside map-shaped remote outputs (the WAVE-side
    twin of the local plugin's response-cred registration); a revealed field
    still registers, exempting only this block's own display lines."""
    if registry is None or not isinstance(surfaced, dict):
        return
    catalog = {name.lower() for name in plugin_metadata.get("secret_mask_fields") or []}
    if not catalog:
        return
    reveal = {name.lower() for name in unmasked_secret_fields or []}
    for value in surfaced.values():
        if isinstance(value, dict):
            _register_map_response_credentials(value, catalog, reveal, registry, block_id)


async def _run_remote_plugin(
    worker: Any,
    nf: dict[str, Any],
    variables: dict[str, Any],
    session_id: str,
    block_id: str,
) -> Any:
    """Run one plugin block on the worker with the same secret protection as a local
    block: masked Inputs/Outputs echo, secret-output and response-cred registration,
    per-block reveal (REQ-3.1.3.5), worker log replay. Returns the surfaced result."""
    from wavecore.core.plugin_registry import get_plugin

    element_type = nf["element_type"]
    resolved = _resolve_remote_params(nf, variables, session_id)

    plugin = get_plugin(element_type, nf["version"])
    # The body was validated remotable, so its plugin is registered.
    assert plugin is not None
    plugin_metadata = plugin.metadata
    source = block_source(element_type, plugin_metadata, nf["node_data"].get("label"))
    # The plugin's own parameter checks run on WAVE, before anything crosses the wire.
    await plugin.validate(resolved)
    reveal_secrets = masking_settings.resolve_block_reveal(nf["secret_masking"])
    unmasked_secret_fields = nf["unmasked_secret_fields"]
    registry = _get_session_registry(session_id)
    session_logger = SessionLogger(
        session_id=session_id,
        source=source,
        threshold=LogLevel.DEBUG,
        block_id=block_id,
        unmask=reveal_secrets,
    )
    _register_revealed_param_exemptions(
        resolved, plugin_metadata, unmasked_secret_fields, registry, block_id
    )
    catalog_for_mask = _mask_catalog_for(plugin_metadata, unmasked_secret_fields)
    _log_masked_inputs(
        session_logger,
        resolved,
        plugin_metadata,
        catalog_for_mask,
        reveal_secrets,
        unmasked_secret_fields,
        registry=registry,
        block_id=block_id,
    )

    request_params = resolved
    if element_type == _PYTHON_ELEMENT:
        session_logger.info(start_line(resolved, PYTHON_NOUN, "interpreter", "", REMOTE_LOCUS))
        secret_outputs = _effective_secret_output_names(plugin_metadata, nf["output_secret_fields"])
        request_params = _python_request(
            resolved, session_id, sorted(secret_outputs), nf["output_bindings"]
        )
    elif element_type == _NETCAT_ELEMENT:
        request_params = _netcat_request(resolved, session_id)
    elif element_type == _SQL_ELEMENT:
        request_params = await _sql_request(worker, resolved, session_id)
    result = await run_on_worker(
        worker,
        element_type,
        request_params,
        _json_safe_variables(variables),
        certificates.current_trust_spec().to_wire(),
    )
    surfaced = materialize(result.get("return_value"), _remote_register_secret(registry))
    export_failure = None
    if element_type == _PYTHON_ELEMENT and result.get("status") == "passed":
        context = _export_context(nf["output_bindings"])
        surfaced, export_failure = remote_exports(resolved, surfaced, context)
    # Register secret values before the log replay so replayed lines scrub them.
    _register_secret_output_values(surfaced, plugin_metadata, nf["output_secret_fields"], registry)
    _register_remote_response_credentials(
        surfaced, plugin_metadata, unmasked_secret_fields, registry, block_id
    )
    _replay_remote_logs(
        result.get("logs") or [], session_id, source, block_id, unmask=reveal_secrets
    )
    if result.get("status") != "passed" or result.get("error"):
        raise RuntimeError(result.get("error") or "remote plugin failed")
    if export_failure is not None:
        surfaced = fail_or_record(
            resolved, surfaced, export_failure, "OutputVariable", session_logger, PYTHON_NOUN
        )
    _log_masked_outputs(
        session_logger,
        surfaced,
        plugin_metadata,
        nf["output_secret_fields"],
        catalog_for_mask,
        reveal_secrets,
        registry=registry,
        block_id=block_id,
    )
    return surfaced


async def run_on_body_worker(
    body_worker: BodyWorker | _AdhocBodyWorker,
    nf: dict[str, Any],
    variables: dict[str, Any],
    session_id: str,
    block_id: str,
) -> Any:
    """Run a remotable block inside a body on that body's worker; its container names the host."""
    # A worker that cannot open fails this block with its own reason, not as a remote-host error.
    opened = body_worker if isinstance(body_worker, BodyWorker) else await body_worker.opened()
    try:
        return await _run_remote_plugin(opened.worker, nf, variables, session_id, block_id)
    except Exception as exc:
        opened.failed_on_host = True
        raise RemoteHostError(str(exc)) from exc


def _bind_remote_session_id(
    node: dict[str, Any], remote_session_id: str, variables: dict[str, Any]
) -> None:
    """Bind the container's single output (Remote Session ID) to its variable."""
    bindings = ((node.get("data") or {}).get("config") or {}).get("outputBindings") or {}
    var_name = bindings.get("remote_session_id")
    if var_name:
        variables[var_name] = remote_session_id


def _resolve_session_id(nf: dict[str, Any], variables: dict[str, Any], run_session_id: str) -> Any:
    """Resolve the container's Session ID input the same way the SSH plugins do.

    The value is an expression / variable reference (e.g. the SSH Session Open
    output bound to a variable), so it must be evaluated against the run
    variables - not read raw - to yield the live session handle.
    """
    from wavecore.core.execution.plugin_executor import resolve_parameters

    resolved = resolve_parameters(
        nf["config_values"],
        nf["expression_fields"],
        variables,
        {"session_id": "string"},
        template_fields=nf["template_fields"],
        map_expression_keys=build_map_expression_keys(nf["expression_fields"]),
        registry=_get_session_registry(run_session_id),
        null_policies={"session_id": NullPolicy()},
    )
    return resolved.get("session_id")


async def execute_remote_container(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    environment_id: str | None,
) -> None:
    """Open a worker on the SSH session's host, walk the body, tear the worker down."""
    handle_targets = _map_handle_targets(adj.get(node_id, []))
    then_target = handle_targets.get("then")
    body_target = handle_targets.get("body")
    try:
        await _walk_remote_body(
            node_id,
            body_target,
            then_target,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            exec_queue,
            environment_id,
        )
    finally:
        await skip_lane_never_run(
            body_target, then_target, adj, node_map, session, session_id, executed
        )


async def _walk_remote_body(
    node_id: str,
    body_target: str | None,
    then_target: str | None,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    environment_id: str | None,
) -> None:
    """Resolve the Execution Host session, then walk the body once on its worker."""
    node = node_map[node_id]
    nf = _extract_node_fields(node)
    session_ref = _resolve_session_id(nf, variables, session_id)
    if not session_ref:
        raise ValueError("Missing required parameter: session_id")

    record = require_session(session.get("ssh_session_registry"), session_ref)

    body_chain: list[str] = []
    if body_target:
        body_chain = _trace_body_chain(body_target, adj, node_map, executed)

    failures: list[Exception] = []
    async with _held_body_worker(session, record, session_ref) as (remote_session_id, body_worker):
        outcome = await _execute_body_chain_iteration(
            body_chain,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
            log_prefix="Remote Execution",
            adj=adj,
            failures=failures,
        )
        if failures and body_worker.failed_on_host:
            raise RuntimeError(
                f"Remote Execution failed on host '{body_worker.host}': {failures[0]}"
            ) from failures[0]
        if failures:
            raise failures[0]
        _bind_remote_session_id(node, remote_session_id, variables)

    if outcome == "ok" and then_target and then_target not in executed:
        exec_queue.append(then_target)
