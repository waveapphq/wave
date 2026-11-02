"""Unit tests for regression list enhancements (REQ-5.2.1.37).

This module tests the enhanced regression list endpoint to support the
Regressions Page in the Web UI (V-LIST-09).

Test Coverage:
- Clone regression endpoint (Duplicate action)
- Aggregate fields: suites_count, tests_count, status, last_run, tags
- Status filtering (passed, failed, never_run)
- Tags filtering

These tests are written TDD-style - they define the contract that the
implementation must fulfill.
"""

import re
import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.regressions import _storage as _reg_storage
from wavecore.api.services.regressions import version_service as _reg_version_svc


class TestCloneRegressionEndpoint:
    """Test suite for POST /regressions/{regression_id}/clone endpoint.

    REQ-5.2.1.37: Regression management screen - Duplicate action

    The clone endpoint creates a copy of a regression with a new name,
    preserving suite composition, variables, and configuration.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_clone_regression_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /regressions/{id}/clone returns 201 with cloned regression."""
        regression_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": clone_id,
                "name": "WAVE 25.12 (Copy)",
                "version": "1.0.0",
                "description": "Full regression for release",
                "suites": ["suite-1", "suite-2"],
                "suites_count": 2,
                "tests_count": 45,
                "variables": {"env": {"type": "string", "value": "staging"}},
                "metadata": {"cloned_from": regression_id},
                "tags": ["release", "full"],
                "status": "never_run",
                "last_run": None,
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "WAVE 25.12 (Copy)"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == clone_id
            assert data["data"]["name"] == "WAVE 25.12 (Copy)"
            assert data["data"]["metadata"]["cloned_from"] == regression_id

    def test_clone_regression_generates_default_name(self, client: TestClient) -> None:
        """Test that clone generates name if not provided."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": str(uuid.uuid4()),
                "name": "WAVE 25.12 (Copy)",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "suites_count": 0,
                "tests_count": 0,
                "variables": {},
                "metadata": {"cloned_from": regression_id},
                "tags": [],
                "status": "never_run",
                "last_run": None,
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={},
            )

            assert response.status_code == 201
            mock_clone.assert_called_once()

    def test_clone_regression_preserves_suite_composition(self, client: TestClient) -> None:
        """Test that clone preserves suite references and ordering."""
        regression_id = str(uuid.uuid4())
        suite1_id = str(uuid.uuid4())
        suite2_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Cloned Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [suite1_id, suite2_id],
                "suites_count": 2,
                "tests_count": 30,
                "variables": {},
                "metadata": {"cloned_from": regression_id},
                "tags": [],
                "status": "never_run",
                "last_run": None,
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "Cloned Regression"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["suites"] == [suite1_id, suite2_id]
            assert data["data"]["suites_count"] == 2

    def test_clone_regression_preserves_variables(self, client: TestClient) -> None:
        """Test that clone preserves variable definitions."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Cloned Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "suites_count": 0,
                "tests_count": 0,
                "variables": {
                    "env": {"type": "string", "default": "staging"},
                    "timeout": {"type": "integer", "default": 60},
                },
                "metadata": {"cloned_from": regression_id},
                "tags": [],
                "status": "never_run",
                "last_run": None,
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "Cloned Regression"},
            )

            assert response.status_code == 201
            data = response.json()
            assert "env" in data["data"]["variables"]
            assert "timeout" in data["data"]["variables"]

    def test_clone_regression_preserves_tags(self, client: TestClient) -> None:
        """Test that clone preserves tags."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Cloned Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "suites_count": 0,
                "tests_count": 0,
                "variables": {},
                "metadata": {"cloned_from": regression_id},
                "tags": ["release", "nightly"],
                "status": "never_run",
                "last_run": None,
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "Cloned Regression"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["tags"] == ["release", "nightly"]

    def test_clone_regression_resets_execution_status(self, client: TestClient) -> None:
        """Test that clone resets status to never_run and clears last_run."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Cloned Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "suites_count": 0,
                "tests_count": 0,
                "variables": {},
                "metadata": {"cloned_from": regression_id},
                "tags": [],
                "status": "never_run",
                "last_run": None,
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "Cloned Regression"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["status"] == "never_run"
            assert data["data"]["last_run"] is None

    def test_clone_regression_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that POST /regressions/{id}/clone returns 404 when not found."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.return_value = None

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "Clone"},
            )

            assert response.status_code == 404

    def test_clone_regression_returns_409_on_naming_conflict(self, client: TestClient) -> None:
        """Test that clone returns 409 when name already exists."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.side_effect = ValueError(
                "Regression with name 'Existing Name' already exists"
            )

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "Existing Name"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "already exists" in data["error"]["message"]

    def test_clone_regression_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test that clone returns 400 for invalid regression UUID."""
        response = client.post(
            "/regressions/invalid-uuid/clone",
            json={"name": "Clone"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid regression ID format: 'invalid-uuid' is not a valid UUID$",
            data["error"]["message"],
        )

    def test_clone_regression_sets_cache_invalidation_header(self, client: TestClient) -> None:
        """Test that clone sets X-Cache-Invalidated header."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Cloned",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "suites_count": 0,
                "tests_count": 0,
                "variables": {},
                "metadata": {},
                "tags": [],
                "status": "never_run",
                "last_run": None,
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "Cloned"},
            )

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers
            assert response.headers["X-Cache-Invalidated"] == "regressions_list"


class TestRegressionAggregateFields:
    """Test suite for aggregate fields in regression list response.

    REQ-5.2.1.37: Regression management screen - List view columns

    The list endpoint must include:
    - suites_count: Number of suites in the regression
    - tests_count: Total number of tests across all suites
    - status: passed | failed | never_run based on last execution
    - last_run: Timestamp of last execution (null if never run)
    - tags: Array of tags for filtering
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_regressions_includes_suites_count(self, client: TestClient) -> None:
        """Test that list response includes suites_count field."""
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "WAVE 25.12",
                        "version": "1.0.0",
                        "description": "",
                        "suites": ["s1", "s2", "s3"],
                        "suites_count": 3,
                        "tests_count": 75,
                        "variables": {},
                        "metadata": {},
                        "tags": [],
                        "status": "passed",
                        "last_run": now,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert "suites_count" in data["data"][0]
            assert data["data"][0]["suites_count"] == 3

    def test_list_regressions_includes_tests_count(self, client: TestClient) -> None:
        """Test that list response includes tests_count (total across suites)."""
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "WAVE 25.12",
                        "version": "1.0.0",
                        "description": "",
                        "suites": ["s1", "s2"],
                        "suites_count": 2,
                        "tests_count": 150,  # Total tests across all suites
                        "variables": {},
                        "metadata": {},
                        "tags": [],
                        "status": "passed",
                        "last_run": now,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert "tests_count" in data["data"][0]
            assert data["data"][0]["tests_count"] == 150

    def test_list_regressions_includes_status_passed(self, client: TestClient) -> None:
        """Test that list response includes status field with 'passed' value."""
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "WAVE 25.12",
                        "version": "1.0.0",
                        "description": "",
                        "suites": [],
                        "suites_count": 5,
                        "tests_count": 100,
                        "variables": {},
                        "metadata": {},
                        "tags": [],
                        "status": "passed",
                        "last_run": now,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert "status" in data["data"][0]
            assert data["data"][0]["status"] == "passed"

    def test_list_regressions_includes_status_failed(self, client: TestClient) -> None:
        """Test that list response includes status field with 'failed' value."""
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "WAVE 25.11",
                        "version": "1.0.0",
                        "description": "",
                        "suites": [],
                        "suites_count": 5,
                        "tests_count": 100,
                        "variables": {},
                        "metadata": {},
                        "tags": [],
                        "status": "failed",
                        "last_run": now,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert data["data"][0]["status"] == "failed"

    def test_list_regressions_includes_status_never_run(self, client: TestClient) -> None:
        """Test that list response includes status field with 'never_run' value."""
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "New Regression",
                        "version": "1.0.0",
                        "description": "",
                        "suites": [],
                        "suites_count": 0,
                        "tests_count": 0,
                        "variables": {},
                        "metadata": {},
                        "tags": [],
                        "status": "never_run",
                        "last_run": None,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert data["data"][0]["status"] == "never_run"

    def test_list_regressions_includes_last_run_with_value(self, client: TestClient) -> None:
        """Test that list response includes last_run timestamp."""
        now = datetime.now(UTC).isoformat()
        last_run = "2025-12-28T10:30:00Z"

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "WAVE 25.12",
                        "version": "1.0.0",
                        "description": "",
                        "suites": [],
                        "suites_count": 5,
                        "tests_count": 100,
                        "variables": {},
                        "metadata": {},
                        "tags": [],
                        "status": "passed",
                        "last_run": last_run,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert "last_run" in data["data"][0]
            assert data["data"][0]["last_run"] == last_run

    def test_list_regressions_includes_last_run_null(self, client: TestClient) -> None:
        """Test that list response includes last_run as null when never run."""
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "New Regression",
                        "version": "1.0.0",
                        "description": "",
                        "suites": [],
                        "suites_count": 0,
                        "tests_count": 0,
                        "variables": {},
                        "metadata": {},
                        "tags": [],
                        "status": "never_run",
                        "last_run": None,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert data["data"][0]["last_run"] is None

    def test_list_regressions_includes_tags(self, client: TestClient) -> None:
        """Test that list response includes tags array."""
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "WAVE 25.12",
                        "version": "1.0.0",
                        "description": "",
                        "suites": [],
                        "suites_count": 5,
                        "tests_count": 100,
                        "variables": {},
                        "metadata": {},
                        "tags": ["release", "full", "nightly"],
                        "status": "passed",
                        "last_run": now,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert "tags" in data["data"][0]
            assert data["data"][0]["tags"] == ["release", "full", "nightly"]

    def test_list_regressions_includes_empty_tags(self, client: TestClient) -> None:
        """Test that list response includes empty tags array when none defined."""
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "No Tags Regression",
                        "version": "1.0.0",
                        "description": "",
                        "suites": [],
                        "suites_count": 0,
                        "tests_count": 0,
                        "variables": {},
                        "metadata": {},
                        "tags": [],
                        "status": "never_run",
                        "last_run": None,
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert data["data"][0]["tags"] == []


class TestRegressionStatusFiltering:
    """Test suite for status filtering in regression list.

    REQ-5.2.1.37: Regression management screen - Status filter dropdown

    The list endpoint must support filtering by status:
    - GET /regressions?status=passed
    - GET /regressions?status=passed,failed (comma-separated)
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_regressions_filters_by_single_status(self, client: TestClient) -> None:
        """Test that list filters by single status value."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?status=passed")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("status") == ["passed"]

    def test_list_regressions_filters_by_multiple_statuses(self, client: TestClient) -> None:
        """Test that list filters by multiple comma-separated status values."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?status=passed,failed")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert set(call_kwargs.get("status", [])) == {"passed", "failed"}

    def test_list_regressions_filters_by_never_run_status(self, client: TestClient) -> None:
        """Test that list filters by never_run status."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?status=never_run")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("status") == ["never_run"]

    def test_list_regressions_validates_invalid_status(self, client: TestClient) -> None:
        """Test that list returns 400 for invalid status value."""
        response = client.get("/regressions?status=invalid_status")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid status filter: 'invalid_status' must be one of: passed, failed, never_run$",
            data["error"]["message"],
        )

    def test_list_regressions_status_filter_combined_with_search(self, client: TestClient) -> None:
        """Test that status filter works together with search."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?search=WAVE&status=passed")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("search") == "WAVE"
            assert call_kwargs.get("status") == ["passed"]


class TestRegressionTagsFiltering:
    """Test suite for tags filtering in regression list.

    REQ-5.2.1.37: Regression management screen - Tags filter dropdown

    The list endpoint must support filtering by tags:
    - GET /regressions?tags=release
    - GET /regressions?tags=release,nightly (comma-separated, all must match)
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_regressions_filters_by_single_tag(self, client: TestClient) -> None:
        """Test that list filters by single tag value."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?tags=release")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("tags") == ["release"]

    def test_list_regressions_filters_by_multiple_tags(self, client: TestClient) -> None:
        """Test that list filters by multiple comma-separated tags (all must match)."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?tags=release,nightly")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert set(call_kwargs.get("tags", [])) == {"release", "nightly"}

    def test_list_regressions_tags_filter_combined_with_status(self, client: TestClient) -> None:
        """Test that tags filter works together with status filter."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?status=passed&tags=release")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("status") == ["passed"]
            assert call_kwargs.get("tags") == ["release"]

    def test_list_regressions_all_filters_combined(self, client: TestClient) -> None:
        """Test that all filters work together."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get(
                "/regressions?search=WAVE&status=passed,failed&tags=release&page=2&per_page=25"
            )

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("search") == "WAVE"
            assert set(call_kwargs.get("status", [])) == {"passed", "failed"}
            assert call_kwargs.get("tags") == ["release"]
            assert call_kwargs.get("page") == 2
            assert call_kwargs.get("per_page") == 25


