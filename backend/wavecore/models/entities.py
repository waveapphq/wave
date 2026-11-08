"""
WAVE Entity Models

Test, Suite, Regression, Execution, and related entity models.
"""

import re
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from wavecore.models.workflow import (
    TryCatchBlock,
    Variable,
    WorkflowBlock,
)

# Import shared pattern
SEMVER_PATTERN = (
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


class VersionedEntityBase(BaseModel):
    """
    Base class for versioned entities (Test, Suite, Regression).

    Provides the shared fields and semver validation that all three entity
    types have in common. Each entity adds only its collection field.
    """

    id: str
    name: str
    version: str
    variables: list[Variable] | dict[str, Any] = Field(
        default_factory=dict
    )  # Support both Variable list and dict
    fail_on_error: bool = False  # Configurable failure propagation (REQ-3.2.1.1)
    description: str | None = None
    author: str | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("version")
    @classmethod
    def validate_semver(cls, v: str) -> str:
        """Validate semantic versioning (REQ-6.3.1)."""
        if not re.match(SEMVER_PATTERN, v):
            raise ValueError(f"Invalid semantic version: {v}")
        return v


class Test(VersionedEntityBase):
    """
    Test model (REQ-6.2.3, REQ-3.2.2.10-14).

    Represents a composable test that orchestrates block execution. When a test
    executes, it creates an execution workflow - the runtime sequence of blocks
    and plugins.

    Supports test-level finalize blocks (REQ-3.2.2.13) for guaranteed cleanup
    of test-wide resources regardless of normal or abnormal termination.
    """

    blocks: list["WorkflowBlock | TryCatchBlock"]  # Support regular and try-catch blocks
    finalize_blocks: list[WorkflowBlock] = Field(
        default_factory=list
    )  # Test-level finalize blocks (REQ-3.2.2.10-14)


class SuiteTest(BaseModel):
    """Reference to a test within a suite."""

    test_id: str
    test_version: str
    order: int
    parameters: dict[str, Any] = Field(default_factory=dict)


class Suite(VersionedEntityBase):
    """
    Suite model (REQ-6.2.4).

    Represents a collection of related tests. When a suite executes, it creates
    an execution workflow - the runtime sequence of tests, blocks, and plugins.

    For execution (REQ-3.2.1.1), tests contains direct Test objects.
    For storage/serialization, tests can contain SuiteTest references.
    """

    tests: "list[SuiteTest | Test]" = Field(
        default_factory=list
    )  # Support both SuiteTest references and Test objects


class RegressionSuite(BaseModel):
    """Reference to a suite within a regression."""

    suite_id: str
    suite_version: str
    order: int
    parameters: dict[str, Any] = Field(default_factory=dict)


class Regression(VersionedEntityBase):
    """
    Regression model (REQ-6.2.5).

    Represents a version-controlled collection of test suites for release validation.
    When a regression executes, it creates an execution workflow - the runtime sequence
    of suites, tests, blocks, and plugins.

    For execution (REQ-3.2.1.1), suites contains direct Suite objects.
    For storage/serialization, suites can contain RegressionSuite references.
    """

    suites: list[RegressionSuite | Suite] = Field(
        default_factory=list
    )  # Support both RegressionSuite references and Suite objects


class ExecutionError(BaseModel):
    """Execution error information."""

    message: str
    code: str
    block_id: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    stack_trace: str | None = None


class Execution(BaseModel):
    """
    Execution model for tracking test execution state.

    Tracks runtime state, progress, and results for an executing test.
    """

    id: str
    test_id: str
    status: Literal["running", "paused", "passed", "failed", "stopped"]
    progress: int = 0  # 0-100
    current_block: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    error: ExecutionError | None = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    completed_at: datetime | None = None
    artifacts: list[str] = Field(default_factory=list)
    debug_state: dict[str, Any] | None = None
