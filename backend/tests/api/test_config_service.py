"""Unit tests for configuration service (REQ-5.2.4.12).

This module tests the configuration service providing business logic for
configuration operations including retrieval, updates, validation, and caching.

Test Coverage:
- Full configuration retrieval: Get complete configuration tree
- Individual key retrieval: Get value by dot-notation path
- Configuration updates: Update with validation
- Type validation: Type constraints, enumeration, range limits
- Mutable vs immutable: Runtime mutability handling
- Caching: Cache invalidation on updates
- Similar key suggestions: Fuzzy matching for not found keys
- Sensitive value masking: Security for credentials
"""

from unittest.mock import patch

import pytest

from wavecore.api.exceptions import ValidationException


class TestConfigServiceGetFullConfig:
    """Test suite for config_service.get_full_config()."""

    def test_get_full_config_returns_all_settings(self) -> None:
        """Test that get_full_config returns complete configuration tree."""
        from wavecore.api.services.config_service import get_full_config

        with patch("wavecore.api.services.config_service._load_config_tree") as mock_load:
            mock_load.return_value = {
                "server": {"host": "0.0.0.0", "port": 8000},
                "storage": {"artifact_dir": "/var/wave/artifacts"},
            }

            result = get_full_config()

            assert "server" in result
            assert "storage" in result
            assert result["server"]["port"] == 8000

    def test_get_full_config_organizes_by_category(self) -> None:
        """Test that get_full_config organizes settings hierarchically."""
        from wavecore.api.services.config_service import get_full_config

        with patch("wavecore.api.services.config_service._load_config_tree") as mock_load:
            mock_load.return_value = {
                "server": {"host": "localhost", "port": 8000, "debug": False},
                "storage": {"artifact_dir": "/artifacts", "retention_days": 30},
                "execution": {"max_parallel": 10, "timeout_seconds": 3600},
            }

            result = get_full_config()

            # Verify hierarchical structure
            assert isinstance(result["server"], dict)
            assert isinstance(result["storage"], dict)
            assert isinstance(result["execution"], dict)

    def test_get_full_config_masks_sensitive_values(self) -> None:
        """Test that get_full_config masks sensitive configuration values."""
        from wavecore.api.services.config_service import get_full_config

        with patch("wavecore.api.services.config_service._load_config_tree") as mock_load:
            mock_load.return_value = {
                "database": {"host": "localhost", "password": "secret123"},
                "api": {"secret_key": "my-secret-key"},
            }

            result = get_full_config()

            assert result["database"]["password"] == "********"
            assert result["api"]["secret_key"] == "********"

    def test_get_full_config_leaves_an_empty_sensitive_value_empty(self) -> None:
        """An empty secret holds nothing, so nothing is masked (REQ-4.5.1)."""
        from wavecore.api.services.config_service import get_full_config

        with patch("wavecore.api.services.config_service._load_config_tree") as mock_load:
            mock_load.return_value = {"database": {"password": ""}, "api": {"secret_key": None}}

            result = get_full_config()

            assert result["database"]["password"] == ""
            assert result["api"]["secret_key"] is None

    def test_get_full_config_excludes_credentials(self) -> None:
        """Test that get_full_config excludes or masks credentials."""
        from wavecore.api.services.config_service import get_full_config

        with patch("wavecore.api.services.config_service._load_config_tree") as mock_load:
            mock_load.return_value = {
                "server": {"port": 8000},
                "auth": {"token": "bearer-token-123"},
            }

            result = get_full_config()

            # Credentials should be masked, not exposed
            assert "bearer-token-123" not in str(result)

    def test_get_full_config_uses_cache(self) -> None:
        """Test that get_full_config uses cached configuration tree."""
        from wavecore.api.services.config_service import get_full_config

        with (
            patch("wavecore.api.services.config_service._get_cached_config") as mock_cache,
            patch("wavecore.api.services.config_service._load_config_tree") as mock_load,
        ):
            mock_cache.return_value = {"cached": True}

            result = get_full_config()

            assert result == {"cached": True}
            mock_load.assert_not_called()

    def test_get_full_config_loads_when_cache_empty(self) -> None:
        """Test that get_full_config loads from source when cache is empty."""
        from wavecore.api.services.config_service import get_full_config

        with (
            patch("wavecore.api.services.config_service._get_cached_config") as mock_cache,
            patch("wavecore.api.services.config_service._load_config_tree") as mock_load,
        ):
            mock_cache.return_value = None
            mock_load.return_value = {"server": {"port": 8000}}

            result = get_full_config()

            mock_load.assert_called_once()
            assert result["server"]["port"] == 8000