class TestRegressionSortFiltering:
    """Test suite for sort parameter in regression list.

    REQ-5.2.1.37: Regression management screen - Column sorting

    The list endpoint must support sorting by various fields:
    - GET /regressions?sort=name:asc
    - GET /regressions?sort=last_run:desc
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_regressions_sorts_by_name_ascending(self, client: TestClient) -> None:
        """Test that list sorts by name in ascending order."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?sort=name:asc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("sort_by") == "name"
            assert call_kwargs.get("sort_direction") == "asc"

    def test_list_regressions_sorts_by_name_descending(self, client: TestClient) -> None:
        """Test that list sorts by name in descending order."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?sort=name:desc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("sort_by") == "name"
            assert call_kwargs.get("sort_direction") == "desc"

    def test_list_regressions_sorts_by_last_run(self, client: TestClient) -> None:
        """Test that list sorts by last_run timestamp."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?sort=last_run:desc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("sort_by") == "last_run"
            assert call_kwargs.get("sort_direction") == "desc"

    def test_list_regressions_sorts_by_status(self, client: TestClient) -> None:
        """Test that list sorts by status."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?sort=status:asc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("sort_by") == "status"
            assert call_kwargs.get("sort_direction") == "asc"

    def test_list_regressions_validates_invalid_sort_field(self, client: TestClient) -> None:
        """Test that list returns 400 for invalid sort field."""
        response = client.get("/regressions?sort=invalid_field:asc")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid sort field: 'invalid_field' must be one of: name, version, status, "
            r"last_run, suites_count, tests_count$",
            data["error"]["message"],
        )

    def test_list_regressions_validates_invalid_sort_direction(self, client: TestClient) -> None:
        """Test that list returns 400 for invalid sort direction."""
        response = client.get("/regressions?sort=name:invalid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid sort direction: 'invalid' must be 'asc' or 'desc'$",
            data["error"]["message"],
        )

    def test_list_regressions_sort_combined_with_filters(self, client: TestClient) -> None:
        """Test that sort works together with filters."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?search=WAVE&status=passed&sort=name:asc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("search") == "WAVE"
            assert call_kwargs.get("status") == ["passed"]
            assert call_kwargs.get("sort_by") == "name"
            assert call_kwargs.get("sort_direction") == "asc"


