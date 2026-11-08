"""Unit tests for regression service layer (REQ-5.2.4.5).

This module tests the regression service providing business logic for regression
management including creation, modification, version control, suite composition,
and validation.

Test Coverage:
- CRUD operations: create_regression, get_regression, update_regression, delete_regression
- Version control: list_versions, add_version, get_version, update_version, delete_version
- Suite composition: add_suite, remove_suite, reorder_suites
- Storage integration: YAML file persistence
- Error handling: Validation, conflicts, not found
- Variable binding: Type consistency validation at boundaries
- Ordering validation: No gaps or duplicates in suite sequence
"""

import copy
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import yaml

from tests.api.regression_test_helpers import (
    clear_regression_storage,
    get_regression_dir,
    load_regression_file,
    load_versions_file,
    save_regression_file,
    set_version_attribute,
)
from wavecore.api.exceptions import ConflictException, ValidationException, WaveException


class TestListRegressionsService:
    """Test suite for list_regressions service function."""

    def test_list_regressions_returns_empty_list_when_no_regressions(self) -> None:
        """Test that list_regressions returns empty list when no regressions exist."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.list_regressions()

        assert result["regressions"] == []
        assert result["total"] == 0
        assert result["page"] == 1
        assert result["per_page"] == 20
        assert result["total_pages"] == 0

    def test_list_regressions_returns_all_regressions(self) -> None:
        """Test that list_regressions returns all created regressions."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        regression_service.create_regression({"name": "Regression One"})
        regression_service.create_regression({"name": "Regression Two"})

        result = regression_service.list_regressions()

        assert result["total"] == 2
        assert len(result["regressions"]) == 2

    def test_list_regressions_supports_pagination(self) -> None:
        """Test that list_regressions supports page-based pagination."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        for i in range(25):
            regression_service.create_regression({"name": f"Regression {i}"})

        result = regression_service.list_regressions(page=1, per_page=10)
        assert len(result["regressions"]) == 10
        assert result["total"] == 25
        assert result["total_pages"] == 3

        result = regression_service.list_regressions(page=3, per_page=10)
        assert len(result["regressions"]) == 5

    def test_list_regressions_supports_search_filter(self) -> None:
        """Test that list_regressions supports text search filter."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        regression_service.create_regression({"name": "Nightly Regression"})
        regression_service.create_regression({"name": "Release Regression"})
        regression_service.create_regression({"name": "Performance Suite"})

        result = regression_service.list_regressions(search="nightly")

        assert result["total"] == 1
        assert result["regressions"][0]["name"] == "Nightly Regression"

    def test_list_regressions_search_includes_description(self) -> None:
        """Test that list_regressions search includes description field."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        regression_service.create_regression(
            {"name": "Regression A", "description": "Contains nightly tests"}
        )
        regression_service.create_regression({"name": "Regression B"})

        result = regression_service.list_regressions(search="nightly")

        assert result["total"] == 1
        assert result["regressions"][0]["name"] == "Regression A"

    def test_list_regressions_case_insensitive_search(self) -> None:
        """Test that search is case-insensitive."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        regression_service.create_regression({"name": "NIGHTLY Regression"})

        result = regression_service.list_regressions(search="nightly")

        assert result["total"] == 1

    def test_list_regressions_includes_metadata(self) -> None:
        """Test that list includes essential metadata for quick assessment."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "suites": [],
                "variables": {"env": {"type": "string"}},
            }
        )

        result = regression_service.list_regressions()

        assert result["total"] == 1
        regression = result["regressions"][0]
        assert "suites" in regression
        assert "variables" in regression
        assert "version" in regression


class TestCreateRegressionService:
    """Test suite for create_regression service function."""

    def test_create_regression_with_name_only(self) -> None:
        """Test creating regression with only name field."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression({"name": "Nightly Regression"})

        assert result["name"] == "Nightly Regression"
        assert result["version"] == "1.0.0"
        assert "id" in result
        assert result["suites"] == []
        assert result["variables"] == {}

    def test_create_regression_with_description(self) -> None:
        """Test creating regression with description."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "description": "Nightly regression test campaign",
            }
        )

        assert result["description"] == "Nightly regression test campaign"

    def test_create_regression_with_suite_references(self) -> None:
        """Test creating regression with suite references."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()

        # Create suites first
        suite1 = suite_service.create_suite({"name": "Suite One"})
        suite2 = suite_service.create_suite({"name": "Suite Two"})

        result = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "suites": [suite1["id"], suite2["id"]],
            }
        )

        assert len(result["suites"]) == 2
        assert suite1["id"] in result["suites"]
        assert suite2["id"] in result["suites"]

    def test_create_regression_validates_suite_references(self) -> None:
        """Test that create validates all suite references exist."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        fake_suite_id = str(uuid.uuid4())

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            regression_service.create_regression(
                {
                    "name": "Nightly Regression",
                    "suites": [fake_suite_id],
                }
            )

        assert f"Suite with ID '{fake_suite_id}' not found" in str(exc_info.value)

    def test_create_regression_refuses_a_suite_id_that_is_not_text(self) -> None:
        """A Suite ID that is not text matches no Suite."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        with pytest.raises(ValidationException, match=r"^Suite with ID '\{'id': 1\}' not found$"):
            regression_service.create_regression(
                {"name": "Nightly Regression", "suites": [{"id": 1}]}
            )

        assert regression_service.list_regression_documents() == []

    def test_create_regression_with_variables(self) -> None:
        """Test creating regression with variable declarations."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "variables": {
                    "env": {"type": "string", "default": "staging"},
                    "timeout": {"type": "integer", "default": 60},
                },
            }
        )

        assert "env" in result["variables"]
        assert "timeout" in result["variables"]
        assert result["variables"]["env"]["type"] == "string"

    def test_create_regression_with_metadata(self) -> None:
        """Test creating regression with metadata."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "metadata": {"author": "test-user", "priority": "high"},
            }
        )

        assert result["metadata"]["author"] == "test-user"
        assert result["metadata"]["priority"] == "high"

    def test_create_regression_generates_unique_id(self) -> None:
        """Test that create generates unique UUID for each regression."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result1 = regression_service.create_regression({"name": "Regression One"})
        result2 = regression_service.create_regression({"name": "Regression Two"})

        assert result1["id"] != result2["id"]
        assert len(result1["id"]) == 36  # UUID format

    def test_create_regression_sets_initial_version(self) -> None:
        """Test that create sets initial version to 1.0.0."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression({"name": "Nightly Regression"})

        assert result["version"] == "1.0.0"

    def test_create_regression_sets_timestamps(self) -> None:
        """Test that create sets created_at and updated_at timestamps."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression({"name": "Nightly Regression"})

        assert "created_at" in result
        assert "updated_at" in result
        assert result["created_at"] == result["updated_at"]

    def test_create_regression_raises_on_duplicate_name(self) -> None:
        """Test that create raises ValueError on duplicate name."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        regression_service.create_regression({"name": "Nightly Regression"})

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            regression_service.create_regression({"name": "Nightly Regression"})

        assert "already exists" in str(exc_info.value)

    def test_create_regression_persists_to_storage(self) -> None:
        """Test that create persists regression to YAML storage."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression({"name": "Nightly Regression"})

        stored = load_regression_file(result["id"])
        assert stored is not None
        assert stored["name"] == "Nightly Regression"


class TestGetRegressionService:
    """Test suite for get_regression service function."""

    def test_get_regression_returns_regression_by_id(self) -> None:
        """Test that get_regression returns regression by ID."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        result = regression_service.get_regression(created["id"])

        assert result is not None
        assert result["id"] == created["id"]
        assert result["name"] == "Nightly Regression"

    def test_get_regression_returns_none_when_not_found(self) -> None:
        """Test that get_regression returns None when not found."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.get_regression(str(uuid.uuid4()))

        assert result is None

    def test_get_regression_returns_full_data(self) -> None:
        """Test that get_regression returns full regression data."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "description": "Test description",
                "variables": {"env": {"type": "string"}},
                "metadata": {"author": "test"},
            }
        )

        result = regression_service.get_regression(created["id"])

        assert result["description"] == "Test description"
        assert "env" in result["variables"]
        assert result["metadata"]["author"] == "test"


