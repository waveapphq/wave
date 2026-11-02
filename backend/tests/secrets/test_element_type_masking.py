"""A secret map or list keeps its element types out of every read and in force at rest.

A masked secret shows no keys, no shape and no element count, so its element-type
record is hidden with its value; a save that echoes the masked value keeps the stored
record with the stored value (REQ-3.1.3.5, REQ-3.1.3.19).
"""

from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.services import shared, storage_paths, variable_service
from wavecore.api.services.profiles import _common as profile_common
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.tests import service as test_service
from wavecore.core.secrets import masking_settings
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import (
    mask_workflow_function_secrets,
    mask_workflow_node_secrets,
    restore_masked_workflow_secrets,
    seal_workflow_node_secrets,
    unseal_all,
    unseal_workflow_node_secrets,
)

SECRET_MAP = {
    "type": "map",
    "secret": True,
    "value": {"api_key": "k-1", "port": "8443"},
    "elementTypes": {"api_key": "string", "port": "integer"},
}
SECRET_LIST = {
    "type": "array",
    "secret": True,
    "value": ["16", "02134"],
    "elementTypes": ["integer", "string"],
}
PLAIN_MAP = {"type": "map", "value": {"n": "16"}, "elementTypes": {"n": "integer"}}


def _variables() -> dict[str, Any]:
    return {"sm": dict(SECRET_MAP), "sa": dict(SECRET_LIST), "pm": dict(PLAIN_MAP)}


def _echoed() -> dict[str, Any]:
    """The masked read of the variables, as a client sends it back unchanged."""
    return {
        "sm": {"type": "map", "secret": True, "value": MASK_PLACEHOLDER},
        "sa": {"type": "array", "secret": True, "value": MASK_PLACEHOLDER},
        "pm": dict(PLAIN_MAP),
    }


