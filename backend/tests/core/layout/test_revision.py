"""Carrying geometry across a revision: which Blocks are the same, and where they go.

A Block is recognized by what it is - kind, name and settings - within the same
section of the same construct, never by its place in the list (REQ-5.2.7.4).
"""

import copy
from typing import Any


def match(
    previous: dict[str, Any],
    revised: dict[str, Any],
    anchors: dict[str, str] | None = None,
) -> dict[str, str]:
    from wavecore.core.layout.revision import match_blocks

    return match_blocks(previous, revised, anchors)


def carry(
    previous: dict[str, Any], revised: dict[str, Any], anchors: dict[str, str] | None = None
) -> None:
    from wavecore.core.layout.revision import carry_canvas_state

    carry_canvas_state(previous, revised, anchors)


def block(
    node_id: str,
    label: str,
    element_type: str = "log",
    node_type: str = "plugin",
    **values: Any,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": element_type,
            "nodeType": node_type,
            "config": {"values": values or {"message": label}},
        },
    }


def edge(
    source: str, target: str, source_handle: str | None = None, target_handle: str | None = None
) -> dict[str, Any]:
    wire: dict[str, Any] = {"id": f"e-{source}-{target}", "source": source, "target": target}
    if source_handle is not None:
        wire["sourceHandle"] = source_handle
    if target_handle is not None:
        wire["targetHandle"] = target_handle
    return wire


def straight(*nodes: dict[str, Any]) -> dict[str, Any]:
    """The nodes in one flow from the start."""
    ids = ["start-node", *(node["id"] for node in nodes)]
    return {"nodes": list(nodes), "edges": [edge(a, b) for a, b in zip(ids, ids[1:], strict=False)]}


def two_branch_if(node_id: str) -> dict[str, Any]:
    branches = [
        {"id": "branch_0", "type": "if", "label": "", "conditions": []},
        {"id": "branch_1", "type": "else", "label": ""},
    ]
    return block(node_id, "Check", "if-else", "control", branches=branches)


def if_else(
    then: list[dict[str, Any]], otherwise: list[dict[str, Any]], prefix: str
) -> dict[str, Any]:
    """Start -> If -> (then | else) -> After, each branch a straight flow into the rejoin."""
    condition = two_branch_if(f"{prefix}-if")
    after = block(f"{prefix}-after", "After")
    nodes = [condition, *then, *otherwise, after]
    edges = [edge("start-node", condition["id"])]
    for index, branch in enumerate((then, otherwise)):
        ids = [node["id"] for node in branch]
        if not ids:
            edges.append(edge(condition["id"], after["id"], f"branch_{index}", f"ingress_{index}"))
            continue
        edges.append(edge(condition["id"], ids[0], f"branch_{index}"))
        edges += [edge(a, b) for a, b in zip(ids, ids[1:], strict=False)]
        edges.append(edge(ids[-1], after["id"], None, f"ingress_{index}" if index else None))
    return {"nodes": nodes, "edges": edges}


def lanes_then(
    construct: dict[str, Any], lanes: list[tuple[str, dict[str, Any]]]
) -> dict[str, Any]:
    """Start -> construct -> one Block per (handle, Block) lane, and its continuation After."""
    after = block(f"{construct['id'].split('-')[0]}-after", "After")
    edges = [edge("start-node", construct["id"]), edge(construct["id"], after["id"], "then")]
    edges += [edge(construct["id"], lane["id"], handle) for handle, lane in lanes]
    return {"nodes": [construct, *(lane for _, lane in lanes), after], "edges": edges}


def switch(cases: list[tuple[str, str]], prefix: str) -> dict[str, Any]:
    """A Switch with a case per (value, node id); each case's one Block is named by its id."""
    branches = [
        {
            "id": f"branch_{index}",
            "type": "case",
            "label": f"Case {value}",
            "conditions": [
                {"id": f"c{index}", "type": "expression", "expression": f"r == {value}"}
            ],
            "break": True,
        }
        for index, (value, _) in enumerate(cases)
    ]
    construct = block(f"{prefix}-switch", "Switch", "switch-case", "control", branches=branches)
    lanes = [
        (f"branch_{index}", block(node_id, node_id[-1].upper()))
        for index, (_, node_id) in enumerate(cases)
    ]
    return lanes_then(construct, lanes)