class TestRegressionServiceAggregates:
    """Test suite for regression service aggregate field computation.

    Tests the service layer computation of:
    - suites_count from len(suites)
    - tests_count from sum of tests across suites
    - status from last execution
    - last_run from last execution timestamp
    """

    def test_service_computes_suites_count(self) -> None:
        """Test that service computes suites_count from suites array."""
        from wavecore.api.services.regressions import service as regression_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(_reg_storage, "_get_regression_suites_count") as mock_count,
            patch.object(_reg_storage, "_get_regression_tests_count") as mock_tests,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
        ):
            mock_list.return_value = [
                {
                    "id": "reg-1",
                    "name": "Test",
                    "version": "1.0.0",
                    "suites": ["s1", "s2", "s3"],
                }
            ]
            mock_count.return_value = 3
            mock_tests.return_value = 45
            mock_exec_info.return_value = {"reg-1": ("never_run", None)}

            result = regression_service.list_regressions()

            assert result["regressions"][0]["suites_count"] == 3

    def test_service_computes_tests_count_from_suites(self) -> None:
        """tests_count for a many-to-many regression is the sum of tests across
        the suites referenced in ``regression.suites``, not the
        ``_batch_regression_counts`` aggregate (which only counts suites with
        ``metadata.parent_regression`` set). The enrichment path resolves each
        suite id via ``suite_service.get_suite`` and sums ``len(tests)``.
        """
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
            patch.object(regression_service, "_batch_regression_counts") as mock_counts,
            patch.object(suite_service, "get_suite") as mock_get_suite,
        ):
            mock_list.return_value = [
                {
                    "id": "reg-1",
                    "name": "Test",
                    "version": "1.0.0",
                    "suites": ["s1", "s2"],
                }
            ]
            mock_exec_info.return_value = {"reg-1": ("never_run", None)}
            # The aggregate reports zero because these suites don't
            # carry parent_regression metadata; the enriched count must
            # come from the explicit suites, not from here.
            mock_counts.return_value = {}
            mock_get_suite.side_effect = lambda sid: (
                {"id": "s1", "tests": ["t1", "t2", "t3"]}
                if sid == "s1"
                else {"id": "s2", "tests": ["t4", "t5"]}
            )

            result = regression_service.list_regressions()

            assert result["regressions"][0]["tests_count"] == 5

    def test_service_derives_status_from_last_execution(self) -> None:
        """Test that service derives status from last execution result."""
        from wavecore.api.services.regressions import service as regression_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(_reg_storage, "_get_regression_suites_count") as mock_count,
            patch.object(_reg_storage, "_get_regression_tests_count") as mock_tests,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
        ):
            mock_list.return_value = [
                {
                    "id": "reg-1",
                    "name": "Test",
                    "version": "1.0.0",
                    "suites": [],
                }
            ]
            mock_count.return_value = 0
            mock_tests.return_value = 0
            mock_exec_info.return_value = {"reg-1": ("passed", "2025-12-28T10:00:00Z")}

            result = regression_service.list_regressions()

            assert result["regressions"][0]["status"] == "passed"
            assert result["regressions"][0]["last_run"] == "2025-12-28T10:00:00Z"


