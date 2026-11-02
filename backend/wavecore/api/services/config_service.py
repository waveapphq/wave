"""Configuration service for WAVE backend (REQ-5.2.4.12).

This module provides business logic for configuration operations including:
- Full configuration retrieval with sensitive value masking
- Individual key retrieval with dot-notation path parsing
- Cache management for configuration tree
- Similar key suggestions for not found keys
"""

import re
from difflib import SequenceMatcher
from typing import Any

from wavecore.api.exceptions import ValidationException
from wavecore.core.secrets.masking import structural_mask

# Configuration cache
_config_cache: dict[str, Any] | None = None

# Configuration schema defining types and mutability
_config_schema: dict[str, dict[str, Any]] = {
    "server.host": {"type": "string", "mutable": False},
    "server.port": {"type": "integer", "mutable": False},
    "server.debug": {"type": "boolean", "mutable": True},
    "storage.artifact_dir": {"type": "string", "mutable": False},
    "storage.retention_days": {"type": "integer", "mutable": True},
    "storage.artifacts.retention_days": {"type": "integer", "mutable": True},
    "execution.max_parallel": {"type": "integer", "mutable": True},
    "execution.timeout_seconds": {"type": "integer", "mutable": True},
    "logging.level": {"type": "string", "mutable": True},
    "webhooks.callback_url": {"type": "string", "mutable": True},
    "database.host": {"type": "string", "mutable": False},
    "database.password": {"type": "string", "mutable": False, "sensitive": True},
    "api.secret_key": {"type": "string", "mutable": False, "sensitive": True},
    "auth.token": {"type": "string", "mutable": False, "sensitive": True},
    "test.key": {"type": "string", "mutable": True},
}

# List of sensitive key patterns
_sensitive_key_patterns = ["password", "secret", "token", "credential", "key"]


def _load_config_tree() -> dict[str, Any]:
    """Load configuration from source.

    Returns:
        Configuration tree dictionary.
    """
    # Default configuration tree
    return {
        "server": {
            "host": "0.0.0.0",
            "port": 8000,
            "debug": False,
        },
        "storage": {
            "artifact_dir": "/var/wave/artifacts",
            "retention_days": 30,
            "artifacts": {
                "retention_days": 30,
            },
        },
        "execution": {
            "max_parallel": 10,
            "timeout_seconds": 3600,
        },
        "logging": {
            "level": "info",
        },
        "webhooks": {
            "callback_url": "https://example.com/webhook",
        },
        "database": {
            "host": "localhost",
            "password": "",
        },
        "api": {
            "secret_key": "",
        },
        "auth": {
            "token": "",
        },
        "test": {
            "key": "value",
        },
    }


def _is_sensitive_key(key: str) -> bool:
    """Check if a key is sensitive.

    Args:
        key: Configuration key path.

    Returns:
        True if key is sensitive, False otherwise.
    """
    # Check schema
    schema = _config_schema.get(key)
    if schema and schema.get("sensitive", False):
        return True

    # Check patterns
    key_lower = key.lower()
    return any(pattern in key_lower for pattern in _sensitive_key_patterns)


