"""Unit tests for environment service (REQ-5.2.1.42).

This module tests the environment service layer implementing business logic
for environment management including CRUD operations, usage calculation,
and delete protection for referenced environments.

Test Coverage:
- Environment creation: Name validation, uniqueness, auto-generated fields
- Environment retrieval: Single and list operations
- Environment update: Partial updates, name uniqueness validation
- Environment deletion: Delete protection when referenced by profiles
- Usage calculation: Count profiles referencing each environment
- Validation: Name format, required fields, duplicate detection
"""

import copy
import io
import re
import uuid
import zipfile
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
import yaml

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.api.services.storage_paths import get_environments_storage_path


class TestEnvironmentServiceCreate:
    """Test suite for environment service create operation."""

    def test_create_environment_returns_environment_with_id(self) -> None:
        """Test that create_environment generates UUID and returns environment."""
        from wavecore.api.services.environments import service as environment_service

        result = environment_service.create_environment(
            name="production",
            description="Production environment",
        )

        assert "id" in result
        # Verify UUID format
        uuid.UUID(result["id"])
        assert result["name"] == "production"
        assert result["description"] == "Production environment"

    def test_create_environment_generates_timestamps(self) -> None:
        """Test that create_environment generates created_at and updated_at."""
        from wavecore.api.services.environments import service as environment_service

        before = datetime.now(UTC)
        result = environment_service.create_environment(name="staging")
        after = datetime.now(UTC)

        assert "created_at" in result
        assert "updated_at" in result

        # Parse and validate timestamps are within expected range
        created = datetime.fromisoformat(result["created_at"].replace("Z", "+00:00"))
        updated = datetime.fromisoformat(result["updated_at"].replace("Z", "+00:00"))

        assert before <= created <= after
        assert before <= updated <= after

    def test_create_environment_requires_name(self) -> None:
        """Test that create_environment requires name field."""
        from wavecore.api.services.environments import service as environment_service

        with pytest.raises(ValidationException) as exc_info:
            environment_service.create_environment(name="")

        assert re.match(
            r"^Environment name is required and cannot be empty$",
            str(exc_info.value),
        )

    def test_create_environment_validates_name_whitespace_only(self) -> None:
        """Test that create_environment rejects whitespace-only names."""
        from wavecore.api.services.environments import service as environment_service

        with pytest.raises(ValidationException) as exc_info:
            environment_service.create_environment(name="   ")

        assert re.match(
            r"^Environment name is required and cannot be empty$",
            str(exc_info.value),
        )

    def test_create_environment_validates_name_length(self) -> None:
        """Test that create_environment validates name length."""
        from wavecore.api.services.environments import service as environment_service

        long_name = "a" * 256

        with pytest.raises(ValidationException) as exc_info:
            environment_service.create_environment(name=long_name)

        assert re.match(
            r"^Environment name must be between 1 and 255 characters$",
            str(exc_info.value),
        )

    def test_create_environment_rejects_duplicate_name(self) -> None:
        """Test that create_environment rejects duplicate names."""
        from wavecore.api.services.environments import service as environment_service

        # Clear storage
        environment_service._clear_storage()

        # Create first environment
        environment_service.create_environment(name="production")

        # Attempt duplicate
        with pytest.raises(ConflictException) as exc_info:
            environment_service.create_environment(name="production")

        assert re.match(
            r"^Environment with name 'production' already exists$",
            str(exc_info.value),
        )

    def test_create_environment_allows_optional_description(self) -> None:
        """Test that create_environment allows optional description."""
        from wavecore.api.services.environments import service as environment_service

        result = environment_service.create_environment(name="dev")

        # Description should not be present or be None
        assert result.get("description") is None or "description" not in result

    def test_create_environment_trims_name_whitespace(self) -> None:
        """Test that create_environment trims leading/trailing whitespace from name."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        result = environment_service.create_environment(name="  staging  ")

        assert result["name"] == "staging"


class TestEnvironmentServiceGet:
    """Test suite for environment service get operation."""

    def test_get_environment_returns_environment_by_id(self) -> None:
        """Test that get_environment returns environment by ID."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(
            name="production",
            description="Production environment",
        )

        result = environment_service.get_environment(created["id"])

        assert result is not None
        assert result["id"] == created["id"]
        assert result["name"] == "production"
        assert result["description"] == "Production environment"

    def test_get_environment_returns_none_for_nonexistent(self) -> None:
        """Test that get_environment returns None for non-existent ID."""
        from wavecore.api.services.environments import service as environment_service

        result = environment_service.get_environment(str(uuid.uuid4()))

        assert result is None


class TestEnvironmentServiceList:
    """Test suite for environment service list operation."""

    def test_list_environments_returns_all_environments(self) -> None:
        """Test that list_environments returns all environments."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        _env1 = environment_service.create_environment(name="dev")
        _env2 = environment_service.create_environment(name="staging")
        _env3 = environment_service.create_environment(name="production")

        result = environment_service.list_environments()

        assert len(result["environments"]) == 3
        names = {e["name"] for e in result["environments"]}
        assert names == {"dev", "staging", "production"}

    def test_list_environments_returns_empty_when_none_exist(self) -> None:
        """Test that list_environments returns empty list when none exist."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        result = environment_service.list_environments()

        assert result["environments"] == []
        assert result["total"] == 0

    def test_list_environments_supports_pagination(self) -> None:
        """Test that list_environments supports pagination."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        for i in range(5):
            environment_service.create_environment(name=f"env-{i}")

        result = environment_service.list_environments(page=1, per_page=2)

        assert len(result["environments"]) == 2
        assert result["total"] == 5
        assert result["page"] == 1
        assert result["per_page"] == 2
        assert result["total_pages"] == 3

    def test_list_environments_page_two(self) -> None:
        """Test that list_environments returns correct page 2 results."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        for i in range(5):
            environment_service.create_environment(name=f"env-{i:02d}")

        result = environment_service.list_environments(page=2, per_page=2)

        assert len(result["environments"]) == 2
        assert result["page"] == 2

    def test_list_environments_includes_usage_count(self) -> None:
        """Test that list_environments includes usage count for each environment."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        _env = environment_service.create_environment(name="production")

        result = environment_service.list_environments()

        assert "usage" in result["environments"][0]
        assert isinstance(result["environments"][0]["usage"], int)

    def test_list_environments_supports_search(self) -> None:
        """Test that list_environments supports text search."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="production", description="Live")
        environment_service.create_environment(name="staging", description="Pre-prod")
        environment_service.create_environment(name="development", description="Dev")

        result = environment_service.list_environments(search="prod")

        # Should match "production" (name) and "staging" (description contains "Pre-prod")
        assert result["total"] >= 1


