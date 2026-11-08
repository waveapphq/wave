"""Tests for REQ-5.2.3.2: Application configuration management.

This test module verifies:
- Centralized configuration object managing all application settings
- Hierarchical configuration structure with nested settings groups
- Type-safe configuration with validation at load time
- Default values with environment-specific overrides
- Configuration sources: environment variables, files, runtime overrides
- Key configuration categories: server, storage, logging, integration, security
- Read-only and controlled write access patterns
- Environment variable integration (WAVE_* prefix)
- Runtime management via API endpoints
"""

import json
import os
import re
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml

_FILE_SECRET_KEY = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8="


class TestConfigurationArchitecture:
    """Test suite for centralized configuration object and hierarchical structure."""

    def test_config_singleton_pattern(self) -> None:
        """Test that configuration is a singleton accessible throughout the application."""
        from wavecore.api.config import get_config

        config1 = get_config()
        config2 = get_config()

        assert config1 is config2, "get_config() must return the same instance"

    def test_config_has_all_category_groups(self) -> None:
        """Test that configuration has all required category groups."""
        from wavecore.api.config import get_config

        config = get_config()

        # Required configuration categories from REQ-5.2.3.2
        assert hasattr(config, "server"), "config must have server settings"
        assert hasattr(config, "storage"), "config must have storage settings"
        assert hasattr(config, "logging"), "config must have logging settings"
        assert hasattr(config, "integration"), "config must have integration settings"
        assert hasattr(config, "security"), "config must have security settings"

    def test_config_hierarchical_structure(self) -> None:
        """Test that configuration supports nested settings groups."""
        from wavecore.api.config import get_config

        config = get_config()

        # Nested access should work
        assert hasattr(config.server, "host"), "config.server must have nested attributes"
        assert hasattr(config.server, "port"), "config.server must have nested attributes"

    def test_config_is_type_safe(self) -> None:
        """Test that configuration values have correct types."""
        from wavecore.api.config import get_config

        config = get_config()

        # Server settings types
        assert isinstance(config.server.host, str), "server.host must be string"
        assert isinstance(config.server.port, int), "server.port must be int"
        assert isinstance(config.server.worker_count, int), "server.worker_count must be int"
        assert isinstance(config.server.timeout, int | float), "server.timeout must be numeric"

        # Storage settings types
        assert isinstance(
            config.storage.file_storage_path, str | Path
        ), "storage.file_storage_path must be string or Path"

        # Logging settings types
        assert isinstance(config.logging.level, str), "logging.level must be string"
        assert isinstance(config.logging.format, str), "logging.format must be string"


class TestConfigurationDefaults:
    """Test suite for default configuration values."""

    def test_server_defaults(self) -> None:
        """Test that server settings have sensible defaults."""
        from wavecore.api.config import get_config

        config = get_config()

        assert config.server.host in [
            "0.0.0.0",
            "127.0.0.1",
            "localhost",
        ], "server.host must have valid default"
        assert 1024 <= config.server.port <= 65535, "server.port must be valid port"
        assert config.server.worker_count >= 1, "worker_count must be at least 1"
        assert config.server.timeout > 0, "timeout must be positive"

    def test_storage_defaults(self) -> None:
        """The data folder has no built-in default; it is set at installation (REQ-4.7.13)."""
        from wavecore.api.config import StorageConfig

        config = StorageConfig()

        assert "base_path" not in config._data, "base_path must not have a default"

    def test_logging_defaults(self) -> None:
        """Test that logging settings have sensible defaults."""
        from wavecore.api.config import get_config

        config = get_config()

        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        assert (
            config.logging.level.upper() in valid_levels
        ), f"logging.level must be one of {valid_levels}"
        assert len(config.logging.format) > 0, "logging.format must not be empty"

    def test_security_defaults(self) -> None:
        """Test that security settings have secure defaults."""
        from wavecore.api.config import get_config

        config = get_config()

        # CORS origins should be defined (may be empty list for security)
        assert isinstance(config.security.cors_origins, list), "cors_origins must be a list"


class TestEnvironmentVariableIntegration:
    """Test suite for environment variable configuration."""

    @pytest.fixture(autouse=True)
    def cleanup_env(self) -> None:
        """Clean up environment variables after each test."""
        # Store original values
        original_env = {key: value for key, value in os.environ.items() if key.startswith("WAVE_")}

        yield

        # Restore original environment
        for key in list(os.environ.keys()):
            if key.startswith("WAVE_"):
                del os.environ[key]

        for key, value in original_env.items():
            os.environ[key] = value

    def test_environment_variable_prefix(self) -> None:
        """Test that environment variables use WAVE_ prefix."""
        from wavecore.api.config import Config

        # Set environment variables
        os.environ["WAVE_SERVER_HOST"] = "test.example.com"
        os.environ["WAVE_SERVER_PORT"] = "9000"

        # Create new config instance
        config = Config()

        assert config.server.host == "test.example.com", "WAVE_SERVER_HOST must override default"
        assert config.server.port == 9000, "WAVE_SERVER_PORT must override default"

    def test_environment_variable_type_coercion_int(self) -> None:
        """Test that environment variables are coerced to int when needed."""
        from wavecore.api.config import Config

        os.environ["WAVE_SERVER_PORT"] = "8080"
        os.environ["WAVE_SERVER_WORKER_COUNT"] = "4"

        config = Config()

        assert isinstance(config.server.port, int), "port must be coerced to int"
        assert config.server.port == 8080, "port must have correct value"
        assert isinstance(config.server.worker_count, int), "worker_count must be coerced to int"
        assert config.server.worker_count == 4, "worker_count must have correct value"

    def test_environment_variable_type_coercion_bool(self) -> None:
        """Test that environment variables are coerced to bool when needed."""
        from wavecore.api.config import Config

        # Test various boolean representations
        test_cases = [
            ("true", True),
            ("True", True),
            ("TRUE", True),
            ("1", True),
            ("false", False),
            ("False", False),
            ("FALSE", False),
            ("0", False),
        ]

        for env_value, expected_bool in test_cases:
            os.environ["WAVE_SERVER_DEBUG"] = env_value
            config = Config()
            assert (
                config.server.debug == expected_bool
            ), f"'{env_value}' must be coerced to {expected_bool}"

    def test_environment_variable_type_coercion_list(self) -> None:
        """Test that environment variables are coerced to list when needed."""
        from wavecore.api.config import Config

        os.environ["WAVE_SECURITY_CORS_ORIGINS"] = "http://localhost:3000,https://app.example.com"

        config = Config()

        assert isinstance(
            config.security.cors_origins, list
        ), "cors_origins must be coerced to list"
        assert len(config.security.cors_origins) == 2, "must have 2 origins"
        assert "http://localhost:3000" in config.security.cors_origins, "must contain first origin"
        assert (
            "https://app.example.com" in config.security.cors_origins
        ), "must contain second origin"

    def test_environment_variable_invalid_type_raises_error(self) -> None:
        """Test that invalid type coercion raises validation error."""
        from wavecore.api.config import Config, ConfigValidationError

        os.environ["WAVE_SERVER_PORT"] = "not_a_number"

        with pytest.raises(ConfigValidationError, match="^.*port.*invalid.*$"):
            Config()

    def test_environment_variable_missing_uses_default(self) -> None:
        """Test that missing environment variables use default values."""
        from wavecore.api.config import Config

        # Don't set any WAVE_* env vars
        config = Config()

        # Should use defaults
        assert config.server.host is not None, "must have default host"
        assert config.server.port is not None, "must have default port"