def _mask_sensitive_values(config: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Recursively mask sensitive values in configuration.

    Args:
        config: Configuration dictionary.
        prefix: Current key prefix for nested paths.

    Returns:
        Configuration with sensitive values masked.
    """
    masked: dict[str, Any] = {}
    for key, value in config.items():
        full_key = f"{prefix}.{key}" if prefix else key

        if isinstance(value, dict):
            masked[key] = _mask_sensitive_values(value, full_key)
        elif _is_sensitive_key(full_key):
            masked[key] = structural_mask(value)
        else:
            masked[key] = value

    return masked


def _get_cached_config() -> dict[str, Any] | None:
    """Get cached configuration tree.

    Returns:
        Cached configuration or None if not cached.
    """
    return _config_cache


def _set_config_cache(config: dict[str, Any]) -> None:
    """Set configuration cache.

    Args:
        config: Configuration to cache.
    """
    global _config_cache
    _config_cache = config


def _clear_config_cache() -> None:
    """Clear configuration cache."""
    global _config_cache
    _config_cache = None


def _get_value_by_path(key: str) -> Any:
    """Get configuration value by dot-notation path.

    Args:
        key: Configuration key in dot notation.

    Returns:
        Configuration value or None if not found.
    """
    config = _get_cached_config()
    if config is None:
        config = _load_config_tree()
        _set_config_cache(config)

    parts = key.split(".")
    current: Any = config

    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return None

    return current


def _get_config_schema(key: str) -> dict[str, Any] | None:
    """Get schema for configuration key.

    Args:
        key: Configuration key path.

    Returns:
        Schema dictionary or None if not found.
    """
    return _config_schema.get(key)


def _get_all_config_keys() -> list[str]:
    """Get all available configuration keys.

    Returns:
        List of all configuration key paths.
    """
    return list(_config_schema.keys())


def _validate_key_path(key: str) -> None:
    """Validate configuration key path format.

    Args:
        key: Configuration key path.

    Raises:
        ValueError: If key path is invalid.
    """
    if not key:
        raise ValidationException("Invalid key path format: key cannot be empty")

    if key.startswith("."):
        raise ValidationException("Invalid key path format: key cannot start with '.'")

    if ".." in key:
        raise ValidationException("Invalid key path format: empty segment in path")

    if not re.match(r"^[a-zA-Z][a-zA-Z0-9_.]*$", key):
        raise ValidationException("Invalid key path format: invalid characters in key")


def _get_type_name(value: Any) -> str:
    """Get type name for a value.

    Args:
        value: Value to get type for.

    Returns:
        Type name string.
    """
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "string"
    return type(value).__name__


def get_full_config() -> dict[str, Any]:
    """Get full configuration tree with sensitive values masked.

    The function uses internal caching to avoid repeated parsing.
    On first call, it loads the configuration tree and caches it.
    Subsequent calls return the cached tree until invalidation.

    Returns:
        Configuration dictionary with sensitive values masked.
    """
    cached = _get_cached_config()
    if cached is not None:
        return _mask_sensitive_values(cached)

    config = _load_config_tree()
    # Set cache for future calls
    _set_config_cache(config)
    return _mask_sensitive_values(config)


def get_config_value(key: str) -> dict[str, Any] | None:
    """Get configuration value by key with metadata.

    Args:
        key: Configuration key in dot notation.

    Returns:
        Dictionary with key, value, type, and mutable flag, or None if not found.

    Raises:
        ValueError: If key path format is invalid.
    """
    _validate_key_path(key)

    value = _get_value_by_path(key)
    if value is None:
        return None

    schema = _get_config_schema(key) or {"type": "string", "mutable": True}
    is_sensitive = _is_sensitive_key(key)

    result: dict[str, Any] = {
        "key": key,
        "value": structural_mask(value) if is_sensitive else value,
        "type": schema.get("type", _get_type_name(value)),
        "mutable": schema.get("mutable", True),
    }

    if is_sensitive:
        result["sensitive"] = True

    return result


def find_similar_keys(key: str, max_suggestions: int = 5) -> list[str]:
    """Find configuration keys similar to the given key.

    Uses fuzzy matching to suggest similar keys for typo correction.

    Args:
        key: Key to find similar matches for.
        max_suggestions: Maximum number of suggestions to return.

    Returns:
        List of similar key names.
    """
    all_keys = _get_all_config_keys()

    # Calculate similarity scores
    scores = []
    for candidate in all_keys:
        ratio = SequenceMatcher(None, key.lower(), candidate.lower()).ratio()
        if ratio > 0.4:  # Minimum threshold
            scores.append((candidate, ratio))

    # Sort by similarity score descending
    scores.sort(key=lambda x: x[1], reverse=True)

    # Return top suggestions
    return [candidate for candidate, _ in scores[:max_suggestions]]


def invalidate_config_cache() -> None:
    """Invalidate configuration cache."""
    _clear_config_cache()
