"""System information endpoints (REQ-5.2.1.42).

This module implements the system-level endpoints providing application
version, build information, support links, the fixed TLS cipher-suite
catalog, and the password strength score (REQ-5.2.7.1).

Endpoints:
- GET /system/info: Get system information
- GET /system/tls-capabilities: Get the fixed TLS cipher-suite catalog
- POST /system/password-strength: Score a password
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from wavecore import __version__
from wavecore.api.services import password_strength, system_service
from wavecore.connectivity import tls_capabilities

# Create router for system endpoints
router = APIRouter(prefix="/api/v1", tags=["System"])


class PasswordStrengthRequest(BaseModel):
    """A password to score and the texts that count against it."""

    password: str
    user_inputs: list[str] = []


def _build_meta(request: Request) -> dict[str, Any]:
    """Build response metadata.

    Args:
        request: HTTP request

    Returns:
        Metadata dictionary
    """
    return {
        "request_id": str(uuid.uuid4()),
        "path": str(request.url.path),
        "timestamp": datetime.now(UTC).isoformat(),
        "version": __version__,
    }


def _success_response(
    request: Request,
    response: Response,
    data: dict[str, Any],
    cache_control: str = "max-age=3600",
) -> dict[str, Any]:
    """Standard success envelope; static data keeps the long-cache default."""
    response.headers["Cache-Control"] = cache_control
    return {
        "success": True,
        "data": data,
        "meta": _build_meta(request),
    }


def _internal_error_response() -> JSONResponse:
    """Standard 500 envelope with a fresh correlation id."""
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": {
                "message": "Internal server error",
                "code": "INTERNAL_ERROR",
                "correlation_id": str(uuid.uuid4()),
            },
        },
    )


@router.get("/system/info", response_model=None)
async def get_system_info(
    request: Request,
    response: Response,
) -> dict[str, Any] | JSONResponse:
    """Get system information.

    Returns version, build, runtime, and support info
    for the Settings About tab.

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        System information
    """
    try:
        return _success_response(request, response, system_service.get_system_info())
    except RuntimeError:
        return _internal_error_response()


@router.get("/system/tls-capabilities", response_model=None)
async def get_tls_capabilities(
    request: Request,
    response: Response,
) -> dict[str, Any] | JSONResponse:
    """Get the fixed TLS cipher-suite catalog and the Cipher Suites defaults.

    Returns the static, host-independent cipher rows (OpenSSL and IANA
    names, per-suite version span) for the cipher picker, and per Block and
    TLS version range the list an unset Cipher Suites sends.

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        TLS cipher-suite catalog
    """
    try:
        return _success_response(request, response, tls_capabilities.capabilities())
    except RuntimeError:
        return _internal_error_response()


@router.post("/system/password-strength")
async def score_password(
    request: Request, response: Response, body: PasswordStrengthRequest
) -> dict[str, Any]:
    """Score a password; the answer holds the score and its label and is never cached."""
    data = password_strength.score(body.password, body.user_inputs)
    return _success_response(request, response, data, cache_control="no-store")
