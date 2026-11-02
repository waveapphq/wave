"""
Tests for Connection Profile Storage and Serialization

Tests that ConnectionProfile can be stored and loaded like other entities (Plugin, Block, etc.).
"""

import json

import pytest
import yaml

from wavecore.models.profiles.base import ConnectionProfile, Endpoint, SQLPoolConfig
from wavecore.storage.file_storage import FileBasedStorage


class TestConnectionProfileSerialization:
    """Test serialization to/from YAML and JSON."""

    def test_profile_serialize_to_dict(self):
        """Test converting profile to dictionary."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            blacklist_duration=120,
        )

        # Should be serializable to dict
        data = profile.model_dump()

        assert data["id"] == "test-api"
        assert data["name"] == "Test API"
        assert data["protocol"] == "http"
        assert data["blacklist_duration"] == 120
        assert len(data["endpoints"]) == 1

    def test_profile_serialize_to_json(self):
        """Test serializing profile to JSON."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
        )

        # Should be JSON serializable
        json_str = profile.model_dump_json()
        data = json.loads(json_str)

        assert data["id"] == "test-api"
        assert data["endpoints"][0]["host"] == "api.example.com"

    def test_profile_deserialize_from_dict(self):
        """Test creating profile from dictionary."""
        data = {
            "id": "test-api",
            "name": "Test API",
            "protocol": "http",
            "endpoints": [{"protocol": "http", "host": "api.example.com", "port": 443}],
            "blacklist_duration": 60,
        }

        profile = ConnectionProfile(**data)

        assert profile.id == "test-api"
        assert profile.name == "Test API"
        assert len(profile.endpoints) == 1
        assert profile.endpoints[0].host == "api.example.com"

    def test_profile_round_trip_json(self):
        """Test serialize to JSON and deserialize back."""
        endpoint = Endpoint(
            protocol="http",
            host="api.example.com",
            port=443,
            credentials={"token": "secret"},
        )
        original = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            blacklist_duration=90,
            description="Test description",
        )

        # Serialize to JSON
        json_str = original.model_dump_json()

        # Deserialize back
        data = json.loads(json_str)
        restored = ConnectionProfile(**data)

        assert restored.id == original.id
        assert restored.name == original.name
        assert restored.blacklist_duration == original.blacklist_duration
        assert restored.description == original.description
        assert len(restored.endpoints) == len(original.endpoints)
        assert restored.endpoints[0].host == original.endpoints[0].host

    def test_profile_with_pool_config_serialization(self):
        """Test serializing profile with pool configuration."""
        endpoint = Endpoint(protocol="sql", host="db.example.com", port=5432)
        pool_config = SQLPoolConfig(pool_min_size=5, pool_max_size=20)
        profile = ConnectionProfile(
            id="test-db",
            name="Test DB",
            protocol="sql",
            endpoints=[endpoint],
            pool_config=pool_config,
        )

        # Serialize and deserialize
        json_str = profile.model_dump_json()
        data = json.loads(json_str)
        restored = ConnectionProfile(**data)

        assert isinstance(restored.pool_config, SQLPoolConfig)
        assert restored.pool_config.pool_max_size == 20

    def test_profile_with_multiple_endpoints_serialization(self):
        """Test serializing profile with multiple endpoints."""
        endpoints = [
            Endpoint(protocol="http", host="api1.example.com", port=443),
            Endpoint(protocol="http", host="api2.example.com", port=443),
            Endpoint(protocol="http", host="api3.example.com", port=443),
        ]
        profile = ConnectionProfile(
            id="test-api", name="Test API", protocol="http", endpoints=endpoints
        )

        json_str = profile.model_dump_json()
        data = json.loads(json_str)
        restored = ConnectionProfile(**data)

        assert len(restored.endpoints) == 3
        assert restored.endpoints[0].host == "api1.example.com"
        assert restored.endpoints[1].host == "api2.example.com"
        assert restored.endpoints[2].host == "api3.example.com"


