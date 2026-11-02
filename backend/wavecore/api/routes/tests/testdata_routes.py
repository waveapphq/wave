"""Per-test Test Data endpoints under /tests/{test_id}/testdata (REQ-5.2.4.12, REQ-3.4.3.2).

Bodies are bare (no envelope), like the session-artifact routes. The static
segments (``upload``, ``uploads``, ``space``, ``folders``, ``zip``, ``content``)
are declared before the catch-all ``{path:path}`` routes so they resolve first.
"""

import contextlib
import os
import tempfile
from collections.abc import AsyncIterator
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from wavecore.api.exceptions import ValidationException, WaveException
from wavecore.api.routes import multipart_stream
from wavecore.api.services import file_tree
from wavecore.api.services.tests import testdata_service, testdata_uploads

router = APIRouter(tags=["Tests"])

_ONE_FILE_PER_REQUEST = "One file per upload request"
_FIELDS_BEFORE_FILE = "Send path and replace before the file"
_NO_FILE_PART = "No file in the upload request"
_TRUNCATED_FILE = "Upload ended before the file was complete"
_TRUNCATED_REASON = "The upload did not complete"
_DEFAULT_FIELDS = {
    "path": "",
    "replace": "false",
    "upload_id": "",
    "session": "",
    "size": "0",
    "retry_of": "",
}


class TestDataPathBody(BaseModel):
    path: str


class UploadSessionBody(BaseModel):
    """Who is asking; only the holder or the session that started it may cancel."""

    session: str = ""


class UploadInterruptBody(BaseModel):
    """A file the client refused to send at all, recorded as a notice like any other."""

    path: str = ""
    name: str
    reason: str
    replace: bool = False


@router.get("/tests/{test_id}/testdata")
async def list_testdata(test_id: str) -> dict[str, Any]:
    """Flat listing of the test's files and folders plus the aggregates."""
    return testdata_service.list_entries(test_id)


@router.post("/tests/{test_id}/testdata/upload", status_code=status.HTTP_201_CREATED)
async def upload_testdata(test_id: str, request: Request) -> dict[str, Any]:
    """Stream one file part straight to disk; path and replace must arrive before it."""
    fields = dict(_DEFAULT_FIELDS)
    stored: dict[str, Any] | None = None
    events = multipart_stream.iter_events(request)
    async with contextlib.aclosing(events):
        async for event in events:
            if isinstance(event, multipart_stream.Field):
                if stored is not None:
                    raise ValidationException(_FIELDS_BEFORE_FILE)
                fields[event.name] = event.value
            elif isinstance(event, multipart_stream.FileStart):
                if stored is not None:
                    raise ValidationException(_ONE_FILE_PER_REQUEST)
                stored = await _store_part(test_id, fields, event.filename, events)
    if stored is None:
        raise ValidationException(_NO_FILE_PART)
    return stored


def _declared_size(value: str) -> int:
    """The size the client said it was sending; anything unusable counts as unknown."""
    return int(value) if value.isdigit() else 0


def _reason_of(exc: BaseException) -> str:
    return exc.message if isinstance(exc, WaveException) else _TRUNCATED_REASON


async def _drain(
    upload: testdata_service.Upload,
    record: testdata_uploads.Upload,
    events: AsyncIterator[multipart_stream.Event],
) -> dict[str, Any]:
    """Feed the part to disk, counting bytes in and stopping when somebody says so."""
    async for event in events:
        if isinstance(event, multipart_stream.FileChunk):
            if testdata_uploads.is_canceled(record):
                raise testdata_uploads.canceled_error(record)
            await run_in_threadpool(upload.write, event.data)
            testdata_uploads.advance(record, len(event.data))
        else:
            stored = await run_in_threadpool(upload.finish)
            testdata_uploads.finish(record)
            return stored
    raise ValidationException(_TRUNCATED_FILE)


async def _store_part(
    test_id: str,
    fields: dict[str, str],
    filename: str,
    events: AsyncIterator[multipart_stream.Event],
) -> dict[str, Any]:
    """Drain the file part into its in-progress file; anything but a clean end deletes it."""
    folder = fields["path"]
    replace = fields["replace"].lower() == "true"
    retry_of = fields["retry_of"]
    upload_id = fields["upload_id"] or uuid4().hex
    rel = f"{folder}/{filename}" if folder else filename
    notice: dict[str, Any] = {"folder": folder, "name": filename, "path": rel, "replace": replace}
    if retry_of:
        testdata_uploads.drop_interruption(test_id, retry_of)
    try:
        upload = await run_in_threadpool(
            testdata_service.begin_upload,
            test_id,
            folder,
            filename,
            replace=replace,
            displace=bool(retry_of),
        )
    except BaseException as exc:
        testdata_uploads.interrupt(test_id, upload_id, reason=_reason_of(exc), **notice)
        raise
    record = testdata_uploads.start(
        test_id,
        upload_id,
        total_bytes=_declared_size(fields["size"]),
        session=fields["session"],
        **notice,
    )
    try:
        return await _drain(upload, record, events)
    except BaseException as exc:
        # Whichever way the body ended, a canceled upload leaves no notice: the
        # tab that was told to stop closes its own request a moment later.
        upload.abort()
        if testdata_uploads.is_canceled(record):
            testdata_uploads.abandon(record)
        else:
            testdata_uploads.interrupt(test_id, upload_id, reason=_reason_of(exc), **notice)
        raise


