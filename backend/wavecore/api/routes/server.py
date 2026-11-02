"""GET /server/status + /server/sessions/* browser-session roster and disconnect.

Server facts (frontend + backend) are read-only: they are fixed at launch and the
server cannot reconfigure the socket it serves the operator through. The live part
is the browser-session roster, which admins can terminate individually or in bulk.
"""

from urllib.parse import urlparse

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, ConfigDict

from wavecore.api.config import get_config
from wavecore.api.exceptions import NotFoundException, UnprocessableEntityException
from wavecore.api.services import storage_paths
from wavecore.api.websocket import session_registry

router = APIRouter(prefix="/server", tags=["Server"])

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


class ServerFacts(BaseModel):
    running: bool
    urls: list[str]
    port: int
    bind: str


class BrowserSessionRow(BaseModel):
    session_id: str
    client: str
    ip: str
    connected_at: str
    last_activity: str


class ServerStatusResponse(BaseModel):
    frontend: ServerFacts
    backend: ServerFacts
    session_count: int
    sessions: list[BrowserSessionRow]
    active_session_id: str | None = None
    watching_session_ids: list[str]
    data_folder: str
    config_file: str


class DisconnectOthersRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    requester_session_id: str | None = None


class DisconnectAllRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    requester_session_id: str | None = None


class DisconnectResult(BaseModel):
    disconnected: int


def _bind_of(host: str) -> str:
    return "local" if host in _LOOPBACK_HOSTS else "network"


def _backend_facts(request: Request) -> ServerFacts:
    from wavecore.mcp.server import _machine_hosts

    # Bind scope comes from the socket that actually served this request, not
    # config: a loopback-bound dev server must not advertise a LAN address it
    # never listens on (uvicorn defaults to 127.0.0.1 unless --host is given).
    server = request.scope.get("server") or ("127.0.0.1", 0)
    host = str(server[0] or "127.0.0.1")
    port = int(server[1] or 0)
    bind = _bind_of(host)
    scheme = request.url.scheme
    urls = [f"{scheme}://{machine_host}:{port}" for machine_host in _machine_hosts(bind)]
    return ServerFacts(running=True, urls=urls, port=port, bind=bind)


def _frontend_origin(request: Request) -> str | None:
    """This browser's frontend origin: Origin, else Referer, else the first CORS origin."""
    origin = request.headers.get("origin")
    if origin:
        return origin
    referer = request.headers.get("referer")
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.hostname:
            host = parsed.hostname if parsed.port is None else f"{parsed.hostname}:{parsed.port}"
            return f"{parsed.scheme}://{host}"
    cors = [o for o in get_config().security.cors_origins if isinstance(o, str)]
    return cors[0] if cors else None


def _frontend_facts(request: Request) -> ServerFacts:
    origin = _frontend_origin(request)
    if origin is None:
        return ServerFacts(running=False, urls=[], port=0, bind="unknown")
    parsed = urlparse(origin)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return ServerFacts(running=True, urls=[origin], port=port, bind=_bind_of(parsed.hostname or ""))


def _session_roles() -> tuple[str | None, list[str]]:
    """(active session id, watching session ids) from live ownership + draft subs.

    Active is the person holder editing the shared workbench; watchers are the
    other draft-topic subscribers. Active is None when no one holds or an MCP does.
    """
    from wavecore.api.app import app
    from wavecore.api.services.workbench import ownership

    holder = ownership.get_holder()
    active = holder["id"] if holder is not None and holder.get("kind") == "person" else None
    manager = getattr(app.state, "ws_manager", None)
    watchers = manager.draft_watcher_ids() if manager is not None else set()
    watchers.discard(active)
    return active, sorted(watchers)


@router.get("/status")
async def get_server_status(request: Request) -> ServerStatusResponse:
    """Frontend/backend server facts and the live browser-session roster."""
    sessions = session_registry.list_sessions()
    active, watching = _session_roles()
    return ServerStatusResponse(
        frontend=_frontend_facts(request),
        backend=_backend_facts(request),
        session_count=len(sessions),
        sessions=[BrowserSessionRow(**row) for row in sessions],
        active_session_id=active,
        watching_session_ids=watching,
        data_folder=str(storage_paths.get_base_path()),
        config_file=str(get_config().config_file),
    )


async def _terminate_live(session_id: str) -> None:
    """Release anything the terminated id held, then boot its live socket."""
    from wavecore.api.app import app
    from wavecore.api.services.workbench import ownership

    ownership.release_for_session(session_id)
    manager = getattr(app.state, "ws_manager", None)
    if manager is not None:
        await manager.terminate_session(session_id)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_session(session_id: str) -> Response:
    """Administratively end a browser session (tombstone + boot the live socket)."""
    if not session_registry.close_session(session_id):
        raise NotFoundException(f"Browser session with ID '{session_id}' not found")
    await _terminate_live(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/disconnect-others")
async def disconnect_others_route(body: DisconnectOthersRequest) -> DisconnectResult:
    """End every session except the caller's own."""
    requester = body.requester_session_id
    if requester is None or not requester.strip():
        raise UnprocessableEntityException("requester_session_id is required")
    targets = [
        row["session_id"]
        for row in session_registry.list_sessions()
        if row["session_id"] != requester
    ]
    count = session_registry.disconnect_others(exclude=requester)
    for session_id in targets:
        await _terminate_live(session_id)
    return DisconnectResult(disconnected=count)


@router.post("/sessions/disconnect-all")
async def disconnect_all_route(body: DisconnectAllRequest) -> DisconnectResult:
    """End every session, including the caller's own."""
    targets = [row["session_id"] for row in session_registry.list_sessions()]
    count = session_registry.disconnect_all()
    for session_id in targets:
        await _terminate_live(session_id)
    return DisconnectResult(disconnected=count)
