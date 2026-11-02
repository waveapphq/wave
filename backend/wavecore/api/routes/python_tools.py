"""Python introspection endpoints for the script editor (PYRUN-19)."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from wavecore.api.routes.shared import envelope
from wavecore.api.services.python_tools import service as python_tools_service

router = APIRouter(prefix="/python-tools", tags=["Python Tools"])


class CompleteBody(BaseModel):
    """A cursor position in a script, with the block's Interpreter row."""

    script: str
    line: int
    column: int
    interpreter: str = ""


class RenameBody(BaseModel):
    """A cursor position, the new name, and the block's Interpreter row."""

    script: str
    line: int
    column: int
    new_name: str
    interpreter: str = ""


class CheckBody(BaseModel):
    """A script to parse."""

    script: str


# Sync handlers: jedi blocks, so they run in the threadpool instead of the event loop.
@router.post("/complete")
def complete(body: CompleteBody) -> dict[str, Any]:
    """Completion items at the cursor, each with its signature and documentation."""
    items = python_tools_service.complete(body.script, body.line, body.column, body.interpreter)
    return envelope({"items": items})


@router.post("/rename")
def rename(body: RenameBody) -> dict[str, Any]:
    """The edits that rename the symbol at the cursor."""
    edits = python_tools_service.rename(
        body.script, body.line, body.column, body.new_name, body.interpreter
    )
    return envelope({"edits": edits})


@router.post("/check")
def check(body: CheckBody) -> dict[str, Any]:
    """The script's syntax errors; the script is parsed, never run."""
    return envelope({"issues": python_tools_service.syntax_issues(body.script)})
