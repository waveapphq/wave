"""Dashboard routes package.

Re-exports helpers, routes, and service references for the dashboard namespace.
"""

from wavecore.api.routes.dashboard.helpers import (  # noqa: F401
    _add_type_specific_fields,
    _compute_regression_test_counts,
    _compute_suite_test_counts,
    _extract_entity_timestamp,
    _get_entity_lister,
    _list_all_regressions,
    _list_all_suites,
    _list_all_tests,
    _name_indexes,
    _resolve_entity_name,
    get_execution_progress,
    get_execution_statistics,
    get_recent_activity,
    get_recent_entities,
    get_recent_executions,
    get_regression_count,
    get_suite_count,
    get_test_count,
    list_executions,
)
from wavecore.api.routes.dashboard.routes import (  # noqa: F401
    CACHE_TTL_SECONDS,
    _get_cached_data,
    _is_cache_valid,
    _set_cache,
    get_dashboard,
    invalidate_dashboard_cache,
    router,
)
from wavecore.api.services.executions import service as execution_service  # noqa: F401
from wavecore.api.services.regressions import service as regression_service  # noqa: F401
from wavecore.api.services.suites import service as suite_service  # noqa: F401
from wavecore.api.services.tests import service as test_service  # noqa: F401
