"""The layout of a changed test: it reads in flow order the way a fresh build does.

A recipe is built fresh, changed to another recipe, and the positions the change saves are
checked exactly and against the order check. A new Block goes under the Block before it; a
new branch gets a column of its own; Blocks below or beside move only as far as needed, in
their order, whole lanes at a time; a gap WAVE left closes; what a person arranged stays.
"""

import copy
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import pytest

from tests.core.layout.flow_order import MIN_COLUMN, flow_order_findings, kinds
from tests.core.layout.storyboard import STEP_THREE, STEP_TWO, seed_profiles, step_recipe
from tests.core.recipes.conftest import make_recipe
from tests.core.recipes.test_amend import PING_STEP, RELEASE_BODY, release_recipe
from tests.mcp.conftest import seed_registries  # noqa: F401

Positions = dict[str, dict[str, float]]


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:  # noqa: F811 - fixture param, not a redefinition
    """Recipe compilation resolves blocks against the live registries."""


@pytest.fixture(autouse=True)
def clear_entity_caches(temp_storage_path: Path) -> Generator[None, None, None]:
    from wavecore.api.services.functions import service as function_service
    from wavecore.api.services.profiles import _common as profile_common

    profile_common._clear_in_memory_cache()
    function_service._clear_in_memory_cache()
    yield
    profile_common._clear_in_memory_cache()
    function_service._clear_in_memory_cache()


