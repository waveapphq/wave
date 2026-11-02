"""The WAVE server's log level: the one it starts with and the one Settings saves (REQ-4.7.18)."""

import os
from typing import Final

from wavecore.api.config import ConfigValidationError, get_config, instance_settings
from wavecore.core.logging import formatter

ENV_VAR: Final[str] = "WAVE_LOG_LEVEL"


def _configured_level() -> str:
    """The running config's level by its canonical name."""
    return formatter.canonical_level(get_config().logging.level)


def startup_level() -> str:
    """The level WAVE starts with: the environment's when set, else the config file's."""
    named = os.environ.get(ENV_VAR)
    if not named:
        return _configured_level()
    try:
        return formatter.canonical_level(named)
    except ValueError as error:
        allowed = ", ".join(instance_settings.LOG_LEVELS)
        raise ConfigValidationError(f"{ENV_VAR} must be one of {allowed}: {named}") from error


def apply_startup_level() -> None:
    """Put the startup level in force."""
    formatter.set_log_level(startup_level())


def save(level: str) -> str:
    """Write a changed level to the config file, then put it in force."""
    canonical = formatter.canonical_level(level)
    if canonical != _configured_level():
        get_config().save({"logging.level": canonical})
    return formatter.set_log_level(canonical)
