"""An empty secret is stored empty: nothing is sealed or masked, so it reads back empty (REQ-4.5.1).

Every kind of secret slot is saved through the API with an empty value and read back three ways:
as stored, through the API read, and through the share-safe export mask. The same slots with a
real value are the control: sealed at rest, and masked on read and in the export.
"""

import json
import uuid
from collections.abc import Callable, Generator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.conftest import TEST_ENVIRONMENT_ID
from wavecore.api.services import storage_paths, variable_service
from wavecore.api.services.profiles import _common as profile_common
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.masking import (
    MASK_PLACEHOLDER,
    holds_secret_value,
    mask_io_payload,
    mask_structure,
    masked_declaration,
    structural_mask,
)
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.secrets.sealing import seal_profile, seal_value, unseal_all
from wavecore.plugins.opensearch import OpenSearchPlugin

REAL = "empty-secret-control-value"
_OS_URL = "https://opensearch.internal:9200"


@pytest.fixture(autouse=True)
def _fresh_state() -> Generator[None, None, None]:
    from wavecore.core.plugin_registry import clear_registry, register_plugin

    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False
    profile_common._clear_in_memory_cache()
    clear_registry()
    register_plugin(OpenSearchPlugin())
    yield
    clear_registry()
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False
    profile_common._clear_in_memory_cache()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _data(response: Any) -> Any:
    assert response.status_code < 300, response.text
    return response.json()["data"]


def _yaml(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _export(client: TestClient, url: str) -> Any:
    response = client.get(url, params={"format": "json", "secrets": "mask"})
    assert response.status_code == 200, response.text
    return json.loads(response.content)


# --- Profiles ------------------------------------------------------------------------------


def _profile_file(profile_id: str) -> Any:
    return _yaml(storage_paths.get_profiles_storage_path() / profile_id / "profile.yaml")


def _create_profile(client: TestClient, body: dict[str, Any]) -> str:
    return str(_data(client.post("/profiles", json={"name": f"p-{uuid.uuid4()}", **body}))["id"])


def _profile_read(client: TestClient, profile_id: str) -> Any:
    profile_common._clear_in_memory_cache()
    return _data(client.get(f"/profiles/{profile_id}"))


def _profile_export(client: TestClient, profile_id: str) -> Any:
    exported = _export(client, f"/profiles/{profile_id}/export")
    return exported.get("profile", exported)


def _config_slot(profile_type: str, field: str, extra: dict[str, Any]) -> "Slot":
    return Slot(
        name=f"profile {profile_type} {field}",
        save=lambda client, value: _create_profile(
            client, {"type": profile_type, "config": {**extra, field: value}}
        ),
        stored=lambda handle: _profile_file(handle)["config"][field],
        read=lambda client, handle: _profile_read(client, handle)["config"][field],
        exported=lambda client, handle: _profile_export(client, handle)["config"][field],
    )


def _typed_profile_slot() -> "Slot":
    def declaration(value: Any) -> dict[str, Any]:
        return {"type": "string", "value": value, "secret": True}

    return Slot(
        name="profile custom typed secret param",
        save=lambda client, value: _create_profile(
            client, {"type": "custom", "config": {"db_pass": declaration(value)}}
        ),
        stored=lambda handle: _profile_file(handle)["config"]["db_pass"]["value"],
        read=lambda client, handle: _profile_read(client, handle)["config"]["db_pass"]["value"],
        exported=lambda client, handle: _profile_export(client, handle)["config"]["db_pass"][
            "value"
        ],
    )


def _environment_profile_slot() -> "Slot":
    return Slot(
        name="profile environment value",
        save=lambda client, value: _create_profile(
            client,
            {
                "type": "opensearch",
                "config": {"url": _OS_URL},
                "environment_values": {TEST_ENVIRONMENT_ID: {"api_key": value}},
            },
        ),
        stored=lambda handle: _profile_file(handle)["environment_values"][TEST_ENVIRONMENT_ID][
            "api_key"
        ],
        read=lambda client, handle: _profile_read(client, handle)["environment_values"][
            TEST_ENVIRONMENT_ID
        ]["api_key"],
        # The export names the environment rather than its ID.
        exported=lambda client, handle: _profile_export(client, handle)["environment_values"][
            "Test Environment"
        ]["api_key"],
    )


# --- Tests: secret variables, Variable Setter rows, block credentials ------------------------


def _test_file(test_id: str) -> Any:
    return _yaml(storage_paths.get_tests_storage_path() / test_id / "test.yaml")


def _create_test(client: TestClient, body: dict[str, Any]) -> str:
    return str(_data(client.post("/tests", json={"name": f"t-{uuid.uuid4()}", **body}))["id"])


def _test_export(client: TestClient, test_id: str) -> Any:
    exported = _export(client, f"/tests/{test_id}/export")
    return exported.get("test", exported)


def _variable_slot(
    scope: str,
    create: Callable[[TestClient, dict[str, Any]], str],
    stored: Callable[[str], Any],
    read: Callable[[TestClient, str], Any],
    export: Callable[[TestClient, str], Any],
) -> "Slot":
    def variables(value: Any) -> dict[str, Any]:
        return {"tok": {"type": "string", "value": value, "secret": True}}

    return Slot(
        name=f"{scope} secret variable",
        save=lambda client, value: create(client, variables(value)),
        stored=lambda handle: stored(handle)["tok"]["value"],
        read=lambda client, handle: read(client, handle)["tok"]["value"],
        exported=lambda client, handle: export(client, handle)["tok"]["value"],
    )


def _setter_node(value: Any) -> dict[str, Any]:
    return {
        "id": "setter-1",
        "type": "workflowNode",
        "data": {
            "label": "Set",
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {"values": {"variables": {"tok": value}}, "variableSecretKeys": ["tok"]},
        },
    }


def _opensearch_node(value: Any) -> dict[str, Any]:
    return {
        "id": "search-1",
        "type": "workflowNode",
        "data": {
            "label": "Search",
            "elementType": "opensearch",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {"url": _OS_URL, "index": "logs-*", "api_key": value}},
        },
    }


