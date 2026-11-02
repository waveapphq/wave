"""Unit tests for session-derived plugin context keys.

``_execute_plugin_with_session`` injects ``context["artifacts_dir"]`` and
``context["testdata_dirs"]`` from the session record so artifact:// and
testdata:// resolve uniformly in workbench runs. The session-less fallback path
injects nothing.
"""

import uuid
from pathlib import Path
from typing import Any

from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench.plugins import (
    _execute_plugin_fallback,
    _execute_plugin_with_session,
)


class _StubPlugin:
    """Minimal plugin capturing the execution context it receives."""

    def __init__(self) -> None:
        self.context: dict[str, Any] | None = None

    @property
    def metadata(self) -> dict[str, Any]:
        return {"id": "stub-plugin", "parameters": []}

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        self.context = context
        return {"ok": True}

    async def cleanup(self) -> None:
        pass


def _prime_session(
    artifacts_dir: str | None,
    testdata_dirs: list[str] | None = None,
) -> str:
    session_id = str(uuid.uuid4())
    session: dict[str, Any] = {
        "session_id": session_id,
        "test_id": str(uuid.uuid4()),
        "status": "running",
        "user_id": wb_common.DEFAULT_USER_ID,
        "variables": {},
        "block_states": {},
    }
    if artifacts_dir is not None:
        session["artifacts_dir"] = artifacts_dir
    if testdata_dirs is not None:
        session["testdata_dirs"] = testdata_dirs
    wb_common._workbench_sessions[session_id] = session
    return session_id


async def _run_with_session(plugin: _StubPlugin, session_id: str) -> Any:
    return await _execute_plugin_with_session(
        plugin,
        "stub-plugin",
        {},
        {},
        session_id,
        None,
        None,
        None,
        None,
    )


async def _run_with_bindings(
    plugin: _StubPlugin, session_id: str, output_bindings: dict[str, str]
) -> Any:
    return await _execute_plugin_with_session(
        plugin,
        "stub-plugin",
        {},
        {},
        session_id,
        None,
        None,
        None,
        None,
        output_bindings=output_bindings,
    )


class TestSessionContextInjection:
    """artifacts_dir flows from the session record into the plugin context."""

    async def test_injects_artifacts_dir_from_session(self, tmp_path: Path) -> None:
        artifacts_dir = str(tmp_path / "sessions" / "abc")
        session_id = _prime_session(artifacts_dir)
        plugin = _StubPlugin()

        await _run_with_session(plugin, session_id)

        assert plugin.context is not None
        assert plugin.context["artifacts_dir"] == artifacts_dir

    async def test_session_without_artifacts_dir_injects_nothing(self) -> None:
        session_id = _prime_session(None)
        plugin = _StubPlugin()

        await _run_with_session(plugin, session_id)

        assert plugin.context is not None
        assert "artifacts_dir" not in plugin.context

    async def test_unknown_session_injects_nothing(self) -> None:
        plugin = _StubPlugin()

        await _run_with_session(plugin, str(uuid.uuid4()))

        assert plugin.context is not None
        assert "artifacts_dir" not in plugin.context


class TestTestDataDirsInjection:
    """testdata_dirs is copied from the session's own key, never derived."""

    async def test_injects_the_sessions_testdata_dirs(self, tmp_path: Path) -> None:
        testdata_dirs = [str(tmp_path / "testdata" / "test-1")]
        session_id = _prime_session(None, testdata_dirs=testdata_dirs)
        plugin = _StubPlugin()

        await _run_with_session(plugin, session_id)

        assert plugin.context is not None
        assert plugin.context["testdata_dirs"] == testdata_dirs

    async def test_session_without_the_key_yields_an_empty_list(self) -> None:
        session_id = _prime_session(None)
        plugin = _StubPlugin()

        await _run_with_session(plugin, session_id)

        assert plugin.context is not None
        assert plugin.context["testdata_dirs"] == []

    async def test_nothing_is_derived_from_the_session_test_id(self) -> None:
        session_id = _prime_session(None)
        test_id = wb_common._workbench_sessions[session_id]["test_id"]
        plugin = _StubPlugin()

        await _run_with_session(plugin, session_id)

        assert plugin.context is not None
        assert test_id not in str(plugin.context["testdata_dirs"])

    async def test_unknown_session_yields_an_empty_list(self) -> None:
        plugin = _StubPlugin()

        await _run_with_session(plugin, str(uuid.uuid4()))

        assert plugin.context is not None
        assert plugin.context["testdata_dirs"] == []