class TestFileBasedStorageInitialization:
    """Test FileBasedStorage initialization."""

    def test_init_with_root_dir(self, tmp_path):
        """Test initialization with root_dir parameter."""
        storage = FileBasedStorage(root_dir=str(tmp_path))
        assert storage.base_path == tmp_path

    def test_init_with_base_path(self, tmp_path):
        """Test initialization with base_path parameter."""
        storage = FileBasedStorage(base_path=tmp_path)
        assert storage.base_path == tmp_path

    def test_init_without_parameters_raises_error(self):
        """Test that initialization without parameters raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            FileBasedStorage()
        assert "base_path" in str(exc_info.value) or "root_dir" in str(exc_info.value)


class TestConnectionProfileStorage:
    """Test storage operations via FileStorage."""

    @pytest.fixture
    def temp_storage(self, tmp_path):
        """Create temporary file storage."""
        return FileBasedStorage(base_path=tmp_path)

    def test_save_and_load_profile(self, temp_storage):
        """Test saving and loading a profile."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            blacklist_duration=120,
        )

        # Save profile
        temp_storage.save_profile(profile)

        # Load profile
        loaded = temp_storage.load_profile("test-api")

        assert loaded.id == profile.id
        assert loaded.name == profile.name
        assert loaded.blacklist_duration == profile.blacklist_duration
        assert len(loaded.endpoints) == len(profile.endpoints)

    def test_save_profile_as_yaml(self, temp_storage):
        """Test that profile is saved as YAML by default."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api", name="Test API", protocol="http", endpoints=[endpoint]
        )

        temp_storage.save_profile(profile, format="yaml")

        # Check file exists and is valid YAML
        profile_path = temp_storage.base_path / "profiles" / "test-api" / "test-api.yaml"
        assert profile_path.exists()

        with open(profile_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)

        assert data["id"] == "test-api"

    def test_save_profile_as_json(self, temp_storage):
        """Test saving profile as JSON."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api", name="Test API", protocol="http", endpoints=[endpoint]
        )

        temp_storage.save_profile(profile, format="json")

        # Check file exists and is valid JSON
        profile_path = temp_storage.base_path / "profiles" / "test-api" / "test-api.json"
        assert profile_path.exists()

        with open(profile_path, encoding="utf-8") as f:
            data = json.load(f)

        assert data["id"] == "test-api"

    def test_list_profiles(self, temp_storage):
        """Test listing all profiles."""
        # Save multiple profiles
        for i in range(3):
            endpoint = Endpoint(protocol="http", host=f"api{i}.example.com", port=443)
            profile = ConnectionProfile(
                id=f"test-api-{i}",
                name=f"Test API {i}",
                protocol="http",
                endpoints=[endpoint],
            )
            temp_storage.save_profile(profile)

        # List profiles
        profiles = temp_storage.list_profiles()

        assert len(profiles) == 3
        assert "test-api-0" in profiles
        assert "test-api-1" in profiles
        assert "test-api-2" in profiles

    def test_delete_profile(self, temp_storage):
        """Test deleting a profile."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api", name="Test API", protocol="http", endpoints=[endpoint]
        )

        temp_storage.save_profile(profile)
        assert temp_storage.profile_exists("test-api")

        temp_storage.delete_profile("test-api")
        assert not temp_storage.profile_exists("test-api")

    def test_load_nonexistent_profile(self, temp_storage):
        """Test loading a profile that doesn't exist."""
        with pytest.raises(FileNotFoundError):
            temp_storage.load_profile("nonexistent")

    def test_delete_nonexistent_profile(self, temp_storage):
        """Test deleting a profile that doesn't exist."""
        with pytest.raises(FileNotFoundError):
            temp_storage.delete_profile("nonexistent")

    def test_save_profile_preserves_metadata(self, temp_storage):
        """Test that metadata fields are preserved."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api",
            name="Test API",
            protocol="http",
            endpoints=[endpoint],
            description="Test profile for API",
            author="test-user",
            tags=["production", "critical"],
        )

        temp_storage.save_profile(profile)
        loaded = temp_storage.load_profile("test-api")

        assert loaded.description == profile.description
        assert loaded.author == profile.author
        assert loaded.tags == profile.tags
        assert loaded.created_at is not None
        assert loaded.updated_at is not None

    def test_save_profile_disallow_overwrite(self, temp_storage):
        """Test that saving profile with allow_overwrite=False raises error."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api", name="Test API", protocol="http", endpoints=[endpoint]
        )

        # Save once
        temp_storage.save_profile(profile)

        # Try to save again with allow_overwrite=False
        with pytest.raises(FileExistsError):
            temp_storage.save_profile(profile, allow_overwrite=False)

    def test_load_profile_tries_alternate_format(self, temp_storage):
        """Test that load_profile tries alternate format if primary not found."""
        endpoint = Endpoint(protocol="http", host="api.example.com", port=443)
        profile = ConnectionProfile(
            id="test-api", name="Test API", protocol="http", endpoints=[endpoint]
        )

        # Save as JSON
        temp_storage.save_profile(profile, format="json")

        # Try to load as YAML (should fall back to JSON)
        loaded = temp_storage.load_profile("test-api", format="yaml")
        assert loaded.id == "test-api"

    def test_load_profile_no_format_exists(self, temp_storage):
        """Test loading profile when profile dir exists but no format files exist."""
        # Create profile directory without any files
        profile_dir = temp_storage.base_path / "profiles" / "empty-profile"
        profile_dir.mkdir(parents=True, exist_ok=True)

        # Try to load - should raise FileNotFoundError
        with pytest.raises(FileNotFoundError):
            temp_storage.load_profile("empty-profile")
