"""
WAVE Control Versioning Models

Version metadata and version-related exceptions for controls.
"""

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from wavecore.models.enums import ControlCategory, ControlId

# Semantic versioning regex pattern
SEMVER_PATTERN = (
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


class VersionNotFoundError(Exception):
    """
    Exception raised when a requested version is not found (REQ-3.5.0.6, REQ-3.5.0.7).

    Raised during version resolution when no matching version exists for a control.
    """

    def __init__(self, control_id: ControlId, version_constraint: str) -> None:
        self.control_id = control_id
        self.version_constraint = version_constraint
        super().__init__(
            f"Version '{version_constraint}' not found for control '{control_id.value}'"
        )


class DuplicateVersionError(Exception):
    """
    Exception raised when registering a duplicate version (REQ-3.5.0.7).

    Raised when attempting to register a version that already exists for a control.
    """

    def __init__(self, control_id: ControlId, version: str) -> None:
        self.control_id = control_id
        self.version = version
        super().__init__(f"Version '{version}' already registered for control '{control_id.value}'")


class ControlVersionMetadata(BaseModel):
    """
    Control version metadata model (REQ-3.5.0.5).

    Extends ControlMetadata with version-specific information including
    release date, changelog entries, compatibility notes, and deprecation status.
    Each version maintains its own complete definition.
    """

    id: ControlId
    version: str
    name: str
    description: str
    category: ControlCategory
    icon_name: str
    release_date: datetime
    changelog: list[str] = Field(default_factory=list)
    compatibility_notes: str | None = None
    deprecated: bool = False
    deprecation_date: datetime | None = None

    @field_validator("version")
    @classmethod
    def validate_semver(cls, v: str) -> str:
        """Validate semantic versioning (REQ-3.5.0.5)."""
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

    @model_validator(mode="after")
    def validate_deprecation_consistency(self) -> "ControlVersionMetadata":
        """Validate deprecation_date can only be set when deprecated is True."""
        if not self.deprecated and self.deprecation_date is not None:
            raise ValueError("deprecation_date can only be set when deprecated is True")
        return self
