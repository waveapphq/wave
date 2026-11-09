"""Unit tests for regression import/export (REQ-6.2.5).

Tests the regression import/export service layer at
``wavecore.api.services.regressions.import_export`` following the suite import/export
pattern. Also tests the endpoint layer at ``/regressions/{id}/export``, ``/regressions/export``,
``/regressions/import/validate``, and ``/regressions/import``.

Test Coverage:
- Single regression export: YAML/JSON format, secret masking, not-found
- Bulk regression export: single file vs ZIP, filename dedup, 404
- Import validation: valid files, missing name, name conflict, unresolvable suites,
  masked secrets warning, ZIP multi-item, variable collision fatal
- Import execution: create new, skip/overwrite/rename conflict resolution,
  strips invalid suite IDs, fatal rejection, variable collision rejection
- Endpoint-level tests: status codes, headers, content-types
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

from tests.api.body_shape_support import NOT_ID_LIST_FIELDS, assert_refused
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
            "api_key": {"type": "string", "value": "real-key-classified", "secret": True},
            "host": {"type": "string", "value": "example.com"},
        }
    )


def _foreign_envelope(value: Any) -> str:
    """Seal a value under a key this instance does not hold (undecryptable here)."""
    return SecretCipher(bytes(range(1, 33))).seal(value)


def _make_regression(
    name: str = "Nightly Regression",
    *,
    regression_id: str | None = None,
    description: str = "Full nightly regression",
    suites: list[str] | None = None,
    variables: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Create a minimal regression dict for mocking."""
    return {
        "id": regression_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": description,
        "suites": suites or [],
        "tags": tags or ["nightly"],
        "variables": variables or {},
        "metadata": {},
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


# The module path that the route layer imports from.
# The regression import_export module, analogous to suite_import_export.
_SERVICE_MODULE = "wavecore.api.services.regressions.import_export"
_STORAGE_MODULE = "wavecore.api.services.regressions._storage"


# ============================================================================
# Service-level: Single Regression Export
# ============================================================================


class TestExportRegressionService:
    """Tests for the regression export_regression service function."""

    def test_export_regression_yaml(self) -> None:
        """export_regression returns YAML content and filename."""
        from wavecore.api.services.regressions import import_export

        regression = _make_regression("Smoke Regression")
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            result = import_export.export_regression(regression["id"], "yaml", "mask")

        assert result is not None
        content, filename = result
        assert filename == "Smoke-Regression.yaml"
        parsed = yaml.safe_load(content)
        assert parsed["name"] == "Smoke Regression"

    def test_export_regression_json(self) -> None:
        """export_regression returns JSON content and filename."""
        from wavecore.api.services.regressions import import_export

        regression = _make_regression("JSON Regression")
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            result = import_export.export_regression(regression["id"], "json", "mask")

        assert result is not None
        content, filename = result
        assert filename == "JSON-Regression.json"
        parsed = json.loads(content)
        assert parsed["name"] == "JSON Regression"

    def test_export_regression_mask_mode_replaces_secret_with_placeholder(self) -> None:
        from wavecore.api.services.regressions import import_export

        regression = _make_regression("Secret Regression", variables=_sealed_secret_variables())
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            result = import_export.export_regression(regression["id"], "yaml", "mask")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["api_key"]["value"] == MASK_PLACEHOLDER
        assert parsed["variables"]["api_key"]["masked"] is True
        assert parsed["variables"]["host"]["value"] == "example.com"

    def test_export_regression_encrypted_mode_emits_sealed_envelope(self) -> None:
        from wavecore.api.services.regressions import import_export

        variables = _sealed_secret_variables()
        regression = _make_regression("Secret Regression", variables=variables)
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            result = import_export.export_regression(regression["id"], "yaml", "encrypted")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["api_key"]["value"] == variables["api_key"]["value"]
        assert is_secret_envelope(parsed["variables"]["api_key"]["value"])

    def test_export_regression_plaintext_mode_decrypts_secret(self) -> None:
        from wavecore.api.services.regressions import import_export

        regression = _make_regression("Secret Regression", variables=_sealed_secret_variables())
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            result = import_export.export_regression(regression["id"], "yaml", "plaintext")

        assert result is not None
        parsed = yaml.safe_load(result[0])
        assert parsed["variables"]["api_key"]["value"] == "real-key-classified"

    def test_export_regression_plaintext_undecryptable_raises_conflict(self) -> None:
        from wavecore.api.services.regressions import import_export

        regression = _make_regression(
            "Foreign Regression",
            variables={
                "api_key": {"type": "string", "value": _foreign_envelope("x"), "secret": True}
            },
        )
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            with pytest.raises(ConflictException) as exc_info:
                import_export.export_regression(regression["id"], "yaml", "plaintext")

        assert str(exc_info.value) == _DECRYPTION_FAILED_MESSAGE

    def test_export_regression_not_found(self) -> None:
        """export_regression returns None for non-existent regression."""
        from wavecore.api.services.regressions import import_export

        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = None
            result = import_export.export_regression("nonexistent", "yaml", "mask")

        assert result is None

    def test_export_regression_includes_suite_references(self) -> None:
        """export_regression includes suite IDs in the exported data."""
        from wavecore.api.services.regressions import import_export

        suite_id_1 = str(uuid.uuid4())
        suite_id_2 = str(uuid.uuid4())
        regression = _make_regression(
            "With Suites",
            suites=[suite_id_1, suite_id_2],
        )
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            result = import_export.export_regression(regression["id"], "yaml", "mask")

        assert result is not None
        content, _filename = result
        parsed = yaml.safe_load(content)
        assert parsed["suites"] == [suite_id_1, suite_id_2]

    def test_export_regression_sanitizes_filename(self) -> None:
        """export_regression sanitizes special characters in the filename."""
        from wavecore.api.services.regressions import import_export

        regression = _make_regression("My Reg / Special & Chars!")
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            result = import_export.export_regression(regression["id"], "yaml", "mask")

        assert result is not None
        _content, filename = result
        # Special chars should be stripped/sanitized
        assert "/" not in filename
        assert "&" not in filename
        assert "!" not in filename


# ============================================================================
# Service-level: Batch Regression Export
# ============================================================================


class TestExportRegressionsBatchService:
    """Tests for regression batch export service function."""

    def test_batch_single(self) -> None:
        """Batch export of 1 regression returns list of 1."""
        from wavecore.api.services.regressions import import_export

        regression = _make_regression("Single")
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = regression
            results = import_export.export_regressions_batch([regression["id"]], "yaml", "mask")

        assert len(results) == 1
        assert results[0][0] == regression["id"]

    def test_batch_multiple(self) -> None:
        """Batch export of multiple regressions returns all."""
        from wavecore.api.services.regressions import import_export

        reg_a = _make_regression("A")
        reg_b = _make_regression("B")
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.side_effect = [reg_a, reg_b]
            results = import_export.export_regressions_batch(
                [reg_a["id"], reg_b["id"]], "yaml", False
            )

        assert len(results) == 2

    def test_batch_not_found_raises(self) -> None:
        """Batch export raises NotFoundException for missing regression."""
        from wavecore.api.services.regressions import import_export

        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.return_value = None
            with pytest.raises(NotFoundException):
                import_export.export_regressions_batch(["nonexistent"], "yaml", "mask")

    def test_batch_deduplicates_filenames(self) -> None:
        """Batch export deduplicates filenames when regressions have the same name."""
        from wavecore.api.services.regressions import import_export

        reg_a = _make_regression("Same Name", regression_id="id-a")
        reg_b = _make_regression("Same Name", regression_id="id-b")
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.side_effect = [reg_a, reg_b]
            results = import_export.export_regressions_batch(["id-a", "id-b"], "yaml", "mask")

        filenames = [r[2] for r in results]
        assert filenames[0] == "Same-Name.yaml"
        assert filenames[1] == "Same-Name-2.yaml"

    def test_batch_dedup_counter_increments_past_two(self) -> None:
        """Filename collision loop increments counter when '-2' is also taken."""
        from wavecore.api.services.regressions import import_export

        reg_a = _make_regression("Dup", regression_id="id-a")
        reg_b = _make_regression("Dup", regression_id="id-b")
        reg_c = _make_regression("Dup", regression_id="id-c")
        with patch(f"{_STORAGE_MODULE}._load_regression") as mock_load:
            mock_load.side_effect = [reg_a, reg_b, reg_c]
            results = import_export.export_regressions_batch(
                ["id-a", "id-b", "id-c"], "yaml", False
            )

        filenames = [r[2] for r in results]
        assert filenames[0] == "Dup.yaml"
        assert filenames[1] == "Dup-2.yaml"
        assert filenames[2] == "Dup-3.yaml"


class TestGenerateUniqueNameHelper:
    """Direct tests for the regression _generate_unique_name helper."""

    def test_returns_base_when_unused(self) -> None:
        """Returns base_name unchanged when no regression has that name."""
        from wavecore.api.services.regressions import import_export

        with patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]):
            assert import_export._generate_unique_name("Fresh Name") == "Fresh Name"

    def test_returns_suffix_two_on_first_collision(self) -> None:
        """Returns 'Name (2)' when the base name already exists once."""
        from wavecore.api.services.regressions import import_export

        existing = [{"name": "Taken"}]
        with patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=existing):
            assert import_export._generate_unique_name("Taken") == "Taken (2)"

    def test_counter_increments_past_two(self) -> None:
        """Counter increments when 'Name (2)' is also taken."""
        from wavecore.api.services.regressions import import_export

        existing = [{"name": "Taken"}, {"name": "Taken (2)"}, {"name": "Taken (3)"}]
        with patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=existing):
            assert import_export._generate_unique_name("Taken") == "Taken (4)"


