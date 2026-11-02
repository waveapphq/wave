"""Configuration management package for WAVE backend.

Re-exports public symbols from the loader module for convenient access.
Reloading this package resets the config singleton so that a fresh
Config instance is created on the next get_config() call.
"""

# Reset the singleton so that importlib.reload(wavecore.api.config) produces
# a fresh Config instance on the next get_config() call.
from wavecore.api.config import loader as _loader
from wavecore.api.config.loader import (
    Config,
    ConfigKeyError,
    ConfigSection,
    ConfigValidationError,
    IntegrationConfig,
    LoggingConfig,
    SecurityConfig,
    ServerConfig,
    StorageConfig,
    get_config,
    locate_config_file,
    wave_dir,
)

__all__ = [
    "Config",
    "ConfigKeyError",
    "ConfigSection",
    "ConfigValidationError",
    "IntegrationConfig",
    "LoggingConfig",
    "SecurityConfig",
    "ServerConfig",
    "StorageConfig",
    "get_config",
    "locate_config_file",
    "wave_dir",
]

_loader._config_instance = None
