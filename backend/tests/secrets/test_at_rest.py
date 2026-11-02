"""Save-to-disk-to-use at-rest behavior across both sealed surfaces (REQ-4.5.1).

Secret variables (system / test / suite / regression scope) and profile
credentials are sealed at the service save boundary, carry only
envelopes on disk, and yield the original real values at the unseal
boundaries (run load, profile materialization, expression evaluation).
Non-secret siblings stay untouched and masked responses stay masked.
"""

import uuid
from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.services import storage_paths, variable_service
from wavecore.api.services.profiles import _common as profile_common
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.tests import service as test_service
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import seal_value, unseal_all

TEST_VAR_CANARY = "at-rest-test-var-canary-000"
SYSTEM_VAR_CANARY = "at-rest-system-var-canary-111"
SUITE_VAR_CANARY = "at-rest-suite-var-canary-222"
REGRESSION_VAR_CANARY = "at-rest-regression-var-canary-333"
PROFILE_CANARY = "at-rest-profile-canary-444"
PROFILE_ENV_CANARY = "at-rest-profile-env-canary-555"
SETTER_CANARY = "at-rest-setter-literal-canary-666"
FUNCTION_SETTER_CANARY = "at-rest-function-setter-canary-777"
NESTED_FUNCTION_CANARY = "at-rest-nested-function-canary-888"
FUNCTION_LOCAL_CANARY = "at-rest-function-local-canary-901"
FUNCTION_OUTPUT_CANARY = "at-rest-function-output-default-canary-902"
FUNCTION_INPUT_CANARY = "at-rest-function-input-literal-canary-903"
FUNCTION_MAP_INPUT_CANARY = "at-rest-function-map-input-canary-904"


def _masked_secret_submission(canary_name: str = "api_token") -> dict[str, Any]:
    """A masked read of a secret variable, as the frontend echoes it on save."""
    return {
        canary_name: {"type": "string", "value": MASK_PLACEHOLDER, "secret": True},
        "host": {"type": "string", "value": "db.example.com"},
    }


@pytest.fixture(autouse=True)
def _fresh_service_state() -> Generator[None, None, None]:
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False
    profile_common._clear_in_memory_cache()
    yield
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False
    profile_common._clear_in_memory_cache()


def _secret_variables(canary: str) -> dict[str, Any]:
    return {
        "api_token": {"type": "string", "value": canary, "secret": True},
        "host": {"type": "string", "value": "db.example.com"},
    }


def _read_yaml(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


class TestSecretTestVariablesAtRest:
    def _create_test(self) -> dict[str, Any]:
        return test_service.create_test(
            {"name": "at-rest secrets test", "variables": _secret_variables(TEST_VAR_CANARY)}
        )

    def _disk_path(self, test_id: str) -> Path:
        return storage_paths.get_tests_storage_path() / test_id / "test.yaml"

    def test_created_test_stores_envelope_not_plaintext(self) -> None:
        created = self._create_test()

        raw_text = self._disk_path(created["id"]).read_text()
        assert "wave:enc:v1:" in raw_text
        assert TEST_VAR_CANARY not in raw_text

        stored = _read_yaml(self._disk_path(created["id"]))
        assert is_secret_envelope(stored["variables"]["api_token"]["value"])
        assert unseal_all(stored["variables"]["api_token"]["value"]) == TEST_VAR_CANARY
        assert stored["variables"]["host"] == {
            "type": "string",
            "value": "db.example.com",
        }

    def test_create_response_still_masks_the_secret(self) -> None:
        created = self._create_test()

        assert created["variables"]["api_token"]["value"] == MASK_PLACEHOLDER
        assert created["variables"]["host"]["value"] == "db.example.com"

    def test_masked_read_is_unchanged_by_sealing(self) -> None:
        created = self._create_test()

        variables = test_service.get_test_variables(created["id"])

        assert variables is not None
        assert variables["api_token"]["value"] == MASK_PLACEHOLDER

    def test_save_round_trip_does_not_double_seal(self) -> None:
        created = self._create_test()
        stored = _read_yaml(self._disk_path(created["id"]))

        test_service.update_test_variables(created["id"], stored["variables"])

        after = _read_yaml(self._disk_path(created["id"]))
        assert unseal_all(after["variables"]["api_token"]["value"]) == TEST_VAR_CANARY

    def test_placeholder_restore_resolves_to_the_stored_secret(self) -> None:
        from wavecore.api.services.shared import restore_masked_secrets

        created = self._create_test()
        stored_raw = test_service.get_test_variables_raw(created["id"])
        assert stored_raw is not None

        sent = {"api_token": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True}}
        restored = restore_masked_secrets(sent, stored_raw)

        restored_value = restored["api_token"]["value"]
        assert restored_value != MASK_PLACEHOLDER
        assert unseal_all(restored_value) == TEST_VAR_CANARY

    def test_placeholder_save_preserves_the_stored_secret(self) -> None:
        created = self._create_test()
        before = _read_yaml(self._disk_path(created["id"]))["variables"]["api_token"]["value"]

        test_service.update_test(created["id"], {"variables": _masked_secret_submission()})

        after = _read_yaml(self._disk_path(created["id"]))["variables"]["api_token"]["value"]
        assert is_secret_envelope(after)
        assert unseal_all(after) == TEST_VAR_CANARY
        assert after == before

    def test_placeholder_save_via_update_variables_preserves_the_stored_secret(self) -> None:
        created = self._create_test()
        before = _read_yaml(self._disk_path(created["id"]))["variables"]["api_token"]["value"]

        test_service.update_test_variables(created["id"], _masked_secret_submission())

        after = _read_yaml(self._disk_path(created["id"]))["variables"]["api_token"]["value"]
        assert is_secret_envelope(after)
        assert unseal_all(after) == TEST_VAR_CANARY
        assert after == before

    def test_genuinely_edited_secret_is_sealed_anew(self) -> None:
        created = self._create_test()
        before = _read_yaml(self._disk_path(created["id"]))["variables"]["api_token"]["value"]

        test_service.update_test(
            created["id"],
            {
                "variables": {
                    "api_token": {"type": "string", "value": "rotated-real-777", "secret": True},
                    "host": {"type": "string", "value": "db.example.com"},
                }
            },
        )

        after = _read_yaml(self._disk_path(created["id"]))["variables"]["api_token"]["value"]
        assert is_secret_envelope(after)
        assert unseal_all(after) == "rotated-real-777"
        assert after != before


