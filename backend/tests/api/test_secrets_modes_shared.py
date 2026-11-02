"""Shared secrets-mode transform helpers contract (REQ-5.2.4.9, REQ-4.5.1).

The three-way export secrets choice (mask / encrypted / plaintext) is driven by
one shared surface on ``api.services.shared``: ``parse_secrets_mode`` validates
the requested mode, ``apply_secrets_mode_to_variables`` transforms a name-keyed
variables dict per mode, and ``check_foreign_envelopes`` flags secret values
sealed by another WAVE instance during import validation.
"""

import re
import uuid
from collections.abc import Callable, Generator, Mapping
from pathlib import Path
from typing import Any, NamedTuple

import pytest
import yaml

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services import shared, storage_paths, variable_service
from wavecore.api.services.functions import _storage as function_storage
from wavecore.api.services.functions import service as functions_service
from wavecore.api.services.profiles import _common as profile_common
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.tests import service as test_service
from wavecore.core.secrets import key_provider
from wavecore.core.secrets.cipher import SecretCipher, is_secret_envelope
from wavecore.core.secrets.key_provider import KeyProvider
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import seal_value, seal_variables, unseal_all

# A key distinct from the suite-wide test key (bytes(range(32))) so envelopes
# sealed with it are undecryptable locally - i.e. "foreign" to this instance.
_FOREIGN_KEY = bytes(range(1, 33))
_MISSING_KEY_MESSAGE = (
    "No secret encryption key configured: make one with "
    "'poetry run wave-new-secret-key' in the backend folder, then set it as "
    "security.secret_key in the config file or as the WAVE_SECRET_KEY "
    "environment variable"
)
_DECRYPTION_FAILED_MESSAGE = (
    "Secret decryption failed: ciphertext is corrupt or the encryption key is invalid"
)


def _foreign_envelope(value: Any) -> str:
    """Seal a value under a different key so local unseal fails."""
    return SecretCipher(_FOREIGN_KEY).seal(value)


def _sealed_variables() -> dict[str, Any]:
    """A variables dict whose secret entry is sealed with the local key."""
    return seal_variables(
        {
            "api_token": {"type": "string", "value": "tok-classified-123", "secret": True},
            "host": {"type": "string", "value": "db.example.com"},
        }
    )


class TestSecretsModesConstant:
    def test_exposes_exactly_the_three_modes(self) -> None:
        assert set(shared.SECRETS_MODES) == {"mask", "encrypted", "plaintext"}


class TestParseSecretsMode:
    def test_none_defaults_to_mask(self) -> None:
        assert shared.parse_secrets_mode(None) == "mask"

    @pytest.mark.parametrize("mode", ["mask", "encrypted", "plaintext"])
    def test_valid_modes_pass_through(self, mode: str) -> None:
        assert shared.parse_secrets_mode(mode) == mode

    def test_invalid_mode_raises_validation_exception(self) -> None:
        with pytest.raises(ValidationException) as exc_info:
            shared.parse_secrets_mode("bogus")

        assert (
            str(exc_info.value)
            == "Invalid secrets mode 'bogus'; must be 'mask', 'encrypted', or 'plaintext'"
        )

    def test_invalid_mode_carries_the_offending_value(self) -> None:
        with pytest.raises(ValidationException) as exc_info:
            shared.parse_secrets_mode("PLAINTEXT")

        assert (
            str(exc_info.value)
            == "Invalid secrets mode 'PLAINTEXT'; must be 'mask', 'encrypted', or 'plaintext'"
        )

    def test_invalid_mode_is_a_400(self) -> None:
        with pytest.raises(ValidationException) as exc_info:
            shared.parse_secrets_mode("nope")

        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "VALIDATION_ERROR"


