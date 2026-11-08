"""The one save-time field check every Block shares: plugin, control and Function Block.

REQ-3.1.1.5, REQ-3.1.2.4, REQ-3.1.2.11, REQ-3.4.2.2, REQ-3.5.0.3.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, cast

from wavecore.core.execution.plugin_executor import VALUE_TYPE_CHECKS
from wavecore.core.number_rule import (
    NumberType,
    is_number_value,
    not_finite_name,
    number_problem,
    parse_number,
    plain_number_text,
)
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.table import Table
from wavecore.core.table_values import as_table
from wavecore.core.variables.element_types import realize_declared_value
from wavecore.core.variables.value_checks import (
    NUMBER_TYPES,
    NumberForm,
    ValueProblem,
    declared_value_problem,
    number_value_problem,
    typed_value_numbers,
)
from wavecore.models.plugins import get_param_attr, is_param_required


@dataclass(frozen=True)
class FieldFinding:
    """One field problem; each surface wraps it into its own finding shape."""

    code: str
    message: str
    fix: str | None
    field: str


def is_blank_expression(text: Any) -> bool:
    """An expression with no source text: nothing, empty or only spaces."""
    return text is None or (isinstance(text, str) and not text.strip())


def type_name(value: Any) -> str:
    """The value-type word a finding names for a stored value."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float | Decimal):
        return "float" if is_number_value(value) else not_finite_name(value)
    if isinstance(value, str):
        return "string"
    if isinstance(value, Table):
        return "table"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "map"
    return type(value).__name__


def _declared_types(field: Any) -> list[str]:
    declared = get_param_attr(field, "type")
    listed = declared if isinstance(declared, list) else [declared]
    return [str(item) for item in listed if item]


def _realized_table(value: Any) -> Table | None:
    try:
        return as_table(value)
    except (KeyError, TypeError, ValueError):
        return None


def _fits(declared: str, value: Any) -> bool:
    if declared in NUMBER_TYPES:
        # Digit text is the number it stands for (REQ-3.1.3.14).
        return number_problem(value, cast(NumberType, declared)) is None
    check = VALUE_TYPE_CHECKS.get(declared)
    if check is None:
        return True
    if declared == "table":
        # A table field may name a CSV or Excel file instead of holding rows (SQL-7).
        return isinstance(value, str) or _realized_table(value) is not None
    return check(value)


def _is_empty(value: Any, declared: Sequence[str]) -> bool:
    """The Test save's empty rule; a value of another type counts as set."""
    if isinstance(value, str):
        return not value.strip()
    if "table" in declared:
        table = _realized_table(value)
        if table is not None:
            return len(table) == 0
    if isinstance(value, list | dict):
        return len(value) == 0
    return False


def _is_skipped(field: Any, value: Any) -> bool:
    """Null, a picked variable name, a sealed secret and the mask are not literals to check."""
    if value is None:
        return True
    if isinstance(value, str) and get_param_attr(field, "variable_ref", False):
        return True
    return is_secret_envelope(value) or value == MASK_PLACEHOLDER


def _allowed_value_finding(
    field: Any, name: str, value: Any, declared: Sequence[str], block_id: str
) -> FieldFinding | None:
    allowed = get_param_attr(field, "enum_values")
    if not allowed:
        return None
    value_type = declared[0] if len(declared) == 1 else ""
    realized = list(allowed)
    if value_type in NUMBER_TYPES:
        value = realize_declared_value(value, value_type)
        realized = [realize_declared_value(item, value_type) for item in allowed]
    if value in realized:
        return None
    listed = ", ".join(str(item) for item in allowed)
    return FieldFinding(
        "INVALID_ENUM_VALUE",
        f"Setting '{name}' of block '{block_id}' must be one of: {listed}",
        "Use one of the listed values",
        name,
    )


def _exact(value: int | float | Decimal) -> int | Decimal:
    """A number as its exact value; a float by the literal it prints as."""
    return value if isinstance(value, int) else Decimal(plain_number_text(value))


