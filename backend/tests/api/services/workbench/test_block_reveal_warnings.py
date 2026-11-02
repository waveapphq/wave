"""Reveal warnings for Blocks at every place a Block runs (REQ-3.1.3.5).

A Block whose run output reveals secrets gets one WARN right before it runs, wherever it sits:
the main flow, a loop or Wait Until body, a Try path or a Function body; the run-start WARN names
every such Block, library Function bodies included. Driven through the workbench service and
the real engine.
"""

import uuid
from collections.abc import Iterator
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    function_node,
    local_definition,
    log_node,
    run_graph,
)
from tests.api.services.workbench.slot_harness import in_slot
from wavecore.api.services import log_streaming_service
from wavecore.api.services.functions import _storage as _function_storage
from wavecore.core.secrets import masking_settings

PRE_BLOCK = (
    "Secret masking bypassed for this block - "
    "secret values appear in cleartext in its logs and reports."
)


@pytest.fixture(autouse=True)
def _registries(engine_registries: Any) -> Iterator[None]:  # noqa: F811
    masking_settings.set_reveal_settings(
        run_output=False, test_variables=False, shared_variables=False
    )
    yield
    masking_settings.set_reveal_settings(
        run_output=False, test_variables=False, shared_variables=False
    )


def _revealing_log(node_id: str) -> dict[str, Any]:
    node = log_node(node_id, node_id, f"'{node_id} ran'")
    node["data"]["config"]["secret_masking"] = "reveal"
    return node


def _warnings(session_id: str) -> list[tuple[str, str | None]]:
    return [
        (entry["message"], entry.get("blockId"))
        for entry in log_streaming_service.get_logs(session_id)
        if entry.get("level") == "WARN"
    ]


def _library_function(name: str, body_nodes: list[dict[str, Any]]) -> str:
    """Publish a library Function whose body is ``body_nodes`` in a row; returns its id."""
    function_id = str(uuid.uuid4())
    edges = [edge("start-node", body_nodes[0]["id"])]
    edges += [edge(a["id"], b["id"]) for a, b in zip(body_nodes, body_nodes[1:], strict=False)]
    _function_storage.save_new_version(
        function_id,
        "1.0.0",
        {**local_definition(name, body_nodes, edges), "variables": []},
        {"published_at": "2026-10-20T00:00:00Z", "published_by": "wave"},
        name=name,
    )
    return function_id


def _shared_block(node_id: str, function_id: str) -> dict[str, Any]:
    node = function_node(node_id, {})
    data = node["data"]
    del data["localDefinition"]
    data.update(functionLifecycle="shared", functionId=function_id, functionVersion="1.0.0")
    return node


class TestPreBlockWarning:
    """One WARN right before a revealing Block runs, wherever the Block sits."""

    async def test_a_block_on_the_main_flow(self) -> None:
        session = await run_graph(
            "reveal-main", [_revealing_log("main-log")], [edge("start-node", "main-log")], {}
        )

        assert session["status"] == "passed", session.get("error")
        assert (PRE_BLOCK, "main-log") in _warnings("reveal-main")

    @pytest.mark.parametrize(
        "slot",
        [
            "for-body",
            "for-each-body",
            "while-body",
            "wait-until-body",
            "try-path",
            "function-body",
        ],
    )
    async def test_a_block_inside_a_container_slot(self, slot: str) -> None:
        graph = in_slot(slot, [_revealing_log("inner-log")], [], "inner-log", "inner-log")
        session_id = f"reveal-{slot}"

        session = await run_graph(session_id, graph.nodes, graph.edges, graph.variables)

        assert session["status"] == "passed", session.get("error")
        assert _warnings(session_id).count((PRE_BLOCK, "inner-log")) == 1

    async def test_a_block_inside_a_library_function_body(self) -> None:
        function_id = _library_function("Library", [_revealing_log("library-log")])
        nodes = [_shared_block("fn", function_id)]

        session = await run_graph("reveal-library", nodes, [edge("start-node", "fn")], {})

        assert session["status"] == "passed", session.get("error")
        assert (PRE_BLOCK, "library-log") in _warnings("reveal-library")


class TestRunStartWarning:
    """The run-start WARN names the revealing Blocks of library Function bodies too."""

    async def test_a_library_function_body_block_is_named(self) -> None:
        function_id = _library_function("Library", [_revealing_log("library-log")])
        nodes = [_revealing_log("main-log"), _shared_block("fn", function_id)]
        edges = [edge("start-node", "main-log"), edge("main-log", "fn")]

        session = await run_graph("reveal-start", nodes, edges, {})

        assert session["status"] == "passed", session.get("error")
        assert (
            "Secret masking bypassed for 2 block(s): main-log, library-log. "
            "Secret values appear in cleartext in this run's logs and reports.",
            None,
        ) in _warnings("reveal-start")

    async def test_a_library_function_that_is_gone_is_left_to_its_block(self) -> None:
        nodes = [_revealing_log("main-log"), _shared_block("fn", str(uuid.uuid4()))]
        edges = [edge("start-node", "main-log"), edge("main-log", "fn")]

        await run_graph("reveal-gone", nodes, edges, {})

        assert (
            "Secret masking bypassed for 1 block(s): main-log. "
            "Secret values appear in cleartext in this run's logs and reports.",
            None,
        ) in _warnings("reveal-gone")
