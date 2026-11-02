"""Admin mode toggle endpoints (REQ-5.2.6.1, REQ-5.2.6.2, REQ-5.2.6.3).

This module implements the two-layer admin mode security model that prevents
accidental or unauthorized use of dangerous state manipulation operations.

Endpoints:
- POST /admin/enable: Activate admin mode with documented reason
- POST /admin/disable: Deactivate admin mode
- GET /admin/status: Get current admin mode status
- POST /admin/reset: Clear all test data (requires active admin mode)
- GET /admin/workbench/session: Inspect the active Workbench session
- DELETE /admin/workbench/session: Force-terminate the active Workbench session
"""

import logging
import os
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.executions import _storage as _exec_storage
from wavecore.api.services.network import certificates as network_certificates
from wavecore.api.services.network import proxy as network_proxy
from wavecore.api.services.profiles import _common as _profile_common
from wavecore.api.services.regressions import _storage as _reg_storage
from wavecore.api.services.suites import _storage as _suite_storage
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_service
from wavecore.core.ssh import trusted_hosts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])

# Admin activation state (instance-scoped, in-memory only)
_admin_enabled: bool = False
_admin_enabled_at: datetime | None = None
_admin_reason: str | None = None

_ERR_ADMIN_NOT_ENABLED = "Admin mode must be enabled first"
_TZ_UTC_SUFFIX = "+00:00"

# Default reset categories (test data cleared when scope is omitted)
DEFAULT_RESET_CATEGORIES = {"entities", "blocks", "executions", "artifacts", "testdata"}
VALID_RESET_CATEGORIES = DEFAULT_RESET_CATEGORIES | {
    "environments",
    "profiles",
    "mcp",
    "network",
    "ssh-hosts",
}


# =============================================================================
# Public API functions (used by other admin modules)
# =============================================================================


def is_admin_allowed() -> bool:
    """Check if the deployment gate allows admin mode."""
    value = os.environ.get("WAVE_ADMIN_ALLOWED", "").lower()
    return value in ("true", "1", "yes")


def is_admin_enabled() -> bool:
    """Check if admin mode is currently enabled."""
    return _admin_enabled


def get_admin_capabilities() -> list[str]:
    """Get list of available admin capabilities."""
    return ["state-manipulation", "cache-management", "data-seeding"]


def get_registered_plugins() -> list[dict[str, str]]:
    """Get list of registered plugins."""
    return []


def get_system_config() -> dict[str, str]:
    """Get system configuration."""
    return {}


def get_credential_profiles() -> list[dict[str, str]]:
    """Get credential profiles."""
    return []


def check_admin_allowed_or_404(endpoint: str) -> None:
    """Check if admin mode is allowed, raise 404 if not."""
    if not is_admin_allowed():
        logger.warning("Blocked admin %s attempt: deployment gate disallows admin mode", endpoint)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


def require_admin_active() -> None:
    """Check if admin mode is active, raise 403 if not."""
    if not is_admin_enabled():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_ERR_ADMIN_NOT_ENABLED)


def invalidate_dashboard_cache() -> None:
    """Invalidate the dashboard cache after data changes."""
    from wavecore.api.routes.dashboard.routes import (
        invalidate_dashboard_cache as dashboard_invalidate,
    )

    dashboard_invalidate()


def invalidate_entity_caches() -> None:
    """Invalidate entity-related caches after data changes."""
    pass


# =============================================================================
# Storage helpers
# =============================================================================


def _clear_execution_stores() -> None:
    _exec_storage._execution_storage.clear()
    _exec_storage._execution_variables.clear()
    _exec_storage._runtime_state.clear()
    _exec_storage._composition_cache.clear()
    _exec_storage._log_seq.clear()


def clear_bulk_stores() -> None:
    """Clear all test data entity stores via service layer."""
    test_service._clear_storage()
    _suite_storage._ensure_storage_dir()
    _reg_storage._ensure_storage_dir()
    for suite in _suite_storage._list_all_suites():
        _suite_storage._delete_suite_files(suite["id"])
    for regression in _reg_storage._list_all_regressions():
        _reg_storage._delete_regression_files(regression["id"])
    _clear_execution_stores()


