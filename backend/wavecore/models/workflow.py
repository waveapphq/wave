"""
WAVE Workflow Models

Variable, workflow blocks, try-catch and finalize models.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

from wavecore.models.enums import LogLevel


class Variable(BaseModel):
    """Variable model for test definitions."""

    name: str
    value: Any | None = None
    type: Literal["string", "integer", "float", "boolean", "array", "map", "table", "computed"]
    expression: str | None = None  # For computed variables
    description: str | None = None
    secret: bool = False


class WorkflowBlock(BaseModel):
    """Reference to a block within a workflow."""

    block_id: str
    block_version: str
    order: int
    parameters: dict[str, Any] = Field(default_factory=dict)
    log_level: LogLevel | None = None  # Optional log level override (REQ-3.1.2.6)


class TryCatchBlock(BaseModel):
    """
    Try-catch error handling construct (REQ-3.2.2.6, REQ-3.2.2.10-14).

    Enables exception handling and recovery within tests, allowing custom
    recovery logic, cleanup operations, and error transformation.
    Supports try-finally constructs without catch for guaranteed cleanup (REQ-3.2.2.10).
    Supports nested try-catch blocks for hierarchical error handling.
    """

    try_blocks: list["WorkflowBlock | TryCatchBlock"]
    catch_blocks: list["WorkflowBlock | TryCatchBlock"] = Field(default_factory=list)
    finally_blocks: list["WorkflowBlock | TryCatchBlock"] = Field(default_factory=list)
    order: int = 0  # Execution order within test (defaults to 0 if not specified)


class FinalizeBlock(BaseModel):
    """
    Finalize/finally block for guaranteed cleanup (REQ-3.2.2.10-14).

    Ensures cleanup operations execute on both normal and abnormal termination.
    Finalize blocks execute regardless of success or failure.
    """

    blocks: list[WorkflowBlock]
    scope: Literal["test"] = "test"