# The row's variable is declared in the test; a setter row may only set a declared variable.
_SETTER_DECLARATION = {"tok": {"type": "string", "secret": True}}


def _node_slot(name: str, node: Callable[[Any], dict[str, Any]], path: list[str]) -> "Slot":
    def dig(workflow: Any) -> Any:
        found = workflow["nodes"][0]["data"]["config"]["values"]
        for key in path:
            found = found[key]
        return found

    return Slot(
        name=name,
        save=lambda client, value: _create_test(
            client,
            {"variables": _SETTER_DECLARATION, "workflow": {"nodes": [node(value)], "edges": []}},
        ),
        stored=lambda handle: dig(_test_file(handle)["workflow"]),
        read=lambda client, handle: dig(_data(client.get(f"/tests/{handle}"))["workflow"]),
        exported=lambda client, handle: dig(_test_export(client, handle)["workflow"]),
        read_shows_the_envelope=True,
    )


def _entity_scope_slot() -> "Slot":
    entity_id = str(uuid.uuid4())

    def save(client: TestClient, value: Any) -> str:
        body = {"variables": {"tok": {"type": "string", "value": value, "secret": True}}}
        _data(client.post(f"/variables/suite/{entity_id}", json=body))
        return entity_id

    return Slot(
        name="entity-scope secret variable",
        save=save,
        stored=lambda handle: variable_service._variable_storage["suite"][handle]["tok"]["value"],
        read=lambda client, handle: _data(client.get(f"/variables/suite/{handle}"))["variables"][
            "tok"
        ]["value"],
        exported=None,
    )


@dataclass(frozen=True)
class Slot:
    """One kind of secret slot: how to save a value into it and read it back three ways."""

    name: str
    save: Callable[[TestClient, Any], str]
    stored: Callable[[str], Any]
    read: Callable[[TestClient, str], Any]
    exported: Callable[[TestClient, str], Any] | None
    # A block's node config reads back as stored; the UI masks an envelope write-only.
    read_shows_the_envelope: bool = False


SLOTS = [
    _config_slot("custom", "token", {}),
    _config_slot("ssh", "passphrase", {"host": "ssh.internal"}),
    _config_slot("opensearch", "api_key", {"url": _OS_URL}),
    _config_slot("opensearch", "bearer_token", {"url": _OS_URL}),
    _typed_profile_slot(),
    _environment_profile_slot(),
    _variable_slot(
        "test",
        lambda client, variables: _create_test(client, {"variables": variables}),
        lambda handle: _test_file(handle)["variables"],
        lambda client, handle: _data(client.get(f"/tests/{handle}"))["variables"],
        lambda client, handle: _test_export(client, handle)["variables"],
    ),
    _variable_slot(
        "system",
        lambda client, variables: (
            _data(client.post("/variables/system", json={"variables": variables})) and "system"
        ),
        lambda _handle: _yaml(storage_paths.get_system_variables_file_path())["variables"],
        lambda client, _handle: _data(client.get("/variables/system"))["variables"],
        lambda client, _handle: _export(client, "/variables/system/export")["variables"],
    ),
    _variable_slot(
        "suite",
        lambda client, variables: str(
            _data(
                client.post("/suites", json={"name": f"s-{uuid.uuid4()}", "variables": variables})
            )["id"]
        ),
        lambda handle: _yaml(storage_paths.get_suites_storage_path() / handle / "suite.yaml")[
            "variables"
        ],
        lambda client, handle: _data(client.get(f"/suites/{handle}"))["variables"],
        lambda client, handle: _export(client, f"/suites/{handle}/export")["variables"],
    ),
    _entity_scope_slot(),
    _node_slot("Variable Setter secret row", _setter_node, ["variables", "tok"]),
    _node_slot("block credential param", _opensearch_node, ["api_key"]),
]
SLOT_IDS = [slot.name for slot in SLOTS]


