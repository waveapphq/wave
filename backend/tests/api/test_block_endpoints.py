"""Unit tests for block management endpoints (REQ-5.2.4.2).

This module tests the block management endpoints providing lifecycle operations
for reusable block entities enabling creation, modification, version control,
validation, dependency management, and import/export.

Test Coverage:
- CRUD operations: Create, Read, Update (via versions), Delete blocks
- Batch operations: Create/update/delete multiple blocks
- Version control: Version history tracking, semantic versioning, restore
- Dependency management: Dependencies, dependents, usage tracking
- Validation: Pre-creation validation with dependency checking, circular detection
- Validation warnings: Work-in-progress block completeness warnings
- Parameter binding: Validation of parameter binding completeness
- Clone operations: Block derivation through cloning with version validation
- Import operations: File-based block import with conflict resolution
- Error handling: Validation errors, conflicts, not found, internal errors
- Caching and performance: Multi-layer caching with TTL policies and invalidation
- Dependency checking: Cascade deletion with confirmation and dependency analysis
- Concurrency control: Optimistic concurrency via ETag/If-Match headers
"""

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.api.body_shape_support import (
    NOT_AN_ID_ITEM,
    NOT_AN_OBJECT_ITEM,
    NOT_AN_UPDATE_OBJECT,
    NOT_ARRAY_BODIES,
    NOT_ID_ITEMS,
    NOT_OBJECT_BODIES,
    NOT_OBJECT_ITEMS,
    assert_refused,
    send_text,
)


