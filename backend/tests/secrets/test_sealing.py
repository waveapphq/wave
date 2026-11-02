"""Sealing helpers and locators contract (REQ-4.5.1).

`seal_value` / `unseal_all` wrap the cipher for arbitrary values;
`seal_variables` seals only secret-flagged variable values and
`seal_profile` seals only the per-type secret credential fields,
leaving every non-secret leaf untouched. All locators are idempotent.
"""

import copy
from collections.abc import Generator
from typing import Any

import pytest

from wavecore.core.secrets import sealing
from wavecore.core.secrets.cipher import SecretCipher, SecretDecryptionError, is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import (
    seal_profile,
    seal_value,
    seal_variables,
    unseal_all,
)

# A key distinct from the suite-wide test key so its envelopes fail local unseal.
_FOREIGN_KEY = bytes(range(1, 33))


class TestSealValue:
    def test_seal_value_returns_an_envelope(self) -> None:
        envelope = seal_value("hunter2-classified")

        assert is_secret_envelope(envelope)

    def test_unseal_all_restores_a_sealed_value(self) -> None:
        assert unseal_all(seal_value("hunter2-classified")) == "hunter2-classified"

    def test_seal_value_is_idempotent(self) -> None:
        envelope = seal_value("hunter2-classified")

        assert seal_value(envelope) == envelope


class TestUnsealAll:
    @pytest.mark.parametrize(
        "value",
        [
            "plain-string",
            42,
            3.5,
            True,
            None,
            ["a", 1],
            {"k": "v"},
        ],
    )
    def test_non_envelope_values_pass_through_unchanged(self, value: Any) -> None:
        assert unseal_all(value) == value

    def test_restores_envelopes_nested_in_dicts_and_lists(self) -> None:
        nested = {
            "outer": {
                "items": [seal_value("nested-secret-1"), 5, {"deep": seal_value(42)}],
            },
            "plain": "keep-me",
        }

        result = unseal_all(nested)

        assert result == {
            "outer": {"items": ["nested-secret-1", 5, {"deep": 42}]},
            "plain": "keep-me",
        }

    @pytest.mark.parametrize(
        "value",
        [
            "string-secret-value",
            42,
            3.5,
            False,
            ["alpha", "beta"],
            {"user": "svc", "pass": "p4ss-value"},
            {"headers": ["h1"], "rows": [["r1c1"]]},
        ],
    )
    def test_original_json_type_is_restored(self, value: Any) -> None:
        unsealed = unseal_all(seal_value(value))

        assert unsealed == value
        assert type(unsealed) is type(value)

    def test_input_structure_is_not_mutated(self) -> None:
        nested = {"cred": seal_value("do-not-mutate-me")}
        snapshot = copy.deepcopy(nested)

        unseal_all(nested)

        assert nested == snapshot
        assert is_secret_envelope(nested["cred"])


class TestSealVariables:
    def _variables(self) -> dict[str, Any]:
        return {
            "api_token": {"type": "string", "value": "tok-classified-123", "secret": True},
            "host": {"type": "string", "value": "db.example.com"},
            "opted_out": {"type": "string", "value": "visible-value", "secret": False},
        }

    def test_seals_only_secret_flagged_values(self) -> None:
        result = seal_variables(self._variables())

        assert is_secret_envelope(result["api_token"]["value"])
        assert result["host"] == {"type": "string", "value": "db.example.com"}
        assert result["opted_out"] == {
            "type": "string",
            "value": "visible-value",
            "secret": False,
        }

    def test_preserves_all_other_keys_on_the_secret_entry(self) -> None:
        variables = {
            "api_token": {
                "type": "string",
                "value": "tok-classified-123",
                "secret": True,
                "description": "service token",
            }
        }

        result = seal_variables(variables)

        entry = result["api_token"]
        assert entry["type"] == "string"
        assert entry["secret"] is True
        assert entry["description"] == "service token"

    @pytest.mark.parametrize(
        ("wave_type", "value"),
        [
            ("string", "string-secret-value"),
            ("integer", 8080),
            ("float", 2.5),
            ("boolean", True),
            ("array", ["item-1", "item-2"]),
            ("map", {"user": "svc", "pass": "p4ss-value"}),
            ("table", {"headers": ["h1"], "rows": [["r1c1", "r1c2"]]}),
        ],
    )
    def test_round_trips_every_variable_type(self, wave_type: str, value: Any) -> None:
        result = seal_variables({"cred": {"type": wave_type, "value": value, "secret": True}})

        sealed = result["cred"]["value"]
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == value

    def test_resealing_sealed_variables_is_a_no_op(self) -> None:
        once = seal_variables(self._variables())

        twice = seal_variables(once)

        assert twice == once

    def test_input_dict_is_not_mutated(self) -> None:
        variables = self._variables()

        seal_variables(variables)

        assert variables["api_token"]["value"] == "tok-classified-123"

    def test_non_dict_entries_pass_through_unchanged(self) -> None:
        result = seal_variables({"legacy": "bare-value"})

        assert result["legacy"] == "bare-value"

    def test_an_unset_secret_is_left_valueless(self) -> None:
        """No value key means nothing to seal, so no envelope is written."""
        result = seal_variables({"tok": {"type": "string", "secret": True}})

        assert result["tok"] == {"type": "string", "secret": True}
        assert "value" not in result["tok"]

    def test_a_secret_holding_an_empty_string_is_left_empty(self) -> None:
        """An empty secret holds nothing, so nothing is sealed (REQ-4.5.1)."""
        result = seal_variables({"tok": {"type": "string", "value": "", "secret": True}})

        assert result["tok"] == {"type": "string", "value": "", "secret": True}

    def test_an_unset_secret_survives_repeated_sealing_untouched(self) -> None:
        once = seal_variables({"tok": {"type": "string", "secret": True}})

        assert seal_variables(once) == once


class TestSealProfile:
    @pytest.mark.parametrize(
        ("profile_type", "field"),
        [
            ("database", "password"),
            ("ssh", "password"),
            ("ssh", "private_key"),
            ("ssh", "passphrase"),
            ("http", "auth_key"),
            ("http", "auth_token"),
            ("http", "auth_password"),
            ("http", "client_key"),
            ("kubernetes", "token"),
            ("kubernetes", "client_key"),
            ("opensearch", "password"),
            ("opensearch", "api_key"),
            ("opensearch", "bearer_token"),
            ("opensearch", "client_key"),
        ],
    )
    def test_seals_each_per_type_secret_field(self, profile_type: str, field: str) -> None:
        config = {field: "credential-classified-value"}

        result = seal_profile(config, profile_type)

        assert is_secret_envelope(result[field])
        assert unseal_all(result[field]) == "credential-classified-value"

    def test_non_secret_fields_are_left_untouched(self) -> None:
        config = {
            "host": "db.example.com",
            "port": 5432,
            "username": "svc-account",
            "password": "db-password-classified",
        }

        result = seal_profile(config, "database")

        assert result["host"] == "db.example.com"
        assert result["port"] == 5432
        assert result["username"] == "svc-account"
        assert is_secret_envelope(result["password"])

    def test_kubernetes_ca_cert_is_not_sealed(self) -> None:
        config = {
            "token": "k8s-token-classified",
            "ca_cert": "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
            "api_url": "https://cluster.example.com:6443",
        }

        result = seal_profile(config, "kubernetes")

        assert is_secret_envelope(result["token"])
        assert result["ca_cert"] == config["ca_cert"]
        assert result["api_url"] == config["api_url"]

    def test_opensearch_connection_and_trust_fields_are_not_sealed(self) -> None:
        config = {
            "bearer_token": "os-token-classified",
            "url": "https://opensearch.internal:9200",
            "username": "reader",
            "verify_ssl": True,
            "ca_cert": "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
            "client_cert": "-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----",
        }

        result = seal_profile(config, "opensearch")

        assert is_secret_envelope(result["bearer_token"])
        assert {name: value for name, value in result.items() if name != "bearer_token"} == {
            name: value for name, value in config.items() if name != "bearer_token"
        }

    def test_custom_typed_value_with_secret_flag_is_sealed_inside_wrapper(self) -> None:
        config = {
            "api_secret": {"type": "string", "value": "custom-classified", "secret": True},
            "endpoint": {"type": "string", "value": "https://api.example.com"},
        }

        result = seal_profile(config, "custom")

        sealed = result["api_secret"]
        assert sealed["type"] == "string"
        assert sealed["secret"] is True
        assert is_secret_envelope(sealed["value"])
        assert unseal_all(sealed["value"]) == "custom-classified"
        assert result["endpoint"] == config["endpoint"]

    def test_custom_flat_secret_field_name_is_sealed(self) -> None:
        config = {"password": "flat-custom-classified", "host": "custom.example.com"}

        result = seal_profile(config, "custom")

        assert is_secret_envelope(result["password"])
        assert result["host"] == "custom.example.com"

    def test_absent_secret_fields_are_not_added(self) -> None:
        config = {"host": "db.example.com", "port": 5432}

        result = seal_profile(config, "database")

        assert set(result.keys()) == {"host", "port"}

    def test_resealing_a_sealed_profile_is_a_no_op(self) -> None:
        config = {"host": "db.example.com", "password": "db-password-classified"}

        once = seal_profile(config, "database")
        twice = seal_profile(once, "database")

        assert twice == once

    def test_input_config_is_not_mutated(self) -> None:
        config = {"password": "db-password-classified"}

        seal_profile(config, "database")

        assert config["password"] == "db-password-classified"

    def test_unseal_all_restores_the_full_config(self) -> None:
        config = {
            "host": "db.example.com",
            "password": "db-password-classified",
        }

        assert unseal_all(seal_profile(config, "database")) == config


