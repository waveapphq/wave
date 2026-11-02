"""MCP holder label + MCP-kind session ownership.

Covers wavecore.mcp.state.mcp_holder_label and the MCP-holder branches of
wavecore.api.services.workbench.ownership (mcp-kind claim projection, graceful
handoff on release-after-request, forced-takeover suspension, and request
outcome by holder kind).
"""

import contextlib
from collections.abc import Generator
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _reset_ownership() -> Generator[None, None, None]:
    _clear_ownership()
    yield
    _clear_ownership()


def _clear_ownership() -> None:
    with contextlib.suppress(ImportError):
        from wavecore.api.services.workbench import ownership

        ownership.clear()


class TestMcpHolderLabel:
    async def test_known_session_label_is_client_mcp(self) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")

        assert mcp_state.mcp_holder_label("s1") == "claude-code (MCP)"

    async def test_unknown_session_falls_back_to_client_mcp(self) -> None:
        from wavecore.mcp import state as mcp_state

        assert mcp_state.mcp_holder_label("ghost") == "client (MCP)"

    async def test_label_always_ends_with_mcp_suffix(self) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")

        assert mcp_state.mcp_holder_label("s1").endswith(" (MCP)")


class TestMcpClaims:
    async def test_mcp_claim_records_mcp_kind_and_label(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", mcp_state.mcp_holder_label("s1"), "mcp")

        holder = ownership.get_holder()
        assert holder is not None
        assert holder["kind"] == "mcp"
        assert holder["label"].endswith(" (MCP)")

    async def test_get_ownership_projects_the_mcp_holder(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", mcp_state.mcp_holder_label("s1"), "mcp")

        assert ownership.get_ownership()["holder"]["kind"] == "mcp"


class TestGracefulReleaseAfterRequest:
    async def test_release_after_request_hands_over_without_suspending(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", mcp_state.mcp_holder_label("s1"), "mcp")
            request = ownership.request_takeover("r1", "Ashley")
            assert request["outcome"] == "awaiting_release"

            result = ownership.release("s1", "handoff")

        holder = result["holder"]
        assert holder["id"] == "r1"
        assert holder["kind"] == "person"
        assert ownership.get_suspended() is None


class TestForceSuspends:
    async def test_force_takeover_suspends_the_mcp_holder(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", mcp_state.mcp_holder_label("s1"), "mcp")
            result = ownership.force_takeover("r1", "Ashley")

        assert result["holder"]["id"] == "r1"
        assert ownership.get_suspended() == {"holder_id": "s1", "label": "claude-code (MCP)"}


class TestRunHeldWrite:
    async def test_write_runs_while_holding_and_releases(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state
        from wavecore.mcp.tools import author

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        seen: dict[str, Any] = {}

        def write() -> dict[str, Any]:
            seen["holder"] = ownership.get_holder()
            return {"created": True}

        with patch.object(ownership, "_emit"):
            result = author.run_held_write("s1", "created", write)

        assert result == {"created": True}
        assert seen["holder"] == {"id": "s1", "label": "claude-code (MCP)", "kind": "mcp"}
        assert ownership.get_holder() is None

    async def test_without_session_id_uses_the_fallback_identity(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp.tools import author

        seen: dict[str, Any] = {}

        def write() -> dict[str, Any]:
            seen["holder"] = ownership.get_holder()
            return {"created": True}

        with patch.object(ownership, "_emit"):
            author.run_held_write(None, "created", write)

        assert seen["holder"] == {"id": "mcp", "label": "client (MCP)", "kind": "mcp"}

    async def test_held_by_another_returns_finding_without_writing(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp.tools import author

        with patch.object(ownership, "_emit"):
            ownership.claim("u1", "User One", "person")
            # A dirty holder never auto-yields, so the claim still conflicts.
            ownership.set_holder_dirty("u1", True)

            result = author.run_held_write(
                "s1", "created", lambda: pytest.fail("write must not run")
            )

        assert result["created"] is False
        assert result["findings"] == [
            {
                "step": "test",
                "code": "SESSION_HELD",
                "severity": "error",
                "problem": "The workbench session is already held",
                "fix": author.SESSION_HELD_FIX,
            }
        ]
        assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}

    async def test_pending_takeover_is_granted_after_the_write(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state
        from wavecore.mcp.tools import author

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")

        def write() -> dict[str, Any]:
            ownership.request_takeover("r1", "Ashley")
            return {"created": True}

        with patch.object(ownership, "_emit"):
            result = author.run_held_write("s1", "created", write)

        assert result == {"created": True}
        holder = ownership.get_holder()
        assert holder is not None
        assert holder["id"] == "r1"
        assert ownership.get_suspended() is None

    async def test_forced_displacement_mid_write_is_tolerated(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state
        from wavecore.mcp.tools import author

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")

        def write() -> dict[str, Any]:
            ownership.force_takeover("r1", "Ashley")
            return {"created": True}

        with patch.object(ownership, "_emit"):
            result = author.run_held_write("s1", "created", write)

        assert result == {"created": True}
        holder = ownership.get_holder()
        assert holder is not None
        assert holder["id"] == "r1"
        assert ownership.get_suspended() == {"holder_id": "s1", "label": "claude-code (MCP)"}


class TestSessionIdFromContext:
    async def test_without_context_is_none(self) -> None:
        from wavecore.mcp import server as mcp_server

        assert mcp_server._session_id_from(None) is None

    async def test_reads_the_session_header(self) -> None:
        from wavecore.mcp import server as mcp_server

        ctx = SimpleNamespace(headers={"mcp-session-id": "s9"})
        assert mcp_server._session_id_from(ctx) == "s9"

    async def test_context_outside_a_request_is_none(self) -> None:
        from mcp.server.mcpserver import Context

        from wavecore.mcp import server as mcp_server

        assert mcp_server._session_id_from(Context()) is None

    async def test_transport_without_headers_is_none(self) -> None:
        from wavecore.mcp import server as mcp_server

        ctx = SimpleNamespace(headers=None)
        assert mcp_server._session_id_from(ctx) is None

    async def test_absent_header_is_none(self) -> None:
        from wavecore.mcp import server as mcp_server

        ctx = SimpleNamespace(headers={})
        assert mcp_server._session_id_from(ctx) is None


class TestClientNameFromContext:
    async def test_without_context_is_none(self) -> None:
        from wavecore.mcp import server as mcp_server

        assert mcp_server._client_name_from(None) is None

    async def test_context_outside_a_request_is_none(self) -> None:
        from mcp.server.mcpserver import Context

        from wavecore.mcp import server as mcp_server

        assert mcp_server._client_name_from(Context()) is None

    async def test_reads_the_client_info_name(self) -> None:
        from wavecore.mcp import server as mcp_server

        info = SimpleNamespace(name="claude-code")
        session = SimpleNamespace(client_params=SimpleNamespace(client_info=info))
        assert mcp_server._client_name_from(SimpleNamespace(session=session)) == "claude-code"


class TestAuthoringToolWrappers:
    async def test_create_wrapper_writes_through_the_held_slot(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp.tools import author

        with (
            patch.object(ownership, "_emit"),
            patch.object(
                author, "create_test_from_recipe", return_value={"created": True}
            ) as mock_create,
        ):
            result = mcp_server._create_test_from_recipe_tool("recipe-text")

        mock_create.assert_called_once_with("recipe-text")
        assert result == {"created": True}
        assert ownership.get_holder() is None

    async def test_amend_wrapper_writes_through_the_held_slot(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp.tools import author

        with (
            patch.object(ownership, "_emit"),
            patch.object(
                author, "amend_test_from_recipe", return_value={"amended": True}
            ) as mock_amend,
        ):
            result = mcp_server._amend_test_from_recipe_tool("ref-1", "recipe-text")

        mock_amend.assert_called_once_with("ref-1", "recipe-text")
        assert result == {"amended": True}
        assert ownership.get_holder() is None

    async def test_build_wrapper_injects_the_session_id(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp.tools import watch

        with patch.object(
            watch, "build_test_from_recipe", return_value={"built": True}
        ) as mock_build:
            result = await mcp_server._build_test_from_recipe_tool("recipe-text")

        mock_build.assert_awaited_once_with("recipe-text", session_id=None)
        assert result == {"built": True}


class TestRequestOutcomeByKind:
    async def test_request_against_an_mcp_holder_awaits_release(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", mcp_state.mcp_holder_label("s1"), "mcp")
            result = ownership.request_takeover("r1", "Ashley")

        assert result["outcome"] == "awaiting_release"

    async def test_request_against_a_person_holder_awaits_approval(self) -> None:
        from wavecore.api.services.workbench import ownership

        with patch.object(ownership, "_emit"):
            ownership.claim("p1", "Will", "person")
            result = ownership.request_takeover("r1", "Ashley")

        assert result["outcome"] == "awaiting_approval"
