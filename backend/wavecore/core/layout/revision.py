"""Carry what a person set on the canvas across a revision of a workflow.

A Block of the revised workflow is the Block it was when it is the same kind,
in the same section of the same construct, recognized by its name and settings
rather than by its place in the list; a section is recognized by what it is, never
by its number. A recognized Block keeps any width a person set, a Note's height and
the canvas settings a recipe cannot say, and the revision is laid out as a change of
the stored layout, so it reads in flow order.
"""

import copy
import json
from collections.abc import Callable, Hashable, Iterator, Mapping, Sequence
from difflib import SequenceMatcher
from typing import Any

from wavecore.core.layout.change import layout_change
from wavecore.core.layout.dimensions import fit_node_width
from wavecore.core.layout.engine import FlowTree, flow_tree, ingress_counts, is_numbered_section

_Signature = Callable[[Mapping[str, Any]], tuple[str, ...]]

# The settings a person sets on the canvas that a recipe cannot say: Block data keys, config keys.
CANVAS_DATA_SETTINGS = ("descriptionExpanded",)
CANVAS_CONFIG_SETTINGS = ("secret_masking", "unmasked_secret_fields")
# Condition items carry ids the compiler mints in recipe order, so they say nothing of content.
_CONDITION_ITEM_TYPES = frozenset({"literal", "expression", "group"})


def without_condition_ids(value: Any) -> Any:
    """The value with the ids of its condition items left out, at every depth."""
    if isinstance(value, list):
        return [without_condition_ids(item) for item in value]
    if not isinstance(value, Mapping):
        return value
    condition = value.get("type") in _CONDITION_ITEM_TYPES
    return {
        key: without_condition_ids(item)
        for key, item in value.items()
        if not (condition and key == "id")
    }


def _kind(data: Mapping[str, Any]) -> tuple[str, ...]:
    return (
        str(data.get("nodeType") or ""),
        str(data.get("elementType") or ""),
        str(data.get("functionId") or ""),
    )


def _settings(data: Mapping[str, Any]) -> str:
    values = (data.get("config") or {}).get("values") or {}
    return json.dumps(values, sort_keys=True, default=str)


def _label(data: Mapping[str, Any]) -> str:
    return str(data.get("label") or "")


def _same_everything(data: Mapping[str, Any]) -> tuple[str, ...]:
    return (*_kind(data), _label(data), _settings(data))


def _same_settings(data: Mapping[str, Any]) -> tuple[str, ...]:
    return (*_kind(data), _settings(data))


def _same_name(data: Mapping[str, Any]) -> tuple[str, ...]:
    return (*_kind(data), _label(data))


# Strongest first: each weaker one pairs only what the stronger ones left between their pairs.
_SIGNATURES: tuple[_Signature, ...] = (_same_everything, _same_settings, _same_name, _kind)


def _rows_by_id(tree: FlowTree) -> dict[str, dict[str, FlowTree]]:
    rows: dict[str, dict[str, FlowTree]] = {}
    for node_id, sections in tree:
        rows[node_id] = sections
        for flow in sections.values():
            rows.update(_rows_by_id(flow))
    return rows


def _pairs(
    old: Sequence[Sequence[Hashable]],
    new: Sequence[Sequence[Hashable]],
    level: int = 0,
    old_at: int = 0,
    new_at: int = 0,
) -> Iterator[tuple[int, int]]:
    """Index pairs of old and new items by their keys, one key per level, strongest first; each
    weaker level pairs only what the stronger ones left between their pairs."""
    if not old or not new or level == len(old[0]):
        return
    matcher = SequenceMatcher(
        None, [keys[level] for keys in old], [keys[level] for keys in new], autojunk=False
    )
    old_from = new_from = 0
    for old_start, new_start, size in matcher.get_matching_blocks():
        yield from _pairs(
            old[old_from:old_start],
            new[new_from:new_start],
            level + 1,
            old_at + old_from,
            new_at + new_from,
        )
        for offset in range(size):
            yield old_at + old_start + offset, new_at + new_start + offset
        old_from, new_from = old_start + size, new_start + size


