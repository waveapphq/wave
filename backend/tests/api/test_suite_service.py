"""Unit tests for suite service layer (REQ-5.2.4.4).

This module tests the suite service providing business logic for suite management
including creation, modification, version control, test composition, and validation.

Test Coverage:
- CRUD operations: create_suite, get_suite, update_suite, delete_suite
- Batch operations: batch_create, batch_update, batch_delete
- Version control: list_versions, add_version, get_version, update_version, delete_version
- Test composition: add_test, remove_test, reorder_tests
- Clone operations: clone_suite
- Storage integration: YAML file persistence
- Error handling: Validation, conflicts, not found
"""

import copy
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import yaml

from tests.api.suite_test_helpers import (
    clear_suite_storage,
    get_suite_dir,
    load_suite_file,
    load_versions_file,
    make_test_ids,
    save_suite_file,
    set_version_attribute,
)


class TestListSuitesService:
    """Test suite for list_suites service function."""

    def test_list_suites_returns_empty_list_when_no_suites(self) -> None:
        """Test that list_suites returns empty list when no suites exist."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.list_suites()

        assert result["suites"] == []
        assert result["total"] == 0
        assert result["page"] == 1
        assert result["per_page"] == 20
        assert result["total_pages"] == 0

    def test_list_suites_returns_all_suites(self) -> None:
        """Test that list_suites returns all created suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Suite One"})
        suite_service.create_suite({"name": "Suite Two"})

        result = suite_service.list_suites()

        assert result["total"] == 2
        assert len(result["suites"]) == 2

    def test_list_suites_supports_pagination(self) -> None:
        """Test that list_suites supports page-based pagination."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        for i in range(25):
            suite_service.create_suite({"name": f"Suite {i}"})

        result = suite_service.list_suites(page=1, per_page=10)
        assert len(result["suites"]) == 10
        assert result["total"] == 25
        assert result["total_pages"] == 3

        result = suite_service.list_suites(page=3, per_page=10)
        assert len(result["suites"]) == 5

    def test_list_suites_supports_search_filter(self) -> None:
        """Test that list_suites supports text search filter."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Smoke Test Suite"})
        suite_service.create_suite({"name": "Regression Suite"})
        suite_service.create_suite({"name": "Performance Suite"})

        result = suite_service.list_suites(search="smoke")

        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Smoke Test Suite"

    def test_list_suites_search_includes_description(self) -> None:
        """Test that list_suites search includes description field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Suite A", "description": "Contains smoke tests"})
        suite_service.create_suite({"name": "Suite B", "description": "Other tests"})

        result = suite_service.list_suites(search="smoke")

        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Suite A"


class TestCreateSuiteService:
    """Test suite for create_suite service function."""

    def test_create_suite_generates_uuid(self) -> None:
        """Test that create_suite generates a valid UUID."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite({"name": "Test Suite"})

        assert "id" in result
        uuid.UUID(result["id"])  # Validates UUID format

    def test_create_suite_sets_initial_version(self) -> None:
        """Test that create_suite sets version to 1.0.0."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite({"name": "Test Suite"})

        assert result["version"] == "1.0.0"

    def test_create_suite_sets_timestamps(self) -> None:
        """Test that create_suite sets created_at and updated_at."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite({"name": "Test Suite"})

        assert "created_at" in result
        assert "updated_at" in result
        assert result["created_at"] == result["updated_at"]

    def test_create_suite_stores_name_and_description(self) -> None:
        """Test that create_suite stores name and description."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite({"name": "My Suite", "description": "Test description"})

        assert result["name"] == "My Suite"
        assert result["description"] == "Test description"

    def test_create_suite_stores_test_references(self) -> None:
        """Test that create_suite stores test references."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        test_ids = make_test_ids(2)
        result = suite_service.create_suite({"name": "My Suite", "tests": test_ids})

        assert result["tests"] == test_ids

    def test_create_suite_refuses_an_unknown_test(self) -> None:
        """A Test ID that matches no Test refuses the create and saves nothing."""
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        member = test_service.create_test({"name": "Member"})
        unknown_id = str(uuid.uuid4())

        with pytest.raises(ValidationException, match=rf"^Test with ID '{unknown_id}' not found$"):
            suite_service.create_suite({"name": "My Suite", "tests": [member["id"], unknown_id]})

        assert suite_service.list_suite_names() == []

    def test_create_suite_stores_variables(self) -> None:
        """Test that create_suite stores variable declarations."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite(
            {"name": "My Suite", "variables": {"env": {"type": "string", "value": "staging"}}}
        )

        assert "env" in result["variables"]
        assert result["variables"]["env"]["value"] == "staging"

    def test_create_suite_stores_metadata(self) -> None:
        """Test that create_suite stores metadata."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite(
            {"name": "My Suite", "metadata": {"author": "test-user"}}
        )

        assert result["metadata"]["author"] == "test-user"

    def test_create_suite_raises_on_duplicate_name(self) -> None:
        """Test that create_suite raises ConflictException on duplicate name."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Existing Suite"})

        with pytest.raises(
            ConflictException,
            match=r"^Suite with name 'Existing Suite' already exists$",
        ):
            suite_service.create_suite({"name": "Existing Suite"})

    def test_create_suite_creates_version_history(self) -> None:
        """Test that create_suite creates initial version history."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        result = suite_service.create_suite({"name": "Test Suite"})
        versions = _suite_version_svc.list_suite_versions(result["id"])

        assert versions == ["1.0.0"]

    def test_create_suite_refuses_a_test_id_that_is_not_text(self) -> None:
        """A Test ID that is not text matches no Test."""
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        with pytest.raises(ValidationException, match=r"^Test with ID '42' not found$"):
            suite_service.create_suite({"name": "My Suite", "tests": [42]})

        assert suite_service.list_suite_names() == []


class TestGetSuiteService:
    """Test suite for get_suite service function."""

    def test_get_suite_returns_suite_by_id(self) -> None:
        """Test that get_suite returns suite by ID."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Test Suite"})
        result = suite_service.get_suite(created["id"])

        assert result is not None
        assert result["id"] == created["id"]
        assert result["name"] == "Test Suite"

    def test_get_suite_returns_none_when_not_found(self) -> None:
        """Test that get_suite returns None when suite not found."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.get_suite(str(uuid.uuid4()))

        assert result is None


