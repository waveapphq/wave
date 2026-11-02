"""SecretCipher and envelope contract (REQ-4.5.1).

AES-256-GCM authenticated sealing behind the self-describing
`wave:enc:v1:` envelope: type-preserving round-trips, idempotent seal,
pass-through unseal, and fail-fast on tampered or wrong-key ciphertext.
"""

import base64
from typing import Any

import pytest

from wavecore.core.secrets.cipher import (
    SecretCipher,
    SecretDecryptionError,
    is_secret_envelope,
)

ENVELOPE_PREFIX = "wave:enc:v1:"

KEY_A = bytes(range(32))
KEY_B = bytes(range(1, 33))

DECRYPTION_ERROR = (
    "^Secret decryption failed: ciphertext is corrupt or the encryption key is invalid$"
)


class TestEnvelopeFormat:
    def test_seal_returns_string_with_versioned_prefix(self) -> None:
        cipher = SecretCipher(KEY_A)

        envelope = cipher.seal("hunter2-classified")

        assert isinstance(envelope, str)
        assert envelope.startswith(ENVELOPE_PREFIX)

    def test_envelope_payload_is_base64_of_nonce_and_ciphertext(self) -> None:
        cipher = SecretCipher(KEY_A)

        envelope = cipher.seal("hunter2-classified")
        payload = base64.b64decode(envelope.removeprefix(ENVELOPE_PREFIX))

        # 12-byte nonce + at least a 16-byte GCM tag
        assert len(payload) >= 28

    def test_sealing_same_value_twice_produces_distinct_envelopes(self) -> None:
        cipher = SecretCipher(KEY_A)

        first = cipher.seal("hunter2-classified")
        second = cipher.seal("hunter2-classified")

        assert first != second
        assert cipher.unseal(first) == cipher.unseal(second) == "hunter2-classified"

    def test_is_secret_envelope_true_for_sealed_value(self) -> None:
        cipher = SecretCipher(KEY_A)

        assert is_secret_envelope(cipher.seal("hunter2-classified")) is True

    @pytest.mark.parametrize(
        "value",
        [
            "plaintext-value",
            "wave:enc:v2:AAAA",
            "WAVE:ENC:V1:AAAA",
            "",
            42,
            3.5,
            True,
            None,
            ["wave:enc:v1:AAAA"],
            {"value": "wave:enc:v1:AAAA"},
            b"wave:enc:v1:AAAA",
        ],
    )
    def test_is_secret_envelope_false_for_non_envelopes(self, value: Any) -> None:
        assert is_secret_envelope(value) is False


class TestSealRoundTrip:
    @pytest.mark.parametrize(
        "value",
        [
            "hunter2-classified",
            "",
            "unicode-üß-☃",
            0,
            42,
            -7,
            3.5,
            True,
            False,
            None,
            ["alpha", 1, False],
            {"user": "svc-account", "pass": "p4ss-value"},
            {"headers": ["col_a", "col_b"], "rows": [["x", "y"], ["z", "w"]]},
        ],
    )
    def test_round_trip_preserves_value_and_type(self, value: Any) -> None:
        cipher = SecretCipher(KEY_A)

        unsealed = cipher.unseal(cipher.seal(value))

        assert unsealed == value
        assert type(unsealed) is type(value)


class TestSealIdempotence:
    def test_sealing_an_envelope_returns_it_unchanged(self) -> None:
        cipher = SecretCipher(KEY_A)
        envelope = cipher.seal("hunter2-classified")

        assert cipher.seal(envelope) == envelope

    def test_double_seal_still_unseals_to_original(self) -> None:
        cipher = SecretCipher(KEY_A)

        envelope = cipher.seal(cipher.seal({"token": "abc-123-def"}))

        assert cipher.unseal(envelope) == {"token": "abc-123-def"}


class TestUnsealPassthrough:
    @pytest.mark.parametrize(
        "value",
        [
            "plaintext-value",
            "",
            42,
            3.5,
            True,
            False,
            None,
            ["alpha", 1],
            {"user": "svc-account"},
        ],
    )
    def test_non_envelope_passes_through_unchanged(self, value: Any) -> None:
        cipher = SecretCipher(KEY_A)

        assert cipher.unseal(value) == value


class TestUnsealFailures:
    def _flip_payload_byte(self, envelope: str, index: int) -> str:
        payload = bytearray(base64.b64decode(envelope.removeprefix(ENVELOPE_PREFIX)))
        payload[index] ^= 0xFF
        return ENVELOPE_PREFIX + base64.b64encode(bytes(payload)).decode()

    def test_tampered_tag_raises_decryption_error(self) -> None:
        cipher = SecretCipher(KEY_A)
        envelope = cipher.seal("hunter2-classified")

        tampered = self._flip_payload_byte(envelope, -1)

        with pytest.raises(SecretDecryptionError, match=DECRYPTION_ERROR):
            cipher.unseal(tampered)

    def test_tampered_ciphertext_raises_decryption_error(self) -> None:
        cipher = SecretCipher(KEY_A)
        envelope = cipher.seal("hunter2-classified")

        tampered = self._flip_payload_byte(envelope, 14)

        with pytest.raises(SecretDecryptionError, match=DECRYPTION_ERROR):
            cipher.unseal(tampered)

    def test_wrong_key_raises_decryption_error(self) -> None:
        envelope = SecretCipher(KEY_A).seal("hunter2-classified")

        with pytest.raises(SecretDecryptionError, match=DECRYPTION_ERROR):
            SecretCipher(KEY_B).unseal(envelope)

    def test_invalid_base64_payload_raises_decryption_error(self) -> None:
        cipher = SecretCipher(KEY_A)

        with pytest.raises(SecretDecryptionError, match=DECRYPTION_ERROR):
            cipher.unseal("wave:enc:v1:%%%not-base64%%%")

    def test_truncated_payload_raises_decryption_error(self) -> None:
        cipher = SecretCipher(KEY_A)
        truncated = ENVELOPE_PREFIX + base64.b64encode(b"short").decode()

        with pytest.raises(SecretDecryptionError, match=DECRYPTION_ERROR):
            cipher.unseal(truncated)


class TestKeyValidation:
    @pytest.mark.parametrize("length", [0, 16, 31, 33, 64])
    def test_non_32_byte_key_is_rejected(self, length: int) -> None:
        with pytest.raises(ValueError, match="^Encryption key must be 32 bytes for AES-256-GCM$"):
            SecretCipher(bytes(length))

    def test_32_byte_key_is_accepted(self) -> None:
        cipher = SecretCipher(KEY_A)

        assert cipher.unseal(cipher.seal("ok-value")) == "ok-value"
