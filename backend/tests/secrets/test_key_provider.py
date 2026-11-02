"""Key provider contract (REQ-4.5.1): the server never makes a key; the key command prints one."""

import base64
import importlib
import os
import re
import tempfile
import tomllib
from collections.abc import Callable
from typing import Any
from unittest.mock import patch

import pytest
import yaml

from tests.conftest import EXAMPLE_CONFIG_FILE
from tests.secrets.conftest import TEST_KEY_B64, TEST_KEY_BYTES
from wavecore.api.config import Config
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.key_provider import (
    ConfiguredKeyProvider,
    KeyProvider,
    get_cipher,
    get_key_provider,
    new_secret_key,
    print_new_secret_key,
)

YAML_KEY_BYTES = bytes(range(100, 132))
YAML_KEY_B64 = base64.b64encode(YAML_KEY_BYTES).decode()

PYPROJECT_FILE = EXAMPLE_CONFIG_FILE.parents[1] / "pyproject.toml"
KEY_COMMAND = "wave-new-secret-key"
KEY_COMMAND_TARGET = "wavecore.core.secrets.key_provider:print_new_secret_key"

MISSING_KEY_ERROR = (
    r"^No secret encryption key configured: make one with "
    r"'poetry run wave-new-secret-key' in the backend folder, then set it as "
    r"security\.secret_key in the config file or as the WAVE_SECRET_KEY "
    r"environment variable$"
)
INVALID_KEY_ERROR = (
    r"^Secret encryption key must be a base64-encoded 32-byte value\. "
    r"Check WAVE_SECRET_KEY / security\.secret_key\.$"
)


