"""Unit tests for test import/export endpoints (REQ-5.2.4.9).

This module tests the synchronous test import/export endpoints enabling
portable serialization and deserialization of test definitions with format
selection, secret masking, conflict resolution, and validation integration.

Test Coverage:
- Single test export: YAML/JSON format, secret masking, headers, 404/400
- Bulk test export: single file vs ZIP, content-type, 400/404
- Import validation: valid files, conflicts, fatal/fixable errors, ZIP
- Import execution: create tests, conflict resolution, auto-fix, fatal rejection
"""

import io
import json
import re
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.api.body_shape_support import NOT_ID_LIST_FIELDS, assert_refused
from tests.api.download_name_helpers import ENTITY_NAME, EXPORT_STEM, assert_whole_name
from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services.storage_paths import get_test_testdata_path
from wavecore.core.secrets.cipher import SecretCipher, is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import seal_value, seal_variables, unseal_all

_DECRYPTION_FAILED_MESSAGE = (
    "Secret decryption failed: ciphertext is corrupt or the encryption key is invalid"
)


def _sealed_secret_variables() -> dict[str, Any]:
    """A variables dict with one locally-sealed secret and one plain variable."""
    return seal_variables(
        {
            "api_key": {"type": "string", "value": "sk-12345-classified", "secret": True},
            "host": {"type": "string", "value": "db.example.com"},
        }
    )


def _foreign_envelope(value: Any) -> str:
    """Seal a value under a key this instance does not hold (undecryptable here)."""
    return SecretCipher(bytes(range(1, 33))).seal(value)


def _make_test(
    name: str = "Test One",
    *,
    test_id: str | None = None,
    variables: dict[str, Any] | None = None,
    workflow: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a minimal test dict for mocking."""
    return {
        "id": test_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": "A sample test",
        "workflow": workflow or {"nodes": [], "edges": []},
        "variables": variables or {},
        "metadata": {"tags": ["smoke"]},
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


_FUNCTION_SECRET_PLACES = ("Function-local secret", "secret output default")
_FUNCTION_AND_CREDENTIAL_PLACES = ("plugin credential", *_FUNCTION_SECRET_PLACES)
_WORKFLOW_SECRET_PLACES = ("Setter literal", *_FUNCTION_AND_CREDENTIAL_PLACES)
_SECRET_PLACES = ("secret variable", *_WORKFLOW_SECRET_PLACES)


@pytest.fixture
def http_client_plugin(monkeypatch: pytest.MonkeyPatch) -> None:
    """The HTTP block, registered for one test, so its declared credential fields are known."""
    from wavecore.core import plugin_registry
    from wavecore.plugins.http_client import HTTPClientPlugin

    plugin = HTTPClientPlugin()
    monkeypatch.setitem(
        plugin_registry._registry._plugins, "http-client", {plugin.metadata["version"]: plugin}
    )


def _workflow_node(node_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"id": node_id, "type": "workflowNode", "position": {"x": 0, "y": 0}, "data": data}


def _local_function_node(
    *, variables: list[dict[str, Any]] | None = None, outputs: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """A Local Function block whose definition declares ``variables`` and ``outputs``."""
    return _workflow_node(
        "fn-local",
        {
            "label": "Local step",
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": "Local step",
                "inputs": [],
                "outputs": outputs or [],
                "variables": variables or [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            },
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    )


def _secret_workflow_node(place: str, value: Any) -> dict[str, Any]:
    """The one block that holds ``value`` at a workflow secret place."""
    if place == "Setter literal":
        return _workflow_node(
            "set-1",
            {
                "label": "Set token",
                "elementType": "variable-setter",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {
                    "values": {"variables": {"set_tok": value}},
                    "variableSecretKeys": ["set_tok"],
                },
            },
        )
    if place == "plugin credential":
        return _workflow_node(
            "http-1",
            {
                "label": "Call API",
                "elementType": "http-client",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {
                    "values": {"url": "http://api.test", "method": "GET", "auth_token": value},
                    "outputBindings": {},
                    "profileBindings": [],
                },
            },
        )
    if place == "Function-local secret":
        local = {"name": "local_tok", "type": "string", "secret": True, "value": value}
        return _local_function_node(variables=[local])
    output = {"name": "out_tok", "type": "string", "secret": True, "default": value}
    return _local_function_node(outputs=[output])


def _secret_test_document(place: str, value: Any) -> dict[str, Any]:
    """A Test document whose only secret, ``value``, sits at ``place``."""
    if place == "secret variable":
        declared = {"type": "string", "value": value, "secret": True}
        if value == MASK_PLACEHOLDER:
            declared["masked"] = True
        return {
            "name": "Holds a secret",
            "workflow": {"nodes": [], "edges": []},
            "variables": {"api_key": declared},
        }
    return {
        "name": "Holds a secret",
        "workflow": {"nodes": [_secret_workflow_node(place, value)], "edges": []},
        "variables": {},
    }


def _stored_secret(place: str, test: dict[str, Any]) -> tuple[Any, bool]:
    """The value a Test holds at ``place`` and whether that place is still secret."""
    if place == "secret variable":
        declared = test["variables"]["api_key"]
        return declared["value"], declared.get("secret") is True
    data = test["workflow"]["nodes"][0]["data"]
    if place == "Setter literal":
        config = data["config"]
        return config["values"]["variables"]["set_tok"], config["variableSecretKeys"] == ["set_tok"]
    if place == "plugin credential":
        # The HTTP block declares this field a credential, so it is secret by declaration.
        return data["config"]["values"]["auth_token"], True
    definition = data["localDefinition"]
    if place == "Function-local secret":
        declared = definition["variables"][0]
        return declared["value"], declared.get("secret") is True
    declared = definition["outputs"][0]
    return declared["default"], declared.get("secret") is True


def _imported(document: dict[str, Any]) -> dict[str, Any]:
    """Import one Test document and return the Test as stored."""
    from wavecore.api.services.tests import service as test_service

    result = test_service.import_tests(json.dumps(document).encode(), "import.json")
    assert result["total_imported"] == 1, result
    stored = test_service._load_test(result["imported"][0]["id"])
    assert stored is not None
    return stored


def _foreign_warning_pattern(name: str) -> str:
    return (
        "^"
        + re.escape(
            f"Secret '{name}' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        )
        + "$"
    )


# ============================================================================
# Single Test Export
# ============================================================================


class TestExportSingleTest:
    """Tests for GET /tests/{test_id}/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_export_yaml_default_format(self, client: TestClient) -> None:
        """Export defaults to YAML format."""
        test = _make_test("Login Flow")
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = (
                yaml.dump(test, default_flow_style=False),
                "Login-Flow.yaml",
                "application/x-yaml",
            )
            response = client.get(f"/tests/{test['id']}/export")

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]
        assert 'filename="Login-Flow.yaml"' in response.headers["content-disposition"]

    def test_export_json_format(self, client: TestClient) -> None:
        """Export in JSON format returns correct content-type."""
        test = _make_test("Login Flow")
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = (
                json.dumps(test, indent=2),
                "Login-Flow.json",
                "application/json",
            )
            response = client.get(f"/tests/{test['id']}/export?format=json")

        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]
        assert 'filename="Login-Flow.json"' in response.headers["content-disposition"]

    def test_export_content_is_parseable_yaml(self, client: TestClient) -> None:
        """Exported YAML content is valid and parseable."""
        test = _make_test("Parseable Test")
        yaml_content = yaml.dump(test, default_flow_style=False)
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = (
                yaml_content,
                "Parseable-Test.yaml",
                "application/x-yaml",
            )
            response = client.get(f"/tests/{test['id']}/export")

        parsed = yaml.safe_load(response.text)
        assert parsed["name"] == "Parseable Test"

    def test_export_content_is_parseable_json(self, client: TestClient) -> None:
        """Exported JSON content is valid and parseable."""
        test = _make_test("JSON Test")
        json_content = json.dumps(test, indent=2)
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = (json_content, "JSON-Test.json", "application/json")
            response = client.get(f"/tests/{test['id']}/export?format=json")

        parsed = json.loads(response.text)
        assert parsed["name"] == "JSON Test"

    @pytest.mark.parametrize("mode", ["mask", "encrypted", "plaintext"])
    def test_export_passes_secrets_mode_to_service(self, client: TestClient, mode: str) -> None:
        """The chosen secrets mode is forwarded to the export service."""
        test = _make_test("Secret Test")
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = ("content", "Secret-Test.yaml", "application/x-yaml")
            response = client.get(f"/tests/{test['id']}/export?secrets={mode}")

        assert response.status_code == 200
        mock_export.assert_called_once_with(test["id"], "yaml", mode)

    def test_export_invalid_secrets_mode_returns_400(self, client: TestClient) -> None:
        """An unrecognized secrets mode is rejected before export."""
        test_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = None
            response = client.get(f"/tests/{test_id}/export?secrets=bogus")

        assert response.status_code == 400
        assert (
            "Invalid secrets mode 'bogus'; must be 'mask', 'encrypted', or 'plaintext'"
            in response.text
        )

    def test_export_plaintext_undecryptable_returns_409(self, client: TestClient) -> None:
        """A plaintext export of a foreign envelope surfaces as a 409 conflict."""
        test_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.side_effect = ConflictException(_DECRYPTION_FAILED_MESSAGE)
            response = client.get(f"/tests/{test_id}/export?secrets=plaintext")

        assert response.status_code == 409
        assert _DECRYPTION_FAILED_MESSAGE in response.text

    def test_export_not_found_returns_404(self, client: TestClient) -> None:
        """Export returns 404 for non-existent test."""
        fake_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = None
            response = client.get(f"/tests/{fake_id}/export")

        assert response.status_code == 404

    def test_export_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid UUID."""
        response = client.get("/tests/not-a-uuid/export")
        assert response.status_code == 400

    def test_export_invalid_format_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid format parameter."""
        test_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = None
            response = client.get(f"/tests/{test_id}/export?format=xml")

        assert response.status_code == 400

    def test_export_content_disposition_header(self, client: TestClient) -> None:
        """Export sets Content-Disposition attachment header."""
        test = _make_test("Attachment Test")
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = (
                "content",
                "Attachment-Test.yaml",
                "application/x-yaml",
            )
            response = client.get(f"/tests/{test['id']}/export")

        assert response.headers["content-disposition"].startswith("attachment")

    def test_export_default_secrets_mode_is_mask(self, client: TestClient) -> None:
        """Default secrets mode is mask (secrets masked by default)."""
        test = _make_test("Default Mask")
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = ("content", "Default-Mask.yaml", "application/x-yaml")
            response = client.get(f"/tests/{test['id']}/export")

        assert response.status_code == 200
        mock_export.assert_called_once_with(test["id"], "yaml", "mask")

    def test_export_answers_the_media_type_the_service_returns(self, client: TestClient) -> None:
        """A test with files exports as a zip under today's stem."""
        test = _make_test("Rich Test")
        with patch("wavecore.api.routes.tests.routes.test_service.export_test") as mock_export:
            mock_export.return_value = (b"PK-archive", "Rich-Test.zip", "application/zip")
            response = client.get(f"/tests/{test['id']}/export")

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert 'filename="Rich-Test.zip"' in response.headers["content-disposition"]
        assert response.content == b"PK-archive"


