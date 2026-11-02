"""Startup secret-store reconciliation (REQ-4.5.1).

Two boot-time passes over the file store: verify the configured encryption
key decrypts existing sealed data (fail fast on mismatch), then converge any
pre-existing plaintext secret to the sealed invariant (one-time, idempotent).
"""

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.services import storage_paths
from wavecore.core.secrets.cipher import SecretDecryptionError, is_secret_envelope
from wavecore.core.secrets.key_provider import get_cipher
from wavecore.core.secrets.sealing import (
    seal_definition_secrets,
    seal_profile,
    seal_variables,
    seal_workflow_node_secrets,
)

logger = logging.getLogger(__name__)

_Transform = Callable[[Any], Any]

_KEY_MISMATCH_MESSAGE = (
    "WAVE cannot start: the configured encryption key does not decrypt existing "
    "sealed data. The key must match the one used when this instance's data was "
    "first sealed (provisioned at install). Check WAVE_SECRET_KEY / security.secret_key."
)


class EncryptionKeyMismatchError(Exception):
    """Raised at startup when the configured key cannot decrypt existing sealed data."""


def _sealed_variables_carrier(data: dict[str, Any]) -> dict[str, Any]:
    """Seal the top-level variables collection of a system/test/suite/regression doc."""
    result = dict(data)
    variables = result.get("variables")
    if isinstance(variables, dict):
        result["variables"] = seal_variables(variables)
    return result


def _sealed_test_doc(data: dict[str, Any]) -> dict[str, Any]:
    """Seal a Test's variables and every secret its workflow holds, at every depth."""
    from wavecore.api.services.functions.service import secret_input_names

    result = _sealed_variables_carrier(data)
    workflow = result.get("workflow")
    if isinstance(workflow, dict):
        result["workflow"] = seal_workflow_node_secrets(workflow, secret_inputs=secret_input_names)
    return result


def _sealed_function_version(data: dict[str, Any]) -> dict[str, Any]:
    """Seal every secret a library Function version body holds."""
    definition = data.get("definition")
    return (
        {**data, "definition": seal_definition_secrets(definition)}
        if isinstance(definition, dict)
        else data
    )


def _sealed_versions(data: list[Any]) -> list[Any]:
    """Seal the snapshot variables carried by version-history entries."""
    result = []
    for entry in data:
        sealed = entry
        snapshot = entry.get("snapshot") if isinstance(entry, dict) else None
        if isinstance(snapshot, dict) and isinstance(snapshot.get("variables"), dict):
            sealed = {
                **entry,
                "snapshot": {**snapshot, "variables": seal_variables(snapshot["variables"])},
            }
        result.append(sealed)
    return result


def _sealed_profile_doc(data: dict[str, Any]) -> dict[str, Any]:
    """Seal a profile's credential fields in config and environment_values."""
    profile_type = data.get("type", "")
    result = dict(data)
    config = result.get("config")
    if isinstance(config, dict):
        result["config"] = seal_profile(config, profile_type)
    env_values = result.get("environment_values")
    if isinstance(env_values, dict):
        result["environment_values"] = {
            env_id: seal_profile(env_config, profile_type)
            for env_id, env_config in env_values.items()
        }
    return result


def _collect_sweep_targets() -> list[tuple[Path, _Transform]]:
    """Enumerate every stored file that can carry a secret leaf."""
    targets: list[tuple[Path, _Transform]] = []
    system_file = storage_paths.get_system_variables_file_path()
    if system_file.exists():
        targets.append((system_file, _sealed_variables_carrier))
    for base, doc_name, sealed_doc in (
        (storage_paths.get_tests_storage_path(), "test.yaml", _sealed_test_doc),
        (storage_paths.get_suites_storage_path(), "suite.yaml", _sealed_variables_carrier),
        (
            storage_paths.get_regressions_storage_path(),
            "regression.yaml",
            _sealed_variables_carrier,
        ),
    ):
        targets.extend((p, sealed_doc) for p in sorted(base.glob(f"*/{doc_name}")))
        targets.extend((p, _sealed_versions) for p in sorted(base.glob("*/versions.yaml")))
    functions_base = storage_paths.get_functions_storage_path()
    targets.extend(
        (p, _sealed_function_version) for p in sorted(functions_base.glob("*/versions/*.yaml"))
    )
    profiles_base = storage_paths.get_profiles_storage_path()
    targets.extend((p, _sealed_profile_doc) for p in sorted(profiles_base.glob("*/profile.yaml")))
    return targets


_SENTINEL_PLAINTEXT = "wave-secret-key-sentinel-v1"


def _sentinel_file() -> Path:
    """The dedicated key-verification sentinel, under the active storage base."""
    return storage_paths.get_base_path() / "secret_key_sentinel.yaml"


def _mint_sentinel(cipher: Any) -> None:
    """Seal the sentinel constant with the current key and persist it."""
    path = _sentinel_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump({"sentinel": cipher.seal(_SENTINEL_PLAINTEXT)}, f, default_flow_style=False)


def verify_encryption_key() -> None:
    """Abort startup when the configured key does not match this instance's key.

    Verification is against a dedicated sealed sentinel that WAVE mints with its
    own key, never by sampling user data - which may legitimately hold
    foreign-instance envelopes imported with a warning (a foreign envelope must
    not brick startup). When the sentinel exists it must decrypt; when it is
    absent or unreadable WAVE mints it with the current key and boots.
    """
    cipher = get_cipher()
    path = _sentinel_file()
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                doc = yaml.safe_load(f)
            envelope = doc.get("sentinel") if isinstance(doc, dict) else None
        except Exception:  # a corrupt sentinel is WAVE's own artifact; re-mint it
            envelope = None
        if is_secret_envelope(envelope):
            try:
                cipher.unseal(envelope)
            except SecretDecryptionError as exc:
                raise EncryptionKeyMismatchError(_KEY_MISMATCH_MESSAGE) from exc
            return
    _mint_sentinel(cipher)


def _sweep_file(path: Path, transform: _Transform) -> str:
    """Seal one file in place; returns 'sealed', 'clean', or 'skipped'."""
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        sealed = transform(data)
        if sealed == data:
            return "clean"
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(sealed, f, default_flow_style=False, sort_keys=False)
        return "sealed"
    except Exception:  # a bad store file must never abort startup
        logger.warning("Secret seal sweep skipped unreadable file: %s", path)
        return "skipped"


def run_seal_sweep() -> dict[str, int]:
    """Seal every plaintext secret leaf across the file store; idempotent."""
    counts = {"scanned": 0, "sealed": 0, "skipped": 0}
    for path, transform in _collect_sweep_targets():
        counts["scanned"] += 1
        outcome = _sweep_file(path, transform)
        if outcome != "clean":
            counts[outcome] += 1
    if counts["sealed"] or counts["skipped"]:
        logger.info(
            "Secret seal sweep: %d scanned, %d sealed, %d skipped",
            counts["scanned"],
            counts["sealed"],
            counts["skipped"],
        )
    return counts
