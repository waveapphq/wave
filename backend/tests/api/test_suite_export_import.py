"""Unit tests for suite import/export endpoints.

This module tests the suite import/export endpoints enabling
portable serialization and deserialization of suite definitions
with format selection, secret masking, conflict resolution, and validation.

Test Coverage:
- Single suite export: YAML/JSON format, secret masking, headers, 404/400
- Bulk suite export: single file vs ZIP, content-type, 400/404
- Import validation: valid files, conflicts, fatal/fixable errors, warnings, ZIP
- Import execution: create suites, conflict resolution, test ID stripping, fatal rejection
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

from tests.api.download_name_helpers import EXPORT_STEM, assert_whole_name
from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.core.secrets.cipher import SecretCipher, is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import seal_variables, unseal_all

_DECRYPTION_FAILED_MESSAGE = (
    "Secret decryption failed: ciphertext is corrupt or the encryption key is invalid"
)


def _sealed_secret_variables() -> dict[str, Any]:
    """A variables dict with one locally-sealed secret and one plain variable."""
    return seal_variables(
        {
            "token": {"type": "string", "value": "real-token-classified", "secret": True},
            "host": {"type": "string", "value": "example.com"},
        }
    )


def _foreign_envelope(value: Any) -> str:
    """Seal a value under a key this instance does not hold (undecryptable here)."""
    return SecretCipher(bytes(range(1, 33))).seal(value)


def _make_suite(
    name: str = "Regression Suite",
    *,
    suite_id: str | None = None,
    description: str = "Test regression suite",
    tests: list[str] | None = None,
    variables: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Create a minimal suite dict for mocking."""
    return {
        "id": suite_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": description,
        "tests": tests or [],
        "variables": variables or {},
        "tags": tags or ["regression"],
        "metadata": {},
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


_ROUTE_PREFIX = "wavecore.api.routes.suites.import_export_routes.suite_import_export"


# ============================================================================
# Single Suite Export
# ============================================================================


class TestExportSingleSuite:
    """Tests for GET /suites/{suite_id}/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_export_yaml_default_format(self, client: TestClient) -> None:
        """Export defaults to YAML format."""
        suite = _make_suite("Smoke Tests")
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = (
                yaml.dump(suite, default_flow_style=False),
                "Smoke-Tests.yaml",
            )
            response = client.get(f"/suites/{suite['id']}/export")

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]
        assert 'filename="Smoke-Tests.yaml"' in response.headers["content-disposition"]

    def test_export_json_format(self, client: TestClient) -> None:
        """Export in JSON format returns correct content-type."""
        suite = _make_suite("Smoke Tests")
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = (
                json.dumps(suite, indent=2),
                "Smoke-Tests.json",
            )
            response = client.get(f"/suites/{suite['id']}/export?format=json")

        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]
        assert 'filename="Smoke-Tests.json"' in response.headers["content-disposition"]

    def test_export_content_is_parseable_yaml(self, client: TestClient) -> None:
        """Exported YAML content is valid and parseable."""
        suite = _make_suite("Parseable Suite")
        yaml_content = yaml.dump(suite, default_flow_style=False)
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = (yaml_content, "Parseable-Suite.yaml")
            response = client.get(f"/suites/{suite['id']}/export")

        parsed = yaml.safe_load(response.text)
        assert parsed["name"] == "Parseable Suite"

    def test_export_content_is_parseable_json(self, client: TestClient) -> None:
        """Exported JSON content is valid and parseable."""
        suite = _make_suite("JSON Suite")
        json_content = json.dumps(suite, indent=2)
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = (json_content, "JSON-Suite.json")
            response = client.get(f"/suites/{suite['id']}/export?format=json")

        parsed = json.loads(response.text)
        assert parsed["name"] == "JSON Suite"

    @pytest.mark.parametrize("mode", ["mask", "encrypted", "plaintext"])
    def test_export_passes_secrets_mode_to_service(self, client: TestClient, mode: str) -> None:
        """The chosen secrets mode is forwarded to the export service."""
        suite = _make_suite("Secret Suite")
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = ("content", "Secret-Suite.yaml")
            response = client.get(f"/suites/{suite['id']}/export?secrets={mode}")

        assert response.status_code == 200
        mock_export.assert_called_once_with(suite["id"], "yaml", mode)

    def test_export_invalid_secrets_mode_returns_400(self, client: TestClient) -> None:
        """An unrecognized secrets mode is rejected before export."""
        suite_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = None
            response = client.get(f"/suites/{suite_id}/export?secrets=bogus")

        assert response.status_code == 400
        assert (
            "Invalid secrets mode 'bogus'; must be 'mask', 'encrypted', or 'plaintext'"
            in response.text
        )

    def test_export_not_found_returns_404(self, client: TestClient) -> None:
        """Export returns 404 for non-existent suite."""
        fake_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = None
            response = client.get(f"/suites/{fake_id}/export")

        assert response.status_code == 404

    def test_export_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid UUID."""
        response = client.get("/suites/not-a-uuid/export")
        assert response.status_code == 400

    def test_export_invalid_format_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid format parameter."""
        suite_id = str(uuid.uuid4())
        response = client.get(f"/suites/{suite_id}/export?format=xml")
        assert response.status_code == 400

    def test_export_content_disposition_header(self, client: TestClient) -> None:
        """Export sets Content-Disposition attachment header."""
        suite = _make_suite("Attachment Suite")
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = ("content", "Attachment-Suite.yaml")
            response = client.get(f"/suites/{suite['id']}/export")

        assert response.headers["content-disposition"].startswith("attachment")

    def test_export_default_secrets_mode_is_mask(self, client: TestClient) -> None:
        """Default secrets mode is mask (secrets masked by default)."""
        suite = _make_suite("Default Mask")
        with patch(f"{_ROUTE_PREFIX}.export_suite") as mock_export:
            mock_export.return_value = ("content", "Default-Mask.yaml")
            response = client.get(f"/suites/{suite['id']}/export")

        assert response.status_code == 200
        mock_export.assert_called_once_with(suite["id"], "yaml", "mask")


# ============================================================================
# Bulk Suite Export
# ============================================================================


class TestExportBulkSuites:
    """Tests for POST /suites/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_suite_returns_file(self, client: TestClient) -> None:
        """Bulk export of 1 suite returns single file, not ZIP."""
        suite_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.export_suites_batch") as mock_batch:
            mock_batch.return_value = [(suite_id, "name: Test Suite\n", "Test-Suite.yaml")]
            response = client.post(
                "/suites/export",
                json={"suite_ids": [suite_id], "format": "yaml"},
            )

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]

    def test_multiple_suites_returns_zip(self, client: TestClient) -> None:
        """Bulk export of 2+ suites returns ZIP archive."""
        ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        with patch(f"{_ROUTE_PREFIX}.export_suites_batch") as mock_batch:
            mock_batch.return_value = [
                (ids[0], "name: Suite A\n", "Suite-A.yaml"),
                (ids[1], "name: Suite B\n", "Suite-B.yaml"),
            ]
            response = client.post(
                "/suites/export",
                json={"suite_ids": ids, "format": "yaml"},
            )

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert 'filename="suites-export.zip"' in response.headers["content-disposition"]

        zf = zipfile.ZipFile(io.BytesIO(response.content))
        assert len(zf.namelist()) == 2

    def test_json_format_returns_json_content_type(self, client: TestClient) -> None:
        """Bulk export in JSON format returns application/json."""
        suite_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.export_suites_batch") as mock_batch:
            mock_batch.return_value = [(suite_id, '{"name": "Test"}', "Test.json")]
            response = client.post(
                "/suites/export",
                json={"suite_ids": [suite_id], "format": "json"},
            )

        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]

    def test_empty_ids_returns_400(self, client: TestClient) -> None:
        """Bulk export with empty suite_ids returns 400."""
        response = client.post("/suites/export", json={"suite_ids": [], "format": "yaml"})
        assert response.status_code == 400

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        """Bulk export with invalid format returns 400."""
        response = client.post(
            "/suites/export",
            json={"suite_ids": [str(uuid.uuid4())], "format": "xml"},
        )
        assert response.status_code == 400

    def test_not_found_suite_returns_404(self, client: TestClient) -> None:
        """Bulk export raises 404 if any suite not found."""
        suite_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.export_suites_batch") as mock_batch:
            mock_batch.side_effect = NotFoundException(f"Suite not found: {suite_id}")
            response = client.post(
                "/suites/export",
                json={"suite_ids": [suite_id], "format": "yaml"},
            )

        assert response.status_code == 404