def _clear_entities() -> int:
    tests = test_service._list_all_tests()
    test_service._clear_storage()
    suites = _suite_storage._list_all_suites()
    for suite in suites:
        _suite_storage._delete_suite_files(suite["id"])
    regressions = _reg_storage._list_all_regressions()
    for regression in regressions:
        _reg_storage._delete_regression_files(regression["id"])
    # The test->suite index is a lazy cache; reset it or newly seeded tests read stale suites.
    from wavecore.api.services.relations import service as _relation_service

    _relation_service._test_to_suites.clear()
    _relation_service._initialized = False
    return len(tests) + len(suites) + len(regressions)


def _clear_executions() -> int:
    count = len(_exec_storage._execution_storage)
    _clear_execution_stores()
    return count


def _clear_blocks() -> int:
    from wavecore.api.services.blocks import _storage as _block_storage

    blocks = _block_storage._list_all_blocks()
    for block in blocks:
        _block_storage._delete_block_files(block["id"])
    return len(blocks)


def _clear_testdata() -> int:
    testdata_service.reset_zone()
    return 0


def _clear_mcp() -> int:
    # Live sessions are owned by the connect/disconnect lifecycle, not by reset.
    from wavecore.mcp import state as mcp_state

    count = len(mcp_state.get_activity())
    mcp_state.clear_activity()
    return count


def _clear_environments() -> int:
    count = len(environment_service._environments)
    environment_service._clear_storage()
    return count


def _clear_profiles() -> int:
    _profile_common._ensure_cache_loaded()
    count = len(_profile_common._profile_storage)
    _profile_common._clear_storage()
    return count


def _clear_network() -> int:
    trusted_hosts.reset_policy()
    network_certificates.reset()
    network_proxy.reset()
    return 0


def _clear_ssh_hosts() -> int:
    return trusted_hosts.clear_hosts()


def _clear_nothing() -> int:
    return 0


_CATEGORY_CLEARERS: dict[str, Callable[[], int]] = {
    "entities": _clear_entities,
    "executions": _clear_executions,
    "blocks": _clear_blocks,
    "artifacts": _clear_nothing,
    "testdata": _clear_testdata,
    "mcp": _clear_mcp,
    "environments": _clear_environments,
    "profiles": _clear_profiles,
    "network": _clear_network,
    "ssh-hosts": _clear_ssh_hosts,
}


def clear_category(category: str) -> int:
    """Clear a specific data category and return count of items cleared."""
    return _CATEGORY_CLEARERS.get(category, _clear_nothing)()


# =============================================================================
# Request/Response Models
# =============================================================================


class AdminEnableRequest(BaseModel):
    reason: str | None = None


class AdminEnableResponse(BaseModel):
    enabled: bool
    enabled_at: str
    reason: str
    capabilities: list[str]


class AdminDisableResponse(BaseModel):
    enabled: bool
    disabled_at: str | None = None
    duration_seconds: float | None = None


class AdminStatusResponse(BaseModel):
    allowed: bool
    enabled: bool
    enabled_at: str | None = None
    reason: str | None = None


class AdminResetRequest(BaseModel):
    confirm: bool | None = None
    scope: list[str] | None = None


class AdminResetResponse(BaseModel):
    cleared: dict[str, int]
    timestamp: str


class AdminResetErrorResponse(BaseModel):
    cleared: dict[str, int]
    timestamp: str
    error: str


# =============================================================================
# Endpoints
# =============================================================================


@router.post("/enable")
async def enable_admin(request: Request, body: AdminEnableRequest) -> AdminEnableResponse:
    """Enable admin mode with documented reason."""
    check_admin_allowed_or_404("enable")

    reason = body.reason
    if not reason or not reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Reason is required and cannot be empty"
        )

    global _admin_enabled, _admin_enabled_at, _admin_reason
    _admin_enabled = True
    _admin_enabled_at = datetime.now(UTC)
    _admin_reason = reason.strip()

    logger.info(
        "Admin mode enabled: reason=%s, timestamp=%s", _admin_reason, _admin_enabled_at.isoformat()
    )

    return AdminEnableResponse(
        enabled=True,
        enabled_at=_admin_enabled_at.isoformat().replace(_TZ_UTC_SUFFIX, "Z"),
        reason=_admin_reason,
        capabilities=get_admin_capabilities(),
    )