class TestUpdateSuiteService:
    """Test suite for update_suite service function."""

    def test_update_suite_updates_name(self) -> None:
        """Test that update_suite updates suite name."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Original Name"})
        result = suite_service.update_suite(created["id"], {"name": "Updated Name"})

        assert result is not None
        assert result["name"] == "Updated Name"

    def test_update_suite_increments_version(self) -> None:
        """Test that update_suite increments version."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Test Suite"})
        assert created["version"] == "1.0.0"

        result = suite_service.update_suite(created["id"], {"description": "Updated"})

        assert result is not None
        assert result["version"] == "1.1.0"

    def test_update_suite_updates_timestamp(self) -> None:
        """Test that update_suite updates updated_at timestamp."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Test Suite"})
        original_updated_at = created["updated_at"]

        result = suite_service.update_suite(created["id"], {"description": "Updated"})

        assert result is not None
        assert result["updated_at"] >= original_updated_at

    def test_update_suite_returns_none_when_not_found(self) -> None:
        """Test that update_suite returns None when suite not found."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.update_suite(str(uuid.uuid4()), {"name": "New Name"})

        assert result is None

    def test_update_suite_validates_etag(self) -> None:
        """Test that update_suite validates ETag for concurrency control."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Test Suite"})

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(
            ConflictException,
            match=r"^Precondition failed: resource has been modified$",
        ):
            suite_service.update_suite(created["id"], {"name": "Updated"}, etag='"invalid-etag"')

    def test_update_suite_adds_version_history(self) -> None:
        """Test that update_suite adds to version history."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Test Suite"})
        suite_service.update_suite(created["id"], {"description": "Update 1"})
        suite_service.update_suite(created["id"], {"description": "Update 2"})

        versions = _suite_version_svc.list_suite_versions(created["id"])

        assert len(versions) == 3
        assert "1.0.0" in versions
        assert "1.1.0" in versions
        assert "1.2.0" in versions

    def test_update_suite_refuses_an_unknown_test(self) -> None:
        """Adding a Test ID that matches no Test refuses the update and changes nothing."""
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        member = test_service.create_test({"name": "Member"})
        created = suite_service.create_suite({"name": "Test Suite", "tests": [member["id"]]})
        unknown_id = str(uuid.uuid4())

        with pytest.raises(ValidationException, match=rf"^Test with ID '{unknown_id}' not found$"):
            suite_service.update_suite(created["id"], {"tests": [member["id"], unknown_id]})

        stored = load_suite_file(created["id"])
        assert stored is not None
        assert stored["tests"] == [member["id"]]
        assert stored["version"] == "1.0.0"

    def test_update_suite_keeps_a_held_test_that_no_longer_exists(self) -> None:
        """Only added Tests are checked, so a Test the Suite already holds never blocks a save."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        member = test_service.create_test({"name": "Member"})
        created = suite_service.create_suite({"name": "Test Suite"})
        gone_id = str(uuid.uuid4())
        stored = load_suite_file(created["id"])
        assert stored is not None
        stored["tests"] = [gone_id]
        save_suite_file(stored)

        result = suite_service.update_suite(created["id"], {"tests": [gone_id, member["id"]]})

        assert result is not None
        assert result["tests"] == [gone_id, member["id"]]


class TestDeleteSuiteService:
    """Test suite for delete_suite service function."""

    def test_delete_suite_removes_suite(self) -> None:
        """Test that delete_suite removes suite from storage."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Test Suite"})
        result = suite_service.delete_suite(created["id"])

        assert result is True
        assert suite_service.get_suite(created["id"]) is None

    def test_delete_suite_returns_false_when_not_found(self) -> None:
        """Test that delete_suite returns False when suite not found."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.delete_suite(str(uuid.uuid4()))

        assert result is False

    def test_delete_suite_updates_relation_index(self) -> None:
        """Test that delete_suite cleans up the relation index."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        test_service._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._suite_to_regressions.clear()
        relation_service._initialized = False

        test = test_service.create_test({"name": "Orphan Test"})
        suite = suite_service.create_suite({"name": "Test Suite", "tests": [test["id"]]})

        # Verify relation exists
        assert relation_service.get_suite_count_for_test(test["id"]) == 1

        suite_service.delete_suite(suite["id"])

        # Relation should be cleaned up
        assert relation_service.get_suite_count_for_test(test["id"]) == 0


