"""
WAVE Plugin Models

Plugin metadata, parameters, output fields, and plugin/block plugin models.
"""

import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from wavecore.models.controls.parameters import RequiredWhen, ensure_required_exclusive
from wavecore.models.enums import LogLevel

# Import shared pattern
SEMVER_PATTERN = (
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


ParamType = Literal["string", "integer", "float", "boolean", "array", "map", "table"]

# Plugin-catalog element types the engine dispatches itself; no plugin implementation backs them.
ENGINE_DISPATCHED_ELEMENT_TYPES: frozenset[str] = frozenset({"remote-execution"})


class ValidationRule(BaseModel):
    """Validation rule for plugin parameters."""

    field: str
    rule: str
    pattern: str | None = None
    message: str | None = None


class PluginParameter(BaseModel):
    """Plugin parameter definition (REQ-3.4.2.2)."""

    name: str
    type: ParamType | list[ParamType]
    required: bool = False
    required_when: RequiredWhen | None = None
    # Required only while EVERY condition matches.
    required_when_all: list[RequiredWhen] | None = None
    default: Any | None = None
    description: str | None = None
    validation: ValidationRule | None = None
    enum_values: list[str | int | float] | None = None
    trim: bool = False
    variable_ref: bool = False
    # Declared only; each plugin's own validate() owns the refusal and its wording.
    minimum: float | None = None
    maximum: float | None = None
    # Null marks (REQ-3.4.2.2): the whole value, a {{ }} piece printing null.
    accepts_null: bool = False
    null_piece_prints: bool = False
    # REQ-3.4.2.2: a value of any type reaches the field unchecked by its declared type.
    accepts_any_type: bool = False

    @model_validator(mode="after")
    def validate_required_mutual_exclusivity(self) -> "PluginParameter":
        """Validate required and the conditional forms are mutually exclusive."""
        ensure_required_exclusive(
            self.name,
            self.required,
            {"required_when": self.required_when, "required_when_all": self.required_when_all},
        )
        return self


class OutputTypeCondition(BaseModel):
    """One field/value test inside an output type rule."""

    field: str
    values: list[str]


class OutputTypeRule(BaseModel):
    """First rule whose every condition matches decides the output's type."""

    when: list[OutputTypeCondition]
    type: ParamType


class OutputField(BaseModel):
    """Output field definition for plugins and controls."""

    name: str
    type: ParamType
    description: str | None = None
    secret: bool = False
    type_when: list[OutputTypeRule] | None = None


class PluginMetadata(BaseModel):
    """Plugin metadata."""

    name: str
    description: str
    author: str | None = None
    category: Literal[
        "network", "remote", "database", "system", "kubernetes", "helm", "data", "custom"
    ]
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    deprecated: bool = False
    deprecation_message: str | None = None
    usage_count: int = 0
    last_used_at: datetime | None = None
    remotable: bool = False


class BlockMetadata(BaseModel):
    """Block metadata."""

    name: str
    description: str | None = None
    author: str | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    dependencies: list[str] = Field(default_factory=list)


class Plugin(BaseModel):
    """
    Plugin model (REQ-6.2.1).

    Represents a reusable executor providing specific functionality.
    """

    id: str
    version: str
    metadata: PluginMetadata
    parameters: list[PluginParameter] = Field(default_factory=list)
    outputs: list[OutputField] = Field(default_factory=list)
    implementation: str = ""
    return_type: str | None = None
    validation_rules: list[ValidationRule] = Field(default_factory=list)

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
        """Get plugin name from metadata."""
        return self.metadata.name

    @property
    def description(self) -> str | None:
        """Get plugin description from metadata."""
        return self.metadata.description

    @property
    def author(self) -> str | None:
        """Get plugin author from metadata."""
        return self.metadata.author

    @property
    def category(self) -> str:
        """Get plugin category from metadata."""
        return self.metadata.category

    @property
    def tags(self) -> list[str]:
        """Get plugin tags from metadata."""
        return self.metadata.tags

    @property
    def created_at(self) -> datetime:
        """Get plugin creation time from metadata."""
        return self.metadata.created_at

    @property
    def updated_at(self) -> datetime:
        """Get plugin update time from metadata."""
        return self.metadata.updated_at


class BlockPlugin(BaseModel):
    """
    Plugin reference within a block.

    Represents a plugin instance that is part of a block's composition.
    """

    plugin_id: str
    plugin_version: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    order: int  # Execution order (same order = parallel execution)
    log_level: LogLevel | None = None  # Optional log level override (REQ-3.1.2.6)


def condition_text(value: Any) -> str:
    """A field's comparable text; a boolean reads as the schema's lowercase 'true' / 'false'."""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def get_param_attr(param: Any, attr: str, default: Any = None) -> Any:
    """One attribute of a parameter row written as a dict or as a model."""
    if isinstance(param, Mapping):
        return param.get(attr, default)
    return getattr(param, attr, default)


def _field_text(
    field: str,
    values: Mapping[str, Any],
    parameters: Mapping[str, Any] | None,
) -> str:
    """The comparable text of a field, falling back to the parameter's declared default."""
    raw = values.get(field)
    if raw is None and parameters is not None:
        raw = get_param_attr(parameters.get(field) or {}, "default")
    return "" if raw is None else condition_text(raw)


def is_conditionally_required(
    required_when: Any,
    values: Mapping[str, Any],
    param_schema: Sequence[Any],
) -> bool:
    """Whether one required_when condition matches the field's value or its declared default."""
    field = str(get_param_attr(required_when, "field", ""))
    by_name = {get_param_attr(param, "name"): param for param in param_schema}
    return _field_text(field, values, by_name) in get_param_attr(required_when, "values", [])


def is_param_required(
    param: Any,
    values: Mapping[str, Any],
    param_schema: Sequence[Any],
) -> bool:
    """Whether a parameter is required outright or by its conditional form in force."""
    if get_param_attr(param, "required", False):
        return True
    required_when = get_param_attr(param, "required_when")
    if required_when is not None:
        return is_conditionally_required(required_when, values, param_schema)
    required_when_all = get_param_attr(param, "required_when_all")
    if required_when_all:
        return all(
            is_conditionally_required(condition, values, param_schema)
            for condition in required_when_all
        )
    return False


def resolve_output_type(
    declared_type: str,
    type_when: Sequence[Mapping[str, Any]] | None,
    values: Mapping[str, Any],
    parameters: Mapping[str, Any] | None = None,
) -> str:
    """An output's effective type: first matching type_when rule, else the declared type."""
    if not type_when:
        return declared_type
    for rule in type_when:
        conditions = rule.get("when") or []
        if all(
            _field_text(str(c["field"]), values, parameters) in list(c["values"])
            for c in conditions
        ):
            return str(rule.get("type", declared_type))
    return declared_type