class TestSetterNodeSecretsAtRest:
    """A Variable Setter literal flagged secret is sealed at rest in the
    persisted workflow node config, never sitting in cleartext on disk."""

    def _setter_workflow(self, secret_keys: list[str]) -> dict[str, Any]:
        return {
            "nodes": [
                {
                    "id": "setter-1",
                    "type": "workflowNode",
                    "data": {
                        "label": "Set Vars",
                        "elementType": "variable-setter",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "config": {
                            "values": {"variables": {"api_key": SETTER_CANARY, "count": "5"}},
                            "variableSecretKeys": secret_keys,
                        },
                    },
                }
            ],
            "edges": [],
        }

    def _save_setter_test(self, secret_keys: list[str]) -> str:
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        test_service._save_test(
            {
                "id": test_id,
                "name": "setter at-rest",
                "version": "1.0.0",
                "description": "",
                "workflow": self._setter_workflow(secret_keys),
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )
        return test_id

    def _disk_path(self, test_id: str) -> Path:
        return storage_paths.get_tests_storage_path() / test_id / "test.yaml"

    def _setter_values(self, test_id: str) -> dict[str, Any]:
        stored = _read_yaml(self._disk_path(test_id))
        node = stored["workflow"]["nodes"][0]
        return node["data"]["config"]["values"]["variables"]

    def test_secret_setter_literal_is_sealed_on_disk(self) -> None:
        test_id = self._save_setter_test(["api_key"])

        raw_text = self._disk_path(test_id).read_text()
        assert "wave:enc:v1:" in raw_text
        assert SETTER_CANARY not in raw_text

        sealed = self._setter_values(test_id)["api_key"]
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == SETTER_CANARY

    def test_non_secret_setter_literal_stays_plaintext(self) -> None:
        test_id = self._save_setter_test(["api_key"])

        assert self._setter_values(test_id)["count"] == "5"

    def test_setter_without_secret_keys_stays_plaintext(self) -> None:
        test_id = self._save_setter_test([])

        assert self._setter_values(test_id)["api_key"] == SETTER_CANARY


def _setter_body_node(canary: str, secret_keys: list[str]) -> dict[str, Any]:
    return {
        "id": "setter-1",
        "type": "workflowNode",
        "data": {
            "label": "Set Vars",
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {"variables": {"api_key": canary, "count": "5"}},
                "variableSecretKeys": secret_keys,
            },
        },
    }


