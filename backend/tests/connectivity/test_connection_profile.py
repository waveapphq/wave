"""
Tests for Connection Profile Models

Tests REQ-3.4.3.4 and REQ-3.4.3.7:
- REQ-3.4.3.4: Multiple endpoints for connectivity plugins
- REQ-3.4.3.7: Configurable blacklist duration (default 60s)

These tests validate the Pydantic models for connection profiles, endpoints,
and protocol-specific pool configurations.
"""

import pytest
from pydantic import ValidationError

from wavecore.models.profiles.base import (
    ConnectionProfile,
    Endpoint,
    SQLPoolConfig,
    SSHPoolConfig,
)


class TestEndpointModel:
    """Test the Endpoint model for REQ-3.4.3.4."""

    def test_endpoint_creation_minimal(self):
        """Test creating an endpoint with minimal required fields."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        assert endpoint.protocol == "http"
        assert endpoint.host == "api.example.com"
        assert endpoint.port == 443
        assert endpoint.credentials is None
        assert endpoint.metadata == {}

    def test_endpoint_creation_with_credentials(self):
        """Test creating an endpoint with credentials."""
        endpoint = Endpoint(
            protocol="sql",
            host="db.example.com",
            port=5432,
            credentials={"username": "admin", "password": "secret"},
        )
        assert endpoint.credentials == {"username": "admin", "password": "secret"}

    def test_endpoint_creation_with_metadata(self):
        """Test creating an endpoint with custom metadata."""
        endpoint = Endpoint(
            protocol="http",
            host="api.example.com",
            port=443,
            metadata={"region": "us-west-2", "tls_verify": True},
        )
        assert endpoint.metadata == {"region": "us-west-2", "tls_verify": True}

    def test_endpoint_validation_requires_protocol(self):
        """Test that protocol is required."""
        with pytest.raises(ValidationError) as exc_info:
            Endpoint(host="api.example.com", port=443)
        assert "protocol" in str(exc_info.value).lower()

    def test_endpoint_validation_requires_host(self):
        """Test that host is required."""
        with pytest.raises(ValidationError) as exc_info:
            Endpoint(protocol="http", port=443)
        assert "host" in str(exc_info.value).lower()

    def test_endpoint_validation_requires_port(self):
        """Test that port is required."""
        with pytest.raises(ValidationError) as exc_info:
            Endpoint(protocol="http", host="api.example.com")
        assert "port" in str(exc_info.value).lower()

    def test_endpoint_port_validation_positive(self):
        """Test that port must be positive."""
        with pytest.raises(ValidationError) as exc_info:
            Endpoint(protocol="http", host="api.example.com", port=0)
        assert "port" in str(exc_info.value).lower()

    def test_endpoint_port_validation_range(self):
        """Test that port must be within valid range (1-65535)."""
        with pytest.raises(ValidationError) as exc_info:
            Endpoint(protocol="http", host="api.example.com", port=70000)
        assert "port" in str(exc_info.value).lower()

    def test_endpoint_port_boundary_values(self):
        """Test port boundary values."""
        # Port 1 (minimum valid)
        ep1 = Endpoint(protocol="http", host="api.example.com", port=1)
        assert ep1.port == 1

        # Port 65535 (maximum valid)
        ep2 = Endpoint(protocol="http", host="api.example.com", port=65535)
        assert ep2.port == 65535

    def test_endpoint_equality(self):
        """Test endpoint equality comparison for deduplication."""
        ep1 = Endpoint(protocol="http", host="api.example.com", port=443)
        ep2 = Endpoint(protocol="http", host="api.example.com", port=443)
        assert ep1 == ep2

    def test_endpoint_inequality_different_host(self):
        """Test endpoints with different hosts are not equal."""
        ep1 = Endpoint(protocol="http", host="api1.example.com", port=443)
        ep2 = Endpoint(protocol="http", host="api2.example.com", port=443)
        assert ep1 != ep2

    def test_endpoint_inequality_different_port(self):
        """Test endpoints with different ports are not equal."""
        ep1 = Endpoint(protocol="http", host="api.example.com", port=443)
        ep2 = Endpoint(protocol="http", host="api.example.com", port=8443)
        assert ep1 != ep2

    def test_endpoint_hash_for_blacklist_key(self):
        """Test that endpoints can be hashed for use as dict keys in blacklist."""
        ep1 = Endpoint(protocol="http", host="api.example.com", port=443)
        ep2 = Endpoint(protocol="http", host="api.example.com", port=443)
        endpoint_set = {ep1}
        assert ep2 in endpoint_set

    def test_endpoint_hash_different_for_different_endpoints(self):
        """Test that different endpoints have different hashes."""
        ep1 = Endpoint(protocol="http", host="api1.example.com", port=443)
        ep2 = Endpoint(protocol="http", host="api2.example.com", port=443)
        assert hash(ep1) != hash(ep2)

    def test_endpoint_inequality_with_non_endpoint(self):
        """Test that endpoint is not equal to non-Endpoint objects."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        assert endpoint != "not an endpoint"
        assert endpoint != 123
        assert endpoint != None  # noqa: E711 - asserts Endpoint.__ne__ against None
        assert endpoint != {"protocol": "http", "host": "api.example.com", "port": 443}