def _exact_number(value: Any, declared: Sequence[str]) -> int | Decimal | None:
    """The exact number a literal holds for its bounds, or None when it holds none."""
    if isinstance(value, str):
        if "string" in declared:
            return None
        number_type = next(
            (item for item in declared if item in NUMBER_TYPES and _fits(item, value)), None
        )
        return None if number_type is None else parse_number(value, cast(NumberType, number_type))
    return _exact(value) if is_number_value(value) else None


def _bound_findings(
    field: Any, name: str, value: Any, declared: Sequence[str], block_id: str
) -> Iterator[FieldFinding]:
    exact = _exact_number(value, declared)
    if exact is None:
        return
    shown = value if isinstance(value, str) else plain_number_text(value)
    minimum = get_param_attr(field, "minimum")
    if minimum is not None and exact < _exact(minimum):
        yield FieldFinding(
            "SETTING_BELOW_MINIMUM",
            f"Setting '{name}' of block '{block_id}' must be at least {minimum}, got {shown}",
            f"Provide a value of at least {minimum}",
            name,
        )
    maximum = get_param_attr(field, "maximum")
    if maximum is not None and exact > _exact(maximum):
        yield FieldFinding(
            "SETTING_ABOVE_MAXIMUM",
            f"Setting '{name}' of block '{block_id}' must be at most {maximum}, got {shown}",
            f"Provide a value of at most {maximum}",
            name,
        )


def _setting_finding(problem: ValueProblem, name: str, block_id: str) -> FieldFinding:
    """A number-rule problem of a setting or of one of its entries."""
    code = "INVALID_SETTING_TYPE" if problem.problem == "type" else "SETTING_TOO_MANY_DIGITS"
    return FieldFinding(
        code, problem.describe(f"Setting '{name}' of block '{block_id}'"), problem.fix, name
    )


def _digit_cap_finding(
    name: str, value: Any, declared: Sequence[str], block_id: str
) -> FieldFinding | None:
    """A number of a declared number type with more digits than that type allows."""
    for item in declared:
        if item not in NUMBER_TYPES:
            continue
        problem = number_value_problem(value, cast(NumberType, item))
        if problem is not None and problem.problem != "type":
            return _setting_finding(problem, name, block_id)
    return None


def _entries_kind(declared: Sequence[str], value: Any) -> str | None:
    """The typed-entry shape a setting's literal holds: a list, a table or a map."""
    if isinstance(value, list):
        return "array" if "array" in declared else None
    if isinstance(value, dict):
        return next((kind for kind in ("table", "map") if kind in declared), None)
    return None


def _literal_entries(name: str, value: Any, sources: Collection[str]) -> Any:
    """A list or map whose Expression and Template entries read as null, which fits any type."""
    if isinstance(value, list):
        return [None if f"{name}.{index}" in sources else item for index, item in enumerate(value)]
    return {key: None if f"{name}.{key}" in sources else item for key, item in value.items()}


def _entry_finding(
    name: str,
    value: Any,
    declared: Sequence[str],
    *,
    block_id: str,
    element_types: Any,
    sources: Collection[str],
) -> FieldFinding | None:
    """The first typed list item, map value or table cell of a setting that breaks the rule."""
    kind = _entries_kind(declared, value)
    if kind is None:
        return None
    problem = declared_value_problem(_literal_entries(name, value, sources), kind, element_types)
    return None if problem is None else _setting_finding(problem, name, block_id)


def _element_type_map(element_types: Any) -> Mapping[str, Any]:
    """A Block's element types by setting name; any other shape holds none."""
    return element_types if isinstance(element_types, Mapping) else {}


