"""Admin bulk operation endpoints (REQ-5.2.6.4, REQ-5.2.1.42).

This module implements bulk CRUD operations for entity management through
the admin API, requiring active admin mode.

Endpoints:
- POST /admin/bulk/executions: Bulk execution operations
- POST /admin/bulk/tests: Bulk test operations
- POST /admin/bulk/suites: Bulk suite operations
- POST /admin/bulk/regressions: Bulk regression operations
- POST /admin/bulk/environments: Bulk environment operations
- POST /admin/bulk/profiles: Bulk profile operations
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Protocol

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Use the logger from the main admin routes module so test patches on
# wavecore.api.routes.admin.logger affect bulk operations too
from wavecore.api.routes.admin import routes as _routes_mod
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.executions import _storage as _exec_storage
from wavecore.api.services.profiles import _common as _profile_common
from wavecore.api.services.regressions import _storage as _reg_storage
from wavecore.api.services.suites import _storage as _suite_storage
from wavecore.api.services.tests import service as test_service

router = APIRouter(prefix="/admin", tags=["Admin"])

_TZ_UTC_SUFFIX = "+00:00"
_LOG_BULK_VALIDATION_FAILED = "Bulk request validation failed"

# Valid operation types
VALID_OPS = {"add", "modify", "replace", "delete"}


# =============================================================================
# Models
# =============================================================================


class BulkOperationType(str, Enum):
    """Supported bulk operation types."""

    ADD = "add"
    MODIFY = "modify"
    REPLACE = "replace"
    DELETE = "delete"


class BulkOperation(BaseModel):
    """A single bulk operation."""

    op: str | None = None
    entity: dict[str, Any] | None = None


class BulkRequest(BaseModel):
    """Request body for bulk operations."""

    operations: list[BulkOperation] | None = None


class BulkResultItem(BaseModel):
    """Result of a single bulk operation."""

    id: str
    status: str


class BulkResponse(BaseModel):
    """Response body for successful bulk operations."""

    processed: int
    results: list[BulkResultItem]
    timestamp: str


class BulkErrorResponse(BaseModel):
    """Response body for failed bulk operations."""

    detail: str
    failed_index: int


class BulkStorageError(Exception):
    """Exception raised when a bulk storage operation fails."""

    def __init__(self, message: str, failed_index: int, partial_results: list[BulkResultItem]):
        super().__init__(message)
        self.failed_index = failed_index
        self.partial_results = partial_results


# =============================================================================
# Entity Adapter Protocol
# =============================================================================


class BulkEntityAdapter(Protocol):
    """Protocol for entity-specific bulk operation storage adapters."""

    @property
    def entity_type_name(self) -> str: ...

    def list_existing(self) -> dict[str, Any]: ...

    def save(self, entity: dict[str, Any]) -> None: ...

    def delete(self, entity_id: str) -> None: ...

    def merge(self, entity_id: str, updates: dict[str, Any]) -> None: ...


# =============================================================================
# Generic Bulk Processing
# =============================================================================


def _process_single_add(
    adapter: BulkEntityAdapter,
    entity: dict[str, Any],
    entity_id: str,
    existing: dict[str, Any],
    required_fields: list[str],
    idx: int,
) -> BulkResultItem:
    """Process a single 'add' bulk operation."""
    validate_required_fields(entity, required_fields, idx, "add")
    validate_uuid(entity_id, idx, adapter.entity_type_name.lower())
    if entity_id in existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{adapter.entity_type_name} '{entity_id}' already exists",
            headers={"X-Failed-Index": str(idx)},
        )
    adapter.save(dict(entity))
    existing[entity_id] = entity
    return BulkResultItem(id=entity_id, status="created")


def _process_single_modify(
    adapter: BulkEntityAdapter,
    entity: dict[str, Any],
    entity_id: str,
    existing: dict[str, Any],
    idx: int,
) -> BulkResultItem:
    """Process a single 'modify' bulk operation."""
    if entity_id not in existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{adapter.entity_type_name} '{entity_id}' not found",
            headers={"X-Failed-Index": str(idx)},
        )
    adapter.merge(entity_id, entity)
    return BulkResultItem(id=entity_id, status="modified")


def _process_single_replace(
    adapter: BulkEntityAdapter,
    entity: dict[str, Any],
    entity_id: str,
    existing: dict[str, Any],
    required_fields: list[str],
    idx: int,
) -> BulkResultItem:
    """Process a single 'replace' bulk operation."""
    validate_required_fields(entity, required_fields, idx, "replace")
    validate_uuid(entity_id, idx, adapter.entity_type_name.lower())
    existed = entity_id in existing
    adapter.save(dict(entity))
    existing[entity_id] = entity
    return BulkResultItem(id=entity_id, status="replaced" if existed else "created")


def _process_single_delete(
    adapter: BulkEntityAdapter,
    entity_id: str,
    existing: dict[str, Any],
    idx: int,
) -> BulkResultItem:
    """Process a single 'delete' bulk operation."""
    if entity_id not in existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{adapter.entity_type_name} '{entity_id}' not found",
            headers={"X-Failed-Index": str(idx)},
        )
    adapter.delete(entity_id)
    existing.pop(entity_id, None)
    return BulkResultItem(id=entity_id, status="deleted")


def _dispatch_operation(
    adapter: BulkEntityAdapter,
    op_type: str,
    entity: dict[str, Any],
    entity_id: str,
    existing: dict[str, Any],
    required_fields: list[str],
    idx: int,
) -> BulkResultItem:
    """Dispatch a single bulk operation to its handler."""
    if op_type == "add":
        return _process_single_add(adapter, entity, entity_id, existing, required_fields, idx)
    if op_type == "modify":
        return _process_single_modify(adapter, entity, entity_id, existing, idx)
    if op_type == "replace":
        return _process_single_replace(adapter, entity, entity_id, existing, required_fields, idx)
    return _process_single_delete(adapter, entity_id, existing, idx)


def _process_bulk_operations(
    adapter: BulkEntityAdapter,
    operations: list[BulkOperation],
    required_fields: list[str],
) -> list[BulkResultItem]:
    """Generic bulk operation processor using an entity adapter."""
    results: list[BulkResultItem] = []
    existing = adapter.list_existing()

    for idx, op in enumerate(operations):
        entity = op.entity
        assert entity is not None
        op_type = op.op
        assert op_type is not None
        entity_id = entity.get("id")

        if entity_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Operation at index {idx}: 'id' is required",
            )

        try:
            result = _dispatch_operation(
                adapter, op_type, entity, entity_id, existing, required_fields, idx
            )
            results.append(result)
        except HTTPException:
            raise
        except Exception as e:
            raise BulkStorageError(str(e), idx, results) from e

    return results


# =============================================================================
# Validation Helpers
# =============================================================================


def validate_bulk_request(body: BulkRequest) -> list[BulkOperation]:
    """Validate bulk request and return operations list."""
    if body.operations is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Operations field is required"
        )

    for idx, op in enumerate(body.operations):
        if op.op is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Operation at index {idx}: 'op' field is required",
            )
        if op.op not in VALID_OPS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Operation at index {idx}: invalid op type '{op.op}'",
            )
        if op.entity is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Operation at index {idx}: 'entity' field is required",
            )

    return body.operations


def validate_required_fields(
    entity: dict[str, Any], required_fields: list[str], idx: int, op_type: str
) -> None:
    """Validate required fields for an entity."""
    for field in required_fields:
        if field not in entity or entity[field] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Operation at index {idx}: '{field}' is required for {op_type}",
            )


def validate_uuid(entity_id: str, idx: int, entity_type: str) -> None:
    """Validate that an entity ID is a valid UUID."""
    try:
        uuid.UUID(entity_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Operation at index {idx}: '{entity_id}' is not a valid UUID for {entity_type}",
        ) from None


def handle_bulk_operation_errors(
    error: HTTPException | BulkStorageError, endpoint_name: str
) -> JSONResponse:
    """Handle errors from bulk operations and return appropriate response."""
    from wavecore.api.routes.admin.routes import _admin_reason

    if isinstance(error, HTTPException):
        failed_index = 0
        if error.headers and "X-Failed-Index" in error.headers:
            failed_index = int(error.headers["X-Failed-Index"])
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": error.detail, "failed_index": failed_index},
        )

    _routes_mod.logger.error(
        "Admin %s storage error: %s, failed_index=%d, admin_reason=%s",
        endpoint_name,
        error,
        error.failed_index,
        _admin_reason,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": str(error),
            "failed_index": error.failed_index,
            "partial_results": [{"id": r.id, "status": r.status} for r in error.partial_results],
        },
    )


# =============================================================================
# Entity Adapters
# =============================================================================


class _TestAdapter:
    entity_type_name = "Test"

    def __init__(self) -> None:
        self._lookup: dict[str, Any] = {t["id"]: t for t in test_service._list_all_tests()}

    def list_existing(self) -> dict[str, Any]:
        return self._lookup

    def save(self, entity: dict[str, Any]) -> None:
        test_service._save_test(entity)

    def delete(self, entity_id: str) -> None:
        test_service._delete_test_files(entity_id)

    def merge(self, entity_id: str, updates: dict[str, Any]) -> None:
        merged = self._lookup[entity_id].copy()
        merged.update(updates)
        test_service._save_test(merged)
        self._lookup[entity_id] = merged


class _SuiteAdapter:
    entity_type_name = "Suite"

    def __init__(self) -> None:
        self._lookup: dict[str, Any] = {s["id"]: s for s in _suite_storage._list_all_suites()}

    def list_existing(self) -> dict[str, Any]:
        return self._lookup

    def save(self, entity: dict[str, Any]) -> None:
        _suite_storage._save_suite(entity)

    def delete(self, entity_id: str) -> None:
        _suite_storage._delete_suite_files(entity_id)

    def merge(self, entity_id: str, updates: dict[str, Any]) -> None:
        merged = self._lookup[entity_id].copy()
        merged.update(updates)
        _suite_storage._save_suite(merged)
        self._lookup[entity_id] = merged


class _RegressionAdapter:
    entity_type_name = "Regression"

    def __init__(self) -> None:
        self._lookup: dict[str, Any] = {r["id"]: r for r in _reg_storage._list_all_regressions()}

    def list_existing(self) -> dict[str, Any]:
        return self._lookup

    def save(self, entity: dict[str, Any]) -> None:
        _reg_storage._save_regression(entity)

    def delete(self, entity_id: str) -> None:
        _reg_storage._delete_regression_files(entity_id)

    def merge(self, entity_id: str, updates: dict[str, Any]) -> None:
        merged = self._lookup[entity_id].copy()
        merged.update(updates)
        _reg_storage._save_regression(merged)
        self._lookup[entity_id] = merged


class _DictStoreAdapter:
    """Bulk store over an in-memory cache, optionally writing the record file.

    Entity types whose listing reconciles against the storage directory need
    ``persist`` and ``purge``: a cache-only row would not survive one listing.
    """

    def __init__(
        self,
        type_name: str,
        store: dict[str, Any],
        persist: Callable[[dict[str, Any]], None] | None = None,
        purge: Callable[[str], None] | None = None,
    ) -> None:
        self.entity_type_name = type_name
        self._store = store
        self._persist = persist
        self._purge = purge

    def list_existing(self) -> dict[str, Any]:
        return dict(self._store)

    def save(self, entity: dict[str, Any]) -> None:
        self._store[entity["id"]] = entity
        if self._persist is not None:
            self._persist(entity)

    def delete(self, entity_id: str) -> None:
        del self._store[entity_id]
        if self._purge is not None:
            self._purge(entity_id)

    def merge(self, entity_id: str, updates: dict[str, Any]) -> None:
        existing_entry = self._store[entity_id]
        for key, value in updates.items():
            existing_entry[key] = value
        if self._persist is not None:
            self._persist(existing_entry)


# =============================================================================
# Service Processors
# =============================================================================


def process_test_operations(
    operations: list[BulkOperation], required_fields: list[str]
) -> list[BulkResultItem]:
    return _process_bulk_operations(_TestAdapter(), operations, required_fields)


def process_suite_operations(
    operations: list[BulkOperation], required_fields: list[str]
) -> list[BulkResultItem]:
    return _process_bulk_operations(_SuiteAdapter(), operations, required_fields)


def process_regression_operations(
    operations: list[BulkOperation], required_fields: list[str]
) -> list[BulkResultItem]:
    return _process_bulk_operations(_RegressionAdapter(), operations, required_fields)


def process_execution_operations(
    operations: list[BulkOperation], required_fields: list[str]
) -> list[BulkResultItem]:
    # A first load mid-request would replace the store and drop the rows added before it.
    _exec_storage._ensure_cache_loaded()
    results = _process_bulk_operations(
        _DictStoreAdapter("Execution", _exec_storage._execution_storage),
        operations,
        required_fields,
    )
    # Materialize the append-only disk layout (composition.yaml + runs.yaml
    # + status.yaml) for any newly-added executions. Without this, the
    # Execution Detail view's `_enrich_execution_for_detail` reads an
    # empty composition and the Components table renders no tests -
    # admin-seeded fixtures show up as "just a cover sheet" otherwise.
    for _op, result in zip(operations, results, strict=False):
        # Only materialize for operations that actually wrote a new
        # execution record. BulkResultItem.status strings come from
        # the storage adapter; "created" / "replaced" are the two
        # write-path outcomes. Modify / delete paths produce
        # "modified" / "deleted" and fall through this filter.
        if result.status not in ("created", "replaced"):
            continue
        execution = _exec_storage._execution_storage[result.id]
        try:
            _materialize_bulk_execution(execution)
        except Exception as e:  # noqa: BLE001
            # Materialization is best-effort: the execution row has
            # already landed, so a failure to write composition.yaml
            # must not fail the bulk request. Log and move on.
            _routes_mod.logger.warning(
                "Failed to materialize composition for bulk-seeded execution %s: %s",
                result.id,
                e,
            )
    return results


def _materialize_bulk_execution(execution: dict[str, Any]) -> None:
    """Write composition.yaml + runs.yaml + status.yaml for an
    admin-bulk-seeded execution.

    Two shapes are honored:
    - Nested `suites[].tests[]` on the execution payload (used by
      regression / suite fixtures that need explicit per-test run_ids
      and statuses). Preserves seeded run_ids so tests that drive
      `/executions/history/<run_id>` still reach the fixture's runs.
    - No nested data: fall back to fetching the entity and calling
      `_build_composition_for_execution`; every run adopts the cover
      sheet's terminal status.
    """
    from wavecore.api.services.executions import service as exec_service
    from wavecore.api.services.executions._storage import (
        _append_run,
        _append_status,
        _init_runtime_state,
        _save_composition,
        _save_execution,
    )

    exec_id = execution["id"]
    entity_type = execution.get("entity_type", "")
    entity_id = execution.get("entity_id") or ""
    exec_status = execution.get("status") or "running"
    started_at = execution.get("started_at") or datetime.now(UTC).isoformat()
    ended_at = execution.get("ended_at") or execution.get("completed_at")
    duration = execution.get("duration")

    composition, runs_seed = _compose_from_bulk_payload(execution, entity_type, entity_id)
    if composition is None:
        return

    # Persist the cover sheet alongside the runs / status / composition
    # files. Without this, the next call to ``_ensure_cache_loaded`` (which
    # clears the in-memory dict and reloads from disk) drops the bulk-seeded
    # execution because no ``execution.yaml`` exists for ``_load_execution``
    # to find. The Historical Canvas API ``_locate_run`` then returns 404
    # because the cover sheet is gone from the cache.
    _save_execution(execution)
    _save_composition(exec_id, composition)

    selected_run_ids = {r["run_id"] for r in runs_seed}
    _init_runtime_state(exec_id, started_at, composition, selected_run_ids)

    # Append runs.yaml + status.yaml so a backend restart rebuilds
    # runtime state without the in-memory cache.
    for run in runs_seed:
        _append_run(
            exec_id,
            {
                "run_id": run["run_id"],
                "test_id": run["test_id"],
                "suite_id": run.get("suite_id"),
            },
        )
        run_status = run.get("status") or exec_status
        _append_status(
            exec_id,
            {
                "run_id": run["run_id"],
                "status": run_status,
                "started_at": started_at,
                "ended_at": ended_at,
                "duration": run.get("duration", duration),
            },
        )
    # Keep the in-memory runtime map aligned with what we just wrote
    # to disk so the first detail read doesn't need to rebuild. We
    # just called `_init_runtime_state` above so both the runtime
    # entry and the per-run slots are guaranteed to exist - no need
    # for an extra not-None guard.
    runtime = _exec_storage._runtime_state[exec_id]
    runtime["ended_at"] = ended_at
    runtime["duration"] = duration
    for run in runs_seed:
        slot = runtime["runs"][run["run_id"]]
        slot["status"] = run.get("status") or exec_status
        slot["started_at"] = started_at
        slot["ended_at"] = ended_at
        slot["duration"] = run.get("duration", duration)

    # Keep the underlying `service` module from being unused-import-flagged;
    # the call may be needed by future callers for entity lookup.
    _ = exec_service


def _compose_from_bulk_payload(
    execution: dict[str, Any],
    entity_type: str,
    entity_id: str,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Return ``(composition, runs_seed)`` derived from a bulk payload.

    Prefers the nested `suites` shape when present (needed by fixtures
    that pin specific run_ids). Falls back to the entity lookup path so
    v-exec-01-style seeds that only carry a cover sheet still work.
    """
    nested_suites = execution.get("suites")
    if isinstance(nested_suites, list) and nested_suites:
        return _compose_from_nested_suites(nested_suites, execution)

    return _compose_from_entity(execution, entity_type, entity_id)


