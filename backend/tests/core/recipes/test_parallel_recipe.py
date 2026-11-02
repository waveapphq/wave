"""The `parallel` recipe construct: shape checks, compilation, readback.

The recipe vocabulary matches the built model exactly: named branches
each holding their own `steps` and an optional `time_limit`, a `join` mode, and
a section-level `time_limit`. `wait_strategy`, `wait_condition`, `timeout` and
`capture` are gone. A compiled section wires `branch_1..N` lanes and leaves
through `then`, so a compiled test and a hand-built one are indistinguishable.
"""

from typing import Any

import yaml

from tests.core.recipes.conftest import LOG_STEP, find_finding, make_recipe
from tests.core.recipes.test_compiler_constructs import (
    compile_clean,
    edge_between,
    edges_from,
    nodes_by_id,
    values_of,
)
from tests.core.recipes.test_decompiler import assert_round_trip, decompile
from tests.core.recipes.test_validator import compile_findings, validate

TWO_BRANCHES: list[dict[str, Any]] = [
    {"name": "ingest", "steps": [LOG_STEP]},
    {"name": "probe", "steps": [LOG_STEP]},
]


def parallel_flow(**value: Any) -> list[dict[str, Any]]:
    """A flow holding one parallel step followed by a trailing block."""
    step: dict[str, Any] = {"branches": [dict(item) for item in TWO_BRANCHES]}
    step.update(value)
    return [{"parallel": step}, LOG_STEP]


def malformed(flow: list[Any], reason: str) -> None:
    """Assert the flow produces exactly the INVALID_CONSTRUCT message for ``reason``."""
    findings = compile_findings(make_recipe(flow))
    finding = find_finding(findings, "INVALID_CONSTRUCT")
    assert finding["problem"] == f"'parallel' construct is malformed: {reason}"
    assert finding["severity"] == "error"
    assert finding["fix"] is None


class TestParallelShapeChecks:
    """Section 4.2 validator messages, verbatim."""

    def test_a_two_branch_section_is_clean(self) -> None:
        assert validate(make_recipe(parallel_flow())) == []

    def test_a_section_with_join_and_limits_is_clean(self) -> None:
        flow = [
            {
                "parallel": {
                    "branches": [
                        {"name": "ingest", "time_limit": 30000, "steps": [LOG_STEP]},
                        {"name": "probe", "steps": [LOG_STEP]},
                    ],
                    "join": "first",
                    "time_limit": 60000,
                }
            }
        ]
        assert validate(make_recipe(flow)) == []

    def test_branches_are_required(self) -> None:
        malformed(
            [{"parallel": {}}],
            "a 'branches' list with at least two branches is required",
        )

    def test_a_single_branch_is_rejected(self) -> None:
        flow = [{"parallel": {"branches": [{"steps": [LOG_STEP]}]}}]
        malformed(flow, "a 'branches' list with at least two branches is required")

    def test_an_empty_branch_list_is_rejected(self) -> None:
        malformed(
            [{"parallel": {"branches": []}}],
            "a 'branches' list with at least two branches is required",
        )

    def test_a_branch_count_is_rejected(self) -> None:
        # Guard: branches is a list of branch mappings, never an integer count.
        malformed(
            [{"parallel": {"branches": 2}}],
            "a 'branches' list with at least two branches is required",
        )

    def test_each_branch_needs_its_own_steps(self) -> None:
        flow = [{"parallel": {"branches": [{"name": "ingest"}, {"steps": [LOG_STEP]}]}}]
        malformed(flow, "each branch needs a 'steps' list")

    def test_a_branch_that_is_not_a_mapping_is_rejected(self) -> None:
        flow = [{"parallel": {"branches": ["ingest", {"steps": [LOG_STEP]}]}}]
        malformed(flow, "each branch needs a 'steps' list")

    def test_a_branch_name_must_be_a_string(self) -> None:
        flow = [
            {
                "parallel": {
                    "branches": [
                        {"name": 7, "steps": [LOG_STEP]},
                        {"name": "probe", "steps": [LOG_STEP]},
                    ]
                }
            }
        ]
        malformed(flow, "branch 'name' must be a string")

    def test_a_branch_time_limit_must_be_a_positive_integer(self) -> None:
        flow = [
            {
                "parallel": {
                    "branches": [
                        {"name": "ingest", "time_limit": 0, "steps": [LOG_STEP]},
                        {"name": "probe", "steps": [LOG_STEP]},
                    ]
                }
            }
        ]
        malformed(flow, "'time_limit' must be a positive integer")

    def test_a_section_time_limit_must_be_a_positive_integer(self) -> None:
        malformed(parallel_flow(time_limit=-1), "'time_limit' must be a positive integer")

    def test_a_string_section_time_limit_is_rejected(self) -> None:
        malformed(parallel_flow(time_limit="30s"), "'time_limit' must be a positive integer")

    def test_a_section_time_limit_written_as_its_digits_is_clean(self) -> None:
        # REQ-3.1.3.14: digit text is the whole number it spells.
        assert validate(make_recipe(parallel_flow(time_limit="60000"))) == []

    def test_the_join_mode_is_an_enum(self) -> None:
        malformed(parallel_flow(join="race"), "'join' must be one of: all, first")

    def test_the_removed_wait_any_strategy_is_not_a_join_mode(self) -> None:
        # Guard: the discarded wait-any vocabulary must not be revived as a join value.
        malformed(parallel_flow(join="wait-any"), "'join' must be one of: all, first")


