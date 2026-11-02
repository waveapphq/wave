"""Per-surface secret-reveal gating (REQ-3.1.3.17, REQ-3.1.3.5).

The system-wide reveal controls are per-surface, not one blunt switch. Each
masking call-site masks when its own flag is off and reveals when it is on:

- Run output (logs / console)
  log_streaming.scrub_message -> run_output(+blk)
- Errors (breakpoint / completion)
  _common._emit_breakpoint_hit -> run_output
- Reports / history (aggregate)
  executions._storage._save_* -> run_output(noblk)
- Workbench test vars (panel/watcher)
  variable_push / _mask_session_value / get_test -> test_variables
- Global/regression/suite var editors
  variable_service / shared.read_secret_variables -> shared_variables

Run-output log lines additionally honor the per-block resolution; the
aggregate stored-variable snapshot honors only the system run_output.
"""

import uuid
from collections.abc import Generator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

import wavecore.api.services.executions._storage as exec_storage
import wavecore.api.services.tests.service as tests_service
import wavecore.api.services.variable_service as variable_service
import wavecore.api.services.workbench._common as wb_common
import wavecore.api.services.workbench.service as workbench_service
import wavecore.core.secrets.masking_settings as masking_settings
from wavecore.api.services import log_streaming_service, shared
from wavecore.api.services.variable_push import VariablePushService
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.secrets.sealing import seal_value

_SECRET = "supersecret-value"


def _registry() -> SecretRegistry:
    """A run registry with `token` flagged secret and its value scrubbable."""
    registry = SecretRegistry()
    registry.register("token", _SECRET, "test")
    return registry


@pytest.fixture(autouse=True)
def _isolate_state() -> Generator[None, None, None]:
    masking_settings.set_reveal_settings(
        run_output=False,
        test_variables=False,
        shared_variables=False,
        credential_inputs=False,
    )
    wb_common._workbench_sessions.clear()
    log_streaming_service._clear_cache()
    yield
    masking_settings.set_reveal_settings(
        run_output=False,
        test_variables=False,
        shared_variables=False,
        credential_inputs=False,
    )
    wb_common._workbench_sessions.clear()
    log_streaming_service._clear_cache()


class TestRunOutputLogScrub:
    """Row 1: log/console text scrub gates on run_output OR the per-block reveal."""

    def test_masks_when_run_output_off(self) -> None:
        log_streaming_service.register_secret_registry("s1", _registry())
        result = log_streaming_service.scrub_message("s1", f"token={_SECRET}", "HTTP")
        assert result == "token=********"

    def test_reveals_when_run_output_on(self) -> None:
        log_streaming_service.register_secret_registry("s1", _registry())
        masking_settings.set_reveal_settings(run_output=True)
        result = log_streaming_service.scrub_message("s1", f"token={_SECRET}", "HTTP")
        assert result == f"token={_SECRET}"

    def test_reveals_for_per_block_unmask_while_system_masked(self) -> None:
        log_streaming_service.register_secret_registry("s1", _registry())
        result = log_streaming_service.scrub_message("s1", f"token={_SECRET}", "HTTP", unmask=True)
        assert result == f"token={_SECRET}"

    def test_system_source_ignores_per_block_unmask(self) -> None:
        log_streaming_service.register_secret_registry("s1", _registry())
        result = log_streaming_service.scrub_message(
            "s1", f"token={_SECRET}", "SYSTEM", unmask=True
        )
        assert result == "token=********"

    def test_explicit_block_mask_wins_over_system_reveal(self) -> None:
        """A block set to 'mask' (unmask=False) stays masked even when the
        system-wide run-output reveal is on - the per-block choice overrides."""
        log_streaming_service.register_secret_registry("s1", _registry())
        masking_settings.set_reveal_settings(run_output=True)
        result = log_streaming_service.scrub_message("s1", f"token={_SECRET}", "HTTP", unmask=False)
        assert result == "token=********"

    def test_generic_line_follows_system_reveal(self) -> None:
        """A line with no per-block choice (unmask unset) inherits the system
        default - revealed under run_output, masked otherwise."""
        log_streaming_service.register_secret_registry("s1", _registry())
        masking_settings.set_reveal_settings(run_output=True)
        result = log_streaming_service.scrub_message("s1", f"token={_SECRET}", "HTTP")
        assert result == f"token={_SECRET}"

    def test_test_variables_flag_does_not_reveal_run_output(self) -> None:
        log_streaming_service.register_secret_registry("s1", _registry())
        masking_settings.set_reveal_settings(test_variables=True)
        result = log_streaming_service.scrub_message("s1", f"token={_SECRET}", "HTTP")
        assert result == "token=********"


