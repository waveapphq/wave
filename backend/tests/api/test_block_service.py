"""Unit tests for block service layer (REQ-5.2.4.2).

This module tests the block service layer which provides business logic
for block management operations including CRUD, versioning, dependencies,
validation, and import/export.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services.blocks import _storage as _block_storage
from wavecore.api.services.blocks import service as block_service
from wavecore.api.services.blocks import version_service as _block_version_svc


class TestListBlocks:
    """Test suite for list_blocks service function."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_list_blocks_returns_empty_when_no_blocks(self) -> None:
        """Test that list_blocks returns empty list when no blocks exist."""
        result = block_service.list_blocks()

        assert result["blocks"] == []
        assert result["total"] == 0
        assert result["page"] == 1
        assert result["per_page"] == 20
        assert result["total_pages"] == 0

    def test_list_blocks_returns_blocks_with_pagination(self) -> None:
        """Test that list_blocks returns paginated results."""
        # Create some blocks using the public API
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            for i in range(25):
                block_service.create_block(
                    {
                        "name": f"Block {i}",
                        "description": f"Description {i}",
                        "plugin_id": str(uuid.uuid4()),
                        "metadata": {"tags": ["test"]},
                    }
                )

        result = block_service.list_blocks(page=1, per_page=10)

        assert len(result["blocks"]) == 10
        assert result["total"] == 25
        assert result["page"] == 1
        assert result["per_page"] == 10
        assert result["total_pages"] == 3

    def test_list_blocks_with_search_filter(self) -> None:
        """Test that list_blocks filters by search text."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block_service.create_block(
                {
                    "name": "SSH Login",
                    "description": "SSH connection block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            block_service.create_block(
                {
                    "name": "HTTP Request",
                    "description": "HTTP client block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = block_service.list_blocks(search="SSH")

        assert len(result["blocks"]) == 1
        assert result["blocks"][0]["name"] == "SSH Login"

    def test_list_blocks_with_plugin_id_filter(self) -> None:
        """Test that list_blocks filters by plugin_id."""
        plugin_id = str(uuid.uuid4())
        other_plugin = str(uuid.uuid4())

        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block_service.create_block(
                {
                    "name": "Block 1",
                    "plugin_id": plugin_id,
                }
            )
            block_service.create_block(
                {
                    "name": "Block 2",
                    "plugin_id": other_plugin,
                }
            )

        result = block_service.list_blocks(plugin_id=plugin_id)

        assert len(result["blocks"]) == 1
        assert result["blocks"][0]["plugin_id"] == plugin_id

    def test_list_blocks_with_tags_filter(self) -> None:
        """Test that list_blocks filters by tags."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block_service.create_block(
                {
                    "name": "Block 1",
                    "plugin_id": str(uuid.uuid4()),
                    "metadata": {"tags": ["network", "ssh"]},
                }
            )
            block_service.create_block(
                {
                    "name": "Block 2",
                    "plugin_id": str(uuid.uuid4()),
                    "metadata": {"tags": ["data"]},
                }
            )

        result = block_service.list_blocks(tags=["network"])

        assert len(result["blocks"]) == 1
        assert result["blocks"][0]["name"] == "Block 1"


class TestCreateBlock:
    """Test suite for create_block service function."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_create_block_success(self) -> None:
        """Test that create_block creates a new block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()

            result = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                    "description": "A test block",
                }
            )

            assert result["name"] == "Test Block"
            assert result["version"] == "1.0.0"
            assert "id" in result
            assert "created_at" in result

    def test_create_block_raises_on_duplicate_name(self) -> None:
        """Test that create_block raises error on duplicate name."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block_service.create_block({"name": "Existing Block", "plugin_id": str(uuid.uuid4())})

        with pytest.raises(ConflictException, match="already exists"):
            block_service.create_block({"name": "Existing Block", "plugin_id": str(uuid.uuid4())})

    def test_create_block_raises_on_missing_plugin(self) -> None:
        """Test that create_block raises error when plugin not found."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.side_effect = FileNotFoundError("Plugin not found")

            with pytest.raises(ValidationException, match="not found"):
                block_service.create_block({"name": "Test Block", "plugin_id": str(uuid.uuid4())})

    def test_create_block_detects_circular_dependency(self) -> None:
        """Test that create_block detects circular dependencies."""
        # Create a block that will be referenced
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            dep_block = block_service.create_block(
                {
                    "name": "Dep Block",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": ["New Block"],  # Depends on the new block
                }
            )

            with pytest.raises(ValidationException, match="Circular dependency"):
                block_service.create_block(
                    {
                        "name": "New Block",
                        "plugin_id": str(uuid.uuid4()),
                        "dependencies": [dep_block["id"]],
                    }
                )


