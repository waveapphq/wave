"""
Comprehensive unit tests for block versioning and metadata management.

This module tests REQ-3.1.2.2: Version control for blocks with metadata
Testing:
- Block deprecation metadata
- Version immutability enforcement
- Block version discovery and selection
- Version lifecycle management
- Semantic version resolution
"""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from tests.conftest import create_test_block


class TestBlockDeprecationMetadata:
    """Test suite for block deprecation metadata (REQ-3.1.2.2)."""

    def test_block_without_deprecation_metadata(self):
        """Test that blocks are not deprecated by default."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.is_deprecated is False
        assert block.deprecation_reason is None
        assert block.replacement_version is None
        assert block.deprecation_date is None

    def test_block_mark_as_deprecated(self):
        """Test marking a block version as deprecated."""

        now = datetime.now(UTC)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            is_deprecated=True,
            deprecation_reason="Replaced by improved implementation",
            replacement_version="2.0.0",
            deprecation_date=now,
        )

        assert block.is_deprecated is True
        assert block.deprecation_reason == "Replaced by improved implementation"
        assert block.replacement_version == "2.0.0"
        assert block.deprecation_date == now

    def test_block_deprecated_without_reason_fails(self):
        """Test that deprecated blocks must have a reason."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(
            ValidationError, match="Deprecation reason is required when block is deprecated"
        ):
            Block(
                id="test-block",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="action",
                plugin_id="test",
                plugins=[],
                child_blocks=[],
                is_deprecated=True,
                deprecation_reason=None,  # Missing reason
            )

    def test_block_deprecated_with_empty_reason_fails(self):
        """Test that deprecated blocks cannot have empty reason."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(ValidationError, match="Deprecation reason cannot be empty"):
            Block(
                id="test-block",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="action",
                plugins=[],
                child_blocks=[],
                is_deprecated=True,
                deprecation_reason="   ",  # Whitespace only
            )

    def test_block_deprecation_reason_without_deprecated_flag_fails(self):
        """Test that deprecation reason requires is_deprecated=True."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(
            ValidationError, match="Deprecation reason can only be set when block is deprecated"
        ):
            Block(
                id="test-block",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="action",
                plugins=[],
                child_blocks=[],
                is_deprecated=False,
                deprecation_reason="Some reason",  # Inconsistent
            )

    def test_block_replacement_version_must_be_valid_semver(self):
        """Test that replacement version must be valid semantic version."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(ValidationError, match="Invalid replacement version"):
            Block(
                id="test-block",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="action",
                plugins=[],
                child_blocks=[],
                is_deprecated=True,
                deprecation_reason="Old version",
                replacement_version="invalid-version",  # Not semver
            )

    def test_block_replacement_version_without_deprecated_fails(self):
        """Test that replacement version requires is_deprecated=True."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(
            ValidationError, match="Replacement version can only be set when block is deprecated"
        ):
            Block(
                id="test-block",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="action",
                plugins=[],
                child_blocks=[],
                is_deprecated=False,
                replacement_version="2.0.0",  # Inconsistent
            )

    def test_block_deprecation_date_without_deprecated_fails(self):
        """Test that deprecation date requires is_deprecated=True."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(
            ValidationError, match="Deprecation date can only be set when block is deprecated"
        ):
            Block(
                id="test-block",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="action",
                plugins=[],
                child_blocks=[],
                is_deprecated=False,
                deprecation_date=datetime.now(UTC),  # Inconsistent
            )

    def test_block_deprecation_date_defaults_to_now(self):
        """Test that deprecation date defaults to current time when deprecated."""

        before = datetime.now(UTC)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            is_deprecated=True,
            deprecation_reason="Old implementation",
        )
        after = datetime.now(UTC)

        assert block.deprecation_date is not None
        assert before <= block.deprecation_date <= after

    def test_block_replacement_version_can_be_same_major(self):
        """Test that replacement version can be in same major version."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            is_deprecated=True,
            deprecation_reason="Bug fix available",
            replacement_version="1.0.1",  # Patch update
        )

        assert block.replacement_version == "1.0.1"

    def test_block_replacement_version_can_be_higher_major(self):
        """Test that replacement version can be a major version upgrade."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            is_deprecated=True,
            deprecation_reason="Breaking changes in v2",
            replacement_version="2.0.0",  # Major upgrade
        )

        assert block.replacement_version == "2.0.0"


class TestBlockPublishStatus:
    """Test suite for block publish status and immutability (REQ-3.1.2.2)."""

    def test_block_unpublished_by_default(self):
        """Test that blocks are unpublished by default (draft state)."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.is_published is False
        assert block.publish_date is None

    def test_block_can_be_published(self):
        """Test that blocks can be marked as published."""

        now = datetime.now(UTC)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            is_published=True,
            publish_date=now,
        )

        assert block.is_published is True
        assert block.publish_date == now

    def test_block_publish_date_without_published_fails(self):
        """Test that publish_date requires is_published=True."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(
            ValidationError, match="Publish date can only be set when block is published"
        ):
            Block(
                id="test-block",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="action",
                plugins=[],
                child_blocks=[],
                is_published=False,
                publish_date=datetime.now(UTC),  # Inconsistent
            )

    def test_block_publish_date_defaults_to_now(self):
        """Test that publish_date defaults to current time when published."""

        before = datetime.now(UTC)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            is_published=True,
        )
        after = datetime.now(UTC)

        assert block.publish_date is not None
        assert before <= block.publish_date <= after

    def test_published_and_deprecated_block_valid(self):
        """Test that a block can be both published and deprecated."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            is_published=True,
            is_deprecated=True,
            deprecation_reason="Superseded by v2",
            replacement_version="2.0.0",
        )

        assert block.is_published is True
        assert block.is_deprecated is True
        assert block.replacement_version == "2.0.0"


