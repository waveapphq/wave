"""Live draft mirroring: apply_draft caching + WebSocket relay.

Covers the shared-draft snapshot path on ``ownership`` and the manager's
``draft_update`` relay / ``identify`` binding branches.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import WebSocket

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import ownership
from wavecore.api.websocket import WebSocketManager


def _fresh_ws() -> AsyncMock:
    """WebSocket-shaped mock that also evaluates truthy (``__len__`` != 0)."""
    ws = AsyncMock(spec=WebSocket)
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.__len__ = MagicMock(return_value=1)
    return ws


class TestApplyDraft:
    """Service-level ``apply_draft`` builds a snapshot payload and caches it."""

    def test_apply_draft_returns_snapshot_payload(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        result = ownership.apply_draft(
            "h1",
            {"nodes": [{"id": "n1"}], "edges": [{"id": "e1"}], "variables": [{"name": "v1"}]},
        )

        assert result == {
            "event": "draft_snapshot",
            "nodes": [{"id": "n1"}],
            "edges": [{"id": "e1"}],
            "variables": [{"name": "v1"}],
            "test_id": None,
            "test_name": None,
            "dirty": True,
            "from_holder_id": "h1",
            "active_node_id": None,
        }

    def test_apply_draft_carries_surface_identity_and_saved_state(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        result = ownership.apply_draft(
            "h1",
            {
                "nodes": [],
                "edges": [],
                "variables": [],
                "test_id": "test-9",
                "test_name": "Open Test",
                "dirty": False,
            },
        )

        assert result["test_id"] == "test-9"
        assert result["test_name"] == "Open Test"
        assert result["dirty"] is False

    def test_apply_draft_seeds_shared_draft_cache(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        result = ownership.apply_draft(
            "h1",
            {"nodes": [{"id": "n1"}], "edges": [], "variables": []},
        )

        assert ownership.get_shared_draft() == result

    def test_apply_draft_by_non_holder_raises(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        with pytest.raises(ConflictException, match=r"^You are not the session holder$"):
            ownership.apply_draft("other", {"nodes": [], "edges": [], "variables": []})

    def test_fresh_state_has_no_shared_draft(self) -> None:
        assert ownership.get_shared_draft() is None


class TestManagerRelay:
    """The ``draft_update`` frame from the holder relays a snapshot to mirrors."""

    async def test_holder_draft_update_relays_to_mirror(self) -> None:
        manager = WebSocketManager()
        holder_ws = _fresh_ws()
        mirror_ws = _fresh_ws()
        holder_conn = await manager.connect(holder_ws)
        mirror_conn = await manager.connect(mirror_ws)

        manager.subscribe(mirror_conn, "workbench:draft")
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        mirror_ws.send_json.reset_mock()
        await manager.handle_message(
            holder_conn,
            json.dumps(
                {
                    "type": "draft_update",
                    "holderId": "h1",
                    "snapshot": {"nodes": [], "edges": [], "variables": []},
                }
            ),
        )

        draft_events = [
            c.args[0]
            for c in mirror_ws.send_json.call_args_list
            if c.args
            and c.args[0].get("type") == "event"
            and c.args[0].get("topic") == "workbench:draft"
        ]
        assert draft_events
        envelope = draft_events[-1]
        assert isinstance(envelope["timestamp"], int)
        payload = envelope["payload"]
        assert payload["event"] == "draft_snapshot"
        assert payload["from_holder_id"] == "h1"
        assert payload["nodes"] == []
        assert payload["edges"] == []
        assert payload["variables"] == []

    async def test_non_holder_draft_update_is_dropped(self) -> None:
        manager = WebSocketManager()
        holder_ws = _fresh_ws()
        mirror_ws = _fresh_ws()
        holder_conn = await manager.connect(holder_ws)
        mirror_conn = await manager.connect(mirror_ws)

        manager.subscribe(mirror_conn, "workbench:draft")
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        mirror_ws.send_json.reset_mock()
        await manager.handle_message(
            holder_conn,
            json.dumps(
                {
                    "type": "draft_update",
                    "holderId": "other",
                    "snapshot": {"nodes": [], "edges": [], "variables": []},
                }
            ),
        )

        draft_snapshots = [
            c.args[0]
            for c in mirror_ws.send_json.call_args_list
            if c.args
            and isinstance(c.args[0].get("payload"), dict)
            and c.args[0]["payload"].get("event") == "draft_snapshot"
        ]
        assert draft_snapshots == []


class TestIdentifyBinds:
    """An ``identify`` frame binds the connection to its holder id."""

    async def test_identify_binds_connection_to_holder(self) -> None:
        manager = WebSocketManager()
        ws = _fresh_ws()
        conn_id = await manager.connect(ws)

        await manager.handle_message(
            conn_id,
            json.dumps({"type": "identify", "holderId": "h9", "clientType": "workbench"}),
        )

        assert manager._connection_holders[conn_id] == "h9"


class TestWatchersRecount:
    """Draft-topic subscribers are counted as watchers, holder's tab excluded."""

    async def test_holder_connection_is_excluded_from_watchers(self) -> None:
        manager = WebSocketManager()
        holder_ws = _fresh_ws()
        mirror_ws = _fresh_ws()
        holder_conn = await manager.connect(holder_ws)
        mirror_conn = await manager.connect(mirror_ws)

        with patch.object(ownership, "_emit"):
            await manager.handle_message(
                holder_conn,
                json.dumps({"type": "identify", "holderId": "h1", "clientType": "workbench"}),
            )
            ownership.claim("h1", "H1", "person")
            manager.subscribe(holder_conn, "workbench:draft")
            assert ownership.get_ownership()["watchers"] == 0

            manager.subscribe(mirror_conn, "workbench:draft")
            assert ownership.get_ownership()["watchers"] == 1

            manager.unsubscribe(mirror_conn, "workbench:draft")
            assert ownership.get_ownership()["watchers"] == 0

    async def test_mirror_disconnect_drops_the_watcher_count(self) -> None:
        manager = WebSocketManager()
        mirror_ws = _fresh_ws()
        mirror_conn = await manager.connect(mirror_ws)

        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            manager.subscribe(mirror_conn, "workbench:draft")
            assert ownership.get_ownership()["watchers"] == 1

            manager.handle_disconnect(mirror_conn)
            assert ownership.get_ownership()["watchers"] == 0

    async def test_drop_draft_watcher_removes_subscription_and_recounts(self) -> None:
        manager = WebSocketManager()
        mirror_ws = _fresh_ws()
        mirror_conn = await manager.connect(mirror_ws)

        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            await manager.handle_message(
                mirror_conn,
                json.dumps({"type": "identify", "holderId": "m1", "clientType": "workbench"}),
            )
            manager.subscribe(mirror_conn, "workbench:draft")
            assert ownership.get_ownership()["watchers"] == 1

            manager.drop_draft_watcher("m1", None)

            assert ownership.get_ownership()["watchers"] == 0
            assert "workbench:draft" not in manager._metadata[mirror_conn].subscriptions

    async def test_drop_draft_watcher_unknown_holder_is_a_no_op(self) -> None:
        manager = WebSocketManager()
        mirror_ws = _fresh_ws()
        mirror_conn = await manager.connect(mirror_ws)

        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            manager.subscribe(mirror_conn, "workbench:draft")
            assert ownership.get_ownership()["watchers"] == 1

            manager.drop_draft_watcher("nobody", None)

            assert ownership.get_ownership()["watchers"] == 1

    async def test_drop_draft_watcher_keeps_a_later_page_of_the_same_tab(self) -> None:
        manager = WebSocketManager()
        old_conn = await manager.connect(_fresh_ws())
        new_conn = await manager.connect(_fresh_ws())

        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            for conn, page in ((old_conn, "page-1"), (new_conn, "page-2")):
                await manager.handle_message(
                    conn,
                    json.dumps({"type": "identify", "holderId": "m1", "pageId": page}),
                )
                manager.subscribe(conn, "workbench:draft")

            manager.drop_draft_watcher("m1", "page-1")

            assert "workbench:draft" not in manager._metadata[old_conn].subscriptions
            assert "workbench:draft" in manager._metadata[new_conn].subscriptions
            assert ownership.get_ownership()["watchers"] == 1

    async def test_claim_recounts_out_the_holders_own_pre_claim_tab(self) -> None:
        """A solo holder must not count its own pre-claim tab.

        The live FE order is subscribe -> identify -> claim, so the WS-event
        recounts run while the slot is free (counting the holder's own tab).
        claim() must recount so a solo holder ends with zero watchers.
        """
        from wavecore.api.app import app

        manager = WebSocketManager()
        holder_ws = _fresh_ws()
        holder_conn = await manager.connect(holder_ws)
        app.state.ws_manager = manager

        with patch.object(ownership, "_emit"):
            manager.subscribe(holder_conn, "workbench:draft")
            await manager.handle_message(
                holder_conn,
                json.dumps({"type": "identify", "holderId": "h1", "clientType": "workbench"}),
            )
            assert ownership.get_ownership()["watchers"] == 1

            ownership.claim("h1", "H1", "person")

            assert ownership.get_ownership()["watchers"] == 0