class TestErrorTextGate:
    """Row 2: breakpoint / completion error text gates on run_output."""

    async def test_masks_when_run_output_off(self) -> None:
        wb_common._workbench_sessions["s1"] = {"secret_registry": _registry()}
        with patch.object(wb_common, "_broadcast_event", new=AsyncMock()) as mock_bc:
            await wb_common._emit_breakpoint_hit(
                "s1", "n1", "Node", "error", ValueError(f"boom {_SECRET}")
            )
        assert mock_bc.call_args.args[1]["exception_message"] == "boom ********"

    async def test_reveals_when_run_output_on(self) -> None:
        wb_common._workbench_sessions["s1"] = {"secret_registry": _registry()}
        masking_settings.set_reveal_settings(run_output=True)
        with patch.object(wb_common, "_broadcast_event", new=AsyncMock()) as mock_bc:
            await wb_common._emit_breakpoint_hit(
                "s1", "n1", "Node", "error", ValueError(f"boom {_SECRET}")
            )
        assert mock_bc.call_args.args[1]["exception_message"] == f"boom {_SECRET}"


class TestAggregateSnapshotGate:
    """Row 3: persisted run variables / snapshot are ALWAYS masked at rest,
    regardless of any reveal flag. Reveal is a live-display concern; the stored
    execution record is a masked surface ('exported execution data is always
    masked') so a temporary reveal can never bake plaintext onto disk."""

    def test_save_variables_masks_when_run_output_off(self) -> None:
        with patch.object(exec_storage, "_yaml_write") as mock_write:
            exec_storage._save_variables("exec-1", {"token": _SECRET}, _registry())
        assert mock_write.call_args.args[1]["token"] == "********"

    def test_save_variables_masks_even_when_run_output_on(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        with patch.object(exec_storage, "_yaml_write") as mock_write:
            exec_storage._save_variables("exec-1", {"token": _SECRET}, _registry())
        assert mock_write.call_args.args[1]["token"] == "********"

    def test_save_snapshot_masks_when_run_output_off(self) -> None:
        snapshot: dict[str, Any] = {"variables": {"token": _SECRET}}
        with patch.object(exec_storage, "_yaml_write") as mock_write:
            exec_storage._save_snapshot("exec-1", "run-1", snapshot, _registry())
        assert mock_write.call_args.args[1]["variables"]["token"] == "********"

    def test_save_snapshot_masks_even_when_run_output_on(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        snapshot: dict[str, Any] = {"variables": {"token": _SECRET}}
        with patch.object(exec_storage, "_yaml_write") as mock_write:
            exec_storage._save_snapshot("exec-1", "run-1", snapshot, _registry())
        assert mock_write.call_args.args[1]["variables"]["token"] == "********"

    def test_aggregate_ignores_test_variables_flag(self) -> None:
        masking_settings.set_reveal_settings(test_variables=True)
        with patch.object(exec_storage, "_yaml_write") as mock_write:
            exec_storage._save_variables("exec-1", {"token": _SECRET}, _registry())
        assert mock_write.call_args.args[1]["token"] == "********"


class TestWatcherInspectionGate:
    """Row 4: the WS variable stream feeds the workbench Variable Manager panel and
    its watchers, both governed by the test_variables flag."""

    @staticmethod
    def _event() -> dict[str, Any]:
        return {"watch_id": "w1", "path": "token", "value": _SECRET, "var_type": "string"}

    def test_masks_when_test_variables_off(self) -> None:
        wb_common._workbench_sessions["w1"] = {"secret_registry": _registry()}
        assert VariablePushService._mask_event_value(self._event()) == MASK_PLACEHOLDER

    def test_reveals_when_test_variables_on(self) -> None:
        wb_common._workbench_sessions["w1"] = {"secret_registry": _registry()}
        masking_settings.set_reveal_settings(test_variables=True)
        assert VariablePushService._mask_event_value(self._event()) == _SECRET

    def test_shared_variables_flag_does_not_reveal_watchers(self) -> None:
        wb_common._workbench_sessions["w1"] = {"secret_registry": _registry()}
        masking_settings.set_reveal_settings(shared_variables=True)
        assert VariablePushService._mask_event_value(self._event()) == MASK_PLACEHOLDER

    def test_run_output_flag_does_not_reveal_watchers(self) -> None:
        wb_common._workbench_sessions["w1"] = {"secret_registry": _registry()}
        masking_settings.set_reveal_settings(run_output=True)
        assert VariablePushService._mask_event_value(self._event()) == MASK_PLACEHOLDER


class TestSessionReadByScopeGate:
    """A session read of a Function scope follows the test-variables reveal as a read of the
    Test scope does: one display rule for every scope (REQ-3.1.3.17)."""

    @staticmethod
    def _value(path: tuple[str, ...]) -> Any:
        wb_common._workbench_sessions["s1"] = {
            "session_id": "s1",
            "variables": {"token": _SECRET},
            "function_scopes": {("fn-1",): {"token": _SECRET}},
            "secret_variable_names": ["token"],
            "secret_registry": _registry(),
        }
        read = workbench_service.get_session_variables("s1", function_path=path)
        return read["variables"]["token"]["value"]

    @pytest.mark.parametrize("path", [(), ("fn-1",)], ids=["test", "function"])
    def test_masks_while_test_variables_off(self, path: tuple[str, ...]) -> None:
        assert self._value(path) == MASK_PLACEHOLDER

    @pytest.mark.parametrize("path", [(), ("fn-1",)], ids=["test", "function"])
    def test_reveals_while_test_variables_on(self, path: tuple[str, ...]) -> None:
        masking_settings.set_reveal_settings(test_variables=True)
        assert self._value(path) == _SECRET


class TestSharedReadSecretVariables:
    """Regression/suite entity variable VIEWS gate on shared_variables: masked to
    the placeholder while off, unsealed to plaintext while on. Export masking
    (mask_secret_variables) is a separate, always-masking path."""

    def test_masks_when_shared_variables_off(self) -> None:
        variables = {"token": {"value": seal_value(_SECRET), "secret": True, "type": "string"}}
        assert shared.read_secret_variables(variables)["token"]["value"] == MASK_PLACEHOLDER

    def test_reveals_plaintext_when_shared_variables_on(self) -> None:
        variables = {"token": {"value": seal_value(_SECRET), "secret": True, "type": "string"}}
        masking_settings.set_reveal_settings(shared_variables=True)
        assert shared.read_secret_variables(variables)["token"]["value"] == _SECRET

    def test_non_secret_untouched_when_revealed(self) -> None:
        masking_settings.set_reveal_settings(shared_variables=True)
        variables = {"plain": {"value": "hello", "type": "string"}}
        assert shared.read_secret_variables(variables) == variables

    def test_non_dict_passthrough(self) -> None:
        assert shared.read_secret_variables("nope") == "nope"

    def test_secret_without_value_untouched(self) -> None:
        variables = {"token": {"secret": True, "type": "string"}}
        assert "value" not in shared.read_secret_variables(variables)["token"]


class TestWorkbenchTestVariableReveal:
    """The workbench test-detail variable read (get_test -> the Variable Manager
    panel and its watchers) gates on test_variables: masked to the placeholder while
    off, unsealed to plaintext while on (REQ-3.1.3.17). Encryption at rest is
    unaffected."""

    def _vars(self) -> dict[str, Any]:
        return {
            "token": {"value": seal_value(_SECRET), "secret": True, "type": "string"},
            "plain": {"value": "hello", "type": "string"},
        }

    def test_masks_when_test_variables_off(self) -> None:
        out = tests_service._reveal_or_mask_secret_variables(self._vars())
        assert out["token"]["value"] == MASK_PLACEHOLDER
        assert out["token"]["masked"] is True
        assert out["plain"]["value"] == "hello"

    def test_reveals_plaintext_when_test_variables_on(self) -> None:
        masking_settings.set_reveal_settings(test_variables=True)
        out = tests_service._reveal_or_mask_secret_variables(self._vars())
        assert out["token"]["value"] == _SECRET
        assert "masked" not in out["token"]

    def test_non_secret_untouched_when_revealed(self) -> None:
        masking_settings.set_reveal_settings(test_variables=True)
        out = tests_service._reveal_or_mask_secret_variables(self._vars())
        assert out["plain"]["value"] == "hello"

    def test_shared_variables_flag_does_not_reveal_test_variables(self) -> None:
        masking_settings.set_reveal_settings(shared_variables=True)
        out = tests_service._reveal_or_mask_secret_variables(self._vars())
        assert out["token"]["value"] == MASK_PLACEHOLDER

    def test_run_output_flag_does_not_reveal_test_variables(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        out = tests_service._reveal_or_mask_secret_variables(self._vars())
        assert out["token"]["value"] == MASK_PLACEHOLDER


class TestSessionVariablePanelGate:
    """The workbench session variable panel gates on test_variables."""

    def test_masks_when_test_variables_off(self) -> None:
        assert workbench_service._mask_session_value(_SECRET, True, _registry()) == MASK_PLACEHOLDER

    def test_reveals_when_test_variables_on(self) -> None:
        masking_settings.set_reveal_settings(test_variables=True)
        assert workbench_service._mask_session_value(_SECRET, True, _registry()) == _SECRET

    def test_run_output_flag_does_not_reveal_session_panel(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert workbench_service._mask_session_value(_SECRET, True, _registry()) == MASK_PLACEHOLDER


class TestSharedVariableEditorGate:
    """The global / regression / suite variable editors gate on shared_variables.
    Revealing is a display-time decrypt; the stored value stays sealed (encryption
    at rest is unaffected)."""

    def test_masks_when_shared_variables_off(self) -> None:
        variables = {"token": {"value": seal_value(_SECRET), "secret": True, "type": "string"}}
        result = variable_service._apply_secret_masking(variables)
        assert result["token"]["value"] == MASK_PLACEHOLDER
        assert result["token"]["masked"] is True

    def test_reveals_plaintext_when_shared_variables_on(self) -> None:
        variables = {"token": {"value": seal_value(_SECRET), "secret": True, "type": "string"}}
        masking_settings.set_reveal_settings(shared_variables=True)
        result = variable_service._apply_secret_masking(variables)
        assert result["token"]["value"] == _SECRET
        assert not result["token"].get("masked")

    def test_non_secret_variable_untouched_when_revealed(self) -> None:
        variables = {"plain": {"value": "hello", "type": "string"}}
        masking_settings.set_reveal_settings(shared_variables=True)
        result = variable_service._apply_secret_masking(variables)
        assert result["plain"]["value"] == "hello"

    def test_test_variables_flag_does_not_reveal_shared_editors(self) -> None:
        variables = {"token": {"value": seal_value(_SECRET), "secret": True, "type": "string"}}
        masking_settings.set_reveal_settings(test_variables=True)
        result = variable_service._apply_secret_masking(variables)
        assert result["token"]["value"] == MASK_PLACEHOLDER

    def test_run_output_flag_does_not_reveal_shared_editors(self) -> None:
        variables = {"token": {"value": seal_value(_SECRET), "secret": True, "type": "string"}}
        masking_settings.set_reveal_settings(run_output=True)
        result = variable_service._apply_secret_masking(variables)
        assert result["token"]["value"] == MASK_PLACEHOLDER


_CRED_PLUGIN_TYPE = "stub-cred-plugin"


class _CredRevealPlugin:
    """Stub plugin declaring one secret input param, for reveal gating."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": _CRED_PLUGIN_TYPE,
            "version": "1.0.0",
            "parameters": [
                {"name": "password", "type": "string", "secret": True},
                {"name": "host", "type": "string"},
            ],
        }


def _cred_workflow() -> dict[str, Any]:
    """A sealed workflow: one credential param + one setter secret literal."""
    from wavecore.core.secrets.sealing import seal_workflow_node_secrets

    return seal_workflow_node_secrets(
        {
            "nodes": [
                {
                    "id": "p1",
                    "type": "workflowNode",
                    "data": {
                        "label": "Cred",
                        "elementType": _CRED_PLUGIN_TYPE,
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {"values": {"password": _SECRET, "host": "example.com"}},
                    },
                },
                {
                    "id": "s1",
                    "type": "workflowNode",
                    "data": {
                        "label": "Set Vars",
                        "elementType": "variable-setter",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "config": {
                            "values": {"variables": {"api_key": _SECRET}},
                            "variableSecretKeys": ["api_key"],
                        },
                    },
                },
            ],
            "edges": [],
        }
    )


class TestCredentialFieldRevealGate:
    """The dedicated credential-inputs unmask flag reveals plugin credential input
    fields on entity reads; setter secrets and encryption at rest are unaffected
    (REQ-3.1.3.18)."""

    @pytest.fixture(autouse=True)
    def _registered_cred_plugin(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        clear_registry()
        register_plugin(_CredRevealPlugin())
        yield
        clear_registry()

    def test_reveal_unseals_credential_param(self) -> None:
        from wavecore.core.secrets.sealing import read_workflow_secrets

        masking_settings.set_reveal_settings(credential_inputs=True)
        revealed = read_workflow_secrets(_cred_workflow())

        assert revealed["nodes"][0]["data"]["config"]["values"]["password"] == _SECRET

    def test_a_read_keeps_the_credential_sealed_while_the_flag_is_off(self) -> None:
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import read_workflow_secrets

        shown = read_workflow_secrets(_cred_workflow())

        assert is_secret_envelope(shown["nodes"][0]["data"]["config"]["values"]["password"])

    def test_reveal_leaves_setter_secret_sealed(self) -> None:
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import read_workflow_secrets

        masking_settings.set_reveal_settings(credential_inputs=True)
        revealed = read_workflow_secrets(_cred_workflow())

        setter_vars = revealed["nodes"][1]["data"]["config"]["values"]["variables"]
        assert is_secret_envelope(setter_vars["api_key"])

    def test_reveal_does_not_mutate_input(self) -> None:
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import read_workflow_secrets

        masking_settings.set_reveal_settings(credential_inputs=True)
        workflow = _cred_workflow()
        read_workflow_secrets(workflow)

        assert is_secret_envelope(workflow["nodes"][0]["data"]["config"]["values"]["password"])

    def _saved_test_id(self) -> str:
        import uuid
        from datetime import UTC, datetime

        from wavecore.api.services.tests import service as test_service

        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        test_service._save_test(
            {
                "id": test_id,
                "name": "cred reveal gate",
                "version": "1.0.0",
                "description": "",
                "workflow": _cred_workflow(),
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )
        return test_id

    def test_get_test_keeps_envelope_when_credential_inputs_off(self) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.core.secrets.cipher import is_secret_envelope

        fetched = test_service.get_test(self._saved_test_id())

        assert fetched is not None
        value = fetched["workflow"]["nodes"][0]["data"]["config"]["values"]["password"]
        assert is_secret_envelope(value)

    def test_get_test_reveals_plaintext_when_credential_inputs_on(self) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.core.secrets.cipher import is_secret_envelope

        test_id = self._saved_test_id()
        masking_settings.set_reveal_settings(credential_inputs=True)

        fetched = test_service.get_test(test_id)

        assert fetched is not None
        values = fetched["workflow"]["nodes"][0]["data"]["config"]["values"]
        assert values["password"] == _SECRET
        assert values["host"] == "example.com"
        # Display-time decrypt only: the stored file keeps the envelope.
        raw = test_service._load_test(test_id)
        assert raw is not None
        assert is_secret_envelope(
            raw["workflow"]["nodes"][0]["data"]["config"]["values"]["password"]
        )

    def test_test_variables_flag_does_not_reveal_credential_fields(self) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.core.secrets.cipher import is_secret_envelope

        test_id = self._saved_test_id()
        masking_settings.set_reveal_settings(test_variables=True)

        fetched = test_service.get_test(test_id)

        assert fetched is not None
        value = fetched["workflow"]["nodes"][0]["data"]["config"]["values"]["password"]
        assert is_secret_envelope(value)

    def test_run_output_flag_does_not_reveal_credential_fields(self) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.core.secrets.cipher import is_secret_envelope

        test_id = self._saved_test_id()
        masking_settings.set_reveal_settings(run_output=True)

        fetched = test_service.get_test(test_id)

        assert fetched is not None
        value = fetched["workflow"]["nodes"][0]["data"]["config"]["values"]["password"]
        assert is_secret_envelope(value)

    def test_get_test_workflow_keeps_envelope_when_off(self) -> None:
        from wavecore.api.services.tests import service as test_service
        from wavecore.core.secrets.cipher import is_secret_envelope

        workflow = test_service.get_test_workflow(self._saved_test_id())

        assert workflow is not None
        value = workflow["nodes"][0]["data"]["config"]["values"]["password"]
        assert is_secret_envelope(value)

    def test_get_test_workflow_reveals_when_credential_inputs_on(self) -> None:
        from wavecore.api.services.tests import service as test_service

        test_id = self._saved_test_id()
        masking_settings.set_reveal_settings(credential_inputs=True)

        workflow = test_service.get_test_workflow(test_id)

        assert workflow is not None
        assert workflow["nodes"][0]["data"]["config"]["values"]["password"] == _SECRET


class TestProfileCredentialReveal:
    """Row `Global/regression/suite var editors`: profiles reveal under the SAME
    `shared_variables` flag - get_profile masks the sealed credential by default and
    reveals its plaintext when the flag is on. Encryption at rest is unaffected."""

    def _stored(self) -> tuple[str, dict[str, Any]]:
        profile_id = str(uuid.uuid4())
        storage = {
            profile_id: {
                "id": profile_id,
                "name": "db",
                "type": "database",
                "config": {"host": "localhost", "password": seal_value(_SECRET)},
            }
        }
        return profile_id, storage

    def _get(self, reveal: bool) -> dict[str, Any]:
        from wavecore.api.services.profiles import _common as profile_common
        from wavecore.api.services.profiles import service as profile_service

        profile_id, storage = self._stored()
        if reveal:
            masking_settings.set_reveal_settings(shared_variables=True)
        # Write the file too: the storage directory is the record, and a read
        # drops a cached profile whose file is gone.
        profile_common._save_profile(dict(storage[profile_id]))
        with (
            patch.object(profile_common, "_profile_storage", storage),
            patch.object(profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile(profile_id)
        assert result is not None
        return result

    def test_masks_sealed_credential_when_shared_off(self) -> None:
        result = self._get(reveal=False)
        assert result["config"]["password"] == MASK_PLACEHOLDER

    def test_reveals_plaintext_when_shared_on(self) -> None:
        result = self._get(reveal=True)
        assert result["config"]["password"] == _SECRET

    def test_non_secret_field_untouched_when_shared_on(self) -> None:
        result = self._get(reveal=True)
        assert result["config"]["host"] == "localhost"
