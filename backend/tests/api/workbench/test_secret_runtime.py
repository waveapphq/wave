"""Runtime secret registration and masking through the workbench engine.

Covers REQ-3.1.3.5 / REQ-4.5.3:
- secret system variables inject RAW and register
- values resolved into secret-declared input params register run-wide
- secret-declared plugin outputs mark + register the receiving variable
- the per-block ``secret_masking="reveal"`` config option exempts only that
  node's own log lines
- breakpoint / completion error texts are value-scrubbed
- the proxy password in force when a run starts registers run-wide (REQ-4.7.14)
"""

import os
import uuid
from collections.abc import Callable, Generator
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest

from tests.api.services.workbench.parallel_harness import edge, for_each_node
from tests.api.workbench.conftest import make_test_record
from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import execution as wb_execution
from wavecore.api.services.workbench import plugins as wb_plugins
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.secrets.sealing import seal_value


def _make_registry(*, with_token: bool = False) -> Any:
    from wavecore.core.secrets.registry import SecretRegistry

    registry = SecretRegistry()
    if with_token:
        registry.register("token", "s3cr3t-t0ken-99", "declared")
    return registry


def _prime_session(registry: Any, *, secret_names: list[str] | None = None) -> str:
    session_id = str(uuid.uuid4())
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "status": "running",
        "test_id": str(uuid.uuid4()),
        "user_id": wb_common.DEFAULT_USER_ID,
        "current_block": None,
        "progress": {"current": 0, "total": 1, "percentage": 0.0},
        "block_states": {},
        "variables": {},
        "secret_variable_names": secret_names or [],
        "secret_registry": registry,
    }
    return session_id


class TestSystemVariableInjection:
    """Secret system variables inject RAW into the run context."""

    @pytest.fixture(autouse=True)
    def _reset_variable_service(self) -> Generator[None, None, None]:
        from wavecore.api.services import variable_service

        variable_service._variable_storage.clear()
        variable_service._watch_storage.clear()
        variable_service._system_cache_loaded = False
        yield
        variable_service._variable_storage.clear()
        variable_service._system_cache_loaded = False

    @staticmethod
    def _seed_system_vars() -> None:
        from wavecore.api.services import variable_service

        variable_service.set_system_variables(
            {
                "api_token": {
                    "type": "string",
                    "value": "sys-s3cr3t-t0ken",
                    "secret": True,
                },
                "region": {"type": "string", "value": "us-west-2"},
            }
        )

    def test_secret_system_variable_injects_its_real_value(self) -> None:
        self._seed_system_vars()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(variables)

        assert variables["system.api_token"] == "sys-s3cr3t-t0ken"
        assert variables["system.region"] == "us-west-2"

    def test_secret_system_value_registers_in_the_run_registry(self) -> None:
        self._seed_system_vars()
        registry = _make_registry()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(variables, registry=registry)

        assert "sys-s3cr3t-t0ken" in registry.scan_values()

    def test_non_secret_system_values_do_not_register(self) -> None:
        self._seed_system_vars()
        registry = _make_registry()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(variables, registry=registry)

        assert "us-west-2" not in registry.scan_values()


class TestSuiteVariableInjection:
    """Suite scope: secret suite variables inject RAW and register."""

    @pytest.fixture(autouse=True)
    def _clear_suites(self) -> Generator[None, None, None]:
        from tests.api.suite_test_helpers import clear_suite_storage

        clear_suite_storage()
        yield
        clear_suite_storage()

    @staticmethod
    def _seed_suite() -> str:
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Secret Suite",
                "variables": {
                    "api_token": {
                        "type": "string",
                        "value": "suite-s3cr3t-t0ken",
                        "secret": True,
                    },
                    "region": {"type": "string", "value": "eu-central-1"},
                },
            }
        )
        return str(suite["id"])

    def test_secret_suite_variable_injects_its_real_value(self) -> None:
        suite_id = self._seed_suite()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(
            variables, test_id=str(uuid.uuid4()), suite_id=suite_id
        )

        assert variables["suite.api_token"] == "suite-s3cr3t-t0ken"
        assert variables["suite.region"] == "eu-central-1"

    def test_secret_suite_value_registers_in_the_run_registry(self) -> None:
        suite_id = self._seed_suite()
        registry = _make_registry()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(
            variables, test_id=str(uuid.uuid4()), suite_id=suite_id, registry=registry
        )

        assert "suite-s3cr3t-t0ken" in registry.scan_values()
        assert registry.is_secret_name("suite.api_token") is True

    def test_non_secret_suite_values_do_not_register(self) -> None:
        suite_id = self._seed_suite()
        registry = _make_registry()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(
            variables, test_id=str(uuid.uuid4()), suite_id=suite_id, registry=registry
        )

        assert "eu-central-1" not in registry.scan_values()
        assert registry.is_secret_name("suite.region") is False


class TestRegressionVariableInjection:
    """Regression scope: secret regression variables inject RAW and register."""

    @pytest.fixture(autouse=True)
    def _clear_regressions(self) -> Generator[None, None, None]:
        from tests.api.regression_test_helpers import clear_regression_storage

        clear_regression_storage()
        yield
        clear_regression_storage()

    @staticmethod
    def _seed_regression() -> str:
        from wavecore.api.services.regressions import service as regression_service

        regression = regression_service.create_regression(
            {
                "name": "Secret Regression",
                "suites": [],
                "variables": {
                    "api_token": {
                        "type": "string",
                        "value": "regr-s3cr3t-t0ken",
                        "secret": True,
                    },
                    "region": {"type": "string", "value": "ap-south-1"},
                },
            }
        )
        return str(regression["id"])

    def test_secret_regression_variable_injects_its_real_value(self) -> None:
        regression_id = self._seed_regression()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(
            variables, test_id=str(uuid.uuid4()), regression_id=regression_id
        )

        assert variables["regression.api_token"] == "regr-s3cr3t-t0ken"
        assert variables["regression.region"] == "ap-south-1"

    def test_secret_regression_value_registers_in_the_run_registry(self) -> None:
        regression_id = self._seed_regression()
        registry = _make_registry()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(
            variables,
            test_id=str(uuid.uuid4()),
            regression_id=regression_id,
            registry=registry,
        )

        assert "regr-s3cr3t-t0ken" in registry.scan_values()
        assert registry.is_secret_name("regression.api_token") is True

    def test_non_secret_regression_values_do_not_register(self) -> None:
        regression_id = self._seed_regression()
        registry = _make_registry()
        variables: dict[str, Any] = {}

        wb_plugins._inject_namespace_variables(
            variables,
            test_id=str(uuid.uuid4()),
            regression_id=regression_id,
            registry=registry,
        )

        assert "ap-south-1" not in registry.scan_values()
        assert registry.is_secret_name("regression.region") is False


