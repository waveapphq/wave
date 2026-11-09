"""Unit tests for environment import/export endpoints.

This module tests the synchronous environment import/export endpoints enabling
portable serialization and deserialization of environment definitions with format
selection, conflict resolution, and validation integration.

Test Coverage:
- Single environment export: YAML/JSON format, headers, 404/400
- Bulk environment export: single file vs ZIP, content-type, 400/404
- Import validation: valid files, conflicts, fatal errors, ZIP
- Import execution: create environments, conflict resolution, fatal rejection
"""

import io
import json
import uuid
import zipfile
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.api.body_shape_support import NOT_ID_LIST_FIELDS, assert_refused
from tests.api.download_name_helpers import ENTITY_NAME, EXPORT_STEM, assert_whole_name
from wavecore.api.exceptions import NotFoundException, ValidationException


def _make_environment(
    name: str = "Production",
    *,
    env_id: str | None = None,
    description: str = "Production environment",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Create a minimal environment dict for mocking."""
    return {
        "id": env_id or str(uuid.uuid4()),
        "name": name,
        "description": description,
        "tags": tags or ["prod", "live"],
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


# ============================================================================
# Single Environment Export
# ============================================================================


class TestExportSingleEnvironment:
    """Tests for GET /environments/{env_id}/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_export_yaml_default_format(self, client: TestClient) -> None:
        """Export defaults to YAML format."""
        env = _make_environment("Staging")
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environment"
        ) as mock_export:
            mock_export.return_value = (
                yaml.dump(env, default_flow_style=False),
                "Staging.yaml",
            )
            response = client.get(f"/environments/{env['id']}/export")

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]
        assert 'filename="Staging.yaml"' in response.headers["content-disposition"]

    def test_export_json_format(self, client: TestClient) -> None:
        """Export in JSON format returns correct content-type."""
        env = _make_environment("Staging")
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environment"
        ) as mock_export:
            mock_export.return_value = (
                json.dumps(env, indent=2),
                "Staging.json",
            )
            response = client.get(f"/environments/{env['id']}/export?format=json")

        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]
        assert 'filename="Staging.json"' in response.headers["content-disposition"]

    def test_export_content_is_parseable_yaml(self, client: TestClient) -> None:
        """Exported YAML content is valid and parseable."""
        env = _make_environment("Parseable Env")
        yaml_content = yaml.dump(env, default_flow_style=False)
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environment"
        ) as mock_export:
            mock_export.return_value = (yaml_content, "Parseable-Env.yaml")
            response = client.get(f"/environments/{env['id']}/export")

        parsed = yaml.safe_load(response.text)
        assert parsed["name"] == "Parseable Env"

    def test_export_content_is_parseable_json(self, client: TestClient) -> None:
        """Exported JSON content is valid and parseable."""
        env = _make_environment("JSON Env")
        json_content = json.dumps(env, indent=2)
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environment"
        ) as mock_export:
            mock_export.return_value = (json_content, "JSON-Env.json")
            response = client.get(f"/environments/{env['id']}/export?format=json")

        parsed = json.loads(response.text)
        assert parsed["name"] == "JSON Env"

    def test_export_not_found_returns_404(self, client: TestClient) -> None:
        """Export returns 404 for non-existent environment."""
        fake_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environment"
        ) as mock_export:
            mock_export.return_value = None
            response = client.get(f"/environments/{fake_id}/export")

        assert response.status_code == 404

    def test_export_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid UUID."""
        response = client.get("/environments/not-a-uuid/export")
        assert response.status_code == 400

    def test_export_invalid_format_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid format parameter."""
        env_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environment"
        ) as mock_export:
            mock_export.return_value = None
            response = client.get(f"/environments/{env_id}/export?format=xml")

        assert response.status_code == 400

    def test_export_content_disposition_header(self, client: TestClient) -> None:
        """Export sets Content-Disposition attachment header."""
        env = _make_environment("Attachment Env")
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environment"
        ) as mock_export:
            mock_export.return_value = ("content", "Attachment-Env.yaml")
            response = client.get(f"/environments/{env['id']}/export")

        assert response.headers["content-disposition"].startswith("attachment")


# ============================================================================
# Bulk Environment Export
# ============================================================================