# ============================================================================
# Import Validation
# ============================================================================


class TestValidateSuiteImport:
    """Tests for POST /suites/import/validate."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_valid_single_file(self, client: TestClient) -> None:
        """Valid YAML file returns ok status."""
        with patch(f"{_ROUTE_PREFIX}.validate_suite_import") as mock_validate:
            mock_validate.return_value = {
                "suites": [
                    {
                        "name": "My Suite",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_suite_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/suites/import/validate",
                files={"file": ("suite.yaml", b"name: My Suite\n", "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total"] == 1
        assert data["data"]["importable"] == 1
        assert data["data"]["suites"][0]["status"] == "ok"

    def test_valid_zip_file(self, client: TestClient) -> None:
        """Valid ZIP file with multiple suites validates all."""
        with patch(f"{_ROUTE_PREFIX}.validate_suite_import") as mock_validate:
            mock_validate.return_value = {
                "suites": [
                    {
                        "name": "Suite A",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_suite_id": None,
                    },
                    {
                        "name": "Suite B",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_suite_id": None,
                    },
                ],
                "total": 2,
                "importable": 2,
                "blocked": 0,
            }
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as zf:
                zf.writestr("suite_a.yaml", "name: Suite A\n")
                zf.writestr("suite_b.yaml", "name: Suite B\n")
            buf.seek(0)
            response = client.post(
                "/suites/import/validate",
                files={"file": ("suites.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total"] == 2

    def test_missing_name_is_fatal(self, client: TestClient) -> None:
        """Suite without name returns fatal status."""
        with patch(f"{_ROUTE_PREFIX}.validate_suite_import") as mock_validate:
            mock_validate.return_value = {
                "suites": [
                    {
                        "name": "",
                        "status": "fatal",
                        "fatal_errors": [
                            {"code": "MISSING_NAME", "message": "Suite must have a name"}
                        ],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_suite_id": None,
                    }
                ],
                "total": 1,
                "importable": 0,
                "blocked": 1,
            }
            response = client.post(
                "/suites/import/validate",
                files={"file": ("suite.yaml", b"description: no name\n", "application/x-yaml")},
            )

        data = response.json()["data"]
        assert data["blocked"] == 1
        assert data["suites"][0]["status"] == "fatal"
        assert data["suites"][0]["fatal_errors"][0]["code"] == "MISSING_NAME"

    def test_name_conflict(self, client: TestClient) -> None:
        """Existing suite name results in conflict status."""
        existing_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.validate_suite_import") as mock_validate:
            mock_validate.return_value = {
                "suites": [
                    {
                        "name": "Existing Suite",
                        "status": "conflict",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_suite_id": existing_id,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/suites/import/validate",
                files={"file": ("suite.yaml", b"name: Existing Suite\n", "application/x-yaml")},
            )

        data = response.json()["data"]
        assert data["suites"][0]["status"] == "conflict"
        assert data["suites"][0]["existing_suite_id"] == existing_id

    def test_unresolvable_tests_fixable(self, client: TestClient) -> None:
        """Suite with non-existent test IDs returns fixable status."""
        with patch(f"{_ROUTE_PREFIX}.validate_suite_import") as mock_validate:
            mock_validate.return_value = {
                "suites": [
                    {
                        "name": "Bad Tests Suite",
                        "status": "fixable",
                        "fatal_errors": [],
                        "fixable_errors": [
                            {
                                "code": "UNRESOLVABLE_TEST",
                                "message": "Test 'abc123' not found, will be stripped",
                            }
                        ],
                        "warnings": [],
                        "existing_suite_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/suites/import/validate",
                files={
                    "file": (
                        "suite.yaml",
                        b"name: Bad Tests Suite\ntests:\n  - abc123\n",
                        "application/x-yaml",
                    )
                },
            )

        data = response.json()["data"]
        assert data["suites"][0]["status"] == "fixable"
        assert data["suites"][0]["fixable_errors"][0]["code"] == "UNRESOLVABLE_TEST"

    def test_masked_secrets_warning(self, client: TestClient) -> None:
        """Suite with masked variable values returns warning."""
        with patch(f"{_ROUTE_PREFIX}.validate_suite_import") as mock_validate:
            mock_validate.return_value = {
                "suites": [
                    {
                        "name": "Masked Suite",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [
                            {
                                "code": "MASKED_SECRET",
                                "message": "Variable 'api_key' contains a masked value",
                            }
                        ],
                        "existing_suite_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/suites/import/validate",
                files={"file": ("suite.yaml", b"name: Masked Suite\n", "application/x-yaml")},
            )

        data = response.json()["data"]
        assert data["suites"][0]["warnings"][0]["code"] == "MASKED_SECRET"

    def test_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Unsupported file format returns 400."""
        response = client.post(
            "/suites/import/validate",
            files={"file": ("suite.txt", b"name: Test\n", "text/plain")},
        )
        assert response.status_code == 400