class TestUpdateRegressionService:
    """Test suite for update_regression service function."""

    def test_update_regression_updates_name(self) -> None:
        """Test that update_regression updates name field."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Original Name"})
        result = regression_service.update_regression(created["id"], {"name": "Updated Name"})

        assert result is not None
        assert result["name"] == "Updated Name"

    def test_update_regression_increments_version(self) -> None:
        """Test that update increments minor version number."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        assert created["version"] == "1.0.0"

        result = regression_service.update_regression(created["id"], {"description": "Updated"})

        assert result["version"] == "1.1.0"

    def test_update_regression_returns_none_when_not_found(self) -> None:
        """Test that update returns None when regression not found."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.update_regression(str(uuid.uuid4()), {"name": "Updated"})

        assert result is None

    def test_update_regression_raises_on_naming_conflict(self) -> None:
        """Test that update raises ValueError on naming conflict."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        regression_service.create_regression({"name": "Existing Regression"})
        created = regression_service.create_regression({"name": "Other Regression"})

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            regression_service.update_regression(created["id"], {"name": "Existing Regression"})

        assert "already exists" in str(exc_info.value)

    def test_update_regression_updates_timestamp(self) -> None:
        """Test that update updates the updated_at timestamp."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        original_updated = created["updated_at"]

        result = regression_service.update_regression(created["id"], {"description": "Updated"})

        assert result["updated_at"] != original_updated

    def test_update_regression_preserves_unchanged_fields(self) -> None:
        """Test that update preserves fields not included in update."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "description": "Original description",
                "variables": {"env": {"type": "string"}},
            }
        )

        result = regression_service.update_regression(created["id"], {"name": "Updated Name"})

        assert result["description"] == "Original description"
        assert "env" in result["variables"]

    def test_update_regression_updates_suites(self) -> None:
        """Test that update can modify suites list."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()

        # Create a real suite
        suite = suite_service.create_suite({"name": "Test Suite"})

        created = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "suites": [],
            }
        )

        result = regression_service.update_regression(created["id"], {"suites": [suite["id"]]})

        assert result["suites"] == [suite["id"]]

    def test_update_regression_updates_variables(self) -> None:
        """Test that update can modify variables."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "variables": {"old_var": {"type": "string"}},
            }
        )

        result = regression_service.update_regression(
            created["id"], {"variables": {"new_var": {"type": "integer"}}}
        )

        assert "new_var" in result["variables"]

    def test_update_regression_updates_metadata(self) -> None:
        """Test that update can modify metadata."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "metadata": {"owner": "team-a"},
            }
        )

        result = regression_service.update_regression(
            created["id"], {"metadata": {"owner": "team-b", "priority": "high"}}
        )

        assert result["metadata"]["owner"] == "team-b"
        assert result["metadata"]["priority"] == "high"

    def test_update_regression_refuses_an_unknown_suite(self) -> None:
        """Adding a Suite ID that matches no Suite refuses the update and changes nothing."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()
        member = suite_service.create_suite({"name": "Member Suite"})
        created = regression_service.create_regression(
            {"name": "Nightly Regression", "suites": [member["id"]]}
        )
        unknown_id = str(uuid.uuid4())

        with pytest.raises(ValidationException, match=rf"^Suite with ID '{unknown_id}' not found$"):
            regression_service.update_regression(
                created["id"], {"suites": [member["id"], unknown_id]}
            )

        stored = load_regression_file(created["id"])
        assert stored is not None
        assert stored["suites"] == [member["id"]]
        assert stored["version"] == "1.0.0"

    def test_update_regression_keeps_a_held_suite_that_no_longer_exists(self) -> None:
        """Only added Suites are checked, so a Suite the Regression already holds never blocks."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()
        member = suite_service.create_suite({"name": "Member Suite"})
        created = regression_service.create_regression({"name": "Nightly Regression"})
        gone_id = str(uuid.uuid4())
        stored = load_regression_file(created["id"])
        assert stored is not None
        stored["suites"] = [gone_id]
        save_regression_file(stored)

        result = regression_service.update_regression(
            created["id"], {"suites": [gone_id, member["id"]]}
        )

        assert result is not None
        assert result["suites"] == [gone_id, member["id"]]


class TestDeleteRegressionService:
    """Test suite for delete_regression service function."""

    def test_delete_regression_removes_regression(self) -> None:
        """Test that delete_regression removes the regression."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        result = regression_service.delete_regression(created["id"])

        assert result is True
        assert regression_service.get_regression(created["id"]) is None

    def test_delete_regression_returns_false_when_not_found(self) -> None:
        """Test that delete returns False when not found."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.delete_regression(str(uuid.uuid4()))

        assert result is False

    def test_delete_regression_removes_storage_files(self) -> None:
        """Test that delete removes YAML storage files."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        regression_service.delete_regression(created["id"])

        stored = load_regression_file(created["id"])
        assert stored is None

    def test_delete_regression_raises_conflict_when_running_execution(self) -> None:
        """Delete is blocked with ConflictException whose details carry the
        blocking execution IDs when a regression-type tracked execution is
        running."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        _exec_storage._clear_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})

        execution_id = str(uuid.uuid4())
        _exec_storage._execution_storage[execution_id] = {
            "id": execution_id,
            "name": "Nightly Regression",
            "entity_type": "regression",
            "entity_id": created["id"],
            "environment_id": "env-1",
            "status": "running",
            "started_at": "2026-04-20T10:00:00+00:00",
            "triggered_by": "dev",
        }

        with pytest.raises(ConflictException) as exc_info:
            regression_service.delete_regression(created["id"])

        assert exc_info.value.details == {"execution_ids": [execution_id]}
        assert regression_service.get_regression(created["id"]) is not None

    def test_delete_regression_raises_conflict_when_paused_execution(self) -> None:
        """Paused regression-type tracked execution also blocks delete."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        _exec_storage._clear_storage()

        created = regression_service.create_regression({"name": "Paused Regression"})

        execution_id = str(uuid.uuid4())
        _exec_storage._execution_storage[execution_id] = {
            "id": execution_id,
            "name": "Paused Regression",
            "entity_type": "regression",
            "entity_id": created["id"],
            "environment_id": "env-1",
            "status": "paused",
            "started_at": "2026-04-20T10:00:00+00:00",
            "triggered_by": "dev",
        }

        with pytest.raises(ConflictException) as exc_info:
            regression_service.delete_regression(created["id"])

        assert exc_info.value.details == {"execution_ids": [execution_id]}

    def test_update_regression_removing_suite_updates_relation_index(self) -> None:
        """When a suite is removed from a regression via update, the
        suite->regression relation index drops that entry."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()
        from wavecore.api.services.suites._storage import _clear_storage as _clear_suites

        _clear_suites()
        relation_service._test_to_suites.clear()
        relation_service._suite_to_regressions.clear()
        relation_service._initialized = False

        suite_a = suite_service.create_suite({"name": "Suite A"})
        suite_b = suite_service.create_suite({"name": "Suite B"})

        regression = regression_service.create_regression(
            {"name": "Full", "suites": [suite_a["id"], suite_b["id"]]}
        )
        assert relation_service.get_regression_count_for_suite(suite_a["id"]) == 1
        assert relation_service.get_regression_count_for_suite(suite_b["id"]) == 1

        regression_service.update_regression(regression["id"], {"suites": [suite_a["id"]]})

        assert relation_service.get_regression_count_for_suite(suite_a["id"]) == 1
        assert relation_service.get_regression_count_for_suite(suite_b["id"]) == 0

    def test_remove_suite_from_regression_noop_when_regression_missing(self) -> None:
        """Cascade helper is defensive: silent when the regression file is gone."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        # No exception, no side effect; ghost regression id just returns.
        regression_service.remove_suite_from_regression(str(uuid.uuid4()), str(uuid.uuid4()))

    def test_remove_suite_from_regression_noop_when_suite_not_referenced(self) -> None:
        """Cascade helper is defensive: silent when the suite isn't in the
        regression's suites list."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()
        from wavecore.api.services.suites._storage import _clear_storage as _clear_suites

        _clear_suites()

        suite = suite_service.create_suite({"name": "Loose Suite"})
        regression = regression_service.create_regression({"name": "Empty", "suites": []})

        regression_service.remove_suite_from_regression(regression["id"], suite["id"])

        # Regression is unchanged.
        loaded = regression_service.get_regression(regression["id"])
        assert loaded is not None
        assert loaded.get("suites") in (None, [])

    def test_delete_regression_succeeds_with_only_terminal_executions(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        _exec_storage._clear_storage()

        created = regression_service.create_regression({"name": "Done Regression"})

        _exec_storage._execution_storage["passed-exec"] = {
            "id": "passed-exec",
            "name": "Done Regression",
            "entity_type": "regression",
            "entity_id": created["id"],
            "environment_id": "env-1",
            "status": "passed",
            "started_at": "2026-04-20T10:00:00+00:00",
            "ended_at": "2026-04-20T10:00:05+00:00",
            "triggered_by": "dev",
        }

        assert regression_service.delete_regression(created["id"]) is True


class TestLegacyVersionPadding:
    """Exercise the legacy single-integer version padding branches."""

    def test_add_regression_version_pads_legacy_single_integer_version(self) -> None:
        """add_regression_version handles legacy version='N' by padding to 'N.0.0'."""
        from tests.api.regression_test_helpers import (
            load_regression_file,
            save_regression_file,
        )
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        regression = regression_service.create_regression({"name": "Legacy Reg"})
        stored = load_regression_file(regression["id"])
        assert stored is not None
        stored["version"] = "1"
        save_regression_file(stored)

        result = _reg_version_svc.add_regression_version(regression["id"], {"description": "next"})
        assert result is not None
        assert result["version"] == "1.1.0"


class TestBatchDeleteRegressionsService:
    """Test suite for batch_delete_regressions service function."""

    def test_batch_delete_regressions_deletes_multiple(self) -> None:
        """batch_delete_regressions removes every supplied regression."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        reg1 = regression_service.create_regression({"name": "Regression One"})
        reg2 = regression_service.create_regression({"name": "Regression Two"})

        result = regression_service.batch_delete_regressions([reg1["id"], reg2["id"]])

        assert set(result["deleted"]) == {reg1["id"], reg2["id"]}
        assert result["failed"] == []
        assert regression_service.get_regression(reg1["id"]) is None
        assert regression_service.get_regression(reg2["id"]) is None

    def test_batch_delete_regressions_reports_missing(self) -> None:
        """Missing regressions are reported in 'failed' while valid ones still delete."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        real = regression_service.create_regression({"name": "Real Regression"})
        ghost_id = str(uuid.uuid4())

        result = regression_service.batch_delete_regressions([ghost_id, real["id"]])

        assert result["deleted"] == [real["id"]]
        assert len(result["failed"]) == 1
        assert result["failed"][0]["index"] == 0
        assert ghost_id in result["failed"][0]["error"]

    def test_batch_delete_regressions_captures_conflict_errors(self) -> None:
        """ConflictException raised during delete (active execution) is
        captured per-item with the error message propagated."""
        import uuid as _uuid

        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        _exec_storage._clear_storage()

        reg = regression_service.create_regression({"name": "Busy Regression"})

        execution_id = str(_uuid.uuid4())
        _exec_storage._execution_storage[execution_id] = {
            "id": execution_id,
            "name": "Busy Regression",
            "entity_type": "regression",
            "entity_id": reg["id"],
            "environment_id": "env-1",
            "status": "running",
            "started_at": "2026-04-20T10:00:00+00:00",
            "triggered_by": "dev",
        }

        result = regression_service.batch_delete_regressions([reg["id"]])

        assert result["deleted"] == []
        assert len(result["failed"]) == 1
        assert "running or paused" in result["failed"][0]["error"]

    def test_batch_delete_regressions_captures_any_wave_error(self) -> None:
        """Any WAVE refusal of one regression is kept per item, as for Suites and Tests."""
        from wavecore.api.services.regressions import service as regression_service

        with patch(
            "wavecore.api.services.regressions.service.delete_regression",
            side_effect=WaveException("Delete failed"),
        ):
            result = regression_service.batch_delete_regressions(["reg-1"])

        assert result == {"deleted": [], "failed": [{"index": 0, "error": "Delete failed"}]}


class TestBatchCloneRegressionsService:
    """Test suite for batch_clone_regressions service function."""

    def test_batch_clone_regressions_clones_multiple(self) -> None:
        """batch_clone_regressions clones each supplied regression."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        reg1 = regression_service.create_regression({"name": "Alpha"})
        reg2 = regression_service.create_regression({"name": "Beta"})

        result = regression_service.batch_clone_regressions([reg1["id"], reg2["id"]])

        assert len(result["cloned"]) == 2
        assert result["failed"] == []
        original_ids = {entry["original_id"] for entry in result["cloned"]}
        assert original_ids == {reg1["id"], reg2["id"]}
        cloned_ids = {entry["cloned_id"] for entry in result["cloned"]}
        assert cloned_ids.isdisjoint({reg1["id"], reg2["id"]})

    def test_batch_clone_regressions_reports_missing(self) -> None:
        """Missing regressions are reported in 'failed' without aborting the batch."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        real = regression_service.create_regression({"name": "Real One"})
        ghost_id = str(uuid.uuid4())

        result = regression_service.batch_clone_regressions([ghost_id, real["id"]])

        assert len(result["cloned"]) == 1
        assert result["cloned"][0]["original_id"] == real["id"]
        assert len(result["failed"]) == 1
        assert result["failed"][0]["index"] == 0
        assert ghost_id in result["failed"][0]["error"]

    def test_batch_clone_regressions_captures_conflict_exceptions(self) -> None:
        """ConflictException raised during clone is captured per-item."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        reg = regression_service.create_regression({"name": "Conflict Source"})

        with patch.object(
            _reg_version_svc,
            "clone_regression",
            side_effect=ConflictException("Name already exists"),
        ):
            result = regression_service.batch_clone_regressions([reg["id"]])

        assert result["cloned"] == []
        assert len(result["failed"]) == 1
        assert "Name already exists" in result["failed"][0]["error"]

    def test_batch_clone_regressions_captures_any_wave_error(self) -> None:
        """Any WAVE refusal of one regression is kept per item, as for Suites."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        with patch.object(
            _reg_version_svc, "clone_regression", side_effect=WaveException("Save failed")
        ):
            result = regression_service.batch_clone_regressions(["reg-1"])

        assert result == {"cloned": [], "failed": [{"index": 0, "error": "Save failed"}]}

    def test_batch_clone_regressions_names_each_copy_and_each_missing_one(self) -> None:
        """Each copy takes its source name with '(Copy)'; a missing one is named by its index."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        real = regression_service.create_regression({"name": "Real One"})
        ghost_id = str(uuid.uuid4())

        result = regression_service.batch_clone_regressions([ghost_id, real["id"]])

        assert result["failed"] == [
            {"index": 0, "error": f"Regression with ID '{ghost_id}' not found"}
        ]
        [entry] = result["cloned"]
        assert entry["original_id"] == real["id"]
        clone = regression_service.get_regression(entry["cloned_id"])
        assert clone is not None
        assert clone["name"] == "Real One (Copy)"


