"""Secrets subpackage: per-run registry, masking, and at-rest sealing (REQ-3.1.3.5, REQ-4.5.1)."""

from wavecore.core.secrets.cipher import (
    SecretCipher,
    SecretDecryptionError,
    is_secret_envelope,
)
from wavecore.core.secrets.key_provider import (
    ConfiguredKeyProvider,
    KeyProvider,
    get_cipher,
    get_key_provider,
)
from wavecore.core.secrets.masking import (
    MASK_PLACEHOLDER,
    mask_structure,
    mask_text,
    mask_with_metadata,
    structural_mask,
)
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.secrets.sealing import (
    seal_profile,
    seal_value,
    seal_variables,
    seal_workflow_node_secrets,
    unseal_all,
    unseal_workflow_node_secrets,
)

__all__ = [
    "MASK_PLACEHOLDER",
    "ConfiguredKeyProvider",
    "KeyProvider",
    "SecretCipher",
    "SecretDecryptionError",
    "SecretRegistry",
    "get_cipher",
    "get_key_provider",
    "is_secret_envelope",
    "mask_structure",
    "mask_text",
    "mask_with_metadata",
    "seal_profile",
    "seal_value",
    "seal_variables",
    "seal_workflow_node_secrets",
    "structural_mask",
    "unseal_all",
    "unseal_workflow_node_secrets",
]