class TestConfigServiceGetConfigValue:
    """Test suite for config_service.get_config_value()."""

    def test_get_config_value_returns_value_with_metadata(self) -> None:
        """Test that get_config_value returns value with type and mutability."""
        from wavecore.api.services.config_service import get_config_value

        with (
            patch("wavecore.api.services.config_service._get_value_by_path") as mock_get,
            patch("wavecore.api.services.config_service._get_config_schema") as mock_schema,
        ):
            mock_get.return_value = 8000
            mock_schema.return_value = {
                "type": "integer",
                "mutable": True,
            }

            result = get_config_value("server.port")

            assert result is not None
            assert result["key"] == "server.port"
            assert result["value"] == 8000
            assert result["type"] == "integer"
            assert result["mutable"] is True

    def test_get_config_value_parses_dot_notation(self) -> None:
        """Test that get_config_value parses dot-notation paths correctly."""
        from wavecore.api.services.config_service import get_config_value

        with (
            patch("wavecore.api.services.config_service._get_value_by_path") as mock_get,
            patch("wavecore.api.services.config_service._get_config_schema") as mock_schema,
        ):
            mock_get.return_value = 30
            mock_schema.return_value = {"type": "integer", "mutable": True}

            _result = get_config_value("storage.artifacts.retention_days")

            mock_get.assert_called_once()
            call_args = mock_get.call_args[0]
            assert call_args[0] == "storage.artifacts.retention_days"

    def test_get_config_value_returns_none_when_not_found(self) -> None:
        """Test that get_config_value returns None when key not found."""
        from wavecore.api.services.config_service import get_config_value

        with patch("wavecore.api.services.config_service._get_value_by_path") as mock_get:
            mock_get.return_value = None

            result = get_config_value("nonexistent.key")

            assert result is None

    def test_get_config_value_masks_sensitive_values(self) -> None:
        """Test that get_config_value masks sensitive values."""
        from wavecore.api.services.config_service import get_config_value

        with (
            patch("wavecore.api.services.config_service._get_value_by_path") as mock_get,
            patch("wavecore.api.services.config_service._get_config_schema") as mock_schema,
            patch("wavecore.api.services.config_service._is_sensitive_key") as mock_sensitive,
        ):
            mock_get.return_value = "actual-secret"
            mock_schema.return_value = {"type": "string", "mutable": False}
            mock_sensitive.return_value = True

            result = get_config_value("api.secret_key")

            assert result["value"] == "********"
            assert result.get("sensitive") is True

    def test_get_config_value_leaves_an_empty_sensitive_value_empty(self) -> None:
        """An empty secret holds nothing, so nothing is masked (REQ-4.5.1)."""
        from wavecore.api.services.config_service import get_config_value

        with (
            patch("wavecore.api.services.config_service._get_value_by_path") as mock_get,
            patch("wavecore.api.services.config_service._get_config_schema") as mock_schema,
            patch("wavecore.api.services.config_service._is_sensitive_key") as mock_sensitive,
        ):
            mock_get.return_value = ""
            mock_schema.return_value = {"type": "string", "mutable": False}
            mock_sensitive.return_value = True

            result = get_config_value("api.secret_key")

            assert result["value"] == ""
            assert result.get("sensitive") is True

    def test_get_config_value_raises_for_invalid_path(self) -> None:
        """Test that get_config_value raises error for invalid path format."""
        from wavecore.api.services.config_service import get_config_value

        with pytest.raises(ValidationException, match=r"^Invalid key path format"):
            get_config_value(".invalid.path")

    def test_get_config_value_raises_for_empty_segment(self) -> None:
        """Test that get_config_value raises error for empty path segment."""
        from wavecore.api.services.config_service import get_config_value

        with pytest.raises(ValidationException, match=r"^Invalid key path format"):
            get_config_value("server..port")


