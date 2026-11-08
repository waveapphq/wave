"""Unit tests for test_service layer (REQ-5.2.4.3).

This module tests the test service layer which provides business logic
for test workflow management operations including CRUD, versioning,
workflow management, variable configuration, and validation.
"""

import copy
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml

from wavecore.api.exceptions import ConflictException, ValidationException, WaveException
from wavecore.api.services.shared import mask_secret_variables
from wavecore.api.services.storage_paths import get_test_testdata_path, get_tests_storage_path
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_service
from wavecore.core.secrets.sealing import unseal_all


def _create_test_with_legacy_data(data: dict[str, Any]) -> dict[str, Any]:
    """Create a test bypassing the save pipeline variable validation.

    Used to simulate legacy data that may have undeclared variables.
    """
    test_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    test = {
        "id": test_id,
        "name": data.get("name", ""),
        "version": "1.0.0",
        "description": data.get("description", ""),
        "workflow": data.get("workflow", {"nodes": [], "edges": []}),
        "variables": data.get("variables", {}),
        "metadata": data.get("metadata", {}),
        "created_at": now,
        "updated_at": now,
    }
    test_service._save_test(test)
    test_service._save_versions(
        test_id,
        [
            {
                "version": "1.0.0",
                "created_at": now,
                "created_by": "system",
                "changes": "Initial version",
            }
        ],
    )
    return test


class TestMaskSecretVariables:
    """The masker a Test read uses: the shared one, with the response-only masked flag."""

    def test_masks_secret_variable_values(self) -> None:
        """Test that secret variables are masked."""
        variables: dict[str, Any] = {
            "username": {"type": "string", "value": "admin"},
            "password": {"type": "string", "secret": True, "value": "secret123"},
        }

        result = mask_secret_variables(variables, flag_masked=True)

        assert result["username"]["value"] == "admin"
        assert result["password"]["value"] == "********"
        assert result["password"]["masked"] is True

    def test_valueless_secret_stays_valueless(self) -> None:
        """Masking hides values; it must not fabricate one for declare-empty."""
        variables: dict[str, Any] = {"token": {"type": "string", "secret": True}}
        result = mask_secret_variables(variables, flag_masked=True)
        assert result["token"] == {"type": "string", "secret": True}
        assert "value" not in result["token"]

    def test_leaves_non_secret_variables_unchanged(self) -> None:
        """Test that non-secret variables are not modified."""
        variables: dict[str, Any] = {
            "host": {"type": "string", "value": "localhost"},
            "port": {"type": "integer", "value": 8080},
        }

        result = mask_secret_variables(variables, flag_masked=True)

        assert result["host"]["value"] == "localhost"
        assert result["port"]["value"] == 8080

    def test_handles_non_dict_values(self) -> None:
        """Test that non-dict variable values are passed through."""
        variables: dict[str, Any] = {
            "simple_var": "simple_value",
        }

        result = mask_secret_variables(variables, flag_masked=True)

        assert result["simple_var"] == "simple_value"


class TestSecretRoundTripPreservation:
    """A round-tripped masked secret keeps its stored value; the placeholder is never data."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites._storage import _clear_storage as _clear_suite_storage

        test_service._clear_storage()
        _clear_suite_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    @staticmethod
    def _create_with_secret(value: str = "real-secret") -> str:
        created = test_service.create_test(
            {
                "name": "Secret Round Trip",
                "variables": {"ssh_pwd": {"type": "string", "secret": True, "value": value}},
            }
        )
        return created["id"]

    def test_update_test_preserves_a_round_tripped_masked_secret(self) -> None:
        test_id = self._create_with_secret()
        fetched = test_service.get_test(test_id)
        assert fetched is not None
        assert fetched["variables"]["ssh_pwd"]["value"] == "********"

        test_service.update_test(test_id, {"variables": fetched["variables"]})

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert unseal_all(raw["variables"]["ssh_pwd"]["value"]) == "real-secret"

    def test_update_test_accepts_a_reentered_secret_value(self) -> None:
        test_id = self._create_with_secret()

        test_service.update_test(
            test_id,
            {"variables": {"ssh_pwd": {"type": "string", "secret": True, "value": "new-secret"}}},
        )

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert unseal_all(raw["variables"]["ssh_pwd"]["value"]) == "new-secret"

    def test_update_test_never_persists_the_masked_flag(self) -> None:
        test_id = self._create_with_secret()
        fetched = test_service.get_test(test_id)
        assert fetched is not None

        test_service.update_test(test_id, {"variables": fetched["variables"]})

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert "masked" not in raw["variables"]["ssh_pwd"]

    def test_update_test_preserves_when_the_secret_flag_is_dropped(self) -> None:
        test_id = self._create_with_secret()

        test_service.update_test(
            test_id,
            {"variables": {"ssh_pwd": {"type": "string", "value": "********"}}},
        )

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert unseal_all(raw["variables"]["ssh_pwd"]["value"]) == "real-secret"

    def test_update_test_keeps_a_literal_placeholder_for_non_secret_variables(self) -> None:
        created = test_service.create_test(
            {
                "name": "Literal Asterisks",
                "variables": {"banner": {"type": "string", "value": "old"}},
            }
        )

        test_service.update_test(
            created["id"],
            {"variables": {"banner": {"type": "string", "value": "********"}}},
        )

        raw = test_service._get_raw_test(created["id"])
        assert raw is not None
        assert raw["variables"]["banner"]["value"] == "********"

    def test_update_test_keeps_the_placeholder_for_a_new_secret_variable(self) -> None:
        test_id = self._create_with_secret()

        test_service.update_test(
            test_id,
            {
                "variables": {
                    "ssh_pwd": {"type": "string", "secret": True, "value": "real-secret"},
                    "brand_new": {"type": "string", "secret": True, "value": "********"},
                }
            },
        )

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert unseal_all(raw["variables"]["brand_new"]["value"]) == "********"

    def test_update_test_passes_non_dict_variables_through(self) -> None:
        test_id = self._create_with_secret()

        test_service.update_test(
            test_id,
            {
                "variables": {
                    "ssh_pwd": {"type": "string", "secret": True, "value": "********"},
                    "plain": "raw-value",
                }
            },
        )

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert raw["variables"]["plain"] == "raw-value"
        assert unseal_all(raw["variables"]["ssh_pwd"]["value"]) == "real-secret"

    def test_create_test_strips_the_masked_flag(self) -> None:
        created = test_service.create_test(
            {
                "name": "Create Masked Flag",
                "variables": {
                    "api_key": {"type": "string", "secret": True, "value": "k", "masked": True}
                },
            }
        )

        raw = test_service._get_raw_test(created["id"])
        assert raw is not None
        assert "masked" not in raw["variables"]["api_key"]

    def test_update_test_variables_replace_preserves_a_masked_secret(self) -> None:
        test_id = self._create_with_secret()

        test_service.update_test_variables(
            test_id,
            {"ssh_pwd": {"type": "string", "secret": True, "value": "********", "masked": True}},
            merge=False,
        )

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert unseal_all(raw["variables"]["ssh_pwd"]["value"]) == "real-secret"

    def test_update_test_variables_merge_preserves_a_masked_secret(self) -> None:
        test_id = self._create_with_secret()

        test_service.update_test_variables(
            test_id,
            {
                "ssh_pwd": {"type": "string", "secret": True, "value": "********"},
                "extra": {"type": "string", "value": "plain"},
            },
            merge=True,
        )

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert unseal_all(raw["variables"]["ssh_pwd"]["value"]) == "real-secret"
        assert raw["variables"]["extra"]["value"] == "plain"

    def test_update_test_variables_strips_the_masked_flag(self) -> None:
        test_id = self._create_with_secret()

        test_service.update_test_variables(
            test_id,
            {"ssh_pwd": {"type": "string", "secret": True, "value": "********", "masked": True}},
            merge=False,
        )

        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        assert "masked" not in raw["variables"]["ssh_pwd"]


class TestListTests:
    """Test suite for list_tests service function."""

    def setup_method(self) -> None:
        """Reset test and suite storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import _storage as _suite_storage

        test_service._clear_storage()
        _suite_storage._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_list_tests_returns_empty_when_no_tests(self) -> None:
        """Test that list_tests returns empty list when no tests exist."""
        result = test_service.list_tests()

        assert result["tests"] == []
        assert result["total"] == 0
        assert result["page"] == 1
        assert result["per_page"] == 20
        assert result["total_pages"] == 0

    def test_list_tests_returns_tests_with_pagination(self) -> None:
        """Test that list_tests returns paginated results."""
        for i in range(25):
            test_service.create_test(
                {
                    "name": f"Test {i}",
                    "description": f"Description {i}",
                    "workflow": {"nodes": [], "edges": []},
                    "metadata": {"tags": ["test"]},
                }
            )

        result = test_service.list_tests(page=1, per_page=10)

        assert len(result["tests"]) == 10
        assert result["total"] == 25
        assert result["page"] == 1
        assert result["per_page"] == 10
        assert result["total_pages"] == 3

    def test_list_tests_with_search_filter(self) -> None:
        """Test that list_tests filters by search text."""
        test_service.create_test(
            {
                "name": "Login Test",
                "description": "Tests user login",
            }
        )
        test_service.create_test(
            {
                "name": "API Test",
                "description": "Tests API endpoints",
            }
        )

        result = test_service.list_tests(search="login")

        assert len(result["tests"]) == 1
        assert result["tests"][0]["name"] == "Login Test"

    def test_list_tests_with_suite_ids_filter(self) -> None:
        """Test that list_tests filters by suite_ids using suite.tests arrays."""
        from wavecore.api.services.suites import service as suite_service

        # Create tests first
        t1 = test_service.create_test({"name": "Test 1"})
        t2 = test_service.create_test({"name": "Test 2"})
        test_service.create_test({"name": "Test 3"})

        # Create suites referencing tests via their tests arrays
        suite_a = suite_service.create_suite({"name": "Suite A", "tests": [t1["id"]]})
        suite_service.create_suite({"name": "Suite B", "tests": [t2["id"]]})

        # Filter by suite_a - should only return Test 1
        result = test_service.list_tests(suite_ids=[suite_a["id"]])

        assert len(result["tests"]) == 1
        assert result["tests"][0]["name"] == "Test 1"

    def test_list_tests_with_tags_filter(self) -> None:
        """Test that list_tests filters by tags (OR semantics: match any)."""
        test_service.create_test(
            {
                "name": "Test 1",
                "metadata": {"tags": ["smoke", "integration"]},
            }
        )
        test_service.create_test(
            {
                "name": "Test 2",
                "metadata": {"tags": ["regression"]},
            }
        )
        test_service.create_test(
            {
                "name": "Test 3",
                "metadata": {"tags": ["unit"]},
            }
        )

        # OR semantics: selecting smoke OR regression matches Test 1 and Test 2
        result = test_service.list_tests(tags=["smoke", "regression"])

        assert len(result["tests"]) == 2
        names = {t["name"] for t in result["tests"]}
        assert names == {"Test 1", "Test 2"}

    def test_list_tests_with_status_filter(self) -> None:
        """Test that list_tests filters by status."""
        test_service.create_test(
            {
                "name": "Passed Test",
                "metadata": {"status": "passed"},
            }
        )
        test_service.create_test(
            {
                "name": "Failed Test",
                "metadata": {"status": "failed"},
            }
        )
        test_service.create_test(
            {
                "name": "Never Run Test",
                # No status - should match never_run
            }
        )

        # Test single status filter
        result = test_service.list_tests(status=["passed"])
        assert len(result["tests"]) == 1
        assert result["tests"][0]["name"] == "Passed Test"

        # Test multiple status filter
        result = test_service.list_tests(status=["passed", "failed"])
        assert len(result["tests"]) == 2

        # Test never_run status filter
        result = test_service.list_tests(status=["never_run"])
        assert len(result["tests"]) == 1
        assert result["tests"][0]["name"] == "Never Run Test"

    def test_list_tests_with_sorting(self) -> None:
        """Test that list_tests sorts by various fields."""
        test_service.create_test(
            {
                "name": "Z Test",
                "metadata": {
                    "status": "passed",
                    "last_run": "2025-01-15",
                },
            }
        )
        test_service.create_test(
            {
                "name": "A Test",
                "metadata": {
                    "status": "failed",
                    "last_run": "2025-01-10",
                },
            }
        )

        # Sort by name ascending
        result = test_service.list_tests(sort_by="name", sort_order="asc")
        assert result["tests"][0]["name"] == "A Test"
        assert result["tests"][1]["name"] == "Z Test"

        # Sort by name descending
        result = test_service.list_tests(sort_by="name", sort_order="desc")
        assert result["tests"][0]["name"] == "Z Test"

        # Sort by status (passed=0, failed=1, never_run=2)
        result = test_service.list_tests(sort_by="status", sort_order="asc")
        assert result["tests"][0]["metadata"]["status"] == "passed"
        assert result["tests"][1]["metadata"]["status"] == "failed"

        # Sort by lastRun
        result = test_service.list_tests(sort_by="lastRun", sort_order="asc")
        assert result["tests"][0]["metadata"]["last_run"] == "2025-01-10"

        # Sort by unknown field (falls through to default return "")
        result = test_service.list_tests(sort_by="unknown_field", sort_order="asc")
        # Should still return all tests (no error), just with default sorting
        assert len(result["tests"]) == 2

    def test_list_tests_includes_suite_membership(self) -> None:
        """Test that list_tests includes suite_count and suite_names."""
        from wavecore.api.services.suites import service as suite_service

        t1 = test_service.create_test({"name": "Shared Test"})
        t2 = test_service.create_test({"name": "Solo Test"})
        _t3 = test_service.create_test({"name": "No Suite Test"})

        suite_service.create_suite({"name": "Auth Suite", "tests": [t1["id"], t2["id"]]})
        suite_service.create_suite({"name": "API Suite", "tests": [t1["id"]]})

        result = test_service.list_tests(sort_by="name", sort_order="asc")
        tests = {t["name"]: t for t in result["tests"]}

        # t1 in 2 suites
        assert tests["Shared Test"]["suite_count"] == 2
        assert set(tests["Shared Test"]["suite_names"]) == {"Auth Suite", "API Suite"}

        # t2 in 1 suite
        assert tests["Solo Test"]["suite_count"] == 1
        assert tests["Solo Test"]["suite_names"] == ["Auth Suite"]

        # t3 in no suites
        assert tests["No Suite Test"]["suite_count"] == 0
        assert tests["No Suite Test"]["suite_names"] == []

    def test_list_tests_sort_by_suite(self) -> None:
        """Test that list_tests sorts by suite_count."""
        from wavecore.api.services.suites import service as suite_service

        _t1 = test_service.create_test({"name": "No Suites"})
        t2 = test_service.create_test({"name": "One Suite"})
        t3 = test_service.create_test({"name": "Two Suites"})

        suite_service.create_suite({"name": "Suite A", "tests": [t2["id"], t3["id"]]})
        suite_service.create_suite({"name": "Suite B", "tests": [t3["id"]]})

        result = test_service.list_tests(sort_by="suite", sort_order="asc")
        counts = [t["suite_count"] for t in result["tests"]]
        assert counts == [0, 1, 2]

        result = test_service.list_tests(sort_by="suite", sort_order="desc")
        counts = [t["suite_count"] for t in result["tests"]]
        assert counts == [2, 1, 0]


class TestListTestsDerivesStatusFromExecutions:
    """list_tests overlays each test's metadata with the latest execution's
    status and last-run timestamp so the Tests List reflects live state."""

    def _make_test_and_executions(
        self,
        *,
        test_name: str,
        executions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Create a test in storage and seed the execution cache with the
        given records (entity_id is auto-populated from the test's id)."""
        from wavecore.api.services.executions._storage import (
            _ensure_cache_loaded,
            _execution_storage,
        )

        created = test_service.create_test({"name": test_name})
        # A first load later would clear the seeds, so load the cache before seeding.
        _ensure_cache_loaded()
        for execution in executions:
            execution["entity_type"] = "test"
            execution["entity_id"] = created["id"]
            _execution_storage[execution["id"]] = execution
        return created

    def test_no_executions_keeps_never_run(self) -> None:
        test_service.create_test({"name": "Fresh Test"})

        result = test_service.list_tests()
        row = next(t for t in result["tests"] if t["name"] == "Fresh Test")
        assert row["metadata"].get("status") in (None, "never_run")
        assert row["metadata"].get("last_run") in (None, "")

    def test_single_passed_execution_sets_status_and_last_run(self) -> None:
        self._make_test_and_executions(
            test_name="Single Run",
            executions=[
                {
                    "id": "e-1",
                    "status": "passed",
                    "started_at": "2026-04-01T00:00:00+00:00",
                    "ended_at": "2026-04-01T00:05:00+00:00",
                }
            ],
        )

        row = next(t for t in test_service.list_tests()["tests"] if t["name"] == "Single Run")
        assert row["metadata"]["status"] == "passed"
        assert row["metadata"]["last_run"] == "2026-04-01T00:05:00+00:00"

    def test_latest_of_many_wins(self) -> None:
        self._make_test_and_executions(
            test_name="Multi",
            executions=[
                {
                    "id": "e-old",
                    "status": "failed",
                    "started_at": "2026-04-01T00:00:00+00:00",
                    "ended_at": "2026-04-01T00:01:00+00:00",
                },
                {
                    "id": "e-new",
                    "status": "passed",
                    "started_at": "2026-04-02T00:00:00+00:00",
                    "ended_at": "2026-04-02T00:01:00+00:00",
                },
            ],
        )

        row = next(t for t in test_service.list_tests()["tests"] if t["name"] == "Multi")
        assert row["metadata"]["status"] == "passed"
        assert row["metadata"]["last_run"] == "2026-04-02T00:01:00+00:00"

    def test_running_status_uses_started_at_for_last_run(self) -> None:
        self._make_test_and_executions(
            test_name="Live",
            executions=[
                {
                    "id": "e-running",
                    "status": "running",
                    "started_at": "2026-04-03T00:00:00+00:00",
                }
            ],
        )

        row = next(t for t in test_service.list_tests()["tests"] if t["name"] == "Live")
        assert row["metadata"]["status"] == "running"
        assert row["metadata"]["last_run"] == "2026-04-03T00:00:00+00:00"

    def test_stopped_status_uses_ended_at(self) -> None:
        self._make_test_and_executions(
            test_name="Halted",
            executions=[
                {
                    "id": "e-stop",
                    "status": "stopped",
                    "started_at": "2026-04-04T00:00:00+00:00",
                    "ended_at": "2026-04-04T00:00:45+00:00",
                }
            ],
        )

        row = next(t for t in test_service.list_tests()["tests"] if t["name"] == "Halted")
        assert row["metadata"]["status"] == "stopped"
        assert row["metadata"]["last_run"] == "2026-04-04T00:00:45+00:00"

    def test_status_filter_sees_derived_running(self) -> None:
        self._make_test_and_executions(
            test_name="Live",
            executions=[
                {
                    "id": "e-r",
                    "status": "running",
                    "started_at": "2026-04-05T00:00:00+00:00",
                }
            ],
        )
        test_service.create_test({"name": "Idle"})

        result = test_service.list_tests(status=["running"])
        names = {t["name"] for t in result["tests"]}
        assert names == {"Live"}

    def test_ignores_executions_for_other_entity_types(self) -> None:
        from wavecore.api.services.executions._storage import _execution_storage

        created = test_service.create_test({"name": "Untouched"})
        # An execution targeting a suite with the same id string must not leak.
        _execution_storage["e-suite"] = {
            "id": "e-suite",
            "entity_type": "suite",
            "entity_id": created["id"],
            "status": "passed",
            "started_at": "2026-04-06T00:00:00+00:00",
            "ended_at": "2026-04-06T00:00:01+00:00",
        }

        row = next(t for t in test_service.list_tests()["tests"] if t["name"] == "Untouched")
        assert row["metadata"].get("status") in (None, "never_run")

    def test_ignores_executions_with_missing_entity_id(self) -> None:
        """Malformed execution records without entity_id must be skipped, not
        crashed on, during derivation."""
        from wavecore.api.services.executions._storage import _execution_storage

        test_service.create_test({"name": "Clean"})
        _execution_storage["e-orphan"] = {
            "id": "e-orphan",
            "entity_type": "test",
            "entity_id": "",
            "status": "passed",
            "started_at": "2026-04-07T00:00:00+00:00",
        }

        result = test_service.list_tests()
        # Must not raise; Clean stays at never_run.
        row = next(t for t in result["tests"] if t["name"] == "Clean")
        assert row["metadata"].get("status") in (None, "never_run")

    def test_skips_tests_without_id_during_derivation(self) -> None:
        """The patching helper short-circuits when a test dict is missing id."""
        from wavecore.api.services.tests.service import _patch_metadata_from_latest_execution

        stub: dict[str, Any] = {}  # no "id"
        _patch_metadata_from_latest_execution(stub, {})
        assert stub == {}  # untouched


class TestCreateTest:
    """Test suite for create_test service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_create_test_with_minimal_data(self) -> None:
        """Test creating a test with minimal data."""
        result = test_service.create_test({"name": "My Test"})

        assert result["name"] == "My Test"
        assert result["version"] == "1.0.0"
        assert "id" in result
        assert result["workflow"] == {"nodes": [], "edges": []}
        assert result["variables"] == {}

    def test_create_test_with_full_data(self) -> None:
        """Test creating a test with all fields."""
        data = {
            "name": "Login Test",
            "description": "Tests login flow",
            "workflow": {"nodes": [{"id": "1", "type": "start"}], "edges": []},
            "variables": {"user": {"type": "string", "value": "admin"}},
            "metadata": {"author": "test"},
        }

        result = _create_test_with_legacy_data(data)

        assert result["name"] == "Login Test"
        assert result["description"] == "Tests login flow"
        assert len(result["workflow"]["nodes"]) == 1
        assert result["metadata"]["author"] == "test"

    def test_create_test_raises_on_duplicate_name(self) -> None:
        """Test that creating a test with duplicate name raises error."""
        test_service.create_test({"name": "Duplicate Test"})

        with pytest.raises(ConflictException, match="already exists"):
            test_service.create_test({"name": "Duplicate Test"})

    def test_create_test_masks_secret_variables(self) -> None:
        """Test that secret variables are masked in response."""
        data = {
            "name": "Secret Test",
            "variables": {"api_key": {"type": "string", "secret": True, "value": "key123"}},
        }

        result = test_service.create_test(data)

        assert result["variables"]["api_key"]["masked"] is True
        assert result["variables"]["api_key"]["value"] == "********"

    def test_create_test_adds_version_history(self) -> None:
        """Test that version history is created."""
        result = test_service.create_test({"name": "History Test"})

        versions = [v["version"] for v in test_service._load_versions(result["id"])]
        assert len(versions) == 1
        assert "1.0.0" in versions

    def test_create_test_stores_top_level_tags_in_metadata(self) -> None:
        """Test that top-level tags are stored in metadata.tags."""
        data = {"name": "Tags Test", "tags": ["api", "unit-test", "critical"]}

        result = test_service.create_test(data)

        assert result["metadata"]["tags"] == ["api", "unit-test", "critical"]

    def test_create_test_silently_ignores_suite_id(self) -> None:
        """Test that passing suite_id in create data does not store it in metadata."""
        data = {"name": "Suite Test", "suite_id": "suite-abc-123"}

        result = test_service.create_test(data)

        assert "suite_id" not in result["metadata"]
        assert "parent_suite" not in result["metadata"]


class TestGetTest:
    """Test suite for get_test service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites._storage import _clear_storage as _clear_suite_storage

        test_service._clear_storage()
        _clear_suite_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_get_test_returns_test_by_id(self) -> None:
        """Test getting a test by ID."""
        created = test_service.create_test({"name": "Get Test"})

        result = test_service.get_test(created["id"])

        assert result is not None
        assert result["name"] == "Get Test"

    def test_get_test_returns_none_when_not_found(self) -> None:
        """Test that get_test returns None when test not found."""
        result = test_service.get_test("nonexistent-id")

        assert result is None

    def test_get_test_masks_secret_variables(self) -> None:
        """Test that secret variables are masked in response."""
        created = test_service.create_test(
            {
                "name": "Secret Test",
                "variables": {"password": {"type": "string", "secret": True, "value": "secret"}},
            }
        )
        # The raw test stores the actual secret value
        raw = test_service._get_raw_test(created["id"])
        assert raw is not None
        raw["variables"]["password"]["value"] = "secret"
        test_service._update_raw_test(created["id"], {"variables": raw["variables"]})

        result = test_service.get_test(created["id"])

        assert result is not None
        assert result["variables"]["password"]["masked"] is True
        assert result["variables"]["password"]["value"] == "********"

    def test_get_test_returns_suite_ids_and_suite_names(self) -> None:
        """Test that get_test includes suite_ids and suite_names."""
        from wavecore.api.services.suites import service as suite_service

        created = test_service.create_test({"name": "Suite Member Test"})
        test_id = created["id"]

        suite = suite_service.create_suite({"name": "MySuite", "tests": [test_id]})

        result = test_service.get_test(test_id)

        assert result is not None
        assert result["suite_ids"] == [suite["id"]]
        assert result["suite_names"] == ["MySuite"]

    def test_get_test_returns_empty_suite_membership_when_orphan(self) -> None:
        """Test that get_test returns empty lists when test is not in any suite."""
        created = test_service.create_test({"name": "Orphan Test"})

        result = test_service.get_test(created["id"])

        assert result is not None
        assert result["suite_ids"] == []
        assert result["suite_names"] == []

    def test_get_test_returns_multiple_suite_memberships(self) -> None:
        """Test that get_test lists all suites the test belongs to."""
        from wavecore.api.services.suites import service as suite_service

        created = test_service.create_test({"name": "Multi Suite Test"})
        test_id = created["id"]

        suite_a = suite_service.create_suite({"name": "SuiteA", "tests": [test_id]})
        suite_b = suite_service.create_suite({"name": "SuiteB", "tests": [test_id]})

        result = test_service.get_test(test_id)

        assert result is not None
        assert set(result["suite_ids"]) == {suite_a["id"], suite_b["id"]}
        assert set(result["suite_names"]) == {"SuiteA", "SuiteB"}

    def test_get_test_returns_merged_suite_variables(self) -> None:
        """Test that get_test includes merged suite variable metadata."""
        from wavecore.api.services.suites import service as suite_service

        created = test_service.create_test({"name": "Suite Vars Test"})
        test_id = created["id"]

        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [test_id],
                "variables": {
                    "env": {"type": "string", "value": "dev"},
                    "timeout": {"type": "integer", "value": 30},
                },
            }
        )
        suite_service.create_suite(
            {
                "name": "S2",
                "tests": [test_id],
                "variables": {
                    "env": {"type": "string", "value": "prod"},
                    "region": {"type": "string", "value": "us-east"},
                },
            }
        )

        result = test_service.get_test(test_id)

        assert result is not None
        suite_vars = result["suite_variables"]
        var_map = {v["name"]: v["type"] for v in suite_vars}
        assert var_map == {"env": "string", "timeout": "integer", "region": "string"}

    def test_get_test_returns_empty_suite_variables_when_orphan(self) -> None:
        """Test that suite_variables is empty when test is not in any suite."""
        created = test_service.create_test({"name": "Orphan"})

        result = test_service.get_test(created["id"])

        assert result is not None
        assert result["suite_variables"] == []