class TestGetBlock:
    """Test suite for get_block service function."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_get_block_returns_block(self) -> None:
        """Test that get_block returns existing block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = block_service.get_block(created["id"])

        assert result is not None
        assert result["name"] == "Test Block"

    def test_get_block_returns_none_for_missing(self) -> None:
        """Test that get_block returns None for non-existent block."""
        result = block_service.get_block(str(uuid.uuid4()))

        assert result is None


class TestDeleteBlock:
    """Test suite for delete_block service function."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_delete_block_success(self) -> None:
        """Test that delete_block removes a block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = block_service.delete_block(created["id"])

        assert result is True
        assert block_service.get_block(created["id"]) is None

    def test_delete_block_returns_false_for_missing(self) -> None:
        """Test that delete_block returns False for non-existent block."""
        result = block_service.delete_block(str(uuid.uuid4()))

        assert result is False

    def test_delete_block_raises_on_dependents_without_cascade(self) -> None:
        """Test that delete_block raises error when dependents exist."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            target = block_service.create_block(
                {
                    "name": "Target Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            block_service.create_block(
                {
                    "name": "Dependent Block",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": [target["id"]],
                }
            )

        with pytest.raises(ConflictException, match="Cannot delete"):
            block_service.delete_block(target["id"], cascade=False)

    def test_delete_block_with_cascade(self) -> None:
        """Test that delete_block with cascade removes block despite dependents."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            target = block_service.create_block(
                {
                    "name": "Target Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            block_service.create_block(
                {
                    "name": "Dependent Block",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": [target["id"]],
                }
            )

        result = block_service.delete_block(target["id"], cascade=True)

        assert result is True


