"""Shared utilities for execution endpoints.

Provides Pydantic models and response builders used across execution route modules.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi.responses import JSONResponse
from pydantic import BaseModel


# Pydantic models for request/response
class ResponseMeta(BaseModel):
    """Standard response metadata."""

    request_id: str
    timestamp: str


class ErrorDetail(BaseModel):
    """Error detail model."""

    code: str
    message: str
    correlation_id: str | None = None


class ErrorResponse(BaseModel):
    """Error response model."""

    success: bool = False
    error: ErrorDetail


class PaginationInfo(BaseModel):
    """Pagination information."""

    total: int
    page: int
    per_page: int


def _create_error_response(
    status_code: int,
    code: str,
    message: str,
    correlation_id: str | None = None,
) -> JSONResponse:
    """Create standardized error response."""
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "error": {
                "code": code,
                "message": message,
                "correlation_id": correlation_id or str(uuid.uuid4()),
            },
        },
    )


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


def _parse_datetime(date_str: str) -> datetime:
    """Parse ISO datetime string."""
    return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
