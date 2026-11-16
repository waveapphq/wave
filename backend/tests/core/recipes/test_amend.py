"""Amend enablers on the compiler side: recipeKey stamping, key identity, pinned relayout, rejoins.

The compiler-side enablers the amend loop rides on: every emitted node carries a
stable opaque recipeKey, an explicit key sibling maps through verbatim, harvested
keys drive pinned relayout, and construct rejoins survive recompile. A Test holding
a setting no recipe can express is refused.
"""

from typing import Any

from tests.core.recipes.conftest import LOG_STEP, make_recipe


def compile_recipe(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe as compile_fn

    return compile_fn(text)


def compile_clean(text: str) -> dict[str, Any]:
    result = compile_recipe(text)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


def layout_workflow(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    pinned: dict[str, dict[str, float]] | None = None,
) -> dict[str, dict[str, float]]:
    from wavecore.core.layout.engine import layout_workflow as layout_fn

    return layout_fn(nodes, edges, pinned)


def nodes_of(result: dict[str, Any]) -> list[dict[str, Any]]:
    return result["test_data"]["workflow"]["nodes"]


def all_edges(result: dict[str, Any]) -> list[dict[str, Any]]:
    return result["test_data"]["workflow"]["edges"]


def edge_between(result: dict[str, Any], source: str, target: str) -> dict[str, Any]:
    matches = [
        edge for edge in all_edges(result) if edge["source"] == source and edge["target"] == target
    ]
    assert len(matches) == 1, f"expected one edge {source}->{target}, got {matches!r}"
    return matches[0]


class TestRecipeKeyStamping:
    def test_every_node_carries_a_unique_non_empty_recipe_key(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP, LOG_STEP]))
        keys = [node["data"]["recipeKey"] for node in nodes_of(result)]
        assert all(isinstance(key, str) and key for key in keys)
        assert len(set(keys)) == len(keys)

    def test_recipe_keys_are_stable_across_compiles(self) -> None:
        text = make_recipe([LOG_STEP, LOG_STEP])
        first = compile_clean(text)
        second = compile_clean(text)
        first_keys = [node["data"]["recipeKey"] for node in nodes_of(first)]
        second_keys = [node["data"]["recipeKey"] for node in nodes_of(second)]
        assert first_keys == second_keys

    def test_recipe_key_is_data_scoped_not_a_top_level_node_field(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP]))
        node = nodes_of(result)[0]
        assert "recipeKey" not in node
        assert node["data"]["recipeKey"]


class TestRecipeKeyIdentity:
    def test_explicit_key_sibling_becomes_the_recipe_key(self) -> None:
        result = compile_clean(
            make_recipe(
                [
                    {"block": "log", "key": "k-alpha", "settings": {"message": "x"}},
                    LOG_STEP,
                ]
            )
        )
        nodes = nodes_of(result)
        assert nodes[0]["data"]["recipeKey"] == "k-alpha"

    def test_keyless_step_gets_a_fresh_key_distinct_from_keyed_siblings(self) -> None:
        result = compile_clean(
            make_recipe(
                [
                    {"block": "log", "key": "k-alpha", "settings": {"message": "x"}},
                    LOG_STEP,
                ]
            )
        )
        keyless = nodes_of(result)[1]["data"]["recipeKey"]
        assert keyless
        assert keyless != "k-alpha"


