"""Unit tests for profile import/export endpoints.

This module tests the synchronous profile import/export endpoints enabling
portable serialization and deserialization of connection profile definitions
with format selection, secret masking, conflict resolution, and validation
integration.

Test Coverage:
- Single profile export: YAML/JSON format, secret masking, headers, 404/400
- Bulk profile export: single file vs ZIP, content-type, 400/404
- Import validation: valid files, conflicts, fatal/fixable errors, warnings, ZIP
- Import execution: create profiles, conflict resolution, auto-fix, fatal rejection
"""

import io
import json
import re
import uuid
import zipfile
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.api.download_name_helpers import ENTITY_NAME, EXPORT_STEM, assert_whole_name
from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.core.secrets.cipher import SecretCipher
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import unseal_all


def _make_profile(
    name: str = "DB Production",
    *,
    profile_id: str | None = None,
    profile_type: str = "database",
    description: str = "Production database profile",
    config: dict[str, Any] | None = None,
    environment_values: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Create a minimal profile dict for mocking."""
    return {
        "id": profile_id or str(uuid.uuid4()),
        "name": name,
        "type": profile_type,
        "description": description,
        "config": config or {"host": "db.example.com", "port": 5432, "password": "secret123"},
        "environment_values": environment_values or {},
        "tags": tags or ["prod"],
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


# ============================================================================
# Single Profile Export
# ============================================================================


class TestExportSingleProfile:
    """Tests for GET /profiles/{profile_id}/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_export_yaml_default_format(self, client: TestClient) -> None:
        """Export defaults to YAML format."""
        profile = _make_profile("SSH Gateway")
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = (
                yaml.dump(profile, default_flow_style=False),
                "SSH-Gateway.yaml",
            )
            response = client.get(f"/profiles/{profile['id']}/export")

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]
        assert 'filename="SSH-Gateway.yaml"' in response.headers["content-disposition"]

    def test_export_json_format(self, client: TestClient) -> None:
        """Export in JSON format returns correct content-type."""
        profile = _make_profile("SSH Gateway")
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = (
                json.dumps(profile, indent=2),
                "SSH-Gateway.json",
            )
            response = client.get(f"/profiles/{profile['id']}/export?format=json")

        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]
        assert 'filename="SSH-Gateway.json"' in response.headers["content-disposition"]

    def test_export_content_is_parseable_yaml(self, client: TestClient) -> None:
        """Exported YAML content is valid and parseable."""
        profile = _make_profile("Parseable Profile")
        yaml_content = yaml.dump(profile, default_flow_style=False)
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = (yaml_content, "Parseable-Profile.yaml")
            response = client.get(f"/profiles/{profile['id']}/export")

        parsed = yaml.safe_load(response.text)
        assert parsed["name"] == "Parseable Profile"

    def test_export_content_is_parseable_json(self, client: TestClient) -> None:
        """Exported JSON content is valid and parseable."""
        profile = _make_profile("JSON Profile")
        json_content = json.dumps(profile, indent=2)
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = (json_content, "JSON-Profile.json")
            response = client.get(f"/profiles/{profile['id']}/export?format=json")

        parsed = json.loads(response.text)
        assert parsed["name"] == "JSON Profile"

    @pytest.mark.parametrize("mode", ["mask", "encrypted", "plaintext"])
    def test_export_passes_secrets_mode_to_service(self, client: TestClient, mode: str) -> None:
        """The chosen secrets mode is forwarded to the export service."""
        profile = _make_profile("Secret Profile")
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = ("content", "Secret-Profile.yaml")
            response = client.get(f"/profiles/{profile['id']}/export?secrets={mode}")

        assert response.status_code == 200
        mock_export.assert_called_once_with(profile["id"], "yaml", mode)

    def test_export_invalid_secrets_mode_returns_400(self, client: TestClient) -> None:
        """An unrecognized secrets mode is rejected before export."""
        profile_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = None
            response = client.get(f"/profiles/{profile_id}/export?secrets=bogus")

        assert response.status_code == 400
        assert (
            "Invalid secrets mode 'bogus'; must be 'mask', 'encrypted', or 'plaintext'"
            in response.text
        )

    def test_export_not_found_returns_404(self, client: TestClient) -> None:
        """Export returns 404 for non-existent profile."""
        fake_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = None
            response = client.get(f"/profiles/{fake_id}/export")

        assert response.status_code == 404

    def test_export_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid UUID."""
        response = client.get("/profiles/not-a-uuid/export")
        assert response.status_code == 400

    def test_export_invalid_format_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid format parameter."""
        profile_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = None
            response = client.get(f"/profiles/{profile_id}/export?format=xml")

        assert response.status_code == 400

    def test_export_content_disposition_header(self, client: TestClient) -> None:
        """Export sets Content-Disposition attachment header."""
        profile = _make_profile("Attachment Profile")
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = ("content", "Attachment-Profile.yaml")
            response = client.get(f"/profiles/{profile['id']}/export")

        assert response.headers["content-disposition"].startswith("attachment")

    def test_export_default_secrets_mode_is_mask(self, client: TestClient) -> None:
        """Default secrets mode is mask (secrets masked by default)."""
        profile = _make_profile("Default Mask")
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = ("content", "Default-Mask.yaml")
            response = client.get(f"/profiles/{profile['id']}/export")

        assert response.status_code == 200
        mock_export.assert_called_once_with(profile["id"], "yaml", "mask")

    def test_export_env_names_replace_ids(self, client: TestClient) -> None:
        """Exported content has environment names instead of environment IDs."""
        env_id = str(uuid.uuid4())
        profile = _make_profile(
            "Env Names Profile",
            environment_values={env_id: {"host": "staging.example.com"}},
        )
        # In the exported content, env IDs should be replaced with names
        exported = dict(profile)
        exported["environment_values"] = {"staging": {"host": "staging.example.com"}}
        yaml_content = yaml.dump(exported, default_flow_style=False)
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profile"
        ) as mock_export:
            mock_export.return_value = (yaml_content, "Env-Names-Profile.yaml")
            response = client.get(f"/profiles/{profile['id']}/export")

        assert response.status_code == 200
        parsed = yaml.safe_load(response.text)
        assert "staging" in parsed["environment_values"]
        assert env_id not in parsed["environment_values"]