class TestListRegressionVersionsService:
    """Test suite for list_regression_versions service function."""

    def test_list_versions_returns_version_history(self) -> None:
        """Test that list_versions returns version history."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        regression_service.update_regression(created["id"], {"description": "V1"})
        regression_service.update_regression(created["id"], {"description": "V2"})

        result = _reg_version_svc.list_regression_versions(created["id"])

        assert result is not None
        assert len(result["versions"]) >= 2

    def test_list_versions_returns_none_when_not_found(self) -> None:
        """Test that list_versions returns None when regression not found."""
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        result = _reg_version_svc.list_regression_versions(str(uuid.uuid4()))

        assert result is None


class TestAddRegressionVersionService:
    """Test suite for add_regression_version service function."""

    def test_add_version_creates_new_version(self) -> None:
        """Test that add_version creates a new version."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        result = _reg_version_svc.add_regression_version(
            created["id"], {"description": "New version"}
        )

        assert result is not None
        assert result["version"] == "1.1.0"

    def test_add_version_returns_none_when_not_found(self) -> None:
        """Test that add_version returns None when not found."""
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        result = _reg_version_svc.add_regression_version(str(uuid.uuid4()), {"description": "New"})

        assert result is None

    def test_add_version_validates_suite_references(self) -> None:
        """Test that add_version validates suite reference compatibility."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        fake_suite_id = str(uuid.uuid4())

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            _reg_version_svc.add_regression_version(created["id"], {"suites": [fake_suite_id]})

        assert "not found" in str(exc_info.value)


class TestGetRegressionVersionService:
    """Test suite for get_regression_version service function."""

    def test_get_version_returns_specific_version(self) -> None:
        """Test that get_version returns specific version snapshot."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "description": "Original",
            }
        )
        regression_service.update_regression(created["id"], {"description": "Updated"})

        result = _reg_version_svc.get_regression_version(created["id"], "1.0.0")

        assert result is not None
        assert result["version"] == "1.0.0"
        assert result["description"] == "Original"

    def test_get_version_returns_none_when_not_found(self) -> None:
        """Test that get_version returns None when version not found."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})

        result = _reg_version_svc.get_regression_version(created["id"], "99.99.99")

        assert result is None


class TestUpdateRegressionVersionService:
    """Test suite for update_regression_version service function."""

    def test_update_version_modifies_version_metadata(self) -> None:
        """Test that update_version modifies version metadata."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        result = _reg_version_svc.update_regression_version(
            created["id"], "1.0.0", {"description": "Updated metadata"}
        )

        assert result is not None

    def test_update_version_raises_for_published_version(self) -> None:
        """Test that update raises for published (immutable) version."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})

        # Mark version as published
        set_version_attribute(created["id"], "1.0.0", "published", True)

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            _reg_version_svc.update_regression_version(
                created["id"], "1.0.0", {"description": "Updated"}
            )

        assert "immutable" in str(exc_info.value)


class TestDeleteRegressionVersionService:
    """Test suite for delete_regression_version service function."""

    def test_delete_version_removes_version(self) -> None:
        """Test that delete_version removes the version."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})
        regression_service.update_regression(created["id"], {"description": "V2"})

        result = _reg_version_svc.delete_regression_version(created["id"], "1.0.0")

        assert result is True

    def test_delete_version_returns_false_when_not_found(self) -> None:
        """Test that delete_version returns False when not found."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})

        result = _reg_version_svc.delete_regression_version(created["id"], "99.99.99")

        assert result is False

    def test_delete_version_raises_with_dependencies(self) -> None:
        """Test that delete raises when version has execution dependencies."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Nightly Regression"})

        from wavecore.api.services.regressions import version_service as _reg_ver_svc

        with patch.object(
            _reg_ver_svc,
            "_version_has_dependencies",
            return_value=True,
        ):
            with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
                _reg_version_svc.delete_regression_version(created["id"], "1.0.0")

            assert "scheduled executions" in str(exc_info.value)