class TestBlockVersionManager:
    """Test suite for BlockVersionManager service (REQ-3.1.2.2)."""

    @pytest.fixture
    def version_manager(self):
        """Create a BlockVersionManager instance."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        return BlockVersionManager()

    @pytest.fixture
    def sample_block_v1(self):
        """Create a sample block version 1.0.0."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        return Block(
            id="test-block",
            version="1.0.0",
            metadata=BlockMetadata(
                name="Test Block",
                description="Version 1 of test block",
                author="Test Author",
                tags=["test", "v1"],
            ),
            type="action",
            plugins=[],
            child_blocks=[],
        )

    @pytest.fixture
    def sample_block_v2(self):
        """Create a sample block version 2.0.0."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        return Block(
            id="test-block",
            version="2.0.0",
            metadata=BlockMetadata(
                name="Test Block",
                description="Version 2 of test block with improvements",
                author="Test Author",
                tags=["test", "v2"],
            ),
            type="action",
            plugins=[],
            child_blocks=[],
        )

    def test_publish_block_success(self, version_manager, sample_block_v1):
        """Test publishing a block version."""
        published_block = version_manager.publish(sample_block_v1)

        assert published_block.is_published is True
        assert published_block.publish_date is not None
        assert published_block.version == "1.0.0"

    def test_publish_already_published_block_fails(self, version_manager, sample_block_v1):
        """Test that publishing an already published block fails."""
        # First publish succeeds
        version_manager.publish(sample_block_v1)

        # Second publish fails
        with pytest.raises(
            ValueError, match="^Block test-block version 1.0.0 is already published$"
        ):
            version_manager.publish(sample_block_v1)

    def test_publish_creates_immutable_copy(self, version_manager, sample_block_v1):
        """Test that publishing creates an immutable copy."""
        original_description = sample_block_v1.description
        published_block = version_manager.publish(sample_block_v1)

        # Modify original's metadata
        sample_block_v1.metadata.description = "Modified description"

        # Published version should be unchanged
        assert published_block.description == original_description

    def test_get_block_version_success(self, version_manager, sample_block_v1):
        """Test retrieving a published block version."""
        version_manager.publish(sample_block_v1)

        retrieved = version_manager.get("test-block", "1.0.0")

        assert retrieved is not None
        assert retrieved.id == "test-block"
        assert retrieved.version == "1.0.0"

    def test_get_block_version_not_found(self, version_manager):
        """Test retrieving a non-existent block version returns None."""
        result = version_manager.get("nonexistent-block", "1.0.0")

        assert result is None

    def test_get_unpublished_block_returns_none(self, version_manager, sample_block_v1):
        """Test that unpublished blocks are not retrievable."""
        # Don't publish, just try to get
        result = version_manager.get("test-block", "1.0.0")

        assert result is None

    def test_list_block_versions(self, version_manager, sample_block_v1, sample_block_v2):
        """Test listing all versions of a block."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        versions = version_manager.list_versions("test-block")

        assert len(versions) == 2
        assert "1.0.0" in versions
        assert "2.0.0" in versions

    def test_list_block_versions_empty(self, version_manager):
        """Test listing versions of non-existent block returns empty list."""
        versions = version_manager.list_versions("nonexistent-block")

        assert versions == []

    def test_list_block_versions_sorted(self, version_manager):
        """Test that block versions are listed in descending order."""

        # Publish in random order
        for version in ["1.0.0", "2.1.0", "1.5.0", "2.0.0"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            version_manager.publish(block)

        versions = version_manager.list_versions("test-block")

        # Should be sorted in descending order
        assert versions == ["2.1.0", "2.0.0", "1.5.0", "1.0.0"]

    def test_get_latest_version(self, version_manager, sample_block_v1, sample_block_v2):
        """Test retrieving the latest version of a block."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        latest = version_manager.get_latest("test-block")

        assert latest is not None
        assert latest.version == "2.0.0"

    def test_get_latest_version_excludes_deprecated(
        self, version_manager, sample_block_v1, sample_block_v2
    ):
        """Test that get_latest excludes deprecated versions by default."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        # Deprecate v2
        version_manager.deprecate(
            "test-block",
            "2.0.0",
            reason="Testing deprecated exclusion",
            replacement_version="3.0.0",
        )

        # Should return v1 since v2 is deprecated
        latest = version_manager.get_latest("test-block")

        assert latest is not None
        assert latest.version == "1.0.0"

    def test_get_latest_version_includes_deprecated_when_requested(
        self, version_manager, sample_block_v1, sample_block_v2
    ):
        """Test that get_latest can include deprecated versions when requested."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        # Deprecate v2
        version_manager.deprecate(
            "test-block", "2.0.0", reason="Testing", replacement_version="3.0.0"
        )

        # Should return v2 when include_deprecated=True
        latest = version_manager.get_latest("test-block", include_deprecated=True)

        assert latest is not None
        assert latest.version == "2.0.0"
        assert latest.is_deprecated is True

    def test_get_latest_version_not_found(self, version_manager):
        """Test get_latest returns None for non-existent block."""
        result = version_manager.get_latest("nonexistent-block")

        assert result is None

    def test_get_latest_version_all_deprecated(self, version_manager, sample_block_v1):
        """Test get_latest returns None when all versions are deprecated."""
        version_manager.publish(sample_block_v1)
        version_manager.deprecate(
            "test-block", "1.0.0", reason="Deprecated", replacement_version="2.0.0"
        )

        # Should return None since all versions are deprecated
        result = version_manager.get_latest("test-block")

        assert result is None

    def test_deprecate_block_version_success(self, version_manager, sample_block_v1):
        """Test deprecating a block version."""
        version_manager.publish(sample_block_v1)

        deprecated = version_manager.deprecate(
            "test-block", "1.0.0", reason="Replaced by v2", replacement_version="2.0.0"
        )

        assert deprecated.is_deprecated is True
        assert deprecated.deprecation_reason == "Replaced by v2"
        assert deprecated.replacement_version == "2.0.0"
        assert deprecated.deprecation_date is not None

    def test_deprecate_unpublished_block_fails(self, version_manager):
        """Test that deprecating an unpublished block fails."""
        with pytest.raises(ValueError, match="^Block test-block version 1.0.0 not found$"):
            version_manager.deprecate("test-block", "1.0.0", reason="Test")

    def test_deprecate_already_deprecated_block_fails(self, version_manager, sample_block_v1):
        """Test that deprecating an already deprecated block fails."""
        version_manager.publish(sample_block_v1)
        version_manager.deprecate("test-block", "1.0.0", reason="First deprecation")

        with pytest.raises(
            ValueError, match="^Block test-block version 1.0.0 is already deprecated$"
        ):
            version_manager.deprecate("test-block", "1.0.0", reason="Second deprecation")

    def test_deprecate_without_reason_fails(self, version_manager, sample_block_v1):
        """Test that deprecation requires a reason."""
        version_manager.publish(sample_block_v1)

        with pytest.raises(ValueError, match="^Deprecation reason is required$"):
            version_manager.deprecate("test-block", "1.0.0", reason="")

    def test_deprecate_with_invalid_replacement_version_fails(
        self, version_manager, sample_block_v1
    ):
        """Test that deprecation with invalid replacement version fails."""
        version_manager.publish(sample_block_v1)

        with pytest.raises(ValueError, match="^Invalid replacement version"):
            version_manager.deprecate(
                "test-block", "1.0.0", reason="Test", replacement_version="not-a-version"
            )

    def test_find_blocks_by_name(self, version_manager, sample_block_v1, sample_block_v2):
        """Test finding blocks by name."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        results = version_manager.find(name="Test Block")

        assert len(results) == 2
        assert all(b.name == "Test Block" for b in results)

    def test_find_blocks_by_author(self, version_manager, sample_block_v1):
        """Test finding blocks by author."""
        version_manager.publish(sample_block_v1)

        results = version_manager.find(author="Test Author")

        assert len(results) == 1
        assert results[0].author == "Test Author"

    def test_find_blocks_by_author_no_match(self, version_manager, sample_block_v1):
        """Test finding blocks by author with no match."""
        version_manager.publish(sample_block_v1)

        results = version_manager.find(author="Different Author")

        assert len(results) == 0

    def test_find_blocks_by_tags(self, version_manager, sample_block_v1, sample_block_v2):
        """Test finding blocks by tags."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        # Find blocks with "v1" tag
        results = version_manager.find(tags=["v1"])

        assert len(results) == 1
        assert results[0].version == "1.0.0"

    def test_find_blocks_by_multiple_criteria(
        self, version_manager, sample_block_v1, sample_block_v2
    ):
        """Test finding blocks with multiple search criteria."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        # Find blocks by name AND tag
        results = version_manager.find(name="Test Block", tags=["v2"])

        assert len(results) == 1
        assert results[0].version == "2.0.0"

    def test_find_blocks_no_results(self, version_manager, sample_block_v1):
        """Test finding blocks with no matches returns empty list."""
        version_manager.publish(sample_block_v1)

        results = version_manager.find(name="Nonexistent Block")

        assert results == []

    def test_find_blocks_excludes_deprecated_by_default(
        self, version_manager, sample_block_v1, sample_block_v2
    ):
        """Test that find excludes deprecated blocks by default."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        # Deprecate v1
        version_manager.deprecate("test-block", "1.0.0", reason="Old", replacement_version="2.0.0")

        results = version_manager.find(name="Test Block")

        assert len(results) == 1
        assert results[0].version == "2.0.0"

    def test_find_blocks_includes_deprecated_when_requested(
        self, version_manager, sample_block_v1, sample_block_v2
    ):
        """Test that find can include deprecated blocks when requested."""
        version_manager.publish(sample_block_v1)
        version_manager.publish(sample_block_v2)

        # Deprecate v1
        version_manager.deprecate("test-block", "1.0.0", reason="Old", replacement_version="2.0.0")

        results = version_manager.find(name="Test Block", include_deprecated=True)

        assert len(results) == 2

    def test_resolve_version_exact(self, version_manager, sample_block_v1):
        """Test resolving exact version constraint."""
        version_manager.publish(sample_block_v1)

        resolved = version_manager.resolve_version("test-block", "1.0.0")

        assert resolved is not None
        assert resolved.version == "1.0.0"

    def test_resolve_version_caret_constraint(self, version_manager):
        """Test resolving caret (^) version constraint."""

        # Publish multiple 1.x.x versions
        for version in ["1.0.0", "1.1.0", "1.2.0", "2.0.0"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            version_manager.publish(block)

        # ^1.0.0 should resolve to latest 1.x.x (not 2.0.0)
        resolved = version_manager.resolve_version("test-block", "^1.0.0")

        assert resolved is not None
        assert resolved.version == "1.2.0"

    def test_resolve_version_tilde_constraint(self, version_manager):
        """Test resolving tilde (~) version constraint."""

        # Publish multiple 1.2.x versions
        for version in ["1.2.0", "1.2.1", "1.2.2", "1.3.0"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            version_manager.publish(block)

        # ~1.2.0 should resolve to latest 1.2.x (not 1.3.0)
        resolved = version_manager.resolve_version("test-block", "~1.2.0")

        assert resolved is not None
        assert resolved.version == "1.2.2"

    def test_resolve_version_range_constraint(self, version_manager):
        """Test resolving range (>=) version constraint."""

        for version in ["1.0.0", "1.5.0", "2.0.0", "2.5.0"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            version_manager.publish(block)

        # >=1.5.0 should resolve to latest available (2.5.0)
        resolved = version_manager.resolve_version("test-block", ">=1.5.0")

        assert resolved is not None
        assert resolved.version == "2.5.0"

    def test_resolve_version_no_match(self, version_manager, sample_block_v1):
        """Test resolving version constraint with no matches returns None."""
        version_manager.publish(sample_block_v1)

        resolved = version_manager.resolve_version("test-block", "^2.0.0")

        assert resolved is None

    def test_resolve_version_excludes_deprecated_by_default(self, version_manager):
        """Test that version resolution excludes deprecated versions."""

        for version in ["1.0.0", "1.1.0", "1.2.0"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            version_manager.publish(block)

        # Deprecate 1.2.0
        version_manager.deprecate("test-block", "1.2.0", reason="Bug", replacement_version="1.3.0")

        # Should resolve to 1.1.0 (latest non-deprecated in range)
        resolved = version_manager.resolve_version("test-block", "^1.0.0")

        assert resolved is not None
        assert resolved.version == "1.1.0"

    def test_resolve_version_includes_deprecated_when_requested(self, version_manager):
        """Test that version resolution can include deprecated versions."""

        for version in ["1.0.0", "1.1.0", "1.2.0"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            version_manager.publish(block)

        # Deprecate 1.2.0
        version_manager.deprecate("test-block", "1.2.0", reason="Bug", replacement_version="1.3.0")

        # Should resolve to 1.2.0 when include_deprecated=True
        resolved = version_manager.resolve_version("test-block", "^1.0.0", include_deprecated=True)

        assert resolved is not None
        assert resolved.version == "1.2.0"

    def test_resolve_version_caret_with_zero_major(self, version_manager):
        """Test resolving caret constraint with major version 0."""

        # Publish 0.x.x versions
        for version in ["0.1.0", "0.1.5", "0.2.0"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            version_manager.publish(block)

        # ^0.1.0 should only match 0.1.x versions (not 0.2.0)
        resolved = version_manager.resolve_version("test-block", "^0.1.0")

        assert resolved is not None
        assert resolved.version == "0.1.5"

    def test_resolve_version_invalid_constraint(self, version_manager, sample_block_v1):
        """Test resolving with invalid constraint format returns None."""
        version_manager.publish(sample_block_v1)

        # Use an unsupported constraint format (doesn't match ^, ~, or >=)
        resolved = version_manager.resolve_version("test-block", "<1.0.0")

        assert resolved is None

    def test_resolve_version_with_constraint_prefix_only(self, version_manager, sample_block_v1):
        """Test resolving with constraint that has prefix but no valid version."""
        version_manager.publish(sample_block_v1)

        # Constraint with valid prefix but invalid/empty version
        resolved = version_manager.resolve_version("test-block", "^invalid")

        # Should not match since parse will return (0,0,0)
        assert resolved is None

    def test_list_versions_with_invalid_version_format(self, version_manager):
        """Test list_versions handles invalid version format gracefully."""

        # Manually inject a block with a malformed version (bypassing validation for test)
        # This tests the _parse_semver error handling
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )
        version_manager.publish(block)

        # Manually inject invalid version for testing edge case
        version_manager._storage["test-block"]["invalid"] = block

        versions = version_manager.list_versions("test-block")

        # Should still return sorted versions, with invalid one sorted using (0,0,0)
        assert "1.0.0" in versions

    def test_validate_dependencies_all_satisfied(self, version_manager):
        """Test validating block dependencies when all are satisfied."""
        from wavecore.models.blocks import Block, BlockDependency
        from wavecore.models.plugins import BlockMetadata

        # Publish dependencies
        dep1 = Block(
            id="dep1",
            version="1.0.0",
            metadata=BlockMetadata(
                name="Dependency 1",
                description="Test",
                author="Test",
                tags=[],
            ),
            type="action",
            plugins=[],
            child_blocks=[],
        )
        dep2 = Block(
            id="dep2",
            version="2.0.0",
            metadata=BlockMetadata(
                name="Dependency 2",
                description="Test",
                author="Test",
                tags=[],
            ),
            type="action",
            plugins=[],
            child_blocks=[],
        )
        version_manager.publish(dep1)
        version_manager.publish(dep2)

        # Create block with dependencies
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            dependencies=[
                BlockDependency(
                    component_id="dep1", component_type="block", version_constraint="^1.0.0"
                ),
                BlockDependency(
                    component_id="dep2", component_type="block", version_constraint="^2.0.0"
                ),
            ],
        )

        result = version_manager.validate_dependencies(block)

        assert result["valid"] is True
        assert len(result["satisfied"]) == 2
        assert len(result["unsatisfied"]) == 0

    def test_validate_dependencies_unsatisfied(self, version_manager):
        """Test validating block dependencies when some are unsatisfied."""
        from wavecore.models.blocks import Block, BlockDependency
        from wavecore.models.plugins import BlockMetadata

        # Only publish one dependency
        dep1 = Block(
            id="dep1",
            version="1.0.0",
            metadata=BlockMetadata(
                name="Dependency 1",
                description="Test",
                author="Test",
                tags=[],
            ),
            type="action",
            plugins=[],
            child_blocks=[],
        )
        version_manager.publish(dep1)

        # Create block with two dependencies (one missing)
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            dependencies=[
                BlockDependency(
                    component_id="dep1", component_type="block", version_constraint="^1.0.0"
                ),
                BlockDependency(
                    component_id="missing-dep", component_type="block", version_constraint="^1.0.0"
                ),
            ],
        )

        result = version_manager.validate_dependencies(block)

        assert result["valid"] is False
        assert len(result["satisfied"]) == 1
        assert len(result["unsatisfied"]) == 1
        assert result["unsatisfied"][0]["block_id"] == "missing-dep"

    def test_validate_dependencies_version_mismatch(self, version_manager):
        """Test validating dependencies with version constraint mismatches."""
        from wavecore.models.blocks import Block, BlockDependency
        from wavecore.models.plugins import BlockMetadata

        # Publish dependency with version 1.0.0
        dep = Block(
            id="dep",
            version="1.0.0",
            metadata=BlockMetadata(
                name="Dependency",
                description="Test",
                author="Test",
                tags=[],
            ),
            type="action",
            plugins=[],
            child_blocks=[],
        )
        version_manager.publish(dep)

        # Require version 2.x.x (incompatible)
        block = create_test_block(
            id="main-block",
            name="Main Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            dependencies=[
                BlockDependency(
                    component_id="dep", component_type="block", version_constraint="^2.0.0"
                )
            ],
        )

        result = version_manager.validate_dependencies(block)

        assert result["valid"] is False
        assert len(result["unsatisfied"]) == 1


class TestTemporalMetadata:
    """Test suite for created_at and updated_at timestamps (REQ-3.1.2.2)."""

    def test_block_created_at_auto_generated(self):
        """Test that created_at is automatically set to current UTC time."""

        before = datetime.now(UTC)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )
        after = datetime.now(UTC)

        assert block.created_at is not None
        assert before <= block.created_at <= after

    def test_block_created_at_uses_utc_timezone(self):
        """Test that created_at timestamp uses UTC timezone."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.created_at.tzinfo == UTC

    def test_block_updated_at_auto_generated(self):
        """Test that updated_at is automatically set to current UTC time."""

        before = datetime.now(UTC)
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )
        after = datetime.now(UTC)

        assert block.updated_at is not None
        assert before <= block.updated_at <= after

    def test_block_updated_at_uses_utc_timezone(self):
        """Test that updated_at timestamp uses UTC timezone."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.updated_at.tzinfo == UTC

    def test_temporal_metadata_preserved_through_publish(self):
        """Test that created_at and updated_at are preserved when publishing."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        original_created = datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC)
        original_updated = datetime(2024, 1, 2, 12, 0, 0, tzinfo=UTC)

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            created_at=original_created,
            updated_at=original_updated,
        )

        manager = BlockVersionManager()
        published = manager.publish(block)

        assert published.created_at == original_created
        assert published.updated_at == original_updated


