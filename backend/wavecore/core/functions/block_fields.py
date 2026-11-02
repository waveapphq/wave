"""Declared Function inputs and outputs as the Function Block's fields (VMGR-112, VMGR-113).

REQ-3.1.2.1, REQ-3.1.2.9, REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.1.3.18, REQ-3.1.3.19.
"""

from __future__ import annotations

import copy
from collections.abc import Iterator, Mapping
from typing import Any

from wavecore.core.functions.declarations import is_enum_input
from wavecore.core.variables.element_types import realize_declared_value

_TYPED_VALUE_TYPES = ("array", "map")


def _declared(definition: Mapping[str, Any], key: str) -> Iterator[Mapping[str, Any]]:
    items = definition.get(key)
    for item in items if isinstance(items, list) else []:
        if isinstance(item, Mapping) and isinstance(item.get("name"), str):
            yield item


def _input_field(declared: Mapping[str, Any]) -> dict[str, Any]:
    value_type = str(declared.get("type") or "")
    required = bool(declared.get("required"))
    secret = bool(declared.get("secret"))
    default = declared.get("default")
    # A Required or secret input's default serves only a Function run on its own.
    takes_default = not required and not secret and default is not None
    field: dict[str, Any] = {
        "name": declared["name"],
        "type": value_type,
        "required": required,
        "description": declared.get("description") or "",
        "secret": secret,
        "typed_values": value_type in _TYPED_VALUE_TYPES,
        "accepts_null": not required and not secret and default is None,
    }
    if is_enum_input(declared):
        field["enum_values"] = [
            realize_declared_value(value, value_type) for value in declared["enumValues"] or []
        ]
    if takes_default:
        field["default"] = copy.deepcopy(default)
        element_types = declared.get("elementTypes")
        if value_type in _TYPED_VALUE_TYPES and element_types is not None:
            field["default_element_types"] = copy.deepcopy(element_types)
    return field


def function_block_fields(definition: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The declared inputs as the Function Block's field list, in declared order."""
    return [_input_field(declared) for declared in _declared(definition, "inputs")]


def function_block_outputs(definition: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The declared outputs as the Function Block's output list, in declared order."""
    return [
        {
            "name": declared["name"],
            "type": str(declared.get("type") or ""),
            "description": declared.get("description") or "",
            "secret": bool(declared.get("secret")),
        }
        for declared in _declared(definition, "outputs")
    ]