class TestEnvironmentServiceUpdate:
    """Test suite for environment service update operation."""

    def test_update_environment_updates_name(self) -> None:
        """Test that update_environment updates name."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="old-name")

        result = environment_service.update_environment(
            environment_id=created["id"],
            name="new-name",
        )

        assert result is not None
        assert result["name"] == "new-name"

    def test_update_environment_updates_description(self) -> None:
        """Test that update_environment updates description."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(
            name="env",
            description="Old description",
        )

        result = environment_service.update_environment(
            environment_id=created["id"],
            description="New description",
        )

        assert result is not None
        assert result["description"] == "New description"

    def test_update_environment_updates_timestamp(self) -> None:
        """Test that update_environment updates updated_at timestamp."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="env")
        original_updated = created["updated_at"]

        # Small delay to ensure timestamp difference
        result = environment_service.update_environment(
            environment_id=created["id"],
            name="updated-env",
        )

        assert result is not None
        assert result["updated_at"] >= original_updated

    def test_update_environment_returns_none_for_nonexistent(self) -> None:
        """Test that update_environment returns None for non-existent ID."""
        from wavecore.api.services.environments import service as environment_service

        result = environment_service.update_environment(
            environment_id=str(uuid.uuid4()),
            name="new-name",
        )

        assert result is None

    def test_update_environment_rejects_duplicate_name(self) -> None:
        """Test that update_environment rejects duplicate names."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        _env1 = environment_service.create_environment(name="first")
        env2 = environment_service.create_environment(name="second")

        with pytest.raises(ConflictException) as exc_info:
            environment_service.update_environment(
                environment_id=env2["id"],
                name="first",
            )

        assert re.match(
            r"^Environment with name 'first' already exists$",
            str(exc_info.value),
        )

    def test_update_environment_allows_same_name_for_same_entity(self) -> None:
        """Test that update_environment allows keeping same name."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="my-env")

        # Update with same name should succeed
        result = environment_service.update_environment(
            environment_id=created["id"],
            name="my-env",
            description="Updated description",
        )

        assert result is not None
        assert result["name"] == "my-env"
        assert result["description"] == "Updated description"

    def test_update_environment_partial_update_name_only(self) -> None:
        """Test that update_environment supports partial update (name only)."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(
            name="original",
            description="Original description",
        )

        result = environment_service.update_environment(
            environment_id=created["id"],
            name="updated",
        )

        assert result is not None
        assert result["name"] == "updated"
        # Description should be preserved
        assert result["description"] == "Original description"

    def test_update_environment_partial_update_description_only(self) -> None:
        """Test that update_environment supports partial update (description only)."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(
            name="my-env",
            description="Original",
        )

        result = environment_service.update_environment(
            environment_id=created["id"],
            description="Updated",
        )

        assert result is not None
        assert result["name"] == "my-env"
        assert result["description"] == "Updated"


class TestEnvironmentServiceDelete:
    """Test suite for environment service delete operation."""

    def test_delete_environment_returns_true_on_success(self) -> None:
        """Test that delete_environment returns True when successful."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="to-delete")

        result = environment_service.delete_environment(created["id"])

        assert result is True

    def test_delete_environment_returns_false_for_nonexistent(self) -> None:
        """Test that delete_environment returns False for non-existent ID."""
        from wavecore.api.services.environments import service as environment_service

        result = environment_service.delete_environment(str(uuid.uuid4()))

        assert result is False

    def test_delete_environment_removes_from_storage(self) -> None:
        """Test that delete_environment actually removes the environment."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="to-delete")
        environment_service.delete_environment(created["id"])

        result = environment_service.get_environment(created["id"])

        assert result is None

    def test_delete_environment_succeeds_when_in_use(self) -> None:
        """Delete is not blocked by usage; values are dropped from profiles."""
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.profiles import _common as _profile_common

        environment_service._clear_storage()
        _profile_common._clear_storage()

        created = environment_service.create_environment(name="in-use")
        env_id = created["id"]
        other_env_id = "11111111-1111-1111-1111-111111111111"

        profile_id = "22222222-2222-2222-2222-222222222222"
        _profile_common._profile_storage[profile_id] = {
            "id": profile_id,
            "name": "p1",
            "type": "custom",
            "config": {},
            "environment_values": {
                env_id: {"k": {"type": "string", "secret": False, "value": "v"}},
                other_env_id: {"k": {"type": "string", "secret": False, "value": "v2"}},
            },
            "updated_at": "2026-01-01T00:00:00Z",
        }

        result = environment_service.delete_environment(env_id)

        assert result is True
        # Env removed from profile, other env retained.
        env_values = _profile_common._profile_storage[profile_id]["environment_values"]
        assert env_id not in env_values
        assert other_env_id in env_values

    def test_delete_environment_allowed_when_not_in_use(self) -> None:
        """Test that delete_environment succeeds when environment is not in use."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="not-in-use")

        result = environment_service.delete_environment(created["id"])

        assert result is True


class TestEnvironmentServiceUsageCalculation:
    """Test suite for environment usage calculation."""

    def test_get_environment_includes_usage(self) -> None:
        """Test that get_environment includes usage count."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="production")

        with patch("wavecore.api.services.environments.service._count_profile_usage") as mock_count:
            mock_count.return_value = 5

            result = environment_service.get_environment(created["id"])

            assert result is not None
            assert result["usage"] == 5

    def test_list_environments_includes_usage_for_each(self) -> None:
        """Test that list_environments includes usage count for each environment."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="dev")
        environment_service.create_environment(name="staging")

        # Mock different usage counts
        def mock_usage(env_id: str) -> int:
            # Return different values based on environment
            return 2 if "dev" in str(env_id) else 5

        with patch("wavecore.api.services.environments.service._count_profile_usage") as mock_count:
            mock_count.side_effect = lambda x: 3  # All return 3

            result = environment_service.list_environments()

            for env in result["environments"]:
                assert "usage" in env
                assert isinstance(env["usage"], int)


