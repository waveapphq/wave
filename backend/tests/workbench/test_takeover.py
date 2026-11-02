"""Workbench take-over service + route contract.

Covers request/resolve/deny/force/release-hands-to-pending on
wavecore.api.services.workbench.ownership plus the take-over REST routes.
"""

from unittest.mock import call, patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    ValidationException,
)
from wavecore.api.services.workbench import ownership

HOLDER_ONE = {"id": "h1", "label": "Holder One", "kind": "person"}
REQ_ONE = {"id": "r1", "label": "Requester One", "kind": "person"}
REQ_TWO = {"id": "r2", "label": "Requester Two", "kind": "person"}
PENDING_R1 = {"requester_id": "r1", "requester_label": "Requester One"}

ALREADY_HOLD_MESSAGE = r"^You already hold this session$"
PENDING_MESSAGE = r"^A take-over request is already pending$"
NOT_HOLDER_MESSAGE = r"^You are not the session holder$"
NO_PENDING_MESSAGE = r"^No pending take-over request$"

CLAIM_URL = "/workbench/ownership/claim"
TAKEOVER_URL = "/workbench/ownership/takeover"
APPROVE_URL = "/workbench/ownership/takeover/approve"
DENY_URL = "/workbench/ownership/takeover/deny"
CANCEL_URL = "/workbench/ownership/takeover/cancel"
FORCE_URL = "/workbench/ownership/takeover/force"