class TestApplySecretsModeToVariables:
    def test_mask_replaces_secret_value_with_placeholder_and_flag(self) -> None:
        result = shared.apply_secrets_mode_to_variables(_sealed_variables(), "mask")

        assert result["api_token"]["value"] == MASK_PLACEHOLDER
        assert result["api_token"]["masked"] is True

    def test_mask_leaves_non_secret_variables_untouched(self) -> None:
        result = shared.apply_secrets_mode_to_variables(_sealed_variables(), "mask")

        assert result["host"] == {"type": "string", "value": "db.example.com"}

    def test_encrypted_emits_the_sealed_envelope_verbatim(self) -> None:
        sealed = _sealed_variables()

        result = shared.apply_secrets_mode_to_variables(sealed, "encrypted")

        assert result["api_token"]["value"] == sealed["api_token"]["value"]
        assert is_secret_envelope(result["api_token"]["value"])

    def test_encrypted_leaves_non_secret_variables_untouched(self) -> None:
        result = shared.apply_secrets_mode_to_variables(_sealed_variables(), "encrypted")

        assert result["host"] == {"type": "string", "value": "db.example.com"}

    def test_plaintext_decrypts_secret_value_to_the_real_value(self) -> None:
        result = shared.apply_secrets_mode_to_variables(_sealed_variables(), "plaintext")

        assert result["api_token"]["value"] == "tok-classified-123"

    def test_plaintext_leaves_non_secret_variables_untouched(self) -> None:
        result = shared.apply_secrets_mode_to_variables(_sealed_variables(), "plaintext")

        assert result["host"] == {"type": "string", "value": "db.example.com"}

    def test_input_is_not_mutated(self) -> None:
        sealed = _sealed_variables()
        original_value = sealed["api_token"]["value"]

        shared.apply_secrets_mode_to_variables(sealed, "mask")

        assert sealed["api_token"]["value"] == original_value

    def test_plaintext_corrupt_envelope_raises_conflict(self) -> None:
        variables = {
            "api_token": {"type": "string", "value": _foreign_envelope("x"), "secret": True}
        }

        with pytest.raises(ConflictException) as exc_info:
            shared.apply_secrets_mode_to_variables(variables, "plaintext")

        assert str(exc_info.value) == _DECRYPTION_FAILED_MESSAGE
        assert exc_info.value.status_code == 409

    def test_plaintext_missing_key_raises_conflict(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class _NoKeyProvider(KeyProvider):
            def get_key(self) -> bytes:
                raise ValueError(_MISSING_KEY_MESSAGE)

        sealed = _sealed_variables()
        monkeypatch.setattr(key_provider, "get_key_provider", lambda: _NoKeyProvider())

        with pytest.raises(ConflictException) as exc_info:
            shared.apply_secrets_mode_to_variables(sealed, "plaintext")

        assert str(exc_info.value) == _MISSING_KEY_MESSAGE
        assert exc_info.value.status_code == 409


class TestCheckForeignEnvelopes:
    def test_foreign_secret_envelope_yields_warning(self) -> None:
        variables = {"api_token": {"value": _foreign_envelope("tok"), "secret": True}}

        warnings = shared.check_foreign_envelopes(variables)

        assert warnings == [
            {
                "code": "FOREIGN_ENCRYPTED_SECRET",
                "message": (
                    "Secret 'api_token' is encrypted by another WAVE instance and "
                    "cannot be decrypted here; re-enter it after import"
                ),
            }
        ]

    def test_local_secret_envelope_yields_no_warning(self) -> None:
        variables = seal_variables({"api_token": {"value": "local-secret", "secret": True}})

        assert shared.check_foreign_envelopes(variables) == []

    def test_secret_non_envelope_value_yields_no_warning(self) -> None:
        variables = {"api_token": {"value": "plain-not-sealed", "secret": True}}

        assert shared.check_foreign_envelopes(variables) == []

    def test_non_secret_foreign_envelope_is_ignored(self) -> None:
        variables = {"note": {"value": _foreign_envelope("x"), "secret": False}}

        assert shared.check_foreign_envelopes(variables) == []

    def test_multiple_foreign_secrets_each_named(self) -> None:
        variables = {
            "token_a": {"value": _foreign_envelope("a"), "secret": True},
            "token_b": {"value": _foreign_envelope("b"), "secret": True},
        }

        warnings = shared.check_foreign_envelopes(variables)

        named = {w["message"] for w in warnings}
        assert all(w["code"] == "FOREIGN_ENCRYPTED_SECRET" for w in warnings)
        assert (
            "Secret 'token_a' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import" in named
        )
        assert (
            "Secret 'token_b' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import" in named
        )

    def test_non_dict_input_yields_no_warning(self) -> None:
        assert shared.check_foreign_envelopes("not-a-dict") == []

    def test_empty_variables_yield_no_warning(self) -> None:
        assert shared.check_foreign_envelopes({}) == []


def _setter_node(node_id: str, variables: dict[str, Any], secret_keys: list[str]) -> dict[str, Any]:
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


def _sealed_setter_workflow() -> dict[str, Any]:
    """A workflow whose setter secret literal is sealed with the local key."""
    from wavecore.core.secrets.sealing import seal_workflow_node_secrets

    return seal_workflow_node_secrets(
        {
            "nodes": [_setter_node("s1", {"token": "setter-classified-99", "n": "5"}, ["token"])],
            "edges": [],
        }
    )


def _setter_value(workflow: dict[str, Any]) -> Any:
    return workflow["nodes"][0]["data"]["config"]["values"]["variables"]["token"]


class TestApplySecretsModeToWorkflow:
    """The export secrets mode transforms Variable Setter secret literals embedded
    in a workflow the same three ways as top-level variables, so a workflow-only
    secret is never shipped as recoverable ciphertext in mask mode nor as a
    foreign envelope in plaintext mode (REQ-5.2.4.9)."""

    def test_mask_replaces_setter_secret_with_placeholder(self) -> None:
        result = shared.apply_secrets_mode_to_workflow(_sealed_setter_workflow(), "mask")

        assert _setter_value(result) == MASK_PLACEHOLDER

    def test_mask_leaves_non_secret_setter_values(self) -> None:
        result = shared.apply_secrets_mode_to_workflow(_sealed_setter_workflow(), "mask")

        assert result["nodes"][0]["data"]["config"]["values"]["variables"]["n"] == "5"

    def test_encrypted_keeps_the_envelope(self) -> None:
        result = shared.apply_secrets_mode_to_workflow(_sealed_setter_workflow(), "encrypted")

        assert is_secret_envelope(_setter_value(result))

    def test_plaintext_unseals_the_setter_secret(self) -> None:
        result = shared.apply_secrets_mode_to_workflow(_sealed_setter_workflow(), "plaintext")

        assert _setter_value(result) == "setter-classified-99"

    def test_input_workflow_is_not_mutated(self) -> None:
        workflow = _sealed_setter_workflow()
        before = _setter_value(workflow)

        shared.apply_secrets_mode_to_workflow(workflow, "mask")

        assert _setter_value(workflow) == before

    def test_non_dict_workflow_passes_through(self) -> None:
        assert shared.apply_secrets_mode_to_workflow("not-a-dict", "mask") == "not-a-dict"

    def test_plaintext_undecryptable_setter_secret_raises_conflict(self) -> None:
        workflow = {
            "nodes": [_setter_node("s1", {"token": _foreign_envelope("x")}, ["token"])],
            "edges": [],
        }
        with pytest.raises(ConflictException):
            shared.apply_secrets_mode_to_workflow(workflow, "plaintext")


class TestCheckWorkflowForeignEnvelopes:
    """Import validation flags a foreign-sealed setter secret embedded in a
    workflow, not just top-level variables, so a cross-instance workflow import
    warns instead of failing silently at first run."""

    def _foreign_setter_workflow(self) -> dict[str, Any]:
        return {
            "nodes": [_setter_node("s1", {"token": _foreign_envelope("x")}, ["token"])],
            "edges": [],
        }

    def test_foreign_setter_envelope_yields_warning(self) -> None:
        warnings = shared.check_workflow_foreign_envelopes(self._foreign_setter_workflow())

        assert [w["code"] for w in warnings] == ["FOREIGN_ENCRYPTED_SECRET"]
        assert "token" in warnings[0]["message"]

    def test_local_setter_envelope_yields_no_warning(self) -> None:
        assert shared.check_workflow_foreign_envelopes(_sealed_setter_workflow()) == []

    def test_non_dict_input_yields_no_warning(self) -> None:
        assert shared.check_workflow_foreign_envelopes("not-a-dict") == []

    @pytest.mark.parametrize(
        ("holder", "name"),
        [("local-variable", "local_tok"), ("output-default", "out_tok")],
    )
    def test_a_foreign_function_secret_yields_a_warning(self, holder: str, name: str) -> None:
        workflow = {"nodes": [_function_holding(holder, _foreign_envelope("x"))], "edges": []}

        warnings = shared.check_workflow_foreign_envelopes(workflow)

        assert warnings == [
            {
                "code": "FOREIGN_ENCRYPTED_SECRET",
                "message": (
                    f"Secret '{name}' is encrypted by another WAVE instance and "
                    "cannot be decrypted here; re-enter it after import"
                ),
            }
        ]


class TestSanitizeForeignSecrets:
    """Import remediation: a foreign-instance envelope (undecryptable here) or a masked
    placeholder is stored as null and stays secret (REQ-4.5.19, EXPORT-7); local
    envelopes and non-secret values are left untouched."""

    def test_foreign_secret_variable_becomes_null(self) -> None:
        variables = {"token": {"type": "string", "value": _foreign_envelope("x"), "secret": True}}

        result = shared.sanitize_foreign_secret_variables(variables)

        assert result["token"]["value"] is None
        assert result["token"]["secret"] is True

    def test_local_secret_variable_is_untouched(self) -> None:
        variables = seal_variables({"token": {"value": "local", "secret": True}})

        result = shared.sanitize_foreign_secret_variables(variables)

        assert result["token"]["value"] == variables["token"]["value"]

    def test_non_secret_variable_is_untouched(self) -> None:
        variables = {"note": {"type": "string", "value": _foreign_envelope("x")}}

        result = shared.sanitize_foreign_secret_variables(variables)

        assert result["note"]["value"] == variables["note"]["value"]

    def test_foreign_setter_secret_becomes_null(self) -> None:
        workflow = {
            "nodes": [_setter_node("s1", {"token": _foreign_envelope("x"), "n": "5"}, ["token"])],
            "edges": [],
        }

        result = shared.sanitize_foreign_workflow_secrets(workflow)

        assert _setter_value(result) is None
        assert result["nodes"][0]["data"]["config"]["values"]["variables"]["n"] == "5"

    def test_local_setter_secret_is_untouched(self) -> None:
        workflow = _sealed_setter_workflow()

        result = shared.sanitize_foreign_workflow_secrets(workflow)

        assert is_secret_envelope(_setter_value(result))

    def test_workflow_input_is_not_mutated(self) -> None:
        workflow = {"nodes": [_setter_node("s1", {"token": _foreign_envelope("x")}, ["token"])]}
        before = _setter_value(workflow)

        shared.sanitize_foreign_workflow_secrets(workflow)

        assert _setter_value(workflow) == before

    def test_non_dict_variables_pass_through(self) -> None:
        assert shared.sanitize_foreign_secret_variables("not-a-dict") == "not-a-dict"

    def test_non_dict_workflow_passes_through(self) -> None:
        assert shared.sanitize_foreign_workflow_secrets("not-a-dict") == "not-a-dict"

    def test_a_masked_secret_variable_with_nothing_stored_becomes_null(self) -> None:
        variables = {"token": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True}}

        result = shared.sanitize_foreign_secret_variables(variables)

        assert result["token"] == {"type": "string", "value": None, "secret": True}

    def test_a_masked_setter_secret_becomes_null(self) -> None:
        workflow = {
            "nodes": [_setter_node("s1", {"token": MASK_PLACEHOLDER, "n": "5"}, ["token"])],
            "edges": [],
        }

        result = shared.sanitize_foreign_workflow_secrets(workflow)

        assert _setter_value(result) is None
        assert result["nodes"][0]["data"]["config"]["values"]["variables"]["n"] == "5"

    def test_a_masked_value_on_a_plain_variable_is_untouched(self) -> None:
        variables = {"note": {"type": "string", "value": MASK_PLACEHOLDER}}

        result = shared.sanitize_foreign_secret_variables(variables)

        assert result["note"]["value"] == MASK_PLACEHOLDER

    def test_a_masked_secret_where_a_real_secret_is_stored_keeps_the_real_secret(self) -> None:
        stored = {"token": {"type": "string", "value": seal_value("stored-real"), "secret": True}}
        incoming = {"token": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True}}

        result = shared.sanitize_foreign_secret_variables(
            shared.restore_masked_secrets(incoming, stored)
        )

        assert result["token"]["value"] == stored["token"]["value"]

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(_foreign_envelope("x"), id="foreign"),
            pytest.param(MASK_PLACEHOLDER, id="masked"),
        ],
    )
    @pytest.mark.parametrize("holder", ["local-variable", "output-default"])
    def test_a_function_secret_holding_an_unusable_value_becomes_null(
        self, holder: str, value: str
    ) -> None:
        workflow = {"nodes": [_function_holding(holder, value)], "edges": []}

        result = shared.sanitize_foreign_workflow_secrets(workflow)

        assert _function_held_value(result, holder) is None
        assert _function_declaration(result, holder)["secret"] is True

    @pytest.mark.parametrize("holder", ["local-variable", "output-default"])
    def test_a_locally_sealed_function_secret_is_untouched(self, holder: str) -> None:
        envelope = seal_value("local-real")
        workflow = {"nodes": [_function_holding(holder, envelope)], "edges": []}

        result = shared.sanitize_foreign_workflow_secrets(workflow)

        assert _function_held_value(result, holder) == envelope