class TestUpdateTest:
    """Test suite for update_test service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_update_test_updates_fields(self) -> None:
        """Test updating test fields."""
        created = test_service.create_test({"name": "Update Test"})

        result = test_service.update_test(
            created["id"], {"name": "Updated Test", "description": "Updated"}
        )

        assert result is not None
        assert result["name"] == "Updated Test"
        assert result["description"] == "Updated"

    def test_update_test_raises_save_validation_error_for_undeclared_ref(self) -> None:
        """Saving with a node referencing an undeclared variable must raise.

        Implicit save-time autofix is disabled: silently re-creating a variable
        the user just deleted overrides their explicit intent. The FE handles
        the SaveValidationError by showing the Fix-or-Cancel dialog; only the
        Fix button (which routes through `fix_test`) recreates the variable.
        """
        from wavecore.api.services.tests.service import SaveValidationError

        log_node_with_ref = {
            "id": "node-log-1",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "label": "Log",
                "expressionFields": ["message"],
                "config": {"values": {"message": "test1", "level": "INFO"}},
            },
        }
        created = test_service.create_test(
            {
                "name": "Delete Then Save",
                "workflow": {"nodes": [log_node_with_ref], "edges": []},
                "variables": {"test1": {"type": "string", "value": ""}},
            }
        )

        # User deletes test1 in the UI; FE sends variables: {} on PUT.
        with pytest.raises(SaveValidationError) as exc_info:
            test_service.update_test(
                created["id"],
                {
                    "workflow": {"nodes": [log_node_with_ref], "edges": []},
                    "variables": {},
                },
            )

        codes = [e["code"] for e in exc_info.value.errors]
        assert "UNDECLARED_VARIABLE" in codes

        # And the on-disk variables dict is untouched - save did not write
        # the empty variables map, nor did it silently restore test1.
        reloaded = test_service.get_test(created["id"])
        assert reloaded is not None
        assert "test1" in reloaded["variables"]

    def test_update_test_updates_all_fields(self) -> None:
        """Test updating all optional fields including workflow, variables, metadata."""
        created = test_service.create_test({"name": "Full Update Test"})

        valid_node = {
            "id": "new",
            "type": "workflowNode",
            "position": {"x": 100, "y": 200},
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "label": "Log",
                "config": {"values": {"message": "hi"}},
            },
        }
        result = test_service.update_test(
            created["id"],
            {
                "workflow": {"nodes": [valid_node], "edges": []},
                "variables": {"new_var": {"type": "string", "value": "value"}},
                "metadata": {"updated": True},
            },
        )

        assert result is not None
        assert len(result["workflow"]["nodes"]) == 1
        assert "new_var" in result["variables"]
        assert result["metadata"]["updated"] is True

    def test_update_test_stores_top_level_tags_in_metadata(self) -> None:
        """Test that top-level tags parameter is stored in metadata.tags."""
        created = test_service.create_test({"name": "Tags Update Test"})

        result = test_service.update_test(
            created["id"],
            {"tags": ["api", "regression", "critical"]},
        )

        assert result is not None
        assert result["metadata"]["tags"] == ["api", "regression", "critical"]

    def test_update_test_increments_version(self) -> None:
        """Test that update increments version."""
        created = test_service.create_test({"name": "Version Test"})

        result = test_service.update_test(created["id"], {"description": "Updated"})

        assert result is not None
        assert result["version"] == "1.1.0"

    def test_update_test_returns_none_when_not_found(self) -> None:
        """Test that update returns None when test not found."""
        result = test_service.update_test("nonexistent-id", {"name": "New"})

        assert result is None

    def test_update_test_handles_malformed_version(self) -> None:
        """Test that update handles tests with malformed version strings."""
        from tests.api.test_helpers import save_test_file

        # Create a test with malformed version directly
        test_id = str(uuid.uuid4())
        save_test_file(
            {
                "id": test_id,
                "name": "Malformed Version Test",
                "version": "invalid",  # Not semver format
                "workflow": {"nodes": [], "edges": []},
            }
        )

        # Update should handle malformed version gracefully
        result = test_service.update_test(test_id, {"description": "Updated"})

        assert result is not None
        # Should default to 1.1.0 when version can't be parsed
        assert result["version"] == "1.1.0"

    def test_update_test_handles_short_version(self) -> None:
        """Test that update handles tests with short (< 3 parts) version strings."""
        from tests.api.test_helpers import save_test_file

        # Create a test with short version directly
        test_id = str(uuid.uuid4())
        save_test_file(
            {
                "id": test_id,
                "name": "Short Version Test",
                "version": "1.0",  # Only 2 parts
                "workflow": {"nodes": [], "edges": []},
            }
        )

        # Update should handle short version gracefully
        result = test_service.update_test(test_id, {"description": "Updated"})

        assert result is not None
        # Should default to 1.1.0 when version is too short
        assert result["version"] == "1.1.0"

    def test_update_test_validates_etag(self) -> None:
        """Test that update validates ETag when provided."""
        created = test_service.create_test({"name": "ETag Test"})

        with pytest.raises(ConflictException, match="Precondition failed"):
            test_service.update_test(created["id"], {"name": "Updated"}, etag='"wrong-etag"')

    def test_update_test_refuses_a_name_another_test_holds(self) -> None:
        """Renaming onto another Test's name is refused and nothing is saved."""
        test_service.create_test({"name": "Taken Name"})
        created = test_service.create_test({"name": "Own Name"})

        with pytest.raises(
            ConflictException, match=r"^Test with name 'Taken Name' already exists$"
        ):
            test_service.update_test(created["id"], {"name": "Taken Name", "description": "New"})

        stored = test_service._load_test(created["id"])
        assert stored is not None
        assert (stored["name"], stored["description"], stored["version"]) == (
            "Own Name",
            "",
            "1.0.0",
        )
        assert [v["version"] for v in test_service._load_versions(created["id"])] == ["1.0.0"]

    def test_update_test_keeps_a_name_it_already_shares(self) -> None:
        """A save that keeps the current name passes even when another Test shares it."""
        test_service.create_test({"name": "Shared Name"})
        twin = test_service.create_test({"name": "Twin Name"})
        stored_twin = test_service._load_test(twin["id"])
        assert stored_twin is not None
        test_service._save_test({**stored_twin, "name": "Shared Name"})

        result = test_service.update_test(
            twin["id"], {"name": "Shared Name", "description": "Kept"}
        )

        assert result is not None
        assert (result["name"], result["description"]) == ("Shared Name", "Kept")

    def test_update_test_adds_version_history(self) -> None:
        """Test that update adds to version history."""
        created = test_service.create_test({"name": "History Test"})
        test_service.update_test(created["id"], {"description": "Updated"})

        versions = [v["version"] for v in test_service._load_versions(created["id"])]
        assert len(versions) == 2
        assert "1.1.0" in versions


class TestUpdateTestMetadata:
    """Test suite for update_test_metadata service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_update_metadata_changes_name_and_description(self) -> None:
        """Test that update_test_metadata updates name and description."""
        created = test_service.create_test({"name": "Original Name"})

        result = test_service.update_test_metadata(
            created["id"], {"name": "New Name", "description": "New description"}
        )

        assert result is not None
        assert result["name"] == "New Name"
        assert result["description"] == "New description"

    def test_update_metadata_does_not_increment_version(self) -> None:
        """Test that update_test_metadata does NOT increment version."""
        created = test_service.create_test({"name": "Version Test"})
        original_version = created["version"]

        result = test_service.update_test_metadata(created["id"], {"name": "Updated Version Test"})

        assert result is not None
        assert result["version"] == original_version

    def test_update_metadata_stores_tags_in_metadata(self) -> None:
        """Test that tags are stored in metadata.tags."""
        created = test_service.create_test({"name": "Tags Test"})

        result = test_service.update_test_metadata(created["id"], {"tags": ["tag1", "tag2"]})

        assert result is not None
        assert result["metadata"]["tags"] == ["tag1", "tag2"]

    def test_update_metadata_returns_none_for_missing_test(self) -> None:
        """Test that update_test_metadata returns None for non-existent test."""
        result = test_service.update_test_metadata(
            "00000000-0000-0000-0000-000000000000", {"name": "Test"}
        )

        assert result is None

    def test_update_metadata_rejects_duplicate_name(self) -> None:
        """Test that update_test_metadata rejects duplicate name."""
        test_service.create_test({"name": "Existing Test"})
        created = test_service.create_test({"name": "Another Test"})

        with pytest.raises(ConflictException, match="already exists"):
            test_service.update_test_metadata(created["id"], {"name": "Existing Test"})

    def test_update_metadata_allows_same_name_update(self) -> None:
        """Test that updating with same name is allowed."""
        created = test_service.create_test({"name": "Same Name Test"})

        result = test_service.update_test_metadata(
            created["id"], {"name": "Same Name Test", "description": "Updated"}
        )

        assert result is not None
        assert result["name"] == "Same Name Test"
        assert result["description"] == "Updated"

    def test_update_metadata_validates_etag(self) -> None:
        """Test that update_test_metadata validates ETag when provided."""
        created = test_service.create_test({"name": "ETag Meta Test"})

        with pytest.raises(ConflictException, match="Precondition failed"):
            test_service.update_test_metadata(
                created["id"], {"name": "Updated"}, etag='"wrong-etag"'
            )


class TestDeleteTest:
    """Test suite for delete_test service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites._storage import _clear_storage as _clear_suite_storage

        test_service._clear_storage()
        _clear_suite_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_delete_test_removes_test(self) -> None:
        """Test deleting a test."""
        created = test_service.create_test({"name": "Delete Test"})

        result = test_service.delete_test(created["id"])

        assert result is True
        assert test_service.get_test(created["id"]) is None

    def test_delete_test_returns_false_when_not_found(self) -> None:
        """Test that delete returns False when test not found."""
        result = test_service.delete_test("nonexistent-id")

        assert result is False

    def test_delete_test_cascades_suite_removal(self) -> None:
        """Test that deleting a test removes it from all referencing suites."""
        from wavecore.api.services.suites import service as suite_service

        created = test_service.create_test({"name": "Referenced Test"})
        test_id = created["id"]

        # Create a suite with this test
        suite = suite_service.create_suite({"name": "CascadeSuite", "tests": [test_id]})
        suite_id = suite["id"]

        # Delete the test - should cascade (not raise)
        assert test_service.delete_test(test_id) is True

        # Suite should no longer contain the test
        updated_suite = suite_service.get_suite(suite_id)
        assert updated_suite is not None
        assert test_id not in updated_suite.get("tests", [])

    def test_delete_test_removes_versions(self) -> None:
        """Test that delete also removes version history."""
        created = test_service.create_test({"name": "Version Test"})
        test_id = created["id"]

        test_service.delete_test(test_id)

        assert test_service.get_test(test_id) is None
        # Version file is removed with the test directory
        assert test_service._load_versions(test_id) == []


class TestDeleteTestPreservesTrackedExecutions:
    """Test suite for the preserve-history contract on test deletion.

    When a test is deleted, every tracked execution that ran against that
    test must remain on disk and reachable through the Executions API. The
    workflow snapshot persisted on each execution record is what keeps the
    Historical Test Canvas viewable after deletion.
    """

    @pytest.fixture(autouse=True)
    def _isolated_storage(self, tmp_path: Path) -> None:
        """Reset both storages before each test, under the test's own tmp_path."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites._storage import _clear_storage as _clear_suite_storage

        storage_paths.set_base_path(tmp_path)

        test_service._clear_storage()
        _clear_suite_storage()
        _exec_storage._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def _create_tracked_execution_for_test(self, test_id: str) -> str:
        """Helper: seed a terminal tracked execution for the given test id."""
        from wavecore.api.services.executions import _storage as _exec_storage

        execution_id = str(uuid.uuid4())
        record = {
            "id": execution_id,
            "name": "tracked",
            "entity_type": "test",
            "entity_id": test_id,
            "environment_id": "env-1",
            "status": "passed",
            "started_at": "2026-04-18T10:00:00+00:00",
            "ended_at": "2026-04-18T10:00:10+00:00",
            "triggered_by": "dev",
            "workflow_snapshot": {"nodes": [], "edges": []},
        }
        _exec_storage._execution_storage[execution_id] = record
        _exec_storage._save_execution(record)
        return execution_id

    def test_delete_test_does_not_remove_tracked_execution_record(self) -> None:
        """A tracked execution's entity_id pointing at the deleted test still exists."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        created = test_service.create_test({"name": "tracked-preserve"})
        test_id = created["id"]
        execution_id = self._create_tracked_execution_for_test(test_id)

        assert test_service.delete_test(test_id) is True

        # Clear cache to force a disk reload - the record should still load.
        _exec_storage._clear_in_memory_cache()
        loaded = execution_service.get_execution(execution_id)
        assert loaded is not None
        assert loaded["entity_id"] == test_id
        assert loaded["status"] == "passed"

    def test_delete_test_preserves_execution_in_list(self) -> None:
        """The preserved execution is still surfaced in the executions list."""
        from wavecore.api.services.executions import service as execution_service

        created = test_service.create_test({"name": "tracked-list"})
        test_id = created["id"]
        execution_id = self._create_tracked_execution_for_test(test_id)

        test_service.delete_test(test_id)

        listing = execution_service.list_executions()
        ids = [item["id"] for item in listing["executions"]]
        assert execution_id in ids

    def test_delete_test_preserves_workflow_snapshot_on_yaml(self) -> None:
        """logs.yaml / execution.yaml of the tracked execution remain intact."""
        from wavecore.api.services import storage_paths

        created = test_service.create_test({"name": "tracked-disk"})
        test_id = created["id"]
        execution_id = self._create_tracked_execution_for_test(test_id)

        test_service.delete_test(test_id)

        exec_file = storage_paths.get_executions_storage_path() / execution_id / "execution.yaml"
        assert (
            exec_file.exists()
        ), "execution.yaml must not be removed when the source test is deleted"

    def test_delete_test_raises_conflict_when_running_execution(self) -> None:
        """Delete is blocked with ConflictException when a tracked execution is running."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        created = test_service.create_test({"name": "tracked-running"})
        test_id = created["id"]

        execution_id = str(uuid.uuid4())
        record = {
            "id": execution_id,
            "name": "tracked-running",
            "entity_type": "test",
            "entity_id": test_id,
            "environment_id": "env-1",
            "status": "running",
            "started_at": "2026-04-18T10:00:00+00:00",
            "triggered_by": "dev",
            "workflow_snapshot": {"nodes": [], "edges": []},
        }
        _exec_storage._execution_storage[execution_id] = record
        _exec_storage._save_execution(record)

        with pytest.raises(ConflictException) as exc_info:
            test_service.delete_test(test_id)

        assert exc_info.value.details == {"execution_ids": [execution_id]}
        # Test still exists; nothing was destroyed.
        assert test_service.get_test(test_id) is not None
        # Execution was NOT auto-stopped; it remains running.
        loaded = execution_service.get_execution(execution_id)
        assert loaded is not None
        assert loaded["status"] == "running"

    def test_delete_test_raises_conflict_when_paused_execution(self) -> None:
        """Paused tracked execution also blocks delete."""
        from wavecore.api.services.executions import _storage as _exec_storage

        created = test_service.create_test({"name": "tracked-paused"})
        test_id = created["id"]

        execution_id = str(uuid.uuid4())
        _exec_storage._execution_storage[execution_id] = {
            "id": execution_id,
            "name": "tracked-paused",
            "entity_type": "test",
            "entity_id": test_id,
            "environment_id": "env-1",
            "status": "paused",
            "started_at": "2026-04-18T10:00:00+00:00",
            "triggered_by": "dev",
        }

        with pytest.raises(ConflictException) as exc_info:
            test_service.delete_test(test_id)

        assert exc_info.value.details == {"execution_ids": [execution_id]}
        assert test_service.get_test(test_id) is not None

    def test_delete_test_reports_multiple_blocking_execution_ids(self) -> None:
        """Multiple active executions all land in the ConflictException details."""
        from wavecore.api.services.executions import _storage as _exec_storage

        created = test_service.create_test({"name": "tracked-multi"})
        test_id = created["id"]

        running_id = str(uuid.uuid4())
        paused_id = str(uuid.uuid4())
        for exec_id, status in ((running_id, "running"), (paused_id, "paused")):
            _exec_storage._execution_storage[exec_id] = {
                "id": exec_id,
                "name": "tracked-multi",
                "entity_type": "test",
                "entity_id": test_id,
                "environment_id": "env-1",
                "status": status,
                "started_at": "2026-04-18T10:00:00+00:00",
                "triggered_by": "dev",
            }

        with pytest.raises(ConflictException) as exc_info:
            test_service.delete_test(test_id)

        blocking_ids = exc_info.value.details["execution_ids"]
        assert set(blocking_ids) == {running_id, paused_id}

    def test_delete_test_succeeds_with_only_terminal_executions(self) -> None:
        """Past tracked executions in terminal states do not block delete."""
        from wavecore.api.services.executions import _storage as _exec_storage

        created = test_service.create_test({"name": "tracked-done"})
        test_id = created["id"]

        _exec_storage._execution_storage["passed-exec"] = {
            "id": "passed-exec",
            "name": "tracked-done",
            "entity_type": "test",
            "entity_id": test_id,
            "environment_id": "env-1",
            "status": "passed",
            "started_at": "2026-04-18T10:00:00+00:00",
            "ended_at": "2026-04-18T10:00:05+00:00",
            "triggered_by": "dev",
        }

        assert test_service.delete_test(test_id) is True
        assert test_service.get_test(test_id) is None

    @pytest.mark.parametrize("entity_type", ["suite", "regression"])
    def test_delete_test_raises_conflict_when_a_suite_or_regression_run_carries_it(
        self, entity_type: str
    ) -> None:
        """A running Suite or Regression execution that dispatched the test blocks delete."""
        from wavecore.api.services.executions import _storage as _exec_storage

        created = test_service.create_test({"name": f"carried-by-{entity_type}"})
        test_id = created["id"]

        execution_id = str(uuid.uuid4())
        _exec_storage._execution_storage[execution_id] = {
            "id": execution_id,
            "entity_type": entity_type,
            "entity_id": str(uuid.uuid4()),
            "status": "running",
        }
        _exec_storage._record_run_dispatched(execution_id, "run-1", test_id, None)

        with pytest.raises(
            ConflictException,
            match=rf"^Cannot delete test '{test_id}': execution is running or paused$",
        ) as exc_info:
            test_service.delete_test(test_id)

        assert exc_info.value.details == {"execution_ids": [execution_id]}
        assert test_service.get_test(test_id) is not None

    @pytest.mark.parametrize("status", ["running", "paused"])
    def test_delete_test_raises_conflict_when_a_workbench_session_runs_it(
        self, status: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A workbench session running or paused on the test blocks delete."""
        from wavecore.api.services.workbench import _common as workbench_common

        created = test_service.create_test({"name": f"workbench-{status}"})
        test_id = created["id"]

        session_id = str(uuid.uuid4())
        monkeypatch.setitem(
            workbench_common._workbench_sessions,
            session_id,
            {"session_id": session_id, "test_id": test_id, "status": status},
        )

        with pytest.raises(
            ConflictException,
            match=rf"^Cannot delete test '{test_id}': execution is running or paused$",
        ) as exc_info:
            test_service.delete_test(test_id)

        assert exc_info.value.details == {"execution_ids": [session_id]}
        assert test_service.get_test(test_id) is not None


class TestDeleteTestRemovesTestData:
    """The test's own files are removed with the test (REQ-3.4.3.2)."""

    def setup_method(self) -> None:
        """Reset test, suite, relation and execution storage before each test."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites._storage import _clear_storage as _clear_suite_storage

        test_service._clear_storage()
        _clear_suite_storage()
        _exec_storage._clear_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def _seed_testdata(self, test_id: str) -> Path:
        from wavecore.api.services import storage_paths

        root = storage_paths.get_test_testdata_path(test_id)
        (root / "sub").mkdir(parents=True, exist_ok=True)
        (root / "rows.csv").write_bytes(b"id,name\n")
        (root / "sub" / "notes.txt").write_bytes(b"notes")
        return root

    def test_delete_removes_the_test_data_folder(self) -> None:
        """Deleting a test removes its test data folder."""
        created = test_service.create_test({"name": "Files Go"})
        root = self._seed_testdata(created["id"])

        assert test_service.delete_test(created["id"]) is True
        assert not root.exists()

    def test_delete_without_a_folder_is_not_an_error(self) -> None:
        """A test that never had files deletes normally."""
        from wavecore.api.services import storage_paths

        created = test_service.create_test({"name": "No Files"})

        assert test_service.delete_test(created["id"]) is True
        assert not storage_paths.get_test_testdata_path(created["id"]).exists()

    def test_batch_delete_removes_the_folders_too(self) -> None:
        """The batch delete path cascades to every test's folder."""
        first = test_service.create_test({"name": "Batch One"})
        second = test_service.create_test({"name": "Batch Two"})
        roots = [self._seed_testdata(first["id"]), self._seed_testdata(second["id"])]

        result = test_service.batch_delete_tests([first["id"], second["id"]])

        assert set(result["deleted"]) == {first["id"], second["id"]}
        assert [r.exists() for r in roots] == [False, False]

    def test_the_folder_survives_a_refused_delete(self) -> None:
        """The active-execution guard runs before the folder is touched."""
        from wavecore.api.services.executions import _storage as _exec_storage

        created = test_service.create_test({"name": "Running Test"})
        root = self._seed_testdata(created["id"])
        _exec_storage._execution_storage["running-exec"] = {
            "id": "running-exec",
            "name": "Running Test",
            "entity_type": "test",
            "entity_id": created["id"],
            "environment_id": "env-1",
            "status": "running",
            "started_at": "2026-04-18T10:00:00+00:00",
            "triggered_by": "dev",
        }

        with pytest.raises(ConflictException):
            test_service.delete_test(created["id"])

        assert root.exists()

    def test_the_folder_is_removed_after_the_document(self) -> None:
        """The cascade is the last step: the document is already gone."""
        from wavecore.api.services.tests import testdata_service

        created = test_service.create_test({"name": "Order Matters"})
        self._seed_testdata(created["id"])
        document_gone: list[bool] = []

        def _record(test_id: str) -> None:
            document_gone.append(test_service._load_test(test_id) is None)

        with patch.object(testdata_service, "delete_for_test", side_effect=_record):
            test_service.delete_test(created["id"])

        assert document_gone == [True]


_CHANGING_VARIABLES = {
    "rows": {"type": "array", "value": [1]},
    "first": {"type": "string", "value": "rows.append(9)", "isExpression": True},
    "second": {"type": "string", "value": "rows.pop()", "isExpression": True},
}
_FIRST_CHANGING_FINDING = (
    "The append method changes data. An expression can only read data, "
    "not change it. To change a variable, add a Variable Setter Block. "
    "Variable: first."
)


class TestBatchOperations:
    """Test suite for batch service functions."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites._storage import _clear_storage as _clear_suite_storage

        test_service._clear_storage()
        _clear_suite_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_batch_create_tests_creates_multiple(self) -> None:
        """Test batch creating multiple tests."""
        tests = [{"name": "Test 1"}, {"name": "Test 2"}, {"name": "Test 3"}]

        result = test_service.batch_create_tests(tests)

        assert len(result["created"]) == 3
        assert len(result["failed"]) == 0

    def test_batch_create_tests_handles_failures(self) -> None:
        """Test batch create handles partial failures."""
        test_service.create_test({"name": "Existing Test"})
        tests = [{"name": "New Test"}, {"name": "Existing Test"}]

        result = test_service.batch_create_tests(tests)

        assert len(result["created"]) == 1
        assert len(result["failed"]) == 1
        assert "already exists" in result["failed"][0]["error"]

    def test_batch_create_tests_reports_a_refused_save_by_its_first_finding(self) -> None:
        tests = [
            {"name": "Clean Test"},
            {"name": "Changing Test", "variables": _CHANGING_VARIABLES},
        ]

        result = test_service.batch_create_tests(tests)

        assert result["failed"] == [{"index": 1, "error": _FIRST_CHANGING_FINDING}]
        assert [t["name"] for t in test_service._list_all_tests()] == ["Clean Test"]
        assert result["created"] == [test_service._list_all_tests()[0]["id"]]

    def test_batch_update_tests_reports_a_refused_save_by_its_first_finding(self) -> None:
        created = test_service.create_test({"name": "Clean Test"})

        result = test_service.batch_update_tests(
            [{"id": created["id"], "update": {"variables": _CHANGING_VARIABLES}}]
        )

        assert result == {
            "updated": [],
            "failed": [{"index": 0, "error": _FIRST_CHANGING_FINDING}],
        }
        reloaded = test_service.get_test(created["id"])
        assert reloaded is not None
        assert reloaded["variables"] == {}

    def test_batch_update_tests_updates_multiple(self) -> None:
        """Test batch updating multiple tests."""
        t1 = test_service.create_test({"name": "Test 1"})
        t2 = test_service.create_test({"name": "Test 2"})

        updates = [
            {"id": t1["id"], "update": {"description": "Updated 1"}},
            {"id": t2["id"], "update": {"description": "Updated 2"}},
        ]

        result = test_service.batch_update_tests(updates)

        assert len(result["updated"]) == 2
        assert len(result["failed"]) == 0

    def test_batch_update_tests_handles_not_found(self) -> None:
        """Test batch update handles not found errors."""
        updates = [{"id": "nonexistent", "update": {"description": "Updated"}}]

        result = test_service.batch_update_tests(updates)

        assert len(result["updated"]) == 0
        assert len(result["failed"]) == 1

    def test_batch_update_tests_direct_field_format(self) -> None:
        """Test batch update with direct field format (no 'update' wrapper)."""
        t1 = test_service.create_test({"name": "Test 1"})

        # Format: {id, metadata: {...}} instead of {id, update: {metadata: {...}}}
        updates = [
            {"id": t1["id"], "metadata": {"tags": ["smoke"]}},
        ]

        result = test_service.batch_update_tests(updates)

        assert len(result["updated"]) == 1
        assert len(result["failed"]) == 0

        # Verify the metadata was updated
        updated = test_service.get_test(t1["id"])
        assert updated is not None
        assert updated["metadata"]["tags"] == ["smoke"]

    def test_batch_update_tests_handles_exceptions(self) -> None:
        """Test batch update handles exceptions during update."""
        from unittest.mock import patch

        t1 = test_service.create_test({"name": "Test 1"})

        updates = [{"id": t1["id"], "update": {"description": "Updated"}}]

        with patch(
            "wavecore.api.services.tests.service.update_test",
            side_effect=Exception("Update failed"),
        ):
            result = test_service.batch_update_tests(updates)

        assert len(result["updated"]) == 0
        assert len(result["failed"]) == 1
        assert "Update failed" in result["failed"][0]["error"]

    def test_batch_delete_tests_deletes_multiple(self) -> None:
        """Test batch deleting multiple tests."""
        t1 = test_service.create_test({"name": "Test 1"})
        t2 = test_service.create_test({"name": "Test 2"})

        result = test_service.batch_delete_tests([t1["id"], t2["id"]])

        assert len(result["deleted"]) == 2
        assert len(result["failed"]) == 0

    def test_batch_delete_tests_handles_not_found(self) -> None:
        """Test batch delete handles not found errors."""
        result = test_service.batch_delete_tests(["nonexistent"])

        assert len(result["deleted"]) == 0
        assert len(result["failed"]) == 1

    def test_batch_delete_tests_cascades_suite_removal(self) -> None:
        """Test batch delete cascades suite removal for referenced tests."""
        from wavecore.api.services.suites import service as suite_service

        created = test_service.create_test({"name": "Referenced Test"})
        test_id = created["id"]

        suite = suite_service.create_suite({"name": "BatchCascadeSuite", "tests": [test_id]})
        suite_id = suite["id"]

        result = test_service.batch_delete_tests([test_id])

        assert len(result["deleted"]) == 1
        assert test_id in result["deleted"]

        updated_suite = suite_service.get_suite(suite_id)
        assert updated_suite is not None
        assert test_id not in updated_suite.get("tests", [])

    def test_batch_delete_tests_handles_exceptions(self) -> None:
        """Test batch delete handles exceptions during delete."""
        from unittest.mock import patch

        created = test_service.create_test({"name": "Error Test"})

        with patch(
            "wavecore.api.services.tests.service.delete_test",
            side_effect=WaveException("Delete failed"),
        ):
            result = test_service.batch_delete_tests([created["id"]])

        assert len(result["deleted"]) == 0
        assert len(result["failed"]) == 1
        assert "Delete failed" in result["failed"][0]["error"]


class TestVersionOperations:
    """Test suite for version service functions."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_add_test_version_creates_new_version(self) -> None:
        """Test adding a new version."""
        created = test_service.create_test({"name": "Version Test"})

        result = test_service.add_test_version(
            created["id"], {"version_bump": "major", "description": "Major update"}
        )

        assert result is not None
        assert result["version"] == "2.0.0"

    def test_add_test_version_returns_none_when_not_found(self) -> None:
        """Test that add_test_version returns None when not found."""
        result = test_service.add_test_version("nonexistent-id", {})

        assert result is None

    def test_add_test_version_supports_patch_bump(self) -> None:
        """Test adding a patch version."""
        created = test_service.create_test({"name": "Patch Test"})

        result = test_service.add_test_version(created["id"], {"version_bump": "patch"})

        assert result is not None
        assert result["version"] == "1.0.1"

    def test_add_test_version_handles_malformed_version(self) -> None:
        """Test adding version when existing version is malformed."""
        from tests.api.test_helpers import save_test_file

        # Create a test with malformed version directly
        test_id = str(uuid.uuid4())
        save_test_file(
            {
                "id": test_id,
                "name": "Malformed Version Test",
                "version": "invalid",  # Not semver format
                "workflow": {"nodes": [], "edges": []},
            }
        )

        result = test_service.add_test_version(test_id, {"version_bump": "minor"})

        assert result is not None
        # Should default to 1.1.0 when version can't be parsed
        assert result["version"] == "1.1.0"

    def test_add_test_version_handles_short_version(self) -> None:
        """Test adding version when existing version has too few parts."""
        from tests.api.test_helpers import save_test_file

        # Create a test with short version directly
        test_id = str(uuid.uuid4())
        save_test_file(
            {
                "id": test_id,
                "name": "Short Version Test",
                "version": "1.0",  # Only 2 parts
                "workflow": {"nodes": [], "edges": []},
            }
        )

        result = test_service.add_test_version(test_id, {"version_bump": "minor"})

        assert result is not None
        # Should default to 1.1.0 when version is too short
        assert result["version"] == "1.1.0"

    def test_delete_test_version_removes_version(self) -> None:
        """Test deleting a specific version."""
        created = test_service.create_test({"name": "Version Test"})
        test_service.add_test_version(created["id"], {"version_bump": "minor"})

        result = test_service.delete_test_version(created["id"], "1.0.0")

        assert result is True
        versions = [v["version"] for v in test_service._load_versions(created["id"])]
        assert "1.0.0" not in versions

    def test_delete_test_version_returns_false_when_not_found(self) -> None:
        """Test that delete_test_version returns False when not found."""
        created = test_service.create_test({"name": "Version Test"})

        result = test_service.delete_test_version(created["id"], "99.0.0")

        assert result is False

    def test_delete_test_version_returns_false_when_test_not_found(self) -> None:
        """Test that delete_test_version returns False when test not found."""
        result = test_service.delete_test_version("nonexistent-id", "1.0.0")

        assert result is False

    def test_delete_test_version_raises_on_references(self) -> None:
        """Test that delete raises error when version has references."""
        created = test_service.create_test({"name": "Referenced Test"})
        test_service._set_version_attribute(created["id"], "1.0.0", "suite_refs", 3)

        with pytest.raises(ConflictException, match="suites reference"):
            test_service.delete_test_version(created["id"], "1.0.0")


