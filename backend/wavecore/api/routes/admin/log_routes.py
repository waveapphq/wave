"""Admin log level management endpoints (REQ-3.7.2.6, REQ-4.7.18).

This module implements the backend log level endpoints.
These endpoints do NOT require admin mode.

Endpoints:
- GET /admin/log-level: Get current backend log level
- PUT /admin/log-level: Save the backend log level and apply it
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from wavecore.api.services import log_level

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])

_TZ_UTC_SUFFIX = "+00:00"


class LogLevelRequest(BaseModel):
    """Request body for setting log level."""

    level: str
    """Log level: DEBUG, INFO, WARN, ERROR, or FATAL."""


class LogLevelResponse(BaseModel):
    """Response body for log level operations."""

    level: str
    """Current log level."""
    timestamp: str
    """ISO 8601 timestamp of the response."""


@router.get("/log-level")
async def get_log_level(request: Request) -> LogLevelResponse:
    """Get current backend log level.

    Returns the current log level for the backend server.
    This endpoint does NOT require admin mode.

    Returns:
        LogLevelResponse with current level.
    """
    from wavecore.core.logging.formatter import get_log_level as get_level

    current_level = get_level()
    timestamp = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")

    return LogLevelResponse(level=current_level, timestamp=timestamp)


@router.put("/log-level")
async def set_log_level_endpoint(request: Request, body: LogLevelRequest) -> LogLevelResponse:
    """Save the backend log level to the config file, then apply it.

    Changes the log level for the backend server. This affects all log output
    to the backend terminal. Does NOT affect console panel filtering.

    This endpoint does NOT require admin mode.

    Args:
        body: LogLevelRequest with desired level.

    Returns:
        LogLevelResponse with the new level.

    Raises:
        HTTPException 400: If level is invalid.
    """
    try:
        new_level = log_level.save(body.level)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    timestamp = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")

    logger.info("Log level changed to %s", new_level)

    return LogLevelResponse(level=new_level, timestamp=timestamp)
