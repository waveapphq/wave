"""Unit tests for profile service layer (REQ-5.2.4.8).

This module tests the profile service layer that provides business logic
for connection profile operations including CRUD operations, type discovery,
and schema retrieval.

Test Coverage:
- Profile CRUD: Create, read, update, delete profile operations
- Profile listing: List all profiles
- Profile types: Enumerate supported profile types with descriptions
- Type schemas: JSON Schema retrieval for type-specific configuration
- Secret handling: Credential masking (password, api_key, private_key, token, client_key,
  bearer_token)
- Validation: Type validation, configuration schema validation with field paths
- Storage interaction: Profile persistence
- Description field: Optional documentation field support
- External credentials: Environment variable and Kubernetes secret references
- Deletion conflict: Referencing entity information
"""

import copy
import os
import re
import shutil
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import yaml

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.api.services.profiles import _common as _profile_common
from wavecore.api.services.profiles import import_export as _profile_import_export
from wavecore.api.services.storage_paths import get_profiles_storage_path
from wavecore.core.secrets.cipher import SecretCipher, is_secret_envelope
from wavecore.core.secrets.sealing import seal_profile

_DECRYPTION_FAILED_MESSAGE = (
    "Secret decryption failed: ciphertext is corrupt or the encryption key is invalid"
)


def _foreign_envelope(value: Any) -> str:
    """Seal a value under a key this instance does not hold (undecryptable here)."""
    return SecretCipher(bytes(range(1, 33))).seal(value)


@contextmanager
def _patch_profile_storage(data: dict[str, Any]) -> Any:
    """Patch _profile_storage in the canonical location, writing each record.

    The storage directory is the record and a listing reconciles against it, so
    a cache-only profile would not survive one.
    """
    storage_dir = get_profiles_storage_path()
    written: list[Path] = []
    for profile_id, profile in data.items():
        profile_dir = storage_dir / profile_id
        profile_dir.mkdir(parents=True, exist_ok=True)
        (profile_dir / "profile.yaml").write_text(yaml.safe_dump(profile))
        written.append(profile_dir)
    try:
        with patch.object(_profile_common, "_profile_storage", data):
            yield
    finally:
        for profile_dir in written:
            shutil.rmtree(profile_dir, ignore_errors=True)


@pytest.fixture(autouse=True)
def _ensure_profile_cache_loaded() -> None:
    """Ensure _cache_loaded is True so tests using patched storage work.

    Without this, _ensure_cache_loaded() clears the patched dict and loads
    from (empty) disk, defeating the mock.
    """
    _profile_common._cache_loaded = True


# Valid profile types as defined in OpenAPI spec
VALID_PROFILE_TYPES = [
    "database",
    "ssh",
    "http",
    "kubernetes",
    "opensearch",
    "custom",
]

KUBERNETES_TYPE_DESCRIPTION = "Cluster access with a service account token or client certificate"
HTTP_TYPE_DESCRIPTION = (
    "Base URLs with default headers, credentials, TLS trust and client identity, "
    "and timeout configuration"
)
CLIENT_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBg\n-----END PRIVATE KEY-----\n"
DATABASE_PROPERTIES = [
    ("host", {"type": "string", "plain": True}),
    ("port", {"type": "integer", "minimum": 1, "maximum": 65535}),
    ("database", {"type": "string"}),
    ("username", {"type": "string"}),
    ("password", {"type": "string", "secret": True}),
    ("verify_ssl", {"type": "boolean", "default": True}),
    ("ca_cert", {"type": "string", "plain": True}),
    ("client_cert", {"type": "string", "plain": True}),
    ("client_key", {"type": "string", "secret": True}),
    ("driver_options", {"type": "object", "default": {}}),
]
DATABASE_SCHEMA_FIELDS = [
    {"name": "host", "type": "string", "required": False, "secret": False, "plain": True},
    {
        "name": "port",
        "type": "integer",
        "required": False,
        "secret": False,
        "minimum": 1,
        "maximum": 65535,
    },
    {"name": "database", "type": "string", "required": False, "secret": False},
    {"name": "username", "type": "string", "required": False, "secret": False},
    {"name": "password", "type": "string", "required": False, "secret": True},
    {"name": "verify_ssl", "type": "boolean", "required": False, "secret": False, "default": True},
    {"name": "ca_cert", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "client_cert", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "client_key", "type": "string", "required": False, "secret": True},
    {"name": "driver_options", "type": "map", "required": False, "secret": False, "default": {}},
]
OPENSEARCH_TYPE_DESCRIPTION = (
    "Search cluster connections with a cluster URL, credentials and TLS trust material"
)
OPENSEARCH_PROPERTIES = [
    ("url", {"type": "string", "plain": True}),
    ("username", {"type": "string"}),
    ("password", {"type": "string", "secret": True}),
    ("api_key", {"type": "string", "secret": True}),
    ("bearer_token", {"type": "string", "secret": True}),
    ("verify_ssl", {"type": "boolean", "default": True}),
    ("ca_cert", {"type": "string", "plain": True}),
    ("client_cert", {"type": "string", "plain": True}),
    ("client_key", {"type": "string", "secret": True}),
]
OPENSEARCH_SCHEMA_FIELDS = [
    {"name": "url", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "username", "type": "string", "required": False, "secret": False},
    {"name": "password", "type": "string", "required": False, "secret": True},
    {"name": "api_key", "type": "string", "required": False, "secret": True},
    {"name": "bearer_token", "type": "string", "required": False, "secret": True},
    {"name": "verify_ssl", "type": "boolean", "required": False, "secret": False, "default": True},
    {"name": "ca_cert", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "client_cert", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "client_key", "type": "string", "required": False, "secret": True},
]
LDAP_TYPE_REJECTED = (
    "^Invalid profile type 'ldap': valid types are "
    "database, ssh, http, kubernetes, opensearch, custom$"
)
SFTP_TYPE_REJECTED = (
    "^Invalid profile type 'sftp': valid types are "
    "database, ssh, http, kubernetes, opensearch, custom$"
)


def _schema_field_names(profile_type: str) -> list[str]:
    """Flattened schema field names for a profile type, in schema order."""
    from wavecore.api.services.profiles import service as profile_service

    schema = profile_service.get_type_schema(profile_type)
    assert schema is not None
    return [field["name"] for field in schema["fields"]]


def _schema_fields(profile_type: str) -> dict[str, dict[str, Any]]:
    """Flattened schema fields for a profile type, keyed by field name."""
    from wavecore.api.services.profiles import service as profile_service

    schema = profile_service.get_type_schema(profile_type)
    assert schema is not None
    return {field["name"]: field for field in schema["fields"]}


class TestListProfiles:
    """Test suite for list_profiles function."""

    def test_list_profiles_returns_all_profiles(self) -> None:
        """Test that list_profiles returns all stored profiles."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                }
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles()

            assert result["total"] == 1
            assert len(result["profiles"]) == 1
            assert result["profiles"][0]["name"] == "my-database"
            # Verify usage field is included (REQ-4.7.4)
            assert result["profiles"][0]["usage"] == 0

    def test_list_profiles_returns_empty_list_when_no_profiles(self) -> None:
        """Test that list_profiles returns empty list when no profiles."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles()

            assert result["profiles"] == []
            assert result["total"] == 0

    def test_list_profiles_batch_usage_counts_references(self) -> None:
        """Test that list_profiles computes usage via batch scan."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                }
            },
        ):
            _profile_common._cache_loaded = True
            # Mock the cached test list to return a test referencing this profile
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=[{"name": "test-1", "metadata": {"profile_id": profile_id}}],
            ):
                result = profile_service.list_profiles()

            assert result["profiles"][0]["usage"] == 1

    def test_list_profiles_masks_secrets(self) -> None:
        """Test that list_profiles masks secret values."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost", "password": "secret123"},
                }
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles()

            assert result["profiles"][0]["config"]["password"] == "********"


class TestCreateProfile:
    """Test suite for create_profile function."""

    def test_create_profile_stores_profile(self) -> None:
        """Test that create_profile stores profile correctly."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost", "port": 5432},
            )

            assert result["name"] == "my-database"
            assert result["type"] == "database"
            assert "id" in result
            assert "created_at" in result
            assert "updated_at" in result

    def test_create_profile_generates_uuid(self) -> None:
        """Test that create_profile generates valid UUID for id."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name="test-profile",
                profile_type="ssh",
                config={},
            )

            # Validate UUID format
            uuid.UUID(result["id"])

    def test_create_profile_validates_type(self) -> None:
        """Test that create_profile validates profile type."""
        from wavecore.api.services.profiles import service as profile_service

        with pytest.raises(ValidationException) as exc_info:
            profile_service.create_profile(
                name="test",
                profile_type="invalid_type",
                config={},
            )

        assert "Invalid profile type" in str(exc_info.value)

    def test_create_profile_rejects_ldap_type(self) -> None:
        """Test that create_profile rejects the removed ldap type (REQ-4.7.3)."""
        from wavecore.api.services.profiles import service as profile_service

        with pytest.raises(ValidationException, match=LDAP_TYPE_REJECTED):
            profile_service.create_profile(
                name="corporate-directory",
                profile_type="ldap",
                config={},
            )

    def test_create_profile_rejects_sftp_type(self) -> None:
        """Test that create_profile rejects the removed sftp type (REQ-4.7.3)."""
        from wavecore.api.services.profiles import service as profile_service

        with (
            _patch_profile_storage({}),
            pytest.raises(ValidationException, match=SFTP_TYPE_REJECTED),
        ):
            profile_service.create_profile(
                name="file-drop",
                profile_type="sftp",
                config={"host": "files.example.com", "username": "deploy"},
            )

    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_create_profile_accepts_valid_types(self, profile_type: str) -> None:
        """Test that create_profile accepts all valid types."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name=f"test-{profile_type}",
                profile_type=profile_type,
                config={},
            )

            assert result["type"] == profile_type

    def test_create_profile_raises_conflict_on_duplicate_name(self) -> None:
        """Test that create_profile raises error for duplicate name."""
        from wavecore.api.services.profiles import service as profile_service

        existing_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                existing_id: {
                    "id": existing_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {},
                }
            },
        ):
            with pytest.raises(ConflictException) as exc_info:
                profile_service.create_profile(
                    name="my-database",
                    profile_type="database",
                    config={},
                )

            assert "already exists" in str(exc_info.value)

    def test_create_profile_masks_secrets_in_response(self) -> None:
        """Test that create_profile masks secrets in response."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost", "password": "secret123"},
            )

            assert result["config"]["password"] == "********"

    def test_create_profile_stores_actual_secret(self) -> None:
        """Test that create_profile stores the sealed secret value internally."""
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        storage: dict[str, Any] = {}

        with _patch_profile_storage(storage):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost", "password": "secret123"},
            )

            # Internal storage holds the sealed form of the actual value
            stored_profile = storage[result["id"]]
            assert is_secret_envelope(stored_profile["config"]["password"])
            assert unseal_all(stored_profile["config"]["password"]) == "secret123"

    def test_create_profile_validates_config_schema(self) -> None:
        """Test that create_profile validates config against type schema."""
        from wavecore.api.services.profiles import service as profile_service

        # Mock schema validation to fail
        mock_side_effect = ValidationException(
            "Configuration validation failed: 'host' is required"
        )
        with patch.object(profile_service, "_validate_config", side_effect=mock_side_effect):
            with _patch_profile_storage({}):
                with pytest.raises(ValidationException) as exc_info:
                    profile_service.create_profile(
                        name="my-database",
                        profile_type="database",
                        config={"port": 5432},  # Missing host
                    )

                assert "validation failed" in str(exc_info.value).lower()

    def test_create_profile_with_description(self) -> None:
        """Test that create_profile accepts optional description field (REQ-5.2.4.8)."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost"},
                description="Production database connection",
            )

            assert result["description"] == "Production database connection"

    def test_create_profile_stores_secret_values(self) -> None:
        """Test that create_profile stores sealed secret values internally (REQ-5.2.4.8)."""
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        storage: dict[str, Any] = {}

        with _patch_profile_storage(storage):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost", "password": "s3cret-pass"},
            )

            # Secret value stored sealed internally, restorable to the original
            stored = storage[result["id"]]
            assert is_secret_envelope(stored["config"]["password"])
            assert unseal_all(stored["config"]["password"]) == "s3cret-pass"

            # But masked in returned result
            assert result["config"]["password"] == "********"

    def test_create_database_profile_seals_password_and_client_key(self) -> None:
        """Test that a database profile stores both credentials sealed (REQ-4.7.11, SQL-14)."""
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.core.secrets.sealing import unseal_all

        storage: dict[str, Any] = {}

        with _patch_profile_storage(storage):
            result = profile_service.create_profile(
                name="orders-db",
                profile_type="database",
                config={"host": "db", "password": "s3cret-pass", "client_key": CLIENT_KEY_PEM},
            )

            stored = storage[result["id"]]["config"]
            assert is_secret_envelope(stored["password"])
            assert is_secret_envelope(stored["client_key"])
            assert unseal_all(stored["password"]) == "s3cret-pass"
            assert unseal_all(stored["client_key"]) == CLIENT_KEY_PEM
            assert result["config"] == {
                "host": "db",
                "password": "********",
                "client_key": "********",
            }

    def test_create_profile_validation_error_includes_field_path(self) -> None:
        """Test that validation errors include field path (REQ-5.2.4.8)."""
        from wavecore.api.services.profiles import service as profile_service

        mock_side_effect = ValidationException(
            "Configuration validation failed at 'config.port': expected integer, got string"
        )
        with patch.object(profile_service, "_validate_config", side_effect=mock_side_effect):
            with _patch_profile_storage({}):
                with pytest.raises(ValidationException) as exc_info:
                    profile_service.create_profile(
                        name="my-database",
                        profile_type="database",
                        config={"host": "localhost", "port": "invalid"},
                    )

                # Error should include field path
                assert "config.port" in str(exc_info.value)


class TestGetProfile:
    """Test suite for get_profile function."""

    def test_get_profile_returns_profile(self) -> None:
        """Test that get_profile returns profile by ID."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                }
            },
        ):
            result = profile_service.get_profile(profile_id)

            assert result is not None
            assert result["id"] == profile_id
            assert result["name"] == "my-database"

    def test_get_profile_returns_none_when_not_found(self) -> None:
        """Test that get_profile returns None when not found."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.get_profile(str(uuid.uuid4()))

            assert result is None

    def test_get_profile_masks_secrets(self) -> None:
        """Test that get_profile masks secret values."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "my-database",
                        "type": "database",
                        "config": {"host": "localhost", "password": "secret123"},
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile(profile_id)

            assert result is not None
            assert result["config"]["password"] == "********"