class TestConfigurationFileSupport:
    """Test suite for configuration file loading (YAML/JSON)."""

    def test_load_config_from_yaml_file(self) -> None:
        """Test that configuration can be loaded from YAML file."""
        from wavecore.api.config import Config

        # Create temporary YAML config file
        config_data = {
            "server": {"host": "yaml.example.com", "port": 7000},
            "logging": {"level": "DEBUG"},
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            config = Config(config_file=config_file)

            assert config.server.host == "yaml.example.com", "must load host from YAML"
            assert config.server.port == 7000, "must load port from YAML"
            assert config.logging.level == "DEBUG", "must load log level from YAML"
        finally:
            os.unlink(config_file)

    def test_load_config_from_json_file(self) -> None:
        """Test that configuration can be loaded from JSON file."""
        from wavecore.api.config import Config

        # Create temporary JSON config file
        config_data = {
            "server": {"host": "json.example.com", "port": 6000},
            "logging": {"level": "WARNING"},
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(config_data, f)
            config_file = f.name

        try:
            config = Config(config_file=config_file)

            assert config.server.host == "json.example.com", "must load host from JSON"
            assert config.server.port == 6000, "must load port from JSON"
            assert config.logging.level == "WARNING", "must load log level from JSON"
        finally:
            os.unlink(config_file)

    def test_config_file_not_found_is_refused(self) -> None:
        """Test that a missing config file is refused by name (REQ-4.7.15)."""
        from wavecore.api.config import Config, ConfigValidationError

        with pytest.raises(
            ConfigValidationError,
            match=r"^Config file not found: /srv/wave-absent/config\.yaml "
            r"\(set WAVE_CONFIG_FILE to use another file\)$",
        ):
            Config(config_file="/srv/wave-absent/config.yaml")

    def test_invalid_yaml_file_raises_error(self) -> None:
        """Test that invalid YAML file raises appropriate error."""
        from wavecore.api.config import Config, ConfigValidationError

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            f.write("invalid: yaml: content: [unclosed")
            config_file = f.name

        try:
            with pytest.raises(
                ConfigValidationError,
                match=rf"^Config file {re.escape(config_file)} cannot be read: .+$",
            ):
                Config(config_file=config_file)
        finally:
            os.unlink(config_file)

    def test_invalid_json_file_raises_error(self) -> None:
        """Test that invalid JSON file raises appropriate error."""
        from wavecore.api.config import Config, ConfigValidationError

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            f.write('{"server": {"port": 6000}')
            config_file = f.name

        try:
            with pytest.raises(
                ConfigValidationError,
                match=rf"^Config file {re.escape(config_file)} cannot be read: .+$",
            ):
                Config(config_file=config_file)
        finally:
            os.unlink(config_file)


class TestConfigurationPriority:
    """Test suite for configuration source priority (env > file > defaults)."""

    @pytest.fixture(autouse=True)
    def cleanup_env(self) -> None:
        """Clean up environment variables after each test."""
        original_env = {key: value for key, value in os.environ.items() if key.startswith("WAVE_")}

        yield

        for key in list(os.environ.keys()):
            if key.startswith("WAVE_"):
                del os.environ[key]

        for key, value in original_env.items():
            os.environ[key] = value

    def test_environment_overrides_file(self) -> None:
        """Test that environment variables override config file values."""
        from wavecore.api.config import Config

        # Create config file
        config_data = {"server": {"host": "file.example.com", "port": 5000}}

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            # Set environment variable
            os.environ["WAVE_SERVER_HOST"] = "env.example.com"

            config = Config(config_file=config_file)

            # Environment should win
            assert config.server.host == "env.example.com", "env var must override file"
            assert config.server.port == 5000, "file value used when no env var"
        finally:
            os.unlink(config_file)

    def test_file_overrides_defaults(self) -> None:
        """Test that config file values override defaults."""
        from wavecore.api.config import Config

        # Create config file
        config_data = {"server": {"port": 9999}}

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            config = Config(config_file=config_file)

            # File should override default
            assert config.server.port == 9999, "file value must override default"
        finally:
            os.unlink(config_file)


class TestConfigurationValidation:
    """Test suite for configuration validation at load time."""

    def test_invalid_port_raises_validation_error(self) -> None:
        """Test that invalid port number raises validation error."""
        from wavecore.api.config import Config, ConfigValidationError

        config_data = {"server": {"port": 99999}}  # Invalid port

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            with pytest.raises(
                ConfigValidationError,
                match=rf"^Config file {re.escape(config_file)}: "
                r"server\.port must be a whole number from 1 to 65535$",
            ):
                Config(config_file=config_file)
        finally:
            os.unlink(config_file)

    def test_invalid_log_level_raises_validation_error(self) -> None:
        """Test that invalid log level raises validation error."""
        from wavecore.api.config import Config, ConfigValidationError

        config_data = {"logging": {"level": "INVALID_LEVEL"}}

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            with pytest.raises(
                ConfigValidationError,
                match=rf"^Config file {re.escape(config_file)}: logging\.level "
                r"must be one of DEBUG, INFO, WARN, ERROR, FATAL$",
            ):
                Config(config_file=config_file)
        finally:
            os.unlink(config_file)

    def test_negative_worker_count_raises_validation_error(self) -> None:
        """Test that negative worker count raises validation error."""
        from wavecore.api.config import Config, ConfigValidationError

        config_data = {"server": {"worker_count": -1}}

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            with pytest.raises(
                ConfigValidationError,
                match=rf"^Config file {re.escape(config_file)}: "
                r"server\.worker_count must be a whole number of 1 or more$",
            ):
                Config(config_file=config_file)
        finally:
            os.unlink(config_file)


class TestServerNumbers:
    """The server port and worker count follow the one number rule (REQ-3.1.3.14)."""

    @pytest.fixture(autouse=True)
    def cleanup_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for name in ("WAVE_SERVER_PORT", "WAVE_SERVER_WORKER_COUNT"):
            monkeypatch.delenv(name, raising=False)

    @pytest.mark.parametrize("written", [" 8080", "+8080", "8_080", "8080.0", "\u0668\u0660"])
    def test_an_environment_port_that_is_not_plain_digits_is_refused(
        self, written: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.config import Config, ConfigValidationError

        monkeypatch.setenv("WAVE_SERVER_PORT", written)

        with pytest.raises(
            ConfigValidationError,
            match=r"^Configuration field 'port' has invalid value: expected integer$",
        ):
            Config()

    def test_an_environment_worker_count_past_the_cap_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.config import Config, ConfigValidationError

        monkeypatch.setenv("WAVE_SERVER_WORKER_COUNT", "12345678901234567890")

        with pytest.raises(
            ConfigValidationError,
            match=r"^Configuration field 'worker_count' has invalid value: "
            r"expected at most 19 digits$",
        ):
            Config()

    @pytest.mark.parametrize(
        ("server", "problem"),
        [
            pytest.param(
                {"port": True}, "server.port must be a whole number from 1 to 65535", id="port-true"
            ),
            pytest.param(
                {"port": 8080.0},
                "server.port must be a whole number from 1 to 65535",
                id="port-float",
            ),
            pytest.param(
                {"port": "0x1F90"},
                "server.port must be a whole number from 1 to 65535",
                id="port-hex-text",
            ),
            pytest.param(
                {"worker_count": True},
                "server.worker_count must be a whole number of 1 or more",
                id="workers-true",
            ),
            pytest.param(
                {"worker_count": 10**19},
                "server.worker_count must be a whole number of at most 19 digits",
                id="workers-past-the-cap",
            ),
        ],
    )
    def test_a_file_server_number_that_is_not_one_is_refused(
        self, server: dict[str, Any], problem: str, tmp_path: Path
    ) -> None:
        from wavecore.api.config import Config, ConfigValidationError

        config_file = tmp_path / "config.yaml"
        config_file.write_text(yaml.safe_dump({"server": server}), encoding="utf-8")

        with pytest.raises(
            ConfigValidationError, match=rf"^Config file {re.escape(str(config_file))}: {problem}$"
        ):
            Config(config_file=str(config_file))

    def test_file_server_numbers_written_as_digits_run_as_numbers(self, tmp_path: Path) -> None:
        from wavecore.api.config import Config

        config_file = tmp_path / "config.yaml"
        config_file.write_text("server:\n  port: '8080'\n  worker_count: '04'\n", encoding="utf-8")

        config = Config(config_file=str(config_file))

        assert (config.server.port, config.server.worker_count) == (8080, 4)


class TestConfigurationAccessPatterns:
    """Test suite for configuration access patterns (read-only vs write)."""

    def test_config_read_access(self) -> None:
        """Test that configuration can be read by application components."""
        from wavecore.api.config import get_config

        config = get_config()

        # Should be able to read all values
        host = config.server.host
        port = config.server.port
        log_level = config.logging.level

        assert host is not None, "must be able to read server.host"
        assert port is not None, "must be able to read server.port"
        assert log_level is not None, "must be able to read logging.level"

    def test_config_update_via_set_method(self) -> None:
        """Test that configuration can be updated via controlled set method."""
        from wavecore.api.config import get_config

        config = get_config()

        # Update configuration value
        original_port = config.server.port
        config.set("server.port", 8888)

        assert config.server.port == 8888, "set() must update configuration value"
        assert config.server.port != original_port, "value must have changed"

    def test_config_update_validates_value(self, config_file: Path) -> None:
        """Test that configuration updates are validated before applying."""
        from wavecore.api.config import ConfigValidationError, get_config

        config = get_config()

        # Attempt to set invalid port
        with pytest.raises(
            ConfigValidationError,
            match=rf"^Config file {re.escape(str(config_file))}: "
            r"server\.port must be a whole number from 1 to 65535$",
        ):
            config.set("server.port", 99999)

        # Attempt to set invalid log level
        with pytest.raises(
            ConfigValidationError,
            match=rf"^Config file {re.escape(str(config_file))}: logging\.level "
            r"must be one of DEBUG, INFO, WARN, ERROR, FATAL$",
        ):
            config.set("logging.level", "INVALID")

    def test_config_get_method(self) -> None:
        """Test that configuration values can be retrieved via get method."""
        from wavecore.api.config import get_config

        config = get_config()

        # Get nested value using dot notation
        host = config.get("server.host")
        port = config.get("server.port")

        assert host is not None, "get() must return server.host"
        assert port is not None, "get() must return server.port"
        assert host == config.server.host, "get() must return same value as attribute"

    def test_config_get_with_default(self) -> None:
        """Test that get method supports default values for missing keys."""
        from wavecore.api.config import get_config

        config = get_config()

        # Get non-existent key with default
        value = config.get("nonexistent.key", default="default_value")

        assert value == "default_value", "get() must return default for missing key"

    def test_config_get_missing_key_without_default_raises_error(self) -> None:
        """Test that getting missing key without default raises error."""
        from wavecore.api.config import ConfigKeyError, get_config

        config = get_config()

        with pytest.raises(ConfigKeyError, match="^.*nonexistent.key.*not found.*$"):
            config.get("nonexistent.key")


class TestConfigurationCategories:
    """Test suite for specific configuration categories."""

    def test_server_settings_complete(self) -> None:
        """Test that server settings contain all required fields."""
        from wavecore.api.config import get_config

        config = get_config()

        # Required server settings from REQ-5.2.3.2
        assert hasattr(config.server, "host"), "server must have host"
        assert hasattr(config.server, "port"), "server must have port"
        assert hasattr(config.server, "worker_count"), "server must have worker_count"
        assert hasattr(config.server, "timeout"), "server must have timeout"

    def test_storage_settings_complete(self) -> None:
        """Test that storage settings contain all required fields."""
        from wavecore.api.config import get_config

        config = get_config()

        # Required storage settings from REQ-5.2.3.2
        assert hasattr(config.storage, "file_storage_path"), "storage must have file_storage_path"
        assert hasattr(config.storage, "backup_path"), "storage must have backup_path"

    def test_logging_settings_complete(self) -> None:
        """Test that logging settings contain all required fields."""
        from wavecore.api.config import get_config

        config = get_config()

        # Required logging settings from REQ-5.2.3.2
        assert hasattr(config.logging, "level"), "logging must have level"
        assert hasattr(config.logging, "format"), "logging must have format"
        assert hasattr(config.logging, "output_dest"), "logging must have output_dest"
        assert hasattr(config.logging, "rotation_policy"), "logging must have rotation_policy"

    def test_integration_settings_complete(self) -> None:
        """Test that integration settings contain all required fields."""
        from wavecore.api.config import get_config

        config = get_config()

        # Required integration settings from REQ-5.2.3.2
        assert hasattr(
            config.integration, "external_endpoints"
        ), "integration must have external_endpoints"
        assert hasattr(config.integration, "timeout"), "integration must have timeout"
        assert hasattr(config.integration, "retry_policy"), "integration must have retry_policy"

    def test_security_settings_complete(self) -> None:
        """Test that security settings contain all required fields."""
        from wavecore.api.config import get_config

        config = get_config()

        # Required security settings from REQ-5.2.3.2
        assert hasattr(config.security, "cors_origins"), "security must have cors_origins"
        assert hasattr(
            config.security, "credential_storage_path"
        ), "security must have credential_storage_path"
        assert hasattr(config.security, "encryption_params"), "security must have encryption_params"


class TestConfigurationToDict:
    """Test suite for configuration serialization."""

    def test_config_to_dict(self) -> None:
        """Test that configuration can be serialized to dictionary."""
        from wavecore.api.config import get_config

        config = get_config()

        config_dict = config.to_dict()

        assert isinstance(config_dict, dict), "to_dict() must return dictionary"
        assert "server" in config_dict, "dict must contain server settings"
        assert "storage" in config_dict, "dict must contain storage settings"
        assert "logging" in config_dict, "dict must contain logging settings"
        assert "integration" in config_dict, "dict must contain integration settings"
        assert "security" in config_dict, "dict must contain security settings"

    def test_config_dict_nested_structure(self) -> None:
        """Test that serialized config preserves nested structure."""
        from wavecore.api.config import get_config

        config = get_config()

        config_dict = config.to_dict()

        assert isinstance(config_dict["server"], dict), "server settings must be nested dict"
        assert "host" in config_dict["server"], "server dict must have host"
        assert "port" in config_dict["server"], "server dict must have port"


class TestConfigurationEdgeCases:
    """Test suite for edge cases and error conditions."""

    def test_config_handles_empty_file(self) -> None:
        """Test that empty config file falls back to defaults."""
        from wavecore.api.config import Config

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            f.write("")  # Empty file
            config_file = f.name

        try:
            config = Config(config_file=config_file)

            # Should use defaults
            assert config.server.port is not None, "must have default port"
        finally:
            os.unlink(config_file)

    def test_config_handles_partial_file(self) -> None:
        """Test that partial config file merges with defaults."""
        from wavecore.api.config import Config

        # Only specify one setting
        config_data = {"server": {"port": 3000}}

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            config = Config(config_file=config_file)

            # File value should be used
            assert config.server.port == 3000, "file value must be used"
            # Defaults should fill in missing values
            assert config.server.host is not None, "default host must be used"
            assert config.logging.level is not None, "default log level must be used"
        finally:
            os.unlink(config_file)

    def test_config_set_nested_key_creates_path(self) -> None:
        """Test that setting deeply nested key creates intermediate objects."""
        from wavecore.api.config import get_config

        config = get_config()

        # Set a deeply nested value
        config.set("integration.external_endpoints.api1", "http://example.com")

        value = config.get("integration.external_endpoints.api1")
        assert value == "http://example.com", "nested value must be set correctly"

    def test_config_concurrent_access_thread_safe(self) -> None:
        """Test that configuration can be safely accessed from multiple threads."""
        import threading

        from wavecore.api.config import get_config

        config = get_config()
        errors: list[Exception] = []

        def read_config() -> None:
            try:
                for _ in range(100):
                    _ = config.server.host
                    _ = config.server.port
                    _ = config.logging.level
            except Exception as e:
                errors.append(e)

        # Create multiple threads
        threads = [threading.Thread(target=read_config) for _ in range(10)]

        # Start all threads
        for t in threads:
            t.start()

        # Wait for completion
        for t in threads:
            t.join()

        # No errors should occur
        assert len(errors) == 0, f"concurrent access must be thread-safe: {errors}"


class TestConfigurationAPIEndpoints:
    """Test suite for configuration REST API endpoints."""

    @pytest.fixture
    def client(self):
        """Create FastAPI test client."""
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        return TestClient(app)

    def test_get_all_config_endpoint_returns_200(self, client) -> None:
        """Test GET /config returns all configuration with 200 status."""
        response = client.get("/config")

        assert response.status_code == 200, "GET /config must return 200"

        data = response.json()
        assert "success" in data, "response must contain success flag"
        assert data["success"] is True, "success must be True"
        assert "data" in data, "response must contain data object"
        assert "server" in data["data"], "data must contain server settings"
        assert "storage" in data["data"], "data must contain storage settings"
        assert "logging" in data["data"], "data must contain logging settings"

    def test_get_config_value_endpoint_returns_200(self, client) -> None:
        """Test GET /config/{key} returns specific value with 200 status."""
        response = client.get("/config/server.port")

        assert response.status_code == 200, "GET /config/server.port must return 200"

        data = response.json()
        assert "success" in data, "response must contain success flag"
        assert data["success"] is True, "success must be True"
        assert "data" in data, "response must contain data object"
        assert "key" in data["data"], "data must contain key field"
        assert "value" in data["data"], "data must contain value field"
        assert "type" in data["data"], "data must contain type field"
        assert data["data"]["key"] == "server.port", "key must match requested key"
        assert isinstance(data["data"]["value"], int | str), "value must be present"

    def test_get_config_value_not_found_returns_404(self, client) -> None:
        """Test GET /config/{key} returns 404 for non-existent key."""
        response = client.get("/config/nonexistent.key")

        assert response.status_code == 404, "must return 404 for non-existent key"

        data = response.json()
        assert "success" in data, "response must contain success flag"
        assert data["success"] is False, "success must be False"
        assert "error" in data, "error response must contain error object"
        assert "message" in data["error"], "error must contain message"

    def test_get_config_endpoint_leaves_the_empty_default_password_empty(self, client) -> None:
        """GET /config: the default database password holds nothing, so nothing is masked."""
        response = client.get("/config")

        assert response.status_code == 200, "GET /config must return 200"
        assert response.json()["data"]["database"]["password"] == ""

    def test_config_endpoint_includes_metadata(self, client) -> None:
        """Test that configuration endpoints include metadata about config source."""
        response = client.get("/config/server.port")

        assert response.status_code == 200, "GET /config/{key} must return 200"

        data = response.json()
        assert "data" in data, "response must include data"
        assert "type" in data["data"], "data must include type metadata"

        # Type should indicate the data type
        assert data["data"]["type"] in [
            "integer",
            "string",
            "boolean",
            "float",
            "object",
        ], "type must be valid type"


class TestConfigurationSecretMasking:
    """Test suite for masking sensitive configuration values."""

    def test_config_to_dict_masks_credential_paths(self) -> None:
        """Test that credential storage path is masked in serialized config."""
        from wavecore.api.config import get_config

        config = get_config()
        config_dict = config.to_dict()

        # Check that sensitive paths are masked
        if "security" in config_dict and "credential_storage_path" in config_dict["security"]:
            cred_path = config_dict["security"]["credential_storage_path"]
            # Should not contain full filesystem paths
            assert not cred_path.startswith("/"), "credential path should be masked in to_dict()"

    def test_config_to_dict_masks_encryption_parameters(self) -> None:
        """Test that encryption parameters are masked in serialized config."""
        from wavecore.api.config import get_config

        config = get_config()
        config_dict = config.to_dict()

        if "security" in config_dict and "encryption_params" in config_dict["security"]:
            enc_params = config_dict["security"]["encryption_params"]
            # Should not contain actual encryption keys
            assert isinstance(enc_params, str | dict), "encryption_params must exist"
            if isinstance(enc_params, str):
                assert enc_params in [
                    "[REDACTED]",
                    "***",
                ], "encryption params must be masked"

    def test_config_to_dict_with_include_secrets_flag(self) -> None:
        """Test that to_dict() can optionally include secrets for authorized access."""
        from wavecore.api.config import get_config

        config = get_config()

        # Normal serialization masks secrets
        masked_dict = config.to_dict(include_secrets=False)

        # Authorized serialization includes secrets
        full_dict = config.to_dict(include_secrets=True)

        # Full dict should have actual values
        assert masked_dict != full_dict, "masked and full dicts must differ"

    def test_config_to_dict_masks_the_secret_key(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY")
        config = load_config({"security": {"secret_key": _FILE_SECRET_KEY}})

        result = config.to_dict()

        assert result["security"]["secret_key"] == "[REDACTED]"
        assert _FILE_SECRET_KEY not in repr(result)

    def test_config_to_dict_with_include_secrets_shows_the_secret_key(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY")
        config = load_config({"security": {"secret_key": _FILE_SECRET_KEY}})

        result = config.to_dict(include_secrets=True)

        assert result["security"]["secret_key"] == _FILE_SECRET_KEY

    def test_config_to_dict_masks_a_secret_key_set_by_the_environment(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("WAVE_SECRET_KEY", _FILE_SECRET_KEY)
        config = load_config({})

        result = config.to_dict()

        assert result["security"]["secret_key"] == "[REDACTED]"
        assert _FILE_SECRET_KEY not in repr(result)

    def test_config_to_dict_adds_no_secret_key_when_none_is_set(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("WAVE_SECRET_KEY")
        config = load_config({})

        assert "secret_key" not in config.to_dict()["security"]

    def test_config_to_dict_masks_the_proxy_password(self, load_config: Callable[..., Any]) -> None:
        from wavecore.core.secrets.key_provider import get_cipher

        envelope = get_cipher().seal("s3cret-value")
        config = load_config({"network": {"proxy": {"username": "ops", "password": envelope}}})

        result = config.to_dict(include_secrets=False)

        assert result["network"]["proxy"]["password"] == "[REDACTED]"
        assert result["network"]["proxy"]["username"] == "ops"
        assert envelope not in repr(result)

    @pytest.mark.parametrize("stored", [True, False], ids=["stored", "none-stored"])
    def test_config_to_dict_masks_the_proxy_password_as_it_masks_the_mcp_password(
        self, stored: bool, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.core.secrets.key_provider import get_cipher

        envelope = get_cipher().seal("s3cret-value") if stored else None
        config = load_config(
            {"network": {"proxy": {"password": envelope}}, "mcp": {"auth_password": envelope}}
        )

        result = config.to_dict()

        assert result["network"]["proxy"]["password"] == result["mcp"]["auth_password"]

    def test_config_to_dict_with_include_secrets_shows_the_proxy_password(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.core.secrets.key_provider import get_cipher

        envelope = get_cipher().seal("s3cret-value")
        config = load_config({"network": {"proxy": {"password": envelope}}})

        masked = config.to_dict(include_secrets=False)
        full = config.to_dict(include_secrets=True)

        assert masked["network"]["proxy"]["password"] != envelope
        assert full["network"]["proxy"]["password"] == envelope

    def test_masking_the_proxy_password_leaves_the_running_value_alone(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.core.secrets.key_provider import get_cipher

        envelope = get_cipher().seal("s3cret-value")
        config = load_config({"network": {"proxy": {"password": envelope}}})

        masked = config.to_dict()

        assert masked["network"]["proxy"]["password"] == "[REDACTED]"
        assert config.get("network.proxy.password") == envelope
        assert config.to_dict()["network"]["proxy"]["password"] == "[REDACTED]"


class TestConfigSection:
    """Config.section: the running values of one section, by the keys its defaults name."""

    def test_section_of_an_empty_file_gives_the_defaults(self) -> None:
        from wavecore.api.config import get_config

        assert get_config().section("secret_masking") == {
            "run_output": False,
            "test_variables": False,
            "shared_variables": False,
            "credential_inputs": False,
        }

    def test_section_gives_the_running_values(self, load_config: Callable[..., Any]) -> None:
        config = load_config({"mcp": {"port": 9000, "bind": "network"}})

        assert config.section("mcp") == {
            "enabled": False,
            "port": 9000,
            "bind": "network",
            "auth_enabled": False,
            "auth_username": "",
            "auth_password": None,
        }

    def test_nested_prefix_gives_the_nested_section(self, load_config: Callable[..., Any]) -> None:
        policy = {"lock_trusted_hosts": True, "default_block_action": "strict"}
        config = load_config({"network": {"ssh_hosts": policy}})

        assert config.section("network.ssh_hosts") == policy

    def test_nested_prefix_keeps_the_defaults_of_the_keys_the_file_leaves_out(
        self, load_config: Callable[..., Any]
    ) -> None:
        config = load_config({"backup": {"schedule": {"cron": "0 2 * * *", "max_backups": 9}}})

        assert config.section("backup.schedule") == {
            "enabled": False,
            "cron": "0 2 * * *",
            "entity_types": None,
            "max_backups": 9,
            "save_directory": "~/wave-backups",
            "format": "yaml",
            "compression_method": "deflate",
            "compression_level": 6,
            "secrets": "mask",
            "last_run": None,
            "last_run_status": None,
        }

    @pytest.mark.parametrize("prefix", ["nowhere", "network.nowhere", "nowhere.deeper"])
    def test_prefix_that_does_not_exist_gives_an_empty_dict(self, prefix: str) -> None:
        from wavecore.api.config import get_config

        assert get_config().section(prefix) == {}

    @pytest.mark.parametrize("prefix", ["mcp.port", "mcp.port.deeper", "network.proxy.entries"])
    def test_prefix_that_names_a_setting_gives_an_empty_dict(self, prefix: str) -> None:
        from wavecore.api.config import get_config

        assert get_config().section(prefix) == {}

    def test_unknown_key_of_a_hand_edited_file_is_not_returned(
        self, load_config: Callable[..., Any]
    ) -> None:
        config = load_config("mcp:\n  port: 9000\n  transport: sse\n")

        result = config.section("mcp")

        assert sorted(result) == [
            "auth_enabled",
            "auth_password",
            "auth_username",
            "bind",
            "enabled",
            "port",
        ]
        assert result["port"] == 9000

    def test_unknown_key_of_a_nested_section_is_not_returned(
        self, load_config: Callable[..., Any]
    ) -> None:
        config = load_config(
            "network:\n  ssh_hosts:\n    lock_trusted_hosts: true\n    future_rule: 5\n"
        )

        assert config.section("network.ssh_hosts") == {
            "lock_trusted_hosts": True,
            "default_block_action": "disabled",
        }

    def test_section_is_a_plain_dict_of_plain_values(self, load_config: Callable[..., Any]) -> None:
        config = load_config({"backup": {"schedule": {"entity_types": ["tests", "suites"]}}})

        result = config.section("backup.schedule")

        assert type(result) is dict
        assert type(result["entity_types"]) is list
        assert result["entity_types"] == ["tests", "suites"]
        assert type(result["max_backups"]) is int

    def test_saved_value_is_in_the_section(self) -> None:
        from wavecore.api.config import get_config

        config = get_config()

        config.save({"mcp.port": 9000})

        assert config.section("mcp")["port"] == 9000

    def test_changing_the_result_never_changes_the_running_config(self) -> None:
        from wavecore.api.config import get_config

        config = get_config()

        result = config.section("mcp")
        result["port"] = 1

        assert config.get("mcp.port") == 8765
        assert config.section("mcp")["port"] == 8765

    def test_changing_a_list_in_the_result_never_changes_the_running_config(
        self, load_config: Callable[..., Any]
    ) -> None:
        entry = {"kind": "exact", "address": "https://a.example"}
        config = load_config({"network": {"proxy": {"entries": [dict(entry)]}}})

        result = config.section("network.proxy")
        result["entries"][0]["address"] = "https://b.example"
        result["entries"].append(dict(entry))

        assert config.get("network.proxy.entries") == [entry]
        assert config.section("network.proxy")["entries"] == [entry]


class TestConfigurationInternalBehavior:
    """Test suite for internal ConfigSection and Config implementation details."""

    def test_config_section_private_attribute_access(self) -> None:
        """Test accessing private attributes on ConfigSection."""
        from wavecore.api.config import ConfigSection

        section = ConfigSection({"key": "value"})

        # Access private attribute _data directly
        assert hasattr(section, "_data"), "ConfigSection must have _data attribute"
        assert section._data["key"] == "value", "private _data access must work"

    def test_config_section_attribute_not_found(self) -> None:
        """Test AttributeError when accessing non-existent attribute."""
        from wavecore.api.config import ConfigSection

        section = ConfigSection({"key": "value"})

        # Accessing non-existent attribute should raise AttributeError
        with pytest.raises(AttributeError, match="Configuration section has no attribute"):
            _ = section.nonexistent_attribute

    def test_server_config_with_data_update(self) -> None:
        """Test ServerConfig updates defaults with provided data."""
        from wavecore.api.config import ServerConfig

        data = {"host": "127.0.0.1", "custom_key": "custom_value"}
        config = ServerConfig(data)

        assert config.host == "127.0.0.1", "data must override defaults"
        assert config._data["custom_key"] == "custom_value", "custom data must be included"

    def test_storage_config_with_data_update(self) -> None:
        """Test StorageConfig updates defaults with provided data."""
        from wavecore.api.config import StorageConfig

        data = {"backup_path": "/custom/path"}
        config = StorageConfig(data)

        assert config.backup_path == "/custom/path", "data must override defaults"

    def test_logging_config_with_data_update(self) -> None:
        """Test LoggingConfig updates defaults with provided data."""
        from wavecore.api.config import LoggingConfig

        data = {"level": "DEBUG"}
        config = LoggingConfig(data)

        assert config.level == "DEBUG", "data must override defaults"

    def test_integration_config_with_data_update(self) -> None:
        """Test IntegrationConfig updates defaults with provided data."""
        from wavecore.api.config import IntegrationConfig

        data = {"timeout": 60}
        config = IntegrationConfig(data)

        assert config.timeout == 60, "data must override defaults"

    def test_security_config_with_data_update(self) -> None:
        """Test SecurityConfig updates defaults with provided data."""
        from wavecore.api.config import SecurityConfig

        data = {"cors_origins": ["http://localhost:3000"]}
        config = SecurityConfig(data)

        assert config.cors_origins == ["http://localhost:3000"], "data must override defaults"

    def test_security_config_defaults_the_origin_regex_to_empty(self) -> None:
        """Test SecurityConfig ships no origin pattern until one is configured."""
        from wavecore.api.config import SecurityConfig

        config = SecurityConfig()

        assert config.cors_origin_regex == "", "cors_origin_regex must default to empty"

    def test_security_config_with_origin_regex(self) -> None:
        """Test SecurityConfig carries a configured origin pattern."""
        from wavecore.api.config import SecurityConfig

        config = SecurityConfig({"cors_origin_regex": "^http://localhost(:\\d+)?$"})

        assert config.cors_origin_regex == "^http://localhost(:\\d+)?$", "data must override"

    def test_environment_variable_cors_origin_regex(self) -> None:
        """Test WAVE_SECURITY_CORS_ORIGIN_REGEX environment variable."""
        from wavecore.api.config import Config

        os.environ["WAVE_SECURITY_CORS_ORIGIN_REGEX"] = "^http://192\\.168\\.1\\.5(:\\d+)?$"

        config = Config()

        assert (
            config.security.cors_origin_regex == "^http://192\\.168\\.1\\.5(:\\d+)?$"
        ), "environment must override the origin pattern"

    def test_config_bool_coercion_truthy_value(self) -> None:
        """Test boolean coercion for truthy non-standard values."""
        from wavecore.api.config import Config

        # Test a truthy value that's not in the explicit lists
        result = Config._coerce_bool("maybe", "test_field")
        assert result is True, "non-empty string must coerce to True"

    def test_config_worker_count_validation_non_integer(self) -> None:
        """Test worker_count validation when value is not an integer."""
        from wavecore.api.config import Config, ConfigValidationError

        config = Config()
        # Bypass type system to test runtime validation
        config.server._data["worker_count"] = "not_an_int"

        with pytest.raises(
            ConfigValidationError,
            match=rf"^Config file {re.escape(str(config.config_file))}: "
            r"server\.worker_count must be a whole number of 1 or more$",
        ):
            config._validate()

    def test_config_get_with_dict_navigation(self) -> None:
        """Test config.get() navigating through plain dicts (not ConfigSections)."""
        from wavecore.api.config import Config

        config = Config()
        # Set a nested dict value
        config.integration._data["retry_policy"] = {"max_retries": 5}

        # Navigate through the dict
        value = config.get("integration.retry_policy.max_retries")
        assert value == 5, "must navigate through nested dicts"

    def test_config_get_dict_key_not_found(self) -> None:
        """Test config.get() when navigating dict and key not found."""
        from wavecore.api.config import Config, ConfigKeyError

        config = Config()
        config.integration._data["retry_policy"] = {"max_retries": 5}

        # Try to access non-existent key in dict
        with pytest.raises(ConfigKeyError, match="not found"):
            config.get("integration.retry_policy.nonexistent")

    def test_config_set_creates_intermediate_dict_in_config_section(self) -> None:
        """Test that set() creates intermediate dicts when path doesn't exist (ConfigSection
        parent).
        """
        from wavecore.api.config import Config

        config = Config()

        # Set a deeply nested value that doesn't exist
        config.set("integration.new_section.new_key", "new_value", validate=False)

        assert (
            config.get("integration.new_section.new_key") == "new_value"
        ), "must create intermediate paths"

    def test_config_set_creates_intermediate_dict_in_plain_dict(self) -> None:
        """Test that set() creates intermediate dicts in plain dict parents."""
        from wavecore.api.config import Config

        config = Config()
        # First create a plain dict
        config.integration._data["custom"] = {}

        # Now set a nested value
        config.set("integration.custom.nested.value", 42, validate=False)

        assert (
            config.get("integration.custom.nested.value") == 42
        ), "must create intermediate dict paths"

    def test_config_set_creates_intermediate_with_getattr(self) -> None:
        """Test that set() creates intermediate paths using getattr when needed."""
        from wavecore.api.config import Config

        config = Config()

        # This will test the getattr path in set()
        config.set("server.advanced.custom_option", "test", validate=False)

        assert (
            config.get("server.advanced.custom_option") == "test"
        ), "must create paths via getattr"

    def test_config_set_old_value_is_none(self) -> None:
        """Test config.set() when old value doesn't exist (None case)."""
        from wavecore.api.config import Config

        config = Config()

        # Set a completely new key
        config.set("server.brand_new_key", "value", validate=False)

        assert config.get("server.brand_new_key") == "value", "new key must be set"

    def test_config_set_uses_setattr_for_non_dict_parent(self) -> None:
        """Test config.set() using setattr when parent is neither ConfigSection nor dict."""
        from wavecore.api.config import Config

        config = Config()

        # Set value on server config
        config.set("server.new_attribute", "test_value", validate=False)

        assert (
            config.get("server.new_attribute") == "test_value"
        ), "must use setattr for config sections"

    def test_config_section_to_dict_with_nested_config_section(self) -> None:
        """Test _section_to_dict() with nested ConfigSection objects."""
        from wavecore.api.config import Config, ConfigSection

        config = Config()

        # Create a nested ConfigSection
        config.integration._data["nested"] = ConfigSection({"key": "value"})

        # Convert to dict
        result = config.to_dict()

        # Verify nested ConfigSection was properly converted
        assert "integration" in result, "must include integration section"
        assert isinstance(result["integration"], dict), "must convert to dict"

    def test_config_validation_port_not_integer(self) -> None:
        """Test validation fails when port is not an integer."""
        from wavecore.api.config import Config, ConfigValidationError

        config = Config()
        config.server._data["port"] = "not_an_int"

        with pytest.raises(
            ConfigValidationError,
            match=rf"^Config file {re.escape(str(config.config_file))}: "
            r"server\.port must be a whole number from 1 to 65535$",
        ):
            config._validate()

    def test_config_load_from_file_default_to_yaml(self) -> None:
        """Test that unknown file extension defaults to YAML parsing."""
        from wavecore.api.config import Config

        # Create a file with unknown extension
        config_data = {"server": {"port": 9999}}

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".conf", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            config = Config(config_file=config_file)
            assert config.server.port == 9999, "unknown extension must default to YAML"
        finally:
            os.unlink(config_file)

    def test_config_merge_all_sections(self) -> None:
        """Test _merge_config() updates all config sections."""
        from wavecore.api.config import Config

        # Create config with data for all sections
        config_data = {
            "server": {"port": 7777},
            "storage": {"base_path": "/test"},
            "logging": {"level": "WARNING"},
            "integration": {"timeout": 45},
            "security": {"cors_origins": ["http://test.com"]},
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            yaml.dump(config_data, f)
            config_file = f.name

        try:
            config = Config(config_file=config_file)

            assert config.server.port == 7777, "server must be merged"
            assert config.storage.base_path == "/test", "storage must be merged"
            assert config.logging.level == "WARNING", "logging must be merged"
            assert config.integration.timeout == 45, "integration must be merged"
            assert config.security.cors_origins == ["http://test.com"], "security must be merged"
        finally:
            os.unlink(config_file)

    def test_config_environment_variables_storage_base_path(self) -> None:
        """Test WAVE_STORAGE_BASE_PATH environment variable."""
        from wavecore.api.config import Config

        with patch.dict(os.environ, {"WAVE_STORAGE_BASE_PATH": "/env/base"}):
            config = Config()
            assert config.resolved_data_folder() == Path(
                "/env/base"
            ), "env var must set the data folder"

    def test_config_section_getattribute_for_private_attrs(self) -> None:
        """Test ConfigSection __getattr__ for private attributes starting with underscore."""
        from wavecore.api.config import ConfigSection

        section = ConfigSection({"key": "value"})

        # Accessing private attribute should use object.__getattribute__
        data_dict = section._data
        assert data_dict == {"key": "value"}, "private attr access must work"

    def test_config_get_navigates_through_dict_with_missing_key(self) -> None:
        """Test config.get() fails correctly when navigating dict and key not present."""
        from wavecore.api.config import Config, ConfigKeyError

        config = Config()

        # Create a nested structure with plain dict
        config.integration._data["custom_dict"] = {"level1": {"level2": "value"}}

        # Try to navigate to a key that doesn't exist in the dict
        with pytest.raises(ConfigKeyError, match="not found"):
            config.get("integration.custom_dict.level1.nonexistent")

    def test_config_set_creates_path_via_getattr_fallback(self) -> None:
        """Test config.set() creates intermediate paths via getattr when key doesn't exist."""
        from wavecore.api.config import Config

        config = Config()

        # Try to set a value that requires creating intermediate structure via getattr
        # This exercises the AttributeError exception path in set()
        config.set("server.deeply.nested.value", "test", validate=False)

        assert config.get("server.deeply.nested.value") == "test", "must create nested structure"

    def test_config_set_old_value_retrieved_via_getattr(self) -> None:
        """Test config.set() retrieves old value via getattr for non-dict/ConfigSection."""
        from wavecore.api.config import Config

        config = Config()

        # Set an initial value on server (ConfigSection)
        config.server._data["custom"] = "initial"

        # Update it - this will exercise the getattr path for old_value retrieval
        config.set("server.custom", "updated", validate=False)

        assert config.get("server.custom") == "updated", "existing key must be replaced"

    def test_config_set_uses_setattr_for_final_assignment(self) -> None:
        """Test config.set() uses setattr when parent is not dict or ConfigSection."""
        from wavecore.api.config import Config

        config = Config()

        # First set a value to create the structure
        config.set("server.nested", {"key": "value"}, validate=False)

        # Now update a nested value which will test setattr path
        config.set("server.timeout", 45.0, validate=False)

        assert config.server.timeout == 45.0, "must update value via setattr"


class TestConfigurationAPIEndpointsCoverage:
    """Test suite for API endpoint coverage gaps."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        return TestClient(app)

    def test_get_config_value_returns_object_type_for_dict(self, client) -> None:
        """Test GET /config/{key} returns correct type for values."""
        # Use the existing server.debug setting
        response = client.get("/config/server.debug")

        assert response.status_code == 200, "must return 200"
        data = response.json()
        assert data["data"]["type"] == "boolean", "boolean values must have type 'boolean'"


class TestConfigSectionCoverage:
    """Test suite for ConfigSection edge cases."""

    def test_config_section_getattr_wraps_dict_in_config_section(self) -> None:
        """Test ConfigSection wraps nested dict values in ConfigSection."""
        from wavecore.api.config import ConfigSection

        section = ConfigSection({"nested": {"key": "value"}})

        # Access nested dict - should be wrapped
        nested = section.nested
        assert isinstance(nested, ConfigSection), "nested dict must be wrapped"
        assert nested.key == "value", "wrapped section must preserve data"

    def test_config_section_getattr_private_attribute_via_object_getattribute(self) -> None:
        """Test ConfigSection uses object.__getattribute__ for private attributes."""
        from wavecore.api.config import ConfigSection

        section = ConfigSection({"key": "value"})

        # This should use object.__getattribute__ path (line 65)
        # by accessing a private attribute that starts with _
        data = section.__getattr__("_data")  # Explicitly call __getattr__ with private attribute

        # Verify it worked
        assert data == {"key": "value"}, "private attribute access must work"
        assert isinstance(data, dict), "must return the actual _data dict"

    def test_config_section_getattr_with_underscore_prefix(self) -> None:
        """Test ConfigSection __getattr__ with underscore-prefixed name."""
        from wavecore.api.config import ConfigSection

        section = ConfigSection({"key": "value"})

        # Access any attribute starting with _ - should use object.__getattribute__
        # This tests line 65 explicitly
        result = object.__getattribute__(section, "_data")
        assert result == {"key": "value"}, "object.__getattribute__ must return _data"


class TestConfigGetCoverage:
    """Test suite for Config.get() edge cases."""

    def test_config_get_navigates_dict_and_wraps_in_config_section(self) -> None:
        """Test config.get() wraps dict values in ConfigSection during navigation."""
        from wavecore.api.config import Config, ConfigSection

        config = Config()
        # Create a nested dict structure
        config.integration._data["nested_dict"] = {"level1": {"level2": "value"}}

        # Navigate to level1 - should wrap in ConfigSection
        value = config.get("integration.nested_dict.level1")
        assert isinstance(value, ConfigSection), "dict must be wrapped in ConfigSection"

    def test_config_get_raises_attribute_error_for_missing_nested_key(self) -> None:
        """Test config.get() raises AttributeError when navigating ConfigSection and key missing."""
        from wavecore.api.config import Config, ConfigKeyError

        config = Config()

        # Try to navigate to non-existent nested key in ConfigSection
        with pytest.raises(ConfigKeyError, match="not found"):
            config.get("server.nonexistent_nested.key")

    def test_config_get_navigates_through_plain_dict_with_nested_dict_wrapping(self) -> None:
        """Test config.get() navigates plain dict and wraps nested dict in ConfigSection."""
        from wavecore.api.config import Config, ConfigSection

        config = Config()
        # Create nested plain dicts (not ConfigSection)
        config.integration._data["plain_dict"] = {"level1": {"level2": {"value": "test"}}}

        # Navigate through plain dict - lines 448-454
        value = config.get("integration.plain_dict.level1.level2")
        assert isinstance(value, ConfigSection), "nested dict must be wrapped in ConfigSection"
        assert value.value == "test", "wrapped section must preserve data"

    def test_config_get_raises_error_for_missing_key_in_plain_dict(self) -> None:
        """Test config.get() raises error when key not in plain dict (line 454)."""
        from wavecore.api.config import Config, ConfigKeyError

        config = Config()
        # Create a plain dict
        config.integration._data["plain_dict"] = {"existing": "value"}

        # Try to access non-existent key in plain dict - triggers line 454
        with pytest.raises(ConfigKeyError, match="not found"):
            config.get("integration.plain_dict.nonexistent")

    def test_config_get_navigates_unwrapped_dict_in_iteration(self) -> None:
        """Test config.get(): navigating dict that hasn't been wrapped yet."""
        from wavecore.api.config import Config, ConfigSection

        config = Config()

        class CustomObj:
            def __init__(self):
                self.nested_dict = {"key": "value", "nested": {"inner": "inner_value"}}

        custom = CustomObj()
        config.integration._data["custom_obj"] = custom

        # Navigate: integration (ConfigSection) -> custom_obj -> nested_dict
        # On iteration for "nested_dict", value=CustomObj
        # On iteration for "key", value=dict
        result = config.get("integration.custom_obj.nested_dict.key")
        assert result == "value", "must navigate through plain dict"

        # Also test navigating to a nested dict within the plain dict
        result2 = config.get("integration.custom_obj.nested_dict.nested")
        assert isinstance(result2, ConfigSection), "nested dict must be wrapped in ConfigSection"
        assert result2.inner == "inner_value", "wrapped section must preserve data"

    def test_config_get_plain_dict_key_not_found_error(self) -> None:
        """Test config.get() line 454: KeyError when navigating plain dict with missing key."""
        from wavecore.api.config import Config, ConfigKeyError

        config = Config()

        # Create custom object with dict attribute
        class CustomObj:
            def __init__(self):
                self.data = {"existing": "value"}

        custom = CustomObj()
        config.integration._data["custom"] = custom

        # Try to access non-existent key in the plain dict - hits line 454
        with pytest.raises(ConfigKeyError, match="not found"):
            config.get("integration.custom.data.nonexistent")


class TestConfigSetCoverage:
    """Test suite for Config.set() edge cases."""

    def test_config_set_navigates_existing_dict_path(self) -> None:
        """Test config.set() navigates through existing dict without creating new path."""
        from wavecore.api.config import Config

        config = Config()
        # Create a dict structure
        config.integration._data["existing"] = {"nested": {}}

        # Set a value in existing path
        config.set("integration.existing.nested.key", "value", validate=False)

        assert (
            config.get("integration.existing.nested.key") == "value"
        ), "must set value in existing path"

    def test_config_set_creates_intermediate_dict_via_attribute_error(self) -> None:
        """Test config.set() creates intermediate dict when AttributeError occurs."""
        from wavecore.api.config import Config

        config = Config()

        # Try to set a deeply nested value that doesn't exist
        # This will trigger the AttributeError path in set()
        config.set("server.nonexistent_parent.child.value", "test", validate=False)

        assert (
            config.get("server.nonexistent_parent.child.value") == "test"
        ), "must create path via AttributeError"

    def test_config_set_retrieves_old_value_from_dict(self) -> None:
        """Test config.set() retrieves old value from plain dict."""
        from wavecore.api.config import Config

        config = Config()
        # Create dict with value
        config.integration._data["test_dict"] = {"key": "old_value"}

        # Update the value
        config.set("integration.test_dict.key", "new_value", validate=False)

        assert config.integration._data["test_dict"] == {
            "key": "new_value"
        }, "dict value must be replaced"

    def test_config_set_uses_setattr_when_parent_not_dict_or_config_section(self) -> None:
        """Test config.set() uses setattr for final assignment when parent is neither dict nor
        ConfigSection.
        """
        from wavecore.api.config import Config

        config = Config()

        # Create a custom object to test setattr path
        class CustomObject:
            pass

        custom = CustomObject()
        config.integration._data["custom"] = custom

        # Set attribute on custom object
        config.set("integration.custom.attribute", "value", validate=False)

        assert config.integration._data["custom"].attribute == "value", "must use setattr"

    def test_config_set_creates_intermediate_via_attribute_error_on_custom_object(self) -> None:
        """Test config.set() creates intermediate dict via AttributeError when navigating custom
        object.
        """
        from wavecore.api.config import Config

        config = Config()

        # Create a custom object that doesn't have the attribute
        class CustomObject:
            pass

        custom = CustomObject()
        config.integration._data["custom"] = custom

        # Try to set a nested value - this will trigger AttributeError and create intermediate dict
        # Lines 502-506
        config.set("integration.custom.nonexistent.nested.value", "test", validate=False)

        # The intermediate dict should be created via setattr
        assert hasattr(
            config.integration._data["custom"], "nonexistent"
        ), "must create intermediate via setattr"


class TestAppLifecycleCoverage:
    """Test suite for app.py lifecycle event coverage."""

    def test_startup_event_handler_exists(self) -> None:
        """Test that startup event handler is defined."""
        from wavecore.api.app import startup_event

        # Handler exists and is callable
        assert callable(startup_event), "startup_event must be callable"

    def test_shutdown_event_handler_exists(self) -> None:
        """Test that shutdown event handler is defined."""
        from wavecore.api.app import shutdown_event

        # Handler exists and is callable
        assert callable(shutdown_event), "shutdown_event must be callable"

    async def test_startup_event_executes(self) -> None:
        """Test that startup event handler can be called."""
        from wavecore.api.app import _cancel_liveness_tasks, app, startup_event

        await startup_event()
        # Startup launches the infinite liveness loops; drain them so a pending
        # task cannot leak onto this test's closing event loop.
        await _cancel_liveness_tasks()
        app.state.liveness_tasks = None

    async def test_shutdown_event_executes(self) -> None:
        """Test that shutdown event handler can be called."""
        from unittest.mock import AsyncMock, patch

        from wavecore.api.app import app, shutdown_event

        # Mock the workbench_service._clear_sessions since it's async
        mock_clear = AsyncMock()
        with patch("wavecore.api.services.workbench._common._clear_sessions", mock_clear):
            # Store and clear ws_manager to test without it
            original_ws_manager = getattr(app.state, "ws_manager", None)
            if hasattr(app.state, "ws_manager"):
                delattr(app.state, "ws_manager")

            try:
                await shutdown_event()
                mock_clear.assert_called_once()
            finally:
                # Restore ws_manager if it existed
                if original_ws_manager is not None:
                    app.state.ws_manager = original_ws_manager


_NOT_SET = (
    r"^Data folder not set: add storage\.base_path to the config file or set "
    r"WAVE_STORAGE_BASE_PATH$"
)


def _write_config_file(folder: Path, data: dict[str, Any], suffix: str = ".yaml") -> str:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"wave{suffix}"
    text = json.dumps(data) if suffix == ".json" else yaml.safe_dump(data)
    path.write_text(text, encoding="utf-8")
    return str(path)


def _same_place(result: Path, expected: Path) -> bool:
    return (
        result.is_absolute() and ".." not in result.parts and result.resolve() == expected.resolve()
    )


class TestDataFolderSetting:
    """storage.base_path is required and starts at the config file's folder (REQ-4.7.13)."""

    @pytest.fixture(autouse=True)
    def launch_folder(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
        monkeypatch.delenv("WAVE_STORAGE_BASE_PATH", raising=False)
        launch = tmp_path / "launch"
        launch.mkdir()
        monkeypatch.chdir(launch)
        return launch

    @pytest.mark.parametrize("suffix", [".yaml", ".json"])
    def test_relative_value_resolves_against_the_config_file_folder(
        self, suffix: str, tmp_path: Path, launch_folder: Path
    ) -> None:
        from wavecore.api.config import Config

        config_file = _write_config_file(
            tmp_path / "etc" / "wave", {"storage": {"base_path": "data"}}, suffix
        )

        result = Config(config_file=config_file).resolved_data_folder()

        assert isinstance(result, Path)
        assert _same_place(result, tmp_path / "etc" / "wave" / "data")
        assert not (launch_folder / "data").exists()

    def test_parent_relative_value_is_named_without_dot_dot(self, tmp_path: Path) -> None:
        from wavecore.api.config import Config

        config_file = _write_config_file(
            tmp_path / "install" / "config", {"storage": {"base_path": "../data"}}
        )

        result = Config(config_file=config_file).resolved_data_folder()

        assert _same_place(result, tmp_path / "install" / "data")

    def test_located_config_file_folder_is_kept_after_the_launch_folder_changes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.config import Config

        config_file = _write_config_file(
            tmp_path / "install" / "config", {"storage": {"base_path": "../data"}}
        )
        monkeypatch.setenv("WAVE_CONFIG_FILE", config_file)
        config = Config()
        elsewhere = tmp_path / "elsewhere"
        elsewhere.mkdir()
        monkeypatch.chdir(elsewhere)

        result = config.resolved_data_folder()

        assert _same_place(result, tmp_path / "install" / "data")

    def test_absolute_value_is_used_unchanged(self, tmp_path: Path) -> None:
        from wavecore.api.config import Config

        config_file = _write_config_file(
            tmp_path / "install", {"storage": {"base_path": "/srv/wave-data"}}
        )

        assert Config(config_file=config_file).resolved_data_folder() == Path("/srv/wave-data")

    def test_absolute_environment_override_wins_over_the_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.config import Config

        config_file = _write_config_file(tmp_path / "install", {"storage": {"base_path": "data"}})
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", "/srv/wave-env-data")

        result = Config(config_file=config_file).resolved_data_folder()

        assert result == Path("/srv/wave-env-data")

    def test_environment_override_is_read_when_resolving(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.config import Config

        config_file = _write_config_file(tmp_path / "install", {"storage": {"base_path": "data"}})
        config = Config(config_file=config_file)
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", "/srv/wave-env-data")

        assert config.resolved_data_folder() == Path("/srv/wave-env-data")

    @pytest.mark.parametrize("file_value", [None, "/srv/wave-data"])
    def test_relative_environment_override_is_refused(
        self, file_value: str | None, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.config import Config, ConfigValidationError

        data = {} if file_value is None else {"storage": {"base_path": file_value}}
        config_file = _write_config_file(tmp_path / "install", data)
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", "data")
        config = Config(config_file=config_file)

        with pytest.raises(
            ConfigValidationError, match=r"^WAVE_STORAGE_BASE_PATH must be an absolute path: data$"
        ):
            config.resolved_data_folder()

    @pytest.mark.parametrize(
        "storage",
        [None, {}, {"backup_path": "/srv/backups"}, {"base_path": ""}, {"base_path": None}],
        ids=["no-storage-section", "empty-section", "other-keys-only", "empty-text", "null"],
    )
    def test_missing_value_is_refused(self, storage: dict[str, Any] | None, tmp_path: Path) -> None:
        from wavecore.api.config import Config, ConfigValidationError

        data = {} if storage is None else {"storage": storage}
        config = Config(config_file=_write_config_file(tmp_path / "install", data))

        with pytest.raises(ConfigValidationError, match=_NOT_SET):
            config.resolved_data_folder()

    def test_no_config_file_and_no_environment_is_refused(self) -> None:
        from wavecore.api.config import Config, ConfigValidationError

        config = Config()

        with pytest.raises(ConfigValidationError, match=_NOT_SET):
            config.resolved_data_folder()

    def test_relative_value_without_a_config_file_is_refused(self) -> None:
        from wavecore.api.config import Config, ConfigValidationError

        config = Config()
        config.set("storage.base_path", "data")

        with pytest.raises(ConfigValidationError, match=_NOT_SET):
            config.resolved_data_folder()

    def test_missing_config_file_is_refused(self, tmp_path: Path) -> None:
        from wavecore.api.config import Config, ConfigValidationError

        missing = tmp_path / "absent" / "wave.yaml"

        with pytest.raises(
            ConfigValidationError,
            match=rf"^Config file not found: {re.escape(str(missing))} "
            r"\(set WAVE_CONFIG_FILE to use another file\)$",
        ):
            Config(config_file=str(missing))

    def test_config_without_a_data_folder_has_no_default(self, tmp_path: Path) -> None:
        from wavecore.api.config import Config

        config = Config(config_file=_write_config_file(tmp_path / "install", {}))

        assert "base_path" not in config.storage._data