class TestBatchOperations:
    """Test suite for batch operations."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_batch_create_blocks_success(self) -> None:
        """Test that batch_create_blocks creates multiple blocks."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()

            result = block_service.batch_create_blocks(
                [
                    {"name": "Block 1", "plugin_id": str(uuid.uuid4())},
                    {"name": "Block 2", "plugin_id": str(uuid.uuid4())},
                ]
            )

            assert len(result["created"]) == 2
            assert result["failed"] == []

    def test_batch_create_blocks_partial_failure(self) -> None:
        """Test that batch_create_blocks handles partial failures."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block_service.create_block({"name": "Block 1", "plugin_id": str(uuid.uuid4())})

            result = block_service.batch_create_blocks(
                [
                    {"name": "Block 1", "plugin_id": str(uuid.uuid4())},
                    {"name": "Block 2", "plugin_id": str(uuid.uuid4())},
                ]
            )

            assert len(result["created"]) == 1
            assert len(result["failed"]) == 1
            assert result["failed"][0]["index"] == 0

    def test_batch_update_blocks_success(self) -> None:
        """Test that batch_update_blocks updates multiple blocks."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block1 = block_service.create_block({"name": "Block 1", "plugin_id": str(uuid.uuid4())})
            block2 = block_service.create_block({"name": "Block 2", "plugin_id": str(uuid.uuid4())})

        result = block_service.batch_update_blocks(
            [
                {"id": block1["id"], "update": {"description": "Updated 1"}},
                {"id": block2["id"], "update": {"description": "Updated 2"}},
            ]
        )

        assert len(result["updated"]) == 2
        assert result["failed"] == []

    def test_batch_update_blocks_missing_block(self) -> None:
        """Test that batch_update_blocks handles missing blocks."""
        result = block_service.batch_update_blocks(
            [{"id": str(uuid.uuid4()), "update": {"description": "Updated"}}]
        )

        assert result["updated"] == []
        assert len(result["failed"]) == 1

    def test_batch_delete_blocks_success(self) -> None:
        """Test that batch_delete_blocks deletes multiple blocks."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block1 = block_service.create_block({"name": "Block 1", "plugin_id": str(uuid.uuid4())})
            block2 = block_service.create_block({"name": "Block 2", "plugin_id": str(uuid.uuid4())})

        result = block_service.batch_delete_blocks([block1["id"], block2["id"]])

        assert len(result["deleted"]) == 2
        assert result["failed"] == []

    def test_batch_delete_blocks_missing_block(self) -> None:
        """Test that batch_delete_blocks handles missing blocks."""
        result = block_service.batch_delete_blocks([str(uuid.uuid4())])

        assert result["deleted"] == []
        assert len(result["failed"]) == 1


class TestVersionOperations:
    """Test suite for version operations."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_list_block_versions_returns_versions(self) -> None:
        """Test that list_block_versions returns version list."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            _block_version_svc.add_block_version(created["id"], {"version_bump": "minor"})

        result = _block_version_svc.list_block_versions(created["id"])

        assert result is not None
        assert "1.0.0" in result
        assert "1.1.0" in result

    def test_list_block_versions_returns_none_for_missing(self) -> None:
        """Test that list_block_versions returns None for missing block."""
        result = _block_version_svc.list_block_versions(str(uuid.uuid4()))

        assert result is None

    def test_add_block_version_minor_bump(self) -> None:
        """Test that add_block_version creates minor version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.add_block_version(
            created["id"], {"description": "Updated", "version_bump": "minor"}
        )

        assert result is not None
        assert result["version"] == "1.1.0"

    def test_add_block_version_major_bump(self) -> None:
        """Test that add_block_version creates major version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.add_block_version(
            created["id"], {"description": "Breaking change", "version_bump": "major"}
        )

        assert result is not None
        assert result["version"] == "2.0.0"

    def test_add_block_version_patch_bump(self) -> None:
        """Test that add_block_version creates patch version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.add_block_version(
            created["id"], {"description": "Bug fix", "version_bump": "patch"}
        )

        assert result is not None
        assert result["version"] == "1.0.1"

    def test_add_block_version_backward_compatibility_violation(self) -> None:
        """Test that add_block_version raises on backward compatibility violation."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                    "parameters": {"host": {"required": True}},
                }
            )

        with pytest.raises(ValidationException, match="Backward compatibility violation"):
            _block_version_svc.add_block_version(
                created["id"], {"parameters": {}, "version_bump": "minor"}
            )

    def test_add_block_version_returns_none_for_missing(self) -> None:
        """Test that add_block_version returns None for missing block."""
        result = _block_version_svc.add_block_version(str(uuid.uuid4()), {})

        assert result is None

    def test_get_block_version_returns_version(self) -> None:
        """Test that get_block_version returns specific version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            _block_version_svc.add_block_version(created["id"], {"version_bump": "minor"})

        result = _block_version_svc.get_block_version(created["id"], "1.0.0")

        assert result is not None
        assert result["version"] == "1.0.0"
        assert result["is_latest"] is False

    def test_get_block_version_returns_none_for_missing_block(self) -> None:
        """Test that get_block_version returns None for missing block."""
        result = _block_version_svc.get_block_version(str(uuid.uuid4()), "1.0.0")

        assert result is None

    def test_get_block_version_returns_none_for_missing_version(self) -> None:
        """Test that get_block_version returns None for missing version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.get_block_version(created["id"], "99.0.0")

        assert result is None

    def test_update_block_version_success(self) -> None:
        """Test that update_block_version updates version metadata."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.update_block_version(
            created["id"], "1.0.0", {"description": "Updated"}
        )

        assert result is not None
        assert result["description"] == "Updated"

    def test_update_block_version_raises_on_published(self) -> None:
        """Test that update_block_version raises for published version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
        # Mark version as published
        _block_storage._set_version_attribute(created["id"], "1.0.0", "published", True)

        with pytest.raises(ConflictException, match="immutable"):
            _block_version_svc.update_block_version(created["id"], "1.0.0", {})

    def test_update_block_version_raises_on_etag_mismatch(self) -> None:
        """Test that update_block_version raises on ETag mismatch."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        with pytest.raises(ConflictException, match="Precondition failed"):
            _block_version_svc.update_block_version(created["id"], "1.0.0", {}, etag="wrong-etag")

    def test_update_block_version_returns_none_for_missing_block(self) -> None:
        """Test that update_block_version returns None for missing block."""
        result = _block_version_svc.update_block_version(str(uuid.uuid4()), "1.0.0", {})

        assert result is None

    def test_update_block_version_returns_none_for_missing_version(self) -> None:
        """Test that update_block_version returns None for missing version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.update_block_version(created["id"], "99.0.0", {})

        assert result is None

    def test_delete_block_version_success(self) -> None:
        """Test that delete_block_version removes version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            _block_version_svc.add_block_version(created["id"], {"version_bump": "minor"})

        result = _block_version_svc.delete_block_version(created["id"], "1.0.0")

        assert result is True
        versions = _block_version_svc.list_block_versions(created["id"])
        assert versions is not None
        assert "1.0.0" not in versions

    def test_delete_block_version_returns_false_for_missing_block(self) -> None:
        """Test that delete_block_version returns False for missing block."""
        result = _block_version_svc.delete_block_version(str(uuid.uuid4()), "1.0.0")

        assert result is False

    def test_delete_block_version_returns_false_for_missing_version(self) -> None:
        """Test that delete_block_version returns False for missing version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.delete_block_version(created["id"], "99.0.0")

        assert result is False

    def test_delete_block_version_raises_on_dependencies(self) -> None:
        """Test that delete_block_version raises when version has dependencies."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            target = block_service.create_block(
                {
                    "name": "Target",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            block_service.create_block(
                {
                    "name": "Dependent",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": [target["id"]],
                }
            )

        with pytest.raises(ConflictException, match="Cannot delete"):
            _block_version_svc.delete_block_version(target["id"], "1.0.0")


class TestDependencyOperations:
    """Test suite for dependency operations."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_get_block_dependencies_returns_dependencies(self) -> None:
        """Test that get_block_dependencies returns dependency tree."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            dep = block_service.create_block(
                {
                    "name": "Dep Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            plugin_id = str(uuid.uuid4())
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": plugin_id,
                    "dependencies": [dep["id"]],
                }
            )

        result = _block_storage.get_block_dependencies(created["id"])

        assert result is not None
        assert result["root"] == created["id"]
        assert len(result["dependencies"]) == 2  # block + plugin

    def test_get_block_dependencies_returns_none_for_missing(self) -> None:
        """Test that get_block_dependencies returns None for missing block."""
        result = _block_storage.get_block_dependencies(str(uuid.uuid4()))

        assert result is None

    def test_get_block_dependents_returns_dependents(self) -> None:
        """Test that get_block_dependents returns what depends on block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            target = block_service.create_block(
                {
                    "name": "Target Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            dependent = block_service.create_block(
                {
                    "name": "Dependent Block",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": [target["id"]],
                }
            )

        result = _block_storage.get_block_dependents(target["id"])

        assert result is not None
        assert dependent["id"] in result["blocks"]

    def test_get_block_dependents_returns_none_for_missing(self) -> None:
        """Test that get_block_dependents returns None for missing block."""
        result = _block_storage.get_block_dependents(str(uuid.uuid4()))

        assert result is None

    def test_get_block_usage_returns_usage(self) -> None:
        """Test that get_block_usage returns usage information."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_storage.get_block_usage(created["id"])

        assert result is not None
        assert "tests" in result
        assert "workflows" in result

    def test_get_block_usage_returns_none_for_missing(self) -> None:
        """Test that get_block_usage returns None for missing block."""
        result = _block_storage.get_block_usage(str(uuid.uuid4()))

        assert result is None