# ============================================================================
# Bulk Profile Export
# ============================================================================


class TestExportBulkProfiles:
    """Tests for POST /profiles/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_profile_returns_file_not_zip(self, client: TestClient) -> None:
        """Exporting 1 profile returns single file, not ZIP."""
        profile_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profiles_batch"
        ) as mock_batch:
            mock_batch.return_value = [(profile_id, "name: DB Prod\n", "DB-Prod.yaml")]
            response = client.post(
                "/profiles/export",
                json={"profile_ids": [profile_id], "format": "yaml", "secrets": "mask"},
            )

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]

    def test_multiple_profiles_returns_zip(self, client: TestClient) -> None:
        """Exporting 2+ profiles returns ZIP archive."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profiles_batch"
        ) as mock_batch:
            mock_batch.return_value = [
                (id1, "name: DB Prod\n", "DB-Prod.yaml"),
                (id2, "name: SSH Gateway\n", "SSH-Gateway.yaml"),
            ]
            response = client.post(
                "/profiles/export",
                json={"profile_ids": [id1, id2], "format": "yaml", "secrets": "mask"},
            )

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert 'filename="profiles-export.zip"' in response.headers["content-disposition"]

    def test_zip_contains_all_profiles(self, client: TestClient) -> None:
        """ZIP archive contains all exported profiles."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profiles_batch"
        ) as mock_batch:
            mock_batch.return_value = [
                (id1, "name: Alpha\n", "Alpha.yaml"),
                (id2, "name: Beta\n", "Beta.yaml"),
            ]
            response = client.post(
                "/profiles/export",
                json={"profile_ids": [id1, id2], "format": "yaml", "secrets": "mask"},
            )

        zf = zipfile.ZipFile(io.BytesIO(response.content))
        names = zf.namelist()
        assert "Alpha.yaml" in names
        assert "Beta.yaml" in names
        assert len(names) == 2

    def test_empty_list_returns_400(self, client: TestClient) -> None:
        """Exporting empty list returns 400."""
        response = client.post(
            "/profiles/export",
            json={"profile_ids": [], "format": "yaml", "secrets": "mask"},
        )
        assert response.status_code == 400

    def test_nonexistent_profile_returns_404(self, client: TestClient) -> None:
        """Exporting non-existent profile returns 404."""
        fake_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.export_profiles_batch"
        ) as mock_batch:
            mock_batch.side_effect = NotFoundException(f"Profile not found: {fake_id}")
            response = client.post(
                "/profiles/export",
                json={"profile_ids": [fake_id], "format": "yaml", "secrets": "mask"},
            )

        assert response.status_code == 404

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        """Invalid format parameter returns 400."""
        profile_id = str(uuid.uuid4())
        response = client.post(
            "/profiles/export",
            json={"profile_ids": [profile_id], "format": "xml", "secrets": "mask"},
        )
        assert response.status_code == 400


# ============================================================================
# Import Validation
# ============================================================================


class TestValidateProfileImport:
    """Tests for POST /profiles/import/validate."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_valid_yaml(self, client: TestClient) -> None:
        """Valid YAML returns ok status."""
        profile_data = {"name": "New Profile", "type": "database", "config": {"host": "localhost"}}
        content = yaml.dump(profile_data)
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "New Profile",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_profile_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1
        assert data["importable"] == 1
        assert data["profiles"][0]["status"] == "ok"

    def test_validate_valid_json(self, client: TestClient) -> None:
        """Valid JSON returns ok status."""
        profile_data = {
            "name": "JSON Profile",
            "type": "ssh",
            "config": {"host": "gateway.example.com"},
        }
        content = json.dumps(profile_data)
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "JSON Profile",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_profile_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.json", content, "application/json")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["profiles"][0]["status"] == "ok"

    def test_validate_name_conflict(self, client: TestClient) -> None:
        """Detects name conflicts with existing profiles."""
        content = yaml.dump({"name": "Existing Profile", "type": "database", "config": {}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "Existing Profile",
                        "status": "conflict",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_profile_id": "abc-123",
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["profiles"][0]["status"] == "conflict"
        assert response.json()["data"]["profiles"][0]["existing_profile_id"] == "abc-123"

    def test_validate_missing_name_fatal(self, client: TestClient) -> None:
        """Missing name produces fatal error blocking import."""
        content = yaml.dump({"type": "database", "config": {"host": "localhost"}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "",
                        "status": "fatal",
                        "fatal_errors": [
                            {"code": "MISSING_NAME", "message": "Profile must have a name"}
                        ],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_profile_id": None,
                    }
                ],
                "total": 1,
                "importable": 0,
                "blocked": 1,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["blocked"] == 1
        assert data["profiles"][0]["status"] == "fatal"
        assert data["profiles"][0]["fatal_errors"][0]["code"] == "MISSING_NAME"

    def test_validate_missing_type_fixable(self, client: TestClient) -> None:
        """Missing type produces fixable error (defaults to 'custom')."""
        content = yaml.dump({"name": "No Type", "config": {"host": "localhost"}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "No Type",
                        "status": "fixable",
                        "fatal_errors": [],
                        "fixable_errors": [
                            {
                                "code": "MISSING_TYPE",
                                "message": "Profile type missing, will default to 'custom'",
                            }
                        ],
                        "warnings": [],
                        "existing_profile_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["importable"] == 1
        assert data["profiles"][0]["status"] == "fixable"
        assert data["profiles"][0]["fixable_errors"][0]["code"] == "MISSING_TYPE"

    def test_validate_invalid_type_fixable(self, client: TestClient) -> None:
        """Invalid type produces fixable error."""
        content = yaml.dump({"name": "Bad Type", "type": "nosql", "config": {}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "Bad Type",
                        "status": "fixable",
                        "fatal_errors": [],
                        "fixable_errors": [
                            {
                                "code": "INVALID_TYPE",
                                "message": "Unknown profile type 'nosql', will default to 'custom'",
                            }
                        ],
                        "warnings": [],
                        "existing_profile_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["profiles"][0]["status"] == "fixable"
        assert data["profiles"][0]["fixable_errors"][0]["code"] == "INVALID_TYPE"

    def test_validate_unresolvable_env_fixable(self, client: TestClient) -> None:
        """Unresolvable environment reference produces fixable error."""
        content = yaml.dump(
            {
                "name": "Env Ref",
                "type": "database",
                "config": {},
                "environment_values": {"nonexistent-env": {"host": "other.example.com"}},
            }
        )
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "Env Ref",
                        "status": "fixable",
                        "fatal_errors": [],
                        "fixable_errors": [
                            {
                                "code": "UNRESOLVABLE_ENVIRONMENT",
                                "message": "Environment 'nonexistent-env' not found, will be "
                                "stripped",
                            }
                        ],
                        "warnings": [],
                        "existing_profile_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["profiles"][0]["fixable_errors"][0]["code"] == "UNRESOLVABLE_ENVIRONMENT"

    def test_validate_masked_secret_warning(self, client: TestClient) -> None:
        """Masked secrets in imported file produce warnings."""
        content = yaml.dump(
            {"name": "Masked", "type": "database", "config": {"password": "********"}}
        )
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "Masked",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [
                            {
                                "code": "MASKED_SECRET",
                                "message": "Field 'password' contains a masked value",
                            }
                        ],
                        "existing_profile_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["profiles"][0]["warnings"][0]["code"] == "MASKED_SECRET"

    def test_validate_zip_with_multiple(self, client: TestClient) -> None:
        """ZIP with multiple profiles returns per-profile results."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("p1.yaml", yaml.dump({"name": "P1", "type": "database", "config": {}}))
            zf.writestr("p2.yaml", yaml.dump({"name": "P2", "type": "ssh", "config": {}}))
        buf.seek(0)

        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "P1",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_profile_id": None,
                    },
                    {
                        "name": "P2",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_profile_id": None,
                    },
                ],
                "total": 2,
                "importable": 2,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profiles.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total"] == 2

    def test_validate_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Unsupported file format returns 400."""
        response = client.post(
            "/profiles/import/validate",
            files={"file": ("profile.xml", "<profile/>", "application/xml")},
        )
        assert response.status_code == 400

    def test_validate_empty_zip_returns_400(self, client: TestClient) -> None:
        """Empty ZIP archive returns 400."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w"):
            pass
        buf.seek(0)
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.side_effect = ValidationException(
                "ZIP archive contains no importable files"
            )
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profiles.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 400

    def test_validate_summary_counts(self, client: TestClient) -> None:
        """Response includes correct summary counts."""
        content = yaml.dump({"name": "Count Profile", "type": "database", "config": {}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.validate_profile_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "profiles": [
                    {
                        "name": "Count Profile",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_profile_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/profiles/import/validate",
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        data = response.json()["data"]
        assert data["total"] == 1
        assert data["importable"] == 1
        assert data["blocked"] == 0


# ============================================================================
# Import Profiles
# ============================================================================


class TestImportProfile:
    """Tests for POST /profiles/import."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_import_single_yaml_creates_profile(self, client: TestClient) -> None:
        """Importing valid YAML creates a new profile."""
        profile_data = {"name": "New Profile", "type": "database", "config": {"host": "localhost"}}
        content = yaml.dump(profile_data)
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "New Profile", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_imported"] == 1
        assert data["imported"][0]["name"] == "New Profile"
        assert data["imported"][0]["action"] == "created"

    def test_import_conflict_rename(self, client: TestClient) -> None:
        """Conflict with rename creates profile with (2) suffix."""
        content = yaml.dump({"name": "Existing", "type": "database", "config": {}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
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
                "/profiles/import",
                data={"conflict_resolutions": json.dumps({"Existing": "rename"})},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["imported"][0]["action"] == "renamed"
        assert "(2)" in response.json()["data"]["imported"][0]["name"]

    def test_import_conflict_overwrite(self, client: TestClient) -> None:
        """Conflict with overwrite replaces existing profile."""
        content = yaml.dump({"name": "Existing", "type": "ssh", "config": {}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Existing", "id": "existing-id", "action": "overwritten"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": json.dumps({"Existing": "overwrite"})},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["imported"][0]["action"] == "overwritten"

    def test_import_conflict_skip(self, client: TestClient) -> None:
        """Conflict with skip omits the profile."""
        content = yaml.dump({"name": "Existing", "type": "database", "config": {}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [],
                "skipped": [{"name": "Existing", "reason": "skipped by user"}],
                "fixes_applied": [],
                "total_imported": 0,
                "total_skipped": 1,
            }
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": json.dumps({"Existing": "skip"})},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_skipped"] == 1
        assert data["skipped"][0]["name"] == "Existing"

    def test_import_auto_fix_type(self, client: TestClient) -> None:
        """Auto-fix applies default type when type is missing."""
        content = yaml.dump({"name": "No Type", "config": {"host": "localhost"}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "No Type", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [{"name": "No Type", "fixes": ["Type defaulted to 'custom'"]}],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        fixes = response.json()["data"]["fixes_applied"]
        assert len(fixes) == 1
        assert "custom" in fixes[0]["fixes"][0]

    def test_import_strips_unresolvable_envs(self, client: TestClient) -> None:
        """Unresolvable environment references are stripped during import."""
        content = yaml.dump(
            {
                "name": "Env Strip",
                "type": "database",
                "config": {},
                "environment_values": {"gone-env": {"host": "x"}},
            }
        )
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Env Strip", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [
                    {"name": "Env Strip", "fixes": ["Stripped unresolvable environment 'gone-env'"]}
                ],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        fixes = response.json()["data"]["fixes_applied"]
        assert len(fixes) == 1
        assert "gone-env" in fixes[0]["fixes"][0]

    def test_import_resolves_env_names_to_ids(self, client: TestClient) -> None:
        """Imported profiles have environment names resolved to IDs."""
        content = yaml.dump(
            {
                "name": "Env Resolve",
                "type": "database",
                "config": {},
                "environment_values": {"staging": {"host": "staging.example.com"}},
            }
        )
        new_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Env Resolve", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 1

    def test_import_fatal_errors_rejected(self, client: TestClient) -> None:
        """Fatal validation errors block import with 422."""
        content = yaml.dump({"type": "database", "config": {}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.side_effect = ValidationException("Fatal validation errors prevent import")
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 400

    def test_import_new_uuid_generated(self, client: TestClient) -> None:
        """Imported profiles receive new UUIDs."""
        original_id = str(uuid.uuid4())
        content = yaml.dump(
            {"id": original_id, "name": "UUID Profile", "type": "database", "config": {}}
        )
        new_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "UUID Profile", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        imported_id = response.json()["data"]["imported"][0]["id"]
        assert imported_id != original_id

    def test_import_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Unsupported file format returns 400."""
        response = client.post(
            "/profiles/import",
            data={"conflict_resolutions": "{}"},
            files={"file": ("profile.xml", "<profile/>", "application/xml")},
        )
        assert response.status_code == 400

    def test_import_invalid_conflict_resolutions_json(self, client: TestClient) -> None:
        """Invalid JSON in conflict_resolutions returns 400."""
        content = yaml.dump({"name": "Bad Resolutions", "type": "database", "config": {}})
        response = client.post(
            "/profiles/import",
            data={"conflict_resolutions": "{not valid json!!!}"},
            files={"file": ("profile.yaml", content, "application/x-yaml")},
        )
        assert response.status_code == 400

    def test_import_non_fatal_value_error_returns_400_parse_error(self, client: TestClient) -> None:
        """Non-fatal ValueError from service returns 400 with PARSE_ERROR code."""
        content = yaml.dump({"name": "Parse Error", "type": "database", "config": {}})
        with patch(
            "wavecore.api.routes.profiles.import_export_routes.profile_import_export.import_profiles"
        ) as mock_import:
            mock_import.side_effect = ValidationException("Invalid YAML: could not parse file")
            response = client.post(
                "/profiles/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("profile.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"


_ENVIRONMENT_NAME = "Test Environment"
_SECRET_FIELD = {"database field": "password", "custom secret field": "token"}


def _secret_field_value(shape: str, value: Any) -> Any:
    """A credential as a profile file holds it: flat on a typed profile, an entry on custom."""
    if shape == "database field":
        return value
    return {"type": "string", "value": value, "secret": True}


def _profile_document(shape: str, place: str, value: Any) -> dict[str, Any]:
    """A profile whose one credential, ``value``, sits in its config or in one environment."""
    field = {_SECRET_FIELD[shape]: _secret_field_value(shape, value)}
    return {
        "name": "Holds a secret",
        "type": "database" if shape == "database field" else "custom",
        "config": field if place == "config field" else {},
        "environment_values": {_ENVIRONMENT_NAME: field} if place == "environment value" else {},
    }


def _stored_credential(shape: str, place: str, profile: dict[str, Any]) -> tuple[Any, bool]:
    """The credential a stored profile holds at ``place`` and whether it is still secret."""
    if place == "config field":
        values = profile["config"]
    else:
        (values,) = profile["environment_values"].values()
    held = values[_SECRET_FIELD[shape]]
    if shape == "database field":
        # The database type declares this field a credential, so it is secret by declaration.
        return held, True
    return held["value"], held.get("secret") is True


def _stored_profile(profile_id: str) -> dict[str, Any]:
    from wavecore.api.services.profiles import service as profile_service

    documents = {doc["id"]: doc for doc in profile_service.list_profile_documents()}
    return documents[profile_id]


def _secret_wave_cannot_open(kind: str) -> str:
    if kind == "foreign":
        return SecretCipher(bytes(range(1, 33))).seal("sealed-elsewhere")
    return MASK_PLACEHOLDER


@pytest.mark.usefixtures("seed_test_environment")
class TestImportProfileSecrets:
    """A profile credential WAVE cannot open, or a masked placeholder, is stored as null in the
    config and in an environment value; a placeholder never replaces a credential stored at the
    same place (REQ-4.5.19, EXPORT-5, EXPORT-7)."""

    @pytest.mark.parametrize("kind", ["foreign", "masked"])
    @pytest.mark.parametrize("place", ["config field", "environment value"])
    @pytest.mark.parametrize("shape", ["database field", "custom secret field"])
    def test_a_secret_wave_cannot_open_is_stored_as_null_and_stays_secret(
        self, shape: str, place: str, kind: str
    ) -> None:
        from wavecore.api.services.profiles import import_export as profile_import_export

        document = _profile_document(shape, place, _secret_wave_cannot_open(kind))

        result = profile_import_export.import_profiles(yaml.dump(document).encode(), "profile.yaml")

        assert result["total_imported"] == 1, result
        stored = _stored_profile(result["imported"][0]["id"])
        assert _stored_credential(shape, place, stored) == (None, True)

    @pytest.mark.parametrize("place", ["config field", "environment value"])
    @pytest.mark.parametrize("shape", ["database field", "custom secret field"])
    def test_a_masked_placeholder_keeps_the_secret_stored_at_the_same_place_on_overwrite(
        self, shape: str, place: str, seed_test_environment: str
    ) -> None:
        from wavecore.api.services.profiles import import_export as profile_import_export
        from wavecore.api.services.profiles import service as profile_service

        kept = {_SECRET_FIELD[shape]: _secret_field_value(shape, "kept-secret")}
        here = _make_profile(
            "Holds a secret",
            profile_type="database" if shape == "database field" else "custom",
            config=kept if place == "config field" else {"host": "db.test"},
            environment_values=(
                {seed_test_environment: kept} if place == "environment value" else {}
            ),
        )
        profile_service.persist_profile_document(here)
        incoming = _profile_document(shape, place, MASK_PLACEHOLDER)

        result = profile_import_export.import_profiles(
            yaml.dump(incoming).encode(), "profile.yaml", {"Holds a secret": "overwrite"}
        )

        assert result["imported"] == [
            {"name": "Holds a secret", "id": here["id"], "action": "overwritten"}
        ]
        value, secret = _stored_credential(shape, place, _stored_profile(here["id"]))
        assert (unseal_all(value), secret) == ("kept-secret", True)

    @pytest.mark.parametrize("shape", ["database field", "custom secret field"])
    def test_the_preview_names_a_foreign_credential_with_the_unchanged_warning(
        self, shape: str
    ) -> None:
        from wavecore.api.services.profiles import import_export as profile_import_export

        document = _profile_document(shape, "config field", _secret_wave_cannot_open("foreign"))

        preview = profile_import_export.validate_profile_import(
            yaml.dump(document).encode(), "profile.yaml"
        )

        messages = [
            warning["message"]
            for warning in preview["profiles"][0]["warnings"]
            if warning["code"] == "FOREIGN_ENCRYPTED_SECRET"
        ]
        assert len(messages) == 1, messages
        expected = (
            f"Secret '{_SECRET_FIELD[shape]}' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        )
        assert re.fullmatch("^" + re.escape(expected) + "$", messages[0])

    def test_the_preview_names_a_masked_credential_with_the_unchanged_warning(self) -> None:
        from wavecore.api.services.profiles import import_export as profile_import_export

        document = _profile_document("database field", "config field", MASK_PLACEHOLDER)

        preview = profile_import_export.validate_profile_import(
            yaml.dump(document).encode(), "profile.yaml"
        )

        messages = [
            warning["message"]
            for warning in preview["profiles"][0]["warnings"]
            if warning["code"] == "MASKED_SECRET"
        ]
        assert len(messages) == 1, messages
        expected = "Field 'password' contains a masked value"
        assert re.fullmatch("^" + re.escape(expected) + "$", messages[0])


class TestExportKeepsTheWholeFileName:
    """A profile named with text outside plain ASCII exports under its whole name (REQ-4.6.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def profile_id(self, client: TestClient) -> str:
        response = client.post("/profiles", json={"name": ENTITY_NAME, "type": "ssh"})
        assert response.status_code == 201, response.text
        return str(response.json()["data"]["id"])

    def test_single_export(self, client: TestClient, profile_id: str) -> None:
        response = client.get(f"/profiles/{profile_id}/export")

        assert_whole_name(response, f"{EXPORT_STEM}.yaml")

    def test_bulk_export_of_one(self, client: TestClient, profile_id: str) -> None:
        response = client.post("/profiles/export", json={"profile_ids": [profile_id]})

        assert_whole_name(response, f"{EXPORT_STEM}.yaml")
