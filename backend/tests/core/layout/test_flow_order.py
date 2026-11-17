"""The order check itself: a fresh build reads in flow order, and each kind of disorder is found."""

import copy
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from tests.core.layout.flow_order import Finding, flow_order_findings
from tests.core.layout.storyboard import seed_profiles, step_recipe
from tests.core.recipes.conftest import make_recipe
from tests.mcp.conftest import seed_registries  # noqa: F401
from tests.mcp.test_tools_author import EXAMPLE_NAMES, _seed_example_prerequisites, example_recipe


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


def fresh_build(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe

    result = compile_recipe(text)
    assert result["test_data"] is not None, result["findings"]
    return dict(result["test_data"]["workflow"])


def log_step(label: str) -> dict[str, Any]:
    return {"block": "log", "label": label, "settings": {"message": label.lower()}}


def moved(workflow: dict[str, Any], label: str, **position: float) -> dict[str, Any]:
    """The workflow with one Block moved by the given amounts."""
    out = copy.deepcopy(workflow)
    for node in out["nodes"]:
        if node["data"]["label"] == label:
            node["position"] = {
                axis: node["position"][axis] + position.get(axis, 0) for axis in ("x", "y")
            }
    return out


def kinds_of(findings: list[Finding]) -> list[tuple[str, tuple[str, ...]]]:
    return [(finding.kind, finding.blocks) for finding in findings]


THREE = make_recipe([log_step("Alpha"), log_step("Bravo"), log_step("Charlie")], name="Three")
BRANCHES = make_recipe(
    [{"if": {"when": "go", "then": [log_step("Alpha")], "else": [log_step("Bravo")]}}],
    name="Branches",
    variables={"go": {"type": "boolean", "value": True}},
)
WIDE = "Delta step with a very long name"
WIDE_BRANCHES = make_recipe(
    [
        {
            "if": {
                "when": "go",
                "then": [log_step("Alpha"), log_step(WIDE)],
                "else": [log_step("Bravo")],
            }
        }
    ],
    name="Wide Branches",
    variables={"go": {"type": "boolean", "value": True}},
)
LOOP = make_recipe(
    [{"for": {"count": 2, "body": [log_step("Alpha")]}}, log_step("After")], name="Loop"
)


class TestAFreshBuild:
    @pytest.mark.parametrize("name", EXAMPLE_NAMES)
    def test_every_packaged_example_reads_in_flow_order(self, name: str) -> None:
        text = example_recipe(name)
        _seed_example_prerequisites(text)

        assert flow_order_findings(fresh_build(text)) == []

    @pytest.mark.parametrize("step", [1, 2, 3])
    def test_each_storyboard_step_reads_in_flow_order(self, step: int) -> None:
        seed_profiles()

        assert flow_order_findings(fresh_build(step_recipe(step))) == []


class TestEachFindingIsFound:
    def test_a_block_above_its_row(self) -> None:
        workflow = moved(fresh_build(THREE), "Bravo", y=-40)

        assert kinds_of(flow_order_findings(workflow)) == [
            ("ABOVE", ("Bravo",)),
            ("FAR", ("Charlie",)),
        ]

    def test_a_block_further_down_than_its_row(self) -> None:
        workflow = moved(fresh_build(THREE), "Charlie", y=140)

        assert kinds_of(flow_order_findings(workflow)) == [("FAR", ("Charlie",))]

    def test_a_block_off_the_column_of_the_block_before_it(self) -> None:
        workflow = moved(fresh_build(THREE), "Charlie", x=300)

        assert kinds_of(flow_order_findings(workflow)) == [("COLUMN", ("Charlie", "Bravo"))]

    def test_a_block_between_a_block_and_the_one_before_it(self) -> None:
        workflow = moved(moved(fresh_build(THREE), "Bravo", y=140), "Charlie", y=-140)

        assert kinds_of(flow_order_findings(workflow)) == [
            ("FAR", ("Bravo",)),
            ("BETWEEN", ("Charlie", "Alpha", "Bravo")),
            ("ABOVE", ("Charlie",)),
        ]

    def test_lanes_that_share_columns(self) -> None:
        # Bravo moves under the wide Block of the other lane, a row above it.
        workflow = moved(fresh_build(WIDE_BRANCHES), "Bravo", x=-200)

        assert kinds_of(flow_order_findings(workflow)) == [
            ("LANES", ("If/Else", "branch_0", "branch_1"))
        ]

    def test_a_lane_not_one_gutter_left_of_the_blocks_after_its_construct(self) -> None:
        workflow = moved(fresh_build(LOOP), "Alpha", x=100)

        assert kinds_of(flow_order_findings(workflow)) == [("BESIDE", ("For Loop",))]

    def test_two_boxes_that_overlap(self) -> None:
        workflow = moved(fresh_build(BRANCHES), "Bravo", x=-200)

        assert kinds_of(flow_order_findings(workflow)) == [
            ("LANES", ("If/Else", "branch_0", "branch_1")),
            ("OVERLAP", ("Alpha", "Bravo")),
        ]