class TestDeleteSuiteActiveExecutionGuard:
    """Delete blocked with ConflictException when a suite-type tracked
    execution is running or paused. Payload carries execution IDs."""

    def test_delete_suite_raises_conflict_when_running_execution(self) -> None:
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        _exec_storage._clear_storage()

        suite = suite_service.create_suite({"name": "Busy Suite"})
        suite_id = suite["id"]

        execution_id = str(uuid.uuid4())
        _exec_storage._execution_storage[execution_id] = {
            "id": execution_id,
            "name": "Busy Suite",
            "entity_type": "suite",
            "entity_id": suite_id,
            "environment_id": "env-1",
            "status": "running",
            "started_at": "2026-04-20T10:00:00+00:00",
            "triggered_by": "dev",
        }

        with pytest.raises(ConflictException) as exc_info:
            suite_service.delete_suite(suite_id)

        assert exc_info.value.details == {"execution_ids": [execution_id]}
        assert suite_service.get_suite(suite_id) is not None

    def test_delete_suite_raises_conflict_when_paused_execution(self) -> None:
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        _exec_storage._clear_storage()

        suite = suite_service.create_suite({"name": "Paused Suite"})
        suite_id = suite["id"]

        execution_id = str(uuid.uuid4())
        _exec_storage._execution_storage[execution_id] = {
            "id": execution_id,
            "name": "Paused Suite",
            "entity_type": "suite",
            "entity_id": suite_id,
            "environment_id": "env-1",
            "status": "paused",
            "started_at": "2026-04-20T10:00:00+00:00",
            "triggered_by": "dev",
        }

        with pytest.raises(ConflictException) as exc_info:
            suite_service.delete_suite(suite_id)

        assert exc_info.value.details == {"execution_ids": [execution_id]}

    def test_delete_suite_succeeds_with_only_terminal_executions(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        _exec_storage._clear_storage()

        suite = suite_service.create_suite({"name": "Done Suite"})
        suite_id = suite["id"]

        _exec_storage._execution_storage["passed-exec"] = {
            "id": "passed-exec",
            "name": "Done Suite",
            "entity_type": "suite",
            "entity_id": suite_id,
            "environment_id": "env-1",
            "status": "passed",
            "started_at": "2026-04-20T10:00:00+00:00",
            "ended_at": "2026-04-20T10:00:05+00:00",
            "triggered_by": "dev",
        }

        assert suite_service.delete_suite(suite_id) is True
        assert suite_service.get_suite(suite_id) is None

    def test_delete_suite_ignores_test_type_executions_for_same_id(self) -> None:
        """A running test-type execution whose entity_id happens to equal the
        suite id must not block the suite delete."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        _exec_storage._clear_storage()

        suite = suite_service.create_suite({"name": "Collision"})
        suite_id = suite["id"]

        _exec_storage._execution_storage["test-exec"] = {
            "id": "test-exec",
            "name": "Collision",
            "entity_type": "test",
            "entity_id": suite_id,  # Same UUID string as the suite.
            "environment_id": "env-1",
            "status": "running",
            "started_at": "2026-04-20T10:00:00+00:00",
            "triggered_by": "dev",
        }

        assert suite_service.delete_suite(suite_id) is True


class TestDeleteSuiteRegressionCascade:
    """On successful delete, the suite is removed from every regression that
    referenced it so no dangling suite IDs remain in regression records."""

    def test_delete_suite_removes_suite_from_referencing_regression(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        relation_service._test_to_suites.clear()
        relation_service._suite_to_regressions.clear()
        relation_service._initialized = False

        suite = suite_service.create_suite({"name": "Under Regression"})
        suite_id = suite["id"]

        regression = regression_service.create_regression({"name": "Nightly", "suites": [suite_id]})
        regression_id = regression["id"]

        suite_service.delete_suite(suite_id)

        loaded = regression_service.get_regression(regression_id)
        assert loaded is not None
        assert suite_id not in (loaded.get("suites") or [])

    def test_delete_suite_cascades_to_all_referencing_regressions(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        relation_service._test_to_suites.clear()
        relation_service._suite_to_regressions.clear()
        relation_service._initialized = False

        shared_suite = suite_service.create_suite({"name": "Shared"})
        other_suite = suite_service.create_suite({"name": "Other"})

        reg_a = regression_service.create_regression(
            {"name": "A", "suites": [shared_suite["id"], other_suite["id"]]}
        )
        reg_b = regression_service.create_regression({"name": "B", "suites": [shared_suite["id"]]})

        suite_service.delete_suite(shared_suite["id"])

        loaded_a = regression_service.get_regression(reg_a["id"])
        loaded_b = regression_service.get_regression(reg_b["id"])
        assert shared_suite["id"] not in (loaded_a.get("suites") or [])
        assert shared_suite["id"] not in (loaded_b.get("suites") or [])
        # The untouched suite stays on regression A.
        assert other_suite["id"] in (loaded_a.get("suites") or [])

    def test_delete_suite_updates_suite_to_regressions_index(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        relation_service._test_to_suites.clear()
        relation_service._suite_to_regressions.clear()
        relation_service._initialized = False

        suite = suite_service.create_suite({"name": "Tracked"})
        regression_service.create_regression({"name": "R1", "suites": [suite["id"]]})

        suite_service.delete_suite(suite["id"])

        assert relation_service.get_regression_count_for_suite(suite["id"]) == 0


class TestBatchDeleteSuitesService:
    """Test suite for batch_delete_suites service function."""

    def test_batch_delete_suites_deletes_multiple(self) -> None:
        """Test that batch_delete_suites deletes multiple suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Suite One"})
        suite2 = suite_service.create_suite({"name": "Suite Two"})

        result = suite_service.batch_delete_suites([suite1["id"], suite2["id"]])

        assert len(result["deleted"]) == 2
        assert len(result["failed"]) == 0


class TestBatchCloneSuitesService:
    """Test suite for batch_clone_suites service function."""

    def test_batch_clone_suites_clones_multiple(self) -> None:
        """batch_clone_suites clones multiple suites with '(Copy)' suffix."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Suite One"})
        suite2 = suite_service.create_suite({"name": "Suite Two"})

        result = suite_service.batch_clone_suites([suite1["id"], suite2["id"]])

        assert len(result["cloned"]) == 2
        assert len(result["failed"]) == 0
        original_ids = {entry["original_id"] for entry in result["cloned"]}
        assert original_ids == {suite1["id"], suite2["id"]}

        # Each cloned suite has a distinct ID
        cloned_ids = {entry["cloned_id"] for entry in result["cloned"]}
        assert cloned_ids.isdisjoint({suite1["id"], suite2["id"]})

    def test_batch_clone_suites_handles_missing_suite(self) -> None:
        """Missing suites are reported as failures without aborting the batch."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        real = suite_service.create_suite({"name": "Real Suite"})
        missing_id = str(uuid.uuid4())

        result = suite_service.batch_clone_suites([missing_id, real["id"]])

        assert len(result["cloned"]) == 1
        assert result["cloned"][0]["original_id"] == real["id"]
        assert len(result["failed"]) == 1
        failure = result["failed"][0]
        assert failure["index"] == 0
        assert missing_id in failure["error"]

    def test_batch_clone_suites_captures_clone_exceptions(self) -> None:
        """Exceptions raised during clone are captured as failures."""
        from unittest.mock import patch

        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Exploding Suite"})

        with patch(
            "wavecore.api.services.suites.version_service.clone_suite",
            side_effect=ConflictException("Duplicate name"),
        ):
            result = suite_service.batch_clone_suites([suite["id"]])

        assert result["cloned"] == []
        assert len(result["failed"]) == 1
        assert "Duplicate name" in result["failed"][0]["error"]

    def test_batch_clone_suites_handles_none_clone_result(self) -> None:
        """When clone_suite returns None mid-batch, the entry is recorded as failed."""
        from unittest.mock import patch

        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Phantom Suite"})

        with patch(
            "wavecore.api.services.suites.version_service.clone_suite",
            return_value=None,
        ):
            result = suite_service.batch_clone_suites([suite["id"]])

        assert result["cloned"] == []
        assert len(result["failed"]) == 1
        assert suite["id"] in result["failed"][0]["error"]

    def test_batch_clone_suites_names_each_copy_and_each_missing_suite(self) -> None:
        """Each copy takes its source name with '(Copy)'; a missing suite is named by its index."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        real = suite_service.create_suite({"name": "Suite One"})
        missing_id = str(uuid.uuid4())

        result = suite_service.batch_clone_suites([missing_id, real["id"]])

        assert result["failed"] == [
            {"index": 0, "error": f"Suite with ID '{missing_id}' not found"}
        ]
        [entry] = result["cloned"]
        assert entry["original_id"] == real["id"]
        clone = suite_service.get_suite(entry["cloned_id"])
        assert clone is not None
        assert clone["name"] == "Suite One (Copy)"


class TestListSuiteVersionsService:
    """Test suite for list_suite_versions service function."""

    def test_list_suite_versions_returns_versions(self) -> None:
        """Test that list_suite_versions returns version list."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        _suite_version_svc.add_suite_version(suite["id"], {"description": "v1.1.0"})

        versions = _suite_version_svc.list_suite_versions(suite["id"])

        assert "1.0.0" in versions
        assert "1.1.0" in versions

    def test_list_suite_versions_returns_none_when_not_found(self) -> None:
        """Test that list_suite_versions returns None when suite not found."""
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        result = _suite_version_svc.list_suite_versions(str(uuid.uuid4()))

        assert result is None


class TestAddSuiteVersionService:
    """Test suite for add_suite_version service function."""

    def test_add_suite_version_creates_new_version(self) -> None:
        """Test that add_suite_version creates a new version."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        result = _suite_version_svc.add_suite_version(suite["id"], {"description": "Updated"})

        assert result is not None
        assert result["version"] == "1.1.0"

    def test_add_suite_version_supports_version_bump_types(self) -> None:
        """Test that add_suite_version supports major/minor/patch bumps."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})

        # Minor bump (default)
        result = _suite_version_svc.add_suite_version(suite["id"], {})
        assert result["version"] == "1.1.0"

        # Major bump
        result = _suite_version_svc.add_suite_version(suite["id"], {"version_bump": "major"})
        assert result["version"] == "2.0.0"

        # Patch bump
        result = _suite_version_svc.add_suite_version(suite["id"], {"version_bump": "patch"})
        assert result["version"] == "2.0.1"


class TestGetSuiteVersionService:
    """Test suite for get_suite_version service function."""

    def test_get_suite_version_returns_version(self) -> None:
        """Test that get_suite_version returns specific version."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        result = _suite_version_svc.get_suite_version(suite["id"], "1.0.0")

        assert result is not None
        assert result["version"] == "1.0.0"

    def test_get_suite_version_returns_none_when_not_found(self) -> None:
        """Test that get_suite_version returns None when version not found."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        result = _suite_version_svc.get_suite_version(suite["id"], "9.9.9")

        assert result is None

    def test_get_suite_version_indicates_latest(self) -> None:
        """Test that get_suite_version indicates if version is latest."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        _suite_version_svc.add_suite_version(suite["id"], {})

        v1 = _suite_version_svc.get_suite_version(suite["id"], "1.0.0")
        v2 = _suite_version_svc.get_suite_version(suite["id"], "1.1.0")

        assert v1["is_latest"] is False
        assert v2["is_latest"] is True


class TestUpdateSuiteVersionService:
    """Test suite for update_suite_version service function."""

    def test_update_suite_version_updates_metadata(self) -> None:
        """Test that update_suite_version updates version metadata."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        result = _suite_version_svc.update_suite_version(
            suite["id"], "1.0.0", {"description": "Updated description"}
        )

        assert result is not None
        assert result["description"] == "Updated description"

    def test_update_suite_version_raises_when_published(self) -> None:
        """Test that update_suite_version raises when version is published."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        # Mark version as published
        set_version_attribute(suite["id"], "1.0.0", "published", True)

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(
            ConflictException,
            match=r"^Cannot modify published version '1\.0\.0'\. Published versions are "
            r"immutable\.$",
        ):
            _suite_version_svc.update_suite_version(
                suite["id"], "1.0.0", {"description": "Try to update"}
            )


class TestDeleteSuiteVersionService:
    """Test suite for delete_suite_version service function."""

    def test_delete_suite_version_removes_version(self) -> None:
        """Test that delete_suite_version removes version from history."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        _suite_version_svc.add_suite_version(suite["id"], {})

        result = _suite_version_svc.delete_suite_version(suite["id"], "1.0.0")

        assert result is True
        versions = _suite_version_svc.list_suite_versions(suite["id"])
        assert "1.0.0" not in versions

    def test_delete_suite_version_returns_false_when_not_found(self) -> None:
        """Test that delete_suite_version returns False when version not found."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        result = _suite_version_svc.delete_suite_version(suite["id"], "9.9.9")

        assert result is False

    def test_delete_suite_version_raises_when_referenced(self) -> None:
        """Test that delete_suite_version raises when version has references."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        # Add regression reference to version
        set_version_attribute(suite["id"], "1.0.0", "regression_refs", 2)

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(
            ConflictException,
            match=r"^Cannot delete version '1\.0\.0': 2 regressions reference this version$",
        ):
            _suite_version_svc.delete_suite_version(suite["id"], "1.0.0")


