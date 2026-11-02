"""The one walker of the Function references a workflow holds (REQ-3.1.2.3, REQ-3.1.2.5)."""

import copy
from collections.abc import Iterator, Mapping, MutableMapping
from dataclasses import dataclass
from typing import Any

_FUNCTION_TYPE = "function"
_LOCAL_LIFECYCLE = "local"
_HOLDER_KEYS = ("localDefinition", "draft")


@dataclass(frozen=True)
class FunctionReference:
    """One library Function block of a workflow."""

    function_id: str
    version: str | None
    node_id: str
    node_label: str
    disabled: bool


def function_holders(workflow: Any) -> Iterator[MutableMapping[str, Any]]:
    """Each Function definition the blocks of one workflow hold: `localDefinition`, then `draft`."""
    nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
    for node in nodes if isinstance(nodes, list) else []:
        data = node.get("data") if isinstance(node, dict) else None
        if isinstance(data, dict):
            yield from (data[key] for key in _HOLDER_KEYS if isinstance(data.get(key), dict))


def nested_function_workflows(node: Any) -> list[dict[str, Any]]:
    """The `localDefinition` and `draft` workflows of one block, in that order."""
    return [
        holder["workflow"]
        for holder in function_holders({"nodes": [node]})
        if isinstance(holder.get("workflow"), dict)
    ]


def iter_blocks(workflow: Any) -> Iterator[dict[str, Any]]:
    """Every block at every depth: a block, then its nested bodies, then the next block."""
    nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
    for node in nodes if isinstance(nodes, list) else []:
        if isinstance(node, dict):
            yield node
            for nested in nested_function_workflows(node):
                yield from iter_blocks(nested)


def _is_library_function(data: dict[str, Any]) -> bool:
    return (
        _FUNCTION_TYPE in (data.get("nodeType"), data.get("elementType"))
        and isinstance(data.get("functionId"), str)
        and bool(data["functionId"])
        and data.get("functionLifecycle") != _LOCAL_LIFECYCLE
    )


def iter_function_references(workflow: Any) -> Iterator[FunctionReference]:
    """One reference per library Function block, in the order of `iter_blocks`."""
    for block in iter_blocks(workflow):
        data = block.get("data")
        if isinstance(data, dict) and _is_library_function(data):
            label = data.get("label")
            yield FunctionReference(
                function_id=data["functionId"],
                version=data.get("functionVersion"),
                node_id=block.get("id") or "",
                node_label=label if isinstance(label, str) and label.strip() else "",
                disabled=bool(data.get("disabled")),
            )


def referenced_function_ids(workflow: Any) -> set[str]:
    """The id of every library Function a workflow uses, at every depth."""
    return {reference.function_id for reference in iter_function_references(workflow)}


def _mapped(value: Any, id_map: Mapping[str, str]) -> Any:
    if isinstance(value, list):
        return [_mapped(item, id_map) for item in value]
    return id_map.get(value, value) if isinstance(value, str) else value


def _remap_block(data: dict[str, Any], id_map: Mapping[str, str]) -> None:
    definition = data.get("localDefinition")
    dependencies = definition.get("dependencies") if isinstance(definition, dict) else None
    for holder, key in (
        (data, "functionId"),
        (data.get("upstreamLink"), "functionId"),
        (dependencies, "functions"),
    ):
        if isinstance(holder, dict) and key in holder:
            holder[key] = _mapped(holder[key], id_map)


def remap_function_ids(workflow: dict[str, Any], id_map: Mapping[str, str]) -> dict[str, Any]:
    """A copy of a workflow with its Function ids rewritten through `id_map`."""
    result = copy.deepcopy(workflow)
    for block in iter_blocks(result):
        data = block.get("data")
        if isinstance(data, dict):
            _remap_block(data, id_map)
    return result