def _lane_records(data: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    """A construct's lane settings by handle: its branches or its cases."""
    branches = ((data.get("config") or {}).get("values") or {}).get("branches")
    if not isinstance(branches, list):
        return {}
    return {str(entry["id"]): entry for entry in branches if isinstance(entry, Mapping)}


class _Matcher:
    def __init__(
        self,
        previous: Mapping[str, Any],
        revised: Mapping[str, Any],
        anchors: Mapping[str, str],
    ) -> None:
        self.old_data = {str(n["id"]): n.get("data") or {} for n in previous.get("nodes") or []}
        self.new_data = {str(n["id"]): n.get("data") or {} for n in revised.get("nodes") or []}
        self.anchors = dict(anchors)
        self.anchored = set(anchors.values())
        self.matches: dict[str, str] = dict(anchors)
        # (revised construct id, revised handle) -> the stored handle of the same lane.
        self.lanes: dict[tuple[str, str], str] = {}

    def align_flows(self, old_flow: FlowTree, new_flow: FlowTree) -> None:
        # Anchored Blocks are paired already, so they never pair with another one.
        old_rows = [row for row in old_flow if row[0] not in self.anchored]
        new_rows = [row for row in new_flow if row[0] not in self.anchors]
        old_keys = [
            [sign(self.old_data[node_id]) for sign in _SIGNATURES] for node_id, _ in old_rows
        ]
        new_keys = [
            [sign(self.new_data[node_id]) for sign in _SIGNATURES] for node_id, _ in new_rows
        ]
        for old_index, new_index in _pairs(old_keys, new_keys):
            old_id, old_sections = old_rows[old_index]
            new_id, new_sections = new_rows[new_index]
            self.matches[new_id] = old_id
            self.align_sections(old_id, new_id, old_sections, new_sections)

    def align_sections(
        self,
        old_id: str,
        new_id: str,
        old_sections: Mapping[str, FlowTree],
        new_sections: Mapping[str, FlowTree],
    ) -> None:
        named = [handle for handle in new_sections if not is_numbered_section(handle)]
        pairs = [(handle, handle) for handle in named if handle in old_sections]
        old_numbered = [handle for handle in old_sections if is_numbered_section(handle)]
        new_numbered = [handle for handle in new_sections if is_numbered_section(handle)]
        old_keys = self._lane_keys(self.old_data, old_id, old_numbered, old_sections)
        new_keys = self._lane_keys(self.new_data, new_id, new_numbered, new_sections)
        pairs += [(old_numbered[o], new_numbered[n]) for o, n in _pairs(old_keys, new_keys)]
        for old_handle, new_handle in pairs:
            self.lanes[(new_id, new_handle)] = old_handle
            self.align_flows(old_sections[old_handle], new_sections[new_handle])

    @staticmethod
    def _lane_keys(
        data: Mapping[str, Mapping[str, Any]],
        construct: str,
        handles: list[str],
        sections: Mapping[str, FlowTree],
    ) -> list[tuple[Hashable, ...]]:
        """What each numbered lane is, strongest first: its settings with its Blocks, its
        settings - a case's value, a branch's name - then its kind, such as a case or an else."""
        records = _lane_records(data.get(construct) or {})
        keys: list[tuple[Hashable, ...]] = []
        for handle in handles:
            record = {key: value for key, value in records.get(handle, {}).items() if key != "id"}
            settings = json.dumps(without_condition_ids(record), sort_keys=True, default=str)
            blocks = tuple(_same_everything(data[node_id]) for node_id, _ in sections[handle])
            keys.append(((settings, blocks), settings, str(record.get("type") or "")))
        return keys


def _match(
    previous: Mapping[str, Any], revised: Mapping[str, Any], anchors: Mapping[str, str]
) -> _Matcher:
    old_tree = flow_tree(list(previous.get("nodes") or []), list(previous.get("edges") or []))
    new_tree = flow_tree(list(revised.get("nodes") or []), list(revised.get("edges") or []))
    matcher = _Matcher(previous, revised, anchors)
    matcher.align_flows(old_tree, new_tree)
    old_rows, new_rows = _rows_by_id(old_tree), _rows_by_id(new_tree)
    for new_id, old_id in matcher.anchors.items():
        matcher.align_sections(old_id, new_id, old_rows.get(old_id, {}), new_rows.get(new_id, {}))
    return matcher


def match_blocks(
    previous: Mapping[str, Any],
    revised: Mapping[str, Any],
    anchors: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Revised node id -> previous node id of the same Block; `anchors` pairs some up front."""
    return _match(previous, revised, anchors or {}).matches


def _hand_set_width(node: dict[str, Any], ingress: int) -> dict[str, float]:
    """The stored width a person set; one equal to the generated fit is the compiler's."""
    width = node.get("width")
    if not isinstance(width, int | float) or width == fit_node_width(node, ingress):
        return {}
    return {"width": width}


def _note_height(old: Mapping[str, Any], node: Mapping[str, Any]) -> dict[str, float]:
    """A Note's stored height; a Block card's height follows its content, never a hand."""
    height = old.get("height")
    notes = old.get("type") == node.get("type") == "noteNode"
    if not notes or not isinstance(height, int | float):
        return {}
    return {"height": height}


def _carry_settings(old: Mapping[str, Any], node: dict[str, Any]) -> None:
    """Give the revised Block the canvas settings its stored Block holds, when it is still
    that kind of Block: a key can pair Blocks of two kinds, and a reveal choice is per kind."""
    old_data = old.get("data") or {}
    if _kind(old_data) != _kind(node.get("data") or {}):
        return
    old_config = old_data.get("config") or {}
    kept = {key: old_data[key] for key in CANVAS_DATA_SETTINGS if key in old_data}
    kept_config = {key: old_config[key] for key in CANVAS_CONFIG_SETTINGS if key in old_config}
    if kept:
        node.setdefault("data", {}).update(copy.deepcopy(kept))
    if kept_config:
        node.setdefault("data", {}).setdefault("config", {}).update(copy.deepcopy(kept_config))


def carry_canvas_state(
    previous: Mapping[str, Any],
    revised: dict[str, Any],
    anchors: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Give each revised Block the hand-set size and canvas settings of the Block it was, then
    lay the revision out as a change of the previous layout.

    Returns the pairs it found: revised node id -> previous node id.
    """
    matcher = _match(previous, revised, anchors or {})
    old_nodes = {str(node["id"]): node for node in previous.get("nodes") or []}
    old_ingress = ingress_counts(list(previous.get("edges") or []))
    for node in revised["nodes"]:
        old = old_nodes.get(matcher.matches.get(str(node["id"]), ""))
        if old is None:
            continue
        node.update(_hand_set_width(old, old_ingress.get(str(old["id"]), 0)))
        node.update(_note_height(old, node))
        # Before the layout: an open description makes the card taller.
        _carry_settings(old, node)
    positions = layout_change(previous, revised, matcher.matches, matcher.lanes)
    for node in revised["nodes"]:
        node["position"] = positions[str(node["id"])]
    return matcher.matches
