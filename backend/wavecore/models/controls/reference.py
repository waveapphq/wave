"""
WAVE Control Reference Model

Control reference for workflows with version constraint validation.
"""

import re

from pydantic import BaseModel, field_validator

from wavecore.models.enums import ControlId

# Semantic versioning regex pattern
SEMVER_PATTERN = (
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)

# Version constraint pattern for control references (REQ-3.5.0.6)
# Supports: exact (1.2.3), caret (^1.0.0), tilde (~1.2.0), range operators (>=, >, <, <=)
VERSION_CONSTRAINT_PATTERN = (
    r"^(?:"
    # Exact semver
    + SEMVER_PATTERN[1:-1]
    + r"|"
    # Caret constraint: ^1.2.3
    + r"\^"
    + SEMVER_PATTERN[1:-1]
    + r"|"
    # Tilde constraint: ~1.2.3
    + r"~"
    + SEMVER_PATTERN[1:-1]
    + r"|"
    # Range operators: >=1.0.0, >1.0.0, <2.0.0, <=2.0.0
    + r"(?:>=?|<=?)\s*"
    + SEMVER_PATTERN[1:-1]
    + r"(?:\s+(?:>=?|<=?)\s*"
    + SEMVER_PATTERN[1:-1]
    + r")?"
    + r")$"
)


class ControlReference(BaseModel):
    """
    Control reference model for workflows (REQ-3.5.0.6).

    References controls through explicit identifier and version pairs.
    Supports version constraints: exact pins, caret, tilde, and ranges.
    """

    control_id: ControlId
    control_version: str

    @field_validator("control_version")
    @classmethod
    def validate_version_constraint(cls, v: str) -> str:
        """
        Validate version constraint format (REQ-3.5.0.6).

        Supports:
        - Exact version: 1.2.3
        - Caret range: ^1.2.3 (compatible with 1.x.x, or 0.y.x for 0.y.z)
        - Tilde range: ~1.2.3 (compatible with 1.2.x)
        - Comparison operators: >=1.0.0, >1.0.0, <2.0.0, <=2.0.0
        - Range combinations: >=1.0.0 <2.0.0
        """
        if not v or not v.strip():
            raise ValueError("Version constraint cannot be empty")

        v = v.strip()

        if re.match(VERSION_CONSTRAINT_PATTERN, v):
            return v

        raise ValueError(f"Invalid version constraint: {v}")
