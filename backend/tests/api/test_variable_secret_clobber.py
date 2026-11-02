"""Cold-cache secret-clobber guard for system-scope variable writes.

A fresh process that only ever WROTE system variables (never read them) starts
with an empty in-memory cache. A masked-secret round-trip through
``set_entity_variables``/``update_entity_variables`` must hydrate the on-disk
baseline first so the mask placeholder never overwrites the stored secret.
"""

import pytest

from wavecore.api.services import variable_service
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import unseal_all

SYSTEM_ENTITY_ID = variable_service.SYSTEM_ENTITY_ID
_SECRET_VALUE = "real-secret"


def _reset_storage() -> None:
    """Reset module-level storage for test isolation."""
    variable_service._variable_storage.clear()
    variable_service._watch_storage.clear()
    variable_service._system_cache_loaded = False


def _seed_secret_then_go_cold() -> None:
    """Persist a real system secret, then drop the in-memory cache + hydrated
    flag to simulate a fresh write-only process."""
    variable_service.set_system_variables(
        {"token": {"type": "string", "secret": True, "value": _SECRET_VALUE}}
    )
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False


@pytest.fixture(autouse=True)
def _isolated_storage_path(tmp_path, monkeypatch):
    """Redirect the system-variables file to a tmp path for every test."""
    target = tmp_path / "system_variables.yaml"
    monkeypatch.setattr(
        variable_service,
        "get_system_variables_file_path",
        lambda: target,
    )
    _reset_storage()
    yield target


class TestSetEntityVariablesColdCacheClobber:
    """set_entity_variables('system', ...) on a cold cache must not seal the
    mask placeholder over the stored secret."""

    def test_masked_secret_survives_cold_cache_via_set_system_variables(self) -> None:
        _seed_secret_then_go_cold()

        variable_service.set_system_variables(
            {"token": {"type": "string", "secret": True, "value": MASK_PLACEHOLDER}}
        )

        stored = variable_service._variable_storage["system"][SYSTEM_ENTITY_ID]["token"]["value"]
        assert unseal_all(stored) == _SECRET_VALUE

    def test_masked_secret_survives_cold_cache_via_set_entity_variables_direct(self) -> None:
        _seed_secret_then_go_cold()

        variable_service.set_entity_variables(
            "system",
            SYSTEM_ENTITY_ID,
            {"token": {"type": "string", "secret": True, "value": MASK_PLACEHOLDER}},
        )

        stored = variable_service._variable_storage["system"][SYSTEM_ENTITY_ID]["token"]["value"]
        assert unseal_all(stored) == _SECRET_VALUE

    def test_masked_round_trip_keeps_real_secret_on_disk(self) -> None:
        _seed_secret_then_go_cold()

        variable_service.set_system_variables(
            {"token": {"type": "string", "secret": True, "value": MASK_PLACEHOLDER}}
        )

        raw = variable_service.get_system_variables_raw()
        assert unseal_all(raw["variables"]["token"]["value"]) == _SECRET_VALUE


class TestUpdateEntityVariablesColdCache:
    """update_entity_variables('system', ...) on a cold cache must hydrate the
    system entity from disk instead of returning None or clobbering the secret."""

    def test_update_returns_not_none_on_cold_system_cache(self) -> None:
        _seed_secret_then_go_cold()

        result = variable_service.update_entity_variables(
            "system",
            SYSTEM_ENTITY_ID,
            {"token": {"type": "string", "secret": True, "value": MASK_PLACEHOLDER}},
        )

        assert result is not None

    def test_update_masked_secret_survives_cold_cache(self) -> None:
        _seed_secret_then_go_cold()

        result = variable_service.update_entity_variables(
            "system",
            SYSTEM_ENTITY_ID,
            {"token": {"type": "string", "secret": True, "value": MASK_PLACEHOLDER}},
        )

        assert result is not None
        stored = variable_service._variable_storage["system"][SYSTEM_ENTITY_ID]["token"]["value"]
        assert unseal_all(stored) == _SECRET_VALUE
