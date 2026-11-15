"""The read-only, Block metadata, edge id and loop signal target checks, and the Wait Until lane
rule, the Test save and the Function save share.

REQ-3.1.2.4, REQ-3.1.3.13, REQ-3.5.4.3, REQ-3.5.1.2, REQ-3.5.1.3.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from wavecore.api.services.block_schema import field_default
from wavecore.core.execution.plugin_executor import (
    read_only_violation,
    template_read_only_violation,
)
from wavecore.core.functions.references import nested_function_workflows
from wavecore.core.variables.usage import SiteKind, block_sites

READ_ONLY_CODE = "EXPRESSION_CHANGES_DATA"
DUPLICATE_EDGE_ID_CODE = "DUPLICATE_EDGE_ID"
REMOVE_BLOCK = "Remove block"
MAX_DESCRIPTION_LENGTH = 64
WAIT_UNTIL = "wait-until"
WAIT_RETRY_LANE = "retry"
WAIT_EGRESS_LANE = "then"
BODY_HANDLE = "body"
LOOP_ELEMENT_TYPES = frozenset({"for", "for-each", "while"})
LOOP_SIGNALS = frozenset({"break", "continue"})
OUTSIDE_LOOP_CODE = "BREAK_OUTSIDE_LOOP"
OUTSIDE_LOOP_MESSAGE = "break/continue is only valid inside a loop body"

_SEMANTIC_VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)")


def error_entry(
    *,
    path: str,
    code: str,
    message: str,
    fix_action: str | None = None,
    node_id: str | None = None,
    node_label: str | None = None,
    element_type: str | None = None,
) -> dict[str, Any]:
    """One save error entry, in the shape every save check reports."""
    return {
        "path": path,
        "node_id": node_id,
        "node_label": node_label,
        "element_type": element_type,
        "code": code,
        "message": message,
        "severity": "error",
        "fix_action": fix_action,
    }


def repeated_edge_ids(edges: Any) -> dict[str, int]:
    """Each id more than one edge of a workflow carries, with the index of its first repeat."""
    seen: set[str] = set()
    repeated: dict[str, int] = {}
    for index, edge in enumerate(edges if isinstance(edges, list) else []):
        edge_id = edge.get("id") if isinstance(edge, Mapping) else None
        if not isinstance(edge_id, str) or not edge_id:
            continue
        if edge_id in seen:
            repeated.setdefault(edge_id, index)
        seen.add(edge_id)
    return repeated


def repeated_edge_id_message(edge_id: str) -> str:
    """The finding text for an edge id more than one edge carries."""
    return f"Edge ID '{edge_id}' is used by more than one edge"


def block_type_registered(element_type: str, version: str, *, control: bool) -> bool:
    """Whether a plugin or control type is registered, so its declared fields can be read."""
    if control:
        from wavecore.controls.registry import get_control_implementation
        from wavecore.models.enums import ControlId

        try:
            control_id = ControlId(element_type)
        except ValueError:
            return False
        return get_control_implementation(control_id, version) is not None
    from wavecore.core.plugin_registry import get_plugin

    return get_plugin(element_type, version) is not None


def validate_node_element_type(
    node_path: str,
    node_id: str,
    node_label: str | None,
    element_type: str | None,
    all_known_element_types: set[str],
    errors: list[dict[str, Any]],
) -> bool:
    """Refuse a missing or unknown Block type; False means the Block's other checks are skipped."""
    if not element_type or not isinstance(element_type, str):
        errors.append(
            error_entry(
                path=f"{node_path}.data.elementType",
                node_id=node_id,
                node_label=node_label,
                code="MISSING_BLOCK_TYPE",
                message="Block must have an elementType",
                fix_action="Remove block (type unknown)",
            )
        )
        return False
    if element_type not in all_known_element_types:
        errors.append(
            error_entry(
                path=f"{node_path}.data.elementType",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="UNKNOWN_BLOCK_TYPE",
                message=f"Unknown block type: '{element_type}'",
                fix_action=REMOVE_BLOCK,
            )
        )
        return False
    return True