class TestRegressionVariableValidation:
    """Test suite for regression variable validation."""

    def test_create_refuses_a_value_that_breaks_the_number_rule(self) -> None:
        """A typed value is held to the one number rule (REQ-3.1.3.14)."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        with pytest.raises(
            ValidationException, match=r"^Value for variable 'timeout' is not a valid integer$"
        ):
            regression_service.create_regression(
                {"name": "Nightly", "variables": {"timeout": {"type": "integer", "value": "1e3"}}}
            )
        assert regression_service.list_regressions()["total"] == 0

    def test_update_refuses_a_value_that_breaks_the_number_rule(self) -> None:
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        created = regression_service.create_regression({"name": "Nightly"})

        with pytest.raises(
            ValidationException,
            match=r"^Value for variable 'ratio' allows at most 28 significant digits, got 29$",
        ):
            regression_service.update_regression(
                created["id"],
                {
                    "variables": {
                        "ratio": {"type": "float", "value": "1.2345678901234567890123456789"}
                    }
                },
            )

    def test_create_with_valid_typed_variables(self) -> None:
        """Test creating regression with valid typed variables."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "variables": {
                    "env": {"type": "string", "default": "staging"},
                    "timeout": {"type": "integer", "default": 60},
                    "enabled": {"type": "boolean", "default": True},
                },
            }
        )

        assert result["variables"]["env"]["type"] == "string"
        assert result["variables"]["timeout"]["type"] == "integer"
        assert result["variables"]["enabled"]["type"] == "boolean"

    def test_create_with_computed_variable(self) -> None:
        """Test creating regression with computed (expression) variable."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "variables": {
                    "base": {"type": "string", "default": "https://api.example.com"},
                    "url": {
                        "type": "string",
                        "computed": True,
                        "expression": "f'{base}/v1'",
                    },
                },
            }
        )

        assert result["variables"]["url"]["computed"] is True

    def test_create_with_secret_variable(self) -> None:
        """Test creating regression with secret variable marking."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "variables": {
                    "api_key": {"type": "string", "secret": True, "default": "key123"},
                },
            }
        )

        assert result["variables"]["api_key"]["secret"] is True