class TestSQLPoolConfig:
    """Test SQL-specific pool configuration."""

    def test_sql_pool_config_defaults(self):
        """Test SQL pool config with default values."""
        config = SQLPoolConfig()
        assert config.pool_min_size == 2
        assert config.pool_max_size == 10
        assert config.idle_timeout == 300
        assert config.connection_lifetime == 3600

    def test_sql_pool_config_custom_values(self):
        """Test SQL pool config with custom values."""
        config = SQLPoolConfig(
            pool_min_size=5,
            pool_max_size=20,
            idle_timeout=600,
            connection_lifetime=7200,
        )
        assert config.pool_min_size == 5
        assert config.pool_max_size == 20
        assert config.idle_timeout == 600
        assert config.connection_lifetime == 7200

    def test_sql_pool_config_validation_min_less_than_max(self):
        """Test that pool_min_size must be less than or equal to pool_max_size."""
        with pytest.raises(ValidationError) as exc_info:
            SQLPoolConfig(pool_min_size=10, pool_max_size=5)
        error_msg = str(exc_info.value).lower()
        assert "pool_min_size" in error_msg or "pool_max_size" in error_msg

    def test_sql_pool_config_min_equals_max_allowed(self):
        """Test that pool_min_size can equal pool_max_size."""
        config = SQLPoolConfig(pool_min_size=10, pool_max_size=10)
        assert config.pool_min_size == 10
        assert config.pool_max_size == 10

    def test_sql_pool_config_zero_min_size_allowed(self):
        """Test that pool_min_size can be zero."""
        config = SQLPoolConfig(pool_min_size=0, pool_max_size=10)
        assert config.pool_min_size == 0


class TestSSHPoolConfig:
    """Test SSH-specific pool configuration."""

    def test_ssh_pool_config_defaults(self):
        """Test SSH pool config with default values."""
        config = SSHPoolConfig()
        assert config.max_sessions == 5
        assert config.session_timeout == 300
        assert config.multiplexing_enabled is True

    def test_ssh_pool_config_custom_values(self):
        """Test SSH pool config with custom values."""
        config = SSHPoolConfig(max_sessions=10, session_timeout=600, multiplexing_enabled=False)
        assert config.max_sessions == 10
        assert config.session_timeout == 600
        assert config.multiplexing_enabled is False