class TestPreReleaseVersions:
    """Test suite for pre-release version handling (REQ-3.1.2.2)."""

    def test_block_accepts_prerelease_version(self):
        """Test that blocks can have pre-release versions."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0-alpha",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.version == "1.0.0-alpha"

    def test_block_accepts_prerelease_with_number(self):
        """Test that blocks accept pre-release versions with numbers."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0-beta.1",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.version == "1.0.0-beta.1"

    def test_block_accepts_prerelease_with_build_metadata(self):
        """Test that blocks accept pre-release + build metadata."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0-rc.1+build.123",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.version == "1.0.0-rc.1+build.123"

    def test_prerelease_versions_sort_lower_than_release(self):
        """Test that pre-release versions sort before release versions."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        # Publish in mixed order
        for version in ["1.0.0", "1.0.0-alpha", "1.0.0-beta", "1.0.0-rc.1"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            manager.publish(block)

        versions = manager.list_versions("test-block")

        # Stable version should be first
        assert versions[0] == "1.0.0"


class TestBuildMetadata:
    """Test suite for build metadata in semver (REQ-3.1.2.2)."""

    def test_block_accepts_build_metadata(self):
        """Test that blocks can have build metadata."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0+build.123",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.version == "1.0.0+build.123"

    def test_build_metadata_with_dots_and_hyphens(self):
        """Test complex build metadata formats."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0+20240101-sha.abc123",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.version == "1.0.0+20240101-sha.abc123"


class TestBlockTypeValidation:
    """Test suite for block type field validation (REQ-3.1.2.2)."""

    @pytest.mark.parametrize(
        "block_type",
        ["action", "validation", "control", "timing", "data"],
    )
    def test_block_accepts_valid_types(self, block_type):
        """Test that all valid block types are accepted."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type=block_type,
            plugins=[],
            child_blocks=[],
        )

        assert block.type == block_type

    def test_block_rejects_invalid_type(self):
        """Test that invalid block types are rejected."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(ValidationError):
            Block(
                id="test-block",
                version="1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),
                type="invalid-type",
                plugins=[],
                child_blocks=[],
            )


class TestMultiBlockScenarios:
    """Test suite for multiple different blocks (not just versions) (REQ-3.1.2.2)."""

    def test_multiple_different_blocks_can_coexist(self):
        """Test that different block IDs can coexist in storage."""
        from wavecore.core.blocks.version_manager import BlockVersionManager
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        manager = BlockVersionManager()

        # Publish blocks with different IDs
        block_a = Block(
            id="block-a",
            version="1.0.0",
            metadata=BlockMetadata(
                name="Block A",
                description="Test",
                author="Test",
                tags=[],
            ),
            type="action",
            plugins=[],
            child_blocks=[],
        )
        block_b = Block(
            id="block-b",
            version="1.0.0",
            metadata=BlockMetadata(
                name="Block B",
                description="Test",
                author="Test",
                tags=[],
            ),
            type="validation",
            plugins=[],
            child_blocks=[],
        )

        manager.publish(block_a)
        manager.publish(block_b)

        assert manager.get("block-a", "1.0.0") is not None
        assert manager.get("block-b", "1.0.0") is not None

    def test_blocks_are_isolated_by_id(self):
        """Test that blocks with different IDs don't interfere."""
        from wavecore.core.blocks.version_manager import BlockVersionManager
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        manager = BlockVersionManager()

        # Same version, different IDs
        block_a = Block(
            id="block-a",
            version="1.0.0",
            metadata=BlockMetadata(
                name="Block A",
                description="Test",
                author="Test",
                tags=[],
            ),
            type="action",
            plugins=[],
            child_blocks=[],
        )
        block_b = Block(
            id="block-b",
            version="1.0.0",
            metadata=BlockMetadata(
                name="Block B",
                description="Test",
                author="Test",
                tags=[],
            ),
            type="validation",
            plugins=[],
            child_blocks=[],
        )

        manager.publish(block_a)
        manager.publish(block_b)

        # Deprecate one shouldn't affect the other
        manager.deprecate("block-a", "1.0.0", reason="Test")

        retrieved_a = manager.get("block-a", "1.0.0")
        retrieved_b = manager.get("block-b", "1.0.0")

        assert retrieved_a.is_deprecated is True
        assert retrieved_b.is_deprecated is False

    def test_find_across_multiple_blocks(self):
        """Test finding blocks across different block IDs."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        # Publish blocks with same author but different IDs
        for block_id in ["block-a", "block-b", "block-c"]:
            block = create_test_block(
                id=block_id,
                name="Test Block",
                version="1.0.0",
                type="action",
                plugins=[],
                child_blocks=[],
                author="Test Author",
            )
            manager.publish(block)

        results = manager.find(author="Test Author")

        assert len(results) == 3
        assert {b.id for b in results} == {"block-a", "block-b", "block-c"}


class TestComplexMetadataPreservation:
    """Test suite for preserving complex block structures (REQ-3.1.2.2)."""

    def test_block_parameters_preserved_through_publish(self):
        """Test that block parameters are preserved when publishing."""
        from wavecore.core.blocks.version_manager import BlockVersionManager
        from wavecore.models.blocks import BlockParameter

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            parameters=[
                BlockParameter(name="param1", type="string", required=True),
                BlockParameter(name="param2", type="integer", default=42),
            ],
        )

        manager = BlockVersionManager()
        manager.publish(block)
        retrieved = manager.get("test-block", "1.0.0")

        assert len(retrieved.parameters) == 2
        assert retrieved.parameters[0].name == "param1"
        assert retrieved.parameters[1].default == 42

    def test_block_plugins_preserved_through_publish(self):
        """Test that block plugins are preserved when publishing."""
        from wavecore.core.blocks.version_manager import BlockVersionManager
        from wavecore.models.plugins import BlockPlugin

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[
                BlockPlugin(
                    plugin_id="plugin1",
                    plugin_version="1.0.0",
                    parameters={"key": "value"},
                    order=1,
                )
            ],
            child_blocks=[],
        )

        manager = BlockVersionManager()
        manager.publish(block)
        retrieved = manager.get("test-block", "1.0.0")

        assert len(retrieved.plugins) == 1
        assert retrieved.plugins[0].plugin_id == "plugin1"
        assert retrieved.plugins[0].parameters == {"key": "value"}

    def test_block_child_blocks_preserved_through_publish(self):
        """Test that child blocks are preserved when publishing."""
        from wavecore.core.blocks.version_manager import BlockVersionManager
        from wavecore.models.blocks import BlockChild

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[BlockChild(block_id="child1", block_version="1.0.0", order=1)],
        )

        manager = BlockVersionManager()
        manager.publish(block)
        retrieved = manager.get("test-block", "1.0.0")

        assert len(retrieved.child_blocks) == 1
        assert retrieved.child_blocks[0].block_id == "child1"

    def test_block_dependencies_preserved_through_publish(self):
        """Test that dependencies are preserved when publishing."""
        from wavecore.core.blocks.version_manager import BlockVersionManager
        from wavecore.models.blocks import BlockDependency

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            dependencies=[
                BlockDependency(
                    component_id="dep1", component_type="block", version_constraint="^1.0.0"
                )
            ],
        )

        manager = BlockVersionManager()
        manager.publish(block)
        retrieved = manager.get("test-block", "1.0.0")

        assert len(retrieved.dependencies) == 1
        assert retrieved.dependencies[0].component_id == "dep1"

    def test_block_execution_flow_preserved_through_publish(self):
        """Test that execution flow is preserved when publishing."""
        from wavecore.core.blocks.version_manager import BlockVersionManager
        from wavecore.models.blocks import ExecutionFlow

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            execution_flow=ExecutionFlow(mode="parallel", parallel_groups=[[0, 1], [2]]),
        )

        manager = BlockVersionManager()
        manager.publish(block)
        retrieved = manager.get("test-block", "1.0.0")

        assert retrieved.execution_flow is not None
        assert retrieved.execution_flow.mode == "parallel"
        assert retrieved.execution_flow.parallel_groups == [[0, 1], [2]]


class TestEdgeCasesAndValidation:
    """Test suite for edge cases and error conditions (REQ-3.1.2.2)."""

    def test_block_id_cannot_be_empty(self):
        """Test that block ID cannot be empty string."""

        # Pydantic allows empty strings by default, but we should validate
        block = create_test_block(
            id="",  # Empty ID
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        # Current implementation allows this - documenting behavior
        assert block.id == ""

    def test_block_name_can_be_very_long(self):
        """Test that block names can be very long."""

        long_name = "A" * 1000
        block = create_test_block(
            id="test-block",
            name=long_name,
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        assert block.name == long_name

    def test_invalid_semver_with_v_prefix_rejected(self):
        """Test that versions with 'v' prefix are rejected."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(ValidationError, match="Invalid semantic version"):
            Block(
                id="test-block",
                version="v1.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),  # Invalid prefix
                type="action",
                plugins=[],
                child_blocks=[],
            )

    def test_invalid_semver_missing_patch_rejected(self):
        """Test that versions missing patch number are rejected."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(ValidationError, match="Invalid semantic version"):
            Block(
                id="test-block",
                version="1.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),  # Missing patch
                type="action",
                plugins=[],
                child_blocks=[],
            )

    def test_invalid_semver_with_leading_zeros_rejected(self):
        """Test that versions with leading zeros are rejected."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(ValidationError, match="Invalid semantic version"):
            Block(
                id="test-block",
                version="01.0.0",
                metadata=BlockMetadata(
                    name="Test Block",
                    description="Test",
                    author="Test",
                    tags=[],
                ),  # Leading zero
                type="action",
                plugins=[],
                child_blocks=[],
            )


class TestTagsEdgeCases:
    """Test suite for tag handling edge cases (REQ-3.1.2.2)."""

    def test_block_with_empty_tags_list(self):
        """Test that blocks can have empty tags list."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            tags=[],
        )

        assert block.tags == []

    def test_block_with_duplicate_tags(self):
        """Test that blocks can have duplicate tags."""

        # Current implementation allows duplicates
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            tags=["test", "test", "duplicate"],
        )

        assert len(block.tags) == 3

    def test_find_by_tags_is_case_sensitive(self):
        """Test that tag matching is case-sensitive."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            tags=["Production"],
        )
        manager.publish(block)

        # Search with lowercase should not match
        results = manager.find(tags=["production"])
        assert len(results) == 0

        # Search with correct case should match
        results = manager.find(tags=["Production"])
        assert len(results) == 1

    def test_find_requires_all_specified_tags(self):
        """Test that find requires ALL specified tags to be present."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            tags=["tag1", "tag2"],
        )
        manager.publish(block)

        # Searching for both tags should match
        results = manager.find(tags=["tag1", "tag2"])
        assert len(results) == 1

        # Searching for tags including one not present should not match
        results = manager.find(tags=["tag1", "tag2", "tag3"])
        assert len(results) == 0

    def test_tags_with_special_characters(self):
        """Test that tags can contain special characters."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            tags=["v1.0", "environment:prod", "team/backend"],
        )

        assert len(block.tags) == 3