def _function_holding(holder: str, value: Any) -> dict[str, Any]:
    """A Local Function Block whose secret local or secret output default holds ``value``."""
    definition: dict[str, Any] = {
        "inputs": [],
        "outputs": [{"name": "out_tok", "type": "string", "secret": True}],
        "variables": [{"name": "local_tok", "type": "string", "value": None, "secret": True}],
        "workflow": {"nodes": [], "edges": []},
    }
    if holder == "local-variable":
        definition["variables"][0]["value"] = value
    else:
        definition["outputs"][0]["default"] = value
    return {
        "id": "fn-1",
        "type": "workflowNode",
        "data": {
            "label": "Fn",
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": definition,
        },
    }


def _function_declaration(workflow: dict[str, Any], holder: str) -> dict[str, Any]:
    definition = workflow["nodes"][0]["data"]["localDefinition"]
    declaration: dict[str, Any] = (
        definition["variables"][0] if holder == "local-variable" else definition["outputs"][0]
    )
    return declaration


def _function_held_value(workflow: dict[str, Any], holder: str) -> Any:
    declaration = _function_declaration(workflow, holder)
    return declaration["value"] if holder == "local-variable" else declaration.get("default")


class TestRestoreMaskedSecrets:
    """The save-path round-trip guard (REQ-3.1.3.5): a submitted mask placeholder
    keeps the stored secret rather than sealing '********' over it. One shared
    helper serves the name-keyed variables shape and the flat profile-field shape.
    """

    def test_placeholder_secret_entry_keeps_the_stored_value(self) -> None:
        existing = {
            "api_token": {"type": "string", "value": seal_value("stored-real"), "secret": True}
        }
        submitted = {"api_token": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True}}

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["api_token"]["value"] == existing["api_token"]["value"]

    def test_genuinely_edited_secret_passes_through(self) -> None:
        existing = {
            "api_token": {"type": "string", "value": seal_value("stored-real"), "secret": True}
        }
        submitted = {"api_token": {"type": "string", "value": "new-real-value", "secret": True}}

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["api_token"]["value"] == "new-real-value"

    def test_non_secret_entry_passes_through(self) -> None:
        existing = {"host": {"type": "string", "value": "old.example.com"}}
        submitted = {"host": {"type": "string", "value": "db.example.com"}}

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["host"] == {"type": "string", "value": "db.example.com"}

    def test_placeholder_without_secret_flag_is_not_restored(self) -> None:
        existing = {"note": {"type": "string", "value": "kept"}}
        submitted = {"note": {"type": "string", "value": MASK_PLACEHOLDER}}

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["note"]["value"] == MASK_PLACEHOLDER

    def test_placeholder_with_no_existing_entry_passes_through(self) -> None:
        submitted = {"api_token": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True}}

        restored = shared.restore_masked_secrets(submitted, {})

        assert restored["api_token"]["value"] == MASK_PLACEHOLDER

    def test_placeholder_with_non_dict_existing_passes_through(self) -> None:
        existing = {"api_token": "bare-legacy-value"}
        submitted = {"api_token": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True}}

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["api_token"]["value"] == MASK_PLACEHOLDER

    def test_preserves_other_keys_on_the_restored_entry(self) -> None:
        existing = {
            "api_token": {"type": "string", "value": seal_value("stored-real"), "secret": True}
        }
        submitted = {
            "api_token": {
                "type": "string",
                "value": MASK_PLACEHOLDER,
                "secret": True,
                "description": "service token",
            }
        }

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["api_token"]["description"] == "service token"
        assert restored["api_token"]["secret"] is True
        assert restored["api_token"]["value"] == existing["api_token"]["value"]

    def test_flat_profile_field_placeholder_keeps_the_stored_envelope(self) -> None:
        existing = {"password": seal_value("db-real"), "host": "db.example.com"}
        submitted = {"password": MASK_PLACEHOLDER, "host": "db.example.com"}

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["password"] == existing["password"]

    def test_flat_profile_non_placeholder_field_passes_through(self) -> None:
        existing = {"password": seal_value("db-real")}
        submitted = {"password": "new-plain-secret"}

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["password"] == "new-plain-secret"

    def test_flat_profile_placeholder_with_no_existing_passes_through(self) -> None:
        restored = shared.restore_masked_secrets({"password": MASK_PLACEHOLDER}, {})

        assert restored["password"] == MASK_PLACEHOLDER

    def test_multiple_secret_entries_each_restored(self) -> None:
        existing = {
            "token_a": {"type": "string", "value": seal_value("real-a"), "secret": True},
            "token_b": {"type": "string", "value": seal_value("real-b"), "secret": True},
        }
        submitted = {
            "token_a": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True},
            "token_b": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True},
        }

        restored = shared.restore_masked_secrets(submitted, existing)

        assert restored["token_a"]["value"] == existing["token_a"]["value"]
        assert restored["token_b"]["value"] == existing["token_b"]["value"]

    def test_input_is_not_mutated(self) -> None:
        existing = {
            "api_token": {"type": "string", "value": seal_value("stored-real"), "secret": True}
        }
        submitted = {"api_token": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True}}

        shared.restore_masked_secrets(submitted, existing)

        assert submitted["api_token"]["value"] == MASK_PLACEHOLDER