# ============================================================================
# Import Execution
# ============================================================================


class TestImportSuites:
    """Tests for POST /suites/import."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_import_creates_new_suite(self, client: TestClient) -> None:
        """Importing a valid suite creates it successfully."""
        new_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.import_suites") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "New Suite", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/suites/import",
                files={"file": ("suite.yaml", b"name: New Suite\n", "application/x-yaml")},
                data={"conflict_resolutions": ""},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_imported"] == 1
        assert data["imported"][0]["name"] == "New Suite"
        assert data["imported"][0]["action"] == "created"

    def test_import_skip_conflict(self, client: TestClient) -> None:
        """Import with skip resolution skips conflicting suite."""
        with patch(f"{_ROUTE_PREFIX}.import_suites") as mock_import:
            mock_import.return_value = {
                "imported": [],
                "skipped": [{"name": "Existing Suite", "reason": "skipped by user"}],
                "fixes_applied": [],
                "total_imported": 0,
                "total_skipped": 1,
            }
            response = client.post(
                "/suites/import",
                files={"file": ("suite.yaml", b"name: Existing Suite\n", "application/x-yaml")},
                data={"conflict_resolutions": json.dumps({"Existing Suite": "skip"})},
            )

        data = response.json()["data"]
        assert data["total_skipped"] == 1
        assert data["skipped"][0]["reason"] == "skipped by user"

    def test_import_overwrite_conflict(self, client: TestClient) -> None:
        """Import with overwrite replaces existing suite."""
        existing_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.import_suites") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Suite X", "id": existing_id, "action": "overwritten"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/suites/import",
                files={"file": ("suite.yaml", b"name: Suite X\n", "application/x-yaml")},
                data={"conflict_resolutions": json.dumps({"Suite X": "overwrite"})},
            )

        data = response.json()["data"]
        assert data["imported"][0]["action"] == "overwritten"

    def test_import_rename_conflict(self, client: TestClient) -> None:
        """Import with rename creates suite with new name."""
        new_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.import_suites") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Suite X (2)", "id": new_id, "action": "renamed"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/suites/import",
                files={"file": ("suite.yaml", b"name: Suite X\n", "application/x-yaml")},
                data={"conflict_resolutions": json.dumps({"Suite X": "rename"})},
            )

        data = response.json()["data"]
        assert data["imported"][0]["action"] == "renamed"
        assert data["imported"][0]["name"] == "Suite X (2)"

    def test_import_strips_invalid_test_ids(self, client: TestClient) -> None:
        """Import records fixes for stripped invalid test IDs."""
        new_id = str(uuid.uuid4())
        with patch(f"{_ROUTE_PREFIX}.import_suites") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Fixed Suite", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [
                    {"name": "Fixed Suite", "fixes": ["Stripped unresolvable test 'bad-id'"]}
                ],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/suites/import",
                files={
                    "file": (
                        "suite.yaml",
                        b"name: Fixed Suite\ntests:\n  - bad-id\n",
                        "application/x-yaml",
                    )
                },
                data={"conflict_resolutions": ""},
            )

        data = response.json()["data"]
        assert data["fixes_applied"][0]["fixes"][0] == "Stripped unresolvable test 'bad-id'"

    def test_import_fatal_raises_error(self, client: TestClient) -> None:
        """Import with fatal errors returns error response."""
        with patch(f"{_ROUTE_PREFIX}.import_suites") as mock_import:
            mock_import.side_effect = ValidationException("Fatal validation errors prevent import")
            response = client.post(
                "/suites/import",
                files={"file": ("suite.yaml", b"description: no name\n", "application/x-yaml")},
                data={"conflict_resolutions": ""},
            )

        assert response.status_code == 400

    def test_import_bad_conflict_resolutions_json(self, client: TestClient) -> None:
        """Import with invalid JSON in conflict_resolutions returns 400."""
        response = client.post(
            "/suites/import",
            files={"file": ("suite.yaml", b"name: Test\n", "application/x-yaml")},
            data={"conflict_resolutions": "not-json"},
        )
        assert response.status_code == 400

    def test_import_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Import with unsupported file format returns 400."""
        response = client.post(
            "/suites/import",
            files={"file": ("suite.txt", b"name: Test\n", "text/plain")},
            data={"conflict_resolutions": ""},
        )
        assert response.status_code == 400