class TestApplyDraftActiveNode:
    """``apply_draft`` always carries ``active_node_id`` (null on person pushes)."""

    def test_apply_draft_carries_active_node_id(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        result = ownership.apply_draft(
            "h1",
            {"nodes": [{"id": "n1"}], "edges": [], "variables": [], "active_node_id": "n1"},
        )

        assert result["active_node_id"] == "n1"
        shared = ownership.get_shared_draft()
        assert shared is not None
        assert shared["active_node_id"] == "n1"

    def test_apply_draft_active_node_id_defaults_null(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        result = ownership.apply_draft(
            "h1",
            {"nodes": [{"id": "n1"}], "edges": [], "variables": []},
        )

        assert result == {
            "event": "draft_snapshot",
            "nodes": [{"id": "n1"}],
            "edges": [],
            "variables": [],
            "test_id": None,
            "test_name": None,
            "dirty": True,
            "from_holder_id": "h1",
            "active_node_id": None,
        }


class TestSubscribeReplay:
    """Subscribing to ``workbench:draft`` replays the cached snapshot."""

    async def test_subscribe_replays_cached_draft(self) -> None:
        manager = WebSocketManager()
        ws = _fresh_ws()
        conn = await manager.connect(ws)

        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
        ownership.apply_draft(
            "h1",
            {"nodes": [{"id": "n1"}], "edges": [], "variables": []},
        )

        ws.send_json.reset_mock()
        await manager.handle_message(
            conn,
            json.dumps({"type": "subscribe", "topic": "workbench:draft"}),
        )

        replays = [
            c.args[0]
            for c in ws.send_json.call_args_list
            if c.args
            and isinstance(c.args[0].get("payload"), dict)
            and c.args[0]["payload"].get("event") == "draft_snapshot"
        ]
        assert replays
        assert replays[-1]["payload"] == ownership.get_shared_draft()

    async def test_subscribe_without_cached_draft_sends_no_replay(self) -> None:
        manager = WebSocketManager()
        ws = _fresh_ws()
        conn = await manager.connect(ws)

        ws.send_json.reset_mock()
        await manager.handle_message(
            conn,
            json.dumps({"type": "subscribe", "topic": "workbench:draft"}),
        )

        confirmations = [
            c.args[0]
            for c in ws.send_json.call_args_list
            if c.args and c.args[0].get("type") == "subscribed"
        ]
        replays = [
            c.args[0]
            for c in ws.send_json.call_args_list
            if c.args
            and isinstance(c.args[0].get("payload"), dict)
            and c.args[0]["payload"].get("event") == "draft_snapshot"
        ]
        assert confirmations
        assert replays == []

    async def test_subscribe_with_holder_but_no_cached_draft_sends_no_replay(self) -> None:
        manager = WebSocketManager()
        ws = _fresh_ws()
        conn = await manager.connect(ws)

        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

        ws.send_json.reset_mock()
        await manager.handle_message(
            conn,
            json.dumps({"type": "subscribe", "topic": "workbench:draft"}),
        )

        replays = [
            c.args[0]
            for c in ws.send_json.call_args_list
            if c.args
            and isinstance(c.args[0].get("payload"), dict)
            and c.args[0]["payload"].get("event") == "draft_snapshot"
        ]
        assert replays == []


class TestSharedDraftLifecycle:
    """The cached draft is bound to the holder's tenure and voided when the slot frees.

    A draft cached by a holder that has left is stale: the draft replay must never
    seed a fresh subscriber with a former holder's graph (that would bleed a dead
    session's nodes onto every subsequent workbench load).
    """

    def _seed_holder_with_draft(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
        ownership.apply_draft("h1", {"nodes": [{"id": "n1"}], "edges": [], "variables": []})
        assert ownership.get_shared_draft() is not None

    def test_release_voids_the_shared_draft(self) -> None:
        self._seed_holder_with_draft()
        with patch.object(ownership, "_emit"):
            ownership.release("h1")
        assert ownership.get_shared_draft() is None

    def test_connection_lost_voids_the_shared_draft(self) -> None:
        self._seed_holder_with_draft()
        with patch.object(ownership, "_emit"):
            ownership.on_connection_lost("h1")
        assert ownership.get_shared_draft() is None

    def test_stale_sweep_voids_the_shared_draft(self) -> None:
        self._seed_holder_with_draft()
        with patch.object(ownership, "_emit"):
            ownership.set_watchers(1)  # only a watched holder is swept
            ownership.sweep_stale(ownership._now() + ownership.HOLDER_TIMEOUT_SECONDS + 1)
        assert ownership.get_shared_draft() is None

    def test_takeover_grant_keeps_the_shared_draft_for_the_successor(self) -> None:
        self._seed_holder_with_draft()
        with patch.object(ownership, "_emit"):
            ownership.request_takeover("h2", "H2")  # person holder -> pending
            ownership.release("h1")  # release grants the slot to h2
        holder = ownership.get_holder()
        assert holder is not None and holder["id"] == "h2"
        assert ownership.get_shared_draft() is not None