_SEALED_CANARY = "sealed-never-plain-canary-71"
_PLAIN_VALUE = "now-a-plain-value"


def _flag_dropped(entry: dict[str, Any], dropped: str) -> dict[str, Any]:
    """``entry`` with the secret flag left out, or sent as false."""
    return {**entry, "secret": False} if dropped == "false" else dict(entry)


def _stored_secret(*, sealed: bool = True) -> dict[str, Any]:
    """The stored secret: sealed at a save, unsealed where a run start restores against it."""
    value = seal_value(_SEALED_CANARY) if sealed else _SEALED_CANARY
    return {"type": "string", "value": value, "secret": True}


class TestSealedNeverTurnsPlain:
    """A save never turns a sealed value into a plain one: an echoed mask whose stored
    entry is secret stays secret with the stored value (REQ-3.1.3.5)."""

    @pytest.mark.parametrize("dropped", ["absent", "false"])
    @pytest.mark.parametrize("sealed", [True, False], ids=["save", "run-start"])
    def test_an_echoed_mask_with_the_secret_flag_dropped_stays_secret(
        self, dropped: str, sealed: bool
    ) -> None:
        stored = {"api_token": _stored_secret(sealed=sealed)}
        sent = {"api_token": _flag_dropped({"type": "string", "value": MASK_PLACEHOLDER}, dropped)}

        restored = shared.restore_masked_secrets(sent, stored)

        assert restored["api_token"] == stored["api_token"]

    def test_the_echo_keeps_its_other_keys_and_loses_the_masked_flag(self) -> None:
        stored = {"api_token": _stored_secret()}
        sent = {
            "api_token": {
                "type": "string",
                "value": MASK_PLACEHOLDER,
                "masked": True,
                "description": "service token",
            }
        }

        restored = shared.restore_masked_secrets(sent, stored)

        assert restored["api_token"] == {
            "type": "string",
            "value": stored["api_token"]["value"],
            "secret": True,
            "description": "service token",
        }

    def test_a_secret_map_echoed_without_the_flag_keeps_its_element_types(self) -> None:
        stored = {
            "creds": {
                "type": "map",
                "secret": True,
                "value": {"api_key": "k-1", "port": "8443"},
                "elementTypes": {"api_key": "string", "port": "integer"},
            }
        }
        sent = {"creds": {"type": "map", "value": MASK_PLACEHOLDER}}

        restored = shared.restore_masked_secrets(sent, stored)

        assert restored["creds"] == stored["creds"]

    @pytest.mark.parametrize("dropped", ["absent", "false"])
    @pytest.mark.parametrize("value", [_PLAIN_VALUE, None], ids=["new-value", "cleared"])
    def test_a_new_value_sent_with_the_secret_flag_dropped_is_kept_plain(
        self, dropped: str, value: str | None
    ) -> None:
        stored = {"api_token": _stored_secret()}
        sent = {"api_token": _flag_dropped({"type": "string", "value": value}, dropped)}

        restored = shared.restore_masked_secrets(sent, stored)

        assert restored["api_token"] == sent["api_token"]

    def test_an_imported_variable_echoing_the_mask_without_the_flag_keeps_the_stored_secret(
        self,
    ) -> None:
        stored = {"api_token": _stored_secret()}
        incoming = {"api_token": {"type": "string", "value": MASK_PLACEHOLDER}}

        settled = shared.settle_imported_secret_variables(incoming, stored)

        assert settled["api_token"] == stored["api_token"]

    def test_an_imported_typed_profile_field_echoing_the_mask_without_the_flag_stays_secret(
        self,
    ) -> None:
        stored = {"creds": _stored_secret(), "host": "db.example.com"}
        incoming = {
            "creds": {"type": "string", "value": MASK_PLACEHOLDER},
            "host": "db.example.com",
        }

        settled = shared.settle_imported_flat_secret_fields(incoming, stored, ())

        assert settled == stored


def _read_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class _VariableSurface(NamedTuple):
    """One save boundary that persists name-keyed variables."""

    create: Callable[[dict[str, Any]], str]
    resave: Callable[[str, dict[str, Any]], Any]
    stored: Callable[[str], dict[str, Any]]
    read: Callable[[str], dict[str, Any]]


def _created_test(variables: dict[str, Any]) -> str:
    return str(
        test_service.create_test({"name": "sealed never plain", "variables": variables})["id"]
    )


def _stored_test(test_id: str) -> dict[str, Any]:
    path = storage_paths.get_tests_storage_path() / test_id / "test.yaml"
    return dict(_read_yaml(path)["variables"])


def _read_test(test_id: str) -> dict[str, Any]:
    return dict(test_service.get_test_variables(test_id) or {})


def _created_suite(variables: dict[str, Any]) -> str:
    return str(
        suite_service.create_suite({"name": "sealed never plain", "variables": variables})["id"]
    )


def _stored_suite(suite_id: str) -> dict[str, Any]:
    path = storage_paths.get_suites_storage_path() / suite_id / "suite.yaml"
    return dict(_read_yaml(path)["variables"])


def _read_suite(suite_id: str) -> dict[str, Any]:
    return dict((suite_service.get_suite(suite_id) or {})["variables"])


def _created_regression(variables: dict[str, Any]) -> str:
    created = regression_service.create_regression(
        {"name": "sealed never plain", "variables": variables}
    )
    return str(created["id"])


def _stored_regression(regression_id: str) -> dict[str, Any]:
    path = storage_paths.get_regressions_storage_path() / regression_id / "regression.yaml"
    return dict(_read_yaml(path)["variables"])


