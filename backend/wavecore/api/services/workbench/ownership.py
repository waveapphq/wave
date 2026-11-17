"""Single-slot workbench editing ownership: lock, shared-draft relay, take-over."""

import asyncio
import logging
import time
from collections.abc import Mapping
from typing import Any

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    ValidationException,
)
from wavecore.api.websocket import events

logger = logging.getLogger(__name__)

# Generous against background-tab timer throttling: a hidden tab's liveness
# interval can stretch to a minute, and a live tab must never be reaped.
HOLDER_TIMEOUT_SECONDS: float = 180.0
AWAY_GRACE_SECONDS: float = 5.0
SWEEP_INTERVAL_SECONDS: float = 15.0
OWNERSHIP_TOPIC: str = "workbench:draft"

_ERR_ALREADY_HELD = "The workbench session is already held"
_ERR_NOT_HOLDER = "You are not the session holder"
_ERR_ALREADY_HOLD = "You already hold this session"
_ERR_PENDING = "A take-over request is already pending"
_ERR_NO_PENDING = "No pending take-over request"

_holder: dict[str, Any] | None = None
_pending_takeover: dict[str, Any] | None = None
_shared_draft: dict[str, Any] | None = None
_watchers: int = 0
_suspended: dict[str, Any] | None = None
_run_state: dict[str, Any] | None = None
# Holder ids repeat (an assistant falls back to a fixed one), generations never do.
_holder_generation: int = 0
_run_announcer_generation: int | None = None
_away_deadline: float | None = None
# The person tab that gave way to an assistant claim, and that claim's holder generation.
_yielded: dict[str, Any] | None = None
# The stored form of the secrets an assistant's streamed draft shows masked, and its test.
_kept_secrets: dict[str, Any] | None = None
# The slot freed since: the kept secrets wait for the next holder to show it continues the draft.
_kept_unclaimed: bool = False
# Set once the frame an assistant's stream is sending has reached every tab.
_frame_sent: asyncio.Event | None = None


def clear() -> None:
    """Reset all ownership state."""
    global _holder, _pending_takeover, _shared_draft, _watchers, _suspended
    global _run_state, _holder_generation, _run_announcer_generation, _away_deadline, _yielded
    global _kept_secrets, _kept_unclaimed, _frame_sent
    _holder = None
    _pending_takeover = None
    _shared_draft = None
    _watchers = 0
    _suspended = None
    _run_state = None
    _holder_generation = 0
    _run_announcer_generation = None
    _away_deadline = None
    _yielded = None
    _kept_secrets = None
    _kept_unclaimed = False
    _frame_sent = None


def _now() -> float:
    return time.monotonic()


def _emit(event: dict[str, Any]) -> None:
    """Schedule a WS broadcast of an ownership event on the draft topic."""
    events.emit(OWNERSHIP_TOPIC, event)


def _refresh_watchers() -> None:
    """Recount mirrors after a REST-driven holder change.

    The manager excludes the holder's own connection, but only recounts on WS
    events. A tab subscribes + identifies before it claims, so without this a
    solo holder would count its own pre-claim subscription as a watcher.
    """
    from wavecore.api.app import app

    ws_manager = getattr(app.state, "ws_manager", None)
    if ws_manager is not None:
        ws_manager.refresh_draft_watchers()


def _settle_away() -> None:
    """Free (or hand over) the slot once an away reservation has elapsed.

    Evaluated on every read as well as by the sweep, so whichever route notices
    first settles it and the broadcast fires exactly once.
    """
    global _away_deadline
    if _away_deadline is None or _now() < _away_deadline:
        return
    _away_deadline = None
    _hand_off_or_free()


def get_holder() -> dict[str, Any] | None:
    """Public holder projection (id/label/kind only)."""
    _settle_away()
    if _holder is None:
        return None
    return {"id": _holder["id"], "label": _holder["label"], "kind": _holder["kind"]}


