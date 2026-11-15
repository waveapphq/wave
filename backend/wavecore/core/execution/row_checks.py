"""The save-time checks of what a Block keeps outside its field list.

Variable Setter rows, condition items, the keys of items, branches and lanes, control structure
and table column indexes
(REQ-3.1.3.14, REQ-3.4.1.14, REQ-3.5.1.5, REQ-3.5.0.3, REQ-3.5.5.4).
"""

from __future__ import annotations

import copy
from collections.abc import Collection, Iterator, Mapping
from typing import Any, cast

from wavecore.controls.assertion_evaluator import (
    CHECK_OPERATORS,
    NULL_OPERATORS,
    UNARY_OPERATORS,
    compare_to_number,
    compare_to_problem,
    compare_to_type,
    compared_subject,
    condition_join_problems,
    drop_unused_compare_to,
)
from wavecore.controls.registry import get_control_implementation
from wavecore.core.execution.field_checks import (
    FieldFinding,
    both_marks_finding,
    is_blank_expression,
    setting_type_finding,
)
from wavecore.core.execution.plugin_executor import VALUE_TYPE_CHECKS
from wavecore.core.table import ColumnType, filter_operator_problem
from wavecore.core.table_values import realizes_as_table
from wavecore.core.variables.usage import condition_lists, iter_condition_items
from wavecore.core.variables.value_checks import (
    NUMBER_TYPES,
    NumberForm,
    declared_value_problem,
    holds_no_literal,
    number_value_problem,
    typed_value_numbers,
)
from wavecore.models.enums import ControlId