class TestConfigServiceFindSimilarKeys:
    """Test suite for config_service.find_similar_keys()."""

    def test_find_similar_keys_returns_matches(self) -> None:
        """Test that find_similar_keys returns similar key suggestions."""
        from wavecore.api.services.config_service import find_similar_keys

        with patch("wavecore.api.services.config_service._get_all_config_keys") as mock_keys:
            mock_keys.return_value = [
                "server.port",
                "server.host",
                "server.debug",
                "storage.path",
            ]

            result = find_similar_keys("server.prot")

            assert "server.port" in result

    def test_find_similar_keys_returns_empty_for_no_matches(self) -> None:
        """Test that find_similar_keys returns empty list for no matches."""
        from wavecore.api.services.config_service import find_similar_keys

        with patch("wavecore.api.services.config_service._get_all_config_keys") as mock_keys:
            mock_keys.return_value = ["server.port", "server.host"]

            result = find_similar_keys("completely.different.key")

            assert result == []

    def test_find_similar_keys_limits_results(self) -> None:
        """Test that find_similar_keys limits number of suggestions."""
        from wavecore.api.services.config_service import find_similar_keys

        with patch("wavecore.api.services.config_service._get_all_config_keys") as mock_keys:
            mock_keys.return_value = [
                "server.port1",
                "server.port2",
                "server.port3",
                "server.port4",
                "server.port5",
                "server.port6",
            ]

            result = find_similar_keys("server.port", max_suggestions=3)

            assert len(result) <= 3


class TestConfigServiceCacheOperations:
    """Test suite for configuration cache operations."""

    def test_invalidate_config_cache_clears_cache(self) -> None:
        """Test that invalidate_config_cache clears the cached tree."""
        from wavecore.api.services.config_service import invalidate_config_cache

        with patch("wavecore.api.services.config_service._clear_config_cache") as mock_clear:
            invalidate_config_cache()

            mock_clear.assert_called_once()

    def test_cache_populated_on_first_access(self) -> None:
        """Test that cache is populated on first configuration access."""
        from wavecore.api.services.config_service import get_full_config

        with (
            patch("wavecore.api.services.config_service._get_cached_config") as mock_cache,
            patch("wavecore.api.services.config_service._load_config_tree") as mock_load,
            patch("wavecore.api.services.config_service._set_config_cache") as mock_set,
        ):
            mock_cache.return_value = None
            mock_load.return_value = {"server": {"port": 8000}}

            get_full_config()

            mock_set.assert_called_once()


class TestConfigServiceValidation:
    """Test suite for configuration value validation."""

    def test_get_type_name_returns_correct_types(self) -> None:
        """Test that _get_type_name returns correct type names."""
        from wavecore.api.services.config_service import _get_type_name

        assert _get_type_name(True) == "boolean"
        assert _get_type_name(False) == "boolean"
        assert _get_type_name(42) == "integer"
        assert _get_type_name(3.14) == "float"
        assert _get_type_name("hello") == "string"
        assert _get_type_name([1, 2, 3]) == "list"
        assert _get_type_name({"key": "value"}) == "dict"

    def test_validate_key_path_empty_key(self) -> None:
        """Test that empty key raises validation error."""
        from wavecore.api.services.config_service import _validate_key_path

        with pytest.raises(ValidationException, match="key cannot be empty"):
            _validate_key_path("")

    def test_validate_key_path_invalid_characters(self) -> None:
        """Test that invalid characters raise validation error."""
        from wavecore.api.services.config_service import _validate_key_path

        with pytest.raises(ValidationException, match="invalid characters"):
            _validate_key_path("server@port")

        with pytest.raises(ValidationException, match="invalid characters"):
            _validate_key_path("server port")

        with pytest.raises(ValidationException, match="invalid characters"):
            _validate_key_path("123.invalid")