# ============================================================================
# Service-level Tests
# ============================================================================


class TestExportSuiteService:
    """Tests for suite export service functions."""

    def test_export_suite_yaml(self) -> None:
        """export_suite returns YAML content and filename."""
        from wavecore.api.services.suites import import_export

        suite = _make_suite("Export Me")
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = suite
            result = import_export.export_suite(suite["id"], "yaml", "mask")

        assert result is not None
        content, filename = result
        assert filename == "Export-Me.yaml"
        parsed = yaml.safe_load(content)
        assert parsed["name"] == "Export Me"

    def test_export_suite_json(self) -> None:
        """export_suite returns JSON content and filename."""
        from wavecore.api.services.suites import import_export

        suite = _make_suite("JSON Export")
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = suite
            result = import_export.export_suite(suite["id"], "json", "mask")

        assert result is not None
        content, filename = result
        assert filename == "JSON-Export.json"
        parsed = json.loads(content)
        assert parsed["name"] == "JSON Export"

    def test_export_suite_mask_mode_replaces_secret_with_placeholder(self) -> None:
        from wavecore.api.services.suites import import_export

        suite = _make_suite("Secret Suite", variables=_sealed_secret_variables())
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = suite
            result = import_export.export_suite(suite["id"], "yaml", "mask")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["token"]["value"] == MASK_PLACEHOLDER
        assert parsed["variables"]["token"]["masked"] is True
        assert parsed["variables"]["host"]["value"] == "example.com"

    def test_export_suite_encrypted_mode_emits_sealed_envelope(self) -> None:
        from wavecore.api.services.suites import import_export

        variables = _sealed_secret_variables()
        suite = _make_suite("Secret Suite", variables=variables)
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = suite
            result = import_export.export_suite(suite["id"], "yaml", "encrypted")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["token"]["value"] == variables["token"]["value"]
        assert is_secret_envelope(parsed["variables"]["token"]["value"])

    def test_export_suite_plaintext_mode_decrypts_secret(self) -> None:
        from wavecore.api.services.suites import import_export

        suite = _make_suite("Secret Suite", variables=_sealed_secret_variables())
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = suite
            result = import_export.export_suite(suite["id"], "yaml", "plaintext")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["token"]["value"] == "real-token-classified"

    def test_export_suite_plaintext_undecryptable_raises_conflict(self) -> None:
        from wavecore.api.services.suites import import_export

        suite = _make_suite(
            "Foreign Suite",
            variables={
                "token": {"type": "string", "value": _foreign_envelope("x"), "secret": True}
            },
        )
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = suite
            with pytest.raises(ConflictException) as exc_info:
                import_export.export_suite(suite["id"], "yaml", "plaintext")

        assert str(exc_info.value) == _DECRYPTION_FAILED_MESSAGE

    def test_export_suite_not_found(self) -> None:
        """export_suite returns None for non-existent suite."""
        from wavecore.api.services.suites import import_export

        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = None
            result = import_export.export_suite("nonexistent", "yaml", "mask")

        assert result is None