class TestEnvironmentServiceDuplicate:
    """Test suite for environment service duplicate operation."""

    def test_duplicate_environment_creates_copy(self) -> None:
        """Test that duplicate_environment creates a copy of the environment."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        original = environment_service.create_environment(
            name="production",
            description="Production environment",
        )

        result = environment_service.duplicate_environment(original["id"])

        assert result is not None
        assert result["id"] != original["id"]
        assert result["name"] == "production (Copy)"
        assert result["description"] == "Production environment"

    def test_duplicate_environment_generates_unique_name(self) -> None:
        """Test that duplicate_environment generates unique copy name."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        original = environment_service.create_environment(name="production")
        copy1 = environment_service.duplicate_environment(original["id"])

        # Second duplicate should get different name
        copy2 = environment_service.duplicate_environment(original["id"])

        assert copy1["name"] != copy2["name"]
        # Names should follow pattern like "production (Copy)", "production (Copy 2)"
        assert "production" in copy1["name"]
        assert "production" in copy2["name"]

    def test_duplicate_environment_returns_none_for_nonexistent(self) -> None:
        """Test that duplicate_environment returns None for non-existent ID."""
        from wavecore.api.services.environments import service as environment_service

        result = environment_service.duplicate_environment(str(uuid.uuid4()))

        assert result is None

    def test_duplicate_environment_generates_new_timestamps(self) -> None:
        """Test that duplicate_environment generates new timestamps."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        original = environment_service.create_environment(name="production")

        result = environment_service.duplicate_environment(original["id"])

        assert result is not None
        # New timestamps should be >= original
        assert result["created_at"] >= original["created_at"]
        assert result["updated_at"] >= original["updated_at"]


class TestEnvironmentServiceListSorting:
    """Test suite for environment service list sorting."""

    def test_list_environments_supports_sort_by_name(self) -> None:
        """Test that list_environments supports sorting by name."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="zebra")
        environment_service.create_environment(name="alpha")
        environment_service.create_environment(name="beta")

        result = environment_service.list_environments(
            sort_by="name",
            sort_direction="asc",
        )

        names = [e["name"] for e in result["environments"]]
        assert names == ["alpha", "beta", "zebra"]

    def test_list_environments_supports_sort_by_name_desc(self) -> None:
        """Test that list_environments supports descending sort by name."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="zebra")
        environment_service.create_environment(name="alpha")
        environment_service.create_environment(name="beta")

        result = environment_service.list_environments(
            sort_by="name",
            sort_direction="desc",
        )

        names = [e["name"] for e in result["environments"]]
        assert names == ["zebra", "beta", "alpha"]

    def test_list_environments_supports_sort_by_created_at(self) -> None:
        """Test that list_environments supports sorting by created_at."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        _env1 = environment_service.create_environment(name="first")
        _env2 = environment_service.create_environment(name="second")
        _env3 = environment_service.create_environment(name="third")

        result = environment_service.list_environments(
            sort_by="created_at",
            sort_direction="asc",
        )

        # Should be in creation order
        assert result["environments"][0]["name"] == "first"

    def test_list_environments_supports_sort_by_description(self) -> None:
        """Test that list_environments supports sorting by description."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="b-env", description="Zebra")
        environment_service.create_environment(name="a-env", description="Alpha")
        environment_service.create_environment(name="c-env")

        result = environment_service.list_environments(
            sort_by="description",
            sort_direction="asc",
        )

        names = [e["name"] for e in result["environments"]]
        # Empty description sorts first, then alphabetical
        assert names == ["c-env", "a-env", "b-env"]

    def test_list_environments_supports_sort_by_tags(self) -> None:
        """Test that list_environments supports sorting by tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="no-tags")
        environment_service.create_environment(name="z-tag", tags=["zebra"])
        environment_service.create_environment(name="a-tag", tags=["alpha"])

        result = environment_service.list_environments(
            sort_by="tags",
            sort_direction="asc",
        )

        names = [e["name"] for e in result["environments"]]
        # Empty tags sort first, then alphabetical
        assert names == ["no-tags", "a-tag", "z-tag"]

    def test_list_environments_supports_sort_by_usage(self) -> None:
        """Test that list_environments supports sorting by usage count."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="unused-env")
        environment_service.create_environment(name="used-env")

        result = environment_service.list_environments(
            sort_by="usage",
            sort_direction="asc",
        )

        # Both should have 0 usage (no profiles reference them)
        names = [e["name"] for e in result["environments"]]
        assert len(names) == 2


class TestEnvironmentServiceNameValidation:
    """Test suite for environment name validation edge cases."""

    def test_create_environment_case_sensitive_names(self) -> None:
        """Test that environment names are case-sensitive (Production != production)."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        env1 = environment_service.create_environment(name="Production")
        env2 = environment_service.create_environment(name="production")

        # Both should exist as separate environments
        assert env1["id"] != env2["id"]
        assert env1["name"] == "Production"
        assert env2["name"] == "production"

    def test_update_environment_clears_description_with_empty_string(self) -> None:
        """Test that update_environment can clear description with empty string."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(
            name="env",
            description="Has description",
        )

        result = environment_service.update_environment(
            environment_id=created["id"],
            description="",
        )

        assert result is not None
        assert result["description"] == "" or result.get("description") is None


class TestEnvironmentServicePaginationEdgeCases:
    """Test suite for pagination edge cases."""

    def test_list_environments_last_page_partial(self) -> None:
        """Test that last page returns partial results correctly."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        for i in range(5):
            environment_service.create_environment(name=f"env-{i}")

        # Page 3 with per_page=2 should have 1 item
        result = environment_service.list_environments(page=3, per_page=2)

        assert len(result["environments"]) == 1
        assert result["total"] == 5
        assert result["total_pages"] == 3

    def test_list_environments_page_beyond_total(self) -> None:
        """Test that page beyond total returns empty list."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="only-one")

        result = environment_service.list_environments(page=10, per_page=20)

        assert result["environments"] == []
        assert result["total"] == 1

    def test_list_environments_default_pagination(self) -> None:
        """Test that list_environments has default pagination values."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        result = environment_service.list_environments()

        # Should have default values
        assert result["page"] == 1
        assert result["per_page"] == 20


