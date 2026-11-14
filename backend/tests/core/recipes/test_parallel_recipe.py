"""The `parallel` recipe construct: shape checks, compilation, readback.

The recipe vocabulary matches the built model exactly: named branches
each holding their own `steps` and an optional `time_limit`, a `join` mode, and
a section-level `time_limit`. `wait_strategy`, `wait_condition`, `timeout` and
`capture` are gone. A compiled section wires `branch_1..N` lanes and leaves
through `then`, so a compiled test and a hand-built one are indistinguishable.
"""

from typing import Any

import pytest
import yaml

from tests.core.recipes.conftest import LOG_STEP, find_finding, make_recipe
from tests.core.recipes.test_compiler_constructs import (
    compile_clean,
    compile_recipe,
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


TWO_LANES_PROBLEM = "Parallel requires at least 2 branches"
LANE_LIMIT_PROBLEM = "Parallel branch time limit must be a positive integer"
LIMIT_VARIABLES = {
    "probe_ms": {"type": "integer", "value": 30000},
    "section_ms": {"type": "integer", "value": 60000},
}


def malformed(flow: list[Any], reason: str) -> None:
    """Assert the flow produces exactly the INVALID_CONSTRUCT message for ``reason``."""
    findings = compile_findings(make_recipe(flow))
    finding = find_finding(findings, "INVALID_CONSTRUCT")
    assert finding["problem"] == f"'parallel' construct is malformed: {reason}"
    assert finding["severity"] == "error"
    assert finding["fix"] is None


def refused(flow: list[Any], code: str, step: str, problem: str, fix: str | None) -> None:
    """Assert the flow produces exactly one ``code`` finding with these texts."""
    findings = compile_findings(make_recipe(flow))
    assert find_finding(findings, code) == {
        "step": step,
        "code": code,
        "severity": "error",
        "problem": problem,
        "fix": fix,
    }


def lane_limit_flow(limit: Any) -> list[dict[str, Any]]:
    """A two-lane section whose second lane carries ``limit``."""
    return [
        {
            "parallel": {
                "branches": [
                    {"name": "ingest", "steps": [LOG_STEP]},
                    {"name": "probe", "time_limit": limit, "steps": [LOG_STEP]},
                ]
            }
        },
        LOG_STEP,
    ]


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
        refused(
            [{"parallel": {}}],
            "INVALID_CONTROL_STRUCTURE",
            "flow[0].parallel.branches",
            TWO_LANES_PROBLEM,
            None,
        )

    def test_a_single_branch_is_rejected(self) -> None:
        flow = [{"parallel": {"branches": [{"steps": [LOG_STEP]}]}}]
        refused(
            flow, "INVALID_CONTROL_STRUCTURE", "flow[0].parallel.branches", TWO_LANES_PROBLEM, None
        )

    def test_an_empty_branch_list_is_rejected(self) -> None:
        refused(
            [{"parallel": {"branches": []}}],
            "INVALID_CONTROL_STRUCTURE",
            "flow[0].parallel.branches",
            TWO_LANES_PROBLEM,
            None,
        )

    def test_a_branch_count_is_rejected(self) -> None:
        # Guard: branches is a list of branch mappings, never an integer count.
        refused(
            [{"parallel": {"branches": 2}}],
            "INVALID_CONTROL_STRUCTURE",
            "flow[0].parallel.branches",
            TWO_LANES_PROBLEM,
            None,
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
        refused(
            flow,
            "INVALID_SETTING_VALUE",
            "flow[0].parallel.branches[0].time_limit",
            LANE_LIMIT_PROBLEM,
            None,
        )

    @pytest.mark.parametrize(
        "limit",
        [{"template": "500"}, {"template": 500}, {"template": "{{ probe_ms }}"}],
        ids=["text", "number", "marker"],
    )
    def test_a_branch_time_limit_takes_no_template(self, limit: dict[str, Any]) -> None:
        result = compile_recipe(make_recipe(lane_limit_flow(limit), variables=LIMIT_VARIABLES))
        assert result["test_data"] is None
        assert result["findings"] == [
            {
                "step": "flow[0].parallel.branches[1].time_limit",
                "code": "TEMPLATE_NOT_ALLOWED",
                "severity": "error",
                "problem": "'branches.1.time_limit' takes no template; templates apply to a "
                "whole text setting, a Variable Setter row or entry, and a text compare-to value",
                "fix": "Use {expr: ...} for a computed value",
            }
        ]

    def test_a_section_time_limit_must_be_a_positive_integer(self) -> None:
        refused(
            parallel_flow(time_limit=-1),
            "SETTING_BELOW_MINIMUM",
            "flow[0].parallel.time_limit",
            "Setting 'time_limit' of block 'parallel' must be at least 1, got -1",
            "Provide a value of at least 1",
        )

    def test_a_string_section_time_limit_is_rejected(self) -> None:
        refused(
            parallel_flow(time_limit="30s"),
            "INVALID_SETTING_TYPE",
            "flow[0].parallel.time_limit",
            "Setting 'time_limit' of block 'parallel' expects integer, got string",
            "Provide an integer value",
        )

    def test_a_section_time_limit_written_as_its_digits_is_clean(self) -> None:
        # REQ-3.1.3.14: digit text is the whole number it spells.
        assert validate(make_recipe(parallel_flow(time_limit="60000"))) == []

    def test_the_join_mode_is_an_enum(self) -> None:
        refused(
            parallel_flow(join="race"),
            "INVALID_ENUM_VALUE",
            "flow[0].parallel.join",
            "Setting 'join' of block 'parallel' must be one of: all, first",
            "Use one of the listed values",
        )

    def test_wait_any_is_not_a_join_mode(self) -> None:
        refused(
            parallel_flow(join="wait-any"),
            "INVALID_ENUM_VALUE",
            "flow[0].parallel.join",
            "Setting 'join' of block 'parallel' must be one of: all, first",
            "Use one of the listed values",
        )


class TestParallelUnknownKeys:
    """The format rejects what the construct does not define."""

    def _unknown_key(self, flow: list[Any], key: str) -> None:
        findings = compile_findings(make_recipe(flow))
        finding = find_finding(findings, "UNKNOWN_STEP_KEY")
        assert finding["problem"] == f"Unknown key '{key}' on a 'parallel' construct"

    def test_wait_strategy_is_not_a_parallel_key(self) -> None:
        self._unknown_key(parallel_flow(wait_strategy="wait-all"), "wait_strategy")

    def test_wait_condition_is_not_a_parallel_key(self) -> None:
        self._unknown_key(parallel_flow(wait_condition="done"), "wait_condition")

    def test_timeout_is_not_a_parallel_key(self) -> None:
        self._unknown_key(parallel_flow(timeout=1000), "timeout")

    def test_capture_is_not_a_parallel_key(self) -> None:
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

    def test_a_lane_expression_limit_is_stored_as_text_with_a_dotted_flag(self) -> None:
        result = compile_clean(
            make_recipe(lane_limit_flow({"expr": "probe_ms"}), variables=LIMIT_VARIABLES)
        )
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"]["branches"] == [
            {"id": "branch_1", "name": "ingest"},
            {"id": "branch_2", "name": "probe", "time_limit": "probe_ms"},
        ]
        assert data["expressionFields"] == ["branches.1.time_limit"]

    def test_a_section_expression_limit_is_stored_as_text_with_its_flag(self) -> None:
        recipe = make_recipe(
            parallel_flow(time_limit={"expr": "section_ms"}), variables=LIMIT_VARIABLES
        )
        data = nodes_by_id(compile_clean(recipe))["node-1"]["data"]
        assert data["config"]["values"]["time_limit"] == "section_ms"
        assert data["expressionFields"] == ["time_limit"]

    def test_one_lane_is_refused_with_the_control_structure_text(self) -> None:
        flow = [{"parallel": {"branches": [{"name": "ingest", "steps": [LOG_STEP]}]}}, LOG_STEP]
        result = compile_recipe(make_recipe(flow))
        assert result["test_data"] is None
        assert find_finding(result["findings"], "INVALID_CONTROL_STRUCTURE") == {
            "step": "flow[0].parallel.branches",
            "code": "INVALID_CONTROL_STRUCTURE",
            "severity": "error",
            "problem": TWO_LANES_PROBLEM,
            "fix": None,
        }

    def test_a_lane_limit_of_zero_is_refused_with_the_control_structure_text(self) -> None:
        result = compile_recipe(make_recipe(lane_limit_flow(0)))
        assert result["test_data"] is None
        assert find_finding(result["findings"], "INVALID_SETTING_VALUE") == {
            "step": "flow[0].parallel.branches[1].time_limit",
            "code": "INVALID_SETTING_VALUE",
            "severity": "error",
            "problem": LANE_LIMIT_PROBLEM,
            "fix": None,
        }


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

    def test_the_default_join_mode_is_written_back(self) -> None:
        assert self._readback_step()["join"] == "all"

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

    def test_the_readback_never_emits_an_unknown_key(self) -> None:
        step = self._readback_step(join="first", time_limit=60000)
        for key in ("wait_strategy", "wait_condition", "timeout", "capture"):
            assert key not in step, step

    def test_expression_limits_read_back_as_expressions_and_validate_clean(self) -> None:
        flow = lane_limit_flow({"expr": "probe_ms"})
        flow[0]["parallel"]["time_limit"] = {"expr": "section_ms"}
        recipe = make_recipe(flow, variables=LIMIT_VARIABLES)
        assert validate(recipe) == []
        readback = decompile(compile_clean(recipe)["test_data"])["recipe"]
        step = yaml.safe_load(readback)["flow"][0]["parallel"]
        assert step["branches"][1]["time_limit"] == {"expr": "probe_ms"}
        assert "time_limit" not in step["branches"][0]
        assert step["time_limit"] == {"expr": "section_ms"}
        assert validate(readback) == []
        assert_round_trip(recipe)