def validate_node_metadata(
    data: dict[str, Any],
    node_path: str,
    node_id: str,
    node_label: str | None,
    element_type: str,
    control_ids: set[str],
    errors: list[dict[str, Any]],
) -> None:
    """The nodeType key against the Block type, the name, the version and the description cap."""
    node_type_data = data.get("nodeType")
    is_control = element_type in control_ids
    expected_node_type = "control" if is_control else "plugin"
    # A Function Block's nodeType is 'function', compatible with any non-control type.
    if node_type_data == "function" and not is_control:
        node_type_data = None
    if node_type_data and node_type_data != expected_node_type:
        errors.append(
            error_entry(
                path=f"{node_path}.data.nodeType",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="NODE_TYPE_MISMATCH",
                message=(
                    f"nodeType '{node_type_data}' does not match elementType "
                    f"'{element_type}' (expected '{expected_node_type}')"
                ),
                fix_action=REMOVE_BLOCK,
            )
        )
    label = data.get("label")
    if not label or not isinstance(label, str) or not label.strip():
        errors.append(
            error_entry(
                path=f"{node_path}.data.label",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="MISSING_LABEL",
                message="Block must have a name",
                fix_action="Generate a name from the block type",
            )
        )
    version = data.get("version")
    if version and isinstance(version, str) and not _SEMANTIC_VERSION.match(version):
        errors.append(
            error_entry(
                path=f"{node_path}.data.version",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="INVALID_VERSION",
                message=f"Invalid semantic version: '{version}'",
                fix_action=REMOVE_BLOCK,
            )
        )
    description = data.get("description")
    if isinstance(description, str) and len(description) > MAX_DESCRIPTION_LENGTH:
        errors.append(
            error_entry(
                path=f"{node_path}.data.description",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="DESCRIPTION_TOO_LONG",
                message=f"Block description must be at most {MAX_DESCRIPTION_LENGTH} characters",
                fix_action=f"Trim description to {MAX_DESCRIPTION_LENGTH} characters",
            )
        )


_SOURCE_CHECKS: dict[SiteKind, Callable[[str], str | None]] = {
    SiteKind.EXPRESSION: read_only_violation,
    SiteKind.TEMPLATE: template_read_only_violation,
}


def node_read_only_violations(node: Mapping[str, Any]) -> list[tuple[str, str]]:
    """(place, reason) for every expression and template site of one Block that would change
    data, condition rows included."""
    found: list[tuple[str, str]] = []
    reported: set[str] = set()
    for site in block_sites(node):
        check = _SOURCE_CHECKS.get(site.kind)
        reason = check(site.text) if check else None
        if reason and site.setting not in reported:
            reported.add(site.setting)
            found.append((site.setting, reason))
    return found


def variable_read_only_violation(var_info: dict[str, Any]) -> str | None:
    """The reason a Variable Manager entry would change data, or None."""
    source = var_info.get("value")
    if not isinstance(source, str) or not source:
        return None
    if var_info.get("isExpression"):
        return read_only_violation(source)
    if var_info.get("isTemplate"):
        return template_read_only_violation(source)
    return None