class TestEnvironmentServiceSearchBehavior:
    """Test suite for search behavior."""

    def test_list_environments_search_case_insensitive(self) -> None:
        """Test that search is case-insensitive."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="Production")
        environment_service.create_environment(name="STAGING")
        environment_service.create_environment(name="development")

        # Search with lowercase should find uppercase
        result = environment_service.list_environments(search="prod")
        assert result["total"] >= 1

        # Search with uppercase should find lowercase
        result = environment_service.list_environments(search="DEV")
        assert result["total"] >= 1

    def test_list_environments_search_in_description(self) -> None:
        """Test that search checks description field."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(
            name="env1",
            description="This is the live system",
        )
        environment_service.create_environment(
            name="env2",
            description="Testing only",
        )

        result = environment_service.list_environments(search="live")

        assert result["total"] == 1
        assert result["environments"][0]["name"] == "env1"

    def test_list_environments_supports_tags_filter(self) -> None:
        """Test that list_environments filters by tags (OR semantics: match any)."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(
            name="env1",
            tags=["production", "critical"],
        )
        environment_service.create_environment(
            name="env2",
            tags=["staging"],
        )
        environment_service.create_environment(
            name="env3",
            tags=["production"],
        )

        # Filter by single tag
        result = environment_service.list_environments(tags=["production"])

        assert result["total"] == 2
        names = {e["name"] for e in result["environments"]}
        assert names == {"env1", "env3"}

        # OR semantics: selecting production OR staging matches all three
        result = environment_service.list_environments(tags=["production", "staging"])

        assert result["total"] == 3
        names = {e["name"] for e in result["environments"]}
        assert names == {"env1", "env2", "env3"}


class TestEnvironmentServiceClearStorage:
    """Test suite for storage clearing (test utility)."""

    def test_clear_storage_removes_all_environments(self) -> None:
        """Test that _clear_storage removes all environments."""
        from wavecore.api.services.environments import service as environment_service

        # Create some environments
        environment_service.create_environment(name="env1")
        environment_service.create_environment(name="env2")

        # Clear storage
        environment_service._clear_storage()

        result = environment_service.list_environments()
        assert result["total"] == 0


class TestEnvironmentServiceTags:
    """Test suite for environment tags validation (REQ-4.7.4)."""

    def test_create_environment_with_tags(self) -> None:
        """Test that create_environment accepts tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        result = environment_service.create_environment(
            name="production",
            tags=["critical", "live"],
        )

        assert result["tags"] == ["critical", "live"]

    def test_create_environment_without_tags_defaults_to_empty(self) -> None:
        """Test that create_environment defaults tags to empty list."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        result = environment_service.create_environment(name="dev")

        assert result["tags"] == []

    def test_create_environment_validates_tags_must_be_list(self) -> None:
        """Test that create_environment rejects non-list tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        with pytest.raises(ValidationException) as exc_info:
            environment_service.create_environment(
                name="env",
                tags="not-a-list",  # type: ignore[arg-type]
            )

        assert str(exc_info.value) == "Field 'tags' must be a list of strings"

    def test_create_environment_validates_tags_contain_strings(self) -> None:
        """Test that create_environment rejects non-string items in tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        with pytest.raises(ValidationException) as exc_info:
            environment_service.create_environment(
                name="env",
                tags=["valid", 123, "also-valid"],  # type: ignore[list-item]
            )

        assert str(exc_info.value) == "Field 'tags' must contain only strings"

    def test_create_environment_validates_tags_not_empty_strings(self) -> None:
        """Test that create_environment rejects empty string tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        with pytest.raises(ValidationException) as exc_info:
            environment_service.create_environment(
                name="env",
                tags=["valid", "", "also-valid"],
            )

        assert str(exc_info.value) == "Tags cannot contain empty or whitespace-only strings"

    def test_create_environment_validates_tags_not_whitespace_only(self) -> None:
        """Test that create_environment rejects whitespace-only tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        with pytest.raises(ValidationException) as exc_info:
            environment_service.create_environment(
                name="env",
                tags=["valid", "   ", "also-valid"],
            )

        assert str(exc_info.value) == "Tags cannot contain empty or whitespace-only strings"

    def test_create_environment_trims_tag_whitespace(self) -> None:
        """Test that create_environment trims whitespace from tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        result = environment_service.create_environment(
            name="env",
            tags=["  production  ", "  critical  "],
        )

        assert result["tags"] == ["production", "critical"]

    def test_update_environment_with_tags(self) -> None:
        """Test that update_environment accepts and updates tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(
            name="env",
            tags=["old-tag"],
        )

        result = environment_service.update_environment(
            environment_id=created["id"],
            tags=["new-tag1", "new-tag2"],
        )

        assert result is not None
        assert result["tags"] == ["new-tag1", "new-tag2"]

    def test_update_environment_validates_tags(self) -> None:
        """Test that update_environment validates tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="env")

        with pytest.raises(ValidationException) as exc_info:
            environment_service.update_environment(
                environment_id=created["id"],
                tags="not-a-list",  # type: ignore[arg-type]
            )

        assert str(exc_info.value) == "Field 'tags' must be a list of strings"

    def test_duplicate_environment_copies_tags(self) -> None:
        """Test that duplicate_environment copies tags to new environment."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        original = environment_service.create_environment(
            name="production",
            tags=["critical", "live"],
        )

        result = environment_service.duplicate_environment(original["id"])

        assert result is not None
        assert result["tags"] == ["critical", "live"]


class TestEnvironmentServiceFileStorage:
    """Test suite for file-based storage persistence (REQ-6.1.6).

    These tests verify that environment_service uses file-based YAML storage
    following the same pattern as test_service, suite_service, and regression_service.
    """

    def test_environment_persists_to_file(self, tmp_path: Any) -> None:
        """Test that created environments are persisted to YAML files."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.environments import service as environment_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        environment_service._clear_storage()

        # Create an environment
        env = environment_service.create_environment(
            name="production",
            description="Production environment",
            tags=["live", "critical"],
        )

        # Verify file exists
        env_dir = storage_paths.get_environments_storage_path() / env["id"]
        env_file = env_dir / "environment.yaml"
        assert env_file.exists(), "Environment file should be persisted to disk"

    def test_environment_loads_from_file_on_restart(self, tmp_path: Any) -> None:
        """Test that environments are loaded from files after storage reset."""

        from wavecore.api.services import storage_paths
        from wavecore.api.services.environments import service as environment_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        environment_service._clear_storage()

        # Create an environment
        env = environment_service.create_environment(
            name="staging",
            description="Staging environment",
        )
        env_id = env["id"]

        # Simulate service restart by clearing in-memory cache
        # but NOT clearing disk storage
        environment_service._clear_in_memory_cache()

        # Environment should still be retrievable (loaded from disk)
        loaded = environment_service.get_environment(env_id)
        assert loaded is not None
        assert loaded["name"] == "staging"
        assert loaded["description"] == "Staging environment"

    def test_clear_storage_removes_files(self, tmp_path: Any) -> None:
        """Test that _clear_storage removes environment files from disk."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.environments import service as environment_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        environment_service._clear_storage()

        # Create environments
        env1 = environment_service.create_environment(name="env-1")
        env2 = environment_service.create_environment(name="env-2")

        # Verify files exist
        env_storage = storage_paths.get_environments_storage_path()
        assert (env_storage / env1["id"]).exists()
        assert (env_storage / env2["id"]).exists()

        # Clear storage
        environment_service._clear_storage()

        # Files should be removed (or directory should be empty)
        remaining = list(env_storage.iterdir()) if env_storage.exists() else []
        assert len(remaining) == 0, "All environment files should be removed"

    def test_update_environment_persists_changes(self, tmp_path: Any) -> None:
        """Test that updated environments are persisted to disk."""
        import yaml

        from wavecore.api.services import storage_paths
        from wavecore.api.services.environments import service as environment_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        environment_service._clear_storage()

        # Create and update environment
        env = environment_service.create_environment(name="test-env")
        environment_service.update_environment(
            env["id"],
            name="updated-env",
            description="Updated description",
        )

        # Read from file directly
        env_file = storage_paths.get_environments_storage_path() / env["id"] / "environment.yaml"
        with open(env_file, encoding="utf-8") as f:
            persisted = yaml.safe_load(f)

        assert persisted["name"] == "updated-env"
        assert persisted["description"] == "Updated description"

    def test_delete_environment_removes_file(self, tmp_path: Any) -> None:
        """Test that deleted environments have their files removed."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.environments import service as environment_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        environment_service._clear_storage()

        # Create environment
        env = environment_service.create_environment(name="to-delete")
        env_dir = storage_paths.get_environments_storage_path() / env["id"]

        # Verify file exists
        assert env_dir.exists()

        # Delete environment
        environment_service.delete_environment(env["id"])

        # File should be removed
        assert not env_dir.exists()

    def test_list_environments_loads_all_from_disk(self, tmp_path: Any) -> None:
        """Test that list_environments loads all environments from disk."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.environments import service as environment_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        environment_service._clear_storage()

        # Create multiple environments
        environment_service.create_environment(name="env-a")
        environment_service.create_environment(name="env-b")
        environment_service.create_environment(name="env-c")

        # Clear in-memory cache to simulate restart
        environment_service._clear_in_memory_cache()

        # List should load all from disk
        result = environment_service.list_environments()

        assert result["total"] == 3
        names = {e["name"] for e in result["environments"]}
        assert names == {"env-a", "env-b", "env-c"}

    def test_duplicate_environment_persists_copy(self, tmp_path: Any) -> None:
        """Test that duplicated environments are persisted to disk."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.environments import service as environment_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        environment_service._clear_storage()

        # Create and duplicate environment
        original = environment_service.create_environment(
            name="original",
            description="Original env",
            tags=["tag1"],
        )
        duplicate = environment_service.duplicate_environment(original["id"])

        # Verify duplicate file exists
        dup_file = (
            storage_paths.get_environments_storage_path() / duplicate["id"] / "environment.yaml"
        )
        assert dup_file.exists()

        # Clear in-memory cache and reload
        environment_service._clear_in_memory_cache()

        # Both should be loadable from disk
        result = environment_service.list_environments()
        assert result["total"] == 2

    def test_get_environment_loads_from_disk_when_not_in_cache(self, tmp_path: Any) -> None:
        """Test get_environment loads from disk when environment is not in memory cache.

        This covers the edge case where a file exists on disk but is not in the
        in-memory cache (e.g., created by external process or race condition).
        """
        import yaml

        from wavecore.api.services import storage_paths
        from wavecore.api.services.environments import service as environment_service

        # Set up temp storage path
        storage_paths.set_base_path(tmp_path)
        environment_service._clear_storage()

        # Manually create a file on disk without using the service
        env_id = "manual-env-id"
        env_data = {
            "id": env_id,
            "name": "manually-created",
            "description": "Created directly on disk",
            "tags": ["external"],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        env_dir = storage_paths.get_environments_storage_path() / env_id
        env_dir.mkdir(parents=True, exist_ok=True)
        env_file = env_dir / "environment.yaml"
        with open(env_file, "w", encoding="utf-8") as f:
            yaml.dump(env_data, f)

        # Mark cache as loaded (but without the manually created env)
        environment_service._cache_loaded = True

        # get_environment should find it on disk and add to cache
        result = environment_service.get_environment(env_id)

        assert result is not None
        assert result["id"] == env_id
        assert result["name"] == "manually-created"
        # Verify it was added to the in-memory cache
        assert env_id in environment_service._environments


class TestStoragePathsEnvironments:
    """Test suite for get_environments_storage_path function."""

    def test_get_environments_storage_path_returns_path(self) -> None:
        """Test that get_environments_storage_path returns correct path."""
        from wavecore.api.services.storage_paths import (
            get_base_path,
            get_environments_storage_path,
        )

        expected = get_base_path() / "api_environments"
        actual = get_environments_storage_path()

        assert actual == expected

    def test_get_environments_storage_path_respects_base_path(
        self, tmp_path: Any, temp_storage_path: Any
    ) -> None:
        """Test that get_environments_storage_path uses configured base path."""
        from wavecore.api.services import storage_paths

        # Save current path set by fixture
        original_path = temp_storage_path

        storage_paths.set_base_path(tmp_path)
        result = storage_paths.get_environments_storage_path()

        assert result == tmp_path / "api_environments"

        # Restore the fixture's temp path (NOT reset to None!)
        storage_paths.set_base_path(original_path)


class TestListAllTags:
    """Test suite for list_all_tags function (REQ-9.5.3.4)."""

    def test_list_all_tags_returns_unique_tags_from_all_environments(
        self, temp_storage_path: Any
    ) -> None:
        """Test that list_all_tags returns unique tags from all environments."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        # Create environments with tags at top-level
        environment_service.create_environment(
            name="Environment 1",
            tags=["production", "us-east"],
        )
        environment_service.create_environment(
            name="Environment 2",
            tags=["production", "eu-west"],
        )
        environment_service.create_environment(
            name="Environment 3",
            tags=["staging", "us-east"],
        )

        result = environment_service.list_all_tags()

        # Should contain all unique tags
        assert "production" in result
        assert "us-east" in result
        assert "eu-west" in result
        assert "staging" in result
        # Should be sorted alphabetically
        assert result == sorted(result)
        # Should have no duplicates (production and us-east appear in 2 environments)
        assert len(result) == len(set(result))

    def test_list_all_tags_returns_empty_list_when_no_environments_exist(
        self, temp_storage_path: Any
    ) -> None:
        """Test that list_all_tags returns empty list when no environments exist."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        result = environment_service.list_all_tags()

        assert result == []

    def test_list_all_tags_returns_empty_list_when_environments_have_no_tags(
        self, temp_storage_path: Any
    ) -> None:
        """Test that list_all_tags returns empty list when environments have no tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        # Create environments without tags
        environment_service.create_environment(name="Environment 1")
        environment_service.create_environment(name="Environment 2", tags=[])

        result = environment_service.list_all_tags()

        assert result == []

    def test_list_all_tags_returns_sorted_tags(self, temp_storage_path: Any) -> None:
        """Test that list_all_tags returns tags in alphabetical order."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(
            name="Environment 1",
            tags=["zulu", "alpha", "mike"],
        )

        result = environment_service.list_all_tags()

        assert result == ["alpha", "mike", "zulu"]

    def test_list_all_tags_deduplicates_across_environments(self, temp_storage_path: Any) -> None:
        """Test that list_all_tags returns each tag only once."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        # Create multiple environments with overlapping tags
        environment_service.create_environment(
            name="Environment 1",
            tags=["aws", "production"],
        )
        environment_service.create_environment(
            name="Environment 2",
            tags=["aws", "staging"],
        )
        environment_service.create_environment(
            name="Environment 3",
            tags=["aws", "development"],
        )

        result = environment_service.list_all_tags()

        # "aws" should appear only once
        assert result.count("aws") == 1
        assert set(result) == {"aws", "production", "staging", "development"}


class TestListEnvironmentNames:
    """Test suite for list_environment_names function."""

    def test_list_environment_names_returns_all_environments(self, temp_storage_path: Any) -> None:
        """Test that list_environment_names returns all environments."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="Production", tags=["prod"])
        environment_service.create_environment(name="Staging", tags=["stage"])
        environment_service.create_environment(name="Development")

        result = environment_service.list_environment_names()

        assert len(result) == 3

    def test_list_environment_names_returns_only_id_name_tags(self, temp_storage_path: Any) -> None:
        """Test that list_environment_names returns only id, name, and tags fields."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(
            name="Production",
            description="Production environment",
            tags=["prod", "critical"],
        )

        result = environment_service.list_environment_names()

        assert len(result) == 1
        env = result[0]
        # Should have only id, name, and tags
        assert set(env.keys()) == {"id", "name", "tags"}
        assert env["name"] == "Production"
        assert env["tags"] == ["prod", "critical"]
        # Should NOT have description, usage, created_at, updated_at
        assert "description" not in env
        assert "usage" not in env
        assert "created_at" not in env
        assert "updated_at" not in env

    def test_list_environment_names_returns_empty_tags_when_none(
        self, temp_storage_path: Any
    ) -> None:
        """Test that list_environment_names returns empty tags array when no tags."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="NoTags")

        result = environment_service.list_environment_names()

        assert len(result) == 1
        assert result[0]["tags"] == []

    def test_list_environment_names_sorted_by_name(self, temp_storage_path: Any) -> None:
        """Test that list_environment_names returns environments sorted by name."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="Zebra")
        environment_service.create_environment(name="Alpha")
        environment_service.create_environment(name="Beta")

        result = environment_service.list_environment_names()

        names = [e["name"] for e in result]
        assert names == ["Alpha", "Beta", "Zebra"]

    def test_list_environment_names_case_insensitive_sort(self, temp_storage_path: Any) -> None:
        """Test that list_environment_names sorts case-insensitively."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        environment_service.create_environment(name="alpha")
        environment_service.create_environment(name="Beta")
        environment_service.create_environment(name="GAMMA")

        result = environment_service.list_environment_names()

        names = [e["name"] for e in result]
        assert names == ["alpha", "Beta", "GAMMA"]

    def test_list_environment_names_returns_empty_when_no_environments(
        self, temp_storage_path: Any
    ) -> None:
        """Test that list_environment_names returns empty list when no environments."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        result = environment_service.list_environment_names()

        assert result == []


class TestEnvironmentServiceETag:
    """Test suite for environment service ETag/concurrency control."""

    def test_generate_etag_returns_quoted_hash(self) -> None:
        """Test that _generate_etag returns a quoted MD5 hash."""
        from wavecore.api.services.environments import service as environment_service

        env = {
            "id": "test-id-123",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        etag = environment_service._generate_etag(env)

        assert etag.startswith('"')
        assert etag.endswith('"')
        assert len(etag) == 66  # 64 hex chars + 2 quotes

    def test_generate_etag_is_deterministic(self) -> None:
        """Test that _generate_etag returns same hash for same input."""
        from wavecore.api.services.environments import service as environment_service

        env = {
            "id": "test-id-123",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        etag1 = environment_service._generate_etag(env)
        etag2 = environment_service._generate_etag(env)

        assert etag1 == etag2

    def test_generate_etag_changes_with_updated_at(self) -> None:
        """Test that _generate_etag produces different hash when updated_at changes."""
        from wavecore.api.services.environments import service as environment_service

        env1 = {"id": "test-id", "updated_at": "2025-01-01T00:00:00Z"}
        env2 = {"id": "test-id", "updated_at": "2025-01-02T00:00:00Z"}

        assert environment_service._generate_etag(env1) != environment_service._generate_etag(env2)

    def test_update_with_matching_etag_succeeds(self) -> None:
        """Test that update succeeds when ETag matches."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="etag-test")
        current_etag = environment_service._generate_etag(created)

        result = environment_service.update_environment(
            environment_id=created["id"],
            name="updated-name",
            etag=current_etag,
        )

        assert result is not None
        assert result["name"] == "updated-name"

    def test_update_with_mismatched_etag_raises_precondition_failed(self) -> None:
        """Test that update raises ValueError when ETag mismatches."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        created = environment_service.create_environment(name="etag-test")

        with pytest.raises(ConflictException, match="Precondition failed"):
            environment_service.update_environment(
                environment_id=created["id"],
                name="updated-name",
                etag='"stale-etag"',
            )


# ============================================================================
# Export / Import Service-Level Tests
# ============================================================================


class TestSanitizeFilename:
    """Test suite for _sanitize_filename utility."""

    def test_sanitize_simple_name(self) -> None:
        """Simple alphanumeric name stays unchanged."""
        from wavecore.api.services.environments import service as environment_service

        assert environment_service._sanitize_filename("Production") == "Production"

    def test_sanitize_strips_special_characters(self) -> None:
        """Special characters are removed."""
        from wavecore.api.services.environments import service as environment_service

        result = environment_service._sanitize_filename("env@#$%name")
        assert "@" not in result
        assert "#" not in result

    def test_sanitize_replaces_spaces_with_dashes(self) -> None:
        """Whitespace is replaced by dashes."""
        from wavecore.api.services.environments import service as environment_service

        result = environment_service._sanitize_filename("My Env Name")
        assert result == "My-Env-Name"

    def test_sanitize_empty_name_returns_default(self) -> None:
        """Empty or all-special-char name returns default 'environment'."""
        from wavecore.api.services.environments import service as environment_service

        assert environment_service._sanitize_filename("@#$") == "environment"
        assert environment_service._sanitize_filename("") == "environment"

    def test_sanitize_preserves_hyphens_and_underscores(self) -> None:
        """Hyphens and underscores are preserved."""
        from wavecore.api.services.environments import service as environment_service

        assert environment_service._sanitize_filename("my-env_name") == "my-env_name"


class TestGenerateUniqueName:
    """Test suite for _generate_unique_name utility."""

    def test_unique_name_when_no_conflict(self) -> None:
        """Returns base name when it does not exist."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        result = environment_service._generate_unique_name("New Env")
        assert result == "New Env"

    def test_unique_name_appends_counter_on_conflict(self) -> None:
        """Appends (2) when base name is taken."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        environment_service.create_environment(name="Existing")

        result = environment_service._generate_unique_name("Existing")
        assert result == "Existing (2)"

    def test_unique_name_increments_counter(self) -> None:
        """Increments past (2) when (2) is also taken."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        environment_service.create_environment(name="Env")
        environment_service.create_environment(name="Env (2)")

        result = environment_service._generate_unique_name("Env")
        assert result == "Env (3)"