class TestCloneBlock:
    """Test suite for clone_block service function."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_clone_block_success(self) -> None:
        """Test that clone_block creates a copy of the block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            original = block_service.create_block(
                {
                    "name": "Original Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.clone_block(original["id"], "Cloned Block")

        assert result is not None
        assert result["name"] == "Cloned Block"
        assert result["metadata"]["cloned_from"] == original["id"]

    def test_clone_block_with_custom_version(self) -> None:
        """Test that clone_block accepts custom version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            original = block_service.create_block(
                {
                    "name": "Original Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.clone_block(original["id"], "Cloned Block", "2.0.0")

        assert result is not None
        assert result["version"] == "2.0.0"

    def test_clone_block_returns_none_for_missing(self) -> None:
        """Test that clone_block returns None for missing source."""
        result = _block_version_svc.clone_block(str(uuid.uuid4()), "Cloned Block")

        assert result is None


class TestImportBlock:
    """Test suite for import_block service function."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_import_block_success(self) -> None:
        """Test that import_block imports from YAML content."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()

            content = b"name: Imported Block\nplugin_id: test-plugin\n"
            result = _block_version_svc.import_block(content, "block.yaml")

            assert result["name"] == "Imported Block"

    def test_import_block_raises_on_invalid_yaml(self) -> None:
        """Test that import_block raises on invalid YAML."""
        content = b"invalid: yaml: content: :::"

        with pytest.raises(ValidationException, match="Invalid YAML"):
            _block_version_svc.import_block(content, "block.yaml")

    def test_import_block_raises_on_conflict_without_overwrite(self) -> None:
        """Test that import_block raises when block exists without overwrite."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block_service.create_block({"name": "Existing Block", "plugin_id": str(uuid.uuid4())})

        content = b"name: Existing Block\nplugin_id: test\n"

        with pytest.raises(ConflictException, match="already exists"):
            _block_version_svc.import_block(content, "block.yaml", overwrite=False)

    def test_import_block_with_overwrite(self) -> None:
        """Test that import_block overwrites existing block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block_service.create_block(
                {
                    "name": "Existing Block",
                    "plugin_id": str(uuid.uuid4()),
                    "description": "Old description",
                }
            )

        content = b"name: Existing Block\nplugin_id: test\ndescription: New description\n"
        result = _block_version_svc.import_block(content, "block.yaml", overwrite=True)

        assert result["description"] == "New description"

    def test_import_block_raises_on_non_mapping(self) -> None:
        """Test that import_block raises when YAML is not a mapping."""
        content = b"- item1\n- item2\n"

        with pytest.raises(ValidationException, match="expected mapping"):
            _block_version_svc.import_block(content, "block.yaml")


class TestValidateBlock:
    """Test suite for validate_block service function."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_validate_block_returns_valid_for_complete_block(self) -> None:
        """Test that validate_block returns valid for complete block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_plugin = MagicMock()
            mock_plugin.parameters = []
            mock_load.return_value = mock_plugin

            result = _block_version_svc.validate_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                    "description": "A test block",
                }
            )

            assert result["data"]["valid"] is True
            assert result["data"]["errors"] == []

    def test_validate_block_returns_errors_for_missing_fields(self) -> None:
        """Test that validate_block returns errors for missing fields."""
        result = _block_version_svc.validate_block({})

        assert result["data"]["valid"] is False
        assert len(result["data"]["errors"]) >= 2

    def test_validate_block_returns_warning_for_missing_description(self) -> None:
        """Test that validate_block returns warning for missing description."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_plugin = MagicMock()
            mock_plugin.parameters = []
            mock_load.return_value = mock_plugin

            result = _block_version_svc.validate_block(
                {"name": "Test Block", "plugin_id": str(uuid.uuid4())}
            )

            assert "warnings" in result["data"]
            assert any("description" in w for w in result["data"]["warnings"])

    def test_validate_block_detects_circular_dependency(self) -> None:
        """Test that validate_block detects circular dependencies."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            dep = block_service.create_block(
                {
                    "name": "Dep Block",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": ["New Block"],
                }
            )

            result = _block_version_svc.validate_block(
                {
                    "name": "New Block",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": [dep["id"]],
                }
            )

            assert result["data"]["valid"] is False
            assert any("Circular" in e for e in result["data"]["errors"])

    def test_validate_block_checks_parameter_binding(self) -> None:
        """Test that validate_block checks parameter binding completeness."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_plugin = MagicMock()
            mock_param = MagicMock()
            mock_param.name = "host"
            mock_param.required = True
            mock_plugin.parameters = [mock_param]
            mock_load.return_value = mock_plugin

            result = _block_version_svc.validate_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                    "parameters": {},
                }
            )

            assert result["data"]["valid"] is False
            assert any("binding incomplete" in e.lower() for e in result["data"]["errors"])