class TestAddTestToSuiteService:
    """Test suite for add_test_to_suite service function."""

    def test_add_test_to_suite_adds_test(self) -> None:
        """Test that add_test_to_suite adds test to suite."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.services.tests.service.get_test", return_value={"id": "mock"}):
            result = _suite_version_svc.add_test_to_suite(suite["id"], test_id)

        assert result is not None
        assert test_id in result["tests"]

    def test_add_test_to_suite_with_order(self) -> None:
        """Test that add_test_to_suite respects order parameter."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        test1_id, test2_id = make_test_ids(2)
        test3_id = str(uuid.uuid4())

        suite = suite_service.create_suite({"name": "Test Suite", "tests": [test1_id, test2_id]})

        with patch("wavecore.api.services.tests.service.get_test", return_value={"id": "mock"}):
            result = _suite_version_svc.add_test_to_suite(suite["id"], test3_id, order=1)

        assert result is not None
        assert result["tests"][1] == test3_id

    def test_add_test_to_suite_raises_when_test_not_found(self) -> None:
        """Test that add_test_to_suite raises when test doesn't exist."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.services.tests.service.get_test", return_value=None):
            from wavecore.api.exceptions import ValidationException

            with pytest.raises(
                ValidationException,
                match=rf"^Test with ID '{test_id}' not found$",
            ):
                _suite_version_svc.add_test_to_suite(suite["id"], test_id)

    def test_add_test_to_suite_returns_none_when_suite_not_found(self) -> None:
        """Test that add_test_to_suite returns None when suite not found."""
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        with patch("wavecore.api.services.tests.service.get_test", return_value={"id": "mock"}):
            result = _suite_version_svc.add_test_to_suite(str(uuid.uuid4()), str(uuid.uuid4()))

        assert result is None


class TestRemoveTestFromSuiteService:
    """Test suite for remove_test_from_suite service function."""

    def test_remove_test_from_suite_removes_test(self) -> None:
        """Test that remove_test_from_suite removes test from suite."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        [test_id] = make_test_ids(1)
        suite = suite_service.create_suite({"name": "Test Suite", "tests": [test_id]})

        result = _suite_version_svc.remove_test_from_suite(suite["id"], test_id)

        assert result is not None
        assert test_id not in result["tests"]

    def test_remove_test_from_suite_preserves_order(self) -> None:
        """Test that remove_test_from_suite preserves remaining test order."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        test1_id, test2_id, test3_id = make_test_ids(3)

        suite = suite_service.create_suite(
            {"name": "Test Suite", "tests": [test1_id, test2_id, test3_id]}
        )

        result = _suite_version_svc.remove_test_from_suite(suite["id"], test2_id)

        assert result is not None
        assert result["tests"] == [test1_id, test3_id]


class TestCloneSuiteService:
    """Test suite for clone_suite service function."""

    def test_clone_suite_creates_copy(self) -> None:
        """Test that clone_suite creates a copy of the suite."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        [test_id] = make_test_ids(1)
        original = suite_service.create_suite(
            {
                "name": "Original Suite",
                "description": "Original description",
                "tests": [test_id],
                "variables": {"env": {"type": "string", "value": "staging"}},
            }
        )

        clone = _suite_version_svc.clone_suite(original["id"], "Cloned Suite")

        assert clone is not None
        assert clone["id"] != original["id"]
        assert clone["name"] == "Cloned Suite"
        assert clone["tests"] == original["tests"]
        assert clone["variables"] == original["variables"]
        assert clone["metadata"]["cloned_from"] == original["id"]

    def test_clone_suite_with_new_version(self) -> None:
        """Test that clone_suite accepts new_version parameter."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        original = suite_service.create_suite({"name": "Original Suite"})
        clone = _suite_version_svc.clone_suite(original["id"], "Cloned Suite", "2.0.0")

        assert clone is not None
        assert clone["version"] == "2.0.0"

    def test_clone_suite_returns_none_when_not_found(self) -> None:
        """Test that clone_suite returns None when source not found."""
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        result = _suite_version_svc.clone_suite(str(uuid.uuid4()), "Clone Name")

        assert result is None

    def test_clone_suite_without_a_name_names_the_copy(self) -> None:
        """Without a new name the clone takes the source name with '(Copy)'."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        original = suite_service.create_suite({"name": "Original Suite"})
        clone = _suite_version_svc.clone_suite(original["id"])

        assert clone is not None
        assert clone["name"] == "Original Suite (Copy)"


