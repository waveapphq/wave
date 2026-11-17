"""Watch-mode tools: build_test_from_recipe (REQ-5.2.7.9) and amend_test_live_from_recipe.

The watch build mirrors create_test_from_recipe's envelope/findings/secret and
up-front name-conflict checks, but holds the workbench slot across a paced
reveal that pushes one growing draft frame per node through
ownership.apply_draft (each carrying active_node_id), then persists through the
strict save pipeline. A take-over requested mid-reveal abandons the build
without saving. The watched change does the same for amend_test_from_recipe:
step one, one turn per added or changed Block, one save.
"""

import asyncio
import contextlib
import json
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import yaml

from tests.core.layout.flow_order import flow_order_findings
from tests.core.layout.storyboard import STEPS, positions_by_label, seed_profiles, step_recipe
from tests.core.recipes.block_creation_values import SSH_OPEN_CREATION_VALUES
from tests.core.recipes.conftest import LOG_STEP, find_finding, make_recipe
from tests.mcp.conftest import create_test_entity

NAME_CONFLICT_FIX = (
    "Choose a different test name, or amend the existing test with amend_test_from_recipe."
)
SESSION_HELD_FIX = (
    "Another editor currently holds the workbench session. Ask them to release "
    "it or hand it over, then retry."
)


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:
    """Recipe compilation resolves blocks against the live registries."""


@pytest.fixture(autouse=True)
def clear_entity_caches(temp_storage_path: Path) -> Generator[None, None, None]:
    from wavecore.api.services.functions import service as function_service
    from wavecore.api.services.profiles import _common as profile_common

    def _clear() -> None:
        profile_common._clear_in_memory_cache()
        function_service._clear_in_memory_cache()

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _reset_ownership() -> Generator[None, None, None]:
    _clear_ownership()
    yield
    _clear_ownership()


def _clear_ownership() -> None:
    with contextlib.suppress(ImportError):
        from wavecore.api.services.workbench import ownership

        ownership.clear()


def watch() -> Any:
    from wavecore.mcp.tools import watch as watch_tools

    return watch_tools


def stored_test_ids() -> set[str]:
    from wavecore.api.services.storage_paths import get_tests_storage_path

    root = get_tests_storage_path()
    if not root.exists():
        return set()
    return {path.name for path in root.iterdir() if path.is_dir()}


def simple_recipe(name: str = "Watch Smoke") -> str:
    return make_recipe(
        [{"block": "log", "settings": {"message": "hello from recipe"}}],
        name=name,
        description="Built through the MCP watch tool",
        tags=["mcp", "watch"],
    )


def minimal_watch_recipe(name: str = "Watch Build") -> str:
    """Four pre-order nodes (log, for-control, loop body log, trailing log)."""
    return make_recipe(
        [
            {"block": "log", "settings": {"message": "start"}},
            {"for": {"count": 3, "body": [{"block": "log", "settings": {"message": "tick"}}]}},
            {"block": "log", "settings": {"message": "done"}},
        ],
        name=name,
        variables={
            "attempts": {"type": "integer", "value": 3},
            "greeting": {"type": "string", "value": "hi"},
        },
    )