_SETTER = "variable-setter"
_ITEM_TYPES = frozenset({"literal", "expression", "group", "operator"})
# The keys each kept shape holds; the save refuses any other one (REQ-3.5.0.3).
_ITEM_KEYS: dict[str, frozenset[str]] = {
    "literal": frozenset(
        {"id", "type", "variable", "value_type", "operator"}
        | {"reference_value", "reference_is_expression", "reference_is_template"}
    ),
    "expression": frozenset({"id", "type", "expression"}),
    "group": frozenset({"id", "type", "items"}),
    "operator": frozenset({"type", "value"}),
}
BRANCH_KEYS = frozenset({"id", "type", "label", "conditions", "break"})
LANE_KEYS = frozenset({"id", "name", "time_limit"})
_BRANCH_LIST_KEYS = {"if-else": BRANCH_KEYS, "switch-case": BRANCH_KEYS, "parallel": LANE_KEYS}


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _rows(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _texts(value: Any) -> set[str]:
    return {item for item in _rows(value) if isinstance(item, str)}


def _sources(data: Mapping[str, Any]) -> set[str]:
    """The places a Block holds as an Expression or a Template."""
    return _texts(data.get("expressionFields")) | _texts(data.get("templateFields"))


def _article(word: str) -> str:
    return "an" if word[:1] in "aeiou" else "a"


def template_row_text(row: str, declared: str) -> str:
    """A Template Setter row on a variable whose type is not string."""
    return (
        f"Row '{row}' sets {_article(declared)} {declared} variable; "
        "a template builds text, so it needs a string variable"
    )


def template_entry_text(key: str, row: str, entry_type: str) -> str:
    """A Template entry of a Setter row whose element type is not string."""
    return (
        f"Entry '{key}' of row '{row}' is {entry_type}; "
        "a template builds text, so it needs element type string"
    )


def template_compare_text(subject: str, compared: str) -> str:
    """A Template compare-to value on a compare whose type is not string."""
    return f"{subject} is {compared}; a template builds text, so it needs type string"


def _missing(field: str) -> FieldFinding:
    return FieldFinding(
        "REQUIRED_PARAM_MISSING", f"Required parameter '{field}' is missing", None, field
    )


def _empty(field: str) -> FieldFinding:
    return FieldFinding(
        "REQUIRED_PARAM_EMPTY", f"Required parameter '{field}' is empty", None, field
    )


def _block_values(data: Mapping[str, Any]) -> Mapping[str, Any]:
    return _mapping(_mapping(data.get("config")).get("values"))


# --- Variable Setter rows -------------------------------------------------------------------


def _setter_rows(data: Mapping[str, Any], values: Mapping[str, Any]) -> Mapping[str, Any]:
    rows = values.get("variables")
    return rows if data.get("elementType") == _SETTER and isinstance(rows, Mapping) else {}


def _entry_keys(value: Any) -> Iterator[tuple[str, Any]]:
    """Each entry of a list or map row: its key (a list index as text) and its value."""
    if isinstance(value, list):
        yield from ((str(index), item) for index, item in enumerate(value))
    elif isinstance(value, Mapping):
        yield from ((str(key), item) for key, item in value.items())


def _entries_as_null(place: str, value: Any, sources: Collection[str]) -> Any:
    """A list or map row whose Expression and Template entries read as null."""
    if isinstance(value, list):
        return [None if f"{place}.{index}" in sources else item for index, item in enumerate(value)]
    if isinstance(value, Mapping):
        return {key: None if f"{place}.{key}" in sources else item for key, item in value.items()}
    return value


def _entries_kept(place: str, written: Any, given: Any, sources: Collection[str]) -> Any:
    """Written entries, each Expression or Template entry kept as given."""
    if isinstance(written, list) and isinstance(given, list):
        return [
            given[index] if f"{place}.{index}" in sources else item
            for index, item in enumerate(written)
        ]
    if isinstance(written, dict) and isinstance(given, Mapping):
        return {
            key: given[key] if f"{place}.{key}" in sources else item
            for key, item in written.items()
        }
    return written


def _entry_type(entry_types: Any, key: str) -> Any:
    if isinstance(entry_types, Mapping):
        return entry_types.get(key)
    if isinstance(entry_types, list) and key.isdigit() and int(key) < len(entry_types):
        return entry_types[int(key)]
    return None


def _fits(declared: str, value: Any) -> bool:
    """Whether a row literal is a value of its variable's type; a file name is never a table."""
    if declared == "table":
        return realizes_as_table(value)
    check = VALUE_TYPE_CHECKS.get(declared)
    return check is None or check(value)


def _literal_row_finding(
    name: str, place: str, literal: Any, declared: str, entry_types: Any, block_id: str
) -> FieldFinding | None:
    if holds_no_literal(literal):
        return None
    if declared not in NUMBER_TYPES and not _fits(declared, literal):
        return setting_type_finding(place, block_id, declared, literal)
    problem = declared_value_problem(literal, declared, entry_types)
    if problem is None:
        return None
    return FieldFinding(
        "INVALID_VARIABLE_VALUE",
        problem.describe(f"Value for variable '{name}'"),
        problem.fix,
        place,
    )


def _template_entry_findings(
    name: str, place: str, value: Any, entry_types: Any, templates: Collection[str]
) -> Iterator[FieldFinding]:
    for key, _entry in _entry_keys(value):
        entry_type = _entry_type(entry_types, key)
        if f"{place}.{key}" in templates and isinstance(entry_type, str) and entry_type != "string":
            yield FieldFinding(
                "TEMPLATE_NOT_STRING",
                template_entry_text(key, name, entry_type),
                None,
                f"{place}.{key}",
            )


def _setter_findings(
    data: Mapping[str, Any], values: Mapping[str, Any], declared_types: Mapping[str, str]
) -> Iterator[FieldFinding]:
    expressions = _texts(data.get("expressionFields"))
    templates = _texts(data.get("templateFields"))
    sources = expressions | templates
    element_types = _mapping(data.get("elementTypes"))
    block_id = str(data.get("elementType"))
    for name, value in _setter_rows(data, values).items():
        place = f"variables.{name}"
        declared = declared_types.get(str(name))
        if place in templates:
            if declared and declared != "string":
                yield FieldFinding(
                    "TEMPLATE_NOT_STRING",
                    template_row_text(name, declared),
                    None,
                    place,
                )
            continue
        if place in expressions:
            continue
        entry_types = element_types.get(place)
        if declared:
            literal = _entries_as_null(place, value, sources)
            found = _literal_row_finding(name, place, literal, declared, entry_types, block_id)
            if found is not None:
                yield found
        yield from _template_entry_findings(name, place, value, entry_types, templates)


# --- Condition items ------------------------------------------------------------------------


def _vocabulary_finding(row: Mapping[str, Any], at: str, operator: Any) -> FieldFinding | None:
    """A control item's value type and operator, refused with the run's own texts."""
    if operator in NULL_OPERATORS:
        return None
    value_type = row.get("value_type", "")
    if not isinstance(value_type, str) or value_type not in CHECK_OPERATORS:
        message = f"Unknown value type: '{value_type}'"
        return FieldFinding("INVALID_CONDITION", message, None, f"{at}.value_type")
    if operator not in CHECK_OPERATORS[value_type]:
        message = f"Unknown operator '{operator}' for type '{value_type}'"
        return FieldFinding("INVALID_CONDITION", message, None, f"{at}.operator")
    return None


def _compare_to_finding(row: Mapping[str, Any], at: str) -> FieldFinding | None:
    """The one problem of a compare-to value whose operator takes one."""
    field = f"{at}.reference_value"
    subject = compared_subject(row)
    is_expression = bool(row.get("reference_is_expression"))
    is_template = bool(row.get("reference_is_template"))
    compared = compare_to_type(row)
    if is_expression and is_template:
        return both_marks_finding(subject, field, "INVALID_CONDITION")
    if is_template and compared in NUMBER_TYPES:
        message = template_compare_text(subject, compared)
        return FieldFinding("TEMPLATE_NOT_STRING", message, None, field)
    reference = row.get("reference_value")
    if reference is None:
        return _missing(field)
    # Literal text typed on a text compare is a value, empty text too (FIELD-4).
    flagged = is_expression or is_template
    if (flagged or compared != "string") and is_blank_expression(reference):
        return _empty(field)
    problem = compare_to_problem(row)
    if problem is None:
        return None
    return FieldFinding("INVALID_COMPARE_VALUE", problem.describe(subject), problem.fix, field)


def _filter_operator_finding(
    at: str, operator: Any, column_type: ColumnType | None
) -> FieldFinding | None:
    """A filter item's operator, held to its column's type with the run's own text."""
    if column_type is None:
        return None
    problem = filter_operator_problem(column_type, operator)
    if problem is None:
        return None
    return FieldFinding("INVALID_CONDITION", problem, None, f"{at}.operator")


def _literal_findings(
    row: Mapping[str, Any], at: str, in_filter: bool, column_type: ColumnType | None
) -> Iterator[FieldFinding]:
    variable = row.get("variable")
    if variable is None:
        yield _missing(f"{at}.variable")
    elif isinstance(variable, str) and not variable.strip():
        yield _empty(f"{at}.variable")
    operator = row.get("operator")
    if operator is None:
        yield _missing(f"{at}.operator")
        return
    refused = (
        _filter_operator_finding(at, operator, column_type)
        if in_filter
        else _vocabulary_finding(row, at, str(operator))
    )
    if refused is not None:
        yield refused
        return
    if not isinstance(operator, str) or operator in UNARY_OPERATORS:
        return
    found = _compare_to_finding(row, at)
    if found is not None:
        yield found


def _item_findings(
    row: Mapping[str, Any], at: str, in_filter: bool, column_type: ColumnType | None
) -> Iterator[FieldFinding]:
    kind = row.get("type")
    if kind is None:
        yield _missing(f"{at}.type")
    elif not isinstance(kind, str) or kind not in _ITEM_TYPES:
        message = f"Unknown assertion item type: '{kind}'"
        yield FieldFinding("INVALID_CONDITION", message, None, f"{at}.type")
    elif kind == "expression":
        expression = row.get("expression")
        if expression is None:
            yield _missing(f"{at}.expression")
        elif is_blank_expression(expression):
            yield _empty(f"{at}.expression")
    elif kind == "group":
        if not _rows(row.get("items")):
            yield _empty(f"{at}.items")
    elif kind == "literal":
        yield from _literal_findings(row, at, in_filter, column_type)


def _filter_column_type(values: Mapping[str, Any], place: tuple[str, ...]) -> ColumnType | None:
    """The type a filter reads its column's cells as; None while its asType names none."""
    holder = _mapping(_rows(values.get(place[0]))[int(place[1])])
    try:
        return ColumnType(holder.get("asType"))
    except ValueError:
        return None


def _condition_findings(values: Mapping[str, Any]) -> Iterator[FieldFinding]:
    for row, place, in_filter in iter_condition_items(values):
        column_type = _filter_column_type(values, place) if in_filter else None
        yield from _item_findings(row, ".".join(place), in_filter, column_type)
    for items, place, _in_filter in condition_lists(values):
        yield from condition_join_problems(items, ".".join(place))


# --- Shape keys -----------------------------------------------------------------------------


def _unknown_keys(
    block_id: str, place: str, record: Mapping[str, Any], keys: frozenset[str]
) -> Iterator[FieldFinding]:
    for key in record:
        if key not in keys:
            at = f"{place}.{key}"
            message = f"Block '{block_id}' has no setting '{at}'"
            yield FieldFinding(
                "UNKNOWN_SETTING", message, f"Valid keys: {', '.join(sorted(keys))}", at
            )


def _shape_key_findings(
    data: Mapping[str, Any], values: Mapping[str, Any]
) -> Iterator[FieldFinding]:
    """Each key a condition item, branch or lane holds that its shape does not, at any depth."""
    block_id = str(data.get("elementType"))
    for row, place, _in_filter in iter_condition_items(values):
        kind = row.get("type")
        keys = _ITEM_KEYS.get(kind) if isinstance(kind, str) else None
        if keys is not None:
            yield from _unknown_keys(block_id, ".".join(place), row, keys)
    branch_keys = _BRANCH_LIST_KEYS.get(block_id)
    if branch_keys is not None:
        for index, branch in enumerate(_rows(values.get("branches"))):
            yield from _unknown_keys(block_id, f"branches.{index}", _mapping(branch), branch_keys)


# --- Control structure ----------------------------------------------------------------------


def _structure_findings(data: Mapping[str, Any], values: Mapping[str, Any]) -> list[FieldFinding]:
    try:
        control_id = ControlId(data.get("elementType"))
    except ValueError:
        return []
    control = get_control_implementation(control_id, str(data.get("version") or "1.0.0"))
    if control is None:
        return []
    return control().structure_problems(values, _sources(data))


# --- Column indexes -------------------------------------------------------------------------


def _index_columns(values: Mapping[str, Any]) -> Iterator[tuple[dict[str, Any], str]]:
    """Each sort or filter column picked by index, with the place of its value."""
    for key in ("sorts", "filters"):
        for index, item in enumerate(_rows(values.get(key))):
            column = _mapping(item).get("column")
            if isinstance(column, dict) and column.get("mode") == "index":
                yield column, f"{key}.{index}.column.value"


def _column_findings(values: Mapping[str, Any]) -> Iterator[FieldFinding]:
    for column, at in _index_columns(values):
        problem = number_value_problem(column.get("value"), "integer")
        if problem is not None:
            yield FieldFinding(
                "INVALID_COLUMN_INDEX",
                problem.describe(f"Column index '{column.get('value')}'"),
                problem.fix,
                at,
            )


def block_row_findings(
    data: Mapping[str, Any], declared_types: Mapping[str, str]
) -> list[FieldFinding]:
    """Every problem of the Setter rows, condition items, shape keys, control structure and
    column indexes a Block keeps outside its field list; a Setter row is held to its variable's
    declared type."""
    values = _block_values(data)
    return [
        *_setter_findings(data, values, declared_types),
        *_condition_findings(values),
        *_shape_key_findings(data, values),
        *_structure_findings(data, values),
        *_column_findings(values),
    ]


def _store_compare_to(row: dict[str, Any], form: NumberForm) -> None:
    """A literal row's compare-to number written by ``form``; one its operator does not take
    is dropped (REQ-3.5.1.5)."""
    drop_unused_compare_to(row)
    if (
        row.get("type") == "literal"
        and isinstance(row.get("operator"), str)
        and "reference_value" in row
    ):
        row["reference_value"] = compare_to_number(row, form)


def literal_row_numbers(
    data: Mapping[str, Any], form: NumberForm, declared_types: Mapping[str, str]
) -> dict[str, Any]:
    """A copy of a Block's values with each number ``block_row_findings`` reads written by
    ``form``; a condition row whose operator takes no value keeps no compare-to value."""
    values = copy.deepcopy(dict(_block_values(data)))
    sources = _sources(data)
    element_types = _mapping(data.get("elementTypes"))
    # The values are a copy of stored JSON, so the rows map is a dict.
    rows = cast(dict[str, Any], _setter_rows(data, values))
    for name, given in rows.items():
        place = f"variables.{name}"
        declared = declared_types.get(str(name))
        if place in sources or not declared:
            continue
        written = typed_value_numbers(given, declared, element_types.get(place), form)
        rows[name] = _entries_kept(place, written, given, sources)
    for row, _place, _in_filter in iter_condition_items(values):
        if isinstance(row, dict):
            _store_compare_to(row, form)
    for column, _at in _index_columns(values):
        if "value" in column:
            column["value"] = form(column["value"], ("integer",))
    return values