def get_ownership() -> dict[str, Any]:
    """Current holder, watcher count, pending take-over, and announced run."""
    _settle_away()
    pending = None
    if _pending_takeover is not None:
        pending = {"requester_label": _pending_takeover["requester_label"]}
    return {
        "holder": get_holder(),
        "watchers": _watchers,
        "pending_takeover": pending,
        "run": get_run_state(),
    }


def get_shared_draft() -> dict[str, Any] | None:
    """The cached draft snapshot payload seeding late-joining mirrors."""
    return _shared_draft


def get_suspended() -> dict[str, Any] | None:
    """The MCP holder displaced by a forced take-over, if any."""
    return _suspended


def _set_holder(holder_id: str, label: str, kind: str) -> None:
    global _holder, _away_deadline, _holder_generation
    _away_deadline = None
    _holder_generation += 1
    now = _now()
    _holder = {
        "id": holder_id,
        "label": label,
        "kind": kind,
        "generation": _holder_generation,
        "since": now,
        "last_heartbeat": now,
        "dirty": False,
    }


def set_holder_dirty(holder_id: str, dirty: bool) -> None:
    """Record the holder's reported draft dirtiness; non-holder reports are ignored."""
    if _holder is not None and _holder["id"] == holder_id:
        _holder["dirty"] = dirty


def set_run_state(run: dict[str, Any] | None) -> None:
    """Store + broadcast the announced run; idempotent on an equal value."""
    global _run_state, _run_announcer_generation
    if run == _run_state:
        return
    _run_state = run
    # Whose run it is: the announce outlives the slot, so later holders are not it.
    _run_announcer_generation = None if run is None or _holder is None else _holder["generation"]
    _emit({"event": "run_state_changed", "run": run})


def get_run_state() -> dict[str, Any] | None:
    """The currently announced run, or None."""
    return _run_state


def _holder_is_running() -> bool:
    """True when the current holder is the session that announced the live run."""
    return (
        _run_state is not None
        and _holder is not None
        and _run_announcer_generation == _holder["generation"]
    )


def _require_holder(holder_id: str) -> dict[str, Any]:
    if _holder is None or _holder["id"] != holder_id:
        raise ConflictException(_ERR_NOT_HOLDER)
    return _holder


def _free_slot(reason: str | None = None) -> None:
    """Drop the holder to nobody and void its now-stale draft.

    The cached draft only mirrors a live holder; once the slot is free the graph
    is stale and must not seed a fresh subscriber via the draft replay. Its kept
    secrets stay for the tab that claims next and continues it.
    """
    global _holder, _shared_draft, _away_deadline, _kept_unclaimed
    _holder = None
    _shared_draft = None
    _away_deadline = None
    _kept_unclaimed = _kept_secrets is not None
    event: dict[str, Any] = {"event": "holder_changed", "holder": None}
    if reason is not None:
        event["reason"] = reason
    _emit(event)


def _hand_off_or_free(reason: str | None = None) -> None:
    """The holder is done or gone: a waiting requester gets the slot, else nobody does."""
    pending = _pending_takeover
    if pending is not None:
        _grant_to_pending(pending)
    else:
        _free_slot(reason)


def _can_auto_yield(kind: str) -> bool:
    """A clean, idle person holder yields to an assistant claim."""
    return (
        kind == "mcp"
        and _holder is not None
        and _holder["kind"] == "person"
        and not _holder["dirty"]
        and _run_state is None
    )


def claim(holder_id: str, holder_label: str, kind: str = "person") -> dict[str, Any]:
    """Become the holder if the slot is free; idempotent for the same id."""
    global _away_deadline, _yielded
    _settle_away()
    if _holder is not None:
        if _holder["id"] == holder_id:
            _away_deadline = None
            _holder["last_heartbeat"] = _now()
            return get_ownership()
        if not _can_auto_yield(kind):
            raise ConflictException(_ERR_ALREADY_HELD)
        gave_way = {"id": _holder["id"], "label": _holder["label"]}
        _set_holder(holder_id, holder_label, kind)
        _yielded = {**gave_way, "generation": _holder_generation}
        _emit({"event": "holder_changed", "holder": get_holder(), "reason": "auto_yield"})
        _refresh_watchers()
        return get_ownership()
    _set_holder(holder_id, holder_label, kind)
    _emit({"event": "holder_changed", "holder": get_holder()})
    _refresh_watchers()
    return get_ownership()