def _read_regression(regression_id: str) -> dict[str, Any]:
    return dict((regression_service.get_regression(regression_id) or {})["variables"])


def _created_system(variables: dict[str, Any]) -> str:
    variable_service.set_system_variables(variables)
    return "system"


def _stored_system(_entity_id: str) -> dict[str, Any]:
    return dict(_read_yaml(storage_paths.get_system_variables_file_path())["variables"])


def _read_system(_entity_id: str) -> dict[str, Any]:
    return dict(variable_service.get_system_variables()["variables"])


_VARIABLE_SURFACES = [
    pytest.param(
        _VariableSurface(
            _created_test,
            lambda test_id, variables: test_service.update_test(test_id, {"variables": variables}),
            _stored_test,
            _read_test,
        ),
        id="test",
    ),
    pytest.param(
        _VariableSurface(
            _created_test, test_service.update_test_variables, _stored_test, _read_test
        ),
        id="test-variables",
    ),
    pytest.param(
        _VariableSurface(
            _created_suite,
            lambda suite_id, variables: suite_service.update_suite(
                suite_id, {"variables": variables}
            ),
            _stored_suite,
            _read_suite,
        ),
        id="suite",
    ),
    pytest.param(
        _VariableSurface(
            _created_regression,
            lambda regression_id, variables: regression_service.update_regression(
                regression_id, {"variables": variables}
            ),
            _stored_regression,
            _read_regression,
        ),
        id="regression",
    ),
    pytest.param(
        _VariableSurface(
            _created_system,
            lambda _entity_id, variables: variable_service.set_system_variables(variables),
            _stored_system,
            _read_system,
        ),
        id="system",
    ),
    pytest.param(
        _VariableSurface(
            _created_system,
            lambda _entity_id, variables: variable_service.update_entity_variables(
                "system", variable_service.SYSTEM_ENTITY_ID, variables
            ),
            _stored_system,
            _read_system,
        ),
        id="system-merge",
    ),
]


class TestSealedNeverTurnsPlainAtSave:
    """Every save boundary that persists secret variables keeps a sealed value secret when
    the mask comes back with the secret flag dropped (REQ-3.1.3.5)."""

    @pytest.fixture(autouse=True)
    def _fresh_service_state(self) -> Generator[None, None, None]:
        variable_service._variable_storage.clear()
        variable_service._system_cache_loaded = False
        profile_common._clear_in_memory_cache()
        yield
        variable_service._variable_storage.clear()
        variable_service._system_cache_loaded = False
        profile_common._clear_in_memory_cache()

    @staticmethod
    def _saved(surface: _VariableSurface) -> str:
        return surface.create(
            {
                "api_token": {"type": "string", "value": _SEALED_CANARY, "secret": True},
                "host": {"type": "string", "value": "db.example.com"},
            }
        )

    @pytest.mark.parametrize("surface", _VARIABLE_SURFACES)
    def test_an_echoed_mask_without_the_flag_keeps_the_variable_secret_and_sealed(
        self, surface: _VariableSurface
    ) -> None:
        entity_id = self._saved(surface)
        before = surface.stored(entity_id)["api_token"]["value"]

        surface.resave(
            entity_id,
            {
                "api_token": {"type": "string", "value": MASK_PLACEHOLDER},
                "host": {"type": "string", "value": "db.example.com"},
            },
        )

        stored = surface.stored(entity_id)["api_token"]
        assert stored == {"type": "string", "value": before, "secret": True}
        assert is_secret_envelope(stored["value"])
        assert unseal_all(stored["value"]) == _SEALED_CANARY
        assert surface.read(entity_id)["api_token"]["value"] == MASK_PLACEHOLDER

    @pytest.mark.parametrize("value", [_PLAIN_VALUE, None], ids=["new-value", "cleared"])
    @pytest.mark.parametrize("surface", _VARIABLE_SURFACES)
    def test_a_new_value_without_the_flag_is_stored_plain(
        self, surface: _VariableSurface, value: str | None
    ) -> None:
        entity_id = self._saved(surface)

        surface.resave(
            entity_id,
            {
                "api_token": {"type": "string", "value": value},
                "host": {"type": "string", "value": "db.example.com"},
            },
        )

        assert surface.stored(entity_id)["api_token"] == {"type": "string", "value": value}
        assert surface.read(entity_id)["api_token"] == {"type": "string", "value": value}

    @staticmethod
    def _profile_with_a_typed_credential() -> str:
        typed = {"type": "string", "value": _SEALED_CANARY, "secret": True}
        created = profile_service.create_profile(
            name="sealed never plain",
            profile_type="custom",
            config={"creds": dict(typed)},
            environment_values={"env-1": {"creds": dict(typed)}},
        )
        return str(created["id"])

    @staticmethod
    def _stored_profile(profile_id: str) -> dict[str, Any]:
        path = storage_paths.get_profiles_storage_path() / profile_id / "profile.yaml"
        return dict(_read_yaml(path))

    def test_a_typed_profile_credential_echoed_without_the_flag_stays_secret_and_sealed(
        self,
    ) -> None:
        profile_id = self._profile_with_a_typed_credential()
        before = self._stored_profile(profile_id)
        echoed = {"type": "string", "value": MASK_PLACEHOLDER}

        profile_service.update_profile(
            profile_id,
            config={"creds": dict(echoed)},
            environment_values={"env-1": {"creds": dict(echoed)}},
        )

        stored = self._stored_profile(profile_id)
        for held, kept in (
            (stored["config"]["creds"], before["config"]["creds"]),
            (
                stored["environment_values"]["env-1"]["creds"],
                before["environment_values"]["env-1"]["creds"],
            ),
        ):
            assert held == {"type": "string", "value": kept["value"], "secret": True}
            assert is_secret_envelope(held["value"])
            assert unseal_all(held["value"]) == _SEALED_CANARY
        profile_common._clear_in_memory_cache()
        fetched = profile_service.get_profile(profile_id)
        assert fetched is not None
        assert fetched["config"]["creds"]["value"] == MASK_PLACEHOLDER
        assert fetched["environment_values"]["env-1"]["creds"]["value"] == MASK_PLACEHOLDER

    def test_a_typed_profile_credential_sent_a_new_value_without_the_flag_is_stored_plain(
        self,
    ) -> None:
        profile_id = self._profile_with_a_typed_credential()
        sent = {"type": "string", "value": _PLAIN_VALUE}

        profile_service.update_profile(
            profile_id,
            config={"creds": dict(sent)},
            environment_values={"env-1": {"creds": dict(sent)}},
        )

        stored = self._stored_profile(profile_id)
        assert stored["config"]["creds"] == sent
        assert stored["environment_values"]["env-1"]["creds"] == sent
        profile_common._clear_in_memory_cache()
        fetched = profile_service.get_profile(profile_id)
        assert fetched is not None
        assert fetched["config"]["creds"] == sent
        assert fetched["environment_values"]["env-1"]["creds"] == sent