# ============================================================================
# Bulk Test Export
# ============================================================================


class TestExportBulkTests:
    """Tests for POST /tests/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_test_returns_file_not_zip(self, client: TestClient) -> None:
        """Exporting 1 test returns single file, not ZIP."""
        test_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.tests.routes.test_service.export_tests_batch"
        ) as mock_batch:
            mock_batch.return_value = ([(test_id, "name: Test\n", "Test.yaml")], [])
            response = client.post(
                "/tests/export",
                json={"test_ids": [test_id], "format": "yaml", "secrets": "mask"},
            )

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]

    def test_multiple_tests_returns_zip(self, client: TestClient) -> None:
        """Exporting 2+ tests returns ZIP archive."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.tests.routes.test_service.export_tests_batch"
        ) as mock_batch:
            mock_batch.return_value = (
                [
                    (id1, "name: Test1\n", "Test1.yaml"),
                    (id2, "name: Test2\n", "Test2.yaml"),
                ],
                [],
            )
            response = client.post(
                "/tests/export",
                json={"test_ids": [id1, id2], "format": "yaml", "secrets": "mask"},
            )

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert 'filename="tests-export.zip"' in response.headers["content-disposition"]

    def test_zip_contains_all_tests(self, client: TestClient) -> None:
        """ZIP archive contains all exported tests."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.tests.routes.test_service.export_tests_batch"
        ) as mock_batch:
            mock_batch.return_value = (
                [
                    (id1, "name: Alpha\n", "Alpha.yaml"),
                    (id2, "name: Beta\n", "Beta.yaml"),
                ],
                [],
            )
            response = client.post(
                "/tests/export",
                json={"test_ids": [id1, id2], "format": "yaml", "secrets": "mask"},
            )

        zf = zipfile.ZipFile(io.BytesIO(response.content))
        names = zf.namelist()
        assert "Alpha.yaml" in names
        assert "Beta.yaml" in names
        assert len(names) == 2

    def test_empty_list_returns_400(self, client: TestClient) -> None:
        """Exporting empty list returns 400."""
        response = client.post(
            "/tests/export",
            json={"test_ids": [], "format": "yaml", "secrets": "mask"},
        )
        assert response.status_code == 400

    @pytest.mark.parametrize("test_ids", NOT_ID_LIST_FIELDS)
    def test_ids_that_are_not_a_list_of_strings_are_refused(
        self, client: TestClient, test_ids: Any
    ) -> None:
        response = client.post("/tests/export", json={"test_ids": test_ids, "format": "yaml"})

        assert_refused(response, "'test_ids' must be a list of ID strings")

    def test_nonexistent_test_returns_404(self, client: TestClient) -> None:
        """Exporting non-existent test returns 404."""
        fake_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.tests.routes.test_service.export_tests_batch"
        ) as mock_batch:
            mock_batch.side_effect = ValueError(f"Test not found: {fake_id}")
            response = client.post(
                "/tests/export",
                json={"test_ids": [fake_id], "format": "yaml", "secrets": "mask"},
            )

        assert response.status_code == 404

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        """Invalid format parameter returns 400."""
        test_id = str(uuid.uuid4())
        response = client.post(
            "/tests/export",
            json={"test_ids": [test_id], "format": "xml", "secrets": "mask"},
        )
        assert response.status_code == 400

    def test_json_format_for_bulk(self, client: TestClient) -> None:
        """Bulk export supports JSON format."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.tests.routes.test_service.export_tests_batch"
        ) as mock_batch:
            mock_batch.return_value = (
                [
                    (id1, '{"name": "T1"}', "T1.json"),
                    (id2, '{"name": "T2"}', "T2.json"),
                ],
                [],
            )
            response = client.post(
                "/tests/export",
                json={"test_ids": [id1, id2], "format": "json", "secrets": "plaintext"},
            )

        assert response.status_code == 200
        zf = zipfile.ZipFile(io.BytesIO(response.content))
        assert "T1.json" in zf.namelist()

    def test_bulk_export_content_disposition(self, client: TestClient) -> None:
        """Bulk ZIP has correct content-disposition header."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.tests.routes.test_service.export_tests_batch"
        ) as mock_batch:
            mock_batch.return_value = (
                [
                    (id1, "content1", "T1.yaml"),
                    (id2, "content2", "T2.yaml"),
                ],
                [],
            )
            response = client.post(
                "/tests/export",
                json={"test_ids": [id1, id2], "format": "yaml", "secrets": "mask"},
            )

        assert response.headers["content-disposition"].startswith("attachment")

    def test_one_selected_test_with_files_answers_a_zip(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """The one-test branch builds the document-plus-files zip."""
        test_id = str(uuid.uuid4())
        fixture = tmp_path / "rows.csv"
        fixture.write_bytes(b"id,name\n")
        with patch(
            "wavecore.api.routes.tests.routes.test_service.export_tests_batch"
        ) as mock_batch:
            mock_batch.return_value = (
                [(test_id, "name: Rich\n", "Rich.yaml")],
                [(test_id, "rows.csv", fixture)],
            )
            response = client.post(
                "/tests/export",
                json={"test_ids": [test_id], "format": "yaml", "secrets": "mask"},
            )

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert 'filename="Rich.zip"' in response.headers["content-disposition"]
        zf = zipfile.ZipFile(io.BytesIO(response.content))
        assert set(zf.namelist()) == {"Rich.yaml", f"testdata/{test_id}/rows.csv"}
        assert zf.read(f"testdata/{test_id}/rows.csv") == b"id,name\n"

    def test_several_tests_add_the_per_test_file_entries(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """The several-tests archive carries every test's files."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        fixture = tmp_path / "rows.csv"
        fixture.write_bytes(b"id,name\n")
        with patch(
            "wavecore.api.routes.tests.routes.test_service.export_tests_batch"
        ) as mock_batch:
            mock_batch.return_value = (
                [(id1, "name: Alpha\n", "Alpha.yaml"), (id2, "name: Beta\n", "Beta.yaml")],
                [(id1, "sub/rows.csv", fixture)],
            )
            response = client.post(
                "/tests/export",
                json={"test_ids": [id1, id2], "format": "yaml", "secrets": "mask"},
            )

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert 'filename="tests-export.zip"' in response.headers["content-disposition"]
        zf = zipfile.ZipFile(io.BytesIO(response.content))
        assert set(zf.namelist()) == {
            "Alpha.yaml",
            "Beta.yaml",
            f"testdata/{id1}/sub/rows.csv",
        }


