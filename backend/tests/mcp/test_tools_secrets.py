"""reveal_secret tool: consent-gated secret reveal across every masking surface.

Each surface honors its governing reveal flag; a masked default deployment never
yields plaintext, revealing needs the flag ON plus explicit per-retrieval consent,
and the flag alone never widens without consent.
"""

from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

import wavecore.core.secrets.masking_settings as masking_settings
from wavecore.core.secrets.masking import MASK_PLACEHOLDER

SECRET_VALUE = "real"

REVEAL_NOT_PERMITTED_MESSAGE = (
    "Secret reveal is disabled by this deployment's masking settings; " "the value stays masked."
)
CONSENT_REQUIRED_MESSAGE = (
    "Revealing this secret requires explicit per-retrieval consent. "
    "Confirm with the user, then call reveal_secret again with consent set to true."
)
NOT_SET_MESSAGE = "This secret has no value set; there is nothing to reveal."

# (entity_type, governing reveal flag, secret name) - the reveal surfaces.
SURFACES = [
    ("system", "shared_variables", "token"),
    ("global", "shared_variables", "token"),
    ("suite", "shared_variables", "token"),
    ("regression", "shared_variables", "token"),
    ("test", "test_variables", "token"),
    ("profile", "credential_inputs", "password"),
    ("function", "test_variables", "token"),
]
SURFACE_IDS = [surface[0] for surface in SURFACES]


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:
    """The test surface seeds a test with a Log node; the registry must know it."""


@pytest.fixture(autouse=True)
def clear_entity_caches(temp_storage_path: Path) -> Generator[None, None, None]:
    from wavecore.api.services import variable_service
    from wavecore.api.services.functions import service as function_service
    from wavecore.api.services.profiles import _common as profile_common
    from wavecore.api.services.suites import _storage as suite_storage

    def _clear() -> None:
        suite_storage._clear_storage()
        profile_common._clear_in_memory_cache()
        function_service._clear_in_memory_cache()
        variable_service._variable_storage.clear()
        variable_service._watch_storage.clear()
        variable_service._system_cache_loaded = False

    _clear()
    yield
    _clear()


def secrets_tool() -> Any:
    from wavecore.mcp.tools import secrets as secrets_tools

    return secrets_tools


def _seed_surface(entity_type: str, secret_name: str) -> str:
    """Seed a sealed secret on the surface; return the reveal ref."""
    secret_var = {secret_name: {"type": "string", "secret": True, "value": SECRET_VALUE}}
    if entity_type in ("system", "global"):
        from wavecore.api.services import variable_service

        variable_service.set_system_variables(secret_var)
        return variable_service.SYSTEM_ENTITY_ID
    if entity_type == "suite":
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite({"name": "Reveal Suite", "variables": secret_var})
        return str(suite["id"])
    if entity_type == "regression":
        from wavecore.api.services.regressions import service as regression_service

        regression = regression_service.create_regression(
            {"name": "Reveal Regression", "variables": secret_var}
        )
        return str(regression["id"])
    if entity_type == "test":
        from tests.mcp.conftest import create_test_entity

        test = create_test_entity("Reveal Test", variables=secret_var)
        return str(test["id"])
    if entity_type == "function":
        return _seed_function(
            variables=[
                {"name": secret_name, "type": "string", "secret": True, "value": SECRET_VALUE}
            ]
        )
    from wavecore.api.services.profiles import service as profile_service

    profile = profile_service.create_profile(
        name="Reveal Profile",
        profile_type="database",
        config={
            "host": "db.local",
            "database": "app",
            "username": "svc",
            secret_name: SECRET_VALUE,
        },
    )
    return str(profile["id"])