def parallel(branches: list[tuple[str, str, str]], prefix: str) -> dict[str, Any]:
    """A Parallel with a branch per (name, node id, label) holding that one Block."""
    records = [
        {"id": f"branch_{index + 1}", "name": name} for index, (name, _, _) in enumerate(branches)
    ]
    construct = block(f"{prefix}-parallel", "Parallel", "parallel", "control", branches=records)
    lanes = [
        (f"branch_{index + 1}", block(node_id, label))
        for index, (_, node_id, label) in enumerate(branches)
    ]
    return lanes_then(construct, lanes)


class TestMatchingInOneFlow:
    def test_an_untouched_flow_matches_every_block(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"))
        revised = straight(block("n1", "A"), block("n2", "B"))
        assert match(previous, revised) == {"n1": "o1", "n2": "o2"}

    def test_a_block_inserted_at_the_start_shifts_nobody(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"))
        revised = straight(block("n1", "X"), block("n2", "A"), block("n3", "B"))
        assert match(previous, revised) == {"n2": "o1", "n3": "o2"}

    def test_a_block_inserted_in_the_middle_shifts_nobody(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"))
        revised = straight(block("n1", "A"), block("n2", "X"), block("n3", "B"))
        assert match(previous, revised) == {"n1": "o1", "n3": "o2"}

    def test_a_block_appended_at_the_end_shifts_nobody(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"))
        revised = straight(block("n1", "A"), block("n2", "B"), block("n3", "X"))
        assert match(previous, revised) == {"n1": "o1", "n2": "o2"}

    def test_a_deleted_block_leaves_the_others_matched(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"), block("o3", "C"))
        revised = straight(block("n1", "A"), block("n2", "C"))
        assert match(previous, revised) == {"n1": "o1", "n2": "o3"}

    def test_a_moved_block_is_new_and_the_ones_it_passed_keep_theirs(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"), block("o3", "C"))
        revised = straight(block("n1", "B"), block("n2", "C"), block("n3", "A"))
        assert match(previous, revised) == {"n1": "o2", "n2": "o3"}

    def test_identical_blocks_pair_in_order_and_an_extra_one_is_the_new_one(self) -> None:
        previous = straight(block("o1", "Log"), block("o2", "Log"))
        revised = straight(block("n1", "Log"), block("n2", "Log"), block("n3", "Log"))
        assert match(previous, revised) == {"n1": "o1", "n2": "o2"}

    def test_blocks_sharing_a_name_are_told_apart_by_their_settings(self) -> None:
        previous = straight(block("o1", "Log", message="a"), block("o2", "Log", message="b"))
        revised = straight(
            block("n1", "Log", message="c"),
            block("n2", "Log", message="a"),
            block("n3", "Log", message="b"),
        )
        assert match(previous, revised) == {"n2": "o1", "n3": "o2"}

    def test_a_renamed_block_with_its_settings_is_the_same_block(self) -> None:
        previous = straight(block("o1", "Fetch", message="x"), block("o2", "B"))
        revised = straight(block("n1", "Fetch orders", message="x"), block("n2", "B"))
        assert match(previous, revised) == {"n1": "o1", "n2": "o2"}

    def test_a_block_with_new_settings_and_its_name_is_the_same_block(self) -> None:
        previous = straight(block("o1", "Fetch", message="x"), block("o2", "B"))
        revised = straight(block("n1", "Fetch", message="y"), block("n2", "B"))
        assert match(previous, revised) == {"n1": "o1", "n2": "o2"}

    def test_settings_win_over_a_name_when_a_rename_and_an_insert_meet(self) -> None:
        previous = straight(block("o1", "Log", message="plain"))
        revised = straight(
            block("n1", "Renamed", message="plain"), block("n2", "Log", message="new")
        )
        assert match(previous, revised) == {"n1": "o1"}

    def test_a_changed_block_in_the_place_of_one_of_its_kind_takes_that_place(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"), block("o3", "C"))
        revised = straight(block("n1", "A"), block("n2", "Z", message="other"), block("n3", "C"))
        assert match(previous, revised) == {"n1": "o1", "n2": "o2", "n3": "o3"}

    def test_a_block_of_another_kind_is_never_the_same_block(self) -> None:
        previous = straight(block("o1", "Step"))
        revised = straight(block("n1", "Step", "delay", "control", message="Step"))
        assert match(previous, revised) == {}

    def test_function_blocks_of_different_functions_are_different_kinds(self) -> None:
        old = block("o1", "Call", "function", "function")
        old["data"]["functionId"] = "fn-a"
        new = block("n1", "Call", "function", "function")
        new["data"]["functionId"] = "fn-b"
        assert match(straight(old), straight(new)) == {}

    def test_a_block_with_no_data_is_matched_by_its_empty_kind(self) -> None:
        previous = {"nodes": [{"id": "o1"}], "edges": [edge("start-node", "o1")]}
        revised = {"nodes": [{"id": "n1"}], "edges": [edge("start-node", "n1")]}
        assert match(previous, revised) == {"n1": "o1"}

    def test_empty_workflows_match_nothing(self) -> None:
        assert match({}, {"nodes": [], "edges": []}) == {}


class TestMatchingInSections:
    def test_a_block_inserted_in_a_branch_leaves_both_branches_matched(self) -> None:
        previous = if_else([block("o-a", "A")], [block("o-b", "B")], "o")
        revised = if_else([block("n-x", "X"), block("n-a", "A")], [block("n-b", "B")], "n")
        assert match(previous, revised) == {
            "n-if": "o-if",
            "n-a": "o-a",
            "n-b": "o-b",
            "n-after": "o-after",
        }

    def test_a_block_moved_to_the_other_branch_is_new(self) -> None:
        previous = if_else([block("o-a", "A")], [], "o")
        revised = if_else([], [block("n-a", "A")], "n")
        assert match(previous, revised) == {"n-if": "o-if", "n-after": "o-after"}

    def test_a_branch_that_gains_its_first_block_leaves_the_other_branch_matched(self) -> None:
        previous = if_else([], [block("o-b", "B")], "o")
        revised = if_else([block("n-x", "X")], [block("n-b", "B")], "n")
        assert match(previous, revised) == {"n-if": "o-if", "n-b": "o-b", "n-after": "o-after"}

    def test_a_case_added_in_the_middle_leaves_every_other_case_recognized(self) -> None:
        previous = switch([("1", "o-a"), ("3", "o-b")], "o")
        revised = switch([("1", "n-a"), ("2", "n-x"), ("3", "n-b")], "n")
        assert match(previous, revised) == {
            "n-switch": "o-switch",
            "n-a": "o-a",
            "n-b": "o-b",
            "n-after": "o-after",
        }

    def test_a_case_removed_in_the_middle_leaves_every_other_case_recognized(self) -> None:
        previous = switch([("1", "o-a"), ("2", "o-x"), ("3", "o-b")], "o")
        revised = switch([("1", "n-a"), ("3", "n-b")], "n")
        assert match(previous, revised) == {
            "n-switch": "o-switch",
            "n-a": "o-a",
            "n-b": "o-b",
            "n-after": "o-after",
        }

    def test_a_parallel_branch_added_in_the_middle_is_told_apart_by_its_blocks(self) -> None:
        previous = parallel([("", "o-a", "A"), ("", "o-b", "B")], "o")
        revised = parallel([("", "n-a", "A"), ("", "n-x", "X"), ("", "n-b", "B")], "n")
        assert match(previous, revised) == {
            "n-parallel": "o-parallel",
            "n-a": "o-a",
            "n-b": "o-b",
            "n-after": "o-after",
        }

    def test_a_named_parallel_branch_is_recognized_by_its_name(self) -> None:
        previous = parallel([("api", "o-a", "Check"), ("db", "o-b", "Check")], "o")
        revised = parallel(
            [("api", "n-a", "Check"), ("cache", "n-x", "Check"), ("db", "n-b", "Check")], "n"
        )
        assert match(previous, revised) == {
            "n-parallel": "o-parallel",
            "n-a": "o-a",
            "n-b": "o-b",
            "n-after": "o-after",
        }

    def test_a_case_whose_value_changed_is_still_the_case_in_its_place(self) -> None:
        previous = switch([("1", "o-a"), ("3", "o-b")], "o")
        revised = switch([("1", "n-a"), ("4", "n-b")], "n")
        assert match(previous, revised) == {
            "n-switch": "o-switch",
            "n-a": "o-a",
            "n-b": "o-b",
            "n-after": "o-after",
        }

    def test_the_blocks_of_an_unmatched_construct_are_new(self) -> None:
        previous = if_else([block("o-a", "A")], [], "o")
        loop = block("n-for", "Repeat", "for", "control", mode="count", count=2)
        revised = {
            "nodes": [loop, block("n-a", "A"), block("n-after", "After")],
            "edges": [
                edge("start-node", "n-for"),
                edge("n-for", "n-a", "body"),
                edge("n-for", "n-after", "then"),
            ],
        }
        assert match(previous, revised) == {"n-after": "o-after"}


class TestAnchors:
    def test_an_anchored_block_is_matched_wherever_it_sits(self) -> None:
        previous = straight(block("o1", "K"), block("o2", "L"))
        revised = straight(block("n1", "L"), block("n2", "K renamed", message="other"))
        assert match(previous, revised, {"n2": "o1"}) == {"n2": "o1", "n1": "o2"}

    def test_an_anchored_old_block_never_pairs_with_another_block(self) -> None:
        previous = straight(block("o1", "A"))
        revised = straight(block("n1", "A"), block("n2", "B"))
        assert match(previous, revised, {"n2": "o1"}) == {"n2": "o1"}

    def test_the_sections_of_an_anchored_construct_are_matched_where_it_went(self) -> None:
        inner = if_else([block("o-a", "A")], [], "o")
        previous = {
            "nodes": [block("o-first", "First"), *inner["nodes"]],
            "edges": [edge("start-node", "o-first"), edge("o-first", "o-if")]
            + [wire for wire in inner["edges"] if wire["source"] != "start-node"],
        }
        revised = if_else([block("n-a", "A")], [], "n")
        assert match(previous, revised, {"n-if": "o-if"}) == {
            "n-if": "o-if",
            "n-a": "o-a",
            "n-after": "o-after",
        }


class TestCarryGeometry:
    def test_untouched_blocks_keep_their_positions_and_hand_set_widths(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"))
        previous["nodes"][0].update(position={"x": 500, "y": 40}, width=230, height=73)
        previous["nodes"][1]["position"] = {"x": 500, "y": 400}
        revised = straight(block("n1", "A"), block("n2", "B"), block("n3", "C"))
        carry(previous, revised)
        by_id = {node["id"]: node for node in revised["nodes"]}
        assert by_id["n1"]["position"] == {"x": 500, "y": 40}
        assert by_id["n1"]["width"] == 230
        assert "height" not in by_id["n1"]
        assert by_id["n2"]["position"] == {"x": 500, "y": 400}
        assert "width" not in by_id["n2"]
        # A new Block goes under the Block before it, in the column a person gave that one.
        assert by_id["n3"]["position"] == {"x": 500, "y": 540}

    def test_a_generated_width_is_not_carried(self) -> None:
        previous = straight(block("o1", "A"))
        previous["nodes"][0].update(position={"x": -80, "y": 140}, width=160)
        revised = straight(block("n1", "A much longer block name here"))
        revised["nodes"][0]["width"] = 348
        carry(previous, revised)
        assert revised["nodes"][0]["width"] == 348

    def test_a_matched_block_with_no_stored_position_is_placed(self) -> None:
        previous = straight(block("o1", "A"))
        revised = straight(block("n1", "A"))
        carry(previous, revised)
        assert revised["nodes"][0]["position"] == {"x": -80, "y": 140}

    def test_an_inserted_block_pushes_the_blocks_below_it_down(self) -> None:
        previous = straight(block("o1", "A"), block("o2", "B"))
        previous["nodes"][0]["position"] = {"x": -80, "y": 140}
        previous["nodes"][1]["position"] = {"x": -80, "y": 280}
        revised = straight(block("n1", "X"), block("n2", "A"), block("n3", "B"))
        carry(previous, revised)
        assert [node["position"] for node in revised["nodes"]] == [
            {"x": -80, "y": 140},
            {"x": -80, "y": 280},
            {"x": -80, "y": 420},
        ]

    def test_a_block_that_grew_wider_keeps_its_center_and_the_block_beside_it_moves_aside(
        self,
    ) -> None:
        previous = if_else([block("o-a", "A")], [block("o-b", "B")], "o")
        stored = {
            "o-if": {"x": -80, "y": 140},
            "o-a": {"x": -240, "y": 280},
            "o-b": {"x": 80, "y": 280},
            "o-after": {"x": -80, "y": 420},
        }
        for node in previous["nodes"]:
            node.update(position=stored[node["id"]], width=160)
        revised = if_else([block("n-a", "A renamed", message="A")], [block("n-b", "B")], "n")
        for node in revised["nodes"]:
            node["width"] = 360 if node["id"] == "n-a" else 160
        carry(previous, revised)
        by_id = {node["id"]: node["position"] for node in revised["nodes"]}
        assert by_id == {
            "n-if": {"x": -80, "y": 140},
            "n-a": {"x": -340, "y": 280},
            "n-b": {"x": 140, "y": 280},
            "n-after": {"x": -80, "y": 420},
        }

    def test_a_hand_set_width_stays_with_its_case_when_a_case_comes_before_it(self) -> None:
        previous = switch([("1", "o-a"), ("3", "o-b")], "o")
        previous["nodes"][2]["width"] = 300
        revised = switch([("1", "n-a"), ("2", "n-x"), ("3", "n-b")], "n")
        carry(previous, revised)
        widths = {node["id"]: node.get("width") for node in revised["nodes"]}
        assert (widths["n-b"], widths["n-x"]) == (300, None)

    def test_it_hands_back_which_stored_block_each_revised_block_is(self) -> None:
        from wavecore.core.layout.revision import carry_canvas_state

        previous = straight(block("o1", "A"), block("o2", "B"), block("o3", "C"))
        revised = straight(block("n1", "X"), block("n2", "A"), block("n3", "C"))

        assert carry_canvas_state(previous, revised) == {"n2": "o1", "n3": "o3"}


MASKING = {"secret_masking": "mask", "unmasked_secret_fields": ["auth_token"]}


def set_on_the_canvas(node: dict[str, Any]) -> dict[str, Any]:
    """The Block as a person left it: its secrets always masked but one, its description open."""
    node["data"]["config"].update(copy.deepcopy(MASKING))
    node["data"]["descriptionExpanded"] = True
    return node


def note(node_id: str, **size: float) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "noteNode",
        "data": {
            "label": "Note",
            "elementType": "note",
            "nodeType": "control",
            "config": {"values": {"text": "Read me"}},
        },
        **size,
    }


class TestCarryCanvasSettings:
    """What a person sets on the canvas and a recipe cannot say stays with the Block it was
    set on, as its place and hand-set width do."""

    def test_a_recognized_block_keeps_how_it_masks_its_secrets(self) -> None:
        previous = straight(set_on_the_canvas(block("o1", "A")))
        revised = straight(block("n1", "A"))

        carry(previous, revised)

        config = revised["nodes"][0]["data"]["config"]
        assert {key: config.get(key) for key in MASKING} == MASKING

    def test_a_recognized_block_keeps_its_open_description(self) -> None:
        previous = straight(set_on_the_canvas(block("o1", "A")))
        revised = straight(block("n1", "A"))

        carry(previous, revised)

        assert revised["nodes"][0]["data"].get("descriptionExpanded") is True

    def test_a_recognized_block_whose_settings_changed_still_keeps_them(self) -> None:
        previous = straight(set_on_the_canvas(block("o1", "Fetch", message="x")))
        revised = straight(block("n1", "Fetch", message="y"))

        carry(previous, revised)

        data = revised["nodes"][0]["data"]
        assert data["config"]["values"] == {"message": "y"}
        assert {key: data["config"].get(key) for key in MASKING} == MASKING
        assert data.get("descriptionExpanded") is True

    def test_a_new_block_starts_on_the_defaults(self) -> None:
        previous = straight(set_on_the_canvas(block("o1", "A")))
        revised = straight(block("n1", "X"), block("n2", "A"))

        carry(previous, revised)

        new, kept = revised["nodes"]
        assert "descriptionExpanded" not in new["data"]
        assert set(new["data"]["config"]) == {"values"}
        assert {key: kept["data"]["config"].get(key) for key in MASKING} == MASKING

    def test_a_block_its_key_pairs_with_one_of_another_kind_starts_on_the_defaults(self) -> None:
        previous = straight(set_on_the_canvas(block("o1", "A")))
        revised = straight(block("n1", "A", "delay", "control", duration=1))

        carry(previous, revised, {"n1": "o1"})

        data = revised["nodes"][0]["data"]
        assert "descriptionExpanded" not in data
        assert set(data["config"]) == {"values"}

    def test_a_block_placed_below_an_open_description_clears_the_whole_card(self) -> None:
        previous = straight(set_on_the_canvas(block("o1", "A")))
        previous["nodes"][0]["position"] = {"x": -80, "y": 140}
        revised = straight(block("n1", "A"), block("n2", "B"))
        for node in (previous["nodes"][0], revised["nodes"][0]):
            node["data"]["description"] = "x" * 64

        carry(previous, revised)

        assert revised["nodes"][1]["position"] == {"x": -80, "y": 420}

    def test_a_note_keeps_the_height_a_person_gave_it(self) -> None:
        previous = straight(block("o1", "A"))
        previous["nodes"].append(note("o-note", width=345, height=200))
        revised = straight(block("n1", "A"))
        revised["nodes"].append(note("n-note"))

        carry(previous, revised)

        kept = revised["nodes"][1]
        assert (kept.get("width"), kept.get("height")) == (345, 200)
