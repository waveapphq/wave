"""GET/PATCH /network/proxy, POST /validate and GET /blocks (REQ-4.7.14, REQ-3.4.2.10)."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from wavecore.api.services.network import proxy

router = APIRouter(prefix="/network/proxy", tags=["Network"])


class ProxyEntry(BaseModel):
    kind: str
    address: str


class HostValues(BaseModel):
    https_proxy: str | None = None
    http_proxy: str | None = None
    no_proxy: str | None = None


class ProxySettings(BaseModel):
    """Settings view; the password is write-only and never returned."""

    enabled: bool
    source: str
    host: str
    port: int | None = None
    username: str
    password_set: bool
    list_mode: str
    entries: list[ProxyEntry]
    proxy_local_addresses: bool
    host_values: HostValues


class ProxyChange(BaseModel):
    """Omitted fields stay unchanged; values are checked by the service, never coerced here."""

    model_config = ConfigDict(extra="ignore")

    enabled: Any = None
    source: Any = None
    host: Any = None
    port: Any = None
    username: str | None = None
    password: str | None = None
    list_mode: Any = None
    entries: Any = None
    proxy_local_addresses: Any = None


class ProxyProblem(BaseModel):
    field: str
    row: int | None = None
    message: str


class ProxyProblems(BaseModel):
    problems: list[ProxyProblem]


class BlockRef(BaseModel):
    id: str
    name: str
    category: str


class ProxyBlocks(BaseModel):
    supported: list[BlockRef]
    unsupported: list[BlockRef]
    not_applicable: list[BlockRef]


@router.get("")
async def get_proxy() -> ProxySettings:
    """The Proxy settings, with the WAVE host's proxy variables as they are now."""
    return ProxySettings(**proxy.get_settings())


@router.patch("")
async def change_proxy(body: ProxyChange) -> ProxySettings:
    """Save the sent fields, or nothing when a rule refuses one of them."""
    return ProxySettings(**proxy.update_settings(**body.model_dump(exclude_unset=True)))


@router.post("/validate")
async def validate_proxy(body: ProxyChange) -> ProxyProblems:
    """Every problem of the staged fields over the saved settings; writes nothing."""
    problems = proxy.validate_settings(**body.model_dump(exclude_unset=True))
    return ProxyProblems.model_validate({"problems": problems})


@router.get("/blocks")
async def get_proxy_blocks() -> ProxyBlocks:
    """Every block once, under what it declares about the Proxy setting."""
    return ProxyBlocks.model_validate(proxy.block_lists())
