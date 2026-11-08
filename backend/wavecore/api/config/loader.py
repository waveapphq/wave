"""Configuration management for WAVE backend.

This module implements REQ-5.2.3.2: Application configuration management.

Provides centralized configuration management with:
- Hierarchical configuration structure with nested settings groups
- Type-safe configuration with validation at load time
- Configuration sources: defaults, one config file, environment variables, runtime overrides
- One config file, found by a fixed rule and refused by name when unusable (REQ-4.7.15)
- Instance settings that Settings saves back into the config file (REQ-4.7.16, REQ-4.7.17)
- Configuration categories: server, storage, logging, integration, security
- Read-only and controlled write access patterns
- Environment variable integration (WAVE_* prefix)
- Runtime management via API endpoints
- Configuration reload without service restart
- Audit trail for configuration changes
"""

import copy
import logging
import os
import threading
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from ruamel.yaml import YAML
from ruamel.yaml.constructor import SafeConstructor
from ruamel.yaml.error import MarkedYAMLError, YAMLError

import wavecore
from wavecore.api.config import instance_settings
from wavecore.api.exceptions import ValidationException

logger = logging.getLogger(__name__)

CONFIG_FILE_ENV: Final[str] = "WAVE_CONFIG_FILE"

_DATA_FOLDER_NOT_SET = (
    "Data folder not set: add storage.base_path to the config file or set WAVE_STORAGE_BASE_PATH"
)
_REDACTED: Final[str] = "[REDACTED]"


class ConfigValidationError(Exception):
    """Raised when configuration validation fails."""

    pass


class ConfigKeyError(Exception):
    """Raised when configuration key is not found."""

    pass


class ConfigFileProblem(Exception):
    """Why a config file cannot be used, worded to follow the file's path."""


def wave_dir() -> Path:
    """The folder that holds the ``wavecore`` package folder."""
    return Path(wavecore.__file__).resolve().parent.parent


def locate_config_file() -> Path:
    """The config file WAVE reads: the one ``WAVE_CONFIG_FILE`` names, else the default."""
    named = os.environ.get(CONFIG_FILE_ENV)
    if not named:
        return wave_dir() / "config" / "config.yaml"
    if not os.path.isabs(named):
        raise ConfigValidationError(f"{CONFIG_FILE_ENV} must be an absolute path: {named}")
    return Path(named)


def _parse_failure(error: UnicodeDecodeError | YAMLError) -> str:
    """One line saying where and why the file's text does not parse."""
    reason = str(error)
    if isinstance(error, MarkedYAMLError) and error.problem_mark is not None and error.problem:
        # A duplicated key's values may be secrets, so the text stops at the key.
        problem = error.problem.partition(" with value")[0]
        reason = f"line {error.problem_mark.line + 1}: {problem}"
    return reason.splitlines()[0]


class _PlainIntegerConstructor(SafeConstructor):
    """Reads an integer only from plain decimal digits; any other integer form stays text."""

    def construct_plain_int(self, node: Any) -> int | str:
        from wavecore.core.number_rule import number_problem

        text = str(self.construct_scalar(node))
        return text if number_problem(text, "integer") == "type" else int(text)


_PlainIntegerConstructor.add_constructor(
    "tag:yaml.org,2002:int", _PlainIntegerConstructor.construct_plain_int
)


def config_reader() -> YAML:
    """The parser that reads the config file's values, numbers by the one number rule."""
    parser = YAML(typ="safe", pure=True)
    parser.Constructor = _PlainIntegerConstructor
    return parser


def read_config_file(path: Path, parser: YAML) -> tuple[str, Any]:
    """The file's text and its top-level mapping, or ``None`` for a file without keys."""
    try:
        text = path.read_text(encoding="utf-8")
        document = parser.load(text)
    except OSError as error:
        raise ConfigFileProblem(f"cannot be read: {error.strerror}") from error
    except (UnicodeDecodeError, YAMLError) as error:
        # The parser's own error can quote the file's values, so it is not chained.
        raise ConfigFileProblem(f"cannot be read: {_parse_failure(error)}") from None
    if document is not None and not isinstance(document, Mapping):
        raise ConfigFileProblem("does not hold a YAML mapping")
    return text, document


