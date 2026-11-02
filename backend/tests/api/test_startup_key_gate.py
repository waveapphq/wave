"""With a missing or wrong encryption key, app startup logs the error and exits with code 1."""

import logging
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore.api import app as app_module
from wavecore.api.app import app
from wavecore.core.secrets import key_provider
from wavecore.core.secrets.cipher import SecretCipher
from wavecore.core.secrets.key_provider import get_key_provider

OTHER_KEY_BYTES = bytes(range(100, 132))


def _seed_system_secret(base: Path, cipher: SecretCipher) -> None:
    path = base / "system_variables.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    doc: dict[str, Any] = {
        "variables": {
            "api_token": {"type": "string", "value": cipher.seal("planted"), "secret": True}
        }
    }
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(doc, f, default_flow_style=False, sort_keys=False)


def _seed_sentinel(cipher: SecretCipher) -> None:
    from wavecore.api.services.secret_seal_sweep import _SENTINEL_PLAINTEXT, _sentinel_file

    path = _sentinel_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump({"sentinel": cipher.seal(_SENTINEL_PLAINTEXT)}, f, default_flow_style=False)


class TestStartupKeyCheck:
    def test_mismatch_logs_actionable_error_and_exits(
        self, temp_storage_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        # A sentinel sealed by a different key is the mismatch signal; foreign
        # user data alone never aborts startup.
        _seed_sentinel(SecretCipher(OTHER_KEY_BYTES))

        with patch.object(app_module.os, "_exit") as mock_exit, caplog.at_level(logging.ERROR):
            app_module._check_encryption_key()

        mock_exit.assert_called_once_with(1)
        assert "does not decrypt existing sealed data" in caplog.text

    def test_foreign_user_data_alone_does_not_exit(self, temp_storage_path: Path) -> None:
        # A foreign envelope in user data (imported with a warning) must not brick
        # startup - only the sentinel gates the key.
        _seed_system_secret(temp_storage_path, SecretCipher(OTHER_KEY_BYTES))

        with patch.object(app_module.os, "_exit") as mock_exit:
            app_module._check_encryption_key()

        mock_exit.assert_not_called()

    @pytest.mark.parametrize(
        "message",
        [key_provider._MISSING_KEY_MESSAGE, key_provider._INVALID_KEY_MESSAGE],
    )
    def test_key_config_error_logs_and_exits(
        self, message: str, caplog: pytest.LogCaptureFixture
    ) -> None:
        with (
            patch.object(
                key_provider.ConfiguredKeyProvider, "get_key", side_effect=ValueError(message)
            ),
            patch.object(app_module.os, "_exit") as mock_exit,
            caplog.at_level(logging.ERROR),
        ):
            app_module._check_encryption_key()

        mock_exit.assert_called_once_with(1)
        assert message in caplog.text

    def test_valid_matching_key_does_not_exit(self, temp_storage_path: Path) -> None:
        _seed_system_secret(temp_storage_path, SecretCipher(get_key_provider().get_key()))

        with patch.object(app_module.os, "_exit") as mock_exit:
            app_module._check_encryption_key()

        mock_exit.assert_not_called()

    def test_startup_proceeds_with_matching_sealed_data(self, temp_storage_path: Path) -> None:
        # os._exit is mocked so a regressed gate cannot kill the test process.
        _seed_system_secret(temp_storage_path, SecretCipher(get_key_provider().get_key()))

        with patch.object(app_module.os, "_exit") as mock_exit:
            with TestClient(app) as client:
                assert client.app is app

        mock_exit.assert_not_called()

    def test_startup_invokes_the_key_check(self) -> None:
        with patch.object(app_module, "_check_encryption_key") as mock_check:
            with TestClient(app):
                pass

        mock_check.assert_called_once()