class TestRegressionSecretMasking:
    """Secret variable ``value`` fields must be masked in every read path."""

    def test_get_regression_masks_secret_value(self) -> None:
        """get_regression returns the canonical placeholder for secret values."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        created = regression_service.create_regression(
            {
                "name": "Secret Regression",
                "variables": {
                    "api_key": {"type": "string", "secret": True, "value": "s3cret"},
                },
            }
        )

        result = regression_service.get_regression(created["id"])

        assert result is not None
        assert result["variables"]["api_key"]["secret"] is True
        assert result["variables"]["api_key"]["value"] == "********"

    def test_list_regressions_masks_secret_values(self) -> None:
        """list_regressions masks secret variable values in each returned item."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        regression_service.create_regression(
            {
                "name": "Secret Regression",
                "variables": {
                    "api_key": {"type": "string", "secret": True, "value": "s3cret"},
                },
            }
        )

        result = regression_service.list_regressions()

        assert len(result["regressions"]) == 1
        item = result["regressions"][0]
        assert item["variables"]["api_key"]["value"] == "********"

    def test_update_regression_response_masks_secret_value(self) -> None:
        """update_regression return value has secret values masked."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        created = regression_service.create_regression(
            {
                "name": "Secret Regression",
                "variables": {
                    "api_key": {"type": "string", "secret": True, "value": "s3cret"},
                },
            }
        )

        updated = regression_service.update_regression(created["id"], {"description": "updated"})

        assert updated is not None
        assert updated["variables"]["api_key"]["value"] == "********"

    def test_clone_regression_response_masks_secret_value(self) -> None:
        """clone_regression return value has secret values masked."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service

        clear_regression_storage()
        created = regression_service.create_regression(
            {
                "name": "Secret Regression",
                "variables": {
                    "api_key": {"type": "string", "secret": True, "value": "s3cret"},
                },
            }
        )

        cloned = version_service.clone_regression(created["id"])

        assert cloned is not None
        assert cloned["variables"]["api_key"]["value"] == "********"

    def test_non_secret_variables_are_not_touched(self) -> None:
        """Non-secret variables keep their original value."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        created = regression_service.create_regression(
            {
                "name": "Mixed Regression",
                "variables": {
                    "env": {"type": "string", "value": "dev"},
                    "api_key": {"type": "string", "secret": True, "value": "s3cret"},
                },
            }
        )

        result = regression_service.get_regression(created["id"])

        assert result is not None
        assert result["variables"]["env"]["value"] == "dev"
        assert result["variables"]["api_key"]["value"] == "********"

    def test_stored_file_still_has_real_secret_value(self) -> None:
        """Persisted YAML carries the sealed envelope that restores the real value."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        clear_regression_storage()
        created = regression_service.create_regression(
            {
                "name": "Persist Regression",
                "variables": {
                    "api_key": {"type": "string", "secret": True, "value": "s3cret"},
                },
            }
        )

        stored = load_regression_file(created["id"])
        assert stored is not None
        assert is_secret_envelope(stored["variables"]["api_key"]["value"])
        assert unseal_all(stored["variables"]["api_key"]["value"]) == "s3cret"

    def test_mask_regression_variables_guard_returns_input_when_no_variables_key(
        self,
    ) -> None:
        """version_service._mask_regression_variables returns the input unchanged
        when the dict has no 'variables' key. Guards against attribute access
        on records that never had variables (e.g. a freshly-loaded stub).
        """
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        raw = {"id": "abc", "name": "NoVars"}
        result = _reg_version_svc._mask_regression_variables(raw)
        assert result is raw

    def test_mask_secret_variables_returns_non_dict_input_unchanged(self) -> None:
        """shared.mask_secret_variables passes through non-dict inputs.

        Callers occasionally forward ``None`` or a list from unnormalized
        storage records; the helper must not raise.
        """
        from wavecore.api.services.shared import mask_secret_variables

        assert mask_secret_variables(None) is None  # type: ignore[arg-type]
        assert mask_secret_variables([]) == []  # type: ignore[arg-type]