def _config_with_security(security: dict[str, Any]) -> Config:
    """Build a Config whose yaml layer carries the given security section."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
        yaml.dump({"security": security}, f)
        config_file = f.name
    try:
        return Config(config_file=config_file)
    finally:
        os.unlink(config_file)


class TestConfiguredKeyProvider:
    def test_key_resolves_from_config_yaml(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY", raising=False)
        config = _config_with_security({"secret_key": YAML_KEY_B64})

        assert ConfiguredKeyProvider(config).get_key() == YAML_KEY_BYTES

    def test_env_var_overrides_yaml_key(self) -> None:
        # WAVE_SECRET_KEY is set to TEST_KEY_B64 by the autouse fixture
        config = _config_with_security({"secret_key": YAML_KEY_B64})

        assert ConfiguredKeyProvider(config).get_key() == TEST_KEY_BYTES

    def test_missing_key_raises_with_exact_message(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY", raising=False)
        config = Config()

        with pytest.raises(ValueError, match=MISSING_KEY_ERROR):
            ConfiguredKeyProvider(config).get_key()

    def test_empty_key_raises_missing_key_message(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY", raising=False)
        config = _config_with_security({"secret_key": ""})

        with pytest.raises(ValueError, match=MISSING_KEY_ERROR):
            ConfiguredKeyProvider(config).get_key()

    def test_non_base64_key_raises_with_exact_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY", raising=False)
        config = _config_with_security({"secret_key": "not-valid-base64!!!"})

        with pytest.raises(ValueError, match=INVALID_KEY_ERROR):
            ConfiguredKeyProvider(config).get_key()

    def test_wrong_length_key_raises_with_exact_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY", raising=False)
        short_key = base64.b64encode(b"sixteen-byte-key").decode()
        config = _config_with_security({"secret_key": short_key})

        with pytest.raises(ValueError, match=INVALID_KEY_ERROR):
            ConfiguredKeyProvider(config).get_key()

    def test_default_provider_reads_the_global_config(self) -> None:
        # Autouse fixture: WAVE_SECRET_KEY set, loader singleton reset
        assert ConfiguredKeyProvider().get_key() == TEST_KEY_BYTES


class TestProviderSingleton:
    def test_get_key_provider_returns_the_same_instance(self) -> None:
        assert get_key_provider() is get_key_provider()

    def test_provider_is_a_configured_key_provider(self) -> None:
        provider = get_key_provider()

        assert isinstance(provider, ConfiguredKeyProvider)
        assert isinstance(provider, KeyProvider)


class TestGetCipher:
    def test_cipher_seals_and_unseals_through_the_provider_key(self) -> None:
        cipher = get_cipher()

        envelope = cipher.seal({"password": "hunter2-classified"})

        assert is_secret_envelope(envelope)
        assert cipher.unseal(envelope) == {"password": "hunter2-classified"}

    def test_cipher_key_comes_from_the_configured_provider(self) -> None:
        from wavecore.core.secrets.cipher import SecretCipher

        envelope = get_cipher().seal("cross-check-value")

        assert SecretCipher(TEST_KEY_BYTES).unseal(envelope) == "cross-check-value"


class TestExampleConfigShipsNoKey:
    def test_example_config_ships_an_empty_secret_key(self) -> None:
        data = yaml.safe_load(EXAMPLE_CONFIG_FILE.read_text(encoding="utf-8"))

        assert data["security"]["secret_key"] == ""

    def test_example_key_comment_names_the_command(self) -> None:
        lines = EXAMPLE_CONFIG_FILE.read_text(encoding="utf-8").splitlines()
        key_line = lines.index('  secret_key: ""')

        assert lines[key_line - 3 : key_line] == [
            "  # Secret encryption key (base64, 32 bytes). WAVE does not start without one.",
            '  # Make your own: run "poetry run wave-new-secret-key" in the backend folder.',
            "  # Share it only with people who should read the same secrets.",
        ]

    def test_a_fresh_copy_of_the_example_refuses_with_the_command(
        self, monkeypatch: pytest.MonkeyPatch, load_config: Callable[..., Any]
    ) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY", raising=False)
        config = load_config(EXAMPLE_CONFIG_FILE.read_text(encoding="utf-8"))

        with pytest.raises(ValueError, match=MISSING_KEY_ERROR):
            ConfiguredKeyProvider(config).get_key()


class TestNewSecretKey:
    def test_new_key_is_standard_base64_of_32_bytes(self) -> None:
        key = new_secret_key()

        assert re.fullmatch(r"[A-Za-z0-9+/]{43}=", key)
        assert len(base64.b64decode(key, validate=True)) == 32

    def test_new_key_is_accepted_by_the_provider(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY", raising=False)
        key = new_secret_key()
        config = _config_with_security({"secret_key": key})

        assert ConfiguredKeyProvider(config).get_key() == base64.b64decode(key)

    def test_two_calls_make_different_keys(self) -> None:
        assert new_secret_key() != new_secret_key()

    def test_new_key_is_32_bytes_from_the_secrets_module_in_standard_base64(self) -> None:
        # These bytes encode to '+' and '/', the two characters a URL-safe encoder changes.
        stub_bytes = bytes([0xFB, 0xEF, 0xBE, 0xFF, 0xFF, 0xFF] * 5 + [0xFB, 0xEF])
        with patch(
            "wavecore.core.secrets.key_provider.secrets.token_bytes", return_value=stub_bytes
        ) as token_bytes:
            key = new_secret_key()

        token_bytes.assert_called_once_with(32)
        assert key == "++++////++++////++++////++++////++++////++8="


class TestPrintNewSecretKey:
    def test_prints_one_line_holding_a_valid_key(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY", raising=False)

        print_new_secret_key()

        captured = capsys.readouterr()
        assert captured.err == ""
        assert captured.out.endswith("\n")
        lines = captured.out.splitlines()
        assert len(lines) == 1
        config = _config_with_security({"secret_key": lines[0]})
        assert len(ConfiguredKeyProvider(config).get_key()) == 32

    def test_prints_exactly_the_key_new_secret_key_makes(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with patch("wavecore.core.secrets.key_provider.new_secret_key", return_value="marker-key"):
            print_new_secret_key()

        assert capsys.readouterr().out == "marker-key\n"


class TestKeyCommandDeclared:
    def _scripts(self) -> dict[str, str]:
        with PYPROJECT_FILE.open("rb") as f:
            scripts: dict[str, str] = tomllib.load(f)["tool"]["poetry"]["scripts"]
        return scripts

    def test_pyproject_declares_the_key_command(self) -> None:
        assert self._scripts()[KEY_COMMAND] == KEY_COMMAND_TARGET

    def test_the_declared_target_is_print_new_secret_key(self) -> None:
        module_name, attribute = self._scripts()[KEY_COMMAND].split(":")

        assert getattr(importlib.import_module(module_name), attribute) is print_new_secret_key


class TestConfigApiMasksSecretKey:
    """Locking assertions: the config API never serves the key in clear."""

    def test_secret_key_path_is_classified_sensitive(self) -> None:
        from wavecore.api.services.config_service import _is_sensitive_key

        assert _is_sensitive_key("security.secret_key") is True

    def test_full_config_read_masks_a_secret_key_entry(self) -> None:
        from wavecore.api.services.config_service import get_full_config

        with patch("wavecore.api.services.config_service._load_config_tree") as mock_load:
            mock_load.return_value = {
                "security": {"secret_key": TEST_KEY_B64, "cors_origins": []},
            }

            result = get_full_config()

        assert result["security"]["secret_key"] == "********"
        assert result["security"]["cors_origins"] == []
