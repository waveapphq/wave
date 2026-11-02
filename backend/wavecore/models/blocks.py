"""
WAVE Block Models

Block definitions, parameters, dependencies, and execution flow.
"""

import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from wavecore.models.controls.reference import ControlReference
from wavecore.models.plugins import BlockMetadata, BlockPlugin

# Import shared pattern
SEMVER_PATTERN = (
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


def _is_table_value(v: Any) -> bool:
    """
    Check if value is a valid table type.

    Accepts either a Table instance or a list of rows (list/dict).
    Uses lazy import to avoid circular dependency.
    """
    from wavecore.core.table import Table

    if isinstance(v, Table):
        return True
    if isinstance(v, list) and all(isinstance(row, list | dict) for row in v):
        return True
    return False


class BlockChild(BaseModel):
    """
    Child block reference within a parent block.

    Enables nested block composition for hierarchical test construction.
    """

    block_id: str
    block_version: str
    order: int  # Execution order (same order = parallel execution)


class ExecutionFlow(BaseModel):
    """
    Execution flow definition for block internals.

    Defines how plugins and child blocks execute (sequential/parallel).
    """

    mode: Literal["sequential", "parallel"] = "sequential"
    parallel_groups: list[list[int]] = Field(default_factory=list)  # Indices that run in parallel


class BlockDependency(BaseModel):
    """
    Block dependency with version constraint (REQ-3.1.2.3, REQ-6.3.2).

    Supports dependencies on both blocks and plugins with version constraints.
    Supports version pinning (REQ-6.3.2) and ranges.
    Expresses "uses" relationships for dependency resolution and validation.
    """

    model_config = {"frozen": True}  # Make immutable and hashable

    component_id: str  # ID of the block or plugin
    component_type: Literal["block", "plugin"]  # Type of component
    version_constraint: (
        str  # Supports: exact (1.2.3), caret (^1.0.0), tilde (~1.2.0), range (>=1.0.0)
    )

    @field_validator("version_constraint")
    @classmethod
    def validate_version_constraint(cls, v: str) -> str:
        """
        Validate version constraint follows semver range notation (REQ-3.1.2.3).

        Supports:
        - Exact version: 1.2.3
        - Caret range: ^1.2.3 (compatible with 1.x.x)
        - Tilde range: ~1.2.3 (compatible with 1.2.x)
        - Comparison operators: >=1.0.0, >1.0.0, <2.0.0, <=2.0.0
        - Range combinations: >=1.0.0 <2.0.0
        - Wildcards: *, 1.x, 1.2.x
        """
        v = v.strip()

        # Wildcard patterns
        if v == "*":
            return v
        if re.match(r"^\d+\.x$", v):  # 1.x
            return v
        if re.match(r"^\d+\.\d+\.x$", v):  # 1.2.x
            return v

        # Exact semver
        if re.match(SEMVER_PATTERN, v):
            return v

        # Caret constraint: ^1.2.3
        if v.startswith("^") and re.match(SEMVER_PATTERN, v[1:]):
            return v

        # Tilde constraint: ~1.2.3
        if v.startswith("~") and re.match(SEMVER_PATTERN, v[1:]):
            return v

        # Range operators: >=1.0.0, >1.0.0, <2.0.0, <=2.0.0
        range_pattern = r"^(>=?|<=?)\s*" + SEMVER_PATTERN[1:-1] + r"$"
        if re.match(range_pattern, v):
            return v

        # Range combinations: >=1.0.0 <2.0.0
        combo_pattern = (
            r"^(>=?|<=?)\s*"
            + SEMVER_PATTERN[1:-1]
            + r"\s+(>=?|<=?)\s*"
            + SEMVER_PATTERN[1:-1]
            + r"$"
        )
        if re.match(combo_pattern, v):
            return v

        raise ValueError(
            f"Invalid version constraint: {v}. "
            f"Must be valid semver, caret (^), tilde (~), range (>=, >, <, <=), or wildcard (*)"
        )


class BlockParameter(BaseModel):
    """
    Block parameter definition (REQ-3.1.2.1, REQ-3.4.2.2).

    Declares input parameters that blocks accept when instantiated in workflows.
    Enables blocks to function as parameterized templates.
    """

    name: str
    type: Literal["string", "integer", "float", "boolean", "array", "map", "table"]
    required: bool = False
    default: Any | None = None
    description: str | None = None
    is_expression: bool = False
    is_template: bool = False

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate parameter name is not empty and contains no spaces (REQ-3.1.2.1)."""
        if not v or len(v.strip()) == 0:
            raise ValueError("Parameter name cannot be empty")
        if " " in v:
            raise ValueError(f"Invalid parameter name '{v}': parameter names cannot contain spaces")
        # Must be valid identifier (alphanumeric + underscore, no leading digit)
        if not re.match(r"^[a-zA-Z_]\w*$", v):
            raise ValueError(
                f"Invalid parameter name '{v}': must be valid identifier "
                f"(alphanumeric + underscore, no leading digit)"
            )
        return v

    @model_validator(mode="after")
    def validate_default_type(self) -> "BlockParameter":
        """Validate default value type matches parameter type (REQ-3.1.2.1)."""
        if self.default is None:
            return self

        # Type checking for default values
        type_validators = {
            "string": lambda v: isinstance(v, str),
            "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
            "float": lambda v: isinstance(v, float | Decimal),
            "boolean": lambda v: isinstance(v, bool),
            "array": lambda v: isinstance(v, list),
            "map": lambda v: isinstance(v, dict),
            "table": lambda v: _is_table_value(v),
        }

        validator = type_validators.get(self.type)
        if validator and not validator(self.default):
            raise ValueError(
                f"Default value type mismatch: parameter '{self.name}' has type '{self.type}' "
                f"but default value is {type(self.default).__name__}"
            )

        return self

    @model_validator(mode="after")
    def validate_required_with_default(self) -> "BlockParameter":
        """Validate required parameters cannot have defaults (REQ-3.1.2.1)."""
        if self.required and self.default is not None:
            raise ValueError(
                f"Required parameter '{self.name}' cannot have a default value: "
                "required parameters must always be provided by the caller"
            )
        return self

    @model_validator(mode="after")
    def check_expression_template_exclusive(self) -> "BlockParameter":
        """is_expression and is_template cannot both be True."""
        if self.is_expression and self.is_template:
            raise ValueError("is_expression and is_template are mutually exclusive")
        return self


class Block(BaseModel):
    """
    Block model (REQ-6.2.2, REQ-3.1.2.1, REQ-3.1.2.2, REQ-3.2.2.10-14).

    Represents reusable, parameterized test logic composed of plugins and other blocks.
    Enables hierarchical test construction through nested composition.
    Blocks can declare input parameters for parameterization (REQ-3.1.2.1).
    Supports version control with metadata and deprecation management (REQ-3.1.2.2).
    Supports finalize type for guaranteed cleanup blocks (REQ-3.2.2.10-14).
    """

    id: str
    version: str
    metadata: BlockMetadata
    type: Literal["action", "validation", "control", "timing", "data", "finalize"] = "action"
    parameters: list[BlockParameter] = Field(
        default_factory=list
    )  # Input parameter declarations (REQ-3.1.2.1)
    plugins: list[BlockPlugin] = Field(default_factory=list)  # Aggregated plugins
    child_blocks: list[BlockChild] = Field(default_factory=list)  # Nested blocks
    dependencies: list[BlockDependency] = Field(default_factory=list)  # "Uses" relationships
    execution_flow: ExecutionFlow | None = None
    steps: list[Any] = Field(default_factory=list)  # Legacy field for backward compatibility
    # Version lifecycle metadata (REQ-3.1.2.2)
    is_published: bool = False  # Immutability enforcement: published blocks cannot be modified
    publish_date: datetime | None = None
    is_deprecated: bool = False
    deprecation_reason: str | None = None
    replacement_version: str | None = None
    deprecation_date: datetime | None = None
    # Control reference for control-type blocks (REQ-3.5.0.6)
    control_reference: ControlReference | None = None

    @field_validator("version")
    @classmethod
    def validate_semver(cls, v: str) -> str:
        """Validate semantic versioning (REQ-6.3.1)."""
        if not re.match(SEMVER_PATTERN, v):
            raise ValueError(f"Invalid semantic version: {v}")
        return v

    # Convenience properties for accessing metadata fields
    @property
    def name(self) -> str:
        """Get block name from metadata."""
        return self.metadata.name

    @property
    def description(self) -> str | None:
        """Get block description from metadata."""
        return self.metadata.description

    @property
    def author(self) -> str | None:
        """Get block author from metadata."""
        return self.metadata.author

    @property
    def tags(self) -> list[str]:
        """Get block tags from metadata."""
        return self.metadata.tags

    @property
    def created_at(self) -> datetime:
        """Get block creation time from metadata."""
        return self.metadata.created_at

    @property
    def updated_at(self) -> datetime:
        """Get block update time from metadata."""
        return self.metadata.updated_at

    @model_validator(mode="after")
    def validate_unique_parameter_names(self) -> "Block":
        """Validate no duplicate parameter names (REQ-3.1.2.1)."""
        if not self.parameters:
            return self

        param_names = [p.name for p in self.parameters]
        duplicates = [name for name in param_names if param_names.count(name) > 1]

        if duplicates:
            # Get unique duplicates for clear error message
            unique_dups = list(set(duplicates))
            raise ValueError(
                f"Duplicate parameter name(s) in block '{self.id}': {', '.join(unique_dups)}"
            )

        return self

    @model_validator(mode="after")
    def validate_deprecation_metadata(self) -> "Block":
        """Validate deprecation metadata consistency (REQ-3.1.2.2)."""
        if self.is_deprecated:
            self._validate_deprecated_block()
        else:
            self._validate_non_deprecated_block()

        # Validate replacement version if provided
        if self.replacement_version is not None:
            if not re.match(SEMVER_PATTERN, self.replacement_version):
                raise ValueError(f"Invalid replacement version: {self.replacement_version}")

        return self

    def _validate_deprecated_block(self) -> None:
        """Validate required fields when block is deprecated."""
        if self.deprecation_reason is None:
            raise ValueError("Deprecation reason is required when block is deprecated")
        if not self.deprecation_reason.strip():
            raise ValueError("Deprecation reason cannot be empty")
        # Set deprecation_date to now if not provided
        if self.deprecation_date is None:
            self.deprecation_date = datetime.now(UTC)

    def _validate_non_deprecated_block(self) -> None:
        """Validate no deprecation metadata is set on non-deprecated blocks."""
        if self.deprecation_reason is not None:
            raise ValueError("Deprecation reason can only be set when block is deprecated")
        if self.replacement_version is not None:
            raise ValueError("Replacement version can only be set when block is deprecated")
        if self.deprecation_date is not None:
            raise ValueError("Deprecation date can only be set when block is deprecated")

    @model_validator(mode="after")
    def validate_publish_metadata(self) -> "Block":
        """Validate publish metadata consistency (REQ-3.1.2.2)."""
        if self.is_published:
            # Set publish_date to now if not provided
            if self.publish_date is None:
                self.publish_date = datetime.now(UTC)
        else:
            # Cannot set publish_date if not published
            if self.publish_date is not None:
                raise ValueError("Publish date can only be set when block is published")

        return self

    @model_validator(mode="after")
    def validate_control_reference(self) -> "Block":
        """Validate control_reference is required for control type blocks (REQ-3.5.0.6)."""
        if self.type == "control" and self.control_reference is None:
            raise ValueError("control_reference is required for blocks of type 'control'")
        return self