_FUNCTION_CANARY = "sealed-function-value-canary-72"
_FUNCTION_HOLDERS = ["local-variable", "output-default"]
_HELD_KEY = {"local-variable": "value", "output-default": "default"}
_DECLARED_LIST = {"local-variable": "variables", "output-default": "outputs"}


def _without_the_flag(entry: Mapping[str, Any], dropped: str) -> dict[str, Any]:
    """An echoed entry with its secret flag left out, or sent as false."""
    return _flag_dropped({key: value for key, value in entry.items() if key != "secret"}, dropped)


def _with_declaration(
    definition: dict[str, Any], holder: str, entry: dict[str, Any]
) -> dict[str, Any]:
    """``definition`` with its one declaration of ``holder`` replaced by ``entry``."""
    return {**definition, _DECLARED_LIST[holder]: [entry]}


def _saved_test_holding(holder: str) -> str:
    block = _function_holding(holder, _FUNCTION_CANARY)
    block["position"] = {"x": 0, "y": 0}
    block["data"].update(
        elementType="function",
        version="1.0.0",
        config={"values": {}, "profileBindings": [], "outputBindings": {}},
    )
    block["data"]["localDefinition"].update(
        name="sealed_fn", dependencies={"functions": [], "plugins": []}
    )
    workflow = {"nodes": [block], "edges": [{"source": "start-node", "target": "fn-1"}]}
    created = test_service.create_test({"name": "sealed function value", "workflow": workflow})
    return str(created["id"])


def _stored_test_workflow(test_id: str) -> dict[str, Any]:
    path = storage_paths.get_tests_storage_path() / test_id / "test.yaml"
    return dict(_read_yaml(path)["workflow"])


def _resaved_local_body(test_id: str, holder: str, entry: dict[str, Any]) -> None:
    """Save the Test again from its read, the Local body's declaration sent as ``entry``."""
    read = test_service.get_test(test_id)
    assert read is not None
    workflow = read["workflow"]
    data = workflow["nodes"][0]["data"]
    data["localDefinition"] = _with_declaration(data["localDefinition"], holder, entry)
    test_service.update_test(test_id, {"workflow": workflow})


def _published_function_holding(holder: str) -> str:
    function_id = str(uuid.uuid4())
    definition = _function_holding(holder, _FUNCTION_CANARY)["data"]["localDefinition"]
    function_storage.save_new_version(
        function_id,
        "1.0.0",
        {**definition, "dependencies": {"functions": [], "plugins": []}},
        {"changelog": "initial", "published_at": "2026-01-01T00:00:00Z"},
        name="sealed_fn",
    )
    return function_id


def _stored_version(function_id: str, version: str) -> dict[str, Any]:
    path = storage_paths.get_functions_storage_path() / function_id / "versions"
    return dict(_read_yaml(path / f"{version}.yaml")["definition"])


def _function_declaration_of(definition: Mapping[str, Any], holder: str) -> dict[str, Any]:
    declaration: dict[str, Any] = definition[_DECLARED_LIST[holder]][0]
    return declaration


def _published_again(function_id: str, holder: str, entry: dict[str, Any]) -> None:
    """Publish 2.0.0 from the read of 1.0.0, its declaration sent as ``entry``."""
    read, _etag = functions_service.read_version(function_id, "1.0.0")
    functions_service.add_function_version(
        function_id,
        source_version="1.0.0",
        target_version="2.0.0",
        draft_definition=_with_declaration(read, holder, entry),
        changelog="echo the read",
        description="",
        tags=[],
        details="",
    )


class TestSealedFunctionValueNeverTurnsPlainAtSave:
    """A Function local or secret output default echoed as the mask with the secret flag
    dropped keeps the flag and the stored sealed value, at the Test save of a Local body and
    at the library save (REQ-3.1.3.5, REQ-3.1.2.9)."""

    @pytest.mark.parametrize("dropped", ["absent", "false"])
    @pytest.mark.parametrize("holder", _FUNCTION_HOLDERS)
    def test_a_local_body_echoing_the_mask_without_the_flag_stays_secret_and_sealed(
        self, holder: str, dropped: str
    ) -> None:
        test_id = _saved_test_holding(holder)
        before = dict(_function_declaration(_stored_test_workflow(test_id), holder))
        read = test_service.get_test(test_id)
        assert read is not None
        echoed = _function_declaration(read["workflow"], holder)
        assert echoed[_HELD_KEY[holder]] == MASK_PLACEHOLDER

        _resaved_local_body(test_id, holder, _without_the_flag(echoed, dropped))

        stored = _function_declaration(_stored_test_workflow(test_id), holder)
        assert stored == before
        assert stored["secret"] is True
        assert unseal_all(stored[_HELD_KEY[holder]]) == _FUNCTION_CANARY
        reread = test_service.get_test(test_id)
        assert reread is not None
        assert _function_held_value(reread["workflow"], holder) == MASK_PLACEHOLDER

    @pytest.mark.parametrize("value", [_PLAIN_VALUE, None], ids=["new-value", "cleared"])
    @pytest.mark.parametrize("holder", _FUNCTION_HOLDERS)
    def test_a_local_body_sending_a_new_value_without_the_flag_stores_it_plain(
        self, holder: str, value: str | None
    ) -> None:
        test_id = _saved_test_holding(holder)
        name = _function_declaration(_stored_test_workflow(test_id), holder)["name"]
        sent = {"name": name, "type": "string", _HELD_KEY[holder]: value}

        _resaved_local_body(test_id, holder, dict(sent))

        assert _function_declaration(_stored_test_workflow(test_id), holder) == sent

    @pytest.mark.parametrize("dropped", ["absent", "false"])
    @pytest.mark.parametrize("holder", _FUNCTION_HOLDERS)
    def test_a_library_save_echoing_the_mask_without_the_flag_stays_secret_and_sealed(
        self, holder: str, dropped: str
    ) -> None:
        function_id = _published_function_holding(holder)
        before = dict(_function_declaration_of(_stored_version(function_id, "1.0.0"), holder))
        read, _etag = functions_service.read_version(function_id, "1.0.0")
        echoed = _function_declaration_of(read, holder)
        assert echoed[_HELD_KEY[holder]] == MASK_PLACEHOLDER

        _published_again(function_id, holder, _without_the_flag(echoed, dropped))

        stored = _function_declaration_of(_stored_version(function_id, "2.0.0"), holder)
        assert stored == before
        assert is_secret_envelope(stored[_HELD_KEY[holder]])
        assert unseal_all(stored[_HELD_KEY[holder]]) == _FUNCTION_CANARY

    @pytest.mark.parametrize("holder", _FUNCTION_HOLDERS)
    def test_a_library_save_sending_a_new_value_without_the_flag_stores_it_plain(
        self, holder: str
    ) -> None:
        function_id = _published_function_holding(holder)
        name = _function_declaration_of(_stored_version(function_id, "1.0.0"), holder)["name"]
        sent = {"name": name, "type": "string", _HELD_KEY[holder]: _PLAIN_VALUE}

        _published_again(function_id, holder, dict(sent))

        assert _function_declaration_of(_stored_version(function_id, "2.0.0"), holder) == sent


