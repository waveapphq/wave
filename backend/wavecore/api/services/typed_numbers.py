"""Each typed number a Test or Function holds, written in one number form (REQ-3.1.3.14); a
condition row keeps no compare-to value its operator does not take (REQ-3.5.1.5)."""

from __future__ import annotations

from collections.abc import Mapping, MutableMapping
from typing import Any

from wavecore.api.services.block_schema import block_schema
from wavecore.core.execution.field_checks import block_value_numbers
from wavecore.core.execution.row_checks import literal_row_numbers
from wavecore.core.functions.declarations import DECLARATION_LISTS, declaration_numbers
from wavecore.core.functions.references import function_holders
from wavecore.core.variables.declared_types import types_of_function
from wavecore.core.variables.usage import scope_blocks
from wavecore.core.variables.value_checks import NumberForm, stored_number


def block_numbers(
    data: Mapping[str, Any], form: NumberForm, declared_types: Mapping[str, str]
) -> dict[str, Any]:
    """A Block's values with each number its fields and literal rows declare written by ``form``;
    a Setter row takes the type its variable declares in ``declared_types``, and a condition
    row whose operator takes no value keeps no compare-to value."""
    return block_value_numbers(
        block_schema(data).fields,
        literal_row_numbers(data, form, declared_types),
        expression_fields=set(data.get("expressionFields") or []),
        template_fields=set(data.get("templateFields") or []),
        element_types=data.get("elementTypes"),
        form=form,
    )


def _store_declaration_numbers(definition: MutableMapping[str, Any]) -> None:
    for key, kind in DECLARATION_LISTS:
        items = definition.get(key)
        if isinstance(items, list):
            definition[key] = [
                (
                    declaration_numbers(item, kind=kind, form=stored_number)
                    if isinstance(item, Mapping)
                    else item
                )
                for item in items
            ]


def store_workflow_numbers(workflow: Any, declared_types: Mapping[str, str]) -> None:
    """Every Block of one scope keeps its typed numbers in wire form, a disabled one too; each
    Function it holds is walked with the types that Function declares."""
    for node in scope_blocks(workflow if isinstance(workflow, Mapping) else {}, include_muted=True):
        data = node.get("data")
        if not isinstance(data, dict):
            continue
        for holder in function_holders({"nodes": [node]}):
            store_definition_numbers(holder)
        config = data.get("config")
        if isinstance(config, dict) and isinstance(config.get("values"), dict):
            config["values"] = block_numbers(data, stored_number, declared_types)


def store_definition_numbers(definition: MutableMapping[str, Any]) -> None:
    """A Function definition's declarations and Blocks keep their typed numbers in wire form."""
    _store_declaration_numbers(definition)
    store_workflow_numbers(
        definition.get("workflow"), types_of_function(definition, every_input=True)
    )
