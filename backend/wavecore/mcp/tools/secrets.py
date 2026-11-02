"""Consent-gated secret reveal, mirroring the deployment's masking policy.

Masked by default. A value is only returned when the surface's masking flag is
ON and the caller passes explicit per-retrieval consent; the flag alone never
widens the policy. Reads reuse the same unseal path as the UI reveal surfaces.
"""

from typing import Any

import wavecore.core.secrets.masking_settings as masking_settings
from wavecore.api.exceptions import ValidationException
from wavecore.api.services import variable_service
from wavecore.api.services.functions import _storage as function_storage
from wavecore.api.services.profiles import _common as profile_common
from wavecore.api.services.regressions import _storage as regression_storage
from wavecore.api.services.suites import _storage as suite_storage
from wavecore.api.services.tests import service as test_service
from wavecore.core.secrets.masking import MASK_PLACEHOLDER, holds_secret_value
from wavecore.core.secrets.sealing import own_secret_value, unseal_all
from wavecore.mcp.tools.discover import (
    _resolve_ref,
    resolve_regression,
    resolve_suite,
    resolve_test,
)

_LIST_ALL = 10_000

REVEAL_NOT_PERMITTED_MESSAGE = (
    "Secret reveal is disabled by this deployment's masking settings; the value stays masked."
)
CONSENT_REQUIRED_MESSAGE = (
    "Revealing this secret requires explicit per-retrieval consent. "
    "Confirm with the user, then call reveal_secret again with consent set to true."
)
NOT_SET_MESSAGE = "This secret has no value set; there is nothing to reveal."

_FLAG_ACCESSORS = {
    "system": masking_settings.is_shared_variables_revealed,
    "global": masking_settings.is_shared_variables_revealed,
    "suite": masking_settings.is_shared_variables_revealed,
    "regression": masking_settings.is_shared_variables_revealed,
    "test": masking_settings.is_test_variables_revealed,
    "profile": masking_settings.is_credential_inputs_revealed,
    "function": masking_settings.is_test_variables_revealed,
}


def _variable_value(variables: dict[str, Any] | None, secret_name: str) -> Any:
    return ((variables or {}).get(secret_name) or {}).get("value")


def _read_shared_secret(_ref: str, secret_name: str) -> Any:
    return _variable_value(variable_service.get_system_variables_raw()["variables"], secret_name)


def _read_suite_secret(ref: str, secret_name: str) -> Any:
    raw = suite_storage._load_suite(str(resolve_suite(ref)["id"])) or {}
    return _variable_value(raw.get("variables"), secret_name)


def _read_regression_secret(ref: str, secret_name: str) -> Any:
    raw = regression_storage._load_regression(str(resolve_regression(ref)["id"])) or {}
    return _variable_value(raw.get("variables"), secret_name)


def _read_test_secret(ref: str, secret_name: str) -> Any:
    return _variable_value(
        test_service.get_test_variables_raw(str(resolve_test(ref)["id"])), secret_name
    )


def _read_profile_secret(ref: str, secret_name: str) -> Any:
    from wavecore.api.services.profiles import service as profile_service

    profile = _resolve_ref(
        ref,
        type_label="profile",
        get_by_id=profile_service.get_profile,
        list_all=lambda: profile_service.list_profiles(per_page=_LIST_ALL)["profiles"],
    )
    stored = profile_common._profile_storage.get(str(profile["id"])) or {}
    field = (stored.get("config") or {}).get(secret_name)
    return field.get("value") if profile_common._is_typed_secret(field) else field


def _stored_function(function_id: str) -> dict[str, Any] | None:
    try:
        return function_storage.load_function(function_id)[0]
    except LookupError:
        return None


def _read_function_secret(ref: str, secret_name: str) -> Any:
    """A library Function's own secret local or output default, as its latest version holds it."""
    definition = _resolve_ref(
        ref,
        type_label="function",
        get_by_id=_stored_function,
        list_all=function_storage.list_function_summaries,
    )
    return own_secret_value(definition, secret_name)


_SECRET_READERS = {
    "system": _read_shared_secret,
    "global": _read_shared_secret,
    "suite": _read_suite_secret,
    "regression": _read_regression_secret,
    "test": _read_test_secret,
    "profile": _read_profile_secret,
    "function": _read_function_secret,
}


def _read_sealed_secret(entity_type: str, ref: str, secret_name: str) -> Any:
    """The stored value of the secret, or None when the surface carries none for it."""
    return _SECRET_READERS[entity_type](ref, secret_name)


def reveal_secret(
    entity_type: str, ref: str, secret_name: str, consent: bool = False
) -> dict[str, Any]:
    """Reveal a secret only when the surface's flag is ON and consent is given."""
    accessor = _FLAG_ACCESSORS.get(entity_type)
    if accessor is None:
        # A bad request must not read as 'reveal is disabled deployment-wide'.
        valid = ", ".join(_FLAG_ACCESSORS)
        raise ValidationException(f"Invalid entity_type '{entity_type}': valid types are {valid}")
    if not accessor():
        return {
            "revealed": False,
            "reason": "reveal_not_permitted",
            "value": MASK_PLACEHOLDER,
            "message": REVEAL_NOT_PERMITTED_MESSAGE,
        }
    if consent is not True:
        return {
            "revealed": False,
            "reason": "consent_required",
            "message": CONSENT_REQUIRED_MESSAGE,
        }
    sealed = _read_sealed_secret(entity_type, ref, secret_name)
    if not holds_secret_value(sealed):
        return {"revealed": False, "reason": "value_not_set", "message": NOT_SET_MESSAGE}
    return {"revealed": True, "value": unseal_all(sealed)}