def _read_yaml(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _assert_opaque(variables: dict[str, Any]) -> None:
    for name in ("sm", "sa"):
        assert variables[name]["value"] == MASK_PLACEHOLDER
        assert "elementTypes" not in variables[name]
    assert variables["pm"]["elementTypes"] == {"n": "integer"}


def _assert_stored(stored: dict[str, Any]) -> None:
    assert unseal_all(stored["sm"]["value"]) == SECRET_MAP["value"]
    assert stored["sm"]["elementTypes"] == SECRET_MAP["elementTypes"]
    assert unseal_all(stored["sa"]["value"]) == SECRET_LIST["value"]
    assert stored["sa"]["elementTypes"] == SECRET_LIST["elementTypes"]


@pytest.fixture(autouse=True)
def _fresh_service_state() -> Generator[None, None, None]:
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False
    profile_common._clear_in_memory_cache()
    yield
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False
    profile_common._clear_in_memory_cache()


class TestTestVariables:
    def _disk(self, test_id: str) -> dict[str, Any]:
        path = storage_paths.get_tests_storage_path() / test_id / "test.yaml"
        return dict(_read_yaml(path)["variables"])

    def test_the_read_hides_a_secrets_element_types(self) -> None:
        created = test_service.create_test({"name": "typed secrets", "variables": _variables()})

        _assert_opaque(created["variables"])
        read = test_service.get_test_variables(created["id"])
        assert read is not None
        _assert_opaque(read)

    def test_a_masked_resave_keeps_the_stored_element_types(self) -> None:
        created = test_service.create_test({"name": "typed secrets", "variables": _variables()})

        test_service.update_test(created["id"], {"variables": _echoed()})

        _assert_stored(self._disk(created["id"]))

    def test_a_masked_export_hides_a_secrets_element_types(self) -> None:
        _assert_opaque(shared.apply_secrets_mode_to_variables(_variables(), "mask"))

    def test_an_encrypted_export_keeps_every_element_type(self) -> None:
        exported = shared.apply_secrets_mode_to_variables(_variables(), "encrypted")

        assert exported["sm"]["elementTypes"] == SECRET_MAP["elementTypes"]
        assert exported["sa"]["elementTypes"] == SECRET_LIST["elementTypes"]


class TestSuiteVariables:
    def _disk(self, suite_id: str) -> dict[str, Any]:
        path = storage_paths.get_suites_storage_path() / suite_id / "suite.yaml"
        return dict(_read_yaml(path)["variables"])

    def test_the_read_hides_a_secrets_element_types(self) -> None:
        created = suite_service.create_suite({"name": "typed secrets", "variables": _variables()})

        fetched = suite_service.get_suite(created["id"])
        assert fetched is not None
        _assert_opaque(fetched["variables"])

    def test_a_revealed_read_keeps_the_element_types(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(masking_settings, "is_shared_variables_revealed", lambda: True)

        revealed = shared.read_secret_variables(_variables())

        assert revealed["sm"]["elementTypes"] == SECRET_MAP["elementTypes"]

    def test_a_masked_resave_keeps_the_stored_element_types(self) -> None:
        created = suite_service.create_suite({"name": "typed secrets", "variables": _variables()})

        suite_service.update_suite(created["id"], {"variables": _echoed()})

        _assert_stored(self._disk(created["id"]))


class TestSystemVariables:
    def _disk(self) -> dict[str, Any]:
        return dict(_read_yaml(storage_paths.get_system_variables_file_path())["variables"])

    def test_the_read_hides_a_secrets_element_types(self) -> None:
        response = variable_service.set_system_variables(_variables())

        _assert_opaque(response["variables"])

    def test_a_revealed_read_keeps_the_element_types(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(masking_settings, "is_shared_variables_revealed", lambda: True)

        response = variable_service.set_system_variables(_variables())

        assert response["variables"]["sa"]["elementTypes"] == SECRET_LIST["elementTypes"]

    def test_a_masked_resave_keeps_the_stored_element_types(self) -> None:
        variable_service.set_system_variables(_variables())

        variable_service.set_system_variables(_echoed())

        _assert_stored(self._disk())


class TestProfileFields:
    def _create(self) -> dict[str, Any]:
        return profile_service.create_profile(
            name="typed secret profile",
            profile_type="custom",
            config={"creds": dict(SECRET_MAP), "plain": dict(PLAIN_MAP)},
            environment_values={"env-1": {"creds": dict(SECRET_MAP), "plain": dict(PLAIN_MAP)}},
        )

    def test_the_read_hides_a_secret_fields_element_types(self) -> None:
        created = self._create()

        fetched = profile_service.get_profile(created["id"])
        assert fetched is not None
        for config in (fetched["config"], fetched["environment_values"]["env-1"]):
            assert config["creds"]["value"] == MASK_PLACEHOLDER
            assert "elementTypes" not in config["creds"]
            assert config["plain"]["elementTypes"] == {"n": "integer"}

    def test_a_masked_resave_keeps_the_stored_element_types(self) -> None:
        created = self._create()
        echoed = {"type": "map", "secret": True, "value": MASK_PLACEHOLDER}

        profile_service.update_profile(
            created["id"],
            environment_values={"env-1": {"creds": echoed, "plain": dict(PLAIN_MAP)}},
        )

        path = storage_paths.get_profiles_storage_path() / created["id"] / "profile.yaml"
        stored = _read_yaml(path)["environment_values"]["env-1"]["creds"]
        assert unseal_all(stored["value"]) == SECRET_MAP["value"]
        assert stored["elementTypes"] == SECRET_MAP["elementTypes"]


class TestRestoringEchoedSecrets:
    def test_the_stored_element_types_win_over_echoed_ones(self) -> None:
        echoed = {"sm": {**_echoed()["sm"], "elementTypes": {"other": "float"}}}

        restored = shared.restore_masked_secrets(echoed, {"sm": dict(SECRET_MAP)})

        assert restored["sm"]["elementTypes"] == SECRET_MAP["elementTypes"]

    def test_a_retyped_secret_takes_no_stored_element_types(self) -> None:
        echoed = {"sm": {"type": "array", "secret": True, "value": MASK_PLACEHOLDER}}

        restored = shared.restore_masked_secrets(echoed, {"sm": dict(SECRET_MAP)})

        assert restored["sm"] == {"type": "array", "secret": True, "value": SECRET_MAP["value"]}

    def test_a_stored_secret_without_element_types_restores_none(self) -> None:
        stored = {"type": "map", "secret": True, "value": {"a": "1"}}

        restored = shared.restore_masked_secrets({"sm": _echoed()["sm"]}, {"sm": stored})

        assert restored["sm"] == stored

    def test_a_new_secret_value_keeps_its_own_element_types(self) -> None:
        sent = {
            "sm": {**SECRET_MAP, "value": {"api_key": "k-2"}, "elementTypes": {"api_key": "string"}}
        }

        restored = shared.restore_masked_secrets(sent, {"sm": dict(SECRET_MAP)})

        assert restored["sm"]["elementTypes"] == {"api_key": "string"}


class TestSetterRowsInAMaskedExport:
    def test_a_secret_rows_element_types_leave_with_its_value(self) -> None:
        workflow = {
            "nodes": [
                {
                    "id": "set-1",
                    "data": {
                        "elementType": "variable-setter",
                        "variableElementTypes": {
                            "secret_map": {"api_key": "string"},
                            "plain_map": {"n": "integer"},
                        },
                        "config": {
                            "values": {
                                "variables": {
                                    "secret_map": {"api_key": "k-1"},
                                    "plain_map": {"n": "16"},
                                }
                            },
                            "variableSecretKeys": ["secret_map"],
                        },
                    },
                },
                {"id": "log-1", "data": {"elementType": "log", "config": {"values": {}}}},
                {
                    "id": "fn-1",
                    "data": {
                        "elementType": "function",
                        "localDefinition": {
                            "workflow": {
                                "nodes": [
                                    {
                                        "id": "set-2",
                                        "data": {
                                            "elementType": "variable-setter",
                                            "variableElementTypes": {"only_secret": ["integer"]},
                                            "config": {
                                                "values": {"variables": {"only_secret": ["7"]}},
                                                "variableSecretKeys": ["only_secret"],
                                            },
                                        },
                                    }
                                ]
                            }
                        },
                    },
                },
            ]
        }

        masked = mask_workflow_node_secrets(workflow)

        first = masked["nodes"][0]["data"]
        nested = masked["nodes"][2]["data"]["localDefinition"]["workflow"]["nodes"][0]["data"]
        assert first["config"]["values"]["variables"]["secret_map"] == MASK_PLACEHOLDER
        assert first["variableElementTypes"] == {"plain_map": {"n": "integer"}}
        assert nested["config"]["values"]["variables"]["only_secret"] == MASK_PLACEHOLDER
        assert "variableElementTypes" not in nested
        assert masked["nodes"][1] == workflow["nodes"][1]
        assert workflow["nodes"][0]["data"]["variableElementTypes"]["secret_map"] == {
            "api_key": "string"
        }

    def test_a_setter_without_element_types_is_left_alone(self) -> None:
        workflow = {
            "nodes": [
                {
                    "id": "set-1",
                    "data": {
                        "elementType": "variable-setter",
                        "config": {
                            "values": {"variables": {"token": "t"}},
                            "variableSecretKeys": ["token"],
                        },
                    },
                }
            ]
        }

        masked = mask_workflow_node_secrets(workflow)

        assert "variableElementTypes" not in masked["nodes"][0]["data"]


def _setter_workflow() -> dict[str, Any]:
    """A setter with a secret typed map, a plain typed map and a secret row in a Function body."""
    return {
        "nodes": [
            {
                "id": "set-1",
                "data": {
                    "elementType": "variable-setter",
                    "variableElementTypes": {
                        "secret_map": {"api_key": "string", "port": "integer"},
                        "plain_map": {"n": "integer"},
                    },
                    "config": {
                        "values": {
                            "variables": {
                                "secret_map": {"api_key": "k-1", "port": "8443"},
                                "plain_map": {"n": "16"},
                            }
                        },
                        "variableSecretKeys": ["secret_map"],
                    },
                },
            },
            {
                "id": "fn-1",
                "data": {
                    "elementType": "function",
                    "localDefinition": {
                        "workflow": {
                            "nodes": [
                                {
                                    "id": "set-2",
                                    "data": {
                                        "elementType": "variable-setter",
                                        "variableElementTypes": {"only_secret": ["integer"]},
                                        "config": {
                                            "values": {"variables": {"only_secret": ["7"]}},
                                            "variableSecretKeys": ["only_secret"],
                                        },
                                    },
                                }
                            ]
                        }
                    },
                },
            },
        ]
    }


def _setter_data(workflow: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    first = workflow["nodes"][0]["data"]
    nested = workflow["nodes"][1]["data"]["localDefinition"]["workflow"]["nodes"][0]["data"]
    return first, nested


class TestSetterRowsSealedAtRest:
    def test_a_secret_rows_element_types_are_sealed_with_its_value(self) -> None:
        sealed = seal_workflow_node_secrets(_setter_workflow())

        first, nested = _setter_data(sealed)
        assert is_secret_envelope(first["variableElementTypes"]["secret_map"])
        assert "api_key" not in first["variableElementTypes"]["secret_map"]
        assert first["variableElementTypes"]["plain_map"] == {"n": "integer"}
        assert is_secret_envelope(nested["variableElementTypes"]["only_secret"])

    def test_unsealing_gives_the_element_types_back(self) -> None:
        unsealed = unseal_workflow_node_secrets(seal_workflow_node_secrets(_setter_workflow()))

        first, nested = _setter_data(unsealed)
        assert first["variableElementTypes"]["secret_map"] == {
            "api_key": "string",
            "port": "integer",
        }
        assert first["config"]["values"]["variables"]["secret_map"] == {
            "api_key": "k-1",
            "port": "8443",
        }
        assert nested["variableElementTypes"]["only_secret"] == ["integer"]

    def test_sealing_a_sealed_workflow_changes_nothing(self) -> None:
        once = seal_workflow_node_secrets(_setter_workflow())
        assert seal_workflow_node_secrets(once) == once

    def test_a_masked_export_of_a_sealed_setter_drops_the_secret_rows_element_types(self) -> None:
        masked = mask_workflow_node_secrets(seal_workflow_node_secrets(_setter_workflow()))

        first, nested = _setter_data(masked)
        assert first["variableElementTypes"] == {"plain_map": {"n": "integer"}}
        assert "variableElementTypes" not in nested

    def test_a_secret_row_without_element_types_gets_none(self) -> None:
        workflow = _setter_workflow()
        first, _nested = _setter_data(workflow)
        del first["variableElementTypes"]["secret_map"]

        sealed_first, _ = _setter_data(seal_workflow_node_secrets(workflow))

        assert sealed_first["variableElementTypes"] == {"plain_map": {"n": "integer"}}


def _function_local_workflow(local: dict[str, Any]) -> dict[str, Any]:
    """A Test workflow whose one Local Function declares ``local`` as its variable ``sm``."""
    return {
        "nodes": [
            {
                "id": "fn-1",
                "data": {
                    "nodeType": "function",
                    "functionLifecycle": "local",
                    "localDefinition": {
                        "variables": [{"name": "sm", **local}],
                        "workflow": {"nodes": [], "edges": []},
                    },
                },
            }
        ]
    }


def _local(workflow: dict[str, Any]) -> dict[str, Any]:
    local: dict[str, Any] = workflow["nodes"][0]["data"]["localDefinition"]["variables"][0]
    return local


class _MapCredentialPlugin:
    """A stub block declaring one map credential field."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "stub-map-credential",
            "version": "1.0.0",
            "parameters": [{"name": "headers", "type": "map", "secret": True}],
        }


class TestRestoringEchoedWorkflowSecrets:
    """A workflow echoed with its placeholders keeps the secrets stored at the same places,
    with the element types that travel with them (EXPORT-7, REQ-3.1.3.5)."""

    def test_a_masked_setter_row_gets_its_value_and_element_types_back(self) -> None:
        stored = seal_workflow_node_secrets(_setter_workflow())

        restored = restore_masked_workflow_secrets(mask_workflow_node_secrets(stored), stored)

        assert restored == stored

    def test_a_masked_function_local_gets_its_value_and_element_types_back(self) -> None:
        stored = seal_workflow_node_secrets(_function_local_workflow(SECRET_MAP))
        echoed = mask_workflow_function_secrets(stored)
        assert "elementTypes" not in _local(echoed)

        restored = restore_masked_workflow_secrets(echoed, stored)

        assert restored == stored

    def test_a_retyped_function_local_takes_no_stored_element_types(self) -> None:
        stored = seal_workflow_node_secrets(_function_local_workflow(SECRET_MAP))
        echoed = mask_workflow_function_secrets(stored)
        _local(echoed)["type"] = "string"

        restored = _local(restore_masked_workflow_secrets(echoed, stored))

        assert restored["value"] == _local(stored)["value"]
        assert "elementTypes" not in restored

    def test_a_masked_map_credential_keeps_each_stored_item(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.core import plugin_registry

        monkeypatch.setitem(
            plugin_registry._registry._plugins,
            "stub-map-credential",
            {"1.0.0": _MapCredentialPlugin()},
        )
        block = {
            "id": "call-1",
            "data": {
                "elementType": "stub-map-credential",
                "version": "1.0.0",
                "config": {"values": {"headers": {"a": "first", "b": "second"}}},
            },
        }
        stored = seal_workflow_node_secrets({"nodes": [block]})
        echoed = mask_workflow_node_secrets(stored)
        echoed["nodes"][0]["data"]["config"]["values"]["headers"]["b"] = "typed again"

        restored = restore_masked_workflow_secrets(echoed, stored)

        headers = restored["nodes"][0]["data"]["config"]["values"]["headers"]
        assert headers["a"] == stored["nodes"][0]["data"]["config"]["values"]["headers"]["a"]
        assert unseal_all(headers["a"]) == "first"
        assert headers["b"] == "typed again"
