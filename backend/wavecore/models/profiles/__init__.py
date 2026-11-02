"""WAVE Connection Profile Models subpackage."""

from wavecore.models.profiles.base import (
    ConnectionProfile,
    Endpoint,
    PoolConfig,
    SQLPoolConfig,
    SSHPoolConfig,
)

__all__ = [
    "ConnectionProfile",
    "Endpoint",
    "PoolConfig",
    "SQLPoolConfig",
    "SSHPoolConfig",
]
