"""The save-time number rule for literal rows a Block keeps outside its field list.

Variable Setter value rows, condition compare-to values and table column indexes
(REQ-3.1.3.14, REQ-3.5.5.4).
"""

from __future__ import annotations

import copy
from collections.abc import Iterator, Mapping
from typing import Any

from wavecore.controls.assertion_evaluator import (
    compare_to_number,
    compare_to_problem,
    compared_subject,
)
from wavecore.core.execution.field_checks import FieldFinding
from wavecore.core.variables.value_checks import (
    NumberForm,
    declared_value_problem,
    number_value_problem,
    typed_value_numbers,
)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _rows(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _literal_setter_rows(
    data: Mapping[str, Any], rows: Mapping[str, Any]
) -> list[tuple[str, Any, str, Any]]:
    """Each literal setter row: its name, value, target variable type and element types."""
    sources = {*_rows(data.get("variableExpressionKeys")), *_rows(data.get("variableTemplateKeys"))}
    types = _mapping(data.get("variableTypes"))
    element_types = _mapping(data.get("variableElementTypes"))
    return [
        (name, value, str(types.get(name) or ""), element_types.get(name))
        for name, value in rows.items()
        if name not in sources
    ]


def _setter_findings(data: Mapping[str, Any], values: Mapping[str, Any]) -> Iterator[FieldFinding]:
    for name, value, declared, element_types in _literal_setter_rows(
        data, _mapping(values.get("variables"))
    ):
        problem = declared_value_problem(value, declared, element_types)
        if problem is not None:
            yield FieldFinding(
                "INVALID_VARIABLE_VALUE",
                problem.describe(f"Value for variable '{name}'"),
                problem.fix,
                f"variables.{name}",
            )


def _condition_lists(values: Mapping[str, Any]) -> Iterator[tuple[Any, str]]:
    """Each list of condition rows a Block holds, with its place."""
    for key in ("assertions", "conditions"):
        yield values.get(key), key
    for key in ("branches", "filters"):
        for index, holder in enumerate(_rows(values.get(key))):
            yield _mapping(holder).get("conditions"), f"{key}.{index}.conditions"


def _literal_conditions(items: Any, path: str) -> Iterator[tuple[dict[str, Any], str]]:
    """Each literal condition row at any group depth, with its place."""
    for index, row in enumerate(_rows(items)):
        if not isinstance(row, dict):
            continue
        at = f"{path}.{index}"
        if row.get("type") == "group":
            yield from _literal_conditions(row.get("items"), f"{at}.items")
        elif row.get("type") == "literal":
            yield row, at


def _index_columns(values: Mapping[str, Any]) -> Iterator[tuple[dict[str, Any], str]]:
    """Each sort or filter column picked by index, with the place of its value."""
    for key in ("sorts", "filters"):
        for index, item in enumerate(_rows(values.get(key))):
            column = _mapping(item).get("column")
            if isinstance(column, dict) and column.get("mode") == "index":
                yield column, f"{key}.{index}.column.value"


def _block_values(data: Mapping[str, Any]) -> Mapping[str, Any]:
    return _mapping(_mapping(data.get("config")).get("values"))


def literal_row_findings(data: Mapping[str, Any]) -> list[FieldFinding]:
    """Every literal setter row, compare-to value and column index that breaks the number rule."""
    values = _block_values(data)
    findings = list(_setter_findings(data, values))
    for items, path in _condition_lists(values):
        for row, at in _literal_conditions(items, path):
            problem = compare_to_problem(row)
            if problem is not None:
                findings.append(
                    FieldFinding(
                        "INVALID_COMPARE_VALUE",
                        problem.describe(compared_subject(row)),
                        problem.fix,
                        f"{at}.reference_value",
                    )
                )
    for column, at in _index_columns(values):
        problem = number_value_problem(column.get("value"), "integer")
        if problem is not None:
            findings.append(
                FieldFinding(
                    "INVALID_COLUMN_INDEX",
                    problem.describe(f"Column index '{column.get('value')}'"),
                    problem.fix,
                    at,
                )
            )
    return findings


def literal_row_numbers(data: Mapping[str, Any], form: NumberForm) -> dict[str, Any]:
    """A copy of a Block's values with each number ``literal_row_findings`` reads written by
    ``form``."""
    values = copy.deepcopy(dict(_block_values(data)))
    rows = values.get("variables")
    if isinstance(rows, dict):
        for name, value, declared, element_types in _literal_setter_rows(data, rows):
            rows[name] = typed_value_numbers(value, declared, element_types, form)
    for items, path in _condition_lists(values):
        for row, _at in _literal_conditions(items, path):
            if "reference_value" in row:
                row["reference_value"] = compare_to_number(row, form)
    for column, _at in _index_columns(values):
        if "value" in column:
            column["value"] = form(column["value"], ("integer",))
    return values