class TestUnsealVariables:
    def _sealed(self) -> dict[str, Any]:
        return seal_variables(
            {
                "api_token": {"type": "string", "value": "tok-classified-123", "secret": True},
                "host": {"type": "string", "value": "db.example.com"},
                "opted_out": {"type": "string", "value": "visible-value", "secret": False},
            }
        )

    def test_unseals_only_secret_flagged_values(self) -> None:
        result = sealing.unseal_variables(self._sealed())

        assert result["api_token"]["value"] == "tok-classified-123"
        assert result["host"] == {"type": "string", "value": "db.example.com"}
        assert result["opted_out"] == {
            "type": "string",
            "value": "visible-value",
            "secret": False,
        }

    def test_preserves_all_other_keys_on_the_secret_entry(self) -> None:
        sealed = seal_variables(
            {
                "api_token": {
                    "type": "string",
                    "value": "tok-classified-123",
                    "secret": True,
                    "description": "service token",
                }
            }
        )

        result = sealing.unseal_variables(sealed)

        entry = result["api_token"]
        assert entry["type"] == "string"
        assert entry["secret"] is True
        assert entry["description"] == "service token"
        assert entry["value"] == "tok-classified-123"

    @pytest.mark.parametrize(
        ("wave_type", "value"),
        [
            ("string", "string-secret-value"),
            ("integer", 8080),
            ("float", 2.5),
            ("boolean", True),
            ("array", ["item-1", "item-2"]),
            ("map", {"user": "svc", "pass": "p4ss-value"}),
            ("table", {"headers": ["h1"], "rows": [["r1c1", "r1c2"]]}),
        ],
    )
    def test_round_trips_every_variable_type(self, wave_type: str, value: Any) -> None:
        sealed = seal_variables({"cred": {"type": wave_type, "value": value, "secret": True}})

        result = sealing.unseal_variables(sealed)

        assert result["cred"]["value"] == value
        assert type(result["cred"]["value"]) is type(value)

    def test_seal_then_unseal_is_identity(self) -> None:
        original = {
            "api_token": {"type": "string", "value": "tok-classified-123", "secret": True},
            "host": {"type": "string", "value": "db.example.com"},
        }

        assert sealing.unseal_variables(seal_variables(original)) == original

    def test_secret_flagged_non_envelope_value_passes_through(self) -> None:
        variables = {"api_token": {"type": "string", "value": "not-sealed", "secret": True}}

        result = sealing.unseal_variables(variables)

        assert result["api_token"]["value"] == "not-sealed"

    def test_non_secret_envelope_is_left_sealed(self) -> None:
        sealed_value = seal_value("should-stay-sealed")
        variables = {"note": {"type": "string", "value": sealed_value, "secret": False}}

        result = sealing.unseal_variables(variables)

        assert result["note"]["value"] == sealed_value
        assert is_secret_envelope(result["note"]["value"])

    def test_secret_entry_without_value_passes_through(self) -> None:
        variables = {"api_token": {"type": "string", "secret": True}}

        result = sealing.unseal_variables(variables)

        assert result["api_token"] == {"type": "string", "secret": True}

    def test_non_dict_entries_pass_through_unchanged(self) -> None:
        result = sealing.unseal_variables({"legacy": "bare-value"})

        assert result["legacy"] == "bare-value"

    def test_input_dict_is_not_mutated(self) -> None:
        sealed = self._sealed()
        original_value = sealed["api_token"]["value"]

        sealing.unseal_variables(sealed)

        assert sealed["api_token"]["value"] == original_value
        assert is_secret_envelope(sealed["api_token"]["value"])

    def test_wrong_key_envelope_raises_decryption_error(self) -> None:
        foreign = SecretCipher(_FOREIGN_KEY).seal("cross-instance-secret")
        variables = {"api_token": {"type": "string", "value": foreign, "secret": True}}

        with pytest.raises(SecretDecryptionError):
            sealing.unseal_variables(variables)


def _setter_node(
    node_id: str,
    variables: dict[str, Any],
    secret_keys: list[str],
) -> dict[str, Any]:
    """A Variable Setter workflow node carrying a flat variables map plus the
    list of setter targets flagged secret (config.variableSecretKeys)."""
    return {
        "id": node_id,
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


def _node_variables(node: dict[str, Any]) -> dict[str, Any]:
    return node["data"]["config"]["values"]["variables"]


class TestSealWorkflowNodeSecrets:
    def test_seals_values_named_in_variable_secret_keys(self) -> None:
        workflow = {
            "nodes": [
                _setter_node("s1", {"api_key": "sk-live-classified", "count": "5"}, ["api_key"])
            ],
            "edges": [],
        }

        result = sealing.seal_workflow_node_secrets(workflow)

        assert is_secret_envelope(_node_variables(result["nodes"][0])["api_key"])

    def test_leaves_non_secret_setter_values_plaintext(self) -> None:
        workflow = {
            "nodes": [
                _setter_node("s1", {"api_key": "sk-live-classified", "count": "5"}, ["api_key"])
            ],
            "edges": [],
        }

        result = sealing.seal_workflow_node_secrets(workflow)

        assert _node_variables(result["nodes"][0])["count"] == "5"

    def test_sealed_value_unseals_to_the_literal(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"api_key": "sk-live-classified"}, ["api_key"])]}

        result = sealing.seal_workflow_node_secrets(workflow)

        sealed = _node_variables(result["nodes"][0])["api_key"]
        assert unseal_all(sealed) == "sk-live-classified"

    def test_setter_without_secret_keys_is_untouched(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"api_key": "sk-live-classified"}, [])]}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert _node_variables(result["nodes"][0])["api_key"] == "sk-live-classified"

    def test_non_setter_nodes_are_untouched(self) -> None:
        plugin_node = {
            "id": "log-1",
            "type": "workflowNode",
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
                "config": {"values": {"message": "sk-live-classified"}},
            },
        }
        workflow = {"nodes": [plugin_node], "edges": []}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert result["nodes"][0]["data"]["config"]["values"]["message"] == "sk-live-classified"

    def test_secret_key_absent_from_values_is_skipped(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"count": "5"}, ["api_key"])]}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert _node_variables(result["nodes"][0]) == {"count": "5"}

    def test_is_idempotent(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"api_key": "sk-live-classified"}, ["api_key"])]}

        once = sealing.seal_workflow_node_secrets(workflow)
        twice = sealing.seal_workflow_node_secrets(once)

        assert twice == once

    def test_input_workflow_is_not_mutated(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"api_key": "sk-live-classified"}, ["api_key"])]}
        snapshot = copy.deepcopy(workflow)

        sealing.seal_workflow_node_secrets(workflow)

        assert workflow == snapshot
        assert _node_variables(workflow["nodes"][0])["api_key"] == "sk-live-classified"

    def test_edges_are_preserved(self) -> None:
        edges = [{"source": "start", "target": "s1"}]
        workflow = {
            "nodes": [_setter_node("s1", {"api_key": "sk-live-classified"}, ["api_key"])],
            "edges": edges,
        }

        result = sealing.seal_workflow_node_secrets(workflow)

        assert result["edges"] == edges

    def test_multiple_setter_nodes_each_sealed(self) -> None:
        workflow = {
            "nodes": [
                _setter_node("s1", {"a": "secret-a"}, ["a"]),
                _setter_node("s2", {"b": "secret-b"}, ["b"]),
            ]
        }

        result = sealing.seal_workflow_node_secrets(workflow)

        assert unseal_all(_node_variables(result["nodes"][0])["a"]) == "secret-a"
        assert unseal_all(_node_variables(result["nodes"][1])["b"]) == "secret-b"

    def test_workflow_without_nodes_returns_a_copy(self) -> None:
        assert sealing.seal_workflow_node_secrets({"edges": []}) == {"edges": []}

    @pytest.mark.parametrize(
        "value",
        [
            "string-secret-value",
            8080,
            2.5,
            True,
            ["item-1", "item-2"],
            {"user": "svc", "pass": "p4ss-value"},
        ],
    )
    def test_round_trips_every_value_type(self, value: Any) -> None:
        workflow = {"nodes": [_setter_node("s1", {"cred": value}, ["cred"])]}

        sealed = sealing.seal_workflow_node_secrets(workflow)

        stored = _node_variables(sealed["nodes"][0])["cred"]
        assert is_secret_envelope(stored)
        assert unseal_all(stored) == value