class TestValidateDependencies:
    """Test suite for validate_dependencies service function."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_validate_dependencies_returns_valid(self) -> None:
        """Test that validate_dependencies returns valid for valid deps."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block = block_service.create_block(
                {
                    "name": "Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            dep = block_service.create_block(
                {
                    "name": "Dep",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_version_svc.validate_dependencies(block["id"], [dep["id"]])

        assert result["valid"] is True
        assert result["errors"] == []

    def test_validate_dependencies_returns_error_for_missing(self) -> None:
        """Test that validate_dependencies returns error for missing dep."""
        result = _block_version_svc.validate_dependencies(str(uuid.uuid4()), [str(uuid.uuid4())])

        assert result["valid"] is False
        assert any("not found" in e for e in result["errors"])

    def test_validate_dependencies_detects_circular(self) -> None:
        """Test that validate_dependencies detects circular dependency."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            block = block_service.create_block(
                {
                    "name": "Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            dep = block_service.create_block(
                {
                    "name": "Dep",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": [block["id"]],
                }
            )

        result = _block_version_svc.validate_dependencies(block["id"], [dep["id"]])

        assert result["valid"] is False
        assert any("Circular" in e for e in result["errors"])


class TestHistoryOperations:
    """Test suite for history operations."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_get_block_history_returns_history(self) -> None:
        """Test that get_block_history returns version history."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            _block_version_svc.add_block_version(created["id"], {"version_bump": "minor"})

        result = _block_version_svc.get_block_history(created["id"])

        assert result is not None
        assert len(result["versions"]) == 2
        # Should be sorted newest first
        assert result["versions"][0]["version"] == "1.1.0"

    def test_get_block_history_returns_none_for_missing(self) -> None:
        """Test that get_block_history returns None for missing block."""
        result = _block_version_svc.get_block_history(str(uuid.uuid4()))

        assert result is None

    def test_restore_block_version_success(self) -> None:
        """Test that restore_block_version restores to previous version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            _block_version_svc.add_block_version(created["id"], {"version_bump": "minor"})

        result = _block_version_svc.restore_block_version(created["id"], "1.0.0")

        assert result is not None
        assert result["version"] == "1.2.0"  # New version created
        assert result["metadata"]["restored_from"] == "1.0.0"

    def test_restore_block_version_returns_none_for_missing_block(self) -> None:
        """Test that restore_block_version returns None for missing block."""
        result = _block_version_svc.restore_block_version(str(uuid.uuid4()), "1.0.0")

        assert result is None

    def test_restore_block_version_raises_for_missing_version(self) -> None:
        """Test that restore_block_version raises for missing version."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        with pytest.raises(ValidationException, match="not found"):
            _block_version_svc.restore_block_version(created["id"], "99.0.0")


class TestGenerateEtag:
    """Test suite for _generate_etag helper function."""

    def test_generate_etag_returns_hash(self) -> None:
        """Test that _generate_etag returns SHA-256 hash."""
        block = {"id": "test-id", "version": "1.0.0", "updated_at": "2024-01-01"}

        result = _block_storage._generate_etag(block)

        assert len(result) == 64  # SHA-256 hex digest length


class TestHelperFunctions:
    """Test suite for helper functions."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_get_raw_block_returns_block(self) -> None:
        """Test that _get_raw_block returns existing block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Raw Block Test",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        result = _block_storage._get_raw_block(created["id"])

        assert result is not None
        assert result["name"] == "Raw Block Test"

    def test_load_versions_returns_empty_for_missing_file(self) -> None:
        """Test that _load_versions returns empty list when file doesn't exist."""
        # Create a block dir without versions file
        block_id = str(uuid.uuid4())
        block_dir = _block_storage._get_block_dir(block_id)
        block_dir.mkdir(parents=True, exist_ok=True)

        result = _block_storage._load_versions(block_id)

        assert result == []

    def test_validate_block_with_invalid_plugin_reference(self) -> None:
        """Test validate_block when plugin reference doesn't exist."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.side_effect = FileNotFoundError("Plugin not found")

            result = _block_version_svc.validate_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

            assert result["data"]["valid"] is False
            assert any("not found" in e for e in result["data"]["errors"])

    def test_validate_block_parameter_check_with_missing_plugin(self) -> None:
        """Test validate_block parameter binding check when plugin not found."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            # First call returns mock plugin for ref check, second fails for params check
            mock_plugin = MagicMock()
            mock_plugin.parameters = []
            call_count = [0]

            def load_side_effect(plugin_id: str) -> MagicMock:
                call_count[0] += 1
                if call_count[0] <= 1:
                    return mock_plugin
                raise FileNotFoundError("Plugin not found")

            mock_load.side_effect = load_side_effect

            result = _block_version_svc.validate_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                    "description": "Has description",
                }
            )

            # Should pass because first check passes and second is ignored
            assert result["success"] is True


