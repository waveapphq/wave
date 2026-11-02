"""In-memory browser-session registry contract.

Mirrors wavecore/mcp/state.py but for browser sockets: no client_version, no
activity feed, and a remove/close split (normal disconnect leaves no tombstone,
admin close does).
"""

from unittest.mock import patch

ROW_KEYS = {
    "session_id",
    "client",
    "ip",
    "connected_at",
    "last_activity",
}


class TestRegisterList:
    """register_session records rows; list_sessions returns exact-key copies."""

    def test_register_two_lists_both_with_exact_keys(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("s2", "Firefox (Windows)", "10.0.0.6")

        rows = {row["session_id"]: row for row in session_registry.list_sessions()}
        assert set(rows.keys()) == {"s1", "s2"}
        for row in rows.values():
            assert set(row.keys()) == ROW_KEYS

    def test_register_round_trips_values_and_equal_timestamps(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")

        row = session_registry.list_sessions()[0]
        assert row["session_id"] == "s1"
        assert row["client"] == "Chrome (macOS)"
        assert row["ip"] == "10.0.0.5"
        assert isinstance(row["connected_at"], str)
        assert isinstance(row["last_activity"], str)
        assert row["connected_at"] == row["last_activity"]

    def test_list_sessions_returns_copies(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")

        rows = session_registry.list_sessions()
        rows[0]["client"] = "HACKED"
        assert session_registry.list_sessions()[0]["client"] == "Chrome (macOS)"


class TestTouch:
    """touch_session bumps last_activity only, and is a no-op for unknown ids."""

    def test_touch_bumps_last_activity_only(self) -> None:
        from wavecore.api.websocket import session_registry

        with patch.object(
            session_registry,
            "_now_iso",
            side_effect=["2026-07-25T00:00:01+00:00", "2026-07-25T00:00:02+00:00"],
        ):
            session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")
            session_registry.touch_session("s1")

        row = session_registry.list_sessions()[0]
        assert row["connected_at"] == "2026-07-25T00:00:01+00:00"
        assert row["last_activity"] == "2026-07-25T00:00:02+00:00"

    def test_touch_unknown_is_noop(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.touch_session("ghost")
        assert session_registry.list_sessions() == []


class TestRemoveVsClose:
    """remove_session leaves no tombstone; close_session tombstones and reports."""

    def test_remove_session_drops_row_without_tombstone(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")
        session_registry.remove_session("s1")

        assert session_registry.list_sessions() == []
        assert session_registry.is_session_closed("s1") is False

    def test_remove_unknown_is_noop(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.remove_session("ghost")
        assert session_registry.list_sessions() == []

    def test_close_session_drops_row_and_tombstones(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")

        assert session_registry.close_session("s1") is True
        assert session_registry.list_sessions() == []
        assert session_registry.is_session_closed("s1") is True

    def test_close_unknown_returns_false(self) -> None:
        from wavecore.api.websocket import session_registry

        assert session_registry.close_session("ghost") is False


class TestTombstone:
    """is_session_closed membership and re-register un-tombstoning."""

    def test_unknown_is_not_closed(self) -> None:
        from wavecore.api.websocket import session_registry

        assert session_registry.is_session_closed("never-seen") is False

    def test_reregister_untombstones(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")
        session_registry.close_session("s1")
        assert session_registry.is_session_closed("s1") is True

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")
        assert session_registry.is_session_closed("s1") is False
        assert len(session_registry.list_sessions()) == 1


class TestBulk:
    """disconnect_others (with/without exclude) and disconnect_all tombstone."""

    def test_disconnect_others_excludes_requester(self) -> None:
        from wavecore.api.websocket import session_registry

        for sid in ("me", "a", "b"):
            session_registry.register_session(sid, "Chrome (macOS)", "10.0.0.5")

        assert session_registry.disconnect_others(exclude="me") == 2
        remaining = {row["session_id"] for row in session_registry.list_sessions()}
        assert remaining == {"me"}
        assert session_registry.is_session_closed("me") is False
        assert session_registry.is_session_closed("a") is True
        assert session_registry.is_session_closed("b") is True

    def test_disconnect_others_without_exclude_tombstones_all(self) -> None:
        from wavecore.api.websocket import session_registry

        for sid in ("a", "b"):
            session_registry.register_session(sid, "Chrome (macOS)", "10.0.0.5")

        assert session_registry.disconnect_others() == 2
        assert session_registry.list_sessions() == []
        assert session_registry.is_session_closed("a") is True
        assert session_registry.is_session_closed("b") is True

    def test_disconnect_all_tombstones_everyone(self) -> None:
        from wavecore.api.websocket import session_registry

        for sid in ("a", "b", "c"):
            session_registry.register_session(sid, "Chrome (macOS)", "10.0.0.5")

        assert session_registry.disconnect_all() == 3
        assert session_registry.list_sessions() == []
        for sid in ("a", "b", "c"):
            assert session_registry.is_session_closed(sid) is True


class TestClear:
    """clear_sessions wipes both rows and tombstones."""

    def test_clear_wipes_rows_and_tombstones(self) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("s2", "Firefox (Windows)", "10.0.0.6")
        session_registry.close_session("s2")

        session_registry.clear_sessions()

        assert session_registry.list_sessions() == []
        assert session_registry.is_session_closed("s1") is False
        assert session_registry.is_session_closed("s2") is False
