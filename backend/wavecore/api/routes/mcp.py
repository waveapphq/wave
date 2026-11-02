"""GET/PUT /mcp/settings, GET /mcp/status, DELETE /mcp/sessions/{id}."""

from typing import Any

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, ConfigDict

from wavecore.api.config.instance_settings import SECTION_DEFAULTS
from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.mcp import server as mcp_server
from wavecore.mcp import settings as mcp_settings
from wavecore.mcp import state as mcp_state

router = APIRouter(prefix="/mcp", tags=["MCP"])

_PERSISTED_KEYS = tuple(SECTION_DEFAULTS["mcp"])


class McpSettingsUpdateRequest(BaseModel):
    """Partial update; omitted fields stay unchanged. Values validated by the service."""

    model_config = ConfigDict(extra="ignore")

    enabled: Any = None
    until_restart: Any = None
    port: Any = None
    bind: Any = None
    auth_enabled: Any = None
    auth_username: Any = None
    auth_password: Any = None


class McpSettingsResponse(BaseModel):
    """Settings view; the auth password is write-only and never returned."""

    enabled: bool
    until_restart_active: bool
    port: int
    bind: str
    auth_enabled: bool
    auth_username: str
    auth_password_set: bool
    running: bool
    server_port: int


class McpSessionRow(BaseModel):
    session_id: str
    client: str
    client_version: str
    ip: str
    connected_at: str
    last_activity: str


class McpActivityRow(BaseModel):
    timestamp: str
    client: str
    tool: str


class McpStatusResponse(BaseModel):
    running: bool
    enabled: bool
    until_restart_active: bool
    port: int
    bind: str
    urls: list[str]
    connected_clients: int
    sessions: list[McpSessionRow]
    recent_activity: list[McpActivityRow]
    last_error: str | None = None


def _settings_response(request: Request) -> McpSettingsResponse:
    settings = mcp_settings.get_settings()
    return McpSettingsResponse(
        enabled=bool(settings["enabled"]),
        until_restart_active=mcp_state.is_until_restart(),
        port=int(settings["port"]),
        bind=str(settings["bind"]),
        auth_enabled=bool(settings["auth_enabled"]),
        auth_username=str(settings["auth_username"] or ""),
        auth_password_set=settings["auth_password"] is not None,
        running=mcp_server.is_running(),
        server_port=int(request.scope["server"][1]),
    )


@router.get("/settings")
async def get_mcp_settings(request: Request) -> McpSettingsResponse:
    """Current MCP endpoint settings (password never included)."""
    return _settings_response(request)


@router.put("/settings")
async def update_mcp_settings(
    request: Request, body: McpSettingsUpdateRequest
) -> McpSettingsResponse:
    """Validate, probe port availability, persist, then reconcile the listener."""
    provided = body.model_dump(exclude_unset=True)
    enable_persistent = provided.get("enabled") is True
    enable_until_restart = provided.get("until_restart") is True
    if enable_persistent and enable_until_restart:
        raise ValidationException("Only one enablement mode can be turned on at a time")
    persisted_subset = {key: provided[key] for key in _PERSISTED_KEYS if key in provided}
    # The enablement modes are mutually exclusive: turning one on turns the other off.
    if enable_until_restart:
        persisted_subset["enabled"] = False
    if enable_persistent:
        until_restart = False
    elif "until_restart" in provided:
        until_restart = bool(provided["until_restart"])
    else:
        until_restart = mcp_state.is_until_restart()
    prospective = mcp_settings.preview_settings(**persisted_subset)
    mcp_server.ensure_port_available(prospective, until_restart=until_restart)
    if persisted_subset:
        mcp_settings.update_settings(**persisted_subset)
    mcp_state.set_until_restart(until_restart)
    await mcp_server.reconcile()
    return _settings_response(request)


@router.get("/status")
async def get_mcp_status() -> McpStatusResponse:
    """Live endpoint status: listener state, URL, sessions, recent activity."""
    return McpStatusResponse(**mcp_server.get_status())


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_mcp_session(session_id: str) -> Response:
    """Administratively disconnect an MCP session."""
    if not mcp_state.close_session(session_id):
        raise NotFoundException(f"MCP session with ID '{session_id}' not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
