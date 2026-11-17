"""Carry a stored test onto the compiled revision an amendment saves: canvas state and identity.

An amendment recompiles the whole recipe, so every Block comes out of the compiler with a
fresh id and none of what a person set on the canvas. Each Block the revision recognizes
takes back its stored id, place, hand-set size and canvas settings, at every depth: the
Blocks of a recognized local Function's body are recognized the same way. Every other Block
gets an id no Block of the stored test ever held, and the wires and loop targets follow.
A test's readback form compiles its recipe readback the same way, so a Block saved from
the canvas and a compiled one compare like with like.
"""

import itertools
from collections.abc import Iterator, Mapping
from typing import Any

from wavecore.core.functions.references import iter_blocks, nested_function_workflows
from wavecore.core.layout.revision import carry_canvas_state
from wavecore.core.recipes.compiler import compile_recipe, wire_id
from wavecore.core.recipes.decompiler import decompile_test_data


def key_anchors(
    previous: Mapping[str, Any], revised: Mapping[str, Any], step_map: Mapping[str, str]
) -> dict[str, str]:
    """Revised node id -> stored node id for each step the recipe names with a `key` of its own."""
    stored: dict[str, str] = {}
    for node in previous.get("nodes") or []:
        key = (node.get("data") or {}).get("recipeKey")
        if key is not None:
            stored.setdefault(str(key), str(node["id"]))
    anchors: dict[str, str] = {}
    for node in revised["nodes"]:
        key = str(node["data"]["recipeKey"])
        if key == step_map.get(node["id"]):
            continue
        # A stored node anchors one step only, so two steps never share a place.
        old_id = stored.pop(key, None)
        if old_id is not None:
            anchors[node["id"]] = old_id
    return anchors


def _local_body(node: Mapping[str, Any]) -> dict[str, Any] | None:
    definition = (node.get("data") or {}).get("localDefinition")
    workflow = definition.get("workflow") if isinstance(definition, Mapping) else None
    return workflow if isinstance(workflow, dict) else None


def _pairs(
    previous: Mapping[str, Any],
    revised: Mapping[str, Any],
    matches: Mapping[str, str],
    step_map: Mapping[str, str],
) -> dict[str, str]:
    """Carry each recognized local body's canvas state onto its revision, at every depth.

    Returns compiled id -> stored id of every recognized Block, inside those bodies too.
    """
    pairs = dict(matches)
    old_nodes = {str(node["id"]): node for node in previous.get("nodes") or []}
    for node in revised["nodes"]:
        old = old_nodes.get(matches.get(str(node["id"]), ""))
        if old is None:
            continue
        old_body, new_body = _local_body(old), _local_body(node)
        if old_body is None or new_body is None:
            continue
        inner = carry_canvas_state(old_body, new_body, key_anchors(old_body, new_body, step_map))
        pairs.update(_pairs(old_body, new_body, inner, step_map))
    return pairs


def _new_ids(
    previous: Mapping[str, Any], revised: Mapping[str, Any], pairs: Mapping[str, str]
) -> dict[str, str]:
    """Compiled id -> the id each Block of the revision holds from now on."""
    reserved = {str(block["id"]) for block in iter_blocks(previous)}
    compiled = [str(block["id"]) for block in iter_blocks(revised)]
    final: dict[str, str] = {}
    taken: set[str] = set()
    for node_id in compiled:
        kept = pairs.get(node_id)
        if kept is not None and kept not in taken:
            final[node_id] = kept
            taken.add(kept)
    # A new Block keeps the compiler's id unless a stored Block, removed ones included, held it.
    for node_id in compiled:
        if node_id not in final and node_id not in reserved and node_id not in taken:
            final[node_id] = node_id
            taken.add(node_id)
    fresh = (f"node-{number}" for number in itertools.count(1))
    for node_id in compiled:
        if node_id not in final:
            final[node_id] = next(name for name in fresh if name not in reserved | taken)
            taken.add(final[node_id])
    return final


def _workflows(workflow: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """The workflow and every local Function body inside it, at every depth."""
    yield workflow
    for block in iter_blocks(workflow):
        yield from nested_function_workflows(block)


def _rename(workflow: dict[str, Any], final: Mapping[str, str]) -> None:
    for node in workflow["nodes"]:
        node["id"] = final[node["id"]]
        values = node["data"]["config"]["values"]
        if "target_loop" in values:
            values["target_loop"] = final[values["target_loop"]]
    for edge in workflow["edges"]:
        edge["source"] = final.get(edge["source"], edge["source"])
        edge["target"] = final[edge["target"]]
        edge["id"] = wire_id(
            edge["source"], edge.get("sourceHandle"), edge["target"], edge.get("targetHandle")
        )


def revise(
    previous: Mapping[str, Any], revised: dict[str, Any], step_map: Mapping[str, str]
) -> dict[str, str]:
    """Give the compiled revision the stored workflow's canvas state and Block ids, in place.

    Returns the step map keyed by the ids the revision's Blocks now hold.
    """
    matches = carry_canvas_state(previous, revised, key_anchors(previous, revised, step_map))
    final = _new_ids(previous, revised, _pairs(previous, revised, matches, step_map))
    for workflow in list(_workflows(revised)):
        _rename(workflow, final)
    return {final.get(node_id, node_id): step for node_id, step in step_map.items()}


def readback_form(
    test: Mapping[str, Any], placement_defaults: Mapping[str, Mapping[str, Any]] | None = None
) -> dict[str, Any] | None:
    """The test as its recipe readback compiles, each Block with the id and canvas state it holds
    in ``test``.

    None when the readback leaves something out or does not compile.
    """
    readback = decompile_test_data(dict(test))
    if not readback["expressible"]:
        return None
    result = compile_recipe(readback["recipe"], placement_defaults=placement_defaults)
    compiled: dict[str, Any] | None = result["test_data"]
    if compiled is None:
        return None
    revise(test.get("workflow") or {}, compiled["workflow"], result["step_map"])
    return compiled
