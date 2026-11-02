"""A Block reads its profile binding with the run's environment wherever it sits.

The same profile-bound Block runs at the root, in every sub-flow walker slot and inside a
Function body; each read of its profile names the environment the run was started with.
"""

import asyncio
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    log_node,
    make_session,
)
from tests.api.services.workbench.slot_harness import in_slot
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

pytestmark = pytest.mark.usefixtures("engine_registries")

ENVIRONMENT_ID = "env-staging"

SLOTS = [
    "for-body",
    "for-each-body",
    "while-body",
    "wait-until-body",
    "try-path",
    "function-body",
]


def _profiled() -> dict[str, Any]:
    node = log_node("a", "A", "api.url")
    node["data"]["config"]["profileBindings"] = [{"profileId": "p1", "alias": "api"}]
    return node


async def _environments_read(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]], variables: dict[str, Any]
) -> list[str]:
    session_id = f"profile-environment-{uuid.uuid4().hex[:8]}"
    session = make_session(session_id)
    session["environment_id"] = ENVIRONMENT_ID
    _wb_common._workbench_sessions[session_id] = session
    config = MagicMock(return_value={"url": "https://staging.example"})
    with (
        patch("wavecore.api.services.profiles.service.get_profile_config_for_execution", config),
        patch(
            "wavecore.api.services.profiles.service.get_profile_secret_field_names",
            MagicMock(return_value=set()),
        ),
    ):
        await asyncio.wait_for(
            workbench_service._execute_workflow(
                session_id, nodes, edges, variables, environment_id=ENVIRONMENT_ID
            ),
            timeout=5,
        )
    assert _wb_common._workbench_sessions[session_id]["status"] == "passed"
    return [call.args[1] for call in config.call_args_list]


async def test_a_root_block_reads_its_profile_with_the_run_environment() -> None:
    read = await _environments_read([_profiled()], [edge("start-node", "a")], {})

    assert read == [ENVIRONMENT_ID]


@pytest.mark.parametrize("slot", SLOTS)
async def test_a_block_in_a_sub_flow_reads_its_profile_with_the_run_environment(
    slot: str,
) -> None:
    graph = in_slot(slot, [_profiled()], [], "a", "a")

    read = await _environments_read(graph.nodes, graph.edges, graph.variables)

    assert read, "the profile was never read"
    assert set(read) == {ENVIRONMENT_ID}