class TestPinnedRelayout:
    def _v1(self) -> dict[str, Any]:
        return compile_clean(
            make_recipe(
                [
                    {"block": "log", "key": "k-a", "settings": {"message": "a"}},
                    {"block": "log", "key": "k-b", "settings": {"message": "b"}},
                ]
            )
        )

    def _v2(self) -> dict[str, Any]:
        return compile_clean(
            make_recipe(
                [
                    {"block": "log", "settings": {"message": "new"}},
                    {"block": "log", "key": "k-a", "settings": {"message": "a"}},
                    {"block": "log", "key": "k-b", "settings": {"message": "b"}},
                ]
            )
        )

    def test_pinned_relayout_keeps_dragged_positions_for_stable_nodes(self) -> None:
        v1_nodes = nodes_of(self._v1())
        harvested = {node["data"]["recipeKey"]: node["position"] for node in v1_nodes}
        # Simulate a human drag of the k-a node to a distinctive position.
        harvested["k-a"] = {"x": 999.0, "y": -7.0}

        v2 = self._v2()
        v2_nodes = nodes_of(v2)
        v2_edges = all_edges(v2)
        pinned = {
            node["id"]: harvested[node["data"]["recipeKey"]]
            for node in v2_nodes
            if node["data"]["recipeKey"] in harvested
        }
        positions = layout_workflow(v2_nodes, v2_edges, pinned)

        stable_a = next(n for n in v2_nodes if n["data"]["recipeKey"] == "k-a")
        stable_b = next(n for n in v2_nodes if n["data"]["recipeKey"] == "k-b")
        fresh = next(n for n in v2_nodes if n["data"]["recipeKey"] not in ("k-a", "k-b"))
        assert positions[stable_a["id"]] == {"x": 999.0, "y": -7.0}
        assert positions[stable_b["id"]] == harvested["k-b"]
        assert positions[fresh["id"]] not in ({"x": 999.0, "y": -7.0}, harvested["k-b"])


def log_step(label: str, message: str | None = None) -> dict[str, Any]:
    return {"block": "log", "label": label, "settings": {"message": message or label.lower()}}


RELEASE_BODY = [log_step("API health check"), log_step("Verify API health")]
PING_STEP = log_step("Ping app server")


def release_recipe(body: list[dict[str, Any]], name: str = "Release Smoke Check") -> str:
    """An If/Else whose then-branch holds a Remote Execution running `body`, followed by
    top-level steps the Remote's continuation carries; the else-branch ends in a Halt."""
    remote = {"remote": {"settings": {"session_id": {"expr": "ssh_session"}}, "body": body}}
    halt = {"halt": {"scope": "test", "status": "failed", "message": "service down"}}
    flow = [
        log_step("Connect to app server"),
        log_step("Check orders-api service"),
        {"if": {"when": "svc_ok", "then": [remote], "else": [log_step("Alert on-call"), halt]}},
        log_step("Query release DB"),
        log_step("Verify release"),
        log_step("Disconnect"),
    ]
    variables = {
        "svc_ok": {"type": "boolean", "value": True},
        "ssh_session": {"type": "string", "value": "session"},
    }
    return make_recipe(flow, name=name, variables=variables)


def positions_by_label(workflow: dict[str, Any]) -> dict[str, dict[str, float]]:
    return {node["data"]["label"]: node["position"] for node in workflow["nodes"]}


def overlapping_pairs(workflow: dict[str, Any]) -> list[tuple[str, str]]:
    """Every pair of Blocks whose boxes, at the canvas's own sizes, overlap."""
    from wavecore.core.layout.dimensions import estimate_node_size
    from wavecore.core.layout.engine import ingress_counts

    ingress = ingress_counts(workflow["edges"])
    boxes = []
    for node in workflow["nodes"]:
        width, height = estimate_node_size(node, ingress.get(node["id"], 0))
        boxes.append(
            (node["data"]["label"], node["position"]["x"], node["position"]["y"], width, height)
        )
    return [
        (first[0], second[0])
        for index, first in enumerate(boxes)
        for second in boxes[index + 1 :]
        if first[1] < second[1] + second[3]
        and second[1] < first[1] + first[3]
        and first[2] < second[2] + second[4]
        and second[2] < first[2] + first[4]
    ]