def _compose_from_nested_suites(
    nested_suites: list[dict[str, Any]],
    execution: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Build composition + runs from the nested `suites[].tests[]` tree
    that regression/suite fixtures carry on the execution payload.
    Existing run_ids are preserved; tests without a run_id mint a fresh
    UUID so the composition is always complete."""
    composition_suites: list[dict[str, Any]] = []
    runs_seed: list[dict[str, Any]] = []
    exec_status = execution.get("status") or "running"

    for suite in nested_suites:
        suite_id = suite.get("id")
        comp_tests: list[dict[str, Any]] = []
        for test in suite.get("tests", []):
            run_id = test.get("run_id")
            if not run_id:
                # Excluded/unselected tests carry no run_id; skip them
                # from runs.yaml but record them in the composition so
                # the Components table can render the excluded row.
                comp_tests.append(
                    {
                        "id": test.get("id"),
                        "name": test.get("name", ""),
                        "run_id": None,
                    }
                )
                continue
            comp_tests.append(
                {
                    "id": test.get("id"),
                    "name": test.get("name", ""),
                    "run_id": run_id,
                }
            )
            runs_seed.append(
                {
                    "run_id": run_id,
                    "test_id": test.get("id"),
                    "suite_id": suite_id,
                    "status": test.get("status") or exec_status,
                    "duration": test.get("duration"),
                }
            )
        composition_suites.append(
            {
                "id": suite_id,
                "name": suite.get("name", ""),
                "tests": comp_tests,
            }
        )

    return {"suites": composition_suites}, runs_seed


def _compose_from_entity(
    execution: dict[str, Any],
    entity_type: str,
    entity_id: str,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Build composition + runs by looking the entity up in the test /
    suite / regression stores. Per-run status adopts the cover sheet's
    terminal status because flat-cover-sheet fixtures don't carry
    per-test statuses.
    """
    from wavecore.api.services.executions import service as exec_service
    from wavecore.api.services.regressions import service as regression_service
    from wavecore.api.services.suites import service as suite_service
    from wavecore.api.services.tests import service as test_service

    if entity_type == "test":
        entity = test_service.get_test(entity_id)
    elif entity_type == "suite":
        entity = suite_service.get_suite(entity_id)
    elif entity_type == "regression":
        entity = regression_service.get_regression(entity_id)
    else:
        return None, []
    if entity is None:
        return None, []

    composition, _ = exec_service._build_composition_for_execution(
        entity_type,
        entity,
        execution.get("selected_tests"),
        execution_id=execution["id"],
    )
    exec_status = execution.get("status") or "running"
    # `_build_composition_for_execution` always pins a run_id on every
    # test it emits (suite/regression helpers generate fresh UUIDs; the
    # test branch reuses execution_id). That guarantee lets us skip the
    # "missing run_id" defensive branch here.
    runs_seed: list[dict[str, Any]] = [
        {
            "run_id": test["run_id"],
            "test_id": test.get("id"),
            "suite_id": suite.get("id"),
            "status": exec_status,
            "duration": execution.get("duration"),
        }
        for suite in composition.get("suites", [])
        for test in suite.get("tests", [])
    ]
    return composition, runs_seed


def process_environment_operations(
    operations: list[BulkOperation], required_fields: list[str]
) -> list[BulkResultItem]:
    return _process_bulk_operations(
        _DictStoreAdapter(
            "Environment",
            environment_service._environments,
            environment_service._save_environment,
            environment_service._delete_environment_files,
        ),
        operations,
        required_fields,
    )


def process_profile_operations(
    operations: list[BulkOperation], required_fields: list[str]
) -> list[BulkResultItem]:
    return _process_bulk_operations(
        _DictStoreAdapter(
            "Profile",
            _profile_common._profile_storage,
            _profile_common._save_profile,
            _profile_common._delete_profile_files,
        ),
        operations,
        required_fields,
    )


# =============================================================================
# Helper for admin guard
# =============================================================================


def _admin_guard(endpoint: str) -> None:
    """Check admin allowed and enabled."""
    from wavecore.api.routes.admin.routes import (
        check_admin_allowed_or_404,
        is_admin_enabled,
    )

    check_admin_allowed_or_404(endpoint)
    if not is_admin_enabled():
        _routes_mod.logger.warning("Blocked admin %s attempt: admin mode not enabled", endpoint)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin mode must be enabled first"
        )


