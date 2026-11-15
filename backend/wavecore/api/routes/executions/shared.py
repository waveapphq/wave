"""Shared utilities for execution endpoints.

Provides the response builder and the date filter reader used across execution route modules.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi.responses import JSONResponse

from wavecore.api.exceptions import ValidationException


def _create_success_response(
    data: Any,
    status_code: int = 200,
    pagination: dict[str, Any] | None = None,
) -> JSONResponse:
    """Create standardized success response."""
    content: dict[str, Any] = {
        "success": True,
        "data": data,
        "meta": {
            "request_id": str(uuid.uuid4()),
            "timestamp": datetime.now(UTC).isoformat(),
        },
    }

    if pagination:
        content["pagination"] = pagination

    return JSONResponse(status_code=status_code, content=content)


def parse_filter_date(value: str | None, param: str) -> datetime | None:
    """An ISO 8601 date filter from the query, or None when absent; any other text is refused."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValidationException(
            f"Invalid {param} '{value}': expected an ISO 8601 datetime"
        ) from None