class TestExportSuitesBatchService:
    """Tests for suite batch export service function."""

    def test_batch_single(self) -> None:
        """Batch export of 1 suite returns list of 1."""
        from wavecore.api.services.suites import import_export

        suite = _make_suite("Single")
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = suite
            results = import_export.export_suites_batch([suite["id"]], "yaml", False)

        assert len(results) == 1
        assert results[0][0] == suite["id"]

    def test_batch_multiple(self) -> None:
        """Batch export of multiple suites returns all."""
        from wavecore.api.services.suites import import_export

        suite_a = _make_suite("A")
        suite_b = _make_suite("B")
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.side_effect = [suite_a, suite_b]
            results = import_export.export_suites_batch(
                [suite_a["id"], suite_b["id"]], "yaml", False
            )

        assert len(results) == 2

    def test_batch_not_found_raises(self) -> None:
        """Batch export raises NotFoundException for missing suite."""
        from wavecore.api.services.suites import import_export

        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.return_value = None
            with pytest.raises(NotFoundException):
                import_export.export_suites_batch(["nonexistent"], "yaml", False)

    def test_batch_deduplicates_filenames(self) -> None:
        """Batch export deduplicates filenames when suites have the same name."""
        from wavecore.api.services.suites import import_export

        suite_a = _make_suite("Same Name", suite_id="id-a")
        suite_b = _make_suite("Same Name", suite_id="id-b")
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.side_effect = [suite_a, suite_b]
            results = import_export.export_suites_batch(["id-a", "id-b"], "yaml", False)

        filenames = [r[2] for r in results]
        assert filenames[0] == "Same-Name.yaml"
        assert filenames[1] == "Same-Name-2.yaml"