class TestCheckImportCollisionsEdgeCases:
    """Edge cases in _check_import_collisions."""

    def test_item_with_no_existing_suites_is_skipped(self) -> None:
        """Items whose suite references all point to missing suites are skipped."""
        from wavecore.api.services.regressions import import_export

        item = {
            "name": "Orphan Import",
            "suites": ["missing-suite-1", "missing-suite-2"],
            "variables": {"env": {"type": "string", "value": "dev"}},
        }

        with patch(f"{_STORAGE_MODULE}._suite_exists", return_value=False):
            # Must not raise - the item is skipped because none of its suites exist yet.
            import_export._check_import_collisions([item])


# ============================================================================
# Service-level: Import Validation
# ============================================================================


class TestValidateRegressionImportService:
    """Tests for regression import validation service function."""

    def test_valid_regression(self) -> None:
        """Valid regression returns ok status."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Good Regression", "suites": []}
            result = import_export.validate_regression_import(b"x", "regression.yaml")

        assert result["total"] == 1
        assert result["importable"] == 1
        assert result["regressions"][0]["status"] == "ok"

    def test_a_variable_value_that_breaks_the_number_rule_is_fatal(self) -> None:
        """REQ-3.1.3.14: the preview refuses the value the regression save refuses."""
        from wavecore.api.services.regressions import import_export

        variables = {"ratio": {"type": "float", "value": "1e5"}}
        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Numbers", "suites": [], "variables": variables}
            result = import_export.validate_regression_import(b"x", "regression.yaml")

        assert result["regressions"][0]["status"] == "fatal"
        assert result["regressions"][0]["fatal_errors"] == [
            {
                "code": "INVALID_VARIABLE_VALUE",
                "message": "Value for variable 'ratio' is not a valid float",
            }
        ]

    def test_missing_name_fatal(self) -> None:
        """Regression without name returns fatal."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"description": "no name"}
            result = import_export.validate_regression_import(b"x", "regression.yaml")

        assert result["blocked"] == 1
        assert result["regressions"][0]["status"] == "fatal"
        assert result["regressions"][0]["fatal_errors"][0]["code"] == "MISSING_NAME"

    def test_name_conflict(self) -> None:
        """Existing name returns conflict with existing_regression_id."""
        from wavecore.api.services.regressions import import_export

        existing = _make_regression("Existing", regression_id="existing-id")
        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[existing]),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "suites": []}
            result = import_export.validate_regression_import(b"x", "regression.yaml")

        assert result["regressions"][0]["status"] == "conflict"
        assert result["regressions"][0]["existing_regression_id"] == "existing-id"

    def test_unresolvable_suites_fixable(self) -> None:
        """Non-existent suite IDs produce fixable errors."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_STORAGE_MODULE}._suite_exists", return_value=False),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Regression", "suites": ["bad-suite-id"]}
            result = import_export.validate_regression_import(b"x", "regression.yaml")

        assert result["regressions"][0]["status"] == "fixable"
        assert result["regressions"][0]["fixable_errors"][0]["code"] == "UNRESOLVABLE_SUITE"

    def test_masked_secrets_warning(self) -> None:
        """Masked variable values produce warnings but don't change status."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {
                "name": "Regression",
                "suites": [],
                "variables": {"token": {"type": "string", "value": "********", "secret": True}},
            }
            result = import_export.validate_regression_import(b"x", "regression.yaml")

        assert result["regressions"][0]["status"] == "ok"
        assert result["regressions"][0]["warnings"][0]["code"] == "MASKED_SECRET"

    def test_foreign_encrypted_secret_warning(self) -> None:
        """A foreign-instance envelope produces a FOREIGN_ENCRYPTED_SECRET warning."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {
                "name": "Regression",
                "suites": [],
                "variables": {
                    "token": {"type": "string", "value": _foreign_envelope("x"), "secret": True}
                },
            }
            result = import_export.validate_regression_import(b"x", "regression.yaml")

        assert result["regressions"][0]["status"] == "ok"
        foreign = next(
            w
            for w in result["regressions"][0]["warnings"]
            if w["code"] == "FOREIGN_ENCRYPTED_SECRET"
        )
        assert foreign["message"] == (
            "Secret 'token' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        )

    def test_zip_validates_all_items(self) -> None:
        """ZIP file validates all contained regressions."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_SERVICE_MODULE}.parse_zip_file") as mock_zip,
        ):
            mock_zip.return_value = [
                ("a.yaml", {"name": "A", "suites": []}),
                ("b.yaml", {"name": "B", "suites": []}),
            ]
            result = import_export.validate_regression_import(b"x", "regressions.zip")

        assert result["total"] == 2
        assert result["importable"] == 2

    def test_variable_collision_produces_fatal(self) -> None:
        """Regression with variable type collisions against its suites returns fatal."""
        from wavecore.api.services.regressions import import_export

        suite_id = str(uuid.uuid4())
        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_STORAGE_MODULE}._suite_exists", return_value=True),
            patch(
                f"{_SERVICE_MODULE}.check_variable_collisions_for_regression",
                return_value=[
                    {
                        "variable": "env",
                        "this_type": "string",
                        "other_suite": "Suite A",
                        "other_suite_id": suite_id,
                        "other_type": "integer",
                    }
                ],
            ),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {
                "name": "Collision Regression",
                "suites": [suite_id],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
            result = import_export.validate_regression_import(b"x", "regression.yaml")

        assert result["regressions"][0]["fatal_errors"][0]["code"] == "VARIABLE_TYPE_COLLISION"


# ============================================================================
# Service-level: Import Execution
# ============================================================================


class TestImportRegressionsService:
    """Tests for regression import service function."""

    def test_create_new_regression(self) -> None:
        """Import creates a new regression."""
        from wavecore.api.services.regressions import import_export

        suite_id = str(uuid.uuid4())
        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_STORAGE_MODULE}._save_regression") as mock_save,
            patch(f"{_STORAGE_MODULE}._save_versions"),
            patch(f"{_STORAGE_MODULE}._suite_exists", return_value=True),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {
                "name": "New Regression",
                "suites": [suite_id],
                "tags": ["nightly"],
            }
            result = import_export.import_regressions(b"x", "regression.yaml")

        assert result["total_imported"] == 1
        assert result["imported"][0]["name"] == "New Regression"
        assert result["imported"][0]["action"] == "created"
        mock_save.assert_called_once()
        saved = mock_save.call_args[0][0]
        assert saved["name"] == "New Regression"
        assert saved["suites"] == [suite_id]

    def test_a_variable_value_that_breaks_the_number_rule_is_refused(self) -> None:
        """REQ-3.1.3.14: nothing is written when an imported value breaks the number rule."""
        from wavecore.api.services.regressions import import_export

        variables = {"n": {"type": "integer", "value": " 30 "}}
        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_STORAGE_MODULE}._save_regression") as mock_save,
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Numbers", "suites": [], "variables": variables}
            with pytest.raises(
                ValidationException, match="^Value for variable 'n' is not a valid integer$"
            ):
                import_export.import_regressions(b"x", "regression.yaml")

        mock_save.assert_not_called()

    def test_skip_conflict(self) -> None:
        """Import skips conflicting regression when resolution is skip."""
        from wavecore.api.services.regressions import import_export

        existing = _make_regression("Existing", regression_id="existing-id")
        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[existing]),
            patch(f"{_STORAGE_MODULE}._save_regression"),
            patch(f"{_STORAGE_MODULE}._save_versions"),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "suites": []}
            result = import_export.import_regressions(b"x", "regression.yaml", {"Existing": "skip"})

        assert result["total_skipped"] == 1
        assert result["total_imported"] == 0

    def test_overwrite_conflict(self) -> None:
        """Import overwrites existing regression when resolution is overwrite."""
        from wavecore.api.services.regressions import import_export

        existing = _make_regression("Existing", regression_id="existing-id")
        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[existing]),
            patch(f"{_STORAGE_MODULE}._save_regression") as mock_save,
            patch(f"{_STORAGE_MODULE}._save_versions"),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "suites": []}
            result = import_export.import_regressions(
                b"x", "regression.yaml", {"Existing": "overwrite"}
            )

        assert result["imported"][0]["action"] == "overwritten"
        assert result["imported"][0]["id"] == "existing-id"
        mock_save.assert_called_once()

    def test_rename_conflict(self) -> None:
        """Import renames conflicting regression when resolution is rename."""
        from wavecore.api.services.regressions import import_export

        existing = _make_regression("Existing", regression_id="existing-id")
        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[existing]),
            patch(f"{_STORAGE_MODULE}._save_regression") as _mock_save,
            patch(f"{_STORAGE_MODULE}._save_versions"),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Existing", "suites": []}
            result = import_export.import_regressions(
                b"x", "regression.yaml", {"Existing": "rename"}
            )

        assert result["imported"][0]["action"] == "renamed"
        assert result["imported"][0]["name"] == "Existing (2)"

    def test_strips_invalid_suite_ids(self) -> None:
        """Import strips invalid suite IDs and records fixes."""
        from wavecore.api.services.regressions import import_export

        def suite_exists_side_effect(suite_id: str) -> bool:
            return suite_id == "valid-suite"

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_STORAGE_MODULE}._save_regression") as mock_save,
            patch(f"{_STORAGE_MODULE}._save_versions"),
            patch(f"{_STORAGE_MODULE}._suite_exists", side_effect=suite_exists_side_effect),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {
                "name": "Regression",
                "suites": ["valid-suite", "bad-suite"],
            }
            result = import_export.import_regressions(b"x", "regression.yaml")

        assert result["total_imported"] == 1
        assert result["fixes_applied"][0]["fixes"] == ["Stripped unresolvable suite 'bad-suite'"]
        saved = mock_save.call_args[0][0]
        assert saved["suites"] == ["valid-suite"]

    def test_fatal_error_raises(self) -> None:
        """Import raises ValidationException for items with no name."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
            pytest.raises(
                ValidationException,
                match="^Fatal validation errors prevent import$",
            ),
        ):
            mock_parse.return_value = {"description": "no name"}
            import_export.import_regressions(b"x", "regression.yaml")

    def test_variable_collision_raises_conflict(self) -> None:
        """Import raises ConflictException when variable type collision detected."""
        from wavecore.api.services.regressions import import_export

        suite_id = str(uuid.uuid4())
        collisions = [
            {
                "variable": "env",
                "this_type": "string",
                "other_suite": "Suite A",
                "other_suite_id": suite_id,
                "other_type": "integer",
            }
        ]
        with (
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
            patch(
                f"{_SERVICE_MODULE}.check_variable_collisions_for_regression",
                return_value=collisions,
            ),
            patch(f"{_STORAGE_MODULE}._suite_exists", return_value=True),
            pytest.raises(ConflictException, match="Variable type collision"),
        ):
            mock_parse.return_value = {
                "name": "Collision Regression",
                "suites": [suite_id],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
            import_export.import_regressions(b"x", "regression.yaml")

    def test_import_preserves_variables(self) -> None:
        """Import preserves regression variables in the saved data."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_STORAGE_MODULE}._save_regression") as mock_save,
            patch(f"{_STORAGE_MODULE}._save_versions"),
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {
                "name": "Vars Regression",
                "suites": [],
                "variables": {"env": {"type": "string", "value": "production"}},
            }
            result = import_export.import_regressions(b"x", "regression.yaml")

        assert result["total_imported"] == 1
        saved = mock_save.call_args[0][0]
        assert saved["variables"]["env"]["value"] == "production"

    def test_import_creates_initial_version(self) -> None:
        """Import creates initial version 1.0.0 for new regressions."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_STORAGE_MODULE}._save_regression") as mock_save,
            patch(f"{_STORAGE_MODULE}._save_versions") as mock_save_versions,
            patch(f"{_SERVICE_MODULE}.parse_file") as mock_parse,
        ):
            mock_parse.return_value = {"name": "Versioned", "suites": []}
            import_export.import_regressions(b"x", "regression.yaml")

        saved = mock_save.call_args[0][0]
        assert saved["version"] == "1.0.0"
        versions_saved = mock_save_versions.call_args[0][1]
        assert len(versions_saved) == 1
        assert versions_saved[0]["version"] == "1.0.0"
        assert versions_saved[0]["created_by"] == "import"

    def test_import_zip_multiple_regressions(self) -> None:
        """Import from ZIP creates multiple regressions."""
        from wavecore.api.services.regressions import import_export

        with (
            patch(f"{_STORAGE_MODULE}._list_all_regressions", return_value=[]),
            patch(f"{_STORAGE_MODULE}._save_regression"),
            patch(f"{_STORAGE_MODULE}._save_versions"),
            patch(f"{_SERVICE_MODULE}.parse_zip_file") as mock_zip,
        ):
            mock_zip.return_value = [
                ("a.yaml", {"name": "Reg A", "suites": []}),
                ("b.yaml", {"name": "Reg B", "suites": []}),
            ]
            result = import_export.import_regressions(b"x", "regressions.zip")

        assert result["total_imported"] == 2
        names = [r["name"] for r in result["imported"]]
        assert "Reg A" in names
        assert "Reg B" in names


def _regression_file(value: Any) -> bytes:
    """A regression import file whose one secret variable holds ``value``."""
    declared = {"type": "string", "value": value, "secret": True}
    if value == MASK_PLACEHOLDER:
        declared["masked"] = True
    return yaml.dump(
        {"name": "Holds a secret", "suites": [], "variables": {"token": declared}}
    ).encode()


def _secret_wave_cannot_open(kind: str) -> str:
    return _foreign_envelope("sealed-elsewhere") if kind == "foreign" else MASK_PLACEHOLDER


class TestImportRegressionSecrets:
    """A regression secret WAVE cannot open, or a masked placeholder, is stored as null and
    stays secret; a placeholder never replaces a secret stored at the same place
    (REQ-4.5.19, EXPORT-5, EXPORT-7)."""

    @pytest.mark.parametrize("kind", ["foreign", "masked"])
    def test_a_secret_wave_cannot_open_is_stored_as_null_and_stays_secret(self, kind: str) -> None:
        from wavecore.api.services.regressions import _storage, import_export

        result = import_export.import_regressions(
            _regression_file(_secret_wave_cannot_open(kind)), "regression.yaml"
        )

        stored = _storage._load_regression(result["imported"][0]["id"])
        assert stored is not None
        assert stored["variables"]["token"]["value"] is None
        assert stored["variables"]["token"]["secret"] is True

    def test_a_masked_placeholder_keeps_the_secret_stored_at_the_same_place_on_overwrite(
        self,
    ) -> None:
        from wavecore.api.services.regressions import _storage, import_export
        from wavecore.api.services.regressions import service as regression_service

        here = _make_regression(
            "Holds a secret",
            variables={"token": {"type": "string", "value": "kept-secret", "secret": True}},
        )
        regression_service.persist_regression_document(here, [])

        result = import_export.import_regressions(
            _regression_file(MASK_PLACEHOLDER), "regression.yaml", {"Holds a secret": "overwrite"}
        )

        assert result["imported"] == [
            {"name": "Holds a secret", "id": here["id"], "action": "overwritten"}
        ]
        stored = _storage._load_regression(here["id"])
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
        from wavecore.api.services.regressions import import_export

        result = import_export.validate_regression_import(
            _regression_file(_secret_wave_cannot_open(kind)), "regression.yaml"
        )

        found = [w["message"] for w in result["regressions"][0]["warnings"] if w["code"] == code]
        assert len(found) == 1, found
        assert re.fullmatch("^" + re.escape(message) + "$", found[0])


# ============================================================================
# Endpoint-level: Single Regression Export
# ============================================================================


class TestExportSingleRegressionEndpoint:
    """Tests for GET /regressions/{regression_id}/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_export_yaml_default_format(self, client: TestClient) -> None:
        """Export defaults to YAML format."""
        regression = _make_regression("Smoke Regression")
        with patch(f"{_SERVICE_MODULE}.export_regression") as mock_export:
            mock_export.return_value = (
                yaml.dump(regression, default_flow_style=False),
                "Smoke-Regression.yaml",
            )
            response = client.get(f"/regressions/{regression['id']}/export")

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]
        assert 'filename="Smoke-Regression.yaml"' in response.headers["content-disposition"]

    def test_export_json_format(self, client: TestClient) -> None:
        """Export in JSON format returns correct content-type."""
        regression = _make_regression("JSON Regression")
        with patch(f"{_SERVICE_MODULE}.export_regression") as mock_export:
            mock_export.return_value = (
                json.dumps(regression, indent=2),
                "JSON-Regression.json",
            )
            response = client.get(f"/regressions/{regression['id']}/export?format=json")

        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]
        assert 'filename="JSON-Regression.json"' in response.headers["content-disposition"]

    def test_export_content_is_parseable_yaml(self, client: TestClient) -> None:
        """Exported YAML content is valid and parseable."""
        regression = _make_regression("Parseable Regression")
        yaml_content = yaml.dump(regression, default_flow_style=False)
        with patch(f"{_SERVICE_MODULE}.export_regression") as mock_export:
            mock_export.return_value = (yaml_content, "Parseable-Regression.yaml")
            response = client.get(f"/regressions/{regression['id']}/export")

        parsed = yaml.safe_load(response.text)
        assert parsed["name"] == "Parseable Regression"

    def test_export_not_found_returns_404(self, client: TestClient) -> None:
        """Export returns 404 for non-existent regression."""
        fake_id = str(uuid.uuid4())
        with patch(f"{_SERVICE_MODULE}.export_regression") as mock_export:
            mock_export.return_value = None
            response = client.get(f"/regressions/{fake_id}/export")

        assert response.status_code == 404

    def test_export_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid UUID."""
        response = client.get("/regressions/not-a-uuid/export")
        assert response.status_code == 400

    def test_export_invalid_format_returns_400(self, client: TestClient) -> None:
        """Export returns 400 for invalid format parameter."""
        regression_id = str(uuid.uuid4())
        response = client.get(f"/regressions/{regression_id}/export?format=xml")
        assert response.status_code == 400

    def test_export_content_disposition_header(self, client: TestClient) -> None:
        """Export sets Content-Disposition attachment header."""
        regression = _make_regression("Attachment Regression")
        with patch(f"{_SERVICE_MODULE}.export_regression") as mock_export:
            mock_export.return_value = ("content", "Attachment-Regression.yaml")
            response = client.get(f"/regressions/{regression['id']}/export")

        assert response.headers["content-disposition"].startswith("attachment")

    def test_export_default_secrets_mode_is_mask(self, client: TestClient) -> None:
        """Default secrets mode is mask (secrets masked by default)."""
        regression = _make_regression("Default Mask")
        with patch(f"{_SERVICE_MODULE}.export_regression") as mock_export:
            mock_export.return_value = ("content", "Default-Mask.yaml")
            response = client.get(f"/regressions/{regression['id']}/export")

        assert response.status_code == 200
        mock_export.assert_called_once_with(regression["id"], "yaml", "mask")

    @pytest.mark.parametrize("mode", ["mask", "encrypted", "plaintext"])
    def test_export_passes_secrets_mode_to_service(self, client: TestClient, mode: str) -> None:
        """The chosen secrets mode is forwarded to the export service."""
        regression = _make_regression("Secret Regression")
        with patch(f"{_SERVICE_MODULE}.export_regression") as mock_export:
            mock_export.return_value = ("content", "Secret-Regression.yaml")
            response = client.get(f"/regressions/{regression['id']}/export?secrets={mode}")

        assert response.status_code == 200
        mock_export.assert_called_once_with(regression["id"], "yaml", mode)

    def test_export_invalid_secrets_mode_returns_400(self, client: TestClient) -> None:
        """An unrecognized secrets mode is rejected before export."""
        regression_id = str(uuid.uuid4())
        with patch(f"{_SERVICE_MODULE}.export_regression") as mock_export:
            mock_export.return_value = None
            response = client.get(f"/regressions/{regression_id}/export?secrets=bogus")

        assert response.status_code == 400
        assert (
            "Invalid secrets mode 'bogus'; must be 'mask', 'encrypted', or 'plaintext'"
            in response.text
        )


# ============================================================================
# Endpoint-level: Bulk Regression Export
# ============================================================================


class TestExportBulkRegressionsEndpoint:
    """Tests for POST /regressions/export."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_regression_returns_file(self, client: TestClient) -> None:
        """Bulk export of 1 regression returns single file, not ZIP."""
        regression_id = str(uuid.uuid4())
        with patch(f"{_SERVICE_MODULE}.export_regressions_batch") as mock_batch:
            mock_batch.return_value = [
                (regression_id, "name: Test Regression\n", "Test-Regression.yaml")
            ]
            response = client.post(
                "/regressions/export",
                json={"regression_ids": [regression_id], "format": "yaml"},
            )

        assert response.status_code == 200
        assert "application/x-yaml" in response.headers["content-type"]

    def test_multiple_regressions_returns_zip(self, client: TestClient) -> None:
        """Bulk export of 2+ regressions returns ZIP archive."""
        ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        with patch(f"{_SERVICE_MODULE}.export_regressions_batch") as mock_batch:
            mock_batch.return_value = [
                (ids[0], "name: Reg A\n", "Reg-A.yaml"),
                (ids[1], "name: Reg B\n", "Reg-B.yaml"),
            ]
            response = client.post(
                "/regressions/export",
                json={"regression_ids": ids, "format": "yaml"},
            )

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert 'filename="regressions-export.zip"' in response.headers["content-disposition"]

        zf = zipfile.ZipFile(io.BytesIO(response.content))
        assert len(zf.namelist()) == 2

    def test_empty_ids_returns_400(self, client: TestClient) -> None:
        """Bulk export with empty regression_ids returns 400."""
        response = client.post("/regressions/export", json={"regression_ids": [], "format": "yaml"})
        assert response.status_code == 400

    @pytest.mark.parametrize("regression_ids", NOT_ID_LIST_FIELDS)
    def test_ids_that_are_not_a_list_of_strings_are_refused(
        self, client: TestClient, regression_ids: Any
    ) -> None:
        response = client.post(
            "/regressions/export", json={"regression_ids": regression_ids, "format": "yaml"}
        )

        assert_refused(response, "'regression_ids' must be a list of ID strings")

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        """Bulk export with invalid format returns 400."""
        response = client.post(
            "/regressions/export",
            json={"regression_ids": [str(uuid.uuid4())], "format": "xml"},
        )
        assert response.status_code == 400

    def test_not_found_regression_returns_404(self, client: TestClient) -> None:
        """Bulk export raises 404 if any regression not found."""
        regression_id = str(uuid.uuid4())
        with patch(f"{_SERVICE_MODULE}.export_regressions_batch") as mock_batch:
            mock_batch.side_effect = NotFoundException(f"Regression not found: {regression_id}")
            response = client.post(
                "/regressions/export",
                json={"regression_ids": [regression_id], "format": "yaml"},
            )

        assert response.status_code == 404