class TestUnsealWorkflowNodeSecrets:
    def test_unseals_sealed_setter_values(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"api_key": "sk-live-classified"}, ["api_key"])]}
        sealed = sealing.seal_workflow_node_secrets(workflow)

        result = sealing.unseal_workflow_node_secrets(sealed)

        assert _node_variables(result["nodes"][0])["api_key"] == "sk-live-classified"

    def test_seal_then_unseal_is_identity(self) -> None:
        workflow = {
            "nodes": [
                _setter_node("s1", {"api_key": "sk-live-classified", "count": "5"}, ["api_key"])
            ],
            "edges": [{"source": "start", "target": "s1"}],
        }

        assert sealing.unseal_workflow_node_secrets(
            sealing.seal_workflow_node_secrets(workflow)
        ) == (workflow)

    def test_non_secret_values_are_untouched(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"count": "5"}, ["api_key"])]}
        sealed = sealing.seal_workflow_node_secrets(workflow)

        result = sealing.unseal_workflow_node_secrets(sealed)

        assert _node_variables(result["nodes"][0])["count"] == "5"

    def test_setter_without_secret_keys_is_untouched(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"api_key": "sk-live-classified"}, [])]}

        result = sealing.unseal_workflow_node_secrets(workflow)

        assert _node_variables(result["nodes"][0])["api_key"] == "sk-live-classified"

    def test_input_workflow_is_not_mutated(self) -> None:
        sealed = sealing.seal_workflow_node_secrets(
            {"nodes": [_setter_node("s1", {"api_key": "sk-live-classified"}, ["api_key"])]}
        )
        snapshot = copy.deepcopy(sealed)

        sealing.unseal_workflow_node_secrets(sealed)

        assert sealed == snapshot
        assert is_secret_envelope(_node_variables(sealed["nodes"][0])["api_key"])

    def test_wrong_key_envelope_raises_decryption_error(self) -> None:
        foreign = SecretCipher(_FOREIGN_KEY).seal("cross-instance-secret")
        workflow = {"nodes": [_setter_node("s1", {"api_key": foreign}, ["api_key"])]}

        with pytest.raises(SecretDecryptionError):
            sealing.unseal_workflow_node_secrets(workflow)