def heartbeat(holder_id: str) -> None:
    """Refresh the holder's liveness; conflict when not the holder."""
    _require_holder(holder_id)["last_heartbeat"] = _now()


def _grant_to_pending(requester: dict[str, Any]) -> None:
    global _pending_takeover
    _set_holder(requester["requester_id"], requester["requester_label"], "person")
    _pending_takeover = None
    new_holder = get_holder()
    _emit({"event": "takeover_resolved", "outcome": "granted", "new_holder": new_holder})
    _emit({"event": "holder_changed", "holder": new_holder})
    _refresh_watchers()


def _tab_connected(holder_id: str) -> bool:
    """True while a socket identified as this tab is open and its session was not ended."""
    from wavecore.api.app import app
    from wavecore.api.websocket import session_registry

    ws_manager = getattr(app.state, "ws_manager", None)
    return (
        ws_manager is not None
        and bool(ws_manager.has_live_connection(holder_id))
        and not session_registry.is_session_closed(holder_id)
    )


def _tab_that_gave_way() -> dict[str, Any] | None:
    """The still-connected person tab the current holder's claim auto-yielded, if any."""
    yielded = _yielded
    if yielded is None or _holder is None or yielded["generation"] != _holder["generation"]:
        return None
    return yielded if _tab_connected(yielded["id"]) else None


def _hand_back(tab: dict[str, Any]) -> None:
    """Give the slot back to the tab that gave way; it keeps the cached draft it now holds."""
    _set_holder(tab["id"], tab["label"], "person")
    # Unsaved work it inherits refuses the next assistant claim, as its own would.
    set_holder_dirty(tab["id"], _shared_draft is not None and bool(_shared_draft["dirty"]))
    _emit({"event": "holder_changed", "holder": get_holder(), "reason": "handoff"})
    _refresh_watchers()


def release(holder_id: str, reason: str = "released") -> dict[str, Any]:
    """Relinquish the slot; a pending take-over is granted on release.

    An assistant's handoff with nobody waiting goes back to the tab that gave way to it.
    """
    global _yielded
    _require_holder(holder_id)
    logger.debug("Ownership released by %s (%s)", holder_id, reason)
    gave_way = _tab_that_gave_way() if reason == "handoff" else None
    _yielded = None
    if gave_way is not None and _pending_takeover is None:
        _hand_back(gave_way)
    else:
        _hand_off_or_free("handoff" if reason == "handoff" else None)
    return get_ownership()


def request_takeover(requester_id: str, requester_label: str) -> dict[str, Any]:
    """Request the slot: idle grants now; a live holder gets a pending request."""
    global _pending_takeover
    if _holder is not None and _holder["id"] == requester_id:
        raise ValidationException(_ERR_ALREADY_HOLD)
    if _pending_takeover is not None:
        raise ConflictException(_ERR_PENDING)
    if _holder is None:
        _set_holder(requester_id, requester_label, "person")
        _emit({"event": "holder_changed", "holder": get_holder()})
        return {"outcome": "granted", **get_ownership()}
    if _holder["kind"] == "mcp" and _holder_is_running():
        # An assistant run-holder has no atomic step to finish: grant at once.
        _set_holder(requester_id, requester_label, "person")
        _emit({"event": "holder_changed", "holder": get_holder()})
        return {"outcome": "granted", **get_ownership()}
    _pending_takeover = {"requester_id": requester_id, "requester_label": requester_label}
    _emit({"event": "takeover_requested", "requester_label": requester_label})
    outcome = "awaiting_approval" if _holder["kind"] == "person" else "awaiting_release"
    return {"outcome": outcome, **get_ownership()}