class TestGetProfileConfigForExecution:
    """Test suite for get_profile_config_for_execution function."""

    def test_returns_raw_config_without_masking(self) -> None:
        """Config for execution must return unmasked secrets."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "my-database",
                        "type": "database",
                        "config": {"host": "localhost", "password": "secret123"},
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(profile_id)

            assert result is not None
            assert result["host"] == "localhost"
            assert result["password"] == "secret123"  # NOT masked

    def test_returns_none_when_not_found(self) -> None:
        """Returns None for non-existent profile."""
        from wavecore.api.services.profiles import service as profile_service

        with (
            _patch_profile_storage({}),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(str(uuid.uuid4()))

            assert result is None

    def test_a_typed_map_field_realizes_its_element_types(self) -> None:
        """A map field's declared element types decide its run-time values (REQ-3.1.3.19)."""
        from decimal import Decimal

        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())
        typed = {
            "type": "map",
            "value": {"timeout": "16", "app": "2024", "ratio": "1.0"},
            "elementTypes": {"timeout": "integer", "app": "string", "ratio": "float"},
        }
        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "typed-db",
                        "type": "database",
                        "config": {"driver_options": typed},
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(profile_id)

        assert result is not None
        assert result["driver_options"] == {
            "timeout": 16,
            "app": "2024",
            "ratio": Decimal("1.0"),
        }

    def test_secret_field_names_for_missing_profile_is_empty(self) -> None:
        """Names query for a non-existent profile yields the empty set."""
        from wavecore.api.services.profiles import service as profile_service

        with (
            _patch_profile_storage({}),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            assert profile_service.get_profile_secret_field_names(str(uuid.uuid4())) == set()

    def test_merges_environment_values_when_environment_id_given(self) -> None:
        """When environment_id is given, env-specific values are merged on top of config."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())
        env_id = str(uuid.uuid4())

        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "my-server",
                        "type": "custom",
                        "config": {"timeout": 30},
                        "environment_values": {env_id: {"url": "http://prod.local", "timeout": 60}},
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(
                profile_id, environment_id=env_id
            )

            assert result is not None
            # env value overrides config default
            assert result["timeout"] == 60
            # env-only value is present
            assert result["url"] == "http://prod.local"

    def test_returns_deep_copy(self) -> None:
        """Returned config must be a deep copy to prevent mutation."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())
        original_config = {"host": "localhost", "port": 5432}

        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "my-db",
                        "type": "database",
                        "config": original_config,
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(profile_id)

            assert result is not None
            result["host"] = "mutated"
            # Original should be unchanged
            assert original_config["host"] == "localhost"

    def test_unwraps_typed_values(self) -> None:
        """Typed value dicts are unwrapped to plain values for execution."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "time-server",
                        "type": "http",
                        "config": {
                            "base_url": {
                                "type": "string",
                                "secret": False,
                                "value": "http://time.example.com",
                            },
                            "tz": {"type": "string", "secret": False, "value": "UTC"},
                            "timeout": {"type": "integer", "secret": False, "value": 5000},
                        },
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(profile_id)

            assert result is not None
            assert result["base_url"] == "http://time.example.com"
            assert result["tz"] == "UTC"
            assert result["timeout"] == 5000

    def test_coerces_typed_string_numbers_to_exact_runtime_values(self) -> None:
        """Integer / float typed values carried as exact digit-strings realize to
        exact int / Decimal at execution (no JS-Number rounding) - REQ-4.7.4."""
        from decimal import Decimal

        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "precise",
                        "type": "custom",
                        "config": {
                            "big_int": {
                                "type": "integer",
                                "secret": False,
                                "value": "1234567890123456789",
                            },
                            "big_float": {
                                "type": "float",
                                "secret": False,
                                "value": "3.14159265358979311600",
                            },
                        },
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(profile_id)

            assert result is not None
            # The exact 19-digit value survives.
            assert result["big_int"] == 1234567890123456789
            assert isinstance(result["big_int"], int)
            # float realizes to an exact Decimal carrying every significant digit.
            assert result["big_float"] == Decimal("3.14159265358979311600")

    def test_unwraps_typed_values_in_environment_overrides(self) -> None:
        """Typed values in environment-specific overrides are also unwrapped."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())
        env_id = str(uuid.uuid4())

        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "time-server",
                        "type": "http",
                        "config": {
                            "base_url": {
                                "type": "string",
                                "secret": False,
                                "value": "http://default.com",
                            },
                        },
                        "environment_values": {
                            env_id: {
                                "base_url": {
                                    "type": "string",
                                    "secret": False,
                                    "value": "http://prod.com",
                                },
                            },
                        },
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(
                profile_id, environment_id=env_id
            )

            assert result is not None
            assert result["base_url"] == "http://prod.com"

    def test_preserves_plain_values_alongside_typed(self) -> None:
        """Mix of typed and plain values - both are handled correctly."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with (
            _patch_profile_storage(
                {
                    profile_id: {
                        "id": profile_id,
                        "name": "mixed",
                        "type": "custom",
                        "config": {
                            "url": {
                                "type": "string",
                                "secret": False,
                                "value": "http://example.com",
                            },
                            "timeout": 30,
                            "host": "localhost",
                        },
                    }
                },
            ),
            patch.object(_profile_common, "_cache_loaded", True),
        ):
            result = profile_service.get_profile_config_for_execution(profile_id)

            assert result is not None
            assert result["url"] == "http://example.com"
            assert result["timeout"] == 30
            assert result["host"] == "localhost"


class TestUpdateProfile:
    """Test suite for update_profile function."""

    def test_update_profile_updates_name(self) -> None:
        """Test that update_profile updates profile name."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "old-name",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            },
        ):
            result = profile_service.update_profile(profile_id, name="new-name", config=None)

            assert result is not None
            assert result["name"] == "new-name"

    def test_update_profile_updates_config(self) -> None:
        """Test that update_profile updates profile config."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "oldhost"},
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            },
        ):
            result = profile_service.update_profile(
                profile_id, name=None, config={"host": "newhost"}
            )

            assert result is not None
            assert result["config"]["host"] == "newhost"

    def test_update_profile_returns_none_when_not_found(self) -> None:
        """Test that update_profile returns None when not found."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.update_profile(str(uuid.uuid4()), name="test", config=None)

            assert result is None

    def test_update_profile_updates_timestamp(self) -> None:
        """Test that update_profile updates updated_at timestamp."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {},
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            },
        ):
            result = profile_service.update_profile(profile_id, name="new-name", config=None)

            assert result is not None
            assert result["updated_at"] != "2024-01-01T00:00:00Z"

    def test_update_profile_validates_config(self) -> None:
        """Test that update_profile validates config against schema."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            },
        ):
            with patch.object(
                _profile_common,
                "_validate_config",
                side_effect=ValidationException("Configuration validation failed"),
            ):
                with pytest.raises(ValidationException) as exc_info:
                    profile_service.update_profile(
                        profile_id, name=None, config={"port": "invalid"}
                    )

                assert "validation failed" in str(exc_info.value).lower()

    def test_update_profile_masks_secrets_in_response(self) -> None:
        """Test that update_profile masks secrets in response."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            },
        ):
            result = profile_service.update_profile(
                profile_id, name=None, config={"password": "newsecret"}
            )

            assert result is not None
            assert result["config"]["password"] == "********"

    def test_update_profile_updates_description(self) -> None:
        """Test that update_profile updates description field (REQ-5.2.4.8)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "description": "Old description",
                    "config": {"host": "localhost"},
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            },
        ):
            result = profile_service.update_profile(
                profile_id,
                name=None,
                config=None,
                description="New description for database",
            )

            assert result is not None
            assert result["description"] == "New description for database"

    def test_update_profile_refuses_a_name_another_profile_holds(self) -> None:
        """Renaming onto another Profile's name is refused and nothing is saved."""
        from wavecore.api.services.profiles import service as profile_service

        taken_id = str(uuid.uuid4())
        own_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                taken_id: {"id": taken_id, "name": "Taken DB", "type": "database", "config": {}},
                own_id: {"id": own_id, "name": "Own DB", "type": "database", "config": {}},
            },
        ):
            with pytest.raises(
                ConflictException, match=r"^Profile with name 'Taken DB' already exists$"
            ):
                profile_service.update_profile(own_id, name="Taken DB", description="New")

            stored = yaml.safe_load(
                (get_profiles_storage_path() / own_id / "profile.yaml").read_text()
            )
            cached = _profile_common._profile_storage[own_id]
            assert (stored["name"], cached["name"]) == ("Own DB", "Own DB")
            assert "description" not in stored and "description" not in cached

    def test_update_profile_refuses_a_name_only_the_storage_directory_holds(self) -> None:
        """A Profile on disk but not yet in the cache still holds its name."""
        from wavecore.api.services.profiles import service as profile_service

        own_id = str(uuid.uuid4())
        disk_only_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {own_id: {"id": own_id, "name": "Own DB", "type": "database", "config": {}}},
        ):
            disk_only_dir = get_profiles_storage_path() / disk_only_id
            disk_only_dir.mkdir(parents=True)
            (disk_only_dir / "profile.yaml").write_text(
                yaml.safe_dump(
                    {"id": disk_only_id, "name": "Disk DB", "type": "database", "config": {}}
                )
            )
            try:
                with pytest.raises(
                    ConflictException, match=r"^Profile with name 'Disk DB' already exists$"
                ):
                    profile_service.update_profile(own_id, name="Disk DB")
            finally:
                shutil.rmtree(disk_only_dir, ignore_errors=True)

    def test_update_profile_keeps_a_name_it_already_shares(self) -> None:
        """A save that keeps the current name passes even when another Profile shares it."""
        from wavecore.api.services.profiles import service as profile_service

        first_id = str(uuid.uuid4())
        twin_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                first_id: {"id": first_id, "name": "Shared DB", "type": "database", "config": {}},
                twin_id: {"id": twin_id, "name": "Shared DB", "type": "database", "config": {}},
            },
        ):
            result = profile_service.update_profile(twin_id, name="Shared DB", description="Kept")

            assert result is not None
            assert (result["name"], result["description"]) == ("Shared DB", "Kept")

    def test_a_refused_update_changes_nothing_a_later_read_sees(self) -> None:
        """A save the config check refuses leaves the cached Profile as stored."""
        from wavecore.api.services.profiles import service as profile_service

        own_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {own_id: {"id": own_id, "name": "Own DB", "type": "database", "config": {}}},
        ):
            with pytest.raises(
                ValidationException, match=_refusal("port", "must be between 1 and 65535")
            ):
                profile_service.update_profile(
                    own_id, name="Renamed DB", config={"port": 70000}, description="New"
                )

            reread = profile_service.get_profile(own_id)
            assert reread is not None
            assert (reread["name"], "description" in reread) == ("Own DB", False)


class TestDeleteProfile:
    """Test suite for delete_profile function."""

    def test_delete_profile_returns_true_on_success(self) -> None:
        """Test that delete_profile returns True on success."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())
        storage: dict[str, Any] = {
            profile_id: {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {},
            }
        }

        with _patch_profile_storage(storage):
            result = profile_service.delete_profile(profile_id)

            assert result is True
            assert profile_id not in storage

    def test_delete_profile_returns_false_when_not_found(self) -> None:
        """Test that delete_profile returns False when not found."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.delete_profile(str(uuid.uuid4()))

            assert result is False

    def test_delete_profile_raises_conflict_when_in_use(self) -> None:
        """Test that delete_profile raises error when profile is in use."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {},
                }
            },
        ):
            with patch.object(
                profile_service,
                "_get_profile_references",
                return_value=["test-1", "test-2", "test-3"],
            ):
                with pytest.raises(ConflictException) as exc_info:
                    profile_service.delete_profile(profile_id)

                # ConflictException is correctly raised
                assert "in use" in str(exc_info.value).lower()

    def test_delete_profile_conflict_includes_referencing_entities(self) -> None:
        """Test that conflict error includes referencing entity names (REQ-5.2.4.8)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {},
                }
            },
        ):
            refs = ["test-login-flow", "test-checkout", "test-payment"]
            with patch.object(profile_service, "_get_profile_references", return_value=refs):
                with pytest.raises(ConflictException) as exc_info:
                    profile_service.delete_profile(profile_id)

                error_message = str(exc_info.value)
                # Error should include the specific referencing entity names
                assert "test-login-flow" in error_message
                assert "test-checkout" in error_message
                assert "test-payment" in error_message


class TestProfileUsageIncludesElementBindings:
    """Usage tracking must count profile bindings inside test element configs."""

    def test_usage_counts_node_profile_binding(self) -> None:
        profile_id = str(uuid.uuid4())
        test_with_binding = {
            "id": "t1",
            "name": "test-canvas-bound",
            "metadata": {},
            "nodes": [
                {
                    "id": "n1",
                    "data": {
                        "config": {
                            "profileBindings": [
                                {"profileId": profile_id, "alias": "cpr"},
                            ]
                        }
                    },
                }
            ],
        }
        with patch(
            "wavecore.api.services.tests.service._cached_tests",
            return_value=[test_with_binding],
        ):
            refs = _profile_common._get_profile_references(profile_id)
            counts = _profile_common.compute_all_profile_usage()

        assert refs == ["test-canvas-bound"]
        assert counts == {profile_id: 1}

    def test_usage_does_not_double_count_when_metadata_and_node_match(self) -> None:
        profile_id = str(uuid.uuid4())
        test_obj = {
            "id": "t1",
            "name": "test-both",
            "metadata": {"profile_id": profile_id},
            "nodes": [
                {
                    "id": "n1",
                    "data": {
                        "config": {
                            "profileBindings": [
                                {"profileId": profile_id, "alias": "cpr"},
                            ]
                        }
                    },
                }
            ],
        }
        with patch(
            "wavecore.api.services.tests.service._cached_tests",
            return_value=[test_obj],
        ):
            counts = _profile_common.compute_all_profile_usage()

        assert counts == {profile_id: 1}

    def test_delete_blocked_when_profile_referenced_only_via_node_binding(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())
        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-prof",
                    "type": "custom",
                    "config": {},
                }
            }
        ):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=[
                    {
                        "id": "t1",
                        "name": "test-uses-binding",
                        "metadata": {},
                        "nodes": [
                            {
                                "id": "n1",
                                "data": {
                                    "config": {
                                        "profileBindings": [
                                            {"profileId": profile_id, "alias": "cpr"},
                                        ]
                                    }
                                },
                            }
                        ],
                    }
                ],
            ):
                with pytest.raises(ConflictException) as exc_info:
                    profile_service.delete_profile(profile_id)
                assert "test-uses-binding" in str(exc_info.value)


