"""Unit tests for system variable import/export endpoints (REQ-5.2.4.9).

This module tests the synchronous system-variable export and import endpoints
providing server-side serialization of the whole system variables collection
with format selection, import validation, and conflict resolution.

Test Coverage:
- Export: YAML (real YAML, not JSON) and JSON formats, headers, content
  parity with GET /variables/system (secrets pre-masked), empty collection
- Import validation: ok / conflict / fatal classifications, ZIP archives,
  missing variables mapping, parse failures
- Import execution: create, overwrite, skip, default resolution, fatal
  skips, merge semantics, persistence round-trip
"""

import io
import json
import zipfile
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.api.download_name_helpers import ENTITY_NAME, assert_whole_name
from wavecore.api.services import variable_service
from wavecore.core.secrets.cipher import SecretCipher, is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import unseal_all


def _foreign_envelope(value: Any) -> str:
    """Seal a value under a key this instance does not hold (undecryptable here)."""
    return SecretCipher(bytes(range(1, 33))).seal(value)


def _reset_storage() -> None:
    """Reset module-level variable storage for test isolation."""
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False


def _make_client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _set_system_variables(client: TestClient, variables: dict[str, Any]) -> None:
    """Seed system variables through the public API."""
    response = client.post("/variables/system", json={"variables": variables})
    assert response.status_code == 200


def _get_system_variables(client: TestClient) -> dict[str, Any]:
    """Read system variables through the public API (masked view)."""
    response = client.get("/variables/system")
    assert response.status_code == 200
    return response.json()["data"]


def _yaml_file(variables: dict[str, Any], filename: str = "vars.yaml") -> tuple[str, str, str]:
    """Build a multipart YAML file tuple with a {variables: ...} document."""
    return (filename, yaml.dump({"variables": variables}), "application/x-yaml")


def _json_file(variables: dict[str, Any], filename: str = "vars.json") -> tuple[str, str, str]:
    """Build a multipart JSON file tuple with a {variables: ...} document."""
    return (filename, json.dumps({"variables": variables}), "application/json")


# ============================================================================
# Export
# ============================================================================


class TestExportSystemVariables:
    """Tests for GET /variables/system/export."""

    def setup_method(self) -> None:
        _reset_storage()

    @pytest.fixture
    def client(self) -> TestClient:
        return _make_client()

    def test_export_defaults_to_yaml(self, client: TestClient) -> None:
        """Export without format parameter returns YAML."""
        _set_system_variables(client, {"api_url": {"type": "string", "value": "http://x"}})

        response = client.get("/variables/system/export")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-yaml")
        assert (
            response.headers["content-disposition"]
            == 'attachment; filename="system-variables.yaml"'
        )

    def test_export_yaml_body_is_real_yaml_not_json(self, client: TestClient) -> None:
        """YAML export body is real YAML (yaml.dump), not JSON masquerading."""
        _set_system_variables(client, {"api_url": {"type": "string", "value": "http://x"}})

        response = client.get("/variables/system/export?format=yaml")

        parsed = yaml.safe_load(response.text)
        assert parsed["variables"]["api_url"]["value"] == "http://x"
        with pytest.raises(json.JSONDecodeError):
            json.loads(response.text)

    def test_export_json_format(self, client: TestClient) -> None:
        """JSON export returns parseable JSON with JSON headers."""
        _set_system_variables(client, {"timeout": {"type": "integer", "value": 30}})

        response = client.get("/variables/system/export?format=json")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert (
            response.headers["content-disposition"]
            == 'attachment; filename="system-variables.json"'
        )
        parsed = json.loads(response.text)
        assert parsed["variables"]["timeout"]["value"] == 30

    def test_export_default_mode_masks_secret_values(self, client: TestClient) -> None:
        """Default (mask) mode replaces secret values with the placeholder."""
        _set_system_variables(
            client,
            {
                "api_url": {"type": "string", "value": "http://x"},
                "token": {"type": "string", "value": "raw-secret", "secret": True},
            },
        )

        response = client.get("/variables/system/export?format=yaml")

        parsed = yaml.safe_load(response.text)
        assert parsed["variables"]["token"]["value"] == "********"
        assert parsed["variables"]["token"]["masked"] is True
        assert parsed["variables"]["api_url"]["value"] == "http://x"
        assert "raw-secret" not in response.text

    def test_export_encrypted_mode_emits_sealed_envelope(self, client: TestClient) -> None:
        """Encrypted mode reads the raw store and emits the sealed envelope."""
        _set_system_variables(
            client,
            {"token": {"type": "string", "value": "raw-secret", "secret": True}},
        )

        response = client.get("/variables/system/export?format=yaml&secrets=encrypted")

        parsed = yaml.safe_load(response.text)
        assert is_secret_envelope(parsed["variables"]["token"]["value"])
        assert "raw-secret" not in response.text

    def test_export_plaintext_mode_decrypts_secret_values(self, client: TestClient) -> None:
        """Plaintext mode decrypts the sealed store back to real values."""
        _set_system_variables(
            client,
            {"token": {"type": "string", "value": "raw-secret", "secret": True}},
        )

        response = client.get("/variables/system/export?format=yaml&secrets=plaintext")

        parsed = yaml.safe_load(response.text)
        assert parsed["variables"]["token"]["value"] == "raw-secret"

    def test_export_invalid_secrets_mode_returns_400(self, client: TestClient) -> None:
        """An unrecognized secrets mode is rejected with the shared message."""
        response = client.get("/variables/system/export?secrets=bogus")

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid secrets mode 'bogus'; must be 'mask', 'encrypted', or 'plaintext'"
        )

    def test_export_empty_collection(self, client: TestClient) -> None:
        """Empty system variables export as an empty variables mapping."""
        response = client.get("/variables/system/export")

        assert response.status_code == 200
        parsed = yaml.safe_load(response.text)
        assert parsed == {"variables": {}}

    def test_export_invalid_format_returns_400(self, client: TestClient) -> None:
        """Invalid format parameter returns 400 with exact message."""
        response = client.get("/variables/system/export?format=xml")

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"] == "Invalid format: 'xml'. Must be 'yaml' or 'json'"
        )