def check_field_value(
    field: Any,
    name: str,
    value: Any,
    *,
    block_id: str,
    element_types: Any = None,
    entry_sources: Collection[str] = (),
) -> list[FieldFinding]:
    """Type, allowed values, bounds and typed entries of one literal value."""
    if _is_skipped(field, value):
        return []
    declared = _declared_types(field)
    if (
        declared
        and not get_param_attr(field, "accepts_any_type", False)
        and not any(_fits(item, value) for item in declared)
    ):
        too_many_digits = _digit_cap_finding(name, value, declared, block_id)
        if too_many_digits is not None:
            return [too_many_digits]
        expected = " or ".join(declared)
        return [
            FieldFinding(
                "INVALID_SETTING_TYPE",
                f"Setting '{name}' of block '{block_id}' expects {expected}, "
                f"got {type_name(value)}",
                f"Provide {'an' if expected[0] in 'aeiou' else 'a'} {expected} value",
                name,
            )
        ]
    findings: list[FieldFinding] = []
    not_allowed = _allowed_value_finding(field, name, value, declared, block_id)
    if not_allowed is not None:
        findings.append(not_allowed)
    findings.extend(_bound_findings(field, name, value, declared, block_id))
    if not findings:
        entry = _entry_finding(
            name,
            value,
            declared,
            block_id=block_id,
            element_types=element_types,
            sources=entry_sources,
        )
        findings.extend([] if entry is None else [entry])
    return findings


def _required_finding(
    field: Any,
    name: str,
    values: Mapping[str, Any],
    fields: Sequence[Any],
    expression_fields: Collection[str],
) -> FieldFinding | None:
    if not is_param_required(field, values, fields):
        return None
    value = values.get(name)
    is_expression = name in expression_fields
    unset = value is None or (is_expression and is_blank_expression(value))
    if unset and get_param_attr(field, "default") is not None:
        return None
    if value is None:
        return FieldFinding(
            "REQUIRED_PARAM_MISSING", f"Required parameter '{name}' is missing", None, name
        )
    declared = ["string"] if is_expression else _declared_types(field)
    if _is_empty(value, declared):
        return FieldFinding(
            "REQUIRED_PARAM_EMPTY", f"Required parameter '{name}' is empty", None, name
        )
    return None


def _entry_slots(name: str, value: Any) -> Iterator[tuple[str, Any, str]]:
    """Each map value or list row of a field: its flag key, its text and how it is named."""
    if isinstance(value, dict):
        for key, entry in value.items():
            yield f"{name}.{key}", entry, f"'{key}' in '{name}'"
    elif isinstance(value, list):
        for index, item in enumerate(value):
            is_row = isinstance(item, dict)
            key = f"{name}.{index}.value" if is_row else f"{name}.{index}"
            yield key, item.get("value") if is_row else item, f"Row {index + 1} in '{name}'"


def _blank_entry_findings(
    name: str, value: Any, expression_fields: Collection[str]
) -> Iterator[FieldFinding]:
    """A blank {x} map value or list row has no default to fall back on (FIELD-6)."""
    for key, text, named in _entry_slots(name, value):
        if key in expression_fields and is_blank_expression(text):
            yield FieldFinding("REQUIRED_PARAM_EMPTY", f"{named} is required", None, key)


def required_findings(
    fields: Sequence[Any], values: Mapping[str, Any], *, expression_fields: Collection[str]
) -> list[FieldFinding]:
    """The required rule alone: a required field with no value, or an empty one."""
    findings: list[FieldFinding] = []
    for field in fields:
        name = str(get_param_attr(field, "name", ""))
        found = _required_finding(field, name, values, fields, expression_fields)
        if found is not None:
            findings.append(found)
    return findings


def unknown_field_findings(
    fields: Sequence[Any], names: Iterable[Any], *, block_id: str
) -> list[FieldFinding]:
    """One finding per given name the Block does not declare."""
    declared_names = [str(get_param_attr(field, "name", "")) for field in fields]
    valid = ", ".join(sorted(declared_names))
    return [
        FieldFinding(
            "UNKNOWN_SETTING",
            f"Block '{block_id}' has no setting '{name}'",
            f"Valid settings: {valid}",
            str(name),
        )
        for name in names
        if str(name) not in declared_names
    ]