class TestFallbackContextInjection:
    """The session-less fallback path never injects the session keys."""

    async def test_fallback_injects_nothing(self) -> None:
        plugin = _StubPlugin()

        await _execute_plugin_fallback(plugin, {}, {})

        assert plugin.context is not None
        assert "artifacts_dir" not in plugin.context

    async def test_fallback_injects_no_testdata_dirs(self) -> None:
        plugin = _StubPlugin()

        await _execute_plugin_fallback(plugin, {}, {})

        assert plugin.context is not None
        assert "testdata_dirs" not in plugin.context


class TestRegisterSecretFacility:
    """Plugins register mid-flight credential acquisitions via the context."""

    async def test_context_exposes_a_register_secret_callable(self) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        session_id = _prime_session(None)
        wb_common._workbench_sessions[session_id]["secret_registry"] = registry
        plugin = _StubPlugin()

        await _run_with_session(plugin, session_id)

        assert plugin.context is not None
        assert callable(plugin.context["register_secret"])

    async def test_register_secret_registers_with_the_run_registry(self) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        session_id = _prime_session(None)
        wb_common._workbench_sessions[session_id]["secret_registry"] = registry
        plugin = _StubPlugin()

        await _run_with_session(plugin, session_id)

        assert plugin.context is not None
        plugin.context["register_secret"]("tok-acqu1red-99")

        assert "tok-acqu1red-99" in registry.scan_values()

    async def test_register_secret_without_session_registry_is_a_safe_no_op(self) -> None:
        session_id = _prime_session(None)
        plugin = _StubPlugin()

        await _run_with_session(plugin, session_id)

        assert plugin.context is not None
        plugin.context["register_secret"]("tok-acqu1red-99")


class TestOutputTypesInjection:
    """SHRUN-6: a bound output is read as the declared type of the variable it binds to."""

    async def test_output_types_holds_the_declared_type_of_each_bound_target(self) -> None:
        from wavecore.core.variables.declared_types import declared_type_scope

        session_id = _prime_session(None)
        plugin = _StubPlugin()

        with declared_type_scope({"count": "integer", "status": "string"}):
            await _run_with_bindings(plugin, session_id, {"COUNT": "count", "STATUS": "status"})

        assert plugin.context is not None
        assert plugin.context["output_types"] == {"COUNT": "integer", "STATUS": "string"}

    async def test_a_target_without_a_declared_type_is_omitted(self) -> None:
        from wavecore.core.variables.declared_types import declared_type_scope

        session_id = _prime_session(None)
        plugin = _StubPlugin()

        with declared_type_scope({"count": "integer"}):
            await _run_with_bindings(plugin, session_id, {"COUNT": "count", "X": "undeclared"})

        assert plugin.context is not None
        assert plugin.context["output_types"] == {"COUNT": "integer"}

    async def test_an_output_left_unbound_is_omitted(self) -> None:
        from wavecore.core.variables.declared_types import declared_type_scope

        session_id = _prime_session(None)
        plugin = _StubPlugin()

        with declared_type_scope({"count": "integer"}):
            await _run_with_bindings(plugin, session_id, {"COUNT": ""})

        assert plugin.context is not None
        assert plugin.context["output_types"] == {}

    async def test_no_declared_type_in_scope_yields_an_empty_map(self) -> None:
        session_id = _prime_session(None)
        plugin = _StubPlugin()

        await _run_with_bindings(plugin, session_id, {"COUNT": "count"})

        assert plugin.context is not None
        assert plugin.context["output_types"] == {}


class TestFunctionBodyOutputTypes:
    """SHRUN-6: inside a Function node the Function's own declarations decide the types."""

    @staticmethod
    def _function_def() -> dict[str, Any]:
        return {
            "name": "callee",
            "inputs": [{"name": "limit", "type": "integer"}],
            "outputs": [{"name": "total", "type": "integer"}],
            "variables": [{"name": "ratio", "type": "float", "value": None}],
        }

    async def test_function_body_types_apply_inside_the_function_node(self) -> None:
        from wavecore.core.variables.declared_types import declared_type_scope, types_of_function

        session_id = _prime_session(None)
        plugin = _StubPlugin()

        with declared_type_scope({"outer": "string"}):
            with declared_type_scope(types_of_function(self._function_def())):
                await _run_with_bindings(
                    plugin, session_id, {"COUNT": "ratio", "TOTAL": "total", "X": "outer"}
                )

        assert plugin.context is not None
        assert plugin.context["output_types"] == {"COUNT": "float", "TOTAL": "integer"}

    async def test_the_outer_types_apply_again_after_the_function_body(self) -> None:
        from wavecore.core.variables.declared_types import declared_type_scope, types_of_function

        session_id = _prime_session(None)
        plugin = _StubPlugin()

        with declared_type_scope({"outer": "string"}):
            with declared_type_scope(types_of_function(self._function_def())):
                pass
            await _run_with_bindings(plugin, session_id, {"X": "outer"})

        assert plugin.context is not None
        assert plugin.context["output_types"] == {"X": "string"}
