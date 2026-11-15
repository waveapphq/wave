"""Status Dashboard endpoint for WAVE backend (REQ-5.2.1.43).

This module provides the status dashboard endpoint which offers an aggregated view
of system state for the main navigation dashboard.

Error Handling:
- Complete storage unavailability: HTTP 503
- Partial failures: HTTP 200 with available data; failed sections return null (not empty)
- errors array in metadata describes what failed

Performance and Caching:
- Target sub-200ms response using optimized count queries
- 5-second cache TTL balancing freshness with performance
- Cache invalidation on entity or execution state changes
"""

import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, TypeVar

from fastapi import APIRouter, status

from wavecore.api.exceptions import WaveException
from wavecore.api.routes.dashboard.helpers import (
    get_execution_statistics,
    get_recent_activity,
    get_recent_executions,
    get_regression_count,
    get_suite_count,
    get_test_count,
)
from wavecore.api.services.entity_cache import reconcile_once

logger = logging.getLogger(__name__)

_T = TypeVar("_T")

# The six sections the dashboard fetches; all six failing means storage is unavailable.
_SECTION_COUNT = 6


class StorageUnavailableException(WaveException):
    """Every dashboard section failed to read storage."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    error_code = "SERVICE_UNAVAILABLE"
    message = "Storage unavailable"


# Cache configuration
CACHE_TTL_SECONDS = 5

# Cache storage
_cache: dict[str, Any] = {}
_cache_timestamp: float | None = None

# Create router for dashboard endpoint
router = APIRouter(tags=["Dashboard"])


def invalidate_dashboard_cache() -> None:
    """Invalidate the dashboard cache.

    Called when entities or executions are modified to ensure fresh data.
    """
    global _cache, _cache_timestamp
    _cache = {}
    _cache_timestamp = None


def _is_cache_valid() -> bool:
    """Check if cache is still valid.

    Returns:
        True if cache is valid and not expired.
    """
    global _cache_timestamp
    if _cache_timestamp is None:
        return False
    elapsed = time.monotonic() - _cache_timestamp
    return elapsed < CACHE_TTL_SECONDS


def _get_cached_data() -> dict[str, Any] | None:
    """Get cached dashboard data if valid.

    Returns:
        Cached data or None if cache is invalid.
    """
    if _is_cache_valid():
        return _cache.copy()
    return None


def _set_cache(data: dict[str, Any]) -> None:
    """Set cache with current data.

    Args:
        data: Dashboard data to cache.
    """
    global _cache, _cache_timestamp
    _cache = data.copy()
    _cache_timestamp = time.monotonic()


@router.get("/dashboard")
async def get_dashboard() -> dict[str, Any]:
    """Get status dashboard data (REQ-5.2.1.43).

    Returns aggregated system state including:
    - metrics: Entity counts and execution statistics
    - recentActivity: Recently modified entities
    - runningExecutions: Active executions with progress

    Error Handling:
    - HTTP 503: Complete storage unavailability
    - HTTP 200 with null sections: Partial failures

    Returns:
        Dashboard data with metrics, recentActivity, runningExecutions, and meta.
    """
    # Check cache first
    cached = _get_cached_data()
    if cached:
        return cached

    with reconcile_once():
        return _build_dashboard()


def _section(label: str, fetch: Callable[[], _T], errors: list[str]) -> _T | None:
    """One section's data, or None with its failure named in errors and its cause in the log."""
    try:
        return fetch()
    except OSError:
        logger.warning("Dashboard could not fetch %s", label, exc_info=True)
        errors.append(f"Failed to fetch {label}")
        return None


def _build_dashboard() -> dict[str, Any]:
    """Assemble one dashboard response from the entity and execution services."""
    errors: list[str] = []

    tests_count = _section("tests count", get_test_count, errors)
    suites_count = _section("suites count", get_suite_count, errors)
    regressions_count = _section("regressions count", get_regression_count, errors)
    execution_stats = _section(
        "execution statistics", lambda: get_execution_statistics(time_window_hours=24), errors
    )
    recent_activity = _section("recentActivity", get_recent_activity, errors)
    # All executions within the time window, not just running ones.
    recent_executions = _section(
        "recentExecutions", lambda: get_recent_executions(time_window_hours=24), errors
    )

    if len(errors) == _SECTION_COUNT:
        raise StorageUnavailableException()

    # Build metrics object - entity counts as objects with count property
    metrics: dict[str, Any] = {
        "tests": {"count": tests_count if tests_count is not None else 0},
        "suites": {"count": suites_count if suites_count is not None else 0},
        "regressions": {"count": regressions_count if regressions_count is not None else 0},
        "executions": (
            execution_stats
            if execution_stats is not None
            else {
                "sinceDays": 1,
                "count": 0,
                "running": 0,
                "passed": 0,
                "failed": 0,
            }
        ),
    }

    # Handle null for failed sections (regressions count as partial)
    if regressions_count is None:
        metrics["regressions"] = None

    # Build response
    response: dict[str, Any] = {
        "metrics": metrics,
        "recentActivity": recent_activity,
        "recentExecutions": recent_executions,
        "meta": {
            "timestamp": datetime.now(UTC).isoformat(),
            "errors": errors if errors else [],
        },
    }

    # Cache successful response (only if no errors)
    if not errors:
        _set_cache(response)

    return response