def validate_read_only_expressions(
    nodes: list[dict[str, Any]],
    variables: dict[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    """Refuse at save any author text that would change data; the run gate stays the backstop."""
    for node in nodes:
        data = node.get("data") or {}
        node_id = node.get("id", "")
        label = data.get("label") or node_id
        for field_name, reason in node_read_only_violations(node):
            errors.append(
                error_entry(
                    path=f"nodes.{node_id}.config.values.{field_name}",
                    node_id=node_id,
                    node_label=data.get("label"),
                    element_type=data.get("elementType"),
                    code=READ_ONLY_CODE,
                    message=f"{reason} Block: {label}. Field: {field_name}.",
                )
            )
    for var_name, var_info in variables.items():
        if not isinstance(var_info, dict):
            continue
        var_reason = variable_read_only_violation(var_info)
        if var_reason:
            errors.append(
                error_entry(
                    path=f"variables.{var_name}",
                    code=READ_ONLY_CODE,
                    message=f"{var_reason} Variable: {var_name}.",
                )
            )


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _reached(starts: Iterable[str], adjacency: Mapping[str, list[str]]) -> set[str]:
    members: set[str] = set()
    stack = list(starts)
    while stack:
        current = stack.pop()
        if current in members:
            continue
        members.add(current)
        stack.extend(adjacency.get(current, []))
    return members


def body_members(
    nodes: Iterable[Any], edges: Iterable[Any], element_types: Collection[str]
) -> dict[str, set[str]]:
    """Each container of these types by id, with the Blocks its body holds: every Block
    reached forward from the body's first Block."""
    containers = {
        str(_mapping(node).get("id"))
        for node in nodes
        if _mapping(_mapping(node).get("data")).get("elementType") in element_types
    }
    adjacency: dict[str, list[str]] = {}
    entries: dict[str, list[str]] = {}
    for edge in edges:
        source, target = _mapping(edge).get("source"), _mapping(edge).get("target")
        if not source or not target:
            continue
        adjacency.setdefault(source, []).append(target)
        if source in containers and _mapping(edge).get("sourceHandle") == BODY_HANDLE:
            entries.setdefault(source, []).append(target)
    return {container: _reached(entries.get(container, []), adjacency) for container in containers}


def validate_loop_targets(
    nodes: list[dict[str, Any]], edges: Iterable[Any], errors: list[dict[str, Any]]
) -> None:
    """A Break or Continue aims at a loop whose body holds it (REQ-3.5.1.2, REQ-3.5.1.3)."""
    holders = body_members(nodes, edges, LOOP_ELEMENT_TYPES)
    for index, node in enumerate(nodes):
        data = _mapping(node.get("data"))
        element_type = data.get("elementType")
        target = _mapping(_mapping(data.get("config")).get("values")).get("target_loop")
        if element_type not in LOOP_SIGNALS or data.get("disabled"):
            continue
        # A missing or blank target is the required rule's to name.
        if not isinstance(target, str) or not target.strip():
            continue
        enclosing = {loop for loop, members in holders.items() if node.get("id") in members}
        if target in enclosing:
            continue
        errors.append(
            error_entry(
                path=f"nodes[{index}].data.config.values.target_loop",
                node_id=node.get("id"),
                node_label=data.get("label"),
                element_type=element_type,
                code=OUTSIDE_LOOP_CODE,
                message=(
                    f"break/continue target '{target}' is not an enclosing loop"
                    if enclosing
                    else OUTSIDE_LOOP_MESSAGE
                ),
            )
        )


def is_watch_wait(data: Mapping[str, Any]) -> bool:
    """A Wait Until in Watch mode: the stored mode, else the field default."""
    mode = _mapping(_mapping(data.get("config")).get("values")).get("mode")
    if mode is None:
        mode = field_default(data, "mode")
    return bool(mode == "watch")


def wait_until_watch_flags(nodes: Iterable[Any]) -> dict[str, bool]:
    """Each Wait Until by node id, True when it is in Watch mode."""
    flags: dict[str, bool] = {}
    for node in nodes:
        nid = _mapping(node).get("id")
        data = _mapping(_mapping(node).get("data"))
        if nid and data.get("elementType") == WAIT_UNTIL:
            flags[nid] = is_watch_wait(data)
    return flags


def put_wait_until_wires_on_lanes(
    nodes: Iterable[Any], edges: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """The wires of one flow, each Wait Until wire on a lane its mode draws (REQ-3.5.4.3).

    Watch drops its retry wires and keeps the next wire unnamed; a Retry wait with no
    `then` wire puts its first unnamed wire on `then`.
    """
    watch_flags = wait_until_watch_flags(nodes)
    if not watch_flags:
        return edges
    then_wired = {
        _mapping(e).get("source")
        for e in edges
        if _mapping(e).get("sourceHandle") == WAIT_EGRESS_LANE
    }
    kept: list[dict[str, Any]] = []
    for edge in edges:
        source = _mapping(edge).get("source")
        if source in watch_flags:
            if not _put_wait_wire_on_lane(edge, watch_flags[source], source in then_wired):
                continue
            if edge.get("sourceHandle") == WAIT_EGRESS_LANE:
                then_wired.add(source)
        kept.append(edge)
    return kept


def _put_wait_wire_on_lane(edge: dict[str, Any], watch: bool, then_wired: bool) -> bool:
    """Move a Wait Until wire to a lane its mode draws; False when the mode draws none for it."""
    handle = edge.get("sourceHandle")
    if watch:
        if handle == WAIT_RETRY_LANE:
            return False
        if handle == WAIT_EGRESS_LANE:
            del edge["sourceHandle"]
    elif not handle and not then_wired:
        edge["sourceHandle"] = WAIT_EGRESS_LANE
    return True


@dataclass(frozen=True)
class RemovedWire:
    """A wire the lane rule removed, and the Function Blocks, outermost first, holding it."""

    edge: dict[str, Any]
    holders: tuple[Mapping[str, Any], ...]


def put_flow_wires_on_lanes(flow: Any) -> list[RemovedWire]:
    """The lane rule on a Function flow and on every Function body inside it; the wires removed."""
    nodes = flow.get("nodes") if isinstance(flow, dict) else None
    if not isinstance(nodes, list):
        return []
    removed: list[RemovedWire] = []
    edges = flow.get("edges")
    if isinstance(edges, list):
        kept = put_wait_until_wires_on_lanes(nodes, edges)
        kept_ids = {id(edge) for edge in kept}
        removed = [RemovedWire(edge, ()) for edge in edges if id(edge) not in kept_ids]
        flow["edges"] = kept
    removed.extend(put_body_wires_on_lanes(nodes))
    return removed


def put_body_wires_on_lanes(nodes: Iterable[Any]) -> list[RemovedWire]:
    """The lane rule on every Function body the Blocks hold, at every depth; the wires removed."""
    return [
        RemovedWire(wire.edge, (node, *wire.holders))
        for node in nodes
        for body in nested_function_workflows(node)
        for wire in put_flow_wires_on_lanes(body)
    ]


# The wires the lane rule took out of each Function flow, by the ids of the Blocks holding it.
RemovedByFlow = Mapping[tuple[str, ...], Sequence[Mapping[str, Any]]]


def removed_wires_by_flow(
    removed: Iterable[RemovedWire],
) -> dict[tuple[str, ...], list[dict[str, Any]]]:
    """The removed wires by the ids of the Function Blocks holding them; `()` is the flow itself."""
    grouped: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for wire in removed:
        holder_ids = tuple(str(holder.get("id", "") or "") for holder in wire.holders)
        grouped.setdefault(holder_ids, []).append(wire.edge)
    return grouped