def _bulk_endpoint(
    body: BulkRequest,
    endpoint_name: str,
    required_fields: list[str],
    processor: Any,
) -> BulkResponse | JSONResponse:
    """Generic bulk endpoint handler."""
    from wavecore.api.routes.admin.routes import (
        _admin_reason,
        invalidate_dashboard_cache,
        invalidate_entity_caches,
    )

    _admin_guard(endpoint_name)

    try:
        operations = validate_bulk_request(body)
    except HTTPException:
        _routes_mod.logger.debug(_LOG_BULK_VALIDATION_FAILED)
        raise

    if len(operations) == 0:
        timestamp = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")
        _routes_mod.logger.info(
            "Admin %s completed: processed=0, timestamp=%s, admin_reason=%s",
            endpoint_name,
            timestamp,
            _admin_reason,
        )
        return BulkResponse(processed=0, results=[], timestamp=timestamp)

    try:
        results = processor(operations, required_fields)
    except (HTTPException, BulkStorageError) as e:
        return handle_bulk_operation_errors(e, endpoint_name)

    invalidate_dashboard_cache()
    invalidate_entity_caches()

    timestamp = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")
    _routes_mod.logger.info(
        "Admin %s completed: processed=%d, timestamp=%s, admin_reason=%s",
        endpoint_name,
        len(results),
        timestamp,
        _admin_reason,
    )
    return BulkResponse(processed=len(results), results=results, timestamp=timestamp)