class TestListBlocksEndpoint:
    """Test suite for GET /blocks endpoint (list all blocks)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_blocks_returns_200_with_empty_list(self, client: TestClient) -> None:
        """Test that GET /blocks returns 200 with empty list when no blocks exist."""
        with patch("wavecore.api.routes.blocks.routes.block_service.list_blocks") as mock_list:
            mock_list.return_value = {
                "blocks": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/blocks")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []
            assert data["pagination"]["total"] == 0
            assert data["pagination"]["page"] == 1
            assert data["pagination"]["per_page"] == 20
            assert data["pagination"]["total_pages"] == 0

    def test_list_blocks_returns_200_with_blocks(self, client: TestClient) -> None:
        """Test that GET /blocks returns 200 with list of blocks."""
        block1_id = str(uuid.uuid4())
        block2_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.blocks.routes.block_service.list_blocks") as mock_list:
            mock_list.return_value = {
                "blocks": [
                    {
                        "id": block1_id,
                        "name": "SSH Login Block",
                        "version": "1.0.0",
                        "plugin_id": plugin_id,
                        "description": "Reusable SSH login workflow",
                        "parameters": {},
                        "dependencies": [],
                        "metadata": {},
                        "created_at": now,
                        "updated_at": now,
                    },
                    {
                        "id": block2_id,
                        "name": "HTTP Health Check",
                        "version": "1.2.0",
                        "plugin_id": plugin_id,
                        "description": "Check service health via HTTP",
                        "parameters": {},
                        "dependencies": [],
                        "metadata": {},
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 2,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/blocks")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 2
            assert data["data"][0]["id"] == block1_id
            assert data["data"][0]["name"] == "SSH Login Block"
            assert data["data"][1]["id"] == block2_id
            assert data["pagination"]["total"] == 2

    def test_list_blocks_supports_page_based_pagination(self, client: TestClient) -> None:
        """Test that GET /blocks supports page-based pagination (REQ-5.2.4.2)."""
        with patch("wavecore.api.routes.blocks.routes.block_service.list_blocks") as mock_list:
            mock_list.return_value = {
                "blocks": [],
                "total": 100,
                "page": 2,
                "per_page": 10,
                "total_pages": 10,
            }

            response = client.get("/blocks?page=2&per_page=10")

            assert response.status_code == 200
            data = response.json()
            assert data["pagination"]["page"] == 2
            assert data["pagination"]["per_page"] == 10
            assert data["pagination"]["total"] == 100
            assert data["pagination"]["total_pages"] == 10
            mock_list.assert_called_once_with(
                page=2,
                per_page=10,
                search=None,
                plugin_id=None,
                tags=None,
            )

    def test_list_blocks_supports_plugin_id_filter(self, client: TestClient) -> None:
        """Test that GET /blocks supports filtering by plugin_id."""
        plugin_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.list_blocks") as mock_list:
            mock_list.return_value = {
                "blocks": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get(f"/blocks?plugin_id={plugin_id}")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search=None,
                plugin_id=plugin_id,
                tags=None,
            )

    def test_list_blocks_supports_tags_filter(self, client: TestClient) -> None:
        """Test that GET /blocks supports filtering by tags (REQ-5.2.4.2)."""
        with patch("wavecore.api.routes.blocks.routes.block_service.list_blocks") as mock_list:
            mock_list.return_value = {
                "blocks": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/blocks?tags=network&tags=ssh")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search=None,
                plugin_id=None,
                tags=["network", "ssh"],
            )

    def test_list_blocks_supports_search(self, client: TestClient) -> None:
        """Test that GET /blocks supports text search across names and descriptions."""
        with patch("wavecore.api.routes.blocks.routes.block_service.list_blocks") as mock_list:
            mock_list.return_value = {
                "blocks": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/blocks?search=ssh")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search="ssh",
                plugin_id=None,
                tags=None,
            )

    def test_list_blocks_validates_plugin_id_format(self, client: TestClient) -> None:
        """Test that GET /blocks validates plugin_id parameter as valid UUID."""
        response = client.get("/blocks?plugin_id=invalid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for plugin_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_list_blocks_validates_page_minimum(self, client: TestClient) -> None:
        """Test that GET /blocks validates page parameter minimum value."""
        response = client.get("/blocks?page=0")

        # Per design: "malformed requests return bad request with validation details"
        assert response.status_code == 400

    def test_list_blocks_validates_per_page_maximum(self, client: TestClient) -> None:
        """Test that GET /blocks validates per_page parameter maximum value."""
        response = client.get("/blocks?per_page=101")

        # Per design: "malformed requests return bad request with validation details"
        assert response.status_code == 400


class TestCreateBlockEndpoint:
    """Test suite for POST /blocks endpoint (create new block)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_block_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /blocks returns 201 when creating block with valid data."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.blocks.routes.block_service.create_block") as mock_create:
            mock_create.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Reusable SSH login workflow",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/blocks",
                json={
                    "name": "SSH Login Block",
                    "plugin_id": plugin_id,
                    "description": "Reusable SSH login workflow",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == block_id
            assert data["data"]["name"] == "SSH Login Block"
            assert data["data"]["version"] == "1.0.0"

    def test_create_block_requires_name_field(self, client: TestClient) -> None:
        """Test that POST /blocks returns 400 when name field is missing."""
        plugin_id = str(uuid.uuid4())

        response = client.post(
            "/blocks",
            json={"plugin_id": plugin_id},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'name' is required$", data["error"]["message"])

    def test_create_block_requires_plugin_id_field(self, client: TestClient) -> None:
        """Test that POST /blocks returns 400 when plugin_id field is missing."""
        response = client.post(
            "/blocks",
            json={"name": "SSH Login Block"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'plugin_id' is required$", data["error"]["message"])

    def test_create_block_validates_plugin_id_format(self, client: TestClient) -> None:
        """Test that POST /blocks validates plugin_id as valid UUID."""
        response = client.post(
            "/blocks",
            json={
                "name": "SSH Login Block",
                "plugin_id": "invalid-uuid",
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for plugin_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_create_block_validates_naming_convention(self, client: TestClient) -> None:
        """Test that POST /blocks validates block name format (REQ-5.2.4.2)."""
        plugin_id = str(uuid.uuid4())

        response = client.post(
            "/blocks",
            json={
                "name": "Invalid@Name!",
                "plugin_id": plugin_id,
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Block name 'Invalid@Name!' violates naming convention: must contain only "
            r"alphanumeric characters, spaces, hyphens, and underscores$",
            data["error"]["message"],
        )

    def test_create_block_validates_name_length(self, client: TestClient) -> None:
        """Test that POST /blocks validates block name length."""
        plugin_id = str(uuid.uuid4())

        response = client.post(
            "/blocks",
            json={
                "name": "A" * 256,  # Too long
                "plugin_id": plugin_id,
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Block name must be between 1 and 255 characters$",
            data["error"]["message"],
        )

    def test_create_block_returns_409_when_name_exists(self, client: TestClient) -> None:
        """Test that POST /blocks returns 409 when block name already exists."""
        plugin_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.create_block") as mock_create:
            mock_create.side_effect = ValueError("Block with name 'SSH Login Block' already exists")

            response = client.post(
                "/blocks",
                json={
                    "name": "SSH Login Block",
                    "plugin_id": plugin_id,
                },
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Block with name 'SSH Login Block' already exists$",
                data["error"]["message"],
            )

    def test_create_block_validates_plugin_reference(self, client: TestClient) -> None:
        """Test that POST /blocks validates plugin reference exists (REQ-5.2.4.2)."""
        plugin_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.create_block") as mock_create:
            mock_create.side_effect = ValueError(f"Plugin with ID '{plugin_id}' not found")

            response = client.post(
                "/blocks",
                json={
                    "name": "SSH Login Block",
                    "plugin_id": plugin_id,
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"]

    def test_create_block_validates_circular_dependencies(self, client: TestClient) -> None:
        """Test that POST /blocks detects circular dependencies (REQ-5.2.4.2)."""
        plugin_id = str(uuid.uuid4())
        dep_block_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.create_block") as mock_create:
            mock_create.side_effect = ValueError(
                "Circular dependency detected: block-a -> block-b -> block-a"
            )

            response = client.post(
                "/blocks",
                json={
                    "name": "Block A",
                    "plugin_id": plugin_id,
                    "dependencies": [dep_block_id],
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Circular dependency detected: block-a -> block-b -> block-a$",
                data["error"]["message"],
            )

    def test_create_block_accepts_optional_parameters(self, client: TestClient) -> None:
        """Test that POST /blocks accepts optional fields like parameters and metadata."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.blocks.routes.block_service.create_block") as mock_create:
            mock_create.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Reusable SSH login workflow",
                "parameters": {
                    "host": {"type": "string", "required": True},
                    "port": {"type": "integer", "default": 22},
                },
                "dependencies": [],
                "metadata": {"author": "test-user", "tags": ["ssh", "network"]},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/blocks",
                json={
                    "name": "SSH Login Block",
                    "plugin_id": plugin_id,
                    "description": "Reusable SSH login workflow",
                    "parameters": {
                        "host": {"type": "string", "required": True},
                        "port": {"type": "integer", "default": 22},
                    },
                    "metadata": {"author": "test-user", "tags": ["ssh", "network"]},
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert "host" in data["data"]["parameters"]
            assert data["data"]["metadata"]["author"] == "test-user"


class TestGetBlockEndpoint:
    """Test suite for GET /blocks/{block_id} endpoint (get block by ID)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_block_returns_200_with_valid_id(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id} returns 200 with block details."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.blocks.routes.block_service.get_block") as mock_get:
            mock_get.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Reusable SSH login workflow",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/blocks/{block_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == block_id
            assert data["data"]["name"] == "SSH Login Block"

    def test_get_block_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id} returns 404 when block does not exist."""
        block_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.get_block") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/blocks/{block_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Block with ID '{block_id}' not found$", data["error"]["message"])

    def test_get_block_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id} validates block_id is valid UUID."""
        response = client.get("/blocks/invalid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for block_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestDeleteBlockEndpoint:
    """Test suite for DELETE /blocks/{block_id} endpoint (delete block)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_block_returns_204_when_successful(self, client: TestClient) -> None:
        """Test that DELETE /blocks/{block_id} returns 204 when deletion succeeds."""
        block_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.delete_block") as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/blocks/{block_id}")

            assert response.status_code == 204
            assert response.content == b""

    def test_delete_block_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /blocks/{block_id} returns 404 when block does not exist."""
        block_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.delete_block") as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/blocks/{block_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Block with ID '{block_id}' not found$", data["error"]["message"])

    def test_delete_block_returns_409_when_dependents_exist(self, client: TestClient) -> None:
        """Test that DELETE /blocks/{block_id} returns 409 when block has dependents
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.delete_block") as mock_delete:
            mock_delete.side_effect = ValueError(
                "Cannot delete block 'SSH Login Block': 3 blocks and 2 tests depend on it. "
                "Use cascade=true to delete all dependents."
            )

            response = client.delete(f"/blocks/{block_id}")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Cannot delete block 'SSH Login Block': 3 blocks and 2 tests depend on it\.",
                data["error"]["message"],
            )

    def test_delete_block_with_cascade_deletes_dependents(self, client: TestClient) -> None:
        """Test that DELETE /blocks/{block_id}?cascade=true performs cascade deletion
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.delete_block") as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/blocks/{block_id}?cascade=true")

            assert response.status_code == 204
            mock_delete.assert_called_once_with(block_id, cascade=True)


class TestBatchBlockOperationsEndpoint:
    """Test suite for /blocks/batch endpoint (batch operations)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_batch_create_blocks_returns_201(self, client: TestClient) -> None:
        """Test that POST /blocks/batch creates multiple blocks (REQ-5.2.4.2)."""
        block1_id = str(uuid.uuid4())
        block2_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.routes.block_service.batch_create_blocks"
        ) as mock_batch:
            mock_batch.return_value = {
                "created": [block1_id, block2_id],
                "failed": [],
            }

            response = client.post(
                "/blocks/batch",
                json=[
                    {"name": "Block 1", "plugin_id": plugin_id},
                    {"name": "Block 2", "plugin_id": plugin_id},
                ],
            )

            assert response.status_code == 201
            data = response.json()
            assert len(data["created"]) == 2
            assert data["created"][0] == block1_id
            assert data["failed"] == []

    def test_batch_create_blocks_returns_partial_success(self, client: TestClient) -> None:
        """Test that POST /blocks/batch returns partial success when some fail."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.routes.block_service.batch_create_blocks"
        ) as mock_batch:
            mock_batch.return_value = {
                "created": [block_id],
                "failed": [{"index": 1, "error": "Block with name 'Block 2' already exists"}],
            }

            response = client.post(
                "/blocks/batch",
                json=[
                    {"name": "Block 1", "plugin_id": plugin_id},
                    {"name": "Block 2", "plugin_id": plugin_id},
                ],
            )

            assert response.status_code == 201
            data = response.json()
            assert len(data["created"]) == 1
            assert len(data["failed"]) == 1
            assert data["failed"][0]["index"] == 1

    def test_batch_update_blocks_returns_200(self, client: TestClient) -> None:
        """Test that PATCH /blocks/batch updates multiple blocks (REQ-5.2.4.2)."""
        block1_id = str(uuid.uuid4())
        block2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.routes.block_service.batch_update_blocks"
        ) as mock_batch:
            mock_batch.return_value = {
                "updated": [block1_id, block2_id],
                "failed": [],
            }

            response = client.patch(
                "/blocks/batch",
                json=[
                    {"id": block1_id, "update": {"description": "Updated 1"}},
                    {"id": block2_id, "update": {"description": "Updated 2"}},
                ],
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["updated"]) == 2
            assert data["failed"] == []

    def test_batch_delete_blocks_returns_200(self, client: TestClient) -> None:
        """Test that DELETE /blocks/batch deletes multiple blocks (REQ-5.2.4.2)."""
        block1_id = str(uuid.uuid4())
        block2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.routes.block_service.batch_delete_blocks"
        ) as mock_batch:
            mock_batch.return_value = {
                "deleted": [block1_id, block2_id],
                "failed": [],
            }

            response = client.request(
                "DELETE",
                "/blocks/batch",
                json=[block1_id, block2_id],
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["deleted"]) == 2
            assert data["failed"] == []

    def test_batch_delete_an_id_walking_back_into_the_folder_is_not_found(
        self, client: TestClient
    ) -> None:
        """Test an ID that reaches a stored block through its folder deletes nothing."""
        from wavecore.api.services.blocks import _storage as block_storage

        block_id = str(uuid.uuid4())
        block_storage._save_block({"id": block_id, "name": "kept_block", "dependencies": []})
        crafted = f"../api_blocks/{block_id}"

        response = client.request("DELETE", "/blocks/batch", json=[crafted])

        assert response.status_code == 200
        assert response.json() == {
            "deleted": [],
            "failed": [{"index": 0, "error": f"Block with ID '{crafted}' not found"}],
        }
        assert block_storage._load_block(block_id) is not None


class TestListBlockVersionsEndpoint:
    """Test suite for GET /blocks/{block_id}/versions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_versions_returns_200_with_version_history(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/versions returns version history (REQ-5.2.4.2)."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.list_block_versions"
        ) as mock_versions:
            mock_versions.return_value = ["1.2.0", "1.1.0", "1.0.0"]

            response = client.get(f"/blocks/{block_id}/versions")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 3
            assert data["data"][0] == "1.2.0"

    def test_list_versions_returns_404_when_block_not_found(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/versions returns 404 for non-existent block."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.list_block_versions"
        ) as mock_versions:
            mock_versions.return_value = None

            response = client.get(f"/blocks/{block_id}/versions")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_list_versions_validates_block_id_uuid_format(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/versions validates block_id is valid UUID."""
        response = client.get("/blocks/invalid-uuid/versions")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for block_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestAddBlockVersionEndpoint:
    """Test suite for POST /blocks/{block_id}/versions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_add_version_returns_201_with_new_version(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/versions creates new version (REQ-5.2.4.2)."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.add_block_version"
        ) as mock_add:
            mock_add.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.1.0",
                "plugin_id": plugin_id,
                "description": "Updated SSH login workflow",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/blocks/{block_id}/versions",
                json={"description": "Updated SSH login workflow"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "1.1.0"

    def test_add_version_validates_backward_compatibility(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/versions validates backward compatibility
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.add_block_version"
        ) as mock_add:
            mock_add.side_effect = ValueError(
                "Backward compatibility violation in minor version: required parameter 'host' was "
                "removed"
            )

            response = client.post(
                f"/blocks/{block_id}/versions",
                json={
                    "description": "Updated",
                    "parameters": {},
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Backward compatibility violation in minor version: required parameter 'host' "
                r"was removed$",
                data["error"]["message"],
            )

    def test_add_major_version_allows_breaking_changes(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/versions allows breaking changes in major versions
        (REQ-5.2.4.2).

        Per design: 'Version creation validates backward compatibility for minor and patch updates.'
        This implies major version updates ARE allowed to break compatibility.
        """
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.add_block_version"
        ) as mock_add:
            mock_add.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "2.0.0",
                "plugin_id": plugin_id,
                "description": "Major version with breaking changes",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/blocks/{block_id}/versions",
                json={
                    "description": "Major version with breaking changes",
                    "parameters": {},
                    "version_bump": "major",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "2.0.0"

    def test_add_version_returns_404_when_block_not_found(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/versions returns 404 for non-existent block."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.add_block_version"
        ) as mock_add:
            mock_add.return_value = None

            response = client.post(
                f"/blocks/{block_id}/versions",
                json={"description": "Updated"},
            )

            assert response.status_code == 404


class TestGetBlockVersionEndpoint:
    """Test suite for GET /blocks/{block_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_version_returns_200_with_specific_version(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/versions/{version} returns specific version."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.get_block_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Reusable SSH login workflow",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/blocks/{block_id}/versions/1.0.0")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "1.0.0"

    def test_get_version_returns_404_when_version_not_found(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/versions/{version} returns 404 for non-existent
        version.
        """
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.get_block_version"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/blocks/{block_id}/versions/99.0.0")

            assert response.status_code == 404


class TestUpdateBlockVersionEndpoint:
    """Test suite for PUT /blocks/{block_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_version_returns_200_when_successful(self, client: TestClient) -> None:
        """Test that PUT /blocks/{block_id}/versions/{version} updates version metadata."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.update_block_version"
        ) as mock_update:
            mock_update.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Updated description",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/blocks/{block_id}/versions/1.0.0",
                json={"description": "Updated description"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["description"] == "Updated description"

    def test_update_published_version_returns_400(self, client: TestClient) -> None:
        """Test that PUT /blocks/{block_id}/versions/{version} returns 400 for published versions
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.update_block_version"
        ) as mock_update:
            mock_update.side_effect = ValueError(
                "Cannot modify published version '1.0.0'. Published versions are immutable."
            )

            response = client.put(
                f"/blocks/{block_id}/versions/1.0.0",
                json={"description": "Updated"},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "immutable" in data["error"]["message"]


class TestDeleteBlockVersionEndpoint:
    """Test suite for DELETE /blocks/{block_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_version_returns_204_when_successful(self, client: TestClient) -> None:
        """Test that DELETE /blocks/{block_id}/versions/{version} returns 204."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.delete_block_version"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/blocks/{block_id}/versions/1.0.0")

            assert response.status_code == 204

    def test_delete_version_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /blocks/{block_id}/versions/{version} returns 404."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.delete_block_version"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/blocks/{block_id}/versions/1.0.0")

            assert response.status_code == 404

    def test_delete_version_returns_409_when_dependencies_exist(self, client: TestClient) -> None:
        """Test that DELETE /blocks/{block_id}/versions/{version} returns 409 with dependencies
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.delete_block_version"
        ) as mock_delete:
            mock_delete.side_effect = ValueError(
                "Cannot delete version '1.0.0': 5 blocks reference this version"
            )

            response = client.delete(f"/blocks/{block_id}/versions/1.0.0")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Cannot delete version '1\.0\.0': 5 blocks reference this version$",
                data["error"]["message"],
            )


class TestGetBlockDependenciesEndpoint:
    """Test suite for GET /blocks/{block_id}/dependencies endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_dependencies_returns_200_with_dependency_tree(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/dependencies returns dependency tree (REQ-5.2.4.2)."""
        block_id = str(uuid.uuid4())
        dep1_id = str(uuid.uuid4())
        dep2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_storage.get_block_dependencies"
        ) as mock_deps:
            mock_deps.return_value = {
                "root": block_id,
                "dependencies": [
                    {"id": dep1_id, "type": "block", "version": "1.0.0"},
                    {"id": dep2_id, "type": "plugin", "version": "2.1.0"},
                ],
            }

            response = client.get(f"/blocks/{block_id}/dependencies")

            assert response.status_code == 200
            data = response.json()
            assert data["root"] == block_id
            assert len(data["dependencies"]) == 2

    def test_get_dependencies_returns_404_when_block_not_found(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/dependencies returns 404 for non-existent block."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_storage.get_block_dependencies"
        ) as mock_deps:
            mock_deps.return_value = None

            response = client.get(f"/blocks/{block_id}/dependencies")

            assert response.status_code == 404


class TestGetBlockDependentsEndpoint:
    """Test suite for GET /blocks/{block_id}/dependents endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_dependents_returns_200_with_dependent_list(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/dependents returns what depends on this block
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())
        dep_block_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_storage.get_block_dependents"
        ) as mock_deps:
            mock_deps.return_value = {
                "blocks": [dep_block_id],
                "tests": [test_id],
            }

            response = client.get(f"/blocks/{block_id}/dependents")

            assert response.status_code == 200
            data = response.json()
            assert len(data["blocks"]) == 1
            assert len(data["tests"]) == 1

    def test_get_dependents_returns_404_when_block_not_found(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/dependents returns 404 for non-existent block."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_storage.get_block_dependents"
        ) as mock_deps:
            mock_deps.return_value = None

            response = client.get(f"/blocks/{block_id}/dependents")

            assert response.status_code == 404


class TestGetBlockUsageEndpoint:
    """Test suite for GET /blocks/{block_id}/usage endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_usage_returns_200_with_usage_info(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/usage returns usage information (REQ-5.2.4.2)."""
        block_id = str(uuid.uuid4())
        test1_id = str(uuid.uuid4())
        test2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_storage.get_block_usage"
        ) as mock_usage:
            mock_usage.return_value = {
                "tests": [
                    {"id": test1_id, "name": "Login Test"},
                    {"id": test2_id, "name": "Auth Flow Test"},
                ],
                "workflows": [],
            }

            response = client.get(f"/blocks/{block_id}/usage")

            assert response.status_code == 200
            data = response.json()
            assert len(data["tests"]) == 2
            assert data["tests"][0]["id"] == test1_id

    def test_get_usage_returns_404_when_block_not_found(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/usage returns 404 for non-existent block."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_storage.get_block_usage"
        ) as mock_usage:
            mock_usage.return_value = None

            response = client.get(f"/blocks/{block_id}/usage")

            assert response.status_code == 404


class TestCloneBlockEndpoint:
    """Test suite for POST /blocks/{block_id}/clone endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_clone_block_returns_201_with_cloned_block(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/clone creates a copy of the block (REQ-5.2.4.2)."""
        original_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.clone_block"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": clone_id,
                "name": "SSH Login Block (Copy)",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Cloned block",
                "parameters": {},
                "dependencies": [],
                "metadata": {"cloned_from": original_id},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/blocks/{original_id}/clone",
                json={"new_name": "SSH Login Block (Copy)"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == clone_id
            assert data["data"]["name"] == "SSH Login Block (Copy)"

    def test_clone_block_requires_new_name(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/clone requires new_name field."""
        block_id = str(uuid.uuid4())

        response = client.post(
            f"/blocks/{block_id}/clone",
            json={},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'new_name' is required$", data["error"]["message"])

    def test_clone_block_returns_404_when_source_not_found(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/clone returns 404 for non-existent source."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.clone_block"
        ) as mock_clone:
            mock_clone.return_value = None

            response = client.post(
                f"/blocks/{block_id}/clone",
                json={"new_name": "Cloned Block"},
            )

            assert response.status_code == 404

    def test_clone_block_supports_custom_version(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/clone supports custom version."""
        original_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.clone_block"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": clone_id,
                "name": "SSH Login Block (Copy)",
                "version": "2.0.0",
                "plugin_id": plugin_id,
                "description": "Cloned block",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/blocks/{original_id}/clone",
                json={"new_name": "SSH Login Block (Copy)", "new_version": "2.0.0"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["version"] == "2.0.0"

    def test_clone_block_validates_semantic_version_format(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/clone validates new_version as semantic version.

        Per OpenAPI schema: version pattern is '^\\d+\\.\\d+\\.\\d+$'
        """
        block_id = str(uuid.uuid4())

        response = client.post(
            f"/blocks/{block_id}/clone",
            json={"new_name": "Cloned Block", "new_version": "1.0"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid version format '1\.0': must follow semantic versioning "
            r"\(MAJOR\.MINOR\.PATCH\)$",
            data["error"]["message"],
        )

    def test_clone_block_rejects_version_with_prefix(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/clone rejects version with 'v' prefix."""
        block_id = str(uuid.uuid4())

        response = client.post(
            f"/blocks/{block_id}/clone",
            json={"new_name": "Cloned Block", "new_version": "v1.0.0"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid version format 'v1\.0\.0': must follow semantic versioning "
            r"\(MAJOR\.MINOR\.PATCH\)$",
            data["error"]["message"],
        )

    def test_clone_block_rejects_version_with_four_parts(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/clone rejects version with four parts."""
        block_id = str(uuid.uuid4())

        response = client.post(
            f"/blocks/{block_id}/clone",
            json={"new_name": "Cloned Block", "new_version": "1.0.0.0"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid version format '1\.0\.0\.0': must follow semantic versioning "
            r"\(MAJOR\.MINOR\.PATCH\)$",
            data["error"]["message"],
        )


class TestImportBlockEndpoint:
    """Test suite for POST /blocks/import endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_import_block_returns_201_with_imported_block(self, client: TestClient) -> None:
        """Test that POST /blocks/import imports block from file (REQ-5.2.4.2)."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.import_block"
        ) as mock_import:
            mock_import.return_value = {
                "id": block_id,
                "name": "Imported Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Imported from file",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            # Simulate file upload
            yaml_content = b"name: Imported Block\nplugin_id: test\n"
            response = client.post(
                "/blocks/import",
                files={"file": ("block.yaml", yaml_content, "application/yaml")},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Imported Block"

    def test_import_block_returns_400_with_invalid_yaml(self, client: TestClient) -> None:
        """Test that POST /blocks/import returns 400 with invalid YAML."""
        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.import_block"
        ) as mock_import:
            mock_import.side_effect = ValueError("Invalid YAML format: expected mapping")

            yaml_content = b"invalid: yaml: content:"
            response = client.post(
                "/blocks/import",
                files={"file": ("block.yaml", yaml_content, "application/yaml")},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Invalid YAML" in data["error"]["message"]

    def test_import_block_returns_409_on_conflict(self, client: TestClient) -> None:
        """Test that POST /blocks/import returns 409 when block already exists (REQ-5.2.4.2)."""
        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.import_block"
        ) as mock_import:
            mock_import.side_effect = ValueError(
                "Block 'Imported Block' already exists. Set overwrite=true to replace."
            )

            yaml_content = b"name: Imported Block\nplugin_id: test\n"
            response = client.post(
                "/blocks/import",
                files={"file": ("block.yaml", yaml_content, "application/yaml")},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "already exists" in data["error"]["message"]

    def test_import_block_with_overwrite_replaces_existing(self, client: TestClient) -> None:
        """Test that POST /blocks/import with overwrite=true replaces existing block."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.import_block"
        ) as mock_import:
            mock_import.return_value = {
                "id": block_id,
                "name": "Imported Block",
                "version": "2.0.0",
                "plugin_id": plugin_id,
                "description": "Updated import",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            yaml_content = b"name: Imported Block\nplugin_id: test\nversion: 2.0.0\n"
            response = client.post(
                "/blocks/import",
                files={"file": ("block.yaml", yaml_content, "application/yaml")},
                data={"overwrite": "true"},
            )

            assert response.status_code == 201


class TestValidateBlockEndpoint:
    """Test suite for POST /blocks/validate endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_block_returns_200_when_valid(self, client: TestClient) -> None:
        """Test that POST /blocks/validate returns 200 with valid block definition (REQ-5.2.4.2)."""
        plugin_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_block"
        ) as mock_validate:
            mock_validate.return_value = {
                "success": True,
                "data": {"valid": True, "errors": []},
            }

            response = client.post(
                "/blocks/validate",
                json={
                    "name": "SSH Login Block",
                    "plugin_id": plugin_id,
                    "description": "Test block",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["valid"] is True
            assert data["data"]["errors"] == []

    def test_validate_block_returns_200_with_validation_errors(self, client: TestClient) -> None:
        """Test that POST /blocks/validate returns 200 with detailed validation errors."""
        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_block"
        ) as mock_validate:
            mock_validate.return_value = {
                "success": True,
                "data": {
                    "valid": False,
                    "errors": [
                        "Field 'name' is required",
                        "Field 'plugin_id' must be a valid UUID",
                    ],
                },
            }

            response = client.post(
                "/blocks/validate",
                json={"description": "Test"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["valid"] is False
            assert len(data["data"]["errors"]) == 2

    def test_validate_block_plugin_id_reaching_another_folder_is_not_found(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Test a plugin_id that walks into another category reads no plugin there."""
        from tests.conftest import create_test_plugin
        from wavecore.api.services.blocks import _storage as block_storage
        from wavecore.storage import FileBasedStorage

        plugin = create_test_plugin(id="stored-plugin", category="network")
        plugin_file = tmp_path / "plugins" / "network" / "stored-plugin" / "1.0.0.yaml"
        plugin_file.parent.mkdir(parents=True)
        plugin_file.write_text(yaml.safe_dump(plugin.model_dump(mode="json")), encoding="utf-8")
        monkeypatch.setattr(block_storage, "_storage", FileBasedStorage(tmp_path))
        plugin_id = "../network/stored-plugin"

        response = client.post(
            "/blocks/validate",
            json={"name": "Probe", "plugin_id": plugin_id, "description": "Probe"},
        )

        assert response.status_code == 200
        assert response.json()["data"]["errors"] == [f"Plugin reference '{plugin_id}' not found"]

    def test_validate_block_detects_circular_dependencies(self, client: TestClient) -> None:
        """Test that POST /blocks/validate detects circular dependencies (REQ-5.2.4.2)."""
        plugin_id = str(uuid.uuid4())
        dep_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_block"
        ) as mock_validate:
            mock_validate.return_value = {
                "success": True,
                "data": {
                    "valid": False,
                    "errors": ["Circular dependency detected: block-a -> block-b -> block-a"],
                },
            }

            response = client.post(
                "/blocks/validate",
                json={
                    "name": "Block A",
                    "plugin_id": plugin_id,
                    "dependencies": [dep_id],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is False
            assert "Circular dependency" in data["data"]["errors"][0]

    def test_validate_block_validates_execution_flow(self, client: TestClient) -> None:
        """Test that POST /blocks/validate checks execution flow consistency (REQ-5.2.4.2)."""
        plugin_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_block"
        ) as mock_validate:
            mock_validate.return_value = {
                "success": True,
                "data": {
                    "valid": False,
                    "errors": [
                        "Execution flow error: unreachable node detected after conditional branch"
                    ],
                },
            }

            response = client.post(
                "/blocks/validate",
                json={
                    "name": "Flow Block",
                    "plugin_id": plugin_id,
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is False
            assert "Execution flow error" in data["data"]["errors"][0]

    def test_validate_block_returns_warnings_for_incomplete_blocks(
        self, client: TestClient
    ) -> None:
        """Test that POST /blocks/validate returns warnings for work-in-progress blocks
        (REQ-5.2.4.2).

        Per design: 'Block completeness warnings indicate potential issues without
        blocking save operations for work-in-progress definitions.'
        """
        plugin_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_block"
        ) as mock_validate:
            mock_validate.return_value = {
                "success": True,
                "data": {
                    "valid": True,
                    "errors": [],
                    "warnings": [
                        "Block has no description",
                        "Parameter 'timeout' has no default value",
                    ],
                },
            }

            response = client.post(
                "/blocks/validate",
                json={
                    "name": "Incomplete Block",
                    "plugin_id": plugin_id,
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["valid"] is True
            assert data["data"]["errors"] == []
            assert len(data["data"]["warnings"]) == 2
            assert "no description" in data["data"]["warnings"][0]

    def test_validate_block_returns_both_errors_and_warnings(self, client: TestClient) -> None:
        """Test that POST /blocks/validate can return both errors and warnings (REQ-5.2.4.2).

        Per design: 'Validation returns detailed field-level errors and warnings.'
        """
        plugin_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_block"
        ) as mock_validate:
            mock_validate.return_value = {
                "success": True,
                "data": {
                    "valid": False,
                    "errors": [
                        "Plugin reference 'unknown-plugin' not found",
                    ],
                    "warnings": [
                        "Block has no description",
                    ],
                },
            }

            response = client.post(
                "/blocks/validate",
                json={
                    "name": "Problematic Block",
                    "plugin_id": plugin_id,
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is False
            assert len(data["data"]["errors"]) == 1
            assert len(data["data"]["warnings"]) == 1

    def test_validate_block_validates_parameter_binding_completeness(
        self, client: TestClient
    ) -> None:
        """Test that POST /blocks/validate checks parameter binding completeness (REQ-5.2.4.2).

        Per design: 'Pre-creation validation verifies structural integrity including...
        parameter binding completeness.'
        """
        plugin_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_block"
        ) as mock_validate:
            mock_validate.return_value = {
                "success": True,
                "data": {
                    "valid": False,
                    "errors": [
                        "Parameter binding incomplete: required parameter 'host' from plugin "
                        "'ssh-executor' is not bound",
                        "Parameter binding incomplete: required parameter 'username' from plugin "
                        "'ssh-executor' is not bound",
                    ],
                },
            }

            response = client.post(
                "/blocks/validate",
                json={
                    "name": "Incomplete Binding Block",
                    "plugin_id": plugin_id,
                    "parameters": {
                        "port": {"type": "integer", "default": 22},
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is False
            assert len(data["data"]["errors"]) == 2
            assert "parameter binding incomplete" in data["data"]["errors"][0].lower()


class TestValidateBlockDependenciesEndpoint:
    """Test suite for POST /blocks/validate-dependencies endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_dependencies_returns_200_when_valid(self, client: TestClient) -> None:
        """Test that POST /blocks/validate-dependencies returns 200 when dependencies are valid
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())
        dep1_id = str(uuid.uuid4())
        dep2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_dependencies"
        ) as mock_validate:
            mock_validate.return_value = {"valid": True, "errors": []}

            response = client.post(
                "/blocks/validate-dependencies",
                json={
                    "block_id": block_id,
                    "dependencies": [dep1_id, dep2_id],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["valid"] is True
            assert data["errors"] == []

    def test_validate_dependencies_returns_200_with_errors(self, client: TestClient) -> None:
        """Test that POST /blocks/validate-dependencies returns 200 with errors for invalid
        dependencies.
        """
        block_id = str(uuid.uuid4())
        dep_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.import_export_routes._block_version_svc.validate_dependencies"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": [
                    f"Dependency '{dep_id}' not found",
                    "Circular dependency would be created",
                ],
            }

            response = client.post(
                "/blocks/validate-dependencies",
                json={
                    "block_id": block_id,
                    "dependencies": [dep_id],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["valid"] is False
            assert len(data["errors"]) == 2

    def test_validate_dependencies_requires_block_id(self, client: TestClient) -> None:
        """Test that POST /blocks/validate-dependencies requires block_id field."""
        dep_id = str(uuid.uuid4())

        response = client.post(
            "/blocks/validate-dependencies",
            json={"dependencies": [dep_id]},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'block_id' is required$", data["error"]["message"])

    def test_validate_dependencies_requires_dependencies_array(self, client: TestClient) -> None:
        """Test that POST /blocks/validate-dependencies requires dependencies field."""
        block_id = str(uuid.uuid4())

        response = client.post(
            "/blocks/validate-dependencies",
            json={"block_id": block_id},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'dependencies' is required$", data["error"]["message"])


class TestGetBlockHistoryEndpoint:
    """Test suite for GET /blocks/{block_id}/history endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_history_returns_200_with_version_history(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/history returns complete version history
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.get_block_history"
        ) as mock_history:
            mock_history.return_value = {
                "versions": [
                    {
                        "version": "1.2.0",
                        "created_at": now,
                        "created_by": "user-1",
                        "changes": "Added new parameter",
                    },
                    {
                        "version": "1.1.0",
                        "created_at": now,
                        "created_by": "user-1",
                        "changes": "Updated description",
                    },
                    {
                        "version": "1.0.0",
                        "created_at": now,
                        "created_by": "user-1",
                        "changes": "Initial version",
                    },
                ]
            }

            response = client.get(f"/blocks/{block_id}/history")

            assert response.status_code == 200
            data = response.json()
            assert len(data["versions"]) == 3
            assert data["versions"][0]["version"] == "1.2.0"
            assert "created_by" in data["versions"][0]
            assert "changes" in data["versions"][0]

    def test_get_history_returns_404_when_block_not_found(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id}/history returns 404 for non-existent block."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.get_block_history"
        ) as mock_history:
            mock_history.return_value = None

            response = client.get(f"/blocks/{block_id}/history")

            assert response.status_code == 404


class TestRestoreBlockVersionEndpoint:
    """Test suite for POST /blocks/{block_id}/restore/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_restore_version_returns_200_when_successful(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/restore/{version} restores to previous version
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.restore_block_version"
        ) as mock_restore:
            mock_restore.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.3.0",  # New version created from restore
                "plugin_id": plugin_id,
                "description": "Restored from v1.0.0",
                "parameters": {},
                "dependencies": [],
                "metadata": {"restored_from": "1.0.0"},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(f"/blocks/{block_id}/restore/1.0.0")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["metadata"]["restored_from"] == "1.0.0"

    def test_restore_version_returns_404_when_block_not_found(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/restore/{version} returns 404 for non-existent
        block.
        """
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.restore_block_version"
        ) as mock_restore:
            mock_restore.return_value = None

            response = client.post(f"/blocks/{block_id}/restore/1.0.0")

            assert response.status_code == 404

    def test_restore_version_returns_404_when_version_not_found(self, client: TestClient) -> None:
        """Test that POST /blocks/{block_id}/restore/{version} returns 404 for non-existent
        version.
        """
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.restore_block_version"
        ) as mock_restore:
            mock_restore.side_effect = ValueError(
                f"Version '99.0.0' not found for block '{block_id}'"
            )

            response = client.post(f"/blocks/{block_id}/restore/99.0.0")

            assert response.status_code == 404


class TestBlockEndpointCaching:
    """Test suite for block endpoint caching behavior."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_blocks_response_includes_cache_headers(self, client: TestClient) -> None:
        """Test that GET /blocks includes appropriate cache headers (REQ-5.2.4.2)."""
        with patch("wavecore.api.routes.blocks.routes.block_service.list_blocks") as mock_list:
            mock_list.return_value = {
                "blocks": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/blocks")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert "max-age=60" in response.headers["Cache-Control"]

    def test_get_block_historical_version_has_long_ttl(self, client: TestClient) -> None:
        """Test that GET /blocks/{id}/versions/{version} for historical versions has long TTL
        (REQ-5.2.4.2).
        """
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.get_block_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Old version",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
                "is_latest": False,
            }

            response = client.get(f"/blocks/{block_id}/versions/1.0.0")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert "max-age=3600" in response.headers["Cache-Control"]

    def test_cache_invalidates_after_block_creation(self, client: TestClient) -> None:
        """Test that cache invalidates after POST /blocks creates a block (REQ-5.2.4.2)."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.blocks.routes.block_service.create_block") as mock_create:
            mock_create.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "New block",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/blocks",
                json={
                    "name": "SSH Login Block",
                    "plugin_id": plugin_id,
                },
            )

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers
            assert response.headers["X-Cache-Invalidated"] == "blocks_list"


class TestBlockEndpointErrorHandling:
    """Test suite for block endpoint error handling."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_internal_error_returns_500_with_correlation_id(self, client: TestClient) -> None:
        """Test that internal errors return 500 with correlation ID (REQ-5.2.4.2)."""
        plugin_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.create_block") as mock_create:
            mock_create.side_effect = Exception("Database connection failed")

            response = client.post(
                "/blocks",
                json={
                    "name": "SSH Login Block",
                    "plugin_id": plugin_id,
                },
            )

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert "correlation_id" in data["error"]
            assert re.match(
                r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
                data["error"]["correlation_id"],
            )

    def test_version_constraint_violation_returns_409(self, client: TestClient) -> None:
        """Test that version constraint violations return 409 (REQ-5.2.4.2)."""
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.add_block_version"
        ) as mock_add:
            mock_add.side_effect = ValueError(
                "Version constraint violation: dependency 'block-a' requires version >=2.0.0 but "
                "only 1.x available"
            )

            response = client.post(
                f"/blocks/{block_id}/versions",
                json={"description": "New version"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "Version constraint violation" in data["error"]["message"]


class TestBlockEndpointConcurrencyControl:
    """Test suite for optimistic concurrency control (REQ-5.2.4.2).

    Per design: 'Optimistic concurrency control prevents conflicting modifications.'
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_block_returns_etag_header(self, client: TestClient) -> None:
        """Test that GET /blocks/{block_id} returns ETag header for concurrency control."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.blocks.routes.block_service.get_block") as mock_get:
            mock_get.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Reusable SSH login workflow",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/blocks/{block_id}")

            assert response.status_code == 200
            assert "ETag" in response.headers
            assert re.match(r'^"[a-f0-9]+"$', response.headers["ETag"])

    def test_update_version_with_matching_etag_succeeds(self, client: TestClient) -> None:
        """Test that PUT /blocks/{block_id}/versions/{version} succeeds with matching If-Match."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.update_block_version"
        ) as mock_update:
            mock_update.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Updated description",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/blocks/{block_id}/versions/1.0.0",
                json={"description": "Updated description"},
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code == 200
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args
            assert call_kwargs is not None

    def test_update_version_with_mismatched_etag_returns_412(self, client: TestClient) -> None:
        """Test that PUT /blocks/{block_id}/versions/{version} returns 412 with mismatched
        If-Match.
        """
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.update_block_version"
        ) as mock_update:
            mock_update.side_effect = ValueError(
                "Precondition failed: resource has been modified. "
                "Expected ETag 'abc123', current ETag 'def456'"
            )

            response = client.put(
                f"/blocks/{block_id}/versions/1.0.0",
                json={"description": "Updated description"},
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code == 412
            data = response.json()
            assert data["success"] is False
            assert "Precondition failed" in data["error"]["message"]

    def test_delete_block_with_mismatched_etag_returns_412(self, client: TestClient) -> None:
        """Test that DELETE /blocks/{block_id} returns 412 with mismatched If-Match."""
        block_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.blocks.routes.block_service.delete_block") as mock_delete:
            mock_delete.side_effect = ValueError("Precondition failed: resource has been modified")

            response = client.delete(
                f"/blocks/{block_id}",
                headers={"If-Match": '"stale-etag"'},
            )

            assert response.status_code == 412
            data = response.json()
            assert data["success"] is False
            assert "Precondition failed" in data["error"]["message"]

    def test_update_without_if_match_header_succeeds(self, client: TestClient) -> None:
        """Test that update without If-Match header proceeds (non-strict mode)."""
        block_id = str(uuid.uuid4())
        plugin_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.blocks.version_routes._block_version_svc.update_block_version"
        ) as mock_update:
            mock_update.return_value = {
                "id": block_id,
                "name": "SSH Login Block",
                "version": "1.0.0",
                "plugin_id": plugin_id,
                "description": "Updated without ETag",
                "parameters": {},
                "dependencies": [],
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/blocks/{block_id}/versions/1.0.0",
                json={"description": "Updated without ETag"},
            )

            assert response.status_code == 200


class TestBlockEndpointPerformance:
    """Test suite for block endpoint performance requirements."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_blocks_response_time_target(self, client: TestClient) -> None:
        """Test that GET /blocks meets <200ms response time target (REQ-5.2.4.2).

        Note: Test allows higher threshold for test framework overhead.
        Production target is <200ms as per requirements.
        """
        import time

        with patch("wavecore.api.routes.blocks.routes.block_service.list_blocks") as mock_list:
            mock_list.return_value = {
                "blocks": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            start = time.perf_counter()
            response = client.get("/blocks")
            duration = (time.perf_counter() - start) * 1000  # Convert to ms

            assert response.status_code == 200
            # Allow 500ms for test framework overhead, production target is 200ms
            assert duration < 500, f"Response time {duration}ms exceeds 500ms test threshold"


class TestBlockEndpointIntegration:
    """Integration tests that exercise routes with real service for full coverage."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture(autouse=True)
    def cleanup_blocks(self) -> None:
        """Clean up blocks before/after each test."""
        from wavecore.api.services.blocks import _storage as _block_storage

        _block_storage._clear_storage()
        yield
        _block_storage._clear_storage()

    def test_delete_block_with_if_match_header_hits_etag_validation(
        self, client: TestClient
    ) -> None:
        """Test DELETE /blocks/{block_id} with If-Match header validates ETag."""
        from unittest.mock import MagicMock, patch

        from wavecore.api.services.blocks import _storage as _block_storage
        from wavecore.api.services.blocks import service as block_service

        # Create a block using the API
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block ETag",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        # Try to delete with wrong ETag - should return 412
        response = client.delete(
            f"/blocks/{created['id']}",
            headers={"If-Match": '"wrong-etag"'},
        )

        assert response.status_code == 412
        data = response.json()
        assert "Precondition failed" in data["error"]["message"]

    def test_delete_block_with_dependents_returns_409(self, client: TestClient) -> None:
        """Test DELETE /blocks/{block_id} returns 409 when block has dependents."""
        from unittest.mock import MagicMock, patch

        from wavecore.api.services.blocks import _storage as _block_storage
        from wavecore.api.services.blocks import service as block_service

        # Create a block with a dependent using the API
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            target = block_service.create_block(
                {
                    "name": "Target Block Deps",
                    "plugin_id": str(uuid.uuid4()),
                }
            )
            block_service.create_block(
                {
                    "name": "Dependent Block Deps",
                    "plugin_id": str(uuid.uuid4()),
                    "dependencies": [target["id"]],
                }
            )

        # Try to delete without cascade - should return 409
        response = client.delete(f"/blocks/{target['id']}")

        assert response.status_code == 409
        data = response.json()
        assert "Cannot delete" in data["error"]["message"]

    def test_delete_block_generic_error_returns_400(self, client: TestClient) -> None:
        """Test DELETE /blocks/{block_id} returns 400 for generic validation errors."""
        # Invalid UUID format should return 400
        response = client.delete("/blocks/not-a-uuid")

        assert response.status_code == 400

    def test_list_versions_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test GET /blocks/{block_id}/versions returns 400 for invalid UUID."""
        response = client.get("/blocks/not-a-uuid/versions")

        assert response.status_code == 400

    def test_get_version_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test GET /blocks/{block_id}/versions/{version} returns 400 for invalid UUID."""
        response = client.get("/blocks/not-a-uuid/versions/1.0.0")

        assert response.status_code == 400

    def test_update_version_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test PUT /blocks/{block_id}/versions/{version} returns 400 for invalid UUID."""
        response = client.put(
            "/blocks/not-a-uuid/versions/1.0.0",
            json={"description": "test"},
        )

        assert response.status_code == 400

    def test_delete_version_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test DELETE /blocks/{block_id}/versions/{version} returns 400 for invalid UUID."""
        response = client.delete("/blocks/not-a-uuid/versions/1.0.0")

        assert response.status_code == 400

    def test_get_dependencies_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test GET /blocks/{block_id}/dependencies returns 400 for invalid UUID."""
        response = client.get("/blocks/not-a-uuid/dependencies")

        assert response.status_code == 400

    def test_get_dependents_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test GET /blocks/{block_id}/dependents returns 400 for invalid UUID."""
        response = client.get("/blocks/not-a-uuid/dependents")

        assert response.status_code == 400

    def test_get_usage_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test GET /blocks/{block_id}/usage returns 400 for invalid UUID."""
        response = client.get("/blocks/not-a-uuid/usage")

        assert response.status_code == 400

    def test_clone_block_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test POST /blocks/{block_id}/clone returns 400 for invalid UUID."""
        response = client.post(
            "/blocks/not-a-uuid/clone",
            json={"new_name": "Cloned Block"},
        )

        assert response.status_code == 400

    def test_get_history_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test GET /blocks/{block_id}/history returns 400 for invalid UUID."""
        response = client.get("/blocks/not-a-uuid/history")

        assert response.status_code == 400

    def test_restore_version_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test POST /blocks/{block_id}/restore/{version} returns 400 for invalid UUID."""
        response = client.post("/blocks/not-a-uuid/restore/1.0.0")

        assert response.status_code == 400

    def test_restore_version_generic_error_returns_400(self, client: TestClient) -> None:
        """Test POST /blocks/{block_id}/restore/{version} returns 400 for generic errors."""
        from unittest.mock import MagicMock, patch

        from wavecore.api.services.blocks import _storage as _block_storage
        from wavecore.api.services.blocks import service as block_service

        # Create block using the API
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block Restore",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        # Try to restore to non-existent version
        response = client.post(f"/blocks/{created['id']}/restore/99.0.0")

        # This should return 404 since version doesn't exist
        assert response.status_code == 404

    def test_update_version_not_found_returns_404(self, client: TestClient) -> None:
        """Test PUT /blocks/{block_id}/versions/{version} returns 404 when version not found."""
        from unittest.mock import MagicMock, patch

        from wavecore.api.services.blocks import _storage as _block_storage
        from wavecore.api.services.blocks import service as block_service

        # Create block using the API
        with patch.object(_block_storage, "_get_storage") as mock_storage:
            mock_storage.return_value.load_plugin = MagicMock()
            mock_load = mock_storage.return_value.load_plugin
            mock_load.return_value = MagicMock()
            created = block_service.create_block(
                {
                    "name": "Test Block Update Version",
                    "plugin_id": str(uuid.uuid4()),
                }
            )

        # Try to update non-existent version
        response = client.put(
            f"/blocks/{created['id']}/versions/99.0.0",
            json={"description": "test"},
        )

        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["error"]["message"]


class TestABlockBodyOfTheWrongShape:
    """A Block request whose body is not the JSON shape the route takes is a bad request."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            pytest.param("POST", "/blocks", id="create"),
            pytest.param("POST", "/blocks/validate", id="validate"),
            pytest.param("POST", "/blocks/validate-dependencies", id="validate-dependencies"),
            pytest.param("POST", "/blocks/{id}/clone", id="clone"),
            pytest.param("POST", "/blocks/{id}/versions", id="add-version"),
            pytest.param("PUT", "/blocks/{id}/versions/1.0.0", id="update-version"),
        ],
    )
    @pytest.mark.parametrize(("text", "message"), NOT_OBJECT_BODIES)
    def test_a_body_that_is_not_an_object_is_refused(
        self, client: TestClient, method: str, path: str, text: str, message: str
    ) -> None:
        response = send_text(client, method, path.format(id=uuid.uuid4()), text)

        assert_refused(response, message)

    @pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
    @pytest.mark.parametrize(("text", "message"), NOT_ARRAY_BODIES)
    def test_a_batch_body_that_is_not_an_array_is_refused(
        self, client: TestClient, method: str, text: str, message: str
    ) -> None:
        assert_refused(send_text(client, method, "/blocks/batch", text), message)


class TestABlockBatchItemOfTheWrongShape:
    """A Block batch item of the wrong shape fails on its own; the other items still run."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def _create(self) -> str:
        from wavecore.api.services.blocks import service as block_service

        return str(block_service.create_block({"name": f"Batch Item {uuid.uuid4().hex[:8]}"})["id"])

    @pytest.mark.parametrize("item", NOT_OBJECT_ITEMS)
    def test_a_create_item_that_is_not_an_object_fails(self, client: TestClient, item: Any) -> None:
        response = client.post("/blocks/batch", json=[item, {"name": "Batch Created"}])

        assert response.status_code == 201, response.json()
        body = response.json()
        assert body["failed"] == [{"index": 0, "error": NOT_AN_OBJECT_ITEM}]
        assert len(body["created"]) == 1

    @pytest.mark.parametrize("item", NOT_OBJECT_ITEMS)
    def test_an_update_item_that_is_not_an_object_fails(
        self, client: TestClient, item: Any
    ) -> None:
        block_id = self._create()

        response = client.patch(
            "/blocks/batch", json=[item, {"id": block_id, "update": {"description": "Updated"}}]
        )

        assert response.status_code == 200, response.json()
        assert response.json() == {
            "updated": [block_id],
            "failed": [{"index": 0, "error": NOT_AN_OBJECT_ITEM}],
        }
        assert client.get(f"/blocks/{block_id}").json()["data"]["description"] == "Updated"

    @pytest.mark.parametrize("update", NOT_OBJECT_ITEMS)
    def test_an_update_item_whose_update_is_not_an_object_fails(
        self, client: TestClient, update: Any
    ) -> None:
        kept_id = self._create()
        block_id = self._create()
        before = client.get(f"/blocks/{kept_id}").json()["data"]

        response = client.patch(
            "/blocks/batch",
            json=[
                {"id": kept_id, "update": update},
                {"id": block_id, "update": {"description": "Updated"}},
            ],
        )

        assert response.status_code == 200, response.json()
        assert response.json() == {
            "updated": [block_id],
            "failed": [{"index": 0, "error": NOT_AN_UPDATE_OBJECT}],
        }
        assert client.get(f"/blocks/{kept_id}").json()["data"] == before
        assert client.get(f"/blocks/{block_id}").json()["data"]["description"] == "Updated"

    @pytest.mark.parametrize("item", NOT_ID_ITEMS)
    def test_a_delete_item_that_is_not_an_id_fails(self, client: TestClient, item: Any) -> None:
        block_id = self._create()

        response = client.request("DELETE", "/blocks/batch", json=[item, block_id])

        assert response.status_code == 200, response.json()
        assert response.json() == {
            "deleted": [block_id],
            "failed": [{"index": 0, "error": NOT_AN_ID_ITEM}],
        }