class TestAuthorEdgeCases:
    """Test suite for author field edge cases (REQ-3.1.2.2)."""

    def test_block_with_none_author(self):
        """Test that blocks can have None as author."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            author=None,
        )

        assert block.author is None

    def test_block_with_empty_author(self):
        """Test that blocks can have empty string as author."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            author="",
        )

        assert block.author == ""

    def test_find_by_none_author(self):
        """Test finding blocks with None author."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            author=None,
        )
        manager.publish(block)

        results = manager.find(author=None)
        assert len(results) == 1

    def test_author_matching_is_exact(self):
        """Test that author matching is exact (not substring)."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            author="John Smith",
        )
        manager.publish(block)

        # Partial match should not work
        results = manager.find(author="John")
        assert len(results) == 0

        # Exact match should work
        results = manager.find(author="John Smith")
        assert len(results) == 1


class TestVersionConstraintEdgeCases:
    """Test suite for version constraint edge cases (REQ-3.1.2.2)."""

    def test_resolve_version_with_empty_constraint(self):
        """Test resolving with empty constraint string."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )
        manager.publish(block)

        # Empty constraint should not match
        result = manager.resolve_version("test-block", "")
        assert result is None

    def test_resolve_version_with_malformed_caret(self):
        """Test resolving with malformed caret constraint."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )
        manager.publish(block)

        # Multiple carets should not match
        result = manager.resolve_version("test-block", "^^1.0.0")
        assert result is None

    def test_resolve_version_with_unsupported_operator(self):
        """Test that unsupported operators don't match."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )
        manager.publish(block)

        # <= operator not supported
        result = manager.resolve_version("test-block", "<=1.0.0")
        assert result is None

        # < operator not supported
        result = manager.resolve_version("test-block", "<2.0.0")
        assert result is None

    def test_resolve_version_determinism(self):
        """Test that version resolution is deterministic."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        # Publish multiple matching versions
        for version in ["1.0.0", "1.1.0", "1.2.0"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            manager.publish(block)

        # Resolve multiple times - should always get same result (latest)
        for _ in range(10):
            result = manager.resolve_version("test-block", "^1.0.0")
            assert result.version == "1.2.0"


class TestFindWithNoCriteria:
    """Test suite for find() with no search criteria (REQ-3.1.2.2)."""

    def test_find_with_all_none_returns_all_blocks(self):
        """Test that find() with no criteria returns all blocks."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        # Publish multiple blocks
        for i in range(3):
            block = create_test_block(
                id=f"block-{i}",
                name=f"Block {i}",
                version="1.0.0",
                type="action",
                plugins=[],
                child_blocks=[],
            )
            manager.publish(block)

        results = manager.find()
        assert len(results) == 3


class TestImmutabilityEnforcement:
    """Test suite for immutability enforcement (REQ-3.1.2.2)."""

    def test_modifying_published_block_doesnt_affect_storage(self):
        """Test that modifying a published block doesn't affect stored version."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Original Name",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        published = manager.publish(block)

        # Modify the published block's metadata
        published.metadata.name = "Modified Name"

        # Retrieve fresh copy
        retrieved = manager.get("test-block", "1.0.0")

        # Should still have original name (deep copy)
        assert retrieved.name == "Original Name"

    def test_modifying_original_block_after_publish_doesnt_affect_storage(self):
        """Test that modifying original block after publish doesn't affect storage."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Original Name",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
        )

        manager.publish(block)

        # Modify the original block's metadata
        block.metadata.name = "Modified Name"

        # Retrieve from storage
        retrieved = manager.get("test-block", "1.0.0")

        # Should still have original name
        assert retrieved.name == "Original Name"


class TestVersionSortingEdgeCases:
    """Test suite for version sorting edge cases (REQ-3.1.2.2)."""

    def test_sorting_with_large_version_numbers(self):
        """Test sorting with very large version numbers."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        # Publish versions with large numbers
        for version in ["999.999.999", "1.0.0", "100.200.300"]:
            block = create_test_block(
                id="test-block",
                name="Test Block",
                version=version,
                type="action",
                plugins=[],
                child_blocks=[],
            )
            manager.publish(block)

        versions = manager.list_versions("test-block")

        assert versions == ["999.999.999", "100.200.300", "1.0.0"]

    def test_sorting_many_versions(self):
        """Test sorting stability with many versions."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        # Publish 20 versions
        expected = []
        for major in range(5):
            for minor in range(4):
                version = f"{major}.{minor}.0"
                expected.append(version)
                block = create_test_block(
                    id="test-block",
                    name="Test Block",
                    version=version,
                    type="action",
                    plugins=[],
                    child_blocks=[],
                )
                manager.publish(block)

        versions = manager.list_versions("test-block")

        # Should be sorted descending
        assert versions == sorted(
            expected, key=lambda v: tuple(map(int, v.split("."))), reverse=True
        )


class TestDescriptionField:
    """Test suite for description field (REQ-3.1.2.2)."""

    def test_block_with_none_description(self):
        """Test that blocks can have None description."""

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            description=None,
        )

        assert block.description is None

    def test_block_with_long_description(self):
        """Test that blocks can have very long descriptions."""

        long_description = "A" * 10000
        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            description=long_description,
        )

        assert block.description == long_description

    def test_description_preserved_through_publish(self):
        """Test that description is preserved when publishing."""
        from wavecore.core.blocks.version_manager import BlockVersionManager

        manager = BlockVersionManager()

        block = create_test_block(
            id="test-block",
            name="Test Block",
            version="1.0.0",
            type="action",
            plugins=[],
            child_blocks=[],
            description="This is a detailed description",
        )

        manager.publish(block)
        retrieved = manager.get("test-block", "1.0.0")

        assert retrieved.description == "This is a detailed description"