def _seed_function(
    *,
    variables: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    name: str = "Reveal Function",
) -> str:
    """Publish a library Function holding ``variables`` and ``outputs``; return its id."""
    from wavecore.api.services.functions import service as function_service

    created, _etag = function_service.create_function(
        {
            "name": name,
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": outputs or [],
            "variables": variables or [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        }
    )
    return str(created["id"])


@pytest.mark.parametrize(("entity_type", "flag", "secret_name"), SURFACES, ids=SURFACE_IDS)
class TestRevealSecret:
    def test_flag_off_stays_masked(self, entity_type: str, flag: str, secret_name: str) -> None:
        ref = _seed_surface(entity_type, secret_name)
        result = secrets_tool().reveal_secret(entity_type, ref, secret_name)
        assert result == {
            "revealed": False,
            "reason": "reveal_not_permitted",
            "value": MASK_PLACEHOLDER,
            "message": REVEAL_NOT_PERMITTED_MESSAGE,
        }

    def test_flag_on_without_consent_requires_consent(
        self, entity_type: str, flag: str, secret_name: str
    ) -> None:
        ref = _seed_surface(entity_type, secret_name)
        masking_settings.set_reveal_settings(**{flag: True})
        result = secrets_tool().reveal_secret(entity_type, ref, secret_name)
        assert result == {
            "revealed": False,
            "reason": "consent_required",
            "message": CONSENT_REQUIRED_MESSAGE,
        }

    def test_flag_on_with_consent_reveals_plaintext(
        self, entity_type: str, flag: str, secret_name: str
    ) -> None:
        ref = _seed_surface(entity_type, secret_name)
        masking_settings.set_reveal_settings(**{flag: True})
        result = secrets_tool().reveal_secret(entity_type, ref, secret_name, consent=True)
        assert result == {"revealed": True, "value": SECRET_VALUE}

    def test_flag_off_ignores_consent(self, entity_type: str, flag: str, secret_name: str) -> None:
        # Never-widen: consent cannot bypass a disabled reveal flag.
        ref = _seed_surface(entity_type, secret_name)
        result = secrets_tool().reveal_secret(entity_type, ref, secret_name, consent=True)
        assert result == {
            "revealed": False,
            "reason": "reveal_not_permitted",
            "value": MASK_PLACEHOLDER,
            "message": REVEAL_NOT_PERMITTED_MESSAGE,
        }


class TestRevealSecretVocabulary:
    """An out-of-vocabulary entity_type is a bad request, not a policy refusal:
    the two must be distinguishable or a client misreports the deployment."""

    def test_unknown_entity_type_is_rejected(self) -> None:
        from wavecore.api.exceptions import ValidationException

        with pytest.raises(
            ValidationException,
            match=(
                r"^Invalid entity_type 'bogus': valid types are "
                r"system, global, suite, regression, test, profile, function$"
            ),
        ):
            secrets_tool().reveal_secret("bogus", "any-ref", "token")

    def test_unknown_entity_type_is_rejected_before_the_reveal_flag(self) -> None:
        from wavecore.api.exceptions import ValidationException

        masking_settings.set_reveal_settings(shared_variables=True)
        with pytest.raises(ValidationException, match=r"^Invalid entity_type"):
            secrets_tool().reveal_secret("bogus", "any-ref", "token", consent=True)


class TestRevealFunctionSecret:
    """A Function's own secret values reveal as a Test variable's do, under the same flag."""

    def test_a_secret_output_default_reveals(self) -> None:
        fn_id = _seed_function(
            outputs=[{"name": "out", "type": "string", "secret": True, "default": SECRET_VALUE}]
        )
        masking_settings.set_reveal_settings(test_variables=True)

        result = secrets_tool().reveal_secret("function", fn_id, "out", consent=True)

        assert result == {"revealed": True, "value": SECRET_VALUE}

    def test_a_function_is_found_by_its_name(self) -> None:
        _seed_function(
            variables=[{"name": "token", "type": "string", "secret": True, "value": SECRET_VALUE}],
            name="Named Reveal",
        )
        masking_settings.set_reveal_settings(test_variables=True)

        result = secrets_tool().reveal_secret("function", "Named Reveal", "token", consent=True)

        assert result == {"revealed": True, "value": SECRET_VALUE}

    def test_a_plain_local_is_not_revealed(self) -> None:
        fn_id = _seed_function(variables=[{"name": "token", "type": "string", "value": "shown"}])
        masking_settings.set_reveal_settings(test_variables=True)

        result = secrets_tool().reveal_secret("function", fn_id, "token", consent=True)

        assert result == {"revealed": False, "reason": "value_not_set", "message": NOT_SET_MESSAGE}

    def test_an_unknown_function_is_not_found(self) -> None:
        from wavecore.api.exceptions import NotFoundException

        masking_settings.set_reveal_settings(test_variables=True)

        with pytest.raises(NotFoundException, match=r"^Function 'ghost' not found$"):
            secrets_tool().reveal_secret("function", "ghost", "token", consent=True)


class TestRevealUnsetSecret:
    """A secret declared without a value has nothing to reveal; saying so is not
    the same as returning a null value."""

    def test_unset_test_secret_reports_not_set(self) -> None:
        from tests.mcp.conftest import create_test_entity

        test = create_test_entity(
            "Unset Secret Test", variables={"token": {"type": "string", "secret": True}}
        )
        masking_settings.set_reveal_settings(test_variables=True)

        result = secrets_tool().reveal_secret("test", str(test["id"]), "token", consent=True)

        assert result == {
            "revealed": False,
            "reason": "value_not_set",
            "message": NOT_SET_MESSAGE,
        }

    def test_unknown_secret_name_reports_not_set(self) -> None:
        from tests.mcp.conftest import create_test_entity

        test = create_test_entity("No Secret Test", variables={})
        masking_settings.set_reveal_settings(test_variables=True)

        result = secrets_tool().reveal_secret("test", str(test["id"]), "ghost", consent=True)

        assert result["revealed"] is False
        assert result["reason"] == "value_not_set"

    def test_a_secret_holding_an_empty_string_reports_not_set(self) -> None:
        """An empty secret holds nothing, so there is nothing to reveal (REQ-4.5.1)."""
        from tests.mcp.conftest import create_test_entity

        test = create_test_entity(
            "Empty Secret Test",
            variables={"token": {"type": "string", "secret": True, "value": ""}},
        )
        masking_settings.set_reveal_settings(test_variables=True)

        result = secrets_tool().reveal_secret("test", str(test["id"]), "token", consent=True)

        assert result == {
            "revealed": False,
            "reason": "value_not_set",
            "message": NOT_SET_MESSAGE,
        }

    @pytest.mark.parametrize(
        "config",
        [
            pytest.param({"password": ""}, id="flat-empty"),
            pytest.param({"password": {"type": "string", "secret": True}}, id="typed-unset"),
            pytest.param(
                {"password": {"type": "string", "secret": True, "value": ""}}, id="typed-empty"
            ),
        ],
    )
    def test_an_empty_profile_secret_reports_not_set(self, config: dict[str, Any]) -> None:
        from wavecore.api.services.profiles import service as profile_service

        profile = profile_service.create_profile(
            name="Empty Profile Secret", profile_type="custom", config=config
        )
        masking_settings.set_reveal_settings(credential_inputs=True)

        result = secrets_tool().reveal_secret(
            "profile", str(profile["id"]), "password", consent=True
        )

        assert result["reason"] == "value_not_set"

    def test_a_typed_profile_secret_reveals_its_value(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        profile = profile_service.create_profile(
            name="Typed Profile Secret",
            profile_type="custom",
            config={"password": {"type": "string", "secret": True, "value": SECRET_VALUE}},
        )
        masking_settings.set_reveal_settings(credential_inputs=True)

        result = secrets_tool().reveal_secret(
            "profile", str(profile["id"]), "password", consent=True
        )

        assert result == {"revealed": True, "value": SECRET_VALUE}

    @pytest.mark.parametrize("kind", ["foreign", "masked"])
    def test_an_imported_profile_secret_wave_cannot_open_reports_not_set(self, kind: str) -> None:
        """An import stores such a credential as null, owed until a person enters it
        (REQ-4.5.19, EXPORT-7)."""
        import yaml

        from wavecore.api.services.profiles import import_export as profile_import_export
        from wavecore.core.secrets.cipher import SecretCipher

        held = SecretCipher(bytes(range(1, 33))).seal("sealed-elsewhere")
        document = {
            "name": "Imported Profile Secret",
            "type": "database",
            "config": {"password": held if kind == "foreign" else MASK_PLACEHOLDER},
        }
        imported = profile_import_export.import_profiles(
            yaml.dump(document).encode(), "profile.yaml"
        )
        masking_settings.set_reveal_settings(credential_inputs=True)

        result = secrets_tool().reveal_secret(
            "profile", str(imported["imported"][0]["id"]), "password", consent=True
        )

        assert result == {
            "revealed": False,
            "reason": "value_not_set",
            "message": NOT_SET_MESSAGE,
        }