# ============================================================================
# Import Validation
# ============================================================================


class TestValidateSystemVariablesImport:
    """Tests for POST /variables/system/import/validate."""

    def setup_method(self) -> None:
        _reset_storage()

    @pytest.fixture
    def client(self) -> TestClient:
        return _make_client()

    def test_validate_new_variable_ok(self, client: TestClient) -> None:
        """A new, typed variable validates as ok."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": _yaml_file({"new_var": {"type": "string", "value": "x"}})},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["items"] == [
            {
                "name": "new_var",
                "status": "ok",
                "fatal_errors": [],
                "fixable_errors": [],
                "warnings": [],
                "existing_id": None,
            }
        ]
        assert data["total"] == 1
        assert data["importable"] == 1
        assert data["blocked"] == 0

    def test_validate_foreign_encrypted_secret_warning(self, client: TestClient) -> None:
        """A foreign-instance envelope produces a FOREIGN_ENCRYPTED_SECRET warning."""
        response = client.post(
            "/variables/system/import/validate",
            files={
                "file": _yaml_file(
                    {"token": {"type": "string", "value": _foreign_envelope("x"), "secret": True}}
                )
            },
        )

        assert response.status_code == 200
        item = response.json()["data"]["items"][0]
        assert item["status"] == "ok"
        foreign = next(w for w in item["warnings"] if w["code"] == "FOREIGN_ENCRYPTED_SECRET")
        assert foreign["message"] == (
            "Secret 'token' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        )

    def test_validate_json_file(self, client: TestClient) -> None:
        """JSON files validate the same as YAML files."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": _json_file({"json_var": {"type": "integer", "value": 1}})},
        )

        assert response.status_code == 200
        assert response.json()["data"]["items"][0]["status"] == "ok"

    def test_validate_conflict_when_name_exists(self, client: TestClient) -> None:
        """Existing variable name classifies as conflict with existing_id = name."""
        _set_system_variables(client, {"api_url": {"type": "string", "value": "old"}})

        response = client.post(
            "/variables/system/import/validate",
            files={"file": _yaml_file({"api_url": {"type": "string", "value": "new"}})},
        )

        assert response.status_code == 200
        item = response.json()["data"]["items"][0]
        assert item["status"] == "conflict"
        assert item["existing_id"] == "api_url"

    def test_validate_missing_type_fatal(self, client: TestClient) -> None:
        """Variable without a type is fatal with MISSING_TYPE."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": _yaml_file({"bad_var": {"value": "x"}})},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        item = data["items"][0]
        assert item["name"] == "bad_var"
        assert item["status"] == "fatal"
        assert item["fatal_errors"] == [{"code": "MISSING_TYPE", "message": "Missing type"}]
        assert data["importable"] == 0
        assert data["blocked"] == 1

    def test_validate_a_value_that_breaks_the_number_rule_fatal(self, client: TestClient) -> None:
        """A typed value that breaks the one number rule is fatal (REQ-3.1.3.14)."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": _yaml_file({"port": {"type": "integer", "value": "80.5"}})},
        )

        assert response.status_code == 200
        item = response.json()["data"]["items"][0]
        assert item["status"] == "fatal"
        assert item["fatal_errors"] == [
            {
                "code": "INVALID_VARIABLE_VALUE",
                "message": "Value for variable 'port' is not a valid integer",
            }
        ]

    def test_validate_bare_scalar_value_fatal(self, client: TestClient) -> None:
        """A bare scalar variable declaration has no type and is fatal."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": _yaml_file({"scalar_var": "just-a-value"})},
        )

        assert response.status_code == 200
        item = response.json()["data"]["items"][0]
        assert item["status"] == "fatal"
        assert item["fatal_errors"] == [{"code": "MISSING_TYPE", "message": "Missing type"}]

    def test_validate_mixed_statuses_summary_counts(self, client: TestClient) -> None:
        """Summary counts: conflicts are importable, fatals are blocked."""
        _set_system_variables(client, {"existing": {"type": "string", "value": "old"}})

        response = client.post(
            "/variables/system/import/validate",
            files={
                "file": _yaml_file(
                    {
                        "fresh": {"type": "string", "value": "a"},
                        "existing": {"type": "string", "value": "b"},
                        "untyped": {"value": "c"},
                    }
                )
            },
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 3
        assert data["importable"] == 2
        assert data["blocked"] == 1
        statuses = {item["name"]: item["status"] for item in data["items"]}
        assert statuses == {"fresh": "ok", "existing": "conflict", "untyped": "fatal"}

    def test_validate_zip_with_multiple_files(self, client: TestClient) -> None:
        """ZIP archives yield items from every importable file."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("a.yaml", yaml.dump({"variables": {"a1": {"type": "string", "value": 1}}}))
            zf.writestr(
                "b.json", json.dumps({"variables": {"b1": {"type": "integer", "value": 2}}})
            )
        buf.seek(0)

        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.zip", buf.getvalue(), "application/zip")},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 2
        names = {item["name"] for item in data["items"]}
        assert names == {"a1", "b1"}

    def test_validate_file_without_variables_mapping(self, client: TestClient) -> None:
        """A file lacking a variables mapping yields one fatal item."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.yaml", yaml.dump({"other": 1}), "application/x-yaml")},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1
        assert data["importable"] == 0
        assert data["blocked"] == 1
        item = data["items"][0]
        assert item["status"] == "fatal"
        assert item["fatal_errors"][0]["message"] == "No variables found in file"

    def test_validate_non_mapping_variables_key(self, client: TestClient) -> None:
        """A variables key that is not a mapping yields the same fatal item."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.yaml", yaml.dump({"variables": [1, 2]}), "application/x-yaml")},
        )

        assert response.status_code == 200
        item = response.json()["data"]["items"][0]
        assert item["status"] == "fatal"
        assert item["fatal_errors"][0]["message"] == "No variables found in file"

    def test_validate_invalid_yaml_returns_400(self, client: TestClient) -> None:
        """Malformed YAML returns 400 with exact parse message."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.yaml", "{{invalid yaml:", "application/x-yaml")},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "Invalid YAML: could not parse file"

    def test_validate_invalid_json_returns_400(self, client: TestClient) -> None:
        """Malformed JSON returns 400 with exact parse message."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.json", "{not json", "application/json")},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "Invalid JSON: could not parse file"

    def test_validate_non_mapping_document_returns_400(self, client: TestClient) -> None:
        """A file whose top level is not a mapping returns 400."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.yaml", "- a\n- b\n", "application/x-yaml")},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "File must contain a mapping/object"

    def test_validate_invalid_zip_returns_400(self, client: TestClient) -> None:
        """Corrupt ZIP bytes return 400 with exact message."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.zip", b"not a zip", "application/zip")},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "Invalid ZIP archive"

    def test_validate_empty_zip_returns_400(self, client: TestClient) -> None:
        """ZIP with no importable files returns 400 with exact message."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w"):
            pass
        buf.seek(0)

        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.zip", buf.getvalue(), "application/zip")},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "ZIP archive contains no importable files"

    def test_validate_unsupported_extension_returns_400(self, client: TestClient) -> None:
        """Unsupported file extension returns 400."""
        response = client.post(
            "/variables/system/import/validate",
            files={"file": ("vars.xml", "<vars/>", "application/xml")},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "Unsupported file format: 'vars.xml'"


# ============================================================================
# Import
# ============================================================================


class TestImportSystemVariables:
    """Tests for POST /variables/system/import."""

    def setup_method(self) -> None:
        _reset_storage()

    @pytest.fixture
    def client(self) -> TestClient:
        return _make_client()

    def test_import_new_variable_created(self, client: TestClient) -> None:
        """A new variable is created and reported with action 'created'."""
        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": _yaml_file({"fresh": {"type": "string", "value": "hello"}})},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["imported"] == [{"name": "fresh", "id": "fresh", "action": "created"}]
        assert data["skipped"] == []
        assert data["fixes_applied"] == []
        assert data["total_imported"] == 1
        assert data["total_skipped"] == 0

    def test_import_persists_via_variables_api(self, client: TestClient) -> None:
        """Imported variables are readable through GET /variables/system."""
        client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": _yaml_file({"persisted": {"type": "integer", "value": 42}})},
        )

        variables = _get_system_variables(client)["variables"]
        assert variables["persisted"]["value"] == 42
        assert variables["persisted"]["type"] == "integer"

    def test_import_overwrite_replaces_value_and_type(self, client: TestClient) -> None:
        """Overwrite resolution replaces the existing value and type."""
        _set_system_variables(client, {"api_url": {"type": "string", "value": "old"}})

        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": json.dumps({"api_url": "overwrite"})},
            files={"file": _yaml_file({"api_url": {"type": "integer", "value": 9}})},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["imported"] == [{"name": "api_url", "id": "api_url", "action": "overwritten"}]
        variables = _get_system_variables(client)["variables"]
        assert variables["api_url"]["value"] == 9
        assert variables["api_url"]["type"] == "integer"

    def test_import_skip_leaves_existing_untouched(self, client: TestClient) -> None:
        """Skip resolution keeps the existing variable and reports the skip."""
        _set_system_variables(client, {"api_url": {"type": "string", "value": "old"}})

        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": json.dumps({"api_url": "skip"})},
            files={"file": _yaml_file({"api_url": {"type": "string", "value": "new"}})},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["imported"] == []
        assert data["skipped"] == [{"name": "api_url", "reason": "skipped by user"}]
        assert data["total_imported"] == 0
        assert data["total_skipped"] == 1
        assert _get_system_variables(client)["variables"]["api_url"]["value"] == "old"

    def test_import_unspecified_conflict_defaults_to_overwrite(self, client: TestClient) -> None:
        """A conflict with no resolution entry is overwritten by default."""
        _set_system_variables(client, {"api_url": {"type": "string", "value": "old"}})

        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": _yaml_file({"api_url": {"type": "string", "value": "new"}})},
        )

        assert response.status_code == 200
        assert response.json()["data"]["imported"][0]["action"] == "overwritten"
        assert _get_system_variables(client)["variables"]["api_url"]["value"] == "new"

    def test_import_fatal_item_skipped_with_reason(self, client: TestClient) -> None:
        """A variable missing its type is skipped with reason 'Missing type'."""
        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": _yaml_file({"untyped": {"value": "x"}})},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["imported"] == []
        assert data["skipped"] == [{"name": "untyped", "reason": "Missing type"}]
        assert "untyped" not in _get_system_variables(client)["variables"]

    def test_import_merges_into_existing_collection(self, client: TestClient) -> None:
        """Import adds to the collection without dropping unrelated variables."""
        _set_system_variables(client, {"keep_me": {"type": "string", "value": "kept"}})

        client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": _yaml_file({"added": {"type": "string", "value": "new"}})},
        )

        variables = _get_system_variables(client)["variables"]
        assert variables["keep_me"]["value"] == "kept"
        assert variables["added"]["value"] == "new"

    def test_import_mixed_created_overwritten_skipped(self, client: TestClient) -> None:
        """One import can create, overwrite, and skip in a single pass."""
        _set_system_variables(
            client,
            {
                "overwrite_me": {"type": "string", "value": "old"},
                "skip_me": {"type": "string", "value": "old"},
            },
        )

        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": json.dumps({"skip_me": "skip"})},
            files={
                "file": _yaml_file(
                    {
                        "fresh": {"type": "string", "value": "a"},
                        "overwrite_me": {"type": "string", "value": "b"},
                        "skip_me": {"type": "string", "value": "c"},
                    }
                )
            },
        )

        assert response.status_code == 200
        data = response.json()["data"]
        actions = {item["name"]: item["action"] for item in data["imported"]}
        assert actions == {"fresh": "created", "overwrite_me": "overwritten"}
        assert data["skipped"] == [{"name": "skip_me", "reason": "skipped by user"}]
        assert data["total_imported"] == 2
        assert data["total_skipped"] == 1

    def test_import_zip_creates_variables_from_all_files(self, client: TestClient) -> None:
        """ZIP import processes every importable file in the archive."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "a.yaml", yaml.dump({"variables": {"a1": {"type": "string", "value": "1"}}})
            )
            zf.writestr(
                "b.yaml", yaml.dump({"variables": {"b1": {"type": "string", "value": "2"}}})
            )
        buf.seek(0)

        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": ("vars.zip", buf.getvalue(), "application/zip")},
        )

        assert response.status_code == 200
        assert response.json()["data"]["total_imported"] == 2
        variables = _get_system_variables(client)["variables"]
        assert "a1" in variables
        assert "b1" in variables

    def test_import_file_without_variables_mapping_imports_nothing(
        self, client: TestClient
    ) -> None:
        """A file lacking a variables mapping contributes nothing to the import."""
        _set_system_variables(client, {"keep_me": {"type": "string", "value": "kept"}})

        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": ("vars.yaml", yaml.dump({"other": 1}), "application/x-yaml")},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["imported"] == []
        assert data["skipped"] == []
        assert data["total_imported"] == 0
        assert data["total_skipped"] == 0
        assert _get_system_variables(client)["variables"]["keep_me"]["value"] == "kept"

    def test_import_invalid_yaml_returns_400(self, client: TestClient) -> None:
        """Malformed YAML returns the same 400 as validation."""
        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": ("vars.yaml", "{{invalid yaml:", "application/x-yaml")},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "Invalid YAML: could not parse file"

    def test_import_invalid_conflict_resolutions_json_returns_400(self, client: TestClient) -> None:
        """Invalid JSON in conflict_resolutions returns 400 with exact message."""
        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{not valid json!!!}"},
            files={"file": _yaml_file({"v": {"type": "string", "value": "x"}})},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "Invalid JSON in conflict_resolutions"

    def test_import_unsupported_extension_returns_400(self, client: TestClient) -> None:
        """Unsupported file extension returns 400."""
        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": ("vars.xml", "<vars/>", "application/xml")},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "Unsupported file format: 'vars.xml'"


class TestImportSystemVariableSecrets:
    """A system variable secret WAVE cannot open, or a masked placeholder, is stored as null
    and stays secret; a placeholder never replaces a secret stored at the same place
    (REQ-4.5.19, EXPORT-5, EXPORT-7)."""

    def setup_method(self) -> None:
        _reset_storage()

    @pytest.fixture
    def client(self) -> TestClient:
        return _make_client()

    @staticmethod
    def _declared(value: Any) -> dict[str, Any]:
        declared = {"type": "string", "value": value, "secret": True}
        if value == MASK_PLACEHOLDER:
            declared["masked"] = True
        return declared

    @pytest.mark.parametrize("kind", ["foreign", "masked"])
    def test_a_secret_wave_cannot_open_is_stored_as_null_and_stays_secret(
        self, client: TestClient, kind: str
    ) -> None:
        value = _foreign_envelope("sealed-elsewhere") if kind == "foreign" else MASK_PLACEHOLDER

        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": "{}"},
            files={"file": _yaml_file({"token": self._declared(value)})},
        )

        assert response.status_code == 200
        assert response.json()["data"]["imported"] == [
            {"name": "token", "id": "token", "action": "created"}
        ]
        stored = variable_service.get_system_variables_raw()["variables"]["token"]
        assert stored["value"] is None
        assert stored["secret"] is True

    def test_a_masked_placeholder_keeps_the_secret_stored_at_the_same_place(
        self, client: TestClient
    ) -> None:
        _set_system_variables(
            client, {"token": {"type": "string", "value": "kept-secret", "secret": True}}
        )

        response = client.post(
            "/variables/system/import",
            data={"conflict_resolutions": json.dumps({"token": "overwrite"})},
            files={"file": _yaml_file({"token": self._declared(MASK_PLACEHOLDER)})},
        )

        assert response.status_code == 200
        assert response.json()["data"]["imported"] == [
            {"name": "token", "id": "token", "action": "overwritten"}
        ]
        stored = variable_service.get_system_variables_raw()["variables"]["token"]
        assert unseal_all(stored["value"]) == "kept-secret"
        assert stored["secret"] is True


class TestExportKeepsTheWholeFileName:
    """An export name with text outside plain ASCII is sent whole (REQ-4.6.9)."""

    def test_a_name_outside_plain_ascii_is_sent_whole(self) -> None:
        name = f"{ENTITY_NAME}.yaml"
        with patch.object(
            variable_service,
            "export_system_variables",
            return_value=(b"variables: {}\n", name, "application/x-yaml"),
        ):
            response = _make_client().get("/variables/system/export")

        assert_whole_name(response, name)