class TestFunctionSetterNodeSecretsAtRest:
    """REQ-4.5.1: a Variable Setter literal flagged secret inside a Function body
    is sealed at rest in every place a Function persists - the published library
    version and a nested local Function definition inside a Test - and unseals to
    the real value when the Function runs."""

    def _function_definition(self, canary: str, secret_keys: list[str]) -> dict[str, Any]:
        return {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": [_setter_body_node(canary, secret_keys)],
                "edges": [{"source": "start-node", "target": "setter-1"}],
            },
        }

    def _metadata(self) -> dict[str, Any]:
        return {
            "description": "",
            "tags": [],
            "changelog": "initial",
            "details": "",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        }

    def _publish(self, canary: str, secret_keys: list[str]) -> str:
        from wavecore.api.services.functions import _storage as function_storage

        fn_id = str(uuid.uuid4())
        function_storage.save_new_version(
            fn_id,
            "1.0.0",
            self._function_definition(canary, secret_keys),
            self._metadata(),
            name="sealed-fn",
        )
        return fn_id

    def _version_path(self, fn_id: str) -> Path:
        return storage_paths.get_functions_storage_path() / fn_id / "versions" / "1.0.0.yaml"

    def _stored_setter_values(self, fn_id: str) -> dict[str, Any]:
        payload = _read_yaml(self._version_path(fn_id))
        node = payload["definition"]["workflow"]["nodes"][0]
        return node["data"]["config"]["values"]["variables"]

    def test_published_function_setter_secret_is_sealed_on_disk(self) -> None:
        fn_id = self._publish(FUNCTION_SETTER_CANARY, ["api_key"])

        raw_text = self._version_path(fn_id).read_text()
        assert "wave:enc:v1:" in raw_text
        assert FUNCTION_SETTER_CANARY not in raw_text

        sealed = self._stored_setter_values(fn_id)["api_key"]
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == FUNCTION_SETTER_CANARY

    def test_published_function_non_secret_setter_stays_plaintext(self) -> None:
        fn_id = self._publish(FUNCTION_SETTER_CANARY, ["api_key"])

        assert self._stored_setter_values(fn_id)["count"] == "5"

    def test_published_function_without_secret_keys_stays_plaintext(self) -> None:
        fn_id = self._publish(FUNCTION_SETTER_CANARY, [])

        assert self._stored_setter_values(fn_id)["api_key"] == FUNCTION_SETTER_CANARY

    def test_shared_function_run_load_unseals_the_setter_secret(self) -> None:
        from wavecore.api.services.workbench.functions import _load_function_definition

        fn_id = self._publish(FUNCTION_SETTER_CANARY, ["api_key"])

        definition = _load_function_definition(
            {"functionLifecycle": "shared", "functionId": fn_id, "functionVersion": "1.0.0"}
        )

        loaded = definition["workflow"]["nodes"][0]["data"]["config"]["values"]["variables"]
        assert loaded["api_key"] == FUNCTION_SETTER_CANARY

    def _function_node_in_test(self) -> dict[str, Any]:
        return {
            "id": "fn-1",
            "type": "workflowNode",
            "data": {
                "label": "Local Fn",
                "nodeType": "function",
                "functionLifecycle": "local",
                "localDefinition": self._function_definition(NESTED_FUNCTION_CANARY, ["api_key"]),
            },
        }

    def _save_test_with_function(self) -> str:
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        test_service._save_test(
            {
                "id": test_id,
                "name": "nested function at-rest",
                "version": "1.0.0",
                "description": "",
                "workflow": {
                    "nodes": [self._function_node_in_test()],
                    "edges": [{"source": "start-node", "target": "fn-1"}],
                },
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )
        return test_id

    def _test_disk_path(self, test_id: str) -> Path:
        return storage_paths.get_tests_storage_path() / test_id / "test.yaml"

    def test_nested_local_function_setter_secret_is_sealed_on_disk(self) -> None:
        test_id = self._save_test_with_function()

        raw_text = self._test_disk_path(test_id).read_text()
        assert "wave:enc:v1:" in raw_text
        assert NESTED_FUNCTION_CANARY not in raw_text

        stored = _read_yaml(self._test_disk_path(test_id))
        nested = stored["workflow"]["nodes"][0]["data"]["localDefinition"]["workflow"]["nodes"][0]
        sealed = nested["data"]["config"]["values"]["variables"]["api_key"]
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == NESTED_FUNCTION_CANARY

    def _secret_parameters_definition(self, *, sealed: bool = False) -> dict[str, Any]:
        """A Function body declaring a secret input, a secret output with a default and a
        secret local variable (REQ-3.1.2.9)."""
        local, output = FUNCTION_LOCAL_CANARY, FUNCTION_OUTPUT_CANARY
        if sealed:
            local, output = seal_value(local), seal_value(output)
        return {
            "inputs": [{"name": "tok", "type": "string", "secret": True}],
            "outputs": [{"name": "out_tok", "type": "string", "secret": True, "default": output}],
            "variables": [{"name": "local_tok", "type": "string", "value": local, "secret": True}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        }

    def _secret_parameters_block(
        self, body_key: str = "localDefinition", *, sealed: bool = False
    ) -> dict[str, Any]:
        literal = FUNCTION_INPUT_CANARY
        data: dict[str, Any] = {
            "label": "Secret Fn",
            "nodeType": "function",
            "config": {"values": {"tok": seal_value(literal) if sealed else literal}},
            body_key: self._secret_parameters_definition(sealed=sealed),
        }
        if body_key == "draft":
            data.update(
                functionLifecycle="shared",
                functionId=str(uuid.uuid4()),
                functionVersion="1.0.0",
                editMode=True,
            )
        else:
            data["functionLifecycle"] = "local"
        return {"id": "fn-secret", "type": "workflowNode", "data": data}

    def _save_test_with_secret_parameters(
        self, body_key: str = "localDefinition", *, sealed: bool = False
    ) -> str:
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        test_service._save_test(
            {
                "id": test_id,
                "name": "function secret parameters at-rest",
                "version": "1.0.0",
                "description": "",
                "workflow": {
                    "nodes": [self._secret_parameters_block(body_key, sealed=sealed)],
                    "edges": [{"source": "start-node", "target": "fn-secret"}],
                },
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )
        return test_id

    @staticmethod
    def _held_secret(data: dict[str, Any], body_key: str, holder: str) -> Any:
        definition = data[body_key]
        if holder == "local-variable":
            return definition["variables"][0]["value"]
        if holder == "output-default":
            return definition["outputs"][0].get("default")
        return data["config"]["values"]["tok"]

    def _stored_block_data(self, test_id: str) -> dict[str, Any]:
        node: dict[str, Any] = _read_yaml(self._test_disk_path(test_id))["workflow"]["nodes"][0]
        return node["data"]

    def _assert_sealed_on_disk(self, test_id: str, holder: str, body_key: str) -> None:
        raw_text = self._test_disk_path(test_id).read_text()
        plaintext = {
            "local-variable": FUNCTION_LOCAL_CANARY,
            "output-default": FUNCTION_OUTPUT_CANARY,
            "input-literal": FUNCTION_INPUT_CANARY,
        }[holder]
        assert "wave:enc:v1:" in raw_text
        sealed = self._held_secret(self._stored_block_data(test_id), body_key, holder)
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == plaintext

    def test_local_function_secret_variable_is_sealed_on_disk(self) -> None:
        test_id = self._save_test_with_secret_parameters()

        assert FUNCTION_LOCAL_CANARY not in self._test_disk_path(test_id).read_text()
        self._assert_sealed_on_disk(test_id, "local-variable", "localDefinition")

    def test_local_function_secret_output_default_is_sealed_on_disk(self) -> None:
        test_id = self._save_test_with_secret_parameters()

        assert FUNCTION_OUTPUT_CANARY not in self._test_disk_path(test_id).read_text()
        self._assert_sealed_on_disk(test_id, "output-default", "localDefinition")

    def test_local_function_secret_input_literal_is_sealed_on_disk(self) -> None:
        test_id = self._save_test_with_secret_parameters()

        assert FUNCTION_INPUT_CANARY not in self._test_disk_path(test_id).read_text()
        self._assert_sealed_on_disk(test_id, "input-literal", "localDefinition")

    @pytest.mark.parametrize("holder", ["local-variable", "output-default", "input-literal"])
    def test_edit_mode_draft_secret_is_sealed_on_disk(self, holder: str) -> None:
        test_id = self._save_test_with_secret_parameters("draft")

        raw_text = self._test_disk_path(test_id).read_text()
        for canary in (FUNCTION_LOCAL_CANARY, FUNCTION_OUTPUT_CANARY, FUNCTION_INPUT_CANARY):
            assert canary not in raw_text
        self._assert_sealed_on_disk(test_id, holder, "draft")

    @staticmethod
    def _library_secret(definition: dict[str, Any], holder: str) -> list[Any]:
        if holder == "local-variable":
            return [item.get("value") for item in definition.get("variables") or []]
        return [item.get("default") for item in definition.get("outputs") or []]

    @pytest.mark.parametrize(
        ("holder", "canary"),
        [
            pytest.param("local-variable", FUNCTION_LOCAL_CANARY, id="local-variable"),
            pytest.param("output-default", FUNCTION_OUTPUT_CANARY, id="output-default"),
        ],
    )
    def test_library_version_secret_is_sealed_on_disk(self, holder: str, canary: str) -> None:
        from wavecore.api.services.functions import _storage as function_storage

        fn_id = str(uuid.uuid4())
        function_storage.save_new_version(
            fn_id,
            "1.0.0",
            self._secret_parameters_definition(),
            self._metadata(),
            name="secret-params-fn",
        )

        assert canary not in self._version_path(fn_id).read_text()
        stored = self._library_secret(_read_yaml(self._version_path(fn_id))["definition"], holder)
        assert len(stored) == 1
        assert is_secret_envelope(stored[0])
        assert unseal_all(stored[0]) == canary

    @pytest.mark.parametrize(
        ("holder", "canary"),
        [
            pytest.param("local-variable", FUNCTION_LOCAL_CANARY, id="local-variable"),
            pytest.param("output-default", FUNCTION_OUTPUT_CANARY, id="output-default"),
        ],
    )
    def test_library_run_load_unseals_the_function_secret(self, holder: str, canary: str) -> None:
        from wavecore.api.services.functions import _storage as function_storage
        from wavecore.api.services.workbench.functions import _load_function_definition

        fn_id = str(uuid.uuid4())
        function_storage.save_new_version(
            fn_id,
            "1.0.0",
            self._secret_parameters_definition(sealed=True),
            self._metadata(),
            name="secret-params-fn",
        )

        definition = _load_function_definition(
            {"functionLifecycle": "shared", "functionId": fn_id, "functionVersion": "1.0.0"}
        )

        assert self._library_secret(definition, holder) == [canary]

    @pytest.mark.parametrize(
        ("holder", "canary"),
        [
            pytest.param("local-variable", FUNCTION_LOCAL_CANARY, id="local-variable"),
            pytest.param("output-default", FUNCTION_OUTPUT_CANARY, id="output-default"),
            pytest.param("input-literal", FUNCTION_INPUT_CANARY, id="input-literal"),
        ],
    )
    def test_test_run_load_unseals_the_local_function_secret(
        self, holder: str, canary: str
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        test_id = self._save_test_with_secret_parameters(sealed=True)
        stored = _read_yaml(self._test_disk_path(test_id))

        nodes, _edges, _variables = workbench_service._resolve_run_body(stored, None, None, {})

        assert self._held_secret(nodes[0]["data"], "localDefinition", holder) == canary

    @pytest.mark.parametrize(
        "canary",
        [
            pytest.param(FUNCTION_LOCAL_CANARY, id="local-variable"),
            pytest.param(FUNCTION_OUTPUT_CANARY, id="output-default"),
            pytest.param(FUNCTION_INPUT_CANARY, id="input-literal"),
        ],
    )
    def test_run_start_registers_the_local_function_secret(self, canary: str) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        test_id = self._save_test_with_secret_parameters(sealed=True)
        stored = _read_yaml(self._test_disk_path(test_id))
        nodes, _edges, _variables = workbench_service._resolve_run_body(stored, None, None, {})

        registry = workbench_service._build_run_secret_registry([], {}, nodes)

        assert canary in registry.scan_values()

    def _save_test_with_a_shared_function_block(
        self, *, secret: bool, value: Any, **fields: Any
    ) -> str:
        """A Test whose one Block is a Shared Function Block pinned to a library version,
        its input ``tok`` (secret when ``secret``) holding ``value``."""
        from wavecore.api.services.functions import _storage as function_storage

        fn_id = str(uuid.uuid4())
        definition = self._secret_parameters_definition()
        definition["inputs"] = [
            {"name": "tok", "type": "string", **({"secret": True} if secret else {})}
        ]
        function_storage.save_new_version(
            fn_id, "1.0.0", definition, self._metadata(), name="secret-params-fn"
        )
        block = {
            "id": "fn-secret",
            "type": "workflowNode",
            "data": {
                "label": "Secret Fn",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": fn_id,
                "functionVersion": "1.0.0",
                "config": {"values": {"tok": value}},
                **fields,
            },
        }
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        test_service._save_test(
            {
                "id": test_id,
                "name": "shared function secret input at-rest",
                "version": "1.0.0",
                "description": "",
                "workflow": {
                    "nodes": [block],
                    "edges": [{"source": "start-node", "target": "fn-secret"}],
                },
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )
        return test_id

    def _stored_input(self, test_id: str) -> Any:
        return self._stored_block_data(test_id)["config"]["values"]["tok"]

    def test_shared_function_block_secret_input_literal_is_sealed_on_disk(self) -> None:
        test_id = self._save_test_with_a_shared_function_block(
            secret=True, value=FUNCTION_INPUT_CANARY
        )

        assert FUNCTION_INPUT_CANARY not in self._test_disk_path(test_id).read_text()
        sealed = self._stored_input(test_id)
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == FUNCTION_INPUT_CANARY

    def test_shared_function_block_plain_input_literal_stays_plaintext(self) -> None:
        test_id = self._save_test_with_a_shared_function_block(
            secret=False, value=FUNCTION_INPUT_CANARY
        )

        assert self._stored_input(test_id) == FUNCTION_INPUT_CANARY

    @pytest.mark.parametrize("flag", ["expressionFields", "templateFields"])
    def test_an_expression_or_template_secret_input_is_stored_as_written(self, flag: str) -> None:
        test_id = self._save_test_with_a_shared_function_block(
            secret=True, value="api_token", **{flag: ["tok"]}
        )

        assert self._stored_input(test_id) == "api_token"

    def test_a_map_secret_input_is_sealed_per_value_on_disk(self) -> None:
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        definition = self._secret_parameters_definition()
        definition["inputs"] = [{"name": "creds", "type": "map", "secret": True}]
        block = {
            "id": "fn-secret",
            "type": "workflowNode",
            "data": {
                "label": "Secret Fn",
                "nodeType": "function",
                "functionLifecycle": "local",
                "localDefinition": definition,
                "config": {"values": {"creds": {"api_key": FUNCTION_MAP_INPUT_CANARY}}},
            },
        }
        test_service._save_test(
            {
                "id": test_id,
                "name": "map secret input at-rest",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [block], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )

        assert FUNCTION_MAP_INPUT_CANARY not in self._test_disk_path(test_id).read_text()
        held = self._stored_block_data(test_id)["config"]["values"]["creds"]
        assert list(held) == ["api_key"]
        assert is_secret_envelope(held["api_key"])
        assert unseal_all(held["api_key"]) == FUNCTION_MAP_INPUT_CANARY

    def test_test_run_load_unseals_a_shared_function_block_secret_input_literal(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        test_id = self._save_test_with_a_shared_function_block(
            secret=True, value=seal_value(FUNCTION_INPUT_CANARY)
        )
        stored = _read_yaml(self._test_disk_path(test_id))

        nodes, _edges, _variables = workbench_service._resolve_run_body(stored, None, None, {})

        assert nodes[0]["data"]["config"]["values"]["tok"] == FUNCTION_INPUT_CANARY

    def test_run_start_registers_a_shared_function_block_secret_input(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        test_id = self._save_test_with_a_shared_function_block(
            secret=True, value=seal_value(FUNCTION_INPUT_CANARY)
        )
        stored = _read_yaml(self._test_disk_path(test_id))
        nodes, _edges, _variables = workbench_service._resolve_run_body(stored, None, None, {})

        registry = workbench_service._build_run_secret_registry([], {}, nodes)

        assert FUNCTION_INPUT_CANARY in registry.scan_values()

    def test_the_save_response_shows_a_shared_function_block_secret_input_as_a_credential(
        self,
    ) -> None:
        test_id = self._save_test_with_a_shared_function_block(
            secret=True, value=FUNCTION_INPUT_CANARY, elementType="function", version="1.0.0"
        )
        read = test_service.get_test(test_id)
        assert read is not None

        saved = test_service.update_test(test_id, {"workflow": read["workflow"]})

        assert saved is not None
        assert saved["repairs"] == []
        shown = saved["workflow"]["nodes"][0]["data"]["config"]["values"]["tok"]
        assert is_secret_envelope(shown)
        assert unseal_all(shown) == FUNCTION_INPUT_CANARY
        assert FUNCTION_INPUT_CANARY not in str(saved)

    def test_test_read_keeps_a_shared_function_block_secret_input_sealed(self) -> None:
        test_id = self._save_test_with_a_shared_function_block(
            secret=True, value=FUNCTION_INPUT_CANARY
        )

        read = test_service.get_test(test_id)

        assert read is not None
        shown = read["workflow"]["nodes"][0]["data"]["config"]["values"]["tok"]
        assert is_secret_envelope(shown)
        assert FUNCTION_INPUT_CANARY not in str(read)

    def test_the_credential_reveal_shows_a_shared_function_block_secret_input(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.core.secrets import masking_settings

        test_id = self._save_test_with_a_shared_function_block(
            secret=True, value=FUNCTION_INPUT_CANARY
        )
        monkeypatch.setattr(masking_settings, "is_credential_inputs_revealed", lambda: True)

        read = test_service.get_test(test_id)

        assert read is not None
        assert read["workflow"]["nodes"][0]["data"]["config"]["values"]["tok"] == (
            FUNCTION_INPUT_CANARY
        )

    def test_the_credential_reveal_shows_a_sealed_shared_function_block_secret_input(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.core.secrets import masking_settings

        test_id = self._save_test_with_a_shared_function_block(
            secret=True, value=seal_value(FUNCTION_INPUT_CANARY)
        )
        monkeypatch.setattr(masking_settings, "is_credential_inputs_revealed", lambda: True)

        read = test_service.get_test(test_id)

        assert read is not None
        assert read["workflow"]["nodes"][0]["data"]["config"]["values"]["tok"] == (
            FUNCTION_INPUT_CANARY
        )

    def test_the_test_variables_reveal_leaves_a_secret_input_sealed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.core.secrets import masking_settings

        test_id = self._save_test_with_secret_parameters()
        monkeypatch.setattr(masking_settings, "is_test_variables_revealed", lambda: True)

        read = test_service.get_test(test_id)

        assert read is not None
        data = read["workflow"]["nodes"][0]["data"]
        assert is_secret_envelope(data["config"]["values"]["tok"])
        assert data["localDefinition"]["variables"][0]["value"] == FUNCTION_LOCAL_CANARY

    def test_the_save_response_shows_a_secret_input_as_a_credential(self) -> None:
        block = self._secret_parameters_block()
        block["position"] = {"x": 0, "y": 0}
        block["data"].update(elementType="function", version="1.0.0")
        block["data"]["config"].update(profileBindings=[], outputBindings={})
        block["data"]["localDefinition"]["name"] = "secret_params_fn"
        workflow = {"nodes": [block], "edges": [{"source": "start-node", "target": "fn-secret"}]}
        created = test_service.create_test({"name": "secret input save", "workflow": workflow})
        read = test_service.get_test(created["id"])
        assert read is not None

        saved = test_service.update_test(created["id"], {"workflow": read["workflow"]})

        assert saved is not None
        assert saved["repairs"] == []
        data = saved["workflow"]["nodes"][0]["data"]
        assert is_secret_envelope(data["config"]["values"]["tok"])
        assert unseal_all(data["config"]["values"]["tok"]) == FUNCTION_INPUT_CANARY
        assert data["localDefinition"]["variables"][0]["value"] == MASK_PLACEHOLDER
        assert FUNCTION_INPUT_CANARY not in str(saved)


class TestSystemVariablesAtRest:
    def test_set_system_variables_stores_envelope_not_plaintext(self) -> None:
        response = variable_service.set_system_variables(_secret_variables(SYSTEM_VAR_CANARY))

        assert response["variables"]["api_token"]["value"] == MASK_PLACEHOLDER

        path = storage_paths.get_system_variables_file_path()
        raw_text = path.read_text()
        assert "wave:enc:v1:" in raw_text
        assert SYSTEM_VAR_CANARY not in raw_text

        stored = _read_yaml(path)
        assert is_secret_envelope(stored["variables"]["api_token"]["value"])
        assert unseal_all(stored["variables"]["api_token"]["value"]) == SYSTEM_VAR_CANARY
        assert stored["variables"]["host"]["value"] == "db.example.com"

    def test_placeholder_save_preserves_the_stored_secret(self) -> None:
        variable_service.set_system_variables(_secret_variables(SYSTEM_VAR_CANARY))
        path = storage_paths.get_system_variables_file_path()
        before = _read_yaml(path)["variables"]["api_token"]["value"]

        variable_service.set_system_variables(_masked_secret_submission())

        after = _read_yaml(path)["variables"]["api_token"]["value"]
        assert is_secret_envelope(after)
        assert unseal_all(after) == SYSTEM_VAR_CANARY
        assert after == before


class TestSuiteAndRegressionVariablesAtRest:
    def test_created_suite_stores_envelope_not_plaintext(self) -> None:
        created = suite_service.create_suite(
            {"name": "at-rest suite", "variables": _secret_variables(SUITE_VAR_CANARY)}
        )

        path = storage_paths.get_suites_storage_path() / created["id"] / "suite.yaml"
        raw_text = path.read_text()
        assert "wave:enc:v1:" in raw_text
        assert SUITE_VAR_CANARY not in raw_text

        stored = _read_yaml(path)
        assert unseal_all(stored["variables"]["api_token"]["value"]) == SUITE_VAR_CANARY
        assert stored["variables"]["host"]["value"] == "db.example.com"

    def test_created_regression_seals_definition_and_version_snapshot(self) -> None:
        created = regression_service.create_regression(
            {
                "name": "at-rest regression",
                "variables": _secret_variables(REGRESSION_VAR_CANARY),
            }
        )

        regression_dir = storage_paths.get_regressions_storage_path() / created["id"]
        for file in sorted(regression_dir.iterdir()):
            assert REGRESSION_VAR_CANARY not in file.read_text()

        stored = _read_yaml(regression_dir / "regression.yaml")
        assert unseal_all(stored["variables"]["api_token"]["value"]) == REGRESSION_VAR_CANARY

        versions = _read_yaml(regression_dir / "versions.yaml")
        snapshot_value = versions[0]["snapshot"]["variables"]["api_token"]["value"]
        assert unseal_all(snapshot_value) == REGRESSION_VAR_CANARY

    def test_suite_placeholder_save_preserves_the_stored_secret(self) -> None:
        created = suite_service.create_suite(
            {"name": "at-rest suite update", "variables": _secret_variables(SUITE_VAR_CANARY)}
        )
        path = storage_paths.get_suites_storage_path() / created["id"] / "suite.yaml"
        before = _read_yaml(path)["variables"]["api_token"]["value"]

        suite_service.update_suite(created["id"], {"variables": _masked_secret_submission()})

        after = _read_yaml(path)["variables"]["api_token"]["value"]
        assert is_secret_envelope(after)
        assert unseal_all(after) == SUITE_VAR_CANARY
        assert after == before

    def test_regression_placeholder_save_preserves_definition_and_snapshot(self) -> None:
        created = regression_service.create_regression(
            {
                "name": "at-rest regression update",
                "variables": _secret_variables(REGRESSION_VAR_CANARY),
            }
        )
        regression_dir = storage_paths.get_regressions_storage_path() / created["id"]
        before = _read_yaml(regression_dir / "regression.yaml")["variables"]["api_token"]["value"]

        regression_service.update_regression(
            created["id"], {"variables": _masked_secret_submission()}
        )

        stored = _read_yaml(regression_dir / "regression.yaml")
        after = stored["variables"]["api_token"]["value"]
        assert is_secret_envelope(after)
        assert unseal_all(after) == REGRESSION_VAR_CANARY
        assert after == before

        versions = _read_yaml(regression_dir / "versions.yaml")
        snapshot_value = versions[-1]["snapshot"]["variables"]["api_token"]["value"]
        assert unseal_all(snapshot_value) == REGRESSION_VAR_CANARY


class TestProfileCredentialsAtRest:
    def _create_profile(self) -> dict[str, Any]:
        return profile_service.create_profile(
            name="at-rest profile",
            profile_type="database",
            config={
                "host": "db.example.com",
                "port": 5432,
                "password": PROFILE_CANARY,
            },
            environment_values={"env-1": {"password": PROFILE_ENV_CANARY}},
        )

    def _disk_path(self, profile_id: str) -> Path:
        return storage_paths.get_profiles_storage_path() / profile_id / "profile.yaml"

    def test_created_profile_stores_envelopes_not_plaintext(self) -> None:
        created = self._create_profile()

        raw_text = self._disk_path(created["id"]).read_text()
        assert "wave:enc:v1:" in raw_text
        assert PROFILE_CANARY not in raw_text
        assert PROFILE_ENV_CANARY not in raw_text

        stored = _read_yaml(self._disk_path(created["id"]))
        assert is_secret_envelope(stored["config"]["password"])
        assert unseal_all(stored["config"]["password"]) == PROFILE_CANARY
        assert unseal_all(stored["environment_values"]["env-1"]["password"]) == PROFILE_ENV_CANARY
        assert stored["config"]["host"] == "db.example.com"
        assert stored["config"]["port"] == 5432

    def test_materialization_yields_real_credentials(self) -> None:
        created = self._create_profile()
        stored = _read_yaml(self._disk_path(created["id"]))
        assert is_secret_envelope(stored["config"]["password"])

        profile_common._clear_in_memory_cache()
        config = profile_service.get_profile_config_for_execution(created["id"], "")

        assert config is not None
        assert config["password"] == PROFILE_CANARY
        assert config["host"] == "db.example.com"

    def test_materialization_yields_real_environment_credentials(self) -> None:
        created = self._create_profile()

        profile_common._clear_in_memory_cache()
        config = profile_service.get_profile_config_for_execution(created["id"], "env-1")

        assert config is not None
        assert config["password"] == PROFILE_ENV_CANARY

    def test_api_read_still_masks_credentials(self) -> None:
        created = self._create_profile()

        profile_common._clear_in_memory_cache()
        fetched = profile_service.get_profile(created["id"])

        assert fetched is not None
        assert fetched["config"]["password"] == MASK_PLACEHOLDER

    def test_placeholder_update_preserves_the_stored_secret(self) -> None:
        created = self._create_profile()
        before = _read_yaml(self._disk_path(created["id"]))["config"]["password"]

        profile_service.update_profile(
            created["id"],
            config={"host": "db.example.com", "port": 5432, "password": MASK_PLACEHOLDER},
        )

        after = _read_yaml(self._disk_path(created["id"]))["config"]["password"]
        assert is_secret_envelope(after)
        assert unseal_all(after) == PROFILE_CANARY
        assert after == before


class TestExpressionEvaluationOnSealedSecrets:
    def test_string_expression_computes_on_the_real_value(self) -> None:
        context = {
            "variables": {
                "api_token": {
                    "type": "string",
                    "value": seal_value("hunter2-classified"),
                    "secret": True,
                }
            }
        }

        result = variable_service.evaluate_expression("len(api_token)", context)

        assert result["result"] == len("hunter2-classified")
        assert result["type"] == "integer"
        assert result["contains_secret"] is True

    def test_arithmetic_expression_computes_on_the_real_value(self) -> None:
        context = {
            "variables": {
                "secret_port": {
                    "type": "integer",
                    "value": seal_value(8080),
                    "secret": True,
                }
            }
        }

        result = variable_service.evaluate_expression("secret_port + 1", context)

        assert result["result"] == 8081
        assert result["type"] == "integer"
        assert result["contains_secret"] is True


PLUGIN_CRED_CANARY = "at-rest-plugin-cred-canary-909"
NESTED_PLUGIN_CRED_CANARY = "at-rest-nested-plugin-cred-canary-910"
_CRED_PLUGIN_TYPE = "stub-cred-plugin"


class _CredAtRestPlugin:
    """Stub plugin declaring one secret input param, for at-rest sealing."""

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


def _plugin_body_node(node_id: str, password: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Cred Body",
            "elementType": _CRED_PLUGIN_TYPE,
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {"password": password, "host": "example.com"}},
        },
    }


class TestPluginCredentialNodeAtRest:
    """REQ-3.1.3.18 / REQ-4.5.1: a literal typed into a plugin-declared credential
    input field is sealed at rest in the block's node config on disk, in the same
    envelope as a setter literal, and unseals to the real value at run."""

    @pytest.fixture(autouse=True)
    def _registered_cred_plugin(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        clear_registry()
        register_plugin(_CredAtRestPlugin())  # type: ignore[arg-type]
        yield
        clear_registry()

    def _workflow(self, node: dict[str, Any]) -> dict[str, Any]:
        return {"nodes": [node], "edges": []}

    def _save_plugin_test(self, workflow: dict[str, Any]) -> str:
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        test_service._save_test(
            {
                "id": test_id,
                "name": "plugin cred at-rest",
                "version": "1.0.0",
                "description": "",
                "workflow": workflow,
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )
        return test_id

    def _disk_path(self, test_id: str) -> Path:
        return storage_paths.get_tests_storage_path() / test_id / "test.yaml"

    def _plugin_values(self, test_id: str) -> dict[str, Any]:
        stored = _read_yaml(self._disk_path(test_id))
        return stored["workflow"]["nodes"][0]["data"]["config"]["values"]

    def test_credential_literal_is_sealed_on_disk(self) -> None:
        test_id = self._save_plugin_test(
            self._workflow(_plugin_body_node("p1", PLUGIN_CRED_CANARY))
        )

        raw_text = self._disk_path(test_id).read_text()
        assert "wave:enc:v1:" in raw_text
        assert PLUGIN_CRED_CANARY not in raw_text

        sealed = self._plugin_values(test_id)["password"]
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == PLUGIN_CRED_CANARY

    def test_non_credential_param_stays_plaintext(self) -> None:
        test_id = self._save_plugin_test(
            self._workflow(_plugin_body_node("p1", PLUGIN_CRED_CANARY))
        )

        assert self._plugin_values(test_id)["host"] == "example.com"

    def test_credential_literal_inside_function_body_is_sealed_on_disk(self) -> None:
        inner = _plugin_body_node("p1", NESTED_PLUGIN_CRED_CANARY)
        function_node = {
            "id": "fn1",
            "type": "workflowNode",
            "data": {
                "label": "Fn",
                "nodeType": "function",
                "functionLifecycle": "local",
                "localDefinition": {"workflow": {"nodes": [inner], "edges": []}},
            },
        }
        test_id = self._save_plugin_test(self._workflow(function_node))

        raw_text = self._disk_path(test_id).read_text()
        assert "wave:enc:v1:" in raw_text
        assert NESTED_PLUGIN_CRED_CANARY not in raw_text

        stored = _read_yaml(self._disk_path(test_id))
        nested = stored["workflow"]["nodes"][0]["data"]["localDefinition"]["workflow"]["nodes"][0]
        sealed = nested["data"]["config"]["values"]["password"]
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == NESTED_PLUGIN_CRED_CANARY
