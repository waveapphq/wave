"""GET/PUT /admin/secret-masking over the four reveal flags of the config file (REQ-3.1.3.17)."""

from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

import wavecore.core.secrets.masking_settings as masking_settings
from wavecore.api.config import get_config

_ENDPOINT = "/admin/secret-masking"
_FLAGS = ("run_output", "test_variables", "shared_variables", "credential_inputs")


@pytest.fixture
def _reset_reveal_settings() -> Generator[None, None, None]:
    masking_settings.set_reveal_settings(
        run_output=False,
        test_variables=False,
        shared_variables=False,
        credential_inputs=False,
    )
    yield
    masking_settings.set_reveal_settings(
        run_output=False,
        test_variables=False,
        shared_variables=False,
        credential_inputs=False,
    )


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    from wavecore.api.app import app

    with TestClient(app) as test_client:
        yield test_client


def _flags(body: dict[str, Any]) -> dict[str, bool]:
    return {name: body[name] for name in _FLAGS}


@pytest.mark.usefixtures("_reset_reveal_settings")
class TestGetSecretMasking:
    def test_get_returns_all_flags_false_by_default(self, client: TestClient) -> None:
        response = client.get(_ENDPOINT)
        assert response.status_code == 200
        body = response.json()
        assert body["run_output"] is False
        assert body["test_variables"] is False
        assert body["shared_variables"] is False
        assert body["credential_inputs"] is False

    def test_get_includes_a_timestamp(self, client: TestClient) -> None:
        body = client.get(_ENDPOINT).json()
        assert isinstance(body["timestamp"], str)
        assert body["timestamp"]

    def test_get_reflects_a_flag_set_out_of_band(self, client: TestClient) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        body = client.get(_ENDPOINT).json()
        assert body["run_output"] is True
        assert body["test_variables"] is False


@pytest.mark.usefixtures("_reset_reveal_settings")
class TestPutSecretMasking:
    def test_put_sets_a_single_flag(self, client: TestClient) -> None:
        response = client.put(_ENDPOINT, json={"run_output": True})
        assert response.status_code == 200
        body = response.json()
        assert body["run_output"] is True
        assert body["test_variables"] is False
        assert body["shared_variables"] is False

    def test_put_partial_preserves_other_flags(self, client: TestClient) -> None:
        client.put(_ENDPOINT, json={"test_variables": True})
        response = client.put(_ENDPOINT, json={"shared_variables": True})
        body = response.json()
        assert body["test_variables"] is True
        assert body["shared_variables"] is True
        assert body["run_output"] is False

    def test_put_round_trips_through_get(self, client: TestClient) -> None:
        client.put(
            _ENDPOINT,
            json={"run_output": True, "test_variables": True, "shared_variables": True},
        )
        body = client.get(_ENDPOINT).json()
        assert body["run_output"] is True
        assert body["test_variables"] is True
        assert body["shared_variables"] is True

    def test_put_can_turn_a_flag_back_off(self, client: TestClient) -> None:
        client.put(_ENDPOINT, json={"shared_variables": True})
        response = client.put(_ENDPOINT, json={"shared_variables": False})
        assert response.json()["shared_variables"] is False

    def test_put_sets_the_credential_inputs_flag(self, client: TestClient) -> None:
        response = client.put(_ENDPOINT, json={"credential_inputs": True})
        body = response.json()
        assert body["credential_inputs"] is True
        assert body["shared_variables"] is False
        assert body["run_output"] is False

    def test_put_returns_a_timestamp(self, client: TestClient) -> None:
        body = client.put(_ENDPOINT, json={"run_output": True}).json()
        assert isinstance(body["timestamp"], str)

    def test_put_rejects_non_boolean_flag_with_400(self, client: TestClient) -> None:
        # The app's global RequestValidationError handler returns 400 (not
        # FastAPI's default 422) for body validation - the established convention.
        response = client.put(_ENDPOINT, json={"run_output": "not-a-boolean"})
        assert response.status_code == 400

    def test_put_rejects_non_boolean_container_with_400(self, client: TestClient) -> None:
        response = client.put(_ENDPOINT, json={"shared_variables": [1, 2]})
        assert response.status_code == 400


class TestSecretMaskingStorage:
    """The flags are read from and written to the config file (REQ-3.1.3.17)."""

    def test_get_masks_every_surface_on_an_empty_config_file(self, client: TestClient) -> None:
        response = client.get(_ENDPOINT)

        assert response.status_code == 200
        assert _flags(response.json()) == dict.fromkeys(_FLAGS, False)

    def test_get_reads_the_flags_from_the_config_file(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        load_config({"secret_masking": {"shared_variables": True, "credential_inputs": True}})

        response = client.get(_ENDPOINT)

        assert response.status_code == 200
        assert _flags(response.json()) == {
            "run_output": False,
            "test_variables": False,
            "shared_variables": True,
            "credential_inputs": True,
        }

    def test_put_writes_only_the_named_flag(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        response = client.put(_ENDPOINT, json={"run_output": True})

        assert response.status_code == 200
        assert _flags(response.json()) == {**dict.fromkeys(_FLAGS, False), "run_output": True}
        assert config_on_disk() == {"secret_masking": {"run_output": True}}

    def test_put_leaves_the_other_three_flags_as_they_are_in_the_file(
        self,
        client: TestClient,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(
            {
                "logging": {"level": "DEBUG"},
                "secret_masking": {
                    "run_output": False,
                    "test_variables": True,
                    "shared_variables": False,
                    "credential_inputs": True,
                },
            }
        )

        response = client.put(_ENDPOINT, json={"run_output": True})

        assert response.status_code == 200
        assert config_on_disk() == {
            "logging": {"level": "DEBUG"},
            "secret_masking": {
                "run_output": True,
                "test_variables": True,
                "shared_variables": False,
                "credential_inputs": True,
            },
        }

    def test_put_writes_a_flag_turned_off(
        self,
        client: TestClient,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config({"secret_masking": {"test_variables": True}})

        response = client.put(_ENDPOINT, json={"test_variables": False})

        assert response.status_code == 200
        assert response.json()["test_variables"] is False
        assert config_on_disk() == {"secret_masking": {"test_variables": False}}

    def test_saved_flag_survives_a_restart(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        client.put(_ENDPOINT, json={"run_output": True})

        load_config()

        assert get_config().get("secret_masking.run_output") is True
        assert client.get(_ENDPOINT).json()["run_output"] is True

    def test_put_without_a_flag_writes_nothing(
        self, client: TestClient, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config({"secret_masking": {"test_variables": True}})
        before = config_file.read_bytes()
        modified = config_file.stat().st_mtime_ns

        response = client.put(_ENDPOINT, json={})

        assert response.status_code == 200
        assert response.json()["test_variables"] is True
        assert config_file.read_bytes() == before
        assert config_file.stat().st_mtime_ns == modified

    def test_read_only_config_file_refuses_the_save_and_get_is_unchanged(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        before = read_only_config.read_bytes()

        response = client.put(_ENDPOINT, json={"run_output": True})

        assert response.status_code == 500
        error = response.json()["error"]
        assert error["code"] == "INTERNAL_ERROR"
        assert error["message"] == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert read_only_config.read_bytes() == before
        assert _flags(client.get(_ENDPOINT).json()) == dict.fromkeys(_FLAGS, False)
        assert masking_settings.is_run_output_revealed() is False