class TestBuildTestFromRecipe:
    async def test_successful_build_returns_the_handle_envelope(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        before = stored_test_ids()
        with patch.object(ownership, "_emit"):
            result = await watch().build_test_from_recipe(
                simple_recipe("Built Via Recipe"), session_id="s1"
            )

        assert set(result.keys()) == {
            "built",
            "test_id",
            "name",
            "version",
            "warnings",
            "repairs",
            "action_items",
        }
        assert result["built"] is True
        assert result["name"] == "Built Via Recipe"
        assert result["version"] == "1.0.0"
        assert result["warnings"] == []
        assert result["action_items"] == []
        assert len(stored_test_ids()) == len(before) + 1
        assert ownership.get_holder() is None

    async def test_declare_empty_secret_builds_with_an_action_item(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="Watch Declare Empty",
            variables={"token": {"type": "string", "secret": True}},
        )
        with patch.object(ownership, "_emit"):
            result = await watch().build_test_from_recipe(recipe, session_id="s1")

        assert result["built"] is True
        assert result["action_items"] == [
            {
                "step": "variables.token",
                "code": "NO_VALUE_VARIABLE",
                "severity": "warning",
                "problem": "Secret variable 'token' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    async def test_reveal_pushes_a_frame_per_node_with_active_node_id(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        real_apply = ownership.apply_draft
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock) as broadcast_spy,
            patch.object(ownership, "apply_draft", side_effect=real_apply) as spy,
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Reveal Build"), session_id="s1"
            )

        assert result["built"] is True
        calls = spy.call_args_list
        assert len(calls) == 5
        assert [call.args[0] for call in calls] == ["s1"] * 5
        frames = [call.args[1] for call in calls]
        reveal_frames = frames[:4]
        assert [frame["active_node_id"] for frame in reveal_frames] == [
            "node-1",
            "node-2",
            "node-3",
            "node-4",
        ]
        for index, frame in enumerate(reveal_frames):
            ids = [node["id"] for node in frame["nodes"]]
            assert ids == ["node-1", "node-2", "node-3", "node-4"][: index + 1]
            # Mid-build the surface is an unsaved draft bound to no test.
            assert frame["test_id"] is None
            assert frame["test_name"] is None
            assert frame["dirty"] is True
        # The post-save frame binds the mirrored surface to the new test, clean.
        final = frames[4]
        assert final["test_id"] == result["test_id"]
        assert final["test_name"] == "Reveal Build"
        assert final["dirty"] is False
        assert final["active_node_id"] is None
        assert [node["id"] for node in final["nodes"]] == [
            "node-1",
            "node-2",
            "node-3",
            "node-4",
        ]
        # Every frame is broadcast live to draft-topic mirrors, not just
        # cached: a live watcher must see the reveal progress block by block.
        assert broadcast_spy.await_count == 5
        broadcast_active = [
            call.args[0]["active_node_id"] for call in broadcast_spy.await_args_list
        ]
        assert broadcast_active == ["node-1", "node-2", "node-3", "node-4", None]

    async def test_every_reveal_frame_carries_the_finished_bounds_and_the_saved_one_none(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock) as broadcast_spy,
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Framed Build"), session_id="s1"
            )

        assert result["built"] is True
        payloads = [call.args[0] for call in broadcast_spy.await_args_list]
        saved = test_service.get_test(result["test_id"])
        assert saved is not None
        nodes = saved["workflow"]["nodes"]
        left = min(node["position"]["x"] for node in nodes)
        top = min(node["position"]["y"] for node in nodes)
        right = max(node["position"]["x"] + node["width"] for node in nodes)
        lowest = max(node["position"]["y"] for node in nodes)
        bounds = payloads[0]["final_bounds"]
        # Every Block of the finished test lies inside the bounds the first frame carries.
        assert (bounds["x"], bounds["y"], bounds["x"] + bounds["width"]) == (left, top, right)
        assert bounds["y"] + bounds["height"] > lowest
        assert [payload["final_bounds"] for payload in payloads[:4]] == [bounds] * 4
        # The saved surface is no longer a build in progress.
        assert payloads[4]["final_bounds"] is None

    async def test_the_tabs_learn_the_new_holder_before_the_first_block(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.websocket import events

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        sent: list[str] = []

        async def send(topic: str, event: dict[str, Any]) -> None:
            # A real send hands the loop over while the frame is on its way.
            await asyncio.sleep(0)
            sent.append(event["event"])

        monkeypatch.setattr(events, "broadcast", send)
        result = await watch().build_test_from_recipe(
            simple_recipe("Ordered Build"), session_id="s1"
        )

        assert result["built"] is True
        assert sent.index("holder_changed") < sent.index("draft_snapshot"), sent

    async def test_name_conflict_builds_nothing(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        create_test_entity("Taken By Hand")
        before = stored_test_ids()
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "apply_draft") as spy,
        ):
            result = await watch().build_test_from_recipe(
                simple_recipe("Taken By Hand"), session_id="s1"
            )

        assert set(result.keys()) == {"built", "findings"}
        assert result["built"] is False
        finding = find_finding(result["findings"], "NAME_CONFLICT")
        assert finding["problem"] == "Test with name 'Taken By Hand' already exists"
        assert finding["fix"] == NAME_CONFLICT_FIX
        assert stored_test_ids() == before
        spy.assert_not_called()
        assert ownership.get_holder() is None

    async def test_compile_error_builds_nothing(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        before = stored_test_ids()
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "apply_draft") as spy,
        ):
            result = await watch().build_test_from_recipe(
                make_recipe([{"block": "no-such-block"}], name="Never Built"),
                session_id="s1",
            )

        assert set(result.keys()) == {"built", "findings"}
        assert result["built"] is False
        find_finding(result["findings"], "UNKNOWN_BLOCK")
        assert stored_test_ids() == before
        spy.assert_not_called()
        assert ownership.get_holder() is None

    async def test_missing_secret_file_builds_nothing(
        self, monkeypatch: Any, tmp_path: Path
    ) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        secrets_dir = tmp_path / "mcp-secrets"
        secrets_dir.mkdir()
        monkeypatch.setenv("WAVE_MCP_SECRETS_DIR", str(secrets_dir))
        before = stored_test_ids()
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="Watch Secret Missing",
            variables={"token": {"type": "string", "secret": True, "value_from_file": "absent"}},
        )
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "apply_draft") as spy,
        ):
            result = await watch().build_test_from_recipe(recipe, session_id="s1")

        assert set(result.keys()) == {"built", "findings"}
        assert result["built"] is False
        finding = find_finding(result["findings"], "SECRET_FILE_NOT_FOUND")
        assert finding["problem"] == (
            "The secret file 'absent' was not found in the configured secrets input directory."
        )
        assert stored_test_ids() == before
        spy.assert_not_called()
        assert ownership.get_holder() is None

    async def test_session_held_by_another_builds_nothing(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        before = stored_test_ids()
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "apply_draft") as spy,
        ):
            ownership.claim("u1", "User One", "person")
            # A dirty holder never auto-yields, so the claim still conflicts.
            ownership.set_holder_dirty("u1", True)
            result = await watch().build_test_from_recipe(
                simple_recipe("Watch While Held"), session_id="s1"
            )

        assert set(result.keys()) == {"built", "findings"}
        assert result["built"] is False
        assert result["findings"] == [
            {
                "step": "test",
                "code": "SESSION_HELD",
                "severity": "error",
                "problem": "The workbench session is already held",
                "fix": SESSION_HELD_FIX,
            }
        ]
        assert stored_test_ids() == before
        spy.assert_not_called()
        assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}

    async def test_takeover_mid_reveal_abandons_the_build(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        before = stored_test_ids()
        seen: list[int] = []

        def take_over_on_second(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
            seen.append(1)
            if len(seen) == 2:
                ownership.request_takeover("r1", "Ashley")
            return dict(frame)

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "apply_draft", side_effect=take_over_on_second) as spy,
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Watch Taken Over"), session_id="s1"
            )

        assert result == {"built": False, "released": "taken_over"}
        assert 1 <= len(spy.call_args_list) < 4
        assert stored_test_ids() == before
        holder = ownership.get_holder()
        if holder is not None:
            assert holder["id"] == "r1"

    async def test_the_pending_requester_holds_once_the_build_abandons(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        seen: list[int] = []
        real_apply = ownership.apply_draft

        def take_over_on_second(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
            seen.append(1)
            payload = real_apply(holder_id, frame)
            if len(seen) == 2:
                ownership.request_takeover("r1", "Ashley")
            return payload

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
            patch.object(ownership, "apply_draft", side_effect=take_over_on_second),
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Watch Pending Granted"), session_id="s1"
            )

        assert result == {"built": False, "released": "taken_over"}
        assert ownership.get_holder() == {"id": "r1", "label": "Ashley", "kind": "person"}
        assert ownership.get_ownership()["pending_takeover"] is None

    async def test_slot_force_taken_mid_reveal_reports_the_force_take(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        before = stored_test_ids()
        seen: list[int] = []
        real_apply = ownership.apply_draft

        def steal_on_second(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
            seen.append(1)
            payload = real_apply(holder_id, frame)
            if len(seen) == 2:
                ownership.force_takeover("r1", "Ashley")
            return payload

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
            patch.object(ownership, "apply_draft", side_effect=steal_on_second),
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Watch Slot Stolen"), session_id="s1"
            )

        assert result == {"built": False, "released": "force_taken"}
        assert stored_test_ids() == before
        assert ownership.get_holder() == {"id": "r1", "label": "Ashley", "kind": "person"}

    async def test_slot_lost_mid_reveal_reports_the_lost_slot(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        before = stored_test_ids()
        seen: list[int] = []
        real_apply = ownership.apply_draft

        def sweep_on_second(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
            seen.append(1)
            payload = real_apply(holder_id, frame)
            if len(seen) == 2:
                ownership._watchers = 1
                ownership._holder["last_heartbeat"] = 0.0
                ownership.sweep_stale(ownership.HOLDER_TIMEOUT_SECONDS + 1.0)
            return payload

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
            patch.object(ownership, "apply_draft", side_effect=sweep_on_second),
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Watch Slot Swept"), session_id="s1"
            )

        assert result == {"built": False, "released": "slot_lost"}
        assert stored_test_ids() == before
        assert ownership.get_holder() is None

    async def test_slot_taken_after_the_last_frame_saves_nothing(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        before = stored_test_ids()
        seen: list[int] = []
        real_apply = ownership.apply_draft

        def steal_on_last_frame(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
            seen.append(1)
            payload = real_apply(holder_id, frame)
            if len(seen) == 4:
                ownership.force_takeover("r1", "Ashley")
            return payload

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
            patch.object(ownership, "apply_draft", side_effect=steal_on_last_frame) as spy,
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Watch Stolen At Save"), session_id="s1"
            )

        assert result == {"built": False, "released": "force_taken"}
        assert stored_test_ids() == before
        assert len(spy.call_args_list) == 4

    async def test_takeover_requested_after_the_last_frame_still_saves(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        before = stored_test_ids()
        seen: list[int] = []
        real_apply = ownership.apply_draft

        def ask_on_last_frame(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
            seen.append(1)
            payload = real_apply(holder_id, frame)
            if len(seen) == 4:
                ownership.request_takeover("r1", "Ashley")
            return payload

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
            patch.object(ownership, "apply_draft", side_effect=ask_on_last_frame),
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Watch Asked At Save"), session_id="s1"
            )

        assert result["built"] is True
        assert len(stored_test_ids()) == len(before) + 1


class TestWatchCompilesWithoutTestDataRoots:
    """A watch build has no target test, so it compiles against no roots."""

    async def test_compile_receives_an_empty_root_list(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.core.recipes import compiler

        calls: list[dict[str, Any]] = []
        real = compiler.compile_recipe

        def recorder(text: str, **kwargs: Any) -> Any:
            calls.append(dict(kwargs))
            return real(text, **kwargs)

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        monkeypatch.setattr(watch(), "compile_recipe", recorder)
        with patch.object(ownership, "_emit"):
            result = await watch().build_test_from_recipe(
                simple_recipe("Watch Roots"), session_id="s1"
            )

        assert result["built"] is True
        assert calls == [
            {
                "testdata_dirs": [],
                "placement_defaults": {"ssh-session-open": {"host_key_verification": "disabled"}},
            }
        ]


def set_default_block_action(action: str) -> None:
    """Save the host key action Settings stamps into newly placed SSH Session Open blocks."""
    from wavecore.core.ssh import trusted_hosts

    trusted_hosts.save_policy({"lock_trusted_hosts": False, "default_block_action": action})


async def saved_host_key_actions(monkeypatch: Any, name: str) -> list[Any]:
    """Watch-build one SSH Session Open step that sets no action; the stored actions."""
    from wavecore.api.services.tests import service as test_service
    from wavecore.api.services.workbench import ownership

    recipe = make_recipe(
        [{"block": "ssh-session-open", "settings": {"host": "node-1", "username": "wave"}}],
        name=name,
    )
    monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
    with patch.object(ownership, "_emit"):
        result = await watch().build_test_from_recipe(recipe, session_id="s1")

    assert result["built"] is True
    stored = test_service.get_test(result["test_id"])
    assert stored is not None
    return [
        node["data"]["config"]["values"].get("host_key_verification")
        for node in stored["workflow"]["nodes"]
        if node["data"].get("elementType") == "ssh-session-open"
    ]


class TestWatchBuildPlacesTheDefaultHostKeyAction:
    """A watch build places SSH Session Open blocks like any other recipe (REQ-4.5.14)."""

    async def test_the_compile_receives_the_stored_default(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.core.recipes import compiler

        set_default_block_action("strict")
        calls: list[dict[str, Any]] = []
        real = compiler.compile_recipe

        def recorder(text: str, **kwargs: Any) -> Any:
            calls.append(dict(kwargs))
            return real(text, **kwargs)

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        monkeypatch.setattr(watch(), "compile_recipe", recorder)
        with patch.object(ownership, "_emit"):
            await watch().build_test_from_recipe(simple_recipe("Watch Defaults"), session_id="s1")

        assert calls == [
            {
                "testdata_dirs": [],
                "placement_defaults": {"ssh-session-open": {"host_key_verification": "strict"}},
            }
        ]

    async def test_a_new_block_is_saved_with_the_stored_default(self, monkeypatch: Any) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.workbench import ownership

        set_default_block_action("strict")
        recipe = make_recipe(
            [{"block": "ssh-session-open", "settings": {"host": "node-1", "username": "wave"}}],
            name="Watch SSH Default",
        )
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        with patch.object(ownership, "_emit"):
            result = await watch().build_test_from_recipe(recipe, session_id="s1")

        assert result["built"] is True
        stored = test_service.get_test(result["test_id"])
        assert stored is not None
        values = [
            node["data"]["config"]["values"]
            for node in stored["workflow"]["nodes"]
            if node["data"].get("elementType") == "ssh-session-open"
        ]
        assert [value.get("host_key_verification") for value in values] == ["strict"]

    async def test_a_new_block_is_saved_with_disabled_when_settings_were_never_changed(
        self, monkeypatch: Any
    ) -> None:
        assert await saved_host_key_actions(monkeypatch, "Watch SSH Unchanged") == ["disabled"]

    async def test_a_new_block_is_saved_with_a_default_set_in_the_config_file(
        self, monkeypatch: Any, load_config: Callable[..., Any]
    ) -> None:
        policy = {"lock_trusted_hosts": False, "default_block_action": "strict"}
        load_config({"network": {"ssh_hosts": policy}})

        assert await saved_host_key_actions(monkeypatch, "Watch SSH Config File") == ["strict"]

    async def test_the_readback_returns_the_stored_action(self, monkeypatch: Any) -> None:
        from wavecore.mcp.tools import author

        await saved_host_key_actions(monkeypatch, "Watch SSH Readback")
        set_default_block_action("strict")

        recipe = yaml.safe_load(author.get_test_recipe("Watch SSH Readback")["recipe"])

        assert recipe["flow"][0]["settings"]["host_key_verification"] == "disabled"


async def watch_built_values(monkeypatch: Any, recipe: str, element_type: str) -> list[Any]:
    """Watch-build a recipe; the stored values of every Block of one element type."""
    from wavecore.api.services.tests import service as test_service
    from wavecore.api.services.workbench import ownership

    monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
    with patch.object(ownership, "_emit"):
        result = await watch().build_test_from_recipe(recipe, session_id="s1")

    assert result["built"] is True, result["findings"]
    stored = test_service.get_test(result["test_id"])
    assert stored is not None
    return [
        node["data"]["config"]["values"]
        for node in stored["workflow"]["nodes"]
        if node["data"].get("elementType") == element_type
    ]


class TestWatchBuildWritesCreationValues:
    """A watch build creates its Blocks like any recipe compile: every choice-list and
    true / false value is written, the SSH stamp on top (FIELD-8, REQ-4.5.14)."""

    async def test_a_new_block_holds_every_creation_value(self, monkeypatch: Any) -> None:
        set_default_block_action("strict")
        recipe = make_recipe(
            [{"block": "ssh-session-open", "settings": {"host": "node-1", "username": "wave"}}],
            name="Watch Creation Values",
        )

        assert await watch_built_values(monkeypatch, recipe, "ssh-session-open") == [
            {
                "host": "node-1",
                "username": "wave",
                **SSH_OPEN_CREATION_VALUES,
                "host_key_verification": "strict",
            }
        ]

    async def test_a_function_block_holds_its_choice_and_true_false_inputs(
        self, monkeypatch: Any
    ) -> None:
        inputs = [
            {
                "name": "level",
                "type": "string",
                "required": True,
                "enumValues": ["low", "high"],
                "default": "low",
            },
            {"name": "strict", "type": "boolean", "required": True, "default": True},
        ]
        recipe = make_recipe(
            [{"function": "probe"}],
            name="Watch Function Inputs",
            functions=[{"name": "probe", "inputs": inputs, "outputs": [], "flow": [LOG_STEP]}],
        )

        assert await watch_built_values(monkeypatch, recipe, "function") == [
            {"level": "low", "strict": True}
        ]


AMEND_ANSWER_KEYS = {"amended", "test_id", "name", "version", "warnings", "repairs", "action_items"}


def log_step(label: str, message: str | None = None) -> dict[str, Any]:
    return {"block": "log", "label": label, "settings": {"message": message or label.lower()}}


def created_test(recipe: str) -> str:
    from wavecore.mcp.tools import author

    created = author.create_test_from_recipe(recipe)
    assert created["created"] is True, created
    return str(created["test_id"])


def stored_test(test_id: str) -> dict[str, Any]:
    from wavecore.api.services.tests import service as test_service

    stored = test_service.get_test(test_id)
    assert stored is not None
    return stored


def saved_versions(test_id: str) -> list[str]:
    from wavecore.api.services.storage_paths import get_tests_storage_path

    versions_file = get_tests_storage_path() / test_id / "versions.yaml"
    return [entry["version"] for entry in yaml.safe_load(versions_file.read_text())]


def labels_of(payload: dict[str, Any]) -> list[str]:
    return [node["data"]["label"] for node in payload["nodes"]]


def label_of(payload: dict[str, Any], node_id: str) -> str:
    return next(node["data"]["label"] for node in payload["nodes"] if node["id"] == node_id)


def recipe_of(flow: list[Any], name: str, **parts: Any) -> str:
    return make_recipe(flow, name=name, **parts)


async def amend_live(
    monkeypatch: Any, test_ref: str, recipe: str, session_id: str | None = "s1"
) -> dict[str, Any]:
    monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
    monkeypatch.setattr(watch(), "ROOM_STEP_DELAY_S", 0.0)
    result: dict[str, Any] = await watch().amend_test_live_from_recipe(
        test_ref, recipe, session_id=session_id
    )
    return result


async def streamed(
    monkeypatch: Any, test_ref: str, recipe: str
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """A watched change's answer and every frame it broadcast, in order."""
    from wavecore.api.services.workbench import ownership

    with (
        patch.object(ownership, "_emit"),
        patch.object(ownership, "broadcast_draft", new_callable=AsyncMock) as broadcast,
    ):
        result = await amend_live(monkeypatch, test_ref, recipe)
    return result, [call.args[0] for call in broadcast.await_args_list]


@pytest.fixture
def ws_manager() -> Generator[Any, None, None]:
    """A live manager, so the slot can tell which browser tabs are still connected."""
    from wavecore.api.app import app
    from wavecore.api.websocket import WebSocketManager, session_registry

    original = getattr(app.state, "ws_manager", None)
    manager = WebSocketManager()
    app.state.ws_manager = manager
    yield manager
    app.state.ws_manager = original
    session_registry.clear_sessions()


def _socket() -> AsyncMock:
    from unittest.mock import MagicMock

    from fastapi import WebSocket

    socket = AsyncMock(spec=WebSocket)
    socket.accept = AsyncMock()
    socket.send_json = AsyncMock()
    socket.__len__ = MagicMock(return_value=1)
    return socket


async def open_tab(manager: Any, holder_id: str) -> str:
    conn: str = await manager.connect(_socket())
    await manager.handle_message(conn, json.dumps({"type": "identify", "holderId": holder_id}))
    return conn


ALPHA_CHARLIE = [log_step("Alpha"), log_step("Charlie")]
REVISED_FLOW = [log_step("Inserted"), log_step("Alpha", "changed"), log_step("Charlie")]
# It compiles, but the save refuses it: its timeout reads a variable nothing declares.
REFUSED_STEP = {
    "block": "http-client",
    "settings": {"url": "http://shop.local", "method": "GET", "timeout": {"expr": "nope * 2"}},
}
SAVED_MEANWHILE = {
    "step": "test",
    "code": "STALE_RECIPE_VERSION",
    "severity": "error",
    "problem": "The test was saved elsewhere while the change played",
    "fix": "Read the test back again and re-apply your changes",
}
DELETED_MEANWHILE = {
    "step": "test",
    "code": "TARGET_NOT_FOUND",
    "severity": "error",
    "problem": "The test was deleted before the change was saved",
    "fix": "If the test is still wanted, create it again from the recipe",
}
SESSION_HELD_HERE = {
    "step": "test",
    "code": "SESSION_HELD",
    "severity": "error",
    "problem": "This session already holds the workbench session for a run or another "
    "watched build or change",
    "fix": "Wait until it ends, then retry",
}


class TestAmendTestLiveFromRecipe:
    """The watched change of a saved test: checked up front, played through the live session,
    saved once, and answered like the fast amend."""

    async def test_an_uninterrupted_change_saves_once_and_answers_like_the_fast_amend(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Target"))

        with patch.object(ownership, "_emit"):
            result = await amend_live(
                monkeypatch, "Live Target", recipe_of(REVISED_FLOW, "Live Target")
            )

        assert set(result) == AMEND_ANSWER_KEYS
        assert result["amended"] is True
        assert result["test_id"] == test_id
        assert result["name"] == "Live Target"
        assert result["version"] == "1.1.0"
        assert result["warnings"] == []
        assert saved_versions(test_id) == ["1.0.0", "1.1.0"]
        assert labels_of(stored_test(test_id)["workflow"]) == ["Inserted", "Alpha", "Charlie"]
        assert ownership.get_holder() is None

    async def test_the_fast_and_the_watched_change_save_the_same_test(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp.tools import author

        functions = [{"name": "probe", "inputs": [], "outputs": [], "flow": [LOG_STEP]}]
        variables = {"attempts": {"type": "integer", "value": 3}}
        before = [
            log_step("Alpha"),
            {"for": {"count": 2, "body": [log_step("Tick"), {"break": {}}]}},
            {"function": "probe"},
            log_step("Charlie"),
        ]
        after = [
            log_step("Inserted"),
            log_step("Alpha", "changed"),
            {"for": {"count": 3, "body": [log_step("Tick"), {"break": {}}]}},
            {"function": "probe"},
        ]
        stored = {"variables": variables, "functions": functions}
        fast_id = created_test(recipe_of(before, "Fast Twin", **stored))
        live_id = created_test(recipe_of(before, "Live Twin", **stored))
        changed = {"attempts": {"type": "integer", "value": 5}}

        fast = author.amend_test_from_recipe(
            "Fast Twin", recipe_of(after, "Fast Twin", variables=changed, functions=functions)
        )
        with patch.object(ownership, "_emit"):
            live = await amend_live(
                monkeypatch,
                "Live Twin",
                recipe_of(after, "Live Twin", variables=changed, functions=functions),
            )

        assert fast["amended"] is True and live["amended"] is True
        fast_test, live_test = stored_test(fast_id), stored_test(live_id)
        assert live_test["workflow"] == fast_test["workflow"]
        assert live_test["variables"] == fast_test["variables"]
        assert live["version"] == fast["version"]

    async def test_the_watched_storyboard_saves_the_layout_of_the_fast_one(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp.tools import author

        seed_profiles()
        fast_id = created_test(step_recipe(1, "Fast Story"))
        live_id = created_test(step_recipe(1, "Live Story"))
        for step in (2, 3):
            fast = author.amend_test_from_recipe("Fast Story", step_recipe(step, "Fast Story"))
            with patch.object(ownership, "_emit"):
                live = await amend_live(monkeypatch, "Live Story", step_recipe(step, "Live Story"))

            assert fast["amended"] is True and live["amended"] is True
            fast_workflow = stored_test(fast_id)["workflow"]
            live_workflow = stored_test(live_id)["workflow"]
            assert positions_by_label(live_workflow) == positions_by_label(fast_workflow)
            assert positions_by_label(live_workflow) == STEPS[step], step
            assert flow_order_findings(live_workflow) == [], step

    async def test_step_one_holds_every_kept_block_at_its_final_place_before_the_first_new_block(
        self, monkeypatch: Any
    ) -> None:
        seed_profiles()
        created_test(step_recipe(1, "Story Frames"))

        result, payloads = await streamed(
            monkeypatch, "Story Frames", step_recipe(2, "Story Frames")
        )

        assert result["amended"] is True
        step_one, *_turns = payloads
        kept = positions_by_label(step_one)
        # Step one shows only the Blocks that stay, each already where it ends.
        assert kept == {label: STEPS[2][label] for label in STEPS[1]}

    async def test_a_person_with_unsaved_work_refuses_it_and_nothing_is_written(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Held"))
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "apply_draft") as frames,
        ):
            ownership.claim("u1", "User One", "person")
            ownership.set_holder_dirty("u1", True)
            result = await amend_live(
                monkeypatch, "Live Held", recipe_of(REVISED_FLOW, "Live Held")
            )

        assert result == {
            "amended": False,
            "findings": [
                {
                    "step": "test",
                    "code": "SESSION_HELD",
                    "severity": "error",
                    "problem": "The workbench session is already held",
                    "fix": SESSION_HELD_FIX,
                }
            ],
        }
        frames.assert_not_called()
        assert stored_test(test_id)["version"] == "1.0.0"
        assert ownership.get_holder() == {"id": "u1", "label": "User One", "kind": "person"}

    async def test_a_name_another_test_holds_is_answered_before_any_claim(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        created_test(recipe_of(ALPHA_CHARLIE, "Live Renamed"))
        create_test_entity("Live Occupied")
        with patch.object(ownership, "claim") as claim:
            result = await amend_live(
                monkeypatch, "Live Renamed", recipe_of(REVISED_FLOW, "Live Occupied")
            )

        assert result["amended"] is False
        finding = find_finding(result["findings"], "NAME_CONFLICT")
        assert finding["problem"] == "Test with name 'Live Occupied' already exists"
        claim.assert_not_called()

    async def test_a_superseded_readback_is_answered_before_any_claim(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp.tools import author

        created_test(recipe_of(ALPHA_CHARLIE, "Live Stale"))
        readback = author.get_test_recipe("Live Stale")["recipe"]
        author.amend_test_from_recipe("Live Stale", recipe_of(REVISED_FLOW, "Live Stale"))
        with patch.object(ownership, "claim") as claim:
            result = await amend_live(monkeypatch, "Live Stale", readback)

        assert result["amended"] is False
        assert find_finding(result["findings"], "STALE_RECIPE_VERSION")["problem"] == (
            "This recipe was read back at version 1.0.0 but the test is now at 1.1.0"
        )
        claim.assert_not_called()

    async def test_a_recipe_the_save_checks_refuse_is_answered_before_any_claim(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Refused"))
        refused = REFUSED_STEP
        with patch.object(ownership, "claim") as claim:
            result = await amend_live(
                monkeypatch, "Live Refused", recipe_of([log_step("Alpha"), refused], "Live Refused")
            )

        assert result["amended"] is False
        assert find_finding(result["findings"], "UNDECLARED_VARIABLE")["step"] == "flow[1]"
        claim.assert_not_called()
        assert stored_test(test_id)["version"] == "1.0.0"

    async def test_a_refusal_only_the_save_makes_is_answered_and_the_change_stays_unsaved(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.tests.service import SaveValidationError

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Save Refused"))
        refusal = {"code": "SAVE_REFUSED", "message": "The save refused it", "severity": "error"}

        def refuse(*_args: Any, **_kwargs: Any) -> Any:
            raise SaveValidationError([refusal])

        monkeypatch.setattr(test_service, "update_test", refuse)
        result, payloads = await streamed(
            monkeypatch, "Live Save Refused", recipe_of(REVISED_FLOW, "Live Save Refused")
        )

        assert result == {
            "amended": False,
            "findings": [
                {
                    "step": "test",
                    "code": "SAVE_REFUSED",
                    "severity": "error",
                    "problem": "The save refused it",
                    "fix": None,
                }
            ],
        }
        assert stored_test(test_id)["version"] == "1.0.0"
        # The tab keeps the streamed change as unsaved work of the test.
        assert payloads[-1]["dirty"] is True
        assert payloads[-1]["test_id"] == test_id

    async def test_a_name_taken_while_the_change_played_is_answered_as_a_finding(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.tests import service as test_service

        created_test(recipe_of(ALPHA_CHARLIE, "Live Name Race"))

        def taken(*_args: Any, **_kwargs: Any) -> Any:
            raise ConflictException("Test with name 'Live Name Race' already exists")

        monkeypatch.setattr(test_service, "update_test", taken)
        result, _ = await streamed(
            monkeypatch, "Live Name Race", recipe_of(REVISED_FLOW, "Live Name Race")
        )

        assert result["amended"] is False
        assert find_finding(result["findings"], "NAME_CONFLICT")["fix"] == NAME_CONFLICT_FIX

    @pytest.mark.parametrize(
        ("save", "kept"),
        [
            ("update", ("1.1.0", "Live Raced", "Saved elsewhere", 1)),
            ("rename", ("1.0.0", "Live Raced v2", "", 1)),
            ("variables", ("1.0.0", "Live Raced", "", 7)),
        ],
        ids=["a new version", "a rename", "a variables-only edit"],
    )
    async def test_a_test_saved_elsewhere_while_the_change_played_is_not_overwritten(
        self, monkeypatch: Any, save: str, kept: tuple[Any, ...]
    ) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.workbench import ownership

        variables = {"v": {"type": "integer", "value": 1}}
        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Raced", variables=variables))
        real_broadcast = ownership.broadcast_draft
        saved_elsewhere: list[int] = []

        async def save_elsewhere_on_first(payload: dict[str, Any]) -> None:
            await real_broadcast(payload)
            if saved_elsewhere:
                return
            saved_elsewhere.append(1)
            if save == "update":
                test_service.update_test(test_id, {"description": "Saved elsewhere"})
            elif save == "rename":
                test_service.update_test_metadata(test_id, {"name": "Live Raced v2"})
            else:
                test_service.update_test_variables(test_id, {"v": {"type": "integer", "value": 7}})

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", side_effect=save_elsewhere_on_first),
        ):
            result = await amend_live(
                monkeypatch,
                test_id,
                recipe_of(REVISED_FLOW, "Live Raced", variables=variables),
            )

        assert result == {"amended": False, "findings": [SAVED_MEANWHILE]}
        stored = stored_test(test_id)
        assert (
            stored["version"],
            stored["name"],
            stored["description"],
            stored["variables"]["v"]["value"],
        ) == kept
        assert labels_of(stored["workflow"]) == ["Alpha", "Charlie"]

    async def test_a_test_deleted_while_the_change_played_is_answered_as_not_found(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Deleted"))
        real_broadcast = ownership.broadcast_draft
        payloads: list[dict[str, Any]] = []

        async def delete_on_first(payload: dict[str, Any]) -> None:
            await real_broadcast(payload)
            if not payloads:
                test_service.delete_test(test_id)
            payloads.append(payload)

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", side_effect=delete_on_first),
        ):
            result = await amend_live(
                monkeypatch, "Live Deleted", recipe_of(REVISED_FLOW, "Live Deleted")
            )

        assert result == {"amended": False, "findings": [DELETED_MEANWHILE]}
        assert payloads[-1]["dirty"] is True
        assert test_service.get_test(test_id) is None

    async def test_a_forced_take_over_mid_change_saves_nothing(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Stolen"))
        seen: list[int] = []
        real_apply = ownership.apply_draft

        def steal_on_second(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
            seen.append(1)
            payload = real_apply(holder_id, frame)
            if len(seen) == 2:
                ownership.force_takeover("r1", "Ashley")
            return payload

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
            patch.object(ownership, "apply_draft", side_effect=steal_on_second),
        ):
            result = await amend_live(
                monkeypatch, "Live Stolen", recipe_of(REVISED_FLOW, "Live Stolen")
            )

        assert result == {"amended": False, "released": "force_taken"}
        assert stored_test(test_id)["version"] == "1.0.0"
        assert ownership.get_holder() == {"id": "r1", "label": "Ashley", "kind": "person"}
        # The taker continues the half-done change as unsaved work of the test.
        shared = ownership.get_shared_draft()
        assert shared is not None
        assert (shared["test_id"], shared["dirty"]) == (test_id, True)

    async def test_a_take_over_request_mid_change_hands_the_slot_over_unsaved(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Asked"))
        seen: list[int] = []
        real_apply = ownership.apply_draft

        def ask_on_first(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
            seen.append(1)
            payload = real_apply(holder_id, frame)
            if len(seen) == 1:
                ownership.request_takeover("r1", "Ashley")
            return payload

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
            patch.object(ownership, "apply_draft", side_effect=ask_on_first),
        ):
            result = await amend_live(
                monkeypatch, "Live Asked", recipe_of(REVISED_FLOW, "Live Asked")
            )

        assert result == {"amended": False, "released": "taken_over"}
        assert stored_test(test_id)["version"] == "1.0.0"
        assert ownership.get_holder() == {"id": "r1", "label": "Ashley", "kind": "person"}

    async def test_the_tabs_learn_the_new_holder_before_the_first_frame(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.websocket import events

        created_test(recipe_of(ALPHA_CHARLIE, "Live Ordered"))
        sent: list[str] = []

        async def send(topic: str, event: dict[str, Any]) -> None:
            await asyncio.sleep(0)
            sent.append(event["event"])

        monkeypatch.setattr(events, "broadcast", send)
        result = await amend_live(
            monkeypatch, "Live Ordered", recipe_of(REVISED_FLOW, "Live Ordered")
        )

        assert result["amended"] is True
        assert sent.index("holder_changed") < sent.index("draft_snapshot"), sent

    async def test_the_frames_play_step_one_then_one_turn_per_block_then_the_saved_test(
        self, monkeypatch: Any
    ) -> None:
        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Frames"))
        stored = stored_test(test_id)

        result, payloads = await streamed(
            monkeypatch, "Live Frames", recipe_of(REVISED_FLOW, "Live Frames")
        )

        assert result["amended"] is True
        step_one, *turns, last = payloads
        assert labels_of(step_one) == ["Alpha", "Charlie"]
        assert [node["id"] for node in step_one["nodes"]] == [
            node["id"] for node in stored["workflow"]["nodes"]
        ]
        assert step_one["active_node_id"] is None
        assert [label_of(turn, turn["active_node_id"]) for turn in turns] == ["Inserted", "Alpha"]
        for frame in (step_one, *turns):
            assert frame["test_id"] == test_id
            assert frame["test_name"] == "Live Frames"
            assert frame["dirty"] is True
            assert frame["watch_kind"] == "change"
            assert frame["final_bounds"] == step_one["final_bounds"] is not None
        saved = stored_test(test_id)
        assert last["nodes"] == saved["workflow"]["nodes"]
        assert last["edges"] == saved["workflow"]["edges"]
        assert last["variables"] == saved["variables"]
        assert (last["test_id"], last["test_name"], last["dirty"]) == (
            test_id,
            "Live Frames",
            False,
        )
        assert (last["active_node_id"], last["final_bounds"], last["watch_kind"]) == (
            None,
            None,
            None,
        )

    async def test_the_change_pauses_longer_after_step_one_then_at_the_builds_pace(
        self, monkeypatch: Any
    ) -> None:
        # The canvas glides the moving Blocks for 300 ms; it settles before the first turn.
        from wavecore.api.services.workbench import ownership

        created_test(recipe_of(ALPHA_CHARLIE, "Live Paced"))
        delays: list[float] = []
        real_sleep = asyncio.sleep

        async def pace(delay: float) -> None:
            delays.append(delay)
            await real_sleep(0)

        monkeypatch.setattr(asyncio, "sleep", pace)
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
        ):
            result = await watch().amend_test_live_from_recipe(
                "Live Paced", recipe_of(REVISED_FLOW, "Live Paced"), session_id="s1"
            )

        assert result["amended"] is True
        assert [delay for delay in delays if delay] == [0.6, 0.4, 0.4]

    async def test_a_change_of_a_variable_value_only_plays_step_one_and_saves_once(
        self, monkeypatch: Any
    ) -> None:
        test_id = created_test(
            recipe_of(
                ALPHA_CHARLIE, "Live Variable", variables={"v": {"type": "integer", "value": 1}}
            )
        )

        result, payloads = await streamed(
            monkeypatch,
            "Live Variable",
            recipe_of(
                ALPHA_CHARLIE, "Live Variable", variables={"v": {"type": "integer", "value": 2}}
            ),
        )

        assert result["amended"] is True
        step_one, last = payloads
        assert step_one["variables"] == {"v": {"type": "integer", "value": 2}}
        assert step_one["active_node_id"] is None
        assert last["dirty"] is False
        assert saved_versions(test_id) == ["1.0.0", "1.1.0"]

    async def test_a_watcher_joining_mid_change_is_shown_the_change_framed(
        self, monkeypatch: Any, ws_manager: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Late Joiner"))
        joiner = _socket()
        replayed: list[dict[str, Any]] = []
        real_broadcast = ownership.broadcast_draft

        async def join_on_second(payload: dict[str, Any]) -> None:
            await real_broadcast(payload)
            if len(replayed) == 0 and payload["active_node_id"] is not None:
                conn = await ws_manager.connect(joiner)
                await ws_manager.handle_message(
                    conn, json.dumps({"type": "subscribe", "topic": "workbench:draft"})
                )
                replayed.extend(
                    sent.args[0]["payload"]
                    for sent in joiner.send_json.call_args_list
                    if sent.args and isinstance(sent.args[0].get("payload"), dict)
                )

        with patch.object(ownership, "broadcast_draft", side_effect=join_on_second):
            result = await amend_live(
                monkeypatch, "Live Late Joiner", recipe_of(REVISED_FLOW, "Live Late Joiner")
            )

        assert result["amended"] is True
        (seed,) = [payload for payload in replayed if payload["event"] == "draft_snapshot"]
        assert seed["watch_kind"] == "change"
        assert seed["final_bounds"] is not None
        assert seed["test_id"] == test_id
        assert label_of(seed, seed["active_node_id"]) == "Inserted"

    async def test_what_a_watching_person_does_mid_change_is_neither_kept_nor_saved(
        self, monkeypatch: Any, ws_manager: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Typing"))
        tab = await open_tab(ws_manager, "h1")
        ownership.claim("h1", "Holder One")
        typed = {"nodes": [{"id": "typed"}], "edges": [], "variables": {}, "dirty": True}
        real_broadcast = ownership.broadcast_draft
        after_typing: list[dict[str, Any] | None] = []

        async def type_on_first(payload: dict[str, Any]) -> None:
            await real_broadcast(payload)
            if not after_typing:
                await ws_manager.handle_message(
                    tab,
                    json.dumps({"type": "draft_update", "holderId": "h1", "snapshot": typed}),
                )
                await ws_manager.handle_message(
                    tab, json.dumps({"type": "draft_state", "holderId": "h1", "dirty": True})
                )
                after_typing.append(ownership.get_shared_draft())

        with patch.object(ownership, "broadcast_draft", side_effect=type_on_first):
            result = await amend_live(
                monkeypatch, "Live Typing", recipe_of(REVISED_FLOW, "Live Typing")
            )

        assert result["amended"] is True
        (shared,) = after_typing
        assert shared is not None
        assert shared["from_holder_id"] == "s1"
        assert labels_of(stored_test(test_id)["workflow"]) == ["Inserted", "Alpha", "Charlie"]
        # The tab that gave way holds again, with nothing of its own marked unsaved.
        assert ownership.get_holder() == {"id": "h1", "label": "Holder One", "kind": "person"}
        assert ownership._holder["dirty"] is False

    async def test_the_tab_that_gave_way_holds_the_saved_test_after_the_change(
        self, monkeypatch: Any, ws_manager: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Hand Back"))
        await open_tab(ws_manager, "h1")
        ownership.claim("h1", "Holder One")

        result = await amend_live(
            monkeypatch, "Live Hand Back", recipe_of(REVISED_FLOW, "Live Hand Back")
        )

        assert result["amended"] is True
        assert ownership.get_holder() == {"id": "h1", "label": "Holder One", "kind": "person"}
        shared = ownership.get_shared_draft()
        assert shared is not None
        assert (shared["test_id"], shared["dirty"], shared["watch_kind"]) == (test_id, False, None)

    async def test_the_slot_frees_when_the_tab_that_gave_way_closes_mid_change(
        self, monkeypatch: Any, ws_manager: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        created_test(recipe_of(ALPHA_CHARLIE, "Live Tab Closed"))
        tab = await open_tab(ws_manager, "h1")
        await open_tab(ws_manager, "w1")
        ownership.claim("h1", "Holder One")
        real_broadcast = ownership.broadcast_draft
        closed: list[int] = []

        async def close_on_first(payload: dict[str, Any]) -> None:
            await real_broadcast(payload)
            if not closed:
                ws_manager.disconnect(tab)
                closed.append(1)

        with patch.object(ownership, "broadcast_draft", side_effect=close_on_first):
            result = await amend_live(
                monkeypatch, "Live Tab Closed", recipe_of(REVISED_FLOW, "Live Tab Closed")
            )

        assert result["amended"] is True
        assert ownership.get_holder() is None
        ownership.claim("w1", "Watcher One")
        assert ownership.get_holder() == {"id": "w1", "label": "Watcher One", "kind": "person"}

    async def test_a_refused_save_hands_back_unsaved_work_no_assistant_streams_over(
        self, monkeypatch: Any, ws_manager: Any
    ) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.tests.service import SaveValidationError
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "Live Handed Unsaved"))
        await open_tab(ws_manager, "h1")
        ownership.claim("h1", "Holder One")
        refusal = {"code": "SAVE_REFUSED", "message": "The save refused it", "severity": "error"}

        def refuse(*_args: Any, **_kwargs: Any) -> Any:
            raise SaveValidationError([refusal])

        monkeypatch.setattr(test_service, "update_test", refuse)
        recipe = recipe_of(REVISED_FLOW, "Live Handed Unsaved")
        first = await amend_live(monkeypatch, test_id, recipe)
        streamed_work = ownership.get_shared_draft()
        second = await amend_live(monkeypatch, test_id, recipe, session_id="s2")

        assert first["amended"] is False
        assert ownership.get_holder() == {"id": "h1", "label": "Holder One", "kind": "person"}
        assert second == {
            "amended": False,
            "findings": [
                {
                    "step": "test",
                    "code": "SESSION_HELD",
                    "severity": "error",
                    "problem": "The workbench session is already held",
                    "fix": SESSION_HELD_FIX,
                }
            ],
        }
        assert streamed_work is not None and streamed_work["dirty"] is True
        assert ownership.get_shared_draft() == streamed_work


RUN_IN_FLIGHT = {
    "session_id": "exec-1",
    "test_id": "test-1",
    "test_name": "Nightly Smoke",
    "environment_id": "env-1",
    "environment_name": "Staging",
    "status": "running",
}


class TestAStreamOfASessionThatHoldsTheSlotAlready:
    """A session holding the slot for its own run or stream is refused another stream, which
    would otherwise end that holding early."""

    @pytest.mark.parametrize("kind", ["build", "change"])
    async def test_a_stream_while_its_own_run_holds_the_slot_is_refused(
        self, monkeypatch: Any, kind: str
    ) -> None:
        from wavecore.api.services.workbench import ownership

        name = f"Held By Its Run {kind}"
        test_id = created_test(recipe_of(ALPHA_CHARLIE, name)) if kind == "change" else None
        revised = recipe_of(REVISED_FLOW, name if test_id else f"{name} New")
        stream = change_of(name, revised) if test_id else build_of(revised)
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        monkeypatch.setattr(watch(), "ROOM_STEP_DELAY_S", 0.0)
        before = stored_test_ids()
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "apply_draft") as frames,
        ):
            ownership.claim("s1", "claude-code (MCP)", "mcp")
            ownership.set_run_state(RUN_IN_FLIGHT)
            result = await stream()

        assert result == {result_key(result): False, "findings": [SESSION_HELD_HERE]}
        frames.assert_not_called()
        assert ownership.get_holder() == {"id": "s1", "label": "claude-code (MCP)", "kind": "mcp"}
        assert ownership.get_run_state() == RUN_IN_FLIGHT
        assert stored_test_ids() == before
        if test_id:
            assert stored_test(test_id)["version"] == "1.0.0"

    async def test_a_second_stream_of_the_session_is_refused_and_the_first_plays_on(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        test_id = created_test(recipe_of(ALPHA_CHARLIE, "First Stream"))
        real_broadcast = ownership.broadcast_draft
        second: list[dict[str, Any]] = []

        async def start_a_second_on_the_first_frame(payload: dict[str, Any]) -> None:
            await real_broadcast(payload)
            if not second:
                second.append({})
                second[0] = await build_of(simple_recipe("Second Stream"))()

        with (
            patch.object(ownership, "_emit"),
            patch.object(
                ownership, "broadcast_draft", side_effect=start_a_second_on_the_first_frame
            ),
        ):
            first = await amend_live(
                monkeypatch, "First Stream", recipe_of(REVISED_FLOW, "First Stream")
            )

        assert second == [{"built": False, "findings": [SESSION_HELD_HERE]}]
        assert first["amended"] is True
        assert labels_of(stored_test(test_id)["workflow"]) == ["Inserted", "Alpha", "Charlie"]
        assert stored_test_ids() == {test_id}


class TestAStreamThatEndsUnexpectedly:
    """An assistant that drops mid-stream, or a stream that breaks, is an unexpected loss of
    the holder: the tab that gave way is not handed the slot in silence."""

    @pytest.mark.parametrize("ending", [asyncio.CancelledError, RuntimeError])
    @pytest.mark.parametrize("kind", ["build", "change"])
    async def test_the_slot_frees_with_no_hand_back(
        self, monkeypatch: Any, ws_manager: Any, kind: str, ending: type[BaseException]
    ) -> None:
        from unittest.mock import call

        from wavecore.api.services.workbench import ownership

        name = f"Ended {kind} {ending.__name__}"
        test_id = created_test(recipe_of(ALPHA_CHARLIE, name)) if kind == "change" else None
        revised = recipe_of(REVISED_FLOW, name if test_id else f"{name} New")
        stream = change_of(name, revised) if test_id else build_of(revised)
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        monkeypatch.setattr(watch(), "ROOM_STEP_DELAY_S", 0.0)
        await open_tab(ws_manager, "h1")
        seen: list[int] = []

        async def end_on_second(_payload: dict[str, Any]) -> None:
            seen.append(1)
            if len(seen) == 2:
                raise ending

        with (
            patch.object(ownership, "_emit") as emitted,
            patch.object(ownership, "broadcast_draft", side_effect=end_on_second),
            pytest.raises(ending),
        ):
            ownership.claim("h1", "Holder One")
            await stream()

        assert ownership.get_holder() is None
        assert emitted.call_args_list[-1] == call({"event": "holder_changed", "holder": None})

    async def test_a_waiting_requester_still_gets_the_slot(
        self, monkeypatch: Any, ws_manager: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        created_test(recipe_of(ALPHA_CHARLIE, "Ended Asked"))
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        monkeypatch.setattr(watch(), "ROOM_STEP_DELAY_S", 0.0)
        await open_tab(ws_manager, "h1")

        async def ask_then_drop(_payload: dict[str, Any]) -> None:
            ownership.request_takeover("r1", "Ashley")
            raise asyncio.CancelledError

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", side_effect=ask_then_drop),
            pytest.raises(asyncio.CancelledError),
        ):
            ownership.claim("h1", "Holder One")
            await change_of("Ended Asked", recipe_of(REVISED_FLOW, "Ended Asked"))()

        assert ownership.get_holder() == {"id": "r1", "label": "Ashley", "kind": "person"}


# Blocks as the Workbench canvas saves them. HTTP and Log are a real canvas save, ids and
# geometry included; If/Else is as the palette seeds it and its settings window saves it.
CANVAS_SAVED = {"unmasked_secret_fields": [], "secret_masking": "system"}
CANVAS_HTTP = {
    "id": "node-1793680693413-dvjla2m",
    "type": "workflowNode",
    "position": {"x": 180.68775055229852, "y": 47.29881067682517},
    "data": {
        "label": "HTTP",
        "elementType": "http-client",
        "nodeType": "plugin",
        "version": "1.0.0",
        "config": {
            "values": {
                "method": "GET",
                "auth_enabled": False,
                "body_mode": "text",
                "body_auto_headers": True,
                "response_mode": "body",
                "verify_ssl": True,
                "tls_min_version": "1.2",
                "tls_max_version": "1.3",
                "allow_redirects": True,
                "proxy_mode": "wave-setting",
                "url": "url",
            },
            "outputBindings": {"status_code": "scode"},
            "profileBindings": [],
            **CANVAS_SAVED,
        },
        "expressionFields": ["url"],
        "templateFields": [],
        "description": "Fetch the page",
        "descriptionExpanded": True,
    },
    "width": 360,
    "height": 73,
    "resizing": False,
}


def canvas_log(node_id: str, label: str, message: str, y: float) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 3.3142364582105586, "y": y},
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"level": "INFO", "message": message},
                "outputBindings": {},
                "profileBindings": [],
                **CANVAS_SAVED,
            },
            "expressionFields": [],
            "templateFields": [],
        },
    }


CANVAS_LOG = canvas_log("node-1793680720412-gsc0l7g", "Log", "scode", 305.0396283985281)
CANVAS_IF = {
    "id": "node-1793680750000-k2v9q1x",
    "type": "workflowNode",
    "position": {"x": 3.3142364582105586, "y": 420.0},
    "data": {
        "label": "If/Else",
        "elementType": "if-else",
        "nodeType": "control",
        "version": "1.0.0",
        "config": {
            "values": {
                "branches": [
                    {
                        "id": "branch_0",
                        "type": "if",
                        "label": "",
                        "conditions": [
                            {
                                "id": "lit-1",
                                "type": "literal",
                                "variable": "url",
                                "value_type": "string",
                                "operator": "equals",
                                "reference_value": "http://google.com",
                            }
                        ],
                    },
                    {"id": "branch_1", "type": "else", "label": ""},
                ]
            },
            "outputBindings": {},
            "profileBindings": [],
            **CANVAS_SAVED,
        },
        "expressionFields": [],
        "templateFields": [],
    },
}
CANVAS_LOG_1 = canvas_log("node-1793680720999-p4w8m2c", "Log_1", "'done'", 540.0)
CANVAS_BLOCKS = [CANVAS_HTTP, CANVAS_LOG, CANVAS_IF, CANVAS_LOG_1]
# A second HTTP Block in the canvas's save shape, after Log_1.
CANVAS_HTTP_1 = {
    **CANVAS_HTTP,
    "id": "node-1793680760000-h7t3n5r",
    "position": {"x": 3.3142364582105586, "y": 660.0},
    "data": {**CANVAS_HTTP["data"], "label": "HTTP_1"},
}


def canvas_saved_test(
    name: str,
    nodes: list[dict[str, Any]] | None = None,
    after: tuple[dict[str, Any], ...] = (),
) -> str:
    """A test a person built on the canvas, through the save the Workbench sends; the ``after``
    Blocks follow Log_1 in its branch."""
    import copy
    from itertools import pairwise

    from fastapi.testclient import TestClient

    from wavecore.api.app import app

    edges = [
        ("start-node", CANVAS_HTTP, None),
        (CANVAS_HTTP["id"], CANVAS_LOG, None),
        (CANVAS_LOG["id"], CANVAS_IF, None),
        (CANVAS_IF["id"], CANVAS_LOG_1, "branch_0"),
        *((source["id"], target, None) for source, target in pairwise([CANVAS_LOG_1, *after])),
    ]
    body = {
        "name": name,
        "description": "",
        "workflow": {
            "nodes": copy.deepcopy([*(nodes or CANVAS_BLOCKS), *after]),
            "edges": [
                {
                    "id": f"edge-{source}-{target['id']}",
                    "source": source,
                    "target": target["id"],
                    **({"sourceHandle": handle} if handle else {}),
                }
                for source, target, handle in edges
            ],
        },
        "variables": {
            "scode": {"type": "integer"},
            "url": {"value": "http://google.com", "type": "string"},
        },
        "metadata": {"tags": []},
    }
    response = TestClient(app).post("/tests", json=body)
    assert response.status_code == 201, response.json()
    return str(response.json()["data"]["id"])


def readback_changing(test_id: str, step: int, settings: dict[str, Any]) -> str:
    """The test's readback with the one edit an assistant makes: new settings for one step."""
    from wavecore.mcp.tools import author

    readback = author.get_test_recipe(test_id)
    assert readback["expressible"] is True, readback["inexpressible"]
    recipe = yaml.safe_load(readback["recipe"])
    recipe["flow"][step]["settings"].update(settings)
    return str(yaml.safe_dump(recipe, sort_keys=False))


# The Block each edit changes, the readback step that holds it, and the new settings.
CANVAS_EDITS = [
    pytest.param(CANVAS_HTTP, 0, {"method": "POST"}, id="the HTTP Block"),
    pytest.param(CANVAS_LOG, 1, {"message": "status checked"}, id="the Log"),
]


class TestAChangeOfATestSavedFromTheCanvas:
    """A canvas save holds keys the recipe compiler never writes and lacks some it does; only a
    Block the recipe changes takes a turn, and the others show as they end from step one."""

    @pytest.mark.parametrize(("block", "step", "settings"), CANVAS_EDITS)
    async def test_only_the_block_the_recipe_changes_takes_a_turn(
        self, monkeypatch: Any, block: dict[str, Any], step: int, settings: dict[str, Any]
    ) -> None:
        test_id = canvas_saved_test("Canvas Built", after=(CANVAS_HTTP_1,))
        before = saved_nodes(test_id)[CANVAS_HTTP_1["id"]]["data"]["config"]["values"]

        result, payloads = await streamed(
            monkeypatch, test_id, readback_changing(test_id, step, settings)
        )

        assert result["amended"] is True
        after = saved_nodes(test_id)[CANVAS_HTTP_1["id"]]["data"]["config"]["values"]
        # HTTP_1 is unchanged, yet its canvas save lacks choices the amend compiles into it.
        assert {"auth_mode", "file_content_type"} <= after.keys() - before.keys()
        turned = [frame["active_node_id"] for frame in payloads[1:-1]]
        assert CANVAS_HTTP_1["id"] not in turned
        assert turned == [block["id"]]

    @pytest.mark.parametrize(("block", "step", "settings"), CANVAS_EDITS)
    async def test_step_one_shows_the_staying_blocks_as_they_end_and_the_changed_one_as_stored(
        self, monkeypatch: Any, block: dict[str, Any], step: int, settings: dict[str, Any]
    ) -> None:
        test_id = canvas_saved_test("Canvas Step One")

        _, payloads = await streamed(
            monkeypatch, test_id, readback_changing(test_id, step, settings)
        )

        saved = {node["id"]: node for node in stored_test(test_id)["workflow"]["nodes"]}
        shown = {node["id"]: node for node in payloads[0]["nodes"]}
        assert list(shown) == [stored["id"] for stored in CANVAS_BLOCKS]
        for staying in CANVAS_BLOCKS:
            if staying is not block:
                assert shown[staying["id"]] == saved[staying["id"]]
        changed = shown[block["id"]]
        assert changed["data"] == block["data"]
        assert (changed["position"], changed["width"]) == (
            saved[block["id"]]["position"],
            saved[block["id"]]["width"],
        )
        # The canvas's own height of the Block goes; the place and width are the final ones.
        assert set(changed) == (set(block) - {"height"}) | {"width"}

    async def test_the_fast_and_the_watched_change_of_it_save_the_same_test(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.mcp.tools import author

        fast_id = canvas_saved_test("Canvas Fast")
        live_id = canvas_saved_test("Canvas Live")
        edit = {"message": "status checked"}

        fast = author.amend_test_from_recipe(fast_id, readback_changing(fast_id, 1, edit))
        live, _ = await streamed(monkeypatch, live_id, readback_changing(live_id, 1, edit))

        assert fast["amended"] is True and live["amended"] is True
        fast_test, live_test = stored_test(fast_id), stored_test(live_id)
        assert live_test["workflow"] == fast_test["workflow"]
        assert live_test["variables"] == fast_test["variables"]


# What a person set on the canvas for each Block, which no recipe can say.
SET_ON_THE_CANVAS = {
    CANVAS_HTTP["id"]: {
        "descriptionExpanded": True,
        "secret_masking": "mask",
        "unmasked_secret_fields": ["auth_token"],
    },
    CANVAS_LOG["id"]: {
        "descriptionExpanded": None,
        "secret_masking": "reveal",
        "unmasked_secret_fields": [],
    },
}
CANVAS_SETTING_KEYS = ("descriptionExpanded", "secret_masking", "unmasked_secret_fields")


def canvas_settings_of(node: dict[str, Any]) -> dict[str, Any]:
    data = node["data"]
    return {
        "descriptionExpanded": data.get("descriptionExpanded"),
        "secret_masking": data["config"].get("secret_masking"),
        "unmasked_secret_fields": data["config"].get("unmasked_secret_fields"),
    }


def person_set_test(name: str) -> str:
    """The canvas test, its HTTP Block always masking its secrets but its token, its Log
    always revealing them."""
    import copy

    nodes = copy.deepcopy(CANVAS_BLOCKS)
    for node in nodes:
        settings = SET_ON_THE_CANVAS.get(node["id"], {})
        for key in ("secret_masking", "unmasked_secret_fields"):
            if key in settings:
                node["data"]["config"][key] = settings[key]
    return canvas_saved_test(name, nodes)


async def amended(mode: str, monkeypatch: Any, test_id: str, recipe: str) -> dict[str, Any]:
    from wavecore.mcp.tools import author

    if mode == "fast":
        return author.amend_test_from_recipe(test_id, recipe)
    result, _ = await streamed(monkeypatch, test_id, recipe)
    return result


def saved_nodes(test_id: str) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in stored_test(test_id)["workflow"]["nodes"]}


AMEND_MODES = [
    pytest.param("fast", id="the fast amend"),
    pytest.param("watched", id="the watched change"),
]


class TestAnAmendKeepsWhatAPersonSetOnTheCanvas:
    """How a Block masks its secrets and whether its description is open stay with each Block
    the amend recognizes; a new Block starts on the defaults."""

    @pytest.mark.parametrize("mode", AMEND_MODES)
    async def test_a_recognized_block_keeps_how_it_masks_its_secrets(
        self, monkeypatch: Any, mode: str
    ) -> None:
        test_id = person_set_test("Kept Masking")
        recipe = readback_changing(test_id, 1, {"message": "status checked"})

        result = await amended(mode, monkeypatch, test_id, recipe)

        assert result["amended"] is True
        saved = saved_nodes(test_id)
        for node_id, settings in SET_ON_THE_CANVAS.items():
            config = saved[node_id]["data"]["config"]
            assert config.get("secret_masking") == settings["secret_masking"]
            assert config.get("unmasked_secret_fields") == settings["unmasked_secret_fields"]

    @pytest.mark.parametrize("mode", AMEND_MODES)
    async def test_a_recognized_block_keeps_its_open_description(
        self, monkeypatch: Any, mode: str
    ) -> None:
        test_id = person_set_test("Kept Description")
        recipe = readback_changing(test_id, 1, {"message": "status checked"})

        result = await amended(mode, monkeypatch, test_id, recipe)

        assert result["amended"] is True
        assert saved_nodes(test_id)[CANVAS_HTTP["id"]]["data"].get("descriptionExpanded") is True

    @pytest.mark.parametrize("mode", AMEND_MODES)
    async def test_a_recognized_block_whose_settings_changed_still_keeps_them(
        self, monkeypatch: Any, mode: str
    ) -> None:
        test_id = person_set_test("Kept Changed")
        recipe = readback_changing(test_id, 0, {"method": "POST"})

        result = await amended(mode, monkeypatch, test_id, recipe)

        assert result["amended"] is True
        http = saved_nodes(test_id)[CANVAS_HTTP["id"]]
        assert http["data"]["config"]["values"]["method"] == "POST"
        assert canvas_settings_of(http) == SET_ON_THE_CANVAS[CANVAS_HTTP["id"]]

    @pytest.mark.parametrize("mode", AMEND_MODES)
    async def test_a_new_block_starts_on_the_defaults(self, monkeypatch: Any, mode: str) -> None:
        from wavecore.mcp.tools import author

        test_id = person_set_test("Kept Beside New")
        recipe = yaml.safe_load(author.get_test_recipe(test_id)["recipe"])
        recipe["flow"].insert(2, log_step("Added"))

        result = await amended(mode, monkeypatch, test_id, yaml.safe_dump(recipe, sort_keys=False))

        assert result["amended"] is True
        saved = saved_nodes(test_id)
        (added,) = [node for node in saved.values() if node["data"]["label"] == "Added"]
        assert canvas_settings_of(added) == dict.fromkeys(CANVAS_SETTING_KEYS)
        for node_id, settings in SET_ON_THE_CANVAS.items():
            assert canvas_settings_of(saved[node_id]) == settings

    async def test_the_fast_and_the_watched_change_save_the_same_test_with_them(
        self, monkeypatch: Any
    ) -> None:
        fast_id = person_set_test("Kept Fast")
        live_id = person_set_test("Kept Live")
        edit = {"message": "status checked"}

        fast = await amended("fast", monkeypatch, fast_id, readback_changing(fast_id, 1, edit))
        live = await amended("watched", monkeypatch, live_id, readback_changing(live_id, 1, edit))

        assert fast["amended"] is True and live["amended"] is True
        fast_test, live_test = stored_test(fast_id), stored_test(live_id)
        assert live_test["workflow"] == fast_test["workflow"]
        saved = saved_nodes(live_id)
        settings = {node_id: canvas_settings_of(saved[node_id]) for node_id in SET_ON_THE_CANVAS}
        assert settings == SET_ON_THE_CANVAS

    async def test_a_block_that_differs_only_in_them_takes_no_turn_and_every_frame_shows_them(
        self, monkeypatch: Any
    ) -> None:
        test_id = person_set_test("Kept Frames")

        result, payloads = await streamed(
            monkeypatch, test_id, readback_changing(test_id, 1, {"message": "status checked"})
        )

        assert result["amended"] is True
        assert [frame["active_node_id"] for frame in payloads[1:-1]] == [CANVAS_LOG["id"]]
        for frame in payloads:
            shown = {node["id"]: canvas_settings_of(node) for node in frame["nodes"]}
            assert {node_id: shown[node_id] for node_id in SET_ON_THE_CANVAS} == SET_ON_THE_CANVAS


SECRET_VALUES = ("s3cret-variable-value", "s3cret-credential-value", "s3cret-row-value")


def secret_recipe(name: str, suffix: str = "") -> str:
    variables = {
        "token": {"type": "string", "secret": True, "value": SECRET_VALUES[0] + suffix},
        "api_key": {"type": "string"},
    }
    flow = [
        {
            "block": "ssh-session-open",
            "settings": {
                "host": "node-1",
                "username": "wave",
                "password": SECRET_VALUES[1] + suffix,
            },
        },
        {"set": {"api_key": SECRET_VALUES[2] + suffix}, "secret_rows": ["api_key"]},
    ]
    return make_recipe(flow, name=name, variables=variables)


def assert_no_secret_in(payloads: list[dict[str, Any]], test_id: str) -> None:
    served = stored_test(test_id)["variables"]
    for payload in payloads:
        text = json.dumps(payload)
        assert [value for value in SECRET_VALUES if value in text] == []
        assert payload["variables"] == served


class TestNoFrameCarriesASecretValue:
    """The draft topic reaches every tab, so its frames carry what a read of the test serves."""

    async def test_no_build_frame_carries_a_secret_value(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock) as broadcast,
        ):
            result = await watch().build_test_from_recipe(
                secret_recipe("Secret Build"), session_id="s1"
            )

        assert result["built"] is True, result
        payloads = [call.args[0] for call in broadcast.await_args_list]
        assert len(payloads) == 3
        assert_no_secret_in(payloads, result["test_id"])

    async def test_no_change_frame_carries_a_secret_value(self, monkeypatch: Any) -> None:
        test_id = created_test(secret_recipe("Secret Change"))

        result, payloads = await streamed(
            monkeypatch, "Secret Change", secret_recipe("Secret Change", suffix="-new")
        )

        assert result["amended"] is True, result
        assert len(payloads) >= 2
        assert_no_secret_in(payloads, test_id)
        text = json.dumps(payloads)
        assert [value for value in SECRET_VALUES if value + "-new" in text] == []


class TestBuildFraming:
    """The watched build's frames say it is a build; its last frame is the test as saved."""

    async def test_build_frames_say_build_and_the_saved_frame_says_nothing(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock) as broadcast,
        ):
            result = await watch().build_test_from_recipe(
                minimal_watch_recipe("Build Kind"), session_id="s1"
            )

        assert result["built"] is True
        kinds = [call.args[0]["watch_kind"] for call in broadcast.await_args_list]
        assert kinds == ["build", "build", "build", "build", None]

    async def test_the_last_build_frame_is_the_test_as_saved(self, monkeypatch: Any) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        recipe = make_recipe(
            [log_step("Alpha")],
            name="Build Saved Frame",
            variables={"token": {"type": "string", "secret": True, "value": "kept-out"}},
        )
        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", new_callable=AsyncMock) as broadcast,
        ):
            result = await watch().build_test_from_recipe(recipe, session_id="s1")

        last = broadcast.await_args_list[-1].args[0]
        saved = stored_test(result["test_id"])
        assert last["nodes"] == saved["workflow"]["nodes"]
        assert last["edges"] == saved["workflow"]["edges"]
        assert last["variables"] == saved["variables"]

    async def test_a_recipe_the_save_checks_refuse_builds_nothing_before_any_claim(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        refused = REFUSED_STEP
        before = stored_test_ids()
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        with patch.object(ownership, "claim") as claim:
            result = await watch().build_test_from_recipe(
                make_recipe([refused], name="Build Refused"), session_id="s1"
            )

        assert result["built"] is False
        assert find_finding(result["findings"], "UNDECLARED_VARIABLE")["step"] == "flow[0]"
        claim.assert_not_called()
        assert stored_test_ids() == before

    async def test_a_refusal_only_the_save_makes_answers_findings(self, monkeypatch: Any) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.tests.service import SaveValidationError
        from wavecore.api.services.workbench import ownership

        refusal = {"code": "SAVE_REFUSED", "message": "The save refused it", "severity": "error"}

        def refuse(*_args: Any, **_kwargs: Any) -> Any:
            raise SaveValidationError([refusal])

        monkeypatch.setattr(test_service, "create_test", refuse)
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        with patch.object(ownership, "_emit"):
            result = await watch().build_test_from_recipe(
                simple_recipe("Build Save Refused"), session_id="s1"
            )

        assert result == {
            "built": False,
            "findings": [
                {
                    "step": "test",
                    "code": "SAVE_REFUSED",
                    "severity": "error",
                    "problem": "The save refused it",
                    "fix": None,
                }
            ],
        }

    async def test_a_name_taken_while_the_build_played_is_answered_as_a_finding(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.workbench import ownership

        def taken(*_args: Any, **_kwargs: Any) -> Any:
            raise ConflictException("Test with name 'Build Name Race' already exists")

        monkeypatch.setattr(test_service, "create_test", taken)
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        with patch.object(ownership, "_emit"):
            result = await watch().build_test_from_recipe(
                simple_recipe("Build Name Race"), session_id="s1"
            )

        assert result["built"] is False
        assert find_finding(result["findings"], "NAME_CONFLICT")["fix"] == NAME_CONFLICT_FIX


MASK = "********"
RECIPE_SECRETS = {"token": "tok-recipe", "pin": "pin-recipe", "code": "code-recipe"}


def masked_secrets_recipe(name: str, suffix: str = "", body_message: str = "vault") -> str:
    """A test whose secrets every frame shows masked: a variable, and a local Function's
    secret local and secret output default."""
    vault = {
        "name": "vault",
        "variables": {"pin": {"type": "string", "secret": True, "value": "pin-recipe" + suffix}},
        "outputs": [
            {"name": "code", "type": "string", "secret": True, "default": "code-recipe" + suffix}
        ],
        "flow": [{"block": "log", "settings": {"message": body_message}}],
    }
    return make_recipe(
        [log_step("Alpha"), {"function": "vault"}],
        name=name,
        variables={"token": {"type": "string", "secret": True, "value": "tok-recipe" + suffix}},
        functions=[vault],
    )


def build_of(recipe: str) -> Callable[[], Any]:
    return lambda: watch().build_test_from_recipe(recipe, session_id="s1")


def change_of(test_ref: str, recipe: str) -> Callable[[], Any]:
    return lambda: watch().amend_test_live_from_recipe(test_ref, recipe, session_id="s1")


async def taken_over_after(
    monkeypatch: Any, frames: int, stream: Callable[[], Any]
) -> dict[str, Any]:
    """The draft a person holds after force-taking a watched stream at its ``frames``-th frame."""
    from wavecore.api.services.workbench import ownership

    monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
    monkeypatch.setattr(watch(), "ROOM_STEP_DELAY_S", 0.0)
    real_apply = ownership.apply_draft
    seen: list[int] = []

    def take_over(holder_id: str, frame: dict[str, Any]) -> dict[str, Any]:
        payload = real_apply(holder_id, frame)
        seen.append(1)
        if len(seen) == frames:
            ownership.force_takeover("r1", "Ashley")
        return payload

    with (
        patch.object(ownership, "_emit"),
        patch.object(ownership, "broadcast_draft", new_callable=AsyncMock),
        patch.object(ownership, "apply_draft", side_effect=take_over),
    ):
        result = await stream()

    assert result == {result_key(result): False, "released": "force_taken"}
    shared = ownership.get_shared_draft()
    assert shared is not None
    return shared


async def dropped_after(monkeypatch: Any, frames: int, stream: Callable[[], Any]) -> dict[str, Any]:
    """The last frame a watcher saw of a stream whose assistant dropped at its ``frames``-th
    frame, with no tab to hand the slot back to."""
    from wavecore.api.services.workbench import ownership

    monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
    monkeypatch.setattr(watch(), "ROOM_STEP_DELAY_S", 0.0)
    seen: list[dict[str, Any]] = []

    async def drop(payload: dict[str, Any]) -> None:
        seen.append(payload)
        if len(seen) == frames:
            raise asyncio.CancelledError

    with (
        patch.object(ownership, "_emit"),
        patch.object(ownership, "broadcast_draft", side_effect=drop),
        pytest.raises(asyncio.CancelledError),
    ):
        await stream()

    assert ownership.get_holder() is None
    return seen[-1]


def watcher_continues(frame: dict[str, Any]) -> None:
    """A watcher claims the freed slot and sends the draft it mirrored, now its unsaved work."""
    from wavecore.api.services.workbench import ownership

    with patch.object(ownership, "_emit"):
        ownership.claim("w1", "Will")
    ownership.apply_draft("w1", {**frame, "dirty": True, "watch_kind": None})


def result_key(result: dict[str, Any]) -> str:
    return "built" if "built" in result else "amended"


def save_payload(shared: dict[str, Any], name: str, typed: dict[str, Any]) -> dict[str, Any]:
    """What the Workbench sends to save the draft it holds, with what the person typed."""
    variables = {
        var_name: {key: value for key, value in entry.items() if key != "masked"}
        for var_name, entry in shared["variables"].items()
    }
    for var_name, value in typed.items():
        variables[var_name] = {**variables[var_name], "value": value}
    return {
        "name": name,
        "workflow": {"nodes": shared["nodes"], "edges": shared["edges"]},
        "variables": variables,
    }


def person_saves(
    shared: dict[str, Any],
    name: str,
    test_id: str | None = None,
    *,
    tab: str = "r1",
    **typed: Any,
) -> str:
    """The person saves the draft their tab holds: a new test, or the test it changes."""
    from wavecore.api.services.tests import service as test_service

    payload = save_payload(shared, name, typed)
    if test_id is None:
        return str(test_service.create_test(payload, holder_id=tab)["id"])
    assert test_service.update_test(test_id, payload, holder_id=tab) is not None
    return test_id


def stored_secrets(test_id: str) -> dict[str, Any]:
    """Every secret the test stores, by name, unsealed."""
    from wavecore.api.services.tests import service as test_service
    from wavecore.core.secrets.sealing import (
        iter_function_secret_items,
        iter_secret_settings,
        unseal_all,
    )

    variables = test_service.get_test_variables_raw(test_id) or {}
    workflow = test_service.get_test_workflow_raw(test_id) or {}
    found = {
        name: unseal_all(entry.get("value"))
        for name, entry in variables.items()
        if isinstance(entry, dict) and entry.get("secret")
    }
    found.update((name, unseal_all(value)) for name, value in iter_function_secret_items(workflow))
    found.update(
        (setting.name, unseal_all(setting.value)) for setting in iter_secret_settings(workflow)
    )
    return found


def masked_findings(errors: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    return [
        (error["path"], error["node_label"], error["message"], error["fix_action"])
        for error in errors
        if error["code"] == "MASKED_SECRET_VALUE"
    ]


REENTER_FIX = "Clear the masked value and type the secret in again"
MASKED_REFUSALS = [
    (
        "variables.token.value",
        None,
        "The value of secret variable 'token' has to be entered again",
        REENTER_FIX,
    ),
    (
        "nodes.node-2",
        "vault",
        "The value of secret local 'pin' in Function Block 'vault' has to be entered again",
        REENTER_FIX,
    ),
    (
        "nodes.node-2",
        "vault",
        "The default of secret output 'code' in Function Block 'vault' has to be entered again",
        REENTER_FIX,
    ),
]


class TestTheDraftAPersonContinuesKeepsItsSecrets:
    """Frames show secrets masked; whoever continues an interrupted build or change saves it
    with the real values the server kept, and a save never stores the mask."""

    async def test_a_half_built_test_taken_over_and_saved_stores_the_recipes_secrets(
        self, monkeypatch: Any
    ) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        shared = await taken_over_after(
            monkeypatch, 2, build_of(masked_secrets_recipe("Kept Build"))
        )

        response = TestClient(app).post(
            "/tests?holder_id=r1", json=save_payload(shared, "Kept Build", {})
        )

        assert response.status_code == 201, response.json()
        assert stored_secrets(response.json()["data"]["id"]) == RECIPE_SECRETS

    async def test_an_ssh_password_and_a_setter_row_come_through_a_take_over(
        self, monkeypatch: Any
    ) -> None:
        shared = await taken_over_after(monkeypatch, 2, build_of(secret_recipe("Sealed Build")))

        stored = stored_secrets(person_saves(shared, "Sealed Build"))

        assert (stored["password"], stored["api_key"]) == SECRET_VALUES[1:]

    async def test_a_half_done_change_taken_over_and_saved_stores_the_recipes_new_secrets(
        self, monkeypatch: Any
    ) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        test_id = created_test(masked_secrets_recipe("Kept Change"))
        shared = await taken_over_after(
            monkeypatch,
            1,
            change_of("Kept Change", masked_secrets_recipe("Kept Change", "-new")),
        )

        response = TestClient(app).put(
            f"/tests/{test_id}?holder_id=r1", json=save_payload(shared, "Kept Change", {})
        )

        assert response.status_code == 200, response.json()
        assert stored_secrets(test_id) == {
            name: value + "-new" for name, value in RECIPE_SECRETS.items()
        }

    @pytest.mark.parametrize(
        ("frames", "suffix"),
        [(1, ""), (2, "-new")],
        ids=["still in its stored form", "after its turn"],
    )
    async def test_a_changed_block_holds_the_secrets_it_shows(
        self, monkeypatch: Any, frames: int, suffix: str
    ) -> None:
        test_id = created_test(masked_secrets_recipe("Kept Turn"))
        revised = masked_secrets_recipe("Kept Turn", "-new", body_message="changed")
        shared = await taken_over_after(monkeypatch, frames, change_of("Kept Turn", revised))

        person_saves(shared, "Kept Turn", test_id)

        assert stored_secrets(test_id) == {
            "token": "tok-recipe-new",
            "pin": "pin-recipe" + suffix,
            "code": "code-recipe" + suffix,
        }

    @pytest.mark.parametrize("typed", ["typed-by-person", ""], ids=["retyped", "cleared"])
    @pytest.mark.parametrize("kind", ["build", "change"])
    async def test_a_value_the_person_types_or_clears_is_theirs(
        self, monkeypatch: Any, typed: str, kind: str
    ) -> None:
        name = f"Typed {kind} {typed}"
        test_id = created_test(masked_secrets_recipe(name)) if kind == "change" else None
        stream = (
            change_of(name, masked_secrets_recipe(name, "-new"))
            if test_id
            else build_of(masked_secrets_recipe(name))
        )
        shared = await taken_over_after(monkeypatch, 1, stream)

        saved = person_saves(shared, name, test_id, token=typed)

        assert stored_secrets(saved)["token"] == typed

    async def test_a_half_built_test_the_assistant_dropped_stores_the_recipes_secrets(
        self, monkeypatch: Any
    ) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        frame = await dropped_after(
            monkeypatch, 2, build_of(masked_secrets_recipe("Dropped Build"))
        )
        watcher_continues(frame)

        response = TestClient(app).post(
            "/tests?holder_id=w1", json=save_payload(frame, "Dropped Build", {})
        )

        assert response.status_code == 201, response.json()
        assert stored_secrets(response.json()["data"]["id"]) == RECIPE_SECRETS

    async def test_a_half_done_change_the_assistant_dropped_stores_the_recipes_new_secrets(
        self, monkeypatch: Any
    ) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        test_id = created_test(masked_secrets_recipe("Dropped Change"))
        frame = await dropped_after(
            monkeypatch,
            1,
            change_of("Dropped Change", masked_secrets_recipe("Dropped Change", "-new")),
        )
        watcher_continues(frame)

        response = TestClient(app).put(
            f"/tests/{test_id}?holder_id=w1", json=save_payload(frame, "Dropped Change", {})
        )

        assert response.status_code == 200, response.json()
        assert stored_secrets(test_id) == {
            name: value + "-new" for name, value in RECIPE_SECRETS.items()
        }

    @pytest.mark.parametrize(
        "ending",
        [
            "saved",
            "another test opened",
            "a new test started",
            "the next tab after a free shows another test",
        ],
    )
    async def test_after_the_draft_ends_a_masked_new_secret_is_refused(
        self, monkeypatch: Any, ending: str
    ) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.tests.service import SaveValidationError
        from wavecore.api.services.workbench import ownership

        other_id = created_test(make_recipe([log_step("Other")], name="Other Test"))
        shared = await taken_over_after(
            monkeypatch, 2, build_of(masked_secrets_recipe("Ended Build"))
        )
        surface = {"nodes": [], "edges": [], "variables": [], "dirty": False}
        tab = "r1"
        if ending == "saved":
            person_saves(shared, "Ended Build")
        elif ending == "another test opened":
            ownership.apply_draft("r1", {**surface, "test_id": other_id})
        elif ending == "a new test started":
            ownership.apply_draft("r1", {**surface, "test_id": None})
        else:
            with patch.object(ownership, "_emit"):
                ownership.release("r1")
                ownership.claim("r2", "Will")
            ownership.apply_draft("r2", {**surface, "test_id": other_id})
            tab = "r2"
        before = stored_test_ids()

        with pytest.raises(SaveValidationError) as refused:
            test_service.create_test(save_payload(shared, "Ended Build Again", {}), tab)

        assert masked_findings(refused.value.errors) == MASKED_REFUSALS
        assert stored_test_ids() == before

    async def test_the_refusal_reaches_the_tab_as_a_refused_save(self) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        response = TestClient(app).post(
            "/tests",
            json={
                "name": "Masked Create",
                "variables": {"token": {"type": "string", "secret": True, "value": MASK}},
            },
        )

        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert masked_findings(error["details"]) == MASKED_REFUSALS[:1]

    async def test_a_person_save_of_a_saved_test_keeps_its_untouched_masked_secret(
        self,
    ) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.workbench import ownership

        test_id = created_test(masked_secrets_recipe("Plain Save"))
        with patch.object(ownership, "_emit"):
            ownership.claim("r1", "Ashley")
        read = stored_test(test_id)
        ownership.apply_draft(
            "r1", {**read["workflow"], "variables": [], "test_id": test_id, "dirty": True}
        )

        test_service.update_test(
            test_id, {"workflow": read["workflow"], "variables": read["variables"]}, holder_id="r1"
        )

        assert stored_secrets(test_id) == RECIPE_SECRETS

    async def test_the_save_of_another_test_never_draws_on_a_drafts_kept_secrets(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.tests import service as test_service

        other_id = created_test(masked_secrets_recipe("Other Saved"))
        created_test(masked_secrets_recipe("Held Change"))
        await taken_over_after(
            monkeypatch,
            1,
            change_of("Held Change", masked_secrets_recipe("Held Change", "-new")),
        )
        read = stored_test(other_id)

        test_service.update_test(
            other_id, {"workflow": read["workflow"], "variables": read["variables"]}, holder_id="r1"
        )

        assert stored_secrets(other_id) == RECIPE_SECRETS

    async def test_a_recipe_giving_the_mask_as_a_secret_value_builds_nothing(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.services.workbench import ownership

        recipe = make_recipe(
            [log_step("Alpha")],
            name="Mask Recipe",
            variables={"token": {"type": "string", "secret": True, "value": MASK}},
        )
        before = stored_test_ids()
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        with patch.object(ownership, "claim") as claim:
            result = await watch().build_test_from_recipe(recipe, session_id="s1")

        assert result["built"] is False
        assert find_finding(result["findings"], "MASKED_SECRET_VALUE") == {
            "step": "variables.token",
            "code": "MASKED_SECRET_VALUE",
            "severity": "error",
            "problem": "The value of secret variable 'token' has to be entered again",
            "fix": REENTER_FIX,
        }
        claim.assert_not_called()
        assert stored_test_ids() == before


def mask_kept_recipe(name: str, body_message: str = "vault") -> str:
    """The test of ``masked_secrets_recipe`` as an assistant amends it from a readback: each
    secret given as the mask, which keeps the value the test stores."""
    vault = {
        "name": "vault",
        "variables": {"pin": {"type": "string", "secret": True, "value": MASK}},
        "outputs": [{"name": "code", "type": "string", "secret": True, "default": MASK}],
        "flow": [{"block": "log", "settings": {"message": body_message}}],
    }
    return make_recipe(
        [log_step("Alpha"), {"function": "vault"}],
        name=name,
        variables={"token": {"type": "string", "secret": True, "value": MASK}},
        functions=[vault],
    )


class TestASecretGivenAsTheMaskKeepsItsStoredValue:
    """The mask in a recipe means "keep what the test stores", in both modes and in the dry run."""

    @pytest.mark.parametrize("mode", AMEND_MODES)
    async def test_both_modes_save_the_change_with_the_stored_secrets(
        self, monkeypatch: Any, mode: str
    ) -> None:
        test_id = created_test(masked_secrets_recipe("Mask Kept"))

        result = await amended(
            mode, monkeypatch, test_id, mask_kept_recipe("Mask Kept", body_message="changed")
        )

        assert result["amended"] is True, result
        assert stored_secrets(test_id) == RECIPE_SECRETS

    def test_the_dry_run_against_the_test_accepts_it(self) -> None:
        from wavecore.mcp.tools import author

        created_test(masked_secrets_recipe("Mask Dry Run"))

        result = author.validate_recipe(
            mask_kept_recipe("Mask Dry Run", body_message="changed"), test_ref="Mask Dry Run"
        )

        assert result["valid"] is True, result["findings"]


class TestOnlyTheTabContinuingTheDraftSavesWithItsSecrets:
    """The kept secrets serve, and end with, the save the holding tab makes of the draft it
    continues; any other save neither draws on them nor ends them."""

    async def test_a_new_test_made_elsewhere_leaves_them_for_the_drafts_save(
        self, monkeypatch: Any
    ) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        shared = await taken_over_after(
            monkeypatch, 2, build_of(masked_secrets_recipe("Kept Past New"))
        )
        client = TestClient(app)

        assert client.post("/tests", json={"name": "Made Elsewhere"}).status_code == 201
        response = client.post(
            "/tests?holder_id=r1", json=save_payload(shared, "Kept Past New", {})
        )

        assert response.status_code == 201, response.json()
        assert stored_secrets(response.json()["data"]["id"]) == RECIPE_SECRETS

    async def test_a_move_of_the_test_to_a_suite_leaves_them_for_the_drafts_save(
        self, monkeypatch: Any
    ) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        test_id = created_test(masked_secrets_recipe("Kept Past Move"))
        shared = await taken_over_after(
            monkeypatch,
            1,
            change_of("Kept Past Move", masked_secrets_recipe("Kept Past Move", "-new")),
        )
        client = TestClient(app)

        moved = client.patch("/tests/batch", json=[{"id": test_id, "metadata": {"tags": ["m"]}}])
        assert moved.json()["updated"] == [test_id]
        response = client.put(
            f"/tests/{test_id}?holder_id=r1", json=save_payload(shared, "Kept Past Move", {})
        )

        assert response.status_code == 200, response.json()
        assert stored_secrets(test_id) == {
            name: value + "-new" for name, value in RECIPE_SECRETS.items()
        }

    @pytest.mark.parametrize("query", ["", "?holder_id=w9"], ids=["no tab", "another tab"])
    async def test_a_save_from_anywhere_else_never_gets_their_values(
        self, monkeypatch: Any, query: str
    ) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        await taken_over_after(monkeypatch, 2, build_of(masked_secrets_recipe("Kept Away")))
        client = TestClient(app)
        before = stored_test_ids()

        response = client.post(
            f"/tests{query}",
            json={
                "name": "Copied Elsewhere",
                "variables": {"token": {"type": "string", "secret": True, "value": MASK}},
            },
        )

        assert response.status_code == 422, response.json()
        assert masked_findings(response.json()["error"]["details"]) == MASKED_REFUSALS[:1]
        assert stored_test_ids() == before


def masked_settings_recipe(name: str, username: str = "wave") -> str:
    """The test of ``secret_recipe`` with its secret variable, its SSH password and its secret
    Setter row each given as the mask."""
    flow = [
        {
            "block": "ssh-session-open",
            "label": "Open SSH",
            "settings": {"host": "node-1", "username": username, "password": MASK},
        },
        {"set": {"api_key": MASK}, "secret_rows": ["api_key"], "label": "Set Key"},
    ]
    variables = {
        "token": {"type": "string", "secret": True, "value": MASK},
        "api_key": {"type": "string"},
    }
    return make_recipe(flow, name=name, variables=variables)


def sealed_masks_in(payload: dict[str, Any]) -> list[str]:
    """The block secrets a frame carries whose sealed value is the mask text."""
    from wavecore.core.secrets.sealing import iter_secret_settings, unseal_all

    return [
        setting.name
        for setting in iter_secret_settings({"nodes": payload["nodes"], "edges": []})
        if unseal_all(setting.value) == MASK
    ]


BLOCK_SECRET_REFUSALS = [
    "The value of secret field 'password' in Block 'Open SSH' has to be entered again",
    "The value of secret variable 'api_key' in Block 'Set Key' has to be entered again",
]


def refusals_of(findings: list[dict[str, Any]]) -> list[str]:
    return [item["problem"] for item in findings if item["code"] == "MASKED_SECRET_VALUE"]


class TestTheMaskIsNeverStoredAsABlockSecret:
    """A credential field or a secret Setter row given as the mask keeps what the test stores,
    or is refused; the mask text is never sealed and never stored as the secret."""

    async def test_no_frame_of_a_change_carries_a_sealed_mask(self, monkeypatch: Any) -> None:
        test_id = created_test(secret_recipe("Masked Settings"))

        result, payloads = await streamed(
            monkeypatch,
            "Masked Settings",
            masked_settings_recipe("Masked Settings", username="wave-new"),
        )

        assert result["amended"] is True, result
        assert [sealed_masks_in(payload) for payload in payloads] == [[] for _ in payloads]
        stored = stored_secrets(test_id)
        assert (stored["token"], stored["password"], stored["api_key"]) == SECRET_VALUES

    @pytest.mark.parametrize("frames", [1, 2], ids=["at step one", "after the turn"])
    async def test_a_person_who_takes_over_the_change_keeps_the_stored_secrets(
        self, monkeypatch: Any, frames: int
    ) -> None:
        test_id = created_test(secret_recipe("Taken Settings"))
        revised = masked_settings_recipe("Taken Settings", username="wave-new")
        shared = await taken_over_after(monkeypatch, frames, change_of("Taken Settings", revised))

        person_saves(shared, "Taken Settings", test_id)

        stored = stored_secrets(test_id)
        assert (stored["token"], stored["password"], stored["api_key"]) == SECRET_VALUES

    @pytest.mark.parametrize("mode", ["fast create", "build", "fast amend", "watched change"])
    async def test_a_block_secret_given_as_the_mask_with_none_stored_is_refused(
        self, monkeypatch: Any, mode: str
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp.tools import author

        name = f"Masked New {mode}"
        changes = mode in ("fast amend", "watched change")
        test_id = created_test(recipe_of(ALPHA_CHARLIE, name)) if changes else None
        recipe = masked_settings_recipe(name)
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        monkeypatch.setattr(watch(), "ROOM_STEP_DELAY_S", 0.0)
        before = stored_test_ids()
        version = stored_test(test_id)["version"] if test_id else None

        with patch.object(ownership, "claim", wraps=ownership.claim) as claim:
            if mode == "fast create":
                result = author.create_test_from_recipe(recipe)
            elif mode == "build":
                result = await watch().build_test_from_recipe(recipe, session_id="s1")
            elif mode == "fast amend":
                result = author.amend_test_from_recipe(name, recipe)
            else:
                result = await watch().amend_test_live_from_recipe(name, recipe, session_id="s1")

        assert [result[key] for key in ("created", "built", "amended") if key in result] == [False]
        assert refusals_of(result["findings"]) == [MASKED_REFUSALS[0][2], *BLOCK_SECRET_REFUSALS]
        assert stored_test_ids() == before
        if test_id is not None:
            assert stored_test(test_id)["version"] == version
        if mode in ("build", "watched change"):
            claim.assert_not_called()

    async def test_a_save_holding_the_mask_as_a_block_secret_is_refused(self) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app
        from wavecore.api.services.network import ssh_hosts
        from wavecore.core.recipes.compiler import compile_recipe

        compiled = compile_recipe(
            masked_settings_recipe("Masked Save"),
            testdata_dirs=[],
            placement_defaults=ssh_hosts.placement_defaults(),
        )["test_data"]
        before = stored_test_ids()

        response = TestClient(app).post(
            "/tests", json={**compiled, "variables": {"api_key": {"type": "string"}}}
        )

        assert response.status_code == 422, response.json()
        details = response.json()["error"]["details"]
        assert [item["message"] for item in details] == BLOCK_SECRET_REFUSALS
        assert stored_test_ids() == before


def vault_message(payload: dict[str, Any]) -> str:
    """What the body of the Function Block 'vault' logs, as a frame shows it."""
    vault = next(node for node in payload["nodes"] if node["data"]["label"] == "vault")
    (body_log,) = vault["data"]["localDefinition"]["workflow"]["nodes"]
    return str(body_log["data"]["config"]["values"]["message"])


class TestAForcedTakeOverWhileAFrameIsOnItsWay:
    """A take-over forced while a frame of a watched change is still being sent: the taker
    saves the secrets of what its canvas shows."""

    async def test_the_taker_saves_the_secrets_of_the_form_its_canvas_shows(
        self, monkeypatch: Any
    ) -> None:
        from wavecore.api.routes import workbench as workbench_routes
        from wavecore.api.services.workbench import ownership

        test_id = created_test(masked_secrets_recipe("Sent Turn"))
        revised = masked_secrets_recipe("Sent Turn", "-new", body_message="changed")
        monkeypatch.setattr(watch(), "REVEAL_STEP_DELAY_S", 0.0)
        monkeypatch.setattr(watch(), "ROOM_STEP_DELAY_S", 0.0)
        # The frames the taker's tab has got, and the one it shows once its take-over answers.
        delivered: list[dict[str, Any]] = []
        shown: list[dict[str, Any]] = []
        taking: list[asyncio.Task[None]] = []

        async def take_over() -> None:
            await workbench_routes.force_ownership_takeover(
                workbench_routes.OwnershipTakeoverRequest(
                    requester_id="r1", requester_label="Ashley"
                )
            )
            shown.append(delivered[-1])

        async def send(payload: dict[str, Any]) -> None:
            if payload["active_node_id"] is not None and not taking:
                # The request lands while the turn's frame is still on its way to the taker.
                taking.append(asyncio.ensure_future(take_over()))
                for _ in range(3):
                    await asyncio.sleep(0)
            delivered.append(payload)

        with (
            patch.object(ownership, "_emit"),
            patch.object(ownership, "broadcast_draft", side_effect=send),
        ):
            result = await change_of("Sent Turn", revised)()
            await taking[0]

        assert result == {"amended": False, "released": "force_taken"}
        # The taker's tab sends the draft it shows, then saves it.
        ownership.apply_draft("r1", {**shown[0], "watch_kind": None})
        person_saves(shown[0], "Sent Turn", test_id)
        suffix = "-new" if vault_message(shown[0]) == "changed" else ""
        assert stored_secrets(test_id) == {
            "token": "tok-recipe-new",
            "pin": "pin-recipe" + suffix,
            "code": "code-recipe" + suffix,
        }
