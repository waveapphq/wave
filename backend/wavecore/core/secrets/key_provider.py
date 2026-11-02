"""Provisioned encryption-key resolution behind the provider seam (REQ-4.5.1)."""

import base64
import secrets
from abc import ABC, abstractmethod

from wavecore.api.config import Config, get_config
from wavecore.core.secrets.cipher import SecretCipher

_KEY_LENGTH = 32

_MISSING_KEY_MESSAGE = (
    "No secret encryption key configured: make one with "
    "'poetry run wave-new-secret-key' in the backend folder, then set it as "
    "security.secret_key in the config file or as the WAVE_SECRET_KEY "
    "environment variable"
)
_INVALID_KEY_MESSAGE = (
    "Secret encryption key must be a base64-encoded 32-byte value. "
    "Check WAVE_SECRET_KEY / security.secret_key."
)


class KeyProvider(ABC):
    """Source of the secret encryption key."""

    @abstractmethod
    def get_key(self) -> bytes:
        """Return the 32-byte encryption key."""


class ConfiguredKeyProvider(KeyProvider):
    """Resolves the key from `security.secret_key`; never generates one."""

    def __init__(self, config: Config | None = None) -> None:
        self._config = config

    def get_key(self) -> bytes:
        config = self._config if self._config is not None else get_config()
        raw = config.get("security.secret_key", "")
        if not raw:
            raise ValueError(_MISSING_KEY_MESSAGE)
        try:
            key = base64.b64decode(raw, validate=True)
        except ValueError as e:
            raise ValueError(_INVALID_KEY_MESSAGE) from e
        if len(key) != _KEY_LENGTH:
            raise ValueError(_INVALID_KEY_MESSAGE)
        return key


_provider: KeyProvider | None = None


def get_key_provider() -> KeyProvider:
    """Process-wide key provider singleton."""
    global _provider
    if _provider is None:
        _provider = ConfiguredKeyProvider()
    return _provider


def get_cipher() -> SecretCipher:
    """Build a cipher keyed by the configured provider."""
    return SecretCipher(get_key_provider().get_key())


def new_secret_key() -> str:
    """A new random key for a person to set; the server never calls this."""
    return base64.b64encode(secrets.token_bytes(_KEY_LENGTH)).decode("ascii")


def print_new_secret_key() -> None:
    """Print a new key as the only line on stdout (the wave-new-secret-key command)."""
    print(new_secret_key())