class TestValidateSuiteImportService:
    """Tests for suite import validation service function."""

    def test_valid_suite(self) -> None:
        """Valid suite returns ok status."""
        from wavecore.api.services.suites import import_export

        content = yaml.dump({"name": "Good Suite", "tests": []}).encode()
        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Good Suite", "tests": []}
            result = import_export.validate_suite_import(content, "suite.yaml")

        assert result["total"] == 1
        assert result["importable"] == 1
        assert result["suites"][0]["status"] == "ok"

    def test_missing_name_fatal(self) -> None:
        """Suite without name returns fatal."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"description": "no name"}
            result = import_export.validate_suite_import(b"x", "suite.yaml")

        assert result["blocked"] == 1
        assert result["suites"][0]["status"] == "fatal"
        assert result["suites"][0]["fatal_errors"][0]["code"] == "MISSING_NAME"

    def test_a_variable_value_that_breaks_the_number_rule_is_fatal(self) -> None:
        """REQ-3.1.3.14: the preview refuses the value the suite save refuses, in its words."""
        from wavecore.api.services.suites import import_export

        variables = {"port": {"type": "integer", "value": "80.5"}, "name": {"type": "string"}}
        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Numbers", "tests": [], "variables": variables}
            result = import_export.validate_suite_import(b"x", "suite.yaml")

        assert result["suites"][0]["status"] == "fatal"
        assert result["suites"][0]["fatal_errors"] == [
            {
                "code": "INVALID_VARIABLE_VALUE",
                "message": "Value for variable 'port' is not a valid integer",
            }
        ]

    def test_name_conflict(self) -> None:
        """Existing name returns conflict with existing_suite_id."""
        from wavecore.api.services.suites import import_export

        existing = _make_suite("Existing", suite_id="existing-id")
        with (
            patch(
                "wavecore.api.services.suites._storage._list_all_suites", return_value=[existing]
            ),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "tests": []}
            result = import_export.validate_suite_import(b"x", "suite.yaml")

        assert result["suites"][0]["status"] == "conflict"
        assert result["suites"][0]["existing_suite_id"] == "existing-id"

    def test_unresolvable_tests_fixable(self) -> None:
        """Non-existent test IDs produce fixable errors."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._test_exists", return_value=False),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Suite", "tests": ["bad-id"]}
            result = import_export.validate_suite_import(b"x", "suite.yaml")

        assert result["suites"][0]["status"] == "fixable"
        assert result["suites"][0]["fixable_errors"][0]["code"] == "UNRESOLVABLE_TEST"

    def test_masked_secrets_warning(self) -> None:
        """Masked variable values produce warnings but don't change status."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {
                "name": "Suite",
                "tests": [],
                "variables": {"token": {"type": "string", "value": "********", "secret": True}},
            }
            result = import_export.validate_suite_import(b"x", "suite.yaml")

        assert result["suites"][0]["status"] == "ok"
        assert result["suites"][0]["warnings"][0]["code"] == "MASKED_SECRET"

    def test_foreign_encrypted_secret_warning(self) -> None:
        """A foreign-instance envelope produces a FOREIGN_ENCRYPTED_SECRET warning."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {
                "name": "Suite",
                "tests": [],
                "variables": {
                    "token": {"type": "string", "value": _foreign_envelope("x"), "secret": True}
                },
            }
            result = import_export.validate_suite_import(b"x", "suite.yaml")

        assert result["suites"][0]["status"] == "ok"
        codes = {w["code"] for w in result["suites"][0]["warnings"]}
        assert "FOREIGN_ENCRYPTED_SECRET" in codes
        foreign = next(
            w for w in result["suites"][0]["warnings"] if w["code"] == "FOREIGN_ENCRYPTED_SECRET"
        )
        assert foreign["message"] == (
            "Secret 'token' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        )

    def test_zip_validates_all_items(self) -> None:
        """ZIP file validates all contained suites."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites.import_export.parse_zip_file") as mock_zip,
        ):
            mock_zip.return_value = [
                ("a.yaml", {"name": "A", "tests": []}),
                ("b.yaml", {"name": "B", "tests": []}),
            ]
            result = import_export.validate_suite_import(b"x", "suites.zip")

        assert result["total"] == 2
        assert result["importable"] == 2


class TestImportSuitesService:
    """Tests for suite import service function."""

    def test_create_new_suite(self) -> None:
        """Import creates a new suite."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._save_suite") as mock_save,
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch("wavecore.api.services.suites._storage._test_exists", return_value=True),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "New Suite", "tests": ["t1"], "tags": ["smoke"]}
            result = import_export.import_suites(b"x", "suite.yaml")

        assert result["total_imported"] == 1
        assert result["imported"][0]["name"] == "New Suite"
        assert result["imported"][0]["action"] == "created"
        mock_save.assert_called_once()
        saved = mock_save.call_args[0][0]
        assert saved["name"] == "New Suite"
        assert saved["tests"] == ["t1"]

    def test_a_variable_value_that_breaks_the_number_rule_is_refused(self) -> None:
        """REQ-3.1.3.14: nothing is written when an imported value breaks the number rule."""
        from wavecore.api.services.suites import import_export

        variables = {"n": {"type": "integer", "value": "12345678901234567890"}}
        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._save_suite") as mock_save,
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Numbers", "tests": [], "variables": variables}
            with pytest.raises(
                ValidationException,
                match="^Value for variable 'n' allows at most 19 digits, got 20$",
            ):
                import_export.import_suites(b"x", "suite.yaml")

        mock_save.assert_not_called()

    def test_skip_conflict(self) -> None:
        """Import skips conflicting suite when resolution is skip."""
        from wavecore.api.services.suites import import_export

        existing = _make_suite("Existing", suite_id="existing-id")
        with (
            patch(
                "wavecore.api.services.suites._storage._list_all_suites", return_value=[existing]
            ),
            patch("wavecore.api.services.suites._storage._save_suite"),
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "tests": []}
            result = import_export.import_suites(b"x", "suite.yaml", {"Existing": "skip"})

        assert result["total_skipped"] == 1
        assert result["total_imported"] == 0

    def test_overwrite_conflict(self) -> None:
        """Import overwrites existing suite when resolution is overwrite."""
        from wavecore.api.services.suites import import_export

        existing = _make_suite("Existing", suite_id="existing-id")
        with (
            patch(
                "wavecore.api.services.suites._storage._list_all_suites", return_value=[existing]
            ),
            patch("wavecore.api.services.suites._storage._save_suite") as mock_save,
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "tests": []}
            result = import_export.import_suites(b"x", "suite.yaml", {"Existing": "overwrite"})

        assert result["imported"][0]["action"] == "overwritten"
        assert result["imported"][0]["id"] == "existing-id"
        mock_save.assert_called_once()

    def test_rename_conflict(self) -> None:
        """Import renames conflicting suite when resolution is rename."""
        from wavecore.api.services.suites import import_export

        existing = _make_suite("Existing", suite_id="existing-id")
        with (
            patch(
                "wavecore.api.services.suites._storage._list_all_suites", return_value=[existing]
            ),
            patch("wavecore.api.services.suites._storage._save_suite") as _mock_save,
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "tests": []}
            result = import_export.import_suites(b"x", "suite.yaml", {"Existing": "rename"})

        assert result["imported"][0]["action"] == "renamed"
        assert result["imported"][0]["name"] == "Existing (2)"

    def test_strips_invalid_test_ids(self) -> None:
        """Import strips invalid test IDs and records fixes."""
        from wavecore.api.services.suites import import_export

        def test_exists_side_effect(test_id: str) -> bool:
            return test_id == "valid-id"

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._save_suite") as mock_save,
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch(
                "wavecore.api.services.suites._storage._test_exists",
                side_effect=test_exists_side_effect,
            ),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Suite", "tests": ["valid-id", "bad-id"]}
            result = import_export.import_suites(b"x", "suite.yaml")

        assert result["total_imported"] == 1
        assert result["fixes_applied"][0]["fixes"] == ["Stripped unresolvable test 'bad-id'"]
        saved = mock_save.call_args[0][0]
        assert saved["tests"] == ["valid-id"]

    def test_fatal_error_raises(self) -> None:
        """Import raises ValidationException for items with no name."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
            pytest.raises(ValidationException, match="Fatal validation errors prevent import"),
        ):
            mock_parse.return_value = {"description": "no name"}
            import_export.import_suites(b"x", "suite.yaml")

    def test_default_conflict_resolution_is_rename(self) -> None:
        """Default conflict resolution is rename when no resolution specified."""
        from wavecore.api.services.suites import import_export

        existing = _make_suite("Existing", suite_id="existing-id")
        with (
            patch(
                "wavecore.api.services.suites._storage._list_all_suites", return_value=[existing]
            ),
            patch("wavecore.api.services.suites._storage._save_suite"),
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "tests": []}
            result = import_export.import_suites(b"x", "suite.yaml")

        assert result["imported"][0]["action"] == "renamed"

    def test_import_creates_version_entry(self) -> None:
        """Import creates initial version history entry."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._save_suite"),
            patch("wavecore.api.services.suites._storage._save_versions") as mock_versions,
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Suite", "tests": []}
            import_export.import_suites(b"x", "suite.yaml")

        mock_versions.assert_called_once()
        versions = mock_versions.call_args[0][1]
        assert len(versions) == 1
        assert versions[0]["version"] == "1.0.0"
        assert versions[0]["created_by"] == "import"