class TestWorkflowOperations:
    """Test suite for workflow service functions."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_get_test_workflow_returns_workflow(self) -> None:
        """Test getting test workflow."""
        workflow = {"nodes": [{"id": "1", "type": "start"}], "edges": []}
        created = _create_test_with_legacy_data({"name": "Workflow Test", "workflow": workflow})

        result = test_service.get_test_workflow(created["id"])

        assert result is not None
        assert len(result["nodes"]) == 1

    def test_get_test_workflow_returns_none_when_not_found(self) -> None:
        """Test that get_test_workflow returns None when not found."""
        result = test_service.get_test_workflow("nonexistent-id")

        assert result is None


class TestNodeSizingFieldsRoundTrip:
    """Test suite for canvas node sizing fields round-trip."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def _make_workflow_node(
        self,
        node_id: str = "node-1",
        extra_top_level: dict[str, Any] | None = None,
        extra_data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build a minimal valid workflow node, optionally with extra fields."""
        data: dict[str, Any] = {
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": "Log",
            "config": {"values": {"message": "hi"}},
        }
        if extra_data:
            data.update(extra_data)
        node: dict[str, Any] = {
            "id": node_id,
            "type": "workflowNode",
            "position": {"x": 100, "y": 200},
            "data": data,
        }
        if extra_top_level:
            node.update(extra_top_level)
        return node

    def test_node_round_trips_width_height_and_name_collapsed(self) -> None:
        """Saving width, height, and data.nameCollapsed preserves them on reload."""
        created = test_service.create_test({"name": "Sizing Round Trip"})

        node = self._make_workflow_node(
            node_id="node-1",
            extra_top_level={"width": 240, "height": 80},
            extra_data={"nameCollapsed": True},
        )

        test_service.update_test(
            created["id"],
            {"workflow": {"nodes": [node], "edges": []}},
        )

        reloaded = test_service.get_test(created["id"])

        assert reloaded is not None
        nodes = reloaded["workflow"]["nodes"]
        assert len(nodes) == 1
        assert nodes[0]["width"] == 240
        assert nodes[0]["height"] == 80
        assert nodes[0]["data"]["nameCollapsed"] is True

    def test_node_without_sizing_fields_loads_without_autofill(self) -> None:
        """Nodes saved without width/height/nameCollapsed reload cleanly without those keys."""
        created = test_service.create_test({"name": "No Sizing Fields"})

        node = self._make_workflow_node(node_id="node-1")

        test_service.update_test(
            created["id"],
            {"workflow": {"nodes": [node], "edges": []}},
        )

        reloaded = test_service.get_test(created["id"])

        assert reloaded is not None
        nodes = reloaded["workflow"]["nodes"]
        assert len(nodes) == 1
        assert "width" not in nodes[0]
        assert "height" not in nodes[0]
        assert "nameCollapsed" not in nodes[0]["data"]

    def test_node_with_legacy_measured_field_round_trips(self) -> None:
        """Nodes carrying the legacy 'measured' field still load and the field round-trips."""
        created = test_service.create_test({"name": "Legacy Measured"})

        node = self._make_workflow_node(
            node_id="node-1",
            extra_top_level={"measured": {"width": 120, "height": 44}},
        )

        test_service.update_test(
            created["id"],
            {"workflow": {"nodes": [node], "edges": []}},
        )

        reloaded = test_service.get_test(created["id"])

        assert reloaded is not None
        nodes = reloaded["workflow"]["nodes"]
        assert len(nodes) == 1
        assert nodes[0]["measured"] == {"width": 120, "height": 44}


class TestReadsOfLocalFunctionSecrets:
    """A Local Function's secret local reads as the Test's secret variables do: masked by
    default, in the clear while the test-variables reveal is on (REQ-3.1.3.17)."""

    @pytest.fixture(autouse=True)
    def _reveal_off(self) -> Any:
        from wavecore.core.secrets import masking_settings

        test_service._clear_storage()
        masking_settings.set_reveal_settings(test_variables=False)
        yield
        masking_settings.set_reveal_settings(test_variables=False)

    @staticmethod
    def _create() -> str:
        from tests.api.services.workbench.functions.conftest import (
            make_local_function_node,
            make_test_with_function_node,
        )

        node = make_local_function_node(node_id="fn-1")
        node["data"]["localDefinition"]["workflow"] = {"nodes": [], "edges": []}
        node["data"]["localDefinition"]["variables"] = [
            {"name": "token", "type": "string", "secret": True, "value": "plain-local"}
        ]
        return str(test_service.create_test(make_test_with_function_node(node))["id"])

    @staticmethod
    def _local(workflow: dict[str, Any]) -> dict[str, Any]:
        (node,) = [node for node in workflow["nodes"] if node["id"] == "fn-1"]
        local: dict[str, Any] = node["data"]["localDefinition"]["variables"][0]
        return local

    @staticmethod
    def _workflows(test_id: str) -> list[dict[str, Any]]:
        test = test_service.get_test(test_id)
        workflow = test_service.get_test_workflow(test_id)
        assert test is not None and workflow is not None
        return [test["workflow"], workflow]

    def test_masked_while_the_reveal_is_off(self) -> None:
        test_id = self._create()

        for workflow in self._workflows(test_id):
            local = self._local(workflow)
            assert (local["value"], local.get("masked")) == ("********", True)

    def test_in_the_clear_while_the_reveal_is_on(self) -> None:
        from wavecore.core.secrets import masking_settings

        test_id = self._create()
        masking_settings.set_reveal_settings(test_variables=True)

        for workflow in self._workflows(test_id):
            local = self._local(workflow)
            assert (local["value"], "masked" in local) == ("plain-local", False)


class TestVariableOperations:
    """Test suite for variable service functions."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_get_test_variables_returns_masked_variables(self) -> None:
        """Test getting test variables with masking."""
        created = test_service.create_test(
            {
                "name": "Var Test",
                "variables": {
                    "user": {"type": "string", "value": "admin"},
                    "password": {"type": "string", "secret": True, "value": "secret"},
                },
            }
        )
        # Store original secret value via raw update
        raw = test_service._get_raw_test(created["id"])
        assert raw is not None
        raw["variables"]["password"]["value"] = "secret"
        test_service._update_raw_test(created["id"], {"variables": raw["variables"]})

        result = test_service.get_test_variables(created["id"])

        assert result is not None
        assert result["user"]["value"] == "admin"
        assert result["password"]["value"] == "********"

    def test_get_test_variables_returns_none_when_not_found(self) -> None:
        """Test that get_test_variables returns None when not found."""
        result = test_service.get_test_variables("nonexistent-id")

        assert result is None

    def test_get_test_variables_raw_returns_unmasked_values(self) -> None:
        """Engine-injection read: secrets come back sealed (never ********), restorable."""
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        created = test_service.create_test(
            {
                "name": "Var Raw Test",
                "variables": {
                    "user": {"type": "string", "value": "admin"},
                    "password": {"type": "string", "secret": True, "value": "k3y-real-88"},
                },
            }
        )

        result = test_service.get_test_variables_raw(created["id"])

        assert result is not None
        assert is_secret_envelope(result["password"]["value"])
        assert unseal_all(result["password"]["value"]) == "k3y-real-88"
        assert result["password"]["secret"] is True
        assert result["user"]["value"] == "admin"

    def test_get_test_variables_raw_returns_none_when_not_found(self) -> None:
        result = test_service.get_test_variables_raw("nonexistent-id")

        assert result is None

    def test_update_test_variables_replaces_by_default(self) -> None:
        """Test that update replaces variables by default."""
        created = test_service.create_test(
            {
                "name": "Var Test",
                "variables": {"old": {"type": "string", "value": "old"}},
            }
        )

        result = test_service.update_test_variables(
            created["id"], {"new": {"type": "string", "value": "new"}}, merge=False
        )

        assert result is not None
        assert "new" in result
        assert "old" not in result

    def test_update_test_variables_merges_when_requested(self) -> None:
        """Test that update merges variables when merge=True."""
        created = test_service.create_test(
            {
                "name": "Var Test",
                "variables": {"old": {"type": "string", "value": "old"}},
            }
        )

        result = test_service.update_test_variables(
            created["id"], {"new": {"type": "string", "value": "new"}}, merge=True
        )

        assert result is not None
        assert "new" in result
        assert "old" in result

    def test_update_test_variables_validates_type_consistency(self) -> None:
        """Test that type changes are rejected when merging."""
        created = test_service.create_test(
            {
                "name": "Var Test",
                "variables": {"count": {"type": "integer", "value": 1}},
            }
        )

        with pytest.raises(ValidationException, match="Type mismatch"):
            test_service.update_test_variables(
                created["id"], {"count": {"type": "string", "value": "one"}}, merge=True
            )

    def test_update_test_variables_validates_computed_syntax(self) -> None:
        """Test that invalid computed expressions are rejected."""
        created = test_service.create_test({"name": "Computed Test"})

        with pytest.raises(ValidationException, match="Invalid expression syntax"):
            test_service.update_test_variables(
                created["id"],
                {"total": {"type": "integer", "computed": True, "expression": "if x then y"}},
            )

    def test_update_test_variables_validates_computed_references(self) -> None:
        """Test that undefined variable references are rejected."""
        created = test_service.create_test({"name": "Computed Test"})

        with pytest.raises(ValidationException, match="undefined variable"):
            test_service.update_test_variables(
                created["id"],
                {"total": {"type": "integer", "computed": True, "expression": "count * price"}},
            )

    def test_update_test_variables_returns_none_when_not_found(self) -> None:
        """Test that update returns None when test not found."""
        result = test_service.update_test_variables("nonexistent-id", {})

        assert result is None