class TestSortFormatValidation:
    """Test suite for sort parameter format validation.

    Tests edge cases for the sort parameter format:
    - More than 2 parts (invalid: "name:asc:extra")
    - Missing direction (valid: defaults to "asc")
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_sort_format_with_three_or_more_parts_returns_400(self, client: TestClient) -> None:
        """Test that sort with more than 2 parts returns 400."""
        response = client.get("/regressions?sort=name:asc:extra")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert (
            data["error"]["message"]
            == "Invalid sort format: 'name:asc:extra'. Use 'field:direction'"
        )

    def test_sort_without_direction_defaults_to_ascending(self, client: TestClient) -> None:
        """Test that sort with only field name defaults to ascending."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?sort=name")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("sort_by") == "name"
            assert call_kwargs.get("sort_direction") == "asc"


class TestCloneRegressionExceptionHandling:
    """Test suite for clone endpoint exception handling.

    Tests that generic exceptions are properly handled with 500 response.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_clone_regression_handles_generic_exception(self, client: TestClient) -> None:
        """Test that generic exception returns 500 with correlation ID."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.composition_routes._reg_version_svc.clone_regression"
        ) as mock_clone:
            mock_clone.side_effect = RuntimeError("Unexpected error")

            response = client.post(
                f"/regressions/{regression_id}/clone",
                json={"name": "Test Clone"},
            )

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["message"] == "Internal server error"
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "correlation_id" in data["error"]
            # Correlation ID should be a valid UUID
            uuid.UUID(data["error"]["correlation_id"])


class TestGetRegressionSuitesWithTestsEndpoint:
    """Test suite for GET /regressions/{id}/suites endpoint.

    REQ-5.2.1.37: Get suites with tests for run dialog.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_regression_suites_returns_200_with_suites(self, client: TestClient) -> None:
        """Test that endpoint returns suites with their tests."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.composition_routes.regression_service.get_regression_suites_with_tests"
        ) as mock_get:
            mock_get.return_value = [
                {
                    "id": "suite-1",
                    "name": "Login Tests",
                    "tests": [
                        {"id": "test-1", "name": "Valid login"},
                        {"id": "test-2", "name": "Invalid login"},
                    ],
                },
                {
                    "id": "suite-2",
                    "name": "Checkout Tests",
                    "tests": [{"id": "test-3", "name": "Complete checkout"}],
                },
            ]

            response = client.get(f"/regressions/{regression_id}/suites")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 2
            assert data["data"][0]["name"] == "Login Tests"
            assert len(data["data"][0]["tests"]) == 2

    def test_get_regression_suites_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that endpoint returns 404 for nonexistent regression."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.composition_routes.regression_service.get_regression_suites_with_tests"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/regressions/{regression_id}/suites")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "NOT_FOUND"

    def test_get_regression_suites_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test that endpoint returns 400 for invalid UUID."""
        response = client.get("/regressions/not-a-uuid/suites")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "INVALID_PARAMETER"


class TestGetSuiteTestsEndpoint:
    """Test suite for GET /suites/{id}/tests endpoint.

    REQ-5.2.1.37: Get tests for suite in run dialog.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_suite_tests_returns_200_with_tests(self, client: TestClient) -> None:
        """Test that endpoint returns tests for a suite with full metadata."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.get_suite_tests") as mock_get:
            mock_get.return_value = [
                {
                    "id": "test-1",
                    "name": "Test login",
                    "version": "1.0.0",
                    "created_at": "2026-03-01T00:00:00Z",
                    "updated_at": "2026-03-01T00:00:00Z",
                    "tags": ["smoke"],
                    "metadata": {"status": "passed"},
                },
                {
                    "id": "test-2",
                    "name": "Test logout",
                    "version": "1.0.0",
                    "created_at": "2026-03-01T00:00:00Z",
                    "updated_at": "2026-03-01T00:00:00Z",
                    "tags": [],
                    "metadata": {},
                },
            ]

            response = client.get(f"/suites/{suite_id}/tests")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 2
            assert data["data"][0]["tags"] == ["smoke"]
            assert data["data"][0]["metadata"]["status"] == "passed"

    def test_get_suite_tests_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that endpoint returns 404 for nonexistent suite."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.get_suite_tests") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/suites/{suite_id}/tests")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "NOT_FOUND"

    def test_get_suite_tests_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test that endpoint returns 400 for invalid UUID."""
        response = client.get("/suites/not-a-uuid/tests")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"