class TestExportEnvironment:
    """Test suite for export_environment function."""

    def test_export_yaml(self) -> None:
        """Export in YAML format returns valid YAML content and filename."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        env = environment_service.create_environment(name="Export Env", description="For export")

        result = environment_service.export_environment(env["id"], "yaml")
        assert result is not None
        content, filename = result
        assert filename.endswith(".yaml")
        parsed = yaml_mod.safe_load(content)
        assert parsed["name"] == "Export Env"

    def test_export_json(self) -> None:
        """Export in JSON format returns valid JSON content and filename."""
        import json

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        env = environment_service.create_environment(name="JSON Env")

        result = environment_service.export_environment(env["id"], "json")
        assert result is not None
        content, filename = result
        assert filename.endswith(".json")
        parsed = json.loads(content)
        assert parsed["name"] == "JSON Env"

    def test_export_not_found_returns_none(self) -> None:
        """Export returns None for non-existent environment."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        result = environment_service.export_environment("nonexistent-id")
        assert result is None

    def test_export_filename_is_sanitized(self) -> None:
        """Exported filename is sanitized from the environment name."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        env = environment_service.create_environment(name="My Env @#$")

        result = environment_service.export_environment(env["id"])
        assert result is not None
        _, filename = result
        assert "@" not in filename
        assert "#" not in filename


class TestExportEnvironmentsBatch:
    """Test suite for export_environments_batch function."""

    def test_batch_export_multiple(self) -> None:
        """Batch export returns content for all requested environments."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        env1 = environment_service.create_environment(name="Env1")
        env2 = environment_service.create_environment(name="Env2")

        results = environment_service.export_environments_batch([env1["id"], env2["id"]], "yaml")
        assert len(results) == 2
        ids_returned = {r[0] for r in results}
        assert env1["id"] in ids_returned
        assert env2["id"] in ids_returned

    def test_batch_export_json_format(self) -> None:
        """Batch export in JSON produces .json filenames."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        env = environment_service.create_environment(name="JsonBatch")

        results = environment_service.export_environments_batch([env["id"]], "json")
        assert len(results) == 1
        assert results[0][2].endswith(".json")

    def test_batch_export_deduplicates_filenames(self) -> None:
        """Batch export deduplicates filenames for same-named envs."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        env1 = environment_service.create_environment(name="SameName")
        # Create second with different name then rename in cache for same sanitized name
        env2 = environment_service.create_environment(name="SameName (2)")
        # Manually set the name to force duplicate filename scenario
        environment_service._environments[env2["id"]]["name"] = "SameName"

        results = environment_service.export_environments_batch([env1["id"], env2["id"]], "yaml")
        filenames = {r[2] for r in results}
        assert len(filenames) == 2  # No duplicates

    def test_batch_export_triple_duplicate_filenames(self) -> None:
        """Batch export with 3+ same-named envs increments counter past 2."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        env1 = environment_service.create_environment(name="Dup")
        env2 = environment_service.create_environment(name="Dup (2)")
        env3 = environment_service.create_environment(name="Dup (3)")
        # Force all three to have the same name for filename collision
        environment_service._environments[env2["id"]]["name"] = "Dup"
        environment_service._environments[env3["id"]]["name"] = "Dup"

        results = environment_service.export_environments_batch(
            [env1["id"], env2["id"], env3["id"]], "yaml"
        )
        filenames = [r[2] for r in results]
        assert len(set(filenames)) == 3  # All unique
        assert filenames[0] == "Dup.yaml"
        assert filenames[1] == "Dup-2.yaml"
        assert filenames[2] == "Dup-3.yaml"

    def test_batch_export_not_found_raises(self) -> None:
        """Batch export raises ValueError when an environment is not found."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        with pytest.raises(NotFoundException, match="Environment not found"):
            environment_service.export_environments_batch(["nonexistent-id"])


