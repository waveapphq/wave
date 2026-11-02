"""
WAVE Base Connection Profile Models

Endpoint, pool configs and the generic ConnectionProfile.
"""

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field, ValidationInfo, field_validator


class Endpoint(BaseModel):
    """Endpoint model for connectivity plugins (REQ-3.4.3.4)."""

    protocol: str
    host: str
    port: int = Field(gt=0, le=65535)
    credentials: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    def __hash__(self) -> int:
        """Enable hashing for use as dict key in blacklist."""
        return hash((self.protocol, self.host, self.port))

    def __eq__(self, other: object) -> bool:
        """Enable equality comparison."""
        if not isinstance(other, Endpoint):
            return False
        return (
            self.protocol == other.protocol and self.host == other.host and self.port == other.port
        )


class SQLPoolConfig(BaseModel):
    """SQL-specific connection pool configuration."""

    pool_min_size: int = Field(default=2, ge=0)
    pool_max_size: int = Field(default=10, gt=0)
    idle_timeout: int = Field(default=300, gt=0)
    connection_lifetime: int = Field(default=3600, gt=0)

    @field_validator("pool_max_size")
    @classmethod
    def validate_pool_sizes(cls, v: int, info: ValidationInfo) -> int:
        """Ensure pool_min_size <= pool_max_size."""
        if "pool_min_size" in info.data and v < info.data["pool_min_size"]:
            raise ValueError("pool_max_size must be >= pool_min_size")
        return v


class SSHPoolConfig(BaseModel):
    """SSH-specific connection pool configuration."""

    max_sessions: int = Field(default=5, gt=0)
    session_timeout: int = Field(default=300, gt=0)
    multiplexing_enabled: bool = True


PoolConfig = SQLPoolConfig | SSHPoolConfig


class ConnectionProfile(BaseModel):
    """Connection profile model (REQ-3.4.3.4, REQ-3.4.3.7)."""

    id: str
    name: str
    protocol: str
    endpoints: list[Endpoint]
    blacklist_duration: float = Field(default=60, ge=0)
    pool_config: PoolConfig | None = None
    description: str | None = None
    author: str | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("endpoints")
    @classmethod
    def validate_endpoints_not_empty(cls, v: list[Endpoint]) -> list[Endpoint]:
        """Ensure at least one endpoint is provided."""
        if not v:
            raise ValueError("At least one endpoint is required")
        return v