class TestSuiteVariableValues:
    """Suite variable values follow the one number rule (REQ-3.1.3.14)."""

    def test_create_refuses_a_value_that_breaks_the_number_rule(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        with pytest.raises(
            ValidationException, match=r"^Value for variable 'port' is not a valid integer$"
        ):
            suite_service.create_suite(
                {"name": "Smoke", "variables": {"port": {"type": "integer", "value": "80.0"}}}
            )
        assert suite_service.list_suites()["total"] == 0

    def test_update_refuses_a_value_that_breaks_the_number_rule(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        created = suite_service.create_suite({"name": "Smoke"})

        with pytest.raises(
            ValidationException,
            match=r"^Value for variable 'ids' at item 1 is not a valid integer$",
        ):
            suite_service.update_suite(
                created["id"],
                {
                    "variables": {
                        "ids": {"type": "array", "value": ["x"], "elementTypes": ["integer"]}
                    }
                },
            )

    def test_digit_text_is_kept_as_written(self) -> None:
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite(
            {"name": "Smoke", "variables": {"port": {"type": "integer", "value": "8080"}}}
        )

        assert created["variables"]["port"]["value"] == "8080"


class TestGetSuiteVariablesService:
    """Test suite for get_suite_variables service function."""

    def test_get_suite_variables_returns_variables(self) -> None:
        """Test that get_suite_variables returns suite variables."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite(
            {"name": "Test Suite", "variables": {"env": {"type": "string", "value": "staging"}}}
        )

        variables = suite_service.get_suite_variables(suite["id"])

        assert variables is not None
        assert "env" in variables
        assert variables["env"]["value"] == "staging"

    def test_get_suite_variables_returns_none_when_not_found(self) -> None:
        """Test that get_suite_variables returns None when suite not found."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.get_suite_variables(str(uuid.uuid4()))

        assert result is None

    def test_get_suite_variables_masks_secrets(self) -> None:
        """Test that get_suite_variables masks secret variables."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite(
            {
                "name": "Test Suite",
                "variables": {"password": {"type": "string", "secret": True, "value": "secret123"}},
            }
        )

        variables = suite_service.get_suite_variables(suite["id"])

        assert variables is not None
        assert "password" in variables
        assert variables["password"]["value"] == "********"

    def test_get_suite_variables_masks_secret_value_key(self) -> None:
        """Test that get_suite_variables masks the value key on secrets."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite(
            {
                "name": "Test Suite",
                "variables": {"token": {"type": "string", "secret": True, "value": "tok123"}},
            }
        )

        variables = suite_service.get_suite_variables(suite["id"])

        assert variables is not None
        assert variables["token"]["value"] == "********"

    def test_get_suite_variables_raw_returns_unmasked_secrets(self) -> None:
        """The raw getter serves the sealed stored value, never the mask placeholder."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        clear_suite_storage()

        suite = suite_service.create_suite(
            {
                "name": "Test Suite",
                "variables": {"token": {"type": "string", "secret": True, "value": "tok123"}},
            }
        )

        variables = suite_service.get_suite_variables_raw(suite["id"])

        assert variables is not None
        assert is_secret_envelope(variables["token"]["value"])
        assert unseal_all(variables["token"]["value"]) == "tok123"

    def test_get_suite_variables_raw_returns_none_when_not_found(self) -> None:
        """The raw getter mirrors the masked getter's missing-suite contract."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        assert suite_service.get_suite_variables_raw(str(uuid.uuid4())) is None


class TestSuiteServiceEdgeCases:
    """Test edge cases in suite service."""

    def test_list_suites_handles_empty_storage(self) -> None:
        """Test that list_suites handles empty storage directory."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Should not raise and return empty list
        result = suite_service.list_suites()

        assert result["suites"] == []

    def test_get_suite_returns_none_for_nonexistent(self) -> None:
        """Test that get_suite returns None for nonexistent suite."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.get_suite("non-existent-id")

        assert result is None

    def test_update_suite_updates_description(self) -> None:
        """Test that update_suite updates description field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        result = suite_service.update_suite(suite["id"], {"description": "Updated"})

        assert result is not None
        assert result["description"] == "Updated"

    def test_delete_suite_handles_nonexistent(self) -> None:
        """Test that delete_suite returns False for nonexistent suite."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Should return False for non-existent suite
        result = suite_service.delete_suite("non-existent-id")

        assert result is False

    def test_create_suite_with_non_dict_variable_values(self) -> None:
        """Test that create_suite handles non-dict variable values."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Non-dict values should pass through unchanged
        result = suite_service.create_suite(
            {
                "name": "Test Suite",
                "variables": {"simple_var": "value"},
            }
        )

        assert result["variables"]["simple_var"] == "value"

    def test_batch_delete_cleans_relation_index(self) -> None:
        """Test that batch_delete_suites cleans the relation index."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        test_service._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

        test = test_service.create_test({"name": "Test"})
        suite = suite_service.create_suite({"name": "Suite", "tests": [test["id"]]})

        result = suite_service.batch_delete_suites([suite["id"]])

        assert len(result["deleted"]) == 1
        assert relation_service.get_suite_count_for_test(test["id"]) == 0

    def test_batch_delete_suites_handles_exceptions(self) -> None:
        """Test that batch_delete_suites handles exceptions during delete."""
        from unittest.mock import patch

        from wavecore.api.exceptions import WaveException
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Error Suite"})

        with patch(
            "wavecore.api.services.suites.service.delete_suite",
            side_effect=WaveException("Delete failed"),
        ):
            result = suite_service.batch_delete_suites([suite["id"]])

        assert len(result["deleted"]) == 0
        assert len(result["failed"]) == 1
        assert "Delete failed" in result["failed"][0]["error"]

    def test_update_suite_checks_name_conflict(self) -> None:
        """Test that update_suite checks for name conflicts."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Suite One"})
        suite_service.create_suite({"name": "Suite Two"})

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(ConflictException, match="Suite with name 'Suite Two' already exists"):
            suite_service.update_suite(suite1["id"], {"name": "Suite Two"})

    def test_update_suite_with_tests(self) -> None:
        """Test that update_suite updates tests field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        test_ids = make_test_ids(2)

        result = suite_service.update_suite(suite["id"], {"tests": test_ids})

        assert result is not None
        assert result["tests"] == test_ids

    def test_update_suite_updates_relation_index_on_tests_change(self) -> None:
        """Test that update_suite updates relation index when tests change."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        test_service._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

        t1 = test_service.create_test({"name": "T1"})
        t2 = test_service.create_test({"name": "T2"})
        suite = suite_service.create_suite({"name": "RS", "tests": [t1["id"]]})

        assert relation_service.get_suite_count_for_test(t1["id"]) == 1
        assert relation_service.get_suite_count_for_test(t2["id"]) == 0

        # Update: remove t1, add t2
        suite_service.update_suite(suite["id"], {"tests": [t2["id"]]})

        assert relation_service.get_suite_count_for_test(t1["id"]) == 0
        assert relation_service.get_suite_count_for_test(t2["id"]) == 1

    def test_update_suite_with_variables(self) -> None:
        """Test that update_suite updates variables field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        variables = {"env": {"type": "string", "value": "prod"}}

        result = suite_service.update_suite(suite["id"], {"variables": variables})

        assert result is not None
        assert "env" in result["variables"]

    def test_update_suite_with_metadata(self) -> None:
        """Test that update_suite updates metadata field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        metadata = {"author": "test-user", "priority": "high"}

        result = suite_service.update_suite(suite["id"], {"metadata": metadata})

        assert result is not None
        assert result["metadata"]["author"] == "test-user"

    def test_batch_delete_handles_not_found(self) -> None:
        """Test that batch_delete_suites handles not found suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.batch_delete_suites([str(uuid.uuid4())])

        assert len(result["deleted"]) == 0
        assert len(result["failed"]) == 1
        assert "not found" in result["failed"][0]["error"]

    def test_add_suite_version_returns_none_when_not_found(self) -> None:
        """Test that add_suite_version returns None when suite not found."""
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        result = _suite_version_svc.add_suite_version(str(uuid.uuid4()), {})

        assert result is None

    def test_get_suite_version_returns_none_when_suite_not_found(self) -> None:
        """Test that get_suite_version returns None when suite not found."""
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        result = _suite_version_svc.get_suite_version(str(uuid.uuid4()), "1.0.0")

        assert result is None

    def test_update_suite_version_returns_none_when_suite_not_found(self) -> None:
        """Test that update_suite_version returns None when suite not found."""
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        result = _suite_version_svc.update_suite_version(str(uuid.uuid4()), "1.0.0", {})

        assert result is None

    def test_update_suite_version_returns_none_when_version_not_found(self) -> None:
        """Test that update_suite_version returns None when version not found."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        result = _suite_version_svc.update_suite_version(suite["id"], "9.9.9", {})

        assert result is None

    def test_delete_suite_version_returns_false_when_suite_not_found(self) -> None:
        """Test that delete_suite_version returns False when suite not found."""
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        result = _suite_version_svc.delete_suite_version(str(uuid.uuid4()), "1.0.0")

        assert result is False

    def test_remove_test_returns_none_when_suite_not_found(self) -> None:
        """Test that remove_test_from_suite returns None when suite not found."""
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        result = _suite_version_svc.remove_test_from_suite(str(uuid.uuid4()), str(uuid.uuid4()))

        assert result is None

    def test_remove_test_returns_none_when_test_not_in_suite(self) -> None:
        """Test that remove_test_from_suite returns None when test not in suite."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        suite = suite_service.create_suite({"name": "Test Suite"})
        result = _suite_version_svc.remove_test_from_suite(suite["id"], str(uuid.uuid4()))

        assert result is None

    def test_test_exists_checks_test_service(self) -> None:
        """Test that _test_exists queries test_service.get_test."""
        from wavecore.api.services.suites import _storage as _suite_storage

        # When test exists
        with patch(
            "wavecore.api.services.tests.service.get_test",
            return_value={"id": "test-123"},
        ):
            assert _suite_storage._test_exists("test-123") is True

        # When test doesn't exist
        with patch("wavecore.api.services.tests.service.get_test", return_value=None):
            assert _suite_storage._test_exists("test-123") is False

    def test_clear_storage_removes_existing_directory(self) -> None:
        """Test that clear_suite_storage removes existing storage directory."""
        from wavecore.api.services.suites import service as suite_service

        # First create some data to ensure directory exists
        clear_suite_storage()
        suite_service.create_suite({"name": "Test Suite"})

        # Verify data exists
        assert len(suite_service.list_suites()["suites"]) == 1

        # Now clear - this should hit the rmtree branch
        clear_suite_storage()

        # Verify storage is empty
        result = suite_service.list_suites()
        assert result["suites"] == []

    def test_service_clear_storage_removes_existing_directory(self) -> None:
        """Test that _suite_storage._clear_storage removes existing storage directory."""
        from wavecore.api.services.suites import _storage as _suite_storage
        from wavecore.api.services.suites import service as suite_service

        # First create some data to ensure directory exists
        clear_suite_storage()
        suite_service.create_suite({"name": "Test Suite"})

        # Verify data exists
        assert len(suite_service.list_suites()["suites"]) == 1

        # Now call the service's _clear_storage directly to hit shutil.rmtree branch
        _suite_storage._clear_storage()

        # Verify storage is empty
        result = suite_service.list_suites()
        assert result["suites"] == []

    def test_load_versions_returns_empty_for_nonexistent_suite(self) -> None:
        """Test that _load_versions returns empty list for nonexistent suite."""
        from wavecore.api.services.suites import _storage as _suite_storage

        clear_suite_storage()

        # Calling for non-existent suite should return empty list
        result = _suite_storage._load_versions("non-existent-id")

        assert result == []


class TestListAllTags:
    """Test suite for list_all_tags function (REQ-9.5.3.2)."""

    def test_list_all_tags_returns_unique_tags_from_all_suites(self) -> None:
        """Test that list_all_tags returns unique tags from all suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Create suites with tags at top-level
        suite_service.create_suite(
            {
                "name": "Suite 1",
                "tags": ["api", "integration"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Suite 2",
                "tags": ["api", "smoke"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Suite 3",
                "tags": ["e2e", "regression"],
            }
        )

        result = suite_service.list_all_tags()

        # Should contain all unique tags
        assert "api" in result
        assert "integration" in result
        assert "smoke" in result
        assert "e2e" in result
        assert "regression" in result
        # Should be sorted alphabetically
        assert result == sorted(result)
        # Should have no duplicates (api appears in 2 suites)
        assert len(result) == len(set(result))

    def test_list_all_tags_returns_empty_list_when_no_suites_exist(self) -> None:
        """Test that list_all_tags returns empty list when no suites exist."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.list_all_tags()

        assert result == []

    def test_list_all_tags_returns_empty_list_when_suites_have_no_tags(self) -> None:
        """Test that list_all_tags returns empty list when suites have no tags."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Create suites without tags
        suite_service.create_suite({"name": "Suite 1"})
        suite_service.create_suite({"name": "Suite 2", "tags": []})

        result = suite_service.list_all_tags()

        assert result == []

    def test_list_all_tags_returns_sorted_tags(self) -> None:
        """Test that list_all_tags returns tags in alphabetical order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite(
            {
                "name": "Suite 1",
                "tags": ["zulu", "alpha", "mike"],
            }
        )

        result = suite_service.list_all_tags()

        assert result == ["alpha", "mike", "zulu"]

    def test_list_all_tags_deduplicates_across_suites(self) -> None:
        """Test that list_all_tags returns each tag only once."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Create multiple suites with overlapping tags
        suite_service.create_suite(
            {
                "name": "Suite 1",
                "tags": ["critical", "production"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Suite 2",
                "tags": ["critical", "staging"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Suite 3",
                "tags": ["critical", "development"],
            }
        )

        result = suite_service.list_all_tags()

        # "critical" should appear only once
        assert result.count("critical") == 1
        assert set(result) == {"critical", "production", "staging", "development"}


class TestListSuiteNamesService:
    """Test suite for list_suite_names service function (REQ-9.5.3.5)."""

    def test_list_suite_names_returns_all_suites(self) -> None:
        """Test that list_suite_names returns all suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Smoke Tests"})
        suite_service.create_suite({"name": "Regression Tests"})
        suite_service.create_suite({"name": "Integration Tests"})

        result = suite_service.list_suite_names()

        assert len(result) == 3

    def test_list_suite_names_returns_only_id_and_name(self) -> None:
        """Test that list_suite_names returns only id and name fields."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite(
            {
                "name": "Smoke Tests",
                "description": "Quick smoke tests for production",
                "tags": ["smoke", "critical"],
            }
        )

        result = suite_service.list_suite_names()

        assert len(result) == 1
        suite = result[0]
        # Should have only id and name
        assert set(suite.keys()) == {"id", "name"}
        assert suite["name"] == "Smoke Tests"
        # Should NOT have description, tags, tests_count, status, etc.
        assert "description" not in suite
        assert "tags" not in suite
        assert "tests_count" not in suite
        assert "status" not in suite
        assert "created_at" not in suite
        assert "updated_at" not in suite

    def test_list_suite_names_sorted_by_name(self) -> None:
        """Test that list_suite_names returns suites sorted by name."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Zebra Suite"})
        suite_service.create_suite({"name": "Alpha Suite"})
        suite_service.create_suite({"name": "Beta Suite"})

        result = suite_service.list_suite_names()

        names = [s["name"] for s in result]
        assert names == ["Alpha Suite", "Beta Suite", "Zebra Suite"]

    def test_list_suite_names_case_insensitive_sort(self) -> None:
        """Test that list_suite_names sorts case-insensitively."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "alpha"})
        suite_service.create_suite({"name": "Beta"})
        suite_service.create_suite({"name": "GAMMA"})

        result = suite_service.list_suite_names()

        names = [s["name"] for s in result]
        assert names == ["alpha", "Beta", "GAMMA"]

    def test_list_suite_names_returns_empty_when_no_suites(self) -> None:
        """Test that list_suite_names returns empty list when no suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.list_suite_names()

        assert result == []


