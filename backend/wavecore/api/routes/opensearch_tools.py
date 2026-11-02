"""OpenSearch editor endpoints: the check, suggestions and Get fields (REQ-3.3.2.5, OS-13)."""

from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel

from wavecore.api.routes.shared import envelope
from wavecore.api.services.catalog_jobs import CatalogRequestBody
from wavecore.api.services.opensearch_tools import check as check_service
from wavecore.api.services.opensearch_tools import fields
from wavecore.api.services.opensearch_tools import suggest as suggest_service

router = APIRouter(prefix="/opensearch-tools", tags=["OpenSearch Tools"])


class CheckBody(BaseModel):
    """A query to check as the editor holds it; the Index pattern names unknown fields."""

    language: str
    text: str
    template: bool = False
    fields_job_id: str | None = None
    index: str = ""


class SuggestBody(BaseModel):
    """A query and the cursor as a 0-based character offset."""

    language: str
    text: str
    cursor: int
    template: bool = False
    fields_job_id: str | None = None


class FieldsConnection(BaseModel):
    """The connection rows the block holds, as they sit: literals, sealed values or expression
    text; a row it does not hold takes the Block's default in the pull."""

    url: Any = None
    username: Any = None
    password: Any = None
    api_key: Any = None
    bearer_token: Any = None
    verify_ssl: Any = None
    ca_cert: Any = None
    client_cert: Any = None
    client_key: Any = None
    index: Any = None
    connect_timeout: Any = None


class FieldsBody(CatalogRequestBody):
    """A Get fields request: the rows, how each is written, and where they resolve."""

    connection: FieldsConnection


# Sync handlers: parsing and variable resolution block, so they run in the threadpool.
@router.post("/check")
def check(body: CheckBody) -> dict[str, Any]:
    """The query's advisory findings; the query is read, never run."""
    issues = check_service.check(
        body.language, body.text, body.template, body.fields_job_id, body.index
    )
    return envelope({"issues": issues})


@router.post("/suggest")
def suggest(body: SuggestBody) -> dict[str, Any]:
    """The range a choice replaces and the choices at the cursor."""
    return envelope(
        suggest_service.suggest(
            body.language, body.text, body.cursor, body.template, body.fields_job_id
        )
    )


@router.post("/fields")
def start_fields(body: FieldsBody, response: Response) -> dict[str, Any]:
    """Answer the cached lists (200), or join or start a pull (202)."""
    result = fields.start(
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


@router.get("/fields/{job_id}")
def fields_status(job_id: str) -> dict[str, Any]:
    """Where a pull stands."""
    return envelope(fields.status(job_id))


@router.delete("/fields/{job_id}")
def cancel_fields(job_id: str) -> dict[str, Any]:
    """Cancel a running pull; a finished one answers its own state."""
    return envelope(fields.cancel(job_id))