class TestRequestTakeover:
    async def test_person_holder_request_awaits_approval(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One", "person")
            mock_emit.reset_mock()
            result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "awaiting_approval"
        assert ownership._pending_takeover == PENDING_R1
        mock_emit.assert_called_once_with(
            {"event": "takeover_requested", "requester_label": "Requester One"}
        )

    async def test_mcp_holder_request_awaits_release(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("s1", "claude-code (MCP)", "mcp")
            mock_emit.reset_mock()
            result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "awaiting_release"
        assert ownership._pending_takeover == PENDING_R1
        mock_emit.assert_called_once_with(
            {"event": "takeover_requested", "requester_label": "Requester One"}
        )

    async def test_idle_request_grants_immediately(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "granted"
        assert ownership.get_holder() == REQ_ONE
        mock_emit.assert_called_once_with({"event": "holder_changed", "holder": REQ_ONE})

    async def test_request_by_current_holder_rejected(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One", "person")

        with pytest.raises(ValidationException, match=ALREADY_HOLD_MESSAGE):
            ownership.request_takeover("h1", "Holder One")

    async def test_second_request_while_pending_conflicts(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One", "person")
            ownership.request_takeover("r1", "Requester One")

        with pytest.raises(ConflictException, match=PENDING_MESSAGE):
            ownership.request_takeover("r2", "Requester Two")


class TestResolveApprove:
    async def test_approve_transfers_to_requester(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One", "person")
            ownership.request_takeover("r1", "Requester One")
            mock_emit.reset_mock()
            result = ownership.resolve_takeover("h1", True)

        assert result["outcome"] == "granted"
        assert ownership.get_holder() == REQ_ONE
        assert ownership._pending_takeover is None
        assert mock_emit.call_args_list == [
            call({"event": "takeover_resolved", "outcome": "granted", "new_holder": REQ_ONE}),
            call({"event": "holder_changed", "holder": REQ_ONE}),
        ]


class TestResolveDeny:
    async def test_deny_clears_pending_and_keeps_holder(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One", "person")
            ownership.request_takeover("r1", "Requester One")
            mock_emit.reset_mock()
            result = ownership.resolve_takeover("h1", False)

        assert result["outcome"] == "denied"
        assert ownership._pending_takeover is None
        assert ownership.get_holder() == HOLDER_ONE
        mock_emit.assert_called_once_with(
            {"event": "takeover_resolved", "outcome": "denied", "new_holder": HOLDER_ONE}
        )


class TestResolveErrors:
    async def test_resolve_without_pending_raises_not_found(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One", "person")

        with pytest.raises(NotFoundException, match=NO_PENDING_MESSAGE):
            ownership.resolve_takeover("h1", True)

    async def test_resolve_by_non_holder_raises_conflict(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One", "person")
            ownership.request_takeover("r1", "Requester One")

        with pytest.raises(ConflictException, match=NOT_HOLDER_MESSAGE):
            ownership.resolve_takeover("r1", True)


class TestForce:
    async def test_force_with_person_holder_transfers_without_suspend(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One", "person")
            mock_emit.reset_mock()
            ownership.force_takeover("r1", "Requester One")

        assert ownership.get_holder() == REQ_ONE
        assert ownership.get_suspended() is None
        mock_emit.assert_called_once_with({"event": "holder_changed", "holder": REQ_ONE})

    async def test_force_with_no_holder_transfers(self) -> None:
        with patch.object(ownership, "_emit"):
            result = ownership.force_takeover("r1", "Requester One")

        assert ownership.get_holder() == REQ_ONE
        assert result["holder"] == REQ_ONE

    async def test_force_clears_pending(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One", "person")
            ownership.request_takeover("r1", "Requester One")
            ownership.force_takeover("r2", "Requester Two")

        assert ownership._pending_takeover is None
        assert ownership.get_holder() == REQ_TWO


class TestCancelTakeover:
    async def test_cancel_clears_pending_and_keeps_holder(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One", "person")
            ownership.request_takeover("r1", "Requester One")
            mock_emit.reset_mock()
            result = ownership.cancel_takeover("r1")

        assert result["outcome"] == "denied"
        assert ownership._pending_takeover is None
        assert ownership.get_holder() == HOLDER_ONE
        mock_emit.assert_called_once_with(
            {"event": "takeover_resolved", "outcome": "denied", "new_holder": HOLDER_ONE}
        )

    async def test_cancel_without_pending_raises_not_found(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One", "person")

        with pytest.raises(NotFoundException, match=NO_PENDING_MESSAGE):
            ownership.cancel_takeover("r1")

    async def test_cancel_by_non_requester_raises_not_found(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One", "person")
            ownership.request_takeover("r1", "Requester One")

        with pytest.raises(NotFoundException, match=NO_PENDING_MESSAGE):
            ownership.cancel_takeover("r2")


class TestReleaseHandsToPending:
    async def test_release_with_pending_hands_over(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One", "person")
            ownership.request_takeover("r1", "Requester One")
            mock_emit.reset_mock()
            ownership.release("h1")

        assert ownership.get_holder() == REQ_ONE
        assert ownership._pending_takeover is None
        assert ownership.get_suspended() is None
        assert mock_emit.call_args_list == [
            call({"event": "takeover_resolved", "outcome": "granted", "new_holder": REQ_ONE}),
            call({"event": "holder_changed", "holder": REQ_ONE}),
        ]


class TestTakeoverRoutes:
    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_person_takeover_returns_awaiting_approval(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})

        resp = client.post(
            TAKEOVER_URL, json={"requester_id": "r1", "requester_label": "Requester One"}
        )

        assert resp.status_code == 200
        assert resp.json()["data"]["outcome"] == "awaiting_approval"

    def test_second_takeover_conflicts(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})
        client.post(TAKEOVER_URL, json={"requester_id": "r1", "requester_label": "Requester One"})

        resp = client.post(
            TAKEOVER_URL, json={"requester_id": "r2", "requester_label": "Requester Two"}
        )

        assert resp.status_code == 409
        assert resp.json()["error"]["message"] == "A take-over request is already pending"

    def test_takeover_by_holder_is_bad_request(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})

        resp = client.post(
            TAKEOVER_URL, json={"requester_id": "h1", "requester_label": "Holder One"}
        )

        assert resp.status_code == 400
        assert resp.json()["error"]["message"] == "You already hold this session"

    def test_approve_by_non_holder_conflicts(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})
        client.post(TAKEOVER_URL, json={"requester_id": "r1", "requester_label": "Requester One"})

        resp = client.post(APPROVE_URL, json={"holder_id": "r1"})

        assert resp.status_code == 409
        assert resp.json()["error"]["message"] == "You are not the session holder"

    def test_approve_without_pending_is_not_found(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})

        resp = client.post(APPROVE_URL, json={"holder_id": "h1"})

        assert resp.status_code == 404
        assert resp.json()["error"]["message"] == "No pending take-over request"

    def test_force_takeover_makes_requester_holder(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})

        resp = client.post(
            FORCE_URL, json={"requester_id": "r1", "requester_label": "Requester One"}
        )

        assert resp.status_code == 200
        assert resp.json()["data"]["you_are_holder"] is True

    def test_deny_takeover_keeps_holder(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})
        client.post(TAKEOVER_URL, json={"requester_id": "r1", "requester_label": "Requester One"})

        resp = client.post(DENY_URL, json={"holder_id": "h1"})

        assert resp.status_code == 200
        assert resp.json()["data"]["outcome"] == "denied"

    def test_cancel_takeover_clears_pending(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})
        client.post(TAKEOVER_URL, json={"requester_id": "r1", "requester_label": "Requester One"})

        resp = client.post(CANCEL_URL, json={"requester_id": "r1"})

        assert resp.status_code == 200
        assert resp.json()["data"]["outcome"] == "denied"

    def test_cancel_without_pending_is_not_found(self, client: TestClient) -> None:
        client.post(CLAIM_URL, json={"holder_id": "h1", "holder_label": "Holder One"})

        resp = client.post(CANCEL_URL, json={"requester_id": "r1"})

        assert resp.status_code == 404
        assert resp.json()["error"]["message"] == "No pending take-over request"