def _variable_list(secret_value: Any, plain_value: Any = "db.example.com") -> list[dict[str, Any]]:
    """Function local variables in their stored list shape: one secret, one plain."""
    return [
        {"name": "api_token", "type": "string", "value": secret_value, "secret": True},
        {"name": "host", "type": "string", "value": plain_value},
    ]


class TestSanitizeSecretVariableList:
    """The list-shaped import sanitizer for Function local variables (REQ-3.1.2.5, EXPORT-7)."""

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(_foreign_envelope("x"), id="foreign"),
            pytest.param(MASK_PLACEHOLDER, id="masked"),
        ],
    )
    def test_an_unusable_secret_becomes_null_and_stays_secret(self, value: str) -> None:
        result = shared.sanitize_secret_variable_list(_variable_list(value))

        assert result[0] == {"name": "api_token", "type": "string", "value": None, "secret": True}

    def test_a_locally_sealed_secret_is_kept(self) -> None:
        envelope = seal_value("local-real")

        result = shared.sanitize_secret_variable_list(_variable_list(envelope))

        assert result[0]["value"] == envelope

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(_foreign_envelope("x"), id="foreign"),
            pytest.param(MASK_PLACEHOLDER, id="masked"),
        ],
    )
    def test_a_plain_variable_is_untouched(self, value: str) -> None:
        result = shared.sanitize_secret_variable_list(_variable_list(None, plain_value=value))

        assert result[1] == {"name": "host", "type": "string", "value": value}

    def test_the_order_and_every_other_variable_are_kept(self) -> None:
        result = shared.sanitize_secret_variable_list(_variable_list(MASK_PLACEHOLDER))

        assert [item["name"] for item in result] == ["api_token", "host"]
        assert result[1] == {"name": "host", "type": "string", "value": "db.example.com"}

    def test_the_input_is_not_mutated(self) -> None:
        variables = _variable_list(MASK_PLACEHOLDER)

        shared.sanitize_secret_variable_list(variables)

        assert variables[0]["value"] == MASK_PLACEHOLDER


class TestApplySecretsModeToVariableList:
    """The export secrets mode on Function local variables in their list shape (REQ-5.2.4.9)."""

    def test_mask_replaces_each_secret_value_with_the_placeholder(self) -> None:
        result = shared.apply_secrets_mode_to_variable_list(
            _variable_list(seal_value("tok-classified-123")), "mask"
        )

        assert result[0]["value"] == MASK_PLACEHOLDER
        assert result[0]["name"] == "api_token"
        assert result[0]["secret"] is True

    def test_mask_leaves_plain_variables_untouched(self) -> None:
        result = shared.apply_secrets_mode_to_variable_list(
            _variable_list(seal_value("tok-classified-123")), "mask"
        )

        assert result[1] == {"name": "host", "type": "string", "value": "db.example.com"}

    def test_mask_leaves_a_secret_holding_no_value_as_it_is(self) -> None:
        result = shared.apply_secrets_mode_to_variable_list(_variable_list(None), "mask")

        assert result[0]["value"] is None

    def test_encrypted_emits_the_sealed_envelope_verbatim(self) -> None:
        envelope = seal_value("tok-classified-123")

        result = shared.apply_secrets_mode_to_variable_list(_variable_list(envelope), "encrypted")

        assert result[0]["value"] == envelope
        assert result[1] == {"name": "host", "type": "string", "value": "db.example.com"}

    def test_plaintext_unseals_each_secret_value(self) -> None:
        result = shared.apply_secrets_mode_to_variable_list(
            _variable_list(seal_value("tok-classified-123")), "plaintext"
        )

        assert result[0]["value"] == "tok-classified-123"
        assert result[1] == {"name": "host", "type": "string", "value": "db.example.com"}

    def test_plaintext_undecryptable_secret_raises_conflict(self) -> None:
        with pytest.raises(ConflictException, match=rf"^{re.escape(_DECRYPTION_FAILED_MESSAGE)}$"):
            shared.apply_secrets_mode_to_variable_list(
                _variable_list(_foreign_envelope("x")), "plaintext"
            )

    def test_the_input_is_not_mutated(self) -> None:
        envelope = seal_value("tok-classified-123")
        variables = _variable_list(envelope)

        shared.apply_secrets_mode_to_variable_list(variables, "mask")

        assert variables[0]["value"] == envelope


class TestSanitizeFlatSecretFields:
    """The flat-shape import sanitizer for profile config and environment values
    (REQ-4.5.19, EXPORT-7)."""

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(_foreign_envelope("x"), id="foreign"),
            pytest.param(MASK_PLACEHOLDER, id="masked"),
        ],
    )
    def test_an_unusable_value_in_a_secret_field_becomes_null(self, value: str) -> None:
        values = {"password": value, "host": "db.example.com"}

        result = shared.sanitize_flat_secret_fields(values, {"password"})

        assert result == {"password": None, "host": "db.example.com"}

    def test_a_locally_sealed_value_is_kept(self) -> None:
        envelope = seal_value("db-real")

        result = shared.sanitize_flat_secret_fields({"password": envelope}, {"password"})

        assert result == {"password": envelope}

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(_foreign_envelope("x"), id="foreign"),
            pytest.param(MASK_PLACEHOLDER, id="masked"),
        ],
    )
    def test_a_field_not_declared_secret_is_untouched(self, value: str) -> None:
        result = shared.sanitize_flat_secret_fields({"note": value}, {"password"})

        assert result == {"note": value}

    def test_an_absent_secret_field_is_not_added(self) -> None:
        result = shared.sanitize_flat_secret_fields({"host": "db.example.com"}, {"password"})

        assert result == {"host": "db.example.com"}

    def test_the_input_is_not_mutated(self) -> None:
        values = {"password": MASK_PLACEHOLDER}

        shared.sanitize_flat_secret_fields(values, {"password"})

        assert values == {"password": MASK_PLACEHOLDER}


_CRED_PLUGIN_TYPE = "stub-cred-plugin"


class _CredModePlugin:
    """Stub plugin declaring one secret input param, for export-mode coverage."""

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


def _plugin_node(node_id: str, values: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Cred Body",
            "elementType": _CRED_PLUGIN_TYPE,
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": values},
        },
    }


def _sealed_plugin_workflow() -> dict[str, Any]:
    """A workflow whose plugin credential literal is sealed with the local key."""
    from wavecore.core.secrets.sealing import seal_workflow_node_secrets

    return seal_workflow_node_secrets(
        {
            "nodes": [
                _plugin_node("p1", {"password": "cred-classified-77", "host": "example.com"})
            ],
            "edges": [],
        }
    )


def _plugin_cred_value(workflow: dict[str, Any]) -> Any:
    return workflow["nodes"][0]["data"]["config"]["values"]["password"]