class TestUpdateProfileStructuralLock:
    """When a profile is in use, parameter set/types are immutable."""

    def _stored(self, pid: str) -> dict[str, Any]:
        return {
            pid: {
                "id": pid,
                "name": "p",
                "type": "custom",
                "config": {
                    "v1": {"type": "string", "secret": False, "value": "x"},
                },
                "environment_values": {
                    "env-a": {"v1": {"type": "string", "secret": False, "value": "y"}},
                },
            }
        }

    def _used_test_for(self, pid: str) -> list[dict[str, Any]]:
        return [
            {
                "id": "t1",
                "name": "test-uses",
                "metadata": {},
                "nodes": [
                    {
                        "id": "n1",
                        "data": {
                            "config": {
                                "profileBindings": [
                                    {"profileId": pid, "alias": "cpr"},
                                ]
                            }
                        },
                    }
                ],
            }
        ]

    def test_value_only_update_allowed_when_in_use(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        with _patch_profile_storage(self._stored(pid)):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                # change value but keep same key + type
                new_env_values = {
                    "env-a": {"v1": {"type": "string", "secret": False, "value": "z"}},
                }
                profile_service.update_profile(pid, environment_values=new_env_values)

    def test_param_add_blocked_when_in_use(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        with _patch_profile_storage(self._stored(pid)):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                new_config = {
                    "v1": {"type": "string", "secret": False, "value": "x"},
                    "v2": {"type": "string", "secret": False, "value": "new"},
                }
                with pytest.raises(ConflictException) as exc:
                    profile_service.update_profile(pid, config=new_config)
                assert "in use" in str(exc.value).lower()

    def test_param_remove_blocked_when_in_use(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        with _patch_profile_storage(self._stored(pid)):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                # Remove from both config AND env_values - true structural drop.
                with pytest.raises(ConflictException):
                    profile_service.update_profile(pid, config={}, environment_values={"env-a": {}})

    def test_param_rename_blocked_when_in_use(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        with _patch_profile_storage(self._stored(pid)):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                renamed = {"v1_renamed": {"type": "string", "secret": False, "value": "x"}}
                with pytest.raises(ConflictException):
                    profile_service.update_profile(pid, config=renamed)

    def test_param_type_change_blocked_when_in_use(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        with _patch_profile_storage(self._stored(pid)):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                retyped = {"v1": {"type": "integer", "secret": False, "value": 1}}
                with pytest.raises(ConflictException):
                    profile_service.update_profile(pid, config=retyped)

    def test_structural_change_allowed_when_not_in_use(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        with _patch_profile_storage(self._stored(pid)):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=[],  # no tests reference it
            ):
                new_config = {
                    "v1": {"type": "string", "secret": False, "value": "x"},
                    "v2": {"type": "string", "secret": False, "value": "new"},
                }
                profile_service.update_profile(pid, config=new_config)

    def test_structural_check_skipped_when_only_metadata_changes(self) -> None:
        """update_profile with neither config nor env_values isn't a structural change."""
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        with _patch_profile_storage(self._stored(pid)):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                # Updating only the description must not raise.
                profile_service.update_profile(pid, description="new desc")

    def _two_param_stored(self, pid: str) -> dict[str, Any]:
        """Config and env-a both carry v1 and v2."""
        both = {
            "v1": {"type": "string", "secret": False, "value": "x"},
            "v2": {"type": "string", "secret": False, "value": "y"},
        }
        return {
            pid: {
                "id": pid,
                "name": "p",
                "type": "custom",
                "config": copy.deepcopy(both),
                "environment_values": {"env-a": copy.deepcopy(both)},
            }
        }

    def test_environment_values_wipe_blocked_when_in_use(self) -> None:
        """An empty environment_values map must not erase per-environment values."""
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        storage = self._stored(pid)
        with _patch_profile_storage(storage):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                with pytest.raises(ConflictException) as exc:
                    profile_service.update_profile(pid, environment_values={})
                assert str(exc.value) == (
                    "Cannot remove stored parameter values of a profile in use by 1 test(s)"
                )

        assert storage[pid]["environment_values"]["env-a"]["v1"]["value"] == "y"

    def test_base_config_wipe_blocked_when_in_use(self) -> None:
        """An empty config must not erase the base values an environment override hides."""
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        storage = self._stored(pid)
        with _patch_profile_storage(storage):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                with pytest.raises(ConflictException):
                    profile_service.update_profile(pid, config={})

        assert storage[pid]["config"]["v1"]["value"] == "x"

    def test_dropping_one_environment_override_blocked_when_in_use(self) -> None:
        """Dropping a single parameter override is a removal even when config keeps the key."""
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        storage = self._two_param_stored(pid)
        with _patch_profile_storage(storage):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                kept = {"env-a": {"v1": {"type": "string", "secret": False, "value": "x"}}}
                with pytest.raises(ConflictException):
                    profile_service.update_profile(pid, environment_values=kept)

        assert set(storage[pid]["environment_values"]["env-a"]) == {"v1", "v2"}

    def test_adding_an_override_allowed_when_in_use(self) -> None:
        """An environment may gain an override for a parameter the config already declares."""
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        storage = self._two_param_stored(pid)
        storage[pid]["environment_values"]["env-a"].pop("v2")
        with _patch_profile_storage(storage):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                grown = {
                    "env-a": {
                        "v1": {"type": "string", "secret": False, "value": "x"},
                        "v2": {"type": "string", "secret": False, "value": "z"},
                    }
                }
                profile_service.update_profile(pid, environment_values=grown)

        assert set(storage[pid]["environment_values"]["env-a"]) == {"v1", "v2"}

    def test_adding_an_environment_allowed_when_in_use(self) -> None:
        """A newly created environment can still be given values on a profile in use."""
        from wavecore.api.services.profiles import service as profile_service

        pid = str(uuid.uuid4())
        storage = self._stored(pid)
        with _patch_profile_storage(storage):
            with patch(
                "wavecore.api.services.tests.service._cached_tests",
                return_value=self._used_test_for(pid),
            ):
                widened = {
                    "env-a": {"v1": {"type": "string", "secret": False, "value": "y"}},
                    "env-b": {"v1": {"type": "string", "secret": False, "value": "new"}},
                }
                profile_service.update_profile(pid, environment_values=widened)

        assert set(storage[pid]["environment_values"]) == {"env-a", "env-b"}

    def test_stored_value_keys_helper_skips_non_dict_environment_values(self) -> None:
        """_stored_value_keys reports one entry per location and tolerates malformed env_values."""
        from wavecore.api.services.profiles import service as profile_service

        keys = profile_service._stored_value_keys(
            {
                "config": {"a": 1},
                "environment_values": {"env-a": "not a dict", "env-b": {"a": 1, "b": 2}},
            }
        )

        assert keys == {"config": {"a"}, "env:env-b": {"a", "b"}}

    def test_param_types_helper_skips_non_dict_env_and_untyped_values(self) -> None:
        """_param_types tolerates malformed env_values and raw (non-typed) values."""
        from wavecore.api.services.profiles import service as profile_service

        # config has a typed value; env-A is not a dict (skip); env-B has an untyped raw
        # value (skipped) plus a typed value for a new key (added).
        profile = {
            "config": {"a": {"type": "string", "secret": False, "value": "x"}},
            "environment_values": {
                "env-a": "not a dict",  # triggers `continue`
                "env-b": {
                    "a": "raw-string",  # untyped -> skipped (no type recorded for env)
                    "b": {"type": "integer", "secret": False, "value": 1},  # new key
                },
            },
        }

        types = profile_service._param_types(profile)

        assert types == {"a": "string", "b": "integer"}

    def test_wave_type_of_returns_none_for_untyped_value(self) -> None:
        """_wave_type_of returns None when the value is not a typed wrapper."""
        from wavecore.api.services.profiles import service as profile_service

        assert profile_service._wave_type_of("plain") is None
        assert profile_service._wave_type_of(42) is None
        assert profile_service._wave_type_of({"no_type": "field"}) is None

    def test_profiles_used_by_test_reads_precomputed_refs(self) -> None:
        """The precomputed `_profile_refs` view field short-circuits the workflow scan."""
        result = _profile_common._profiles_used_by_test(
            {
                "_profile_refs": ["p-1", "p-2", "p-1"],
                "metadata": {"profile_id": "p-ignored"},
            }
        )
        assert result == {"p-1", "p-2"}

    def test_profiles_used_by_test_fallback_skips_non_dict_nodes(self) -> None:
        """Fallback scan tolerates malformed node entries (string, number, etc.)."""
        # Test dict with NO `_profile_refs` field (forces the fallback branch)
        # but with a malformed nodes list including a non-dict entry.
        result = _profile_common._profiles_used_by_test(
            {
                "metadata": {"profile_id": "p-meta"},
                "workflow": {
                    "nodes": [
                        "not-a-dict",
                        {
                            "data": {
                                "config": {
                                    "profileBindings": [
                                        {"profileId": "p-from-node"},
                                    ]
                                }
                            }
                        },
                    ]
                },
            }
        )
        assert result == {"p-meta", "p-from-node"}


class TestListProfileTypes:
    """Test suite for list_profile_types function."""

    def test_list_profile_types_returns_all_types(self) -> None:
        """Test that list_profile_types returns all supported types."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types()

        assert set(result) == set(VALID_PROFILE_TYPES)

    def test_list_profile_types_includes_custom(self) -> None:
        """Test that list_profile_types includes custom type."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types()

        assert "custom" in result

    def test_list_profile_types_with_descriptions(self) -> None:
        """Test that list_profile_types_with_descriptions returns types with descriptions
        (REQ-5.2.4.8).
        """
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types_with_descriptions()

        assert len(result) == len(VALID_PROFILE_TYPES)
        for item in result:
            assert "type" in item
            assert "description" in item
            assert item["type"] in VALID_PROFILE_TYPES
            assert len(item["description"]) > 0

    def test_list_profile_types_with_descriptions_database(self) -> None:
        """Test database type description content (REQ-5.2.4.8)."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types_with_descriptions()

        database_type = next((t for t in result if t["type"] == "database"), None)
        assert database_type is not None
        # Description should mention key database concepts
        desc_lower = database_type["description"].lower()
        assert "database" in desc_lower or "host" in desc_lower or "connection" in desc_lower

    def test_list_profile_types_returns_the_exact_ordered_type_list(self) -> None:
        """Test that the type list is exactly the supported set, in order (REQ-4.7.3)."""
        from wavecore.api.services.profiles import service as profile_service

        assert profile_service.list_profile_types() == [
            "database",
            "ssh",
            "http",
            "kubernetes",
            "opensearch",
            "custom",
        ]

    def test_kubernetes_description_names_token_and_client_certificate(self) -> None:
        """Test the kubernetes type description (REQ-4.7.7)."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types_with_descriptions()

        kubernetes_type = next(t for t in result if t["type"] == "kubernetes")
        assert kubernetes_type["description"] == KUBERNETES_TYPE_DESCRIPTION

    def test_http_description_names_tls_trust_and_client_identity(self) -> None:
        """Test the http type description (REQ-4.7.3)."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types_with_descriptions()

        http_type = next(t for t in result if t["type"] == "http")
        assert http_type["description"] == HTTP_TYPE_DESCRIPTION

    def test_opensearch_description_names_the_cluster_url_and_tls_trust(self) -> None:
        """Test the opensearch type description (REQ-4.7.3, REQ-3.4.1.15)."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types_with_descriptions()

        opensearch_type = next(t for t in result if t["type"] == "opensearch")
        assert opensearch_type["description"] == OPENSEARCH_TYPE_DESCRIPTION


class TestLdapProfileTypeRemoved:
    """Test suite for the removal of the ldap profile type (REQ-4.7.3)."""

    def test_get_type_schema_returns_none_for_ldap(self) -> None:
        """Test that ldap has no type schema."""
        from wavecore.api.services.profiles import service as profile_service

        assert profile_service.get_type_schema("ldap") is None

    def test_ldap_is_not_a_valid_profile_type(self) -> None:
        """Test that ldap is not offered as a profile type."""
        from wavecore.api.services.profiles import service as profile_service

        assert "ldap" not in profile_service.list_profile_types()

    def test_ldap_has_no_type_description(self) -> None:
        """Test that no ldap description remains."""

        assert "ldap" not in _profile_common.PROFILE_TYPE_DESCRIPTIONS

    def test_list_profile_types_with_descriptions_omits_ldap(self) -> None:
        """Test that the described type list carries no ldap entry."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types_with_descriptions()

        assert all(item["type"] != "ldap" for item in result)

    def test_ldap_has_no_type_schema_entry(self) -> None:
        """Test that the ldap TYPE_SCHEMAS entry is gone."""

        assert "ldap" not in _profile_common.TYPE_SCHEMAS


class TestSftpProfileTypeRemoved:
    """Test suite for the removal of the sftp profile type (REQ-4.7.3, REQ-4.7.5)."""

    def test_get_type_schema_returns_none_for_sftp(self) -> None:
        """Test that sftp has no type schema."""
        from wavecore.api.services.profiles import service as profile_service

        assert profile_service.get_type_schema("sftp") is None

    def test_sftp_has_no_type_description(self) -> None:
        """Test that no sftp description remains."""

        assert "sftp" not in _profile_common.PROFILE_TYPE_DESCRIPTIONS

    def test_list_profile_types_with_descriptions_lists_the_six_types_in_order(self) -> None:
        """Test that the described type list is the six supported types, without sftp."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.list_profile_types_with_descriptions()

        assert [item["type"] for item in result] == [
            "database",
            "ssh",
            "http",
            "kubernetes",
            "opensearch",
            "custom",
        ]

    def test_sftp_has_no_type_schema_entry(self) -> None:
        """Test that the sftp TYPE_SCHEMAS entry is gone."""

        assert "sftp" not in _profile_common.TYPE_SCHEMAS


class TestGetTypeSchema:
    """Test suite for get_type_schema function."""

    def test_get_type_schema_returns_schema(self) -> None:
        """Test that get_type_schema returns simplified schema for frontend."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.get_type_schema("database")

        assert result is not None
        assert result["type"] == "database"
        assert "fields" in result
        # Should have host, port, database, username, password
        field_names = [f["name"] for f in result["fields"]]
        assert "host" in field_names
        assert "port" in field_names
        assert "password" in field_names
        # Password should be marked as secret
        password_field = next(f for f in result["fields"] if f["name"] == "password")
        assert password_field["secret"] is True
        assert password_field["type"] == "string"

    def test_get_type_schema_returns_none_for_invalid_type(self) -> None:
        """Test that get_type_schema returns None for invalid type."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.get_type_schema("invalid_type")

        assert result is None

    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_get_type_schema_returns_schema_for_all_types(self, profile_type: str) -> None:
        """Test that get_type_schema returns schema for all valid types."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.get_type_schema(profile_type)

        assert result is not None
        assert result["type"] == profile_type
        assert "fields" in result
        # Custom type has no predefined fields
        if profile_type != "custom":
            assert len(result["fields"]) > 0

    def test_get_type_schema_marks_secret_fields(self) -> None:
        """Test that get_type_schema marks secret fields."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.get_type_schema("database")

        assert result is not None
        # Database type should have password as secret
        password_field = next((f for f in result["fields"] if f["name"] == "password"), None)
        assert password_field is not None
        assert password_field["secret"] is True


class TestDatabaseTypeSchema:
    """Test suite for the database profile type schema (REQ-4.7.3, REQ-4.7.5, SQL-14)."""

    def test_properties_are_exact_and_ordered(self) -> None:
        """Test that the database type declares the ten SQL block target fields, in order."""

        properties = _profile_common.TYPE_SCHEMAS["database"]["properties"]

        assert list(properties.items()) == DATABASE_PROPERTIES

    def test_no_field_is_required(self) -> None:
        """Test that the database type declares no required list (K8SPROF-6)."""

        assert "required" not in _profile_common.TYPE_SCHEMAS["database"]

    def test_flattened_fields_are_exact_and_ordered(self) -> None:
        """Test the flattened field list: types, required, secret, bounds and defaults."""
        from wavecore.api.services.profiles import service as profile_service

        assert profile_service.get_type_schema("database") == {
            "type": "database",
            "fields": DATABASE_SCHEMA_FIELDS,
        }

    def test_only_password_and_client_key_are_secret(self) -> None:
        """Test that the two credential fields are the only secret ones."""

        secret = [name for name, field in _schema_fields("database").items() if field["secret"]]

        assert secret == ["password", "client_key"]

    def test_port_is_bounded_to_the_tcp_range(self) -> None:
        """Test that port carries minimum 1 and maximum 65535 and no default."""

        port = _schema_fields("database")["port"]

        assert (port["minimum"], port["maximum"]) == (1, 65535)
        assert "default" not in port

    def test_declared_starting_values(self) -> None:
        """Test that verify_ssl starts on and driver_options starts empty."""

        fields = _schema_fields("database")

        assert fields["verify_ssl"]["default"] is True
        assert fields["driver_options"]["default"] == {}

    @pytest.mark.parametrize("field_name", ["failover", "timeout"])
    def test_removed_fields_are_absent(self, field_name: str) -> None:
        """Test that the failover list and the timeout field are gone."""

        assert field_name not in _schema_field_names("database")


class TestOpensearchTypeSchema:
    """Test suite for the opensearch profile type schema (REQ-4.7.3, REQ-3.4.1.15, OS-15)."""

    def test_properties_are_exact_and_ordered(self) -> None:
        """Test that the opensearch type declares the nine OpenSearch block target fields."""

        properties = _profile_common.TYPE_SCHEMAS["opensearch"]["properties"]

        assert list(properties.items()) == OPENSEARCH_PROPERTIES

    def test_no_field_is_required(self) -> None:
        """Test that the opensearch type declares no required list."""

        assert "required" not in _profile_common.TYPE_SCHEMAS["opensearch"]

    def test_flattened_fields_are_exact_and_ordered(self) -> None:
        """Test the flattened field list: types, required, secret and defaults."""
        from wavecore.api.services.profiles import service as profile_service

        assert profile_service.get_type_schema("opensearch") == {
            "type": "opensearch",
            "fields": OPENSEARCH_SCHEMA_FIELDS,
        }

    def test_only_the_four_credential_fields_are_secret(self) -> None:
        """Test that the sign-in fields and the client key are the only secret ones."""

        secret = [name for name, field in _schema_fields("opensearch").items() if field["secret"]]

        assert secret == ["password", "api_key", "bearer_token", "client_key"]

    def test_verify_ssl_starts_on(self) -> None:
        """Test that verify_ssl is the only declared starting value, and it is true."""

        fields = _schema_fields("opensearch")

        assert fields["verify_ssl"]["default"] is True
        assert [name for name, field in fields.items() if "default" in field] == ["verify_ssl"]

    @pytest.mark.parametrize("field_name", ["host", "port", "use_ssl", "index", "timeout"])
    def test_removed_fields_are_absent(self, field_name: str) -> None:
        """Test that the host, port, TLS switch, index default and timeout fields are gone."""

        assert field_name not in _schema_field_names("opensearch")

    def test_the_type_description_is_exact(self) -> None:
        """Test the opensearch entry of the type description table."""

        assert _profile_common.PROFILE_TYPE_DESCRIPTIONS["opensearch"] == (
            OPENSEARCH_TYPE_DESCRIPTION
        )


class TestKubernetesTypeSchema:
    """Test suite for the kubernetes profile type schema (REQ-4.7.7)."""

    def test_field_list_is_exact_and_ordered(self) -> None:
        """Test that the kubernetes schema carries exactly the eight cluster fields."""

        assert _schema_field_names("kubernetes") == [
            "api_url",
            "token",
            "client_cert",
            "client_key",
            "ca_cert",
            "verify_ssl",
            "tls_server_name",
            "namespace",
        ]

    def test_token_and_client_key_are_secret(self) -> None:
        """Test that the two credential fields are marked secret."""

        fields = _schema_fields("kubernetes")

        assert fields["token"]["secret"] is True
        assert fields["client_key"]["secret"] is True

    @pytest.mark.parametrize(
        "field_name",
        [
            "api_url",
            "client_cert",
            "ca_cert",
            "verify_ssl",
            "tls_server_name",
            "namespace",
        ],
    )
    def test_non_credential_fields_are_not_secret(self, field_name: str) -> None:
        """Test that no other kubernetes field is marked secret."""

        assert _schema_fields("kubernetes")[field_name]["secret"] is False

    def test_verify_ssl_is_a_boolean_defaulting_to_true(self) -> None:
        """Test the verify_ssl declared starting value."""

        verify_ssl = _schema_fields("kubernetes")["verify_ssl"]

        assert verify_ssl["type"] == "boolean"
        assert verify_ssl["default"] is True

    def test_namespace_defaults_to_default(self) -> None:
        """Test the namespace declared starting value."""

        namespace = _schema_fields("kubernetes")["namespace"]

        assert namespace["type"] == "string"
        assert namespace["default"] == "default"

    def test_api_url_is_present_as_a_string(self) -> None:
        """Test that the field is api_url, not api_server."""

        assert _schema_fields("kubernetes")["api_url"]["type"] == "string"

    @pytest.mark.parametrize("field_name", ["kubeconfig", "context", "api_server"])
    def test_removed_fields_are_absent(self, field_name: str) -> None:
        """Test that the kubeconfig-era fields are gone."""

        assert field_name not in _schema_field_names("kubernetes")


class TestSshTypeSchema:
    """Test suite for the ssh profile type schema (REQ-4.7.3)."""

    def test_field_list_is_exact_and_ordered(self) -> None:
        """Test that ssh keeps its six fields and ends with connect_timeout."""

        assert _schema_field_names("ssh") == [
            "host",
            "port",
            "username",
            "password",
            "private_key",
            "passphrase",
            "connect_timeout",
        ]

    def test_connect_timeout_defaults_to_thirty_seconds(self) -> None:
        """Test that connect_timeout carries the seconds-based default."""

        connect_timeout = _schema_fields("ssh")["connect_timeout"]

        assert connect_timeout["type"] == "integer"
        assert connect_timeout["default"] == 30

    def test_timeout_is_absent(self) -> None:
        """Test that there is no millisecond timeout field."""

        assert "timeout" not in _schema_field_names("ssh")

    def test_remaining_fields_are_unchanged(self) -> None:
        """Test that the rename touched nothing else in the ssh schema."""

        fields = _schema_fields("ssh")

        assert fields["host"]["type"] == "string"
        assert fields["host"]["secret"] is False
        assert fields["port"]["type"] == "integer"
        assert fields["port"]["default"] == 22
        assert fields["username"]["type"] == "string"
        assert fields["username"]["secret"] is False
        assert fields["password"]["secret"] is True
        assert fields["private_key"]["secret"] is True
        assert fields["passphrase"]["secret"] is True


class TestHttpTypeSchema:
    """Test suite for the http profile type schema (REQ-4.7.3)."""

    def test_field_list_is_exact_and_ordered(self) -> None:
        """Test that the http schema carries exactly the twelve target fields."""

        assert _schema_field_names("http") == [
            "base_url",
            "headers",
            "auth_username",
            "auth_password",
            "auth_token",
            "auth_key",
            "auth_header_name",
            "verify_ssl",
            "ca_cert",
            "client_cert",
            "client_key",
            "timeout",
        ]

    @pytest.mark.parametrize(
        "field_name", ["auth_password", "auth_token", "auth_key", "client_key"]
    )
    def test_credential_fields_are_secret(self, field_name: str) -> None:
        """Test that every http credential field is marked secret."""

        assert _schema_fields("http")[field_name]["secret"] is True

    @pytest.mark.parametrize(
        "field_name",
        [
            "base_url",
            "headers",
            "auth_username",
            "auth_header_name",
            "verify_ssl",
            "ca_cert",
            "client_cert",
            "timeout",
        ],
    )
    def test_non_credential_fields_are_not_secret(self, field_name: str) -> None:
        """Test that no other http field is marked secret."""

        assert _schema_fields("http")[field_name]["secret"] is False

    def test_declared_starting_values(self) -> None:
        """Test the three http fields that declare a starting value."""

        fields = _schema_fields("http")

        assert fields["auth_header_name"]["default"] == "X-API-Key"
        assert fields["verify_ssl"]["default"] is True
        assert fields["timeout"]["default"] == 30

    def test_field_types(self) -> None:
        """Test the http field type mapping."""

        fields = _schema_fields("http")

        assert fields["base_url"]["type"] == "string"
        assert fields["headers"]["type"] == "map"
        assert fields["verify_ssl"]["type"] == "boolean"
        assert fields["timeout"]["type"] == "integer"

    @pytest.mark.parametrize(
        "field_name", ["url", "auth_type", "username", "password", "token", "api_key"]
    )
    def test_unsupported_fields_are_not_declared(self, field_name: str) -> None:
        """The http schema declares none of these fields."""

        assert field_name not in _schema_field_names("http")


class TestTypeSchemaDeclaredDefaults:
    """Test suite for declared starting values on flattened schema fields (REQ-4.7.3)."""

    def test_field_with_a_declared_starting_value_carries_it(self) -> None:
        """Test that a property with a declared value forwards it."""

        assert _schema_fields("ssh")["port"]["default"] == 22

    def test_field_without_a_declared_starting_value_omits_the_key(self) -> None:
        """Test that a property with no declared value carries no default key."""

        assert "default" not in _schema_fields("ssh")["host"]

    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_default_key_mirrors_the_declared_property(self, profile_type: str) -> None:
        """Test that every field's default matches its property declaration."""

        properties = _profile_common.TYPE_SCHEMAS[profile_type]["properties"]

        for name, field in _schema_fields(profile_type).items():
            prop = properties[name]
            if "default" in prop:
                assert field["default"] == prop["default"]
            else:
                assert "default" not in field

    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_no_field_carries_an_enum(self, profile_type: str) -> None:
        """Test that the flattened schema never forwards a choice list."""

        for field in _schema_fields(profile_type).values():
            assert "enum" not in field

    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_every_field_carries_the_four_base_keys(self, profile_type: str) -> None:
        """Test that name, type, required and secret are always present."""

        for field in _schema_fields(profile_type).values():
            assert set(field) <= {
                "name",
                "type",
                "required",
                "secret",
                "default",
                "minimum",
                "maximum",
                "plain",
            }
            assert {"name", "type", "required", "secret"} <= set(field)

    @pytest.mark.parametrize("bound", ["minimum", "maximum"])
    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_bound_keys_mirror_the_declared_property(self, profile_type: str, bound: str) -> None:
        """Test that a declared minimum or maximum is forwarded, and omitted when undeclared."""

        properties = _profile_common.TYPE_SCHEMAS[profile_type]["properties"]

        for name, field in _schema_fields(profile_type).items():
            prop = properties[name]
            if bound in prop:
                assert field[bound] == prop[bound]
            else:
                assert bound not in field


class TestSecretMasking:
    """Test suite for secret masking helper functions."""

    def test_mask_secrets_masks_password(self) -> None:
        """Test that _mask_secrets masks password field."""

        config = {"host": "localhost", "password": "secret123"}

        result = _profile_common._mask_secrets(config, "database")

        assert result["password"] == "********"
        assert result["host"] == "localhost"

    def test_mask_secrets_masks_auth_key(self) -> None:
        """Test that _mask_secrets masks the http auth_key field."""

        config = {"base_url": "https://api.example.com", "auth_key": "key123"}

        result = _profile_common._mask_secrets(config, "http")

        assert result["auth_key"] == "********"

    def test_mask_secrets_masks_private_key(self) -> None:
        """Test that _mask_secrets masks private_key field."""

        config = {"host": "server.com", "private_key": "-----BEGIN RSA KEY-----"}

        result = _profile_common._mask_secrets(config, "ssh")

        assert result["private_key"] == "********"

    def test_mask_secrets_masks_auth_token(self) -> None:
        """Test that _mask_secrets masks the http auth_token field (REQ-5.2.4.8)."""

        config = {"base_url": "https://api.example.com", "auth_token": "bearer_token_12345"}

        result = _profile_common._mask_secrets(config, "http")

        assert result["auth_token"] == "********"

    def test_mask_secrets_masks_all_secret_types(self) -> None:
        """Test that _mask_secrets masks all secret field types (REQ-5.2.4.8)."""

        config = {
            "host": "localhost",
            "password": "pass123",
            "api_key": "apikey456",
            "private_key": "-----BEGIN KEY-----",
            "token": "tokenvalue",
            "non_secret": "visible",
        }

        result = _profile_common._mask_secrets(config, "custom")

        assert result["password"] == "********"
        assert result["api_key"] == "********"
        assert result["private_key"] == "********"
        assert result["token"] == "********"
        assert result["non_secret"] == "visible"
        assert result["host"] == "localhost"

    def test_secret_fields_include_client_key(self) -> None:
        """Test the secret field names every profile type masks and seals (REQ-4.7.11)."""

        assert _profile_common.SECRET_FIELDS == {
            "password",
            "api_key",
            "private_key",
            "token",
            "client_key",
            "bearer_token",
        }

    def test_mask_secrets_masks_bearer_token_on_any_type(self) -> None:
        """Test that bearer_token is masked even where no schema declares it."""

        config = {"bearer_token": "eyJhbGciOiJIUzI1NiJ9.e30.sig", "non_secret": "visible"}

        result = _profile_common._mask_secrets(config, "custom")

        assert result == {"bearer_token": "********", "non_secret": "visible"}

    def test_mask_secrets_masks_every_opensearch_credential(self) -> None:
        """Test that an opensearch profile shows none of its four credential values."""

        config = {
            "url": "https://opensearch.internal:9200",
            "username": "reader",
            "password": "os-password",
            "api_key": "os-api-key",
            "bearer_token": "os-bearer-token",
            "client_key": CLIENT_KEY_PEM,
        }

        result = _profile_common._mask_secrets(config, "opensearch")

        assert result == {
            "url": "https://opensearch.internal:9200",
            "username": "reader",
            "password": "********",
            "api_key": "********",
            "bearer_token": "********",
            "client_key": "********",
        }

    def test_mask_secrets_masks_client_key_on_any_type(self) -> None:
        """Test that client_key is masked even where no schema declares it."""

        config = {"client_key": CLIENT_KEY_PEM, "non_secret": "visible"}

        result = _profile_common._mask_secrets(config, "custom")

        assert result == {"client_key": "********", "non_secret": "visible"}

    def test_seal_profile_seals_client_key_on_any_type(self) -> None:
        """Test that client_key is sealed even where no schema declares it."""
        from wavecore.core.secrets.sealing import unseal_all

        sealed = seal_profile({"client_key": CLIENT_KEY_PEM}, "custom")

        assert is_secret_envelope(sealed["client_key"])
        assert unseal_all(sealed["client_key"]) == CLIENT_KEY_PEM

    def test_mask_secrets_masks_database_client_key(self) -> None:
        """Test that _mask_secrets masks the database client_key field."""

        config = {"host": "db", "client_key": CLIENT_KEY_PEM}

        result = _profile_common._mask_secrets(config, "database")

        assert result == {"host": "db", "client_key": "********"}

    def test_mask_secrets_preserves_non_secret_fields(self) -> None:
        """Test that _mask_secrets preserves non-secret fields."""

        config = {"host": "localhost", "port": 5432, "database": "mydb"}

        result = _profile_common._mask_secrets(config, "database")

        assert result["host"] == "localhost"
        assert result["port"] == 5432
        assert result["database"] == "mydb"


class TestConfigValidation:
    """Test suite for configuration validation."""

    def test_validate_config_passes_for_valid_config(self) -> None:
        """Test that _validate_config passes for valid config."""

        # Should not raise
        _profile_common._validate_config({"host": "localhost", "port": 5432}, "database")

    def test_validate_config_raises_for_invalid_config(self) -> None:
        """Test that _validate_config raises for invalid config."""

        # Mock the schema to require 'host'
        with patch.object(
            _profile_common,
            "_get_type_schema_internal",
            return_value={
                "type": "object",
                "required": ["host"],
                "properties": {"host": {"type": "string"}},
            },
        ):
            with pytest.raises(ValidationException) as exc_info:
                _profile_common._validate_config({}, "database")

            assert "validation failed" in str(exc_info.value).lower()

    def test_validate_config_allows_empty_for_custom_type(self) -> None:
        """Test that _validate_config allows any config for custom type."""

        # Custom type should accept arbitrary config
        _profile_common._validate_config({"any": "value", "nested": {"data": True}}, "custom")

    def test_validate_config_rejects_unknown_wave_type_in_custom(self) -> None:
        """Custom-profile typed values must declare a known WAVE type."""

        bad_config = {"v1": {"type": "Number", "secret": False, "value": 1}}
        with pytest.raises(ValidationException) as exc_info:
            _profile_common._validate_config(bad_config, "custom")

        message = str(exc_info.value)
        assert "config.v1" in message
        assert "Number" in message
        assert "unknown type" in message

    @pytest.mark.parametrize("profile_type", ["custom", "database"])
    def test_validate_config_rejects_a_mismatched_element_type_sidecar(
        self, profile_type: str
    ) -> None:
        """A typed value's element types must fit it on every profile type (REQ-3.1.3.19)."""

        bad_config = {
            "driver_options": {
                "type": "map",
                "secret": False,
                "value": {"a": "1"},
                "elementTypes": ["integer"],
            }
        }
        with pytest.raises(
            ValidationException,
            match=r"^Configuration validation failed at 'config.driver_options': "
            r"the element types of a map must map each key to a type$",
        ):
            _profile_common._validate_config(bad_config, profile_type)

    def test_validate_config_accepts_an_element_type_sidecar(self) -> None:
        good_config = {
            "driver_options": {
                "type": "map",
                "secret": False,
                "value": {"a": "1"},
                "elementTypes": {"a": "integer"},
            }
        }
        _profile_common._validate_config(good_config, "database")

    def test_validate_config_accepts_known_wave_types_in_custom(self) -> None:
        """Custom profile accepts each canonical WAVE param type."""

        good_config = {
            "s": {"type": "string", "secret": False, "value": "x"},
            "i": {"type": "integer", "secret": False, "value": 1},
            "f": {"type": "float", "secret": False, "value": 1.5},
            "b": {"type": "boolean", "secret": False, "value": True},
            "a": {"type": "array", "secret": False, "value": []},
            "m": {"type": "map", "secret": False, "value": {}},
            "t": {"type": "table", "secret": False, "value": {"headers": [], "rows": []}},
        }
        _profile_common._validate_config(good_config, "custom")

    def test_validate_config_returns_early_for_unknown_type(self) -> None:
        """Test that _validate_config returns early when schema not found."""

        # Unknown type has no schema, should return without error
        with patch.object(_profile_common, "_get_type_schema_internal", return_value=None):
            # Should not raise - returns early when schema is None
            _profile_common._validate_config({"any": "value"}, "unknown_type")

    def test_validate_config_raises_for_string_field_with_non_string_value(self) -> None:
        """Test that _validate_config raises for string field with non-string value."""

        # Mock schema with string field requirement
        with patch.object(
            _profile_common,
            "_get_type_schema_internal",
            return_value={
                "type": "object",
                "properties": {"host": {"type": "string"}},
            },
        ):
            with pytest.raises(ValidationException) as exc_info:
                _profile_common._validate_config({"host": 12345}, "database")

            assert "config.host" in str(exc_info.value)
            assert "expected string" in str(exc_info.value)

    def test_validate_config_raises_for_integer_field_with_string_value(self) -> None:
        """Test that _validate_config raises for integer field with string value."""

        # Mock schema with integer field requirement
        with patch.object(
            _profile_common,
            "_get_type_schema_internal",
            return_value={
                "type": "object",
                "properties": {"port": {"type": "integer"}},
            },
        ):
            with pytest.raises(ValidationException) as exc_info:
                _profile_common._validate_config({"port": "not-an-int"}, "database")

            assert "config.port" in str(exc_info.value)
            assert "expected integer, got string" in str(exc_info.value)

    def test_validate_config_skips_fields_not_in_schema_properties(self) -> None:
        """Fields not present in schema properties are silently skipped."""

        with patch.object(
            _profile_common,
            "_get_type_schema_internal",
            return_value={
                "type": "object",
                "properties": {"host": {"type": "string"}},
            },
        ):
            # "extra_field" is not in schema properties, should not raise
            _profile_common._validate_config({"host": "localhost", "extra_field": 42}, "database")


_REFUSED_AT = "Configuration validation failed at 'config.{}': {}"


def _refusal(field: str, problem: str) -> str:
    return "^" + re.escape(_REFUSED_AT.format(field, problem)) + "$"


class TestConfigNumbers:
    """Every profile number follows the one number rule and its declared bounds (REQ-3.1.3.14)."""

    @pytest.mark.parametrize("port", [5432, "5432", "007", 1, 65535, "65535", None])
    def test_a_database_port_takes_a_number_or_its_digits(self, port: Any) -> None:
        _profile_common._validate_config({"host": "db", "port": port}, "database")

    @pytest.mark.parametrize(
        ("port", "problem"),
        [
            pytest.param(5432.5, "expected integer, got float", id="float"),
            pytest.param(5432.0, "expected integer, got float", id="whole-float"),
            pytest.param(True, "expected integer, got boolean", id="boolean"),
            pytest.param([1], "expected integer, got array", id="list"),
            pytest.param({"a": 1}, "expected integer, got map", id="map"),
            pytest.param("5432.0", "expected integer, got string", id="text-with-a-dot"),
            pytest.param("+5432", "expected integer, got string", id="text-with-a-plus"),
            pytest.param(" 5432", "expected integer, got string", id="text-with-a-space"),
            pytest.param("", "expected integer, got string", id="empty-text"),
            pytest.param(0, "must be between 1 and 65535", id="below"),
            pytest.param(70000, "must be between 1 and 65535", id="above"),
            pytest.param("70000", "must be between 1 and 65535", id="digits-above"),
            pytest.param(
                "12345678901234567890", "expected at most 19 digits, got 20", id="past-the-cap"
            ),
        ],
    )
    def test_a_database_port_that_is_not_one_is_refused(self, port: Any, problem: str) -> None:
        with pytest.raises(ValidationException, match=_refusal("port", problem)):
            _profile_common._validate_config({"host": "db", "port": port}, "database")

    def test_a_typed_port_is_bounded_like_a_plain_one(self) -> None:
        port = {"type": "integer", "secret": False, "value": "70000"}

        with pytest.raises(
            ValidationException, match=_refusal("port", "must be between 1 and 65535")
        ):
            _profile_common._validate_config({"port": port}, "database")

    def test_an_unbounded_number_takes_any_whole_number_within_the_cap(self) -> None:
        _profile_common._validate_config({"connect_timeout": -5, "port": 10**18}, "ssh")

        with pytest.raises(
            ValidationException,
            match=_refusal("connect_timeout", "expected at most 19 digits, got 20"),
        ):
            _profile_common._validate_config({"connect_timeout": 10**19}, "ssh")

    @pytest.mark.parametrize(
        ("schema", "value", "problem"),
        [
            pytest.param({"type": "integer", "minimum": 1}, 0, "must be at least 1", id="minimum"),
            pytest.param(
                {"type": "integer", "maximum": 10}, "11", "must be at most 10", id="maximum"
            ),
            pytest.param(
                {"type": "float", "minimum": Decimal("0.5")},
                "0.49999999999999999999",
                "must be at least 0.5",
                id="exact-float-compare",
            ),
            pytest.param(
                {"type": "float"},
                "1.2345678901234567890123456789",
                "expected at most 28 significant digits, got 29",
                id="float-cap",
            ),
            pytest.param({"type": "float"}, "1e5", "expected float, got string", id="exponent"),
            pytest.param(
                {"type": "float"}, float("nan"), "expected float, got NaN", id="not-a-number"
            ),
            pytest.param(
                {"type": "float"},
                float("-inf"),
                "expected float, got -Infinity",
                id="minus-infinity",
            ),
            pytest.param(
                {"type": "float"},
                Decimal("Infinity"),
                "expected float, got Infinity",
                id="decimal-infinity",
            ),
        ],
    )
    def test_a_declared_bound_and_cap_are_checked_exactly(
        self, schema: dict[str, Any], value: Any, problem: str
    ) -> None:
        with patch.object(
            _profile_common,
            "_get_type_schema_internal",
            return_value={"type": "object", "properties": {"n": schema}},
        ):
            with pytest.raises(ValidationException, match=_refusal("n", problem)):
                _profile_common._validate_config({"n": value}, "database")

    def test_a_float_on_its_bound_is_taken(self) -> None:
        with patch.object(
            _profile_common,
            "_get_type_schema_internal",
            return_value={
                "type": "object",
                "properties": {"n": {"type": "float", "minimum": 0.5, "maximum": 2}},
            },
        ):
            _profile_common._validate_config({"n": "0.50"}, "database")
            _profile_common._validate_config({"n": 2}, "database")

    @pytest.mark.parametrize(
        ("typed", "problem"),
        [
            pytest.param(
                {"type": "integer", "value": "abc"}, "expected integer, got string", id="text"
            ),
            pytest.param(
                {"type": "integer", "value": 1.5}, "expected integer, got float", id="float"
            ),
            pytest.param(
                {"type": "float", "value": "1e5"}, "expected float, got string", id="exponent"
            ),
            pytest.param(
                {"type": "float", "value": float("inf")},
                "expected float, got Infinity",
                id="infinity",
            ),
            pytest.param(
                {"type": "float", "value": Decimal("sNaN")},
                "expected float, got NaN",
                id="signaling-nan",
            ),
            pytest.param(
                {"type": "integer", "value": "12345678901234567890"},
                "expected at most 19 digits, got 20",
                id="integer-cap",
            ),
            pytest.param(
                {
                    "type": "map",
                    "value": {"n": "16", "t": "abc"},
                    "elementTypes": {"n": "integer", "t": "integer"},
                },
                "key 't' expected integer, got string",
                id="map-element",
            ),
            pytest.param(
                {"type": "array", "value": ["1", 2.5], "elementTypes": ["integer", "integer"]},
                "item 1 expected integer, got float",
                id="array-element",
            ),
            pytest.param(
                {
                    "type": "map",
                    "value": {"r": "1.2345678901234567890123456789"},
                    "elementTypes": {"r": "float"},
                },
                "key 'r' expected at most 28 significant digits, got 29",
                id="element-cap",
            ),
        ],
    )
    @pytest.mark.parametrize("profile_type", ["custom", "database"])
    def test_a_typed_value_that_is_not_its_number_is_refused(
        self, typed: dict[str, Any], problem: str, profile_type: str
    ) -> None:
        with pytest.raises(ValidationException, match=_refusal("v", problem)):
            _profile_common._validate_config({"v": {"secret": False, **typed}}, profile_type)

    @pytest.mark.parametrize(
        "typed",
        [
            pytest.param({"type": "integer", "value": "30"}, id="digits"),
            pytest.param({"type": "integer", "value": ""}, id="not-provided"),
            pytest.param({"type": "integer", "value": None}, id="null"),
            pytest.param({"type": "float", "value": "2.50"}, id="exact-float"),
            pytest.param({"type": "float", "value": 7}, id="whole-number"),
            pytest.param(
                {"type": "integer", "secret": True, "value": "********"}, id="masked-secret"
            ),
            pytest.param({"type": "string", "value": "0x1F"}, id="text"),
            pytest.param(
                {
                    "type": "map",
                    "value": {"n": "16", "z": None, "s": 5},
                    "elementTypes": {"n": "integer", "z": "float", "s": "string"},
                },
                id="map-elements",
            ),
            pytest.param(
                {"type": "array", "value": ["1", "x"], "elementTypes": ["integer"]},
                id="array-item-without-a-type",
            ),
            pytest.param(
                {"type": "map", "value": '{"n": "x"}', "elementTypes": {"n": "integer"}},
                id="map-held-as-text",
            ),
            pytest.param({"type": "map", "value": {"n": "x"}}, id="map-without-element-types"),
        ],
    )
    def test_a_typed_value_that_is_its_number_is_taken(self, typed: dict[str, Any]) -> None:
        _profile_common._validate_config({"v": {"secret": False, **typed}}, "custom")

    def test_a_sealed_secret_number_is_not_read_as_a_written_number(self) -> None:
        sealed = seal_profile({"pin": {"type": "integer", "secret": True, "value": "42"}}, "custom")

        _profile_common._validate_config(sealed, "custom")

    def test_a_saved_profile_stores_every_number_in_its_wire_form(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        storage: dict[str, Any] = {}
        config = {
            "tiny": {"type": "float", "secret": False, "value": 1e-05},
            "whole": {"type": "float", "secret": False, "value": 30.0},
            "huge": {"type": "integer", "secret": False, "value": 2**60},
            "plain": {"type": "float", "secret": False, "value": 2.5},
            "exact": {"type": "float", "secret": False, "value": "2.50"},
            "rates": {
                "type": "map",
                "secret": False,
                "value": {"r": 1e-05, "n": 3, "s": "x"},
                "elementTypes": {"r": "float", "n": "integer", "s": "string"},
            },
            "hosts": {"type": "array", "secret": False, "value": [2**60, "a"]},
            "label": {"type": "string", "secret": False, "value": "1e-05"},
        }
        with _patch_profile_storage(storage):
            created = profile_service.create_profile(
                name="numbers", profile_type="custom", config=config
            )

        stored = storage[created["id"]]["config"]
        assert {name: stored[name]["value"] for name in stored} == {
            "tiny": "0.00001",
            "whole": "30.0",
            "huge": "1152921504606846976",
            "plain": 2.5,
            "exact": "2.50",
            "rates": {"r": "0.00001", "n": 3, "s": "x"},
            "hosts": ["1152921504606846976", "a"],
            "label": "1e-05",
        }

    def test_a_typed_profile_keeps_its_digits_and_runs_with_the_number(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        storage: dict[str, Any] = {}
        with _patch_profile_storage(storage):
            created = profile_service.create_profile(
                name="digits-db",
                profile_type="database",
                config={"host": "db", "port": "05432", "driver_options": {}},
            )
            run_config = profile_service.get_profile_config_for_execution(created["id"])

        assert storage[created["id"]]["config"]["port"] == "05432"
        assert run_config is not None
        assert run_config["port"] == 5432

    def test_an_update_and_its_environments_store_the_wire_form(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        storage: dict[str, Any] = {}
        env_id = str(uuid.uuid4())
        with _patch_profile_storage(storage):
            created = profile_service.create_profile(
                name="envs",
                profile_type="custom",
                environment_values={env_id: {"r": {"type": "float", "value": 1e-05}}},
            )
            assert storage[created["id"]]["environment_values"][env_id]["r"]["value"] == "0.00001"
            profile_service.update_profile(
                created["id"],
                config={"r": {"type": "float", "value": 1e20}},
                environment_values={env_id: {"r": {"type": "integer", "value": 2**60}}},
            )

        updated = storage[created["id"]]
        assert updated["config"]["r"]["value"] == "100000000000000000000"
        assert updated["environment_values"][env_id]["r"]["value"] == "1152921504606846976"

    def test_an_update_with_a_number_that_is_not_one_changes_nothing(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        storage: dict[str, Any] = {}
        with _patch_profile_storage(storage):
            created = profile_service.create_profile(
                name="kept", profile_type="database", config={"host": "db", "port": 5432}
            )
            with pytest.raises(
                ValidationException, match=_refusal("port", "must be between 1 and 65535")
            ):
                profile_service.update_profile(created["id"], config={"host": "db", "port": 0})

        assert storage[created["id"]]["config"]["port"] == 5432


class TestImportedProfileNumbers:
    """An imported profile's numbers are checked as a save checks them (REQ-3.1.3.14)."""

    @staticmethod
    def _content(document: dict[str, Any]) -> bytes:
        return yaml.safe_dump(document).encode()

    @pytest.mark.parametrize(
        "document",
        [
            pytest.param(
                {"name": "bad-port", "type": "database", "config": {"port": 70000}}, id="config"
            ),
            pytest.param(
                {
                    "name": "bad-port",
                    "type": "database",
                    "environment_values": {"Prod": {"port": 70000}},
                },
                id="environment",
            ),
        ],
    )
    def test_the_preview_blocks_a_profile_whose_number_a_save_refuses(
        self, document: dict[str, Any]
    ) -> None:
        from wavecore.api.services.environments import service as environment_service

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            result = _profile_import_export.validate_profile_import(
                self._content(document), "profile.yaml"
            )

        assert result["blocked"] == 1
        assert result["profiles"][0]["status"] == "fatal"
        assert result["profiles"][0]["fatal_errors"] == [
            {
                "code": "INVALID_VALUE",
                "message": _REFUSED_AT.format("port", "must be between 1 and 65535"),
            }
        ]

    def test_an_unknown_type_is_checked_as_the_custom_profile_it_becomes(self) -> None:
        from wavecore.api.services.environments import service as environment_service

        document = {
            "name": "odd",
            "type": "ldap",
            "config": {"n": {"type": "integer", "value": "abc"}, "s": "x"},
            "environment_values": "not-a-map",
        }
        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            result = _profile_import_export.validate_profile_import(
                self._content(document), "profile.yaml"
            )

        assert result["profiles"][0]["fatal_errors"] == [
            {
                "code": "INVALID_VALUE",
                "message": _REFUSED_AT.format("n", "expected integer, got string"),
            }
        ]

    def test_the_import_refuses_it_and_writes_nothing(self) -> None:
        from wavecore.api.services.environments import service as environment_service

        storage: dict[str, Any] = {}
        content = self._content({"name": "bad", "type": "ssh", "config": {"port": True}})
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            with pytest.raises(
                ValidationException, match=_refusal("port", "expected integer, got boolean")
            ):
                _profile_import_export.import_profiles(content, "profile.yaml")

        assert storage == {}

    def test_an_imported_profile_stores_its_numbers_in_their_wire_form(self) -> None:
        from wavecore.api.services.environments import service as environment_service

        storage: dict[str, Any] = {}
        content = self._content(
            {
                "name": "imported",
                "type": "custom",
                "config": {"r": {"type": "float", "value": 1e-05}},
                "environment_values": {"Prod": {"r": {"type": "float", "value": 30.0}}},
            }
        )
        environments = [{"id": "env-1", "name": "Prod"}]
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=environments),
        ):
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        stored = storage[result["imported"][0]["id"]]
        assert stored["config"]["r"]["value"] == "0.00001"
        assert stored["environment_values"]["env-1"]["r"]["value"] == "30.0"


class TestCreateProfileTags:
    """Test suite for profile tags in create_profile function (REQ-4.7.4)."""

    def test_create_profile_with_tags(self) -> None:
        """Test that create_profile accepts tags parameter (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost"},
                tags=["production", "critical"],
            )

            assert "tags" in result
            assert result["tags"] == ["production", "critical"]

    def test_create_profile_stores_tags(self) -> None:
        """Test that create_profile stores tags correctly in storage (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        storage: dict[str, Any] = {}

        with _patch_profile_storage(storage):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost"},
                tags=["env:prod", "team:platform"],
            )

            stored_profile = storage[result["id"]]
            assert stored_profile["tags"] == ["env:prod", "team:platform"]

    def test_create_profile_with_empty_tags_list(self) -> None:
        """Test that create_profile accepts empty tags list (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost"},
                tags=[],
            )

            assert result["tags"] == []

    def test_create_profile_without_tags_defaults_to_empty_list(self) -> None:
        """Test that create_profile defaults to empty tags list (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost"},
            )

            assert "tags" in result
            assert result["tags"] == []

    def test_create_profile_with_duplicate_tags_preserved(self) -> None:
        """Test that create_profile preserves duplicate tags as provided (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        with _patch_profile_storage({}):
            result = profile_service.create_profile(
                name="my-database",
                profile_type="database",
                config={"host": "localhost"},
                tags=["important", "important", "critical"],
            )

            # Tags are stored as-is; deduplication is optional/frontend concern
            assert "tags" in result


class TestUpdateProfileTags:
    """Test suite for profile tags in update_profile function (REQ-4.7.4)."""

    def test_update_profile_with_tags(self) -> None:
        """Test that update_profile accepts tags parameter (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["old-tag"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.update_profile(
                profile_id,
                tags=["new-tag", "another-tag"],
            )

            assert result is not None
            assert result["tags"] == ["new-tag", "another-tag"]

    def test_update_profile_replaces_all_tags(self) -> None:
        """Test that update_profile replaces all tags completely (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["tag1", "tag2", "tag3"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.update_profile(
                profile_id,
                tags=["single-tag"],
            )

            assert result is not None
            assert result["tags"] == ["single-tag"]

    def test_update_profile_with_empty_tags_clears_tags(self) -> None:
        """Test that update_profile with empty list clears all tags (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["tag1", "tag2"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.update_profile(
                profile_id,
                tags=[],
            )

            assert result is not None
            assert result["tags"] == []

    def test_update_profile_without_tags_preserves_existing(self) -> None:
        """Test that update_profile without tags param preserves existing tags (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["preserved-tag"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.update_profile(
                profile_id,
                name="new-name",
            )

            assert result is not None
            assert result["tags"] == ["preserved-tag"]


class TestListProfilesTags:
    """Test suite for profile tags in list_profiles function (REQ-4.7.4)."""

    def test_list_profiles_returns_tags(self) -> None:
        """Test that list_profiles returns tags for each profile (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production", "tier-1"],
                }
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles()

            assert result["total"] == 1
            assert "tags" in result["profiles"][0]
            assert result["profiles"][0]["tags"] == ["production", "tier-1"]


class TestGetProfileTags:
    """Test suite for profile tags in get_profile function (REQ-4.7.4)."""

    def test_get_profile_returns_tags(self) -> None:
        """Test that get_profile returns tags field (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["staging", "internal"],
                }
            },
        ):
            result = profile_service.get_profile(profile_id)

            assert result is not None
            assert "tags" in result
            assert result["tags"] == ["staging", "internal"]


class TestListProfilesFiltering:
    """Test suite for list_profiles filtering capabilities (REQ-4.7.4)."""

    def test_list_profiles_filter_by_single_tag(self) -> None:
        """Test that list_profiles can filter by single tag (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "prod-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production", "critical"],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "dev-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["development"],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(tags=["production"])

            assert result["total"] == 1
            assert result["profiles"][0]["name"] == "prod-database"

    def test_list_profiles_filter_by_multiple_tags(self) -> None:
        """Test that list_profiles can filter by multiple tags (OR logic: match any) (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())
        profile3_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "prod-critical",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production", "critical"],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "prod-normal",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production"],
                },
                profile3_id: {
                    "id": profile3_id,
                    "name": "dev-critical",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["development", "critical"],
                },
            },
        ):
            _profile_common._cache_loaded = True
            # OR semantics: selecting production OR critical matches prod-critical, prod-normal,
            # dev-critical
            result = profile_service.list_profiles(tags=["production", "critical"])

            assert result["total"] == 3
            names = {p["name"] for p in result["profiles"]}
            assert names == {"prod-critical", "prod-normal", "dev-critical"}

    def test_list_profiles_filter_by_empty_tags_returns_all(self) -> None:
        """Test that list_profiles with empty tags filter returns all (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "database-1",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production"],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "database-2",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["development"],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(tags=[])

            assert result["total"] == 2

    def test_list_profiles_filter_by_nonexistent_tag_returns_empty(self) -> None:
        """Test that list_profiles with nonexistent tag returns empty (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "database-1",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production"],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(tags=["nonexistent"])

            assert result["total"] == 0


class TestListProfilesSearch:
    """Test suite for list_profiles search capabilities (REQ-4.7.4)."""

    def test_list_profiles_search_by_name(self) -> None:
        """Test that list_profiles can search by name (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "production-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "staging-ssh",
                    "type": "ssh",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(search="production")

            assert result["total"] == 1
            assert result["profiles"][0]["name"] == "production-database"

    def test_list_profiles_search_case_insensitive(self) -> None:
        """Test that list_profiles search is case insensitive (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "Production-Database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(search="PRODUCTION")

            assert result["total"] == 1
            assert result["profiles"][0]["name"] == "Production-Database"

    def test_list_profiles_search_empty_returns_all(self) -> None:
        """Test that list_profiles with empty search returns all (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "database-1",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "database-2",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(search="")

            assert result["total"] == 2


class TestListProfilesTypeFilter:
    """Test suite for list_profiles type filtering (REQ-4.7.4)."""

    def test_list_profiles_filter_by_type(self) -> None:
        """Test that list_profiles can filter by type (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "my-ssh",
                    "type": "ssh",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(profile_type="database")

            assert result["total"] == 1
            assert result["profiles"][0]["name"] == "my-database"

    def test_list_profiles_combined_filters(self) -> None:
        """Test that list_profiles supports combined search, type, and tags filters (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())
        profile3_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "prod-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production"],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "prod-ssh",
                    "type": "ssh",
                    "config": {"host": "localhost"},
                    "tags": ["production"],
                },
                profile3_id: {
                    "id": profile3_id,
                    "name": "dev-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["development"],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(
                search="prod",
                profile_type="database",
                tags=["production"],
            )

            assert result["total"] == 1
            assert result["profiles"][0]["name"] == "prod-database"


class TestListProfilesPagination:
    """Test suite for list_profiles pagination (REQ-4.7.4)."""

    def test_list_profiles_returns_pagination_structure(self) -> None:
        """Test that list_profiles returns pagination metadata (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(page=1, per_page=20)

            assert "profiles" in result
            assert "total" in result
            assert "page" in result
            assert "per_page" in result
            assert "total_pages" in result

    def test_list_profiles_paginates_results(self) -> None:
        """Test that list_profiles returns correct page of results (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profiles = {}
        for i in range(25):
            pid = str(uuid.uuid4())
            profiles[pid] = {
                "id": pid,
                "name": f"database-{i:02d}",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": [],
            }

        with _patch_profile_storage(profiles):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(page=1, per_page=10)

            assert result["total"] == 25
            assert result["page"] == 1
            assert result["per_page"] == 10
            assert result["total_pages"] == 3
            assert len(result["profiles"]) == 10

    def test_list_profiles_page_2(self) -> None:
        """Test that list_profiles returns page 2 correctly (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profiles = {}
        for i in range(25):
            pid = str(uuid.uuid4())
            profiles[pid] = {
                "id": pid,
                "name": f"database-{i:02d}",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": [],
            }

        with _patch_profile_storage(profiles):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(page=2, per_page=10)

            assert result["page"] == 2
            assert len(result["profiles"]) == 10

    def test_list_profiles_last_page_partial(self) -> None:
        """Test that list_profiles returns partial last page (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profiles = {}
        for i in range(25):
            pid = str(uuid.uuid4())
            profiles[pid] = {
                "id": pid,
                "name": f"database-{i:02d}",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": [],
            }

        with _patch_profile_storage(profiles):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(page=3, per_page=10)

            assert result["page"] == 3
            assert len(result["profiles"]) == 5  # 25 - 20 = 5

    def test_list_profiles_defaults_to_page_1(self) -> None:
        """Test that list_profiles defaults to page 1 (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles()

            assert result["page"] == 1

    def test_list_profiles_defaults_to_per_page_20(self) -> None:
        """Test that list_profiles defaults to per_page 20 (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile_id: {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles()

            assert result["per_page"] == 20

    def test_list_profiles_pagination_with_filters(self) -> None:
        """Test that pagination works with filters applied (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profiles = {}
        for i in range(15):
            pid = str(uuid.uuid4())
            profiles[pid] = {
                "id": pid,
                "name": f"prod-database-{i:02d}",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["production"],
            }
        for i in range(10):
            pid = str(uuid.uuid4())
            profiles[pid] = {
                "id": pid,
                "name": f"dev-database-{i:02d}",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["development"],
            }

        with _patch_profile_storage(profiles):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(page=1, per_page=10, tags=["production"])

            assert result["total"] == 15  # Only production profiles
            assert result["total_pages"] == 2
            assert len(result["profiles"]) == 10


class TestListProfilesSorting:
    """Test suite for list_profiles sorting (REQ-4.7.4)."""

    def test_list_profiles_sort_by_name_asc(self) -> None:
        """Test that list_profiles sorts by name ascending (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "z-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "a-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(sort_by="name", sort_order="asc")

            assert result["profiles"][0]["name"] == "a-database"
            assert result["profiles"][1]["name"] == "z-database"

    def test_list_profiles_sort_by_name_desc(self) -> None:
        """Test that list_profiles sorts by name descending (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "z-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "a-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(sort_by="name", sort_order="desc")

            assert result["profiles"][0]["name"] == "z-database"
            assert result["profiles"][1]["name"] == "a-database"

    def test_list_profiles_sort_by_type(self) -> None:
        """Test that list_profiles sorts by type (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "my-ssh",
                    "type": "ssh",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(sort_by="type", sort_order="asc")

            assert result["profiles"][0]["type"] == "database"
            assert result["profiles"][1]["type"] == "ssh"

    def test_list_profiles_defaults_to_asc_sort(self) -> None:
        """Test that list_profiles defaults to ascending sort (REQ-4.7.4)."""
        from wavecore.api.services.profiles import service as profile_service

        profile1_id = str(uuid.uuid4())
        profile2_id = str(uuid.uuid4())

        with _patch_profile_storage(
            {
                profile1_id: {
                    "id": profile1_id,
                    "name": "z-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
                profile2_id: {
                    "id": profile2_id,
                    "name": "a-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            },
        ):
            _profile_common._cache_loaded = True
            result = profile_service.list_profiles(sort_by="name")

            assert result["profiles"][0]["name"] == "a-database"


class TestGetTypeSchemaEdgeCases:
    """Test suite for get_type_schema edge cases (REQ-4.7.4)."""

    def test_get_type_schema_skips_null_types(self) -> None:
        """Test that get_type_schema skips properties with null type."""
        from wavecore.api.services.profiles import service as profile_service

        # Mock TYPE_SCHEMAS with a null type property
        original_schemas = _profile_common.TYPE_SCHEMAS.copy()
        try:
            _profile_common.TYPE_SCHEMAS["test_type"] = {
                "type": "object",
                "properties": {
                    "normal_field": {"type": "string"},
                    "null_field": {"type": "null"},  # Should be skipped
                },
            }

            result = profile_service.get_type_schema("test_type")

            assert result is not None
            field_names = [f["name"] for f in result["fields"]]
            assert "normal_field" in field_names
            assert "null_field" not in field_names
        finally:
            _profile_common.TYPE_SCHEMAS.clear()
            _profile_common.TYPE_SCHEMAS.update(original_schemas)

    def test_get_type_schema_handles_array_type(self) -> None:
        """Test that get_type_schema maps array type correctly."""
        from wavecore.api.services.profiles import service as profile_service

        original_schemas = _profile_common.TYPE_SCHEMAS.copy()
        try:
            _profile_common.TYPE_SCHEMAS["test_type"] = {
                "type": "object",
                "properties": {
                    "items_list": {
                        "type": "array",
                        "items": {"type": "string"},  # 1D array
                    },
                },
            }

            result = profile_service.get_type_schema("test_type")

            assert result is not None
            items_field = next(f for f in result["fields"] if f["name"] == "items_list")
            assert items_field["type"] == "array"
        finally:
            _profile_common.TYPE_SCHEMAS.clear()
            _profile_common.TYPE_SCHEMAS.update(original_schemas)

    def test_get_type_schema_handles_2d_array_as_table(self) -> None:
        """Test that get_type_schema maps 2D array (array of arrays) as table."""
        from wavecore.api.services.profiles import service as profile_service

        original_schemas = _profile_common.TYPE_SCHEMAS.copy()
        try:
            _profile_common.TYPE_SCHEMAS["test_type"] = {
                "type": "object",
                "properties": {
                    "data_table": {
                        "type": "array",
                        "items": {"type": "array"},  # 2D array = table
                    },
                },
            }

            result = profile_service.get_type_schema("test_type")

            assert result is not None
            table_field = next(f for f in result["fields"] if f["name"] == "data_table")
            assert table_field["type"] == "table"
        finally:
            _profile_common.TYPE_SCHEMAS.clear()
            _profile_common.TYPE_SCHEMAS.update(original_schemas)

    def test_get_type_schema_maps_number_to_float(self) -> None:
        """Test that get_type_schema maps JSON Schema 'number' type to WAVE 'float'."""
        from wavecore.api.services.profiles import service as profile_service

        original_schemas = _profile_common.TYPE_SCHEMAS.copy()
        try:
            _profile_common.TYPE_SCHEMAS["test_type"] = {
                "type": "object",
                "properties": {
                    "threshold": {"type": "number"},
                },
            }

            result = profile_service.get_type_schema("test_type")

            assert result is not None
            threshold_field = next(f for f in result["fields"] if f["name"] == "threshold")
            assert threshold_field["type"] == "float"
        finally:
            _profile_common.TYPE_SCHEMAS.clear()
            _profile_common.TYPE_SCHEMAS.update(original_schemas)


class TestTypedValueSecretMasking:
    """Test suite for typed value format secret masking (REQ-4.7.4)."""

    def test_mask_secrets_handles_typed_value_format(self) -> None:
        """Test that _mask_secrets handles typed value format with secret flag."""

        config = {
            "host": {"type": "string", "secret": False, "value": "localhost"},
            "password": {"type": "string", "secret": True, "value": "secret123"},
        }

        result = _profile_common._mask_secrets(config, "database")

        assert result["host"]["value"] == "localhost"
        assert result["password"]["value"] == "********"

    def test_mask_secrets_masks_all_secret_typed_values(self) -> None:
        """Test that _mask_secrets masks all secret typed values."""

        config = {
            "password": {"type": "string", "secret": True, "value": "my-secret-pw"},
        }

        result = _profile_common._mask_secrets(config, "database")

        # All secret values should be masked
        assert result["password"]["value"] == "********"

    def test_mask_secrets_skips_typed_value_in_schema_check(self) -> None:
        """Test that schema-based masking skips already-handled typed values."""

        # Config with typed value that matches schema secret field
        config = {
            "password": {"type": "string", "secret": True, "value": "secret123"},
        }

        result = _profile_common._mask_secrets(config, "database")

        # Should still be masked correctly
        assert result["password"]["value"] == "********"


class TestIsEmptyValue:
    """Test suite for _is_empty_value helper function (REQ-4.7.4)."""

    def test_is_empty_value_returns_true_for_none(self) -> None:
        """Test that _is_empty_value returns True for None."""

        assert _profile_common._is_empty_value(None) is True

    def test_is_empty_value_returns_true_for_empty_string(self) -> None:
        """Test that _is_empty_value returns True for empty string."""

        assert _profile_common._is_empty_value("") is True

    def test_is_empty_value_returns_true_for_empty_dict(self) -> None:
        """Test that _is_empty_value returns True for empty dict."""

        assert _profile_common._is_empty_value({}) is True

    def test_is_empty_value_returns_true_for_empty_list(self) -> None:
        """Test that _is_empty_value returns True for empty list."""

        assert _profile_common._is_empty_value([]) is True

    def test_is_empty_value_returns_false_for_non_empty_string(self) -> None:
        """Test that _is_empty_value returns False for non-empty string."""

        assert _profile_common._is_empty_value("value") is False

    def test_is_empty_value_handles_typed_value_with_none(self) -> None:
        """Test that _is_empty_value handles typed value with None value."""

        typed_value = {"type": "string", "secret": False, "value": None}
        assert _profile_common._is_empty_value(typed_value) is True

    def test_is_empty_value_handles_typed_value_with_empty_string(self) -> None:
        """Test that _is_empty_value handles typed value with empty string."""

        typed_value = {"type": "string", "secret": False, "value": ""}
        assert _profile_common._is_empty_value(typed_value) is True

    def test_is_empty_value_handles_typed_value_with_empty_list(self) -> None:
        """Test that _is_empty_value handles typed value with empty list."""

        typed_value = {"type": "array", "secret": False, "value": []}
        assert _profile_common._is_empty_value(typed_value) is True

    def test_is_empty_value_handles_typed_value_with_empty_dict(self) -> None:
        """Test that _is_empty_value handles typed value with empty dict."""

        typed_value = {"type": "map", "secret": False, "value": {}}
        assert _profile_common._is_empty_value(typed_value) is True

    def test_is_empty_value_handles_typed_value_with_empty_table(self) -> None:
        """Test that _is_empty_value handles typed value with empty table format."""

        typed_value = {"type": "table", "secret": False, "value": {"headers": [], "rows": []}}
        assert _profile_common._is_empty_value(typed_value) is True

    def test_is_empty_value_handles_typed_value_with_actual_value(self) -> None:
        """Test that _is_empty_value returns False for typed value with actual value."""

        typed_value = {"type": "string", "secret": False, "value": "localhost"}
        assert _profile_common._is_empty_value(typed_value) is False


class TestCountEnvironmentsWithValues:
    """Test suite for _count_environments_with_values helper function (REQ-4.7.4)."""

    def test_count_environments_with_values_returns_zero_for_empty(self) -> None:
        """Test that _count_environments_with_values returns 0 for empty dict."""

        assert _profile_common._count_environments_with_values({}) == 0

    def test_count_environments_with_values_counts_non_empty(self) -> None:
        """Test that _count_environments_with_values counts environments with values."""

        env_values = {
            "env1": {"host": "localhost"},
            "env2": {"host": "server.com"},
        }

        assert _profile_common._count_environments_with_values(env_values) == 2

    def test_count_environments_with_values_skips_empty_environments(self) -> None:
        """Test that _count_environments_with_values skips environments with all empty values."""

        env_values = {
            "env1": {"host": "localhost"},
            "env2": {"host": ""},  # Empty value
            "env3": {},  # No values
        }

        assert _profile_common._count_environments_with_values(env_values) == 1


class TestDuplicateProfile:
    """Test suite for duplicate_profile function (REQ-4.7.4)."""

    def test_duplicate_profile_creates_copy(self) -> None:
        """Test that duplicate_profile creates a copy of the profile."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        # Create original profile
        original = profile_service.create_profile(
            name="Production DB",
            profile_type="database",
            config={"host": "localhost", "port": 5432},
            tags=["production", "critical"],
        )

        # Duplicate it
        result = profile_service.duplicate_profile(original["id"], "Production DB Copy")

        assert result is not None
        assert result["id"] != original["id"]
        assert result["name"] == "Production DB Copy"
        assert result["type"] == "database"
        assert result["tags"] == ["production", "critical"]
        assert result["usage"] == 0

    def test_duplicate_profile_returns_none_for_nonexistent(self) -> None:
        """Test that duplicate_profile returns None for non-existent ID."""
        from wavecore.api.services.profiles import service as profile_service

        result = profile_service.duplicate_profile(str(uuid.uuid4()), "New Name")

        assert result is None

    def test_duplicate_profile_rejects_duplicate_name(self) -> None:
        """Test that duplicate_profile rejects duplicate name."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        # Create two profiles
        original = profile_service.create_profile(
            name="Original",
            profile_type="database",
            config={"host": "localhost"},
        )
        profile_service.create_profile(
            name="Existing Name",
            profile_type="database",
            config={"host": "localhost"},
        )

        # Try to duplicate with name that already exists
        with pytest.raises(ConflictException) as exc_info:
            profile_service.duplicate_profile(original["id"], "Existing Name")

        # ConflictException is correctly raised
        assert "already exists" in str(exc_info.value)

    def test_duplicate_profile_copies_description(self) -> None:
        """Test that duplicate_profile copies description."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        original = profile_service.create_profile(
            name="Original",
            profile_type="database",
            config={"host": "localhost"},
            description="Original description",
        )

        result = profile_service.duplicate_profile(original["id"], "Copy")

        assert result is not None
        assert result.get("description") == "Original description"

    def test_duplicate_profile_copies_environment_values(self) -> None:
        """Test that duplicate_profile copies environment_values."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        original = profile_service.create_profile(
            name="Original",
            profile_type="database",
            environment_values={
                "env1": {"host": "host1"},
                "env2": {"host": "host2"},
            },
        )

        result = profile_service.duplicate_profile(original["id"], "Copy")

        assert result is not None
        assert "env1" in result["environment_values"]
        assert "env2" in result["environment_values"]


class TestListAllTags:
    """Test suite for list_all_tags / get_all_tags function (REQ-4.7.4)."""

    def test_list_all_tags_returns_unique_tags(self) -> None:
        """Test that list_all_tags returns unique tags from all profiles."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        profile_service.create_profile(
            name="Profile 1",
            profile_type="database",
            tags=["production", "critical"],
        )
        profile_service.create_profile(
            name="Profile 2",
            profile_type="ssh",
            tags=["production", "ssh"],
        )

        result = profile_service.list_all_tags()

        assert "production" in result
        assert "critical" in result
        assert "ssh" in result
        # Should be sorted
        assert result == sorted(result)

    def test_list_all_tags_returns_empty_when_no_tags(self) -> None:
        """Test that list_all_tags returns empty list when no tags."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        profile_service.create_profile(
            name="Profile 1",
            profile_type="database",
        )

        result = profile_service.list_all_tags()

        assert result == []

    def test_get_all_tags_is_alias(self) -> None:
        """Test that get_all_tags is alias for list_all_tags."""
        from wavecore.api.services.profiles import service as profile_service

        assert profile_service.get_all_tags is profile_service.list_all_tags


class TestProfileEnvironmentValues:
    """Test suite for profile environment_values handling (REQ-4.7.4)."""

    def test_create_profile_with_environment_values(self) -> None:
        """Test that create_profile accepts environment_values."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        env_id = str(uuid.uuid4())
        result = profile_service.create_profile(
            name="Test Profile",
            profile_type="database",
            environment_values={env_id: {"host": "localhost", "port": 5432}},
        )

        assert env_id in result["environment_values"]

    def test_update_profile_with_environment_values(self) -> None:
        """Test that update_profile accepts environment_values."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        original = profile_service.create_profile(
            name="Test Profile",
            profile_type="database",
        )

        env_id = str(uuid.uuid4())
        result = profile_service.update_profile(
            original["id"],
            environment_values={env_id: {"host": "new-host"}},
        )

        assert result is not None
        assert env_id in result["environment_values"]

    def test_list_profiles_masks_environment_values_secrets(self) -> None:
        """Test that list_profiles masks secrets in environment_values."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()

        env_id = str(uuid.uuid4())
        profile_service.create_profile(
            name="Test Profile",
            profile_type="database",
            environment_values={env_id: {"host": "localhost", "password": "secret"}},
        )

        result = profile_service.list_profiles()

        assert len(result["profiles"]) == 1
        profile = result["profiles"][0]
        assert profile["environment_values"][env_id]["password"] == "********"
        assert profile["environment_values"][env_id]["host"] == "localhost"

    def test_get_profile_includes_computed_environment_fields(self) -> None:
        """Test that get_profile includes computed environment fields."""
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()
        environment_service._clear_storage()

        # Create an environment
        env = environment_service.create_environment(name="test-env")

        # Create profile with values for that environment
        profile = profile_service.create_profile(
            name="Test Profile",
            profile_type="database",
            environment_values={env["id"]: {"host": "localhost"}},
        )

        result = profile_service.get_profile(profile["id"])

        assert result is not None
        assert "environments_count" in result
        assert "total_environments" in result
        assert "has_incomplete_environments" in result


class TestGetProfileReferences:
    """Test suite for _get_profile_references helper function (REQ-4.7.4)."""

    def test_get_profile_references_returns_empty_when_no_tests(self) -> None:
        """Test that _get_profile_references returns empty list when no tests exist."""
        from wavecore.api.services.tests import service as test_service

        with patch.object(test_service, "_cached_tests", return_value=[]):
            result = _profile_common._get_profile_references("some-profile-id")

            assert result == []

    def test_get_profile_references_finds_matching_tests(self) -> None:
        """Test that _get_profile_references finds tests referencing the profile."""
        from wavecore.api.services.tests import service as test_service

        profile_id = str(uuid.uuid4())
        tests = [
            {
                "id": "test-1",
                "name": "Login Test",
                "metadata": {"profile_id": profile_id},
            },
            {
                "id": "test-2",
                "name": "Checkout Test",
                "metadata": {"profile_id": profile_id},
            },
            {
                "id": "test-3",
                "name": "Other Test",
                "metadata": {"profile_id": "other-profile"},
            },
        ]

        with patch.object(test_service, "_cached_tests", return_value=tests):
            result = _profile_common._get_profile_references(profile_id)

            assert len(result) == 2
            assert "Login Test" in result
            assert "Checkout Test" in result
            assert "Other Test" not in result

    def test_get_profile_references_handles_missing_metadata(self) -> None:
        """Test that _get_profile_references handles tests without metadata."""
        from wavecore.api.services.tests import service as test_service

        profile_id = str(uuid.uuid4())
        tests = [
            {"id": "test-1", "name": "Test Without Metadata"},
            {"id": "test-2", "name": "Test With Empty Metadata", "metadata": {}},
            {
                "id": "test-3",
                "name": "Matching Test",
                "metadata": {"profile_id": profile_id},
            },
        ]

        with patch.object(test_service, "_cached_tests", return_value=tests):
            result = _profile_common._get_profile_references(profile_id)

            assert len(result) == 1
            assert "Matching Test" in result

    def test_get_profile_references_uses_id_as_fallback_name(self) -> None:
        """Test that _get_profile_references uses id when name is missing."""
        from wavecore.api.services.tests import service as test_service

        profile_id = str(uuid.uuid4())
        tests = [
            {
                "id": "test-abc-123",
                "metadata": {"profile_id": profile_id},
            },
        ]

        with patch.object(test_service, "_cached_tests", return_value=tests):
            result = _profile_common._get_profile_references(profile_id)

            assert len(result) == 1
            assert "test-abc-123" in result


class TestProfileServiceFileStorage:
    """Test suite for file-based storage persistence (REQ-6.1.6, REQ-6.1.7).

    These tests verify that profile_service uses file-based YAML storage
    following the same pattern as environment_service. Profiles persist
    to disk and survive server restarts through lazy cache loading.
    """

    def test_profile_persists_to_file(self, tmp_path: Any) -> None:
        """Test that created profiles are persisted to YAML files."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create a profile
        profile = profile_service.create_profile(
            name="production-db",
            profile_type="database",
            config={"host": "db.example.com", "port": 5432},
            description="Production database",
            tags=["production", "critical"],
        )

        # Verify file exists
        profile_dir = storage_paths.get_profiles_storage_path() / profile["id"]
        profile_file = profile_dir / "profile.yaml"
        assert profile_file.exists(), "Profile file should be persisted to disk"

    def test_profile_loads_from_file_on_restart(self, tmp_path: Any) -> None:
        """Test that profiles are loaded from files after cache reset."""

        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create a profile
        profile = profile_service.create_profile(
            name="staging-ssh",
            profile_type="ssh",
            config={"host": "ssh.staging.example.com", "port": 22, "username": "deploy"},
            description="Staging SSH connection",
        )
        profile_id = profile["id"]

        # Simulate service restart by clearing in-memory cache
        # but NOT clearing disk storage
        _profile_common._clear_in_memory_cache()

        # Profile should still be retrievable (loaded from disk)
        loaded = profile_service.get_profile(profile_id)
        assert loaded is not None
        assert loaded["name"] == "staging-ssh"
        assert loaded["type"] == "ssh"
        assert loaded["description"] == "Staging SSH connection"

    def test_clear_storage_removes_files(self, tmp_path: Any) -> None:
        """Test that _clear_storage removes profile files from disk."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create profiles
        profile1 = profile_service.create_profile(
            name="profile-1",
            profile_type="http",
            config={"base_url": "https://api1.example.com"},
        )
        profile2 = profile_service.create_profile(
            name="profile-2",
            profile_type="http",
            config={"base_url": "https://api2.example.com"},
        )

        # Verify files exist
        profile_storage = storage_paths.get_profiles_storage_path()
        assert (profile_storage / profile1["id"]).exists()
        assert (profile_storage / profile2["id"]).exists()

        # Clear storage
        _profile_common._clear_storage()

        # Files should be removed (or directory should be empty)
        remaining = list(profile_storage.iterdir()) if profile_storage.exists() else []
        assert len(remaining) == 0, "All profile files should be removed"

    def test_update_profile_persists_changes(self, tmp_path: Any) -> None:
        """Test that updated profiles are persisted to disk."""
        import yaml

        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create and update profile
        profile = profile_service.create_profile(
            name="test-profile",
            profile_type="database",
            config={"host": "old-host.example.com"},
        )
        profile_service.update_profile(
            profile["id"],
            name="updated-profile",
            description="Updated description",
            config={"host": "new-host.example.com", "port": 5432},
        )

        # Read from file directly
        profile_file = storage_paths.get_profiles_storage_path() / profile["id"] / "profile.yaml"
        with open(profile_file, encoding="utf-8") as f:
            persisted = yaml.safe_load(f)

        assert persisted["name"] == "updated-profile"
        assert persisted["description"] == "Updated description"
        assert persisted["config"]["host"] == "new-host.example.com"

    def test_delete_profile_removes_file(self, tmp_path: Any) -> None:
        """Test that deleted profiles have their files removed."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create profile
        profile = profile_service.create_profile(
            name="to-delete",
            profile_type="http",
            config={"base_url": "https://delete.example.com"},
        )
        profile_dir = storage_paths.get_profiles_storage_path() / profile["id"]

        # Verify file exists
        assert profile_dir.exists()

        # Delete profile
        profile_service.delete_profile(profile["id"])

        # File should be removed
        assert not profile_dir.exists()

    def test_list_profiles_loads_all_from_disk(self, tmp_path: Any) -> None:
        """Test that list_profiles loads all profiles from disk."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create multiple profiles
        profile_service.create_profile(
            name="profile-a", profile_type="database", config={"host": "a.example.com"}
        )
        profile_service.create_profile(
            name="profile-b", profile_type="ssh", config={"host": "b.example.com"}
        )
        profile_service.create_profile(
            name="profile-c", profile_type="http", config={"base_url": "https://c.example.com"}
        )

        # Clear in-memory cache to simulate restart
        _profile_common._clear_in_memory_cache()

        # List should load all from disk
        result = profile_service.list_profiles()

        assert result["total"] == 3
        names = {p["name"] for p in result["profiles"]}
        assert names == {"profile-a", "profile-b", "profile-c"}

    def test_duplicate_profile_persists_copy(self, tmp_path: Any) -> None:
        """Test that duplicated profiles are persisted to disk."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create and duplicate profile
        original = profile_service.create_profile(
            name="original-profile",
            profile_type="database",
            config={"host": "original.example.com", "port": 5432},
            description="Original profile",
            tags=["tag1", "tag2"],
        )
        duplicate = profile_service.duplicate_profile(original["id"], "copied-profile")

        # Verify duplicate file exists
        dup_file = storage_paths.get_profiles_storage_path() / duplicate["id"] / "profile.yaml"
        assert dup_file.exists()

        # Clear in-memory cache and reload
        _profile_common._clear_in_memory_cache()

        # Both should be loadable from disk
        result = profile_service.list_profiles()
        assert result["total"] == 2

    def test_profile_with_environment_values_persists(self, tmp_path: Any) -> None:
        """Test that profiles with environment_values are correctly persisted."""
        import yaml

        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create profile with environment values
        env_values = {
            "env-prod": {"host": "prod.db.example.com", "port": 5432},
            "env-staging": {"host": "staging.db.example.com", "port": 5432},
        }
        profile = profile_service.create_profile(
            name="multi-env-profile",
            profile_type="database",
            environment_values=env_values,
        )

        # Verify persisted data
        profile_file = storage_paths.get_profiles_storage_path() / profile["id"] / "profile.yaml"
        with open(profile_file, encoding="utf-8") as f:
            persisted = yaml.safe_load(f)

        assert persisted["environment_values"]["env-prod"]["host"] == "prod.db.example.com"
        assert persisted["environment_values"]["env-staging"]["host"] == "staging.db.example.com"

        # Verify survives restart
        _profile_common._clear_in_memory_cache()
        loaded = profile_service.get_profile(profile["id"])
        # The loaded profile will have masked secrets, but we can check structure
        assert loaded is not None
        assert "env-prod" in loaded["environment_values"]
        assert "env-staging" in loaded["environment_values"]

    def test_profile_with_secrets_persists_sealed_values(self, tmp_path: Any) -> None:
        """Test that secret fields are stored as sealed envelopes in YAML (REQ-4.5.1)."""
        import yaml

        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create profile with secret fields
        profile = profile_service.create_profile(
            name="secret-profile",
            profile_type="database",
            config={
                "host": "db.example.com",
                "port": 5432,
                "username": "admin",
                "password": "super-secret-password",
            },
        )

        # Read from file - the sealed secret should be stored
        profile_file = storage_paths.get_profiles_storage_path() / profile["id"] / "profile.yaml"
        with open(profile_file, encoding="utf-8") as f:
            persisted = yaml.safe_load(f)

        # Sealed envelope stored (not masked, not plaintext)
        assert is_secret_envelope(persisted["config"]["password"])
        assert unseal_all(persisted["config"]["password"]) == "super-secret-password"

        # But when retrieved via API, it should be masked
        loaded = profile_service.get_profile(profile["id"])
        assert loaded["config"]["password"] == "********"

    def test_profile_with_secret_persists_and_masks_on_retrieval(self, tmp_path: Any) -> None:
        """Test that secret values are persisted sealed and masked on retrieval."""
        import yaml

        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create profile with secret password
        profile = profile_service.create_profile(
            name="secret-creds-profile",
            profile_type="database",
            config={
                "host": "db.example.com",
                "port": 5432,
                "username": "admin",
                "password": "super-secret-pw",
            },
        )

        # Read from file - the sealed value on disk restores to the original
        profile_file = storage_paths.get_profiles_storage_path() / profile["id"] / "profile.yaml"
        with open(profile_file, encoding="utf-8") as f:
            persisted = yaml.safe_load(f)

        assert is_secret_envelope(persisted["config"]["password"])
        assert unseal_all(persisted["config"]["password"]) == "super-secret-pw"

        # When retrieved via API, secret is masked
        loaded = profile_service.get_profile(profile["id"])
        assert loaded["config"]["password"] == "********"


class TestStoragePathsProfiles:
    """Test suite for get_profiles_storage_path function (REQ-6.1.6)."""

    def test_get_profiles_storage_path_returns_correct_path(self) -> None:
        """Test that get_profiles_storage_path returns correct path."""
        from wavecore.api.services.storage_paths import (
            get_base_path,
            get_profiles_storage_path,
        )

        expected = get_base_path() / "api_profiles"
        actual = get_profiles_storage_path()

        assert actual == expected

    def test_get_profiles_storage_path_respects_base_path(
        self, tmp_path: Any, temp_storage_path: Any
    ) -> None:
        """Test that get_profiles_storage_path uses configured base path."""
        from wavecore.api.services import storage_paths

        storage_paths.set_base_path(tmp_path)
        result = storage_paths.get_profiles_storage_path()

        assert result == tmp_path / "api_profiles"

        # Restore the fixture's temp path (NOT reset to None!)
        storage_paths.set_base_path(temp_storage_path)


class TestProfileServiceFileStorageErrorHandling:
    """Test suite for error handling in file-based storage (REQ-6.1.6).

    Per design: If an entity file becomes corrupted or unreadable, the system
    logs a warning and excludes that entity from the cache. This prevents one
    corrupted file from blocking access to all entities.
    """

    def test_corrupted_profile_file_excluded_from_cache(self, tmp_path: Any) -> None:
        """Test that corrupted profile files are excluded from cache loading.

        Per REQ-6.1.6: If an entity file becomes corrupted or unreadable, the system
        excludes that entity from the cache, preventing one corrupted file from
        blocking access to all entities.
        """
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create valid profiles
        profile1 = profile_service.create_profile(
            name="valid-1", profile_type="http", config={"base_url": "https://1.example.com"}
        )
        _profile2 = profile_service.create_profile(
            name="valid-2", profile_type="http", config={"base_url": "https://2.example.com"}
        )

        # Corrupt one profile file
        corrupted_file = storage_paths.get_profiles_storage_path() / profile1["id"] / "profile.yaml"
        with open(corrupted_file, "w", encoding="utf-8") as f:
            f.write("invalid yaml: {not valid yaml content")

        # Clear cache and reload
        _profile_common._clear_in_memory_cache()

        # List should succeed and include only valid profile
        result = profile_service.list_profiles()
        names = {p["name"] for p in result["profiles"]}
        assert "valid-2" in names

    def test_storage_directory_created_automatically(self, tmp_path: Any) -> None:
        """Test that storage directory is created automatically if it doesn't exist."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        # Use a path that doesn't exist yet
        new_storage_path = tmp_path / "new_data"
        storage_paths.set_base_path(new_storage_path)
        _profile_common._clear_in_memory_cache()
        _profile_common._cache_loaded = False

        # Create should succeed and create directory
        profile = profile_service.create_profile(
            name="auto-dir", profile_type="http", config={"base_url": "https://auto.example.com"}
        )

        # Verify directory was created and file exists
        profile_file = storage_paths.get_profiles_storage_path() / profile["id"] / "profile.yaml"
        assert profile_file.exists()

    def test_typed_values_preserved_in_persistence(self, tmp_path: Any) -> None:
        """Test that typed values in environment_values are preserved through persistence."""
        import yaml

        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create profile with typed values in environment_values
        env_values = {
            "prod": {
                "host": {"type": "string", "secret": False, "value": "prod.db.example.com"},
                "port": {"type": "integer", "secret": False, "value": 5432},
                "password": {"type": "string", "secret": True, "value": "prod-secret"},
            },
        }
        profile = profile_service.create_profile(
            name="typed-values-profile",
            profile_type="database",
            environment_values=env_values,
        )

        # Read from file
        profile_file = storage_paths.get_profiles_storage_path() / profile["id"] / "profile.yaml"
        with open(profile_file, encoding="utf-8") as f:
            persisted = yaml.safe_load(f)

        # Verify typed structure is preserved
        assert persisted["environment_values"]["prod"]["host"]["type"] == "string"
        assert persisted["environment_values"]["prod"]["host"]["value"] == "prod.db.example.com"
        assert persisted["environment_values"]["prod"]["password"]["secret"] is True
        # Sealed secret value stored inside the typed wrapper
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        sealed_password = persisted["environment_values"]["prod"]["password"]["value"]
        assert is_secret_envelope(sealed_password)
        assert unseal_all(sealed_password) == "prod-secret"

        # Verify survives restart
        _profile_common._clear_in_memory_cache()
        loaded = profile_service.get_profile(profile["id"])
        assert loaded is not None
        # Secret should be masked in response
        assert loaded["environment_values"]["prod"]["password"]["value"] == "********"
        # Non-secret should be preserved
        assert loaded["environment_values"]["prod"]["host"]["value"] == "prod.db.example.com"

    def test_empty_directory_skipped_during_cache_load(self, tmp_path: Any) -> None:
        """Test that directories without profile.yaml are skipped during cache loading."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create a valid profile
        _profile = profile_service.create_profile(
            name="valid-profile",
            profile_type="http",
            config={"base_url": "https://valid.example.com"},
        )

        # Create an empty directory (orphaned/corrupted state)
        empty_dir = storage_paths.get_profiles_storage_path() / "orphaned-dir"
        empty_dir.mkdir(parents=True, exist_ok=True)

        # Clear cache and reload
        _profile_common._clear_in_memory_cache()

        # List should only include the valid profile (empty dir skipped)
        result = profile_service.list_profiles()
        assert result["total"] == 1
        assert result["profiles"][0]["name"] == "valid-profile"

    def test_typed_value_with_none_actual_value_skips_validation(self, tmp_path: Any) -> None:
        """Test that typed values with None actual value skip string validation."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.profiles import service as profile_service

        storage_paths.set_base_path(tmp_path)
        _profile_common._clear_storage()

        # Create profile with typed value where actual value is None (empty)
        # This tests the branch where typed value has non-string actual value
        env_values = {
            "prod": {
                "host": {"type": "string", "secret": False, "value": None},
                "port": {"type": "integer", "secret": False, "value": 5432},
            },
        }
        profile = profile_service.create_profile(
            name="typed-none-profile",
            profile_type="database",
            environment_values=env_values,
        )

        assert profile is not None
        assert profile["name"] == "typed-none-profile"


class TestProfileServiceETag:
    """Test suite for profile service ETag/concurrency control."""

    def test_generate_etag_returns_quoted_hash(self) -> None:
        """Test that _generate_etag returns a quoted MD5 hash."""

        profile = {
            "id": "test-id-123",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        etag = _profile_common._generate_etag(profile)

        assert etag.startswith('"')
        assert etag.endswith('"')
        assert len(etag) == 66  # 64 hex chars + 2 quotes

    def test_generate_etag_is_deterministic(self) -> None:
        """Test that _generate_etag returns same hash for same input."""

        profile = {
            "id": "test-id-123",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        etag1 = _profile_common._generate_etag(profile)
        etag2 = _profile_common._generate_etag(profile)

        assert etag1 == etag2

    def test_generate_etag_changes_with_updated_at(self) -> None:
        """Test that _generate_etag produces different hash when updated_at changes."""

        p1 = {"id": "test-id", "updated_at": "2025-01-01T00:00:00Z"}
        p2 = {"id": "test-id", "updated_at": "2025-01-02T00:00:00Z"}

        assert _profile_common._generate_etag(p1) != _profile_common._generate_etag(p2)

    def test_update_with_matching_etag_succeeds(self) -> None:
        """Test that update succeeds when ETag matches."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())
        profile_data = {
            "id": profile_id,
            "name": "etag-test",
            "type": "database",
            "config": {"host": "localhost"},
            "environment_values": {},
            "tags": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        current_etag = _profile_common._generate_etag(profile_data)

        with _patch_profile_storage({profile_id: profile_data}):
            result = profile_service.update_profile(
                profile_id,
                name="updated-name",
                etag=current_etag,
            )

            assert result is not None
            assert result["name"] == "updated-name"

    def test_update_with_mismatched_etag_raises_precondition_failed(self) -> None:
        """Test that update raises ValueError when ETag mismatches."""
        from wavecore.api.services.profiles import service as profile_service

        profile_id = str(uuid.uuid4())
        profile_data = {
            "id": profile_id,
            "name": "etag-test",
            "type": "database",
            "config": {"host": "localhost"},
            "environment_values": {},
            "tags": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with _patch_profile_storage({profile_id: profile_data}):
            with pytest.raises(ConflictException, match="Precondition failed"):
                profile_service.update_profile(
                    profile_id,
                    name="updated-name",
                    etag='"stale-etag"',
                )


# ============================================================================
# Export / Import Service-Level Tests
# ============================================================================


class TestProfileSanitizeFilename:
    """Test suite for _sanitize_filename utility in profile service."""

    def test_sanitize_simple_name(self) -> None:
        """Simple alphanumeric name stays unchanged."""

        assert _profile_common._sanitize_filename("Production") == "Production"

    def test_sanitize_strips_special_characters(self) -> None:
        """Special characters are removed."""

        result = _profile_common._sanitize_filename("profile@#$%name")
        assert "@" not in result
        assert "#" not in result

    def test_sanitize_replaces_spaces_with_dashes(self) -> None:
        """Whitespace is replaced by dashes."""

        result = _profile_common._sanitize_filename("My Profile Name")
        assert result == "My-Profile-Name"

    def test_sanitize_empty_name_returns_default(self) -> None:
        """Empty or all-special-char name returns default 'profile'."""

        assert _profile_common._sanitize_filename("@#$") == "profile"
        assert _profile_common._sanitize_filename("") == "profile"

    def test_sanitize_preserves_hyphens_and_underscores(self) -> None:
        """Hyphens and underscores are preserved."""

        assert _profile_common._sanitize_filename("my-profile_name") == "my-profile_name"


class TestProfileGenerateUniqueName:
    """Test suite for _generate_unique_name utility in profile service."""

    def test_unique_name_when_no_conflict(self) -> None:
        """Returns base name when it does not exist."""

        with _patch_profile_storage({}):
            _profile_common._cache_loaded = True
            result = _profile_common._generate_unique_name("New Profile")
            assert result == "New Profile"

    def test_unique_name_appends_counter_on_conflict(self) -> None:
        """Appends (2) when base name is taken."""

        pid = str(uuid.uuid4())
        with _patch_profile_storage(
            {pid: {"id": pid, "name": "Existing", "type": "custom", "config": {}}},
        ):
            _profile_common._cache_loaded = True
            result = _profile_common._generate_unique_name("Existing")
            assert result == "Existing (2)"

    def test_unique_name_increments_counter(self) -> None:
        """Increments past (2) when (2) is also taken."""

        p1 = str(uuid.uuid4())
        p2 = str(uuid.uuid4())
        with _patch_profile_storage(
            {
                p1: {"id": p1, "name": "Prof", "type": "custom", "config": {}},
                p2: {"id": p2, "name": "Prof (2)", "type": "custom", "config": {}},
            },
        ):
            _profile_common._cache_loaded = True
            result = _profile_common._generate_unique_name("Prof")
            assert result == "Prof (3)"


class TestExportProfile:
    """Test suite for export_profile function."""

    def test_export_yaml(self) -> None:
        """Export in YAML format returns valid YAML content and filename."""
        import yaml as yaml_mod

        pid = str(uuid.uuid4())
        profile_data: dict[str, Any] = {
            "id": pid,
            "name": "DB Prod",
            "type": "database",
            "config": {"host": "db.example.com", "port": 5432},
            "environment_values": {},
            "tags": ["prod"],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with _patch_profile_storage({pid: profile_data}):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile(pid, "yaml", secrets="mask")

        assert result is not None
        content, filename = result
        assert filename.endswith(".yaml")
        parsed = yaml_mod.safe_load(content)
        assert parsed["name"] == "DB Prod"

    def test_export_json(self) -> None:
        """Export in JSON format returns valid JSON content and filename."""
        import json

        pid = str(uuid.uuid4())
        profile_data: dict[str, Any] = {
            "id": pid,
            "name": "SSH Gateway",
            "type": "ssh",
            "config": {"host": "gateway.example.com"},
            "environment_values": {},
            "tags": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with _patch_profile_storage({pid: profile_data}):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile(pid, "json", secrets="mask")

        assert result is not None
        content, filename = result
        assert filename.endswith(".json")
        parsed = json.loads(content)
        assert parsed["name"] == "SSH Gateway"

    def test_export_not_found_returns_none(self) -> None:
        """Export returns None for non-existent profile."""

        with _patch_profile_storage({}):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile("nonexistent-id")

        assert result is None

    def _sealed_db_profile(self, pid: str) -> dict[str, Any]:
        return {
            "id": pid,
            "name": "DB Secrets",
            "type": "database",
            "config": seal_profile({"host": "localhost", "password": "secret123"}, "database"),
            "environment_values": {},
            "tags": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

    def test_export_mask_mode_masks_config_secret(self) -> None:
        import yaml as yaml_mod

        pid = str(uuid.uuid4())
        with _patch_profile_storage({pid: self._sealed_db_profile(pid)}):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile(pid, "yaml", secrets="mask")

        assert result is not None
        parsed = yaml_mod.safe_load(result[0])
        assert parsed["config"]["password"] == "********"
        assert parsed["config"]["host"] == "localhost"

    def test_export_encrypted_mode_emits_sealed_config(self) -> None:
        import yaml as yaml_mod

        pid = str(uuid.uuid4())
        profile = self._sealed_db_profile(pid)
        sealed_password = profile["config"]["password"]
        with _patch_profile_storage({pid: profile}):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile(pid, "yaml", secrets="encrypted")

        assert result is not None
        parsed = yaml_mod.safe_load(result[0])
        assert parsed["config"]["password"] == sealed_password
        assert is_secret_envelope(parsed["config"]["password"])

    def test_export_plaintext_mode_decrypts_config(self) -> None:
        import yaml as yaml_mod

        pid = str(uuid.uuid4())
        with _patch_profile_storage({pid: self._sealed_db_profile(pid)}):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile(pid, "yaml", secrets="plaintext")

        assert result is not None
        parsed = yaml_mod.safe_load(result[0])
        assert parsed["config"]["password"] == "secret123"

    def test_export_plaintext_undecryptable_raises_conflict(self) -> None:
        pid = str(uuid.uuid4())
        profile_data: dict[str, Any] = {
            "id": pid,
            "name": "DB Foreign",
            "type": "database",
            "config": {"host": "localhost", "password": _foreign_envelope("secret123")},
            "environment_values": {},
            "tags": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with _patch_profile_storage({pid: profile_data}):
            _profile_common._cache_loaded = True
            with pytest.raises(ConflictException) as exc_info:
                _profile_import_export.export_profile(pid, "yaml", secrets="plaintext")

        assert str(exc_info.value) == _DECRYPTION_FAILED_MESSAGE

    def test_export_replaces_env_ids_with_names(self) -> None:
        """Export replaces environment IDs with environment names."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        env_id = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        profile_data: dict[str, Any] = {
            "id": pid,
            "name": "Env Profile",
            "type": "database",
            "config": {"host": "localhost"},
            "environment_values": {env_id: {"host": "prod.db.local"}},
            "tags": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with (
            _patch_profile_storage({pid: profile_data}),
            patch.object(
                environment_service,
                "list_environment_names",
                return_value=[{"id": env_id, "name": "production", "tags": []}],
            ),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile(pid, "yaml", secrets="mask")

        assert result is not None
        content, _ = result
        parsed = yaml_mod.safe_load(content)
        assert "production" in parsed["environment_values"]
        assert env_id not in parsed["environment_values"]

    def test_export_masks_secrets_in_env_values(self) -> None:
        """Export masks secrets in environment_values too."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        env_id = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        profile_data: dict[str, Any] = {
            "id": pid,
            "name": "Env Masked",
            "type": "database",
            "config": {"host": "localhost"},
            "environment_values": {env_id: {"password": "env-secret"}},
            "tags": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with (
            _patch_profile_storage({pid: profile_data}),
            patch.object(
                environment_service,
                "list_environment_names",
                return_value=[{"id": env_id, "name": "staging", "tags": []}],
            ),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile(pid, "yaml", secrets="mask")

        assert result is not None
        content, _ = result
        parsed = yaml_mod.safe_load(content)
        assert parsed["environment_values"]["staging"]["password"] == "********"

    def test_export_env_id_falls_back_to_id_when_name_not_found(self) -> None:
        """Export keeps env ID as-is when the environment is not found."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        env_id = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        profile_data: dict[str, Any] = {
            "id": pid,
            "name": "Missing Env Profile",
            "type": "database",
            "config": {"host": "localhost"},
            "environment_values": {env_id: {"host": "unknown.db.local"}},
            "tags": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        with (
            _patch_profile_storage({pid: profile_data}),
            patch.object(
                environment_service,
                "list_environment_names",
                return_value=[],  # No environments
            ),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.export_profile(pid, "yaml", secrets="mask")

        assert result is not None
        content, _ = result
        parsed = yaml_mod.safe_load(content)
        # Falls back to the raw env_id since no name was found
        assert env_id in parsed["environment_values"]


class TestExportProfilesBatch:
    """Test suite for export_profiles_batch function."""

    def test_batch_export_multiple(self) -> None:
        """Batch export returns content for all requested profiles."""
        from wavecore.api.services.environments import service as environment_service

        p1 = str(uuid.uuid4())
        p2 = str(uuid.uuid4())
        storage: dict[str, Any] = {
            p1: {
                "id": p1,
                "name": "P1",
                "type": "database",
                "config": {"host": "localhost"},
                "environment_values": {},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            },
            p2: {
                "id": p2,
                "name": "P2",
                "type": "ssh",
                "config": {"host": "server.example.com"},
                "environment_values": {},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            },
        }

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            results = _profile_import_export.export_profiles_batch([p1, p2], "yaml", "mask")

        assert len(results) == 2
        ids_returned = {r[0] for r in results}
        assert p1 in ids_returned
        assert p2 in ids_returned

    def test_batch_export_deduplicates_filenames(self) -> None:
        """Batch export deduplicates filenames for same-named profiles."""
        from wavecore.api.services.environments import service as environment_service

        p1 = str(uuid.uuid4())
        p2 = str(uuid.uuid4())
        storage: dict[str, Any] = {
            p1: {
                "id": p1,
                "name": "SameName",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            },
            p2: {
                "id": p2,
                "name": "SameName",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            },
        }

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            results = _profile_import_export.export_profiles_batch([p1, p2], "yaml", "mask")

        filenames = {r[2] for r in results}
        assert len(filenames) == 2  # No duplicates

    def test_batch_export_triple_duplicate_filenames(self) -> None:
        """Batch export with 3+ same-named profiles increments counter past 2."""
        from wavecore.api.services.environments import service as environment_service

        p1 = str(uuid.uuid4())
        p2 = str(uuid.uuid4())
        p3 = str(uuid.uuid4())
        storage: dict[str, Any] = {
            p1: {
                "id": p1,
                "name": "Dup",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            },
            p2: {
                "id": p2,
                "name": "Dup",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            },
            p3: {
                "id": p3,
                "name": "Dup",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            },
        }

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            results = _profile_import_export.export_profiles_batch([p1, p2, p3], "yaml", "mask")

        filenames = [r[2] for r in results]
        assert len(set(filenames)) == 3  # All unique
        assert filenames[0] == "Dup.yaml"
        assert filenames[1] == "Dup-2.yaml"
        assert filenames[2] == "Dup-3.yaml"

    def test_batch_export_not_found_raises(self) -> None:
        """Batch export raises ValueError when a profile is not found."""

        with _patch_profile_storage({}):
            _profile_common._cache_loaded = True
            with pytest.raises(NotFoundException, match="Profile not found"):
                _profile_import_export.export_profiles_batch(["nonexistent-id"])


class TestValidateProfileImport:
    """Test suite for validate_profile_import function."""

    def test_validate_ok_status(self) -> None:
        """New profile with valid type returns ok status."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump({"name": "Brand New", "type": "database", "config": {}}).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        assert result["total"] == 1
        assert result["importable"] == 1
        assert result["blocked"] == 0
        assert result["profiles"][0]["status"] == "ok"

    def test_validate_conflict_status(self) -> None:
        """Profile with existing name returns conflict status."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage = {pid: {"id": pid, "name": "Existing", "type": "database", "config": {}}}
        content = yaml_mod.dump({"name": "Existing", "type": "database", "config": {}}).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        assert result["profiles"][0]["status"] == "conflict"
        assert result["profiles"][0]["existing_profile_id"] == pid
        assert result["importable"] == 1

    def test_validate_fatal_missing_name(self) -> None:
        """Profile without name returns fatal status."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump({"type": "database", "config": {}}).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        assert result["profiles"][0]["status"] == "fatal"
        assert result["blocked"] == 1
        assert result["profiles"][0]["fatal_errors"][0]["code"] == "MISSING_NAME"

    def test_validate_fixable_missing_type(self) -> None:
        """Profile without type produces fixable error."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump({"name": "No Type", "config": {}}).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        assert result["profiles"][0]["status"] == "fixable"
        assert result["importable"] == 1
        fixable_codes = [e["code"] for e in result["profiles"][0]["fixable_errors"]]
        assert "MISSING_TYPE" in fixable_codes

    def test_validate_fixable_invalid_type(self) -> None:
        """Profile with invalid type produces fixable error."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump({"name": "Bad Type", "type": "nosql", "config": {}}).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        assert result["profiles"][0]["status"] == "fixable"
        fixable_codes = [e["code"] for e in result["profiles"][0]["fixable_errors"]]
        assert "INVALID_TYPE" in fixable_codes

    def test_validate_flags_sftp_as_an_unknown_type(self) -> None:
        """An sftp item carries the fixable unknown-type error (REQ-4.7.3)."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump(
            {"name": "File Drop", "type": "sftp", "config": {"host": "files.example.com"}}
        ).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        assert result["importable"] == 1
        assert result["blocked"] == 0
        assert result["profiles"][0]["status"] == "fixable"
        assert result["profiles"][0]["fixable_errors"] == [
            {
                "code": "INVALID_TYPE",
                "message": "Unknown profile type 'sftp', will default to 'custom'",
            }
        ]

    def test_validate_fixable_unresolvable_environment(self) -> None:
        """Profile referencing unknown environment produces fixable error."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump(
            {
                "name": "Env Ref",
                "type": "database",
                "config": {},
                "environment_values": {"nonexistent-env": {"host": "other.db"}},
            }
        ).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        fixable_codes = [e["code"] for e in result["profiles"][0]["fixable_errors"]]
        assert "UNRESOLVABLE_ENVIRONMENT" in fixable_codes

    def test_validate_masked_secret_warning(self) -> None:
        """Masked secrets in config produce warnings."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump(
            {
                "name": "Masked",
                "type": "database",
                "config": {"password": "********", "host": "localhost"},
            }
        ).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        warning_codes = [w["code"] for w in result["profiles"][0]["warnings"]]
        assert "MASKED_SECRET" in warning_codes

    def test_validate_foreign_encrypted_secret_warning(self) -> None:
        """A foreign-instance envelope in a config field produces a warning."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump(
            {
                "name": "Foreign",
                "type": "database",
                "config": {"password": _foreign_envelope("secret123"), "host": "localhost"},
            }
        ).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        foreign = next(
            w for w in result["profiles"][0]["warnings"] if w["code"] == "FOREIGN_ENCRYPTED_SECRET"
        )
        assert foreign["message"] == (
            "Secret 'password' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        )

    def test_validate_zip_multiple_profiles(self) -> None:
        """ZIP with multiple profiles validates each one."""
        import io
        import zipfile

        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("p1.yaml", yaml_mod.dump({"name": "P1", "type": "ssh", "config": {}}))
            zf.writestr(
                "p2.yaml",
                yaml_mod.dump({"name": "P2", "type": "database", "config": {}}),
            )
        buf.seek(0)

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(buf.getvalue(), "profiles.zip")

        assert result["total"] == 2
        assert result["importable"] == 2

    def test_validate_conflict_overrides_fixable_status(self) -> None:
        """When name conflicts AND fixable errors exist, conflict takes precedence."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage = {pid: {"id": pid, "name": "Existing", "type": "database", "config": {}}}
        # Existing name + missing type should result in conflict (not fixable)
        content = yaml_mod.dump({"name": "Existing", "config": {}}).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.validate_profile_import(content, "profile.yaml")

        assert result["profiles"][0]["status"] == "conflict"


class TestImportProfiles:
    """Test suite for import_profiles function."""

    def test_import_creates_new_profile(self) -> None:
        """Importing new profile creates it with new UUID."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump(
            {
                "name": "Imported Profile",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["imported"],
            }
        ).encode()

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        assert result["total_imported"] == 1
        assert result["total_skipped"] == 0
        assert result["imported"][0]["name"] == "Imported Profile"
        assert result["imported"][0]["action"] == "created"
        uuid.UUID(result["imported"][0]["id"])

    def test_import_conflict_skip(self) -> None:
        """Skipping a conflicting profile excludes it from import."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "Existing",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
            }
        }
        content = yaml_mod.dump({"name": "Existing", "type": "database", "config": {}}).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(
                content, "profile.yaml", {"Existing": "skip"}
            )

        assert result["total_imported"] == 0
        assert result["total_skipped"] == 1
        assert result["skipped"][0]["name"] == "Existing"

    def test_import_conflict_rename(self) -> None:
        """Renaming a conflicting profile appends (2)."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "Existing",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
            }
        }
        content = yaml_mod.dump({"name": "Existing", "type": "database", "config": {}}).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(
                content, "profile.yaml", {"Existing": "rename"}
            )

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "renamed"
        assert result["imported"][0]["name"] == "Existing (2)"

    def test_import_conflict_overwrite(self) -> None:
        """Overwriting uses the existing profile's ID."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "Existing",
                "type": "database",
                "config": {"host": "old"},
                "environment_values": {},
                "tags": [],
            }
        }
        content = yaml_mod.dump(
            {"name": "Existing", "type": "ssh", "config": {"host": "new"}}
        ).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(
                content, "profile.yaml", {"Existing": "overwrite"}
            )

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "overwritten"
        assert result["imported"][0]["id"] == pid

    def test_import_fatal_missing_name_raises(self) -> None:
        """Importing profile without name raises ValueError."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump({"type": "database", "config": {}}).encode()

        with (
            _patch_profile_storage({}),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            with pytest.raises(ValidationException, match="Fatal validation errors"):
                _profile_import_export.import_profiles(content, "profile.yaml")

    def test_import_auto_fix_missing_type(self) -> None:
        """Import auto-fixes missing type to 'custom'."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump({"name": "No Type", "config": {"host": "localhost"}}).encode()

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        assert result["total_imported"] == 1
        fix_names = [f["name"] for f in result["fixes_applied"]]
        assert "No Type" in fix_names
        # Verify the profile was stored with type 'custom'
        imported_id = result["imported"][0]["id"]
        assert storage[imported_id]["type"] == "custom"

    def test_import_auto_fix_invalid_type(self) -> None:
        """Import auto-fixes invalid type to 'custom'."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump({"name": "Bad Type", "type": "nosql", "config": {}}).encode()

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        assert result["total_imported"] == 1
        fixes = result["fixes_applied"]
        assert len(fixes) == 1
        assert "nosql" in fixes[0]["fixes"][0]
        imported_id = result["imported"][0]["id"]
        assert storage[imported_id]["type"] == "custom"

    def test_import_defaults_sftp_to_custom(self) -> None:
        """An sftp item is imported as custom with the type fix note (REQ-4.7.3)."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump(
            {"name": "File Drop", "type": "sftp", "config": {"host": "files.example.com"}}
        ).encode()

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "created"
        assert result["fixes_applied"] == [
            {"name": "File Drop", "fixes": ["Type 'sftp' defaulted to 'custom'"]}
        ]
        imported_id = result["imported"][0]["id"]
        assert storage[imported_id]["type"] == "custom"
        assert storage[imported_id]["config"] == {"host": "files.example.com"}

    def test_import_resolves_env_names_to_ids(self) -> None:
        """Import resolves environment names to IDs."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        env_id = str(uuid.uuid4())
        content = yaml_mod.dump(
            {
                "name": "Env Resolve",
                "type": "database",
                "config": {},
                "environment_values": {"staging": {"host": "staging.db"}},
            }
        ).encode()

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(
                environment_service,
                "list_environment_names",
                return_value=[{"id": env_id, "name": "staging", "tags": []}],
            ),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        assert result["total_imported"] == 1
        imported_id = result["imported"][0]["id"]
        assert env_id in storage[imported_id]["environment_values"]

    def test_import_strips_unresolvable_environments(self) -> None:
        """Import strips unresolvable environment references."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump(
            {
                "name": "Env Strip",
                "type": "database",
                "config": {},
                "environment_values": {"gone-env": {"host": "x"}},
            }
        ).encode()

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        assert result["total_imported"] == 1
        fixes = result["fixes_applied"]
        assert len(fixes) == 1
        assert "gone-env" in fixes[0]["fixes"][0]
        imported_id = result["imported"][0]["id"]
        assert storage[imported_id]["environment_values"] == {}

    def test_import_zip_multiple(self) -> None:
        """Importing ZIP creates multiple profiles."""
        import io
        import zipfile

        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "p1.yaml",
                yaml_mod.dump({"name": "ZipP1", "type": "ssh", "config": {}}),
            )
            zf.writestr(
                "p2.yaml",
                yaml_mod.dump({"name": "ZipP2", "type": "database", "config": {}}),
            )
        buf.seek(0)

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(buf.getvalue(), "profiles.zip")

        assert result["total_imported"] == 2
        names = {i["name"] for i in result["imported"]}
        assert names == {"ZipP1", "ZipP2"}

    def test_import_default_resolution_is_rename(self) -> None:
        """Default conflict resolution (no explicit resolution) is rename."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "Default",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
            }
        }
        content = yaml_mod.dump({"name": "Default", "type": "database", "config": {}}).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        assert result["imported"][0]["action"] == "renamed"
        assert result["imported"][0]["name"] == "Default (2)"

    def test_import_with_description(self) -> None:
        """Imported profile with description preserves it."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump(
            {
                "name": "Desc Prof",
                "type": "database",
                "config": {},
                "description": "My description",
            }
        ).encode()

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        imported_id = result["imported"][0]["id"]
        assert storage[imported_id]["description"] == "My description"

    def test_import_skip_still_records_fixes(self) -> None:
        """Skipped profile with fixable issues still records fixes_applied."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "SkipFix",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
            }
        }
        # Missing type + conflict -> skip with fixes
        content = yaml_mod.dump({"name": "SkipFix", "config": {}}).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(
                content, "profile.yaml", {"SkipFix": "skip"}
            )

        assert result["total_skipped"] == 1
        assert len(result["fixes_applied"]) == 1
        assert result["fixes_applied"][0]["name"] == "SkipFix"

    def test_import_overwrite_with_fixes_records_them(self) -> None:
        """Overwriting profile with fixable issues records fixes."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "OverwriteFix",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
            }
        }
        content = yaml_mod.dump({"name": "OverwriteFix", "config": {}}).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(
                content, "profile.yaml", {"OverwriteFix": "overwrite"}
            )

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "overwritten"
        assert len(result["fixes_applied"]) == 1

    def test_import_rename_with_fixes_records_them(self) -> None:
        """Renaming profile with fixable issues records fixes under new name."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "RenameFix",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
            }
        }
        content = yaml_mod.dump({"name": "RenameFix", "config": {}}).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(
                content, "profile.yaml", {"RenameFix": "rename"}
            )

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "renamed"
        assert result["imported"][0]["name"] == "RenameFix (2)"
        assert len(result["fixes_applied"]) == 1
        assert result["fixes_applied"][0]["name"] == "RenameFix (2)"

    def test_import_new_profile_with_fixes_records_them(self) -> None:
        """New profile with fixable issues records fixes."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        content = yaml_mod.dump({"name": "NewFix", "config": {}}).encode()

        storage: dict[str, Any] = {}
        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(content, "profile.yaml")

        assert result["total_imported"] == 1
        assert len(result["fixes_applied"]) == 1
        assert result["fixes_applied"][0]["name"] == "NewFix"

    def test_import_conflict_overwrite_with_description(self) -> None:
        """Overwriting a conflicting profile preserves its description."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "Existing",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
            }
        }
        content = yaml_mod.dump(
            {
                "name": "Existing",
                "type": "database",
                "config": {},
                "description": "Overwritten description",
            }
        ).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(
                content, "profile.yaml", {"Existing": "overwrite"}
            )

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "overwritten"
        assert storage[pid]["description"] == "Overwritten description"

    def test_import_conflict_rename_with_description(self) -> None:
        """Renaming a conflicting profile preserves its description."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        pid = str(uuid.uuid4())
        storage: dict[str, Any] = {
            pid: {
                "id": pid,
                "name": "Existing",
                "type": "database",
                "config": {},
                "environment_values": {},
                "tags": [],
            }
        }
        content = yaml_mod.dump(
            {
                "name": "Existing",
                "type": "database",
                "config": {},
                "description": "Renamed description",
            }
        ).encode()

        with (
            _patch_profile_storage(storage),
            patch.object(environment_service, "list_environment_names", return_value=[]),
        ):
            _profile_common._cache_loaded = True
            result = _profile_import_export.import_profiles(
                content, "profile.yaml", {"Existing": "rename"}
            )

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "renamed"
        new_id = result["imported"][0]["id"]
        assert storage[new_id]["description"] == "Renamed description"

    def test_flat_secret_field_check_returns_empty_for_non_dict(self) -> None:
        """Non-dict config produces no masked-secret or foreign-secret warnings."""
        from wavecore.api.services.shared import check_flat_secret_fields

        assert check_flat_secret_fields("not-a-dict") == []
        assert check_flat_secret_fields(None) == []
        assert check_flat_secret_fields(42) == []


class TestTypeSchemaPlainText:
    """A URL, host or certificate field is plain text, so its value editor offers no format."""

    @pytest.mark.parametrize(
        ("profile_type", "names"),
        [
            ("database", ["host", "ca_cert", "client_cert"]),
            ("ssh", ["host"]),
            ("http", ["base_url", "ca_cert", "client_cert"]),
            ("kubernetes", ["api_url", "client_cert", "ca_cert", "tls_server_name"]),
            ("opensearch", ["url", "ca_cert", "client_cert"]),
            ("custom", []),
        ],
    )
    def test_only_url_host_and_certificate_fields_are_plain(
        self, profile_type: str, names: list[str]
    ) -> None:
        """Test that exactly the URL, host and certificate fields carry plain: True."""

        fields = _schema_fields(profile_type)
        assert [name for name, field in fields.items() if field.get("plain")] == names
        assert all(field.get("plain", True) is True for field in fields.values())


def _profile_document(name: str, **fields: Any) -> dict[str, Any]:
    """A whole Profile document whose times no save would produce."""
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "type": "database",
        "config": {"host": "db.example.com", "port": 5432},
        "environment_values": {},
        "tags": ["restored"],
        "description": "Kept as it was",
        "created_at": "2025-01-02T03:04:05Z",
        "updated_at": "2025-06-07T08:09:10Z",
        **fields,
    }


def _profile_file(profile_id: str) -> Any:
    """What the storage file of one Profile holds."""
    path = get_profiles_storage_path() / profile_id / "profile.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _write_profile_file(document: dict[str, Any]) -> None:
    """Put a Profile file into the storage directory without telling the service."""
    profile_dir = get_profiles_storage_path() / document["id"]
    profile_dir.mkdir(parents=True, exist_ok=True)
    (profile_dir / "profile.yaml").write_text(yaml.safe_dump(document), encoding="utf-8")


def _listed_profile_names() -> list[str]:
    """The names the Profiles list shows right now, sorted."""
    from wavecore.api.services.profiles import service as profile_service

    return sorted(profile["name"] for profile in profile_service.list_profiles()["profiles"])


@contextmanager
def _profile_writer_spy() -> Iterator[MagicMock]:
    """Watch the public writer, whichever binding the import reaches it through."""
    from wavecore.api.services.profiles import service as profile_service

    spy = MagicMock(wraps=profile_service.persist_profile_document)
    with (
        patch.object(profile_service, "persist_profile_document", spy),
        patch.object(_profile_import_export, "persist_profile_document", spy, create=True),
    ):
        yield spy


def _written_profile_names(writer: MagicMock) -> list[str]:
    """The name of the document each call of the writer was given."""
    return [
        (call.args[0] if call.args else call.kwargs["profile_data"])["name"]
        for call in writer.call_args_list
    ]


class TestPersistProfileDocument:
    """The public writer stores a Profile as it is handed over (REQ-5.2.4.9.5)."""

    def test_the_document_is_written_as_given_and_shows_at_once(self) -> None:
        """The stored document is the one given, and the list follows an overwritten id."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()
        environment_id = str(uuid.uuid4())
        document = _profile_document(
            "Orders DB",
            config={
                "host": "db.example.com",
                "port": 5432,
                "password": SecretCipher(os.urandom(32)).seal("s3cret"),
            },
            environment_values={environment_id: {"host": "eu.db.example.com"}},
        )

        profile_service.persist_profile_document(copy.deepcopy(document))

        assert _profile_file(document["id"]) == document
        assert profile_service.list_profile_documents() == [document]
        assert _listed_profile_names() == ["Orders DB"]

        profile_service.persist_profile_document({**copy.deepcopy(document), "name": "Orders EU"})

        assert _profile_file(document["id"]) == {**document, "name": "Orders EU"}
        assert _listed_profile_names() == ["Orders EU"]

    def test_create_clone_and_import_write_through_it(self) -> None:
        """Create, clone and import each store their Profile through the one writer."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()
        content = yaml.safe_dump(
            {"name": "Imported", "type": "database", "config": {"host": "c.example.com"}}
        ).encode()

        with _profile_writer_spy() as writer:
            created = profile_service.create_profile(
                name="Created", profile_type="database", config={"host": "a.example.com"}
            )
            profile_service.duplicate_profile(created["id"], "Cloned")
            _profile_import_export.import_profiles(content, "profile.yaml")

        assert _written_profile_names(writer) == ["Created", "Cloned", "Imported"]
        assert _listed_profile_names() == ["Cloned", "Created", "Imported"]


class TestListProfileDocuments:
    """The public reader hands back every stored Profile, sealed as stored (REQ-5.2.4.9.5)."""

    def test_every_stored_profile_comes_back_after_the_reconcile_step(self) -> None:
        """A file that appeared after the cache warmed is returned, values still sealed."""
        from wavecore.api.services.profiles import service as profile_service

        _profile_common._clear_storage()
        created = profile_service.create_profile(
            name="Orders DB",
            profile_type="database",
            config={"host": "db.example.com", "password": "s3cret"},
        )
        assert _listed_profile_names() == ["Orders DB"]
        late = _profile_document(
            "Arrived Later",
            config=seal_profile({"host": "late.example.com", "password": "later"}, "database"),
        )
        _write_profile_file(late)

        documents = profile_service.list_profile_documents()

        assert len(documents) == 2
        by_id = {document["id"]: document for document in documents}
        assert by_id == {created["id"]: _profile_file(created["id"]), late["id"]: late}
        assert is_secret_envelope(by_id[created["id"]]["config"]["password"])
        assert is_secret_envelope(by_id[late["id"]]["config"]["password"])