# ============================================================================
# Import Validation
# ============================================================================


class TestValidateImport:
    """Tests for POST /tests/import/validate."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_valid_yaml(self, client: TestClient) -> None:
        """Valid YAML returns ok status."""
        test_data = {"name": "New Test", "workflow": {"nodes": [], "edges": []}}
        content = yaml.dump(test_data)
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "tests": [
                    {
                        "name": "New Test",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_test_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/tests/import/validate",
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["total"] == 1
        assert data["data"]["importable"] == 1
        assert data["data"]["tests"][0]["status"] == "ok"

    def test_validate_valid_json(self, client: TestClient) -> None:
        """Valid JSON returns ok status."""
        test_data = {"name": "JSON Test", "workflow": {"nodes": [], "edges": []}}
        content = json.dumps(test_data)
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "tests": [
                    {
                        "name": "JSON Test",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_test_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/tests/import/validate",
                files={"file": ("test.json", content, "application/json")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["tests"][0]["status"] == "ok"

    def test_validate_zip_with_multiple_tests(self, client: TestClient) -> None:
        """ZIP with multiple tests returns per-test results."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "test1.yaml", yaml.dump({"name": "T1", "workflow": {"nodes": [], "edges": []}})
            )
            zf.writestr(
                "test2.yaml", yaml.dump({"name": "T2", "workflow": {"nodes": [], "edges": []}})
            )
        buf.seek(0)

        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "tests": [
                    {
                        "name": "T1",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_test_id": None,
                    },
                    {
                        "name": "T2",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_test_id": None,
                    },
                ],
                "total": 2,
                "importable": 2,
                "blocked": 0,
            }
            response = client.post(
                "/tests/import/validate",
                files={"file": ("tests.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total"] == 2

    def test_validate_name_conflict(self, client: TestClient) -> None:
        """Detects name conflicts with existing tests."""
        content = yaml.dump({"name": "Existing Test", "workflow": {"nodes": [], "edges": []}})
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "tests": [
                    {
                        "name": "Existing Test",
                        "status": "conflict",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_test_id": "abc-123",
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/tests/import/validate",
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["tests"][0]["status"] == "conflict"
        assert response.json()["data"]["tests"][0]["existing_test_id"] == "abc-123"

    def test_validate_fatal_errors(self, client: TestClient) -> None:
        """Fatal errors block import."""
        content = yaml.dump({"name": "Bad Test"})
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "tests": [
                    {
                        "name": "Bad Test",
                        "status": "fatal",
                        "fatal_errors": [
                            {"code": "MISSING_WORKFLOW", "message": "Test must have a workflow"}
                        ],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_test_id": None,
                    }
                ],
                "total": 1,
                "importable": 0,
                "blocked": 1,
            }
            response = client.post(
                "/tests/import/validate",
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["blocked"] == 1
        assert data["tests"][0]["status"] == "fatal"

    def test_validate_fixable_errors(self, client: TestClient) -> None:
        """Fixable errors are flagged but still importable."""
        content = yaml.dump(
            {
                "name": "Fixable Test",
                "workflow": {
                    "nodes": [{"id": "n1", "type": "plugin", "position": None, "data": {}}],
                    "edges": [],
                },
            }
        )
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "tests": [
                    {
                        "name": "Fixable Test",
                        "status": "fixable",
                        "fatal_errors": [],
                        "fixable_errors": [
                            {"code": "MISSING_POSITION", "message": "Node missing position"}
                        ],
                        "warnings": [],
                        "existing_test_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/tests/import/validate",
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["importable"] == 1
        assert data["tests"][0]["status"] == "fixable"

    def test_validate_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Unsupported file format returns 400."""
        response = client.post(
            "/tests/import/validate",
            files={"file": ("test.xml", "<test/>", "application/xml")},
        )
        assert response.status_code == 400

    def test_validate_invalid_yaml_returns_400(self, client: TestClient) -> None:
        """Malformed YAML returns 400."""
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.side_effect = ValueError("Invalid YAML: could not parse file")
            response = client.post(
                "/tests/import/validate",
                files={"file": ("test.yaml", "{{invalid yaml:", "application/x-yaml")},
            )

        assert response.status_code == 400

    def test_validate_empty_zip_returns_400(self, client: TestClient) -> None:
        """Empty ZIP archive returns 400."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w"):
            pass
        buf.seek(0)
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.side_effect = ValueError("ZIP archive contains no importable files")
            response = client.post(
                "/tests/import/validate",
                files={"file": ("tests.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 400

    def test_validate_summary_counts(self, client: TestClient) -> None:
        """Response includes correct summary counts."""
        content = yaml.dump({"name": "Count Test", "workflow": {"nodes": [], "edges": []}})
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "tests": [
                    {
                        "name": "Count Test",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_test_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/tests/import/validate",
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        data = response.json()["data"]
        assert data["total"] == 1
        assert data["importable"] == 1
        assert data["blocked"] == 0

    def test_validate_warnings_included(self, client: TestClient) -> None:
        """Validation warnings are included in results."""
        content = yaml.dump({"name": "Warn Test", "workflow": {"nodes": [], "edges": []}})
        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_test_import"
        ) as mock_validate:
            mock_validate.return_value = {
                "tests": [
                    {
                        "name": "Warn Test",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [{"code": "MISSING_DESCRIPTION", "message": "No description"}],
                        "existing_test_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/tests/import/validate",
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert len(response.json()["data"]["tests"][0]["warnings"]) == 1


# ============================================================================
# Import Tests
# ============================================================================


class TestImportTest:
    """Tests for POST /tests/import."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_import_single_yaml_creates_test(self, client: TestClient) -> None:
        """Importing valid YAML creates a new test."""
        test_data = {"name": "New Test", "workflow": {"nodes": [], "edges": []}}
        content = yaml.dump(test_data)
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "New Test", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_imported"] == 1
        assert data["imported"][0]["name"] == "New Test"
        assert data["imported"][0]["action"] == "created"

    def test_import_single_json_creates_test(self, client: TestClient) -> None:
        """Importing valid JSON creates a new test."""
        test_data = {"name": "JSON Import", "workflow": {"nodes": [], "edges": []}}
        content = json.dumps(test_data)
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "JSON Import", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.json", content, "application/json")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 1

    def test_import_zip_with_multiple_tests(self, client: TestClient) -> None:
        """Importing ZIP creates multiple tests."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "t1.yaml", yaml.dump({"name": "T1", "workflow": {"nodes": [], "edges": []}})
            )
            zf.writestr(
                "t2.yaml", yaml.dump({"name": "T2", "workflow": {"nodes": [], "edges": []}})
            )
        buf.seek(0)

        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [
                    {"name": "T1", "id": str(uuid.uuid4()), "action": "created"},
                    {"name": "T2", "id": str(uuid.uuid4()), "action": "created"},
                ],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 2,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("tests.zip", buf.getvalue(), "application/zip")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 2

    def test_import_conflict_rename(self, client: TestClient) -> None:
        """Conflict with rename creates test with (2) suffix."""
        content = yaml.dump({"name": "Existing", "workflow": {"nodes": [], "edges": []}})
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
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
                "/tests/import",
                data={"conflict_resolutions": json.dumps({"Existing": "rename"})},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["imported"][0]["action"] == "renamed"
        assert "(2)" in response.json()["data"]["imported"][0]["name"]

    def test_import_conflict_overwrite(self, client: TestClient) -> None:
        """Conflict with overwrite replaces existing test."""
        content = yaml.dump({"name": "Existing", "workflow": {"nodes": [], "edges": []}})
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Existing", "id": "existing-id", "action": "overwritten"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": json.dumps({"Existing": "overwrite"})},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["imported"][0]["action"] == "overwritten"

    def test_import_conflict_skip(self, client: TestClient) -> None:
        """Conflict with skip omits the test."""
        content = yaml.dump({"name": "Existing", "workflow": {"nodes": [], "edges": []}})
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [],
                "skipped": [{"name": "Existing", "reason": "skipped by user"}],
                "fixes_applied": [],
                "total_imported": 0,
                "total_skipped": 1,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": json.dumps({"Existing": "skip"})},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_skipped"] == 1
        assert data["skipped"][0]["name"] == "Existing"

    def test_import_auto_fixes_applied(self, client: TestClient) -> None:
        """Auto-fixable errors are repaired during import."""
        content = yaml.dump(
            {
                "name": "Fixable",
                "workflow": {"nodes": [{"id": "n1", "type": "plugin", "data": {}}], "edges": []},
            }
        )
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Fixable", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [
                    {"name": "Fixable", "fixes": ["Added default position to block n1"]}
                ],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert len(response.json()["data"]["fixes_applied"]) == 1

    def test_import_fatal_errors_rejected(self, client: TestClient) -> None:
        """Fatal validation errors block import with 422."""
        content = yaml.dump({"name": "Fatal"})
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.side_effect = ValueError("Fatal validation errors prevent import")
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 422

    def test_import_new_uuid_generated(self, client: TestClient) -> None:
        """Imported tests receive new UUIDs."""
        original_id = str(uuid.uuid4())
        content = yaml.dump(
            {"id": original_id, "name": "UUID Test", "workflow": {"nodes": [], "edges": []}}
        )
        new_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "UUID Test", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        imported_id = response.json()["data"]["imported"][0]["id"]
        assert imported_id != original_id

    def test_import_preserves_workflow(self, client: TestClient) -> None:
        """Imported test preserves workflow structure."""
        workflow = {
            "nodes": [
                {
                    "id": "n1",
                    "type": "plugin",
                    "position": {"x": 0, "y": 0},
                    "data": {"label": "Test"},
                }
            ],
            "edges": [],
        }
        content = yaml.dump({"name": "Workflow Test", "workflow": workflow})
        new_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Workflow Test", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 1

    def test_import_preserves_variables(self, client: TestClient) -> None:
        """Imported test preserves variable definitions."""
        content = yaml.dump(
            {
                "name": "Var Test",
                "workflow": {"nodes": [], "edges": []},
                "variables": {"host": {"value": "localhost", "type": "string", "scope": "test"}},
            }
        )
        new_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Var Test", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 1

    def test_import_parse_error_returns_400(self, client: TestClient) -> None:
        """Malformed file content returns 400."""
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.side_effect = ValueError("Invalid YAML: could not parse file")
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", "{{bad yaml", "application/x-yaml")},
            )

        assert response.status_code in (400, 422)

    def test_import_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Unsupported file format returns 400."""
        response = client.post(
            "/tests/import",
            data={"conflict_resolutions": "{}"},
            files={"file": ("test.xml", "<test/>", "application/xml")},
        )
        assert response.status_code == 400

    def test_import_returns_fix_details(self, client: TestClient) -> None:
        """Import response includes details of applied fixes."""
        content = yaml.dump({"name": "Fix Detail", "workflow": {"nodes": [], "edges": []}})
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Fix Detail", "id": str(uuid.uuid4()), "action": "created"}],
                "skipped": [],
                "fixes_applied": [{"name": "Fix Detail", "fixes": ["Added missing description"]}],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        data = response.json()["data"]
        assert data["fixes_applied"][0]["name"] == "Fix Detail"
        assert len(data["fixes_applied"][0]["fixes"]) > 0

    def test_import_auto_rename_increments_suffix(self, client: TestClient) -> None:
        """Auto-rename uses (2), (3) etc. for unique names."""
        content = yaml.dump({"name": "Dup", "workflow": {"nodes": [], "edges": []}})
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Dup (3)", "id": str(uuid.uuid4()), "action": "renamed"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": json.dumps({"Dup": "rename"})},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert "(3)" in response.json()["data"]["imported"][0]["name"]

    def test_import_timestamps_are_fresh(self, client: TestClient) -> None:
        """Imported tests get fresh created_at and updated_at timestamps."""
        old_time = "2020-01-01T00:00:00+00:00"
        content = yaml.dump(
            {
                "name": "Timestamp Test",
                "created_at": old_time,
                "updated_at": old_time,
                "workflow": {"nodes": [], "edges": []},
            }
        )
        new_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.import_tests") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "Timestamp Test", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("test.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 1

    def test_import_invalid_conflict_resolutions_json(self, client: TestClient) -> None:
        """Invalid JSON in conflict_resolutions returns 400."""
        content = yaml.dump({"name": "Test", "workflow": {"nodes": [], "edges": []}})
        response = client.post(
            "/tests/import",
            data={"conflict_resolutions": "{not valid json}"},
            files={"file": ("test.yaml", content, "application/x-yaml")},
        )
        assert response.status_code == 400
        assert "PARSE_ERROR" in response.text


# ============================================================================
# Service Function Tests
# ============================================================================


class TestImportForeignEnvelopeRemediation:
    """A foreign-instance secret (undecryptable here) is stored as null on import
    and stays secret, owed until a person enters it (REQ-4.5.19, EXPORT-5)."""

    _FOREIGN_KEY = bytes(range(1, 33))

    def _foreign_envelope(self, value: str) -> str:
        return SecretCipher(self._FOREIGN_KEY).seal(value)

    def test_foreign_variable_and_setter_secret_are_sanitized(self) -> None:
        from wavecore.api.services.tests import service as test_service

        setter_node = {
            "id": "s1",
            "type": "workflowNode",
            "data": {
                "label": "Set Vars",
                "elementType": "variable-setter",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {
                    "values": {"variables": {"tok": self._foreign_envelope("setter-secret")}},
                    "variableSecretKeys": ["tok"],
                },
            },
        }
        content = json.dumps(
            {
                "name": "Foreign Import",
                "workflow": {"nodes": [setter_node], "edges": []},
                "variables": {
                    "api_key": {
                        "type": "string",
                        "value": self._foreign_envelope("var-secret"),
                        "secret": True,
                    },
                },
            }
        )

        result = test_service.import_tests(content.encode(), "foreign.json")
        assert result["total_imported"] == 1
        imported_id = result["imported"][0]["id"]

        stored = test_service._load_test(imported_id)
        setter_config = stored["workflow"]["nodes"][0]["data"]["config"]

        assert stored["variables"]["api_key"]["value"] is None
        assert stored["variables"]["api_key"]["secret"] is True
        assert setter_config["values"]["variables"]["tok"] is None
        assert setter_config["variableSecretKeys"] == ["tok"]

    @pytest.mark.usefixtures("http_client_plugin")
    @pytest.mark.parametrize("place", _FUNCTION_AND_CREDENTIAL_PLACES)
    def test_a_foreign_workflow_secret_is_stored_as_null_and_stays_secret(self, place: str) -> None:
        stored = _imported(_secret_test_document(place, self._foreign_envelope("sealed-elsewhere")))

        assert _stored_secret(place, stored) == (None, True)


@pytest.mark.usefixtures("http_client_plugin")
class TestImportMaskedSecrets:
    """A masked placeholder an import brings in is stored as null and stays secret; it
    never replaces a real secret stored at the same place (EXPORT-7, REQ-4.5.19)."""

    def test_a_masked_secret_variable_is_stored_as_null_and_stays_secret(self) -> None:
        stored = _imported(_secret_test_document("secret variable", MASK_PLACEHOLDER))

        assert _stored_secret("secret variable", stored) == (None, True)

    @pytest.mark.parametrize("place", _WORKFLOW_SECRET_PLACES)
    def test_a_masked_workflow_secret_is_stored_as_null_and_stays_secret(self, place: str) -> None:
        stored = _imported(_secret_test_document(place, MASK_PLACEHOLDER))

        assert _stored_secret(place, stored) == (None, True)

    @pytest.mark.parametrize("place", _SECRET_PLACES)
    def test_a_masked_placeholder_never_replaces_the_secret_stored_at_the_same_place(
        self, place: str
    ) -> None:
        from wavecore.api.services.tests import service as test_service

        kept = _secret_test_document(place, "kept-secret")
        here = _make_test(kept["name"], variables=kept["variables"], workflow=kept["workflow"])
        test_service.persist_test_document(here, [], [], replace_files=False)
        incoming = _secret_test_document(place, MASK_PLACEHOLDER)

        result = test_service.import_tests(
            json.dumps(incoming).encode(),
            "masked.json",
            {"Holds a secret": "overwrite"},
        )

        assert result["imported"] == [
            {"name": "Holds a secret", "id": here["id"], "action": "overwritten"}
        ]
        stored = test_service._load_test(here["id"])
        assert stored is not None
        value, secret = _stored_secret(place, stored)
        assert (unseal_all(value), secret) == ("kept-secret", True)


@pytest.mark.usefixtures("http_client_plugin")
class TestValidateImportSecretWarnings:
    """The import preview names every secret WAVE cannot open, wherever the Test holds it."""

    @pytest.mark.parametrize(
        ("place", "name"),
        [
            ("secret variable", "api_key"),
            ("Setter literal", "set_tok"),
            ("plugin credential", "auth_token"),
            ("Function-local secret", "local_tok"),
            ("secret output default", "out_tok"),
        ],
    )
    def test_a_foreign_secret_is_named_with_the_unchanged_warning(
        self, place: str, name: str
    ) -> None:
        from wavecore.api.services.tests import service as test_service

        document = _secret_test_document(place, _foreign_envelope("sealed-elsewhere"))

        result = test_service.validate_test_import(json.dumps(document).encode(), "foreign.json")

        messages = [
            warning["message"]
            for warning in result["tests"][0]["warnings"]
            if warning["code"] == "FOREIGN_ENCRYPTED_SECRET"
        ]
        assert len(messages) == 1, messages
        assert re.fullmatch(_foreign_warning_pattern(name), messages[0])


class TestSanitizeFilename:
    """Tests for _sanitize_filename helper."""

    def test_basic_name(self) -> None:
        from wavecore.api.services.tests.service import _sanitize_filename

        assert _sanitize_filename("Login Flow") == "Login-Flow"

    def test_special_characters_removed(self) -> None:
        from wavecore.api.services.tests.service import _sanitize_filename

        assert _sanitize_filename("Test@#$%!Name") == "TestName"

    def test_empty_name_returns_test(self) -> None:
        from wavecore.api.services.tests.service import _sanitize_filename

        assert _sanitize_filename("@#$") == "test"

    def test_whitespace_collapsed(self) -> None:
        from wavecore.api.services.tests.service import _sanitize_filename

        assert _sanitize_filename("Test   Multiple   Spaces") == "Test-Multiple-Spaces"


class TestGenerateUniqueName:
    """Tests for _generate_unique_name helper."""

    def test_unique_name_returned_as_is(self) -> None:
        from wavecore.api.services.tests.service import _generate_unique_name

        with patch("wavecore.api.services.tests.service._list_all_tests") as mock_list:
            mock_list.return_value = [{"name": "Other Test"}]
            result = _generate_unique_name("Brand New")

        assert result == "Brand New"

    def test_conflict_appends_suffix_2(self) -> None:
        from wavecore.api.services.tests.service import _generate_unique_name

        with patch("wavecore.api.services.tests.service._list_all_tests") as mock_list:
            mock_list.return_value = [{"name": "Existing"}]
            result = _generate_unique_name("Existing")

        assert result == "Existing (2)"

    def test_increments_to_3_when_2_exists(self) -> None:
        from wavecore.api.services.tests.service import _generate_unique_name

        with patch("wavecore.api.services.tests.service._list_all_tests") as mock_list:
            mock_list.return_value = [{"name": "Dup"}, {"name": "Dup (2)"}]
            result = _generate_unique_name("Dup")

        assert result == "Dup (3)"


class TestParseTestFile:
    """Tests for _parse_test_file helper."""

    def test_parse_valid_yaml(self) -> None:
        from wavecore.api.services.tests.service import _parse_test_file

        content = yaml.dump({"name": "YAML Test"}).encode()
        result = _parse_test_file(content, "test.yaml")
        assert result["name"] == "YAML Test"

    def test_parse_valid_yml_extension(self) -> None:
        from wavecore.api.services.tests.service import _parse_test_file

        content = yaml.dump({"name": "YML Test"}).encode()
        result = _parse_test_file(content, "test.yml")
        assert result["name"] == "YML Test"

    def test_parse_valid_json(self) -> None:
        from wavecore.api.services.tests.service import _parse_test_file

        content = json.dumps({"name": "JSON Test"}).encode()
        result = _parse_test_file(content, "test.json")
        assert result["name"] == "JSON Test"

    def test_parse_invalid_json_raises(self) -> None:
        from wavecore.api.services.tests.service import _parse_test_file

        with pytest.raises(ValidationException, match="Invalid JSON"):
            _parse_test_file(b"{bad json", "test.json")

    def test_parse_invalid_yaml_raises(self) -> None:
        from wavecore.api.services.tests.service import _parse_test_file

        with pytest.raises(ValidationException, match="Invalid YAML"):
            _parse_test_file(b"{{: invalid:\nyaml: [", "test.yaml")

    def test_parse_unsupported_format_raises(self) -> None:
        from wavecore.api.services.tests.service import _parse_test_file

        with pytest.raises(ValidationException, match="Unsupported file format"):
            _parse_test_file(b"<xml/>", "test.xml")

    def test_parse_non_dict_raises(self) -> None:
        from wavecore.api.services.tests.service import _parse_test_file

        content = json.dumps([1, 2, 3]).encode()
        with pytest.raises(ValidationException, match="Expected a mapping"):
            _parse_test_file(content, "test.json")


class TestParseZipFile:
    """Tests for _parse_zip_file helper."""

    def test_parse_valid_zip(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("t1.yaml", yaml.dump({"name": "T1"}))
            zf.writestr("t2.json", json.dumps({"name": "T2"}))
        documents, files_by_old_id = _parse_zip_file(buf.getvalue())
        assert len(documents) == 2
        names = {d[1]["name"] for d in documents}
        assert names == {"T1", "T2"}
        assert files_by_old_id == {}

    def test_parse_zip_ignores_non_test_files(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("readme.txt", "ignore me")
            zf.writestr("t1.yaml", yaml.dump({"name": "T1"}))
        documents, _files = _parse_zip_file(buf.getvalue())
        assert len(documents) == 1

    def test_parse_zip_ignores_macos_metadata(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("__MACOSX/t1.yaml", yaml.dump({"name": "hidden"}))
            zf.writestr("t1.yaml", yaml.dump({"name": "T1"}))
        documents, _files = _parse_zip_file(buf.getvalue())
        assert len(documents) == 1
        assert documents[0][1]["name"] == "T1"

    def test_parse_empty_zip_raises(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w"):
            pass
        with pytest.raises(ValidationException, match="no importable files"):
            _parse_zip_file(buf.getvalue())

    def test_parse_invalid_zip_raises(self) -> None:
        from wavecore.api.services.tests.service import _parse_zip_file

        with pytest.raises(ValidationException, match="Invalid ZIP"):
            _parse_zip_file(b"not a zip file")


class TestExportTestService:
    """Tests for export_test service function."""

    def test_export_yaml(self) -> None:
        from wavecore.api.services.tests.service import export_test

        test = _make_test("Export Me")
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = test
            result = export_test(test["id"], "yaml", "mask")

        assert result is not None
        content, filename, media_type = result
        assert filename == "Export-Me.yaml"
        assert media_type == "application/x-yaml"
        parsed = yaml.safe_load(content)
        assert parsed["name"] == "Export Me"

    def test_export_json(self) -> None:
        from wavecore.api.services.tests.service import export_test

        test = _make_test("JSON Export")
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = test
            result = export_test(test["id"], "json", "mask")

        assert result is not None
        content, filename, media_type = result
        assert filename == "JSON-Export.json"
        assert media_type == "application/json"
        parsed = json.loads(content)
        assert parsed["name"] == "JSON Export"

    def test_export_mask_mode_replaces_secret_with_placeholder(self) -> None:
        from wavecore.api.services.tests.service import export_test

        test = _make_test("Secret", variables=_sealed_secret_variables())
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = test
            result = export_test(test["id"], "yaml", "mask")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["api_key"]["value"] == MASK_PLACEHOLDER
        assert parsed["variables"]["api_key"]["masked"] is True
        assert parsed["variables"]["host"]["value"] == "db.example.com"

    def test_export_encrypted_mode_emits_sealed_envelope(self) -> None:
        from wavecore.api.services.tests.service import export_test

        variables = _sealed_secret_variables()
        test = _make_test("Secret", variables=variables)
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = test
            result = export_test(test["id"], "yaml", "encrypted")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["api_key"]["value"] == variables["api_key"]["value"]
        assert is_secret_envelope(parsed["variables"]["api_key"]["value"])
        assert parsed["variables"]["host"]["value"] == "db.example.com"

    def test_export_plaintext_mode_decrypts_secret(self) -> None:
        from wavecore.api.services.tests.service import export_test

        test = _make_test("Secret", variables=_sealed_secret_variables())
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = test
            result = export_test(test["id"], "yaml", "plaintext")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["api_key"]["value"] == "sk-12345-classified"
        assert parsed["variables"]["host"]["value"] == "db.example.com"

    def test_export_plaintext_undecryptable_raises_conflict(self) -> None:
        from wavecore.api.services.tests.service import export_test

        test = _make_test(
            "Foreign",
            variables={
                "api_key": {"type": "string", "value": _foreign_envelope("x"), "secret": True}
            },
        )
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = test
            with pytest.raises(ConflictException) as exc_info:
                export_test(test["id"], "yaml", "plaintext")

        assert str(exc_info.value) == _DECRYPTION_FAILED_MESSAGE

    def test_export_not_found(self) -> None:
        from wavecore.api.services.tests.service import export_test

        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = None
            result = export_test("nonexistent", "yaml", "mask")

        assert result is None


class TestExportFunctionSecrets:
    """A Test export applies its secrets mode to Function-local secrets and secret
    output defaults like any other secret (REQ-3.1.2.9, REQ-3.1.3.5)."""

    _CANARY = "fn-secret-classified-41"

    def _exported(self, place: str, stored_value: Any, mode: str) -> dict[str, Any]:
        from wavecore.api.services.tests.service import export_test

        document = _secret_test_document(place, stored_value)
        test = _make_test(document["name"], workflow=document["workflow"])
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = test
            result = export_test(test["id"], "yaml", mode)

        assert result is not None
        parsed: dict[str, Any] = yaml.safe_load(result[0])
        return parsed

    @pytest.mark.parametrize("place", _FUNCTION_SECRET_PLACES)
    def test_mask_mode_writes_the_placeholder(self, place: str) -> None:
        parsed = self._exported(place, seal_value(self._CANARY), "mask")

        assert _stored_secret(place, parsed) == (MASK_PLACEHOLDER, True)

    @pytest.mark.parametrize("place", _FUNCTION_SECRET_PLACES)
    def test_encrypted_mode_writes_the_stored_envelope(self, place: str) -> None:
        sealed = seal_value(self._CANARY)

        parsed = self._exported(place, sealed, "encrypted")

        assert _stored_secret(place, parsed) == (sealed, True)

    @pytest.mark.parametrize("place", _FUNCTION_SECRET_PLACES)
    def test_plaintext_mode_writes_the_opened_value(self, place: str) -> None:
        parsed = self._exported(place, seal_value(self._CANARY), "plaintext")

        assert _stored_secret(place, parsed) == (self._CANARY, True)


class TestExportTestsBatchService:
    """Tests for export_tests_batch service function."""

    def test_batch_export_multiple(self) -> None:
        from wavecore.api.services.tests.service import export_tests_batch

        t1 = _make_test("Alpha", test_id="id1")
        t2 = _make_test("Beta", test_id="id2")
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.side_effect = lambda tid: t1 if tid == "id1" else t2
            documents, files = export_tests_batch(["id1", "id2"], "yaml", "mask")

        assert len(documents) == 2
        assert documents[0][0] == "id1"
        assert documents[1][0] == "id2"
        assert files == []

    def test_batch_export_not_found_raises(self) -> None:
        from wavecore.api.services.tests.service import export_tests_batch

        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.return_value = None
            with pytest.raises(ValidationException, match="Test not found"):
                export_tests_batch(["missing-id"], "yaml", "mask")

    def test_batch_export_dedup_filenames(self) -> None:
        from wavecore.api.services.tests.service import export_tests_batch

        # Two tests with the same name produce deduplicated filenames
        t1 = _make_test("Same", test_id="id1")
        t2 = _make_test("Same", test_id="id2")
        with patch("wavecore.api.services.tests.service._load_test") as mock_load:
            mock_load.side_effect = lambda tid: t1 if tid == "id1" else t2
            documents, _files = export_tests_batch(["id1", "id2"], "yaml", "mask")

        filenames = [d[2] for d in documents]
        assert filenames[0] == "Same.yaml"
        assert filenames[1] == "Same-2.yaml"


def _seed_testdata(test_id: str) -> None:
    """Give a test two files in its own test data folder."""
    from wavecore.api.services import storage_paths

    root = storage_paths.get_test_testdata_path(test_id)
    (root / "sub").mkdir(parents=True, exist_ok=True)
    (root / "rows.csv").write_bytes(b"id,name\n")
    (root / "sub" / "notes.txt").write_bytes(b"notes")


class TestExportTestWithTestData:
    """A test that carries files exports as an archive (REQ-3.4.3.2)."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        from wavecore.api.services.tests import service as test_service

        test_service._clear_storage()

    def test_a_test_without_files_exports_the_document(self) -> None:
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Plain Test"})
        result = test_service.export_test(created["id"], "yaml", "mask")

        assert result is not None
        content, filename, media_type = result
        assert filename == "Plain-Test.yaml"
        assert media_type == "application/x-yaml"
        assert yaml.safe_load(content)["name"] == "Plain Test"

    def test_a_test_with_files_exports_a_zip(self) -> None:
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Rich Test"})
        _seed_testdata(created["id"])

        result = test_service.export_test(created["id"], "yaml", "mask")

        assert result is not None
        content, filename, media_type = result
        assert filename == "Rich-Test.zip"
        assert media_type == "application/zip"
        zf = zipfile.ZipFile(io.BytesIO(content))
        assert set(zf.namelist()) == {
            "Rich-Test.yaml",
            f"testdata/{created['id']}/rows.csv",
            f"testdata/{created['id']}/sub/notes.txt",
        }
        assert zf.read(f"testdata/{created['id']}/rows.csv") == b"id,name\n"
        assert yaml.safe_load(zf.read("Rich-Test.yaml"))["name"] == "Rich Test"

    def test_the_json_document_keeps_its_extension_inside_the_zip(self) -> None:
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Rich Test"})
        _seed_testdata(created["id"])

        result = test_service.export_test(created["id"], "json", "mask")

        assert result is not None
        content, filename, media_type = result
        assert filename == "Rich-Test.zip"
        assert media_type == "application/zip"
        zf = zipfile.ZipFile(io.BytesIO(content))
        assert "Rich-Test.json" in zf.namelist()
        assert json.loads(zf.read("Rich-Test.json"))["name"] == "Rich Test"


class TestExportTestsBatchWithTestData:
    """export_tests_batch hands the route the documents and the files."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        from wavecore.api.services.tests import service as test_service

        test_service._clear_storage()

    def test_files_of_every_selected_test_are_listed(self) -> None:
        from wavecore.api.services.tests import service as test_service

        rich = test_service.create_test({"name": "Rich"})
        plain = test_service.create_test({"name": "Plain"})
        _seed_testdata(rich["id"])

        documents, files = test_service.export_tests_batch(
            [rich["id"], plain["id"]], "yaml", "mask"
        )

        assert [d[0] for d in documents] == [rich["id"], plain["id"]]
        assert sorted((tid, rel) for tid, rel, _path in files) == [
            (rich["id"], "rows.csv"),
            (rich["id"], "sub/notes.txt"),
        ]
        by_rel = {rel: path for _tid, rel, path in files}
        assert by_rel["rows.csv"].read_bytes() == b"id,name\n"

    def test_no_files_yields_an_empty_files_list(self) -> None:
        from wavecore.api.services.tests import service as test_service

        plain = test_service.create_test({"name": "Plain"})

        documents, files = test_service.export_tests_batch([plain["id"]], "yaml", "mask")

        assert len(documents) == 1
        assert files == []


class TestValidateTestImportService:
    """Tests for validate_test_import service function."""

    def test_validate_ok(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump({"name": "Good Test", "workflow": {"nodes": [], "edges": []}}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = []
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = validate_test_import(content, "test.yaml")

        assert result["total"] == 1
        assert result["importable"] == 1
        assert result["blocked"] == 0
        assert result["tests"][0]["status"] == "ok"

    def test_validate_conflict(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump({"name": "Existing", "workflow": {"nodes": [], "edges": []}}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = [{"name": "Existing", "id": "old-id"}]
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = validate_test_import(content, "test.yaml")

        assert result["tests"][0]["status"] == "conflict"
        assert result["tests"][0]["existing_test_id"] == "old-id"

    def test_validate_fatal(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump({"name": "Bad"}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = []
            mock_val.return_value = {
                "fatal": True,
                "errors": [{"code": "FATAL", "message": "broken"}],
                "warnings": [],
            }
            result = validate_test_import(content, "bad.yaml")

        assert result["blocked"] == 1
        assert result["tests"][0]["status"] == "fatal"
        assert len(result["tests"][0]["fatal_errors"]) == 1

    def test_validate_fixable(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump({"name": "Fixable"}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = []
            mock_val.return_value = {
                "fatal": False,
                "errors": [{"code": "MISSING_POSITION", "message": "no pos"}],
                "warnings": [],
            }
            result = validate_test_import(content, "fix.yaml")

        assert result["tests"][0]["status"] == "fixable"
        assert len(result["tests"][0]["fixable_errors"]) == 1

    def test_validate_zip(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("t1.yaml", yaml.dump({"name": "T1"}))
            zf.writestr("t2.yaml", yaml.dump({"name": "T2"}))
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = []
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = validate_test_import(buf.getvalue(), "tests.zip")

        assert result["total"] == 2
        assert result["importable"] == 2

    def test_validate_unsupported_format(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        with pytest.raises(ValidationException, match="Unsupported"):
            validate_test_import(b"data", "test.xml")

    def test_validate_conflict_does_not_override_fatal(self) -> None:
        """A fatal test with a name conflict stays fatal, not conflict."""
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump({"name": "Existing"}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = [{"name": "Existing", "id": "old-id"}]
            mock_val.return_value = {
                "fatal": True,
                "errors": [{"code": "FATAL", "message": "broken"}],
                "warnings": [],
            }
            result = validate_test_import(content, "test.yaml")

        assert result["tests"][0]["status"] == "fatal"

    def test_validate_flags_foreign_encrypted_secret(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump(
            {
                "name": "Foreign Secret",
                "workflow": {"nodes": [], "edges": []},
                "variables": {
                    "api_key": {"type": "string", "value": _foreign_envelope("x"), "secret": True}
                },
            }
        ).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = []
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = validate_test_import(content, "test.yaml")

        assert {
            "code": "FOREIGN_ENCRYPTED_SECRET",
            "message": (
                "Secret 'api_key' is encrypted by another WAVE instance and "
                "cannot be decrypted here; re-enter it after import"
            ),
        } in result["tests"][0]["warnings"]

    def test_validate_local_secret_yields_no_foreign_warning(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump(
            {
                "name": "Local Secret",
                "workflow": {"nodes": [], "edges": []},
                "variables": seal_variables(
                    {"api_key": {"type": "string", "value": "local", "secret": True}}
                ),
            }
        ).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = []
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = validate_test_import(content, "test.yaml")

        codes = {w["code"] for w in result["tests"][0]["warnings"]}
        assert "FOREIGN_ENCRYPTED_SECRET" not in codes


class TestImportTestsService:
    """Tests for import_tests service function."""

    def test_import_creates_test(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump({"name": "New", "workflow": {"nodes": [], "edges": []}}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = import_tests(content, "test.yaml")

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "created"
        mock_save.assert_called_once()

    def test_import_skip_conflict(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump({"name": "Existing", "workflow": {"nodes": [], "edges": []}}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = [{"name": "Existing", "id": "old-id"}]
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = import_tests(content, "test.yaml", {"Existing": "skip"})

        assert result["total_skipped"] == 1
        assert result["total_imported"] == 0
        mock_save.assert_not_called()

    def test_import_overwrite_conflict(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump({"name": "Existing", "workflow": {"nodes": [], "edges": []}}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = [{"name": "Existing", "id": "old-id"}]
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = import_tests(content, "test.yaml", {"Existing": "overwrite"})

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "overwritten"
        assert result["imported"][0]["id"] == "old-id"
        saved = mock_save.call_args[0][0]
        assert saved["id"] == "old-id"

    def test_import_rename_conflict(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump({"name": "Existing", "workflow": {"nodes": [], "edges": []}}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
            patch("wavecore.api.services.tests.service._generate_unique_name") as mock_unique,
        ):
            mock_list.return_value = [{"name": "Existing", "id": "old-id"}]
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            mock_unique.return_value = "Existing (2)"
            result = import_tests(content, "test.yaml", {"Existing": "rename"})

        assert result["total_imported"] == 1
        assert result["imported"][0]["action"] == "renamed"
        assert result["imported"][0]["name"] == "Existing (2)"
        mock_save.assert_called_once()

    def test_import_fatal_raises(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump({"name": "Bad"}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
        ):
            mock_list.return_value = []
            mock_val.return_value = {
                "fatal": True,
                "errors": [{"code": "FATAL", "message": "broken"}],
                "warnings": [],
            }
            with pytest.raises(ValidationException, match="Fatal validation errors"):
                import_tests(content, "bad.yaml")

    def test_import_auto_fixes(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        test_data = {
            "name": "Fixable",
            "workflow": {
                "nodes": [{"id": "n1", "type": "plugin", "data": {}}],
                "edges": [],
            },
        }
        content = yaml.dump(test_data).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test"),
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            mock_val.return_value = {
                "fatal": False,
                "errors": [{"code": "MISSING_POSITION", "node_id": "n1", "message": "no pos"}],
                "warnings": [],
            }
            result = import_tests(content, "test.yaml")

        assert result["total_imported"] == 1
        assert len(result["fixes_applied"]) == 1
        assert "position" in result["fixes_applied"][0]["fixes"][0].lower()

    def test_import_auto_fix_missing_label(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        test_data = {
            "name": "LabelFix",
            "workflow": {
                "nodes": [
                    {
                        "id": "n1",
                        "type": "plugin",
                        "position": {"x": 0, "y": 0},
                        "data": {"elementType": "http-client"},
                    }
                ],
                "edges": [],
            },
        }
        content = yaml.dump(test_data).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test"),
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            mock_val.return_value = {
                "fatal": False,
                "errors": [{"code": "MISSING_LABEL", "node_id": "n1", "message": "no label"}],
                "warnings": [],
            }
            result = import_tests(content, "test.yaml")

        assert len(result["fixes_applied"]) == 1
        (fix,) = result["fixes_applied"][0]["fixes"]
        assert re.fullmatch(r"^Added name '.+' to block n1$", fix)

    def test_import_auto_fix_missing_node_id(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        test_data = {
            "name": "NoID",
            "workflow": {
                "nodes": [{"type": "plugin", "position": {"x": 0, "y": 0}, "data": {"label": "A"}}],
                "edges": [],
            },
        }
        content = yaml.dump(test_data).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test"),
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            mock_val.return_value = {
                "fatal": False,
                "errors": [{"code": "MISSING_NODE_ID", "message": "no id"}],
                "warnings": [],
            }
            result = import_tests(content, "test.yaml")

        assert len(result["fixes_applied"]) == 1
        (fix,) = result["fixes_applied"][0]["fixes"]
        assert re.fullmatch(r"^Generated missing block ID$", fix)

    def test_import_auto_fix_missing_assertion_ids(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        test_data = {
            "name": "AssertNoIDs",
            "workflow": {
                "nodes": [
                    {
                        "id": "assert-1",
                        "type": "workflowNode",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "elementType": "assert",
                            "nodeType": "control",
                            "version": "1.0.0",
                            "label": "Assert",
                            "config": {
                                "values": {
                                    "assertions": [
                                        {
                                            "type": "literal",
                                            "variable": "x",
                                            "value_type": "string",
                                            "operator": "equals",
                                            "reference_value": "hi",
                                            "reference_is_expression": False,
                                        },
                                    ],
                                    "mode": "single",
                                }
                            },
                        },
                    }
                ],
                "edges": [],
            },
        }
        content = yaml.dump(test_data).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test"),
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            mock_val.return_value = {
                "fatal": False,
                "errors": [
                    {
                        "code": "MISSING_ASSERTION_ID",
                        "node_id": "assert-1",
                        "message": "missing assertion IDs",
                    }
                ],
                "warnings": [],
            }
            result = import_tests(content, "test.yaml")

        assert len(result["fixes_applied"]) == 1
        assert "assertion IDs" in result["fixes_applied"][0]["fixes"][0]

    def test_import_zip(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "t1.yaml", yaml.dump({"name": "T1", "workflow": {"nodes": [], "edges": []}})
            )
            zf.writestr(
                "t2.yaml", yaml.dump({"name": "T2", "workflow": {"nodes": [], "edges": []}})
            )
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test"),
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = import_tests(buf.getvalue(), "tests.zip")

        assert result["total_imported"] == 2

    def test_import_unsupported_format(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        with pytest.raises(ValidationException, match="Unsupported"):
            import_tests(b"data", "test.xml")

    def test_import_default_skip_on_conflict_without_resolution(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump({"name": "Existing", "workflow": {"nodes": [], "edges": []}}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = [{"name": "Existing", "id": "old-id"}]
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            # No resolution provided - should default to skip
            result = import_tests(content, "test.yaml")

        assert result["total_skipped"] == 1
        mock_save.assert_not_called()

    def test_import_none_conflict_resolutions(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump({"name": "New", "workflow": {"nodes": [], "edges": []}}).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._validate_test_data") as mock_val,
            patch("wavecore.api.services.tests.service._save_test"),
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            mock_val.return_value = {"errors": [], "warnings": [], "fatal": False}
            result = import_tests(content, "test.yaml", None)

        assert result["total_imported"] == 1


def _mutating_test_payload(name: str = "Mutating Import") -> dict[str, Any]:
    """An exported test whose Log message would change a variable."""
    return {
        "name": name,
        "workflow": {
            "nodes": [
                {
                    "id": "n1",
                    "type": "workflowNode",
                    "position": {"x": 100, "y": 100},
                    "data": {
                        "elementType": "log",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "label": "Log",
                        "config": {"values": {"message": "{{rows.append(9)}}", "level": "INFO"}},
                        "templateFields": ["message"],
                    },
                }
            ],
            "edges": [],
        },
        "variables": {"rows": {"type": "array", "value": [1]}},
    }


def _reading_test_payload(name: str = "Reading Import") -> dict[str, Any]:
    """The same test with a message that only reads."""
    payload = _mutating_test_payload(name)
    node = payload["workflow"]["nodes"][0]
    node["data"]["config"]["values"]["message"] = "count={{len(rows)}}"
    return payload


_MUTATING_REFUSAL = (
    "The append method changes data. An expression can only read data, "
    "not change it. To change a variable, add a Variable Setter Block. "
    "Block: Log. Field: message."
)


class TestImportRefusesExpressionsThatChangeData:
    """The save gate refuses a mutating expression; import refuses the same content."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_import_refuses_and_saves_nothing(self) -> None:
        from wavecore.api.services.tests.service import (
            ReadOnlyExpressionImportError,
            import_tests,
        )

        content = yaml.dump(_mutating_test_payload()).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            with pytest.raises(ReadOnlyExpressionImportError) as exc_info:
                import_tests(content, "mutating.yaml")

        assert exc_info.value.message == (
            f"Cannot import test 'Mutating Import'. {_MUTATING_REFUSAL}"
        )
        assert [e["code"] for e in exc_info.value.errors] == ["EXPRESSION_CHANGES_DATA"]
        mock_save.assert_not_called()

    def test_a_reading_expression_still_imports(self) -> None:
        from wavecore.api.services.tests.service import import_tests

        content = yaml.dump(_reading_test_payload()).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            result = import_tests(content, "reading.yaml")

        assert result["total_imported"] == 1
        mock_save.assert_called_once()

    def test_the_import_preview_reports_it_as_blocked(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump(_mutating_test_payload()).encode()
        with patch("wavecore.api.services.tests.service._list_all_tests") as mock_list:
            mock_list.return_value = []
            result = validate_test_import(content, "mutating.yaml")

        item = result["tests"][0]
        assert item["status"] == "fatal"
        assert [e["code"] for e in item["fatal_errors"]] == ["EXPRESSION_CHANGES_DATA"]
        assert item["fatal_errors"][0]["message"] == _MUTATING_REFUSAL
        assert result["blocked"] == 1
        assert result["importable"] == 0

    def test_the_endpoint_answers_422_with_the_plain_message(self, client: TestClient) -> None:
        content = yaml.dump(_mutating_test_payload("Endpoint Mutating"))
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("mutating.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "EXPRESSION_CHANGES_DATA"
        assert error["message"] == (f"Cannot import test 'Endpoint Mutating'. {_MUTATING_REFUSAL}")
        assert [e["code"] for e in error["details"]] == ["EXPRESSION_CHANGES_DATA"]
        mock_save.assert_not_called()


_REFUSED_VALUE = "Value for variable 'retries' is not a valid integer"


def _refused_value_payload(name: str = "Refused Value") -> dict[str, Any]:
    """A Test whose integer variable holds 80.5, which the number rule refuses (REQ-3.1.3.14)."""
    return {
        "name": name,
        "workflow": {"nodes": [], "edges": []},
        "variables": {"retries": {"type": "integer", "value": "80.5", "scope": "test"}},
    }


class TestImportRefusesVariableValuesTheRuleRefuses:
    """A variable value the save refuses is blocked at import: nothing can fix it."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_the_import_preview_blocks_it_naming_the_variable(self) -> None:
        from wavecore.api.services.tests.service import validate_test_import

        content = yaml.dump(_refused_value_payload()).encode()
        with patch("wavecore.api.services.tests.service._list_all_tests") as mock_list:
            mock_list.return_value = []
            result = validate_test_import(content, "refused.yaml")

        item = result["tests"][0]
        assert item["status"] == "fatal"
        assert [(e["code"], e["message"]) for e in item["fatal_errors"]] == [
            ("INVALID_VARIABLE_VALUE", _REFUSED_VALUE)
        ]
        assert item["fixable_errors"] == []
        assert result["blocked"] == 1
        assert result["importable"] == 0

    def test_the_import_refuses_it_and_saves_nothing(self) -> None:
        from wavecore.api.services.tests.service import VariableValueImportError, import_tests

        content = yaml.dump(_refused_value_payload()).encode()
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            with pytest.raises(VariableValueImportError) as exc_info:
                import_tests(content, "refused.yaml")

        assert exc_info.value.message == _REFUSED_VALUE
        mock_save.assert_not_called()

    def test_the_endpoint_answers_400_naming_the_variable(self, client: TestClient) -> None:
        content = yaml.dump(_refused_value_payload("Endpoint Refused"))
        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_list,
            patch("wavecore.api.services.tests.service._save_test") as mock_save,
            patch("wavecore.api.services.tests.service._save_versions"),
        ):
            mock_list.return_value = []
            response = client.post(
                "/tests/import",
                data={"conflict_resolutions": "{}"},
                files={"file": ("refused.yaml", content, "application/x-yaml")},
            )

        assert response.status_code == 400
        assert response.json()["error"] == {
            "message": _REFUSED_VALUE,
            "code": "INVALID_VARIABLE_VALUE",
        }
        mock_save.assert_not_called()


class TestExportKeepsTheWholeFileName:
    """A Test named with text outside plain ASCII exports under its whole name (REQ-4.6.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def test_id(self, client: TestClient) -> str:
        response = client.post(
            "/tests", json={"name": ENTITY_NAME, "workflow": {"nodes": [], "edges": []}}
        )
        assert response.status_code == 201, response.text
        return str(response.json()["data"]["id"])

    @pytest.mark.parametrize("fmt", ["yaml", "json"])
    def test_single_export(self, client: TestClient, test_id: str, fmt: str) -> None:
        response = client.get(f"/tests/{test_id}/export", params={"format": fmt})

        assert_whole_name(response, f"{EXPORT_STEM}.{fmt}")

    def test_bulk_export_of_one(self, client: TestClient, test_id: str) -> None:
        response = client.post("/tests/export", json={"test_ids": [test_id], "format": "yaml"})

        assert_whole_name(response, f"{EXPORT_STEM}.yaml")

    def test_bulk_export_of_one_with_test_data_names_the_archive(
        self, client: TestClient, test_id: str
    ) -> None:
        folder = get_test_testdata_path(test_id)
        folder.mkdir(parents=True)
        (folder / "rows.csv").write_bytes(b"id,name\n")

        response = client.post("/tests/export", json={"test_ids": [test_id], "format": "yaml"})

        assert_whole_name(response, f"{EXPORT_STEM}.zip")
        assert "application/zip" in response.headers["content-type"]


class TestImportWithAnUnknownConflictChoice:
    """An unknown conflict choice falls back to skip, so no second Test gets the name."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_the_existing_test_is_kept_and_the_import_is_skipped(self, client: TestClient) -> None:
        document = {"name": "Same", "workflow": {"nodes": [], "edges": []}}
        assert client.post("/tests", json=document).status_code == 201

        response = client.post(
            "/tests/import",
            data={"conflict_resolutions": json.dumps({"Same": "bogus"})},
            files={"file": ("test.yaml", yaml.dump(document), "application/x-yaml")},
        )

        data = response.json()["data"]
        assert response.status_code == 200
        assert data["imported"] == []
        assert data["skipped"] == [{"name": "Same", "reason": "skipped by user"}]
        assert [test["name"] for test in client.get("/tests").json()["data"]] == ["Same"]


class TestImportStoresNumbersInWireForm:
    """REQ-3.1.3.14: an imported Test file's typed numbers are stored in wire form."""

    def test_a_json_file_with_exponent_and_big_numbers_is_stored_in_wire_form(self) -> None:
        from tests.api.wire_number_cases import (
            SENT_HTTP_NUMBERS,
            SENT_VARIABLES,
            STORED_HTTP_NUMBERS,
            STORED_VARIABLES,
            http_node,
            http_numbers,
        )
        from wavecore.api.services.tests import service as test_service
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.http_client import HTTPClientPlugin

        register_plugin(HTTPClientPlugin())
        document = {
            "name": "Wire Numbers",
            "workflow": {"nodes": [http_node(**SENT_HTTP_NUMBERS)], "edges": []},
            "variables": SENT_VARIABLES,
        }

        result = test_service.import_tests(json.dumps(document).encode(), "import.json")
        stored = test_service._load_test(result["imported"][0]["id"])

        assert stored is not None
        assert http_numbers(stored["workflow"]["nodes"][0]) == STORED_HTTP_NUMBERS
        assert stored["variables"] == STORED_VARIABLES