class TestValidateEnvironmentImport:
    """Test suite for validate_environment_import function."""

    def test_validate_ok_status(self) -> None:
        """New environment returns ok status."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        content = yaml_mod.dump({"name": "Brand New"}).encode()

        result = environment_service.validate_environment_import(content, "env.yaml")
        assert result["total"] == 1
        assert result["importable"] == 1
        assert result["blocked"] == 0
        assert result["environments"][0]["status"] == "ok"

    def test_validate_conflict_status(self) -> None:
        """Environment with existing name returns conflict status."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        existing = environment_service.create_environment(name="Existing")

        content = yaml_mod.dump({"name": "Existing"}).encode()
        result = environment_service.validate_environment_import(content, "env.yaml")
        assert result["environments"][0]["status"] == "conflict"
        assert result["environments"][0]["existing_environment_id"] == existing["id"]
        assert result["importable"] == 1

    def test_validate_fatal_missing_name(self) -> None:
        """Environment without name returns fatal status."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        content = yaml_mod.dump({"description": "no name"}).encode()

        result = environment_service.validate_environment_import(content, "env.yaml")
        assert result["environments"][0]["status"] == "fatal"
        assert result["blocked"] == 1
        assert result["importable"] == 0
        assert result["environments"][0]["fatal_errors"][0]["code"] == "MISSING_NAME"

    def test_validate_zip_multiple_environments(self) -> None:
        """ZIP with multiple environments validates each one."""
        import io
        import zipfile

        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("e1.yaml", yaml_mod.dump({"name": "E1"}))
            zf.writestr("e2.yaml", yaml_mod.dump({"name": "E2"}))
        buf.seek(0)

        result = environment_service.validate_environment_import(buf.getvalue(), "envs.zip")
        assert result["total"] == 2
        assert result["importable"] == 2

    def test_validate_json_file(self) -> None:
        """JSON file is correctly validated."""
        import json

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        content = json.dumps({"name": "JSON Env"}).encode()

        result = environment_service.validate_environment_import(content, "env.json")
        assert result["total"] == 1
        assert result["environments"][0]["status"] == "ok"


class TestImportEnvironments:
    """Test suite for import_environments function."""

    def test_import_creates_new_environment(self) -> None:
        """Importing new environment creates it with new UUID."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        content = yaml_mod.dump(
            {"name": "Imported Env", "description": "From import", "tags": ["imported"]}
        ).encode()

        result = environment_service.import_environments(content, "env.yaml")
        assert result["total_imported"] == 1
        assert result["total_skipped"] == 0
        assert result["imported"][0]["name"] == "Imported Env"
        assert result["imported"][0]["action"] == "created"
        # Verify UUID was generated
        uuid.UUID(result["imported"][0]["id"])

    def test_import_conflict_skip(self) -> None:
        """Skipping a conflicting environment excludes it from import."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        environment_service.create_environment(name="Existing")

        content = yaml_mod.dump({"name": "Existing"}).encode()
        result = environment_service.import_environments(content, "env.yaml", {"Existing": "skip"})
        assert result["total_imported"] == 0
        assert result["total_skipped"] == 1
        assert result["skipped"][0]["name"] == "Existing"

    def test_import_conflict_rename(self) -> None:
        """Renaming a conflicting environment appends (2)."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        environment_service.create_environment(name="Existing")

        content = yaml_mod.dump({"name": "Existing"}).encode()
        result = environment_service.import_environments(
            content, "env.yaml", {"Existing": "rename"}
        )
        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "renamed"
        assert result["imported"][0]["name"] == "Existing (2)"

    def test_import_conflict_overwrite(self) -> None:
        """Overwriting uses the existing environment's ID."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        original = environment_service.create_environment(name="Existing")

        content = yaml_mod.dump({"name": "Existing", "description": "Updated"}).encode()
        result = environment_service.import_environments(
            content, "env.yaml", {"Existing": "overwrite"}
        )
        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "overwritten"
        assert result["imported"][0]["id"] == original["id"]

    def test_import_fatal_missing_name_raises(self) -> None:
        """Importing environment without name raises ValueError."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        content = yaml_mod.dump({"description": "no name"}).encode()

        with pytest.raises(ValidationException, match="Fatal validation errors"):
            environment_service.import_environments(content, "env.yaml")

    def test_import_zip_multiple(self) -> None:
        """Importing ZIP creates multiple environments."""
        import io
        import zipfile

        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("e1.yaml", yaml_mod.dump({"name": "ZipE1"}))
            zf.writestr("e2.yaml", yaml_mod.dump({"name": "ZipE2"}))
        buf.seek(0)

        result = environment_service.import_environments(buf.getvalue(), "envs.zip")
        assert result["total_imported"] == 2
        names = {i["name"] for i in result["imported"]}
        assert names == {"ZipE1", "ZipE2"}

    def test_import_with_description(self) -> None:
        """Imported environment with description preserves it."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        content = yaml_mod.dump({"name": "Desc Env", "description": "My description"}).encode()

        result = environment_service.import_environments(content, "env.yaml")
        assert result["total_imported"] == 1

        # Verify the description was stored
        env_id = result["imported"][0]["id"]
        env = environment_service.get_environment(env_id)
        assert env is not None
        assert env["description"] == "My description"

    def test_import_default_resolution_is_rename(self) -> None:
        """Default conflict resolution (no explicit resolution) is rename."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        environment_service.create_environment(name="Default")

        content = yaml_mod.dump({"name": "Default"}).encode()
        result = environment_service.import_environments(content, "env.yaml")
        assert result["imported"][0]["action"] == "renamed"
        assert result["imported"][0]["name"] == "Default (2)"

    def test_import_json_file(self) -> None:
        """Importing JSON file creates environment."""
        import json

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        content = json.dumps({"name": "JSON Import"}).encode()

        result = environment_service.import_environments(content, "env.json")
        assert result["total_imported"] == 1
        assert result["imported"][0]["name"] == "JSON Import"

    def test_import_overwrite_preserves_tags(self) -> None:
        """Overwritten environment uses tags from the imported data."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        environment_service.create_environment(name="Tagged", tags=["old-tag"])

        content = yaml_mod.dump({"name": "Tagged", "tags": ["new-tag"]}).encode()
        result = environment_service.import_environments(
            content, "env.yaml", {"Tagged": "overwrite"}
        )
        assert result["total_imported"] == 1
        env_id = result["imported"][0]["id"]
        env = environment_service.get_environment(env_id)
        assert env is not None
        assert env["tags"] == ["new-tag"]

    def test_import_conflict_rename_with_description(self) -> None:
        """Renaming a conflicting environment preserves its description."""
        import yaml as yaml_mod

        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        environment_service.create_environment(name="Existing")

        content = yaml_mod.dump({"name": "Existing", "description": "Renamed description"}).encode()
        result = environment_service.import_environments(
            content, "env.yaml", {"Existing": "rename"}
        )
        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "renamed"

        env_id = result["imported"][0]["id"]
        env = environment_service.get_environment(env_id)
        assert env is not None
        assert env["description"] == "Renamed description"


def _environment_document(name: str, **fields: Any) -> dict[str, Any]:
    """A whole Environment document whose times no save would produce."""
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "description": "Kept as it was",
        "tags": ["restored"],
        "created_at": "2025-01-02T03:04:05Z",
        "updated_at": "2025-06-07T08:09:10Z",
        **fields,
    }


def _environment_file(environment_id: str) -> Any:
    """What the storage file of one Environment holds."""
    path = get_environments_storage_path() / environment_id / "environment.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _listed_environment_names() -> list[str]:
    """The names the Environments list shows right now."""
    from wavecore.api.services.environments import service as environment_service

    listing = environment_service.list_environments(sort_by="name")
    return [environment["name"] for environment in listing["environments"]]


class TestPersistEnvironmentDocument:
    """The public writer stores an Environment as it is handed over (REQ-5.2.4.9.5)."""

    def test_the_document_is_written_as_given_and_shows_at_once(self) -> None:
        """The file holds the document, and the list follows an overwritten id."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        document = _environment_document("Prod")

        environment_service.persist_environment_document(copy.deepcopy(document))

        assert _environment_file(document["id"]) == document
        assert environment_service.list_environment_documents() == [document]
        assert _listed_environment_names() == ["Prod"]

        environment_service.persist_environment_document({**document, "name": "Prod EU"})

        assert _environment_file(document["id"]) == {**document, "name": "Prod EU"}
        assert _listed_environment_names() == ["Prod EU"]

    def test_it_takes_no_name_map(self) -> None:
        """The writer takes the document alone; the import keeps its own name map."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        with pytest.raises(TypeError):
            environment_service.persist_environment_document(_environment_document("Solo"), {})

        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as members:
            members.writestr("first.yaml", yaml.safe_dump({"name": "Twin"}))
            members.writestr("second.yaml", yaml.safe_dump({"name": "Twin"}))

        result = environment_service.import_environments(archive.getvalue(), "environments.zip")

        assert [(item["name"], item["action"]) for item in result["imported"]] == [
            ("Twin", "created"),
            ("Twin (2)", "renamed"),
        ]
        assert _listed_environment_names() == ["Twin", "Twin (2)"]


class TestListEnvironmentDocuments:
    """The public reader hands back every stored Environment (REQ-5.2.4.9.5)."""

    def test_every_stored_environment_comes_back_as_stored(self) -> None:
        """The stored documents come back, without the usage count the list adds."""
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        first = environment_service.create_environment(
            name="Prod", description="Live", tags=["live"]
        )
        second = environment_service.create_environment(name="Staging")

        documents = environment_service.list_environment_documents()

        assert len(documents) == 2
        assert {document["id"]: document for document in documents} == {
            environment_id: _environment_file(environment_id)
            for environment_id in (first["id"], second["id"])
        }
        assert all("usage" not in document for document in documents)