class TestParallelRemovedKeys:
    """The format rejects what the construct does not define."""

    def _unknown_key(self, flow: list[Any], key: str) -> None:
        findings = compile_findings(make_recipe(flow))
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["problem"] == f"Unknown key '{key}' on a 'parallel' construct"

    def test_wait_strategy_is_no_longer_a_parallel_key(self) -> None:
        self._unknown_key(parallel_flow(wait_strategy="wait-all"), "wait_strategy")

    def test_wait_condition_is_no_longer_a_parallel_key(self) -> None:
        self._unknown_key(parallel_flow(wait_condition="done"), "wait_condition")

    def test_timeout_is_no_longer_a_parallel_key(self) -> None:
        self._unknown_key(parallel_flow(timeout=1000), "timeout")

    def test_capture_is_no_longer_a_parallel_key(self) -> None:
        # Guard: the control binds nothing, so there is nothing to capture.
        self._unknown_key(parallel_flow(capture={"results": "out"}), "capture")


class TestParallelCompilation:
    """The emitted node carries the built model's branch list, join and limit."""

    def _compile(self, **value: Any) -> dict[str, Any]:
        return compile_clean(make_recipe(parallel_flow(**value)))

    def test_branches_compile_to_records_with_stable_ids(self) -> None:
        values = values_of(self._compile(), "node-1")
        assert values["branches"] == [
            {"id": "branch_1", "name": "ingest"},
            {"id": "branch_2", "name": "probe"},
        ]

    def test_the_join_mode_is_always_emitted(self) -> None:
        # The canvas and the control both default the mode; the compiler relies
        # on neither default.
        assert values_of(self._compile(), "node-1")["join"] == "all"

    def test_an_explicit_join_mode_is_emitted(self) -> None:
        assert values_of(self._compile(join="first"), "node-1")["join"] == "first"

    def test_an_omitted_section_limit_is_not_emitted(self) -> None:
        assert "time_limit" not in values_of(self._compile(), "node-1")

    def test_a_section_limit_is_emitted(self) -> None:
        assert values_of(self._compile(time_limit=60000), "node-1")["time_limit"] == 60000

    def test_a_branch_limit_rides_on_its_branch_record(self) -> None:
        flow = [
            {
                "parallel": {
                    "branches": [
                        {"name": "ingest", "time_limit": 30000, "steps": [LOG_STEP]},
                        {"steps": [LOG_STEP]},
                    ]
                }
            }
        ]
        values = values_of(compile_clean(make_recipe(flow)), "node-1")
        assert values["branches"] == [
            {"id": "branch_1", "name": "ingest", "time_limit": 30000},
            {"id": "branch_2", "name": ""},
        ]

    def test_the_section_binds_no_outputs(self) -> None:
        node = nodes_by_id(self._compile())["node-1"]
        assert node["data"]["config"]["outputBindings"] == {}

    def test_branch_edges_are_one_based(self) -> None:
        result = self._compile()
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "branch_1"
        assert edge_between(result, "node-1", "node-3")["sourceHandle"] == "branch_2"

    def test_the_continuation_leaves_through_the_then_handle(self) -> None:
        # Guard: branch bodies dead-end now; the flow leaves only through 'then'.
        result = self._compile()
        assert edge_between(result, "node-1", "node-4")["sourceHandle"] == "then"

    def test_no_branch_tail_rejoins_the_continuation(self) -> None:
        result = self._compile()
        assert edges_from(result, "node-2") == []
        assert edges_from(result, "node-3") == []

    def test_step_map_uses_branch_paths(self) -> None:
        result = self._compile()
        assert result["step_map"]["node-2"] == "flow[0].parallel.branches[0].steps[0]"
        assert result["step_map"]["node-3"] == "flow[0].parallel.branches[1].steps[0]"

    def test_a_three_branch_section_wires_three_lanes(self) -> None:
        flow = [
            {
                "parallel": {
                    "branches": [
                        {"steps": [LOG_STEP]},
                        {"steps": [LOG_STEP]},
                        {"steps": [LOG_STEP]},
                    ]
                }
            },
            LOG_STEP,
        ]
        result = compile_clean(make_recipe(flow))
        handles = sorted(str(edge.get("sourceHandle")) for edge in edges_from(result, "node-1"))
        assert handles == ["branch_1", "branch_2", "branch_3", "then"]