# ============================================================================
# Endpoint-level: Import Validation
# ============================================================================


class TestValidateRegressionImportEndpoint:
    """Tests for POST /regressions/import/validate."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_valid_single_file(self, client: TestClient) -> None:
        """Valid YAML file returns ok status."""
        with patch(f"{_SERVICE_MODULE}.validate_regression_import") as mock_validate:
            mock_validate.return_value = {
                "regressions": [
                    {
                        "name": "My Regression",
                        "status": "ok",
                        "fatal_errors": [],
                        "fixable_errors": [],
                        "warnings": [],
                        "existing_regression_id": None,
                    }
                ],
                "total": 1,
                "importable": 1,
                "blocked": 0,
            }
            response = client.post(
                "/regressions/import/validate",
                files={
                    "file": (
                        "regression.yaml",
                        b"name: My Regression\n",
                        "application/x-yaml",
                    )
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total"] == 1
        assert data["data"]["importable"] == 1
        assert data["data"]["regressions"][0]["status"] == "ok"

    def test_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Unsupported file format returns 400."""
        response = client.post(
            "/regressions/import/validate",
            files={"file": ("regression.txt", b"name: Test\n", "text/plain")},
        )
        assert response.status_code == 400


# ============================================================================
# Endpoint-level: Import Execution
# ============================================================================