class TestProfileCredentialInjection:
    """Profile credentials inject RAW and register with the run registry."""

    @pytest.fixture(autouse=True)
    def _reset_profiles(self) -> Generator[None, None, None]:
        from wavecore.api.services.profiles import _common as profile_common

        profile_common._clear_in_memory_cache()
        yield
        profile_common._clear_in_memory_cache()

    @staticmethod
    def _seed_profile() -> str:
        from wavecore.api.services.profiles import service as profile_service

        created = profile_service.create_profile(
            name="run profile",
            profile_type="http",
            config={
                "base_url": "https://api.example.com",
                "api_key": "prof-s3cr3t-key-77",
                "extra_token": {
                    "type": "string",
                    "value": "typed-s3cr3t-88",
                    "secret": True,
                },
            },
        )
        return str(created["id"])

    @staticmethod
    def _bindings(profile_id: str) -> list[dict[str, Any]]:
        return [
            {
                "profileId": profile_id,
                "alias": "creds",
                "profileName": "run profile",
                "profileType": "http",
            }
        ]

    def test_profile_credentials_inject_raw_values(self) -> None:
        profile_id = self._seed_profile()
        session_id = _prime_session(_make_registry())
        variables: dict[str, Any] = {}

        wb_plugins._inject_profile_variables(self._bindings(profile_id), variables, "", session_id)

        assert variables["creds.api_key"] == "prof-s3cr3t-key-77"
        assert variables["creds.base_url"] == "https://api.example.com"

    def test_secret_profile_fields_register_in_the_run_registry(self) -> None:
        profile_id = self._seed_profile()
        registry = _make_registry()
        session_id = _prime_session(registry)
        variables: dict[str, Any] = {}

        wb_plugins._inject_profile_variables(self._bindings(profile_id), variables, "", session_id)

        assert "prof-s3cr3t-key-77" in registry.scan_values()
        assert registry.is_secret_name("creds.api_key") is True

    def test_typed_secret_custom_param_registers(self) -> None:
        profile_id = self._seed_profile()
        registry = _make_registry()
        session_id = _prime_session(registry)
        variables: dict[str, Any] = {}

        wb_plugins._inject_profile_variables(self._bindings(profile_id), variables, "", session_id)

        assert "typed-s3cr3t-88" in registry.scan_values()

    def test_non_secret_profile_fields_do_not_register(self) -> None:
        profile_id = self._seed_profile()
        registry = _make_registry()
        session_id = _prime_session(registry)
        variables: dict[str, Any] = {}

        wb_plugins._inject_profile_variables(self._bindings(profile_id), variables, "", session_id)

        assert "https://api.example.com" not in registry.scan_values()
        assert registry.is_secret_name("creds.base_url") is False

    def test_environment_override_credential_registers(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        created = profile_service.create_profile(
            name="env profile",
            profile_type="http",
            config={"api_key": "base-s3cr3t-11"},
            environment_values={"env-1": {"api_key": "env-s3cr3t-22"}},
        )
        registry = _make_registry()
        session_id = _prime_session(registry)
        variables: dict[str, Any] = {}

        wb_plugins._inject_profile_variables(
            self._bindings(str(created["id"])), variables, "env-1", session_id
        )

        assert variables["creds.api_key"] == "env-s3cr3t-22"
        assert "env-s3cr3t-22" in registry.scan_values()


class _SecretParamPlugin:
    """Stub plugin declaring one secret parameter."""

    def __init__(self) -> None:
        self.context: dict[str, Any] | None = None

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "stub-secret-param",
            "parameters": [
                {"name": "token", "type": "string", "secret": True},
                {"name": "plain", "type": "string"},
            ],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        self.context = context
        return {"ok": True}

    async def cleanup(self) -> None:
        pass


class TestInputParamSecretRegistration:
    """A value resolved into a secret-declared param registers run-wide, so
    the byte-form scrubs on every surface, not just the Inputs display line."""

    async def test_plugin_param_literal_registers(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        plugin = _SecretParamPlugin()

        await wb_plugins._execute_plugin_with_session(
            plugin,
            "stub-secret-param",
            {"token": "tok-s3cr3t-l1teral", "plain": "hello world"},
            {},
            session_id,
            None,
            None,
            None,
            None,
        )

        assert "tok-s3cr3t-l1teral" in registry.scan_values()
        assert "hello world" not in registry.scan_values()

    async def test_plugin_param_registers_even_when_block_reveals(self) -> None:
        """Reveal is a per-block display choice; registration is run-wide."""
        registry = _make_registry()
        session_id = _prime_session(registry)
        plugin = _SecretParamPlugin()

        await wb_plugins._execute_plugin_with_session(
            plugin,
            "stub-secret-param",
            {"token": "tok-s3cr3t-l1teral", "plain": "hello world"},
            {},
            session_id,
            None,
            None,
            None,
            None,
            reveal_secrets=True,
        )

        assert "tok-s3cr3t-l1teral" in registry.scan_values()

    async def test_control_param_literal_registers(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)

        mock_control = AsyncMock()
        mock_control.metadata = {
            "id": "delay",
            "parameter_schema": [
                {"name": "password", "type": "string", "secret": True},
                {"name": "duration", "type": "string"},
            ],
        }
        mock_control.execute.return_value = {"ok": True}

        with patch(
            "wavecore.controls.registry.get_control_implementation",
            return_value=lambda: mock_control,
        ):
            await wb_plugins._execute_control(
                control_type="delay",
                version="1.0.0",
                parameters={"password": "hunter2secret", "duration": "10ms"},
                variables={},
                session_id=session_id,
            )

        assert "hunter2secret" in registry.scan_values()
        assert "10ms" not in registry.scan_values()


class TestVariableSetterSecretSeeding:
    """A variable marked secret ONLY on a Variable Setter row (not in the
    Variable Manager) reaches the run registry: run setup seeds the setter's
    secret names, so the setter's own write registers the value run-wide."""

    @staticmethod
    def _setter_node(secret_keys: list[str], variables: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": "setter-1",
            "type": "workflowNode",
            "data": {
                "label": "Set Vars",
                "elementType": "variable-setter",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {
                    "values": {"variables": variables},
                    "variableSecretKeys": secret_keys,
                },
            },
        }

    def test_run_registry_marks_setter_secret_names(self) -> None:
        nodes = [self._setter_node(["token"], {"token": "sk-literal"})]

        registry = workbench_service._build_run_secret_registry(
            workbench_service._collect_run_secret_names({}, nodes),
            {},
        )

        assert registry.is_secret_name("token") is True

    def test_unset_secret_registers_no_scrub_token(self) -> None:
        """A secret with no value holds the null start, which has nothing to protect:
        no scan form comes from it, so no "0" or empty text in the run is scrubbed."""
        raw_variables = {"count": {"type": "integer", "secret": True}}
        literals, _expr, _tmpl = workbench_service._flatten_variables(raw_variables)

        registry = workbench_service._build_run_secret_registry(
            workbench_service._collect_run_secret_names(raw_variables, []),
            literals,
        )

        assert registry.is_secret_name("count") is True
        assert registry.scan_values() == ()

    def test_filled_secret_still_registers_its_value(self) -> None:
        raw_variables = {"token": {"type": "string", "value": "sk-literal", "secret": True}}
        literals, _expr, _tmpl = workbench_service._flatten_variables(raw_variables)

        registry = workbench_service._build_run_secret_registry(
            workbench_service._collect_run_secret_names(raw_variables, []),
            literals,
        )

        assert "sk-literal" in registry.scan_values()

    def test_declared_plain_variable_still_marked_by_setter(self) -> None:
        raw_variables = {"token": {"type": "string", "value": "", "secret": False}}
        nodes = [self._setter_node(["token"], {"token": "sk-literal"})]

        names = workbench_service._collect_run_secret_names(raw_variables, nodes)

        assert "token" in names

    async def test_setter_write_registers_value_through_lazy_wrapper(self) -> None:
        """With the name seeded secret, the production LazyVariables write path
        registers the setter's runtime value for run-wide scrubbing."""
        from wavecore.api.services.workbench.lazy_variables import LazyVariables
        from wavecore.controls.variable_setter import VariableSetterControl

        registry = _make_registry()
        registry.mark_name("token")
        session_id = _prime_session(registry, secret_names=["token"])
        variables = LazyVariables({"token": "placeholder"}, secret_registry=registry)

        control = VariableSetterControl()
        with patch(
            "wavecore.controls.registry.get_control_implementation",
            return_value=lambda: control,
        ):
            await wb_plugins._execute_control(
                control_type="variable-setter",
                version="1.0.0",
                parameters={"variables": {"token": "hunter2-runtime-secret"}},
                variables=variables,
                session_id=session_id,
            )

        assert "hunter2-runtime-secret" in registry.scan_values()


class TestS10CredentialRegistration:
    """Direct coverage of the credential-registration helpers: the per-field
    reveal exemption, the remote response-cred registration, and the run-registry
    seeding of plugin-declared credential literals."""

    def test_revealed_declared_param_registers_with_block_exemption(self) -> None:
        registry = _make_registry()
        metadata = {"parameters": [{"name": "token", "secret": True}, {"name": "plain"}]}

        wb_plugins._register_revealed_param_exemptions(
            {"token": "tok-s3cr3t", "plain": "hi"}, metadata, ["token"], registry, "block-1"
        )

        # Registered run-wide even when revealed (other blocks still scrub it).
        assert "tok-s3cr3t" in registry.scan_values()

    def test_remote_response_credentials_noop_without_a_catalog(self) -> None:
        from wavecore.api.services.workbench import remote_exec

        registry = _make_registry()
        # A plugin with no `secret_mask_fields` has an empty catalog -> early return.
        remote_exec._register_remote_response_credentials(
            {"resp": {"set-cookie": "c"}}, {}, [], registry, "block-1"
        )

        assert registry.scan_values() == ()

    def test_run_registry_seeds_plugin_credential_literals(self) -> None:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        class _CredRuntimePlugin:
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "stub-cred-runtime",
                    "version": "1.0.0",
                    "parameters": [{"name": "password", "type": "string", "secret": True}],
                }

        node = {
            "id": "c1",
            "data": {
                "elementType": "stub-cred-runtime",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {"values": {"password": "pw-classified", "host": "h"}},
            },
        }

        clear_registry()
        try:
            register_plugin(_CredRuntimePlugin())
            registry = workbench_service._build_run_secret_registry([], {}, nodes=[node])
        finally:
            clear_registry()

        assert "pw-classified" in registry.scan_values()


class TestSecretSchemaExtraction:
    """Secret outputs seed from model as well as dict output schemas; the input-parameter
    reader (_extract_secret_fields) does not exist."""

    def test_there_is_no_extract_secret_fields_helper(self) -> None:
        assert not hasattr(wb_plugins, "_extract_secret_fields")

    def test_secret_outputs_seed_from_output_field_models_when_none_are_marked(self) -> None:
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.models.plugins import OutputField

        class _ModelSchemaPlugin(_SecretOutputPlugin):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "model-schema-plugin",
                    "version": "1.0.0",
                    "output_schema": [
                        OutputField(name="token_out", type="string", secret=True),
                        OutputField(name="status", type="integer"),
                    ],
                }

        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = {
            "output_bindings": {"token_out": "captured", "status": "code"},
            "element_type": "model-schema-plugin",
            "version": "1.0.0",
        }
        clear_registry()
        try:
            register_plugin(_ModelSchemaPlugin())
            wb_plugins._register_secret_outputs(
                node_fields, {"token_out": "m0del-t0ken-77", "status": 200}, session_id
            )
        finally:
            clear_registry()

        assert registry.is_secret_name("captured") is True
        assert registry.is_secret_name("code") is False
        assert registry.scan_values() == ("m0del-t0ken-77",)

    def test_an_unknown_plugin_seeds_no_secret_outputs(self) -> None:
        from wavecore.core.plugin_registry import clear_registry

        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = {
            "output_bindings": {"token_out": "captured"},
            "element_type": "missing-plugin",
            "version": "9.9.9",
        }
        clear_registry()

        wb_plugins._register_secret_outputs(node_fields, {"token_out": "t0k-x"}, session_id)

        assert registry.scan_values() == ()
        assert registry.is_secret_name("captured") is False

    def test_register_secret_outputs_ignores_non_dict_results(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = {
            "output_bindings": {"token_out": "captured"},
            "element_type": "secret-output-plugin",
            "version": "1.0.0",
        }

        wb_plugins._register_secret_outputs(node_fields, "plain text result", session_id)

        assert registry.scan_values() == ()
        assert registry.is_secret_name("captured") is False


class _SecretOutputPlugin:
    """Stub plugin declaring a secret output field."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "secret-output-plugin",
            "name": "Secret Output Plugin",
            "version": "1.0.0",
            "category": "system",
            "description": "Emits a credential output",
            "parameters": [],
            "return_type": None,
            "output_schema": [
                {"name": "token_out", "type": "string", "secret": True},
                {"name": "status", "type": "integer"},
            ],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        return {"token_out": "tok-fr0m-res0lt-99", "status": 200}

    async def cleanup(self) -> None:
        pass


class TestSecretOutputPropagation:
    """A secret-declared output marks + registers the receiving variable."""

    @pytest.fixture(autouse=True)
    def _register_plugins(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        clear_registry()
        register_plugin(_SecretOutputPlugin())
        yield
        clear_registry()

    @staticmethod
    def _nodes(node_id: str) -> list[dict[str, Any]]:
        return [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Login",
                    "elementType": "secret-output-plugin",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {},
                        "outputBindings": {
                            "token_out": "captured_token",
                            "status": "code",
                        },
                    },
                },
            },
        ]

    async def test_secret_output_marks_and_registers_receiving_variable(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_id = "login-node"
        variables: dict[str, Any] = {}

        await workbench_service._execute_workflow(
            session_id,
            self._nodes(node_id),
            [{"source": "start-node", "target": node_id}],
            variables,
        )

        assert variables["captured_token"] == "tok-fr0m-res0lt-99"
        assert registry.is_secret_name("captured_token") is True
        assert "tok-fr0m-res0lt-99" in registry.scan_values()
        assert registry.is_secret_name("code") is False
        assert variables["code"] == 200

    async def test_receiving_variable_is_masked_in_session_variable_reads(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_id = "login-node"
        variables: dict[str, Any] = {}

        await workbench_service._execute_workflow(
            session_id,
            self._nodes(node_id),
            [{"source": "start-node", "target": node_id}],
            variables,
        )

        result = workbench_service.get_session_variables(session_id)

        assert result["variables"]["captured_token"] == {
            "value": "********",
            "type": "string",
        }
        assert result["variables"]["code"] == {"value": 200, "type": "integer"}


class TestUnmaskSecretsNodeOption:
    """secret_masking="reveal" exempts ONLY the declaring node's own lines."""

    @pytest.fixture(autouse=True)
    def _register_plugins(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        clear_registry()
        register_plugin(LogPlugin())
        yield
        clear_registry()

    @staticmethod
    def _log_node(node_id: str, message_expr: str, *, unmask: bool = False) -> dict[str, Any]:
        config: dict[str, Any] = {
            "values": {"message": message_expr, "level": "INFO"},
            "profileBindings": [],
            "outputBindings": {},
        }
        if unmask:
            config["secret_masking"] = "reveal"
        return {
            "id": node_id,
            "type": "workflowNode",
            "data": {
                "label": f"Log {node_id}",
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": config,
                "expressionFields": ["message"],
                "templateFields": [],
                "variableExpressionKeys": [],
            },
        }

    async def test_unmask_node_logs_raw_while_other_nodes_stay_masked(self) -> None:
        registry = _make_registry(with_token=True)
        registry.mark_name("token")
        session_id = _prime_session(registry, secret_names=["token"])
        log_streaming_service.register_secret_registry(session_id, registry)

        nodes = [
            self._log_node("node-a", "'A ' + token", unmask=True),
            self._log_node("node-b", "'B ' + token"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
        ]
        variables: dict[str, Any] = {"token": "s3cr3t-t0ken-99"}

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        logs = log_streaming_service.get_logs(session_id)
        node_a_lines = [
            e["message"]
            for e in logs
            if e.get("blockId") == "node-a" and e.get("source") == "Log : Log node-a"
        ]
        node_b_lines = [
            e["message"]
            for e in logs
            if e.get("blockId") == "node-b" and e.get("source") == "Log : Log node-b"
        ]

        # The reveal node shows its secret raw in every line (message + harness
        # Inputs/Outputs); the masked node shows the placeholder and never leaks.
        assert "A s3cr3t-t0ken-99" in node_a_lines
        assert not any("********" in line for line in node_a_lines)
        assert "B ********" in node_b_lines
        assert not any("s3cr3t-t0ken-99" in line for line in node_b_lines)

    async def test_default_nodes_log_masked(self) -> None:
        registry = _make_registry(with_token=True)
        session_id = _prime_session(registry, secret_names=["token"])
        log_streaming_service.register_secret_registry(session_id, registry)

        nodes = [self._log_node("node-only", "'value: ' + token")]
        edges = [{"source": "start-node", "target": "node-only"}]
        variables: dict[str, Any] = {"token": "s3cr3t-t0ken-99"}

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        logs = log_streaming_service.get_logs(session_id)
        plugin_lines = [
            e["message"]
            for e in logs
            if e.get("blockId") == "node-only" and e.get("source") == "Log : Log node-only"
        ]

        # Masked across every line the node emits (message + harness Inputs/Outputs).
        assert "value: ********" in plugin_lines
        assert not any("s3cr3t-t0ken-99" in line for line in plugin_lines)


class TestErrorTextScrubbing:
    """Breakpoint and completion error texts are value-scrubbed."""

    async def test_breakpoint_exception_message_is_scrubbed(self) -> None:
        registry = _make_registry(with_token=True)
        session_id = _prime_session(registry)

        with patch.object(wb_common, "_broadcast_event", new=AsyncMock()) as mock_broadcast:
            await wb_common._emit_breakpoint_hit(
                session_id,
                "node-1",
                "HTTP Request",
                "error",
                ValueError("rejected s3cr3t-t0ken-99"),
            )

        event = mock_broadcast.call_args[0][1]
        assert event["type"] == "debug_breakpoint_hit"
        assert event["exception_message"] == "rejected ********"

    async def test_execution_completed_error_text_is_scrubbed(self) -> None:
        registry = _make_registry(with_token=True)
        session_id = _prime_session(registry)
        log_streaming_service.register_secret_registry(session_id, registry)
        session = wb_common._workbench_sessions[session_id]

        with patch.object(wb_common, "_broadcast_event", new=AsyncMock()) as mock_broadcast:
            await wb_execution._handle_workflow_error(
                session,
                session_id,
                "My Test",
                RuntimeError("boom s3cr3t-t0ken-99"),
            )

        completed = [
            call.args[1]
            for call in mock_broadcast.call_args_list
            if call.args[1].get("type") == "execution_completed"
        ]
        assert completed == [
            {"type": "execution_completed", "status": "failed", "error": "boom ********"}
        ]

        stored = log_streaming_service.get_logs(session_id)
        failure_lines = [e["message"] for e in stored if "execution failed" in e["message"]]
        assert failure_lines == ["Test 'My Test' execution failed: boom ********"]


class _CapturingPlugin:
    """Stub plugin that records the execution context it receives."""

    def __init__(self) -> None:
        self.context: dict[str, Any] | None = None

    @property
    def metadata(self) -> dict[str, Any]:
        return {"id": "capturing-plugin", "parameters": []}

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        self.context = context
        return {"ok": True}

    async def cleanup(self) -> None:
        pass


class TestPerFieldRevealContextThreading:
    """REQ-3.1.3.16: the per-block reveal set reaches the plugin's execution
    context as ``unmasked_secret_fields``. Fails unless the kwarg is threaded
    through _execute_plugin_with_session into the context."""

    async def test_execute_plugin_with_session_sets_unmasked_secret_fields(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        plugin = _CapturingPlugin()

        await wb_plugins._execute_plugin_with_session(
            plugin,
            "capturing-plugin",
            {},
            {},
            session_id,
            None,
            None,
            None,
            None,
            unmasked_secret_fields=["set-cookie"],
        )

        assert plugin.context is not None
        assert plugin.context["unmasked_secret_fields"] == ["set-cookie"]

    async def test_execute_plugin_with_session_defaults_reveal_set_to_empty(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        plugin = _CapturingPlugin()

        await wb_plugins._execute_plugin_with_session(
            plugin,
            "capturing-plugin",
            {},
            {},
            session_id,
            None,
            None,
            None,
            None,
        )

        assert plugin.context is not None
        assert plugin.context["unmasked_secret_fields"] == []


class TestHttpNodeRevealEndToEnd:
    """REQ-3.1.3.16 full chain: a node's ``config.unmasked_secret_fields`` flows
    (extract -> execute_node -> execute_plugin -> context -> plugin). The
    credential registers run-wide either way; revealing a field only exempts
    THIS block's own display lines, never any other block."""

    _TOKEN = "session=tok-c00kie-s3ss10n-99; Path=/; HttpOnly"

    @pytest.fixture(autouse=True)
    def _register_http(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.http_client import HTTPClientPlugin

        clear_registry()
        register_plugin(HTTPClientPlugin())
        yield
        clear_registry()

    @staticmethod
    def _http_node(
        node_id: str, *, unmasked_secret_fields: list[str] | None = None
    ) -> dict[str, Any]:
        config: dict[str, Any] = {
            "values": {"method": "GET", "url": "http://example.com"},
            "outputBindings": {},
        }
        if unmasked_secret_fields is not None:
            config["unmasked_secret_fields"] = unmasked_secret_fields
        return {
            "id": node_id,
            "type": "workflowNode",
            "data": {
                "label": "HTTP",
                "elementType": "http-client",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": config,
                "expressionFields": [],
                "templateFields": [],
            },
        }

    @classmethod
    def _mock_client(cls) -> Any:
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.reason_phrase = "OK"
        mock_response.headers = {"Content-Type": "text/plain", "Set-Cookie": cls._TOKEN}
        mock_response.text = "OK"
        mock_response.content = b"OK"
        mock_response.url = "http://example.com/"

        mock_client = AsyncMock()
        mock_client.request = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        return mock_client

    async def test_default_http_node_registers_response_credential(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)

        with patch("httpx.AsyncClient", return_value=self._mock_client()):
            await workbench_service._execute_workflow(
                session_id,
                [self._http_node("http-a")],
                [{"source": "start-node", "target": "http-a"}],
                {},
            )

        assert self._TOKEN in registry.scan_values()

    async def test_revealed_http_node_registers_with_own_block_exemption(self) -> None:
        """The revealed credential scrubs everywhere except this block's lines."""
        registry = _make_registry()
        session_id = _prime_session(registry)

        with patch("httpx.AsyncClient", return_value=self._mock_client()):
            await workbench_service._execute_workflow(
                session_id,
                [self._http_node("http-a", unmasked_secret_fields=["set-cookie"])],
                [{"source": "start-node", "target": "http-a"}],
                {},
            )

        assert self._TOKEN in registry.scan_values()
        assert self._TOKEN not in registry.scan_values(exclude_for_block="http-a")
        assert self._TOKEN in registry.scan_values(exclude_for_block="other-block")


class _ScalarCredPlugin:
    """Stub plugin declaring a scalar credential param that also sits in the
    per-field masking catalog (the SSH password/private_key/passphrase
    shape: a declared secret scalar param listed in ``secret_mask_fields``)."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "stub-scalar-cred",
            "parameters": [
                {"name": "password", "type": "string", "secret": True},
                {"name": "host", "type": "string"},
            ],
            "secret_mask_fields": ["password"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    async def cleanup(self) -> None:
        pass


class TestScalarCredentialFieldReveal:
    """A declared SCALAR credential param honors the block's per-field reveal
    set in the masked Inputs line (REQ-3.1.3.16)."""

    _PW = "pw-s3cr3t-scalar"

    @staticmethod
    def _inputs_line(session_id: str) -> str | None:
        for entry in log_streaming_service.get_logs(session_id):
            if entry["message"].startswith("Inputs: "):
                return entry["message"]
        return None

    async def _run(
        self,
        *,
        unmasked_secret_fields: list[str] | None = None,
        reveal_secrets: bool = False,
    ) -> str:
        registry = _make_registry()
        session_id = _prime_session(registry)
        await wb_plugins._execute_plugin_with_session(
            _ScalarCredPlugin(),
            "stub-scalar-cred",
            {"password": self._PW, "host": "example.com"},
            {},
            session_id,
            None,
            None,
            None,
            None,
            reveal_secrets=reveal_secrets,
            unmasked_secret_fields=unmasked_secret_fields,
        )
        return session_id

    async def test_scalar_credential_masked_in_inputs_by_default(self) -> None:
        line = self._inputs_line(await self._run())

        assert line is not None
        assert self._PW not in line
        assert "********" in line
        assert "example.com" in line

    async def test_scalar_credential_revealed_when_in_unmasked_secret_fields(self) -> None:
        line = self._inputs_line(await self._run(unmasked_secret_fields=["password"]))

        assert line is not None
        assert self._PW in line

    async def test_scalar_reveal_matches_field_case_insensitively(self) -> None:
        line = self._inputs_line(await self._run(unmasked_secret_fields=["PASSWORD"]))

        assert line is not None
        assert self._PW in line

    async def test_block_reveal_shows_scalar_credential_raw(self) -> None:
        line = self._inputs_line(await self._run(reveal_secrets=True))

        assert line is not None
        assert self._PW in line

    async def test_revealed_scalar_secret_is_exempt_from_the_block_scrub(self) -> None:
        # A per-field-revealed declared secret must be registered EXEMPT for its
        # block (not plain), else "plain wins" re-masks it at the chokepoint /
        # persisted copy in production - so the reveal only works in the display.
        registry = _make_registry()
        session_id = _prime_session(registry)
        await wb_plugins._execute_plugin_with_session(
            _ScalarCredPlugin(),
            "stub-scalar-cred",
            {"password": self._PW, "host": "example.com"},
            {},
            session_id,
            "blk-1",
            None,
            None,
            None,
            unmasked_secret_fields=["password"],
        )

        assert self._PW not in registry.scan_values(exclude_for_block="blk-1")
        assert self._PW in registry.scan_values()


class TestSecretOutputOverride:
    """The per-block outputs-table choice overrides the schema seed: a stored
    empty list reveals the declared output end to end; an absent stored list
    keeps the seed (covered by TestSecretOutputPropagation)."""

    @pytest.fixture(autouse=True)
    def _register_plugins(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        clear_registry()
        register_plugin(_SecretOutputPlugin())
        yield
        clear_registry()

    @staticmethod
    def _nodes(node_id: str) -> list[dict[str, Any]]:
        return [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Login",
                    "elementType": "secret-output-plugin",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {},
                        "outputBindings": {"token_out": "captured_token"},
                        "outputSecretFields": [],
                    },
                },
            },
        ]

    async def test_unchecked_declared_output_variable_stays_plain(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_id = "login-node"
        variables: dict[str, Any] = {}

        await workbench_service._execute_workflow(
            session_id,
            self._nodes(node_id),
            [{"source": "start-node", "target": node_id}],
            variables,
        )

        assert variables["captured_token"] == "tok-fr0m-res0lt-99"
        assert registry.is_secret_name("captured_token") is False
        assert "tok-fr0m-res0lt-99" not in registry.scan_values()

        result = workbench_service.get_session_variables(session_id)
        assert result["variables"]["captured_token"] == {
            "value": "tok-fr0m-res0lt-99",
            "type": "string",
        }


_PROXY_SECRET = "pr0xy-s3cret-77"
_HOST_PROXY_SECRET = "h0st-pr0xy-s3cret"
_PROXY_VARIABLES = (
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
)
_CUSTOM_PROXY: dict[str, Any] = {
    "enabled": True,
    "source": "custom",
    "host": "proxy.example",
    "port": 3128,
    "username": "ops",
}
_STORED_CUSTOM_PROXIES_SAVE_REFUSES = [
    pytest.param({}, id="no-address-and-no-port"),
    pytest.param({"port": 3128}, id="no-address"),
    pytest.param({"host": "proxy.example"}, id="no-port"),
    pytest.param(
        {
            "host": "proxy.example",
            "port": 3128,
            "entries": [{"kind": "exact", "address": "ftp://a.example"}],
        },
        id="bad-entry",
    ),
]


def _proxy_settings(**values: Any) -> dict[str, Any]:
    """Config file content holding the `network.proxy` section."""
    return {"network": {"proxy": values}}


def _function_node(node_id: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": {"nodes": [], "edges": []},
            "displayName": "Fn",
            "label": "Fn",
        },
    }


class TestProxyPasswordSeeding:
    """The proxy password in force when a run starts is registered, so no run output shows it."""

    @pytest.fixture(autouse=True)
    def _no_proxy_variables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for name in _PROXY_VARIABLES:
            monkeypatch.delenv(name, raising=False)

    @staticmethod
    def _registered() -> tuple[str, ...]:
        """What a run that starts now, with no secret of its own, registers."""
        return workbench_service._build_run_secret_registry([], {}).scan_values()

    def test_the_custom_proxy_password_is_registered(self, load_config: Callable[..., Any]) -> None:
        load_config(_proxy_settings(**_CUSTOM_PROXY, password=seal_value(_PROXY_SECRET)))

        assert _PROXY_SECRET in self._registered()

    def test_the_custom_password_is_not_registered_while_the_proxy_is_off(
        self, load_config: Callable[..., Any]
    ) -> None:
        stored = {**_CUSTOM_PROXY, "enabled": False, "password": seal_value(_PROXY_SECRET)}
        load_config(_proxy_settings(**stored))

        assert self._registered() == ()

    def test_the_custom_password_is_not_registered_under_the_wave_hosts_settings(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stored = {**_CUSTOM_PROXY, "source": "host", "password": seal_value(_PROXY_SECRET)}
        load_config(_proxy_settings(**stored))
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")

        assert self._registered() == ()

    @pytest.mark.parametrize("stored", [{}, {"password": None}], ids=["absent", "null"])
    def test_a_custom_proxy_without_a_password_registers_nothing(
        self, load_config: Callable[..., Any], stored: dict[str, Any]
    ) -> None:
        load_config(_proxy_settings(**_CUSTOM_PROXY, **stored))

        assert self._registered() == ()

    @pytest.mark.parametrize("name", ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"])
    def test_a_password_inside_a_wave_host_variable_is_registered(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch, name: str
    ) -> None:
        load_config(_proxy_settings(enabled=True, source="host"))
        monkeypatch.setenv(name, f"http://ops:{_HOST_PROXY_SECRET}@host-proxy.example:8080")

        assert _HOST_PROXY_SECRET in self._registered()

    def test_each_wave_host_variable_registers_its_own_password(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        load_config(_proxy_settings(enabled=True, source="host"))
        monkeypatch.setenv("HTTPS_PROXY", "http://sec:sec-pr0xy-s3cret@secure-proxy.example:3129")
        monkeypatch.setenv("HTTP_PROXY", "http://plain:plain-pr0xy-s3cret@plain-proxy.example:3128")

        registered = self._registered()

        assert "sec-pr0xy-s3cret" in registered
        assert "plain-pr0xy-s3cret" in registered

    def test_a_percent_encoded_password_is_registered_decoded(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        load_config(_proxy_settings(enabled=True, source="host"))
        monkeypatch.setenv("HTTPS_PROXY", "http://ops:p%40ss%3Aw0rd%2F9@host-proxy.example:8080")

        assert "p@ss:w0rd/9" in self._registered()

    def test_wave_host_variables_without_a_password_register_nothing(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        load_config(_proxy_settings(enabled=True, source="host"))
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")
        monkeypatch.setenv("HTTP_PROXY", "http://ops@host-proxy.example:8080")
        monkeypatch.setenv("NO_PROXY", "localhost,.internal.example")

        assert self._registered() == ()

    @pytest.mark.parametrize("stored", _STORED_CUSTOM_PROXIES_SAVE_REFUSES)
    def test_a_stored_custom_proxy_the_save_rules_refuse_never_fails_the_start(
        self, load_config: Callable[..., Any], stored: dict[str, Any]
    ) -> None:
        held = {"enabled": True, "source": "custom", "username": "ops", **stored}
        load_config(_proxy_settings(**held, password=seal_value(_PROXY_SECRET)))

        registry = workbench_service._build_run_secret_registry(["token"], {"token": "sk-literal"})

        assert "sk-literal" in registry.scan_values()

    def test_a_wave_host_value_wave_cannot_use_never_fails_the_start(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        load_config(_proxy_settings(enabled=True, source="host"))
        monkeypatch.setenv("HTTPS_PROXY", "socks5://ops:s0cks-s3cret@proxy.example:1080")

        registry = workbench_service._build_run_secret_registry(["token"], {"token": "sk-literal"})

        assert "sk-literal" in registry.scan_values()

    def test_a_stored_password_this_wave_cannot_unseal_never_fails_the_start(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.core.secrets.cipher import SecretCipher

        sealed_by_another_wave = SecretCipher(os.urandom(32)).seal(_PROXY_SECRET)
        load_config(_proxy_settings(**_CUSTOM_PROXY, password=sealed_by_another_wave))

        registry = workbench_service._build_run_secret_registry(["token"], {"token": "sk-literal"})

        assert registry.scan_values() == ("sk-literal",)


class TestProxyPasswordInEveryStartedRun:
    """Each way a run starts gives the run a registry that holds the proxy password in force."""

    @pytest.fixture(autouse=True)
    def _custom_proxy_password_in_force(self, load_config: Callable[..., Any]) -> None:
        load_config(_proxy_settings(**_CUSTOM_PROXY, password=seal_value(_PROXY_SECRET)))

    @staticmethod
    def _registered(result: dict[str, Any]) -> tuple[str, ...]:
        registry = wb_common._workbench_sessions[result["session_id"]]["secret_registry"]
        return tuple(registry.scan_values())

    @staticmethod
    def _function_scope() -> Any:
        return workbench_service.ScopedRunOptions(mode="function", function_node_id="fn-1")

    def test_a_test_run(self, workbench_run_mocks: dict[str, Any]) -> None:
        test_id = str(uuid.uuid4())
        workbench_run_mocks["test"] = make_test_record(test_id)

        result = workbench_service.start_workbench_run(
            test_id=test_id, environment_id=str(uuid.uuid4())
        )

        assert _PROXY_SECRET in self._registered(result)

    def test_a_function_run_that_starts_clean(self, workbench_run_mocks: dict[str, Any]) -> None:
        test_id = str(uuid.uuid4())
        record = make_test_record(test_id)
        record["workflow"]["nodes"].append(_function_node("fn-1"))
        workbench_run_mocks["test"] = record

        result = workbench_service.start_workbench_run(
            test_id=test_id, environment_id=str(uuid.uuid4()), scope=self._function_scope()
        )

        assert _PROXY_SECRET in self._registered(result)

    def test_a_function_run_that_carries_on_from_an_earlier_run(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        test_id = str(uuid.uuid4())
        record = make_test_record(test_id)
        record["workflow"]["nodes"].append(_function_node("fn-1"))
        workbench_run_mocks["test"] = record
        earlier = _prime_session(_make_registry(with_token=True))
        wb_common._workbench_sessions[earlier].update(status="passed", test_id=test_id)
        wb_common._user_active_session[wb_common.DEFAULT_USER_ID] = earlier

        result = workbench_service.start_workbench_run(
            test_id=test_id, environment_id=str(uuid.uuid4()), scope=self._function_scope()
        )

        registered = self._registered(result)
        assert "s3cr3t-t0ken-99" in registered
        assert _PROXY_SECRET in registered

    def test_a_standalone_function_run(self, workbench_run_mocks: dict[str, Any]) -> None:
        result = workbench_service.start_standalone_function_run(
            function_def={"nodes": [], "edges": []},
            function_name="Fn",
            function_id=str(uuid.uuid4()),
            environment_id=str(uuid.uuid4()),
        )

        assert _PROXY_SECRET in self._registered(result)


_MASK = "********"
_INPUT_CANARY = "fn-secret-input-canary-41"
_OUTPUT_CANARY = "fn-secret-output-canary-42"
_DEFAULT_CANARY = "fn-secret-output-default-canary-43"
_LOCAL_CANARY = "fn-secret-local-canary-44"
_PLAIN_OUTPUT = "fn-plain-output-45"
_SECRET_INPUT = {"name": "tok", "type": "string", "secret": True}


def _fn_log_node(node_id: str, message: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {"message": message, "level": "INFO"}, "profileBindings": []},
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _fn_setter_node(node_id: str, variables: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {"values": {"variables": variables}},
        },
    }


def _chained(nodes: list[dict[str, Any]]) -> list[dict[str, str]]:
    sources = ["start-node", *(node["id"] for node in nodes[:-1])]
    return [
        {"source": source, "target": node["id"]}
        for source, node in zip(sources, nodes, strict=True)
    ]


def _secret_params_definition(
    *,
    body: list[dict[str, Any]],
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    variables: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "name": "secret_params_fn",
        "description": "",
        "tags": [],
        "inputs": inputs or [],
        "outputs": outputs or [],
        "variables": variables or [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": body, "edges": _chained(body)},
    }


def _secret_params_block(
    *,
    definition: dict[str, Any] | None = None,
    function_id: str | None = None,
    values: dict[str, Any] | None = None,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
    output_bindings: dict[str, str] | None = None,
    output_secret_fields: list[str] | None = None,
) -> dict[str, Any]:
    config: dict[str, Any] = {"values": values or {}, "outputBindings": output_bindings or {}}
    if output_secret_fields is not None:
        config["outputSecretFields"] = output_secret_fields
    data: dict[str, Any] = {
        "label": "Secret Fn",
        "elementType": "function",
        "nodeType": "function",
        "version": "1.0.0",
        "config": config,
        "expressionFields": expression_fields or [],
        "templateFields": template_fields or [],
    }
    if function_id is None:
        data.update(functionLifecycle="local", localDefinition=definition)
    else:
        data.update(functionLifecycle="shared", functionId=function_id, functionVersion="1.0.0")
    return {"id": "fn-secret", "type": "workflowNode", "data": data}


def _log_lines(session_id: str, block_id: str | None = None) -> list[str]:
    return [
        str(entry.get("message"))
        for entry in log_streaming_service.get_logs(session_id)
        if block_id is None or entry.get("blockId") == block_id
    ]


async def _run_from_start(
    nodes: list[dict[str, Any]],
    variables: dict[str, Any],
    secret_names: tuple[str, ...] = (),
    edges: list[dict[str, Any]] | None = None,
) -> tuple[str, Any]:
    """Run ``nodes`` (in order, unless ``edges`` wire them) on a session whose registry is
    seeded as a run start seeds it."""
    literals = {name: variables[name] for name in secret_names}
    registry = workbench_service._build_run_secret_registry(list(secret_names), literals, nodes)
    session_id = _prime_session(registry, secret_names=list(secret_names))
    log_streaming_service.register_secret_registry(session_id, registry)
    wiring = _chained(nodes) if edges is None else edges
    await workbench_service._execute_workflow(session_id, nodes, wiring, variables)
    return session_id, registry


def _block_as_the_run_loads_it(
    definition: dict[str, Any], lifecycle: str, **block: Any
) -> list[dict[str, Any]]:
    """The Function Block as a run gets it: a Local body through the run-load unseal, a
    library body saved to the library and loaded when the Block runs."""
    if lifecycle == "library":
        from wavecore.api.services.functions import _storage as function_storage

        function_id = str(uuid.uuid4())
        function_storage.save_new_version(
            function_id,
            "1.0.0",
            definition,
            {"changelog": "initial", "published_at": "2026-01-01T00:00:00Z"},
            name="secret-params-fn",
        )
        return [_secret_params_block(function_id=function_id, **block)]
    stored = {"workflow": {"nodes": [_secret_params_block(definition=definition, **block)]}}
    nodes, _edges, _variables = workbench_service._resolve_run_body(stored, None, None, {})
    return nodes


class TestFunctionSecretParameters:
    """A secret input acts as a secret block field and a secret output default is masked
    (REQ-3.1.2.9, REQ-3.1.3.5, SECUI-10, SECUI-11)."""

    @pytest.fixture(autouse=True)
    def _register_blocks(self) -> Generator[None, None, None]:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        yield
        clear_registry()

    @pytest.mark.parametrize(
        ("value", "fields", "variables", "secret_names"),
        [
            pytest.param(_INPUT_CANARY, {}, {}, (), id="literal"),
            pytest.param(
                "plain_var",
                {"expression_fields": ["tok"]},
                {"plain_var": _INPUT_CANARY},
                (),
                id="plain-variable",
            ),
            pytest.param(
                "api_tok",
                {"expression_fields": ["tok"]},
                {"api_tok": _INPUT_CANARY},
                ("api_tok",),
                id="secret-variable",
            ),
            pytest.param(
                "{{ plain_var }}",
                {"template_fields": ["tok"]},
                {"plain_var": _INPUT_CANARY},
                (),
                id="template",
            ),
        ],
    )
    async def test_the_value_given_to_a_secret_input_is_masked_inside_the_function(
        self,
        value: str,
        fields: dict[str, list[str]],
        variables: dict[str, Any],
        secret_names: tuple[str, ...],
    ) -> None:
        definition = _secret_params_definition(
            inputs=[_SECRET_INPUT], body=[_fn_log_node("in-log", "'got ' + tok")]
        )
        block = _secret_params_block(definition=definition, values={"tok": value}, **fields)

        session_id, _registry = await _run_from_start([block], dict(variables), secret_names)

        assert f"got {_MASK}" in _log_lines(session_id, "in-log")
        assert not any(_INPUT_CANARY in line for line in _log_lines(session_id))

    @pytest.mark.parametrize("lifecycle", ["local", "library"])
    async def test_a_secret_input_literal_is_masked_inside_the_function(
        self, lifecycle: str
    ) -> None:
        definition = _secret_params_definition(
            inputs=[_SECRET_INPUT], body=[_fn_log_node("in-log", "'got ' + tok")]
        )
        nodes = _block_as_the_run_loads_it(definition, lifecycle, values={"tok": _INPUT_CANARY})

        session_id, registry = await _run_from_start(nodes, {})

        assert f"got {_MASK}" in _log_lines(session_id, "in-log")
        assert not any(_INPUT_CANARY in line for line in _log_lines(session_id))
        assert _INPUT_CANARY in registry.scan_values()

    async def test_a_sealed_secret_input_runs_its_real_value_masked(self) -> None:
        definition = _secret_params_definition(
            inputs=[_SECRET_INPUT], body=[_fn_log_node("in-log", "'got ' + tok")]
        )
        nodes = _block_as_the_run_loads_it(
            definition, "local", values={"tok": seal_value(_INPUT_CANARY)}
        )

        session_id, registry = await _run_from_start(nodes, {})

        assert nodes[0]["data"]["config"]["values"]["tok"] == _INPUT_CANARY
        assert f"got {_MASK}" in _log_lines(session_id, "in-log")
        assert not any(
            _INPUT_CANARY in line or "wave:enc:v1:" in line for line in _log_lines(session_id)
        )
        assert _INPUT_CANARY in registry.scan_values()

    def test_a_secret_input_literal_registers_at_run_start(self) -> None:
        definition = _secret_params_definition(
            inputs=[_SECRET_INPUT], body=[_fn_log_node("in-log", "'got ' + tok")]
        )
        block = _secret_params_block(definition=definition, values={"tok": _INPUT_CANARY})

        registry = workbench_service._build_run_secret_registry([], {}, [block])

        assert _INPUT_CANARY in registry.scan_values()

    @pytest.mark.parametrize(
        ("value", "fields"),
        [
            pytest.param("plain_var", {"expression_fields": ["tok"]}, id="expression"),
            pytest.param("{{ plain_var }}", {"template_fields": ["tok"]}, id="template"),
        ],
    )
    def test_a_secret_input_source_text_never_registers_at_run_start(
        self, value: str, fields: dict[str, list[str]]
    ) -> None:
        definition = _secret_params_definition(
            inputs=[_SECRET_INPUT], body=[_fn_log_node("in-log", "'got ' + tok")]
        )
        block = _secret_params_block(definition=definition, values={"tok": value}, **fields)

        registry = workbench_service._build_run_secret_registry([], {}, [block])

        assert value not in registry.scan_values()

    async def test_the_plain_variable_passed_in_is_not_made_secret(self) -> None:
        definition = _secret_params_definition(
            inputs=[_SECRET_INPUT], body=[_fn_log_node("in-log", "'got ' + tok")]
        )
        block = _secret_params_block(
            definition=definition, values={"tok": "plain_var"}, expression_fields=["tok"]
        )

        _session_id, registry = await _run_from_start([block], {"plain_var": _INPUT_CANARY})

        assert _INPUT_CANARY in registry.scan_values()
        assert registry.is_secret_name("tok") is True
        assert registry.is_secret_name("plain_var") is False

    @pytest.mark.parametrize(
        "declared", [pytest.param({"secret": True}, id="secret"), pytest.param({}, id="plain")]
    )
    async def test_an_output_marked_secret_on_the_function_block_is_registered_on_return(
        self, declared: dict[str, Any]
    ) -> None:
        definition = _secret_params_definition(
            outputs=[{"name": "out_tok", "type": "string", **declared}],
            body=[_fn_setter_node("set-out", {"out_tok": _OUTPUT_CANARY})],
        )
        block = _secret_params_block(
            definition=definition,
            output_bindings={"out_tok": "captured"},
            output_secret_fields=["out_tok"],
        )
        variables: dict[str, Any] = {}

        session_id, registry = await _run_from_start(
            [block, _fn_log_node("after", "'after ' + captured")], variables
        )

        assert variables["captured"] == _OUTPUT_CANARY
        assert registry.is_secret_name("captured") is True
        assert _OUTPUT_CANARY in registry.scan_values()
        after_lines = _log_lines(session_id, "after")
        assert f"after {_MASK}" in after_lines
        assert not any(_OUTPUT_CANARY in line for line in after_lines)

    async def test_an_output_unticked_on_the_function_block_stays_plain(self) -> None:
        definition = _secret_params_definition(
            outputs=[{"name": "out_tok", "type": "string", "secret": True}],
            body=[_fn_setter_node("set-out", {"out_tok": _OUTPUT_CANARY})],
        )
        block = _secret_params_block(
            definition=definition, output_bindings={"out_tok": "captured"}, output_secret_fields=[]
        )
        variables: dict[str, Any] = {}

        _session_id, registry = await _run_from_start([block], variables)

        assert variables["captured"] == _OUTPUT_CANARY
        assert registry.is_secret_name("captured") is False

    @staticmethod
    def _written_output_block(
        output_secret_fields: list[str], captured: str, *, tail: list[dict[str, Any]] | None = None
    ) -> dict[str, Any]:
        definition = _secret_params_definition(
            outputs=[{"name": "out_tok", "type": "string", "secret": True}],
            body=[
                _fn_setter_node("set-out", {"out_tok": _OUTPUT_CANARY}),
                _fn_log_node("in-log", "'inside ' + out_tok"),
                *(tail or []),
            ],
        )
        return _secret_params_block(
            definition=definition,
            output_bindings={"out_tok": captured},
            output_secret_fields=output_secret_fields,
        )

    @pytest.mark.parametrize("captured", ["captured", "out_tok"], ids=["other-name", "same-name"])
    async def test_an_output_unticked_on_the_function_block_reaches_the_root_flow_plain(
        self, captured: str
    ) -> None:
        block = self._written_output_block([], captured)
        after = _fn_log_node("after", f"'after ' + {captured}")

        session_id, registry = await _run_from_start([block, after], {})

        inside = _log_lines(session_id, "in-log")
        assert f"inside {_MASK}" in inside
        assert not any(_OUTPUT_CANARY in line for line in inside)
        assert f"after {_OUTPUT_CANARY}" in _log_lines(session_id, "after")
        assert registry.is_secret_name(captured) is False
        assert _OUTPUT_CANARY not in registry.scan_values()

    @pytest.mark.parametrize("captured", ["captured", "out_tok"], ids=["other-name", "same-name"])
    async def test_an_output_ticked_on_the_function_block_stays_masked_in_the_root_flow(
        self, captured: str
    ) -> None:
        block = self._written_output_block(["out_tok"], captured)
        after = _fn_log_node("after", f"'after ' + {captured}")

        session_id, registry = await _run_from_start([block, after], {})

        assert f"after {_MASK}" in _log_lines(session_id, "after")
        assert not any(_OUTPUT_CANARY in line for line in _log_lines(session_id))
        assert registry.is_secret_name(captured) is True

    @pytest.mark.parametrize("lifecycle", ["local", "library"])
    @pytest.mark.parametrize(
        "declared", [pytest.param({"secret": True}, id="secret"), pytest.param({}, id="plain")]
    )
    async def test_a_renamed_output_marked_on_the_function_block_stays_masked_in_the_root_flow(
        self, lifecycle: str, declared: dict[str, Any]
    ) -> None:
        # The Function Block's marked list holds the output's new name (REQ-3.1.2.9, SECUI-11).
        definition = _secret_params_definition(
            outputs=[
                {"name": "renamed_tok", "type": "string", **declared},
                {"name": "plain_out", "type": "string"},
            ],
            body=[
                _fn_setter_node(
                    "set-out", {"renamed_tok": _OUTPUT_CANARY, "plain_out": _PLAIN_OUTPUT}
                )
            ],
        )
        nodes = _block_as_the_run_loads_it(
            definition,
            lifecycle,
            output_bindings={"renamed_tok": "captured", "plain_out": "plain_captured"},
            output_secret_fields=["renamed_tok"],
        )
        after = _fn_log_node("after", "'after ' + captured + ' ' + plain_captured")
        variables: dict[str, Any] = {}

        session_id, registry = await _run_from_start([*nodes, after], variables)

        assert variables["captured"] == _OUTPUT_CANARY
        assert registry.is_secret_name("captured") is True
        assert registry.is_secret_name("plain_captured") is False
        assert _OUTPUT_CANARY in registry.scan_values()
        after_lines = _log_lines(session_id, "after")
        assert f"after {_MASK} {_PLAIN_OUTPUT}" in after_lines
        assert not any(_OUTPUT_CANARY in line for line in after_lines)

    @pytest.mark.parametrize(
        ("output_secret_fields", "shown"),
        [
            pytest.param(["out_tok"], _MASK, id="ticked"),
            pytest.param([], _OUTPUT_CANARY, id="unticked"),
        ],
    )
    async def test_an_output_a_halted_function_returns_follows_its_secret_box(
        self, output_secret_fields: list[str], shown: str
    ) -> None:
        halt = {
            "id": "halt-fn",
            "type": "workflowNode",
            "data": {
                "label": "halt-fn",
                "elementType": "halt",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {"values": {"scope": "function", "status": "passed"}},
            },
        }
        block = self._written_output_block(output_secret_fields, "captured", tail=[halt])
        after = _fn_log_node("after", "'after ' + captured")

        session_id, _registry = await _run_from_start([block, after], {})

        assert f"after {shown}" in _log_lines(session_id, "after")

    async def test_an_unticked_expression_output_reaches_the_root_flow_plain(self) -> None:
        definition = _secret_params_definition(
            outputs=[
                {
                    "name": "out_tok",
                    "type": "string",
                    "secret": True,
                    "isExpression": True,
                    "default": f"'{_OUTPUT_CANARY[:12]}' + '{_OUTPUT_CANARY[12:]}'",
                }
            ],
            body=[_fn_log_node("in-log", "'inside ' + out_tok")],
        )
        block = _secret_params_block(
            definition=definition, output_bindings={"out_tok": "captured"}, output_secret_fields=[]
        )
        after = _fn_log_node("after", "'after ' + captured")

        session_id, registry = await _run_from_start([block, after], {})

        assert f"inside {_MASK}" in _log_lines(session_id, "in-log")
        assert f"after {_OUTPUT_CANARY}" in _log_lines(session_id, "after")
        assert _OUTPUT_CANARY not in registry.scan_values()

    async def test_an_unticked_output_inside_a_container_reaches_the_root_flow_plain(
        self,
    ) -> None:
        loop = for_each_node("loop", ["one"])
        block = self._written_output_block([], "captured")
        after = _fn_log_node("after", "'after ' + captured")
        edges = [
            edge("start-node", "loop"),
            edge("loop", block["id"], "body"),
            edge("loop", "after", "then"),
        ]

        session_id, registry = await _run_from_start([loop, block, after], {}, edges=edges)

        assert f"inside {_MASK}" in _log_lines(session_id, "in-log")
        assert f"after {_OUTPUT_CANARY}" in _log_lines(session_id, "after")
        assert _OUTPUT_CANARY not in registry.scan_values()

    async def test_an_output_of_a_failed_function_stays_masked(self) -> None:
        block = self._written_output_block([], "captured", tail=[_fn_log_node("boom", "1 / 0")])

        session_id, registry = await _run_from_start([block], {})

        assert _OUTPUT_CANARY in registry.scan_values()
        assert not any(_OUTPUT_CANARY in line for line in _log_lines(session_id))

    async def test_an_unticked_output_of_a_nested_function_reaches_the_outer_function_flow_plain(
        self,
    ) -> None:
        inner = {**self._written_output_block([], "captured"), "id": "inner-block"}
        outer_definition = _secret_params_definition(
            body=[inner, _fn_log_node("outer-after", "'after ' + captured")],
            variables=[{"name": "captured", "type": "string", "value": None}],
        )
        outer = _secret_params_block(definition=outer_definition)

        session_id, registry = await _run_from_start([outer], {})

        assert f"inside {_MASK}" in _log_lines(session_id, "in-log")
        assert f"after {_OUTPUT_CANARY}" in _log_lines(session_id, "outer-after")
        assert _OUTPUT_CANARY not in registry.scan_values()

    @pytest.mark.parametrize("lifecycle", ["local", "library"])
    async def test_a_secret_output_default_is_unsealed_for_the_run_and_registered(
        self, lifecycle: str
    ) -> None:
        definition = _secret_params_definition(
            outputs=[
                {
                    "name": "out_tok",
                    "type": "string",
                    "secret": True,
                    "default": seal_value(_DEFAULT_CANARY),
                }
            ],
            body=[_fn_log_node("in-log", "'default ' + out_tok")],
        )
        nodes = _block_as_the_run_loads_it(
            definition,
            lifecycle,
            output_bindings={"out_tok": "captured"},
            output_secret_fields=["out_tok"],
        )
        variables: dict[str, Any] = {}

        session_id, registry = await _run_from_start(nodes, variables)

        assert f"default {_MASK}" in _log_lines(session_id, "in-log")
        assert not any(
            _DEFAULT_CANARY in line or "wave:enc:v1:" in line for line in _log_lines(session_id)
        )
        assert variables["captured"] == _DEFAULT_CANARY
        assert _DEFAULT_CANARY in registry.scan_values()

    @pytest.mark.parametrize("lifecycle", ["local", "library"])
    async def test_a_function_local_secret_variable_is_masked_inside_the_function(
        self, lifecycle: str
    ) -> None:
        definition = _secret_params_definition(
            variables=[
                {
                    "name": "local_tok",
                    "type": "string",
                    "value": seal_value(_LOCAL_CANARY),
                    "secret": True,
                }
            ],
            body=[_fn_log_node("in-log", "'local ' + local_tok")],
        )
        nodes = _block_as_the_run_loads_it(definition, lifecycle)

        session_id, _registry = await _run_from_start(nodes, {})

        assert f"local {_MASK}" in _log_lines(session_id, "in-log")
        assert not any(
            _LOCAL_CANARY in line or "wave:enc:v1:" in line for line in _log_lines(session_id)
        )

    @pytest.mark.parametrize("lifecycle", ["local", "library"])
    async def test_an_unticked_output_returning_its_sealed_default_stays_masked(
        self, lifecycle: str
    ) -> None:
        # Per SECUI-11: an untick on the Function Block never reveals the author's sealed default.
        definition = _secret_params_definition(
            outputs=[
                {
                    "name": "out_tok",
                    "type": "string",
                    "secret": True,
                    "default": seal_value(_DEFAULT_CANARY),
                }
            ],
            body=[_fn_log_node("in-log", "'default ' + out_tok")],
        )
        nodes = _block_as_the_run_loads_it(
            definition, lifecycle, output_bindings={"out_tok": "captured"}, output_secret_fields=[]
        )
        variables: dict[str, Any] = {}

        session_id, registry = await _run_from_start(
            [*nodes, _fn_log_node("after", "'after ' + captured")], variables
        )

        assert variables["captured"] == _DEFAULT_CANARY
        assert f"after {_MASK}" in _log_lines(session_id, "after")
        assert not any(_DEFAULT_CANARY in line for line in _log_lines(session_id))
        assert _DEFAULT_CANARY in registry.scan_values()

    @pytest.mark.parametrize(
        ("key", "declaration"),
        [
            pytest.param("variables", {"name": "computed", "value": None}, id="local"),
            pytest.param("outputs", {"name": "computed", "default": None}, id="output"),
        ],
    )
    @pytest.mark.parametrize("kind", ["isExpression", "isTemplate"])
    async def test_a_computed_secret_masks_its_value_never_its_source_text(
        self, key: str, declaration: dict[str, Any], kind: str
    ) -> None:
        source = (
            "'fn-src-' + 'computed-46'" if kind == "isExpression" else "fn-src-{{ 'computed-46' }}"
        )
        field = "value" if key == "variables" else "default"
        declared = {**declaration, field: source, "type": "string", "secret": True, kind: True}
        definition = _secret_params_definition(
            **{key: [declared]},
            body=[
                _fn_log_node("value-log", "'value ' + computed"),
                _fn_log_node("source-log", repr(source)),
            ],
        )
        block = _secret_params_block(definition=definition)

        session_id, registry = await _run_from_start([block], {})

        assert f"value {_MASK}" in _log_lines(session_id, "value-log")
        assert not any("fn-src-computed-46" in line for line in _log_lines(session_id))
        assert source in _log_lines(session_id, "source-log")
        assert source not in registry.scan_values()


_RUN_START_CANARY = "run-start-echoed-secret-canary-47"


class TestEchoedSecretAtRunStart:
    """A run started from the Test's unsaved variables never runs a stored secret plain
    because the mask came back without its secret flag (REQ-3.1.3.5)."""

    @pytest.fixture(autouse=True)
    def _register_blocks(self) -> Generator[None, None, None]:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        yield
        clear_registry()

    @staticmethod
    def _start(workbench_run_mocks: dict[str, Any], sent: dict[str, Any]) -> dict[str, Any]:
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test(
            {
                "name": "echoed secret at run start",
                "variables": {
                    "api_token": {"type": "string", "value": _RUN_START_CANARY, "secret": True}
                },
            }
        )
        workbench_run_mocks["test"] = make_test_record(created["id"])
        log = {**_fn_log_node("log", "'ok'"), "position": {"x": 0, "y": 0}}
        result = workbench_service.start_workbench_run(
            test_id=created["id"],
            environment_id=str(uuid.uuid4()),
            workflow={"nodes": [log], "edges": _chained([log])},
            variables={"api_token": sent},
        )
        session: dict[str, Any] = wb_common._workbench_sessions[result["session_id"]]
        return session

    @pytest.mark.parametrize("dropped", [{}, {"secret": False}], ids=["absent", "false"])
    def test_an_echoed_mask_without_the_flag_runs_the_stored_secret_masked(
        self, workbench_run_mocks: dict[str, Any], dropped: dict[str, Any]
    ) -> None:
        session = self._start(workbench_run_mocks, {"type": "string", "value": _MASK, **dropped})

        assert "api_token" in session["secret_variable_names"]
        assert _RUN_START_CANARY in session["secret_registry"].scan_values()

    def test_a_new_value_without_the_flag_runs_plain(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        session = self._start(workbench_run_mocks, {"type": "string", "value": _PLAIN_OUTPUT})

        assert "api_token" not in session["secret_variable_names"]
        assert _PLAIN_OUTPUT not in session["secret_registry"].scan_values()
        assert _RUN_START_CANARY not in session["secret_registry"].scan_values()