@pytest.mark.parametrize("slot", SLOTS, ids=SLOT_IDS)
class TestEverySecretSlot:
    def test_an_empty_value_is_stored_read_and_exported_empty(
        self, slot: Slot, client: TestClient
    ) -> None:
        handle = slot.save(client, "")

        assert slot.stored(handle) == ""
        assert slot.read(client, handle) == ""
        if slot.exported is not None:
            assert slot.exported(client, handle) == ""

    def test_a_real_value_is_still_sealed_and_masked(self, slot: Slot, client: TestClient) -> None:
        handle = slot.save(client, REAL)

        stored = slot.stored(handle)
        assert is_secret_envelope(stored) and unseal_all(stored) == REAL
        read = slot.read(client, handle)
        assert read == (stored if slot.read_shows_the_envelope else MASK_PLACEHOLDER)
        if slot.exported is not None:
            assert slot.exported(client, handle) == MASK_PLACEHOLDER


class TestHoldsSecretValue:
    """The one rule: None and "" hold nothing; anything else, whitespace included, is a value."""

    @pytest.mark.parametrize("value", [None, ""])
    def test_nothing_is_held(self, value: Any) -> None:
        assert holds_secret_value(value) is False

    @pytest.mark.parametrize("value", [" ", "\t", "x", 0, False, [], {}, [""], {"k": ""}])
    def test_anything_else_is_a_value(self, value: Any) -> None:
        assert holds_secret_value(value) is True

    @pytest.mark.parametrize("value", [None, ""])
    def test_the_one_sealing_step_and_the_one_masking_step_leave_nothing_as_it_is(
        self, value: Any
    ) -> None:
        assert seal_value(value) is value
        assert structural_mask(value) is value

    def test_whitespace_is_sealed_and_masked(self) -> None:
        assert unseal_all(seal_value(" ")) == " "
        assert structural_mask(" ") == MASK_PLACEHOLDER


class TestDeclarations:
    """A declaration without a value, and one holding nothing, stay as they are."""

    @pytest.mark.parametrize(
        "declaration",
        [
            {"type": "string", "secret": True},
            {"type": "string", "secret": True, "value": ""},
            {"type": "string", "secret": True, "value": None},
        ],
    )
    def test_nothing_to_seal_or_mask(self, declaration: dict[str, Any]) -> None:
        config = {"db_pass": declaration}

        assert seal_profile(config, "custom") == config
        assert profile_common._mask_secrets(config, "custom") == config
        assert masked_declaration(declaration) == declaration
        assert masked_declaration(declaration, flag_masked=True) == declaration

    def test_a_held_value_is_masked_and_flagged_on_request(self) -> None:
        declaration = {"type": "map", "secret": True, "value": {"k": 1}, "elementTypes": {}}

        assert masked_declaration(declaration) == {
            "type": "map",
            "secret": True,
            "value": MASK_PLACEHOLDER,
        }
        assert masked_declaration(declaration, flag_masked=True)["masked"] is True


class TestRunLogSecretScan:
    """An empty secret registers nothing to scrub and shows empty in run displays."""

    def test_the_registry_holds_nothing_to_scrub(self) -> None:
        registry = SecretRegistry()
        registry.register("tok", "", "var")
        registry.register_value("", "param:api_key")

        assert registry.scan_values() == ()
        assert mask_structure({"tok": ""}, registry) == {"tok": ""}

    def test_a_flagged_name_holding_a_value_is_masked(self) -> None:
        registry = SecretRegistry()
        registry.register("tok", REAL, "var")

        assert mask_structure({"tok": REAL}, registry) == {"tok": MASK_PLACEHOLDER}

    def test_the_inputs_echo_leaves_an_empty_credential_empty(self) -> None:
        payload = {"api_key": "", "password": REAL, "headers": {"Authorization": ""}}

        assert mask_io_payload(payload, {"api_key", "password"}, {"authorization"}) == {
            "api_key": "",
            "password": MASK_PLACEHOLDER,
            "headers": {"Authorization": ""},
        }
