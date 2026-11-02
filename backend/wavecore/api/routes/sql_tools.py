"""SQL editor endpoints: the syntax check and Get Tables (REQ-3.4.1.6, SQL-10, SQL-12)."""

from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel

from wavecore.api.routes.shared import envelope
from wavecore.api.services import catalog_jobs
from wavecore.api.services.catalog_jobs import CatalogRequestBody
from wavecore.api.services.sql_tools import catalog
from wavecore.api.services.sql_tools import check as check_service

router = APIRouter(prefix="/sql-tools", tags=["SQL Tools"])


class CheckBody(BaseModel):
    """A script to parse in the block's database type."""

    database_type: str
    script: str


class CatalogConnection(BaseModel):
    """The connection rows the block holds, as they sit: literals, sealed values or expression
    text; a row it does not hold takes the Block's default in the pull."""

    database_type: Any = None
    host: Any = None
    port: Any = None
    database: Any = None
    username: Any = None
    password: Any = None
    file: Any = None
    tls: Any = None
    verify_ssl: Any = None
    ca_cert: Any = None
    client_cert: Any = None
    client_key: Any = None
    driver_options: Any = None


class CatalogBody(CatalogRequestBody):
    """A Get Tables request: the rows, how each is written, and where they resolve."""

    connection: CatalogConnection


# Sync handlers: parsing and variable resolution block, so they run in the threadpool.
@router.post("/check")
def check(body: CheckBody) -> dict[str, Any]:
    """The script's syntax findings; the script is parsed, never run."""
    return envelope({"issues": check_service.check_syntax(body.database_type, body.script)})


@router.post("/catalog")
def start_catalog(body: CatalogBody, response: Response) -> dict[str, Any]:
    """Answer the cached tables (200), or join or start a pull (202)."""
    result = catalog.start(
        body.connection.model_dump(exclude_unset=True),
        body.refresh,
        body.test_id,
        expression_fields=body.expression_fields,
        template_fields=body.template_fields,
        profile_bindings=body.profile_bindings,
        environment_id=body.environment_id,
        element_types=body.element_types,
    )
    response.status_code = 200 if result["cached"] else 202
    return envelope(result)


@router.get("/catalog/{job_id}")
def catalog_status(job_id: str) -> dict[str, Any]:
    """Where a pull stands."""
    return envelope(catalog_jobs.status(job_id))


@router.delete("/catalog/{job_id}")
def cancel_catalog(job_id: str) -> dict[str, Any]:
    """Cancel a running pull; a finished one answers its own state."""
    return envelope(catalog_jobs.cancel(job_id))
