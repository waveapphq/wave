"""AES-256-GCM secret sealing behind the self-describing envelope (REQ-4.5.1)."""

import base64
import json
import os
from typing import Any, TypeGuard

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_PREFIX = "wave:enc:v1:"

_KEY_LENGTH = 32
_NONCE_LENGTH = 12

_DECRYPTION_FAILED_MESSAGE = (
    "Secret decryption failed: ciphertext is corrupt or the encryption key is invalid"
)


class SecretDecryptionError(Exception):
    """Raised when a secret envelope cannot be authenticated and decrypted."""


def is_secret_envelope(value: Any) -> TypeGuard[str]:
    """True iff the value is a sealed secret envelope string."""
    return isinstance(value, str) and value.startswith(ENVELOPE_PREFIX)


class SecretCipher:
    """Seals JSON-serializable values into authenticated envelopes and back."""

    def __init__(self, key: bytes) -> None:
        if len(key) != _KEY_LENGTH:
            raise ValueError("Encryption key must be 32 bytes for AES-256-GCM")
        self._aesgcm = AESGCM(key)

    def seal(self, value: Any) -> str:
        """Seal a value into an envelope; an envelope input is returned unchanged."""
        if is_secret_envelope(value):
            return value
        nonce = os.urandom(_NONCE_LENGTH)
        ciphertext = self._aesgcm.encrypt(nonce, json.dumps(value).encode(), None)
        return ENVELOPE_PREFIX + base64.b64encode(nonce + ciphertext).decode()

    def unseal(self, value: Any) -> Any:
        """Decrypt an envelope back to its original value; non-envelopes pass through."""
        if not is_secret_envelope(value):
            return value
        try:
            payload = base64.b64decode(value.removeprefix(ENVELOPE_PREFIX), validate=True)
            plaintext = self._aesgcm.decrypt(payload[:_NONCE_LENGTH], payload[_NONCE_LENGTH:], None)
        except (ValueError, InvalidTag) as e:
            raise SecretDecryptionError(_DECRYPTION_FAILED_MESSAGE) from e
        return json.loads(plaintext)