class TestRegressionServiceEdgeCases:
    """Test suite for regression service edge cases."""

    def test_create_regression_with_empty_name_raises(self) -> None:
        """Test that creating regression with empty name raises."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            regression_service.create_regression({"name": ""})

        assert "name" in str(exc_info.value).lower()

    def test_create_regression_with_whitespace_name_raises(self) -> None:
        """Test that creating regression with whitespace-only name raises."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            regression_service.create_regression({"name": "   "})

        assert "name" in str(exc_info.value).lower()

    def test_create_regression_with_long_name_raises(self) -> None:
        """Test that creating regression with name >255 chars raises."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            regression_service.create_regression({"name": "A" * 256})

        assert "255" in str(exc_info.value) or "length" in str(exc_info.value).lower()

    def test_create_regression_with_invalid_characters_raises(self) -> None:
        """Test that creating regression with invalid name characters raises."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        with pytest.raises((ConflictException, ValidationException, WaveException)) as exc_info:
            regression_service.create_regression({"name": "Invalid@Name!"})

        assert "naming convention" in str(exc_info.value).lower()

    def test_update_regression_preserves_suite_order(self) -> None:
        """Test that update preserves existing suite order."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()

        suite1 = suite_service.create_suite({"name": "Suite One"})
        suite2 = suite_service.create_suite({"name": "Suite Two"})

        regression = regression_service.create_regression(
            {
                "name": "Nightly Regression",
                "suites": [suite1["id"], suite2["id"]],
            }
        )

        result = regression_service.update_regression(regression["id"], {"description": "Updated"})

        assert result["suites"] == [suite1["id"], suite2["id"]]

    def test_get_version_returns_none_for_nonexistent_regression(self) -> None:
        """Test that get_regression_version returns None for nonexistent regression."""
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        result = _reg_version_svc.get_regression_version(str(uuid.uuid4()), "1.0.0")

        assert result is None

    def test_update_version_returns_none_for_nonexistent_regression(self) -> None:
        """Test that update_regression_version returns None for nonexistent regression."""
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        result = _reg_version_svc.update_regression_version(
            str(uuid.uuid4()), "1.0.0", {"notes": "test"}
        )

        assert result is None

    def test_update_version_returns_none_for_nonexistent_version(self) -> None:
        """Test that update_regression_version returns None for nonexistent version."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        regression = regression_service.create_regression({"name": "Test Regression"})

        result = _reg_version_svc.update_regression_version(
            regression["id"], "99.0.0", {"notes": "test"}
        )

        assert result is None

    def test_delete_version_returns_false_for_nonexistent_regression(self) -> None:
        """Test that delete_regression_version returns False for nonexistent regression."""
        from wavecore.api.services.regressions import version_service as _reg_version_svc

        clear_regression_storage()

        result = _reg_version_svc.delete_regression_version(str(uuid.uuid4()), "1.0.0")

        assert result is False

    def test_load_versions_returns_empty_list_when_no_versions_file(self) -> None:
        """Test that _load_versions returns [] when versions file doesn't exist."""
        from wavecore.api.services.regressions import _storage as _reg_storage
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        # Create regression (which creates a versions file)
        regression = regression_service.create_regression({"name": "Test Regression"})

        # Delete the versions file to simulate missing file
        import os

        from wavecore.api.services.storage_paths import get_regressions_storage_path

        versions_path = get_regressions_storage_path() / regression["id"] / "versions.yaml"
        if versions_path.exists():
            os.remove(versions_path)

        # Now load versions should return empty list
        versions = _reg_storage._load_versions(regression["id"])

        assert versions == []

    def test_update_regression_with_suites_field(self) -> None:
        """Test that update_regression updates the suites field correctly."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()

        suite1 = suite_service.create_suite({"name": "Suite One"})
        suite2 = suite_service.create_suite({"name": "Suite Two"})

        regression = regression_service.create_regression(
            {
                "name": "Test Regression",
                "suites": [suite1["id"]],
            }
        )

        # Update with new suites list
        result = regression_service.update_regression(
            regression["id"], {"suites": [suite1["id"], suite2["id"]]}
        )

        assert result["suites"] == [suite1["id"], suite2["id"]]

    def test_add_version_with_suites_updates_suites(self) -> None:
        """Test that add_regression_version updates suites when provided."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions import version_service as _reg_version_svc
        from wavecore.api.services.suites import service as suite_service

        clear_regression_storage()

        suite1 = suite_service.create_suite({"name": "Suite One"})
        suite2 = suite_service.create_suite({"name": "Suite Two"})

        regression = regression_service.create_regression(
            {
                "name": "Test Regression",
                "suites": [suite1["id"]],
            }
        )

        # Add version with new suites list
        result = _reg_version_svc.add_regression_version(
            regression["id"], {"suites": [suite1["id"], suite2["id"]]}
        )

        assert result is not None
        assert result["suites"] == [suite1["id"], suite2["id"]]


