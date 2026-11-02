"""Declaration rules for Test variables and Function inputs, outputs and locals.

REQ-3.1.2.4, REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.1.3.1, REQ-3.1.3.19.
"""

from __future__ import annotations

import keyword
import re
from collections.abc import Iterable, Mapping
from typing import Any, Literal, cast

from wavecore.core.execution.plugin_executor import VALUE_TYPE_CHECKS
from wavecore.core.number_rule import NumberType
from wavecore.core.variables.element_types import element_types_problem, realize_declared_value
from wavecore.core.variables.reserved import RESERVED_VARIABLE_NAMES
from wavecore.core.variables.value_checks import (
    NUMBER_TYPES,
    NumberForm,
    ValueProblem,
    declared_value_problem,
    number_value_problem,
    typed_value_numbers,
)

ENUM_VALUE_TYPES: tuple[str, ...] = ("string", "integer", "float")
DECLARED_TYPES: tuple[str, ...] = ("array", "boolean", "float", "integer", "map", "string", "table")
MAX_NAME_LENGTH = 64
VARIABLE_NAME_PATTERN = "[a-zA-Z_][a-zA-Z0-9_]*"
PARAMETER_NAME_PATTERN = "[a-zA-Z][a-zA-Z0-9_]*"

DeclarationKind = Literal["variable", "input", "output", "local"]

# The declaration lists a Function definition holds, each with its kind.
DECLARATION_LISTS: tuple[tuple[str, DeclarationKind], ...] = (
    ("inputs", "input"),
    ("outputs", "output"),
    ("variables", "local"),
)

_NOUNS: dict[str, str] = {
    "variable": "variable",
    "input": "input",
    "output": "output",
    "local": "local variable",
}

_VALUE_SUBJECTS: dict[str, str] = {
    "variable": "Value for variable",
    "input": "Default for input",
    "output": "Default for output",
    "local": "Value for local variable",
}

_KIND_LABELS: dict[str, str] = {
    "input": "an input",
    "output": "an output",
    "local": "a local variable",
}


def is_enum_input(declared: Mapping[str, Any]) -> bool:
    """An input is an enum when it carries the ``enumValues`` key."""
    return "enumValues" in declared


def _text(value: Any) -> str:
    return "null" if value is None else str(value)


def _misfit(value: Any, value_type: str) -> str | None:
    """Why a value does not fit its type, or None; digit text is its number, null never fits."""
    if value is not None and value_type in NUMBER_TYPES:
        problem = number_value_problem(value, cast(NumberType, value_type))
        return None if problem is None else problem.reason
    if value is not None and VALUE_TYPE_CHECKS[value_type](value):
        return None
    return f"is not a valid {value_type}"


def _typed_problems(item: Mapping[str, Any], name: str, value_type: str) -> list[tuple[str, str]]:
    """The per-value rules, checked only when the enum's type is a valid value type."""
    problems: list[tuple[str, str]] = []
    allowed = item.get("enumValues")
    listed: list[Any] = allowed if isinstance(allowed, list) else []
    realized: list[Any] = []
    repeated: list[Any] = []
    for value in listed:
        misfit = _misfit(value, value_type)
        if misfit is not None:
            problems.append(
                (
                    "ENUM_VALUE_TYPE",
                    f"Allowed value '{_text(value)}' of enum input '{name}' {misfit}",
                )
            )
            continue
        if value == "":
            problems.append(("ENUM_VALUE_EMPTY", f"Enum input '{name}' has an empty allowed value"))
            continue
        realized_value = realize_declared_value(value, value_type)
        if realized_value not in realized:
            realized.append(realized_value)
        elif realized_value not in repeated:
            repeated.append(realized_value)
            problems.append(
                (
                    "ENUM_VALUE_REPEATED",
                    f"Allowed value '{_text(value)}' of enum input '{name}' "
                    "is listed more than once",
                )
            )
    default = item.get("default")
    if default is None:
        return problems
    fits = _misfit(default, value_type) is None
    if not fits or realize_declared_value(default, value_type) not in realized:
        problems.append(
            (
                "ENUM_DEFAULT_NOT_ALLOWED",
                f"Default '{_text(default)}' of enum input '{name}' "
                "is not one of its allowed values",
            )
        )
    return problems


def _enum_problems(item: Mapping[str, Any], name: str) -> list[tuple[str, str]]:
    problems: list[tuple[str, str]] = []
    value_type = item.get("type")
    if value_type not in ENUM_VALUE_TYPES:
        problems.append(
            ("ENUM_INPUT_TYPE", f"Enum input '{name}' must be of type string, integer or float")
        )
    if not item.get("required"):
        problems.append(("ENUM_INPUT_NOT_REQUIRED", f"Enum input '{name}' must be required"))
    allowed = item.get("enumValues")
    if not isinstance(allowed, list) or not allowed:
        problems.append(("ENUM_INPUT_EMPTY", f"Enum input '{name}' has no allowed values"))
    if item.get("default") is None:
        problems.append(
            (
                "ENUM_INPUT_NO_DEFAULT",
                f"Enum input '{name}' needs a default from its allowed values",
            )
        )
    if value_type in ENUM_VALUE_TYPES:
        problems.extend(_typed_problems(item, name, str(value_type)))
    if item.get("secret"):
        problems.append(("SECRET_ENUM_INPUT", f"Input '{name}' cannot be both secret and an enum"))
    return problems