def compiled(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe

    result = compile_recipe(text)
    assert result["test_data"] is not None, result["findings"]
    return dict(result)


def fresh_build(text: str) -> dict[str, Any]:
    return copy.deepcopy(dict(compiled(text)["test_data"]["workflow"]))


def changed(stored: dict[str, Any], text: str) -> dict[str, Any]:
    """The workflow `text` compiles to, laid out as a change of `stored`."""
    from wavecore.core.layout.revision import carry_canvas_state
    from wavecore.core.recipes.amend import key_anchors

    result = compiled(text)
    revised = copy.deepcopy(dict(result["test_data"]["workflow"]))
    carry_canvas_state(stored, revised, key_anchors(stored, revised, result["step_map"]))
    return revised


def change(
    before: str, after: str, arrange: Callable[[Positions], None] | None = None
) -> Positions:
    """Build `before`, let `arrange` move its Blocks as a person would, then change to `after`."""
    stored = fresh_build(before)
    if arrange is not None:
        moved = positions(stored)
        arrange(moved)
        for node in stored["nodes"]:
            node["position"] = moved[node["data"]["label"]]
    return positions(changed(stored, after))


def positions(workflow: dict[str, Any]) -> Positions:
    return {node["data"]["label"]: dict(node["position"]) for node in workflow["nodes"]}


def in_order(before: str, after: str) -> dict[str, Any]:
    """The change of `before` to `after`, which must read in flow order."""
    workflow = changed(fresh_build(before), after)
    assert flow_order_findings(workflow) == []
    return workflow


def column_boxes(workflow: dict[str, Any], labels: list[str]) -> tuple[float, float]:
    """The left and right edge of the column the Blocks named take, as a fresh build spaces it."""
    from wavecore.core.layout.dimensions import estimate_node_size
    from wavecore.core.layout.engine import ingress_counts

    ingress = ingress_counts(workflow["edges"])
    edges: list[tuple[float, float]] = []
    for node in workflow["nodes"]:
        if node["data"]["label"] in labels:
            width = estimate_node_size(node, ingress.get(node["id"], 0))[0]
            center = node["position"]["x"] + width / 2
            half = max(width, MIN_COLUMN) / 2
            edges.append((center - half, center + half))
    return min(left for left, _ in edges), max(right for _, right in edges)


def log_step(label: str, message: str | None = None) -> dict[str, Any]:
    return {"block": "log", "label": label, "settings": {"message": message or label.lower()}}


BRAVO = "Bravo step with a long name"
WIDE = "apply the gateway manifest to the staging namespace"
A, B, C, D = (log_step(label) for label in ("Alpha", BRAVO, "Charlie", "Delta"))
B_SHORT = log_step("Bravo")
N = log_step("Inserted")
FLAGS = {
    "flag": {"type": "boolean", "value": True},
    "deep": {"type": "boolean", "value": True},
    "route": {"type": "integer", "value": 1},
    "ready": {"type": "boolean", "value": True},
}


def loop(body: list[Any]) -> str:
    flow = [log_step("Before"), {"for": {"count": 2, "body": body}}, log_step("After the loop")]
    return make_recipe(flow, name="Loop Case")


def if_else(then: list[Any], other: list[Any] | None = None, name: str = "If Case") -> str:
    construct: dict[str, Any] = {"when": "flag", "then": then}
    if other is not None:
        construct["else"] = other
    flow = [log_step("Before"), {"if": construct}, log_step("After")]
    return make_recipe(flow, name=name, variables=FLAGS)


def switch(cases: list[tuple[int, list[Any]]]) -> str:
    """A Switch with a case per (value, steps), each named and chosen by its value."""
    construct = {
        "cases": [
            {"label": f"Case {value}", "when": f"route == {value}", "steps": steps}
            for value, steps in cases
        ],
        "default": [log_step("Default step")],
    }
    flow = [log_step("Before"), {"switch": construct}, log_step("After")]
    return make_recipe(flow, name="Switch Case", variables=FLAGS)


def parallel(branches: list[list[Any]]) -> str:
    construct = {"branches": [{"steps": steps} for steps in branches]}
    flow = [log_step("Before"), {"parallel": construct}, log_step("After")]
    return make_recipe(flow, name="Parallel Case")


def nested(inner_then: list[Any]) -> str:
    """An If inside the first branch of another If."""
    inner = {"if": {"label": "Inner?", "when": "deep", "then": inner_then, "else": [B_SHORT]}}
    outer = {"if": {"label": "Outer?", "when": "flag", "then": [inner], "else": [C]}}
    flow = [log_step("Before"), outer, log_step("After")]
    return make_recipe(flow, name="Nested Case", variables=FLAGS)


def wait(*after: Any) -> str:
    condition = {"variable": "ready", "operator": "equals", "value": True, "value_type": "boolean"}
    construct = {
        "label": "Wait for healthy",
        "that": [condition],
        "timeout": 1000,
        "interval": 100,
        "retry": [log_step("Check /health")],
    }
    flow = [log_step("Before"), {"wait_until": construct}, *after]
    return make_recipe(flow, name="Wait Case", variables=FLAGS)


LOOP_FRESH = {
    "Before": {"x": -80, "y": 140},
    "For Loop": {"x": -80, "y": 280},
    "Alpha": {"x": -444, "y": 420},
    BRAVO: {"x": -528, "y": 560},
    "Charlie": {"x": -444, "y": 700},
    "After the loop": {"x": -99, "y": 420},
}
IF_FRESH = {
    "Before": {"x": -80, "y": 140},
    "If/Else": {"x": -80, "y": 280},
    "Alpha": {"x": -240, "y": 420},
    BRAVO: {"x": -324, "y": 560},
    "Charlie": {"x": 124, "y": 420},
    "After": {"x": -80, "y": 700},
}


class TestNoChange:
    @pytest.mark.parametrize(
        "text",
        [
            loop([A, B, C]),
            if_else([A, B], [C]),
            switch([(1, [A]), (3, [B])]),
            parallel([[A], [B]]),
            nested([A]),
            wait(log_step("After")),
            release_recipe(RELEASE_BODY),
            make_recipe([A, B], name="Notes", notes=[{"note": {"text": "Read me"}}]),
        ],
    )
    def test_a_change_to_the_same_recipe_moves_no_block(self, text: str) -> None:
        stored = fresh_build(text)

        assert positions(changed(stored, text)) == positions(stored)

    @pytest.mark.parametrize("step", [1, 2, 3])
    def test_a_storyboard_step_changed_to_itself_moves_no_block(self, step: int) -> None:
        seed_profiles()
        stored = fresh_build(step_recipe(step))

        assert positions(changed(stored, step_recipe(step))) == positions(stored)


class TestInsertInALane:
    def test_at_the_start_the_new_block_takes_the_first_row_and_the_lane_moves_down_one_row(
        self,
    ) -> None:
        after = in_order(loop([A, B, C]), loop([N, A, B, C]))

        assert positions(after) == {
            **LOOP_FRESH,
            "Inserted": {"x": -444, "y": 420},
            "Alpha": {"x": -444, "y": 560},
            BRAVO: {"x": -528, "y": 700},
            "Charlie": {"x": -444, "y": 840},
        }

    def test_in_the_middle_the_blocks_above_stay(self) -> None:
        after = in_order(loop([A, B, C]), loop([A, N, B, C]))

        assert positions(after) == {
            **LOOP_FRESH,
            "Inserted": {"x": -444, "y": 560},
            BRAVO: {"x": -528, "y": 700},
            "Charlie": {"x": -444, "y": 840},
        }

    def test_at_the_end_nothing_in_the_lane_moves(self) -> None:
        after = in_order(loop([A, B, C]), loop([A, B, C, N]))

        assert positions(after) == {**LOOP_FRESH, "Inserted": {"x": -444, "y": 840}}

    def test_in_the_deeper_branch_the_step_after_the_if_moves_down_one_row(self) -> None:
        after = in_order(if_else([A, B], [C]), if_else([N, A, B], [C]))

        assert positions(after) == {
            **IF_FRESH,
            "Inserted": {"x": -240, "y": 420},
            "Alpha": {"x": -240, "y": 560},
            BRAVO: {"x": -324, "y": 700},
            "After": {"x": -80, "y": 840},
        }

    def test_in_the_shorter_branch_the_step_after_the_if_stays(self) -> None:
        after = in_order(if_else([A, B, D], [C]), if_else([A, B, D], [C, N]))

        assert positions(after) == {
            **IF_FRESH,
            "Delta": {"x": -240, "y": 700},
            "Inserted": {"x": 124, "y": 560},
            "After": {"x": -80, "y": 840},
        }

    def test_the_continuation_beside_a_loop_stays_when_its_body_grows(self) -> None:
        after = in_order(loop([A]), loop([A, B, C, N]))

        assert positions(after) == {**LOOP_FRESH, "Inserted": {"x": -444, "y": 840}}

    def test_a_new_note_goes_below_the_flow_as_a_fresh_build_puts_it(self) -> None:
        note = {"note": {"text": "Read me"}}
        after = make_recipe([A, B_SHORT], name="Notes", notes=[note])

        workflow = in_order(make_recipe([A, B_SHORT], name="Notes"), after)

        assert positions(workflow) == positions(fresh_build(after))
        assert positions(workflow)["Note"]["y"] == 420

    def test_a_note_in_the_way_of_new_blocks_moves_below_them(self) -> None:
        notes = [{"note": {"text": "Read me"}}]
        before = make_recipe([A], name="Notes", notes=notes)
        after = make_recipe([A, B_SHORT, C], name="Notes", notes=notes)

        workflow = changed(fresh_build(before), after)

        assert positions(fresh_build(before))["Note"]["y"] == 280
        assert positions(workflow) == positions(fresh_build(after))


class TestNewBranch:
    def test_a_new_else_gets_its_own_column_and_the_then_lane_moves_aside(self) -> None:
        after = in_order(if_else([A, B]), if_else([A, B], [C]))

        assert positions(after) == IF_FRESH
        then_right = column_boxes(after, ["Alpha", BRAVO])[1]
        assert column_boxes(after, ["Charlie"])[0] - then_right == 80

    def test_a_switch_keeps_its_center_and_its_cases_stay_left_of_the_spine(self) -> None:
        after = in_order(switch([(1, [A]), (3, [B])]), switch([(1, [A]), (2, [N]), (3, [B])]))

        assert positions(after) == {
            "Before": {"x": -80, "y": 140},
            "Switch/Case": {"x": -176, "y": 280},
            "Alpha": {"x": -1288, "y": 420},
            "Inserted": {"x": -968, "y": 420},
            BRAVO: {"x": -688, "y": 420},
            "Default step": {"x": -249, "y": 420},
            "After": {"x": -80, "y": 560},
        }
        lanes = [
            column_boxes(after, [label]) for label in ("Alpha", "Inserted", BRAVO, "Default step")
        ]
        assert [lanes[index + 1][0] - lanes[index][1] for index in range(3)] == [80] * 3
        assert lanes[-1][1] == -40

    def test_a_parallel_branch_gets_its_own_column(self) -> None:
        after = in_order(parallel([[A], [B]]), parallel([[A], [B], [C]]))

        assert positions(after) == {
            "Before": {"x": -80, "y": 140},
            "Parallel": {"x": -144, "y": 280},
            "Alpha": {"x": -968, "y": 420},
            BRAVO: {"x": -688, "y": 420},
            "Charlie": {"x": -240, "y": 420},
            "After": {"x": -80, "y": 560},
        }


class TestRemoval:
    def test_a_removed_block_closes_its_gap(self) -> None:
        after = in_order(loop([A, B, C]), loop([A, C]))

        assert positions(after) == {
            **{label: LOOP_FRESH[label] for label in ("Before", "For Loop", "Alpha")},
            "Charlie": {"x": -444, "y": 560},
            "After the loop": {"x": -99, "y": 420},
        }

    def test_a_removed_first_block_lets_its_lane_move_up_one_row(self) -> None:
        after = in_order(loop([A, B, C]), loop([B, C]))

        assert positions(after) == {
            **{label: LOOP_FRESH[label] for label in ("Before", "For Loop", "After the loop")},
            BRAVO: {"x": -528, "y": 420},
            "Charlie": {"x": -444, "y": 560},
        }

    def test_a_removed_branch_leaves_the_other_lanes_in_place(self) -> None:
        after = in_order(if_else([A, B], [C]), if_else([A, B]))

        assert positions(after) == {
            label: position for label, position in IF_FRESH.items() if label != "Charlie"
        }


class TestMove:
    def test_a_keyed_block_moved_to_the_other_branch_goes_under_its_new_predecessor(
        self,
    ) -> None:
        keyed = {**A, "key": "alpha"}
        after = in_order(if_else([keyed, B], [C]), if_else([B], [keyed, C]))

        assert positions(after) == {
            **IF_FRESH,
            BRAVO: {"x": -324, "y": 420},
            "Alpha": {"x": 124, "y": 420},
            "Charlie": {"x": 124, "y": 560},
        }

    def test_a_keyed_block_moved_into_a_branch_goes_under_its_new_predecessor(self) -> None:
        keyed = {**A, "key": "alpha"}
        variables = {"flag": FLAGS["flag"]}

        def flow(then: list[Any], first: list[Any]) -> str:
            construct = {"if": {"when": "flag", "then": then, "else": [C]}}
            steps = [*first, construct, log_step("After")]
            return make_recipe(steps, name="Into", variables=variables)

        after = in_order(flow([B_SHORT], [keyed]), flow([B_SHORT, keyed], []))

        assert positions(after) == {
            "If/Else": {"x": -80, "y": 140},
            "Bravo": {"x": -240, "y": 280},
            "Alpha": {"x": -240, "y": 420},
            "Charlie": {"x": 80, "y": 280},
            "After": {"x": -80, "y": 560},
        }

    def test_a_block_moved_to_the_end_of_its_lane_goes_below_the_last_block(self) -> None:
        after = in_order(loop([A, B, C]), loop([B, C, A]))

        assert positions(after) == {
            **LOOP_FRESH,
            BRAVO: {"x": -528, "y": 420},
            "Charlie": {"x": -444, "y": 560},
            "Alpha": {"x": -444, "y": 700},
        }


class TestNested:
    def test_a_wait_that_gains_a_continuation_hangs_its_retry_lane_left_of_it(self) -> None:
        after = in_order(wait(), wait(log_step("After")))

        assert positions(after) == {
            "Before": {"x": -80, "y": 140},
            "Wait for healthy": {"x": -109, "y": 280},
            "Check /health": {"x": -414, "y": 420},
            "After": {"x": -80, "y": 420},
        }

    def test_a_lane_that_widens_moves_the_lanes_beside_it_and_up_the_tree(self) -> None:
        after = in_order(nested([A]), nested([A, B]))

        assert positions(after) == {
            "Before": {"x": -80, "y": 140},
            "Outer?": {"x": -80, "y": 280},
            "Inner?": {"x": -240, "y": 420},
            "Alpha": {"x": -400, "y": 560},
            BRAVO: {"x": -484, "y": 700},
            "Bravo": {"x": -36, "y": 560},
            "Charlie": {"x": 284, "y": 420},
            "After": {"x": -120, "y": 840},
        }
        assert column_boxes(after, ["Bravo"])[0] - column_boxes(after, [BRAVO])[1] == 80
        inner = column_boxes(after, ["Inner?", "Alpha", BRAVO, "Bravo"])
        assert column_boxes(after, ["Charlie"])[0] - inner[1] == 80

    def test_a_block_first_in_a_nested_remote_body_moves_only_the_body_below_it(self) -> None:
        after = in_order(release_recipe(RELEASE_BODY), release_recipe([PING_STEP, *RELEASE_BODY]))

        assert positions(after) == {
            "Connect to app server": {"x": -134, "y": 140},
            "Check orders-api service": {"x": -149, "y": 280},
            "If/Else": {"x": -80, "y": 420},
            "Remote Execution": {"x": -269, "y": 560},
            "Ping app server": {"x": -584, "y": 700},
            "API health check": {"x": -589, "y": 840},
            "Verify API health": {"x": -594, "y": 980},
            "Alert on-call": {"x": 386, "y": 560},
            "Halt": {"x": 400, "y": 700},
            "Query release DB": {"x": -269, "y": 700},
            "Verify release": {"x": -259, "y": 840},
            "Disconnect": {"x": -240, "y": 980},
        }


class TestGrown:
    def test_a_renamed_block_keeps_its_center_and_the_lane_beside_it_moves_aside(self) -> None:
        before = if_else([log_step("Alpha", "then side")], [B_SHORT])
        after = in_order(before, if_else([log_step(WIDE, "then side")], [B_SHORT]))

        assert positions(after) == {
            "Before": {"x": -80, "y": 140},
            "If/Else": {"x": -80, "y": 280},
            WIDE: {"x": -340, "y": 420},
            "Bravo": {"x": 140, "y": 420},
            "After": {"x": -80, "y": 560},
        }

    def test_a_last_branch_that_grows_moves_the_lanes_further_left_of_the_spine(self) -> None:
        after = in_order(parallel([[A], [B]]), parallel([[A], [log_step(WIDE)]]))

        assert positions(after) == {
            "Before": {"x": -80, "y": 140},
            "Parallel": {"x": -112, "y": 280},
            "Alpha": {"x": -680, "y": 420},
            WIDE: {"x": -400, "y": 420},
            "After": {"x": -80, "y": 560},
        }


def dragged(label: str, **by: float) -> Callable[[Positions], None]:
    def arrange(at: Positions) -> None:
        at[label] = {axis: at[label][axis] + by.get(axis, 0) for axis in ("x", "y")}

    return arrange


class TestPersonsLayout:
    def test_a_dragged_block_with_room_keeps_its_place(self) -> None:
        def arrange(at: Positions) -> None:
            at["Charlie"] = {"x": 600, "y": 900}

        after = change(
            make_recipe([A, B, C], name="Dragged"),
            make_recipe([N, A, B, C], name="Dragged"),
            arrange,
        )

        assert after == {
            "Inserted": {"x": -80, "y": 140},
            "Alpha": {"x": -80, "y": 280},
            BRAVO: {"x": -164, "y": 420},
            "Charlie": {"x": 600, "y": 900},
        }

    def test_a_block_a_person_dragged_aside_keeps_its_column_and_the_new_block_goes_under_it(
        self,
    ) -> None:
        after = change(loop([A, B, C]), loop([A, B, N, C]), dragged(BRAVO, x=300))

        assert after == {
            **LOOP_FRESH,
            BRAVO: {"x": -228, "y": 560},
            "Inserted": {"x": -144, "y": 700},
            "Charlie": {"x": -444, "y": 840},
        }

    def test_a_block_a_person_put_beside_its_predecessor_keeps_that_offset(self) -> None:
        def sideways(at: Positions) -> None:
            at[BRAVO] = {"x": -852, "y": 420}
            at["Charlie"] = {"x": -1092, "y": 420}

        after = change(loop([A, B, C]), loop([A, B, N, C]), sideways)

        assert after == {
            **LOOP_FRESH,
            BRAVO: {"x": -852, "y": 420},
            "Inserted": {"x": -768, "y": 560},
            "Charlie": {"x": -1092, "y": 560},
        }

    def test_a_lane_a_person_put_closer_is_not_pushed_away(self) -> None:
        def closer(at: Positions) -> None:
            for label in ("Alpha", BRAVO, "Charlie"):
                at[label] = {"x": at[label]["x"] + 60, "y": at[label]["y"]}

        after = change(loop([A, B, C]), loop([A, B, C, N]), closer)

        assert after == {
            **LOOP_FRESH,
            "Alpha": {"x": -384, "y": 420},
            BRAVO: {"x": -468, "y": 560},
            "Charlie": {"x": -384, "y": 700},
            "Inserted": {"x": -384, "y": 840},
        }

    def test_blocks_a_person_stacked_stay_stacked(self) -> None:
        after = change(
            make_recipe([A, B_SHORT], name="Stacked"),
            make_recipe([A, B_SHORT, C], name="Stacked"),
            dragged("Bravo", y=-80),
        )

        assert after == {
            "Alpha": {"x": -80, "y": 140},
            "Bravo": {"x": -80, "y": 200},
            "Charlie": {"x": -80, "y": 340},
        }

    def test_a_block_a_person_left_in_the_way_moves_down(self) -> None:
        # Bravo, of the other lane, sits where the new Block under Alpha goes.
        stored = fresh_build(if_else([A], [B_SHORT]))
        for node in stored["nodes"]:
            if node["data"]["label"] == "Bravo":
                node["position"] = {"x": -280, "y": 560}

        workflow = changed(stored, if_else([A, N], [B_SHORT]))

        assert positions(workflow) == {
            "Before": {"x": -80, "y": 140},
            "If/Else": {"x": -80, "y": 280},
            "Alpha": {"x": -240, "y": 420},
            "Inserted": {"x": -240, "y": 560},
            "Bravo": {"x": -280, "y": 700},
            "After": {"x": -80, "y": 700},
        }
        # Only what the person's own layout had before the change is out of order.
        assert kinds(flow_order_findings(workflow)) <= kinds(flow_order_findings(stored))


class TestStoryboard:
    def test_steps_two_and_three_give_the_positions_of_the_design(self) -> None:
        seed_profiles()
        step_one = fresh_build(step_recipe(1))

        step_two = changed(step_one, step_recipe(2))
        step_three = changed(step_two, step_recipe(3))

        assert positions(step_two) == STEP_TWO
        assert flow_order_findings(step_two) == []
        assert positions(step_three) == STEP_THREE
        assert flow_order_findings(step_three) == []