class TestValidateTest:
    """Test suite for validate_test service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()
        # Register controls for parameter validation
        from wavecore.controls.registry import _registry, register_all_core_controls

        _registry.clear()
        register_all_core_controls(_registry)

    def _make_workflow_node(
        self,
        node_id: str = "node-1",
        element_type: str = "variable-setter",
        node_type: str = "control",
        label: str = "Set Variables",
        version: str = "1.0.0",
        config: dict[str, Any] | None = None,
        position: dict[str, Any] | None = None,
        data_extras: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Helper to create a valid workflowNode."""
        if position is None:
            position = {"x": 100, "y": 200}
        if config is None:
            config = {"values": {"variables": {"my_var": "hello"}}}
        data: dict[str, Any] = {
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "label": label,
            "config": config,
        }
        if data_extras:
            data.update(data_extras)
        return {
            "id": node_id,
            "type": "workflowNode",
            "position": position,
            "data": data,
        }

    def _errors_of(
        self,
        code: str,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        """Every error with the code, for a stored Test with this workflow."""
        created = _create_test_with_legacy_data(
            {"name": "Block wording", "workflow": {"nodes": nodes, "edges": edges or []}}
        )
        result = test_service.validate_test(created["id"])
        assert result is not None
        return [entry for entry in result["errors"] if entry["code"] == code]

    def _error_messages(
        self,
        code: str,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]] | None = None,
    ) -> list[str]:
        """The message of every error with the code, for a stored Test with this workflow."""
        return [entry["message"] for entry in self._errors_of(code, nodes, edges)]

    def test_validate_test_returns_valid_for_good_workflow(self) -> None:
        """Test that validation passes for valid workflow with workflowNode nodes."""
        created = _create_test_with_legacy_data(
            {
                "name": "Valid Test",
                "variables": {"my_var": {"type": "string", "value": ""}},
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1", "variable-setter", "control", "Set Vars"
                        ),
                        self._make_workflow_node(
                            "node-2",
                            "log",
                            "plugin",
                            "Log Message",
                            config={"values": {"message": "hello"}},
                        ),
                    ],
                    "edges": [{"id": "e1", "source": "node-1", "target": "node-2"}],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

    def test_validate_test_rejects_start_and_end_node_types(self) -> None:
        """Test that 'start' and 'end' node types are rejected as INVALID_NODE_TYPE.

        Only 'workflowNode' is valid in stored data. The execution engine finds
        entry points from graph topology, so no special start/end nodes are needed.
        """
        created = _create_test_with_legacy_data(
            {
                "name": "Start End Test",
                "workflow": {
                    "nodes": [
                        {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}},
                        {"id": "e1", "type": "end", "position": {"x": 200, "y": 0}},
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert error_codes.count("INVALID_NODE_TYPE") == 2

    def test_validate_test_detects_invalid_node_type(self) -> None:
        """Test that unknown node types produce INVALID_NODE_TYPE."""
        created = _create_test_with_legacy_data(
            {
                "name": "Bad Node Type Test",
                "workflow": {
                    "nodes": [
                        {"id": "b1", "type": "custom-invalid", "position": {"x": 0, "y": 0}},
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "INVALID_NODE_TYPE" in error_codes

    def test_validate_test_invalid_node_type_message_says_block_type(self) -> None:
        node = {"id": "b1", "type": "custom-invalid", "position": {"x": 0, "y": 0}}

        (message,) = self._error_messages("INVALID_NODE_TYPE", [node])

        assert re.fullmatch(
            r"^Block type must be one of \['noteNode', 'workflowNode'\], got 'custom-invalid'$",
            message,
        )

    def test_validate_test_detects_unknown_element_type(self) -> None:
        """Test that an unknown elementType produces UNKNOWN_BLOCK_TYPE error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Unknown Block Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1", "nonexistent-block", "plugin", "Bad Block"
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "UNKNOWN_BLOCK_TYPE" in error_codes
        unknown_err = next(e for e in result["errors"] if e["code"] == "UNKNOWN_BLOCK_TYPE")
        assert unknown_err["node_id"] == "node-1"
        assert unknown_err["element_type"] == "nonexistent-block"

    def test_validate_test_unknown_element_type_reads_unknown_block_type(self) -> None:
        node = self._make_workflow_node("node-1", "nonexistent-block", "plugin", "Bad Block")

        (error,) = self._errors_of("UNKNOWN_BLOCK_TYPE", [node])

        assert re.fullmatch(r"^Unknown block type: 'nonexistent-block'$", error["message"])
        assert re.fullmatch(r"^Remove block$", error["fix_action"])

    def test_validate_test_detects_node_type_mismatch(self) -> None:
        """Test elementType is control but nodeType says 'plugin' produces NODE_TYPE_MISMATCH."""
        created = _create_test_with_legacy_data(
            {
                "name": "Mismatch Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "variable-setter",
                            "plugin",
                            "Mismatched",
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "NODE_TYPE_MISMATCH" in error_codes
        mismatch_err = next(e for e in result["errors"] if e["code"] == "NODE_TYPE_MISMATCH")
        assert "variable-setter" in mismatch_err["message"]
        assert "plugin" in mismatch_err["message"]
        assert "control" in mismatch_err["message"]

    def test_validate_test_accepts_function_nodetype_on_non_control(self) -> None:
        """nodeType='function' on a non-control element is accepted (no NODE_TYPE_MISMATCH)."""
        created = _create_test_with_legacy_data(
            {
                "name": "Function NodeType Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "log",
                            "function",
                            "Function Block",
                            config={
                                "values": {"message": '"hi"', "level": "INFO"},
                                "outputBindings": {},
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "NODE_TYPE_MISMATCH" not in error_codes

    def test_validate_test_accepts_function_element_type(self) -> None:
        """elementType='function' is the Function-paradigm marker and must be accepted.

        Frontend canvas materializes Function nodes (both the "+ New Function"
        drag and the Library modal drag) with `elementType: 'function'` and
        `nodeType: 'function'`. The validator must NOT emit UNKNOWN_BLOCK_TYPE
        for this combination, otherwise the persist-stage autofix strips the
        node and the user silently loses their work on save.
        """
        # Use the real create_test path (which exercises _validate_for_persist
        # + autofix), not the legacy bypass helper. This is the contract that
        # the drag-to-create flow depends on.
        created = test_service.create_test(
            {
                "name": "Function ElementType Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "fn-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "function",
                                "nodeType": "function",
                                "functionLifecycle": "local",
                                "version": "1.0.0",
                                "label": "Function_1",
                                "localDefinition": {
                                    "name": "Function_1",
                                    "workflow": {"nodes": [], "edges": []},
                                    "inputs": [],
                                    "outputs": [],
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
                "variables": {},
                "metadata": {},
            }
        )

        # The fn-1 node must persist through create_test - the persist-stage
        # autofix must NOT strip it because 'function' is a recognized type.
        workflow = test_service.get_test_workflow(created["id"])
        assert workflow is not None
        nodes = workflow["nodes"]
        assert len(nodes) == 1, f"Function node was stripped on persist: {nodes}"
        assert nodes[0]["data"]["elementType"] == "function"
        assert nodes[0]["data"]["nodeType"] == "function"
        assert nodes[0]["data"]["functionLifecycle"] == "local"

        # Validation in the load context returns no UNKNOWN_BLOCK_TYPE for elementType='function'.
        result = test_service.validate_test(created["id"])
        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "UNKNOWN_BLOCK_TYPE" not in error_codes
        assert "NODE_TYPE_MISMATCH" not in error_codes

    def test_validate_test_detects_required_param_empty(self) -> None:
        """Test Variable Setter with empty variables dict produces REQUIRED_PARAM_EMPTY."""
        created = _create_test_with_legacy_data(
            {
                "name": "Empty Param Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "variable-setter",
                            "control",
                            "Empty Vars",
                            config={"values": {"variables": {}}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0
        warning_codes = [w["code"] for w in result["warnings"]]
        assert "REQUIRED_PARAM_EMPTY" in warning_codes

    def test_validate_test_detects_required_param_missing(self) -> None:
        """Test missing required string parameter produces REQUIRED_PARAM_MISSING."""
        created = _create_test_with_legacy_data(
            {
                "name": "Missing Param Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "variable-setter",
                            "control",
                            "No Vars",
                            config={"values": {}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0
        warning_codes = [w["code"] for w in result["warnings"]]
        assert "REQUIRED_PARAM_MISSING" in warning_codes

    def test_validate_test_detects_missing_position(self) -> None:
        """Test that missing node position produces an error."""
        created = _create_test_with_legacy_data(
            {
                "name": "No Position Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Set Vars",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_POSITION" in error_codes

    def test_validate_test_missing_position_message_says_block(self) -> None:
        node = self._make_workflow_node()
        del node["position"]

        (message,) = self._error_messages("MISSING_POSITION", [node])

        assert re.fullmatch(r"^Block must have a position with numeric x and y$", message)

    def test_validate_test_detects_invalid_variable_name(self) -> None:
        """Test that invalid variable names produce INVALID_VARIABLE error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Bad Variable Test",
                "variables": {
                    "valid_var": {"type": "string", "value": "ok"},
                    "123-bad": {"type": "string", "value": "bad"},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "INVALID_VARIABLE" in error_codes
        invalid_var_err = next(e for e in result["errors"] if e["code"] == "INVALID_VARIABLE")
        assert "123-bad" in invalid_var_err["message"]

    def test_collect_profile_refs_includes_metadata_profile_id(self) -> None:
        """_collect_profile_refs picks up the test-level metadata profile_id."""
        from wavecore.api.services.tests import service as test_service

        refs = test_service._collect_profile_refs(
            {"metadata": {"profile_id": "abc"}, "workflow": {"nodes": []}}
        )
        assert refs == ["abc"]

    def test_collect_profile_refs_skips_non_dict_node(self) -> None:
        """_collect_profile_refs tolerates malformed workflows (string nodes etc.)."""
        from wavecore.api.services.tests import service as test_service

        refs = test_service._collect_profile_refs(
            {
                "metadata": {},
                "workflow": {
                    "nodes": [
                        "not-a-dict",
                        {"data": "also-not-a-dict"},
                        {"data": {"config": "still-not-a-dict"}},
                    ]
                },
            }
        )
        assert refs == []

    def test_validate_test_detects_alias_name_conflict(self) -> None:
        """Variable name colliding with a profile alias produces ALIAS_NAME_CONFLICT."""
        node_with_binding = self._make_workflow_node(
            node_id="node-1",
            config={
                "values": {"variables": {"_unused": "x"}},
                "profileBindings": [{"profileId": "p1", "alias": "cpr"}],
            },
        )
        created = _create_test_with_legacy_data(
            {
                "name": "Alias Conflict Test",
                "variables": {"cpr": {"type": "string", "value": "v"}},
                "workflow": {"nodes": [node_with_binding], "edges": []},
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "ALIAS_NAME_CONFLICT" in error_codes
        err = next(e for e in result["errors"] if e["code"] == "ALIAS_NAME_CONFLICT")
        assert "cpr" in err["message"]

    def test_validate_test_detects_invalid_variable_type(self) -> None:
        """Test that invalid variable type produces INVALID_VARIABLE_TYPE error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Bad Variable Type Test",
                "variables": {
                    "my_var": {"type": "nonexistent", "value": "val"},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "INVALID_VARIABLE_TYPE" in error_codes

    @pytest.mark.parametrize(
        ("name", "code", "reason"),
        [
            pytest.param(
                "n\u00e4me",
                "INVALID_VARIABLE",
                "must match [a-zA-Z_][a-zA-Z0-9_]*",
                id="not-ascii",
            ),
            pytest.param("class", "INVALID_VARIABLE", "a Python keyword", id="keyword"),
            pytest.param(
                "a" * 65, "INVALID_VARIABLE", "must be 64 characters or fewer", id="too-long"
            ),
            pytest.param(
                "system",
                "RESERVED_VARIABLE_NAME",
                "reserved for namespace access; use system.field_name",
                id="namespace",
            ),
        ],
    )
    def test_validate_test_refuses_a_name_the_variable_window_refuses(
        self, name: str, code: str, reason: str
    ) -> None:
        """One declaration rule for Test variables and Function declarations (REQ-3.1.3.1)."""
        created = _create_test_with_legacy_data(
            {
                "name": "Refused Variable Name Test",
                "variables": {name: {"type": "string", "value": "v"}},
                "workflow": {"nodes": [self._make_workflow_node("node-1")], "edges": []},
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        named = [
            (e["code"], e["path"], e["message"]) for e in result["errors"] if name in e["path"]
        ]
        assert named == [(code, f"variables.{name}", f"Invalid variable name: '{name}' ({reason})")]

    def test_validate_test_detects_invalid_element_types(self) -> None:
        """A variable's element-type sidecar must fit its value (REQ-3.1.3.19)."""
        created = _create_test_with_legacy_data(
            {
                "name": "Bad Element Types Test",
                "variables": {
                    "m": {"type": "map", "value": {"n": "1"}, "elementTypes": ["integer"]},
                    "ok": {"type": "array", "value": ["1"], "elementTypes": ["integer"]},
                },
                "workflow": {"nodes": [self._make_workflow_node("node-1")], "edges": []},
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        errors = [e for e in result["errors"] if e["code"] == "INVALID_ELEMENT_TYPES"]
        assert len(errors) == 1
        assert errors[0]["path"] == "variables.m.elementTypes"
        assert errors[0]["message"] == (
            "Invalid element types for variable 'm': "
            "the element types of a map must map each key to a type"
        )

    def test_validate_test_detects_dangling_edge(self) -> None:
        """Test that edge referencing non-existent node produces DANGLING_EDGE."""
        created = _create_test_with_legacy_data(
            {
                "name": "Dangling Edge Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "node-1", "target": "nonexistent"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "DANGLING_EDGE" in error_codes

    def test_validate_test_dangling_edge_target_message_says_block(self) -> None:
        edges = [{"id": "e1", "source": "node-1", "target": "nonexistent"}]

        (message,) = self._error_messages("DANGLING_EDGE", [self._make_workflow_node()], edges)

        assert re.fullmatch(r"^Edge target 'nonexistent' references non-existent block$", message)

    def test_validate_test_detects_self_loop_edge(self) -> None:
        """Test that self-loop edge produces SELF_LOOP_EDGE."""
        created = _create_test_with_legacy_data(
            {
                "name": "Self Loop Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "node-1", "target": "node-1"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "SELF_LOOP_EDGE" in error_codes

    def test_validate_test_detects_invalid_edge_type(self) -> None:
        """Test that edge with invalid type produces INVALID_EDGE_TYPE."""
        created = _create_test_with_legacy_data(
            {
                "name": "Invalid Edge Type Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                        self._make_workflow_node("node-2"),
                    ],
                    "edges": [
                        {
                            "id": "e1",
                            "source": "node-1",
                            "target": "node-2",
                            "type": "bogus",
                        },
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "INVALID_EDGE_TYPE" in error_codes

    def test_validate_test_accepts_valid_edge_types(self) -> None:
        """Test that valid edge types do not produce errors."""
        for edge_type in ("default", "smoothstep", "step", "straight"):
            created = _create_test_with_legacy_data(
                {
                    "name": f"Valid Edge Type {edge_type}",
                    "workflow": {
                        "nodes": [
                            self._make_workflow_node("node-1"),
                            self._make_workflow_node("node-2"),
                        ],
                        "edges": [
                            {
                                "id": "e1",
                                "source": "start-node",
                                "target": "node-1",
                            },
                            {
                                "id": "e2",
                                "source": "node-1",
                                "target": "node-2",
                                "type": edge_type,
                            },
                        ],
                    },
                }
            )

            result = test_service.validate_test(created["id"])

            assert result is not None
            error_codes = [e["code"] for e in result["errors"]]
            assert (
                "INVALID_EDGE_TYPE" not in error_codes
            ), f"edge type '{edge_type}' should be valid"

    def test_validate_test_accepts_edge_without_type(self) -> None:
        """Test that edges without a type field do not produce INVALID_EDGE_TYPE."""
        created = _create_test_with_legacy_data(
            {
                "name": "No Edge Type Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                        self._make_workflow_node("node-2"),
                    ],
                    "edges": [
                        {
                            "id": "e1",
                            "source": "start-node",
                            "target": "node-1",
                        },
                        {
                            "id": "e2",
                            "source": "node-1",
                            "target": "node-2",
                        },
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "INVALID_EDGE_TYPE" not in error_codes

    def test_validate_test_detects_multiple_outgoing_edges(self) -> None:
        """Test that node with >1 outgoing edge produces MULTIPLE_EDGES."""
        created = _create_test_with_legacy_data(
            {
                "name": "Multi Out Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("nA", "log", "plugin", "A"),
                        self._make_workflow_node("nB", "log", "plugin", "B"),
                        self._make_workflow_node("nC", "log", "plugin", "C"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "nA", "target": "nB"},
                        {"id": "e3", "source": "nA", "target": "nC"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "MULTIPLE_EDGES" in error_codes
        multi_errors = [e for e in result["errors"] if e["code"] == "MULTIPLE_EDGES"]
        assert any("outgoing" in e["message"] for e in multi_errors)

    def test_validate_test_allows_convergence_with_named_handles(self) -> None:
        """Test that node with multiple incoming edges on different handles is valid."""
        created = _create_test_with_legacy_data(
            {
                "name": "Convergence Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("nA", "log", "plugin", "A"),
                        self._make_workflow_node("nB", "log", "plugin", "B"),
                        self._make_workflow_node("nC", "log", "plugin", "C"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "nA", "target": "nC", "targetHandle": "ingress_0"},
                        {"id": "e3", "source": "nB", "target": "nC", "targetHandle": "ingress_1"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        # Multiple incoming edges on DIFFERENT handles should NOT produce errors
        if result is not None:
            multi_errors = [e for e in result["errors"] if e["code"] == "MULTIPLE_EDGES"]
            assert not any("incoming" in e["message"] for e in multi_errors)

    def test_validate_test_rejects_duplicate_incoming_on_same_handle(self) -> None:
        """Test that two edges on the same target handle produce MULTIPLE_EDGES."""
        created = _create_test_with_legacy_data(
            {
                "name": "Duplicate Handle Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("nA", "log", "plugin", "A"),
                        self._make_workflow_node("nB", "log", "plugin", "B"),
                        self._make_workflow_node("nC", "log", "plugin", "C"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "nA", "target": "nC"},
                        {"id": "e3", "source": "nB", "target": "nC"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "MULTIPLE_EDGES" in error_codes
        multi_errors = [e for e in result["errors"] if e["code"] == "MULTIPLE_EDGES"]
        assert any("incoming" in e["message"] for e in multi_errors)

    @pytest.mark.parametrize(
        ("handle", "where"),
        [(None, ""), ("ingress_0", " on handle 'ingress_0'")],
        ids=["the default handle", "a named handle"],
    )
    def test_validate_test_duplicate_incoming_message_says_block(
        self, handle: str | None, where: str
    ) -> None:
        nodes = [
            self._make_workflow_node(node_id, "log", "plugin", label)
            for node_id, label in (("nA", "A"), ("nB", "B"), ("nC", "C"))
        ]
        into_c: dict[str, Any] = {"target": "nC"} | ({"targetHandle": handle} if handle else {})
        edges = [
            {"id": "e1", "source": "start-node", "target": "nA"},
            {"id": "e2", "source": "nA"} | into_c,
            {"id": "e3", "source": "nB"} | into_c,
        ]

        (message,) = self._error_messages("MULTIPLE_EDGES", nodes, edges)

        assert re.fullmatch(
            rf"^Block 'C' has 2 incoming edges{where} \(max 1 per handle\)$", message
        )

    def test_validate_test_allows_dynamic_branches_from_config(self) -> None:
        """Test that If/Else with configured branches allows matching outgoing edge count."""
        created = _create_test_with_legacy_data(
            {
                "name": "Dynamic Branch Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("nA", "if-else", "control", "IfElse"),
                        self._make_workflow_node("nB", "log", "plugin", "B"),
                        self._make_workflow_node("nC", "log", "plugin", "C"),
                        self._make_workflow_node("nD", "log", "plugin", "D"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "nA", "target": "nB", "sourceHandle": "branch_0"},
                        {"id": "e3", "source": "nA", "target": "nC", "sourceHandle": "branch_1"},
                        {"id": "e4", "source": "nA", "target": "nD", "sourceHandle": "branch_2"},
                    ],
                },
            }
        )
        # Patch the If/Else node to have 3 branches in config
        test = test_service._load_test(created["id"])
        for node in test["workflow"]["nodes"]:
            if node["id"] == "nA":
                node["data"]["version"] = "1.0.0"
                node["data"]["config"] = {
                    "values": {
                        "branches": [
                            {
                                "id": "branch_0",
                                "type": "if",
                                "conditions": [
                                    {
                                        "type": "literal",
                                        "variable": "x",
                                        "value_type": "integer",
                                        "operator": "equals",
                                        "reference_value": 1,
                                    }
                                ],
                            },
                            {
                                "id": "branch_1",
                                "type": "else_if",
                                "conditions": [
                                    {
                                        "type": "literal",
                                        "variable": "x",
                                        "value_type": "integer",
                                        "operator": "equals",
                                        "reference_value": 2,
                                    }
                                ],
                            },
                            {"id": "branch_2", "type": "else"},
                        ]
                    }
                }
        test_service._save_test(test)

        result = test_service.validate_test(created["id"])

        # 3 outgoing edges from If/Else should be allowed (matches 3 configured branches)
        if result is not None:
            multi_errors = [
                e
                for e in result["errors"]
                if e["code"] == "MULTIPLE_EDGES" and "outgoing" in e["message"]
            ]
            assert (
                len(multi_errors) == 0
            ), f"Dynamic branches should allow 3 outgoing edges: {multi_errors}"

    def test_validate_test_allows_remote_execution_body_and_then_edges(self) -> None:
        """Remote Execution is a container: its body + then egress (2 edges) is allowed."""
        created = _create_test_with_legacy_data(
            {
                "name": "Remote Execution Edges",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "rex",
                            "remote-execution",
                            "plugin",
                            "Remote Execution",
                            config={"values": {"session_id": "s"}},
                        ),
                        self._make_workflow_node(
                            "body",
                            "http-client",
                            "plugin",
                            "Body",
                            config={"values": {"method": "GET", "url": "http://x"}},
                        ),
                        self._make_workflow_node(
                            "after",
                            "log",
                            "plugin",
                            "After",
                            config={"values": {"message": "'done'"}},
                        ),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "rex"},
                        {"id": "e2", "source": "rex", "target": "body", "sourceHandle": "body"},
                        {"id": "e3", "source": "rex", "target": "after", "sourceHandle": "then"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        if result is not None:
            multi_errors = [e for e in result["errors"] if e["code"] == "MULTIPLE_EDGES"]
            assert (
                len(multi_errors) == 0
            ), f"Remote Execution should allow body + then edges: {multi_errors}"

    def test_validate_test_self_loop_does_not_trigger_multiple_edges(self) -> None:
        """Test that a self-loop alone does not produce MULTIPLE_EDGES."""
        created = _create_test_with_legacy_data(
            {
                "name": "Self Loop Only Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("nA", "log", "plugin", "A"),
                        self._make_workflow_node("nB", "log", "plugin", "B"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "nA", "target": "nB"},
                        {"id": "e-self", "source": "nB", "target": "nB"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "SELF_LOOP_EDGE" in error_codes
        assert "MULTIPLE_EDGES" not in error_codes

    def test_validate_test_start_node_multiple_outputs(self) -> None:
        """Test that start-node with >1 outgoing edge produces MULTIPLE_EDGES."""
        created = _create_test_with_legacy_data(
            {
                "name": "Start Multi Out Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("nA", "log", "plugin", "A"),
                        self._make_workflow_node("nB", "log", "plugin", "B"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "start-node", "target": "nB"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "MULTIPLE_EDGES" in error_codes
        multi_errors = [e for e in result["errors"] if e["code"] == "MULTIPLE_EDGES"]
        assert any("Start" in e["message"] and "outgoing" in e["message"] for e in multi_errors)

    def test_validate_test_self_loop_and_multiple_edges_both_fire(self) -> None:
        """Test that self-loop + multi-edge on same node reports both errors."""
        created = _create_test_with_legacy_data(
            {
                "name": "Loop + Multi Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("nA", "log", "plugin", "A"),
                        self._make_workflow_node("nB", "log", "plugin", "B"),
                        self._make_workflow_node("nC", "log", "plugin", "C"),
                        self._make_workflow_node("nD", "log", "plugin", "D"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "nA", "target": "nB"},
                        {"id": "e3", "source": "nB", "target": "nC"},
                        {"id": "e4", "source": "nC", "target": "nD"},
                        {"id": "e-self", "source": "nB", "target": "nB"},
                        {"id": "e5", "source": "nB", "target": "nD"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "SELF_LOOP_EDGE" in error_codes
        assert "MULTIPLE_EDGES" in error_codes

    def test_validate_test_allows_branching_control_multiple_outgoing(self) -> None:
        """Branching controls (e.g. Assert) may have one outgoing edge per branch."""
        created = _create_test_with_legacy_data(
            {
                "name": "Branching Assert Test",
                "variables": {
                    "x": {"type": "integer", "value": "42"},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "assert-1",
                            "assert",
                            "control",
                            "Split Assert",
                            config={
                                "values": {
                                    "assertions": [
                                        {
                                            "type": "literal",
                                            "variable": "x",
                                            "compare_type": "integer",
                                            "operator": "equals",
                                            "value": "42",
                                        }
                                    ],
                                    "mode": "split",
                                    "root_operator": "and",
                                }
                            },
                        ),
                        self._make_workflow_node("nPass", "log", "plugin", "Pass"),
                        self._make_workflow_node("nFail", "log", "plugin", "Fail"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "assert-1"},
                        {
                            "id": "e2",
                            "source": "assert-1",
                            "target": "nPass",
                            "sourceHandle": "pass",
                        },
                        {
                            "id": "e3",
                            "source": "assert-1",
                            "target": "nFail",
                            "sourceHandle": "fail",
                        },
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "MULTIPLE_EDGES" not in error_codes

    def test_validate_test_branching_control_exceeds_branch_count(self) -> None:
        """Branching control with more outgoing edges than branches is an error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Too Many Branches Test",
                "variables": {
                    "x": {"type": "integer", "value": "42"},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "assert-1",
                            "assert",
                            "control",
                            "Split Assert",
                            config={
                                "values": {
                                    "assertions": [
                                        {
                                            "type": "literal",
                                            "variable": "x",
                                            "compare_type": "integer",
                                            "operator": "equals",
                                            "value": "42",
                                        }
                                    ],
                                    "mode": "split",
                                    "root_operator": "and",
                                }
                            },
                        ),
                        self._make_workflow_node("nA", "log", "plugin", "A"),
                        self._make_workflow_node("nB", "log", "plugin", "B"),
                        self._make_workflow_node("nC", "log", "plugin", "C"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "assert-1"},
                        {"id": "e2", "source": "assert-1", "target": "nA"},
                        {"id": "e3", "source": "assert-1", "target": "nB"},
                        {"id": "e4", "source": "assert-1", "target": "nC"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "MULTIPLE_EDGES" in error_codes
        multi_errors = [e for e in result["errors"] if e["code"] == "MULTIPLE_EDGES"]
        assert any("max 2" in e["message"] for e in multi_errors)

    def test_validate_test_allows_scoped_control_multiple_outgoing(self) -> None:
        """Scoped controls (try-catch-finally) allow edges per branch handle."""
        created = _create_test_with_legacy_data(
            {
                "name": "Scoped TryCatch Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "tc-1",
                            "try-catch-finally",
                            "control",
                            "Try/Catch",
                            config={
                                "values": {
                                    "enable_catch": True,
                                    "enable_finally": False,
                                }
                            },
                        ),
                        self._make_workflow_node("nTry", "log", "plugin", "Try"),
                        self._make_workflow_node("nCatch", "log", "plugin", "Catch"),
                        self._make_workflow_node("nThen", "log", "plugin", "Then"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "tc-1"},
                        {"id": "e2", "source": "tc-1", "target": "nTry", "sourceHandle": "try"},
                        {"id": "e3", "source": "tc-1", "target": "nCatch", "sourceHandle": "catch"},
                        {"id": "e4", "source": "tc-1", "target": "nThen", "sourceHandle": "then"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "MULTIPLE_EDGES" not in error_codes, (
            f"Scoped control should allow 3 outgoing edges: "
            f"{[e for e in result['errors'] if e['code'] == 'MULTIPLE_EDGES']}"
        )

    def test_validate_test_detects_cross_scope_edge(self) -> None:
        """Cross-scope edge: try-path node connecting to catch-path node."""
        created = _create_test_with_legacy_data(
            {
                "name": "Cross Scope Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "tc-1",
                            "try-catch-finally",
                            "control",
                            "Try/Catch",
                            config={
                                "values": {
                                    "enable_catch": True,
                                    "enable_finally": False,
                                }
                            },
                        ),
                        self._make_workflow_node("nTry", "log", "plugin", "TryNode"),
                        self._make_workflow_node("nCatch", "log", "plugin", "CatchNode"),
                        self._make_workflow_node("nThen", "log", "plugin", "Then"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "tc-1"},
                        {"id": "e2", "source": "tc-1", "target": "nTry", "sourceHandle": "try"},
                        {"id": "e3", "source": "tc-1", "target": "nCatch", "sourceHandle": "catch"},
                        {"id": "e4", "source": "tc-1", "target": "nThen", "sourceHandle": "then"},
                        # VIOLATION: try-path node connects to catch-path node
                        {"id": "e-cross", "source": "nTry", "target": "nCatch"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert (
            "CROSS_SCOPE_EDGE" in error_codes
        ), f"Expected CROSS_SCOPE_EDGE error for try->catch connection: {result['errors']}"

    def test_validate_test_cross_scope_edge_message_says_block(self) -> None:
        try_catch = self._make_workflow_node(
            "tc-1",
            "try-catch-finally",
            "control",
            "Try/Catch",
            config={"values": {"enable_catch": True, "enable_finally": False}},
        )
        logs = [
            self._make_workflow_node(node_id, "log", "plugin", label)
            for node_id, label in (("nTry", "TryNode"), ("nCatch", "CatchNode"), ("nThen", "Then"))
        ]
        edges = [
            {"id": "e1", "source": "start-node", "target": "tc-1"},
            {"id": "e2", "source": "tc-1", "target": "nTry", "sourceHandle": "try"},
            {"id": "e3", "source": "tc-1", "target": "nCatch", "sourceHandle": "catch"},
            {"id": "e4", "source": "tc-1", "target": "nThen", "sourceHandle": "then"},
            {"id": "e-cross", "source": "nTry", "target": "nCatch"},
        ]

        (message,) = self._error_messages("CROSS_SCOPE_EDGE", [try_catch, *logs], edges)

        assert re.fullmatch(
            r"^Block 'TryNode' cannot connect to 'CatchNode' "
            r"\(cross-scope edge violates try-catch path isolation\)$",
            message,
        )

    def test_validate_test_detects_scope_to_outer_edge(self) -> None:
        """Cross-scope edge: try-path node connecting to outer-flow (then target)."""
        created = _create_test_with_legacy_data(
            {
                "name": "Scope To Outer Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "tc-1",
                            "try-catch-finally",
                            "control",
                            "Try/Catch",
                            config={
                                "values": {
                                    "enable_catch": True,
                                    "enable_finally": False,
                                }
                            },
                        ),
                        self._make_workflow_node("nTry", "log", "plugin", "TryNode"),
                        self._make_workflow_node("nCatch", "log", "plugin", "CatchNode"),
                        self._make_workflow_node("nThen", "log", "plugin", "Then"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "tc-1"},
                        {"id": "e2", "source": "tc-1", "target": "nTry", "sourceHandle": "try"},
                        {"id": "e3", "source": "tc-1", "target": "nCatch", "sourceHandle": "catch"},
                        {"id": "e4", "source": "tc-1", "target": "nThen", "sourceHandle": "then"},
                        # VIOLATION: try-path node connects to outer flow node
                        {"id": "e-leak", "source": "nTry", "target": "nThen"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert (
            "CROSS_SCOPE_EDGE" in error_codes
        ), f"Expected CROSS_SCOPE_EDGE for try->outer connection: {result['errors']}"

    def test_validate_test_detects_outer_to_inner_edge(self) -> None:
        """Then-path (outer flow) node connecting INTO try-path is rejected."""
        created = _create_test_with_legacy_data(
            {
                "name": "Outer To Inner Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "tc-1",
                            "try-catch-finally",
                            "control",
                            "Try/Catch",
                            config={
                                "values": {
                                    "enable_catch": True,
                                    "enable_finally": False,
                                }
                            },
                        ),
                        self._make_workflow_node("nTry", "log", "plugin", "TryNode"),
                        self._make_workflow_node("nCatch", "log", "plugin", "CatchNode"),
                        self._make_workflow_node("nThen", "log", "plugin", "ThenNode"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "tc-1"},
                        {"id": "e2", "source": "tc-1", "target": "nTry", "sourceHandle": "try"},
                        {"id": "e3", "source": "tc-1", "target": "nCatch", "sourceHandle": "catch"},
                        {"id": "e4", "source": "tc-1", "target": "nThen", "sourceHandle": "then"},
                        # VIOLATION: then-path (outer flow) node connects INTO try-path
                        {"id": "e-intrude", "source": "nThen", "target": "nTry"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert (
            "CROSS_SCOPE_EDGE" in error_codes
        ), f"Expected CROSS_SCOPE_EDGE for then->try intrusion: {result['errors']}"

    def test_validate_test_allows_intra_scope_edges(self) -> None:
        """Edges within the same try-catch path are allowed."""
        created = _create_test_with_legacy_data(
            {
                "name": "Intra Scope Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "tc-1",
                            "try-catch-finally",
                            "control",
                            "Try/Catch",
                            config={
                                "values": {
                                    "enable_catch": True,
                                    "enable_finally": False,
                                }
                            },
                        ),
                        self._make_workflow_node("nTry1", "log", "plugin", "Try1"),
                        self._make_workflow_node("nTry2", "log", "plugin", "Try2"),
                        self._make_workflow_node("nCatch", "log", "plugin", "Catch"),
                        self._make_workflow_node("nThen", "log", "plugin", "Then"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "tc-1"},
                        {"id": "e2", "source": "tc-1", "target": "nTry1", "sourceHandle": "try"},
                        # VALID: try-path node connects to another try-path node (same scope)
                        {"id": "e-intra", "source": "nTry1", "target": "nTry2"},
                        {"id": "e3", "source": "tc-1", "target": "nCatch", "sourceHandle": "catch"},
                        {"id": "e4", "source": "tc-1", "target": "nThen", "sourceHandle": "then"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert (
            "CROSS_SCOPE_EDGE" not in error_codes
        ), f"Intra-scope edges should be allowed: {result['errors']}"

    def test_validate_test_detects_multiple_errors(self) -> None:
        """Test that multiple errors across multiple nodes are all reported."""
        created = _create_test_with_legacy_data(
            {
                "name": "Multi Error Test",
                "variables": {
                    "bad-name": {"type": "string", "value": "val"},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "variable-setter",
                            "plugin",
                            "Mismatched",
                        ),
                        {
                            "id": "node-2",
                            "type": "custom-bad",
                            "position": {"x": 0, "y": 0},
                        },
                    ],
                    "edges": [
                        {"id": "e1", "source": "node-1", "target": "gone"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        # Should have: NODE_TYPE_MISMATCH, INVALID_NODE_TYPE, DANGLING_EDGE, INVALID_VARIABLE
        assert "NODE_TYPE_MISMATCH" in error_codes
        assert "INVALID_NODE_TYPE" in error_codes
        assert "DANGLING_EDGE" in error_codes
        assert "INVALID_VARIABLE" in error_codes

    def test_validate_test_detects_cycles(self) -> None:
        """Test that validation detects cycles in workflow."""
        created = _create_test_with_legacy_data(
            {
                "name": "Cyclic Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("a", "variable-setter", "control", "A"),
                        self._make_workflow_node(
                            "b",
                            "log",
                            "plugin",
                            "B",
                            config={"values": {"message": "hi"}},
                        ),
                    ],
                    "edges": [
                        {"id": "e1", "source": "a", "target": "b"},
                        {"id": "e2", "source": "b", "target": "a"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is True
        error_codes = [e["code"] for e in result["errors"]]
        assert "CYCLE_DETECTED" in error_codes

    def test_validate_test_returns_none_when_not_found(self) -> None:
        """Test that validate returns None when test not found."""
        result = test_service.validate_test("nonexistent-id")

        assert result is None

    def test_validate_test_empty_workflow_is_valid(self) -> None:
        """Test that empty workflow (no nodes) is valid - new tests start empty."""
        created = _create_test_with_legacy_data(
            {
                "name": "Empty Workflow Test",
                "workflow": {"nodes": [], "edges": []},
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

    def test_validate_test_invalid_nodes_type(self) -> None:
        """Test that non-list nodes produces INVALID_NODES error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Bad Nodes Test",
                "workflow": {"nodes": [], "edges": []},
            }
        )
        # Manually corrupt nodes to a non-list type
        test_service._update_raw_test(
            created["id"], {"workflow": {"nodes": "not-a-list", "edges": []}}
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is True
        error_codes = [e["code"] for e in result["errors"]]
        assert "INVALID_NODES" in error_codes

    def test_validate_test_invalid_nodes_message_says_blocks(self) -> None:
        created = _create_test_with_legacy_data({"name": "Bad Nodes Wording"})
        test_service._update_raw_test(
            created["id"], {"workflow": {"nodes": "not-a-list", "edges": []}}
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        (message,) = [e["message"] for e in result["errors"] if e["code"] == "INVALID_NODES"]
        assert re.fullmatch(r"^Workflow blocks must be an array$", message)

    def test_validate_test_error_structure(self) -> None:
        """Test that error objects have the expected structure."""
        created = _create_test_with_legacy_data(
            {
                "name": "Structure Test",
                "workflow": {
                    "nodes": [
                        {"id": "bad", "type": "custom-invalid", "position": {"x": 0, "y": 0}},
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) > 0

        error = result["errors"][0]
        # Validate error structure has all expected keys
        assert "path" in error
        assert "node_id" in error
        assert "node_label" in error
        assert "element_type" in error
        assert "code" in error
        assert "message" in error
        assert "severity" in error
        assert "fix_action" in error

    def test_validate_test_missing_label(self) -> None:
        """Test that missing node label is detected."""
        created = _create_test_with_legacy_data(
            {
                "name": "No Label Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_LABEL" in error_codes

    @pytest.mark.parametrize("label", ["", "   "], ids=["empty", "blank"])
    def test_validate_test_missing_label_message_says_block_must_have_a_name(
        self, label: str
    ) -> None:
        node = self._make_workflow_node(label=label)

        (message,) = self._error_messages("MISSING_LABEL", [node])

        assert re.fullmatch(r"^Block must have a name$", message)

    def test_validate_test_missing_label_fix_action_says_name_and_block_type(self) -> None:
        (error,) = self._errors_of("MISSING_LABEL", [self._make_workflow_node(label="")])

        assert re.fullmatch(r"^Generate a name from the block type$", error["fix_action"])

    def test_validate_test_missing_element_type(self) -> None:
        """Test that missing elementType is detected."""
        created = _create_test_with_legacy_data(
            {
                "name": "No Block Type Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "No Block Type",
                                "config": {"values": {}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_BLOCK_TYPE" in error_codes

    def test_validate_test_missing_element_type_message_says_block(self) -> None:
        node = self._make_workflow_node()
        del node["data"]["elementType"]

        (message,) = self._error_messages("MISSING_BLOCK_TYPE", [node])

        assert re.fullmatch(r"^Block must have an elementType$", message)

    def test_validate_test_missing_element_type_fix_action_says_block(self) -> None:
        node = self._make_workflow_node()
        del node["data"]["elementType"]

        (error,) = self._errors_of("MISSING_BLOCK_TYPE", [node])

        assert re.fullmatch(r"^Remove block \(type unknown\)$", error["fix_action"])

    def test_validate_test_plugin_param_validation(self) -> None:
        """Test that registered plugin parameters are validated."""
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        clear_registry()
        register_plugin(LogPlugin())

        created = _create_test_with_legacy_data(
            {
                "name": "Plugin Param Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "log",
                            "plugin",
                            "Log Node",
                            config={"values": {}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0
        warning_codes = [w["code"] for w in result["warnings"]]
        assert "REQUIRED_PARAM_MISSING" in warning_codes
        missing_warn = next(w for w in result["warnings"] if w["code"] == "REQUIRED_PARAM_MISSING")
        assert "message" in missing_warn["message"]

        clear_registry()

    def test_validate_test_unregistered_plugin_skips_param_validation(self) -> None:
        """Test that unregistered but known plugin IDs skip param validation."""
        from wavecore.core.plugin_registry import clear_registry

        clear_registry()

        created = _create_test_with_legacy_data(
            {
                "name": "Unregistered Plugin Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "ssh-session-script",
                            "plugin",
                            "SSH Node",
                            config={"values": {}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        # Should have no errors/warnings since ssh-session-script is known but not registered
        assert result["fatal"] is False
        assert len(result["errors"]) == 0
        assert len(result["warnings"]) == 0

    def test_validate_test_invalid_position_values(self) -> None:
        """Test that non-numeric position values produce INVALID_POSITION error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Bad Position Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": "abc", "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Bad Pos",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "INVALID_POSITION" in error_codes

    def test_validate_test_invalid_position_message_says_block(self) -> None:
        node = self._make_workflow_node(position={"x": "abc", "y": 200})

        (message,) = self._error_messages("INVALID_POSITION", [node])

        assert re.fullmatch(r"^Block position x and y must be numeric$", message)

    def test_validate_test_dangling_edge_source(self) -> None:
        """Test that edge with non-existent source produces DANGLING_EDGE."""
        created = _create_test_with_legacy_data(
            {
                "name": "Dangling Source Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                    ],
                    "edges": [
                        {"id": "e1", "source": "ghost", "target": "node-1"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "DANGLING_EDGE" in error_codes

    def test_validate_test_dangling_edge_source_message_says_block(self) -> None:
        edges = [{"id": "e1", "source": "ghost", "target": "node-1"}]

        (message,) = self._error_messages("DANGLING_EDGE", [self._make_workflow_node()], edges)

        assert re.fullmatch(r"^Edge source 'ghost' references non-existent block$", message)

    def test_validate_test_valid_variables_pass(self) -> None:
        """Test that valid variables pass validation."""
        created = _create_test_with_legacy_data(
            {
                "name": "Valid Variables Test",
                "variables": {
                    "my_var": {"type": "string", "scope": "test", "value": "hello"},
                    "count": {"type": "integer", "scope": "test", "value": 0},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

    def test_validate_test_missing_workflow(self) -> None:
        """Test that test with no workflow produces MISSING_WORKFLOW error."""
        created = _create_test_with_legacy_data(
            {
                "name": "No Workflow Test",
            }
        )
        # Manually remove workflow from stored test
        test_service._update_raw_test(created["id"], {"workflow": None})

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is True
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_WORKFLOW" in error_codes

    def test_validate_test_invalid_edges_type(self) -> None:
        """Test that non-list edges are silently treated as empty (no error)."""
        created = _create_test_with_legacy_data(
            {
                "name": "Bad Edges Test",
                "variables": {"my_var": {"type": "string", "value": ""}},
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                    ],
                    "edges": "not-a-list",
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

    def test_validate_test_missing_node_id(self) -> None:
        """Test that node without ID produces MISSING_NODE_ID error."""
        created = _create_test_with_legacy_data(
            {
                "name": "No Node ID Test",
                "workflow": {
                    "nodes": [
                        {
                            "type": "workflowNode",
                            "position": {"x": 0, "y": 0},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "label": "No ID",
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_NODE_ID" in error_codes

    def test_validate_test_missing_node_id_message_says_block(self) -> None:
        node = self._make_workflow_node()
        del node["id"]

        (message,) = self._error_messages("MISSING_NODE_ID", [node])

        assert re.fullmatch(r"^Block must have a non-empty string ID$", message)

    def test_validate_test_duplicate_node_id(self) -> None:
        """Duplicate node ids in a workflow must be rejected.

        Node ids are the load-bearing key for block_states, log
        attribution, breakpoints, and React Flow rendering.
        """
        created = _create_test_with_legacy_data(
            {
                "name": "Dup Node ID Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("same-id", "variable-setter", "First"),
                        self._make_workflow_node("same-id", "variable-setter", "Second"),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "DUPLICATE_NODE_ID" in error_codes
        # The duplicate error should also carry the offending node id so the
        # UI can highlight the exact collision, not just report a generic fail.
        dup_entry = next(e for e in result["errors"] if e["code"] == "DUPLICATE_NODE_ID")
        assert dup_entry.get("node_id") == "same-id"

    def test_validate_test_duplicate_node_id_message_says_block(self) -> None:
        nodes = [self._make_workflow_node("same-id"), self._make_workflow_node("same-id")]

        (message,) = self._error_messages("DUPLICATE_NODE_ID", nodes)

        assert re.fullmatch(r"^Block ID 'same-id' is used by more than one block$", message)

    def test_validate_test_duplicate_node_id_fix_action_says_block(self) -> None:
        nodes = [self._make_workflow_node("same-id"), self._make_workflow_node("same-id")]

        (error,) = self._errors_of("DUPLICATE_NODE_ID", nodes)

        assert re.fullmatch(r"^Assign unique IDs to every block$", error["fix_action"])

    def test_validate_test_invalid_version(self) -> None:
        """Test that invalid semver version produces INVALID_VERSION error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Bad Version Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "variable-setter",
                            "control",
                            "Bad Ver",
                            version="not-semver",
                            config={"values": {"variables": {"x": 1}}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "INVALID_VERSION" in error_codes

    def test_validate_test_cycle_in_disconnected_component(self) -> None:
        """Test cycle detection in a disconnected graph component."""
        created = _create_test_with_legacy_data(
            {
                "name": "Disconnected Cycle Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1", "variable-setter", "control", "First"),
                        self._make_workflow_node(
                            "c1",
                            "log",
                            "plugin",
                            "Cycle1",
                            config={"values": {"message": "hi"}},
                        ),
                        self._make_workflow_node(
                            "c2",
                            "log",
                            "plugin",
                            "Cycle2",
                            config={"values": {"message": "hi"}},
                        ),
                    ],
                    "edges": [
                        {"id": "e1", "source": "c1", "target": "c2"},
                        {"id": "e2", "source": "c2", "target": "c1"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is True
        error_codes = [e["code"] for e in result["errors"]]
        assert "CYCLE_DETECTED" in error_codes

    def test_validate_test_control_version_not_registered(self) -> None:
        """Test that control with unregistered version skips param validation."""
        created = _create_test_with_legacy_data(
            {
                "name": "Unregistered Version Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "variable-setter",
                            "control",
                            "Old Ver",
                            version="99.0.0",
                            config={"values": {}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        # Should still be valid since we can't validate params for unknown version
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

    def test_validate_test_plugin_empty_required_param(self) -> None:
        """Test that registered plugin with empty required param produces REQUIRED_PARAM_EMPTY."""
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        clear_registry()
        register_plugin(LogPlugin())

        created = _create_test_with_legacy_data(
            {
                "name": "Plugin Empty Param Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "log",
                            "plugin",
                            "Log Node",
                            config={"values": {"message": "   "}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0
        warning_codes = [w["code"] for w in result["warnings"]]
        assert "REQUIRED_PARAM_EMPTY" in warning_codes

        clear_registry()

    def test_validate_test_non_string_any_type_value(self) -> None:
        """Test that non-string value for 'any' type param is considered non-empty."""
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        clear_registry()
        register_plugin(LogPlugin())

        created = _create_test_with_legacy_data(
            {
                "name": "Non-String Any Type Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "log",
                            "plugin",
                            "Log Node",
                            config={"values": {"message": 42}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

        clear_registry()

    def test_validate_test_plugin_required_param_with_default_not_flagged(self) -> None:
        """Test that plugin required param with non-None default is not flagged."""
        from wavecore.api.services.tests.service import _ReportSite, _validate_block_params
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.base import PluginBase

        class MockPlugin(PluginBase):
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": "mock-test-plugin",
                    "name": "Mock Test Plugin",
                    "version": "1.0.0",
                    "category": "system",
                    "description": "Mock plugin for testing",
                    "parameters": [
                        {
                            "name": "required_with_default",
                            "type": "string",
                            "required": True,
                            "default": "fallback",
                        },
                    ],
                    "return_type": None,
                    "output_schema": [],
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        clear_registry()
        register_plugin(MockPlugin())

        errors: list[dict[str, Any]] = []

        def add_error(**kwargs: Any) -> None:
            errors.append(kwargs)

        _validate_block_params(
            site=_ReportSite(
                "nodes[0]", "test-node", "Test", "mock-test-plugin", "load", add_error, add_error
            ),
            control=False,
            version="1.0.0",
            values={},  # Missing param, but it has a default
            disabled=False,
        )
        # Should NOT produce an error since the required param has a default
        assert len(errors) == 0

        clear_registry()

    def test_validate_test_control_with_only_optional_params(self) -> None:
        """Test that control with all optional params passes validation."""
        created = _create_test_with_legacy_data(
            {
                "name": "Optional Params Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "try-catch-finally",
                            "control",
                            "Try/Catch",
                            config={"values": {}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

    def test_validate_test_control_required_param_provided(self) -> None:
        """Test that required param with a provided value passes validation."""
        created = _create_test_with_legacy_data(
            {
                "name": "Param Provided Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            "delay",
                            "control",
                            "Wait",
                            config={"values": {"duration": 1000}},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

    def test_validate_test_required_param_with_default_not_flagged(self) -> None:
        """Test that required param with non-None default is not flagged when value is None."""
        from wavecore.api.services.tests.service import _ReportSite, _validate_block_params
        from wavecore.controls.registry import _registry
        from wavecore.models.enums import ControlId

        errors: list[dict[str, Any]] = []

        def add_error(**kwargs: Any) -> None:
            errors.append(kwargs)

        # Create a mock control with dict-based param schema (required + default)
        # ControlParameter disallows required=True with default, but dict schemas
        # don't have that restriction, and the code supports both.
        class DictSchemaControl:
            @property
            def metadata(self) -> dict[str, Any]:
                return {
                    "id": ControlId.DELAY,
                    "version": "99.0.0",
                    "name": "Mock",
                    "description": "Mock control",
                    "category": "timing",
                    "icon_name": "clock",
                    "parameter_schema": [
                        {
                            "name": "test_param",
                            "type": "string",
                            "required": True,
                            "default": "default_value",
                        },
                    ],
                    "structure_hints": {"type": "sequential"},
                }

            async def execute(self, context: dict[str, Any]) -> Any:
                return None

            async def validate(self, params: dict[str, Any]) -> None:
                pass

        _registry._implementations.setdefault(ControlId.DELAY, {})
        _registry._implementations[ControlId.DELAY]["99.0.0"] = DictSchemaControl

        try:
            _validate_block_params(
                site=_ReportSite(
                    "nodes[0]", "test-node", "Test", "delay", "load", add_error, add_error
                ),
                control=True,
                version="99.0.0",
                values={},  # Missing param, but it has a default
                disabled=False,
            )
            # Should NOT produce an error because required param has a default
            assert len(errors) == 0
        finally:
            del _registry._implementations[ControlId.DELAY]["99.0.0"]

    def test_validate_test_non_dict_variable_info(self) -> None:
        """Test that non-dict variable info is handled (skips type/scope check)."""
        created = _create_test_with_legacy_data(
            {
                "name": "Non-Dict Var Test",
                "variables": {
                    "simple_var": "just_a_string_value",
                    "my_var": {"type": "string", "value": ""},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node("node-1"),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        # valid_var name is valid so no name error
        assert result["fatal"] is False
        assert len(result["errors"]) == 0

    def test_validate_detects_undeclared_variable_in_output_binding(self) -> None:
        """Test that variable in outputBinding but not in variables dict is detected."""
        created = _create_test_with_legacy_data(
            {
                "name": "Undeclared OutputBinding Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            element_type="http-client",
                            node_type="plugin",
                            label="HTTP Request",
                            config={
                                "values": {"url": "http://example.com", "method": "GET"},
                                "outputBindings": {"status_code": "my_status"},
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "UNDECLARED_VARIABLE" in error_codes
        undeclared_err = next(e for e in result["errors"] if e["code"] == "UNDECLARED_VARIABLE")
        assert "my_status" in undeclared_err["message"]
        assert undeclared_err["path"] == "variables.my_status"

    def test_validate_detects_undeclared_variable_in_a_template_field(self) -> None:
        """A '{{ }}' marker names a variable exactly as an expression does."""
        created = _create_test_with_legacy_data(
            {
                "name": "Undeclared Template Var Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            element_type="log",
                            node_type="plugin",
                            label="Log",
                            config={"values": {"message": "value is {{ ghost_var }} end"}},
                            data_extras={"templateFields": ["message"]},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        undeclared = next(e for e in result["errors"] if e["code"] == "UNDECLARED_VARIABLE")
        assert "ghost_var" in undeclared["message"]
        assert undeclared["path"] == "variables.ghost_var"

    def test_validate_accepts_a_declared_variable_in_a_template_field(self) -> None:
        created = _create_test_with_legacy_data(
            {
                "name": "Declared Template Var Test",
                "variables": {"known": {"type": "string", "value": "x"}},
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            element_type="log",
                            node_type="plugin",
                            label="Log",
                            config={"values": {"message": "value is {{ known }} end"}},
                            data_extras={"templateFields": ["message"]},
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert "UNDECLARED_VARIABLE" not in [e["code"] for e in result["errors"]]

    def test_validate_detects_binding_targeting_namespace_prefix(self) -> None:
        """Test that outputBinding targeting system.timeout produces namespace error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Binding Namespace Prefix Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            element_type="http-client",
                            node_type="plugin",
                            label="HTTP Request",
                            config={
                                "values": {"url": "http://example.com", "method": "GET"},
                                "outputBindings": {"status_code": "system.timeout"},
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "BINDING_TARGETS_NAMESPACE_VARIABLE" in error_codes
        assert "UNDECLARED_VARIABLE" not in error_codes
        ns_err = next(
            e for e in result["errors"] if e["code"] == "BINDING_TARGETS_NAMESPACE_VARIABLE"
        )
        assert "system.timeout" in ns_err["message"]
        assert "system" in ns_err["message"]
        assert ns_err["path"] == "variables.system.timeout"

    def test_validate_detects_binding_targeting_bare_namespace(self) -> None:
        """Test that outputBinding targeting bare 'system' produces namespace error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Binding Bare Namespace Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            element_type="http-client",
                            node_type="plugin",
                            label="HTTP Request",
                            config={
                                "values": {"url": "http://example.com", "method": "GET"},
                                "outputBindings": {"response_body": "system"},
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "BINDING_TARGETS_NAMESPACE_VARIABLE" in error_codes
        ns_err = next(
            e for e in result["errors"] if e["code"] == "BINDING_TARGETS_NAMESPACE_VARIABLE"
        )
        assert "system" in ns_err["message"]

    def test_validate_detects_binding_targeting_suite_and_regression(self) -> None:
        """Test that outputBindings targeting suite.x and regression.y produce errors."""
        created = _create_test_with_legacy_data(
            {
                "name": "Binding Suite Regression Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            element_type="http-client",
                            node_type="plugin",
                            label="HTTP 1",
                            config={
                                "values": {"url": "http://example.com", "method": "GET"},
                                "outputBindings": {"status_code": "suite.name"},
                            },
                        ),
                        self._make_workflow_node(
                            "node-2",
                            element_type="http-client",
                            node_type="plugin",
                            label="HTTP 2",
                            config={
                                "values": {"url": "http://example.com", "method": "GET"},
                                "outputBindings": {"response_body": "regression.version"},
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        ns_errors = [
            e for e in result["errors"] if e["code"] == "BINDING_TARGETS_NAMESPACE_VARIABLE"
        ]
        assert len(ns_errors) == 2
        targets = {e["path"] for e in ns_errors}
        assert "variables.suite.name" in targets
        assert "variables.regression.version" in targets

    def test_validate_detects_undeclared_variable_in_expression(self) -> None:
        """Test that variable in expression field but not in variables dict is detected."""
        created = _create_test_with_legacy_data(
            {
                "name": "Undeclared Expression Test",
                "variables": {
                    "declared_var": {"type": "string", "value": ""},
                    "my_var": {"type": "string", "value": ""},
                    "x": {"type": "string", "value": ""},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            config={
                                "values": {
                                    "variables": {"my_var": "hello"},
                                    "condition": "undeclared_var > 10",
                                },
                            },
                        ),
                        {
                            "id": "node-2",
                            "type": "workflowNode",
                            "position": {"x": 200, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Check Expr",
                                "expressionFields": ["condition"],
                                "config": {
                                    "values": {
                                        "variables": {"x": "1"},
                                        "condition": "undeclared_var > 10",
                                    },
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "UNDECLARED_VARIABLE" in error_codes
        undeclared_err = next(e for e in result["errors"] if e["code"] == "UNDECLARED_VARIABLE")
        assert "undeclared_var" in undeclared_err["message"]

    def test_validate_undeclared_variable_deduplicated(self) -> None:
        """Test that same undeclared var used in 3 nodes produces 1 error."""
        nodes = []
        for i in range(3):
            nodes.append(
                {
                    "id": f"node-{i}",
                    "type": "workflowNode",
                    "position": {"x": i * 100, "y": 200},
                    "data": {
                        "elementType": "variable-setter",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "label": f"Setter {i}",
                        "config": {
                            "values": {"variables": {"x": "1"}},
                            "outputBindings": {"some_output": "shared_var"},
                        },
                    },
                }
            )

        created = _create_test_with_legacy_data(
            {
                "name": "Dedup Test",
                "variables": {},
                "workflow": {"nodes": nodes, "edges": []},
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        undeclared_errors = [
            e
            for e in result["errors"]
            if e["code"] == "UNDECLARED_VARIABLE" and "shared_var" in e["message"]
        ]
        assert len(undeclared_errors) == 1
        assert "3 block(s)" in undeclared_errors[0]["message"]

    def test_validate_detects_undeclared_variable_in_setter_target(self) -> None:
        """Test that var_setter targeting undeclared variable is detected."""
        created = _create_test_with_legacy_data(
            {
                "name": "Setter Undeclared Target Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        {
                            "id": "setter-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Set Missing",
                                "config": {
                                    "values": {"variables": {"missing_var": "hello"}},
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "UNDECLARED_VARIABLE" in error_codes
        err = next(e for e in result["errors"] if e["code"] == "UNDECLARED_VARIABLE")
        assert "missing_var" in err["message"]

    def test_validate_namespace_keyword_not_flagged_as_undeclared(self) -> None:
        """Namespace keywords (system, suite, regression) should not be flagged as undeclared."""
        created = _create_test_with_legacy_data(
            {
                "name": "Namespace Expression Test",
                "variables": {
                    "result": {"type": "string", "value": ""},
                },
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Use Namespace",
                                "expressionFields": ["condition"],
                                "config": {
                                    "values": {
                                        "variables": {"result": "test"},
                                        "condition": "system.host",
                                    },
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        undeclared_errors = [e for e in result["errors"] if e["code"] == "UNDECLARED_VARIABLE"]
        # "system" should NOT be flagged - it's a namespace keyword
        system_errors = [e for e in undeclared_errors if "system" in e["message"]]
        assert len(system_errors) == 0

    def test_validate_setter_targeting_namespace_variable(self) -> None:
        """Test that var_setter targeting namespace variables produces error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Setter Namespace Target Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        {
                            "id": "setter-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Set System Var",
                                "config": {
                                    "values": {"variables": {"system.timeout": "99"}},
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "SETTER_TARGETS_NAMESPACE_VARIABLE" in error_codes
        err = next(e for e in result["errors"] if e["code"] == "SETTER_TARGETS_NAMESPACE_VARIABLE")
        assert "system.timeout" in err["message"]
        assert "system" in err["message"]

    def test_validate_setter_targeting_bare_reserved_keyword(self) -> None:
        """Test that var_setter targeting bare 'system' keyword produces error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Setter Bare Keyword Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        {
                            "id": "setter-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Set Bare System",
                                "config": {
                                    "values": {"variables": {"system": "bad"}},
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        ns_errors = [
            e for e in result["errors"] if e["code"] == "SETTER_TARGETS_NAMESPACE_VARIABLE"
        ]
        assert len(ns_errors) >= 1
        assert "system" in ns_errors[0]["message"]

    def test_validate_setter_targeting_suite_and_regression_namespace(self) -> None:
        """Test that var_setter targeting suite.x and regression.y produces errors."""
        created = _create_test_with_legacy_data(
            {
                "name": "Setter Suite Reg Namespace Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        {
                            "id": "setter-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Set Namespace Vars",
                                "config": {
                                    "values": {
                                        "variables": {
                                            "suite.x": "val1",
                                            "regression.y": "val2",
                                        }
                                    },
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        ns_errors = [
            e for e in result["errors"] if e["code"] == "SETTER_TARGETS_NAMESPACE_VARIABLE"
        ]
        ns_targets = {e["path"].replace("variables.", "") for e in ns_errors}
        assert "suite.x" in ns_targets
        assert "regression.y" in ns_targets

    def test_validate_setter_targeting_test_scoped_variable_passes(self) -> None:
        """Test that var_setter targeting test-scoped variable produces no error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Setter Test Scoped Test",
                "variables": {
                    "my_var": {"type": "string", "value": "initial"},
                },
                "workflow": {
                    "nodes": [
                        {
                            "id": "setter-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Set Var",
                                "config": {
                                    "values": {"variables": {"my_var": "updated"}},
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        setter_errors = [
            e
            for e in result["errors"]
            if e["code"] in ("SETTER_TARGETS_NAMESPACE_VARIABLE", "UNDECLARED_VARIABLE")
            and "my_var" in e.get("message", "")
        ]
        assert len(setter_errors) == 0

    def test_validate_ignores_words_inside_string_literals(self) -> None:
        """Test that words inside string literals in expressions are not treated as variables."""
        created = _create_test_with_legacy_data(
            {
                "name": "String Literal Expression Test",
                "variables": {
                    "my_var": {"type": "integer", "value": "0"},
                },
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Log",
                                "expressionFields": ["message"],
                                "config": {
                                    "values": {
                                        "message": "'planned=' + str(my_var)",
                                        "level": "INFO",
                                    },
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        # 'planned' is inside a string literal, NOT a variable reference
        assert "UNDECLARED_VARIABLE" not in error_codes

    def test_validate_ignores_fstring_prefix(self) -> None:
        """Test that f-string prefix 'f' is not treated as a variable reference."""
        created = _create_test_with_legacy_data(
            {
                "name": "F-String Prefix Test",
                "variables": {
                    "my_var": {"type": "float", "value": "0.0"},
                },
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Log",
                                "expressionFields": ["message"],
                                "config": {
                                    "values": {
                                        "message": "f'{my_var}'",
                                        "level": "INFO",
                                    },
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        # 'f' is an f-string prefix, NOT a variable reference
        assert "UNDECLARED_VARIABLE" not in error_codes

    def test_validate_ignores_declared_variables(self) -> None:
        """Test that variables that ARE declared produce no UNDECLARED_VARIABLE error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Declared Var Test",
                "variables": {
                    "my_status": {"type": "integer", "value": None},
                },
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "node-1",
                            element_type="http-client",
                            node_type="plugin",
                            label="HTTP Request",
                            config={
                                "values": {"url": "http://example.com", "method": "GET"},
                                "outputBindings": {"status_code": "my_status"},
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "UNDECLARED_VARIABLE" not in error_codes

    def test_validate_ignores_profile_alias_dotted_access(self) -> None:
        """Test that profile alias.field expressions are not flagged as undeclared."""
        created = _create_test_with_legacy_data(
            {
                "name": "Profile Alias Dotted Access Test",
                "variables": {},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "http-client",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "HTTP Client",
                                "expressionFields": ["url"],
                                "config": {
                                    "values": {
                                        "url": "my_srv.url",
                                        "method": "GET",
                                    },
                                    "profileBindings": [
                                        {
                                            "profileId": "prof-1",
                                            "profileName": "My Server",
                                            "profileType": "custom",
                                            "alias": "my_srv",
                                        }
                                    ],
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        # Neither 'my_srv' (profile alias) nor 'url' (attribute) should be flagged
        assert "UNDECLARED_VARIABLE" not in error_codes

    def test_validate_assert_missing_assertion_ids(self) -> None:
        """Test that assert node with assertion items missing IDs produces MISSING_ASSERTION_ID."""
        created = _create_test_with_legacy_data(
            {
                "name": "Assert Missing IDs Test",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "assert-1",
                            "assert",
                            "control",
                            "Assert Node",
                            config={
                                "values": {
                                    "assertions": [
                                        {
                                            "type": "literal",
                                            "variable": "x",
                                            "value_type": "string",
                                            "operator": "equals",
                                            "reference_value": "hello",
                                            "reference_is_expression": False,
                                        },
                                    ],
                                    "mode": "single",
                                }
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_ASSERTION_ID" in error_codes
        # Check fix_action is set
        err = next(e for e in result["errors"] if e["code"] == "MISSING_ASSERTION_ID")
        assert err["fix_action"] == "Generate unique assertion IDs"

    def test_validate_assert_missing_ids_in_nested_groups(self) -> None:
        """Test that assertion items nested in groups without IDs are detected."""
        created = _create_test_with_legacy_data(
            {
                "name": "Assert Nested Missing IDs",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "assert-2",
                            "assert",
                            "control",
                            "Assert Nested",
                            config={
                                "values": {
                                    "assertions": [
                                        {
                                            "id": "lit-1",
                                            "type": "literal",
                                            "variable": "x",
                                            "value_type": "string",
                                            "operator": "equals",
                                            "reference_value": "a",
                                            "reference_is_expression": False,
                                        },
                                        {"type": "operator", "value": "and"},
                                        {
                                            "id": "grp-1",
                                            "type": "group",
                                            "items": [
                                                {
                                                    "type": "literal",
                                                    "variable": "y",
                                                    "value_type": "integer",
                                                    "operator": "equals",
                                                    "reference_value": 5,
                                                    "reference_is_expression": False,
                                                },
                                            ],
                                        },
                                    ],
                                    "mode": "single",
                                }
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_ASSERTION_ID" in error_codes

    def test_validate_assert_with_all_ids_passes(self) -> None:
        """Test that assert node with all assertion IDs present does not produce error."""
        created = _create_test_with_legacy_data(
            {
                "name": "Assert All IDs Present",
                "workflow": {
                    "nodes": [
                        self._make_workflow_node(
                            "assert-3",
                            "assert",
                            "control",
                            "Assert OK",
                            config={
                                "values": {
                                    "assertions": [
                                        {
                                            "id": "lit-1",
                                            "type": "literal",
                                            "variable": "x",
                                            "value_type": "string",
                                            "operator": "equals",
                                            "reference_value": "ok",
                                            "reference_is_expression": False,
                                        },
                                        {"type": "operator", "value": "and"},
                                        {
                                            "id": "expr-1",
                                            "type": "expression",
                                            "expression": "True",
                                        },
                                    ],
                                    "mode": "single",
                                }
                            },
                        ),
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_ASSERTION_ID" not in error_codes

    def test_validate_disabled_assert_skips_assertion_id_check(self) -> None:
        """Test that disabled assert node is not checked for missing assertion IDs."""
        created = _create_test_with_legacy_data(
            {
                "name": "Disabled Assert Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "assert-4",
                            "type": "workflowNode",
                            "position": {"x": 0, "y": 0},
                            "data": {
                                "elementType": "assert",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Disabled Assert",
                                "disabled": True,
                                "config": {
                                    "values": {
                                        "assertions": [
                                            {"type": "literal", "variable": "x"},
                                        ],
                                        "mode": "single",
                                    }
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        error_codes = [e["code"] for e in result["errors"]]
        assert "MISSING_ASSERTION_ID" not in error_codes


class TestSetterValidationEdgeCases:
    """Tests for edge cases in variable-setter validation."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_setter_with_non_dict_variables_skips_validation(self) -> None:
        """Test that non-dict setter variables value is safely skipped."""
        created = _create_test_with_legacy_data(
            {
                "name": "Non-Dict Setter Vars",
                "workflow": {
                    "nodes": [
                        {
                            "id": "setter-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Bad Setter",
                                "config": {"values": {"variables": "not-a-dict"}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        setter_errors = [
            e for e in result["errors"] if e["code"] == "SETTER_TARGETS_NAMESPACE_VARIABLE"
        ]
        assert len(setter_errors) == 0

    def test_setter_with_empty_target_name_skips_validation(self) -> None:
        """Test that empty string target name in setter is safely skipped."""
        created = _create_test_with_legacy_data(
            {
                "name": "Empty Target Name",
                "variables": {"real_var": {"type": "string", "value": "x"}},
                "workflow": {
                    "nodes": [
                        {
                            "id": "setter-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Empty Name Setter",
                                "config": {
                                    "values": {"variables": {"": "some_val", "real_var": "updated"}}
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        # Empty name should not produce SETTER_TARGETS_NAMESPACE_VARIABLE
        setter_errors = [
            e
            for e in result["errors"]
            if e["code"] == "SETTER_TARGETS_NAMESPACE_VARIABLE" and "''" in e.get("message", "")
        ]
        assert len(setter_errors) == 0


class TestSetterExpressionRowSaveCheck:
    """An empty Variable Setter expression row is a save-check issue; an empty text row is a
    value and is not one (REQ-3.1.3.21, REQ-3.4.3.8)."""

    def setup_method(self) -> None:
        """Reset test storage and register controls before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls

        _registry.clear()
        register_all_core_controls(_registry)

    @staticmethod
    def _setter_test(name: str, rows: dict[str, Any], expression_keys: list[str]) -> dict[str, Any]:
        return {
            "name": name,
            "variables": {
                "count": {"type": "integer", "value": 0},
                "note": {"type": "string", "value": "x"},
            },
            "workflow": {
                "nodes": [
                    {
                        "id": "setter-1",
                        "type": "workflowNode",
                        "position": {"x": 100, "y": 200},
                        "data": {
                            "elementType": "variable-setter",
                            "nodeType": "control",
                            "version": "1.0.0",
                            "label": "Set Count",
                            "config": {"values": {"variables": rows}},
                            "variableExpressionKeys": expression_keys,
                        },
                    }
                ],
                "edges": [],
            },
        }

    @pytest.mark.parametrize(
        "expression",
        [
            pytest.param("", id="empty-text"),
            pytest.param("   ", id="spaces-only"),
            pytest.param(None, id="stored-null"),
        ],
    )
    def test_an_empty_expression_row_is_a_save_check_issue(self, expression: str | None) -> None:
        data = self._setter_test(
            "Empty Expression Row", {"count": expression, "note": ""}, ["count"]
        )

        errors = test_service.validate_test_data_for_create(data)

        assert [
            (e["code"], e["message"], e["severity"], e["node_id"], e["node_label"]) for e in errors
        ] == [("REQUIRED_PARAM_EMPTY", "Expression is required", "error", "setter-1", "Set Count")]
        assert errors[0]["element_type"] == "variable-setter"

    def test_saving_an_empty_expression_row_is_refused(self) -> None:
        from wavecore.api.services.tests.service import SaveValidationError

        data = self._setter_test("Refused Expression Row", {"count": ""}, ["count"])

        with pytest.raises(SaveValidationError) as exc_info:
            test_service.create_test(data)

        assert [(e["code"], e["message"]) for e in exc_info.value.errors] == [
            ("REQUIRED_PARAM_EMPTY", "Expression is required")
        ]
        assert [t["name"] for t in test_service._list_all_tests()] == []

    @pytest.mark.parametrize(
        ("rows", "expression_keys"),
        [
            pytest.param({"note": ""}, [], id="empty-text-row"),
            pytest.param({"count": None}, [], id="literal-null-row"),
            pytest.param({"count": "1 + 1"}, ["count"], id="filled-expression-row"),
            pytest.param({"count": "None"}, ["count"], id="expression-that-gives-null"),
        ],
    )
    def test_a_row_with_a_value_is_not_an_issue(
        self, rows: dict[str, Any], expression_keys: list[str]
    ) -> None:
        data = self._setter_test("Row With A Value", rows, expression_keys)

        assert test_service.validate_test_data_for_create(data) == []


class TestDisabledElementValidation:
    """Tests for disabled element exclusion in validation."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_disabled_control_skips_required_param_check(self) -> None:
        """Test that disabled control nodes skip required param validation."""
        created = test_service.create_test(
            {
                "name": "Disabled Control Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Disabled Setter",
                                "disabled": True,
                                "config": {"values": {}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0
        assert len(result["warnings"]) == 0

    def test_disabled_plugin_skips_required_param_check(self) -> None:
        """Test that disabled plugin nodes skip required param validation."""
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        clear_registry()
        register_plugin(LogPlugin())

        created = test_service.create_test(
            {
                "name": "Disabled Plugin Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Disabled Log",
                                "disabled": True,
                                "config": {"values": {}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        assert result["fatal"] is False
        assert len(result["errors"]) == 0
        assert len(result["warnings"]) == 0

        clear_registry()


class TestRunContextValidation:
    """Tests for run context validation behavior."""

    def setup_method(self) -> None:
        """Reset test storage and register controls before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls

        _registry.clear()
        register_all_core_controls(_registry)

    def test_run_context_escalates_required_param_missing_to_error(self) -> None:
        """Test that REQUIRED_PARAM_MISSING becomes an error on run context."""
        created = _create_test_with_legacy_data(
            {
                "name": "Run Context Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Missing Param",
                                "config": {"values": {}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"], context="run")

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "REQUIRED_PARAM_MISSING" in error_codes
        assert len(result["warnings"]) == 0

    def test_run_context_escalates_required_param_empty_to_error(self) -> None:
        """Test that REQUIRED_PARAM_EMPTY becomes an error on run context."""
        created = _create_test_with_legacy_data(
            {
                "name": "Run Context Empty Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Empty Param",
                                "config": {"values": {"variables": {}}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.validate_test(created["id"], context="run")

        assert result is not None
        assert result["fatal"] is False
        error_codes = [e["code"] for e in result["errors"]]
        assert "REQUIRED_PARAM_EMPTY" in error_codes
        assert len(result["warnings"]) == 0


class TestValidateUnsavedTest:
    """Unsaved workflow and variables validate as the run of an edited canvas sees them."""

    def setup_method(self) -> None:
        """Reset test storage and register controls before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls

        _registry.clear()
        register_all_core_controls(_registry)

    @staticmethod
    def _delay_reading(variable: str) -> dict[str, Any]:
        """A Delay whose duration is an expression reading the variable."""
        return {
            "id": "delay-1",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "elementType": "delay",
                "nodeType": "control",
                "version": "1.0.0",
                "label": "Delay",
                "expressionFields": ["duration"],
                "config": {"values": {"duration": variable}},
            },
        }

    def _stored_pause_test(self) -> str:
        """A stored test whose Delay reads the integer variable pause_ms it declares."""
        created = _create_test_with_legacy_data(
            {
                "name": "Pause",
                "variables": {"pause_ms": {"type": "integer", "value": 5}},
                "workflow": {"nodes": [self._delay_reading("pause_ms")], "edges": []},
            }
        )
        return str(created["id"])

    @staticmethod
    def _undeclared(result: dict[str, Any] | None) -> list[tuple[str, str]]:
        assert result is not None
        return [
            (entry["path"], entry["fix_action"])
            for entry in result["errors"]
            if entry["code"] == "UNDECLARED_VARIABLE"
        ]

    def test_names_the_type_of_a_variable_the_unsaved_variables_no_longer_declare(self) -> None:
        test_id = self._stored_pause_test()

        result = test_service.validate_unsaved_test(
            test_id,
            {"nodes": [self._delay_reading("pause_ms")], "edges": []},
            {},
            context="run",
        )

        assert self._undeclared(result) == [
            ("variables.pause_ms", "Add variable to manager (type: integer)")
        ]
        stored = test_service.validate_test(test_id, context="run")
        assert stored is not None
        assert stored["errors"] == []

    def test_checks_the_unsaved_workflow_against_the_stored_variables(self) -> None:
        test_id = self._stored_pause_test()

        result = test_service.validate_unsaved_test(
            test_id, {"nodes": [self._delay_reading("gap_ms")], "edges": []}, None, context="run"
        )

        assert self._undeclared(result) == [
            ("variables.gap_ms", "Add variable to manager (type: integer)")
        ]

    def test_an_unsaved_body_matching_the_stored_variables_is_clean(self) -> None:
        test_id = self._stored_pause_test()

        result = test_service.validate_unsaved_test(
            test_id, {"nodes": [self._delay_reading("pause_ms")], "edges": []}, None, context="run"
        )

        assert result is not None
        assert result["errors"] == []

    def test_returns_none_for_an_unknown_test(self) -> None:
        assert (
            test_service.validate_unsaved_test(
                str(uuid.uuid4()), {"nodes": [], "edges": []}, None, context="run"
            )
            is None
        )


class TestFixTest:
    """Tests for fix_test service function."""

    def setup_method(self) -> None:
        """Reset test storage and register controls/plugins before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls

        _registry.clear()
        register_all_core_controls(_registry)
        # Register plugins needed for type-consistency checks
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins import LogPlugin

        clear_registry()
        register_plugin(LogPlugin())

    def test_fix_test_returns_none_when_not_found(self) -> None:
        """Test that fix_test returns None when test not found."""
        result = test_service.fix_test("nonexistent-id")
        assert result is None

    def test_fix_test_raises_on_fatal_errors(self) -> None:
        """Test that fix_test raises ValueError on fatal errors."""
        created = test_service.create_test({"name": "Fatal Test"})
        test_service._update_raw_test(created["id"], {"workflow": None})

        with pytest.raises(ValidationException, match="fatal errors"):
            test_service.fix_test(created["id"])

    def test_fix_test_returns_unchanged_when_no_errors(self) -> None:
        """Test that fix_test returns test as-is when no fixable errors."""
        created = test_service.create_test(
            {
                "name": "Clean Test",
                "workflow": {"nodes": [], "edges": []},
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        assert fix_result["test"]["name"] == "Clean Test"
        assert fix_result["warnings"] == []

    def test_fix_test_removes_invalid_node_type(self) -> None:
        """Test that fix_test removes nodes with invalid type."""
        created = test_service.create_test(
            {
                "name": "Bad Node Type Fix",
                "workflow": {
                    "nodes": [
                        {"id": "bad", "type": "custom-invalid", "position": {"x": 0, "y": 0}},
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["nodes"]) == 0

    def test_fix_test_removes_unknown_element_type(self) -> None:
        """Test that fix_test removes nodes with unknown elementType."""
        created = test_service.create_test(
            {
                "name": "Unknown Type Fix",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "nonexistent-plugin",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Bad Plugin",
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["nodes"]) == 0

    def test_fix_test_removes_missing_element_type(self) -> None:
        """Test that fix_test removes nodes with missing elementType."""
        created = test_service.create_test(
            {
                "name": "Missing Type Fix",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "No Type",
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["nodes"]) == 0

    def test_fix_test_removes_node_type_mismatch(self) -> None:
        """Test that fix_test removes nodes with nodeType mismatch."""
        created = test_service.create_test(
            {
                "name": "Mismatch Fix",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Mismatched",
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["nodes"]) == 0

    def test_fix_test_removes_invalid_version(self) -> None:
        """Test that fix_test removes nodes with invalid version."""
        created = test_service.create_test(
            {
                "name": "Bad Version Fix",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "not-semver",
                                "label": "Bad Ver",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["nodes"]) == 0

    def test_fix_test_fixes_missing_position(self) -> None:
        """Test that fix_test adds default position to nodes missing one."""
        created = test_service.create_test(
            {
                "name": "Missing Pos Fix",
                "variables": {"x": {"type": "integer", "value": 0}},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "No Pos",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["nodes"]) == 1
        assert result["workflow"]["nodes"][0]["position"] == {"x": 100, "y": 100}

    def test_fix_test_fixes_invalid_position(self) -> None:
        """Test that fix_test replaces invalid position with default."""
        created = test_service.create_test(
            {
                "name": "Bad Pos Fix",
                "variables": {"x": {"type": "integer", "value": 0}},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": "abc", "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Bad Pos",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert result["workflow"]["nodes"][0]["position"] == {"x": 100, "y": 100}

    def test_fix_test_generates_missing_label(self) -> None:
        """Test that fix_test names the block after its type, as the palette shows it."""
        created = test_service.create_test(
            {
                "name": "Missing Label Fix",
                "variables": {"x": {"type": "integer", "value": 0}},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert result["workflow"]["nodes"][0]["data"]["label"] == "Var Setter"

    def test_fix_test_generates_node_id(self) -> None:
        """Test that fix_test generates ID for nodes missing one."""
        created = _create_test_with_legacy_data(
            {
                "name": "Missing ID Fix",
                "workflow": {
                    "nodes": [
                        {
                            "type": "workflowNode",
                            "position": {"x": 0, "y": 0},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "label": "No ID",
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["nodes"]) == 1
        assert result["workflow"]["nodes"][0]["id"]  # Now has an ID

    def test_fix_test_removes_dangling_edges(self) -> None:
        """Test that fix_test removes edges pointing to non-existent nodes."""
        created = test_service.create_test(
            {
                "name": "Dangling Edge Fix",
                "variables": {"x": {"type": "integer", "value": 0}},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Good Node",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [
                        {"id": "e1", "source": "node-1", "target": "nonexistent"},
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["edges"]) == 0

    def test_fix_test_removes_self_loop_edges(self) -> None:
        """Test that fix_test removes self-loop edges."""
        created = test_service.create_test(
            {
                "name": "Self Loop Fix",
                "variables": {"x": {"type": "integer", "value": 0}},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Self Loop",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                    ],
                    "edges": [
                        {"id": "e1", "source": "node-1", "target": "node-1"},
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["edges"]) == 0

    def test_fix_test_deletes_unused_invalid_variable(self) -> None:
        """Test that fix_test deletes invalid variable not referenced by any node."""
        created = test_service.create_test(
            {
                "name": "Unused Bad Var Fix",
                "variables": {
                    "123-bad": {"type": "string", "value": "val"},
                },
                "workflow": {"nodes": [], "edges": []},
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        variables = result["variables"]
        assert "123-bad" not in variables
        # Variable should be deleted entirely, not renamed
        assert len(variables) == 0

    def test_fix_test_renames_invalid_variable_updates_output_bindings(self) -> None:
        """Test that fix_test renames invalid variable and updates node outputBindings."""
        created = test_service.create_test(
            {
                "name": "Used Bad Var Fix",
                "variables": {
                    "123-bad": {"type": "string", "value": "val"},
                },
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "http-client",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "HTTP Request",
                                "config": {
                                    "values": {"url": "http://example.com"},
                                    "outputBindings": {"status_code": "123-bad"},
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        variables = result["variables"]
        # Variable should be renamed, not deleted
        assert "123-bad" not in variables
        fixed_names = [k for k in variables if k.startswith("fixed_")]
        assert len(fixed_names) == 1
        fixed_name = fixed_names[0]

        # Node's outputBinding should be updated to the new name
        node = result["workflow"]["nodes"][0]
        bindings = node["data"]["config"]["outputBindings"]
        assert bindings["status_code"] == fixed_name

    def test_fix_test_renames_invalid_variable_updates_expression_fields(self) -> None:
        """Test that fix_test renames invalid variable and updates expression references."""
        created = test_service.create_test(
            {
                "name": "Expr Bad Var Fix",
                "variables": {
                    # Starts with digit - invalid but word-boundary matchable
                    "123response": {"type": "string", "value": "val"},
                },
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "http-client",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "HTTP Request",
                                "expressionFields": ["url"],
                                "config": {
                                    "values": {"url": "base_url + 123response"},
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        variables = result["variables"]
        assert "123response" not in variables
        fixed_names = [k for k in variables if k.startswith("fixed_")]
        assert len(fixed_names) == 1
        _fixed_name = fixed_names[0]

        # Expression left unchanged - 123response is not a valid Python identifier,
        # so AST can't find it as a Name node in a compound expression.
        # Only simple (whole-value) references are renamed via exact-match fallback.
        node = result["workflow"]["nodes"][0]
        url_value = node["data"]["config"]["values"]["url"]
        assert url_value == "base_url + 123response"

    def test_fix_test_fixes_invalid_variable_type(self) -> None:
        """Test that fix_test sets invalid variable type to string."""
        created = test_service.create_test(
            {
                "name": "Bad Var Type Fix",
                "variables": {
                    "my_var": {"type": "nonexistent", "value": "val"},
                },
                "workflow": {"nodes": [], "edges": []},
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert result["variables"]["my_var"]["type"] == "string"

    def test_fix_test_renames_type_conflicted_variable(self) -> None:
        """Test that fix_test renames invalid variable even when usages disagree on type."""
        created = test_service.create_test(
            {
                "name": "Type Conflict Var Fix",
                "variables": {
                    # Invalid name (starts with digit), referenced by nodes with conflicting types
                    "9conflict": {"type": "string", "value": "oops"},
                },
                "workflow": {
                    "nodes": [
                        {
                            "id": "n1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "delay",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Delay",
                                "expressionFields": ["duration"],
                                "config": {"values": {"duration": "9conflict"}},
                            },
                        },
                        {
                            "id": "n2",
                            "type": "workflowNode",
                            "position": {"x": 300, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Log",
                                "expressionFields": ["message"],
                                "config": {"values": {"message": "9conflict"}},
                            },
                        },
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "n1"},
                        {"id": "e2", "source": "n1", "target": "n2"},
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        variables = result["variables"]

        # Variable should be renamed (invalid name but used - rename regardless of type conflict)
        assert "9conflict" not in variables
        fixed_names = [k for k in variables if k.startswith("fixed_")]
        assert len(fixed_names) == 1, "Should rename to fixed_XXX"
        fixed_name = fixed_names[0]
        assert variables[fixed_name]["value"] == "oops"

        # Expression references should be updated to the new name
        nodes = result["workflow"]["nodes"]
        n1 = next(n for n in nodes if n["id"] == "n1")
        assert n1["data"]["config"]["values"]["duration"] == fixed_name
        n2 = next(n for n in nodes if n["id"] == "n2")
        assert n2["data"]["config"]["values"]["message"] == fixed_name

    def test_fix_test_removes_connected_edges_when_node_removed(self) -> None:
        """Test that edges connected to removed nodes are also removed."""
        created = test_service.create_test(
            {
                "name": "Connected Edge Fix",
                "variables": {"x": {"type": "integer", "value": 0}},
                "workflow": {
                    "nodes": [
                        {
                            "id": "good",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Good",
                                "config": {"values": {"variables": {"x": 1}}},
                            },
                        },
                        {
                            "id": "bad",
                            "type": "custom-invalid",
                            "position": {"x": 300, "y": 200},
                        },
                    ],
                    "edges": [
                        {"id": "e1", "source": "good", "target": "bad"},
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        result = fix_result["test"]
        assert len(result["workflow"]["nodes"]) == 1
        assert result["workflow"]["nodes"][0]["id"] == "good"
        assert len(result["workflow"]["edges"]) == 0

    def test_fix_test_removes_multiple_edges(self) -> None:
        """Test that fix removes all outgoing/incoming edges for multi-edge nodes."""
        created = test_service.create_test(
            {
                "name": "Multi Edge Fix Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "nA",
                            "type": "workflowNode",
                            "position": {"x": 200, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "A",
                                "version": "1.0.0",
                                "config": {"values": {"message": "a"}},
                            },
                        },
                        {
                            "id": "nB",
                            "type": "workflowNode",
                            "position": {"x": 450, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "B",
                                "version": "1.0.0",
                                "config": {"values": {"message": "b"}},
                            },
                        },
                        {
                            "id": "nC",
                            "type": "workflowNode",
                            "position": {"x": 700, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "C",
                                "version": "1.0.0",
                                "config": {"values": {"message": "c"}},
                            },
                        },
                        {
                            "id": "nD",
                            "type": "workflowNode",
                            "position": {"x": 950, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "D",
                                "version": "1.0.0",
                                "config": {"values": {"message": "d"}},
                            },
                        },
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "nA", "target": "nB"},
                        {"id": "e3", "source": "nB", "target": "nC"},
                        {"id": "e4", "source": "nC", "target": "nD"},
                        {"id": "e5", "source": "nA", "target": "nC"},
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])
        assert fix_result is not None
        fixed_edges = fix_result["test"]["workflow"]["edges"]
        edge_pairs = [(e["source"], e["target"]) for e in fixed_edges]
        # A had 2 outgoing -> all removed; C had 2 incoming -> all removed
        # Only start->A and C->D survive
        assert ("start-node", "nA") in edge_pairs
        assert ("nC", "nD") in edge_pairs
        assert ("nA", "nB") not in edge_pairs
        assert ("nA", "nC") not in edge_pairs
        assert ("nB", "nC") not in edge_pairs

    def test_fix_test_removes_self_loop_and_multiple_edges(self) -> None:
        """Test fix with self-loop + multi-edge: B->B removed, then B's outputs removed."""
        created = test_service.create_test(
            {
                "name": "Loop + Multi Fix Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "nA",
                            "type": "workflowNode",
                            "position": {"x": 200, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "A",
                                "version": "1.0.0",
                                "config": {"values": {"message": "a"}},
                            },
                        },
                        {
                            "id": "nB",
                            "type": "workflowNode",
                            "position": {"x": 450, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "B",
                                "version": "1.0.0",
                                "config": {"values": {"message": "b"}},
                            },
                        },
                        {
                            "id": "nC",
                            "type": "workflowNode",
                            "position": {"x": 700, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "C",
                                "version": "1.0.0",
                                "config": {"values": {"message": "c"}},
                            },
                        },
                        {
                            "id": "nD",
                            "type": "workflowNode",
                            "position": {"x": 950, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "D",
                                "version": "1.0.0",
                                "config": {"values": {"message": "d"}},
                            },
                        },
                    ],
                    "edges": [
                        {"id": "e1", "source": "start-node", "target": "nA"},
                        {"id": "e2", "source": "nA", "target": "nB"},
                        {"id": "e3", "source": "nB", "target": "nC"},
                        {"id": "e4", "source": "nC", "target": "nD"},
                        {"id": "e-self", "source": "nB", "target": "nB"},
                        {"id": "e5", "source": "nB", "target": "nD"},
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])
        assert fix_result is not None
        fixed_edges = fix_result["test"]["workflow"]["edges"]
        edge_pairs = [(e["source"], e["target"]) for e in fixed_edges]
        # Self-loop B->B removed first.
        # Then: B has 2 outgoing (B->C, B->D) and D has 2 incoming (C->D, B->D).
        # Fix removes all B's outgoing AND all D's incoming.
        # Surviving: start->A, A->B only
        assert ("start-node", "nA") in edge_pairs
        assert ("nA", "nB") in edge_pairs
        assert len(edge_pairs) == 2
        assert ("nB", "nB") not in edge_pairs
        assert ("nB", "nC") not in edge_pairs
        assert ("nB", "nD") not in edge_pairs
        assert ("nC", "nD") not in edge_pairs

    def test_fix_test_resets_invalid_edge_type(self) -> None:
        """Test that fix_test removes invalid type from edge."""
        created = test_service.create_test(
            {
                "name": "Fix Edge Type Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 200, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "N1",
                                "version": "1.0.0",
                                "config": {"values": {"message": "a"}},
                            },
                        },
                        {
                            "id": "node-2",
                            "type": "workflowNode",
                            "position": {"x": 450, "y": 200},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "label": "N2",
                                "version": "1.0.0",
                                "config": {"values": {"message": "b"}},
                            },
                        },
                    ],
                    "edges": [
                        {
                            "id": "e1",
                            "source": "start-node",
                            "target": "node-1",
                        },
                        {
                            "id": "e2",
                            "source": "node-1",
                            "target": "node-2",
                            "type": "invalid-type",
                        },
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])
        assert fix_result is not None
        fixed_edges = fix_result["test"]["workflow"]["edges"]
        # The invalid type should have been removed
        edge_e2 = [e for e in fixed_edges if e.get("id") == "e2"]
        assert len(edge_e2) == 1
        assert "type" not in edge_e2[0]

    def test_fix_test_returns_warnings_after_fix(self) -> None:
        """Test that fix_test returns post-fix validation warnings."""
        fix_result = test_service.fix_test("nonexistent-id")
        assert fix_result is None

        # Create a test with a fixable error - result should include warnings key
        created = test_service.create_test(
            {
                "name": "Warnings Test",
                "variables": {
                    "123-bad": {"type": "string", "value": "val"},
                },
                "workflow": {"nodes": [], "edges": []},
            }
        )

        fix_result = test_service.fix_test(created["id"])
        assert fix_result is not None
        assert "warnings" in fix_result
        assert isinstance(fix_result["warnings"], list)

    def test_fix_creates_undeclared_variable_with_inferred_type(self) -> None:
        """Test that fix creates undeclared variable with type inferred from output schema."""
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.http_client import HTTPClientPlugin

        clear_registry()
        register_plugin(HTTPClientPlugin())

        created = _create_test_with_legacy_data(
            {
                "name": "Fix Undeclared Inferred Type",
                "variables": {},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "http-client",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "HTTP Request",
                                "config": {
                                    "values": {
                                        "url": "http://example.com",
                                        "method": "GET",
                                    },
                                    "outputBindings": {"status_code": "my_status"},
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        variables = fix_result["test"]["variables"]
        assert "my_status" in variables
        assert variables["my_status"]["type"] == "integer"

        clear_registry()

    def test_fix_creates_undeclared_variable_string_default(self) -> None:
        """Test that fix creates undeclared variable as string when no type info."""
        created = _create_test_with_legacy_data(
            {
                "name": "Fix Undeclared String Default",
                "variables": {},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "variable-setter",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Setter",
                                "expressionFields": ["condition"],
                                "config": {
                                    "values": {
                                        "variables": {"x": "1"},
                                        "condition": "unknown_var > 5",
                                    },
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        variables = fix_result["test"]["variables"]
        assert "unknown_var" in variables
        assert variables["unknown_var"]["type"] == "string"

    def test_fix_undeclared_variable_type_conflict(self) -> None:
        """Test that conflicting types cause outputBinding refs to be removed."""
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.http_client import HTTPClientPlugin

        clear_registry()
        register_plugin(HTTPClientPlugin())

        created = _create_test_with_legacy_data(
            {
                "name": "Fix Undeclared Type Conflict",
                "variables": {},
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 200},
                            "data": {
                                "elementType": "http-client",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "HTTP 1",
                                "config": {
                                    "values": {
                                        "url": "http://example.com",
                                        "method": "GET",
                                    },
                                    "outputBindings": {
                                        "status_code": "conflict_var",
                                    },
                                },
                            },
                        },
                        {
                            "id": "node-2",
                            "type": "workflowNode",
                            "position": {"x": 300, "y": 200},
                            "data": {
                                "elementType": "http-client",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "HTTP 2",
                                "config": {
                                    "values": {
                                        "url": "http://example.com",
                                        "method": "GET",
                                    },
                                    "outputBindings": {
                                        "body": "conflict_var",
                                    },
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        variables = fix_result["test"]["variables"]
        # Variable should NOT be created due to type conflict
        assert "conflict_var" not in variables
        # OutputBinding references should be removed
        nodes = fix_result["test"]["workflow"]["nodes"]
        for node in nodes:
            bindings = node["data"]["config"].get("outputBindings", {})
            assert "conflict_var" not in bindings.values()

        clear_registry()

    def test_fix_test_generates_missing_assertion_ids(self) -> None:
        """Test that fix_test generates UUIDs for assertion items missing IDs."""
        created = test_service.create_test(
            {
                "name": "Fix Assert IDs",
                "workflow": {
                    "nodes": [
                        {
                            "id": "assert-fix",
                            "type": "workflowNode",
                            "position": {"x": 0, "y": 0},
                            "data": {
                                "elementType": "assert",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Assert Fix",
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
                                            {"type": "operator", "value": "and"},
                                            {
                                                "type": "group",
                                                "items": [
                                                    {
                                                        "type": "expression",
                                                        "expression": "True",
                                                    },
                                                ],
                                            },
                                        ],
                                        "mode": "single",
                                    }
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        nodes = fix_result["test"]["workflow"]["nodes"]
        assert len(nodes) == 1
        assertions = nodes[0]["data"]["config"]["values"]["assertions"]
        # literal at index 0 should now have an ID
        assert assertions[0]["id"]
        assert isinstance(assertions[0]["id"], str)
        # operator at index 1 should NOT have an ID
        assert "id" not in assertions[1]
        # group at index 2 should have an ID
        assert assertions[2]["id"]
        assert isinstance(assertions[2]["id"], str)
        # expression inside group should have an ID
        assert assertions[2]["items"][0]["id"]
        assert isinstance(assertions[2]["items"][0]["id"], str)
        # All generated IDs should be unique
        all_ids = [assertions[0]["id"], assertions[2]["id"], assertions[2]["items"][0]["id"]]
        assert len(set(all_ids)) == 3


class TestRenameVariableInExpression:
    """Tests for _rename_variable_in_expression internal helper."""

    def test_renames_simple_identifier(self) -> None:
        """Test renames a simple variable name (entire expression is the identifier)."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        result = _rename_variable_in_expression("my_var", "my_var", "new_var")
        assert result == "new_var"

    def test_renames_identifier_in_arithmetic_expression(self) -> None:
        """Test renames variable within a compound Python expression."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        result = _rename_variable_in_expression("my_var + 1", "my_var", "renamed")
        assert result == "renamed + 1"

    def test_does_not_rename_string_literal_content(self) -> None:
        """Test that variable name inside a string literal is not renamed."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        # The string literal 'my_var' contains the text but is not a Name node
        result = _rename_variable_in_expression("'my_var'", "my_var", "renamed")
        assert result == "'my_var'"

    def test_renames_multiple_occurrences(self) -> None:
        """Test renames all AST Name node occurrences right-to-left."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        result = _rename_variable_in_expression("my_var + my_var", "my_var", "x")
        assert result == "x + x"

    def test_returns_expr_unchanged_on_syntax_error(self) -> None:
        """Test returns original expression when it cannot be parsed as Python."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        # Invalid Python expression - SyntaxError path
        unparsable = "{{ invalid python !!"
        result = _rename_variable_in_expression(unparsable, "my_var", "renamed")
        assert result == unparsable

    def test_returns_expr_unchanged_when_name_not_present(self) -> None:
        """Test returns original expression when identifier is not found as AST Name."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        result = _rename_variable_in_expression("other_var + 5", "my_var", "renamed")
        assert result == "other_var + 5"

    def test_does_not_rename_partial_identifier_matches(self) -> None:
        """Test that substring matches within identifiers are not renamed."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        # "my_var_extra" contains "my_var" as a substring but is a different identifier
        result = _rename_variable_in_expression("my_var_extra + 1", "my_var", "renamed")
        assert result == "my_var_extra + 1"

    def test_renames_variable_in_fstring_expression(self) -> None:
        """Test renames variable that appears in an f-string expression slot."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        # f-string: the {my_var} part is an expression slot - AST finds the Name node
        result = _rename_variable_in_expression("f'value: {my_var}'", "my_var", "new_var")
        assert result == "f'value: {new_var}'"

    def test_fstring_literal_text_not_renamed(self) -> None:
        """Test that variable name in f-string literal text (not expression) is preserved."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        # In f'my_var: {my_var}', "my_var" in the literal prefix is not an AST Name node,
        # but {my_var} is. Only the expression part should be renamed.
        result = _rename_variable_in_expression("f'my_var: {my_var}'", "my_var", "new_var")
        assert result == "f'my_var: {new_var}'"

    def test_renames_variable_that_is_exact_match_but_invalid_python(self) -> None:
        """Test renames when entire expression equals old_name (even if it's invalid Python)."""
        from wavecore.api.services.tests.service import _rename_variable_in_expression

        # "2-used-same" is not a valid Python identifier but when used as an entire
        # expression value equals the old_name - direct replacement path (line 2058-2059)
        result = _rename_variable_in_expression("2-used-same", "2-used-same", "fixed_abc")
        assert result == "fixed_abc"


class TestFixTestUndeclaredVariableNoUsages:
    """Test for fix_test UNDECLARED_VARIABLE branch where no usages remain (line 2244)."""

    def setup_method(self) -> None:
        """Reset test storage and register controls/plugins before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

    def test_fix_skips_undeclared_variable_when_no_usages_remain_after_prior_fix(
        self,
    ) -> None:
        """Test that fix_test skips UNDECLARED_VARIABLE creation when no usages remain.

        This exercises line 2244: the logger.debug call when usages is empty
        for an UNDECLARED_VARIABLE error. We inject a synthetic UNDECLARED_VARIABLE
        error for a variable ('ghost_var') that has no actual references in any node.
        When fix_test processes this error, _sites_naming returns [] and
        the debug-log-and-skip branch at line 2244 is executed.
        """
        from unittest.mock import patch

        created = test_service.create_test(
            {
                "name": "Undeclared No Usages",
                "variables": {},
                "workflow": {"nodes": [], "edges": []},
            }
        )

        # Inject a fake UNDECLARED_VARIABLE error for 'ghost_var', which has no usages
        fake_validation = {
            "fatal": False,
            "errors": [
                {
                    "path": "variables.ghost_var",
                    "code": "UNDECLARED_VARIABLE",
                    "message": "Variable 'ghost_var' is used in 1 block(s) but not declared",
                    "fix_action": "Add variable to manager (type: string)",
                },
            ],
            "warnings": [],
        }

        with patch(
            "wavecore.api.services.tests.service._validate_test_data",
            side_effect=[fake_validation, {"fatal": False, "errors": [], "warnings": []}],
        ):
            fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        variables = fix_result["test"]["variables"]
        # ghost_var has no usages - skip branch fired, variable NOT created
        assert "ghost_var" not in variables


class TestCloneTest:
    """Test suite for clone_test service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_clone_test_creates_copy(self) -> None:
        """Test cloning a test creates a copy."""
        original = test_service.create_test(
            {
                "name": "Original",
                "description": "Original test",
                "workflow": {"nodes": [{"id": "1"}], "edges": []},
            }
        )

        result = test_service.clone_test(original["id"], "Cloned Test")

        assert result is not None
        assert result["name"] == "Cloned Test"
        assert result["id"] != original["id"]
        assert result["metadata"]["cloned_from"] == original["id"]

    def test_clone_test_with_new_version(self) -> None:
        """Test cloning with a specific version."""
        original = test_service.create_test({"name": "Original"})

        result = test_service.clone_test(original["id"], "Cloned", new_version="2.0.0")

        assert result is not None
        assert result["version"] == "2.0.0"

    def test_clone_test_returns_none_when_not_found(self) -> None:
        """Test that clone returns None when source not found."""
        result = test_service.clone_test("nonexistent-id", "Clone")

        assert result is None


class TestCloneTestCopiesTestData:
    """The clone receives a copy of the source's files (REQ-3.4.3.2)."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def _seed_testdata(self, test_id: str) -> Path:
        from wavecore.api.services import storage_paths

        root = storage_paths.get_test_testdata_path(test_id)
        (root / "sub").mkdir(parents=True, exist_ok=True)
        (root / "rows.csv").write_bytes(b"id,name\n")
        (root / "sub" / "notes.txt").write_bytes(b"notes")
        return root

    @staticmethod
    def _tree(test_id: str) -> dict[str, bytes]:
        from wavecore.api.services import storage_paths

        root = storage_paths.get_test_testdata_path(test_id)
        if not root.exists():
            return {}
        return {
            p.relative_to(root).as_posix(): p.read_bytes()
            for p in sorted(root.rglob("*"))
            if p.is_file()
        }

    def test_clone_copies_the_folder(self) -> None:
        """Every file of the source appears under the clone's id."""
        source = test_service.create_test({"name": "Source"})
        self._seed_testdata(source["id"])

        clone = test_service.clone_test(source["id"], "Clone")

        assert clone is not None
        assert self._tree(clone["id"]) == {
            "rows.csv": b"id,name\n",
            "sub/notes.txt": b"notes",
        }

    def test_cloned_files_are_read_only(self) -> None:
        """The copy is locked again: files 0444, folders 0555."""
        from wavecore.api.services import storage_paths

        source = test_service.create_test({"name": "Source"})
        self._seed_testdata(source["id"])

        clone = test_service.clone_test(source["id"], "Clone")

        assert clone is not None
        root = storage_paths.get_test_testdata_path(clone["id"])
        assert (root / "rows.csv").stat().st_mode & 0o777 == 0o400
        assert (root / "sub").stat().st_mode & 0o777 == 0o500

    def test_clone_of_a_source_without_files_creates_no_folder(self) -> None:
        """A source with no files leaves the clone without a folder."""
        from wavecore.api.services import storage_paths

        source = test_service.create_test({"name": "Source"})

        clone = test_service.clone_test(source["id"], "Clone")

        assert clone is not None
        assert not storage_paths.get_test_testdata_path(clone["id"]).exists()

    def test_the_copy_happens_after_the_versions_are_saved(self) -> None:
        """copy_for_clone runs once the clone's version history is on disk."""
        from wavecore.api.services.tests import testdata_service

        source = test_service.create_test({"name": "Source"})
        self._seed_testdata(source["id"])
        versions_saved: list[bool] = []

        def _record(source_id: str, clone_id: str) -> None:
            versions_saved.append(test_service._load_versions(clone_id) != [])

        with patch.object(testdata_service, "copy_for_clone", side_effect=_record):
            test_service.clone_test(source["id"], "Clone")

        assert versions_saved == [True]


class TestDependencyGraph:
    """Test suite for get_test_dependency_graph service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_get_dependency_graph_extracts_block_refs(self) -> None:
        """Test that dependency graph extracts block references."""
        block_id = str(uuid.uuid4())
        created = _create_test_with_legacy_data(
            {
                "name": "Deps Test",
                "workflow": {
                    "nodes": [
                        {"id": "start", "type": "start"},
                        {"id": "block1", "type": "block", "block_id": block_id},
                        {"id": "end", "type": "end"},
                    ],
                    "edges": [],
                },
            }
        )

        result = test_service.get_test_dependency_graph(created["id"])

        assert result is not None
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["id"] == block_id
        assert result["nodes"][0]["type"] == "block"

    def test_get_dependency_graph_returns_none_when_not_found(self) -> None:
        """Test that dependency graph returns None when not found."""
        result = test_service.get_test_dependency_graph("nonexistent-id")

        assert result is None


class TestHistory:
    """Test suite for get_test_history service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_get_history_returns_versions(self) -> None:
        """Test getting version history."""
        created = test_service.create_test({"name": "History Test"})
        test_service.add_test_version(created["id"], {"version_bump": "minor"})

        result = test_service.get_test_history(created["id"])

        assert result is not None
        assert len(result["versions"]) == 2

    def test_get_history_returns_none_when_not_found(self) -> None:
        """Test that get_history returns None when not found."""
        result = test_service.get_test_history("nonexistent-id")

        assert result is None

    def test_get_history_sorts_versions_descending(self) -> None:
        """Test that versions are sorted newest first."""
        created = test_service.create_test({"name": "History Test"})
        test_service.add_test_version(created["id"], {"version_bump": "minor"})
        test_service.add_test_version(created["id"], {"version_bump": "major"})

        result = test_service.get_test_history(created["id"])

        assert result is not None
        assert result["versions"][0]["version"] == "2.0.0"
        assert result["versions"][-1]["version"] == "1.0.0"


class TestHelperFunctions:
    """Test suite for helper functions."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_load_versions_returns_empty_for_missing_file(self) -> None:
        """Test that _load_versions returns empty list when file doesn't exist."""
        # Create a test dir without versions file
        test_id = str(uuid.uuid4())
        test_dir = test_service._get_test_dir(test_id)
        test_dir.mkdir(parents=True, exist_ok=True)

        result = test_service._load_versions(test_id)

        assert result == []

    def test_has_missing_assertion_ids_skips_non_dict_items(self) -> None:
        """Test that _has_missing_assertion_ids skips non-dict items gracefully."""
        from wavecore.api.services.tests.service import _has_missing_assertion_ids

        # Mix of non-dict and valid items
        items: list[Any] = [
            "not-a-dict",
            42,
            {"id": "lit-1", "type": "literal", "variable": "x"},
        ]
        assert _has_missing_assertion_ids(items) is False

    def test_fix_missing_assertion_ids_skips_non_dict_items(self) -> None:
        """Test that _fix_missing_assertion_ids skips non-dict items gracefully."""
        from wavecore.api.services.tests.service import _fix_missing_assertion_ids

        items: list[Any] = [
            None,
            "garbage",
            {"type": "literal", "variable": "x"},
        ]
        count = _fix_missing_assertion_ids(items)
        assert count == 1
        assert items[0] is None  # unchanged
        assert items[1] == "garbage"  # unchanged
        assert items[2]["id"]  # got an ID


class TestFixTestStaleTargetHandle:
    """Tests for STALE_TARGET_HANDLE detection and auto-fix."""

    def setup_method(self) -> None:
        """Reset test storage and register controls/plugins before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

    def test_validate_detects_stale_target_handle(self) -> None:
        """Edge with ingress_1 targetHandle but only 1 incoming edge is STALE."""
        created = _create_test_with_legacy_data(
            {
                "name": "Stale Handle Test",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 100},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "N1",
                                "config": {"values": {"message": "a"}},
                            },
                        },
                    ],
                    "edges": [
                        {
                            "id": "e1",
                            "source": "start-node",
                            "target": "node-1",
                            "targetHandle": "ingress_1",
                        },
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])
        error_codes = [e["code"] for e in result["errors"]]
        assert "STALE_TARGET_HANDLE" in error_codes

    def test_validate_stale_target_handle_message_says_block(self) -> None:
        node = {
            "id": "node-1",
            "type": "workflowNode",
            "position": {"x": 100, "y": 100},
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "label": "N1",
                "config": {"values": {"message": "a"}},
            },
        }
        edge = {"id": "e1", "source": "start-node", "target": "node-1", "targetHandle": "ingress_1"}
        created = _create_test_with_legacy_data(
            {"name": "Stale Handle Wording", "workflow": {"nodes": [node], "edges": [edge]}}
        )

        result = test_service.validate_test(created["id"])

        assert result is not None
        (message,) = [e["message"] for e in result["errors"] if e["code"] == "STALE_TARGET_HANDLE"]
        assert re.fullmatch(
            r"^Edge to 'N1' references handle 'ingress_1' but block has only 1 incoming edge\(s\)$",
            message,
        )

    def test_fix_test_resets_stale_target_handle(self) -> None:
        """Fix_test removes stale targetHandle from edge."""
        created = test_service.create_test(
            {
                "name": "Fix Stale Handle",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 100},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "N1",
                                "config": {"values": {"message": "a"}},
                            },
                        },
                    ],
                    "edges": [
                        {
                            "id": "e1",
                            "source": "start-node",
                            "target": "node-1",
                            "targetHandle": "ingress_1",
                        },
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])
        assert fix_result is not None
        fixed_edges = fix_result["test"]["workflow"]["edges"]
        edge_e1 = [e for e in fixed_edges if e.get("id") == "e1"]
        assert len(edge_e1) == 1
        # targetHandle should have been removed (reset to default)
        assert "targetHandle" not in edge_e1[0]


class TestFixTestCrossScopeEdge:
    """Tests for CROSS_SCOPE_EDGE auto-fix."""

    def setup_method(self) -> None:
        """Reset test storage and register controls/plugins before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

    def test_fix_test_removes_cross_scope_edge(self) -> None:
        """Fix_test removes cross-scope edges between try-catch paths."""
        created = test_service.create_test(
            {
                "name": "Fix Cross Scope",
                "workflow": {
                    "nodes": [
                        {
                            "id": "tc-1",
                            "type": "workflowNode",
                            "position": {"x": 200, "y": 100},
                            "data": {
                                "elementType": "try-catch-finally",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Try/Catch",
                                "config": {
                                    "values": {
                                        "enable_catch": True,
                                        "enable_finally": False,
                                    }
                                },
                            },
                        },
                        {
                            "id": "try-node",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 300},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Try Log",
                                "config": {"values": {"message": "a"}},
                            },
                        },
                        {
                            "id": "catch-node",
                            "type": "workflowNode",
                            "position": {"x": 300, "y": 300},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Catch Log",
                                "config": {"values": {"message": "b"}},
                            },
                        },
                    ],
                    "edges": [
                        {"id": "e-start", "source": "start-node", "target": "tc-1"},
                        {
                            "id": "e-try",
                            "source": "tc-1",
                            "target": "try-node",
                            "sourceHandle": "try",
                        },
                        {
                            "id": "e-catch",
                            "source": "tc-1",
                            "target": "catch-node",
                            "sourceHandle": "catch",
                        },
                        # Cross-scope edge: try-path -> catch-path
                        {"id": "e-cross", "source": "try-node", "target": "catch-node"},
                    ],
                },
            }
        )

        fix_result = test_service.fix_test(created["id"])
        assert fix_result is not None
        fixed_edge_ids = [e.get("id") for e in fix_result["test"]["workflow"]["edges"]]
        # The cross-scope edge should have been removed
        assert "e-cross" not in fixed_edge_ids
        # The path edges should remain
        assert "e-try" in fixed_edge_ids
        assert "e-catch" in fixed_edge_ids


class TestFixTestEdgeTypeValueError:
    """Test for INVALID_EDGE_TYPE fix with non-integer path index."""

    def setup_method(self) -> None:
        """Reset test storage and register controls/plugins before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

    def test_fix_handles_malformed_edge_index_gracefully(self) -> None:
        """Fix_test handles INVALID_EDGE_TYPE with non-parseable index path."""
        from unittest.mock import patch

        created = test_service.create_test(
            {
                "name": "Edge Index Test",
                "workflow": {"nodes": [], "edges": []},
            }
        )

        # Inject an INVALID_EDGE_TYPE error with a non-integer path
        fake_validation = {
            "fatal": False,
            "errors": [
                {
                    "path": "edges[abc]",
                    "code": "INVALID_EDGE_TYPE",
                    "message": "Edge has invalid type 'bogus'",
                    "fix_action": "Reset to default edge type",
                },
            ],
            "warnings": [],
        }

        with patch(
            "wavecore.api.services.tests.service._validate_test_data",
            side_effect=[fake_validation, {"fatal": False, "errors": [], "warnings": []}],
        ):
            fix_result = test_service.fix_test(created["id"])

        # Should not crash - ValueError is caught
        assert fix_result is not None


class TestScopeChainTraversal:
    """Tests for BFS scope chain traversal edge cases in validation."""

    def setup_method(self) -> None:
        """Reset test storage and register controls/plugins before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

    def test_scope_chain_skips_already_visited_node(self) -> None:
        """BFS scope traversal skips already-visited nodes (diamond pattern).

        When a node is reachable via two paths within a scope, it gets enqueued
        twice. The second time it's popped from the queue, it's already in
        chain_visited and the 'continue' at L1932 fires.

        Diamond: tc -> try-a -> try-b -> try-c, try-a -> try-c (direct)
        try-c is reachable from try-a via try-b AND directly.
        """
        created = test_service.create_test(
            {
                "name": "Scope Diamond Guard",
                "workflow": {
                    "nodes": [
                        {
                            "id": "tc-1",
                            "type": "workflowNode",
                            "position": {"x": 200, "y": 100},
                            "data": {
                                "elementType": "try-catch-finally",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "TC",
                                "config": {
                                    "values": {
                                        "enable_catch": True,
                                        "enable_finally": False,
                                    }
                                },
                            },
                        },
                        {
                            "id": "try-a",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 300},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Try A",
                                "config": {"values": {"message": "a"}},
                            },
                        },
                        {
                            "id": "try-b",
                            "type": "workflowNode",
                            "position": {"x": 50, "y": 400},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Try B",
                                "config": {"values": {"message": "b"}},
                            },
                        },
                        {
                            "id": "try-c",
                            "type": "workflowNode",
                            "position": {"x": 150, "y": 500},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "Try C",
                                "config": {"values": {"message": "c"}},
                            },
                        },
                    ],
                    "edges": [
                        {"id": "e-start", "source": "start-node", "target": "tc-1"},
                        {"id": "e-try", "source": "tc-1", "target": "try-a", "sourceHandle": "try"},
                        {"id": "e-ab", "source": "try-a", "target": "try-b"},
                        {"id": "e-bc", "source": "try-b", "target": "try-c"},
                        # Direct edge from try-a to try-c (diamond: try-c reachable 2 ways)
                        {"id": "e-ac", "source": "try-a", "target": "try-c"},
                    ],
                },
            }
        )

        result = test_service.validate_test(created["id"])
        assert result is not None
        # All nodes should be in try-path scope (no cross-scope error)
        cross_scope_errors = [e for e in result["errors"] if e["code"] == "CROSS_SCOPE_EDGE"]
        assert len(cross_scope_errors) == 0

    def test_scope_chain_stops_at_nested_try_catch_node(self) -> None:
        """BFS scope traversal stops at try-catch nodes (doesn't enter them)."""
        # Nested try-catch: outer try-path contains an inner try-catch node
        created = test_service.create_test(
            {
                "name": "Nested TC Guard",
                "workflow": {
                    "nodes": [
                        {
                            "id": "tc-outer",
                            "type": "workflowNode",
                            "position": {"x": 200, "y": 100},
                            "data": {
                                "elementType": "try-catch-finally",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Outer TC",
                                "config": {
                                    "values": {
                                        "enable_catch": True,
                                        "enable_finally": False,
                                    }
                                },
                            },
                        },
                        {
                            "id": "tc-inner",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 300},
                            "data": {
                                "elementType": "try-catch-finally",
                                "nodeType": "control",
                                "version": "1.0.0",
                                "label": "Inner TC",
                                "config": {
                                    "values": {
                                        "enable_catch": True,
                                        "enable_finally": False,
                                    }
                                },
                            },
                        },
                    ],
                    "edges": [
                        {"id": "e-start", "source": "start-node", "target": "tc-outer"},
                        {
                            "id": "e-try",
                            "source": "tc-outer",
                            "target": "tc-inner",
                            "sourceHandle": "try",
                        },
                    ],
                },
            }
        )

        # Validation should succeed without crash
        result = test_service.validate_test(created["id"])
        assert result is not None


def _scope_node(
    node_id: str, element_type: str = "log", values: dict[str, Any] | None = None
) -> dict[str, Any]:
    """A workflow node for the nested Try/Catch scope graphs."""
    node_type = "plugin" if element_type == "log" else "control"
    if values is None:
        values = {"message": node_id} if element_type == "log" else {}
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "elementType": element_type,
            "nodeType": node_type,
            "version": "1.0.0",
            "label": node_id,
            "config": {"values": values},
        },
    }


def _scope_tc(node_id: str) -> dict[str, Any]:
    return _scope_node(node_id, "try-catch-finally", {"enable_catch": True, "enable_finally": True})


def _scope_edge(
    source: str, target: str, handle: str | None = None, target_handle: str | None = None
) -> dict[str, Any]:
    edge: dict[str, Any] = {"id": f"{source}__{target}", "source": source, "target": target}
    if handle:
        edge["sourceHandle"] = handle
    if target_handle:
        edge["targetHandle"] = target_handle
    return edge


def _nested_tc_graph(outer_handle: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Top Try/Catch whose ``outer_handle`` path runs head -> inner Try/Catch -> after -> tail."""
    nodes = [
        _scope_tc("outer"),
        _scope_node("head"),
        _scope_tc("inner"),
        _scope_node("inner-try"),
        _scope_node("inner-catch"),
        _scope_node("inner-finally"),
        _scope_node("after"),
        _scope_node("tail"),
        _scope_node("done"),
    ]
    edges = [
        _scope_edge("start-node", "outer"),
        _scope_edge("outer", "head", outer_handle),
        _scope_edge("head", "inner"),
        _scope_edge("inner", "inner-try", "try"),
        _scope_edge("inner", "inner-catch", "catch"),
        _scope_edge("inner", "inner-finally", "finally"),
        _scope_edge("inner", "after", "then"),
        _scope_edge("after", "tail"),
        _scope_edge("outer", "done", "then"),
    ]
    return nodes, edges


def _later_try_catch_graph() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Try/Catch t1 -then-> m -> Try/Catch t2, plus a stray edge from t1's try path into t2."""
    nodes = [
        _scope_tc("t1"),
        _scope_node("a"),
        _scope_node("m"),
        _scope_tc("t2"),
        _scope_node("b"),
        _scope_node("y"),
    ]
    edges = [
        _scope_edge("start-node", "t1"),
        _scope_edge("t1", "a", "try"),
        _scope_edge("t1", "m", "then"),
        _scope_edge("m", "t2", target_handle="in-a"),
        _scope_edge("t2", "b", "try"),
        _scope_edge("t2", "y", "then"),
        _scope_edge("a", "t2", target_handle="in-b"),
    ]
    return nodes, edges


def _cross_scope_edge_ids(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[str]:
    created = _create_test_with_legacy_data(
        {"name": f"Scope {uuid.uuid4()}", "workflow": {"nodes": nodes, "edges": edges}}
    )
    result = test_service.validate_test(created["id"], context="import")
    assert result is not None
    assert result["fatal"] is False
    return sorted(
        e["path"].rsplit(".", 1)[-1] for e in result["errors"] if e["code"] == "CROSS_SCOPE_EDGE"
    )


class TestNestedTryCatchScopes:
    """A Try/Catch inside another Try/Catch path takes that path's scope (REQ-3.2.2.6)."""

    def setup_method(self) -> None:
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

    @pytest.mark.parametrize("outer_handle", ["try", "catch", "finally"])
    def test_nested_try_catch_after_a_block_is_same_scope(self, outer_handle: str) -> None:
        nodes, edges = _nested_tc_graph(outer_handle)
        assert _cross_scope_edge_ids(nodes, edges) == []

    def test_save_keeps_connections_into_and_after_nested_try_catch(self) -> None:
        nodes, edges = _nested_tc_graph("try")
        created = test_service.create_test(
            {"name": "Nested TC save", "workflow": {"nodes": nodes, "edges": edges}}
        )
        assert created["repairs"] == []
        kept = sorted(e["id"] for e in created["workflow"]["edges"])
        assert kept == sorted(e["id"] for e in edges)

    def test_try_catch_three_deep_is_same_scope(self) -> None:
        nodes = [
            _scope_tc("tc1"),
            _scope_node("l1"),
            _scope_tc("tc2"),
            _scope_node("l2"),
            _scope_tc("tc3"),
            _scope_node("l3"),
            _scope_node("m3"),
            _scope_node("m2"),
            _scope_node("done"),
        ]
        edges = [
            _scope_edge("start-node", "tc1"),
            _scope_edge("tc1", "l1", "try"),
            _scope_edge("l1", "tc2"),
            _scope_edge("tc2", "l2", "catch"),
            _scope_edge("l2", "tc3"),
            _scope_edge("tc3", "l3", "finally"),
            _scope_edge("tc3", "m3", "then"),
            _scope_edge("tc2", "m2", "then"),
            _scope_edge("tc1", "done", "then"),
        ]
        assert _cross_scope_edge_ids(nodes, edges) == []

    def test_try_catch_in_loop_body_inside_try_path_is_same_scope(self) -> None:
        nodes = [
            _scope_tc("outer"),
            _scope_node("head"),
            _scope_node("loop", "for", {"mode": "count", "count": 2, "start": 0, "end": 0}),
            _scope_tc("inner"),
            _scope_node("inner-try"),
            _scope_node("inner-then"),
            _scope_node("loop-then"),
        ]
        edges = [
            _scope_edge("start-node", "outer"),
            _scope_edge("outer", "head", "try"),
            _scope_edge("head", "loop"),
            _scope_edge("loop", "inner", "body"),
            _scope_edge("inner", "inner-try", "try"),
            _scope_edge("inner", "inner-then", "then"),
            _scope_edge("loop", "loop-then", "then"),
        ]
        assert _cross_scope_edge_ids(nodes, edges) == []

    def test_try_catch_in_branch_rejoining_inside_try_path_is_same_scope(self) -> None:
        branches = [
            {"type": "if", "id": "branch_0", "label": "if", "conditions": []},
            {"type": "else", "id": "branch_1", "label": "else"},
        ]
        nodes = [
            _scope_tc("outer"),
            _scope_node("split", "if-else", {"branches": branches}),
            _scope_tc("inner"),
            _scope_node("inner-try"),
            _scope_node("other"),
            _scope_node("rejoin"),
        ]
        edges = [
            _scope_edge("start-node", "outer"),
            _scope_edge("outer", "split", "try"),
            _scope_edge("split", "inner", "branch_0"),
            _scope_edge("inner", "inner-try", "try"),
            _scope_edge("inner", "rejoin", "then", "ingress_0"),
            _scope_edge("split", "other", "branch_1"),
            _scope_edge("other", "rejoin", None, "ingress_1"),
        ]
        assert _cross_scope_edge_ids(nodes, edges) == []

    @pytest.mark.parametrize(
        ("source", "target", "refused"),
        [
            ("inner-try", "after", "inner-try__after"),
            ("tail", "done", "tail__done"),
            # The outer flow reaches inner through done, so head -> inner is the edge into it.
            ("done", "inner", "head__inner"),
            ("after", "inner-catch", "after__inner-catch"),
        ],
    )
    def test_cross_scope_edge_around_nested_try_catch_is_refused(
        self, source: str, target: str, refused: str
    ) -> None:
        nodes, edges = _nested_tc_graph("try")
        edges.append(_scope_edge(source, target))
        assert _cross_scope_edge_ids(nodes, edges) == [refused]

    def test_self_loop_and_open_edges_are_not_scope_checked(self) -> None:
        nodes, edges = _nested_tc_graph("try")
        edges.append({"id": "open", "source": "head"})
        edges.append(_scope_edge("tail", "tail"))
        assert _cross_scope_edge_ids(nodes, edges) == []

    def test_nested_try_catch_then_edge_into_another_path_is_refused(self) -> None:
        nodes, edges = _nested_tc_graph("try")
        nodes.append(_scope_node("outer-catch"))
        edges = [e for e in edges if e["id"] != "inner__after"]
        edges.append(_scope_edge("outer", "outer-catch", "catch"))
        edges.append(_scope_edge("inner", "outer-catch", "then"))
        assert _cross_scope_edge_ids(nodes, edges) == ["inner__outer-catch"]

    def test_a_stray_edge_into_a_later_try_catch_is_the_edge_refused(self) -> None:
        nodes, edges = _later_try_catch_graph()
        assert _cross_scope_edge_ids(nodes, edges) == ["a__t2"]

    def test_save_removes_the_stray_edge_into_a_later_try_catch(self) -> None:
        nodes, edges = _later_try_catch_graph()
        created = test_service.create_test(
            {"name": "Stray into later TC", "workflow": {"nodes": nodes, "edges": edges}}
        )
        assert [repair["id"] for repair in created["repairs"]] == ["a__t2"]
        kept = sorted(e["id"] for e in created["workflow"]["edges"])
        assert kept == sorted(e["id"] for e in edges if e["id"] != "a__t2")

    def test_a_nested_try_catch_then_into_the_outer_flow_is_the_edge_refused(self) -> None:
        nodes = [
            _scope_tc("outer"),
            _scope_tc("inner"),
            _scope_node("inner-try"),
            _scope_node("done"),
        ]
        edges = [
            _scope_edge("start-node", "outer"),
            _scope_edge("outer", "inner", "try"),
            _scope_edge("inner", "inner-try", "try"),
            _scope_edge("inner", "done", "then", target_handle="in-a"),
            _scope_edge("outer", "done", "then", target_handle="in-b"),
        ]
        assert _cross_scope_edge_ids(nodes, edges) == ["inner__done"]

    def test_a_stray_edge_into_a_block_after_then_is_the_edge_refused(self) -> None:
        nodes = [_scope_tc("t1"), _scope_node("a"), _scope_node("m"), _scope_node("x")]
        edges = [
            _scope_edge("start-node", "t1"),
            _scope_edge("t1", "a", "try"),
            _scope_edge("t1", "m", "then"),
            _scope_edge("m", "x", target_handle="in-a"),
            _scope_edge("a", "x", target_handle="in-b"),
        ]
        assert _cross_scope_edge_ids(nodes, edges) == ["a__x"]

    def test_an_outer_block_into_a_nested_then_target_is_the_edge_refused(self) -> None:
        nodes, edges = _nested_tc_graph("try")
        edges.append(_scope_edge("done", "after", target_handle="in-b"))
        assert _cross_scope_edge_ids(nodes, edges) == ["done__after"]

    @pytest.mark.parametrize("order", ["listed", "reversed", "catch-side-first"])
    def test_a_cross_path_merge_reports_every_merging_edge_in_any_order(self, order: str) -> None:
        nodes = [
            _scope_tc("outer"),
            _scope_tc("ta"),
            _scope_node("ta-try"),
            _scope_tc("tb"),
            _scope_node("tb-try"),
            _scope_node("x"),
        ]
        try_side = [
            _scope_edge("outer", "ta", "try"),
            _scope_edge("ta", "ta-try", "try"),
            _scope_edge("ta", "x", "then", target_handle="in-a"),
        ]
        catch_side = [
            _scope_edge("outer", "tb", "catch"),
            _scope_edge("tb", "tb-try", "try"),
            _scope_edge("tb", "x", "then", target_handle="in-b"),
        ]
        edges = [_scope_edge("start-node", "outer"), *try_side, *catch_side]
        if order == "reversed":
            edges.reverse()
        elif order == "catch-side-first":
            edges = [edges[0], *catch_side, *try_side]
        assert _cross_scope_edge_ids(nodes, edges) == ["ta__x", "tb__x"]


class TestTargetHandleNormalization:
    """Tests for edge targetHandle normalization during fix_test."""

    def setup_method(self) -> None:
        """Reset test storage and register controls/plugins before each test."""
        test_service._clear_storage()
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

    def test_normalize_single_incoming_removes_target_handle(self) -> None:
        """fix_test normalization removes stale targetHandle on single-incoming edge.

        We inject a non-STALE_TARGET_HANDLE error so the STALE_TARGET_HANDLE
        auto-fix doesn't run, leaving the handle for the normalization pass
        at L3035-3041 to remove.
        """
        from unittest.mock import patch

        created = test_service.create_test(
            {
                "name": "Normalize Single",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-1",
                            "type": "workflowNode",
                            "position": {"x": 100, "y": 100},
                            "data": {
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "label": "N1",
                                "config": {"values": {"message": "a"}},
                            },
                        },
                    ],
                    "edges": [
                        {
                            "id": "e1",
                            "source": "start-node",
                            "target": "node-1",
                            "targetHandle": "ingress_1",
                        },
                    ],
                },
            }
        )

        # Inject a trivial error (not STALE_TARGET_HANDLE) so the handle
        # survives auto-fix and reaches the normalization pass
        fake_validation = {
            "fatal": False,
            "errors": [
                {
                    "path": "nodes[0].data.label",
                    "code": "MISSING_LABEL",
                    "message": "Node missing label",
                    "fix_action": "Generate a name from the block type",
                    "node_id": "node-1",
                },
            ],
            "warnings": [],
        }

        with patch(
            "wavecore.api.services.tests.service._validate_test_data",
            side_effect=[fake_validation, {"fatal": False, "errors": [], "warnings": []}],
        ):
            fix_result = test_service.fix_test(created["id"])

        assert fix_result is not None
        edges = fix_result["test"]["workflow"]["edges"]
        edge_e1 = [e for e in edges if e.get("id") == "e1"]
        assert len(edge_e1) == 1
        # Normalization removed the stale targetHandle
        assert edge_e1[0].get("targetHandle") is None

    # NOTE: The multi-incoming normalization branch (test_service.py L3042-3058)
    # is unreachable dead code. The multi_in edge fix at L3007-3012 always
    # removes ALL edges to nodes with >1 incoming before normalization runs.
    # This defensive code cannot be triggered through any normal flow.


class TestRestoreVersion:
    """Test suite for restore_test_version service function."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_restore_version_creates_new_version(self) -> None:
        """Test that restore creates a new version."""
        created = test_service.create_test({"name": "Restore Test"})
        test_service.add_test_version(created["id"], {"version_bump": "minor"})

        result = test_service.restore_test_version(created["id"], "1.0.0")

        assert result is not None
        assert result["version"] == "1.2.0"
        assert result["metadata"]["restored_from"] == "1.0.0"

    def test_restore_version_returns_none_when_not_found(self) -> None:
        """Test that restore returns None when test not found."""
        result = test_service.restore_test_version("nonexistent-id", "1.0.0")

        assert result is None

    def test_restore_version_raises_on_invalid_version(self) -> None:
        """Test that restore raises error when version not found."""
        created = test_service.create_test({"name": "Restore Test"})

        with pytest.raises(ValidationException, match="not found"):
            test_service.restore_test_version(created["id"], "99.0.0")

    def test_restore_version_handles_malformed_version(self) -> None:
        """Test that restore handles tests with malformed version strings."""
        from tests.api.test_helpers import save_test_file

        # Create a test with malformed version directly
        test_id = str(uuid.uuid4())
        save_test_file(
            {
                "id": test_id,
                "name": "Malformed Version Test",
                "version": "invalid",  # Not semver format
                "workflow": {"nodes": [], "edges": []},
            }
        )

        # Also need to set up version history by creating a versions.yaml file

        import yaml

        from tests.api.test_helpers import get_test_dir

        versions_file = get_test_dir(test_id) / "versions.yaml"
        versions = [{"version": "invalid", "snapshot": {"name": "Original"}, "is_latest": True}]
        with open(versions_file, "w", encoding="utf-8") as f:
            yaml.dump(versions, f)

        result = test_service.restore_test_version(test_id, "invalid")

        assert result is not None
        # Should default to 1.1.0 when version can't be parsed
        assert result["version"] == "1.1.0"

    def test_restore_version_handles_short_version(self) -> None:
        """Test that restore handles tests with short version strings."""
        import yaml

        from tests.api.test_helpers import get_test_dir, save_test_file

        # Create a test with short version directly
        test_id = str(uuid.uuid4())
        save_test_file(
            {
                "id": test_id,
                "name": "Short Version Test",
                "version": "1.0",  # Only 2 parts
                "workflow": {"nodes": [], "edges": []},
            }
        )

        # Set up version history
        versions_file = get_test_dir(test_id) / "versions.yaml"
        versions = [{"version": "1.0", "snapshot": {"name": "Original"}, "is_latest": True}]
        with open(versions_file, "w", encoding="utf-8") as f:
            yaml.dump(versions, f)

        result = test_service.restore_test_version(test_id, "1.0")

        assert result is not None
        # Should default to 1.1.0 when version is too short
        assert result["version"] == "1.1.0"


class TestClearStorage:
    """Test suite for _clear_storage helper function."""

    def test_clear_storage_removes_existing_content(self) -> None:
        """Test that _clear_storage removes existing storage content."""
        # Create a test first (this creates the storage dir with content)
        test_service._clear_storage()
        test_service.create_test({"name": "Test to be cleared"})

        # Verify test exists
        assert len(test_service._list_all_tests()) == 1

        # Clear storage
        test_service._clear_storage()

        # Verify storage is empty
        assert len(test_service._list_all_tests()) == 0


class TestListAllTags:
    """Test suite for list_all_tags function (REQ-9.5.3.1)."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_list_all_tags_returns_unique_tags_from_all_tests(self) -> None:
        """Test that list_all_tags returns unique tags from all tests."""
        # Create tests with tags in metadata.tags
        test_service.create_test(
            {
                "name": "Test 1",
                "metadata": {"tags": ["api", "integration"]},
            }
        )
        test_service.create_test(
            {
                "name": "Test 2",
                "metadata": {"tags": ["api", "smoke"]},
            }
        )
        test_service.create_test(
            {
                "name": "Test 3",
                "metadata": {"tags": ["e2e", "regression"]},
            }
        )

        result = test_service.list_all_tags()

        # Should contain all unique tags
        assert "api" in result
        assert "integration" in result
        assert "smoke" in result
        assert "e2e" in result
        assert "regression" in result
        # Should be sorted alphabetically
        assert result == sorted(result)
        # Should have no duplicates (api appears in 2 tests)
        assert len(result) == len(set(result))

    def test_list_all_tags_returns_empty_list_when_no_tests_exist(self) -> None:
        """Test that list_all_tags returns empty list when no tests exist."""
        result = test_service.list_all_tags()

        assert result == []

    def test_list_all_tags_returns_empty_list_when_tests_have_no_tags(self) -> None:
        """Test that list_all_tags returns empty list when tests have no tags."""
        # Create tests without tags
        test_service.create_test({"name": "Test 1"})
        test_service.create_test({"name": "Test 2", "metadata": {}})

        result = test_service.list_all_tags()

        assert result == []

    def test_list_all_tags_returns_sorted_tags(self) -> None:
        """Test that list_all_tags returns tags in alphabetical order."""
        test_service.create_test(
            {
                "name": "Test 1",
                "metadata": {"tags": ["zulu", "alpha", "mike"]},
            }
        )

        result = test_service.list_all_tags()

        assert result == ["alpha", "mike", "zulu"]

    def test_list_all_tags_handles_empty_tags_list(self) -> None:
        """Test that list_all_tags handles tests with empty tags list."""
        test_service.create_test(
            {
                "name": "Test 1",
                "metadata": {"tags": []},
            }
        )
        test_service.create_test(
            {
                "name": "Test 2",
                "metadata": {"tags": ["production"]},
            }
        )

        result = test_service.list_all_tags()

        assert result == ["production"]

    def test_list_all_tags_deduplicates_across_tests(self) -> None:
        """Test that list_all_tags returns each tag only once."""
        # Create multiple tests with overlapping tags
        test_service.create_test(
            {
                "name": "Test 1",
                "metadata": {"tags": ["critical", "production"]},
            }
        )
        test_service.create_test(
            {
                "name": "Test 2",
                "metadata": {"tags": ["critical", "staging"]},
            }
        )
        test_service.create_test(
            {
                "name": "Test 3",
                "metadata": {"tags": ["critical", "development"]},
            }
        )

        result = test_service.list_all_tags()

        # "critical" should appear only once
        assert result.count("critical") == 1
        assert set(result) == {"critical", "production", "staging", "development"}


class TestProcessVariablesForSave:
    """Tests for _process_variables_for_save, including the unset declaration."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_passes_test_owned_vars_through(self) -> None:
        """Variables with values pass through unchanged."""
        variables: dict[str, Any] = {"my_var": {"type": "string", "value": "hello"}}
        result = test_service._process_variables_for_save(variables)
        assert result == {"my_var": {"type": "string", "value": "hello"}}

    def test_stores_a_valueless_non_secret_unset(self) -> None:
        """A declaration carrying only a type is stored valueless, not defaulted."""
        variables: dict[str, Any] = {
            "missing_val": {"type": "integer"},
        }
        result = test_service._process_variables_for_save(variables)
        assert result["missing_val"] == {"type": "integer"}
        assert "value" not in result["missing_val"]

    def test_secret_without_value_is_a_valid_declare_empty(self) -> None:
        """A secret may defer its value; it passes through stored valueless."""
        variables: dict[str, Any] = {"token": {"type": "string", "secret": True}}
        result = test_service._process_variables_for_save(variables)
        assert result["token"] == {"type": "string", "secret": True}
        assert "value" not in result["token"]

    def test_an_explicit_empty_string_stays_a_value(self) -> None:
        """Unset and set-but-empty are not conflated on the way in."""
        variables: dict[str, Any] = {"blank": {"type": "string", "value": ""}}
        result = test_service._process_variables_for_save(variables)
        assert result["blank"] == {"type": "string", "value": ""}

    @pytest.mark.parametrize(
        "var_type",
        ["string", "integer", "float", "boolean", "array", "map", "table"],
    )
    def test_never_invents_a_value_key_for_any_type(self, var_type: str) -> None:
        variables: dict[str, Any] = {"declared": {"type": var_type}}
        result = test_service._process_variables_for_save(variables)
        assert result["declared"] == {"type": var_type}


class TestCreateTestVariableCleanup:
    """Tests for variable cleanup in create_test."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_create_test_allows_declared_vars(self) -> None:
        created = _create_test_with_legacy_data(
            {
                "name": "Declared Vars Test",
                "variables": {
                    "my_status": {"type": "integer", "value": 0},
                },
                "workflow": {
                    "nodes": [
                        {
                            "data": {
                                "config": {
                                    "outputBindings": {"status": "my_status"},
                                },
                            },
                        },
                    ],
                    "edges": [],
                },
            }
        )
        assert "my_status" in created["variables"]

    def test_create_test_stores_a_valueless_variable_unset(self) -> None:
        created = test_service.create_test(
            {
                "name": "No Value Test",
                "variables": {
                    "missing_val": {"type": "string"},
                },
            }
        )
        assert created["variables"]["missing_val"] == {"type": "string"}
        stored = test_service.get_test(created["id"])
        assert stored is not None
        assert "value" not in stored["variables"]["missing_val"]


class TestUpdateTestVariableCleanup:
    """Tests for variable cleanup in update_test."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_update_test_stores_a_valueless_variable_unset(self) -> None:
        created = test_service.create_test(
            {
                "name": "Update No Value Test",
                "variables": {"var1": {"type": "string", "value": "hello"}},
            }
        )
        test_service.update_test(
            created["id"],
            {
                "variables": {
                    "no_val": {"type": "integer"},
                },
            },
        )
        stored = test_service.get_test(created["id"])
        assert stored is not None
        assert stored["variables"]["no_val"] == {"type": "integer"}


class TestGetTestVariableResolution:
    """Tests for variable handling in get_test."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_get_test_does_not_warn_for_an_unset_variable(self) -> None:
        """An unset declaration is a legitimate state, not a warning."""
        created = _create_test_with_legacy_data(
            {
                "name": "No Value Warn Test",
                "variables": {
                    "orphaned_var": {"type": "string"},
                },
            }
        )
        result = test_service.get_test(created["id"])
        assert result is not None
        assert "variable_warnings" not in result
        assert "value" not in result["variables"]["orphaned_var"]

    def test_get_test_does_not_warn_for_an_unset_secret(self) -> None:
        created = _create_test_with_legacy_data(
            {
                "name": "Unset Secret Test",
                "variables": {
                    "token": {"type": "string", "secret": True},
                },
            }
        )
        result = test_service.get_test(created["id"])
        assert result is not None
        assert "variable_warnings" not in result
        assert "value" not in result["variables"]["token"]

    def test_get_test_no_warnings_for_owned_vars(self) -> None:
        """Test that test-owned variables with values don't produce warnings."""
        created = test_service.create_test(
            {
                "name": "Owned Vars Test",
                "variables": {
                    "my_var": {"type": "string", "value": "hello"},
                },
            }
        )
        result = test_service.get_test(created["id"])
        assert result is not None
        assert "variable_warnings" not in result

    def test_get_test_passes_through_non_dict_variable(self) -> None:
        """Test that non-dict variable entries pass through unchanged."""
        created = _create_test_with_legacy_data(
            {
                "name": "Non-Dict Var Test",
                "variables": {
                    "simple_var": "just a string value",
                },
            }
        )
        result = test_service.get_test(created["id"])
        assert result is not None
        assert result["variables"]["simple_var"] == "just a string value"


class TestFindNodeByIdNotFound:
    """Tests for _find_node_by_id returning None."""

    def test_returns_none_when_node_not_in_list(self) -> None:
        """Line 2993: no matching node returns None."""
        nodes = [{"id": "a"}, {"id": "b"}]
        result = test_service._find_node_by_id(nodes, "nonexistent")
        assert result is None

    def test_returns_none_for_empty_list(self) -> None:
        result = test_service._find_node_by_id([], "any-id")
        assert result is None


class TestFixAssertionIdsNodeNotFound:
    """Tests for _fix_assertion_ids when node is not found."""

    def test_returns_early_when_node_not_found(self) -> None:
        """Line 3021: node_id not in nodes list causes early return."""
        nodes: list[dict[str, Any]] = [{"id": "existing"}]
        # Should not raise - just return
        test_service._fix_assertion_ids(nodes, "nonexistent", "MISSING_ASSERTION_ID")


class TestFixNodeErrorsGuard:
    """Tests for _fix_node_errors when node_id is missing."""

    def test_returns_early_when_no_node_id_for_non_missing_id_code(self) -> None:
        """Line 3059: error without node_id for non-MISSING_NODE_ID code returns."""
        error: dict[str, Any] = {"code": "MISSING_POSITION"}  # No node_id
        nodes: list[dict[str, Any]] = []
        nodes_to_remove: set[str] = set()
        test_service._fix_node_errors(error, nodes, nodes_to_remove)
        assert nodes_to_remove == set()


class TestExtractEdgeIdFromPathGuard:
    """Tests for _extract_edge_id_from_path non-matching path."""

    def test_returns_none_for_non_matching_path(self) -> None:
        """Line 3075: path that doesn't start with prefix returns None."""
        result = test_service._extract_edge_id_from_path("some.other.path")
        assert result is None


class TestFixInvalidEdgeTypeGuard:
    """Tests for _fix_invalid_edge_type non-matching path."""

    def test_returns_early_for_non_edges_path(self) -> None:
        """Line 3099: path that doesn't start with 'edges[' returns early."""
        edges: list[dict[str, Any]] = [{"id": "e1", "type": "bad"}]
        test_service._fix_invalid_edge_type(edges, "some.other.path", "INVALID_EDGE_TYPE")
        # Edge type should not be removed since path didn't match
        assert edges[0]["type"] == "bad"


class TestFixInvalidVariableGuards:
    """Tests for _fix_invalid_variable guard clauses."""

    def test_returns_early_for_non_variable_path(self) -> None:
        """Line 3142: path not starting with 'variables.' returns early."""
        error: dict[str, Any] = {
            "code": "INVALID_VARIABLE_NAME",
            "path": "workflow.nodes.something",
        }
        test: dict[str, Any] = {"variables": {"x": {"type": "string", "value": "v"}}}
        nodes: list[dict[str, Any]] = []
        test_service._fix_invalid_variable(error, test, nodes)
        # Nothing should be modified
        assert "x" in test["variables"]

    def test_returns_early_when_bad_name_not_in_variables(self) -> None:
        """Line 3146: variable name extracted from path not in test variables."""
        error: dict[str, Any] = {
            "code": "INVALID_VARIABLE_NAME",
            "path": "variables.nonexistent_var",
        }
        test: dict[str, Any] = {"variables": {"other_var": {"type": "string", "value": "v"}}}
        nodes: list[dict[str, Any]] = []
        test_service._fix_invalid_variable(error, test, nodes)
        # other_var should remain unchanged
        assert "other_var" in test["variables"]


class TestFixInvalidVariableTypeGuard:
    """Tests for _fix_invalid_variable_type path guard."""

    def test_returns_early_for_non_variable_type_path(self) -> None:
        """Line 3196: path not matching 'variables.X.type' pattern returns early."""
        error: dict[str, Any] = {
            "code": "INVALID_VARIABLE_TYPE",
            "path": "workflow.some.path",
        }
        test: dict[str, Any] = {"variables": {"v": {"type": "bad_type", "value": "x"}}}
        test_service._fix_invalid_variable_type(error, test)
        # Type should remain unchanged
        assert test["variables"]["v"]["type"] == "bad_type"


class TestFixUndeclaredVariableGuard:
    """Tests for _fix_undeclared_variable path guard."""

    def test_returns_early_for_non_variable_path(self) -> None:
        """Line 3214: path not starting with 'variables.' returns early."""
        error: dict[str, Any] = {
            "code": "UNDECLARED_VARIABLE",
            "path": "workflow.nodes.ref",
        }
        test: dict[str, Any] = {"variables": {}}
        nodes: list[dict[str, Any]] = []
        test_service._fix_undeclared_variable(error, test, nodes)
        assert test["variables"] == {}


class TestImportFixAssertionIdsNodeNotFound:
    """Tests for _import_fix_assertion_ids when node is not found."""

    def test_returns_early_when_node_not_found(self) -> None:
        """Line 4018: node_id not in nodes causes early return."""
        nodes: list[dict[str, Any]] = [{"id": "existing"}]
        applied: list[str] = []
        test_service._import_fix_assertion_ids(nodes, "nonexistent", applied)
        assert applied == []


class TestImportFixNotes:
    """The note each import fix leaves names the Block."""

    def test_a_default_position_is_noted(self) -> None:
        nodes: list[dict[str, Any]] = [{"id": "n1"}]
        applied: list[str] = []

        test_service._import_fix_position(nodes, "n1", applied)

        assert applied == ["Added default position to block n1"]

    def test_a_generated_id_is_noted(self) -> None:
        nodes: list[dict[str, Any]] = [{"data": {"label": "A"}}]
        applied: list[str] = []

        test_service._import_fix_node_ids(nodes, applied)

        assert applied == ["Generated missing block ID"]

    def test_generated_assertion_ids_are_noted(self) -> None:
        assertions = [{"type": "literal"}, {"type": "literal"}]
        nodes: list[dict[str, Any]] = [
            {"id": "assert-1", "data": {"config": {"values": {"assertions": assertions}}}}
        ]
        applied: list[str] = []

        test_service._import_fix_assertion_ids(nodes, "assert-1", applied)

        assert applied == ["Generated 2 missing assertion IDs in block assert-1"]


class TestResolveImportConflictUnknownResolution:
    """An unknown conflict choice falls back to the default, skip."""

    def test_an_unknown_resolution_skips_the_import(self) -> None:
        """No second Test gets the name: the import is skipped as with no choice at all."""
        test_data: dict[str, Any] = {"name": "test1"}
        existing: dict[str, Any] = {"id": "existing-id", "name": "test1"}
        skipped: list[dict[str, Any]] = []
        conflict_resolutions = {"test1": "unknown_action"}
        result = test_service._resolve_import_conflict(
            test_data, "test1", existing, conflict_resolutions, skipped
        )
        assert result is None
        assert skipped == [{"name": "test1", "reason": "skipped by user"}]
        assert test_data == {"name": "test1"}


class TestInMemoryCache:
    """Tests for the in-memory test cache (metadata views)."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        test_service._clear_storage()

    def test_clear_in_memory_cache_resets_state(self) -> None:
        """_clear_in_memory_cache resets cache so next access reloads from disk."""
        test_service.create_test({"name": "CacheTest", "workflow": {"nodes": [], "edges": []}})
        assert len(test_service._list_all_tests()) == 1

        # Clear only in-memory cache (not disk)
        test_service._clear_in_memory_cache()

        # Next access should reload from disk and find the test
        tests = test_service._list_all_tests()
        assert len(tests) == 1
        assert tests[0]["name"] == "CacheTest"

    def test_cache_reload_populates_from_disk(self) -> None:
        """_ensure_cache_loaded reads all test files from disk on cold start."""
        # Create tests (populates disk and cache)
        test_service.create_test({"name": "A", "workflow": {"nodes": [], "edges": []}})
        test_service.create_test({"name": "B", "workflow": {"nodes": [], "edges": []}})

        # Simulate cold start
        test_service._clear_in_memory_cache()

        # Reload should find both tests
        tests = test_service._list_all_tests()
        names = {t["name"] for t in tests}
        assert names == {"A", "B"}

    def test_cache_views_exclude_workflow(self) -> None:
        """Cached test views should not contain the workflow key."""
        test_service.create_test(
            {
                "name": "WorkflowTest",
                "workflow": {"nodes": [{"id": "n1"}], "edges": []},
            }
        )

        tests = test_service._list_all_tests()
        assert len(tests) == 1
        assert "workflow" not in tests[0]
        assert tests[0]["name"] == "WorkflowTest"

    def test_full_test_load_includes_workflow(self) -> None:
        """_load_test still returns full data including workflow."""
        created = _create_test_with_legacy_data(
            {
                "name": "FullTest",
                "workflow": {"nodes": [{"id": "n1"}], "edges": []},
            }
        )

        full = test_service._load_test(created["id"])
        assert full is not None
        assert "workflow" in full
        assert full["workflow"]["nodes"] == [{"id": "n1"}]

    def test_list_all_tests_full_includes_workflow(self) -> None:
        """_list_all_tests_full returns tests with workflow for backup."""
        _create_test_with_legacy_data(
            {
                "name": "BackupTest",
                "workflow": {"nodes": [{"id": "n1"}], "edges": []},
            }
        )

        full_tests = test_service._list_all_tests_full()
        assert len(full_tests) == 1
        assert "workflow" in full_tests[0]
        assert full_tests[0]["workflow"]["nodes"] == [{"id": "n1"}]


class TestUpdateTestVariablesAreReadOnly:
    """The variables endpoint persists author expressions, so it applies the same rule."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_an_expression_variable_that_changes_data_is_refused(self) -> None:
        created = test_service.create_test(
            {
                "name": "Var Read Only",
                "variables": {"rows": {"type": "array", "value": [1]}},
            }
        )

        with pytest.raises(ValidationException) as exc_info:
            test_service.update_test_variables(
                created["id"],
                {
                    "rows": {"type": "array", "value": [1]},
                    "sneaky": {"type": "string", "value": "rows.append(9)", "isExpression": True},
                },
            )

        assert exc_info.value.message == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Variable: sneaky."
        )
        stored = test_service.get_test_variables(created["id"])
        assert stored is not None
        assert "sneaky" not in stored

    def test_a_template_variable_that_changes_data_is_refused(self) -> None:
        created = test_service.create_test(
            {
                "name": "Var Read Only Template",
                "variables": {"rows": {"type": "array", "value": [1]}},
            }
        )

        with pytest.raises(ValidationException, match="add a Variable Setter Block"):
            test_service.update_test_variables(
                created["id"],
                {"shown": {"type": "string", "value": "n={{rows.append(9)}}", "isTemplate": True}},
                merge=True,
            )

    def test_a_variable_that_only_reads_is_still_accepted(self) -> None:
        created = test_service.create_test(
            {
                "name": "Var Read Only Reads",
                "variables": {"rows": {"type": "array", "value": [1]}},
            }
        )

        result = test_service.update_test_variables(
            created["id"],
            {"total": {"type": "integer", "value": "len(rows)", "isExpression": True}},
            merge=True,
        )

        assert result is not None
        assert "total" in result

    def test_a_bare_variable_declaration_is_skipped(self) -> None:
        created = test_service.create_test({"name": "Var Read Only Bare"})

        result = test_service.update_test_variables(created["id"], {"rows": [1, 2]})

        assert result is not None
        assert "rows" in result


_HISTORY_ROWS: list[dict[str, Any]] = [
    {
        "version": "1.0.0",
        "created_at": "2025-01-02T03:04:05+00:00",
        "created_by": "ada",
        "changes": "Initial version",
    },
    {
        "version": "3.2.1",
        "created_at": "2025-06-07T08:09:10+00:00",
        "created_by": "grace",
        "changes": "Tuned the retries",
    },
]


def _test_document(name: str, **fields: Any) -> dict[str, Any]:
    """A whole Test document whose version and times no save would produce."""
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "version": "3.2.1",
        "description": "",
        "workflow": {"nodes": [], "edges": []},
        "variables": {},
        "metadata": {"author": "ada", "tags": ["smoke"]},
        "created_at": "2025-01-02T03:04:05+00:00",
        "updated_at": "2025-06-07T08:09:10+00:00",
        **fields,
    }


def _log_node_reading(variable: str) -> dict[str, Any]:
    """A Log block whose message reads one variable."""
    return {
        "id": "node-log-1",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": "Log",
            "expressionFields": ["message"],
            "config": {"values": {"message": variable, "level": "INFO"}},
        },
    }


def _persist_test(
    document: dict[str, Any],
    history: list[dict[str, Any]] | None = None,
    files: list[tuple[str, bytes]] | None = None,
    *,
    replace_files: bool = False,
) -> None:
    """Hand copies to the public writer, so the values a test holds stay comparable."""
    test_service.persist_test_document(
        copy.deepcopy(document),
        copy.deepcopy(history or []),
        list(files or []),
        replace_files=replace_files,
    )


def _stored_test(test_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """One Test's stored document and history rows, read through the public reader."""
    stored = {
        document["id"]: (document, rows) for document, rows in test_service.list_test_documents()
    }
    return stored[test_id]


def _test_file(test_id: str, filename: str) -> Any:
    """What one storage file of the Test holds."""
    path = get_tests_storage_path() / test_id / filename
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _data_files(test_id: str) -> dict[str, bytes]:
    """The Test's data files by relative path."""
    return {rel: path.read_bytes() for rel, path in testdata_service.iter_files(test_id)}


def _listed_test_names() -> list[str]:
    """The names the Tests list shows right now."""
    return [test["name"] for test in test_service.list_tests()["tests"]]


class TestPersistTestDocument:
    """The public writer stores a Test as it is handed over (REQ-5.2.4.9.5, REQ-5.2.4.9.6)."""

    def test_the_document_is_written_as_given(self) -> None:
        """Id, version, times and metadata are stored unchanged."""
        document = _test_document("Kept Whole")

        _persist_test(document)

        assert _stored_test(document["id"])[0] == document

    def test_the_history_rows_are_written_as_given(self) -> None:
        """The rows handed over are stored, and an empty list stores none."""
        with_rows = _test_document("With Rows")
        without_rows = _test_document("Without Rows")

        _persist_test(with_rows, _HISTORY_ROWS)
        _persist_test(without_rows, [])

        assert _stored_test(with_rows["id"])[1] == _HISTORY_ROWS
        assert _stored_test(without_rows["id"])[1] == []

    def test_the_data_files_are_written_under_the_tests_id(self) -> None:
        """Every file handed over lands in that Test's own data folder."""
        document = _test_document("With Files")
        other = _test_document("Without Files")
        files = [("rows.csv", b"id,name\n"), ("fixtures/notes.txt", b"notes")]

        _persist_test(document, files=files)
        _persist_test(other)

        assert _data_files(document["id"]) == dict(files)
        assert _data_files(other["id"]) == {}

    def test_replace_files_empties_the_folder_first(self) -> None:
        """With replace_files only the files of this call are left."""
        document = _test_document("Replaced Files")
        _persist_test(document, files=[("old.csv", b"old")])

        _persist_test(document, files=[("new.csv", b"new")], replace_files=True)
        assert _data_files(document["id"]) == {"new.csv": b"new"}

        _persist_test(document, replace_files=True)
        assert _data_files(document["id"]) == {}

    def test_without_replace_files_the_files_here_stay(self) -> None:
        """Without replace_files the new files join the ones already stored."""
        document = _test_document("Kept Files")
        _persist_test(document, files=[("old.csv", b"old")])

        _persist_test(document, files=[("new.csv", b"new")], replace_files=False)

        assert _data_files(document["id"]) == {"old.csv": b"old", "new.csv": b"new"}

    def test_no_validation_and_no_name_check_runs(self) -> None:
        """A document the save refuses for its name and its content is still written."""
        test_service.create_test({"name": "Taken Name"})
        document = _test_document(
            "Taken Name", workflow={"nodes": [_log_node_reading("ghost")], "edges": []}
        )
        refusals = {
            finding["code"]
            for finding in test_service.validate_test_data_for_create(copy.deepcopy(document))
        }
        assert {"NAME_CONFLICT", "UNDECLARED_VARIABLE"} <= refusals

        _persist_test(document)

        assert _stored_test(document["id"])[0] == document
        assert _listed_test_names() == ["Taken Name", "Taken Name"]

    def test_the_list_shows_the_new_content_at_once(self) -> None:
        """The Tests list follows the write, also when the id was already here."""
        document = _test_document("First Name")
        _persist_test(document)
        assert _listed_test_names() == ["First Name"]

        _persist_test({**document, "name": "Second Name"})

        assert _listed_test_names() == ["Second Name"]

    def test_the_tests_import_writes_through_it(self) -> None:
        """The import stores its Test through the writer, with its one history row."""
        content = yaml.safe_dump(
            {"name": "Imported", "workflow": {"nodes": [], "edges": []}}
        ).encode()

        with patch.object(
            test_service, "persist_test_document", wraps=test_service.persist_test_document
        ) as writer:
            result = test_service.import_tests(content, "imported.yaml")

        writer.assert_called_once()
        document, rows = _stored_test(result["imported"][0]["id"])
        assert rows == [
            {
                "version": "1.0.0",
                "created_at": document["created_at"],
                "created_by": "import",
                "changes": "Imported",
            }
        ]

    def test_a_failed_write_of_a_new_test_removes_what_it_wrote_and_raises_again(self) -> None:
        """A new Test whose data files fail leaves no folder and no list entry."""
        document = _test_document("Half Written")
        write_files = testdata_service.write_files

        def _write_then_fail(test_id: str, entries: Any) -> int:
            write_files(test_id, entries)
            raise OSError("disk full")

        with (
            patch.object(testdata_service, "write_files", side_effect=_write_then_fail),
            pytest.raises(OSError, match=r"^disk full$"),
        ):
            _persist_test(document, _HISTORY_ROWS, [("rows.csv", b"id,name\n")])

        assert not (get_tests_storage_path() / document["id"]).exists()
        assert not get_test_testdata_path(document["id"]).exists()
        assert test_service.list_test_documents() == []
        assert _listed_test_names() == []

    def test_a_failed_write_over_a_test_that_was_here_removes_nothing(self) -> None:
        """A Test that existed before the call keeps its folders when the write fails."""
        created = test_service.create_test({"name": "Was Here"})
        testdata_service.store_bytes(created["id"], "", "keep.csv", b"keep", replace=False)
        document = _test_document("Was Here", id=created["id"])

        with (
            patch.object(testdata_service, "write_files", side_effect=OSError("disk full")),
            pytest.raises(OSError, match=r"^disk full$"),
        ):
            _persist_test(document, _HISTORY_ROWS, [("new.csv", b"new")])

        assert (get_tests_storage_path() / created["id"]).is_dir()
        assert _data_files(created["id"]) == {"keep.csv": b"keep"}
        assert [stored["id"] for stored, _rows in test_service.list_test_documents()] == [
            created["id"]
        ]


class TestListTestDocuments:
    """The public reader hands back every stored Test with its history (REQ-5.2.4.9.5)."""

    def test_every_stored_test_comes_back_with_its_history_rows(self) -> None:
        """One pair per Test: the stored document whole, then its history rows."""
        first = _create_test_with_legacy_data(
            {
                "name": "First",
                "workflow": {"nodes": [{"id": "n1"}], "edges": []},
                "variables": {"token": {"type": "string", "secret": True, "value": "s3cret"}},
            }
        )
        second = test_service.create_test({"name": "Second"})
        test_service.update_test(second["id"], {"description": "Changed"})

        pairs = test_service.list_test_documents()

        assert len(pairs) == 2
        by_id = {document["id"]: (document, rows) for document, rows in pairs}
        assert by_id == {
            test_id: (_test_file(test_id, "test.yaml"), _test_file(test_id, "versions.yaml"))
            for test_id in (first["id"], second["id"])
        }
        assert by_id[first["id"]][0]["workflow"]["nodes"] == [{"id": "n1"}]
        assert [row["version"] for row in by_id[second["id"]][1]] == ["1.0.0", "1.1.0"]


def _repair_nodes() -> list[dict[str, Any]]:
    return [
        {
            "id": "check",
            "data": {
                "elementType": "assert",
                "nodeType": "control",
                "config": {
                    "values": {
                        "assertions": [
                            {
                                "id": "c1",
                                "type": "literal",
                                "variable": "bad-name",
                                "value_type": "string",
                                "operator": "equals",
                                "reference_value": "x",
                            },
                            {"type": "operator", "value": "and"},
                            {
                                "id": "c2",
                                "type": "literal",
                                "variable": "other",
                                "value_type": "string",
                                "operator": "equals",
                                "reference_value": "bad-name",
                                "reference_is_expression": True,
                            },
                        ]
                    }
                },
            },
        },
        {
            "id": "say",
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
                "templateFields": ["message"],
                "expressionFields": ["args.0"],
                "config": {
                    "values": {"message": "Hi {{ bad-name }} and {{other}}", "args": ["bad-name"]},
                    "outputBindings": {"line": "bad-name"},
                },
            },
        },
        {
            "id": "set",
            "data": {
                "elementType": "variable-setter",
                "nodeType": "control",
                "variableExpressionKeys": ["bad-name"],
                "variableTemplateKeys": ["keep"],
                "variableTypes": {"bad-name": "string", "keep": "string"},
                "variableElementTypes": {"bad-name": []},
                "config": {
                    "variableSecretKeys": ["bad-name"],
                    "values": {"variables": {"bad-name": "'v'", "keep": "k"}},
                },
            },
        },
        {
            "id": "fn",
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "expressionFields": ["x", "tags.0"],
                "templateFields": ["note"],
                "config": {
                    "values": {
                        "x": "bad-name",
                        "tags": ["bad-name", "bad-name"],
                        "note": "id {{ bad-name }}",
                    },
                    "outputBindings": {"r": "bad-name"},
                },
            },
        },
    ]


class TestInvalidVariableRepairRewritesEverySite:
    """An invalid name in use is renamed wherever a block names it: condition rows,
    templates, list entries, output bindings, Setter targets and Function Block fields
    (REQ-3.1.2.7)."""

    def test_every_site_names_the_new_variable(self) -> None:
        nodes = _repair_nodes()
        test: dict[str, Any] = {"variables": {"bad-name": {"type": "string"}}}

        test_service._fix_invalid_variable(
            {"code": "INVALID_VARIABLE", "path": "variables.bad-name"}, test, nodes
        )

        (fixed,) = test["variables"]
        assert fixed.startswith("fixed_")
        check, say, setter, function_block = (node["data"] for node in nodes)
        rows = check["config"]["values"]["assertions"]
        assert rows[0]["variable"] == fixed
        assert rows[2]["reference_value"] == fixed
        assert say["config"]["values"] == {
            "message": "Hi {{ " + fixed + " }} and {{other}}",
            "args": [fixed],
        }
        assert say["config"]["outputBindings"] == {"line": fixed}
        assert setter["config"]["values"]["variables"] == {fixed: "'v'", "keep": "k"}
        assert setter["variableExpressionKeys"] == [fixed]
        assert setter["variableTemplateKeys"] == ["keep"]
        assert setter["variableTypes"] == {fixed: "string", "keep": "string"}
        assert setter["variableElementTypes"] == {fixed: []}
        assert setter["config"]["variableSecretKeys"] == [fixed]
        # Only the entry flagged as an expression is a read; the other item is text.
        assert function_block["config"]["values"] == {
            "x": fixed,
            "tags": [fixed, "bad-name"],
            "note": "id {{ " + fixed + " }}",
        }
        assert function_block["config"]["outputBindings"] == {"r": fixed}
        assert function_block["expressionFields"] == ["x", "tags.0"]
        assert function_block["templateFields"] == ["note"]
        assert "inputBindings" not in function_block

    def test_a_name_used_only_in_a_condition_row_is_renamed_not_deleted(self) -> None:
        errors: list[dict[str, Any]] = []
        nodes = _repair_nodes()[:1]

        test_service._validate_variables(
            {"bad-name": {"type": "string"}}, nodes, lambda **kw: errors.append(kw)
        )

        assert [error["fix_action"] for error in errors] == [
            "Rename to valid identifier and update references"
        ]

    def test_an_invalid_name_matches_source_text_but_not_a_longer_binding_target(self) -> None:
        nodes = [
            {
                "id": "n",
                "data": {
                    "elementType": "log",
                    "nodeType": "plugin",
                    "expressionFields": ["message"],
                    "config": {
                        "values": {"message": "bad-name + 1"},
                        "outputBindings": {"line": "xbad-namey"},
                    },
                },
            }
        ]

        found = test_service._sites_naming(nodes, "bad-name")

        assert [site.setting for _node, site in found] == ["message"]


class TestConflictingBindingsRemoval:
    """A type conflict removes only the output bindings of the name; its reads stay."""

    def test_only_the_output_binding_is_removed(self) -> None:
        nodes = [
            {
                "id": "n",
                "data": {
                    "elementType": "log",
                    "nodeType": "plugin",
                    "expressionFields": ["message"],
                    "config": {"values": {"message": "v"}, "outputBindings": {"line": "v"}},
                },
            }
        ]

        test_service._remove_conflicting_bindings(test_service._sites_naming(nodes, "v"))

        assert nodes[0]["data"]["config"] == {"values": {"message": "v"}, "outputBindings": {}}
