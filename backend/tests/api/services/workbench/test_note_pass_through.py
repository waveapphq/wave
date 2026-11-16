"""A Note the run reaches passes the flow straight on, with no outputs and no side effects.

The graph is the one a recipe compiles, a Note standing between two Log Blocks, so a compiled
Test and a hand-wired one run the same way.
"""

from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    engine_registries,
    lifecycle_lines,
    run_graph,
)
from wavecore.core.recipes.compiler import compile_recipe

pytestmark = pytest.mark.usefixtures("engine_registries")

RECIPE = """\
test:
  name: Note In The Flow
flow:
  - block: log
    label: Before
    settings: {message: before}
  - note: {text: The login goes here, color: yellow}
    label: Login
  - block: log
    label: After
    settings: {message: after}
notes:
  - note: About this test
"""


def compiled_workflow() -> dict[str, Any]:
    result = compile_recipe(RECIPE)
    assert result["findings"] == []
    workflow: dict[str, Any] = result["test_data"]["workflow"]
    return workflow


class TestNoteInTheRun:
    async def test_the_run_passes_a_wired_note_straight_on(self) -> None:
        workflow = compiled_workflow()
        assert [(edge["source"], edge["target"]) for edge in workflow["edges"]] == [
            ("start-node", "node-1"),
            ("node-1", "node-2"),
            ("node-2", "node-3"),
        ]

        session = await run_graph("note-pass", workflow["nodes"], workflow["edges"], {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"] == {"node-1": "passed", "node-3": "passed"}
        assert list(session["variables"]) == ["system"]
        assert lifecycle_lines("note-pass") == [
            "Executing 'Before' (plugin/log)",
            "Completed 'Before' (<n> ms)",
            "Executing 'After' (plugin/log)",
            "Completed 'After' (<n> ms)",
        ]


def log_step(name: str) -> str:
    return f"{{block: log, label: {name}, settings: {{message: {name}}}}}"


LOG_NAMES = ("A", "B", "C", "D")
X_DECLARED = "variables:\n  x: {type: integer, value: 0}\n"


def run_lines(*names: str) -> list[str]:
    """The start and completion lines of the Log Blocks named, in that order."""
    return [
        line
        for name in names
        for line in (f"Executing '{name}' (plugin/log)", f"Completed '{name}' (<n> ms)")
    ]


def log_lines(session_id: str) -> list[str]:
    """The run's start and completion lines of its Log Blocks, the containers left out."""
    return [
        line
        for line in lifecycle_lines(session_id)
        if any(line.startswith((f"Executing '{n}' ", f"Completed '{n}' ")) for n in LOG_NAMES)
    ]


def compile_flow(flow: str) -> dict[str, Any]:
    result = compile_recipe(f"test:\n  name: Note In A Body\n{X_DECLARED}flow:\n{flow}")
    assert result["findings"] == []
    workflow: dict[str, Any] = result["test_data"]["workflow"]
    return workflow


async def run_flow(
    session_id: str, flow: str, variables: dict[str, Any] | None = None
) -> dict[str, Any]:
    workflow = compile_flow(flow)
    return await run_graph(
        session_id, workflow["nodes"], workflow["edges"], variables or {}, timeout=5.0
    )


class TestNoteInABody:
    """A Note inside a body, a section, a branch or a lane passes that flow straight on."""

    async def test_a_loop_body_runs_on_past_a_note(self) -> None:
        flow = (
            f"  - for: {{count: 2, body: [{log_step('A')}, {{note: Then B}}, {log_step('B')}]}}\n"
            f"  - {log_step('C')}\n"
        )
        session = await run_flow("note-for", flow)

        assert session["status"] == "passed", session.get("status")
        assert log_lines("note-for") == run_lines("A", "B", "A", "B", "C")

    async def test_a_loop_body_that_starts_with_a_note_runs(self) -> None:
        flow = f"  - for: {{count: 2, body: [{{note: First}}, {log_step('B')}]}}\n"
        session = await run_flow("note-for-first", flow)

        assert session["status"] == "passed", session.get("status")
        assert log_lines("note-for-first") == run_lines("B", "B")

    async def test_a_while_body_that_starts_with_a_note_runs_until_its_condition_fails(
        self,
    ) -> None:
        flow = (
            "  - while:\n"
            "      conditions: x < 2\n"
            "      body: [{note: Count up}, {set: {x: {expr: x + 1}}}]\n"
        )
        session = await run_flow("note-while", flow, {"x": 0})

        assert session["status"] == "passed", session.get("status")
        assert session["variables"]["x"] == 2

    async def test_a_try_section_runs_on_past_a_note(self) -> None:
        flow = (
            f"  - try: {{steps: [{log_step('A')}, {{note: Then B}}, {log_step('B')}], catch: []}}\n"
            f"  - {log_step('C')}\n"
        )
        session = await run_flow("note-try", flow)

        assert session["status"] == "passed", session.get("status")
        assert log_lines("note-try") == run_lines("A", "B", "C")

    async def test_a_parallel_lane_runs_on_past_a_note(self) -> None:
        flow = (
            "  - parallel:\n"
            "      branches:\n"
            f"        - {{steps: [{log_step('A')}, {{note: Then B}}, {log_step('B')}]}}\n"
            f"        - {{steps: [{log_step('D')}]}}\n"
            f"  - {log_step('C')}\n"
        )
        session = await run_flow("note-parallel", flow)

        assert session["status"] == "passed", session.get("status")
        lines = log_lines("note-parallel")
        lane = [line for line in lines if "'A'" in line or "'B'" in line]
        assert lane == run_lines("A", "B")
        assert sorted(lines) == sorted(run_lines("A", "B", "D", "C"))

    async def test_a_switch_case_runs_on_past_a_note(self) -> None:
        flow = (
            "  - switch:\n"
            f"      cases: [{{when: x == 1, steps: [{{note: Then A}}, {log_step('A')}]}}]\n"
            f"  - {log_step('C')}\n"
        )
        session = await run_flow("note-switch", flow, {"x": 1})

        assert session["status"] == "passed", session.get("status")
        assert log_lines("note-switch") == run_lines("A", "C")

    async def test_the_flow_after_an_if_in_a_body_runs_on_past_a_note(self) -> None:
        flow = (
            "  - for:\n"
            "      count: 1\n"
            "      body:\n"
            f"        - if: {{when: x == 1, then: [{log_step('A')}]}}\n"
            "        - note: Then B\n"
            f"        - {log_step('B')}\n"
        )
        session = await run_flow("note-if-join", flow, {"x": 1})

        assert session["status"] == "passed", session.get("status")
        assert log_lines("note-if-join") == run_lines("A", "B")

    @pytest.mark.parametrize(("x", "ran"), [(1, ("A", "B")), (2, ("B",))])
    async def test_the_run_goes_on_past_a_note_where_the_paths_of_an_if_join(
        self, x: int, ran: tuple[str, ...]
    ) -> None:
        flow = (
            f"  - if: {{when: x == 1, then: [{log_step('A')}]}}\n"
            "  - note: Both paths meet here\n"
            f"  - {log_step('B')}\n"
        )
        session = await run_flow(f"note-join-{x}", flow, {"x": x})

        assert session["status"] == "passed", session.get("status")
        assert log_lines(f"note-join-{x}") == run_lines(*ran)

    async def test_a_body_that_never_runs_paints_the_blocks_past_a_note_skipped(self) -> None:
        flow = (
            f"  - for: {{count: 0, body: [{{note: Not run}}, {log_step('A')}]}}\n"
            f"  - {log_step('C')}\n"
        )
        workflow = compile_flow(flow)
        session = await run_graph("note-skip", workflow["nodes"], workflow["edges"], {})

        labels = {node["id"]: node["data"]["label"] for node in workflow["nodes"]}
        states = {labels[node_id]: state for node_id, state in session["block_states"].items()}
        assert session["status"] == "passed", session.get("status")
        assert states == {"For Loop": "passed", "A": "skipped", "C": "passed"}