class TestAddTestToSuiteCollision:
    """Test variable type collision detection when adding tests to suites."""

    def setup_method(self) -> None:
        """Reset storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        test_service._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_add_test_raises_conflict_on_type_collision(self) -> None:
        """Adding a test that creates a cross-suite type collision raises ConflictException."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as suite_version_svc
        from wavecore.api.services.tests import service as test_service

        shared_test = test_service.create_test({"name": "Shared"})
        tid = shared_test["id"]

        # S1 has string 'env', S2 has integer 'env', both share the same test
        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [tid],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )
        s2 = suite_service.create_suite(
            {
                "name": "S2",
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        with pytest.raises(ConflictException, match="Variable type collision"):
            suite_version_svc.add_test_to_suite(s2["id"], tid)

        # Verify rollback - the test should not be in S2
        updated_s2 = suite_service.get_suite(s2["id"])
        assert updated_s2 is not None
        assert tid not in updated_s2.get("tests", [])

    def test_add_test_succeeds_when_no_collision(self) -> None:
        """Adding a test without collision succeeds normally."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as suite_version_svc
        from wavecore.api.services.tests import service as test_service

        shared_test = test_service.create_test({"name": "Shared"})
        tid = shared_test["id"]

        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [tid],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        s2 = suite_service.create_suite(
            {
                "name": "S2",
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )

        result = suite_version_svc.add_test_to_suite(s2["id"], tid)

        assert result is not None
        assert tid in result.get("tests", [])

    def test_add_test_no_collision_when_suite_has_no_variables(self) -> None:
        """Adding a test succeeds when the suite has no variables."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as suite_version_svc
        from wavecore.api.services.tests import service as test_service

        shared_test = test_service.create_test({"name": "Shared"})
        tid = shared_test["id"]

        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [tid],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )
        s2 = suite_service.create_suite({"name": "S2"})

        result = suite_version_svc.add_test_to_suite(s2["id"], tid)

        assert result is not None
        assert tid in result.get("tests", [])


class TestUpdateSuiteCollision:
    """Test variable type collision detection via the primary update_suite() path.

    This is the code path the UI actually uses (PUT /suites/{id}) for both
    variable edits and test membership changes.
    """

    def setup_method(self) -> None:
        """Reset storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        test_service._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_update_suite_variables_raises_conflict(self) -> None:
        """Changing variable type via update_suite() with collision raises ConflictException."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        shared_test = test_service.create_test({"name": "Shared"})
        tid = shared_test["id"]

        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [tid],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        suite_service.create_suite(
            {
                "name": "S2",
                "tests": [tid],
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )

        # Change S1 env from string to integer via update_suite - should conflict with S2
        with pytest.raises(ConflictException, match="Variable type collision"):
            suite_service.update_suite(
                s1["id"],
                {
                    "variables": {"env": {"type": "integer", "value": 1}},
                },
            )

        # Verify not saved - variable should still be string
        s1_after = suite_service.get_suite(s1["id"])
        assert s1_after is not None
        assert s1_after["variables"]["env"]["type"] == "string"

    def test_update_suite_tests_raises_conflict(self) -> None:
        """Adding test via update_suite() that creates collision raises ConflictException."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        shared_test = test_service.create_test({"name": "Shared"})
        tid = shared_test["id"]

        # S1 has the test and integer env
        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [tid],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )
        # S2 has string env but no tests yet
        s2 = suite_service.create_suite(
            {
                "name": "S2",
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        # Add the shared test to S2 via update_suite - should conflict
        with pytest.raises(ConflictException, match="Variable type collision") as exc_info:
            suite_service.update_suite(s2["id"], {"tests": [tid]})

        # Verify conflicting_test_ids is included in exception details
        assert exc_info.value.details is not None
        assert tid in exc_info.value.details["conflicting_test_ids"]

        # Verify not saved - test should not be in S2
        s2_after = suite_service.get_suite(s2["id"])
        assert s2_after is not None
        assert tid not in s2_after.get("tests", [])

    def test_update_suite_variables_succeeds_when_types_match(self) -> None:
        """Variable update with matching types via update_suite() succeeds."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        shared_test = test_service.create_test({"name": "Shared"})
        tid = shared_test["id"]

        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [tid],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        suite_service.create_suite(
            {
                "name": "S2",
                "tests": [tid],
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )

        # Same type, different value - should succeed
        result = suite_service.update_suite(
            s1["id"],
            {
                "variables": {"env": {"type": "string", "value": "staging"}},
            },
        )

        assert result is not None

    def test_update_suite_tests_succeeds_when_no_collision(self) -> None:
        """Test addition without collision via update_suite() succeeds."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        shared_test = test_service.create_test({"name": "Shared"})
        tid = shared_test["id"]

        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [tid],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        s2 = suite_service.create_suite(
            {
                "name": "S2",
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )

        # Same type - should succeed
        result = suite_service.update_suite(s2["id"], {"tests": [tid]})

        assert result is not None
        assert tid in result.get("tests", [])

    def test_update_suite_tests_no_check_when_no_variables(self) -> None:
        """Test addition skips collision check when suite has no variables."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        shared_test = test_service.create_test({"name": "Shared"})
        tid = shared_test["id"]

        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [tid],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )
        s2 = suite_service.create_suite({"name": "S2"})

        # S2 has no variables - nothing to collide
        result = suite_service.update_suite(s2["id"], {"tests": [tid]})

        assert result is not None
        assert tid in result.get("tests", [])

    def test_update_suite_checks_added_tests_against_the_new_variables(self) -> None:
        """Tests and variables changed in one update are checked together."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        tid = test_service.create_test({"name": "Shared"})["id"]
        suite_service.create_suite(
            {"name": "S1", "tests": [tid], "variables": {"env": {"type": "integer", "value": 1}}}
        )
        s2 = suite_service.create_suite({"name": "S2"})

        with pytest.raises(
            ConflictException,
            match=r"^Variable type collision: variable 'env' is 'string' here but 'integer' "
            r"in suite 'S1'$",
        ) as exc_info:
            suite_service.update_suite(
                s2["id"],
                {"tests": [tid], "variables": {"env": {"type": "string", "value": "dev"}}},
            )

        assert exc_info.value.details is not None
        assert exc_info.value.details["conflicting_test_ids"] == [tid]
        stored = load_suite_file(s2["id"])
        assert stored is not None
        assert stored["tests"] == []
        assert stored["variables"] == {}

    def test_update_suite_retypes_a_variable_while_removing_the_shared_test(self) -> None:
        """A variable is checked against the Tests the Suite keeps, not the Tests it drops."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        tid = test_service.create_test({"name": "Shared"})["id"]
        integer_env = {"env": {"type": "integer", "value": 1}}
        suite_service.create_suite({"name": "S1", "tests": [tid], "variables": integer_env})
        s2 = suite_service.create_suite({"name": "S2", "tests": [tid], "variables": integer_env})

        result = suite_service.update_suite(
            s2["id"], {"tests": [], "variables": {"env": {"type": "string", "value": "dev"}}}
        )

        assert result is not None
        assert result["tests"] == []
        assert result["variables"] == {"env": {"type": "string", "value": "dev"}}

    def test_update_suite_retypes_a_variable_against_a_kept_test(self) -> None:
        """Dropping one Test still checks a retyped variable against the Tests the Suite keeps."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        kept = test_service.create_test({"name": "Kept"})["id"]
        dropped = test_service.create_test({"name": "Dropped"})["id"]
        integer_env = {"env": {"type": "integer", "value": 1}}
        suite_service.create_suite({"name": "S1", "tests": [kept], "variables": integer_env})
        s2 = suite_service.create_suite(
            {"name": "S2", "tests": [kept, dropped], "variables": integer_env}
        )

        with pytest.raises(
            ConflictException,
            match=r"^Variable type collision: variable 'env' is 'string' here but 'integer' "
            r"in suite 'S1'$",
        ) as exc_info:
            suite_service.update_suite(
                s2["id"],
                {"tests": [kept], "variables": {"env": {"type": "string", "value": "dev"}}},
            )

        assert exc_info.value.details is not None
        assert exc_info.value.details["collisions"][0]["other_suite"] == "S1"
        stored = load_suite_file(s2["id"])
        assert stored is not None
        assert stored["tests"] == [kept, dropped]
        assert stored["variables"] == integer_env


class TestCreateSuiteCollision:
    """A new Suite runs the same variable type check as an update."""

    def setup_method(self) -> None:
        """Reset storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.tests import service as test_service

        clear_suite_storage()
        test_service._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_create_suite_refuses_a_type_collision_through_a_shared_test(self) -> None:
        """A Test shared with a Suite that types the variable differently refuses the create."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        tid = test_service.create_test({"name": "Shared"})["id"]
        s1 = suite_service.create_suite(
            {"name": "S1", "tests": [tid], "variables": {"env": {"type": "integer", "value": 1}}}
        )

        with pytest.raises(
            ConflictException,
            match=r"^Variable type collision: variable 'env' is 'string' here but 'integer' "
            r"in suite 'S1'$",
        ) as exc_info:
            suite_service.create_suite(
                {
                    "name": "S2",
                    "tests": [tid],
                    "variables": {"env": {"type": "string", "value": "dev"}},
                }
            )

        assert exc_info.value.details is not None
        assert exc_info.value.details["conflicting_test_ids"] == [tid]
        assert suite_service.list_suite_names() == [{"id": s1["id"], "name": "S1"}]
        assert [entry["id"] for entry in relation_service.get_suites_for_test(tid)] == [s1["id"]]

    def test_create_suite_with_matching_types_succeeds(self) -> None:
        """The same variable type in both Suites is no collision."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        tid = test_service.create_test({"name": "Shared"})["id"]
        suite_service.create_suite(
            {"name": "S1", "tests": [tid], "variables": {"env": {"type": "string", "value": "a"}}}
        )

        result = suite_service.create_suite(
            {"name": "S2", "tests": [tid], "variables": {"env": {"type": "string", "value": "b"}}}
        )

        assert result["tests"] == [tid]


_SUITE_HISTORY: list[dict[str, Any]] = [
    {
        "version": "1.0.0",
        "created_at": "2025-01-02T03:04:05+00:00",
        "created_by": "ada",
        "changes": "Initial version",
    },
    {
        "version": "2.4.0",
        "created_at": "2025-06-07T08:09:10+00:00",
        "created_by": "grace",
        "changes": "Added the smoke Tests",
    },
]


def _suite_document(name: str, **fields: Any) -> dict[str, Any]:
    """A whole Suite document whose version and times no save would produce."""
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "version": "2.4.0",
        "description": "Nightly checks",
        "tests": [str(uuid.uuid4())],
        "tags": ["nightly"],
        "variables": {},
        "metadata": {"owner": "ada"},
        "created_at": "2025-01-02T03:04:05+00:00",
        "updated_at": "2025-06-07T08:09:10+00:00",
        **fields,
    }


@contextmanager
def _suite_writer_spy() -> Iterator[MagicMock]:
    """Watch the public writer, whichever binding the import reaches it through."""
    from wavecore.api.services.suites import import_export
    from wavecore.api.services.suites import service as suite_service

    spy = MagicMock(wraps=suite_service.persist_suite_document)
    with (
        patch.object(suite_service, "persist_suite_document", spy),
        patch.object(import_export, "persist_suite_document", spy, create=True),
    ):
        yield spy


@contextmanager
def _failing_suite_history_write() -> Iterator[None]:
    """Make the history saver fail, whichever binding the writer reaches it through."""
    from wavecore.api.services.suites import _storage as suite_storage
    from wavecore.api.services.suites import service as suite_service

    failure = OSError("disk full")
    with (
        patch.object(suite_storage, "_save_versions", side_effect=failure),
        patch.object(suite_service, "_save_versions", side_effect=failure, create=True),
    ):
        yield


class TestPersistSuiteDocument:
    """The public writer stores a Suite as it is handed over (REQ-5.2.4.9.5, REQ-5.2.4.9.6)."""

    def test_the_document_and_the_rows_are_written_as_given(self) -> None:
        """Version, times and history rows are stored unchanged."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        document = _suite_document("Kept Whole")

        suite_service.persist_suite_document(copy.deepcopy(document), copy.deepcopy(_SUITE_HISTORY))

        stored = suite_service.list_suite_documents()
        assert len(stored) == 1
        stored_document, stored_rows = stored[0]
        assert stored_document == document
        assert stored_rows == _SUITE_HISTORY

    def test_the_suites_import_writes_through_it(self) -> None:
        """The import stores its Suite through the writer, with its one history row."""
        from wavecore.api.services.suites import import_export
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        content = yaml.safe_dump(
            {"name": "Imported Suite", "tests": [], "tags": ["smoke"]}
        ).encode()

        with _suite_writer_spy() as writer:
            result = import_export.import_suites(content, "suite.yaml")

        writer.assert_called_once()
        stored = suite_service.list_suite_documents()
        assert len(stored) == 1
        document, rows = stored[0]
        assert document["id"] == result["imported"][0]["id"]
        assert rows == [
            {
                "version": "1.0.0",
                "created_at": document["created_at"],
                "created_by": "import",
                "changes": "Imported suite",
            }
        ]

    def test_a_failed_write_of_a_new_suite_removes_its_folder_and_raises_again(self) -> None:
        """A new Suite whose write fails leaves no folder; one that was here stays."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        was_here = suite_service.create_suite({"name": "Was Here"})
        new = _suite_document("Half Written")
        again = _suite_document("Was Here", id=was_here["id"])

        with _failing_suite_history_write():
            with pytest.raises(OSError, match=r"^disk full$"):
                suite_service.persist_suite_document(
                    copy.deepcopy(new), copy.deepcopy(_SUITE_HISTORY)
                )
            with pytest.raises(OSError, match=r"^disk full$"):
                suite_service.persist_suite_document(again, copy.deepcopy(_SUITE_HISTORY))

        assert not get_suite_dir(new["id"]).exists()
        assert get_suite_dir(was_here["id"]).is_dir()
        assert [document["id"] for document, _rows in suite_service.list_suite_documents()] == [
            was_here["id"]
        ]


class TestListSuiteDocuments:
    """The public reader hands back every stored Suite with its history (REQ-5.2.4.9.5)."""

    def test_every_stored_suite_comes_back_with_its_history_rows(self) -> None:
        """One pair per Suite: the document in stored form, then its history rows."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()
        first = suite_service.create_suite(
            {
                "name": "First",
                "tags": ["nightly"],
                "variables": {"token": {"type": "string", "secret": True, "value": "s3cret"}},
            }
        )
        second = suite_service.create_suite({"name": "Second"})
        suite_service.update_suite(second["id"], {"description": "Changed"})

        pairs = suite_service.list_suite_documents()

        assert len(pairs) == 2
        by_id = {document["id"]: (document, rows) for document, rows in pairs}
        assert by_id == {
            suite_id: (load_suite_file(suite_id), load_versions_file(suite_id))
            for suite_id in (first["id"], second["id"])
        }
        assert [row["version"] for row in by_id[second["id"]][1]] == ["1.0.0", "1.1.0"]