class TestRegressionServiceHelperFunctions:
    """Test suite for regression service helper functions.

    Tests the actual implementation of:
    - _get_regression_suites_count
    - _get_regression_tests_count
    - _batch_regression_execution_info
    - clone_regression
    - get_regression_suites_with_tests
    - _get_suite_tests
    """

    def test_batch_regression_counts_computes_suites_and_tests(self) -> None:
        """Test _batch_regression_counts computes counts in a single pass."""
        from wavecore.api.services.regressions import _storage as _reg_storage
        from wavecore.api.services.suites import service as suite_service

        with patch.object(
            suite_service,
            "_list_all_suites",
            return_value=[
                {
                    "name": "Suite A",
                    "tests": ["t1", "t2"],
                    "metadata": {"parent_regression": "Reg1"},
                },
                {
                    "name": "Suite B",
                    "tests": ["t3", "t4"],
                    "metadata": {"parent_regression": "Reg1"},
                },
                {"name": "Suite C", "tests": ["t5"], "metadata": {}},
            ],
        ):
            counts = _reg_storage._batch_regression_counts()

        assert counts["Reg1"] == (2, 4)  # 2 suites, 2 (Suite A) + 2 (Suite B)
        assert "Suite C" not in counts  # No parent_regression

    def test_batch_regression_counts_empty(self) -> None:
        """Test _batch_regression_counts with no data."""
        from wavecore.api.services.suites import service as suite_service

        with patch.object(suite_service, "_list_all_suites", return_value=[]):
            counts = _reg_storage._batch_regression_counts()

        assert counts == {}

    def test_get_suites_count_with_direct_suites(self) -> None:
        """Test suites count from direct suites array."""

        regression = {"suites": ["s1", "s2", "s3"]}
        count = _reg_storage._get_regression_suites_count(regression)
        assert count == 3

    def test_get_suites_count_with_empty_suites_falls_back_to_metadata(self) -> None:
        """Test suites count falls back to querying by parent_regression metadata."""
        from wavecore.api.services.regressions import _storage as _reg_storage
        from wavecore.api.services.suites import service as suite_service

        regression = {"name": "TestRegression", "suites": []}

        with patch.object(suite_service, "_list_all_suites") as mock_suites:
            mock_suites.return_value = [
                {"id": "s1", "metadata": {"parent_regression": "TestRegression"}},
                {"id": "s2", "metadata": {"parent_regression": "TestRegression"}},
                {"id": "s3", "metadata": {"parent_regression": "OtherRegression"}},
            ]

            count = _reg_storage._get_regression_suites_count(regression)
            assert count == 2

    def test_get_suites_count_with_no_name_returns_zero(self) -> None:
        """Test suites count returns 0 when regression has no name."""

        regression = {"name": "", "suites": []}
        count = _reg_storage._get_regression_suites_count(regression)
        assert count == 0

    def test_get_tests_count_with_direct_suite_ids(self) -> None:
        """Test tests count from suites with direct IDs."""
        from wavecore.api.services.regressions import _storage as _reg_storage
        from wavecore.api.services.suites import service as suite_service

        regression = {"suites": ["s1", "s2"]}

        with patch.object(suite_service, "get_suite") as mock_get:
            mock_get.side_effect = [
                {"id": "s1", "tests": ["t1", "t2", "t3"]},
                {"id": "s2", "tests": ["t4", "t5"]},
            ]

            count = _reg_storage._get_regression_tests_count(regression)
            assert count == 5

    def test_get_tests_count_with_metadata_fallback(self) -> None:
        """Test tests count using parent_regression metadata and suite.tests arrays."""
        from wavecore.api.services.suites import service as suite_service

        regression = {"name": "TestRegression", "suites": []}

        with patch.object(suite_service, "_list_all_suites") as mock_suites:
            mock_suites.return_value = [
                {
                    "id": "s1",
                    "name": "Suite1",
                    "tests": ["t1", "t2"],
                    "metadata": {"parent_regression": "TestRegression"},
                },
                {
                    "id": "s2",
                    "name": "Suite2",
                    "tests": ["t3"],
                    "metadata": {"parent_regression": "TestRegression"},
                },
            ]

            count = _reg_storage._get_regression_tests_count(regression)
            # Suite1 has 2 tests, Suite2 has 1 test
            assert count == 3

    def test_get_tests_count_with_no_name_returns_zero(self) -> None:
        """Test tests count returns 0 when regression has no name."""

        regression = {"name": "", "suites": []}
        count = _reg_storage._get_regression_tests_count(regression)
        assert count == 0

    def test_batch_execution_info_returns_empty_when_no_executions(self) -> None:
        """Test _batch_regression_execution_info returns empty dict when no executions."""
        from wavecore.api.services.executions import service as execution_service

        with patch.object(execution_service, "list_executions") as mock_exec:
            mock_exec.return_value = {"total": 0, "executions": []}

            result = _reg_storage._batch_regression_execution_info()
            assert result == {}

    def test_batch_execution_info_completed_returns_passed(self) -> None:
        """Test batch execution info returns passed for completed execution."""
        from wavecore.api.services.executions import service as execution_service

        with patch.object(execution_service, "list_executions") as mock_exec:
            mock_exec.return_value = {
                "total": 1,
                "executions": [
                    {
                        "entity_id": "reg-1",
                        "status": "completed",
                        "completed_at": "2025-12-28T10:00:00Z",
                    }
                ],
            }

            result = _reg_storage._batch_regression_execution_info()
            assert result["reg-1"] == ("passed", "2025-12-28T10:00:00Z")

    def test_batch_execution_info_passed_returns_passed(self) -> None:
        """Test batch execution info returns passed for passed execution."""
        from wavecore.api.services.executions import service as execution_service

        with patch.object(execution_service, "list_executions") as mock_exec:
            mock_exec.return_value = {
                "total": 1,
                "executions": [
                    {
                        "entity_id": "reg-1",
                        "status": "passed",
                        "completed_at": "2025-12-28T10:00:00Z",
                    }
                ],
            }

            result = _reg_storage._batch_regression_execution_info()
            assert result["reg-1"] == ("passed", "2025-12-28T10:00:00Z")

    def test_batch_execution_info_failed_returns_failed(self) -> None:
        """Test batch execution info returns failed for failed execution."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.regressions import _storage as _reg_storage

        with patch.object(execution_service, "list_executions") as mock_exec:
            mock_exec.return_value = {
                "total": 1,
                "executions": [
                    {
                        "entity_id": "reg-1",
                        "status": "failed",
                        "completed_at": "2025-12-28T10:00:00Z",
                    }
                ],
            }

            result = _reg_storage._batch_regression_execution_info()
            assert result["reg-1"] == ("failed", "2025-12-28T10:00:00Z")

    def test_batch_execution_info_error_returns_failed(self) -> None:
        """Test batch execution info returns failed for error execution."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.regressions import _storage as _reg_storage

        with patch.object(execution_service, "list_executions") as mock_exec:
            mock_exec.return_value = {
                "total": 1,
                "executions": [
                    {
                        "entity_id": "reg-1",
                        "status": "error",
                        "completed_at": "2025-12-28T10:00:00Z",
                    }
                ],
            }

            result = _reg_storage._batch_regression_execution_info()
            assert result["reg-1"] == ("failed", "2025-12-28T10:00:00Z")

    @pytest.mark.parametrize(
        ("raw_status", "expected"),
        [
            ("running", "running"),
            ("pending", "running"),
            ("stopped", "stopped"),
        ],
    )
    def test_batch_execution_info_reports_non_terminal_runs_truthfully(
        self, raw_status: str, expected: str
    ) -> None:
        """A regression that has run cannot also report 'never run'; the status
        must agree with the last_run timestamp beside it."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.regressions import _storage as _reg_storage

        with patch.object(execution_service, "list_executions") as mock_exec:
            mock_exec.return_value = {
                "total": 1,
                "executions": [
                    {
                        "entity_id": "reg-1",
                        "status": raw_status,
                        "completed_at": None,
                        "started_at": "2025-12-28T10:00:00Z",
                    }
                ],
            }

            result = _reg_storage._batch_regression_execution_info()
            assert result["reg-1"] == (expected, "2025-12-28T10:00:00Z")

    def test_batch_execution_info_returns_completed_at(self) -> None:
        """Test batch execution info returns completed_at timestamp."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.regressions import _storage as _reg_storage

        with patch.object(execution_service, "list_executions") as mock_exec:
            mock_exec.return_value = {
                "total": 1,
                "executions": [
                    {
                        "entity_id": "reg-1",
                        "status": "passed",
                        "completed_at": "2025-12-28T10:30:00Z",
                        "started_at": "2025-12-28T10:00:00Z",
                    }
                ],
            }

            result = _reg_storage._batch_regression_execution_info()
            assert result["reg-1"] == ("passed", "2025-12-28T10:30:00Z")

    def test_batch_execution_info_falls_back_to_started_at(self) -> None:
        """Test batch execution info falls back to started_at when completed_at is None."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.regressions import _storage as _reg_storage

        with patch.object(execution_service, "list_executions") as mock_exec:
            mock_exec.return_value = {
                "total": 1,
                "executions": [
                    {
                        "entity_id": "reg-1",
                        "status": "passed",
                        "completed_at": None,
                        "started_at": "2025-12-28T10:00:00Z",
                    }
                ],
            }

            result = _reg_storage._batch_regression_execution_info()
            assert result["reg-1"] == ("passed", "2025-12-28T10:00:00Z")

    def test_clone_regression_returns_none_when_source_not_found(self) -> None:
        """Test clone returns None when source regression not found."""
        from wavecore.api.services.regressions import service as regression_service

        with patch.object(regression_service, "_load_regression") as mock_load:
            mock_load.return_value = None

            result = _reg_version_svc.clone_regression("nonexistent-id")
            assert result is None

    def test_clone_regression_generates_default_name(self) -> None:
        """Test clone generates 'Name (Copy)' when name not provided."""

        source_id = str(uuid.uuid4())
        source = {
            "id": source_id,
            "name": "Original Regression",
            "version": "1.0.0",
            "description": "Test description",
            "suites": [],
            "variables": {},
            "tags": [],
        }

        with (
            patch.object(_reg_version_svc, "_load_regression") as mock_load,
            patch.object(_reg_version_svc, "_list_all_regressions") as mock_list,
            patch.object(_reg_version_svc, "_save_regression") as mock_save,
            patch.object(_reg_version_svc, "_save_versions") as mock_versions,
            patch.object(_reg_version_svc, "_get_regression_tests_count") as mock_tests,
        ):
            mock_load.return_value = source
            mock_list.return_value = []
            mock_tests.return_value = 0

            result = _reg_version_svc.clone_regression(source_id)

            assert result is not None
            assert result["name"] == "Original Regression (Copy)"
            mock_save.assert_called_once()
            mock_versions.assert_called_once()

    def test_clone_regression_raises_on_name_conflict(self) -> None:
        """Test clone raises ValueError when name already exists."""

        source_id = str(uuid.uuid4())
        source = {
            "id": source_id,
            "name": "Original",
            "version": "1.0.0",
            "description": "",
            "suites": [],
            "variables": {},
            "tags": [],
        }

        with (
            patch.object(_reg_version_svc, "_load_regression") as mock_load,
            patch.object(_reg_version_svc, "_list_all_regressions") as mock_list,
        ):
            mock_load.return_value = source
            mock_list.return_value = [{"name": "Existing Name"}]

            with pytest.raises(ConflictException, match="already exists"):
                _reg_version_svc.clone_regression(source_id, "Existing Name")

    def test_clone_regression_preserves_data(self) -> None:
        """Test clone preserves suites, variables, tags."""

        source_id = str(uuid.uuid4())
        source = {
            "id": source_id,
            "name": "Original",
            "version": "1.0.0",
            "description": "Test",
            "suites": ["s1", "s2"],
            "variables": {"key": "value"},
            "tags": ["tag1", "tag2"],
        }

        with (
            patch.object(_reg_version_svc, "_load_regression") as mock_load,
            patch.object(_reg_version_svc, "_list_all_regressions") as mock_list,
            patch.object(_reg_version_svc, "_save_regression") as _mock_save,
            patch.object(_reg_version_svc, "_save_versions") as _mock_versions,
            patch.object(_reg_version_svc, "_get_regression_tests_count") as mock_tests,
        ):
            mock_load.return_value = source
            mock_list.return_value = []
            mock_tests.return_value = 10

            result = _reg_version_svc.clone_regression(source_id, "New Name")

            assert result is not None
            assert result["name"] == "New Name"
            assert result["description"] == "Test"
            assert result["suites"] == ["s1", "s2"]
            assert result["variables"] == {"key": "value"}
            assert result["tags"] == ["tag1", "tag2"]
            assert result["status"] == "never_run"
            assert result["last_run"] is None
            assert result["metadata"]["cloned_from"] == source_id

    def test_get_regression_suites_with_tests_returns_none_when_not_found(
        self,
    ) -> None:
        """Test get_regression_suites_with_tests returns None for nonexistent regression."""
        from wavecore.api.services.regressions import service as regression_service

        with patch.object(regression_service, "_load_regression") as mock_load:
            mock_load.return_value = None

            result = regression_service.get_regression_suites_with_tests("nonexistent")
            assert result is None

    def test_get_regression_suites_with_tests_using_direct_ids(self) -> None:
        """Test get_regression_suites_with_tests with direct suite IDs."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        regression = {"id": "reg-1", "name": "Test", "suites": ["s1", "s2"]}

        with (
            patch.object(regression_service, "_load_regression") as mock_load,
            patch.object(suite_service, "get_suite") as mock_suite,
            patch.object(test_service, "get_test") as mock_test,
        ):
            mock_load.return_value = regression
            mock_suite.side_effect = [
                {"id": "s1", "name": "Suite1", "tests": ["t1"]},
                {"id": "s2", "name": "Suite2", "tests": ["t2", "t3"]},
            ]
            mock_test.side_effect = [
                {"id": "t1", "name": "Test1"},
                {"id": "t2", "name": "Test2"},
                {"id": "t3", "name": "Test3"},
            ]

            result = regression_service.get_regression_suites_with_tests("reg-1")

            assert result is not None
            assert len(result) == 2
            assert result[0]["name"] == "Suite1"
            assert len(result[0]["tests"]) == 1
            assert result[1]["name"] == "Suite2"
            assert len(result[1]["tests"]) == 2

    def test_get_regression_suites_with_tests_empty_suite(self) -> None:
        """Test get_regression_suites_with_tests returns suite with empty tests list."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        regression = {"id": "reg-1", "name": "TestReg", "suites": []}

        with (
            patch.object(regression_service, "_load_regression") as mock_load,
            patch.object(suite_service, "_list_all_suites") as mock_suites,
        ):
            mock_load.return_value = regression
            mock_suites.return_value = [
                {
                    "id": "s1",
                    "name": "Suite1",
                    "tests": [],
                    "metadata": {"parent_regression": "TestReg"},
                },
            ]

            result = regression_service.get_regression_suites_with_tests("reg-1")

            assert result is not None
            assert len(result) == 1
            assert result[0]["name"] == "Suite1"
            assert len(result[0]["tests"]) == 0


class TestSuiteServiceHelperFunctions:
    """Test suite for suite_service helper functions."""

    def test_get_suite_tests_count_with_no_name_returns_zero(self) -> None:
        """Test _get_suite_tests_count returns 0 when suite has no name and empty tests."""
        from wavecore.api.services.suites import _storage as _suite_storage

        suite = {"id": "s1", "name": "", "tests": []}
        count = _suite_storage._get_suite_tests_count(suite)
        assert count == 0


class TestSuiteServiceGetSuiteTests:
    """Test suite for suite_service.get_suite_tests function."""

    def test_get_suite_tests_returns_none_when_not_found(self) -> None:
        """Test get_suite_tests returns None for nonexistent suite."""
        from wavecore.api.services.suites import service as suite_service

        with patch.object(suite_service, "_load_suite") as mock_load:
            mock_load.return_value = None

            result = suite_service.get_suite_tests("nonexistent")
            assert result is None

    def test_get_suite_tests_with_direct_test_ids(self) -> None:
        """Test get_suite_tests with direct test IDs returns full metadata."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        suite = {"id": "s1", "name": "Suite1", "tests": ["t1", "t2"]}

        with (
            patch.object(suite_service, "_load_suite") as mock_load,
            patch.object(test_service, "get_test") as mock_test,
        ):
            mock_load.return_value = suite
            mock_test.side_effect = [
                {
                    "id": "t1",
                    "name": "Test1",
                    "version": "1.0.0",
                    "created_at": "2026-03-01T00:00:00Z",
                    "updated_at": "2026-03-02T00:00:00Z",
                    "tags": ["smoke"],
                    "metadata": {"status": "passed", "last_run": "2026-03-02T12:00:00Z"},
                },
                {
                    "id": "t2",
                    "name": "Test2",
                    "version": "1.0.0",
                    "created_at": "2026-03-01T00:00:00Z",
                    "updated_at": "2026-03-02T00:00:00Z",
                    "tags": [],
                    "metadata": {"status": "failed"},
                },
            ]

            result = suite_service.get_suite_tests("s1")

            assert result is not None
            assert len(result) == 2
            assert result[0]["name"] == "Test1"
            assert result[0]["tags"] == ["smoke"]
            assert result[0]["metadata"]["status"] == "passed"
            assert result[1]["name"] == "Test2"
            assert result[1]["metadata"]["status"] == "failed"

    def test_get_suite_tests_returns_empty_for_empty_tests_array(self) -> None:
        """Test get_suite_tests returns empty list when suite has no tests."""
        from wavecore.api.services.suites import service as suite_service

        suite = {"id": "s1", "name": "Suite1", "tests": []}

        with patch.object(suite_service, "_load_suite") as mock_load:
            mock_load.return_value = suite

            result = suite_service.get_suite_tests("s1")

            assert result is not None
            assert len(result) == 0