class TestConnectionProfile:
    """Test ConnectionProfile model for REQ-3.4.3.4, REQ-3.4.3.7."""

    def test_profile_creation_single_endpoint(self):
        """Test creating a profile with a single endpoint (backward compatibility)."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="prod-api",
            name="Production API",
            protocol="http",
            endpoints=[endpoint],
        )
        assert profile.id == "prod-api"
        assert profile.name == "Production API"
        assert profile.protocol == "http"
        assert len(profile.endpoints) == 1
        assert profile.endpoints[0] == endpoint
        assert profile.blacklist_duration == 60  # Default

    def test_profile_creation_multiple_endpoints(self):
        """Test creating a profile with multiple endpoints for failover (REQ-3.4.3.4)."""
        endpoints = [
            Endpoint(protocol="http", host="api1.example.com", port=443),
            Endpoint(protocol="http", host="api2.example.com", port=443),
            Endpoint(protocol="http", host="api3.example.com", port=443),
        ]
        profile = ConnectionProfile(
            id="prod-api",
            name="Production API",
            protocol="http",
            endpoints=endpoints,
        )
        assert len(profile.endpoints) == 3
        assert profile.endpoints[0].host == "api1.example.com"
        assert profile.endpoints[1].host == "api2.example.com"
        assert profile.endpoints[2].host == "api3.example.com"

    def test_profile_blacklist_duration_default(self):
        """Test that blacklist_duration defaults to 60 seconds (REQ-3.4.3.7)."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api", name="Test API", protocol="http", endpoints=[endpoint]
        )
        assert profile.blacklist_duration == 60

    def test_profile_blacklist_duration_custom(self):
        """Test configuring custom blacklist duration (REQ-3.4.3.7)."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            blacklist_duration=120,
        )
        assert profile.blacklist_duration == 120

    def test_profile_blacklist_duration_short(self):
        """Test short blacklist duration (10-30 seconds)."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            blacklist_duration=10,
        )
        assert profile.blacklist_duration == 10

    def test_profile_blacklist_duration_long(self):
        """Test long blacklist duration (300+ seconds)."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            blacklist_duration=300,
        )
        assert profile.blacklist_duration == 300

    def test_profile_blacklist_duration_zero_disables(self):
        """Test that zero blacklist duration effectively disables blacklisting."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            blacklist_duration=0,
        )
        assert profile.blacklist_duration == 0

    def test_profile_blacklist_duration_validation_non_negative(self):
        """Test that blacklist_duration must be non-negative."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        with pytest.raises(ValidationError):
            ConnectionProfile(
                id="test-api",
                name="Test API",
                protocol="http",
                endpoints=[endpoint],
                blacklist_duration=-10,
            )

    def test_profile_validation_requires_endpoints(self):
        """Test that at least one endpoint is required."""
        with pytest.raises(ValidationError) as exc_info:
            ConnectionProfile(id="test-api", name="Test API", protocol="http", endpoints=[])
        assert "endpoints" in str(exc_info.value).lower()

    def test_profile_with_sql_pool_config(self):
        """Test profile with SQL-specific pool configuration."""
        endpoint = Endpoint(protocol="sql", host="db.example.com", port=5432)
        pool_config = SQLPoolConfig(pool_min_size=5, pool_max_size=20)
        profile = ConnectionProfile(
            id="test-db",
            name="Test Database",
            protocol="sql",
            endpoints=[endpoint],
            pool_config=pool_config,
        )
        assert isinstance(profile.pool_config, SQLPoolConfig)
        assert profile.pool_config.pool_min_size == 5
        assert profile.pool_config.pool_max_size == 20

    def test_profile_with_ssh_pool_config(self):
        """Test profile with SSH-specific pool configuration."""
        endpoint = Endpoint(protocol="ssh", host="server.example.com", port=22)
        pool_config = SSHPoolConfig(max_sessions=10, multiplexing_enabled=False)
        profile = ConnectionProfile(
            id="test-ssh",
            name="Test SSH",
            protocol="ssh",
            endpoints=[endpoint],
            pool_config=pool_config,
        )
        assert isinstance(profile.pool_config, SSHPoolConfig)
        assert profile.pool_config.max_sessions == 10
        assert profile.pool_config.multiplexing_enabled is False

    def test_profile_endpoint_priority_order_preserved(self):
        """Test that endpoint list order is preserved (defines priority for REQ-3.4.3.5)."""
        endpoints = [
            Endpoint(protocol="http", host="primary.example.com", port=443),
            Endpoint(protocol="http", host="secondary.example.com", port=443),
            Endpoint(protocol="http", host="tertiary.example.com", port=443),
        ]
        profile = ConnectionProfile(
            id="test-api", name="Test API", protocol="http", endpoints=endpoints
        )
        # Endpoint order must be preserved as it defines failover priority
        assert profile.endpoints[0].host == "primary.example.com"
        assert profile.endpoints[1].host == "secondary.example.com"
        assert profile.endpoints[2].host == "tertiary.example.com"

    def test_profile_metadata_fields(self):
        """Test that profile has metadata fields like other models."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            description="Test API profile",
            author="test-user",
            tags=["production", "critical"],
        )
        assert profile.description == "Test API profile"
        assert profile.author == "test-user"
        assert profile.tags == ["production", "critical"]
        assert profile.created_at is not None
        assert profile.updated_at is not None

    def test_profile_validation_requires_id(self):
        """Test that profile ID is required."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        with pytest.raises(ValidationError) as exc_info:
            ConnectionProfile(name="Test API", protocol="http", endpoints=[endpoint])
        assert "id" in str(exc_info.value).lower()

    def test_profile_validation_requires_name(self):
        """Test that profile name is required."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        with pytest.raises(ValidationError) as exc_info:
            ConnectionProfile(id="test-api", protocol="http", endpoints=[endpoint])
        assert "name" in str(exc_info.value).lower()

    def test_profile_validation_requires_protocol(self):
        """Test that protocol is required."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        with pytest.raises(ValidationError) as exc_info:
            ConnectionProfile(id="test-api", name="Test API", endpoints=[endpoint])
        assert "protocol" in str(exc_info.value).lower()