class TestRecompileCarriesGeometry:
    """An amend recompiles the whole recipe; the stored geometry rides on each Block itself."""

    def test_a_fresh_compile_of_the_nested_flow_overlaps_nothing(self) -> None:
        workflow = compile_clean(release_recipe(RELEASE_BODY))["test_data"]["workflow"]
        assert overlapping_pairs(workflow) == []

    def test_a_step_inserted_first_in_a_nested_body_moves_only_the_blocks_below_it(self) -> None:
        from wavecore.core.layout.revision import carry_geometry

        before = compile_clean(release_recipe(RELEASE_BODY))["test_data"]["workflow"]
        after = compile_clean(release_recipe([PING_STEP, *RELEASE_BODY]))["test_data"]["workflow"]
        carry_geometry(before, after)
        assert positions_by_label(after) == {
            "Connect to app server": {"x": -134, "y": 140},
            "Check orders-api service": {"x": -149, "y": 280},
            "If/Else": {"x": -80, "y": 420},
            "Remote Execution": {"x": -269, "y": 560},
            "Ping app server": {"x": -424, "y": 700},
            "API health check": {"x": -429, "y": 840},
            "Verify API health": {"x": -434, "y": 980},
            "Alert on-call": {"x": 226, "y": 560},
            "Halt": {"x": 240, "y": 700},
            "Query release DB": {"x": -269, "y": 1120},
            "Verify release": {"x": -259, "y": 1260},
            "Disconnect": {"x": -240, "y": 1400},
        }
        assert overlapping_pairs(after) == []


class TestRejoinPreservation:
    def _compile_three_branch_if(self) -> dict[str, Any]:
        flow = [
            {
                "if": {
                    "when": "x == 1",
                    "then": [LOG_STEP],
                    "elif": [{"when": "x == 2", "then": [LOG_STEP]}],
                    "else": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        variables = {"x": {"type": "integer", "value": 1}}
        return compile_clean(make_recipe(flow, variables=variables))

    def test_rejoin_edges_survive_and_every_node_is_keyed_for_amend(self) -> None:
        result = self._compile_three_branch_if()
        assert edge_between(result, "node-2", "node-5").get("targetHandle") is None
        assert edge_between(result, "node-3", "node-5")["targetHandle"] == "ingress_1"
        assert edge_between(result, "node-4", "node-5")["targetHandle"] == "ingress_2"
        # Amend re-pins keyed nodes on recompile, so each must carry a recipeKey.
        for node in nodes_of(result):
            assert node["data"]["recipeKey"]


def _field_loss_workflow() -> dict[str, Any]:
    """A For holding a stored value no recipe key writes: a setting the format cannot express."""
    return {
        "nodes": [
            {
                "id": "loop-1",
                "type": "workflowNode",
                "position": {"x": 100, "y": 100},
                "data": {
                    "label": "Count",
                    "elementType": "for",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"mode": "count", "count": 2, "shade": "red"}},
                },
            }
        ],
        "edges": [{"id": "edge-start-loop-1", "source": "start-node", "target": "loop-1"}],
    }


class TestAmendRefusesAFieldLoss:
    """A stored Test holding a setting the recipe format cannot express is never amended,
    so nothing it holds is silently dropped (REQ-5.2.7.6)."""

    def test_amending_a_test_that_holds_a_field_loss_is_refused_with_the_problem_text(
        self,
    ) -> None:
        from tests.mcp.test_tools_author import _write_test_with_workflow
        from wavecore.api.services.tests import service as test_service
        from wavecore.mcp.tools import author

        test_id = _write_test_with_workflow("Amend Field Loss", _field_loss_workflow())
        readback = author.get_test_recipe(test_id)
        assert readback["inexpressible"] == [
            {"what": "setting 'shade' of block 'Count'", "where": "loop-1"}
        ]

        result = author.amend_test_from_recipe(
            test_id, make_recipe([LOG_STEP], name="Amend Field Loss")
        )

        assert result == {
            "amended": False,
            "findings": [
                {
                    "step": "test",
                    "code": "TARGET_NOT_RECIPE_EXPRESSIBLE",
                    "severity": "error",
                    "problem": (
                        "The target test holds wiring or settings the recipe format cannot "
                        "express; amending it through a recipe would drop them."
                    ),
                    "fix": (
                        "Edit this test directly in the workbench. Recipe amendment is "
                        "available only for tests that round-trip fully."
                    ),
                }
            ],
        }
        stored = test_service.get_test(test_id)
        assert stored is not None
        assert stored["version"] == "1.0.0"