class TestApplySecretsModeToPluginCredentials:
    """The export secrets mode transforms a plugin-declared credential literal
    embedded in a workflow the same three ways as a Variable Setter literal, so a
    sealed credential field honors the per-export secret choice (REQ-3.1.3.18)."""

    @pytest.fixture(autouse=True)
    def _registered_cred_plugin(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        clear_registry()
        register_plugin(_CredModePlugin())
        yield
        clear_registry()

    def test_mask_replaces_credential_with_placeholder(self) -> None:
        result = shared.apply_secrets_mode_to_workflow(_sealed_plugin_workflow(), "mask")

        assert _plugin_cred_value(result) == MASK_PLACEHOLDER

    def test_mask_leaves_non_credential_values(self) -> None:
        result = shared.apply_secrets_mode_to_workflow(_sealed_plugin_workflow(), "mask")

        assert result["nodes"][0]["data"]["config"]["values"]["host"] == "example.com"

    def test_encrypted_keeps_the_envelope(self) -> None:
        result = shared.apply_secrets_mode_to_workflow(_sealed_plugin_workflow(), "encrypted")

        assert is_secret_envelope(_plugin_cred_value(result))

    def test_plaintext_unseals_the_credential(self) -> None:
        result = shared.apply_secrets_mode_to_workflow(_sealed_plugin_workflow(), "plaintext")

        assert _plugin_cred_value(result) == "cred-classified-77"

    def test_plaintext_undecryptable_credential_raises_conflict(self) -> None:
        workflow = {
            "nodes": [_plugin_node("p1", {"password": _foreign_envelope("x")})],
            "edges": [],
        }
        with pytest.raises(ConflictException):
            shared.apply_secrets_mode_to_workflow(workflow, "plaintext")


_INPUT_CANARY = "fn-input-classified-88"


def _secret_input_block(value: Any) -> dict[str, Any]:
    """A Local Function Block whose secret input ``tok`` holds ``value`` in its fields."""
    return {
        "id": "fn-in",
        "type": "workflowNode",
        "data": {
            "label": "Fn",
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": {
                "inputs": [{"name": "tok", "type": "string", "secret": True}],
                "outputs": [],
                "variables": [],
                "workflow": {"nodes": [], "edges": []},
            },
            "config": {"values": {"tok": value}},
        },
    }


def _input_value(workflow: dict[str, Any]) -> Any:
    return workflow["nodes"][0]["data"]["config"]["values"]["tok"]


class TestApplySecretsModeToFunctionBlockSecretInputs:
    """A secret Function Block input is a credential field, so the export secrets mode
    and the foreign-envelope check treat it like a plugin credential (REQ-5.2.4.9)."""

    def test_mask_replaces_the_input_with_the_placeholder(self) -> None:
        workflow = {"nodes": [_secret_input_block(seal_value(_INPUT_CANARY))], "edges": []}

        result = shared.apply_secrets_mode_to_workflow(workflow, "mask")

        assert _input_value(result) == MASK_PLACEHOLDER

    def test_encrypted_keeps_the_envelope(self) -> None:
        workflow = {"nodes": [_secret_input_block(seal_value(_INPUT_CANARY))], "edges": []}

        result = shared.apply_secrets_mode_to_workflow(workflow, "encrypted")

        assert is_secret_envelope(_input_value(result))
        assert unseal_all(_input_value(result)) == _INPUT_CANARY

    def test_plaintext_unseals_the_input(self) -> None:
        workflow = {"nodes": [_secret_input_block(seal_value(_INPUT_CANARY))], "edges": []}

        result = shared.apply_secrets_mode_to_workflow(workflow, "plaintext")

        assert _input_value(result) == _INPUT_CANARY

    def test_plaintext_undecryptable_input_raises_conflict(self) -> None:
        workflow = {"nodes": [_secret_input_block(_foreign_envelope("x"))], "edges": []}

        with pytest.raises(ConflictException, match=rf"^{re.escape(_DECRYPTION_FAILED_MESSAGE)}$"):
            shared.apply_secrets_mode_to_workflow(workflow, "plaintext")

    def test_a_foreign_input_envelope_yields_a_warning(self) -> None:
        workflow = {"nodes": [_secret_input_block(_foreign_envelope("x"))], "edges": []}

        warnings = shared.check_workflow_foreign_envelopes(workflow)

        assert warnings == [
            {
                "code": "FOREIGN_ENCRYPTED_SECRET",
                "message": (
                    "Secret 'tok' is encrypted by another WAVE instance and "
                    "cannot be decrypted here; re-enter it after import"
                ),
            }
        ]


def _pinned_secret_input_block(function_id: str, value: Any) -> dict[str, Any]:
    """A Shared Function Block pinned to 1.0.0 whose secret input ``tok`` holds ``value``."""
    return {
        "id": "fn-in",
        "type": "workflowNode",
        "data": {
            "label": "Fn",
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": "1.0.0",
            "config": {"values": {"tok": value}},
        },
    }


class TestApplySecretsModeToAPinnedSharedFunctionBlockSecretInput:
    """With no secret-name lookup passed, a pinned Shared Function Block's secret input goes
    through the export secrets mode and the foreign-envelope check like a plugin credential
    (REQ-5.2.4.9)."""

    @pytest.fixture
    def function_id(self) -> str:
        fn_id = str(uuid.uuid4())
        function_storage.save_new_version(
            fn_id,
            "1.0.0",
            {
                "inputs": [{"name": "tok", "type": "string", "secret": True}],
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
        return fn_id

    def _workflow(self, function_id: str, value: Any) -> dict[str, Any]:
        return {"nodes": [_pinned_secret_input_block(function_id, value)], "edges": []}

    def test_mask_replaces_the_input_with_the_placeholder(self, function_id: str) -> None:
        workflow = self._workflow(function_id, seal_value(_INPUT_CANARY))

        result = shared.apply_secrets_mode_to_workflow(workflow, "mask")

        assert _input_value(result) == MASK_PLACEHOLDER

    def test_encrypted_keeps_the_envelope(self, function_id: str) -> None:
        workflow = self._workflow(function_id, seal_value(_INPUT_CANARY))

        result = shared.apply_secrets_mode_to_workflow(workflow, "encrypted")

        assert is_secret_envelope(_input_value(result))
        assert unseal_all(_input_value(result)) == _INPUT_CANARY

    def test_plaintext_unseals_the_input(self, function_id: str) -> None:
        workflow = self._workflow(function_id, seal_value(_INPUT_CANARY))

        result = shared.apply_secrets_mode_to_workflow(workflow, "plaintext")

        assert _input_value(result) == _INPUT_CANARY

    def test_plaintext_undecryptable_input_raises_conflict(self, function_id: str) -> None:
        workflow = self._workflow(function_id, _foreign_envelope("x"))

        with pytest.raises(ConflictException, match=rf"^{re.escape(_DECRYPTION_FAILED_MESSAGE)}$"):
            shared.apply_secrets_mode_to_workflow(workflow, "plaintext")

    def test_a_foreign_input_envelope_yields_a_warning(self, function_id: str) -> None:
        workflow = self._workflow(function_id, _foreign_envelope("x"))

        warnings = shared.check_workflow_foreign_envelopes(workflow)

        assert warnings == [
            {
                "code": "FOREIGN_ENCRYPTED_SECRET",
                "message": (
                    "Secret 'tok' is encrypted by another WAVE instance and "
                    "cannot be decrypted here; re-enter it after import"
                ),
            }
        ]
