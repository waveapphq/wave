"""Bounded away-reservation for a departing workbench holder.

The leaving beacon marks the holder away instead of freeing the slot outright, so
a reload lands back in its own session while a watcher keeps mirroring. The
reservation expires on read as well as on the sweep, and whichever route notices
first broadcasts exactly once.
"""

from typing import Any
from unittest.mock import patch

import pytest

from tests.workbench.conftest import FrozenClock
from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import ownership

_HOLDER_FREED = {"event": "holder_changed", "holder": None}
_H1 = {"id": "h1", "label": "H1", "kind": "person"}


def _snapshot() -> dict[str, Any]:
    return {"nodes": [{"id": "n1"}], "edges": [], "variables": {}}


class TestGraceConstant:
    def test_default_grace_is_five_seconds(self) -> None:
        assert ownership.AWAY_GRACE_SECONDS == 5.0


class TestMarkAway:
    """Marking away changes nothing a watcher can see."""

    async def test_the_slot_still_reads_as_held(self, frozen_clock: FrozenClock) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            mock_emit.reset_mock()

            ownership.mark_away("h1")

            assert ownership.get_ownership()["holder"] == _H1
            assert ownership.get_holder() == _H1
            mock_emit.assert_not_called()

    async def test_marking_a_non_holder_id_reserves_nothing(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            mock_emit.reset_mock()

            ownership.mark_away("someone-else")
            frozen_clock.advance(60.0)

            assert ownership.get_holder() == _H1
            mock_emit.assert_not_called()

    async def test_marking_away_while_the_slot_is_free_is_a_no_op(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.mark_away("ghost")
            frozen_clock.advance(60.0)

            assert ownership.get_holder() is None
            mock_emit.assert_not_called()

    async def test_an_assistant_holder_is_never_reserved(self, frozen_clock: FrozenClock) -> None:
        """An MCP holder owns no browser socket, so no departure applies."""
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("mcp-1", "Claude", "mcp")
            mock_emit.reset_mock()

            ownership.mark_away("mcp-1")
            frozen_clock.advance(60.0)

            assert ownership.get_holder() == {"id": "mcp-1", "label": "Claude", "kind": "mcp"}
            mock_emit.assert_not_called()

    async def test_an_explicit_grace_overrides_the_default(self, frozen_clock: FrozenClock) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

            ownership.mark_away("h1", grace=30.0)
            frozen_clock.advance(6.0)
            assert ownership.get_holder() == _H1

            frozen_clock.advance(25.0)
            assert ownership.get_holder() is None

    async def test_marking_away_again_restarts_the_window(self, frozen_clock: FrozenClock) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")

            ownership.mark_away("h1")
            frozen_clock.advance(4.0)
            ownership.mark_away("h1")
            frozen_clock.advance(4.0)

            assert ownership.get_holder() == _H1


class TestInsideTheWindow:
    """A reserved slot behaves exactly like a held one until the grace lapses."""

    async def test_a_claim_from_another_id_still_conflicts(self, frozen_clock: FrozenClock) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            frozen_clock.advance(2.0)

            with pytest.raises(ConflictException, match=r"^The workbench session is already held$"):
                ownership.claim("h2", "H2", "person")

            assert ownership.get_holder() == _H1

    async def test_the_same_id_reclaiming_clears_the_reservation(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            frozen_clock.advance(2.0)
            mock_emit.reset_mock()

            result = ownership.claim("h1", "H1", "person")

            assert result["holder"] == _H1
            mock_emit.assert_not_called()

            frozen_clock.advance(30.0)
            assert ownership.get_holder() == _H1

    async def test_neither_read_nor_sweep_frees_the_slot_early(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            mock_emit.reset_mock()
            frozen_clock.advance(4.9)

            assert ownership.get_ownership()["holder"] == _H1
            ownership.sweep_stale(frozen_clock())

            assert ownership.get_holder() == _H1
            mock_emit.assert_not_called()


class TestExpiry:
    """An elapsed reservation settles through the shared free-slot path."""

    async def test_reading_ownership_frees_the_slot_and_emits_once(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            mock_emit.reset_mock()
            frozen_clock.advance(6.0)

            assert ownership.get_ownership()["holder"] is None
            mock_emit.assert_called_once_with(_HOLDER_FREED)

    async def test_reading_the_holder_frees_the_slot_and_emits_once(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            mock_emit.reset_mock()
            frozen_clock.advance(6.0)

            assert ownership.get_holder() is None
            mock_emit.assert_called_once_with(_HOLDER_FREED)

    async def test_the_sweep_frees_an_expired_reservation_with_no_watchers(
        self, frozen_clock: FrozenClock
    ) -> None:
        """Nobody is watching, so only the reservation can be freeing this slot."""
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            ownership.set_watchers(0)
            mock_emit.reset_mock()
            frozen_clock.advance(6.0)

            ownership.sweep_stale(frozen_clock())

            assert ownership.get_holder() is None
            mock_emit.assert_called_once_with(_HOLDER_FREED)

    async def test_repeated_reads_do_not_duplicate_the_broadcast(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            mock_emit.reset_mock()
            frozen_clock.advance(6.0)

            ownership.get_ownership()
            ownership.get_ownership()
            ownership.get_holder()

            assert mock_emit.call_count == 1

    async def test_a_sweep_after_a_read_does_not_re_emit(self, frozen_clock: FrozenClock) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            mock_emit.reset_mock()
            frozen_clock.advance(6.0)

            ownership.get_ownership()
            ownership.sweep_stale(frozen_clock())

            assert mock_emit.call_count == 1

    async def test_a_read_after_a_sweep_does_not_re_emit(self, frozen_clock: FrozenClock) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            mock_emit.reset_mock()
            frozen_clock.advance(6.0)

            ownership.sweep_stale(frozen_clock())
            ownership.get_ownership()

            assert mock_emit.call_count == 1

    async def test_expiry_voids_the_cached_draft(self, frozen_clock: FrozenClock) -> None:
        """The settle runs the same free-slot path, so the stale graph cannot
        seed a fresh mirror."""
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            ownership.apply_draft("h1", _snapshot())
            ownership.mark_away("h1")
            frozen_clock.advance(6.0)

            assert ownership.get_ownership()["holder"] is None
            assert ownership.get_shared_draft() is None

    async def test_a_claim_after_the_grace_settles_the_slot_and_succeeds(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.mark_away("h1")
            mock_emit.reset_mock()
            frozen_clock.advance(6.0)

            result = ownership.claim("h2", "H2", "person")

            assert result["holder"] == {"id": "h2", "label": "H2", "kind": "person"}
            assert ownership.get_holder() == {"id": "h2", "label": "H2", "kind": "person"}
            assert [call.args[0] for call in mock_emit.call_args_list] == [
                _HOLDER_FREED,
                {
                    "event": "holder_changed",
                    "holder": {"id": "h2", "label": "H2", "kind": "person"},
                },
            ]


class TestPendingTakeoverSurvivesTheWindow:
    """The reservation must not swallow a take-over already lodged."""

    async def test_the_request_stays_pending_while_the_holder_is_away(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            ownership.request_takeover("w1", "W1")

            ownership.mark_away("h1")
            frozen_clock.advance(2.0)

            state = ownership.get_ownership()
            assert state["holder"] == _H1
            assert state["pending_takeover"] == {"requester_label": "W1"}

    async def test_the_expiring_reservation_grants_the_pending_request(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.request_takeover("w1", "W1")
            ownership.mark_away("h1")
            mock_emit.reset_mock()
            frozen_clock.advance(6.0)

            state = ownership.get_ownership()

            assert state["holder"] == {"id": "w1", "label": "W1", "kind": "person"}
            assert state["pending_takeover"] is None
            emitted = [call.args[0] for call in mock_emit.call_args_list]
            assert {
                "event": "takeover_resolved",
                "outcome": "granted",
                "new_holder": {"id": "w1", "label": "W1", "kind": "person"},
            } in emitted
            assert {
                "event": "holder_changed",
                "holder": {"id": "w1", "label": "W1", "kind": "person"},
            } in emitted

    async def test_the_granted_requester_is_not_itself_left_reserved(
        self, frozen_clock: FrozenClock
    ) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            ownership.request_takeover("w1", "W1")
            ownership.mark_away("h1")
            frozen_clock.advance(6.0)
            ownership.get_ownership()

            frozen_clock.advance(60.0)

            assert ownership.get_holder() == {"id": "w1", "label": "W1", "kind": "person"}