@router.get("/tests/{test_id}/testdata/uploads")
async def list_testdata_uploads(test_id: str) -> dict[str, Any]:
    """Everything in flight for this test, and every file that did not land."""
    return testdata_uploads.snapshot(test_id)


@router.post(
    "/tests/{test_id}/testdata/uploads/{upload_id}/cancel",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def cancel_testdata_upload(test_id: str, upload_id: str, body: UploadSessionBody) -> Response:
    """Stop one upload in flight; the streaming request drops what it had written."""
    testdata_uploads.cancel(test_id, upload_id, body.session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/tests/{test_id}/testdata/uploads/{upload_id}/dismiss",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def dismiss_testdata_upload(test_id: str, upload_id: str) -> Response:
    """Clear the notice one file left behind."""
    testdata_uploads.dismiss(test_id, upload_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/tests/{test_id}/testdata/uploads/{upload_id}/interrupt",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def interrupt_testdata_upload(
    test_id: str, upload_id: str, body: UploadInterruptBody
) -> Response:
    """Record a file the client never got to send, so it leaves the same notice."""
    rel = f"{body.path}/{body.name}" if body.path else body.name
    testdata_uploads.interrupt(
        test_id,
        upload_id,
        folder=body.path,
        name=body.name,
        path=rel,
        reason=body.reason,
        replace=body.replace,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/tests/{test_id}/testdata/space")
async def check_testdata_space(
    test_id: str,
    size_bytes: Annotated[int, Query(alias="bytes")],
    name: Annotated[str, Query()],
) -> dict[str, bool]:
    """Answer whether storing that many bytes would still leave the reserve free."""
    testdata_service.check_space(test_id, size_bytes, name)
    return {"ok": True}


@router.post("/tests/{test_id}/testdata/folders", status_code=status.HTTP_201_CREATED)
async def create_testdata_folder(test_id: str, body: TestDataPathBody) -> dict[str, str]:
    """Create one folder under an existing parent."""
    return {"path": testdata_service.create_folder(test_id, body.path)}


def _build_zip(test_id: str, path: str) -> tuple[str, str]:
    """Zip into a temp file; returns its name on disk and the download name."""
    handle, temp_name = tempfile.mkstemp(suffix=".zip")
    try:
        with os.fdopen(handle, "wb") as sink:
            return temp_name, testdata_service.zip_entry(test_id, path, sink=sink)
    except BaseException:
        os.remove(temp_name)
        raise


@router.get("/tests/{test_id}/testdata/zip")
async def download_testdata_zip(test_id: str, path: Annotated[str, Query()] = "") -> FileResponse:
    """Zip the whole folder ("") or one subfolder into a temp file served with cleanup."""
    temp_name, filename = await run_in_threadpool(_build_zip, test_id, path)
    return FileResponse(
        temp_name,
        media_type="application/zip",
        headers={"Content-Disposition": file_tree.content_disposition("attachment", filename)},
        background=BackgroundTask(os.remove, temp_name),
    )


@router.get("/tests/{test_id}/testdata/content/{path:path}")
async def download_testdata_content(
    test_id: str, path: str, disposition: Annotated[str, Query()] = "attachment"
) -> FileResponse:
    """Serve one file from disk with the shared download headers."""
    return file_tree.content_response(testdata_service.content_path(test_id, path), disposition)


@router.patch("/tests/{test_id}/testdata/{path:path}")
async def rename_testdata_entry(test_id: str, path: str, body: TestDataPathBody) -> dict[str, str]:
    """Rename or move an entry within the test; the body carries the new relative path."""
    return {"path": testdata_service.rename_entry(test_id, path, body.path)}


@router.delete("/tests/{test_id}/testdata/{path:path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_testdata_entry(test_id: str, path: str) -> Response:
    """Remove a file, or a folder with everything inside it."""
    testdata_service.delete_entry(test_id, path)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