def input_problems(item: Mapping[str, Any]) -> list[tuple[str, str]]:
    """Every declaration rule one input breaks, as ``(code, message)`` pairs."""
    name = str(item.get("name"))
    if is_enum_input(item):
        return _enum_problems(item, name)
    needs_default = (
        item.get("type") == "boolean" and not item.get("secret") and item.get("default") is None
    )
    if needs_default:
        return [("BOOLEAN_INPUT_NO_DEFAULT", f"Boolean input '{name}' needs a default")]
    return []


def _is_source(entry: Mapping[str, Any]) -> bool:
    """An Expression, Template or computed declaration holds source text, not a literal."""
    return bool(entry.get("isExpression") or entry.get("isTemplate") or entry.get("computed"))


def _value_key(kind: DeclarationKind) -> str:
    return "default" if kind in ("input", "output") else "value"


def declared_value_of(entry: Mapping[str, Any], value_key: str) -> ValueProblem | None:
    """How a declaration's literal breaks the number rule; an Expression or Template is source."""
    if _is_source(entry):
        return None
    return declared_value_problem(
        entry.get(value_key), str(entry.get("type") or ""), entry.get("elementTypes")
    )


def value_problems(
    entry: Mapping[str, Any], name: str, *, kind: DeclarationKind
) -> list[tuple[str, str]]:
    """The number-rule problem of a declaration's value: a variable's or local's value, an
    input's or output's default; an enum input's default is left to the enum rules."""
    if kind == "input" and is_enum_input(entry):
        return []
    problem = declared_value_of(entry, _value_key(kind))
    if problem is None:
        return []
    return [("INVALID_VARIABLE_VALUE", problem.describe(f"{_VALUE_SUBJECTS[kind]} '{name}'"))]


def declaration_numbers(
    entry: Mapping[str, Any], *, kind: DeclarationKind, form: NumberForm
) -> dict[str, Any]:
    """A declaration whose value, default or allowed values hold each number written by
    ``form``."""
    written = dict(entry)
    value_type = str(entry.get("type") or "")
    if kind == "input" and is_enum_input(entry):
        listed = entry.get("enumValues")
        if isinstance(listed, list):
            written["enumValues"] = [form(value, (value_type,)) for value in listed]
        if "default" in entry:
            written["default"] = form(entry["default"], (value_type,))
        return written
    key = _value_key(kind)
    if key in entry and not _is_source(entry):
        written[key] = typed_value_numbers(entry[key], value_type, entry.get("elementTypes"), form)
    return written


def _names(items: Iterable[Mapping[str, Any]]) -> list[str]:
    return [item["name"] for item in items if isinstance(item.get("name"), str)]


def name_collisions(
    inputs: Iterable[Mapping[str, Any]],
    outputs: Iterable[Mapping[str, Any]],
    local_names: Iterable[str],
) -> list[tuple[str, str]]:
    """Names one Function declares twice across its inputs, outputs and local variables."""
    lists = {
        "input": _names(inputs),
        "output": _names(outputs),
        "local": list(local_names),
    }
    problems: list[tuple[str, str]] = []
    for first, second in (("input", "output"), ("input", "local"), ("output", "local")):
        others = set(lists[second])
        for name in dict.fromkeys(lists[first]):
            if name in others:
                problems.append(
                    (
                        "DUPLICATE_PARAMETER_NAME",
                        f"Function declares '{name}' as both {_KIND_LABELS[first]} "
                        f"and {_KIND_LABELS[second]}",
                    )
                )
    seen: set[str] = set()
    repeated: dict[str, None] = {}
    for name in lists["local"]:
        if name in seen:
            repeated[name] = None
        seen.add(name)
    problems.extend(
        ("DUPLICATE_VARIABLE_NAME", f"Function declares local variable '{name}' more than once")
        for name in repeated
    )
    return problems


def name_reason(name: str, *, parameter: bool = False) -> tuple[str, str] | None:
    """Why a declared name is refused, as ``(code, reason)``, or None."""
    pattern = PARAMETER_NAME_PATTERN if parameter else VARIABLE_NAME_PATTERN
    if re.fullmatch(pattern, name) is None:
        return "INVALID_VARIABLE", f"must match {pattern}"
    if len(name) > MAX_NAME_LENGTH:
        return "INVALID_VARIABLE", f"must be {MAX_NAME_LENGTH} characters or fewer"
    if keyword.iskeyword(name):
        return "INVALID_VARIABLE", "a Python keyword"
    if name in RESERVED_VARIABLE_NAMES:
        return "RESERVED_VARIABLE_NAME", f"reserved for namespace access; use {name}.field_name"
    return None


def declaration_problems(
    name: str, declared_type: Any, element_types: Any, *, kind: DeclarationKind
) -> list[tuple[str, str]]:
    """Every rule one declaration breaks: its name, its type and its element types."""
    noun = _NOUNS[kind]
    problems: list[tuple[str, str]] = []
    refused = name_reason(name, parameter=kind in ("input", "output"))
    if refused is not None:
        code, reason = refused
        problems.append((code, f"Invalid {noun} name: '{name}' ({reason})"))
    if declared_type and declared_type not in DECLARED_TYPES:
        listed = ", ".join(DECLARED_TYPES)
        problems.append(
            (
                "INVALID_VARIABLE_TYPE",
                f"Invalid {noun} type: '{declared_type}' (must be one of: {listed})",
            )
        )
    problem = element_types_problem(declared_type, element_types)
    if problem is not None:
        problems.append(
            ("INVALID_ELEMENT_TYPES", f"Invalid element types for {noun} '{name}': {problem}")
        )
    return problems