def _suite_file(value: Any) -> bytes:
    """A suite import file whose one secret variable holds ``value``."""
    declared = {"type": "string", "value": value, "secret": True}
    if value == MASK_PLACEHOLDER:
        declared["masked"] = True
    return yaml.dump(
        {"name": "Holds a secret", "tests": [], "variables": {"token": declared}}
    ).encode()


def _secret_wave_cannot_open(kind: str) -> str:
    return _foreign_envelope("sealed-elsewhere") if kind == "foreign" else MASK_PLACEHOLDER


class TestImportSuiteSecrets:
    """A suite secret WAVE cannot open, or a masked placeholder, is stored as null and stays
    secret; a placeholder never replaces a secret stored at the same place (REQ-4.5.19,
    EXPORT-5, EXPORT-7)."""

    @pytest.mark.parametrize("kind", ["foreign", "masked"])
    def test_a_secret_wave_cannot_open_is_stored_as_null_and_stays_secret(self, kind: str) -> None:
        from wavecore.api.services.suites import _storage, import_export

        result = import_export.import_suites(
            _suite_file(_secret_wave_cannot_open(kind)), "suite.yaml"
        )

        stored = _storage._load_suite(result["imported"][0]["id"])
        assert stored is not None
        assert stored["variables"]["token"]["value"] is None
        assert stored["variables"]["token"]["secret"] is True

    def test_a_masked_placeholder_keeps_the_secret_stored_at_the_same_place_on_overwrite(
        self,
    ) -> None:
        from wavecore.api.services.suites import _storage, import_export
        from wavecore.api.services.suites import service as suite_service

        here = _make_suite(
            "Holds a secret",
            variables={"token": {"type": "string", "value": "kept-secret", "secret": True}},
        )
        suite_service.persist_suite_document(here, [])

        result = import_export.import_suites(
            _suite_file(MASK_PLACEHOLDER), "suite.yaml", {"Holds a secret": "overwrite"}
        )

        assert result["imported"] == [
            {"name": "Holds a secret", "id": here["id"], "action": "overwritten"}
        ]
        stored = _storage._load_suite(here["id"])
        assert stored is not None
        assert unseal_all(stored["variables"]["token"]["value"]) == "kept-secret"
        assert stored["variables"]["token"]["secret"] is True

    @pytest.mark.parametrize(
        ("kind", "code", "message"),
        [
            (
                "foreign",
                "FOREIGN_ENCRYPTED_SECRET",
                "Secret 'token' is encrypted by another WAVE instance and "
                "cannot be decrypted here; re-enter it after import",
            ),
            ("masked", "MASKED_SECRET", "Variable 'token' contains a masked value"),
        ],
    )
    def test_the_preview_warning_keeps_its_text(self, kind: str, code: str, message: str) -> None:
        from wavecore.api.services.suites import import_export

        result = import_export.validate_suite_import(
            _suite_file(_secret_wave_cannot_open(kind)), "suite.yaml"
        )

        found = [w["message"] for w in result["suites"][0]["warnings"] if w["code"] == code]
        assert len(found) == 1, found
        assert re.fullmatch("^" + re.escape(message) + "$", found[0])


# ============================================================================
# Utility Functions
# ============================================================================


class TestSanitizeFilename:
    """Tests for _sanitize_filename."""

    def test_basic_name(self) -> None:
        from wavecore.api.services.suites.import_export import _sanitize_filename

        assert _sanitize_filename("My Suite") == "My-Suite"

    def test_special_characters(self) -> None:
        from wavecore.api.services.suites.import_export import _sanitize_filename

        assert _sanitize_filename("Suite@#$%!") == "Suite"

    def test_empty_name(self) -> None:
        from wavecore.api.services.suites.import_export import _sanitize_filename

        assert _sanitize_filename("") == "suite"

    def test_only_special_chars(self) -> None:
        from wavecore.api.services.suites.import_export import _sanitize_filename

        assert _sanitize_filename("@#$%") == "suite"


class TestGenerateUniqueName:
    """Tests for _generate_unique_name."""

    def test_no_conflict(self) -> None:
        from wavecore.api.services.suites.import_export import _generate_unique_name

        with patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]):
            result = _generate_unique_name("My Suite")

        assert result == "My Suite"

    def test_with_conflict(self) -> None:
        from wavecore.api.services.suites.import_export import _generate_unique_name

        existing = [{"name": "My Suite", "id": "1"}]
        with patch("wavecore.api.services.suites._storage._list_all_suites", return_value=existing):
            result = _generate_unique_name("My Suite")

        assert result == "My Suite (2)"

    def test_with_multiple_conflicts(self) -> None:
        from wavecore.api.services.suites.import_export import _generate_unique_name

        existing = [
            {"name": "My Suite", "id": "1"},
            {"name": "My Suite (2)", "id": "2"},
        ]
        with patch("wavecore.api.services.suites._storage._list_all_suites", return_value=existing):
            result = _generate_unique_name("My Suite")

        assert result == "My Suite (3)"


class TestCheckMaskedSecrets:
    """Tests for check_masked_secrets edge cases."""

    def test_non_dict_variables_returns_empty(self) -> None:
        from wavecore.api.services.shared import check_masked_secrets

        assert check_masked_secrets("not a dict") == []
        assert check_masked_secrets(None) == []
        assert check_masked_secrets([]) == []