class TestParallelReadback:
    """The readback round-trips names, limits and join with no loss."""

    def test_a_plain_two_branch_section_round_trips(self) -> None:
        assert_round_trip(make_recipe(parallel_flow()))

    def test_names_limits_and_join_round_trip(self) -> None:
        flow = [
            {
                "parallel": {
                    "branches": [
                        {"name": "ingest", "time_limit": 30000, "steps": [LOG_STEP]},
                        {"name": "probe", "steps": [LOG_STEP]},
                    ],
                    "join": "first",
                    "time_limit": 60000,
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow))

    def test_a_nested_section_round_trips(self) -> None:
        inner = {
            "parallel": {
                "branches": [{"steps": [LOG_STEP]}, {"steps": [LOG_STEP]}],
            }
        }
        flow = [
            {"parallel": {"branches": [{"steps": [inner]}, {"steps": [LOG_STEP]}]}},
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow))

    def _readback_step(self, **value: Any) -> dict[str, Any]:
        test_data = compile_clean(make_recipe(parallel_flow(**value)))["test_data"]
        recipe = yaml.safe_load(decompile(test_data)["recipe"])
        return dict(recipe["flow"][0]["parallel"])

    def test_the_readback_carries_the_branch_names(self) -> None:
        step = self._readback_step()
        assert [entry["name"] for entry in step["branches"]] == ["ingest", "probe"]

    def test_the_default_join_mode_is_omitted_from_the_readback(self) -> None:
        assert "join" not in self._readback_step()

    def test_a_non_default_join_mode_is_written_back(self) -> None:
        assert self._readback_step(join="first")["join"] == "first"

    def test_an_unset_section_limit_is_omitted_from_the_readback(self) -> None:
        assert "time_limit" not in self._readback_step()

    def test_a_section_limit_is_written_back(self) -> None:
        assert self._readback_step(time_limit=60000)["time_limit"] == 60000

    def test_a_blank_branch_name_is_omitted_from_the_readback(self) -> None:
        flow = [
            {"parallel": {"branches": [{"steps": [LOG_STEP]}, {"steps": [LOG_STEP]}]}},
            LOG_STEP,
        ]
        test_data = compile_clean(make_recipe(flow))["test_data"]
        recipe = yaml.safe_load(decompile(test_data)["recipe"])
        branches = recipe["flow"][0]["parallel"]["branches"]
        assert all("name" not in entry for entry in branches), branches

    def test_the_readback_never_emits_the_removed_keys(self) -> None:
        # Guard: the readback must not resurrect a vocabulary the format dropped.
        step = self._readback_step(join="first", time_limit=60000)
        for key in ("wait_strategy", "wait_condition", "timeout", "capture"):
            assert key not in step, step