class ConfigSection:
    """Base class for configuration sections with attribute access."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        """Initialize configuration section with data.

        Args:
            data: Dictionary of configuration values
        """
        self._data: dict[str, Any] = data or {}

    def __getattr__(self, name: str) -> Any:
        """Get attribute value.

        Args:
            name: Attribute name

        Returns:
            Attribute value

        Raises:
            AttributeError: If attribute not found
        """
        if name.startswith("_"):
            return object.__getattribute__(self, name)

        if name in self._data:
            value = self._data[name]
            # Return nested sections as ConfigSection objects
            if isinstance(value, dict):
                return ConfigSection(value)
            return value

        raise AttributeError(f"Configuration section has no attribute '{name}'")

    def __setattr__(self, name: str, value: Any) -> None:
        """Set attribute value.

        Args:
            name: Attribute name
            value: Attribute value
        """
        if name.startswith("_"):
            object.__setattr__(self, name, value)
        else:
            self._data[name] = value

    def __hasattr__(self, name: str) -> bool:
        """Check if attribute exists.

        Args:
            name: Attribute name

        Returns:
            True if attribute exists
        """
        return name in self._data


class ServerConfig(ConfigSection):
    """Server configuration section."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        """Initialize server configuration with defaults."""
        defaults = {
            "host": "0.0.0.0",
            "port": 8000,
            "worker_count": 4,
            "timeout": 30.0,
            "debug": False,
        }
        if data:
            defaults.update(data)
        super().__init__(defaults)


class StorageConfig(ConfigSection):
    """Storage configuration section."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        """Initialize storage configuration with defaults."""
        defaults = {
            "file_storage_path": "./storage",
            "backup_path": "./backups",
        }
        if data:
            defaults.update(data)
        super().__init__(defaults)


class LoggingConfig(ConfigSection):
    """Logging configuration section."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        """Initialize logging configuration with defaults."""
        defaults = {
            "level": "INFO",
            "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            "output_dest": "stdout",
            "rotation_policy": "daily",
        }
        if data:
            defaults.update(data)
        super().__init__(defaults)


class IntegrationConfig(ConfigSection):
    """Integration configuration section."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        """Initialize integration configuration with defaults."""
        defaults = {
            "external_endpoints": {},
            "timeout": 30,
            "retry_policy": {"max_retries": 3, "backoff_factor": 2.0},
        }
        if data:
            defaults.update(data)
        super().__init__(defaults)


class SecurityConfig(ConfigSection):
    """Security configuration section."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        """Initialize security configuration with defaults."""
        defaults = {
            # CORS origins default to empty (secure by default)
            "cors_origins": [],
            # Origin pattern allowed alongside the list; empty disables it.
            "cors_origin_regex": "",
            "credential_storage_path": "./credentials",
            "encryption_params": {"algorithm": "AES-256"},
            # Server-side root for the recipe value_from_file secret mode.
            # Empty disables that mode; WAVE_MCP_SECRETS_DIR overrides this.
            "secrets_input_dir": "",
        }
        if data:
            defaults.update(data)
        super().__init__(defaults)


_SECTION_TYPES: Final[dict[str, type[ConfigSection]]] = {
    "server": ServerConfig,
    "storage": StorageConfig,
    "logging": LoggingConfig,
    "integration": IntegrationConfig,
    "security": SecurityConfig,
}
_SECTION_NAMES: Final[tuple[str, ...]] = (*_SECTION_TYPES, *instance_settings.SECTION_DEFAULTS)


class Config:
    """Centralized configuration management for WAVE backend.

    Provides hierarchical configuration with multiple sources:
    - Default values
    - The config file (YAML)
    - Environment variables (WAVE_* prefix)
    - Runtime updates via API

    Thread-safe for concurrent access.
    """

    server: ConfigSection
    storage: ConfigSection
    logging: ConfigSection
    integration: ConfigSection
    security: ConfigSection
    secret_masking: ConfigSection
    network: ConfigSection
    mcp: ConfigSection
    backup: ConfigSection

    def __init__(self, config_file: str | None = None) -> None:
        """Load the given config file, or the located one, and refuse it when unusable."""
        self._lock = threading.RLock()
        self._change_listeners: list[Callable[[str, Any], None]] = []
        self._audit_trail: list[dict[str, Any]] = []
        self._config_file = Path(config_file) if config_file else locate_config_file()
        # Folder of the config file that set the storage section; base_path starts here.
        self._storage_folder: Path | None = None

        self._initialize_defaults()
        self._load_from_file()
        self._load_from_environment()
        self._validate()

    @property
    def config_file(self) -> Path:
        """The config file in use, as located (a link is not followed)."""
        return self._config_file

    def _initialize_defaults(self) -> None:
        """Initialize configuration with default values."""
        for name, section_type in _SECTION_TYPES.items():
            setattr(self, name, section_type())
        for name in instance_settings.SECTION_DEFAULTS:
            setattr(self, name, ConfigSection(instance_settings.merged(name, None)))

    def _load_from_file(self) -> None:
        """Merge the config file into the configuration, or refuse it by name (REQ-4.7.15)."""
        path = self._config_file
        if not path.exists():
            raise ConfigValidationError(
                f"Config file not found: {path} (set {CONFIG_FILE_ENV} to use another file)"
            )
        try:
            _, document = read_config_file(path, config_reader())
        except ConfigFileProblem as error:
            raise ConfigValidationError(f"Config file {path} {error}") from error
        data = document or {}
        for name in data:
            if name not in _SECTION_NAMES:
                logger.warning("Config file %s: unknown section %r is ignored", path, name)
        problem = instance_settings.section_problem(data, _SECTION_NAMES)
        if problem:
            raise ConfigValidationError(f"Config file {path}: {problem}")
        self._merge_config(data)
        if "storage" in data:
            self._storage_folder = Path(os.path.abspath(path)).parent

    def _merge_config(self, data: Mapping[str, Any]) -> None:
        """Replace every section the data holds with its values over the defaults."""
        for name, section_type in _SECTION_TYPES.items():
            if name in data:
                setattr(self, name, section_type(data[name]))
        for name in instance_settings.SECTION_DEFAULTS:
            if name in data:
                setattr(self, name, ConfigSection(instance_settings.merged(name, data[name])))

    def _load_from_environment(self) -> None:
        """Load configuration from environment variables with WAVE_ prefix."""
        # Server settings
        if "WAVE_SERVER_HOST" in os.environ:
            self.server.host = os.environ["WAVE_SERVER_HOST"]
        if "WAVE_SERVER_PORT" in os.environ:
            self.server.port = self._coerce_int(os.environ["WAVE_SERVER_PORT"], "port")
        if "WAVE_SERVER_WORKER_COUNT" in os.environ:
            self.server.worker_count = self._coerce_int(
                os.environ["WAVE_SERVER_WORKER_COUNT"], "worker_count"
            )
        if "WAVE_SERVER_DEBUG" in os.environ:
            self.server.debug = self._coerce_bool(os.environ["WAVE_SERVER_DEBUG"], "debug")

        # Security settings
        if "WAVE_SECURITY_CORS_ORIGINS" in os.environ:
            self.security.cors_origins = self._coerce_list(
                os.environ["WAVE_SECURITY_CORS_ORIGINS"], "cors_origins"
            )
        if "WAVE_SECURITY_CORS_ORIGIN_REGEX" in os.environ:
            self.security.cors_origin_regex = os.environ["WAVE_SECURITY_CORS_ORIGIN_REGEX"]
        if "WAVE_SECRET_KEY" in os.environ:
            self.security.secret_key = os.environ["WAVE_SECRET_KEY"]

    def resolved_data_folder(self) -> Path:
        """The absolute data folder in use (REQ-4.7.13)."""
        override = os.environ.get("WAVE_STORAGE_BASE_PATH")
        if override:
            if not os.path.isabs(override):
                raise ConfigValidationError(
                    f"WAVE_STORAGE_BASE_PATH must be an absolute path: {override}"
                )
            return Path(os.path.normpath(override))
        with self._lock:
            value = self.storage._data.get("base_path")
            folder = self._storage_folder
        if not value:
            raise ConfigValidationError(_DATA_FOLDER_NOT_SET)
        path = Path(str(value))
        if not path.is_absolute():
            if folder is None:
                raise ConfigValidationError(_DATA_FOLDER_NOT_SET)
            path = folder / path
        return Path(os.path.normpath(path))

    @staticmethod
    def _coerce_int(value: str, field_name: str) -> int:
        """An environment value as the whole number its plain digits stand for."""
        from wavecore.core.number_rule import number_problem

        problem = number_problem(value, "integer")
        if problem is not None:
            digits = instance_settings.MAX_INTEGER_DIGITS
            expected = "integer" if problem == "type" else f"at most {digits} digits"
            raise ConfigValidationError(
                f"Configuration field '{field_name}' has invalid value: expected {expected}"
            )
        return int(value)

    @staticmethod
    def _coerce_bool(value: str, field_name: str) -> bool:
        """Coerce string value to boolean.

        Args:
            value: String value to coerce
            field_name: Field name for error messages

        Returns:
            Boolean value
        """
        if value.lower() in ("true", "1", "yes"):
            return True
        elif value.lower() in ("false", "0", "no"):
            return False
        else:
            return bool(value)

    @staticmethod
    def _coerce_list(value: str, field_name: str) -> list[str]:
        """Coerce string value to list.

        Args:
            value: Comma-separated string value
            field_name: Field name for error messages

        Returns:
            List of strings
        """
        return [item.strip() for item in value.split(",") if item.strip()]

    def _validate(self) -> None:
        """Validate configuration values.

        Raises:
            ConfigValidationError: If validation fails
        """
        problem = self._server_problem() or instance_settings.first_problem(
            self._instance_sections()
        )
        if problem:
            raise ConfigValidationError(f"Config file {self._config_file}: {problem}")
        # A whole number written as its digits runs as that number.
        self.server.port = int(self.server.port)
        self.server.worker_count = int(self.server.worker_count)
        instance_settings.realize_numbers(self._instance_sections())

    def _server_problem(self) -> str | None:
        """``{key} {rule}`` for the first invalid server setting, else ``None``."""
        if instance_settings.whole_number_fault(self.server.port, 1, 65535):
            return "server.port must be a whole number from 1 to 65535"
        fault = instance_settings.whole_number_fault(self.server.worker_count, 1)
        if fault == "integer-cap":
            return (
                "server.worker_count must be a whole number of at most "
                f"{instance_settings.MAX_INTEGER_DIGITS} digits"
            )
        if fault:
            return "server.worker_count must be a whole number of 1 or more"
        return None

    def _instance_sections(self) -> dict[str, Any]:
        """The running sections that hold the settings Settings saves."""
        return {
            name: getattr(self, name)._data
            for name in ("logging", *instance_settings.SECTION_DEFAULTS)
        }

    def _problem_after(self, changes: Mapping[str, Any]) -> str | None:
        """The first setting the next start would refuse once the dotted keys are saved."""
        sections = copy.deepcopy(self._instance_sections())
        for key, value in changes.items():
            *parents, name = key.split(".")
            section = sections
            for parent in parents:
                section = section.setdefault(parent, {})
            section[name] = value
        return instance_settings.first_problem(sections)

    @staticmethod
    def _resolve_part(current: Any, part: str) -> Any:
        """Resolve a single dot-notation path segment against a config node.

        Args:
            current: The current node in the config tree
            part: The path segment to resolve

        Returns:
            The resolved value, with plain dicts wrapped in ConfigSection

        Raises:
            AttributeError: If the segment cannot be resolved
        """
        if isinstance(current, ConfigSection):
            if part not in current._data:
                raise AttributeError(f"No attribute '{part}'")
            raw = current._data[part]
        elif isinstance(current, dict):
            if part not in current:
                raise AttributeError(f"No key '{part}'")
            raw = current[part]
        else:
            return getattr(current, part)

        # Wrap plain dicts so callers get attribute-style access
        if isinstance(raw, dict) and not isinstance(raw, ConfigSection):
            return ConfigSection(raw)
        return raw

    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value by dot-notation key.

        Args:
            key: Configuration key in dot notation (e.g., "server.port")
            default: Default value if key not found (optional)

        Returns:
            Configuration value

        Raises:
            ConfigKeyError: If key not found and no default provided
        """
        with self._lock:
            try:
                value: Any = self
                for part in key.split("."):
                    value = self._resolve_part(value, part)
                return value
            except (AttributeError, KeyError) as e:
                if default is not None:
                    return default
                raise ConfigKeyError(f"Configuration key '{key}' not found") from e

    @staticmethod
    def _navigate_to_parent(root: Any, parts: list[str]) -> Any:
        """Navigate the config tree to the parent of the target key.

        Creates intermediate dicts for missing path segments.

        Args:
            root: Starting node (typically ``self``)
            parts: Path segments excluding the final field name

        Returns:
            The parent object that holds the final key
        """
        parent: Any = root
        for part in parts:
            if isinstance(parent, ConfigSection):
                if part in parent._data:
                    parent = parent._data[part]
                else:
                    new_dict: dict[str, Any] = {}
                    parent._data[part] = new_dict
                    parent = new_dict
            elif isinstance(parent, dict):
                if part not in parent:
                    parent[part] = {}
                parent = parent[part]
            else:
                try:
                    parent = getattr(parent, part)
                except AttributeError:
                    new_dict = {}
                    setattr(parent, part, new_dict)
                    parent = new_dict
        return parent

    @staticmethod
    def _get_field(parent: Any, field_name: str) -> Any:
        """Read a field from a config node, returning None if absent.

        Args:
            parent: The node to read from
            field_name: The field to read

        Returns:
            The current value, or None if not present
        """
        if isinstance(parent, ConfigSection):
            return parent._data.get(field_name)
        if isinstance(parent, dict):
            return parent.get(field_name)
        try:
            return getattr(parent, field_name)
        except AttributeError:
            return None

    @staticmethod
    def _set_field(parent: Any, field_name: str, value: Any) -> None:
        """Write a field on a config node.

        Args:
            parent: The node to write to
            field_name: The field to set
            value: The value to assign
        """
        if isinstance(parent, ConfigSection):
            parent._data[field_name] = value
        elif isinstance(parent, dict):
            parent[field_name] = value
        else:
            setattr(parent, field_name, value)

    def set(self, key: str, value: Any, user: str = "system", validate: bool = True) -> None:
        """Set configuration value by dot-notation key.

        Args:
            key: Configuration key in dot notation (e.g., "server.port")
            value: New value to set
            user: User making the change (for audit trail)
            validate: Whether to validate after setting

        Raises:
            ConfigValidationError: If validation fails
            ConfigKeyError: If key path is invalid
        """
        with self._lock:
            parts = key.split(".")
            field_name = parts[-1]
            parent = self._navigate_to_parent(self, parts[:-1])

            old_value = self._get_field(parent, field_name)
            self._set_field(parent, field_name, value)

            # Validate if requested
            if validate:
                try:
                    self._validate()
                except ConfigValidationError:
                    # Rollback on validation failure
                    if old_value is not None:
                        self._set_field(parent, field_name, old_value)
                    raise

            # Record audit entry
            self._audit_trail.append(
                {
                    "timestamp": datetime.now(UTC),
                    "key": key,
                    "old_value": old_value,
                    "new_value": value,
                    "user": user,
                }
            )

            # Notify listeners
            for listener in self._change_listeners:
                listener(key, value)

    def get_computed(self, key: str) -> Any:
        """Get computed configuration value derived from other config values.

        Args:
            key: Computed configuration key

        Returns:
            Computed value
        """
        # No computed keys remain; resolve via regular get
        return self.get(key)

    def save(self, changes: Mapping[str, Any], user: str = "settings") -> None:
        """Write the dotted keys to the config file, then make them the running values."""
        # Imported here: write_back imports this module.
        from wavecore.api.config import write_back

        with self._lock:
            problem = self._problem_after(changes)
            if problem:
                raise ValidationException(problem)
            changes = instance_settings.realized_changes(changes)
            write_back.write_keys(self._config_file, changes)
            for key, value in changes.items():
                self.set(key, value, user=user, validate=False)

    def section(self, prefix: str) -> dict[str, Any]:
        """The running values under a dotted prefix, for the keys the section's defaults name."""
        defaults: Mapping[str, Any] = instance_settings.SECTION_DEFAULTS
        with self._lock:
            running: Mapping[str, Any] = self._instance_sections()
            for part in prefix.split("."):
                if not isinstance(defaults.get(part), Mapping):
                    return {}
                defaults, running = defaults[part], running[part]
            return {key: copy.deepcopy(running[key]) for key in defaults}

    def save_changed(self, prefix: str, values: Mapping[str, Any]) -> bool:
        """Save the values that differ from the running section; False when none does."""
        with self._lock:
            running = self.section(prefix)
            realized = instance_settings.realized_changes(
                {f"{prefix}.{key}": value for key, value in values.items()}
            )
            changes = {
                key: value
                for key, value in realized.items()
                if value != running[key.removeprefix(f"{prefix}.")]
            }
            if changes:
                self.save(changes)
        return bool(changes)

    def reload(self) -> None:
        """Reload configuration from file without service restart."""
        with self._lock:
            self._load_from_file()
            self._load_from_environment()
            self._validate()

    def add_change_listener(self, listener: Callable[[str, Any], None]) -> None:
        """Add a change listener for configuration updates.

        Args:
            listener: Callback function(key, value) to call on changes
        """
        with self._lock:
            self._change_listeners.append(listener)

    def remove_change_listener(self, listener: Callable[[str, Any], None]) -> None:
        """Remove a change listener.

        Args:
            listener: Listener to remove
        """
        with self._lock:
            if listener in self._change_listeners:
                self._change_listeners.remove(listener)

    def get_audit_trail(self, key: str | None = None) -> list[dict[str, Any]]:
        """Get audit trail of configuration changes.

        Args:
            key: Optional key to filter audit entries

        Returns:
            List of audit entries
        """
        with self._lock:
            if key:
                return [entry for entry in self._audit_trail if entry["key"] == key]
            return list(self._audit_trail)

    def to_dict(self, include_secrets: bool = False) -> dict[str, Any]:
        """Convert configuration to dictionary.

        Args:
            include_secrets: Whether to include sensitive values

        Returns:
            Configuration as dictionary
        """
        with self._lock:
            result = {name: self._section_to_dict(getattr(self, name)) for name in _SECTION_NAMES}

            # Mask secrets if not including them
            if not include_secrets:
                if "credential_storage_path" in result["security"]:
                    result["security"]["credential_storage_path"] = _REDACTED
                if "encryption_params" in result["security"]:
                    result["security"]["encryption_params"] = _REDACTED
                if "secret_key" in result["security"]:
                    result["security"]["secret_key"] = _REDACTED
                result["mcp"]["auth_password"] = _REDACTED
                result["network"]["proxy"]["password"] = _REDACTED

            return result

    @staticmethod
    def _section_to_dict(section: ConfigSection) -> dict[str, Any]:
        """Convert configuration section to dictionary.

        Args:
            section: Configuration section

        Returns:
            Section as dictionary
        """
        result = {}
        for key, value in section._data.items():
            if isinstance(value, ConfigSection):
                result[key] = Config._section_to_dict(value)
            else:
                # A copy, so a change to the result never reaches the running config.
                result[key] = copy.deepcopy(value)
        return result


# Global configuration instance
_config_instance: Config | None = None
_config_lock = threading.Lock()


def get_config() -> Config:
    """Get global configuration instance (singleton).

    Returns:
        Global Config instance
    """
    global _config_instance

    if _config_instance is None:
        with _config_lock:
            if _config_instance is None:
                _config_instance = Config()

    return _config_instance