def resolve_takeover(holder_id: str, approve: bool) -> dict[str, Any]:
    """Holder approves (grant) or denies (clear) the pending request."""
    global _pending_takeover
    pending = _pending_takeover
    if pending is None:
        raise NotFoundException(_ERR_NO_PENDING)
    _require_holder(holder_id)
    if approve:
        _grant_to_pending(pending)
        return {"outcome": "granted", **get_ownership()}
    _pending_takeover = None
    _emit({"event": "takeover_resolved", "outcome": "denied", "new_holder": get_holder()})
    return {"outcome": "denied", **get_ownership()}


def cancel_takeover(requester_id: str) -> dict[str, Any]:
    """The requester retracts its own pending take-over; the holder keeps editing."""
    global _pending_takeover
    pending = _pending_takeover
    if pending is None or pending["requester_id"] != requester_id:
        raise NotFoundException(_ERR_NO_PENDING)
    _pending_takeover = None
    _emit({"event": "takeover_resolved", "outcome": "denied", "new_holder": get_holder()})
    return {"outcome": "denied", **get_ownership()}


def force_takeover(requester_id: str, requester_label: str) -> dict[str, Any]:
    """Unconditionally hand the slot over; a displaced MCP holder is suspended."""
    global _pending_takeover, _suspended
    if _holder is not None and _holder["kind"] == "mcp":
        _suspended = {"holder_id": _holder["id"], "label": _holder["label"]}
    _set_holder(requester_id, requester_label, "person")
    _pending_takeover = None
    _emit({"event": "holder_changed", "holder": get_holder()})
    _refresh_watchers()
    return get_ownership()