def _function_node(
    node_id: str,
    body_nodes: list[Any],
    *,
    body_key: str = "localDefinition",
) -> dict[str, Any]:
    """A Function workflow node whose nested body (local definition or edit-mode
    draft) carries its own workflow of setter nodes."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Fn",
            "nodeType": "function",
            "functionLifecycle": "local",
            body_key: {"workflow": {"nodes": body_nodes, "edges": []}},
        },
    }


def _nested_variables(fn_node: dict[str, Any], body_key: str = "localDefinition") -> dict[str, Any]:
    return _node_variables(fn_node["data"][body_key]["workflow"]["nodes"][0])


_LOCAL_SECRET = "fn-local-variable-classified"
_OUTPUT_DEFAULT_SECRET = "fn-output-default-classified"
_INPUT_LITERAL = "fn-input-literal-classified"


def _secret_function_node(
    node_id: str,
    *,
    body_key: str = "localDefinition",
    secret: bool = True,
    input_value: Any = _INPUT_LITERAL,
    **fields: Any,
) -> dict[str, Any]:
    """A Function Block whose definition declares a local variable, an output with a
    default and an input (each secret when ``secret``), the input held in ``config.values``."""
    flag: dict[str, Any] = {"secret": True} if secret else {}
    definition = {
        "inputs": [{"name": "tok", "type": "string", **flag}],
        "outputs": [
            {"name": "out_tok", "type": "string", "default": _OUTPUT_DEFAULT_SECRET, **flag}
        ],
        "variables": [{"name": "local_tok", "type": "string", "value": _LOCAL_SECRET, **flag}],
        "workflow": {"nodes": [], "edges": []},
    }
    data: dict[str, Any] = {
        "label": "Fn",
        "nodeType": "function",
        "config": {"values": {"tok": input_value}},
        body_key: definition,
        **fields,
    }
    if body_key == "draft":
        data.update(
            functionLifecycle="shared", functionId="lib-fn", functionVersion="1.0.0", editMode=True
        )
    else:
        data["functionLifecycle"] = "local"
    return {"id": node_id, "type": "workflowNode", "data": data}


def _local_variable_value(node: dict[str, Any], body_key: str = "localDefinition") -> Any:
    return node["data"][body_key]["variables"][0]["value"]


def _output_default_value(node: dict[str, Any], body_key: str = "localDefinition") -> Any:
    return node["data"][body_key]["outputs"][0].get("default")


def _input_value(node: dict[str, Any], body_key: str = "localDefinition") -> Any:
    return node["data"]["config"]["values"]["tok"]


_FUNCTION_SECRET_HOLDERS = [
    pytest.param(_local_variable_value, _LOCAL_SECRET, id="local-variable"),
    pytest.param(_output_default_value, _OUTPUT_DEFAULT_SECRET, id="output-default"),
    pytest.param(_input_value, _INPUT_LITERAL, id="input-literal"),
]


class TestFunctionBodyNodeSecrets:
    """Setter secrets nested inside a Function body (local definition + edit-mode
    draft) seal/unseal recursively - the walker descends into nested workflows so
    a secret literal in a Function never sits in cleartext at rest (REQ-4.5.1)."""

    def test_seals_setter_secret_in_local_definition(self) -> None:
        fn = _function_node("f1", [_setter_node("s1", {"token": "sk-nested-secret"}, ["token"])])
        workflow = {"nodes": [fn], "edges": []}

        result = sealing.seal_workflow_node_secrets(workflow)

        sealed = _nested_variables(result["nodes"][0])["token"]
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == "sk-nested-secret"

    def test_seals_setter_secret_in_edit_mode_draft(self) -> None:
        fn = _function_node(
            "f1",
            [_setter_node("s1", {"token": "sk-draft-secret"}, ["token"])],
            body_key="draft",
        )
        workflow = {"nodes": [fn], "edges": []}

        result = sealing.seal_workflow_node_secrets(workflow)

        sealed = _nested_variables(result["nodes"][0], "draft")["token"]
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == "sk-draft-secret"

    def test_local_definition_round_trips_to_identity(self) -> None:
        fn = _function_node(
            "f1",
            [_setter_node("s1", {"token": "sk-nested-secret", "keep": "plain"}, ["token"])],
        )
        workflow = {"nodes": [fn], "edges": [{"source": "start", "target": "f1"}]}

        assert (
            sealing.unseal_workflow_node_secrets(sealing.seal_workflow_node_secrets(workflow))
            == workflow
        )

    def test_draft_round_trips_to_identity(self) -> None:
        fn = _function_node(
            "f1",
            [_setter_node("s1", {"token": "sk-draft-secret"}, ["token"])],
            body_key="draft",
        )
        workflow = {"nodes": [fn], "edges": []}

        assert (
            sealing.unseal_workflow_node_secrets(sealing.seal_workflow_node_secrets(workflow))
            == workflow
        )

    def test_non_secret_nested_setter_value_stays_plaintext(self) -> None:
        fn = _function_node(
            "f1",
            [_setter_node("s1", {"token": "sk-nested-secret", "count": "7"}, ["token"])],
        )
        workflow = {"nodes": [fn]}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert _nested_variables(result["nodes"][0])["count"] == "7"

    def test_seals_a_setter_nested_two_functions_deep(self) -> None:
        inner_fn = _function_node("inner", [_setter_node("s1", {"pw": "deep-secret"}, ["pw"])])
        outer_fn = _function_node("outer", [inner_fn])
        workflow = {"nodes": [outer_fn]}

        result = sealing.seal_workflow_node_secrets(workflow)

        inner = result["nodes"][0]["data"]["localDefinition"]["workflow"]["nodes"][0]
        sealed = _node_variables(inner["data"]["localDefinition"]["workflow"]["nodes"][0])["pw"]
        assert unseal_all(sealed) == "deep-secret"

    def test_seals_both_top_level_and_nested_setters(self) -> None:
        top = _setter_node("top", {"a": "top-secret"}, ["a"])
        fn = _function_node("f1", [_setter_node("s1", {"b": "nested-secret"}, ["b"])])
        workflow = {"nodes": [top, fn]}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert unseal_all(_node_variables(result["nodes"][0])["a"]) == "top-secret"
        assert unseal_all(_nested_variables(result["nodes"][1])["b"]) == "nested-secret"

    def test_function_body_without_a_workflow_is_untouched(self) -> None:
        fn = {
            "id": "f1",
            "type": "workflowNode",
            "data": {"nodeType": "function", "localDefinition": {}},
        }
        workflow = {"nodes": [fn]}

        assert sealing.seal_workflow_node_secrets(workflow) == workflow

    def test_function_body_with_non_dict_workflow_is_untouched(self) -> None:
        fn = {
            "id": "f1",
            "type": "workflowNode",
            "data": {"nodeType": "function", "localDefinition": {"workflow": "not-a-dict"}},
        }
        workflow = {"nodes": [fn]}

        assert sealing.seal_workflow_node_secrets(workflow) == workflow

    def test_non_dict_local_definition_is_untouched(self) -> None:
        fn = {
            "id": "f1",
            "type": "workflowNode",
            "data": {"nodeType": "function", "localDefinition": None},
        }
        workflow = {"nodes": [fn]}

        assert sealing.seal_workflow_node_secrets(workflow) == workflow

    def test_non_dict_node_is_skipped(self) -> None:
        workflow = {"nodes": ["garbage", _setter_node("s1", {"token": "sk-secret"}, ["token"])]}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert result["nodes"][0] == "garbage"
        assert unseal_all(_node_variables(result["nodes"][1])["token"]) == "sk-secret"

    def test_node_without_data_is_skipped(self) -> None:
        workflow = {"nodes": [{"id": "x", "type": "workflowNode"}]}

        assert sealing.seal_workflow_node_secrets(workflow) == workflow

    def test_input_workflow_is_not_mutated(self) -> None:
        fn = _function_node("f1", [_setter_node("s1", {"token": "sk-nested-secret"}, ["token"])])
        workflow = {"nodes": [fn], "edges": []}
        snapshot = copy.deepcopy(workflow)

        sealing.seal_workflow_node_secrets(workflow)

        assert workflow == snapshot

    def test_seals_a_secret_function_local_variable(self) -> None:
        workflow = {"nodes": [_secret_function_node("f1")], "edges": []}

        result = sealing.seal_workflow_node_secrets(workflow)

        sealed = _local_variable_value(result["nodes"][0])
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == _LOCAL_SECRET


class TestFunctionParameterAndLocalSecrets:
    """A secret Function local, secret output default and secret input literal seal at rest;
    the input is a credential field of the Function Block (REQ-3.1.2.9, SECUI-10, SECUI-11)."""

    @pytest.mark.parametrize("body_key", ["localDefinition", "draft"])
    @pytest.mark.parametrize(("read", "plaintext"), _FUNCTION_SECRET_HOLDERS)
    def test_seals_the_secret_value(self, read: Any, plaintext: str, body_key: str) -> None:
        workflow = {"nodes": [_secret_function_node("f1", body_key=body_key)], "edges": []}

        result = sealing.seal_workflow_node_secrets(workflow)

        sealed = read(result["nodes"][0], body_key)
        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == plaintext

    @pytest.mark.parametrize(("read", "plaintext"), _FUNCTION_SECRET_HOLDERS)
    def test_seals_the_secret_value_two_functions_deep(self, read: Any, plaintext: str) -> None:
        outer = _function_node("outer", [_secret_function_node("inner")])

        result = sealing.seal_workflow_node_secrets({"nodes": [outer], "edges": []})

        inner = result["nodes"][0]["data"]["localDefinition"]["workflow"]["nodes"][0]
        assert is_secret_envelope(read(inner))
        assert unseal_all(read(inner)) == plaintext

    @pytest.mark.parametrize(("read", "plaintext"), _FUNCTION_SECRET_HOLDERS)
    def test_seal_then_unseal_restores_the_value(self, read: Any, plaintext: str) -> None:
        workflow = {"nodes": [_secret_function_node("f1")], "edges": []}
        sealed = sealing.seal_workflow_node_secrets(workflow)
        assert is_secret_envelope(read(sealed["nodes"][0]))

        restored = sealing.unseal_workflow_node_secrets(sealed)

        assert read(restored["nodes"][0]) == plaintext
        assert restored == workflow

    @pytest.mark.parametrize(("read", "plaintext"), _FUNCTION_SECRET_HOLDERS)
    def test_mask_replaces_the_secret_value_with_the_placeholder(
        self, read: Any, plaintext: str
    ) -> None:
        from wavecore.core.secrets.masking import MASK_PLACEHOLDER

        workflow = {"nodes": [_secret_function_node("f1")], "edges": []}

        result = sealing.mask_workflow_node_secrets(workflow)

        assert read(result["nodes"][0]) == MASK_PLACEHOLDER
        assert plaintext not in str(result)

    @pytest.mark.parametrize(("read", "plaintext"), _FUNCTION_SECRET_HOLDERS)
    def test_is_idempotent(self, read: Any, plaintext: str) -> None:
        workflow = {"nodes": [_secret_function_node("f1")], "edges": []}

        once = sealing.seal_workflow_node_secrets(workflow)
        twice = sealing.seal_workflow_node_secrets(once)

        assert unseal_all(read(once["nodes"][0])) == plaintext
        assert is_secret_envelope(read(once["nodes"][0]))
        assert twice == once

    @pytest.mark.parametrize(("read", "plaintext"), _FUNCTION_SECRET_HOLDERS)
    def test_a_plain_value_stays_plaintext(self, read: Any, plaintext: str) -> None:
        workflow = {"nodes": [_secret_function_node("f1", secret=False)], "edges": []}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert read(result["nodes"][0]) == plaintext

    def test_a_secret_input_holding_null_is_a_credential_place(self) -> None:
        workflow = {"nodes": [_secret_function_node("f1", input_value=None)], "edges": []}

        settings = sealing.iter_secret_settings(workflow)
        sealed = sealing.seal_workflow_node_secrets(workflow)
        masked = sealing.mask_workflow_node_secrets(workflow)

        assert settings == [sealing.SecretSetting(("f1",), sealing.CREDENTIAL, "tok", None)]
        assert _input_value(sealed["nodes"][0]) is None
        assert _input_value(masked["nodes"][0]) is None

    def test_a_secret_input_literal_is_a_credential_setting(self) -> None:
        workflow = {"nodes": [_secret_function_node("f1")], "edges": []}

        settings = sealing.iter_secret_settings(workflow)

        assert settings == [
            sealing.SecretSetting(("f1",), sealing.CREDENTIAL, "tok", _INPUT_LITERAL)
        ]
        assert sealing.iter_plugin_credential_secret_items(workflow) == [("tok", _INPUT_LITERAL)]
        assert ("tok", _INPUT_LITERAL) not in sealing.iter_function_secret_items(workflow)

    def test_no_function_input_setting_kind_remains(self) -> None:
        assert not hasattr(sealing, "CALL_INPUT")

    @pytest.mark.parametrize("flag", ["expressionFields", "templateFields"])
    def test_an_expression_or_template_secret_input_stays_as_written(self, flag: str) -> None:
        node = _secret_function_node("f1", input_value="api_token", **{flag: ["tok"]})
        workflow = {"nodes": [node]}

        sealed = sealing.seal_workflow_node_secrets(workflow)
        masked = sealing.mask_workflow_node_secrets(workflow)

        assert _input_value(sealed["nodes"][0]) == "api_token"
        assert _input_value(masked["nodes"][0]) == "api_token"
        assert sealing.iter_secret_settings(workflow) == []

    def test_a_map_secret_input_seals_each_value_and_keeps_its_keys(self) -> None:
        node = _secret_function_node("f1", input_value={"api_key": "k-1", "port": "8443"})
        node["data"]["localDefinition"]["inputs"] = [{"name": "tok", "type": "map", "secret": True}]
        workflow = {"nodes": [node], "edges": []}

        sealed = sealing.seal_workflow_node_secrets(workflow)
        masked = sealing.mask_workflow_node_secrets(workflow)

        held = _input_value(sealed["nodes"][0])
        assert sorted(held) == ["api_key", "port"]
        assert all(is_secret_envelope(value) for value in held.values())
        assert sealing.unseal_workflow_node_secrets(sealed) == workflow
        assert _input_value(masked["nodes"][0]) == {
            "api_key": MASK_PLACEHOLDER,
            "port": MASK_PLACEHOLDER,
        }

    def test_a_shared_function_block_names_its_secret_inputs_through_the_lookup(self) -> None:
        node = {
            "id": "lib",
            "type": "workflowNode",
            "data": {
                "label": "Lib Fn",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": "lib-fn",
                "functionVersion": "1.0.0",
                "config": {"values": {"tok": _INPUT_LITERAL, "plain": "kept"}},
            },
        }

        result = sealing.seal_workflow_node_secrets(
            {"nodes": [node], "edges": []}, secret_inputs=lambda data: {"tok"}
        )

        values = result["nodes"][0]["data"]["config"]["values"]
        assert is_secret_envelope(values["tok"])
        assert unseal_all(values["tok"]) == _INPUT_LITERAL
        assert values["plain"] == "kept"

    @pytest.mark.parametrize(
        ("holder", "empty"),
        [
            pytest.param(
                "variables",
                {"name": "local_tok", "type": "string", "value": None},
                id="local-variable-null",
            ),
            pytest.param("outputs", {"name": "out_tok", "type": "string"}, id="output-no-default"),
            pytest.param(
                "outputs",
                {"name": "out_tok", "type": "string", "default": None},
                id="output-default-null",
            ),
        ],
    )
    def test_a_secret_holding_no_value_stays_as_it_is(
        self, holder: str, empty: dict[str, Any]
    ) -> None:
        node = _secret_function_node("f1")
        node["data"]["localDefinition"][holder] = [{**empty, "secret": True}]

        result = sealing.seal_workflow_node_secrets({"nodes": [node], "edges": []})

        assert result["nodes"][0]["data"]["localDefinition"][holder] == [{**empty, "secret": True}]


def _reveals(monkeypatch: pytest.MonkeyPatch, *, functions: bool, credentials: bool) -> None:
    monkeypatch.setattr(sealing.masking_settings, "is_test_variables_revealed", lambda: functions)
    monkeypatch.setattr(
        sealing.masking_settings, "is_credential_inputs_revealed", lambda: credentials
    )


class TestFunctionBlockSecretInputOnRead:
    """A secret Function Block input reads like a plugin credential: the credential-inputs
    reveal shows it, the Function-secrets path never masks it (REQ-3.1.3.17, REQ-3.1.3.18)."""

    @staticmethod
    def _sealed(body_key: str = "localDefinition") -> dict[str, Any]:
        return sealing.seal_workflow_node_secrets(
            {"nodes": [_secret_function_node("f1", body_key=body_key)], "edges": []}
        )

    @pytest.mark.parametrize("body_key", ["localDefinition", "draft"])
    def test_the_credential_reveal_shows_the_input(
        self, monkeypatch: pytest.MonkeyPatch, body_key: str
    ) -> None:
        _reveals(monkeypatch, functions=False, credentials=True)

        shown = sealing.read_workflow_secrets(self._sealed(body_key))

        assert _input_value(shown["nodes"][0], body_key) == _INPUT_LITERAL
        assert _local_variable_value(shown["nodes"][0], body_key) == MASK_PLACEHOLDER

    @pytest.mark.parametrize("body_key", ["localDefinition", "draft"])
    def test_the_credential_reveal_shows_an_input_stored_sealed(
        self, monkeypatch: pytest.MonkeyPatch, body_key: str
    ) -> None:
        _reveals(monkeypatch, functions=False, credentials=True)
        node = _secret_function_node(
            "f1", body_key=body_key, input_value=seal_value(_INPUT_LITERAL)
        )

        shown = sealing.read_workflow_secrets({"nodes": [node], "edges": []})

        assert _input_value(shown["nodes"][0], body_key) == _INPUT_LITERAL

    def test_the_input_stays_sealed_while_the_credential_reveal_is_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _reveals(monkeypatch, functions=True, credentials=False)

        shown = sealing.read_workflow_secrets(self._sealed())

        assert is_secret_envelope(_input_value(shown["nodes"][0]))
        assert _local_variable_value(shown["nodes"][0]) == _LOCAL_SECRET

    def test_the_function_secrets_mask_leaves_the_input_to_the_credential_path(self) -> None:
        sealed = self._sealed()

        shown = sealing.mask_workflow_function_secrets(sealed)

        assert _input_value(shown["nodes"][0]) == _input_value(sealed["nodes"][0])
        assert is_secret_envelope(_input_value(shown["nodes"][0]))
        assert _local_variable_value(shown["nodes"][0]) == MASK_PLACEHOLDER
        assert _output_default_value(shown["nodes"][0]) == MASK_PLACEHOLDER

    def test_a_function_card_mask_leaves_a_nested_input_to_the_credential_path(self) -> None:
        definition = sealing.seal_definition_secrets(
            {"workflow": {"nodes": [_secret_function_node("inner")], "edges": []}}
        )

        shown = sealing.mask_definition_function_secrets(definition)

        inner = shown["workflow"]["nodes"][0]
        assert _input_value(inner) == _input_value(definition["workflow"]["nodes"][0])
        assert is_secret_envelope(_input_value(inner))
        assert _local_variable_value(inner) == MASK_PLACEHOLDER

    def test_a_masked_input_echoed_on_save_keeps_the_stored_secret(self) -> None:
        stored = self._sealed()
        echoed = sealing.mask_workflow_node_secrets(stored)
        assert _input_value(echoed["nodes"][0]) == MASK_PLACEHOLDER

        restored = sealing.restore_masked_workflow_secrets(echoed, stored)

        assert _input_value(restored["nodes"][0]) == _input_value(stored["nodes"][0])
        assert unseal_all(_input_value(restored["nodes"][0])) == _INPUT_LITERAL

    def test_a_new_input_value_on_save_is_kept(self) -> None:
        stored = self._sealed()
        submitted = copy.deepcopy(stored)
        submitted["nodes"][0]["data"]["config"]["values"]["tok"] = "a-new-value"

        restored = sealing.restore_masked_workflow_secrets(submitted, stored)

        assert _input_value(restored["nodes"][0]) == "a-new-value"


_DECLARED_HOLDERS = [
    pytest.param("variables", id="local-variable"),
    pytest.param("outputs", id="output-default"),
]
_FLAG_DROPPED = [pytest.param("absent", id="flag-absent"), pytest.param("false", id="flag-false")]


def _drop_flag(entry: dict[str, Any], dropped: str) -> None:
    """Take the secret flag off an echoed entry, or send it as false."""
    entry.pop("secret", None)
    if dropped == "false":
        entry["secret"] = False


def _declared_entry(definition: dict[str, Any], holder: str) -> dict[str, Any]:
    entry: dict[str, Any] = definition[holder][0]
    return entry


def _held_key(holder: str) -> str:
    return "value" if holder == "variables" else "default"


class TestAnEchoedFunctionSecretWithTheFlagDropped:
    """A save never turns a sealed Function local or secret output default into a plain one:
    the mask echoed with the secret flag dropped keeps the stored sealed value (REQ-3.1.3.5)."""

    @pytest.mark.parametrize("dropped", _FLAG_DROPPED)
    @pytest.mark.parametrize("holder", _DECLARED_HOLDERS)
    @pytest.mark.parametrize("body_key", ["localDefinition", "draft"])
    def test_a_workflow_echo_keeps_the_stored_secret(
        self, body_key: str, holder: str, dropped: str
    ) -> None:
        stored = sealing.seal_workflow_node_secrets(
            {"nodes": [_secret_function_node("f1", body_key=body_key)], "edges": []}
        )
        echoed = sealing.mask_workflow_function_secrets(stored)
        _drop_flag(_declared_entry(echoed["nodes"][0]["data"][body_key], holder), dropped)

        restored = sealing.restore_masked_workflow_secrets(echoed, stored)

        kept = _declared_entry(restored["nodes"][0]["data"][body_key], holder)
        assert kept == _declared_entry(stored["nodes"][0]["data"][body_key], holder)
        assert kept["secret"] is True
        assert is_secret_envelope(kept[_held_key(holder)])
        assert restored == stored

    @pytest.mark.parametrize("holder", _DECLARED_HOLDERS)
    def test_a_workflow_echo_two_functions_deep_keeps_the_stored_secret(self, holder: str) -> None:
        stored = sealing.seal_workflow_node_secrets(
            {"nodes": [_function_node("outer", [_secret_function_node("inner")])], "edges": []}
        )
        echoed = sealing.mask_workflow_function_secrets(stored)
        inner = echoed["nodes"][0]["data"]["localDefinition"]["workflow"]["nodes"][0]
        _drop_flag(_declared_entry(inner["data"]["localDefinition"], holder), "absent")

        restored = sealing.restore_masked_workflow_secrets(echoed, stored)

        def _inner_entry(workflow: dict[str, Any]) -> dict[str, Any]:
            node = workflow["nodes"][0]["data"]["localDefinition"]["workflow"]["nodes"][0]
            return _declared_entry(node["data"]["localDefinition"], holder)

        assert _inner_entry(restored) == _inner_entry(stored)
        assert restored == stored

    @pytest.mark.parametrize("dropped", _FLAG_DROPPED)
    @pytest.mark.parametrize("holder", _DECLARED_HOLDERS)
    def test_a_definition_echo_keeps_the_stored_secret(self, holder: str, dropped: str) -> None:
        definition = _secret_function_node("f1")["data"]["localDefinition"]
        stored = sealing.seal_definition_secrets(definition)
        echoed = sealing.mask_definition_function_secrets(stored)
        _drop_flag(_declared_entry(echoed, holder), dropped)

        restored = sealing.restore_masked_definition_secrets(echoed, stored)

        assert _declared_entry(restored, holder) == _declared_entry(stored, holder)
        assert restored == stored
        assert unseal_all(_declared_entry(restored, holder)[_held_key(holder)]) == (
            _LOCAL_SECRET if holder == "variables" else _OUTPUT_DEFAULT_SECRET
        )

    def test_the_echo_keeps_its_other_keys_and_loses_the_masked_flag(self) -> None:
        definition = _secret_function_node("f1")["data"]["localDefinition"]
        definition["variables"][0]["description"] = "service token"
        stored = sealing.seal_definition_secrets(definition)
        echoed = sealing.mask_definition_function_secrets(stored)
        assert echoed["variables"][0]["masked"] is True
        _drop_flag(echoed["variables"][0], "absent")

        restored = sealing.restore_masked_definition_secrets(echoed, stored)

        assert restored["variables"][0] == {
            "name": "local_tok",
            "type": "string",
            "value": stored["variables"][0]["value"],
            "secret": True,
            "description": "service token",
        }

    def test_a_secret_map_local_echoed_without_the_flag_keeps_its_element_types(self) -> None:
        definition = _secret_function_node("f1")["data"]["localDefinition"]
        definition["variables"] = [
            {
                "name": "creds",
                "type": "map",
                "value": {"api_key": "k-1", "port": "8443"},
                "elementTypes": {"api_key": "string", "port": "integer"},
                "secret": True,
            }
        ]
        stored = sealing.seal_definition_secrets(definition)
        echoed = sealing.mask_definition_function_secrets(stored)
        assert "elementTypes" not in echoed["variables"][0]
        _drop_flag(echoed["variables"][0], "absent")

        restored = sealing.restore_masked_definition_secrets(echoed, stored)

        assert restored["variables"] == stored["variables"]

    @pytest.mark.parametrize("value", ["now-a-plain-value", None], ids=["new-value", "cleared"])
    @pytest.mark.parametrize("holder", _DECLARED_HOLDERS)
    def test_a_new_value_sent_with_the_flag_dropped_is_kept_plain(
        self, holder: str, value: str | None
    ) -> None:
        stored = sealing.seal_workflow_node_secrets(
            {"nodes": [_secret_function_node("f1")], "edges": []}
        )
        echoed = sealing.mask_workflow_function_secrets(stored)
        definition = echoed["nodes"][0]["data"]["localDefinition"]
        name = _declared_entry(definition, holder)["name"]
        sent = {"name": name, "type": "string", _held_key(holder): value}
        definition[holder] = [dict(sent)]

        restored = sealing.restore_masked_workflow_secrets(echoed, stored)

        assert _declared_entry(restored["nodes"][0]["data"]["localDefinition"], holder) == sent


class TestCollectSetterSecretNames:
    """collect_setter_secret_names gathers the variable NAMES a workflow's
    setters mark secret (top level + every nested Function body) so the run
    registry can flag them even when the Variable Manager declares them plain."""

    def test_collects_top_level_setter_secret_names(self) -> None:
        workflow = {
            "nodes": [_setter_node("s1", {"token": "sk-secret", "count": "5"}, ["token"])],
            "edges": [],
        }

        assert sealing.collect_setter_secret_names(workflow) == {"token"}

    def test_ignores_non_secret_setter_keys(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"token": "sk-secret", "count": "5"}, [])]}

        assert sealing.collect_setter_secret_names(workflow) == set()

    def test_collects_across_multiple_setters(self) -> None:
        workflow = {
            "nodes": [
                _setter_node("s1", {"a": "one-secret"}, ["a"]),
                _setter_node("s2", {"b": "two-secret"}, ["b"]),
            ]
        }

        assert sealing.collect_setter_secret_names(workflow) == {"a", "b"}

    def test_collects_nested_function_body_setter_names(self) -> None:
        fn = _function_node("f1", [_setter_node("s1", {"nested": "sk-nested"}, ["nested"])])
        workflow = {"nodes": [_setter_node("top", {"a": "top-secret"}, ["a"]), fn]}

        assert sealing.collect_setter_secret_names(workflow) == {"a", "nested"}

    def test_accepts_a_bare_node_list(self) -> None:
        nodes = [_setter_node("s1", {"token": "sk-secret"}, ["token"])]

        assert sealing.collect_setter_secret_names({"nodes": nodes}) == {"token"}

    def test_empty_workflow_yields_empty_set(self) -> None:
        assert sealing.collect_setter_secret_names({"nodes": []}) == set()


class TestIterSetterSecretItems:
    """A pure traversal yielding (name, value) pairs for each setter secret."""

    def test_mask_workflow_node_secrets_replaces_with_placeholder(self) -> None:
        from wavecore.core.secrets.masking import MASK_PLACEHOLDER

        workflow = {"nodes": [_setter_node("s1", {"token": "sk-secret", "n": "5"}, ["token"])]}

        result = sealing.mask_workflow_node_secrets(workflow)

        assert _node_variables(result["nodes"][0])["token"] == MASK_PLACEHOLDER
        assert _node_variables(result["nodes"][0])["n"] == "5"

    def test_transform_setter_node_secrets_applies_the_fn(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"token": "sk-secret"}, ["token"])]}

        result = sealing.transform_setter_node_secrets(workflow, lambda _v: "REPLACED")

        assert _node_variables(result["nodes"][0])["token"] == "REPLACED"


# ---------------------------------------------------------------------------
# Plugin-declared credential input fields (REQ-3.1.3.18 / REQ-4.5.1)
#
# A plugin knows by protocol which of its own input fields carry credentials
# (an SSH session's password / private_key / passphrase). A LITERAL typed into
# such a declared credential field seals at rest in the block's node config, in
# the same envelope as a setter literal - so the same seal/unseal/mask locators
# that walk setter nodes must also walk plugin nodes' declared credential params.
# The declared secret params are read from the registered plugin's metadata, so
# the node's ``elementType`` must resolve in the plugin registry.
# ---------------------------------------------------------------------------


_CRED_PLUGIN_TYPE = "stub-cred-plugin"


class _CredParamPlugin:
    """Stub plugin declaring three secret input params, one a map, and one plain param."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": _CRED_PLUGIN_TYPE,
            "version": "1.0.0",
            "parameters": [
                {"name": "password", "type": "string", "secret": True},
                {"name": "passphrase", "type": "string", "secret": True},
                {"name": "secret_map", "type": "map", "secret": True},
                {"name": "host", "type": "string"},
            ],
        }