def _is_literal(
    name: str,
    values: Mapping[str, Any],
    expression_fields: Collection[str],
    template_fields: Collection[str],
) -> bool:
    """A set field that is neither an Expression nor a Template."""
    return name in values and name not in expression_fields and name not in template_fields


def name_rule_refusal(rule: Mapping[str, Any], item: Any) -> str | None:
    """The rule's message for a name, or None: the pattern in full as ASCII, then the prefixes."""
    if not (isinstance(item, str) and re.fullmatch(rule["pattern"], item, re.ASCII)):
        message = rule["message"]
    else:
        blocked = rule.get("blocked_prefixes", ())
        message = next((b["message"] for b in blocked if item.startswith(b["prefix"])), None)
    return None if message is None else message.replace("{name}", str(item))


def _name_findings(field: Any, name: str, value: Any) -> Iterator[FieldFinding]:
    """Each map key or list item the field's name rule refuses."""
    rule = get_param_attr(field, "name_rule")
    if rule is None or not isinstance(value, dict | list):
        return
    for item in value:
        message = name_rule_refusal(rule, item)
        if message is not None:
            yield FieldFinding("INVALID_NAME", message, None, name)


def check_block_fields(
    fields: Sequence[Any],
    values: Mapping[str, Any],
    *,
    block_id: str,
    expression_fields: Collection[str],
    template_fields: Collection[str],
    check_required: bool,
    element_types: Any = None,
) -> list[FieldFinding]:
    """Every field problem of one Block's stored values against its declared fields."""
    findings: list[FieldFinding] = []
    declared_names: list[str] = []
    types = _element_type_map(element_types)
    sources = {*expression_fields, *template_fields}
    for field in fields:
        name = str(get_param_attr(field, "name", ""))
        declared_names.append(name)
        required = (
            _required_finding(field, name, values, fields, expression_fields)
            if check_required
            else None
        )
        if required is not None:
            findings.append(required)
            continue
        if _is_literal(name, values, expression_fields, template_fields):
            findings.extend(
                check_field_value(
                    field,
                    name,
                    values[name],
                    block_id=block_id,
                    element_types=types.get(name),
                    entry_sources=sources,
                )
            )
            findings.extend(_name_findings(field, name, values[name]))
    findings.extend(unknown_field_findings(fields, values, block_id=block_id))
    for name in declared_names:
        findings.extend(_blank_entry_findings(name, values.get(name), expression_fields))
    return findings


def _sources_kept(name: str, written: Any, given: Any, sources: Collection[str]) -> Any:
    """Written entries, each Expression or Template entry kept as given."""
    if isinstance(written, list):
        return [
            given[index] if f"{name}.{index}" in sources else item
            for index, item in enumerate(written)
        ]
    return {
        key: given[key] if f"{name}.{key}" in sources else item for key, item in written.items()
    }


def block_value_numbers(
    fields: Sequence[Any],
    values: Mapping[str, Any],
    *,
    expression_fields: Collection[str],
    template_fields: Collection[str],
    element_types: Any,
    form: NumberForm,
) -> dict[str, Any]:
    """A Block's values with each number ``check_block_fields`` reads written by ``form``."""
    written = dict(values)
    types = _element_type_map(element_types)
    sources = {*expression_fields, *template_fields}
    for field in fields:
        name = str(get_param_attr(field, "name", ""))
        if not _is_literal(name, values, expression_fields, template_fields):
            continue
        given = values[name]
        declared = _declared_types(field)
        kind = _entries_kind(declared, given)
        written[name] = (
            form(given, declared)
            if kind is None
            else _sources_kept(
                name, typed_value_numbers(given, kind, types.get(name), form), given, sources
            )
        )
    return written