@router.post("/disable")
async def disable_admin(request: Request) -> AdminDisableResponse:
    """Disable admin mode."""
    check_admin_allowed_or_404("disable")

    global _admin_enabled, _admin_enabled_at, _admin_reason
    now = datetime.now(UTC)

    if _admin_enabled and _admin_enabled_at:
        duration = (now - _admin_enabled_at).total_seconds()
        disabled_at = now.isoformat().replace(_TZ_UTC_SUFFIX, "Z")
        logger.info(
            "Admin mode disabled: duration_seconds=%.2f, timestamp=%s", duration, disabled_at
        )
        _admin_enabled = False
        _admin_enabled_at = None
        _admin_reason = None
        return AdminDisableResponse(
            enabled=False, disabled_at=disabled_at, duration_seconds=duration
        )
    else:
        logger.info("Admin mode disable called when already inactive")
        return AdminDisableResponse(enabled=False, disabled_at=None, duration_seconds=None)


@router.get("/status")
async def get_admin_status(request: Request) -> AdminStatusResponse:
    """Get current admin mode status."""
    check_admin_allowed_or_404("status")

    if _admin_enabled and _admin_enabled_at and _admin_reason:
        return AdminStatusResponse(
            allowed=True,
            enabled=True,
            enabled_at=_admin_enabled_at.isoformat().replace(_TZ_UTC_SUFFIX, "Z"),
            reason=_admin_reason,
        )
    else:
        return AdminStatusResponse(allowed=True, enabled=False, enabled_at=None, reason=None)


@router.post("/reset", response_model=None)
async def reset_state(
    request: Request, body: AdminResetRequest
) -> AdminResetResponse | JSONResponse:
    """Reset system state by clearing test data categories."""
    check_admin_allowed_or_404("reset")

    if not is_admin_enabled():
        logger.warning("Blocked admin reset attempt: admin mode not enabled")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_ERR_ADMIN_NOT_ENABLED)

    if body.confirm is not True:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation required: set confirm=true",
        )

    if body.scope is not None:
        for category in body.scope:
            if category not in VALID_RESET_CATEGORIES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid scope category: {category}",
                )
        categories_to_clear = list(dict.fromkeys(body.scope))
    else:
        categories_to_clear = list(DEFAULT_RESET_CATEGORIES)

    cleared: dict[str, int] = {}
    error_message: str | None = None

    for category in categories_to_clear:
        try:
            count = clear_category(category)
            cleared[category] = count
        except Exception as e:
            error_message = f"Error clearing {category}: {e!s}"
            logger.error(
                "Reset failed on category %s: %s, admin_reason=%s", category, e, _admin_reason
            )
            break

    invalidate_dashboard_cache()
    invalidate_entity_caches()

    timestamp = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")
    logger.info(
        "Admin reset completed: cleared=%s, timestamp=%s, admin_reason=%s",
        cleared,
        timestamp,
        _admin_reason,
    )

    if error_message:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"cleared": cleared, "timestamp": timestamp, "error": error_message},
        )

    return AdminResetResponse(cleared=cleared, timestamp=timestamp)


# ============================================================================
# Workbench session inspection + teardown (for automated-test cleanup)
# ============================================================================


class AdminWorkbenchSessionResponse(BaseModel):
    session_id: str | None = None
    status: str | None = None
    test_id: str | None = None
    test_name: str | None = None
    execution_id: str | None = None


class AdminWorkbenchClearResponse(BaseModel):
    cleared: bool


@router.get("/workbench/session")
async def get_active_workbench_session() -> AdminWorkbenchSessionResponse:
    """Inspect the current user's active Workbench session.

    Returns an empty envelope (all fields ``null``) when no session exists.
    """
    check_admin_allowed_or_404("workbench-session")

    from wavecore.api.services.workbench import service as workbench_service

    session = workbench_service.get_session_for_user()
    if not session:
        return AdminWorkbenchSessionResponse()

    return AdminWorkbenchSessionResponse(
        session_id=session.get("session_id"),
        status=session.get("status"),
        test_id=session.get("test_id"),
        test_name=session.get("test_name"),
        execution_id=session.get("execution_id"),
    )


@router.delete("/workbench/session")
async def delete_active_workbench_session() -> AdminWorkbenchClearResponse:
    """Force-terminate the current user's active Workbench session.

    Idempotent - returns ``cleared=False`` when no session was held.
    """
    check_admin_allowed_or_404("workbench-session")

    from wavecore.api.services.workbench import service as workbench_service

    result = workbench_service.clear_session_for_user()
    return AdminWorkbenchClearResponse(cleared=bool(result.get("cleared")))
