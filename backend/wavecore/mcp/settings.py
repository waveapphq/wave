"""MCP server settings: read, check and save the config file's mcp section (REQ-5.2.7.1)."""

from typing import Any

from wavecore.api.config import get_config
from wavecore.api.config.instance_settings import (
    MCP_BINDS,
    MCP_PORT_MAX,
    MCP_PORT_MIN,
    whole_number,
)
from wavecore.api.exceptions import ValidationException
from wavecore.core.secrets.key_provider import get_cipher
from wavecore.core.secrets.sealing import seal_value

_SECTION = "mcp"


def get_settings() -> dict[str, Any]:
    """The MCP settings in force; ``auth_password`` stays sealed."""
    return get_config().section(_SECTION)


def preview_settings(**subset: Any) -> dict[str, Any]:
    """Merge and validate a partial update without saving it."""
    in_force = get_settings()
    prospective = {**in_force, **{key: subset[key] for key in in_force if key in subset}}
    # An empty password clears the stored one.
    prospective["auth_password"] = prospective["auth_password"] or None
    _validate(prospective)
    return prospective


def update_settings(**subset: Any) -> dict[str, Any]:
    """Validate a partial update and save what differs; returns the settings in force."""
    prospective = preview_settings(**subset)
    # A stored envelope passes through unchanged.
    prospective["auth_password"] = seal_value(prospective["auth_password"])
    get_config().save_changed(_SECTION, prospective)
    return get_settings()


def get_unsealed_password() -> str | None:
    """The stored auth password in plaintext, or None when none is stored."""
    sealed = get_settings()["auth_password"]
    if sealed is None:
        return None
    value = get_cipher().unseal(sealed)
    return str(value)


def _validate(prospective: dict[str, Any]) -> None:
    port = whole_number(prospective["port"], MCP_PORT_MIN, MCP_PORT_MAX)
    if port is None:
        raise ValidationException(
            f"Port must be an integer between {MCP_PORT_MIN} and {MCP_PORT_MAX}"
        )
    prospective["port"] = port
    if prospective["bind"] not in MCP_BINDS:
        scopes = " or ".join(f"'{bind}'" for bind in MCP_BINDS)
        raise ValidationException(f"Bind scope must be {scopes}")
    if prospective["auth_enabled"]:
        if not prospective["auth_username"]:
            raise ValidationException("Username is required when authentication is enabled")
        if not prospective["auth_password"]:
            raise ValidationException("Password is required when authentication is enabled")
