"""
WAVE Control Parameter Model

Typed configuration parameter definitions for controls.
"""

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, field_validator, model_validator

ValidType = Literal["string", "integer", "float", "boolean", "array", "map", "table"]


class RequiredWhen(BaseModel):
    """Conditional requirement: parameter is required when another field matches specific values."""

    field: str
    values: list[str]


def ensure_required_exclusive(name: str, required: bool, conditionals: Mapping[str, Any]) -> None:
    """A parameter is required outright or conditionally, never both."""
    if not required:
        return
    for attr, value in conditionals.items():
        if value is not None:
            raise ValueError(f"Parameter '{name}' cannot have both 'required' and '{attr}'")


class ControlParameter(BaseModel):
    """
    Control parameter definition (REQ-3.5.0.3, REQ-3.4.2.2).

    Defines typed configuration parameters for controls. Each control
    has its own parameter schema with type constraints and validation.
    Uses canonical types from the parameter definition design doc.
    """

    name: str
    type: ValidType | list[ValidType]
    required: bool = False
    required_when: RequiredWhen | None = None
    default: Any | None = None
    description: str | None = None
    enum_values: list[str | int | float] | None = None
    # Smallest accepted numeric literal, so a value the runtime would reject is
    # caught at author time instead of at the failing block.
    minimum: int | float | None = None
    # The value names a variable to resolve at execution, not a literal.
    variable_ref: bool = False
    # Null marks (REQ-3.4.2.2): the whole value, a {{ }} piece printing null.
    accepts_null: bool = False
    null_piece_prints: bool = False
    # REQ-3.4.2.2: a value of any type reaches the field unchecked by its declared type.
    accepts_any_type: bool = False

    @field_validator("name")
    @classmethod
    def validate_name_not_empty(cls, v: str) -> str:
        """Validate parameter name is not empty."""
        if not v or not v.strip():
            raise ValueError("Parameter name cannot be empty")
        return v

    @model_validator(mode="after")
    def validate_required_mutual_exclusivity(self) -> "ControlParameter":
        """Validate required and required_when are mutually exclusive."""
        ensure_required_exclusive(self.name, self.required, {"required_when": self.required_when})
        return self

    @model_validator(mode="after")
    def validate_enum_values_require_string_type(self) -> "ControlParameter":
        """Validate enum_values is only valid for string type parameters."""
        if self.enum_values is not None and self.type != "string":
            raise ValueError(
                f"Parameter '{self.name}' has enum_values but type "
                f"is '{self.type}' (must be 'string', not a list)"
            )
        return self
