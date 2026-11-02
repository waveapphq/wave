"""Amend enablers on the compiler side: recipeKey stamping, key identity, pinned relayout, rejoins.

The compiler-side enablers the amend loop rides on: every emitted node carries a
stable opaque recipeKey, an explicit key sibling maps through verbatim, harvested
keys drive pinned relayout, and construct rejoins survive recompile.
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
