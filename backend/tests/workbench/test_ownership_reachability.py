"""Connection-loss reachability guard for workbench ownership.

A lost WebSocket connection only releases the slot when that holder id has no
other live connection behind it, and never releases an assistant holder, which
owns no browser socket at all.
"""

from unittest.mock import patch

from wavecore.api.services.workbench import ownership

_HOLDER_FREED = {"event": "holder_changed", "holder": None}


class TestPersonHolderReachability:
    """A person holder is freed only when nothing live carries its id."""

    async def test_lost_connection_with_holder_still_connected_retains_the_slot(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            mock_emit.reset_mock()

            ownership.on_connection_lost("h1", still_connected=True)

            assert ownership.get_holder() == {"id": "h1", "label": "H1", "kind": "person"}
            mock_emit.assert_not_called()

    async def test_lost_connection_with_no_other_connection_frees_and_emits(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            mock_emit.reset_mock()

            ownership.on_connection_lost("h1", still_connected=False)

            assert ownership.get_holder() is None
            mock_emit.assert_called_once_with(_HOLDER_FREED)

    async def test_still_connected_defaults_to_false(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            mock_emit.reset_mock()

            ownership.on_connection_lost("h1")

            assert ownership.get_holder() is None
            mock_emit.assert_called_once_with(_HOLDER_FREED)

    async def test_still_connected_may_be_passed_positionally(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

            ownership.on_connection_lost("h1", True)

            assert ownership.get_holder() is not None

    async def test_lost_connection_of_a_non_holder_never_touches_the_slot(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            mock_emit.reset_mock()

            ownership.on_connection_lost("other", still_connected=False)

            assert ownership.get_holder()["id"] == "h1"
            mock_emit.assert_not_called()

    async def test_lost_connection_while_the_slot_is_free_is_a_no_op(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.on_connection_lost("ghost", still_connected=False)

            assert ownership.get_holder() is None
            mock_emit.assert_not_called()

    async def test_a_returning_tab_survives_the_late_cleanup_of_its_old_socket(self) -> None:
        """The refreshed-away socket is reaped long after the
        tab is back, and must not evict the tab that legitimately returned."""
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("tab-1", "Chrome (Linux)", "person")
            mock_emit.reset_mock()

            ownership.on_connection_lost("tab-1", still_connected=True)

            assert ownership.get_ownership()["holder"] == {
                "id": "tab-1",
                "label": "Chrome (Linux)",
                "kind": "person",
            }
            mock_emit.assert_not_called()


class TestAssistantHolderIsExempt:
    """An MCP holder claims over REST and owns no browser socket."""

    async def test_mcp_holder_is_not_freed_by_an_unreachable_connection(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("mcp-1", "Claude", "mcp")
            mock_emit.reset_mock()

            ownership.on_connection_lost("mcp-1", still_connected=False)

            assert ownership.get_holder() == {"id": "mcp-1", "label": "Claude", "kind": "mcp"}
            mock_emit.assert_not_called()

    async def test_mcp_holder_is_not_freed_when_still_connected_either(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("mcp-1", "Claude", "mcp")
            mock_emit.reset_mock()

            ownership.on_connection_lost("mcp-1", still_connected=True)

            assert ownership.get_holder()["kind"] == "mcp"
            mock_emit.assert_not_called()