class TestRegressionExecutionIntegration:
    """Test suite for regression service integration with execution service."""

    def test_version_has_dependencies_returns_true_when_version_matches(self) -> None:
        """Test that _version_has_dependencies returns True when version matches."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.regressions import _storage as _reg_storage
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Test Regression"})

        # Mock execution_service.list_executions to return an execution with matching version
        with patch.object(
            execution_service,
            "list_executions",
            return_value={
                "executions": [{"id": "exec-1", "entity_version": "1.0.0"}],
                "total": 1,
                "page": 1,
                "per_page": 100,
            },
        ):
            result = _reg_storage._version_has_dependencies(created["id"], "1.0.0")
            assert result is True

    def test_version_has_dependencies_returns_false_when_no_version_matches(
        self,
    ) -> None:
        """Test that _version_has_dependencies returns False when no version matches."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.regressions import _storage as _reg_storage
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        created = regression_service.create_regression({"name": "Test Regression"})

        # Mock execution_service.list_executions to return executions with different version
        with patch.object(
            execution_service,
            "list_executions",
            return_value={
                "executions": [{"id": "exec-1", "entity_version": "2.0.0"}],
                "total": 1,
                "page": 1,
                "per_page": 100,
            },
        ):
            result = _reg_storage._version_has_dependencies(created["id"], "1.0.0")
            assert result is False