def _plugin_node(
    node_id: str,
    values: dict[str, Any],
    *,
    element_type: str = _CRED_PLUGIN_TYPE,
    version: str = "1.0.0",
) -> dict[str, Any]:
    """A plugin workflow node carrying a flat config.values param map."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Body",
            "elementType": element_type,
            "nodeType": "plugin",
            "version": version,
            "config": {"values": values},
        },
    }


def _plugin_values(node: dict[str, Any]) -> dict[str, Any]:
    return node["data"]["config"]["values"]


@pytest.fixture
def _registered_cred_plugin() -> Generator[None, None, None]:
    from wavecore.core.plugin_registry import clear_registry, register_plugin

    clear_registry()
    register_plugin(_CredParamPlugin())
    yield
    clear_registry()


@pytest.mark.usefixtures("_registered_cred_plugin")
class TestPluginCredentialNodeSecrets:
    """A plugin-declared credential input literal seals at rest in node config,
    the same envelope as a setter literal (REQ-3.1.3.18 / REQ-4.5.1)."""

    def test_seals_declared_credential_param_literal(self) -> None:
        workflow = {
            "nodes": [_plugin_node("p1", {"password": "pw-classified", "host": "example.com"})],
            "edges": [],
        }

        result = sealing.seal_workflow_node_secrets(workflow)

        assert is_secret_envelope(_plugin_values(result["nodes"][0])["password"])

    def test_leaves_non_credential_param_plaintext(self) -> None:
        workflow = {
            "nodes": [_plugin_node("p1", {"password": "pw-classified", "host": "example.com"})]
        }

        result = sealing.seal_workflow_node_secrets(workflow)

        assert _plugin_values(result["nodes"][0])["host"] == "example.com"

    def test_seal_then_unseal_round_trips_credential_param(self) -> None:
        workflow = {"nodes": [_plugin_node("p1", {"password": "pw-classified"})]}

        sealed = sealing.seal_workflow_node_secrets(workflow)
        assert is_secret_envelope(_plugin_values(sealed["nodes"][0])["password"])

        restored = sealing.unseal_workflow_node_secrets(sealed)
        assert _plugin_values(restored["nodes"][0])["password"] == "pw-classified"

    def test_seals_every_declared_credential_param(self) -> None:
        workflow = {
            "nodes": [
                _plugin_node("p1", {"password": "pw-classified", "passphrase": "pp-classified"})
            ]
        }

        result = sealing.seal_workflow_node_secrets(workflow)
        values = _plugin_values(result["nodes"][0])

        assert is_secret_envelope(values["password"])
        assert is_secret_envelope(values["passphrase"])
        assert unseal_all(values["password"]) == "pw-classified"
        assert unseal_all(values["passphrase"]) == "pp-classified"

    def test_mask_replaces_credential_param_with_placeholder(self) -> None:
        from wavecore.core.secrets.masking import MASK_PLACEHOLDER

        workflow = {
            "nodes": [_plugin_node("p1", {"password": "pw-classified", "host": "example.com"})]
        }

        result = sealing.mask_workflow_node_secrets(workflow)
        values = _plugin_values(result["nodes"][0])

        assert values["password"] == MASK_PLACEHOLDER
        assert values["host"] == "example.com"

    def test_map_credential_seals_each_value_and_keeps_its_keys(self) -> None:
        workflow = {
            "nodes": [_plugin_node("p1", {"secret_map": {"tls.crt": "cert", "tls.key": "key"}})]
        }

        result = sealing.seal_workflow_node_secrets(workflow)
        sealed = _plugin_values(result["nodes"][0])["secret_map"]

        assert sorted(sealed) == ["tls.crt", "tls.key"]
        assert is_secret_envelope(sealed["tls.crt"])
        assert is_secret_envelope(sealed["tls.key"])

    def test_map_credential_round_trips_as_a_map(self) -> None:
        data = {"tls.crt": "cert", "tls.key": "key"}
        workflow = {"nodes": [_plugin_node("p1", {"secret_map": data})]}

        sealed = sealing.seal_workflow_node_secrets(workflow)
        restored = sealing.unseal_workflow_node_secrets(sealed)

        assert _plugin_values(restored["nodes"][0])["secret_map"] == data

    def test_map_credential_masks_each_value_and_keeps_its_keys(self) -> None:
        from wavecore.core.secrets.masking import MASK_PLACEHOLDER

        workflow = {"nodes": [_plugin_node("p1", {"secret_map": {"canary": "classified"}})]}

        result = sealing.mask_workflow_node_secrets(workflow)

        assert _plugin_values(result["nodes"][0])["secret_map"] == {"canary": MASK_PLACEHOLDER}

    def test_empty_map_credential_survives_a_seal(self) -> None:
        workflow = {"nodes": [_plugin_node("p1", {"secret_map": {}})]}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert _plugin_values(result["nodes"][0])["secret_map"] == {}

    def test_unregistered_plugin_node_is_left_untouched(self) -> None:
        workflow = {
            "nodes": [
                _plugin_node("p1", {"password": "pw-classified"}, element_type="not-registered")
            ]
        }

        result = sealing.seal_workflow_node_secrets(workflow)

        assert _plugin_values(result["nodes"][0])["password"] == "pw-classified"

    def test_credential_param_absent_from_values_is_skipped(self) -> None:
        workflow = {"nodes": [_plugin_node("p1", {"host": "example.com"})]}

        result = sealing.seal_workflow_node_secrets(workflow)

        assert _plugin_values(result["nodes"][0]) == {"host": "example.com"}

    def test_is_idempotent(self) -> None:
        workflow = {"nodes": [_plugin_node("p1", {"password": "pw-classified"})]}

        once = sealing.seal_workflow_node_secrets(workflow)
        twice = sealing.seal_workflow_node_secrets(once)

        assert twice == once

    def test_input_workflow_is_not_mutated(self) -> None:
        workflow = {"nodes": [_plugin_node("p1", {"password": "pw-classified"})]}
        snapshot = copy.deepcopy(workflow)

        sealing.seal_workflow_node_secrets(workflow)

        assert workflow == snapshot

    def test_seals_credential_param_inside_nested_function_body(self) -> None:
        inner = _plugin_node("p1", {"password": "pw-nested-classified"})
        workflow = {"nodes": [_function_node("fn1", [inner])], "edges": []}

        result = sealing.seal_workflow_node_secrets(workflow)
        nested = result["nodes"][0]["data"]["localDefinition"]["workflow"]["nodes"][0]
        sealed = _plugin_values(nested)["password"]

        assert is_secret_envelope(sealed)
        assert unseal_all(sealed) == "pw-nested-classified"

    def test_node_with_non_dict_config_values_is_left_untouched(self) -> None:
        node = {
            "id": "p1",
            "type": "workflowNode",
            "data": {
                "elementType": _CRED_PLUGIN_TYPE,
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {"values": "not-a-dict"},
            },
        }

        result = sealing.seal_workflow_node_secrets({"nodes": [node], "edges": []})

        assert result["nodes"][0]["data"]["config"]["values"] == "not-a-dict"

    def test_iter_credential_items_yields_only_present_declared_params(self) -> None:
        workflow = {
            "nodes": [_plugin_node("p1", {"password": "pw-classified", "host": "example.com"})]
        }

        items = sealing.iter_plugin_credential_secret_items(workflow)

        assert ("password", "pw-classified") in items
        assert all(name != "host" for name, _ in items)

    def test_iter_credential_items_returns_empty_for_a_non_dict_workflow(self) -> None:
        assert sealing.iter_plugin_credential_secret_items("not-a-workflow") == []

    def test_reveal_unseal_a_credential_inside_a_nested_function_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        inner = _plugin_node("p1", {"password": "pw-nested-classified"})
        sealed = sealing.seal_workflow_node_secrets(
            {"nodes": [_function_node("fn1", [inner])], "edges": []}
        )
        monkeypatch.setattr(sealing.masking_settings, "is_credential_inputs_revealed", lambda: True)

        revealed = sealing.read_workflow_secrets(sealed)
        nested = revealed["nodes"][0]["data"]["localDefinition"]["workflow"]["nodes"][0]

        assert _plugin_values(nested)["password"] == "pw-nested-classified"


_PINNED_INPUT_LITERAL = "pinned-input-literal-classified"


@pytest.fixture
def _pinned_function_id() -> str:
    """A library Function whose pinned 1.0.0 declares the secret input ``tok``."""
    import uuid

    from wavecore.api.services.functions import _storage as function_storage

    function_id = str(uuid.uuid4())
    function_storage.save_new_version(
        function_id,
        "1.0.0",
        {
            "inputs": [
                {"name": "tok", "type": "string", "secret": True},
                {"name": "plain", "type": "string"},
            ],
            "outputs": [],
            "variables": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        },
        {
            "description": "",
            "tags": [],
            "changelog": "initial",
            "details": "",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        },
        name="pinned-secret-fn",
    )
    return function_id


def _pinned_workflow(function_id: str, tok: Any) -> dict[str, Any]:
    """One Shared Function Block pinned to 1.0.0, holding ``tok`` and a plain input."""
    return {
        "nodes": [
            {
                "id": "lib",
                "type": "workflowNode",
                "data": {
                    "label": "Lib Fn",
                    "nodeType": "function",
                    "functionLifecycle": "shared",
                    "functionId": function_id,
                    "functionVersion": "1.0.0",
                    "config": {"values": {"tok": tok, "plain": "kept"}},
                },
            }
        ],
        "edges": [],
    }


class TestAPinnedSharedFunctionBlockSecretInputIsACredential:
    """With no secret-name lookup passed, a pinned Shared Function Block's secret input
    seals, unseals, masks, reads and restores like a plugin credential (REQ-3.1.3.18)."""

    def test_seals_the_secret_input_literal(self, _pinned_function_id: str) -> None:
        workflow = _pinned_workflow(_pinned_function_id, _PINNED_INPUT_LITERAL)

        result = sealing.seal_workflow_node_secrets(workflow)

        values = result["nodes"][0]["data"]["config"]["values"]
        assert is_secret_envelope(values["tok"])
        assert unseal_all(values["tok"]) == _PINNED_INPUT_LITERAL
        assert values["plain"] == "kept"

    def test_run_load_unseals_the_secret_input(self, _pinned_function_id: str) -> None:
        workflow = _pinned_workflow(_pinned_function_id, seal_value(_PINNED_INPUT_LITERAL))

        restored = sealing.unseal_workflow_node_secrets(workflow)

        assert _input_value(restored["nodes"][0]) == _PINNED_INPUT_LITERAL

    def test_mask_replaces_the_secret_input_with_the_placeholder(
        self, _pinned_function_id: str
    ) -> None:
        workflow = _pinned_workflow(_pinned_function_id, seal_value(_PINNED_INPUT_LITERAL))

        masked = sealing.mask_workflow_node_secrets(workflow)

        values = masked["nodes"][0]["data"]["config"]["values"]
        assert values["tok"] == MASK_PLACEHOLDER
        assert values["plain"] == "kept"

    def test_the_credential_reveal_shows_the_secret_input(
        self, monkeypatch: pytest.MonkeyPatch, _pinned_function_id: str
    ) -> None:
        _reveals(monkeypatch, functions=False, credentials=True)
        workflow = _pinned_workflow(_pinned_function_id, seal_value(_PINNED_INPUT_LITERAL))

        shown = sealing.read_workflow_secrets(workflow)

        assert _input_value(shown["nodes"][0]) == _PINNED_INPUT_LITERAL

    def test_the_secret_input_stays_sealed_while_the_credential_reveal_is_off(
        self, monkeypatch: pytest.MonkeyPatch, _pinned_function_id: str
    ) -> None:
        _reveals(monkeypatch, functions=True, credentials=False)
        workflow = _pinned_workflow(_pinned_function_id, seal_value(_PINNED_INPUT_LITERAL))

        shown = sealing.read_workflow_secrets(workflow)

        assert is_secret_envelope(_input_value(shown["nodes"][0]))
        assert unseal_all(_input_value(shown["nodes"][0])) == _PINNED_INPUT_LITERAL

    def test_a_masked_secret_input_echoed_on_save_keeps_the_stored_secret(
        self, _pinned_function_id: str
    ) -> None:
        stored = _pinned_workflow(_pinned_function_id, seal_value(_PINNED_INPUT_LITERAL))
        echoed = _pinned_workflow(_pinned_function_id, MASK_PLACEHOLDER)

        restored = sealing.restore_masked_workflow_secrets(echoed, stored)

        assert _input_value(restored["nodes"][0]) == _input_value(stored["nodes"][0])
        assert unseal_all(_input_value(restored["nodes"][0])) == _PINNED_INPUT_LITERAL

    def test_the_secret_input_is_reported_as_a_credential_place(
        self, _pinned_function_id: str
    ) -> None:
        workflow = _pinned_workflow(_pinned_function_id, _PINNED_INPUT_LITERAL)

        assert sealing.iter_secret_settings(workflow) == [
            sealing.SecretSetting(("lib",), sealing.CREDENTIAL, "tok", _PINNED_INPUT_LITERAL)
        ]
