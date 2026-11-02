"""Watch-mode build tool: build_test_from_recipe (REQ-5.2.7.9).

The watch tool mirrors create_test_from_recipe's envelope/findings/secret and
up-front name-conflict checks, but holds the workbench slot across a paced
reveal that pushes one growing draft frame per node through
ownership.apply_draft (each carrying active_node_id), then persists through the
strict save pipeline. A take-over requested mid-reveal abandons the build
without saving.
"""

import contextlib
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import yaml

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