class TestAdditionalCoverage:
    """Additional tests to achieve 100% coverage."""

    def setup_method(self) -> None:
        """Reset block storage before each test."""
        _block_storage._clear_storage()

    def test_batch_delete_blocks_with_value_error(self) -> None:
        """Test batch_delete_blocks handles ValueError from delete_block."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            target = block_service.create_block(
                {
                    "name": "Target Block",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            block_service.create_block(
                {
                    "name": "Dependent Block",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": [target["id"]],
                }
            )

        # batch_delete without cascade should fail with ValueError
        result = block_service.batch_delete_blocks([target["id"]])

        assert result["deleted"] == []
        assert len(result["failed"]) == 1
        assert "Cannot delete" in result["failed"][0]["error"]

    def test_add_block_version_with_parameters_update(self) -> None:
        """Test add_block_version updates parameters in data."""
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block",
                    "plugin_id": str(uuid.uuid4()),
                    "parameters": {"old_param": {"required": False}},
                }
            )

        result = _block_version_svc.add_block_version(
            created["id"],
            {
                "version_bump": "major",
                "parameters": {"new_param": {"required": True}},
            },
        )

        assert result is not None
        assert result["parameters"] == {"new_param": {"required": True}}

    def test_get_storage_creates_instance_lazily(self) -> None:
        """Test that _get_storage creates FileBasedStorage on first call."""
        # Reset storage instance
        _block_storage._storage = None

        # Call _get_storage - should create instance
        storage = _block_storage._get_storage()

        assert storage is not None
        assert _block_storage._storage is not None

    def test_get_storage_returns_cached_instance(self) -> None:
        """Test that _get_storage returns same instance on subsequent calls."""
        # Reset storage instance
        _block_storage._storage = None

        # First call creates instance
        storage1 = _block_storage._get_storage()
        # Second call returns same instance
        storage2 = _block_storage._get_storage()

        assert storage1 is storage2

    def test_validate_circular_deps_skips_unknown_dep_ids(self) -> None:
        """Dependencies referencing unknown block IDs are skipped."""
        from wavecore.api.services.blocks._storage import _validate_circular_deps

        # Pass a dependency ID that does not exist in stored blocks
        errors = _validate_circular_deps("my-block", ["nonexistent-id"])
        assert errors == []