class TestListAllTags:
    """Test suite for list_all_tags function (REQ-9.5.3.3)."""

    def test_list_all_tags_returns_unique_tags_from_all_regressions(self) -> None:
        """Test that list_all_tags returns unique tags from all regressions."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        # Create regressions with tags at top-level
        regression_service.create_regression(
            {
                "name": "Regression 1",
                "tags": ["release-1.0", "critical"],
            }
        )
        regression_service.create_regression(
            {
                "name": "Regression 2",
                "tags": ["release-1.0", "nightly"],
            }
        )
        regression_service.create_regression(
            {
                "name": "Regression 3",
                "tags": ["weekly", "full"],
            }
        )

        result = regression_service.list_all_tags()

        # Should contain all unique tags
        assert "release-1.0" in result
        assert "critical" in result
        assert "nightly" in result
        assert "weekly" in result
        assert "full" in result
        # Should be sorted alphabetically
        assert result == sorted(result)
        # Should have no duplicates (release-1.0 appears in 2 regressions)
        assert len(result) == len(set(result))

    def test_list_all_tags_returns_empty_list_when_no_regressions_exist(self) -> None:
        """Test that list_all_tags returns empty list when no regressions exist."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        result = regression_service.list_all_tags()

        assert result == []

    def test_list_all_tags_returns_empty_list_when_regressions_have_no_tags(
        self,
    ) -> None:
        """Test that list_all_tags returns empty list when regressions have no tags."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        # Create regressions without tags
        regression_service.create_regression({"name": "Regression 1"})
        regression_service.create_regression({"name": "Regression 2", "tags": []})

        result = regression_service.list_all_tags()

        assert result == []

    def test_list_all_tags_returns_sorted_tags(self) -> None:
        """Test that list_all_tags returns tags in alphabetical order."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        regression_service.create_regression(
            {
                "name": "Regression 1",
                "tags": ["zulu", "alpha", "mike"],
            }
        )

        result = regression_service.list_all_tags()

        assert result == ["alpha", "mike", "zulu"]

    def test_list_all_tags_deduplicates_across_regressions(self) -> None:
        """Test that list_all_tags returns each tag only once."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()

        # Create multiple regressions with overlapping tags
        regression_service.create_regression(
            {
                "name": "Regression 1",
                "tags": ["quarterly", "production"],
            }
        )
        regression_service.create_regression(
            {
                "name": "Regression 2",
                "tags": ["quarterly", "staging"],
            }
        )
        regression_service.create_regression(
            {
                "name": "Regression 3",
                "tags": ["quarterly", "development"],
            }
        )

        result = regression_service.list_all_tags()

        # "quarterly" should appear only once
        assert result.count("quarterly") == 1
        assert set(result) == {"quarterly", "production", "staging", "development"}

    def test_find_suites_by_parent_regression_empty_name(self) -> None:
        """Empty regression name returns empty list immediately."""
        from wavecore.api.services.regressions.service import (
            _find_suites_by_parent_regression,
        )

        result = _find_suites_by_parent_regression("", None, None)
        assert result == []


def _regression_history(suite_id: str) -> list[dict[str, Any]]:
    """Two history rows, each with the snapshot a Regression row carries."""
    return [
        {
            "version": "1.0.0",
            "created_at": "2025-01-02T03:04:05+00:00",
            "created_by": "ada",
            "changes": "Initial version",
            "snapshot": {"description": "", "suites": [], "variables": {}},
        },
        {
            "version": "1.3.0",
            "created_at": "2025-06-07T08:09:10+00:00",
            "created_by": "grace",
            "changes": "Added the release gate",
            "snapshot": {
                "description": "Release gate",
                "suites": [suite_id],
                "variables": {"region": {"type": "string", "value": "eu"}},
            },
        },
    ]


def _regression_document(name: str, **fields: Any) -> dict[str, Any]:
    """A whole Regression document whose version and times no save would produce."""
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "version": "1.3.0",
        "description": "Release gate",
        "suites": [str(uuid.uuid4())],
        "tags": ["release"],
        "variables": {"region": {"type": "string", "value": "eu"}},
        "metadata": {"owner": "ada"},
        "created_at": "2025-01-02T03:04:05+00:00",
        "updated_at": "2025-06-07T08:09:10+00:00",
        **fields,
    }


@contextmanager
def _regression_writer_spy() -> Iterator[MagicMock]:
    """Watch the public writer, whichever binding the import reaches it through."""
    from wavecore.api.services.regressions import import_export
    from wavecore.api.services.regressions import service as regression_service

    spy = MagicMock(wraps=regression_service.persist_regression_document)
    with (
        patch.object(regression_service, "persist_regression_document", spy),
        patch.object(import_export, "persist_regression_document", spy, create=True),
    ):
        yield spy


@contextmanager
def _failing_regression_history_write() -> Iterator[None]:
    """Make the history saver fail, whichever binding the writer reaches it through."""
    from wavecore.api.services.regressions import _storage as regression_storage
    from wavecore.api.services.regressions import service as regression_service

    failure = OSError("disk full")
    with (
        patch.object(regression_storage, "_save_versions", side_effect=failure),
        patch.object(regression_service, "_save_versions", side_effect=failure, create=True),
    ):
        yield


class TestPersistRegressionDocument:
    """The public writer stores a Regression as handed over (REQ-5.2.4.9.5, REQ-5.2.4.9.6)."""

    def test_the_document_and_the_rows_are_written_as_given(self) -> None:
        """Version, times and history rows with their snapshots are stored unchanged."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        document = _regression_document("Kept Whole")
        history = _regression_history(document["suites"][0])

        regression_service.persist_regression_document(
            copy.deepcopy(document), copy.deepcopy(history)
        )

        stored = regression_service.list_regression_documents()
        assert len(stored) == 1
        stored_document, stored_rows = stored[0]
        assert stored_document == document
        assert stored_rows == history

    def test_the_regressions_import_writes_through_it(self) -> None:
        """The import stores its Regression through the writer, with its one history row."""
        from wavecore.api.services.regressions import import_export
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        content = yaml.safe_dump({"name": "Imported Regression", "suites": []}).encode()

        with _regression_writer_spy() as writer:
            result = import_export.import_regressions(content, "regression.yaml")

        writer.assert_called_once()
        stored = regression_service.list_regression_documents()
        assert len(stored) == 1
        document, rows = stored[0]
        assert document["id"] == result["imported"][0]["id"]
        assert rows == [
            {
                "version": "1.0.0",
                "created_at": document["created_at"],
                "created_by": "import",
                "changes": "Imported regression",
            }
        ]

    def test_a_failed_write_of_a_new_regression_removes_its_folder_and_raises_again(self) -> None:
        """A new Regression whose write fails leaves no folder; one that was here stays."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        was_here = regression_service.create_regression({"name": "Was Here"})
        new = _regression_document("Half Written")
        again = _regression_document("Was Here", id=was_here["id"])

        with _failing_regression_history_write():
            with pytest.raises(OSError, match=r"^disk full$"):
                regression_service.persist_regression_document(
                    copy.deepcopy(new), _regression_history(new["suites"][0])
                )
            with pytest.raises(OSError, match=r"^disk full$"):
                regression_service.persist_regression_document(
                    again, _regression_history(again["suites"][0])
                )

        assert not get_regression_dir(new["id"]).exists()
        assert get_regression_dir(was_here["id"]).is_dir()
        assert [
            document["id"] for document, _rows in regression_service.list_regression_documents()
        ] == [was_here["id"]]


class TestListRegressionDocuments:
    """The public reader hands back every stored Regression with its history (REQ-5.2.4.9.5)."""

    def test_every_stored_regression_comes_back_with_its_history_rows(self) -> None:
        """One pair per Regression, and every history row keeps its snapshot."""
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        first = regression_service.create_regression(
            {
                "name": "First",
                "tags": ["release"],
                "variables": {"token": {"type": "string", "secret": True, "value": "s3cret"}},
            }
        )
        second = regression_service.create_regression({"name": "Second"})
        regression_service.update_regression(second["id"], {"description": "Changed"})

        pairs = regression_service.list_regression_documents()

        assert len(pairs) == 2
        by_id = {document["id"]: (document, rows) for document, rows in pairs}
        assert by_id == {
            regression_id: (load_regression_file(regression_id), load_versions_file(regression_id))
            for regression_id in (first["id"], second["id"])
        }
        second_rows = by_id[second["id"]][1]
        assert [row["version"] for row in second_rows] == ["1.0.0", "1.1.0"]
        assert [row["snapshot"]["description"] for row in second_rows] == ["", "Changed"]