class TestExportBatchFilenameDedup:
    """Tests for filename dedup counter > 2."""

    def test_three_same_name_suites(self) -> None:
        """Third same-name suite gets -3 suffix."""
        from wavecore.api.services.suites import import_export

        suites = [
            _make_suite("Same Name", suite_id="id-a"),
            _make_suite("Same Name", suite_id="id-b"),
            _make_suite("Same Name", suite_id="id-c"),
        ]
        with patch("wavecore.api.services.suites._storage._load_suite") as mock_load:
            mock_load.side_effect = suites
            results = import_export.export_suites_batch(["id-a", "id-b", "id-c"], "yaml", False)

        filenames = [r[2] for r in results]
        assert filenames[0] == "Same-Name.yaml"
        assert filenames[1] == "Same-Name-2.yaml"
        assert filenames[2] == "Same-Name-3.yaml"


class TestImportSuiteVariableCollision:
    """Test variable type collision detection during suite import."""

    def test_validate_detects_collision_as_fatal(self) -> None:
        """Validation marks suite as fatal when variable types conflict with existing suite."""
        from wavecore.api.services.suites import import_export

        collisions = [
            {
                "variable": "env",
                "this_type": "string",
                "other_suite": "Existing",
                "other_suite_id": "existing-id",
                "other_type": "integer",
            }
        ]

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
            patch(
                "wavecore.api.services.suites.import_export.check_variable_collisions_for_tests",
                return_value=collisions,
            ),
        ):
            mock_parse.return_value = {
                "name": "Imported",
                "tests": ["t1"],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
            result = import_export.validate_suite_import(b"x", "suite.yaml")

        assert result["blocked"] == 1
        assert result["suites"][0]["status"] == "fatal"
        assert result["suites"][0]["fatal_errors"][0]["code"] == "VARIABLE_TYPE_COLLISION"

    def test_validate_no_collision_passes(self) -> None:
        """Validation passes when variable types match across suites."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._test_exists", return_value=True),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
            patch(
                "wavecore.api.services.suites.import_export.check_variable_collisions_for_tests",
                return_value=[],
            ),
        ):
            mock_parse.return_value = {
                "name": "Imported",
                "tests": ["t1"],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
            result = import_export.validate_suite_import(b"x", "suite.yaml")

        assert result["blocked"] == 0
        assert result["suites"][0]["status"] == "ok"

    def test_import_rejects_collision(self) -> None:
        """Import raises ConflictException when variable types conflict."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.suites import import_export

        collisions = [
            {
                "variable": "env",
                "this_type": "string",
                "other_suite": "Existing",
                "other_suite_id": "existing-id",
                "other_type": "integer",
            }
        ]

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._save_suite"),
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch("wavecore.api.services.suites._storage._test_exists", return_value=True),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
            patch(
                "wavecore.api.services.suites.import_export.check_variable_collisions_for_tests",
                return_value=collisions,
            ),
        ):
            mock_parse.return_value = {
                "name": "Imported",
                "tests": ["t1"],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
            with pytest.raises(ConflictException, match="Variable type collision"):
                import_export.import_suites(b"x", "suite.yaml")

    def test_import_succeeds_when_no_collision(self) -> None:
        """Import creates suite when no variable type collision."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._save_suite") as mock_save,
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch("wavecore.api.services.suites._storage._test_exists", return_value=True),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
            patch(
                "wavecore.api.services.suites.import_export.check_variable_collisions_for_tests",
                return_value=[],
            ),
        ):
            mock_parse.return_value = {
                "name": "Imported",
                "tests": ["t1"],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
            result = import_export.import_suites(b"x", "suite.yaml")

        assert result["total_imported"] == 1
        mock_save.assert_called_once()

    def test_import_skips_collision_check_when_no_tests(self) -> None:
        """Import skips collision check when suite has no tests."""
        from wavecore.api.services.suites import import_export

        with (
            patch("wavecore.api.services.suites._storage._list_all_suites", return_value=[]),
            patch("wavecore.api.services.suites._storage._save_suite") as mock_save,
            patch("wavecore.api.services.suites._storage._save_versions"),
            patch("wavecore.api.services.suites.import_export.parse_file") as mock_parse,
            patch(
                "wavecore.api.services.suites.import_export.check_variable_collisions_for_tests",
            ) as mock_check,
        ):
            mock_parse.return_value = {
                "name": "Imported",
                "tests": [],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
            result = import_export.import_suites(b"x", "suite.yaml")

        assert result["total_imported"] == 1
        mock_save.assert_called_once()
        mock_check.assert_not_called()


class TestExportKeepsTheWholeFileName:
    """An export name with text outside plain ASCII is sent whole (REQ-4.6.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_export(self, client: TestClient) -> None:
        name = f"{EXPORT_STEM}.yaml"
        with patch(f"{_ROUTE_PREFIX}.export_suite", return_value=("name: x\n", name)):
            response = client.get(f"/suites/{uuid.uuid4()}/export")

        assert_whole_name(response, name)

    def test_bulk_export_of_one(self, client: TestClient) -> None:
        suite_id = str(uuid.uuid4())
        name = f"{EXPORT_STEM}.yaml"
        with patch(
            f"{_ROUTE_PREFIX}.export_suites_batch", return_value=[(suite_id, "name: x\n", name)]
        ):
            response = client.post("/suites/export", json={"suite_ids": [suite_id]})

        assert_whole_name(response, name)
