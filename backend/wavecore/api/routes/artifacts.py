"""Artifact API over the per-execution artifact layout (REQ-3.7.1.x).

Artifact identity is path-shaped: ``{artifact_dir_name}/{relative_path}``.
Metadata and content endpoints are prefixed (``/artifacts/meta/...``,
``/artifacts/content/...``) to avoid greedy path-parameter ambiguity. The
``/artifacts/executions`` and ``/artifacts/zip`` routes are declared before the
catch-all ``DELETE /artifacts/{artifact_id:path}`` so they resolve correctly.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Response, status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.executions.shared import _create_success_response
from wavecore.api.services import artifact_service
from wavecore.api.services.file_tree import content_disposition

_VALID_DISPOSITIONS = ("attachment", "inline")

router = APIRouter(prefix="/artifacts", tags=["Artifacts"])


@router.get("")
async def list_artifacts(
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 50,
    execution_id: Annotated[str | None, Query()] = None,
    include_removed: Annotated[bool, Query()] = False,
) -> JSONResponse:
    """List artifacts across execution dirs, newest first."""
    result = artifact_service.list_artifacts(
        execution_id=execution_id,
        page=page,
        per_page=per_page,
        include_removed=include_removed,
    )
    return _create_success_response(result["items"], pagination=result["pagination"])


@router.get("/executions")
async def list_execution_artifact_summaries(
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 50,
    search: Annotated[str | None, Query()] = None,
    entity_type: Annotated[str | None, Query(alias="type")] = None,
    status: Annotated[str | None, Query()] = None,
) -> JSONResponse:
    """Execution-first landing list: one row per execution with live artifacts."""
    result = artifact_service.list_execution_artifact_summaries(
        page=page,
        per_page=per_page,
        search=search,
        entity_type=entity_type,
        status=status,
    )
    return _create_success_response(result["items"], pagination=result["pagination"])


@router.get("/zip")
async def download_execution_zip(
    execution_id: Annotated[str, Query()],
    path: Annotated[str | None, Query()] = None,
) -> Response:
    """Stream a zip of an execution's live artifacts, or of a subtree."""
    content = artifact_service.zip_execution_artifacts(execution_id, subtree=path)
    filename = artifact_service.zip_download_name(execution_id, subtree=path)
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )


@router.get("/meta/{artifact_id:path}")
async def get_artifact_meta(artifact_id: str) -> dict[str, Any]:
    """Artifact metadata plus an on-demand sha256 checksum."""
    return artifact_service.get_artifact_meta(artifact_id)


@router.get("/content/{artifact_id:path}")
async def download_artifact_content(
    artifact_id: str,
    range: Annotated[str | None, Header(alias="Range")] = None,
    disposition: Annotated[str, Query()] = "attachment",
) -> Response:
    """Stream artifact bytes; supports HTTP Range requests (206)."""
    if disposition not in _VALID_DISPOSITIONS:
        raise ValidationException(
            f"Invalid disposition '{disposition}': "
            f"valid values are {', '.join(_VALID_DISPOSITIONS)}"
        )
    result = artifact_service.read_artifact_content(artifact_id, range_header=range)
    headers = {
        "Content-Disposition": content_disposition(disposition, result["filename"]),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    }
    if result["content_range"] is not None:
        headers["Content-Range"] = result["content_range"]
    return Response(
        content=result["content"],
        status_code=result["status_code"],
        media_type=result["content_type"],
        headers=headers,
    )


@router.delete("/executions/{execution_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_execution_artifacts(execution_id: str) -> Response:
    """Soft-delete every live artifact of an execution; in-progress -> 409."""
    artifact_service.delete_execution_artifacts(execution_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{artifact_id:path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artifact(artifact_id: str) -> Response:
    """Soft-delete one artifact file; in-progress executions are protected (409)."""
    artifact_service.delete_artifact(artifact_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