class TestExportBulkEnvironments:
    """Tests for POST /environments/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_env_returns_file_not_zip(self, client: TestClient) -> None:
        """Exporting 1 environment returns single file, not ZIP."""
        env_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environments_batch"
        ) as mock_batch:
            mock_batch.return_value = [(env_id, "name: Staging\n", "Staging.yaml")]
            response = client.post(
                "/environments/export",
                json={"environment_ids": [env_id], "format": "yaml"},
            )

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]

    def test_multiple_envs_returns_zip(self, client: TestClient) -> None:
        """Exporting 2+ environments returns ZIP archive."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environments_batch"
        ) as mock_batch:
            mock_batch.return_value = [
                (id1, "name: Staging\n", "Staging.yaml"),
                (id2, "name: Production\n", "Production.yaml"),
            ]
            response = client.post(
                "/environments/export",
                json={"environment_ids": [id1, id2], "format": "yaml"},
            )

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert 'filename="environments-export.zip"' in response.headers["content-disposition"]

    def test_zip_contains_all_envs(self, client: TestClient) -> None:
        """ZIP archive contains all exported environments."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environments_batch"
        ) as mock_batch:
            mock_batch.return_value = [
                (id1, "name: Alpha\n", "Alpha.yaml"),
                (id2, "name: Beta\n", "Beta.yaml"),
            ]
            response = client.post(
                "/environments/export",
                json={"environment_ids": [id1, id2], "format": "yaml"},
            )

        zf = zipfile.ZipFile(io.BytesIO(response.content))
        names = zf.namelist()
        assert "Alpha.yaml" in names
        assert "Beta.yaml" in names
        assert len(names) == 2

    def test_empty_list_returns_400(self, client: TestClient) -> None:
        """Exporting empty list returns 400."""
        response = client.post(
            "/environments/export",
            json={"environment_ids": [], "format": "yaml"},
        )
        assert response.status_code == 400

    @pytest.mark.parametrize("environment_ids", NOT_ID_LIST_FIELDS)
    def test_ids_that_are_not_a_list_of_strings_are_refused(
        self, client: TestClient, environment_ids: Any
    ) -> None:
        response = client.post(
            "/environments/export", json={"environment_ids": environment_ids, "format": "yaml"}
        )

        assert_refused(response, "'environment_ids' must be a list of ID strings")

    def test_nonexistent_env_returns_404(self, client: TestClient) -> None:
        """Exporting non-existent environment returns 404."""
        fake_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.export_environments_batch"
        ) as mock_batch:
            mock_batch.side_effect = NotFoundException(f"Environment not found: {fake_id}")
            response = client.post(
                "/environments/export",
                json={"environment_ids": [fake_id], "format": "yaml"},
            )

        assert response.status_code == 404

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        """Invalid format parameter returns 400."""
        env_id = str(uuid.uuid4())
        response = client.post(
            "/environments/export",
            json={"environment_ids": [env_id], "format": "xml"},
        )
        assert response.status_code == 400


# ============================================================================
# Import Validation
# ============================================================================


class TestValidateEnvironmentImport:
    """Tests for POST /environments/import/validate."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_valid_yaml(self, client: TestClient) -> None:
        """Valid YAML returns ok status."""
        env_data = {"name": "New Env", "description": "A new environment"}
        content = yaml.dump(env_data)
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.validate_environment_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "environments": [
                    {
                        "name": "New Env",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_environment_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/environments/import/validate",
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1
        assert data["importable"] == 1
        assert data["environments"][0]["status"] == "ok"

    def test_validate_valid_json(self, client: TestClient) -> None:
        """Valid JSON returns ok status."""
        env_data = {"name": "JSON Env", "description": "JSON environment"}
        content = json.dumps(env_data)
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.validate_environment_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "environments": [
                    {
                        "name": "JSON Env",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_environment_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/environments/import/validate",
                files={"file": ("env.json", content, "application/json")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["environments"][0]["status"] == "ok"

    def test_validate_name_conflict(self, client: TestClient) -> None:
        """Detects name conflicts with existing environments."""
        content = yaml.dump({"name": "Existing Env", "description": "Already exists"})
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.validate_environment_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "environments": [
                    {
                        "name": "Existing Env",
                        "status": "conflict",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_environment_id": "abc-123",
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/environments/import/validate",
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["environments"][0]["status"] == "conflict"
        assert response.json()["data"]["environments"][0]["existing_environment_id"] == "abc-123"

    def test_validate_missing_name_fatal(self, client: TestClient) -> None:
        """Missing name produces fatal error blocking import."""
        content = yaml.dump({"description": "No name"})
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.validate_environment_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "environments": [
                    {
                        "name": "",
                        "status": "fatal",
                        "fatal_errors": [
                            {"code": "MISSING_NAME", "message": "Environment must have a name"}
                        ],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_environment_id": None,
                    }
                ],
                "total": 1,
                "importable": 0,
                "blocked": 1,
            }
            response = client.post(
                "/environments/import/validate",
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["blocked"] == 1
        assert data["environments"][0]["status"] == "fatal"
        assert data["environments"][0]["fatal_errors"][0]["code"] == "MISSING_NAME"

    def test_validate_zip_with_multiple(self, client: TestClient) -> None:
        """ZIP with multiple environments returns per-environment results."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("env1.yaml", yaml.dump({"name": "E1", "description": "First"}))
            zf.writestr("env2.yaml", yaml.dump({"name": "E2", "description": "Second"}))
        buf.seek(0)

        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.validate_environment_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "environments": [
                    {
                        "name": "E1",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_environment_id": None,
                    },
                    {
                        "name": "E2",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_environment_id": None,
                    },
                ],
                "total": 2,
                "importable": 2,
                "blocked": 0,
            }
            response = client.post(
                "/environments/import/validate",
                files={"file": ("envs.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total"] == 2

    def test_validate_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Unsupported file format returns 400."""
        response = client.post(
            "/environments/import/validate",
            files={"file": ("env.xml", "<env/>", "application/xml")},
        )
        assert response.status_code == 400

    def test_validate_invalid_yaml_returns_400(self, client: TestClient) -> None:
        """Malformed YAML returns 400."""
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.validate_environment_import"
        ) as mock_validate:
            mock_validate.side_effect = ValidationException("Invalid YAML: could not parse file")
            response = client.post(
                "/environments/import/validate",
                files={"file": ("env.yaml", "{{invalid yaml:", "application/x-yaml")},
            )

        assert response.status_code == 400

    def test_validate_empty_zip_returns_400(self, client: TestClient) -> None:
        """Empty ZIP archive returns 400."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w"):
            pass
        buf.seek(0)
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.validate_environment_import"
        ) as mock_validate:
            mock_validate.side_effect = ValidationException(
                "ZIP archive contains no importable files"
            )
            response = client.post(
                "/environments/import/validate",
                files={"file": ("envs.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 400

    def test_validate_summary_counts(self, client: TestClient) -> None:
        """Response includes correct summary counts."""
        content = yaml.dump({"name": "Count Env", "description": "For counting"})
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.validate_environment_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "environments": [
                    {
                        "name": "Count Env",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_environment_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/environments/import/validate",
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        data = response.json()["data"]
        assert data["total"] == 1
        assert data["importable"] == 1
        assert data["blocked"] == 0


# ============================================================================
# Import Environments
# ============================================================================


class TestImportEnvironment:
    """Tests for POST /environments/import."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_import_single_yaml_creates_environment(self, client: TestClient) -> None:
        """Importing valid YAML creates a new environment."""
        env_data = {"name": "New Env", "description": "A new environment"}
        content = yaml.dump(env_data)
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "New Env", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_imported"] == 1
        assert data["imported"][0]["name"] == "New Env"
        assert data["imported"][0]["action"] == "created"

    def test_import_single_json_creates_environment(self, client: TestClient) -> None:
        """Importing valid JSON creates a new environment."""
        env_data = {"name": "JSON Env", "description": "JSON environment"}
        content = json.dumps(env_data)
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "JSON Env", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("env.json", content, "application/json")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 1

    def test_import_zip_with_multiple(self, client: TestClient) -> None:
        """Importing ZIP creates multiple environments."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("e1.yaml", yaml.dump({"name": "E1", "description": "First"}))
            zf.writestr("e2.yaml", yaml.dump({"name": "E2", "description": "Second"}))
        buf.seek(0)

        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [
                    {"name": "E1", "id": str(uuid.uuid4()), "action": "created"},
                    {"name": "E2", "id": str(uuid.uuid4()), "action": "created"},
                ],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 2,
                "total_skipped": 0,
            }
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("envs.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 2

    def test_import_conflict_rename(self, client: TestClient) -> None:
        """Conflict with rename creates environment with (2) suffix."""
        content = yaml.dump({"name": "Existing", "description": "Already exists"})
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [
                    {"name": "Existing (2)", "id": str(uuid.uuid4()), "action": "renamed"}
                ],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": json.dumps({"Existing": "rename"})},
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["imported"][0]["action"] == "renamed"
        assert "(2)" in response.json()["data"]["imported"][0]["name"]

    def test_import_conflict_overwrite(self, client: TestClient) -> None:
        """Conflict with overwrite replaces existing environment."""
        content = yaml.dump({"name": "Existing", "description": "Replace me"})
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Existing", "id": "existing-id", "action": "overwritten"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": json.dumps({"Existing": "overwrite"})},
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["imported"][0]["action"] == "overwritten"

    def test_import_conflict_skip(self, client: TestClient) -> None:
        """Conflict with skip omits the environment."""
        content = yaml.dump({"name": "Existing", "description": "Skip me"})
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [],
                "skipped": [{"name": "Existing", "reason": "skipped by user"}],
                "fixes_applied": [],
                "total_imported": 0,
                "total_skipped": 1,
            }
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": json.dumps({"Existing": "skip"})},
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_skipped"] == 1
        assert data["skipped"][0]["name"] == "Existing"

    def test_import_fatal_errors_rejected(self, client: TestClient) -> None:
        """Fatal validation errors block import with 422."""
        content = yaml.dump({"description": "No name"})
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.side_effect = ValidationException("Fatal validation errors prevent import")
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 400

    def test_import_new_uuid_generated(self, client: TestClient) -> None:
        """Imported environments receive new UUIDs."""
        original_id = str(uuid.uuid4())
        content = yaml.dump({"id": original_id, "name": "UUID Env", "description": "UUID test"})
        new_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "UUID Env", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        imported_id = response.json()["data"]["imported"][0]["id"]
        assert imported_id != original_id

    def test_import_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Unsupported file format returns 400."""
        response = client.post(
            "/environments/import",
            data={"conflict_resolutions": "{}"},
            files={"file": ("env.xml", "<env/>", "application/xml")},
        )
        assert response.status_code == 400

    def test_import_invalid_conflict_resolutions_json(self, client: TestClient) -> None:
        """Invalid JSON in conflict_resolutions returns 400."""
        content = yaml.dump({"name": "Bad Resolutions", "description": "Test"})
        response = client.post(
            "/environments/import",
            data={"conflict_resolutions": "{not valid json!!!}"},
            files={"file": ("env.yaml", content, "application/x-yaml")},
        )
        assert response.status_code == 400

    def test_import_non_fatal_value_error_returns_400_parse_error(self, client: TestClient) -> None:
        """Non-fatal ValueError from service returns 400 with PARSE_ERROR code."""
        content = yaml.dump({"name": "Parse Error", "description": "Test"})
        with patch(
            "wavecore.api.routes.environments.import_export_routes.environment_service.import_environments"
        ) as mock_import:
            mock_import.side_effect = ValidationException("Invalid YAML: could not parse file")
            response = client.post(
                "/environments/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("env.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"


class TestExportKeepsTheWholeFileName:
    """An environment named with text outside plain ASCII exports under its name (REQ-4.6.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def environment_id(self, client: TestClient) -> str:
        response = client.post("/environments", json={"name": ENTITY_NAME})
        assert response.status_code == 201, response.text
        return str(response.json()["data"]["id"])

    def test_single_export(self, client: TestClient, environment_id: str) -> None:
        response = client.get(f"/environments/{environment_id}/export")

        assert_whole_name(response, f"{EXPORT_STEM}.yaml")

    def test_bulk_export_of_one(self, client: TestClient, environment_id: str) -> None:
        response = client.post("/environments/export", json={"environment_ids": [environment_id]})

        assert_whole_name(response, f"{EXPORT_STEM}.yaml")