class TestListRegressionsFiltering:
    """Test suite for regression service list filtering and sorting.

    Tests the actual filtering logic in list_regressions without mocking.
    """

    def test_list_filters_by_status(self) -> None:
        """Test list_regressions filters by status correctly."""
        from wavecore.api.services.regressions import service as regression_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(_reg_storage, "_get_regression_suites_count") as mock_count,
            patch.object(_reg_storage, "_get_regression_tests_count") as mock_tests,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
        ):
            mock_list.return_value = [
                {"id": "r1", "name": "Reg1", "version": "1.0", "tags": []},
                {"id": "r2", "name": "Reg2", "version": "1.0", "tags": []},
            ]
            mock_count.return_value = 0
            mock_tests.return_value = 0
            mock_exec_info.return_value = {
                "r1": ("passed", None),
                "r2": ("failed", None),
            }

            result = regression_service.list_regressions(status=["passed"])

            assert len(result["regressions"]) == 1
            assert result["regressions"][0]["name"] == "Reg1"

    def test_list_filters_by_tags(self) -> None:
        """Test list_regressions filters by tags (OR semantics: match any)."""
        from wavecore.api.services.regressions import service as regression_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(_reg_storage, "_get_regression_suites_count") as mock_count,
            patch.object(_reg_storage, "_get_regression_tests_count") as mock_tests,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
        ):
            mock_list.return_value = [
                {"id": "r1", "name": "Reg1", "version": "1.0", "tags": ["release", "full"]},
                {"id": "r2", "name": "Reg2", "version": "1.0", "tags": ["release"]},
                {"id": "r3", "name": "Reg3", "version": "1.0", "tags": ["other"]},
            ]
            mock_count.return_value = 0
            mock_tests.return_value = 0
            mock_exec_info.return_value = {}

            # OR semantics: selecting release OR full matches Reg1 and Reg2
            result = regression_service.list_regressions(tags=["release", "full"])

            assert len(result["regressions"]) == 2
            names = {r["name"] for r in result["regressions"]}
            assert names == {"Reg1", "Reg2"}

    def test_list_sorts_by_name_ascending(self) -> None:
        """Test list_regressions sorts by name ascending."""
        from wavecore.api.services.regressions import service as regression_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(_reg_storage, "_get_regression_suites_count") as mock_count,
            patch.object(_reg_storage, "_get_regression_tests_count") as mock_tests,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
        ):
            mock_list.return_value = [
                {"id": "r1", "name": "Zebra", "version": "1.0", "tags": []},
                {"id": "r2", "name": "Alpha", "version": "1.0", "tags": []},
            ]
            mock_count.return_value = 0
            mock_tests.return_value = 0
            mock_exec_info.return_value = {}

            result = regression_service.list_regressions(sort_by="name", sort_direction="asc")

            assert result["regressions"][0]["name"] == "Alpha"
            assert result["regressions"][1]["name"] == "Zebra"

    def test_list_sorts_by_name_descending(self) -> None:
        """Test list_regressions sorts by name descending."""
        from wavecore.api.services.regressions import service as regression_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(_reg_storage, "_get_regression_suites_count") as mock_count,
            patch.object(_reg_storage, "_get_regression_tests_count") as mock_tests,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
        ):
            mock_list.return_value = [
                {"id": "r1", "name": "Alpha", "version": "1.0", "tags": []},
                {"id": "r2", "name": "Zebra", "version": "1.0", "tags": []},
            ]
            mock_count.return_value = 0
            mock_tests.return_value = 0
            mock_exec_info.return_value = {}

            result = regression_service.list_regressions(sort_by="name", sort_direction="desc")

            assert result["regressions"][0]["name"] == "Zebra"
            assert result["regressions"][1]["name"] == "Alpha"

    def test_list_sorts_with_none_values(self) -> None:
        """Test list_regressions handles None values in sort correctly."""
        from wavecore.api.services.regressions import service as regression_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(_reg_storage, "_get_regression_suites_count") as mock_count,
            patch.object(_reg_storage, "_get_regression_tests_count") as mock_tests,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
        ):
            mock_list.return_value = [
                {"id": "r1", "name": "Alpha", "version": "1.0", "tags": []},
                {"id": "r2", "name": None, "version": "1.0", "tags": []},
            ]
            mock_count.return_value = 0
            mock_tests.return_value = 0
            mock_exec_info.return_value = {}

            # None values should be put at end for ascending
            result = regression_service.list_regressions(sort_by="name", sort_direction="asc")

            assert result["regressions"][0]["name"] == "Alpha"
            # None is at end

    def test_list_sorts_numeric_values(self) -> None:
        """Test list_regressions sorts numeric values correctly."""
        from wavecore.api.services.regressions import service as regression_service

        with (
            patch.object(regression_service, "_list_all_regressions") as mock_list,
            patch.object(regression_service, "_batch_regression_execution_info") as mock_exec_info,
            patch.object(regression_service, "_batch_regression_counts") as mock_counts,
        ):
            mock_list.return_value = [
                {"id": "r1", "name": "Reg1", "version": "1.0", "tags": []},
                {"id": "r2", "name": "Reg2", "version": "1.0", "tags": []},
            ]
            mock_exec_info.return_value = {}
            mock_counts.return_value = {"Reg1": (5, 0), "Reg2": (2, 0)}

            result = regression_service.list_regressions(
                sort_by="suites_count", sort_direction="asc"
            )

            assert result["regressions"][0]["suites_count"] == 2
            assert result["regressions"][1]["suites_count"] == 5
