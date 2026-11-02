"""Configuration management API endpoints (REQ-5.2.4.12).

This module provides REST API endpoints for configuration management including:
- Full configuration retrieval with sensitive value masking
- Individual key retrieval with dot-notation path parsing
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from wavecore.api.exceptions import (
    InternalServerException,
    NotFoundException,
    ValidationException,
)
from wavecore.api.services import config_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config", tags=["Configuration"])


# Response models
class ResponseMeta(BaseModel):
    """Standard response metadata."""

    request_id: str
    timestamp: str


class ConfigValueData(BaseModel):
    """Configuration value data model."""

    key: str
    value: Any
    type: str
    mutable: bool | None = None
    sensitive: bool | None = None


class ConfigResponse(BaseModel):
    """Response model for full configuration."""

    success: bool
    data: dict[str, Any]
    meta: ResponseMeta


class ConfigValueResponse(BaseModel):
    """Response model for single configuration value."""

    success: bool
    data: ConfigValueData
    meta: ResponseMeta


def _generate_request_id() -> str:
    """Generate unique request ID."""
    return str(uuid.uuid4())


def _get_timestamp() -> str:
    """Get current timestamp in ISO format."""
    return datetime.now(UTC).isoformat()


@router.get("", response_model=ConfigResponse)
async def get_config() -> JSONResponse:
    """Get all configuration values.

    Returns full configuration tree with sensitive values masked.
    Settings are organized by category.

    Returns:
        Full configuration dictionary with metadata.

    Raises:
        InternalServerException: 500 on internal error.
    """
    try:
        config_data = config_service.get_full_config()

        return JSONResponse(
            content={
                "success": True,
                "data": config_data,
                "meta": {
                    "request_id": _generate_request_id(),
                    "timestamp": _get_timestamp(),
                },
            },
            headers={
                "Cache-Control": "max-age=300",  # Cache for 5 minutes
            },
        )

    except RuntimeError as e:
        logger.error(f"Internal error retrieving config: {e}")
        raise InternalServerException() from e


@router.get("/{key:path}", response_model=ConfigValueResponse)
async def get_config_value(key: str) -> JSONResponse:
    """Get specific configuration value.

    Args:
        key: Configuration key in dot notation (e.g., "server.port").

    Returns:
        Configuration value with type and mutability information.

    Raises:
        ValidationException: 400 if invalid key path.
        NotFoundException: 404 if key not found.
        InternalServerException: 500 on internal error.
    """
    try:
        result = config_service.get_config_value(key)

        if result is None:
            # Try to find similar keys for suggestions
            suggestions = config_service.find_similar_keys(key)
            details = {"suggestions": suggestions} if suggestions else None
            raise NotFoundException(
                f"Configuration key '{key}' not found",
                details=details,
            )

        return JSONResponse(
            content={
                "success": True,
                "data": result,
                "meta": {
                    "request_id": _generate_request_id(),
                    "timestamp": _get_timestamp(),
                },
            },
            headers={
                "Cache-Control": "max-age=60",  # Short TTL for individual values
            },
        )

    except (ValidationException, NotFoundException):
        raise
    except RuntimeError as e:
        logger.error(f"Internal error retrieving config value {key}: {e}")
        raise InternalServerException() from e
