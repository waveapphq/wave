"""Watch-mode tools: build_test_from_recipe and amend_test_live_from_recipe.

Each runs its fast counterpart's checks, the save's own checks included, before it claims
the workbench slot. Holding it as the MCP, it streams paced draft frames through
ownership.apply_draft (each carrying the finished test's bounds and what the assistant is
doing), saves once, shows the test as saved and hands the slot back. A take-over requested
mid-stream abandons the work without saving and hands the slot to the requester.
"""

import asyncio
import contextlib
from collections.abc import Callable, Iterable, Iterator, Mapping
from typing import Any

from wavecore.api.services.network import ssh_hosts
from wavecore.api.services.tests import service as test_service
from wavecore.core.recipes.compiler import compile_recipe
from wavecore.core.recipes.model import finding
from wavecore.core.recipes.reveal import change_frames, reveal_frames
from wavecore.mcp.tools import author

REVEAL_STEP_DELAY_S: float = 0.4
# After a change's first step, so the canvas's glide to the new places settles before a turn.
ROOM_STEP_DELAY_S: float = 0.6

SESSION_HELD_HERE_PROBLEM = (
    "This session already holds the workbench session for a run or another "
    "watched build or change"
)
SESSION_HELD_HERE_FIX = "Wait until it ends, then retry"


def _abandonment(holder_id: str) -> str | None:
    """Why the stream must stop holding the slot, or None while it still holds it."""
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


def _saved_frame(test_id: str) -> dict[str, Any]:
    """The test exactly as saved and as a read serves it: bound to it, clean, nothing streaming."""
    from wavecore.mcp.tools.discover import resolve_test

    saved = resolve_test(test_id)
    return {
        "nodes": saved["workflow"]["nodes"],
        "edges": saved["workflow"]["edges"],
        "variables": saved["variables"],
        "test_id": saved["id"],
        "test_name": saved["name"],
        "dirty": False,
        "active_node_id": None,
        "final_bounds": None,
        "watch_kind": None,
    }


def _with_kept_secrets(
    test_id: str | None,
    frames: Iterable[dict[str, Any]],
    served: Mapping[str, Any],
    sealed: Mapping[str, Any],
) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    """Pair each frame with the real values of the secrets it shows masked, for the slot to keep.

    A Block in its final form holds the recipe's; one still in its stored form, the saved test's.
    """
    final = {node["id"]: node for node in served["workflow"]["nodes"]}
    revised = {node["id"]: node for node in sealed["workflow"]["nodes"]}
    stored_workflow = test_service.get_test_workflow_raw(test_id) if test_id else None
    stored = {node["id"]: node for node in (stored_workflow or {}).get("nodes", [])}
    for frame in frames:
        nodes = [
            revised[node["id"]] if node == final.get(node["id"]) else stored[node["id"]]
            for node in frame["nodes"]
        ]
        yield frame, {
            "test_id": test_id,
            "variables": sealed["variables"],
            "workflow": {"nodes": nodes},
        }


