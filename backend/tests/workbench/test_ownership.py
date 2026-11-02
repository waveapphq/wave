"""Workbench session-ownership service + routes contract.

Covers wavecore.api.services.workbench.ownership (claim/heartbeat/release/watchers) and the
/workbench/ownership routes.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import WebSocket
from fastapi.testclient import TestClient

from tests.workbench.conftest import FrozenClock
from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import ownership
from wavecore.api.websocket import events


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


class TestGetOwnership:
    async def test_fresh_state_has_no_holder(self) -> None:
        assert ownership.get_ownership() == {
            "holder": None,
            "watchers": 0,
            "pending_takeover": None,
            "run": None,
        }

    async def test_get_holder_is_none_when_free(self) -> None:
        assert ownership.get_holder() is None


class TestClaim:
    async def test_claim_free_sets_person_holder(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            result = ownership.claim("u1", "User One")

        holder = ownership.get_holder()
        assert holder == {"id": "u1", "label": "User One", "kind": "person"}
        assert result["holder"] == {"id": "u1", "label": "User One", "kind": "person"}
        mock_emit.assert_called_once_with(
            {
                "event": "holder_changed",
                "holder": {"id": "u1", "label": "User One", "kind": "person"},
            }
        )

    async def test_reclaim_same_id_is_idempotent(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("u1", "User One")
            ownership.claim("u1", "User One")

        assert mock_emit.call_count == 1
        assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}

    async def test_claim_by_different_id_conflicts(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("u1", "User One")
            with pytest.raises(ConflictException, match=r"^The workbench session is already held$"):
                ownership.claim("u2", "User Two")


class TestHeartbeat:
    async def test_heartbeat_by_holder_refreshes(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("u1", "User One")
        ownership._holder["last_heartbeat"] = 0.0

        result = ownership.heartbeat("u1")

        assert result is None
        assert ownership._holder["last_heartbeat"] != 0.0
        assert ownership._holder["last_heartbeat"] > 0.0

    async def test_heartbeat_when_free_conflicts(self) -> None:
        with pytest.raises(ConflictException, match=r"^You are not the session holder$"):
            ownership.heartbeat("u1")

    async def test_heartbeat_by_wrong_id_conflicts(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("u1", "User One")

        with pytest.raises(ConflictException, match=r"^You are not the session holder$"):
            ownership.heartbeat("u2")


class TestRelease:
    async def test_release_by_holder_clears_holder(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("u1", "User One")

        with patch.object(ownership, "_emit") as mock_emit:
            result = ownership.release("u1")

        assert ownership.get_holder() is None
        assert result["holder"] is None
        mock_emit.assert_called_once_with({"event": "holder_changed", "holder": None})

    async def test_release_when_not_holder_conflicts(self) -> None:
        with pytest.raises(ConflictException, match=r"^You are not the session holder$"):
            ownership.release("u1")


class TestSetWatchers:
    async def test_set_watchers_updates_count_and_emits(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.set_watchers(3)

        assert ownership.get_ownership()["watchers"] == 3
        mock_emit.assert_called_once_with({"event": "watchers_changed", "count": 3})

    async def test_set_watchers_refreshes_watched_holder_heartbeat(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            ownership._holder["last_heartbeat"] = 0.0

            ownership.set_watchers(1)

        assert ownership._holder["last_heartbeat"] > 0.0

    async def test_set_watchers_zero_does_not_refresh_heartbeat(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            ownership._holder["last_heartbeat"] = 0.0

            ownership.set_watchers(0)

        assert ownership._holder["last_heartbeat"] == 0.0


class TestOwnershipRoutes:
    def test_claim_free_returns_person_holder(self, client: TestClient) -> None:
        response = client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["you_are_holder"] is True
        assert data["holder"]["kind"] == "person"

    def test_claim_again_with_different_id_conflicts(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u2", "holder_label": "User Two"},
        )

        assert response.status_code == 409
        assert response.json()["error"]["message"] == "The workbench session is already held"

    def test_get_ownership_you_are_holder_true_for_holder(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.get("/workbench/ownership", params={"holder_id": "u1"})

        assert response.status_code == 200
        assert response.json()["data"]["you_are_holder"] is True

    def test_get_ownership_you_are_holder_false_for_other(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.get("/workbench/ownership", params={"holder_id": "other"})

        assert response.json()["data"]["you_are_holder"] is False

    def test_get_ownership_mcp_session_id_none_when_person_holds(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.get("/workbench/ownership", params={"holder_id": "u1"})

        assert response.json()["data"]["mcp_session_id"] is None

    def test_heartbeat_wrong_id_conflicts(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.post("/workbench/ownership/heartbeat", json={"holder_id": "u2"})

        assert response.status_code == 409
        assert response.json()["error"]["message"] == "You are not the session holder"

    def test_heartbeat_by_holder_succeeds(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.post("/workbench/ownership/heartbeat", json={"holder_id": "u1"})

        assert response.status_code == 200
        assert response.json()["data"] == {"ok": True}

    def test_release_by_holder_succeeds(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.post("/workbench/ownership/release", json={"holder_id": "u1"})

        assert response.status_code == 200
        assert response.json()["data"]["released"] is True

    def test_release_wrong_id_conflicts(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.post("/workbench/ownership/release", json={"holder_id": "u2"})

        assert response.status_code == 409
        assert response.json()["error"]["message"] == "You are not the session holder"

    def test_leaving_reserves_the_holder_and_recounts(self, client: TestClient) -> None:
        """The beacon marks the tab away rather than freeing the slot, so a
        watcher keeps mirroring instead of auto-claiming a reloading tab's
        session."""
        from wavecore.api.app import app

        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )
        manager = MagicMock()
        manager.broadcast_to_topic = AsyncMock()
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            response = client.post("/workbench/ownership/leaving", json={"holder_id": "u1"})
        finally:
            app.state.ws_manager = original

        assert response.status_code == 200
        assert response.json()["data"] == {"ok": True}
        manager.drop_draft_watcher.assert_called_once_with("u1", None)
        assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}

    def test_the_reserved_slot_frees_once_the_grace_lapses(
        self, client: TestClient, frozen_clock: FrozenClock
    ) -> None:
        from wavecore.api.app import app

        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )
        manager = MagicMock()
        manager.broadcast_to_topic = AsyncMock()
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            client.post("/workbench/ownership/leaving", json={"holder_id": "u1"})
        finally:
            app.state.ws_manager = original

        assert ownership.get_holder() is not None
        frozen_clock.advance(ownership.AWAY_GRACE_SECONDS + 1.0)

        assert ownership.get_holder() is None

    def test_a_reloading_tab_reclaims_its_own_reserved_slot(
        self, client: TestClient, frozen_clock: FrozenClock
    ) -> None:
        """Reload announces departure, the reloaded page
        claims the same id back, and nothing ever hands the slot away."""
        from wavecore.api.app import app

        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )
        manager = MagicMock()
        manager.broadcast_to_topic = AsyncMock()
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            client.post("/workbench/ownership/leaving", json={"holder_id": "u1"})
            frozen_clock.advance(1.0)
            response = client.post(
                "/workbench/ownership/claim",
                json={"holder_id": "u1", "holder_label": "User One"},
            )
        finally:
            app.state.ws_manager = original

        assert response.status_code == 200
        assert response.json()["data"]["you_are_holder"] is True

        frozen_clock.advance(ownership.AWAY_GRACE_SECONDS + 1.0)
        assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}

    def test_leaving_names_the_page_that_left(self, client: TestClient) -> None:
        from wavecore.api.app import app

        manager = MagicMock()
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            client.post(
                "/workbench/ownership/leaving", json={"holder_id": "u1", "page_id": "page-1"}
            )
        finally:
            app.state.ws_manager = original

        manager.is_current_page.assert_called_once_with("u1", "page-1")
        manager.drop_draft_watcher.assert_called_once_with("u1", "page-1")

    async def test_a_beacon_from_a_replaced_page_changes_nothing(
        self, client: TestClient, frozen_clock: FrozenClock
    ) -> None:
        """The keepalive beacon of a reloaded tab can land after the new page
        re-identified the same tab id; it must not touch the new page."""
        from wavecore.api.app import app
        from wavecore.api.websocket import WebSocketManager, session_registry

        session_registry.clear_sessions()
        manager = WebSocketManager()
        ws = AsyncMock(spec=WebSocket)
        ws.__len__ = MagicMock(return_value=1)
        conn = await manager.connect(ws)
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            with patch.object(ownership, "_emit"):
                await manager.handle_message(
                    conn,
                    '{"type": "identify", "holderId": "u1", "pageId": "page-2"}',
                )
                manager.subscribe(conn, "workbench:draft")
                ownership.claim("u1", "User One")

                response = client.post(
                    "/workbench/ownership/leaving",
                    json={"holder_id": "u1", "page_id": "page-1"},
                )
                frozen_clock.advance(ownership.AWAY_GRACE_SECONDS + 1.0)

                assert ownership.get_holder() == {
                    "id": "u1",
                    "label": "User One",
                    "kind": "person",
                }
        finally:
            app.state.ws_manager = original

        assert response.json()["data"] == {"ok": True}
        assert "workbench:draft" in manager._metadata[conn].subscriptions
        assert [row["session_id"] for row in session_registry.list_sessions()] == ["u1"]

    def test_leaving_removes_the_browser_session_row(self, client: TestClient) -> None:
        from wavecore.api.app import app
        from wavecore.api.websocket import session_registry

        session_registry.clear_sessions()
        session_registry.register_session("u1", "Chrome (macOS)", "10.0.0.5")
        manager = MagicMock()
        manager.broadcast_to_topic = AsyncMock()
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            response = client.post("/workbench/ownership/leaving", json={"holder_id": "u1"})
        finally:
            app.state.ws_manager = original

        assert response.status_code == 200
        assert session_registry.list_sessions() == []

    def test_leaving_without_ws_manager_is_ok(self, client: TestClient) -> None:
        from wavecore.api.app import app

        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = None
        try:
            response = client.post("/workbench/ownership/leaving", json={"holder_id": "ghost"})
        finally:
            app.state.ws_manager = original

        assert response.status_code == 200
        assert response.json()["data"] == {"ok": True}

    def test_leaving_accepts_a_text_plain_beacon(self, client: TestClient) -> None:
        """The browser beacon must stay a CORS simple request (a preflight does
        not survive page unload), so the body arrives without a JSON content type."""
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.post(
            "/workbench/ownership/leaving",
            content='{"holder_id": "u1"}',
            headers={"Content-Type": "text/plain;charset=UTF-8"},
        )

        assert response.status_code == 200
        assert response.json()["data"] == {"ok": True}
        assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}

    def test_leaving_with_an_unreadable_body_is_a_silent_no_op(self, client: TestClient) -> None:
        response = client.post("/workbench/ownership/leaving", content="not json")

        assert response.status_code == 200
        assert response.json()["data"] == {"ok": True}

    def test_leaving_with_a_non_object_body_is_a_silent_no_op(self, client: TestClient) -> None:
        response = client.post("/workbench/ownership/leaving", content='["u1"]')

        assert response.status_code == 200
        assert response.json()["data"] == {"ok": True}

    def test_leaving_without_a_holder_id_is_a_silent_no_op(self, client: TestClient) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("u1", "User One")

        response = client.post("/workbench/ownership/leaving", json={"holder_id": 7})

        assert response.status_code == 200
        assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}


class TestClearResetsTheReservation:
    """Test isolation stays complete: no reservation leaks past a reset."""

    async def test_clear_drops_a_live_away_reservation(self, frozen_clock: FrozenClock) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("u1", "User One")
            ownership.mark_away("u1")

            ownership.clear()
            ownership.claim("u1", "User One")
            frozen_clock.advance(ownership.AWAY_GRACE_SECONDS + 1.0)

            assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}


class TestStaleSweepUnchanged:
    """The sweep keeps its last-resort role; the away work does not retune it."""

    async def test_a_watched_holder_past_the_timeout_is_still_swept(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("u1", "User One")
            ownership._watchers = 1
            ownership._holder["last_heartbeat"] = 100.0
            mock_emit.reset_mock()

            ownership.sweep_stale(100.0 + ownership.HOLDER_TIMEOUT_SECONDS + 1.0)

            assert ownership.get_holder() is None
            mock_emit.assert_called_once_with({"event": "holder_changed", "holder": None})

    async def test_an_unwatched_holder_past_the_timeout_is_still_retained(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("u1", "User One")
            ownership._watchers = 0
            ownership._holder["last_heartbeat"] = 100.0
            mock_emit.reset_mock()

            ownership.sweep_stale(100.0 + ownership.HOLDER_TIMEOUT_SECONDS + 1.0)

            assert ownership.get_holder() is not None
            mock_emit.assert_not_called()

    async def test_the_timeout_outlasts_background_tab_throttling(self) -> None:
        # A hidden tab's liveness interval stretches to about a minute, so the
        # window must clear several throttled beats before it reaps anything.
        assert ownership.HOLDER_TIMEOUT_SECONDS == 180.0
        assert ownership.SWEEP_INTERVAL_SECONDS == 15.0


class TestEmitBroadcast:
    """Ownership events go out on the draft topic."""

    async def test_emit_broadcasts_the_envelope_on_the_draft_topic(self) -> None:
        from wavecore.api.app import app

        manager = AsyncMock()
        original = getattr(app.state, "ws_manager", None)
        app.state.ws_manager = manager
        try:
            ownership._emit({"event": "holder_changed", "holder": None})
            for task in list(events._emit_tasks):
                await task
        finally:
            app.state.ws_manager = original

        topic, envelope = manager.broadcast_to_topic.await_args.args
        assert topic == "workbench:draft"
        assert envelope["topic"] == "workbench:draft"
        assert envelope["payload"] == {"event": "holder_changed", "holder": None}