def apply_draft(holder_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Cache the holder's draft snapshot; the manager re-broadcasts the payload."""
    global _shared_draft, _kept_secrets, _kept_unclaimed
    holder = _require_holder(holder_id)
    payload = {
        "event": "draft_snapshot",
        "nodes": snapshot["nodes"],
        "edges": snapshot["edges"],
        "variables": snapshot["variables"],
        # Whose surface this is: the open test (or none) and its saved-state.
        "test_id": snapshot.get("test_id"),
        "test_name": snapshot.get("test_name"),
        "dirty": bool(snapshot.get("dirty", True)),
        "from_holder_id": holder_id,
        "active_node_id": snapshot.get("active_node_id"),
        # Where a build in progress will end up, so a watcher frames the finished test.
        "final_bounds": snapshot.get("final_bounds"),
        # "build" or "change" while an assistant streams one, so every viewer can name it.
        "watch_kind": snapshot.get("watch_kind"),
    }
    _shared_draft = payload
    # A clean surface or another test in the tab is no longer the streamed draft.
    if _kept_secrets is not None and (
        payload["test_id"] != _kept_secrets["test_id"] or not payload["dirty"]
    ):
        _kept_secrets = None
    elif holder["kind"] == "person":
        _kept_unclaimed = False
    return payload


def keep_draft_secrets(holder_id: str, kept: Mapping[str, Any]) -> None:
    """Keep the real secrets of the draft the holder streams, for whoever continues and saves it.

    ``kept`` names the draft's test (``test_id``, None for a new one) and holds the stored form
    of its ``variables`` and ``workflow``. A frame never carries them.
    """
    global _kept_secrets, _kept_unclaimed
    _require_holder(holder_id)
    _kept_secrets = dict(kept)
    _kept_unclaimed = False


def kept_draft_secrets(test_id: str | None, holder_id: str | None) -> dict[str, Any] | None:
    """The kept secrets a save of ``test_id`` by tab ``holder_id`` fills its masked values from:
    those of the streamed draft that tab holds and continues, else None."""
    kept = _kept_secrets
    if kept is None or kept["test_id"] != test_id or _kept_unclaimed:
        return None
    if _holder is None or _holder["kind"] != "person" or _holder["id"] != holder_id:
        return None
    return kept


def drop_draft_secrets(test_id: str | None, holder_id: str | None) -> None:
    """Tab ``holder_id`` saved the draft of ``test_id`` it continues: its kept secrets go."""
    global _kept_secrets
    if kept_draft_secrets(test_id, holder_id) is not None:
        _kept_secrets = None


async def broadcast_draft(payload: dict[str, Any]) -> None:
    """Broadcast a draft_snapshot payload to draft-topic mirrors.

    The live MCP build reveal drives ownership directly (not through the
    draft_update WS route the person-holder path uses), so it broadcasts each
    frame itself instead of relying on the manager to re-broadcast.
    """
    await events.broadcast(OWNERSHIP_TOPIC, payload)


async def send_stream_frame(holder_id: str, frame: dict[str, Any], kept: Mapping[str, Any]) -> None:
    """Keep a streamed frame's secrets, apply it and send it to every tab, as one step that a
    forced take-over waits for, so the taker continues the frame its secrets belong to."""
    global _frame_sent
    keep_draft_secrets(holder_id, kept)
    payload = apply_draft(holder_id, frame)
    sent = asyncio.Event()
    _frame_sent = sent
    try:
        await broadcast_draft(payload)
    finally:
        sent.set()
        if _frame_sent is sent:
            _frame_sent = None


async def frame_sent() -> None:
    """Wait until no frame of an assistant's stream is on its way to the tabs."""
    while (sent := _frame_sent) is not None:
        await sent.wait()


def set_watchers(count: int) -> None:
    """Record how many mirrors watch the draft topic."""
    global _watchers
    _watchers = count
    # Arriving mirrors switch the sweep on; give the holder a full window to
    # report in, so a holder that does not heartbeat at all (an assistant) is
    # not reaped the instant somebody starts watching.
    if count > 0 and _holder is not None:
        _holder["last_heartbeat"] = _now()
    _emit({"event": "watchers_changed", "count": count})


def sweep_stale(now: float, timeout: float = HOLDER_TIMEOUT_SECONDS) -> None:
    """Release a watched holder whose heartbeat lapsed; an unwatched holder is kept.

    Liveness only matters under contention: with no watchers there is nobody
    waiting to take over. A browser holder heartbeats for as long as its tab is
    open, from any route, so a lapse here means the tab is gone and its socket
    close was never noticed - the last resort behind that primary signal.
    """
    _settle_away()
    if _holder is not None and _watchers > 0 and now - _holder["last_heartbeat"] > timeout:
        _free_slot()


def mark_away(holder_id: str, grace: float = AWAY_GRACE_SECONDS) -> None:
    """Reserve the departing holder's slot for a bounded grace window."""
    global _away_deadline
    _settle_away()
    if _holder is None or _holder["id"] != holder_id or _holder["kind"] != "person":
        return
    _away_deadline = _now() + grace


def release_for_session(session_id: str) -> None:
    """Release ownership held by an administratively terminated browser session."""
    _settle_away()
    if _holder is None or _holder["id"] != session_id or _holder["kind"] != "person":
        return
    _hand_off_or_free()


def on_connection_lost(holder_id: str, still_connected: bool = False) -> None:
    """Free the slot when the holder's last live WS connection is gone."""
    _settle_away()
    if _holder is None or _holder["id"] != holder_id or _holder["kind"] != "person":
        return
    # An away-reserved holder is settled by reservation expiry, not socket loss.
    if still_connected or _away_deadline is not None:
        return
    _free_slot()


async def run_stale_sweep_loop(interval: float = SWEEP_INTERVAL_SECONDS) -> None:
    """Background loop releasing dead holders (started at app startup)."""
    while True:
        sweep_stale(_now())
        await asyncio.sleep(interval)
