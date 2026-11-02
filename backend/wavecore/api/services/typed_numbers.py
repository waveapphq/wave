"""Each typed number a Test or Function holds, written in one number form (REQ-3.1.3.14)."""

from __future__ import annotations

from collections.abc import Mapping, MutableMapping
from typing import Any

from wavecore.api.services.block_schema import block_schema
from wavecore.core.execution.field_checks import block_value_numbers
from wavecore.core.execution.row_checks import literal_row_numbers
from wavecore.core.functions.declarations import DECLARATION_LISTS, declaration_numbers
from wavecore.core.functions.references import function_holders, iter_blocks
from wavecore.core.variables.value_checks import NumberForm, stored_number


def block_numbers(data: Mapping[str, Any], form: NumberForm) -> dict[str, Any]:
    """A Block's values with each number its fields and literal rows declare written by ``form``."""
    return block_value_numbers(
        block_schema(data).fields,
        literal_row_numbers(data, form),
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


def store_workflow_numbers(workflow: Any) -> None:
    """Every Block of a workflow, at any Function depth, keeps its typed numbers in wire form."""
    for node in iter_blocks(workflow):
        data = node.get("data")
        if not isinstance(data, dict):
            continue
        for holder in function_holders({"nodes": [node]}):
            _store_declaration_numbers(holder)
        config = data.get("config")
        if isinstance(config, dict) and isinstance(config.get("values"), dict):
            config["values"] = block_numbers(data, stored_number)


def store_definition_numbers(definition: MutableMapping[str, Any]) -> None:
    """A Function definition's declarations and Blocks keep their typed numbers in wire form."""
    _store_declaration_numbers(definition)
    store_workflow_numbers(definition.get("workflow"))
