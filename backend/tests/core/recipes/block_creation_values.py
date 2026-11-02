"""The values a new Block holds for every choice-list and true / false field (FIELD-8)."""

from __future__ import annotations

from typing import Any

HTTP_CREATION_VALUES: dict[str, Any] = {
    "method": "GET",
    "auth_enabled": False,
    "auth_mode": "basic",
    "body_mode": "text",
    "file_content_type": "auto",
    "body_auto_headers": True,
    "response_mode": "body",
    "verify_ssl": True,
    "tls_min_version": "1.2",
    "tls_max_version": "1.3",
    "allow_redirects": True,
    "proxy_mode": "wave-setting",
}
SSH_OPEN_CREATION_VALUES: dict[str, Any] = {
    "use_parent": False,
    "host_key_verification": "disabled",
    "compression": False,
}
OPENSEARCH_CREATION_VALUES: dict[str, Any] = {
    "query_language": "dql",
    "mode": "search",
    "group_by_time": "1m",
    "order": "desc",
    "verify_ssl": True,
    "on_error": "fail",
}
# A PostgreSQL Block: `tls` holds that database type's own default.
SQL_CREATION_VALUES: dict[str, Any] = {
    "operation": "run_sql",
    "database_type": "postgresql",
    "script_type": "source",
    "stop_on_error": True,
    "mode": "add",
    "commit_each_batch": False,
    "tls": False,
    "verify_ssl": True,
    "on_error": "fail",
}
