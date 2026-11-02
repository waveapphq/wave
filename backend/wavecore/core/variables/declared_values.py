"""What a variable declaration holds when a run starts, one rule for Test and Function variables."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from wavecore.core.variables.element_types import realize_declared_value

_EXCLUSIVE_KINDS = "is_expression and is_template are mutually exclusive"


@dataclass(frozen=True)
class DeclaredStart:
    """A realized literal, or an Expression / Template source evaluated at its first read."""

    kind: Literal["literal", "expression", "template"]
    value: Any
    var_type: str


def declared_start(entry: Mapping[str, Any], value_key: str = "value") -> DeclaredStart:
    """The start of one declaration; one holding no value holds null (REQ-3.1.3.20)."""
    is_expression = bool(entry.get("isExpression"))
    is_template = bool(entry.get("isTemplate"))
    if is_expression and is_template:
        raise ValueError(_EXCLUSIVE_KINDS)
    var_type = str(entry.get("type") or "")
    source = entry.get(value_key)
    if (is_expression or is_template) and source is None:
        return DeclaredStart("literal", None, var_type)
    if is_expression:
        return DeclaredStart("expression", str(source), var_type or "string")
    if is_template:
        return DeclaredStart("template", str(source), var_type)
    return DeclaredStart(
        "literal", realize_declared_value(source, var_type, entry.get("elementTypes")), var_type
    )
