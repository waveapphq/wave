"""GET/PATCH /network/ssh-hosts, GET /policy, POST /parse and /detect (REQ-4.5.14)."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from wavecore.api.services.network import ssh_hosts

router = APIRouter(prefix="/network/ssh-hosts", tags=["Network"])


class HostKeyPolicy(BaseModel):
    lock_trusted_hosts: bool
    default_block_action: str


class TrustedHost(BaseModel):
    id: str
    host: str
    port: int
    key_type: str
    fingerprint: str
    added: str


class SshHostsView(BaseModel):
    policy: HostKeyPolicy
    hosts: list[TrustedHost]


class PolicyChange(BaseModel):
    """Omitted fields stay unchanged; values are checked by the service, never coerced here."""

    model_config = ConfigDict(extra="ignore")

    lock_trusted_hosts: Any = None
    default_block_action: Any = None


class NewTrustedHost(BaseModel):
    """The port is checked by the service, never coerced here."""

    host: str
    port: Any
    key_type: str
    key: str


class SshHostsChange(BaseModel):
    policy: PolicyChange | None = None
    add: list[NewTrustedHost] = Field(default_factory=list)
    remove: list[str] = Field(default_factory=list)


class ParseRequest(BaseModel):
    text: str


class ParsedHost(BaseModel):
    host_names: list[str]
    port: int
    key_type: str
    key: str
    fingerprint: str


class LineError(BaseModel):
    line: int
    message: str


class ParseResponse(BaseModel):
    entries: list[ParsedHost]
    errors: list[LineError]


class DetectRequest(BaseModel):
    """The port is checked by the service, never coerced here."""

    host: str
    port: Any


class DetectedKey(BaseModel):
    host: str
    port: int
    key_type: str
    key: str
    fingerprint: str


class DetectResponse(BaseModel):
    entries: list[DetectedKey]


@router.get("")
async def get_ssh_hosts() -> SshHostsView:
    """The host key policy and every trusted host."""
    return SshHostsView(**ssh_hosts.get_view())


@router.get("/policy")
async def get_ssh_host_policy() -> HostKeyPolicy:
    """The host key policy alone, read when the app starts."""
    return HostKeyPolicy(**ssh_hosts.get_policy())


@router.patch("")
async def change_ssh_hosts(body: SshHostsChange) -> SshHostsView:
    """Apply the page's whole change set in one write, or nothing."""
    policy = body.policy.model_dump(exclude_unset=True) if body.policy is not None else None
    add = [entry.model_dump() for entry in body.add]
    return SshHostsView(**ssh_hosts.apply_changes(policy, add, body.remove))


@router.post("/parse")
async def parse_ssh_host_lines(body: ParseRequest) -> ParseResponse:
    """Read pasted known_hosts or ssh-keyscan lines; writes nothing."""
    return ParseResponse(**ssh_hosts.parse(body.text))


@router.post("/detect")
async def detect_ssh_host_keys(body: DetectRequest) -> DetectResponse:
    """Read a host's keys directly from the WAVE host, without logging in; writes nothing."""
    return DetectResponse(**await ssh_hosts.detect_host_keys(body.host, body.port))
