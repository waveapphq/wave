"""Watch-mode build tool: build_test_from_recipe.

The watch tool mirrors create_test_from_recipe's secret / compile / up-front
name-conflict checks, then holds the workbench slot as the MCP across a paced
reveal that pushes one growing draft frame per node through ownership.apply_draft
(each frame carrying active_node_id) before persisting through the strict create
pipeline. A take-over requested mid-reveal abandons the build without saving and
hands the slot to the requester.
"""

import asyncio
import contextlib
from typing import Any

from wavecore.api.services.network import ssh_hosts
from wavecore.api.services.tests import service as test_service
from wavecore.core.recipes.compiler import compile_recipe
from wavecore.core.recipes.model import finding
from wavecore.core.recipes.reveal import reveal_frames
from wavecore.mcp.tools import author

REVEAL_STEP_DELAY_S: float = 0.4


def _abandonment(holder_id: str) -> str | None:
    """Why this build must stop holding the slot, or None while it still holds it."""
    from wavecore.api.services.workbench import ownership

    state = ownership.get_ownership()
    holder = state["holder"]
    if holder is None:
        return "slot_lost"
    if holder["id"] != holder_id:
        return "force_taken"
    if state["pending_takeover"] is not None:
        return "taken_over"
    return None


async def build_test_from_recipe(recipe: str, session_id: str | None = None) -> dict[str, Any]:
    """Build a test live: reveal each node into the mirrored draft, then save."""
    from wavecore.api.exceptions import ConflictException
    from wavecore.api.services.workbench import ownership
    from wavecore.mcp import state as mcp_state

    recipe, secret_findings = author._resolve_secret_files(recipe)
    if secret_findings:
        return {"built": False, "findings": secret_findings}

    result = compile_recipe(
        recipe, testdata_dirs=[], placement_defaults=ssh_hosts.placement_defaults()
    )
    findings = list(result["findings"])
    test_data = result["test_data"]
    if test_data is None:
        return {"built": False, "findings": findings}

    conflict = author.name_conflict_finding(str(test_data.get("name") or ""))
    if conflict is not None:
        findings.append(conflict)
        return {"built": False, "findings": findings}

    warnings = [item for item in findings if item["severity"] == "warning"]
    holder_id = session_id or "mcp"
    try:
        ownership.claim(holder_id, mcp_state.mcp_holder_label(holder_id), "mcp")
    except ConflictException as exc:
        findings.append(finding("test", "SESSION_HELD", exc.message, author.SESSION_HELD_FIX))
        return {"built": False, "findings": findings}

    try:
        for frame in reveal_frames(test_data):
            # No await between the check and the write, so the slot cannot move.
            released = _abandonment(holder_id)
            if released is not None:
                return {"built": False, "released": released}
            # Mid-build the surface is an unsaved draft bound to no test yet.
            payload = ownership.apply_draft(
                holder_id, {**frame, "test_id": None, "test_name": None, "dirty": True}
            )
            await ownership.broadcast_draft(payload)
            await asyncio.sleep(REVEAL_STEP_DELAY_S)
        # The reveal is finished, so a polite request costs the build nothing: save it,
        # then hand the slot over on the way out.
        released = _abandonment(holder_id)
        if released in ("slot_lost", "force_taken"):
            return {"built": False, "released": released}
        created = test_service.create_test(test_data)
        # The build is saved: bind the mirrored surface to the new test, clean.
        payload = ownership.apply_draft(
            holder_id,
            {
                "nodes": test_data["workflow"]["nodes"],
                "edges": test_data["workflow"]["edges"],
                "variables": test_data["variables"],
                "test_id": created["id"],
                "test_name": created["name"],
                "dirty": False,
                "active_node_id": None,
            },
        )
        await ownership.broadcast_draft(payload)
    finally:
        with contextlib.suppress(ConflictException):
            ownership.release(holder_id, "handoff")

    return {
        "built": True,
        "test_id": created["id"],
        "name": created["name"],
        "version": created["version"],
        "warnings": warnings,
        "repairs": created.get("repairs", []),
        "action_items": author.no_value_action_items(test_data),
    }