# =============================================================================
# Endpoints
# =============================================================================


@router.post("/bulk/executions", response_model=None)
async def bulk_executions(request: Request, body: BulkRequest) -> BulkResponse | JSONResponse:
    """Bulk execution operations (REQ-5.2.6.4.1)."""
    return _bulk_endpoint(
        body,
        "bulk/executions",
        ["id", "entity_type", "entity_id", "status"],
        process_execution_operations,
    )


@router.post("/bulk/tests", response_model=None)
async def bulk_tests(request: Request, body: BulkRequest) -> BulkResponse | JSONResponse:
    """Bulk test operations (REQ-5.2.6.4.2)."""
    return _bulk_endpoint(body, "bulk/tests", ["id", "name", "version"], process_test_operations)


@router.post("/bulk/suites", response_model=None)
async def bulk_suites(request: Request, body: BulkRequest) -> BulkResponse | JSONResponse:
    """Bulk suite operations (REQ-5.2.6.4.3)."""
    return _bulk_endpoint(body, "bulk/suites", ["id", "name", "version"], process_suite_operations)


@router.post("/bulk/regressions", response_model=None)
async def bulk_regressions(request: Request, body: BulkRequest) -> BulkResponse | JSONResponse:
    """Bulk regression operations (REQ-5.2.6.4.4)."""
    return _bulk_endpoint(
        body, "bulk/regressions", ["id", "name", "version"], process_regression_operations
    )


@router.post("/bulk/environments", response_model=None)
async def bulk_environments(request: Request, body: BulkRequest) -> BulkResponse | JSONResponse:
    """Bulk environment operations (REQ-5.2.1.42)."""
    return _bulk_endpoint(body, "bulk/environments", ["id", "name"], process_environment_operations)


@router.post("/bulk/profiles", response_model=None)
async def bulk_profiles(request: Request, body: BulkRequest) -> BulkResponse | JSONResponse:
    """Bulk profile operations (REQ-5.2.1.42)."""
    return _bulk_endpoint(body, "bulk/profiles", ["id", "name"], process_profile_operations)