async def _stream_then_save(
    holder_id: str,
    result_key: str,
    findings: list[dict[str, Any]],
    frames: Iterable[tuple[dict[str, Any], dict[str, Any]]],
    save: Callable[[], dict[str, Any]],
    first_pause_s: float | None = None,
) -> dict[str, Any]:
    """Hold the slot across the paced frames, then save once and show the test as saved.

    Each frame is followed by the build's pause; ``first_pause_s`` replaces it after the first.
    """
    from wavecore.api.exceptions import ConflictException
    from wavecore.api.services.workbench import ownership
    from wavecore.api.websocket import events
    from wavecore.mcp import state as mcp_state

    holder = ownership.get_holder()
    if holder is not None and holder["id"] == holder_id:
        # The claim would pass at once, and this stream would end that holding early.
        held = finding("test", "SESSION_HELD", SESSION_HELD_HERE_PROBLEM, SESSION_HELD_HERE_FIX)
        return {result_key: False, "findings": [*findings, held]}
    try:
        ownership.claim(holder_id, mcp_state.mcp_holder_label(holder_id), "mcp")
    except ConflictException as exc:
        held = finding("test", "SESSION_HELD", exc.message, author.SESSION_HELD_FIX)
        return {result_key: False, "findings": [*findings, held]}

    hand_back = True
    try:
        # Every tab learns the new holder before the first frame reaches it.
        await events.settle()
        for index, (frame, kept) in enumerate(frames):
            # No await between the check and the write, so the slot cannot move.
            released = _abandonment(holder_id)
            if released is not None:
                return {result_key: False, "released": released}
            # The frame shows secrets masked; their real values stay with the slot.
            await ownership.send_stream_frame(holder_id, frame, kept)
            pause = REVEAL_STEP_DELAY_S
            if index == 0 and first_pause_s is not None:
                pause = first_pause_s
            await asyncio.sleep(pause)
        # Every frame is shown, so a polite request costs nothing: save, then hand over.
        released = _abandonment(holder_id)
        if released in ("slot_lost", "force_taken"):
            return {result_key: False, "released": released}
        answer = save()
        # A refused save leaves the streamed work in the tab, unsaved.
        if answer[result_key]:
            payload = ownership.apply_draft(holder_id, _saved_frame(str(answer["test_id"])))
            await ownership.broadcast_draft(payload)
        return answer
    except BaseException:
        # A dropped assistant (a canceled task) or a broken stream is a loss the tabs announce.
        hand_back = False
        raise
    finally:
        with contextlib.suppress(ConflictException):
            ownership.release(holder_id, "handoff" if hand_back else "released")


async def build_test_from_recipe(recipe: str, session_id: str | None = None) -> dict[str, Any]:
    """Build a test live: reveal each node into the mirrored draft, then save."""
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
        return {"built": False, "findings": [*findings, conflict]}
    refusal = author.create_check_findings(test_data, result["step_map"], check_name=False)
    if refusal:
        return {"built": False, "findings": [*findings, *refusal]}

    # Mid-build the surface is an unsaved draft bound to no test yet.
    served = test_service.served_form(test_data)
    frames = (
        ({**frame, "test_id": None, "test_name": None, "dirty": True, "watch_kind": "build"}, kept)
        for frame, kept in _with_kept_secrets(
            None,
            reveal_frames({**test_data, **served}),
            served,
            test_service.stored_form(test_data),
        )
    )
    return await _stream_then_save(
        session_id or "mcp",
        "built",
        findings,
        frames,
        lambda: author.save_new_test(test_data, result["step_map"], findings, "built"),
    )


async def amend_test_live_from_recipe(
    test_ref: str, recipe: str, session_id: str | None = None
) -> dict[str, Any]:
    """Change a test live: play the change on the mirrored test, then save it once."""
    amendment, findings = author.prepare_amend(test_ref, recipe)
    if amendment is None:
        return {"amended": False, "findings": findings}
    refusal = author.amendment_check_findings(amendment)
    if refusal:
        return {"amended": False, "findings": [*findings, *refusal]}

    # Mid-change the surface is the test being changed, with unsaved changes; a secret the
    # recipe gives as the mask shows the value the test stores.
    served = test_service.served_form(amendment.test_data, amendment.target_id)
    frames = (
        (
            {
                **frame,
                "test_id": amendment.target_id,
                "test_name": amendment.target.get("name"),
                "dirty": True,
                "watch_kind": "change",
            },
            kept,
        )
        for frame, kept in _with_kept_secrets(
            amendment.target_id,
            change_frames(amendment.target, served, ssh_hosts.placement_defaults()),
            served,
            test_service.stored_form(amendment.test_data, amendment.target_id),
        )
    )
    return await _stream_then_save(
        session_id or "mcp",
        "amended",
        findings,
        frames,
        lambda: author.save_amendment(amendment),
        ROOM_STEP_DELAY_S,
    )
