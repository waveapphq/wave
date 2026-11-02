"""
WAVE Control Metadata Models

ControlMetadata, ControlParameterSchema, and CORE_CONTROLS registry.
"""

import re
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from wavecore.models.enums import ControlCategory, ControlId

# Semantic versioning regex pattern
SEMVER_PATTERN = (
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


class ControlMetadata(BaseModel):
    """
    Control metadata model (REQ-3.5.0.2, REQ-3.5.0.4).

    Stores descriptive and display information for a control type.
    Each control has a unique identifier, semantic version, human-readable
    name and description, category for UI grouping, and icon for display.
    """

    id: ControlId
    version: str
    name: str
    description: str
    category: ControlCategory
    icon_name: str

    @field_validator("version")
    @classmethod
    def validate_semver(cls, v: str) -> str:
        """Validate semantic versioning (REQ-3.5.0.2)."""
        if not re.match(SEMVER_PATTERN, v):
            raise ValueError(f"Invalid semantic version: {v}")
        return v

    @field_validator("name")
    @classmethod
    def validate_name_not_empty(cls, v: str) -> str:
        """Validate name is not empty or whitespace-only."""
        if not v or not v.strip():
            raise ValueError("Control name cannot be empty")
        return v


class ControlParameterSchema(BaseModel):
    """
    Control parameter schema (REQ-3.5.0.3).

    Defines the complete parameter schema for a control type,
    including all parameters with their types and constraints.
    """

    control_id: ControlId
    parameters: list[Any] = Field(default_factory=list)  # list[ControlParameter]

    @model_validator(mode="after")
    def validate_unique_parameter_names(self) -> "ControlParameterSchema":
        """Validate no duplicate parameter names (REQ-3.5.0.3)."""
        if not self.parameters:
            return self

        param_names = [p.name for p in self.parameters]
        seen: set[str] = set()
        for name in param_names:
            if name in seen:
                raise ValueError(f"Duplicate parameter name: {name}")
            seen.add(name)

        return self


# CORE_CONTROLS registry (REQ-3.5.0.4)
# Metadata for all 15 built-in controls with display information
CORE_CONTROLS: dict[ControlId, ControlMetadata] = {
    # Conditional controls
    ControlId.IF_ELSE: ControlMetadata(
        id=ControlId.IF_ELSE,
        version="1.0.0",
        name="If/Else",
        description="Conditional branching based on expression evaluation",
        category=ControlCategory.CONDITIONAL,
        icon_name="git-branch",
    ),
    ControlId.SWITCH_CASE: ControlMetadata(
        id=ControlId.SWITCH_CASE,
        version="1.0.0",
        name="Switch/Case",
        description="Multi-way branching with condition-guarded cases",
        category=ControlCategory.CONDITIONAL,
        icon_name="list-tree",
    ),
    ControlId.ASSERT: ControlMetadata(
        id=ControlId.ASSERT,
        version="1.0.0",
        name="Assert",
        description="Validation assertion that fails if condition is false",
        category=ControlCategory.CONDITIONAL,
        icon_name="check-circle",
    ),
    # Loop controls
    ControlId.FOR: ControlMetadata(
        id=ControlId.FOR,
        version="1.0.0",
        name="For Loop",
        description="Iterate over a numeric range with counter variable",
        category=ControlCategory.LOOP,
        icon_name="repeat",
    ),
    ControlId.FOR_EACH: ControlMetadata(
        id=ControlId.FOR_EACH,
        version="1.0.0",
        name="For Each",
        description="Iterate over collection elements with iterator variable",
        category=ControlCategory.LOOP,
        icon_name="list",
    ),
    ControlId.WHILE: ControlMetadata(
        id=ControlId.WHILE,
        version="1.0.0",
        name="While Loop",
        description="Repeat while condition remains true",
        category=ControlCategory.LOOP,
        icon_name="refresh-cw",
    ),
    ControlId.BREAK: ControlMetadata(
        id=ControlId.BREAK,
        version="1.0.0",
        name="Break",
        description="Exit the current loop immediately",
        category=ControlCategory.LOOP,
        icon_name="x-circle",
    ),
    ControlId.CONTINUE: ControlMetadata(
        id=ControlId.CONTINUE,
        version="1.0.0",
        name="Continue",
        description="Skip to the next loop iteration",
        category=ControlCategory.LOOP,
        icon_name="skip-forward",
    ),
    # Flow controls
    ControlId.PARALLEL: ControlMetadata(
        id=ControlId.PARALLEL,
        version="1.0.0",
        name="Parallel",
        description="Execute multiple branches concurrently with fork-join semantics",
        category=ControlCategory.FLOW,
        icon_name="git-merge",
    ),
    ControlId.TRY_CATCH_FINALLY: ControlMetadata(
        id=ControlId.TRY_CATCH_FINALLY,
        version="1.0.0",
        name="Try/Catch/Finally",
        description="Error handling with catch and cleanup blocks",
        category=ControlCategory.FLOW,
        icon_name="shield",
    ),
    ControlId.HALT: ControlMetadata(
        id=ControlId.HALT,
        version="1.0.0",
        name="Halt",
        description="Stop execution at specified scope (test, suite, or regression)",
        category=ControlCategory.FLOW,
        icon_name="octagon",
    ),
    ControlId.VARIABLE_SETTER: ControlMetadata(
        id=ControlId.VARIABLE_SETTER,
        version="1.0.0",
        name="Variable Setter",
        description="Set or update variables in the execution context",
        category=ControlCategory.FLOW,
        icon_name="variable",
    ),
    # Timing controls
    ControlId.DELAY: ControlMetadata(
        id=ControlId.DELAY,
        version="1.0.0",
        name="Delay",
        description="Pause execution for a specified duration",
        category=ControlCategory.TIMING,
        icon_name="clock",
    ),
    ControlId.WAIT_UNTIL: ControlMetadata(
        id=ControlId.WAIT_UNTIL,
        version="1.0.0",
        name="Wait Until",
        description="Wait until condition becomes true or timeout expires",
        category=ControlCategory.TIMING,
        icon_name="hourglass",
    ),
    # Misc controls
    ControlId.NOTE: ControlMetadata(
        id=ControlId.NOTE,
        version="1.0.0",
        name="Note",
        description="Sticky-note annotation for visual documentation",
        category=ControlCategory.MISC,
        icon_name="sticky-note",
    ),
}
