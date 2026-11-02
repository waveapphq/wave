"""Startup encryption-key gate contract (REQ-4.5.1).

`verify_encryption_key` proves the configured key against a dedicated sealed
sentinel that WAVE mints with its own key - never by sampling user data, which
may legitimately hold foreign-instance envelopes imported with a warning. When
the sentinel exists it must decrypt (else the key is misconfigured and startup
refuses); when it is absent WAVE mints it and boots. Foreign user data never
influences the gate.
"""

from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.secrets.conftest import TEST_KEY_BYTES
from wavecore.api.services import storage_paths
from wavecore.api.services.secret_seal_sweep import (
    EncryptionKeyMismatchError,
    _sentinel_file,
    verify_encryption_key,
)
from wavecore.core.secrets.cipher import SecretCipher, is_secret_envelope

# A valid 32-byte key that is NOT the suite's configured (tests) key.
OTHER_KEY_BYTES = bytes(range(100, 132))

KEY_MISMATCH_ERROR = (
    r"^WAVE cannot start: the configured encryption key does not decrypt " r"existing sealed data\."
)


def _write_yaml(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)


def _system_doc(envelope: str) -> dict[str, Any]:
    return {"variables": {"api_token": {"type": "string", "value": envelope, "secret": True}}}


def _mint_sentinel(key: bytes) -> None:
    """Write a sentinel sealed with an arbitrary key (mimics a prior boot)."""
    from wavecore.api.services.secret_seal_sweep import _SENTINEL_PLAINTEXT

    _write_yaml(_sentinel_file(), {"sentinel": SecretCipher(key).seal(_SENTINEL_PLAINTEXT)})


class TestKeyGateSentinelMismatch:
    def test_wrong_key_aborts_with_actionable_message(self, temp_storage_path: Path) -> None:
        _mint_sentinel(OTHER_KEY_BYTES)  # sentinel sealed by a different key

        with pytest.raises(EncryptionKeyMismatchError, match=KEY_MISMATCH_ERROR):
            verify_encryption_key()


class TestKeyGateSentinelMatch:
    def test_matching_sentinel_passes(self, temp_storage_path: Path) -> None:
        _mint_sentinel(TEST_KEY_BYTES)

        verify_encryption_key()  # must not raise


class TestKeyGateBootstrap:
    def test_absent_sentinel_is_minted_and_passes(self, temp_storage_path: Path) -> None:
        assert not _sentinel_file().exists()

        verify_encryption_key()  # must not raise

        # The sentinel now exists, sealed with the current key.
        assert _sentinel_file().exists()
        doc = yaml.safe_load(_sentinel_file().read_text())
        assert is_secret_envelope(doc["sentinel"])
        verify_encryption_key()  # a second boot verifies against the minted sentinel

    def test_fresh_install_with_no_data_passes(self, temp_storage_path: Path) -> None:
        verify_encryption_key()  # must not raise
        assert _sentinel_file().exists()


class TestKeyGateIgnoresUserData:
    """The gate must never consult user data: a foreign-instance envelope
    imported with a warning must not brick startup."""

    def test_foreign_user_envelope_does_not_abort(self, temp_storage_path: Path) -> None:
        # A native sentinel plus a foreign envelope legitimately present in the store.
        _mint_sentinel(TEST_KEY_BYTES)
        foreign = SecretCipher(OTHER_KEY_BYTES).seal("imported-from-elsewhere")
        _write_yaml(temp_storage_path / "system_variables.yaml", _system_doc(foreign))

        verify_encryption_key()  # must not raise despite the foreign user envelope

    def test_foreign_user_envelope_with_absent_sentinel_bootstraps(
        self, temp_storage_path: Path
    ) -> None:
        foreign = SecretCipher(OTHER_KEY_BYTES).seal("imported-from-elsewhere")
        _write_yaml(temp_storage_path / "system_variables.yaml", _system_doc(foreign))

        verify_encryption_key()  # mints a sentinel, never samples the foreign envelope
        assert _sentinel_file().exists()


class TestKeyGateResilience:
    def test_unreadable_sentinel_is_reminted(self, temp_storage_path: Path) -> None:
        _sentinel_file().parent.mkdir(parents=True, exist_ok=True)
        _sentinel_file().write_text("key: [unclosed\n")

        verify_encryption_key()  # must not raise: a corrupt sentinel is re-minted

        doc = yaml.safe_load(_sentinel_file().read_text())
        assert is_secret_envelope(doc["sentinel"])

    def test_storage_relocation_uses_the_current_base(self, temp_storage_path: Path) -> None:
        # The sentinel lives under the active storage base.
        assert _sentinel_file().parent == storage_paths.get_base_path()