class TestImportRegressionsEndpoint:
    """Tests for POST /regressions/import."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_import_creates_new_regression(self, client: TestClient) -> None:
        """Importing a valid regression creates it successfully."""
        new_id = str(uuid.uuid4())
        with patch(f"{_SERVICE_MODULE}.import_regressions") as mock_import:
            mock_import.return_value = {
                "imported": [{"name": "New Regression", "id": new_id, "action": "created"}],
                "skipped": [],
                "fixes_applied": [],
                "total_imported": 1,
                "total_skipped": 0,
            }
            response = client.post(
                "/regressions/import",
                files={
                    "file": (
                        "regression.yaml",
                        b"name: New Regression\n",
                        "application/x-yaml",
                    )
                },
                data={"conflict_resolutions": ""},
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_imported"] == 1
        assert data["imported"][0]["name"] == "New Regression"
        assert data["imported"][0]["action"] == "created"

    def test_import_skip_conflict(self, client: TestClient) -> None:
        """Import with skip resolution skips conflicting regression."""
        with patch(f"{_SERVICE_MODULE}.import_regressions") as mock_import:
            mock_import.return_value = {
                "imported": [],
                "skipped": [{"name": "Existing Reg", "reason": "skipped by user"}],
                "fixes_applied": [],
                "total_imported": 0,
                "total_skipped": 1,
            }
            response = client.post(
                "/regressions/import",
                files={
                    "file": (
                        "regression.yaml",
                        b"name: Existing Reg\n",
                        "application/x-yaml",
                    )
                },
                data={"conflict_resolutions": json.dumps({"Existing Reg": "skip"})},
            )

        data = response.json()["data"]
        assert data["total_skipped"] == 1
        assert data["skipped"][0]["reason"] == "skipped by user"

    def test_import_fatal_raises_error(self, client: TestClient) -> None:
        """Import with fatal errors returns error response."""
        with patch(f"{_SERVICE_MODULE}.import_regressions") as mock_import:
            mock_import.side_effect = ValidationException("Fatal validation errors prevent import")
            response = client.post(
                "/regressions/import",
                files={
                    "file": (
                        "regression.yaml",
                        b"description: no name\n",
                        "application/x-yaml",
                    )
                },
                data={"conflict_resolutions": ""},
            )

        assert response.status_code == 400

    def test_import_bad_conflict_resolutions_json(self, client: TestClient) -> None:
        """Import with invalid JSON in conflict_resolutions returns 400."""
        response = client.post(
            "/regressions/import",
            files={
                "file": (
                    "regression.yaml",
                    b"name: Test\n",
                    "application/x-yaml",
                )
            },
            data={"conflict_resolutions": "not-json"},
        )
        assert response.status_code == 400

    def test_import_unsupported_format_returns_400(self, client: TestClient) -> None:
        """Import with unsupported file format returns 400."""
        response = client.post(
            "/regressions/import",
            files={"file": ("regression.txt", b"name: Test\n", "text/plain")},
            data={"conflict_resolutions": ""},
        )
        assert response.status_code == 400


class TestExportKeepsTheWholeFileName:
    """An export name with text outside plain ASCII is sent whole (REQ-4.6.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_export(self, client: TestClient) -> None:
        name = f"{EXPORT_STEM}.yaml"
        with patch(f"{_SERVICE_MODULE}.export_regression", return_value=("name: x\n", name)):
            response = client.get(f"/regressions/{uuid.uuid4()}/export")

        assert_whole_name(response, name)

    def test_bulk_export_of_one(self, client: TestClient) -> None:
        regression_id = str(uuid.uuid4())
        name = f"{EXPORT_STEM}.yaml"
        with patch(
            f"{_SERVICE_MODULE}.export_regressions_batch",
            return_value=[(regression_id, "name: x\n", name)],
        ):
            response = client.post("/regressions/export", json={"regression_ids": [regression_id]})

        assert_whole_name(response, name)
